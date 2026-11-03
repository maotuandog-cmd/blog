# 【存储工程】RAID 原理与实践

来源: https://quant67.com/post/storage/20-raid/raid.html
日期: 2025-08-29 |

---

## 一、RAID 基本概念

            

### 1.1 什么是 RAID

            

RAID（Redundant Array of Independent
            Disks），即独立磁盘冗余阵列（Redundant Array of Independent
            Disks），是一种将多块物理磁盘组合成一个逻辑存储单元的技术。RAID
            最初由加州大学伯克利分校的 David Patterson、Garth Gibson 和
            Randy Katz 在 1988 年的论文《A Case for Redundant Arrays of
            Inexpensive Disks (RAID)》中提出。其核心目标有三个：
            
            
- **提高数据可靠性**：通过冗余（Redundancy）机制，在部分磁盘故障时仍能保护数据完整。
            
- **提升 I/O
            性能**：通过并行访问多块磁盘，提高读写吞吐量（Throughput）。
            
- **增大可用容量**：将多块磁盘的容量聚合为一个更大的逻辑卷。
            
            

RAID
            的设计哲学在于：单块磁盘的可靠性是有限的，但通过合理的数据分布和冗余策略，可以用多块廉价磁盘构建出高可靠、高性能的存储系统。
            

### 1.2 核心概念

            

理解 RAID 需要掌握以下四个基本概念：
            

#### 1.2.1 条带化（Striping）

            

条带化（Striping）是将数据分割成固定大小的块（称为条带单元，Stripe
            Unit），然后将这些块依次分布到阵列中的各个磁盘上。条带化的关键参数是条带大小（Stripe
            Size），也称为块大小（Chunk Size）。
            
```
假设有 4 块磁盘，条带大小为 64KB：

数据块:  A0  A1  A2  A3  A4  A5  A6  A7  ...

Disk 0: | A0 | A4 | A8  | ...
Disk 1: | A1 | A5 | A9  | ...
Disk 2: | A2 | A6 | A10 | ...
Disk 3: | A3 | A7 | A11 | ...

一个完整的条带（Stripe）= A0 + A1 + A2 + A3 = 256KB
```

            

条带化的优势在于：当应用程序发起大块顺序读写时，I/O
            请求可以同时分发到多块磁盘上并行处理，从而获得接近 N 倍（N
            为磁盘数量）的带宽提升。
            

#### 1.2.2 镜像（Mirroring）

            

镜像（Mirroring）是将相同的数据同时写入两块（或更多）磁盘。当一块磁盘发生故障时，另一块磁盘上仍保留有完整的数据副本。
            
```
镜像示意：

Write Data X:
  Disk 0: | X |    
            
            
            冗余类型
            代表级别
            允许故障盘数
            空间开销
            
            
            
            
            无冗余
            RAID 0
            0
            0
            
            
            镜像
            RAID 1
            1（每对镜像中）
            50%
            
            
            单校验
            RAID 5
            1
            1 块盘
            
            
            双校验
            RAID 6
            2
            2 块盘
            
            
            
            

### 1.3 RAID 的历史演进

            

RAID 技术自 1988 年提出以来，经历了多个发展阶段：
            
            
- **早期阶段（1988—1995）**：主要以硬件 RAID
            控制器（Hardware RAID
            Controller）为主，成本高昂，主要应用于企业级存储。
            
- **普及阶段（1995—2005）**：RAID
            控制器成本下降，RAID 5 成为企业服务器的标准配置。同时，Linux
            内核引入了 MD（Multiple Devices）驱动，使软件 RAID（Software
            RAID）成为可能。
            
- **大容量时代（2005—2015）**：随着单盘容量从百
            GB 增长到 TB 级别，RAID 5 的重建风险（Rebuild
            Risk）引发广泛关注，RAID 6 和 RAID 10
            成为更受推荐的选择。
            
- **现代阶段（2015
            至今）**：固态硬盘（SSD）的普及带来了新的考量，如
            TRIM 透传（TRIM Passthrough）和写放大（Write
            Amplification）。同时，纠删码（Erasure
            Coding）等分布式冗余技术在云存储中逐步替代传统 RAID。
            
            

### 1.4 RAID 的适用场景

            

RAID
            并非万能解决方案。以下是常见的适用场景和不适用场景：
            

**适用场景**： - 数据库服务器：需要高
            IOPS（Input/Output Operations Per Second）和数据保护。 -
            文件服务器：需要大容量和可接受的冗余。 -
            虚拟化平台：需要高带宽和稳定的延迟。
            

**不适用场景**： - RAID
            不能替代备份（Backup）：RAID
            保护的是硬件故障，不能防御误删除、勒索软件或逻辑错误。 -
            跨节点高可用：RAID
            只保护单机存储，分布式场景应考虑分布式存储系统。
            
            

## 二、RAID 级别详解

            

### 2.1 RAID 0——条带化

            

RAID 0
            将数据条带化分布到所有成员磁盘上，不提供任何冗余。
            
```
RAID 0 布局（4 盘）：

Disk 0    Disk 1    Disk 2    Disk 3
------    ------    ------    ------
| A0 |    | A1 |    | A2 |    | A3 |
| A4 |    | A5 |    | A6 |    | A7 |
| A8 |    | A9 |    | A10|    | A11|
| .. |    | .. |    | .. |    | .. |
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            2
            
            
            可用容量
            N × 单盘容量
            
            
            允许故障盘数
            0
            
            
            读性能
            N × 单盘读性能
            
            
            写性能
            N × 单盘写性能
            
            
            适用场景
            临时数据、缓存、对可靠性无要求的高性能场景
            
            
            
            

RAID 0
            的风险在于：任何一块磁盘故障都会导致整个阵列数据丢失。且磁盘越多，故障概率越高。如果单盘年故障率（AFR，Annual
            Failure Rate）为 p，则 N 盘 RAID 0 的年故障率约为
            1-(1-p)^N。
            

### 2.2 RAID 1——镜像

            

RAID 1 将数据完整地复制到两块磁盘上（标准配置为 2
            盘一组）。
            
```
RAID 1 布局（2 盘）：

Disk 0       Disk 1
------       ------
| A0 |   | A0 |
| A1 |   | A1 |
| A2 |   | A2 |
| .. |       | .. |

两块盘存储完全相同的数据
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            2
            
            
            可用容量
            单盘容量（利用率 50%）
            
            
            允许故障盘数
            1（每组镜像中）
            
            
            读性能
            2 × 单盘（可从两盘并行读取）
            
            
            写性能
            约等于单盘（需同时写两盘）
            
            
            适用场景
            操作系统盘、小型数据库、对可靠性要求极高的场景
            
            
            
            

RAID 1 的读性能理论上可达单盘的 2
            倍，因为控制器可以将读请求分发到任一磁盘。但写性能受限于较慢的那块磁盘，因为必须等待两块盘都写入完成。
            

### 2.3 RAID
            5——带分布式校验的条带化

            

RAID 5 是企业环境中最经典的 RAID
            级别。它将数据条带化分布，并在各盘之间轮流存放校验块（Parity
            Block），使校验 I/O 不集中在单一磁盘上。
            
```
RAID 5 布局（4 盘）：

Disk 0    Disk 1    Disk 2    Disk 3
------    ------    ------    ------
| D0  |   | D1  |   | D2  |   | P0  |    
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            3
            
            
            可用容量
            (N-1) × 单盘容量
            
            
            允许故障盘数
            1
            
            
            读性能
            (N-1) × 单盘读性能（近似）
            
            
            写性能
            受写惩罚影响，详见第三节
            
            
            适用场景
            读多写少的文件服务器、归档存储
            
            
            
            

RAID 5 的布局算法有两种常见变体：
            
            
- **left-symmetric**（左对称）：Linux mdadm
            的默认布局，校验块按照对角线方式分布，有利于顺序读性能。
            
