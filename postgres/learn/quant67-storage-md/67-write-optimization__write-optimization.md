# 【存储工程】写入性能优化

来源: https://quant67.com/post/storage/67-write-optimization/write-optimization.html
日期: 2025-10-15 |

---

存储系统的写入路径，表面上是”把数据写到磁盘”，实际上涉及一条从用户空间到持久化介质的复杂链路：应用层的写入请求先进入内存缓冲区（Write
            Buffer），再序列化到预写日志（Write-Ahead
            Log，WAL），然后等待操作系统将脏页刷盘（fsync），最终落到物理介质上。这条链路上的每一环都有延迟开销，每一环也都有优化空间。
            

写入优化的核心矛盾始终是持久性（Durability）与吞吐量（Throughput）之间的权衡。每次
            fsync 都能保证数据不丢，但每次 fsync
            也意味着一次磁盘同步操作——在 SATA SSD 上约 0.1 到 0.5
            毫秒，在 HDD 上约 5 到 15 毫秒。如果每条记录都单独
            fsync，写入吞吐量将被 fsync 延迟锁死。反过来，如果完全不
            fsync，数据在断电时就会丢失。所有写入优化技术——分组提交（Group
            Commit）、批量写入（Batched Write）、写缓冲区调优、fsync
            频率控制、写入限速（Rate
            Limiting）——本质上都是在这条权衡曲线上寻找更优的工作点。
            

本文从写入路径的工程挑战开始，逐一拆解上述优化技术的原理与实现，再落到
            MySQL、PostgreSQL 和 RocksDB
            三个具体系统的调优实践。讨论范围限定在单节点写入优化；分布式写入涉及的复制延迟和一致性问题不在本文范围内。
            
            

**版本说明** 本文涉及的软件版本：MySQL
            8.0/8.4、PostgreSQL 16/17、RocksDB 9.x、Linux 6.x
            内核。不同版本的配置项和默认行为可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、写入性能的工程挑战

            

### 1.1 写入路径的延迟构成

            

一次数据库写入操作从用户发起到数据真正持久化，经历的典型路径如下：
            
```
应用层 → 网络层 → SQL 解析/事务管理 → WAL 写入 → fsync → 返回确认
                                        ↓
                                   MemTable 写入 → 后台刷盘 → SST 文件
```

            

在这条路径中，延迟主要集中在三个环节：
            

第一，WAL 的 fsync。事务提交时必须确保 WAL
            记录持久化，这要求至少一次 fsync 调用。单次 fsync
            的延迟取决于存储介质：NVMe SSD 约 20 到 100 微秒，SATA SSD
            约 100 到 500 微秒，HDD 约 5 到 15 毫秒。如果每个事务独立
            fsync，那么 HDD 上单线程最多每秒提交 60 到 200 个事务。
            

第二，锁竞争。多个并发写入者争夺 WAL
            写入权限时，需要某种形式的互斥。如果每个写入者都独立持锁、写入、fsync、释放锁，串行化开销会严重限制并发写入吞吐。
            

第三，后台刷盘的反压。当 MemTable 写满需要刷盘，或者
            LSM-Tree（Log-Structured
            Merge-Tree）的层级合并（Compaction）跟不上写入速度时，系统会触发写停顿（Write
            Stall），强制减速甚至阻塞前台写入。
            

### 1.2 关键性能指标

            

写入优化需要关注的指标不只是吞吐量。一个完整的写入性能画像至少包括：
            
            
            
            
            
            
            
            
            指标
            含义
            典型关注场景
            
            
            
            
            吞吐量（ops/s 或 MB/s）
            单位时间完成的写入操作数或数据量
            批量导入、日志写入
            
            
            P50/P99/P999 延迟
            写入延迟的分位数分布
            在线事务处理（OLTP）
            
            
            fsync 延迟
            单次 fsync 调用的耗时
            持久化瓶颈分析
            
            
            写停顿次数与持续时间
            Write Stall 事件的频率和影响时长
            LSM 存储引擎调优
            
            
            WAL 写入带宽
            WAL 文件的写入速率
            WAL 磁盘容量规划
            
            
            Compaction 待处理字节数
            等待合并的数据量
            写放大（Write Amplification）监控
            
            
            
            

### 1.3 写放大问题

            

写放大（Write
            Amplification，WA）是写入优化绕不开的话题。用户写入 1
            字节的数据，存储引擎实际可能写入数十字节到磁盘——WAL
            写一次，MemTable 刷盘写一次，Compaction 再写若干次。以
            RocksDB 为例，默认配置下 LSM-Tree 每层大小比例为
            10，理论写放大约为层数乘以 10 左右（实际取决于数据分布和
            Compaction 策略）。
            

写放大不仅消耗磁盘带宽，还加速 SSD 的磨损。对于 NAND
            Flash
            而言，每个存储单元（Cell）的擦写次数有限——TLC（Triple-Level
            Cell） 通常在 1000 到 3000 次之间，QLC（Quad-Level
            Cell）更低。高写放大意味着 SSD
            的实际寿命远低于容量计算的理论值。
            
            

## 二、WAL 分组提交

            

### 2.1 问题：逐事务 fsync
            的瓶颈

            

WAL 的设计目标是保证崩溃恢复（Crash
            Recovery）。每个事务提交前，必须确保其 WAL
            记录已经持久化到磁盘。最朴素的实现是：每个事务提交时，将 WAL
            记录写入文件，然后调用 fsync 等待磁盘确认。
            

这种逐事务 fsync 的方式有一个严重的性能问题：fsync
            是一个同步操作，调用者必须等待磁盘控制器确认数据已经从易失性缓存写到持久化介质。在此期间，调用线程被阻塞，其他等待提交的事务也无法推进。
            

假设 NVMe SSD 的 fsync 延迟为 50 微秒，逐事务 fsync
            的理论上限是每秒 20000 次 fsync，即每秒最多提交 20000
            个事务。但实际上，每次 fsync 之间还有 WAL
            序列化、锁操作等开销，实测吞吐通常远低于理论值。如果换成
            SATA SSD（fsync 延迟 200 微秒），上限降到每秒 5000
            次；HDD（fsync 延迟 10 毫秒）更是只有每秒 100 次。
            

### 2.2 分组提交的核心思想

            

分组提交（Group Commit）的核心思想是：将多个并发事务的
            WAL 记录合并到一次 fsync 中。多个事务各自将 WAL 记录写入 WAL
            缓冲区（WAL Buffer），然后由其中一个事务（称为
            leader）执行一次 fsync，这次 fsync
            同时持久化所有已写入的记录。其他事务（称为 follower）等待
            leader 的 fsync 完成后即可返回。
            

这样做的收益是显著的：如果 10
            个事务同时等待提交，原本需要 10 次 fsync，分组提交只需要 1
            次。fsync 的摊销成本从 1:1 降低到 1:N，其中 N
            是每批次的事务数。N 越大，吞吐量越高。
            
```
sequenceDiagram
    participant T1 as 事务 1（leader）
    participant T2 as 事务 2（follower）
    participant T3 as 事务 3（follower）
    participant WAL as WAL Buffer
    participant Disk as 磁盘

    T1->>WAL: 写入 WAL 记录
    T2->>WAL: 写入 WAL 记录
    T3->>WAL: 写入 WAL 记录
    T1->>Disk: fsync（合并刷盘）
    Disk-->>T1: fsync 完成
    T1-->>T2: 通知完成
    T1-->>T3: 通知完成
```

            

上图展示了分组提交的基本流程：事务 1 作为 leader
            收集同一批次内所有事务的 WAL 记录，执行一次
            fsync，然后通知所有 follower。三个事务只消耗了一次 fsync
            的延迟。
            

### 2.3 Leader/Follower
            选举机制

            

