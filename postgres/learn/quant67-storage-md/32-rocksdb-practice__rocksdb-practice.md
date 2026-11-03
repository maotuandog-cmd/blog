# 【存储工程】RocksDB 工程实践

来源: https://quant67.com/post/storage/32-rocksdb-practice/rocksdb-practice.html
日期: 2025-09-10 |

---

RocksDB 是一个嵌入式键值存储引擎（Embedded Key-Value
            Store），由 Facebook 在 LevelDB 的基础上 fork
            并深度改造而来。它的底层数据结构是日志结构合并树（Log-Structured
            Merge-Tree,
            LSM-Tree），通过将随机写转化为顺序写来获得高写入吞吐量。自
            2012 年开源以来，RocksDB
            已经成为众多分布式系统的存储基座——TiKV、CockroachDB、YugabyteDB、Flink
            的状态后端、Kafka Streams
            的本地状态存储，都直接或间接依赖它。
            

但 RocksDB
            的默认配置面向通用场景，不可能直接满足生产需求。一个典型的
            RocksDB 实例有超过 200
            个可调参数，涵盖内存管理、压缩策略（Compaction）、I/O
            控制、缓存策略等多个维度。配置不当的后果是真实的：写停顿（Write
            Stall）会让上层服务超时，空间放大（Space
            Amplification）会撑爆磁盘，内存膨胀（Memory Bloat）会触发
            OOM。
            

本文不重复 LSM-Tree 的基础理论——那些内容在 上一篇
            已经覆盖。这里直接从 RocksDB 的工程视角切入，逐一拆解 Column
            Family 设计、Write Buffer 配置、Block Cache 调优、Compaction
            策略选择、Rate Limiter 写控制、Direct I/O
            交互、监控指标体系、常见故障模式，最终给出一份面向 SSD
            的生产配置模板和 `db_bench` 基准测试方法。
            
            

**版本说明** 本文基于 RocksDB
            9.x（2024-2025），部分 API 和行为在 6.x/7.x/8.x
            中略有差异，涉及版本差异的地方会单独标注。源码引用以
            `facebook/rocksdb` GitHub 仓库主分支为准。
            
            
            

## 一、RocksDB 架构概览

            

### 1.1 从 LevelDB 到
            RocksDB

            

LevelDB 是 Google 的 Jeff Dean 和 Sanjay Ghemawat 在 2011
            年开源的单线程 LSM-Tree
            引擎。它实现精巧但功能有限：单线程压缩（Compaction）、不支持列族（Column
            Family）、没有限速器（Rate
            Limiter）、不支持备份和快照导出。Facebook 在 2012 年 fork 了
            LevelDB，目标是让它能跑在 SSD
            上、支持多线程、承受社交网络的写入强度。这个 fork 就是
            RocksDB。
            

RocksDB 相对 LevelDB 的核心改进包括：
            
            
- 多线程压缩（Concurrent
            Compaction）：可以同时执行多个压缩任务，充分利用 SSD 的并行
            I/O 能力；
            
- 列族（Column
            Family）：在同一个数据库实例中支持多个独立的
            LSM-Tree，共享写前日志（Write-Ahead Log, WAL）；
            
- 可插拔的压缩策略：除了 LevelDB 的分层压缩（Leveled
            Compaction），还支持通用压缩（Universal
            Compaction）和先进先出压缩（FIFO Compaction）；
            
- Rate Limiter：限制压缩和刷盘（Flush）的 I/O
            带宽，避免后台任务抢占前台读写的 I/O 资源；
            
- Direct I/O 支持：绕过操作系统页缓存（Page Cache），由
            RocksDB 自己管理缓存；
            
- 内置统计与性能上下文（Perf
            Context）：提供几百个运行时指标，方便诊断性能问题。
            
            

### 1.2 整体架构

            

RocksDB 的数据路径可以分为写路径（Write
            Path）和读路径（Read Path）两条主线。
            

写路径的流程：
            
            
- 客户端调用 `Put(key, value)` 或
            `WriteBatch`；
            
- 数据先写入写前日志（WAL），保证持久性（Durability）；
            
- 数据同时写入活跃内存表（Active MemTable）；
            
- 当 MemTable 大小达到 `write_buffer_size`
            时，它变为不可变内存表（Immutable MemTable），一个新的
            Active MemTable 被创建；
            
- 后台刷盘线程（Flush Thread）将 Immutable MemTable
            刷到磁盘，生成一个 L0 层的有序字符串表（Sorted String Table,
            SST）文件；
            
- 后台压缩线程（Compaction Thread）将 SST
            文件从低层合并到高层，消除重复键和已删除的键。
            
            

读路径的流程：
            
            
- 先查活跃 MemTable；
            
- 再查所有 Immutable MemTable（从新到旧）；
            
- 再查 L0 层的所有 SST 文件（L0
            的文件键范围可能重叠，必须全部检查）；
            
- 最后按层查 L1、L2、……Ln 层的 SST
            文件（每层内部键范围不重叠，可以用二分查找定位文件）。
            
            

每个 SST 文件内部通过布隆过滤器（Bloom
            Filter）和索引块（Index
            Block）加速查找。如果布隆过滤器判定目标键不在该文件中，就可以跳过这个文件，避免一次磁盘
            I/O。
            
```
写路径：

  Client Put/Delete
        │
        ▼
  ┌──────────┐
  │   WAL    │  ← 顺序追加写，保证持久性
  └──────────┘
        │
        ▼
  ┌───────────────┐
  │ Active        │
  │ MemTable      │  ← 内存中的有序结构（默认 SkipList）
  └───────────────┘
        │  达到 write_buffer_size
        ▼
  ┌───────────────┐
  │ Immutable     │
  │ MemTable      │  ← 等待刷盘
  └───────────────┘
        │  Flush
        ▼
  ┌───────────────┐
  │ L0 SST Files  │  ← 键范围可能重叠
  └───────────────┘
        │  Compaction
        ▼
  ┌───────────────┐
  │ L1 SST Files  │  ← 每层内部键范围不重叠
  ├───────────────┤
  │ L2 SST Files  │
  ├───────────────┤
  │ ...           │
  └───────────────┘
```

            

### 1.3 设计目标与取舍

            

RocksDB 的设计目标可以概括为三个”优先”：
            
            
- **写吞吐量优先**：LSM-Tree
            将随机写转为顺序写，适合写多读少的工作负载；
            
- **空间效率优先**：通过压缩（Compression，注意与
            Compaction
            的区别——前者是数据压缩，后者是合并操作）和压缩操作（Compaction）减少磁盘占用；
            
- **可调性优先**：几乎每一个行为都暴露了配置参数，允许用户根据工作负载精细调整。
            
            

代价也很明确：
            
            
- 读放大（Read
            Amplification）：一次点查可能需要查多层，最坏情况下查 L0
            的所有文件加上每层一个文件；
            
- 写放大（Write
            Amplification）：一条数据在生命周期内会被多次 Compaction
            重写，写放大系数通常在 10 到 30 之间；
            
- 空间放大（Space Amplification）：Compaction
            过程中需要临时空间存放新旧文件，同一键的多个版本也会同时存在于不同层。
            
            

这三个放大系数之间存在根本性的权衡——不可能同时把三个都做到最优。这是后面选择
            Compaction 策略的核心依据。
            
            

## 二、Column Family 设计

            

### 2.1 Column Family 的本质

            

列族（Column Family）是 RocksDB
            中一个核心的逻辑隔离机制。每个 Column Family 拥有独立的
            LSM-Tree：独立的 MemTable、独立的 SST 文件、独立的
            Compaction 流程。但同一个数据库实例中的所有 Column Family
            共享同一份 WAL。
            

这种设计的动机来自两个实际需求：
            
            
- **不同数据类型需要不同的配置**：比如元数据（Metadata）需要快速点查，可以用较大的布隆过滤器和较小的
            Block Size；而用户数据（User
            Data）可能偏重范围扫描，适合较大的 Block Size
            和不同的压缩算法。
            
- **跨数据类型的原子写**：如果把不同数据类型放到不同的
            RocksDB 实例，就无法在一个 `WriteBatch`
            中原子地更新多种数据。Column Family
            让原子跨族写成为可能，因为它们共享 WAL。
            
            

### 2.2 默认 Column Family

            

每个 RocksDB 数据库至少有一个 Column Family，名为
            `"default"`。如果调用 `DB::Open()`
            时没有指定 Column Family，所有操作都落在
            `"default"` 上。
            
```
// 打开一个只使用 default Column Family 的数据库
rocksdb::DB* db;
rocksdb::Options options;
options.create_if_missing = true;
rocksdb::Status s = rocksdb::DB::Open(options, "/data/mydb", &db);
```

            

### 2.3 多 Column Family
            的创建与使用

            

创建和使用多个 Column Family 需要在
            `DB::Open()` 时声明所有 Column Family
            的描述符（Column Family Descriptor）：
            
