# MongoDB 官方文档学习笔记 (Server Manual)

> 来源: https://www.mongodb.com/docs/manual/ (MongoDB Inc., current version)
> 本地缓存: 
>   - HTML: `/home/obsidian/postgres/learn/mongodb-docs-manual/` (81 files, 711 KB)
>   - Markdown: `/home/obsidian/postgres/learn/mongodb-docs-manual-md/` (45 files, 597 KB)
> 总 sitemap: 1592 URLs (本笔记精选 ~45 篇核心页面)
> 笔记生成日期: 2026-08-20

---

## 文档结构 (29 个 sections)

```
Manual (1592 URLs)
├── introduction/                 ← 概述
├── installation/                ← 安装
├── data-modeling/               ← 数据建模 (37 URLs)
├── crud/                        ← CRUD 入门 (1 landing)
├── tutorial/                  ← 入门教程 (307 URLs)
├── core/                        ← **核心概念** (589 URLs - 文档主战场)
│   ├── crud/                    ← CRUD 操作
│   ├── aggregation-pipeline/    ← 聚合框架
│   ├── indexes/ index-types/    ← 索引体系
│   ├── replica-set-*/           ← 副本集
│   ├── sharded-cluster-*/       ← 分片集群
│   ├── sharding-*/              ← 分片策略
│   ├── transactions/            ← 多文档事务
│   ├── change-streams/          ← Change Streams
│   ├── storage/                 ← 存储引擎
│   ├── security-*/              ← 安全
│   ├── authentication/          ← 认证
│   ├── authorization/           ← 授权
│   └── write-operations-/       ← 写入语义
├── reference/                   ← **API 参考** (938 URLs)
│   ├── operator/                ← 操作符 (大量)
│   ├── command/                 ← 命令
│   ├── method/                  ← Shell 方法
│   ├── connection-string/       ← 连接字符串
│   └── ...
├── administration/              ← 运维 (47 URLs)
├── release-notes/               ← 发布说明 (44 URLs)
├── changeStreams/               ← Change Streams landing
├── troubleshooting/             ← 故障排查 (8 URLs)
└── ... (其余 5 sections)
```

**重要发现**: MongoDB 文档为 AI agent 提供:
- `https://www.mongodb.com/docs/llms.txt` — 完整文档目录索引
- 多数顶层 + 部分深层页面支持 `.md` 后缀直接返回 markdown

---

## 一、What is MongoDB? (manual.md)

**官方定义:** MongoDB 是一个 **文档数据库**, 设计目标是让开发者构建现代应用更快. 数据以 **JSON-like 文档** (BSON) 存储, schema 灵活, 可随应用演进无停机.

**支持的负载类型:**
- OLTP (基于文档的结构化搜索)
- 数据聚合
- 全文搜索
- 向量搜索
- 地理空间搜索
- 时序数据

**核心架构 4 件套:**
1. **Document Database** — 文档数据模型, 直接映射应用对象
2. **Transactions** — 多文档 ACID 事务, 4.0+ 支持
3. **High Availability** — 复制 + 自动故障转移
4. **Horizontal Scaling** — 分片 (Sharding) 原生支持

**文档示例 (BSON 文档):**
```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  name: "Alice",
  birthdate: ISODate("1990-01-01T00:00:00Z"),
  address: {            // 嵌套文档
    street: "123 Main St",
    city: "Springfield",
    state: "IL"
  },
  hobbies: ["reading", "hiking", "coding"]  // 数组
}
```

**文档模型优势:**
- 文档对应编程语言原生类型
- 嵌入文档和数组 **避免昂贵的 join**
- 动态 schema 支持多态 (同集合内不同文档可有不同字段)

**MongoDB 存储层级:** Documents → Collections (类似 SQL 表) → Databases. Collections 不强制固定 schema. 还支持只读 Views.

---

## 二、Data Modeling (manual__data-modeling.md)

### 核心原则
> **"Data that's accessed together should be stored together."**
> — 应根据应用的**数据访问模式**建模, 而非按规范化规则.

### 灵活性来源
- 同 collection 内文档不必有相同字段集
- 字段数据类型可在文档间不同
- = 多态 (polymorphic data)

### 三种关系建模
| 关系 | 例子 |
|---|---|
| 一对一 | 患者 → 病历 |
| 一对多 | 用户 → 多条帖子/评论 |
| 多对多 | 学生 ↔ 课程 (双向) |

