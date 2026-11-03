# 第 11 章 对照笔记 — Join 顺序与路径生成 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/11-join-paths.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch11-join-paths-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】查询规划器 — Join 顺序与路径生成：优化器如何选中 Nested Loop | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】查询规划器 — Join 顺序与路径生成：优化器如何选中 Nested Loop 2026-06-16 · database · kernel · #postgresql #pg-kernel #query-planner #join-order #nested-loop #hash-join #merge-join #geqo #dynamic-programming #seqscan #indexscan #bitmapscan #explain-analyze #allpaths #joinpath 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #query-planner #join-order #nested-loop #hash-join #merge-join #geqo #dynamic-programming #seqscan #indexscan #bitmapscan #explain-analyze #allpaths #joinpath 目录 查询规划器 — Join 顺序与路径生成：优化器如何选中 Nested Loop 一、从 Query 到 RelOptInfo：make_one_rel 的全景 调用链 make_one_rel() 的内部阶段 关键数据结构 二、基表访问路径：四种扫描方式 SeqScan（顺序扫描） IndexOnlyScan（仅索引扫描） 三、Join 路径生成：三种 Join 方式的创建条件与代价 Hash Join（哈希连接） 三种 Join 的选择对比 GEQO：geqo_threshold 的切换 join_collapse_limit 与 from_collapse_limit 五、并行路径生成 1. 构造三表 Join 和索引选择 3. 强制观察 Hash Join 和 Merge Join 5. 观察并行查询 2. 统计信息漂移导致 Join 顺序错乱 4. 多表 Join 计划不稳定（GEQO 区） 八、关键要点 参考资料 源码（PG 17） 官方文档 论文 查询规划器 — Join 顺序与路径生成：优化器如何选中 Nested Loop 你在 EXPLAIN 输出里见过无数次 Nested Loop 、 Hash Join 、 Merge Join ，也见过 Seq Scan 、 Index Scan 、 Bitmap Index Scan 。但 PG 的优化器到底是怎么决定用哪个的？为什么有时候一个三表 Join 的查询，明明建了索引却走了 Seq Scan？为什么超过一定表数量后执行计划突然变差？ 这些问题的答案都在 make_one_rel() 这个函数里。它是 PG 查询优化器的路径生成入口——从单表扫描方式的选择，到两表 Join 算法的决策，再到多表 Join 顺序的排列搜索，全在这里调度。 本文从 make_one_rel() 的调用链开始，拆解四种访问路径的创建条件、三种 Join 方式的代价对比、动态规划到 GEQO 的切换逻辑，最后用 EXPLAIN (ANALYZE, BUFFERS) 对照 planner 的内部决策。 一、从 Query 到 RelOptInfo：make_one_rel 的全景 调用链 规划器的主入口在 src/backend/optimizer/plan/planner.c 的 standard_planner() 。它调用 subquery_planner() 做子查询规划，后者调用 grouping_planner() ，最终到达 query_planner() ，而 query_planner() 的核心调用就是 make_one_rel() ： ``` text standard_planner() → subquery_planner() → grouping_planner() → query_planner() → add_base_rels_to_query() // 为
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| standard_planner | src/backend/optimizer/plan/planner.c | Planner 入口 |
| make_one_rel | 同上 | 路径生成核心 |
| set_base_rel_pathlists | src/backend/optimizer/path/allpaths.c | 单表路径 |
| make_rel_from_joinlist | 同上 | Join 顺序搜索 |
| cost_seqscan / cost_index | src/backend/optimizer/path/costsize.c | 代价函数 |
| try_nestloop / try_hashjoin | src/backend/optimizer/path/joinpath.c | 各种 join 策略 |
| GEQO | src/backend/optimizer/geqo/geqo_main.c | 遗传算法, >12 表切换 |
| Path | src/include/nodes/pathnodes.h | pathlist 元素 |


## 三、PG18 源码摘录


### 11.1 standard_planner (planner.c)
```c

PlannedStmt *
standard_planner(Query *parse, const char *query_string, int cursorOptions,
				 ParamListInfo boundParams)
{
	PlannedStmt *result;
	PlannerGlobal *glob;
	double		tuple_fraction;
	PlannerInfo *root;
	RelOptInfo *final_rel;
	Path	   *best_path;
	Plan	   *top_plan;
	ListCell   *lp,
			   *lr;

	/*
	 * Set up global state for this planner invocation.  This data is needed
	 * across all levels of sub-Query that might exist in the given command,
	 * so we keep it in a separate struct that's linked to by each per-Query
	 * PlannerInfo.
	 */
	glob = makeNode(PlannerGlobal);

	glob->boundParams = boundParams;
	glob->subplans = NIL;
	glob->subpaths = NIL;
	glob->subroots = NIL;
	glob->rewindPlanIDs = NULL;
	glob->finalrtable = NIL;
	glob->allRelids = NULL;
	glob->prunableRelids = NULL;
	glob->finalrteperminfos = NIL;
	glob->finalrowmarks = NIL;
	glob->resultRelations = NIL;
	glob->appendRelations = NIL;
	glob->partPruneInfos = NIL;
	glob->relationOids = NIL;
	glob->invalItems = NIL;
	glob->paramExecTypes = NIL;
	glob->lastPHId = 0;
	glob->lastRowMarkId = 0;
	glob->lastPlanNodeId = 0;
	glob->transientPlan = false;
	glob->dependsOnRole = false;
	glob->partition_directory = NULL;

	/*
	 * Assess whether it's feasible to use parallel mode for this query. We
	 * can't do this in a standalone backend, or if the command will try to
	 * modify any data, or if this is a cursor operation, or if GUCs are set
	 * to values that don't permit parallelism, or if parallel-unsafe
	 * fu
```

