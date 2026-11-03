# 【存储工程】存储介质选型指南

来源: https://quant67.com/post/storage/06-storage-media-selection/storage-media-selection.html
日期: 2025-08-15 |

---

存储选型是每个基础设施工程师都会遇到的决策，但很多团队的选型过程停留在”数据库用
            SSD，备份用 HDD”这种粗粒度判断上。实际情况要复杂得多：一个
            MySQL 主库和一个 Elasticsearch 集群虽然都”需要 SSD”，但对
            IOPS（Input/Output Operations Per
            Second）、延迟、吞吐的要求完全不同，选型结论也不一样。
            

选型的核心矛盾是：性能、容量、成本三者不可兼得。每种介质在这三个维度上的位置不同，没有”最好的存储”，只有”最适合这个工作负载的存储”。
            

本文的目标是建立一个系统化的选型方法：先理解每种介质的性能边界和成本结构，再根据工作负载特征匹配介质，最后通过分层架构在成本和性能之间找到平衡。
            

## 一、存储介质全景

            

### 1.1 当前主流存储介质

            

存储介质按访问速度从慢到快，大致可以分为五类：
            
```
磁带（Tape）
  └─ 容量密端，成本最低，但只能顺序访问
HDD（Hard Disk Drive，机械硬盘）
  └─ 旋转磁盘 + 机械臂寻址，随机 I/O 受限于物理运动
SATA SSD（Serial ATA Solid State Drive）
  └─ NAND Flash 存储，SATA 接口，带宽上限 ~600 MB/s
NVMe SSD（Non-Volatile Memory Express）
  └─ NAND Flash 存储，PCIe 直连，带宽可达数 GB/s
Optane / PMem（Persistent Memory，持久内存）
  └─ 3D XPoint 介质，字节寻址，延迟接近 DRAM
```

            

每类介质的核心参数差异如下：
            
```
介质类型       | 随机读 IOPS  | 随机写 IOPS  | 顺序读带宽    | 延迟（读）   | 容量范围       | $/GB
--------------|-------------|-------------|-------------|------------|--------------|--------
HDD 7200RPM   | 80-200      | 80-200      | 150-250 MB/s | 3-10 ms    | 2-24 TB      | 0.015-0.025
SATA SSD      | 50K-100K    | 30K-80K     | 500-560 MB/s | 50-150 μs  | 240 GB-8 TB  | 0.06-0.12
NVMe SSD      | 500K-1.5M   | 200K-800K   | 3-7 GB/s     | 10-50 μs   | 480 GB-30 TB | 0.08-0.20
Optane SSD    | 500K-700K   | 200K-500K   | 2.5-3 GB/s   | 5-10 μs    | 100-960 GB   | 0.80-2.00
磁带 LTO-9    | N/A         | N/A         | 400 MB/s     | 秒级       | 18-45 TB     | 0.004-0.008
```

            

上表数据来自各厂商公开规格书，实际性能受固件、温度、填充率等因素影响。
            

### 1.2 市场份额与趋势

            

从出货容量看，HDD 仍然占据全球数据存储的 80% 以上。根据
            IDC 和 Trendfocus 的数据，2024 年全球 HDD 出货量约 5
            亿块，SSD 约 2.5 亿块。但从收入看，SSD 市场规模已经超过
            HDD。
            

几个关键趋势：
            

**HDD**：单盘容量持续增长。西部数据（Western
            Digital）和希捷（Seagate）已经量产 30TB 以上的
            CMR（Conventional Magnetic
            Recording）盘。HAMR（Heat-Assisted Magnetic
            Recording，热辅助磁记录）技术正在量产落地，目标是 2026
            年前实现单盘 40TB 以上。HDD
            的定位越来越明确——大容量冷温数据存储。
            

**NAND SSD**：3D
            NAND（三维闪存）层数持续增加。美光（Micron）和三星（Samsung）已经量产
            200 层以上的 NAND，SK 海力士（SK hynix）推进到 238
            层。层数增加直接降低 $/GB——过去五年 NAND 价格下降了约
            40%。QLC（Quad-Level Cell，四层单元）NAND
            正在进入读密集型企业场景。
            

**NVMe 接口**：PCIe 5.0 的 NVMe SSD
            已经上市，顺序读带宽突破 10 GB/s。PCIe 6.0 在 2025
            年开始进入服务器平台。NVMe-oF（NVMe over Fabrics）让远端
            NVMe
            设备可以通过网络访问，模糊了本地存储和网络存储的边界。
            

**Optane/PMem**：英特尔（Intel）已在 2022
            年宣布停止 Optane
            产品线。现有库存仍在流通，但不再有新品。CXL（Compute Express
            Link）内存扩展被认为是 PMem
            的潜在替代方向，但成熟度还不够。
            

**磁带**：LTO（Linear
            Tape-Open）路线图已经规划到 LTO-14（576 TB
            原始容量）。对于合规性归档、灾难恢复等场景，磁带的 $/TB
            优势仍然不可替代。
            

### 1.3 技术路线图

            
```
时间线        HDD                   SSD                      接口/协议
----------- -------------------- ------------------------ ------------------
2024        30 TB CMR 量产         232 层 TLC/QLC 量产       PCIe 5.0 主流
2025        HAMR 规模出货          300+ 层 NAND 量产         CXL 2.0 进入服务器
2026        40+ TB HAMR            $/GB 继续下降 ~15%/年     PCIe 6.0 服务器
2027-2028   50+ TB HAMR            QLC 进入更多企业场景       NVMe-oF 广泛部署
```

            

这意味着 HDD 和 SSD 的 $/GB 差距在缩小，但短期内（3-5
            年）HDD
            在大容量冷存储上仍有成本优势。选型时需要根据采购时间点重新评估价格。
            

## 二、性能维度对比

            

### 2.1 核心性能指标

            

存储性能不能只看一个数字。不同工作负载关注的指标完全不同：
            
            
- **随机
            IOPS**：数据库事务处理、键值存储最关注这个指标。
            
- **顺序吞吐**：大数据分析、视频处理、备份恢复关注这个指标。
            
- **延迟**：在线服务的 P99
            延迟直接影响用户体验。
            
