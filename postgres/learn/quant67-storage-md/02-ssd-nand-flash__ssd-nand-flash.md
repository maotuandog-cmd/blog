# 【存储工程】SSD 与 NAND Flash：FTL、写放大与磨损均衡

来源: https://quant67.com/post/storage/02-ssd-nand-flash/ssd-nand-flash.html
日期: 2025-08-11 |

---

SSD 已经在大多数性能敏感场景中取代了 HDD，但 SSD
            并不是”没有机械部件的硬盘”——它是一个完全不同的存储架构，带来了一组全新的工程约束。理解这些约束，需要从
            NAND Flash（NAND 闪存）的物理特性开始，逐层向上推导出
            FTL（Flash Translation Layer）、垃圾回收（Garbage
            Collection）、写放大（Write Amplification）、TRIM
            和磨损均衡（Wear Leveling）等核心机制。
            

本文的目标不是介绍 SSD 有多快，而是回答一组工程问题：SSD
            内部发生了什么？为什么 SSD
            的性能会随时间退化？为什么随机小写入是 SSD
            的大敌？如何在生产环境中正确配置和监控 SSD？
            

## 一、NAND Flash 物理原理

            

### 1.1 浮栅晶体管与电荷存储

            

NAND Flash 的存储单元是浮栅晶体管（Floating-Gate
            Transistor）。数据以电荷的形式存储在浮栅（Floating
            Gate）中，浮栅被绝缘层包围，电荷一旦注入就会被”困住”。读取时，通过检测晶体管的阈值电压（Threshold
            Voltage）来判断存储的数据值。
            
```
浮栅晶体管结构（简化）：

    控制栅（Control Gate）
    ─────────────────────
    │  氧化层（ONO）     │
    ─────────────────────
    │  浮栅（Floating Gate）│  ← 电荷存储在这里
    ─────────────────────
    │  隧道氧化层         │
    ─────────────────────
    Source ──────── Drain
           Channel

写入（Program）：
  在控制栅施加高电压（~20V）
  → 电子通过 FN 隧穿效应注入浮栅
  → 阈值电压升高
  → 逻辑值从 1 变为 0

擦除（Erase）：
  在衬底施加高电压
  → 电子从浮栅中被拉出
  → 阈值电压降低
  → 所有 cell 恢复到逻辑 1

关键物理约束：
  - 写入可以把 1 变成 0（注入电荷）
  - 但不能把 0 变成 1（单个 cell 无法单独擦除）
  - 擦除操作只能以 Block 为单位，整块擦除
  - 这就是"先擦后写"约束的物理根源
```

            

### 1.2 Cell 类型：SLC /
            MLC / TLC / QLC / PLC

            

每个浮栅晶体管可以存储的比特数取决于它能区分多少个电压等级。存储的比特越多，同样面积的芯片容量越大，但可靠性和速度都会下降。
            
```
电压等级与 Cell 类型：

SLC（Single-Level Cell）：1 bit/cell，2 个电压等级
  ┌─────┬─────┐
  │  1  │  0  │
  └──┬──┴──┬──┘
     V1    V2
  阈值电压范围宽 → 读取容错大 → 最可靠

MLC（Multi-Level Cell）：2 bits/cell，4 个电压等级
  ┌─────┬─────┬─────┬─────┐
  │ 11  │ 01  │ 00  │ 10  │
  └──┬──┴──┬──┴──┬──┴──┬──┘
     V1    V2    V3    V4
  电压间距缩小 → 读取需要更精确 → 错误率上升

TLC（Triple-Level Cell）：3 bits/cell，8 个电压等级
  ┌────┬────┬────┬────┬────┬────┬────┬────┐
  │111 │011 │001 │101 │100 │000 │010 │110 │
  └─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─┬──┴─┬──┘
    V1   V2   V3   V4   V5   V6   V7   V8
  电压间距更小 → 需要更强的 ECC → 速度更慢

QLC（Quad-Level Cell）：4 bits/cell，16 个电压等级
  16 个电压等级，间距极小
  → 编程时间更长（需要更精确的电压控制）
  → 擦写寿命大幅降低
  → 主要用于读密集型冷数据场景

PLC（Penta-Level Cell）：5 bits/cell，32 个电压等级
  仍处于早期阶段，商用产品极少
  → 主要面向归档存储
  → 擦写寿命可能仅 ~100 次
```

            

各类型 Cell 的关键参数对比：
            
```
┌──────────┬────────────┬──────────────┬──────────────┬──────────────┐
│ 参数     │ SLC        │ MLC          │ TLC          │ QLC          │
├──────────┼────────────┼──────────────┼──────────────┼──────────────┤
│ Bits/Cell│ 1          │ 2            │ 3            │ 4            │
│ 电压等级 │ 2          │ 4            │ 8            │ 16           │
│ 容量倍率 │ 1x         │ 2x           │ 3x           │ 4x           │
│ P/E 寿命 │ 50K-100K   │ 3K-10K       │ 1K-3K        │ 100-1K       │
│ 读延迟   │ ~25 us     │ ~50 us       │ ~75 us       │ ~120 us      │
│ 写延迟   │ ~200 us    │ ~600 us      │ ~1500 us     │ ~5000 us     │
│ 擦除延迟 │ ~1.5 ms    │ ~3 ms        │ ~5 ms        │ ~10 ms       │
│ 成本/GB  │ 最高       │ 中等         │ 较低         │ 最低         │
│ 典型用途 │ 企业缓存   │ 企业级 SSD   │ 消费级 SSD   │ 读密集/QD1   │
│ ECC 需求 │ 1-bit/512B │ 4-bit/512B   │ 40-bit/1KB   │ 100+bit/1KB  │
└──────────┴────────────┴──────────────┴──────────────┴──────────────┘

注：以上数据为典型值，不同厂商和工艺节点有差异。
    3D NAND 通过垂直堆叠改善了 TLC/QLC 的寿命，
    实际 P/E 寿命可能优于上表中的平面 NAND 数据。
```

            

### 1.3 Page / Block /
            Die / Package 层次结构

            

NAND Flash 的存储层次从小到大依次为：Cell → Page → Block
            → Plane → Die → Package。理解这个层次结构对于理解 SSD
            性能至关重要。
            
```
NAND Flash 存储层次：

Package（封装）
└── Die（芯片）× 2-16
    └── Plane（平面）× 2-4
        └── Block（块）× 1000-4000+
            └── Page（页）× 256-768
                └── Cell × 16KB-18KB

关键尺寸（以 TLC 为例）：
  - Page 大小：  16 KB（也有 4KB、8KB 的老规格）
  - Block 大小：  Page × 页数
                 = 16 KB × 384 pages = 6 MB
                 = 16 KB × 768 pages = 12 MB（更新的 3D NAND）
  - Die 容量：    ~256 Gbit - 1 Tbit
  - Package：     多个 Die 封装在一起

操作粒度：
  ┌────────────┬───────────────────────────────────┐
  │ 操作       │ 粒度                              │
  ├────────────┼───────────────────────────────────┤
  │ 读取（Read）│ Page（最小读取单位）              │
  │ 写入（Program）│ Page（最小写入单位）           │
  │ 擦除（Erase）│ Block（最小擦除单位）            │
  └────────────┴───────────────────────────────────┘

  这是 SSD 复杂性的根源：
  - 不能修改一个 Page 中的部分数据
  - 不能单独擦除一个 Page
  - 要修改一个 Page 的数据，必须：
    1. 把新数据写到一个空闲 Page
    2. 把旧 Page 标记为无效
    3. 等垃圾回收处理整个 Block
```

            

### 1.4 Program / Erase
            操作与约束

            
```
Page 状态机：

  ┌────────┐  Program   ┌────────┐
  │  Free  │ ─────────→ │  Valid │
  │（空闲）│            │（有效）│
  └────────┘            └────┬───┘
       ↑                     │
       │     Erase           │ Invalidate
       │   （整 Block）      │（新数据写到别处）
       │                     ↓
  ┌────┴───┐            ┌────────┐
  │  Free  │ ←───────── │ Invalid│
  │（空闲）│  GC + Erase│（无效）│
  └────────┘            └────────┘

写入约束：
  1. Page 必须按顺序写入（在同一个 Block 内）
     - 先写 Page 0，再写 Page 1，依次递增
     - 不能跳过 Page，不能回头写
     - 这叫做"顺序编程约束"（Sequential Program Constraint）

  2. 一个 Page 在擦除之前只能写入一次
     - 写入后变为 Valid
     - 不能再次写入（除非整个 Block 被擦除）

  3. 擦除以 Block 为单位
     - 一个 Block 中有些 Page 有效、有些无效
     - 要擦除这个 Block，必须先把有效 Page 搬走
     - 这就是垃圾回收的核心工作
```

            

### 1.5 读写擦除延迟对比

            
```
典型操作延迟（3D TLC NAND）：

┌──────────────┬──────────────┬──────────────────────────────────┐
│ 操作         │ 延迟         │ 说明                             │
├──────────────┼──────────────┼──────────────────────────────────┤
│ Page Read    │ 50-75 us     │ 从 NAND 阵列读到 Page Buffer     │
│ Page Program │ 1000-1500 us │ 从 Page Buffer 写入 NAND 阵列    │
│ Block Erase  │ 3000-5000 us │ 整个 Block 擦除                  │
├──────────────┼──────────────┼──────────────────────────────────┤
│ DRAM 访问    │ ~0.1 us      │ 作为对比                         │
│ HDD 随机读   │ ~8000 us     │ 寻道 + 旋转延迟                  │
└──────────────┴──────────────┴──────────────────────────────────┘

关键比值：
  - 写比读慢 ~20 倍
  - 擦除比写慢 ~3-5 倍
  - 但 SSD 读比 HDD 快 ~100 倍

  这些比值直接影响 SSD 控制器的设计：
  - 读写不对称 → 读优化和写优化需要不同策略
  - 擦除昂贵 → 尽量减少擦除次数（GC 优化）
  - 擦除粒度大 → 需要 FTL 管理映射关系
```

            