- **left-asymmetric**（左非对称）：某些硬件控制器的默认布局。
            
            
```
left-symmetric 布局：

     Disk 0   Disk 1   Disk 2   Disk 3
S0:  | D0 |   | D1 |   | D2 |   | P0 |
S1:  | D5 |   | D3 |   | P1 |   | D4 |
S2:  | D9 |   | P2 |   | D6 |   | D7 |   (注意：D8 在下一行)
S3:  | P3 |   | D10|   | D11|   | D12|

left-asymmetric 布局：

     Disk 0   Disk 1   Disk 2   Disk 3
S0:  | D0 |   | D1 |   | D2 |   | P0 |
S1:  | D3 |   | D4 |   | P1 |   | D5 |
S2:  | D6 |   | P2 |   | D7 |   | D8 |
S3:  | P3 |   | D9 |   | D10|   | D11|
```

            

### 2.4 RAID 6——双校验条带化

            

RAID 6 在 RAID 5
            的基础上增加了第二个校验块，使用不同的校验算法（通常为
            Reed-Solomon 编码或 P+Q
            校验）。这使得阵列可以同时容忍两块磁盘故障。
            
```
RAID 6 布局（5 盘）：

Disk 0    Disk 1    Disk 2    Disk 3    Disk 4
------    ------    ------    ------    ------
| D0  |   | D1  |   | D2  |   | P0  |   | Q0  |
| D3  |   | D4  |   | P1  |   | Q1  |   | D5  |
| D6  |   | P2  |   | Q2  |   | D7  |   | D8  |
| P3  |   | Q3  |   | D9  |   | D10 |   | D11 |
| Q4  |   | D12 |   | D13 |   | D14 |   | P4  |
| ..  |   | ..  |   | ..  |   | ..  |   | ..  |

P = XOR 校验（同 RAID 5）
Q = Reed-Solomon 校验（使用伽罗瓦域运算）
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            4
            
            
            可用容量
            (N-2) × 单盘容量
            
            
            允许故障盘数
            2
            
            
            读性能
            (N-2) × 单盘读性能（近似）
            
            
            写性能
            受更高写惩罚影响（写惩罚为 6）
            
            
            适用场景
            大容量存储、对数据安全要求高的场景
            
            
            
            

在大容量磁盘时代（单盘 4TB 及以上），RAID 6 已成为比 RAID
            5 更推荐的选择，因为 RAID 5
            在重建过程中遭遇第二块盘故障的概率不可忽视。
            

### 2.5 RAID 10——镜像加条带化

            

RAID 10（也写作 RAID
            1+0）先将磁盘两两组成镜像对，再将各镜像对进行条带化。它结合了
            RAID 1 的高可靠性和 RAID 0 的高性能。
            
```
RAID 10 布局（4 盘，2 组镜像）：

         Mirror 0           Mirror 1
     Disk 0   Disk 1    Disk 2   Disk 3
     ------   ------    ------   ------
S0:  | A0 |   | A0 |    | A1 |   | A1 |
S1:  | A2 |   | A2 |    | A3 |   | A3 |
S2:  | A4 |   | A4 |    | A5 |   | A5 |
S3:  | A6 |   | A6 |    | A7 |   | A7 |
     | .. |   | .. |    | .. |   | .. |

偶数条带写入 Mirror 0（Disk 0 和 Disk 1）
奇数条带写入 Mirror 1（Disk 2 和 Disk 3）
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            4（必须为偶数）
            
            
            可用容量
            N/2 × 单盘容量（利用率 50%）
            
            
            允许故障盘数
            每组镜像可坏 1 块，最好情况下可坏 N/2 块
            
            
            读性能
            N × 单盘读性能（所有盘均可服务读请求）
            
            
            写性能
            N/2 × 单盘写性能
            
            
            适用场景
            数据库、高 IOPS
            应用、对性能和可靠性同时有高要求的场景
            
            
            
            

RAID 10 相比 RAID 5/6 有以下优势： - 无写惩罚（Write
            Penalty），随机写性能优异。 -
            重建速度快：只需从镜像对中的存活盘复制数据，不涉及校验计算。
            - 重建期间性能下降小。
            

Linux mdadm 还支持 RAID 10 的多种布局模式：
            
```
near 布局（默认）：镜像副本存储在相同偏移位置
     Disk 0   Disk 1   Disk 2   Disk 3
     | A0 |   | A0 |   | A1 |   | A1 |
     | A2 |   | A2 |   | A3 |   | A3 |

far 布局：镜像副本存储在不同偏移位置，提升顺序读性能
     Disk 0   Disk 1   Disk 2   Disk 3
     | A0 |   | A1 |   | A2 |   | A3 |
     | A3 |   | A0 |   | A1 |   | A2 |

offset 布局：结合 near 和 far 的特点
     Disk 0   Disk 1   Disk 2   Disk 3
     | A0 |   | A0 |   | A1 |   | A1 |
     | A1 |   | A2 |   | A2 |   | A0 |  (注意偏移)
```

            

### 2.6 RAID 50——RAID 5
            的条带化

            

RAID 50（RAID 5+0）将多组 RAID 5 阵列再进行 RAID 0
            条带化。
            
```
RAID 50 布局（8 盘，分 2 组 RAID 5）：

         RAID 5 Group 0              RAID 5 Group 1
     Disk0  Disk1  Disk2  Disk3  Disk4  Disk5  Disk6  Disk7
     -----  -----  -----  -----  -----  -----  -----  -----
S0:  |D0 |  |D1 |  |D2 |  |P0 |  |D3 |  |D4 |  |D5 |  |P1 |
S1:  |D6 |  |D7 |  |P2 |  |D8 |  |D9 |  |D10|  |P3 |  |D11|
     | ..|  | ..|  | ..|  | ..|  | ..|  | ..|  | ..|  | ..|
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            6（每组至少 3 盘，至少 2 组）
            
            
            可用容量
            总容量 - 每组 1 盘 × 组数
            
            
            允许故障盘数
            每组最多 1 块（不同组可同时故障）
            
            
            适用场景
            需要比 RAID 5 更高性能和可靠性的大型存储
            
            
            
            

### 2.7 RAID 60——RAID 6
            的条带化

            

RAID 60（RAID 6+0）与 RAID 50 类似，但底层使用 RAID 6
            代替 RAID 5。
            
```
RAID 60 布局（10 盘，分 2 组 RAID 6）：

         RAID 6 Group 0                    RAID 6 Group 1
     Disk0 Disk1 Disk2 Disk3 Disk4    Disk5 Disk6 Disk7 Disk8 Disk9
     ----- ----- ----- ----- -----    ----- ----- ----- ----- -----
S0:  |D0 | |D1 | |D2 | |P0 | |Q0 |   |D3 | |D4 | |D5 | |P1 | |Q1 |
S1:  |D6 | |D7 | |P2 | |Q2 | |D8 |   |D9 | |D10| |P3 | |Q3 | |D11|
     | ..| | ..| | ..| | ..| | ..|   | ..| | ..| | ..| | ..| | ..|
