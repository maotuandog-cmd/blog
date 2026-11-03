# 第 25 章 对照笔记 — 大版本升级与迁移实战 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/25-upgrade-migration.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch25-upgrade-migration-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】大版本升级与迁移实战：pg_upgrade --link 为什么快以及为什么没有回滚 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】大版本升级与迁移实战：pg_upgrade --link 为什么快以及为什么没有回滚 2026-06-16 · database · kernel · ops · #postgresql #pg-kernel #pg-upgrade #migration #hard-link #logical-replication #pg-dump #vacuumdb #disaster-recovery #inode #copy-on-write 文章导航 分类入口 database kernel ops 标签入口 #postgresql #pg-kernel #pg-upgrade #migration #hard-link #logical-replication #pg-dump #vacuumdb #disaster-recovery #inode #copy-on-write 目录 大版本升级与迁移实战：pg_upgrade –link 为什么快以及为什么没有回滚 一、pg_upgrade 的内部机制：为什么 –link 这么快 原教旨升级 vs pg_upgrade –link 模式：0 数据拷贝的秘密 前置条件 二、逻辑复制跨版本迁移 低停机迁移流程 四、迁移方案决策树 执行 pg_upgrade –check 验证硬链接 确认后可删除老集群 六、关键要点 参考资料 源码（PG 17） 官方文档 实验工具 大版本升级与迁移实战：pg_upgrade –link 为什么快以及为什么没有回滚 PG 大版本升级是一个让 DBA 失眠的话题。大版本升级（major version upgrade）指的是从 PG 15 到 PG 16、PG 16 到 PG 17 这种跨越——数据文件格式、系统表结构、WAL 格式都可能变化，不能像小版本升级（16.2 到 16.4）那样直接替换二进制然后重启。本章拆解三种迁移方案的核心机制、致命边界和决策依据。 如果你只有 5 秒钟：小库（ 10GB）用 pg_dump/pg_restore，中型库用 pg_upgrade --link ，大库（ 500GB）且不能长时间停机用逻辑复制迁移。但”为什么不能混着用”和”每种方案出事之后还能怎么办”需要花 5000 字说清楚。 一、pg_upgrade 的内部机制：为什么 –link 这么快 原教旨升级 vs pg_upgrade 最早的 PG 大版本升级方法只有一种：pg_dump 导出老版本的逻辑数据，再 pg_restore 导入新版本。这个方案有几个硬伤： 慢 ：全量数据走 SQL 层再写回磁盘，大库动辄数小时。 膨胀 ：pg_restore 本质上是重建表和索引——数据文件和索引文件在新集群里物理布局完全不同，相当于做了一次全量 VACUUM FULL。 统计信息清空 ：pg_dump 导出的是数据，不包括 pg_statistic 的内容。新集群里的优化器统计一片空白，必须全量 ANALYZE。 pg_upgrade 的设计目标是 就地升级 ——不搬数据，只在元数据层面完成版本迁移。它操作的对象是文件系统上的数据文件目录（ PGDATA ），而不是走 SQL 连接。这意味着它不需要把数据读出来、不需要重建索引、不需要生成 WAL。 –link 模式：0 数据拷贝的秘密 pg_upgrade 有三种文件处理模式： 模式 对数据文件的操作 额外磁盘空间 升级时长（数据部分） 升级后旧集群是否可用 --link link() 创建硬链接 只需复制 pg_catalog 的空间 只取决于 pg_catalog 大小 否——新旧共享 inode --clone ioctl(FICLONE) 创建 CoW 快照 同 --link （CoW 写入时分配新块） 同 --link 可当作独立副本 默认（无参数） 逐文件 copy() 整个数据目录大小 取决于数据文件总大小 是——物理隔离 --link 快的根本原因是 它不拷贝数据文件 。对用户表的数据文件，pg_upgrade 调用 link
```

## 二、PG18 源码定位


| 工具 | PG18 文件 | 说明 |
|---|---|---|
| pg_upgrade | src/bin/pg_upgrade/pg_upgrade.c | 主程序 |
| check.c | src/bin/pg_upgrade/check.c | 一致性检查 |
| file.c | src/bin/pg_upgrade/file.c | transfer_relfile |


## 三、PG18 源码摘录


### 25.1 pg_upgrade.c main
```c


int
main(int argc, char **argv)
{
	char	   *deletion_script_file_name = NULL;

	/*
	 * pg_upgrade doesn't currently use common/logging.c, but initialize it
	 * anyway because we might call common code that does.
	 */
	pg_logging_init(argv[0]);
	set_pglocale_pgservice(argv[0], PG_TEXTDOMAIN("pg_upgrade"));

	/* Set default restrictive mask until new cluster permissions are read */
	umask(PG_MODE_MASK_OWNER);

	parseCommandLine(argc, argv);

	get_restricted_token();

	adjust_data_dir(&old_cluster);
	adjust_data_dir(&new_cluster);

	/*
	 * Set mask based on PGDATA permissions, needed for the creation of the
	 * output directories with correct permissions.
	 */
	if (!GetDataDirectoryCreatePerm(new_cluster.pgdata))
		pg_fatal("could not read permissions of directory \"%s\": %m",
				 new_cluster.pgdata);

	umask(pg_mode_mask);

	/*
	 * This needs to happen after adjusting the data directory of the new
	 * cluster in adjust_data_dir().
	 */
	make_outputdirs(new_cluster.pgdata);

	setup(argv[0]);

	output_check_banner();

	check_cluster_versions();

	get_sock_dir(&old_cluster);
	get_sock_dir(&new_cluster);

	check_cluster_compatibility();

	check_and_dump_old_cluster();


	/* -- NEW -- 
```

### 25.2 transfer_relfile (file.c)
```c

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 pg_upgrade**: --link / --clone / --copy 三模式
2. **硬链接**: 零拷贝, 但不可回滚
3. **PG18 logical subscription parallel apply**: 升级时停 subscription
4. **跨大版本**: pg_upgrade 只支持 ±1 大版本


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch25-upgrade-migration-evidence.txt`


### 关键输出
```

```


## 七、小结 — 与下章衔接

已掌握: pg_upgrade --link 机制. 待查 Ch.26 11 个 GUC 陷阱.