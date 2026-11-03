# PostgreSQL 18.6 事务实现（状态机 / 懒分配 xid / Savepoint / 2PC）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `07-transaction-subxact.txt`；本文写 **18.6 实现**。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path`。本机 `max_prepared_transactions=0`（2PC 关着，改了要重启）。
> 前置：[[06-lock-manager]] 的 `XactLockTableInsert`；[[03-mvcc-clog]] 的快照只扫已分配 xid 的进程；[[04-wal-internals]] 的 COMMIT WAL。
> 后续：[[postgres/08-vacuum-freezing]]（`relfrozenxid` / wraparound VACUUM）。

==============================================================================

## 一句话

`BEGIN` 只建本地 `TransactionState`、挂 **virtual xid**；堆上的 32 位 xid 要等到第一次写（或 `pg_current_xact_id()`）才 `GetNewTransactionId`。SAVEPOINT 是同一根栈上再压一层，**不**立刻分配全局 xid。真正提交是 `RecordTransactionCommit`：先 WAL，再（同步时）`XLogFlush`，然后才写 CLOG。2PC 把同一份状态打进 `XLOG_XACT_PREPARE`，锁和「还在跑」的身份交给一把 **dummy PGPROC**。

==============================================================================

## 分层

```
TBlockState     SQL 看见的 BEGIN / 语句 / COMMIT / SAVEPOINT / PREPARE
        │
        ▼
TransState      内核生命周期：DEFAULT → START → INPROGRESS → COMMIT/ABORT/PREPARE
        │  INPROGRESS ≠ 已有 xid（课程在这里写错了）
        ▼
TransactionState 栈    TopTransactionStateData ← parent ← 当前 savepoint
        │  FullTransactionId、ResourceOwner、MemoryContext、childXids
        ▼
xid / cid / subxid
  GetNewTransactionId → MyProc->xid + ProcGlobal->xids[]
  CommandId 整笔事务共用；SAVEPOINT 另有 SubTransactionId 计数器
  子事务全局 xid 进 pg_subtrans + PGPROC.subxids（最多缓存 64）
```

两条状态机叠在一起：`TransState` 管「内核事务活没活」；`TBlockState` 管「客户端是不是还在一个 BEGIN 块里」。单条 SQL 的隐式事务走 `TBLOCK_STARTED` → 语句结束 `CommitTransaction`。显式 `BEGIN` 只是把 `TBLOCK_STARTED` 改成 `TBLOCK_BEGIN`，`CommitTransactionCommand` 再改成 `TBLOCK_INPROGRESS`，**不提交**。

==============================================================================

## 1. `StartTransaction`：还没有 xid

`StartTransaction`（`xact.c:2064`）是 `static` 的。活测断在 `:2072`。

1. 断言停在 `TopTransactionStateData`，`state == TRANS_DEFAULT`。
2. 立刻 `TRANS_START`，`fullTransactionId = Invalid`。
3. `nestingLevel = 1`，`currentCommandId = FirstCommandId`（0）。
4. `AtStart_Memory` / `AtStart_ResourceOwner`。
5. `GetNextLocalTransactionId` 拼 **virtual xid**，`VirtualXactLockTableInsert`，写入 `MyProc->vxid`。这就是 `pg_locks` 里每笔事务都有的 `virtualxid/ExclusiveLock`。
6. 子系统：`AtStart_GUC`、cache、after trigger。
7. **`s->state = TRANS_INPROGRESS`** —— 此时 `MyProc->xid` 仍可以是 0。

`AssignTransactionId` 一进来就 `Assert(s->state == TRANS_INPROGRESS)`。所以课程把 `TRANS_INPROGRESS` 解释成「已经分配 XID」是错的。纯 SELECT 长事务可以一直 `INPROGRESS` 且 `xid=0`：不进快照的 `xip[]`，不挡 VACUUM 的 OldestXmin（挡的是它持有的 **snapshot xmin**，那是另一件事）。

`TransactionStateData`（`xact.c:193`）关键字段：`FullTransactionId`（不是课程里的 `TransactionId transactionId`）、`subTransactionId`、`name`、`TransState` + **`TBlockState`**、`nestingLevel`、`curTransactionContext` / `curTransactionOwner`、`childXids[]`、`parent`。空闲时 `CurrentTransactionState` 就指向静态的 `TopTransactionStateData`。