- **每瓦性能**：大规模部署时功耗是重要的运营成本。
            
            

### 2.2 详细性能对比

            

以下数据综合了各厂商企业级产品的典型规格（非极端高端型号），并注明队列深度（Queue
            Depth，QD）条件：
            
```
测试条件       | HDD 7200RPM     | SATA SSD          | NVMe SSD (PCIe 4.0)  | Optane P5800X
              | (企业级 Exos)    | (企业级 PM893)     | (企业级 PM9A3)        | (停产参考)
--------------|-----------------|--------------------|----------------------|----------------
随机读 4K QD1  | 80-120 IOPS     | 12K-18K IOPS      | 20K-30K IOPS         | 60K-100K IOPS
随机读 4K QD32 | 150-200 IOPS    | 90K-98K IOPS      | 800K-1M IOPS        | 500K-700K IOPS
随机写 4K QD1  | 80-120 IOPS     | 8K-15K IOPS       | 50K-80K IOPS         | 100K-200K IOPS
随机写 4K QD32 | 150-200 IOPS    | 30K-70K IOPS      | 200K-500K IOPS      | 200K-500K IOPS
顺序读 128K    | 200-250 MB/s    | 530-560 MB/s      | 6.5-7.0 GB/s         | 2.5-3.0 GB/s
顺序写 128K    | 200-250 MB/s    | 500-530 MB/s      | 2.0-4.0 GB/s         | 2.3-2.5 GB/s
平均读延迟 QD1 | 4-8 ms          | 50-100 μs         | 10-30 μs             | 5-8 μs
P99 读延迟 QD1 | 10-20 ms        | 200-500 μs        | 50-120 μs            | 10-20 μs
功耗（活跃）   | 8-12 W          | 3-5 W             | 8-25 W               | 14-18 W
功耗（空闲）   | 4-6 W           | 1-2 W             | 3-5 W                | 5-8 W
```

            

几个值得注意的点：
            

**QD1 vs QD32 的差距**：HDD
            在高队列深度下性能几乎不变——因为机械臂寻道是物理瓶颈，多个请求排队也快不了。NVMe
            SSD 则相反，QD32 的 IOPS 可以是 QD1 的 30-50 倍，因为 NVMe
            协议支持 64K 个队列，每个队列 64K 条目，并行度远高于
            AHCI（Advanced Host Controller Interface）协议的 SATA
            SSD。
            

**Optane 的独特优势**：Optane 在 QD1
            下的延迟最低。对于延迟敏感但队列深度不高的场景（如数据库索引查找），Optane
            比 NVMe SSD 更有优势。但 Optane
            已停产，新项目不建议依赖。
            

**SATA SSD 的带宽瓶颈**：无论 NAND
            性能多高，SATA 3.0 接口的理论带宽只有 600
            MB/s，实际有效带宽约 560
            MB/s。这是接口限制，不是介质限制。
            

### 2.3 持续性能与突发性能

            

厂商规格书上的 IOPS 通常是短时突发性能（Burst
            Performance）。在持续高负载下，性能会下降，原因包括：
            
            
- **SSD 的写放大（Write
            Amplification）**：NAND Flash
            不能原地覆写，需要先擦除再写入。垃圾回收（Garbage
            Collection，GC）会占用内部带宽。
            
- **SSD 的热节流（Thermal
            Throttling）**：持续高负载导致芯片温度升高，固件降速保护。
            
- **SSD 的 SLC 缓存耗尽**：很多 SSD 用一部分
            NAND 模拟 SLC（Single-Level
            Cell）模式作为写缓存，缓存耗尽后写入速度会显著下降。
            
            
```
# 用 fio 测试持续写入性能，观察性能衰减
# 以下命令在裸设备上运行，会清除数据——仅用于测试设备
fio --name=sustained-write \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=32 \
    --numjobs=1 \
    --size=100% \
    --runtime=3600 \
    --time_based \
    --log_avg_msec=1000 \
    --write_bw_log=sustained \
    --write_iops_log=sustained \
    --write_lat_log=sustained \
    --filename=/dev/nvme0n1
```

            

典型的 NVMe SSD 持续随机写性能曲线：
            
```
时间（分钟）  | IOPS（4K 随机写 QD32）
0-5          | 500K（SLC 缓存阶段）
5-15         | 250K（缓存耗尽，GC 开始）
15-60        | 150K-200K（稳态性能）
```

            

稳态性能（Steady
            State）才是选型时应该参考的数字。SNIA（Storage Networking
            Industry Association）的 PTS（Performance Test
            Specification）定义了标准的稳态测试方法。
            

### 2.4
            不同队列深度下的延迟分布

            

对于在线服务，P99/P999
            延迟比平均延迟更重要。以下是典型的延迟分布对比：
            
```
百分位   | HDD         | SATA SSD    | NVMe SSD     | 说明
--------|-------------|-------------|--------------|---------------------------
P50     | 4-5 ms      | 60-80 μs    | 15-25 μs     | 中位数延迟
P90     | 8-12 ms     | 100-200 μs  | 30-50 μs     | 大多数请求的延迟上限
P99     | 15-25 ms    | 300-800 μs  | 60-150 μs    | 长尾延迟
P999    | 30-50 ms    | 1-5 ms      | 200-800 μs   | 极端情况
P9999   | 50-100 ms   | 5-20 ms     | 1-5 ms       | GC / 固件内部操作导致的尖峰
```

            

NVMe SSD 的 P9999 尖峰主要来自垃圾回收和磨损均衡。企业级
            NVMe SSD 通过预留空间（Over-Provisioning，OP）和后台 GC
            策略来降低长尾延迟。
            

## 三、可靠性与寿命

            

### 3.1 MTBF 与 AFR

            

存储设备的可靠性通常用两个指标描述：
            
            
- **MTBF（Mean Time Between
            Failures，平均故障间隔时间）**：厂商标称值通常在 100
            万到 250 万小时之间。
            
- **AFR（Annualized Failure
            Rate，年化故障率）**：更直观的指标，表示一年内设备发生故障的概率。
            
            

两者的换算关系：
            
