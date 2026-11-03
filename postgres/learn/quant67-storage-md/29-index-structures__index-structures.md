# 【存储工程】索引结构：从 B+Tree 到倒排索引

来源: https://quant67.com/post/storage/29-index-structures/index-structures.html
日期: 2025-09-07 |

---

数据库里存了一亿行数据，要找出 `user_id = 42`
            的那一行。没有索引的做法是全表扫描（Full Table
            Scan）——从第一个数据页读到最后一个数据页，逐行比对。假设每个数据页
            16 KB，一亿行占 20 GB，即使顺序读能跑到 500 MB/s，也需要 40
            秒。加一个 B+Tree 索引，三次磁盘 I/O 就能定位到目标行——从 40
            秒到 3 毫秒，四个数量级的差距。
            

索引是存储引擎里最核心的数据结构。它决定了查询能不能用上快速路径，决定了写入时需要付出多少额外代价，决定了存储空间的膨胀程度。不同的索引结构解决不同类型的查询问题：B+Tree
            擅长范围扫描，Hash
            索引擅长点查，倒排索引擅长全文检索，Bitmap
            索引擅长低基数列的多条件过滤，R-Tree 擅长空间查询，Bloom
            Filter 擅长快速判断”不存在”。
            

本文从索引的本质出发，逐一拆解七种核心索引结构的设计原理、适用场景与工程实现，最后落到
            MySQL 索引实战。所有 SQL 示例基于 MySQL 8.0（InnoDB
            存储引擎），部分内容涉及 PostgreSQL、Elasticsearch 和
            ClickHouse。
            
            

## 一、索引的本质

            

### 1.1
            以空间和写入换读取速度

            

索引的核心思想可以用一句话概括：**用额外的存储空间和写入开销，换取读取速度的提升**。这是一个经典的工程权衡（Trade-off）。
            

没有索引时，存储引擎只能做全表扫描。数据按插入顺序（或按主键顺序）存放在数据页中，查询时必须遍历所有数据页。时间复杂度是
            O(N)，其中 N 是数据行数。
            

加上索引后，存储引擎在原始数据之外维护一份额外的数据结构。这份数据结构按照某种规则对数据进行排序或分类，使得查询时可以快速定位到目标数据，而不需要遍历所有数据。代价有两个：
            
            
- **空间代价**：索引本身占用磁盘空间。一个包含索引键和指针的
            B+Tree 索引，通常占原始数据的 10%–30%。
            
- **写入代价**：每次插入（INSERT）、更新（UPDATE）、删除（DELETE）操作，除了修改原始数据，还需要同步维护索引结构。对于
            B+Tree，这意味着可能触发节点分裂（Split）或合并（Merge）。
            
            

用公式表达这个权衡：
            
```
读取性能提升 = f(索引结构效率, 数据分布, 查询模式)
写入性能下降 = g(索引数量, 索引结构维护成本)
空间膨胀     = h(索引键大小, 索引结构开销)
```

            

在实际系统中，一张表上通常有 3–5
            个索引。每多一个索引，写入时就多一份维护开销。索引不是越多越好——过多的索引会让写入变慢，占用更多内存，还会让优化器（Optimizer）的选择变得更复杂。
            

### 1.2 有序索引与无序索引

            

按照索引键的组织方式，索引可以分为两大类：
            

**有序索引（Ordered
            Index）**：索引键按照某种顺序排列。典型代表是 B+Tree
            索引。有序索引支持等值查询（Point Query）、范围查询（Range
            Query）和排序操作（ORDER
            BY）。因为键是有序的，所以可以高效地执行
            `WHERE age BETWEEN 20 AND 30`
            这样的范围查询。
            

**无序索引（Unordered
            Index）**：索引键没有按照值的大小排列，而是通过某种映射函数（通常是哈希函数）定位数据。典型代表是
            Hash
            索引。无序索引只支持等值查询，不支持范围查询和排序。但对于等值查询，它可以做到
            O(1) 的时间复杂度，比 B+Tree 的 O(log N) 更快。
            

两者的对比：
            
```
┌──────────────┬──────────────────┬──────────────────┐
│ 特性         │ 有序索引（B+Tree）│ 无序索引（Hash） │
├──────────────┼──────────────────┼──────────────────┤
│ 等值查询     │ O(log N)         │ O(1)             │
│ 范围查询     │ ✓（高效）        │ ✗（不支持）      │
│ 排序         │ ✓（天然有序）    │ ✗（无序）        │
│ 前缀匹配     │ ✓（最左前缀）    │ ✗                │
│ 空间占用     │ 较大             │ 较小             │
│ 写入开销     │ 节点分裂/合并    │ 哈希桶扩展       │
└──────────────┴──────────────────┴──────────────────┘
```

            

### 1.3 主索引与辅助索引

            

按照索引与数据行的关系，索引可以分为：
            

**主索引（Primary
            Index）**：也叫聚簇索引（Clustered
            Index）。数据行按照主索引的键顺序物理存储。在 InnoDB
            中，主键索引就是聚簇索引，B+Tree
            的叶子节点直接存储完整的数据行。一张表只能有一个聚簇索引，因为数据只能按一种顺序物理排列。
            

**辅助索引（Secondary
            Index）**：也叫非聚簇索引（Non-Clustered
            Index）或二级索引。辅助索引的叶子节点存储的不是完整的数据行，而是主键值（在
            InnoDB 中）或行指针（Row
            Pointer，在其他存储引擎中）。通过辅助索引查找数据时，需要先在辅助索引中找到主键值，再回到主索引中查找完整的数据行——这个过程叫做回表（Bookmark
            Lookup / Table Access by Index ROWID）。
            
```
辅助索引查找流程：
                    辅助索引 B+Tree
                  ┌───────────────────┐
  WHERE name='张三' │  查找 name='张三'   │
                  │  → 得到 PK=42      │
                  └───────┬───────────┘
                          │ 回表
                          ▼
                    主键索引 B+Tree
                  ┌───────────────────┐
                  │  查找 PK=42        │
                  │  → 得到完整数据行  │
                  └───────────────────┘
```

            

回表是有代价的。如果一次查询需要通过辅助索引找到 1000
            个主键值，然后逐一回表查找完整数据行，那就意味着额外的 1000
            次随机 I/O。这也是为什么覆盖索引（Covering
            Index）那么重要——如果辅助索引中已经包含了查询需要的所有列，就不需要回表，直接从辅助索引返回结果即可。
            

### 1.4 索引的代价模型

            

在理解具体索引结构之前，先建立一个简单的代价模型。假设数据存储在磁盘上，每次磁盘
            I/O 读取一个数据页（Page），页大小为 B 字节。
            

对于一张包含 N 行数据、每行 R 字节的表：
            
```
数据页数      = ⌈N × R / B⌉
全表扫描代价  = 数据页数 × 每次 I/O 时间

B+Tree 索引查找代价：
  树高度 h    ≈ ⌈log_f(N)⌉  （f 为扇出系数，通常 100–1000）
  点查代价    = h × 每次 I/O 时间  （通常 2–4 次 I/O）
  范围查代价  = h × 每次 I/O 时间 + 扫描叶子页数 × 每次 I/O 时间
```

            

以 InnoDB 为例，页大小 16 KB，主键为 8 字节
            BIGINT，每个指针 6
            字节。每个内部节点能容纳的键数（扇出系数）约为：
            
```
f = 16384 / (8 + 6) ≈ 1170
```

            

三层 B+Tree 能索引的行数：1170³ ≈ 16
            亿行。这意味着对于绝大多数业务表，B+Tree 的高度不超过 3–4
            层，每次点查只需要 3–4 次 I/O。
            
            

## 二、B+Tree 索引

            

### 2.1 B+Tree 的结构

            

B+Tree 是 B-Tree（Balanced
            Tree，平衡树）的变体，是关系数据库中最广泛使用的索引结构。几乎所有主流关系数据库——MySQL（InnoDB）、PostgreSQL、Oracle、SQL
            Server——都使用 B+Tree 作为默认索引结构。
            

B+Tree 与 B-Tree 的关键区别在于：
            
            
- **数据只存在叶子节点**：B-Tree
            的内部节点和叶子节点都存储数据，B+Tree
            的内部节点只存储键和子节点指针，数据全部存储在叶子节点。这使得内部节点可以容纳更多的键，降低树的高度。
            
- **叶子节点形成有序链表**：B+Tree
            的叶子节点通过双向指针串联成一个有序双向链表。范围查询时，只需要找到起始叶子节点，然后沿着链表顺序扫描，不需要回溯到父节点。
            
            
