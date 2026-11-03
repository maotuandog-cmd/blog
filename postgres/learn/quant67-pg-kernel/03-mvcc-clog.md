# PostgreSQL 18.6 MVCC 实现（快照 / CLOG / hint bit / xid 环）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `03-mvcc-clog.txt`；本文写 **18.6 实现**。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path`。
> 前置：[[02-page-tuple]] 的 xmin/xmax/ctid/`t_infomask`；[[04-wal-internals]] 的 COMMIT：`XLogFlush` 之后才 `TransactionIdCommitTree`。
> 后续：[[06-lock-manager]]（行锁 vs 可见性）；[[07-transaction-subxact]]（cid / subxid / 2PC）；[[postgres/08-vacuum-freezing]]（freeze 真正改 xmin）。

==============================================================================

## 一句话

一行在不在快照里看得见，**不是**去 undo 里回溯，而是看堆上这个版本的 `xmin`/`xmax`，对照「拍照时哪些 xid 还在跑」。xid 本身只是号码；提交没提交记在 **CLOG**（每 xid 2 bit，SLRU，目录 `pg_xact/`）。第一次查完把结果 OR 进 `t_infomask`（hint bit），以后多数读不再碰 CLOG。hint **默认不记 WAL**；crash 丢了只是再查一次 CLOG，正确性靠 CLOG + 快照，不靠 hint。

==============================================================================

## 分层：快照 → 可见性 → CLOG → hint

```
GetSnapshotData()                    ProcArrayLock SHARED
  snapshot.xmin / xmax / xip[]       「当时还在跑的 xid」
        │
        ▼  每行
HeapTupleSatisfiesMVCC(htup, snapshot, buffer)
  1. 本事务？看 xmin + cmin vs curcid
  2. 还在跑？XidInMVCCSnapshot（先 xmin/xmax 范围，再搜 xip）
  3. 已结束？TransactionIdDidCommit → CLOG
  4. 第一次得出 COMMITTED/ABORTED → SetHintBits
        │
        ▼
CLOG  pg_xact/  每 xid 2 bit，8KB 页装 32768 个 xid
hint  t_infomask  HEAP_XMIN_COMMITTED 等，MarkBufferDirtyHint
```

和 InnoDB 的分界（只记一句）：PG 旧版本留在 **heap 页上**，靠 VACUUM 收；不是聚簇页只留最新行、历史进 undo。

==============================================================================

## 1. 快照里到底有什么

`SnapshotData`（`snapshot.h`），MVCC 类型是 `SNAPSHOT_MVCC`：

| 字段 | 含义 |
|---|---|
| `xmin` | **xid < xmin 都已结束**（对这个快照可见或已 abort，不必搜数组） |
| `xmax` | **xid ≥ xmax 当时还没结束**（当 in-progress） |
| `xip[]` / `xcnt` | `[xmin, xmax)` 里、拍照时仍在跑的 **顶层 xid**（不含自己） |
| `subxip[]` | 未溢出时的子事务 xid；`suboverflowed` 则要去 `pg_subtrans` 找父 |
| `curcid` | 本事务里，cid < curcid 的命令可见（当前命令自己插的行，这次扫描看不见） |
| `snapXactCompletionCount` | 用来复用快照，避免每次 SQL 都重扫 ProcArray |

规则（`snapshot.h` 原话）：能看见「拍照时已提交」+「本事务更早的命令」；看不见「快照里还在跑的」+「拍照后才开的」+「当前命令」。

`GetSnapshotData`（`procarray.c:2175`）**不是**课程写的 `GetOldestActiveTransactionId()` + `ReadNextFullTransactionId()`。

18.6 实际：

1. `LWLockAcquire(ProcArrayLock, LW_SHARED)`
2. `GetSnapshotDataReuse`：若 `TransamVariables->xactCompletionCount` 没变，快照内容不会变，只刷新 `MyProc->xmin` / `curcid` 就返回。
3. `xmax = latestCompletedXid + 1`
4. 顺序扫稠密数组 `ProcGlobal->xids[pgxactoff]`（`UINT32_ACCESS_ONCE`），跳过：无 xid、自己、`xid >= xmax`、logical decoding / lazy vacuum。
5. 收集进 `xip[]`，`xmin` 取这些 xid（含自己）里最小的。
6. 放锁，把 `xmin` 写进 `MyProc->xmin`（挡住 VACUUM 收还能被这个快照看见的行）。

