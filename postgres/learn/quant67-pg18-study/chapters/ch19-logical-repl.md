# 第 19 章 对照笔记 — 逻辑复制与逻辑解码 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/19-logical-repl.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch19-logical-repl-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】逻辑复制与逻辑解码：冲突处理与延迟放大 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】逻辑复制与逻辑解码：冲突处理与延迟放大 2026-06-16 · database · kernel · #postgresql #pg-kernel #logical-replication #logical-decoding #reorder-buffer #pgoutput #publication #subscription #decode #conflict-detection #replication-slot #wal 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #logical-replication #logical-decoding #reorder-buffer #pgoutput #publication #subscription #decode #conflict-detection #replication-slot #wal 目录 逻辑复制与逻辑解码：冲突处理与延迟放大 一、逻辑解码：从 WAL 到逻辑变更 整体架构 DecodeXLogTuple：从 WAL 数据重建 HeapTuple ReorderBuffer 的核心数据结构 k-way merge：子事务的 LSN 有序迭代 Snapshot 重建：为什么需要 historic MVCC 内存管理与溢出到磁盘 三、Output Plugin：pgoutput 协议 插件接口 订阅端：Subscription 五、逻辑复制的冲突检测与处理 四种核心冲突类型 什么不算冲突： update_missing 和 delete_missing 的语义 冲突修复策略 disable_on_error 选项 陷阱二：序列不是逻辑复制的范围 陷阱四：REPLICA IDENTITY 与 UPDATE/DELETE 的定位失败 构造 update_missing 九、关键要点 参考资料 源码（PG 17） 官方文档 其他 逻辑复制与逻辑解码：冲突处理与延迟放大 流复制（物理复制）能给你一个和 Primary 逐字节相同的 Standby，但它有一个硬伤：你必须复制整个集群。你不能只复制一张表、不能跨大版本复制、不能做双向同步。（关于流复制的完整内核机制，参见 流复制 。）逻辑复制补上了这些缺口——它从 WAL 中解码出行级变更（INSERT/UPDATE/DELETE），然后把这些变更应用到另一个数据库，甚至可以跨 PG 版本。 听起来很美好，但逻辑复制的故障形态和流复制截然不同。流复制的麻烦在 Slot 溢出和延迟；逻辑复制的麻烦在 冲突 ——Publisher 上成功的操作，在 Subscriber 上可能因为约束冲突而失败。更隐蔽的是，大事务在 Reorder Buffer 中会引发延迟放大效应，一条 UPDATE 话在 commit 之前不会发给 Subscriber。 本文从源码路径拆解 PG 逻辑复制和逻辑解码的内核骨架，重点解释四个运维中最常遇到但理解最不充分的问题：四种冲突类型的根因和修复边界、序列不复制导致的自增主键冲突陷阱、大事务延迟放大的机制根因、以及 Subscription 被 disable 后的正确追平策略。 一、逻辑解码：从 WAL 到逻辑变更 整体架构 逻辑复制和流复制共用同一套 WAL 基础设施，但走向完全不同。流复制的 WAL Sender 直接把 WAL record 的原始字节发给 Standby；逻辑复制则多了一个 逻辑解码（Logical Decoding） 环节——从 wal_level = logical 级别的 WAL record 中解码出每一行的INSERT/UPDATE/DELETE，再通过 Output Plugin 序列化成协议消息发送给 Subscriber。 sequenceDiagram participant BE as Backend (Publisher) participant WB as WAL Buffer participant LD as Logical Decoding partic
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| ReorderBuffer | src/backend/replication/logical/reorderbuffer.c | 事务重排 |
| pgoutput | src/backend/replication/pgoutput/pgoutput.c | 输出插件 |
| worker.c | src/backend/replication/logical/worker.c | apply worker |
| launcher.c | src/backend/replication/logical/logicallauncher.c | apply launcher |
| logical.c | src/backend/replication/logical/logical.c | Logical Decoding 框架 |
| pg_publication | 系统表 | publication 定义 |
| pg_subscription | 系统表 | subscription 定义 |


## 三、PG18 源码摘录


### 19.1 ReorderBufferCommit (reorderbuffer.c)
```c
void
ReorderBufferCommit(ReorderBuffer *rb, TransactionId xid,
					XLogRecPtr commit_lsn, XLogRecPtr end_lsn,
					TimestampTz commit_time,
					RepOriginId origin_id, XLogRecPtr origin_lsn)
{
	ReorderBufferTXN *txn;

	txn = ReorderBufferTXNByXid(rb, xid, false, NULL, InvalidXLogRecPtr,
								false);

	/* unknown transaction, nothing to replay */
	if (txn == NULL)
		return;

	ReorderBufferReplay(txn, rb, xid, commit_lsn, end_lsn, commit_time,
						origin_id, origin_lsn);
}
```

### 19.2 ApplyWorkerMain (worker.c)
```c
void
ApplyWorkerMain(Datum main_arg)
{
	int			worker_slot = DatumGetInt32(main_arg);

	InitializingApplyWorker = true;

	SetupApplyOrSyncWorker(worker_slot);

	InitializingApplyWorker = false;

	run_apply_worker();

	proc_exit(0);
}
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 逻辑复制**: PG16+ parallel apply (多 worker 处理大事务), PG18 沿用
2. **行过滤**: PG15+ publication WHERE 子句, PG18 沿用
3. **列过滤**: PG15+ column list, PG18 沿用
4. **冲突类型**: insert 主键冲突 / update 行被删 / delete 不存在 / truncate 序列冲突


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch19-logical-repl-evidence.txt`


### 关键输出
```
                    name                     | setting | unit 
---------------------------------------------+---------+------
 max_logical_replication_workers             | 4       | 
 max_parallel_apply_workers_per_subscription | 2       | 
 max_replication_slots                       | 10      | 
 max_sync_workers_per_subscription           | 2       | 
 wal_level                                   | replica | 
(5 rows)

 pubname | puballtables | pubinsert | pubupdate | pubdelete | pubtruncate 
---------+--------------+-----------+-----------+-----------+-------------
(0 rows)


```


## 六、GDB 调试示例


观察 logical decoding 输出:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break reorderbuffer.c:ReorderBufferCommit
(gdb) continue
# 另一窗口: BEGIN; INSERT ... ; COMMIT;
# GDB 会在事务提交时停在 ReorderBufferCommit
```

观察 apply worker:
```
(gdb) break worker.c:apply_handle_insert
(gdb) break worker.c:apply_handle_update
(gdb) continue
# 在订阅端 (logical worker) attach
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 logical replication = ReorderBuffer + pgoutput + parallel apply
- 待查: Ch.20 FDW — 外部数据封装 + planner hook
