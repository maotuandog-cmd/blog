# 【存储工程】Bitcask 与日志结构哈希表

来源: https://quant67.com/post/storage/30-bitcask/bitcask.html
日期: 2025-09-08 |

---

# Bitcask
            与日志结构哈希表

            

在存储引擎（Storage Engine）的设计谱系中，Bitcask
            占据着一个独特而优雅的位置：
            它用最简单的数据结构——哈希表（Hash
            Table）与追加日志（Append-Only Log）——
            组合出了一个在特定工作负载下性能极其出色的键值存储引擎。
            本文将从核心思想出发，逐层拆解 Bitcask 的架构、读写路径、
            合并回收、崩溃恢复，再到工程实践与横向对比，
            力求让读者对这一经典设计形成完整认知。
            
            

## 一、日志结构存储的核心思想

            

### 1.1 什么是追加写入

            

传统的存储系统——无论是关系型数据库（Relational
            Database）还是早期的键值存储—— 通常采用”就地更新（In-Place
            Update）“策略：
            当一条记录被修改时，引擎会在磁盘上找到该记录原来的位置，直接覆盖旧数据。
            这种方式看起来直观，但在机械硬盘（HDD）时代却隐含着巨大的性能代价：
            随机写入（Random
            Write）需要磁头寻道（Seek），耗时通常在毫秒级别。
            

日志结构存储（Log-Structured Storage）提出了另一种思路：
            **所有写入都以追加（Append）的方式写到文件末尾，绝不回头修改已写入的数据。**
            这一简单的约束带来了三个关键优势：
            
            
- **顺序写入（Sequential
            Write）**：磁盘的顺序写入带宽远高于随机写入， 在 HDD
            上可以轻松达到 100 MB/s 以上，而随机写入往往只有几
            MB/s。
            
- **写入原子性天然友好**：追加写入要么成功、要么不成功，
            不存在”写了一半覆盖了旧数据”的中间状态，这大幅简化了崩溃恢复逻辑。
            
- **并发控制简化**：由于旧数据不会被修改，读操作可以安全地访问历史版本，
            而不需要复杂的锁机制。
            
            

### 1.2 不可变日志的概念

            

不可变日志（Immutable Log）是日志结构存储的基石。
            每一次写操作——无论是插入（Insert）、更新（Update）还是删除（Delete）——
            都会在日志文件的尾部追加一条新记录。
            对于更新操作，新记录包含同一个键（Key）的最新值（Value）；
            对于删除操作，新记录是一个特殊的墓碑标记（Tombstone）。
            

这意味着同一个键可能在日志中出现多次，只有最后一条记录是有效的。
            这看起来会浪费磁盘空间，但正如我们后面会看到的，
            通过合并（Compaction）过程可以定期回收这些空间。
            

下面用一个简单的例子来说明：
            
```
时间线 →

写入 key=a, value=100    [a:100]
写入 key=b, value=200    [a:100][b:200]
更新 key=a, value=150    [a:100][b:200][a:150]
删除 key=b               [a:100][b:200][a:150][b:tombstone]
```

            

在上面的日志中，`a` 的最新值是
            150，`b` 已被删除。
            前两条记录（`a:100` 和
            `b:200`）都是过时的，可以在合并时被清除。
            

### 1.3 为什么顺序 I/O
            如此重要

            

为了更直观地理解顺序 I/O（Sequential I/O）与随机
            I/O（Random I/O）的性能差距，
            下面给出一组典型的磁盘性能数据：
            
```
┌─────────────────────┬──────────────┬──────────────┐
│ 指标                │ HDD (7200r)  │ SSD (NVMe)   │
├─────────────────────┼──────────────┼──────────────┤
│ 顺序读带宽          │ ~150 MB/s    │ ~3500 MB/s   │
│ 顺序写带宽          │ ~130 MB/s    │ ~3000 MB/s   │
│ 随机读 IOPS         │ ~150         │ ~500,000     │
│ 随机写 IOPS         │ ~150         │ ~400,000     │
│ 随机读延迟          │ ~8 ms        │ ~0.1 ms      │
│ 顺序读延迟          │ ~2 ms        │ ~0.02 ms     │
└─────────────────────┴──────────────┴──────────────┘
```

            

即使在 SSD 上，顺序 I/O 仍然比随机 I/O 快数倍。
            原因包括：操作系统（Operating
            System）的预读（Read-Ahead）优化、 SSD
            内部的并行通道利用率、以及减少的 FTL 映射压力。
            

因此，日志结构存储在几乎所有存储介质上都能获得更好的写入吞吐量。
            这也正是 Bitcask 选择追加写入作为其核心设计的根本原因。
            

### 1.4 日志结构的历史脉络

            

日志结构的思想最早可以追溯到 1990 年代的日志结构文件系统
            （Log-Structured File System, LFS）， 由 Rosenblum 和
            Ousterhout 在论文中提出。
            此后，这一思想被广泛应用于各种存储系统中：
            
            
- **日志结构合并树（Log-Structured Merge-Tree,
            LSM-Tree）**：
            将日志与排序结构结合，支持范围查询（Range Query）。
            
- **Bitcask**：将日志与内存哈希表结合，追求极致的单点读写性能。
            
- **预写日志（Write-Ahead Log, WAL）**：
            几乎所有数据库都使用 WAL
            来保证事务持久性（Durability）。
            
            

这些系统虽然在具体实现上各有不同，
            但都共享同一个核心洞察：**追加写入是磁盘最高效的写入模式。**
            
            

## 二、Bitcask 架构

            

### 2.1 论文背景

            

Bitcask 最初由 Basho Technologies 设计并实现，
            作为分布式数据库 Riak 的默认存储后端（Storage Backend）。
            其设计思想记录在 2010 年发布的经典论文 “Bitcask: A
            Log-Structured Hash Table for Fast Key/Value Data” 中。
            

论文开篇就提出了一个简洁的设计目标：
            
            

A storage system that provides low latency per item read
            or written, high throughput especially when writing an
            incoming stream of random items, ability to handle datasets
            much larger than RAM, and crash friendliness.
            
            

翻译过来就是：低延迟、高吞吐、支持大数据集、崩溃友好。
            Bitcask 用最简洁的数据结构实现了这些目标。
            

### 2.2 整体架构概览

            

Bitcask 的架构可以用两个核心组件来概括：
            
            
- **内存哈希表（KeyDir）**：
            存储每个键到其最新值在磁盘上位置的映射。
            
- **磁盘数据文件（Data Files）**：
            以追加方式写入的不可变日志文件。
            
            

整体架构如下图所示：
            
```
                    ┌─────────────────────────────────┐
                    │         内存（Memory）           │
                    │                                  │
                    │  ┌───────────────────────────┐   │
                    │  │        KeyDir              │   │
                    │  │                            │   │
                    │  │  key → (file_id,           │   │
                    │  │         offset,             │   │
                    │  │         size,               │   │
                    │  │         timestamp)          │   │
                    │  └───────────────────────────┘   │
                    └──────────────┬──────────────────┘
                                   │
                                   │ 查找
                                   ▼
                    ┌─────────────────────────────────┐
                    │         磁盘（Disk）             │
                    │                                  │
                    │  ┌─────────┐  ┌─────────┐       │
                    │  │ data    │  │ data    │ ...   │
                    │  │ file 1  │  │ file 2  │       │
                    │  │ (旧)    │  │ (旧)    │       │
                    │  └─────────┘  └─────────┘       │
                    │                                  │
                    │  ┌─────────┐                    │
                    │  │ active  │ ← 当前写入文件     │
                    │  │ file    │                    │
                    │  └─────────┘                    │
                    └─────────────────────────────────┘
```

            

