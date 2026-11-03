# 【存储工程】读取性能优化

来源: https://quant67.com/post/storage/68-read-optimization/read-optimization.html
日期: 2025-10-16 |

---

存储系统的写入路径可以靠批量化、顺序化、延迟持久化来提速，但读取路径没有这些缓冲空间——用户发起一次点查（Point
            Lookup），系统必须在有限时间内定位到数据所在的物理位置，读取对应的字节，解压、反序列化、返回结果。整条链路上的每一个环节都可能成为瓶颈。
            

读取性能优化的核心矛盾是：存储引擎的内部组织方式（排序、分层、压缩）是为写入吞吐量和空间效率服务的，但这些设计对读取路径引入了额外开销。一个
            LSM-Tree 引擎为了保证写入性能，把数据分散在多层 SSTable
            中，一次点查可能需要检查 L0 到 L6
            共七层文件；一个列式存储引擎为了压缩率，把不同列分开存放，一次全列扫描可能需要读取数十个不相邻的数据块。这些额外的
            I/O 操作就是读放大（Read Amplification）。
            

本文从读放大的定义出发，系统拆解索引设计、布隆过滤器（Bloom
            Filter）调优、块缓存（Block Cache）、压缩的 CPU-I/O
            权衡、预读策略、列式剪枝（Column
            Pruning）等关键优化手段，最后给出一套可操作的读放大测量方法和数据库查询性能分析实战。
            
            

**版本说明**
            本文涉及的引擎和工具版本：RocksDB 9.x、LevelDB
            1.23、MySQL/InnoDB 8.4、PostgreSQL 17、ClickHouse
            24.x、Parquet format v2.6、Linux
            6.x。不同版本的默认参数和行为可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、读取性能的工程挑战

            

### 读放大的定义

            

读放大（Read Amplification）衡量的是：为了读取 1
            字节的有效数据，存储引擎实际从磁盘读取了多少字节。更精确地说，有两种度量方式：
            
            
- **字节读放大**：实际读取的磁盘字节数 /
            用户请求的有效字节数。
            
- **I/O 读放大**：实际发起的磁盘 I/O 次数 /
            逻辑上需要的 I/O 次数。
            
            

这两个指标不总是同步变化。一次 I/O 读放大可能只有
            2（读了两个块），但如果每个块 64 KB 而有效数据只有 100
            字节，字节读放大就是 1280。
            

### 读放大的来源

            

在不同的存储引擎架构中，读放大有不同的来源：
            
```
                       用户请求: GET(key)
                            |
                            v
                   +-----------------+
                   |   Memtable 查找  |  命中 -> 直接返回, 读放大 = 0
                   +-----------------+
                            |
                            v (未命中)
                   +-----------------+
                   |   Block Cache   |  命中 -> 读放大 = 0（已缓存）
                   +-----------------+
                            |
                            v (未命中)
          +----------------------------------+
          |      逐层检查 SSTable 文件          |
          |                                    |
          |  L0: 检查所有 SSTable（可能 4-8 个） |
          |  L1: 二分查找定位 1 个 SSTable       |
          |  L2: 二分查找定位 1 个 SSTable       |
          |  ...                               |
          |  L6: 二分查找定位 1 个 SSTable       |
          +----------------------------------+
                            |
                            v
          对每个候选 SSTable：
            1. 读取 Index Block（定位 Data Block）
            2. 读取 Bloom Filter Block（判断 key 是否可能存在）
            3. 如果 Bloom Filter 通过，读取 Data Block
            4. 在 Data Block 中二分查找 key
```

            

上图展示了 LSM-Tree 引擎的点查路径。每一个”读取 xxx
            Block”都是一次潜在的磁盘 I/O。一个 7 层 LSM-Tree，L0 有 4
            个文件，最坏情况下一次点查需要检查 4 + 6 = 10 个
            SSTable。每个 SSTable 需要读取 Index Block + Bloom Filter
            Block + Data Block，最坏情况下产生 30 次 I/O。这就是
            LSM-Tree 读放大的根源。
            

### B-Tree 与 LSM-Tree
            的读放大对比

            
            
            
            
            
            
            
            
            维度
            B-Tree（InnoDB）
            LSM-Tree（RocksDB）
            
            
            
            
            点查最坏 I/O 次数
            树高（通常 3-4 次）
            L0 文件数 + 其余层数（通常 10-15 次）
            
            
            范围查询效率
            叶子节点链表顺序扫描
            需要归并多层迭代器
            
            
            缓存友好性
            热数据集中在上层节点
            热数据分散在多层
            
            
            空间放大影响
            页分裂导致内部碎片
            Compaction 临时空间膨胀
            
            
            主要读放大来源
            非叶子节点遍历
            多层查找 + Bloom Filter 误判
            
            
            
            

B-Tree 的读放大相对可控——一棵高度为 4 的 B+ 树，点查最多
            4 次 I/O，而且上层节点几乎都在缓存中，实际只需要 1-2 次磁盘
            I/O。LSM-Tree 的读放大上限更高，但可以通过 Bloom
            Filter、Block Cache、Compaction
            策略等手段降低实际读放大。
            

读取优化的本质就是用各种手段减小这个放大因子：用索引减少需要扫描的数据范围，用
            Bloom Filter 跳过不可能命中的文件，用缓存避免重复
            I/O，用预读把随机 I/O 转换为顺序
            I/O，用列式剪枝避免读取不需要的列。
            
            

## 二、索引设计与查询优化

            

索引是读取路径上最基础的优化手段。好的索引设计能让查询的
            I/O 复杂度从 O(N) 降到 O(log N) 甚至 O(1)。
            

### SSTable 的索引结构

            

以 RocksDB 的 SSTable（Sorted String Table）为例，每个
            SSTable 文件包含以下几类索引块：
            
```
+-------------------------------+
|         Data Block 0          |
|         Data Block 1          |
|         ...                   |
|         Data Block N          |
+-------------------------------+
|       Meta Block (BF)         |   
            
- 减少内存占用——不需要把整个 Index Block
            加载到内存，只加载 Top-Level Index 和命中的分区。
            
- 提高 Block Cache 利用率——Index Partition
            作为独立的缓存单元，热分区留在缓存中，冷分区被淘汰。
            
- 减少 Cache Miss 的影响——一次 Cache Miss
            只需要加载一个小分区，而不是整个 Index Block。
            
            

在 RocksDB 中启用分区索引：
            
```
rocksdb::BlockBasedTableOptions table_options;
table_options.index_type = rocksdb::BlockBasedTableOptions::kTwoLevelIndexSearch;
table_options.metadata_block_size = 4096;  // 每个 Index Partition 的目标大小
table_options.pin_top_level_index_and_filter = true;  // 固定顶层索引在内存中
```

            

`pin_top_level_index_and_filter` 设置为
            `true` 时，顶层索引和顶层 Bloom Filter
            被固定在内存中，不会被 Block Cache
            淘汰。这保证了点查最多只增加一次额外的 I/O（读取 Index
            Partition），而不是两次（读取 Top-Level Index + Index
            Partition）。
            

### 前缀索引（Prefix Index）

            

如果查询模式以特定前缀为主（例如用户 ID 作为 key
            前缀），可以使用前缀索引（Prefix Index）来加速查找：
            
```
rocksdb::Options options;
options.prefix_extractor.reset(rocksdb::NewFixedPrefixTransform(8));  // 取 key 的前 8 字节作为前缀

