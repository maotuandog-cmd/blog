# 【存储工程】备份策略工程

来源: https://quant67.com/post/storage/60-backup-strategies/backup-strategies.html
日期: 2025-10-08 |

---

一个数据库集群运行了三年没出过事，运维团队逐渐把备份当成”例行公事”——每天凌晨跑一次全量备份，脚本跑完就算结束，从来没人验证过备份文件能不能真正恢复。直到某天一个
            DBA 误执行了
            `DROP DATABASE`，团队才发现：最近三个月的备份文件全部损坏，因为磁盘空间不足导致
            `mysqldump`
            中途退出，但脚本没有检查退出码，监控系统也没有告警。
            

这不是虚构的场景。GitLab 在 2017 年 1 月 31
            日的事故中，五种备份机制全部失效——pg_dump
            版本不匹配导致备份为空、LVM 快照从未配置、S3
            备份因错误跳过、Azure 备份未启用、WAL
            归档目录中只有空文件。最终靠一个 DBA
            六小时前偶然做的一次手动备份才恢复了大部分数据，但仍然丢失了约
            6 小时的生产数据。
            

备份不是一个”配置完就不用管”的功能，而是一项需要持续投入的工程实践。本文从备份的工程动机出发，逐一拆解全量/差异/增量三种策略、逻辑与物理备份的权衡、WAL
            连续归档的原理，然后分别讨论 MySQL 和 PostgreSQL
            的备份方案，最后覆盖备份验证、加密压缩、3-2-1
            规则和监控告警。
            
            

**适用范围**
            本文讨论的备份策略主要针对关系型数据库（MySQL
            8.0、PostgreSQL
            16）和通用文件系统备份场景。不涉及分布式数据库（如
            TiDB、CockroachDB）的多副本机制——多副本是高可用手段，不能替代备份。不同版本的工具行为可能有差异，文中会标注版本。
            
            
            

## 一、备份的工程动机

            

### 1.1 数据丢失的典型场景

            

数据丢失不只是硬盘坏了这一种情况。按照触发原因分类，至少有以下几种场景：
            
            
            
            
            
            
            
            
            
            场景类别
            典型案例
            多副本能否防护
            备份能否防护
            
            
            
            
            硬件故障
            磁盘损坏、控制器故障、整机宕机
            能（副本接管）
            能
            
            
            人为误操作
            `DROP TABLE`、`DELETE` 不带
            `WHERE`、误删数据目录
            不能（误操作会同步到副本）
            能（恢复到误操作前的时间点）
            
            
            软件缺陷
            数据库 bug 导致数据写坏、升级脚本错误
            不能（损坏数据同样会复制）
            能（恢复到 bug 触发前）
            
            
            安全事件
            勒索软件加密数据文件、恶意删库
            不能（攻击者通常会同时破坏副本）
            能（前提是备份和生产环境隔离）
            
            
            逻辑错误
            应用层 bug 导致大量脏数据写入
            不能（脏数据正常复制）
            能（时间点恢复）
            
            
            自然灾害
            机房火灾、洪水、地震
            取决于副本是否跨地域
            能（前提是异地备份）
            
            
            
            

这张表说明一个核心问题：**多副本解决的是可用性（Availability），备份解决的是可恢复性（Recoverability）**。副本保证系统不停机，备份保证数据不丢失。两者必须同时存在。
            

### 1.2 恢复目标的两个指标

            

备份策略的设计围绕两个核心指标展开：
            

**恢复点目标（Recovery Point
            Objective，RPO）**：系统发生故障后，最多允许丢失多长时间的数据。RPO
            = 0 表示不允许丢失任何数据；RPO = 1 小时表示最多丢失 1
            小时内的写入。
            

**恢复时间目标（Recovery Time
            Objective，RTO）**：从故障发生到系统恢复服务，最多允许多长时间。RTO
            = 15 分钟表示必须在 15 分钟内完成恢复。
            

RPO 决定了备份频率和备份方式——要实现 RPO = 0
            通常需要同步复制，RPO = 几分钟可以用 WAL 连续归档，RPO = 24
            小时用每日全量备份就够了。RTO
            决定了备份格式和恢复流程——物理备份的恢复速度通常远快于逻辑备份。
            

### 1.3 备份的成本

            

备份不是免费的。需要考虑的成本包括：
            
            
- **存储成本**：备份文件需要占用存储空间，全量备份尤其如此。一个
            1 TB 的数据库，每天做一次全量备份并保留 30
            天，不考虑压缩就需要 30 TB 存储。
            
- **性能影响**：备份过程需要读取数据，会占用磁盘
            I/O 和 CPU。逻辑备份（如
            `mysqldump`）需要加锁或使用一致性快照，可能影响在线业务。
            
- **网络带宽**：异地备份需要通过网络传输备份文件，1
            TB 数据在 1 Gbps 带宽下传输约需 2.5 小时。
            
- **运维成本**：备份脚本的开发、调试、监控、验证，以及定期的恢复演练，都需要人力投入。
            
            

备份策略的核心就是在 RPO/RTO
            要求与这些成本之间找到平衡。
            
            

## 二、备份策略分类

            

备份策略按照每次备份的数据范围分为三种：全量备份（Full
            Backup）、差异备份（Differential
            Backup）和增量备份（Incremental Backup）。
            

### 2.1 全量备份

            

全量备份（Full
            Backup）每次复制数据集的完整副本。优点是恢复简单——只需要一份备份文件就能还原完整数据。缺点是时间长、占用空间大。
            
```
时间轴：
Day 1      Day 2      Day 3      Day 4      Day 5
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
│ Full │   │ Full │   │ Full │   │ Full │   │ Full │
│100 GB│   │102 GB│   │105 GB│   │107 GB│   │110 GB│
└──────┘   └──────┘   └──────┘   └──────┘   └──────┘

恢复 Day 4 的数据：只需要 Day 4 的全量备份。
总存储量：100 + 102 + 105 + 107 + 110 = 524 GB
```

            

### 2.2 差异备份

            

差异备份（Differential
            Backup）每次只备份自上一次全量备份以来发生变化的数据。恢复时需要最近一次全量备份加上最近一次差异备份，共两份文件。
            
