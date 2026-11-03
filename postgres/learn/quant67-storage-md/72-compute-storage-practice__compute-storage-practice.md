# 【存储工程】计算存储分离实践

来源: https://quant67.com/post/storage/72-compute-storage-practice/compute-storage-practice.html
日期: 2025-10-20 |

---

一台数据库服务器既跑计算又存数据，容量不够就加磁盘，CPU
            不够就换更大的机器——这种架构在单机时代运转良好，但到了云原生时代就成了瓶颈：计算和存储的扩缩容需求完全不同步，绑在一起意味着要么浪费
            CPU，要么浪费磁盘。计算存储分离（Disaggregated
            Storage，也叫存算分离）的核心思路就是把计算节点和存储节点拆开，让它们各自独立扩缩。
            

但”分离”不是一种架构，而是一个光谱。Aurora
            把存储层下沉到一个自研的分布式日志服务，计算节点只发日志不发数据页；TiDB
            的 TiKV 和 TiFlash 本身就是独立的存储引擎，但计算层（TiDB
            Server）和存储层之间依然有紧耦合的 RPC 交互；Snowflake
            把数据全部扔进 S3
            这样的对象存储，计算节点是无状态的虚拟仓库（Virtual
            Warehouse）；ClickHouse 的 SharedMergeTree 引擎则是在传统
            MergeTree
            基础上把数据持久化到对象存储、用本地磁盘做缓存。
            

这四种架构代表了存算分离的四条不同路径。本文逐一拆解它们的架构设计、数据流、性能特征和工程代价，最后给出面向不同负载类型的选型判断。
            
            

## 一、存算分离的核心问题与分类

            

### 1.1 为什么要分离

            

传统的存算一体（Shared-Nothing）架构把数据分片绑定到固定的计算节点上，面临三个结构性矛盾：
            

**扩缩容粒度不匹配。** OLTP
            数据库在促销活动期间需要 10
            倍计算能力，但数据量没有变化。存算一体架构只能整机扩容——加机器意味着要做数据再平衡（Rebalancing），耗时几十分钟到几小时，远远跟不上弹性需求。
            

**资源利用率低。**
            典型的存算一体集群，计算节点的 CPU 利用率白天 60%、夜间
            5%，但存储空间始终占用。如果计算和存储分离，夜间可以缩减计算节点到
            1/10，存储成本不变但计算成本下降 90%。
            

**可用性与数据持久性耦合。**
            存算一体架构中，计算节点故障意味着它上面的数据分片不可用。恢复要么等节点重启，要么从副本重建，两者都有恢复时间。存算分离后，计算节点是无状态或弱状态的，故障只需要在新节点上重新加载元数据即可恢复。
            

### 1.2 分离的三种模式

            

存算分离不是一种单一架构，而是一个设计空间。按照存储层的抽象程度，可以分为三种模式：
            
```
┌───────────────────────────────────────────────────────────────┐
│                     存算分离架构光谱                          │
├───────────────┬───────────────────┬───────────────────────────┤
│  共享日志存储  │  分布式 KV 存储   │  对象存储 + 本地缓存      │
│  (Shared Log) │  (Distributed KV) │  (Object Store + Cache)   │
├───────────────┼───────────────────┼───────────────────────────┤
│  Aurora       │  TiDB (TiKV)      │  Snowflake / ClickHouse   │
│               │                   │  SharedMergeTree          │
├───────────────┼───────────────────┼───────────────────────────┤
│  延迟最低     │  延迟居中          │  延迟最高（首次访问）     │
│  耦合度最高   │  耦合度居中        │  耦合度最低               │
│  弹性一般     │  弹性居中          │  弹性最强                 │
└───────────────┴───────────────────┴───────────────────────────┘
```

            

**共享日志存储。** 计算节点把 WAL
            日志发送到共享存储层，存储层负责将日志回放（Replay）成数据页。计算节点不直接管理数据页的持久化。Aurora
            是这条路径的代表。
            

**分布式 KV 存储。**
            存储层是一个独立的分布式键值系统，计算层通过 RPC
            读写数据。TiDB 的 TiKV 和 TiFlash 属于这种模式。
            

**对象存储加本地缓存。** 数据持久化到
            S3、GCS、Azure Blob
            等对象存储，计算节点用本地磁盘（SSD）做缓存层。Snowflake 和
            ClickHouse SharedMergeTree 属于这种模式。
            

### 1.3 核心权衡

            

存算分离引入了一个根本性的权衡：**网络延迟
            vs. 弹性。**
            

存算一体架构下，计算和存储之间的”网络”就是 PCIe
            总线或内存总线，延迟在纳秒到微秒级。存算分离后，计算和存储之间隔了一层网络，即使是同一个可用区（Availability
            Zone）内的网络，RTT 也在 50-500 微秒；跨可用区则到 1-5
            毫秒。这个延迟差距是所有存算分离架构都必须面对的基本物理约束。
            

各架构的设计差异，本质上就是在不同层次对抗这个网络延迟：Aurora
            通过只发日志（不发数据页）来减少网络流量；TiDB 通过
            Coprocessor 把计算下推到存储层来减少数据搬运；Snowflake
            通过激进的本地缓存来隐藏对象存储的延迟；ClickHouse
            通过列式存储的高压缩比来减少从对象存储读取的数据量。
            
            

## 二、Aurora：日志即存储

            

### 2.1 架构概览

            

Amazon Aurora 的核心设计思想来自 2017 年 SIGMOD 论文
            “Amazon Aurora: Design Considerations for High Throughput
            Cloud-Native Relational Databases”（Verbitski et
            al.）。它的核心口号是”the log is the
            database”——日志就是数据库。
            

传统 MySQL 的写路径：数据页修改 → 写 redo log → 写 binlog
            → 刷脏页到数据文件。一次写操作涉及 4 种不同的 I/O，每种 I/O
            都要跨网络发送到 EBS（Elastic Block
            Store），总共产生大量的网络流量和同步等待。
            

Aurora 的做法：计算节点只把 redo log
            发送到存储层，存储层负责把日志回放成数据页。计算节点不再刷脏页、不再写数据文件、不再维护
            double-write buffer。
            

下面这张图展示了 Aurora 的数据流：
            
```
graph TB
    subgraph 计算层
        W["写入节点
(Primary)"]
        R1["只读副本 1"]
        R2["只读副本 2"]
    end

    subgraph 存储层["Aurora 分布式存储层（6 副本，跨 3 个 AZ）"]
        S1["存储节点 AZ-a-1"]
        S2["存储节点 AZ-a-2"]
        S3["存储节点 AZ-b-1"]
        S4["存储节点 AZ-b-2"]
        S5["存储节点 AZ-c-1"]
        S6["存储节点 AZ-c-2"]
    end

    W -- "Redo Log Records" --> S1
    W -- "Redo Log Records" --> S2
    W -- "Redo Log Records" --> S3
    W -- "Redo Log Records" --> S4
    W -- "Redo Log Records" --> S5
    W -- "Redo Log Records" --> S6

    S1 -. "异步回放日志
生成数据页" .-> S1
    S3 -. "异步回放日志
生成数据页" .-> S3
    S5 -. "异步回放日志
生成数据页" .-> S5

    W -- "Log Stream
(异步)" --> R1
    W -- "Log Stream
(异步)" --> R2
```

            

这张图的核心路径是：写入节点（Primary）将 redo log 发送到
            6 个存储节点（分布在 3 个可用区，每个 AZ
            两个副本）。存储节点异步地将日志回放成数据页。只读副本通过异步日志流获取变更，更新自己的内存缓存。
            

### 2.2 写入路径详解

            