### 两种数据链接方式
- **Embedding (嵌入):** 子文档直接嵌套进父文档, 单查询获取
- **Referencing (引用):** 用主键 (`_id` 或业务键) 关联, 类似 FK, 需要 $lookup

### 关系建模 vs 关系数据库

| RDBMS | MongoDB |
|---|---|
| 必须先定 schema, 修改代价高 | schema 灵活, 改字段无停机 |
| 多表 join 是常态 | 嵌入避免 join, 提升性能 |
| 严格事务保证一致性 | 单文档原子, 多文档需事务 |

### 何时用嵌入 vs 引用

**嵌入适用:**
- 子文档与父文档**总是一起访问** (e.g. 用户的收货地址)
- 子文档**数量有限** (避免 16MB 单文档上限)
- 数据**生命周期相同** (父删子也删)

**引用适用:**
- 子文档**频繁独立访问** (e.g. 商品的多条评论, 老评论独立分页)
- 多对多关系
- 数据**生命周期不同**

---

## 三、CRUD Operations (manual__crud.md + tutorial/*)

### 基本 CRUD

| 操作 | MongoDB | 备注 |
|---|---|---|
| Insert | `db.coll.insertOne(doc)` / `insertMany([...])` | 单文档天然原子 |
| Read | `db.coll.find(filter)` / `findOne(filter)` | filter = BSON 文档 |
| Update | `db.coll.updateOne(filter, update)` | update 操作符: `$set, $inc, $push` |
| Delete | `db.coll.deleteOne(filter)` / `deleteMany(filter)` | |

### update 操作符 (常用)
- `$set`: 设置字段值
- `$inc`: 数值递增
- `$push`: 数组追加元素
- `$pull`: 数组移除匹配元素
- `$addToSet`: 数组去重添加
- `$upsert: true`: 不存在则插入

### Bulk Write 优势
- **一次往返**, 减少网络
- **顺序执行**但有 `ordered: false` 选项让无序 (并行)
- 单次最多 100,000 ops

---

## 四、Aggregation Pipeline (manual__aggregation.md)

> **Aggregation pipeline = MongoDB 的报表查询系统**, 是 MongoDB 最强大的功能之一.

### Pipeline 组成
```javascript
db.collection.aggregate([
  { stage1 },
  { stage2 },
  ...
])
```
- 一个 pipeline 由**多个 stage 组成**, 每个 stage 处理上游 stage 输出的文档
- stage 可以 `$filter` / `$group` / 计算值
- 默认 **不修改**集合 (除非有 `$merge` 或 `$out` stage)

### 完整示例: Top 3 导演
```javascript
db.movies.aggregate([
  { $match: { 
      directors: { $exists: true, $ne: null, $not: { $size: 0 } } 
  }},
  { $unwind: "$directors" },
  { $group: {
      _id: "$directors",
      movieCount: { $sum: 1 }
  }},
  { $sort: { movieCount: -1 } },
  { $limit: 3 }
])
// → [Woody Allen: 40, Martin Scorsese: 32, Takashi Miike: 31]
```

### 常用 stages
| Stage | 作用 |
|---|---|
| `$match` | 过滤 (放越早越优化, 可下推到索引) |
| `$project` | 重塑输出, 选字段 |
| `$group` | 分组聚合 (`_id` 为分组键, `null` = 不分组) |
| `$sort` | 排序 |
| `$limit` / `$skip` | 分页 |
| `$unwind` | 数组展开 |
| `$lookup` | 类似 SQL JOIN |
| `$bucket` / `$bucketAuto` | 分桶 |
| `$facet` | 多个子 pipeline 并行 |
| `$graphLookup` | 图遍历 (递归 $lookup) |
| `$out` / `$merge` | 把结果写回集合 |

### Single Purpose Aggregation Methods
- `db.collection.estimatedDocumentCount()` — 估算集合文档数 (快, 用元数据)
- `db.collection.count(filter)` — 按 filter 精确计数
- `db.collection.distinct(field)` — 取字段所有不同值

### 优化 (manual__core__aggregation-pipeline-optimization.md)

