# 【存储工程】新硬件对存储的影响

来源: https://quant67.com/post/storage/73-new-hardware/new-hardware.html
日期: 2025-10-21 |

---

一块传统 NVMe SSD 的 FTL（Flash Translation
            Layer，闪存转换层）藏在固件里做垃圾回收，主机完全不知道底下发生了什么——直到某次写入延迟突然从
            100 微秒跳到 30 毫秒。一台服务器的内存不够了，唯一的办法是加
            DIMM
            插槽或者换更大的条，但主板物理槽位就那么多。想在存储路径上做压缩或加密卸载，数据要先从
            SSD 读到主机内存、处理完再写回去，CPU 和 PCIe
            带宽白白浪费一个来回。
            

这三个痛点分别催生了三类新硬件：ZNS SSD（Zoned Namespace
            SSD）把闪存管理的控制权交还给主机软件；CXL（Compute Express
            Link）让内存池化成为可能，打破了单机内存容量的天花板；计算存储设备（Computational
            Storage Device，CSD）和 DPU/SmartNIC
            把计算推到数据所在的位置，减少不必要的数据搬运。这些硬件不是实验室概念——ZNS
            SSD 已经有 Western Digital 的 Ultrastar DC ZN540 和三星
            PM1731a 在生产环境部署；CXL 1.1/2.0
            设备已经进入服务器平台；DPU 从 NVIDIA BlueField-2 到
            BlueField-3 已经迭代了两代。
            

本文从工程师视角出发，逐一拆解这四类新硬件的编程模型、对存储软件栈的改变、工程落地现状和实际约束。目标不是罗列规格参数，而是回答一个具体问题：这些新硬件到底改变了存储架构的哪些假设，工程师现在该做什么准备？
            
            

## 一、ZNS
            SSD：把闪存管理权交还主机

            

### 1.1 传统 SSD 的问题

            

传统 NVMe SSD
            对主机暴露的是一个平坦的逻辑块地址空间（Logical Block
            Address，LBA），主机可以随机读写任意
            LBA。这个接口简单，但代价藏在 SSD 固件里：
            

**写放大（Write Amplification）。** NAND
            闪存的最小写入单位是页（Page，通常 4-16
            KB），最小擦除单位是块（Block，通常 4-16
            MB）。要覆盖写一个已有数据的页，SSD
            不能原地更新，只能把数据写到新位置，然后在后台把旧块里的有效数据搬到别处、再擦除旧块。这个过程就是垃圾回收（Garbage
            Collection，GC）。GC
            搬运的数据量和主机实际写入的数据量的比值就是写放大因子（Write
            Amplification Factor，WAF）。生产环境中 WAF 通常在 1.5 到 5
            之间，极端场景下可以超过 10。
            

**预留空间（Over-Provisioning，OP）。**
            为了让 GC 有空闲块可用，SSD
            要预留一部分容量不暴露给主机。企业级 SSD 的 OP 通常是 7% 到
            28%，这些容量用户买了但用不了。
            

**GC 导致的延迟抖动。** GC
            是后台操作，但当空闲块不足时，GC 会和前台 I/O
            争抢闪存通道带宽。这是 SSD 尾延迟的主要来源——P99 延迟可能比
            P50 高两个数量级。
            

**FTL 的 DRAM 开销。** FTL
            维护逻辑地址到物理地址的映射表。一块 4 TB 的
            SSD，如果映射粒度是 4 KB，映射表大小约 4 GB。这个 DRAM
            成本直接计入 SSD 的 BOM。
            

### 1.2 ZNS 的核心思想

            

ZNS SSD
            的核心思想是：把闪存的擦除块边界暴露给主机，让主机软件来决定数据放在哪里、什么时候擦除。
            

NVMe ZNS 规范（NVMe TP 4053，后纳入 NVMe 2.0）定义了
            Zone（区域）的概念：
            
            
- SSD 的命名空间被划分为固定大小的 Zone，每个 Zone
            对应底层的一个或多个擦除块。
            
- Zone 内只能顺序写入（Sequential Write
            Required），不能随机覆盖写。
            
- Zone 有明确的生命周期状态：Empty → Open → Closed → Full
            → Empty（通过 Reset）。
            
- 主机通过 Zone Management 命令控制 Zone 的状态转换。
            
            

这个约束看似限制了灵活性，但带来了三个关键收益：
            
            
- **消除设备端 GC。** 数据按 Zone
            顺序写入，整个 Zone
            的数据要么全有效、要么全无效。主机决定何时 Reset 一个
            Zone（相当于擦除），不需要设备端做数据搬运。WAF 可以降到接近
            1.0。
            
- **大幅减少 OP。** 不需要为 GC
            预留大量空闲块，OP 可以从 28% 降到 5%
            以下，用户可用容量显著增加。
            
- **消除 FTL 映射表的 DRAM。** 因为 Zone
            内顺序写入，逻辑地址和物理地址的映射变成简单的偏移计算，不需要维护大规模映射表。
            
            

### 1.3 Zone 编程模型

            

ZNS SSD 的编程模型围绕 Zone 的状态机展开：
            
```
stateDiagram-v2
    [*] --> Empty
    Empty --> Open_Implicit : 写入数据
    Empty --> Open_Explicit : Zone Open 命令
    Open_Implicit --> Open_Explicit : Zone Open 命令
    Open_Explicit --> Open_Implicit : （内部转换）
    Open_Implicit --> Closed : Zone Close 命令
    Open_Explicit --> Closed : Zone Close 命令
    Open_Implicit --> Full : 写满
    Open_Explicit --> Full : 写满
    Closed --> Open_Explicit : Zone Open 命令
    Closed --> Full : 写满
    Full --> Empty : Zone Reset 命令
    Closed --> Empty : Zone Reset 命令
    Open_Implicit --> Empty : Zone Reset 命令
    Open_Explicit --> Empty : Zone Reset 命令
```

            

关键概念：
            

**Write Pointer（写指针）。** 每个 Zone
            维护一个写指针，指向下一个可写入的
            LBA。写入必须从写指针位置开始，写完后写指针自动前进。任何试图写入写指针之前位置的操作都会被设备拒绝。
            

**Active Zone 限制。** SSD 同时能处于 Open
            或 Closed 状态的 Zone
            数量有上限（`max_active_zones`），因为每个活跃
            Zone 都占用设备内部资源（写缓冲区、闪存通道映射）。典型的
            ZNS SSD 支持 14 到 32 个 Active
            Zone。这个限制直接影响上层软件的并发写入设计。
            

**Zone Append 命令。**
            除了普通的顺序写入，ZNS 还定义了 Zone Append
            命令：主机只指定目标 Zone，不指定具体
            LBA，设备自动把数据追加到写指针位置，完成后返回实际写入的
            LBA。Zone Append 解决了多线程并发写同一个 Zone
            时的协调问题——不需要主机端加锁保证写入顺序。
            

### 1.4 Linux 内核对 ZNS
            的支持

            

Linux 内核从 5.9 版本开始支持 ZNS
            SSD，主要通过以下组件：
            

**块设备层的 Zoned Block
            Device（ZBD）抽象。** 内核用 `blk_zone`
            结构体表示 Zone，提供 `blkdev_zone_mgmt()`
            接口进行 Zone 管理。用户态可以通过
            `ioctl(BLKREPORTZONE)` 查询 Zone 状态，通过
            `ioctl(BLKRESETZONE)` /
            `ioctl(BLKOPENZONE)` /
            `ioctl(BLKCLOSEZONE)` 管理 Zone 生命周期。
            

**文件系统支持。** 目前原生支持 ZNS
            的文件系统有两个：
            
            
- **F2FS（Flash-Friendly File System）。** 从
            Linux 5.12 开始支持 ZNS。F2FS
            本身就是日志结构文件系统，天然匹配 Zone
            的顺序写入约束。
            
- **Btrfs。** 从 Linux 5.12 开始实验性支持
            ZNS。Btrfs 的 COW（Copy-on-Write）语义和 Zone
            模型有天然契合之处，但 Btrfs 的元数据随机更新和 Zone
            的顺序写入存在张力，需要额外的日志区域。
            
            

**dm-zoned 和 dm-linear。** 对于不支持 Zoned
            设备的文件系统（如 ext4、XFS），可以用 dm-zoned 设备映射器在
            ZNS SSD 上模拟传统块设备。dm-zoned
            在主机端做地址翻译和垃圾回收，本质上是把 FTL
            从固件搬到了主机内核。这种方式的好处是兼容性，缺点是主机 CPU
            开销和没有充分利用 ZNS 的优势。
            

