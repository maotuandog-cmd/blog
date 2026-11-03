# 【存储工程】数据湖存储格式：Delta Lake、Iceberg 与 Hudi

来源: https://quant67.com/post/storage/40-data-lake-formats/data-lake-formats.html
日期: 2025-09-18 |

---

数据湖（Data
            Lake）的核心思想是把海量异构数据以开放格式存储在廉价的对象存储（Object
            Storage）上，用计算引擎按需查询。Apache Parquet
            解决了列式编码（Columnar Encoding）问题，让分析查询的 I/O
            效率提升了一个数量级。但 Parquet
            只是一个文件格式，它不管事务、不管 Schema
            变更、不管并发写入冲突。当数据工程师试图在数据湖上构建可靠的
            ETL 流水线时，Parquet
            的局限性暴露无遗：一次失败的写入可能留下半成品文件，一次
            Schema 变更可能让下游查询全部报错，小文件问题（Small File
            Problem）让查询性能断崖式下降。
            

为了在对象存储之上提供数据库级别的可靠性保证，三个开源项目应运而生：Delta
            Lake（Databricks 主导）、Apache Iceberg（Netflix 发起）和
            Apache Hudi（Uber
            发起）。它们被统称为数据湖表格式（Lakehouse Table
            Format），在 Parquet 文件之上增加了一个元数据层（Metadata
            Layer），提供 ACID 事务（ACID Transaction）、时间旅行（Time
            Travel）、Schema 演化（Schema
            Evolution）和增量查询（Incremental Query）等能力。
            

本文从 Parquet
            的不足讲起，拆解数据湖表格式的核心概念，分别深入 Delta
            Lake、Iceberg 和 Hudi 的架构与实现，再做横向对比，最后落到
            Schema 演化实战、小文件合并优化和选型指南。所有代码示例基于
            Delta Lake 3.x、Iceberg 1.5.x、Hudi 0.14.x，运行环境为
            Apache Spark 3.5。
            
            

## 一、为什么 Parquet
            还不够

            

### 1.1 Parquet 回顾

            

Parquet 是一种列式存储格式（Columnar Storage
            Format），文件内部按行组（Row
            Group）划分，每个行组内按列存储，支持字典编码（Dictionary
            Encoding）、游程编码（Run-Length Encoding）和位压缩（Bit
            Packing）等多种编码方式。一个典型的 Parquet
            文件结构如下：
            
```
Parquet 文件结构

┌──────────────────────────────────────────────┐
│  Magic Number: PAR1                          │
├──────────────────────────────────────────────┤
│  Row Group 0                                 │
│  ├── Column Chunk: user_id (INT64)           │
│  ├── Column Chunk: event_type (STRING)       │
│  └── Column Chunk: timestamp (INT96)         │
├──────────────────────────────────────────────┤
│  Row Group 1                                 │
│  ├── Column Chunk: user_id (INT64)           │
│  ├── Column Chunk: event_type (STRING)       │
│  └── Column Chunk: timestamp (INT96)         │
├──────────────────────────────────────────────┤
│  Footer                                      │
│  ├── File Metadata                           │
│  ├── Row Group Metadata (offsets, sizes)     │
│  └── Column Metadata (min/max, encodings)    │
├──────────────────────────────────────────────┤
│  Footer Length (4 bytes)                     │
│  Magic Number: PAR1                          │
└──────────────────────────────────────────────┘
```

            

Parquet 在单文件层面做得很好：列裁剪（Column
            Pruning）只读需要的列，谓词下推（Predicate
            Pushdown）利用列的 min/max
            统计信息跳过不相关的行组。但问题出在文件之上的那一层——当一张表由成百上千个
            Parquet 文件组成时，谁来管理这些文件？
            

### 1.2 没有 ACID 事务

            

假设一个 ETL 作业需要向表中追加 100 个新的 Parquet
            文件。如果作业在写入第 57 个文件时崩溃，表的状态是什么？
            
```
ETL 写入中途失败

写入前：files = [part-00000.parquet, ..., part-00099.parquet]

写入中（崩溃时）：
  ✓ part-00100.parquet  已写入
  ✓ part-00101.parquet  已写入
  ...
  ✓ part-00156.parquet  已写入
  ✗ part-00157.parquet  写入一半，文件损坏
  ? part-00158.parquet  未写入
  ...
  ? part-00199.parquet  未写入
```

            

下游查询会读到这 57
            个”半成品”文件吗？如果读到了，结果就是错误的。如果要回滚，谁负责删除这
            57 个文件？纯 Parquet
            没有答案。工程师通常靠人工脚本或调度系统的重试机制来”修复”，但这不是事务保证，而是最终一致性（Eventual
            Consistency）的变体——既不可靠，也不优雅。
            

并发写入的问题更严重。两个 Spark 作业同时向同一张 Hive
            分区写数据，后完成的作业可能覆盖先完成的作业的文件清单，导致数据丢失。Hive
            Metastore
            虽然提供了分区级别的锁，但锁粒度太粗，且不支持行级别的冲突检测。
            

### 1.3 没有 Schema 演化

            

业务需求变化是常态。某天产品经理要求在用户事件表中加一个
            `device_type` 字段。在纯 Parquet
            方案下，工程师面临两个选择：
            

第一，重写所有历史文件，在每个文件中加上新列并填充默认值。对于
            PB 级别的数据湖，这意味着数天的计算和巨大的存储开销。
            

第二，只在新文件中加上新列，老文件保持不变。但这要求查询引擎能处理”新旧文件
            Schema 不一致”的情况。Spark 的 `mergeSchema`
            选项可以做到，但它要在每次查询时扫描所有文件的 Footer 来合并
            Schema，性能代价不小。
            

更复杂的场景包括列重命名（Column
            Rename）、列类型提升（Type Promotion，比如 INT32 升级为
            INT64）和列删除（Column Drop）。纯 Parquet
            对这些操作几乎没有支持。
            

### 1.4 小文件问题

            

流式写入（Streaming
            Ingestion）场景下，每个微批次（Micro-Batch）可能只产生几 MB
            甚至几 KB 的 Parquet
            文件。当文件数量达到数十万甚至数百万时，问题接踵而来：
            
```
小文件问题的连锁反应

  文件数量暴增
      │
      ▼
  文件系统 / 对象存储 LIST 操作变慢
      │
      ▼
  查询计划阶段耗时从秒级退化到分钟级
      │
      ▼
  每个文件一个 Task，调度开销巨大
      │
      ▼
  每个文件的 Footer 都要读一次，元数据 I/O 成倍增加
      │
      ▼
  列式存储的编码优势无法发挥（数据量太少，字典编码退化）
```

            

工程师通常定期跑”合并小文件”的脚本，但这本身就是一个需要
            ACID 保证的操作——合并过程中查询不能读到中间状态。纯 Parquet
            没有这个能力。
            

### 1.5 没有数据版本管理

            

数据分析师发现”昨天的报表数据不对”，想看看”上周三的数据长什么样”。纯
            Parquet
            做不到——文件一旦被覆盖或删除，历史数据就永久丢失了。一些团队用目录命名约定（如
            `snapshot-20250101/`）来模拟版本管理，但这既浪费存储又难以维护。
            