**关键优化点:**
1. **`$match` + `$sort` 下推到索引:** 如果 `$match` 在被索引字段上, 优化器会用索引避免扫表
2. **`$project` 早做:** 减少下游 stage 处理的数据量
3. **`$limit` + `$sort` 顺序优化:** `$sort` 在 `$limit` 之前时, 优化器会用 top-K 索引避免全排序
4. **`$group` 用 `$project` 预减字段:** 减少分组时处理的字段
5. **避免 `$lookup`:** join 性能差, 优先考虑嵌入模型
6. **允许使用磁盘:** `db.collection.aggregate([], { allowDiskUse: true })` 解决内存不够

### Pipeline 限制 (manual__core__aggregation-pipeline-limits.md)

- 单个 stage 内存限制: **100 MB** (默认)
- `$group` / `$sort` 超过 100MB → 报错或 `allowDiskUse: true`
- 文档大小: 16 MB (BSON 限制)
- Pipeline 嵌套层数: 不限, 但 stage 总数有限

---

## 五、Indexes (manual__indexes.md + core/index-*.md)

### 索引基础

**数据结构:** **B-tree** (与 PG 同构).
**作用:** 避免 COLLSCAN (collection scan), 用索引快速定位.

**默认索引:** `_id` 上自动建 unique 索引, 不可删.

**索引名:** `{key1_direction1_key2_direction2}` 拼接, 如 `item_1_quantity_-1`.

### 索引类型 (5 大类)

| 类型 | 文档 | 适用场景 |
|---|---|---|
| **Single Field** | 单字段索引 | 高频查单字段 (HR 按员工 ID) |
| **Compound** | 复合索引 (多字段) | 多字段组合查 (按 item + quantity) |
| **Multikey** | 数组字段索引 | 数组字段查询 (e.g. tags) |
| **Geospatial** | 2dsphere/2d | 地理坐标查询 |
| **Text** | 全文索引 | 全文搜索 |
| **Hashed** | 哈希索引 | 仅等值查询 + 分片键 |

### 索引特性 (Properties)

| 特性 | 说明 |
|---|---|
| **Unique** | 字段值唯一, 重复 insert 报错 (e.g. `_id`) |
| **TTL** | 文档过期时间, 自动删除 (e.g. session 数据) |
| **Sparse** | 只索引有该字段的文档, 节省空间 |
| **Partial** | 只索引满足 filter 的文档 (e.g. `status: "active"`), 节省空间 |
| **Case-Insensitive** | collation 设为 `strength: 1` 或 `2`, 大小写不敏感 |
| **Hidden** | 对查询规划器不可见, 但仍维护, 用于测试删除影响 |

### 索引决策 (与 PG 对比)

| 场景 | MongoDB | PostgreSQL |
|---|---|---|
| 单字段等值 | Single Field | B-Tree |
| 多字段组合 | Compound | 复合 B-Tree |
| 数组字段 | Multikey (天然支持) | GIN |
| 全文 | Text Index | GIN |
| 地理 | 2dsphere | GiST |
| 等值分片键 | Hashed | Hash (PG 10+) |
| 大表时序 | (用 TTL + Compound) | BRIN |
| 多列任意过滤 | (无对应) | Bloom |
| "像什么" 搜索 | (无对应, 用 $expr) | GiST |

### 索引构建性能
- **前台构建** (默认): 阻塞读写, 大集合慢
- **后台构建** (`background: true`): 不阻塞但慢, MongoDB 4.2+ 已默认 hybrid
- **副本集滚动:** 在 secondary 上建 → stepDown → 再在原 primary 建
- 大集合建索引可能用 `db.collection.createIndex()` 几小时

### 索引选择 ESR 原则
**E**quality → **S**ort → **R**ange: 复合索引字段顺序遵循 ESR 规则最优.

---

## 六、Replication (manual__replication.md + core/replica-set-*.md)

### 副本集基础

**定义:** 副本集是**一组 `mongod` 进程**, 维护相同数据集, 提供**冗余和高可用**.

**成员类型:**
| 成员 | 职责 |
|---|---|
| **Primary** | 接收所有写操作, 记录到 oplog |
| **Secondary** | 从 primary 复制 oplog 并应用, 持有完整数据集 |
| **Arbiter** | 仅参与选举, **不持有数据** (不提供冗余) |
| **Hidden** | 客户端不可见, 用于备份/报表 |
| **Delayed** | 应用 oplog 延迟 N 小时 (防误操作恢复) |
| **Priority 0** | 永不成为 primary |

