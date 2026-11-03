# PostgreSQL 18.6 锁管理器实现（SpinLock / LWLock / Heavyweight / 行锁）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `06-lock-manager.txt`；本文写 **18.6 实现**。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3`），gdb 需 `substitute-path`。
> 前置：[[05-buffer-manager]] 的 pin 与 `content_lock`（那是 LWLock）；[[03-mvcc-clog]] 的「读不阻塞写」——表级 `AccessShareLock` 不和 `RowExclusiveLock` 冲突。
> 后续：[[07-transaction-subxact]]（xid 分配时 `XactLockTableInsert`）；[[postgres/08-vacuum-freezing]]（VACUUM 拿 `ShareUpdateExclusiveLock`）。

==============================================================================

## 一句话

三层不是「选一种」：临界区几十个周期用 **SpinLock**；保护共享结构、不能跨事务用 **LWLock**；要事务语义、等待队列、死锁检测用 **Heavyweight Lock**（源码里就叫 `LOCK`）。行上的 `FOR UPDATE` 把标志写进 `t_infomask`，真正卡住别人的是 **等持锁事务的 xid**（`LOCKTAG_TRANSACTION`），不是给每一行在锁表里常驻一个对象。

==============================================================================

## 分层

```
SpinLock     TAS/CAS，不睡，临界区禁止 palloc/elog
    │  保护 LWLock 等待队列（state 的 LOCKED 位）、insertpos_lck、统计…
    ▼
LWLock       state 一个原子字：共享计数 / 排他 / HAS_WAITERS
    │  Buffer content、BufMapping 分区、WALInsertLocks、ProcArrayLock、锁表分区
    ▼
Heavyweight  LOCKTAG → 共享哈希 LOCK + PROCLOCK
    │  表 / 页 / 元组 / 事务 xid / virtualxid / advisory…
    ▼
行锁         heap 页 infomask + xmax；等待走 XactLockTableWait(xid)
```

MVCC 解决读/写互不堵；**同一行两个 UPDATE、DDL、扩展文件、共享内存结构** 仍然要锁。

==============================================================================

## 1. SpinLock

`s_lock.h` / `spin.h`。x86_64 上 `slock_t` 一般是 `unsigned char`，`TAS` 用 `xchgb`。`SpinLockAcquire` → `s_lock()`：拿不到就 `SPIN_DELAY` 空转，超时约一分钟 `abort()`。释放是写 0（带平台需要的屏障）。

约束（违反就是隐患，不是风格问题）：

- 临界区极短，不能 `palloc` / `ereport` / 再拿同一把自旋锁 / 拿 LWLock 或重量级锁。
- 不可重入。
- 已见过的用法：`XLogCtl->insertpos_lck`、`buffer_strategy_lock`、统计计数。LWLock 的等待链表在 18.6 **不再**用结构体里的 `slock_t waitlist_lock`。

==============================================================================

## 2. LWLock（18.6 结构）

`lwlock.h`。本机 **没有** `nwaiters` 字段——那只在 `LOCK_DEBUG` 构建里。课程里的 `sema` 也早没了。

```c
typedef struct LWLock {
	uint16		tranche;
	pg_atomic_uint32 state;     /* 持有计数 + 标志位 */
	proclist_head waiters;      /* 等待的 PGPROC 链表 */
#ifdef LOCK_DEBUG
	pg_atomic_uint32 nwaiters;
	PGPROC	   *owner;
#endif
} LWLock;
```

`state` 高位：

| 位 | 含义 |
|---|---|
| `LW_FLAG_HAS_WAITERS` | 链表非空，释放时要醒人 |
| `LW_FLAG_RELEASE_OK` | 允许把锁让给等待者 |
| `LW_FLAG_LOCKED` | **正在改 waiters 链表**（这就是 wait-list 锁，CAS 进 state，不是另一把 SpinLock） |

其余位：共享持有者计数，或排他值 `LW_VAL_EXCLUSIVE`。

`MainLWLockArray` 里固定一批：单个命名锁（`ProcArrayLock`、`WALWriteLock`…）+ **128** 路 BufMapping + **16** 路 LockManager（`NUM_LOCK_PARTITIONS`）+ predicate 分区。每个 buffer 的 `content_lock` 嵌在 `BufferDesc` 里，不在这个主数组。

### `LWLockAcquire`

```
HOLD_INTERRUPTS()                     /* 持锁期间不响应 cancel/die */
for (;;) {
    LWLockAttemptLock                 /* CAS：排他要计数为 0；共享要没有排他 */
    成功 → 记下 held_lwlocks[]，返回
    失败 → LWLockWaitListLock 入队
           再 AttemptLock 一次（避免入队时锁已放）
           仍失败 → 睡（latch），被 LWLockRelease 按队列叫醒
}
```

释放者看 `HAS_WAITERS | RELEASE_OK`，从 `waiters` **按队列**叫醒，不是一颗信号量惊群。这是 PG16 之后的路径；函数名仍是 `LWLockWaitListLock`，锁住的是 `state` 的 `LOCKED` 位。

