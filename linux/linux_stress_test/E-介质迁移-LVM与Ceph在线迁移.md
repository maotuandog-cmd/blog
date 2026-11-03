# E. 介质迁移 — HDD→SSD 在线迁移

原文依据: quant67/storage 06-storage-media-selection.md
  md:1349-1363  LVM 在线迁移 (推荐)
  md:1367-1375  应用层迁移 (数据库主从切换)
  md:1379-1388  分布式存储迁移 (Ceph CRUSH)

================================================================
E.0 三种迁移方案对比
================================================================

  方案          中断时间   复杂度   适用场景
  ────────────────────────────────────────────
  LVM pvmove    0 (在线)    中       已有 LVM, 数据卷可在线搬
  主从切换      几秒        高       数据库 (MySQL/PG)
  Ceph rebal    0 (在线)    中       Ceph 集群 pool 在 HDD/SSD 间切换

================================================================
E.1 LVM 在线迁移 (原文 md:1349-1363)
================================================================

原文命令逐字:
```
# 1. 将 SSD 加入 VG
pvcreate /dev/nvme0n1p1
vgextend vg0 /dev/nvme0n1p1

# 2. 在线迁移 LV 的数据到新 PV
pvmove /dev/sda1 /dev/nvme0n1p1

# 3. 迁移完成后从 VG 移除旧 PV
vgreduce vg0 /dev/sda1
pvremove /dev/sda1
```

----------------------------------------------------------------
E.1.1 步骤 1: pvcreate + vgextend — 把 SSD 加进 VG
----------------------------------------------------------------

```
pvcreate /dev/nvme0n1p1
```
参数:
  默认: PE size 4MB
  可指定: pvcreate --metadatasize 100M /dev/nvme0n1p1
  常用 --dataalignment 1m (与 SSD 物理块对齐)

```
vgextend vg0 /dev/nvme0n1p1
```
  把新 PV 加入已有 VG

查看:
```
pvs
# NAME             VG   Fmt  Attr PSize  PFree
# /dev/sda1        vg0  lvm2 a--  4.55t 4.55t
# /dev/nvme0n1p1   vg0  lvm2 a--  3.84t 3.84t

vgs vg0
```

----------------------------------------------------------------
E.1.2 步骤 2: pvmove — 在线数据搬运 (核心)
----------------------------------------------------------------

```
pvmove /dev/sda1 /dev/nvme0n1p1
```

参数:
  pvmove SOURCE_PV [DEST_PV]
  省略 DEST_PV = 移到 VG 内任意有空间的 PV
  加 -b    后台运行 (输出到日志)
  加 -i N  每 N 秒报告进度

常用形式:
```
# 标准迁移 (前台, 带进度)
pvmove /dev/sda1 /dev/nvme0n1p1

# 后台迁移
pvmove -b /dev/sda1 /dev/nvme0n1p1
# 监控:
lvs
# 看 LV 的 "Move" 状态列

# 仅迁某个 LV
pvmove -n data_lv /dev/sda1 /dev/nvme0n1p1

# 限定 I/O 带宽 (避免迁移抢业务带宽)
pvmove --atomic /dev/sda1 /dev/nvme0n1p1
# --atomic  整段迁移后再切, 避免一致性窗口
```

⚠️ 重要约束:
  - 不能中断 (断电需用 pvmove --abort 恢复)
  - pvmove 期间避免对同一 VG 做其它 LVM 操作
  - 大量数据 (TB 级) 可能耗时数小时

监控进度:
```
lvs -o+devices
# Copy% 列显示当前迁移百分比

cat /proc/lvm
# 实时状态
```

----------------------------------------------------------------
E.1.3 步骤 3: vgreduce + pvremove — 下线旧 PV
----------------------------------------------------------------

```
vgreduce vg0 /dev/sda1
# 从 VG 移除 PV (前提: PV 上的数据都已迁走)

pvremove /dev/sda1
# 删除 PV 上的 LVM 元数据 (此时磁盘可另作他用)
```

----------------------------------------------------------------
E.1.4 pvmove 失败后的恢复
----------------------------------------------------------------
```
pvmove --abort
# 取消正在进行的迁移, 把数据搬回原 PV
# 注意: 中断瞬间未刷盘部分可能丢数据, 需先 fsync 业务
```

================================================================
E.2 数据库主从迁移 (原文 md:1367-1375)
================================================================

适用: MySQL / PostgreSQL 主从架构
原文给出的五步:

  1. 搭建新介质上的从库
  2. 配置主从复制, 等待数据同步完成
  3. 验证数据一致性
  4. 切换流量到新从库 (提升为主库)
  5. 下线旧主库

