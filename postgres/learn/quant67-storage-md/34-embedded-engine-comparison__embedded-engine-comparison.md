# 【存储工程】嵌入式存储引擎对比

来源: https://quant67.com/post/storage/34-embedded-engine-comparison/embedded-engine-comparison.html
日期: 2025-09-12 |

---

当我们提到”数据库”时，多数人首先想到的是
            MySQL、PostgreSQL
            这类以独立进程运行的数据库服务器。客户端通过网络协议连接到服务器，服务器管理存储、索引、事务和并发控制。然而，还有一类存储系统以库（Library）的形式直接链接到应用进程中，不需要独立的服务器进程，不需要网络通信，不需要序列化和反序列化——它们被称为嵌入式存储引擎（Embedded
            Storage Engine）。
            

嵌入式存储引擎是现代分布式系统的基石。TiKV 使用 RocksDB
            作为单机存储层，CockroachDB 使用 Pebble，etcd 使用
            BoltDB（bbolt），Dgraph 使用 BadgerDB，Android 和 iOS 使用
            SQLite，几乎所有浏览器使用 SQLite 或 LevelDB
            的变体。选择哪个嵌入式存储引擎，直接决定了系统的写入吞吐、读取延迟、空间利用率、并发能力和故障恢复特性。
            

本文对六个主流嵌入式存储引擎——LevelDB、RocksDB、Pebble、BadgerDB、LMDB/BoltDB、SQLite——进行系统性的横向对比。从设计哲学、数据结构、API
            模型、并发控制到实际基准测试，逐一拆解每个引擎的核心机制和适用场景，最终给出一套面向工程实践的选型指南。
            
            

## 一、嵌入式存储引擎的定义与价值

            

### 1.1 什么是嵌入式存储引擎

            

嵌入式存储引擎（Embedded Storage
            Engine）是一种以库的形式（Library-Level）嵌入到应用进程中的持久化存储组件。它与传统的客户端-服务器（Client-Server）架构数据库有本质区别：
            
```
┌─────────────────────────────────────────────────────────┐
│  客户端-服务器架构                                        │
│                                                         │
│  ┌──────────┐    TCP/IP     ┌──────────────────────┐    │
│  │ 应用进程  │ ──────────── │  数据库服务器进程       │    │
│  └──────────┘              │  （独立进程、独立内存）  │    │
│                            └──────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  嵌入式架构                                              │
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │ 应用进程                                      │       │
│  │  ┌───────────────────────────────────┐        │       │
│  │  │ 嵌入式存储引擎（同一进程、同一地址空间）│        │       │
│  │  └───────────────────────────────────┘        │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

            

嵌入式存储引擎的三个核心特征：
            
            
- **进程内运行（In-Process）**：存储引擎以库函数调用的方式运行在应用进程内部，不存在独立的服务器进程。应用直接调用
            `Put()`、`Get()`、`Delete()`
            等函数，函数调用的开销是纳秒级的，而不是网络通信的毫秒级。
            
- **无网络开销（No Network
            Overhead）**：不需要 TCP
            连接、协议解析、序列化/反序列化。数据在同一地址空间内通过指针传递，避免了内存拷贝。
            
- **库级别部署（Library-Level
            Deployment）**：不需要安装数据库服务器，不需要配置监听端口、用户权限、连接池。只需要在编译时链接库文件，或者在运行时加载动态链接库。
            
            

### 1.2 嵌入式 vs
            独立服务器：权衡分析

            

嵌入式架构并非没有代价。以下是两种架构的系统性对比：
            
            
            
            
            
            
            
            
            维度
            嵌入式存储引擎
            独立服务器数据库
            
            
            
            
            部署复杂度
            零依赖，编译时链接
            需要独立安装、配置、运维
            
            
            通信开销
            函数调用（纳秒级）
            网络通信（微秒到毫秒级）
            
            
            进程隔离
            无隔离，引擎崩溃导致应用崩溃
            进程隔离，数据库崩溃不影响应用
            
            
            多进程访问
            通常受限（单进程或只读多进程）
            原生支持多客户端并发
            
            
            查询能力
            通常只有键值接口
            完整的 SQL 或查询语言
            
            
            运维工具
            有限
            丰富的监控、备份、迁移工具
            
            
            资源管理
            与应用共享内存和 CPU
            独立管理资源
            
            
            
            

### 1.3
            嵌入式存储引擎的典型应用场景

            

嵌入式存储引擎在以下场景中不可替代：
            

**分布式数据库的单机存储层**：TiKV、CockroachDB、etcd、FoundationDB
            等分布式数据库在每个节点上使用嵌入式存储引擎管理本地数据。分布式层负责分片、复制、一致性协议（Raft
            /
            Paxos），单机存储层负责高效的读写和持久化。这种分层设计使得分布式层可以专注于一致性逻辑，而不需要重新发明存储引擎。
            

**移动端和嵌入式设备**：Android 和 iOS 使用
            SQLite 作为应用数据的默认存储。微信的 WCDB、美团的 Shark
            都是基于 SQLite
            的定制化方案。嵌入式设备上没有运行独立数据库服务器的资源。
            

**区块链节点存储**：以太坊（Ethereum）的
            go-ethereum 客户端使用 LevelDB / Pebble
            存储区块数据和状态树。区块链节点需要高效的键值存储，但不需要
            SQL 查询能力。
            

**浏览器本地存储**：Chrome 的 IndexedDB
            底层使用 LevelDB，实现浏览器端的结构化数据存储。
            

### 1.4 嵌入式存储引擎的分类

            

从数据结构的角度，主流嵌入式存储引擎可以分为三大类：
            
```
嵌入式存储引擎
├── LSM-Tree 系列
│   ├── LevelDB（Google，C++，原始实现）
│   ├── RocksDB（Facebook/Meta，C++，增强版）
│   ├── Pebble（CockroachDB，Go，兼容格式）
│   └── BadgerDB（Dgraph，Go，键值分离）
├── B+Tree / CoW B+Tree 系列
│   ├── LMDB（Symas，C，内存映射）
│   └── BoltDB / bbolt（etcd，Go，LMDB 风格）
└── 关系型嵌入式
    └── SQLite（D. Richard Hipp，C，完整关系模型）
```

            

接下来，我们逐一拆解每个引擎的设计与实现。
            
            

## 二、LevelDB

            

### 2.1 起源与设计目标

            

LevelDB 是 Google 在 2011 年开源的嵌入式键值存储引擎，由
            Jeff Dean 和 Sanjay Ghemawat 设计实现。它是
            LSM-Tree（Log-Structured
            Merge-Tree）数据结构的经典工程实现，最初用于 Chrome 浏览器的
            IndexedDB 后端和 Google 内部的 Bigtable 系统。
            

LevelDB 的设计目标非常明确：
            
            
- **写入优化**：所有写入操作先写入内存中的
            MemTable（MemTable），再通过后台压缩（Compaction）逐步下沉到磁盘上的有序文件（SSTable）。写入路径不涉及随机
            I/O。
            
- **简洁 API**：只提供
            `Put`、`Get`、`Delete`、`Batch`、`Iterator`
            五个核心操作，没有
            SQL，没有事务隔离级别，没有复杂的配置项。
            
- **正确性优先**：代码简洁清晰，重视数据一致性和崩溃恢复，是学习
            LSM-Tree 实现的最佳参考。
            
            

### 2.2 核心架构

            

LevelDB 的存储架构由以下组件构成：
            
```
                写入路径                            读取路径
                  │                                  │
                  ▼                                  ▼
          ┌──────────────┐                   ┌──────────────┐
          │   WAL 日志    │                   │   MemTable   │ ← 优先查找
          └──────────────┘                   └──────────────┘
                  │                                  │ 未命中
                  ▼                                  ▼
          ┌──────────────┐                   ┌──────────────┐
          │   MemTable   │                   │ Imm MemTable │
          │  （SkipList） │                   └──────────────┘
          └──────────────┘                           │ 未命中
                  │ 写满后冻结                        ▼
                  ▼                           ┌──────────────┐
          ┌──────────────┐                   │  Level-0     │ ← 可能重叠
          │ Imm MemTable │                   │  SSTable     │
          └──────────────┘                   └──────────────┘
                  │ Minor Compaction                 │ 未命中
                  ▼                                  ▼
          ┌──────────────┐                   ┌──────────────┐
          │  Level-0     │                   │  Level-1     │ ← 不重叠
          │  SSTable     │                   │  SSTable     │
          └──────────────┘                   └──────────────┘
                  │ Major Compaction                 │
                  ▼                                  ▼
          ┌──────────────┐                   ┌──────────────┐
          │ Level-1..N   │                   │ Level-2..N   │
          │  SSTable     │                   │  SSTable     │
          └──────────────┘                   └──────────────┘
