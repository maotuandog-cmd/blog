# PostgreSQL 18.6 WAL 实现（插入 / 刷盘 / Checkpoint / 和缓冲的交界）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `04-wal-internals.txt`（以 PG17 为主线）；本文写 **18.6 实现**，不照抄课程。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3 --enable-debug --enable-cassert`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path /opt/pg-src/postgresql-18.6 /opt/postgresql-18.6`。
> 前置：[[05-buffer-manager]] 的 `FlushBuffer` 对永久页先 `XLogFlush(pd_lsn)`；[[02-page-tuple]] 的 `heap_insert` 在临界区里 `XLogInsert` 再 `PageSetLSN`。
> 后续：[[00-startup-postmaster]] 的 `StartupXLOG` 从 checkpoint 的 redo 点重放；[[03-mvcc-clog]] 讲 COMMIT 之后怎么记 CLOG。

==============================================================================

## 一句话

COMMIT 返回前，对应 WAL 必须已经 **flush 到磁盘**；heap/index 页可以晚写。一条 record 的路径是：访问方法 `XLogBeginInsert` 注册 buffer/data → `XLogRecordAssemble` 决定要不要整页镜像（FPW）→ 抢一把 **插入锁**（8 把之一）→ `insertpos_lck` 上切一段 LSN → 拷进 WAL buffer → 释放插入锁。真正 `write`/`fsync` 走 `WALWriteLock`：同步提交由 backend 的 `XLogFlush` 完成，walwriter 只保证异步提交在有界时间内落盘。

==============================================================================

## 分层：LSN → WAL 页 → segment 文件 → 数据页

```
XLogRecPtr (uint64 LSN)                 字节位置，0 非法
        │
        ▼  按 XLOG_BLCKSZ（通常 = BLCKSZ = 8KB）切
WAL 页   短页头 SizeOfXLogShortPHD / 段首长页头 SizeOfXLogLongPHD
        │  record 从 MAXALIGN 边界起
        ▼  wal_segment_size（默认 16MB）
pg_wal/000000010000000000000001
        │
        ▼  共享内存
XLogCtl → WAL buffers（GUC wal_buffers，本机 512×8KB=4MB）
        WALInsertLocks[8]   谁正在往哪一段拷
        insertpos_lck       CurrBytePos（只计「可用字节」，不含页头）
        WALWriteLock        write + fsync
        LogwrtResult.Write / Flush
```

和 05 章的交界：数据页上的 `pd_lsn` =「改过这一页的最后一条 WAL 的结束 LSN」。`FlushBuffer` 必须先把 WAL flush 到这个 LSN，才能 `smgrwrite`。crash 后 redo：若页上 LSN ≥ 当前 record LSN，这条已经反映在页上，跳过。

本机：`wal_level=replica`，`wal_sync_method=fdatasync`，`wal_buffers=512`（8kB），`full_page_writes=on`。

==============================================================================

## 1. Record 长什么样

`src/include/access/xlogrecord.h`。整条 record：

```
XLogRecord（固定头，MAXALIGN）
  若干 XLogRecordBlockHeader [+ ImageHeader [+ CompressHeader] + RelFileLocator? + BlockNumber]
  XLogRecordDataHeaderShort|Long     main data
  各 block 的 payload / FPW 镜像
  main data
```

```c
typedef struct XLogRecord {
	uint32		xl_tot_len;
	TransactionId xl_xid;
	XLogRecPtr	xl_prev;     /* 上一条起点，串成链 */
	uint8		xl_info;     /* 低 4 位 XLogInsert 自用，高 4 位 rmgr */
	RmgrId		xl_rmid;
	/* 2 字节填充 */
	pg_crc32c	xl_crc;
} XLogRecord;
```

`xl_rmid` 按 `rmgrlist.h` **定义顺序**编号。活测用户 `INSERT` 是 **`rmid=10` = `RM_HEAP_ID`**。前面常见：`0` XLOG、`1` Transaction、`2` Storage、`8` Standby。`RM_HEAP2_ID` 是 9（HOT prune / multi-insert 等）。

Block header 的 `fork_flags` 高半：

| 位 | 含义 |
|---|---|
| `BKPBLOCK_HAS_IMAGE` (0x10) | 后面跟整页镜像（FPW） |
| `BKPBLOCK_HAS_DATA` (0x20) | 有 rmgr payload（插入偏移、元组字节等） |
| `BKPBLOCK_WILL_INIT` (0x40) | redo 会 `PageInit`（对应 `REGBUF_WILL_INIT` / `XLOG_HEAP_INIT_PAGE`） |
| `BKPBLOCK_SAME_REL` (0x80) | 省略 RelFileLocator，同前一个 block |