本进程同时持有的 LWLock 有上限 `MAX_SIMUL_LWLOCKS`。**不能跨事务**，也不能在持有时无限等重量级锁（死锁检测要去抢锁表分区 LWLock）。

和前面几章的对应：

| 锁 | 谁拿 |
|---|---|
| buffer `content_lock` | `LockBuffer`；hint 允许 SHARED |
| BufMapping 分区 | `BufferAlloc` 查/改哈希 |
| `WALInsertLocks[i]` | `XLogInsertRecord` |
| `WALWriteLock` | `XLogFlush` |
| `ProcArrayLock` | `GetSnapshotData` SHARED |
| LockManager 分区 | 重量级锁表 |

`pg_stat_activity.wait_event_type = 'LWLock'` 看到的是 tranche 名（`BufferContent`、`WALWrite`、`LockManager`、`ProcArray`…）。

==============================================================================

## 3. Heavyweight：锁表

对象用 `LOCKTAG`（`lock.h`）标识，不要手填字段，用 `SET_LOCKTAG_*`。

| `locktag_type` | field1/2/3/4 | 典型 |
|---|---|---|
| `RELATION` | db, rel | `LOCK TABLE` / SQL 隐式表锁 |
| `RELATION_EXTEND` | db, rel | 扩文件 |
| `PAGE` / `TUPLE` | + blk / off | 元组锁（多等待者排队） |
| `TRANSACTION` | xid | **等某个事务结束** |
| `VIRTUALTRANSACTION` | procNumber, lxid | 会话一开事务就有；`pg_locks` 里常见 |

共享内存两张哈希：`LockMethodLockHash`（`LOCK`）和 `LockMethodProcLockHash`（`PROCLOCK` = 某进程 × 某对象）。哈希按 tag 进 **16 个分区**，每个分区一把 LWLock，避免一把大锁。

```c
typedef struct LOCK {
	LOCKTAG		tag;
	LOCKMASK	grantMask, waitMask;
	dlist_head	procLocks;
	dclist_head waitProcs;
	int			requested[MAX_LOCKMODES], granted[MAX_LOCKMODES];
	int			nRequested, nGranted;
} LOCK;
```

`PROCLOCK.holdMask` 是这个后端在该对象上已经拿到的模式。本地还有 `LockMethodLocalHash`（`LOCALLOCK`）计「拿了几次」，事务结束 `LockReleaseAll` 一次清掉。

八种模式（`lockdefs.h`，1–8）。冲突矩阵是 `LockConflicts[]`（`lock.c:65`）：`conflictTab[mode]` 的第 j 位置位表示和模式 j 冲突。要点：

- `AccessShareLock`（SELECT）**只**和 `AccessExclusiveLock` 冲突 → 普通 SELECT 不堵 INSERT。
- `RowExclusiveLock`（INSERT/UPDATE/DELETE）堵 `ShareLock` 及以上（普通 `CREATE INDEX`），不堵另一个 `RowExclusiveLock` → **表级**允许两个 UPDATE 并行，行冲突走 xmax。
- `AccessExclusiveLock` 和所有模式冲突（`ALTER`/`DROP`/`VACUUM FULL`）。

