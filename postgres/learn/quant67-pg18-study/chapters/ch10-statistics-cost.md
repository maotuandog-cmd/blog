# 第 10 章 对照笔记 — 统计信息与代价模型 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/10-statistics-cost.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch10-statistics-cost-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】查询规划器 — 统计信息与代价模型：优化器为什么选错了索引 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】查询规划器 — 统计信息与代价模型：优化器为什么选错了索引 2026-06-16 · database · kernel · #postgresql #pg-kernel #query-planner #statistics #cost-model #selectivity #analyze #histogram #mcv #stats-drift #create-statistics #random-page-cost #explain 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #query-planner #statistics #cost-model #selectivity #analyze #histogram #mcv #stats-drift #create-statistics #random-page-cost #explain 目录 查询规划器 — 统计信息与代价模型：优化器为什么选错了索引 一、pg_class 和 pg_statistic 里存了什么 pg_class：宏观信息 采样精度问题 统计信息写入 三、选择率估算：clauselist_selectivity 的调用链 调用链全景 各类 xxxsel 函数的估算逻辑 独立性与多列陷阱 四、代价常量：从选择率到执行成本 代价常量的定义与物理意义 如何判断是否需要扩展统计 解释 优化器为什么”选错”了 七、排查：统计信息漂移的诊断 第一步：检查 n_mod_since_analyze 和 last_analyze 第三步：insert-only 表的特殊问题 第四步：检查 default_statistics_target 是否过低 八、auto_explain + auto_analyze 不触发的根因排查 auto_explain 配置检查 auto_analyze 不触发的常见根因 没有统计信息的临时表的行为 十一、关键要点 参考资料 源码（PG 17） 官方文档 论文 工具与实验 查询规划器 — 统计信息与代价模型：优化器为什么选错了索引 你建了索引， EXPLAIN 一看，优化器还是在走 Seq Scan。你排查了索引损坏、检查了数据类型、确认了查询条件是 = 而非 LIKE ——最后发现 EXPLAIN ANALYZE 里 “rows=1” 的估计，实际跑出来是 100 万行。 这就是统计信息不准导致灾难性计划的经典场景。优化器不是错了——在它眼中，用索引查 1 行确实比扫全表划算。问题出在它”眼中”的数据分布和真实数据已经完全错位。 PG 的查询优化器是一个基于代价（cost-based）的规划器。它做每一个决策——走 Seq Scan 还是 Index Scan、用 NestLoop 还是 HashJoin、先 join 表 A 还是表 B——都依赖两样东西：统计数据（ pg_statistic 系统表）和代价常量（ seq_page_cost 、 random_page_cost 等 GUC）。本文拆解的就是这两样东西在源码中是如何产生、存储、计算，以及出错后怎么诊断。 一、pg_class 和 pg_statistic 里存了什么 优化器在做代价估算之前，首先要回答一个更基本的问题： 这个查询会返回多少行？ 这个数字叫选择率（selectivity），它决定了所有后续决策。而选择率的计算，完全依赖 pg_class 和 pg_statistic 两个系统表。 pg_class：宏观信息 pg_class 存储每个表（和索引）的基础统计元组： SELECT relname, relpages, reltuples, relallvisible FROM pg_class WHERE relname = &#39;orders&#39; ; ```text | 字段 | 含义 | 优化器用途 | | ------|------|-----------| | `relpages` | 表的页面数（由 ANALYZE 估算） | 
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| pg_statistic | src/include/catalog/pg_statistic.h | 系统表, MCV/histogram |
| ANALYZE 主路径 | src/backend/commands/analyze.c | analyze_rel, 采样 |
| compute_scalar_stats | 同上 | 单列统计 |
| compute_trivariate_stats | 同上 | 扩展统计 (PG10+) |
| selfuncs | src/backend/utils/adt/selfuncs.c | 选择率估算 |
| eqsel / scalarltsel | 同上 | 等值/范围 选择率 |
| planner_cost | src/backend/optimizer/path/costsize.c | 代价计算 |
| CREATE STATISTICS | src/backend/commands/statscmds.c | 扩展统计 |


## 三、PG18 源码摘录


### 10.1 pg_statistic 行格式 (pg_statistic.h)
```c

```

### 10.2 ANALYZE 入口 (analyze.c)
```c
void
analyze_rel(Oid relid, RangeVar *relation,
			VacuumParams *params, List *va_cols, bool in_outer_xact,
			BufferAccessStrategy bstrategy)
{
	Relation	onerel;
	int			elevel;
	AcquireSampleRowsFunc acquirefunc = NULL;
	BlockNumber relpages = 0;

	/* Select logging level */
	if (params->options & VACOPT_VERBOSE)
		elevel = INFO;
	else
		elevel = DEBUG2;

	/* Set up static variables */
	vac_strategy = bstrategy;

	/*
	 * Check for user-requested abort.
	 */
	CHECK_FOR_INTERRUPTS();

	/*
	 * Open the relation, getting ShareUpdateExclusiveLock to ensure that two
	 * ANALYZEs don't run on it concurrently.  (This also locks out a
	 * concurrent VACUUM, which doesn't matter much at the moment but might
	 * matter if we ever try to accumulate stats on dead tuples.) If the rel
	 * has been dropped since we last saw it, we don't need to process it.
	 *
	 * Make sure to generate only logs for ANALYZE in this case.
	 */
	onerel = vacuum_open_relation(relid, relation, params->options & ~(VACOPT_VACUUM),
								  params->log_min_duration >= 0,
								  ShareUpdateExclusiveLock);

	/* leave if relation could not be opened or locked */
	if (!onerel)
		return;

	/*
	 * Check if relation needs to be skipped based on privileges.  This check
	 * happens also when building the relation list to analyze for a manual
	 * operation, and needs to be done additionally here as ANALYZE could
	 * happen across multiple transactions where privileges could have changed
	 * in-between.  Make sure to gen
```