### 1.6 3D NAND 与垂直堆叠

            

平面（Planar / 2D）NAND 通过缩小制程来增加密度，但到 1x
            nm 之后，cell 间干扰和可靠性问题使得继续缩小变得不经济。3D
            NAND（也称
            V-NAND）通过垂直堆叠来增加密度，同时可以使用较大的制程节点，改善了单元可靠性。
            
```
2D NAND vs 3D NAND：

2D NAND（平面）：
  ─── Cell ── Cell ── Cell ── Cell ───   单层
  制程不断缩小（15nm → 1x nm）
  问题：cell 间距太小 → 相互干扰 → 可靠性下降

3D NAND（垂直堆叠）：
  ─── Cell ── Cell ── Cell ── Cell ───   第 N 层
  ─── Cell ── Cell ── Cell ── Cell ───   ...
  ─── Cell ── Cell ── Cell ── Cell ───   第 3 层
  ─── Cell ── Cell ── Cell ── Cell ───   第 2 层
  ─── Cell ── Cell ── Cell ── Cell ───   第 1 层

  主流堆叠层数演进：
  2015: 32 层
  2017: 64 层
  2019: 96 层
  2020: 128 层
  2022: 176-232 层
  2024: 300+ 层

3D NAND 的优势：
  1. 不依赖缩小制程 → 可以用较大节点 → cell 更可靠
  2. 更高密度 → 更大容量的单 Die
  3. TLC/QLC 的 P/E 寿命比同类 2D NAND 更好
  4. 更低的位成本

3D NAND 的挑战：
  1. 制造工艺复杂（高深宽比刻蚀）
  2. 上下层 cell 特性差异
  3. 更复杂的 ECC 和信号处理
```

            

## 二、FTL（Flash
            Translation Layer）

            

### 2.1 为什么需要 FTL

            

操作系统和文件系统使用逻辑块地址（Logical Block
            Address，LBA）来访问存储设备。HDD 上，LBA
            与物理扇区之间的映射几乎是固定的。但在 NAND Flash
            上，由于不能原地更新数据，同一个 LBA
            在不同时刻可能对应不同的物理 Page。FTL
            就是管理这个逻辑到物理映射的固件层。
            
```
FTL 的核心职责：

Host 视角：          SSD 内部：
┌─────────────┐     ┌──────────────────────────────────┐
│ LBA 0       │ ──→ │ Die 2, Block 150, Page 3         │
│ LBA 1       │ ──→ │ Die 0, Block 42,  Page 17        │
│ LBA 2       │ ──→ │ Die 1, Block 300, Page 255       │
│ ...         │     │ ...                              │
│ LBA N       │ ──→ │ Die 3, Block 88,  Page 100       │
└─────────────┘     └──────────────────────────────────┘
                    ↑
                    FTL 映射表（Mapping Table）

FTL 的核心工作：
  1. 地址翻译：LBA → PPA（Physical Page Address）
  2. 写入管理：将写入分配到空闲 Page
  3. 垃圾回收：回收包含无效 Page 的 Block
  4. 磨损均衡：均匀分配擦写次数
  5. 坏块管理：标记和绕过坏块
  6. ECC：检测和纠正位错误
```

            

### 2.2
            映射粒度：Page 级 vs Block 级 vs 混合映射

            
```
三种映射策略对比：

1. Page 级映射（Page-Level Mapping）
   - 每个 LBA 页面独立映射到物理 Page
   - 优点：灵活性最高，随机写入性能好
   - 缺点：映射表巨大，需要大量 DRAM

   映射表大小计算：
   以 1TB SSD 为例：
   LBA 空间 = 1 TB / 4 KB（LBA 扇区大小）= 256M 个条目
   每个条目 = 4 bytes（物理地址）
   映射表大小 = 256M × 4 B = 1 GB

   → 1TB 的 SSD 需要 ~1GB 的 DRAM 来存储映射表
   → 这就是为什么 SSD 上通常有大容量 DRAM 缓存

2. Block 级映射（Block-Level Mapping）
   - 只映射到 Block，Block 内的偏移量保持不变
   - 优点：映射表小（Block 数量远少于 Page 数量）
   - 缺点：随机写入性能差（小写入也要搬移整个 Block）

   映射表大小计算：
   1TB SSD，Block 大小 = 6 MB
   Block 数量 = 1 TB / 6 MB ≈ 170K
   映射表大小 = 170K × 4 B ≈ 680 KB
   → 比 Page 级映射小三个数量级

3. 混合映射（Hybrid Mapping）
   - 结合 Page 级和 Block 级映射
   - 热数据使用 Page 级映射（日志块 / Log Block）
   - 冷数据使用 Block 级映射（数据块 / Data Block）
   - 写入先进日志块（Page 级映射），后台合并到数据块
   - 优点：平衡了性能和 DRAM 开销
   - 缺点：合并操作增加写放大

混合映射的工作流程：
  写入请求 → 写入日志块（Page 级映射）
                ↓ 日志块满
              合并操作：
              1. 读取数据块有效数据
              2. 与日志块数据合并
              3. 写入新的数据块
              4. 擦除旧的数据块和日志块
```

            

### 2.3 映射表大小计算实例

            
```
# 计算不同容量 SSD 的 FTL 映射表大小

def calc_mapping_table_size(ssd_capacity_gb, page_size_kb=4, entry_size_bytes=4):
    """计算 Page 级映射的映射表大小"""
    total_pages = (ssd_capacity_gb * 1024 * 1024) // page_size_kb
    table_size_bytes = total_pages * entry_size_bytes
    table_size_mb = table_size_bytes / (1024 * 1024)
    return table_size_mb

# 常见容量的映射表大小
capacities = [256, 512, 1024, 2048, 4096, 8192]

print(f"{'SSD 容量':>10} | {'映射条目数':>14} | {'映射表大小':>10}")
print("-" * 42)
for cap in capacities:
    entries = (cap * 1024 * 1024) // 4  # 4KB per page
    table_mb = calc_mapping_table_size(cap)
    print(f"{cap:>7} GB | {entries:>12,} | {table_mb:>7.0f} MB")

# 输出：
# SSD 容量 |       映射条目数 |   映射表大小
# ------------------------------------------
#   256 GB |     67,108,864 |     256 MB
#   512 GB |    134,217,728 |     512 MB
#  1024 GB |    268,435,456 |    1024 MB
#  2048 GB |    536,870,912 |    2048 MB
#  4096 GB |  1,073,741,824 |    4096 MB
#  8192 GB |  2,147,483,648 |    8192 MB

# 结论：Page 级映射的映射表大小约为 SSD 容量的 0.1%
# 1TB SSD 需要 ~1GB DRAM，8TB SSD 需要 ~8GB DRAM
# 这是 SSD 成本的重要组成部分
```

            

### 2.4 DRAM-less SSD 与 HMB

            

不是所有 SSD 都配备了专用 DRAM。低端消费级 SSD
            为了降低成本，采用了 DRAM-less（无
            DRAM）设计，使用主机内存缓冲区（Host Memory
            Buffer，HMB）来存储部分映射表。
            
```
DRAM SSD vs DRAM-less SSD：

DRAM SSD：
  ┌──────────────────────────────────┐
  │ SSD 控制器                       │
  │  ┌───────┐  ┌────────────────┐  │
  │  │ DRAM  │  │ NAND Flash     │  │
  │  │ 1-2GB │  │ 容量存储        │  │
  │  └───────┘  └────────────────┘  │
  └──────────────────────────────────┘
  - 完整映射表存储在 DRAM 中
  - 随机读写性能稳定
  - 成本较高

DRAM-less SSD（使用 HMB）：
  ┌────────────────────────────────┐
  │ 主机（Host）                    │
  │  ┌───────────────────┐         │
  │  │ 系统内存            │        │
  │  │ ┌────────────────┐ │        │
  │  │ │ HMB（64MB 典型）│ │        │  ← 存储热映射
  │  │ └────────────────┘ │        │
  │  └───────────────────┘         │
  └────────────────────────────────┘
         ↕ PCIe
  ┌────────────────────────────────┐
  │ SSD 控制器                      │
  │  ┌──────┐  ┌────────────────┐  │
  │  │ SRAM │  │ NAND Flash     │  │
  │  │ 少量 │  │ 容量 + 映射表  │  │
  │  └──────┘  └────────────────┘  │
  └────────────────────────────────┘
  - 只缓存部分映射表（热数据）
  - 映射表 miss 时需要从 NAND 读取 → 额外延迟
  - 随机读写性能波动大，特别是随机读
  - 成本低
```

            
```
# 检查 NVMe SSD 是否支持 HMB
sudo nvme id-ctrl /dev/nvme0 | grep -i hmb
# hmpre : 0x2000    # HMB Preferred Size (in 4KB units)
# hmmin : 0x400     # HMB Minimum Size

# 检查 HMB 是否已启用
dmesg | grep -i "host memory buffer"
# nvme nvme0: allocated 64 MiB host memory buffer
```

            

### 2.5 FTL
            映射表持久化与掉电保护

            

映射表在运行时驻留在 DRAM 中。如果突然掉电，DRAM
            中的映射表会丢失。为了防止数据丢失，SSD 使用以下机制：
            
```
映射表持久化策略：

1. 周期性刷写（Periodic Flush）
   - 定期将 DRAM 中的映射表写回 NAND
   - 掉电时最多丢失上次刷写之后的映射更新
   - 需要通过 Journal / Log 恢复丢失的映射

2. 电容备份（Capacitor Backup / Power Loss Protection）
   - 企业级 SSD 配备钽电容（Tantalum Capacitor）
   - 掉电时电容提供 ~10-20 ms 的供电时间
   - 足够将 DRAM 中的映射表和缓存数据刷写到 NAND
   - 消费级 SSD 通常没有这个功能

3. 日志结构写入
   - 每次写入都在 NAND 中记录映射变更
   - 掉电恢复时通过重放日志重建映射表
   - 增加了写放大，但提供了数据安全保证

企业级 vs 消费级掉电保护：
┌────────────┬──────────────┬────────────────────┐
│ 特性       │ 企业级       │ 消费级             │
├────────────┼──────────────┼────────────────────┤
│ 电容备份   │ 有           │ 通常没有           │
│ 映射表保护 │ 完整         │ 可能丢失最近映射   │
│ 缓存数据   │ 掉电时刷写   │ 可能丢失           │
│ 恢复时间   │ 快（秒级）   │ 慢（需要扫描重建） │
│ 适用场景   │ 数据库、存储 │ 桌面、笔记本       │
└────────────┴──────────────┴────────────────────┘
```

            