**没有 `PGXACT`。** `PGPROC.xid` 镜像在 `ProcGlobal->xids[pgxactoff]`，子事务状态、statusFlags 同样是按 `pgxactoff` 对齐的稠密数组。这是 PG14 快照可扩展性留下的布局：持锁时顺序读热字段，不跳稀疏 `PGPROC`。

`XidInMVCCSnapshot`（`snapmgr.c`）：`xid < xmin` → 不在跑；`xid >= xmax` → 在跑；中间搜 `xip`/`subxip`。子事务溢出则 `SubTransGetTopmostTransaction` 再搜顶层。

可见性函数文件头写死一条竞态规则：**先**判断还在不在跑（MVCC 用快照，非 MVCC 用 `TransactionIdIsInProgress`），**再**查 CLOG。xact.c 是先写 CLOG 再清 `MyProc->xid`，所以存在「CLOG 已 committed、ProcArray 里还在」的窗口；如果先查 CLOG，会把快照仍视为 in-progress 的事务当成已提交，应用层会看到不一致。

==============================================================================

## 2. `HeapTupleSatisfiesMVCC`：一行怎么判

`heapam_visibility.c:960`，`static`。调用方必须 **pin + 至少共享 content lock**（hint 可能改页）。gdb 断这个符号最稳。

xmin 侧（插入者）：

```
没有 HEAP_XMIN_COMMITTED？
  HEAP_XMIN_INVALID → 看不见（插入者 abort / crash）
  xmin == 当前事务 → 看 cmin vs curcid；再看自己有没有删
  XidInMVCCSnapshot(xmin) → 看不见（别人还在跑）
  TransactionIdDidCommit(xmin) → SetHintBits(XMIN_COMMITTED)，继续看 xmax
  否则 → SetHintBits(XMIN_INVALID)，看不见
已经 COMMITTED 但未 frozen，且仍在快照 xip 里 → 仍当 in-progress（那条竞态）
```

xmax 侧（删除/更新者），插入者已提交之后：

```
HEAP_XMAX_INVALID 或 只是行锁（LOCKED_ONLY）→ 看得见
xmax 是当前事务 → 看 cmax vs curcid（本命令已删则看不见）
XidInMVCCSnapshot(xmax) → 看得见（删的人还没提交）
DidCommit(xmax) → SetHintBits(XMAX_COMMITTED)，看不见
否则 → SetHintBits(XMAX_INVALID)，看得见（删的人 abort 了）
```

`HEAP_XMIN_FROZEN` = `COMMITTED | INVALID` 两位都置上。frozen 的 xmin 对**任何**快照都算「很久以前已提交」，不再进 `XidInMVCCSnapshot`。这是 08 章 freeze 的落点；磁盘上也可能仍看到古老的 `xmin=2`。

活测：INSERT 提交后、第一次 SELECT 前 `t_infomask=2050=0x0802`（`HASVARWIDTH | XMAX_INVALID`），没有 `XMIN_COMMITTED`。`SELECT` 之后变成 `2306=0x0902`，多了 `0x0100`。只读查询弄脏了 buffer。两次 UPDATE 后 `ctid` 链：`(0,1) xmax=781 → (0,2) xmax=782 → (0,3)`。

==============================================================================

## 3. CLOG：2 bit × 32768 xid / 页

`clog.c`。**不是**大纲里写的「256 事务/8KB」。

```c
CLOG_BITS_PER_XACT  = 2
CLOG_XACTS_PER_BYTE = 4
CLOG_XACTS_PER_PAGE = BLCKSZ * 4   /* 8192*4 = 32768 */
```

| 值 | 宏 | 含义 |
|---|---|---|
| 0 | `TRANSACTION_STATUS_IN_PROGRESS` | 默认；crash 后没写成 committed 的也还是这个，当 abort |
| 1 | `COMMITTED` | 已提交 |
| 2 | `ABORTED` | 显式回滚 |
| 3 | `SUB_COMMITTED` | 子事务提交了、父事务还没有 |