```
时间轴：
Day 1      Day 2      Day 3      Day 4      Day 5
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
│ Full │   │ Diff │   │ Diff │   │ Diff │   │ Diff │
│100 GB│   │  2 GB│   │  5 GB│   │  7 GB│   │ 10 GB│
└──────┘   └──────┘   └──────┘   └──────┘   └──────┘
               │           │           │           │
               └───────────┴───────────┴───────────┘
                 都相对 Day 1 的全量备份

恢复 Day 4 的数据：需要 Day 1 全量 + Day 4 差异 = 2 份文件。
总存储量：100 + 2 + 5 + 7 + 10 = 124 GB
```

            

差异备份的特点是：随着距离上次全量备份越远，差异备份的体积越大（因为累积的变化越多）。但恢复只需要两步，比增量备份简单。
            

### 2.3 增量备份

            

增量备份（Incremental
            Backup）每次只备份自上一次备份（不管是全量还是增量）以来发生变化的数据。恢复时需要最近一次全量备份加上之后所有的增量备份，按顺序依次应用。
            
```
时间轴：
Day 1      Day 2      Day 3      Day 4      Day 5
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
│ Full │   │ Incr │   │ Incr │   │ Incr │   │ Incr │
│100 GB│   │  2 GB│   │  3 GB│   │  2 GB│   │  3 GB│
└──────┘   └──────┘   └──────┘   └──────┘   └──────┘
               │           │           │           │
               │     相对 Day 2  相对 Day 3  相对 Day 4
          相对 Day 1

恢复 Day 4 的数据：需要 Day 1 全量 + Day 2 增量 + Day 3 增量 + Day 4 增量 = 4 份文件。
总存储量：100 + 2 + 3 + 2 + 3 = 110 GB
```

            

### 2.4 三种策略对比

            
            
            
            
            
            
            
            
            
            维度
            全量备份
            差异备份
            增量备份
            
            
            
            
            每次备份数据量
            大（完整数据集）
            中（累积变化）
            小（最近一次变化）
            
            
            备份速度
            慢
            中等
            快
            
            
            存储占用
            大
            中等
            小
            
            
            恢复复杂度
            低（1 份文件）
            中（2 份文件）
            高（1 + N 份文件）
            
            
            恢复速度
            快
            中等
            慢（需逐个应用）
            
            
            单份备份损坏的影响
            只丢失该份
            丢失该差异周期
            该份之后的所有增量都无法使用
            
            
            
            

实际生产环境中最常见的做法是混合策略：**每周一次全量备份
            + 每天一次增量备份**，或者**每周一次全量备份 +
            每天一次差异备份**。增量备份的链条越长，恢复越慢且风险越高——中间任何一份损坏，后续的增量就全部失效。因此全量备份的频率不能太低。
            
            

## 三、逻辑备份 vs
            物理备份

            

按照备份内容的表示方式，备份还可以分为逻辑备份（Logical
            Backup）和物理备份（Physical Backup）。
            

### 3.1 逻辑备份

            

逻辑备份导出的是数据库的逻辑内容——表结构（DDL）和行数据（DML）。典型工具包括
            MySQL 的
            `mysqldump`、`mysqlpump`、`mydumper`，PostgreSQL
            的 `pg_dump`、`pg_dumpall`。
            

逻辑备份的输出通常是 SQL
            语句或特定格式的文本文件，例如：
            
```
-- mysqldump 输出片段
CREATE TABLE `orders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `orders` VALUES
(1, 1001, 99.99, '2025-01-15 10:30:00'),
(2, 1002, 149.50, '2025-01-15 11:00:00'),
(3, 1001, 29.99, '2025-01-15 11:30:00');
```

            

逻辑备份的优点：
            
            
- **可读性好**：输出是人类可读的 SQL
            或文本，可以用文本工具检查、编辑、过滤。
            
- **跨版本兼容**：可以在不同版本甚至不同数据库之间迁移数据（需要适配
            SQL 方言）。
            
- **粒度灵活**：可以只备份特定的库、表，甚至通过
            `WHERE` 条件备份部分行。
            
- **不依赖存储引擎**：逻辑备份与底层存储引擎无关，InnoDB
            和 MyISAM 的备份方式相同。
            
            

逻辑备份的缺点：
            
            
- **速度慢**：需要将数据库的内部格式转换成
            SQL 文本，备份和恢复都涉及大量解析工作。一个 100 GB
            的数据库用 `mysqldump`
            单线程备份可能需要数小时。
            
- **恢复慢**：恢复时需要逐条执行 SQL
            语句，重新建表、插入数据、创建索引。索引重建尤其耗时。
            
- **一致性获取有代价**：为了获得一致性快照，`mysqldump --single-transaction`
            会开启一个长事务（使用 MVCC），长时间运行可能导致 undo log
            膨胀。
            
            

### 3.2 物理备份

            

物理备份直接复制数据库的底层数据文件——数据文件、索引文件、WAL/redo
            log 文件。典型工具包括 MySQL 的 Percona XtraBackup、MySQL
            Enterprise Backup，PostgreSQL 的
            `pg_basebackup`，以及文件系统级别的 LVM 快照、ZFS
            快照。
            

物理备份的优点：
            
            
- **速度快**：直接复制文件，不需要 SQL
            解析。备份速度接近磁盘顺序读的吞吐量。
            
- **恢复快**：恢复时只需要把文件放回数据目录，再回放
            WAL/redo log 达到一致状态。不需要重建索引。
            
- **对在线业务影响小**：XtraBackup 和
            `pg_basebackup` 都支持在线热备，不需要停机。
            
            

物理备份的缺点：
            
            
- **不可读**：备份文件是二进制格式，无法用文本工具查看内容。
            
- **跨版本兼容差**：物理备份通常只能恢复到相同大版本的数据库实例。MySQL
            8.0 的物理备份不能直接恢复到 MySQL 5.7。
            
- **粒度粗**：通常是整个实例级别的备份，无法只备份单张表（InnoDB
            部分表空间备份除外）。
            
- **依赖存储引擎**：不同存储引擎的数据文件格式不同，备份方式也不同。
            
            

### 3.3 对比总结

            
            
            
            维度
            逻辑备份
            物理备份
            
            
            
            
            备份内容
            SQL 语句 / 文本数据
            数据文件 / WAL 文件
            
            
            备份速度
            慢
            快
            
            
            恢复速度
            慢（需执行 SQL、重建索引）
            快（文件复制 + WAL 回放）
            
            
            备份粒度
            库 / 表 / 行
            实例 / 表空间
            
            
            跨版本恢复
            支持
            通常不支持
            
            
            可读性
            高
            低
            
            
            对业务影响
            中（长事务 / 锁）
            低（热备）
            
            
            支持 PITR
            不直接支持
            支持（配合 WAL）
            
            
            
            

实际生产环境中，常见的做法是**物理备份为主、逻辑备份为辅**：
            
            
- 用物理备份满足日常的快速恢复需求；
            
- 用逻辑备份做跨版本迁移、单表恢复、或者作为物理备份的补充验证。
            
            
            

## 四、连续备份与 WAL 归档

            

全量备份和增量备份都有一个共同的局限：备份之间的时间窗口内，数据变更没有被捕获。如果在两次备份之间发生故障，窗口内的数据就丢失了。WAL
            连续归档（Write-Ahead Log Continuous
            Archiving）解决的就是这个问题。
            

### 4.1 WAL 的基本原理

            

预写日志（Write-Ahead
            Log，WAL）是数据库保证持久性的核心机制：任何数据修改在写入数据文件之前，必须先写入
            WAL。WAL
            记录了每一次数据变更的细节，理论上可以用来将数据库从任意一个一致状态”回放”到后续的任意时间点。
            

MySQL 中对应的概念是二进制日志（Binary Log，binlog）和
            InnoDB 重做日志（Redo Log）。PostgreSQL 中就叫
            WAL。两者的机制有差异，但核心思路一致。
            

### 4.2 连续归档的工作方式

            

连续归档的思路是：在做周期性全量备份的基础上，把所有 WAL
            文件持续地复制到归档存储中。恢复时，先恢复最近一次全量备份，然后从归档中按顺序回放
            WAL，就能将数据库恢复到任意时间点。这就是时间点恢复（Point-in-Time
            Recovery，PITR）。
            
```
连续归档工作流：