### 10.3 random_page_cost 默认值 (guc_tables.c)
```
 the planner's estimate of the cost of a "
						 "sequentially fetched disk page."),
			NULL,
			GUC_EXPLAIN
		},
		&seq_page_cost,
		DEFAULT_SEQ_PAGE_COST, 0, DBL_MAX,
		NULL, NULL, NULL
	},
	{
		{"
```

### 10.4 seq_page_cost / random_page_cost (guc.c)
```

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 统计信息路径未变**: 仍是 MCV (most common vals) + histogram + correlation
2. **扩展统计**: CREATE STATISTICS 仍是 PG10+ 引入的 ndistinct/dependencies/mcv
3. **random_page_cost**: 默认 4.0 (PG18 仍如此, SSD/NVMe 应调低到 1.1-1.5)
4. **statistics target**: default_statistics_target = 100, ALTER TABLE ... SET STATISTICS 可调
5. **PG18 ANALYZE**: 算法未变, vacuumlazy.c 调 compute_stats, 但表小则跳过


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch10-statistics-cost-evidence.txt`


### 关键输出
```
           name            | setting | unit 
---------------------------+---------+------
 cpu_index_tuple_cost      | 0.005   | 
 cpu_operator_cost         | 0.0025  | 
 cpu_tuple_cost            | 0.01    | 
 default_statistics_target | 100     | 
 effective_cache_size      | 524288  | 8kB
 jit                       | on      | 
 random_page_cost          | 4       | 
 seq_page_cost             | 1       | 
(8 rows)

DROP TABLE
CREATE TABLE
INSERT 0 10000
ANALYZE
 starelid | staattnum | stainherit | stanullfrac | stawidth | stadistinct | stakind1 | staop1 |                stanumbers1                
----------+-----------+------------+-------------+----------+-------------+----------+--------+-------------------------------------------
 t_stat   |         1 | f          |           0 |        4 |          -1 |        2 |     97 | 
 t_stat   |         2 | f          |           0 |        5 |          -1 |        2 |    664 | 
 t_stat   |         3 | f          |           0 |        2 |          10 |        1 |     98 | {0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1}
(3 rows)

 attname  | null_frac | avg_width | n_distinct |   most_common_vals    |             most_common_freqs             |                                                                                                                                                                                                                                                                                                       histogram_bounds                                                                                                                                                                                                                                                                                                       | correlation 
----------+-----------+-----------+------------+-----------------------+-------------------------------------------+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+-------------
 id       |         0 |         4 |         -1 |                       |                                           | {1,100,200,300,400,500,600,700,800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2100,2200,2300,2400,2500,2600,2700,2800,2900,3000,3100,3200,3300,3400,3500,3600,3700,3800,3900,4000,4100,4200,4300,4400,4500,4600,4700,4800,4900,5000,5100,5200,5300,5400,5500,5600,5700,5800,5900,6000,6100,6200,6300,6400,6500,6600,6700,6800,6900,7000,7100,7200,7300,7400,7500,7600,7700,7800,7900,8000,8100,8200,8300,8400,8500,8600,8700,8800,8900,9000,9100,9200,9300,9400,9500,9600,9700,9800,9900,10000}                                                                                                              |           1
 payload  |         0 |         5 |         -1 |                       |                                           | {p1,p1087,p1177,p1267,p1357,p1447,p1537,p1627,p1717,p1807,p1898,p1988,p2077,p2167,p2257,p2347,p2437,p2527,p2617,p2707,p2798,p2888,p2978,p3067,p3157,p3247,p3337,p3427,p3517,p3607,p3698,p3788,p3878,p3968,p4057,p4147,p4237,p4327,p4417,p4507,p4598,p4688,p4778,p4868,p4958,p5047,p5137,p5227,p5317,p5407,p5498,p5588,p5678,p5768,p5858,p5948,p6037,p6127,p6217,p6307,p6398,p6488,p6578,p6668,p6758,p6848,p6938,p7027,p7117,p7207,p7298,p7388,p7478,p7568,p7658,p7748,p7838,p7928,p8017,p8107,p8198,p8288,p8378,p8468,p8558,p8648,p8738,p8828,p8918,p9007,p9098,p9188,p9278,p9368,p9458,p9548,p9638,p9728,p9818,p9908,p9999} |  0.81865406
 category |         0 |         2 |         10 | {0,1,2,3,4,5,6,7,8,9} | {0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1} |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |   0.1004499
(3 rows)

CREATE STATISTICS
ANALYZE
  oid  | stxrelid | stxname  | stxnamespace | stxowner | stxkeys | stxstattarget | stxkind | stxexprs 
-------+----------+----------+--------------+----------+---------+---------------+---------+----------
 16499 |    16494 | s_t_stat |         2200 |       10 | 1 3     |               | {d,f}   | 
(1 row)


```


## 六、GDB 调试示例


观察 ANALYZE 采样流程:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break analyze.c:acquire_sample_rows
(gdb) continue
# 另一窗口: ANALYZE t_stat;
```

观察选择率估算 (eqsel 是黄金观测点):
```
(gdb) break selfuncs.c:eqsel
(gdb) continue
# 另一窗口: SELECT * FROM t_stat WHERE id = 100;
# GDB 停在 eqsel, print *eqop, print *var, finish 看返回值
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 pg_statistic (MCV/histogram/correlation), ANALYZE 采样
- 已掌握: selfuncs 选择率函数 (eqsel/scalarltsel)
- 待查: Ch.11 Join 顺序 — 统计信息如何驱动 planner 选路径
