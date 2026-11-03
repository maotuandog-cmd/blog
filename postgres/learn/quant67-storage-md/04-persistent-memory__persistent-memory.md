# 【存储工程】持久化内存与存储层次

来源: https://quant67.com/post/storage/04-persistent-memory/persistent-memory.html
日期: 2025-08-13 |

---

# 持久化内存与存储层次

            

现代计算系统的性能瓶颈，往往不在处理器本身，而在数据的存取速度。从寄存器（Register）到磁带（Tape），存储层次结构跨越了十余个数量级的延迟差异。持久化内存（Persistent
            Memory，简称
            PMem）的出现，试图在易失性内存与持久化存储之间架起一座桥梁，从根本上改变应用程序访问数据的方式。
            

本文将系统性地梳理存储层次结构的全貌，深入分析持久化内存的技术原理与工程实践，涵盖英特尔傲腾（Intel
            Optane）的运行模式、直接访问（DAX）文件系统、持久化内存开发套件（PMDK）的编程范式，以及数据库领域对
            PMem 的实际应用。最后，我们将讨论 Optane
            产品线终结后，计算快速链路（CXL）技术如何接棒，以及存储延迟的实测方法论。
            
            

## 一、存储层次结构

            

### 1.1 层次概览

            

计算机系统中的存储层次结构是一个经典的金字塔模型。自顶向下，容量递增、速度递减、单位成本递降。理解这一层次结构，是讨论持久化内存技术的前提。
            

完整的存储层次如下：
            
            
- 中央处理器寄存器（CPU Register）
            
- 一级缓存（L1 Cache）
            
- 二级缓存（L2 Cache）
            
- 三级缓存（L3 Cache）
            
- 动态随机存取存储器（DRAM）
            
- 持久化内存（PMem）
            
- 固态硬盘（SSD）
            
- 机械硬盘（HDD）
            
- 磁带（Tape）
            
            

### 1.2 各层级延迟分析

            

延迟是衡量存储层次性能的最直观指标。以下数据基于典型的服务器级硬件，反映的是随机访问延迟的数量级：
            
            
- **CPU 寄存器**：约 0.3
            纳秒（ns），与处理器时钟周期同步，是最快的存储单元。
            
- **L1 缓存**：约 1 ns，通常为 32 KB 至 64
            KB，分为数据缓存和指令缓存。
            
- **L2 缓存**：约 3-4 ns，典型容量为 256 KB
            至 1 MB，每个核心独享。
            
- **L3 缓存**：约 10-12 ns，容量从数 MB
            到数十 MB 不等，多核共享。
            
- **DRAM**：约 50-100 ns，典型的 DDR4/DDR5
            内存模块。
            
- **PMem（Optane）**：约 170-350
            ns，读延迟高于 DRAM 约 2-3 倍。
            
- **NVMe 固态硬盘（NVMe SSD）**：约 10-100
            微秒（μs），即 10000-100000 ns。
            
- **SATA 固态硬盘（SATA SSD）**：约 50-150
            μs。
            
- **机械硬盘**：约 3-10 毫秒（ms），即
            3000000-10000000 ns。
            
- **磁带**：约数秒至数十秒，需要物理定位。
            
            

### 1.3 各层级带宽分析

            

带宽（Bandwidth）决定了单位时间内能传输的数据量。以下为典型值：
            
            
- **CPU
            寄存器**：理论上无限制，与处理器内部数据通路同宽。
            
- **L1 缓存**：约 1-2
            TB/s，取决于处理器微架构。
            
- **L2 缓存**：约 500 GB/s 至 1 TB/s。
            
- **L3 缓存**：约 200-400 GB/s。
            
- **DRAM（DDR4-3200）**：单通道约 25
            GB/s，八通道服务器约 200 GB/s。
            
- **PMem（Optane，App Direct 模式）**：单条约
            6-8 GB/s 读带宽，写带宽约为读的 1/3 至 1/4。
            
- **NVMe SSD**：约 3-7 GB/s（PCIe 4.0
            x4）。
            
- **SATA SSD**：约 500-560 MB/s。
            
- **HDD（7200 RPM）**：约 100-200 MB/s
            顺序读写。
            
- **磁带（LTO-9）**：约 400 MB/s
            顺序读写。
            
            

### 1.4 各层级成本分析

            

存储成本是系统架构设计中不可忽视的因素。以下为 2023
            年左右的市场价格估算（单位：美元/GB）：
            
            
- **SRAM（缓存）**：约 500-1000
            美元/GB，极其昂贵，仅用于处理器片上缓存。
            
- **DRAM（DDR4）**：约 3-5 美元/GB。
            
- **PMem（Optane 200 系列）**：约 2-4
            美元/GB，略低于 DRAM。
            
- **NVMe SSD（企业级）**：约 0.1-0.3
            美元/GB。
            
- **SATA SSD（消费级）**：约 0.05-0.1
            美元/GB。
            
- **HDD（企业级）**：约 0.015-0.03
            美元/GB。
            
- **磁带（LTO-9）**：约 0.004-0.008
            美元/GB。
            
            

### 1.5 综合对比表

            

以下表格汇总了各存储层级的关键特性：
            
            
            
            
            
            
            
            
            
            
            
            
            存储层级
            典型延迟
            典型带宽
            成本（美元/GB）
            易失性
            可字节寻址
            典型容量
            
            
            
            
            CPU 寄存器
            0.3 ns
            —
            —
            是
            是
            数 KB
            
            
            L1 缓存
            1 ns
            1-2 TB/s
            ~1000
            是
            是
            32-64 KB
            
            
            L2 缓存
            3-4 ns
            500 GB/s-1 TB/s
            ~1000
            是
            是
            256 KB-1 MB
            
            
            L3 缓存
            10-12 ns
            200-400 GB/s
            ~500
            是
            是
            8-64 MB
            
            
            DRAM
            50-100 ns
            25-200 GB/s
            3-5
            是
            是
            16-512 GB
            
            
            PMem
            170-350 ns
            6-40 GB/s
            2-4
            否
            是
            128-512 GB
            
            
            NVMe SSD
            10-100 μs
            3-7 GB/s
            0.1-0.3
            否
            否
            0.5-30 TB
            
            
            SATA SSD
            50-150 μs
            500-560 MB/s
            0.05-0.1
            否
            否
            0.25-8 TB
            
            
            HDD
            3-10 ms
            100-200 MB/s
            0.015-0.03
            否
            否
            1-20 TB
            
            
            磁带
            秒级
            400 MB/s
            0.004-0.008
            否
            否
            18-45 TB
            
            
            
            

### 1.6 内存-存储鸿沟问题

            

在传统的存储层次结构中，DRAM 与 SSD
            之间存在着巨大的延迟鸿沟——从约 100 ns 直接跳跃到约 10
            μs，相差两个数量级。这一鸿沟被称为”内存-存储鸿沟”（Memory-Storage
            Gap）。
            

这个鸿沟带来了深远的工程影响：
            

**对数据库系统的影响**：传统关系型数据库不得不维护复杂的缓冲池（Buffer
            Pool）管理机制，通过 LRU 等页面置换算法，尽量让热数据驻留在
            DRAM 中，以避免昂贵的磁盘 I/O。
            

**对应用程序的影响**：应用程序必须显式地区分”内存中的数据”和”磁盘上的数据”，使用不同的
            API
            进行访问。内存中的数据通过指针直接访问，磁盘上的数据则需要通过文件系统接口进行
            I/O 操作。
            

**对系统架构的影响**：为了弥补这一鸿沟，工程师们发明了各种缓存层级、预取策略和异步
            I/O
            机制。这些方案增加了系统的复杂性，但并未从根本上消除延迟差异。
            

持久化内存的出现，正是为了填补这一鸿沟。PMem 的延迟约为
            170-350 ns，介于 DRAM 和 SSD
            之间，且支持字节寻址（Byte-Addressable），使得应用程序可以像访问内存一样访问持久化数据。
            