这些问题的根源是一样的：Parquet 是一个文件格式（File
            Format），不是一个表格式（Table
            Format）。文件格式只关心”单个文件内部的数据如何组织”，表格式关心的是”一组文件如何构成一张逻辑表，以及这张表的状态如何安全地演化”。
            
            

## 二、数据湖表格式概念

            

### 2.1 元数据层

            

数据湖表格式的核心思想是在数据文件之上增加一个元数据层（Metadata
            Layer）。这个元数据层记录了”当前表由哪些文件组成”、“每个文件的统计信息是什么”、“表的
            Schema
            是什么”等信息。所有对表的读写操作都通过元数据层间接进行：
            
```
数据湖表格式的分层架构

┌───────────────────────────────────────────┐
│          查询引擎（Query Engine）          │
│    Spark / Trino / Flink / Dremio ...     │
├───────────────────────────────────────────┤
│        表格式（Table Format）              │
│   Delta Lake / Iceberg / Hudi             │
│   ┌─────────────────────────────────┐     │
│   │  元数据层（Metadata Layer）       │     │
│   │  - 文件清单（File Manifest）      │     │
│   │  - Schema 信息                   │     │
│   │  - 分区信息（Partition Info）     │     │
│   │  - 统计信息（Statistics）        │     │
│   │  - 快照历史（Snapshot History）   │     │
│   └─────────────────────────────────┘     │
├───────────────────────────────────────────┤
│        文件格式（File Format）              │
│        Parquet / ORC / Avro               │
├───────────────────────────────────────────┤
│        存储层（Storage Layer）              │
│        S3 / ADLS / GCS / HDFS             │
└───────────────────────────────────────────┘
```

            

### 2.2 对象存储上的 ACID

            

传统数据库的 ACID 依赖文件系统的原子重命名（Atomic
            Rename）和 fsync。对象存储（如
            S3）不支持原子重命名，也不保证列表一致性（List-After-Write
            Consistency）。数据湖表格式用不同的策略在对象存储上实现
            ACID：
            
            
- 

**乐观并发控制（Optimistic Concurrency
            Control）**：写入者先将新的数据文件写入存储，然后尝试原子地提交一个新的元数据版本。如果在提交时发现有其他写入者已经修改了元数据，就重试或报冲突。
            
- 

**多版本并发控制（Multi-Version Concurrency
            Control，MVCC）**：每次提交生成一个新的快照（Snapshot），读取者始终读取某个一致的快照，不会看到中间状态。
            
- 

**写时复制（Copy-on-Write）或读时合并（Merge-on-Read）**：更新和删除操作不修改已有文件，而是写入新文件或标记文件来记录变更。
            
            

### 2.3 快照隔离与时间旅行

            

每次提交都会生成一个新的快照，快照包含了表在该时间点的完整文件清单。这天然支持时间旅行（Time
            Travel）——查询任意历史版本只需要找到对应的快照，读取那个快照引用的文件即可：
            
```
快照与时间旅行

时间线：
  t0: Snapshot 0 → {file-A, file-B}
  t1: Snapshot 1 → {file-A, file-B, file-C}        # INSERT
  t2: Snapshot 2 → {file-A, file-B', file-C}        # UPDATE file-B
  t3: Snapshot 3 → {file-A, file-C}                 # DELETE file-B'

查询 Snapshot 1：读 file-A, file-B, file-C
查询 Snapshot 2：读 file-A, file-B', file-C
当前版本（Snapshot 3）：读 file-A, file-C
```

            

### 2.4 分区与文件裁剪

            

Hive 时代的分区依赖目录结构（如
            `year=2025/month=09/day=18/`），分区键嵌入在路径中。数据湖表格式将分区信息记录在元数据中，查询引擎通过元数据就能完成分区裁剪（Partition
            Pruning），不需要 LIST
            操作遍历目录。更进一步，元数据中记录的列级统计信息（如
            min/max）还能实现文件裁剪（File
            Pruning）——跳过不包含目标数据的文件。
            
            

## 三、Delta Lake

            

### 3.1 起源与定位

            

Delta Lake 由 Databricks 于 2019
            年开源，最初的设计目标是为 Databricks 平台上的 Spark
            用户提供可靠的数据湖事务。它的核心理念是”在数据湖上构建数据仓库”（Lakehouse），弥合数据湖和数据仓库之间的鸿沟。Delta
            Lake 的论文发表于 VLDB 2020，题为 “Delta Lake:
            High-Performance ACID Table Storage over Cloud Object
            Stores”。
            

### 3.2 事务日志

            

Delta Lake 的元数据层是一个有序的事务日志（Transaction
            Log），也称为 Delta Log。每次提交（Commit）对应一个 JSON
            文件，文件名是递增的版本号：
            
```
Delta Log 目录结构

_delta_log/
├── 00000000000000000000.json    # 版本 0：建表
├── 00000000000000000001.json    # 版本 1：INSERT
├── 00000000000000000002.json    # 版本 2：UPDATE
├── 00000000000000000003.json    # 版本 3：DELETE
├── 00000000000000000004.json    # 版本 4：INSERT
├── ...
├── 00000000000000000010.checkpoint.parquet  # 检查点
└── _last_checkpoint                         # 指向最新检查点
```

            

每个 JSON
            文件包含一组操作（Action），描述了这次提交做了什么：
            
```
// 版本 1 的事务日志内容（00000000000000000001.json）
{"commitInfo": {"timestamp": 1726646400000, "operation": "WRITE", ...}}
{"add": {"path": "part-00000-abc.parquet", "size": 1048576,
         "partitionValues": {"date": "2025-09-18"},
         "stats": "{\"numRecords\":10000,\"minValues\":{\"id\":1},\"maxValues\":{\"id\":10000}}"}}
{"add": {"path": "part-00001-def.parquet", "size": 2097152,
         "partitionValues": {"date": "2025-09-18"},
         "stats": "{\"numRecords\":20000,\"minValues\":{\"id\":10001},\"maxValues\":{\"id\":30000}}"}}
```

            

关键的操作类型包括：
            
            
- `add`：添加一个数据文件到表中。
            
- `remove`：从表中移除一个数据文件（逻辑删除，文件物理上仍在存储中）。
            
- `metaData`：修改表的 Schema 或分区方式。
            
- `protocol`：修改表的协议版本（Reader/Writer
            Protocol）。
            
            

### 3.3 读取流程

            

读取 Delta 表的流程如下：
            
```
Delta Lake 读取流程

1. 读取 _last_checkpoint，找到最新的检查点版本（如版本 10）
2. 加载检查点文件 00000000000000000010.checkpoint.parquet
   → 得到版本 10 的完整文件清单
3. 顺序加载版本 11、12、... 到最新版本的 JSON 文件
   → 在检查点基础上回放 add/remove 操作
4. 得到当前表的完整文件清单和 Schema
5. 根据查询条件做分区裁剪和文件裁剪
6. 读取筛选后的 Parquet 文件
```

            

检查点（Checkpoint）是事务日志的物化视图（Materialized
            View），它将截至某个版本的所有 add/remove 操作合并为一个
            Parquet 文件。没有检查点，读取表就需要从版本 0 开始回放所有
            JSON 文件，随着版本数增长这会变得非常慢。Delta Lake 默认每
            10 个版本生成一个检查点。
            

