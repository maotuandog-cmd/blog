# 第 03 章 对照笔记 — MVCC：CLOG / hint bit / 快照 (PG18.6)

> 课程原文: `quant67-pg-kernel/03-mvcc-clog.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/03-mvcc-clog.md`
> 证据: `evidence/ch03-mvcc-clog-evidence.txt` + `evidence/ch03-gdb-mvcc.txt`

==============================================================================

## 一、课程要点（节选）

> xmin/xmax 只是事务号，提交与否看 CLOG（每 xid 2 bit，SLRU）。第一次判定后把结果写进 `t_infomask`（hint bit），后续读跳过 CLOG。`GetSnapshotData()` 扫活跃 xid；PG14 起用稠密 `ProcGlobal->xids`，**PGXACT 已删除**。32 位 xid 半圆比较带来 wraparound，必须 freeze。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| CLOG 2bit / 页容量 | `clog.c:62-64` | `CLOG_XACTS_PER_PAGE = BLCKSZ*4 = 32768`（不是 256） |
| `transaction_buffers` | `clog.c:768` | CLOG SLRU 槽数；0 则按 shared_buffers 自动 |
| TransactionIdGetStatus | `clog.c:735` | `SimpleLruReadPage_ReadOnly` |
| TransactionIdDidCommit | `transam.c:126` | 先 `TransactionLogFetch`（单条缓存） |
| GetSnapshotData | `procarray.c:2175` | `xmax=latestCompletedXid+1`，扫 `ProcGlobal->xids` |
| GetSnapshotDataReuse | `procarray.c:2095` | `xactCompletionCount` 未变则复用 |
| XidInMVCCSnapshot | `snapmgr.c:1870` | 先 xmin/xmax 范围，再搜 xip |
| HeapTupleSatisfiesMVCC | `heapam_visibility.c:960` | `static`；先快照后 CLOG |
| SetHintBits | `heapam_visibility.c:114` | commit LSN 未 flush 则不写 committed hint |
| SetTransactionIdLimit | `varsup.c:372` | wrap=oldest+2³¹；stop=wrap−3M；warn=wrap−40M |

==============================================================================

## 三、PG18 vs 课程

1. 一页 CLOG **32768** 个 xid，不是 256。段文件 32×8KB=256KB ≈ 104 万 xid。
2. 没有 `clog_buffers`；GUC 是 `transaction_buffers`。
3. `GetSnapshotData` 不是 `GetOldestActiveTransactionId` + `ReadNextFullTransactionId`。
4. **没有 PGXACT**。
5. `SetHintBits` 写 `XMIN_COMMITTED` 前要等该 xid 的 commit WAL 已 flush（LSN 闩）。hint 默认仍不记 WAL。
6. wraparound 阶梯不是 +5M/+5M；见上表。
7. 必须先 `XidInMVCCSnapshot` 再 `TransactionIdDidCommit`（CLOG 与 ProcArray 窗口）。

==============================================================================

## 四、实操（已跑）

INSERT 提交后、第一次 SELECT 前：`t_infomask=2050=0x0802`（`HASVARWIDTH|XMAX_INVALID`），`xmin_committed=f`。

`SELECT * FROM t_hint` 之后：`2306=0x0902`，多了 `HEAP_XMIN_COMMITTED(0x0100)`。只读查询写 hint、弄脏 buffer。

两次 UPDATE 后版本链：`lp1 xmax=781 ctid=(0,2)` → `lp2 xmax=782 ctid=(0,3)` → `lp3` 当前行。

GDB：`HeapTupleSatisfiesMVCC` 停在 `heapam_visibility.c:963`，`buffer=3`。

`age(datfrozenxid)` 本测试库约 39，远离 wraparound。

==============================================================================

## 五、交接

实现正文已写在 `quant67-pg-kernel/03-mvcc-clog.md`。

主链下一批：锁管理器（06）→ 事务/子事务（07）→ VACUUM/freeze（08）。`FOR UPDATE` 会走 `LockAcquire`；快照路径仍会拿 `ProcArrayLock`（LWLock）。