```
延迟频谱示意图：

寄存器  L1   L2    L3     DRAM      PMem        NVMe SSD       HDD        磁带
  |      |    |     |       |          |            |             |           |
  0.3ns  1ns  4ns   12ns   100ns     300ns       10-100μs      3-10ms     秒级
  |______|____|_____|_______|__________|____________|_____________|___________|
                                   ^
                              PMem 填补此处的鸿沟
```

            
            

## 二、持久化内存技术

            

### 2.1
            英特尔傲腾与三维交叉点技术

            

英特尔傲腾（Intel
            Optane）是迄今为止最成功的持久化内存产品，其底层技术为三维交叉点（3D
            XPoint，读作”3D Cross
            Point”）。这是英特尔与美光科技（Micron）于 2015
            年联合发布的非易失性存储介质技术。
            

三维交叉点的工作原理基于相变存储（Phase Change
            Memory，PCM）的变体：
            

**存储单元结构**：3D XPoint
            的存储阵列由三层主要结构组成——选择器层（Selector
            Layer）、存储材料层（Storage Material
            Layer）和金属互连线（Metal
            Interconnect）。选择器用于控制对单个存储单元的访问，取代了传统闪存（NAND
            Flash）中的晶体管。
            

**相变原理**：存储材料在施加不同电压脉冲时，可以在晶态（Crystalline）和非晶态（Amorphous）之间切换。晶态具有较低的电阻，代表逻辑”1”；非晶态具有较高的电阻，代表逻辑”0”。通过检测电阻值即可读取存储的数据。
            

**三维堆叠**：与 3D NAND 类似，3D XPoint
            通过垂直堆叠多层存储单元来提高存储密度。初代产品为两层堆叠，后续代次可以增加层数。
            

**无需晶体管**：与 DRAM 和 NAND Flash
            不同，3D XPoint
            的每个存储单元不需要配备专用的晶体管（Transistor）。这种”交叉点”架构使得存储阵列的密度更高，每单位面积可以容纳更多的存储单元。
            

**位可变性**：与 NAND Flash 的块擦除（Block
            Erase）不同，3D XPoint
            支持按位（Bit-Alterable）写入。这意味着可以直接覆写已有数据，而无需先擦除整个块。这一特性使得
            3D XPoint 的写入延迟远低于 NAND Flash。
            

### 2.2 Optane PMem 产品线

            

英特尔推出了三代 Optane 持久化内存产品：
            

**第一代：Optane PMem 100 系列（代号 Apache
            Pass）**
            
            
- 发布时间：2019 年，配合第二代至强可扩展处理器（Cascade
            Lake）。
            
- 接口：DDR-T，通过 DDR4 内存插槽连接。
            
- 容量：128 GB、256 GB、512 GB 三种规格。
            
- 控制器：集成在内存控制器中，由处理器直接管理。
            
- 特点：首次实现了大容量、可字节寻址的持久化内存。
            
            

**第二代：Optane PMem 200 系列（代号 Barlow
            Pass）**
            
            
- 发布时间：2021 年，配合第三代至强可扩展处理器（Ice
            Lake-SP）。
            
- 接口：DDR-T，通过 DDR4 内存插槽连接。
            
- 容量：128 GB、256 GB、512 GB。
            
- 改进：读写延迟降低约 10-15%，带宽提升约 20%。
            
- 安全性：增加了 AES-XTS 256 位硬件加密。
            
            

**第三代：Optane PMem 300 系列（代号 Crow
            Pass）**
            
            
- 原计划配合第四代至强可扩展处理器（Sapphire
            Rapids）。
            
- 接口：DDR5-T。
            
- 状态：由于英特尔在 2022 年宣布终止 Optane
            业务，该产品未正式量产。
            
            

### 2.3 其他持久化内存技术

            

除了 3D XPoint，业界还存在多种持久化内存技术路线：
            

**自旋转移矩磁性随机存取存储器（STT-MRAM）**
            

STT-MRAM（Spin-Transfer Torque Magnetoresistive
            RAM）利用磁性隧道结（Magnetic Tunnel
            Junction，MTJ）来存储数据。通过施加自旋极化电流改变自由层的磁化方向，实现数据的写入。
            
            
- 优势：写入耐久性极高（>10^15 次），读延迟接近 SRAM
            水平（约 2-5 ns）。
            
- 劣势：存储密度有限，目前主要用于嵌入式缓存和小容量应用。
            
- 典型应用：嵌入式非易失性存储器（eNVM），用于微控制器（MCU）和物联网（IoT）设备。
            
            

**阻变式随机存取存储器（ReRAM）**
            

ReRAM（Resistive
            RAM）基于金属氧化物薄膜的电阻切换效应。通过施加电压形成或断开导电细丝（Conductive
            Filament），在高阻态和低阻态之间切换。
            
            
- 优势：制造工艺简单，可与标准互补金属氧化物半导体（CMOS）工艺集成。
            
- 劣势：阻态一致性和耐久性仍需改进。
            
- 代表厂商：美光、新忆（Weebit Nano）等。
            
            

**相变存储器（PCM）**
            

PCM（Phase Change Memory）是 3D XPoint 的理论基础。传统
            PCM 使用硫属化合物（Chalcogenide）材料（如 Ge2Sb2Te5，简称
            GST），通过快速加热和冷却实现晶态与非晶态之间的切换。
            
            
- 优势：技术成熟度较高，已有商业化产品。
            
- 劣势：写入能耗较高，写入耐久性约 10^8 至 10^9 次。
            
            

### 2.4 PMem 与 DRAM 及
            SSD 的特性对比

            
            
            
            特性
            DRAM
            PMem（Optane）
            NVMe SSD
            
            
            
            
            读延迟
            50-100 ns
            170-350 ns
            10-100 μs
            
            
            写延迟
            50-100 ns
            100-500 ns
            10-20 μs
            
            
            读带宽（单条）
            25 GB/s
            6-8 GB/s
            3-7 GB/s
            
            
            写带宽（单条）
            25 GB/s
            1.5-2.3 GB/s
            1-5 GB/s
            
            
            字节寻址
            是
            是
            否（块设备）
            
            
            持久性
            否（易失）
            是（非易失）
            是（非易失）
            
            
            写入耐久性
            无限制
            ~10^9 次/单元
            ~103-105 次/单元
            
            
            单条容量
            8-64 GB
            128-512 GB
            0.5-30 TB
            
            
            接口
            DDR4/DDR5
            DDR-T（内存总线）
            PCIe/NVMe
            
            
            成本（美元/GB）
            3-5
            2-4
            0.1-0.3
            
            
            访问粒度
            64 字节（缓存行）
            256 字节（内部）
            512 字节-4 KB
            
            
            
            

需要特别关注的是 PMem 的内部访问粒度（Internal
            Granularity）。虽然 PMem
            对外呈现字节寻址能力，但其内部介质的最小访问单元为 256
            字节（称为 XPLine）。当应用程序的访问模式小于 256
            字节时，仍然会读取或写入整个 256
            字节块，导致读写放大（Read/Write Amplification）。
            
            

## 三、Optane PMem
            运行模式

            

### 3.1 内存模式（Memory
            Mode）

            

内存模式（Memory Mode）是 Optane PMem
            最简单的使用方式。在这种模式下：
            
            
- **PMem 作为主内存**：操作系统和应用程序将
            PMem 视为普通的易失性主内存（Main Memory）。
            
- **DRAM 作为缓存**：系统中的 DRAM 被自动用作
            PMem 的直接映射缓存（Direct-Mapped
            Cache），由内存控制器透明管理。
            
- **无需修改应用**：应用程序无需任何修改即可利用
            PMem 提供的大容量内存。
            
- **数据不持久**：尽管 PMem
            本身是非易失性的，但在内存模式下，数据不保证持久性，因为内存控制器的元数据管理方式不支持断电恢复。
            
            

