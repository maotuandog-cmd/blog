# quant67/storage 79 篇学习总览笔记

> 来源: https://quant67.com/categories/storage.html (土法炼钢, 2025-2026 持续更新)
> 全站 storage 分类: 79 篇
> 本笔记聚焦: 24-39 (存储引擎架构, DB 强相关) + 27 (ARIES) + 30 (Bitcask) + 32 (RocksDB) + 66 (缓存工程) + 75 (小文件)
> 本地缓存: /home/obsidian/postgres/learn/quant67-storage-md/ (79 篇 markdown, 4.9 MB)
> 学习日期: 2026-09-04

================================================================
一、quant67/storage 全 79 篇地图
================================================================

A. Linux 存储基础 (1-23, 25 篇) — 本笔记略读, 重点是硬件/IO/文件系统
   01 HDD 机械硬盘
   02 SSD 与 NAND Flash (FTL/写放大/磨损均衡)
   03 NVMe 协议与存储接口演进
   04 持久化内存与存储层次
   05 存储性能建模 (IOPS/吞吐/延迟)
   06 存储介质选型指南
   07 Linux I/O 栈全景 (write() 到磁盘扇区)
   08 块设备层 (bio/request/I/O 调度器)
   09 Page Cache 深度解析
   10 Direct I/O 与 O_DIRECT
   11 Linux 异步 I/O (POSIX AIO 到 io_uring)
   12 数据完整性 (fsync 到端到端校验)
   13 文件系统基础 (inode/目录/VFS)
   14 ext4 架构与调优
   15 XFS 架构 (大文件与高并发)
   16 Btrfs (写时复制)
   17 ZFS (数据完整性优先)
   18 文件系统选型与基准测试
   19 LVM 逻辑卷管理
   20 RAID 原理与实践
   21 Device Mapper (存储虚拟化)
   22 块存储加密 (LUKS/dm-crypt)
   23 存储快照与精简配置

B. DB 存储引擎架构 (24-39, 16 篇) — 本笔记重点
   24 存储引擎概览 (堆文件到 LSM-Tree)
   25 B-Tree/B+Tree 工程实现
   26 Buffer Pool (数据库内存管理)
   27 WAL 与崩溃恢复 (ARIES 协议)
   28 事务隔离级别的存储实现
   29 索引结构 (B+Tree 到倒排索引)
   30 Bitcask 与日志结构哈希表
   31 LSM-Tree 工程调优 (三种放大权衡)
   32 RocksDB 工程实践
   33 LMDB 与内存映射存储
   34 嵌入式存储引擎对比
   35 列式存储原理
   36 Parquet 文件格式
   37 Apache Arrow (零拷贝内存列式)
   38 时序存储引擎
   39 向量存储与 ANN 索引

C. 数据湖 / 编码 / 序列化 (40-44, 5 篇)
   40 数据湖存储格式 (Delta Lake/Iceberg/Hudi)
   41 存储编码 (变长整数到字典编码)
   42 压缩算法工程实践
   43 校验和与数据完整性
   44 序列化格式对比

D. 对象存储 / 分布式 (45-56, 12 篇)
   45 存储加密工程
   46 对象存储模型 (从文件到对象)
   47 S3 API 深度解析
   48 MinIO 原理和架构
   49 纠删码原理
   50 对象存储网关
   51 对象存储性能工程
   52 数据分片策略
   53 副本与复制策略
   54 元数据管理
   55 数据均衡与在线迁移
   56 多租户存储隔离

E. 存算分离 / 故障 / 备份 (57-63, 7 篇)
   57 存算分离架构
   58 数据持久性工程
   59 存储故障模式
   60 备份策略工程
   61 灾难恢复设计
   62 数据生命周期管理
   63 存储混沌工程

F. 性能 / 调优 / 工具 / 展望 (64-79, 16 篇)
   64 存储基准测试方法论
   65 I/O 性能分析工具链
   66 缓存工程 (Page Cache 到应用层缓存)
   67 写入性能优化
   68 读取性能优化
   69 存储全链路延迟分析
   70 云块存储架构
   71 云对象存储内部架构
   72 存算分离实践
   73 新硬件对存储的影响
   74 存储技术展望
   75 小文件问题
   76 磁盘空间耗尽
   77 POSIX 文件锁
   78 存储事故复盘
   79 O_DIRECT 与 io_uring (固定缓冲区/register_buffers)