FPW 会丢掉页中间全 0 的 hole；`wal_compression` 还可再压（pglz/lz4/zstd）。本机 `wal_compression=off`。

一条普通 INSERT（页不是 checkpoint 后第一次改）：

```
RM_HEAP / XLOG_HEAP_INSERT
  block 0: heap 页，HAS_DATA，无 IMAGE
  main: xl_heap_insert { offnum, flags }
        + xl_heap_header + tuple 体
COMMIT 时另写 RM_XACT / XLOG_XACT_COMMIT
```

若该页 `PageGetLSN <= RedoRecPtr`，assemble 时给这个 block 加 IMAGE——checkpoint 后该页第一次进 WAL 就会多出约 8KB。这是 WAL 量在 checkpoint 后跳一下的原因，不是「每次 UPDATE 都写整页」。

==============================================================================

## 2. 插入路径：先拼、再占位、再拷

访问方法（以 `heap_insert` 为例，02 章已写过临界区）：

```
XLogBeginInsert()
XLogRegisterBuffer(HEAP_INSERT_BLKREF_HEAP, buffer, REGBUF_STANDARD | …)
XLogRegisterBufData(… xl_heap_header + tuple bytes)
XLogRegisterData(&xlrec, …)          /* 可选，main data */
XLogInsert(RM_HEAP_ID, XLOG_HEAP_INSERT | 可能 XLOG_HEAP_INIT_PAGE)
  → XLogRecordAssemble
  → XLogInsertRecord          /* 失败返回 InvalidXLogRecPtr 则整段重来 */
PageSetLSN(page, recptr)
```

`XLogBeginInsert` 必须在临界区外也能调，但 **真正 `XLogInsert` 时通常已在 `START_CRIT_SECTION`**：不允许 `ERROR`，失败即 PANIC。recovery 期间 `XLogInsertAllowed()` 为假，不能插。

### 2.1 `XLogRecordAssemble`（`xloginsert.c`）

还没拿插入锁。按已注册的 buffer 决定每个 block：

- `REGBUF_FORCE_IMAGE` → 一定 FPW
- `REGBUF_NO_IMAGE` → 一定不
- 否则看 `doPageWrites`（`full_page_writes` 或正在 backup）：页 LSN ≤ 当前 `RedoRecPtr` 才 backup

算出 `fpw_lsn` = 那些 **没** 做 FPW 的页里最小的 LSN。后面插锁拿到之后若发现 Redo 已经往前走、这些页其实该 backup，整条作废重拼。

CRC 先算 payload；头里的 `xl_prev` 要等占位之后才有，所以 header CRC 在 `XLogInsertRecord` 里补。

### 2.2 `XLogInsertRecord`（`xlog.c:748`）

注释把关键路径写成两步：

1. **占空间**：`Insert->CurrBytePos` 由自旋锁 `insertpos_lck` 保护。这里的「字节」是 **去掉 WAL 页头之后的可用字节**，所以 `+= size` 几乎就是预留。换算成真正 LSN 在锁外做（`XLogBytePosToRecPtr`）。同时填 `xl_prev`。
2. **拷贝**：多个进程可以对已经占好的区间并行 `memcpy` 进 WAL buffer。跨 WAL 页时要更新自己那把插入锁上的 `insertingAt`，好让刷盘的人知道上一页已经写完。

插入锁 **不是** 课程里的一个全局 `WALInsertLock` 宏。18.6 是：

```c
#define NUM_XLOGINSERT_LOCKS  8
WALInsertLocks[i].l.lock          /* LWTRANCHE_WAL_INSERT */
WALInsertLocks[i].l.insertingAt   /* 这个 inserter 已经拷到哪 */
WALInsertLocks[i].l.lastImportantAt
```

`WALInsertLockAcquire`：优先用上次那把（cache 亲和）；抢不到立刻换下一把。`XLOG_SWITCH` / `XLOG_CHECKPOINT_REDO` 要 `WALInsertLockAcquireExclusive`（八把全拿）。

占位之后若 `RedoRecPtr`/`doPageWrites` 变了、且这条 record 里有页现在必须 FPW：放锁、退出临界区、返回 `InvalidXLogRecPtr`，`XLogInsert` 的 `do { … } while` 重来。

拷完 `WALInsertLockRelease`。跨了 WAL 页才把 `LogwrtRqst.Write` 往前推——没跨页的小 record 可以暂时只待在 buffer 里。

==============================================================================

## 3. 刷盘：`XLogFlush` vs walwriter

### 3.1 同步提交