**优势**：
            
            
- 以相对较低的成本获得大容量内存。例如，一台双路服务器可以配置
            6 TB 的 PMem（12 条 512 GB），而纯 DRAM
            方案在相同插槽数下最多只能达到 768 GB（12 条 64 GB）。
            
- 对应用程序完全透明，无需修改代码。
            
            

**劣势**：
            
            
- 缓存命中率（Cache Hit Rate）直接决定性能。当 DRAM
            缓存命中时，延迟接近纯 DRAM；缓存未命中时，延迟为 PMem
            的延迟（约 300 ns）。
            
- DRAM 缓存采用直接映射策略，冲突失效率较高。
            
- 写带宽受限于 PMem 的写入速度。
            
- 丧失了 PMem 的持久化能力。
            
            

**典型使用场景**：
            
            
- 内存数据库（如 SAP
            HANA）需要超大内存容量来存放整个数据库。
            
- 大数据分析（如 Apache
            Spark）处理超大数据集时需要更多内存。
            
- 虚拟化环境中需要为大量虚拟机分配更多内存。
            
            

### 3.2 应用直接模式（App
            Direct Mode）

            

应用直接模式（App Direct Mode）充分发挥了 PMem
            的持久化特性。在这种模式下：
            
            
- **PMem 作为持久化存储**：PMem
            被映射为独立的持久化存储设备，操作系统可以在其上创建文件系统。
            
- **DRAM 仍作为主内存**：DRAM
            保留其作为传统主内存的角色。
            
- **字节寻址访问**：通过 DAX
            文件系统，应用程序可以使用 mmap 直接将 PMem
            映射到用户态地址空间，实现字节级别的直接访问。
            
- **数据持久化**：写入 PMem
            的数据在断电后依然保留。
            
            

**优势**：
            
            
- 充分利用 PMem 的持久化能力和字节寻址特性。
            
- 应用程序可以实现极低延迟的持久化数据访问。
            
- 通过 DAX 文件系统绕过页面缓存（Page
            Cache），避免了双重缓存。
            
            

**劣势**：
            
            
- 需要修改应用程序以利用 PMem 的特性。
            
- 需要处理崩溃一致性（Crash Consistency）问题。
            
- 编程模型比传统的文件 I/O 更复杂。
            
            

### 3.3 混合模式（Mixed Mode）

            

混合模式允许将 PMem
            的容量分配给内存模式和应用直接模式两种用途。例如，可以将 50%
            的 PMem 容量用于内存模式（扩展主内存），另外 50%
            用于应用直接模式（持久化存储）。
            

这种模式在实践中较少使用，因为它增加了配置和管理的复杂性。
            

### 3.4 使用 ipmctl 进行配置

            

英特尔持久化内存控制工具（Intel Persistent Memory Control
            Tool，简称 ipmctl）是管理 Optane PMem 的命令行工具。
            

**查看 PMem 设备信息**：
            
```
# 显示所有已安装的 PMem 设备
ipmctl show -dimm

# 显示详细的设备信息
ipmctl show -dimm -all

# 显示设备固件版本
ipmctl show -dimm -firmware
```

            

**查看当前内存模式配置**：
            
```
# 显示内存分配的百分比
ipmctl show -memoryresources

# 显示当前的区域配置
ipmctl show -region
```

            

**配置为内存模式**：
            
```
# 创建内存模式配置（100% 内存模式）
# 注意：此操作需要重启生效，且会清除 PMem 上的所有数据
ipmctl create -goal MemoryMode=100

# 查看待生效的配置
ipmctl show -goal

# 重启系统使配置生效
systemctl reboot
```

            

**配置为应用直接模式**：
            
```
# 创建应用直接模式配置（100% 应用直接模式）
ipmctl create -goal PersistentMemoryType=AppDirect

# 创建交错（Interleaved）的应用直接模式
# 交错模式可以提高带宽，但所有 PMem 必须大小一致
ipmctl create -goal PersistentMemoryType=AppDirectInterleaved

# 重启系统使配置生效
systemctl reboot
```

            

**配置为混合模式**：
            
```
# 分配 25% 给内存模式，75% 给应用直接模式
ipmctl create -goal MemoryMode=25 PersistentMemoryType=AppDirect

# 重启后查看配置是否生效
ipmctl show -memoryresources
```

            

**重启后配置命名空间（Namespace）**：
            
```
# 使用 ndctl 工具创建命名空间
# fsdax 模式支持 DAX 文件系统
ndctl create-namespace --mode=fsdax --region=region0

# devdax 模式允许应用程序直接通过设备文件访问 PMem
ndctl create-namespace --mode=devdax --region=region0

# 查看已创建的命名空间
ndctl list -N
```

            

### 3.5 各模式适用场景总结

            
            
            
            
            
            
            
            
            
            
            运行模式
            数据持久性
            应用透明性
            容量利用
            典型场景
            
            
            
            
            内存模式
            否
            完全透明
            PMem 全部用作内存
            内存数据库、大数据分析
            
            
            应用直接模式
            是
            需修改应用
            PMem 全部用作存储
            高性能持久化存储
            
            
            混合模式
            部分是
            部分透明
            按比例分配
            特殊需求场景
            
            
            
            
            

## 四、DAX（Direct
            Access）文件系统

            

### 4.1 DAX 的含义与原理

            

DAX（Direct Access）是 Linux
            内核提供的一种文件系统访问模式，允许应用程序通过内存映射（Memory-Mapped
            I/O）直接访问持久化内存，绕过传统的页面缓存（Page
            Cache）机制。
            

在传统的文件 I/O 路径中，数据流经以下步骤：
            
```
传统 I/O 路径：
应用程序 → 系统调用（read/write） → 虚拟文件系统（VFS） → 页面缓存 → 文件系统 → 块设备驱动 → 存储设备

DAX I/O 路径：
应用程序 → mmap → 页表映射 → 直接访问 PMem 物理地址
```

            

DAX 的核心思想是：既然 PMem
            本身就是字节可寻址的，且挂载在内存总线上，那么就没有必要再经过页面缓存和块设备驱动层。应用程序通过
            mmap 系统调用将 PMem
            上的文件直接映射到进程地址空间，后续的读写操作直接通过
            load/store 指令完成，无需任何系统调用。
            

### 4.2 ext4-dax 和 XFS-dax
            配置

            

Linux 内核从 4.0 版本开始支持 DAX。主流的 ext4 和 XFS
            文件系统均已支持 DAX 模式。
            

**创建 ext4-dax 文件系统**：
            
```
# 假设 PMem 设备为 /dev/pmem0（fsdax 模式的命名空间）
# 格式化为 ext4 文件系统
mkfs.ext4 /dev/pmem0

# 以 DAX 模式挂载
mount -o dax /dev/pmem0 /mnt/pmem

# 验证 DAX 模式是否生效
mount | grep pmem
# 输出应包含 "dax" 选项
```

            

**创建 XFS-dax 文件系统**：
            
```
# 格式化为 XFS 文件系统
# 注意：XFS 的 reflink 特性与 DAX 不兼容，需要禁用
mkfs.xfs -m reflink=0 /dev/pmem0

# 以 DAX 模式挂载
mount -o dax /dev/pmem0 /mnt/pmem

# 验证挂载状态
xfs_info /mnt/pmem
```

            

**持久化挂载配置**：
            
```
# 在 /etc/fstab 中添加 PMem 挂载项
# 格式：设备 挂载点 文件系统类型 挂载选项 dump fsck
echo '/dev/pmem0 /mnt/pmem ext4 dax,defaults 0 0' >> /etc/fstab
```

            

**Linux 5.10 以后的细粒度 DAX 控制**：
            

从 Linux 5.10 开始，DAX
            支持按文件和按目录的细粒度控制，不再仅限于整个文件系统级别：
            
```
# 挂载时不使用全局 dax 选项
mount /dev/pmem0 /mnt/pmem

# 对特定目录启用 DAX
xfs_io -c 'chattr +x' /mnt/pmem/hot_data/

# 对特定文件启用 DAX
xfs_io -c 'chattr +x' /mnt/pmem/critical_log.dat
```

            