### 3.4 写入与并发控制

            

Delta Lake 使用乐观并发控制（Optimistic Concurrency
            Control）。写入流程如下：
            
```
Delta Lake 写入流程

1. 读取当前最新版本 N 的状态
2. 将新的数据文件写入存储（此时不影响任何读取者）
3. 尝试写入版本 N+1 的 JSON 文件
   - 如果文件不存在 → 写入成功，提交完成
   - 如果文件已存在（其他写入者抢先提交了）→ 冲突
4. 冲突处理：
   - 读取版本 N+1 的内容
   - 检查冲突是否可解决（如两个写入者操作不同分区）
   - 如果可解决 → 重试，尝试写入版本 N+2
   - 如果不可解决 → 抛出 ConcurrentModificationException
```

            

在 S3 上，Delta Lake 利用 S3 的 PUT-if-absent
            语义（通过条件写入或 DynamoDB 锁）来实现原子提交。在 HDFS
            上，利用文件系统的原子重命名。
            

### 3.5 时间旅行

            

时间旅行是 Delta Lake
            的亮点功能。用户可以通过版本号或时间戳查询历史数据：
            
```
-- SQL: 按版本号查询历史数据
SELECT * FROM events VERSION AS OF 5;

-- SQL: 按时间戳查询历史数据
SELECT * FROM events TIMESTAMP AS OF '2025-09-15 10:00:00';
```

            
```
# PySpark: 按版本号读取
df = spark.read.format("delta").option("versionAsOf", 5).load("/data/events")

# PySpark: 按时间戳读取
df = spark.read.format("delta").option("timestampAsOf", "2025-09-15").load("/data/events")
```

            

时间旅行的实现非常自然：版本 5 的状态 = 最近一个 ≤5
            的检查点 + 从检查点到版本 5 的 JSON
            回放。历史版本的数据文件只要没有被 VACUUM
            命令物理删除，就可以被访问。
            

### 3.6 Z-Ordering

            

Z-Ordering 是 Delta Lake 提供的数据布局优化（Data Layout
            Optimization）技术。它通过 Z 值曲线（Z-order
            Curve）将多维数据映射到一维，使得在多个列上都有良好的数据局部性（Data
            Locality）：
            
```
Z-Ordering 原理

传统排序（按 column_a 排序）：
  File 1: column_a = [1..100],  column_b = [任意]
  File 2: column_a = [101..200], column_b = [任意]
  → 按 column_a 过滤效果好，按 column_b 过滤无效

Z-Ordering（按 column_a 和 column_b 交错排序）：
  File 1: column_a = [1..50],   column_b = [1..50]
  File 2: column_a = [1..50],   column_b = [51..100]
  File 3: column_a = [51..100], column_b = [1..50]
  File 4: column_a = [51..100], column_b = [51..100]
  → 按 column_a 或 column_b 过滤都能跳过大量文件
```

            
```
-- SQL: 对 Delta 表执行 Z-Ordering
OPTIMIZE events ZORDER BY (user_id, event_date);
```

            

Z-Ordering
            的本质是让每个文件的列统计信息（min/max）的范围尽可能窄，从而让文件裁剪更加有效。代价是需要重写数据文件，这是一个计算密集型操作。
            

### 3.7 Delta Lake
            建表与基本操作

            
```
# PySpark: 创建 Delta 表
from pyspark.sql import SparkSession
from pyspark.sql.types import StructType, StructField, StringType, LongType, TimestampType

spark = SparkSession.builder \
    .appName("DeltaLakeDemo") \
    .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
    .config("spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
    .getOrCreate()

schema = StructType([
    StructField("user_id", LongType(), False),
    StructField("event_type", StringType(), False),
    StructField("event_time", TimestampType(), False),
    StructField("device_type", StringType(), True),
])

df = spark.createDataFrame([], schema)
df.write.format("delta").mode("overwrite").save("/data/events")
```

            
```
# PySpark: 追加写入
new_data = spark.createDataFrame([
    (1, "click", "2025-09-18 10:00:00", "mobile"),
    (2, "view",  "2025-09-18 10:01:00", "desktop"),
], ["user_id", "event_type", "event_time", "device_type"])

new_data.write.format("delta").mode("append").save("/data/events")
```

            
```
# PySpark: MERGE（Upsert）操作
from delta.tables import DeltaTable

delta_table = DeltaTable.forPath(spark, "/data/events")
updates = spark.createDataFrame([
    (1, "click", "2025-09-18 10:00:00", "tablet"),
], ["user_id", "event_type", "event_time", "device_type"])

delta_table.alias("target").merge(
    updates.alias("source"),
    "target.user_id = source.user_id AND target.event_time = source.event_time"
).whenMatchedUpdateAll() \
 .whenNotMatchedInsertAll() \
 .execute()
```

            
            

## 四、Apache Iceberg

            

### 4.1 起源与设计哲学

            

Apache Iceberg 由 Netflix 的 Ryan Blue 于 2017
            年发起，2018 年进入 Apache 孵化器，2020
            年毕业为顶级项目。Iceberg 的设计哲学与 Delta Lake
            有明显区别：它追求引擎无关性（Engine
            Agnostic），从第一天起就设计为可以被
            Spark、Trino、Flink、Hive
            等多种引擎使用，而不绑定于任何特定引擎。
            

Iceberg 的另一个设计原则是正确性优先（Correctness
            First）。Netflix 的数据量级巨大（数 PB 级别），他们在 Hive
            表上踩过太多坑——分区列表不准确、并发写入丢数据、Schema
            变更导致查询错误。Iceberg
            的核心目标就是彻底解决这些问题。
            

### 4.2 元数据架构

            

Iceberg 使用基于快照的元数据架构（Snapshot-based Metadata
            Architecture），比 Delta Lake 的线性日志更加层次化：
            
```
Iceberg 元数据架构

Catalog
  └── Table Metadata File (metadata/v3.metadata.json)
        ├── Schema (当前 Schema 和历史 Schema)
        ├── Partition Spec (分区规范)
        ├── Sort Order (排序规则)
        ├── Current Snapshot ID
        └── Snapshots List
              ├── Snapshot s1 → Manifest List (snap-s1.avro)
              │     ├── Manifest File m1.avro → [file-A, file-B]
              │     └── Manifest File m2.avro → [file-C, file-D]
              ├── Snapshot s2 → Manifest List (snap-s2.avro)
              │     ├── Manifest File m1.avro → [file-A, file-B]  # 复用
              │     ├── Manifest File m2.avro → [file-C, file-D]  # 复用
              │     └── Manifest File m3.avro → [file-E]          # 新增
              └── ...
```

            

三层元数据结构的作用：
            
            
- **Table Metadata File**：JSON
            格式，记录表的
            Schema、分区规范、快照列表等全局信息。每次提交生成新版本（v1.metadata.json、v2.metadata.json、…）。
            
- **Manifest List**：Avro
            格式，列出当前快照引用的所有 Manifest File，以及每个
            Manifest 的分区范围统计信息。
            
- **Manifest File**：Avro
            格式，列出一组数据文件的路径、大小、行数、列级 min/max
            统计信息等。
            
            