rocksdb::BlockBasedTableOptions table_options;
table_options.index_type = rocksdb::BlockBasedTableOptions::kHashSearch;
```

            

前缀索引在 Index Block 中为每个前缀建立哈希映射，把 O(log
            N) 的二分查找变为 O(1)
            的哈希查找。代价是索引只对前缀匹配查询有效，全范围扫描（Full
            Range Scan）仍然需要回退到普通的二分查找。
            

### B-Tree 索引的优化

            

对于 B-Tree 引擎（如
            InnoDB），索引优化的核心是减少树的高度和提高缓存命中率。
            

InnoDB 的聚簇索引（Clustered Index）把行数据直接存储在 B+
            树的叶子节点中，主键查询只需要一次索引遍历。二级索引（Secondary
            Index）的叶子节点存储的是主键值，查询时需要先通过二级索引找到主键，再通过聚簇索引找到行数据——这个过程叫回表（Index
            Lookup），是 B-Tree 引擎读放大的主要来源之一。
            

覆盖索引（Covering
            Index）可以消除回表。如果查询需要的所有列都包含在索引中，InnoDB
            可以直接从索引中返回结果，不需要访问聚簇索引。
            
```
-- 创建覆盖索引：包含 user_id 和 created_at 两列
CREATE INDEX idx_user_created ON orders(user_id, created_at);

-- 以下查询可以使用覆盖索引，不需要回表
SELECT user_id, created_at FROM orders WHERE user_id = 12345;

-- 以下查询需要回表，因为 amount 不在索引中
SELECT user_id, created_at, amount FROM orders WHERE user_id = 12345;
```

            

在 MySQL 中可以通过 `EXPLAIN`
            确认是否使用了覆盖索引——如果 `Extra` 列显示
            `Using index`，说明查询完全在索引中完成，不需要回表。
            

### 索引设计的工程判断

            

索引不是越多越好。每增加一个索引，写入时需要额外维护一棵
            B+
            树或一组排序结构，占用的存储空间和写入开销都会增加。对于写密集型工作负载，过多的索引会显著拖慢写入速度。
            

我认为索引设计应该从查询模式出发，而不是从数据模型出发。先收集生产环境的慢查询日志（Slow
            Query Log），统计高频查询的 WHERE 条件和 JOIN
            条件，再决定需要哪些索引。盲目为每个列建索引是新手常犯的错误。
            
            

## 三、Bloom Filter 调优

            

布隆过滤器（Bloom Filter）是 LSM-Tree
            引擎中降低读放大的关键组件。它用一个概率数据结构（Probabilistic
            Data Structure）回答”某个 key 是否可能存在于这个 SSTable
            中”的问题。
            

### Bloom Filter
            的工作原理

            

Bloom Filter 由一个长度为 m 的比特数组（Bit Array）和 k
            个独立的哈希函数（Hash Function）组成。插入一个 key 时，用 k
            个哈希函数分别计算出 k 个位置，把这些位置的比特设为
            1。查询一个 key 时，同样计算 k
            个位置，如果所有位置的比特都是
            1，返回”可能存在”；如果任何一个位置是
            0，返回”一定不存在”。
            
```
Bloom Filter 查询示意：

Bit Array (m=16):  [0,1,0,1,1,0,0,1,0,0,1,0,0,1,0,0]
                       ^   ^ ^           ^
                       |   | |           |
                   hash1 hash2 hash3   hash4   --> key "user:1001"

所有位置均为 1 => "可能存在"（可能是误判）

Bit Array (m=16):  [0,1,0,1,1,0,0,1,0,0,1,0,0,1,0,0]
                             ^       ^
                             |       |
                         hash1     hash2   hash3 -> 0 => "一定不存在"
```

            

Bloom Filter 的关键特性：没有假阴性（False
            Negative），但存在假阳性（False Positive）。也就是说，如果
            Bloom Filter
            说”不存在”，那一定不存在；但如果说”可能存在”，有一定概率是误判。
            

### 误判率的数学关系

            

假阳性概率（False Positive Rate,
            FPR）与三个参数有关：
            
```
FPR ≈ (1 - e^(-kn/m))^k

其中：
  m = 比特数组长度（bits）
  n = 已插入元素数量
  k = 哈希函数个数
```

            

当 k 取最优值 k = (m/n) * ln(2) 时，FPR 简化为：
            
```
FPR ≈ (0.6185)^(m/n)
```

            

这意味着每个 key 分配的比特数（bits per key,
            BPK）直接决定了误判率。下表列出了不同 BPK
            下的理论误判率：
            
            
            
            bits per key (m/n)
            最优 k
            理论 FPR
            
            
            
            
            5
            3
            9.18%
            
            
            8
            6
            2.16%
            
            
            10
            7
            0.82%
            
            
            12
            8
            0.31%
            
            
            15
            10
            0.07%
            
            
            20
            14
            0.006%
            
            
            
            

RocksDB 默认的 `bits_per_key` 是 10，对应约
            0.82% 的误判率。这意味着每 100 次对不存在 key
            的查询中，大约有 1 次会错误地触发 Data Block 的读取。
            

### RocksDB 中的 Bloom
            Filter 配置

            
```
rocksdb::BlockBasedTableOptions table_options;

// 基本配置：每个 key 分配 10 bits
table_options.filter_policy.reset(rocksdb::NewBloomFilterPolicy(10));

// 启用全量过滤器（Full Filter）而不是分块过滤器
// RocksDB 7.0 以后默认使用 Full Filter
table_options.filter_policy.reset(rocksdb::NewBloomFilterPolicy(10, false));

