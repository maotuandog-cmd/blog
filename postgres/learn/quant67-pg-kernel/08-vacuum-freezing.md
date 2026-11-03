# PostgreSQL 18.6 VACUUM 实现（prune / 索引 / freeze / VM / FSM）

> 来源：对照 `/opt/postgresql-18.6` 源码。课程原文是 `08-vacuum-freezing.txt`；本文写 **18.6 实现**。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3`），数据目录 `/tmp/pg18-data`，gdb 需 `substitute-path`。
> 前置：[[03-mvcc-clog]] 的 xmin/xmax 与 OldestXmin；[[07-transaction-subxact]] 的 `xidVacLimit`；[[05-buffer-manager]] 的 cleanup lock 与 `ReadStream`；[[02-page-tuple]] 的 ItemId / HOT。
> 后续：主链下一章是 [[12-executor]]（执行器）。wraparound 阈值已在 03/07 写过，这里只接到 VACUUM 的 failsafe。

==============================================================================

## 一句话

UPDATE/DELETE 把旧版本留在 heap 上。VACUUM 不是「六步流水线扫一遍」，而是：**边扫边 prune（HOT 链 + 可选 freeze）→ 把 LP_DEAD 的 TID 记进 TidStore → 清索引 → 再把 LP_DEAD 改成 LP_UNUSED**。能不能收，看 `OldestXmin`（所有快照还认的最小 xid）；32 位 xid 半环靠 freeze（`HEAP_XMIN_FROZEN`）和 `relfrozenxid` 往前推。

==============================================================================

## 分层

```
ExecVacuum / vacuum_rel
  ShareUpdateExclusiveLock（FULL 才是 AccessExclusiveLock）
  PROC_IN_VACUUM（别的 VACUUM 算 OldestXmin 时忽略我）
        │
        ▼
heap_vacuum_rel → vacuum_get_cutoffs → lazy_scan_heap
        │  ReadStream（和 05 章 seqscan 同一套预读）
        │  每页 ConditionalLockBufferForCleanup（aggressive 会等到）
        ▼
heap_page_prune_and_freeze     HOT 收链、标 LP_DEAD、可能 freeze
        │  dead TIDs → TidStore（上限 maintenance_work_mem）
        ▼
lazy_vacuum
  1. lazy_vacuum_all_indexes   索引里删掉指向这些 TID 的条目
  2. lazy_vacuum_heap_rel      LP_DEAD → LP_UNUSED，更新 FSM/VM
        │
        ▼
可选 lazy_truncate_heap        尾部空页，要升级 AccessExclusiveLock
更新 pg_class.relfrozenxid / relminmxid / relallvisible
```

`VACUUM FULL` 不走这条 lazy 路径：`cluster.c` 整表重写，锁表。

==============================================================================

## 1. 为什么必须 VACUUM

heap 不原地改：新版本另占 ItemId，旧版本 xmax 提交后仍占页。回收条件不是「xmax 已提交」就够，还要 **没有任何运行中快照** 还能看见它。cutoff 是 `GetOldestNonRemovableTransactionId` → `cutoffs.OldestXmin`。长事务、复制 slot、prepared xact 都会把这条线钉住。

`HeapTupleSatisfiesVacuum`（`heapam_visibility.c:1171`，**不在**课程写的 `tqual.c`）返回：

| 结果 | 含义 |
|---|---|
| `HEAPTUPLE_DEAD` | 可收（含插入未提交就 abort 的行） |
| `HEAPTUPLE_RECENTLY_DEAD` | 删了，但 `dead_after >= OldestXmin`，还不能动 |
| `HEAPTUPLE_LIVE` / `INSERT_IN_PROGRESS` / `DELETE_IN_PROGRESS` | 留下 |

`vacuum_rel` 给 lazy 路径打 `PROC_IN_VACUUM`，所以 **别的表的 VACUUM 算 OldestXmin 时不算我**。本表仍互斥：`ShareUpdateExclusiveLock`。

==============================================================================

## 2. 真正的两趟（不是课程那六段）

活测栈：

```
lazy_scan_heap (vacuumlazy.c:1201)
  ← heap_vacuum_rel (:839)
  ← table_relation_vacuum
  ← vacuum_rel (vacuum.c:2317)
  ← vacuum → ExecVacuum (:471)