```

            

**关键特性**：
            
            
            
            参数
            值
            
            
            
            
            最少磁盘数
            8（每组至少 4 盘，至少 2 组）
            
            
            可用容量
            总容量 - 每组 2 盘 × 组数
            
            
            允许故障盘数
            每组最多 2 块
            
            
            适用场景
            超大规模存储、关键业务系统
            
            
            
            

### 2.8 各级别对比总览

            
```
+----------+------+----------+----------+--------+--------+--------+
| 级别     | 最少 | 容量利用 | 容错盘数 | 随机读 | 随机写 | 重建速 |
|          | 盘数 | 率       |          | 性能   | 性能   | 度     |
+----------+------+----------+----------+--------+--------+--------+
| RAID 0   |  2   | 100%     |    0     |  优秀  |  优秀  |  N/A   |
| RAID 1   |  2   | 50%      |    1     |  良好  |  一般  |  快    |
| RAID 5   |  3   | (N-1)/N  |    1     |  良好  |  较差  |  慢    |
| RAID 6   |  4   | (N-2)/N  |    2     |  良好  |  差    |  很慢  |
| RAID 10  |  4   | 50%      |  1/组    |  优秀  |  优秀  |  快    |
| RAID 50  |  6   | 变化     |  1/组    |  优秀  |  良好  |  中等  |
| RAID 60  |  8   | 变化     |  2/组    |  优秀  |  一般  |  中等  |
+----------+------+----------+----------+--------+--------+--------+
```

            
            

## 三、写惩罚分析

            

### 3.1 什么是写惩罚

            

写惩罚（Write Penalty）是指在使用校验型 RAID（如 RAID
            5、RAID 6）时，每次逻辑写操作需要在底层磁盘上执行的实际 I/O
            次数。写惩罚的存在是因为更新数据块时，必须同时更新对应的校验块。
            

不同 RAID 级别的写惩罚：
            
            
            
            RAID 级别
            写惩罚（每次逻辑写对应的物理 I/O 数）
            
            
            
            
            RAID 0
            1
            
            
            RAID 1
            2（写主盘 + 写镜像盘）
            
            
            RAID 5
            4（读旧数据 + 读旧校验 + 写新数据 + 写新校验）
            
            
            RAID 6
            6（读旧数据 + 读旧P + 读旧Q + 写新数据 + 写新P +
            写新Q）
            
            
            RAID 10
            2（写主盘 + 写镜像盘）
            
            
            
            

### 3.2 RAID 5 写惩罚详解

            

当 RAID 5
            阵列收到一个小块随机写请求（不足以覆盖整个条带）时，需要执行以下步骤：
            
```
RAID 5 小写（Read-Modify-Write）流程：

步骤 1: 读取旧数据块 D_old        (1 次读 I/O)
步骤 2: 读取旧校验块 P_old        (1 次读 I/O)
步骤 3: 计算新校验:
        P_new = P_old XOR D_old XOR D_new
步骤 4: 写入新数据块 D_new        (1 次写 I/O)
步骤 5: 写入新校验块 P_new        (1 次写 I/O)
                                  ──────────────
                           总计:   4 次物理 I/O

示意：
  时间 ──────────────────────────────────>
  |  读D_old  |  读P_old  |  计算P_new  |  写D_new  |  写P_new  |
  |  (Disk i) |  (Disk p) |   (CPU)     |  (Disk i) |  (Disk p) |
```

            

另一种写路径是全条带写（Full Stripe
            Write），当写入量覆盖整个条带时：
            
```
RAID 5 全条带写流程（4 盘阵列，3 个数据盘 + 1 个校验盘）：

步骤 1: 计算新校验:
        P_new = D0_new XOR D1_new XOR D2_new
步骤 2: 并行写入 D0_new、D1_new、D2_new、P_new
                                  ──────────────
                           总计:   4 次写 I/O（无读操作）

写惩罚 = 4/3 ≈ 1.33（平摊到每个数据块）
```

            

全条带写大幅降低了写惩罚，这也是为什么 RAID 5
            搭配大块顺序写入时性能尚可，但面对小块随机写时性能急剧下降。
            

### 3.3 RAID 6 写惩罚详解

            

RAID 6 有两个校验块（P 和 Q），因此小写操作需要更多
            I/O：
            
```
RAID 6 小写（Read-Modify-Write）流程：

步骤 1: 读取旧数据块 D_old        (1 次读 I/O)
步骤 2: 读取旧校验块 P_old        (1 次读 I/O)
步骤 3: 读取旧校验块 Q_old        (1 次读 I/O)
步骤 4: 计算新校验:
        P_new = P_old XOR D_old XOR D_new
        Q_new = Q_old XOR gf_mul(D_old XOR D_new)
步骤 5: 写入新数据块 D_new        (1 次写 I/O)
步骤 6: 写入新校验块 P_new        (1 次写 I/O)
步骤 7: 写入新校验块 Q_new        (1 次写 I/O)
                                  ──────────────
                           总计:   6 次物理 I/O
```

            

### 3.4 IOPS 计算公式

            

了解写惩罚后，可以计算不同 RAID 级别的有效
            IOPS（Effective IOPS）：
            
```
有效 IOPS 公式：

                     N × 单盘 IOPS
有效 IOPS = ─────────────────────────────────────────
             读比例 + 写比例 × 写惩罚

示例：8 盘 RAID 5，单盘 IOPS = 200，读写比 7:3

                8 × 200
有效 IOPS = ───────────────────── = 1600 / 1.9 ≈ 842 IOPS
             0.7 + 0.3 × 4

对比 8 盘 RAID 10（有效磁盘数为 4 对镜像）：

                8 × 200
有效 IOPS = ───────────────────── = 1600 / 1.3 ≈ 1231 IOPS
             0.7 + 0.3 × 2
```

            

### 3.5 写惩罚的缓解策略

            

以下策略可以降低写惩罚的影响：
            
            
- **使用带电池/超级电容的 RAID
            控制器**：写缓存（Write-Back
            Cache）可以合并多个小写为全条带写。
            
- **增大条带大小**：使每次写入更容易覆盖整个条带。
            
- **使用 RAID 10 替代 RAID
            5/6**：对于写密集型工作负载，RAID 10 的写惩罚仅为
            2。
            
- **使用 SSD 日志设备（Write Intent
            Log）**：某些配置支持将写意图日志放在快速 SSD
            上。
            
- **文件系统级优化**：使用日志型文件系统（如
            XFS、ext4）的延迟分配特性，积累写入后批量下发。
            
            
            

## 四、硬件 RAID vs 软件
            RAID

            

### 4.1 硬件 RAID 控制器

            

硬件 RAID 控制器（Hardware RAID
            Controller）是一块独立的扩展卡或主板集成芯片，具有自己的处理器和内存，专门负责
            RAID 运算。
            

**优势**： - 独立处理器分担 CPU 负载，尤其在
            RAID 5/6 的校验计算中效果显著。 - 通常配备写缓存（Write
            Cache），可大幅提升随机写性能。 -
            对操作系统透明，操作系统只能看到一个逻辑磁盘。 - 支持从 RAID
            阵列引导（Boot from RAID）。
            

**劣势**： - 成本较高。 -
            控制器故障后，如无相同型号控制器，可能无法读取阵列数据。 -
            控制器固件（Firmware）可能有缺陷（Bug），且升级不如软件灵活。
            -
            缓存丢失风险：如果断电且无电池保护，写缓存中的数据可能丢失。
            

### 4.2
            电池备份单元（BBU）与超级电容

            

硬件 RAID 控制器通常配备电池备份单元（BBU，Battery Backup
            Unit）或超级电容（Supercapacitor）来保护写缓存中的数据。
            
```
BBU 与超级电容对比：