分组提交的关键实现细节是如何选举
            leader。常见的做法有两种：
            

**队列头选举**：所有等待提交的事务进入一个
            FIFO 队列。队列头部的事务自动成为
            leader，负责将队列中所有事务的 WAL 记录一次性 fsync。InnoDB
            的 Group Commit
            采用了这种思路（通过三阶段流水线实现，后文详述）。
            

**CAS
            竞争**：多个事务通过原子操作（Compare-And-Swap）竞争
            leader 角色。竞争成功者成为 leader，失败者成为 follower
            等待通知。PostgreSQL 的 WAL 写入流程采用了类似机制。
            

两种方式的核心目标一致：确保在 fsync
            延迟窗口内，尽可能多的事务被合并到同一批次。
            

### 2.4 InnoDB 的三阶段
            Group Commit

            

MySQL InnoDB 的 Group Commit
            实现采用了三阶段流水线（Pipeline）设计，这是为了同时解决
            binlog 与 InnoDB redo log
            的顺序一致性问题。三个阶段分别是：
            

**Flush 阶段**：leader 收集一批事务的
            binlog，将它们写入 binlog 文件（write 系统调用，写入 Page
            Cache）。
            

**Sync 阶段**：leader 对 binlog 文件执行
            fsync，将数据持久化。这是最耗时的阶段。
            

**Commit 阶段**：leader 将这批事务在 InnoDB
            中标记为已提交，更新 redo log 的提交标记。
            

每个阶段都有自己的 leader 和 follower 队列。当一个 leader
            在 Sync 阶段等待 fsync 返回时，新到达的事务可以进入 Flush
            阶段的队列，由下一个 leader
            开始收集。三个阶段形成流水线，提高了并发度。
            
```
时间线 →

Flush 阶段:  [Batch 1]          [Batch 2]          [Batch 3]
Sync 阶段:            [Batch 1]          [Batch 2]
Commit 阶段:                    [Batch 1]          [Batch 2]
```

            

相关参数：
            
```
# MySQL 8.0
binlog_group_commit_sync_delay = 0       # Sync 阶段等待的最大微秒数
binlog_group_commit_sync_no_delay_count = 0  # 达到该事务数时立即触发 Sync
```

            

`binlog_group_commit_sync_delay` 控制 leader
            在 Sync 阶段最多等待多少微秒再执行
            fsync。增大此值可以让更多事务合并到同一批次，提高吞吐量，代价是单个事务的提交延迟增加。`binlog_group_commit_sync_no_delay_count`
            设定一个事务数阈值，达到后无论是否超时都立即执行
            fsync，避免在高并发场景下不必要的等待。
            

### 2.5 PostgreSQL 的 Group
            Commit

            

PostgreSQL 的 Group Commit 实现更加隐式。PostgreSQL
            没有一个显式的”分组”机制，而是依赖 WAL
            写入流程本身的并发特性实现分组效果。
            

多个后端进程（Backend Process）并发地将 WAL
            记录写入共享的 WAL 缓冲区（WAL
            Buffers）。当一个进程准备提交事务时，它需要确保 WAL
            缓冲区中截止到自己最后一条记录的所有数据都已经
            fsync。如果此时另一个进程已经在执行
            fsync，当前进程会等待那次 fsync 完成——如果那次 fsync
            覆盖了自己的记录位置，就不需要再次 fsync。
            

这种”搭便车”（piggyback）的机制自然地实现了分组提交。并发度越高，每次
            fsync 平均覆盖的事务越多。
            

PostgreSQL 还提供了 `commit_delay` 和
            `commit_siblings`
            两个参数来显式控制分组行为：
            
```
# postgresql.conf
commit_delay = 0          # 提交前等待的微秒数（默认不等待）
commit_siblings = 5        # 当活跃事务数达到此值时，commit_delay 才生效
```

            

`commit_delay` 的作用与 InnoDB 的
            `binlog_group_commit_sync_delay` 类似：在 fsync
            之前等待一小段时间，让更多事务的 WAL
            记录进入缓冲区。`commit_siblings`
            是触发条件——只有当系统中有足够多的并发事务时，等待才有意义。如果只有两三个并发事务，等待反而浪费时间。
            

### 2.6 分组提交的效果量化

            

分组提交的收益可以用一个简单的模型估算。设 fsync 延迟为
            \(t_s\)，每批次平均事务数为
            \(N\)，单个事务的 WAL
            写入时间为 \(t_w\)，则：
            
            
- 逐事务 fsync 的吞吐上限：\(1 /
            (t_w + t_s)\)
            
- 分组提交的吞吐上限：\(N / (t_w
            \times N + t_s) \approx N / t_s\)（当 \(N\) 较大时）
            
            

以 NVMe SSD 为例，\(t_s = 50\mu
            s\)，\(t_w = 5\mu
            s\)：
            
            
            
            批次大小 N
            逐事务 fsync（ops/s）
            分组提交（ops/s）
            吞吐倍数
            
            
            
            
            1
            18,182
            18,182
            1.0x
            
            
            10
            18,182
            100,000
            5.5x
            
            
            50
            18,182
            200,000
            11.0x
            
            
            100
            18,182
            181,818
            10.0x
            
            
            
            

当 \(N = 50\)
            时，吞吐量达到逐事务模式的 11 倍。但 \(N\)
            并非越大越好——过大的批次意味着 leader
            需要更长时间收集事务，单个事务的等待延迟也随之增加。实际系统通常通过超时和计数双重阈值来平衡。
            
            

## 三、批量写入

            

### 3.1 WriteBatch 接口

            

分组提交解决的是”多个独立事务如何共享
            fsync”的问题。批量写入（Batched
            Write）解决的是另一个问题：如何将多个键值对的写入合并为一次原子操作。
            

RocksDB 提供了 `WriteBatch`
            接口，允许应用层将多个 Put、Delete
            操作打包到一个批次中，然后一次性提交：
            
```
rocksdb::WriteBatch batch;
batch.Put("key1", "value1");
batch.Put("key2", "value2");
batch.Delete("key3");

rocksdb::Status s = db->Write(write_options, &batch);
```

            

WriteBatch 的好处有三个方面：
            

第一，原子性。一个 WriteBatch
            中的所有操作要么全部成功，要么全部失败。这对应用层非常有用——例如，更新索引和更新数据需要原子完成。
            

第二，减少锁竞争。多次单独的 `Put`
            调用每次都要获取写入锁，而一个 WriteBatch
            只需要获取一次。
            

第三，减少 WAL 写入次数。一个 WriteBatch 对应一条 WAL
            记录，而不是多条。WAL 的序列化、CRC
            校验、写入开销都被摊销了。
            

### 3.2 Pipeline Write

            

RocksDB 6.x 引入了流水线写入（Pipelined Write）机制，在
            Group Commit 的基础上进一步提高并发度。
            

在传统的 Group Commit 中，leader 需要将所有 follower
            的数据写入 WAL 并写入 MemTable，两个步骤串行执行。Pipelined
            Write 将这两步拆开：leader 先将整批数据写入
            WAL，然后让每个写入者并行地将自己的数据写入 MemTable。
            
```
传统 Group Commit:
  Leader:  [写 WAL -----][写 MemTable -----]

Pipelined Write:
  Leader:  [写 WAL -----]
  Writer1:               [写 MemTable]
  Writer2:               [写 MemTable]
  Writer3:               [写 MemTable]
```

            

Pipelined Write 通过 `enable_pipelined_write`
            选项开启：
            
```
rocksdb::Options options;
options.enable_pipelined_write = true;  // 默认 false
```

            

需要注意的是，Pipelined Write 与
            `unordered_write`
            不兼容——后者允许更激进的乱序写入以换取更高吞吐，但牺牲了快照读的一致性保证。
            