================================================================
二、核心概念: 存储引擎角色 (基于 24 章)
================================================================

2.1 数据库分层
  ┌──────────────────────────────────────────┐
  │       客户端连接层 (协议解析/连接管理)        │
  ├──────────────────────────────────────────┤
  │       查询处理层 (SQL 解析/优化/执行计划)     │
  ├──────────────────────────────────────────┤
  │       事务管理层 (并发控制/锁/MVCC)         │
  ├──────────────────────────────────────────┤
  │       存储引擎层 ← 本章聚焦                │
  │  (数据组织/索引/缓冲池/WAL)                  │
  ├──────────────────────────────────────────┤
  │       操作系统/文件系统                      │
  ├──────────────────────────────────────────┤
  │       存储介质 (HDD/SSD)                    │
  └──────────────────────────────────────────┘

2.2 存储引擎核心 API (KV 抽象)
  type StorageEngine interface {
      Get(key) (value, err)
      Put(key, value) error
      Delete(key) error
      Scan(startKey, endKey) (Iterator, err)
      WriteBatch(batch) error
  }

2.3 4 大需求
  - 持久性 (Durability)
  - 高效读取 (点查/范围)
  - 高效写入 (单条/批量)
  - 空间效率

→ 没有一种数据结构能在 4 维度同时最优
→ RUM 猜想: 读/更新/内存 三者必有一失

2.4 写路径 vs 读路径
写路径: 写 WAL (顺序) → 更新内存结构 (MemTable/Buffer Pool) → 后台刷盘
读路径: 查内存 (MemTable/Buffer Pool) → 查磁盘索引 (B+Tree/SSTable) → 加载数据页

================================================================
三、4 种核心数据结构 (基于 24 章)
================================================================

3.1 堆文件 (Heap File)
  - 原始结构: 按插入顺序追加
  - 插入: O(1) (有 FSM 时)
  - 查找: O(N) 全表扫描
  - 应用: PG/InnoDB(非聚簇) 的基础存储层
  - FSM (Free Space Map) 跟踪每个页可用空间

3.2 哈希索引
  - 内存 HashTable: key → (file_id, offset)
  - 查找: O(1)
  - 不支持范围
  - Bitcask (Riak 早期): 哈希 + 追加日志
    写入: 追加到 active data file + 更新 hash table
    读取: hash table 找 (file, offset) → 读磁盘
    删除: 追加 tombstone + 从 hash table 删除
    合并 (merge): 文件达阈值后关闭, 合并去重

3.3 B-Tree / B+Tree
  - 经典页式索引
  - 查找: O(log N)
  - 范围: 天然有序, 高效
  - PG/InnoDB 主索引
  - 详细见 25 章

3.4 LSM-Tree (Log-Structured Merge Tree)
  - 核心: 随机写 → 顺序写
  - 写: 写 MemTable → flush L0 → compact L1 → ... → Ln
  - 读: 查 MemTable → L0 (key 范围可能重叠, 逐个查) → L1+ (二分定位)
  - 优势: 写吞吐极高 (HDD 上也能压榨)
  - 劣势: 读放大 + 空间放大
  - 代表: RocksDB, LevelDB, Cassandra, HBase

================================================================
四、3 种放大 (LSM-Tree 核心权衡, 基于 31 章)
================================================================

4.1 写放大 (Write Amplification)
  WA = 磁盘写入总字节数 / 用户写入字节数
  - 1 字节用户数据 → WAL(1) + MemTable flush(1) + 多次 Compaction(N)
  - 影响: 磁盘带宽, SSD 寿命, 写吞吐

4.2 读放大 (Read Amplification)
  RA = 点查磁盘 I/O 次数
  - 理论最优 1, LSM 最坏需要查多层
  - MemTable → Immutable → L0 (逐个) → L1+ (二分)
  - Bloom Filter 显著降低 RA (假阳性)