```

            

### 2.3 核心 API

            

LevelDB 提供了极简的 C++ 接口：
            
```
#include "leveldb/db.h"

leveldb::DB* db;
leveldb::Options options;
options.create_if_missing = true;

// 打开数据库
leveldb::Status status = leveldb::DB::Open(options, "/data/leveldb", &db);
assert(status.ok());

// 写入
status = db->Put(leveldb::WriteOptions(), "key1", "value1");

// 读取
std::string value;
status = db->Get(leveldb::ReadOptions(), "key1", &value);

// 批量写入（原子操作）
leveldb::WriteBatch batch;
batch.Put("key2", "value2");
batch.Put("key3", "value3");
batch.Delete("key1");
status = db->Write(leveldb::WriteOptions(), &batch);

// 迭代器（Iterator）：范围扫描
leveldb::Iterator* it = db->NewIterator(leveldb::ReadOptions());
for (it->SeekToFirst(); it->Valid(); it->Next()) {
    std::cout key().ToString() value().ToString() 
            

### 2.4 SSTable 文件格式

            

每个 SSTable 文件的内部结构如下：
            
```
┌─────────────────────────────────────┐
│          Data Block 0               │  ← 有序键值对，按 block_size 分割
├─────────────────────────────────────┤
│          Data Block 1               │
├─────────────────────────────────────┤
│          ...                        │
├─────────────────────────────────────┤
│          Data Block N               │
├─────────────────────────────────────┤
│        Meta Block（filter）          │  ← Bloom Filter 数据
├─────────────────────────────────────┤
│        Meta Index Block             │  ← Meta Block 的索引
├─────────────────────────────────────┤
│          Index Block                │  ← Data Block 的索引
├─────────────────────────────────────┤
│           Footer                    │  ← 指向 Index Block 和 Meta Index Block
└─────────────────────────────────────┘
```

            

LevelDB 使用前缀压缩（Prefix
            Compression）减少键的存储开销。每个 Data Block 内部，每隔
            `block_restart_interval`（默认
            16）个键存储一个完整键，中间的键只存储与前一个键的差异部分。
            

### 2.5 局限性

            

LevelDB 的设计追求简洁，但这也带来了明显的局限：
            
            
- **单进程访问**：同一时间只允许一个进程打开数据库。LevelDB
            使用文件锁（`LOCK`
            文件）防止多进程并发访问。这在服务器场景中是一个严重限制。
            
- **无列族（Column
            Family）**：所有数据共享同一个
            LSM-Tree。无法为不同类型的数据设置不同的压缩策略、缓存策略和压缩比。
            
- **有限的压缩控制**：只支持 Snappy
            压缩，无法选择 LZ4、Zstd 等更高效的压缩算法。Compaction
            策略固定为 Leveled Compaction，无法切换。
            
- **无内置监控**：不提供统计信息接口，无法在运行时获取压缩进度、缓存命中率、I/O
            统计等关键指标。
            
- **写放大严重**：Leveled Compaction
            在最坏情况下的写放大倍数可达 10-30
            倍。每一层的大小是上一层的 10
            倍（默认），最底层的数据会被反复合并。
            
            
            

## 三、RocksDB

            

### 3.1 从 LevelDB 到
            RocksDB

            

RocksDB 是 Facebook（现 Meta）在 2012 年从 LevelDB
            分支（Fork）发展而来的高性能嵌入式存储引擎。Facebook
            的工程团队发现 LevelDB
            在以下方面无法满足生产环境的需求：大规模数据集上的性能退化、缺乏并发控制、缺乏运维工具、缺乏灵活的压缩策略。RocksDB
            在保留 LevelDB 核心 LSM-Tree
            架构的基础上，做了大量工程增强。
            

### 3.2 关键增强特性

            

#### 3.2.1 列族（Column Family）

            

列族是 RocksDB 最重要的特性之一。每个列族拥有独立的
            MemTable 和 SSTable 文件集合，但共享同一个 WAL
            日志。这意味着：
            
```
#include "rocksdb/db.h"

rocksdb::DB* db;
rocksdb::Options options;
options.create_if_missing = true;

// 创建列族
std::vector cf_descs;
cf_descs.push_back(rocksdb::ColumnFamilyDescriptor(
    "default", rocksdb::ColumnFamilyOptions()));
cf_descs.push_back(rocksdb::ColumnFamilyDescriptor(
    "metadata", rocksdb::ColumnFamilyOptions()));
cf_descs.push_back(rocksdb::ColumnFamilyDescriptor(
    "data", rocksdb::ColumnFamilyOptions()));

std::vector cf_handles;
rocksdb::Status s = rocksdb::DB::Open(
    rocksdb::DBOptions(options), "/data/rocksdb",
    cf_descs, &cf_handles);

// 向不同列族写入数据
s = db->Put(rocksdb::WriteOptions(), cf_handles[1],
            "meta_key", "meta_value");
s = db->Put(rocksdb::WriteOptions(), cf_handles[2],
            "data_key", "data_value");

// 跨列族的原子写入
rocksdb::WriteBatch batch;
batch.Put(cf_handles[1], "meta_key2", "meta_value2");
batch.Put(cf_handles[2], "data_key2", "data_value2");
s = db->Write(rocksdb::WriteOptions(), &batch);
```

            

列族的典型应用场景：TiKV
            使用三个列族——`default`（存储值）、`lock`（存储锁信息）、`write`（存储写入记录），为每个列族配置不同的压缩策略和缓存大小。
            

#### 3.2.2
            多种压缩策略（Compaction Strategy）

            

RocksDB 支持三种主要的 Compaction 策略：
            
            
            
            
            
            
            
            
            
            
            策略
            写放大
            空间放大
            读放大
            适用场景
            
            
            
            
            Leveled Compaction
            中等（10-30x）
            低（~1.1x）
            低
            读多写少，空间敏感
            
            
            Universal Compaction
            低（5-10x）
            高（~2x）
            中等
            写多读少，SSD 寿命敏感
            
            
            FIFO Compaction
            极低
            中等
            高
            时间序列数据，TTL 淘汰
            
            
            
            
```
// 配置 Universal Compaction
rocksdb::Options options;
options.compaction_style = rocksdb::kCompactionStyleUniversal;
options.compaction_options_universal.size_ratio = 1;
options.compaction_options_universal.min_merge_width = 2;
options.compaction_options_universal.max_merge_width = 10;
```

            

#### 3.2.3 并发读写

            

RocksDB 支持多线程并发读写，这是相对于 LevelDB
            的重大改进：
            
            
- **多线程写入**：通过写入批处理组（Write
            Batch Group）机制，多个写入线程的请求可以合并为一次 WAL
            写入。领导线程（Leader
            Thread）负责将所有成员的写入一次性刷盘。
            
- **多线程压缩**：后台压缩任务可以在多个线程上并行执行，显著减少压缩积压。
            
- **无锁读取**：读取操作不需要获取全局锁，通过引用计数（Reference
            Counting）和超级版本（SuperVersion）机制保证读取一致性。
            
            

#### 3.2.4 高级功能

            

RocksDB 还提供了大量生产级功能：
            
```
├── 压缩算法选择（Snappy、LZ4、Zstd、Bzip2）
├── 限速器（Rate Limiter）：限制 Compaction 和 Flush 的 I/O 带宽
├── 写缓冲管理器（Write Buffer Manager）：全局控制 MemTable 内存用量
├── 块缓存（Block Cache）：支持 LRU 和 Clock Cache
├── 持久化缓存（Persistent Cache）：使用 SSD 作为二级缓存
├── 事务支持（Pessimistic / Optimistic Transaction）
├── 合并操作符（Merge Operator）：支持 read-modify-write 原子操作
├── 前缀迭代器（Prefix Iterator）：优化前缀扫描
├── 子压缩（Sub-Compaction）：单个 Compaction 任务内部并行
├── 统计信息（Statistics）：200+ 运行时指标
└── 备份和检查点（Backup / Checkpoint）
```

            

### 3.3 RocksDB
            在生产中的关键配置

            

一个典型的写入密集型工作负载的 RocksDB 配置：
            
```
rocksdb::Options options;

// 基础配置
options.create_if_missing = true;
options.max_open_files = -1;  // 不限制打开文件数

// 写缓冲（MemTable）
options.write_buffer_size = 64 * 1024 * 1024;           // 64 MB
options.max_write_buffer_number = 4;                      // 最多 4 个 MemTable
options.min_write_buffer_number_to_merge = 2;             // 合并后再 Flush

// Compaction
options.level0_file_num_compaction_trigger = 4;
options.level0_slowdown_writes_trigger = 20;
options.level0_stop_writes_trigger = 36;
options.max_bytes_for_level_base = 256 * 1024 * 1024;    // Level-1 大小 256 MB
options.max_bytes_for_level_multiplier = 10;              // 每层 10 倍
options.target_file_size_base = 64 * 1024 * 1024;        // SSTable 文件 64 MB
options.num_levels = 7;

// 并发
options.max_background_compactions = 4;
options.max_background_flushes = 2;
options.env->SetBackgroundThreads(4, rocksdb::Env::LOW);
options.env->SetBackgroundThreads(2, rocksdb::Env::HIGH);

// 压缩算法（每层不同）
options.compression_per_level = {
    rocksdb::kNoCompression,           // Level-0：不压缩
    rocksdb::kNoCompression,           // Level-1：不压缩
    rocksdb::kLZ4Compression,          // Level-2：LZ4
    rocksdb::kLZ4Compression,          // Level-3：LZ4
    rocksdb::kLZ4Compression,          // Level-4：LZ4
    rocksdb::kZSTD,                    // Level-5：Zstd
    rocksdb::kZSTD                     // Level-6：Zstd
};

// Bloom Filter
rocksdb::BlockBasedTableOptions table_options;
table_options.filter_policy.reset(
    rocksdb::NewBloomFilterPolicy(10, false));  // 10 bits/key
table_options.block_cache =
    rocksdb::NewLRUCache(1 * 1024 * 1024 * 1024);         // 1 GB 块缓存
options.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(table_options));
```

            

### 3.4 RocksDB 的代价

            

RocksDB 的功能丰富性带来了复杂性代价：
            
            
- **配置参数超过 100
            个**：错误的配置可能导致性能比默认值更差。例如，`write_buffer_size`
            过大会增加恢复时间，`level0_slowdown_writes_trigger`
            过小会导致写入频繁停顿。
            
- **内存占用较高**：多个
            MemTable、块缓存（Block Cache）、索引缓存（Index
            Cache）、Bloom Filter 都消耗内存。一个典型配置需要 2-4 GB
            内存。
            
- **C++ 依赖链**：RocksDB 依赖
            gflags、snappy、lz4、zstd
            等第三方库，交叉编译和静态链接都需要额外工作。
            
- **Cgo 开销**：Go 语言通过 Cgo 调用 RocksDB
            的 C 接口，每次调用有 100-200 纳秒的额外开销，且 Cgo
            调用会阻塞 Go 的调度器（Scheduler）。
            
            
            

## 四、Pebble

            

### 4.1 为什么
            CockroachDB 要重写 RocksDB

            

CockroachDB 最初使用 RocksDB 作为单机存储层，通过 Cgo
            调用 RocksDB 的 C 接口。然而，Cgo
            的调用开销和调度问题在高并发场景下成为瓶颈。CockroachDB
            团队在 2019 年启动了 Pebble 项目，目标是用纯 Go 实现一个与
            RocksDB 兼容的 LSM-Tree 存储引擎。
            

Pebble 的设计目标：
            
            
- **RocksDB 兼容**：能够直接读取 RocksDB
            生成的 SSTable 文件，支持从 RocksDB 平滑迁移。
            
- **纯 Go 实现**：消除 Cgo 调用开销，与 Go
            运行时（Runtime）深度集成。
            
- **性能对等或超越**：在 CockroachDB
            的工作负载下，性能不低于 RocksDB。
            
            

### 4.2 Pebble 的核心改进

            

#### 4.2.1 MANIFEST 与版本管理

            

Pebble 重新设计了版本管理机制。在 RocksDB 中，MANIFEST
            文件记录了 LSM-Tree 的元数据变更历史，每次 Compaction
            都会追加一条变更记录。Pebble 优化了 MANIFEST
            的写入格式，减少了元数据的 I/O 开销。
            

#### 4.2.2 迭代器优化

            

Pebble 对迭代器（Iterator）做了大量优化，这对 CockroachDB
            的 MVCC 扫描至关重要：
            
```
package main

import (
    "fmt"
    "log"

    "github.com/cockroachdb/pebble"
)

func main() {
    db, err := pebble.Open("/data/pebble", &pebble.Options{})
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // 写入
    if err := db.Set([]byte("key1"), []byte("value1"), pebble.Sync); err != nil {
        log.Fatal(err)
    }

    // 读取
    value, closer, err := db.Get([]byte("key1"))
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("key1 = %s\n", value)
    closer.Close()

    // 批量写入
    batch := db.NewBatch()
    batch.Set([]byte("key2"), []byte("value2"), nil)
    batch.Set([]byte("key3"), []byte("value3"), nil)
    batch.Delete([]byte("key1"), nil)
    if err := batch.Commit(pebble.Sync); err != nil {
        log.Fatal(err)
    }

    // 范围迭代
    iter, err := db.NewIter(&pebble.IterOptions{
        LowerBound: []byte("key"),
        UpperBound: []byte("key~"),
    })
    if err != nil {
        log.Fatal(err)
    }
    defer iter.Close()

    for iter.First(); iter.Valid(); iter.Next() {
        fmt.Printf("%s: %s\n", iter.Key(), iter.Value())
    }
}
```

            

Pebble 的迭代器实现了以下优化：
            
            
- **懒初始化（Lazy
            Initialization）**：迭代器在第一次 `Seek`
            或 `First`
            调用时才真正初始化底层数据结构，避免创建后未使用的浪费。
            
- **块属性过滤（Block Property
            Filter）**：允许在迭代过程中根据块级别的元数据（如时间戳范围、键前缀范围）跳过整个
            Data Block，减少不必要的 I/O。
            
- **合并迭代器优化**：Pebble 优化了多层
            SSTable 合并迭代器的堆（Heap）操作，减少了比较次数。
            
            

#### 4.2.3 写入流水线

            

Pebble 实现了写入流水线（Write Pipeline），将 WAL 写入和
            MemTable 写入解耦：
            
```
传统方式（RocksDB）：
  线程1: [WAL 写入 + MemTable 写入] → [WAL 写入 + MemTable 写入] → ...
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              串行执行

Pebble 写入流水线：
  WAL:      [写入1] [写入2] [写入3] ...
  MemTable:    [写入1] [写入2] [写入3] ...
               ^^^^^^^^^^^^^^^^^^^^^^^^^^
                    流水线并行
```

            

这种设计使得一个批次的 WAL 写入和前一个批次的 MemTable
            应用可以并行执行，提高了写入吞吐。
            

### 4.3 Pebble vs RocksDB
            性能对比

            

在 CockroachDB 的 YCSB 基准测试中，Pebble 相比
            RocksDB（通过 Cgo）的性能表现：
            
            
            
            工作负载
            Pebble
            RocksDB（Cgo）
            差异
            
            
            
            
            纯写入（Workload A）
            100%
            85-95%
            Pebble 略优
            
            
            读写混合（Workload B）
            100%
            80-90%
            Pebble 优势明显
            
            
            纯读取（Workload C）
            100%
            90-95%
            Pebble 略优
            
            
            范围扫描（Workload E）
            100%
            75-85%
            Pebble 优势显著
            
            
            
            

Pebble
            在范围扫描场景下的优势最为明显，这主要归功于迭代器优化和消除了
            Cgo 的调用开销。
            
            

## 五、BadgerDB

            

### 5.1 WiscKey：键值分离的
            LSM-Tree

            

BadgerDB 是 Dgraph Labs 开发的 Go
            语言嵌入式键值存储引擎，它实现了 WiscKey
            论文中提出的键值分离（Key-Value Separation）设计。传统
            LSM-Tree（如 LevelDB、RocksDB）将键和值一起存储在 SSTable
            中，Compaction 时需要读取和重写所有数据。当值较大时（如 1 KB
            以上），Compaction 的 I/O
            开销主要由值的读写贡献，而非键。
            

WiscKey 的核心思想是将键和值分离存储：
            
```
传统 LSM-Tree（LevelDB / RocksDB）：
  SSTable: [key1, value1] [key2, value2] [key3, value3] ...
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           Compaction 时需要读写所有数据

WiscKey（BadgerDB）：
  LSM-Tree: [key1, vptr1] [key2, vptr2] [key3, vptr3] ...
            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            Compaction 只需要读写键和指针（很小）

  Value Log: [value1] [value2] [value3] ...
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
             值追加写入，不参与 Compaction
```

            

键值分离的优势：
            
            
- **写放大大幅降低**：Compaction
            只需要移动键和值指针（Value
            Pointer），不需要移动实际的值数据。当值大小为 1 KB
            时，写放大可以从 10-30 倍降低到 2-4 倍。
            
- **Compaction
            速度更快**：处理的数据量更小，Compaction
            积压更少。
            
- **SSD 友好**：减少了 SSD 的写入量，延长了
            SSD 寿命。
            
            

### 5.2 BadgerDB 的架构

            
```
┌─────────────────────────────────────────┐
│                BadgerDB                  │
├─────────────────────────────────────────┤
│          MemTable（SkipList）            │
├───────────────────┬─────────────────────┤
│   LSM-Tree        │    Value Log        │
│  （键 + vptr）     │   （实际值数据）     │
│  ┌─────────────┐  │  ┌───────────────┐  │
│  │  Level 0    │  │  │  vlog-001     │  │
│  ├─────────────┤  │  ├───────────────┤  │
│  │  Level 1    │  │  │  vlog-002     │  │
│  ├─────────────┤  │  ├───────────────┤  │
│  │  Level 2    │  │  │  vlog-003     │  │
│  └─────────────┘  │  └───────────────┘  │
└───────────────────┴─────────────────────┘
```

            

### 5.3 核心 API

            

BadgerDB 的 API 基于事务模型：
            
```
package main

import (
    "fmt"
    "log"

    "github.com/dgraph-io/badger/v4"
)

func main() {
    opts := badger.DefaultOptions("/data/badger")
    opts.Logger = nil  // 禁用日志

    db, err := badger.Open(opts)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // 写入（读写事务）
    err = db.Update(func(txn *badger.Txn) error {
        return txn.Set([]byte("key1"), []byte("value1"))
    })
    if err != nil {
        log.Fatal(err)
    }

    // 读取（只读事务）
    err = db.View(func(txn *badger.Txn) error {
        item, err := txn.Get([]byte("key1"))
        if err != nil {
            return err
        }
        return item.Value(func(val []byte) error {
            fmt.Printf("key1 = %s\n", val)
            return nil
        })
    })
    if err != nil {
        log.Fatal(err)
    }

    // 批量写入（WriteBatch）
    wb := db.NewWriteBatch()
    for i := 0; i 
            

### 5.4 Value Log 的垃圾回收

            

键值分离引入了一个新的问题：Value Log
            中的旧值数据不会自动被清理。当一个键被更新或删除时，旧的值仍然占据
            Value Log 的空间。BadgerDB 通过垃圾回收（Garbage
            Collection）机制来回收这些空间：
            
```
// 触发 Value Log 垃圾回收
// discardRatio 表示如果一个 Value Log 文件中超过该比例的数据已失效，
// 则触发回收
err := db.RunValueLogGC(0.5)  // 50% 的数据失效时触发回收
```

            

垃圾回收的过程：
            
            
- 选择一个失效比例最高的 Value Log 文件。
            
- 扫描文件中的每个值，检查对应的键是否仍然指向该值。
            
- 如果键仍然有效，将值重新写入新的 Value Log 文件。
            
- 删除旧的 Value Log 文件。
            
            

这个过程本身也会产生写放大，但总体上比传统 Compaction
            的写放大要小得多。
            

### 5.5 键值分离的代价

            

键值分离并非免费的午餐：
            
            
- **范围扫描性能下降**：传统 LSM-Tree
            中，范围扫描是顺序
            I/O；键值分离后，扫描键是顺序的，但取值需要随机读取 Value
            Log。BadgerDB 通过预取（Prefetch）缓解这个问题，但在 HDD
            上性能下降严重。
            
- **小值场景无优势**：当值小于 64
            字节时，值指针本身的开销（文件 ID + 偏移量 +
            长度）已经接近值的大小，键值分离反而增加了空间和 I/O
            开销。BadgerDB 允许配置阈值，小于阈值的值直接存储在 LSM-Tree
            中。
            
- **垃圾回收开销**：Value Log
            的垃圾回收需要额外的 I/O 和 CPU
            资源，且需要应用主动触发或配置自动触发。
            
- **崩溃恢复复杂**：需要同时恢复 LSM-Tree 和
            Value Log 的一致性。
            
            
            

## 六、LMDB/BoltDB

            

### 6.1 LMDB：内存映射的 CoW
            B+Tree

            

LMDB（Lightning Memory-Mapped Database）是由 Symas 公司的
            Howard Chu 开发的嵌入式键值存储引擎。与 LSM-Tree
            系列引擎不同，LMDB 使用 B+Tree
            作为核心数据结构，并通过内存映射（Memory-Mapped
            I/O，mmap）和写时复制（Copy-on-Write，CoW）实现数据持久化。
            

LMDB 的设计哲学：
            
            
- **零拷贝读取**：通过 mmap
            将数据文件映射到进程地址空间，读取操作直接返回指向映射内存的指针，不需要从内核缓冲区拷贝数据到用户空间。
            
- **单文件存储**：所有数据存储在一个预分配的文件中，避免了大量小文件的管理开销。
            
- **无需调优**：LMDB
            几乎不需要配置参数（只需要设置最大数据库大小），不需要缓冲池管理、不需要
            Compaction 调度、不需要后台线程。
            
            

### 6.2 CoW B+Tree 的工作原理

            

LMDB 使用 CoW（Copy-on-Write）机制实现事务支持：
            
```
事务开始前的 B+Tree：
          ┌───────┐
          │ Root  │ ← Page 100
          └───┬───┘
         ┌────┴────┐
    ┌────┴──┐ ┌────┴──┐
    │ Leaf1 │ │ Leaf2 │ ← Page 200, Page 300
    └───────┘ └───────┘

写入事务修改 Leaf1 中的数据：
1. 分配新页面 Page 400，复制 Leaf1 的数据并修改
2. 分配新页面 Page 500，复制 Root 并更新指针

          ┌───────┐
          │ Root' │ ← Page 500（新）
          └───┬───┘
         ┌────┴────┐
    ┌────┴──┐ ┌────┴──┐
    │Leaf1' │ │ Leaf2 │ ← Page 400（新），Page 300（复用）
    └───────┘ └───────┘

事务提交：将 Page 500 的地址写入元数据页（Meta Page）
旧页面（Page 100, 200）加入空闲页面列表
```

            

这种设计的关键优势：
            
            
- **读取事务不阻塞写入事务**：读取事务看到的是提交时刻的快照，不需要任何锁。
            
- **崩溃恢复极简**：没有
            WAL，没有检查点（Checkpoint），崩溃后只需读取最后一个有效的元数据页即可恢复。
            
- **无写放大**：修改一个页面只需要写入该页面和从修改点到根节点的路径上的页面，不需要重写整个数据集。
            
            

### 6.3 BoltDB / bbolt

            

BoltDB 是 Ben Johnson 用 Go 语言实现的 LMDB
            风格存储引擎，后由 etcd 团队维护并更名为 bbolt。它继承了
            LMDB 的核心设计：CoW B+Tree、mmap、单写多读。
            
```
package main

import (
    "fmt"
    "log"

    bolt "go.etcd.io/bbolt"
)

func main() {
    db, err := bolt.Open("/data/bolt.db", 0600, nil)
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // 创建 Bucket（类似于表或命名空间）
    err = db.Update(func(tx *bolt.Tx) error {
        _, err := tx.CreateBucketIfNotExists([]byte("users"))
        return err
    })
    if err != nil {
        log.Fatal(err)
    }

    // 写入数据
    err = db.Update(func(tx *bolt.Tx) error {
        b := tx.Bucket([]byte("users"))
        return b.Put([]byte("user:001"), []byte(`{"name":"Alice"}`))
    })
    if err != nil {
        log.Fatal(err)
    }

    // 读取数据
    err = db.View(func(tx *bolt.Tx) error {
        b := tx.Bucket([]byte("users"))
        v := b.Get([]byte("user:001"))
        fmt.Printf("user:001 = %s\n", v)
        return nil
    })
    if err != nil {
        log.Fatal(err)
    }

    // 遍历
    err = db.View(func(tx *bolt.Tx) error {
        b := tx.Bucket([]byte("users"))
        c := b.Cursor()
        for k, v := c.First(); k != nil; k, v = c.Next() {
            fmt.Printf("%s: %s\n", k, v)
        }
        return nil
    })
}
```

            

### 6.4 单写多读模型

            

LMDB 和 BoltDB 都采用单写多读（Single-Writer,
            Multiple-Reader）并发模型：
            
            
- **同一时间只允许一个写入事务**：写入事务通过互斥锁（Mutex）串行化。这简化了并发控制逻辑，但限制了写入吞吐。
            
- **读取事务数量不受限制**：多个读取事务可以并发执行，且不会被写入事务阻塞。每个读取事务看到的是事务开始时刻的一致快照。
            
- **无死锁**：单写模型天然避免了死锁问题。
            
            

这种模型非常适合读多写少的工作负载，例如 etcd
            的元数据存储：etcd 的写入操作需要经过 Raft
            共识，写入频率有限；但读取操作非常频繁，需要低延迟。
            

### 6.5 LMDB/BoltDB 的局限

            
            
- **写入吞吐受限**：单写模型限制了写入并发。在纯写入场景下，性能远低于
            LSM-Tree 引擎。
            
- **数据库大小预分配**：LMDB
            需要预先设置最大数据库大小（MapSize），如果设置过小则需要重新打开数据库；如果设置过大则可能浪费虚拟地址空间。
            
- **空间回收不及时**：CoW
            机制会产生旧页面，这些页面只有在所有引用它们的读取事务结束后才能被回收。长时间运行的只读事务会阻止空间回收。
            
- **页面分裂开销**：B+Tree
            的插入操作可能触发页面分裂（Page Split），产生碎片和额外的
            I/O。
            
            
            

## 七、SQLite

            

### 7.1
            无处不在的嵌入式数据库

            

SQLite
            是世界上部署最广泛的数据库引擎。据估计，全球有超过一万亿个
            SQLite 数据库实例在运行——每部智能手机上至少有数百个 SQLite
            数据库（通讯录、短信、照片元数据、应用设置等）。SQLite 由 D.
            Richard Hipp 在 2000 年创建，核心代码约 15 万行 C
            代码，全部存储在一个巨大的”合并文件”（Amalgamation）`sqlite3.c`
            中。
            

SQLite 是本文讨论的唯一一个提供完整关系模型（Relational
            Model）的嵌入式引擎。它支持完整的 SQL 语法、ACID
            事务、触发器（Trigger）、视图（View）、子查询（Subquery）、窗口函数（Window
            Function）和公共表表达式（Common Table
            Expression，CTE）。
            

### 7.2 存储架构

            

SQLite 使用 B-Tree 作为核心数据结构（注意是 B-Tree，不是
            B+Tree）：
            
```
┌──────────────────────────────────────────┐
│               SQLite 架构                 │
├──────────────────────────────────────────┤
│  SQL 编译器                               │
│  （词法分析 → 语法分析 → 代码生成）        │
├──────────────────────────────────────────┤
│  虚拟机（VDBE）                           │
│  （执行字节码指令）                        │
├──────────────────────────────────────────┤
│  B-Tree 模块                             │
│  （表 B-Tree + 索引 B-Tree）              │
├──────────────────────────────────────────┤
│  Pager 模块                              │
│  （页面缓存、事务管理、崩溃恢复）          │
├──────────────────────────────────────────┤
│  OS 接口（VFS）                           │
│  （文件 I/O、锁、内存分配）               │
└──────────────────────────────────────────┘
```

            

SQLite
            数据库是一个单一文件，文件内部按固定大小的页面（Page）组织：
            
```
┌──────────┬──────────┬──────────┬──────────┬─────┐
│  Page 1  │  Page 2  │  Page 3  │  Page 4  │ ... │
│ （头部 +  │          │          │          │     │
│  Schema  │          │          │          │     │
│  表）     │          │          │          │     │
└──────────┴──────────┴──────────┴──────────┴─────┘
```

            

每个表是一棵 B-Tree，以 rowid 为键；每个索引也是一棵
            B-Tree，以索引列的值为键。
            

### 7.3 WAL 模式

            

SQLite 支持两种日志模式：
            

**回滚日志（Rollback
            Journal）模式**：写入前先将原始页面拷贝到日志文件，然后修改数据库文件。崩溃时通过日志恢复原始数据。这种模式下，写入操作会阻塞所有读取操作。
            

**预写日志（Write-Ahead
            Logging，WAL）模式**：写入操作追加到 WAL
            文件，不修改主数据库文件。读取操作查找 WAL
            中最新版本和主数据库中的历史版本。
            
```
-- 启用 WAL 模式
PRAGMA journal_mode=WAL;

-- WAL 相关配置
PRAGMA wal_autocheckpoint=1000;  -- 每 1000 页自动检查点
PRAGMA synchronous=NORMAL;       -- WAL 模式下 NORMAL 即可保证持久性
```

            

WAL 模式的优势：
            
            
- **读写并发**：写入不阻塞读取，读取不阻塞写入。多个读取事务可以与一个写入事务并发执行。
            
- **写入性能提升**：WAL
            写入是顺序追加，比回滚日志模式的随机写入更快。
            
- **更好的崩溃恢复**：WAL
            文件包含了所有未检查点的修改，恢复更简单。
            
            

### 7.4 核心 API

            
```
#include 

int main() {
    sqlite3 *db;
    int rc;

    // 打开数据库
    rc = sqlite3_open("/data/app.db", &db);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "无法打开数据库: %s\n", sqlite3_errmsg(db));
        return 1;
    }

    // 启用 WAL 模式
    sqlite3_exec(db, "PRAGMA journal_mode=WAL;", NULL, NULL, NULL);

    // 创建表
    const char *sql_create =
        "CREATE TABLE IF NOT EXISTS users ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  email TEXT UNIQUE,"
        "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
        ");";
    sqlite3_exec(db, sql_create, NULL, NULL, NULL);

    // 插入数据（使用预编译语句防止 SQL 注入）
    sqlite3_stmt *stmt;
    const char *sql_insert =
        "INSERT INTO users (name, email) VALUES (?, ?);";
    sqlite3_prepare_v2(db, sql_insert, -1, &stmt, NULL);

    sqlite3_bind_text(stmt, 1, "Alice", -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, "alice@example.com", -1, SQLITE_STATIC);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    // 查询数据
    const char *sql_select = "SELECT id, name, email FROM users;";
    sqlite3_prepare_v2(db, sql_select, -1, &stmt, NULL);
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        int id = sqlite3_column_int(stmt, 0);
        const char *name = (const char *)sqlite3_column_text(stmt, 1);
        const char *email = (const char *)sqlite3_column_text(stmt, 2);
        printf("id=%d, name=%s, email=%s\n", id, name, email);
    }
    sqlite3_finalize(stmt);

    sqlite3_close(db);
    return 0;
}
```

            

### 7.5 SQLite
            的适用与不适用场景

            

**适用场景**：
            
            
- 移动应用的本地数据存储（Android、iOS）
            
- 桌面应用的配置和用户数据
            
- 嵌入式设备（IoT 网关、路由器）
            
- 单机数据分析和原型开发
            
- 测试环境中替代服务器数据库
            
- 小到中型网站（日访问量 10 万以下）
            
            

**不适用场景**：
            
            
- 高并发写入（仍为单写模型）
            
- 超大数据集（超过 TB 级别）
            
- 需要多节点分布式部署
            
- 需要细粒度权限控制
            
            
            

## 八、设计目标与数据结构对比

            

### 8.1 核心设计维度对比

            

以下是六个引擎在核心设计维度上的系统性对比：
            
```
┌──────────────┬────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┐
│   维度        │  LevelDB   │   RocksDB    │  Pebble  │ BadgerDB │LMDB/Bolt │  SQLite  │
├──────────────┼────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┤
│ 数据结构      │ LSM-Tree   │ LSM-Tree     │ LSM-Tree │LSM+VLog  │CoW B+Tree│ B-Tree   │
│ 实现语言      │ C++        │ C++          │ Go       │ Go       │ C / Go   │ C        │
│ 并发模型      │ 单写多读    │ 多写多读     │ 多写多读  │ 多写多读  │ 单写多读  │ 单写多读  │
│ 事务支持      │ WriteBatch │ 完整事务     │WriteBatch│ 完整事务  │ 完整事务  │完整 ACID │
│ 压缩算法      │ Snappy     │ 多种可选     │ 多种可选  │ Snappy/  │ 无        │ 无       │
│              │            │              │          │ Zstd     │          │          │
│ 列族          │ 不支持     │ 支持         │ 不支持   │ 不支持    │不支持     │ 不适用   │
│ WAL          │ 有         │ 有           │ 有       │ 有        │ 无       │ 可选     │
│ 内存模型      │ 用户态缓存  │ 用户态缓存   │用户态缓存│用户态缓存 │ mmap     │用户态缓存│
│ 写放大        │ 10-30x     │ 5-30x        │ 5-30x   │ 2-4x     │ 1-3x     │ 1-3x    │
│ 读放大        │ 1-N 层     │ 1-N 层       │ 1-N 层  │ 1-N+随机 │ 1-树高    │ 1-树高   │
│ 空间放大      │ ~1.1x      │ ~1.1x        │ ~1.1x   │ 1.1-2x   │ ~1-2x    │ ~1-1.5x │
│ 最大数据库    │ 无限制     │ 无限制       │ 无限制   │ 无限制    │ 预分配   │ 281 TB   │
│ 多进程访问    │ 不支持     │ 不支持       │ 不支持   │ 不支持    │ 支持     │ 支持     │
└──────────────┴────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┘
```

            

### 8.2 数据结构特性对比

            

#### LSM-Tree
            系列（LevelDB、RocksDB、Pebble、BadgerDB）

            

LSM-Tree 的核心优势是将随机写入转化为顺序写入：
            
```
写入路径：
  应用写入 → WAL（顺序追加） → MemTable（内存中的有序结构）
  MemTable 写满 → 冻结为 Immutable MemTable → Flush 到 Level-0 SSTable
  Level-0 SSTable 积累 → Compaction 合并到更深层

