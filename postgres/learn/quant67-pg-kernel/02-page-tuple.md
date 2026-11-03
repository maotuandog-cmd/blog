# PostgreSQL 18.6 页面管理实现（Page / ItemId / 插页）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `02-page-tuple.txt`（以 PG17 为主线）；本文写 **18.6 实现**，不照抄课程。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3 --enable-debug --enable-cassert`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path /opt/pg-src/postgresql-18.6 /opt/postgresql-18.6`。
> 前置：[[00-startup-postmaster]] 把 `shared_buffers` 空槽建出来；本章讲槽里那 8KB **怎么被格式化、怎么塞行、怎么算空闲**。
> 后续：[[05-buffer-manager]] 讲 `ReadBuffer` / pin / 时钟扫描；[[03-mvcc-clog]] 讲 xmin/xmax 可见性；[[postgres/08-vacuum-freezing]] 讲 prune / HOT。

==============================================================================

## 一句话

PG 没有「行文件」。磁盘上的表/索引/TOAST 都是 **BLCKSZ（默认 8KB）块**；格式化之后叫 **Page**。页是 slotted page：头 24 字节 + ItemId 数组从上往下长 + 元组从 `pd_special` 往上长，中间是空闲。访问方法（heap / btree / gin…）共用 `bufpage.c`，自己的 opaque 放在页尾 special space。heap 页 special 长度为 0。

Buffer Manager 管的是「哪一块 8KB 在共享内存里、脏不脏、谁 pin 着」；**页内空间怎么切** 是 `PageInit` / `PageAddItemExtended` / `PageRepairFragmentation` 的事。

==============================================================================

## 分层：文件 → 块 → 页 → 行指针 → 元组

```
关系文件  base/<dboid>/<relfilenode>[.N]     默认 1GB 一个 segment
        │
        ▼  按 BLCKSZ 切
BlockNumber  0 .. n-1                      纯 I/O 下标（block.h）
        │
        ▼  ReadBuffer → BufferGetPage
Page = char[BLCKSZ]                        共享内存里的那一页（bufpage.h）
        │
        ├── PageHeaderData（固定 24B，不含 linp）
        ├── ItemIdData[1..n]               OffsetNumber 从 1 起
        ├── 空闲  [pd_lower, pd_upper)
        ├── 元组   从 pd_upper 往 pd_special 长
        └── special space                  heap 为 0；索引放 BTPageOpaque 等
                │
                ▼  ItemPointer = (blkno, offnum) = ctid
HeapTupleHeaderData（约 23B）+ null bitmap + 列值
```

`Buffer` 是整数：正数是 `shared_buffers` 下标（从 1 起），负数是 local buffer。`BufferGetPage` 只是：

```c
/* bufmgr.h */
BufferGetBlock(buffer)  →  BufferBlocks + (buffer-1)*BLCKSZ   /* 共享 */
BufferGetPage(buffer)   →  (Page) BufferGetBlock(buffer)
```

页指针就是缓冲槽起始地址。**不要**把 Page 理解成单独 malloc 的对象。

| 名字 | 是什么 | 不是什么 |
|---|---|---|
| Block | 文件里第几块、一次 I/O 单位 | 还没保证已 `PageInit` |
| Page | 已格式化的 slotted page | 不是「一行」 |
| ItemId | 页内 4 字节槽：偏移 + 长度 + 状态 | 不是 ctid |
| ItemPointer / ctid | `(block, offset)`，offset 是 **linp 下标** 不是字节偏移 | 不能当文件内绝对地址 |
| HeapTupleData | 内存里的「指向元组」结构（`t_len`/`t_self`/`t_data`） | 不落盘；盘上只有 `t_data` 那段 |

`PageIsNew(page)`：`pd_upper == 0`。全零页（扩展文件后 crash、还没 WAL）会被 `PageIsVerified` 放行，宏把它当空页；真正能插行之前必须 `PageInit`。

==============================================================================

## 1. 页头：`PageHeaderData`

`src/include/storage/bufpage.h`。`SizeOfPageHeaderData = offsetof(..., pd_linp)` = **24 字节**。`pd_linp[]` 是柔性数组，不算进这 24。