┌─────────────────────────────────────────────────────────────────────┐
│                          时间轴                                     │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────────┤
│  Day 1   │  Day 2   │  Day 3   │  Day 4   │  Day 5   │  Day 6      │
│          │          │          │          │          │              │
│ ┌──────┐ │          │          │          │ ┌──────┐ │              │
│ │ Full │ │          │          │          │ │ Full │ │              │
│ │Backup│ │          │          │          │ │Backup│ │              │
│ └──────┘ │          │          │          │ └──────┘ │              │
│          │          │          │          │          │              │
│ ─────────┼──WAL─────┼──WAL─────┼──WAL─────┼──WAL─────┼──WAL──────▶ │
│  归档     │  归档     │  归档     │  归档     │  归档     │  归档       │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────────┤
│                                                                     │
│  恢复到 Day 3 下午 14:30：                                           │
│  1. 还原 Day 1 的全量备份                                            │
│  2. 回放 Day 1 → Day 3 14:30 的所有 WAL                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

            

连续归档的 RPO 取决于 WAL 归档的频率。如果 WAL
            文件一写满就立即归档（PostgreSQL 默认 WAL 段大小 16
            MB），RPO 取决于未归档的最后一个 WAL
            段的数据量。通过流复制归档（`pg_receivewal`）或
            WAL 流式传输，可以将 RPO 降低到接近零。
            

### 4.3 PostgreSQL WAL
            归档配置

            

PostgreSQL 的 WAL
            归档通过以下参数控制（`postgresql.conf`）：
            
```
# 开启归档模式
archive_mode = on

# 归档命令：每个 WAL 段文件完成后执行
# %p = WAL 文件的完整路径，%f = WAL 文件名
archive_command = 'cp %p /backup/wal_archive/%f'

# WAL 级别必须设为 replica 或 logical
wal_level = replica

# 保留的 WAL 段数量（用于流复制和恢复）
wal_keep_size = 1GB
```

            

更可靠的归档命令应该包含校验和错误处理：
            
```
#!/bin/bash
# archive_wal.sh —— PostgreSQL WAL 归档脚本
# 用法：archive_command = '/path/to/archive_wal.sh %p %f'

WAL_SOURCE="$1"
WAL_FILENAME="$2"
ARCHIVE_DIR="/backup/wal_archive"
DEST="${ARCHIVE_DIR}/${WAL_FILENAME}"

# 避免覆盖已有的归档文件
if [ -f "${DEST}" ]; then
    echo "WAL file ${WAL_FILENAME} already exists in archive" >&2
    exit 0
fi

# 复制并验证
cp "${WAL_SOURCE}" "${DEST}.tmp" \
    && sync "${DEST}.tmp" \
    && mv "${DEST}.tmp" "${DEST}"

exit $?
```

            

### 4.4 MySQL binlog
            的连续归档

            

MySQL 没有像 PostgreSQL 那样内置的
            `archive_command` 机制，但 binlog
            本身就是按文件顺序写入的日志流。连续归档的做法是通过
            `mysqlbinlog --read-from-remote-server --raw`
            或专用工具（如
            `mysqlbinlog --read-from-remote-server`
            的守护进程模式）实时拉取 binlog 文件：
            
```
# 从 MySQL 主库实时拉取 binlog 到本地归档目录
mysqlbinlog \
    --read-from-remote-server \
    --host=db-primary.example.com \
    --port=3306 \
    --user=repl_user \
    --password \
    --raw \
    --stop-never \
    --result-file=/backup/binlog_archive/ \
    mysql-bin.000123
```

            

`--stop-never` 参数让 `mysqlbinlog`
            持续运行，像从库一样不断拉取新的 binlog 事件。这种方式的 RPO
            接近于主库写入 binlog
            到备份端接收之间的延迟，通常在秒级。
            
            

## 五、MySQL 备份方案

            

MySQL
            生态中的备份工具可以按逻辑/物理维度和在线/离线维度分类。本节讨论三个最常用的工具：`mysqldump`、Percona
            XtraBackup 和 binlog 归档。
            

### 5.1 mysqldump

            

`mysqldump` 是 MySQL 自带的逻辑备份工具，输出
            SQL 文本。对于 InnoDB 表，推荐使用
            `--single-transaction` 获取一致性快照：
            
```
# 全库逻辑备份（InnoDB 表，一致性快照）
mysqldump \
    --host=127.0.0.1 \
    --port=3306 \
    --user=backup_user \
    --password \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=ON \
    --all-databases \
    | gzip > /backup/full_$(date +%Y%m%d_%H%M%S).sql.gz
```

            

