# MongoDB 极客时间课程学习笔记

> 来源: https://gitee.com/geektime-geekbang/geektime-mongodb-course
> GitHub 镜像: https://github.com/tapdata/geektime-mongodb-course
> 本地: `/home/obsidian/postgres/learn/mongodb/geektime-mongodb-course/`
> 共 4 章 PDF (lecture slides) + 6 个 lab 目录 + 1 个 Spark demo

---

## 课程结构

| 章节 | 主题 | PDF 大小 | lab 路径 |
|---|---|---|---|
| Ch.1 | MongoDB 入门 + Hello World | 11.7 MB | `helloworld/` |
| Ch.2 | 复制集 (Replica Set) | 0.7 MB | `replicaset/` |
| Ch.3 | 分片集群 (Sharded Cluster) | 16.4 MB | `sharded-cluster/`, `transaction/` |
| Ch.4 | 聚合框架 + Spark Connector | 22.3 MB | `aggregation/`, `spark-demo/` |

`aggregation/dump.tar.gz` (25 MB) 是 10 万条订单 + 订单行的测试数据。

---

## Chapter 1: Hello World (mongod + pymongo CRUD)

### 启动 mongod
```bash
mongod --dbpath /data --port 27017
```
最小化启动, 没有 auth、没有 replication、没有 sharding。

### 连接字符串
```
mongodb://127.0.0.1:27017/?minPoolSize=10&maxPoolSize=100
```
- `minPoolSize` / `maxPoolSize`: 驱动端连接池大小
- 注意: Python 3 中 `print` 是函数 (`print(x)`), 不是语句; 课程示例用的 Python 2 语法

### pymongo CRUD 三件套
```python
from pymongo import MongoClient
client = MongoClient(uri)
db = client["foo"]
coll = db["bar"]

# Insert
result = coll.insert_one({"string": "Hello World"})

# Find
doc = coll.find_one({"string": "Hello World"})
# 自动添加 _id 字段 (ObjectId)

# Update
coll.update_one({"string": "Hello World"}, {"$set": {"from": "Tom the cat"}})

# Delete
coll.delete_one({"string": "Hello World"})

client.close()
```

**关键点:** MongoDB 没有强 schema, 同一个集合里不同文档可以有不同的字段.
`_id` 是每个文档必填的 12-byte ObjectId (时间戳+机器+进程+计数器).

---

## Chapter 2: 复制集 (Replica Set)

### 三节点配置 (单机器模拟)
3 个 mongod 跑在同一台机器上, 用不同端口 + 数据目录 + 日志:

| Node | Port | Data dir | Log | replSet |
|---|---|---|---|---|
| node 0 | 28017 | /data1 | /data1/mongod.log | rs0 |
| node 1 | 28018 | /data2 | /data2/mongod.log | rs0 |
| node 2 | 28019 | /data3 | /data3/mongod.log | rs0 |

### mongod 配置文件 (YAML 格式)
```yaml
systemLog:
  destination: file
  path: /data1/mongod.log
  logAppend: true
storage:
  dbPath: /data1
net:
  bindIp: 0.0.0.0
  port: 28017
replication:
  replSetName: rs0
processManagement:
  fork: true   # Linux/Mac daemonize; Windows 不支持, 需要 3 个窗口
```

### 初始化
```javascript
rs.initiate({
    _id: "rs0",
    members: [
        {_id: 0, host: "localhost:28017"},
        {_id: 1, host: "localhost:28018"},
        {_id: 2, host: "localhost:28019"}
    ]
})
```

### 状态检查
`rs.status()` 输出每个 member 的:
- `stateStr`: PRIMARY / SECONDARY
- `optime` (timestamp + term): 最后应用的 oplog entry
- `syncingTo`: 同步源 (复制滞后时显示)
- `electionTime` / `electionDate`: 上次选举时间

`local` 数据库中 `oplog.rs` 是 oplog (固定大小 capped collection).