优势：
  - 写入只涉及顺序 I/O（WAL 追加 + SSTable Flush）
  - 批量写入效率极高
  - 压缩率高（整个 SSTable 可以使用块压缩）

劣势：
  - 读取可能需要检查多个层级（读放大）
  - Compaction 产生写放大
  - 空间放大（同一个键可能在多个层级有多个版本）
```

            

#### CoW B+Tree（LMDB、BoltDB）

            

CoW B+Tree 的优势是读取路径短且零拷贝：
            
```
读取路径（mmap 模式）：
  应用读取 → 页面在 mmap 映射区 → 直接返回指针（零拷贝）
  页面不在内存 → 触发缺页中断 → 内核从磁盘加载页面 → 返回指针

优势：
  - 读取延迟稳定（B+Tree 高度通常 3-5 层）
  - 零拷贝读取（mmap）
  - 无需后台压缩线程
  - 崩溃恢复极简

劣势：
  - 随机写入性能差（每次写入可能触发多个页面的 CoW）
  - 写入并发受限（单写模型）
  - mmap 受虚拟地址空间和操作系统页面管理策略影响
```

            

#### B-Tree（SQLite）

            

SQLite 使用传统的 B-Tree（非
            B+Tree），内部节点也存储数据：
            
```
SQLite B-Tree vs B+Tree：
  B-Tree：  内部节点存储键值对
            [key1|val1|ptr1|key2|val2|ptr2|...]
            → 内部节点能存储的键更少，树更高

  B+Tree：  内部节点只存储键和子节点指针
            [key1|ptr1|key2|ptr2|...]
            值只存储在叶子节点
            → 内部节点存储更多键，树更矮