4.3 空间放大 (Space Amplification)
  SA = 磁盘占用 / 用户数据
  - 旧版本/墓碑未清理前占空间
  - Compaction 完成后释放

4.4 RUM 猜想
  三个 R (Read/Update/Memory) 不可能同时最优
  - B+Tree: 读最优, 写/空间差
  - LSM-Tree: 写最优, 读/空间差
  - 选型 = 选放大组合

4.5 3 种 Compaction 策略
| 策略    | 写放大 | 读放大 | 空间放大 | 适用          |
| ------- | ------ | ------ | -------- | ------------- |
| Leveled | 高     | 低     | 低       | 读多写少 (RocksDB default) |
| Tiered  | 低     | 高     | 高       | 写多读少 (Cassandra) |
| FIFO    | 最低   | 中     | 高       | 时序数据 (TTL) |

================================================================
五、Buffer Pool (基于 26 章)
================================================================

5.1 为什么不用 OS Page Cache
  - Double Buffering: 数据在 Page Cache 和 Buffer Pool 各存一份, 浪费内存
  - 淘汰控制: OS 不知道哪些页是热数据
  - 预读控制: DB 知道查询计划, 能主动预读
  - Pin/Unpin: 修改页必须保证不被淘汰 (mlock 粒度太粗)

5.2 架构
  应用层:    Buffer Pool    [Page A] [Page B] [Page C]
  内核层:    Page Cache      ← O_DIRECT 绕过
  存储层:    磁盘

5.3 关键设计
  - 页面替换: Clock Sweep / LRU-K (InnoDB), LRU (PG)
  - 脏页管理: 跟踪 dirty page, checkpoint 刷盘
  - 预读: 线性预读 (Seq Scan), 索引预读 (Index Scan)
  - Pin/Unpin: 保护正在修改的 page

5.4 调优
  - shared_buffers (PG): 总内存 1/4
  - innodb_buffer_pool_size (MySQL): 总内存 50-70%
  - dirty_page_ratio: 控制脏页比例触发刷盘
  - effective_cache_size (PG): OS 可用缓存 (用于 planner 估算)

5.5 PG Buffer Manager 跟 InnoDB 差异
| 维度        | PG                              | InnoDB                         |
| ----------- | ------------------------------- | ------------------------------- |
| 算法        | LRU (简单)                      | LRU-K + midpoint insertion     |
| Buffer pool | shared_buffers 共享             | 独立 buffer pool per instance   |
| 淘汰粒度    | page (8KB)                      | page (16KB)                     |
| Pin 机制    | BufferDesc.pin_count            | buf_block->lock                 |
| 预读        | 简单 (io_combine_limit)         | 复杂 (linear/random readahead)  |

================================================================
六、WAL 与 ARIES (基于 27 章)
================================================================

6.1 WAL 三条规则
  1. 日志必须先于对应数据页写盘 (顺序保证)
  2. 日志必须先于脏页刷盘
  3. 事务提交前, 事务所有日志必须已刷盘

6.2 崩溃恢复的 2 个不变量
  - 已提交事务: 修改必须持久化 (即使未刷盘)
  - 未提交事务: 修改必须被撤销 (即使已部分刷盘)

6.3 部分写入 (Torn Page) 问题
  - 8KB page = 4 × 2KB 扇区 (传统) 或 2 × 4KB 扇区 (高级格式)
  - 断电可能只写前一半 → 撕裂页
  - 解法:
    - PG: full_page_writes (checkpoint 后第一次改写整页到 WAL)
    - InnoDB: Doublewrite Buffer (先写共享 doublewrite 区域, 再写实际位置)

6.4 ARIES 三阶段
  ARIES = Algorithm for Recovery and Isolation Exploiting Semantics (1992 IBM)
  1. Analysis 阶段: 从最后 checkpoint 开始扫描 WAL, 重建脏页表 + 活跃事务表
  2. Redo 阶段: 从 redo LSN 开始, 重复所有已提交事务的修改
  3. Undo 阶段: 回滚未提交事务 (反向应用补偿日志)

