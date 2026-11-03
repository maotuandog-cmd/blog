# 第 07 章 对照笔记 — 事务 / 子事务 / 2PC (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/07-transaction-subxact.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/07-transaction-subxact.md`
> 证据: `evidence/ch07-transaction-subxact-evidence.txt` + `evidence/ch07-gdb-xact.txt` + `evidence/ch07-gdb-assign.txt`

==============================================================================

## 一、课程要点（节选）

> `TransState` 状态机；savepoint 是 `TransactionState` 栈。真正分配 xid 往往推迟到第一次写（或 `txid_current` / `pg_current_xact_id`）。2PC 写 WAL + `pg_twophase` 文件。`xidStopLimit` / `xidWrapLimit` 防回卷。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| `TransState` / `TBlockState` | `xact.c:141` / `:157` | 两套状态机；INPROGRESS ≠ 已有 xid |
| `TransactionStateData` | `xact.c:193` | `FullTransactionId` + `parent` + `childXids` |
| `StartTransaction` | `xact.c:2064` | `static`；先 vxid，结束时 `TRANS_INPROGRESS` |
| `AssignTransactionId` | `xact.c:635` | `static`；入口 `MyProc->xid` 仍可为 0 |
| `GetNewTransactionId` | `varsup.c:77` | `TransamVariables->nextXid`；写 `ProcGlobal->xids[]` |
| `SetTransactionIdLimit` | `varsup.c:372` | wrap = oldest+2³¹；stop = wrap−3M |
| `GetTopFullTransactionId` | `xact.c:486` | `pg_current_xact_id` 调用链 |
| `CommandCounterIncrement` | `xact.c:1100` | 整笔事务共用 cid |
| `DefineSavepoint` / `PushTransaction` | `xact.c:4373` / `:5416` | 压栈；**不**分配全局 xid |
| `CommitSubTransaction` | `xact.c:5104` | 子 xid 并入 `childXids`；CLOG 留到顶层 |
| `RecordTransactionCommit` | `xact.c:1307` | WAL → flush → CLOG |
| `PrepareTransaction` / `EndPrepare` | `xact.c:2515` / `twophase.c:1143` | dummy PGPROC + 锁迁移 |
| `xl_xact_prepare` | `xact.h:352` | 即 `TwoPhaseFileHeader` |
| `PGPROC_MAX_CACHED_SUBXIDS` | `proc.h:39` | 64 |

==============================================================================

## 三、PG18 vs 课程

1. **`TRANS_INPROGRESS` 不表示已分配 xid。** `StartTransaction` 结束就把 state 设成它；`AssignTransactionId` 还 `Assert` 当前已是 `INPROGRESS`。真正管 SQL 块的是 `TBlockState`。
2. 结构体字段是 `fullTransactionId`，不是 `transactionId`。全局计数在 **`TransamVariables`**，不是 `ShmemVariableCache`。`nextXid` 是 `FullTransactionId`。
3. `GetNewTransactionId` 写 `MyProc->xid` + `ProcGlobal->xids[pgxactoff]`，**不是** `ProcArrayAdd`。
4. `DefineSavepoint` **不**调用 `GetCurrentTransactionId`。SAVEPOINT 只分配 `SubTransactionId` 计数器。
5. wraparound：**wrap = oldest + 2³¹**，warn = wrap−40M，stop = wrap−3M，vac = oldest + `autovacuum_freeze_max_age`。课程按 freeze_max_age 百分比推四条线是错的（03 章已纠正）。
6. 2PC：锁迁到 **dummy PGPROC**，事务仍算 running。状态文件名是 `epoch+xid` 的 16 位十六进制，不是 GID hash。默认 **只写 WAL**，checkpoint 才落 `pg_twophase/`。
7. `pg_current_xact_id()` / `txid_current()` **会分配 xid**。观察纯读用 `pg_current_xact_id_if_assigned()`。
8. `ResourceOwner` 对外不透明；课程里那份资源类型列表在 18.6 的 `resowner.h` 里已经看不见。

==============================================================================

## 四、摘录与栈

```c
/* xact.c:2064 */
static void
StartTransaction(void)
{
	s = &TopTransactionStateData;
	Assert(s->state == TRANS_DEFAULT);
	s->state = TRANS_START;
	s->fullTransactionId = InvalidFullTransactionId;	/* until assigned */
	/* ... vxid, ResourceOwner ... */
	s->state = TRANS_INPROGRESS;
}
```

活进程 `SELECT pg_current_xact_id()`：

```
AssignTransactionId (s=&TopTransactionStateData) at xact.c:636
  ← GetTopFullTransactionId (xact.c:486)
  ← pg_current_xact_id (xid8funcs.c:344)
  ← ExecInterpExpr
MyProc->pid=<backend>  xid=0（函数入口，尚未写入 PGPROC）  xmin 已有快照值
```

`StartTransaction` 命中 `xact.c:2072`。`BEGIN; SELECT pg_current_xact_id(); SAVEPOINT s1;` 顶层 xid 不变。

==============================================================================

## 五、实操

`BEGIN` 后 `backend_xid` 仍空，直到写或 `pg_current_xact_id()`。

**2PC 本实例关着**：`max_prepared_transactions=0`，`PREPARE TRANSACTION` 报错且提示需非零并 **重启**。测试集群未改该 GUC。

==============================================================================

## 六、交接

实现正文已写在 `quant67-pg-kernel/07-transaction-subxact.md`：两套状态机、懒分配、cid、savepoint 栈、COMMIT 顺序、2PC dummy PGPROC。

下一章按主链是 **08 VACUUM / freezing**。本机 `VACUUM VERBOSE t_vac` 已看到 `tuples: 1000 removed` 与 `new relfrozenxid`。
