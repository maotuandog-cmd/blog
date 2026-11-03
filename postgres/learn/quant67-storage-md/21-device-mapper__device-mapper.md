# 【存储工程】Device Mapper：Linux 存储虚拟化层

来源: https://quant67.com/post/storage/21-device-mapper/device-mapper.html
日期: 2025-08-30 |

---

LVM 能把多块磁盘拼成一个逻辑卷，LUKS
            能对整块分区做透明加密，Docker 的 devicemapper
            存储驱动能给每个容器分配独立的可写层——这三个看起来毫不相关的功能，底层都依赖同一个内核框架：设备映射器（Device
            Mapper）。
            

Device Mapper 是 Linux
            内核中的块设备虚拟化层。它不直接管理物理磁盘，而是在已有的块设备之上创建虚拟块设备，通过映射表（Mapping
            Table）把虚拟设备上的 I/O
            请求重定向到底层物理设备的对应位置。不同的目标驱动（Target
            Driver）决定了重定向的方式：线性拼接、条带化分布、精简配置、缓存加速、块级加密、完整性校验——每种方式对应一个独立的内核模块。
            

本文从 Device Mapper
            的内核架构讲起，逐一拆解映射表机制和七种核心 target driver
            的设计原理，最后落到 `dmsetup`
            命令行实战和容器存储场景。所有源码引用基于 Linux 6.1
            内核，命令示例在 Ubuntu 22.04（内核 5.15+）上验证。
            
            

**适用范围**：本文讨论的 Device Mapper
            接口在 Linux 2.6.9 之后稳定可用。部分 target driver（如
            dm-thin）在较新内核中有功能增强，文中会标注版本差异。
            
            
            

## 一、Device Mapper
            架构概览

            

### 内核框架定位

            

Device Mapper 在 I/O
            栈中的位置处于文件系统和物理块设备之间。它的输入是上层提交的
            `bio`（Block I/O）结构体，输出是经过重新映射的
            `bio`，交给下层的物理块设备处理。
            
```
用户空间
  └─ 文件系统（ext4 / XFS / Btrfs）
       └─ Page Cache
            └─ 块设备层（Block Layer）
                 └─ Device Mapper              ← 本文聚焦
                      ├─ target driver（dm-linear / dm-thin / dm-crypt ...）
                      └─ 底层物理块设备（/dev/sda、/dev/nvme0n1 ...）
```

            

从内核代码的角度看，Device Mapper
            框架由以下几个部分组成：
            
            
- **dm-core**（`drivers/md/dm.c`、`drivers/md/dm-table.c`）：框架核心，负责创建虚拟块设备、管理映射表、拦截和分发
            `bio`。
            
- **target
            driver**：一组可插拔的内核模块，每个模块实现一种 I/O
            映射逻辑。内核源码树中内置了十余种 target driver，全部位于
            `drivers/md/` 目录下。
            
- **dm-ioctl**（`drivers/md/dm-ioctl.c`）：用户空间接口，通过
            `/dev/mapper/control`
            字符设备与内核通信，`dmsetup` 命令和 LVM
            工具链都走这个接口。
            
            

### 虚拟块设备

            

Device Mapper 创建的每个虚拟块设备在
            `/dev/mapper/` 下可见，也可以通过
            `/dev/dm-N`（N
            为设备编号）访问。虚拟块设备对上层来说和普通块设备没有区别——可以在上面创建文件系统、用作
            swap 分区、或者再套一层 Device Mapper。
            
```
# 查看系统中所有 DM 设备
ls -la /dev/mapper/
```

            

典型输出：
            
```
crw------- 1 root root 10, 236 Aug 30 00:00 control
lrwxrwxrwx 1 root root       7 Aug 30 00:00 vg0-root -> ../dm-0
lrwxrwxrwx 1 root root       7 Aug 30 00:00 vg0-swap -> ../dm-1
```

            

这里 `vg0-root` 和 `vg0-swap` 是
            LVM 创建的逻辑卷，底层就是 Device Mapper
            虚拟块设备。`control` 是 dm-ioctl 接口。
            

### target driver
            的插件化设计

            

Device Mapper 框架本身不做任何 I/O 映射——映射逻辑全部交给
            target driver。每个 target driver 是一个独立的内核模块，通过
            `dm_register_target()` 向框架注册。框架在收到
            `bio` 后，根据映射表中的 target 类型，调用对应
            target driver 的 `map()` 函数完成映射。
            

内核源码树中的主要 target driver：
            
            
            
            
            
            
            
            
            target 名称
            内核模块
            功能
            
            
            
            
            `linear`
            `dm-linear.c`
            线性映射，把虚拟设备的扇区范围映射到底层设备的连续区域
            
            
            `striped`
            `dm-stripe.c`
            条带化，把 I/O
            分布到多个底层设备
            
            
            `thin-pool`
            `dm-thin.c`
            精简配置池，按需分配存储空间
            
            
            `thin`
            `dm-thin.c`
            精简配置卷，从 thin-pool
            中分配
            
            
            `cache`
            `dm-cache-target.c`
            SSD 缓存加速
            
            
            `crypt`
            `dm-crypt.c`
            块级加密
            
            
            `verity`
            `dm-verity-target.c`
            完整性验证
            
            
            `snapshot`
            `dm-snap.c`
            快照
            
            
            `snapshot-origin`
            `dm-snap.c`
            快照源设备
            
            
            `mirror`
            `dm-raid1.c`
            镜像
            
            
            `error`
            `dm-target.c`
            所有 I/O
            返回错误，用于测试
            
            
            `zero`
            `dm-zero.c`
            读返回零，写丢弃，类似
            `/dev/zero`
            
            
            
            

这种插件化设计使得 Device Mapper
            可以灵活组合：一个虚拟块设备的底层可以是另一个虚拟块设备。例如
            LVM 的加密逻辑卷就是 `dm-crypt` 叠在
            `dm-linear` 之上。
            

### DM 设备的生命周期

            

一个 DM 设备的创建和销毁流程：
            
```
1. 用户空间通过 dm-ioctl 发送 DM_DEV_CREATE 命令
2. 内核分配 mapped_device 结构体，注册块设备
3. 用户空间通过 DM_TABLE_LOAD 加载映射表
4. 用户空间通过 DM_DEV_SUSPEND（resume）激活设备
5. 设备就绪，上层可以提交 I/O
6. 需要修改映射表时，先加载新表，再 suspend/resume 切换
7. 用户空间通过 DM_DEV_REMOVE 销毁设备
```

            

整个过程中，映射表的切换是原子的——旧表和新表之间不会丢失
            I/O。这是 LVM 在线扩容（`lvextend`）和
            `pvmove` 在线迁移数据的基础。
            
            

## 二、核心机制

            

### 映射表（Mapping Table）

            

