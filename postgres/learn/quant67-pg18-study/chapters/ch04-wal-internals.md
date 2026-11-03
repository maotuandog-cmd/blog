# 第 04 章 对照笔记 — WAL 内部机制 (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/04-wal-internals.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/04-wal-internals.md`
> 证据: `evidence/ch04-wal-internals-evidence.txt` + `evidence/ch04-gdb-attach-xlog.txt`

==============================================================================

## 一、课程要点（节选）

> COMMIT 返回前必须先把 WAL 刷盘，数据页可以稍后写。`XLogInsert()` 组装 record，占插入锁，写入 WAL buffer；WalWriter / `wal_sync_method` 决定如何进 segment。Checkpoint 两阶段：确定 redo 起点，再写 checkpoint record。`checkpoint_completion_target` 用来摊平刷脏页 IO。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| XLogBeginInsert / XLogInsert | `xloginsert.c:149` / `:474` | 先注册，再 assemble + insert |
| XLogRecordAssemble | `xloginsert.c:547` | FPW：`PageGetLSN <= RedoRecPtr` |
| XLogInsertRecord | `xlog.c:748` | 占位 + 拷贝；Redo 变了返回 Invalid 重来 |
| ReserveXLogInsertLocation | `xlog.c:1111` | `insertpos_lck` + `CurrBytePos`（不含页头） |
| WALInsertLocks | `xlog.c:151` / `:570` | **8 把**，不是单个 `WALInsertLock` 宏 |
| WALWriteLock | `lwlocknames.h` → `MainLWLockArray[8]` | write + fsync；group commit |
| XLogFlush | `xlog.c:2780` | `WaitXLogInsertionsToFinish` 再抢写锁 |
| CreateCheckPoint | `xlog.c:6929` | 在线先 `XLOG_CHECKPOINT_REDO` |
| CheckPointGuts | `xlog.c:7552` | SLRU + `CheckPointBuffers` + fsync |
| CheckpointWriteDelay | `checkpointer.c:772` | 摊平；`CHECKPOINT_IMMEDIATE` 不睡 |
| RecordTransactionCommit | `xact.c:1502` | 同步提交 `XLogFlush(XactLastRecEnd)` |

rmgr：本机用户 INSERT 命中 `rmid=10`（Heap）。

==============================================================================

## 三、PG18 vs 课程（必须记住）

1. **没有**全局 `WALInsertLock` 宏；插入锁是 `WALInsertLocks[NUM_XLOGINSERT_LOCKS]`（8）。
2. 在线 checkpoint 的 redo 点是 **`XLOG_CHECKPOINT_REDO` 这条 record 的起始 LSN**，不是「扫缓冲找最老脏页 LSN」。
3. `ReserveXLogInsertLocation` 在 `xlog.c`，用「可用字节」`CurrBytePos`，不是直接加 LSN。
4. `CheckpointWriteDelay` 在 `checkpointer.c`，由 `BufferSync` 每写一页调用。
5. `pg_stat_checkpointer`：无 `bytes_written`，有 `slru_written` / `num_done`。不要再从 `pg_stat_bgwriter` 读 `checkpoints_timed`。
6. `--single` 里 `CHECKPOINT` 栈是 `PostgresSingleUserMain` → `CreateCheckPoint`；多进程里 SQL 通知 **checkpointer 进程**。
7. 本机 `wal_sync_method=fdatasync`，`wal_level=replica`。

==============================================================================

## 四、实操（已跑）

SQL：`pg_current_wal_lsn` 在 `000000010000000000000001`；手动 CHECKPOINT 后 `num_requested=1, num_done=1, buffers_written=178, slru_written=3`。

`--single`：建表过程中 `XLogInsert` 先后为 `rmid=0`（XLOG/OID）、`rmid=8`（Standby 锁）、`rmid=2`（Storage 建文件）；`CreateCheckPoint flags=44`。

**活进程 attach**（backend 24515，`INSERT INTO t_gdb`）：

```
XLogInsert (rmid=10 Heap, info=0) at xloginsert.c:475
  ← … ExecProcNode / ExecutePlan / standard_ExecutorRun
MyProc->pid=24515  xid=778  xmin=778
```

这是用户 INSERT 的执行器路径，比 catalog 插入更接近课程场景。

==============================================================================

## 五、交接

批次 1（01 / 02 / 05 / 04）实现稿已齐：`00-startup-postmaster.md`、`02-page-tuple.md`、`05-buffer-manager.md`、`04-wal-internals.md`。

下一章按主链是 **03 MVCC**（COMMIT 之后 CLOG / hint bit / 快照）。活进程可直接 `gdb -p` + `HeapTupleSatisfiesMVCC`。