### 1.5 Zone Append 编程示例

            

Zone Append 是 ZNS
            引入的最重要的新命令之一。传统的顺序写入要求主机精确指定写入的
            LBA，这意味着多线程并发写同一个 Zone
            时必须在主机端加锁来协调写指针。Zone Append
            把写指针管理完全交给设备——主机只说”往这个 Zone
            追加”，设备返回”我写到了这个 LBA”。
            

在 Linux 内核中，Zone Append 通过
            `REQ_OP_ZONE_APPEND`
            操作类型暴露给上层。以下是一个简化的内核态 Zone Append
            调用流程：
            
```
/* 内核态 Zone Append 示例（简化版，基于 Linux 6.1 bio 接口） */

struct bio *bio;
struct page *page;
sector_t zone_start = 0x80000; /* Zone 的起始扇区 */

bio = bio_alloc(bdev, 1, REQ_OP_ZONE_APPEND, GFP_NOIO);
bio->bi_iter.bi_sector = zone_start; /* 只需指定 Zone 起始地址 */

page = alloc_page(GFP_NOIO);
/* 填充 page 数据... */
bio_add_page(bio, page, PAGE_SIZE, 0);

submit_bio_wait(bio);

/* 写入完成后，bi_iter.bi_sector 被更新为实际写入的 LBA */
sector_t actual_lba = bio->bi_iter.bi_sector;
pr_info("Zone Append: data written at sector %llu\n", actual_lba);

bio_put(bio);
```

            

关键点：`bi_sector` 在提交时设置为 Zone
            的起始地址，提交完成后被设备更新为实际写入的
            LBA。上层软件需要记录这个返回的 LBA
            来维护数据索引。这个设计完美适配 LSM-Tree
            类存储引擎——写入时不关心具体位置，只关心数据在哪个
            Zone；之后通过 SSTable 索引定位具体位置。
            

Zone Append 的最大写入大小由设备的
            `zasl`（Zone Append Size Limit）字段决定，通常在
            128 KB 到 512 KB 之间，小于普通 NVMe
            命令的最大传输大小（MDTS）。这个限制需要上层软件在写入大块数据时做分片。
            

### 1.6 ZNS vs
            FDP：两种数据放置方案的对比

            

NVMe 2.0 规范中除了 ZNS，还引入了 FDP（Flexible Data
            Placement）作为另一种降低写放大的方案。两者的核心思路不同：
            
            
- **ZNS**
            把闪存的物理边界（Zone）暴露给主机，要求主机按 Zone
            顺序写入，主机全权负责数据放置和垃圾回收。
            
- **FDP**
            保留传统的随机写入接口，但允许主机通过”放置句柄”（Reclaim
            Unit Handle）提示设备哪些数据应该放在一起。设备仍然负责
            GC，但可以基于放置提示做更好的数据分组，减少 GC
            时的数据搬运。
            
            
            
            
            
            
            
            
            
            维度
            ZNS
            FDP
            
            
            
            
            写入接口
            必须 Zone 内顺序写入
            保留随机写入
            
            
            主机复杂度
            高（管理 Zone 生命周期、写指针）
            中（只需维护放置句柄映射）
            
            
            设备端 GC
            不需要
            仍然需要，但效率更高
            
            
            WAF 降低效果
            最优（接近 1.0）
            中等（取决于放置提示的准确性）
            
            
            文件系统兼容性
            需要 Zoned-aware FS
            兼容所有文件系统
            
            
            生态成熟度
            高（多个产品、文件系统支持）
            逐步增加（三星、铠侠已有产品）
            
            
            
            

FDP
            的优势在于对主机软件的改动更小——不需要重写文件系统或存储引擎，只需要在
            I/O 路径中加入放置提示。对于无法使用 ZNS
            的场景（通用工作负载、不想改文件系统），FDP
            是一个务实的折中方案。但如果追求最低的写放大和最稳定的延迟，ZNS
            的硬件效率仍然是更好的。
            

### 1.7 ZNS 实战：查询 Zone
            状态

            

在一台挂载了 ZNS SSD（`/dev/nvme0n1`）的 Linux
            系统上，可以用 `blkzone` 工具查询 Zone 信息：
            
```
# 查看前 4 个 Zone 的状态
sudo blkzone report /dev/nvme0n1 -c 4
```

            

典型输出：
            
```
  start: 0x000000000, len 0x080000, cap 0x07a800, wptr 0x07a800, use 0, non-seq 0, reset 0, zcond:14(fu) [type: 2(SEQ_WRITE_REQUIRED)]
  start: 0x000080000, len 0x080000, cap 0x07a800, wptr 0x000000, use 0, non-seq 0, reset 0, zcond: 1(em) [type: 2(SEQ_WRITE_REQUIRED)]
  start: 0x000100000, len 0x080000, cap 0x07a800, wptr 0x001c000, use 0, non-seq 0, reset 0, zcond: 2(oi) [type: 2(SEQ_WRITE_REQUIRED)]
  start: 0x000180000, len 0x080000, cap 0x07a800, wptr 0x000000, use 0, non-seq 0, reset 0, zcond: 1(em) [type: 2(SEQ_WRITE_REQUIRED)]
```

            

解读：
            
            
- `zcond:14(fu)` 表示 Zone 已满（Full）。
            
- `zcond:1(em)` 表示 Zone
            为空（Empty），可以从头写入。
            
- `zcond:2(oi)` 表示 Zone 被隐式打开（Open
            Implicit），`wptr` 指向当前写入位置。
            
- `cap` 是 Zone 的可用容量，可能小于
            `len`（Zone 大小），因为 ZNS 允许 Zone
            容量和大小不同。
            
            

重置一个 Zone 使其可以重新写入：
            
```
# 重置第一个 Zone
sudo blkzone reset /dev/nvme0n1 -o 0 -c 1
```

            

### 1.8 ZNS
            对存储软件栈的改变

            

ZNS 不只是换了一种
            SSD，它改变了存储软件栈的多个假设：
            
            
            
            假设
            传统 SSD
            ZNS SSD
            
            
            
            
            写入模式
            随机写入，设备端处理
            主机必须保证 Zone 内顺序写入
            
            
            垃圾回收
            设备固件负责
            主机软件负责 Zone Reset
            
            
            延迟可预测性
            受 GC 影响，尾延迟波动大
            无设备端 GC，延迟更稳定
            
            
            预留空间
            7%-28%
            可低至 3%-5%
            
            
            FTL DRAM
            需要大容量 DRAM
            几乎不需要
            
            
            并发写入
            无限制
            受 Active Zone 数量限制
            
            
            文件系统兼容
            所有文件系统
            需要 Zoned-aware 文件系统或 dm-zoned
            
            
            上层软件复杂度
            低（SSD 像普通硬盘）
            高（必须管理 Zone 生命周期）
            
            
            
            

对工程师来说，ZNS
            的核心取舍是：用主机端的软件复杂度换取更低的写放大、更稳定的延迟和更高的可用容量。这个取舍在大规模存储系统（云存储后端、分布式文件系统）里是划算的，因为软件栈本来就需要做数据放置和垃圾回收；但在通用服务器场景下，额外的软件复杂度不一定值得。
            
            

## 二、CXL
            内存扩展：打破内存墙

            

### 2.1 内存容量瓶颈

            

现代服务器的内存需求在快速增长。数据库要缓存热数据、内存数据库（Redis、Memcached）把全部数据放在内存、机器学习推理需要加载大模型——但单台服务器的
            DRAM 容量受制于 CPU 的内存通道数和 DIMM 插槽数。一颗 Intel
            Sapphire Rapids CPU 有 8 个内存通道，每个通道 2 个 DIMM
            插槽，单条 DDR5 DIMM 最大 256 GB，单路极限 4
            TB。实际部署中，成本和密度的考量通常让单路内存停留在 512 GB
            到 1 TB。
            

同时，DRAM 的每 GB
            成本下降速度已经放缓。增加内存容量的边际成本越来越高，但应用对内存的需求还在线性增长。这就是”内存墙”问题。
            

### 2.2 CXL 是什么

            

CXL（Compute Express Link）是一种基于 PCIe
            物理层的开放互连协议，由 Intel 主导发起，已被 CXL Consortium
            标准化。CXL 定义了三种子协议：
            
            