定位：`pageno = xid / 32768`，页内 byte = `(xid % 32768) / 4`，再右移 2 bit。

磁盘：`$PGDATA/pg_xact/`（PG10 前叫 `pg_clog/`）。SLRU 每段 **32 页** → 256KB → 覆盖 **1,048,576** 个 xid。文件名 `0000`、`0001`… 段号。

共享缓冲：`SimpleLruInit(..., "pg_xact", ...)`，槽数由 GUC **`transaction_buffers`**（不是课程的 `clog_buffers`）。`0` 表示按 `shared_buffers` 自动：大约每 1GB shared 给 2MB CLOG 页，上限 8MB（`SimpleLruAutotuneBuffers(512, 1024)`）。本机 128MB shared → 约 32 个 8KB 槽。

读：`TransactionIdDidCommit` → `TransactionLogFetch` → `TransactionIdGetStatus` → `SimpleLruReadPage_ReadOnly`。`TransactionLogFetch` 有 **单条** 进程私有缓存；只缓存不会再变的 COMMITTED/ABORTED，不缓存 in-progress / sub-committed。永久 xid：`FrozenTransactionId(2)` / `Bootstrap(1)` 直接当 committed。

写：COMMIT 路径在 04 章——**WAL 里的 commit record 已经 flush 之后**才 `TransactionIdCommitTree` → `TransactionIdSetPageStatus`。CLOG 自己只在 **新页清零** 时写 WAL；状态位靠 xact redo 重放。异步提交会在 CLOG 页上记 group LSN，写出该页前还要把 WAL flush 到那个 LSN。并发提交可以 clog group update（`ProcGlobal->clogGroupFirst`），少抢几次 SLRU 锁。

checkpoint 时 `CheckPointCLOG()` 把脏 SLRU 页刷出；足够老的段（所有 xid 都小于冻结前沿）才能截断，否则 `pg_xact/` 会堆文件。

==============================================================================

## 4. Hint bit：缓存 CLOG，但有 LSN 闩

`SetHintBits`（inline，`heapam_visibility.c:114`）。导出符号是 `HeapTupleSetHintBits`。

```c
if (xid 有效) {          /* 正在标 COMMITTED 时 */
    commitLSN = TransactionIdGetCommitLSN(xid);
    if (永久缓冲 && WAL 还没 flush 到 commitLSN
        && 页 LSN < commitLSN)
        return;           /* 先不写 hint */
}
tuple->t_infomask |= infomask;
MarkBufferDirtyHint(buffer, true);
```

课程漏了这道闩：若 COMMIT WAL 还在 walwriter 手里，先把 `XMIN_COMMITTED` 写进可能被淘汰的页，crash 后页上有 hint、CLOG 却还是 in-progress，会把未提交行当成提交。所以 **commit LSN 没落盘就不写 committed hint**。abort/invalid 传的 xid 常常是 `InvalidTransactionId`，走不到这道检查。

`MarkBufferDirtyHint`（`bufmgr.c`）：

- 必须已 pin，共享或独占 content lock 均可（hint 允许共享锁下 OR，和 05 章规则 4 一致）。
- 已经 `BM_DIRTY|BM_JUST_DIRTIED` 则几乎空转。
- 默认 **不插 WAL**。`wal_log_hints=on` 或 checksum 时，checkpoint 后第一次 hint 可能打 FPW（防撕裂），这时 hint 才进复制流量。
- recovery 中：可以改内存里的 infomask，但 **不把页标脏**（备库默认 hint 赶出去就丢）。

后果：纯 SELECT 会 `shared_blks_dirtied`；第一次扫刚导入的大表会制造一波脏页。丢了只是下次再查 CLOG。

==============================================================================

## 5. 32 位 xid 环

`TransactionId` 是 `uint32`。比较用模半圈：离当前 xid 约 2³¹ 以内才分得清过去/未来。特殊值：0 invalid，1 bootstrap，2 frozen，正常从 3 起。