**最小推荐配置:** 3 个数据承载成员 (1 primary + 2 secondary). 成本约束可用 1 primary + 1 secondary + 1 arbiter.

**最大配置:** 50 成员, 但**只有 7 个有投票权**.

### 异步复制机制

- Secondary 从 Primary 拉 oplog (异步)
- 因此读 secondary 可能返回**滞后数据**
- 慢操作监控: secondary 日志中 `applied op: <oplog> took <N>ms`

**Replication Lag (复制延迟):**
- 主备延迟 = primary 操作时间 vs secondary 应用时间差
- 滞后增加会引发 **primary 端缓存压力** (因为 secondary 同步跟不上, primary 缓存里 oplog 堆积)
- **Flow Control 机制:** primary 自动限制写速率, 保持 `majority committed` 延迟 ≤ `flowControlTargetLagSeconds` (默认 10s)
- 通过 "tickets" 限流: primary 写之前必须获得 ticket

### 自动故障转移

- **触发条件:** primary 与其他成员 `electionTimeoutMillis` (默认 10000ms = 10s) 无通信
- **中位恢复时间:** ≤ 12 秒 (标记 unavailable + 选举)
- **降低 `electionTimeoutMillis`:** 加快故障检测, 但**网络抖动会触发误选**, 增加 rollback 风险
- **应用层容忍:** 驱动支持 **retryable writes** (默认开启), 自动重试一次

**Rollback (回滚):**
- 当 old primary 未察觉自己 demotion, 继续接受写 (writeConcern `w:1` 的)
- 新 primary 选举后, 这些写会被 **回滚**
- 应用层需容忍这种场景

### 读操作 (Read Preference)

**5 种 read preference:**
- `primary` (默认): 只读 primary, 一致性最强
- `primaryPreferred`: 优先 primary, 不行读 secondary
- `secondary`: 只读 secondary, 适合报表
- `secondaryPreferred`: 优先 secondary
- `nearest`: 网络最近, 不论 primary/secondary

**事务必须用 primary:** 因为事务要保证一致性快照.

### 数据可见性 (按 readConcern 区分)

| readConcern | 行为 |
|---|---|
| `"local"` | 看到本地节点最新数据, **可能后续被 rollback** |
| `"available"` | 同 local, 主要用于分片 |
| `"majority"` | 只看到多数派已确认的数据, **不会被 rollback** |
| `"snapshot"` | 事务内的快照读 (RR 级别) |
| `"linearizable"` | 严格线性, 读到全局最新已确认数据 |

### Mirrored Reads (8.2+ 重要特性)

**问题:** failover 后新 primary 缓存冷, 性能骤降.
**解决:** primary 把一部分读操作 **镜像** 到 electable secondary, 预热它们的缓存.
- 默认 `samplingRate = 0.01` (1% 的可镜像读)
- "Fire-and-forget": primary 不等响应
- 支持操作: `count, distinct, find, findAndModify (filter), update (filter)`
- 8.2+ 支持 **targeted mirrored reads** — 可定向到隐藏节点

### Retryable Writes
- 兼容驱动默认开启
- 单次自动重试 (针对 `TransientTransactionError` 和 `UnknownTransactionCommitResult`)
- 配合 mirror reads, failover 几乎无感

---

## 七、Sharding (manual__sharding.md + core/sharding-*.md)

### 为什么需要 Sharding

**两大扩展方法:**
- **垂直扩展:** 单机升级 CPU/RAM/存储, 受硬件上限限制
- **水平扩展:** 多机器分摊数据和负载, 成本可控但复杂度高

**Sharding = MongoDB 的水平扩展方案.**

### Sharded Cluster 组件

```
┌─────────────────────────────────────────────────┐
│ Client Apps                                      │
└─────────────────┬───────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────┐
│  mongos (路由)                                   │
│  提供 client ↔ cluster 接口                      │
└─────────────────┬───────────────────────────────┘
                  ↓
┌──────────────┬──────────────┬─────────────────┐
│  Shard 1     │  Shard 2     │  Shard 3        │
│  (RS)        │  (RS)        │  (RS)           │
└──────────────┴──────────────┴─────────────────┘
┌─────────────────────────────────────────────────┐
│  Config Servers (CSRS — 也是副本集)               │
│  存储: chunk 分布, shard 配置, 元数据             │
└─────────────────────────────────────────────────┘
```