+──────────────+──────────────────────+──────────────────────+
| 特性         | BBU（锂电池）        | 超级电容             |
+──────────────+──────────────────────+──────────────────────+
| 保护时长     | 24-72 小时           | 数分钟（配合闪存）   |
| 使用寿命     | 2-3 年需更换         | 通常与控制器同寿命   |
| 需要定期校准 | 是（Learn Cycle）    | 否                   |
| 校准期间     | 可能降为 Write-Through | 无影响             |
| 温度敏感性   | 高（高温缩短寿命）   | 较低                 |
| 推荐程度     | 传统方案             | 现代首选             |
+──────────────+──────────────────────+──────────────────────+
```

            

BBU 的学习周期（Learn
            Cycle）是一个经常被忽视的问题。在学习周期期间，控制器会将写策略从回写（Write-Back）切换为透写（Write-Through），导致写性能骤降。生产环境中应监控
            BBU 状态并安排在低负载时段进行学习周期。
            

### 4.3 软件 RAID（mdadm）

            

Linux 内核提供了 MD（Multiple Devices）驱动来实现软件
            RAID。mdadm（Multiple Disk Administration）是管理 MD
            设备的用户空间工具。
            

**优势**： - 零硬件成本。 -
            不依赖特定控制器，换主板后阵列仍可识别。 -
            代码开源，透明可审计。 -
            支持在线扩容（Grow）和级别转换（Reshape）。 - 现代 CPU 的
            SIMD 指令（如 SSE2、AVX2）使校验计算非常高效。
            

**劣势**： - 校验计算占用 CPU
            资源（但在现代多核 CPU 上影响极小）。 -
            缺少硬件写缓存，随机写性能不如带 BBU 的硬件 RAID。 - 从软件
            RAID 引导需要额外配置（initramfs 中包含 mdadm）。
            

### 4.4 性能对比

            

以下是典型场景下硬件 RAID（带 BBU 写缓存）与软件
            RAID（mdadm）的性能对比：
            
```
测试环境：8 × 7200RPM SATA 磁盘，RAID 5

+-----------------------+------------+------------+
| 指标                  | 硬件 RAID  | 软件 RAID  |
+-----------------------+------------+------------+
| 顺序读 (MB/s)        | ~800       | ~780       |
| 顺序写 (MB/s)        | ~600       | ~550       |
| 随机读 4K IOPS       | ~1200      | ~1150      |
| 随机写 4K IOPS       | ~8000*     | ~450       |
| CPU 占用率           | 
            

## 五、mdadm 实战

            

### 5.1 安装与准备

            
```
# Debian/Ubuntu
sudo apt-get install mdadm

# RHEL/CentOS
sudo yum install mdadm

# 确认内核支持 MD
cat /proc/mdstat

# 查看可用磁盘
lsblk
```

            

### 5.2 创建 RAID 阵列

            

#### 5.2.1 创建 RAID 5

            
```
# 使用 4 块磁盘创建 RAID 5
sudo mdadm --create /dev/md0 \
  --level=5 \
  --raid-devices=4 \
  /dev/sdb /dev/sdc /dev/sdd /dev/sde

# 查看创建进度（初始同步）
cat /proc/mdstat

# 输出示例：
# md0 : active raid5 sde[4] sdd[2] sdc[1] sdb[0]
#       3145728 blocks super 1.2 level 5, 512k chunk, algorithm 2 [4/3] [UUU_]
#       [=====>...............]  recovery = 28.3% (297216/1048576) finish=0.5min speed=22862K/sec
```

            

#### 5.2.2 创建 RAID 10

            
```
# 使用 4 块磁盘创建 RAID 10
sudo mdadm --create /dev/md1 \
  --level=10 \
  --raid-devices=4 \
  --layout=n2 \
  /dev/sdf /dev/sdg /dev/sdh /dev/sdi

# --layout=n2 表示 near 布局，每份数据 2 个副本（默认值）
# 其他布局选项：f2（far）、o2（offset）
```

            

#### 5.2.3 创建 RAID 6

            
```
# 使用 6 块磁盘创建 RAID 6
sudo mdadm --create /dev/md2 \
  --level=6 \
  --raid-devices=6 \
  --chunk=256 \
  /dev/sdk /dev/sdl /dev/sdm /dev/sdn /dev/sdo /dev/sdp

# --chunk=256 指定条带大小为 256KB
```

            

### 5.3 保存配置与自动装配

            
```
# 扫描当前阵列并保存到配置文件
sudo mdadm --detail --scan >> /etc/mdadm/mdadm.conf

# 更新 initramfs 以确保启动时自动装配
sudo update-initramfs -u

# 手动装配（通常不需要）
sudo mdadm --assemble --scan
```

            

### 5.4 管理与监控

            
```
# 查看阵列详细信息
sudo mdadm --detail /dev/md0

# 查看阵列状态（简要）
cat /proc/mdstat

# 查看单块磁盘在阵列中的信息
sudo mdadm --examine /dev/sdb

# 停止阵列
sudo mdadm --stop /dev/md0

# 移除已停止的阵列
sudo mdadm --remove /dev/md0
```

            

### 5.5 模拟故障与替换

            
```
# 标记一块磁盘为故障
sudo mdadm --manage /dev/md0 --fail /dev/sdc

# 从阵列中移除故障盘
sudo mdadm --manage /dev/md0 --remove /dev/sdc

# 添加新磁盘（自动开始重建）
sudo mdadm --manage /dev/md0 --add /dev/sdz

# 查看重建进度
watch -n 1 cat /proc/mdstat

# 输出示例：
# md0 : active raid5 sdz[4] sde[3] sdd[2] sdb[0]
#       3145728 blocks super 1.2 level 5, 512k chunk, algorithm 2 [4/3] [U_UU]
#       [======>.............]  recovery = 32.5% (341248/1048576) finish=0.4min speed=29K/sec
```

            

### 5.6 添加热备盘

            
```
# 添加热备盘（Spare Disk）
sudo mdadm --manage /dev/md0 --add-spare /dev/sdy

# 或在创建时指定热备
sudo mdadm --create /dev/md0 \
  --level=5 \
  --raid-devices=4 \
  --spare-devices=1 \
  /dev/sdb /dev/sdc /dev/sdd /dev/sde /dev/sdf

# sdf 将作为热备盘，当某块盘故障时自动替换
```

            

### 5.7 阵列扩容（Grow）

            
```
# 向现有 RAID 5 阵列添加磁盘（从 4 盘扩到 5 盘）
sudo mdadm --grow /dev/md0 \
  --raid-devices=5 \
  --add /dev/sdq

# 查看 reshape 进度
cat /proc/mdstat

# reshape 完成后，扩展文件系统
# 对于 ext4：
sudo resize2fs /dev/md0

# 对于 XFS：
sudo xfs_growfs /mountpoint
```

            

### 5.8 RAID
            级别转换（Reshape）

            

mdadm 支持在线将一个 RAID 级别转换为另一个。例如，从 RAID
            5 转换为 RAID 6：
            
```
# 首先确保有足够的磁盘
sudo mdadm --manage /dev/md0 --add /dev/sdr

# 从 RAID 5 转换为 RAID 6
sudo mdadm --grow /dev/md0 \
  --level=6 \
  --raid-devices=5 \
  --backup-file=/root/md0-backup

# --backup-file 是必需的，用于在 reshape 过程中保存关键数据
# 确保 backup-file 不在正在 reshape 的阵列上
```

            

**注意**：Reshape
            操作可能耗时数小时甚至数天，取决于阵列大小。在此期间，如果系统断电，backup-file
            将用于恢复。
            

### 5.9 检查与修复

            
```
# 启动阵列一致性检查
sudo echo check > /sys/block/md0/md/sync_action

# 查看检查进度
cat /proc/mdstat

# 查看不一致块（mismatch）数量
cat /sys/block/md0/md/mismatch_cnt

# 如有不一致，执行修复
sudo echo repair > /sys/block/md0/md/sync_action
```

            
            

## 六、RAID 重建风险

            

### 6.1 重建过程

            

当 RAID
            阵列中一块磁盘故障后，阵列会进入降级（Degraded）状态。此时需要用一块新磁盘替换故障盘，然后阵列控制器（硬件或软件）会从其余磁盘上读取数据和校验信息，重新计算并写入新磁盘上缺失的数据。这个过程称为重建（Rebuild）。
            

重建过程的关键问题： -
            重建期间，所有存活磁盘都处于高负载读取状态。 - RAID 5
            降级后无冗余，重建期间再丢一块盘就会丢失所有数据。 - RAID 6
            降级一块后仍有单盘冗余，但降级两块后再出问题同样会丢数据。
            

### 6.2
            不可恢复读错误（URE/UBE）

            