### 2.3 KeyDir：内存中的索引

            

KeyDir
            是一个常驻内存的哈希表，其中每个条目包含以下信息：
            
```
┌──────────┬──────────────────────────────────────┐
│ 字段     │ 说明                                 │
├──────────┼──────────────────────────────────────┤
│ key      │ 键（作为哈希表的查找键）             │
│ file_id  │ 值所在的数据文件编号                 │
│ offset   │ 值在该数据文件中的字节偏移量         │
│ size     │ 值记录的总字节大小                   │
│ tstamp   │ 写入时间戳                           │
└──────────┴──────────────────────────────────────┘
```

            

KeyDir 的内存开销可以这样估算： 假设平均键长度为 32
            字节，每个条目的元数据占 24 字节（file_id 4 字节 + offset 8
            字节 + size 4 字节 + tstamp 8 字节），
            加上哈希表自身的开销（指针、负载因子等），每个键约需 80-100
            字节。 因此，1 亿个键大约需要 8-10 GB 内存。
            

### 2.4 数据文件格式

            

磁盘上的每条记录（Entry）采用以下格式：
            
```
┌────────┬────────┬─────────┬──────────┬───────┬───────┐
│ crc32  │ tstamp │ key_sz  │ value_sz │ key   │ value │
│ 4 字节 │ 8 字节 │ 4 字节  │ 4 字节   │ 变长  │ 变长  │
└────────┴────────┴─────────┴──────────┴───────┴───────┘
```

            

其中：
            
            
- **crc32**：循环冗余校验码（Cyclic
            Redundancy Check）， 用于检测数据损坏。
            
- **tstamp**：写入时的 Unix
            时间戳（Timestamp），精确到秒或毫秒。
            
- **key_sz /
            value_sz**：键和值的字节长度。
            
- **key / value**：实际的键和值数据。
            
            

每个数据文件有一个大小上限（通常为 1-2 GB）。
            当活跃文件（Active File）达到大小上限时，
            它会被关闭并变成只读的旧文件（Immutable File），
            同时创建一个新的活跃文件继续接收写入。
            

### 2.5 单次磁盘读取的保证

            

Bitcask 最核心的性能承诺是：
            **对于任意一个键的读取，最多只需要一次磁盘
            I/O。**
            

这是因为 KeyDir 已经告诉我们值的精确位置（file_id +
            offset + size），
            引擎只需打开对应的文件、定位到指定偏移量、读取指定大小的数据即可。
            不需要遍历索引层级（如 B+Tree 的多层节点），
            也不需要在多个文件中搜索（如 LSM-Tree 的多层 SSTable）。
            

当操作系统的页缓存（Page
            Cache）命中时，甚至不需要真正的磁盘 I/O，
            读取延迟可以降到微秒级别。
            
            

## 三、写入路径

            

### 3.1 写入流程详解

            

Bitcask 的写入流程极其简洁，可以分为以下几个步骤：
            
```
Put(key, value)
    │
    ▼
┌──────────────────────────────────┐
│ 1. 序列化记录                    │
│    构造 [crc|tstamp|ksz|vsz|k|v] │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 2. 追加写入活跃文件              │
│    write(active_file, record)    │
│    记录当前偏移量 offset         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 3. 更新 KeyDir                   │
│    keydir[key] = {               │
│      file_id,                    │
│      offset,                     │
│      size,                       │
│      tstamp                      │
│    }                             │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 4. 检查文件大小                  │
│    if active_file.size > limit:  │
│      关闭当前文件，创建新文件    │
└──────────────────────────────────┘
```

            

### 3.2 写入性能分析

            

整个写入路径的时间复杂度为 O(1)：
            
            
- 序列化记录：O(key_size +
            value_size)，通常可以忽略。
            
- 追加写入：一次顺序写入系统调用（System
            Call），性能极高。
            
- 更新 KeyDir：哈希表的 O(1) 查找和更新。
            
            

由于写入总是追加到文件末尾，Bitcask
            的写入吞吐量主要受磁盘顺序写带宽限制。 在典型的服务器级 SSD
            上，Bitcask 可以轻松达到每秒数十万次写入。
            

### 3.3 删除操作

            

删除操作在 Bitcask 中并不是真正地从磁盘上移除数据，
            而是写入一条特殊的墓碑记录（Tombstone Record）。
            墓碑记录的值部分通常是一个特殊的标记（如空值或特定的魔数），
            表示该键已被删除。
            
```
Delete(key)
    │
    ▼
  追加墓碑记录到活跃文件
  [crc|tstamp|ksz|vsz=TOMBSTONE|key|]
    │
    ▼
  从 KeyDir 中移除该键的条目
```

            

在 KeyDir 中移除该键后，后续的读取操作将无法找到该键，
            等效于数据已被删除。磁盘上的旧数据和墓碑记录会在合并过程中被清理。
            

### 3.4 持久性保证

            

Bitcask
            的持久性（Durability）策略可以根据需求进行配置：
            
            
- **每次写入后调用
            fsync**：保证每次写入都持久化到磁盘，
            但会显著降低写入性能（因为 fsync
            需要等待磁盘控制器确认）。
            
- **定期 fsync**：每 N 次写入或每 T
            毫秒调用一次 fsync， 在性能与持久性之间取得平衡。
            
- **依赖操作系统刷盘**：不主动调用 fsync，
            依赖操作系统在适当时机将页缓存刷入磁盘。
            性能最高，但在断电时可能丢失最近的写入数据。
            
            

在实际生产环境中，大多数 Bitcask 部署选择定期 fsync
            策略， 以平衡写入性能和数据安全性。
            

### 3.5 并发写入

            

Bitcask
            的原始设计中，同一时刻只有一个进程（Process）可以打开活跃文件进行写入。
            这意味着写入操作是单线程（Single-Threaded）的，
            天然避免了写-写冲突（Write-Write Conflict）。
            

读取操作则可以并发执行，因为旧的数据文件是不可变的，
            多个读取线程可以同时访问不同的数据文件而不需要加锁。
            

这种设计在大多数场景下是足够的，因为追加写入的速度很快，
            单线程写入很少成为瓶颈。如果确实需要更高的写入并发度，
            可以通过分片（Sharding）——即运行多个独立的 Bitcask
            实例来实现。
            
            

## 四、读取路径

            

### 4.1 读取流程详解

            

Bitcask 的读取流程同样简洁：
            
```
Get(key)
    │
    ▼
┌──────────────────────────────────┐
│ 1. 查找 KeyDir                   │
│    entry = keydir[key]           │
│    if entry == nil:              │
│      return NOT_FOUND            │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 2. 读取磁盘                     │
│    fd = open(entry.file_id)      │
│    seek(fd, entry.offset)        │
│    record = read(fd, entry.size) │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 3. 校验数据                     │
│    verify crc32(record)          │
│    if failed: return ERROR       │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ 4. 返回值                       │
│    return record.value           │
└──────────────────────────────────┘
```

            