Aurora 的写入路径可以分为以下几步：
            
            
- **事务修改内存中的 Buffer Pool 页面。**
            和传统 MySQL 一样，写操作先修改 Buffer Pool
            中的数据页。
            
- **生成 redo log record。**
            每次页面修改生成一条 redo log record，包含页面
            ID、修改偏移量和新值。
            
- **将 log record 发送到 6 个存储节点。**
            写入节点将 log record 通过网络发送到所有 6
            个存储节点。这一步是网络 I/O，而不是磁盘 I/O。
            
- **等待 4/6 的存储节点确认。** Aurora 使用
            4/6 写入仲裁（Write Quorum）——只要 6 个存储节点中有 4
            个确认收到了日志，写入就被认为持久化成功。这意味着任何一个
            AZ 完全故障（丢失 2 个存储节点）后，写入仍然可以继续。
            
- **推进 VCL（Volume Complete LSN）。**
            当日志序列号（LSN）的所有前序日志都被 4/6 确认后，这个 LSN
            成为 VCL，之前的所有事务可以被认为已持久化。
            
- **不刷脏页。** 计算节点的 Buffer Pool
            中的脏页不需要刷到磁盘——存储层已经拥有了重建任意页面所需的全部日志。当
            Buffer Pool 需要淘汰一个脏页时，直接丢弃即可。
            
            

这个设计的关键洞察是：传统数据库的写放大（Write
            Amplification）大量来自脏页刷盘——一个 16 KB
            的页面即使只修改了 1 个字节，也要完整地写一次。Aurora
            只发日志，一条 redo log record
            通常只有几十到几百字节，网络流量比发送完整数据页小一到两个数量级。
            

### 2.3 读取路径与页面重建

            

Aurora 的读取路径和传统数据库类似——先查 Buffer
            Pool，命中则直接返回。未命中时的区别在于：
            

传统 MySQL 从本地数据文件读取页面。Aurora
            从存储层读取页面——存储层根据持久化的 redo
            log，在本地回放（Replay）生成最新版本的数据页，然后返回给计算节点。
            

存储层的回放是**异步且持续的**。在后台，每个存储节点不断地将收到的
            log record
            应用到对应的数据页上，保持数据页尽量是最新的。当计算节点请求一个页面时，存储节点通常只需要回放少量的残余日志就能返回最新页面。
            

只读副本的处理方式：只读副本通过异步日志流从写入节点接收
            log record，更新自己 Buffer Pool
            中的缓存页面。只读副本不需要从存储层频繁读取——它通过日志流保持缓存热度。Aurora
            的只读副本延迟通常在 10-20 毫秒，这比传统 MySQL
            主从复制的延迟（可能到秒级）要低得多。
            

### 2.4 Quorum 模型与容错

            

Aurora 使用 6 副本、3
            可用区的部署模型，配合以下仲裁规则：
            
            
- **写入仲裁：4/6。** 写入需要 4
            个存储节点确认。即使一个 AZ 完全故障（丢失 2 个节点），剩余
            4 个节点仍满足仲裁要求，写入继续。
            
- **读取仲裁：3/6。** 读取页面只需要 3
            个存储节点返回（取最新版本）。但在实践中，Aurora
            通常从单个存储节点读取，只在检测到不一致时才触发仲裁读取。
            
- **容错能力：** 可以同时容忍一个 AZ 故障（2
            个节点不可用）加上另一个 AZ 中的一个节点故障（总共 3
            个节点不可用），仍然能读取数据。写入需要 4/6，因此最多容忍 2
            个节点不可用。
            
            

存储层的修复（Repair）是后台自动进行的。当一个存储节点故障后，其他节点上的日志和数据页可以用来重建缺失的内容，不需要从完整的数据库快照恢复。修复的单位是
            10 GB 的存储段（Segment），修复一个 Segment 通常在 10
            秒左右——这比传统 RAID
            重建动辄几小时的时间快了几个数量级。
            

### 2.5 写入网络流量对比

            

Aurora
            的”日志即存储”设计大幅减少了计算节点到存储层的网络流量。下面用一个具体例子说明：
            

假设一次事务修改了一个 16 KB 的页面中的 100 字节。
            

**传统 MySQL on EBS 的写入路径：**
            
            
- 写 redo log：约 100-200 字节（日志记录本身）
            
- 写 binlog：约 200-500 字节（行变更记录）
            
- 写 double-write buffer：16 KB（完整页面的两次写入防止
            partial write）
            
- 刷脏页到数据文件：16 KB（完整页面）
            
            

总网络流量（到 EBS）：约 32-33 KB，写放大 300
            倍以上。
            

**Aurora 的写入路径：**
            
            
- 发送 redo log record 到 6 个存储节点：约 100-200 字节 x
            6 = 600-1200 字节
            
            

总网络流量：约 1.2
            KB，即使算上协议开销也远小于传统方案。
            

这就是 Aurora 论文中声称”网络流量减少到传统架构的
            1/46”的依据。网络流量的减少直接降低了写入延迟——发送 1 KB
            比发送 33 KB 快得多，尤其是在网络带宽成为瓶颈时。
            

### 2.6 性能特征

            

**写入延迟。** Aurora 的写入延迟主要由网络
            RTT 决定。将 log record 发送到 6 个存储节点并等待 4/6
            确认，在同区域内的延迟通常在 1-2 毫秒级别。相比传统 MySQL 写
            EBS 的延迟（包括 redo
            log、binlog、double-write、数据页，每种都可能是独立的
            I/O），Aurora 的 commit 延迟通常更低。Aurora
            论文中报告的写入吞吐量是传统 MySQL on EBS 的 5 倍。
            

**读取延迟。** Buffer Pool 命中时和传统
            MySQL
            一样（内存访问）。未命中时，从存储层获取页面的延迟大约在
            200-500 微秒（同 AZ 内），比本地 NVMe SSD 的 100
            微秒高，但比 EBS（gp3 的 P99 可能到 1-5 毫秒）更稳定。Aurora
            存储层的一个优势是延迟的可预测性——不像 EBS
            那样受多租户干扰影响出现偶发高延迟。
            

**弹性。** Aurora 的计算层（写入节点 +
            只读副本）可以在几分钟内扩缩。但写入节点只有一个（Aurora
            不是分布式写入），如果需要更高的写入吞吐，要么垂直扩展（换更大的实例），要么使用
            Aurora Multi-Master（有限制）。存储层自动扩展，最大 128
            TB，用户不需要预配置。Aurora Serverless v2
            更进一步——可以根据负载自动调整计算容量（ACU
            为单位），在低负载时降到最低 0.5 ACU，高负载时扩展到数百
            ACU。
            

**局限。** Aurora
            的写入节点是单点——虽然有故障切换（Failover），但切换期间写入不可用（通常
            30 秒内恢复）。存储层虽然自动扩展，但只支持 MySQL 和
            PostgreSQL 两种引擎。Aurora 本质上是一个面向 OLTP
            的系统，不适合大规模分析查询——如果业务有分析需求，需要通过
            Aurora 的零 ETL 集成（Zero-ETL Integration）将数据同步到
            Amazon Redshift 做分析。
            
            

## 三、TiDB：分布式 KV
            分层存储

            

### 3.1 架构概览

            

TiDB 是 PingCAP 开源的分布式 NewSQL
            数据库，架构设计参考了 Google Spanner 和 F1
            的思路。它的存算分离体现在三个独立组件：
            
            
- **TiDB Server（计算层）。** 无状态的 SQL
            引擎，负责解析
            SQL、生成执行计划、协调分布式事务。可以水平扩展，每个 TiDB
            Server 不持有任何数据。
            
- **TiKV（行存储）。** 分布式事务 KV
            存储引擎，数据按 Region（默认 96 MB）分片，每个 Region 有 3
            个副本（Raft 协议）。TiKV
            同时承担存储和部分计算（Coprocessor）。
            