关键参数说明：
            
            
- `--single-transaction`：在
            `REPEATABLE READ` 隔离级别下开启一个事务，利用
            InnoDB 的 MVCC
            获取一致性快照。不加锁，不阻塞写入。但该事务会持续到备份结束，长时间运行会导致
            undo log 增长。
            
- `--set-gtid-purged=ON`：记录 GTID
            信息，方便在基于 GTID 复制的环境中恢复。
            
- `--routines --triggers --events`：同时备份存储过程、触发器和事件调度器。默认不备份这些对象。
            
            

`mysqldump` 的恢复就是执行 SQL 文件：
            
```
# 恢复
gunzip 
            

`mysqldump` 适合数据量在几十 GB
            以下的场景。超过 100 GB 后，备份和恢复时间通常不可接受。
            

### 5.2 Percona XtraBackup

            

Percona XtraBackup 是 MySQL/InnoDB
            的开源物理热备工具。它直接复制 InnoDB 的数据文件和 redo
            log，备份期间不需要锁表（对 InnoDB
            表），不影响在线业务。
            

XtraBackup 的备份过程分两个阶段：
            
            
- **复制阶段**：在后台持续复制 InnoDB
            数据文件（`.ibd` 文件），同时持续监控并复制 redo
            log 的变化。
            
- **完成阶段**：执行
            `FLUSH TABLES WITH READ LOCK`（FTWRL）获取一致性位点，记录
            binlog 位置和
            GTID，然后释放锁。这个锁持续的时间很短（通常在秒级），远比
            `mysqldump` 的长事务影响小。
            
            
```
# 全量物理备份
xtrabackup \
    --backup \
    --target-dir=/backup/full_20250108 \
    --host=127.0.0.1 \
    --port=3306 \
    --user=backup_user \
    --password=xxx \
    --parallel=4 \
    --compress \
    --compress-threads=4
```

            

恢复分两步——先 prepare（应用 redo log
            达到一致状态），再复制到数据目录：
            
```
# 第一步：prepare（应用 redo log）
xtrabackup --prepare --target-dir=/backup/full_20250108