```c
typedef struct PageHeaderData
{
	PageXLogRecPtr pd_lsn;          /* 8B：最后改这一页的 WAL LSN（拆成两个 uint32） */
	uint16		pd_checksum;        /* 2B：data checksums 开启才有意义；0 也是合法校验和 */
	uint16		pd_flags;           /* PD_HAS_FREE_LINES / PD_PAGE_FULL / PD_ALL_VISIBLE */
	LocationIndex pd_lower;         /* 空闲起点 = ItemId 数组末尾 */
	LocationIndex pd_upper;         /* 空闲终点 = 第一个元组（对齐后）起点 */
	LocationIndex pd_special;       /* special space 起点；heap 页 = BLCKSZ */
	uint16		pd_pagesize_version;/* 高 8 位 pagesize（256 倍数），低 8 位 layout version=4 */
	TransactionId pd_prune_xid;     /* 页上最老的可 prune xid 提示；索引页不用 */
	ItemIdData	pd_linp[FLEXIBLE_ARRAY_MEMBER];
} PageHeaderData;
```

可用空间（还没扣新 ItemId）= `pd_upper - pd_lower`。页满 = 中间插不进对齐后的新元组 + 一个 4B 指针。

`pd_lsn` 给 Buffer Manager 执行 WAL 规则：**刷脏页之前，WAL 至少要 flush 到这个 LSN**。crash recovery 时：页上 LSN 已经 ≥ WAL 记录 LSN，这条 redo 可以跳过。

`pd_pagesize_version`：18.6 的 `PG_PAGE_LAYOUT_VERSION` 仍是 **4**（8.3 起）。课程里的 `pd_tli` 早没了；那两个字节现在是 `pd_flags`。

`pd_flags`（hint，不全 WAL 记）：

| 位 | 含义 |
|---|---|
| `PD_HAS_FREE_LINES` (0x0001) | 数组里有可复用的 `LP_UNUSED`；插行时才去扫 |
| `PD_PAGE_FULL` (0x0002) | UPDATE 当时塞不下新版本，暗示该 prune |
| `PD_ALL_VISIBLE` (0x0004) | 页上所有元组对所有人可见；和 visibility map 配对 |

课程实验里 200 行 + VACUUM 后 `flags=4`，就是 `PD_ALL_VISIBLE`。

==============================================================================

## 2. `PageInit`：把一块 8KB 变成空页

`src/backend/storage/page/bufpage.c`。**不在启动时跑**；第一次往新块上写、或 recovery 用 `XLOG_HEAP_INIT_PAGE` 时才调。

```c
void
PageInit(Page page, Size pageSize, Size specialSize)
{
	specialSize = MAXALIGN(specialSize);
	MemSet(page, 0, pageSize);                 /* 整页清零，含 checksum / prune_xid */
	p->pd_lower = SizeOfPageHeaderData;        /* 24 */
	p->pd_upper = pageSize - specialSize;      /* heap: 8192 */
	p->pd_special = pageSize - specialSize;
	PageSetPageSizeAndVersion(page, pageSize, PG_PAGE_LAYOUT_VERSION);
}
```

heap 调用是 `PageInit(page, BLCKSZ, 0)`：special 长度为 0，元组可以从页尾一直往上长。btree 会传入 `sizeof(BTPageOpaqueData)`。

初始化**不算 checksum**。注释写明：校验和等到要写出磁盘时才算（`PageSetChecksumInplace` / `PageSetChecksumCopy`）。

谁调用（heap）：

1. `RelationGetBufferForTuple` 读到一块 `PageIsNew` 的页（全零扩展页）→ `PageInit` + `MarkBufferDirty`。
2. `RelationAddBlocks` 扩文件后，对返回的第一页同样 `PageInit`（并断言原来是 new）。

`PageIsVerified` 在 **刚从磁盘读进缓冲** 时跑：头看起来 sane（`lower ≤ upper ≤ special ≤ BLCKSZ` 且 special 对齐）+ checksum（若开了）。全零页也算通过——扩展后 crash、WAL 没记下，内核里已经是零页。