- **TiFlash（列存储）。** 列式存储引擎，通过
            Raft Learner 机制从 TiKV 异步复制数据。TiFlash
            专为分析查询（OLAP）设计，不参与事务写入。
            
            
```
graph TB
    subgraph 计算层
        T1["TiDB Server 1"]
        T2["TiDB Server 2"]
        T3["TiDB Server 3"]
    end

    subgraph PD["PD (Placement Driver)"]
        PD1["元数据管理
调度器
TSO 时钟"]
    end

    subgraph 行存储
        K1["TiKV Node 1
Region 1 (Leader)
Region 4 (Follower)"]
        K2["TiKV Node 2
Region 1 (Follower)
Region 2 (Leader)"]
        K3["TiKV Node 3
Region 2 (Follower)
Region 3 (Leader)"]
    end

    subgraph 列存储
        F1["TiFlash Node 1
Region 1 列副本
Region 2 列副本"]
        F2["TiFlash Node 2
Region 3 列副本"]
    end

    T1 & T2 & T3 --> K1 & K2 & K3
    T1 & T2 & T3 --> F1 & F2
    T1 & T2 & T3 --> PD1
    K1 & K2 & K3 -- "Raft Learner
异步复制" --> F1 & F2
```

            

这张图展示了 TiDB 的三层架构。TiDB Server
            是无状态的计算节点，TiKV 是行存储，TiFlash
            是列存储。PD（Placement Driver）负责全局元数据管理、Region
            调度和 TSO（Timestamp Oracle，时间戳分配器）。TiKV
            的数据通过 Raft Learner 异步复制到 TiFlash。
            

### 3.2 TiKV 写入路径

            

TiKV 使用 Raft 共识协议（Raft Consensus
            Protocol）保证多副本一致性，写入路径：
            
            
- **TiDB Server 将事务的写操作按 Region
            分组，发送到对应 Region 的 Leader 节点。**
            
- **Leader 节点将写操作编码为 Raft Log
            Entry，追加到本地 Raft Log。**
            
- **Leader 将 Raft Log Entry 复制到 Follower
            节点。**
            
- **当多数派（通常 2/3）确认后，Leader
            提交（Commit）这条日志。**
            
- **提交后的日志被应用（Apply）到 RocksDB——TiKV
            底层的 LSM-Tree 存储引擎。**
            
            

RocksDB 的写入路径本身又包含：写 WAL → 写 MemTable →
            MemTable 满后 Flush 成 SST 文件 → 后台 Compaction。这意味着
            TiKV 的写入实际上经历了两层日志：Raft Log 和 RocksDB
            WAL。PingCAP 在后续优化中引入了 Raft Engine 来替代 RocksDB
            作为 Raft Log 的存储，减少了一层 LSM-Tree 的写放大。
            

### 3.3 Coprocessor：计算下推

            

TiDB 的一个关键优化是 Coprocessor 计算下推。当 TiDB
            Server
            执行一个带过滤条件的查询时，不是把所有数据拉到计算层再过滤，而是把过滤条件（Selection）、聚合（Aggregation）、TopN
            等操作推送到 TiKV 或 TiFlash
            节点上执行，只返回过滤后的结果。
            

例如，执行
            `SELECT COUNT(*) FROM orders WHERE amount > 1000`：
            
            
- **不下推：** TiDB Server 从 TiKV 拉取所有
            `orders` 行，在计算层过滤
            `amount > 1000`，再计算
            `COUNT(*)`。网络传输量大。
            
- **下推到 TiKV：** TiKV 在本地过滤
            `amount > 1000`，只返回满足条件的行数（或部分聚合结果）。网络传输量大幅减少。
            
- **下推到 TiFlash：** TiFlash 用列式存储读取
            `amount`
            列，过滤后直接返回计数。列式存储的压缩和向量化计算使得分析查询效率更高。
            
            

TiDB 优化器通过代价估算（Cost-Based
            Optimization）自动选择是否下推以及下推到 TiKV 还是
            TiFlash。用户也可以通过 Hint 手动控制：
            
```
-- 强制使用 TiFlash
SELECT /*+ READ_FROM_STORAGE(TIFLASH[orders]) */ COUNT(*)
FROM orders
WHERE amount > 1000;

-- 强制使用 TiKV
SELECT /*+ READ_FROM_STORAGE(TIKV[orders]) */ *
FROM orders
WHERE id = 12345;
```

            

### 3.4 TiFlash：HTAP
            的列存引擎

            

TiFlash 通过 Raft Learner 从 TiKV 异步复制数据。Raft
            Learner 是 Raft 协议的一个扩展角色——Learner
            接收日志但不参与投票，不影响 Raft 组的写入性能。
            

TiFlash 的存储格式基于 DeltaTree（类似 LSM-Tree
            的变体），将行式的 Raft Log 转换为列式存储。这个转换过程在
            TiFlash 节点本地完成，不需要额外的 ETL 流程。
            

TiFlash 的关键特性：
            
            
- **实时一致性。** TiFlash 使用 Raft Learner
            协议复制数据，通过 Read Index
            机制保证读取时的一致性——TiFlash 在读取前向 Leader 确认当前的
            Commit Index，确保读到的是已提交的最新数据。
            
- **列式向量化执行。** TiFlash
            对列数据做向量化（Vectorized）处理，利用 SIMD
            指令加速过滤、聚合等操作。
            
- **与 TiKV 的数据强一致。** 不像传统 ETL
            方案有 T+1 延迟，TiFlash 的复制延迟通常在秒级以内。
            
            

### 3.5 TiDB 的存储引擎对比

            

TiKV 和 TiFlash
            虽然存储相同的数据，但存储格式完全不同，适合不同的查询模式：
            
            
            
            维度
            TiKV（行存）
            TiFlash（列存）
            
            
            
            
            底层引擎
            RocksDB（LSM-Tree）
            DeltaTree（LSM-Tree 变体）
            
            
            数据组织
            按行存储，Key-Value 格式
            按列存储，每列独立压缩
            
            
            压缩率
            中等（LZ4/Zstd，整行压缩）
            高（列内相似数据压缩效果好）
            
            
            点查性能
            快（直接定位 Key）
            慢（需要组装多列）
            
            
            扫描性能
            慢（读取大量无关列）
            快（只读取需要的列）
            
            
            聚合计算
            CPU 开销大（逐行处理）
            CPU 开销小（向量化 + SIMD）
            
            
            事务支持
            完整 ACID（Percolator 协议）
            只读快照
            
            
            副本角色
            Leader / Follower（参与选举）
            Learner（不参与选举）
            
            
            复制延迟
            同步（Raft 多数派确认）
            异步（Raft Learner）
            
            
            
            

TiDB 优化器的智能路由（Intelligent Routing）是 HTAP
            架构的关键——它自动判断一个查询应该走 TiKV 还是
            TiFlash。判断规则基于代价模型：
            
            
- 如果查询涉及少量行的精确查找（点查、短范围查询），走
            TiKV。
            
- 如果查询涉及大规模扫描、聚合、Join，走 TiFlash。
            
- 如果查询同时涉及两者（例如点查和聚合的
            Union），可以分别路由。
            
            

### 3.6 性能特征

            

**OLTP 延迟。** TiDB 的点查（Point
            Query）延迟受 Raft 共识的影响。一次写操作至少需要 Leader
            将日志复制到一个 Follower 并获得确认（3 副本下的多数派是
            2），加上 RocksDB 的 WAL
            写入。在同机房部署下，点查延迟通常在 2-5 毫秒，比 Aurora
            略高（Aurora 的写入仲裁不涉及共识协议的多轮 RPC）。
            