### 3.3 应用层批量写入策略

            

在应用层，批量写入的策略需要根据业务场景调整。以日志采集为例，可以在内存中累积一批日志记录，达到批次大小或超时后一次性写入：
            
```
type BatchWriter struct {
    db       *rocksdb.DB
    buffer   []*Record
    maxBatch int
    timeout  time.Duration
    mu       sync.Mutex
    timer    *time.Timer
}

func (w *BatchWriter) Add(r *Record) {
    w.mu.Lock()
    defer w.mu.Unlock()

    w.buffer = append(w.buffer, r)
    if len(w.buffer) >= w.maxBatch {
        w.flush()
        return
    }
    if w.timer == nil {
        w.timer = time.AfterFunc(w.timeout, func() {
            w.mu.Lock()
            defer w.mu.Unlock()
            w.flush()
        })
    }
}

func (w *BatchWriter) flush() {
    if len(w.buffer) == 0 {
        return
    }
    batch := rocksdb.NewWriteBatch()
    for _, r := range w.buffer {
        batch.Put(r.Key, r.Value)
    }
    w.db.Write(rocksdb.NewDefaultWriteOptions(), batch)
    w.buffer = w.buffer[:0]
    if w.timer != nil {
        w.timer.Stop()
        w.timer = nil
    }
}
```

            

批次大小和超时的选择需要权衡：批次越大，吞吐越高，但单条记录的最大等待时间也越长。对于日志采集这种容忍几百毫秒延迟的场景，批次大小
            1000、超时 200
            毫秒是一个合理的起点。对于在线事务场景，批次大小通常在 10 到
            50 之间，超时在 1 到 5 毫秒。
            
            

## 四、Write Buffer 与
            MemTable 调优

            

### 4.1 MemTable 的作用

            

在 LSM-Tree 存储引擎中，MemTable
            是写入路径的第一站。所有写入操作先写入
            WAL（保证持久性），然后插入内存中的
            MemTable（保证读取性能）。当 MemTable
            的大小达到阈值时，它被标记为不可变（Immutable
            MemTable），后台线程将其刷盘为 SST（Sorted String
            Table）文件。
            

MemTable 的实现通常基于跳表（SkipList），支持 O(log N)
            的插入和查找。RocksDB
            也支持基于哈希跳表（HashSkipList）和基于哈希链表（HashLinkList）的
            MemTable，分别适合前缀查询和点查场景。
            

### 4.2 Write Buffer 参数

            

RocksDB 中与 Write Buffer 相关的核心参数有三个：
            
```
options.write_buffer_size = 64 * 1024 * 1024;          // 单个 MemTable 大小，默认 64MB
options.max_write_buffer_number = 3;                    // 最大 MemTable 数量（含不可变）
options.min_write_buffer_number_to_merge = 1;           // 刷盘前合并的最小 MemTable 数
```

            

**`write_buffer_size`**：单个
            MemTable 的大小上限。增大此值意味着每次 MemTable 刷盘产生的
            SST 文件更大，减少了 L0 层的文件数量，降低了 Compaction
            的频率。但也意味着更高的内存占用和更长的恢复时间——崩溃恢复时需要重放更多的
            WAL 记录。
            

**`max_write_buffer_number`**：MemTable
            的最大数量。假设设为 3，则内存中最多有 1 个可写 MemTable 加
            2 个不可变 MemTable 等待刷盘。如果不可变 MemTable
            的刷盘速度跟不上写入速度，所有 MemTable
            都被占满，写入将被阻塞——这就是 Write Stall
            的触发条件之一。
            

**`min_write_buffer_number_to_merge`**：刷盘前至少合并几个不可变
            MemTable。设为 2 意味着等两个 MemTable
            凑齐后再一次性刷盘，可以合并重复键（去重），减少写入 L0
            层的数据量。代价是内存中会多保留一个 MemTable。
            

### 4.3 MemTable
            大小的工程权衡

            

MemTable 大小的选择是一个多维度权衡：
            
            
            
            维度
            增大 write_buffer_size 的影响
            减小 write_buffer_size 的影响
            
            
            
            
            写入吞吐
            提高（减少刷盘频率）
            降低（频繁刷盘）
            
            
            L0 文件数
            减少（每个文件更大）
            增加（更多小文件）
            
            
            Compaction 压力
            减轻（L0 触发 Compaction 的频率降低）
            加重
            
            
            内存占用
            增加
            减少
            
            
            恢复时间
            增加（WAL 重放量更大）
            减少
            
            
            读性能
            可能降低（单个 MemTable 内扫描范围更大）
            可能提高
            
            
            
            

实际配置建议：如果系统内存充足且写入负载重，将
            `write_buffer_size` 设为 128MB 到 256MB
            通常能获得明显的吞吐提升。`max_write_buffer_number`
            建议设为 3 到
            6，给刷盘留出缓冲空间。对于写入量极大的场景（例如日志存储），可以将
            `write_buffer_size` 进一步增大到
            512MB，但需要确保 WAL 所在的磁盘能够承受对应的写入带宽。
            

### 4.4 Column Family
            级别的 Write Buffer

            

RocksDB 的 Write Buffer 配置是按列族（Column
            Family）独立的。一个数据库可以有多个列族，每个列族有自己的
            MemTable 和刷盘策略。`db_write_buffer_size`
            参数控制所有列族的 MemTable 总内存上限：
            
```
options.db_write_buffer_size = 512 * 1024 * 1024;  // 所有列族 MemTable 总大小上限 512MB
```

            

当所有列族的 MemTable 总大小达到
            `db_write_buffer_size` 时，RocksDB
            会选择内存占用最大的列族触发刷盘。这个参数对于多列族场景尤其重要——如果不设上限，某个写入量大的列族可能占满所有内存。
            

### 4.5 MemTable 工厂选择

            

RocksDB 支持多种 MemTable 实现，默认是
            SkipList。不同实现的性能特征差异较大：
            
            
            
            
            
            
            
            
            
            
            
            MemTable 类型
            写入性能
            点查性能
            范围查询
            内存开销
            适用场景
            
            
            
            
            SkipList（默认）
            好
            好
            好
            中
            通用
            
            
            HashSkipList
            好
            很好（同前缀）
            前缀范围查询好
            高
            前缀查询为主
            
            
            HashLinkList
            很好
            很好（同前缀）
            不支持全序扫描
            低
            纯点查
            
            
            Vector
            最好（追加写入）
            差（线性扫描）
            差
            低
            批量加载
            
            
            
            

对于大多数在线服务，SkipList
            是最安全的选择。只有在工作负载高度偏向点查或前缀查询时，才值得尝试
            Hash 系列 MemTable。Vector MemTable
            只适合批量加载场景——它的写入是 O(1) 追加，但读取是 O(N)
            扫描，刷盘前需要排序。
            
            

## 五、fsync 频率控制

            

### 5.1 fsync 的语义与开销

            

`fsync(fd)` 的语义是：确保文件描述符
            `fd`
            对应的文件的所有已修改数据和元数据都已经从操作系统的页缓存（Page
            Cache）写到持久化存储介质。在 Linux
            上，`fdatasync(fd)`
            是一个轻量版本——它只保证数据持久化，不保证元数据（例如文件的修改时间）持久化。如果文件大小没有变化，`fdatasync`
            通常比 `fsync` 更快。
            

fsync 的开销取决于几个因素：
            
            
- **存储介质**：NVMe SSD 的 fsync 延迟在 20
            到 100 微秒级别，SATA SSD 在 100 到 500 微秒，HDD 在 5 到 15
            毫秒。
            
- **脏数据量**：fsync 需要将从上次 fsync
            以来的所有脏页写到磁盘。脏数据量越大，fsync 耗时越长。
            