- **CXL.io：** 等效于 PCIe
            协议，用于设备发现、配置、中断和 DMA。所有 CXL 设备都支持
            CXL.io。
            
- **CXL.cache：**
            允许设备缓存主机内存，设备端的缓存和主机 CPU
            的缓存保持一致性。典型用户是加速器（GPU、FPGA）。
            
- **CXL.mem：** 允许主机 CPU 直接以
            load/store 指令访问设备上的内存，如同访问本地
            DRAM。这是存储场景最关注的子协议。
            
            

### 2.3 CXL 设备类型

            

CXL 定义了三种设备类型：
            
            
            
            
            
            
            
            
            
            设备类型
            支持的子协议
            典型设备
            存储场景关联
            
            
            
            
            Type 1
            CXL.io + CXL.cache
            智能网卡、加速器
            间接影响：加速网络 I/O
            
            
            Type 2
            CXL.io + CXL.cache + CXL.mem
            GPU、FPGA 加速器
            加速计算密集型存储处理
            
            
            Type 3
            CXL.io + CXL.mem
            内存扩展器
            直接扩展服务器内存容量
            
            
            
            

存储工程师最关注的是 Type 3 设备——CXL
            内存扩展器。它本质上是一块通过 CXL 接口连接到 CPU
            的内存，CPU 可以像访问本地 DRAM 一样用 load/store
            指令访问它。
            

### 2.4 CXL.mem 的延迟特征

            

CXL.mem 的访问延迟比本地 DRAM 高，但比 NVMe SSD
            低得多。这个延迟差异来自 CXL 协议栈的开销：
            
```
┌─────────────────────────────┬──────────────┬──────────────────────────┐
│ 访问路径                     │ 典型延迟     │ 说明                     │
├─────────────────────────────┼──────────────┼──────────────────────────┤
│ 本地 DRAM（同 NUMA 节点）    │ 80-100 ns    │ CPU 直接访问             │
│ 远端 DRAM（跨 NUMA 节点）    │ 130-200 ns   │ 经 UPI/xGMI 互连        │
│ CXL 内存（CXL 1.1/2.0）     │ 170-350 ns   │ 经 PCIe 物理层 + CXL 协议│
│ Intel Optane PMEM            │ 300-400 ns   │ 已停产，仅供参考         │
│ NVMe SSD 4K 随机读           │ 70-120 us    │ 经 NVMe 命令队列         │
└─────────────────────────────┴──────────────┴──────────────────────────┘
```

            

关键观察：CXL 内存的延迟和跨 NUMA 节点的 DRAM
            访问处于同一量级（百纳秒级），比本地 DRAM 慢 2-3 倍，但比
            NVMe SSD 快 500-1000 倍。这个延迟特征让 CXL
            内存在存储系统中天然适合作为 DRAM 和 SSD 之间的中间层。
            

### 2.5 CXL 对缓存层的影响

            

在存储系统中，缓存层（Page Cache、数据库 Buffer
            Pool、应用层缓存）的设计假设是：内存快但贵且小，磁盘慢但便宜且大。CXL
            内存的出现打破了这个二分法，引入了一个中间层次。
            

**Page Cache 扩展。** Linux 内核可以把 CXL
            内存注册为一个独立的 NUMA 节点。通过内核的内存分级（Memory
            Tiering）机制（基于 NUMA Balancing 或内核 6.1+ 引入的
            `memory_tier` 框架），冷页面可以自动从本地 DRAM
            降级到 CXL 内存，热页面从 CXL 内存提升到本地
            DRAM。这样就在不修改应用的情况下，用 CXL 内存扩展了有效的
            Page Cache 容量。
            

**数据库 Buffer Pool 分层。** 数据库可以感知
            CXL 内存的延迟差异，把热数据页放在本地 DRAM 的 Buffer Pool
            中，把温数据页放在 CXL 内存中，冷数据页留在 SSD。相比直接从
            SSD 读取，从 CXL 内存读取温数据的延迟低三个数量级。
            

下面这张图展示了 CXL 内存加入后的存储层次变化：
            
```
graph TB
    subgraph 传统层次
        A1[CPU 缓存 L1/L2/L3
延迟: 1-30 ns] --> B1[本地 DRAM
延迟: 80-100 ns]
        B1 --> C1[NVMe SSD
延迟: 70-120 us]
        C1 --> D1[HDD / 网络存储
延迟: 3-15 ms]
    end

    subgraph CXL 扩展后的层次
        A2[CPU 缓存 L1/L2/L3
延迟: 1-30 ns] --> B2[本地 DRAM
延迟: 80-100 ns]
        B2 --> E2[CXL 内存
延迟: 170-350 ns]
        E2 --> C2[NVMe SSD
延迟: 70-120 us]
        C2 --> D2[HDD / 网络存储
延迟: 3-15 ms]
    end
```

            

CXL 内存填补了本地 DRAM 和 NVMe SSD
            之间三个数量级的延迟鸿沟。这意味着存储系统的缓存策略需要从”两级”（内存
            vs 磁盘）演变为”三级”（快速内存 vs CXL 内存 vs
            磁盘），淘汰算法和预取策略都需要相应调整。
            

### 2.6 Linux 内核的 CXL
            支持

            

Linux 内核从 5.18 开始引入 CXL
            子系统（`drivers/cxl/`），主要组件包括：
            

**CXL 总线驱动。** 负责 CXL
            设备的枚举、配置和资源管理。CXL
            设备在系统启动时被发现，其内存区域通过 ACPI CEDT（CXL Early
            Discovery Table）或 CXL DVSEC（Designated Vendor-Specific
            Extended Capability）描述。
            

**DAX（Direct Access）设备。** CXL
            内存默认以 DAX 设备的形式暴露给用户态。应用可以通过
            `mmap()` 直接映射 CXL 内存，绕过 Page Cache。
            

**NUMA 节点集成。** CXL 内存也可以作为一个
            NUMA 节点注册到内核的内存管理子系统中。这样内核的 Page
            Cache、SLAB 分配器都可以使用 CXL 内存，应用完全透明。
            

查看系统中的 CXL 设备：
            
```
# 列出 CXL 内存设备
sudo cxl list -M
```

            

典型输出：
            
```
[
  {
    "memdev": "mem0",
    "ram_size": "68719476736",
    "serial": "0x12345678",
    "numa_node": 2,
    "host": "0000:35:00.0"
  }
]
```

            

这里 `ram_size` 显示该 CXL 设备提供 64 GB
            内存，被分配到 NUMA 节点 2。
            

### 2.7 Memory Tiering
            配置实战

            

在一台配备 CXL Type 3 内存扩展器的 Linux 系统上，内核的
            Memory Tiering 功能可以自动在本地 DRAM 和 CXL
            内存之间迁移页面。以下是配置和验证的步骤：
            
```
# 1. 确认 CXL 内存被识别为独立 NUMA 节点
numactl --hardware
```

            

典型输出：
            
```
available: 3 nodes (0-2)
node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
node 0 size: 131072 MB
node 0 free: 120456 MB
node 1 cpus: 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
node 1 size: 131072 MB
node 1 free: 119832 MB
node 2 cpus:
node 2 size: 65536 MB
node 2 free: 65280 MB
```

            

这里 node 0 和 node 1 是本地 DRAM（各 128 GB），node 2 是
            CXL 内存（64 GB），没有 CPU 绑定（`cpus:`
            为空）。
            
```
# 2. 查看内存层级
cat /sys/devices/virtual/memory_tiering/memory_tier*/nodelist
```

            
```
0-1    # tier 0: 本地 DRAM
2      # tier 1: CXL 内存
```

            
```
# 3. 启用自动 NUMA Balancing（页面在层级间迁移的基础）
echo 2 > /proc/sys/kernel/numa_balancing
# 值为 2 表示启用包含降级和提升的完整分层模式
```

            
```
# 4. 验证降级策略
cat /sys/kernel/mm/numa/demotion_enabled
```

            
```
true
```

            

当 `demotion_enabled` 为 `true`
            时，内核在回收 node 0/1 的页面时，会优先把冷页面降级到 node
            2（CXL 内存），而不是直接回收到磁盘。这等于在 Page Cache
            回收路径中插入了一个中间层——冷数据先到 CXL 内存，只有 CXL
            内存也满了才回收到磁盘。
            

通过 `numastat`
            可以观察页面迁移的实际效果：
            
```
# 观察各 NUMA 节点的内存使用和页面迁移计数
watch -n 1 numastat -m
```

            

