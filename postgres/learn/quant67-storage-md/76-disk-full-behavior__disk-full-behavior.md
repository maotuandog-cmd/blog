# 【存储工程】磁盘空间耗尽：从 70% 到 ENOSPC 的行为退化链

来源: https://quant67.com/post/storage/76-disk-full-behavior/disk-full-behavior.html
日期: 2026-06-11 |

---

磁盘空间监控最常见的告警阈值是
            80%——超过这个值发通知，超过 90% 紧急处理。但这个”80%
            红线”对不同文件系统、不同工作负载的实际含义完全不同。对于某些场景，70%
            已经是在刀尖上跳舞了；对于另一些场景，95%
            还能平稳运行。盲目套用统一阈值，要么是狼来了式的告警轰炸，要么是真出事时的后知后觉。
            

本文从块分配器行为退化开始，逐一拆解 ext4、XFS、Btrfs 和
            ZFS 在从 70% 到 100% 填充过程中的行为变化，然后讨论
            ENOSPC（No Space Left on
            Device）的恢复方法、应用层故障模式，最后落到监控阈值设计和自动应急方案。
            
            

**测试环境说明** ext4、XFS、Btrfs 的 ENOSPC
            与分配器退化行为在 Linux 6.8 内核上验证，工具版本为
            ext4（e2fsprogs 1.47）、XFS（xfsprogs
            6.5）、Btrfs（btrfs-progs 6.6）。ZFS 章节依据 OpenZFS
            官方文档与工程实践归纳，未在本文环境中实测。其他内核版本的行为可能有所不同——尤其
            Btrfs 的 ENOSPC 处理在不同版本之间变化较大。
            
            
            

## 一、空间填充的行为分期

            

文件系统”满”不是一瞬间发生的。从一个干净的文件系统到
            ENOSPC，中间经历了多个行为退化阶段。每个阶段的退化表现因文件系统而异，但大致可以划分为以下区间：
            
```
┌──────────┬──────────────────────────────────────────────┐
│ 填充率    │ 典型行为                                       │
├──────────┼──────────────────────────────────────────────┤
│ 0–70%    │ 正常。块分配器有充足连续空间，性能稳定           │
│ 70–85%   │ 块分配器开始需要更多搜索来找到连续空闲块         │
│ 85–95%   │ 碎片化明显。分配延迟开始出现抖动，大块分配可能失败│
│ 95–98%   │ 紧急状态。文件系统开始拒绝非必要分配，元数据操作  │
│          │ 可能失败，部分文件系统进入降级模式               │
│ 98–100%  │ 灾难状态。连删除文件都可能失败，需要人工介入      │
│ 100%     │ ENOSPC。文件系统空间耗尽，写入彻底失败            │
└──────────┴──────────────────────────────────────────────┘
```

            
```
flowchart LR
    subgraph fill["填充率与退化"]
        P0["0–70% 正常"]
        P1["70–85% 搜索加剧"]
        P2["85–95% 碎片化"]
        P3["95–98% 紧急"]
        P4["98–100% 灾难"]
        P5["100% ENOSPC"]
    end
    P0 --> P1 --> P2 --> P3 --> P4 --> P5
```

            

这张表是整个讨论的框架。下面逐文件系统拆解每个阶段的具体行为。
            
            

## 二、ext4：多块分配退化和
            root reserve

            

### 2.1 块分配器的退化路径

            

ext4 使用多块分配器（Multiblock
            Allocator，mballoc）来分配数据块。当文件系统有充足空闲空间时，mballoc
            能一次分配几十到几百个连续块，形成大的
            extent。随着空闲空间减少，mballoc 的行为逐步退化：
            
```
mballoc 在不同填充率下的行为：

0–70%：
  从空闲 extent 缓存（buddy cache）中直接获取大的连续区域
  预分配（preallocation）机制正常工作

70–85%：
  空闲 extent 缓存中的大块减少
  mballoc 需要扫描块位图来找到连续区域
  预分配开始经常失败，退化为按需分配

85–95%：
  连续空闲区域碎片化为小段
  大的 extent 分配极少成功，文件碎片化加剧
  mballoc 回退到逐个块分配（单块模式）

95%+：
  块位图扫描可能跨越多个块组（block group）
  单次分配可能涉及数十次位图读取
  分配延迟显著上升（高填充率下可达毫秒级，视碎片程度而定）
```

            