## 三、垃圾回收（Garbage
            Collection）

            

### 3.1 为什么需要垃圾回收

            

NAND Flash 不支持原地更新（In-Place
            Update）。当主机更新一个 LBA 时，SSD 将新数据写到一个空闲
            Page，把旧 Page 标记为无效。随着时间推移，Block
            中会积累越来越多的无效 Page。垃圾回收（Garbage
            Collection，GC）的任务就是回收这些包含无效 Page 的
            Block，释放空闲空间。
            
```
GC 的必要性——一个简单示例：

初始状态（Block 中有 8 个 Page）：
  Page: [A] [B] [C] [D] [E] [F] [G] [H]
  状态:  V   V   V   V   V   V   V   V     （V=Valid，全部有效）

主机更新 LBA A、C、E、G（数据写到其他 Block 的空闲 Page）：
  Page: [A] [B] [C] [D] [E] [F] [G] [H]
  状态:  I   V   I   V   I   V   I   V     （I=Invalid）

  这个 Block 有 4 个无效 Page，但不能单独擦除它们。
  要回收这个 Block 的空间，必须：
  1. 把有效 Page（B、D、F、H）复制到其他空闲 Block
  2. 擦除整个 Block
  3. 现在这个 Block 变成空闲 Block，可以重新使用
```

            

### 3.2 GC 流程详解

            
```
垃圾回收完整流程：

步骤 1：选择牺牲块（Victim Block Selection）
  选择标准通常考虑：
  - 无效 Page 比例（越高越好 → 搬移成本低）
  - Block 的擦写次数（优先选低擦写次数的，配合磨损均衡）
  - Block 中数据的冷热程度

  常见选择算法：
  ┌─────────────────────┬─────────────────────────────────────┐
  │ 算法                │ 策略                                │
  ├─────────────────────┼─────────────────────────────────────┤
  │ Greedy              │ 选无效 Page 最多的 Block             │
  │ Cost-Benefit        │ 综合考虑无效比例和数据年龄           │
  │ Cost-Age-Times(CAT) │ 综合考虑无效比例、年龄和擦写次数    │
  └─────────────────────┴─────────────────────────────────────┘

步骤 2：复制有效 Page（Valid Page Copy）
  - 读取牺牲块中的所有有效 Page
  - 将它们写入到空闲 Block 中
  - 更新 FTL 映射表（旧物理地址 → 新物理地址）

步骤 3：擦除牺牲块（Block Erase）
  - 执行 Block Erase 操作
  - 该 Block 变为空闲 Block
  - 更新空闲块列表

GC 的代价：
  假设一个 Block 有 N 个 Page，其中 K 个有效
  GC 需要：
  - K 次 Page Read
  - K 次 Page Write（写入到新 Block）
  - 1 次 Block Erase
  - K 次映射表更新
  总数据搬移量 = K × Page 大小
```

            

### 3.3 前台 GC 与后台 GC

            
```
两种 GC 模式：

1. 后台 GC（Background GC / Idle-Time GC）
   - SSD 空闲时主动执行
   - 不影响主机 I/O 性能
   - 维持一定数量的空闲 Block 池
   - 理想情况：主机 I/O 永远不需要等待 GC

2. 前台 GC（Foreground GC / On-Demand GC）
   - 空闲 Block 耗尽时，主机写入请求触发
   - 必须先完成 GC 才能服务写入请求
   - 直接影响主机 I/O 延迟
   - 这是 SSD 尾延迟（Tail Latency）飙升的主要原因

延迟影响：
  ┌─────────────────────┬───────────────┬────────────────────┐
  │ 场景                │ 写入延迟      │ 原因               │
  ├─────────────────────┼───────────────┼────────────────────┤
  │ 正常写入            │ ~20 us        │ 直接写入空闲 Page   │
  │ 后台 GC 进行中      │ ~20-50 us     │ 轻微竞争 NAND 带宽  │
  │ 前台 GC（best case）│ ~500 us       │ 搬移少量有效 Page   │
  │ 前台 GC（worst case）│ ~10,000+ us  │ 搬移大量有效 Page   │
  └─────────────────────┴───────────────┴────────────────────┘

  前台 GC 的最差情况延迟是正常延迟的 500 倍。
  这就是 SSD 尾延迟问题的物理根源。
```

            

### 3.4 GC 对性能的影响

            
```
# 使用 fio 观察 GC 导致的延迟波动
# 先填满 SSD 使其进入稳态，然后观察延迟分布

# 步骤 1：预填充 SSD（触发 GC 条件）
fio --name=precondition \
    --filename=/dev/nvme0n1 \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --size=100% \
    --loops=2

# 步骤 2：随机写入并观察延迟分布
fio --name=randwrite_latency \
    --filename=/dev/nvme0n1 \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=1 \
    --runtime=300 \
    --time_based \
    --lat_percentiles=1 \
    --percentile_list=50:90:95:99:99.9:99.99

# 典型输出（稳态下 TLC SSD）：
#   lat percentiles (usec):
#    | 50.00th=[   20]   ← 正常写入
#    | 90.00th=[   25]
#    | 95.00th=[   32]
#    | 99.00th=[  120]   ← 开始看到 GC 影响
#    | 99.90th=[ 2000]   ← GC 搬移
#    | 99.99th=[10000]   ← 前台 GC 严重阻塞
```

            

## 四、写放大（Write
            Amplification）

            

### 4.1 定义与计算

            

写放大因子（Write Amplification Factor，WAF）是指实际写入
            NAND 的数据量与主机请求写入的数据量之比。WAF >=
            1，理想值为 1（意味着没有额外写入）。
            
```
WAF 的定义：

  WAF = NAND 实际写入量 / 主机写入量

  WAF = 1：主机写 1GB，NAND 写 1GB（理想情况）
  WAF = 3：主机写 1GB，NAND 写 3GB（常见情况）
  WAF = 10：主机写 1GB，NAND 写 10GB（最差情况）

WAF 的来源分解：

  NAND 写入 = 主机数据写入
            + GC 搬移的有效 Page
            + FTL 映射表更新
            + 内部元数据（日志、坏块表等）

  WAF = 1 + (GC 搬移量 / 主机写入量) + (元数据开销 / 主机写入量)

  其中 GC 搬移量是 WAF 的主要贡献者。
```

            

### 4.2 GC 导致的写放大分析

            
```
GC 写放大的数学模型（简化）：

假设：
  - Block 有 N 个 Page
  - GC 选择的牺牲块中有效 Page 比例为 u（utilization）
  - 则每次 GC 一个 Block，搬移 u × N 个有效 Page
  - 释放 (1-u) × N 个无效 Page 的空间
  - 但写入了 u × N 个 Page 的数据

  GC 引起的写放大：
  WAF_gc = 1 / (1 - u)

  u = 0（全部无效）：WAF_gc = 1（无写放大）
  u = 0.5（半有效）：WAF_gc = 2
  u = 0.8（80%有效）：WAF_gc = 5
  u = 0.9（90%有效）：WAF_gc = 10
  u = 0.95：         WAF_gc = 20

  这就是为什么 SSD 剩余空间越少，写放大越严重。
  也是为什么 Over-Provisioning（预留空间）如此重要。

写放大与有效 Page 比例的关系：
  u (有效比例) │ WAF
  ─────────────┼──────
     0.0       │  1.0
     0.2       │  1.25
     0.4       │  1.67
     0.5       │  2.0
     0.6       │  2.5
     0.7       │  3.33
     0.8       │  5.0
     0.9       │ 10.0
     0.95      │ 20.0
```

            

### 4.3 影响 WAF 的因素

            
```
影响写放大的主要因素：

1. 写入模式
   ┌──────────────┬─────────────┬─────────────────────────────┐
   │ 写入模式     │ 典型 WAF    │ 原因                        │
   ├──────────────┼─────────────┼─────────────────────────────┤
   │ 顺序大块写入 │ 1.0 - 1.1   │ 整个 Block 顺序填满，无碎片 │
   │ 大块随机写入 │ 1.5 - 3.0   │ 部分 Block 碎片             │
   │ 4KB 随机写入 │ 3.0 - 10.0  │ Block 中有效 Page 分散      │
   │ 512B 随机写入│ 10.0 - 30.0 │ 极度碎片化                  │
   └──────────────┴─────────────┴─────────────────────────────┘

2. SSD 填充率
   - 使用容量越高，空闲 Block 越少
   - GC 被迫选择有效比例高的 Block 做回收
   - WAF 急剧上升

3. Over-Provisioning 比例
   - 更多的 OP 空间意味着更多的空闲 Block
   - GC 可以选择更优的牺牲块
   - 企业级 SSD 通常预留 28%（标称容量为 NAND 容量的 ~78%）
   - 消费级 SSD 通常预留 7%（标称容量为 NAND 容量的 ~93%）

4. TRIM 支持
   - TRIM 让 SSD 知道哪些 LBA 已被删除
   - SSD 可以直接将对应 Page 标记为无效
   - 降低 GC 时需要搬移的有效 Page 数量
   - 有效降低 WAF
```

            