6.5 LSN (Log Sequence Number) 概念
  - 单调递增, 标识每条 WAL 记录位置
  - 每条日志有 prevLSN (链式), 形成事务的修改链
  - Redo 时从最小 RecLSN (需要重做的最早 LSN) 开始

6.6 Checkpoint
  - 周期性记录"当前所有脏页的最小 LSN"
  - 崩溃恢复时从 checkpoint 开始, 减少扫描量
  - PG: 详见 taobao §四 + digblog-xid

================================================================
七、B+Tree 工程实现 (基于 25 章)
================================================================

7.1 B+Tree vs B-Tree
  - B-Tree: 数据存在所有节点
  - B+Tree: 数据只在叶子节点, 内部节点只存 key + 指针
  - B+Tree 优势: 范围扫描高效 (叶子链表), 内部节点小 (单 page 多 key)

7.2 关键操作
  - 查找: 从 root 二分, 定位到 leaf, 读数据
  - 插入: 找到 leaf, 插入; 满了就 split
  - 删除: 找到 leaf, 删除; 邻居半空就 merge/borrow
  - split: 非 50/50 (PG 优化), 但能保证不会立刻再 split
  - deduplicate: PG 14+ 优化, 相同 key 合并存储

7.3 PG B+Tree 特性
  - rightlink: 叶子节点双向链表
  - high-key: 节点最大 key, 用于并发控制
  - link-page: blink-tree 用于 SMO (见 polardb 笔记 §六)

7.4 MySQL InnoDB B+Tree 特性
  - 聚簇索引: 数据即叶子节点内容
  - 二级索引: 叶子存主键 (而不是物理地址)
  - 自适应哈希: 热点 page 自动建 hash

7.5 PostgreSQL Blink-Tree
  - 见 polardb 笔记 §六
  - PG 14+ 引入 link page + high-key
  - 优势: SMO 期间 search 可继续
  - PolarDB: 加 lock-coupling 进一步避免 search 失败

================================================================
八、索引结构 (基于 29 章)
================================================================

8.1 7 种索引结构
| 索引类型      | 适用场景                     | 代表实现              |
| ------------- | ---------------------------- | --------------------- |
| B+Tree        | 通用, 等值/范围/排序         | PG nbtree, InnoDB     |
| Hash          | 等值查询, 长字符串           | PG hash               |
| 倒排 (GIN)    | 数组/全文/JSONB              | PG gin                |
| GiST          | 几何/范围/IP/PostGIS         | PG gist               |
| BRIN          | 时序/物理相关                | PG brin               |
| Bitmap        | 低基数列多条件过滤           | 传统 DW               |
| Bloom Filter  | 快速判断"不存在"             | LSM 引擎辅助          |
| R-Tree        | 空间查询 (已并入 GiST)       | (历史)                |

8.2 主索引 vs 辅助索引
  - 主索引 (聚簇): 数据行按索引键物理存储 (InnoDB)
  - 辅助索引 (二级): 叶子存主键值, 回表查找

8.3 索引代价
  - 空间: 索引 = 数据的 10-30%
  - 写入: 多 1 索引 = 写时多 1 次维护 (B+Tree split/merge)
  - 优化器: 索引多 → plan 复杂
  - 一般 3-5 个索引是合理上限

================================================================
九、Bitcask 与 LSM-Tree 起源 (基于 30 章)
================================================================

9.1 日志结构存储核心思想
  所有写入都以追加方式写文件末尾, 永不回头修改
  - 顺序写 → 磁盘顺序写带宽 100+ MB/s (HDD)
  - 原子性 → 追加写天然原子 (要么成功要么不)
  - 并发控制简化 → 旧数据不变, 无锁读

9.2 不可变日志
  - 每次写追加新记录 (含 key/value/ts)
  - 更新 = 同 key 写新版本
  - 删除 = 写 tombstone
  - 同 key 多次出现, 最后一条有效

9.3 合并 (Compaction)
  - 旧文件定期合并去重
  - 释放 tombstone + 旧版本空间
  - 生成新文件, 删除旧文件