==============================================================================

## 2. 懒分配：`AssignTransactionId`

入口：`GetCurrentTransactionId` / `GetTopFullTransactionId`。堆 insert/update、`FOR UPDATE`（06 章栈）、`pg_current_xact_id()` 都会进来。

**不要用 `pg_current_xact_id()` 观察「纯读有没有 xid」** —— 它内部 `GetTopFullTransactionId()`，没有就分配。看未分配用 `pg_current_xact_id_if_assigned()`（NULL）。`txid_current()` 同样会分配。

```
AssignTransactionId(s)
  若是子事务且父还没 xid → 先给祖先从外到内分配（子 xid 必须大于父）
  s->fullTransactionId = GetNewTransactionId(isSubXact)
  子事务：SubTransSetParent(xid, parent_xid)     /* pg_subtrans */
  顶层：RegisterPredicateLockingXid
  XactLockTableInsert(xid)                        /* 06 章 ExclusiveLock */
```

`GetNewTransactionId`（`varsup.c:77`）：

1. `LWLockAcquire(XidGenLock, EXCLUSIVE)`。
2. 取 `TransamVariables->nextXid`（**不是**课程的 `ShmemVariableCache`；类型是 `FullTransactionId` = epoch + 32 位 xid）。
3. 过 `xidVacLimit` 就隔 64K 喊一次 autovac launcher；过 `xidStopLimit` 且在 postmaster 下 → `ERROR` 拒绝分配。
4. `ExtendCLOG` / `ExtendCommitTs` / `ExtendSUBTRANS` 后再 `FullTransactionIdAdvance`。
5. **顶层**：`MyProc->xid = xid` 且 `ProcGlobal->xids[pgxactoff] = xid`（不是 `ProcArrayAdd`）。
6. **子事务**：塞进 `MyProc->subxids.xids[]`；满 64（`PGPROC_MAX_CACHED_SUBXIDS`）则 `overflowed=true`，别人看运行中子 xid 要走 `pg_subtrans`。

`FullTransactionId` 对外是 xid8（`pg_current_xact_id` 返回它）。堆元组头仍只存 32 位 xid；epoch 在 `pg_control` / `TransamVariables`。

### wraparound 四条线（和 03 章同一套，课程 07 的百分比公式作废）

`SetTransactionIdLimit`（`varsup.c:372`）：

| 限 | 公式 | 行为 |
|---|---|---|
| `xidWrapLimit` | `oldest_datfrozenxid + 2³¹` | 再往前比较会翻半环 |
| `xidStopLimit` | wrap − 3 000 000 | 拒绝分配新 xid（单用户模式可逃） |
| `xidWarnLimit` | wrap − 40 000 000 | WARNING |
| `xidVacLimit` | oldest + `autovacuum_freeze_max_age`（默认 2 亿） | 催 autovacuum |

**不是** `oldest + freeze_max_age × 0.95/0.975/0.99`。stop 时拒绝的是 **分配新 xid 的命令**，不是「除 superuser 外谁都不能连」。

==============================================================================

## 3. `TBlockState` 与 CommandId

| 状态 | 含义 |
|---|---|
| `TBLOCK_DEFAULT` | 空闲 |
| `TBLOCK_STARTED` | 隐式单语句事务已 `StartTransaction` |
| `TBLOCK_BEGIN` | 刚执行完 `BEGIN`，本条命令结束不提交 |
| `TBLOCK_INPROGRESS` | 显式事务块 |
| `TBLOCK_END` / `ABORT_PENDING` / `PREPARE` | 收到 COMMIT / ROLLBACK / PREPARE，等 `CommitTransactionCommand` 落地 |
| `TBLOCK_SUBBEGIN` → `SUBINPROGRESS` | SAVEPOINT 压栈后 |
| `TBLOCK_SUBRESTART` | `ROLLBACK TO` |