```
B+Tree 结构示意图：

         [内部节点]  ← 只存键和指针
        /     |     \
   [内部]   [内部]   [内部]  ← 只存键和指针
   / | \   / | \   / | \
  [叶] [叶] [叶] [叶] [叶] [叶]  ← 存键和数据
   ↔    ↔    ↔    ↔    ↔         ← 叶子节点双向链表
```

            

### 2.2 B+Tree 的操作

            

**查找（Search）**：从根节点开始，在每个内部节点中通过二分查找确定应该访问的子节点，逐层向下，直到到达叶子节点。在叶子节点中再次二分查找，找到目标键。时间复杂度
            O(log_f N)，其中 f 是扇出系数。
            

**插入（Insert）**：先查找到应该插入的叶子节点。如果叶子节点还有空间，直接插入。如果叶子节点已满，触发节点分裂——把叶子节点一分为二，中间键提升到父节点。如果父节点也满了，继续向上分裂，最坏情况下一直分裂到根节点，树高度增加一层。
            

**删除（Delete）**：先查找到目标叶子节点并删除。如果叶子节点的键数低于最小填充因子（通常是半满），尝试从相邻兄弟节点借一个键。如果兄弟节点也没有多余的键，则合并两个节点。合并可能导致父节点中的键减少，向上传播，最坏情况下树高度降低一层。
            
```
-- InnoDB 中 B+Tree 的页结构
-- 每个页 16 KB，包含以下部分：
-- File Header (38 bytes) : 页号、前后页指针、页类型
-- Page Header (56 bytes) : 记录数、空闲空间指针、页层级
-- Infimum + Supremum (26 bytes) : 虚拟最小/最大记录
-- User Records : 实际数据记录，按主键有序排列
-- Free Space : 空闲区域
-- Page Directory : 稀疏目录，用于页内二分查找
-- File Trailer (8 bytes) : 校验和，用于检测页损坏
```

            

### 2.3 聚簇索引与非聚簇索引

            

在 InnoDB 中，主键索引是聚簇索引（Clustered
            Index）。数据行按照主键顺序存储在 B+Tree
            的叶子节点中。如果没有显式定义主键，InnoDB
            会选择第一个唯一非空索引作为聚簇索引；如果连这个也没有，InnoDB
            会隐式创建一个 6 字节的 ROW_ID 作为聚簇索引。
            

聚簇索引的优势：
            
            
- **范围查询高效**：按主键范围查询时，数据物理上是连续存储的，可以利用顺序
            I/O。
            
- **覆盖查询**：主键查询不需要回表，因为叶子节点就是数据本身。
            
- **排序免排序**：按主键 ORDER BY
            时，数据天然有序，不需要额外排序。
            
            

聚簇索引的劣势：
            
            
- **插入顺序敏感**：如果主键不是自增的（比如
            UUID），插入时会导致大量随机 I/O 和页分裂。
            
- **辅助索引更大**：辅助索引的叶子节点存储的是主键值而非行指针，如果主键很大（比如
            36 字节的 UUID），每个辅助索引都要多存这些字节。
            
- **更新主键代价高**：更新主键意味着数据行需要移动到新的物理位置。
            
            
```
-- 自增主键 vs UUID 主键的插入性能对比
-- 测试表结构
CREATE TABLE t_autoincrement (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    data VARCHAR(200),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE t_uuid (
    id CHAR(36) PRIMARY KEY,  -- UUID 作为主键
    data VARCHAR(200),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 插入 100 万行：
-- t_autoincrement: ~12 秒（顺序写入，几乎无页分裂）
-- t_uuid:          ~45 秒（随机写入，大量页分裂）
```

            

### 2.4
            覆盖索引与索引覆盖扫描

            

覆盖索引（Covering
            Index）是指一个索引包含了查询需要的所有列，查询可以完全通过索引返回结果，不需要回表访问数据行。MySQL
            的 EXPLAIN 输出中，如果 Extra 列显示
            `Using index`，就说明使用了索引覆盖扫描（Index-Only
            Scan）。
            
```
-- 示例：订单表
CREATE TABLE orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status TINYINT NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_user_status_amount (user_id, status, amount)
) ENGINE=InnoDB;

-- 查询 1：覆盖索引，不需要回表
-- idx_user_status_amount 包含了 user_id, status, amount 三列
EXPLAIN SELECT user_id, status, amount
FROM orders
WHERE user_id = 1001 AND status = 1;
-- Extra: Using index  ← 索引覆盖扫描

-- 查询 2：需要回表，因为 SELECT 了 created_at，不在索引中
EXPLAIN SELECT user_id, status, amount, created_at
FROM orders
WHERE user_id = 1001 AND status = 1;
-- Extra: NULL  ← 需要回表
```

            

覆盖索引的收益在高并发场景下尤为显著。回表意味着随机
            I/O，而索引覆盖扫描只需要顺序扫描索引页。对于热点查询，一个精心设计的覆盖索引可以把查询延迟从毫秒级降到微秒级。
            

### 2.5 B+Tree 索引的局限性

            

B+Tree 并非万能。以下场景中 B+Tree 表现不佳：
            
            
- **全文搜索**：在文章内容中搜索一个关键词，B+Tree
            无能为力。需要倒排索引。
            
- **高维空间查询**：查找某个经纬度附近的餐厅，B+Tree
            只能沿一个维度排序。需要 R-Tree。
            
- **低基数列过滤**：性别列只有两个值，B+Tree
            索引的选择性太低，扫描半张表还不如全表扫描。需要 Bitmap
            索引。
            
- **存在性判断**：判断一个 key
            是否存在，B+Tree 需要 O(log N) 次 I/O。Bloom Filter 可以用
            O(1) 做概率性判断。
            
- **极高写入吞吐**：B+Tree
            的随机写入和页分裂限制了写入吞吐。LSM-Tree（Log-Structured
            Merge-Tree）通过顺序写和延迟合并优化写入性能。
            
            
            

## 三、Hash 索引

            

### 3.1 哈希索引的原理

            

哈希索引（Hash Index）基于哈希表（Hash
            Table）实现。核心思想很简单：对索引键应用一个哈希函数（Hash
            Function），计算出一个哈希值（Hash
            Value），用这个哈希值直接定位到数据的存储位置。
            
```
哈希索引的结构：

  索引键 key
     ↓
  hash(key)  →  桶编号（Bucket Number）
     ↓
  [Bucket 0] → [entry] → [entry] → NULL
  [Bucket 1] → [entry] → NULL
  [Bucket 2] → [entry] → [entry] → [entry] → NULL
  ...
  [Bucket N] → NULL

  每个 entry 包含：(key, value/pointer)
```

            

理想情况下，哈希函数能把键均匀地分布到各个桶中，每个桶只有一个或少量条目，查找时间复杂度为
            O(1)。但如果发生哈希冲突（Hash
            Collision）——多个键映射到同一个桶——就需要在桶内遍历链表或使用开放寻址法（Open
            Addressing）解决冲突。
            

### 3.2 哈希索引的适用场景

            

哈希索引只适用于等值查询（Equality Query），即
            `WHERE key = value`
            形式的查询。对于以下操作，哈希索引无法提供任何帮助：
            
            
- 范围查询：`WHERE key > 100 AND key 
            
- 排序：`ORDER BY key`
            
- 前缀匹配：`WHERE key LIKE 'abc%'`
            
- 部分键查询：复合哈希索引无法只使用前几列
            
            

原因很简单：哈希函数打乱了键的自然顺序。`hash('abc')`
            和 `hash('abd')` 之间没有任何顺序关系。
            

### 3.3 MySQL 中的 Hash 索引

            

**MEMORY 引擎的显式 Hash 索引**：
            

MySQL 的 MEMORY 存储引擎（也叫 HEAP 引擎）原生支持 Hash
            索引，而且 Hash 索引是 MEMORY 引擎的默认索引类型。
            
```
-- MEMORY 引擎创建 Hash 索引
CREATE TABLE session_cache (
    session_id CHAR(32) NOT NULL,
    user_id BIGINT NOT NULL,
    data TEXT,
    expire_at DATETIME NOT NULL,
    PRIMARY KEY USING HASH (session_id),  -- 显式指定 Hash 索引
    INDEX idx_user USING HASH (user_id)
) ENGINE=MEMORY;

-- 等值查询：O(1) 复杂度
SELECT * FROM session_cache WHERE session_id = 'abc123def456';

-- 范围查询：无法使用 Hash 索引，全表扫描
SELECT * FROM session_cache WHERE expire_at 
            

MEMORY
            引擎的局限性很明显：数据全部存储在内存中，服务器重启后数据丢失；不支持
            TEXT 和 BLOB 类型的索引；表级锁（Table
            Lock）限制了并发性能。在生产环境中，MEMORY
            引擎通常只用于临时表和会话级缓存。
            