映射表是 Device Mapper
            的核心数据结构。它描述了虚拟块设备上的每个扇区范围如何映射到底层设备。映射表由一组条目组成，每个条目指定：
            
            
- **起始扇区**：虚拟设备上的起始位置（以 512
            字节扇区为单位）。
            
- **长度**：这段映射覆盖的扇区数。
            
- **target 类型**：使用哪个 target
            driver。
            
- **target 参数**：传给 target driver
            的参数，格式由各 target 自定义。
            
            

用 `dmsetup table` 可以查看映射表：
            
```
dmsetup table vg0-root
```

            

输出示例：
            
```
0 41943040 linear 8:2 2048
```

            

这一行的含义：从虚拟设备的第 0 扇区开始，长度为 41943040
            个扇区（约 20 GiB），使用 `linear`
            target，映射到主设备号 8、次设备号 2（即
            `/dev/sda2`）的第 2048 扇区。
            

一个虚拟设备可以有多个映射条目，覆盖不同的扇区范围。条目之间不能重叠，必须连续覆盖整个虚拟设备的地址空间。
            

### 多条目映射表

            

LVM 的 `pvmove`
            在迁移数据的中间状态，会创建包含多种 target
            类型的复合映射表：
            
```
0 1024000 linear 8:2 2048
1024000 2048000 mirror core 1 1024 2 8:2 1026048 8:3 0
3072000 4096000 linear 8:2 4098048
```

            

第一段和第三段已经迁移完成，使用 `linear`
            映射；中间一段正在迁移，使用 `mirror` target
            做实时镜像复制。
            

### bio 重映射（bio
            Remapping）

            

当上层向 DM 虚拟设备提交一个 `bio` 时，Device
            Mapper 框架的处理流程如下：
            
```
submit_bio(bio)
  └─ dm_submit_bio()                    // drivers/md/dm.c
       └─ __split_and_process_bio()
            ├─ 根据 bio 的扇区号在映射表中查找对应条目
            ├─ 如果 bio 跨越多个映射条目，拆分 bio
            └─ 对每个映射条目调用 target->map(ti, bio)
                 ├─ DM_MAPIO_REMAPPED  → bio 已修改，提交到底层设备
                 ├─ DM_MAPIO_SUBMITTED → target 自己处理提交
                 └─ DM_MAPIO_KILL      → I/O 错误
```

            

在内核源码中，`dm_submit_bio()` 是 DM 设备的
            `submit_bio` 回调。它调用
            `__split_and_process_bio()`
            逐条处理映射表条目。核心代码路径：
            
```
/* Linux 6.1, drivers/md/dm.c（删减版，仅保留关键路径） */
static void dm_submit_bio(struct bio *bio)
{
    struct mapped_device *md = bio->bi_bdev->bd_disk->private_data;
    /* ... */
    __split_and_process_bio(md, map, bio);
}

static void __split_and_process_bio(struct mapped_device *md,
                                     struct dm_table *map,
                                     struct bio *bio)
{
    /* 查找 bio 起始扇区对应的映射表条目 */
    struct dm_target *ti = dm_table_find_target(map, bio->bi_iter.bi_sector);

    /* 如果 bio 跨越当前条目的边界，需要拆分 */
    /* ... 拆分逻辑 ... */

    /* 调用 target 的 map 函数 */
    r = ti->type->map(ti, bio);
    switch (r) {
    case DM_MAPIO_REMAPPED:
        submit_bio_noacct(bio);  /* 提交到底层设备 */
        break;
    case DM_MAPIO_SUBMITTED:
        break;  /* target 自己处理了 */
    case DM_MAPIO_KILL:
        bio_io_error(bio);
        break;
    }
}
```

            

对于最简单的 `dm-linear`
            target，`map()` 函数只做一件事：修改
            `bio` 的目标设备和扇区偏移，然后返回
            `DM_MAPIO_REMAPPED`。
            

### target 接口

            

每个 target driver 必须实现
            `struct target_type` 中定义的一组回调函数：
            
```
/* Linux 6.1, include/linux/device-mapper.h（删减版） */
struct target_type {
    const char *name;
    /* 构造和析构 */
    dm_ctr_fn ctr;         /* 解析参数，初始化 target */
    dm_dtr_fn dtr;         /* 释放资源 */
    /* I/O 映射 */
    dm_map_fn map;         /* 重映射单个 bio */
    dm_clone_and_map_request_fn clone_and_map_rq;  /* 请求级映射（可选） */
    /* 状态查询 */
    dm_status_fn status;   /* 返回 target 的当前状态 */
    dm_message_fn message; /* 接收用户空间消息 */
    /* 表操作 */
    dm_iterate_devices_fn iterate_devices;  /* 遍历底层设备 */
};
```

            

关键回调的含义：
            
            
- **`ctr`**（constructor）：在
            `dmsetup create` 或 `DM_TABLE_LOAD`
            时调用，解析映射表中的 target 参数，分配和初始化 target
            的私有数据。
            
- **`dtr`**（destructor）：在映射表卸载或设备销毁时调用，释放资源。
            
- **`map`**：每次 I/O
            路径上都会调用，是性能最关键的函数。对于简单 target（如
            `linear`），`map()`
            里只有几行赋值语句；对于复杂 target（如
            `dm-crypt`），`map()`
            可能涉及加解密操作。
            
- **`status`**：`dmsetup status`
            和 `dmsetup table` 调用这个函数获取 target
            的运行时信息。
            
            

### 挂起与恢复（Suspend /
            Resume）

            

Device Mapper 支持在不中断上层 I/O
            的情况下原子切换映射表。流程：
            
            
- 加载新映射表到设备的 inactive slot。
            
- 发送 suspend 命令，Device Mapper 暂停接收新
            `bio`，等待已提交的 `bio` 完成。
            
- 交换 active table 和 inactive table。
            
- 发送 resume 命令，设备恢复接收 I/O，使用新映射表。
            
            

这个机制保证了映射表切换的原子性。LVM 的
            `lvextend`、`lvreduce`、`pvmove`
            都依赖这个机制。
            
```
# 查看设备的挂起状态
dmsetup info vg0-root | grep 'Suspended'
```

            
            

## 三、dm-linear 与
            dm-striped

            

### dm-linear：线性映射

            

`dm-linear` 是最简单的 target
            driver。它把虚拟设备上的一段连续扇区范围，映射到底层设备上的另一段连续扇区范围。LVM
            的普通逻辑卷（不使用条带化时）底层就是
            `dm-linear`。
            

映射表格式：
            
```
  linear  
```

            

`dm-linear` 的 `map()`
            函数实现极其简单：
            