### 4.4 测量 WAF：SMART 属性

            
```
# 通过 SMART 属性计算实际 WAF

# 对于 NVMe SSD，使用 nvme-cli
sudo nvme smart-log /dev/nvme0

# 关键字段：
# data_units_written : 主机写入量（以 512B × 1000 为单位）
# 需要查找 NAND 写入量：因厂商而异

# 计算方法：
# WAF = NAND_writes / Host_writes

# 对于 SATA SSD，使用 smartctl
sudo smartctl -A /dev/sda

# 典型 SMART 属性（以 Intel SSD 为例）：
# ID# ATTRIBUTE_NAME             RAW_VALUE
# 241 Host_Writes_32MiB          12345      ← 主机写入（32 MiB 单位）
# 242 NAND_Writes_32MiB          37035      ← NAND 写入（32 MiB 单位）
#
# WAF = 37035 / 12345 = 3.0

# 不同厂商的 SMART 属性名称不同：
# Samsung: Total_LBAs_Written / 内部计数
# Intel:   Host_Writes_32MiB / NAND_Writes_32MiB
# Micron:  Host_Bytes_Written / NAND_Bytes_Written
```

            
```
# 持续监控 WAF 的脚本
#!/bin/bash
# monitor_waf.sh - 监控 SSD 写放大因子

DEVICE="/dev/nvme0"
INTERVAL=3600  # 每小时采样一次
LOGFILE="waf_monitor.log"

echo "timestamp,host_writes_gb,nand_writes_gb,waf" > "$LOGFILE"

while true; do
    SMART=$(sudo nvme smart-log "$DEVICE" 2>/dev/null)

    HOST_UNITS=$(echo "$SMART" | grep "data_units_written" | awk '{print $NF}' | tr -d ',')

    # 将 data_units 转换为 GB（1 unit = 512B × 1000 = 500KB）
    HOST_GB=$(echo "scale=2; $HOST_UNITS * 500 / 1024 / 1024" | bc)

    # NAND 写入量的获取方式因厂商而异
    # 这里使用 vendor-specific log page（需要根据实际 SSD 调整）
    NAND_GB=$(sudo nvme intel smart-log-add "$DEVICE" 2>/dev/null | \
              grep "nand_bytes_written" | awk '{print $NF}')

    if [ -n "$HOST_GB" ] && [ -n "$NAND_GB" ] && [ "$HOST_GB" != "0" ]; then
        WAF=$(echo "scale=2; $NAND_GB / $HOST_GB" | bc)
        echo "$(date -Iseconds),$HOST_GB,$NAND_GB,$WAF" >> "$LOGFILE"
    fi

    sleep "$INTERVAL"
done
```

            

## 五、TRIM 与空间回收

            

### 5.1 TRIM 的原理与必要性

            

文件系统删除文件时，通常只是标记 inode
            和块位图为空闲，并不会通知底层存储设备。对于 HDD
            来说这无所谓——下次写入时直接覆盖即可。但对于
            SSD，如果不知道哪些 LBA 已被删除，FTL 会认为这些 LBA
            对应的物理 Page 仍然有效，GC
            时会无意义地搬移这些已删除的数据，增加写放大。
            

TRIM（在 ATA 协议中叫 TRIM，在 NVMe 中叫 Deallocate，在
            SCSI 中叫 UNMAP）命令让操作系统告知 SSD 哪些 LBA
            不再使用。
            
```
TRIM 的工作流程：

没有 TRIM 时：
  1. 主机写入 LBA 100-199 → SSD 分配物理 Page
  2. 主机删除文件（包含 LBA 100-199）
  3. SSD 不知道删除发生，认为 LBA 100-199 仍然有效
  4. GC 时搬移 LBA 100-199 的数据（浪费）
  5. WAF 增加

有 TRIM 时：
  1. 主机写入 LBA 100-199 → SSD 分配物理 Page
  2. 主机删除文件（包含 LBA 100-199）
  3. 主机发送 TRIM 命令：LBA 100-199 已不再使用
  4. SSD 将对应物理 Page 标记为无效
  5. GC 时不需要搬移这些 Page
  6. WAF 降低
```

            

### 5.2 fstrim 与持续 TRIM

            

Linux 上使用 TRIM 有两种方式：
            
```
# 方式 1：定时批量 TRIM（fstrim）—— 推荐
# 定期扫描文件系统，将所有已删除的块通过 TRIM 通知 SSD

# 手动执行 fstrim
sudo fstrim -v /
# /: 12.5 GiB (13421772800 bytes) trimmed

# 使用 systemd timer 定期执行（大多数发行版已预置）
sudo systemctl enable fstrim.timer
sudo systemctl start fstrim.timer

# 查看 timer 状态
systemctl status fstrim.timer
# 默认每周执行一次

# 查看 timer 配置
systemctl cat fstrim.timer
# [Timer]
# OnCalendar=weekly
# AccuracySec=1h
# Persistent=true

# 方式 2：持续 TRIM（discard 挂载选项）
# 每次删除操作立即发送 TRIM

# 在 /etc/fstab 中添加 discard 选项
# /dev/nvme0n1p1  /  ext4  defaults,discard  0  1

# 或者挂载时指定
sudo mount -o discard /dev/nvme0n1p1 /mnt

# 两种方式的对比：
# ┌──────────────┬────────────────────┬────────────────────────┐
# │ 特性         │ fstrim（批量）     │ discard（持续）        │
# ├──────────────┼────────────────────┼────────────────────────┤
# │ TRIM 时机    │ 定期（每周）       │ 每次删除时立即         │
# │ 性能影响     │ 执行时短暂影响     │ 每次删除增加延迟       │
# │ 推荐程度     │ 推荐               │ 一般不推荐             │
# │ 原因         │ 批量效率高         │ 小文件删除频繁时影响大 │
# └──────────────┴────────────────────┴────────────────────────┘
```

            

### 5.3 TRIM 在
            LVM、dm-crypt 和 RAID 上的配置

            
```
# LVM 上启用 TRIM 透传
# 编辑 /etc/lvm/lvm.conf
# devices {
#     issue_discards = 1
# }

# dm-crypt / LUKS 上启用 TRIM 透传
# 编辑 /etc/crypttab，添加 discard 选项
# nvme0n1p2_crypt  UUID=xxx  none  luks,discard

# 或者打开已有 LUKS 卷时指定
sudo cryptsetup open --allow-discards /dev/nvme0n1p2 crypt_root

# 注意安全权衡：
# TRIM 在加密卷上会泄露"哪些块是空闲的"信息
# 攻击者可以推断文件系统的使用模式
# 对于高安全场景，可能需要禁用 TRIM

# MD RAID 上的 TRIM
# RAID 0/1 支持 TRIM 透传（Linux 3.7+）
# RAID 5/6 从 Linux 4.17+ 开始支持

# 检查 RAID 设备是否支持 discard
cat /sys/block/md0/queue/discard_max_bytes
# 非 0 表示支持

# 检查整个存储栈的 TRIM 支持
lsblk -D
# NAME          DISC-ALN DISC-GRAN DISC-MAX DISC-ZERO
# nvme0n1              0      512B       2T         0
# ├─nvme0n1p1          0      512B       2T         0
# └─nvme0n1p2          0      512B       2T         0
#   └─crypt_root       0      512B       2T         0
#     └─vg0-root       0      512B       2T         0
```

            

### 5.4 安全擦除与 TRIM

            
```
# TRIM 不等于安全擦除
# TRIM 后，数据可能仍然残留在 NAND 中
# 直到 GC 擦除了对应的 Block

# NVMe 安全擦除（Secure Erase）
# 擦除所有用户数据和映射表
sudo nvme format /dev/nvme0 --ses=1
# --ses=1 : User Data Erase（正常擦除）
# --ses=2 : Cryptographic Erase（密钥擦除，更快）

# SATA SSD 安全擦除
# 步骤 1：确认驱动器未被冻结
sudo hdparm -I /dev/sda | grep frozen
# not    frozen  ← 可以继续

# 步骤 2：设置安全密码
sudo hdparm --user-master u --security-set-pass p /dev/sda

# 步骤 3：执行安全擦除
sudo hdparm --user-master u --security-erase p /dev/sda

# 步骤 4：确认擦除完成
sudo hdparm -I /dev/sda | grep -i erase
```

            

## 六、磨损均衡（Wear
            Leveling）

            

### 6.1
            动态磨损均衡与静态磨损均衡

            

每个 NAND Block 的擦写次数（P/E Cycles）有上限。如果某些
            Block 被反复擦写而其他 Block 几乎不动，先到达寿命上限的
            Block 会变成坏块，导致 SSD
            可用容量下降。磨损均衡的目标是让所有 Block
            的擦写次数尽量接近。
            
```
两种磨损均衡策略：

1. 动态磨损均衡（Dynamic Wear Leveling）
   - 只在写入新数据时选择擦写次数最少的空闲 Block
   - 简单高效
   - 问题：如果某些 Block 存储了长期不变的冷数据
           这些 Block 的擦写次数永远很低
           而热数据 Block 被反复擦写
           → 磨损不均衡仍然存在

   热 Block:  ████████████████████ (擦写 10000 次)
   冷 Block:  ██                   (擦写 100 次)
   ↑ 冷数据一直不动，热 Block 先报废

2. 静态磨损均衡（Static Wear Leveling）
   - 除了动态均衡之外，还会主动搬移冷数据
   - 将冷数据从低擦写 Block 搬移到高擦写 Block
   - 释放出来的低擦写 Block 用于写入热数据
   - 所有 Block 的擦写次数趋于均匀
   - 代价：搬移冷数据增加了额外的写放大

   搬移前：
   热 Block(10000): [热数据]    冷 Block(100): [冷数据]
   搬移后：
   热 Block(10001): [冷数据]    冷 Block(101): [热数据→空闲写入]

   企业级 SSD 通常同时使用动态和静态磨损均衡。
   消费级 SSD 通常只使用动态磨损均衡。
```

            

### 6.2 SSD 耐久度：TBW 与
            DWPD

            

SSD 的写入耐久度通常用 TBW（Total Bytes
            Written，总写入量）或 DWPD（Drive Writes Per
            Day，每日全盘写入次数）来衡量。
            