### 4.2 文件描述符管理

            

由于 Bitcask
            可能积累大量的数据文件，为每次读取都打开和关闭文件显然是低效的。
            实际实现中通常会维护一个文件描述符池（File Descriptor
            Pool）， 预先打开所有数据文件并缓存其文件描述符（File
            Descriptor）。
            
```
┌─────────────────────────────────────┐
│        文件描述符池                  │
│                                      │
│  file_id=1  →  fd=3                 │
│  file_id=2  →  fd=5                 │
│  file_id=3  →  fd=7                 │
│  ...                                │
│  file_id=N  →  fd=2N+1             │
└─────────────────────────────────────┘
```

            

需要注意的是，操作系统对单个进程能打开的文件描述符数量有限制
            （通常默认为 1024，可以通过 `ulimit -n` 调整）。
            当数据文件数量很多时，需要确保这个限制足够大。
            

### 4.3 读取性能分析

            

Bitcask 的读取性能可以分为两种情况：
            

**缓存命中（Cache Hit）**：
            当请求的数据页已经在操作系统的页缓存中时，
            读取操作无需真正的磁盘 I/O，延迟通常在微秒级别。
            这种情况在热点数据（Hot Data）场景下非常常见。
            

**缓存未命中（Cache Miss）**：
            当数据页不在页缓存中时，需要一次真正的磁盘 I/O。 在 HDD
            上，这意味着一次随机读取，延迟约 8-10 毫秒； 在 SSD
            上，延迟约 0.1 毫秒。
            

无论哪种情况，Bitcask
            都保证**最多一次磁盘读取**， 这是其相比
            LSM-Tree（可能需要多次读取）的核心优势之一。
            

### 4.4 读取放大

            

读取放大（Read Amplification）是指为了读取一条有效数据，
            实际需要从磁盘读取的数据量与有效数据量的比值。
            

在 Bitcask 中，读取放大严格为 1：
            每次读取只需要读取一条记录的完整数据（包括头部元数据和键值对），
            不需要读取任何额外的索引块或元数据页。
            

这与 B+Tree 形成了鲜明对比——B+Tree 的一次读取可能需要遍历
            3-4 层索引节点，读取放大为 3-4 倍。 LSM-Tree
            在最坏情况下可能需要检查每一层的 SSTable， 读取放大可能达到
            10 倍以上。
            

### 4.5 Scan 与遍历

            

Bitcask 虽然不直接支持高效的范围查询（Range Query），
            但可以支持全量遍历（Full Scan）操作： 引擎只需遍历 KeyDir
            中的所有键，依次读取对应的值即可。
            

不过，由于 KeyDir
            是无序的哈希表，遍历的结果没有特定的顺序，
            也无法高效地按键的字典序（Lexicographic Order）返回结果。
            如果需要有序遍历，只能先将所有键排序后再逐个查找，
            效率较低。
            
            

## 五、合并（Compaction）与
            Hint File

            

### 5.1 为什么需要合并

            

随着写入操作的持续进行，磁盘上会积累大量的过时数据：
            被更新的键的旧值、被删除的键的数据以及墓碑记录。
            这些过时数据占用磁盘空间但不再有用，需要通过合并过程来清理。
            

空间放大（Space Amplification）是指磁盘上实际占用的空间
            与有效数据（最新版本的所有键值对）所需空间的比值。
            没有合并的情况下，空间放大可能达到数十倍甚至更高。
            

### 5.2 合并流程

            

合并过程的核心逻辑如下：
            
```
Merge()
    │
    ▼
┌──────────────────────────────────────────┐
│ 1. 选择待合并的旧数据文件                │
│    files = select_old_files()            │
│    （不包括当前活跃文件）                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 2. 遍历所有待合并文件中的记录            │
│    for each record in files:             │
│      if keydir[record.key].file_id       │
│         == current_file                  │
│         && keydir[record.key].offset     │
│         == current_offset:               │
│        → 该记录是最新的，写入新文件       │
│      else:                               │
│        → 该记录已过时，跳过              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 3. 更新 KeyDir                           │
│    将已迁移记录的位置信息指向新文件       │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 4. 删除旧文件                            │
│    remove(old_files)                     │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 5. 生成 Hint File                        │
│    为新的合并文件生成对应的 hint 文件     │
└──────────────────────────────────────────┘
```

            

### 5.3 判断记录是否最新

            

在合并过程中，一个关键问题是如何判断某条记录是否仍然有效。
            Bitcask 采用一种简洁而高效的方法：
            

对于遍历到的每条记录，检查 KeyDir 中该键的条目。 如果
            KeyDir 中记录的 `file_id` 和 `offset`
            与当前遍历到的记录一致，
            则说明这条记录是最新的，应该被保留；否则，该记录已过时，可以跳过。
            
```
// 伪代码：判断记录是否最新
func isLatest(key []byte, fileID int, offset int64) bool {
    entry, exists := keydir[string(key)]
    if !exists {
        return false // 键已被删除
    }
    return entry.FileID == fileID && entry.Offset == offset
}
```

            

### 5.4 Hint File
            的结构与作用

            

Hint File 是 Bitcask 中一个非常巧妙的设计，
            它的存在是为了加速系统重启时的索引重建过程。
            

在没有 Hint File 的情况下，Bitcask
            重启时需要遍历所有数据文件的每条记录， 解析键和值，才能重建
            KeyDir。这个过程的时间复杂度与数据总量成正比，
            可能需要数分钟甚至更长时间。
            

Hint File 本质上是数据文件的”索引摘要”，
            它包含数据文件中每条记录的键和位置信息，但**不包含值**：
            
```
Hint File 记录格式：
┌────────┬─────────┬──────────┬──────────┬───────┐
│ tstamp │ key_sz  │ value_sz │ offset   │ key   │
│ 8 字节 │ 4 字节  │ 4 字节   │ 8 字节   │ 变长  │
└────────┴─────────┴──────────┴──────────┴───────┘
```

            

由于 Hint File
            不包含值数据，它的大小通常只有对应数据文件的几分之一。
            重启时，引擎可以优先读取 Hint File 来快速重建 KeyDir，
            大幅缩短启动时间。
            

### 5.5 合并策略

            

实际部署中，合并操作的触发策略需要仔细考量：
            
            
- **触发条件**：可以基于时间周期（如每小时一次）、
            数据文件数量（如超过 10 个旧文件时触发）、
            或空间放大比例（如超过 2 倍时触发）。
            
- **合并窗口**：通常在系统负载较低的时段进行合并，
            以避免与正常的读写操作竞争 I/O 带宽。
            
- **合并粒度**：可以选择合并所有旧文件，
            也可以只合并最老的几个文件（增量合并）。
            
            

Riak 中的 Bitcask 实现提供了以下配置选项：
            