```
AFR = 1 - e^(-8760/MTBF)

近似：AFR ≈ 8760 / MTBF（当 MTBF >> 8760 时）

例如：MTBF = 2,000,000 小时
      AFR ≈ 8760 / 2000000 = 0.438%
```

            

但这些数字的实际意义需要谨慎解读。MTBF
            是统计模型推算值，不是实测值。没有人真的测了 200 万小时（228
            年）来验证这个数字。
            

### 3.2 HDD 可靠性特征

            

Backblaze 每季度发布的硬盘故障统计是目前最大规模的公开
            HDD 可靠性数据。根据 2024 年的数据（约 28
            万块硬盘在运行）：
            

**故障浴盆曲线（Bathtub Curve）**：
            
```
故障率
  ^
  |  ▓▓▓                                            ▓▓▓▓
  |  ▓▓▓▓                                         ▓▓▓▓▓
  |  ▓▓▓▓▓                                      ▓▓▓▓▓▓
  |   ▓▓▓▓▓▓                                 ▓▓▓▓▓▓▓
  |    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  +-------------------------------------------------> 时间
     早期故障     正常使用期（1.5-2% AFR）     磨损期
     (0-6个月)    (6个月-4年)                  (4年+)
```

            

**影响 HDD 故障率的关键因素**：
            
            
- **温度**：Backblaze 数据显示 25-35°C
            范围内故障率差异不大，但超过 40°C 故障率明显上升。Google
            2007 年的论文（Pinheiro et al.）也有类似结论。
            
- **振动**：企业级 HDD
            规格中会标注旋转振动（Rotational
            Vibration，RV）容忍度。在高密度机柜中，多块 HDD
            同时寻道产生的振动会互相影响，降低性能甚至导致故障。
            
- **通电时间**：并非线性关系。Backblaze
            数据显示 3-4 年时 AFR 最低，之后开始上升。
            
- **品牌和型号差异显著**：同一品牌不同型号的
            AFR 可能相差 5
            倍以上。选型时要看具体型号的数据，不能只看品牌。
            
            

### 3.3 SSD 可靠性特征

            

SSD 的寿命受限于 NAND Flash 的擦写次数。关键指标：
            
            
- **TBW（Total Bytes
            Written，总写入量）**：SSD
            生命周期内能承受的总写入数据量。
            
- **DWPD（Drive Writes Per
            Day，每日全盘写入次数）**：在保修期内每天可以写满整个
            SSD 的次数。
            
            
```
TBW 和 DWPD 的换算：

DWPD = TBW / (容量 × 保修天数)

例如：一块 3.84 TB 的 SSD，标称 TBW 为 7000 TB，保修 5 年
DWPD = 7000 / (3.84 × 365 × 5) = 7000 / 7008 ≈ 1.0 DWPD
```

            

**不同 NAND 类型的耐久性差异**：
            
```
NAND 类型      | 每单元比特数 | P/E 循环次数     | 典型应用
--------------|-----------|----------------|-------------------
SLC           | 1 bit     | 50,000-100,000 | 企业级写密集/缓存
MLC           | 2 bit     | 3,000-10,000   | 企业级混合工作负载
TLC           | 3 bit     | 1,000-3,000    | 企业级读密集/消费级
QLC           | 4 bit     | 100-1,000      | 读密集/冷存储替代
```

            

**SSD 耐久性等级分类**（JEDEC 标准）：
            
```
等级          | DWPD 范围     | 典型场景
-------------|--------------|---------------------------
读密集型      | 0.3-1 DWPD   | 内容分发、读缓存、数据仓库
混合型        | 1-3 DWPD     | 数据库、虚拟化、通用服务器
写密集型      | 3-10+ DWPD   | 日志、缓存层、高频交易
```

            

选型时要根据工作负载的实际写入量来选择耐久性等级。多花钱买写密集型
            SSD 但实际写入量只有 0.5 DWPD 是浪费；反过来用读密集型 SSD
            承载高写入负载会导致 SSD 提前报废。
            

### 3.4 数据保持与比特腐烂

            

**HDD 的比特腐烂（Bit
            Rot）**：磁介质的磁化方向会随时间缓慢退化。企业级 HDD
            的不可恢复读错误率（URE，Unrecoverable Read
            Error）通常标称为 1 in 10^15 bits。对于大容量
            HDD，这意味着：
            
```
读取 10 TB 数据时遇到 URE 的概率：

10 TB = 10 × 10^12 × 8 bits = 8 × 10^13 bits
URE 概率 = 8 × 10^13 / 10^15 = 8%

读取 100 TB 数据时（RAID 重建）：
URE 概率 ≈ 56%
```

            

这就是为什么大容量 HDD 的 RAID-5
            重建越来越危险——重建过程中读取整个阵列的数据，遇到 URE
            的概率随容量增大而增大。
            

**SSD 的数据保持（Data Retention）**：NAND
            Flash 通过陷阱电荷（Trapped
            Charge）存储数据，电荷会随时间泄漏。JEDEC 标准要求企业级 SSD
            在通电状态下数据保持 3 个月，断电状态下保持 3
            个月（40°C）。消费级 SSD 断电保持要求是 1
            年（30°C）。温度越高，电荷泄漏越快。
            

### 3.5 RAID
            与不同介质的考量

            
```
介质类型    | 推荐 RAID 方案            | 说明
----------|-------------------------|----------------------------------------
HDD       | RAID-6 或纠删码           | 大容量 HDD 的 URE 风险使 RAID-5 不再安全
SATA SSD  | RAID-5/6 或软件 RAID      | URE 率低（10^-17），RAID-5 仍可接受
NVMe SSD  | 软件 RAID（md/mdadm）     | 硬件 RAID 卡的延迟会抵消 NVMe 的低延迟优势
Optane     | 通常不做 RAID             | 容量小、成本高，一般用作缓存层
```

            

NVMe SSD 使用硬件 RAID 控制器需要注意：传统 RAID 卡基于
            SAS/SATA 接口设计，不支持 NVMe。虽然有 NVMe 的 RAID 方案（如
            Intel VROC，Virtual RAID on
            CPU），但成本和复杂度更高。多数场景下，软件定义存储（如
            Ceph、MinIO）在应用层处理冗余比硬件 RAID 更灵活。
            