```
TBW 与 DWPD 的关系：

  DWPD = TBW / (容量 × 质保天数)

  例如：
  Samsung 990 PRO 2TB：
    TBW = 1200 TB
    质保 = 5 年 = 1825 天
    DWPD = 1200 TB / (2 TB × 1825) = 0.33 DWPD
    → 每天可以写满全盘容量的 0.33 倍

  Intel DC P4610 3.2TB（企业级）：
    TBW = 17520 TB
    质保 = 5 年 = 1825 天
    DWPD = 17520 / (3.2 × 1825) = 3.0 DWPD
    → 每天可以写满全盘 3 次

TBW 理论计算：
  TBW = (NAND 容量 × P/E 寿命) / WAF

  例如：1TB TLC SSD
  NAND 容量（含 OP）= 1.1 TB（约 10% OP）
  P/E 寿命 = 3000 次
  WAF = 3（典型随机写入负载）

  TBW = 1.1 TB × 3000 / 3 = 1100 TB

  如果 WAF = 1（纯顺序写入）：
  TBW = 1.1 TB × 3000 / 1 = 3300 TB
```

            

### 6.3 工作负载耐久度估算

            
```
# 估算 SSD 在特定工作负载下的预期寿命

def estimate_ssd_lifespan(
    nand_capacity_tb,     # NAND 总容量（含 OP）
    pe_cycles,            # P/E 寿命
    daily_write_gb,       # 每日写入量（主机侧）
    waf                   # 预期写放大因子
):
    """估算 SSD 在特定工作负载下的剩余寿命"""
    total_nand_writes_tb = nand_capacity_tb * pe_cycles
    total_host_writes_tb = total_nand_writes_tb / waf
    daily_write_tb = daily_write_gb / 1024
    lifespan_days = total_host_writes_tb / daily_write_tb
    lifespan_years = lifespan_days / 365
    return lifespan_years

# 场景 1：数据库服务器（高写入负载）
years = estimate_ssd_lifespan(
    nand_capacity_tb=1.1,   # 1TB SSD，10% OP
    pe_cycles=3000,         # TLC
    daily_write_gb=200,     # 每天写 200GB
    waf=3                   # 随机写入 WAF
)
print(f"数据库场景：预期寿命 {years:.1f} 年")
# 数据库场景：预期寿命 5.6 年

# 场景 2：Web 服务器（低写入负载）
years = estimate_ssd_lifespan(
    nand_capacity_tb=1.1,
    pe_cycles=3000,
    daily_write_gb=20,      # 每天写 20GB
    waf=2                   # 较少的随机写入
)
print(f"Web 服务器：预期寿命 {years:.1f} 年")
# Web 服务器：预期寿命 82.5 年

# 场景 3：日志收集（纯顺序写入）
years = estimate_ssd_lifespan(
    nand_capacity_tb=1.1,
    pe_cycles=3000,
    daily_write_gb=500,     # 每天写 500GB
    waf=1.1                 # 顺序写入低 WAF
)
print(f"日志收集：预期寿命 {years:.1f} 年")
# 日志收集：预期寿命 6.0 年
```

            

### 6.4
            Over-Provisioning（OP）

            

Over-Provisioning（预留空间）是指 SSD 中 NAND
            实际容量超出标称容量的部分。这部分空间对主机不可见，但 SSD
            控制器可以使用它来提升 GC
            效率、降低写放大、以及作为坏块替换的备用空间。
            
```
OP 的来源与计算：

1. 固有 OP（制造商层面）
   NAND 容量通常是 2 的幂次方（如 256GiB、512GiB）
   但标称容量使用十进制（如 240GB、480GB、960GB）
   固有 OP = (GiB 容量 - GB 标称容量) / GB 标称容量
   例如：512 GiB NAND → 480 GB 标称
   固有 OP = (512 × 1.074 - 480) / 480 ≈ 14.5%

2. 额外 OP（企业级 SSD）
   企业级 SSD 通常在固有 OP 基础上额外预留
   例如：512 GiB NAND → 400 GB 标称
   总 OP ≈ 37%

3. 用户手动 OP
   用户可以通过不使用全部容量来创建额外 OP

OP 对写放大和寿命的影响：
  ┌──────────┬──────────┬──────────┬──────────────────┐
  │ OP 比例  │ 典型 WAF │ 寿命倍率 │ 适用场景         │
  ├──────────┼──────────┼──────────┼──────────────────┤
  │ 7%       │ 3.0-5.0  │ 1x       │ 消费级读密集     │
  │ 14%      │ 2.0-3.5  │ 1.5x     │ 消费级/轻企业    │
  │ 28%      │ 1.5-2.5  │ 2.5x     │ 企业级混合负载   │
  │ 50%      │ 1.2-1.8  │ 4x       │ 企业级写密集     │
  └──────────┴──────────┴──────────┴──────────────────┘
```

            
```
# 在 NVMe SSD 上手动设置 OP（通过 Namespace 管理）

# 查看 NAND 总容量
sudo nvme id-ctrl /dev/nvme0 | grep tnvmcap
# tnvmcap : 1024209543168   ← NAND 总容量（字节）

# 查看当前 Namespace 大小
sudo nvme id-ns /dev/nvme0n1 | grep "^nsze"
# nsze : 1953525168  ← 当前容量（512B 扇区数）

# 设置 10% 额外 OP（假设支持 Namespace 管理）
# 总容量 1953525168 扇区
# 减少 10%：1953525168 × 0.9 = 1758172651 扇区

# 步骤 1：删除现有 Namespace
sudo nvme delete-ns /dev/nvme0 -n 1

# 步骤 2：创建较小的 Namespace
sudo nvme create-ns /dev/nvme0 \
    --nsze=1758172651 \
    --ncap=1758172651 \
    --block-size=512 \
    --flbas=0

# 步骤 3：附加 Namespace
sudo nvme attach-ns /dev/nvme0 --namespace-id=1 --controllers=0

# 简单方法：用 hdparm 设置（部分 SSD 支持）
sudo hdparm -N p1758172651 /dev/sda
```

            

### 6.5 SMART 监控 SSD 寿命

            
```
# NVMe SSD SMART 监控
sudo nvme smart-log /dev/nvme0

# 关键指标：
# critical_warning      : 0        ← 非 0 表示告警
# temperature           : 35 C     ← 温度
# available_spare       : 100%     ← 可用备用块百分比
# available_spare_threshold : 10%  ← 备用块告警阈值
# percentage_used       : 3%       ← 已用寿命百分比
# data_units_written    : 12345678 ← 主机写入量
# media_errors          : 0        ← 介质错误数
# num_err_log_entries   : 0        ← 错误日志条目数

# percentage_used 是最直接的寿命指标：
# 0% = 全新
# 100% = 达到标称寿命（不意味着立即失效）
# >100% = 超出标称寿命，随时可能失效

# SATA SSD SMART 监控
sudo smartctl -A /dev/sda

# 关键属性：
# 5   Reallocated_Sector_Ct    ← 重映射扇区数
# 9   Power_On_Hours           ← 通电小时数
# 177 Wear_Leveling_Count      ← 磨损均衡计数
# 179 Used_Rsvd_Blk_Cnt_Tot    ← 已使用备用块数
# 241 Total_LBAs_Written       ← 主机写入量
# 242 Total_LBAs_Read          ← 主机读取量

# 设置 SMART 告警
sudo smartctl -H /dev/sda
# SMART overall-health self-assessment test result: PASSED
```

            
```
#!/bin/bash
# ssd_health_check.sh - SSD 健康检查脚本

echo "====== SSD 健康检查报告 ======"
echo "时间: $(date)"
echo ""

for dev in /dev/nvme?; do
    if [ -e "$dev" ]; then
        echo "--- 设备: $dev ---"

        # 获取型号
        MODEL=$(sudo nvme id-ctrl "$dev" 2>/dev/null | grep "^mn" | sed 's/mn.*: //')
        echo "型号: $MODEL"

        # 获取 SMART 数据
        SMART=$(sudo nvme smart-log "$dev" 2>/dev/null)

        TEMP=$(echo "$SMART" | grep "temperature" | head -1 | awk '{print $3}')
        SPARE=$(echo "$SMART" | grep "available_spare " | awk '{print $3}')
        USED=$(echo "$SMART" | grep "percentage_used" | awk '{print $3}')
        WRITTEN=$(echo "$SMART" | grep "data_units_written" | awk '{print $NF}' | tr -d ',')
        ERRORS=$(echo "$SMART" | grep "media_errors" | awk '{print $NF}')
        WARNING=$(echo "$SMART" | grep "critical_warning" | awk '{print $NF}')

        echo "温度: ${TEMP} C"
        echo "可用备用块: ${SPARE}"
        echo "已用寿命: ${USED}"
        echo "介质错误: ${ERRORS}"
        echo "告警状态: ${WARNING}"

        # 计算主机写入量（TB）
        if [ -n "$WRITTEN" ]; then
            WRITTEN_TB=$(echo "scale=2; $WRITTEN * 500 / 1024 / 1024 / 1024" | bc)
            echo "主机总写入: ${WRITTEN_TB} TB"
        fi

        # 健康判断
        USED_NUM=$(echo "$USED" | tr -d '%')
        if [ -n "$USED_NUM" ]; then
            if [ "$USED_NUM" -ge 90 ]; then
                echo "状态: 警告 - 寿命即将耗尽，请准备更换"
            elif [ "$USED_NUM" -ge 70 ]; then
                echo "状态: 注意 - 寿命已消耗 70% 以上"
            else
                echo "状态: 正常"
            fi
        fi

        echo ""
    fi
done
```

            

## 七、SSD 性能特性

            

### 7.1 Fresh 与
            Steady-State 性能

            

新 SSD（或刚执行过安全擦除的
            SSD）的性能通常远高于使用一段时间后的”稳态性能”。大多数厂商公布的性能数据是
            Fresh 状态的，这会误导采购决策。
            