### 调整配置
```javascript
var conf = rs.conf()
conf.members[0].priority = 10;  // 优先级 0~1000, 数字越大越优先成为 primary
conf.members[1].hidden = true;  // 隐藏节点 (客户端不可读)
conf.members[1].priority = 0;   // hidden 必须 priority=0 (永不成为 primary)
rs.reconfig(conf);
```

---

## Chapter 3: 分片集群 (Sharded Cluster)

### 架构角色
- **mongos**: 路由进程, 客户端只连 mongos
- **config server**: 集群元数据 (chunk 分布、shard 配置), 本身是个副本集
- **shard**: 实际数据分片, 每个 shard 本身是个副本集

### 实验拓扑 (6 台机器)
| 机器 | 角色 |
|---|---|
| member1/member3/member5 | shard1 节点 + config 节点 |
| member2/member4/member6 | shard2 节点 + mongos 节点 |

启动命令 (以 shard1 节点为例):
```bash
mongod --bind_ip 0.0.0.0 --replSet shard1 \
       --dbpath /data/shard1 --logpath /data/shard1/mongod.log \
       --port 27010 --fork --shardsvr \
       --wiredTigerCacheSizeGB 1
```

**关键参数:**
- `--shardsvr` / `--configsvr`: 标识角色, 端口限制 (< 27010 / < 27019 之类的内部约定)
- `--wiredTigerCacheSizeGB`: WiredTiger 引擎缓存, 默认 `(RAM - 1GB) / 2`, **不要超过** (OOM 风险)

### mongos
```bash
mongos --bind_ip 0.0.0.0 --logpath /data/mongos/mongos.log \
       --port 27017 \
       --configdb config/member1.example.com:27019,member3.example.com:27019,member5.example.com:27019 \
       --fork
```

### 加入分片 + 创建分片表
```javascript
sh.addShard("shard1/member1.example.com:27010,member3.example.com:27010,member5.example.com:27010");

sh.enableSharding("foo");
sh.shardCollection("foo.bar", {_id: "hashed"});  // 哈希分片键
```

### 观察自动均衡
新增 `shard2` 后:
```
chunks:
  shard1  1
  shard2  1
```
原本在 shard1 的 2 个 chunk 自动迁移到 shard2 各 1 个. 这是 MongoDB 的 balancer 后台任务.

---

## Chapter 3.5: 事务 (多文档 ACID)

MongoDB 4.0+ 支持多文档事务, 但只能在 **副本集 / 分片集群** 上用 (单节点 mongod 不支持).

### 三个核心示例

**(1) 读隔离 (Snapshot Read):** session 内的读是 repeatable read
```javascript
var session = db.getMongo().startSession();
session.startTransaction({
    readConcern: {level: "snapshot"},
    writeConcern: {w: "majority"}
});
var coll = session.getDatabase('test').getCollection("readIsolation");

coll.updateOne({x: 1}, {$set: {y: 1}});            // session 内
coll.findOne({x: 1});                              // 看到 y:1
db.readIsolation.findOne({x: 1});                  // session 外, 看不到 y
session.abortTransaction();
```

**(2) 写冲突 (WriteConflict):** 两个事务改同一文档, 后者立即报错
```javascript
// 窗口 A
coll.updateOne({x: 1}, {$set: {y: 1}});  // 成功
// 窗口 B
coll.updateOne({x: 1}, {$set: {y: 2}});  // WriteConflict 错误
```

**(3) 写等待 (Write Wait):** 非事务的写会等待事务 commit/rollback
```javascript
// 窗口 A (事务内, 未 commit)
coll.updateOne({x: 1}, {$set: {y: 1}});
// 窗口 B (非事务)
db.writeWait.updateOne({x: 1}, {$set: {y: 2}});  // 阻塞
// 窗口 A commit 后, 窗口 B 才能继续
session.commitTransaction();
```