### 2.8 CXL 对存储架构的改变

            

CXL
            对存储架构的影响可以从短期和中期两个时间维度来看：
            

**短期（CXL 1.1/2.0，当前可用）：**
            
            
- 单机内存容量扩展：从 TB 级扩展到数 TB
            级，适合内存数据库、大规模缓存场景。
            
- 内存分层自动化：结合内核 Memory Tiering，冷热数据自动在
            DRAM 和 CXL 内存之间迁移。
            
- 降低总体拥有成本（TCO）：CXL 内存每 GB 成本低于 DDR5
            DRAM（使用相同的 DRAM
            颗粒但封装密度更高，或使用更廉价的介质），用较低的延迟代价换取更大的容量。
            
            

**中期（CXL 3.0/3.1，预计 2025-2027
            年量产）：**
            
            
- 内存池化（Memory Pooling）：多台服务器通过 CXL Switch
            共享一个内存池，动态分配给不同服务器。这彻底改变了内存容量规划——不再需要按峰值需求配置每台服务器的内存。
            
- 内存共享（Memory Sharing）：多个 CPU 通过 CXL 3.0
            的硬件一致性访问同一块内存区域，实现零拷贝跨节点通信。
            
- 对缓存层的进一步影响：当内存池化成为现实，Page Cache
            的容量弹性不再受限于单机。存储系统可以根据负载动态申请更多的缓存内存，释放不需要的内存给其他服务器使用。
            
            

### 2.9 工程判断

            

CXL Type 3 内存扩展器已经可以买到——三星的 CMM-D（CXL
            Memory Module - DRAM）和美光的 CZ120
            都是现有产品。但实际部署需要注意几个约束：
            
            
- **CPU 平台支持。** CXL 1.1 需要 Intel
            Sapphire Rapids 或 AMD Genoa 及以上平台。CXL 2.0 需要 Intel
            Emerald Rapids / Granite Rapids 或 AMD
            Turin。老平台不支持。
            
- **延迟敏感场景需要实测。** 170-350 ns
            的延迟是公开文献中的典型数值，实际延迟取决于具体设备和负载模式。对延迟极度敏感的应用（如高频交易）可能仍然无法接受
            CXL 的额外延迟。
            
- **软件生态仍在完善。** 内核的 CXL 子系统和
            Memory Tiering
            机制在快速迭代中，早期版本存在稳定性和功能限制。建议在 Linux
            6.5 以上的内核版本上评估。
            
- **CXL 3.0 内存池化距离生产环境仍有距离。**
            CXL Switch
            的商用化进度、多主机一致性协议的验证、故障域隔离等问题还在解决中。
            
            
            

## 三、计算存储设备（CSD）：把计算推到数据旁边

            

### 3.1 数据搬运的开销

            

传统存储架构中，数据处理的流程是：从 SSD
            读取数据到主机内存 → CPU 处理数据 → 结果写回 SSD
            或发送到网络。这个流程中，数据必须穿越 PCIe
            总线两次（读和写），而 PCIe Gen4 x4 的带宽约 7 GB/s、PCIe
            Gen5 x4 约 14 GB/s。
            

在很多场景中，CPU
            处理的数据量远大于最终需要的结果量。例如：
            
            
- 全表扫描筛选：从 1 TB 数据中筛选出满足条件的 1 GB。
            
- 数据压缩 / 解压：从 SSD
            读取压缩数据，解压后处理，只需要部分结果。
            
- 加密 / 解密：对整个卷的数据做加密处理。
            
- 视频转码：从存储读取原始视频流，转码后写回。
            
            

在这些场景中，大量的 PCIe 带宽和 CPU
            周期被用于搬运和处理”中间数据”，最终结果只是一小部分。计算存储设备（Computational
            Storage Device，CSD）的思路是：把计算推到数据所在的位置，在
            SSD 控制器旁边加一个计算单元（通常是 FPGA
            或嵌入式处理器），数据不用出 SSD 就能被处理。
            

### 3.2 CSD 的架构

            

SNIA（Storage Networking Industry Association）定义了
            Computational Storage 的参考架构，分为三种形态：
            

**CSx（Computational Storage
            Drive，CSD）。**
            计算引擎和存储介质集成在同一个设备中。计算引擎可以直接访问闪存数据，不经过
            PCIe 总线。这是最紧耦合的形态。
            

**CSP（Computational Storage Processor）。**
            独立的计算处理器，通过 PCIe Switch 连接到一个或多个标准
            SSD。CSP 可以访问 SSD
            的数据并处理。这种形态灵活性更高，但数据仍然要经过
            PCIe。
            

**CSA（Computational Storage Array）。**
            包含多个存储设备和一个或多个计算引擎的阵列。面向企业级存储。
            

下图展示了 CSD 架构与传统架构的数据流差异：
            
```
graph LR
    subgraph 传统架构
        SSD1[SSD] -->|读数据 7GB/s| PCIe1[PCIe Bus] -->|传输| CPU1[CPU + DRAM]
        CPU1 -->|处理后写回| PCIe1 -->|写数据| SSD1
    end

    subgraph CSD 架构
        SSD2[SSD + 计算引擎] -->|仅传输结果| PCIe2[PCIe Bus] -->|少量数据| CPU2[CPU + DRAM]
    end
```

            

在 CSD
            架构中，全量数据在设备内部被计算引擎处理，只有最终结果通过
            PCIe 传输到主机。对于选择率低的查询（例如从 1 TB
            数据中筛选出 10 MB），PCIe 带宽节省可达 99% 以上。
            

### 3.3 CSD 的编程模型

            

CSD
            的编程模型目前尚未完全标准化，不同厂商有不同的方案。NVMe
            规范从 NVMe 2.0 开始通过 Computational
            Programs（CPs）特性支持计算存储，定义了计算程序的下发和管理接口。
            

当前主流的编程方式：
            

**固定功能卸载（Fixed Function Offload）。**
            CSD 内置特定的计算功能（如压缩、加密、正则匹配），主机通过
            NVMe 命令触发。例如，ScaleFlux CSD 3000
            内置透明压缩功能，主机写入普通数据，CSD
            自动在内部压缩后存储，读取时自动解压。这种方式对主机透明，不需要修改应用。
            

**可编程卸载（Programmable Offload）。**
            主机把计算程序（通常是 eBPF 程序或 FPGA bitstream）下载到
            CSD 的计算引擎上执行。Samsung 的 SmartSSD（基于 Xilinx
            FPGA）支持将自定义逻辑编译后加载到 SSD 内部的 FPGA
            上运行。这种方式灵活性高但开发门槛也高。
            

**NVMe Computational Programs 接口。** NVMe
            2.0 规范定义了 Computational Programs（CPs）特性，为 CSD
            提供了标准化的管理接口。主要包括以下命令：
            
            
- **Download Compute
            Program（下载计算程序）。**
            主机把编译好的计算程序传输到 CSD。
            
- **Activate Compute
            Program（激活计算程序）。**
            主机指定要运行的计算程序和关联的数据范围。
            
- **Abort Compute Program（中止计算程序）。**
            主机强制停止一个正在运行的计算程序。
            
- **Compute Program Status（查询状态）。**
            主机查询计算程序的执行进度和结果。
            
            

这个接口类似于 NVMe
            固件更新的流程，但面向的是计算任务而非固件镜像。标准化的接口使得不同厂商的
            CSD
            可以用统一的方式管理计算程序，但计算程序本身的编程语言和运行时仍然因厂商而异。
            

### 3.4 CSD
            数据过滤的理论收益分析

            

CSD
            的核心价值在于减少不必要的数据传输。以一个数据库全表扫描场景为例，定量分析
            CSD 过滤的理论收益：
            

假设条件： - 表大小：1 TB - 查询选择率：1%（只有 1%
            的行满足 WHERE 条件） - PCIe Gen4 x4 带宽：7 GB/s - CSD
            内部过滤吞吐：4 GB/s（受限于闪存读取带宽）
            
```
┌──────────────────────┬──────────────────┬──────────────────┐
│ 指标                  │ 传统架构          │ CSD 架构          │
├──────────────────────┼──────────────────┼──────────────────┤
│ SSD 读取量           │ 1 TB              │ 1 TB              │
│ PCIe 传输量          │ 1 TB              │ 10 GB（1%选择率） │
│ PCIe 传输时间        │ 146 秒            │ 1.4 秒            │
│ 主机 CPU 过滤开销    │ 需要 CPU 扫描 1TB │ 接近 0            │
│ 总时间（理论值）      │ ~250 秒           │ ~260 秒           │
│ 主机 CPU 释放        │ 0                 │ 扫描期间 CPU 空闲  │
└──────────────────────┴──────────────────┴──────────────────┘
```

            