// 对分区索引场景，启用分区过滤器
table_options.partition_filters = true;
table_options.index_type = rocksdb::BlockBasedTableOptions::kTwoLevelIndexSearch;
```

            

Full Filter 把整个 SSTable 的所有 key 放入一个 Bloom
            Filter 中，查询时不需要先确定 Data Block 再查找对应的 Bloom
            Filter 分块，减少了一次间接访问。
            

### Ribbon
            Filter：Bloom Filter 的替代方案

            

RocksDB 从 7.0 版本开始引入了 Ribbon Filter 作为 Bloom
            Filter 的替代方案。Ribbon Filter
            基于异或满足性问题（XOR-Satisfiability），在相同的误判率下比
            Bloom Filter 节省约 30% 的空间，代价是构建速度稍慢。
            
```
// 使用 Ribbon Filter 替代 Bloom Filter
table_options.filter_policy.reset(rocksdb::NewRibbonFilterPolicy(10));
```

            

Ribbon Filter 的查询速度与 Bloom Filter
            相当，但构建时需要更多 CPU 时间（大约慢 2-3 倍）。对于
            SSTable 构建频率低（Compaction
            不频繁）但查询频率高的场景，Ribbon Filter 是更好的选择；对于
            Compaction 密集的场景，Bloom Filter
            的构建速度优势更重要。
            

### Bloom Filter
            调优的工程判断

            

Bloom Filter 的 bits per key 不是越大越好。增加 BPK
            带来的收益是边际递减的——从 10 增加到 15 可以把 FPR 从 0.82%
            降到 0.07%，但如果数据集有 10 亿个 key，这额外的 5 bits/key
            意味着多占用约 600 MB 内存。
            

我认为调优 Bloom Filter
            的正确思路是：先测量实际工作负载中”查询不存在的
            key”的比例。如果应用层已经做了很好的路由（比如分片键保证查询一定能命中正确的分片），那么大部分查询都是命中的，Bloom
            Filter
            的误判率高一点也没关系。但如果应用层大量执行”查询可能不存在的
            key”（比如缓存穿透场景），就需要把 BPK 调高，甚至考虑在 L0
            和 L1 使用更高的 BPK。
            

RocksDB 支持按层配置不同的 Bloom Filter 参数：
            
```
rocksdb::Options options;
// 通过 ColumnFamilyOptions 的 advanced_options 可以为不同层设置不同的 filter 配置
// 实践中更常见的做法是为整个 CF 设置统一的 BPK，然后在 L0 层额外增大
options.optimize_filters_for_hits = true;  // 如果大部分查询都命中，跳过最底层的 Bloom Filter
```

            

`optimize_filters_for_hits`
            选项在假设”大部分查询都命中”的前提下，跳过最底层（通常是最大的）SSTable
            的 Bloom Filter 构建，节省磁盘空间和 Compaction
            CPU。但如果实际工作负载中有大量未命中的查询，这个优化反而会导致读延迟显著增加。
            
            

## 四、块缓存设计与调优

            

块缓存（Block
            Cache）是存储引擎中最直接的读取性能优化手段：把从磁盘读取的数据块缓存在内存中，下次访问同一个块时直接从内存返回，避免磁盘
            I/O。
            

### Block Cache 的基本架构

            
```
graph TD
    A["用户请求: Get(key)"] --> B{"Memtable 命中?"}
    B -->|是| C["直接返回"]
    B -->|否| D{"Block Cache 命中?"}
    D -->|是| E["从缓存读取 Data Block"]
    D -->|否| F["从磁盘读取 Data Block"]
    F --> G["解压缩"]
    G --> H["插入 Block Cache"]
    H --> E
    E --> I["在 Block 中二分查找 key"]
    I --> J["返回结果"]
```

            

上图展示了 Block Cache 在读取路径中的位置。Block Cache
            位于 Memtable 之后、磁盘 I/O 之前，是减少磁盘 I/O
            的核心屏障。
            

### LRU Cache 与 Clock
            Cache

            

RocksDB 提供两种 Block Cache 实现：
            

**LRU Cache（最近最少使用缓存）**：标准的
            LRU
            淘汰策略。每次访问一个缓存条目时，把它移到链表头部；空间不足时，淘汰链表尾部的条目。LRU
            Cache
            的问题在于需要互斥锁（Mutex）保护链表操作，在高并发场景下锁竞争会成为瓶颈。
            

RocksDB 的 LRU Cache
            通过分片（Sharding）缓解锁竞争——默认创建 64
            个分片，每个分片有独立的锁和 LRU 链表：
            
```
// 创建 8 GB 的 LRU Block Cache，64 个分片
std::shared_ptr cache = rocksdb::NewLRUCache(
    8ULL * 1024 * 1024 * 1024,  // 容量 8 GB
    6,                           // num_shard_bits = 6, 即 2^6 = 64 个分片
    false,                       // strict_capacity_limit = false
    0.9                          // high_pri_pool_ratio = 0.9
);
```

            

`high_pri_pool_ratio`
            参数控制高优先级池的比例。RocksDB 把 Index Block 和 Filter
            Block 标记为高优先级，Data Block
            标记为低优先级。高优先级池占 90%
            的空间意味着索引和过滤器数据几乎不会被淘汰，保证了索引查找始终在内存中完成。
            

**HyperClockCache**：RocksDB 从 8.x
            版本引入的无锁缓存实现。它基于时钟算法（Clock
            Algorithm）的变体，使用原子操作（Atomic
            Operations）代替互斥锁，在高并发场景下吞吐量比 LRU Cache 高
            30%-50%。
            
```
rocksdb::HyperClockCacheOptions hcc_options(
    8ULL * 1024 * 1024 * 1024,  // 容量 8 GB
    16 * 1024                    // estimated_entry_charge = 16 KB（估计的平均条目大小）
);
std::shared_ptr cache = hcc_options.MakeSharedCache();
```

            

HyperClockCache
            需要提前估计平均条目大小（`estimated_entry_charge`），这个值影响内部哈希表的预分配大小。如果估计不准确，可能导致内存使用效率下降。
            

### Block Cache 的容量规划

            

Block Cache 的容量应该根据工作集大小（Working Set
            Size）来规划，而不是简单地分配”可用内存的 X%“。
            

关键指标：
            
            
- **缓存命中率（Cache Hit Ratio）**：命中次数
            / (命中次数 + 未命中次数)。生产环境中，Block Cache
            命中率低于 90% 通常意味着缓存容量不足。
            
- **缓存命中率与延迟的关系**：假设 Block
            Cache 命中延迟是 1 微秒，SSD 随机读延迟是 100 微秒，那么：
            
            
- 命中率 99%：平均延迟 = 0.99 * 1 + 0.01 * 100 = 1.99
            微秒
            
- 命中率 95%：平均延迟 = 0.95 * 1 + 0.05 * 100 = 5.95
            微秒
            
- 命中率 90%：平均延迟 = 0.90 * 1 + 0.10 * 100 = 10.9
            微秒
            
            
            

命中率每下降 5 个百分点，平均延迟增加 5 微秒。在 HDD
            环境下这个差距更大——HDD 随机读延迟在 5-10 毫秒，命中率从 99%
            降到 95% 意味着平均延迟从 50 微秒增加到 500 微秒，差了 10
            倍。
            

### RocksDB Block Cache
            统计信息

            

通过 `Statistics` 接口可以获取 Block Cache
            的详细运行状态：
            
```
rocksdb::Options options;
options.statistics = rocksdb::CreateDBStatistics();

// 获取统计信息
std::string stats;
options.statistics->ToString(nullptr, &stats);