9.4 Bitcask 的局限
  - 单机哈希表必须装下所有 key
  - 不适合 key 数量极大 (如 100 亿)
  - → 演化出 LSM-Tree (用磁盘上的有序结构替代内存哈希表)

9.5 LSM-Tree 演化
  Bitcask → LevelDB (Google 2011) → RocksDB (Facebook 2012)
  - 写: MemTable (跳表/哈希) → flush L0 (SSTable) → 增量合并
  - 读: 查 MemTable + L0 + L1+ (用 Bloom Filter 加速)

================================================================
十、RocksDB 工程实践 (基于 32 章)
================================================================

10.1 关键参数
| 参数                       | 默认值  | 作用                |
| -------------------------- | ------- | ------------------- |
| write_buffer_size          | 64MB    | MemTable 大小       |
| max_write_buffer_number    | 2       | MemTable 数量       |
| min_write_buffer_number_to_merge | 1 | flush 触发合并阈值 |
| level0_file_num_trigger    | 4       | L0 文件数触发 compaction |
| max_bytes_for_level_base   | 256MB   | L1 目标大小         |
| max_bytes_for_level_multiplier | 10  | 每层大小倍数         |
| target_file_size_base      | 64MB    | L1 SSTable 目标大小  |
| bloom_bits_per_key         | 10      | Bloom Filter 精度    |
| block_size                 | 4KB     | SSTable block 大小  |

10.2 Compaction 调优
  - 写多读少: Tiered + 减小 level 数
  - 读多写少: Leveled + 加大 Bloom bits
  - 延迟敏感: 减少 background compaction 并发
  - 吞吐敏感: 加大 compaction 并发

10.3 RocksDB 跟 PG/国产 DB 关系
  - TiKV (TiDB 存储层): 基于 RocksDB
  - MyRocks (MySQL 引擎): MySQL on RocksDB
  - Ceph BlueStore: 也用 RocksDB
  - CockroachDB: 基于 RocksDB (后改 Pebble)
  - PolarDB 跟 RocksDB 无直接关系 (走 PolarStore)

================================================================
十一、列式存储与 Parquet (基于 35/36 章)
================================================================

11.1 行式 vs 列式 IO
  行式: 一行所有列存一个 page → 分析查询 90% 数据丢弃
  列式: 同一列所有值连续存 → 只读 3 列只需 3 列的 IO
  加速 10-100x (取决于选择率)

11.2 列式的 3 大优势
  1. 减少 IO: 只读涉及列
  2. 高压缩: 同列数据类型一致, 压缩率高 (10-100x)
  3. 向量化执行: CPU 一次处理一批列值, SIMD 友好

11.3 Parquet 文件结构
  - Row Group (水平分片) × Column Chunk (列分片) × Page (列内分页)
  - Row Group: 包含每列的 Column Chunk + 统计信息
  - Page: 最小 IO 单元, 含 min/max/null_count
  - Footer: Schema + 各 Row Group/Column Chunk 位置

11.4 关键特性
  - 列裁剪 (Column Pruning): 读时只 IO 涉及列
  - 谓词下推 (Predicate Pushdown): 读 Page 时按 min/max 过滤
  - 投影下推 (Projection Pushdown): 不读不需要的列
  - 嵌套支持: Dremel 编码 (Definition Level + Repetition Level)
  - 压缩: RLE/Dictionary/Snappy/Zstd

11.5 跟 PG 国产 DB 关系
  - openGauss cstore: 列存引擎 (类似 Parquet 思路)
  - Greenplum/AOCO: 列存优化
  - TiFlash: TiDB 的列存层 (基于 DeltaTree)
  - ClickHouse: 自主列存, 跟 Parquet 思路相近

================================================================
十二、缓存工程 (基于 66 章)
================================================================

12.1 存储层次速度鸿沟
| 层次              | 延迟    | vs DRAM     |
| ----------------- | ------- | ----------- |
| L1 Cache          | 1 ns    | 0.01x       |
| L2 Cache          | 4 ns    | 0.05x       |
| L3 Cache          | 12 ns   | 0.15x       |
| DRAM              | 80 ns   | 1x          |
| Optane PMem       | 300 ns  | 4x          |
| NVMe SSD 随机 4K  | ~100 us | 1,250x      |
| SATA SSD 随机 4K  | ~200 us | 2,500x      |
| HDD 随机 4K       | ~8 ms   | 100,000x    |