```
// 多 Column Family 的打开方式
std::vector cf_descs;

// default 列族
rocksdb::ColumnFamilyOptions default_opts;
cf_descs.emplace_back(rocksdb::kDefaultColumnFamilyName, default_opts);

// metadata 列族：小 Block Size，高 Bloom Filter 位数
rocksdb::ColumnFamilyOptions meta_opts;
meta_opts.write_buffer_size = 16 * 1024 * 1024;  // 16MB
rocksdb::BlockBasedTableOptions meta_table_opts;
meta_table_opts.block_size = 4 * 1024;  // 4KB
meta_table_opts.filter_policy.reset(
    rocksdb::NewBloomFilterPolicy(15, false));
meta_opts.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(meta_table_opts));
cf_descs.emplace_back("metadata", meta_opts);

// data 列族：大 Block Size，适合范围扫描
rocksdb::ColumnFamilyOptions data_opts;
data_opts.write_buffer_size = 64 * 1024 * 1024;  // 64MB
rocksdb::BlockBasedTableOptions data_table_opts;
data_table_opts.block_size = 16 * 1024;  // 16KB
data_opts.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(data_table_opts));
cf_descs.emplace_back("data", data_opts);

std::vector handles;
rocksdb::DB* db;
rocksdb::DBOptions db_options;
db_options.create_if_missing = true;
db_options.create_missing_column_families = true;

rocksdb::Status s = rocksdb::DB::Open(
    db_options, "/data/mydb", cf_descs, &handles, &db);
```

            

打开之后，通过 `ColumnFamilyHandle`
            指定操作的目标列族：
            
```
// 写入不同列族
db->Put(rocksdb::WriteOptions(), handles[1],  // metadata
        "user:1001:name", "Alice");
db->Put(rocksdb::WriteOptions(), handles[2],  // data
        "user:1001:avatar", large_blob);

// 跨列族原子写
rocksdb::WriteBatch batch;
batch.Put(handles[1], "user:1001:status", "active");
batch.Put(handles[2], "user:1001:profile", profile_data);
db->Write(rocksdb::WriteOptions(), &batch);
```

            

### 2.4 配置独立性

            

每个 Column Family 可以独立配置以下参数：
            
            
            
            
            
            
            
            
            参数类别
            示例参数
            说明
            
            
            
            
            MemTable
            `write_buffer_size`、`max_write_buffer_number`
            写缓冲区大小和数量
            
            
            Compaction
            `compaction_style`、`level0_file_num_compaction_trigger`
            压缩策略和触发条件
            
            
            压缩算法
            `compression`、`bottommost_compression`
            各层的数据压缩算法
            
            
            布隆过滤器
            `filter_policy`
            过滤器类型和位数
            
            
            Block Size
            `block_size`
            SST 文件内数据块的大小
            
            
            合并操作符
            `merge_operator`
            自定义 Merge 语义
            
            
            
            

但以下参数是 DB 级别的，所有 Column Family 共享：
            
            
            
            参数
            说明
            
            
            
            
            `max_background_jobs`
            后台刷盘和压缩的总线程数
            
            
            `max_background_flushes`
            后台刷盘线程数上限
            
            
            `db_paths`
            数据库文件的存储路径
            
            
            `wal_dir`
            WAL 文件的存储路径
            
            
            `rate_limiter`
            I/O 限速器
            
            
            `statistics`
            统计信息收集器
            
            
            
            

### 2.5 Column Family
            的使用建议

            

**适合用 Column Family 的场景**：
            
            
- 同一数据库中有明确不同的数据类型（元数据 vs 用户数据 vs
            索引数据），需要不同的 Compaction 策略或压缩算法；
            
- 需要跨数据类型的原子写保证；
            
- 需要对不同数据类型独立监控和调优。
            
            

**不适合用 Column Family 的场景**：
            
            
- 数据之间没有原子写需求，且各自的访问模式差异不大——直接用独立的
            RocksDB 实例更简单，也能隔离故障；
            
- Column Family 数量过多（超过几十个）——每个 Column Family
            都会消耗 MemTable 内存，而且 WAL 的生命周期由最慢的 Column
            Family 决定，可能导致 WAL 文件堆积。
            
            

关于 WAL 的生命周期问题：WAL 只有在所有 Column Family 都
            flush 掉对应的 MemTable 之后才能被删除。如果某个 Column
            Family 的写入量很小，它的 MemTable 可能很久才会填满并触发
            flush，这会导致 WAL
            文件长时间无法回收，占用大量磁盘空间。解决方案是为写入量小的
            Column Family 设置较小的
            `write_buffer_size`，或者定期手动调用
            `FlushWAL()` 和 `Flush()`。
            
            

## 三、Write Buffer 与
            MemTable

            

### 3.1 写缓冲区的角色

            

写缓冲区（Write Buffer）是 RocksDB
            写路径中的内存缓冲层。每次 `Put` 或
            `Delete` 操作，数据先写入
            WAL，然后插入到当前活跃的 MemTable 中。MemTable
            是一个内存中的有序数据结构，它的角色就是把大量的随机写攒成一批，再一次性刷到磁盘上变成有序的
            SST 文件。
            

MemTable 的大小和数量直接影响三个指标：
            
            
- **写入延迟**：如果 MemTable 太大，每次
            flush 的数据量大，flush
            时间长，可能阻塞后续写入；如果太小，flush
            过于频繁，也会消耗过多的 I/O 带宽。
            
- **内存占用**：活跃 MemTable + 所有不可变
            MemTable 的总大小是 RocksDB 内存开销的重要组成部分。
            
- **L0 文件数量**：每次 flush 生成一个 L0
            文件，flush 越频繁，L0 文件堆积越快，可能触发 L0
            写停顿。
            
            

### 3.2 核心参数

            

#### write_buffer_size

            

单个 MemTable 的大小上限，默认 64MB。当活跃 MemTable
            的数据量达到这个阈值时，它会被切换为不可变
            MemTable，一个新的活跃 MemTable 被创建。
            
```
options.write_buffer_size = 128 * 1024 * 1024;  // 128MB
```

            

增大 `write_buffer_size` 的效果：
            
            
- flush 频率降低，L0 文件堆积速度减慢；
            
- 每个 SST 文件更大，有利于减少文件数量和元数据开销；
            
- 内存占用增加。
            
            

通常建议根据写入吞吐量和可用内存来调整。对于写入密集型场景，128MB
            到 256MB 是常见的配置。
            

#### max_write_buffer_number

            

允许同时存在的 MemTable
            数量上限（包括活跃和不可变的），默认为 2。当不可变 MemTable
            的数量达到 `max_write_buffer_number - 1`
            时，新的写入会被阻塞（Write Stall），直到至少一个不可变
            MemTable 被 flush 完成。
            
```
options.max_write_buffer_number = 4;
```

            

增大这个参数可以容忍更多的 flush 延迟——即使 flush
            线程暂时忙不过来，写入仍然可以继续往新的 MemTable
            里写。但代价是更多的内存占用。一个 Column Family 的 MemTable
            内存上限约为：
            
```
MemTable 内存上限 ≈ write_buffer_size × max_write_buffer_number
```

            

#### min_write_buffer_number_to_merge

            

flush 之前会合并（Merge）的不可变 MemTable
            的最小数量，默认为 1。设为 2 意味着至少攒够 2 个不可变
            MemTable 才会 flush，这样可以在 flush
            之前把重复键合并掉，减少写入磁盘的数据量。
            
```
options.min_write_buffer_number_to_merge = 2;
```

            

适用场景：写入负载中有大量对同一键的重复更新（比如计数器场景），合并后可以显著减少
            SST 文件大小。不适合的场景：键很少重复，合并没有收益但增加了
            flush 延迟。
            

### 3.3 MemTable
            数据结构选择

            

RocksDB 支持多种 MemTable 实现，通过
            `memtable_factory` 参数配置。
            

#### SkipList（默认）

            

跳表（SkipList）是默认的 MemTable
            实现。它支持高效的有序插入（O(log
            n)）和有序遍历，对点查和范围扫描都友好。并发写入通过内部的无锁跳表（Lock-Free
            SkipList）实现。
            
```
options.memtable_factory.reset(
    new rocksdb::SkipListFactory());
```

            

优势：通用性好，读写性能平衡，并发安全。绝大多数场景应该使用跳表。
            

#### HashSkipList

            

哈希跳表（HashSkipList）在跳表外面套了一层哈希表。写入时先用键的前缀做哈希定位到一个桶（Bucket），桶内部仍然是一个跳表。
            
```
options.memtable_factory.reset(
    rocksdb::NewHashSkipListRepFactory(
        1024 * 1024  // bucket_count
    ));
options.prefix_extractor.reset(
    rocksdb::NewFixedPrefixTransform(8));
```

            

适用场景：前缀查询（Prefix
            Seek）占主导的工作负载——比如键的前 8 个字节是用户
            ID，查询模式是”给定用户
            ID，遍历该用户的所有数据”。这种情况下，哈希前缀可以跳过不相关的桶，加速前缀扫描。
            

限制：全序遍历（`SeekToFirst` +
            `Next`）的效率不如纯跳表；必须配合
            `prefix_extractor` 使用。
            

#### Vector

            

向量（Vector）MemTable
            把写入的键值对按插入顺序追加到一个动态数组中，flush
            前再做一次排序。
            
```
options.memtable_factory.reset(
    new rocksdb::VectorRepFactory());
```

            

适用场景：批量导入（Bulk
            Load）——所有数据先大量写入，再一次性
            flush。此时不需要插入过程中的有序性，追加写比跳表的插入更快。
            

限制：不支持并发写入；点查需要线性扫描，不适合读写混合的场景。只建议在
            bulk load 阶段临时使用。
            

### 3.4 MemTable
            内存与全局控制

            

当一个 RocksDB 实例有多个 Column Family 时，每个 Column
            Family 独立管理自己的 MemTable。如果不加控制，所有 Column
            Family 的 MemTable 内存总和可能远超预期。
            