`SELECT ... FOR UPDATE` 在**表**上拿的是 `RowShareLock`，不是 `ExclusiveLock`。活测 `FOR UPDATE` 栈里 `LockAcquire lockmode=7` 是 **`XactLockTableInsert` 给自己的 xid 挂 ExclusiveLock`**，别当成表锁。

### `LockAcquireExtended`

1. 本地哈希找到/建 `LOCALLOCK`；已持有同模式则只加计数。
2. **Fast path**（仅当前库的 `LOCKTAG_RELATION`，且 mode < `ShareUpdateExclusiveLock`）：写进 `MyProc->fpRelId[]`，不进共享哈希，也就不抢锁表分区 LWLock。槽满或已有「强锁」计数则放弃。
3. 若本次是强锁（mode > `ShareUpdateExclusiveLock`），先把别人 fast-path 上的同关系锁 **迁进** 共享表，再按冲突矩阵判。
4. 不冲突：`GrantLock`，更新 `grantMask`。
5. 冲突且 `dontWait`：返回 `LOCKACQUIRE_NOT_AVAIL`。
6. 否则 `ProcSleep`：链入 `waitProcs`，设 `MyProc->waitLock`，睡 latch。

`AccessExclusiveLock` 且 `wal_level` 够 standby 时，还要 `LogAccessExclusiveLock`（备库要知道有人锁了整表）。这就是 04 章 gdb 里 `rmid=8 Standby`。

==============================================================================

## 4. 等待与死锁

`ProcSleep`（`proc.c:1342`）**不是**每 `deadlock_timeout` 就主动跑检测那么简单：

1. `enable_timeout_after(DEADLOCK_TIMEOUT, DeadlockTimeout)`（默认 1s；若设了 `lock_timeout` 一起装）。
2. 循环 `WaitLatch`。
3. 超时：`CheckDeadLockAlert` 置 `got_deadlock_timeout` → 下一圈调 `CheckDeadLock()`。
4. `CheckDeadLock`：**按分区号顺序拿齐 16 把**锁表 LWLock（防 LWLock 死锁），若自己已经不在等待队列则返回；否则 `DeadLockCheck(MyProc)`。

`DeadLockCheck`（`deadlock.c:220`）从当前 `PGPROC` 沿 `waitLock` → 持有者 → 他们的 `waitLock` 做 DFS。硬环：`DS_HARD_DEADLOCK`，把自己 `RemoveFromWaitQueue`，`ProcSleep` 报 `deadlock detected`。软环：重排 `waitProcs` 队列，让不构成环的授予顺序先走。

`log_lock_waits=on` 时，同一次超时还会打「still waiting」日志。`pg_blocking_pids(pid)` 读的就是这套等待图。

==============================================================================

## 5. 行锁：infomask + 等 xid

`heap_lock_tuple`（`heapam.c:4777`）：`ReadBuffer` + **独占** content lock，`HeapTupleSatisfiesUpdate` 看行还在不在。然后改 header：

| SQL | infomask 要点 | xmax |
|---|---|---|
| `FOR UPDATE` | `LOCK_ONLY \| EXCL_LOCK` | 当前 xid |
| `FOR SHARE` | `LOCK_ONLY` | 当前 xid 或 MultiXact |
| `FOR KEY SHARE` | `LOCK_ONLY \| KEYSHR_LOCK` | 同上（FK） |

多人 `FOR SHARE` 时 xmax 装不下多个 xid → `HEAP_XMAX_IS_MULTI`，成员在 `pg_multixact/`（07/08 会再碰到它的 freeze）。

别人已经用冲突模式锁住或更新了这行：不能在 content lock 里死等（05 章规则）。做法是记下对方 xid，放下内容锁，**`XactLockTableWait(xid)`**：

```
SET_LOCKTAG_TRANSACTION(tag, xid);
LockAcquire(tag, ShareLock, …);   /* 等对方事务结束，它的 ExclusiveLock 会释放 */
LockRelease(tag, ShareLock, …);
```

对方开事务时 `AssignTransactionId` 已经 `XactLockTableInsert` 给自己 xid 挂了 `ExclusiveLock`。所以 `FOR UPDATE` 等待图的节点是 **事务**，不是每一行。`LOCKTAG_TUPLE` 用来在同一物理行上让多个等待者排队，避免全去挤 xid 锁。

活测栈：

```
LockAcquire (ExclusiveLock)          lock.c
  ← XactLockTableInsert (xid=792)
  ← AssignTransactionId
  ← heap_lock_tuple / heapam_tuple_lock
  ← ExecLockRows
```

==============================================================================

## gdb 与 pg_locks

```
break LockAcquire if lockmode == 7
break LWLockAcquire
break ProcSleep
break DeadLockCheck
break heap_lock_tuple
```

`LockAcquire` 停住：

```
p *locktag
p lockmode
p locktag->locktag_type          /* 5 = TRANSACTION，0 = RELATION */
```

`pg_locks`：`granted=f` 是等待。`LOCK TABLE ... ACCESS SHARE` 会看到 `relation/AccessShareLock` + `virtualxid/ExclusiveLock`（每个事务一开始就有 vxid 锁）。行等待常见 `locktype=transactionid`，不一定是 `tuple`。

构造死锁：两会话交叉 `UPDATE` 同一对行，等 `deadlock_timeout`。本批 evidence 没跑双会话。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| SpinLock | `src/include/storage/s_lock.h`、`spin.h` |
| `LWLock` / 分区数量 | `src/include/storage/lwlock.h` |
| `LWLockAcquire` / `AttemptLock` / `WaitListLock` | `src/backend/storage/lmgr/lwlock.c` |
| 锁模式 | `src/include/storage/lockdefs.h` |
| `LOCKTAG` / `LOCK` / `PROCLOCK` | `src/include/storage/lock.h` |
| `LockAcquireExtended` / `LockConflicts` / fast path | `src/backend/storage/lmgr/lock.c` |
| `XactLockTableInsert` / `Wait` | `src/backend/storage/lmgr/lmgr.c` |
| `ProcSleep` / `CheckDeadLock` | `src/backend/storage/lmgr/proc.c` |
| `DeadLockCheck` | `src/backend/storage/lmgr/deadlock.c` |
| `heap_lock_tuple` | `src/backend/access/heap/heapam.c` |
| 行锁说明 | `src/backend/access/heap/README.tuplock` |
| infomask 锁位 | `src/include/access/htup_details.h` |

==============================================================================

## 和前后章的关系

- [[05-buffer-manager]]：`content_lock` 是 LWLock；重量级锁等的时候必须先 unpin/放内容锁。
- [[03-mvcc-clog]]：SELECT 只拿表级 `AccessShareLock`，不堵写；`FOR UPDATE` 才改 xmax。
- [[04-wal-internals]]：`AccessExclusiveLock` 打 Standby WAL；`WALWriteLock` 是 LWLock。
- [[07-transaction-subxact]]：分配 xid 时插入事务锁；提交/回滚 `LockReleaseAll`。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch06-lock-manager.md`