- **磁盘队列深度**：如果磁盘正在处理其他 I/O
            请求，fsync 可能需要等待排队。在高 I/O 负载下，fsync
            延迟会显著增加。
            
- **文件系统**：ext4 的
            `data=ordered` 模式（默认）在 fsync
            时需要先写出所有与该文件相关的数据页，再更新日志。XFS
            在某些场景下 fsync 性能更好。
            
            

### 5.2 fsync 策略的频谱

            

从最安全到最激进，fsync 策略形成一个频谱：
            
```
每次写入都 fsync ←→ 按事务 fsync ←→ 分组 fsync ←→ 定时 fsync ←→ 从不 fsync
  |                   |                |              |              |
  最安全              数据库默认        高吞吐优化      可接受少量丢失   纯内存/缓存
  最慢                                                              最快
```

            

**每次写入都
            fsync**：适用于金融级严格持久性要求。每写入一条记录就
            fsync 一次，保证任何时刻断电最多丢失正在写入的那条记录。
            

**按事务
            fsync**：数据库的默认行为。每个事务提交时 fsync 一次
            WAL，保证已提交事务不丢失。分组提交可以将多个事务合并到一次
            fsync。
            

**定时 fsync**：每隔一定时间（例如 1
            秒）fsync 一次。断电时最多丢失一个时间窗口内的数据。Redis 的
            AOF
            持久化（`appendfsync everysec`）采用这种策略。
            

**从不
            fsync**：完全依赖操作系统的脏页回写机制（`dirty_writeback_centisecs`，默认
            5 秒）。适用于缓存或可丢失的临时数据。
            

### 5.3 MySQL 的 fsync 控制

            

MySQL InnoDB 通过
            `innodb_flush_log_at_trx_commit` 参数控制 redo
            log 的 fsync 策略：
            
```
innodb_flush_log_at_trx_commit = 1   # 默认值
```

            
            
            
            
            
            
            
            
            
            值
            行为
            持久性
            性能
            
            
            
            
            1
            每次事务提交时 fsync redo log
            最强：已提交事务不丢
            最慢
            
            
            2
            每次事务提交时 write 到 Page Cache，每秒 fsync 一次
            操作系统崩溃可能丢 1 秒数据
            中等
            
            
            0
            每秒 write + fsync 一次，事务提交时不做任何 I/O
            MySQL 进程崩溃可能丢 1 秒数据
            最快
            
            
            
            

`sync_binlog` 控制 binlog 的 fsync 策略：
            
```
sync_binlog = 1   # 默认值：每次事务提交时 fsync binlog
```

            

设为 0 表示 binlog 不主动 fsync，依赖操作系统回写。设为
            N（N > 1）表示每 N 个事务 fsync 一次。
            

我认为，在绝大多数生产环境中
            `innodb_flush_log_at_trx_commit = 1` 和
            `sync_binlog = 1` 是正确的默认值。将其改为 0 或 2
            能带来 2 到 5 倍的写入吞吐提升，但代价是在断电时可能丢失最近
            1
            秒的已提交事务。这个风险在主从复制场景下尤其危险——如果主库丢失了一些事务但从库已经收到了对应的
            binlog，主从数据会不一致。只有在从库可以作为数据权威源的场景下，才值得在主库上放松
            fsync 策略。
            

### 5.4 PostgreSQL 的 fsync
            控制

            

PostgreSQL 通过 `synchronous_commit`
            参数控制事务提交时的 WAL fsync 行为：
            
```
synchronous_commit = on   # 默认值
```

            
            
            
            
            
            
            
            
            值
            行为
            持久性
            
            
            
            
            on
            事务提交时等待 WAL fsync 完成
            最强
            
            
            remote_apply
            等待 WAL 在至少一个同步备库上被应用
            高（跨节点持久化）
            
            
            remote_write
            等待 WAL 在至少一个同步备库上写入 Page Cache
            中等
            
            
            local
            等待本地 WAL fsync 完成，不等待备库
            本地持久化
            
            
            off
            不等待 WAL fsync，异步写入
            可能丢失最近几百毫秒数据
            
            
            
            

PostgreSQL 的一个设计优势是
            `synchronous_commit` 可以按事务设置：
            
```
-- 对于不重要的日志表，可以放松持久性要求
SET LOCAL synchronous_commit = off;
INSERT INTO access_log (ts, path, status) VALUES (now(), '/api/health', 200);
COMMIT;

-- 对于资金相关的表，使用最严格的持久性
SET LOCAL synchronous_commit = on;
UPDATE accounts SET balance = balance - 100 WHERE id = 42;
COMMIT;
```

            

这种按事务粒度的控制非常实用：同一个数据库内，不同业务场景的持久性要求可能差别很大。审计日志可以容忍丢失几百毫秒的数据，但转账记录一条都不能丢。
            

### 5.5 WAL 写入方法

            

PostgreSQL 通过 `wal_sync_method` 参数选择 WAL
            的持久化系统调用：
            
```
wal_sync_method = fdatasync   # Linux 默认值
```

            

可选值包括：
            
            
            
            方法
            系统调用
            说明
            
            
            
            
            fsync
            fsync()
            同步数据和元数据
            
            
            fdatasync
            fdatasync()
            只同步数据，不含元数据
            
            
            open_datasync
            open() with O_DSYNC
            每次 write 都同步
            
            
            open_sync
            open() with O_SYNC
            每次 write 都同步数据和元数据
            
            
            
            

在 Linux 上，`fdatasync`
            通常是最优选择。`O_DSYNC`/`O_SYNC`
            模式在每次 write 时都执行同步，无法利用分组提交的批量 fsync
            优势。PostgreSQL 提供了 `pg_test_fsync`
            工具来测量不同方法在当前硬件上的性能：
            
```
pg_test_fsync
```

            

运行结果会显示各种 fsync 方法的
            ops/s，帮助选择最优配置。
            
            

## 六、写入限速

            

### 6.1 为什么需要限速

            

写入限速（Rate
            Limiting）看起来与写入性能优化矛盾——既然要优化写入性能，为什么还要限速？原因在于存储系统的写入路径不是一个简单的管道，而是一个有多个阶段的流水线。如果前台写入速度长期超过后台处理能力（MemTable
            刷盘、Compaction），系统最终会触发写停顿（Write
            Stall），导致写入延迟从微秒级突然跳到秒级。
            

限速的目的不是降低平均吞吐量，而是平滑写入速率，避免突发写入导致的后台处理积压。这类似于网络中的流量整形（Traffic
            Shaping）——允许短暂的突发，但长期速率不超过系统的处理能力。
            

### 6.2 RocksDB 的 Rate
            Limiter

            

RocksDB 内置了 Rate Limiter 机制，可以对 Compaction
            和刷盘的磁盘写入带宽进行限速：
            
```
rocksdb::Options options;
options.rate_limiter.reset(
    rocksdb::NewGenericRateLimiter(
        100 * 1024 * 1024,          // rate_bytes_per_sec: 100MB/s
        100 * 1000,                  // refill_period_us: 100ms
        10,                          // fairness: IO 优先级的公平性因子
        rocksdb::RateLimiter::Mode::kWritesOnly  // 只限制写入
    )
);
```

            

Rate Limiter 采用令牌桶（Token Bucket）算法：每个
            `refill_period_us`
            周期补充一批令牌，每次磁盘写入消耗相应数量的令牌。当令牌耗尽时，写入请求被阻塞直到下一次补充。
            

RocksDB 的 Rate Limiter 区分三种 I/O 优先级：
            
            
- **高优先级（Env::IO_HIGH）**：前台写入（Flush
            MemTable）
            
- **低优先级（Env::IO_LOW）**：后台
            Compaction
            
- **用户优先级（Env::IO_USER）**：用户直接的读写操作
            
            

