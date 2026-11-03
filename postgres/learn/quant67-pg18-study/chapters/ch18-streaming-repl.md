# 第 18 章 对照笔记 — 流复制 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/18-streaming-repl.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch18-streaming-repl-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】流复制：从 WAL Sender 到 Slot 溢出的多米诺效应 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】流复制：从 WAL Sender 到 Slot 溢出的多米诺效应 2026-06-16 · database · kernel · #postgresql #pg-kernel #streaming-replication #wal-sender #wal-receiver #synchronous-replication #replication-slot #failover #timeline #split-brain #pg-rewind #wal-recovery #slot-overflow #pg-stat-replication 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #streaming-replication #wal-sender #wal-receiver #synchronous-replication #replication-slot #failover #timeline #split-brain #pg-rewind #wal-recovery #slot-overflow #pg-stat-replication 目录 流复制：从 WAL Sender 到 Slot 溢出的多米诺效应 一、流复制的整体架构 WAL Sender 的三种 WAL 来源 三、WAL Receiver：WalRcvLoop 的接收与恢复 接收端架构 三阶段延迟的精确语义 零值陷阱 四、同步复制的语义与等待机制 synchronous_commit 的五个级别 原始 Timeline 1 到 XXX 位置的 WAL 历史 Trade-off conflict_reason 解读 七、Replication Slot 的内部结构 Slot 的设计目的 pg_replication_slots 的内部结构 wal_keep_size 与 Slot 的叠加陷阱 恢复路径 九、排查：pg_stat_replication 的三层延迟指标 完整监控 SQL 十、关键要点 参考资料 源码（PG 17） 官方文档 PG 开发者讨论 工具 流复制：从 WAL Sender 到 Slot 溢出的多米诺效应 在 PG 里配流复制不算难—— pg_basebackup 拉一个基础备份，写一条 primary_conninfo ，启动 standby 就行。但流复制在生产环境的故障形态远不止”延迟大了追一追”。它涉及 WAL Sender/Receiver 进程的内部协议、同步复制的持久性语义和等待链、Failover 时的 Timeline 协商、Replication Slot 对 WAL 回收的制约——以及最致命的多米诺效应：一个被遗忘的 Slot 可以悄无声息地填满磁盘，打垮 Primary。 本文从源码路径拆解 PG 流复制的内核骨架，重点解释三个运维中最常见但理解最浅的高风险场景：Slot 溢出如何从”standby 宕机”一步步发展到”primary PANIC”、 pg_stat_replication 的三层延迟指标为什么在 Slot 卡住时全都显示 0、以及 Promote 之后的 split-brain 为什么 pg_rewind 不能完全救你。 一、流复制的整体架构 PG 的流复制基于 WAL 的物理日志传输，不是 SQL 级别的复制。Primary 把 WAL record 发给 standby，standby 像做 crash recovery 一样 replay 这些 record——redo 出来的页面和 primary 一模一样。这意味着流复制是 物理复制 ，传输的是 page-level 的变更，不是逻辑行。 sequenceDiagram participant P as Primary Backend participant WB as WAL Buffer (Primary) participant WS as WAL Sender participant WR as WAL Rece
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| WalSndLoop | src/backend/replication/walsender.c | 发送端主循环 |
| XLogSend | 同上 | 实际发 WAL |
| WalRcvLoop | src/backend/replication/walreceiver.c | 接收端主循环 |
| XLogPageRead | 同上 | 读 WAL |
| ReplicationSlot | src/backend/replication/slot.c | slot 管理 |
| SyncRepWaitForLSN | src/backend/replication/syncrep.c | 同步复制等待 |
| libpqwalreceiver | src/backend/replication/libpqwalreceiver/libpqwalreceiver.c | 客户端连接 |


## 三、PG18 源码摘录


### 18.1 WalSndLoop (walsender.c)
```c
static void
WalSndLoop(WalSndSendDataCallback send_data)
{
	TimestampTz last_flush = 0;

	/*
	 * Initialize the last reply timestamp. That enables timeout processing
	 * from hereon.
	 */
	last_reply_timestamp = GetCurrentTimestamp();
	waiting_for_ping_response = false;

	/*
	 * Loop until we reach the end of this timeline or the client requests to
	 * stop streaming.
	 */
	for (;;)
	{
		/* Clear any already-pending wakeups */
		ResetLatch(MyLatch);

		CHECK_FOR_INTERRUPTS();

		/* Process any requests or signals received recently */
		if (ConfigReloadPending)
		{
			ConfigReloadPending = false;
			ProcessConfigFile(PGC_SIGHUP);
			SyncRepInitConfig();
		}

		/* Check for input from the client */
		ProcessRepliesIfAny();

		/*
		 * If we have received CopyDone from the client, sent CopyDone
		 * ourselves, and the output buffer is empty, it's time to exit
		 * streaming.
		 */
		if (streamingDoneReceiving && streamingDoneSending &&
			!pq_is_send_pending())
			break;

		/*
		 * If we don't have any pending data in the output buffer, try to send
		 * some more.  If there is some, we don't bother to call send_data
		 * again until we've flushed it ... but we'd better assume we are not
		 * caught up.
		 */
		if (!pq_is_send_pending())
			send_data();
		else
			WalSndCaughtUp = false;

		/* Try to flush pending output to the client */
		if (pq_flush_if_writable() != 0)
			WalSndShutdown();

		/* If nothing remains to be sent right now ... */
		if (WalSndCaughtUp && !pq_is_send_p
```