不可恢复读错误（URE，Unrecoverable Read
            Error），也称为不可恢复位错误（UBE，Unrecoverable Bit
            Error），是指磁盘在正常读取过程中遇到的无法通过 ECC
            纠正的数据错误。
            

磁盘厂商通常以”每读取多少位遇到一个 URE”来标注：
            
```
典型 URE 率：

+─────────────────+──────────────+──────────────────+
| 磁盘类型        | URE 率       | 约每多少 TB 一次  |
+─────────────────+──────────────+──────────────────+
| 消费级 SATA     | 10^14        | ~12.5 TB         |
| 企业级 SATA     | 10^15        | ~125 TB          |
| 企业级 SAS      | 10^16        | ~1250 TB         |
| 企业级 SSD      | 10^17        | ~12500 TB        |
+─────────────────+──────────────+──────────────────+

计算方法：10^14 位 = 10^14 / 8 / 10^12 TB ≈ 12.5 TB
```

            

### 6.3 重建期间双故障概率

            

RAID 5 阵列在重建期间遭遇第二块盘故障（包括
            URE）的风险不容忽视。以下是概率估算：
            
```
场景：8 盘 RAID 5，每盘 4TB，消费级 SATA 盘（URE = 10^14）

重建需读取数据量 = 7 × 4TB = 28TB
URE 率 = 每 12.5TB 读取遇到一次

重建期间遇到 URE 的概率：
  P(URE) = 1 - (1 - 1/12.5)^28
         ≈ 1 - (0.92)^28
         ≈ 1 - 0.098
         ≈ 90%

即：重建过程中有约 90% 的概率遇到至少一次不可恢复读错误！
```

            

这个概率令人警醒。这就是为什么： - **大容量 HDD
            阵列应使用 RAID 6 而非 RAID 5**。 -
            **应使用企业级磁盘**（URE
            率低一个数量级以上）。 -
            **热备盘至关重要**：缩短降级时间，减少窗口期。
            

### 6.4 重建时间估算

            

重建时间取决于多个因素：
            
```
重建时间估算公式：

                    单盘容量
重建时间 ≈ ──────────────────────────────
            重建速度 × (1 - 前台负载占比)

示例：4TB 磁盘，重建速度 200MB/s，前台负载占 50%

重建时间 ≈ 4,000,000 MB / (200 MB/s × 0.5)
         ≈ 40,000 秒
         ≈ 11.1 小时

mdadm 中可通过以下参数调整重建速度：
```

            
```
# 查看当前重建速度限制
cat /proc/sys/dev/raid/speed_limit_min
cat /proc/sys/dev/raid/speed_limit_max

# 提高最小重建速度（单位：KB/s）
echo 50000 > /proc/sys/dev/raid/speed_limit_min

# 提高最大重建速度
echo 500000 > /proc/sys/dev/raid/speed_limit_max
```

            

### 6.5
            降低重建风险的最佳实践

            
            
- **使用 RAID 6 或 RAID
            10**：提供双盘容错。
            
- **配置热备盘**：故障后立即自动重建，最小化降级窗口。
            
- **使用企业级磁盘**：URE 率低 10—100
            倍。
            
- **定期巡检（Scrub）**：提前发现和修复潜在的
            URE。
            
- **控制阵列规模**：避免单阵列超过 8—10
            块大容量盘。
            
- **监控磁盘 SMART
            数据**：提前发现磁盘衰退迹象（Reallocated
            Sectors、Pending Sectors 等）。
            
            
```
# 设置每周日凌晨 2 点执行 RAID 巡检
echo "0 2 * * 0 root echo check > /sys/block/md0/md/sync_action" >> /etc/crontab
```

            
            

## 七、RAID 与 SSD

            

### 7.1 SSD 上的 RAID 考量

            

固态硬盘（SSD，Solid State
            Drive）的特性与机械硬盘（HDD）有根本差异，在 SSD 上使用 RAID
            需要考虑特殊问题。
            

**SSD 的关键特性**： - 无寻道时间（Seek
            Time），随机 I/O 性能极高。 -
            写入前需要擦除（Erase-Before-Write），导致写放大（Write
            Amplification）。 - 有限的写入寿命（P/E
            Cycles，Program/Erase Cycles）。 - 支持 TRIM 命令通知 SSD
            哪些块不再使用。
            

### 7.2 TRIM 透传（TRIM
            Passthrough）

            

TRIM（也称为 UNMAP 或 DISCARD）命令告诉 SSD
            某些逻辑块不再包含有效数据，SSD
            控制器可以在后台回收这些块。如果 RAID 层不支持 TRIM
            透传，SSD 的垃圾回收（Garbage
            Collection）效率会大幅降低。
            
```
# 检查 mdadm 阵列是否支持 discard
cat /sys/block/md0/queue/discard_max_bytes

# 创建阵列时不会自动启用 discard，需在挂载文件系统时指定
mount -o discard /dev/md0 /mnt/data

# 或使用 fstrim 定期手动触发
sudo fstrim -v /mnt/data

# mdadm 从 Linux 内核 3.7 开始支持 RAID 0/1/10 的 discard 透传
# RAID 5/6 的 discard 支持从内核 4.4 开始
```

            

**注意**：RAID 5/6 的 TRIM
            透传有安全隐患——已 TRIM
            的块在读取时返回零值，但校验信息可能未同步更新，导致校验不一致。部分内核版本默认禁用
            RAID 5/6 的 discard 支持。
            

### 7.3 写放大问题

            

SSD 本身存在写放大（Write Amplification
            Factor，WAF），RAID 的写惩罚会叠加 SSD 的写放大：
            
```
总写放大 = RAID 写惩罚 × SSD 内部写放大

示例：
- RAID 5 写惩罚 = 4
- SSD 内部 WAF = 2（典型值，取决于工作负载和预留空间）
- 总写放大 = 4 × 2 = 8

即：应用层写入 1GB 数据，SSD 闪存实际写入 8GB
这会加速 SSD 寿命消耗
```

            

### 7.4 SSD RAID 的推荐配置

            
```
SSD RAID 推荐：

+──────────────+──────────────────────────────────────────────+
| 配置项       | 推荐                                         |
+──────────────+──────────────────────────────────────────────+
| RAID 级别    | RAID 10 首选（写惩罚最低）                   |
|              | RAID 5/6 次选（注意写放大对寿命的影响）      |
| TRIM         | 启用（mount -o discard 或定期 fstrim）       |
| 文件系统     | ext4 或 XFS（对 SSD 友好）                   |
| 条带大小     | 与 SSD 页大小对齐（通常 4KB 或 8KB 的倍数） |
| 分区对齐     | 确保起始扇区对齐到 1MB 边界                  |
| 预留空间     | 保留 10%-20% 不分区（Over-Provisioning）     |
| I/O 调度器   | none/noop（SSD 不需要电梯调度）              |
+──────────────+──────────────────────────────────────────────+
```

            

### 7.5 NVMe SSD 与 RAID

            

NVMe（Non-Volatile Memory Express）SSD 通过 PCIe 总线直连
            CPU，延迟极低。在 NVMe SSD 上使用 RAID 有额外考虑：
            
```
# 检查 NVMe 设备
sudo nvme list

# mdadm 可以使用 NVMe 设备
sudo mdadm --create /dev/md0 \
  --level=1 \
  --raid-devices=2 \
  /dev/nvme0n1 /dev/nvme1n1

# Intel VROC（Virtual RAID on CPU）支持硬件级 NVMe RAID
# 需要特定 CPU 和主板支持
```

            

对于高性能 NVMe SSD，RAID
            的软件开销可能成为瓶颈。在这种场景下，需要评估是否真的需要
            RAID，或者应该使用更上层的冗余机制（如数据库复制、分布式存储）。
            
            

## 八、RAID 性能调优

            

### 8.1 条带大小（Chunk
            Size）选择

            