一个有意思的观察：CSD
            的总时间和传统架构差不多（因为都受限于 SSD
            内部闪存读取速度），但收益体现在两个方面——PCIe 带宽释放（从
            1 TB 降到 10 GB）和主机 CPU 释放。在 PCIe
            带宽成为瓶颈的场景（如多个应用共享 PCIe 通道）或 CPU
            是稀缺资源的场景（如云计算的多租户服务器），CSD
            的价值更明显。
            

如果选择率进一步降低（如 0.01%），CSD
            的带宽节省更显著；但如果选择率很高（如 50%），CSD
            的收益就很小，因为大部分数据还是要传输到主机。
            

### 3.5 CSD 的典型应用场景

            
            
            
            
            
            
            
            
            
            场景
            卸载内容
            收益
            落地状态
            
            
            
            
            数据库全表扫描
            WHERE 条件过滤
            减少 PCIe 传输量，降低 CPU 负载
            实验性：Samsung SmartSSD + MySQL 原型
            
            
            透明压缩
            实时压缩 / 解压
            有效容量翻倍，不增加 CPU 开销
            生产可用：ScaleFlux CSD 3000
            
            
            数据加密
            AES-XTS 加密
            线速加密，不消耗主机 CPU
            多数企业级 SSD 已内置（SED）
            
            
            视频分析
            视频帧解码和预处理
            减少主机 GPU/CPU 负载
            概念验证阶段
            
            
            键值存储
            KV 查找和过滤
            降低查找延迟
            研究阶段：开放通道 SSD + KV 引擎
            
            
            
            

### 3.6 CSD 实战：ScaleFlux
            透明压缩

            

ScaleFlux CSD 3000 是目前商用化程度最高的 CSD 之一。它在
            NVMe SSD 内部集成了硬件压缩引擎，对主机呈现为标准 NVMe
            块设备，但内部自动对写入数据做 LZ4 或 zstd 压缩。
            

使用方式对主机完全透明——不需要修改文件系统或应用。查看压缩状态的命令：
            
```
# 查看 ScaleFlux CSD 的压缩统计
sudo sfx-nvme smart-log-add /dev/nvme0n1
```

            

关键指标：
            
```
Physical Capacity Used     : 1.23 TB
Logical Capacity Used      : 3.45 TB
Compression Ratio          : 2.80x
Host Write Commands        : 45,234,567
Actual NAND Writes         : 16,155,202
Write Amplification Factor : 0.99
```

            

这里可以看到：主机逻辑写入了 3.45 TB
            数据，但由于压缩，实际只占用了 1.23 TB 的物理容量。压缩比
            2.80x 意味着一块 4 TB 的 CSD 可以存储约 11 TB
            的可压缩数据。同时，WAF 接近 1.0——因为 CSD
            内部的压缩减少了实际写入 NAND
            的数据量，间接降低了写放大。
            

### 3.7 CSD 的局限

            

CSD 不是万能的，需要清醒认识其局限：
            
            
- **计算能力有限。** CSD 内部的计算引擎（FPGA
            或嵌入式 ARM）算力远不如主机
            CPU。适合做简单的过滤、压缩和模式匹配，不适合复杂的
            JOIN、聚合或机器学习推理。
            
- **编程生态不成熟。**
            除了固定功能（压缩、加密）外，可编程 CSD
            的开发工具链和调试手段都很原始。缺乏标准化的 API
            和运行时环境。
            
- **数据局部性要求。** CSD
            只能处理本设备上的数据。如果计算任务需要跨多个 SSD
            的数据，CSD
            的优势就消失了——数据还是要搬到一个中心节点做处理。
            
- **故障域问题。**
            计算引擎和存储介质耦合在同一个设备中。如果 FPGA 出了
            bug，可能影响数据可靠性。故障隔离比传统架构更困难。
            
            
            

## 四、DPU/SmartNIC：存储路径上的专用处理器

            

### 4.1 什么是 DPU

            

DPU（Data Processing
            Unit，数据处理单元）是一类专门处理数据中心基础设施任务的处理器。它通常包含：
            
            
- 多个 ARM 核心（通常 8-16 个）
            
- 硬件加速引擎（加密、压缩、正则匹配、DMA）
            
- 高速网络接口（100/200/400 Gbps）
            
- PCIe 主机接口
            
- 可选的专用 DRAM
            
            

DPU
            不是通用处理器的替代品，而是基础设施功能的卸载引擎。SmartNIC（智能网卡）是
            DPU 的前身或简化版本，通常侧重于网络功能卸载，而 DPU
            的定位更广，包括存储和安全功能。
            

当前主流 DPU 产品：
            
            
            
            
            
            
            
            
            
            
            产品
            厂商
            ARM 核心
            网络带宽
            存储加速功能
            
            
            
            
            BlueField-2
            NVIDIA
            8x A72
            100 Gbps
            NVMe-oF Target、virtio-blk、SNAP
            
            
            BlueField-3
            NVIDIA
            16x A78
            400 Gbps
            NVMe-oF、GPUDirect Storage
            
            
            Pensando DSC-200
            AMD
            多 P4 核心
            200 Gbps
            NVMe 虚拟化、存储加速
            
            
            IPU E2100
            Intel
            多核心
            200 Gbps
            NVMe 虚拟化
            
            
            
            

### 4.2 DPU
            在存储路径中的角色

            

DPU 在存储路径中承担的角色主要有四个：
            

**NVMe-oF Target 卸载。**
            在存储服务器上，NVMe-oF（NVMe over Fabrics）Target
            的协议处理（RDMA 收包 → NVMe 命令解析 → 本地 SSD I/O →
            响应组装 → RDMA 发包）原本由主机 CPU 完成。DPU 把整个
            NVMe-oF Target 实现移到自己的 ARM 核心和硬件加速引擎上，主机
            CPU 完全不参与存储流量处理。NVIDIA BlueField-2 的 SPDK
            NVMe-oF Target 在 DPU 上运行的性能数据：单个 DPU 可以提供约
            4 M IOPS（4KB 随机读），同时主机 CPU 零开销。
            

**存储虚拟化。** 在云计算场景下，DPU
            可以在硬件层面实现 NVMe 虚拟化——每个虚拟机看到的是一个独立的
            NVMe 设备，但底层是 DPU 通过 SNAP（Software-defined Network
            Accelerated Processing）技术模拟的。与 virtio-blk/vhost
            方案相比，DPU 方案不需要主机 CPU
            参与虚拟化开销，虚拟磁盘的性能更接近物理设备。
            

**数据路径加密和压缩。** DPU
            的硬件加速引擎可以在数据经过网络到达 SSD 之前做线速加密 /
            解密和压缩 / 解压缩，不消耗主机 CPU。
            

**存储安全隔离。** DPU
            作为主机和存储之间的中间层，可以实现存储访问控制、数据加密和审计，而且这些安全功能运行在独立的安全域中，主机操作系统即使被攻破也无法绕过。
            

### 4.3 DPU 卸载 NVMe-oF
            Target 的架构

            

下图展示了有无 DPU 时 NVMe-oF Target 架构的对比：
            
```
传统架构（无 DPU）：                    DPU 架构：

┌──────────────────────┐              ┌──────────────────────┐
│     应用 / 虚拟机     │              │     应用 / 虚拟机     │
├──────────────────────┤              ├──────────────────────┤
│     主机 CPU          │              │     主机 CPU          │
│  ┌────────────────┐  │              │  （不处理存储流量）    │
│  │ NVMe-oF Target │  │              ├──────────────────────┤
│  │ (SPDK / 内核)   │  │              │       PCIe           │
│  └───────┬────────┘  │              ├──────────────────────┤
│          │           │              │       DPU             │
├──────────┼───────────┤              │  ┌────────────────┐  │
│    RDMA NIC          │              │  │ NVMe-oF Target │  │
└──────────┼───────────┘              │  │ (SPDK on ARM)  │  │
           │                          │  └───────┬────────┘  │
      ┌────┴────┐                     │    RDMA  │  NVMe     │
      │ 网络    │                     │  ┌───┴───┴────────┐  │
      └─────────┘                     │  │网络    本地 SSD │  │
                                      └──┴────────────────┘──┘
```

            

