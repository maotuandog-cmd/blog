# 第 22 章 对照笔记 — 经典故障 5 例 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/22-classic-failures.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch22-classic-failures-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】经典故障模式与排查手册：五个真实事故的内核根因 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】经典故障模式与排查手册：五个真实事故的内核根因 2026-06-16 · database · kernel · #postgresql #pg-kernel #troubleshooting #connection-storm #transaction-id-wraparound #replication-slot #oom #idle-in-transaction #failure-modes #pg-stat-activity #pg-locks #pg-replication-slots 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #troubleshooting #connection-storm #transaction-id-wraparound #replication-slot #oom #idle-in-transaction #failure-modes #pg-stat-activity #pg-locks #pg-replication-slots 目录 经典故障模式与排查手册：五个真实事故的内核根因 一、连接风暴及 work_mem 连锁效应 1.1 现象 1.2 根因 1.3 时序推演 1.4 排查 SQL 1.6 监控埋点 2.4 排查 SQL 三、replication slot 溢出多米诺效应 3.1 现象 3.2 根因 3.4 排查 SQL 四、OOM 连锁 kill 4.1 现象 4.2 根因 4.4 排查 SQL 5.4 排查 SQL 六、五个故障的内核关联 七、关键要点 参考资料 源码路径 官方文档 事故复盘 实验工具 经典故障模式与排查手册：五个真实事故的内核根因 数据库生产事故有一个共同特征：早期信号在监控面板上存在了几天甚至几周，但没人注意到它们和最终爆炸之间的因果关系。 本文挑出 PG 生产环境中最危险的五种故障模式——“最危险”不意味着出现频率最高，而是指它们要么能直接让数据库进入只读状态（wraparound / slot 溢出），要么是连锁反应的起点（连接风暴 / OOM kill），要么是缓慢的破坏性积累直到某个 DDL 在凌晨 3 点 hang 住（长事务）。每个故障按「现象 → 内核根因 → 时序推演 → 排查 SQL → 修复边界 → 监控埋点」组织。 一、连接风暴及 work_mem 连锁效应 1.1 现象 数据库突然无响应。 pg_stat_activity 显示连接数接近 max_connections ，但大部分连接状态是 active 而非 idle ——不是应用忘了关连接，是真的都在干活。同时 OS 层 dmesg 可能出现 OOM kill 日志，PG 日志出现 out of memory 错误。 1.2 根因 问题不在连接数本身，而在每个连接同时持有的 work_mem 配额之和。 work_mem 的语义被广泛误解。它配置的不是”每个查询 4MB”或者”每个连接 4MB”，而是 每个操作 的内存上限——一个查询可能同时运行 hash join 的 build 阶段、一个 sort 节点、一个 materialize 节点，每个节点各自申请最多 work_mem 的内存。PG 15 引入的 hash_mem_multiplier （默认 2.0）进一步让 hash join 可以使用的内存 = work_mem × hash_mem_multiplier 。 假设 max_connections = 200 ， work_mem = 4MB （默认）， hash_mem_multiplier = 2.0 ： \[ \text{峰值内存} = 200 \times (4\text{MB}_{\text{sort}} + 8\text{MB}_{\text{hash}} + 4\text{MB}_{\text{materialize}}) = 200 \times 16\text{MB} = 3.2\text{GB} \] 这还没算 shared_buff
```

## 二、PG18 源码定位


| 故障 | 关键源码 | PG18 配置/告警 |
|---|---|---|
| 连接风暴 | src/backend/postmaster/postmaster.c | max_connections / pgbouncer |
| wraparound | src/backend/access/transam/varsup.c | age(datfrozenxid) > 2e8 告警 |
| slot 溢出 | src/backend/replication/slot.c | WAL 不消费 → pg_wal 堆满 |
| OOM kill | src/backend/utils/oom/oom.c (PG18+) | work_mem 失控 |
| 长事务 | src/backend/storage/ipc/procarray.c | GetOldestXmin 阻塞 vacuum |


## 三、PG18 源码摘录


### 22.1 GetOldestXmin (长事务的连锁反应)
```c
TransactionId
GetOldestNonRemovableTransactionId(Relation rel)
{
	ComputeXidHorizonsResult horizons;

	ComputeXidHorizons(&horizons);

	switch (GlobalVisHorizonKindForRel(rel))
	{
		case VISHORIZON_SHARED:
			return horizons.shared_oldest_nonremovable;
		case VISHORIZON_CATALOG:
			return horizons.catalog_oldest_nonremovable;
		case VISHORIZON_DATA:
			return horizons.data_oldest_nonremovable;
		case VISHORIZON_TEMP:
			return horizons.temp_oldest_nonremovable;
	}

	/* just to prevent compiler warnings */
	return InvalidTransactionId;
}
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 OOM killer**: PG18 新增 oom.c, OOM 时按内存大小杀 backend
2. **wraparound**: 仍是 21 亿事务上限, 触发后 DB 只读
3. **slot 溢出**: PG14+ sync_replication_slots 帮助自动同步
4. **connection storm**: 推荐 pgbouncer transaction 池


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch22-classic-failures-evidence.txt`


### 关键输出
```
DROP TABLE
CREATE TABLE
INSERT 0 5000
UPDATE 5000
 relname | n_live_tup | n_dead_tup 
---------+------------+------------
 t_long  |          0 |          0
(1 row)

  relname  | age |    size    
-----------+-----+------------
 t_btree   |  23 | 24 kB
 t_gdbtest |  16 | 8192 bytes
 t_stat    |   8 | 440 kB
 a         |   7 | 8192 bytes
 b         |   7 | 48 kB
(5 rows)

 datname  | age | freeze_max 
----------+-----+------------
 postgres |  33 |  200000000
(1 row)

 work_mem 
----------
 4MB
(1 row)

 slot_count 
------------
          0
(1 row)


```


## 六、GDB 调试示例


观察长事务导致 vacuum 阻塞:
```
gdb -p <vacuum_worker_pid>
(gdb) pgsetup
(gdb) break procarray.c:GetOldestNonRemovableTransactionId
(gdb) continue
# 另一窗口: VACUUM t_long;
```


## 七、小结 — 与下章衔接

已掌握: 5 例故障根因. 待查 Ch.23 性能调查五层链.