==============================================================================

## 3. ItemId：页内槽，不是字节指针

`src/include/storage/itemid.h`。正好 4 字节，三个位域：

```c
typedef struct ItemIdData {
	unsigned lp_off:15;    /* 字节偏移，或 REDIRECT 时是下一个 OffsetNumber */
	unsigned lp_flags:2;   /* LP_UNUSED / NORMAL / REDIRECT / DEAD */
	unsigned lp_len:15;    /* 元组长度；无存储时约定为 0 */
} ItemIdData;
```

15 bit 限制了页最大 **32KB**（`lp_off`/`lp_len`）。默认 8KB 远远够。

`OffsetNumber`（`off.h`）是 **1-based** 的 linp 下标。`PageGetItemId(page, n)` = `&pd_linp[n-1]`。

```
ctid = (ip_blkid, ip_posid)     /* 6 字节，packed */
         BlockNumber            OffsetNumber → 去找第 n 个 ItemId
                                      │
                                      ▼
                               lp_off 才是页内字节偏移
                                      │
                                      ▼
                               PageGetItem(page, itemId)
```

四种 `lp_flags`：

| 状态 | 存储 | 何时 |
|---|---|---|
| `LP_UNUSED` (0) | `lp_len=0` | 空槽；`PageAddItem` 优先复用靠前的 |
| `LP_NORMAL` (1) | `lp_len>0` | 正常元组 |
| `LP_REDIRECT` (2) | `lp_len=0`，`lp_off` = 下一个 offset | HOT 链：索引仍指旧 offset，页内跳到最新版本 |
| `LP_DEAD` (3) | 可有可无存储 | 已死、等 VACUUM 第二遍收槽 |

`ItemIdHasStorage` 只看 `lp_len != 0`。REDIRECT 没有页内元组体，所以 `lp_len=0`。

`pd_lower` 只往前长、**不因为中间 UNUSED 而缩短**（除非 VACUUM 截掉尾部连续 UNUSED）。所以「有洞的槽」靠 `PD_HAS_FREE_LINES` 提示，插行时线性扫。

==============================================================================

## 4. `PageAddItemExtended`：往页里塞一条

所有 heap/index 往页上放 item 的底层。`PageAddItem(...)` 是宏，转成 flags：`PAI_OVERWRITE`、`PAI_IS_HEAP`。

**禁止 `ereport(ERROR)`**——已经在临界区里的调用方（`RelationPutHeapTuple`）失败只能 PANIC。

选槽：

1. 调用方给了合法 `offsetNumber` + `PAI_OVERWRITE`：那个槽必须 UNUSED 且无存储。
2. 给了合法 offset、不 overwrite：把后面的 linp **memmove 后移**（索引删插中间项会走这条）。
3. `InvalidOffsetNumber`（heap 插入）：若 `PD_HAS_FREE_LINES`，从 1 扫到 `maxoff`，找第一个 UNUSED 且无存储；hint 错了就清掉。否则接到数组末尾（`maxoff+1`）。

heap 还有硬上限 `MaxHeapTuplesPerPage`（约 **291**：`(BLCKSZ - 24) / (MAXALIGN(23) + 4)`）。HOT 理论上能堆更多 **指针**，但代码故意卡死，避免工作数组爆掉。

空间：

```
若要新开一个 linp：lower' = pd_lower + 4
否则：            lower' = pd_lower
alignedSize = MAXALIGN(size)     /* 元组体按 MAXALIGN 对齐存放 */
upper' = pd_upper - alignedSize
if lower' > upper' → 返回 InvalidOffsetNumber（调用方当「这页塞不下」）
```

成功则 `ItemIdSetNormal(itemId, upper', size)`（**len 记真实 size，off 记对齐后的起点**），`memcpy` 到 `page + upper'`，写回 `pd_lower`/`pd_upper`。

heap 插入不指定 offset：`RelationPutHeapTuple` → `PageAddItem(..., InvalidOffsetNumber, false, true)`。成功后再用返回的 offnum 填 `tuple->t_self` 和页上那份 `t_ctid`。