**InnoDB 的自适应哈希索引（Adaptive Hash
            Index）**：
            

InnoDB 没有显式的 Hash
            索引类型，但它有一个自适应哈希索引（Adaptive Hash
            Index，AHI）机制。InnoDB 在运行时监控 B+Tree
            索引的访问模式，如果发现某些索引页被频繁访问、且访问模式符合等值查询特征，就会自动在内存中为这些页构建一个哈希索引，加速后续的等值查询。
            
```
-- 查看自适应哈希索引的状态
SHOW ENGINE INNODB STATUS\G
-- 在 SEMAPHORES 和 INSERT BUFFER AND ADAPTIVE HASH INDEX 段可以看到 AHI 信息

-- AHI 的配置
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index';
-- 默认开启：ON

SHOW VARIABLES LIKE 'innodb_adaptive_hash_index_parts';
-- 默认值：8（将 AHI 分为 8 个分区，减少锁争用）
```

            

AHI 的特点：
            
            
- **全自动**：无需用户干预，InnoDB
            自动决定是否构建和销毁 AHI。
            
- **内存中**：AHI 只存在于 Buffer Pool
            内存中，不持久化到磁盘。
            
- **部分索引**：AHI
            不覆盖所有索引，只覆盖被频繁等值查询的热点索引页。
            
- **有争议**：在高并发场景下，AHI
            的内部锁（btr_search_latch）可能成为瓶颈。MySQL 8.0 将 AHI
            分为多个分区以缓解这个问题，但仍有部分场景建议关闭
            AHI。
            
            

### 3.4
            一致性哈希与分布式索引

            

在分布式存储系统中，一致性哈希（Consistent
            Hashing）是一种常用的数据分片策略。它不是传统意义上的”索引”，但其核心思想——通过哈希函数将键映射到节点——与哈希索引一脉相承。
            
```
一致性哈希环：

        Node A
       /      \
  hash=0     hash=2^32
      |        |
  Node D    Node B
       \      /
        Node C

  key1 → hash(key1) → 顺时针找到最近的节点 → Node B
  key2 → hash(key2) → 顺时针找到最近的节点 → Node C
```

            

当增加或删除节点时，一致性哈希只需要重新分配一小部分键，而不是全部重新哈希。这个特性使得一致性哈希在
            Cassandra、DynamoDB、Memcached
            等分布式系统中被广泛使用。
            
            

## 四、倒排索引（Inverted
            Index）

            

### 4.1 为什么需要倒排索引

            

考虑一个典型的全文搜索场景：在一个包含 100
            万篇文章的数据库中，搜索包含”分布式事务”的文章。
            

用 B+Tree 索引无法高效解决这个问题。B+Tree
            索引是基于列值的前缀匹配，`LIKE '%分布式事务%'`
            这种包含前导通配符的查询，B+Tree
            索引完全用不上，只能全表扫描。即使没有前导通配符，`LIKE '分布式事务%'`
            只能匹配列值以”分布式事务”开头的行，无法匹配”浅谈分布式事务的实现”。
            

倒排索引（Inverted
            Index）的思想是**反转索引方向**：不是从文档到词语，而是从词语到文档。
            

### 4.2 倒排索引的结构

            

倒排索引由两部分组成：
            

**词项字典（Term
            Dictionary）**：所有出现过的词语（Term）的有序列表。通常用
            B+Tree、有限状态转换器（FST，Finite State Transducer）或
            Trie 树实现，支持快速查找某个词项。
            

**倒排列表（Posting
            List）**：每个词项对应一个文档列表，记录哪些文档包含了这个词项。每个条目通常包含文档
            ID（Document ID）、词频（Term
            Frequency）和位置信息（Position）。
            
```
倒排索引结构示意：

词项字典          倒排列表
────────          ─────────────────────────────
"分布式"    →    [doc1:2, doc3:1, doc7:3]
"事务"      →    [doc1:1, doc2:4, doc3:2, doc5:1]
"隔离级别"  →    [doc2:2, doc5:3]
"索引"      →    [doc4:5, doc6:1, doc7:2]
"B+Tree"    →    [doc4:3, doc6:2]

其中 docN:M 表示词项出现在文档 N 中，出现了 M 次。

搜索"分布式事务"：
  1. 查找"分布式"的倒排列表：{doc1, doc3, doc7}
  2. 查找"事务"的倒排列表：{doc1, doc2, doc3, doc5}
  3. 取交集：{doc1, doc3}
  4. 按相关性评分排序返回
```

            

### 4.3 倒排索引的构建流程

            

从原始文本到倒排索引，需要经过以下处理步骤：
            
            
- **分词（Tokenization）**：将文本拆分为词语。英文按空格和标点分词；中文需要使用分词器（如
            jieba、IK Analyzer）进行词语切分。
            
- **词项归一化（Normalization）**：统一大小写、去除标点、词干提取（Stemming，如
            running → run）、同义词映射。
            
- **构建倒排列表**：遍历所有文档，为每个词项记录出现的文档
            ID、位置和频率。
            
- **压缩存储**：对倒排列表中的文档 ID
            列表进行差值编码（Delta
            Encoding）和变长编码（Variable-Length
            Encoding），减少存储空间。
            
            
```
差值编码示例：

原始文档 ID 列表：  [1, 5, 12, 17, 25, 100, 108]
差值编码后：        [1, 4, 7, 5, 8, 75, 8]
                     ↑  ↑  ↑  ↑  ↑   ↑  ↑
                    原值 差 差 差 差   差  差

差值通常较小，可以用更少的字节存储。
配合变长编码（VByte / PForDelta），压缩比可达 4:1 甚至更高。
```

            

### 4.4
            Elasticsearch 与 Lucene 的倒排索引实现

            

Elasticsearch
            是目前最流行的全文搜索引擎，其核心搜索能力由 Apache Lucene
            库提供。Lucene 的倒排索引实现包含以下关键组件：
            

**段（Segment）**：Lucene
            的索引由多个不可变（Immutable）的段组成。新文档写入时，先进入内存缓冲区，定期刷写（Flush）为新的段。段一旦写入磁盘就不再修改——删除操作只是标记删除，更新操作等价于先删除再插入。不可变性带来了并发安全和缓存友好的好处，代价是需要定期合并（Merge）段以回收空间和提高查询效率。
            

**FST（Finite State Transducer）**：Lucene
            使用 FST 作为词项字典的内存数据结构。FST 比 B+Tree 和 Hash
            Map
            更省内存，它能在共享前缀和后缀的同时支持快速查找。对于百万级别的词项，FST
            通常只需要几十 MB 内存。
            

**Skip
            List（跳表）**：倒排列表内部使用跳表加速交集和并集运算。当需要对两个倒排列表取交集时，跳表允许跳过大量不匹配的文档
            ID，而不需要逐个比较。
            
```
// Elasticsearch 创建索引的示例
PUT /articles
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "chinese_analyzer": {
          "type": "custom",
          "tokenizer": "ik_max_word",
          "filter": ["lowercase", "stop"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "chinese_analyzer"
      },
      "content": {
        "type": "text",
        "analyzer": "chinese_analyzer"
      },
      "author": {
        "type": "keyword"
      },
      "publish_date": {
        "type": "date"
      }
    }
  }
}
```

            

### 4.5 倒排索引的性能特征

            

倒排索引的性能特征与 B+Tree 截然不同：
            
```
┌──────────────────┬──────────────────────────────────────┐
│ 操作             │ 性能特征                              │
├──────────────────┼──────────────────────────────────────┤
│ 单词项查找       │ O(1) 到 O(log T)，T 为词项总数       │
│ 布尔查询         │ 取决于倒排列表长度和交/并集算法       │
│ 短语查询         │ 需要位置信息，比布尔查询更慢          │
│ 写入             │ 批量写入后刷写段，不支持实时单条更新  │
│ 更新/删除        │ 标记删除 + 段合并，有延迟             │
│ 空间占用         │ 通常为原始数据的 30%–50%              │
│ 近实时搜索       │ 刷写间隔（默认 1 秒）决定可见延迟     │
└──────────────────┴──────────────────────────────────────┘
```

            

### 4.6 MySQL 中的全文索引

            

MySQL 从 5.6 版本开始在 InnoDB 中支持全文索引（FULLTEXT
            Index）。其实现基于倒排索引，但功能和性能与 Elasticsearch
            差距较大。
            