### 11.2 cost_hashjoin 代价
```c

```

### 11.3 Path 结构 (pathnodes.h)
```c
typedef struct Path
{
	pg_node_attr(no_copy_equal, no_read, no_query_jumble)

	NodeTag		type;

	/* tag identifying scan/join method */
	NodeTag		pathtype;

	/*
	 * the relation this path can build
	 *
	 * We do NOT print the parent, else we'd be in infinite recursion.  We can
	 * print the parent's relids for identification purposes, though.
	 */
	RelOptInfo *parent pg_node_attr(write_only_relids);

	/*
	 * list of Vars/Exprs, cost, width
	 *
	 * We print the pathtarget only if it's not the default one for the rel.
	 */
	PathTarget *pathtarget pg_node_attr(write_only_nondefault_pathtarget);

	/*
	 * parameterization info, or NULL if none
	 *
	 * We do not print the whole of param_info, since it's printed via
	 * RelOptInfo; it's sufficient and less cluttering to print just the
	 * required outer relids.
	 */
	ParamPathInfo *param_info pg_node_attr(write_only_req_outer);

	/* engage parallel-aware logic? */
	bool		parallel_aware;
	/* OK to use as part of parallel plan? */
	bool		parallel_safe;
	/* desired # of workers; 0 = not parallel */
	int			parallel_workers;

	/* estimated size/costs for path (see costsize.c for more info) */
	Cardinality rows;			/* estimated number of result tuples */
	int			disabled_nodes; /* count of disabled nodes */
	Cost		startup_cost;	/* cost expended before fetching any tuples */
	Cost		total_cost;		/* total cost (assuming all tuples fetched) */

	/* sort ordering of path's output; a List of PathKey nodes; see above */
	List	   *pathkeys;
} Path;
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 path 生成**: 算法未变, DP 算法 (动态规划) + GEQO 阈值 12 表
2. **Parallel**: PG9.6+ parallel scan/join/agg, PG18 仍支持
3. **Partition pruning**: PG11+ 分区裁剪稳定, PG18 仍为 run-time pruning (RLS 协调)
4. **Stats 扩展**: CREATE STATISTICS 已用, 见 ch10


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch11-join-paths-evidence.txt`


### 关键输出
```
DROP TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
INSERT 0 100
INSERT 0 1000
INSERT 0 500
ANALYZE
                                QUERY PLAN                                 
---------------------------------------------------------------------------
 Hash Join  (cost=18.87..93.62 rows=5000 width=23)
   Hash Cond: (b.aid = a.id)
   ->  Seq Scan on b  (cost=0.00..16.00 rows=1000 width=8)
   ->  Hash  (cost=12.62..12.62 rows=500 width=15)
         ->  Hash Join  (cost=3.25..12.62 rows=500 width=15)
               Hash Cond: (c.aid = a.id)
               ->  Seq Scan on c  (cost=0.00..8.00 rows=500 width=8)
               ->  Hash  (cost=2.00..2.00 rows=100 width=7)
                     ->  Seq Scan on a  (cost=0.00..2.00 rows=100 width=7)
(9 rows)

SET
                                 QUERY PLAN                                 
----------------------------------------------------------------------------
 Nested Loop  (cost=0.15..58.17 rows=1000 width=15)
   ->  Seq Scan on b  (cost=0.00..16.00 rows=1000 width=8)
   ->  Memoize  (cost=0.15..0.18 rows=1 width=7)
         Cache Key: b.aid
         Cache Mode: logical
         ->  Index Scan using a_pkey on a  (cost=0.14..0.17 rows=1 width=7)
               Index Cond: (id = b.aid)
(7 rows)

SET
SET
                          QUERY PLAN                           
---------------------------------------------------------------
 Hash Join  (cost=3.25..21.99 rows=1000 width=15)
   Hash Cond: (b.aid = a.id)
   ->  Seq Scan on b  (cost=0.00..16.00 rows=1000 width=8)
   ->  Hash  (cost=2.00..2.00 rows=100 width=7)
         ->  Seq Scan on a  (cost=0.00..2.00 rows=100 width=7)
(5 rows)

SET
DROP TABLE
CREATE TABLE
INSERT 0 10
 geqo_threshold 
----------------
 12
(1 row)


```


## 六、GDB 调试示例


观察 Planner 选择路径:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break planner.c:standard_planner
(gdb) break allpaths.c:set_base_rel_pathlists
(gdb) break costsize.c:cost_hashjoin
(gdb) continue
# 另一窗口: SELECT * FROM a JOIN b ON ...;
# GDB 依次停在 planner 各阶段, finish 看返回的 PlannedStmt
```

观察 GEQO 切换:
```
(gdb) break geqo_main.c:geqo
(gdb) continue
# 12+ 表 join 触发
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 Planner = DP (≤12 表) / GEQO (>12 表)
- 已掌握: Path 结构 (启动代价/总代价/排序信息)
- 待查: Ch.12 Executor — Path 如何变成 PlanNode, Volcano 调度