## 四、成本分析

            

### 4.1 采购成本：$/GB

            

截至 2025 年中的典型价格（企业级，含企业渠道折扣）：
            
```
介质类型              | 容量      | 参考价格     | $/GB
--------------------|----------|------------|--------
HDD 7200RPM CMR     | 18 TB    | $270       | $0.015
HDD 7200RPM CMR     | 24 TB    | $420       | $0.018
HDD 7200RPM HAMR    | 30 TB    | $600       | $0.020
SATA SSD 读密集型    | 3.84 TB  | $300       | $0.078
NVMe SSD 读密集型    | 3.84 TB  | $380       | $0.099
NVMe SSD 混合型      | 3.84 TB  | $520       | $0.135
NVMe SSD 写密集型    | 3.84 TB  | $900       | $0.234
Optane SSD (库存)    | 960 GB   | $800       | $0.833
LTO-9 磁带          | 18 TB    | $100       | $0.006
```

            

注意：SSD 价格波动较大，受 NAND 供需周期影响。2023 年
            NAND 价格触底后在 2024 年回升了约
            30%。以上价格仅供量级参考。
            

### 4.2 $/IOPS 计算

            

如果工作负载是 IOPS 密集型，$/GB
            不是正确的比较口径。应该用 $/IOPS：
            
```
介质类型              | 稳态随机读 IOPS (QD32) | 参考价格  | $/KIOPS
--------------------|----------------------|----------|--------
HDD 7200RPM 18TB    | 180                  | $270     | $1500
SATA SSD 3.84TB     | 95K                  | $300     | $3.16
NVMe SSD 3.84TB     | 900K                 | $380     | $0.42
```

            

从 $/IOPS 看，NVMe SSD 比 HDD 便宜 3500 倍以上。对于 IOPS
            密集型工作负载，HDD 实际上是最贵的选择。
            

### 4.3 TCO：总拥有成本

            

采购成本只是 TCO（Total Cost of
            Ownership，总拥有成本）的一部分。完整的 TCO 需要考虑：
            
```
TCO = 采购成本 + 电费 + 冷却费 + 机柜空间费 + 运维人力 + 更换成本

以下按 5 年生命周期、$0.10/kWh 电价计算：
```

            

**单块设备 5 年 TCO 对比**：
            
```
成本项            | HDD 18TB        | NVMe SSD 3.84TB
-----------------|-----------------|-----------------
采购成本          | $270            | $380
电费（5年）       | $44             | $66
                 | (10W × 8760h    | (15W × 8760h
                 |  × 5年 × $0.10) |  × 5年 × $0.10)
冷却费（PUE 1.3） | $13             | $20
机柜空间（1U/24盘）| $25/盘位/年     | $25/盘位/年
                 | = $125（5年）    | = $125（5年）
5年 TCO          | $452            | $591
```

            

**每 TB 5 年 TCO**：
            
```
HDD 18TB: $452 / 18 = $25.1/TB
NVMe SSD 3.84TB: $591 / 3.84 = $153.9/TB
```

            

**每 KIOPS 5 年 TCO**：
            
```
HDD 18TB: $452 / 0.18 = $2511/KIOPS
NVMe SSD 3.84TB: $591 / 900 = $0.66/KIOPS
```

            

结论很清楚：存容量选 HDD，存性能选 NVMe。
            

### 4.4 分层 TCO 计算

            

实际场景往往是混合的。以一个 100 TB 数据库集群为例，其中
            10 TB 是热数据（需要高 IOPS），90 TB
            是温冷数据（顺序读为主）：
            
```
方案 A：全部 NVMe SSD
  所需设备：28 块 3.84TB NVMe SSD
  5 年 TCO：28 × $591 = $16,548

方案 B：分层存储
  热数据：3 块 3.84TB NVMe SSD（11.5TB 可用）
  温冷数据：6 块 18TB HDD（108TB 可用）
  5 年 TCO：3 × $591 + 6 × $452 = $1,773 + $2,712 = $4,485

方案 B 比方案 A 节省 73% 的成本。
```

            

这就是分层存储架构的经济动机。
            

### 4.5 云存储成本对比

            

在公有云上，存储成本的计算方式不同。以 AWS EBS（Elastic
            Block Store）为例（us-east-1 区域，2025 年价格）：
            
```
EBS 类型       | 特性                | 月费用/GB   | 基线 IOPS        | IOPS 成本
--------------|--------------------|------------|-----------------|----------
gp3           | 通用 SSD            | $0.08      | 3000 免费        | $0.005/IOPS
io2           | 高性能 SSD          | $0.125     | 按需购买         | $0.065/IOPS
st1           | 吞吐优化 HDD        | $0.045     | 基于容量         | N/A
sc1           | 冷存储 HDD          | $0.015     | 基于容量         | N/A
```

            

**云存储 vs 自建存储的 3 年 TCO（per
            TB）**：
            
```
方案                    | 3 年 $/TB
-----------------------|-----------
EBS gp3               | $2,880
EBS st1               | $1,620
自建 NVMe SSD          | $92（含运维）
自建 HDD              | $15（含运维）
```

            

自建存储的 $/TB
            远低于云存储，但这个比较没有包含自建的隐性成本：机房租赁、网络设备、运维人力、冗余设计等。小规模场景用云存储更经济；大规模场景自建存储成本优势明显。
            

## 五、工作负载特征与介质匹配

            

### 5.1 工作负载特征分析

            

选型的第一步是搞清楚工作负载的 I/O 特征。关键维度：
            
```
维度         | 问题                                  | 为什么重要
------------|--------------------------------------|---------------------------
读写比       | 读多写少还是写多读少？                    | 影响 SSD 耐久性等级选择
I/O 模式     | 随机还是顺序？                          | HDD 顺序性能尚可，随机性能极差
块大小       | 4K 小 I/O 还是 1M 大 I/O？              | 大块 I/O 更看重带宽，小块看重 IOPS
队列深度     | 单线程还是高并发？                        | NVMe 在高 QD 下优势更大
延迟要求     | 能接受毫秒级还是必须微秒级？               | 决定是否需要 NVMe/Optane
容量需求     | 需要几 TB 还是几百 TB？                   | 大容量场景 HDD 成本优势大
数据增长率   | 每年增长多少？                            | 影响容量规划和介质选择
```

            

