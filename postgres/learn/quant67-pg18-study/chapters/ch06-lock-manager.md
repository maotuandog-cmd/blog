# 第 06 章 对照笔记 — 锁管理器 (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/06-lock-manager.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/06-lock-manager.md`
> 证据: `evidence/ch06-lock-manager-evidence.txt` + `evidence/ch06-gdb-lock.txt`

==============================================================================

## 一、课程要点（节选）

> 三层：SpinLock → LWLock → Heavyweight Lock。行锁落在 tuple `t_infomask` 的 lock bits 上，等待进入锁表。死锁用 `DeadLockCheck()` 扫等待图。`pg_locks` + `pg_blocking_pids()` 是生产入口。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| `LWLock` | `lwlock.h` | `tranche` + `state` + `proclist waiters`；`nwaiters` 仅 `LOCK_DEBUG` |
| `LWLockAcquire` | `lwlock.c:1180` | `HOLD_INTERRUPTS` + `LWLockAttemptLock` CAS |
| `LWLockWaitListLock` | `lwlock.c:867` | 等链表锁是 `state` 的 `LW_FLAG_LOCKED` 位 |
| `LockAcquire` | `lock.c:808` | 转 `LockAcquireExtended`（`:835`） |
| `LockConflicts[]` | `lock.c:65` | 八种模式冲突矩阵 |
| Fast path | `lock.c:986` / `:2746` | 弱表锁写 `MyProc->fpRelId[]` |
| `ProcSleep` | `proc.c:1342` | latch + `DEADLOCK_TIMEOUT` |
| `CheckDeadLock` | `proc.c:1811` | 按序拿齐 16 把分区 LWLock，再调检测 |
| `DeadLockCheck` | `deadlock.c:220` | DFS；硬环 `DS_HARD_DEADLOCK`，软环重排队列 |
| `XactLockTableInsert` | `lmgr.c:622` | 给 xid 挂 `ExclusiveLock` |
| `XactLockTableWait` | `lmgr.c:663` | 行冲突时真正等待的对象 |
| `heap_lock_tuple` | `heapam.c:4777` | infomask + 必要时等 xid |
| `NUM_LOCK_PARTITIONS` | `lwlock.h` | **16** |
| `ProcArrayLock` | `MainLWLockArray[4]` | 快照扫描 |

==============================================================================

## 三、PG18 vs 课程

1. 课程把 LWLock 写成带 `nwaiters` / `sema` / `waitlist_lock`。18.6 正式结构是 `tranche + state + waiters`；等待链表用 `proclist`，保护位是 `state` 的 `LOCKED`，不是结构体里另一把 SpinLock。本机 helper 读不到 `nwaiters` 属正常。
2. 释放者不把锁「直接授予」等待者：叫醒队列，等待者自己再 CAS（`lwlock.c` 注释）。
3. `DeadLockCheck` 不是简单 BFS +「回滚代价最小」。有 soft edge，可重排 `waitProcs`。触发路径是 `deadlock_timeout` → `CheckDeadLock`，不是每秒忙轮询。
4. `SELECT … FOR UPDATE` 表级是 **`RowShareLock`**，不是 `ExclusiveLock`。活栈第一次 `LockAcquire(lockmode=7)` 是 **`XactLockTableInsert`**（自己的 xid），不是 `LOCKTAG_TUPLE`。
5. Fast path 只覆盖当前库、mode < `ShareUpdateExclusiveLock` 的关系锁。强锁会把别人的 fast-path 迁进共享哈希。

==============================================================================

## 四、摘录与真实栈

```c
/* lock.c:808 */
LockAcquireResult
LockAcquire(const LOCKTAG *locktag, LOCKMODE lockmode,
			bool sessionLock, bool dontWait)
{
	return LockAcquireExtended(locktag, lockmode, sessionLock, dontWait,
							   true, NULL, false);
}
```

活进程 `SELECT * FROM t_hint FOR UPDATE`：

```
LockAcquire (lockmode=7 ExclusiveLock) at lock.c:813
  ← XactLockTableInsert (xid=792)
  ← AssignTransactionId
  ← GetCurrentTransactionId
  ← heap_lock_tuple / heapam_tuple_lock
  ← ExecLockRows (nodeLockRows.c:185)
```

行锁不是只改 infomask：执行器 `ExecLockRows` 会给当前 xid 挂一把重量级事务锁。别人等这行时走 `XactLockTableWait`。

==============================================================================

## 五、实操

`LOCK TABLE t_mvcc IN ACCESS SHARE MODE` 时 `pg_locks` 见 `relation/AccessShareLock` + `virtualxid/ExclusiveLock`。

`DeadLockCheck` 本批未构造双会话死锁（函数已确认在 `deadlock.c:220`）。需要时用两行交叉 `UPDATE` 再 `gdb -p`。

==============================================================================

## 六、交接

实现正文已写在 `quant67-pg-kernel/06-lock-manager.md`：三层结构、LWLock `state` 位、fast path、`ProcSleep`/`DeadLockCheck`、行锁等 xid。

下一章按主链是 **07 事务 / 子事务 / 2PC**。`FOR UPDATE` 栈已经进了 `AssignTransactionId`；`pg_current_xact_id()` 会在 xid 仍为 0 时进入该函数。