RocksDB 提供了 `WriteBufferManager`
            来做全局内存控制：
            
```
// 限制所有 Column Family 的 MemTable 总内存为 2GB
std::shared_ptr wbm(
    new rocksdb::WriteBufferManager(
        2ULL * 1024 * 1024 * 1024  // 2GB
    ));
db_options.write_buffer_manager = wbm;
```

            

当总 MemTable
            内存接近限制时，`WriteBufferManager` 会触发最老的
            MemTable 进行 flush，即使单个 Column Family 的 MemTable
            还没满。这对于 Column Family 数量较多的场景尤其重要。
            

### 3.5 MemTable
            参数调优思路

            

调优的核心原则是平衡内存、写入延迟和 L0
            文件堆积三个维度。
            
            
- **先估算可用内存**：`MemTable 总内存 = write_buffer_size × max_write_buffer_number × Column Family 数量`，这个值不能超过系统可用内存的一个合理比例（通常不超过
            25% 到 30%）。
            
- **再看写入吞吐量**：如果写入速率是
            100MB/s，`write_buffer_size` 设为
            64MB，那么大约每 0.64 秒就会 flush 一次。每秒近 2 个 L0
            文件的产生速率可能导致 L0 快速堆积。增大
            `write_buffer_size` 到 256MB 可以把 flush
            间隔拉长到约 2.5 秒。
            
- **最后看 flush 延迟容忍度**：如果 SSD
            的顺序写速率是 500MB/s，flush 一个 256MB 的 MemTable 需要约
            0.5 秒。在这 0.5 秒内需要有足够的可用 MemTable（由
            `max_write_buffer_number`
            控制）来继续接收写入。
            
            
            

## 四、Block Cache 配置

            

### 4.1 Block Cache 的作用

            

块缓存（Block Cache）是 RocksDB 在内存中缓存 SST
            文件数据块（Data Block）和索引块（Index
            Block）的组件。它的作用是减少磁盘读取次数，加速读路径。
            

每个 SST 文件由多个固定大小的数据块组成（默认
            4KB），每个数据块内部存储连续的键值对。当 RocksDB
            需要读取某个键时，它先通过索引块定位到对应的数据块，然后从
            Block Cache
            中查找该数据块。如果命中，直接从内存读取；如果未命中，从磁盘读取数据块并放入
            Block Cache。
            

Block Cache 是 RocksDB
            内存消耗的另一个大头。在读密集型场景中，Block Cache 通常占据
            RocksDB 总内存的 50% 到 70%。
            

### 4.2 缓存类型

            

#### LRUCache（默认）

            

最近最少使用（Least Recently Used, LRU）缓存是默认的
            Block Cache 实现。它按最近访问时间淘汰数据块。
            
```
rocksdb::BlockBasedTableOptions table_options;
table_options.block_cache = rocksdb::NewLRUCache(
    4ULL * 1024 * 1024 * 1024,  // 4GB 容量
    6,                           // num_shard_bits, 2^6 = 64 个分片
    false,                       // strict_capacity_limit
    0.75                         // high_pri_pool_ratio
);
```

            

参数说明：
            
            
- **容量**：Block Cache
            的总大小，根据可用内存设定；
            
- **num_shard_bits**：将 Cache 分成 2^n
            个分片（Shard），每个分片有独立的锁，减少并发争用。经验值：16GB
            以下用 6（64 个分片），16GB 以上用 8（256 个分片）；
            
- **strict_capacity_limit**：设为
            `true` 时严格限制容量，插入新块可能失败；设为
            `false`（默认）时允许短暂超出容量；
            
- **high_pri_pool_ratio**：高优先级池（High
            Priority
            Pool）的比例。索引块和过滤器块可以被标记为高优先级，不容易被普通数据块淘汰。
            
            

#### HyperClockCache

            

从 RocksDB 8.x 开始，`HyperClockCache` 成为
            `ClockCache` 的替代。它基于时钟算法（Clock
            Algorithm）实现近似 LRU 的淘汰策略，锁争用比 LRU Cache
            更少，在高并发读场景下吞吐量更高。
            
```
rocksdb::HyperClockCacheOptions hcc_opts(
    4ULL * 1024 * 1024 * 1024,  // capacity
    16 * 1024                    // estimated_entry_charge（估计的平均块大小）
);
table_options.block_cache = hcc_opts.MakeSharedCache();
```

            

HyperClockCache 的适用场景：读并发非常高（数万 QPS
            以上），且 LRU Cache 的锁争用成为瓶颈。对于大多数场景，LRU
            Cache 已经足够，不需要切换。
            

### 4.3 缓存内容控制

            

Block Cache 默认缓存数据块。但索引块（Index
            Block）和布隆过滤器块（Filter Block）也可以放入 Block
            Cache，通过以下参数控制：
            
```
table_options.cache_index_and_filter_blocks = true;
table_options.cache_index_and_filter_blocks_with_high_priority = true;
table_options.pin_l0_filter_and_index_blocks_in_cache = true;
```

            
            
- `cache_index_and_filter_blocks`：将索引块和过滤器块也放入
            Block Cache，而不是独立占用内存。这样可以让 Block Cache
            统一管理内存，避免内存使用量不可预测。
            
- `cache_index_and_filter_blocks_with_high_priority`：将索引和过滤器块标记为高优先级，减少被数据块淘汰的概率。
            
- `pin_l0_filter_and_index_blocks_in_cache`：将
            L0 层文件的索引和过滤器块钉（Pin）在缓存中不淘汰。L0
            是读路径上必须检查的层，钉住它们可以避免反复从磁盘加载。
            
            

在生产环境中，强烈建议打开这三个选项。如果不把索引和过滤器放入
            Block Cache，它们会在 SST 文件打开时加载到堆内存中，随着 SST
            文件数量增长，内存使用量不可控。
            

### 4.4 压缩缓存（Secondary
            Cache）

            

从 RocksDB 7.x 开始，引入了二级缓存（Secondary
            Cache）的概念。当数据块从 Block
            Cache（一级缓存）中被淘汰时，可以先压缩后放入二级缓存，而不是直接丢弃。后续访问时先解压再放回一级缓存。
            
```
rocksdb::CompressedSecondaryCacheOptions sec_opts;
sec_opts.capacity = 8ULL * 1024 * 1024 * 1024;  // 8GB
sec_opts.compression_type = rocksdb::kLZ4Compression;

auto secondary_cache = rocksdb::NewCompressedSecondaryCache(sec_opts);

rocksdb::LRUCacheOptions primary_opts;
primary_opts.capacity = 4ULL * 1024 * 1024 * 1024;  // 4GB
primary_opts.secondary_cache = secondary_cache;

table_options.block_cache = primary_opts.MakeSharedCache();
```

            

这种两级缓存架构的优势：用同样的内存量，缓存更多的数据。假设压缩比为
            2:1，4GB 一级缓存 + 8GB 二级缓存 = 12GB
            内存，实际可缓存的数据量约为 4 + 16 =
            20GB（二级缓存存储的是压缩数据）。代价是二级缓存命中时有一次解压开销。
            

### 4.5 Block Cache
            大小的确定

            

Block Cache 的大小没有万能公式。以下是一些经验准则：
            
            
- **估算工作集大小**：如果 SST 文件总大小是
            500GB，但热点数据只有 50GB，那么 Block Cache 设为 50GB
            左右可以覆盖大部分热点读取。
            
- **与 MemTable
            和操作系统的关系**：`Block Cache + MemTable 总量 + 操作系统保留 ≤ 物理内存`。典型的分配比例是：Block
            Cache 占 40% 到 50%，MemTable 占 15% 到
            25%，其余留给操作系统和 RocksDB 其他组件。
            
- **监控缓存命中率**：通过
            `rocksdb.block.cache.hit` 和
            `rocksdb.block.cache.miss`
            统计指标计算命中率。如果命中率长期低于
            85%，且内存还有余量，可以考虑增大 Block Cache。
            
            

### 4.6 Block Size 的选择

            

SST 文件中数据块的大小由 `block_size`
            参数控制，默认 4KB。
            
```
table_options.block_size = 16 * 1024;  // 16KB
```

            

Block Size 的权衡：
            
            
            
            
            
            
            
            
            Block Size
            优势
            劣势
            
            
            
            
            小（4KB）
            点查精度高，缓存粒度细
            索引块更大，SST 文件元数据开销更高
            
            
            大（16-64KB）
            范围扫描效率高，索引块更小
            点查可能读入不需要的数据，缓存利用率下降
            
            
            
            

经验选择：点查为主的场景用 4KB 到
            8KB，范围扫描为主的场景用 16KB 到 32KB。
            
            

## 五、Compaction 策略选择

            

### 5.1 为什么 Compaction
            是核心问题

            

Compaction 是 LSM-Tree 引擎的心脏。它负责合并和清理 SST
            文件：消除已删除的键、合并同一键的多个版本、维护各层的有序性。Compaction
            做得好不好，直接决定了读放大、写放大和空间放大这三个核心指标。
            

RocksDB 提供三种 Compaction
            策略，适用于不同的工作负载。选错了策略，要么写放大飙升导致
            SSD
            寿命缩短，要么空间放大爆炸导致磁盘写满，要么读放大过高导致尾延迟不可控。
            

### 5.2 Leveled
            Compaction（默认）

            

分层压缩（Leveled Compaction）是 RocksDB
            的默认策略，也是最常用的策略。它把 SST
            文件组织成多个层（Level），L0
            以下的每一层内部的文件键范围不重叠。
            