```
/* Linux 6.1, drivers/md/dm-linear.c（删减版） */
static int linear_map(struct dm_target *ti, struct bio *bio)
{
    struct linear_c *lc = ti->private;

    bio_set_dev(bio, lc->dev->bdev);
    bio->bi_iter.bi_sector = linear_map_sector(ti, bio->bi_iter.bi_sector);

    return DM_MAPIO_REMAPPED;
}

static sector_t linear_map_sector(struct dm_target *ti, sector_t bi_sector)
{
    struct linear_c *lc = ti->private;
    return lc->start + dm_target_offset(ti, bi_sector);
}
```

            

就是两步：设置目标设备，计算目标扇区号。`dm_target_offset()`
            把虚拟设备的绝对扇区号转换为 target 内的相对偏移。
            

### 用 dm-linear
            拼接多块设备

            

假设有两块磁盘 `/dev/sdb`（100 GiB，209715200
            扇区）和 `/dev/sdc`（200 GiB，419430400
            扇区），想把它们拼接成一个 300 GiB 的虚拟设备：
            
```
# 创建拼接设备
echo "0 209715200 linear /dev/sdb 0
209715200 419430400 linear /dev/sdc 0" | dmsetup create concat-disk

# 验证
dmsetup table concat-disk
```

            

输出：
            
```
0 209715200 linear 8:16 0
209715200 419430400 linear 8:32 0
```

            

虚拟设备 `/dev/mapper/concat-disk` 的前 100
            GiB 映射到 `/dev/sdb`，后 200 GiB 映射到
            `/dev/sdc`。文件系统看到的是一个连续的 300 GiB
            块设备。
            

### dm-striped：条带化映射

            

`dm-striped` 把 I/O
            按固定大小的条带（Stripe）轮流分布到多个底层设备上，类似
            RAID 0 的条带化策略。目的是利用多个设备的并行 I/O
            能力提升吞吐量。
            

映射表格式：
            
```
  striped       ...
```

            

条带大小以扇区为单位。例如使用 128 KiB 条带（256
            扇区）跨两块设备：
            
```
# 创建条带化设备（128 KiB 条带，两块设备各 100 GiB）
echo "0 419430400 striped 2 256 /dev/sdb 0 /dev/sdc 0" | dmsetup create stripe-disk
```

            

`dm-striped` 的 `map()` 函数根据
            I/O 的扇区号计算条带索引和设备内偏移：
            
```
/* Linux 6.1, drivers/md/dm-stripe.c（删减版，仅保留关键路径） */
static int stripe_map(struct dm_target *ti, struct bio *bio)
{
    struct stripe_c *sc = ti->private;
    sector_t offset, chunk;
    uint32_t stripe;

    offset = dm_target_offset(ti, bio->bi_iter.bi_sector);
    /* 计算条带索引 */
    chunk = dm_sector_div_up(offset, sc->chunk_size);
    stripe = sector_div(chunk, sc->stripes);  /* stripe = chunk % stripes */

    bio_set_dev(bio, sc->stripe[stripe].dev->bdev);
    bio->bi_iter.bi_sector = sc->stripe[stripe].physical_start +
                             chunk * sc->chunk_size +
                             (offset & (sc->chunk_size - 1));

    return DM_MAPIO_REMAPPED;
}
```

            

核心逻辑：用 I/O
            偏移除以条带大小得到条带编号，再对设备数取模确定目标设备。
            

### dm-linear 与
            dm-striped 的对比

            
            
            
            
            
            
            
            
            维度
            dm-linear
            dm-striped
            
            
            
            
            I/O 分布
            顺序访问只命中一个底层设备
            轮流分布到所有设备
            
            
            吞吐量
            受单设备限制
            随设备数线性增长（理想情况）
            
            
            容错
            无冗余，任一设备故障导致数据丢失
            无冗余，同上
            
            
            适用场景
            简单拼接，LVM 默认模式
            需要高吞吐的顺序工作负载
            
            
            LVM 对应
            `lvcreate -L 100G vg0 -n lv1`
            `lvcreate -i 2 -I 128K -L 100G vg0 -n lv1`
            
            
            
            
            

## 四、dm-thin（精简配置）

            

### 传统分配与精简配置

            

传统的逻辑卷（dm-linear）在创建时就预分配全部空间。创建一个
            100 GiB 的逻辑卷，底层立刻占用 100 GiB
            的物理空间，即使一个字节都没写入。
            

精简配置（Thin
            Provisioning）改变了这种模式：创建逻辑卷时只声明容量，实际的物理空间在数据写入时才按需分配。一个
            100 GiB 的精简卷，如果只写了 10 GiB 数据，底层只占用 10 GiB
            物理空间。
            

这种按需分配使得超额配置（Overprovisioning）成为可能——所有精简卷声明的总容量可以超过物理存储池的实际容量。在虚拟化和云环境中，超额配置是控制存储成本的标准做法。
            

### dm-thin 的架构

            

dm-thin 由两种 target 协作：
            
            
- **thin-pool**：管理物理存储池，负责空间分配和元数据维护。
            
- **thin**：精简卷，从 thin-pool
            中按需获取存储块。
            
            
```
thin 卷 A (100 GiB)    thin 卷 B (200 GiB)    thin 卷 C (50 GiB)
     │                       │                       │
     └──────────┬─────────────┘                       │
                │                                     │
         ┌──────┴──────┐                              │
         │  thin-pool  │──────────────────────────────┘
         │  (150 GiB)  │
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
 数据设备   元数据设备
 (data)    (metadata)
```

            

thin-pool 底层需要两个设备：
            
            
- **数据设备（Data
            Device）**：存放实际用户数据的块设备。
            
- **元数据设备（Metadata
            Device）**：存放空间分配映射关系的块设备。元数据设备使用
            B+
            树组织，记录每个精简卷的每个虚拟块映射到数据设备上的哪个物理块。
            
            

### 按需分配机制

            

当精简卷收到写入请求时，dm-thin 的处理流程：
            
            
- 查询元数据 B+ 树，判断目标虚拟块是否已分配物理块。
            
- 如果已分配，直接将 I/O 重定向到对应的物理块。
            
- 如果未分配，从 thin-pool
            的空闲块池中分配一个新的物理块，更新元数据 B+ 树，然后重定向
            I/O。
            
            

读取未分配区域时，dm-thin 返回全零数据（除非设置了
            `skip_block_zeroing`）。
            

### 创建 thin-pool
            和精简卷

            
```
# 假设 /dev/sdb 用作数据设备，/dev/sdc 用作元数据设备
# 先用 dmsetup 创建 thin-pool
# 数据设备 100 GiB = 209715200 扇区
# 元数据设备大小取决于数据设备大小和块大小，通常几百 MiB 即可
# 块大小 128 扇区 = 64 KiB（最小值），常用 256 扇区 = 128 KiB

dmsetup create pool-data --table "0 209715200 linear /dev/sdb 0"
dmsetup create pool-meta --table "0 2097152 linear /dev/sdc 0"

# 创建 thin-pool
# 格式：  thin-pool    
dmsetup create my-thin-pool --table \
  "0 209715200 thin-pool /dev/mapper/pool-meta /dev/mapper/pool-data 256 1000"

# 创建精简卷（声明 500 GiB，远超池的 100 GiB 物理容量）
# 先发送 create_thin 消息创建 thin 设备 ID
dmsetup message my-thin-pool 0 "create_thin 0"

# 然后创建 DM 设备映射到该 thin 设备
# 格式：  thin 

 
dmsetup create my-thin-vol --table \
  "0 1048576000 thin /dev/mapper/my-thin-pool 0"
```

            