### 18.2 ReplicationSlotCreate (slot.c)
```c
void
ReplicationSlotCreate(const char *name, bool db_specific,
					  ReplicationSlotPersistency persistency,
					  bool two_phase, bool failover, bool synced)
{
	ReplicationSlot *slot = NULL;
	int			i;

	Assert(MyReplicationSlot == NULL);

	ReplicationSlotValidateName(name, ERROR);

	if (failover)
	{
		/*
		 * Do not allow users to create the failover enabled slots on the
		 * standby as we do not support sync to the cascading standby.
		 *
		 * However, failover enabled slots can be created during slot
		 * synchronization because we need to retain the same values as the
		 * remote slot.
		 */
		if (RecoveryInProgress() && !IsSyncingReplicationSlots())
			ereport(ERROR,
					errcode(ERRCODE_FEATURE_NOT_SUPPORTED),
					errmsg("cannot enable failover for a replication slot created on the standby"));

		/*
		 * Do not allow users to create failover enabled temporary slots,
		 * because temporary slots will not be synced to the standby.
		 *
		 * However, failover enabled temporary slots can be created during
		 * slot synchronization. See the comments atop slotsync.c for details.
		 */
		if (persistency == RS_TEMPORARY && !IsSyncingReplicationSlots())
			ereport(ERROR,
					errcode(ERRCODE_FEATURE_NOT_SUPPORTED),
					errmsg("cannot enable failover for a temporary replication slot"));
	}

	/*
	 * If some other backend ran this code concurrently with us, we'd likely
	 * both allocate the same slot, and that would be bad.  We'd also be at
	 * risk of missing a name collision.
```

### 18.3 SyncRepWaitForLSN (syncrep.c)
```c
void
SyncRepWaitForLSN(XLogRecPtr lsn, bool commit)
{
	int			mode;

	/*
	 * This should be called while holding interrupts during a transaction
	 * commit to prevent the follow-up shared memory queue cleanups to be
	 * influenced by external interruptions.
	 */
	Assert(InterruptHoldoffCount > 0);

	/*
	 * Fast exit if user has not requested sync replication, or there are no
	 * sync replication standby names defined.
	 *
	 * Since this routine gets called every commit time, it's important to
	 * exit quickly if sync replication is not requested.
	 *
	 * We check WalSndCtl->sync_standbys_status flag without the lock and exit
	 * immediately if SYNC_STANDBY_INIT is set (the checkpointer has
	 * initialized this data) but SYNC_STANDBY_DEFINED is missing (no sync
	 * replication requested).
	 *
	 * If SYNC_STANDBY_DEFINED is set, we need to check the status again later
	 * while holding the lock, to check the flag and operate the sync rep
	 * queue atomically.  This is necessary to avoid the race condition
	 * described in SyncRepUpdateSyncStandbysDefined().  On the other hand, if
	 * SYNC_STANDBY_DEFINED is not set, the lock is not necessary because we
	 * don't touch the queue.
	 */

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 流复制**: 协议未变, 仍是 START_REPLICATION / BASE_BACKUP 命令
2. **sync_standby_names**: 优先级/quorum 模式, PG16+ 加 quorum (任意 N 同步)
3. **slot 溢出**: 仍为 WAL 不消费导致 pg_wal 堆满, 见 ch22 故障
4. **logical slot**: 见 ch19


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch18-streaming-repl-evidence.txt`


### 关键输出
```
           name            | setting | unit 
---------------------------+---------+------
 max_replication_slots     | 10      | 
 max_wal_senders           | 10      | 
 sync_replication_slots    | off     | 
 synchronous_standby_names |         | 
 wal_keep_size             | 0       | MB
 wal_level                 | replica | 
 wal_sender_timeout        | 60000   | ms
(7 rows)

 slot_name | plugin | slot_type | database | active | active_pid | restart_lsn | confirmed_flush_lsn 
-----------+--------+-----------+----------+--------+------------+-------------+---------------------
(0 rows)

 pid | usename | application_name | state | sync_state | write_lsn | replay_lsn 
-----+---------+------------------+-------+------------+-----------+------------
(0 rows)

 replica_count 
---------------
             0
(1 row)

 wait_event_type | wait_event | count 
-----------------+------------+-------
                 |            |     1
(1 row)


```


## 六、GDB 调试示例


观察 WAL Sender:
```
gdb -p <walsender_pid>
(gdb) pgsetup
(gdb) break walsender.c:XLogSend
(gdb) continue
# 备库若有: 每次有新的 WAL 写入会触发
```

观察同步复制等待:
```
(gdb) break syncrep.c:SyncRepWaitForLSN
(gdb) continue
# 另一窗口: INSERT 后无 sync 备库会一直等待
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 流复制协议 + ReplicationSlot + SyncRep 三级语义
- 待查: Ch.19 逻辑复制 — ReorderBuffer 与 pgoutput