工作流程：
            
            
- MemTable flush 生成 L0 文件，L0
            文件之间键范围可能重叠；
            
- 当 L0 文件数量达到
            `level0_file_num_compaction_trigger`（默认
            4）时，触发 L0 到 L1 的 Compaction；
            
- L1 到 Ln 的 Compaction
            按比例触发：当某一层的总大小超过该层的大小上限时，选择该层中一个文件与下一层有键范围重叠的文件进行合并。
            
            

关键参数：
            
```
options.compaction_style = rocksdb::kCompactionStyleLevel;
options.level0_file_num_compaction_trigger = 4;
options.max_bytes_for_level_base = 256 * 1024 * 1024;       // L1 的大小上限，256MB
options.max_bytes_for_level_multiplier = 10;                 // 每层大小是上一层的 10 倍
options.target_file_size_base = 64 * 1024 * 1024;           // 单个 SST 文件的目标大小，64MB
options.num_levels = 7;                                      // 总层数
```

            

大小模型：
            
```
L1: 256MB
L2: 2.56GB     （256MB × 10）
L3: 25.6GB     （2.56GB × 10）
L4: 256GB      （25.6GB × 10）
L5: 2.56TB     （256GB × 10）
L6: 25.6TB     （2.56TB × 10）
```

            

特性：
            
            
- **写放大**：较高，约 10 到 30
            倍。一条数据在从 L0
            到最底层的过程中，每一层都可能被重写一次。层间大小比越大，每次
            Compaction 涉及的重叠文件越多。
            
- **空间放大**：较低，约 1.1 到 1.3
            倍。因为每层内部键范围不重叠，同一键最多在相邻两层各存一份。
            
- **读放大**：较低。每层最多检查一个文件（通过二分查找），加上
            L0 的所有文件。
            
            

适用场景：读写混合、空间敏感、长期运行的通用负载。这是大多数生产环境的默认选择。
            

### 5.3 Universal Compaction

            

通用压缩（Universal
            Compaction）又称大小分层压缩（Size-Tiered
            Compaction），其策略是按文件的大小和数量来触发
            Compaction。所有 SST
            文件按时间排序，选择相邻的一批文件合并成更大的文件。
            
```
options.compaction_style = rocksdb::kCompactionStyleUniversal;
rocksdb::CompactionOptionsUniversal universal_opts;
universal_opts.size_ratio = 1;                          // 触发 Compaction 的大小比
universal_opts.min_merge_width = 2;                     // 最少合并文件数
universal_opts.max_merge_width = UINT_MAX;              // 最多合并文件数
universal_opts.max_size_amplification_percent = 200;    // 空间放大上限
universal_opts.compression_size_percent = -1;           // 按比例压缩
options.compaction_options_universal = universal_opts;
```

            

特性：
            
            
- **写放大**：较低，约 2 到 10 倍。Compaction
            的频率更低，每次合并的范围更大但总次数少。
            
- **空间放大**：较高，可能达到 2
            倍甚至更高。因为同一键可能同时存在于多个未合并的文件中。
            
- **读放大**：可能较高。需要检查多个未合并的文件。
            
            

适用场景：
            
            
- 写入密集型、对写放大敏感的工作负载（比如 SSD
            寿命敏感的场景）；
            
- 时间序列数据（Time-Series
            Data），数据按时间顺序写入，旧数据很少被更新；
            
- 能容忍较高空间放大的环境。
            
            

### 5.4 FIFO Compaction

            

先进先出压缩（FIFO
            Compaction）是最简单的策略：不做真正的合并，只是按文件的创建时间删除最老的文件。当
            SST 文件的总大小超过 `max_table_files_size`
            时，最老的文件被直接删除。
            
```
options.compaction_style = rocksdb::kCompactionStyleFIFO;
rocksdb::CompactionOptionsFIFO fifo_opts;
fifo_opts.max_table_files_size = 100ULL * 1024 * 1024 * 1024;  // 100GB
options.compaction_options_fifo = fifo_opts;
```

            

特性：
            
            
- **写放大**：接近 1——数据写一次就不再被
            Compaction 重写；
            
- **空间放大**：取决于 TTL 和数据量；
            
- **读放大**：可能很高，因为没有合并操作，同一键可能分散在多个文件中。
            
            

适用场景：
            
            
- 纯时间序列、日志类数据，数据只追加不更新，有明确的
            TTL（生存时间）；
            
- 作为缓存层使用，数据过期后直接丢弃。
            
            

不适合有更新或删除操作的场景，因为 FIFO
            不会合并旧版本的键。
            

### 5.5 三种策略对比

            
            
            
            维度
            Leveled
            Universal
            FIFO
            
            
            
            
            写放大
            高（10-30x）
            低（2-10x）
            极低（约 1x）
            
            
            空间放大
            低（1.1-1.3x）
            中高（可达 2x+）
            取决于 TTL
            
            
            读放大
            低
            中
            高
            
            
            适用场景
            通用负载
            写密集型
            日志/缓存
            
            
            实现复杂度
            中
            高
            低
            
            
            SSD 友好度
            一般
            好
            极好
            
            
            
            

### 5.6 Compaction
            的并发配置

            

Compaction 是 CPU 和 I/O 密集型操作。RocksDB
            支持多线程并发 Compaction：
            
```
db_options.max_background_jobs = 8;       // 后台任务总线程数（含 flush 和 compaction）
db_options.max_background_flushes = 2;    // 其中 flush 线程数上限
// compaction 线程数 ≈ max_background_jobs - max_background_flushes
```

            

在 SSD 上，I/O 并行能力强，可以适当增大
            `max_background_jobs`（8 到 16）。在 HDD 上，磁盘
            I/O 是瓶颈，过多的并发 Compaction 反而会加剧随机
            I/O，通常设为 2 到 4。
            

### 5.7 Compaction
            优先级与子压缩

            

RocksDB 支持 Compaction
            优先级设置，控制先合并哪些文件：
            
```
options.compaction_pri = rocksdb::kMinOverlappingRatio;
```

            

可选值：
            
            
- `kByCompensatedSize`：优先选择”补偿大小”（包含删除标记权重）最大的文件，有利于快速回收空间；
            
- `kOldestLargestSeqFirst`：优先选择序列号最老的文件，有利于减少旧数据的读放大；
            
- `kOldestSmallestSeqFirst`：优先选择序列号最老且最小的文件；
            
- `kMinOverlappingRatio`：优先选择与下一层重叠比最小的文件，可以最小化每次
            Compaction 的写入量。
            
            

`kMinOverlappingRatio`
            在大多数场景下表现最好，因为它每次 Compaction
            写入的数据量最少，降低了写放大。
            

子压缩（Sub-Compaction）允许一次 Compaction
            任务在内部并行处理：
            
```
db_options.max_subcompactions = 4;
```

            

对于大文件的 Compaction（比如 L0 到 L1
            的全量合并），子压缩可以显著加速。代价是更高的 CPU
            和内存消耗。
            

### 5.8 各层压缩算法

            

SST
            文件的数据可以用不同的压缩算法，不同层可以配置不同的算法：
            
```
options.compression_per_level = {
    rocksdb::kNoCompression,       // L0: 不压缩，减少 flush 延迟
    rocksdb::kNoCompression,       // L1: 不压缩
    rocksdb::kLZ4Compression,      // L2: LZ4，速度快
    rocksdb::kLZ4Compression,      // L3: LZ4
    rocksdb::kLZ4Compression,      // L4: LZ4
    rocksdb::kZSTD,                // L5: ZSTD，压缩比高
    rocksdb::kZSTD                 // L6: ZSTD
};
options.bottommost_compression = rocksdb::kZSTD;
options.bottommost_compression_opts.level = 3;  // ZSTD 压缩级别
```

            

设计思路：上层（L0、L1）的数据生命周期短、被读取和
            Compaction 的频率高，使用无压缩或轻量压缩减少 CPU
            开销；底层（L5、L6）数据量大、被读取频率低，使用高压缩比算法节省磁盘空间。
            
            

## 六、Rate Limiter
            与写控制

            

### 6.1 为什么需要限速

            

RocksDB 的后台操作——flush 和 Compaction——会产生大量的磁盘
            I/O。如果不加控制，后台 I/O
            会和前台的读写请求争抢磁盘带宽，导致前台请求的延迟飙升。这在
            SSD 上尤其明显：虽然 SSD
            的总带宽很高，但写入操作会触发内部的垃圾回收（Garbage
            Collection, GC），当 SSD 内部 GC 和 RocksDB Compaction
            同时发生时，前台读延迟可能从微秒级飙到毫秒级。
            

Rate Limiter 的作用就是限制后台 I/O
            的总带宽，给前台请求留出足够的 I/O 余量。
            

### 6.2 Rate Limiter 配置

            
```
db_options.rate_limiter.reset(rocksdb::NewGenericRateLimiter(
    200 * 1024 * 1024,           // rate_bytes_per_sec: 200MB/s
    100 * 1000,                  // refill_period_us: 100ms 周期
    10,                          // fairness: 高优先级请求的公平性因子
    rocksdb::RateLimiter::Mode::kWritesOnly,  // 只限制写
    true                         // auto_tuned: 自动调整速率
));
```

            

参数说明：
            
            
- **rate_bytes_per_sec**：后台 I/O
            的总带宽上限。设定这个值需要了解磁盘的总带宽——如果 SSD
            的持续写带宽是 500MB/s，可以把 Rate Limiter 设为 200MB/s 到
            300MB/s，留 200MB/s 到 300MB/s 给前台操作。
            