这里 `1048576000` 扇区 = 500 GiB。精简卷声明了
            500 GiB，但 thin-pool 只有 100 GiB
            物理空间——这就是超额配置。
            

### 元数据设备的重要性

            

元数据设备存储所有块映射关系，如果损坏将导致整个
            thin-pool 的数据不可访问。关键注意点：
            
            
- 元数据设备推荐放在高可靠存储上（如镜像的 SSD）。
            
- 内核提供 `thin_check`
            工具验证元数据一致性。
            
- thin-pool 支持元数据快照，用于在线修复。
            
- 元数据设备的大小根据经验公式估算：每 1 TiB 数据约需 4
            MiB 元数据空间（使用 64 KiB 块大小时）。
            
            
```
# 检查元数据一致性
thin_check /dev/mapper/pool-meta

# 查看 thin-pool 状态
dmsetup status my-thin-pool
```

            

`dmsetup status` 输出示例：
            
```
0 209715200 thin-pool 41943 1024/65536 1000/409600 - rw no_discard_passdown queue_if_no_space -
```

            

关键字段：已使用的元数据块数 /
            总元数据块数、已使用的数据块数 / 总数据块数。
            

### 超额配置与空间耗尽

            

超额配置的风险是物理空间耗尽。当 thin-pool
            的数据设备写满后，新的写入请求会被挂起或返回错误，取决于
            `queue_if_no_space` 或
            `error_if_no_space` 策略。
            

生产环境中的应对措施：
            
            
- 监控 thin-pool 使用率，在达到阈值（如 80%）时告警。
            
- 启用自动扩展（LVM 的
            `thin_pool_autoextend_threshold` 和
            `thin_pool_autoextend_percent`）。
            
- 使用 `fstrim` 或 `blkdiscard`
            回收已删除文件占用的物理块。
            
            
```
# 在 LVM 的 lvm.conf 中配置自动扩展
# thin_pool_autoextend_threshold = 70
# thin_pool_autoextend_percent = 20
```

            
            

## 五、dm-cache（SSD
            缓存加速）

            

### 问题背景

            

HDD 的随机 I/O 性能远低于 SSD，但大容量 SSD
            的成本仍然高于 HDD。dm-cache 提供了一种折中方案：用少量 SSD
            作为大容量 HDD 的缓存层，把热数据自动迁移到 SSD
            上，冷数据留在 HDD 上。
            

### 三设备架构

            

dm-cache 需要三个底层设备：
            
            
- **源设备（Origin
            Device）**：大容量慢速存储（通常是
            HDD），存放全量数据。
            
- **缓存设备（Cache
            Device）**：小容量快速存储（通常是
            SSD），存放热数据的副本。
            
- **元数据设备（Metadata
            Device）**：记录哪些数据块在缓存中、脏块状态等信息。
            
            
```
         上层 I/O
             │
      ┌──────┴──────┐
      │   dm-cache   │
      └──┬───┬───┬──┘
         │   │   │
    源设备  缓存设备  元数据设备
    (HDD)   (SSD)    (SSD)
```

            

### 缓存策略

            

dm-cache 支持可插拔的缓存策略（Cache
            Policy），决定哪些数据块应该缓存、哪些应该淘汰。内核内置两种策略：
            

**SMQ（Stochastic
            Multi-Queue）**：默认策略，Linux 4.2 引入。SMQ
            使用多级队列跟踪数据块的访问热度，配合随机采样算法控制内存开销。相比旧的
            MQ 策略，SMQ 的内存占用更低，对扫描（Sequential
            Scan）型工作负载的抗污染能力更强。
            

**MQ（Multi-Queue）**：旧策略，已被 SMQ
            取代，但仍保留在内核中。
            

### 写策略

            

dm-cache 支持两种写策略：
            

**回写（Writeback）**：写入先写到缓存设备（SSD），异步刷回源设备（HDD）。读写性能都能受益于缓存，但缓存设备故障可能导致数据丢失。
            

**直写（Writethrough）**：写入同时写到缓存设备和源设备，只有两边都完成才返回成功。写入性能无提升，但读性能仍然受益，且缓存设备故障不会丢数据。
            
```
# 创建 dm-cache 设备
# 假设：
#   /dev/sdb - 源设备（HDD，1 TiB）
#   /dev/nvme0n1p1 - 缓存设备（SSD，100 GiB）
#   /dev/nvme0n1p2 - 元数据设备（SSD，1 GiB）

# 先初始化缓存元数据
cache_check /dev/nvme0n1p2 || cache_repair /dev/nvme0n1p2

# 创建 dm-cache 设备
# 格式：  cache      [特性...]
dmsetup create cached-hdd --table \
  "0 2147483648 cache /dev/nvme0n1p2 /dev/nvme0n1p1 /dev/sdb 512 1 writeback smq 0"
```

            

块大小 512 扇区 = 256 KiB，这是 dm-cache
            的常用块大小。块越大，元数据越小，但小文件的缓存效率下降。
            

### LVM 中使用 dm-cache

            

LVM 从 2.02.96 版本开始集成 dm-cache
            支持，提供了更友好的管理接口：
            
```
# 创建缓存池
lvcreate -L 100G -n cachepool vg0 /dev/nvme0n1
lvconvert --type cache-pool vg0/cachepool

# 将缓存池附加到现有逻辑卷
lvconvert --type cache --cachepool vg0/cachepool vg0/data

# 查看缓存统计
lvs -o+cache_total_blocks,cache_used_blocks,cache_dirty_blocks,cache_read_hits,cache_write_hits vg0/data
```

            

### dm-cache 状态查询

            
```
dmsetup status cached-hdd
```

            

输出字段含义：
            
```
0 2147483648 cache 8 1024/2048 512 1048576/2097152 4096 512 2048 1024 0 0 1 writeback 2 migration_threshold 2048 smq 0 rw -
```

            

关键指标：元数据使用量、缓存命中率、脏块数、迁移阈值。
            
            

## 六、dm-crypt（块级加密）

            

### 块级加密的定位

            

dm-crypt
            在块设备层实现透明加密。上层文件系统看到的是一个普通的块设备，读写操作和未加密时完全一致；dm-crypt
            在 `map()`
            函数中对写入数据加密、对读取数据解密，加解密过程对上层完全透明。
            