```

`lazy_scan_heap` 开头就 `read_stream_begin_relation(READ_STREAM_MAINTENANCE, …, heap_vac_scan_next_block)`。VM 上 all-frozen 的页普通 VACUUM 会跳（`skipwithvm`）；`VACUUM (DISABLE_PAGE_SKIPPING)` 或 aggressive 不跳。

每页：

1. 非 aggressive：`ConditionalLockBufferForCleanup`（独占 content lock + 别人 pin==0，见 05 章）。拿不到就可能跳过 prune/freeze，只记已有 LP_DEAD。
2. aggressive：`LockBufferForCleanup` 等到。
3. `lazy_scan_prune` → `heap_page_prune_and_freeze`（`pruneheap.c:350`）：HOT 重定向、死链收成 LP_DEAD、按 cutoff 准备 freeze。无索引时直接 `HEAP_PAGE_PRUNE_MARK_UNUSED_NOW`。
4. LP_DEAD 的 TID 进 `TidStore`。超过 `maintenance_work_mem`（autovac 用 `autovacuum_work_mem`）就中途 `lazy_vacuum`——**每趟都会完整扫一遍索引**，内存小会极慢。

`lazy_vacuum` 注释写得很死：必须先清索引，才能把 heap 上 LP_DEAD 改成 LP_UNUSED。否则索引里还指着一个已回收的 slot，扫描会串行。课程把「清理 heap」放在「清理索引」前面，顺序反了。

截断：尾部连续空页 ≥ `REL_TRUNCATE_MINIMUM`（**1000 页**，不是课程的 32）或 ≥ 表大小 / `REL_TRUNCATE_FRACTION`。failsafe 期间不截断（怕抢 `AccessExclusiveLock` 时再分配 xid 失败）。`VACUUM (TRUNCATE false)` 关掉。

==============================================================================

## 3. Freeze 与 VM

`vacuum_get_cutoffs`（`vacuum.c:1116`）：

| 量 | 怎么来 |
|---|---|
| `OldestXmin` | `GetOldestNonRemovableTransactionId` |
| `FreezeLimit` | `nextXID - vacuum_freeze_min_age`（默认 5 千万），且 **≤ OldestXmin** |
| aggressive | `relfrozenxid` 年龄 ≥ `vacuum_freeze_table_age`（默认 1.5 亿，且 cap 到 `autovacuum_freeze_max_age * 0.95`） |

`heap_prepare_freeze_tuple`：xmin 早于 `OldestXmin` 就可以进 freeze 计划；真正执行要页级决定——`freeze_required`（存在 xid < `FreezeLimit`）必须冻；否则若 freeze 后能 all-frozen 且反正要打 FPI，就顺手冻。

冻的是 infomask：`HEAP_XMIN_FROZEN = HEAP_XMIN_COMMITTED \| HEAP_XMIN_INVALID`。9.4 之后一般 **不把 xmin 改写成 `FrozenTransactionId`(2)**，读路径见这个组合位就当永远可见。页上所有元组都 totally frozen → VM 的 `ALL_FROZEN`。

VM（`visibilitymap.c`）：每 heap 页 **2 bit**（`ALL_VISIBLE=0x01`，`ALL_FROZEN=0x02`）。一页 VM 去掉页头后约 `MAPSIZE * 4` ≈ **32672** 个 heap 页。课程写成 `8×1024×8×2=131072` 把「每页 2 bit」乘反了。Index-Only Scan 看 `ALL_VISIBLE`：置位则可以不回 heap。

PG18 普通 VACUUM 还有 **eager scan**：按区域去碰 VM 已 all-visible 但未 frozen 的页，想提前冻上；失败率超过 `vacuum_max_eager_freeze_failure_rate` 就停。aggressive 必须看所有未冻页，不受这个帽。

活测 `VACUUM VERBOSE t_vac`（1000 行、两次整表 UPDATE）：`tuples: 1000 removed, 1000 remain`；`13 pages set all-visible, 7 pages set all-frozen`；`new relfrozenxid` 前进。

==============================================================================

## 4. FSM

独立 fork。每个 heap 页在叶子上 **1 字节** = 空闲空间 / `(BLCKSZ/256)`，最大值 255。页内是二叉树，上层页再汇总 max。`RecordPageWithFreeSpace` 在 prune/vacuum 完一页后调用。这是近似值；精确空闲仍看 `pd_lower`/`pd_upper`。INSERT 选页走 FSM，不是顺序扫表。

VACUUM **不**把文件缩小给 OS（截断尾部空页除外）。中间碎洞只留给后续 INSERT。要还给 OS 用 `VACUUM FULL` / `CLUSTER`。

==============================================================================

## 5. Autovacuum 与 wraparound

`relation_needs_vacanalyze`（`autovacuum.c:2967`）：

```
vacthresh = vacuum_threshold + vacuum_scale_factor * reltuples
            再 cap 到 autovacuum_vacuum_max_threshold（默认 1 亿，-1 关掉）