**关键约束:**
- **每个 shard 必须是副本集** (不能是单 mongod)
- **Config Servers 必须是副本集** (CSRS — Config Server Replica Set)
- **Client 永远只连 mongos**, 不能直接连 shard (8.0+ 直接连 shard 会报错)

### Shard Key (分片键)

**作用:** 决定文档如何分布到各 shard. 创建分片 collection 时**必须**指定 shard key.

**字段缺失处理:** 分片键字段缺失的文档视为 null 值 (分布时), 但查询路由时不视为 null. 需要用 `setMissingShardKeyFields` 配置.

**Shard Key Index:** 分片前必须有索引以分片键**前缀**开头的索引 (空 collection 自动建).

**Shard Key 变更:**
- 5.0+ 支持 **reshard a collection** (改分片键)
- 可以 **refine a shard key** (添加后缀字段)
- 单个文档的 shard key value 可以更新 (除非是 `_id`)

### 两种分片策略

#### Hashed Sharding (哈希分片)

```javascript
sh.shardCollection("db.coll", { _id: "hashed" })
```
- 计算分片键字段的哈希值
- **优点:** 数据均匀分布, 适合单调递增字段 (如时间戳/ObjectId)
- **缺点:** 基于范围的查询可能广播到所有 shard (scatter/gather)

#### Ranged Sharding (范围分片)

```javascript
sh.shardCollection("db.coll", { userId: 1 })
```
- 按分片键值**连续范围**分片
- **优点:** 范围查询可定位到具体 shard (**targeted operation**), 效率高
- **缺点:** 单调键会导致数据倾斜 (e.g. 最新数据都进一个 shard)

**选择依据:**
- 单调键 / 均匀分布需求 → hashed
- 范围查询为主 / 避免广播 → ranged
- 不知道 → 用 hashed 更安全

### Chunks & Balancer

**Chunk:** 分片数据的基本单位, 一个 chunk = 一段**连续的分片键值范围** `[lower, upper)`.

**Balancer:** 后台进程, 自动迁移 chunks 让各 shard 数据均匀.
- 单 shard 一次只参与一个 chunk 迁移
- 复制慢, 资源密集
- **shardAndDistributeCollection (8.0+):** 把 shardCollection + reshardCollection 合一, 不等 balancer 自动均匀

**Resharding:** MongoDB 5.0+ 支持改分片键. 8.0+ 支持 reshard to same key.

### Zones (区域分片)

**作用:** 让特定 shard key 范围的 chunk **只分布到特定 shard**. 用于:
- 地理就近 (中国用户数据放中国 shard)
- 数据本地化
- 隔离热/冷数据

**约束:** Zone 范围必须用**分片键前缀** (compound shard key 也要前缀).

**Tip:** 分片前先设 zones, 比分片后再加更高效.

### 8.0+ 新特性

- `shardAndDistributeCollection` — 一次性 shard + reshard
- `directShardOperations` 角色 — 绕过 mongos 直连 shard (仅维护)
- 所有 DDL 必须通过 mongos (8.3+)
- 集群必须有 `CWWC` (Cluster Wide Write Concern) 才能启 shard

---

## 八、Transactions (manual__core__transactions.md)

### 何时需要事务

> **"An operation on a single document is atomic."**
> — 单文档操作天然原子, 多文档事务只在必要时使用.

**MongoDB 推荐:** 用嵌入文档/数组建模, 让"一起访问的数据在一起", 这样**单文档原子性就够了**.

**真的需要事务的场景:**
- 多文档必须原子 (e.g. 转账: 账户 A 减, 账户 B 加)
- 跨 collection / database / shard 的复杂操作

### 事务 API

**两种 API:**
1. **Callback API** (`session.with_transaction(callback)`) — 自动重试
2. **Core API** (`session.startTransaction()` + `commitTransaction()`) — 手动控制

**Callback API 自动重试:**
- `TransientTransactionError` — 可重试
- `UnknownTransactionCommitResult` — 提交结果未知, 可重试确认

**Callback API 不重试 (6.2+/8.1+):**
- `TransactionTooLargeForCache` (6.2+) — 事务太大, 不能放缓存, 不重试
- 多文档事务内 `upsert` 遇 duplicate key (8.1+) — 不重试

### 事务约束