和文件系统级加密（如 fscrypt）相比，dm-crypt 的特点：
            
            
            
            
            
            
            
            
            维度
            dm-crypt（块级）
            fscrypt（文件级）
            
            
            
            
            加密粒度
            整个块设备
            单个文件或目录
            
            
            元数据保护
            加密，包括目录结构和文件大小
            不加密文件名（或部分加密）
            
            
            多用户密钥
            不支持，整个设备一个密钥
            支持，每个目录可用不同密钥
            
            
            性能
            整盘加解密，CPU 开销固定
            只加密选中的文件，灵活
            
            
            典型用途
            全盘加密、LUKS 分区
            Android
            文件加密、用户目录加密
            
            
            
            

### 加密算法与模式

            

dm-crypt 使用内核加密 API（Crypto
            API）提供的算法。最常用的组合是 AES-XTS：
            
            
- **AES**（Advanced Encryption
            Standard）：分组密码，块大小 128 位，密钥长度 128/192/256
            位。
            
- **XTS**（XEX-based Tweaked-codebook mode
            with ciphertext
            Stealing）：专为磁盘加密设计的分组密码模式。XTS 用扇区号作为
            tweak
            值，保证相同明文在不同扇区加密后得到不同密文，防止模式泄露。
            
            
```
加密过程：
  明文扇区 + 扇区号(tweak) + 密钥 → AES-XTS → 密文扇区

解密过程：
  密文扇区 + 扇区号(tweak) + 密钥 → AES-XTS⁻¹ → 明文扇区
```

            

dm-crypt 还支持其他模式，如 AES-CBC-ESSIV（旧式默认）和
            Adiantum（面向低端 ARM 设备）。
            

### dm-crypt 的 I/O 路径

            

写入路径：
            
```
bio (明文)
  └─ crypt_map()
       └─ 分配加密 bio（clone）
            └─ 将明文数据复制到新分配的页面
                 └─ 调用 Crypto API 加密
                      └─ 提交加密后的 bio 到底层设备
```

            

读取路径：
            
```
bio (读请求)
  └─ crypt_map()
       └─ 修改 bio 指向底层设备（不加密）
            └─ 底层设备完成读取，返回密文
                 └─ crypt_endio() 回调
                      └─ 调用 Crypto API 解密
                           └─ 返回明文给上层
```

            

注意：写入时 dm-crypt
            需要分配额外的内存页来存放密文（不能原地加密，因为 Page
            Cache
            中的原始数据不能被修改）。读取时可以原地解密，因为密文页面在解密后不再需要。
            

### dm-crypt 映射表格式

            
```
  crypt     
```

            

直接使用 dmsetup 创建加密设备（实际场景中通常使用
            LUKS）：
            
```
# 生成 256 位随机密钥（十六进制表示，64 个字符）
KEY=$(hexdump -n 32 -e '32/1 "%02x"' /dev/urandom)

# 创建加密设备
echo "0 $(blockdev --getsz /dev/sdb) crypt aes-xts-plain64 $KEY 0 /dev/sdb 0" | \
  dmsetup create encrypted-disk
```

            

### LUKS 集成

            

直接管理 dm-crypt 密钥既不安全也不方便。LUKS（Linux
            Unified Key
            Setup）在分区头部存储加密元数据（密钥槽、盐值、迭代次数等），用口令派生密钥，是
            dm-crypt 的标准用户态管理层。
            
```
# 使用 LUKS 格式化设备
cryptsetup luksFormat /dev/sdb

# 打开 LUKS 设备（底层创建 dm-crypt 映射）
cryptsetup open /dev/sdb encrypted-disk

# 查看底层 DM 映射表
dmsetup table encrypted-disk
```

            

输出示例：
            
```
0 209715200 crypt aes-xts-plain64 :64:logon:cryptsetup:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-d0 0 8:16 32768
```

            

注意密钥字段不是明文，而是内核 keyring
            的引用（`:64:logon:cryptsetup:...`），密钥存储在内核内存中，不会暴露到用户空间。
            

### 性能考量

            

dm-crypt 的性能取决于两个因素：
            
            
- 

**CPU 加解密速度**：现代 x86 CPU 的
            AES-NI 指令集可以达到 2-4 GiB/s 的 AES-XTS
            吞吐量，通常不是瓶颈。ARM 平台上如果没有硬件加速，可以考虑
            Adiantum 算法。
            
- 

**I/O 路径开销**：dm-crypt
            在写入路径上需要分配额外内存页和加密
            bio，增加了内存分配压力。可以通过调整工作队列参数优化：
            
            
```
# 查看 dm-crypt 工作队列配置
cat /sys/module/dm_crypt/parameters/max_write_idle_time_ms
```

            
            

## 七、dm-verity（完整性验证）

            

### 设计目标

            

dm-verity
            为只读块设备提供完整性验证。它在设备上构建一棵哈希树（Hash
            Tree），每次读取数据块时，沿着哈希树从叶节点到根节点验证数据的完整性。如果数据被篡改，读取会返回
            I/O 错误。
            

dm-verity 的主要用途：
            
            
- Android 的 Verified Boot（AVB）：验证 system 分区和
            vendor 分区的完整性。
            
- ChromeOS 的 Verified Boot：验证根文件系统的完整性。
            
- 容器镜像的完整性保护。
            
            

### 哈希树结构

            

dm-verity 使用默尔克树（Merkle
            Tree）。数据设备被分成固定大小的块（通常 4096
            字节），每个数据块计算一个哈希值。这些哈希值再分组计算上一层哈希，逐层汇聚，最终得到一个根哈希（Root
            Hash）。
            
```
              根哈希 (Root Hash)
              ┌────┴────┐
         哈希节点 L2    哈希节点 L2
         ┌──┴──┐       ┌──┴──┐
     哈希 L1  哈希 L1  哈希 L1  哈希 L1
      │        │        │        │
   数据块0  数据块1  数据块2  数据块3
```

            

根哈希在创建时计算并存储在可信位置（如内核命令行、签名的启动镜像中）。验证链从根哈希开始，自顶向下验证每一层，最终确认数据块的完整性。
            

### 哈希树存储

            

哈希树存储在一个单独的设备或同一设备的尾部区域。dm-verity
            创建时需要指定：
            
            
- **数据设备**：包含实际数据的块设备。
            
- **哈希设备**：包含哈希树的块设备（可以和数据设备是同一个设备，哈希存储在数据区域之后）。
            
- **根哈希**：哈希树的根节点值。
            
            

### 创建 dm-verity 设备

            

使用 `veritysetup` 工具（属于 cryptsetup
            软件包）：
            