```
%% Riak Bitcask 合并配置示例
{bitcask, [
    {merge_window, {start, 0}, {end, 6}},    %% 合并窗口：午夜到凌晨6点
    {merge_check_interval, 300},              %% 每5分钟检查一次是否需要合并
    {max_merge_size, 1073741824},             %% 单个合并文件最大1GB
    {frag_merge_trigger, 60},                 %% 碎片率超过60%时触发合并
    {dead_bytes_merge_trigger, 536870912}     %% 死数据超过512MB时触发合并
]}
```

            

### 5.6 合并过程中的读写影响

            

合并操作在后台进行时，正常的读写操作不会被阻塞：
            
            
- **写入不受影响**：新的写入继续追加到活跃文件，与合并操作互不干扰。
            
- **读取可能受到轻微影响**：合并过程需要读取旧文件的数据，
            这可能与正常的读取操作竞争磁盘 I/O 带宽。
            不过，由于合并是顺序读取，对 SSD 的影响较小。
            
            

合并完成后，旧文件的文件描述符会被关闭，相应的磁盘空间被释放。
            KeyDir 中的条目会被原子地更新为新文件的位置信息。
            
            

## 六、崩溃恢复

            

### 6.1 恢复的基本原理

            

Bitcask 的崩溃恢复（Crash
            Recovery）利用了追加写入的天然优势：
            由于数据文件是不可变的（活跃文件除外），崩溃不会损坏已关闭的旧文件。
            唯一可能受到影响的是正在写入的活跃文件的最后几条记录。
            

恢复过程的核心任务是重建
            KeyDir——也就是在内存中重建每个键到其最新值位置的映射。
            

### 6.2 恢复流程

            
```
Startup / Recovery
    │
    ▼
┌──────────────────────────────────────────┐
│ 1. 扫描数据目录                          │
│    找到所有数据文件和 hint 文件           │
│    按文件编号排序                         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 2. 处理有 hint 文件的旧数据文件          │
│    读取 hint 文件（不含值，速度快）       │
│    将键和位置信息加载到 KeyDir            │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 3. 处理没有 hint 文件的旧数据文件        │
│    逐条扫描数据文件                       │
│    验证 CRC 校验和                        │
│    将有效记录的键和位置加载到 KeyDir      │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 4. 处理活跃文件（最后一个数据文件）      │
│    逐条扫描，验证 CRC                    │
│    丢弃最后一条不完整的记录（如果有）     │
│    将有效记录加载到 KeyDir                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│ 5. 打开新的活跃文件                      │
│    准备接收新的写入                       │
└──────────────────────────────────────────┘
```

            

### 6.3 CRC 校验的作用

            

每条记录的 CRC32 校验码在恢复过程中扮演着关键角色。
            当引擎逐条扫描数据文件时，它会重新计算每条记录的 CRC 值
            并与存储的 CRC 进行比较：
            
            
- 如果 CRC 匹配，记录完整且未损坏。
            
- 如果 CRC
            不匹配，记录可能已损坏（例如在写入过程中断电），
            该记录以及其后的所有记录都会被丢弃。
            
            
```
// CRC 校验伪代码
func verifyRecord(data []byte) bool {
    storedCRC := binary.BigEndian.Uint32(data[:4])
    computedCRC := crc32.ChecksumIEEE(data[4:])
    return storedCRC == computedCRC
}
```

            

### 6.4 启动时间优化

            

在数据量较大时，Bitcask 的启动时间可能成为一个关注点。
            以下是一些优化策略：
            
            
- 

**优先使用 Hint File**：如前所述，Hint
            File 不包含值数据，
            读取速度远快于完整的数据文件。确保合并操作总是生成 Hint
            File。
            
- 

**并行加载**：多个旧数据文件的 Hint File
            可以并行读取， 利用多核 CPU 和磁盘的并行读取能力。
            
- 

**增量检查点（Checkpoint）**：
            定期将当前的 KeyDir 快照持久化到磁盘。
            重启时只需加载最近的检查点，然后重放检查点之后的写入操作。
            
- 

**启动时间估算**：假设磁盘顺序读速度为
            200 MB/s， 所有键的 Hint File 总大小为 2 GB，则加载时间约为
            10 秒。 如果没有 Hint File，需要读取完整数据文件（假设 100
            GB）， 加载时间则可能需要 500 秒（约 8 分钟）。
            
            

### 6.5 部分写入与原子性

            

崩溃时最棘手的场景是部分写入（Partial Write）：
            一条记录只写了一半就发生了断电。Bitcask
            的处理方式非常简单：
            

由于追加写入的特性，部分写入只可能出现在活跃文件的末尾。
            恢复时，CRC 校验会检测到这条不完整的记录，引擎直接将其丢弃。
            已经完整写入的记录不会受到影响。
            

这种处理方式的代价是可能丢失最后一次或几次写入的数据，
            但保证了系统状态的一致性——绝不会出现”写了一半”的损坏数据。
            
            

## 七、Bitcask 的局限

            

### 7.1 所有键必须装入内存

            

这是 Bitcask 最大的限制。由于 KeyDir
            必须将所有键及其元数据保存在内存中， Bitcask
            所能管理的键的数量直接受限于可用内存大小。
            

根据前面的估算，每个键约需 80-100 字节的内存空间。
            下表展示了不同内存规格下 Bitcask 能管理的最大键数量：
            
```
┌──────────────┬──────────────────────────┐
│ 可用内存     │ 最大键数量（估算）       │
├──────────────┼──────────────────────────┤
│ 1 GB         │ ~1000 万                 │
│ 4 GB         │ ~4000 万                 │
│ 16 GB        │ ~1.6 亿                  │
│ 64 GB        │ ~6.4 亿                  │
│ 256 GB       │ ~25 亿                   │
└──────────────┴──────────────────────────┘
```

            

对于键数量超过可用内存的场景，Bitcask 不是合适的选择。
            此时应考虑 LSM-Tree 或 B+Tree 等支持磁盘索引的引擎。
            

### 7.2 不支持范围查询

            

由于 KeyDir 是无序的哈希表，Bitcask
            无法高效地执行范围查询。 例如，以下查询在 Bitcask
            中无法高效完成：
            
```
SELECT * WHERE key BETWEEN 'user:1000' AND 'user:2000'
SELECT * WHERE key LIKE 'session:2025-01-%'
```

            

要实现这些查询，只能遍历整个 KeyDir 并过滤， 时间复杂度为
            O(N)，其中 N 是总键数。 对于需要范围查询的场景，LSM-Tree（如
            RocksDB、LevelDB） 或 B+Tree（如
            BoltDB、LMDB）是更好的选择。
            

### 7.3 值大小的考量

            

虽然 Bitcask 在理论上不限制单个值的大小，
            但在实际使用中需要注意以下问题：
            
            
- **大值写入**：单个很大的值（如几十
            MB）会占用活跃文件的大量空间，
            导致文件很快达到大小上限。
            
- **合并效率**：大值会拖慢合并过程，因为需要复制大量数据。
            
- **读取延迟**：读取大值需要更多的磁盘 I/O
            时间。
            
            

通常建议将 Bitcask 用于值大小在几 KB 到几十 KB
            范围内的场景。 对于大型二进制对象（Binary Large Object,
            BLOB）， 建议使用专门的对象存储系统。
            

### 7.4 启动时间

            

如前所述，Bitcask 在启动时需要重建 KeyDir，
            这需要扫描所有数据文件或 Hint File。
            当数据量很大时，启动时间可能达到数分钟级别。
            