```

另有 **insert vacuum**：`insert_threshold + insert_scale_factor * reltuples * (1 - relallfrozen/relpages)`。ANALYZE 用 `mod_since_analyze`。

anti-wraparound：`age(relfrozenxid) ≥ autovacuum_freeze_max_age`（默认 2 亿）→ `force_vacuum`，进程名带 `to prevent wraparound`。即使表级 `autovacuum_enabled=off`，这条仍会来。

和 03/07 章对齐，课程「15 亿 ForceTransactionId / 20 亿只读」不要照抄：

| 线 | 18.6 |
|---|---|
| 催 autovac | `xidVacLimit` = oldest + `autovacuum_freeze_max_age` |
| VACUUM failsafe | `vacuum_failsafe_age` 默认 **16 亿**：跳过索引 vacuum，全力推 `relfrozenxid` |
| 拒绝分配 xid | `xidStopLimit` = wrap − 3M（wrap = oldest + 2³¹） |
| 半环翻转 | `xidWrapLimit` |

failsafe 时 `VacuumFailsafeActive`：丢掉 ring buffer 策略、不截断、尽量不再扫索引。

限速：`vacuum_delay_point`，`VacuumCostBalance >= vacuum_cost_limit` 就睡。autovac 默认 `autovacuum_vacuum_cost_delay=2ms`。PG18 读页走 `BAS_VACUUM` ring，大小可由 `vacuum_buffer_usage_limit` / `VACUUM (BUFFER_USAGE_LIMIT …)` 覆盖。

==============================================================================

## gdb

```
break lazy_scan_heap
break heap_page_prune_and_freeze
break HeapTupleSatisfiesVacuum
break heap_prepare_freeze_tuple
break lazy_vacuum_all_indexes
```

`lazy_scan_heap` 停住：

```
p vacrel->relname
p vacrel->aggressive
p vacrel->cutoffs.OldestXmin
p vacrel->cutoffs.FreezeLimit
p vacrel->rel_pages
```

VERBOSE 日志里的 `pages set all-visible / all-frozen`、`new relfrozenxid` 对得上 `vacrel->vm_new_*` 和扫完后的 `pg_class` 更新。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `ExecVacuum` / `vacuum_rel` / `vacuum_get_cutoffs` | `src/backend/commands/vacuum.c` |
| `heap_vacuum_rel` / `lazy_scan_heap` / `lazy_vacuum` | `src/backend/access/heap/vacuumlazy.c` |
| `heap_page_prune_and_freeze` | `src/backend/access/heap/pruneheap.c` |
| `HeapTupleSatisfiesVacuum` | `src/backend/access/heap/heapam_visibility.c` |
| `heap_prepare_freeze_tuple` | `src/backend/access/heap/heapam.c` |
| VM | `src/backend/access/heap/visibilitymap.c`、`visibilitymapdefs.h` |
| FSM | `src/backend/storage/freespace/` |
| autovac 阈值 | `src/backend/postmaster/autovacuum.c` |
| wraparound 限 | `src/backend/access/transam/varsup.c` |
| `HEAP_XMIN_FROZEN` | `src/include/access/htup_details.h` |

==============================================================================

## 和前后章的关系

- [[03-mvcc-clog]]：VACUUM 用同一套 CLOG/hint；收行不看「当前快照」，看 OldestXmin。
- [[07-transaction-subxact]]：无 xid 的纯读不进 `ProcGlobal->xids`，但仍有 xmin，照样挡回收。
- [[05-buffer-manager]]：cleanup lock、`ReadStream`、VACUUM ring。
- [[02-page-tuple]]：HOT 链、`lp_flags` 的 DEAD/UNUSED。
- [[06-lock-manager]]：表锁是 `ShareUpdateExclusiveLock`。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch08-vacuum-freezing.md`
