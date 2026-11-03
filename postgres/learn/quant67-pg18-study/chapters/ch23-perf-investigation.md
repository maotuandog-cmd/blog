# 第 23 章 对照笔记 — 性能异常调查方法论 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/23-perf-investigation.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch23-perf-investigation-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】性能异常调查方法论：从现象到内核根因的五层调查链 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】性能异常调查方法论：从现象到内核根因的五层调查链 2026-06-16 · database · kernel · #postgresql #pg-kernel #performance #pg_stat_statements #explain #wait_event #pg_locks #perf #bpftrace #plan_cache_mode #lwlock #shared_buffers #pg_wait_sampling #pg_stat_kcache 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #performance #pg_stat_statements #explain #wait_event #pg_locks #perf #bpftrace #plan_cache_mode #lwlock #shared_buffers #pg_wait_sampling #pg_stat_kcache 目录 性能异常调查方法论：从现象到内核根因的五层调查链 一、调查链全景 pg_stat_statements 的边界 三、第二层：EXPLAIN (ANALYZE, BUFFERS, SETTINGS) 解剖执行计划 三个关键选项 四、第三层：pg_stat_activity + wait_event 诊断等待类型 查询当前等待状态 最常见的误判：ClientRead 五、第四层：pg_locks + pg_blocking_pids() 追踪锁等待链 单层锁查询 六、第五层：OS 层确认物理瓶颈 iostat 确认磁盘 perf 追踪 CPU 调用栈 bpftrace 追踪内核调用栈 七、特殊场景一：有时快有时慢 —— 计划缓存与 generic/custom plan 现象 根因：generic plan 与 custom plan 的切换 解决方案顺序 八、特殊场景二：CPU 100% 但没慢查询 —— LWLock 自旋与隐藏开销 现象 根因一：LWLock 自旋 九、特殊场景三：IO 打满但命中率 99% —— 命中率骗局 现象 为什么命中率会撒谎 验证：pg_statio_user_tables 定位 I/O 源头 解决方案方向 十、工具链集成：pg_stat_statements + pg_wait_sampling + pg_stat_kcache pg_wait_sampling 三者的组合使用场景 十一、调查清单总结 十二、关键要点 参考资料 源码（PG 17） 官方文档 扩展文档 性能异常调查方法论：从现象到内核根因的五层调查链 一个慢查询摆在面前，新手的第一反应是 EXPLAIN ，然后盯着 cost 和 rows 猜问题。但生产环境的性能异常很少孤立存在——同样的 SQL 有时快有时慢？CPU 满载但 pg_stat_statements 里没有慢查询？ shared_buffers 命中率 99% 但磁盘 IO 快被打穿？ 这些问题不是一条命令能回答的。本文定义一条五层调查链，每一层聚焦一个具体问题，层与层之间有明确的”什么时候往下一层走”的决策条件。它不是工具清单，而是从现象推到内核根因的排查路径。 一、调查链全景 五层调查链的推进逻辑：从应用层可见的 SQL 统计开始，逐步往下钻到 PG 内部执行细节、等待事件、锁关系和 OS 物理资源。 flowchart TD L1[ 第一层：pg_stat_statements br/ 哪个查询是瓶颈？ ] L2[ 第二层：EXPLAIN (ANALYZE, BUFFERS, SETTINGS) br/ 执行计划哪里出了问题？ ] L3[ 第三层：pg_stat_activity + wait_event br/ 查询在等什么？ ] L4[ 第四层：pg_locks + pg_blocking_pids() br/ 谁在锁谁？ ] L5[ 第五层：OS 层工具 br/ 物理瓶颈是什么？ ] L1 -- | 定位高耗时/高频率 queryid | L2
```

## 二、PG18 源码定位


| 工具 | PG18 文件/路径 | 用途 |
|---|---|---|
| pg_stat_statements | contrib/pg_stat_statements | 定位慢 query |
| EXPLAIN (ANALYZE, BUFFERS) | src/backend/commands/explain.c | 看执行计划 |
| wait_event | src/backend/postmaster/pgstat.c | 等待事件 |
| pg_locks | 系统视图 | 锁等待 |
| perf / bpftrace | 外部 | syscall / 内核 trace |


## 三、PG18 源码摘录


### 23.1 ExplainQuery 入口
```c
void
ExplainQuery(ParseState *pstate, ExplainStmt *stmt,
			 ParamListInfo params, DestReceiver *dest)
{
	ExplainState *es = NewExplainState();
	TupOutputState *tstate;
	JumbleState *jstate = NULL;
	Query	   *query;
	List	   *rewritten;

	/* Configure the ExplainState based on the provided options */
	ParseExplainOptionList(es, stmt->options, pstate);

	/* Extract the query and, if enabled, jumble it */
	query = castNode(Query, stmt->query);
	if (IsQueryIdEnabled())
		jstate = JumbleQuery(query);

	if (post_parse_analyze_hook)
		(*post_parse_analyze_hook) (pstate, query, jstate);

	/*
	 * Parse analysis was done already, but we still have to run the rule
	 * rewriter.  We do not do AcquireRewriteLocks: we assume the query either
	 * came straight from the parser, or suitable locks were acquired by
	 * plancache.c.
	 */
	rewritten = QueryRewrite(castNode(Query, stmt->query));

	/* emit opening boilerplate */
	ExplainBeginOutput(es);

	if (rewritten == NIL)
	{
		/*
		 * In the case of an INSTEAD NOTHING, tell at least that.  But in
		 * non-text format, the output is delimited, so this isn't necessary.
		 */
		if (es->format == EXPLAIN_FORMAT_TEXT)
			appendStringInfoString(es->str, 
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 调查方法论**: 仍是 5 层链
2. **新 wait_event**: PG18 AIO 类
3. **EXPLAIN BUFFERS**: 必加


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch23-perf-investigation-evidence.txt`


### 关键输出
```
CREATE EXTENSION

```


## 六、GDB 调试示例

步骤: pg_stat_statements → EXPLAIN → wait_event → pg_locks → perf top -p <pid>

## 七、小结 — 与下章衔接

已掌握: 5 层调查链. 待查 Ch.24 PITR 边界.