**OLAP 吞吐。** TiFlash
            在分析查询上的表现接近专业 OLAP 系统。TPC-H 100GB
            测试中，TiFlash 的查询性能在部分查询上可以和 ClickHouse
            单机版相当（但在复杂 Join 上通常不如专用 OLAP 引擎）。
            

**弹性。** TiDB Server
            无状态，可以秒级扩缩。TiKV 和 TiFlash 的扩缩涉及 Region
            迁移（Leader Transfer + Region
            Split/Merge），通常需要分钟级到小时级，取决于数据量。
            
            

## 四、Snowflake：对象存储加本地缓存

            

### 4.1 架构概览

            

Snowflake 的架构设计来自 2016 年 SIGMOD 论文 “The
            Snowflake Elastic Data Warehouse”（Dageville et
            al.）。它的架构分为三个独立层次：
            
            
- **云服务层（Cloud Services Layer）。**
            负责认证、元数据管理、查询解析与优化、访问控制。这一层是多租户共享的。
            
- **计算层（Virtual Warehouses）。**
            由若干计算集群（Virtual Warehouse）组成，每个 Warehouse
            是一组 EC2 实例（或其他云厂商的虚拟机），带有本地 SSD
            缓存。Warehouse 之间完全隔离，互不影响。
            
- **存储层（Centralized Storage）。**
            所有数据持久化在 S3（或 Azure Blob、GCS）上。Snowflake
            使用自己的文件格式（列式、压缩、加密），每个表被拆分成若干微分区（Micro-Partition），每个微分区是一个不可变（Immutable）的文件，大小在
            50-500 MB。
            
            
```
graph TB
    subgraph CS["云服务层"]
        M["元数据管理"]
        O["查询优化器"]
        A["访问控制"]
    end

    subgraph VW["计算层"]
        W1["Virtual Warehouse XS
4 节点, 本地 SSD 缓存"]
        W2["Virtual Warehouse L
16 节点, 本地 SSD 缓存"]
        W3["Virtual Warehouse XL
64 节点, 本地 SSD 缓存"]
    end

    subgraph S3["存储层 (S3 / Azure Blob / GCS)"]
        P1["表 A
Micro-Partition 1..N"]
        P2["表 B
Micro-Partition 1..M"]
        P3["表 C
Micro-Partition 1..K"]
    end

    CS --> VW
    W1 --> S3
    W2 --> S3
    W3 --> S3
```

            

这张图展示了 Snowflake
            的三层架构。云服务层是共享的控制面；计算层由独立的 Virtual
            Warehouse 组成，每个 Warehouse 可以独立启停和扩缩；存储层是
            S3 等对象存储。
            

### 4.2 微分区与不可变文件

            

Snowflake
            的存储层设计围绕**不可变微分区**展开：
            
            
- 每个微分区（Micro-Partition）是一个独立的列式文件，压缩后大小通常在
            50-500 MB。
            
- 微分区一旦写入就不会被修改。`INSERT`
            创建新微分区，`UPDATE` 和 `DELETE`
            通过创建新微分区（包含修改后的数据）并标记旧微分区为过期来实现。
            
- 元数据层维护一个微分区列表和每个微分区的统计信息（最小值、最大值、行数、空值数等），用于查询时的分区裁剪（Partition
            Pruning）。
            
            

这种设计的好处是：
            
            
- **无锁并发。**
            读操作读取的是不可变文件，不需要锁。多个 Warehouse
            可以同时读取同一份数据。
            
- **Time Travel。**
            保留旧版本的微分区，支持查询历史数据——默认保留 1 天，最长 90
            天。
            
- **Zero-Copy Clone。**
            克隆一个表只需要复制元数据（微分区列表），不需要复制实际数据文件。
            
            

### 4.3 本地缓存策略

            

Snowflake 的计算节点用本地 SSD
            做缓存，采用一致性哈希（Consistent Hashing）来分配微分区到
            Warehouse 中的节点：
            
            
- 每个微分区根据其文件名哈希，固定分配到 Warehouse
            中的某个节点。
            
- 同一个微分区的多次查询总是路由到同一个节点，最大化缓存命中率。
            
- 当 Warehouse
            扩缩容（增减节点）时，一致性哈希保证大部分微分区的分配不变，只有少量微分区需要重新分配。
            
            

缓存是非持久化的——Warehouse
            暂停后缓存丢失，恢复后需要重新从 S3 加载。Snowflake
            推荐在查询密集时段保持 Warehouse
            运行，在空闲时段暂停以节省成本。
            

### 4.4 查询执行流程

            

一次 Snowflake 查询的完整流程：
            
            
- **用户提交 SQL 到云服务层。**
            
- **云服务层解析
            SQL、检查权限、生成优化后的执行计划。**
            
- **云服务层根据元数据做分区裁剪——确定需要扫描哪些微分区。**
            这一步可能将需要扫描的数据量从 TB 级减少到 GB 级。
            
- **执行计划下发到 Virtual Warehouse
            的各节点。**
            
- **每个节点检查本地缓存——命中则直接读取缓存数据，未命中则从
            S3 下载微分区并缓存到本地 SSD。**
            
- **各节点执行本地计算（扫描、过滤、聚合），通过
            Warehouse 内部网络交换中间结果。**
            
- **最终结果返回给用户。**
            
            