`fairness`
            参数控制高低优先级之间的调度公平性。默认值 10
            意味着低优先级请求每 10 次被高优先级抢占 1
            次。在写入密集型场景下，可以适当降低此值，优先保障
            Compaction 的磁盘带宽。
            

### 6.3 自动限速调整

            

RocksDB 的 Rate Limiter
            支持自动调整（Auto-tuned）模式。开启后，Rate Limiter
            会根据系统当前的写入压力动态调整限速值：
            
```
options.rate_limiter.reset(
    rocksdb::NewGenericRateLimiter(
        100 * 1024 * 1024,      // 初始速率
        100 * 1000,
        10,
        rocksdb::RateLimiter::Mode::kWritesOnly,
        true                     // auto_tuned = true
    )
);
```

            

自动调整的逻辑基于一个反馈回路：如果最近没有发生 Write
            Stall，逐步提高限速值（系统有余力）；如果最近发生了 Write
            Stall，逐步降低限速值（系统过载）。调整步幅较为保守，避免剧烈波动。
            

### 6.4 操作系统级 I/O 限速

            

除了存储引擎自身的 Rate Limiter，Linux cgroup v2
            提供了操作系统级别的 I/O 带宽限制：
            
```
# 创建 cgroup 并设置 I/O 带宽限制
mkdir -p /sys/fs/cgroup/db-write
echo "259:0 wbps=104857600" > /sys/fs/cgroup/db-write/io.max   # 100MB/s 写入限制
echo $DB_PID > /sys/fs/cgroup/db-write/cgroup.procs
```

            

cgroup
            级别的限速优势在于它是透明的——应用程序不需要任何修改。但它的粒度较粗，无法区分
            WAL 写入、Flush 和 Compaction
            的优先级。在多租户环境中，cgroup I/O
            限速是隔离不同数据库实例磁盘带宽的有效手段。
            
            

## 七、写停顿分析

            

### 7.1 什么是写停顿

            

写停顿（Write Stall）是 LSM-Tree
            存储引擎的一种保护机制：当后台处理能力跟不上前台写入速度时，引擎主动降低甚至暂停前台写入，防止系统进入不可恢复的状态。
            

Write Stall
            对应用的影响是灾难性的——写入延迟从正常的微秒级突然跳到数百毫秒甚至数秒，P99
            延迟出现尖刺。对于在线服务来说，这种延迟尖刺往往比平均吞吐下降更难以接受。
            

### 7.2 RocksDB
            的写停顿触发条件

            

RocksDB 在三种情况下触发 Write Stall：
            

**条件一：L0 文件数过多**
            

当 Level 0 的 SST 文件数达到
            `level0_slowdown_writes_trigger`（默认
            20）时，RocksDB 开始降速写入。当 L0 文件数达到
            `level0_stop_writes_trigger`（默认
            36）时，完全停止写入，直到 Compaction 将 L0 文件合并到
            L1。
            

L0 文件过多的直接影响是读性能下降——L0
            的文件之间的键范围（Key
            Range）可能重叠，读取一个键可能需要查询所有 L0 文件。
            
```
options.level0_slowdown_writes_trigger = 20;   // 开始降速
options.level0_stop_writes_trigger = 36;        // 完全停止
```

            

**条件二：待 Compaction 字节数过多**
            

当需要 Compaction 的数据总量超过
            `soft_pending_compaction_bytes_limit`（默认
            64GB）时，开始降速。超过
            `hard_pending_compaction_bytes_limit`（默认
            256GB）时，完全停止。
            
```
options.soft_pending_compaction_bytes_limit = 64ULL * 1024 * 1024 * 1024;
options.hard_pending_compaction_bytes_limit = 256ULL * 1024 * 1024 * 1024;
```

            

**条件三：MemTable 数量达到上限**
            

当不可变 MemTable 的数量达到
            `max_write_buffer_number`（减去正在写入的那个），且这些
            MemTable
            都在等待刷盘时，前台写入被阻塞。这通常意味着刷盘速度跟不上写入速度——可能是磁盘带宽不足，也可能是
            Rate Limiter 限制过严。
            

下面用一张图来展示这三种触发条件在系统中的位置：
            
```
flowchart TB
    subgraph 前台写入
        W[Write 请求] --> MB[MemTable]
    end
    subgraph MemTable 管理
        MB --> IMM[Immutable MemTable 队列]
        IMM -->|数量 >= max_write_buffer_number| STALL1[Write Stall: MemTable 满]
    end
    subgraph 后台刷盘
        IMM --> FLUSH[Flush 线程]
        FLUSH --> L0[Level 0 SST]
        L0 -->|文件数 >= slowdown_trigger| STALL2[Write Stall: L0 过多]
        L0 -->|文件数 >= stop_trigger| STOP[Write Stop]
    end
    subgraph 后台 Compaction
        L0 --> COMP[Compaction 线程]
        COMP --> L1[Level 1]
        L1 --> L2[Level 2+]
        COMP -->|待处理 > soft_limit| STALL3[Write Stall: Compaction 积压]
    end
```

            

上图中，写请求进入 MemTable，满后转为不可变 MemTable
            排队等待 Flush。Flush 产生的 L0 文件过多或 Compaction
            积压过多，都会触发写停顿，反压到前台写入。三种触发条件分别对应
            MemTable 管理、L0 文件数量和 Compaction 积压三个环节。
            

### 7.3 写停顿的诊断

            

RocksDB 通过 `GetProperty`
            接口和日志提供了丰富的写停顿诊断信息：
            
```
std::string value;
db->GetProperty("rocksdb.is-write-stopped", &value);        // 是否已停止写入
db->GetProperty("rocksdb.actual-delayed-write-rate", &value);  // 当前降速后的写入速率
db->GetProperty("rocksdb.num-immutable-mem-table", &value);    // 不可变 MemTable 数量
db->GetProperty("rocksdb.compaction-pending", &value);         // 是否有待执行的 Compaction
```

            

RocksDB 的 LOG 文件会记录每次 Write Stall
            事件，包括触发原因和持续时间：
            
```
2024/01/15-10:23:45.123456 7f8b2c000000 [WARN] [db/column_family.cc:932] 
Stalling writes because we have 5 immutable memtables (waiting for flush), 
max_write_buffer_number is set to 5
```

            

在生产环境中，建议通过 RocksDB 的 Statistics 接口或
            Prometheus Exporter 持续监控以下指标：
            
            
- `rocksdb.stall.micros`：Write Stall
            的累计时长
            
- `rocksdb.num.files.at.level0`：L0 文件数
            
- `rocksdb.compaction.pending.bytes`：待
            Compaction 字节数
            
- `rocksdb.mem.table.flush.pending`：待刷盘的
            MemTable 数
            
            

### 7.4 写停顿的缓解策略

            

针对三种触发条件，分别有对应的缓解思路：
            

**L0 文件过多**：增加 Compaction
            并发度（`max_background_compactions`），提高 L0
            到 L1 的 Compaction 速度。或者增大
            `write_buffer_size`，使每次 Flush 产生的 SST
            文件更大，从而减少 L0 文件数量。
            

**Compaction 积压**：增加 Compaction
            线程数，升级到更快的磁盘（例如从 SATA SSD 换到 NVMe
            SSD），或者调整 Compaction 策略——Level Compaction
            的写放大较高但读性能好，Universal Compaction
            的写放大较低但空间放大较高。
            

**MemTable 堆积**：增大
            `max_write_buffer_number`，给刷盘更多缓冲空间。检查
            Rate Limiter 是否限制过严，导致 Flush I/O 带宽不足。增加
            `max_background_flushes` 以提高 Flush
            并发度。
            
