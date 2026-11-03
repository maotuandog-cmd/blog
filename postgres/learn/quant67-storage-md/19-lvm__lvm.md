# 【存储工程】LVM 逻辑卷管理

来源: https://quant67.com/post/storage/19-lvm/lvm.html
日期: 2025-08-28 |

---

# LVM 逻辑卷管理

            

在传统的磁盘分区方案中，分区大小在创建时即被固定，后续调整代价极高。逻辑卷管理（Logical
            Volume
            Manager，LVM）在物理磁盘与文件系统之间插入一个抽象层，将离散的物理存储资源池化为可灵活分配的逻辑卷，从根本上解决了静态分区带来的容量规划难题。
            

本文基于 Linux 内核（Kernel）6.x 与 LVM2（LVM version
            2）工具集，从架构原理、基础操作、高级特性到生产实战，系统性地讲解
            LVM 的核心知识体系。全文所有命令均在 CentOS Stream 9 /
            Ubuntu 24.04 环境下验证通过。
            
            

## 一、为什么需要逻辑卷管理

            

### 1.1 固定分区的历史包袱

            

在没有 LVM 的年代，系统管理员使用 `fdisk` 或
            `parted` 直接在磁盘上创建主分区（Primary
            Partition）和扩展分区（Extended
            Partition）。这种方案存在以下根本性问题：
            

**容量预估困难**。生产环境中，数据增长速度往往难以准确预测。一个初始规划为
            100 GiB 的 `/var/log`
            分区，可能在业务高峰期一周内被日志填满。传统方案下，扩容意味着：停机、备份数据、删除分区、重建更大分区、恢复数据。整个流程耗时数小时，且伴随数据丢失风险。
            

**磁盘边界限制**。单个分区无法跨越物理磁盘边界。如果服务器有四块
            1 TiB 硬盘，想要创建一个 3 TiB
            的连续存储空间，传统分区方案无法做到——只能在每块磁盘上分别创建分区，再通过上层应用或文件系统自行管理。
            

**分区数量限制**。MBR（Master Boot
            Record）分区表最多支持 4
            个主分区，即使使用扩展分区也存在逻辑分区数量的实际限制。GPT（GUID
            Partition
            Table）虽然放宽了数量限制，但静态分区的本质问题依然存在。
            

**资源利用率低下**。管理员往往为了避免未来扩容的麻烦，在初始规划时预留大量空间。这导致大量磁盘空间被”占位”却未被实际使用，整体利用率通常不到
            50%。
            

### 1.2 真实世界的痛点场景

            

以下是生产环境中频繁出现的典型场景：
            

**场景一：数据库存储空间告急**。MySQL
            的数据目录 `/var/lib/mysql` 所在分区使用率达到
            95%，数据库即将因空间不足而拒绝写入。传统方案需要停库迁移，而业务方要求零停机。
            

**场景二：多租户资源隔离**。一台物理服务器上运行多个容器（Container）实例，每个租户需要独立的存储空间。使用固定分区，每次新增租户都需要重新规划分区表。
            

**场景三：开发测试环境快速克隆**。QA
            团队需要频繁地从生产数据库快照（Snapshot）中克隆测试环境，要求克隆操作在秒级完成，且不影响生产系统性能。
            

**场景四：存储层级迁移**。随着 SSD（Solid
            State Drive）价格下降，运维团队希望将热数据从 HDD（Hard Disk
            Drive）透明地迁移到
            SSD，且整个过程对上层应用完全无感知。
            

### 1.3 LVM 的解决思路

            

LVM
            通过在物理存储和文件系统之间引入一个逻辑抽象层，将上述所有问题统一解决：
            
```
┌─────────────────────────────────────────────────┐
│              文件系统（ext4 / XFS）               │
├─────────────────────────────────────────────────┤
│           逻辑卷（Logical Volume，LV）            │
├─────────────────────────────────────────────────┤
│           卷组（Volume Group，VG）                │
├──────────┬──────────┬──────────┬────────────────┤
│   PV 1   │   PV 2   │   PV 3   │     PV 4      │
├──────────┼──────────┼──────────┼────────────────┤
│ /dev/sda │ /dev/sdb │ /dev/sdc │   /dev/sdd     │
└──────────┴──────────┴──────────┴────────────────┘
```

            

这个抽象层带来的核心能力包括：
            
            
- **动态扩缩容**：逻辑卷可以在线扩展，部分文件系统支持在线缩减。
            
- **跨磁盘聚合**：多块物理磁盘可以聚合为一个逻辑存储池。
            
- **快照支持**：基于写时复制（Copy-on-Write，CoW）的快照机制，秒级创建一致性副本。
            
- **精简配置**：允许逻辑卷的”名义容量”超过实际物理容量，按需分配空间。
            
- **数据迁移**：`pvmove`
            命令可在线将数据从一个物理卷迁移到另一个物理卷。
            
- **缓存加速**：使用 SSD 作为 HDD
            的缓存层，透明地加速 I/O。
            
            
            

## 二、PV/VG/LV 三层架构

            

### 2.1 物理卷（Physical
            Volume，PV）

            

物理卷是 LVM 体系的最底层抽象。任何块设备（Block
            Device）——整块磁盘、单个分区、甚至环回设备（Loopback
            Device）——都可以被初始化为物理卷。
            

初始化过程中，LVM 会在设备起始位置写入 LVM
            标签（Label）和元数据区域（Metadata Area，MDA）。LVM
            标签包含一个唯一标识符 UUID（Universally Unique
            Identifier），用于在多路径（Multipath）或设备名变更的场景下可靠地识别物理卷。
            

物理卷的内部结构如下：
            
```
┌────────┬──────────────┬─────────────────────────────┐
│  LVM   │   元数据区域  │        数据区域              │
│  标签   │   （MDA）    │    （PE 0 | PE 1 | ... ）    │
│ 512 B  │  默认 1 MiB  │     可用存储空间              │
└────────┴──────────────┴─────────────────────────────┘
```

            

元数据区域默认大小为 1
            MiB，存储该物理卷所属卷组的完整配置信息。每个物理卷默认在设备头部保留一个
            MDA
            副本，也可以配置在设备尾部额外保留一个副本以增强可靠性。
            

### 2.2 物理区块（Physical
            Extent，PE）

            

物理卷被划分为大小相等的物理区块。PE 是 LVM
            进行空间分配的最小单位，类似于文件系统中的块（Block），但粒度更粗。
            

PE 的默认大小为 4 MiB，可以在创建卷组时通过
            `-s` 参数指定。PE
            大小的选择需要在管理粒度和元数据开销之间取得平衡：
            
            
            
            
            
            
            
            
            PE 大小
            最大逻辑卷容量
            典型场景
            
            
            
            
            4 MiB
            16 TiB（使用默认 LE 数量限制时）
            通用场景，绝大多数生产环境
            
            
            8 MiB
            32 TiB
            大容量存储池
            
            
            16 MiB
            64 TiB
            超大规模存储
            
            
            32 MiB
            128 TiB
            极端场景
            
            
            
            

需要注意的是，在 LVM2
            中，逻辑卷大小的实际限制取决于内核的设备映射器（Device
            Mapper，DM）子系统，而非 PE
            数量。上表中的限制值主要是理论参考。
            

### 2.3 卷组（Volume
            Group，VG）

            

卷组是 LVM
            的核心资源池。一个或多个物理卷组合成一个卷组，卷组内的所有
            PE 构成一个统一的存储池。逻辑卷从这个存储池中分配空间。
            