==============================================================================

## 5. 空闲空间：四种 API 不要混用

都在 `bufpage.c`。

| 函数 | 算什么 | 给谁用 |
|---|---|---|
| `PageGetExactFreeSpace` | `pd_upper - pd_lower` | 只要中间空洞，不管新指针 |
| `PageGetFreeSpace` | 上面再减一个 `sizeof(ItemIdData)` | **索引页** |
| `PageGetFreeSpaceForMultipleTuples` | 减 `ntups * 4` | 索引批量 |
| `PageGetHeapFreeSpace` | `PageGetFreeSpace`，再卡 `MaxHeapTuplesPerPage` | **heap 选页** |

`PageGetHeapFreeSpace` 的额外逻辑：linp 已经 ≥ 上限且没有可复用 UNUSED 时，即使中间还有字节，也返回 0。hint 说有空槽会再扫一遍确认。

FSM（`GetPageWithFreeSpace`）记的就是这类「还能塞多大」的近似值，会过期；`RelationGetBufferForTuple` 锁页后必须用 `PageGetHeapFreeSpace` 复核。

==============================================================================

## 6. 碎片：`PageRepairFragmentation`

删除/prune 之后，元组体之间会出现洞，但 `pd_upper` 不会自己往下走。整理是 **把还活着、有存储的元组紧贴 `pd_special` 往回搬**，更新每个 ItemId 的 `lp_off`。

流程：

1. 校验 `lower/upper/special`，坏了直接 ERROR（这是在改共享缓冲，不能瞎搬）。
2. 扫 linp：USED + 有存储的记进 `itemIdCompactData[]`；UNUSED 清干净并计数。
3. 没有存活存储：`pd_upper = pd_special`。
4. 否则 `compactify_tuples`：若本来就是「低 offset 对应更高字节」（插入顺序），可以 `memmove` 往页尾挤；否则拷到临时缓冲再写回，并排回这个顺序，方便下次走快路径。
5. 尾部连续 UNUSED 直接缩短 `pd_lower`（砍掉尾部指针）。
6. 中间还剩 UNUSED 则设 `PD_HAS_FREE_LINES`。

VACUUM 第二遍还会调 `PageTruncateLinePointerArray`：只砍尾部 UNUSED，**故意不把页变成 `PageIsEmpty`**（至少留一个 UNUSED 槽）。

heap **不会**在 `PageAddItem` 时 compact 已有元组——插入不移动别人。碎片只在 prune/VACUUM 时收。

索引删项走另一套：`PageIndexTupleDelete` **会抽掉那个 linp**（后面的指针前移），和 heap「offset 尽量稳定给索引用」相反。

==============================================================================

## 7. Heap 怎么选页、怎么放行

插一行的实现链（用户 `INSERT` 最终到这里）：

```
heap_insert()                         heapam.c:2081
  heap_prepare_insert()               填 xmin/xmax/cid；超 TOAST 阈值则外存
  RelationGetBufferForTuple()         hio.c:502  选一块够大的页并 EXCLUSIVE 锁
  START_CRIT_SECTION
  RelationPutHeapTuple()              PageAddItem + 回写 t_ctid
  必要时 PageClearAllVisible + 清 VM
  MarkBufferDirty
  XLogInsert(RM_HEAP_ID, XLOG_HEAP_INSERT)
  PageSetLSN
  END_CRIT_SECTION
  UnlockReleaseBuffer
```

### 7.1 `heap_prepare_insert`

清事务相关 infomask，`HEAP_XMAX_INVALID`，`xmin = xid`，`xmax = 0`，`cmin = cid`。表/物化视图且（已有 external 或 `t_len > TOAST_TUPLE_THRESHOLD`）才进 `heap_toast_insert_or_update`。TOAST 表自己不再递归 toast。

### 7.2 `RelationGetBufferForTuple`：页管理的「找地方」

目标空闲 `targetFreeSpace` ≈ `MAXALIGN(len) + fillfactor 预留`。超大行会放宽到「几乎空页」阈值，避免低 fillfactor 表被 FSM 带去半满页却仍塞不下。