**核心概念:**
- `readConcern: snapshot` = 类似 PG 的 REPEATABLE READ
- `writeConcern: majority` = 多数派确认后才算写入成功
- `startSession() + startTransaction()` 是 4.0+ 的 API, 老版本用 `db.beginTransaction()`

---

## Chapter 4: 聚合框架 (Aggregation Framework)

测试数据: 10 万条订单 (2019-01-01 ~ 2019-10-31), 含 `userId`, `orderDate`,
`total`, `shippingFee`, `status` (`created|cancelled|shipping|fulfilled|completed`),
`orderLines` (数组, 含 `price/cost/qty/sku`).

导入: `mongorestore -h 127.0.0.1:27017 dump`

### 实验一: 总销售额 (无条件)
```javascript
db.orders.aggregate([
    { $group: { _id: null, total: { $sum: "$total" } } }
])
// { "_id": null, "total": NumberDecimal("44019609") }
```
`_id: null` = 不分组, 整个集合求和.

### 实验二: Q1 completed 订单的总金额+总运费+订单数
经典 `$match → $group → $project` 三段:
```javascript
db.orders.aggregate([
    { $match: {
        status: "completed",
        orderDate: { $gte: ISODate("2019-01-01"), $lt: ISODate("2019-04-01") }
    }},
    { $group: {
        _id: null,
        total:     { $sum: "$total" },
        shippingFee: { $sum: "$shippingFee" },
        count:     { $sum: 1 }
    }},
    { $project: {
        grandTotal: { $add: ["$total", "$shippingFee"] },
        count: 1, _id: 0
    }}
])
// { "count": 5875, "grandTotal": NumberDecimal("2636376.00") }
```
- `$match` 早过滤, 减少下游处理量 (优化关键)
- `$project` 重塑输出

### 实验三: 每月销售额 (前半年)
用 `$dateToString` 把日期转成 "2019年01月" 当分组键:
```javascript
{ $project: {
    month: { $dateToString: { date: "$orderDate", format: "%G年%m月" } },
    total: 1
}}
// %G=ISO 8601 year, %m=month
```

### 实验四: 每个州 Q1 销量 top1 SKU
经典 **窗口函数** 用聚合框架实现:
```javascript
db.orders.aggregate([
    { $match: { status: "completed", orderDate: { $gte, $lt } }},
    { $unwind: "$orderLines" },                     // 1. 拆订单行
    { $group: {                                    // 2. 按 (state, sku) 汇总
        _id: { state: "$state", sku: "$orderLines.sku" },
        count: { $sum: "$orderLines.qty" }
    }},
    { $sort: { "_id.state": 1, "count": -1 }},     // 3. 每个州内销量降序
    { $group: {                                    // 4. 每州取第一个 (top1)
        _id: "$_id.state",
        sku:   { $first: "$_id.sku" },
        count: { $first: "$count" }
    }}
])
```
**模式:** `$sort + $group by 上一级 + $first` = 模拟 row_number() over (partition by ... order by ...) = 1

### 实验五: Q1 各 SKU 总销量
最简管道: `$match → $unwind → $group → $sort`.

---

## Chapter 4 续: Spark Connector

### 技术栈
- mongo-java-driver 3.12.1
- mongo-spark-connector_2.11 **2.4.1** (注: 这个版本绑 Scala 2.11, 已经是 legacy)
- spark-core/spark-sql 2.4.5 (Scala 2.11)
- javafaker 1.0.1 (生成假数据)

### 流程 (SparkDemo.java)
```
mock() → 写 100k fake users → Spark 读 → SQL 计算 → 写回 Mongo
```

**`mock()`**: 用 javafaker 生成 `name/address/birthday/favouriteColor`, 每 100 条批量插入.