- **refill_period_us**：令牌桶（Token
            Bucket）的补充周期，默认 100ms。更短的周期意味着更平滑的 I/O
            分配，但 CPU 开销略高。
            
- **fairness**：控制高优先级请求（flush）和低优先级请求（Compaction）之间的带宽分配。默认值
            10 意味着大约每 10 次带宽分配中，有 1
            次无条件给高优先级请求。
            
- **auto_tuned**：设为 `true`
            时，RocksDB 会根据当前的写入负载和 Compaction
            压力自动调整限速上限。当 Compaction
            跟不上写入速度、面临写停顿风险时，会自动提高限速；当压力减小时，恢复到设定值。
            
            

### 6.3 写停顿（Write Stall）

            

写停顿是 RocksDB
            中最常见、对上层应用影响最大的性能问题。当后台的 flush 和
            Compaction 跟不上前台的写入速度时，RocksDB
            会主动降低甚至完全停止接受写入请求，以避免内存和磁盘空间耗尽。
            

写停顿分为两个阶段：减速（Slowdown）和停止（Stop）。
            

#### L0
            文件堆积引发的写停顿

            

L0 层的文件数量是触发写停顿的最常见原因。
            
```
options.level0_slowdown_writes_trigger = 20;   // L0 文件达到 20 个时开始减速
options.level0_stop_writes_trigger = 36;       // L0 文件达到 36 个时完全停止写入
```

            

L0 文件堆积的原因通常是 Compaction 速度跟不上 flush
            速度。解决方案包括：
            
            
- 增大 `write_buffer_size`，减少 flush
            频率；
            
- 增大 `max_background_jobs`，增加 Compaction
            并发度；
            
- 调整 Rate Limiter，给 Compaction 更多的 I/O 带宽；
            
- 增大
            `level0_file_num_compaction_trigger`，但这会增加读放大。
            
            

#### MemTable
            堆积引发的写停顿

            

当不可变 MemTable 的数量达到
            `max_write_buffer_number`
            时，新的写入被阻塞：
            
```
options.max_write_buffer_number = 4;
```

            

这意味着最多允许 3 个不可变 MemTable 等待 flush（第 4
            个是活跃的）。如果 flush 线程繁忙或被 Rate Limiter
            限制，就会出现 MemTable 堆积。
            

#### Pending
            Compaction Bytes 引发的写停顿

            

当等待 Compaction 的数据量（Pending Compaction
            Bytes）超过阈值时，也会触发写停顿：
            
```
options.soft_pending_compaction_bytes_limit =
    64ULL * 1024 * 1024 * 1024;  // 64GB 时开始减速
options.hard_pending_compaction_bytes_limit =
    256ULL * 1024 * 1024 * 1024; // 256GB 时完全停止
```

            

### 6.4 诊断写停顿

            

RocksDB 提供了多个途径来诊断写停顿：
            

**日志文件**：写停顿发生时，RocksDB
            会在日志中输出告警，包括停顿原因和持续时间。
            

**统计指标**：
            
```
rocksdb.stall.micros                    # 写停顿的总微秒数
rocksdb.l0.slowdown.micros              # L0 减速的总微秒数
rocksdb.memtable.compaction.micros      # MemTable 堆积导致的停顿微秒数
rocksdb.l0.num.files.stall.micros       # L0 文件数达到 stop trigger 的停顿微秒数
rocksdb.pending.compaction.bytes        # 等待 Compaction 的数据量
```

            

**DB Properties**：
            
```
std::string value;
db->GetProperty("rocksdb.is-write-stopped", &value);   // 是否正在写停止
db->GetProperty("rocksdb.actual-delayed-write-rate", &value);  // 当前的减速写入速率
db->GetProperty("rocksdb.num-running-compactions", &value);    // 正在运行的 Compaction 数量
db->GetProperty("rocksdb.num-running-flushes", &value);        // 正在运行的 Flush 数量
```

            

### 6.5
            写停顿的系统性解决思路

            

写停顿本质上是一个生产-消费不平衡问题：前台的写入速度（生产者）超过了后台的
            flush 和 Compaction 速度（消费者）。解决思路有三条：
            
            
- **降低生产速率**：在应用层做写入限速或批量合并，减少写入
            RocksDB 的数据量；
            
- **提高消费能力**：增加 Compaction
            线程数、提高 Rate Limiter 限速、使用更快的存储介质；
            
- **扩大缓冲区**：增大
            `write_buffer_size` 和
            `max_write_buffer_number`，增大
            `level0_slowdown_writes_trigger` 和
            `level0_stop_writes_trigger`——但这只是延缓问题，如果生产-消费速率长期不匹配，缓冲区再大也会被填满。
            
            
            

## 七、Direct I/O
            与操作系统交互

            

### 7.1 Page Cache
            的双缓存问题

            

默认情况下，RocksDB 的读写操作经过操作系统的页缓存（Page
            Cache）。这意味着数据在内存中存了两份：一份在 RocksDB 的
            Block Cache 里，一份在操作系统的 Page Cache
            里。这种双缓存（Double Buffering）浪费内存，而且 Page Cache
            的 LRU 策略对 RocksDB 的访问模式不友好——Compaction
            读取的大量冷数据会污染 Page
            Cache，把真正的热点数据挤出去。
            

### 7.2 Direct I/O 配置

            

Direct I/O 绕过操作系统的 Page Cache，让 RocksDB
            直接与块设备交互。数据只缓存在 Block Cache
            中，消除了双缓存问题。
            
```
// 读取使用 Direct I/O
db_options.use_direct_reads = true;

// flush 和 Compaction 的写入使用 Direct I/O
db_options.use_direct_io_for_flush_and_compaction = true;
```

            

两个参数可以独立控制：
            
            
- `use_direct_reads`：对 SST 文件的读取使用
            Direct I/O。打开后，所有 SST 文件的读取不经过 Page
            Cache，完全依赖 Block Cache。
            
- `use_direct_io_for_flush_and_compaction`：flush
            和 Compaction 写入 SST 文件时使用 Direct
            I/O。打开后，新写入的 SST 文件不会进入 Page Cache。
            
            

### 7.3 Direct I/O
            的要求与限制

            

使用 Direct I/O 有以下前提条件：
            
            
- **文件系统支持**：ext4、XFS 支持 Direct
            I/O；tmpfs 不支持。
            
- **对齐要求**：Direct I/O
            要求读写的偏移量和缓冲区大小必须对齐到文件系统的块大小（通常
            512 字节或 4KB）。RocksDB 内部会处理对齐，但需要确保
            `sst_file_manager` 配置正确。
            
- **Block Cache 必须足够大**：关闭 Page Cache
            意味着所有的缓存都依赖 Block Cache。如果 Block Cache
            太小，缓存命中率会大幅下降，读性能退化严重。
            
- **WAL 不受影响**：Direct I/O 的配置只影响
            SST 文件的读写，WAL 仍然通过普通 I/O 写入，仍然经过 Page
            Cache。
            
            

### 7.4 什么时候使用 Direct
            I/O

            

**适合使用的场景**：
            
            
- 内存紧张，不想让 Page Cache 和 Block Cache
            重复缓存同一份数据；
            
- SST 文件总大小远大于内存，Page Cache
            命中率本来就很低；
            
- Compaction 的 I/O 模式是顺序读写大文件，Page Cache
            的随机淘汰策略没有优势。
            
            

**不适合使用的场景**：
            
            
- Block Cache 不够大，无法覆盖热点数据——这时候关闭 Page
            Cache 等于自废一臂；
            
- 使用的文件系统不支持 Direct I/O；
            
- 其他进程也需要读取 RocksDB 的 SST
            文件（比如备份工具），Direct I/O 会导致这些进程也无法利用
            Page Cache。
            
            

### 7.5 I/O
            调度与操作系统调优

            

除了 Direct I/O，以下操作系统级别的配置也会影响 RocksDB
            的 I/O 性能：
            

**I/O 调度器**：对于 SSD，推荐使用
            `none`（也叫 `noop`）或
            `mq-deadline` 调度器，避免不必要的 I/O
            合并和排序。
            
```
echo none > /sys/block/nvme0n1/queue/scheduler
```

            

**预读（Readahead）**：Direct I/O
            模式下，操作系统的预读机制不生效。RocksDB
            有自己的预读控制参数：
            
```
options.compaction_readahead_size = 2 * 1024 * 1024;  // Compaction 读取预读 2MB
```

            

这个参数在 Direct I/O 模式下尤其重要——没有 Page Cache
            的预读，Compaction 的顺序读会退化为大量小块随机读。设为 2MB
            可以让 RocksDB 在 Compaction 时一次性读取 2MB 数据，充分利用
            SSD 的顺序读带宽。
            

**文件系统挂载选项**：对于 ext4，建议使用
            `noatime`
            选项挂载，避免每次读取都更新文件的访问时间元数据。
            
```
mount -o noatime /dev/nvme0n1p1 /data
```

            
            

## 八、Statistics 与
            Perf Context 监控

            

### 8.1 统计信息（Statistics）

            

RocksDB
            内置了一套统计信息收集机制，可以记录几百个运行时指标。开启方式：
            
```
db_options.statistics = rocksdb::CreateDBStatistics();
db_options.statistics->set_stats_level(
    rocksdb::StatsLevel::kExceptDetailedTimers);
```

            