找页顺序：

1. `BulkInsertState` 里钉着的当前块，否则 relcache 的 `RelationGetTargetBlock`。
2. 没有缓存且用 FSM：`GetPageWithFreeSpace`。
3. FSM 也没有：关系最后一页（避免 bootstrap / 刚启动时一页一行）。
4. 锁页（注意和 `otherBuffer` 的锁顺序，UPDATE 新版本可能要锁另一页）。
5. `PageIsNew` → `PageInit(..., 0)`。
6. `PageGetHeapFreeSpace >= target` → `RelationSetTargetBlock`，把这块 buffer 交给调用方（**仍持 EXCLUSIVE**）。
7. 不够：解锁，把真实空闲写回 FSM，要下一块；或走 bulk extend 留下的 `bistate->next_free`。
8. 全都不够：`RelationAddBlocks` → `ExtendBufferedRelBy`（最多一次扩 64 页），第一页 `PageInit`，其余进 FSM 或 bistate。

`len > MaxHeapTupleSize` 在进循环前就 ERROR。`MaxHeapTupleSize = BLCKSZ - MAXALIGN(24+4)` ≈ **8160**（8KB 页）。一行不能跨页——这是硬约束，所以才有 TOAST。

### 7.3 `RelationPutHeapTuple`

假定调用方已经 `BUFFER_LOCK_EXCLUSIVE`。`PageAddItem` 失败 → **PANIC**（选页时说够，这里不够 = 实现/并发逻辑坏了）。然后：

```c
ItemPointerSet(&tuple->t_self, BufferGetBlockNumber(buffer), offnum);
/* 非 speculative：把页上那份 header 的 t_ctid 写成自己 */
item->t_ctid = tuple->t_self;
```

speculative insert（ON CONFLICT）把 token 放在 `t_ctid` 里，不写真实 TID。

第一行插进空页时，WAL 可带 `XLOG_HEAP_INIT_PAGE`：redo 先 `PageInit` 再放元组，不必整页镜像。

==============================================================================

## 8. 页上的 Heap 元组（管理页必须认识的载荷）

`HeapTupleHeaderData` 固定部分 **23 字节**（到 `t_hoff`）。gdb 必须走 union：

```
t_data->t_choice.t_heap.t_xmin
t_data->t_choice.t_heap.t_xmax
t_data->t_choice.t_heap.t_field3.t_cid
t_data->t_ctid
t_data->t_infomask / t_infomask2 / t_hoff
```

**没有**顶层 `t_xmin`。18.6 **没有** `HEAP_HAS_REDIRECTION`（课程/大纲里那条对 18.6 不成立）。

`t_ctid`：新插入指向自己；UPDATE 后旧版本指向新版本的 TID。跟着链走时必须校验「目标槽还在、且目标 xmin == 自己 xmax」，否则可能是 VACUUM 腾槽后塞进去的无关行。

HOT 相关在 **`t_infomask2`**，不是课程写的 `t_infomask 0x2000`：

| 位 | 宏 | 含义 |
|---|---|---|
| 0x4000 | `HEAP_HOT_UPDATED` | 旧版本：被 HOT update 过 |
| 0x8000 | `HEAP_ONLY_TUPLE` | 新版本：heap-only，索引没指向它 |
| 0x07FF | `HEAP_NATTS_MASK` | 列数 |

`t_infomask` 的 `HEAP_UPDATED` (0x2000) 是「这是 UPDATE 出来的新版本」，和 HOT 不是同一个位。

`t_hoff` 是用户数据起点（含 null bitmap、对齐），必须是 MAXALIGN 倍数。列值按 `typalign`（c/s/i/d）排。

TOAST：一行压缩前超过约 **1/4 页**（`TOAST_TUPLE_THRESHOLD = MaximumBytesPerTuple(4)`，8KB 上约 2KB）就尝试压/外存。外存列在原 tuple 里是 `varatt_external`（rawsize + extinfo + valueid + toastrelid），`HEAP_HASEXTERNAL`。chunk 表仍是普通 heap 页，chunk 大约 1996 字节，好让 4 个 toast 元组装进一页。