`RecordTransactionCommit`（`xact.c`）：写了 COMMIT record 且 `synchronous_commit > off`（或 `forceSyncCommit`、要删非 temp 关系）→ **`XLogFlush(XactLastRecEnd)`**，然后才 `TransactionIdCommitTree` 改 CLOG。顺序不能反：CLOG 说 committed 但 WAL 没落盘，crash 后会把已「提交」的事务弄丢。

`XLogFlush`（`xlog.c:2780`）：

- 已 `record <= LogwrtResult.Flush`：直接回。
- recovery 中不允许插入：改成推 `minRecoveryPoint`，不是写 WAL。
- 否则循环：
  1. `WaitXLogInsertionsToFinish`：等到所有插入锁的 `insertingAt` 越过要写的位置（不能把别人还在 memcpy 的洞刷下去）。
  2. `LWLockAcquireOrWait(WALWriteLock)`：**抢不到就等，等完再看是不是别人已经 flush 过**——这是 group commit：一趟 fsync 捎上排队的 COMMIT。
  3. 拿到锁：`XLogWrite`（把 WAL buffer `write` 到文件）+ `issue_xlog_fsync`。

`WALWriteLock` 是 `MainLWLockArray` 里的固定一把（helper 打印的那个），和 8 把插入锁不是一回事。

### 3.2 `issue_xlog_fsync`

本机 `wal_sync_method=fdatasync` → `pg_fdatasync`。`open_datasync` / `open_sync` 则在 `open()` 时带 O_DSYNC/O_SYNC，`issue_xlog_fsync` 直接 return（write 已经同步了）。`fsync=off` 同样跳过。

### 3.3 walwriter

`WalWriterMain` 调 `XLogBackgroundFlush`：把已完成页 `write` 出去，并按 `wal_writer_delay` / `wal_writer_flush_after` 决定何时 fsync。**它不是 COMMIT 正确性的必要条件**——backend 自己会 flush；它的硬保证是：异步提交（`synchronous_commit=off`）最多大约 3 个 `wal_writer_delay` 周期内落到盘上。异步路径是 `XLogSetAsyncXactLSN`，CLOG 要等 WAL flush 到那个 LSN 才标 committed。

`FlushBuffer`（05 章）淘汰脏数据页时也会 `XLogFlush(页 LSN)`：这是「先日志后数据」，和 COMMIT 不是同一条调用栈，但同一个 `XLogFlush`。

==============================================================================

## 4. Checkpoint：18.6 的 redo 点不是「最老脏页 LSN」

课程把 Phase 1 写成「扫 shared_buffers 找最老脏页 LSN」。**18.6 的在线 checkpoint 不是这样。** `CreateCheckPoint`（`xlog.c:6929`）自己的注释：

> 在线：先插入 `XLOG_CHECKPOINT_REDO`，**这条 record 的起始 LSN 就是 redo 点**；刷盘期间别人可以继续写 WAL；全部刷完后再写 `XLOG_CHECKPOINT_ONLINE`，指向前面那个 redo 点。

```
CreateCheckPoint
  SyncPreCheckpoint
  若 shutdown：拿齐插入锁，redo = 下一个可插位置
  若在线：
      WALInsertLockAcquireExclusive 只为读 Insert 状态
      放锁
      XLogInsert(RM_XLOG_ID, XLOG_CHECKPOINT_REDO)   /* RedoRecPtr = 这条的 StartPos */
  等 DELAY_CHKPT_START 的事务走出提交临界区
  CheckPointGuts(redo)
      CheckPointCLOG / MultiXact / …
      CheckPointBuffers → BufferSync          /* 05 章两阶段刷脏 */
      ProcessSyncRequests                     /* 真正 fsync 数据文件 */
      CheckPointTwoPhase
  若 replica+：LogStandbySnapshot
  XLogInsert(XLOG_CHECKPOINT_ONLINE 或 SHUTDOWN)
  XLogFlush
  UpdateControlFile                           /* pg_control */
```

shutdown / end-of-recovery：redo 就是 checkpoint record 自己的位置，中间不许再有 WAL（断言 `checkPoint.redo == ProcLastRecPtr`）。

`CheckPointBuffers` 就是 `BufferSync`：先给当时已脏的槽打 `BM_CHECKPOINT_NEEDED`，再按文件顺序写。每写一页 `CheckpointWriteDelay`（在 **`checkpointer.c`**，不在 xlog.c）：若进度超前于 `checkpoint_timeout * checkpoint_completion_target`，就 sleep。`CHECKPOINT_IMMEDIATE`（SQL `CHECKPOINT`）不睡。

本机一次手动 checkpoint：`pg_stat_checkpointer` 的 `num_requested=1, num_done=1, buffers_written=178, slru_written=3`。PG18 **没有** `bytes_written` 列；checkpoint 统计在 `pg_stat_checkpointer`，不要去 `pg_stat_bgwriter` 里找 `checkpoints_timed`（那是旧视图拆出去的）。