这在需要快速故障转移（Failover）的场景中可能是一个问题。
            例如，在一个有 10 亿个键的 Bitcask 实例中， 即使使用 Hint
            File，启动时间也可能需要 30-60 秒。
            

### 7.5 写放大

            

Bitcask 的写放大（Write Amplification）主要来自合并过程。
            每次合并都需要将有效数据从旧文件复制到新文件，
            这意味着每条有效数据在其生命周期内可能被写入磁盘多次。
            

写放大的程度取决于合并策略和数据更新频率：
            
            
- 如果数据很少更新（冷数据居多），空间放大低，合并频率低，写放大也低。
            
- 如果数据频繁更新（热数据居多），旧版本堆积快，
            需要频繁合并，写放大较高。
            
            

### 7.6 单写者限制

            

Bitcask 的原始设计仅支持单个进程写入活跃文件。
            这意味着在需要多节点写入的分布式场景中，
            每个节点通常运行自己的 Bitcask 实例， 由上层系统（如
            Riak）负责数据分片和路由。
            
            

## 八、Riak 中的 Bitcask

            

### 8.1 Riak 简介

            

Riak 是由 Basho Technologies
            开发的分布式键值数据库（Distributed Key-Value Database），
            其设计深受 Amazon Dynamo 论文的影响。 Riak
            的核心特性包括：
            
            
- **无主架构（Masterless Architecture）**：
            所有节点地位平等，没有单点故障。
            
- **一致性哈希（Consistent Hashing）**：
            数据通过一致性哈希环分布到各个节点。
            
- **可调一致性（Tunable Consistency）**：
            通过 R/W/N 参数控制读写操作的一致性级别。
            
- **可插拔存储后端（Pluggable Storage
            Backend）**： 支持 Bitcask、LevelDB
            等多种存储引擎。
            
            

### 8.2 Bitcask 作为 Riak
            的后端

            

在 Riak 中，Bitcask 是默认的存储后端。每个 Riak
            vnode（虚拟节点） 运行一个独立的 Bitcask 实例，管理该 vnode
            负责的数据分区。
            

典型的部署配置如下：
            
```
%% riak.conf 中的 Bitcask 配置
storage_backend = bitcask

%% bitcask 相关配置
bitcask.data_root = /var/lib/riak/bitcask
bitcask.max_file_size = 2147483648          %% 2 GB
bitcask.merge_window = always               %% 随时可合并
bitcask.merge_check_interval = 3m           %% 每3分钟检查
bitcask.frag_merge_trigger = 60             %% 碎片率 60%
bitcask.dead_bytes_merge_trigger = 512MB
bitcask.frag_threshold = 40                 %% 碎片率阈值
bitcask.dead_bytes_threshold = 128MB
bitcask.small_file_threshold = 10MB         %% 小文件合并阈值
bitcask.max_fold_age = -1                   %% fold 操作无超时
bitcask.max_fold_puts = 0                   %% fold 期间不限制 put
bitcask.expiry_secs = -1                    %% 无过期
bitcask.require_hint_crc = true             %% 启用 hint CRC 校验
bitcask.sync_strategy = none                %% 不主动 fsync
```

            

### 8.3 运维经验

            

在生产环境中运维 Riak + Bitcask
            组合，以下是一些经验总结：
            

**监控指标**：
            
            
- KeyDir 大小：监控每个 vnode 的 KeyDir
            条目数和内存占用。
            
- 数据文件数量：过多的数据文件意味着合并可能没有及时进行。
            
- 合并进度：监控合并操作的频率和耗时。
            
- 启动时间：在计划维护时关注 vnode 的启动恢复时间。
            
            

**常见问题**：
            
            
- **内存不足**：当键数量超过预期时，KeyDir
            可能耗尽内存。
            解决方案包括：增加内存、减少键的数量、或切换到 LevelDB
            后端。
            
- **合并风暴（Merge Storm）**：
            大量数据文件同时触发合并，导致磁盘 I/O 饱和。
            解决方案：配置合并窗口，限制并发合并数量。
            
- **启动时间过长**：大量数据导致 KeyDir
            重建耗时过长。 解决方案：确保生成 Hint File，或考虑减小单个
            vnode 的数据量。
            
            

### 8.4 Bitcask 与 LevelDB
            的选择

            

在 Riak 中，Bitcask 和 LevelDB 是两个最常用的存储后端。
            选择哪个取决于具体的使用场景：
            
```
┌──────────────────┬──────────────┬──────────────┐
│ 特性             │ Bitcask      │ LevelDB      │
├──────────────────┼──────────────┼──────────────┤
│ 读取延迟         │ 极低（1次IO）│ 较低（多次IO）│
│ 写入吞吐         │ 极高         │ 高           │
│ 范围查询         │ 不支持       │ 支持         │
│ 内存要求         │ 高（全键）   │ 低           │
│ 启动时间         │ 较长         │ 较短         │
│ 空间效率         │ 中等         │ 较好         │
│ 适用场景         │ 会话存储、   │ 时序数据、   │
│                  │ 缓存、计数器 │ 二级索引     │
└──────────────────┴──────────────┴──────────────┘
```

            

### 8.5 Riak 退出后的
            Bitcask 遗产

            

虽然 Basho Technologies 已经不再活跃运营， 但 Bitcask
            的设计理念在许多现代存储引擎中得到了延续。 例如，Go
            生态中的一些嵌入式键值存储 （如
            `go.etcd.io/bbolt`
            的日志部分、`github.com/rosedblabs/rosedb`）
            都借鉴了 Bitcask 的追加写入加内存索引的思路。
            
            

## 九、用 Go 实现简化版
            Bitcask

            

### 9.1 设计概述

            

下面我们用 Go 语言实现一个简化版的 Bitcask 存储引擎。
            这个实现包含以下核心功能：
            
            
- `Put(key, value)`：写入键值对。
            
- `Get(key)`：读取键对应的值。
            
- `Delete(key)`：删除指定的键。
            
- `Merge()`：合并旧数据文件，回收空间。
            
- `Close()`：关闭引擎，释放资源。
            
            

为了简化实现，我们做以下约定：
            
            
- 键和值均为 `[]byte` 类型。
            
- 单进程访问，不考虑并发安全（生产实现中应加锁）。
            
- 数据文件大小上限为 256 MB。
            
- 使用 CRC32 校验数据完整性。
            
            

### 9.2 数据结构定义

            
```
package bitcask

import (
    "encoding/binary"
    "hash/crc32"
    "io"
    "os"
    "path/filepath"
    "sort"
    "strconv"
    "strings"
    "sync"
    "time"
)

const (
    headerSize     = 20 // crc(4) + tstamp(8) + ksz(4) + vsz(4)
    maxFileSize    = 256 * 1024 * 1024
    tombstoneValue = "__BITCASK_TOMBSTONE__"
)

// KeyDirEntry 表示 KeyDir 中的一个条目。
type KeyDirEntry struct {
    FileID    int
    Offset    int64
    Size      int
    Timestamp int64
}

// Bitcask 是存储引擎的主结构体。
type Bitcask struct {
    dir        string
    mu         sync.RWMutex
    keydir     map[string]KeyDirEntry
    activeFile *os.File
    activeID   int
    activeOff  int64
    dataFiles  map[int]*os.File
}
```

            