分区裁剪（Partition Pruning）是 Snowflake
            查询性能的关键。Snowflake
            维护了每个微分区中每列的最小值和最大值统计信息。当查询条件是
            `WHERE date >= '2025-01-01' AND date 
            
- **传统数据仓库：**
            购买固定大小的集群，计算和存储绑定。集群运行就计费，不管有没有查询。扩容需要增加节点，涉及数据重分布。
            
- **Snowflake：** 存储按实际占用的 S3
            空间计费（压缩后），计算按 Warehouse
            运行时间计费（以”信用”为单位）。Warehouse
            暂停后只收存储费。多个 Warehouse
            可以同时访问同一份数据，适合不同团队或不同负载使用不同大小的
            Warehouse。
            
            

这种模型对成本控制的影响很大。一个典型场景：白天有 100
            个分析师做 ad-hoc 查询，需要大 Warehouse；晚上只有 ETL
            作业，用小 Warehouse 就够了。Snowflake 可以白天开 XL
            Warehouse、晚上缩到 XS
            或直接暂停，成本可能只有固定集群方案的 1/5。
            

### 4.6 性能特征

            

**查询延迟。** Snowflake
            面向分析场景，单次查询延迟通常在秒到分钟级。首次查询冷启动时需要从
            S3 下载数据，S3 的首字节延迟（Time to First Byte）通常在
            50-200 毫秒，下载一个 100 MB 的微分区在同区域内大约需要
            0.5-2
            秒（取决于网络带宽）。缓存命中后延迟大幅下降。Snowflake
            不适合毫秒级的 OLTP 查询。
            

**吞吐量。** Snowflake 的吞吐量通过增加
            Warehouse 大小（更多节点）线性提升。XL Warehouse（64
            节点）的扫描吞吐量大约是 XS Warehouse（4 节点）的 16
            倍。多个 Warehouse 可以同时查询同一份数据，互不影响。
            

**弹性。** Snowflake
            的弹性是四个系统中最强的。Warehouse
            可以在秒级内启停；Multi-Cluster Warehouse
            可以根据并发查询数自动增减集群数量；存储层（S3）的容量和吞吐理论上无限。计算和存储完全独立计费——存储按实际用量计费，计算按
            Warehouse 运行时间计费。
            

**成本结构。** S3 的存储成本极低（约
            $0.023/GB/月），但 API 调用有成本（每千次 GET 约
            $0.0004）。对于大量小文件的访问模式，API
            成本可能显著。Snowflake 的微分区设计（50-500 MB
            的大文件）就是为了控制 API 调用次数。
            

### 4.6 写入处理

            

Snowflake 的写入模式和传统 OLTP 数据库不同：
            
            
- **批量写入为主。** `COPY INTO`
            命令是推荐的数据加载方式，从 S3 Stage
            区域批量加载文件到表中。单条 `INSERT`
            性能很差——每次 `INSERT`
            都会创建一个新的微分区文件。
            
- **Snowpipe。** 准实时数据加载服务，监控 S3
            路径上的新文件，自动加载到表中。延迟通常在 1 分钟内。
            
- **DML 性能。** 单条 `UPDATE` 或
            `DELETE` 需要重写整个微分区。如果一条
            `UPDATE` 影响的行分散在 1000
            个微分区中，Snowflake 需要重写 1000
            个微分区文件。这就是为什么 Snowflake 不适合高频 OLTP
            写入。
            
            
            

## 五、ClickHouse：SharedMergeTree
            存算分离

            

### 5.1 传统 ClickHouse
            的架构

            

ClickHouse 最初是一个存算一体的列式 OLAP
            数据库。每个节点既做计算又做存储，数据通过
            ReplicatedMergeTree
            引擎在节点之间复制。这种架构简单高效，但有两个问题：
            
            
- **扩缩容需要数据搬迁。**
            增加节点后要做数据再分布（Reshard），数据量大时耗时很长。
            
- **副本存储成本高。** 3 副本意味着 3
            倍的存储成本，而且每个副本都需要独立做 Merge 操作，CPU
            开销也是 3 倍。
            
            

### 5.2 SharedMergeTree 架构

            

ClickHouse Cloud 引入了 SharedMergeTree
            引擎来实现存算分离。它的核心变化：
            
            
- **数据持久化到对象存储（S3）。** MergeTree
            的 Part 文件（列文件、索引文件、标记文件等）存储在 S3
            上。
            
- **元数据存储在 ClickHouse Keeper（类似
            ZooKeeper）中。** Part
            的元数据（名称、大小、行数、列统计信息）维护在 Keeper
            里。
            
- **本地 SSD 作为缓存层。** 计算节点使用本地
            NVMe SSD 缓存最近访问的 Part
            文件，减少对象存储的访问次数。
            
            

SharedMergeTree 和 Snowflake 的区别在于：
            
            
- Snowflake 的微分区是不可变的文件；ClickHouse 的 Part
            也是不可变的（写入后不修改），但 Merge
            操作会生成新的、更大的 Part 文件并删除旧 Part。
            
- ClickHouse 的 Merge
            操作可以在任意计算节点上执行——计算节点从 S3 下载待 Merge 的
            Part，在本地合并后上传新 Part 到
            S3。这个设计避免了所有副本各自独立做 Merge 的重复开销。
            
- ClickHouse 保留了 MergeTree 的主键索引（Primary Key
            Index）和跳数索引（Skip
            Index），查询时先通过索引定位需要读取的 Mark
            范围，只下载必要的列文件片段，而不是整个 Part。
            
            

### 5.3 写入路径

            

SharedMergeTree 的写入路径：
            
            
- **数据写入 Buffer。**
            计算节点将写入的数据暂存在内存 Buffer 中。
            
- **Buffer 刷写成 Part。** Buffer
            达到一定大小或时间阈值后，刷写成一个 Part 文件。
            
- **Part 上传到 S3。** Part
            文件（包含列数据、主键索引、标记文件等）上传到对象存储。
            
- **元数据注册到 Keeper。** Part 的元数据写入
            ClickHouse Keeper。
            
- **后台 Merge。** 计算节点在后台将多个小
            Part 合并成大 Part——从 S3 下载小 Part，本地合并，上传新 Part
            到 S3，更新 Keeper 中的元数据。
            
            

### 5.4 查询路径

            

查询路径：
            
            
- **解析查询，根据 WHERE 条件和主键索引做分区裁剪和
            Mark 范围过滤。**
            
- **确定需要读取的 Part 列表和列文件。**
            
- **检查本地缓存——命中则直接读取。**
            
- **未命中的数据从 S3 下载，按 Mark 粒度（默认 8192
            行）读取，只下载需要的列。**
            
- **本地执行向量化计算（过滤、聚合、排序）。**
            
            

ClickHouse
            的列式存储和向量化执行引擎在查询性能上有天然优势。主键索引和
            Skip Index
            可以将实际读取的数据量限制在很小的范围内，减少从对象存储下载的数据量。
            

### 5.5
            ReplicatedMergeTree vs SharedMergeTree

            

理解 SharedMergeTree 的设计动机，需要对比它和传统
            ReplicatedMergeTree 的区别：
            
```
┌───────────────────────────┬───────────────────────────────┐
│   ReplicatedMergeTree     │      SharedMergeTree          │
│   (存算一体)               │      (存算分离)               │
├───────────────────────────┼───────────────────────────────┤
│ 每个副本存储完整数据       │ 数据存一份在 S3              │
│ 每个副本独立做 Merge       │ Merge 只做一次,结果共享      │
│ 副本间通过 ZK 协调 Merge   │ 通过 Keeper 协调元数据       │
│ 扩容需要数据拷贝          │ 扩容只需启动新计算节点       │
│ 3 副本 = 3x 存储成本       │ 1 份数据 + 缓存              │
│ 3 副本 = 3x Merge CPU      │ 1x Merge CPU                 │
│ 本地磁盘读取,延迟最低     │ 缓存命中时接近,未中时较高   │
└───────────────────────────┴───────────────────────────────┘
```

            

SharedMergeTree
            的关键优势在于**消除了副本维护的冗余开销**。传统
            ReplicatedMergeTree 的每个副本都独立执行 Merge——如果有 3
            个副本，同一份数据的 Merge 操作要做 3 次，消耗 3 倍的 CPU
            和磁盘 I/O。SharedMergeTree 只做一次 Merge，结果直接上传到
            S3，所有计算节点共享。
            

但 SharedMergeTree
            也引入了新的挑战：**缓存一致性。**
            当一个节点完成 Merge 并上传新 Part 到 S3
            后，其他节点的本地缓存中可能还保存着旧 Part
            的数据。ClickHouse 通过 Keeper
            的元数据变更通知机制来处理这个问题——节点在查询前检查 Keeper
            中的 Part 列表，如果发现本地缓存的 Part 已被 Merge
            替换，则失效旧缓存并从 S3 加载新 Part。
            

### 5.6 性能特征

            

**查询延迟。** ClickHouse
            的查询延迟取决于数据是否在缓存中。缓存命中时，查询性能和本地存储模式接近（亚秒级到秒级）。缓存未命中时，需要从
            S3 下载数据，延迟取决于数据量和 S3 带宽。ClickHouse 的 Mark
            粒度读取和列裁剪可以把实际下载量控制在较小范围内——例如一个
            100 列的表只查询 3 列，实际读取量只有 3%。
            

**写入性能。** SharedMergeTree
            的写入先到内存 Buffer，Buffer 刷写成 Part 后上传
            S3。写入吞吐受 S3 上传带宽限制，但由于 ClickHouse
            的写入是批量的（不是单行写入），吞吐量通常不是瓶颈。ClickHouse
            官方建议每次 INSERT 至少包含 1000
            行以上的数据，避免产生大量小 Part 增加 Merge 压力。
            

**Merge 开销。** Merge 操作需要从 S3 下载
            Part、本地合并、上传新 Part。在 SharedMergeTree 下，Merge
            只需要在一个节点上执行（其他节点通过 Keeper 感知新
            Part），比 ReplicatedMergeTree 的每个副本独立 Merge
            更高效。但 Merge 产生的 S3
            流量在数据量大时不可忽视——一个每天写入 1 TB 数据的表，后台
            Merge 可能产生额外 2-3 TB 的 S3 读写流量。
            

### 5.6 实战配置示例

            

以下是一个 ClickHouse SharedMergeTree
            表的创建示例（ClickHouse Cloud 环境）：
            
```
-- 创建使用 SharedMergeTree 的表
CREATE TABLE events
(
    event_date Date,
    event_type String,
    user_id UInt64,
    event_data String,
    amount Decimal(18, 2)
)
ENGINE = SharedMergeTree('/clickhouse/tables/{shard}/events', '{replica}')
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_type, user_id, event_date)
SETTINGS
    storage_policy = 's3_main',
    min_bytes_for_wide_part = 10485760;