```
-- 创建全文索引
CREATE TABLE articles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    FULLTEXT INDEX ft_content (title, content) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 使用全文索引查询
SELECT id, title,
       MATCH(title, content) AGAINST('分布式事务' IN BOOLEAN MODE) AS score
FROM articles
WHERE MATCH(title, content) AGAINST('分布式事务' IN BOOLEAN MODE)
ORDER BY score DESC
LIMIT 10;
```

            

MySQL
            全文索引的局限：不支持分布式搜索、聚合分析能力弱、分词器选择有限、大数据量下性能不佳。对于严肃的全文搜索需求，Elasticsearch
            或 Apache Solr 是更合适的选择。
            
            

## 五、Bitmap 索引

            

### 5.1 Bitmap 索引的原理

            

位图索引（Bitmap Index）的核心思想是用一个位图（Bit Array
            /
            Bitmap）来表示索引键的每个取值与数据行之间的对应关系。对于索引键的每个不同取值，维护一个与表行数等长的位图，第
            i 位为 1 表示第 i 行的索引键等于该取值，为 0
            表示不等于。
            
```
Bitmap 索引示例：

表 employees 有 8 行数据，gender 列只有 'M' 和 'F' 两个取值。

行号  gender
────  ──────
  0   M
  1   F
  2   M
  3   M
  4   F
  5   M
  6   F
  7   M

gender='M' 的位图：  1 0 1 1 0 1 0 1
gender='F' 的位图：  0 1 0 0 1 0 1 0
```

            

### 5.2 位运算实现多条件过滤

            

Bitmap 索引最强大的特性是通过位运算（Bitwise
            Operation）高效地实现多条件过滤。多个条件的 AND、OR、NOT
            操作直接对应位图的按位与（AND）、按位或（OR）、按位取反（NOT）运算。
            
```
示例：查找部门为 '工程部' 且 性别为 'M' 的员工

department='工程部' 的位图：  1 0 1 0 0 1 1 0
gender='M' 的位图：          1 0 1 1 0 1 0 1

AND 运算：                   1 0 1 0 0 1 0 0
                             ↑       ↑
                           行0     行5 满足条件

CPU 可以用一条指令对 64 位（8 字节）的位图做 AND 运算。
对于 100 万行的表，位图大小只有 ~122 KB，整个过滤过程在微秒级完成。
```

            

### 5.3 Bitmap
            索引的适用场景

            

Bitmap 索引最适合以下场景：
            
            
- **低基数（Low
            Cardinality）列**：列的不同取值数量远小于行数。比如性别（2
            个值）、状态（5–10 个值）、省份（34
            个值）。如果基数很高（比如用户
            ID），每个取值对应的位图中大部分位都是
            0，空间利用率极低。
            
- **OLAP
            查询**：数据仓库中的多维分析查询，通常需要对多个维度列做
            AND/OR 过滤。Bitmap 索引的位运算完美匹配这种查询模式。
            
- **读多写少**：Bitmap
            索引的更新代价较高——修改一行数据可能需要更新多个位图。在高并发写入的
            OLTP 场景下，Bitmap 索引会成为性能瓶颈。
            
            
```
Bitmap 索引适用场景矩阵：

               低基数列  高基数列
读多写少（OLAP） ✓✓✓      ✗
读写均衡（OLTP） ✗        ✗
写多读少         ✗        ✗

✓✓✓ = 强烈推荐
✗   = 不推荐
```

            

### 5.4 Bitmap 索引的压缩

            

当列的基数不是特别低时，位图中会有大量连续的 0
            位，导致空间浪费。位图压缩算法可以显著减少存储空间：
            

**WAH（Word-Aligned
            Hybrid）**：将位图按机器字（Word）分组，对连续的全 0
            字和全 1 字进行游程编码（Run-Length Encoding）。WAH
            压缩后的位图仍然支持直接进行按位运算，不需要先解压。
            

**Roaring
            Bitmap**：现代位图压缩的事实标准。Roaring Bitmap
            将位图按
            2^16（65536）个位分成若干容器（Container），每个容器根据稠密程度选择不同的存储方式：
            
```
Roaring Bitmap 容器类型：

- Array Container：当容器中设置了不到 4096 个位时，
                   使用排序数组存储位的编号。
- Bitmap Container：当容器中设置了 4096 个以上的位时，
                    使用原始位图存储（8 KB 固定大小）。
- Run Container：  当容器中的位呈现连续运行模式时，
                   使用游程编码。

切换阈值 4096 的选择：
  4096 × 2 bytes（Array） = 8192 bytes ≈ 8 KB（Bitmap Container 大小）
  当位数超过 4096 时，Array 占用空间超过 Bitmap，自动切换。
```

            

Roaring Bitmap 在 Apache Spark、Apache
            Druid、ClickHouse、Elasticsearch 等系统中被广泛使用。
            

### 5.5 Oracle 与 Bitmap
            索引

            

Oracle 数据库是最早和最成熟支持 Bitmap
            索引的关系数据库。Oracle 的 Bitmap
            索引实现包含锁管理机制，但在高并发 DML
            场景下仍然容易出现锁争用。
            
```
-- Oracle 创建 Bitmap 索引
CREATE BITMAP INDEX idx_emp_gender ON employees(gender);
CREATE BITMAP INDEX idx_emp_dept ON employees(department);

-- 多条件查询自动使用 Bitmap AND 运算
SELECT * FROM employees
WHERE gender = 'M' AND department = '工程部';

-- 执行计划中可以看到 BITMAP AND 操作
-- | BITMAP CONVERSION TO ROWIDS |
-- |  BITMAP AND                 |
-- |   BITMAP INDEX idx_emp_gender|
-- |   BITMAP INDEX idx_emp_dept  |
```

            

MySQL InnoDB 不支持 Bitmap 索引。ClickHouse 支持 Bitmap
            函数，但不直接支持 Bitmap 索引类型。PostgreSQL
            不支持持久化的 Bitmap 索引，但查询执行器中有 Bitmap Index
            Scan 和 Bitmap Heap Scan
            操作——这是运行时临时构建的位图，用于合并多个 B-Tree
            索引的结果，与持久化的 Bitmap 索引是不同的概念。
            
            

## 六、空间索引：R-Tree

            

### 6.1 空间数据的索引挑战

            

空间数据（Spatial
            Data）是指具有地理位置属性的数据，比如经纬度坐标、多边形区域、路线轨迹。空间查询的典型问题包括：
            
            
- **最近邻查询（Nearest Neighbor
            Query）**：找到离我最近的 10 家餐厅。
            
- **范围查询（Range
            Query）**：找到某个矩形区域内的所有加油站。
            
- **包含查询（Containment
            Query）**：判断一个点是否在某个多边形区域内。
            
- **相交查询（Intersection
            Query）**：找到与某条道路相交的所有河流。
            
            

B+Tree
            只能沿一个维度排序。如果用经度建索引，可以快速筛选经度范围，但无法同时约束纬度。用两个单独的
            B+Tree
            索引分别索引经度和纬度，然后取交集，效率也不高——因为两个一维范围的交集不等于二维空间的范围。
            

### 6.2 R-Tree 的结构

            

R-Tree（Rectangle Tree，矩形树）由 Antonin Guttman 于
            1984 年提出，专门解决多维空间数据的索引问题。R-Tree
            的基本思想是用最小外接矩形（MBR，Minimum Bounding
            Rectangle）层层包裹空间对象，构建一棵平衡树。
            
```
R-Tree 结构示意：

根节点 MBR: [整个空间]
├── 子节点 MBR: [左上区域]
│   ├── 叶子: 餐厅A (x1,y1)
│   ├── 叶子: 餐厅B (x2,y2)
│   └── 叶子: 公园C [多边形]
└── 子节点 MBR: [右下区域]
    ├── 叶子: 加油站D (x3,y3)
    ├── 叶子: 学校E [多边形]
    └── 叶子: 医院F (x4,y4)

查找"矩形 R 内的所有空间对象"：
  1. 从根节点开始，检查子节点的 MBR 是否与 R 相交
  2. 只递归进入 MBR 与 R 相交的子树
  3. 在叶子节点进行精确几何判断
```

            

R-Tree 的变体包括：
            
            
- **R*-Tree**：改进了插入和分裂算法，减少 MBR
            的重叠和覆盖面积，提高查询效率。PostgreSQL 的 GiST
            索引底层就使用了 R*-Tree 的思想。
            
- **R+-Tree**：不允许同一层的 MBR
            重叠，通过将跨越多个 MBR
            的对象复制到多个节点来消除重叠。
            
- **Hilbert
            R-Tree**：利用空间填充曲线（Hilbert
            Curve）对空间对象排序后构建
            R-Tree，提高空间局部性和缓存效率。
            
            