```
# 第一步：为数据设备生成哈希树
# --hash=sha256 指定哈希算法
# --data-block-size=4096 数据块大小
# --hash-block-size=4096 哈希块大小
veritysetup format /dev/sdb /dev/sdc

# 输出示例：
# Root hash: 4a2e23b48a1bca2f1d7...（根哈希，需要安全保存）
# Salt: 8f3e2a1b...

# 第二步：激活 dm-verity 设备
veritysetup open /dev/sdb verified-disk /dev/sdc \
  4a2e23b48a1bca2f1d7...

# 现在 /dev/mapper/verified-disk 是只读的受保护设备
mount -o ro /dev/mapper/verified-disk /mnt
```

            

### dm-verity 映射表格式

            
```
dmsetup table verified-disk
```

            

输出示例：
            
```
0 2097152 verity 1 8:16 8:32 4096 4096 262144 1 sha256 4a2e23b48a1bca2f1d7... 8f3e2a1b...
```

            

字段含义：版本号、数据设备、哈希设备、数据块大小、哈希块大小、数据块数、哈希偏移、哈希算法、根哈希、盐值。
            

### Android 中的 dm-verity

            

Android 从 4.4 版本开始使用 dm-verity 保护 system
            分区。在 Android Verified Boot（AVB）流程中：
            
            
- Bootloader 验证 boot 分区的签名。
            
- boot 分区中的 init 进程使用预置的根哈希激活
            dm-verity。
            
- system 分区的每次读取都经过哈希验证。
            
- 如果发现数据被篡改，设备可以选择拒绝启动、显示警告或以降级模式运行。
            
            

dm-verity 的内核配置选项：
            
```
CONFIG_DM_VERITY=y
CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG=y  # 支持根哈希签名验证
CONFIG_DM_VERITY_FEC=y                   # 支持前向纠错（FEC）
```

            

前向纠错（Forward Error Correction，FEC）是 Android 对
            dm-verity 的扩展：即使部分数据损坏，也可以通过 FEC
            编码恢复。这对 NAND Flash
            存储尤其有用，因为闪存块可能因磨损出现位翻转。
            

### dm-verity 的只读限制

            

dm-verity
            只支持只读设备。因为哈希树在创建时已经固定，任何对数据的修改都会导致哈希不匹配。如果需要可写的完整性保护，应使用
            dm-integrity（在数据块旁边存储校验标签，支持读写）。
            
            

## 八、dm-snapshot 与
            dm-mirror

            

### dm-snapshot：写时复制快照

            

dm-snapshot
            提供块级快照（Snapshot）功能。快照创建时不复制数据——它只记录一个时间点。此后，对源设备的任何修改都通过写时复制（Copy-on-Write，COW）机制保存旧数据到快照设备中，保证快照始终反映创建时刻的数据状态。
            

dm-snapshot 涉及两个 target：
            
            
- **snapshot-origin**：挂载在源设备上，拦截写入操作。
            
- **snapshot**：快照设备，存储 COW
            数据和映射元数据。
            
            

### 快照的工作流程

            
```
初始状态：
  源设备：[A][B][C][D]
  快照设备：（空）

写入源设备的块 B（新数据 B'）：
  1. snapshot-origin 拦截写入
  2. 先把块 B 的旧数据复制到快照设备（COW）
  3. 再把 B' 写入源设备
  
结果：
  源设备：[A][B'][C][D]
  快照设备：[B]（COW 副本）

读取快照：
  块 A → 快照设备没有 → 从源设备读取当前的 A
  块 B → 快照设备有 COW 副本 → 读取快照设备中的 B（旧数据）
  块 C → 快照设备没有 → 从源设备读取当前的 C
```

            

### 创建 dm-snapshot

            
```
# 假设 /dev/mapper/origin-vol 是源逻辑卷
# /dev/sdc 用作 COW 设备（需要足够大的空间存储变更块）
VOL_SIZE=$(blockdev --getsz /dev/mapper/origin-vol)

# 创建 snapshot-origin
dmsetup create origin --table "0 $VOL_SIZE snapshot-origin /dev/mapper/origin-vol"

# 创建 snapshot（P 表示持久化快照，8 是 chunk 大小，单位为扇区）
dmsetup create snap --table "0 $VOL_SIZE snapshot /dev/mapper/origin-vol /dev/sdc P 8"
```

            

### 快照空间耗尽

            

COW 设备的空间有限。如果源设备的变更量超过 COW
            设备的容量，快照会变为无效（invalid）状态，快照数据不再可靠。
            
```
# 查看快照状态
dmsetup status snap
```

            

输出示例：
            
```
0 209715200 snapshot 1024/2097152 1024
```

            

`1024/2097152` 表示已使用 1024 个 chunk，总共
            2097152 个 chunk。当已使用量接近总量时需要告警。
            

### LVM 快照

            

LVM 对 dm-snapshot 做了封装：
            
```
# 创建快照
lvcreate -L 10G -s -n snap-data vg0/data

# 查看快照使用率
lvs vg0/snap-data -o+snap_percent

# 合并快照（将快照的数据恢复到源卷）
lvconvert --merge vg0/snap-data
```

            

### dm-mirror：块级镜像

            

dm-mirror 在多个底层设备之间维护数据的同步副本，类似 RAID
            1。任何写入操作同时写入所有镜像设备，读取从任一设备完成。
            

dm-mirror 的主要用途不是长期冗余（那是 MD RAID
            的工作），而是 LVM 的在线数据迁移工具 `pvmove`
            的底层机制。
            

### pvmove 的实现原理

            

`pvmove`
            把逻辑卷的数据从一个物理卷迁移到另一个物理卷，迁移过程中逻辑卷保持可用。它的实现分三步：
            
            
- **创建 dm-mirror**：在源 PV 和目标 PV
            之间建立镜像关系，源为主镜像，目标为从镜像。
            
- **后台同步**：dm-mirror 把源 PV
            的数据逐块复制到目标
            PV，同时拦截新的写入，保证两端数据一致。
            
- **切换映射表**：同步完成后，LVM
            修改逻辑卷的映射表，把 target 从 `mirror`
            改为指向目标 PV 的 `linear`，然后释放源 PV。
            
            
```
# 将 vg0/data 的数据从 /dev/sdb 迁移到 /dev/sdc
pvmove /dev/sdb /dev/sdc

# 迁移过程中查看映射表，能看到 mirror target
dmsetup table vg0-data
```

            

迁移中的映射表示例：
            
```
0 209715200 mirror core 1 1024 2 8:16 0 8:32 0
```

            

`mirror core 1 1024 2` 表示：日志类型
            core（内存日志），1 个日志参数（region 大小 1024 扇区），2
            个镜像成员。
            

### dm-snapshot 与
            dm-mirror 的对比

            
            
            
            维度
            dm-snapshot
            dm-mirror
            
            
            
            
            目的
            记录某时刻的数据状态
            维护多个设备的数据同步
            
            
            数据复制
            写时复制（惰性）
            主动后台同步
            
            
            读写支持
            快照只读（或可写快照）
            两端都可读写
            
            
            空间需求
            只存变更量
            需要等量的目标空间
            
            
            典型用途
            LVM 快照、备份
            pvmove 数据迁移
            
            
            
            
            