卷组的关键属性：
            
            
- **名称**：全局唯一的字符串标识，如
            `vg_data`、`centos_root`。
            
- **UUID**：系统自动生成的 128
            位唯一标识。
            
- **PE 大小**：卷组内所有物理卷使用相同的 PE
            大小，创建后不可更改。
            
- **总 PE 数**：所有物理卷的 PE 数之和。
            
- **空闲 PE 数**：尚未分配给任何逻辑卷的 PE
            数量。
            
            

卷组的元数据描述了该卷组内所有物理卷、逻辑卷及其 PE
            映射关系。这些元数据被冗余存储在卷组内每个物理卷的 MDA
            中，任何一份完整的 MDA
            都包含恢复整个卷组配置所需的全部信息。
            

### 2.4 逻辑卷（Logical
            Volume，LV）

            

逻辑卷是用户直接使用的存储设备。从用户视角看，逻辑卷与传统分区完全一样——可以在其上创建文件系统、挂载、读写。但在底层，逻辑卷的空间由卷组中的
            PE 映射而来。
            

逻辑卷使用逻辑区块（Logical
            Extent，LE）来描述自身的空间。LE 与 PE 一一对应：每个 LE
            映射到某个物理卷上的某个
            PE。这种映射关系由设备映射器在内核中维护，对上层完全透明。
            
```
逻辑卷 lv_data（3 个 LE）:

  LE 0  ──→  /dev/sda: PE 5
  LE 1  ──→  /dev/sdb: PE 12
  LE 2  ──→  /dev/sda: PE 6
```

            

逻辑卷的设备路径有两种表示方式：
            
```
# 方式一：通过 /dev 下的卷组目录
/dev/vg_data/lv_data

# 方式二：通过设备映射器路径
/dev/mapper/vg_data-lv_data
```

            

两者指向同一个设备，在脚本和配置文件中推荐使用
            `/dev/mapper/`
            路径，因为它更加稳定且避免了符号链接带来的歧义。
            

### 2.5 PE/LE 映射的本质

            

PE 到 LE 的映射是 LVM
            灵活性的根本来源。由于这种映射关系完全由元数据描述，因此：
            
            
- 扩展逻辑卷只需要将新的 PE 追加到映射表中。
            
- 缩减逻辑卷只需要从映射表中移除尾部的 PE。
            
- 数据迁移只需要将 LE 重新映射到不同物理卷的 PE 上。
            
- 快照只需要维护一个差异映射表。
            
            

这一切都不需要移动实际的数据块（`pvmove`
            除外，它确实需要复制数据），因此大多数 LVM
            管理操作都能在毫秒级完成。
            
            

## 三、LVM 基础操作

            

### 3.1 环境准备

            

以下示例假设服务器有三块未使用的磁盘
            `/dev/sdb`、`/dev/sdc`、`/dev/sdd`，每块
            100 GiB。首先确认 LVM2 工具集已安装：
            
```
# RHEL / CentOS / Fedora
dnf install -y lvm2

# Debian / Ubuntu
apt install -y lvm2
```

            

确认设备映射器模块已加载：
            
```
lsmod | grep dm_mod
# 如果无输出，手动加载
modprobe dm_mod
```

            

### 3.2 创建物理卷（pvcreate）

            
```
# 将三块磁盘初始化为物理卷
pvcreate /dev/sdb /dev/sdc /dev/sdd
```

            

输出示例：
            
```
  Physical volume "/dev/sdb" successfully created.
  Physical volume "/dev/sdc" successfully created.
  Physical volume "/dev/sdd" successfully created.
```

            

查看物理卷信息：
            
```
# 简洁视图
pvs

# 详细视图
pvdisplay /dev/sdb
```

            

`pvs` 输出示例：
            
```
  PV         VG   Fmt  Attr PSize    PFree
  /dev/sdb        lvm2 ---  100.00g  100.00g
  /dev/sdc        lvm2 ---  100.00g  100.00g
  /dev/sdd        lvm2 ---  100.00g  100.00g
```

            

此时物理卷尚未加入任何卷组，VG 列为空。
            

### 3.3 创建卷组（vgcreate）

            
```
# 创建卷组 vg_data，PE 大小使用默认值 4 MiB
vgcreate vg_data /dev/sdb /dev/sdc

# 如需指定 PE 大小为 16 MiB
# vgcreate -s 16M vg_data /dev/sdb /dev/sdc
```

            

查看卷组信息：
            
```
# 简洁视图
vgs

# 详细视图
vgdisplay vg_data
```

            

`vgdisplay` 输出关键字段：
            
```
  --- Volume group ---
  VG Name               vg_data
  System ID
  Format                lvm2
  VG Access             read/write
  VG Status             resizable
  MAX LV                0
  Cur LV                0
  Open LV               0
  Max PV                0
  Cur PV                2
  Act PV                2
  VG Size               199.99 GiB
  PE Size               4.00 MiB
  Total PE              51198
  Alloc PE / Size       0 / 0
  Free  PE / Size       51198 / 199.99 GiB
  VG UUID               xxxxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxxxx
```

            

### 3.4 创建逻辑卷（lvcreate）

            
```
# 创建一个 50 GiB 的逻辑卷
lvcreate -L 50G -n lv_mysql vg_data

# 也可以用 PE 数量指定大小
# lvcreate -l 12800 -n lv_mysql vg_data

# 使用卷组剩余空间的百分比
# lvcreate -l 100%FREE -n lv_backup vg_data
```

            

常用的大小指定方式：
            
            
            
            参数
            含义
            示例
            
            
            
            
            `-L 50G`
            绝对大小
            创建 50 GiB 的逻辑卷
            
            
            `-l 12800`
            PE 数量
            12800 个 PE（50 GiB，PE=4 MiB）
            
            
            `-l 50%VG`
            卷组百分比
            使用卷组总容量的 50%
            
            
            `-l 100%FREE`
            剩余空间百分比
            使用卷组所有剩余空间
            
            
            `-l 50%PVS`
            指定 PV 的百分比
            使用指定物理卷容量的 50%
            
            
            
            

创建文件系统并挂载：
            
```
# 在逻辑卷上创建 ext4 文件系统
mkfs.ext4 /dev/vg_data/lv_mysql

# 创建挂载点并挂载
mkdir -p /var/lib/mysql
mount /dev/mapper/vg_data-lv_mysql /var/lib/mysql

# 写入 /etc/fstab 实现开机自动挂载
echo '/dev/mapper/vg_data-lv_mysql /var/lib/mysql ext4 defaults 0 2' >> /etc/fstab
```

            

### 3.5 扩展逻辑卷（lvextend）

            

这是 LVM 最常用的操作之一。扩展逻辑卷分为两步：扩展 LV
            本身，然后扩展其上的文件系统。
            
```
# 步骤一：扩展逻辑卷，增加 30 GiB
lvextend -L +30G /dev/vg_data/lv_mysql

# 步骤二：扩展文件系统
# ext4 文件系统
resize2fs /dev/vg_data/lv_mysql

# XFS 文件系统（需要指定挂载点）
# xfs_growfs /var/lib/mysql
```

            

也可以合并为一步操作：
            
```
# -r 参数自动扩展文件系统
lvextend -L +30G -r /dev/vg_data/lv_mysql
```

            

如果卷组空间不足，需要先扩展卷组：
            
```
# 向卷组中添加新的物理卷
vgextend vg_data /dev/sdd

# 确认卷组空间已增加
vgs vg_data

# 然后再扩展逻辑卷
lvextend -L +30G -r /dev/vg_data/lv_mysql
```

            