12.2 多级缓存架构
  Client/CDN 缓存
  → 应用层本地缓存 (Caffeine/Guava)
  → 分布式缓存 (Redis/Memcached)
  → DB Buffer Pool (InnoDB/PG)
  → OS Page Cache
  → 块设备/磁盘

12.3 缓存算法对比
| 算法        | 优点           | 缺点             | 适用           |
| ----------- | -------------- | ---------------- | -------------- |
| LRU         | 简单           | 顺序扫描污染     | 通用           |
| LRU-K       | 防顺序污染     | 实现复杂         | 通用 (InnoDB)  |
| Clock       | 近似 LRU, 快   | 精度略低         | 通用 (PG)      |
| 2Q          | 抗扫描         | 内存多           | 大容量         |
| ARC         | 自适应         | 参数调优难       | 大容量         |
| W-TinyLFU   | 高命中率       | 实现复杂         | Caffeine 默认  |

12.4 3 大缓存问题
  - 缓存穿透: 查询不存在的数据 → 每次都打到 DB
    解: 布隆过滤器 / 缓存空值
  - 缓存击穿: 热点 key 过期瞬间 → 大量请求打到 DB
    解: 互斥锁 / 永不过期
  - 缓存雪崩: 大量 key 同时过期 → DB 压力剧增
    解: 过期时间加随机值 / 多级缓存

12.5 PG Buffer Manager 调优
  - shared_buffers = 总内存 1/4
  - effective_cache_size = 总内存 1/2 (planner 用)
  - work_mem: 单查询 hash/sort 用 (默认 4MB, 大查询需加大)
  - huge_pages: 减少 TLB miss

12.6 MySQL InnoDB Buffer Pool 调优
  - innodb_buffer_pool_size = 总内存 50-70%
  - innodb_buffer_pool_instances: 大内存分多个 pool 减少锁竞争
  - innodb_old_blocks_pct: LRU old 区比例 (默认 37, 防顺序扫描污染)

================================================================
十三、小文件问题 (基于 75 章, 实践性)
================================================================

13.1 "小" 的阈值
| 介质         | 阈值      | 原因                              |
| ------------ | --------- | --------------------------------- |
| HDD          | < 256 KB  | 寻道 8ms > 读 256KB 时间          |
| SATA SSD     | < 64 KB   | NAND 页读 100us 开销占比显著      |
| NVMe SSD     | < 16 KB   | syscall + FS 遍历开销 > 30%       |
| S3 / 对象    | < 1 MB    | HTTP 往返 10-50ms 是主要开销      |
| HDFS / GFS   | < 128 MB  | 默认块 64-128MB, 小于此导致碎片   |

13.2 小文件的 4 层放大
  1. 块分配浪费: 1KB 文件占 4KB 块 (slack space)
  2. 元数据膨胀: inode/dentry 占 256B-1KB
  3. 寻道 / IOPS 消耗: HDD 寻道主导
  4. 网络协议开销: S3/HTTP 每文件独立请求

13.3 工程方案
  - 应用层聚合: 小文件打包成大文件 (如合并 1000 个 1KB 成 1 个 1MB)
  - 对象存储归档: 天然适合海量小文件
  - 文件系统选型: ext4 大量小文件 metadata 性能差, ZFS/Btrfs 更优
  - RocksDB SSTable 思想: 把大量小写入合并成大文件

================================================================
十四、跨笔记交叉引用
================================================================

14.1 跟 quant67-pg-kernel-notes.md 对应
| 主题            | quant67 章节       | storage 笔记         |
| --------------- | ------------------ | -------------------- |
| MVCC / WAL      | ch03, ch04         | §六 ARIES            |
| 缓冲池 / Buffer | ch05               | §五 Buffer Pool      |
| 锁              | ch06               | (无, PG 锁独立)       |
| VACUUM / Freeze | ch08               | §五 Buffer Pool 调优 |
| B-Tree          | ch14               | §七 B+Tree 实现      |
| GiST / GIN      | ch15-16            | §八 7 种索引          |
| BRIN            | ch17               | §八 7 种索引          |
| 事务隔离        | ch07               | 28 章节 (未深读)     |
| 监控            | ch21               | §十二 缓存调优        |