mballoc
            的退化路径可以在内核源码中追踪。`fs/ext4/mballoc.c`
            中的 `ext4_mb_regular_allocator()`
            函数在找不到合适连续区域时，会逐步降低要求（从
            `goal` 长度降低到单块），最终调用
            `ext4_mb_simple_scan()` 做逐块扫描。
            

### 2.2 root reserve：5%
            的救命稻草

            

ext4 默认保留 5% 的块给 root
            用户（`reserved_blocks`）。这意味着当普通用户的写入触发
            ENOSPC 时，root
            仍然可以写入——这是为了确保管理员有空间执行清理操作。
            
```
# 查看保留块数量和百分比
tune2fs -l /dev/sda1 | grep -i "reserved block"

# 输出示例：
# Reserved block count:     1310720
# Percentage reserved:      5%

# 调整保留百分比（仅在有明确理由时修改）
tune2fs -m 1 /dev/sda1   # 降为 1%（大容量文件系统上常用）
tune2fs -m 0 /dev/sda1   # 完全取消（谨慎！可能导致无法恢复）
```

            

大容量文件系统上，5% 是一个过大的数字。一个 10 TB ext4
            文件系统，5% 是 500
            GB——这么多保留空间对管理员来说完全过剩。常见的做法是：对于纯数据分区（无操作系统文件），降到
            1%；对于系统分区（`/`, `/var`），保持
            5% 或至少 2%。
            

但注意：root reserve 只在块分配层面工作。如果文件系统的
            inode 耗尽了（而不是数据块），root reserve 帮不了你——root
            同样无法创建新文件。
            

### 2.3 inode 耗尽：另一种
            ENOSPC

            

ext4 的 inode
            数量在创建文件系统时固定（`mkfs.ext4 -i` 或
            `-N` 参数决定）。当 inode
            用完时，所有文件创建操作都会失败——即使 `df -h`
            显示还有 50% 的可用空间。
            
```
# 查看 inode 使用情况
df -i /mnt/data

# 输出示例：
# Filesystem     Inodes  IUsed   IFree IUse% Mounted on
# /dev/sda1      6553600 6540000  13600   99% /mnt/data

# 即使 df -h 显示 40% 空闲，inode 耗尽也能让写入失败
df -h /mnt/data
# /dev/sda1      100G   60G   40G  60% /mnt/data
```

            

这就是为什么存储监控必须同时监控
            `df -h`（块使用）和 `df -i`（inode
            使用）。两个维度中的任何一个触线都会导致系统不可用。
            

### 2.4 ext4 容量红线

            
```
ext4 容量监控建议：

70%  → 预警线。开始规划扩容或清理
85%  → 严重警告。启动临时文件清理，暂停非核心写入
90%  → 紧急线。mballoc 退化明显，碎片化加速
95%  → 灾难线。仅 root 可写（如果保留 5%）
100% → 普通用户 ENOSPC
```

            
            

## 三、XFS：AG
            碎片化与分配组不均衡

            

### 3.1 XFS 的分配组机制

            

XFS 将卷划分为若干等大的分配组（Allocation
            Group，AG）。每个 AG 有独立的空闲空间 B+tree、inode B+tree
            和块分配器状态。`mkfs.xfs` 默认按卷容量自动计算
            AG 大小（通常在 256 MiB 到 1 TiB 之间）和数量（通常 4
            到数千个）。例如 1 TB 卷常见配置为 4 个 AG、每个约 250
            GB——但这并非固定规则，应以 `xfs_info`
            输出为准（详见本站 XFS
            架构 §二）。
            
```
# 查看 AG 数量与每个 AG 的块数
xfs_info /dev/sda1
# 典型输出片段：agcount=4, agsize=65536 blks
```

            