**必须在副本集/分片集群上** (单 mongod 不支持). 关键约束:
- 事务内每个操作必须**传 session**
- 事务级 readConcern / writeConcern / readPreference
- 事务内可隐式或显式建 collection/index
- 跨 shard 事务在 commit 后, `readConcern: local` 可能短暂看到不完整状态

### 默认事务设置

| 默认值 | | 说明 |
|---|---|---|
| readConcern | `"snapshot"` | 事务内快照读, 类似 PG RR |
| writeConcern | `"majority"` | 多数派确认 |
| readPreference | `primary` | 事务必走 primary |

### 生产注意事项 (manual__core__transactions-production-consideration.md)

- 事务**有时间限制** (默认 60s, 配置 `transactionLifetimeLimitSeconds`)
- 事务有**内存限制** (100MB transaction snapshot, 默认 `transactionMaxSnapshots`)
- **Oplog 大小限制:** 事务会写一个 oplog entry, 大事务会让 secondary 同步慢
- 不要在事务内做慢操作 (e.g. 网络调用)
- **abort 优先于 commit:** 业务失败时显式 abort

### Sharded Cluster 事务 (manual__core__transactions-sharded-clusters.md)

- **两阶段提交:** coordinator 节点协调所有参与 shard
- coordinator 配置: `config.transactionCommitLifetimeLimitSeconds`
- 单 shard 故障: 事务自动 abort
- 网络分区: 取决于多数派可用性
- 8.0+ 引入了 **snapshot read concern** 的优化

---

## 九、Change Streams (manual__changeStreams.md)

**定义:** Change streams 允许应用**订阅** collection/database/deployment 上的实时数据变更, **无需 tailing oplog**.

**可用范围:** Replica Sets 和 Sharded Clusters, **单 mongod 不支持**.

### API

```javascript
const changeStream = db.coll.watch();
// 或
const changeStream = db.coll.watch([{ $match: { operationType: "insert" } }]);

changeStream.on("change", next => {
  console.log(next);
});
```

### 变更事件类型 (operationType)

| 类型 | 说明 |
|---|---|
| `insert` | 新文档插入 |
| `update` | 文档更新 (含 `updateDescription`) |
| `replace` | 完整替换 |
| `delete` | 删除 |
| `drop` | collection 删除 |
| `rename` | collection 重命名 |
| `dropDatabase` | database 删除 |
| `invalidate` | cursor 失效 (需要重新 watch) |

### 关键参数

- `resumeToken`: 断点续传令牌, 持久化后可恢复
- `fullDocument: "updateLookup"`: update 事件返回完整文档 (而非只 diff)
- `maxAwaitTimeMS`: 长轮询等待时间
- `startAtOperationTime`: 从某个时间点开始

### 过滤

**pipeline 形式** (聚合管道风格):
```javascript
db.coll.watch([
  { $match: { 
      "fullDocument.status": "active",
      operationType: { $in: ["insert", "update"] }
  }}
])
```

---

## 十、Storage Engines (manual__core__wiredtiger.md + core/storage-engines.md)

### WiredTiger (默认, 3.2+)

**核心特性:**
- **文档级并发控制 (MVCC):** 写不阻塞读, 读不阻塞写
- **压缩:** 可选 snappy / zlib / zstd 压缩
- **Checkpoint:** 内部 checkpoint 机制, 配合 fsync
- **缓存:** 默认 `(RAM - 1GB) / 2` (e.g. 16GB RAM → 7.5GB cache)

**关键配置:**
- `storage.wiredTiger.engineConfig.cacheSizeGB` — 引擎缓存大小
- `storage.wiredTiger.collectionConfig.blockCompressor` — 压缩算法
- `storage.wiredTiger.collectionConfig.prefixCompression` — 前缀压缩

⚠️ **不要让 cache 太大, 否则 OOM.** 经验值 RAM 50%.

### MMAPv1 (已弃用, 4.0 移除)
- 老版本默认引擎
- collection 级锁, 性能差, 不再支持

### In-Memory (企业版)
- 数据全在内存
- 不写盘, **不能持久化**, 重启丢数据

---

## 十一、Security (manual__security.md + core/security-*.md)

### 认证 Authentication

**支持的机制:**
| 机制 | 说明 |
|---|---|
| **SCRAM** (默认) | SASL 框架, 密码本地哈希, 推荐 |
| **x.509** | 客户端证书, 用于内部服务通信 |
| **LDAP** | 外部 LDAP (企业版) |
| **Kerberos** | 企业版 |
| **Internal** | 集群内部认证 (成员之间) |