**`spartCompute()`**:
```java
SparkSession spark = SparkSession.builder().master("local")...getOrCreate();
JavaSparkContext jsc = new JavaSparkContext(spark.sparkContext());

ReadConfig rc = ReadConfig.create(jsc)
    .withOption("readPreference.name", "secondaryPreferred")  // 读从节点
    .withOption("collection", "User");

// 加载时跑 aggregation pipeline 提取 month 字段
List pipeline = Arrays.asList(
    addFields(new Field("month", new Document("$month", "$birthday")))
);
JavaMongoRDD<Document> rdd = MongoSpark.load(jsc, rc).withPipeline(pipeline);

Dataset<Row> ds = rdd.toDF();
ds.createOrReplaceTempView("User");

// SQL: 每个出生月销量 top1 颜色
Dataset<Row> result = spark.sql(
    "SELECT b.month AS _id, b.favouriteColor, b.qty " +
    "FROM ( " +
    "    SELECT a.*, ROW_NUMBER() OVER (PARTITION BY month ORDER BY qty desc) AS seq " +
    "    FROM ( " +
    "        SELECT month, favouriteColor, COUNT(1) AS qty " +
    "        FROM User GROUP BY month, favouriteColor" +
    "    ) AS a " +
    ") AS b " +
    "WHERE b.seq = 1 ORDER BY _id ASC"
);

WriteConfig wc = WriteConfig.create(jsc).withOption("writeConcern.w", "majority");
MongoSpark.save(result, wc);
```

**关键点:**
1. **加载即 pipeline**: `MongoSpark.load().withPipeline(...)` 在读时跑 aggregation, 比拉全表再 filter 高效得多
2. **读偏好**: `readPreference.name=secondaryPreferred` 把分析负载分流到从节点
3. **写一致性**: `writeConcern.w=majority` 保证结果写入副本集多数派后才返回
4. **SQL 端做窗口函数**: 12 个结果行, 写入新集合 `SparkDemo.FavouriteColorStat`

---

## 课程核心 takeaway

1. **MongoDB 是文档数据库, 不是 RDBMS** — 没有 schema, 没有强 join, 没有事务的 4.0 之前假象
2. **副本集 = 单 shard = 故障切换 + 读扩展**; **分片集群 = 副本集×N + mongos 路由 + config 元数据**
3. **事务 = 4.0+ 才有多文档 ACID**, 必须在副本集/分片集群上; 默认 `readConcern=snapshot` + `writeConcern=majority`
4. **聚合框架 = MongoDB 的报表查询工具**, 核心 stages: `$match, $group, $project, $unwind, $sort, $limit, $lookup`
5. **Spark Connector = OLAP 出口**, 用 mongo-spark-connector 把 MongoDB 当作 Spark 数据源/汇, 复杂分析走 Spark SQL/DataFrame

---

## 与 PostgreSQL / PolarDB 的对比要点 (我的 PG 学习背景)

| 概念 | MongoDB | PostgreSQL |
|---|---|---|
| Schema | 无模式 (文档) | 严格模式 (DDL) |
| 主键 | `_id` (ObjectId 12B) | 用户定义 SERIAL/UUID |
| 副本集 | rs.initiate 一行命令 | pg_basebackup + recovery.conf / replication slots |
| 分片 | mongos 路由, config server 元数据 | Citus / pg_shard / 手动应用层分片 |
| 事务 | 4.0+ 多文档 ACID, 仅副本集 | 原生 MVCC, 全场景 |
| 读一致性 | readConcern: snapshot/local/majority | READ COMMITTED / REPEATABLE READ / SERIALIZABLE |
| 写一致性 | writeConcern: w=N, j=true | synchronous_commit=on/off/remote_write |
| OLAP 出口 | mongo-spark-connector | pg_citus / duckdb_fdw / 各种 FDW |
| 数组字段 | 原生支持 | 需要 JSONB / array 类型 |
| 索引类型 | B-tree, hash, geospatial, text, partial | B-tree, hash, GIN, GiST, SP-GiST, BRIN, Bloom |