条带大小（Chunk Size）是 RAID
            性能调优中最重要的参数。它决定了单次 I/O
            操作会涉及多少块磁盘。
            
```
条带大小选择原则：

应用类型              推荐条带大小    原因
─────────────         ──────────      ──────────────────────────
大文件顺序 I/O        256KB-1MB       单次 I/O 跨多盘，最大化带宽
数据库 OLTP           64KB-128KB      平衡并发和单次 I/O 效率
文件服务器            128KB-256KB     适应混合负载
虚拟化平台            64KB            适配虚拟机的 I/O 粒度
```

            

条带大小的影响：
            
```
过小的条带大小（如 4KB）：
- 每次 I/O 都会涉及所有磁盘 → 高带宽
- 但并发 I/O 时磁盘争用严重 → IOPS 低
- 小文件可能跨盘存储 → 增加延迟

过大的条带大小（如 4MB）：
- 小 I/O 只涉及单个磁盘 → 低带宽
- 但并发 I/O 时各盘独立服务 → 高 IOPS
- 小文件集中在一块盘上 → 可能导致热点
```

            

### 8.2 文件系统对齐

            

文件系统的参数应与 RAID
            的条带参数对齐，以避免跨条带边界的 I/O 导致性能下降。
            
```
# 计算 RAID 5 的条带宽度（Stripe Width）
# 4 盘 RAID 5，chunk = 256KB
# 数据盘数 = 4 - 1 = 3
# 条带宽度 = 3 × 256KB = 768KB

# 创建对齐的 ext4 文件系统
sudo mkfs.ext4 \
  -b 4096 \
  -E stride=64,stripe-width=192 \
  /dev/md0

# stride = chunk_size / block_size = 256KB / 4KB = 64
# stripe-width = stride × 数据盘数 = 64 × 3 = 192

# 创建对齐的 XFS 文件系统
sudo mkfs.xfs \
  -d su=256k,sw=3 \
  /dev/md0

# su = stripe unit (chunk size)
# sw = stripe width (数据盘数)
```

            

### 8.3 预读（Read-Ahead）调优

            

预读（Read-Ahead）是操作系统在检测到顺序读模式时，提前从磁盘读取后续数据到内存缓存中的机制。
            
```
# 查看当前预读值（单位：512 字节扇区）
blockdev --getra /dev/md0

# 设置预读值
# 对于大文件顺序读场景，可增大预读
sudo blockdev --setra 4096 /dev/md0  # 4096 × 512B = 2MB

# 推荐预读值 = 条带宽度 的 2-4 倍
# 例：条带宽度 768KB → 预读设为 2MB-3MB

# 对于随机 I/O 为主的场景，减小预读
sudo blockdev --setra 256 /dev/md0  # 128KB
```

            

### 8.4 位图（Bitmap）

            

mdadm 支持写意图位图（Write-Intent
            Bitmap），用于记录哪些条带上有未完成的写操作。位图的主要作用是：在系统非正常关机后，只需要重新同步位图标记为”脏”的条带，而不需要重新同步整个阵列。
            
```
# 为现有阵列添加内部位图
sudo mdadm --grow /dev/md0 --bitmap=internal

# 使用外部位图文件（放在其他磁盘上以减少性能影响）
sudo mdadm --grow /dev/md0 --bitmap=/path/to/bitmap

# 移除位图
sudo mdadm --grow /dev/md0 --bitmap=none

# 查看位图状态
sudo mdadm --detail /dev/md0 | grep -i bitmap
```

            

**位图对性能的影响**：
            
```
+──────────────────+──────────────+──────────────+
| 场景             | 无位图       | 有位图       |
+──────────────────+──────────────+──────────────+
| 正常运行写性能   | 基准         | 降低 5-15%   |
| 非正常关机后恢复 | 全阵列同步   | 仅脏区域同步 |
|                  | (数小时)     | (数分钟)     |
+──────────────────+──────────────+──────────────+
```

            

对于生产环境，强烈推荐启用位图。恢复时间的巨大缩短远超正常运行时的微小性能损失。
            

### 8.5 I/O 调度器

            

不同类型的磁盘应使用不同的 I/O 调度器（I/O
            Scheduler）：
            
```
# 查看当前调度器
cat /sys/block/sdb/queue/scheduler

# HDD 推荐使用 mq-deadline 或 bfq
echo mq-deadline > /sys/block/sdb/queue/scheduler

# SSD 推荐使用 none（即 noop）
echo none > /sys/block/nvme0n1/queue/scheduler

# 设置 RAID 设备的调度器
echo none > /sys/block/md0/queue/scheduler
```

            

### 8.6 内核参数调优

            
```
# 条带缓存大小（stripe_cache_size）
# 仅适用于 RAID 5/6，增大可提升性能但消耗更多内存
echo 8192 > /sys/block/md0/md/stripe_cache_size

# 默认值通常是 256，对于高性能场景可增到 4096-16384
# 每个条带缓存条目大小 = 页大小(4KB) × 阵列中的磁盘数
# 例：8 盘阵列，stripe_cache_size=8192 → 内存消耗 = 4KB × 8 × 8192 = 256MB

# 组写（group_thread_cnt）
echo 8 > /sys/block/md0/md/group_thread_cnt

# 同步速度限制
echo 200000 > /proc/sys/dev/raid/speed_limit_min
echo 500000 > /proc/sys/dev/raid/speed_limit_max
```

            

### 8.7 性能测试方法

            
```
# 使用 fio 进行 RAID 性能测试

# 顺序写测试
fio --name=seq-write \
    --ioengine=libaio \
    --direct=1 \
    --bs=1M \
    --numjobs=1 \
    --iodepth=32 \
    --rw=write \
    --size=10G \
    --filename=/dev/md0

# 随机读测试
fio --name=rand-read \
    --ioengine=libaio \
    --direct=1 \
    --bs=4K \
    --numjobs=4 \
    --iodepth=32 \
    --rw=randread \
    --size=10G \
    --runtime=60 \
    --filename=/dev/md0

# 混合读写测试（70% 读 30% 写）
fio --name=mixed \
    --ioengine=libaio \
    --direct=1 \
    --bs=4K \
    --numjobs=4 \
    --iodepth=32 \
    --rw=randrw \
    --rwmixread=70 \
    --size=10G \
    --runtime=60 \
    --filename=/dev/md0
```

            
            

## 九、RAID 监控与告警

            

### 9.1 /proc/mdstat

            

`/proc/mdstat` 是查看 RAID
            阵列状态的最基本接口。
            
```
# 查看阵列状态
cat /proc/mdstat

# 典型输出：
# Personalities : [raid1] [raid6] [raid5] [raid4]
# md0 : active raid5 sde[3] sdd[2] sdc[1] sdb[0]
#       3145728 blocks super 1.2 level 5, 512k chunk, algorithm 2 [4/4] [UUUU]
#       bitmap: 0/1 pages [0KB], 65536KB chunk
#
# md1 : active raid1 sdg[1] sdf[0]
#       1048576 blocks super 1.2 [2/2] [UU]
#
# unused devices: 

# 状态字符含义：
# [UUUU] - 所有盘正常（U = Up）
# [UU_U] - 第三块盘故障（_ = Down）
# [4/3]  - 阵列有 4 块盘，当前 3 块正常
```

            

### 9.2 mdadm –monitor

            

mdadm 内置了监控守护进程（Monitor
            Daemon），可以监控阵列状态变化并发送告警。
            
```
# 启动 mdadm 监控守护进程
sudo mdadm --monitor --daemonise --mail=admin@example.com --scan

# 关键参数：
# --daemonise  以守护进程方式运行
# --mail       指定告警邮件接收地址
# --scan       监控配置文件中定义的所有阵列
# --delay=300  检查间隔（秒），默认 60

# 监控的事件类型：
# DeviceDisappeared  - 阵列消失
# RebuildStarted     - 重建开始
# RebuildFinished    - 重建完成
# Fail               - 磁盘故障
# FailSpare          - 热备盘故障
# SpareActive        - 热备盘激活
# NewArray            - 新阵列创建
# DegradedArray      - 阵列降级
# MoveSpare          - 热备盘移动
```

            

