# PostgreSQL 18.6 Buffer Manager 实现（读页 / pin / 替换 / 刷脏）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `05-buffer-manager.txt`（以 PG17 为主线）；本文写 **18.6 实现**。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3 --enable-debug --enable-cassert`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path /opt/pg-src/postgresql-18.6 /opt/postgresql-18.6`。
> 前置：[[00-startup-postmaster]] 把空槽建出来；[[02-page-tuple]] 讲槽里 8KB 的页格式。
> 本章讲 **哪一块磁盘页占哪个槽、谁能碰、不够用时踢谁、脏页何时落盘**。
> 后续：[[04-wal-internals]]（`FlushBuffer` 先 `XLogFlush` 到页 LSN）；[[postgres/08-vacuum-freezing]]（cleanup lock = 独占内容锁 + 共享 pin==1）。
> 脑图补篇：[[05-补充说明]]（freelist 不是生命周期队列；Clock 减的是 usagecount）。

==============================================================================

## 一句话

`shared_buffers` 不是一块匿名 mmap 完事。它是：**描述符数组 + 8KB 页数组 + 按 tag 分区的哈希表 + clock 指针**。
读一块磁盘页 = 用 `(spc, db, relfilenode, fork, blkno)` 去哈希里找槽；命中则 pin，未命中则 `GetVictimBuffer` 踢一页（必要时先刷脏），再读盘。PG18 的 heap seqscan **不再以 `ReadBufferExtended` 为可见主入口**，走 `read_stream` → `StartReadBuffers` → 同一套 `PinBufferForBlock` / `BufferAlloc`。

==============================================================================

## 分层：tag → 槽 → 8KB 页

```
磁盘块  (spcOid, dbOid, relNumber, forkNum, blockNum)     BufferTag
        │
        ▼  BufTableLookup（分区 LWLock，128 路）
buf_id  0 .. NBuffers-1                                   槽下标
        │
        ├── BufferDescriptors[buf_id]                     64B 对齐的 BufferDesc
        │     tag / state(原子 32bit) / content_lock / freeNext
        └── BufferBlocks + buf_id * BLCKSZ                真正的 Page
                    │
                    ▼
              BufferGetPage(buffer)  buffer = buf_id + 1
```

和 02 章的边界：**本章不改页内布局**。拿到 `Page` 之后怎么 `PageInit` / `PageAddItem`，是访问方法的事。Buffer Manager 只保证：你 pin 着的时候，这个槽不会被别人抢走去装别的块。

| 结构 | 在哪 | 干什么 |
|---|---|---|
| `BufferDescriptors` | shmem，`NBuffers * 64B` | 身份、状态、内容锁 |
| `BufferBlocks` | shmem，`NBuffers * 8KB` | 页镜像 |
| `BufferIOCVArray` | shmem | `BM_IO_IN_PROGRESS` 时等人 |
| 哈希表（`buf_table.c`） | shmem，容量 `NBuffers + 128` | tag → buf_id |
| `BufferStrategyControl` | shmem | freelist 头 + clock 指针 |
| `CkptBufferIds` | shmem | checkpoint 排序用，避免刷脏时再 malloc |

`Buffer` 是 int：正数 = 共享槽（`buf_id + 1`），负数 = 本后端 temp 表的 local buffer。`InvalidBuffer = 0`。

默认 `NBuffers = 16384` → 页数组 128MB。改 `shared_buffers` 必须重启。

==============================================================================

## 1. `BufferDesc` 和那一个 32-bit `state`

`src/include/storage/buf_internals.h`。描述符本身要挤进 **64 字节 cache line**（`BufferDescPadded`），防 false sharing。I/O 用的 condition variable **不在** 结构体里，另放数组。

```c
typedef struct BufferDesc {
	BufferTag	tag;
	int			buf_id;              /* 0-based，初始化后不变 */
	pg_atomic_uint32 state;          /* flags + usagecount + refcount */
	int			wait_backend_pgprocno;
	int			freeNext;            /* 只由 buffer_strategy_lock 保护 */
	PgAioWaitRef io_wref;
	LWLock		content_lock;        /* 管页内容，不管「这个槽是谁」 */
} BufferDesc;
```

`state` 一个字里塞三样，CAS 就能改 pin，不必每次抢 header 自旋锁：