### 5.2 典型工作负载匹配

            

#### OLTP
            数据库（MySQL/PostgreSQL）

            
```
特征：
- 随机读写为主（80-90% 随机）
- 4K-16K 小 I/O
- 延迟敏感：P99 
```
# MySQL InnoDB 的 I/O 模式可以用 iostat 观察
iostat -xz 1 5
# 关注 r_await（读延迟）、w_await（写延迟）、rrqm/s + wrqm/s（合并率）

# 或者用 blktrace 做更细粒度的分析
blktrace -d /dev/nvme0n1 -o trace
blkparse -i trace -d trace.bin
btt -i trace.bin  # 分析 I/O 延迟分布
```

            

#### OLAP /
            数据仓库（ClickHouse/Presto）

            
```
特征：
- 大范围顺序扫描为主
- 128K-1M 大块 I/O
- 延迟要求宽松：查询本身耗时秒级
- 写入以批量导入为主，不频繁
- 容量大：10 TB - 数百 TB

推荐介质：
- 热数据/索引：NVMe SSD（读密集型）
- 历史数据：HDD 或 SATA SSD
理由：
- 顺序扫描吞吐 HDD 也能提供 200+ MB/s，对于不赶时间的批处理够用
- 但索引查找和小范围查询需要低延迟随机读，NVMe 优势明显
- ClickHouse 的 MergeTree 引擎支持多卷存储策略，可以自动在 SSD 和 HDD 之间迁移数据
```

            

#### 对象存储（S3
            兼容，如 MinIO/Ceph RGW）

            
```
特征：
- 大对象（图片、视频、备份文件）为主
- 顺序写入，写入后很少修改
- 读取模式取决于业务：CDN 回源是顺序读，API 访问可能是随机读
- 容量需求非常大：PB 级别
- 成本极其敏感

推荐介质：HDD（企业级 CMR）
理由：
- $/GB 最低，大容量场景下成本差异巨大
- 顺序 I/O 为主，HDD 的弱点（随机 IOPS 低）影响不大
- 元数据访问用 SSD 加速即可
```

            

#### 日志聚合（Elasticsearch/Loki）

            
```
特征：
- 写入：高吞吐顺序写入（日志追加）
- 读取：近实时查询是随机读，全文搜索是顺序扫描
- 数据有时效性：近期数据频繁查询，历史数据偶尔查询
- 容量增长快

推荐介质：
- 热节点（近 7 天）：NVMe SSD（读密集型）
- 温节点（7-30 天）：SATA SSD
- 冷节点（30 天+）：HDD
理由：
- Elasticsearch 的索引生命周期管理（ILM，Index Lifecycle Management）可以自动在不同节点之间迁移索引
- 近期数据需要低延迟随机读支撑实时查询
- 历史数据查询频率低，HDD 足够
```

            

#### 缓存层（Redis/Memcached
            持久化）

            
```
特征：
- 极低延迟（
            
- **数据温度如何判断？**
            可以基于访问频率（最近 N
            天内被访问次数）、数据年龄（创建时间）、业务标签（明确指定的热/冷属性）。
            
- **迁移策略是推还是拉？**
            推（定时任务扫描并迁移）实现简单但有延迟；拉（首次访问时从冷层拉回热层）对用户更透明。
            
- **迁移粒度是什么？**
            文件级、目录级、还是块级？粒度越细，迁移决策越精确，但元数据开销越大。
            
            

### 6.2 Linux
            块设备层缓存方案

            

Linux 内核提供了多种块设备层的缓存机制，可以用 SSD 作为
            HDD 的缓存层：
            

#### bcache

            

bcache 是 Linux 内核内置的块设备缓存方案，用 SSD 作为 HDD
            的缓存。
            
```
# 安装 bcache 工具
apt-get install bcache-tools

# 准备缓存设备（SSD）和后端设备（HDD）
# 警告：以下操作会清除设备数据
make-bcache -B /dev/sda -C /dev/nvme0n1p1

# 查看 bcache 设备
ls /dev/bcache0

# 设置缓存模式
# writeback: 写入先到 SSD，后台回刷 HDD（性能最好，但 SSD 故障可能丢数据）
# writethrough: 同时写 SSD 和 HDD（安全但写性能无提升）
# writearound: 写入直接到 HDD，只缓存读（适合大量顺序写场景）
echo writeback > /sys/block/bcache0/bcache/cache_mode

# 调整顺序 I/O 的缓存阈值（默认 0，即缓存所有 I/O）
# 设置为 0 表示缓存所有读取，设置较大值可以跳过大块顺序读
echo 0 > /sys/block/bcache0/bcache/sequential_cutoff

# 查看缓存命中率
cat /sys/block/bcache0/bcache/stats_total/cache_hit_ratio
```

            

#### dm-writecache

            

dm-writecache 是 device-mapper
            的写缓存目标（target），专门加速写入：
            
```
# 创建 dm-writecache 设备
# 假设 /dev/nvme0n1p1 是 SSD 缓存分区，/dev/sda 是 HDD
dmsetup create cached-disk --table \
  "0 $(blockdev --getsz /dev/sda) writecache p /dev/sda /dev/nvme0n1p1 4096 0"

# p 表示 pmem 模式（也支持 s 表示 SSD 模式）
# 4096 是块大小
```

            

#### LVM cache

            

LVM 也支持 SSD 缓存，通过 `lvmcache`
            实现：
            
```
# 创建缓存池（SSD 上）
lvcreate -L 100G -n cache_pool vg0 /dev/nvme0n1p1
lvcreate -L 1G -n cache_meta vg0 /dev/nvme0n1p1

# 将缓存附加到现有 LV（HDD 上的数据卷）
lvconvert --type cache-pool --poolmetadata vg0/cache_meta vg0/cache_pool
lvconvert --type cache --cachepool vg0/cache_pool vg0/data_lv

# 查看缓存状态
lvs -o+cache_policy,cache_settings,cache_mode
```

            

### 6.3 应用层分层

            

很多存储引擎内置了分层能力：
            

