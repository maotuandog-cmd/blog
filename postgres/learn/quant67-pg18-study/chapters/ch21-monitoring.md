# 第 21 章 对照笔记 — 监控体系与告警设计 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/21-monitoring.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch21-monitoring-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】监控体系与告警设计：从内核机制出发定义该监控什么 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】监控体系与告警设计：从内核机制出发定义该监控什么 2026-06-16 · database · kernel · #postgresql #pg-kernel #monitoring #observability #pg-stat-statements #pg-stat-activity #pg-locks #pg-stat-replication #autovacuum #prometheus #alerting #pgbadger #pgcenter 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #monitoring #observability #pg-stat-statements #pg-stat-activity #pg-locks #pg-stat-replication #autovacuum #prometheus #alerting #pgbadger #pgcenter 目录 监控体系与告警设计：从内核机制出发定义该监控什么 一、六个监控维度与内核故障模式 二、连接与进程：从 PGPROC 槽位到 sysidle 的含义 内核数据来源 基础连接监控：状态分布 真正危险的指标：idle in transaction 的持续时间和影响链 连接数的监控不应只看”用了百分之几” 三、存储与膨胀：dead tuple 的动态平衡与 XID 年龄的倒计时 内核数据来源 膨胀监控 SQL 和三个核心比率 复制延迟的三层 LSN WAL 段堆积与 replication slot 五、查询性能：pg_stat_statements 的突变检测与统计信息的保质期 内核数据来源 核心监控 SQL calls 频率异常 追踪等待链 LWLock 争用：pg_locks 看不到的等待 Checkpoint I/O 监控 autovacuum_vacuum_cost_delay 的平衡 n_dead_tup / n_live_tup 的告警分层 九、监控数据源本身的坑 pg_stat_statements 的 queryid 陷阱 十、工具集成：四层互补架构 第一层：pg_stat_* 视图 —— 即时精确状态 第二层：Prometheus + pg_exporter —— 时间序列与趋势告警 第四层：pgCenter —— 实时现场诊断 监控接入路径：从零到有 四层分工总结 十一、关键要点 参考资料 源码（PG 17） 官方文档 工具 监控体系与告警设计：从内核机制出发定义该监控什么 PG 的内核暴露了一组统计视图—— pg_stat_activity 、 pg_stat_user_tables 、 pg_stat_statements 、 pg_stat_replication 、 pg_locks 等等。这些视图是内核数据结构的窗口： pg_stat_activity 背后是 ProcArray 和 PGPROC ， pg_locks 背后是 LockAcquire() 操作的 lock hash table， pg_stat_user_tables.n_dead_tup 背后是 VACUUM 留下的 dead tuple 计数器， pg_stat_replication 的 LSN 延迟来自 WAL Sender 和 Receiver 之间的协议交互。 大多数 PG 监控指南会给你一个 Grafana dashboard JSON 和一套告警规则，然后告诉你”照着配就行”。这种方式的三个致命缺陷是：第一，你不知道每个指标的内核含义—— n_dead_tup 为什么在 VACUUM 间隔期间是陈旧值、 write_lag=0 是正常还是 standby 已经挂了，这些阈值判断只有从内核机制出发才能分辨；第二，dashboard 上的阈值（“shared_buffers 命中率低于 95% 告警”）往往是通用模板的产物，不区分负载类型和硬件；第三，dashboard 关注的是事后指标，而内核视角告诉你的是 故障模式的前兆信号 —
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| pg_stat_* 视图 | src/backend/utils/adt/pgstatfuncs.c | 全部统计视图 |
| pg_stat_progress_* | src/backend/commands/* | 进度视图 (vacuum/analyze/create index) |
| WaitEvent | src/include/pgstat.h | 等待事件 |
| pg_stat_statements | contrib/pg_stat_statements | SQL 级统计 |
| 6 监控维度 | (聚合) | 连接/膨胀/WAL/查询/锁/命中率 |


## 三、PG18 源码摘录


### 21.1 pgstatfuncs.c 中 pg_stat_get_activity 入口
```c
Datum
pg_stat_get_activity(PG_FUNCTION_ARGS)
{
#define PG_STAT_GET_ACTIVITY_COLS	31
	int			num_backends = pgstat_fetch_stat_numbackends();
	int			curr_backend;
	int			pid = PG_ARGISNULL(0) ? -1 : PG_GETARG_INT32(0);
	ReturnSetInfo *rsinfo = (ReturnSetInfo *) fcinfo->resultinfo;

	InitMaterializedSRF(fcinfo, 0);

	/* 1-based index */
	for (curr_backend = 1; curr_backend <= num_backends; curr_backend++)
	{
		/* for each row */
		Datum		values[PG_STAT_GET_ACTIVITY_COLS] = {0};
		bool		nulls[PG_STAT_GET_ACTIVITY_COLS] = {0};
		LocalPgBackendStatus *local_beentry;
		PgBackendStatus *beentry;
		PGPROC	   *proc;
		const char *wait_event_type = NULL;
		const char *wait_event = NULL;

		/* Get the next one in the list */
		local_beentry = pgstat_get_local_beentry_by_index(curr_backend);
		beentry = &local_beentry->backendStatus;

		/* If looking for specific PID, ignore all the others */
		if (pid != -1 && beentry->st_procpid != pid)
			continue;

		/* Values available to all callers */
		if (beentry->st_databaseid != InvalidOid)
			values[0] = ObjectIdGetDatum(beentry->st_databaseid);
		else
			nulls[0] = true;

		values[1] = Int32GetDatum(beentry->st_procpid);

		if (beentry->st_userid != InvalidOid)
			values[2] = ObjectIdGetDatum(beentry->st_userid);
		else
			nulls[2] = true;

		if (beentry->st_appname)
			values[3] = CStringGetTextDatum(beentry->st_appname);
		else
			nulls[3] = true;

		if (TransactionIdIsValid(local_beentry->backend_xid))
			values[15] = TransactionIdGetDatum(
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 监控视图新增**:
   - pg_stat_progress_vacuum (PG16+)
   - wait_event 新增 AIO 类 (PG18 GA 异步 IO)
2. **pg_stat_statements**: PG18 沿用 (normalized query / reset)
3. **6 监控维度**: 连接 / 膨胀 / WAL / 查询 / 锁 / 命中率


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch21-monitoring-evidence.txt`


### 关键输出
```
  pid  | datname  | usename  |  backend_type  | state  | wait_event_type | wait_event |                                           query                                           
-------+----------+----------+----------------+--------+-----------------+------------+-------------------------------------------------------------------------------------------
 47733 | postgres | postgres | client backend | active |                 |            |                                                                                          +
       |          |          |                |        |                 |            | SELECT pid, datname, usename, backend_type, state, wait_event_type, wait_event, query    +
       |          |          |                |        |                 |            | FROM pg_stat_activity WHERE backend_type='client backend' ORDER BY backend_start LIMIT 5;+
       |          |          |                |        |                 |            | SELECT datname, xact_commit, xact_rollback, blks_read, blks_hit,                         +
       |          |          |                |        |                 |            |        round(100.0 * blks_hit / NULLIF(blks_hit+blks_read, 0), 2) AS hit_pct             +
       |          |          |                |        |                 |            | FROM pg_stat_database WHERE datname='postgres';                                          +
       |          |          |                |        |                 |            | SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_relation_size(relid)) AS size  +
       |          |          |                |        |                 |            | FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_dead_tup DESC LIMIT 5;          +
       |          |          |                |        |                 |            | SELECT locktype, mode, granted, count(*) FROM pg_locks GROUP BY 1,2,3 ORDER BY 1,2,3;    +
       |          |          |                |        |                 |            | SELECT pid, application_name, state, sync_state FROM pg_stat_replication;                +
       |          |          |                |        |                 |            | SELECT * FROM pg_stat_progress_vacuum;                                                   +
       |          |          |                |        |                 |            | 
(1 row)

 datname  | xact_commit | xact_rollback | blks_read | blks_hit | hit_pct 
----------+-------------+---------------+-----------+----------+---------
 postgres |         356 |            18 |      1244 |  1180065 |   99.89
(1 row)

 relname | n_live_tup | n_dead_tup |    size    
---------+------------+------------+------------
 c       |        500 |          0 | 24 kB
 b       |       1000 |          0 | 48 kB
 t_stat  |      10000 |          0 | 440 kB
 t1      |         10 |          0 | 8192 bytes
 a       |        100 |          0 | 8192 bytes
(5 rows)

  locktype  |      mode       | granted | count 
------------+-----------------+---------+-------
 relation   | AccessShareLock | t       |    21
 virtualxid | ExclusiveLock   | t       |     1
(2 rows)

 pid | application_name | state | sync_state 
-----+------------------+-------+------------
(0 rows)

 pid | datid | datname | relid | phase | heap_blks_total | heap_blks_scanned | heap_blks_vacuumed | index_vacuum_count | max_dead_tuple_bytes | dead_tuple_bytes | num_dead_item_ids | indexes_total | indexes_processed | delay_time 
-----+-------+---------+-------+-------+-----------------+-------------------+--------------------+--------------------+----------------------+------------------+-------------------+---------------+-------------------+------------
(0 rows)


```


## 七、小结 — 与下章衔接

已掌握: PG18 监控 6 维度, 待查 Ch.22 故障信号解读.