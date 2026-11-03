# 第 02 章 对照笔记 — 页面布局与元组格式 (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/02-page-tuple.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/02-page-tuple.md`
> 证据: `evidence/ch02-page-tuple-evidence.txt` + `evidence/ch02-gdb-attach-heap.txt`

==============================================================================

## 一、课程要点（节选）

> PG 的最小 I/O 单位是 8KB Page。页内三层：`PageHeaderData` → ItemId 数组从上往下长 → tuple 从下往上长 → 中间空闲。Heap tuple 头约 23B：`xmin`/`xmax`/`ctid`/`t_infomask`/`t_hoff`。行超过约 2KB 走 TOAST。HOT update 在同页内产生新版本且不改索引列时，索引指针不动。

==============================================================================

## 二、PG18 源码定位（本机 grep）

| 概念 | 文件:行 | 说明 |
|---|---|---|
| PageHeaderData | `src/include/storage/bufpage.h:159` | 无 `pd_tli`；有 `pd_pagesize_version`；头 24B |
| PageInit | `src/backend/storage/page/bufpage.c:41` | `MemSet` 整页；heap 的 specialSize=0 |
| PageAddItemExtended | `bufpage.c:192` | 选槽 + 双向增长；禁止 ereport(ERROR) |
| PageRepairFragmentation | `bufpage.c:698` | prune/VACUUM 才搬元组 |
| PageGetHeapFreeSpace | `bufpage.c:990` | heap 选页用；卡 MaxHeapTuplesPerPage |
| ItemIdData | `src/include/storage/itemid.h:25` | 4B；REDIRECT 时 lp_off 是 OffsetNumber |
| HeapTupleFields | `src/include/access/htup_details.h:122` | `t_xmin`/`t_xmax` 在 union 里 |
| HeapTupleHeaderData | `htup_details.h:153` | `t_choice.t_heap` + `t_ctid`；固定 23B |
| MaxHeapTupleSize | `htup_details.h:615` | ≈8160（8KB 页） |
| heap_insert | `src/backend/access/heap/heapam.c:2081` | prepare → 选页 → Put → WAL |
| RelationGetBufferForTuple | `src/backend/access/heap/hio.c:502` | 缓存块 / FSM / 扩文件 |
| RelationPutHeapTuple | `hio.c:35` | `PageAddItem` + 回写 t_ctid |
| heap_toast_insert_or_update | `src/backend/access/heap/heaptoast.c:96` | TOAST 主路径（不是 `access/common/toast.c`） |

==============================================================================

## 三、实现边界（相对课程）

1. Buffer 槽和 Page 是两层：启动只建空槽（00 章）；第一次写新块才 `PageInit`。
2. `ctid` 的 offset 是 **linp 下标（从 1 起）**，不是页内字节偏移；字节偏移在 `ItemId.lp_off`。
3. gdb 必须读 `t_choice.t_heap.t_xmin`，不能当顶层 `t_xmin`。
4. 18.6 **没有** `HEAP_HAS_REDIRECTION`。HOT 标志在 `t_infomask2`：`HEAP_HOT_UPDATED` / `HEAP_ONLY_TUPLE`。
5. `HEAP_UPDATED` (t_infomask 0x2000) 只表示「这是 UPDATE 出来的新版本」，不是 HOT。
6. pageinspect：`pagesize=8192, version=4`；VACUUM 后常见 `flags=4` (`PD_ALL_VISIBLE`)。
7. 全 `x` 的长文本可能仍压进 heap（toast_size=0）。要用不可压缩数据才能看到 toast 表。

==============================================================================

## 四、实操（已跑）

pageinspect：200 行后 `lower=764, upper=792`。`t_infomask=2306=0x0902` = `HASVARWIDTH | XMIN_COMMITTED | XMAX_INVALID`。

TOAST：12800 字节 md5 串 → toast 16kB，chunk 长 1996。

**活进程 attach**（`gdb -p` 后端）：`heap_insert` 第一次命中常是 **catalog**（`CREATE TABLE` → `CatalogTupleInsert`），不是用户表 INSERT。入口处尚未 `heap_prepare_insert`，故 `xmax`/`ctid` 未填。

用户表 INSERT 的 WAL 路径见第 04 章 live attach（`rmid=10` Heap）。

==============================================================================

## 五、交接

实现正文已写在 `quant67-pg-kernel/02-page-tuple.md`：`PageInit`、`PageAddItemExtended`、空闲 API、碎片整理、`RelationGetBufferForTuple` 选页。

下一章按主链是 Buffer Manager（05）：页已经在缓冲里之后的 pin / 时钟 / 刷脏。PG18 seqscan 取页走 `read_stream`，黄金断点改为 `StrategyGetBuffer` / `BufferAlloc`。