这个设计的优势是并行性——多个并发的分配操作可以在不同 AG
            中独立进行。但这个设计也带来了一个陷阱：**AG
            之间的空间使用可能不均衡**。
            

当某些 AG 的空间使用远高于其他 AG 时，即使整体利用率只有
            75%，某些 AG 可能已经接近 100%。文件系统的块分配器在目标 AG
            中选择空闲区域，但如果目标 AG 已满，分配器需要切换
            AG——这增加了延迟和碎片。
            

### 3.2 高填充率下的 AG 退化

            
```
XFS 填充率      AG 层面行为
────────────────────────────────────────────

            

## 四、Btrfs：元数据
            ENOSPC 的独立危机

            

### 4.1 两套空间池：数据 vs
            元数据

            

Btrfs 的一个核心设计是数据和元数据使用独立的空间池（Block
            Group）。一个 Btrfs 文件系统可能有以下 block group
            类型：
            
```
Btrfs Block Group 类型：
  DATA       → 文件数据
  METADATA   → inode、extent tree、checksum tree 等
  SYSTEM     → chunk tree（极小，通常 8–32 MB）
```

            

这意味着 Btrfs
            可能出现一种独特的故障模式：**元数据空间耗尽，而数据空间仍有余量。**
            
```
# 查看 Btrfs 各类型的空间使用
btrfs filesystem usage /mnt/btrfs

# 输出示例（截断）：
# Overall:
#     Device size:         500.00GiB
#     Device allocated:    450.00GiB
#     Device unallocated:   50.00GiB
#
# Data,single: Size:400.00GiB, Used:395.00GiB
#    /dev/sda1     400.00GiB
#
# Metadata,single: Size:48.00GiB, Used:47.95GiB
#    /dev/sda1      48.00GiB
#    ← 元数据几乎满了！但数据还有 5 GiB 空闲
#
# System,single: Size:32.00MiB, Used:16.00KiB
#    /dev/sda1      32.00MiB
```

            

当元数据空间耗尽时，所有涉及元数据变更的操作（创建文件、扩展已有文件、创建快照、删除文件——注意，删除文件也需要更新元数据）都会失败。用户会看到
            ENOSPC，但 `df -h` 可能显示还有几十 GB
            数据空间——这是 Btrfs 场景下最令人困惑的故障模式。
            

### 4.2 紧急恢复：Btrfs
            元数据 ENOSPC

            

当 Btrfs 元数据空间耗尽，标准的 `rm`
            操作可能失败（需要更新目录项元数据）。恢复步骤：
            
```
# 步骤 1：确认是元数据 ENOSPC
btrfs filesystem usage /mnt/btrfs | grep Metadata
# 如果 Metadata Used 接近 Metadata Size，确认为元数据耗尽

# 步骤 2：尝试添加新的元数据空间
# 在文件系统还有未分配空间时：
btrfs balance start -dusage=0 /mnt/btrfs
# -dusage=0 表示只重写空闲数据块组，释放给元数据使用

# 步骤 3：如果 balance 也失败（需要元数据空间来记录 balance 操作）
# 最坏情况：只读挂载，复制数据，重建文件系统
mount -o remount,ro /mnt/btrfs
```

            

从 Linux 5.4 开始，Btrfs 引入了全局保留（Global
            Reserve）机制：一小部分元数据空间被预留，仅供紧急的元数据操作使用（包括
            `rm`、`truncate`）。这大大降低了元数据
            ENOSPC
            的灾难性程度，但全局保留空间非常有限——如果文件系统上的操作量过大，这个保留仍然可能被耗尽。
            

### 4.3 Btrfs 容量红线

            
```
Btrfs 容量监控建议：

总体使用率（设备分配/设备总大小）：
  70%  → 预警线
  85%  → 严重警告。启动 balance，回收未使用 chunk
  90%  → 紧急线

元数据使用率（单独监控！）：
  75%  → 预警线（如果分配了较多 metadata chunk）
  90%  → 紧急线。立即执行 metadata balance
  95%  → 灾难线。文件创建可能失败