**RocksDB 的多路径存储**：
            
```
# RocksDB 的 db_paths 配置（以 TiKV 为例）
# 不同 SST 文件层级可以存放在不同路径
[rocksdb]
  [rocksdb.defaultcf]
    [rocksdb.defaultcf.titan]
    # L0-L2（热数据）放在 NVMe SSD
    # L3+（冷数据）放在 SATA SSD 或 HDD
```

            
```
RocksDB LSM-Tree 分层示意：

Level 0 (L0)  ──→ NVMe SSD    # 新写入数据，频繁读写
Level 1 (L1)  ──→ NVMe SSD    # 第一次 compaction 后
Level 2 (L2)  ──→ NVMe SSD    # 仍然比较热
Level 3 (L3)  ──→ SATA SSD    # 温数据
Level 4+ (L4) ──→ HDD         # 冷数据，很少被查询
```

            

**Cassandra 的多数据目录**：
            
```
# cassandra.yaml
data_file_directories:
  - /mnt/nvme/cassandra/data    # NVMe SSD
  - /mnt/sata/cassandra/data    # SATA SSD
  - /mnt/hdd/cassandra/data     # HDD
```

            

Cassandra 本身不自动分层，但可以通过将不同 keyspace 的
            SSTable 目录指向不同介质来手动分层。
            

**Elasticsearch ILM（Index Lifecycle
            Management）**：
            
```
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_age": "7d",
            "max_size": "50gb"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "allocate": {
            "require": {
              "data": "warm"
            }
          },
          "forcemerge": {
            "max_num_segments": 1
          }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "allocate": {
            "require": {
              "data": "cold"
            }
          }
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

            

### 6.4 云分层：S3
            Intelligent-Tiering

            

AWS S3 Intelligent-Tiering
            自动根据访问频率在不同存储层之间移动对象：
            
```
存储层                    | 触发条件                | 月费 $/GB    | 访问费用
------------------------|------------------------|------------|----------
Frequent Access          | 默认层                  | $0.023     | 免费
Infrequent Access        | 30 天未访问              | $0.0125    | $0.001/千次
Archive Instant Access   | 90 天未访问              | $0.004     | $0.001/千次
Archive Access           | 90+ 天未访问（可选开启）  | $0.0036    | 需恢复
Deep Archive Access      | 180+ 天未访问（可选开启） | $0.00099   | 需恢复
```

            

每月每千个对象收取 $0.0025
            的监控和自动化费用。对于对象数量多但单个对象小的场景，这笔额外费用可能比存储费用本身还高。
            

## 七、云存储选型

            

### 7.1 AWS EBS 类型对比

            
```
类型    | 介质    | 最大 IOPS    | 最大吞吐       | 延迟    | 月费/GB   | 适用场景
-------|--------|-------------|---------------|--------|----------|------------------
gp3    | SSD    | 16,000      | 1,000 MB/s    | ~1 ms  | $0.08    | 通用工作负载
gp2    | SSD    | 16,000      | 250 MB/s      | ~1 ms  | $0.10    | 旧版通用（建议迁移到 gp3）
io2    | SSD    | 256,000     | 4,000 MB/s    | ~亚毫秒 | $0.125   | 高性能数据库
io2 BE | SSD    | 256,000     | 4,000 MB/s    | ~亚毫秒 | $0.125   | io2 的高可用版本
st1    | HDD    | 500         | 500 MB/s      | ~5 ms  | $0.045   | 大数据、日志处理
sc1    | HDD    | 250         | 250 MB/s      | ~10 ms | $0.015   | 冷数据、不常访问
```

            

**gp3 vs io2 的选型关键**：gp3 免费提供 3000
            IOPS 和 125 MB/s 吞吐，超出部分按需购买。当 IOPS 需求超过约
            9000 时（此时 gp3 的 IOPS 附加费用开始接近 io2
            的基础费用），考虑切换到 io2。
            
```
# gp3 成本计算示例：500 GB 卷，需要 10000 IOPS 和 400 MB/s
存储费：500 × $0.08 = $40/月
IOPS 费：(10000 - 3000) × $0.005 = $35/月
吞吐费：(400 - 125) × $0.04 = $11/月
总计：$86/月

# io2 同等配置
存储费：500 × $0.125 = $62.5/月
IOPS 费：10000 × $0.065 = $650/月
总计：$712.5/月

# 结论：10000 IOPS 场景下 gp3 仍然比 io2 便宜得多
```

            

### 7.2 AWS 实例存储 vs EBS

            

EC2 实例存储（Instance Store）是直连到物理主机的 NVMe
            SSD，特性与 EBS 完全不同：
            
```
对比维度        | 实例存储              | EBS
--------------|--------------------|------------------
持久性         | 实例停止/终止后数据丢失 | 独立于实例生命周期
延迟           | ~100 μs（本地 NVMe） | ~200-500 μs（网络）
IOPS           | 数十万到百万级         | 受 EBS 类型限制
带宽           | 不占用网络带宽         | 共享 EBS 带宽
快照           | 不支持                | 支持
成本           | 包含在实例费用中       | 按卷单独计费
调整大小        | 固定                 | 可动态调整
```

            

实例存储适合临时计算数据、缓存、临时数据库。不适合需要持久化的数据。
            

### 7.3 GCP Persistent Disk
            对比

            
```
类型           | 介质    | 最大 IOPS/盘 | 最大吞吐/盘   | 月费/GB
--------------|---------|-----------|--------------|---------
pd-standard   | HDD     | 7,500     | 400 MB/s     | $0.040
pd-balanced   | SSD     | 80,000    | 1,200 MB/s   | $0.100
pd-ssd        | SSD     | 100,000   | 1,200 MB/s   | $0.170
pd-extreme    | SSD     | 120,000   | 2,400 MB/s   | $0.125
```

            

GCP 的一个特点是 Persistent Disk 的 IOPS
            和吞吐会随卷大小线性增长（直到上限）。小卷的性能可能不如 AWS
            gp3 的固定 3000 IOPS 基线。
            

### 7.4 Azure Managed Disks
            对比

            
```
类型              | 介质    | 最大 IOPS  | 最大吞吐      | 月费/GB
-----------------|--------|-----------|--------------|--------
Standard HDD     | HDD    | 2,000     | 500 MB/s     | $0.040
Standard SSD     | SSD    | 6,000     | 750 MB/s     | $0.075
Premium SSD v2   | SSD    | 80,000    | 1,200 MB/s   | $0.115
Ultra Disk       | SSD    | 400,000   | 4,000 MB/s   | $0.120
```

            

Azure Ultra Disk 的 IOPS
            和吞吐可以独立于容量调整，灵活性最高。
            

### 7.5 云存储选型汇总

            
```
场景                | AWS 推荐        | GCP 推荐         | Azure 推荐
-------------------|----------------|-----------------|------------------
通用数据库          | gp3            | pd-balanced      | Premium SSD v2
高性能数据库        | io2            | pd-extreme       | Ultra Disk
数据仓库/大数据     | st1            | pd-standard      | Standard HDD
冷存储/归档         | sc1 或 S3      | pd-standard/GCS  | Standard HDD
缓存/临时数据       | 实例存储        | Local SSD        | Temp Disk
```

            

## 八、选型决策框架

            

### 8.1 五步选型法

            
```
步骤 1: 定义工作负载特征
  │
  ├─ IOPS 需求（峰值和平均）
  ├─ 吞吐需求（MB/s）
  ├─ 延迟要求（P50/P99）
  ├─ 读写比
  ├─ I/O 模式（随机/顺序）
  └─ 块大小分布
  │