-- 批量插入数据
INSERT INTO events
SELECT
    today() - number % 365,
    ['click', 'view', 'purchase', 'refund'][number % 4 + 1],
    number % 1000000,
    'event_payload_' || toString(number),
    (number % 10000) / 100.0
FROM numbers(10000000);

-- 查询——利用主键索引和分区裁剪
SELECT
    event_type,
    count() AS cnt,
    sum(amount) AS total_amount,
    avg(amount) AS avg_amount
FROM events
WHERE event_date >= '2025-01-01' AND event_date 
            

这个例子展示了 SharedMergeTree
            的基本用法。`PARTITION BY toYYYYMM(event_date)`
            按月分区，查询
            `WHERE event_date >= '2025-01-01'` 时只扫描
            2025 年 1-3
            月的分区。`ORDER BY (event_type, user_id, event_date)`
            定义了主键，按 `event_type`
            过滤时可以利用主键索引跳过无关数据。
            
            

## 六、架构对比

            

### 6.1 数据流对比

            

四个系统的核心数据流差异：
            
            
            
            
            
            
            
            
            
            
            维度
            Aurora
            TiDB
            Snowflake
            ClickHouse (Shared)
            
            
            
            
            计算→存储传输内容
            Redo Log（几十~几百字节/op）
            Raft Log + KV 写入
            不可变微分区文件（50-500 MB）
            Part 文件（列式压缩）
            
            
            存储层格式
            日志 + 数据页（16 KB）
            LSM-Tree SST 文件
            列式微分区（自有格式）
            MergeTree Part 文件
            
            
            写入持久化确认
            4/6 Quorum 网络确认
            Raft 多数派确认
            S3 PUT 成功
            S3 PUT 成功 + Keeper 注册
            
            
            读取来源
            Buffer Pool → 存储层
            RocksDB Block Cache → 磁盘
            本地 SSD 缓存 → S3
            本地 SSD 缓存 → S3
            
            
            计算下推
            无
            Coprocessor（TiKV/TiFlash）
            无（计算全在 Warehouse）
            无（计算全在本地）
            
            
            
            

### 6.2 性能特征对比

            
            
            
            
            
            
            
            
            
            
            
            指标
            Aurora
            TiDB (TiKV)
            TiDB (TiFlash)
            Snowflake
            ClickHouse (Shared)
            
            
            
            
            点查延迟
            1-5 ms
            2-10 ms
            不适用
            不适用
            不适用
            
            
            范围查询
            中等
            中等
            快（列存）
            快（列存）
            极快（列存+索引）
            
            
            分析聚合
            慢
            慢（TiKV）
            快
            快
            极快
            
            
            写入吞吐
            高（单写节点）
            高（多 Leader）
            只读
            批量写入高
            批量写入高
            
            
            并发事务
            强（ACID）
            强（ACID）
            只读快照
            弱（批量操作）
            最终一致
            
            
            
            

上表中的”点查延迟”是指单行精确查询（如
            `WHERE id = X`）的延迟，“分析聚合”指大规模
            `GROUP BY` / `SUM` /
            `COUNT` 的性能。Aurora 和 TiKV 面向
            OLTP，点查快但分析慢；Snowflake 和 ClickHouse 面向
            OLAP，分析快但不适合点查；TiDB 通过 TiFlash
            在两者之间取得平衡。
            

### 6.3 故障恢复对比

            

存算分离架构的故障恢复特性是选型时容易忽略但极为重要的维度：
            
            
            
            
            
            
            
            
            
            
            故障场景
            Aurora
            TiDB
            Snowflake
            ClickHouse (Shared)
            
            
            
            
            计算节点故障
            Failover 到只读副本（< 30 秒）
            Raft Leader 转移（< 30 秒）
            其他节点接管任务
            其他节点接管查询
            
            
            存储节点故障
            Quorum 容错 + 后台自动修复（10 秒/Segment）
            Raft 副本自动切换
            S3 自身高可用（99.99%）
            S3 自身高可用
            
            
            可用区故障
            写入继续（4/6 Quorum 仍满足）
            Raft 自动切换到其他 AZ
            需要 Warehouse 在多 AZ 部署
            依赖 S3 跨 AZ 复制
            
            
            全区域故障
            Aurora Global Database 切换（< 1 分钟）
            需要手动切换到备用集群
            需要跨区域复制配置
            需要跨区域 S3 复制
            
            
            数据恢复（误删除）
            Time Travel + 快照恢复
            快照恢复
            Time Travel（最长 90 天）
            快照恢复
            
            
            
            

Aurora 的故障恢复能力在四个系统中最成熟——计算节点的
            Failover 在秒级完成，存储层的修复以 10 GB Segment
            为单位并行进行。Snowflake 的 Time Travel
            功能在数据恢复方面最灵活，可以查询任意历史时间点的数据。
            

### 6.4 弹性与成本对比

            
            
            
            
            
            
            
            
            
            
            维度
            Aurora
            TiDB
            Snowflake
            ClickHouse (Shared)
            
            
            
            
            计算扩缩速度
            分钟（加只读副本）
            秒（TiDB Server）/ 分钟~小时（TiKV）
            秒~分钟（Warehouse 启停）
            分钟（加计算节点）
            
            
            存储扩缩
            自动（最大 128 TB）
            需要 Region 迁移
            自动（S3 无限）
            自动（S3 无限）
            
            
            最低运行成本
            中等（至少一个写节点）
            高（至少 3 TiKV + 3 TiDB + 3 PD）
            低（Warehouse 可暂停）
            低（计算可暂停）
            
            
            存储单价
            高（$0.10/GB/月，含多副本）
            中等（取决于磁盘类型）
            低（S3 约 $0.023/GB/月）
            低（S3 约 $0.023/GB/月）
            
            
            计费模型
            实例小时 + 存储 + I/O
            自行管理基础设施
            Warehouse 运行时间 + 存储
            计算节点时间 + 存储
            
            
            
            

Snowflake 和 ClickHouse Cloud
            在成本弹性上优势明显——存储用 S3
            的超低价格，计算按需启停。Aurora
            的存储层是自研的，副本成本包含在存储价格中，单价比 S3
            高。TiDB 如果自行部署，需要管理 TiKV、TiDB
            Server、PD、TiFlash 多个组件的基础设施成本。
            
            

## 七、选型指南

            

### 7.1 按负载类型选择

            

不同的存算分离架构适合不同的负载类型。以下是基于负载类型的选型建议：
            

**纯 OLTP
            场景（高并发短事务、低延迟点查）。** Aurora
            是首选。它的日志即存储架构把写入延迟优化到最低，Buffer Pool
            命中率高时读取延迟和单机数据库接近。如果需要 MySQL 或
            PostgreSQL 兼容性，Aurora 几乎是云上存算分离 OLTP
            的唯一生产级选择。TiDB 也能覆盖 OLTP，但延迟比 Aurora
            略高（Raft 共识的额外开销），优势在于 MySQL
            兼容的同时支持分布式写入。
            