这种层次化设计有两个关键优势。第一，Manifest File
            可以跨快照复用。一次提交只增加了几个文件，只需要新建一个
            Manifest File，其他 Manifest
            直接引用。第二，查询计划可以层层裁剪——先通过 Manifest List
            的分区统计信息裁剪 Manifest，再通过 Manifest
            的列统计信息裁剪数据文件。
            

### 4.3 隐式分区

            

隐式分区（Hidden Partitioning）是 Iceberg
            最受欢迎的特性之一。在 Hive
            中，分区键直接暴露给用户，查询必须显式指定分区列的过滤条件才能触发分区裁剪：
            
```
-- Hive: 用户必须知道分区结构才能写出高效查询
SELECT * FROM events WHERE year = 2025 AND month = 9 AND day = 18;

-- 如果用户写成这样，就无法分区裁剪
SELECT * FROM events WHERE event_date = '2025-09-18';
```

            

Iceberg 的分区规范（Partition
            Spec）定义的是分区转换函数（Partition
            Transform），而不是分区列本身：
            
```
-- Iceberg: 定义分区规范
CREATE TABLE events (
    user_id   BIGINT,
    event_type STRING,
    event_time TIMESTAMP,
    device_type STRING
) USING iceberg
PARTITIONED BY (days(event_time));
```

            

用户查询时直接用源列过滤，Iceberg
            自动将过滤条件映射到分区：
            
```
-- Iceberg: 用户不需要知道分区结构
SELECT * FROM events
WHERE event_time >= TIMESTAMP '2025-09-18 00:00:00'
  AND event_time 
            

支持的分区转换函数包括：
            
```
Iceberg 分区转换函数

函数               输入类型      输出示例
─────────────────────────────────────────────
identity(col)     任意          原始值
bucket(N, col)    任意          hash(col) % N
truncate(W, col)  STRING/INT   截断到宽度 W
year(col)         TIMESTAMP    2025
month(col)        TIMESTAMP    2025-09
day(col)          TIMESTAMP    2025-09-18
hour(col)         TIMESTAMP    2025-09-18-10
```

            

### 4.4 分区演化

            

分区演化（Partition Evolution）是 Iceberg
            在隐式分区基础上的进一步创新。传统的分区方案一旦确定就很难更改——如果要从按天分区改为按小时分区，通常需要重写所有历史数据。
            

Iceberg
            允许在不重写数据的情况下更改分区规范。旧数据保持旧的分区方式，新数据使用新的分区方式。Iceberg
            的元数据记录了每个 Manifest File
            对应的分区规范版本，查询时自动处理多个分区规范的共存：
            
```
-- 初始分区：按天
CREATE TABLE events (...) USING iceberg PARTITIONED BY (days(event_time));

-- 业务增长后，按天分区太粗，改为按小时
ALTER TABLE events SET PARTITION SPEC (hours(event_time));
```

            
```
分区演化后的数据布局

历史数据（分区规范 v0：按天）：
  data/event_time_day=2025-09-01/file-001.parquet
  data/event_time_day=2025-09-02/file-002.parquet
  ...

新数据（分区规范 v1：按小时）：
  data/event_time_hour=2025-09-18-10/file-100.parquet
  data/event_time_hour=2025-09-18-11/file-101.parquet
  ...

查询 WHERE event_time = '2025-09-02 15:00:00'：
  → 对旧数据：裁剪到 day=2025-09-02
  → 对新数据：裁剪到 hour=2025-09-02-15
  → 两种分区规范无缝共存
```

            

### 4.5 Iceberg
            建表与基本操作

            
```
-- SQL: Spark 中创建 Iceberg 表
CREATE TABLE catalog.db.events (
    user_id     BIGINT,
    event_type  STRING,
    event_time  TIMESTAMP,
    device_type STRING
) USING iceberg
PARTITIONED BY (days(event_time))
TBLPROPERTIES (
    'write.format.default' = 'parquet',
    'write.parquet.compression-codec' = 'zstd'
);
```

            
```
-- SQL: 插入数据
INSERT INTO catalog.db.events VALUES
    (1, 'click', TIMESTAMP '2025-09-18 10:00:00', 'mobile'),
    (2, 'view',  TIMESTAMP '2025-09-18 10:01:00', 'desktop');
```

            
```
-- SQL: 时间旅行
SELECT * FROM catalog.db.events VERSION AS OF 2;

-- SQL: 查看快照历史
SELECT * FROM catalog.db.events.snapshots;

-- SQL: 查看数据文件清单
SELECT * FROM catalog.db.events.files;

-- SQL: 查看分区信息
SELECT * FROM catalog.db.events.partitions;
```

            

### 4.6 Catalog 与引擎集成

            

Iceberg 定义了标准的 Catalog 接口（Catalog
            Interface），不同的引擎通过 Catalog 发现和管理表。常用的
            Catalog 实现包括：
            
```
Iceberg Catalog 实现

Catalog 类型          后端存储              适用场景
─────────────────────────────────────────────────────
HiveCatalog          Hive Metastore       与 Hive 生态兼容
HadoopCatalog        HDFS / S3 目录       不依赖外部服务
RESTCatalog          REST API             多引擎统一管理
GlueCatalog          AWS Glue             AWS 原生集成
NessieCatalog        Project Nessie       Git-like 版本管理
JdbcCatalog          RDBMS (PostgreSQL)   轻量级部署
```

            
```
# PySpark: 配置 RESTCatalog
spark = SparkSession.builder \
    .appName("IcebergDemo") \
    .config("spark.sql.extensions",
            "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions") \
    .config("spark.sql.catalog.my_catalog", "org.apache.iceberg.spark.SparkCatalog") \
    .config("spark.sql.catalog.my_catalog.type", "rest") \
    .config("spark.sql.catalog.my_catalog.uri", "http://localhost:8181") \
    .getOrCreate()
```

            
            

## 五、Apache Hudi

            

### 5.1 起源与设计动机

            

Apache Hudi（Hadoop Upserts Deletes and Incrementals）由
            Uber 于 2016 年创建，2019 年进入 Apache
            孵化器，同年毕业为顶级项目。Hudi 的设计动机来自 Uber
            的实际需求：他们需要将数百万次行程记录的更新近实时地同步到数据湖中，而
            Hive 的批量覆盖方式完全无法满足延迟和效率要求。
            

Hudi 的核心设计理念是”流批一体”（Unified Batch and
            Streaming）。它不仅是一个表格式，还内置了数据摄入（Data
            Ingestion）和增量处理（Incremental
            Processing）的能力，这使得它在 CDC（Change Data
            Capture）场景中有天然优势。
            

### 5.2
            表类型：Copy-on-Write 与 Merge-on-Read

            

Hudi 提供两种表类型，这是它与 Delta Lake 和 Iceberg
            最大的区别之一：
            

**写时复制（Copy-on-Write，CoW）表**：每次更新都重写整个受影响的文件。写入延迟高，但读取性能好，因为读取者始终读的是纯
            Parquet 文件。
            

**读时合并（Merge-on-Read，MoR）表**：更新操作写入增量日志文件（Delta
            Log / Log File），读取时将基础文件（Base
            File）与增量日志合并。写入延迟低，但读取需要额外的合并开销。
            
```
Copy-on-Write vs Merge-on-Read