### 6.3 R-Tree 操作的复杂度

            
```
┌──────────────┬────────────────────────────────────┐
│ 操作         │ 时间复杂度                         │
├──────────────┼────────────────────────────────────┤
│ 点查         │ O(log_m N)，m 为最小子节点数       │
│ 范围查询     │ O(log_m N + K)，K 为结果集大小     │
│ 最近邻       │ O(log_m N)（优先级搜索）           │
│ 插入         │ O(log_m N)                         │
│ 删除         │ O(log_m N)                         │
│ 最坏情况     │ 所有 MBR 重叠时退化为 O(N)         │
└──────────────┴────────────────────────────────────┘
```

            

### 6.4 PostGIS 中的空间索引

            

PostGIS 是 PostgreSQL 的空间扩展，使用 GiST（Generalized
            Search Tree，通用搜索树）索引实现空间索引。GiST
            是一个可扩展的索引框架，R-Tree 只是 GiST
            支持的索引策略之一。
            
```
-- PostGIS 创建空间索引
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL  -- WGS84 坐标系
);

-- 创建 GiST 空间索引
CREATE INDEX idx_restaurants_location
ON restaurants USING GIST (location);

-- 范围查询：查找某矩形区域内的餐厅
SELECT name, ST_AsText(location)
FROM restaurants
WHERE ST_Within(
    location,
    ST_MakeEnvelope(116.3, 39.9, 116.5, 40.0, 4326)
);

-- 最近邻查询：查找离指定点最近的 5 家餐厅
SELECT name,
       ST_Distance(location::geography,
                   ST_MakePoint(116.4, 39.95)::geography) AS dist_meters
FROM restaurants
ORDER BY location  ST_MakePoint(116.4, 39.95)::geometry
LIMIT 5;
--  操作符利用 GiST 索引做高效的最近邻搜索
```

            

### 6.5 MongoDB 地理空间索引

            

MongoDB 提供两种地理空间索引：
            
```
// 2dsphere 索引：支持 GeoJSON 格式，用于球面几何计算
db.restaurants.createIndex({ location: "2dsphere" });

// 插入带有地理坐标的文档
db.restaurants.insertOne({
    name: "某某餐厅",
    location: {
        type: "Point",
        coordinates: [116.4, 39.95]  // [经度, 纬度]
    }
});

// 查找 2 公里范围内的餐厅
db.restaurants.find({
    location: {
        $near: {
            $geometry: {
                type: "Point",
                coordinates: [116.4, 39.95]
            },
            $maxDistance: 2000  // 单位：米
        }
    }
}).limit(10);

// 查找多边形区域内的餐厅
db.restaurants.find({
    location: {
        $geoWithin: {
            $geometry: {
                type: "Polygon",
                coordinates: [[
                    [116.3, 39.9],
                    [116.5, 39.9],
                    [116.5, 40.0],
                    [116.3, 40.0],
                    [116.3, 39.9]
                ]]
            }
        }
    }
});
```

            

MongoDB 的 2dsphere 索引底层使用 S2 Geometry Library
            的空间分区算法，将地球表面划分为层级化的单元格（Cell），每个单元格用一个
            64
            位整数编码。这种编码方式将二维空间问题转化为一维索引问题，可以利用
            B-Tree 索引的现有基础设施。
            
            

## 七、Bloom Filter

            

### 7.1 布隆过滤器的原理

            

布隆过滤器（Bloom Filter）是 Burton H. Bloom 于 1970
            年提出的一种概率型数据结构（Probabilistic Data
            Structure）。它用于快速判断一个元素是否属于一个集合，有以下特性：
            
            
- **如果 Bloom Filter
            说”不存在”，则一定不存在**（假阴性率为 0）。
            
- **如果 Bloom Filter
            说”可能存在”，则可能存在也可能不存在**（有一定的假阳性率，False
            Positive Rate）。
            
            

Bloom Filter 由一个 m 位的位数组（Bit Array）和 k
            个独立的哈希函数组成。
            
```
Bloom Filter 的操作：

插入元素 x：
  计算 h1(x), h2(x), ..., hk(x)，得到 k 个位置
  将位数组中这 k 个位置的位设为 1

查询元素 y：
  计算 h1(y), h2(y), ..., hk(y)，得到 k 个位置
  检查位数组中这 k 个位置的位：
    - 如果所有位都是 1 → 元素可能存在（可能是假阳性）
    - 如果有任何一个位是 0 → 元素一定不存在

示例（m=16, k=3）：

位数组：  0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0

插入 "apple"：
  h1("apple")=2, h2("apple")=5, h3("apple")=11
  位数组：  0 0 1 0 0 1 0 0 0 0 0 1 0 0 0 0

插入 "banana"：
  h1("banana")=3, h2("banana")=7, h3("banana")=11
  位数组：  0 0 1 1 0 1 0 1 0 0 0 1 0 0 0 0

查询 "cherry"：
  h1("cherry")=2, h2("cherry")=7, h3("cherry")=14
  位 2=1, 位 7=1, 位 14=0 → 不存在（确定）

查询 "date"：
  h1("date")=2, h2("date")=5, h3("date")=3
  位 2=1, 位 5=1, 位 3=1 → 可能存在（假阳性！实际不存在）
```

            

### 7.2 假阳性率的数学分析

            

Bloom Filter 的假阳性率（False Positive
            Probability，FPP）可以精确计算：
            
```
假设：
  m = 位数组的大小（位数）
  n = 已插入的元素数量
  k = 哈希函数个数

插入 n 个元素后，某个特定位仍然是 0 的概率：
  p = (1 - 1/m)^(kn) ≈ e^(-kn/m)

假阳性率：
  FPP = (1 - p)^k = (1 - e^(-kn/m))^k

给定 m 和 n，最优的哈希函数个数：
  k_opt = (m/n) × ln(2) ≈ 0.693 × (m/n)

此时最低假阳性率：
  FPP_min = (1/2)^k = (0.6185)^(m/n)

每个元素占用的位数（bits per key）：
  m/n = -k / ln(1 - FPP^(1/k))

常用配置：
  bits_per_key = 10  →  FPP ≈ 0.82%  （k=7）
  bits_per_key = 15  →  FPP ≈ 0.02%  （k=10）
  bits_per_key = 20  →  FPP ≈ 0.0005% （k=14）
```

            

### 7.3 Bloom Filter
            在 LSM-Tree 中的应用

            

Bloom Filter 在日志结构合并树（LSM-Tree，Log-Structured
            Merge-Tree）中扮演关键角色。LSM-Tree 是
            LevelDB、RocksDB、Cassandra、HBase
            等存储引擎的核心数据结构。
            

LSM-Tree 的读取流程需要依次检查内存中的 MemTable
            和磁盘上的多层 SSTable（Sorted String Table）文件。如果没有
            Bloom Filter，每次读取可能需要在多个 SSTable
            文件中做二分查找，产生大量不必要的磁盘 I/O。
            
```
LSM-Tree 读取流程（有 Bloom Filter）：

读取 key="user:42"
  ↓
检查 MemTable → 未找到
  ↓
检查 Level 0 SSTable:
  Bloom Filter 判断 → "不存在" → 跳过（避免一次磁盘 I/O）
  ↓
检查 Level 1 SSTable-A:
  Bloom Filter 判断 → "不存在" → 跳过
  ↓
检查 Level 1 SSTable-B:
  Bloom Filter 判断 → "可能存在" → 读取数据块 → 找到！
  ↓
返回结果

如果没有 Bloom Filter，需要在每个 SSTable 中做磁盘 I/O
Bloom Filter 把读放大（Read Amplification）从 O(L) 降到接近 O(1)
其中 L 是 LSM-Tree 的层数
```

            

在 RocksDB 中，Bloom Filter 的配置如下：
            
```
// RocksDB Bloom Filter 配置
rocksdb::Options options;
rocksdb::BlockBasedTableOptions table_options;

// 设置每个键占用 10 位的 Bloom Filter
// 假阳性率约 0.82%
table_options.filter_policy.reset(
    rocksdb::NewBloomFilterPolicy(10, false)
);

// 将 Bloom Filter 存储在 SSTable 的元数据块中
// 而不是独立的 filter 块中（full filter）
table_options.format_version = 5;

options.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(table_options)
);
```

            

### 7.4 Bloom Filter 的变体

            

**Counting Bloom
            Filter（计数布隆过滤器）**：用 n 位计数器替代 1
            位标志，支持删除操作。标准 Bloom Filter
            不支持删除，因为清除一个位可能影响其他元素。Counting Bloom
            Filter 用 4 位计数器（支持 0–15
            的计数），删除时递减而非清零。代价是空间增大 4 倍。
            