**启用认证:**
```javascript
// 启动时
mongod --auth

// 或创建管理员用户后重启
db.createUser({
  user: "admin",
  pwd: "secret",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }]
})
```

### 授权 Authorization

**角色 (Role-Based Access Control, RBAC):**

**内置角色:**
- `read`, `readWrite` — collection 级
- `dbAdmin`, `dbOwner` — DB 级
- `userAdmin`, `clusterAdmin` — 管理类
- `root` — 最高权限
- `__system` — 内部角色

**用户自定义角色:** 可基于现有角色 + 限制的资源/操作创建.

### 加密 (Encryption)

**3 个层面:**
1. **传输加密** (Transport / TLS): 客户端 ↔ 服务器, 加密网络流量
2. **静态加密** (Encryption at Rest): 磁盘上的数据, 通过 storage engine 配置
3. **使用中加密** (Queryable Encryption / In-Use Encryption): **运行时内存加密**, 7.0+ GA, 性能开销大但安全最强

**Queryable Encryption (7.0+ 重要特性):**
- 加密字段在数据库中**始终加密**
- 服务器只能看到密文
- 客户端持有解密密钥
- 支持等值/范围/前缀查询 (服务端代为查询)

### 安全加固 (Hardening)

**官方推荐 checklist:**
1. 启用认证 (`--auth` 或 `security.authorization: enabled`)
2. 限制网络绑定 (`bindIp`)
3. 启用 TLS (`net.tls.mode: requireTLS`)
4. 加密静态数据 (filesystem-level 或 Queryable Encryption)
5. 用 SCRAM 而非 MONGODB-CR (3.0+ 默认)
6. 启用审计 (Audit Log, 企业版)
7. 定期轮转密钥
8. 限制 superuser 数量

---

## 十二、Performance & Operations (manual__administration__*.md)

### 分析 MongoDB 性能

**诊断命令:**
```javascript
db.serverStatus()              // 全局状态
db.stats()                     // 当前 DB 统计
db.coll.stats()                // collection 统计
db.currentOp()                 // 当前操作
db.killOp(opid)                // 终止操作
db.setProfilingLevel(2)        // 开启 profiling
db.system.profile.find().sort({ts:-1}).limit(10)
```

**关键指标:**
- `opcounters` — 读写 QPS
- `connections.current` / `available` / `totalCreated`
- `wiredTiger.cache.maximum_bytes_configured` / `bytes_currently_in_cache`
- `mem.bits` / `mem.resident` — 内存
- `metrics.repl` — 复制状态

### 生产配置建议

**config 文件关键设置:**
```yaml
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 7  # RAM 50%
    collectionConfig:
      blockCompressor: snappy

net:
  port: 27017
  bindIp: 0.0.0.0

security:
  authorization: enabled

systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
  verbosity: 0  # 默认 0, 调试时 1-2

replication:
  replSetName: rs0

processManagement:
  fork: true
  pidFilePath: /var/run/mongodb/mongod.pid
```

**常见性能调优点:**
1. **索引缺失:** `explain()` 看 COLLSCAN, 加索引
2. **索引未用:** 复合索引字段顺序不对 (ESR 原则)
3. **内存不够:** WiredTiger cache 命中率低 (`wiredTiger.cache.bytes_read_into_cache`)
4. **磁盘 IO 慢:** 检查 `metrics.io` + 用 SSD
5. **连接数过多:** 用连接池, 减少 `connections.current`
6. **事务大:** 单事务 < 100MB 快照, < 60s 时间
7. **聚合慢:** pipeline 加 `$match` 早过滤 + `$project` 减字段 + `allowDiskUse`

---

## 十三、Cross-Cutting Concepts

### 数据可见性 (Read Concern) 完整对照

| readConcern | 何时用 |
|---|---|
| `"local"` | 单节点, 默认. 可能看到未 rollback 数据 |
| `"available"` | 分片集群, 类似 local |
| `"majority"` | 防 rollback, 默认事务. 多数派已确认数据 |
| `"snapshot"` | 事务内快照, 类似 PG RR |
| `"linearizable"` | 严格线性读, 读到全局最新已确认 (慢) |

### Write Concern 完整对照