Copy-on-Write (CoW):
  写入前：base-file-001.parquet  [row-1, row-2, row-3]
  更新 row-2 后：
    base-file-001.parquet  被标记为旧版本
    base-file-002.parquet  [row-1, row-2', row-3]  ← 整个文件重写
  读取：直接读 base-file-002.parquet

Merge-on-Read (MoR):
  写入前：base-file-001.parquet  [row-1, row-2, row-3]
  更新 row-2 后：
    base-file-001.parquet  保持不变
    .log-file-001.avro     [row-2' (delta)]  ← 只写增量
  读取（快照查询）：读 base-file-001 + 合并 log-file-001
  读取（读优化查询）：只读 base-file-001（不含最新更新）
  Compaction 后：base-file-002.parquet  [row-1, row-2', row-3]
```

            

两种表类型的选择取决于工作负载的读写比例：
            
```
CoW vs MoR 选型指南

维度              Copy-on-Write          Merge-on-Read
─────────────────────────────────────────────────────────
写入延迟           高（重写整个文件）       低（追加日志）
读取延迟           低（纯 Parquet 读取）   高（需要合并）
写入放大           高                     低
存储效率           中                     高（日志较小）
适合场景           读多写少               写多读少、CDC
查询模式           快照查询               快照查询 + 读优化查询
```

            

### 5.3 时间线与即时操作

            

Hudi
            用时间线（Timeline）来管理表的所有操作。时间线上的每个条目（Instant）代表一个操作，包含三个属性：操作类型（Action）、时间戳（Instant
            Time）和状态（State）。
            
```
Hudi 时间线

.hoodie/
├── 20250918100000.commit              # 完成的提交
├── 20250918100500.commit              # 完成的提交
├── 20250918101000.deltacommit         # MoR 表的增量提交
├── 20250918110000.compaction.requested # 请求的 Compaction
├── 20250918110000.compaction.inflight  # 正在进行的 Compaction
├── 20250918110000.compaction          # 完成的 Compaction
├── 20250918120000.clean               # 清理旧版本文件
└── hoodie.properties                  # 表配置
```

            

操作类型包括：
            
            
- `commit`：CoW 表的数据写入。
            
- `deltacommit`：MoR 表的增量写入。
            
- `compaction`：将 MoR
            表的日志文件合并到基础文件。
            
- `clean`：删除旧版本的文件以回收空间。
            
- `rollback`：回滚失败的操作。
            
- `savepoint`：创建保存点，防止被 clean
            操作删除。
            
            

### 5.4 索引机制

            

Hudi 内置了索引（Index）机制来加速 Upsert
            操作。当一条记录需要更新时，Hudi
            需要快速定位这条记录在哪个文件中。不同的索引实现适用于不同场景：
            
```
Hudi 索引类型

索引类型              实现方式                   适用场景
────────────────────────────────────────────────────────────
Bloom Index          文件级布隆过滤器            大表、随机键
Simple Index         全表扫描匹配               小表
HBase Index          外部 HBase 存储            超大表、全局去重
Bucket Index         按键哈希到固定桶            高写入吞吐
Record Level Index   文件组级别精确索引          精确定位
```

            
```
# PySpark: 配置 Hudi 写入
hudi_options = {
    "hoodie.table.name": "events",
    "hoodie.datasource.write.recordkey.field": "user_id",
    "hoodie.datasource.write.precombine.field": "event_time",
    "hoodie.datasource.write.partitionpath.field": "event_date",
    "hoodie.datasource.write.table.type": "MERGE_ON_READ",
    "hoodie.index.type": "BLOOM",
    "hoodie.datasource.write.operation": "upsert",
}

df.write.format("hudi") \
    .options(**hudi_options) \
    .mode("append") \
    .save("/data/hudi_events")
```

            

### 5.5 增量查询

            

增量查询（Incremental Query）是 Hudi
            的核心差异化能力。它允许消费者只读取自上次查询以来发生变更的记录，类似于数据库的
            Change Stream：
            
```
# PySpark: 增量查询，只读取从指定提交时间之后的变更
incremental_df = spark.read.format("hudi") \
    .option("hoodie.datasource.query.type", "incremental") \
    .option("hoodie.datasource.read.begin.instanttime", "20250918100000") \
    .option("hoodie.datasource.read.end.instanttime", "20250918120000") \
    .load("/data/hudi_events")

# 结果只包含 10:00 到 12:00 之间变更的记录
incremental_df.show()
```

            

增量查询使得 ETL
            流水线不需要每次全量扫描整张表，只处理变更的数据，大幅降低了处理延迟和计算成本。这在
            CDC 场景中尤其有价值——上游数据库的变更通过 Debezium
            等工具捕获，写入 Hudi
            表，下游消费者通过增量查询读取变更。
            

### 5.6 Hudi 的三种查询模式

            
```
Hudi 查询模式

查询模式              描述                         CoW 表    MoR 表
────────────────────────────────────────────────────────────────────
快照查询               读取最新完整数据               支持      支持
(Snapshot Query)      CoW: 读最新 Parquet
                      MoR: 读 Base + 合并 Log

读优化查询             只读最新 Compacted 数据         支持      支持
(Read Optimized)      不读 Log，数据可能不是最新
                      但读取性能最好

增量查询               读取时间范围内的变更数据         支持      支持
(Incremental Query)   返回插入、更新、删除的记录
```

            
            

## 六、Delta
            Lake、Iceberg 与 Hudi 对比

            

### 6.1 特性矩阵

            
```
特性矩阵对比（2025 年现状）

特性                    Delta Lake        Iceberg           Hudi
──────────────────────────────────────────────────────────────────────
发起方                  Databricks        Netflix           Uber
开源时间                2019              2018              2016
Apache 项目             否（Linux 基金会） 是（顶级项目）     是（顶级项目）
元数据格式              JSON + Parquet    JSON + Avro       时间线文件
ACID 事务               支持              支持              支持
时间旅行                支持              支持              支持
Schema 演化             支持              支持              支持
分区演化                有限支持           完整支持           有限支持
隐式分区                不支持            支持              不支持
表类型                  仅 CoW            CoW + MoR(v2)     CoW + MoR
增量查询                Change Data Feed  Incremental Scan  原生支持
Z-Ordering              原生支持          Spark 插件支持     Z-Order 布局
行级删除                Deletion Vectors  Position Delete   原生支持
引擎绑定性              Spark 优先         引擎无关           Spark 优先
```

            

### 6.2 元数据管理对比

            
```
元数据管理策略对比

Delta Lake:
  线性日志：version-0.json → version-1.json → ... → checkpoint.parquet
  优势：简单直接，易于理解
  劣势：大表的日志文件多，检查点重建耗时

Iceberg:
  树状结构：Metadata File → Manifest List → Manifest File → Data File
  优势：层层裁剪，大表查询计划快；Manifest 可跨快照复用
  劣势：结构复杂，调试困难

Hudi:
  时间线：.hoodie/ 目录下的 instant 文件
  优势：与写入操作紧密绑定，支持 Compaction 调度
  劣势：元数据管理机制较复杂，维护负担高
```

            

### 6.3 写入性能对比

            

不同表格式的写入性能取决于具体的操作类型和数据规模。以下是典型场景下的定性对比：
            
```
写入性能对比（定性）

操作类型          Delta Lake          Iceberg            Hudi (MoR)
──────────────────────────────────────────────────────────────────
纯追加写入         快                  快                 快
Upsert（少量）    中等（重写文件）      中等（重写文件）    快（追加日志）
Upsert（大量）    慢（大量文件重写）    慢（大量文件重写）  中等
Delete            中等                中等               中等
并发写入           乐观并发             乐观并发           乐观并发
流式写入           Structured Strm     Flink Sink         原生支持
```

            

### 6.4 查询性能对比

            
```
查询性能对比（定性）

场景                Delta Lake        Iceberg            Hudi
──────────────────────────────────────────────────────────────────
全表扫描             基准              基准               基准（CoW）
                                                        略慢（MoR 需合并）
分区裁剪             支持              支持（隐式分区优）   支持
列统计裁剪           支持              支持（三层裁剪优）   支持
超大表元数据         检查点缓解         三层结构天然优势     时间线较重
跨引擎查询           Spark 优先         多引擎优           Spark 优先
```

            

### 6.5 生态系统对比

            
```
生态系统支持（2025 年现状）

引擎/工具         Delta Lake         Iceberg            Hudi
──────────────────────────────────────────────────────────────────
Apache Spark      原生支持           插件支持            插件支持
Apache Flink      社区支持           原生支持            原生支持
Trino / Presto    连接器支持         原生支持            连接器支持
Dremio            有限支持           深度支持            有限支持
Snowflake         外部表支持         原生支持            不支持
BigQuery          外部表支持         原生支持            不支持
Databricks        原生支持           兼容支持            有限支持
AWS Athena        支持              支持               支持
AWS Glue          支持              支持               支持
```

            
            

## 七、Schema 演化实战

            

### 7.1 Schema 演化的分类

            

Schema 演化（Schema
            Evolution）是指在不重写历史数据的情况下修改表的结构。常见的
            Schema 变更类型包括：
            
```
Schema 变更类型

变更类型              描述                          兼容性
─────────────────────────────────────────────────────────────
添加列                在表末尾或嵌套结构中添加新列      向后兼容
(Add Column)         旧文件中该列返回 NULL

删除列                从 Schema 中移除一列              向前兼容
(Drop Column)        旧文件中该列被忽略

重命名列              修改列的名称                     需要引擎支持
(Rename Column)      依赖列 ID 而非列名

类型提升              扩大列的类型范围                  有条件兼容
(Type Promotion)     INT → LONG，FLOAT → DOUBLE

列重排序              改变列的顺序                     向后兼容
(Reorder Column)     依赖列 ID 或列名匹配

添加嵌套字段          在 STRUCT 类型内部添加新字段       向后兼容
(Add Nested Field)   类似于添加列
```

            

### 7.2 Delta Lake 的 Schema
            演化

            

Delta Lake 通过 Schema 合并（Schema Merge）支持 Schema
            演化。需要在写入时显式启用：
            
```
# PySpark: Delta Lake Schema 演化——添加列
new_data_with_extra_col = spark.createDataFrame([
    (3, "purchase", "2025-09-18 10:02:00", "mobile", 99.99),
], ["user_id", "event_type", "event_time", "device_type", "amount"])

new_data_with_extra_col.write.format("delta") \
    .mode("append") \
    .option("mergeSchema", "true") \
    .save("/data/events")

# 读取时，旧数据的 amount 列为 NULL
spark.read.format("delta").load("/data/events").show()
```

            
```
-- SQL: Delta Lake Schema 演化操作
ALTER TABLE events ADD COLUMNS (amount DOUBLE);
ALTER TABLE events CHANGE COLUMN event_type TYPE STRING AFTER user_id;
ALTER TABLE events DROP COLUMN device_type;

-- Delta Lake 3.x 支持列重命名（需要启用列映射模式）
ALTER TABLE events SET TBLPROPERTIES (
    'delta.columnMapping.mode' = 'name',
    'delta.minReaderVersion' = '2',
    'delta.minWriterVersion' = '5'
);
ALTER TABLE events RENAME COLUMN event_type TO action_type;
```

            

### 7.3 Iceberg 的 Schema
            演化

            

Iceberg 从设计之初就使用列 ID（Column
            ID）而非列名来标识列，这使得列重命名和列重排序成为零成本操作——只需要修改元数据中列
            ID 到列名的映射：
            
```
-- SQL: Iceberg Schema 演化操作
ALTER TABLE catalog.db.events ADD COLUMN amount DOUBLE;
ALTER TABLE catalog.db.events ADD COLUMN address STRUCT;
ALTER TABLE catalog.db.events DROP COLUMN device_type;
ALTER TABLE catalog.db.events RENAME COLUMN event_type TO action_type;

-- 类型提升
ALTER TABLE catalog.db.events ALTER COLUMN user_id TYPE BIGINT;

-- 在嵌套结构中添加字段
ALTER TABLE catalog.db.events ALTER COLUMN address ADD COLUMN country STRING;

-- 列重排序
ALTER TABLE catalog.db.events ALTER COLUMN amount AFTER user_id;
```

            
```
Iceberg 列 ID 机制

初始 Schema:
  Column ID 1: user_id     (BIGINT)
  Column ID 2: event_type  (STRING)
  Column ID 3: event_time  (TIMESTAMP)

RENAME event_type TO action_type 后:
  Column ID 1: user_id     (BIGINT)
  Column ID 2: action_type (STRING)   ← 只改了名称映射，ID 不变
  Column ID 3: event_time  (TIMESTAMP)

旧的 Parquet 文件中 Column ID 2 的数据自动映射到新名称
→ 零成本重命名，不需要重写任何数据文件
```

            

### 7.4 Hudi 的 Schema 演化

            

Hudi 从 0.11 版本开始支持 Schema 演化。配置方式如下：
            
```
# PySpark: Hudi Schema 演化配置
hudi_options = {
    "hoodie.table.name": "events",
    "hoodie.datasource.write.recordkey.field": "user_id",
    "hoodie.datasource.write.precombine.field": "event_time",
    "hoodie.schema.on.read.enable": "true",         # 启用读时 Schema 演化
    "hoodie.datasource.write.reconcile.schema": "true",  # 自动协调 Schema
}
```

            
```
-- SQL: Hudi Schema 演化操作（Spark SQL）
ALTER TABLE hudi_events ADD COLUMNS (amount DOUBLE);
ALTER TABLE hudi_events ALTER COLUMN user_id TYPE BIGINT;
ALTER TABLE hudi_events RENAME COLUMN event_type TO action_type;
```

            

### 7.5 Schema 演化最佳实践

            

无论使用哪种表格式，Schema
            演化都需要遵循一些原则来避免问题：
            
```
Schema 演化最佳实践

1. 优先使用添加列，避免删除列
   → 添加列是最安全的操作，向后兼容
   → 删除列可能导致下游查询失败

2. 类型提升只能向更大的类型
   → INT → LONG 安全
   → LONG → INT 不安全，可能数据截断

3. 给新列设置合理的默认值
   → 避免 NULL 在下游聚合中产生意外结果

4. 使用列 ID 而非列名做映射（Iceberg 原生支持）
   → 列重命名不会破坏历史数据的读取

5. Schema 变更后及时更新文档和下游契约
   → Schema Registry 可以帮助自动化这个过程

6. 测试 Schema 变更对增量查询的影响
   → 新增列在历史增量数据中可能为 NULL
```

            
            

## 八、小文件合并与优化

            

### 8.1 小文件问题的根源

            

流式写入（Streaming Ingestion）是小文件的主要来源。以
            Spark Structured Streaming
            为例，每个微批次的每个分区可能只生成一个几 MB 的 Parquet
            文件。如果微批次间隔为 1 分钟，一天下来每个分区就有 1440
            个文件。如果分区数为 100，一天就产生 144000 个小文件。
            

另一个来源是频繁的 Upsert 操作。在 CoW 模式下，每次
            Upsert
            都会重写受影响的文件，但如果每次更新的行数很少，新文件的大小也很小。
            

### 8.2 Delta Lake 的
            OPTIMIZE 命令

            

Delta Lake 提供了 `OPTIMIZE`
            命令来合并小文件：
            
```
-- SQL: 合并小文件
OPTIMIZE events;

-- SQL: 合并特定分区的小文件
OPTIMIZE events WHERE event_date = '2025-09-18';

-- SQL: 合并小文件并做 Z-Ordering
OPTIMIZE events ZORDER BY (user_id, event_type);
```

            
```
OPTIMIZE 的工作流程

1. 扫描目标分区下的所有文件
2. 找出小于目标大小的文件（默认目标：1 GB）
3. 将小文件的数据读取并重新写入为更大的文件
4. 在事务日志中记录：remove 旧的小文件，add 新的大文件
5. 整个过程是事务性的——其他查询者要么看到合并前的文件，要么看到合并后的文件
```

            

Delta Lake 还支持自动合并（Auto Compaction）：
            
```
# PySpark: 启用自动合并
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.minNumFiles", 50)

# 或在表属性中设置
# ALTER TABLE events SET TBLPROPERTIES ('delta.autoOptimize.autoCompact' = 'true');
```

            

### 8.3 Iceberg 的文件合并

            

Iceberg 通过 `rewriteDataFiles`
            操作合并小文件：
            
```
# PySpark: Iceberg 合并小文件
from pyspark.sql import SparkSession

spark.sql("CALL catalog.system.rewrite_data_files(table => 'db.events')")
```

            
```
// Java API: Iceberg 合并小文件（更细粒度的控制）
import org.apache.iceberg.spark.actions.SparkActions;

SparkActions.get(spark)
    .rewriteDataFiles(table)
    .option("target-file-size-bytes", String.valueOf(512 * 1024 * 1024)) // 512 MB
    .option("min-file-size-bytes", String.valueOf(64 * 1024 * 1024))    // 最小 64 MB
    .option("max-file-size-bytes", String.valueOf(1024 * 1024 * 1024))  // 最大 1 GB
    .option("min-input-files", "5")  // 至少 5 个文件才触发合并
    .filter(Expressions.equal("event_date", "2025-09-18"))
    .execute();
```

            

Iceberg 还支持排序合并（Sort
            Compaction），在合并小文件的同时按指定列排序，提升后续查询的数据局部性：
            
```
# PySpark: Iceberg 排序合并
spark.sql("""
    CALL catalog.system.rewrite_data_files(
        table => 'db.events',
        strategy => 'sort',
        sort_order => 'user_id ASC, event_time DESC'
    )
""")
```

            

### 8.4 Hudi 的 Compaction

            

Hudi 的 MoR 表内置了 Compaction
            机制，将增量日志文件合并回基础文件：
            
```
# PySpark: Hudi Compaction 配置
hudi_options = {
    "hoodie.table.name": "events",
    "hoodie.compact.inline": "true",               # 写入时自动触发 Compaction
    "hoodie.compact.inline.max.delta.commits": "5", # 每 5 次增量提交触发一次
    "hoodie.parquet.max.file.size": str(128 * 1024 * 1024),  # 目标文件大小 128 MB
    "hoodie.parquet.small.file.limit": str(64 * 1024 * 1024), # 小文件阈值 64 MB
}
```

            

Hudi 还支持异步 Compaction（Async
            Compaction），在不影响写入的情况下后台执行合并：
            
```
Hudi Compaction 策略

策略                            描述
──────────────────────────────────────────────────────
Inline Compaction              写入时同步执行，简单但增加写入延迟
Async Compaction               后台异步执行，不影响写入吞吐
Schedule + Execute 分离         先调度 Compaction 计划，再择时执行
基于日志大小触发                 当日志文件累积到一定大小时触发
基于提交次数触发                 每 N 次 deltacommit 触发一次
基于时间间隔触发                 每隔固定时间触发一次
```

            

### 8.5 Clustering

            

除了小文件合并，Hudi 还提供了 Clustering
            操作，它在合并文件的同时按指定列重新组织数据布局：
            
```
# PySpark: Hudi Clustering 配置
hudi_options = {
    "hoodie.clustering.inline": "true",
    "hoodie.clustering.inline.max.commits": "4",
    "hoodie.clustering.plan.strategy.sort.columns": "user_id,event_time",
    "hoodie.clustering.plan.strategy.target.file.max.bytes": str(1024 * 1024 * 1024),
    "hoodie.clustering.plan.strategy.small.file.limit": str(300 * 1024 * 1024),
}
```

            

### 8.6 合并策略总结

            
```
三种表格式的文件合并能力对比

能力                  Delta Lake          Iceberg            Hudi
──────────────────────────────────────────────────────────────────
小文件合并             OPTIMIZE            rewriteDataFiles   Compaction
排序合并               ZORDER BY          sort strategy      Clustering
自动触发               autoCompact         无（需调度）        inline/async
目标文件大小           可配置              可配置             可配置
分区级合并             支持                支持               支持
事务保证               是                  是                 是
```

            
            

## 九、数据湖格式选型指南

            

### 9.1 按场景选型

            

选择哪种数据湖表格式，首先取决于业务场景和技术栈：
            
```
按场景选型

场景                                         推荐格式         原因
────────────────────────────────────────────────────────────────────────
Databricks 平台                              Delta Lake       原生支持，性能最优
多引擎环境（Spark + Trino + Flink）           Iceberg          引擎无关性最好
CDC / 近实时 Upsert                          Hudi             MoR + 增量查询天然适合
分区需求复杂 / 分区频繁变更                   Iceberg          隐式分区 + 分区演化
读多写少的分析型数据湖                        Delta Lake       CoW 读取性能好
写多读少的实时数据管道                        Hudi (MoR)       写入延迟低
AWS 生态 + 通用查询                           Iceberg          Athena/Glue 深度集成
数据治理与合规（GDPR 删除）                   三者均可         都支持行级删除
```

            

### 9.2 按技术栈选型

            
```
按技术栈选型

主力引擎              推荐格式         原因
────────────────────────────────────────────────────────────────────
Apache Spark          三者均可         都有良好的 Spark 支持
Apache Flink          Iceberg / Hudi   Flink 集成更成熟
Trino / Presto        Iceberg          原生连接器，查询优化最好
Dremio                Iceberg          Dremio 深度参与 Iceberg 开发
Databricks            Delta Lake       原生支持，社区版免费
Snowflake             Iceberg          原生 Iceberg 表支持
Google BigQuery       Iceberg          BigLake 集成
```

            

### 9.3 迁移路径

            

如果已经在使用某种格式，迁移到另一种格式的成本和路径如下：
            
```
迁移路径

Hive 表 → 任意表格式：
  1. 使用 CTAS（CREATE TABLE AS SELECT）一次性迁移
  2. 大表可分区逐步迁移
  3. 迁移后验证数据完整性

Delta Lake ↔ Iceberg：
  1. UniForm（Delta Lake 3.x）：Delta 表自动生成 Iceberg 兼容的元数据
  2. 无需数据拷贝，只读 Iceberg 元数据即可用 Iceberg 引擎查询
  3. 限制：UniForm 目前是单向的（Delta → Iceberg 只读）

Iceberg ↔ Hudi：
  1. 目前没有官方互操作方案
  2. 需要通过 Spark 做数据导出和导入
  3. Apache XTable（原 OneTable）项目尝试统一三种格式的元数据
```

            

### 9.4 Apache
            XTable：格式统一的尝试

            

Apache XTable（原名 OneTable，由 Onehouse
            发起）试图解决”选哪个格式”的难题——它不创建新格式，而是在现有格式之间做元数据翻译（Metadata
            Translation）。用户用一种格式写入数据，XTable
            自动生成其他格式的元数据，使得不同引擎可以用各自偏好的格式读取同一份数据：
            
```
XTable 工作原理

写入端：Spark 写入 Delta Lake 格式
   │
   ▼
XTable 同步：读取 Delta Log → 生成 Iceberg Metadata + Hudi Timeline
   │
   ▼
读取端 A：Trino 用 Iceberg 连接器读取
读取端 B：Flink 用 Hudi 连接器读取
读取端 C：Databricks 用 Delta Lake 原生读取

注意：数据文件（Parquet）只有一份，XTable 只翻译元数据
```

            

### 9.5 选型决策树

            
```
数据湖表格式选型决策树

                    你的主力平台是什么？
                    /           |          \
                Databricks    AWS          多云/自建
                  /             |              \
            Delta Lake    查询引擎是？       查询引擎是？
                          /      \          /        \
                      Athena    Flink     Spark     Trino
                        |        |       +Flink      |
                    Iceberg  Iceberg    Hudi/Ice   Iceberg
                              /Hudi

            是否有强烈的 CDC / Upsert 需求？
                /                   \
              是                    否
              |                      |
          Hudi (MoR)          是否需要分区演化？
                                /           \
                              是            否
                              |              |
                          Iceberg      Delta 或 Iceberg
```

            

### 9.6 总结

            

数据湖表格式的出现，标志着数据湖从”便宜但不可靠”向”既便宜又可靠”的跃迁。Delta
            Lake、Iceberg 和 Hudi
            三者解决的核心问题是一致的——在对象存储之上提供 ACID
            事务、Schema
            演化、时间旅行和增量查询。它们的差异在于架构设计、生态系统和特色功能：
            

Delta Lake 以 Databricks
            生态为根基，事务日志设计简洁直观，Z-Ordering
            和自动优化能力强，适合以 Spark 为核心的团队。
            

Iceberg
            以引擎无关性和正确性著称，三层元数据架构在超大表上表现优异，隐式分区和分区演化降低了用户的认知负担，适合多引擎环境和对数据治理要求高的团队。
            

Hudi 以流批一体和增量处理为特色，MoR
            表类型在写密集场景下性能突出，内置的索引和 Compaction
            机制降低了运维复杂度，适合 CDC 和近实时数据管道。
            

三者正在趋同——Delta Lake 新增了 Deletion Vectors 和
            UniForm，Iceberg 新增了 MoR 支持，Hudi
            改进了元数据管理和多引擎兼容性。Apache XTable
            等跨格式互操作项目也在快速推进。对于新项目，建议根据团队的技术栈和核心场景做选择；对于已有项目，关注
            XTable 和 UniForm 等互操作方案，避免被锁定在单一格式中。
            
            

## 参考文献

            

### 论文

            
            
- 

M. Armbrust, T. Das, L. Sun, et al. “Delta Lake:
            High-Performance ACID Table Storage over Cloud Object
            Stores.” *Proceedings of the VLDB Endowment*, 13(12),
            2020. Delta Lake
            的系统论文，详细阐述了事务日志和乐观并发控制的设计。
            
- 

R. Blue, D. Weeks, et al. “Apache Iceberg: An Open
            Table Format for Huge Analytic Datasets.” *Netflix Tech
            Blog*, 2018. Iceberg 的设计动机和核心架构。
            
- 

V. Jain, N. Agarwal, et al. “Apache Hudi: The Path
            Forward.” *Uber Engineering Blog*, 2019. Hudi
            的设计哲学和在 Uber 的实践。
            
            

### 官方文档

            
            
- 

Delta Lake 官方文档。https://docs.delta.io/latest/index.html.
            版本参考：Delta Lake 3.x。
            
- 

Apache Iceberg 官方文档。https://iceberg.apache.org/docs/latest/.
            版本参考：Iceberg 1.5.x。
            
- 

Apache Hudi 官方文档。https://hudi.apache.org/docs/overview/.
            版本参考：Hudi 0.14.x。
            
- 

Apache XTable 官方文档。https://xtable.apache.org/.
            跨表格式元数据互操作。
            
            

### 书籍

            
            
- 

B. Chambers, M. Zaharia. *Spark: The Definitive
            Guide*. O’Reilly, 2018. Spark
            生态与数据湖的基础。
            
- 

M. Kleppmann. *Designing Data-Intensive
            Applications*. O’Reilly, 2017. 第 3 章和第 10
            章涉及存储格式和批处理架构。
            
            
            

**上一篇**: 向量存储与
            ANN 索引 **下一篇**: 数据编码基础：整数、字符串与浮点
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】表格式为什么存在

                    

目录式分区表（Hive 表）在对象存储上有三处硬伤：并发写部分提交、list planning 太贵、缺快照隔离与原子提交。本文拆开放表格式补上的四件事——原子提交、快照隔离、文件级统计裁剪、schema 与分区演进，并抽象出三家共有的『元数据指针 + 不可变数据文件』骨架。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Iceberg、Delta、Hudi 对照与互通

                    

把前面 08–13 章拆过的 Iceberg、Delta、Hudi 放在一个坐标系里对照：元数据模型、行级更新、并发控制、引擎生态四维，每维标清口径。再讲两条互通路线——Delta UniForm（写时同步生成 Iceberg/Hudi 元数据）与 Apache XTable（事后转换元数据），以及它们的边界。最后给一棵按写入模式/引擎栈/更新频率展开的选型决策树，不做排名。
                

                
                    

2026-06-29 · database / storage
                    

### 【数据湖与开放表格式】Parquet · Iceberg · Delta · Hudi 内核拆解

                    

拆解 lakehouse 的两层基础：列式文件格式（Parquet/ORC/Arrow）与开放表格式（Iceberg/Delta/Hudi）。讲清没有数据库进程时，如何在对象存储上做 ACID、行级更新、快照与并发，以及 catalog、查询引擎、流式入湖如何拼成可运维的湖仓。面向数据平台工程师与从 OLAP/数仓转型的开发者。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。