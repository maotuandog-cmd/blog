# 第 05 章 对照笔记 — Buffer Manager (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/05-buffer-manager.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/05-buffer-manager.md`
> **脑图补篇**: `/home/obsidian/postgres/learn/quant67-pg-kernel/05-补充说明.md`（freelist / Clock / unpin）
> 证据: `evidence/ch05-buffer-manager-evidence.txt` + `evidence/ch01-gdb-attach.txt`

==============================================================================

## 一、课程要点（节选）

> `shared_buffers` 是 Buffer Descriptor 数组 + 8KB 页数组。缺页用 Clock Sweep 找牺牲页（`StrategyGetBuffer`）。`bgwriter` 刷脏页；bulk read / VACUUM 用 ring，避免污染整个 pool。shared_buffers 不是越大越好：过大则挤压 OS page cache，checkpoint 风暴更猛。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| BufferDesc / state 位域 | `buf_internals.h:258` / `:44` | 18bit pin + 4bit usage + flags；描述符垫到 64B |
| ReadBufferExtended | `bufmgr.c:805` | `inline` → `ReadBuffer_common` → `StartReadBuffer` |
| PinBufferForBlock | `bufmgr.c:1101` | 读路径中间层：命中/分配并 pin |
| StartReadBuffers | `bufmgr.c:1504` | AIO / read_stream 入口 |
| BufferAlloc | `bufmgr.c:2009` | 哈希命中或 GetVictimBuffer |
| GetVictimBuffer | `bufmgr.c:2354` | 脏则 FlushBuffer；条件拿 content_lock |
| StrategyGetBuffer | `freelist.c:196` | freelist → clock；有 strategy 则先 ring |
| PinBuffer / MarkBufferDirty | `bufmgr.c:3090` / `:2970` | CAS state；dirty 要求独占 content lock |
| FlushBuffer | `bufmgr.c:4307` | 永久页先 `XLogFlush(LSN)` |
| BufferSync / BgBufferSync | `bufmgr.c:3367` / `:3643` | checkpoint 两阶段；bgwriter 跟 clock |
| heap_fetch_next_buffer | `heapam.c:679` | heap seqscan 取下一页 |
| read_stream_next_buffer | `read_stream.c:899` | PG18 流式预读 |

活进程里：`NBuffers=16384`（128MB / 8KB），`MaxBackends=136`。

==============================================================================

## 三、PG18 vs 课程

1. Heap seqscan **不再以 `ReadBufferExtended` 为可见主入口**。PG18 用 `read_stream` + `StartReadBuffers` 做预读，和 io_worker / AIO 配套。点读仍汇合到 `BufferAlloc`。
2. `GetAccessStrategy(BAS_NORMAL)` 返回 `NULL`（走全局 clock）。`BAS_BULKREAD` 环从 256KB 起，再加 `io_combine_limit * effective_io_concurrency`，且 cap 到 `NBuffers/8`。
3. 本后端 pin 次数在 `PrivateRefCountArray[8]`，共享 refcount 只在第一次 pin 时 +1。
4. `pg_shmem_allocations` 里有 `AioBackend`、`AioCtl`。

==============================================================================

## 四、实操（已跑）

- `Buffer Blocks` = 134221824（128MB）。
- 1000 行 `t_buf`：`pg_buffercache` 14 个 buffer，11 个 dirty。
- GDB：`StrategyGetBuffer` 时 `strategy=0`（默认 clock，不是 ring）。栈：
  `heap_fetch_next_buffer` → `read_stream_*` → `StartReadBuffers` → `PinBufferForBlock` → `BufferAlloc` → `GetVictimBuffer` → `StrategyGetBuffer`
- 活 backend 空闲栈在 `WaitEventSetWait` → `secure_read` → `ReadCommand`。

==============================================================================

## 五、交接

实现正文已写在 `quant67-pg-kernel/05-buffer-manager.md`：state 位域、三把锁、PG18 读路径、clock / ring、`FlushBuffer` 与 WAL 规则、`BufferSync`。

下一章按主链是 WAL（04）：从 `FlushBuffer` 的 `XLogFlush` 接进去。用户 `INSERT` 已在活进程上打到 `XLogInsert(rmid=10 Heap)`；`CHECKPOINT` 打 `CreateCheckPoint`。