```
Fresh vs Steady-State 性能差异：

Fresh 状态（FOB, Fresh Out of Box）：
  - 所有 Block 都是空闲的
  - 写入直接分配空闲 Page，无需 GC
  - 性能最高
  - 这是厂商规格表上的数据

Steady-State（稳态）：
  - SSD 已被写满至少 2 次
  - 空闲 Block 有限，写入经常触发 GC
  - 性能显著下降并趋于稳定
  - 这才是生产环境中的实际性能

稳态性能通常是 Fresh 性能的多少：
  ┌──────────────────────┬────────────┬────────────┬──────────┐
  │ 指标                 │ Fresh      │ Steady     │ 下降比例 │
  ├──────────────────────┼────────────┼────────────┼──────────┤
  │ 4KB 随机写 IOPS      │ 500K       │ 100-200K   │ 60-80%   │
  │ 4KB 随机读 IOPS      │ 800K       │ 600-700K   │ 12-25%   │
  │ 顺序写吞吐           │ 5 GB/s     │ 2-3 GB/s   │ 40-60%   │
  │ 顺序读吞吐           │ 7 GB/s     │ 6.5-7 GB/s │ 0-7%     │
  │ 4KB 写延迟 P99       │ 30 us      │ 200-500 us │ 10-15x   │
  └──────────────────────┴────────────┴────────────┴──────────┘

  注意 P99 延迟的巨大差异——这是 GC 和内部调度的直接后果。
```

            
```
# SNIA 推荐的 SSD 性能测试流程（SNIA PTS）
# 目标：测量稳态性能，避免被 Fresh 性能误导

# 步骤 1：安全擦除
sudo nvme format /dev/nvme0 --ses=1

# 步骤 2：预处理（Preconditioning）—— 写满两次
fio --name=precondition \
    --filename=/dev/nvme0n1 \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --size=100% \
    --loops=2

# 步骤 3：稳态确认（连续跑多轮，确认 IOPS 趋于稳定）
for round in $(seq 1 10); do
    fio --name="steady_check_$round" \
        --filename=/dev/nvme0n1 \
        --ioengine=libaio \
        --direct=1 \
        --rw=randwrite \
        --bs=4k \
        --iodepth=32 \
        --runtime=60 \
        --time_based \
        --output-format=json \
        --output="result_round_${round}.json"
    sleep 5
done

# 步骤 4：分析各轮 IOPS，确认波动 
            

### 7.2 读写不对称

            
```
SSD 的读写不对称性：

1. 延迟不对称
   - 读延迟  写吞吐（通常 1.5x-2x）
   - 写入受限于 NAND Program 速度和 GC 开销

3. IOPS 不对称
   - 随机读 IOPS >> 随机写 IOPS
   - 随机写受 GC 和 WAF 影响

4. 寿命不对称
   - 读操作不消耗 P/E 寿命（但有 Read Disturb）
   - 写操作直接消耗 P/E 寿命

工程影响：
  - 读密集型负载最适合 SSD
  - 写密集型负载需要关注 WAF 和寿命
  - 混合负载需要平衡读写性能需求
```

            

### 7.3 队列深度对性能的影响

            

NVMe SSD 内部有多个 Die 和 Plane
            可以并行操作。要充分利用这种并行性，需要足够的队列深度（Queue
            Depth，QD）。
            
```
队列深度与 IOPS 的关系：

  QD=1 时：
  Host:  Send → Wait → Send → Wait → ...
  SSD:   Exec ─────── Exec ─────── ...
  → SSD 大部分时间在等待下一个命令
  → IOPS 低，延迟低

  QD=32 时：
  Host:  Send Send Send ... (队列中总有命令)
  SSD:   Exec Exec Exec ... (多 Die 并行)
  → SSD 内部充分并行
  → IOPS 高，但单个请求延迟也高（排队）

典型 NVMe SSD 的 QD-IOPS 关系：
  ┌─────┬──────────────┬──────────────┬──────────────┐
  │ QD  │ 随机读 IOPS  │ 随机写 IOPS  │ 平均延迟     │
  ├─────┼──────────────┼──────────────┼──────────────┤
  │  1  │ 15K          │ 60K          │ 12 us / 15us │
  │  4  │ 80K          │ 150K         │ 48 us / 25us │
  │ 16  │ 350K         │ 300K         │ 45 us / 50us │
  │ 32  │ 600K         │ 400K         │ 52 us / 78us │
  │ 64  │ 750K         │ 450K         │ 84 us / 140us│
  │ 128 │ 800K         │ 470K         │ 160us / 270us│
  │ 256 │ 800K         │ 480K         │ 320us / 530us│
  └─────┴──────────────┴──────────────┴──────────────┘

  观察：
  - QD=1 到 QD=32：IOPS 近似线性增长
  - QD>64：IOPS 增长趋于平缓（达到 NAND 带宽瓶颈）
  - 延迟随 QD 增加而增加（排队效应）
  - 数据库查询通常 QD=1-4，批量扫描可以 QD=32+
```

            
```
# 测量不同队列深度的性能
for qd in 1 4 16 32 64 128 256; do
    echo "=== QD=$qd ==="
    fio --name="qd_test" \
        --filename=/dev/nvme0n1 \
        --ioengine=libaio \
        --direct=1 \
        --rw=randread \
        --bs=4k \
        --iodepth=$qd \
        --runtime=30 \
        --time_based \
        --group_reporting \
        2>/dev/null | grep -E "IOPS|lat.*avg"
done
```

            

### 7.4 温度限流（Thermal
            Throttling）

            
```
# NVMe SSD 温度监控
sudo nvme smart-log /dev/nvme0 | grep -i temp
# temperature                          : 42 C
# Temperature Sensor 1                 : 42 C
# Temperature Sensor 2                 : 55 C

# 查看温度阈值
sudo nvme id-ctrl /dev/nvme0 | grep -i "wctemp\|cctemp"
# wctemp : 358   ← Warning Composite Temperature (85°C, 单位 Kelvin)
# cctemp : 361   ← Critical Composite Temperature (88°C)

# 超过 wctemp：SSD 发出温度警告，可能开始限流
# 超过 cctemp：SSD 强制限流或关闭以保护硬件

# 持续温度监控
watch -n 1 "sudo nvme smart-log /dev/nvme0 2>/dev/null | grep temperature"

# 温度限流对性能的影响：
# 正常温度（ 85°C）：性能可能下降 80%+

# 散热建议：
# 1. NVMe SSD 安装散热片
# 2. 确保机箱气流经过 M.2 插槽
# 3. 在服务器中使用 U.2 / EDSFF 形态（散热更好）
# 4. 避免在主板背面安装高负载 SSD
```

            

### 7.5
            性能对比：SATA SSD vs NVMe SSD vs HDD

            
```
三种存储设备的性能对比：

┌────────────────────┬───────────────┬───────────────┬───────────────┐
│ 指标               │ HDD(7200RPM)  │ SATA SSD      │ NVMe SSD      │
│                    │               │ (SATA III)    │ (PCIe 4.0 x4) │
├────────────────────┼───────────────┼───────────────┼───────────────┤
│ 接口带宽           │ 6 Gbps(SATA)  │ 6 Gbps(SATA)  │ ~8 GB/s       │
│ 顺序读             │ 150-250 MB/s  │ 500-560 MB/s  │ 5-7 GB/s      │
│ 顺序写             │ 150-250 MB/s  │ 450-530 MB/s  │ 3-5 GB/s      │
│ 随机读 IOPS(QD32)  │ 100-200       │ 90K-100K      │ 500K-1000K    │
│ 随机写 IOPS(QD32)  │ 100-200       │ 80K-90K       │ 300K-500K     │
│ 随机读延迟(QD1)    │ 8-12 ms       │ 50-100 us     │ 10-20 us      │
│ 随机写延迟(QD1)    │ 8-12 ms       │ 50-100 us     │ 10-30 us      │
│ 功耗（活动）       │ 6-10 W        │ 2-4 W         │ 5-8 W         │
│ 功耗（待机）       │ 4-6 W         │ 0.05-0.1 W    │ 0.03-0.05 W   │
│ 每 GB 成本         │ ~$0.015       │ ~$0.07        │ ~$0.08        │
│ 每 IOPS 成本       │ ~$2.00        │ ~$0.005       │ ~$0.001       │
│ 耐久度             │ 无限写入      │ 有限(TBW)     │ 有限(TBW)     │
│ 抗震性             │ 差            │ 好            │ 好            │
│ 队列深度           │ NCQ 32        │ NCQ 32        │ 65535×64K     │
│ 协议开销           │ 高(AHCI)      │ 高(AHCI)      │ 低(NVMe)      │
└────────────────────┴───────────────┴───────────────┴───────────────┘

关键观察：
  1. SATA SSD 受限于 SATA III 接口（~560 MB/s 上限）
  2. NVMe SSD 的顺序带宽是 SATA SSD 的 10 倍以上
  3. 随机 IOPS 的差距更大：NVMe 是 HDD 的 5000 倍
  4. 每 IOPS 成本：NVMe SSD 最低（性能密度最高）
  5. 每 GB 成本：HDD 仍然最低（容量密度最高）
```

            

## 八、SSD 故障模式

            

### 8.1 磨损失效（Wear-Out
            Failure）

            

NAND Flash 的隧道氧化层在反复的 Program / Erase
            操作中会逐渐劣化。电子被反复注入和抽出的过程中，部分电子会被困在氧化层中（Charge
            Trapping），导致阈值电压漂移，最终使 Cell
            无法可靠存储数据。
            
```
磨损失效的机制：

  新 Cell（0 次 P/E）：
  阈值电压分布窄，电压等级间隔大
  → 读取容易区分 → 错误率极低

  ┌───────┐     ┌───────┐     ┌───────┐     ┌───────┐
  │  "11" │     │  "01" │     │  "00" │     │  "10" │
  └───┬───┘     └───┬───┘     └───┬───┘     └───┬───┘
      V1            V2            V3            V4
      ←── 间距大 ──→

  老化 Cell（接近 P/E 寿命）：
  阈值电压分布变宽，电压等级开始重叠
  → 读取难以区分 → 错误率上升

  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
  │  "11"   │ │  "01"   │ │  "00"   │ │  "10"   │
  └───┬─────┘ └──┬──────┘ └──┬──────┘ └───┬─────┘
      V1          V2          V3          V4
      ←── 间距小，分布重叠 ──→

  SSD 控制器应对策略：
  1. 更强的 ECC（LDPC 码取代 BCH 码）
  2. 读重试（Read Retry）：调整参考电压重新读取
  3. 数据刷新（Data Refresh）：读取错误率上升时主动搬移数据
  4. 坏块替换：Block 错误率过高时标记为坏块