| 位 | 含义 |
|---|---|
| 0–17 | 共享 **refcount**（有多少后端 pin 了这个槽） |
| 18–21 | **usage_count**，clock 用，上限 `BM_MAX_USAGE_COUNT = 5` |
| 22–31 | flags |

关键 flags：

| 宏 | 含义 |
|---|---|
| `BM_LOCKED` | 正在握 header「自旋锁」（其实是 state 里的一位） |
| `BM_DIRTY` | 页和磁盘不一致，淘汰前要写 |
| `BM_VALID` | 8KB 内容可信（读完或零页初始化完） |
| `BM_TAG_VALID` | 哈希表里有这个 tag；有 pin 时 tag 不会变 |
| `BM_IO_IN_PROGRESS` | 有人在读或写这一槽 |
| `BM_JUST_DIRTIED` | 这次 write 过程中又脏了，写完不能清 dirty |
| `BM_CHECKPOINT_NEEDED` | 本轮 checkpoint 开始时就已经脏 |
| `BM_PERMANENT` | 永久关系（或 init fork）；普通 checkpoint 只刷这类 |

未格式化的空槽：启动时 `BufferManagerShmemInit` 把描述符串进 freelist，**没有 tag、没有 VALID**。第一次 `ReadBuffer` 才填页。

==============================================================================

## 2. 三把锁，不要混

`buffer/README` 的原话：碰共享缓冲有两套机制——**pin** 和 **content lock**。再往下，bufmgr 自己还有 mapping 锁和 header 锁。

| 锁 | 保护什么 | 持有多久 |
|---|---|---|
| 分区 `BufMapping` LWLock（128 路） | tag → buf_id 哈希 | 查找 SHARED；改映射 EXCLUSIVE。**pin 之后立刻放** |
| Buffer header（`BM_LOCKED` + CAS） | tag / state / waiter | 极短；改 pin 常常只 CAS，连这都不拿 |
| `content_lock` | **页里面的字节** | 短；`LockBuffer`。同一后端不能对同一 buffer 叠两把内容锁 |
| `buffer_strategy_lock` 自旋锁 | freelist 链表、`nextVictimBuffer` 统计 | 弹出/链入空槽 |

**Pin 不是锁。** pin 只保证这个槽还是这块磁盘页。没有 pin，clock 随时能把它改去装别的块。

规则（访问方法必须守）：

1. 扫页、看 xmin/xmax：pin + 共享或独占 content lock。
2. 判定可见之后，**可以放下 content lock，仍靠 pin 抓着元组指针**（heap seqscan 典型做法）。
3. 改元组/插行：pin + **独占** content lock。`MarkBufferDirty` 还 Assert 你正握着 EXCLUSIVE。
4. hint bit（`HEAP_XMIN_COMMITTED` 这类）允许只拿 **共享** 锁 OR 进去；丢了最多再查一次 CLOG。freeze 是关键更新，必须独占 + WAL。
5. 物理删行、compact 页：独占 content lock **且** 共享 refcount == 1（只有自己 pin）。这就是 `LockBufferForCleanup`。别人可能在你整理时再 pin，但拿不到内容锁，看不到半成品。

本后端多次 pin 同一页很常见。共享 refcount **只在第一次 pin 时 +1**；次数记在进程私有的 `PrivateRefCountArray[8]`，溢出进哈希。事务结束时私有计数必须清零——pin 不能跨事务。

temp 表走 `localbuf.c`，不进 `shared_buffers`，也没有这些 LWLock。

==============================================================================

## 3. 读路径（PG18：`read_stream` 才是 seqscan 主入口）

课程还在画 `ReadBufferExtended`。18.6 里它还在，而且内部已经接到同一套 I/O 原语；但 **heap seqscan** 的真实栈是：

```
heap_fetch_next_buffer                    heapam.c
  read_stream_next_buffer                 read_stream.c
    read_stream_look_ahead
      StartReadBuffers                    bufmgr.c:1504
        StartReadBuffersImpl
          PinBufferForBlock               bufmgr.c:1101
            BufferAlloc                   共享表
            LocalBufferAlloc              temp 表
          StartBufferIO / 提交 AIO
        WaitReadBuffers                   未命中才等盘
```