`SetTransactionIdLimit`（`varsup.c:372`）以 **各库 `datfrozenxid` 的最老值** 为原点（课程里 +5M/+5M 的阶梯对不上 18.6）：

| 阈值 | 怎么算 | 干什么 |
|---|---|---|
| `xidVacLimit` | oldest_frozen + `autovacuum_freeze_max_age`（默认 2 亿） | 强制 anti-wraparound VACUUM |
| `xidWarnLimit` | wrap − 4000 万 | 日志狂叫 |
| `xidStopLimit` | wrap − 300 万 | 拒绝新事务，只让 autovacuum 跑 |
| `xidWrapLimit` | oldest_frozen + 2³¹ | 再往前走就要分不清新旧，必须 freeze |

本机测试库 `age(datfrozenxid)≈39`，离 21 亿还很远。监控用 `age(datfrozenxid)` 和 `pg_xact/` 段文件个数（每段约 100 万 xid）。细节和 VACUUM freeze 进 08 章。

==============================================================================

## gdb

附加 backend。hint 在 inline 里，断：

```
break HeapTupleSatisfiesMVCC
break GetSnapshotData
break TransactionIdDidCommit
break TransactionIdGetStatus
break HeapTupleSetHintBits
```

`HeapTupleSatisfiesMVCC` 停住：

```
p snapshot->xmin
p snapshot->xmax
p snapshot->xcnt
p snapshot->curcid
p htup->t_data->t_choice.t_heap.t_xmin
p htup->t_data->t_infomask
```

第一次 SELECT 应看到 infomask 从 `0x0802` 变成带 `0x0100`。`buffer` 活测是小整数（如 3），`BufferGetPage` 后可 `pgpage`。

`GetSnapshotData` 里：

```
p ProcGlobal->xids[0]@10
p procArray->numProcs
p TransamVariables->xactCompletionCount
```

不要 follow-fork。catalog 扫描也会进 `HeapTupleSatisfiesMVCC`，用表 oid / relfilenode 过滤。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `HeapTupleSatisfiesMVCC` / `SetHintBits` | `src/backend/access/heap/heapam_visibility.c` |
| hint 宏 / frozen | `src/include/access/htup_details.h` |
| `SnapshotData` | `src/include/utils/snapshot.h` |
| `GetSnapshotData` / `GetSnapshotDataReuse` | `src/backend/storage/ipc/procarray.c` |
| `ProcGlobal->xids` | `src/include/storage/proc.h` |
| `XidInMVCCSnapshot` | `src/backend/utils/time/snapmgr.c` |
| CLOG 2bit / SLRU | `src/backend/access/transam/clog.c` |
| 状态常量 | `src/include/access/clog.h` |
| `TransactionIdDidCommit` / `TransactionLogFetch` | `src/backend/access/transam/transam.c` |
| `MarkBufferDirtyHint` | `src/backend/storage/buffer/bufmgr.c` |
| xid 环阈值 | `src/backend/access/transam/varsup.c` |
| SLRU 框架 / 段 32 页 | `src/backend/access/transam/slru.c`、`src/include/access/slru.h` |
| 可见性 vs CLOG 竞态 | `heapam_visibility.c` 文件头注释 |

==============================================================================

## 和前后章的关系

- [[02-page-tuple]]：xmin/xmax/ctid 在页上；可见性读的就是那些字段。
- [[04-wal-internals]]：同步提交必须 WAL flush 完才写 CLOG；否则 hint 闩也会拒绝写 `XMIN_COMMITTED`。
- [[05-buffer-manager]]：hint 用共享 content lock + `MarkBufferDirtyHint`；淘汰脏页仍走 WAL 规则。
- [[01-process-shmem]]：快照扫的是共享 `ProcGlobal`，不是每进程一份 CLOG。
- [[07-transaction-subxact]]：`curcid`、`subxip` 溢出、`SUB_COMMITTED`。
- [[postgres/08-vacuum-freezing]]：谁把 infomask 写成 `HEAP_XMIN_FROZEN`，以及 wraparound VACUUM。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch03-mvcc-clog.md`