```

            

Btrfs
            的独特之处：**元数据使用率比总体使用率更重要。**
            一个数据空间只用 30% 但元数据空间用了 95% 的 Btrfs
            文件系统，比一个数据空间用了 95% 但元数据空间只用了 50%
            的系统更危险。
            
            

## 五、ZFS：池空间与配额管理

            

### 5.1 ZFS 的空间模型

            

ZFS
            不使用独立的文件系统空间，所有数据集（dataset）共享同一个存储池（pool）的空间。这使得空间管理更灵活——不需要像
            ext4/XFS
            那样为每个分区预留空间——但也带来了新的故障模式。
            
```
# 查看池空间使用
zpool list tank

# 输出示例：
# NAME   SIZE  ALLOC   FREE  CAP  HEALTH
# tank   10T   8.5T   1.5T   85%  ONLINE

# 查看各数据集的配额和使用
zfs list -o name,used,available,quota,reservation
```

            

### 5.2 ZFS
            空间耗尽的特殊行为

            

ZFS
            使用写时复制（Copy-on-Write，COW）。每次”覆盖写”实际上是一次”写到新位置
            + 更新块指针”。这意味着在空间紧张时，一次看起来是 “in-place
            update” 的写操作实际上需要额外的空闲空间来完成
            COW。如果池的空间不足，COW
            写可能失败——即使这个写操作的目标是”覆盖”一个已有块。
            

更具体地说：ZFS 事务组（Transaction
            Group）在提交时需要分配新的块。如果池的剩余空间小于一个事务组的典型空间需求，整个事务组可能提交失败。这比传统文件系统（ext4/XFS
            的覆盖写不需要额外空间）更早触发故障。
            
```
# ZFS 在 95%+ 填充率下的性能退化
# COW 写放大效应：
#   填充率 50%: COW 通常写入相邻空闲区域 → 顺序写
#   填充率 85%: COW 开始写入分散的空闲区域 → 随机写
#   填充率 95%: COW 可用空间极小，写放大多次重试 → 延迟飙升
```

            

ZFS 文档建议池使用率不超过 80%，主要原因是 COW
            的开销。这个数字不是硬性限制，但对于随机写密集的负载（如虚拟机磁盘镜像），超过
            80% 确实会导致显著的尾延迟恶化。
            

### 5.3 ZFS 容量红线

            
```
ZFS 容量监控建议：

80%  → 预警线。COW 性能开始退化
90%  → 严重警告。写延迟明显增加
95%  → 紧急线。大型事务组可能提交失败
98%  → 灾难线。基本写操作可能失败
```

            

ZFS 的红线比 ext4/XFS
            更靠前，不是因为它”更脆弱”，而是因为它的 COW
            机制在高填充率下的退化更剧烈。
            
            

## 六、文件系统容量红线对比

            
            
            
            
            
            
            
            
            
            
            条件
            ext4
            XFS
            Btrfs
            ZFS
            
            
            
            
            预警线
            70%
            70%
            70%（数据）/ 75%（元数据）
            80%
            
            
            严重警告
            85%
            85%
            85%（数据）/ 90%（元数据）
            90%
            
            
            紧急线
            90%
            90%
            90%（数据）/ 95%（元数据）
            95%
            
            
            特殊风险
            inode 耗尽
            AG 碎片化
            元数据 ENOSPC
            COW 空间不足
            
            
            恢复难度
            低（rm 即可）
            低（rm 即可）
            中–高（可能需要 balance）
            中（COW 依赖空闲空间）
            
            
            
            

这四条”红线”应该成为存储监控系统的基础告警规则。每条线触发什么动作，取决于业务对存储的依赖程度和数据的重要程度。
            
            

## 七、ENOSPC 应急恢复

            

当 ENOSPC
            真正发生时，以下步骤可以帮助恢复（假设你有足够的权限）。
            

### 7.1 快速诊断

            
```
# 1. 确认空间使用情况
df -h /mnt/data
df -i /mnt/data   # 别忘了 inode

# 2. 如果是 Btrfs / ZFS，确认是哪种空间耗尽
btrfs filesystem usage /mnt/data   # Btrfs
zpool list tank                     # ZFS