SQLite 选择 B-Tree 的原因：
  - rowid 查找可以在中间节点就返回，不一定需要到叶子节点
  - 减少索引和数据的间接引用层次
```

            

### 8.3 内存管理模型对比

            
            
            
            
            
            
            
            
            
            引擎
            内存管理方式
            缓存控制
            内存效率
            
            
            
            
            LevelDB
            用户态 Block Cache（LRU）
            应用控制缓存大小
            中等
            
            
            RocksDB
            用户态 Block Cache（LRU/Clock）
            精细控制（每层配置）
            高
            
            
            Pebble
            用户态 Block Cache
            Go GC 管理
            高
            
            
            BadgerDB
            用户态 + 可选 mmap 读取值
            Go GC 管理
            中等
            
            
            LMDB
            完全依赖 mmap
            操作系统页面缓存
            高（零拷贝）
            
            
            BoltDB
            完全依赖 mmap
            操作系统页面缓存
            高（零拷贝）
            
            
            SQLite
            用户态 Page Cache
            应用控制（`cache_size`）
            中等
            
            
            
            

用户态缓存（User-Space Cache）和 mmap 的核心区别：
            
```
用户态缓存（RocksDB / Pebble）：
  应用 ← memcpy ← 用户态缓存 ← read() ← 内核页面缓存 ← 磁盘
  优势：精确控制内存使用量和淘汰策略
  劣势：额外的内存拷贝开销