// 关键指标
// rocksdb.block.cache.hit        - 缓存命中次数
// rocksdb.block.cache.miss       - 缓存未命中次数
// rocksdb.block.cache.add        - 缓存插入次数
// rocksdb.block.cache.data.hit   - Data Block 命中次数
// rocksdb.block.cache.index.hit  - Index Block 命中次数
// rocksdb.block.cache.filter.hit - Filter Block 命中次数
```

            

监控时应当分别关注 Data Block、Index Block 和 Filter
            Block 的命中率。如果 Index Block 的命中率低于 99%，说明
            Block Cache 容量严重不足或 `high_pri_pool_ratio`
            设置太低——索引数据的频繁淘汰会导致几乎每次查询都需要额外的磁盘
            I/O 来加载索引。
            

### InnoDB 的 Buffer Pool

            

InnoDB 的缓冲池（Buffer Pool）与 RocksDB 的 Block Cache
            在目标上一致，但设计上有几个关键差异：
            
            
- **缓存单位不同**：InnoDB 以页（Page，默认
            16 KB）为单位缓存，RocksDB 以数据块（Block，默认 4
            KB）为单位。
            
- **LRU 分代**：InnoDB 的 LRU
            链表分为两段——new sublist（热端，占 5/8）和 old
            sublist（冷端，占 3/8）。新插入的页先进入 old sublist
            的头部，只有在 old sublist 中存活超过
            `innodb_old_blocks_time`（默认 1000
            毫秒）后再次被访问，才提升到 new
            sublist。这个设计可以防止全表扫描一次性冲刷整个缓存。
            
- **脏页管理**：InnoDB 的 Buffer Pool
            不仅缓存读取的数据，还缓存修改后尚未刷盘的脏页。Block Cache
            只缓存从磁盘读取的数据，写入走独立的 Write Buffer / Memtable
            路径。
            
            

InnoDB Buffer Pool 的核心配置：
            
```
-- Buffer Pool 总大小，通常设置为物理内存的 50%-80%
SET GLOBAL innodb_buffer_pool_size = 8589934592;  -- 8 GB

-- Buffer Pool 实例数，减少锁竞争
SET GLOBAL innodb_buffer_pool_instances = 8;       -- 8 个实例

-- 新页在 old sublist 中的最小停留时间
SET GLOBAL innodb_old_blocks_time = 1000;          -- 1000 毫秒
```

            

### Block Cache
            调优的工程判断

            

缓存调优中最常见的错误是给 Block Cache
            分配了过多内存，挤占了操作系统页缓存（Page
            Cache）的空间。RocksDB 的数据文件也会被操作系统缓存在 Page
            Cache 中。如果 Block Cache 配置了 12 GB，Page Cache 只剩 2
            GB，可能出现 Block Cache 和 Page Cache
            缓存相同数据的双重缓存问题——浪费内存，降低整体命中率。
            

避免双重缓存的方法：
            
            
- 使用 Direct I/O 绕过 Page Cache，让所有缓存管理由 Block
            Cache 负责。
            
- 如果不使用 Direct I/O，需要协调 Block Cache 和 Page
            Cache 的总容量，确保两者之和不超过物理内存的 80%。
            
            
```
rocksdb::Options options;
// 启用 Direct I/O 读取，避免双重缓存
options.use_direct_reads = true;
// 启用 Direct I/O 写入（Compaction 和 Flush）
options.use_direct_io_for_flush_and_compaction = true;
```

            
            

## 五、压缩与解压缩的
            CPU-I/O 权衡

            

存储引擎中的数据通常以压缩形式存放在磁盘上。读取时需要先从磁盘读取压缩数据，再在
            CPU 上执行解压缩。压缩节省了磁盘 I/O 量，但增加了 CPU
            开销——这就是压缩的 CPU-I/O 权衡。
            

### 权衡模型

            

用一个简单的延迟模型量化这个权衡：
            
```
T_read = T_io + T_decompress

T_io          = 压缩后数据大小 / 磁盘带宽
T_decompress  = 原始数据大小 / 解压速度

压缩净收益 = T_read(不压缩) - T_read(压缩)
           = 原始大小/磁盘带宽 - (原始大小/压缩率/磁盘带宽 + 原始大小/解压速度)
           = 原始大小 * (1/磁盘带宽 - 1/(压缩率*磁盘带宽) - 1/解压速度)
           = 原始大小 * ((1 - 1/压缩率)/磁盘带宽 - 1/解压速度)
```

            

当压缩净收益 > 0
            时，压缩有利于读取性能。这个条件可以改写为：
            
```
解压速度 > 磁盘带宽 * 压缩率 / (压缩率 - 1)
```

            

以下表格展示了不同存储介质和压缩算法组合下的净收益情况。数据块大小
            64 KB，压缩率假设 2.5:1：
            
            
            
            
            
            
            
            
            
            
            存储介质
            带宽
            LZ4 解压 (4000 MB/s)
            Zstd 解压 (1200 MB/s)
            Zlib 解压 (400 MB/s)
            
            
            
            
            HDD (150 MB/s)
            150 MB/s
            净收益 36 微秒
            净收益 33 微秒
            净收益 21 微秒
            
            
            SATA SSD (500 MB/s)
            500 MB/s
            净收益 6.1 微秒
            净收益 3.9 微秒
            损失 8.7 微秒
            
            
            NVMe SSD (3000 MB/s)
            3000 MB/s
            净收益 0.7 微秒
            损失 4.2 微秒
            损失 24 微秒
            
            
            Intel Optane (2500 MB/s)
            2500 MB/s
            净收益 0.9 微秒
            损失 3.0 微秒
            损失 19 微秒
            
            
            
            

上表中的数据是基于公式的理论计算，用于展示趋势，非实测结果。
            

核心结论：随着存储介质速度的提升，压缩的收益逐渐缩小甚至变为负数。在
            NVMe SSD 上，只有 LZ4 这种极速解压算法还能保持正收益，Zstd
            和 Zlib 的解压开销已经超过了 I/O 节省。
            

### 按层压缩策略

            

基于上面的分析，LSM-Tree 引擎通常采用按层压缩（Per-Level
            Compression）策略：
            
```
rocksdb::Options options;
options.compression_per_level = {
    rocksdb::kNoCompression,      // L0: 不压缩（频繁读写，延迟敏感）
    rocksdb::kLZ4Compression,     // L1: LZ4（中等频率访问）
    rocksdb::kLZ4Compression,     // L2: LZ4
    rocksdb::kZSTD,               // L3: Zstd（访问频率降低，空间优先）
    rocksdb::kZSTD,               // L4: Zstd
    rocksdb::kZSTD,               // L5: Zstd
    rocksdb::kZSTD,               // L6: Zstd（最底层，数据量最大）
};
```

            

L0 层不压缩，因为 L0 的 SSTable 会参与频繁的 Compaction
            和查询；L1-L2 使用 LZ4，平衡速度和压缩率；L3 以下使用
            Zstd，因为底层数据量大、访问频率低，空间节省比 CPU
            开销更重要。
            

### 压缩字典（Compression
            Dictionary）

            

对于小数据块（4-16
            KB），标准压缩算法的压缩率会显著下降，因为每个块内部可供参考的重复模式太少。Zstd
            的压缩字典（Compression
            Dictionary）可以缓解这个问题——用训练数据集生成一个共享字典，压缩时引用字典中的模式，而不仅仅是当前块内的模式。
            

RocksDB 支持在 SSTable 级别使用压缩字典：
            
```
rocksdb::Options options;
options.compression = rocksdb::kZSTD;