### 9.3 引擎初始化与恢复

            
```
// Open 打开或创建一个 Bitcask 实例。
func Open(dir string) (*Bitcask, error) {
    if err := os.MkdirAll(dir, 0755); err != nil {
        return nil, err
    }
    bc := &Bitcask{
        dir:       dir,
        keydir:    make(map[string]KeyDirEntry),
        dataFiles: make(map[int]*os.File),
    }
    if err := bc.recover(); err != nil {
        return nil, err
    }
    if err := bc.openActiveFile(); err != nil {
        return nil, err
    }
    return bc, nil
}

// recover 扫描数据目录，重建 KeyDir。
func (bc *Bitcask) recover() error {
    entries, err := os.ReadDir(bc.dir)
    if err != nil {
        return err
    }
    var fileIDs []int
    for _, e := range entries {
        if strings.HasSuffix(e.Name(), ".data") {
            idStr := strings.TrimSuffix(e.Name(), ".data")
            id, err := strconv.Atoi(idStr)
            if err != nil {
                continue
            }
            fileIDs = append(fileIDs, id)
        }
    }
    sort.Ints(fileIDs)

    for _, id := range fileIDs {
        if err := bc.loadDataFile(id); err != nil {
            return err
        }
    }
    if len(fileIDs) > 0 {
        bc.activeID = fileIDs[len(fileIDs)-1]
    }
    return nil
}

// loadDataFile 加载一个数据文件并重建 KeyDir 条目。
func (bc *Bitcask) loadDataFile(id int) error {
    path := filepath.Join(bc.dir, strconv.Itoa(id)+".data")
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    bc.dataFiles[id] = f

    var offset int64
    for {
        header := make([]byte, headerSize)
        if _, err := io.ReadFull(f, header); err != nil {
            break
        }
        ksz := int(binary.BigEndian.Uint32(header[12:16]))
        vsz := int(binary.BigEndian.Uint32(header[16:20]))
        payload := make([]byte, ksz+vsz)
        if _, err := io.ReadFull(f, payload); err != nil {
            break
        }
        // 校验 CRC
        storedCRC := binary.BigEndian.Uint32(header[:4])
        computedCRC := crc32.ChecksumIEEE(append(header[4:], payload...))
        if storedCRC != computedCRC {
            break
        }
        key := string(payload[:ksz])
        value := string(payload[ksz:])
        tstamp := int64(binary.BigEndian.Uint64(header[4:12]))
        totalSize := headerSize + ksz + vsz

        if value == tombstoneValue {
            delete(bc.keydir, key)
        } else {
            bc.keydir[key] = KeyDirEntry{
                FileID:    id,
                Offset:    offset,
                Size:      totalSize,
                Timestamp: tstamp,
            }
        }
        offset += int64(totalSize)
    }
    return nil
}
```

            

### 9.4 写入与删除

            
```
// openActiveFile 创建新的活跃文件。
func (bc *Bitcask) openActiveFile() error {
    bc.activeID++
    path := filepath.Join(bc.dir, strconv.Itoa(bc.activeID)+".data")
    f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0644)
    if err != nil {
        return err
    }
    bc.activeFile = f
    bc.activeOff = 0
    bc.dataFiles[bc.activeID] = f
    return nil
}

// encodeRecord 将键值对编码为磁盘记录。
func encodeRecord(key, value []byte) []byte {
    ksz := len(key)
    vsz := len(value)
    buf := make([]byte, headerSize+ksz+vsz)
    tstamp := time.Now().UnixMilli()
    binary.BigEndian.PutUint64(buf[4:12], uint64(tstamp))
    binary.BigEndian.PutUint32(buf[12:16], uint32(ksz))
    binary.BigEndian.PutUint32(buf[16:20], uint32(vsz))
    copy(buf[headerSize:], key)
    copy(buf[headerSize+ksz:], value)
    crc := crc32.ChecksumIEEE(buf[4:])
    binary.BigEndian.PutUint32(buf[:4], crc)
    return buf
}

// Put 写入一个键值对。
func (bc *Bitcask) Put(key, value []byte) error {
    record := encodeRecord(key, value)
    if bc.activeOff+int64(len(record)) > maxFileSize {
        bc.activeFile.Sync()
        if err := bc.openActiveFile(); err != nil {
            return err
        }
    }
    if _, err := bc.activeFile.Write(record); err != nil {
        return err
    }
    bc.keydir[string(key)] = KeyDirEntry{
        FileID:    bc.activeID,
        Offset:    bc.activeOff,
        Size:      len(record),
        Timestamp: time.Now().UnixMilli(),
    }
    bc.activeOff += int64(len(record))
    return nil
}

// Delete 删除一个键。
func (bc *Bitcask) Delete(key []byte) error {
    if err := bc.Put(key, []byte(tombstoneValue)); err != nil {
        return err
    }
    delete(bc.keydir, string(key))
    return nil
}
```

            

### 9.5 读取

            
```
// Get 读取指定键的值。
func (bc *Bitcask) Get(key []byte) ([]byte, error) {
    entry, ok := bc.keydir[string(key)]
    if !ok {
        return nil, os.ErrNotExist
    }
    f, ok := bc.dataFiles[entry.FileID]
    if !ok {
        return nil, os.ErrNotExist
    }
    buf := make([]byte, entry.Size)
    if _, err := f.ReadAt(buf, entry.Offset); err != nil {
        return nil, err
    }
    // CRC 校验
    storedCRC := binary.BigEndian.Uint32(buf[:4])
    computedCRC := crc32.ChecksumIEEE(buf[4:])
    if storedCRC != computedCRC {
        return nil, crc32ErrCorrupted
    }
    ksz := int(binary.BigEndian.Uint32(buf[12:16]))
    value := buf[headerSize+ksz:]
    return value, nil
}

var crc32ErrCorrupted = &corruptedError{}

type corruptedError struct{}

func (e *corruptedError) Error() string {
    return "bitcask: data corrupted, CRC mismatch"
}
```

            

### 9.6 合并

            
```
// Merge 合并旧数据文件，回收磁盘空间。
func (bc *Bitcask) Merge() error {
    var oldIDs []int
    for id := range bc.dataFiles {
        if id != bc.activeID {
            oldIDs = append(oldIDs, id)
        }
    }
    if len(oldIDs) == 0 {
        return nil
    }
    sort.Ints(oldIDs)

    // 创建一个新的合并文件
    mergeID := bc.activeID + 1
    mergePath := filepath.Join(bc.dir, strconv.Itoa(mergeID)+".data")
    mergeFile, err := os.OpenFile(
        mergePath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0644,
    )
    if err != nil {
        return err
    }
    var mergeOff int64

    // 遍历 KeyDir，将仍在旧文件中的记录写入合并文件
    for key, entry := range bc.keydir {
        isOld := false
        for _, oid := range oldIDs {
            if entry.FileID == oid {
                isOld = true
                break
            }
        }
        if !isOld {
            continue
        }
        // 从旧文件读取数据
        f := bc.dataFiles[entry.FileID]
        buf := make([]byte, entry.Size)
        if _, err := f.ReadAt(buf, entry.Offset); err != nil {
            continue
        }
        // 写入合并文件
        if _, err := mergeFile.Write(buf); err != nil {
            mergeFile.Close()
            return err
        }
        bc.keydir[key] = KeyDirEntry{
            FileID:    mergeID,
            Offset:    mergeOff,
            Size:      entry.Size,
            Timestamp: entry.Timestamp,
        }
        mergeOff += int64(entry.Size)
    }
    mergeFile.Sync()
    bc.dataFiles[mergeID] = mergeFile

    // 关闭并删除旧文件
    for _, oid := range oldIDs {
        if f, ok := bc.dataFiles[oid]; ok {
            f.Close()
            delete(bc.dataFiles, oid)
        }
        oldPath := filepath.Join(bc.dir, strconv.Itoa(oid)+".data")
        os.Remove(oldPath)
    }

    // 切换活跃文件
    bc.activeFile.Sync()
    bc.activeID = mergeID + 1
    return bc.openActiveFile()
}
```

            