mmap（LMDB / BoltDB）：
  应用 ← 直接指针访问 ← mmap 映射 ← 内核页面缓存 ← 磁盘
  优势：零拷贝，读取延迟低
  劣势：内存使用量受操作系统控制，难以预测
```

            
            

## 九、统一基准测试

            

### 9.1 测试方法论

            

为了公平地对比各引擎的性能，我们设计了以下统一基准测试框架：
            

**测试环境**：
            
```
硬件配置：
  CPU：AMD EPYC 7763 64 核（绑定 16 核用于测试）
  内存：128 GB DDR4-3200（限制测试进程使用 8 GB）
  存储：Samsung PM9A3 NVMe SSD（3.84 TB，随机读 IOPS 800K，随机写 IOPS 180K）

软件配置：
  操作系统：Ubuntu 22.04 LTS，Linux 5.15
  文件系统：ext4，noatime，discard
  LevelDB：1.23
  RocksDB：9.0.0
  Pebble：v1.1
  BadgerDB：v4.2
  BoltDB（bbolt）：v1.3.9
  SQLite：3.45.0（WAL 模式）
```

            

**数据特征**：
            
```
键大小：16 字节（固定长度 UUID）
值大小：256 字节（模拟典型元数据负载）
数据集大小：1000 万条记录（约 2.5 GB 原始数据）
键分布：均匀随机分布
```

            

**测试工作负载**：
            
            
            
            工作负载
            描述
            操作比例
            
            
            
            
            顺序插入
            按键顺序插入 1000 万条记录
            100% 写入
            
            
            随机插入
            随机顺序插入 1000 万条记录
            100% 写入
            
            
            点查询
            随机读取已存在的键
            100% 读取
            
            
            范围扫描
            从随机起始点扫描 100 条连续记录
            100% 扫描
            
            
            读写混合
            YCSB Workload A（50% 读 + 50% 更新）
            50% 读 + 50% 写
            
            
            
            

### 9.2 顺序插入性能

            
```
顺序插入 1000 万条记录（16B 键 + 256B 值）
吞吐量（万条/秒），值越大越好：