```

            

### 8.2 读干扰与写干扰

            
```
Read Disturb（读干扰）：
  读取一个 Page 时，同一 Block 中其他 Page 的 Cell
  会受到微弱的电压干扰
  → 反复读取同一 Block 会导致相邻 Page 的数据翻转
  → 通常在 10 万到 100 万次读取后显现
  → SSD 控制器通过计数读取次数并主动搬移数据来应对

Program Disturb（写干扰）：
  写入一个 Page 时，同一 Block 中已编程的 Page
  会受到 Pass Voltage 的干扰
  → 可能导致已写入 Page 的位翻转
  → SSD 控制器通过 ECC 和验证机制来处理

应对措施：
  - Read Disturb 计数：跟踪每个 Block 被读取的次数
  - 达到阈值时主动将 Block 数据搬移到新 Block
  - 这也是写放大的一个来源（虽然通常很小）
```

            

### 8.3 数据保留（Data
            Retention）

            

NAND Flash
            中存储的电荷会随时间缓慢泄漏。断电后数据的保持时间取决于
            Cell 类型和已使用的 P/E 次数。
            
```
数据保留时间：

  ┌──────────┬────────────────────┬────────────────────┐
  │ 条件     │ 企业级 SSD（通电） │ 消费级 SSD（断电） │
  ├──────────┼────────────────────┼────────────────────┤
  │ 新 SSD   │ > 3 个月           │ > 12 个月          │
  │ 50% 寿命 │ > 3 个月           │ > 6 个月           │
  │ 接近寿命 │ > 3 个月           │ > 3 个月           │
  └──────────┴────────────────────┴────────────────────┘

  JEDEC 标准要求（JESD218A）：
  - 企业级 SSD：通电状态下 3 个月数据保持
  - 消费级 SSD：断电状态下 12 个月数据保持

  温度对数据保留的影响：
  - 存储温度越高，电荷泄漏越快
  - 40°C 存储：正常保持
  - 55°C 存储：保持时间减半
  - 85°C 存储：保持时间可能仅数周

  工程建议：
  1. 不要用 SSD 做长期冷存储（断电存放）
  2. 定期给 SSD 通电让控制器刷新数据
  3. 归档场景优先使用 HDD 或磁带
```

            

### 8.4 突然掉电的影响

            
```
掉电场景分析：

1. 未完成的写入
   - Page 只写了一部分 → 数据损坏
   - 多 Page 写入中途断电 → 部分 Page 有效，部分损坏
   - 企业级 SSD 的电容备份可以完成写入

2. 映射表丢失
   - DRAM 中的映射表未刷写到 NAND → 丢失
   - 恢复方式：扫描整个 NAND 重建映射表
   - 恢复时间：可能数分钟（取决于容量）
   - 部分数据可能永久丢失（无法确定新旧映射）

3. GC 中途掉电
   - 有效 Page 已搬移，但旧 Block 尚未擦除
   - 存在数据重复（新旧位置都有数据）
   - FTL 需要通过日志确定哪个是最新版本

掉电保护等级：
  ┌──────────────┬──────────────────────────────────────────┐
  │ 等级         │ 保护范围                                 │
  ├──────────────┼──────────────────────────────────────────┤
  │ 无保护       │ 可能丢失数据、损坏映射表                 │
  │ 元数据保护   │ 保护映射表和内部元数据，用户数据可能丢失 │
  │ 完整保护     │ 保护映射表和缓存中的用户数据（电容备份） │
  └──────────────┴──────────────────────────────────────────┘
```

            

### 8.5 SMART 属性与 SSD
            故障预测

            
```
# 需要重点关注的 SMART 属性

# NVMe SSD
sudo nvme smart-log /dev/nvme0

# 关键告警指标：
# 1. critical_warning
#    Bit 0: 可用备用块低于阈值
#    Bit 1: 温度超过阈值
#    Bit 2: NVM 子系统可靠性降级
#    Bit 3: 介质进入只读模式
#    Bit 4: 易失性存储器备份设备故障

# 2. percentage_used
#    > 100% → 已超出标称寿命

# 3. available_spare
#    接近 available_spare_threshold → 需要更换

# 4. media_errors
#    持续增长 → 介质正在退化

# SATA SSD 关键属性
# ID 5:   Reallocated_Sector_Ct  → 坏块替换次数（持续增长=退化）
# ID 187: Reported_Uncorrect     → 不可纠正错误（非0=数据可能丢失）
# ID 188: Command_Timeout        → 命令超时（高值=控制器异常）
# ID 197: Current_Pending_Sector → 等待重映射的扇区（非0=坏块即将出现）
# ID 198: Offline_Uncorrectable  → 离线不可纠正错误
# ID 199: UDMA_CRC_Error_Count   → 接口错误（可能是线缆问题）
# ID 233: Media_Wearout_Indicator→ 介质磨损指示器（0=寿命耗尽）
```

            
```
#!/bin/bash
# ssd_failure_predict.sh - SSD 故障预测脚本

ALERT_THRESHOLD_USED=80      # 已用寿命告警阈值（%）
ALERT_THRESHOLD_SPARE=20     # 可用备用块告警阈值（%）
ALERT_THRESHOLD_TEMP=75      # 温度告警阈值（°C）

check_nvme_health() {
    local dev=$1
    local alerts=""

    SMART=$(sudo nvme smart-log "$dev" 2>/dev/null)
    if [ $? -ne 0 ]; then
        echo "  无法读取 SMART 数据"
        return
    fi

    # 检查 critical_warning
    CW=$(echo "$SMART" | grep "critical_warning" | awk '{print $NF}')
    if [ "$CW" != "0" ] && [ -n "$CW" ]; then
        alerts="${alerts}  [严重] critical_warning = $CW\n"
    fi

    # 检查 percentage_used
    USED=$(echo "$SMART" | grep "percentage_used" | awk '{print $3}' | tr -d '%')
    if [ -n "$USED" ] && [ "$USED" -ge "$ALERT_THRESHOLD_USED" ]; then
        alerts="${alerts}  [警告] 已用寿命 ${USED}% (阈值 ${ALERT_THRESHOLD_USED}%)\n"
    fi

    # 检查 available_spare
    SPARE=$(echo "$SMART" | grep "available_spare " | awk '{print $3}' | tr -d '%')
    if [ -n "$SPARE" ] && [ "$SPARE" -le "$ALERT_THRESHOLD_SPARE" ]; then
        alerts="${alerts}  [警告] 可用备用块 ${SPARE}% (阈值 ${ALERT_THRESHOLD_SPARE}%)\n"
    fi

    # 检查温度
    TEMP=$(echo "$SMART" | grep "temperature" | head -1 | awk '{print $3}')
    if [ -n "$TEMP" ] && [ "$TEMP" -ge "$ALERT_THRESHOLD_TEMP" ]; then
        alerts="${alerts}  [警告] 温度 ${TEMP}°C (阈值 ${ALERT_THRESHOLD_TEMP}°C)\n"
    fi

    # 检查介质错误
    MERR=$(echo "$SMART" | grep "media_errors" | awk '{print $NF}')
    if [ "$MERR" != "0" ] && [ -n "$MERR" ]; then
        alerts="${alerts}  [警告] 介质错误数 = $MERR\n"
    fi

    if [ -z "$alerts" ]; then
        echo "  状态: 健康"
    else
        echo -e "$alerts"
    fi
}

echo "====== SSD 故障预测检查 ======"
echo "时间: $(date)"

for dev in /dev/nvme?; do
    if [ -e "$dev" ]; then
        echo ""
        echo "设备: $dev"
        check_nvme_health "$dev"
    fi
done
```

            

## 九、SSD 调优实战

            

### 9.1 分区对齐

            

分区未对齐到 NAND Page 边界会导致每次写入跨越两个物理
            Page，写放大翻倍。现代分区工具默认对齐到 1 MiB
            边界（远大于任何 Page 大小），但仍需要验证。
            
```
# 检查分区对齐
sudo parted /dev/nvme0n1 align-check optimal 1
# 1 aligned

# 查看分区起始位置
sudo fdisk -l /dev/nvme0n1
# Device            Start        End   Sectors   Size Type
# /dev/nvme0n1p1     2048    1050623   1048576   512M EFI System
# /dev/nvme0n1p2  1050624 1953525134 1952474511 930.9G Linux filesystem

# 验证：起始扇区 2048 × 512B = 1 MiB → 对齐正确

# 如果发现未对齐（老系统迁移），需要重新分区
# 使用 parted 创建对齐的分区
sudo parted /dev/nvme0n1 mkpart primary ext4 1MiB 100%
```

            

### 9.2 I/O 调度器选择

            
```
# 查看当前 I/O 调度器
cat /sys/block/nvme0n1/queue/scheduler
# [none] mq-deadline kyber bfq

# NVMe SSD 推荐调度器：
# 1. none（noop）—— 推荐
#    不做任何排序和合并，直接提交给设备
#    NVMe SSD 内部有自己的调度逻辑
#    消除了不必要的软件层延迟
#    适用于大多数场景

# 2. kyber —— 延迟敏感场景
#    针对快速设备设计的调度器
#    分为两个队列：read 和 write
#    设置延迟目标，动态调整队列深度
#    适用于混合读写且对延迟敏感的场景

# 3. mq-deadline —— 保证公平性
#    确保请求不会饿死
#    适用于多用户共享 SSD 的场景

# 4. bfq —— 桌面交互场景
#    保证交互式应用的低延迟
#    不适合服务器

# 设置调度器
echo "none" | sudo tee /sys/block/nvme0n1/queue/scheduler