**Cuckoo Filter（布谷鸟过滤器）**：由 Fan
            等人于 2014 年提出，使用布谷鸟哈希（Cuckoo
            Hashing）替代传统的多哈希方案。Cuckoo Filter
            支持删除操作，且在相同假阳性率下通常比 Bloom Filter
            更省空间（尤其当假阳性率低于 3% 时）。
            

**Ribbon Filter**：由 Dillinger 和 Walzer 于
            2021 年提出，是 RocksDB 中的新一代过滤器。Ribbon Filter
            的空间效率接近理论极限，构建时间比 Bloom Filter
            更长，但查询速度相当，且空间节省约 30%。
            
```
过滤器空间效率对比（FPP = 1%）：

┌───────────────────┬───────────────┬──────────────┐
│ 过滤器类型        │ bits per key  │ 相对空间     │
├───────────────────┼───────────────┼──────────────┤
│ Bloom Filter      │ 9.6           │ 1.0x         │
│ Cuckoo Filter     │ 8.5           │ 0.89x        │
│ Ribbon Filter     │ 7.0           │ 0.73x        │
│ 信息论下限        │ 6.64          │ 0.69x        │
└───────────────────┴───────────────┴──────────────┘
```

            
            

## 八、列存索引与 Zone
            Maps

            

### 8.1 列式存储中的索引思路

            

在列式存储（Columnar
            Storage）系统中，数据按列而非按行组织。一列的所有值连续存储在一起，这天然带来了两个好处：
            
            
- **压缩效率高**：同一列的值类型相同、分布相似，压缩比远高于行存。
            
- **扫描效率高**：分析查询通常只需要少数几列，列存只需要读取相关列的数据，跳过无关列。
            
            

但列存也带来了新的索引需求：如何快速跳过不包含目标值的数据块？这就是
            Zone Map（区域映射）和 Data
            Skipping（数据跳过）的核心思想。
            

### 8.2 Zone Map 的原理

            

Zone Map（也叫 Min/Max Index、Small Materialized
            Aggregates）为每个数据块（Block / Row Group /
            Stripe）维护该列的统计信息，至少包括最小值（Min）和最大值（Max）。查询时，如果查询条件与某个数据块的
            Min/Max
            范围不相交，就可以直接跳过整个数据块，不需要读取和解压其中的数据。
            
```
Zone Map 示例：

表 orders，按 order_id 分块存储，每块 100 万行

Block 0:  order_date MIN=2024-01-01  MAX=2024-03-31  amount MIN=10   MAX=9999
Block 1:  order_date MIN=2024-04-01  MAX=2024-06-30  amount MIN=5    MAX=8888
Block 2:  order_date MIN=2024-07-01  MAX=2024-09-30  amount MIN=15   MAX=12000
Block 3:  order_date MIN=2024-10-01  MAX=2024-12-31  amount MIN=8    MAX=7777

查询：WHERE order_date = '2024-08-15'
  Block 0: MAX=2024-03-31  2024-08-15 → 跳过 ✓

只需扫描 1/4 的数据块，跳过了 75% 的 I/O。
```

            

### 8.3 Parquet 与 ORC
            的索引机制

            

**Apache Parquet**
            是大数据生态中最流行的列式文件格式，广泛用于
            Spark、Hive、Presto/Trino 等系统。Parquet
            文件的结构包含行组（Row Group）、列块（Column
            Chunk）和数据页（Data Page）三个层级。
            
```
Parquet 文件结构：

┌─────────────────────────────────────┐
│            File Header              │
├─────────────────────────────────────┤
│ Row Group 0                         │
│  ├── Column Chunk: order_id         │
│  │    ├── Data Page 0               │
│  │    └── Data Page 1               │
│  ├── Column Chunk: order_date       │
│  │    ├── Data Page 0               │
│  │    └── Data Page 1               │
│  └── Column Chunk: amount           │
│       ├── Data Page 0               │
│       └── Data Page 1               │
├─────────────────────────────────────┤
│ Row Group 1                         │
│  └── ...                            │
├─────────────────────────────────────┤
│ Footer (Metadata)                   │
│  ├── Schema                         │
│  ├── Row Group Metadata             │
│  │    ├── Column Chunk Metadata     │
│  │    │    ├── Min/Max statistics   │  ← Zone Map
│  │    │    ├── Null count           │
│  │    │    └── Distinct count       │
│  │    └── ...                       │
│  └── ...                            │
└─────────────────────────────────────┘
```

            

Parquet 在两个层级提供统计信息：
            
            
- **Column Chunk 级别**：每个行组中每列的
            Min/Max/Null Count。这是最基本的 Zone Map。
            
- **Data Page 级别**（Parquet
            2.0+）：每个数据页中每列的
            Min/Max。粒度更细，数据跳过更精确。
            
            

**Apache ORC**（Optimized Row
            Columnar）是另一种列式文件格式，主要在 Hive 生态中使用。ORC
            的索引机制比 Parquet 更丰富：
            
```
ORC 索引层级：

1. File Level Statistics：整个文件的 Min/Max
2. Stripe Level Statistics：每个条带（Stripe，类似行组）的 Min/Max
3. Row Group Index（Row Index Entries）：每 10000 行的 Min/Max
4. Bloom Filter Index（可选）：每个条带可以附加 Bloom Filter
```

            

### 8.4
            ClickHouse 的主键索引与 Data Skipping 索引

            

ClickHouse 是一个高性能列式 OLAP
            数据库，其索引设计与传统行存数据库有本质区别。
            

**主键索引（Primary Key
            Index）**：ClickHouse 的主键不是
            B+Tree，而是一个稀疏索引（Sparse
            Index）。数据按主键排序存储，每隔
            `index_granularity` 行（默认 8192
            行）记录一个索引标记（Mark）。查询时，通过二分查找索引标记确定需要扫描的数据范围（Granule），然后只读取这些范围内的数据。
            
```
-- ClickHouse 建表示例
CREATE TABLE events (
    event_date Date,
    user_id UInt64,
    event_type String,
    payload String
) ENGINE = MergeTree()
ORDER BY (event_date, user_id, event_type)
SETTINGS index_granularity = 8192;
```

            

**Data Skipping
            索引（跳数索引）**：ClickHouse
            支持在主键之外创建额外的 Data Skipping
            索引，用于加速非主键列的过滤。
            
```
-- minmax 索引：记录每个 Granule 块的 Min/Max
ALTER TABLE events ADD INDEX idx_amount minmax(amount) GRANULARITY 4;
-- GRANULARITY 4 表示每 4 个 Granule（4×8192=32768 行）计算一次 Min/Max

-- set 索引：记录每个 Granule 块中出现的所有不同值（限制最大数量）
ALTER TABLE events ADD INDEX idx_status set(status, 100) GRANULARITY 1;
-- 最多记录 100 个不同值

-- bloom_filter 索引：使用 Bloom Filter 做存在性判断
ALTER TABLE events ADD INDEX idx_payload bloom_filter(0.01) GRANULARITY 1;
-- 假阳性率 1%

-- ngrambf_v1 索引：基于 N-gram 的 Bloom Filter，用于模糊匹配
ALTER TABLE events ADD INDEX idx_content ngrambf_v1(3, 256, 2, 0) GRANULARITY 1;
-- 3-gram，256 字节位数组，2 个哈希函数
```

            

### 8.5 数据排序对 Zone
            Map 效果的影响

            

Zone Map
            的效果高度依赖于数据在物理存储上的排列顺序。如果数据按查询条件列排序，Zone
            Map 可以跳过大量数据块；如果数据随机排列，每个数据块的
            Min/Max 范围都会很大，Zone Map 几乎无效。
            
```
排序 vs 未排序的 Zone Map 效果：

场景：100 万行数据，每块 10 万行，查询 WHERE date = '2024-06-15'

未排序（按插入时间存储）：
  Block 0: date MIN=2024-01-03  MAX=2024-12-28  → 需要扫描
  Block 1: date MIN=2024-01-05  MAX=2024-12-30  → 需要扫描
  ...所有 10 个块都需要扫描 → 跳过率 0%

按 date 排序后：
  Block 0: date MIN=2024-01-01  MAX=2024-02-06  → 跳过
  Block 1: date MIN=2024-02-06  MAX=2024-04-16  → 跳过
  ...
  Block 5: date MIN=2024-06-04  MAX=2024-08-03  → 需要扫描
  ...
  → 跳过率 90%
```

            

这就是为什么 ClickHouse 的 `ORDER BY`
            子句如此重要——它不仅决定了主键索引的结构，还直接影响了所有
            Data Skipping 索引和 Zone Map 的有效性。
            
            

## 九、索引设计最佳实践

            