### 4.3 DAX 编程——mmap
            与数据持久化

            

使用 DAX
            文件系统编程的关键在于正确处理数据的持久化。当应用程序通过
            mmap 映射 PMem 文件后，写入操作首先进入处理器的缓存行（Cache
            Line），并不会立即持久化到 PMem
            介质。必须使用特定的缓存刷新指令将数据从缓存写回 PMem。
            

以下为核心编程模式：
            
```
#include 
#include 
#include 
#include 
#include 
#include 
#include 
#include   /* 用于缓存刷新指令 */

#define PMEM_FILE "/mnt/pmem/mydata.dat"
#define PMEM_SIZE (1024 * 1024)  /* 1 MB */

/* 将缓存行刷新到持久化介质 */
static inline void pmem_persist(const void *addr, size_t len)
{
    const char *p;
    /* 按 64 字节（缓存行大小）对齐，逐行刷新 */
    for (p = (const char *)((unsigned long)addr & ~0x3fUL);
         p 
            

### 4.4 SNIA
            持久化内存编程模型

            

存储网络工业协会（Storage Networking Industry
            Association，SNIA）定义了持久化内存的标准编程模型（NVM
            Programming
            Model），为软件开发者提供了统一的编程接口规范。
            

该模型定义了四种访问持久化内存的方式：
            
            
- 

**块存储接口**（Block Storage）：将 PMem
            作为传统块设备使用，通过标准 I/O
            接口访问。兼容性最好，但无法利用 PMem
            的字节寻址能力。
            
- 

**文件系统 DAX**（Filesystem
            DAX）：通过支持 DAX 的文件系统，使用 mmap 直接映射
            PMem。这是最常用的编程模式，兼顾了文件系统的管理能力和 PMem
            的直接访问性能。
            
- 

**设备 DAX**（Device
            DAX）：绕过文件系统，通过设备文件（如
            /dev/dax0.0）直接映射整个 PMem
            命名空间。提供最高性能，但失去了文件系统的管理功能。
            
- 

**远程持久化内存**（Remote
            PMem）：通过远程直接内存访问（RDMA）技术，跨网络访问远端节点的
            PMem。
            
            
```
SNIA NVM 编程模型层次：

┌─────────────────────────────────────────────────────┐
│                   应用程序                           │
├──────────┬───────────┬──────────┬───────────────────┤
│ 标准文件  │ 内存映射   │ 设备 DAX  │ RDMA             │
│ I/O API  │ I/O API   │ API      │ API              │
├──────────┼───────────┼──────────┼───────────────────┤
│          │ DAX 文件   │          │                   │
│ 文件系统  │ 系统      │ 设备驱动  │ 网络栈/RDMA 驱动   │
├──────────┴───────────┴──────────┴───────────────────┤
│                 持久化内存硬件                        │
└─────────────────────────────────────────────────────┘
```

            
            

## 五、PMDK（Persistent
            Memory Development Kit）

            

### 5.1 PMDK 概述

            

持久化内存开发套件（Persistent Memory Development
            Kit，PMDK）是英特尔开发的开源库集合，旨在简化持久化内存的应用程序开发。PMDK
            封装了底层的缓存刷新指令和原子性保证，为开发者提供了高层次的编程接口。
            

PMDK 的主要组件包括：
            
            
- **libpmem**：底层持久化内存操作库，提供优化的内存拷贝和持久化原语。
            
- **libpmemobj**：事务性对象存储库，提供类型安全的持久化对象管理。
            
- **libpmemblk**：固定大小块的原子更新库。
            
- **libpmemlog**：追加式日志库，适用于日志写入场景。
            
- **libpmemkv**：键值存储引擎库。
            
- **pmempool**：池（Pool）管理工具，用于创建、检查和修复
            PMem 上的数据池。
            
            

### 5.2
            libpmem——底层持久化内存操作

            

libpmem 是 PMDK
            中最基础的库，提供了与平台无关的持久化内存操作接口。它会根据当前硬件平台自动选择最优的缓存刷新指令。
            
```
#include 
#include 
#include 
- 

#define PMEM_FILE "/mnt/pmem/libpmem_example.dat"
#define PMEM_SIZE (4 * 1024 * 1024)  /* 4 MB */

int main(void)
{
    char *pmem_addr;
    size_t mapped_len;
    int is_pmem;
    const char *data = "使用 libpmem 写入持久化内存";

    /* 映射 PMem 文件 */
    pmem_addr = (char *)pmem_map_file(PMEM_FILE, PMEM_SIZE,
                                       PMEM_FILE_CREATE,
                                       0666, &mapped_len, &is_pmem);
    if (pmem_addr == NULL) {
        perror("pmem_map_file");
        return 1;
    }

    printf("映射地址: %p, 映射大小: %zu, 是否为 PMem: %d\n",
           pmem_addr, mapped_len, is_pmem);

    if (is_pmem) {
        /* 如果是真正的 PMem，使用优化的持久化拷贝 */
        pmem_memcpy_persist(pmem_addr, data, strlen(data) + 1);
    } else {
        /* 如果不是 PMem（如模拟环境），使用普通拷贝加 msync */
        memcpy(pmem_addr, data, strlen(data) + 1);
        pmem_msync(pmem_addr, strlen(data) + 1);
    }

    printf("已持久化的数据: %s\n", pmem_addr);

    /* 解除映射 */
    pmem_unmap(pmem_addr, mapped_len);
    return 0;
}
```

            

编译命令：
            
```
gcc -o pmem_example pmem_example.c -lpmem
```

            

### 5.3
            libpmemobj——事务性对象存储

            

libpmemobj 是 PMDK 中功能最丰富的库，提供了：
            
            
- 类型安全的持久化指针（Persistent Pointer）
            
- 原子事务（Atomic Transaction）
            
- 内存分配与回收
            
- 根对象（Root Object）管理
            
            

以下示例展示了如何使用 libpmemobj
            实现一个持久化链表：
            
```
#include 
#include 
#include 
#include 
- 

/* 定义池的布局名称 */
POBJ_LAYOUT_BEGIN(linked_list);
POBJ_LAYOUT_ROOT(linked_list, struct list_root);
POBJ_LAYOUT_TOID(linked_list, struct list_node);
POBJ_LAYOUT_END(linked_list);

/* 链表节点结构 */
struct list_node {
    int value;
    TOID(struct list_node) next;
};

/* 根对象结构 */
struct list_root {
    TOID(struct list_node) head;
    int count;
};

#define POOL_PATH "/mnt/pmem/linked_list.pool"
#define POOL_SIZE (64 * 1024 * 1024)  /* 64 MB */

/* 向链表头部插入新节点 */
int list_push(PMEMobjpool *pop, int value)
{
    TOID(struct list_root) root = POBJ_ROOT(pop, struct list_root);

    TX_BEGIN(pop) {
        /* 在事务中分配新节点 */
        TOID(struct list_node) new_node =
            TX_NEW(struct list_node);

        /* 设置新节点的值 */
        TX_SET(new_node, value, value);

        /* 将新节点的 next 指向当前头节点 */
        TX_SET(new_node, next, D_RO(root)->head);

        /* 更新根对象的头指针 */
        TX_SET(root, head, new_node);

        /* 更新计数器 */
        TX_SET(root, count, D_RO(root)->count + 1);
    } TX_ONABORT {
        fprintf(stderr, "事务中止，插入失败\n");
        return -1;
    } TX_END

    return 0;
}

/* 遍历并打印链表 */
void list_print(PMEMobjpool *pop)
{
    TOID(struct list_root) root = POBJ_ROOT(pop, struct list_root);
    TOID(struct list_node) current = D_RO(root)->head;

    printf("链表内容（共 %d 个节点）：\n", D_RO(root)->count);
    while (!TOID_IS_NULL(current)) {
        printf("  -> %d\n", D_RO(current)->value);
        current = D_RO(current)->next;
    }
}