每条语句结束：`TBLOCK_INPROGRESS` / `SUBINPROGRESS` 只 `CommandCounterIncrement()`。cid 是 **整笔顶层事务共用** 的 32 位计数，不跟子事务走。`GetCurrentCommandId(used=true)` 才把这一档标成「写过」；没用过就不加，避免只读语句耗尽 2³²−2。可见性里本事务的行靠 `cmin/cmax` vs `snapshot.curcid`（03 章）。

==============================================================================

## 4. Savepoint：栈，不是立刻拿全局 xid

`DefineSavepoint`（`xact.c:4373`）**只** `PushTransaction()`：在 `TopTransactionContext` 里 `palloc` 一个节点，`fullTransactionId = Invalid`，`subTransactionId = ++currentSubTransactionId`（这是子事务计数，**不是** `TransactionId`），`blockState = TBLOCK_SUBBEGIN`。语句结束才 `StartSubTransaction`：独立 MemoryContext + ResourceOwner，`state = TRANS_INPROGRESS`，仍可能没有全局 xid。

活测：`BEGIN; SELECT pg_current_xact_id(); SAVEPOINT s1;` 顶层 xid 不变。子事务第一次写才会 `AssignTransactionId`，并保证祖先先有 xid。

`ROLLBACK TO`：从栈顶 `AbortSubTransaction` + `PopTransaction` 直到目标层；释放该层 ResourceOwner（buffer pin、该层拿到的锁、内存），父层资源留下。然后目标层回到 `TBLOCK_SUBINPROGRESS` / `INPROGRESS`，**整笔事务继续**。

`RELEASE`：`CommitSubTransaction`。子事务若已有全局 xid：`XactLockTableDelete`（子 xid 锁丢掉），xid 并进父的 `childXids[]`；**不**在此时写 CLOG 的 subcommit（8.4 之后整棵树在顶层 commit/abort 一次性 `TransactionIdCommitTree`）。重量级锁通过 ResourceOwner 迁到父。

PL/pgSQL 每个 `BEGIN … EXCEPTION` 是隐式 savepoint。循环里吞异常会把栈和 `subxids` 缓存打满，溢出后可见性打 `pg_subtrans`。硬顶是 `2³²−1` 个子事务 id。

`ResourceOwner` 在 18.6 对外部是不透明指针（`resowner.h`），实现在 `resowner.c`。释放分三阶段：`BEFORE_LOCKS` / `LOCKS` / `AFTER_LOCKS`。

==============================================================================

## 5. 提交

`CommitTransaction`（`xact.c:2228`）：触发器、portal、`XACT_EVENT_PRE_COMMIT` → `HOLD_INTERRUPTS` → `TRANS_COMMIT` → `RecordTransactionCommit`。

有 xid 时：

1. `DELAY_CHKPT_START`（防 checkpoint redo 点插在 COMMIT WAL 和 CLOG 之间）。
2. `XactLogCommitRecord`（含子 xid 列表、inval、删文件）。
3. 默认同步：`XLogFlush(XactLastRecEnd)`，然后 `TransactionIdCommitTree` 写 CLOG（04/03 章顺序）。
4. `synchronous_commit=off` 且没有强制同步 / 非临时删文件：CLOG 推迟到 WAL 真正刷完（async commit）。

没有 xid：不写 COMMIT 记录。若只有 inval，打一条 standby inval。随后 `ProcArrayEndTransaction` 清 `MyProc->xid`，`LockReleaseAll`，拆 MemoryContext。

==============================================================================

## 6. 2PC

本机 `max_prepared_transactions=0`（`PGC_POSTMASTER`），`PREPARE TRANSACTION` 直接报错，改完必须重启。共享内存按这个数预留 dummy `PGPROC` + `GlobalTransactionData`。

`PrepareTransaction`：

1. `GetCurrentTransactionId()`（没有 xid 也要分配，空事务也能 PREPARE）。
2. 碰过临时对象 / `pg_export_snapshot` → 拒绝。
3. `TRANS_PREPARE`，`MarkAsPreparing` 占 GID + dummy PGPROC。
4. `StartPrepare` + 各 `AtPrepare_*`（锁、predicate、notify…）拼状态。
5. `EndPrepare`：`XLogInsert(RM_XACT_ID, XLOG_XACT_PREPARE)` + `XLogFlush`。**常见路径只写 WAL**，`gxact->prepare_start_lsn` 指向这条记录。
6. `MarkAsPrepared` 把 dummy 插进 ProcArray（xid 暂时在 MyProc 和 dummy 上各出现一次，窗口是故意的）。
7. `PostPrepare_Locks`：**锁迁到 dummy PGPROC**，不是课程说的「PREPARE 后锁表里没有锁」。
8. `ProcArrayClearTransaction(MyProc)`，原 backend 回到空闲，事务仍算 running。

