# 第 24 章 对照笔记 — 数据恢复与损坏应对 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/24-recovery-corruption.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch24-recovery-corruption-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】数据恢复与损坏应对：PITR、pg_resetwal 和页面损坏的边界 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】数据恢复与损坏应对：PITR、pg_resetwal 和页面损坏的边界 2026-06-16 · database · kernel · ops · #postgresql #pg-kernel #pitr #pg_resetwal #pg_checksums #zero_damaged_pages #pg_dump #pg_restore #wal #corruption #recovery #timeline #pg_rewind 文章导航 分类入口 database kernel ops 标签入口 #postgresql #pg-kernel #pitr #pg_resetwal #pg_checksums #zero_damaged_pages #pg_dump #pg_restore #wal #corruption #recovery #timeline #pg_rewind 目录 数据恢复与损坏应对：PITR、pg_resetwal 和页面损坏的边界 一、PITR 恢复流程：WAL archive 如何回放 恢复的起点：pg_control 与 checkpoint record recovery_target 的精度陷阱 窗口 2：WAL archive 的完整性 为什么不能回切 四、pg_rewind：回退的唯一路径及其边界 五、页面校验：pg_checksums 检查什么、不检查什么 校验粒度 六、zero_damaged_pages：跳过损坏不是修复 什么情况下这个参数”有用” 开启后的连锁反应 七、pg_resetwal：最后手段的代价 pg_resetwal 的实际操作 核心代价：hint bit 不可信 必须 VACUUM FULL 的陷进 pg_restore –jobs=N 的内部调度 大表分表 dump 策略 九、关键要点 参考资料 源码（PG 17） 官方文档 工具手册 数据恢复与损坏应对：PITR、pg_resetwal 和页面损坏的边界 当你面对一个损坏的 PG 集群时，手上能用的工具有限：PITR 回退到过去某个时刻、 pg_resetwal 清空 WAL 强行启动、 zero_damaged_pages 跳过损坏页面、或者 pg_dump 抢救还能读的数据。这四种路径的操作成本和数据损失风险完全不同，选错的代价可能是数据永久丢失。 本文拆解每种恢复路径的内部机制——不是操作步骤清单，而是让你理解每一步在内核层面做了什么、哪些代价是不可逆的，以及在什么情况下绝对不该碰某个工具。 一、PITR 恢复流程：WAL archive 如何回放 PITR（Point-in-Time Recovery）的核心思想是：从一个旧的 base backup 出发，逐条回放 WAL 日志，把数据库状态推进到指定的恢复目标时刻。它不是”撤销”操作——它是”从更早的快照重新走到现在（或走到过去某个点）“。 恢复的起点：pg_control 与 checkpoint record pg_backup_start() 创建的 base backup 本身不是一致的——备份期间数据文件仍在被修改。启动 PITR 恢复时，PG 首先读取 pg_control 文件（或 base backup 中的 backup_label ）找到 checkpoint record 的位置，然后从这个 REDO point 开始，沿 WAL 逐条回放 record。 恢复入口在 src/backend/access/transam/xlog.c 的 StartupXLOG() ： // src/backend/access/transam/xlog.c, StartupXLOG() 的简化流程 // 1. 读取 pg_control，获取 checkpoint 位置 // 2. 如果存在 backup_label，以它的 START WAL LOCATION 为准 // 3. 设置 REDO 起点 (minRecoveryPoint) // 4. 循环调用 XLogReadRe
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| StartupXLOG | src/backend/access/transam/xlog.c | recovery 入口 |
| WAL replay | src/backend/access/transam/xlogrecovery.c | redo |
| pg_resetwal | src/bin/pg_resetwal/pg_resetwal.c | 最后手段 |
| pg_basebackup | src/bin/pg_basebackup/pg_basebackup.c | 基础备份 |
| timeline | src/backend/access/transam/timeline.c | TLI 历史 |


## 三、PG18 源码摘录


### 24.1 StartupXLOG 入口
```c
void
StartupXLOG(void)
{
	XLogCtlInsert *Insert;
	CheckPoint	checkPoint;
	bool		wasShutdown;
	bool		didCrash;
	bool		haveTblspcMap;
	bool		haveBackupLabel;
	XLogRecPtr	EndOfLog;
	TimeLineID	EndOfLogTLI;
	TimeLineID	newTLI;
	bool		performedWalRecovery;
	EndOfWalRecoveryInfo *endOfRecoveryInfo;
	XLogRecPtr	abortedRecPtr;
	XLogRecPtr	missingContrecPtr;
	TransactionId oldestActiveXID;
	bool		promoted = false;

	/*
	 * We should have an aux process resource owner to use, and we should not
	 * be in a transaction that's installed some other resowner.
	 */
	Assert(AuxProcessResourceOwner != NULL);
	Assert(CurrentResourceOwner == NULL ||
		   CurrentResourceOwner == AuxProcessResourceOwner);
	CurrentResourceOwner = AuxProcessResourceOwner;

	/*
	 * Check that contents look valid.
	 */
	if (!XRecOffIsValid(ControlFile->checkPoint))
		ereport(FATAL,
				(errcode(ERRCODE_DATA_CORRUPTED),
				 errmsg("control file contains invalid checkpoint location")));

	switch (ControlFile->state)
	{
		case DB_SHUTDOWNED:

			/*
			 * This is the expected case, so don't be chatty in standalone
			 * mode
			 */
			ereport(IsPostmasterEnvironment ? LOG : NOTICE,
					(errmsg("database system was shut down at %s",
							str_time(ControlFile->time))));
			break;

		case DB_SHUTDOWNED_IN_RECOVERY:
			ereport(LOG,
					(errmsg("database system was shut down in recovery at %s",
							str_time(ControlFile->time))));
			break;

		case DB_SHUTDOWNING:
			ereport(LOG,
					(errmsg("database system shutdown w
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 pg_resetwal 选项**: -u/-x 处理未提交事务 (PG14+)
2. **PITR 三窗口**: backup + archive WAL + recovery_target
3. **损坏不可逆**: page checksum 错 + 无基础备份 = 不可恢复


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch24-recovery-corruption-evidence.txt`


### 关键输出
```
 archive_mode 
--------------
 off
(1 row)

 archive_command 
-----------------
 (disabled)
(1 row)

 restore_command 
-----------------
 
(1 row)

 pg_last_wal_replay_lsn | pg_last_xact_replay_timestamp 
------------------------+-------------------------------
                        | 
(1 row)

     pg_walfile_name      
--------------------------
 00000001000000000000000C
(1 row)


```


## 六、GDB 调试示例

(recovery 实测需要专门实验环境, GDB 跟踪见 ch04/18)

## 七、小结 — 与下章衔接

已掌握: PITR + pg_resetwal 边界. 待查 Ch.25 pg_upgrade.