14.2 跟 taobao-monthly-pg-notes.md 对应
| 主题                | taobao 章节         | storage 笔记       |
| ------------------- | ------------------- | ------------------ |
| CLOG / SLRU         | §三                 | §六 ARIES          |
| Autovacuum          | §五                 | §五 Buffer Pool    |
| 9 种索引            | §十                 | §八 索引结构        |
| 并行查询            | §十一               | (无, PG 独立)       |
| MemoryContext       | §十二               | §十二 缓存工程      |
| HOT                 | §六                 | §三 堆文件         |

14.3 跟 digblog-pg-fork-databases-source-analysis.md 对应
| 国产 DB         | 关键创新              | storage 笔记        |
| --------------- | --------------------- | ------------------- |
| openGauss MOT   | 内存表 + LLVM JIT     | §四 4 种数据结构    |
| oGRAC 多主      | DRC 远程 page 缓存    | §五 Buffer Pool (分布式) |
| OpenTeleDB XStore | 原位更新 + Undo     | §三 堆文件 (XStore 改造) |
| OpenTenBase GTM | 全局事务号 + 快照      | §六 ARIES (分布式) |

14.4 跟 polardb-postgresql-notes.md 对应
| 主题              | polardb 章节         | storage 笔记        |
| ----------------- | -------------------- | ------------------- |
| PolarStore 共享存储 | §二                 | §五 Buffer Pool (多 reader) |
| Parallel Index Scan | §四                | §七 B+Tree + link-page |
| blink-tree 增强   | §六                 | §七.5 PG Blink-Tree |
| CBQT 框架         | §五                 | (无, 优化器独立)    |

================================================================
十五、核心结论
================================================================

15.1 存储引擎选型 = 选放大组合
  - 读多写少 → B+Tree (PG/InnoDB)
  - 写多读少 → LSM-Tree (RocksDB/TiKV)
  - 范围扫描 / OLAP → 列存 (Parquet/ClickHouse)
  - 海量时序 → BRIN (PG) 或 LSM + FIFO compaction
  - 海量向量 → HNSW/IVFFlat (PG pgvector)

15.2 RUM 猜想是设计铁律
  读/更新/内存 必有一失
  → 调优 = 选失在哪个维度

15.3 Buffer Pool 是性能关键
  - shared_buffers (PG) / innodb_buffer_pool_size (MySQL) = 总内存 1/4 ~ 1/2
  - O_DIRECT 避免双重缓存
  - 预读策略需跟查询计划联动
  - Pin/Unpin 保证修改页不被淘汰

15.4 ARIES 是工业级 WAL 协议基础
  - Analysis → Redo → Undo 三阶段
  - 几乎所有关系型数据库 (PG/MySQL/Oracle/SQL Server) 都遵循
  - 部分写入 (Torn Page) 需要 Doublewrite 或 full_page_writes 解决

15.5 LSM-Tree vs B+Tree 范式之争
  - LSM: 写优化, 读放大 + 空间放大, 适合 SSD (无寻道)
  - B+Tree: 读优化, 写放大 (split/merge), 传统 OLTP 标准
  - 趋势: LSM 在云原生场景胜出 (TiKV/CockroachDB/MyRocks)

15.6 列式存储的 3 大优势
  - IO 减少 (只读涉及列)
  - 压缩率高 (10-100x, 同列值相似)
  - 向量化执行 (CPU SIMD 友好)
  → 分析查询 10-100x 加速

15.7 多级缓存的工程问题
  - 双重缓存浪费 (Buffer Pool + Page Cache)
  - 顺序扫描污染 (LRU 失效率)
  - 缓存穿透/击穿/雪崩 (高并发杀手)
  → 用 O_DIRECT + W-TinyLFU + 布隆过滤器 综合解决