`pg_twophase/` 文件名是 **epoch+xid 的 `%08X%08X`**，不是 GID 的 hash。checkpoint 才把还没决议的 prepare 从 WAL 拷到文件（`ondisk`）。`COMMIT PREPARED` 前若没经过 checkpoint，直接从 WAL 读回。

头就是 `xl_xact_prepare`（`twophase.c` 里 `typedef` 成 `TwoPhaseFileHeader`）：magic `0x57F94534`、xid、database、owner、子 xid 数、GID 长度，后面跟子 xid 数组、删文件列表、inval、各 rmgr 的 `TwoPhaseRecordOnDisk`。

重启：`RecoverPreparedTransactions` 扫 WAL/文件，重建 dummy PGPROC 和锁。泄露的 prepared xact 占 slot、占 xid 年龄、占锁 —— `pg_prepared_xacts`。决议：`COMMIT PREPARED` / `ROLLBACK PREPARED`（不必是原 session）。

==============================================================================

## gdb

附加 backend，不要 follow-fork。

```
break StartTransaction
break AssignTransactionId
break GetNewTransactionId
break CommitTransaction
break RecordTransactionCommit
break DefineSavepoint
break PushTransaction
break PrepareTransaction
```

`AssignTransactionId` 入口（活测 `pg_current_xact_id`）：

```
p s
p *s                  /* fullTransactionId 仍 invalid；state 已是 INPROGRESS */
p MyProc->xid         /* 0 */
p MyProc->xmin
p CurrentTransactionState->nestingLevel
p CurrentTransactionState->blockState
p CurrentTransactionState->name
```

栈：`AssignTransactionId` ← `GetTopFullTransactionId` ← `pg_current_xact_id`。`FOR UPDATE` 则是 ← `XactLockTableInsert` 路径上的 `GetCurrentTransactionId`。

看纯读：`SELECT pg_current_xact_id_if_assigned();` 应为 NULL，`pg_stat_activity.backend_xid` 为空，`backend_xmin` 可能已有。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `TransState` / `TBlockState` / `TransactionStateData` | `src/backend/access/transam/xact.c` |
| `StartTransaction` / `CommitTransaction` / `AssignTransactionId` | 同上 |
| `RecordTransactionCommit` | `xact.c:1307` |
| `DefineSavepoint` / `PushTransaction` / `CommitSubTransaction` | `xact.c` |
| `GetNewTransactionId` / `SetTransactionIdLimit` | `src/backend/access/transam/varsup.c` |
| `TransamVariables` | `src/include/access/transam.h` |
| `pg_subtrans` | `src/backend/access/transam/subtrans.c` |
| 2PC / dummy PGPROC | `src/backend/access/transam/twophase.c` |
| `xl_xact_prepare` | `src/include/access/xact.h` |
| `pg_current_xact_id` | `src/backend/utils/adt/xid8funcs.c` |
| `PGPROC_MAX_CACHED_SUBXIDS` | `src/include/storage/proc.h` |
| ResourceOwner | `src/include/utils/resowner.h`、`src/backend/utils/resowner/` |

==============================================================================

## 和前后章的关系

- [[06-lock-manager]]：分配 xid 时挂事务锁；PREPARE 把锁交给 dummy PGPROC。
- [[03-mvcc-clog]]：无 xid 的事务不在 `ProcGlobal->xids`；cid 决定本事务语句间可见性；CLOG 在 COMMIT WAL flush 之后。
- [[04-wal-internals]]：`XactLogCommitRecord` / `XLOG_XACT_PREPARE`；`DELAY_CHKPT_START`。
- [[postgres/08-vacuum-freezing]]：`xidVacLimit` 催 freeze；长事务的 **xmin**（即使自己还没 xid）挡住回收。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch07-transaction-subxact.md`