rocksdb::CompressionOptions compression_opts;
compression_opts.max_dict_bytes = 16384;     // 字典最大 16 KB
compression_opts.zstd_max_train_bytes = 1048576;  // 用最多 1 MB 数据训练字典
options.compression_opts = compression_opts;
```

            

在小值场景中（例如元数据存储、配置存储），压缩字典可以把压缩率从
            1.2:1 提升到 2.5:1 以上，效果很显著。但字典本身需要存储在
            SSTable 中，增加了文件大小和构建时间。
            

### 解压缓存（Uncompressed
            Block Cache）

            

如果同一个 Data Block 被反复访问，每次从 Block Cache
            读取压缩数据后都需要解压，CPU 开销会很可观。RocksDB
            支持一个额外的非压缩缓存（Uncompressed Block
            Cache），缓存解压后的数据块，避免重复解压：
            
```
// 主 Block Cache：缓存压缩后的数据块
auto compressed_cache = rocksdb::NewLRUCache(4ULL * 1024 * 1024 * 1024);  // 4 GB

// 非压缩缓存：缓存解压后的数据块
auto uncompressed_cache = rocksdb::NewLRUCache(2ULL * 1024 * 1024 * 1024);  // 2 GB

rocksdb::BlockBasedTableOptions table_options;
table_options.block_cache = uncompressed_cache;
table_options.block_cache_compressed = compressed_cache;
```

            

这种双层缓存结构的好处是：热数据在非压缩缓存中以解压形式存在，读取时零
            CPU
            开销；温数据在压缩缓存中以压缩形式存在，占用较少内存但需要解压。代价是总内存使用量增加，需要仔细平衡两个缓存的大小。
            

实际工程中我们发现，双层缓存在 CPU
            是瓶颈的场景（例如高并发小值读取）下效果明显，但在 I/O
            是瓶颈的场景下收益有限——因为瓶颈不在解压速度，而在磁盘带宽。
            
            

## 六、预读策略

            

预读（Readahead /
            Prefetch）的核心思想是：在应用实际请求数据之前，提前把数据从磁盘加载到内存中，把同步的磁盘
            I/O 变成异步的内存访问。
            

### Linux 内核的预读机制

            

Linux 内核的页缓存（Page
            Cache）内置了自适应预读（Adaptive
            Readahead）机制。当内核检测到顺序读取模式时，会自动预读后续的页：
            
```
初始窗口: 128 KB（默认，由 /sys/block//queue/read_ahead_kb 控制）
检测到顺序读取后，窗口指数增长：128 KB -> 256 KB -> 512 KB -> ...
最大窗口: 默认 128 KB（可通过 read_ahead_kb 调整）
检测到随机读取时，窗口缩回或关闭预读
```

            

查看和修改预读窗口大小：
            
```
# 查看当前预读窗口大小（单位 KB）
cat /sys/block/sda/queue/read_ahead_kb

# 修改预读窗口大小（需要 root 权限）
echo 256 > /sys/block/sda/queue/read_ahead_kb
```

            

内核预读对顺序扫描场景（全表扫描、Compaction、备份）效果显著，但对随机点查几乎无效——随机点查没有顺序模式可供检测，预读反而会浪费
            I/O 带宽，读取不需要的数据。
            

### 存储引擎层的预读

            

存储引擎通常实现自己的预读逻辑，而不是完全依赖内核预读，原因有两个：
            
            
- 内核预读基于文件偏移的顺序性判断，无法感知存储引擎的逻辑访问模式（例如
            SSTable 的 Data Block
            是逻辑上顺序但物理上可能不连续的）。
            
- 使用 Direct I/O 绕过 Page Cache
            后，内核预读不再生效，必须由引擎自己管理。
            
            

RocksDB 的迭代器（Iterator）支持配置预读大小：
            
```
rocksdb::ReadOptions read_options;

// 为迭代器启用预读
read_options.readahead_size = 2 * 1024 * 1024;  // 预读 2 MB

// 自适应预读：初始不预读，检测到顺序访问后自动启用
read_options.adaptive_readahead = true;

// Compaction 时的预读大小
rocksdb::Options options;
options.compaction_readahead_size = 2 * 1024 * 1024;  // Compaction 读取时预读 2 MB
```

            

`adaptive_readahead` 是 RocksDB 在 7.x
            版本引入的特性，它让迭代器从零预读开始，在检测到连续的 Data
            Block 读取后自动增大预读窗口，最大不超过
            `readahead_size`。这比固定预读更灵活——短范围查询不会浪费
            I/O，长范围扫描可以享受预读带来的带宽提升。
            

### madvise 与 fadvise

            

在使用 mmap 或 Page Cache 的场景中，应用程序可以通过
            `madvise()` 和 `posix_fadvise()`
            系统调用向内核提供访问模式的提示：
            
```
#include 
#include 

// madvise：对已映射的内存区域提供访问模式提示
void *addr = mmap(NULL, file_size, PROT_READ, MAP_PRIVATE, fd, 0);

// 告知内核将顺序访问，启用预读
madvise(addr, file_size, MADV_SEQUENTIAL);

// 告知内核将随机访问，关闭预读
madvise(addr, file_size, MADV_RANDOM);

// 告知内核即将访问指定范围，提前加载到内存
madvise(addr + offset, length, MADV_WILLNEED);

// 告知内核指定范围不再需要，可以回收
madvise(addr + offset, length, MADV_DONTNEED);
```

            
```
#include 

// posix_fadvise：对文件描述符提供访问模式提示
int fd = open("data.sst", O_RDONLY);

// 顺序访问提示
posix_fadvise(fd, 0, 0, POSIX_FADV_SEQUENTIAL);

// 随机访问提示
posix_fadvise(fd, 0, 0, POSIX_FADV_RANDOM);

// 预取指定范围
posix_fadvise(fd, offset, length, POSIX_FADV_WILLNEED);