`StatsLevel` 有四个级别：
            
            
            
            级别
            说明
            开销
            
            
            
            
            `kDisableAll`
            关闭所有统计
            无
            
            
            `kExceptTimers`
            收集计数器，不收集计时器
            极低
            
            
            `kExceptDetailedTimers`
            收集计数器和基本计时器
            低
            
            
            `kAll`
            收集所有指标
            中等
            
            
            
            

生产环境建议使用
            `kExceptDetailedTimers`——它能覆盖绝大多数诊断需求，同时性能开销可以忽略不计。
            

### 8.2 关键统计指标

            

以下是生产环境中必须监控的核心指标：
            

#### 写路径指标

            
```
rocksdb.db.write.micros          # 写入操作的延迟分布（直方图）
rocksdb.db.write.stall           # 写停顿次数
rocksdb.stall.micros             # 写停顿总时间
rocksdb.bytes.written            # 写入的字节总数
rocksdb.compact.write.bytes      # Compaction 写入的字节数
rocksdb.flush.write.bytes        # Flush 写入的字节数
```

            

写放大的计算方式：
            
```
写放大 = (rocksdb.compact.write.bytes + rocksdb.flush.write.bytes) / rocksdb.bytes.written
```

            

#### 读路径指标

            
```
rocksdb.db.get.micros            # Get 操作的延迟分布
rocksdb.bloom.filter.useful      # 布隆过滤器成功过滤的次数
rocksdb.bloom.filter.full.positive  # 布隆过滤器误判（假阳性）次数
rocksdb.block.cache.hit          # Block Cache 命中次数
rocksdb.block.cache.miss         # Block Cache 未命中次数
rocksdb.memtable.hit             # MemTable 命中次数
```

            

缓存命中率的计算：
            
```
Block Cache 命中率 = hit / (hit + miss)
```

            

如果 Block Cache 命中率低于
            85%，需要考虑增大缓存或检查是否有大范围扫描在污染缓存。
            

#### Compaction 指标

            
```
rocksdb.compaction.times.micros       # Compaction 总时间
rocksdb.compaction.cpu.micros         # Compaction 的 CPU 时间
rocksdb.num.running.compactions       # 正在运行的 Compaction 数量
rocksdb.pending.compaction.bytes      # 等待 Compaction 的数据量
rocksdb.num.files.at.level{N}         # 各层的 SST 文件数量
```

            

`pending.compaction.bytes` 是最重要的
            Compaction 健康指标。如果这个值持续增长，说明 Compaction
            跟不上写入速度，最终会触发写停顿。
            

### 8.3 Perf Context
            与 I/O Stats Context

            

`PerfContext` 和 `IOStatsContext`
            是线程局部（Thread-Local）的性能计数器，可以精确到单次操作的级别，用于诊断具体的慢查询。
            
```
// 启用 Perf Context
rocksdb::SetPerfLevel(rocksdb::PerfLevel::kEnableTimeExceptForMutex);
rocksdb::get_perf_context()->Reset();
rocksdb::get_iostats_context()->Reset();

// 执行操作
std::string value;
rocksdb::Status s = db->Get(rocksdb::ReadOptions(), "mykey", &value);

// 读取 Perf Context
rocksdb::PerfContext* perf = rocksdb::get_perf_context();
uint64_t block_read_time = perf->block_read_time;
uint64_t block_read_count = perf->block_read_count;
uint64_t get_from_memtable_time = perf->get_from_memtable_time;
uint64_t seek_on_memtable_time = perf->seek_on_memtable_time;
uint64_t bloom_filter_useful = perf->bloom_sst_hit_count;

// 读取 IO Stats Context
rocksdb::IOStatsContext* io = rocksdb::get_iostats_context();
uint64_t bytes_read = io->bytes_read;
uint64_t bytes_written = io->bytes_written;
```

            

`PerfContext` 的关键字段：
            
            
            
            字段
            说明
            
            
            
            
            `user_key_comparison_count`
            键比较次数
            
            
            `block_read_count`
            从磁盘读取的 Block 数量
            
            
            `block_read_time`
            Block 读取的总时间（纳秒）
            
            
            `block_cache_hit_count`
            Block Cache 命中次数
            
            
            `get_from_memtable_count`
            在 MemTable 中查找的次数
            
            
            `seek_on_memtable_count`
            在 MemTable 中 Seek 的次数
            
            
            `bloom_sst_hit_count`
            布隆过滤器命中（跳过 SST 文件）的次数
            
            
            `bloom_sst_miss_count`
            布隆过滤器未命中（需要读 SST 文件）的次数
            
            
            
            

使用场景：当某个 Get 操作延迟异常高时，通过
            `PerfContext` 可以定位是 Block Cache
            未命中导致了磁盘读取，还是布隆过滤器误判导致了不必要的 SST
            文件访问，还是 MemTable 层级太多导致了过多的内存查找。
            

### 8.4 DB Properties

            

除了 Statistics 和 PerfContext，RocksDB 还通过
            `GetProperty()`
            接口暴露了大量的运行时状态。这些属性可以用于定期巡检和异常检测。
            
```
std::string val;

// 各层的文件数和大小
db->GetProperty("rocksdb.levelstats", &val);

// Compaction 状态
db->GetProperty("rocksdb.compaction-pending", &val);
db->GetProperty("rocksdb.num-running-compactions", &val);

// 内存使用
db->GetProperty("rocksdb.estimate-table-readers-mem", &val);
db->GetProperty("rocksdb.cur-size-all-mem-tables", &val);
db->GetProperty("rocksdb.block-cache-usage", &val);

// 写停顿相关
db->GetProperty("rocksdb.is-write-stopped", &val);
db->GetProperty("rocksdb.actual-delayed-write-rate", &val);
```

            

生产环境建议每 10 到 30
            秒采集一次这些属性，发送到监控系统。
            

### 8.5 构建监控仪表盘

            

一个最小可用的 RocksDB 监控仪表盘应该包含以下面板：
            
            
- **写入速率与写停顿**：`rocksdb.bytes.written`（写入速率）和
            `rocksdb.stall.micros`（写停顿时间）；
            
- **Block Cache
            命中率**：`hit / (hit + miss)`，趋势图；
            
- **各层文件数与大小**：特别关注 L0
            文件数是否接近
            `level0_slowdown_writes_trigger`；
            
- **Pending Compaction
            Bytes**：趋势图，持续上升是写停顿的前兆；
            
- **Compaction
            I/O**：`compaction.read.bytes` 和
            `compaction.write.bytes`，用于估算写放大；
            
- **内存使用**：Block Cache 使用量 + MemTable
            使用量 + Table Reader 内存。
            
            
            

## 九、常见故障模式

            

### 9.1 写停顿（Write Stall）

            

这是最常见的故障模式，在第六节已经详细讨论。这里补充几个典型的触发场景。
            

**场景一：突发写入峰值**
            

应用在某个时间段（比如整点定时任务）的写入量突然翻倍。MemTable
            快速填满，flush 速度跟不上，L0 文件堆积，触发 L0
            写停顿。
            

应对：
            
            
- 在应用层做写入削峰（比如打散定时任务的执行时间）；
            
- 预留 `max_write_buffer_number` 的余量；
            
- 增大 `level0_slowdown_writes_trigger` 到 30
            到 40。
            
            

**场景二：Compaction 线程被占满**
            

多个 Column Family 同时需要 Compaction，但
            `max_background_jobs`
            设得太小，线程全部被占用，部分 Column Family 的 Compaction
            排不上队。
            

应对：
            
            
- 增大 `max_background_jobs`；
            
- 减少 Column Family 数量；
            
- 为不同 Column Family 设置不同的 Compaction
            触发阈值，错峰执行。
            
            

**场景三：Rate Limiter 过于激进**
            

Rate Limiter 的限速值设得太低，Compaction 的 I/O
            带宽不足，导致 Compaction 速度远低于写入速度。
            

应对：
            
            
- 提高 Rate Limiter 的限速值；
            
- 开启 `auto_tuned`，让 RocksDB
            在写停顿风险增大时自动提高限速。
            
            

### 9.2 空间放大爆炸

            

空间放大（Space
            Amplification）是指磁盘上的数据总量与实际有效数据量的比值。正常情况下
            Leveled Compaction 的空间放大在 1.1 到 1.3
            之间，但在以下场景会急剧恶化。
            

**场景一：大量删除操作后空间未释放**
            

在 LSM-Tree
            中，删除操作不会立即回收空间，而是写入一个墓碑标记（Tombstone）。只有当包含原始数据和墓碑标记的文件都被
            Compaction
            到最底层后，空间才会真正释放。如果删除操作集中在某些键范围，而
            Compaction 还没有覆盖到这些范围，空间放大就会飙升。
            

应对：
            
            
- 手动触发目标键范围的
            Compaction：`CompactRange()`；
            
- 使用 `DeleteFilesInRange()`
            直接删除整个键范围对应的 SST
            文件（谨慎使用，可能破坏快照一致性）。
            
            

**场景二：Universal Compaction
            下的空间堆积**
            

Universal Compaction
            允许同一键的多个版本同时存在于多个未合并的文件中。如果写入速率持续高于
            Compaction 速率，未合并文件越积越多，空间放大可能达到 2
            倍甚至更高。
            

应对：
            
            
- 降低 `max_size_amplification_percent`，让
            Compaction 更积极地合并文件；
            
- 切换到 Leveled Compaction。
            
            

**场景三：Compaction
            落后导致临时空间占用**
            