# 永久设置（通过 udev 规则）
# /etc/udev/rules.d/60-scheduler.rules
# ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
# ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/scheduler}="mq-deadline"
# ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="1", ATTR{queue/scheduler}="bfq"
```

            

### 9.3 文件系统选择

            
```
# SSD 上的文件系统选择

# ext4 —— 默认选择，广泛支持
sudo mkfs.ext4 -E discard /dev/nvme0n1p1
# -E discard : 启用持续 TRIM（可选，也可用 fstrim 替代）

# XFS —— 大文件、高吞吐
sudo mkfs.xfs /dev/nvme0n1p1
# XFS 默认不启用 discard，推荐使用 fstrim

# F2FS —— 专为 Flash 设计的日志结构文件系统
sudo mkfs.f2fs -f /dev/nvme0n1p1
# F2FS 的优势：
# 1. 日志结构设计，减少随机写入
# 2. 多头日志（Multi-Head Logging），利用 SSD 内部并行性
# 3. 自适应日志（Adaptive Logging）
# 4. 内置 TRIM 支持
# 适用场景：Android 设备、嵌入式系统、写密集型负载

# 文件系统对比（SSD 场景）：
# ┌──────────┬──────────────┬──────────────┬──────────────┐
# │ 特性     │ ext4         │ XFS          │ F2FS         │
# ├──────────┼──────────────┼──────────────┼──────────────┤
# │ 成熟度   │ 非常高       │ 高           │ 中等         │
# │ 随机写入 │ 一般         │ 好           │ 很好         │
# │ 大文件   │ 好           │ 很好         │ 一般         │
# │ 元数据   │ 一般         │ 好           │ 好           │
# │ TRIM     │ 支持         │ 支持         │ 原生支持     │
# │ 恢复     │ fsck 快      │ xfs_repair   │ fsck.f2fs    │
# │ 适用场景 │ 通用         │ 大文件/数据库│ Flash 优化   │
# └──────────┴──────────────┴──────────────┴──────────────┘

# 挂载选项优化（ext4 为例）
# /etc/fstab
# /dev/nvme0n1p1 / ext4 defaults,noatime,nodiratime 0 1
#
# noatime : 不更新文件访问时间 → 减少写入量 → 降低 WAF
# nodiratime : 不更新目录访问时间
# 注意：relatime 是 Linux 默认值，已经大幅减少了 atime 更新
```

            

### 9.4 数据库调优（MySQL /
            PostgreSQL）

            
```
# MySQL 在 SSD 上的调优

# my.cnf 关键参数
# [mysqld]

# 1. InnoDB I/O 容量 —— SSD 可以处理更多 IOPS
# innodb_io_capacity = 10000
# innodb_io_capacity_max = 20000
# HDD 默认值是 200，SSD 上可以设置为 5000-20000

# 2. 刷新方式 —— 使用 O_DIRECT 绕过 OS 缓存
# innodb_flush_method = O_DIRECT
# 避免双重缓存（InnoDB Buffer Pool + OS Page Cache）

# 3. Buffer Pool —— SSD 上可以适当减小
# innodb_buffer_pool_size = 物理内存的 50-70%
# HDD 上通常设置为 80%，SSD 上即使缓存未命中也很快

# 4. 随机读预读 —— SSD 上关闭
# innodb_random_read_ahead = OFF
# 因为 SSD 随机读很快，预读的收益不大

# 5. 日志文件 —— 可以增大
# innodb_log_file_size = 2G
# SSD 上写入速度快，更大的日志文件减少检查点频率

# 6. 并发线程 —— SSD 上可以增加
# innodb_read_io_threads = 8
# innodb_write_io_threads = 8
```

            
```
# PostgreSQL 在 SSD 上的调优

# postgresql.conf 关键参数

# 1. random_page_cost —— SSD 上降低
# random_page_cost = 1.1
# 默认值 4.0 是为 HDD 设计的（随机读远慢于顺序读）
# SSD 上随机读和顺序读差距很小
# 设置为 1.1 让优化器更愿意使用索引扫描

# 2. effective_io_concurrency —— SSD 上增加
# effective_io_concurrency = 200
# 告诉优化器存储设备能同时处理多少并发 I/O
# HDD 默认 1，SSD 可以设置 200

# 3. maintenance_io_concurrency
# maintenance_io_concurrency = 10
# VACUUM、CREATE INDEX 等维护操作的并发度

# 4. wal_compression —— 开启
# wal_compression = on
# 减少 WAL 写入量 → 降低 SSD 写放大

# 5. checkpoint_completion_target
# checkpoint_completion_target = 0.9
# 将检查点写入分散到更长时间，减少突发写入

# 6. max_wal_size / min_wal_size
# max_wal_size = 4GB
# min_wal_size = 1GB
# SSD 上可以增大，减少检查点频率
```

            

### 9.5 其他调优参数

            
```
# Linux 内核参数优化

# 1. 预读设置 —— SSD 上减小
cat /sys/block/nvme0n1/queue/read_ahead_kb
# 默认 128，SSD 上可以减小到 8-32
echo 32 | sudo tee /sys/block/nvme0n1/queue/read_ahead_kb

# 2. 脏页刷写策略 —— 减少大批量刷写
# /etc/sysctl.conf
# vm.dirty_ratio = 10
# vm.dirty_background_ratio = 5
# 减小脏页比例，更频繁地刷写，避免突发大量写入

# 3. swappiness —— SSD 上可以适当降低
# vm.swappiness = 10
# 减少 swap 使用，降低 SSD 写入量
# 如果 SSD 上有 swap 分区，建议 swappiness 设低

# 4. NVMe 队列数量
cat /sys/block/nvme0n1/queue/nr_requests
# 默认 1023，通常不需要修改

# 5. 检查和设置 NVMe 电源状态
sudo nvme get-feature /dev/nvme0 -f 0x02
# 服务器环境建议禁用低功耗状态以降低延迟
sudo nvme set-feature /dev/nvme0 -f 0x02 -v 0
```

            
```
# SSD 调优检查清单

echo "====== SSD 调优检查 ======"

# 1. 分区对齐
echo "--- 分区对齐 ---"
for part in /dev/nvme0n1p*; do
    START=$(cat /sys/class/block/$(basename $part)/start 2>/dev/null)
    if [ -n "$START" ]; then
        ALIGNED=$((START % 2048))
        if [ $ALIGNED -eq 0 ]; then
            echo "$part: 对齐 (起始扇区 $START)"
        else
            echo "$part: 未对齐! (起始扇区 $START)"
        fi
    fi
done

# 2. I/O 调度器
echo ""
echo "--- I/O 调度器 ---"
for dev in /sys/block/nvme*; do
    SCHED=$(cat "$dev/queue/scheduler" 2>/dev/null)
    echo "$(basename $dev): $SCHED"
done

# 3. TRIM 支持
echo ""
echo "--- TRIM 支持 ---"
lsblk -D 2>/dev/null | head -5

# 4. fstrim timer
echo ""
echo "--- fstrim timer ---"
systemctl is-enabled fstrim.timer 2>/dev/null || echo "未启用"

# 5. 挂载选项
echo ""
echo "--- 挂载选项 ---"
mount | grep -E "nvme|ssd" | awk '{print $1, $3, $6}'

# 6. 预读设置
echo ""
echo "--- 预读设置 ---"
for dev in /sys/block/nvme*; do
    RA=$(cat "$dev/queue/read_ahead_kb" 2>/dev/null)
    echo "$(basename $dev): ${RA} KB"
done
```

            

## 参考文献

            
            
- Micron Technology, “NAND Flash 101: An Introduction to
            NAND Flash and How to Design It In to Your Next Product,”
            Technical Note TN-29-19, 2006.
            
- Agrawal, N., Prabhakaran, V., Wobber, T., Davis, J. D.,
            Manasse, M., Panigrahy, R., “Design Tradeoffs for SSD
            Performance,” USENIX ATC, 2008.
            
- Gupta, A., Kim, Y., Urgaonkar, B., “DFTL: A Flash
            Translation Layer Employing Demand-based Selective Caching
            of Page-level Address Mappings,” ASPLOS, 2009.
            
- Hu, X. Y., Eleftheriou, E., Haas, R., Iliadis, I.,
            Pletka, R., “Write Amplification Analysis in Flash-Based
            Solid State Drives,” SYSTOR, 2009.
            
- Desnoyers, P., “Analytic Models of SSD Write
            Performance,” ACM Transactions on Storage, 2014.
            
- JEDEC, “Solid-State Drive (SSD) Requirements and
            Endurance Test Method,” JESD218B, 2016.
            
- SNIA, “Solid State Storage Performance Test
            Specification (PTS),” SNIA, 2013.
            
            
            

**上一篇**: HDD
            机械硬盘：旋转时代的工程遗产 **下一篇**: NVMe
            协议与存储接口演进
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。
                

                
                    

2025-09-09 · storage
                    

### 【存储工程】LSM-Tree 工程调优：三种放大的权衡

                    

LSM-Tree 的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过 MemTable 刷盘、再经过多次 Compaction 合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个 key 时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在 Co…
                

                
                    

2025-09-02 · storage
                    

### 【存储工程】存储引擎概览：堆文件到 LSM-Tree 的演化路径

                    

数据库系统的架构可以划分为两大层：上层的查询处理层负责解析 SQL、生成执行计划、优化查询；下层的存储引擎（Storage Engine）负责把数据持久化到磁盘，并在需要时高效地把数据取回来。查询处理层决定"做什么"，存储引擎决定"怎么存、怎么取"。同一个查询处理层可以对接不同的存储引擎——MySQL 的 InnoDB…
                

                
                    

2025-09-01 · storage
                    

### 【存储工程】存储快照与精简配置

                    

存储系统有两个看似独立、实则紧密交织的能力：快照（Snapshot）和精简配置（Thin Provisioning）。快照解决的是"时间维度"的问题——在任意时刻冻结数据状态，用于备份、回滚或测试；精简配置解决的是"空间维度"的问题——让存储容量按需分配，避免预先占满物理磁盘。两者的交叉点在于写时复制（Copy-on-…