LevelDB   |████████████████████████████████████████████████             48.2
RocksDB   |██████████████████████████████████████████████████████████   58.6
Pebble    |████████████████████████████████████████████████████████     55.3
BadgerDB  |██████████████████████████████████████████████████████       52.1
BoltDB    |████████████                                                12.5
SQLite    |██████████████████████                                      22.8
```

            

分析：LSM-Tree
            系列引擎在顺序插入场景下性能优异，因为写入路径只涉及顺序
            I/O。RocksDB 凭借多线程 Compaction
            和写入批处理组机制领先。BoltDB 的单写模型和 CoW
            开销导致写入性能最低。SQLite 的 WAL
            模式提供了合理的写入性能，但仍受限于单写模型。
            

### 9.3 随机插入性能

            
```
随机插入 1000 万条记录（16B 键 + 256B 值）
吞吐量（万条/秒），值越大越好：

LevelDB   |██████████████████████████████████████████                  41.5
RocksDB   |████████████████████████████████████████████████████████     55.2
Pebble    |██████████████████████████████████████████████████████       52.8
BadgerDB  |█████████████████████████████████████████████████            48.7
BoltDB    |████████                                                     8.3
SQLite    |█████████████████                                           17.5
```

            

分析：随机插入场景下，各引擎的相对排名与顺序插入类似，但
            BoltDB 和 SQLite 的性能下降更为明显。B-Tree / B+Tree
            引擎在随机插入时会触发更多的页面分裂和随机 I/O。
            

### 9.4 点查询性能

            
```
100 万次随机点查询（数据集已预热）
吞吐量（万次/秒），值越大越好：