`ReadBufferExtended` → `ReadBuffer_common`：普通模式设 `READ_BUFFERS_SYNCHRONOUSLY`，调 `StartReadBuffer`；若需要 I/O 再 `WaitReadBuffers`。`P_NEW` 不再在这里扩文件，转到 `ExtendBufferedRel`。

`PinBufferForBlock` 不管读盘：只保证返回的 buffer **已经 pin**。`*foundPtr == true` 且 `BM_VALID` 才是命中。`foundPtr == false` 三种可能：别人正在读、上次读失败、`StartReadBuffers` 还没 `WaitReadBuffers`。

点读（`ReadBuffer` / index fetch）和流式预读 **汇合在 `BufferAlloc`**。gdb 跟替换算法，断 `StrategyGetBuffer` 比断 `ReadBufferExtended` 更稳。

==============================================================================

## 4. `BufferAlloc`：命中或抢槽

`bufmgr.c:2009`。

```
InitBufferTag → BufTableHashCode → 分区锁 SHARED
BufTableLookup
  ├─ 命中：PinBuffer，放 mapping 锁
  │         PinBuffer 返回是否 BM_VALID
  └─ 未命中：放锁
              GetVictimBuffer          /* 已 pin，内容作废 */
              分区锁 EXCLUSIVE
              BufTableInsert
                ├─ 冲突：还牺牲页给 freelist，改 pin 已有槽
                └─ 成功：LockBufHdr，写 tag，
                         BM_TAG_VALID | usage=1 | 可能 BM_PERMANENT
                         此时仍无 BM_VALID
```

要点：

- **先查表再 I/O**。注释写明：I/O 开始前哈希里必须已有条目，否则两个后端会各读一份，池子里出现两份同一块。
- 牺牲页进表失败（别人抢先插入）是正常竞争：`UnpinBuffer` + `StrategyFreeBuffer`，去用那个已有槽。
- 返回时调用方拿到的是 **pin 着、可能尚未 VALID** 的描述符。真正 `smgrread` / AIO 在 `WaitReadBuffers` / `StartBufferIO`。

`PinBuffer`（无 header 锁）：CAS 把共享 refcount +1；默认策略下 usage_count 不到 5 就 +1。**Ring 策略最多把 usage 抬到 1**，避免大扫描把整池「钉热」。本后端已 pin 过则只加私有计数。

==============================================================================

## 5. 淘汰：freelist → clock → ring

`GetVictimBuffer` → `StrategyGetBuffer`（header 锁仍握着，refcount 必须为 0）→ `PinBuffer_Locked`。

脑图见 [[05-补充说明]] 第〇节：**unpin ≠ 回 freelist**；Clock 扫的是数组下标，减的是 `usagecount`。

### 5.1 空闲链表

启动时所有槽在 freelist。`firstFreeBuffer` 无锁偷看一眼，有货再拿 `buffer_strategy_lock` 弹出。弹出后若发现已被人 pin 或 usage≠0，丢掉再试（VACUUM 把有效页放回 freelist 的旧路径残留检查）。

池子用热之后 freelist 通常是空的，日常走 clock。

### 5.2 Clock sweep

`nextVictimBuffer` 单调增加，取模 `NBuffers` 才是真正下标（`ClockSweepTick`）。

对每个候选：

- pin > 0：不能动，继续。连扫 `NBuffers` 次都没改任何 state → `ERROR: no unpinned buffers available`（整池被钉死）。
- pin == 0 且 usage > 0：usage − 1，重置 trycounter，继续。
- pin == 0 且 usage == 0：**牺牲页**，带着 header 锁返回。

所以 usage=5 的热页，clock 最多要绕 **6 圈** 才肯动它。这是精度和「找一页要扫多久」的折中，不是 LRU。

### 5.3 牺牲页可能是脏的

`GetVictimBuffer` 在 pin 之后看 `BM_DIRTY`：