| writeConcern | 行为 | 性能 | 持久性 |
|---|---|---|---|
| `{w: 0}` | 不等确认 | 最快 | 丢数据 |
| `{w: 1}` | 等 primary 确认 | 快 | primary 故障可能丢 |
| `{w: "majority"}` | 等多数派 | 慢 | **强持久** |
| `{j: true}` | 等 journal 刷盘 | 更慢 | 持久 |
| `{wtimeout: 1000}` | 1s 超时 | — | 超时报错 |

**生产推荐:** `{w: "majority", j: true, wtimeout: 5000}` (默认 5s 超时)

---

## 十四、MongoDB vs PostgreSQL 完整对照 (我的 PG 背景)

| 概念 | MongoDB | PostgreSQL |
|---|---|---|
| 数据模型 | BSON 文档 (嵌套 + 数组) | 关系表 (行 + 列) |
| Schema | 动态, 同 collection 可不同 | 严格, DDL |
| 主键 | `_id` 自动 ObjectId (12B) | 用户定义 SERIAL/UUID |
| 查询 | MQL (类 JS) + 聚合管道 | SQL |
| 关系建模 | 嵌入 (优先) + 引用 ($lookup) | FK + JOIN |
| 多文档事务 | 4.0+ 副本集/分片 | 原生全场景 |
| 隔离级别 | readConcern 5 级 | RR/RC/SERIALIZABLE 3 级 |
| 写持久 | writeConcern + journal | WAL + synchronous_commit |
| 复制 | 副本集 (单层) | 流复制 (单层) + 逻辑复制 |
| 分片 | mongos 路由 + config 副本集 + N shard RS | Citus / 应用层 |
| 默认存储 | WiredTiger (MVCC + 压缩) | Heap + WAL (MVCC) |
| 索引 | B-tree + 多字段 + 多键 + 文本 + geo | B-tree + GIN/GiST/SP-GiST/BRIN/Bloom/Hash |
| 加密 | TLS + at-rest + Queryable (7.0+) | TLS + at-rest (pgcrypto) |
| HA 故障转移 | 自动 (replSet 选举 ≤12s) | 需要外部工具 (Patroni/RepMgr) |
| 嵌入式计算 | 聚合管道 + $function | PL/pgSQL + FDW |

---

## 十五、与之前 MongoDB 极客时间课 (geektime-mongodb-course) 知识交叉

| 维度 | 极客时间课程 (实战) | 官方文档 (理论) |
|---|---|---|
| 复制集 | rs.initiate 一行命令 | 完整副本集理论 (oplog, 选举, rollback, mirror reads) |
| 事务 | snapshot 读隔离 + 写冲突 + 写等待 3 个实验 | 完整 API (callback/core), 默认设置, 生产限制 |
| 聚合 | 5 个实验 (总销量/Q1/月份/地区 top1/SKU) | 完整 pipeline 优化, $lookup/$facet/$graphLookup |
| 分片 | 6 机拓扑手搭 (shard1/config/mongos + shard2) | 完整组件 + 策略选择 (hashed vs ranged) + zones |
| Spark Connector | Java demo | (不在官方手册中, 在 drivers/) |

**互补结论:** 极客时间课是**实战入门**, 官方文档是**理论权威**. 两者合在一起 = MongoDB 完整图景.

---

## 十六、推荐学习路径 (基于本笔记)

如果想要深挖某个领域, 按以下顺序看官方文档:

1. **入门:** manual.md → manual__data-modeling.md → manual__crud.md
2. **聚合:** manual__aggregation.md → manual__core__aggregation-pipeline-optimization.md
3. **索引:** manual__indexes.md → core/index-{ttl,unique,sparse,partial}*.md
4. **复制:** manual__replication.md → core/replica-set-{elections,oplog,write-concern,sync,rollbacks}*.md
5. **分片:** manual__sharding.md → core/sharding-{shard-key,choose-a-shard-key,reshard-a-collection,troubleshooting-shard-keys}*.md
6. **事务:** manual__core__transactions.md → manual__core__transactions-{in-applications,production-consideration,sharded-clusters}.md
7. **Change Streams:** manual__changeStreams.md
8. **安全:** manual__security.md → core/{authentication,authorization,security-encryption-at-rest,security-transport-encryption}.md
9. **运维:** manual__administration/production-notes.md → manual__administration/analyzing-mongodb-performance.md