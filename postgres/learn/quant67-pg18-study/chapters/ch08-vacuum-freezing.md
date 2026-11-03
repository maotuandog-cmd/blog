# 第 08 章 对照笔记 — VACUUM 与 Freezing (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/08-vacuum-freezing.txt`
> **实现详解**: `/home/obsidian/postgres/learn/quant67-pg-kernel/08-vacuum-freezing.md`
> 证据: `evidence/ch08-vacuum-evidence.txt` + `evidence/ch08-gdb-vacuum.txt`

==============================================================================

## 一、课程要点（节选）

> MVCC 把旧版本留在 heap 上，必须 VACUUM：扫 heap、收 dead tuple、清索引、更新 FSM/VM。freeze 把足够老的 xmin 变成 FrozenXid，否则 32 位 xid 半圆比较会炸。autovacuum 跟不上就会走向 wraparound 只读。

==============================================================================

## 二、PG18 源码定位

| 概念 | 文件:行 | 说明 |
|---|---|---|
| `ExecVacuum` | `vacuum.c:162`（活栈停在处理路径 `:471` 附近） | SQL 入口 |
| `vacuum_rel` | `vacuum.c:2018` | `ShareUpdateExclusiveLock` + `PROC_IN_VACUUM` |
| `vacuum_get_cutoffs` | `vacuum.c:1116` | `OldestXmin` / `FreezeLimit` / 是否 aggressive |
| `heap_vacuum_rel` | `vacuumlazy.c:615` | lazy 主入口 |
| `lazy_scan_heap` | `vacuumlazy.c:1200` | **ReadStream** 扫 heap |
| `heap_page_prune_and_freeze` | `pruneheap.c:350` | prune 和 freeze 同一趟 |
| `HeapTupleSatisfiesVacuum` | `heapam_visibility.c:1171` | **不在** `tqual.c` |
| `heap_prepare_freeze_tuple` | `heapam.c:7316` | 计划 freeze；执行看页级 `freeze_required` |
| `lazy_vacuum` | `vacuumlazy.c:2464` | 先索引，再 heap LP_DEAD→UNUSED |
| VM 2 bit | `visibilitymapdefs.h` | `ALL_VISIBLE` / `ALL_FROZEN` |
| autovac 阈值 | `autovacuum.c:2967` | 含 `vacuum_max_threshold`、insert vacuum |
| failsafe | `vacuum.c:1283` / `vacuumlazy.c:2964` | 默认 `vacuum_failsafe_age=16亿` |
| `SetTransactionIdLimit` | `varsup.c` | wraparound 四阈值（03/07 已纠正） |

==============================================================================

## 三、PG18 vs 课程

1. 可见性函数在 `heapam_visibility.c`，不是 `tqual.c`。
2. 不是「先清 heap 再清索引」。**必须先 `lazy_vacuum_all_indexes`，再把 LP_DEAD 改成 LP_UNUSED**。prune（HOT + 标 DEAD）发生在扫描当页，和 freeze 合成 `heap_page_prune_and_freeze`。
3. dead TID 用 `TidStore`，上限 `maintenance_work_mem`，不是简单 `dead_tuples` 数组。
4. 扫 heap 走 `ReadStream`，与 05 章一致。
5. 截断门槛 `REL_TRUNCATE_MINIMUM=1000` 页，不是 32。
6. VM：每 heap 页 2 bit；一页 VM 覆盖约 **3.2 万** heap 页，不是课程的 131072。
7. freeze 主要置 `HEAP_XMIN_FROZEN` 位，一般不把 xmin 改成 2。`FreezeLimit = nextXID - vacuum_freeze_min_age`，且 ≤ `OldestXmin`。
8. wraparound：课程「15 亿写阻塞 / 20 亿只读」应换成 07 章的 wrap−3M / wrap=oldest+2³¹。18.6 另有 `vacuum_failsafe_age`（默认 16 亿）跳过索引 vacuum。
9. autovac 公式多了 `autovacuum_vacuum_max_threshold`（默认 1 亿）和 insert vacuum；PG18 还有 eager freeze scan。

==============================================================================

## 四、真实栈

活进程 `VACUUM t_vac`：

```
lazy_scan_heap (vacrel=...) at vacuumlazy.c:1201
  ← heap_vacuum_rel (vacuumlazy.c:839)
  ← table_relation_vacuum
  ← vacuum_rel (vacuum.c:2317)
  ← vacuum (vacuum.c:649)
  ← ExecVacuum (vacuum.c:471)
  ← ProcessUtility
```

==============================================================================

## 五、实操

1000 行插入后两次整表 UPDATE，再 `VACUUM VERBOSE`：

- `tuples: 1000 removed, 1000 remain`
- `pages: 13 remain, 13 scanned (100%)`
- `new relfrozenxid: 788`（前进 3）
- VM：`13 pages set all-visible, 7 pages set all-frozen`
- 之后 `n_live_tup=1000, n_dead_tup=0`

未开 2PC、未做 wraparound 压测。

==============================================================================

## 六、交接

实现正文已写在 `quant67-pg-kernel/08-vacuum-freezing.md`：两趟顺序、ReadStream、TidStore、prune+freeze、VM/FSM、failsafe。

主链下一章是 **12 执行器**（`ExecProcNode`）。规划器 09–11、B-Tree 14 仍按站点「内核开发者」路径接在执行器之后或穿插。