### 9.3 systemd 集成

            

现代 Linux 发行版使用 systemd 管理 mdadm 监控服务：
            
```
# 查看 mdadm 监控服务状态
systemctl status mdmonitor

# 启用并启动监控服务
sudo systemctl enable mdmonitor
sudo systemctl start mdmonitor

# 配置文件位置
# Debian/Ubuntu: /etc/mdadm/mdadm.conf
# RHEL/CentOS:   /etc/mdadm.conf

# 在配置文件中设置邮件告警
# MAILADDR admin@example.com
```

            

### 9.4 SMART 集成

            

SMART（Self-Monitoring, Analysis and Reporting
            Technology）可以提供磁盘健康状态的早期预警。结合 RAID
            监控，可以在磁盘完全故障前进行预防性替换。
            
```
# 安装 smartmontools
sudo apt-get install smartmontools

# 检查磁盘 SMART 状态
sudo smartctl -a /dev/sdb

# 重点关注的 SMART 属性：
# 5   - Reallocated_Sector_Ct   （重新分配扇区数）
# 187 - Reported_Uncorrect      （报告的不可纠正错误）
# 188 - Command_Timeout         （命令超时）
# 197 - Current_Pending_Sector  （当前待处理扇区）
# 198 - Offline_Uncorrectable   （离线不可纠正扇区）

# 启用 SMART 自动监控
sudo smartctl -s on /dev/sdb

# 配置 smartd 守护进程
# 编辑 /etc/smartd.conf
# /dev/sdb -a -o on -S on -s (S/../.././02|L/../../6/03) -m admin@example.com
# -s (S/../.././02|L/../../6/03) 表示每天凌晨 2 点短测试，每周六凌晨 3 点长测试
```

            

### 9.5 邮件告警配置

            
```
# 安装邮件发送工具
sudo apt-get install mailutils

# 测试邮件发送
echo "RAID test alert" | mail -s "RAID Alert Test" admin@example.com

# 配置 mdadm 邮件告警
# 编辑 /etc/mdadm/mdadm.conf，添加：
# MAILADDR admin@example.com
# MAILFROM raid-monitor@hostname.example.com

# 测试 mdadm 告警
sudo mdadm --monitor --scan --test --oneshot

# 对于不支持直接发送邮件的环境，可使用自定义脚本：
# PROGRAM /usr/local/bin/raid-alert.sh
```

            

编写自定义告警脚本示例：
            
```
#!/bin/bash
# /usr/local/bin/raid-alert.sh
# mdadm 监控告警脚本

EVENT="$1"
DEVICE="$2"
COMPONENT="$3"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
HOSTNAME=$(hostname)

MESSAGE="[${TIMESTAMP}] RAID 告警
主机: ${HOSTNAME}
事件: ${EVENT}
设备: ${DEVICE}
组件: ${COMPONENT}

阵列状态:
$(cat /proc/mdstat)

磁盘 SMART 摘要:
$(smartctl -H ${COMPONENT} 2>/dev/null || echo '无法获取 SMART 信息')
"

# 发送邮件
echo "${MESSAGE}" | mail -s "[RAID Alert] ${EVENT} on ${HOSTNAME}" admin@example.com

# 同时写入系统日志
logger -t raid-alert "${EVENT} on ${DEVICE} (${COMPONENT})"

# 可选：发送到监控系统（如 Prometheus Alertmanager）
# curl -X POST http://alertmanager:9093/api/v1/alerts \
#   -H "Content-Type: application/json" \
#   -d "[{\"labels\":{\"alertname\":\"RAIDAlert\",\"severity\":\"critical\",\"event\":\"${EVENT}\",\"device\":\"${DEVICE}\"}}]"
```

            

### 9.6 自动化监控脚本

            

以下是一个综合的 RAID 健康检查脚本：
            
```
#!/bin/bash
# /usr/local/bin/raid-health-check.sh
# RAID 综合健康检查脚本

set -euo pipefail

ALERT_EMAIL="admin@example.com"
LOG_FILE="/var/log/raid-health.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

check_md_status() {
    log "检查 MD 阵列状态..."
    local degraded=0

    for md in /sys/block/md*/md/degraded; do
        if [ -f "${md}" ]; then
            local dev
            dev=$(echo "${md}" | sed 's|/sys/block/\(md[0-9]*\)/.*|\1|')
            local deg
            deg=$(cat "${md}")
            if [ "${deg}" -gt 0 ]; then
                log "警告: /dev/${dev} 处于降级状态 (降级盘数: ${deg})"
                degraded=1
            else
                log "正常: /dev/${dev} 运行正常"
            fi
        fi
    done

    return ${degraded}
}

check_mismatch() {
    log "检查校验一致性..."
    for md in /sys/block/md*/md/mismatch_cnt; do
        if [ -f "${md}" ]; then
            local dev
            dev=$(echo "${md}" | sed 's|/sys/block/\(md[0-9]*\)/.*|\1|')
            local cnt
            cnt=$(cat "${md}")
            if [ "${cnt}" -gt 0 ]; then
                log "警告: /dev/${dev} 存在 ${cnt} 个不一致块"
            fi
        fi
    done
}

check_smart() {
    log "检查磁盘 SMART 状态..."
    for md_dev in /dev/md*; do
        if [ -b "${md_dev}" ]; then
            local members
            members=$(mdadm --detail "${md_dev}" 2>/dev/null | \
                      grep '/dev/sd' | awk '{print $NF}')
            for disk in ${members}; do
                local health
                health=$(smartctl -H "${disk}" 2>/dev/null | \
                         grep 'SMART overall-health' | awk '{print $NF}')
                if [ "${health}" != "PASSED" ] && [ -n "${health}" ]; then
                    log "警告: ${disk} SMART 健康检查未通过: ${health}"
                fi
            done
        fi
    done
}

# 执行检查
log "=== RAID 健康检查开始 ==="
check_md_status || log "存在降级阵列，请及时处理"
check_mismatch
check_smart
log "=== RAID 健康检查完成 ==="
```

            
```
# 将健康检查加入 crontab，每小时执行一次
echo "0 * * * * root /usr/local/bin/raid-health-check.sh" >> /etc/crontab
```

            
            

## 十、RAID 之外的选择

            

### 10.1 RAID 的局限性

            

RAID 作为单机存储冗余方案，存在固有的局限性：
            
            
- **单点故障**：RAID
            保护的是磁盘故障，但无法保护主机故障（如主板、电源、机房断电）。
            
- **扩展性有限**：单个 RAID
            阵列的规模受限于控制器端口数和重建效率。
            
- **重建压力**：大容量阵列的重建时间长达数小时甚至数天，期间有数据丢失风险。
            
- **不能替代备份**：RAID
            不能防御逻辑错误、误操作或勒索软件。
            
            

### 10.2 纠删码（Erasure
            Coding）

            

纠删码（Erasure Coding）是 RAID
            校验思想的推广。它将数据分割为 k 个数据块，并计算出 m
            个校验块（编码参数记为 EC(k, m)），可以容忍任意 m
            个块（数据块或校验块）丢失。
            