### 9.1 复合索引的列顺序

            

复合索引（Composite Index / Multi-Column
            Index）中列的顺序至关重要。B+Tree
            复合索引遵循最左前缀原则（Leftmost Prefix
            Rule）——只有查询条件从索引的最左列开始连续匹配，索引才能被使用。
            
```
-- 复合索引 (a, b, c) 的最左前缀匹配规则：
CREATE INDEX idx_abc ON t(a, b, c);

-- 可以使用索引的查询：
WHERE a = 1                     -- 使用列 a
WHERE a = 1 AND b = 2           -- 使用列 a, b
WHERE a = 1 AND b = 2 AND c = 3 -- 使用列 a, b, c（完全匹配）
WHERE a = 1 AND b > 2           -- 使用列 a, b（b 是范围条件，c 无法使用）
WHERE a = 1 AND c = 3           -- 只使用列 a（b 缺失，c 无法使用）

-- 无法使用索引的查询：
WHERE b = 2                     -- 缺少最左列 a
WHERE b = 2 AND c = 3           -- 缺少最左列 a
WHERE c = 3                     -- 缺少最左列 a 和 b
```

            

复合索引的列顺序设计原则：
            
            
- **等值查询列在前，范围查询列在后**：等值条件（=,
            IN）不会中断索引的最左前缀匹配，而范围条件（>, <,
            BETWEEN）会中断后续列的使用。
            
- **高选择性列在前**：选择性（Selectivity）=
            不同值的数量 /
            总行数。选择性高的列放在前面可以更快地缩小扫描范围。
            
- **考虑排序需求**：如果查询包含 ORDER
            BY，把排序列纳入索引可以避免额外的排序操作（Filesort）。
            
- **考虑覆盖索引**：把 SELECT
            需要的列也纳入索引尾部，实现索引覆盖扫描。
            
            
```
-- 示例：设计复合索引
-- 查询模式：
--   SELECT order_id, amount
--   FROM orders
--   WHERE user_id = ? AND status = ? AND created_at > ?
--   ORDER BY created_at DESC
--   LIMIT 20;

-- 分析：
-- user_id: 等值查询，高选择性 → 放第一位
-- status:  等值查询，低选择性 → 放第二位
-- created_at: 范围查询 + 排序 → 放第三位
-- order_id, amount: SELECT 列 → 尾部用于覆盖索引

CREATE INDEX idx_orders_optimized
ON orders (user_id, status, created_at, order_id, amount);
-- 这个索引可以：
-- 1. 用 user_id 和 status 做等值过滤
-- 2. 用 created_at 做范围过滤和排序（避免 filesort）
-- 3. 覆盖 SELECT 的所有列（避免回表）
```

            

### 9.2 选择性分析

            

在设计索引之前，应该先分析列的选择性，判断索引是否有价值：
            
```
-- 计算列的选择性
SELECT
    COUNT(DISTINCT user_id) / COUNT(*) AS selectivity_user_id,
    COUNT(DISTINCT status) / COUNT(*) AS selectivity_status,
    COUNT(DISTINCT city) / COUNT(*) AS selectivity_city
FROM orders;

-- 结果示例：
-- selectivity_user_id = 0.85   ← 高选择性，适合建索引
-- selectivity_status  = 0.0001 ← 低选择性，单独建索引价值不大
-- selectivity_city    = 0.01   ← 中等选择性，需要看查询模式

-- 前缀索引的选择性分析
-- 对于长字符串列，可以只索引前 N 个字符以节省空间
SELECT
    COUNT(DISTINCT LEFT(email, 5)) / COUNT(*) AS sel_5,
    COUNT(DISTINCT LEFT(email, 7)) / COUNT(*) AS sel_7,
    COUNT(DISTINCT LEFT(email, 10)) / COUNT(*) AS sel_10,
    COUNT(DISTINCT email) / COUNT(*) AS sel_full
FROM users;

-- 选择选择性接近完整列、但长度尽可能短的前缀
-- 如果 sel_7 ≈ sel_full，则使用 7 字符前缀索引
CREATE INDEX idx_email_prefix ON users (email(7));
```

            

### 9.3 索引合并与交叉

            

当一个查询条件涉及多个列，且每个列都有独立的索引，MySQL
            优化器可能会使用索引合并（Index
            Merge）策略：分别使用各自的索引获取 ROWID
            集合，然后做交集（Intersect）或并集（Union）操作。
            
```
-- 索引合并示例
-- 表上有两个独立索引：idx_status(status) 和 idx_city(city)
EXPLAIN SELECT * FROM orders WHERE status = 1 AND city = '北京';

-- 可能的执行计划：
-- type: index_merge
-- key: idx_status,idx_city
-- Extra: Using intersect(idx_status,idx_city); Using where

-- 索引合并通常不如一个复合索引高效
-- 更好的方案：创建复合索引
CREATE INDEX idx_status_city ON orders (status, city);
```

            

索引合并在大多数场景下都不如设计良好的复合索引高效。如果
            EXPLAIN 输出中看到
            `index_merge`，通常意味着索引设计需要优化。
            

### 9.4 EXPLAIN 分析方法论

            

EXPLAIN 是分析查询执行计划最重要的工具。理解 EXPLAIN
            输出的每一列是索引调优的基础。
            
```
-- EXPLAIN 关键字段解读
EXPLAIN SELECT * FROM orders WHERE user_id = 1001 AND status = 1\G

-- id:            查询序号
-- select_type:   查询类型（SIMPLE, PRIMARY, SUBQUERY, DERIVED...）
-- table:         访问的表
-- partitions:    匹配的分区
-- type:          访问类型（从好到差）
--   system > const > eq_ref > ref > range > index > ALL
-- possible_keys: 可能使用的索引
-- key:           实际使用的索引
-- key_len:       使用的索引长度（字节数，判断用了复合索引的几列）
-- ref:           索引匹配的列或常量
-- rows:          预估扫描行数
-- filtered:      按条件过滤后的行百分比
-- Extra:         额外信息
--   Using index        → 索引覆盖扫描（好）
--   Using where        → 在存储引擎返回后再由 Server 层过滤
--   Using temporary    → 使用临时表（通常需要优化）
--   Using filesort     → 使用文件排序（通常需要优化）
--   Using index condition → 索引条件下推（ICP）
```

            
```
-- EXPLAIN FORMAT=TREE 提供更直观的执行计划树
EXPLAIN FORMAT=TREE
SELECT o.order_id, o.amount, u.name
FROM orders o
JOIN users u ON o.user_id = u.user_id
WHERE o.status = 1 AND o.created_at > '2024-01-01'
ORDER BY o.created_at DESC
LIMIT 20\G

-- EXPLAIN ANALYZE 实际执行查询并显示每一步的真实耗时
EXPLAIN ANALYZE
SELECT user_id, COUNT(*) AS cnt
FROM orders
WHERE status = 1
GROUP BY user_id
HAVING cnt > 10\G
```

            

### 9.5 何时不该建索引

            

以下场景建索引是浪费甚至有害的：
            
            
- **极小的表**：几百行的配置表，全表扫描比走索引还快（因为索引查找本身也有开销）。
            
- **频繁大批量写入的表**：日志表每秒写入数千行，索引维护成本远大于查询收益。考虑先写入无索引的临时表，再批量导入有索引的正式表。
            
- **低选择性的列**：状态列只有 3
            个值，索引扫描的行数与全表扫描差不多，但多了回表的随机
            I/O。
            
- **很少被查询条件引用的列**：建了索引却从来没有查询用到，白白增加写入开销和存储空间。
            
- **频繁更新的列**：每次 UPDATE
            都要维护索引，如果这个列的索引很少被查询使用，就是净亏。
            
            
            

## 十、MySQL 索引实战

            

### 10.1 EXPLAIN 输出详解

            

回到实战，以一个电商订单查询为例，完整演示 EXPLAIN
            分析和索引优化过程。
            
```
-- 建表
CREATE TABLE orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0:待支付 1:已支付 2:已发货 3:已完成',
    city VARCHAR(50) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 查询：查找某用户最近 30 天已支付的订单
EXPLAIN
SELECT order_id, amount, created_at
FROM orders
WHERE user_id = 1001
  AND status = 1
  AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY created_at DESC
LIMIT 20\G

-- 未优化时的执行计划：
-- type: ref
-- key: idx_user_id
-- rows: 5000
-- Extra: Using where; Using filesort  ← 需要文件排序！
```

            

问题分析：
            
            
- 优化器选择了 `idx_user_id` 索引，过滤了
            `user_id = 1001` 的行。
            
- `status = 1` 和
            `created_at > ...` 条件在 Server 层通过
            `Using where` 过滤。
            