fillfactor 不改页格式，只改 `RelationGetBufferForTuple` 的 `saveFreeSpace`：初始装得越不满，同页 HOT 越容易成功。默认 heap 100、index 90。

==============================================================================

## gdb（跟插页，不要 follow-fork）

附加到 **backend**（`pgattach` / `gdb -p`），不要跟 postmaster。`handle SIGUSR1 SIGINT SIGTERM SIGQUIT SIGPIPE SIGUSR2 SIGCHLD nostop noprint pass`。

建议断点（一条一条敲）：

```
break heap_insert
break heap_prepare_insert
break RelationGetBufferForTuple
break PageInit
break PageAddItemExtended
break RelationPutHeapTuple
```

停在 `heap_insert` 之后：

```
p relation->rd_rel->relfilenode
p tup->t_len
p tup->t_data->t_choice.t_heap.t_xmin
p tup->t_data->t_hoff
```

`RelationGetBufferForTuple` 返回后：

```
p buffer
p BufferGetBlockNumber(buffer)
p *(PageHeader)BufferGetPage(buffer)
p PageGetHeapFreeSpace(BufferGetPage(buffer))
p PageGetMaxOffsetNumber(BufferGetPage(buffer))
```

`PageAddItemExtended` 返回后看 `pd_lower`/`pd_upper` 是否各动了 4 和对齐后的 `t_len`。

第一次命中经常是 **catalog**（`CREATE TABLE` → `CatalogTupleInsert`），不是用户表。用户 `INSERT` 再 `continue` 直到 `relfilenode` 对上。

`pgpage <page-addr>`（hermes 的 pg18gdb.py）可以直接把 header / linp 打出来。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `PageHeaderData` / `PageGetItem` / flags | `src/include/storage/bufpage.h` |
| `PageInit` / `PageAddItemExtended` / `PageRepairFragmentation` / 空闲 API | `src/backend/storage/page/bufpage.c` |
| `ItemIdData` / `LP_*` | `src/include/storage/itemid.h` |
| `OffsetNumber` | `src/include/storage/off.h` |
| `BlockNumber` | `src/include/storage/block.h` |
| `ItemPointerData` / speculative token | `src/include/storage/itemptr.h` |
| `BufferGetPage` | `src/include/storage/bufmgr.h` |
| `HeapTupleHeaderData` / `MaxHeapTupleSize` / `MaxHeapTuplesPerPage` | `src/include/access/htup_details.h` |
| `HeapTupleData`（内存指针） | `src/include/access/htup.h` |
| `heap_insert` / `heap_prepare_insert` | `src/backend/access/heap/heapam.c` |
| `RelationGetBufferForTuple` / `RelationPutHeapTuple` / `RelationAddBlocks` | `src/backend/access/heap/hio.c` |
| TOAST 阈值 / chunk | `src/include/access/heaptoast.h` |
| TOAST 实现 | `src/backend/access/heap/heaptoast.c` |
| TOAST 指针 | `src/include/varatt.h` |
| FSM | `src/backend/storage/freespace/` |
| pageinspect | `contrib/pageinspect/` |

==============================================================================

## 和前后章的关系

- [[00-startup-postmaster]]：启动时 `BufferManagerShmemInit` 只建**空槽**，不 `PageInit` 任何表页。
- [[01-process-shmem]]：页在 **共享内存** 里，多进程靠 buffer 内容锁互斥，不是把 Page 拷进私有堆。
- [[05-buffer-manager]]：`ReadBuffer` 把块读进槽、`PageIsVerified`、pin/unpin、刷脏看 `pd_lsn`。本章假定页已经在缓冲里。
- [[03-mvcc-clog]]：`xmin`/`xmax`/`t_infomask` hint bit 怎么判可见。
- [[postgres/08-vacuum-freezing]]：prune、`LP_REDIRECT`/`LP_DEAD`、`pd_prune_xid`、`PageRepairFragmentation` 的调用方。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch02-page-tuple.md`