```
// 针对写入密集型负载的参数示例
options.max_background_compactions = 4;
options.max_background_flushes = 2;
options.write_buffer_size = 256 * 1024 * 1024;  // 256MB
options.max_write_buffer_number = 6;
options.level0_slowdown_writes_trigger = 40;
options.level0_stop_writes_trigger = 56;
```

            

需要注意的是，放宽 Write Stall 触发条件（例如提高
            `level0_stop_writes_trigger`）只是推迟问题，不是解决问题。如果后台处理能力确实跟不上前台写入速度，积压最终会耗尽磁盘空间或内存。正确的做法是提高后台处理能力，而不是一味放宽阈值。
            
            

## 八、MySQL 写入调优实战

            

### 8.1 InnoDB 写入路径概览

            

MySQL InnoDB 的写入路径与通用 LSM-Tree 有所不同——InnoDB
            使用 B+ Tree 作为存储结构，而不是 LSM-Tree。但核心的 WAL +
            Buffer Pool 机制是类似的：
            
            
- 事务的修改先写入 redo log（InnoDB 的 WAL）
            
- 修改同时在 Buffer Pool 中的页面上原地更新
            
- 脏页由后台线程异步刷盘
            
- binlog 记录逻辑层面的变更（用于复制和 PITR）
            
            

### 8.2 关键写入参数

            

以下是影响 MySQL 写入性能的核心参数：
            
```
# Redo Log 相关
innodb_flush_log_at_trx_commit = 1   # 事务提交时 fsync redo log
innodb_log_buffer_size = 64M         # redo log 缓冲区大小（默认 16M）
innodb_redo_log_capacity = 2G        # MySQL 8.0.30+ redo log 总容量

# Binlog 相关
sync_binlog = 1                      # 事务提交时 fsync binlog
binlog_group_commit_sync_delay = 0   # Group Commit 等待微秒数
binlog_group_commit_sync_no_delay_count = 0  # 达到此事务数立即提交

# Buffer Pool 与刷盘
innodb_buffer_pool_size = 8G         # Buffer Pool 大小
innodb_io_capacity = 200             # 后台 I/O 操作的基准速率（IOPS）
innodb_io_capacity_max = 2000        # 后台 I/O 操作的最大速率
innodb_flush_neighbors = 0           # SSD 环境关闭邻近页合并刷盘
innodb_doublewrite = ON              # 双写保护（防止部分页写入）
```

            

### 8.3 实战调优示例

            

场景：一台配备 NVMe SSD 的数据库服务器，运行 OLTP
            负载，当前写入吞吐约 8000 TPS，目标提升到 15000 TPS
            以上。
            

**第一步：确认瓶颈。** 使用
            `SHOW ENGINE INNODB STATUS` 查看 redo log 和
            Buffer Pool 的状态：
            
```
SHOW ENGINE INNODB STATUS\G
```

            

关注 `LOG` 部分的
            `Log sequence number`、`Log flushed up to`、`Pages flushed up to`
            三个值。如果 `Log sequence number` 远超
            `Log flushed up to`，说明 redo log 的 fsync
            是瓶颈。
            

**第二步：增大 redo log 容量。** redo log
            容量太小会导致频繁的检查点（Checkpoint），强制刷脏页：
            
```
innodb_redo_log_capacity = 4G   # 从默认值增大
```

            

MySQL 8.0.30 之前使用 `innodb_log_file_size`
            和 `innodb_log_files_in_group` 两个参数控制 redo
            log 大小。8.0.30 之后统一为
            `innodb_redo_log_capacity`。
            

**第三步：启用 Group Commit 延迟。**
            在高并发 OLTP 场景下，适当增加 Group Commit
            等待时间可以显著提升吞吐：
            
```
binlog_group_commit_sync_delay = 2000           # 等待 2ms
binlog_group_commit_sync_no_delay_count = 32    # 或凑齐 32 个事务
```

            

这两个参数的含义是：leader 在 Sync 阶段最多等待 2
            毫秒，或者凑齐 32 个事务后立即
            fsync，以先到者为准。对于并发连接数较高的场景（例如 100
            以上），2 毫秒内通常能凑齐几十个事务，fsync
            的分摊效果非常显著。
            

**第四步：调整 I/O 容量参数。**
            `innodb_io_capacity` 控制 InnoDB
            后台刷脏页的速率。默认值 200 对应机械硬盘的 IOPS，NVMe SSD
            应该大幅调高：
            
```
innodb_io_capacity = 10000
innodb_io_capacity_max = 20000
innodb_flush_neighbors = 0     # SSD 关闭邻近页合并
```

            

`innodb_flush_neighbors` 在 HDD
            时代的作用是将相邻脏页合并成一次顺序写入，减少寻道次数。SSD
            没有寻道问题，开启此选项反而增加不必要的写入放大。MySQL 8.0
            在 SSD 上默认已设为 0。
            

**第五步：增大 redo log buffer。**
            对于大事务（例如批量 INSERT），更大的 redo log buffer
            可以减少 redo log 的写入次数：
            
```
innodb_log_buffer_size = 64M   # 默认 16M
```

            

### 8.4 调优效果验证

            

使用 sysbench 验证调优效果：
            
```
sysbench oltp_write_only \
    --db-driver=mysql \
    --mysql-host=127.0.0.1 \
    --mysql-port=3306 \
    --mysql-user=sbtest \
    --mysql-password=sbtest \
    --mysql-db=sbtest \
    --tables=16 \
    --table-size=1000000 \
    --threads=64 \
    --time=300 \
    --report-interval=10 \
    run
```

            

关注输出中的 `transactions` 和
            `latency` 指标，对比调优前后的 TPS 和 P99
            延迟。
            

### 8.5 双写与写入性能

            

InnoDB 的双写缓冲区（Doublewrite
            Buffer）是防止部分页写入（Partial Page
            Write）问题的保护机制。在 16KB
            页面写入磁盘的过程中如果断电，可能只写了一半，导致页面损坏。双写机制先将页面写到双写区域，确认完成后再写到目标位置。
            

双写的代价是每次刷脏页实际写入两次。在 NVMe SSD
            上，双写带来的额外写入开销约 5% 到 15%。MySQL 8.0.20
            之后，双写缓冲区的实现从系统表空间迁移到独立文件，并且支持配置到不同磁盘：
            
```
innodb_doublewrite_dir = /nvme_fast/doublewrite   # 将双写文件放在更快的磁盘上
innodb_doublewrite_pages = 64                      # 每批次双写页数
```

            

如果底层文件系统或硬件已经保证原子写入（例如
            ZFS、某些支持原子写的 NVMe
            设备），可以关闭双写以提升写入性能：
            
```
innodb_doublewrite = OFF   # 仅在确认底层支持原子写时关闭
```

            
            

## 九、PostgreSQL
            写入调优实战

            

### 9.1 PostgreSQL 写入路径

            

PostgreSQL 的写入路径与 MySQL 有显著区别。PostgreSQL
            使用堆表（Heap Table）+ MVCC（Multi-Version Concurrency
            Control）模型：
            
            
- 事务修改先写入 WAL（PostgreSQL 的预写日志）
            
- 修改在共享缓冲区（Shared
            Buffers）中的数据页上原地更新
            
- MVCC 通过在行级别保留旧版本实现，而不是 undo log
            
- 后台写入进程（Background
            Writer）和检查点进程（Checkpointer）负责异步刷脏页
            
            

PostgreSQL 的 WAL
            不仅记录逻辑变更，还记录物理页面变更（Full Page
            Write），这意味着 WAL 的写入量比实际数据变更量大得多。
            