### 3.6 缩减逻辑卷（lvreduce）

            

缩减操作风险较高，操作顺序必须严格遵守——**先缩减文件系统，再缩减逻辑卷**，否则会导致数据丢失。
            

XFS 文件系统不支持在线缩减，因此以 ext4 为例：
            
```
# 步骤一：卸载文件系统
umount /var/lib/mysql

# 步骤二：检查文件系统完整性
e2fsck -f /dev/vg_data/lv_mysql

# 步骤三：缩减文件系统到 40 GiB
resize2fs /dev/vg_data/lv_mysql 40G

# 步骤四：缩减逻辑卷到 40 GiB
lvreduce -L 40G /dev/vg_data/lv_mysql

# 步骤五：重新挂载
mount /dev/vg_data/lv_mysql /var/lib/mysql
```

            

也可以合并缩减操作：
            
```
# -r 参数自动处理文件系统缩减
lvreduce -L 40G -r /dev/vg_data/lv_mysql
```

            

使用 `-r` 参数时，LVM
            工具会自动执行文件系统检查、缩减文件系统、缩减逻辑卷的完整流程，更加安全。
            

### 3.7 删除 LVM 组件

            

删除操作的顺序与创建顺序相反：
            
```
# 步骤一：卸载文件系统
umount /var/lib/mysql

# 步骤二：删除逻辑卷
lvremove /dev/vg_data/lv_mysql

# 步骤三：删除卷组（如果不再需要）
vgremove vg_data

# 步骤四：擦除物理卷标签
pvremove /dev/sdb /dev/sdc /dev/sdd
```

            

### 3.8 常用查询命令汇总

            
```
# 查看所有物理卷
pvs -a -o +pv_used,pv_pe_count,pv_pe_alloc_count

# 查看所有卷组
vgs -o +vg_free_count,vg_extent_count

# 查看所有逻辑卷
lvs -a -o +lv_size,seg_count,devices

# 查看特定逻辑卷的段（Segment）映射详情
lvs --segments /dev/vg_data/lv_mysql

# 扫描系统中所有块设备的 LVM 信息
lvscan
vgscan
pvscan
```

            
            

## 四、映射模式

            

逻辑卷的 LE 到 PE 映射并非只有单一方式。LVM
            支持多种映射模式，每种模式在性能、可靠性和空间利用率方面各有侧重。
            

### 4.1 线性映射（Linear）

            

线性映射是 LVM 的默认模式。LE
            按顺序映射到一个或多个物理卷的 PE
            上。如果一个逻辑卷跨越多个物理卷，前面的 LE
            映射到第一个物理卷，后面的 LE
            映射到第二个物理卷，以此类推。
            
```
逻辑卷 lv_data（线性映射）:

  LE 0 ──→ /dev/sdb: PE 0
  LE 1 ──→ /dev/sdb: PE 1
  LE 2 ──→ /dev/sdb: PE 2
  LE 3 ──→ /dev/sdc: PE 0    ← 跨越物理卷边界
  LE 4 ──→ /dev/sdc: PE 1
```

            

线性映射的创建无需额外参数：
            
```
# 默认即为线性映射
lvcreate -L 150G -n lv_linear vg_data
```

            

**优点**：实现简单，空间利用率
            100%，单盘故障只影响该盘上的数据段。
            

**缺点**：无性能提升，无冗余保护。
            

### 4.2 条带映射（Striped）

            

条带映射（Striping）将数据交替分布在多个物理卷上，类似于
            RAID 0（Redundant Array of Independent Disks level
            0）。连续的 LE 被轮流分配到不同的物理卷。
            
```
逻辑卷 lv_stripe（2 路条带）:

  LE 0 ──→ /dev/sdb: PE 0
  LE 1 ──→ /dev/sdc: PE 0
  LE 2 ──→ /dev/sdb: PE 1
  LE 3 ──→ /dev/sdc: PE 1
  LE 4 ──→ /dev/sdb: PE 2
  LE 5 ──→ /dev/sdc: PE 2
```

            

创建条带逻辑卷：
            
```
# -i 指定条带数量，-I 指定条带单元大小
lvcreate -L 100G -n lv_stripe -i 2 -I 64K vg_data
```

            

参数说明：
            
            
            
            参数
            含义
            推荐值
            
            
            
            
            `-i`
            条带数量（使用的物理卷数）
            通常等于可用 PV 数
            
            
            `-I`
            条带单元大小（Stripe Unit Size）
            64K 或 256K
            
            
            
            

**优点**：通过并行 I/O
            提升顺序读写吞吐量，理论上 N 路条带可获得 N 倍带宽。
            

**缺点**：任一物理卷故障会导致整个逻辑卷不可用；空间利用率
            100% 但无冗余。
            

### 4.3 镜像映射（Mirrored）

            

镜像映射将数据同时写入多个物理卷，类似于 RAID 1。每个 LE
            被映射到两个（或更多）物理卷的 PE 上。
            
```
逻辑卷 lv_mirror（双副本镜像）:

  LE 0 ──→ /dev/sdb: PE 0  +  /dev/sdc: PE 0
  LE 1 ──→ /dev/sdb: PE 1  +  /dev/sdc: PE 1
  LE 2 ──→ /dev/sdb: PE 2  +  /dev/sdc: PE 2
```

            

创建镜像逻辑卷：
            
```
# -m 指定镜像副本数（不含原始数据），1 表示一个额外副本（双副本）
lvcreate -L 50G -m 1 -n lv_mirror vg_data

# 指定镜像日志类型
# --mirrorlog core   日志存储在内存中（重启后需要完整重同步）
# --mirrorlog disk   日志存储在磁盘上（默认，推荐）
# --mirrorlog mirrored 日志本身也做镜像
```

            

LVM 的镜像实现（`mirror` 段类型）已经被更新的
            `raid1` 段类型取代。推荐使用 RAID 类型：
            
```
# 使用 RAID 1 段类型（推荐）
lvcreate --type raid1 -L 50G -m 1 -n lv_raid1 vg_data
```

            

**优点**：数据冗余，单盘故障不丢数据，读性能可翻倍。
            

**缺点**：写性能受限于最慢的镜像盘，空间利用率仅
            50%（双副本）。
            

### 4.4 RAID 类型扩展

            

LVM 集成了 MD RAID（Multiple Devices
            RAID）的核心功能，支持以下 RAID 级别：
            
```
# RAID 0（条带）
lvcreate --type raid0 -L 100G -i 3 -n lv_r0 vg_data

# RAID 1（镜像）
lvcreate --type raid1 -L 50G -m 1 -n lv_r1 vg_data

# RAID 5（单校验条带）
lvcreate --type raid5 -L 100G -i 3 -n lv_r5 vg_data

# RAID 6（双校验条带）
lvcreate --type raid6 -L 100G -i 4 -n lv_r6 vg_data

# RAID 10（镜像+条带）
lvcreate --type raid10 -L 100G -i 2 -m 1 -n lv_r10 vg_data
```

            

### 4.5 映射模式选型建议

            
            
            
            场景
            推荐模式
            理由
            
            
            
            
            通用数据存储
            线性
            简单可靠，无额外开销
            
            
            高吞吐顺序 I/O（视频流、日志）
            条带
            并行 I/O 提升带宽
            
            
            关键数据（数据库）
            RAID 1 或 RAID 10
            冗余保护 + 读性能
            
            
            大容量归档
            RAID 5 / RAID 6
            冗余保护 + 空间利用率
            
            
            临时数据（缓存、临时表）
            线性或条带
            无需冗余，追求性能
            
            
            
            
            