// 访问完毕，可以淘汰
posix_fadvise(fd, offset, length, POSIX_FADV_DONTNEED);
```

            

`MADV_WILLNEED` /
            `POSIX_FADV_WILLNEED`
            可以看作应用层控制的显式预读：应用程序知道即将访问哪些范围，主动通知内核提前加载。这比内核的自适应预读更精确，不会预读不需要的数据。
            

### 预读策略的工程判断

            

预读是一把双刃剑。过度预读会导致：
            
            
- **I/O
            带宽浪费**：预读的数据如果没有被后续访问命中，就白白消耗了磁盘带宽。
            
- **缓存污染**：预读的数据占据了 Page Cache
            或 Block Cache 的空间，可能把真正需要的热数据淘汰出去。
            
- **延迟抖动**：大量预读 I/O 和前台请求竞争
            I/O 队列，可能导致前台请求的 P99 延迟上升。
            
            

正确的做法是根据访问模式选择预读策略：
            
            
- **点查为主**：关闭预读或使用
            `MADV_RANDOM`，让每次 I/O 只读取需要的块。
            
- **范围扫描**：启用自适应预读，初始窗口小，顺序模式确认后逐步增大。
            
- **全表扫描 /
            Compaction**：使用较大的固定预读（1-2
            MB），最大化顺序读吞吐。
            
- **混合工作负载**：使用
            `adaptive_readahead`，让引擎自动判断。
            
            
            

## 七、列式剪枝与谓词下推

            

列式存储（Columnar
            Storage）的读取优化核心是两个技术：列式剪枝（Column
            Pruning）和谓词下推（Predicate
            Pushdown）。它们分别解决”不读不需要的列”和”不读不需要的行”的问题。
            

### 列式剪枝

            

列式存储引擎（如
            Parquet、ORC）把同一列的数据连续存放在一起。如果查询只需要表中的几列，引擎可以只读取这些列的数据块，完全跳过其他列——这就是列式剪枝。
            

以 Parquet 文件为例：
            
```
Parquet 文件物理布局:

+-----------------+
| Row Group 0     |
|  Column Chunk: user_id     (offset: 0,    size: 64 KB)  |
|  Column Chunk: name        (offset: 64K,  size: 128 KB) |
|  Column Chunk: email       (offset: 192K, size: 256 KB) |
|  Column Chunk: created_at  (offset: 448K, size: 32 KB)  |
+-----------------+
| Row Group 1     |
|  Column Chunk: user_id     (offset: 480K, size: 64 KB)  |
|  ...                                                     |
+-----------------+
| Footer          |
|  Schema + Column Metadata + Row Group Metadata           |
+-----------------+
```

            

查询 `SELECT user_id, created_at FROM users`
            时，引擎只需要读取每个 Row Group 中 `user_id` 和
            `created_at` 的 Column Chunk，跳过
            `name` 和
            `email`。在上面的例子中，只需要读取 64 + 32 = 96
            KB，而不是整个 Row Group 的 480 KB。
            

列式剪枝的效果取决于查询涉及的列占总列数的比例。对于宽表（几十到上百列），如果查询只涉及
            3-5 列，列式剪枝可以减少 90% 以上的 I/O 量。
            

### 谓词下推

            

谓词下推（Predicate
            Pushdown）把过滤条件下推到存储层执行，在读取数据的同时就过滤掉不满足条件的行，避免把大量无用数据传输到计算层。
            

Parquet 和 ORC 支持两层谓词下推：
            

**Row Group 级过滤**：Parquet 的 Row Group
            Metadata
            中记录了每列的统计信息（最小值、最大值、空值计数）。如果查询条件
            `WHERE created_at > '2025-01-01'`，而某个 Row
            Group 的 `created_at` 最大值是
            `2024-06-30`，引擎可以直接跳过整个 Row
            Group，不读取任何数据。
            

**Page 级过滤**：Parquet v2
            支持页级统计信息（Column Index），可以在 Page 粒度做过滤，比
            Row Group 级更精细。
            
```
# PyArrow 读取 Parquet 时使用谓词下推（Python 3.10+, PyArrow 15+）
import pyarrow.parquet as pq

# 指定只读取需要的列（列式剪枝）
# 使用过滤条件（谓词下推）
table = pq.read_table(
    'users.parquet',
    columns=['user_id', 'created_at'],           # 列式剪枝
    filters=[('created_at', '>', '2025-01-01')]   # 谓词下推
)
```

            

### ClickHouse
            的数据跳跃索引

            

ClickHouse 在列式存储的基础上引入了数据跳跃索引（Data
            Skipping Index），进一步减少扫描范围。数据跳跃索引不是传统的
            B-Tree 索引，而是为数据块（Granule，默认 8192
            行）记录的汇总信息。
            

常见的跳跃索引类型：
            
            
            
            
            
            
            
            
            索引类型
            原理
            适用场景
            
            
            
            
            minmax
            记录每个 Granule 中列的最小值和最大值
            范围查询
            
            
            set(N)
            记录每个 Granule 中列的去重值集合（最多 N 个）
            低基数列的等值查询
            
            
            bloom_filter
            为每个 Granule 构建 Bloom Filter
            高基数列的等值查询
            
            
            ngrambf_v1
            为字符串列构建 n-gram Bloom Filter
            模糊匹配（LIKE ‘%keyword%’）
            
            
            
            
```
-- ClickHouse 创建带跳跃索引的表
CREATE TABLE events (
    event_date Date,
    user_id UInt64,
    event_type String,
    payload String,
    INDEX idx_user_id user_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_event_type event_type TYPE set(100) GRANULARITY 4
) ENGINE = MergeTree()
ORDER BY (event_date, user_id);
```

            

`GRANULARITY 4` 表示每 4 个 Granule（4 * 8192
            = 32768
            行）构建一个索引条目。粒度越小，索引越精确但占用空间越大。
            

### 列式剪枝与谓词下推的工程判断

            

列式剪枝和谓词下推的效果高度依赖数据的物理布局。有几个常见的坑：
            
            
- 

**Row Group 太大**：如果每个 Row Group
            包含 100 万行，而查询只需要其中的 100
            行，即使谓词下推跳过了大部分 Row Group，命中的 Row Group
            仍然需要全量读取。解决方案是在写入时合理设置 Row Group
            大小（Parquet 默认 128 MB 的 Row Group
            偏大，对于频繁过滤的分析场景可以缩小到 32-64 MB）。
            
- 

**数据未按查询条件排序**：谓词下推依赖统计信息（min/max）来跳过数据块。如果数据的排列顺序和查询条件无关，每个
            Row Group 的 min/max
            范围几乎覆盖全域，谓词下推就失效了。解决方案是在写入时按常用查询条件排序数据。
            
- 

**高基数列的 Bloom Filter
            空间膨胀**：为高基数列（如 UUID）的每个 Granule 构建
            Bloom Filter，空间开销可能很大。需要评估 Bloom Filter 节省的
            I/O 是否能抵消额外的存储和内存开销。
            
            
            

## 八、读放大测量方法

            

优化读取性能的前提是能准确测量读放大。直觉和猜测在性能优化中不可靠——必须用数据说话。
            

### 方法一：存储引擎统计信息

            

大多数存储引擎提供了内置的 I/O 统计接口。
            

**RocksDB**：`PerfContext` 和
            `IOStatsContext` 提供了每次操作的详细 I/O
            统计：
            
```
#include "rocksdb/perf_context.h"
#include "rocksdb/iostats_context.h"