================================================================
十六、未深入但有价值的章节
================================================================

A 区 (Linux 存储基础, 1-23):
- 02 SSD/NAND FTL (对所有数据库都重要, 写放大根因)
- 09 Page Cache (跟 Buffer Pool 关系)
- 10 Direct I/O (数据库为什么 O_DIRECT)
- 13 文件系统基础 (inode/VFS)
- 20 RAID 原理

B 区 (DB 存储引擎, 24-39):
- 25 B-Tree 工程实现 (跟 quant67 ch14 互为补充)
- 28 事务隔离级别的存储实现 (PG 隔离级别对应实现)
- 33 LMDB 与内存映射 (PG heap_mmap_append 借鉴)
- 34 嵌入式存储引擎对比 (RocksDB vs LevelDB vs LMDB)
- 37 Apache Arrow (零拷贝, 跟 PG 列存生态相关)
- 38 时序存储引擎 (TimescaleDB / InfluxDB 底层)
- 39 向量存储与 ANN 索引 (跟 pgvector 强相关)

C 区 (数据湖, 40-44):
- 40 数据湖存储格式 (Delta Lake / Iceberg / Hudi)
- 42 压缩算法 (Snappy/Zstd/LZ4 对比)

D 区 (对象存储, 45-56):
- 48 MinIO 原理 (替代品: Ceph RGW, 阿里 OSS)
- 49 纠删码 (Reed-Solomon 算法, Ceph/EC 用)

E 区 (存算分离, 57-63):
- 57 存算分离架构 (Snowflake / BigQuery / PolarDB 模式)

F 区 (性能调优, 64-79):
- 66 缓存工程 (跟 §十二重叠, 更细)
- 67 写优化 (WAL group commit, AOF)
- 68 读优化 (prefetch, async IO)
- 69 全链路延迟分析 (Dapper, Jaeger)
- 73 新硬件 (Optane PMem, CXL, ZNS SSD)
- 75 小文件 (跟 §十三 互为补充)
- 76 磁盘满 (inodes 耗尽, ENOSPC)
- 77 POSIX 文件锁 (NFS 锁问题)
- 78 事故复盘 (生产案例)

================================================================
十七、本地缓存与未来
================================================================

路径: /home/obsidian/postgres/learn/quant67-storage-md/
文件: 79 篇 markdown, 4.9 MB
命名: NN-topic-slug__topic-slug.md

每篇结构:
  # 【存储工程】标题
  来源: URL
  日期: 2025-XX-XX
  ---
  章节内容 (含大量代码示例和图表)

可按 ls 检索, 或 grep 跨文件搜索具体概念。

未来深入方向 (建议):
1. 选 5-8 篇精读: 25 B+Tree, 28 事务隔离, 38 时序, 39 向量, 40 数据湖, 48 MinIO
2. 重点研究 73 新硬件 (Optane PMem + CXL 内存池化对 DB 影响)
3. 跨笔记串联: 跟 openGauss MOT 笔记做"列存+内存表"对比
4. 实操: 编译 RocksDB, 跑 sysbench 对比 B+Tree vs LSM
5. 等 quant67 更新: 2026 持续, 可能加 Vector/SQL on Lakehouse 章节

================================================================
十八、引用源
================================================================

quant67 storage 分类: https://quant67.com/categories/storage.html
全 79 篇索引页: /home/obsidian/postgres/learn/quant67-storage-md/_index.json
本地缓存: /home/obsidian/postgres/learn/quant67-storage-md/ (79 篇 markdown, 4.9 MB)
HTML 原始: /home/obsidian/postgres/learn/quant67-storage/ (79 HTML, 11.5 MB)

关联笔记:
- /home/obsidian/postgres/learn/quant67-pg-kernel-notes.md
- /home/obsidian/postgres/learn/taobao-monthly-pg-notes.md
- /home/obsidian/postgres/learn/20260904-pg-32bit-xid-and-64bit-fix.md
- /home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
- /home/obsidian/postgres/learn/20260904-polardb-postgresql-notes.md
- /home/obsidian/postgres/learn/README-pG内核学习总图.md