Compaction
            过程中需要同时保留旧文件和新文件，直到新文件写完并通过校验后才能删除旧文件。如果
            Compaction 操作的文件很大（比如底层的一次全量
            Compaction），临时空间占用可能很高。
            

应对：
            
            
- 监控磁盘可用空间，保留至少 10% 到 20% 的余量；
            
- 使用 `SstFileManager` 限制 Compaction
            的最大临时空间使用。
            
            

### 9.3 内存膨胀

            

RocksDB
            的内存使用由多个组件组成，任何一个失控都可能导致进程
            OOM。
            

**内存组成**：
            
```
总内存 ≈ Block Cache
        + MemTable（所有 Column Family）
        + Table Readers（索引块 + 过滤器块，如果没放入 Block Cache）
        + Block Cache 的元数据开销
        + 迭代器（Iterator）持有的内存
        + Compaction 的输入/输出缓冲区
```

            

**常见的内存膨胀原因**：
            
            
- **索引和过滤器没有放入 Block Cache**：如果
            `cache_index_and_filter_blocks` 为
            `false`（默认），每个 SST
            文件的索引块和过滤器块会在文件打开时加载到堆内存中。SST
            文件数量越多，这部分内存越大，且完全不受 Block Cache
            大小限制。
            
- **长时间持有迭代器（Iterator）**：`Iterator`
            会持有对应时刻的数据快照，阻止相关 SST 文件被删除和相关
            MemTable 被释放。如果应用层创建了 `Iterator`
            但长时间不关闭，内存会持续增长。
            
- **Column Family 过多**：每个 Column Family
            至少消耗 `write_buffer_size` 的内存（一个活跃
            MemTable）。50 个 Column Family × 64MB = 3.2GB，仅 MemTable
            就占这么多。
            
- **Block Cache
            的碎片化**：`jemalloc` 或
            `tcmalloc` 的内存分配器碎片可能导致 Block Cache
            的实际 RSS 远大于逻辑容量。
            
            

**内存控制清单**：
            
            
- 开启
            `cache_index_and_filter_blocks = true`；
            
- 使用 `WriteBufferManager` 限制 MemTable
            总内存；
            
- 限制 `Iterator`
            的持有时间，及时关闭不再使用的迭代器；
            
- 使用 `jemalloc`
            并开启其统计功能，监控内存碎片率；
            
- 定期通过 `GetProperty()`
            检查各组件的内存使用量。
            
            

### 9.4 Compaction 债务

            

压缩债务（Compaction Debt）是指等待 Compaction
            但尚未执行的数据量。适当的 Compaction
            债务是正常的——Compaction 不需要实时跟上写入。但如果
            Compaction 债务持续增长不收敛，最终会导致三个后果：
            
            
- 写停顿——Pending Compaction Bytes 超过阈值；
            
- 读性能退化——未合并的层和文件越多，每次读取需要检查的文件越多；
            
- 磁盘空间耗尽——空间放大失控。
            
            

**判断 Compaction 债务是否健康的指标**：
            
```
稳态条件：Compaction 写入速率 ≥ Flush 写入速率 × (写放大系数 - 1)
```

            

如果在一段时间窗口内（比如 10
            分钟），`pending.compaction.bytes`
            的趋势是下降或稳定的，说明 Compaction
            能跟上；如果持续上升，就需要干预。
            

**干预手段**：
            
            
- 短期：手动触发
            Compaction（`CompactRange()`），紧急释放空间；
            
- 中期：增加 Compaction 线程数和 I/O 带宽配额；
            
- 长期：评估是否需要切换 Compaction 策略或分库分表。
            
            
            

## 十、生产配置模板与
            db_bench

            

### 10.1 SSD 生产配置模板

            

以下是一份面向 SSD 的生产配置模板。这份配置假设：
            
            
- 存储介质：NVMe SSD，持续写带宽 500MB/s 以上；
            
- 内存：64GB，其中 40GB 分配给 RocksDB；
            
- 数据量：1TB 量级；
            
- 工作负载：读写混合，写入占 30%，读取占 70%。
            
            
```
// === DB 级别参数 ===
rocksdb::DBOptions db_options;

// 后台任务
db_options.max_background_jobs = 8;
db_options.max_background_flushes = 2;
db_options.max_subcompactions = 4;

// WAL
db_options.wal_dir = "/data/rocksdb/wal";    // WAL 放在独立路径（可选）
db_options.WAL_ttl_seconds = 0;
db_options.WAL_size_limit_MB = 0;
db_options.max_total_wal_size = 2ULL * 1024 * 1024 * 1024;  // 2GB

// Direct I/O
db_options.use_direct_reads = true;
db_options.use_direct_io_for_flush_and_compaction = true;

// Rate Limiter
db_options.rate_limiter.reset(rocksdb::NewGenericRateLimiter(
    256 * 1024 * 1024,   // 256MB/s
    100 * 1000,          // 100ms refill
    10,
    rocksdb::RateLimiter::Mode::kWritesOnly,
    true                 // auto_tuned
));

// Statistics
db_options.statistics = rocksdb::CreateDBStatistics();
db_options.statistics->set_stats_level(
    rocksdb::StatsLevel::kExceptDetailedTimers);

// 全局 MemTable 内存限制
auto write_buffer_manager = std::make_shared(
    8ULL * 1024 * 1024 * 1024   // 8GB
);
db_options.write_buffer_manager = write_buffer_manager;

// 错误处理
db_options.paranoid_checks = true;
db_options.info_log_level = rocksdb::InfoLogLevel::INFO_LEVEL;

// === Column Family 级别参数 ===
rocksdb::ColumnFamilyOptions cf_options;

// MemTable
cf_options.write_buffer_size = 256 * 1024 * 1024;          // 256MB
cf_options.max_write_buffer_number = 4;
cf_options.min_write_buffer_number_to_merge = 1;

// Compaction
cf_options.compaction_style = rocksdb::kCompactionStyleLevel;
cf_options.level0_file_num_compaction_trigger = 4;
cf_options.level0_slowdown_writes_trigger = 20;
cf_options.level0_stop_writes_trigger = 36;
cf_options.max_bytes_for_level_base = 1024 * 1024 * 1024;  // 1GB
cf_options.max_bytes_for_level_multiplier = 10;
cf_options.target_file_size_base = 64 * 1024 * 1024;       // 64MB
cf_options.num_levels = 7;
cf_options.compaction_pri = rocksdb::kMinOverlappingRatio;

// 压缩
cf_options.compression_per_level = {
    rocksdb::kNoCompression,       // L0
    rocksdb::kNoCompression,       // L1
    rocksdb::kLZ4Compression,      // L2
    rocksdb::kLZ4Compression,      // L3
    rocksdb::kLZ4Compression,      // L4
    rocksdb::kZSTD,                // L5
    rocksdb::kZSTD                 // L6
};
cf_options.bottommost_compression = rocksdb::kZSTD;
cf_options.bottommost_compression_opts.level = 3;

// Pending Compaction Bytes 限制
cf_options.soft_pending_compaction_bytes_limit =
    64ULL * 1024 * 1024 * 1024;   // 64GB
cf_options.hard_pending_compaction_bytes_limit =
    256ULL * 1024 * 1024 * 1024;  // 256GB

// Compaction 读取预读
cf_options.compaction_readahead_size = 2 * 1024 * 1024;    // 2MB

// === Table 级别参数（BlockBasedTableOptions） ===
rocksdb::BlockBasedTableOptions table_options;

// Block Cache: 24GB
table_options.block_cache = rocksdb::NewLRUCache(
    24ULL * 1024 * 1024 * 1024,  // 24GB
    8                             // 256 个分片
);

// Block Size
table_options.block_size = 16 * 1024;  // 16KB

// 索引和过滤器放入 Block Cache
table_options.cache_index_and_filter_blocks = true;
table_options.cache_index_and_filter_blocks_with_high_priority = true;
table_options.pin_l0_filter_and_index_blocks_in_cache = true;

// 布隆过滤器
table_options.filter_policy.reset(
    rocksdb::NewBloomFilterPolicy(10, false));  // 10 bits/key，全过滤器

// 分区索引（Partitioned Index）
table_options.index_type =
    rocksdb::BlockBasedTableOptions::kTwoLevelIndexSearch;
table_options.metadata_block_size = 4096;
table_options.partition_filters = true;

cf_options.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(table_options));
```

            

### 10.2 内存分配验证

            

配置完成后，验证内存分配是否合理：
            
```
Block Cache:          24GB
MemTable 上限:         8GB（WriteBufferManager 限制）
Table Readers:        ～2GB（索引和过滤器在 Block Cache 内，这里主要是 Compaction 缓冲）
操作系统保留:          ～6GB
─────────────────────────
总计:                 ～40GB（64GB 机器的 62.5%）
```

            

留给操作系统的 24GB 看起来偏多，但 Direct I/O 模式下 Page
            Cache 几乎不被使用，这部分内存实际上是空闲的。如果使用
            cgroup 限制 RocksDB 进程的内存，可以设为 42GB 左右，留 2GB
            的安全余量。
            

### 10.3 配置参数优先级

            

实际调优时，不要一次改所有参数。按以下优先级逐步调整：
            
            
- **Block Cache
            大小**——对读性能影响最大；
            
- **write_buffer_size 和
            max_write_buffer_number**——对写性能和内存影响最大；
            
- **Compaction
            策略和层级大小**——对写放大和空间放大影响最大；
            