```
纠删码 vs RAID 对比：

+──────────────+──────────────────────+──────────────────────+
| 特性         | 传统 RAID            | 纠删码               |
+──────────────+──────────────────────+──────────────────────+
| 冗余粒度     | 整块磁盘             | 数据块级别           |
| 数据分布     | 单机多盘             | 可跨节点分布         |
| 容错数量     | 固定（1或2）         | 可配置（m 个）       |
| 存储效率     | 50%（RAID 1）        | k/(k+m)             |
|              | ~75%（RAID 5，4盘）  | 如 8/12 ≈ 67%       |
| 恢复复杂度   | 低                   | 较高（需网络传输）   |
| 典型应用     | 单机存储             | 分布式存储系统       |
+──────────────+──────────────────────+──────────────────────+

常见纠删码参数：
- EC(4, 2): 4 数据块 + 2 校验块，容忍 2 块丢失，效率 66.7%
- EC(8, 3): 8 数据块 + 3 校验块，容忍 3 块丢失，效率 72.7%
- EC(10, 4): 10 数据块 + 4 校验块，容忍 4 块丢失，效率 71.4%
```

            

纠删码在分布式存储系统中广泛应用，如 Ceph、MinIO、HDFS
            等。
            

### 10.3 Ceph CRUSH

            

Ceph 是一个分布式存储系统，其数据放置算法
            CRUSH（Controlled Replication Under Scalable
            Hashing）可以替代传统 RAID 提供数据冗余。
            
```
Ceph 的冗余策略：

1. 副本池（Replicated Pool）：
   - 类似 RAID 1，每份数据保持 2-3 个副本
   - 副本分布在不同节点/机架上
   - 配置示例：size=3, min_size=2

2. 纠删码池（Erasure Coded Pool）：
   - 类似 RAID 5/6 的推广
   - 可配置 k 和 m 参数
   - 存储效率高于副本池
```

            
```
# Ceph 创建纠删码池示例
ceph osd pool create ec-pool 128 erasure

# 查看默认纠删码配置（通常为 k=2, m=2）
ceph osd erasure-code-profile get default

# 创建自定义配置
ceph osd erasure-code-profile set my-ec-profile \
  k=8 m=3 \
  crush-failure-domain=host

# 使用自定义配置创建池
ceph osd pool create my-ec-pool 256 erasure my-ec-profile
```

            

Ceph 的优势在于： -
            数据副本分布在不同物理主机上，避免单机故障。 -
            自动平衡和自动恢复。 - 支持在线扩容。 - OSD（Object Storage
            Daemon）所在的本地磁盘不需要 RAID。
            

### 10.4 ZFS RAID-Z

            

ZFS 的 RAID-Z 是对传统 RAID 5/6 的改进实现，解决了 RAID 5
            的写空洞（Write Hole）问题。
            
```
ZFS RAID-Z 变体：

+──────────+──────────+──────────────────────────────+
| 级别     | 校验盘数 | 等价于                       |
+──────────+──────────+──────────────────────────────+
| RAID-Z1  | 1        | 类似 RAID 5（单校验）        |
| RAID-Z2  | 2        | 类似 RAID 6（双校验）        |
| RAID-Z3  | 3        | 三重校验（无传统 RAID 等价） |
+──────────+──────────+──────────────────────────────+
```

            
```
# 创建 RAID-Z1 池（类似 RAID 5）
zpool create tank raidz1 /dev/sdb /dev/sdc /dev/sdd /dev/sde

# 创建 RAID-Z2 池（类似 RAID 6）
zpool create tank raidz2 /dev/sdb /dev/sdc /dev/sdd /dev/sde /dev/sdf

# 创建 RAID-Z3 池（三重校验）
zpool create tank raidz3 \
  /dev/sdb /dev/sdc /dev/sdd /dev/sde /dev/sdf /dev/sdg /dev/sdh

# 查看池状态
zpool status tank

# 启动数据巡检（Scrub）
zpool scrub tank
```

            

ZFS RAID-Z 相对于传统 RAID 5/6 的优势：
            
            
- **无写空洞**：ZFS 使用
            Copy-on-Write（写时复制）机制，数据和校验始终保持一致。
            
- **端到端校验**：ZFS
            对每个数据块计算校验和（Checksum），可以检测和修复静默数据损坏（Silent
            Data Corruption）。
            
- **可变条带宽度**：ZFS
            的条带宽度可以根据写入大小动态调整，避免了 RAID 5
            的小写惩罚。
            
- **自修复**：读取数据时如果检测到校验错误，ZFS
            会自动从冗余数据中恢复并修复损坏的副本。
            
            

### 10.5 何时 RAID 不再足够

            

以下场景应考虑超越传统 RAID 的解决方案：
            
```
+──────────────────────────+──────────────────────────────────+
| 场景                     | 推荐替代方案                     |
+──────────────────────────+──────────────────────────────────+
| 需要跨主机容灾           | 分布式存储（Ceph、GlusterFS）    |
| 超大规模存储（PB 级别） | 纠删码 + 分布式文件系统          |
| 需要防止静默数据损坏     | ZFS RAID-Z 或 Btrfs RAID        |
| 云原生应用               | 云存储服务（EBS、Azure Disk）    |
| 需要秒级 RTO             | 同步复制 + 自动故障切换          |
| 超大容量单盘（10TB+）   | RAID-Z2/Z3 或纠删码             |
+──────────────────────────+──────────────────────────────────+
```

            

### 10.6 混合方案

            

在实际生产环境中，通常会将多种冗余机制组合使用：
            
```
典型的企业存储架构：

层级 1: 本地磁盘 RAID（或 ZFS RAID-Z）
        ↓
层级 2: LVM 逻辑卷管理
        ↓
层级 3: 文件系统（ext4/XFS/ZFS）
        ↓
层级 4: 应用层复制（数据库主从、分布式存储）
        ↓
层级 5: 异地备份

每个层级解决不同的问题：
- RAID 保护磁盘硬件故障
- LVM 提供灵活的容量管理
- 文件系统保证数据一致性
- 应用层复制保护主机故障
- 异地备份保护站点级灾难
```

            
            

## 参考资料

            
            
- Patterson, D. A., Gibson, G., & Katz, R. H. (1988).
            *A Case for Redundant Arrays of Inexpensive Disks
            (RAID)*. ACM SIGMOD Conference. https://www.cs.cmu.edu/~garth/RAIDpaper/Patterson88.pdf
            
- Linux MD RAID Wiki. *Linux Raid*. https://raid.wiki.kernel.org/index.php/Linux_Raid
            
- Neil Brown. *mdadm man page*. https://man7.org/linux/man-pages/man8/mdadm.8.html
            
- Red Hat Enterprise Linux 文档. *Managing RAID*.
            https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/managing-raid_managing-storage-devices
            
- Adam Leventhal. (2009). *Triple-Parity RAID and
            Beyond*. ACM Queue. https://queue.acm.org/detail.cfm?id=1670144
            
- Bianca Schroeder & Garth A. Gibson. (2007). *Disk
            Failures in the Real World: What Does an MTTF of 1,000,000
            Hours Mean to You?*. FAST ’07. https://www.usenix.org/conference/fast-07/disk-failures-real-world-what-does-mttf-1000000-hours-mean-you
            
- OpenZFS 文档. *ZFS RAID-Z*. https://openzfs.github.io/openzfs-docs/
            
- Ceph 文档. *Erasure Code*. https://docs.ceph.com/en/latest/rados/operations/erasure-code/
            
- smartmontools 项目. *smartctl man page*. https://www.smartmontools.org/wiki/TocDoc
            
- Linux 内核文档. *MD (Multiple Devices) RAID*. https://www.kernel.org/doc/html/latest/admin-guide/md.html
            
            
            

**上一篇**: [LVM
            逻辑卷管理](../19-lvm/lvm.html) **下一篇**: Device
            Mapper：Linux 存储虚拟化层
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-25 · storage
                    

### 【存储工程】Btrfs：写时复制文件系统

                    

ext4 和 XFS 走的是"就地更新"路线：数据写到哪个块，就直接覆盖那个块。这条路线简单、高效，但有一个根本性的问题——如果写到一半断电，磁盘上的数据处于半新半旧的状态，文件系统就损坏了。日志（Journal）机制可以缓解这个问题，但它本质上是"先写一遍日志，再写一遍数据"，写放大不可避免。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。