// 启用线程级 PerfContext
rocksdb::SetPerfLevel(rocksdb::PerfLevel::kEnableTimeAndCPUTimeExceptForMutex);
rocksdb::get_perf_context()->Reset();
rocksdb::get_iostats_context()->Reset();

// 执行一次读取
std::string value;
rocksdb::Status s = db->Get(rocksdb::ReadOptions(), "my_key", &value);

// 读取 I/O 统计
auto& perf = *rocksdb::get_perf_context();
auto& io = *rocksdb::get_iostats_context();

printf("块读取次数:       %lu\n", perf.block_read_count);
printf("块读取字节数:     %lu\n", perf.block_read_byte);
printf("块缓存命中次数:   %lu\n", perf.block_cache_hit_count);
printf("Bloom Filter 有用次数: %lu\n", perf.bloom_sst_hit_count);
printf("Bloom Filter 误判次数: %lu\n", perf.bloom_sst_miss_count);
printf("磁盘读取字节数:   %lu\n", io.bytes_read);
```

            

通过对比
            `block_read_byte`（实际读取的块字节数）和有效数据大小（`value.size()`），就可以计算出单次操作的字节读放大。
            

**MySQL/InnoDB**：通过
            `performance_schema` 或
            `SHOW ENGINE INNODB STATUS` 获取 I/O 统计：
            
```
-- 查看 InnoDB Buffer Pool 统计
SHOW ENGINE INNODB STATUS\G

-- 通过 performance_schema 获取文件 I/O 统计
SELECT * FROM performance_schema.file_summary_by_instance
WHERE FILE_NAME LIKE '%ibd'
ORDER BY SUM_NUMBER_OF_BYTES_READ DESC
LIMIT 10;
```

            

### 方法二：操作系统级 I/O
            追踪

            

当存储引擎的内置统计不够详细时，可以用操作系统工具直接追踪进程的磁盘
            I/O。
            

**iostat**：查看设备级的 I/O 吞吐量和
            IOPS：
            
```
# 每 1 秒输出一次，显示扩展统计
iostat -x 1

# 关注的指标：
# r/s      - 每秒读取请求数
# rkB/s    - 每秒读取 KB 数
# r_await  - 平均读取延迟（毫秒）
# rareq-sz - 平均读取请求大小（KB）
```

            

**blktrace / bpftrace**：追踪块设备层的单次
            I/O 请求：
            
```
# 使用 bpftrace 追踪 block I/O 请求（需要 root 权限）
# 统计每个进程的读取 I/O 大小分布
bpftrace -e '
tracepoint:block:block_rq_complete /args->rwbs == "R"/ {
    @bytes[comm] = hist(args->nr_sector * 512);
}
'
```

            

**strace**：追踪进程的系统调用，查看每次
            `read()`/`pread64()`
            的参数和返回值：
            
```
# 追踪 RocksDB 进程的读取系统调用
strace -p 

 -e trace=pread64,read -T 2>&1 | head -50
```

            

`strace` 的开销较大（通常让目标进程慢 2-5
            倍），生产环境中应使用 `perf trace` 或
            `bpftrace` 等低开销工具。
            

### 方法三：合成基准测试

            

用合成基准测试（Synthetic
            Benchmark）在可控条件下测量读放大：
            
```
# 使用 db_bench 测量 RocksDB 的读放大
# 先写入数据
./db_bench --benchmarks=fillrandom \
           --num=1000000 \
           --key_size=16 \
           --value_size=100 \
           --db=/data/test_db

# 点查基准测试，测量读放大
./db_bench --benchmarks=readrandom \
           --num=1000000 \
           --use_existing_db=true \
           --db=/data/test_db \
           --statistics=true \
           --perf_level=3 2>&1 | grep -E "(block.cache|bloom|read)"
```

            

### 读放大的综合评估

            

单一的读放大数字往往不够——需要区分不同操作类型的读放大：
            
            
            
            操作类型
            典型读放大（LSM-Tree）
            主要优化手段
            
            
            
            
            点查（存在的 key）
            1-3x
            Block Cache, 分区索引
            
            
            点查（不存在的 key）
            1-10x
            Bloom Filter
            
            
            短范围查询（100 行）
            2-5x
            预读, Block Cache
            
            
            全表扫描
            1-1.5x
            顺序预读, 列式剪枝
            
            
            前缀扫描
            1-3x
            前缀 Bloom Filter, 前缀索引
            
            
            
            

读放大并不是越低越好——有时候为了降低读放大而做的优化（例如增大
            Block Cache）会引入其他代价（内存占用、GC
            压力）。优化目标应该是在给定的硬件资源约束下，最小化端到端查询延迟。
            
            

## 九、数据库查询性能分析实战

            

本节通过一个具体的案例，演示如何诊断和优化一个实际的读取性能问题。
            

### 场景描述

            

假设有一个订单查询服务，使用 MySQL 8.4 / InnoDB
            引擎，表结构如下：
            
```
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    status TINYINT NOT NULL DEFAULT 0,
    amount DECIMAL(10, 2) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB;
```

            

表中有 5000 万行数据，约 12 GB。Buffer Pool 配置为 4
            GB。业务反馈查询
            `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
            的 P99 延迟超过 200 毫秒。
            

### 第一步：分析执行计划

            
```
EXPLAIN SELECT * FROM orders WHERE user_id = 12345 ORDER BY created_at DESC LIMIT 20\G
```

            

预期输出（以下为模拟输出，非实际执行结果，仅用于说明分析方法）：
            
```
           id: 1
  select_type: SIMPLE
        table: orders
   partitions: NULL
         type: ref
possible_keys: idx_user_id
          key: idx_user_id
      key_len: 8
          ref: const
         rows: 4500
     filtered: 100.00
        Extra: Using filesort
```

            

问题分析：
            
            
- `type: ref` 表示使用了
            `idx_user_id` 索引，这没问题。
            
- `rows: 4500` 表示 MySQL 预估需要扫描 4500
            行——这个用户有大量订单。
            
- `Extra: Using filesort`
            表示需要额外的排序操作，因为 `idx_user_id`
            索引不包含 `created_at` 的排序信息。
            
            

### 第二步：优化索引

            

问题的根源在于 `idx_user_id` 索引只包含
            `user_id`，无法满足
            `ORDER BY created_at DESC` 的排序需求。MySQL
            必须先通过索引找到所有 `user_id = 12345`
            的行，回表读取完整数据，再在内存中排序。
            

创建一个复合索引（Composite
            Index）可以同时满足过滤和排序需求：
            
```
-- 创建复合索引：先按 user_id 过滤，再按 created_at 降序排列
ALTER TABLE orders ADD INDEX idx_user_created (user_id, created_at DESC);
```

            

创建复合索引后重新分析执行计划：
            
```
EXPLAIN SELECT * FROM orders WHERE user_id = 12345 ORDER BY created_at DESC LIMIT 20\G
```

            