## 五、精简配置（Thin
            Provisioning）

            

### 5.1 传统卷的空间浪费问题

            

在传统（厚配置）模式下，创建一个 100 GiB
            的逻辑卷会立即从卷组中分配 100 GiB 的
            PE。即使这个逻辑卷上实际只存储了 1 GiB 的数据，剩余的 99 GiB
            也已被占用，无法分配给其他逻辑卷。
            

这在以下场景中造成严重的空间浪费：
            
            
- 多租户环境：为每个租户创建 100 GiB
            的卷，但大多数租户实际使用不到 10 GiB。
            
- 开发测试环境：需要大量逻辑卷但每个卷的实际使用量很小。
            
- 虚拟化平台：为每台虚拟机（Virtual
            Machine，VM）分配大容量虚拟磁盘。
            
            

### 5.2 精简池（Thin
            Pool）与精简卷（Thin LV）

            

精简配置引入了两个新概念：
            

**精简池（Thin
            Pool）**：一个特殊类型的逻辑卷，作为存储空间的实际提供者。精简池内部维护了一套空间分配表，跟踪每个数据块的分配状态。
            

**精简卷（Thin
            LV）**：从精简池中分配的逻辑卷。精简卷有一个”虚拟大小”（Virtual
            Size），但只有在实际写入数据时才会从精简池中分配空间。
            
```
┌──────────────────────────────────────────────┐
│           精简池 thin_pool（100 GiB）          │
│  ┌────────────┬────────────┬────────────┐    │
│  │ thin_lv_1  │ thin_lv_2  │ thin_lv_3  │    │
│  │ 虚拟 200G  │ 虚拟 200G  │ 虚拟 200G  │    │
│  │ 实际  10G  │ 实际  5G   │ 实际  2G   │    │
│  └────────────┴────────────┴────────────┘    │
│               实际使用：17 GiB                │
│               剩余空间：83 GiB                │
└──────────────────────────────────────────────┘
```

            

### 5.3 创建精简池和精简卷

            
```
# 步骤一：创建精简池
# -L 指定精简池的实际大小
# --thinpool 指定精简池的名称
lvcreate -L 100G --thinpool thin_pool vg_data

# 步骤二：在精简池中创建精简卷
# -V 指定虚拟大小（可以超过精简池的实际大小）
lvcreate -V 200G --thin -n thin_lv_web vg_data/thin_pool
lvcreate -V 200G --thin -n thin_lv_db vg_data/thin_pool
lvcreate -V 200G --thin -n thin_lv_log vg_data/thin_pool
```

            

此时三个精简卷的虚拟大小之和为 600
            GiB，远超精简池的实际容量 100
            GiB。这就是”超额配置”（Over-provisioning）——其可行性建立在以下假设之上：不是所有卷都会同时填满。
            

### 5.4 精简池的元数据卷

            

精简池实际上由两个子卷组成：数据卷（存储实际数据）和元数据卷（存储空间分配表）。默认情况下，LVM
            会自动创建元数据卷，大小约为数据卷的 1/1000，但不小于 2
            MiB，不大于 16 GiB。
            
```
# 查看精简池的子卷
lvs -a vg_data | grep thin_pool
```

            

输出示例：
            
```
  thin_pool          vg_data twi-a-t--- 100.00g
  [thin_pool_tdata]  vg_data Twi-ao---- 100.00g
  [thin_pool_tmeta]  vg_data ewi-ao----   1.00g
```

            

方括号中的 `_tdata` 和 `_tmeta`
            分别是数据子卷和元数据子卷。
            

### 5.5 超额配置的风险与监控

            

超额配置带来灵活性的同时，也引入了空间耗尽的风险。如果精简池的实际空间被完全用尽，新的写入操作将会失败，可能导致文件系统损坏。
            

因此，必须建立完善的空间监控机制：
            
```
# 查看精简池使用率
lvs -o +lv_metadata_size,data_percent,metadata_percent vg_data/thin_pool
```

            

配置自动扩展精简池：
            
```
# 编辑 /etc/lvm/lvm.conf
# 在 activation 段中配置自动扩展
cat >> /etc/lvm/lvm.conf 
            

上述配置表示：当精简池使用率达到 80% 时，自动扩展
            20%。前提是卷组中有足够的剩余空间。
            

使用 `dmeventd`（Device Mapper Event
            Daemon）守护进程来监控精简池状态：
            
```
# 确认 dmeventd 正在运行
systemctl status dm-event.service

# 如未运行，启动并设为开机自启
systemctl enable --now dm-event.service
```

            

### 5.6 精简配置的性能考量

            

精简配置相比传统卷有一定的性能开销：
            
            
- **首次写入开销**：向一个未分配的块写入数据时，精简池需要先分配空间，然后执行写入。这个”分配+写入”的双重操作导致首次写入延迟略高于传统卷。
            
- **元数据更新开销**：每次空间分配都需要更新精简池的元数据，增加了
            I/O 路径的复杂度。
            
- **碎片化**：随着精简卷的创建和删除，精简池的空间分配可能变得碎片化。
            
            

在 I/O
            延迟敏感的场景（如高频交易数据库）中，建议使用传统厚配置卷。在容量弹性更重要的场景（如虚拟化平台、开发环境）中，精简配置是更优选择。
            

### 5.7
            精简卷的丢弃（Discard）支持

            

当文件系统删除文件时，可以通过丢弃（Discard）操作通知精简池释放对应的空间块，使其可以被重新分配：
            
```
# 挂载时启用 discard
mount -o discard /dev/vg_data/thin_lv_web /srv/web

# 或者使用 fstrim 定期批量释放
fstrim -v /srv/web
```

            

推荐使用定期 `fstrim` 而非实时
            `discard`，以避免频繁的 discard 操作对 I/O
            性能的影响：
            
```
# 配置定期 fstrim（通常每周执行一次）
systemctl enable --now fstrim.timer
```

            
            

## 六、LVM 快照

            

### 6.1
            写时复制（Copy-on-Write）原理

            

LVM 快照基于写时复制机制。创建快照时，LVM
            不会复制任何数据，而是创建一个映射表，指向原始卷的当前数据。只有当原始卷上的数据块被修改时，LVM
            才会将该块的原始内容复制到快照的专用空间中，然后在原始卷上执行修改。
            
```
时刻 T0（创建快照）：

  原始卷:  [ A | B | C | D | E ]
  快照:    [ → | → | → | → | → ]  （全部指向原始卷）