int main(int argc, char *argv[])
{
    PMEMobjpool *pop;

    /* 尝试打开已有的池，如果不存在则创建新池 */
    pop = pmemobj_open(POOL_PATH,
                       POBJ_LAYOUT_NAME(linked_list));
    if (pop == NULL) {
        pop = pmemobj_create(POOL_PATH,
                             POBJ_LAYOUT_NAME(linked_list),
                             POOL_SIZE, 0666);
        if (pop == NULL) {
            perror("pmemobj_create");
            return 1;
        }
        printf("创建了新的持久化内存池\n");
    } else {
        printf("打开了已有的持久化内存池\n");
    }

    /* 插入一些测试数据 */
    list_push(pop, 10);
    list_push(pop, 20);
    list_push(pop, 30);

    /* 打印链表内容 */
    list_print(pop);

    /* 关闭池 */
    pmemobj_close(pop);
    return 0;
}
```

            

编译命令：
            
```
gcc -o linked_list linked_list.c -lpmemobj -lpmem
```

            

### 5.4 崩溃一致性与 PMDK

            

崩溃一致性（Crash
            Consistency）是持久化内存编程中最核心的挑战。当系统在数据写入过程中发生断电或崩溃时，PMem
            上的数据可能处于不一致的状态。
            

PMDK 通过以下机制保证崩溃一致性：
            

**事务机制（Transaction）**：libpmemobj 的
            TX_BEGIN/TX_END
            宏定义了一个原子事务。事务中的所有修改要么全部持久化，要么在系统恢复时全部回滚。
            

**撤销日志（Undo Log）**：事务开始前，PMDK
            会将即将被修改的数据的旧值记录到撤销日志中。如果事务未能成功完成，恢复过程会使用撤销日志将数据恢复到事务开始前的状态。
            

**重做日志（Redo
            Log）**：另一种方式是在事务执行过程中，将新值写入重做日志，事务提交时再将日志中的值应用到目标位置。
            

### 5.5 关键处理器指令

            

持久化内存编程依赖一组特定的 x86
            处理器指令来控制数据从缓存到持久化介质的流动：
            

**CLFLUSH（Cache Line Flush）**：
            
```
/* 刷新包含指定地址的缓存行，并使其失效 */
_mm_clflush(addr);
```

            
            
- 将指定缓存行写回内存，并从所有缓存层级中失效该行。
            
- 串行执行，性能较差。
            
- 所有支持 SSE2 的 x86 处理器均支持。
            
            

**CLFLUSHOPT（Optimized Cache Line
            Flush）**：
            
```
/* 优化版本的缓存行刷新 */
_mm_clflushopt(addr);
```

            
            
- 功能与 CLFLUSH 相同，但可以乱序执行。
            
- 多个 CLFLUSHOPT
            指令可以并行发出，显著提高刷新性能。
            
- 需要配合 SFENCE 使用以保证顺序。
            
            

**CLWB（Cache Line Write Back）**：
            
```
/* 将缓存行写回内存，但不使其失效 */
_mm_clwb(addr);
```

            
            
- 将缓存行写回持久化介质，但保留该行在缓存中。
            
- 后续对同一缓存行的访问仍然可以命中缓存。
            
- 是持久化内存场景下最推荐使用的指令。
            
            

**SFENCE（Store Fence）**：
            
```
/* 存储屏障，保证之前的所有存储操作和缓存刷新操作已完成 */
_mm_sfence();
```

            
            
- 保证在 SFENCE 之前发出的所有存储操作和缓存刷新操作在
            SFENCE 之后的任何存储操作之前完成。
            
- 是确保数据持久化顺序的关键指令。
            
            

典型的持久化写入序列为：
            
```
/* 步骤一：写入数据 */
memcpy(pmem_addr, data, len);