步骤 2: 估算容量和增长
  │
  ├─ 当前数据量
  ├─ 年增长率
  ├─ 保留策略
  └─ 冗余因子（副本数/纠删码开销）
  │
步骤 3: 计算预算约束
  │
  ├─ 资本支出（CapEx）上限
  ├─ 运营支出（OpEx）月度预算
  ├─ 3 年 / 5 年 TCO 目标
  └─ 是否有采购周期限制
  │
步骤 4: 评估可靠性需求
  │
  ├─ RPO（Recovery Point Objective，恢复点目标）
  ├─ RTO（Recovery Time Objective，恢复时间目标）
  ├─ 数据持久性要求（几个 9）
  └─ 合规性要求（数据保留年限）
  │
步骤 5: 运营因素
  │
  ├─ 运维团队能力
  ├─ 现有基础设施兼容性
  ├─ 供应链风险（多供应商策略）
  └─ 生态系统成熟度
```

            

### 8.2 选型决策树

            
```
需要存储介质选型
  │
  ├── IOPS 需求 > 10K？
  │     ├── 是 ──→ 延迟要求  50 TB？
  │                 ├── 是 ──→ 以顺序 I/O 为主？
  │                 │           ├── 是 ──→ HDD
  │                 │           └── 否 ──→ HDD + SSD 缓存层
  │                 │
  │                 └── 否 ──→ 延迟要求  1 PB？
        │           ├── 是 ──→ 磁带
        │           └── 否 ──→ HDD（冷存储配置）
        └── 否 ──→ 回到 IOPS 需求评估
```

            

### 8.3 选型案例

            

#### 案例一：电商平台 MySQL
            主库

            
```
背景：
- 日均订单 50 万，峰值 QPS 3000
- 数据库大小 800 GB，年增长 200 GB
- P99 查询延迟要求 
```
# 第一步：设备预处理（仅限 SSD，新设备或需要测试稳态性能时）
# 写满整个设备两次以触发 GC，达到稳态
fio --name=precondition \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --size=100% \
    --loops=2 \
    --filename=/dev/nvme0n1

# 第二步：随机读测试（模拟数据库索引查找）
fio --name=rand-read \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=1 \
    --numjobs=1 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json

# 第三步：随机写测试（模拟数据库更新）
fio --name=rand-write \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=32 \
    --numjobs=1 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json

# 第四步：混合读写测试（模拟实际数据库负载）
fio --name=mixed-rw \
    --ioengine=libaio \
    --direct=1 \
    --rw=randrw \
    --rwmixread=70 \
    --bs=4k \
    --iodepth=16 \
    --numjobs=4 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json

# 第五步：顺序读测试（模拟数据仓库扫描）
fio --name=seq-read \
    --ioengine=libaio \
    --direct=1 \
    --rw=read \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --runtime=120 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json
```

            

测试结果的关键观察点：
            
```
指标              | 关注什么
-----------------|-------------------------------------------------
IOPS             | 是否达到规格书标称值的 80% 以上
延迟分布          | P99 和 P999 是否有明显尖峰
吞吐量            | 顺序读写是否接近接口理论带宽
稳定性            | 5 分钟测试内 IOPS 的标准差是否 
```
# SMART 健康监控（适用于 HDD 和 SATA SSD）
smartctl -a /dev/sda

# NVMe 健康监控
nvme smart-log /dev/nvme0n1
# 关注：
# - percentage_used: SSD 寿命消耗百分比
# - available_spare: 可用备用块百分比
# - media_errors: 介质错误计数
# - num_err_log_entries: 错误日志条目数
# - warning_temp_time: 温度超过警告阈值的累计时间

# I/O 延迟实时监控（使用 iostat）
iostat -xz 1
# 关注：
# - r_await / w_await: 平均请求延迟
# - avgqu-sz: 平均队列深度
# - %util: 设备利用率