1. **条件**拿 content_lock SHARED。拿不到就 unpin，换一个——无条件等会死锁（经典场景：两个后端同时分裂 BTree 页）。
2. 若用了 ring 且写出这一页需要 `XLogFlush`，`StrategyRejectBuffer` 可以拒绝，避免批量扫描被 WAL 卡住。
3. `FlushBuffer`：`StartBufferIO` 设 `BM_IO_IN_PROGRESS` → 读 LSN → **永久页** `XLogFlush(lsn)` → checksum 拷贝 → `smgrwrite`。这就是 WAL 规则：「先日志后数据」。hint bit 可能在共享锁下改页，所以算 checksum 用的是拷贝。
4. `InvalidateVictimBuffer` 从哈希摘掉旧 tag。若此时又被人 pin/弄脏，整段重来。

成功时：refcount==1（只有自己），无 TAG_VALID / VALID / DIRTY。交给 `BufferAlloc` 贴新 tag。

### 5.4 Ring：大扫描不要污染整池

`GetAccessStrategy(BAS_*)` 返回的是 **本进程私有** 的一小圈 buffer id，不是共享结构。`BAS_NORMAL` 直接返回 `NULL`（走全局 clock）。

| 策略 | 默认环（还要 cap 到 `NBuffers/8`） | 谁用 |
|---|---|---|
| `BAS_BULKREAD` | 256KB 起，再加 `io_combine_limit * effective_io_concurrency` | seqscan / ANALYZE |
| `BAS_BULKWRITE` | 16MB | COPY IN 等 |
| `BAS_VACUUM` | 2MB | VACUUM |

`GetBufferFromRing`：环槽还空 → 让调用方走普通分配，再 `AddBufferToRing`。槽里已有页：必须 **pin==0 且 usage≤1** 才能复用；usage 更高说明别人也碰过，放弃，换新页进环。

活测：普通 `SELECT` seqscan 第一次进 `StrategyGetBuffer` 时 `strategy=0`。要看到 ring，得走带 `GetAccessStrategy(BAS_BULKREAD)` 的路径（大表 seqscan / VACUUM）。

==============================================================================

## 6. 刷脏：backend / bgwriter / checkpointer

三种人会把脏页写出，**都走 `FlushBuffer`**（先 WAL）：

| 谁 | 何时 | 函数 |
|---|---|---|
| 任何后端 | 淘汰到脏页 | `GetVictimBuffer` |
| bgwriter | 周期性，跟在 clock 指针前面清 | `BackgroundWriterMain` → `BgBufferSync` |
| checkpointer | checkpoint / shutdown | `BufferSync` |

`MarkBufferDirty`：必须已 pin + 独占 content lock；CAS 置 `BM_DIRTY | BM_JUST_DIRTIED`。`JUST_DIRTIED` 让正在写的人写完后发现又脏了，不能清 dirty 位。

### `BufferSync`（checkpoint）

两阶段：

1. 扫全部 `NBuffers`，当时已脏（shutdown 时含 unlogged）的打上 `BM_CHECKPOINT_NEEDED`，填进 `CkptBufferIds`。**之后新脏的页这轮可以不写**。
2. 按 tablespace / rel / fork / block 排序，尽量顺序 I/O，按 `checkpoint_completion_target` 把工作摊到下一 checkpoint 之前。写出时清 `BM_CHECKPOINT_NEEDED`。别人或 bgwriter 先写出了也可以清这个位。

### bgwriter

`bgwriter.c` 主循环：`BgBufferSync` → 看该不该 hibernate → `WaitLatch`。`BgBufferSync` 用 `StrategySyncStart` 读 clock 位置和最近 `numBufferAllocs`，估计「clock 前面要留多少干净页」，从 `next_to_clean` 往前刷。它 **不** 替 checkpoint 保证所有脏页落盘；那是 checkpointer 的活。分配很勤时 `StrategyGetBuffer` 会 `SetLatch` 把睡着的 bgwriter 喊醒（`StrategyNotifyBgWriter`）。

==============================================================================

## 7. 为什么 `shared_buffers` 不是越大越好

实现上的后果，不是运维口号：