预期改善后的输出：
            
```
           id: 1
  select_type: SIMPLE
        table: orders
   partitions: NULL
         type: ref
possible_keys: idx_user_id,idx_user_created
          key: idx_user_created
      key_len: 8
          ref: const
         rows: 20
     filtered: 100.00
        Extra: NULL
```

            

改善点：
            
            
- `key: idx_user_created`
            使用了新的复合索引。
            
- `rows: 20` 由于索引本身按
            `created_at` 降序排列，`LIMIT 20`
            只需要读取索引的前 20 个条目。
            
- `Extra` 中没有
            `Using filesort`，排序通过索引完成。
            
            

### 第三步：进一步优化——覆盖索引

            

上面的查询仍然需要回表（通过主键到聚簇索引读取完整行），因为查询使用了
            `SELECT *`。如果业务只需要部分列，可以使用覆盖索引：
            
```
-- 如果业务只需要 id, user_id, amount, created_at
ALTER TABLE orders ADD INDEX idx_user_created_covering
    (user_id, created_at DESC, id, amount);

-- 修改查询，只查需要的列
SELECT id, user_id, amount, created_at
FROM orders
WHERE user_id = 12345
ORDER BY created_at DESC
LIMIT 20;
```

            

覆盖索引消除了回表操作，所有数据都从索引中获取。对于这个查询，I/O
            次数从”索引查找 + 20 次回表”减少为”索引查找 + 索引中顺序读取
            20 个条目”。
            

### 第四步：验证 Buffer
            Pool 状态

            
```
-- 检查 Buffer Pool 命中率
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
```

            

关键指标：
            
```
Innodb_buffer_pool_read_requests  - Buffer Pool 读取请求总数（逻辑读）
Innodb_buffer_pool_reads          - 必须从磁盘读取的次数（物理读）
命中率 = 1 - (reads / read_requests) * 100%
```

            

如果命中率低于 95%，说明 Buffer Pool
            容量不足以缓存工作集，需要增大
            `innodb_buffer_pool_size`
            或优化查询减少数据访问量。
            

### 第五步：检查系统层 I/O

            
```
# 查看 MySQL 进程的 I/O 统计（Linux）
pidstat -d -p $(pgrep -f mysqld) 1

# 输出包含：
# kB_rd/s  - 每秒读取 KB 数
# kB_wr/s  - 每秒写入 KB 数
# iodelay  - I/O 延迟（时钟周期）
```

            
```
# 查看磁盘级别的延迟分布
iostat -x 1

# 重点关注：
# r_await  - 平均读取延迟（毫秒）
# %util    - 磁盘利用率
```

            

如果 `r_await` 超过 10 毫秒（SSD
            场景），可能存在 I/O 队列拥堵或磁盘本身性能问题。如果
            `%util` 持续在 90%
            以上，说明磁盘已经成为瓶颈，需要考虑升级存储硬件或增加缓存。
            

### 优化效果对比

            
            
            
            优化阶段
            扫描行数
            回表次数
            是否需要排序
            预期延迟
            
            
            
            
            原始查询
            4500
            4500
            是（filesort）
            > 200 毫秒
            
            
            复合索引
            20
            20
            否
            约 5-10 毫秒
            
            
            覆盖索引
            20
            0
            否
            约 1-3 毫秒
            
            
            
            

上表中的延迟为基于经验的估计值，实际延迟取决于数据分布、Buffer
            Pool 命中率、磁盘性能等因素。
            

这个案例展示了读取性能优化的典型思路：先通过执行计划定位问题（扫描行数过多、不必要的排序），再通过索引优化减少扫描范围，最后通过覆盖索引消除回表。每一步都用具体的指标验证效果，而不是凭直觉判断。
            
            

## 十、参考文献

            

### 论文与书籍

            
            
- Patrick O’Neil et al., “The Log-Structured Merge-Tree
            (LSM-Tree)”, Acta Informatica, 1996. 读放大的概念最早在
            LSM-Tree 论文的讨论中被系统分析。
            
- Burton H. Bloom, “Space/Time Trade-offs in Hash Coding
            with Allowable Errors”, Communications of the ACM, 1970.
            Bloom Filter 的原始论文。
            
- Peter Boncz, Thomas Neumann, Viktor Leis, “Adaptive
            Radix Trees”, 2013. 一种面向现代 CPU
            缓存层次设计的索引结构。
            
            

### 官方文档与源码

            
            
- RocksDB Wiki: Bloom Filter, https://github.com/facebook/rocksdb/wiki/RocksDB-Bloom-Filter
            
- RocksDB Wiki: Block Cache, https://github.com/facebook/rocksdb/wiki/Block-Cache
            
- RocksDB Wiki: Partitioned Index/Filters, https://github.com/facebook/rocksdb/wiki/Partitioned-Index-Filters
            
- RocksDB 源码（9.x）:
            `table/block_based/block_based_table_reader.cc`,
            `Get()` 路径的核心实现。
            
- MySQL 8.4 Reference Manual: InnoDB Buffer Pool, https://dev.mysql.com/doc/refman/8.4/en/innodb-buffer-pool.html
            
- MySQL 8.4 Reference Manual: EXPLAIN Output Format, https://dev.mysql.com/doc/refman/8.4/en/explain-output.html
            
- Apache Parquet Format Specification v2.6, https://parquet.apache.org/documentation/latest/
            
- ClickHouse Documentation: Data Skipping Indexes, https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-data_skipping-indexes
            
            

### 工具与 Benchmark

            
            
- `db_bench`：RocksDB
            自带的基准测试工具，源码位于
            `tools/db_bench_tool.cc`。
            
- `iostat`：Linux sysstat 包提供的 I/O
            统计工具。
            
- `bpftrace`：基于 eBPF
            的动态追踪工具，适合低开销的 I/O 追踪。
            
- `perf`：Linux
            性能分析工具，`perf trace` 可以替代
            `strace` 做低开销的系统调用追踪。
            
            
            

**上一篇**: 写入性能优化
            **下一篇**: 存储全链路延迟分析
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-09 · storage
                    

### 【存储工程】LSM-Tree 工程调优：三种放大的权衡

                    

LSM-Tree 的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过 MemTable 刷盘、再经过多次 Compaction 合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个 key 时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在 Co…
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。
                

                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】索引与跳数索引

                    

ClickHouse PRIMARY KEY 排序键稀疏索引语义、Data Skipping Index（minmax/set/bloom_filter）与 Mark Range 协同；对照 PostgreSQL B-Tree。24.x LTS。
                

                
                    

2025-09-10 · storage
                    

### 【存储工程】RocksDB 工程实践

                    

从 Column Family、Write Buffer、Block Cache、Compaction、Rate Limiter 到 Direct I/O 和监控，系统拆解 RocksDB 在生产环境中的关键配置与故障模式，并给出 SSD 场景下的配置模板和 db_bench 基准测试方法。