# 使用 blktrace 做细粒度 I/O 分析
blktrace -d /dev/nvme0n1 -o - | blkparse -i - -o trace.txt
```

            

建议的监控告警阈值：
            
```
指标                    | HDD 告警阈值         | SSD 告警阈值
-----------------------|--------------------|-----------------
平均读延迟              | > 20 ms            | > 1 ms
P99 读延迟              | > 50 ms            | > 5 ms
设备利用率              | > 90% 持续 5 分钟    | > 95% 持续 5 分钟
SMART Reallocated Sectors | > 10             | N/A
SSD percentage_used     | N/A                | > 80%
SSD available_spare     | N/A                |  55°C             | > 70°C
```

            

### 9.4 何时重新评估存储选型

            

存储选型不是一次性决策。以下情况需要重新评估：
            
            
- **工作负载特征变化**：业务增长导致 IOPS
            需求翻倍，原来够用的 SATA SSD 不够了。
            
- **成本结构变化**：NAND 价格下降到 HDD 的 2
            倍以内时，很多温存储场景可以迁移到 SSD。
            
- **新技术可用**：CXL 内存扩展、ZNS
            SSD（Zoned Namespace SSD）等新技术可能改变选型逻辑。
            
- **设备生命周期到期**：3-5
            年更换周期到达时，用新价格重新计算 TCO。
            
- **合规要求变化**：新的数据保留法规可能要求更长的归档周期，影响冷存储选型。
            
            

### 9.5 介质迁移策略

            

当需要从一种介质迁移到另一种时，常见的迁移方案：
            

**在线迁移（推荐）**：
            
```
# 使用 LVM 在线迁移数据从 HDD 到 SSD
# 1. 将 SSD 加入 VG
pvcreate /dev/nvme0n1p1
vgextend vg0 /dev/nvme0n1p1

# 2. 在线迁移 LV 的数据到新 PV
pvmove /dev/sda1 /dev/nvme0n1p1

# 3. 迁移完成后从 VG 移除旧 PV
vgreduce vg0 /dev/sda1
pvremove /dev/sda1
```

            

**应用层迁移**（适用于数据库）：
            
```
1. 搭建新介质上的从库
2. 配置主从复制，等待数据同步完成
3. 验证数据一致性
4. 切换流量到新从库（提升为主库）
5. 下线旧主库
```

            

**分布式存储迁移**（适用于 Ceph 等）：
            
```
# Ceph 中用 OSD class 区分介质类型
# 将 pool 的 CRUSH 规则从 HDD class 改为 SSD class
ceph osd pool set mypool crush_rule ssd_rule
# Ceph 会自动在后台重新平衡数据
# 监控迁移进度
ceph -s
```

            

## 参考文献

            

### 规范与标准

            
            
- SNIA, “Solid State Storage Performance Test
            Specification (PTS),” SNIA, 2020. 定义了 SSD
            稳态性能的标准测试方法。
            
- JEDEC, “JESD218 Solid-State Drive (SSD) Requirements and
            Endurance Test Method,” JEDEC, 2017. 定义了 SSD
            耐久性测试标准和数据保持要求。
            
- NVM Express, “NVM Express Base Specification, Revision
            2.0,” nvmexpress.org, 2021. NVMe 协议规范。
            
            

### 论文与研究

            
            
- Schroeder, B., Lagisetty, R., Merchant, A., “Flash
            Reliability in Production: The Expected and the Unexpected,”
            FAST, 2016. Google 对闪存可靠性的大规模生产环境研究。
            
- Pinheiro, E., Weber, W., Barroso, L., “Failure Trends in
            a Large Disk Drive Population,” FAST, 2007. Google 对大规模
            HDD 故障的分析。
            
- Schroeder, B., Gibson, G., “Disk Failures in the Real
            World: What Does an MTTF of 1,000,000 Hours Mean to You?,”
            FAST, 2007. 对 MTBF 指标实际意义的分析。
            
- Grupp, L.M. et al., “The Bleak Future of NAND Flash
            Memory,” FAST, 2012. NAND
            缩放对可靠性和性能的影响分析。
            
            

### 行业数据

            
            
- Backblaze, “Hard Drive Stats,”
            backblaze.com/cloud-storage/resources/hard-drive-test-data.
            持续更新的大规模 HDD 故障率数据。
            
- IDC, “Worldwide Solid State Drive Forecast,” IDC, 2024.
            SSD 市场预测和出货量数据。
            
- Trendfocus, “HDD Industry Report,” Trendfocus, 2024. HDD
            市场份额和出货量分析。
            
            

### 厂商文档

            
            
- Samsung, “PM9A3 NVMe SSD Specification,”
            samsung.com/semiconductor. 企业级 NVMe SSD 规格书。
            
- Seagate, “Exos X20 Product Manual,” seagate.com. 企业级
            HDD 规格书。
            
- Intel, “Optane SSD P5800X Product Brief,” intel.com.
            Optane SSD 规格书（停产参考）。
            
- AWS, “Amazon EBS Volume Types,” docs.aws.amazon.com/ebs.
            EBS 卷类型和定价。
            
- GCP, “Persistent Disk Documentation,”
            cloud.google.com/compute/docs/disks. GCP 持久磁盘文档。
            
            

### 工具

            
            
- fio, “Flexible I/O Tester,” github.com/axboe/fio.
            存储基准测试工具。
            
- bcache, “A Linux kernel block layer cache,”
            bcache.evilpiepirate.org. Linux 块层缓存文档。
            
            
            

**上一篇**: 存储性能建模：IOPS、吞吐与延迟
            **下一篇**: Linux I/O
            栈全景：从 syscall 到磁盘
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】磁盘空间耗尽：从 70% 到 ENOSPC 的行为退化链

                    

逐层拆解 ext4、XFS、Btrfs、ZFS 从 70% 填充到 100% 耗尽过程中的块分配退化、碎片化加剧和 ENOSPC 故障模式，给出各文件系统的容量红线、监控阈值和应急恢复方法。
                

                
                    

2025-08-10 · storage
                    

### 【存储工程】HDD 机械硬盘：旋转时代的工程遗产

                    

HDD 已经被 SSD 抢去了大部分聚光灯，但全球 90% 以上的数据仍然存储在旋转磁盘上。理解 HDD 的物理结构和性能特征，是理解整个存储栈设计决策的基础——从文件系统的块分配策略到数据库的 WAL 设计，几乎每一个存储优化都能追溯到'旋转延迟'和'寻道时间'这两个物理约束。
                

                
                    

2025-08-11 · storage
                    

### 【存储工程】SSD 与 NAND Flash：FTL、写放大与磨损均衡

                    

SSD 已经在大多数性能敏感场景中取代了 HDD，但 SSD 并不是"没有机械部件的硬盘"——它是一个完全不同的存储架构，带来了一组全新的工程约束。理解这些约束，需要从 NAND Flash（NAND 闪存）的物理特性开始，逐层向上推导出 FTL（Flash Translation Layer）、垃圾回收（Garbag…