在传统架构中，NVMe-oF Target 的每个 I/O 都要经过主机
            CPU：网络收包 → 协议解析 → 本地 SSD 下发 → 等待完成 →
            组装响应 → 网络发包。在高 IOPS 场景下，这可能消耗 4-8 个 CPU
            核心。
            

在 DPU 架构中，整个 NVMe-oF Target 运行在 DPU 的 ARM
            核心上。远端 Initiator 的 I/O 请求从网络到达 DPU，DPU
            直接访问本地 SSD（通过
            PCIe），完成后直接通过网络发送响应。主机 CPU
            不参与任何数据路径操作，释放出来运行应用负载。
            

### 4.4 DPU
            存储虚拟化的性能开销

            

DPU 做存储虚拟化时的核心问题是：相比裸金属直接访问 NVMe
            SSD，DPU 引入的虚拟化开销有多大？
            

下面是 NVIDIA BlueField-2 在 NVMe
            虚拟化场景下的公开性能数据（来自 NVIDIA GTC 2022 演讲和
            BlueField-2 产品白皮书），与传统 virtio-blk/vhost
            方案对比：
            
            
            
            指标
            裸金属 NVMe
            virtio-blk (vhost-user)
            BlueField-2 SNAP
            
            
            
            
            4K 随机读 IOPS
            800K
            550K
            780K
            
            
            4K 随机读延迟（P50）
            85 us
            130 us
            92 us
            
            
            4K 随机读延迟（P99）
            120 us
            280 us
            135 us
            
            
            主机 CPU 开销
            1 核心
            2-3 核心
            接近 0
            
            
            
            

注意：以上数据来自特定测试配置，不同工作负载和设备配置下的结果会有差异。引用数据仅供参考，不代表通用性能预期。
            

关键观察：DPU SNAP 方案的 IOPS 接近裸金属水平（约
            97%），延迟增加约 8-12%，而传统 virtio-blk 方案的 IOPS
            损失约 31%、P99 延迟翻倍。更重要的是 CPU 开销——DPU
            方案把虚拟化开销从主机 CPU 彻底卸载，释放出的 CPU
            核心可以运行更多虚拟机或应用负载。在一台 128
            核的服务器上，如果存储虚拟化原本消耗 8-12 个核心，DPU
            卸载后相当于增加了 6%-9% 的可用计算资源。
            

### 4.5 DPU
            实战：BlueField-2 上运行 NVMe-oF Target

            

BlueField-2 DPU 运行独立的 Linux 操作系统（通常是 Ubuntu
            或 CentOS），可以在其上部署 SPDK NVMe-oF
            Target。以下是基本配置流程：
            
```
# 在 BlueField-2 的 ARM Linux 上配置 SPDK NVMe-oF Target

# 1. 绑定本地 NVMe 设备到用户态驱动
sudo /opt/spdk/scripts/setup.sh

# 2. 启动 SPDK NVMe-oF Target
sudo /opt/spdk/build/bin/nvmf_tgt -m 0xFF &

# 3. 配置 NVMe-oF subsystem
sudo /opt/spdk/scripts/rpc.py nvmf_create_transport -t rdma -u 8192 -i 131072

sudo /opt/spdk/scripts/rpc.py bdev_nvme_attach_controller \
  -b NVMe0 -t PCIe -a 0000:03:00.0

sudo /opt/spdk/scripts/rpc.py nvmf_create_subsystem \
  nqn.2024-01.io.example:cnode1 -a -s SPDK00000001

sudo /opt/spdk/scripts/rpc.py nvmf_subsystem_add_ns \
  nqn.2024-01.io.example:cnode1 NVMe0n1

sudo /opt/spdk/scripts/rpc.py nvmf_subsystem_add_listener \
  nqn.2024-01.io.example:cnode1 -t rdma -a 192.168.1.10 -s 4420
```

            

配置完成后，远端客户端就能通过 RDMA 网络连接到 DPU 上的
            NVMe-oF Target，访问 DPU 下挂的本地 NVMe SSD。整个过程中主机
            CPU 不参与任何存储 I/O 处理。
            

### 4.7 DPU 部署的工程考量

            

DPU
            在存储路径中引入了一个新的故障域和管理域。工程师在部署前需要考虑以下问题：
            

**运维复杂度增加。** DPU
            运行独立的操作系统和软件栈，意味着需要独立的固件升级、安全补丁、监控和日志收集。一台服务器从”一个
            OS”变成”两个 OS”（主机 +
            DPU），运维工作量几乎翻倍。大规模部署时需要自动化的 DPU
            管理平面。
            

**故障定位更困难。** 当存储 I/O
            出现延迟抖动或错误时，需要区分是 SSD 问题、DPU
            问题还是网络问题。传统架构中主机 CPU 处理全部路径，用
            `perf`、`bpftrace`
            等工具可以追踪全链路；DPU
            架构中，数据路径跨越两个独立的处理器，全链路追踪需要跨设备协调。
            

**PCIe 拓扑约束。** DPU 通过 PCIe
            连接到主机和本地 SSD。PCIe Switch 的配置、NUMA 亲和性、PCIe
            带宽分配都影响 DPU 的性能。典型的做法是把 DPU 和它要访问的
            NVMe SSD 放在同一个 PCIe Root Complex 下，避免跨 NUMA 的
            PCIe 流量。
            

**安全边界的定义。** DPU
            作为安全隔离点的前提是：DPU 本身不被攻破。如果 DPU 的 ARM
            Linux 存在漏洞，那么存储路径上的安全保证就失效了。需要对 DPU
            的操作系统做最小化裁剪和安全加固。
            

### 4.8 DPU 与 CSD 的区别

            

DPU 和 CSD 都在数据路径上做计算卸载，但定位不同：
            
            
            
            维度
            CSD
            DPU
            
            
            
            
            位置
            SSD 内部
            主机和网络之间
            
            
            计算目标
            减少 SSD 到主机的数据搬运
            减少主机 CPU 的基础设施开销
            
            
            数据访问范围
            仅本设备数据
            可访问本地 SSD + 网络数据
            
            
            典型功能
            数据过滤、压缩、加密
            NVMe-oF、存储虚拟化、网络处理
            
            
            适用场景
            数据密集型处理（扫描、过滤）
            存储服务化、多租户隔离
            
            
            生态成熟度
            较低（除固定功能外）
            较高（NVIDIA DOCA 生态）
            
            
            
            

两者不是互斥的——在一个存储节点上，可以同时使用 DPU 做
            NVMe-oF Target 卸载和 CSD 做数据内压缩。
            
            

## 五、新硬件对存储软件栈的系统性影响

            

### 5.1 传统存储软件栈的假设

            

传统存储软件栈（从文件系统到块设备层到设备驱动）建立在几个隐含假设上：
            
            
- **存储设备是”哑”块设备。**
            主机写什么，设备存什么。设备不理解数据语义。
            
- **内存层次是两级的。** DRAM + 磁盘 /
            SSD，中间没有其他层次。
            
- **计算和存储是分离的。** 数据必须搬到 CPU
            旁边才能处理。
            
- **设备接口是对称的。**
            读和写的接口一样，都是随机访问。
            
            

新硬件正在逐一打破这些假设。
            

### 5.2 软件栈需要的改变

            

新硬件引入的不只是新的 I/O
            命令，而是对存储软件栈各层次的系统性冲击。传统存储栈假设”设备是哑的、内存是平的、计算在主机”，而新硬件要求存储软件能感知设备能力、内存层次和计算位置。
            

下表总结了各新硬件对存储软件栈不同层次的影响：
            
            
            
            
            
            
            
            
            
            
            软件栈层次
            ZNS SSD 的影响
            CXL 内存的影响
            CSD 的影响
            DPU 的影响
            
            
            
            
            应用层
            无（如果使用 Zoned-aware FS）
            无（透明分层）或需感知 NUMA 拓扑
            需要适配 CSD API 或透明卸载
            无（DPU 对应用透明）
            
            
            文件系统
            需要 Zoned-aware FS（F2FS/Btrfs）或 dm-zoned
            Page Cache 容量和淘汰策略需调整
            文件系统层面变化小
            文件系统可能不在主机运行
            
            
            块设备层
            Zone 管理命令、Write Pointer 追踪、Active Zone 限制
            无直接影响
            新增 Computational Programs 命令
            NVMe 虚拟化影响请求路由
            
            
            设备驱动
            ZNS NVMe 驱动扩展
            CXL 总线驱动、DAX 驱动
            扩展 NVMe 驱动支持 CSD 命令
            DPU 上运行独立驱动栈
            
            
            内存管理
            影响小
            Memory Tiering、NUMA 策略重大调整
            影响小
            DPU 有独立内存管理
            
            
            
            

