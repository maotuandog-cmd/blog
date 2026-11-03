# 【存储工程】LSM-Tree 工程调优：三种放大的权衡

来源: https://quant67.com/post/storage/31-lsm-tree-tuning/lsm-tree-tuning.html
日期: 2025-09-09 |

---

LSM-Tree
            的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过
            MemTable 刷盘、再经过多次 Compaction
            合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个
            key
            时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在
            Compaction 完成前无法释放。
            

这三个代价分别对应写放大（Write
            Amplification）、读放大（Read
            Amplification）和空间放大（Space
            Amplification）。三者之间存在根本性的权衡关系：降低其中一项，必然推高另外一项或两项。理解这组权衡，是调优
            LSM-Tree 存储引擎的前提。
            

本文以 RocksDB
            为主要参考实现，从三种放大的定义出发，逐一分析
            Leveled、Tiered、FIFO 三种 Compaction
            策略的放大特性，然后深入讨论 Size Ratio、布隆过滤器（Bloom
            Filter）分配、Compaction
            限流等关键调优参数，最后给出面向不同负载的调优实践方法。关于
            Compaction 本身的实现原理，参见 Compaction：LSM-Tree
            的心脏手术。
            

**场景捷径**：写多读少 → Tiered Compaction +
            [负载感知调优](#九负载感知调优)；读多写少 → Leveled + Bloom Filter；落地参数 → RocksDB
            工程实践；理论底座 → B-Tree
            vs LSM。
            

## 一、三种放大回顾

            

LSM-Tree 的性能特征可以用三个放大指标来量化描述。
            

### 1.1 写放大（Write
            Amplification）

            

写放大（Write
            Amplification）定义为：磁盘上实际写入的数据总量与用户写入数据量的比值。
            
```
WA = 磁盘写入总字节数 / 用户写入字节数
```

            

用户每写入 1 字节数据，该字节至少要经历以下写入过程：
            
            
- 写入 WAL（Write-Ahead Log），1 次写。
            
- 写入 MemTable，MemTable 刷盘到 L0，1 次写。
            
- 从 L0 Compaction 到 L1，1 次写。
            
- 从 L1 Compaction 到 L2，1 次写。
            
- 依此类推，直到最底层。
            
            

每次 Compaction 涉及读取旧 SSTable、归并排序、写出新
            SSTable，因此同一份数据在 Compaction
            过程中会被重复写入。写放大的大小取决于 Compaction
            策略和层数。
            

写放大直接影响三个方面：
            
            
- 磁盘带宽消耗。Compaction 占用的 I/O
            带宽与前台写入竞争。
            
- SSD 寿命。NAND Flash 有擦写次数上限（P/E
            cycles），写放大越高，SSD 磨损越快。
            
- 写吞吐上限。磁盘带宽有限，写放大越大，用户可用的写吞吐越低。
            
            

### 1.2 读放大（Read
            Amplification）

            

读放大（Read Amplification）定义为：完成一次点查（Point
            Lookup）需要的磁盘读取次数（或读取的数据量）与理论最优值的比值。理论最优值是
            1 次读取。
            
```
RA = 完成一次点查的磁盘 I/O 次数
```

            

在 LSM-Tree 中，点查的最坏路径是：
            
            
- 检查 MemTable（内存），无 I/O。
            
- 检查 Immutable MemTable（内存），无 I/O。
            
- 检查 L0 的每个 SSTable。L0 的 SSTable 之间 key
            范围可能重叠，因此最坏情况下需要逐个检查。
            
- 检查 L1，L1 内的 SSTable 无重叠，二分查找定位到一个
            SSTable。
            
- 依次检查 L2、L3……直到最底层。
            
            

对每个 SSTable 的检查通常包含：读取布隆过滤器（Bloom
            Filter）判断 key
            是否可能存在，如果布隆过滤器返回”可能存在”，则读取索引块（Index
            Block）定位数据块（Data Block），最后读取数据块。
            

没有布隆过滤器时，每层需要至少 1 次 I/O（读索引块）+ 1 次
            I/O（读数据块）。加上布隆过滤器后，大部分层的检查可以在内存中完成，只有极少数层需要实际读盘。
            

### 1.3 空间放大（Space
            Amplification）

            

空间放大（Space
            Amplification）定义为：磁盘上实际占用的空间与用户数据的逻辑大小的比值。
            
```
SA = 磁盘实际占用空间 / 用户数据逻辑大小
```

            

空间放大产生的原因有三个：
            
            
- 多版本冗余。同一个 key 的旧版本尚未被 Compaction
            清理，多份数据共存。
            
- 墓碑标记（Tombstone）。删除操作写入 Tombstone，在
            Compaction 将 Tombstone
            传播到最底层并确认无更旧版本后才能真正删除。
            
- 临时空间。Compaction 过程中，新旧 SSTable
            短暂共存，占用额外空间。
            
            

空间放大直接影响存储成本和缓存效率。磁盘上冗余数据越多，有效数据在
            Block Cache 中的占比越低。
            

### 1.4 三者的权衡关系

            

三种放大之间存在此消彼长的关系，这一点可以通过几个极端情况理解：
            
            
- 如果不做任何 Compaction，写放大最小（WA = 1，只写 WAL 和
            flush），但读放大和空间放大趋近无穷大。
            
- 如果每次写入后立即做全局 Compaction，空间放大最小（SA
            趋近 1），读放大也很小，但写放大趋近无穷大。
            
- 如果保留每层大量 SSTable
            不合并（Tiered），写放大较小，但读放大和空间放大较大。
            
            

RocksDB 论文将这一关系概括为 RUM 猜想（Read-Update-Memory
            conjecture）的一个变体：三种放大中，你最多只能同时优化两个。
            
```
优化目标          牺牲项
───────────────────────────────
低 WA + 低 SA  →  高 RA
低 WA + 低 RA  →  高 SA
低 RA + 低 SA  →  高 WA
```

            

不同的 Compaction
            策略，本质上是在这三者之间选取不同的平衡点。
            

## 二、Leveled
            Compaction 放大分析

            

Leveled Compaction 是 LevelDB 和 RocksDB
            的默认策略。每一层的总数据量有上限，相邻层之间的容量比值固定为
            Size Ratio（通常记作 T，默认值为 10）。
            

### 2.1 层级结构

            

Leveled Compaction 的层级结构如下：
            
            
- L0：由 MemTable flush 产生，SSTable 之间 key
            范围可能重叠。L0 的文件数量由
            `level0_file_num_compaction_trigger` 控制，默认为
            4。
            
- L1：总大小由 `max_bytes_for_level_base`
            控制，默认 256 MB。
            
- L2：总大小为 L1 的 T 倍，即 256 MB × 10 = 2.56 GB。
            
- L3：总大小为 L2 的 T 倍，即 25.6 GB。
            
- 依此类推。
            
            

每一层（L1 及以下）内部的 SSTable 之间 key
            范围互不重叠。这意味着对于任意一个 key，每层最多只有一个
            SSTable 包含它。
            
```
层级    容量上限           SSTable 数（假设单个 64 MB）
────────────────────────────────────────────────────
L0     N/A（按文件数）     4 个（触发 Compaction）
L1     256 MB              4 个
L2     2.56 GB             40 个
L3     25.6 GB             400 个
L4     256 GB              4000 个
```

            

总数据量的大部分集中在最底层。设总层数为
            h，则最底层的数据量占比约为 T/(T+1)。当 T = 10
            时，最底层占总数据约 90%。
            

### 2.2 写放大分析

            

在 Leveled Compaction 中，从 Li 到 Li+1 的一次 Compaction
            过程如下：
            
            
- 选取 Li 中的一个 SSTable（大小约 s）。
            
- 找到 Li+1 中与该 SSTable key 范围重叠的所有
            SSTable。由于 Li+1 的容量是 Li 的 T 倍，且 key
            均匀分布时，重叠的 SSTable 数量约为 T 个。
            
- 将 Li 的 1 个 SSTable 与 Li+1 的约 T 个 SSTable
            合并，写出约 T+1 个新 SSTable 到 Li+1。
            
            

因此，每层 Compaction 的写放大约为 T（写出 T+1 个
            SSTable，但只有 1 个是新数据）。总写放大为：
            
```
WA_leveled ≈ T × (h - 1)
```

            

其中 h 是层数（不含 L0）。对于 T = 10、数据量 1 TB
            的场景：
            
```
h = ceil(log_T(总数据量 / L1大小)) + 1
  = ceil(log_10(1TB / 256MB)) + 1
  = ceil(log_10(4096)) + 1
  = ceil(3.61) + 1
  = 4 + 1
  = 5

WA ≈ 10 × 4 = 40
```

            

加上 WAL 写和 flush 写，总写放大约为
            42。这意味着用户每写入 1 GB 数据，磁盘上实际写入约 42
            GB。
            

### 2.3 读放大分析

            

#### 无布隆过滤器的情况

            

对于一次点查，最坏情况下需要检查每一层：
            
            
- L0：最多检查 N0 个 SSTable（N0 为 L0 的文件数）。每个
            SSTable 需要 1 次索引块读取 + 1 次数据块读取，共 2 × N0 次
            I/O。
            
- L1 到 Lh：每层最多 1 个 SSTable
            需要检查（因为层内无重叠），每个 2 次 I/O。共 2 × h 次
            I/O。
            
            
```
RA_no_bloom = 2 × N0 + 2 × h
```

            

当 N0 = 4、h = 5 时，RA = 2 × 4 + 2 × 5 = 18 次 I/O。
            

#### 有布隆过滤器的情况

            

布隆过滤器在内存中，不产生磁盘
            I/O。如果布隆过滤器的假阳性率（False Positive Rate）为
            p，则对于不包含目标 key 的 SSTable，布隆过滤器有 (1-p)
            的概率正确过滤掉该 SSTable。
            
            
- L0：每个 SSTable 先查布隆过滤器（内存操作），假阳性率 p
            决定了有多少 SSTable 需要实际读盘。期望读盘次数约为 2 × N0 ×
            p。
            
- L1 到
            Lh-1（不含最底层）：每层需要查布隆过滤器，假阳性时需要读盘。期望读盘次数约为
            2 × (h-1) × p。
            
- Lh（最底层）：如果 key
            存在于数据库中，大概率在最底层（90%
            的数据在最底层）。命中时需要 2 次 I/O（索引 + 数据）。
            
            
```
RA_bloom ≈ 2 × N0 × p + 2 × (h - 1) × p + 2
```

            

当 p = 1%（10 bits per key）、N0 = 4、h = 5 时：
            
```
RA_bloom ≈ 2 × 4 × 0.01 + 2 × 4 × 0.01 + 2
         = 0.08 + 0.08 + 2
         ≈ 2.16
```

            

布隆过滤器将读放大从 18 次降低到约 2 次，效果显著。
            

### 2.4 空间放大分析

            

Leveled Compaction
            的空间放大较低，原因在于每层内部没有重叠的 SSTable。同一个
            key 最多在每一层出现一次。
            

最坏情况下的空间放大来源是：
            
            
- 层间冗余：一个 key 在 Li 有新版本，在 Li+1
            有旧版本，两个版本同时存在。
            
- Compaction 临时空间：合并过程中新旧 SSTable 共存。
            
            

稳态下的空间放大约为：
            
```
SA_leveled ≈ 1 + 1/T
```

            

当 T = 10 时，SA ≈ 1.1。即磁盘上的数据量约为逻辑数据量的
            1.1 倍。这是 Leveled Compaction 的核心优势之一。
            

## 三、Tiered Compaction
            放大分析

            

Tiered Compaction（也称 Size-Tiered
            Compaction）是另一种常见策略。Cassandra 的默认策略
            STCS（Size-Tiered Compaction Strategy）和 RocksDB 的
            Universal Compaction 都属于这一类。
            

### 3.1 基本思路

            

Tiered Compaction
            的核心区别在于：每层允许多个”run”共存，key
            范围可以重叠。当某一层积累的 run 数量达到阈值 T 时，将这 T
            个 run 合并为一个更大的 run，推入下一层。
            
```
Leveled：每层只有 1 个 sorted run，层内 SSTable 无重叠。
Tiered：每层最多有 T 个 sorted run，层内 run 之间可以重叠。
```

            

这种设计的直觉是：减少合并频率，降低写放大。代价是读取时需要检查更多的
            run。
            

### 3.2 写放大分析

            

在 Tiered Compaction
            中，每个数据项在每一层只被合并一次（T 个 run 合并为 1
            个）。因此每层的写放大为 1（而不是 Leveled 中的 T）。
            
```
WA_tiered ≈ h
```

            

其中 h 是层数。对于 T = 10、数据量 1 TB 的场景，h ≈
            5，写放大仅为 5。相比 Leveled 的 40，降低了约 8 倍。
            

这使得 Tiered Compaction
            特别适合写密集型负载（Write-Heavy Workload）。
            

### 3.3 读放大分析

            

Tiered Compaction 的读放大显著高于
            Leveled。原因是每层有最多 T 个 run，点查需要检查所有
            run。
            

无布隆过滤器时：
            
```
RA_tiered_no_bloom ≈ 2 × T × h
```

            

当 T = 10、h = 5 时，RA = 100 次 I/O，远高于 Leveled 的
            18。
            

有布隆过滤器时，假设假阳性率 p：
            
```
RA_tiered_bloom ≈ 2 × T × h × p + 2
```

            

当 p = 1%、T = 10、h = 5 时，RA ≈ 2 × 50 × 0.01 + 2 =
            3.0。布隆过滤器在 Tiered Compaction 中的作用更加关键。
            

### 3.4 空间放大分析

            

Tiered Compaction 的空间放大显著高于 Leveled。每层最多有
            T 个 run，同一个 key 在同一层内可能存在多个版本。
            

最坏情况下，如果所有 run 都包含同一批 key
            的不同版本：
            
```
SA_tiered_worst ≈ T
```

            

当 T = 10 时，最坏空间放大为 10 倍。实际场景中，如果 key
            分布均匀且更新频率不集中在热点 key
            上，空间放大会低于最坏值，但通常仍在 2 到 4 倍之间。
            

### 3.5 Cassandra 的 STCS

            

Cassandra 的 STCS 是 Tiered Compaction
            的经典实现。其基本规则：
            
            
- 将大小相近的 SSTable 分为一组。
            
- 当一组中的 SSTable 数量达到
            `min_threshold`（默认
            4）时，将它们合并为一个更大的 SSTable。
            
- 合并后的 SSTable 进入更大尺寸的分组。
            
            
```
组    SSTable 大小范围         最大数量
───────────────────────────────────────
S0    ≤ flush_size             4
S1    flush_size ~ T×flush     4
S2    T×flush ~ T²×flush      4
S3    T²×flush ~ T³×flush     4
...
```

            

STCS 的主要问题包括：
            
            
- 空间放大不可控。大 SSTable
            合并时，需要额外空间同时容纳旧文件和新文件，峰值空间可能达到
            2 倍数据量。
            
- 读放大随数据量增长。SSTable
            数量多，布隆过滤器内存开销大。
            
- 墓碑处理延迟。被删除的 key 可能长时间存在于大 SSTable
            中，影响范围查询性能。
            
            

Cassandra 后来引入了 LCS（Leveled Compaction Strategy）和
            TWCS（Time Window Compaction
            Strategy）作为替代方案，分别针对读密集和时序数据场景。
            

### 3.6 RocksDB 的
            Universal Compaction

            

RocksDB 的 Universal Compaction 是一种改进的 Tiered
            策略。与经典 STCS 的区别在于：
            
            
- 所有 SSTable 按时间顺序排列，不按大小分组。
            
- 合并决策基于相邻 SSTable 的大小比值。
            
- 支持更灵活的合并触发条件，包括空间放大阈值限制。
            
            
```
// RocksDB Universal Compaction 的关键参数
options.compaction_style = kCompactionStyleUniversal;
options.compaction_options_universal.size_ratio = 1;           // 触发合并的大小比阈值
options.compaction_options_universal.min_merge_width = 2;      // 最少合并文件数
options.compaction_options_universal.max_merge_width = UINT_MAX;
options.compaction_options_universal.max_size_amplification_percent = 200; // 空间放大上限
```

            

`max_size_amplification_percent`
            参数允许在空间放大超过阈值时强制触发全量
            Compaction，从而在写放大和空间放大之间建立一个可控的边界。
            

## 四、FIFO Compaction

            

FIFO Compaction 是 RocksDB
            提供的一种极端策略，专门面向时序数据（Time-Series
            Data）场景。
            

### 4.1 基本原理

            

FIFO Compaction 的规则非常简单：
            
            
- SSTable 按创建时间排列。
            
- 不做任何合并操作。
            
- 当总数据量超过 `max_table_files_size`
            时，直接删除最早的 SSTable。
            
            
```
options.compaction_style = kCompactionStyleFIFO;
options.compaction_options_fifo.max_table_files_size = 1ULL * 1024 * 1024 * 1024; // 1 GB
options.compaction_options_fifo.allow_compaction = false;
```

            

### 4.2 放大分析

            

FIFO Compaction 的放大特性非常极端：
            
```
指标    值        原因
──────────────────────────────────────────────────
WA     ≈ 1      不做 Compaction，只有 flush 写
RA     很高      SSTable 数量多，且无层级结构
SA     ≈ 1      旧数据被直接删除
```

            

写放大最低，因为数据只被写入一次（WAL +
            flush）。但读放大可能非常高，因为所有 SSTable
            都是平级的，点查需要遍历全部文件。
            

### 4.3 适用场景

            

FIFO Compaction 适用于以下特征的负载：
            
            
- 数据有自然的过期时间（TTL），例如监控指标、日志、IoT
            传感器数据。
            
- 写入量极大，写放大必须最小化。
            
- 读取模式以范围扫描（Range
            Scan）为主，按时间范围过滤，较少做点查。
            
- 不需要更新和删除操作。
            
            
```
// 配合 TTL 使用
options.compaction_options_fifo.max_table_files_size = 100ULL * 1024 * 1024 * 1024; // 100 GB
options.ttl = 7 * 24 * 3600; // 7 天
```

            

### 4.4 限制

            

FIFO Compaction 的局限性明确：
            
            
- 不支持更新。旧版本数据无法被覆盖清理。
            
- 不支持删除。Tombstone 无意义，因为没有 Compaction
            来传播它。
            
- 不支持压缩。由于不做合并，无法在合并时重新压缩数据。
            
- 范围查询性能取决于 SSTable 数量。文件数过多时，Iterator
            Merge 的开销增大。
            
            

在实际部署中，FIFO Compaction 通常与列式编码（Columnar
            Encoding）和 TTL 配合使用。RocksDB 的 BlobDB 模式也常用 FIFO
            策略管理 Blob 文件。
            

## 五、Size Ratio
            与层数的关系

            

Size Ratio（记作 T）是 LSM-Tree
            最重要的调优参数之一。它决定了相邻层之间的容量倍数，直接影响层数和三种放大。
            

### 5.1 层数公式

            

给定 L1 的大小为 B1、总数据量为 N，层数 h
            的计算公式为：
            
```
h = ceil(log_T(N / B1))
```

            

例如：
            
```
场景 1：N = 100 GB, B1 = 256 MB, T = 10
h = ceil(log_10(100GB / 256MB)) = ceil(log_10(400)) = ceil(2.60) = 3

场景 2：N = 1 TB, B1 = 256 MB, T = 10
h = ceil(log_10(1TB / 256MB)) = ceil(log_10(4096)) = ceil(3.61) = 4

场景 3：N = 1 TB, B1 = 256 MB, T = 4
h = ceil(log_4(4096)) = ceil(6.0) = 6
```

            

### 5.2 T 对写放大的影响

            

对于 Leveled Compaction：
            
```
WA_leveled ≈ T × h = T × ceil(log_T(N / B1))
```

            

T 同时出现在乘数和层数中，但层数随 T
            增大而减小（对数关系），所以写放大随 T 增大而单调递增。
            
```
T     h（1TB 数据）   WA = T × h
──────────────────────────────────
2     12              24
4     6               24
8     4               32
10    4               40
16    3               48
32    3               96
```

            

小 T 值的写放大更低。但这不是全部。
            

### 5.3 T 对读放大的影响

            

层数增加意味着读路径更长，读放大更高。无布隆过滤器时：
            
```
RA_no_bloom ≈ 2 × h = 2 × ceil(log_T(N / B1))
```

            

T 越小，h 越大，读放大越高。
            
```
T     h（1TB 数据）   RA（无 Bloom）
──────────────────────────────────────
2     12              24
4     6               12
8     4               8
10    4               8
16    3               6
32    3               6
```

            

有布隆过滤器时，读放大对层数的敏感度降低（因为多数层被过滤器跳过），但层数增多仍会增加假阳性的累积概率。
            

### 5.4 T 对空间放大的影响

            

Leveled Compaction 的空间放大约为 1 + 1/T。T
            越大，空间放大越小：
            
```
T     SA
─────────────
2     1.50
4     1.25
10    1.10
32    1.03
```

            

### 5.5 选择 T 的指导原则

            

T 的选择本质上是在写放大和读放大之间做权衡：
            
            
- 写密集型负载：降低 T（例如 T = 2 或 T =
            4），减少写放大，接受更高的读放大。
            
- 读密集型负载：提高 T（例如 T = 10
            或更大），减少层数和读放大，接受更高的写放大。
            
- 空间敏感型负载：使用 Leveled Compaction 配合较大的
            T，获得最低的空间放大。
            
            

RocksDB 默认 T =
            10，适合中等偏读的负载。对于写吞吐要求极高的场景，可以将 T
            降到 4 甚至 2，同时配合布隆过滤器来弥补读放大的增长。
            
```
// RocksDB 调整 Size Ratio
options.max_bytes_for_level_base = 256 * 1024 * 1024; // L1 = 256 MB
options.max_bytes_for_level_multiplier = 4;            // T = 4
```

            

### 5.6 动态层级调整

            

RocksDB 提供了
            `level_compaction_dynamic_level_bytes`
            选项。启用后，各层的大小不再是固定比例，而是根据实际最底层的数据量动态调整。
            
```
options.level_compaction_dynamic_level_bytes = true;
```

            

动态调整的规则是：从最底层往上反推每一层的目标大小。假设最底层实际大小为
            S_last：
            
```
目标大小(L_last)     = S_last
目标大小(L_last-1)   = S_last / T
目标大小(L_last-2)   = S_last / T²
...
```

            

如果某一层的目标大小小于 L1
            的配置值，则该层不使用（跳过）。这样可以避免在数据量较小时产生过多的空层，同时在数据量增长时自动扩展层数。
            

动态层级调整的好处是：空间放大更稳定，不会因为层级配置与实际数据量不匹配而产生额外的
            Compaction 开销。
            

## 六、Bloom Filter 调优

            

布隆过滤器（Bloom Filter）是降低 LSM-Tree
            读放大的关键工具。它以少量的内存开销，换取跳过大量不包含目标
            key 的 SSTable 的能力。
            

### 6.1 布隆过滤器基础

            

布隆过滤器是一个概率数据结构，用于回答”某个元素是否在集合中”。它有两个核心特性：
            
            
- 假阴性率（False Negative Rate）为
            0：如果布隆过滤器说”不存在”，那一定不存在。
            
- 假阳性率（False Positive Rate）为 p >
            0：如果布隆过滤器说”可能存在”，有 p 的概率是误判。
            
            

布隆过滤器的内存开销由 bits-per-key 参数（记作
            b）决定。每个 key 占用 b 个 bit，总内存开销 = key 数量 × b /
            8 字节。
            

假阳性率与 bits-per-key 的关系为：
            
```
p ≈ (1 - e^(-k/b))^k
```

            

其中 k 是哈希函数的数量。当 k 取最优值 k = b × ln(2)
            时：
            
```
p ≈ (0.6185)^b ≈ 2^(-b × ln2) ≈ 0.6185^b
```

            

常用 bits-per-key 对应的假阳性率：
            
```
bits-per-key (b)    假阳性率 (p)    内存开销（每百万 key）
─────────────────────────────────────────────────────────
5                   ~9.2%           0.6 MB
8                   ~2.2%           1.0 MB
10                  ~1.0%           1.25 MB
12                  ~0.3%           1.5 MB
15                  ~0.06%          1.875 MB
20                  ~0.005%         2.5 MB
```

            

### 6.2 对读路径的影响

            

布隆过滤器主要影响点查（Point
            Lookup）的读放大。考虑一个有 h 层的 Leveled
            LSM-Tree，假设目标 key
            不存在于数据库中（这是最坏情况）：
            
            
- 无布隆过滤器：需要检查所有层，每层 2 次 I/O，共 2h
            次。
            
- 有布隆过滤器（假阳性率
            p）：每层的布隆过滤器在内存中检查，只有假阳性时才需要读盘。期望
            I/O 次数为 2h × p。
            
            

对于存在的 key，布隆过滤器同样有效：只有包含该 key
            的那一层需要实际读盘（2 次 I/O），其他层被过滤器跳过。
            
```
场景：h = 5, b = 10 (p ≈ 1%)
不存在的 key：期望 I/O = 2 × 5 × 0.01 = 0.1 次
存在的 key：期望 I/O = 2 + 2 × 4 × 0.01 = 2.08 次
```

            

### 6.3 bits-per-key 的选择

            

增加 bits-per-key
            会降低假阳性率，但增加内存消耗。这是一个边际收益递减的过程。
            

从 10 增加到 15，假阳性率从 1% 降到 0.06%，改善显著。从
            15 增加到 20，假阳性率从 0.06% 降到
            0.005%，改善幅度小得多，但内存增加了 33%。
            

RocksDB 的默认推荐值是 10 bits per
            key。这个值在内存开销和过滤效果之间取得了较好的平衡。
            
```
// RocksDB 设置布隆过滤器
options.table_factory.reset(NewBlockBasedTableFactory(
    BlockBasedTableOptions{
        .filter_policy = NewBloomFilterPolicy(10), // 10 bits per key
        .whole_key_filtering = true,
    }
));
```

            

对于读密集型负载，可以考虑增加到 12 或 15 bits per
            key。但要注意内存预算：如果数据库有 10 亿个 key，10 bits per
            key 需要约 1.25 GB 内存，15 bits per key 需要约 1.875
            GB。
            

### 6.4 Partitioned Bloom
            Filter

            

当数据量很大时，布隆过滤器本身也变得很大。RocksDB
            支持分区布隆过滤器（Partitioned Bloom Filter），将一个
            SSTable 的布隆过滤器按 key 范围分割成多个小块。
            
```
BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.partition_filters = true;
table_options.index_type = BlockBasedTableOptions::kTwoLevelIndexSearch;
table_options.metadata_block_size = 4096;
```

            

分区布隆过滤器的好处：
            
            
- 降低内存占用。只有被访问的分区会被加载到 Block
            Cache，而不是整个过滤器。
            
- 改善缓存效率。热点 key
            范围对应的过滤器分区更容易留在缓存中。
            
- 减少 I/O 粒度。对于大
            SSTable，避免一次性读取整个过滤器。
            
            

代价是每次过滤器查询需要先定位到正确的分区（可能需要一次额外的索引查找），增加少量的查找延迟。
            

### 6.5 Ribbon Filter

            

RocksDB 7.0 引入了 Ribbon Filter
            作为布隆过滤器的替代方案。Ribbon Filter
            在相同假阳性率下使用更少的空间（约节省
            30%），但构建速度更慢。
            
```
table_options.filter_policy.reset(NewRibbonFilterPolicy(10));
```

            

Ribbon Filter 适合以下场景：
            
            
- 内存紧张，需要在有限空间内获得更低的假阳性率。
            
- 数据以读取为主，构建速度不是瓶颈。
            
- SSTable 较大且长期存在，构建成本可以被摊销。
            
            

## 七、Monkey 与
            Dostoevsky 理论

            

前面的分析假设所有层级的布隆过滤器使用相同的
            bits-per-key。但这并不是最优策略。Monkey
            论文提出了一种更优的布隆过滤器分配方案。
            

### 7.1 问题的核心

            

直觉上，最底层的数据量最大（约占
            90%），因此最底层的布隆过滤器假阳性对读性能的影响最大。但反过来想，分配给最底层的
            bits-per-key 越多，总内存开销也越大。
            

问题可以形式化为：给定固定的总内存预算
            M，如何在各层之间分配布隆过滤器的
            bits-per-key，使得总的假阳性率（等价于总的期望 I/O
            次数）最小？
            

### 7.2 Monkey 的最优分配

            

Monkey（Optimal Bloom Filters
            Revisited）论文的核心结论是：在总内存预算固定的条件下，各层的最优假阳性率应当满足如下关系：
            
```
p_i × n_i = 常数
```

            

其中 p_i 是第 i 层的假阳性率，n_i 是第 i 层的 key
            数量。
            

这意味着：数据量越大的层，分配的假阳性率应该越低（即
            bits-per-key 越高）；数据量小的层，假阳性率可以更高（即
            bits-per-key 更低）。
            

具体来说，对于 T = 10 的 Leveled Compaction：
            
```
层级    数据量占比    均匀分配 p     Monkey 最优 p
─────────────────────────────────────────────────
L1     0.01%        1.0%          高（~10%）
L2     0.1%         1.0%          较高（~5%）
L3     1%           1.0%          中等（~1%）
L4     9%           1.0%          低（~0.1%）
L5     90%          1.0%          极低（~0.01%）
```

            

在 Monkey 分配下，总期望 I/O 次数可以从均匀分配时的 O(h ×
            p) 降低到 O(p × e^(-b_total/N))，其中 b_total
            是总内存预算，N 是总 key 数。
            

### 7.3 Monkey 的工程意义

            

Monkey 最优分配的工程含义是：不需要给每层单独设置
            bits-per-key。可以采用一种近似策略：
            
            
- 最底层使用较高的 bits-per-key（例如 15 或 20）。
            
- 其余层使用较低的 bits-per-key（例如 5 或 8）。
            
- 甚至最上面几层可以不设布隆过滤器（因为数据量小，即使假阳性也只增加很少的
            I/O）。
            
            

RocksDB 目前不支持每层独立设置布隆过滤器参数，但可以通过
            Column Family 或自定义 TablePropertiesCollector
            间接实现类似效果。
            

### 7.4 Dostoevsky 与 Lazy
            Leveling

            

Dostoevsky 论文在 Monkey 的基础上进一步推广，提出了 Lazy
            Leveling 策略。
            

Lazy Leveling 是 Leveled Compaction 和 Tiered Compaction
            的混合：
            
            
- 最底层使用 Leveled
            策略（层内无重叠），确保低空间放大和低读放大。
            
- 其余层使用 Tiered 策略（层内允许多个
            run），降低写放大。
            
            
```
策略            WA          RA（点查）      SA
──────────────────────────────────────────────────────
Leveled        T × h        O(1) + bloom    1 + 1/T
Tiered         h            O(T × h)        O(T)
Lazy Leveling  T + h - 1    O(1) + bloom    1 + 1/T + (T-1)/T
```

            

Lazy Leveling 的写放大约为 T + h - 1，远低于 Leveled 的 T
            × h，同时空间放大接近 Leveled 水平。
            

Dostoevsky 论文进一步提出了 Fluid
            LSM-Tree，允许每一层独立选择 Leveled 或 Tiered
            策略，从而在三种放大之间实现更精细的权衡。
            

### 7.5 理论与实践的差距

            

Monkey 和 Dostoevsky 的理论模型基于以下假设：
            
            
- 数据均匀分布。实际负载中，key 的访问频率通常服从 Zipf
            分布。
            
- I/O 成本一致。SSD 的随机读和顺序读成本差异远小于
            HDD，但仍然存在。
            
- 忽略 CPU 开销。布隆过滤器的查询和哈希计算有 CPU
            成本。
            
- 忽略压缩效果。压缩率影响实际的 I/O 量。
            
            

尽管如此，这些理论提供了有价值的设计指导。核心结论——“不同层分配不同的过滤器精度”——在工程上是可操作的，即使不追求理论最优解。
            

## 八、Compaction
            优先级与限流

            

Compaction 是后台任务，但它与前台读写共享磁盘带宽和
            CPU。如果 Compaction 不加控制，可能占满 I/O
            带宽，导致前台写入被阻塞（Write Stall）。反过来，如果
            Compaction 过慢，待 Compact
            的数据积压，读放大和空间放大恶化。
            

### 8.1 Write Stall
            的触发条件

            

RocksDB 在以下情况下会触发写入限速（Write
            Stall）或写入停止（Write Stop）：
            
```
触发条件                                              动作
────────────────────────────────────────────────────────────────────────
L0 文件数 ≥ level0_slowdown_writes_trigger (20)       写入限速
L0 文件数 ≥ level0_stop_writes_trigger (36)           写入停止
待 Compact 数据量超过 soft_pending_compaction_bytes    写入限速
待 Compact 数据量超过 hard_pending_compaction_bytes    写入停止
MemTable 数量 ≥ max_write_buffer_number               写入停止
```

            

写入停止意味着所有写操作阻塞，直到 Compaction
            释放空间。这对延迟敏感的在线服务是不可接受的。
            

### 8.2 Compaction
            限流器（Rate Limiter）

            

RocksDB 提供了 Rate Limiter 来控制 Compaction 和 Flush 的
            I/O 速率：
            
```
options.rate_limiter.reset(NewGenericRateLimiter(
    100 * 1024 * 1024,  // rate_bytes_per_sec: 100 MB/s
    100 * 1000,         // refill_period_us: 100ms
    10,                 // fairness: 高优先级请求的公平系数
    RateLimiter::Mode::kWritesOnly
));
```

            

Rate Limiter
            的作用是为前台写入预留足够的磁盘带宽。设磁盘总写带宽为
            W_disk：
            
```
前台可用带宽 = W_disk - rate_bytes_per_sec
```

            

设置 Rate Limiter 时需要注意：
            
            
- 限速太低：Compaction 跟不上写入速度，L0
            文件积压，最终触发 Write Stall。
            
- 限速太高：Compaction 占满带宽，前台写入延迟升高。
            
- 合理值：通常设置为磁盘写带宽的 60% 到 80%。
            
            

### 8.3 Compaction 优先级

            

RocksDB 支持为不同类型的 Compaction 设置优先级：
            
```
// 优先级从高到低
enum class CompactionPri : char {
    kByCompensatedSize = 0x0,   // 优先 Compact 包含大量删除标记的文件
    kOldestLargestSeqFirst = 0x1, // 优先 Compact 序列号最老的大文件
    kOldestSmallestSeqFirst = 0x2, // 优先 Compact 序列号最老的小文件
    kMinOverlappingRatio = 0x3,   // 优先 Compact 与下层重叠比最小的文件
    kRoundRobin = 0x4,            // 轮询选择
};

options.compaction_pri = kMinOverlappingRatio;
```

            

`kMinOverlappingRatio` 是 RocksDB
            推荐的默认值。它的逻辑是：选择与下一层重叠最少的 SSTable
            进行 Compaction，这样可以最小化每次 Compaction
            的写放大（因为需要读取和重写的下层数据最少）。
            

### 8.4 并发 Compaction

            

RocksDB 支持多线程并发 Compaction：
            
```
options.max_background_compactions = 4;  // 已废弃，使用 max_background_jobs
options.max_background_jobs = 8;         // 后台线程总数（Compaction + Flush）
```

            

并发 Compaction 可以提高 Compaction
            吞吐量，但需要注意：
            
            
- CPU 开销。每个 Compaction 线程占用一个 CPU 核心。
            
- I/O 竞争。多个 Compaction 任务同时读写磁盘，可能产生 I/O
            竞争。
            
- 临时空间。多个 Compaction
            任务并行时，临时空间的峰值更高。
            
            

### 8.5 Sub-Compaction

            

对于大文件的 Compaction，RocksDB 支持将一个 Compaction
            任务拆分为多个 Sub-Compaction，在多个线程中并行执行：
            
```
options.max_subcompactions = 4;
```

            

Sub-Compaction 的工作方式是：将输入文件的 key
            范围划分为多个子范围，每个子范围由一个线程独立处理。各线程生成独立的输出
            SSTable，避免锁竞争。
            

这对大 SSTable（数百 MB 到数 GB）的 Compaction
            特别有效，可以显著缩短单次 Compaction 的延迟。
            

### 8.6 防止 Write Stall
            的调优策略

            

综合以上参数，防止 Write Stall 的调优思路如下：
            
            
- 增大 `level0_slowdown_writes_trigger` 和
            `level0_stop_writes_trigger`，给 Compaction
            更多时间。但不宜过大，否则 L0 文件过多会恶化读性能。
            
- 增大 `max_background_jobs`，提高 Compaction
            并行度。
            
- 合理设置 Rate Limiter，在 Compaction
            带宽和前台写带宽之间取平衡。
            
- 使用 `kMinOverlappingRatio` 优先级，减少每次
            Compaction 的写放大。
            
- 启用 Sub-Compaction，加速大文件的合并。
            
            
```
// 一组面向写密集负载的 Write Stall 防护配置
options.level0_file_num_compaction_trigger = 4;
options.level0_slowdown_writes_trigger = 20;
options.level0_stop_writes_trigger = 36;
options.max_background_jobs = 8;
options.max_subcompactions = 4;
options.compaction_pri = kMinOverlappingRatio;
options.rate_limiter.reset(NewGenericRateLimiter(200 * 1024 * 1024));
```

            

## 九、负载感知调优

            

不同的负载特征需要不同的调优方向。本节根据三种典型负载，给出调优策略。
            

### 9.1
            读密集型负载（Read-Heavy）

            

读密集型负载的特征是：写入较少，读取频繁，对读延迟敏感。典型场景包括在线查询服务、缓存层、用户画像存储。
            

调优目标：最小化读放大。
            
```
策略要点：
1. 使用 Leveled Compaction，确保每层无重叠。
2. 增大布隆过滤器的 bits-per-key（12 到 15）。
3. 保持较大的 T（10 或更大），减少层数。
4. 增大 Block Cache，缓存热点数据块。
5. 启用 Partitioned Index 和 Partitioned Bloom Filter，提高缓存效率。
```

            
```
// 读密集型配置示例
options.compaction_style = kCompactionStyleLevel;
options.max_bytes_for_level_multiplier = 10;

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(15));
table_options.block_cache = NewLRUCache(4ULL * 1024 * 1024 * 1024); // 4 GB
table_options.partition_filters = true;
table_options.index_type = BlockBasedTableOptions::kTwoLevelIndexSearch;
table_options.cache_index_and_filter_blocks = true;
table_options.pin_l0_filter_and_index_blocks_in_cache = true;

options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

关键参数解释：
            
            
- `cache_index_and_filter_blocks = true`：将索引块和布隆过滤器放入
            Block
            Cache，而不是单独的内存区域。这样可以统一管理内存，避免内存超额分配。
            
- `pin_l0_filter_and_index_blocks_in_cache = true`：L0
            的过滤器和索引块常驻缓存，不被淘汰。L0
            是最频繁被访问的层，钉住它们可以避免反复加载。
            
            

### 9.2
            写密集型负载（Write-Heavy）

            

写密集型负载的特征是：写入量极大，读取较少或可以容忍较高延迟。典型场景包括日志收集、消息队列落盘、批量数据导入。
            

调优目标：最小化写放大。
            
```
策略要点：
1. 使用 Universal Compaction（Tiered），降低写放大。
2. 降低 T（例如 4），减少每次合并的规模。
3. 增大 MemTable 和 Write Buffer，减少 flush 频率。
4. 使用较低的 bits-per-key（8 或 10），节省内存用于 Write Buffer。
5. 增大 L0 文件数量阈值，延迟 Compaction 触发。
```

            
```
// 写密集型配置示例
options.compaction_style = kCompactionStyleUniversal;
options.compaction_options_universal.size_ratio = 1;
options.compaction_options_universal.max_size_amplification_percent = 200;
options.write_buffer_size = 256 * 1024 * 1024;        // 256 MB MemTable
options.max_write_buffer_number = 6;
options.min_write_buffer_number_to_merge = 2;
options.level0_file_num_compaction_trigger = 8;
options.level0_slowdown_writes_trigger = 24;
options.level0_stop_writes_trigger = 40;
options.max_background_jobs = 8;
options.max_subcompactions = 4;

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.block_cache = NewLRUCache(512 * 1024 * 1024); // 512 MB
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

关键参数解释：
            
            
- `write_buffer_size = 256 MB`：增大 MemTable
            减少 flush 频率，每次 flush 写出更大的 SSTable。
            
- `min_write_buffer_number_to_merge = 2`：flush
            前将 2 个 Immutable MemTable 合并为 1 个 SSTable，减少 L0
            文件数量。
            
- `max_size_amplification_percent = 200`：空间放大超过
            200% 时强制全量 Compaction，避免空间无限膨胀。
            
            

### 9.3 混合负载（Mixed
            Workload）

            

混合负载的特征是：读写并重，对延迟和吞吐都有要求。典型场景包括
            OLTP 数据库的存储层、键值缓存。
            

调优目标：在三种放大之间取平衡。
            
```
策略要点：
1. 使用 Leveled Compaction，这是最通用的选择。
2. T = 10（默认值），不做极端调整。
3. bits-per-key = 10（默认值）。
4. 合理的 Block Cache 和 Write Buffer。
5. 关注 Compaction 统计信息，根据实际瓶颈微调。
```

            
```
// 混合负载配置示例
options.compaction_style = kCompactionStyleLevel;
options.max_bytes_for_level_multiplier = 10;
options.max_bytes_for_level_base = 256 * 1024 * 1024;
options.write_buffer_size = 64 * 1024 * 1024;          // 64 MB
options.max_write_buffer_number = 4;
options.level0_file_num_compaction_trigger = 4;
options.level0_slowdown_writes_trigger = 20;
options.level0_stop_writes_trigger = 36;
options.max_background_jobs = 4;
options.level_compaction_dynamic_level_bytes = true;

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.block_cache = NewLRUCache(2ULL * 1024 * 1024 * 1024); // 2 GB
table_options.cache_index_and_filter_blocks = true;
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

### 9.4
            时序数据负载（Time-Series）

            

时序数据的特征是：写入量大，按时间顺序写入，读取以时间范围扫描为主，旧数据有
            TTL。
            

调优目标：最小化写放大，利用 TTL 自动清理旧数据。
            
```
策略要点：
1. 使用 FIFO Compaction 或 Universal Compaction + TTL。
2. key 设计以时间戳为前缀，保证自然有序。
3. 利用前缀布隆过滤器（Prefix Bloom Filter）优化范围查询。
4. 设置合理的 TTL，自动清理过期数据。
```

            
```
// 时序数据配置示例
options.compaction_style = kCompactionStyleFIFO;
options.compaction_options_fifo.max_table_files_size = 50ULL * 1024 * 1024 * 1024;
options.ttl = 30 * 24 * 3600; // 30 天

// 如果需要点查能力，可使用前缀布隆过滤器
options.prefix_extractor.reset(NewFixedPrefixTransform(8)); // 前 8 字节作为前缀
BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.whole_key_filtering = false; // 使用前缀过滤
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

### 9.5 负载判断方法

            

如何判断当前负载属于哪种类型？RocksDB
            的统计信息提供了关键指标：
            
```
# 查看 RocksDB 统计信息
./ldb --db=/path/to/db stats
```

            

关注以下指标的比值：
            
```
指标                          读密集    写密集    混合
───────────────────────────────────────────────────────
rocksdb.number.keys.read      高        低       中
rocksdb.number.keys.written   低        高       中
rocksdb.bytes.read            高        低       中
rocksdb.bytes.written         低        高       中
rocksdb.bloom.filter.useful   高        低       中（重要）
```

            

如果 `bloom.filter.useful` 很高（接近
            `bloom.filter.full.positive` +
            `bloom.filter.useful`），说明布隆过滤器在大量过滤无效读取，表明存在大量对不存在
            key 的查询，增加 bits-per-key 可能有效果。
            

## 十、调优实战

            

### 10.1 读懂 Compaction
            Stats

            

RocksDB 通过 `LOG` 文件定期输出 Compaction
            统计信息。以下是一段典型输出及其解读：
            
```
** Compaction Stats [default] **
Level    Files   Size     Score Read(GB)  Rn(GB) Rnp1(GB) Write(GB) Wnew(GB) Moved(GB) W-Amp Rd(MB/s) Wr(MB/s) Comp(sec) Comp(cnt) Avg(sec)
------------------------------------------------------------------------------------------------------------
  L0      3/0   192.00 MB  0.8      0.0     0.0      0.0       0.6      0.6       0.0   1.0      0.0     80.5      7.93         4    1.98
  L1      4/0   243.12 MB  0.9      1.2     0.6      0.6       1.1      0.5       0.0   1.8     72.3     66.8     16.55         3    5.52
  L2     38/0    2.41 GB   0.9     10.8     1.1      9.7      10.6      0.9       0.0   9.8     84.2     82.7    131.22        15    8.75
  L3    382/0   24.02 GB   0.9     48.2    10.6     37.6      46.5      8.9       0.5   4.4     78.5     75.8    628.50        42   14.96
 Sum    427/0   26.84 GB   0.0     60.2    12.3     47.9      58.8     10.9       0.5  10.5     78.8     77.0    784.20        64   12.25
```

            

各列的含义：
            
```
列名        含义
─────────────────────────────────────────────────────────
Files       当前文件数 / 正在 Compaction 的文件数
Size        当前层的总大小
Score       当前大小 / 目标大小。Score > 1 表示该层需要 Compaction
Read(GB)    Compaction 读取的总数据量
Rn(GB)      从当前层读取的数据量
Rnp1(GB)    从下一层读取的数据量
Write(GB)   Compaction 写出的总数据量
Wnew(GB)    净增加到下一层的数据量 = Write - Rnp1
Moved(GB)   直接移动到下一层的数据量（Trivial Move，无需重写）
W-Amp       该层的写放大 = Write / Rn
Rd(MB/s)    Compaction 读速率
Wr(MB/s)    Compaction 写速率
Comp(sec)   总 Compaction 时间
Comp(cnt)   Compaction 次数
Avg(sec)    平均每次 Compaction 耗时
```

            

从这段输出可以分析：
            
            
- L2 的 W-Amp = 9.8，接近 T = 10，符合预期。
            
- L3 的 W-Amp = 4.4，低于 T，说明 L3 的 Compaction
            输入与下层重叠较少。
            
- 总写放大（Sum 行 W-Amp）= 10.5，表示用户每写 1
            字节，磁盘写约 10.5 字节。
            
- 所有层的 Score < 1，说明 Compaction
            跟上了写入速度。
            
            

### 10.2 识别瓶颈

            

根据 Compaction Stats 识别当前瓶颈：
            
```
现象                              可能的瓶颈         调优方向
───────────────────────────────────────────────────────────────────────────
L0 Score >> 1                    Compaction 慢       增加后台线程数
L0 文件数频繁触发 slowdown       L0 积压             增大 trigger 阈值
某层 W-Amp >> T                  key 分布不均        检查 key 设计
Write Stall 频繁                 Compaction 带宽不足 增大 Rate Limiter
Compaction 读写速率低            磁盘瓶颈            升级存储硬件
Bloom Filter Useful 比例低       过滤器效果差        增加 bits-per-key
读延迟 P99 高                    读放大高            增加缓存、过滤器
空间占用远超逻辑数据量           空间放大高          检查 Compaction 策略
```

            

### 10.3 调优检查清单

            

按顺序检查以下项目：
            

**第一步：确认基本配置合理**
            
```
检查项                          推荐值
─────────────────────────────────────────────────────────
Compaction 策略                 Leveled（通用）/ Universal（写密集）
max_bytes_for_level_multiplier  10（默认）
max_bytes_for_level_base        256 MB（默认）
write_buffer_size               64 MB ~ 256 MB
max_write_buffer_number         2 ~ 6
布隆过滤器                      10 bits per key
Block Cache                    可用内存的 30% ~ 50%
```

            

**第二步：检查 Write Stall**
            
```
# 在 RocksDB LOG 中搜索 Write Stall 事件
grep -i "stall" /path/to/db/LOG
```

            
```
如果出现 "Stalling writes"：
1. 检查 L0 文件数是否频繁超过 trigger 值。
2. 检查 pending compaction bytes 是否接近上限。
3. 增大后台线程数或调高 trigger 阈值。
```

            

**第三步：检查读性能**
            
```
如果 P99 读延迟高：
1. 检查 Block Cache 命中率。命中率低于 90% 时考虑增大缓存。
2. 检查 Bloom Filter 过滤率。过滤率低于 95% 时考虑增加 bits-per-key。
3. 检查 L0 文件数。L0 文件多会增加读路径长度。
4. 检查是否存在大量对不存在 key 的查询（Negative Lookup）。
```

            

**第四步：检查空间放大**
            
```
# 查看 SSTable 文件分布
./ldb --db=/path/to/db manifest_dump | head -50
```

            
```
如果空间放大 > 2：
1. 检查是否有大量 Tombstone 未被清理。
2. 检查 Compaction 是否跟上写入速度。
3. 考虑手动触发 CompactRange。
4. 如果使用 Universal Compaction，检查 max_size_amplification_percent。
```

            

**第五步：检查写放大**
            
```
如果写放大 > 30（Leveled）或 > 10（Universal）：
1. 检查 max_bytes_for_level_multiplier 是否过大。
2. 检查是否有热点 key 导致频繁更新。
3. 检查 Compaction Priority 设置。
4. 考虑启用 level_compaction_dynamic_level_bytes。
```

            

### 10.4 常见配置模板

            

以下是三种常见场景的完整配置模板。
            

#### 在线查询服务（读密集、延迟敏感）

            
```
Options options;
options.create_if_missing = true;
options.compaction_style = kCompactionStyleLevel;
options.max_bytes_for_level_base = 256 * 1024 * 1024;
options.max_bytes_for_level_multiplier = 10;
options.write_buffer_size = 64 * 1024 * 1024;
options.max_write_buffer_number = 3;
options.level0_file_num_compaction_trigger = 4;
options.level0_slowdown_writes_trigger = 20;
options.level0_stop_writes_trigger = 36;
options.max_background_jobs = 4;
options.level_compaction_dynamic_level_bytes = true;
options.compaction_pri = kMinOverlappingRatio;

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(15));
table_options.block_cache = NewLRUCache(8ULL * 1024 * 1024 * 1024);
table_options.cache_index_and_filter_blocks = true;
table_options.pin_l0_filter_and_index_blocks_in_cache = true;
table_options.partition_filters = true;
table_options.index_type = BlockBasedTableOptions::kTwoLevelIndexSearch;
table_options.block_size = 4096;
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

#### 日志/消息写入（写密集、吞吐优先）

            
```
Options options;
options.create_if_missing = true;
options.compaction_style = kCompactionStyleUniversal;
options.compaction_options_universal.size_ratio = 1;
options.compaction_options_universal.max_size_amplification_percent = 200;
options.compaction_options_universal.min_merge_width = 2;
options.write_buffer_size = 256 * 1024 * 1024;
options.max_write_buffer_number = 6;
options.min_write_buffer_number_to_merge = 2;
options.level0_file_num_compaction_trigger = 8;
options.level0_slowdown_writes_trigger = 24;
options.level0_stop_writes_trigger = 40;
options.max_background_jobs = 8;
options.max_subcompactions = 4;
options.rate_limiter.reset(NewGenericRateLimiter(300 * 1024 * 1024));

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.block_cache = NewLRUCache(512 * 1024 * 1024);
table_options.block_size = 16384;
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

#### 监控时序数据（时序、TTL）

            
```
Options options;
options.create_if_missing = true;
options.compaction_style = kCompactionStyleFIFO;
options.compaction_options_fifo.max_table_files_size = 100ULL * 1024 * 1024 * 1024;
options.ttl = 7 * 24 * 3600;
options.write_buffer_size = 128 * 1024 * 1024;
options.max_write_buffer_number = 4;
options.max_background_jobs = 4;
options.prefix_extractor.reset(NewFixedPrefixTransform(8));

BlockBasedTableOptions table_options;
table_options.filter_policy.reset(NewBloomFilterPolicy(10));
table_options.whole_key_filtering = false;
table_options.block_cache = NewLRUCache(1ULL * 1024 * 1024 * 1024);
options.table_factory.reset(NewBlockBasedTableFactory(table_options));
```

            

### 10.5 调优的一般原则

            

LSM-Tree
            调优没有通用的最优配置。以下原则可以帮助缩小搜索空间：
            
            
- 从默认配置开始。RocksDB
            的默认参数适合大多数中等负载。不要一开始就做大量修改。
            
- 用数据驱动调优。先运行负载，收集 Compaction Stats、Block
            Cache 命中率、Bloom Filter 过滤率、Write Stall
            频率等指标，再根据瓶颈调整。
            
- 每次只改一个参数。多个参数同时修改无法判断哪个变更生效。
            
- 关注 P99 延迟而非平均延迟。LSM-Tree 的尾延迟（Tail
            Latency）通常来自 Compaction 导致的 I/O
            竞争，平均延迟可能掩盖这一问题。
            
- 写放大和空间放大可以通过 Compaction Stats
            直接观测。读放大需要结合 Block Cache 命中率和 I/O
            监控工具（如
            `iostat`、`perf`）来评估。
            
            
```
# 监控磁盘 I/O
iostat -x 1

# 关注指标
# r/s: 每秒读次数
# w/s: 每秒写次数
# r_await: 平均读延迟（ms）
# w_await: 平均写延迟（ms）
# %util: 磁盘利用率
```

            

## 继续阅读

            
            
- RocksDB
            工程实践：把本文放大权衡落到 RocksDB 参数与运维。
            
- B-Tree
            vs LSM：选型时先看两种结构的读写代价。
            
- 存储工程系列目录：从硬件到引擎的完整阅读路径。
            
            

## 参考资料

            

### 论文

            
            
- 

P. O’Neil, E. Cheng, D. Gawlick, E. O’Neil, “The
            Log-Structured Merge-Tree (LSM-Tree),” *Acta
            Informatica*, vol. 33, no. 4, pp. 351–385, 1996.
            LSM-Tree 的原始论文。
            
- 

N. Dayan, M. Athanassoulis, S. Idreos, “Monkey:
            Optimal Navigable Key-Value Store,” *SIGMOD*, 2017.
            布隆过滤器在 LSM-Tree 各层的最优分配策略。
            
- 

N. Dayan, S. Idreos, “Dostoevsky: Better Space-Time
            Trade-Offs for LSM-Tree Based Key-Value Stores via Adaptive
            Removal of Superfluous Merging,” *SIGMOD*, 2018. Lazy
            Leveling 和 Fluid LSM-Tree 的理论分析。
            
- 

L. Lu, T. S. Pillai, A. C. Arpaci-Dusseau, R. H.
            Arpaci-Dusseau, “WiscKey: Separating Keys from Values in
            SSD-Conscious Storage,” *FAST*, 2016.
            键值分离以降低写放大的设计。
            
            

### 源码与文档

            
            
- 

RocksDB Wiki, “Leveled Compaction,” https://github.com/facebook/rocksdb/wiki/Leveled-Compaction.
            RocksDB Leveled Compaction 的官方文档。
            
- 

RocksDB Wiki, “Universal Compaction,” https://github.com/facebook/rocksdb/wiki/Universal-Compaction.
            RocksDB Universal Compaction 的参数说明和触发逻辑。
            
- 

RocksDB Wiki, “RocksDB Tuning Guide,” https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide.
            官方调优指南，覆盖内存、Compaction、布隆过滤器等参数。
            
- 

RocksDB
            源码，`db/compaction/compaction_picker_level.cc`，Leveled
            Compaction 的文件选择逻辑。版本参考：RocksDB 9.x。
            
- 

RocksDB
            源码，`table/block_based/filter_policy.cc`，布隆过滤器和
            Ribbon Filter 的实现。版本参考：RocksDB 9.x。
            
            

### 书籍

            
            
- A. Petrov, *Database Internals: A Deep Dive into How
            Distributed Data Systems Work*, O’Reilly, 2019. 第 7
            章系统讲解了 LSM-Tree 的 Compaction 策略和放大分析。
            
            
            

**上一篇**: Bitcask
            与日志结构哈希表 **下一篇**: RocksDB
            工程实践
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-10 · storage
                    

### 【存储工程】RocksDB 工程实践

                    

从 Column Family、Write Buffer、Block Cache、Compaction、Rate Limiter 到 Direct I/O 和监控，系统拆解 RocksDB 在生产环境中的关键配置与故障模式，并给出 SSD 场景下的配置模板和 db_bench 基准测试方法。
                

                
                    

2026-04-19 · algorithms
                    

### B+tree 与 LSM-tree：两种存储引擎哲学的碰撞

                    

数据库存储引擎的核心之争——原地更新还是追加写入？B+tree 与 LSM-tree 代表了两种截然不同的设计哲学，理解它们的取舍，就是理解现代存储系统设计的根基。
                

                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。
                

                
                    

2026-04-05 · database
                    

### 【从零写一个 LSM-Tree 存储引擎】Compaction：LSM-Tree 的心脏手术

                    

从零实现 LSM-Tree Compaction：最小堆多路归并迭代器、Level 分层与 Compaction 打分、Tombstone 下推、Version/VersionEdit/MANIFEST 版本管理，以及 Leveled/Size-Tiered/Universal 三种策略的量化对比。从零写一个 LSM-Tree 存储引擎系列第 4 篇。