# 3. 找到占用空间最大的目录
du -sh /mnt/data/* | sort -rh | head -20

# 4. 检查是否有被删除但未释放空间的文件
lsof +L1 | grep /mnt/data
# 输出示例：
# COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NLINK NODE NAME
# java     1234 appuser  5w   REG  253,0 1073741824    0 56789 /mnt/data/app.log (deleted)
# ← 文件已被删除但进程仍持有 fd，空间未释放
```

            

### 7.2 紧急空间回收

            
```
# 方法 1：截断仍然被进程打开的大文件
# 假设进程 PID 1234 持有 fd 5，对应一个 1GB 的已删除文件
# 通过 /proc 截断它（需要 root）
: > /proc/1234/fd/5          # 截断到 0 字节
# 或者
truncate -s 0 /proc/1234/fd/5

# 方法 2：清理系统日志和临时文件
journalctl --vacuum-size=100M   # 限制 systemd journal 大小
rm -rf /tmp/*                    # 清理临时文件（谨慎）
rm -rf /var/tmp/*                # 清理持久临时文件

# 方法 3：清理包管理缓存
apt-get clean                    # Ubuntu/Debian
yum clean all                    # CentOS/RHEL
dnf clean all                    # Fedora

# 方法 4：清理 Docker（如果使用）
docker system prune -a -f --volumes

# 方法 5：删除旧的快照（Btrfs/ZFS）
btrfs subvolume delete /mnt/data/.snapshots/old_snapshot
zfs destroy tank/data@old_snapshot
```

            

### 7.3 为什么 rm
            有时候也失败

            

一个反直觉的现象：当文件系统 100% 满时，`rm`
            命令可能也失败。原因：
            
            
- 

**ext4/XFS**：删除文件需要写入日志（Journal）。如果日志空间也在同一个分区上（总是如此），日志写入本身可能因为没有空闲空间而失败。ext4
            的日志模式（`data=journal` vs
            `data=ordered` vs
            `data=writeback`）影响这里的行为——`data=journal`
            下日志写更多，更可能在 ENOSPC 时卡住。
            
- 

**Btrfs**：删除文件需要更新 extent tree
            的元数据。如果元数据空间耗尽，删除操作无法记录，失败。
            
- 

**ext4 的 inode 耗尽**：如果 ENOSPC
            是因为 inode 耗尽，而非数据块耗尽——`rm`
            不需要创建新 inode，只需要释放旧的，所以 `rm`
            通常能成功。这正是 inode
            耗尽的”优势”——比数据块耗尽更容易手动恢复。
            
            

紧急情况下优先使用 `truncate` 而非
            `rm`：`truncate -s 0 `
            只更新文件大小元数据，不涉及目录项变更，比 `rm`
            的操作量更小。
            
            

## 八、应用层故障模式

            

存储空间耗尽时，不同应用的故障行为大相径庭。了解这些行为有助于设计降级策略和监控告警。
            

### 8.1 数据库

            

**PostgreSQL**：当 WAL 写入遇到 ENOSPC
            时，PostgreSQL 会
            PANIC——整个数据库集群立即宕机。这是一项刻意设计：宁可用停机来保护数据一致性，也不允许
            WAL 记录丢失。PostgreSQL 源码
            `src/backend/access/transam/xlog.c`
            中，`XLogWrite()` 在持久化 WAL 缓冲时若
            `write()` 失败且错误为
            `ENOSPC`，会通过 `ereport(PANIC, ...)`
            终止进程（版本随 PostgreSQL
            发布变化，行为以所用版本源码为准）。
            
```
# PostgreSQL 日志中的典型 ENOSPC 表现：
# PANIC: could not write to file "pg_wal/00000001000000000000000A": No space left on device
# 数据库立即重启，进入恢复模式
```

            

**MySQL/InnoDB**：InnoDB 遇到 redo log
            ENOSPC 时会 crash，类似 PostgreSQL。但如果 ENOSPC
            发生在数据文件（表空间）扩展时，InnoDB
            可能会静默失败——表空间文件的一部分写入成功，另一部分没有，导致损坏。
            

### 8.2 键值存储

            

**RocksDB**：RocksDB 提供两种 ENOSPC
            模式。`avoid_flush_during_shutdown=false`
            时，ENOSPC 导致写
            stall（暂停写入，无限等待空间释放）。`true`
            时，ENOSPC 导致写操作返回错误给上层。默认是 stall——这意味着
            RocksDB
            进程会”挂起”而不是报错，在监控上表现为延迟无限大。
            

### 8.3 消息队列

            

**Kafka**：Kafka
            的日志段写满磁盘时，默认行为是等待日志清理（Log
            Cleanup）释放空间。如果 cleanup 速度跟不上写入速度，Kafka 会
            block 所有生产请求，表现为生产者超时。
            
            

## 九、监控与自动化

            

### 9.1 监控维度

            

监控文件系统空间时，最少需要四个维度：
            
```
维度 1：块使用率
  指标：df -h 的 Use%
  告警：根据文件系统类型设置分层阈值（见第六节）

维度 2：inode 使用率
  指标：df -i 的 IUse%
  告警：> 85% 预警，> 95% 紧急

维度 3：Btrfs 元数据使用率（仅 Btrfs）
  指标：btrfs filesystem usage 中的 Metadata Used%
  告警：> 90% 紧急

维度 4：ZFS 池使用率（仅 ZFS）
  指标：zpool list 的 CAP%
  告警：> 80% 预警，> 90% 紧急
```

            

### 9.2 自动化清理策略

            
```
#!/bin/bash
# 简单的自动清理脚本框架
# 在空间超过阈值时安全删除过期文件
# 部署前需要根据业务场景调整路径和保留天数

MOUNT="/mnt/data"
THRESHOLD_WARN=70
THRESHOLD_CRIT=85    # 触发自动清理

USAGE=$(df -h "$MOUNT" | awk 'NR==2 {print $5}' | sed 's/%//')

if [ "$USAGE" -ge "$THRESHOLD_CRIT" ]; then
    echo "[$(date)] 空间使用率 ${USAGE}%，超过临界值 ${THRESHOLD_CRIT}%，启动自动清理"

    # 1. 清理 7 天前的临时文件
    find /mnt/data/tmp -type f -mtime +7 -delete 2>/dev/null

    # 2. 清理 30 天前的日志（保留最近 30 天）
    find /mnt/data/logs -name "*.log" -mtime +30 -delete 2>/dev/null

    # 3. 如果是 Btrfs，尝试回收未使用 chunk
    if [ "$(stat -f --format=%T "$MOUNT" 2>/dev/null)" = "btrfs" ]; then
        btrfs balance start -dusage=5 -musage=5 "$MOUNT" &
    fi

    # 4. 发送告警
    echo "[$(date)] 自动清理完成。当前使用率：$(df -h "$MOUNT" | awk 'NR==2 {print $5}')"
fi
```

            

关键设计原则：自动清理只删除明确的临时文件（规定保留期的日志、已知的缓存目录）。永远不要让自动化脚本删除无法确认安全性的文件——误删数据库文件比磁盘满了更难恢复。
            

### 9.3 LVM 自动扩展

            

对于使用 LVM 的场景，可以利用 dmeventd
            的自动扩展机制：
            
```
# 查看当前 LVM 自动扩展配置
lvs -a -o +lv_when_full,thin_pool_autoextend_threshold

# 启用 thin pool 自动扩展
# 在 lvm.conf 中配置：
# thin_pool_autoextend_threshold = 80
# thin_pool_autoextend_percent = 20
# 含义：thin pool 使用率达到 80% 时，自动扩展 20%

# 也可以通过 lvchange 命令设置
lvchange --errorwhenfull y vg/thinpool
```

            

LVM thin pool 耗尽不是一个 ENOSPC
            问题——它是数据丢失问题。当 thin pool 中的空间不足时，thin
            volume 上的写入会触发 pool 的 ENOSPC。如果 pool 配置了
            `--errorwhenfull y`，写入会返回 I/O
            错误；如果没有配置，写入会被阻塞（hang），等待 pool
            空间释放。对于生产环境，`errorwhenfull y` 通常比
            hang 更好——至少上层应用能感知到错误并做降级。
            
            

## 十、总结：从红线到实践

            
```
问题                            应对
────────────────────────────────────────────────────
文件系统 70% 满了怎么办          扩容 / 清理旧数据 / 归档冷数据
inode 用到 90% 了怎么办          确认是否真的需要这么多文件
                                → 是：换个不限制 inode 的文件系统
                                → 否：为什么有这么多文件？
Btrfs metadata 快满了怎么办      启动 balance，检查快照数量
ZFS 池 85% 了怎么办              检查 COW 写放大，规划扩容
ENOSPC 了但 df 显示有空闲        检查 inode，检查 Btrfs metadata
rm 失败怎么办                    truncate + kill 持有 fd 的进程
应用 hang 了不报错               检查是不是 RocksDB/Kafka 在 stall
```

            

存储空间耗尽不是”会不会发生”的问题，而是”什么时候发生”和”发生时你的系统能不能优雅地应对”的问题。监控阈值必须根据实际文件系统类型和工作负载来设定——套用统一
            80% 阈值和祈祷不会出事，这两者之间几乎没有区别。
            
            

## 参考资料

            
            
- Linux 内核源码：`fs/ext4/mballoc.c`（ext4
            多块分配器）、`fs/xfs/libxfs/xfs_alloc.c`（XFS AG
            块分配器）、`fs/btrfs/block-group.c`（Btrfs block
            group 管理）、`fs/ext4/ialloc.c`（ext4 inode
            分配器）。
            
- PostgreSQL
            源码：`src/backend/access/transam/xlog.c`（WAL
            写入和 ENOSPC 处理）。
            
- MySQL/InnoDB
            文档：`innodb_flush_log_at_trx_commit` 与 ENOSPC
            行为。——https://dev.mysql.com/doc/refman/8.0/en/innodb-parameters.html
            
- Btrfs wiki：ENOSPC 故障处理。——https://btrfs.readthedocs.io/en/latest/ENOSPC.html
            
- ZFS on Linux 文档：Pool Performance Considerations。——https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Workload%20Tuning.html
            
- systemd Journal
            文档：`journalctl --vacuum-size`。——https://www.freedesktop.org/software/systemd/man/journalctl.html
            
            
            

**上一篇**: 小文件问题：为什么文件数量比文件大小更致命
            **下一篇**: POSIX
            文件锁：flock、fcntl 与 NFS 锁的工程陷阱
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-27 · storage
                    

### 【存储工程】文件系统选型与基准测试

                    

在生产环境中，文件系统（Filesystem）的选择直接影响存储栈的性能上限、数据安全边界和运维复杂度。本文将从设计目标、元数据性能、数据吞吐、典型业务场景、基准测试方法论等多个维度，对 ext4、XFS、Btrfs（B-tree Filesystem）、ZFS（Zettabyte File System）四种主流文件…
                

                
                    

2026-06-28 · linux / storage
                    

### fsync 失败的真相：当它返回错误，你的数据可能已经没了

                    

fsync() 返回 EIO 后再调一次为什么会成功？为什么这反而是灾难？从 2018 fsyncgate 到 Linux errseq_t，再到本机内核 6.6 上用 dm-error 单块故障注入的实测，讲清 writeback 失败时脏页被标记 clean、数据静默丢失的真相，以及 PostgreSQL 为什么选择 PANIC。
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。
                

                
                    

2025-07-15 · algorithms
                    

### 文件系统的树：从 ext4 extent tree 到 btrfs CoW B-tree

                    

你的 ext4 文件系统上有一个 1TB 的数据库文件。内核如何在 O(log n) 时间内找到文件偏移量 847,293,510,144 对应的物理磁盘块？答案藏在 extent tree 里。本文逐一拆解 ext4、XFS、btrfs、ZFS、F2FS 五种文件系统的树形结构设计。