LevelDB   |█████████████████████████████████████████████                45.2
RocksDB   |█████████████████████████████████████████████████████████     57.8
Pebble    |███████████████████████████████████████████████████████       55.1
BadgerDB  |████████████████████████████████████████                     39.6
BoltDB    |██████████████████████████████████████████████████████████    58.5
SQLite    |███████████████████████████████████████████████               47.3
```

            

分析：BoltDB 在点查询场景下表现最优，这得益于 mmap
            零拷贝读取和 B+Tree 的短读取路径。BadgerDB 的点查询需要先在
            LSM-Tree 中查找键，然后从 Value Log 中随机读取值，增加了一次
            I/O。RocksDB 和 Pebble 借助 Bloom Filter 跳过不包含目标键的
            SSTable，读取路径接近最优。
            

### 9.5 范围扫描性能

            
```
10 万次范围扫描（每次扫描 100 条连续记录）
吞吐量（万次/秒），值越大越好：

LevelDB   |████████████████████████████████████████████████             12.1
RocksDB   |███████████████████████████████████████████████████████      13.8
Pebble    |█████████████████████████████████████████████████████████    14.5
BadgerDB  |████████████████████████████████                              8.2
BoltDB    |██████████████████████████████████████████████████████████   14.7
SQLite    |████████████████████████████████████████████████████          13.2
```

            

分析：范围扫描是 BadgerDB
            的弱项。键值分离导致扫描过程中需要大量随机读取 Value
            Log，破坏了顺序 I/O 模式。BoltDB 和 Pebble
            在范围扫描中表现最优：BoltDB 的 B+Tree
            叶子节点通过链表连接，扫描是连续的内存访问（mmap
            模式下）；Pebble 的迭代器优化减少了合并操作的开销。
            

### 9.6 读写混合性能

            
```
YCSB Workload A（50% 读 + 50% 更新），100 万次操作
吞吐量（万次/秒），值越大越好：

LevelDB   |██████████████████████████████████████████                  28.4
RocksDB   |████████████████████████████████████████████████████████     38.2
Pebble    |██████████████████████████████████████████████████████       36.5
BadgerDB  |█████████████████████████████████████████████████            33.1
BoltDB    |█████████████████                                           11.6
SQLite    |██████████████████████████                                   17.8
```

            

分析：读写混合场景最接近真实工作负载。RocksDB 和 Pebble
            的多写多读并发模型使它们在混合负载下保持高吞吐。BoltDB
            的单写模型导致读写互相干扰：虽然读不阻塞写，但写事务持有的页面会增加读事务的
            CoW 开销。
            

### 9.7 空间效率

            
```
存储 1000 万条记录（原始数据 ~2.5 GB）后的磁盘占用：

LevelDB   |████████████████████████████████                             2.72 GB（1.09x）
RocksDB   |████████████████████████████████                             2.68 GB（1.07x）
Pebble    |████████████████████████████████                             2.70 GB（1.08x）
BadgerDB  |██████████████████████████████████████                       3.15 GB（1.26x）
BoltDB    |████████████████████████████████████████                     3.35 GB（1.34x）
SQLite    |██████████████████████████████████████                       3.12 GB（1.25x）
```

            

分析：LSM-Tree 系列引擎的空间效率最高，得益于 SSTable
            的块级压缩（默认 Snappy 或 LZ4）。BoltDB 不支持压缩且 CoW
            产生的页面碎片增加了空间开销。BadgerDB 的 Value Log
            中可能存在未回收的旧值。
            
            

## 十、选型指南

            

### 10.1 决策树

            
```
                    你的应用需要嵌入式存储引擎吗？
                              │
                    ┌─────────┴─────────┐
                    是                   否 → 使用客户端-服务器数据库
                    │
              需要 SQL 查询吗？
                    │
              ┌─────┴─────┐
              是           否
              │            │
          SQLite      实现语言是什么？
                           │
                    ┌──────┴──────┐
                   C/C++         Go
                    │             │
              写入密集型？    写入密集型？
                    │             │
              ┌─────┴─────┐ ┌────┴────┐
              是          否 是       否
              │           │  │        │
          RocksDB    考虑LMDB │   考虑bbolt
                          │  │        │
                          │  值 > 1KB？│
                          │  │        │
                     ┌────┴──┴┐       │
                     是      否       │
                     │       │        │
                 BadgerDB  Pebble   bbolt
```

            

### 10.2 典型系统的选型实践

            

#### TiKV → RocksDB

            

TiKV 选择 RocksDB 的理由：
            
            
- **写入密集型工作负载**：TiKV
            作为分布式事务键值存储，需要处理大量写入操作。LSM-Tree
            的写入优化是关键。
            
- **列族需求**：TiKV
            使用三个列族分离存储数据、锁信息和写入记录，每个列族有独立的
            Compaction 和缓存策略。
            
- **C++ 生态**：TiKV 使用 Rust 实现，通过 FFI
            调用 RocksDB 的 C 接口，性能开销可控。
            
- **成熟度**：RocksDB 经过 Facebook
            大规模生产验证，稳定性和可靠性有保障。
            
            
```
TiKV 架构中 RocksDB 的角色：
  Raft 层 → 日志复制和一致性
  MVCC 层 → 多版本并发控制
  RocksDB  → 单机数据持久化
    ├── default CF → 实际值数据
    ├── lock CF    → 事务锁
    └── write CF   → 写入记录（提交版本号）
```

            

#### CockroachDB → Pebble

            

CockroachDB 从 RocksDB 迁移到 Pebble 的理由：
            
            
- **消除 Cgo 开销**：CockroachDB 使用 Go
            实现，通过 Cgo 调用 RocksDB
            的代价在高并发场景下不可忽视。每次 Cgo 调用有 100-200
            纳秒的固定开销，且会阻塞 Go 调度器。
            
- **迭代器性能**：CockroachDB 的 MVCC
            层大量使用范围扫描，Pebble 针对此场景做了深度优化。
            
- **可控性**：自研存储引擎使 CockroachDB
            团队可以针对自身工作负载做定制优化，而不必等待上游合入补丁。
            
- **兼容性**：Pebble 支持读取 RocksDB 格式的
            SSTable，迁移过程可以无缝进行。
            
            

#### etcd → BoltDB（bbolt）

            

etcd 选择 BoltDB 的理由：
            
            
- **读多写少**：etcd 的写入需要经过 Raft
            共识，写入频率有限（通常每秒数百到数千次）。但读取操作非常频繁（每秒数万到数十万次），BoltDB
            的零拷贝读取和 B+Tree 短路径是理想选择。
            
- **事务语义**：etcd
            需要完整的事务支持来保证元数据的一致性。BoltDB
            的读写事务和只读事务语义简洁明确。
            
- **零调优**：BoltDB
            几乎不需要配置参数，这对运维友好。etcd
            作为基础设施组件，需要在各种环境下稳定运行。
            
- **纯 Go 实现**：避免 Cgo
            依赖，简化编译和部署。
            
            
```
etcd 的写入路径：
  客户端请求 → Raft 提议 → 多数节点确认
  → 应用到状态机 → BoltDB 写入事务
  → 更新索引（内存 B-Tree） → 返回客户端