**纯 OLAP
            场景（大规模分析查询、高吞吐扫描）。** ClickHouse
            SharedMergeTree
            在分析查询性能上通常是最优选择——列式存储、向量化执行、主键索引和
            Skip Index
            的组合在同等硬件上的扫描和聚合速度远超行存储系统。Snowflake
            的优势在于完全托管、零运维、极强的弹性——如果团队不想管基础设施，Snowflake
            是更务实的选择。
            

**HTAP 场景（OLTP + OLAP 混合负载）。** TiDB
            的 TiKV + TiFlash 架构是目前少数能在一个系统里同时服务 OLTP
            和 OLAP 的方案。OLTP 流量走 TiKV（行存），OLAP 流量走
            TiFlash（列存），两者共享一致的数据。实际工程中需要注意：TiFlash
            的复制延迟虽然通常在秒级，但在写入突增时可能拉大到十秒甚至分钟级。如果业务对分析查询的实时性要求不高（允许几十秒延迟），TiDB
            的 HTAP 方案比维护两套系统（一套 OLTP + 一套 OLAP + ETL
            管道）简单得多。
            

### 7.2 按数据规模选择

            

数据规模也是选型的关键因素：
            

**GB 级（< 100 GB）。**
            这个量级下，存算分离的收益有限。单机 MySQL/PostgreSQL
            就能处理，运维最简单。如果已经在 AWS 上，Aurora Serverless
            v2 可以获得自动扩缩的便利，但不是必须的。
            

**TB 级（100 GB - 10 TB）。**
            这是存算分离开始体现价值的区间。OLTP 选
            Aurora（省去分库分表的痛苦），OLAP 选 Snowflake 或
            ClickHouse。TiDB
            在这个量级也能胜任，但部署复杂度相对于数据量来说偏高。
            

**PB 级（10 TB+）。**
            存算分离几乎是唯一可行的方案。存储成本决定了必须使用对象存储（S3/GCS/Azure
            Blob），否则存储成本会失控。Snowflake 和 ClickHouse
            SharedMergeTree 是这个量级的主力选择。TiDB 的 TiKV
            节点需要本地磁盘，PB 级数据的磁盘成本和管理复杂度很高。
            

### 7.3 决策树

            

下面这个决策树可以帮助快速定位：
            
```
你的核心需求是什么？
│
├─ 低延迟事务（
            

## 八、工程实践：从存算一体迁移到存算分离

            

### 8.1 迁移路径

            

从存算一体架构迁移到存算分离不是一次性的割接，而是一个渐进过程。下面以”从
            MySQL 单机迁移到 Aurora”为例，展示典型的迁移路径：
            
```
阶段 1：评估与测试
├── 用 Aurora 创建测试实例
├── 使用 AWS DMS (Database Migration Service) 做全量 + 增量复制
├── 在测试环境跑业务关键查询，对比性能
└── 重点验证：事务兼容性、存储过程兼容性、延迟分布

阶段 2：双写/双读验证
├── 生产环境部署 Aurora 作为只读副本
├── 通过 DMS 持续同步
├── 部分读流量切到 Aurora，验证数据一致性
└── 重点验证：高并发下的延迟和吞吐

阶段 3：切换
├── 停写源 MySQL
├── 等待 DMS 追平增量
├── 切换写流量到 Aurora
├── 保留源 MySQL 作为回退方案（至少保留一周）
└── 重点验证：failover 机制、监控告警

阶段 4：优化
├── 根据 Aurora 的特性优化——例如利用只读副本分担读流量
├── 评估 Aurora I/O-Optimized vs Standard 的成本
└── 调整 Buffer Pool 大小、连接池参数
```

            

### 8.2 迁移中的关键决策

            

**要不要改应用代码？** 如果从 MySQL 迁移到
            Aurora，应用代码通常不需要改——Aurora 兼容 MySQL 协议和 SQL
            语法。但如果从 MySQL 迁移到 TiDB，需要注意以下差异：
            
```
-- TiDB 不支持的 MySQL 特性示例：
-- 1. 外键约束（TiDB 从 v6.6 开始支持，但性能影响大）
-- 2. 存储过程和触发器（部分支持）
-- 3. SELECT ... FOR UPDATE 的行为差异
--    MySQL: 锁住扫描到的所有行
--    TiDB: 悲观事务模式下行为类似，但实现机制不同