`checkpoint_completion_target` 摊的是 **时间窗口**。窗口 ≈ `min(checkpoint_timeout, 写满 max_wal_size 所需时间) * target`。WAL 很猛、`max_wal_size` 又小，窗口只剩几秒，0.9 也摊不平——该调的是 `max_wal_size`，不是把 target 拧到 0.5。

`--single` 里 SQL `CHECKPOINT` 会直接 `RequestCheckpoint` → `CreateCheckPoint`（flags=44 = immediate|force|wait 一类）。多进程实例里 SQL 只通知 **checkpointer 进程**，gdb 要 attach 那个 pid，不能只跟 backend。

==============================================================================

## 5. 崩溃恢复（和 00 章接上）

`StartupXLOG` 读 `pg_control` → 最新 checkpoint → 从 `checkPoint.redo` 起读 WAL → `RmgrTable[xl_rmid].rm_redo`。heap 进 `heap_redo`，按 `xl_info` 分到 `heap_xlog_insert` 等。

幂等：redo 读页后比较 `pd_lsn` 和 record LSN；已经更新过的跳过。FPW 则直接覆盖（`BKPIMAGE_APPLY`），不依赖页上旧内容是否撕裂。

`wal_level`：

| 级别 | 多记什么 | 本机 |
|---|---|---|
| `minimal` | 崩溃恢复；部分 bulk load 可跳过 WAL | |
| `replica` | + 物理复制所需 | **当前** |
| `logical` | + 逻辑解码（UPDATE/DELETE 要能还原旧行） | |

==============================================================================

## gdb（跟 INSERT 的 WAL，不要 follow-fork）

附加到 **backend**。第一次 `XLogInsert` 经常是 catalog / OID / Standby 锁，过滤 `rmid==10`：

```
break XLogInsert if rmid == 10
break XLogInsertRecord
break ReserveXLogInsertLocation
break XLogFlush
break CreateCheckPoint
```

`XLogInsert` 停住：

```
p rmid                          /* 10 = Heap */
p info
p begininsert_called
```

`ReserveXLogInsertLocation` 返回后：

```
p StartPos
p EndPos
p Insert->CurrBytePos
```

COMMIT 时断 `XLogFlush`，看 `record` 和 `LogwrtResult.Flush`。`CreateCheckPoint` 在多进程下要 attach **checkpointer**；`--single` 才能在同一个进程里打到。

`pg_waldump -p $PGDATA/pg_wal -s <lsn> -n 20`：看 `rmgr: Heap` / `Transaction` / `XLOG`。统计 FPW 用 `--stats=record`。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `XLogRecord` / block header / FPW 标志 | `src/include/access/xlogrecord.h` |
| `XLogRecPtr` | `src/include/access/xlogdefs.h` |
| rmgr 编号 | `src/include/access/rmgrlist.h` |
| `XLogBeginInsert` / `XLogRegister*` / `XLogInsert` / `XLogRecordAssemble` | `src/backend/access/transam/xloginsert.c` |
| `XLogInsertRecord` / `ReserveXLogInsertLocation` / 插入锁 | `src/backend/access/transam/xlog.c` |
| `XLogFlush` / `XLogBackgroundFlush` / `XLogWrite` / `issue_xlog_fsync` | `xlog.c` |
| `CreateCheckPoint` / `CheckPointGuts` | `xlog.c` |
| `CheckpointWriteDelay` / `RequestCheckpoint` | `src/backend/postmaster/checkpointer.c` |
| `CheckPointBuffers` → `BufferSync` | `src/backend/storage/buffer/bufmgr.c` |
| walwriter | `src/backend/postmaster/walwriter.c` |
| COMMIT / `XLogFlush(XactLastRecEnd)` | `src/backend/access/transam/xact.c` |
| heap INSERT 记 WAL | `src/backend/access/heap/heapam.c` |
| 规则说明 | `src/backend/access/transam/README` |

==============================================================================

## 和前后章的关系

- [[05-buffer-manager]]：淘汰脏页 / checkpoint 刷缓冲，都要先 `XLogFlush`；`BufferSync` 是 `CheckPointGuts` 里最重的那一段。
- [[02-page-tuple]]：`heap_insert` 临界区里组 WAL；空页可带 `XLOG_HEAP_INIT_PAGE`，redo 不必整页镜像。
- [[00-startup-postmaster]]：startup 进程跑 `StartupXLOG`，从 `pg_control` 的 redo 点重放到 WAL 尽头，然后才 `PM_RUN`。
- [[03-mvcc-clog]]：同步提交必须 **WAL flush 之后** 才把 xid 标 committed。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch04-wal-internals.md`