1. **Clock 扫得更远。** 热页 usage 到 5，找一个 usage=0 的槽，最坏按圈数随 `NBuffers` 涨。池子从 128MB 到 8GB，缺页路径的 CPU 不是线性「缓存更多所以更快」。
2. **Checkpoint 集合更大。** `BufferSync` 第一遍要扫整个描述符数组；脏页多则第二遍写得更猛。`checkpoint_completion_target` 只能摊，不能消灭。
3. **和 OS page cache 叠两份。** PG 写的是 `shared_buffers` 里的拷贝；除非 `open_datasync` 一类绕过，内核往往还有一份。内存被缓冲池占满，文件系统缓存变小，**未命中时** 读盘更疼。
4. **Ring 的上限是 `NBuffers/8`。** 池子巨大时，seqscan/VACUUM 仍只在私有环里打转，不会自动「多用 shared_buffers」。

本机默认 128MB、`NBuffers=16384`。1000 行小表 `pg_buffercache` 大约十几页，和「表很小，clock 几乎不用跑」一致。

==============================================================================

## gdb（跟替换，不要 follow-fork）

附加到 **跑 SQL 的 backend**。heap seqscan 不要只断 `ReadBufferExtended`。

```
break StrategyGetBuffer
break BufferAlloc
break GetVictimBuffer
break PinBufferForBlock
break FlushBuffer
break BufferSync
```

`StrategyGetBuffer` 停住后：

```
p strategy                          /* 0 = 全局 clock */
p NBuffers                          /* 16384 */
p StrategyControl->firstFreeBuffer
p StrategyControl->nextVictimBuffer
p *from_ring
```

`BufferAlloc` 里：

```
p newTag
p existing_buf_id                   /* >=0 命中 */
p *foundPtr
```

描述符（`buf_id` 从 0）：

```
p *GetBufferDescriptor(0)
p BUF_STATE_GET_REFCOUNT(pg_atomic_read_u32(&GetBufferDescriptor(0)->state))
p BUF_STATE_GET_USAGECOUNT(pg_atomic_read_u32(&GetBufferDescriptor(0)->state))
```

第一次 seqscan 命中 `StrategyGetBuffer` 经常是 **读 catalog / 表文件第 0 页**，`strategy=0`。要看 ring，对大表 `VACUUM` 或确认执行器走了 `BAS_BULKREAD`。

`FlushBuffer` 里看 `BufferGetLSN(buf)` 再 `step` 进 `XLogFlush`——这是进 04 章的桥。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `BufferDesc` / `BufferTag` / `BM_*` / `state` 位域 | `src/include/storage/buf_internals.h` |
| pin / content lock 规则 | `src/backend/storage/buffer/README` |
| `ReadBufferExtended` / `PinBufferForBlock` / `BufferAlloc` / `GetVictimBuffer` | `src/backend/storage/buffer/bufmgr.c` |
| `PinBuffer` / `UnpinBuffer` / `MarkBufferDirty` / `FlushBuffer` | `bufmgr.c` |
| `BufferSync` / `BgBufferSync` | `bufmgr.c` |
| `StartReadBuffers` / `WaitReadBuffers` | `bufmgr.c` |
| clock / freelist / ring | `src/backend/storage/buffer/freelist.c` |
| tag 哈希 | `src/backend/storage/buffer/buf_table.c` |
| 启动切槽 | `src/backend/storage/buffer/buf_init.c` |
| temp 表 | `src/backend/storage/buffer/localbuf.c` |
| seqscan 流式预读 | `src/backend/storage/aio/read_stream.c` |
| `heap_fetch_next_buffer` | `src/backend/access/heap/heapam.c` |
| bgwriter 循环 | `src/backend/postmaster/bgwriter.c` |
| AIO | `src/backend/storage/aio/` |
| `BufferGetPage` | `src/include/storage/bufmgr.h` |

==============================================================================

## 和前后章的关系

- [[00-startup-postmaster]]：`BufferManagerShmemInit` 只建空槽、串 freelist，**不读任何表页**。
- [[02-page-tuple]]：槽里那 8KB 的 slotted page；`RelationGetBufferForTuple` 调用的 `ReadBuffer` 最终进本章的 `BufferAlloc`。
- [[01-process-shmem]]：描述符在 **共享内存**；每个后端另有一份私有 pin 表。
- [[04-wal-internals]]：`FlushBuffer` 对永久页 `XLogFlush(pd_lsn)`；checkpoint 的 `BufferSync` 是 checkpointer 刷缓冲的那一段。
- [[postgres/08-vacuum-freezing]]：`LockBufferForCleanup` = 规则 5。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch05-buffer-manager.md`