- `ORDER BY created_at DESC`
            需要额外的文件排序（`Using filesort`）。
            
- 需要回表获取 `amount` 和
            `created_at` 列的值。
            
            
```
-- 优化方案：创建复合覆盖索引
CREATE INDEX idx_user_status_created
ON orders (user_id, status, created_at, order_id, amount);

-- 优化后的执行计划：
-- type: range
-- key: idx_user_status_created
-- rows: 150
-- Extra: Using where; Using index; Backward index scan  ← 索引覆盖 + 无 filesort
```

            

优化后：
            
            
- 复合索引的最左前缀匹配
            `user_id = 1001 AND status = 1`，然后在
            `created_at` 上做范围扫描。
            
- `ORDER BY created_at DESC`
            直接利用索引的有序性（反向扫描），无需 filesort。
            
- `SELECT`
            的所有列（`order_id, amount, created_at`）都在索引中，不需要回表。
            
- 预估扫描行数从 5000 降到 150。
            
            

### 10.2 Index Merge

            

索引合并（Index Merge）是 MySQL
            优化器在某些场景下使用多个索引的策略。有三种类型：
            
```
-- 1. Index Merge Intersect（交集）
-- 适用于 AND 连接的多个索引条件
EXPLAIN SELECT * FROM orders
WHERE user_id = 1001 AND status = 1;
-- type: index_merge
-- key: idx_user_id,idx_status
-- Extra: Using intersect(idx_user_id,idx_status); Using where

-- 2. Index Merge Union（并集）
-- 适用于 OR 连接的多个索引条件
EXPLAIN SELECT * FROM orders
WHERE user_id = 1001 OR status = 3;
-- type: index_merge
-- key: idx_user_id,idx_status
-- Extra: Using union(idx_user_id,idx_status); Using where

-- 3. Index Merge Sort-Union（排序并集）
-- 适用于 OR 连接的范围条件
EXPLAIN SELECT * FROM orders
WHERE user_id  '2024-12-01';
-- type: index_merge
-- key: idx_user_id,idx_created_at
-- Extra: Using sort_union(idx_user_id,idx_created_at); Using where
```

            

如前所述，Index Merge
            通常意味着需要优化索引设计。但在某些场景下（特别是 OR
            条件），Index Merge Union
            可能是唯一可用的优化手段，因为复合索引无法加速 OR 条件。
            

### 10.3
            索引条件下推（Index Condition Pushdown）

            

索引条件下推（ICP，Index Condition Pushdown）是 MySQL 5.6
            引入的优化。在没有 ICP
            的情况下，存储引擎通过索引找到匹配的行后，将完整的行返回给
            Server 层，由 Server 层再做 WHERE 条件过滤。有了
            ICP，存储引擎在索引层就可以对 WHERE
            条件中能用索引列判断的条件做过滤，减少回表次数。
            
```
-- ICP 示例
CREATE INDEX idx_user_status ON orders (user_id, status);

-- 查询
EXPLAIN SELECT * FROM orders
WHERE user_id > 1000 AND user_id 
            

为什么 ICP 有效？因为复合索引
            `(user_id, status)`
            中，`user_id > 1000 AND user_id 
```
-- 将索引设为不可见
ALTER TABLE orders ALTER INDEX idx_status INVISIBLE;

-- 验证优化器是否还会使用它
EXPLAIN SELECT * FROM orders WHERE status = 1;
-- 此时不会使用 idx_status

-- 在业务低峰期观察一段时间：
-- - 如果没有慢查询出现 → 说明这个索引确实没用，可以安全删除
-- - 如果出现慢查询 → 立即恢复可见性
ALTER TABLE orders ALTER INDEX idx_status VISIBLE;

-- 确认安全后，删除索引
DROP INDEX idx_status ON orders;
```

            

不可见索引比直接删除索引安全得多：
            
            
- 恢复可见性是瞬间操作，不需要重建索引。
            
- 删除索引后恢复需要重建，对于大表可能需要数小时。
            
- 可以配合 `performance_schema`
            监控受影响的查询。
            
            
```
-- 通过 optimizer_switch 临时让优化器使用不可见索引
-- 用于在单个会话中测试索引效果
SET optimizer_switch = 'use_invisible_indexes=on';
EXPLAIN SELECT * FROM orders WHERE status = 1;
-- 此时会使用不可见索引 idx_status
SET optimizer_switch = 'use_invisible_indexes=off';
```

            

### 10.5 索引监控与维护

            
```
-- 查看索引使用情况（需要开启 performance_schema）
SELECT
    object_schema,
    object_name,
    index_name,
    count_read,
    count_write,
    count_fetch
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'mydb'
  AND object_name = 'orders'
ORDER BY count_read DESC;

-- count_read = 0 的索引可能是从未使用的"僵尸索引"，考虑删除

-- 查看索引大小
SELECT
    table_name,
    index_name,
    ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE database_name = 'mydb'
  AND table_name = 'orders'
  AND stat_name = 'size';

-- 查看索引碎片率
SELECT
    table_name,
    index_name,
    stat_value AS pages,
    ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE database_name = 'mydb'
  AND table_name = 'orders'
  AND stat_name = 'size';

-- 重建索引以消除碎片
ALTER TABLE orders ENGINE=InnoDB;
-- 或者针对单个索引（MySQL 8.0.12+）
ALTER TABLE orders ALTER INDEX idx_user_id VISIBLE;  -- 触发索引统计信息更新
ANALYZE TABLE orders;  -- 更新索引统计信息
```

            

### 10.6 常见索引陷阱

            
```
-- 陷阱 1：对索引列使用函数，导致索引失效
-- 错误写法：
SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- 正确写法：
SELECT * FROM orders
WHERE created_at >= '2024-01-01' AND created_at 
            
            

## 参考文献

            
            
- Graefe, G. (2011). “Modern B-Tree Techniques.”
            *Foundations and Trends in Databases*, 3(4),
            203–402.
            
- Guttman, A. (1984). “R-Trees: A Dynamic Index Structure
            for Spatial Searching.” *Proceedings of ACM SIGMOD*,
            47–57.
            
- Bloom, B. H. (1970). “Space/Time Trade-offs in Hash
            Coding with Allowable Errors.” *Communications of the
            ACM*, 13(7), 422–426.
            
- Fan, B., Andersen, D. G., Kaminsky, M., &
            Mitzenmacher, M. (2014). “Cuckoo Filter: Practically Better
            Than Bloom.” *Proceedings of ACM CoNEXT*, 75–88.
            
- Dillinger, P. C. & Walzer, S. (2021). “Ribbon
            Filter: Practically Smaller Than Bloom and Xor.” *arXiv
            preprint arXiv:2103.02515*.
            
- O’Neil, P. & Quass, D. (1997). “Improved Query
            Performance with Variant Indexes.” *Proceedings of ACM
            SIGMOD*, 38–49.
            
- Chamberlin, D. D. et al. (1981). “A History and
            Evaluation of System R.” *Communications of the ACM*,
            24(10), 632–646.
            
- MySQL 8.0 Reference Manual. “InnoDB Index Types.” https://dev.mysql.com/doc/refman/8.0/en/innodb-index-types.html
            
- MySQL 8.0 Reference Manual. “Invisible Indexes.” https://dev.mysql.com/doc/refman/8.0/en/invisible-indexes.html
            
- Elasticsearch Reference. “Mapping.” https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html
            
- Apache Lucene Documentation. “Index File Formats.” https://lucene.apache.org/core/9_0_0/core/org/apache/lucene/codecs/lucene90/package-summary.html
            
- PostGIS Documentation. “Spatial Indexing.” https://postgis.net/docs/using_postgis_dbmanagement.html#idm2269
            
- ClickHouse Documentation. “Data Skipping Indexes.” https://clickhouse.com/docs/en/optimize/skipping-indexes
            
- Apache Parquet Format Specification. https://parquet.apache.org/documentation/latest/
            
- Apache ORC Specification. https://orc.apache.org/specification/
            
            
            

**上一篇**: 事务隔离级别的存储实现
            **下一篇**: Bitcask
            与日志结构哈希表
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。
                

                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】索引与跳数索引

                    

ClickHouse PRIMARY KEY 排序键稀疏索引语义、Data Skipping Index（minmax/set/bloom_filter）与 Mark Range 协同；对照 PostgreSQL B-Tree。24.x LTS。
                

                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。
                

                
                    

2025-10-16 · storage
                    

### 【存储工程】读取性能优化

                    

深入分析存储读取性能优化——索引设计、Bloom Filter 调优、块缓存、压缩的 CPU-I/O 权衡、预读策略与读放大测量