## 九、dmsetup 实战

            

### dmsetup 基础

            

`dmsetup` 是 Device Mapper
            的命令行管理工具，通过 dm-ioctl 接口与内核通信。它是所有 DM
            操作的最底层工具——LVM、LUKS、Docker devicemapper
            驱动底层都通过类似的 ioctl 调用完成操作。
            

### 创建和管理 DM 设备

            
```
# 创建 DM 设备
echo "0 209715200 linear /dev/sdb 0" | dmsetup create my-device

# 查看所有 DM 设备
dmsetup ls

# 查看设备详细信息
dmsetup info my-device
```

            

`dmsetup info` 输出示例：
            
```
Name:              my-device
State:             ACTIVE
Read Ahead:        256
Tables present:    LIVE
Open count:        0
Event number:      0
Major, minor:      253, 0
Number of targets:  1
UUID:
```

            

关键字段：
            
            
- **State**：`ACTIVE`（正常）或
            `SUSPENDED`（已挂起）。
            
- **Open
            count**：当前打开该设备的计数。如果不为
            0，说明有进程正在使用，不能直接 remove。
            
- **Tables present**：`LIVE`
            表示有活跃映射表，`INACTIVE`
            表示有待切换的新表。
            
            

### 查看映射表和状态

            
```
# 查看映射表（静态配置）
dmsetup table my-device

# 查看运行时状态（动态信息）
dmsetup status my-device

# 查看所有 DM 设备的映射表
dmsetup table
```

            

`table` 和 `status`
            的区别：`table`
            返回的是创建时加载的映射表原文，`status` 返回的是
            target driver 的运行时状态信息（如 thin-pool
            的使用率、dm-cache 的命中率等）。
            

### 挂起、恢复和修改映射表

            
```
# 加载新映射表（不立即生效）
echo "0 419430400 linear /dev/sdc 0" | dmsetup load my-device

# 查看待切换的表
dmsetup info my-device  # Tables present: LIVE & INACTIVE

# 挂起设备
dmsetup suspend my-device

# 恢复设备（同时切换到新映射表）
dmsetup resume my-device

# 验证新表已生效
dmsetup table my-device
```

            

### 删除 DM 设备

            
```
# 删除单个设备
dmsetup remove my-device

# 如果设备正被使用（open count > 0），需要先卸载文件系统
umount /mnt/my-device
dmsetup remove my-device

# 强制延迟删除（设备在最后一个引用释放后自动删除）
dmsetup remove --deferred my-device

# 删除所有 DM 设备（危险操作，生产环境慎用）
dmsetup remove_all
```

            

### 调试 DM 设备

            

当 DM 设备出现问题时，以下命令有助于排查：
            
```
# 查看 DM 设备的依赖关系（底层设备）
dmsetup deps my-device

# 输出示例：
# 1 dependencies : (8, 16)
# (8, 16) 对应 major:minor，即 /dev/sdb

# 查看设备树
dmsetup ls --tree

# 查看内核日志中的 DM 相关信息
dmesg | grep -i "device-mapper"

# 查看 /sys 中的 DM 设备信息
ls /sys/block/dm-0/dm/
cat /sys/block/dm-0/dm/name
cat /sys/block/dm-0/dm/uuid
```

            

### 使用 dmsetup
            创建测试设备

            

`dm-zero` 和 `dm-error`
            是两个有用的测试 target：
            
```
# 创建一个 1 GiB 的 "零设备"（读返回零，写丢弃）
echo "0 2097152 zero" | dmsetup create zero-device

# 创建一个 "错误设备"（所有 I/O 返回错误）
echo "0 2097152 error" | dmsetup create error-device

# 创建一个部分正常、部分出错的设备（模拟坏块）
echo "0 1048576 linear /dev/sdb 0
1048576 1048576 error" | dmsetup create partial-error
```

            

`partial-error` 设备的前 512 MiB 正常映射到
            `/dev/sdb`，后 512 MiB 的所有 I/O
            返回错误。可以用来测试文件系统对底层 I/O
            错误的处理能力。
            

### dmsetup 与 udev 的交互

            

`dmsetup` 创建或修改 DM 设备时会触发 udev
            事件。在脚本中批量操作 DM 设备时，如果不需要 udev
            处理，可以使用 `--noudevsync` 加速：
            
```
# 禁用 udev 同步（仅在脚本中使用）
dmsetup create my-device --noudevsync --table "0 2097152 linear /dev/sdb 0"

# 手动触发 udev 处理
dmsetup udevcreatecookie
dmsetup create my-device --udevcookie $COOKIE --table "..."
dmsetup udevreleasecookie $COOKIE
```

            
            

## 十、Device
            Mapper 在容器存储中的应用

            

### Docker devicemapper
            存储驱动

            

Docker 早期在 RHEL/CentOS 上默认使用 devicemapper
            存储驱动（Storage Driver）。这个驱动利用 dm-thin
            为每个容器和镜像层提供独立的块设备，通过精简配置和快照实现镜像层叠和容器可写层。
            

### 镜像层与容器层的实现

            

devicemapper 驱动的存储模型：
            
```
容器可写层（thin snapshot of 镜像顶层）
     │
镜像层 N（thin snapshot of 层 N-1）
     │
镜像层 N-1（thin snapshot of 层 N-2）
     │
   ...
     │
镜像基础层（thin volume）
     │
thin-pool
     │
  数据设备 + 元数据设备
```

            

每个镜像层是上一层的 dm-thin
            快照。容器的可写层是镜像顶层的快照。这种嵌套快照实现了
            Docker 的分层存储模型。
            
            
- **拉取镜像**：每下载一层，创建上一层的 thin
            快照，在快照上写入该层的文件变更。
            
- **启动容器**：创建镜像顶层的 thin
            快照作为容器的可写层。
            
- **提交容器**：把容器可写层固化为新的镜像层。
            
            

### loop-lvm 与 direct-lvm

            

devicemapper 驱动有两种配置模式：
            

**loop-lvm**（不推荐用于生产）：使用稀疏文件（Sparse
            File）模拟块设备作为 thin-pool
            的底层。默认配置，开箱即用，但性能差，稳定性低。
            
```
# 查看 Docker 的存储驱动配置
docker info | grep "Storage Driver"
# Storage Driver: devicemapper

docker info | grep "Data loop file"
# Data loop file: /var/lib/docker/devicemapper/devicemapper/data
```

            

**direct-lvm**（生产推荐）：使用真实的块设备作为
            thin-pool 的底层。需要手动配置，但性能和稳定性显著优于
            loop-lvm。
            