时刻 T1（修改块 B 为 B'）：

  原始卷:  [ A | B'| C | D | E ]  ← B 被修改为 B'
  快照:    [ → | B | → | → | → ]  ← 原始 B 被复制到快照空间
```

            

这种设计有两个重要特性：
            
            
- **快照创建是瞬时的**，因为不需要复制任何数据。
            
- **快照空间随修改量增长**，修改的数据块越多，快照占用的空间越大。
            
            

### 6.2 创建和使用快照

            
```
# 为 lv_mysql 创建一个 10 GiB 的快照
lvcreate -L 10G -s -n lv_mysql_snap /dev/vg_data/lv_mysql
```

            

参数说明：
            
            
- `-L 10G`：为快照分配 10 GiB 的 CoW
            空间。
            
- `-s`：指定创建快照（snapshot）类型的逻辑卷。
            
- `-n lv_mysql_snap`：快照的名称。
            
            

快照是一个完整可用的逻辑卷，可以直接挂载和读取：
            
```
# 挂载快照（只读模式）
mkdir -p /mnt/mysql_snap
mount -o ro /dev/vg_data/lv_mysql_snap /mnt/mysql_snap

# 从快照中恢复特定文件
cp /mnt/mysql_snap/ibdata1 /var/lib/mysql/ibdata1.recovered

# 完成后卸载并删除快照
umount /mnt/mysql_snap
lvremove /dev/vg_data/lv_mysql_snap
```

            

### 6.3 快照空间监控

            

快照空间一旦耗尽，快照将变为无效（invalid）。因此必须监控快照的空间使用率：
            
```
# 查看快照使用率
lvs -o +snap_percent /dev/vg_data/lv_mysql_snap
```

            

输出示例：
            
```
  LV             VG      Attr       LSize  Snap%
  lv_mysql_snap  vg_data swi-a-s--- 10.00g 23.45
```

            

`Snap%` 显示快照空间已使用 23.45%。当此值接近
            100% 时，应立即扩展快照空间或删除快照。
            
```
# 扩展快照空间
lvextend -L +10G /dev/vg_data/lv_mysql_snap
```

            

### 6.4 快照合并（Snapshot
            Merge）

            

快照合并操作将快照中的数据回滚到原始卷，等效于将原始卷恢复到快照创建时的状态。这是一个破坏性操作，原始卷上在快照创建后的所有修改都将丢失。
            
```
# 合并快照到原始卷
lvconvert --merge /dev/vg_data/lv_mysql_snap
```

            

如果原始卷正在使用中（已挂载），合并操作将在下次激活原始卷时执行：
            
```
# 卸载原始卷
umount /var/lib/mysql

# 停用再激活逻辑卷以触发合并
lvchange -an /dev/vg_data/lv_mysql
lvchange -ay /dev/vg_data/lv_mysql

# 重新挂载
mount /dev/vg_data/lv_mysql /var/lib/mysql
```

            

合并完成后，快照逻辑卷将被自动删除。
            

### 6.5 基于快照的备份工作流

            

LVM
            快照在备份场景中极具价值，可以实现应用一致性（Application
            Consistent）备份：
            
```
#!/bin/bash
# MySQL 热备份脚本（使用 LVM 快照）

# 步骤一：锁定数据库（获取一致性点）
mysql -u root -p"${MYSQL_PASS}" -e "FLUSH TABLES WITH READ LOCK;"

# 步骤二：创建快照
lvcreate -L 20G -s -n lv_mysql_snap /dev/vg_data/lv_mysql

# 步骤三：解锁数据库（锁定时间通常在秒级）
mysql -u root -p"${MYSQL_PASS}" -e "UNLOCK TABLES;"

# 步骤四：挂载快照并执行备份
mkdir -p /mnt/mysql_snap
mount -o ro /dev/vg_data/lv_mysql_snap /mnt/mysql_snap

# 使用 rsync 将数据备份到远程存储
rsync -avz /mnt/mysql_snap/ backup_server:/backup/mysql/$(date +%Y%m%d)/

# 步骤五：清理
umount /mnt/mysql_snap
lvremove -f /dev/vg_data/lv_mysql_snap

echo "备份完成：$(date)"
```

            

### 6.6 快照的性能影响

            

快照会对原始卷的写入性能产生影响：
            
            
- 每次写入原始卷的已快照块时，需要先读取原始数据、写入快照空间、再写入新数据。这个”读-写-写”的三步操作使得写入延迟增加
            2-3 倍。
            
- 快照数量越多，每次写入需要更新的快照越多，性能下降越明显。
            
- 建议快照仅作为临时工具使用，备份完成后立即删除。
            
            

**精简快照（Thin
            Snapshot）**的性能表现优于传统 CoW
            快照，因为精简快照不需要预分配空间，且不存在快照空间耗尽的问题：
            
```
# 为精简卷创建精简快照（无需指定大小）
lvcreate -s -n thin_snap /dev/vg_data/thin_lv_web
```

            

精简快照之间是对等的——快照和原始卷没有本质区别，它们共享相同的数据块，修改任一方都只影响自身。这使得精简快照非常适合快速克隆虚拟机磁盘等场景。
            
            

## 七、LVM 缓存

            

### 7.1 存储分层的需求

            

现代数据中心中，SSD 和 HDD
            的价格、性能差异巨大。理想情况下，所有数据都应该存储在 SSD
            上以获得最佳性能，但成本不允许。LVM
            缓存提供了一种折中方案：使用小容量 SSD 作为大容量 HDD
            的缓存层，让热数据（频繁访问的数据）自动迁移到
            SSD，冷数据留在 HDD。
            

### 7.2 dm-cache 模式

            

`dm-cache`
            是内核设备映射器提供的块级缓存框架。它将数据分为固定大小的缓存块（Cache
            Block），使用策略算法（如 SMQ——Stochastic
            Multi-Queue）决定哪些块应该被缓存。
            

`dm-cache` 支持三种缓存模式：
            
            
            
            
            
            
            
            
            
            模式
            说明
            数据安全性
            性能
            
            
            
            
            writethrough
            写入同时到达 SSD 和 HDD
            高（SSD 故障不丢数据）
            写入无加速
            
            
            writeback
            写入只到 SSD，异步回刷到 HDD
            中（SSD 故障可能丢数据）
            读写均加速
            
            
            passthrough
            不缓存新数据，只服务已缓存的命中
            高
            仅读加速
            
            
            
            

创建 `dm-cache` 类型的 LVM 缓存：
            
```
# 假设 /dev/sde 是 SSD，已加入卷组 vg_data
pvcreate /dev/sde
vgextend vg_data /dev/sde

# 在 SSD 上创建缓存数据卷和缓存元数据卷
lvcreate -L 50G -n cache_data vg_data /dev/sde
lvcreate -L 512M -n cache_meta vg_data /dev/sde

# 将缓存卷组合为缓存池
lvconvert --type cache-pool \
    --poolmetadata vg_data/cache_meta \
    vg_data/cache_data

# 将缓存池附加到现有逻辑卷
lvconvert --type cache \
    --cachepool vg_data/cache_data \
    --cachemode writethrough \
    vg_data/lv_mysql
```

            

查看缓存状态：
            
```
# 查看缓存命中率等统计信息
lvs -o +cache_total_blocks,cache_used_blocks,cache_read_hits,cache_write_hits vg_data/lv_mysql
```

            

也可以使用简化的一步式创建：
            
```
# 直接为现有逻辑卷添加缓存（LVM 自动创建缓存池）
lvconvert --type cache \
    --cachevol vg_data/cache_data \
    --cachemode writeback \
    vg_data/lv_mysql
```

            

### 7.3 dm-writecache 模式

            

`dm-writecache`
            是一种更轻量的写缓存方案，专门优化写入路径。与
            `dm-cache` 不同，`dm-writecache`
            不缓存读请求，只将写入操作缓冲到 SSD，然后异步回刷到
            HDD。
            
```
# 创建 writecache 类型的缓存
lvcreate -L 30G -n wc_data vg_data /dev/sde

lvconvert --type writecache \
    --cachevol vg_data/wc_data \
    vg_data/lv_mysql
```

            

`dm-writecache` 的特点：
            
            
- 实现比 `dm-cache` 更简单，代码路径更短。
            
- 仅加速写入操作，不加速读取。
            
- 适用于写入密集型负载（如日志写入、WAL 预写日志）。
            
- 不支持 writethrough 模式——它始终是 writeback 行为。
            
            

### 7.4 缓存策略调优

            

`dm-cache` 的默认策略是 SMQ（Stochastic
            Multi-Queue），它使用概率数据结构来跟踪块的访问频率，内存开销极低。
            
```
# 查看当前缓存策略
dmsetup status /dev/mapper/vg_data-lv_mysql | awk '{print $4}'

# 调整缓存块大小（默认 512 扇区 = 256 KiB）
# 较大的缓存块适合顺序 I/O，较小的缓存块适合随机 I/O
lvconvert --type cache \
    --cachevol vg_data/cache_data \
    --cachesettings 'block_size=1024' \
    vg_data/lv_mysql
```

            

对于数据库工作负载，推荐以下配置：
            
```
# 数据库优化缓存配置
lvconvert --type cache \
    --cachevol vg_data/cache_data \
    --cachemode writethrough \
    --cachepolicy smq \
    --cachesettings 'migration_threshold=2048' \
    vg_data/lv_mysql
```

            

`migration_threshold`
            控制单次迁移操作中最多处理的扇区数量。增大此值可加速冷热数据交换，但会增加
            I/O 负担。
            

### 7.5 移除缓存

            

移除缓存前，需要确保所有脏数据（Dirty
            Data）已被回刷到后端设备：
            
```
# 方式一：使用 --uncache 选项（推荐）
# 自动回刷脏数据并分离缓存
lvconvert --uncache vg_data/lv_mysql

# 方式二：先切换到 writethrough 模式确保数据安全
lvconvert --cachemode writethrough vg_data/lv_mysql
# 等待脏数据回刷完成
watch -n 1 'lvs -o +cache_dirty_blocks vg_data/lv_mysql'
# 确认 dirty_blocks 为 0 后分离缓存
lvconvert --uncache vg_data/lv_mysql
```

            
            

## 八、在线扩容实战

            

在线扩容是 LVM
            在生产环境中最常用的能力之一。本节以一个完整的端到端场景演示整个流程。
            

### 8.1 场景描述

            

某服务器的 MySQL 数据分区 `/var/lib/mysql`
            使用率已达
            90%，需要在不停机的情况下完成扩容。当前存储拓扑：
            
```
物理卷:
  /dev/sdb  100 GiB  （已属于 vg_data）
  /dev/sdc  100 GiB  （已属于 vg_data）
  /dev/sdd  100 GiB  （尚未加入卷组）

卷组:
  vg_data   200 GiB（已分配 180 GiB，剩余 20 GiB）

逻辑卷:
  lv_mysql  180 GiB（ext4 文件系统，已挂载在 /var/lib/mysql）

目标:
  将 lv_mysql 扩展到 250 GiB
```

            

### 8.2 第一步：扩展物理卷层

            

当前卷组剩余空间仅 20 GiB，不足以满足 70 GiB
            的扩展需求。需要先向卷组添加新的物理卷。
            
```
# 初始化新磁盘为物理卷
pvcreate /dev/sdd

# 验证物理卷创建成功
pvs /dev/sdd
```

            

如果新磁盘已有分区表或文件系统残留，使用 `-f`
            参数强制初始化：
            
```
# 强制初始化（会清除磁盘上的现有签名）
pvcreate -f /dev/sdd

# 或者先手动清除签名
wipefs -a /dev/sdd
pvcreate /dev/sdd
```

            

### 8.3 第二步：扩展卷组

            
```
# 将新物理卷加入卷组
vgextend vg_data /dev/sdd

# 验证卷组空间已增加
vgs vg_data
```

            

预期输出：
            
```
  VG      #PV #LV #SN Attr   VSize   VFree
  vg_data   3   1   0 wz--n- 299.99g 119.99g
```

            

卷组现在有 120 GiB 的可用空间，足够进行扩展。
            

### 8.4 第三步：扩展逻辑卷

            
```
# 扩展逻辑卷到 250 GiB
lvextend -L 250G /dev/vg_data/lv_mysql

# 验证逻辑卷大小
lvs /dev/vg_data/lv_mysql
```

            

此时逻辑卷的块设备大小已经是 250
            GiB，但文件系统仍然认为自己只有 180 GiB。
            

### 8.5 第四步：扩展文件系统

            

文件系统的扩展方式取决于文件系统类型：
            

**ext4 文件系统**：
            
```
# ext4 支持在线扩展（无需卸载）
resize2fs /dev/vg_data/lv_mysql

# 验证文件系统大小
df -h /var/lib/mysql
```

            

`resize2fs`
            不加大小参数时，默认扩展到底层设备的全部可用空间。
            

**XFS 文件系统**：
            
```
# XFS 使用 xfs_growfs，参数为挂载点
xfs_growfs /var/lib/mysql

# 验证
df -h /var/lib/mysql
```

            

XFS 只支持扩展，不支持缩减。
            

### 8.6 一条命令完成扩容

            

实际操作中，推荐使用 `lvextend -r`
            将逻辑卷扩展和文件系统扩展合并为一步：
            
```
# 一步到位：扩展逻辑卷并自动调整文件系统
lvextend -L 250G -r /dev/vg_data/lv_mysql

# 如果需要先扩展卷组
vgextend vg_data /dev/sdd && lvextend -L 250G -r /dev/vg_data/lv_mysql
```

            

### 8.7 扩容验证清单

            

扩容完成后，执行以下验证：
            
```
# 检查物理卷状态
pvs

# 检查卷组状态
vgs vg_data

# 检查逻辑卷状态
lvs /dev/vg_data/lv_mysql

# 检查文件系统大小和使用率
df -h /var/lib/mysql

# 检查文件系统完整性（可选，ext4 支持在线检查）
# e2fsck -fn /dev/vg_data/lv_mysql  # 需要卸载后执行

# 检查 MySQL 是否正常
mysql -u root -e "SELECT 1;"
```

            

### 8.8 云环境中的磁盘扩容

            

在云环境（如 AWS EBS（Elastic Block
            Store）、阿里云云盘）中，还需要在操作系统层面识别底层磁盘的容量变化：
            
```
# AWS EBS 在线扩容后，刷新分区表
# 如果 PV 是整块磁盘
pvresize /dev/xvdf

# 如果 PV 是分区，需要先扩展分区
growpart /dev/xvdf 1
pvresize /dev/xvdf1

# 之后按正常流程扩展 LV 和文件系统
lvextend -L +50G -r /dev/vg_data/lv_mysql
```

            
            

## 九、LVM 与高可用

            

### 9.1 LVM on RAID

            

在生产环境中，LVM 通常部署在 RAID
            阵列（Array）之上，以获得磁盘级别的冗余保护。常见的部署架构：
            
```
方案一：硬件 RAID + LVM

  ┌─────────────────────────┐
  │       文件系统            │
  ├─────────────────────────┤
  │     逻辑卷（LV）         │
  ├─────────────────────────┤
  │     卷组（VG）           │
  ├─────────────────────────┤
  │   物理卷 /dev/sda       │
  ├─────────────────────────┤
  │   硬件 RAID 控制器       │
  │   RAID 10 阵列          │
  ├──────┬──────┬──────┬────┤
  │ 磁盘1 │ 磁盘2 │ 磁盘3 │磁盘4│
  └──────┴──────┴──────┴────┘
```

            
```
方案二：软件 RAID（mdadm） + LVM

  ┌─────────────────────────┐
  │       文件系统            │
  ├─────────────────────────┤
  │     逻辑卷（LV）         │
  ├─────────────────────────┤
  │     卷组（VG）           │
  ├─────────────────────────┤
  │   物理卷 /dev/md0       │
  ├─────────────────────────┤
  │   mdadm RAID 10         │
  ├──────┬──────┬──────┬────┤
  │sdb   │sdc   │sdd   │sde │
  └──────┴──────┴──────┴────┘
```

            
```
方案三：LVM 内置 RAID

  ┌─────────────────────────┐
  │       文件系统            │
  ├─────────────────────────┤
  │   LV（type=raid10）     │
  ├─────────────────────────┤
  │     卷组（VG）           │
  ├──────┬──────┬──────┬────┤
  │PV sdb│PV sdc│PV sdd│PV sde│
  └──────┴──────┴──────┴────┘
```

            

三种方案的对比：
            
            
            
            特性
            硬件 RAID + LVM
            mdadm + LVM
            LVM RAID
            
            
            
            
            性能
            最高（硬件加速）
            高
            高
            
            
            灵活性
            低（受控制器限制）
            高
            最高
            
            
            管理复杂度
            中
            较高（两套工具）
            低（统一工具链）
            
            
            在线扩展
            受限
            支持
            支持
            
            
            BBU（Battery Backup Unit）
            需要
            不需要
            不需要
            
            
            
            

### 9.2 共享卷组与集群 LVM

            

在高可用集群环境中，多个节点（Node）可能需要访问同一个卷组。传统
            LVM
            假设卷组由单个主机独占访问，多节点并发访问会导致元数据损坏。
            

共享逻辑卷管理器（Shared
            LVM）通过分布式锁管理器（Distributed Lock
            Manager，DLM）协调多节点对卷组元数据的访问：
            
```
# 在集群的每个节点上安装必要的软件包
dnf install -y lvm2-lockd sanlock dlm

# 配置 lvm.conf 启用锁定
# 在 /etc/lvm/lvm.conf 中设置
# use_lvmlockd = 1
# locking_type = 1

# 启动锁定守护进程
systemctl enable --now lvmlockd
systemctl enable --now sanlock
```

            

创建共享卷组：
            
```
# 在一个节点上创建共享卷组
vgcreate --shared vg_shared /dev/sdb

# 在其他节点上启动对该卷组的锁定
vgchange --lock-start vg_shared
```

            

共享卷组中的逻辑卷可以使用集群文件系统（如 GFS2——Global
            File System 2 或 OCFS2——Oracle Cluster File System
            2）挂载，实现多节点同时读写。
            

### 9.3 pvmove 在线数据迁移

            

`pvmove`
            命令可以在不停机的情况下将数据从一个物理卷迁移到另一个物理卷。典型应用场景包括：
            
            
- 替换故障磁盘前的数据疏散。
            
- 将数据从旧磁盘迁移到新磁盘。
            
- 调整数据在物理卷间的分布。
            
            
```
# 将 /dev/sdb 上的所有数据迁移到 /dev/sdd
pvmove /dev/sdb /dev/sdd
```

            

`pvmove` 的工作原理：
            
            
- 在目标物理卷上分配新的 PE。
            
- 创建一个临时的镜像段，将源 PE 和目标 PE 配对。
            
- 同步数据：将源 PE 的数据复制到目标 PE。
            
- 更新逻辑卷的映射表，将 LE 指向新的 PE。
            
- 释放源 PE。
            
            

整个过程中，逻辑卷始终可用，上层 I/O 不中断。
            
```
# 仅迁移特定逻辑卷的数据
pvmove -n lv_mysql /dev/sdb /dev/sdd

# 限制迁移速率以减少对生产 I/O 的影响
pvmove --throttle 100 /dev/sdb /dev/sdd

# 在后台执行迁移
pvmove -b /dev/sdb /dev/sdd

# 查看迁移进度
pvmove --status
```

            

迁移完成后，可以安全地将源物理卷从卷组中移除：
            
```
# 确认源物理卷上没有剩余数据
pvs /dev/sdb

# 从卷组中移除物理卷
vgreduce vg_data /dev/sdb

# 清除物理卷标签
pvremove /dev/sdb
```

            

### 9.4 VG 的导入与导出

            

当需要将磁盘从一台服务器迁移到另一台服务器时，使用卷组的导出（Export）和导入（Import）机制：
            
```
# 在源服务器上：停用并导出卷组
vgchange -an vg_portable
vgexport vg_portable

# 物理迁移磁盘到目标服务器

# 在目标服务器上：扫描并导入卷组
pvscan
vgimport vg_portable
vgchange -ay vg_portable

# 挂载逻辑卷
mount /dev/vg_portable/lv_data /mnt/data
```

            
            

## 十、故障恢复与监控

            

### 10.1 vgcfgbackup 与
            vgcfgrestore

            

LVM 自动在每次元数据变更时将卷组配置备份到
            `/etc/lvm/backup/` 目录，并在
            `/etc/lvm/archive/` 目录中保留历史版本。
            
```
# 手动创建卷组配置备份
vgcfgbackup vg_data

# 查看当前备份
cat /etc/lvm/backup/vg_data

# 查看历史归档
ls -lt /etc/lvm/archive/vg_data_*.vg
```

            

备份文件是纯文本格式，包含卷组的完整元数据描述：物理卷列表、逻辑卷定义、PE
            映射关系等。
            

恢复卷组配置：
            
```
# 从备份恢复卷组配置
vgcfgrestore -f /etc/lvm/backup/vg_data vg_data

# 从历史归档恢复到特定时间点
vgcfgrestore -f /etc/lvm/archive/vg_data_00042-1234567890.vg vg_data
```

            

### 10.2 丢失物理卷的恢复

            

当一个物理卷因磁盘故障而丢失时，卷组将进入部分（Partial）状态。LVM
            的行为取决于丢失的物理卷上是否有活跃的逻辑卷数据。
            

**情况一：丢失的 PV 上没有 LV 数据**
            
```
# 强制移除丢失的物理卷
vgreduce --removemissing vg_data
```

            

**情况二：丢失的 PV 上有 LV 数据**
            
```
# 查看受影响的逻辑卷
lvs -a -o +devices vg_data

# 如果受影响的逻辑卷使用了 RAID 1 或 RAID 5/6，数据可以从冗余副本恢复
# 替换故障磁盘后，添加新的物理卷
pvcreate /dev/sde
vgextend vg_data /dev/sde

# 修复 RAID 逻辑卷
lvconvert --repair vg_data/lv_raid1

# 如果逻辑卷没有冗余（线性或条带），数据已丢失
# 只能从备份恢复数据
vgreduce --removemissing --force vg_data
```

            

### 10.3 元数据损坏修复

            

当 LVM
            元数据损坏时（通常由磁盘坏扇区引起），可以使用以下工具修复：
            
```
# 检查卷组元数据的一致性
vgck vg_data

# 如果检查报告错误，尝试从其他物理卷的 MDA 恢复
# 每个物理卷都保存了卷组的完整元数据副本
pvscan --cache

# 使用归档文件恢复
vgcfgrestore -f /etc/lvm/archive/vg_data_00042-1234567890.vg vg_data

# 强制重写所有物理卷的元数据
vgcfgrestore --force -f /etc/lvm/backup/vg_data vg_data
```

            

### 10.4 使用 lvs/pvs/vgs
            进行日常监控

            

构建一套完整的 LVM 监控体系，需要关注以下关键指标：
            
```
# 物理卷级别监控：关注使用率和错误状态
pvs -o pv_name,pv_size,pv_free,pv_used,pv_pe_count,pv_pe_alloc_count,pv_missing

# 卷组级别监控：关注总容量和剩余空间
vgs -o vg_name,vg_size,vg_free,vg_extent_count,vg_free_count,lv_count,pv_count

# 逻辑卷级别监控：关注类型、大小和状态
lvs -o lv_name,vg_name,lv_size,lv_attr,data_percent,metadata_percent,snap_percent
```

            

### 10.5 自动化监控脚本

            

以下脚本可集成到监控系统（如 Prometheus（普罗米修斯）+
            Grafana、Zabbix、Nagios）中：
            
```
#!/bin/bash
# LVM 空间监控脚本
# 当卷组或精简池使用率超过阈值时发送告警

VG_THRESHOLD=85
THIN_THRESHOLD=80
SNAP_THRESHOLD=70

# 检查卷组使用率
vgs --noheadings --nosuffix --units g \
    -o vg_name,vg_size,vg_free 2>/dev/null | \
while read -r vg_name vg_size vg_free; do
    usage=$(echo "scale=0; (1 - $vg_free / $vg_size) * 100" | bc)
    if [ "$usage" -gt "$VG_THRESHOLD" ]; then
        echo "WARNING: 卷组 ${vg_name} 使用率 ${usage}%，超过阈值 ${VG_THRESHOLD}%"
    fi
done

# 检查精简池使用率
lvs --noheadings -S 'lv_attr=~[t]' \
    -o lv_name,vg_name,data_percent 2>/dev/null | \
while read -r lv_name vg_name data_pct; do
    if [ "$(echo "$data_pct > $THIN_THRESHOLD" | bc)" -eq 1 ]; then
        echo "CRITICAL: 精简池 ${vg_name}/${lv_name} 数据使用率 ${data_pct}%"
    fi
done

# 检查快照使用率
lvs --noheadings -S 'lv_attr=~[s]' \
    -o lv_name,vg_name,snap_percent 2>/dev/null | \
while read -r lv_name vg_name snap_pct; do
    if [ "$(echo "$snap_pct > $SNAP_THRESHOLD" | bc)" -eq 1 ]; then
        echo "CRITICAL: 快照 ${vg_name}/${lv_name} 使用率 ${snap_pct}%"
    fi
done
```

            

### 10.6 LVM 日志与调试

            

当 LVM
            操作出现异常时，可以通过增加日志级别来排查问题：
            
```
# 使用 -vvvv 增加 LVM 命令的输出详细程度
lvs -vvvv 2>&1 | head -100

# 查看 LVM 相关的系统日志
journalctl -u lvm2-monitor -u dm-event --since "1 hour ago"

# 检查设备映射器状态
dmsetup info
dmsetup table
dmsetup status

# 查看内核设备映射器的日志
dmesg | grep -i "device-mapper\|dm-"
```

            

### 10.7 最佳实践清单

            

生产环境中 LVM 的运维最佳实践：
            
            
- 

**定期备份元数据**。虽然 LVM
            自动维护备份和归档，仍建议将 `/etc/lvm/backup/`
            和 `/etc/lvm/archive/`
            目录纳入系统备份策略。
            
- 

**监控精简池使用率**。精简池空间耗尽是灾难性事件，必须配置自动扩展和告警。
            
- 

**避免长期保留快照**。快照会持续消耗空间并降低原始卷的写入性能，完成备份后应立即删除。
            
- 

**使用 RAID 保护数据**。LVM
            自身不提供数据冗余（除非使用 LVM RAID），应在底层部署
            RAID。
            
- 

**预留卷组空间**。卷组中应始终保留
            10-20% 的剩余空间，用于紧急扩容和快照创建。
            
- 

**使用 `/dev/mapper/`
            路径**。在 `/etc/fstab` 和应用配置中使用
            `/dev/mapper/vg-lv` 路径，避免使用
            `/dev/vg/lv` 符号链接。
            
- 

**测试恢复流程**。定期在测试环境中演练从元数据备份恢复卷组的完整流程。
            
- 

**记录存储拓扑**。维护一份文档，记录每个物理卷、卷组、逻辑卷的用途和容量规划。
            
            
            

## 参考文献

            
            
- 

Red Hat Enterprise Linux 9: Configuring and Managing
            Logical Volumes. https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_logical_volumes/
            
- 

LVM2 Resource Page — sourceware.org. https://sourceware.org/lvm2/
            
- 

Linux Kernel Documentation: Device Mapper. https://www.kernel.org/doc/html/latest/admin-guide/device-mapper/
            
- 

`lvmthin(7)` — Linux man page: LVM thin
            provisioning. https://man7.org/linux/man-pages/man7/lvmthin.7.html
            
- 

`lvmcache(7)` — Linux man page: LVM
            caching. https://man7.org/linux/man-pages/man7/lvmcache.7.html
            
- 

`lvmsnapshot(7)` — Linux man page: LVM
            snapshot. https://man7.org/linux/man-pages/man7/lvmsnapshot.7.html
            
- 

`lvmraid(7)` — Linux man page: LVM RAID.
            https://man7.org/linux/man-pages/man7/lvmraid.7.html
            
- 

Red Hat Enterprise Linux 9: Deduplicating and
            Compressing Logical Volumes on RHEL. https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/deduplicating_and_compressing_logical_volumes_on_rhel/
            
- 

SUSE Linux Enterprise Server 15: Logical Volume
            Manager (LVM). https://documentation.suse.com/sles/15-SP5/html/SLES-all/cha-lvm.html
            
- 

Arch Linux Wiki: LVM. https://wiki.archlinux.org/title/LVM
            
            
            

**上一篇**: 文件系统选型与基准测试
            **下一篇**: [RAID
            原理与实践](../20-raid/raid.html)
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-01 · storage
                    

### 【存储工程】存储快照与精简配置

                    

存储系统有两个看似独立、实则紧密交织的能力：快照（Snapshot）和精简配置（Thin Provisioning）。快照解决的是"时间维度"的问题——在任意时刻冻结数据状态，用于备份、回滚或测试；精简配置解决的是"空间维度"的问题——让存储容量按需分配，避免预先占满物理磁盘。两者的交叉点在于写时复制（Copy-on-…
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Iceberg 元数据树

                    

拆解 Iceberg 的四层元数据：catalog 指针 → metadata.json → manifest list（snapshot）→ manifest file → data file。讲清 snapshot 与 manifest 里的分区数据和列级 stats（lower/upper bound、null/value count）如何让一次查询不 list 目录就收敛到文件集合，并给出表规范 V1/V2/V3 的版本边界。基于 pyiceberg 0.11.1 真实建表逐层 dump。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】时间旅行、Schema 与分区演进

                    

讲清 Iceberg 的 snapshot 过期、回滚与按时间/快照读如何工作；schema evolution 为何按 field ID 而非位置来增删改名重排；以及演进对老数据文件与老 reader 的兼容边界与陷阱，附 PyIceberg 真实实验验证字段映射与时间旅行。
                

                
                    

2025-08-25 · storage
                    

### 【存储工程】Btrfs：写时复制文件系统

                    

ext4 和 XFS 走的是"就地更新"路线：数据写到哪个块，就直接覆盖那个块。这条路线简单、高效，但有一个根本性的问题——如果写到一半断电，磁盘上的数据处于半新半旧的状态，文件系统就损坏了。日志（Journal）机制可以缓解这个问题，但它本质上是"先写一遍日志，再写一遍数据"，写放大不可避免。