/* 步骤二：刷新缓存行 */
for (addr = pmem_addr; addr 
            
            

## 六、数据库与持久化内存

            

### 6.1 数据库利用 PMem
            的方式

            

持久化内存为数据库系统提供了全新的设计空间。传统数据库的核心假设——内存是易失性的、存储是持久性的——在
            PMem 的场景下不再成立。数据库可以从以下几个层面利用
            PMem：
            
            
- **作为预写日志（WAL）存储**：将写前日志放置在
            PMem
            上，利用其低延迟和字节寻址能力，大幅降低日志写入延迟。
            
- **作为持久化缓冲池**：将数据库的缓冲池直接放置在
            PMem 上，数据在缓冲池中即为持久化状态。
            
- **作为内存扩展**：在内存模式下，利用 PMem
            的大容量来扩展数据库的可用内存。
            
- **全新的存储引擎**：设计专门针对 PMem
            特性的存储引擎，如使用持久化 B+
            树代替传统的基于页面的存储结构。
            
            

### 6.2 预写日志与 PMem

            

预写日志（Write-Ahead
            Log，WAL）是关系型数据库保证事务持久性的关键机制。每次事务提交时，数据库必须将日志记录写入持久化存储并调用
            fsync 确保数据落盘。
            

在传统存储设备上，fsync
            的延迟是事务提交延迟的主要组成部分：
            
            
- **HDD 上的 fsync**：约 3-10
            ms（受限于磁盘旋转和寻道延迟）。
            
- **NVMe SSD 上的 fsync**：约 10-50 μs。
            
- **PMem 上的日志写入**：约 200-500 ns（通过
            CLWB + SFENCE 持久化）。
            
            

PMem 上的 WAL 写入延迟较 NVMe SSD
            降低约两个数量级。这意味着：
            
            
- 事务提交延迟大幅降低。
            
- 短事务的吞吐量显著提升。
            
- 同步提交（Synchronous Commit）的性能代价大幅减少。
            
            

以下为 PostgreSQL 将 WAL 放置在 PMem 上的配置示例：
            
```
# 假设 PMem 已挂载到 /mnt/pmem
# 创建 WAL 目录
mkdir -p /mnt/pmem/pg_wal
chown postgres:postgres /mnt/pmem/pg_wal

# 将 PostgreSQL 的 WAL 目录软链接到 PMem
# 在初始化数据库时使用 --waldir 参数
initdb -D /var/lib/postgresql/data --waldir=/mnt/pmem/pg_wal

# 或者对已有数据库，修改 postgresql.conf
# 在 postgresql.conf 中添加：
# wal_sync_method = open_sync
```

            

### 6.3 持久化缓冲池

            

传统数据库的缓冲池位于 DRAM
            中，是易失性的。数据库通过检查点（Checkpoint）机制定期将脏页（Dirty
            Page）从缓冲池写回磁盘，同时依赖 WAL
            来保证崩溃恢复时的数据一致性。
            

如果将缓冲池放置在 PMem 上，情况将发生根本性变化：
            
            
- **无需检查点**：缓冲池本身就是持久化的，脏页始终驻留在持久化介质上。
            
- **加速崩溃恢复**：崩溃后，缓冲池中的数据仍然有效，数据库只需要重放崩溃时刻之后的少量
            WAL 记录即可恢复。
            
- **简化 I/O 路径**：不再需要后台刷脏页的 I/O
            线程。
            
            

微软 SQL Server 在 2019 版本中引入了”混合缓冲池”（Hybrid
            Buffer Pool）功能，支持直接使用 PMem 作为缓冲池的扩展。
            

### 6.4 Redis 与 PMem 案例

            

Redis 是最广泛使用的内存数据库之一，天然适合与 PMem
            结合。英特尔与 Redis 社区合作，开发了多种 PMem
            集成方案：
            

**方案一：内存模式下的 Redis**
            

最简单的方案——在内存模式下运行
            Redis，无需修改任何代码。PMem 透明地提供大容量内存，DRAM
            作为缓存加速热数据访问。
            
```
# 内存模式下，Redis 无需特殊配置
# 假设系统有 384 GB DRAM 缓存 + 1.5 TB PMem
redis-server --maxmemory 1400gb
```

            

优势在于无需任何代码改动，但无法利用 PMem
            的持久化特性。
            

**方案二：基于 PMDK 的持久化 Redis**
            

英特尔开发了 Redis 的修改版本，使用 libpmemobj 将 Redis
            的核心数据结构（如哈希表、跳表）直接存储在 PMem 上。
            

这种方案的性能对比结果如下：
            
            
            
            操作
            标准 Redis（DRAM）
            Redis on PMem（App Direct）
            
            
            
            
            GET 延迟
            ~1 μs
            ~2-3 μs
            
            
            SET 延迟
            ~1 μs
            ~3-5 μs
            
            
            重启恢复时间
            数分钟（加载 RDB）
            数毫秒（直接映射）
            
            
            最大数据量
            受限于 DRAM
            可达数 TB
            
            
            
            

重启恢复时间的巨大差异是 PMem 在 Redis
            场景下的核心价值。传统 Redis 重启时需要从磁盘加载 RDB 或重放
            AOF 日志，对于数百 GB
            的数据集，恢复时间可能长达数十分钟。而使用 PMem
            持久化方案，Redis 只需重新映射 PMem
            上的数据池即可，恢复时间降至毫秒级别。
            

### 6.5 SAP HANA 与 PMem

            

SAP HANA 是最早采用 Optane PMem
            的企业级数据库之一。作为内存数据库，HANA
            天然需要大量内存来存放列式存储（Column Store）的数据。
            

SAP HANA 对 PMem 的利用方式包括：
            
            
- **列存储扩展**：将冷数据列放置在 PMem
            上，热数据列保留在 DRAM
            中。这种分级策略在保持热数据访问速度的同时，大幅降低了内存成本。
            
- **增量存储持久化**：将增量存储（Delta
            Store）放置在 PMem 上，实现数据的即时持久化。
            
- **重启加速**：系统重启后，PMem
            上的列数据无需从磁盘重新加载，大幅缩短了服务恢复时间。
            
            

根据 SAP 官方的性能测试数据，使用 Optane PMem 200
            系列后：
            
            
- 内存容量扩展至纯 DRAM 方案的 4-8 倍。
            
- 典型 OLAP 查询性能下降约 10-30%（因 PMem 延迟高于
            DRAM）。
            
- 系统重启时间从数十分钟降至数分钟。
            
- 总体拥有成本（TCO）降低约 20-40%。
            
            

### 6.6 性能影响分析

            

在评估 PMem
            对数据库性能的影响时，需要关注以下关键指标：
            

**延迟分布**：PMem 的读延迟约为 DRAM 的 2-3
            倍，但延迟分布更稳定（没有 DRAM
            的刷新停顿）。对于延迟敏感的工作负载，需要仔细评估 PMem
            延迟的影响。
            

**带宽限制**：PMem 的读带宽约为 DRAM 的
            1/3，写带宽约为 DRAM 的
            1/10。对于带宽密集型的工作负载（如大规模聚合查询），带宽瓶颈可能成为主要限制因素。
            

**访问模式**：PMem 的 256
            字节内部访问粒度意味着小于 256
            字节的随机访问会产生读写放大。数据库的索引结构应该尽量对齐
            256 字节边界。
            

**NUMA 效应**：PMem 连接在特定的 NUMA
            节点上。跨 NUMA 节点访问 PMem
            会带来额外的延迟惩罚。数据库应该确保线程访问本地 NUMA
            节点上的 PMem。
            
```
# 使用 numactl 查看 NUMA 拓扑
numactl --hardware

# 将数据库进程绑定到特定 NUMA 节点
numactl --cpunodebind=0 --membind=0 redis-server --maxmemory 256gb
```

            
            

## 七、Optane 的终结与
            CXL 的未来

            

### 7.1 英特尔终止 Optane
            业务

            

2022 年 7 月，英特尔宣布终止 Optane 产品线，包括 Optane
            持久化内存和 Optane
            固态硬盘。这一决定震动了整个存储行业。终止的主要原因包括：
            
            
- **市场接受度有限**：尽管 Optane PMem
            在技术上具有创新性，但其市场推广始终面临困难。大多数企业用户对持久化内存的编程模型和运维复杂性心存顾虑。
            
- **成本压力**：3D XPoint
            的生产成本始终未能降至具有竞争力的水平。Optane PMem
            的价格虽低于 DRAM，但价差不足以驱动大规模采用。
            
- **英特尔的战略调整**：在持续亏损的压力下，英特尔选择将资源集中于核心的处理器和代工业务。
            
- **生态系统不成熟**：虽然 PMDK
            等工具链已经相当完善，但真正利用 PMem
            特性重写的应用程序仍然很少。
            
            

英特尔已于 2023 年停止接受新的 Optane PMem
            订单，现有库存将逐步清空。3D XPoint
            的制造设备已出售给美光科技。
            

### 7.2 CXL 内存扩展器

            

计算快速链路（Compute Express
            Link，CXL）是一种开放的高速互连标准，基于 PCIe
            物理层，提供了处理器与设备之间的缓存一致性（Cache
            Coherent）协议。CXL 内存扩展器（CXL Memory
            Expander）正在成为 PMem 的替代方案。
            

CXL 的三种协议子类型：
            
            
- **CXL.io**：基于 PCIe
            协议，用于设备发现、配置和 DMA 传输。
            
- **CXL.cache**：允许设备缓存主机内存，并维护缓存一致性。
            
- **CXL.mem**：允许主机通过 CXL
            链路访问设备上的内存，支持字节寻址。
            
            

CXL 内存扩展器利用 CXL.mem 协议，将外部 DRAM
            或其他类型的内存通过 CXL 链路连接到主机的内存地址空间。
            

**CXL 内存扩展器的典型架构**：
            
```
┌─────────────┐
│   CPU       │
│  ┌───────┐  │
│  │内存    │  │  DDR5 通道
│  │控制器  ├──┼──── DRAM DIMM
│  │       │  │
│  └───┬───┘  │
│      │      │
│  ┌───┴───┐  │
│  │ CXL   │  │  PCIe/CXL 链路
│  │ 控制器 ├──┼──── CXL 内存扩展器
│  └───────┘  │     （内含 DRAM/PMem/其他介质）
└─────────────┘
```

            

### 7.3 CXL 内存扩展器与
            PMem 的对比

            
            
            
            特性
            Optane PMem
            CXL 内存扩展器
            
            
            
            
            物理接口
            DDR-T（内存插槽）
            PCIe/CXL（PCIe 插槽）
            
            
            协议
            DDR 协议变体
            CXL.mem
            
            
            缓存一致性
            由内存控制器管理
            CXL 协议保证
            
            
            存储介质
            3D XPoint（固定）
            DRAM、NAND、新型介质（灵活）
            
            
            持久性
            是（介质固有特性）
            取决于介质选择
            
            
            延迟
            170-350 ns
            约 200-400 ns（CXL 1.1/2.0）
            
            
            容量扩展
            受内存插槽数限制
            可通过 CXL 交换机扩展
            
            
            厂商锁定
            仅英特尔平台
            开放标准，多厂商支持
            
            
            热插拔
            不支持
            CXL 2.0 支持
            
            
            
            

### 7.4
            存储层次结构的未来演进

            

随着 CXL
            技术的成熟，存储层次结构正在经历新一轮的演变：
            

**异构内存池化（Memory Pooling）**：CXL 3.0
            引入了内存共享和池化能力。多个服务器可以通过 CXL 交换机（CXL
            Switch）共享一个大型内存池。这种架构类似于存储区域网络（SAN）的概念，但作用于内存层级。
            

**可组合基础设施（Composable
            Infrastructure）**：CXL
            使得计算资源和内存资源可以独立扩展。服务器可以根据工作负载的需求，动态地连接或断开
            CXL 内存设备。
            

**分层内存管理**：操作系统需要新的内存管理策略来处理不同延迟和带宽特性的内存层级。Linux
            内核的分层内存管理（Tiered Memory
            Management）子系统正在积极开发中，通过 NUMA
            节点的距离属性来表示不同内存层级的性能差异。
            
```
# Linux 内核中查看 CXL 内存设备
ls /sys/bus/cxl/devices/

# 使用 daxctl 管理 CXL 内存
daxctl list

# 将 CXL 内存添加为 NUMA 节点
# CXL 内存通常呈现为新的 NUMA 节点
numactl --hardware
# 输出中的高编号 NUMA 节点可能对应 CXL 内存
```

            

### 7.5
            对系统架构师的实际建议

            

面对 Optane 退市和 CXL
            崛起的过渡期，系统架构师应考虑以下策略：
            
            
- 

**不要新建 Optane PMem
            项目**：除非已有库存，否则不应基于 Optane PMem
            开始新项目。
            
- 

**现有 Optane 部署的维护**：对于已部署
            Optane PMem
            的系统，应制定中长期迁移计划。确保有足够的备件库存以应对硬件故障。
            
- 

**PMDK 编程模型的延续性**：PMDK
            的编程模型并不与 Optane 硬件绑定。基于 PMDK
            开发的应用程序，未来可以运行在任何支持 DAX
            的持久化内存设备上，包括 CXL 连接的持久化内存。
            
- 

**关注 CXL 生态**：密切跟踪 CXL
            内存扩展器产品的发展。三星、SK
            海力士、美光等主要内存厂商均已发布 CXL
            内存扩展器产品或原型。
            
- 

**评估分层内存管理**：开始评估 Linux
            内核的分层内存管理特性（如 memory
            tiering、demotion/promotion），为未来的异构内存架构做好准备。
            
            
            

## 八、存储延迟实测方法

            

### 8.1
            英特尔内存延迟检查器（Intel MLC）

            

英特尔内存延迟检查器（Intel Memory Latency
            Checker，MLC）是测量内存子系统延迟和带宽的标准工具。它可以测量不同访问模式下的内存和
            PMem 延迟。
            
```
# 下载并安装 Intel MLC（需要从英特尔官网获取）
# 解压后直接运行

# 测量空闲延迟（Idle Latency）
./mlc --idle_latency

# 测量不同注入延迟下的带宽-延迟曲线
./mlc --bandwidth_matrix

# 测量特定 NUMA 节点的延迟
./mlc --idle_latency -c0 -j0

# 测量所有 NUMA 节点对之间的延迟矩阵
./mlc --latency_matrix
```

            

典型的输出示例：
            
```
Intel(R) Memory Latency Checker - v3.10

Measuring idle latencies (in ns)...
                Numa node
Numa node            0       1       2       3
       0          89.2   139.5   312.4   347.6
       1         139.5    89.0   347.6   312.4
       2         312.4   347.6   170.8   210.3
       3         347.6   312.4   210.3   170.8

注：NUMA 节点 0-1 为 DRAM，NUMA 节点 2-3 为 PMem
```

            

### 8.2 ipmctl 健康监控

            

ipmctl 不仅用于配置
            PMem，还提供了全面的健康监控功能。
            
```
# 查看 PMem 设备健康状态
ipmctl show -sensor

# 显示特定传感器的详细信息
ipmctl show -sensor MediaTemperature
ipmctl show -sensor PercentageRemaining

# 查看设备的媒体错误日志
ipmctl show -error Media

# 查看设备的热错误日志
ipmctl show -error Thermal

# 获取设备的性能统计
ipmctl show -performance
```

            

关键健康指标包括：
            
            
- **介质温度（Media Temperature）**：PMem
            介质的工作温度，超过阈值会触发降速保护。
            
- **控制器温度（Controller
            Temperature）**：PMem 控制器的温度。
            
- **剩余寿命百分比（Percentage
            Remaining）**：基于已执行的写入次数估算的剩余寿命。
            
- **不安全关机计数（Unsafe Shutdown
            Count）**：记录非正常断电的次数，用于评估数据完整性风险。
            
- **上次关机状态（Last Shutdown
            Status）**：记录最近一次关机是否为安全关机。
            
            

### 8.3 ndctl 命名空间管理

            

ndctl（Non-volatile DIMM Control）是管理 PMem
            命名空间的标准 Linux 工具。
            
```
# 列出所有 PMem 区域
ndctl list -R

# 列出所有命名空间及其详细信息
ndctl list -N -v

# 创建 fsdax 模式的命名空间
ndctl create-namespace \
    --mode=fsdax \
    --region=region0 \
    --size=128G \
    --align=2M

# 创建 devdax 模式的命名空间
ndctl create-namespace \
    --mode=devdax \
    --region=region0 \
    --size=64G \
    --align=2M

# 创建扇区模式的命名空间（用于传统块设备）
ndctl create-namespace \
    --mode=sector \
    --region=region0 \
    --size=64G

# 销毁命名空间
ndctl destroy-namespace namespace0.0

# 禁用命名空间
ndctl disable-namespace namespace0.0

# 检查命名空间的一致性
ndctl check-namespace namespace0.0
```

            

命名空间的四种模式总结：
            
            
            
            模式
            设备类型
            用途
            DAX 支持
            
            
            
            
            fsdax
            /dev/pmem0
            创建 DAX 文件系统
            是
            
            
            devdax
            /dev/dax0.0
            应用直接映射
            是（设备级）
            
            
            sector
            /dev/pmem0s
            传统块设备
            否
            
            
            raw
            /dev/pmem0
            底层调试
            否
            
            
            
            

### 8.4 使用 fio 测试 PMem
            性能

            

灵活 I/O 测试工具（Flexible I/O
            Tester，fio）是存储性能测试的事实标准。fio 提供了专门的 PMem
            I/O 引擎。
            

**使用 pmemblk 引擎测试块级访问性能**：
            
```
; fio 配置文件：pmem_randread.fio
[global]
ioengine=pmemblk
filename=/dev/pmem0
bs=4k
direct=1
numjobs=1
runtime=60
time_based
group_reporting

[random-read]
rw=randread
iodepth=1

[random-write]
rw=randwrite
iodepth=1

[sequential-read]
rw=read
iodepth=1

[sequential-write]
rw=write
iodepth=1
```

            
```
# 运行 fio 测试
fio pmem_randread.fio

# 使用 libpmem 引擎进行 mmap 方式的性能测试
fio --name=pmem-test \
    --ioengine=libpmem \
    --filename=/mnt/pmem/fio_test_file \
    --bs=4k \
    --rw=randread \
    --numjobs=4 \
    --iodepth=1 \
    --size=4G \
    --runtime=60 \
    --time_based \
    --group_reporting
```

            

**使用 dev-dax 引擎进行设备级测试**：
            
```
# dev-dax 引擎直接访问 devdax 设备
fio --name=devdax-test \
    --ioengine=dev-dax \
    --filename=/dev/dax0.0 \
    --bs=4k \
    --rw=randread \
    --numjobs=4 \
    --iodepth=1 \
    --size=4G \
    --runtime=60 \
    --time_based \
    --group_reporting
```

            

### 8.5 延迟测量脚本

            

以下脚本展示了如何使用简单的方法测量 PMem
            的访问延迟：
            

**使用 C 程序进行精细延迟测量**：
            
```
#include 
#include 
#include 
#include 
#include 
#include 
#include 

#define PMEM_FILE "/mnt/pmem/latency_test.dat"
#define FILE_SIZE (1UL 
            

编译与运行：
            
```
gcc -O2 -o latency_test latency_test.c -lrt
./latency_test
```

            

**使用 Shell 脚本进行批量延迟测试**：
            
```
#!/bin/bash
# pmem_benchmark.sh - PMem 性能基准测试脚本

PMEM_MOUNT="/mnt/pmem"
RESULT_DIR="./pmem_bench_results"
FIO_RUNTIME=60

mkdir -p "${RESULT_DIR}"

echo "========================================="
echo "  PMem 性能基准测试"
echo "========================================="
echo ""

# 检查 PMem 设备状态
echo "[1/5] 检查 PMem 设备状态..."
ndctl list -N -v 2>/dev/null || echo "ndctl 未安装或无 PMem 设备"
echo ""

# 检查 DAX 挂载状态
echo "[2/5] 检查 DAX 文件系统挂载状态..."
mount | grep pmem || echo "未检测到 PMem 挂载"
echo ""

# 顺序读写测试
echo "[3/5] 顺序读写带宽测试..."
fio --name=seq-read \
    --filename="${PMEM_MOUNT}/fio_seq_test" \
    --ioengine=sync \
    --rw=read \
    --bs=1M \
    --direct=1 \
    --numjobs=1 \
    --size=4G \
    --runtime=${FIO_RUNTIME} \
    --time_based \
    --output="${RESULT_DIR}/seq_read.json" \
    --output-format=json 2>/dev/null

fio --name=seq-write \
    --filename="${PMEM_MOUNT}/fio_seq_test" \
    --ioengine=sync \
    --rw=write \
    --bs=1M \
    --direct=1 \
    --numjobs=1 \
    --size=4G \
    --runtime=${FIO_RUNTIME} \
    --time_based \
    --output="${RESULT_DIR}/seq_write.json" \
    --output-format=json 2>/dev/null

echo "顺序测试完成。"
echo ""

# 随机读写 IOPS 测试
echo "[4/5] 随机读写 IOPS 测试..."
for bs in 4k 64k 256k; do
    echo "  块大小: ${bs}"
    fio --name="rand-read-${bs}" \
        --filename="${PMEM_MOUNT}/fio_rand_test" \
        --ioengine=sync \
        --rw=randread \
        --bs="${bs}" \
        --direct=1 \
        --numjobs=4 \
        --size=4G \
        --runtime=${FIO_RUNTIME} \
        --time_based \
        --group_reporting \
        --output="${RESULT_DIR}/rand_read_${bs}.json" \
        --output-format=json 2>/dev/null
done

echo "随机测试完成。"
echo ""

# 汇总结果
echo "[5/5] 测试结果汇总"
echo "-----------------------------------------"
echo "结果文件保存在: ${RESULT_DIR}/"
ls -la "${RESULT_DIR}/"
echo ""
echo "测试完成。"
```

            

赋予执行权限并运行：
            
```
chmod +x pmem_benchmark.sh
./pmem_benchmark.sh
```

            

### 8.6 生产环境监控建议

            

在生产环境中，建议建立以下 PMem 监控体系：
            
            
- 

**温度监控**：通过 ipmctl
            定期采集介质温度和控制器温度，设置告警阈值（介质温度通常不应超过
            85 摄氏度）。
            
- 

**寿命监控**：监控”剩余寿命百分比”指标。当该值低于
            10% 时，应安排设备更换。
            
- 

**错误率监控**：定期检查介质错误日志（Media
            Error Log）和热错误日志（Thermal Error
            Log）。错误率突增可能预示设备即将故障。
            
- 

**性能基线**：定期运行 MLC 或 fio
            测试，建立性能基线。如果观测到延迟显著增加或带宽显著下降，可能表明设备正在老化。
            
- 

**非安全关机追踪**：监控不安全关机计数。每次非安全关机后，应检查
            PMem 上的数据一致性。
            
            
```
# 定时采集 PMem 健康数据的 cron 任务示例
# 每小时采集一次传感器数据
# 将以下内容添加到 crontab
# 0 * * * * /usr/bin/ipmctl show -sensor >> /var/log/pmem_health.log 2>&1
```

            
            

## 参考文献

            
            
- 

Intel Corporation. “Intel Optane Persistent Memory.”
            Intel Technology Documentation, 2021. https://www.intel.com/content/www/us/en/products/docs/memory-storage/optane-persistent-memory/overview.html
            
- 

Izraelevitz, J., Yang, J., Zhang, L., et al. “Basic
            Performance Measurements of the Intel Optane DC Persistent
            Memory Module.” arXiv preprint arXiv:1903.05714,
            2019.
            
- 

Yang, J., Kim, J., Hoseinzadeh, M., Izraelevitz, J.,
            and Swanson, S. “An Empirical Guide to the Behavior and Use
            of Scalable Persistent Memory.” In Proceedings of the 18th
            USENIX Conference on File and Storage Technologies (FAST
            ’20), 2020, pp. 169-182.
            
- 

SNIA. “NVM Programming Model (NPM).” Storage
            Networking Industry Association, Version 1.2, 2017. https://www.snia.org/tech_activities/standards/curr_standards/npm
            
- 

Intel Corporation. “Persistent Memory Development Kit
            (PMDK).” GitHub Repository, 2023. https://github.com/pmem/pmdk
            
- 

Scargall, S. “Programming Persistent Memory: A
            Comprehensive Guide for Developers.” Apress, 2020.
            
- 

Patil, O., Lagar-Cavilla, A., Engel, T., et
            al. “Redesigning LSMs for Nonvolatile Memory with NoveLSM.”
            In Proceedings of the 2019 USENIX Annual Technical
            Conference (ATC ’19), 2019, pp. 993-1005.
            
- 

van Renen, A., Leis, V., Kemper, A., Neumann, T.,
            Hashida, T., Oe, K., Doi, Y., Harada, L., and Sato, M.
            “Managing Non-Volatile Memory in Database Systems.” In
            Proceedings of the 2018 International Conference on
            Management of Data (SIGMOD ’18), 2018,
            pp. 1541-1555.
            
- 

SAP SE. “SAP HANA Persistent Memory.” SAP Help
            Portal, 2021. https://help.sap.com/docs/SAP_HANA_PLATFORM/6b94445c94ae495c83a19646e7c3fd56
            
- 

CXL Consortium. “Compute Express Link Specification.”
            Revision 3.0, 2022. https://www.computeexpresslink.org/
            
- 

Pond, C., et al. “CXL Memory Expander: A Novel Memory
            Disaggregation Architecture.” In Proceedings of the IEEE
            International Symposium on High-Performance Computer
            Architecture (HPCA), 2023.
            
- 

Intel Corporation. “Intel Memory Latency Checker
            (MLC).” Intel Developer Zone, 2023. https://www.intel.com/content/www/us/en/developer/articles/tool/intelr-memory-latency-checker.html
            
- 

Lersch, L., Oukid, I., Lehner, W., and Schreter, I.
            “Persistent Buffer Management with Optimistic Consistency.”
            In Proceedings of the 15th International Workshop on Data
            Management on New Hardware (DaMoN ’19), 2019.
            
- 

Intel Corporation. “ipmctl User Guide.” Intel
            Documentation, 2022. https://docs.pmem.io/ipmctl-user-guide/
            
- 

Cai, Z., Mwangi, S., and Swanson, S. “NVMKV: A
            Scalable and Lightweight Flash Aware Key-Value Store.” In
            Proceedings of the 6th USENIX Workshop on Hot Topics in
            Storage and File Systems (HotStorage ’14), 2014.
            
            
            

**上一篇**: NVMe
            协议与存储接口演进
            

**下一篇**: 存储性能建模：IOPS、吞吐与延迟
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-12 · storage
                    

### 【存储工程】存储基准测试方法论

                    

深入剖析存储基准测试的方法论——fio 参数解析、filebench 工作负载定义、YCSB 数据库基准、测试陷阱规避与性能回归测试集成
                

                
                    

2025-08-14 · storage
                    

### 【存储工程】存储性能建模：IOPS、吞吐与延迟

                    

存储性能不是一个数字，而是 IOPS、吞吐量和延迟在特定工作负载下的函数关系。本文从排队论模型出发，用 fio 实测验证，覆盖从 HDD 到 NVMe SSD 的性能画像，最终落到容量规划和监控体系的工程实践。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。