----------------------------------------------------------------
E.2.1 MySQL 实际操作 (PostgreSQL 见 E.2.3)
----------------------------------------------------------------

  1. 新从库准备 (在 SSD 上)
     mysqld --initialize-insecure --datadir=/mnt/nvme/mysql

  2. 启动主从复制
     CHANGE MASTER TO
       MASTER_HOST='old_master',
       MASTER_USER='repl',
       MASTER_PASSWORD='***',
       MASTER_LOG_FILE='binlog.000123',
       MASTER_LOG_POS=456;

     START SLAVE;
     SHOW SLAVE STATUS\G
     # 看 Seconds_Behind_Master 逐步降到 0

  3. 数据一致性校验
     pt-table-checksum --execute \
       h=master,P=3306,u=root \
       h=slave,P=3306,u=root
     pt-table-sync --print --execute \
       h=master h=slave

  4. 切换 (选择低峰窗口)
     方法 A: 主库 SET GLOBAL read_only = ON
             应用切到新主
             老主降为从
     方法 B: 用 ProxySQL / VIP 漂移 (更平滑)

  5. 下线老主
     mysqladmin -uroot shutdown

----------------------------------------------------------------
E.2.2 切换时的关键注意点
----------------------------------------------------------------

  - VIP 漂移方案: ARP 刷新 + keepalived, 切换秒级
  - 双写方案: 应用层同时写新旧主, 再停老主, 零丢失 (复杂)
  - 反向复制: 切后立刻建立"新主→老主"的主从, 便于回滚

----------------------------------------------------------------
E.2.3 PostgreSQL 版本
----------------------------------------------------------------

  1. pg_basebackup 拉基准备份 (在 SSD 上)
     pg_basebackup -h old_master -D /mnt/nvme/pgdata -U repl -Xs -P

  2. 配置 recovery.conf (PG 12+ 改 postgresql.auto.conf)
     primary_conninfo = 'host=old_master user=rep password=***'
     restore_command = ...

  3. 启动新从, 等追上
     SELECT pg_last_wal_replay_lsn();

  4. 切换 (用 pg_ctl promote 或新主触发 switchover)
     pg_ctl promote -D /mnt/nvme/pgdata

================================================================
E.3 分布式存储迁移 (Ceph)
================================================================

原文: md:1379-1388
原文命令:
```
ceph osd pool set mypool crush_rule ssd_rule
ceph -s
```

----------------------------------------------------------------
E.3.1 前置: 定义 SSD class 的 CRUSH rule
----------------------------------------------------------------
```
# 1. 创建两个 CRUSH rule (假设已分好 HDD 和 SSD bucket)
ceph osd crush rule create-ruleset hdd_rule default host hdd
ceph osd crush rule create-ruleset ssd_rule default host ssd

# 2. 查看
ceph osd crush rule dump
```

----------------------------------------------------------------
E.3.2 切换 pool 的 CRUSH rule (原文核心命令)
----------------------------------------------------------------
```
ceph osd pool set mypool crush_rule ssd_rule
```

参数:
  mypool         pool 名
  crush_rule     CRUSH rule 名
  ssd_rule       新规则 (引用 ssd 类)

⚠️ 这一步会触发数据自动重平衡, 过程不阻塞读写

----------------------------------------------------------------
E.3.3 监控重平衡进度 (原文 md:1387)
----------------------------------------------------------------
```
ceph -s
# 输出:
#   cluster:
#     id:     xxx
#     health: HEALTH_WARN  (迁移期间)
#   services:
#     mon: 3 daemons active
#     mgr: 1 daemon active
#     osd: 12 osds: 12 up, 12 in
#   data:
#     pools: 4 pools, 512 pgs
#     objects: 1.2M objects, 5 TiB
#     usage:  12 TiB used, 48 TiB / 60 TiB avail
#     pgs:    512 active+clean+scrubbing+deep+repair
#             89  active+remapped+backfill_wait
# 关注: remapped/backfill_wait/backfill 等数字, 0 表示完成

ceph osd pool stats mypool
# 详细 PG 状态

ceph -w
# 持续输出集群事件
```

----------------------------------------------------------------
E.3.4 控制 rebalance 速度 (避免影响业务)
----------------------------------------------------------------
```
# 限制 PG 迁移速率
ceph config set osd osd_max_backfills 1
# 默认 1, 生产可调到 1-2

# 限制恢复操作并发
ceph config set osd osd_recovery_max_active 3
# 默认 3

# 完成后恢复
ceph config set osd osd_max_backfills 1
ceph config set osd osd_recovery_max_active 3
```

----------------------------------------------------------------
E.3.5 验证完成
----------------------------------------------------------------
```
ceph -s
# health: HEALTH_OK
# pgs: all active+clean
```

================================================================
E.4 三方案适用场景速查
================================================================

  数据在 LVM 卷     → E.1 pvmove (推荐, 业务不中断)
  数据在数据库主库   → E.2 主从切换 (PG/MySQL 通用)
  数据在 Ceph pool  → E.3 CRUSH rule 切换 (自动 rebalance)

================================================================
E.5 迁移前的回滚预案
================================================================

LVM 迁移:
  - pvmove 中断: pvmove --abort
  - 切换完想回退: 反向 pvmove 把数据挪回 HDD

主从切换:
  - 切换后老主保持同步, 一旦新主异常可立刻切回

Ceph:
  - ceph osd pool set mypool crush_rule hdd_rule 切回去
  - 同样会触发反向 rebalance

================================================================
E 类命令 → 决策节点
================================================================

LVM pvmove 完成
  ↓
  iostat 验证 SSD 性能 (C 类)
  ↓
  io 性能达标  → 完成迁移, 进入 F 类持续监控
  性能未达预期 → 考虑 D 类缓存加速