- **Rate
            Limiter**——对前台延迟的稳定性影响最大；
            
- **Direct
            I/O**——对内存利用效率影响最大；
            
- **布隆过滤器和 Block
            Size**——对特定查询模式的优化。
            
            

每次只改一个参数，用 `db_bench`
            或线上灰度验证效果，再改下一个。
            

### 10.4 db_bench 基准测试

            

`db_bench` 是 RocksDB 自带的基准测试工具，编译
            RocksDB
            时会自动生成。它可以模拟多种工作负载，用于评估配置变更的效果。
            

#### 编译 db_bench

            
```
git clone https://github.com/facebook/rocksdb.git
cd rocksdb
make db_bench -j$(nproc) DISABLE_JEMALLOC=1
```

            

#### 写入测试

            
```
./db_bench \
  --benchmarks=fillrandom \
  --db=/data/rocksdb_bench \
  --wal_dir=/data/rocksdb_bench/wal \
  --num=100000000 \
  --key_size=16 \
  --value_size=256 \
  --write_buffer_size=268435456 \
  --max_write_buffer_number=4 \
  --target_file_size_base=67108864 \
  --max_bytes_for_level_base=1073741824 \
  --max_bytes_for_level_multiplier=10 \
  --max_background_jobs=8 \
  --compression_type=lz4 \
  --use_direct_io_for_flush_and_compaction=true \
  --threads=8 \
  --statistics=true \
  --report_interval_seconds=10
```

            

参数说明：
            
            
- `fillrandom`：随机键写入，模拟真实写入模式；
            
- `num`：总操作数，1 亿次；
            
- `key_size` /
            `value_size`：键和值的大小，根据实际场景调整；
            
- `report_interval_seconds`：每 10
            秒输出一次中间结果。
            
            

#### 读取测试

            
```
./db_bench \
  --benchmarks=readrandom \
  --db=/data/rocksdb_bench \
  --use_existing_db=true \
  --num=10000000 \
  --key_size=16 \
  --value_size=256 \
  --cache_size=4294967296 \
  --use_direct_reads=true \
  --bloom_bits=10 \
  --threads=16 \
  --statistics=true \
  --report_interval_seconds=10
```

            

#### 读写混合测试

            
```
./db_bench \
  --benchmarks=readwhilewriting \
  --db=/data/rocksdb_bench \
  --use_existing_db=true \
  --num=50000000 \
  --key_size=16 \
  --value_size=256 \
  --write_buffer_size=268435456 \
  --max_write_buffer_number=4 \
  --cache_size=4294967296 \
  --use_direct_reads=true \
  --use_direct_io_for_flush_and_compaction=true \
  --bloom_bits=10 \
  --threads=16 \
  --benchmark_write_rate_limit=10000000 \
  --statistics=true \
  --report_interval_seconds=10
```

            

`readwhilewriting`
            模式会启动一个写线程持续写入，其余线程执行随机读。`benchmark_write_rate_limit`
            控制写入速率（字节/秒），这里设为 10MB/s。
            

#### Overwrite 测试

            
```
./db_bench \
  --benchmarks=overwrite \
  --db=/data/rocksdb_bench \
  --use_existing_db=true \
  --num=100000000 \
  --key_size=16 \
  --value_size=256 \
  --write_buffer_size=268435456 \
  --max_write_buffer_number=4 \
  --max_background_jobs=8 \
  --compression_type=lz4 \
  --use_direct_io_for_flush_and_compaction=true \
  --threads=8 \
  --duration=600 \
  --statistics=true \
  --report_interval_seconds=10
```

            

`overwrite`
            会对已有的键进行随机覆盖写入，更贴近实际的更新工作负载。`duration`
            控制测试持续时间（秒），设为 10 分钟可以观察到 Compaction
            在稳态下的行为。
            

### 10.5 db_bench 结果解读

            

`db_bench`
            完成后会输出类似以下的统计摘要（以下为示意输出，非真实数据）：
            
```
fillrandom :       3.842 micros/op 260282 ops/sec;   71.2 MB/s
Cumulative writes: 100M writes
Cumulative WAL: 100M writes
Stalls(count):    5 level0_slowdown, 0 level0_numfiles,
                  0 memtable_compaction, 0 leveln_slowdown
```

            

关注的核心指标：
            
            
            
            指标
            含义
            关注点
            
            
            
            
            `micros/op`
            每次操作的平均延迟
            越低越好，关注是否有毛刺
            
            
            `ops/sec`
            每秒操作数
            吞吐量指标
            
            
            `MB/s`
            每秒写入量
            与磁盘带宽对比
            
            
            Stalls
            写停顿统计
            理想情况下全部为 0
            
            
            
            

配合
            `--statistics=true`，测试结束后还会输出完整的统计信息，包括
            Block Cache 命中率、布隆过滤器有效率、各层文件数等。
            

### 10.6 从 db_bench 到生产

            

`db_bench`
            的结果与生产环境的性能会有差异，主要原因包括：
            
            
- **键分布不同**：`db_bench`
            默认使用均匀分布的随机键，生产环境的键分布通常有热点（Skewed
            Distribution）；
            
- **无应用层开销**：`db_bench`
            直接调用 RocksDB 的 C++
            API，没有网络传输、序列化、事务协调等开销；
            
- **单实例 vs 多实例**：生产环境可能运行多个
            RocksDB 实例，共享 CPU 和 I/O 资源。
            
            

因此 `db_bench`
            的结果应该作为”上限参考”而非”性能承诺”。生产环境的实际性能通常是
            `db_bench` 结果的 50% 到
            70%。正式上线前，建议用实际的工作负载做灰度测试。
            
            

## 参考资料

            

### 官方文档与 Wiki

            
            
- 

RocksDB GitHub Wiki, https://github.com/facebook/rocksdb/wiki.
            覆盖了所有配置参数、调优指南和内部实现说明。
            
- 

RocksDB Tuning Guide, https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide.
            官方的调优指南，按场景分类。
            
- 

RocksDB Setup Options and Basic Tuning, https://github.com/facebook/rocksdb/wiki/Setup-Options-and-Basic-Tuning.
            基本配置和参数说明。
            
            

### 源码

            
            
- 

`facebook/rocksdb`,
            `db/db_impl/db_impl_write.cc`——写路径的核心实现，包括
            WriteBatch 处理、WAL 写入、MemTable 插入。
            
- 

`facebook/rocksdb`,
            `db/compaction/`——Compaction 的各种策略实现，包括
            `leveled_compaction_picker.cc`、`universal_compaction_picker.cc`、`fifo_compaction_picker.cc`。
            
- 

`facebook/rocksdb`,
            `cache/lru_cache.cc` 和
            `cache/clock_cache.cc`——LRU Cache 和 Clock Cache
            的实现。
            
- 

`facebook/rocksdb`,
            `util/rate_limiter.cc`——Rate Limiter
            的令牌桶实现。
            
            

### 论文与设计文档

            
            
- 

P. O’Neil, E. Cheng, D. Gawlick, E. O’Neil, “The
            Log-Structured Merge-Tree (LSM-Tree),” *Acta
            Informatica*, vol. 33, no. 4, pp. 351-385, 1996.
            LSM-Tree 的原始论文。
            
- 

S. Dong, M. Callaghan, L. Galanis, D. Borthakur, T.
            Savor, M. Strum, “Optimizing Space Amplification in
            RocksDB,” *CIDR*, 2017. RocksDB
            团队关于空间放大优化的论文。
            
- 

N. Dayan, M. Athanassoulis, S. Idreos, “Monkey:
            Optimal Navigable Key-Value Store,” *SIGMOD*, 2017.
            关于 LSM-Tree 布隆过滤器内存分配优化的论文。
            
            

### 工具

            
            
- 

`db_bench`，RocksDB
            自带的基准测试工具，编译后位于 `build/`
            或项目根目录。
            
- 

`ldb`，RocksDB
            自带的命令行管理工具，可以查看 SST 文件内容、MANIFEST
            信息、WAL 记录。
            
            
            

**上一篇**: LSM-Tree
            调优：从理论到参数 **下一篇**: LMDB 与内存映射
            I/O
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】小文件与 Compaction

                    

拆解 lakehouse 小文件的根因（频繁提交、流式、过细分区），以及 bin-pack、sort/z-order/clustering、rewrite manifests、expire snapshots、remove orphan files 这套治理操作；讲清 Puffin 中 Theta NDV sketch 对查询 planning 的作用，附 PyIceberg 真实实验对比 compaction 前后文件数与 planning 耗时。
                

                
                    

2025-10-16 · storage
                    

### 【存储工程】读取性能优化

                    

深入分析存储读取性能优化——索引设计、Bloom Filter 调优、块缓存、压缩的 CPU-I/O 权衡、预读策略与读放大测量
                

                
                    

2025-09-08 · storage
                    

### 【存储工程】Bitcask 与日志结构哈希表

                    

在存储引擎（Storage Engine）的设计谱系中，Bitcask 占据着一个独特而优雅的位置： 它用最简单的数据结构——哈希表（Hash Table）与追加日志（Append-Only Log）—— 组合出了一个在特定工作负载下性能极其出色的键值存储引擎。 本文将从核心思想出发，逐层拆解 Bitcask 的架构、…
                

                
                    

2025-09-09 · storage
                    

### 【存储工程】LSM-Tree 工程调优：三种放大的权衡

                    

LSM-Tree 的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过 MemTable 刷盘、再经过多次 Compaction 合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个 key 时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在 Co…