# 第二步：复制到 MySQL 数据目录（需要先停止 MySQL）
systemctl stop mysqld
rm -rf /var/lib/mysql/*
xtrabackup --move-back --target-dir=/backup/full_20250108
chown -R mysql:mysql /var/lib/mysql
systemctl start mysqld
```

            

XtraBackup 还支持增量备份：
            
```
# 增量备份（基于之前的全量备份）
xtrabackup \
    --backup \
    --target-dir=/backup/incr_20250109 \
    --incremental-basedir=/backup/full_20250108 \
    --host=127.0.0.1 \
    --port=3306 \
    --user=backup_user \
    --password=xxx

# 恢复增量备份：先 prepare 全量，再逐个应用增量
xtrabackup --prepare --apply-log-only --target-dir=/backup/full_20250108
xtrabackup --prepare --apply-log-only \
    --target-dir=/backup/full_20250108 \
    --incremental-dir=/backup/incr_20250109
# 最后一次 prepare 不加 --apply-log-only
xtrabackup --prepare --target-dir=/backup/full_20250108
```

            

### 5.3 MySQL 时间点恢复

            

MySQL 的时间点恢复（PITR）依赖 binlog。流程如下：
            
            
- 从 XtraBackup 的全量备份恢复数据库。
            
- 查看备份记录中的 binlog 位置（在
            `xtrabackup_binlog_info` 文件中）。
            
- 用 `mysqlbinlog` 将该位置之后的 binlog
            回放到目标时间点。
            
            
```
# 查看备份的 binlog 位置
cat /backup/full_20250108/xtrabackup_binlog_info
# 输出示例：mysql-bin.000042    15423    a1b2c3d4-...:1-12345

# 回放 binlog 到指定时间点
mysqlbinlog \
    --start-position=15423 \
    --stop-datetime="2025-01-08 14:30:00" \
    /var/lib/mysql/mysql-bin.000042 \
    /var/lib/mysql/mysql-bin.000043 \
    | mysql --host=127.0.0.1 --port=3306 --user=root --password
```

            

### 5.4 MySQL 备份方案选型

            
            
            
            
            
            
            
            
            
            
            
            
            
            方案
            类型
            备份速度
            恢复速度
            支持增量
            支持 PITR
            锁影响
            适用规模
            
            
            
            
            mysqldump
            逻辑
            慢
            慢
            不支持
            配合 binlog
            长事务
            < 50 GB
            
            
            mydumper
            逻辑
            中等（多线程）
            中等
            不支持
            配合 binlog
            短锁
            < 200 GB
            
            
            XtraBackup
            物理
            快
            快
            支持
            配合 binlog
            极短锁
            TB 级
            
            
            MySQL Enterprise Backup
            物理
            快
            快
            支持
            配合 binlog
            极短锁
            TB 级
            
            
            LVM 快照
            物理
            极快
            极快
            不支持
            配合 binlog
            短锁
            TB 级
            
            
            
            
            

## 六、PostgreSQL 备份方案

            

PostgreSQL 的备份工具体系和 MySQL 有所不同，核心工具包括
            `pg_dump`、`pg_basebackup`，以及基于
            WAL 归档的 PITR。
            

### 6.1 pg_dump

            

`pg_dump` 是 PostgreSQL 自带的逻辑备份工具。与
            `mysqldump` 不同，`pg_dump` 天然基于
            MVCC 快照，不需要显式加锁就能获取一致性视图：
            
```
# 单库逻辑备份（自定义格式，支持并行恢复）
pg_dump \
    --host=127.0.0.1 \
    --port=5432 \
    --username=backup_user \
    --dbname=mydb \
    --format=custom \
    --compress=6 \
    --jobs=4 \
    --file=/backup/mydb_$(date +%Y%m%d_%H%M%S).dump

# 全实例备份（所有数据库 + 全局对象）
pg_dumpall \
    --host=127.0.0.1 \
    --port=5432 \
    --username=postgres \
    | gzip > /backup/all_$(date +%Y%m%d_%H%M%S).sql.gz
```

            

`pg_dump` 的 `--format=custom`
            格式（`-Fc`）是推荐的备份格式，因为它支持：
            
            
- 并行恢复（`pg_restore --jobs=N`）；
            
- 选择性恢复（只恢复特定的表或 schema）；
            
- 内置压缩。
            
            

恢复示例：
            
```
# 从自定义格式备份恢复（并行，4 个作业）
pg_restore \
    --host=127.0.0.1 \
    --port=5432 \
    --username=postgres \
    --dbname=mydb \
    --jobs=4 \
    --clean \
    --if-exists \
    /backup/mydb_20250108_020000.dump
```

            

### 6.2 pg_basebackup

            

`pg_basebackup` 是 PostgreSQL
            自带的物理备份工具，通过流复制协议直接从运行中的 PostgreSQL
            实例复制整个数据目录：
            
```
# 物理备份（流式传输 WAL，压缩输出）
pg_basebackup \
    --host=127.0.0.1 \
    --port=5432 \
    --username=repl_user \
    --pgdata=/backup/base_20250108 \
    --wal-method=stream \
    --checkpoint=fast \
    --progress \
    --verbose
```

            

关键参数说明：
            
            
- `--wal-method=stream`：在备份数据文件的同时，通过第二条流复制连接实时传输
            WAL。保证备份自包含，不需要单独配置 WAL 归档就能恢复。
            
- `--checkpoint=fast`：立即触发检查点，而不是等待下一个自然检查点。减少备份开始前的等待时间。
            
            

`pg_basebackup` 从 PostgreSQL 15
            开始支持增量备份（需要启用
            `summarize_wal`）：
            
```
# PostgreSQL 17 增量备份
# 先确保配置了 summarize_wal = on

# 全量备份（作为增量基线）
pg_basebackup \
    --host=127.0.0.1 \
    --port=5432 \
    --username=repl_user \
    --pgdata=/backup/base_full \
    --wal-method=stream \
    --checkpoint=fast

# 增量备份（基于前一次备份的 manifest）
pg_basebackup \
    --host=127.0.0.1 \
    --port=5432 \
    --username=repl_user \
    --pgdata=/backup/base_incr_day2 \
    --incremental=/backup/base_full/backup_manifest \
    --wal-method=stream \
    --checkpoint=fast
```

            

### 6.3 PostgreSQL PITR

            

PostgreSQL 的 PITR 基于全量物理备份加 WAL
            归档。恢复流程如下：
            
```
# 第一步：从 pg_basebackup 恢复数据目录
systemctl stop postgresql
rm -rf /var/lib/postgresql/16/main/*
cp -a /backup/base_20250108/* /var/lib/postgresql/16/main/
```

            

然后创建恢复配置。PostgreSQL 12 及以后版本使用
            `postgresql.conf` 中的恢复参数：
            
```
# postgresql.conf 中添加恢复参数
restore_command = 'cp /backup/wal_archive/%f %p'
recovery_target_time = '2025-01-08 14:30:00'
recovery_target_action = 'promote'
```

            

并创建恢复信号文件：
            
```
# 创建恢复信号文件
touch /var/lib/postgresql/16/main/recovery.signal
chown postgres:postgres /var/lib/postgresql/16/main/recovery.signal

# 启动 PostgreSQL，开始恢复
systemctl start postgresql
```

            

PostgreSQL 会自动从归档中获取 WAL
            文件，按顺序回放，直到达到 `recovery_target_time`
            指定的时间点，然后提升为主库。
            

### 6.4 第三方工具

            

PostgreSQL 生态中还有多个成熟的备份管理工具：
            
            
- **pgBackRest**：功能最全面的 PostgreSQL
            备份工具，支持全量/差异/增量备份、并行备份与恢复、本地与远程（S3/GCS/Azure）存储、备份校验、WAL
            归档管理。生产环境推荐。
            
- **Barman**（Backup and Recovery
            Manager）：由 EDB 维护，支持远程备份、WAL
            归档、PITR、备份目录管理。
            
- **WAL-G**：由
            Citus（Microsoft）维护，轻量级的 WAL
            归档和备份工具，原生支持云存储。
            
            

pgBackRest 的使用示例：
            
```
# pgBackRest 配置（/etc/pgbackrest/pgbackrest.conf）
# [global]
# repo1-path=/backup/pgbackrest
# repo1-retention-full=2
# repo1-cipher-type=aes-256-cbc
# repo1-cipher-pass=backup-encryption-key
# process-max=4
# compress-type=zst
# compress-level=3
#
# [mydb]
# pg1-path=/var/lib/postgresql/16/main

# 全量备份
pgbackrest --stanza=mydb --type=full backup

# 增量备份
pgbackrest --stanza=mydb --type=incr backup

# 差异备份
pgbackrest --stanza=mydb --type=diff backup

# 恢复到指定时间点
pgbackrest --stanza=mydb --type=time \
    --target="2025-01-08 14:30:00" \
    restore
```

            

### 6.5 PostgreSQL
            备份方案选型

            
            
            
            
            
            
            
            
            
            
            
            
            
            方案
            类型
            备份速度
            恢复速度
            支持增量
            支持 PITR
            远程存储
            适用规模
            
            
            
            
            pg_dump
            逻辑
            慢
            慢（可并行）
            不支持
            不支持
            手动
            < 100 GB
            
            
            pg_basebackup
            物理
            快
            快
            PG 17 支持
            配合 WAL
            手动
            TB 级
            
            
            pgBackRest
            物理
            快（并行）
            快（并行）
            支持
            内置
            S3/GCS/Azure
            TB 级
            
            
            Barman
            物理
            快
            快
            支持
            内置
            S3/GCS
            TB 级
            
            
            WAL-G
            物理
            快
            快
            支持
            内置
            S3/GCS/Azure
            TB 级
            
            
            
            
            

## 七、备份验证与恢复测试

            

备份文件存在不等于备份可用。未经验证的备份和没有备份本质上没有区别。
            

### 7.1 备份验证的层次

            

备份验证可以分为四个层次，从低到高：
            

**第一层：文件完整性校验**。检查备份文件是否完整、未损坏。最基本的做法是计算校验和（如
            SHA-256）并与备份时记录的校验和对比。
            
```
# 备份时记录校验和
sha256sum /backup/full_20250108.tar.gz > /backup/full_20250108.sha256

# 验证时比对
sha256sum -c /backup/full_20250108.sha256
```

            

**第二层：格式有效性校验**。检查备份文件是否符合预期格式。对于
            XtraBackup，可以用 `--validate` 选项；对于
            pg_dump 的自定义格式，可以用 `pg_restore --list`
            检查目录结构。
            
```
# XtraBackup 验证
xtrabackup --validate --target-dir=/backup/full_20250108

# pg_dump 自定义格式验证
pg_restore --list /backup/mydb_20250108.dump > /dev/null
echo "pg_restore --list exit code: $?"
```

            

**第三层：恢复可行性验证**。将备份恢复到一个独立的测试实例，确认数据库能正常启动。
            

**第四层：数据正确性验证**。恢复后检查关键表的行数、校验和或业务逻辑是否正确。这是最可靠但也最耗时的验证方式。
            

### 7.2 自动化恢复测试

            

生产环境中应该定期（建议至少每周一次）执行自动化恢复测试。以下是一个
            MySQL XtraBackup 恢复测试脚本的核心逻辑：
            
```
#!/bin/bash
# restore_test.sh —— XtraBackup 自动化恢复测试
# 在独立的测试实例上恢复最新备份并验证

set -euo pipefail

BACKUP_DIR="/backup/latest"
TEST_DATADIR="/var/lib/mysql-restore-test"
TEST_PORT=3307
LOG_FILE="/var/log/backup-restore-test.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "${LOG_FILE}"
}

cleanup() {
    # 停止测试实例
    mysqladmin --port="${TEST_PORT}" --socket=/run/mysqld/mysqld-test.sock \
        shutdown 2>/dev/null || true
    rm -rf "${TEST_DATADIR}"
}

trap cleanup EXIT

log "开始恢复测试"

# 第一步：准备数据目录
rm -rf "${TEST_DATADIR}"
mkdir -p "${TEST_DATADIR}"

# 第二步：解压并 prepare
xtrabackup --decompress --target-dir="${BACKUP_DIR}"
xtrabackup --prepare --target-dir="${BACKUP_DIR}"
xtrabackup --move-back --target-dir="${BACKUP_DIR}" --datadir="${TEST_DATADIR}"
chown -R mysql:mysql "${TEST_DATADIR}"

# 第三步：启动测试实例
mysqld_safe \
    --datadir="${TEST_DATADIR}" \
    --port="${TEST_PORT}" \
    --socket=/run/mysqld/mysqld-test.sock \
    --skip-slave-start &

# 等待启动
for i in $(seq 1 30); do
    if mysqladmin --port="${TEST_PORT}" \
        --socket=/run/mysqld/mysqld-test.sock ping 2>/dev/null; then
        break
    fi
    sleep 1
done

# 第四步：数据验证
RESULT=$(mysql --port="${TEST_PORT}" \
    --socket=/run/mysqld/mysqld-test.sock \
    -N -e "SELECT COUNT(*) FROM mydb.orders")
log "orders 表行数：${RESULT}"

if [ "${RESULT}" -gt 0 ]; then
    log "恢复测试通过"
    exit 0
else
    log "恢复测试失败：orders 表为空"
    exit 1
fi
```

            

### 7.3 验证清单

            

每次恢复测试至少应该检查以下项目：
            
            
- 备份文件校验和是否匹配。
            
- 恢复过程是否无报错完成。
            
- 数据库能否正常启动并接受连接。
            
- 关键表的行数是否在预期范围内。
            
- 最近写入的数据是否存在（验证备份的时效性）。
            
- 恢复所用时间是否在 RTO 要求内。
            
            
            

## 八、备份加密与压缩

            

### 8.1 压缩

            

备份压缩的目的是减少存储占用和传输时间。常用的压缩算法及其特点：
            
            
            
            算法
            压缩比（典型）
            压缩速度
            解压速度
            适用场景
            
            
            
            
            gzip
            中（3-5x）
            中
            中
            通用，兼容性最好
            
            
            pigz
            中（3-5x）
            快（多线程 gzip）
            中
            gzip 的并行替代
            
            
            zstd
            中高（3-6x）
            快
            极快
            推荐的现代替代方案
            
            
            lz4
            低（2-3x）
            极快
            极快
            对速度敏感的场景
            
            
            xz / lzma
            高（5-8x）
            极慢
            慢
            长期归档，不推荐日常备份
            
            
            
            

对于数据库备份，推荐使用
            zstd。它在压缩比和速度之间取得了较好的平衡，且支持多线程：
            
```
# 使用 zstd 压缩备份（4 线程，压缩级别 3）
pg_basebackup --pgdata=- --wal-method=stream --checkpoint=fast \
    | zstd -T4 -3 -o /backup/base_20250108.tar.zst

# 解压
zstd -d -T4 /backup/base_20250108.tar.zst -o /backup/base_20250108.tar
```

            

### 8.2 加密

            

备份文件包含完整的业务数据，一旦泄露等同于数据库被拖库。备份加密是安全基线的一部分。
            

加密分为两种方式：
            

**传输加密（Encryption in
            Transit）**：备份数据在网络传输过程中加密。`pg_basebackup`
            通过 SSL 连接自动实现。XtraBackup 传输到远程存储时可以通过
            SSH 隧道或 TLS 加密。
            

**静态加密（Encryption at
            Rest）**：备份文件在存储介质上加密。有两种常见做法：
            

方式一：工具内置加密。pgBackRest 内置支持 AES-256-CBC
            加密：
            
```
# pgBackRest 加密配置
[global]
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=your-encryption-passphrase
```

            

方式二：用 `openssl` 或 `gpg`
            在备份管道中加密：
            
```
# 使用 openssl 加密备份
pg_dump --format=custom --dbname=mydb \
    | openssl enc -aes-256-cbc -salt -pbkdf2 \
        -pass file:/etc/backup/encryption.key \
    > /backup/mydb_encrypted.dump

# 解密恢复
openssl enc -d -aes-256-cbc -pbkdf2 \
    -pass file:/etc/backup/encryption.key \
    -in /backup/mydb_encrypted.dump \
    | pg_restore --dbname=mydb
```

            

方式三：用 GPG 非对称加密，支持密钥管理和多接收者：
            
```
# 使用 GPG 加密
pg_dump --format=custom --dbname=mydb \
    | gpg --encrypt --recipient backup-team@example.com \
    > /backup/mydb_encrypted.dump.gpg

# 解密
gpg --decrypt /backup/mydb_encrypted.dump.gpg \
    | pg_restore --dbname=mydb
```

            

### 8.3 加密密钥管理

            

加密的难点不在加密本身，而在密钥管理。几个原则：
            
            
- 加密密钥不能和备份文件放在同一个存储位置。否则攻击者拿到备份文件的同时就能拿到密钥。
            
- 密钥应该通过密钥管理服务（KMS）管理，如 AWS
            KMS、HashiCorp Vault。
            
- 至少要有一份密钥的离线副本（如纸质打印或保险柜中的
            USB），以防 KMS 本身不可用。
            
- 定期轮换密钥。旧密钥不能立即销毁，因为旧备份仍然用旧密钥加密。
            
            
            

## 九、3-2-1
            备份规则与最佳实践

            

### 9.1 3-2-1 规则

            

3-2-1
            规则是备份领域最广泛引用的基本准则。它的含义是：
            
            
- **3 份副本**：至少保留 3 份数据副本（1
            份生产数据 + 2 份备份）。
            
- **2 种介质**：备份存储在至少 2
            种不同类型的存储介质上（如本地磁盘 + 对象存储，或磁盘 +
            磁带）。
            
- **1 份异地**：至少 1
            份备份存放在异地（不同的物理机房或不同的云区域）。
            
            
```
3-2-1 规则示意：

┌────────────────────────────────────────────────────────────────┐
│                         3 份副本                                │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  生产数据库    │  │  本地备份      │  │  异地备份（S3）       │  │
│  │  （副本 1）    │  │  （副本 2）    │  │  （副本 3）           │  │
│  │              │  │              │  │                      │  │
│  │  本地 SSD    │  │  本地 HDD    │  │  另一区域的对象存储    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│       介质 1             介质 2              介质 2              │
│     （同城）           （同城）             （异地）             │
│                                                                │
│  2 种介质 ✓     1 份异地 ✓                                      │
└────────────────────────────────────────────────────────────────┘
```

            

3-2-1
            规则的核心逻辑是降低关联故障的概率。同一台服务器上的生产数据和备份可能同时被磁盘阵列故障摧毁；同一个机房的数据可能同时被火灾或断电影响。只有物理隔离和介质隔离才能真正降低同时丢失所有副本的概率。
            

### 9.2 扩展：3-2-1-1-0 规则

            

在 3-2-1 的基础上，一些组织提出了 3-2-1-1-0
            的扩展规则：
            
            
- **1 份离线或不可变**：至少 1
            份备份是离线的（air-gapped，物理断开网络连接）或不可变的（immutable，写入后无法修改或删除）。这是防范勒索软件的关键——如果攻击者能通过网络访问到所有备份，加密后的备份等于没有。S3
            的 Object Lock 功能可以实现对象的不可变存储。
            
- **0
            个未验证的备份**：所有备份都必须经过恢复验证。
            
            

### 9.3 备份保留策略

            

备份不可能无限保留，需要定义保留策略。常见的策略是
            GFS（Grandfather-Father-Son，祖父-父-子）：
            
            
- **Son（每日备份）**：保留最近 7 天。
            
- **Father（每周备份）**：保留最近 4
            周的周日全量备份。
            
- **Grandfather（每月备份）**：保留最近 12
            个月的每月 1 号全量备份。
            
            

具体的保留时长取决于业务合规要求和存储成本。金融行业通常要求保留
            7 年以上的备份；一般互联网业务保留 30-90 天可能就够了。
            

### 9.4 最佳实践清单

            
            
- **备份与生产环境隔离**：备份存储使用独立的账号、独立的网络。生产环境的管理员凭证不应该能直接删除备份。
            
- **备份脚本必须检查退出码**：任何备份命令执行后必须检查返回值，非零退出码必须触发告警。GitLab
            事故的直接原因之一就是脚本没有检查 `pg_dump`
            的退出码。
            
- **定期恢复演练**：至少每季度做一次完整的恢复演练，验证从备份恢复到可用状态的全流程。记录恢复耗时，确认
            RTO 是否达标。
            
- **备份文件加密**：参见第八节。
            
- **使用不可变存储**：对云存储上的备份启用
            Object Lock 或等效功能，防止备份被恶意或意外删除。
            
- **监控备份的时效性**：不仅监控备份任务是否成功，还要监控最近一次成功备份的时间。如果距离上次成功备份超过预期间隔（如
            24 小时 + 缓冲），立即告警。
            
- **文档化恢复流程**：恢复流程不能只存在于某个
            DBA 的脑子里。写成
            runbook，放在团队共享文档中，定期更新。
            
            
            

## 十、备份监控与告警

            

### 10.1 需要监控的指标

            

备份监控应覆盖以下指标：
            
            
            
            
            
            
            
            
            指标
            含义
            告警条件示例
            
            
            
            
            备份任务状态
            最近一次备份任务是成功还是失败
            任务失败立即告警
            
            
            最近一次成功备份时间
            距离现在多久
            超过 RPO 的 2 倍时告警
            
            
            备份文件大小
            本次备份文件的大小
            与前一次相比偏差超过 30% 时告警
            
            
            备份耗时
            备份任务执行了多长时间
            超过历史平均值的 2 倍时告警
            
            
            备份存储剩余空间
            备份目标存储的可用空间
            可用空间低于 20% 时告警
            
            
            WAL 归档延迟
            最新归档的 WAL 与最新生成的 WAL 之间的差距
            延迟超过 N 个 WAL 段时告警
            
            
            恢复测试结果
            最近一次恢复测试是否通过
            失败立即告警
            
            
            
            

### 10.2 PostgreSQL WAL
            归档监控

            

PostgreSQL 提供了系统视图来监控 WAL 归档状态：
            
```
-- 查看归档状态
SELECT * FROM pg_stat_archiver;

-- 关键字段：
-- archived_count：已成功归档的 WAL 文件数
-- failed_count：归档失败的次数
-- last_archived_wal：最后一个成功归档的 WAL 文件名
-- last_archived_time：最后一次成功归档的时间
-- last_failed_wal：最后一个归档失败的 WAL 文件名
-- last_failed_time：最后一次归档失败的时间
```

            

基于这些指标，可以构建 Prometheus 监控查询：
            
```
# Prometheus 告警规则示例（需要配合 postgres_exporter）
groups:
  - name: backup_alerts
    rules:
      - alert: WALArchiveFailing
        expr: pg_stat_archiver_failed_count > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL WAL 归档失败"
          description: "WAL 归档失败次数：{{ $value }}，最后失败的文件：{{ $labels.last_failed_wal }}"

      - alert: WALArchiveStale
        expr: time() - pg_stat_archiver_last_archive_time > 3600
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL WAL 归档停滞"
          description: "距离上次成功归档已超过 1 小时"
```

            

### 10.3 备份任务监控脚本

            

以下脚本展示了一个基于文件时间戳的备份时效性检查逻辑：
            
```
#!/bin/bash
# check_backup_freshness.sh —— 检查备份文件的时效性
# 通过 Prometheus node_exporter 的 textfile collector 暴露指标

BACKUP_DIR="/backup"
METRICS_FILE="/var/lib/node_exporter/textfile/backup_freshness.prom"
MAX_AGE_SECONDS=90000  # 25 小时（给 24 小时备份周期留 1 小时缓冲）

# 查找最新的备份文件
LATEST_BACKUP=$(find "${BACKUP_DIR}" -name "*.dump" -o -name "*.tar.zst" \
    | sort -t_ -k2 -r | head -1)

if [ -z "${LATEST_BACKUP}" ]; then
    echo "# HELP backup_last_success_timestamp_seconds 最近一次成功备份的 Unix 时间戳" \
        > "${METRICS_FILE}"
    echo "backup_last_success_timestamp_seconds 0" >> "${METRICS_FILE}"
    echo "backup_freshness_ok 0" >> "${METRICS_FILE}"
    exit 0
fi

BACKUP_TIMESTAMP=$(stat -c %Y "${LATEST_BACKUP}")
CURRENT_TIME=$(date +%s)
AGE=$((CURRENT_TIME - BACKUP_TIMESTAMP))

{
    echo "# HELP backup_last_success_timestamp_seconds 最近一次成功备份的 Unix 时间戳"
    echo "backup_last_success_timestamp_seconds ${BACKUP_TIMESTAMP}"
    echo "# HELP backup_age_seconds 最近一次备份距今的秒数"
    echo "backup_age_seconds ${AGE}"
    echo "# HELP backup_freshness_ok 备份时效性是否正常（1=正常，0=过期）"
    if [ "${AGE}" -lt "${MAX_AGE_SECONDS}" ]; then
        echo "backup_freshness_ok 1"
    else
        echo "backup_freshness_ok 0"
    fi
} > "${METRICS_FILE}"
```

            

### 10.4 告警分级

            

备份告警建议按以下分级处理：
            
            
- **P0（立即响应）**：备份任务连续失败超过 2
            次、恢复测试失败、WAL 归档连续失败。
            
- **P1（4
            小时内响应）**：备份文件大小异常偏差、备份耗时超过阈值、备份存储空间不足。
            
- **P2（下一个工作日响应）**：单次备份任务失败（但有之前的成功备份可用）、备份保留策略未按预期清理过期文件。
            
            

告警必须发送到实际有人值守的通道——如果备份告警被静默了或发到一个没人看的邮件列表，等于没有告警。
            
            

## 十一、参考文献

            

### 官方文档

            
            
- 

PostgreSQL 16 Documentation. *Chapter 26: Backup
            and Restore*. https://www.postgresql.org/docs/16/backup.html.
            PostgreSQL 官方的备份与恢复文档，覆盖 SQL
            dump、文件系统级备份和连续归档。
            
- 

PostgreSQL 16 Documentation. *Chapter 27: Recovery
            Configuration*. https://www.postgresql.org/docs/16/runtime-config-wal.html.
            WAL 配置参数的官方说明。
            
- 

MySQL 8.0 Reference Manual. *Chapter 9: Backup and
            Recovery*. https://dev.mysql.com/doc/refman/8.0/en/backup-and-recovery.html.
            MySQL 官方的备份与恢复文档。
            
- 

MySQL 8.0 Reference Manual. *mysqldump — A
            Database Backup Program*. https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html.
            `mysqldump` 的完整参数说明。
            
- 

Percona XtraBackup 8.0 Documentation. https://docs.percona.com/percona-xtrabackup/8.0/.
            XtraBackup 的官方文档，覆盖全量/增量备份、prepare
            和恢复流程。
            
            

### 工具文档

            
            
- 

pgBackRest Documentation. https://pgbackrest.org/. pgBackRest
            的官方文档，覆盖配置、使用和架构。
            
- 

Barman Documentation. https://docs.pgbarman.org/. Barman
            的官方使用文档。
            
- 

WAL-G Documentation. https://github.com/wal-g/wal-g. WAL-G 项目的
            GitHub 仓库和文档。
            
            

### 事故复盘

            
            
- 

GitLab. *GitLab.com Database Incident —
            2017-01-31*. https://about.gitlab.com/blog/2017/02/01/gitlab-dot-com-database-incident/.
            GitLab 2017
            年数据库事故的官方复盘报告，详细记录了五种备份机制如何同时失效。
            
- 

GitLab. *Postmortem of database outage of January
            31*. https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/.
            事故的完整事后分析。
            
            

### 书籍与论文

            
            
- 

Kleppmann, M. (2017). *Designing Data-Intensive
            Applications*. O’Reilly.
            第七章”事务”讨论了持久性保证与备份的关系。
            
- 

Obe, R., Hsu, L. (2024). *PostgreSQL: Up and
            Running*, 4th Edition. O’Reilly. PostgreSQL
            管理和备份的实践指南。
            
- 

Schwartz, B., et al. (2012). *High Performance
            MySQL*, 3rd Edition. O’Reilly. MySQL
            备份策略的深入讨论见第十五章。
            
            

### 行业规范

            
            
- 

NIST SP 800-184. *Guide for Cybersecurity Event
            Recovery*. https://csrc.nist.gov/publications/detail/sp/800-184/final.
            NIST
            关于网络安全事件恢复的指南，包含备份策略的安全要求。
            
- 

ISO 22301:2019. *Security and resilience —
            Business continuity management systems — Requirements*.
            业务连续性管理的国际标准，定义了 RPO 和 RTO
            的框架。
            
            
            

**上一篇**: 存储故障模式
            **下一篇**: 灾难恢复设计
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-11 · storage
                    

### 【存储工程】存储事故复盘：经典生产故障的根因与教训

                    

深度复盘 GitLab 2017 数据库事故和 GitHub 2018 存储故障的完整时间线与根因分析，提取跨事故的通用模式，给出构建抗事故存储实践的工程建议。
                

                
                    

2026-06-18 · database / kernel
                    

### 【MySQL InnoDB 内核】主从切换与数据恢复：PITR 与 xtrabackup 边界

                    

mysqldump 与 xtrabackup 机制差异、binlog PITR、GTID failover 与误删恢复边界。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。