### 5.3 对存储引擎设计的影响

            

新硬件对存储引擎（数据库、键值存储、对象存储）的设计影响最为深远：
            

**LSM-Tree 与 ZNS 的天然契合。**
            LSM-Tree（Log-Structured
            Merge-Tree）的写入模式是追加写入（Append-Only），Compaction
            过程会产生大量的顺序写入。这和 ZNS 的 Zone
            顺序写入约束完美匹配。RocksDB 社区已经开发了 ZenFS（基于
            RocksDB 的 FileSystem 接口），直接管理 ZNS SSD 的 Zone
            分配，避免了文件系统层的开销。
            

ZenFS 的核心设计思路：
            
            
- 每个 SSTable 文件对应一个或多个 Zone。小文件可以共享
            Zone（通过 Zone Append 写入不同 SSTable 的数据），大文件独占
            Zone。
            
- Compaction 产出新的 SSTable 写入新的 Zone，旧 SSTable
            对应的 Zone 在所有数据失效后被 Reset。
            
- WAL（Write-Ahead Log）使用专门的 Zone，利用 Zone Append
            实现多线程并发写入。
            
            
```
LSM-Tree 在 ZNS 上的数据放置策略：

Level 0（WAL + Memtable Flush）   →  Zone Group A（高频写入，快速 Reset）
Level 1-2（热数据 Compaction）      →  Zone Group B（中频写入）
Level 3+（冷数据 Compaction）       →  Zone Group C（低频写入，Zone 生命周期长）
```

            

每个 Level 的数据写入一组独立的 Zone，Compaction
            完成后整个 Zone Reset，不需要 GC。这种方式把 LSM-Tree 的
            Space Amplification 和 SSD 的 Write Amplification
            同时优化了。
            

在 RocksDB 上使用 ZenFS 的配置示例：
            
```
# 编译 RocksDB 并启用 ZenFS 插件
cd rocksdb
DEBUG_LEVEL=0 ROCKSDB_PLUGINS=zenfs make -j$(nproc) db_bench

# 初始化 ZenFS 在 ZNS SSD 上
./plugin/zenfs/util/zenfs mkfs --zbd=nvme0n1 --aux_path=/tmp/zenfs-aux

# 使用 ZenFS 运行 db_bench
./db_bench --fs_uri=zenfs://dev:nvme0n1 \
  --benchmarks=fillrandom,readrandom \
  --num=10000000 \
  --value_size=1024 \
  --key_size=16
```

            

**Buffer Pool 与 CXL 的分层。** 数据库的
            Buffer Pool 可以利用 CXL 内存做温数据缓存。以 PostgreSQL
            为例，可以把 `shared_buffers`
            分成两部分：热数据页驻留在本地 DRAM，温数据页通过 NUMA-aware
            分配放在 CXL 内存的 NUMA 节点上。页面淘汰策略从”DRAM →
            SSD”变成”DRAM → CXL → SSD”三级淘汰。
            

**存储引擎与 CSD 的协同。**
            如果存储引擎能把过滤条件下推到
            CSD，就可以大幅减少需要读入主机内存的数据量。这和数据库中的”谓词下推”（Predicate
            Pushdown）思想一致，只是下推的目标从分布式计算节点变成了 SSD
            内部的计算引擎。当前的挑战在于：数据库的查询优化器需要感知
            CSD
            的计算能力和成本模型——把什么算子下推、什么算子保留在主机执行，这个决策直接影响查询性能。简单的等值过滤和范围过滤适合下推，而
            JOIN、排序、聚合等复杂算子目前还不适合在 CSD 上执行。
            

### 5.4 全景架构图

            

下面这张图展示了四类新硬件在一个存储节点中的位置和交互关系：
            
```
                    ┌──────────────────────────────────────────────────────────┐
                    │                     存储节点                             │
                    │                                                          │
                    │  ┌─────────────────────────────────────────────────────┐  │
                    │  │                  应用 / 数据库                       │  │
                    │  └───────────────────────┬─────────────────────────────┘  │
                    │                          │                                │
                    │  ┌───────────────────────┼─────────────────────────────┐  │
                    │  │              主机 CPU + 本地 DRAM                    │  │
                    │  │         ┌─────────────┴──────────────┐              │  │
                    │  │         │    文件系统 / 块设备层       │              │  │
                    │  │         └─────────────┬──────────────┘              │  │
                    │  └───────────────────────┼─────────────────────────────┘  │
                    │              ┌───────────┼───────────┐                    │
                    │              │    PCIe / CXL 总线     │                    │
                    │     ┌────────┼────────┬──────────────┼────────┐           │
                    │     │        │        │              │        │           │
                    │  ┌──┴───┐ ┌──┴───┐ ┌──┴──────────┐ ┌┴──────┐ │           │
                    │  │ ZNS  │ │ 传统  │ │ CXL 内存    │ │ DPU   │ │           │
                    │  │ SSD  │ │ SSD  │ │ 扩展器      │ │       │ │           │
                    │  │      │ │      │ │(Type 3)     │ │  ┌──┐ │ │           │
                    │  │      │ │ CSD  │ │             │ │  │NIC│ │ │           │
                    │  │      │ │ 功能 │ │             │ │  └──┘ │ │           │
                    │  └──────┘ └──────┘ └─────────────┘ └──────┘  │           │
                    │                                          │   │           │
                    └──────────────────────────────────────────┼───┘           │
                                                               │               │
                                                          网络 / Fabric         │
                                                               │               │
                                                    ┌──────────┴──────────┐    │
                                                    │   远端存储 / 客户端   │    │
                                                    └─────────────────────┘    │
```

            
            

## 六、工程师视角：哪些技术已可用、哪些仍在观望

            

### 6.1 成熟度评估

            

下表从工程落地的角度评估各新硬件的成熟度：
            
            
            
            
            
            
            
            
            
            
            技术
            硬件可用性
            软件生态成熟度
            生产环境案例
            建议
            
            
            
            
            ZNS SSD
            已有量产产品（WD ZN540、Samsung PM1731a）
            Linux 内核原生支持；F2FS、Btrfs 支持；RocksDB ZenFS
            可用
            云存储后端有限部署
            值得评估：适合自研存储引擎的团队
            
            
            CXL 1.1/2.0 Type 3
            已有量产产品（Samsung CMM-D、Micron CZ120）
            Linux 6.5+ 内核支持；Memory Tiering 基本可用
            数据中心内存扩展场景开始部署
            值得试点：需要 Sapphire Rapids / Genoa 平台
            
            
            CXL 3.0 内存池化
            样品阶段
            软件栈不完善
            无
            观望：等硬件和软件都稳定
            
            
            CSD 固定功能（压缩）
            已有量产产品（ScaleFlux CSD 3000）
            驱动成熟，对主机透明
            有生产环境部署
            可以用：对容量和写放大敏感的场景
            
            
            CSD 可编程
            原型阶段（Samsung SmartSSD）
            工具链不成熟
            无规模化部署
            观望：等编程模型和工具链标准化
            
            
            DPU（BlueField-2/3）
            已有量产产品
            DOCA SDK 可用；SPDK/NVMe-oF 支持成熟
            云厂商大规模部署（存储虚拟化、NVMe-oF）
            可以用：适合存储服务化和多租户场景
            
            
            
            

### 6.2 选型决策树

            

面对这些新硬件，工程师的选型可以从具体痛点出发：
            
```
graph TD
    A[存储系统的痛点是什么?] --> B{写放大 / 尾延迟 / SSD 寿命?}
    A --> C{内存容量不足?}
    A --> D{CPU 被存储流量占满?}
    A --> E{数据搬运浪费带宽?}

    B -->|是| B1[评估 ZNS SSD]
    B1 --> B2{有自研存储引擎?}
    B2 -->|是| B3[直接管理 Zone,
如 RocksDB ZenFS]
    B2 -->|否| B4[使用 F2FS / dm-zoned
降低改造成本]

    C -->|是| C1[评估 CXL Type 3]
    C1 --> C2{CPU 平台支持 CXL?}
    C2 -->|是| C3[部署 CXL 内存扩展器,
启用 Memory Tiering]
    C2 -->|否| C4[升级 CPU 平台后再评估]

    D -->|是| D1[评估 DPU]
    D1 --> D2[卸载 NVMe-oF Target
或存储虚拟化到 DPU]

    E -->|是| E1[评估 CSD]
    E1 --> E2{数据处理逻辑简单?
如压缩/过滤}
    E2 -->|是| E3[使用固定功能 CSD
如 ScaleFlux 透明压缩]
    E2 -->|否| E4[当前可编程 CSD 不成熟,
暂时在主机端处理]
```

            