### 9.2 关键写入参数

            
```
# WAL 相关
wal_level = replica                    # WAL 详细程度
synchronous_commit = on                # 事务提交时等待 WAL fsync
wal_buffers = 64MB                     # WAL 缓冲区大小（默认 -1，自动设置）
wal_writer_delay = 200ms               # WAL 写入进程的休眠间隔
wal_writer_flush_after = 1MB           # WAL 写入进程每累积此量后 fsync
commit_delay = 0                       # 分组提交等待时间
commit_siblings = 5                    # 分组提交触发的最小并发事务数

# 检查点与刷盘
checkpoint_timeout = 5min              # 检查点最大间隔
checkpoint_completion_target = 0.9     # 检查点完成的时间目标（占间隔比例）
max_wal_size = 1GB                     # 触发检查点的 WAL 大小阈值

# Full Page Write
full_page_writes = on                  # 检查点后首次修改页面时写入完整页
```

            

### 9.3 Full Page Write
            与写放大

            

PostgreSQL 的全页写入（Full Page
            Write，FPW）是一个容易被忽略的写入放大来源。在每次检查点之后，对某个数据页的第一次修改会导致
            WAL 中记录整个 8KB
            页面的内容（而不仅仅是修改的部分）。这是为了防止部分页写入导致的页面损坏——与
            InnoDB 的双写机制目的相同，但实现方式不同。
            

FPW 的写放大在检查点频繁时尤为严重。假设
            `checkpoint_timeout = 5min`，一个频繁更新的表每 5
            分钟就要把所有被修改的页面在 WAL 中写一遍完整内容。如果表有
            10 万个活跃页面，每次检查点后 WAL 中会多出近 800MB 的 FPW
            数据。
            

缓解 FPW 写放大的方法：
            
            
- **增大
            `checkpoint_timeout`**：从默认的 5
            分钟增大到 15 到 30 分钟，减少检查点频率，从而减少 FPW
            次数。代价是崩溃恢复时间增加。
            
- **增大 `max_wal_size`**：让 WAL
            有更多空间积累变更，避免因 WAL 大小触发提前检查点。
            
- **使用
            `wal_compression`**（PostgreSQL 15+）：对
            FPW 页面进行压缩，减少 WAL 的物理写入量。
            
            
```
checkpoint_timeout = 15min
max_wal_size = 4GB
wal_compression = zstd     # PostgreSQL 15+ 支持 pglz、lz4、zstd
```

            

### 9.4 实战调优示例

            

场景：一台 PostgreSQL 17 实例运行高写入 OLTP 负载，128GB
            内存，NVMe SSD，当前写入吞吐约 12000 TPS，P99
            延迟偶尔出现尖刺。
            

**第一步：分析 WAL 写入量。** 通过
            `pg_stat_wal`（PostgreSQL 14+）查看 WAL
            统计：
            
```
SELECT wal_records, wal_fpi, wal_bytes,
       wal_fpi::float / wal_records AS fpi_ratio,
       wal_write, wal_sync,
       wal_write_time, wal_sync_time
FROM pg_stat_wal;
```

            

`wal_fpi`（Full Page Images）与
            `wal_records` 的比率反映了 FPW
            的影响程度。如果比率超过 30%，说明检查点过于频繁。
            

**第二步：优化检查点配置。**
            
```
checkpoint_timeout = 15min
max_wal_size = 8GB
checkpoint_completion_target = 0.9
```

            

`checkpoint_completion_target = 0.9`
            意味着检查点应在下一次检查点之前 90%
            的时间内完成刷脏页操作，避免检查点结束时的 I/O 突发。
            

**第三步：启用 WAL 压缩。**
            
```
wal_compression = lz4
```

            

LZ4 压缩对 CPU 的开销很低（压缩速度约 4GB/s），但可以将
            FPW 页面压缩 50% 到 70%，显著减少 WAL 的磁盘写入量。
            

**第四步：调整分组提交参数。**
            
```
commit_delay = 100         # 等待 100 微秒
commit_siblings = 10       # 至少 10 个并发事务时才等待
```

            

对于高并发场景，100 微秒的等待时间可以让多个事务共享一次
            fsync，提升整体吞吐。
            

**第五步：调整 Shared Buffers 和 Background
            Writer。**
            
```
shared_buffers = 32GB                  # 总内存的 25%
bgwriter_lru_maxpages = 1000          # 每轮最多写出的脏页数
bgwriter_lru_multiplier = 4.0         # 脏页写出倍率
bgwriter_flush_after = 512kB          # 累积写出量达到此值后 fsync
```

            

Background Writer
            的作用是在检查点之间持续地将脏页写出，避免检查点时的 I/O
            突发。增大 `bgwriter_lru_maxpages` 和
            `bgwriter_lru_multiplier` 可以让 Background
            Writer 更积极地工作。
            

### 9.5 pgbench 验证

            

使用 pgbench 验证调优效果：
            
```
# 初始化测试数据
pgbench -i -s 100 testdb

# 运行写入密集型测试
pgbench -c 64 -j 8 -T 300 -P 10 --no-vacuum testdb
```

            

关注输出中的 TPS 和延迟分布。对比调优前后的 P99
            延迟尖刺是否减少。
            
            

## 十、RocksDB
            写入性能分析

            

### 10.1 写入路径全景

            

RocksDB 的写入路径是一个典型的 LSM-Tree
            实现。一次写入的完整流程如下：
            
```
Put(key, value)
  → 获取写入锁
  → 写入 WAL（Group Commit）
  → 插入 Active MemTable
  → 释放写入锁
  → 返回成功

后台:
  → MemTable 达到阈值 → 转为 Immutable MemTable
  → Flush 线程将 Immutable MemTable 刷盘为 L0 SST 文件
  → Compaction 线程将 L0 文件合并到更深层级
```

            

### 10.2 写入选项

            

RocksDB 的 `WriteOptions`
            提供了细粒度的写入控制：
            
```
rocksdb::WriteOptions write_options;

// 持久性控制
write_options.sync = false;             // true: 每次写入都 fsync WAL
write_options.disableWAL = false;       // true: 跳过 WAL 写入（断电丢数据）
write_options.no_slowdown = false;      // true: 如果需要降速则直接返回错误

// 内存写入控制
write_options.memtable_insert_hint_per_batch = false;  // 批量写入时使用 hint 优化
write_options.protection_bytes_per_key = 0;             // 内存数据保护校验字节数
```

            

`sync = true` 等价于每次写入后调用
            `fsync`，性能最差但持久性最强。大多数场景使用
            `sync = false`（默认值），此时 WAL 记录只写入
            Page Cache，由操作系统或后续的 fsync 调用持久化。
            

`disableWAL = true` 完全跳过 WAL
            写入，写入延迟降低约 50%（省去 WAL
            序列化和写入开销），但断电时会丢失所有未刷盘的 MemTable
            数据。只适合可以从其他来源重建数据的场景，例如缓存层或物化视图。
            

`no_slowdown = true`
            是一个有趣的选项——如果当前系统需要 Write Stall
            降速，不等待而是直接返回 `Status::Incomplete()`
            错误。这允许应用层自己实现限速策略或将请求转发到其他节点。
            

### 10.3 Compaction
            策略对写入性能的影响

            

RocksDB 支持多种 Compaction
            策略，不同策略对写入性能的影响差异很大：
            
            
            
            
            
            
            
            
            
            
            Compaction 策略
            写放大
            空间放大
            读放大
            适用场景
            
            
            
            
            Level（默认）
            高（10-30x）
            低（~1.1x）
            低
            读多写少、空间敏感
            
            
            Universal
            低（2-10x）
            高（可达 2x）
            中
            写多读少、SSD 寿命敏感
            
            
            FIFO
            最低（~1x）
            最低
            高
            时序数据、TTL 场景
            
            
            
            