### 9.7 关闭

            
```
// Close 关闭 Bitcask 实例，释放所有资源。
func (bc *Bitcask) Close() error {
    if bc.activeFile != nil {
        bc.activeFile.Sync()
        bc.activeFile.Close()
    }
    for id, f := range bc.dataFiles {
        if id != bc.activeID {
            f.Close()
        }
    }
    return nil
}

// ListKeys 返回所有有效键的列表。
func (bc *Bitcask) ListKeys() []string {
    keys := make([]string, 0, len(bc.keydir))
    for k := range bc.keydir {
        keys = append(keys, k)
    }
    return keys
}
```

            

### 9.8 使用示例

            
```
package main

import (
    "fmt"
    "log"

    "example.com/bitcask"
)

func main() {
    // 打开或创建一个 Bitcask 实例
    db, err := bitcask.Open("./my-bitcask-data")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // 写入数据
    db.Put([]byte("name"), []byte("bitcask"))
    db.Put([]byte("version"), []byte("1.0.0"))
    db.Put([]byte("author"), []byte("basho"))

    // 读取数据
    val, err := db.Get([]byte("name"))
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("name = %s\n", val) // 输出: name = bitcask

    // 更新数据
    db.Put([]byte("version"), []byte("2.0.0"))
    val, _ = db.Get([]byte("version"))
    fmt.Printf("version = %s\n", val) // 输出: version = 2.0.0

    // 删除数据
    db.Delete([]byte("author"))
    _, err = db.Get([]byte("author"))
    fmt.Printf("author deleted: %v\n", err != nil) // 输出: author deleted: true

    // 列出所有键
    keys := db.ListKeys()
    fmt.Printf("remaining keys: %v\n", keys)

    // 执行合并，回收空间
    if err := db.Merge(); err != nil {
        log.Fatal(err)
    }
    fmt.Println("merge completed")
}
```

            

### 9.9 实现要点总结

            

上面的实现虽然简化了许多细节，但已经覆盖了 Bitcask
            的核心机制：
            
```
┌────────────────────┬──────────────────────────────┐
│ 特性               │ 实现状态                     │
├────────────────────┼──────────────────────────────┤
│ 追加写入           │ ✓ 活跃文件尾部追加           │
│ 内存哈希索引       │ ✓ keydir map                 │
│ CRC 校验           │ ✓ crc32 编码与校验           │
│ 文件轮转           │ ✓ 超过 maxFileSize 自动轮转  │
│ 墓碑删除           │ ✓ 特殊标记值                 │
│ 崩溃恢复           │ ✓ 启动时扫描重建 KeyDir      │
│ 合并回收           │ ✓ Merge 函数                 │
│ Hint File          │ ✗ 未实现（生产版本应实现）   │
│ 并发安全           │ ✗ 简化版未加锁               │
│ 文件描述符池       │ ✗ 简化版未优化               │
└────────────────────┴──────────────────────────────┘
```

            

在生产级实现中，还需要加入以下增强：
            
            
- **互斥锁（Mutex）**：保护 KeyDir
            和活跃文件的并发访问。
            
- **Hint File
            生成与读取**：加速启动恢复。
            
- **文件描述符池管理**：避免频繁的文件打开和关闭。
            
- **配置化参数**：支持自定义文件大小上限、fsync
            策略等。
            
- **错误处理优化**：更细粒度的错误类型和恢复逻辑。
            
            
            

## 十、Bitcask vs
            LSM-Tree vs B+Tree

            

### 10.1 三种引擎概述

            

在键值存储引擎的设计空间中， Bitcask、LSM-Tree 和 B+Tree
            代表了三种截然不同的设计哲学：
            
            
- **Bitcask**：追加日志 +
            内存哈希表。追求极致的单点读写性能。
            
- **LSM-Tree**：追加日志 +
            排序的磁盘文件（SSTable）。
            在写入性能和范围查询之间取得平衡。
            
- **B+Tree**：就地更新的平衡树。读取性能优秀，支持高效的范围查询。
            
            

### 10.2 详细对比

            
```
┌──────────────────────┬───────────────┬───────────────┬───────────────┐
│ 维度                 │ Bitcask       │ LSM-Tree      │ B+Tree        │
├──────────────────────┼───────────────┼───────────────┼───────────────┤
│ 写入模式             │ 追加          │ 追加          │ 就地更新      │
│ 索引结构             │ 内存哈希表    │ 多层 SSTable  │ 平衡树        │
│ 写入复杂度           │ O(1)          │ O(log N)      │ O(log N)      │
│ 点读复杂度           │ O(1)          │ O(log N)      │ O(log N)      │
│ 范围查询             │ 不支持        │ 支持          │ 支持          │
│ 写放大               │ 低-中         │ 中-高         │ 低            │
│ 读放大               │ 1             │ 1-10+         │ 3-4           │
│ 空间放大             │ 中            │ 中            │ 低            │
│ 内存要求             │ 高（全键）    │ 中（布隆过滤器│ 低（缓存）    │
│                      │               │  + 索引块）   │               │
│ 写入吞吐             │ 极高          │ 高            │ 中            │
│ 读取延迟             │ 极低（1次IO） │ 低-中         │ 低            │
│ 启动时间             │ 较长          │ 短            │ 短            │
│ 适用键数量           │ 有限（内存）  │ 无限          │ 无限          │
│ 代表实现             │ Riak/Bitcask  │ RocksDB,      │ BoltDB,       │
│                      │               │ LevelDB       │ LMDB, InnoDB  │
└──────────────────────┴───────────────┴───────────────┴───────────────┘
```

            

### 10.3 写入性能对比

            

Bitcask 的写入性能在三者中是最优的，因为它只需要：
            
            
- 一次顺序写入（追加到活跃文件）。
            
- 一次内存操作（更新 KeyDir）。
            
            

LSM-Tree 的写入也是顺序追加（先写 WAL，再写 MemTable），
            但后台的合并操作（Compaction）会带来额外的写放大。
            

B+Tree 的写入需要在树中找到正确的位置并就地更新，
            可能触发节点分裂（Split），涉及多次随机 I/O。
            