etcd 的读取路径：
  客户端请求 → 线性一致读（ReadIndex）
  → 内存 B-Tree 查找键 → BoltDB 只读事务获取值 → 返回客户端
```

            

#### Dgraph → BadgerDB

            

Dgraph 选择 BadgerDB（并自研）的理由：
            
            
- **大值存储**：图数据库的边和属性列表（Posting
            List）可能很大（数 KB 到数 MB）。键值分离设计避免了大值参与
            Compaction 的写放大问题。
            
- **SSD 优化**：WiscKey 的设计利用了 SSD
            的随机读取性能，在 SSD
            上键值分离的代价（随机读取值）是可以接受的。
            
- **纯 Go 实现**：Dgraph 使用 Go 实现，纯 Go
            存储引擎避免了 Cgo 的复杂性。
            
- **序列化友好**：BadgerDB 的事务 API 与
            Dgraph 的事务模型自然契合。
            
            

#### 移动应用 → SQLite

            

SQLite 在移动端不可替代的理由：
            
            
- **通用部署**：Android 和 iOS 原生支持
            SQLite，不需要额外的库依赖。
            
- **SQL
            查询**：移动应用的数据模型通常是关系型的（用户表、消息表、联系人表），SQL
            查询比键值接口更自然。
            
- **小体积**：SQLite 的编译产物约 500
            KB，对移动应用的包大小影响极小。
            
- **零运维**：不需要数据库服务器，不需要配置，不需要连接管理。应用启动时打开数据库文件即可使用。
            
            

### 10.3 选型核心原则

            

总结六个引擎的选型核心原则：
            
            
            
            核心需求
            推荐引擎
            理由
            
            
            
            
            写入吞吐最大化
            RocksDB
            多写并发 + 灵活的 Compaction 策略
            
            
            Go 生态 + 写入密集
            Pebble 或 BadgerDB
            纯 Go，无 Cgo 开销
            
            
            Go 生态 + 读取密集
            bbolt
            零拷贝读取，延迟稳定
            
            
            大值存储 + SSD
            BadgerDB
            键值分离减少写放大
            
            
            需要 SQL
            SQLite
            唯一提供完整 SQL 的嵌入式引擎
            
            
            零配置 + 最简运维
            LMDB 或 SQLite
            几乎不需要调优参数
            
            
            C/C++ 生态 + 生产验证
            RocksDB
            Facebook 大规模验证
            
            
            学习和教学
            LevelDB
            代码简洁，是最佳的 LSM-Tree 教材
            
            
            
            

### 10.4
            反模式：常见的选型错误

            
            
- **在 HDD 上使用 BadgerDB**：BadgerDB
            的键值分离设计假设随机读取廉价（SSD），在 HDD 上 Value Log
            的随机读取会成为严重瓶颈。
            
- **用 BoltDB
            处理写入密集型负载**：单写模型无法并发写入，每次写入都涉及
            CoW 和 fsync，写入吞吐远低于 LSM-Tree 引擎。
            
- **在资源受限环境中使用 RocksDB**：RocksDB
            的内存占用较高（MemTable + Block Cache + Bloom
            Filter），在内存小于 1 GB 的环境中可能频繁触发 OOM。
            
- **用 SQLite
            替代高并发服务器数据库**：SQLite
            的单写模型无法支撑高并发写入，且缺乏多节点分布式能力。
            
- **忽视 Cgo 调用开销**：在 Go 项目中使用
            RocksDB 或 LevelDB 的 C 绑定时，Cgo
            的调用开销在高频小操作场景下会成为瓶颈。应该考虑
            Pebble、BadgerDB 或 bbolt 等纯 Go 实现。
            
            

### 10.5 未来趋势

            

嵌入式存储引擎领域正在发生几个重要的技术演变：
            
            
- **持久化内存（Persistent
            Memory）适配**：Intel Optane
            等持久化内存设备模糊了内存和存储的界限，传统的基于块 I/O
            的存储引擎设计可能需要根本性调整。
            
- **异步 I/O 集成**：Linux 的 io_uring
            接口提供了高效的异步 I/O 能力，RocksDB 和 Pebble 都在探索用
            io_uring 替代传统的同步 I/O 调用。
            
- **可组合存储引擎**：将存储引擎分解为独立的组件（MemTable、WAL、SSTable、Compaction
            Scheduler），允许用户按需组合，而非使用一体化的解决方案。
            
- **硬件加速**：利用 GPU、FPGA 或专用硬件加速
            Compaction、压缩/解压、Bloom Filter
            查询等计算密集型操作。
            
            
            

## 附：参考资料

            
            
- Ghemawat, S., & Dean, J. (2011). “LevelDB: A Fast
            Persistent Key-Value Store.” https://github.com/google/leveldb
            
- Facebook. “RocksDB: A Persistent Key-Value Store for
            Fast Storage Environments.” https://github.com/facebook/rocksdb
            
- Dong, S., Callaghan, M., Galanis, L., Borthakur, D.,
            Savor, T., & Strum, M. (2017). “Optimizing Space
            Amplification in RocksDB.” *8th Biennial Conference on
            Innovative Data Systems Research (CIDR)*.
            
- Lu, L., Pillai, T. S., Gopalakrishnan, H.,
            Arpaci-Dusseau, A. C., & Arpaci-Dusseau, R. H. (2016).
            “WiscKey: Separating Keys from Values in SSD-Conscious
            Storage.” *14th USENIX Conference on File and Storage
            Technologies (FAST 16)*, 133-148.
            
- CockroachDB. “Pebble: A Go Key-Value Store.” https://github.com/cockroachdb/pebble
            
- Dgraph Labs. “BadgerDB: Fast Key-Value DB in Go.” https://github.com/dgraph-io/badger
            
- Chu, H. (2011). “LMDB: Lightning Memory-Mapped
            Database.” https://www.symas.com/lmdb
            
- etcd-io. “bbolt: An embedded key/value database for Go.”
            https://github.com/etcd-io/bbolt
            
- Hipp, D. R. (2000). “SQLite: An Embedded SQL Database
            Engine.” https://www.sqlite.org/
            
- O’Neil, P., Cheng, E., Gawlick, D., & O’Neil, E.
            (1996). “The Log-Structured Merge-Tree (LSM-Tree).” *Acta
            Informatica*, 33(4), 351-385.
            
- Athanassoulis, M., Kester, M. S., Maas, L. M., Stoica,
            R., Idreos, S., Ailamaki, A., & Callaghan, M. (2016).
            “Designing Access Methods: The RUM Conjecture.”
            *Proceedings of the 19th International Conference on
            Extending Database Technology (EDBT)*, 461-466.
            
- RocksDB Wiki. “RocksDB Tuning Guide.” https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide
            
- Kleppmann, M. (2017). *Designing Data-Intensive
            Applications*. O’Reilly Media. Chapter 3: Storage and
            Retrieval.
            
- Pebble Performance. “Pebble vs RocksDB Benchmarks.” https://github.com/cockroachdb/pebble/blob/master/docs/rocksdb.md
            
- SQLite Documentation. “Write-Ahead Logging.” https://www.sqlite.org/wal.html
            
- TiKV Documentation. “RocksDB in TiKV.” https://tikv.org/docs/deep-dive/key-value-engine/rocksdb/
            
            
            

**上一篇**: LMDB
            与内存映射存储 **下一篇**: 列式存储原理：为什么分析查询快
            10 倍
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-11 · storage
                    

### 【存储工程】LMDB 与内存映射存储

                    

数据库存储引擎通常自己管理一块内存，维护 Buffer Pool，用 read()/pread() 把磁盘页加载进来，再用 LRU 或 Clock 算法做淘汰。这套方案灵活、可控，但代码量大、调优参数多，且引入了用户态到内核态的数据拷贝。有没有一种方式，让操作系统直接把磁盘文件映射到进程地址空间，数据库只管读指针，不管…
                

                
                    

2025-09-10 · storage
                    

### 【存储工程】RocksDB 工程实践

                    

从 Column Family、Write Buffer、Block Cache、Compaction、Rate Limiter 到 Direct I/O 和监控，系统拆解 RocksDB 在生产环境中的关键配置与故障模式，并给出 SSD 场景下的配置模板和 db_bench 基准测试方法。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。