**Level Compaction**（Leveled
            Compaction）是默认策略。每一层的大小是上一层的
            `max_bytes_for_level_multiplier` 倍（默认
            10）。Compaction 将 L(n) 的一个文件与 L(n+1)
            中键范围重叠的所有文件合并，写放大较高但保证每层内没有重叠，读性能好。
            

**Universal Compaction**
            采用”全量合并”或”部分合并”策略，通过 `size_ratio`
            参数控制哪些文件需要合并。写放大显著低于 Level
            Compaction，但合并时的临时空间占用更高。对于写入密集型负载（例如日志存储），Universal
            Compaction 可以将写放大从 20x 降低到 5x 左右。
            
```
options.compaction_style = rocksdb::kCompactionStyleUniversal;
options.compaction_options_universal.size_ratio = 1;        // 触发合并的大小比例
options.compaction_options_universal.min_merge_width = 2;   // 最少合并文件数
options.compaction_options_universal.max_merge_width = 8;   // 最多合并文件数
```

            

**FIFO Compaction**
            是最简单的策略——达到空间上限时直接删除最老的 SST
            文件。适用于时序数据或有 TTL 的场景，写放大接近
            1x（没有合并开销），但不支持范围查询和更新操作。
            

### 10.4 Direct I/O
            与写入性能

            

RocksDB 支持对不同类型的 I/O 使用直接 I/O（Direct
            I/O），绕过操作系统的 Page Cache：
            
```
options.use_direct_reads = true;                  // SST 文件读取使用 Direct I/O
options.use_direct_io_for_flush_and_compaction = true;  // Flush 和 Compaction 使用 Direct I/O
```

            

对于写入性能，`use_direct_io_for_flush_and_compaction = true`
            有两个效果：
            

第一，减少 Page Cache 污染。Flush 和 Compaction
            产生的大量顺序写入不会占用 Page
            Cache，将缓存空间留给频繁访问的热数据。
            

第二，可能略微增加写入延迟。Direct I/O 绕过了 Page Cache
            的缓冲作用，每次写入直接到磁盘。但由于 Flush 和 Compaction
            本身是后台操作，这个延迟增加不会直接影响前台写入。
            

WAL 文件通常不建议使用 Direct I/O——WAL
            的写入量较小但频繁，Page Cache 的缓冲效果对 WAL
            性能有正面作用。
            

### 10.5 db_bench 实战

            

RocksDB 自带的 `db_bench`
            是测量写入性能的标准工具：
            
```
# 基线测试：随机写入 1000 万条记录
db_bench \
    --benchmarks=fillrandom \
    --num=10000000 \
    --value_size=1024 \
    --key_size=16 \
    --compression_type=none \
    --write_buffer_size=67108864 \
    --max_write_buffer_number=3 \
    --target_file_size_base=67108864 \
    --max_bytes_for_level_base=268435456 \
    --threads=8 \
    --statistics=1

# 测试 Universal Compaction 的写入性能
db_bench \
    --benchmarks=fillrandom \
    --num=10000000 \
    --value_size=1024 \
    --key_size=16 \
    --compaction_style=1 \
    --write_buffer_size=134217728 \
    --max_write_buffer_number=4 \
    --threads=8 \
    --statistics=1
```

            

`db_bench` 的输出包含
            ops/s、延迟分位数和写放大统计。对比两次运行的结果，可以量化
            Compaction 策略对写入性能的影响。
            

### 10.6 写入性能调优检查清单

            

在 RocksDB 写入性能调优时，按以下顺序排查：
            
            
- **确认磁盘性能**：用 fio 测量裸盘的 fsync
            延迟和顺序写带宽，确定硬件上限。
            
- **检查 Write Stall**：查看 LOG 文件和
            `rocksdb.stall.micros`
            指标，确认是否有写停顿。
            
- **调整 MemTable
            大小**：`write_buffer_size` 和
            `max_write_buffer_number`
            是影响最大的两个参数。
            
- **调整 Compaction 并发度**：增加
            `max_background_compactions` 和
            `max_background_flushes`。
            
- **选择合适的 Compaction
            策略**：写入密集型负载考虑 Universal
            Compaction。
            
- **考虑 Rate Limiter**：避免 Compaction
            占满磁盘带宽影响前台写入。
            
- **评估 WAL 配置**：是否需要
            `sync = true`，是否可以
            `disableWAL`。
            
- **评估 Direct I/O**：大数据量场景考虑开启
            Flush/Compaction 的 Direct I/O。
            
            
            

## 十一、参考文献

            
            
- 

Facebook Engineering. “RocksDB Tuning Guide.” GitHub
            Wiki, https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide
            
- 

Mark Callaghan. “Read, Write & Space
            Amplification - Pick 2.” RocksDB Blog, 2015. http://rocksdb.org/blog/2015/07/23/dynamic-level.html
            
- 

MySQL Reference Manual. “Optimizing InnoDB Disk I/O.”
            Oracle Documentation, https://dev.mysql.com/doc/refman/8.0/en/optimizing-innodb-diskio.html
            
- 

PostgreSQL Documentation. “WAL Configuration.”
            PostgreSQL 17 Documentation, https://www.postgresql.org/docs/17/wal-configuration.html
            
- 

PostgreSQL Documentation. “Reliability and the
            Write-Ahead Log.” PostgreSQL 17 Documentation, https://www.postgresql.org/docs/17/wal-reliability.html
            
- 

Siying Dong, Mark Callaghan, Leonidas Galanis, Dhruba
            Borthakur, Tony Savor, Michael Strum. “Optimizing Space
            Amplification in RocksDB.” CIDR 2017.
            
- 

MySQL Reference Manual. “Binary Log Group Commit.”
            Oracle Documentation, https://dev.mysql.com/doc/refman/8.0/en/replication-options-binary-log.html
            
- 

RocksDB Wiki. “Write Stalls.” GitHub, https://github.com/facebook/rocksdb/wiki/Write-Stalls
            
- 

RocksDB Wiki. “Rate Limiter.” GitHub, https://github.com/facebook/rocksdb/wiki/Rate-Limiter
            
- 

PostgreSQL Wiki. “Tuning Your PostgreSQL Server.” https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server
            
- 

Lanyue Lu, Thanumalayan Sankaranarayana Pillai,
            Andrea C. Arpaci-Dusseau, Remzi H. Arpaci-Dusseau. “WiscKey:
            Separating Keys from Values in SSD-conscious Storage.” FAST
            2016.
            
            
            

**上一篇**: 缓存工程：从
            Page Cache 到应用层缓存
            

**下一篇**: 读取性能优化
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-28 · linux / storage
                    

### fsync 失败的真相：当它返回错误，你的数据可能已经没了

                    

fsync() 返回 EIO 后再调一次为什么会成功？为什么这反而是灾难？从 2018 fsyncgate 到 Linux errseq_t，再到本机内核 6.6 上用 dm-error 单块故障注入的实测，讲清 writeback 失败时脏页被标记 clean、数据静默丢失的真相，以及 PostgreSQL 为什么选择 PANIC。
                

                
                    

2025-08-21 · storage
                    

### 【存储工程】数据完整性：从 fsync 到端到端校验

                    

数据丢失最令人恐惧的形式不是磁盘报错——而是数据悄无声息地变了，没有任何告警，没有任何日志，直到几个月后你从备份里恢复出一堆损坏的文件，才发现"完整性"这个词从来就不是理所当然的。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

在 Linux 的传统 I/O 路径中，应用程序通过 read() 和 write() 系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：
                

                
                    

2025-09-05 · storage
                    

### 【存储工程】WAL 与崩溃恢复：ARIES 协议

                    

WAL 是数据库持久性的基石，ARIES 是工业界公认最完备的崩溃恢复协议。本文从 WAL 三条规则出发，逐步拆解 ARIES 的 Analysis-Redo-Undo 三阶段，结合 InnoDB 实现分析恢复全流程。