```
写入吞吐量排序（典型场景）：

Bitcask ≈ 50-100 万次/秒
    ▲
    │
LSM-Tree ≈ 10-50 万次/秒
    ▲
    │
B+Tree ≈ 5-20 万次/秒
```

            

### 10.4 读取性能对比

            

Bitcask 的读取在三者中通常也是最快的（缓存命中时）， 因为
            KeyDir 提供 O(1) 查找，且只需一次磁盘读取。
            

B+Tree 的读取需要遍历 2-4
            层节点，但由于内部节点通常被缓存在内存中， 实际的磁盘 I/O
            通常只有 1 次。
            

LSM-Tree 的读取在最坏情况下可能需要检查多层 SSTable，
            即使使用布隆过滤器（Bloom Filter）来跳过不包含目标键的
            SSTable， 读取放大仍然可能大于 1。
            

### 10.5 何时选择 Bitcask

            

基于以上分析，以下场景特别适合使用 Bitcask：
            

**适合 Bitcask 的场景**：
            
            
- 

**会话存储（Session Store）**： 键是会话
            ID（Session ID），值是会话数据。
            键的数量有限（活跃用户数），单点读写性能至关重要。
            
- 

**用户偏好存储（Preferences Store）**：
            键是用户 ID，值是用户偏好设置的 JSON 数据。
            键的数量等于用户数，通常可以放入内存。
            
- 

**URL 缩短服务（URL Shortener）**：
            键是短链接编码，值是原始 URL。
            写入量大但键总量有限，需要极低的读取延迟。
            
- 

**计数器服务（Counter Service）**：
            键是计数器名称，值是当前计数。
            高频更新，对写入性能要求极高。
            
- 

**消息队列的存储层（Message Queue
            Backend）**： 使用自增 ID 作为键，消息内容作为值。
            追加写入模式天然匹配消息队列的特点。
            
            

**不适合 Bitcask 的场景**：
            
            
- 键数量极大（数十亿级别），无法全部放入内存。
            
- 需要范围查询或有序遍历的场景。
            
- 需要复杂查询（如二级索引、过滤）的场景。
            
- 单个值很大（数 MB 以上）的场景。
            
            

### 10.6 混合使用策略

            

在实际的系统设计中，不同的存储引擎可以混合使用。
            例如，Riak 允许不同的
            Bucket（数据桶）使用不同的存储后端：
            
            
- 将频繁读写的小数据放在 Bitcask
            后端，获得极致的延迟。
            
- 将需要范围查询的数据放在 LevelDB
            后端，获得排序遍历能力。
            
- 将冷数据归档到外部的分布式文件系统。
            
            

这种混合策略在很多大型系统中都被采用，
            体现了”没有万能引擎，只有合适的引擎”这一工程哲学。
            

### 10.7 进一步的思考

            

Bitcask 的设计可以被看作是一个极端的权衡选择：
            它牺牲了范围查询能力和内存效率，换取了极致的单点读写性能。
            这种设计在特定工作负载下是最优的，但在通用场景下则有明显的局限。
            

现代存储引擎的设计趋势是在这些权衡之间找到更好的平衡点。
            例如：
            
            
- 

**WiscKey**（FAST 2016）：
            将键值分离（Key-Value Separation），键存储在 LSM-Tree 中，
            值存储在追加日志中。这样既支持范围查询，又减少了写放大。
            这可以看作 Bitcask 和 LSM-Tree 的混合体。
            
- 

**Bourbon**（OSDI 2020）：
            使用机器学习（Machine Learning）来优化 LSM-Tree 的合并策略，
            根据工作负载自适应地调整参数。
            
- 

**SILK**（ATC 2019）： 通过 I/O
            调度器来协调 LSM-Tree 的前台读写和后台合并，
            减少合并对读取延迟的影响。
            
            

这些工作都建立在 Bitcask 和 LSM-Tree 等经典设计的基础上，
            通过创新性的组合和优化来推动存储引擎的发展。
            
            

## 参考文献

            
            
- 

Justin Sheehy, David Smith. *Bitcask: A
            Log-Structured Hash Table for Fast Key/Value Data*.
            Basho Technologies, 2010. https://riak.com/assets/bitcask-intro.pdf
            
- 

Patrick O’Neil, Edward Cheng, Dieter Gawlick,
            Elizabeth O’Neil. *The Log-Structured Merge-Tree
            (LSM-Tree)*. Acta Informatica, 1996.
            
- 

Mendel Rosenblum, John K. Ousterhout. *The Design
            and Implementation of a Log-Structured File System*. ACM
            Transactions on Computer Systems, 1992.
            
- 

Giuseppe DeCandia et al. *Dynamo: Amazon’s Highly
            Available Key-Value Store*. SOSP, 2007.
            
- 

Lanyue Lu, Thanumalayan Sankaranarayana Pillai, et
            al. *WiscKey: Separating Keys from Values in
            SSD-Conscious Storage*. FAST, 2016.
            
- 

Sian Lun Lau, Boshi Chen, et al. *Bourbon: Learned
            Tree Structure-Aware Key-Value Store*. OSDI,
            2020.
            
- 

Oana Balmau, Rachid Guerraoui, et al. *SILK:
            Preventing Latency Spikes in Log-Structured Merge Key-Value
            Stores*. ATC, 2019.
            
- 

Riak KV Documentation. *Bitcask Backend
            Configuration*. https://docs.riak.com/riak/kv/latest/setup/planning/backend/bitcask/
            
- 

Martin Kleppmann. *Designing Data-Intensive
            Applications*, Chapter 3: Storage and Retrieval.
            O’Reilly Media, 2017.
            
            
            

**上一篇**: 索引结构：从
            B+Tree 到倒排索引
            

**下一篇**: LSM-Tree
            工程调优：三种放大的权衡
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】小文件与 Compaction

                    

拆解 lakehouse 小文件的根因（频繁提交、流式、过细分区），以及 bin-pack、sort/z-order/clustering、rewrite manifests、expire snapshots、remove orphan files 这套治理操作；讲清 Puffin 中 Theta NDV sketch 对查询 planning 的作用，附 PyIceberg 真实实验对比 compaction 前后文件数与 planning 耗时。
                

                
                    

2025-09-09 · storage
                    

### 【存储工程】LSM-Tree 工程调优：三种放大的权衡

                    

LSM-Tree 的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过 MemTable 刷盘、再经过多次 Compaction 合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个 key 时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在 Co…
                

                
                    

2025-09-10 · storage
                    

### 【存储工程】RocksDB 工程实践

                    

从 Column Family、Write Buffer、Block Cache、Compaction、Rate Limiter 到 Direct I/O 和监控，系统拆解 RocksDB 在生产环境中的关键配置与故障模式，并给出 SSD 场景下的配置模板和 db_bench 基准测试方法。
                

                
                    

2025-09-07 · storage
                    

### 【存储工程】索引结构：从 B+Tree 到倒排索引

                    

数据库里存了一亿行数据，要找出 userid 42 的那一行。没有索引的做法是全表扫描（Full Table Scan）——从第一个数据页读到最后一个数据页，逐行比对。假设每个数据页 16 KB，一亿行占 20 GB，即使顺序读能跑到 500 MB/s，也需要 40 秒。加一个 B+Tree 索引，三次磁盘 I/O 就…