-- TiDB 推荐的主键策略——避免写入热点
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,  -- 使用 AUTO_RANDOM 替代 AUTO_INCREMENT
    user_id BIGINT NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id)
);
```

            

**要不要做数据分层？** 对于同时有 OLTP 和
            OLAP 需求的系统，可以考虑 OLTP 数据留在
            Aurora/TiDB，历史数据通过 CDC（Change Data
            Capture，变更数据捕获）同步到 Snowflake 或 ClickHouse
            做分析。这种架构比纯 HTAP
            方案更灵活，但引入了额外的数据管道复杂度。
            

下面是一个使用 Kafka + ClickHouse 的 CDC
            管道配置示例：
            
```
# Debezium MySQL Connector 配置
# 将 MySQL/Aurora 的 binlog 变更实时推送到 Kafka
connector.class: io.debezium.connector.mysql.MySqlConnector
database.hostname: aurora-cluster.xxx.us-east-1.rds.amazonaws.com
database.port: 3306
database.user: cdc_user
database.password: ${CDC_PASSWORD}
database.server.id: 184054
database.server.name: aurora-prod
database.include.list: mydb
table.include.list: mydb.orders,mydb.events
database.history.kafka.bootstrap.servers: kafka:9092
database.history.kafka.topic: schema-changes.aurora-prod
transforms: route
transforms.route.type: org.apache.kafka.connect.transforms.RegexRouter
transforms.route.regex: "([^.]+)\\.([^.]+)\\.([^.]+)"
transforms.route.replacement: "cdc.$3"
```

            
```
-- ClickHouse 端：使用 Kafka 引擎消费 CDC 数据
CREATE TABLE orders_kafka (
    id UInt64,
    user_id UInt64,
    amount Decimal(18, 2),
    created_at DateTime,
    _op String  -- Debezium 操作类型: c/u/d
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'cdc.orders',
    kafka_group_name = 'clickhouse_consumer',
    kafka_format = 'JSONEachRow';

-- 物化视图将 Kafka 数据写入 SharedMergeTree 表
CREATE MATERIALIZED VIEW orders_mv TO orders AS
SELECT id, user_id, amount, created_at
FROM orders_kafka
WHERE _op IN ('c', 'u');  -- 只处理插入和更新，删除另行处理
```

            

这个例子展示了从 Aurora 通过 Debezium CDC 同步数据到
            Kafka，再由 ClickHouse 的 Kafka 引擎消费并写入
            SharedMergeTree 表的完整链路。实际生产中还需要处理 Schema
            变更、删除事件（可以用 ReplacingMergeTree
            的版本列）、exactly-once 语义等问题。
            

### 8.3 监控与可观测性

            

存算分离架构引入了新的监控维度——计算与存储之间的网络成为关键路径，必须监控。以下是各系统需要重点关注的监控指标：
            

**Aurora 关键指标：** -
            `AuroraReplicaLag`：只读副本的复制延迟。超过 100
            毫秒需要关注，超过 1 秒可能影响业务。 -
            `BufferCacheHitRatio`：Buffer Pool 命中率。低于
            95% 说明实例内存不够，频繁从存储层读取页面。 -
            `StorageNetworkThroughput`：计算节点到存储层的网络吞吐。Aurora
            的性能上限受此指标约束。 -
            `CommitLatency`：事务提交延迟。反映 4/6 Quorum
            写入的端到端延迟。
            

**TiDB 关键指标：** -
            `tikv_raftstore_apply_log_duration`：Raft Log
            Apply 延迟。这是写入路径的关键步骤。 -
            `tiflash_raft_learner_lag`：TiFlash
            复制延迟。如果持续增长，说明 TiFlash 跟不上写入速度。 -
            `tikv_grpc_msg_duration`：TiKV gRPC
            请求延迟。反映计算层到存储层的 RPC 延迟。 -
            `tidb_session_transaction_duration`：事务持续时间。长事务会阻碍
            GC（Garbage Collection）和增加锁冲突。
            

**Snowflake 关键指标：** -
            `QUERY_HISTORY` 中的
            `BYTES_SCANNED`：每次查询扫描的数据量。如果远大于返回的数据量，说明分区裁剪效果不好。
            - `WAREHOUSE_METERING_HISTORY`：Warehouse
            信用消耗历史。用于成本分析和优化。 -
            `LOCAL_DISK_IO` vs
            `REMOTE_DISK_IO`：本地缓存 I/O vs S3 I/O
            的比例。缓存命中率低说明 Warehouse
            大小不够或数据访问模式不规律。
            

**ClickHouse SharedMergeTree 关键指标：** -
            `system.merge_tree_settings` 中的
            `parts_to_throw_insert`：当 Part
            数量超过阈值时拒绝写入。如果频繁触发，说明 Merge
            跟不上写入。 - `system.events` 中的
            `S3ReadBytes` / `S3WriteBytes`：S3
            读写流量。用于估算 S3 成本。 - `system.query_log`
            中的 `read_bytes` vs
            `result_bytes`：读取数据量 vs
            返回数据量的比例。反映列裁剪和索引过滤的效果。
            

### 8.4 容量规划

            

存算分离架构的容量规划和存算一体有本质区别：
            

**存算一体：** 容量规划是”这台机器需要多少
            CPU、多少内存、多少磁盘”——三者绑定在一起。磁盘不够就得换机器或加机器，即使
            CPU 和内存还有很大余量。
            

**存算分离：**
            容量规划拆分为两个独立的维度：
            
            
- **存储容量。**
            对于使用对象存储的方案（Snowflake、ClickHouse），存储容量几乎不需要规划——S3
            的容量理论上无限。需要规划的是存储成本：数据量 x 压缩比 x
            单价 x 保留周期。
            
- **计算容量。**
            需要根据查询并发数、查询复杂度和延迟要求来确定。对于
            Snowflake，这意味着选择合适的 Warehouse 大小和数量；对于
            Aurora，意味着选择合适的实例类型和只读副本数量。
            
            

我认为容量规划中最容易被忽略的是**缓存层的大小**。对于
            Snowflake 和 ClickHouse SharedMergeTree，本地 SSD
            缓存的大小直接决定了查询性能的稳定性。如果工作集（Working
            Set）大于缓存容量，查询延迟会因为频繁的 S3
            访问而不稳定。经验法则是：本地缓存至少能容纳最近 7
            天的热数据。
            
            

## 九、总结

            

存算分离不是一种架构，而是一个设计空间。Aurora、TiDB、Snowflake、ClickHouse
            四种方案代表了这个空间中的四个不同位置：
            
            
- **Aurora**
            把存储层做成了一个专门为数据库日志优化的分布式服务，在 OLTP
            场景下延迟最低、兼容性最好，但写入节点是单点、不支持分析查询。它的设计哲学是”在保持
            MySQL/PostgreSQL
            兼容性的前提下，用最小的改动获得最大的性能提升”。
            
- **TiDB** 通过 TiKV（行存）+
            TiFlash（列存）实现
            HTAP，是唯一能在一个系统里同时处理事务和分析的方案，但最小部署规模大、运维复杂度高。它的设计哲学是”一个系统解决所有问题，减少数据管道的复杂性”。
            
- **Snowflake**
            把分离做到极致——计算完全无状态、存储完全用对象存储，弹性和成本控制最优，但不适合
            OLTP、写入模式限于批量操作。它的设计哲学是”把弹性和多租户隔离做到极致，成为数据仓库的公用事业”。
            
- **ClickHouse SharedMergeTree** 在保留
            ClickHouse
            的列式分析性能优势的同时引入对象存储，适合需要高性能 OLAP
            且愿意接受最终一致性的场景。它的设计哲学是”在不牺牲查询性能的前提下获得对象存储的成本优势”。
            
            

选型的核心不是”哪个更好”，而是”你的负载长什么样”。OLTP 选
            Aurora 或 TiDB，OLAP 选 ClickHouse 或 Snowflake，HTAP 选
            TiDB——如果负载模式不清晰，先花时间搞清楚查询模式和延迟要求，比纠结架构选型更有价值。
            

最后提一个趋势判断：存算分离的方向已经不可逆。对象存储的价格持续下降，网络带宽持续上升（AWS
            的 EC2 实例已经支持 100 Gbps 网络），NVMe SSD
            缓存的容量也在增长——这三个趋势叠加，意味着存算分离架构的性能代价会越来越小，而它带来的弹性和成本优势会越来越显著。五年后回头看，存算一体的数据库架构可能会像十年前的单体应用一样，逐渐成为特殊场景下的选择，而不是默认选择。
            
            

## 参考资料

            

### 论文

            
            
- Verbitski, A. et al. “Amazon Aurora: Design
            Considerations for High Throughput Cloud-Native Relational
            Databases.” SIGMOD 2017.
            
- Verbitski, A. et al. “Amazon Aurora: On Avoiding
            Distributed Consensus for I/Os, Commits, and Membership
            Changes.” SIGMOD 2018.
            
- Dageville, B. et al. “The Snowflake Elastic Data
            Warehouse.” SIGMOD 2016.
            
- Huang, D. et al. “TiDB: A Raft-based HTAP Database.”
            VLDB 2020.
            
            

### 官方文档

            
            
- Aurora 文档：https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/
            
- TiDB 文档：[https://docs.pingcap.com/](https://docs.pingcap.com/)
            
- Snowflake 文档：[https://docs.snowflake.com/](https://docs.snowflake.com/)
            
- ClickHouse SharedMergeTree 文档：https://clickhouse.com/docs/en/cloud/reference/shared-merge-tree
            
            

### 设计博客

            
            
- AWS Database Blog: “Amazon Aurora Under the Hood”
            系列
            
- PingCAP Blog: “How TiDB Combines OLTP and OLAP”
            系列
            
- Snowflake Engineering Blog: “Building an Elastic Data
            Warehouse”
            
- ClickHouse Blog: “SharedMergeTree: Cloud-Native
            ClickHouse”
            
            
            

**上一篇：**【存储工程】云对象存储内部架构
            

**下一篇：**【存储工程】新硬件对存储的影响
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-05 · storage
                    

### 【存储工程】存储与计算分离架构

                    

深入分析存算分离架构——Shared-Nothing vs Shared-Disk vs Shared-Storage 的工程权衡，Snowflake/Aurora/TiDB 的存算分离实践，本地缓存策略与网络带宽需求
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】列存基础与 ClickHouse 架构

                    

行存 vs 列存的带宽、压缩与向量化三角；ClickHouse Server 进程模型、线程池与 MergeTree 引擎家族地图；src/Storages 与 src/Processors 源码入口。对照 PG 行存与 LSM 写优化路径，版本锚定 ClickHouse 24.x LTS。
                

                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】MergeTree Part 文件格式

                    

ClickHouse MergeTree Part 目录结构：columns.txt、checksums.txt、.bin、.mrk2、primary.idx 语义，Granule 与 Mark 的定位作用，Wide/Compact 布局与 MergeTreeDataPart 源码入口。版本锚定 24.x LTS。