### 6.3 工程判断与个人观点

            

以下是基于公开技术资料和行业观察的工程判断，不是规范原文：
            

**ZNS SSD 的前景取决于软件生态。** ZNS
            的硬件价值是明确的——降低写放大、减少 OP、消除 GC
            抖动。但它把复杂度从 SSD
            固件转移到了主机软件。如果主机软件栈（文件系统、存储引擎）不能很好地管理
            Zone，ZNS
            的优势无法兑现。目前看，自研存储引擎的团队（如大规模分布式存储的后端团队）更适合采用
            ZNS，因为他们本来就在管理数据放置和垃圾回收；通用工作负载的用户最好等文件系统支持更成熟。此外，NVMe
            2.0 规范中引入的 FDP（Flexible Data Placement）作为 ZNS
            的竞争方案，降低了主机端的管理复杂度，值得关注。
            

**CXL 对存储系统的影响是渐进的。**
            短期内，CXL Type 3
            内存扩展器的价值在于扩大单机内存容量，对大内存需求的应用（内存数据库、缓存服务）有直接收益。但真正有变革意义的是
            CXL 3.0
            的内存池化——它将彻底改变内存容量规划和缓存策略。在池化成熟之前，CXL
            内存扩展器可以看作”更大但稍慢的
            DRAM”，不需要对存储架构做根本性改动。
            

**DPU 在云计算场景已经证明了价值。**
            云厂商（AWS 的 Nitro、阿里云的 MOC、字节跳动的 DPU
            方案）已经大规模使用 DPU/SmartNIC
            做存储虚拟化和网络虚拟化。对于自建存储基础设施的团队，DPU
            的价值取决于存储流量对主机 CPU 的占比——如果存储服务的 CPU
            开销已经超过 30%，DPU 卸载就有明确的 ROI。
            

**CSD 的大规模应用需要等标准化。**
            固定功能的 CSD（如透明压缩）已经可用且有价值。但可编程 CSD
            的生态距离生产级别还有差距——缺乏统一的编程模型、缺乏调试工具、缺乏性能可预测性保证。SNIA
            和 NVMe 组织正在推进标准化，但完成时间不确定。
            
            

## 七、结论

            

### 7.1 核心判断

            

ZNS SSD、CXL、CSD 和 DPU
            这四类新硬件正在改变存储系统的基本假设。ZNS
            把闪存管理权从固件交给主机软件，用软件复杂度换取硬件效率；CXL
            在 DRAM 和 SSD
            之间插入一个新的内存层次，打破了两级缓存的传统模型；CSD
            把简单的计算推到数据旁边，减少不必要的数据搬运；DPU
            把基础设施功能从主机 CPU
            卸载到专用处理器，释放算力给应用。
            

这些硬件对存储软件栈的要求是：文件系统要理解 Zone
            约束、内存管理要支持多层次分级、块设备层要传递计算语义、存储引擎要感知硬件能力的差异。工程师不需要全部采用这些新硬件，但需要理解它们各自解决的问题和引入的约束——当具体痛点出现时，就知道该评估哪类方案。
            

### 7.2 落地节奏

            

从落地节奏上看，DPU 和固定功能 CSD
            已经经过了大规模验证，可以在生产环境中使用；ZNS SSD 和 CXL
            Type 3 适合有自研能力的团队试点评估；CXL 3.0
            内存池化和可编程 CSD
            仍处于早期阶段，适合保持关注但暂不投入。
            

### 7.3 给工程师的具体建议

            
            
- **不要追新硬件本身，追它解决的问题。**
            如果你的存储系统没有 GC 抖动问题，ZNS SSD
            对你的价值有限。如果主机 CPU 没有被存储流量占满，DPU 的 ROI
            不明显。从痛点出发，而不是从技术出发。
            
- **关注接口层面的变化。**
            新硬件最终会通过内核接口和用户态库暴露给应用。与其深入研究每种硬件的内部实现，不如关注
            NVMe ZNS 命令集、CXL NUMA 拓扑、SPDK 的 ZNS / CSD
            支持这些接口层面的变化。接口稳定后，底层硬件的迭代对上层应用是透明的。
            
- **为存储软件的可插拔性做准备。**
            设计存储引擎时，把存储设备的接口抽象出来（块接口 vs Zone
            接口 vs KV
            接口），让上层逻辑不直接依赖具体的设备类型。这样新硬件到来时，只需要实现一个新的后端适配层，而不需要重写核心逻辑。
            
- **持续跟踪 Linux 内核的相关子系统。** CXL
            子系统、Memory Tiering、ZBD
            框架都在快速迭代中。每个内核大版本的 release notes 中关于
            CXL 和 NVMe 的变更值得关注。
            
            
            

## 参考资料

            

### 规范与标准

            
            
- NVMe 2.0 Specification, NVM Express, Inc.——ZNS
            相关章节（Zoned Namespace Command Set）
            
- NVMe Zoned Namespace Technical Proposal (TP 4053)
            
- CXL Specification 3.1, CXL Consortium——CXL.mem、Type 3
            设备、Memory Pooling 章节
            
- SNIA Computational Storage Architecture and Programming
            Model, v1.0
            
            

### 源码

            
            
- Linux Kernel 6.1,
            `drivers/nvme/host/zns.c`——ZNS NVMe 驱动
            
- Linux Kernel 6.5, `drivers/cxl/`——CXL
            子系统
            
- Linux Kernel 6.1, `mm/memory-tiers.c`——Memory
            Tiering 框架
            
- F2FS, `fs/f2fs/segment.c`——Zone
            分配与管理
            
- RocksDB ZenFS Plugin, `plugin/zenfs/`——ZNS
            SSD 上的 RocksDB FileSystem 实现
            
            

### 产品与文档

            
            
- Western Digital Ultrastar DC ZN540 ZNS SSD Data
            Sheet
            
- Samsung CMM-D CXL Memory Module 产品文档
            
- ScaleFlux CSD 3000 Data Sheet 和 Administration
            Guide
            
- NVIDIA BlueField-2 DPU Data Sheet 和 DOCA SDK
            Documentation
            
- Micron CZ120 CXL Memory 产品文档
            
            

### 论文与演讲

            
            
- Bjørling, M. et al., “ZNS: Avoiding the Block Interface
            Tax for Flash-based SSDs”, USENIX ATC 2021
            
- Gouk, D. et al., “Direct Access, High-Performance Memory
            Disaggregation with DirectCXL”, USENIX ATC 2022
            
- Samsung, “SmartSSD Computational Storage Drive”, Flash
            Memory Summit 2020
            
- NVIDIA, “BlueField DPU Architecture and SNAP”, GTC
            2022
            
            
            

**上一篇：**【存储工程】计算存储分离实践
            

**下一篇：**【存储工程】存储技术展望
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-04-13 · distributed
                    

### 【分布式系统百科】新硬件对分布式系统的冲击

                    

一个 RPC 调用耗时 500 微秒，其中网络往返占了 490 微秒。一次分布式事务需要两轮 RPC，总耗时超过 1 毫秒。为了掩盖这个延迟，工程师不得不引入批处理、异步流水线、预取缓存——系统复杂度因此翻了好几倍。过去三十年，几乎所有分布式系统的设计都建立在一个核心假设之上：网络比本地内存慢三到四个数量级。Share…
                

                
                    

2025-08-08 · network
                    

### 【网络工程】网络技术展望：SmartNIC、CXL 与内核旁路的未来

                    

网络工程正处于一个技术变革的交汇点——SmartNIC/DPU 将网络处理从主机 CPU 卸载到专用硬件，CXL 打破了服务器内存的物理边界，io_uring 正在重塑内核态网络 I/O，而 Kernel Bypass 技术在追求极致性能的同时也在寻找与内核生态的平衡。本文系统分析这些趋势的技术本质、工程影响和演进方向。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。