```
# 配置 direct-lvm
# 1. 创建专用的卷组
pvcreate /dev/sdb
vgcreate docker-vg /dev/sdb

# 2. 创建 thin-pool
lvcreate --wipesignatures y -n thinpool docker-vg -l 95%VG
lvcreate --wipesignatures y -n thinpoolmeta docker-vg -l 1%VG
lvconvert -y --zero n -c 512K \
  --thinpool docker-vg/thinpool \
  --poolmetadata docker-vg/thinpoolmeta

# 3. 配置 Docker daemon
cat > /etc/docker/daemon.json 
            

### devicemapper
            驱动的性能特征

            

devicemapper 驱动的 I/O 路径比 overlay2
            驱动更长。每次容器内的文件写入都要经过：
            
```
容器进程 write()
  → VFS → ext4/xfs
    → Page Cache
      → Block Layer
        → dm-thin（容器可写层）
          → dm-thin-pool
            → 底层块设备
```

            

而 overlay2 驱动使用文件系统级的联合挂载（Union
            Mount），不经过 Device Mapper 层，路径更短。
            

devicemapper 的另一个限制：dm-thin
            的按需分配会引入写入放大（Write Amplification）。即使只写入
            1 字节，dm-thin 也要分配一个完整的数据块（通常 64
            KiB），对小写入不友好。
            

### 容器存储驱动的演变

            

devicemapper 驱动在 Docker
            的发展历史中扮演了重要角色，但逐步被 overlay2 取代：
            
            
            
            时期
            存储驱动
            特点
            
            
            
            
            Docker 早期（2013-2015）
            AUFS
            依赖非上游内核补丁
            
            
            RHEL/CentOS（2015-2018）
            devicemapper
            块级，不依赖特定文件系统
            
            
            Docker 17.06+（2017
            至今）
            overlay2
            文件级，性能好，稳定性高
            
            
            
            

overlay2 成为主流后，devicemapper 驱动已不再推荐。Docker
            官方文档标注 devicemapper 为”deprecated”状态。但理解
            devicemapper 驱动的实现原理，有助于理解 Device Mapper
            在实际系统中的应用模式。
            

### Device Mapper
            在现代容器生态中的角色

            

虽然 Docker 的 devicemapper 存储驱动已经过时，Device
            Mapper 在容器生态中仍然活跃：
            
            
- **containerd 的 devmapper
            snapshotter**：containerd 提供了基于 dm-thin
            的快照器（Snapshotter），作为 overlayfs
            的替代方案。Firecracker microVM 使用这个快照器为每个 VM
            提供独立的块设备根文件系统。
            
- **Kata
            Containers**：在虚拟机容器场景中，Guest OS
            需要块设备而非文件系统挂载，dm-thin
            快照是提供轻量级块设备的高效方式。
            
- **dm-verity
            保护容器镜像**：部分安全方案使用 dm-verity
            对容器镜像的只读层做完整性验证，防止镜像被篡改。
            
            
            

## 参考资料

            

### 内核源码

            
            
- Linux 6.1，`drivers/md/dm.c`——Device Mapper
            核心代码，包含 `dm_submit_bio()` 入口。
            
- Linux
            6.1，`drivers/md/dm-table.c`——映射表管理，包含
            `dm_table_find_target()`。
            
- Linux
            6.1，`drivers/md/dm-linear.c`——dm-linear target
            实现。
            
- Linux
            6.1，`drivers/md/dm-stripe.c`——dm-striped target
            实现。
            
- Linux 6.1，`drivers/md/dm-thin.c`——dm-thin 和
            thin-pool target 实现。
            
- Linux
            6.1，`drivers/md/dm-cache-target.c`——dm-cache
            target 实现。
            
- Linux 6.1，`drivers/md/dm-crypt.c`——dm-crypt
            target 实现。
            
- Linux
            6.1，`drivers/md/dm-verity-target.c`——dm-verity
            target 实现。
            
- Linux
            6.1，`drivers/md/dm-snap.c`——dm-snapshot target
            实现。
            
- Linux 6.1，`drivers/md/dm-ioctl.c`——dm-ioctl
            用户空间接口。
            
- Linux
            6.1，`include/linux/device-mapper.h`——`struct target_type`
            定义。
            
            

### 内核文档

            
            
- `Documentation/admin-guide/device-mapper/`——Device
            Mapper 管理员指南目录。
            
- `Documentation/admin-guide/device-mapper/linear.rst`——dm-linear
            文档。
            
- `Documentation/admin-guide/device-mapper/striped.rst`——dm-striped
            文档。
            
- `Documentation/admin-guide/device-mapper/thin-provisioning.rst`——dm-thin
            文档。
            
- `Documentation/admin-guide/device-mapper/cache.rst`——dm-cache
            文档。
            
- `Documentation/admin-guide/device-mapper/dm-crypt.rst`——dm-crypt
            文档。
            
- `Documentation/admin-guide/device-mapper/verity.rst`——dm-verity
            文档。
            
- `Documentation/admin-guide/device-mapper/snapshot.rst`——dm-snapshot
            文档。
            
            

### 工具文档

            
            
- `dmsetup(8)` 手册页——dmsetup
            命令使用说明。
            
- `cryptsetup(8)` 手册页——LUKS 和 dm-crypt
            管理工具。
            
- `veritysetup(8)` 手册页——dm-verity
            管理工具。
            
- `thin_check(8)` 手册页——thin
            元数据检查工具。
            
- `cache_check(8)` 手册页——dm-cache
            元数据检查工具。
            
            

### 设计文档与演讲

            
            
- Sahlberg, Alasdair G. Kergon, and Joe Thornber.
            “Device-mapper: A New Framework for Block Device Drivers.”
            Ottawa Linux Symposium, 2004.
            
- Thornber, Joe. “Thin Provisioning.” Linux Kernel Summit,
            2011.
            
- Docker Documentation. “Use the Device Mapper storage
            driver.”
            
            
            

**上一篇**: RAID 原理与实践
            **下一篇**: 块存储加密：LUKS
            与 dm-crypt
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-23 · storage
                    

### 【存储工程】存储加密工程

                    

全面剖析静态数据加密的工程实践——块级加密、文件级加密与应用级加密的架构对比，AES-XTS/AES-GCM 选型，密钥层次与轮转，硬件加速性能分析
                

                
                    

2025-08-31 · storage
                    

### 【存储工程】块存储加密：LUKS 与 dm-crypt

                    

在存储系统的安全防线中，加密是最后一道也是最重要的一道屏障。当物理安全措施失效——磁盘被盗、服务器被非法访问、退役硬盘未彻底销毁——只有加密能确保数据不被未授权方读取。块级加密（Block-Level Encryption）在存储栈的最低层工作，对上层文件系统和应用程序完全透明，不需要修改任何一行应用代码就能保护磁盘上…
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。