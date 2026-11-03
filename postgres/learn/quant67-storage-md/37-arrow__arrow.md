# 【存储工程】Apache Arrow：零拷贝内存列式格式

来源: https://quant67.com/post/storage/37-arrow/arrow.html
日期: 2025-09-15 |

---

在大数据和分析系统的演进过程中，一个反复出现的性能瓶颈不是计算本身，而是数据在不同系统之间搬运时的序列化（Serialization）与反序列化（Deserialization）开销。Pandas
            把数据交给 Spark，Spark 把结果传给 R，R 再把子集喂给
            TensorFlow——每一次跨系统传递，数据都要从一种内存表示转换为另一种。这些转换消耗的
            CPU
            周期和内存带宽，在很多工作负载中甚至超过了实际的分析计算。
            

Apache Arrow
            的核心主张是：定义一种与语言无关（Language-Independent）的内存列式格式（Columnar
            Memory
            Format），让所有系统在内存中以相同的方式表示数据，从而消除跨系统数据传递时的序列化/反序列化开销。数据不需要转换，只需要传递指针——这就是零拷贝（Zero-Copy）。
            

Arrow
            不是一个数据库，不是一个查询引擎，不是一个文件格式。它是一个内存规范（In-Memory
            Specification），加上围绕这个规范构建的一系列库：IPC
            协议（Inter-Process
            Communication）实现进程间零拷贝传输，Flight 协议（Flight
            Protocol）实现网络间高性能传输，Compute 内核（Compute
            Kernel）提供向量化计算原语，以及与 Pandas、Spark、DuckDB
            等生态系统的集成层。
            

本文从”为什么需要统一内存格式”讲起，逐层拆解 Arrow
            的内存布局、IPC 协议、Flight 网络协议、Compute
            内核，再落到与 Pandas、Spark、DuckDB
            的实际集成，最后用性能实测数据量化 Arrow
            带来的收益。所有代码基于 Apache Arrow 15.x（PyArrow
            15.0）、Pandas 2.2、PySpark 3.5、DuckDB 1.0。
            
            

## 一、为什么需要统一内存格式

            

### 1.1
            序列化/反序列化的隐性成本

            

考虑一个典型的数据分析管道（Data Analytics
            Pipeline）：Python 脚本用 Pandas 加载
            CSV，做一些清洗，把结果传给 Spark 集群做聚合，Spark
            的结果再回到 Python
            做可视化。每一步的数据交接都涉及格式转换：
            
```
数据分析管道中的序列化开销

Pandas DataFrame         Spark DataFrame          Pandas DataFrame
 (行式 NumPy 数组)         (JVM 对象)               (行式 NumPy 数组)
       │                       │                        ▲
       │  serialize             │  serialize             │
       ▼                       ▼                        │
   Pickle/CSV/JSON ──────► JVM 反序列化 ──────► Pickle/CSV 反序列化
       字节流                  字节流                    字节流
```

            

这个过程有三个问题：
            

第一，CPU
            开销。序列化需要遍历每一行、每一列，把内存中的数据结构编码为字节流；反序列化需要解析字节流，重建内存中的数据结构。对于一个
            1GB 的 DataFrame，仅序列化/反序列化就可能消耗数秒的 CPU
            时间。
            

第二，内存开销。序列化过程中，原始数据和序列化后的字节流同时存在于内存中，峰值内存使用量翻倍。在内存受限的环境下（例如容器），这可能直接导致
            OOM（Out of Memory）。
            

第三，延迟。数据传递的延迟不再由网络带宽或磁盘 I/O
            决定，而是被序列化/反序列化的 CPU
            时间主导。在交互式分析场景中，用户等待的时间大部分花在了数据格式转换上。
            

### 1.2 各系统的内存表示差异

            

问题的根源在于，每个系统都有自己的内存数据表示方式：
            
```
不同系统的内存数据表示

系统          内存布局          空值处理          字符串存储
─────────────────────────────────────────────────────────
Pandas        行式 NumPy       NaN/None         Python 对象数组
R             SEXP 向量        NA 特殊值        CHARSXP 全局池
Spark         Tungsten 格式    位图             UTF-8 + 偏移量
Julia         原生数组         Missing 类型     String 对象
NumPy         连续数组         无原生支持       固定宽度字节
PostgreSQL    HeapTuple        空值位图（Null Bitmap） 变长 TOAST
```

            

每种表示方式都有自己的设计取舍，但它们互不兼容。当数据从一个系统流向另一个系统时，必须经过”拆解-重建”的过程。
            

### 1.3 Arrow 的解决思路

            

Arrow
            的核心思路可以用一句话概括：所有系统都用同一种内存布局。
            
```
Arrow 统一内存格式的效果

            Arrow 之前                         Arrow 之后
    ┌──────┐     ┌──────┐              ┌──────┐     ┌──────┐
    │Pandas│────►│Spark │              │Pandas│     │Spark │
    └──┬───┘     └──┬───┘              └──┬───┘     └──┬───┘
       │序列化      │反序列化              │            │
       ▼            ▼                     ▼            ▼
   字节流  ◄────  字节流           ┌──────────────────────┐
       │            │              │   共享 Arrow 内存     │
       ▼            ▼              │  （零拷贝传递指针）    │
    ┌──────┐     ┌──────┐          └──────────────────────┘
    │  R   │────►│Julia │              ▲            ▲
    └──────┘     └──────┘              │            │
                                   ┌──┴───┐     ┌──┴───┐
                                   │  R   │     │Julia │
                                   └──────┘     └──────┘
```

            

当所有系统都使用 Arrow
            格式在内存中表示数据时，系统间传递数据只需要传递指针或内存区域的引用，不需要任何格式转换。这就是零拷贝的含义。
            

### 1.4 Arrow
            与列式存储格式的关系

            

Arrow 经常被拿来与 Parquet
            比较，但两者解决的是不同层面的问题：
            
```
Arrow 与 Parquet 的定位对比

维度              Arrow                    Parquet
────────────────────────────────────────────────────────
层面              内存格式                  磁盘格式
优化目标          随机访问、CPU 计算        压缩率、顺序扫描
数据组织          列式缓冲区（Buffer）      行组 + 列块（Row Group + Column Chunk）
压缩              通常不压缩                重度压缩（Snappy/Zstd/Gzip）
编码              原始值                    字典编码、RLE、Delta 编码
可变长数据        偏移量数组（Offset Array）  定义级别 + 重复级别
典型用途          进程间传递、计算引擎      数据湖持久化存储
```

            

简而言之：Parquet 解决”数据怎么高效地存到磁盘”，Arrow
            解决”数据怎么高效地在内存中表示和传递”。两者是互补的——从
            Parquet 文件读取数据后，直接解码为 Arrow
            格式放入内存，就可以开始计算，不需要再做额外的转换。
            
            

## 二、Arrow 内存布局

            

### 2.1 核心概念：缓冲区

            

Arrow 的内存布局基于三种缓冲区（Buffer）：
            
            
- 有效性位图缓冲区（Validity Bitmap
            Buffer）：每一位（Bit）对应一个元素，标记该元素是否为空值（Null）。位值为
            1 表示有效，位值为 0 表示空值。
            
- 偏移量缓冲区（Offset
            Buffer）：用于变长类型（Variable-Length
            Type），存储每个元素在数据缓冲区中的起止位置。
            
- 数据缓冲区（Data Buffer）：存储实际的数据值。
            
            

所有缓冲区都是连续的内存区域，按 64 字节边界对齐（64-Byte
            Aligned），以便利用 SIMD（Single Instruction, Multiple
            Data）指令进行向量化处理。
            

### 2.2 定长类型的布局

            

对于定长类型（Fixed-Width Type），如
            Int32、Int64、Float64、Boolean，布局非常简单：一个有效性位图加一个数据缓冲区。
            

以一个包含 5 个 Int32 值的数组
            `[1, null, 3, 4, null]` 为例：
            
```
Int32 数组 [1, null, 3, 4, null] 的内存布局

有效性位图缓冲区（Validity Bitmap Buffer）
┌───┬───┬───┬───┬───┬───┬───┬───┐
│ 1 │ 0 │ 1 │ 1 │ 0 │ 0 │ 0 │ 0 │   ← 1 字节，低位在前
└───┴───┴───┴───┴───┴───┴───┴───┘
 [0] [1] [2] [3] [4]  填充位

数据缓冲区（Data Buffer）
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│  1(0x01) │ 未定义   │  3(0x03) │  4(0x04) │ 未定义   │  ← 20 字节
└──────────┴──────────┴──────────┴──────────┴──────────┘
  4 bytes    4 bytes    4 bytes    4 bytes    4 bytes
```

            

关键细节：
            
            
- 空值位置的数据缓冲区内容是未定义的（Undefined），不是零。这意味着
            Arrow 不会为空值做特殊的数据存储，只通过位图标记。
            
- 位图采用最低有效位优先（Least Significant Bit
            First）的顺序。第 i 个元素的有效性由第 `i / 8`
            个字节的第 `i % 8` 位决定。
            
- 所有缓冲区的长度按 64 字节对齐填充（Padding）。
            
            

用 Python 验证这个布局：
            
```
# PyArrow 验证 Int32 数组内存布局
import pyarrow as pa

arr = pa.array([1, None, 3, 4, None], type=pa.int32())

# 查看缓冲区
buffers = arr.buffers()
print(f"缓冲区数量: {len(buffers)}")          # 2
print(f"有效性位图: {buffers[0].hex()}")       # 0d -> 二进制 00001101 -> 位 0,2,3 有效
print(f"数据缓冲区: {buffers[1].hex()}")       # 01000000 00000000 03000000 04000000 00000000

# 验证空值
print(f"is_null: {arr.is_null().to_pylist()}")  # [False, True, False, False, True]
print(f"null_count: {arr.null_count}")          # 2
```

            

### 2.3 变长类型的布局

            

对于变长类型（Variable-Width Type），如 Utf8（字符串）和
            Binary（二进制），需要三个缓冲区：有效性位图、偏移量缓冲区和数据缓冲区。
            

以字符串数组 `["hello", null, "arrow", "db"]`
            为例：
            
```
Utf8 字符串数组 ["hello", null, "arrow", "db"] 的内存布局

有效性位图缓冲区（Validity Bitmap Buffer）
┌───┬───┬───┬───┬───┬───┬───┬───┐
│ 1 │ 0 │ 1 │ 1 │ 0 │ 0 │ 0 │ 0 │   ← 1 字节
└───┴───┴───┴───┴───┴───┴───┴───┘
 [0] [1] [2] [3]  填充位

偏移量缓冲区（Offset Buffer）— int32 偏移
┌─────┬─────┬─────┬─────┬─────┐
│  0  │  5  │  5  │ 10  │ 12  │   ← (n+1) 个 int32 值，共 20 字节
└─────┴─────┴─────┴─────┴─────┘
 [0]   [1]   [2]   [3]   [4]

数据缓冲区（Data Buffer）
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│ h │ e │ l │ l │ o │ a │ r │ r │ o │ w │ d │ b │  ← 12 字节
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
  0   1   2   3   4   5   6   7   8   9  10  11
```

            

第 i 个字符串的内容是
            `data_buffer[offset[i] : offset[i+1]]`。空值元素（索引
            1）的偏移量是 `[5, 5]`，长度为
            0，数据缓冲区中不存储任何内容。
            
```
# PyArrow 验证 Utf8 数组内存布局
import pyarrow as pa

arr = pa.array(["hello", None, "arrow", "db"], type=pa.utf8())

buffers = arr.buffers()
print(f"缓冲区数量: {len(buffers)}")           # 3
print(f"有效性位图: {buffers[0].hex()}")        # 0d
print(f"偏移量缓冲区: {buffers[1].hex()}")      # 偏移量的小端序表示
print(f"数据缓冲区: {buffers[2].to_pybytes()}")  # b'helloarrowdb'
```

            

### 2.4 大偏移量变长类型

            

标准 Utf8 类型使用 32 位偏移量（Int32 Offset），最大支持
            2GB 的数据缓冲区。对于超大字符串列，Arrow
            提供大偏移量变长类型（Large Variable-Width Type），使用 64
            位偏移量（Int64 Offset），理论上支持 2^63
            字节的数据缓冲区：
            
```
# 大偏移量字符串类型
import pyarrow as pa

# 标准 Utf8：32 位偏移量
arr_utf8 = pa.array(["hello", "world"], type=pa.utf8())

# 大 Utf8：64 位偏移量
arr_large_utf8 = pa.array(["hello", "world"], type=pa.large_utf8())

buffers_utf8 = arr_utf8.buffers()
buffers_large = arr_large_utf8.buffers()

print(f"标准 Utf8 偏移量缓冲区大小: {buffers_utf8[1].size}")     # 12 (3 * 4 字节)
print(f"大 Utf8 偏移量缓冲区大小: {buffers_large[1].size}")       # 24 (3 * 8 字节)
```

            

### 2.5 嵌套类型的布局

            

Arrow 支持多种嵌套类型（Nested
            Type），包括列表（List）、结构体（Struct）和联合体（Union）。
            

**列表类型（List Type）**
            的布局与变长字符串类似，但数据缓冲区被替换为一个子数组（Child
            Array）：
            
```
List 数组 [[1, 2], null, [3]] 的内存布局

有效性位图
┌───┬───┬───┐
│ 1 │ 0 │ 1 │
└───┴───┴───┘

偏移量缓冲区
┌───┬───┬───┬───┐
│ 0 │ 2 │ 2 │ 3 │
└───┴───┴───┴───┘

子数组（Int32 数组 [1, 2, 3]）
  有效性位图: [1, 1, 1]
  数据缓冲区: [1, 2, 3]
```

            

**结构体类型（Struct Type）**
            由一个有效性位图和多个子数组组成，每个子数组对应结构体的一个字段（Field）：
            
```
# 结构体类型示例
import pyarrow as pa

struct_type = pa.struct([
    pa.field("name", pa.utf8()),
    pa.field("age", pa.int32()),
])

arr = pa.array([
    {"name": "Alice", "age": 30},
    {"name": "Bob", "age": None},
    None,
], type=struct_type)

print(f"字段数量: {arr.type.num_fields}")       # 2
print(f"name 子数组: {arr.field('name')}")       # ["Alice", "Bob", null]
print(f"age 子数组: {arr.field('age')}")         # [30, null, null]
```

            

### 2.6 字典编码类型

            

字典编码类型（Dictionary Encoded Type）是 Arrow
            中非常重要的优化手段，适用于低基数（Low
            Cardinality）列——即不同值的数量远少于行数的列。
            

字典编码将数据拆分为两部分：字典数组（Dictionary
            Array）存储不重复的值，索引数组（Index
            Array）存储每一行对应字典中的位置：
            
```
字典编码示例：["red", "blue", "red", "red", "blue", "green"]

字典数组（Dictionary）: ["red", "blue", "green"]

索引数组（Indices）:    [0, 1, 0, 0, 1, 2]

内存节省：
  原始存储: 6 个字符串，总计约 28 字节数据 + 28 字节偏移量
  字典编码: 3 个字符串(~14 字节) + 6 个 int8 索引(6 字节)
```

            
```
# 字典编码类型
import pyarrow as pa

arr = pa.array(["red", "blue", "red", "red", "blue", "green"])
dict_arr = arr.dictionary_encode()

print(f"类型: {dict_arr.type}")                       # dictionary
print(f"字典: {dict_arr.dictionary.to_pylist()}")      # ['red', 'blue', 'green']
print(f"索引: {dict_arr.indices.to_pylist()}")         # [0, 1, 0, 0, 1, 2]
```

            

### 2.7 内存对齐与填充

            

Arrow 规范要求所有缓冲区的起始地址按 64 字节对齐（8
            字节的最低要求，推荐 64 字节），缓冲区长度也按 64
            字节填充。这种对齐策略有三个目的：
            
```
Arrow 内存对齐的目的

1. SIMD 友好
   AVX-512 指令需要 64 字节对齐的内存地址
   对齐后可以使用 _mm512_load_si512 而不是 _mm512_loadu_si512
   对齐加载的吞吐量通常比未对齐加载高 10-30%

2. 缓存行友好（Cache Line Friendly）
   现代 CPU 的 L1 缓存行（Cache Line）通常为 64 字节
   64 字节对齐保证一个缓冲区的起始不会跨越缓存行边界
   减少伪共享（False Sharing）

3. 内存映射友好
   64 字节对齐与操作系统页面大小（4KB/2MB）自然兼容
   方便使用 mmap 将 Arrow 缓冲区映射到共享内存（Shared Memory）
```

            
            

## 三、Arrow
            IPC（零拷贝进程间通信）

            

### 3.1 IPC 的设计目标

            

Arrow IPC（Inter-Process
            Communication）协议的核心目标是：将 Arrow
            格式的内存数据传递给另一个进程，接收方不需要做任何反序列化，直接把收到的字节解释为
            Arrow 缓冲区——真正的零拷贝。
            

IPC 协议基于 Google FlatBuffers
            定义元数据（Metadata），数据体（Body）则直接是 Arrow
            格式的原始字节。接收方只需要解析几十字节的 FlatBuffers
            元数据（Schema、RecordBatch
            描述信息），就知道数据体中每个缓冲区的偏移量和长度，然后直接把数据体当作
            Arrow 缓冲区使用。
            

### 3.2 IPC 消息格式

            

每条 IPC 消息（Message）由三部分组成：
            
```
Arrow IPC 消息格式

┌─────────────────────┐
│  续行标记（4 字节）    │  固定值 0xFFFFFFFF，用于区分旧版格式
├─────────────────────┤
│  元数据长度（4 字节）  │  FlatBuffers 元数据的字节长度
├─────────────────────┤
│  元数据（FlatBuffers）│  Schema / RecordBatch / DictionaryBatch 描述
│  (变长，按 8 字节对齐) │
├─────────────────────┤
│  数据体（Body）       │  Arrow 格式的原始缓冲区，按 64 字节对齐
│  (变长)              │
└─────────────────────┘
```

            

IPC 支持两种消息类型：
            
            
- **Schema
            消息**：描述数据的类型结构（字段名、字段类型、是否可空等），只在传输开始时发送一次。
            
- **RecordBatch
            消息**：包含一批数据，元数据描述每个缓冲区在数据体中的偏移量和长度，数据体是所有缓冲区按顺序拼接。
            
            

### 3.3 IPC 流格式与文件格式

            

Arrow IPC 定义了两种传输格式：
            
```
IPC 流格式（Streaming Format）

Schema ──► RecordBatch ──► RecordBatch ──► ... ──► EOS(End of Stream)

适用场景：管道（Pipe）、Socket、标准输入/输出
特点：顺序读取，不支持随机访问，可以流式处理
```

            
```
IPC 文件格式（File Format），又称 Feather V2

┌─────────────────┐
│  ARROW1 魔数      │  6 字节
├─────────────────┤
│  填充             │  对齐到 8 字节
├─────────────────┤
│  RecordBatch 1   │
├─────────────────┤
│  RecordBatch 2   │
├─────────────────┤
│  ...             │
├─────────────────┤
│  Schema          │
├─────────────────┤
│  Footer          │  包含 Schema 和所有 RecordBatch 的偏移量索引
├─────────────────┤
│  Footer 长度      │  4 字节
├─────────────────┤
│  ARROW1 魔数      │  6 字节
└─────────────────┘

适用场景：文件存储，支持随机访问
特点：Footer 包含索引，可以直接跳转到任意 RecordBatch
```

            

### 3.4 IPC 读写示例

            
```
# Arrow IPC 流格式写入与读取
import pyarrow as pa

# 构造数据
schema = pa.schema([
    pa.field("id", pa.int64()),
    pa.field("name", pa.utf8()),
    pa.field("score", pa.float64()),
])

batch1 = pa.record_batch(
    [pa.array([1, 2, 3]),
     pa.array(["Alice", "Bob", "Charlie"]),
     pa.array([95.5, 87.3, 91.0])],
    schema=schema,
)

batch2 = pa.record_batch(
    [pa.array([4, 5]),
     pa.array(["David", "Eve"]),
     pa.array([88.0, 93.2])],
    schema=schema,
)

# 写入 IPC 流格式
sink = pa.BufferOutputStream()
writer = pa.ipc.new_stream(sink, schema)
writer.write_batch(batch1)
writer.write_batch(batch2)
writer.close()

buf = sink.getvalue()
print(f"IPC 流数据大小: {buf.size} 字节")

# 从 IPC 流读取（零拷贝）
reader = pa.ipc.open_stream(buf)
print(f"Schema: {reader.schema}")

batches = []
while True:
    try:
        batch = reader.read_next_batch()
        batches.append(batch)
    except StopIteration:
        break

print(f"读取到 {len(batches)} 个 RecordBatch")
print(f"总行数: {sum(b.num_rows for b in batches)}")
```

            
```
# Arrow IPC 文件格式（Feather V2）写入与读取
import pyarrow as pa
import pyarrow.feather as feather

table = pa.table({
    "id": pa.array([1, 2, 3, 4, 5]),
    "city": pa.array(["Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Hangzhou"]),
    "population_m": pa.array([21.54, 24.87, 18.68, 17.56, 12.20]),
})

# 写入 Feather 文件
feather.write_feather(table, "cities.arrow")

# 读取 Feather 文件（零拷贝内存映射）
table_read = feather.read_table("cities.arrow")
print(table_read.to_pandas())
```

            

### 3.5 零拷贝的实现机制

            

IPC 之所以能实现零拷贝，关键在于 Arrow
            的数据体就是内存中的原始布局。接收方拿到字节流后：
            
```
IPC 零拷贝的工作原理

发送方内存                        接收方内存
┌─────────────────┐              ┌─────────────────┐
│ Validity Bitmap  │──────────────│ Validity Bitmap  │
│ (原始字节)       │   直接映射    │ (同样的字节)     │
├─────────────────┤              ├─────────────────┤
│ Offset Buffer    │──────────────│ Offset Buffer    │
│ (原始字节)       │   直接映射    │ (同样的字节)     │
├─────────────────┤              ├─────────────────┤
│ Data Buffer      │──────────────│ Data Buffer      │
│ (原始字节)       │   直接映射    │ (同样的字节)     │
└─────────────────┘              └─────────────────┘

不需要：
  - 字节序转换（Arrow 规范固定小端序）
  - 类型解析（FlatBuffers 元数据已描述）
  - 内存重分配（直接引用接收到的缓冲区）
```

            

在同一台机器上，如果通过共享内存（Shared Memory）传递 IPC
            数据，甚至可以完全避免数据拷贝——两个进程映射同一块物理内存，发送方写入，接收方直接读取。
            

### 3.6 IPC 与共享内存

            

在高性能场景中，Arrow IPC 可以与操作系统的共享内存（POSIX
            Shared Memory）结合，实现进程间真正的零拷贝：
            
```
# 使用 Plasma 对象存储实现共享内存零拷贝（概念示意）
import pyarrow as pa
import pyarrow.ipc as ipc
import mmap
import os

# 创建共享内存区域
shm_size = 1024 * 1024  # 1MB
fd = os.open("/dev/shm/arrow_shm", os.O_CREAT | os.O_RDWR)
os.ftruncate(fd, shm_size)

# 写入方：将 Arrow 数据写入共享内存
table = pa.table({"x": pa.array(range(10000)), "y": pa.array(range(10000))})
sink = pa.BufferOutputStream()
writer = ipc.new_stream(sink, table.schema)
writer.write_table(table)
writer.close()

buf = sink.getvalue()
mm = mmap.mmap(fd, shm_size)
mm.write(buf.to_pybytes())
mm.close()
os.close(fd)

# 读取方：从共享内存直接读取 Arrow 数据
fd2 = os.open("/dev/shm/arrow_shm", os.O_RDONLY)
mm2 = mmap.mmap(fd2, shm_size, prot=mmap.PROT_READ)
reader = ipc.open_stream(pa.py_buffer(mm2[:buf.size]))
result = reader.read_all()
print(f"共享内存零拷贝读取: {result.num_rows} 行")
mm2.close()
os.close(fd2)
```

            
            

## 四、Arrow
            Flight（基于 gRPC 的网络协议）

            

### 4.1 传统数据传输的瓶颈

            

ODBC（Open Database Connectivity）和 JDBC（Java Database
            Connectivity）是最常见的数据库客户端协议，但它们在大规模数据传输场景下有严重的性能问题：
            
```
ODBC/JDBC 数据传输的瓶颈

1. 行式序列化
   结果集逐行编码为网络协议格式
   每行都有元数据开销（列分隔符、类型标记等）

2. 类型转换
   数据库内部类型 → 协议格式 → 客户端语言类型
   每个值经过两次转换

3. 单流传输
   所有数据通过一个 TCP 连接顺序传输
   无法利用多核 CPU 和并行网络路径

4. 不可组合
   客户端不能告诉服务器"只给我第 3 到第 7 个分区"
   服务器无法将数据分散到多个端点（Endpoint）并行传输
```

            

### 4.2 Flight 协议概述

            

Arrow Flight 是一种基于 gRPC 的数据传输协议（gRPC-Based
            Data Transfer
            Protocol），专门为高性能批量数据传输设计。核心特点：
            
```
Arrow Flight 协议特点

1. 列式传输
   数据以 Arrow RecordBatch 格式在网络上传输
   接收方零反序列化，直接使用

2. 并行流
   一个数据集可以被分割为多个端点（Endpoint）
   客户端并行从多个端点拉取数据

3. 元数据与数据分离
   GetFlightInfo: 获取数据集的元数据和端点列表
   DoGet: 从指定端点拉取数据
   DoPut: 向指定端点推送数据

4. 双向流
   基于 gRPC 的双向流（Bidirectional Streaming）
   支持流式查询结果和流式数据写入
```

            

### 4.3 Flight RPC 接口

            

Flight 定义了以下核心 RPC（Remote Procedure
            Call）方法：
            
```
Arrow Flight RPC 接口

方法                描述                              方向
───────────────────────────────────────────────────────────
GetFlightInfo       获取数据集的元数据和端点列表        客户端 → 服务器
GetSchema           仅获取数据集的 Schema               客户端 → 服务器
DoGet               从端点流式拉取数据                  服务器 → 客户端（流）
DoPut               向端点流式推送数据                  客户端 → 服务器（流）
DoExchange          双向流式交换数据                    双向流
DoAction            执行自定义操作                      客户端 → 服务器
ListFlights         列出可用的数据集                    客户端 → 服务器
ListActions         列出支持的自定义操作                客户端 → 服务器
```

            

### 4.4 Flight 工作流程

            

一次典型的 Flight 数据获取流程：
            
```
Flight DoGet 工作流程

客户端                          服务器
  │                               │
  │  GetFlightInfo(descriptor)    │
  │──────────────────────────────►│
  │                               │  查找数据集，计算分区
  │  FlightInfo{                  │
  │    schema: ...,               │
  │    endpoints: [               │
  │      {ticket: t1, locations: [server1]},
  │      {ticket: t2, locations: [server2]},
  │    ],                         │
  │    total_records: 10000000,   │
  │    total_bytes: 80000000,     │
  │  }                           │
  │◄──────────────────────────────│
  │                               │
  │  DoGet(ticket=t1)             │  并行拉取
  │──────────────────────────────►│  server1
  │  RecordBatch 流               │
  │◄══════════════════════════════│
  │                               │
  │  DoGet(ticket=t2)             │  并行拉取
  │──────────────────────────────►│  server2
  │  RecordBatch 流               │
  │◄══════════════════════════════│
```

            

### 4.5 Flight
            服务器与客户端示例

            
```
# Arrow Flight 服务器示例
import pyarrow as pa
import pyarrow.flight as flight

class SimpleFlightServer(flight.FlightServerBase):
    """一个简单的 Flight 数据服务器"""

    def __init__(self, location, **kwargs):
        super().__init__(location, **kwargs)
        # 预生成一些测试数据
        self._tables = {}
        self._tables["sensor_data"] = pa.table({
            "timestamp": pa.array(range(0, 100000)),
            "sensor_id": pa.array([f"s{i % 100}" for i in range(100000)]),
            "temperature": pa.array([20.0 + (i % 50) * 0.1 for i in range(100000)]),
            "humidity": pa.array([40.0 + (i % 30) * 0.5 for i in range(100000)]),
        })

    def get_flight_info(self, context, descriptor):
        """返回数据集的元数据和端点列表"""
        key = descriptor.path[0].decode("utf-8")
        table = self._tables[key]
        schema = table.schema

        # 构造端点信息
        endpoints = [
            flight.FlightEndpoint(
                ticket=flight.Ticket(key.encode("utf-8")),
                locations=[],
            )
        ]

        return flight.FlightInfo(
            schema=schema,
            descriptor=descriptor,
            endpoints=endpoints,
            total_records=table.num_rows,
            total_bytes=table.nbytes,
        )

    def do_get(self, context, ticket):
        """流式返回数据"""
        key = ticket.ticket.decode("utf-8")
        table = self._tables[key]
        return flight.RecordBatchStream(table)

    def do_put(self, context, descriptor, reader, writer):
        """接收客户端推送的数据"""
        key = descriptor.path[0].decode("utf-8")
        table = reader.read_all()
        self._tables[key] = table
        print(f"收到数据集 '{key}': {table.num_rows} 行")

# 启动服务器
# server = SimpleFlightServer("grpc://0.0.0.0:8815")
# server.serve()
```

            
```
# Arrow Flight 客户端示例
import pyarrow.flight as flight

def flight_client_example():
    """Flight 客户端获取数据"""
    client = flight.connect("grpc://localhost:8815")

    # 获取数据集元数据
    descriptor = flight.FlightDescriptor.for_path("sensor_data")
    info = client.get_flight_info(descriptor)
    print(f"数据集行数: {info.total_records}")
    print(f"数据集大小: {info.total_bytes} 字节")
    print(f"Schema: {info.schema}")

    # 拉取数据（零反序列化）
    for endpoint in info.endpoints:
        reader = client.do_get(endpoint.ticket)
        table = reader.read_all()
        print(f"收到 {table.num_rows} 行数据")

    # 推送数据
    import pyarrow as pa
    upload_table = pa.table({
        "id": pa.array([1, 2, 3]),
        "value": pa.array([10.0, 20.0, 30.0]),
    })
    descriptor = flight.FlightDescriptor.for_path("my_data")
    writer, _ = client.do_put(descriptor, upload_table.schema)
    writer.write_table(upload_table)
    writer.close()

# flight_client_example()
```

            

### 4.6 Flight SQL

            

Arrow Flight SQL 是 Flight 协议的扩展（Extension），为
            SQL 查询场景提供标准化的 RPC 接口。它的目标是替代
            ODBC/JDBC，成为下一代数据库客户端协议：
            
```
Flight SQL 相比 ODBC/JDBC 的优势

维度              ODBC/JDBC                  Flight SQL
─────────────────────────────────────────────────────────────
数据格式          行式                        列式（Arrow RecordBatch）
序列化开销        每个值都要编码/解码         零反序列化
并行传输          单连接                      多端点并行
类型系统          协议自定义类型              Arrow 类型系统
元数据发现        DatabaseMetaData 接口       标准 RPC（GetTables/GetColumns 等）
跨语言支持        每种语言单独实现驱动        gRPC 自动生成各语言客户端
```

            
```
# Flight SQL 客户端示例（概念代码）
import pyarrow.flight as flight

def flight_sql_example():
    """使用 Flight SQL 执行查询"""
    client = flight.connect("grpc://localhost:8815")

    # 通过 DoAction 执行 SQL 查询
    # 实际使用中需要 FlightSqlClient 封装
    sql = "SELECT sensor_id, AVG(temperature) FROM readings GROUP BY sensor_id"

    # Flight SQL 会将查询结果作为 Arrow RecordBatch 流返回
    # 客户端直接获得 Arrow 格式的数据，无需反序列化
    print(f"查询: {sql}")
    print("结果将以 Arrow RecordBatch 流返回")

# flight_sql_example()
```

            
            

## 五、Arrow Compute
            内核（向量化运算）

            

### 5.1 为什么需要 Compute
            内核

            

有了统一的内存格式，下一步自然是在这个格式上直接做计算，而不是先把数据转换为某种语言的原生数组再计算。Arrow
            Compute 内核（Compute
            Kernel）提供了一组高度优化的向量化操作（Vectorized
            Operations），直接在 Arrow
            缓冲区上执行，避免了数据转换的开销。
            

Compute 内核的特点：
            
```
Arrow Compute 内核特点

1. 零拷贝输入
   内核直接在 Arrow 缓冲区上操作，不需要将数据拷贝到中间缓冲区

2. 空值传播（Null Propagation）
   所有内核自动处理空值位图，不需要调用方做空值检查

3. SIMD 优化
   关键操作（比较、算术、过滤）使用 SIMD 指令加速
   支持 SSE4.2、AVX2、AVX-512、NEON 指令集

4. 内核分发（Kernel Dispatch）
   根据输入类型自动选择最优实现
   例如 Int32 加法和 Float64 加法使用不同的代码路径

5. 类型安全
   编译时和运行时都会检查输入类型是否匹配
```

            

### 5.2 常用 Compute 函数

            
```
# Arrow Compute 函数示例
import pyarrow as pa
import pyarrow.compute as pc

# 创建测试数据
arr = pa.array([10, 20, None, 40, 50])
arr2 = pa.array([1, 2, 3, 4, 5])

# 算术运算（Arithmetic Operations）
print(f"加法: {pc.add(arr, arr2).to_pylist()}")         # [11, 22, None, 44, 55]
print(f"乘法: {pc.multiply(arr, arr2).to_pylist()}")     # [10, 40, None, 160, 250]
print(f"求和: {pc.sum(arr).as_py()}")                    # 120（自动跳过空值）
print(f"均值: {pc.mean(arr).as_py()}")                   # 30.0

# 比较运算（Comparison Operations）
print(f"大于 25: {pc.greater(arr, 25).to_pylist()}")     # [False, False, None, True, True]

# 过滤（Filter）
mask = pc.greater(arr, 15)
print(f"过滤 >15: {pc.filter(arr, mask).to_pylist()}")   # [20, 40, 50]

# 排序（Sort）
arr3 = pa.array([30, 10, 50, 20, 40])
indices = pc.sort_indices(arr3)
print(f"排序索引: {indices.to_pylist()}")                # [1, 3, 0, 4, 2]
print(f"排序结果: {pc.take(arr3, indices).to_pylist()}")  # [10, 20, 30, 40, 50]
```

            

### 5.3 字符串操作

            
```
# Arrow Compute 字符串操作
import pyarrow as pa
import pyarrow.compute as pc

arr = pa.array(["Hello World", "Arrow Compute", None, "data engineering"])

# 字符串变换
print(f"转大写: {pc.utf8_upper(arr).to_pylist()}")
# ['HELLO WORLD', 'ARROW COMPUTE', None, 'DATA ENGINEERING']

print(f"转小写: {pc.utf8_lower(arr).to_pylist()}")
# ['hello world', 'arrow compute', None, 'data engineering']

print(f"字符串长度: {pc.utf8_length(arr).to_pylist()}")
# [11, 13, None, 16]

# 字符串匹配
print(f"包含 'World': {pc.match_substring(arr, 'World').to_pylist()}")
# [True, False, None, False]

# 字符串分割
print(f"按空格分割: {pc.utf8_split_whitespace(arr).to_pylist()}")
# [['Hello', 'World'], ['Arrow', 'Compute'], None, ['data', 'engineering']]
```

            

### 5.4 聚合操作

            
```
# Arrow Compute 聚合操作
import pyarrow as pa
import pyarrow.compute as pc

table = pa.table({
    "category": pa.array(["A", "B", "A", "B", "A", "C"]),
    "value": pa.array([10, 20, 30, 40, 50, 60]),
    "weight": pa.array([1.0, 1.5, 2.0, 0.5, 1.0, 3.0]),
})

# 标量聚合（Scalar Aggregation）
print(f"总和: {pc.sum(table['value']).as_py()}")           # 210
print(f"最大值: {pc.max(table['value']).as_py()}")         # 60
print(f"最小值: {pc.min(table['value']).as_py()}")         # 10
print(f"标准差: {pc.stddev(table['value']).as_py():.2f}")  # 17.08
print(f"计数: {pc.count(table['value']).as_py()}")         # 6

# 分组聚合（Group-By Aggregation）
grouped = table.group_by("category").aggregate([
    ("value", "sum"),
    ("value", "mean"),
    ("value", "count"),
])
print("分组聚合结果:")
print(grouped.to_pandas())
# category  value_sum  value_mean  value_count
# A         90         30.0        3
# B         60         30.0        2
# C         60         60.0        1
```

            

### 5.5 Compute 内核的 SIMD
            优化

            

Arrow Compute 内核在底层大量使用 SIMD 指令。以一个简单的
            Int64 数组过滤操作为例，Arrow 使用 AVX2 或 AVX-512
            指令一次处理多个元素：
            
```
SIMD 向量化过滤的工作原理

普通标量过滤（逐元素处理）：
  for i in range(n):
      if data[i] > threshold:
          output[j] = data[i]
          j += 1
  每次循环处理 1 个元素

AVX2 向量化过滤（256 位寄存器）：
  for i in range(0, n, 4):                     # Int64 时每次 4 个
      vec = _mm256_loadu_si256(data + i)        # 加载 4 个 Int64
      cmp = _mm256_cmpgt_epi64(vec, threshold)  # 4 个比较同时执行
      mask = _mm256_movemask_epi8(cmp)          # 提取比较结果掩码
      # 使用 PEXT/PDEP 或查表法压缩存储
  每次循环处理 4 个元素

AVX-512 向量化过滤（512 位寄存器）：
  每次循环处理 8 个 Int64 元素
  使用原生 VCOMPRESSQ 指令直接压缩存储
```

            
```
// Arrow C++ 内核中的 SIMD 比较示例（简化）
// 文件：cpp/src/arrow/compute/kernels/vector_selection.cc

#include 

// AVX2 实现的 Int64 大于比较
void CompareGtInt64AVX2(const int64_t* data, int64_t threshold,
                        uint8_t* output_bitmap, int64_t length) {
    __m256i thresh_vec = _mm256_set1_epi64x(threshold);

    for (int64_t i = 0; i (data + i));
        __m256i cmp = _mm256_cmpgt_epi64(data_vec, thresh_vec);
        int mask = _mm256_movemask_epi8(cmp);
        // 将比较结果写入位图
        output_bitmap[i / 8] |= static_cast(
            __builtin_popcount(mask & 0x000000FF) > 0 ? (1 
            
            

## 六、Arrow 在 Pandas
            中的应用

            

### 6.1 Pandas 的内存问题

            

传统 Pandas 基于 NumPy 数组存储数据，存在几个问题：
            
```
Pandas 传统内存表示的问题

1. 字符串存储效率低
   每个字符串是一个 Python 对象，存在对象头开销（28+ 字节）
   一个包含 100 万个短字符串的列，对象头开销可能超过实际数据

2. 空值处理不统一
   数值列用 NaN 表示空值，但 NaN 是浮点数，整数列被强制转为浮点
   字符串列用 None（Python 对象）表示空值
   布尔列用 np.nan 表示空值，类型变为 object

3. 内存不可共享
   NumPy 数组不能跨进程共享
   每个进程都需要自己的数据副本

4. 扩展类型受限
   日期、时间、十进制数等类型用 object 数组存储
   失去了向量化计算的能力
```

            

### 6.2
            ArrowDtype：Pandas 的 Arrow 后端

            

从 Pandas 2.0 开始，Pandas 引入了 ArrowDtype，允许使用
            Arrow 数组作为 DataFrame 列的底层存储：
            
```
# Pandas ArrowDtype 使用示例
import pandas as pd
import pyarrow as pa

# 创建使用 Arrow 后端的 DataFrame
df = pd.DataFrame({
    "id": pd.array([1, 2, 3, None, 5], dtype="int64[pyarrow]"),
    "name": pd.array(["Alice", "Bob", None, "David", "Eve"], dtype="string[pyarrow]"),
    "score": pd.array([95.5, 87.3, None, 88.0, 93.2], dtype="float64[pyarrow]"),
    "active": pd.array([True, False, True, None, True], dtype="bool[pyarrow]"),
})

print(df.dtypes)
# id        int64[pyarrow]
# name     string[pyarrow]
# score   float64[pyarrow]
# active     bool[pyarrow]

# Arrow 后端的优势：整数列可以有空值而不被转为浮点
print(f"id 列空值: {df['id'].isna().sum()}")    # 1
print(f"id 列类型: {df['id'].dtype}")            # int64[pyarrow]（不是 float64）
```

            

### 6.3 内存对比

            
```
# 内存使用对比：NumPy vs Arrow 后端
import pandas as pd
import numpy as np

n = 1_000_000

# NumPy 后端（传统方式）
df_numpy = pd.DataFrame({
    "id": np.arange(n),
    "category": np.random.choice(["A", "B", "C", "D", "E"], n),
    "value": np.random.randn(n),
})

# Arrow 后端
df_arrow = pd.DataFrame({
    "id": pd.array(range(n), dtype="int64[pyarrow]"),
    "category": pd.array(
        np.random.choice(["A", "B", "C", "D", "E"], n),
        dtype="string[pyarrow]",
    ),
    "value": pd.array(np.random.randn(n), dtype="float64[pyarrow]"),
})

print(f"NumPy 后端内存: {df_numpy.memory_usage(deep=True).sum() / 1024**2:.1f} MB")
print(f"Arrow 后端内存: {df_arrow.memory_usage(deep=True).sum() / 1024**2:.1f} MB")

# 字符串列的差异最为明显
print(f"\nNumPy 字符串列内存: "
      f"{df_numpy['category'].memory_usage(deep=True) / 1024**2:.1f} MB")
print(f"Arrow 字符串列内存: "
      f"{df_arrow['category'].memory_usage(deep=True) / 1024**2:.1f} MB")
```

            

### 6.4 Pandas 与 Arrow
            的互转

            
```
# Pandas DataFrame 与 Arrow Table 的互转
import pandas as pd
import pyarrow as pa

# Pandas → Arrow（零拷贝，如果列是 Arrow 后端）
df = pd.DataFrame({
    "x": pd.array([1, 2, 3], dtype="int64[pyarrow]"),
    "y": pd.array([4.0, 5.0, 6.0], dtype="float64[pyarrow]"),
})

arrow_table = pa.Table.from_pandas(df)
print(f"Arrow Table 列数: {arrow_table.num_columns}")
print(f"Arrow Table 行数: {arrow_table.num_rows}")

# Arrow → Pandas（可选择使用 Arrow 后端）
df_back = arrow_table.to_pandas(types_mapper=pd.ArrowDtype)
print(f"转回 Pandas 后的类型: {df_back.dtypes.to_dict()}")

# 性能对比：读取 Parquet 文件
# 直接读为 Arrow 后端的 DataFrame，避免类型转换开销
import pyarrow.parquet as pq

# table = pq.read_table("data.parquet")
# df_arrow = table.to_pandas(types_mapper=pd.ArrowDtype)   # 快
# df_numpy = table.to_pandas()                              # 慢（需要转换）
```

            

### 6.5 read_csv 的 Arrow
            引擎

            

Pandas 2.x 提供了基于 Arrow 的 CSV 读取引擎（Arrow CSV
            Engine），通常比默认的 C 引擎更快：
            
```
# 使用 Arrow 引擎读取 CSV
import pandas as pd

# 传统 C 引擎
# df_c = pd.read_csv("large_file.csv", engine="c")

# Arrow 引擎（通常更快，尤其是大文件）
# df_arrow = pd.read_csv("large_file.csv", engine="pyarrow")

# Arrow 引擎的优势：
# 1. 多线程解析（C 引擎是单线程）
# 2. 直接生成 Arrow 数组，减少类型转换
# 3. 更好的类型推断

# 基准测试示例（概念代码）
import time

def benchmark_csv_engines(filepath):
    """对比 CSV 读取引擎性能"""
    # C 引擎
    start = time.perf_counter()
    # df_c = pd.read_csv(filepath, engine="c")
    c_time = time.perf_counter() - start

    # Arrow 引擎
    start = time.perf_counter()
    # df_arrow = pd.read_csv(filepath, engine="pyarrow")
    arrow_time = time.perf_counter() - start

    # print(f"C 引擎: {c_time:.2f}s")
    # print(f"Arrow 引擎: {arrow_time:.2f}s")
    # print(f"加速比: {c_time / arrow_time:.1f}x")
```

            
            

## 七、Arrow 在 Spark
            中的应用

            

### 7.1 Spark 与 Python
            的数据交换问题

            

PySpark 的一个核心挑战是 JVM 和 Python
            进程之间的数据传输。传统方式通过 Py4J（Python for
            Java）桥接，数据需要经过多次序列化/反序列化：
            
```
PySpark 传统数据交换路径

PySpark DataFrame.toPandas()：
  JVM (Tungsten 格式)
      │
      ▼  序列化为 Pickle/JSON
  Py4J 通道
      │
      ▼  反序列化 Pickle/JSON
  Python 进程
      │
      ▼  构建 NumPy 数组
  Pandas DataFrame

每一步都涉及数据拷贝和格式转换
对于 100 万行 x 10 列的 DataFrame，传输时间可能达到 10-30 秒
```

            

### 7.2 启用 Arrow 优化

            

Spark 3.x 内置了 Arrow 优化（Arrow
            Optimization），可以大幅加速 JVM 与 Python
            之间的数据传输：
            
```
# PySpark Arrow 优化配置
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("ArrowExample") \
    .config("spark.sql.execution.arrow.pyspark.enabled", "true") \
    .config("spark.sql.execution.arrow.pyspark.fallback.enabled", "true") \
    .config("spark.sql.execution.arrow.maxRecordsPerBatch", "10000") \
    .getOrCreate()

# 启用 Arrow 后，toPandas() 的数据传输路径变为：
#   JVM (Tungsten 格式)
#       │
#       ▼  转为 Arrow RecordBatch（列式）
#   Socket 通道（Arrow IPC 流）
#       │
#       ▼  零反序列化（直接映射为 Arrow 数组）
#   PyArrow RecordBatch
#       │
#       ▼  零拷贝转为 Pandas（如果使用 Arrow 后端）
#   Pandas DataFrame
```

            

### 7.3 toPandas 与
            createDataFrame 加速

            
```
# toPandas() 加速示例
from pyspark.sql import SparkSession
import pyarrow as pa

spark = SparkSession.builder \
    .config("spark.sql.execution.arrow.pyspark.enabled", "true") \
    .getOrCreate()

# 创建一个大型 Spark DataFrame
# df_spark = spark.range(10_000_000).withColumn("value", F.rand())

# 传统方式（慢）
# spark.conf.set("spark.sql.execution.arrow.pyspark.enabled", "false")
# df_pandas_slow = df_spark.toPandas()  # 可能需要 20-30 秒

# Arrow 优化（快）
# spark.conf.set("spark.sql.execution.arrow.pyspark.enabled", "true")
# df_pandas_fast = df_spark.toPandas()  # 通常 2-5 秒

# createDataFrame 也受益于 Arrow 优化
import pandas as pd
import numpy as np

pdf = pd.DataFrame({
    "id": range(100000),
    "value": np.random.randn(100000),
})

# 传统方式：逐行通过 Py4J 传输
# Arrow 方式：批量通过 Arrow IPC 传输
# df_spark = spark.createDataFrame(pdf)  # Arrow 启用后快 5-10 倍
```

            

### 7.4 Pandas UDF（向量化
            UDF）

            

Arrow 让 Spark 能够支持向量化用户定义函数（Vectorized
            UDF），即 Pandas UDF。传统的 Python UDF 逐行调用 Python
            函数，开销巨大；Pandas UDF 将数据批量传给 Python，以 Pandas
            Series 的形式处理：
            
```
# Pandas UDF 示例
from pyspark.sql import SparkSession
from pyspark.sql.functions import pandas_udf
import pandas as pd

spark = SparkSession.builder \
    .config("spark.sql.execution.arrow.pyspark.enabled", "true") \
    .getOrCreate()

# 传统 Python UDF（慢）
# @udf(returnType=DoubleType())
# def slow_multiply(x, y):
#     return x * y
# 每行都要：JVM → Python 序列化 → Python 函数调用 → Python → JVM 序列化

# Pandas UDF / 向量化 UDF（快）
@pandas_udf("double")
def fast_multiply(x: pd.Series, y: pd.Series) -> pd.Series:
    return x * y
# 批量传输：JVM → Arrow IPC → Pandas Series 批量计算 → Arrow IPC → JVM

# 使用
# df = spark.range(10_000_000)
# df = df.withColumn("value", F.rand())
# df = df.withColumn("result", fast_multiply(df["id"], df["value"]))
```

            
```
Python UDF vs Pandas UDF 性能对比

操作              Python UDF          Pandas UDF
────────────────────────────────────────────────
数据传输方式      逐行 Pickle          批量 Arrow IPC
Python 函数调用   每行一次             每批一次
向量化计算        不可能               NumPy/Pandas 向量化
典型加速比        1x（基准）           10x - 100x
适用场景          复杂逻辑             数值计算、字符串处理
```

            

### 7.5 Arrow 在 Spark
            中的局限

            

Arrow 优化不是万能的，有几个需要注意的限制：
            
```
Spark Arrow 优化的局限

1. 类型限制
   不是所有 Spark 类型都支持 Arrow 转换
   MapType、嵌套 ArrayType 可能退回到传统路径
   设置 fallback.enabled=true 以便自动回退

2. 内存压力
   Arrow RecordBatch 需要在 JVM 端和 Python 端各保留一份
   大数据集的 toPandas() 仍然可能 OOM
   使用 maxRecordsPerBatch 控制每批大小

3. 时区处理
   Arrow 的 Timestamp 类型需要显式时区
   Spark 的隐式时区转换可能导致意外行为

4. 字典编码
   Spark 的 StringType 转为 Arrow 时不自动字典编码
   如果字符串列基数很低，手动字典编码可以进一步减少传输量
```

            
            

## 八、DuckDB 与 Arrow
            集成

            

### 8.1 DuckDB 的 Arrow
            集成架构

            

DuckDB 是一个嵌入式分析数据库（Embedded Analytical
            Database），它与 Arrow 的集成是目前最深度的之一。DuckDB
            可以直接查询 Arrow 格式的数据，不需要任何数据拷贝：
            
```
DuckDB 与 Arrow 的集成架构

                    ┌──────────────────┐
                    │   DuckDB 查询引擎  │
                    │  (向量化执行)      │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Arrow Table│ │Pandas DF │ │Parquet   │
        │(零拷贝扫描)│ │(Arrow后端)│ │(直接读取) │
        └──────────┘ └──────────┘ └──────────┘

DuckDB 的向量化执行引擎（Vectorized Execution Engine）使用的内部格式
与 Arrow 高度兼容，可以直接将 Arrow RecordBatch 映射为 DuckDB 的
Vector 类型，实现零拷贝扫描。
```

            

### 8.2 直接查询 Arrow Table

            
```
# DuckDB 直接查询 Arrow Table
import duckdb
import pyarrow as pa

# 创建 Arrow Table
table = pa.table({
    "user_id": pa.array(range(1, 1000001)),
    "category": pa.array([f"cat_{i % 100}" for i in range(1000000)]),
    "amount": pa.array([float(i % 1000) for i in range(1000000)]),
    "timestamp": pa.array([f"2024-{(i % 12) + 1:02d}-01" for i in range(1000000)]),
})

# DuckDB 直接查询 Arrow Table（零拷贝）
result = duckdb.query("""
    SELECT category,
           COUNT(*) AS cnt,
           SUM(amount) AS total_amount,
           AVG(amount) AS avg_amount
    FROM table
    GROUP BY category
    ORDER BY total_amount DESC
    LIMIT 10
""")

print(result.to_df())
```

            

### 8.3 查询结果直接输出为
            Arrow

            
```
# DuckDB 查询结果输出为 Arrow Table
import duckdb
import pyarrow as pa

con = duckdb.connect()

# 创建内部表并插入数据
con.execute("""
    CREATE TABLE orders AS
    SELECT
        i AS order_id,
        'product_' || (i % 50)::VARCHAR AS product,
        (random() * 1000)::DECIMAL(10,2) AS price,
        (random() * 100)::INTEGER AS quantity,
        '2024-01-01'::DATE + INTERVAL (i % 365) DAY AS order_date
    FROM range(1000000) t(i)
""")

# 查询结果直接作为 Arrow Table 输出（零拷贝）
arrow_result = con.execute("""
    SELECT product,
           SUM(price * quantity) AS revenue,
           COUNT(*) AS order_count
    FROM orders
    GROUP BY product
    ORDER BY revenue DESC
    LIMIT 20
""").fetch_arrow_table()

print(f"结果类型: {type(arrow_result)}")     # 
print(f"结果行数: {arrow_result.num_rows}")
print(arrow_result.to_pandas().head())
```

            

### 8.4 DuckDB 与 Pandas
            Arrow 后端

            
```
# DuckDB 与 Pandas Arrow 后端的无缝集成
import duckdb
import pandas as pd
import pyarrow as pa

# 创建使用 Arrow 后端的 Pandas DataFrame
df = pd.DataFrame({
    "id": pd.array(range(100000), dtype="int64[pyarrow]"),
    "name": pd.array([f"user_{i}" for i in range(100000)], dtype="string[pyarrow]"),
    "score": pd.array([float(i % 100) for i in range(100000)], dtype="float64[pyarrow]"),
})

# DuckDB 直接查询 Pandas DataFrame
# 当 DataFrame 使用 Arrow 后端时，查询过程完全零拷贝
result = duckdb.query("""
    SELECT
        score,
        COUNT(*) AS cnt
    FROM df
    WHERE score > 50
    GROUP BY score
    ORDER BY cnt DESC
    LIMIT 10
""").to_df()

print(result)
```

            

### 8.5 流式处理大数据集

            
```
# DuckDB Arrow 流式处理大数据集
import duckdb
import pyarrow as pa

con = duckdb.connect()

# 创建大表
con.execute("""
    CREATE TABLE big_table AS
    SELECT
        i AS id,
        random() AS value
    FROM range(10000000) t(i)
""")

# 使用 Arrow RecordBatch Reader 流式读取
# 避免一次性将整个结果集加载到内存
reader = con.execute("""
    SELECT id, value, value * value AS value_squared
    FROM big_table
    WHERE value > 0.5
""").fetch_arrow_reader(batch_size=100000)

total_rows = 0
for batch in reader:
    total_rows += batch.num_rows
    # 在这里对每个 batch 做处理
    # 例如写入 Parquet 文件、发送到远端等

print(f"总行数: {total_rows}")
```

            
            

## 九、Arrow 性能实测

            

### 9.1 测试环境

            
```
性能测试环境

硬件
  CPU: AMD EPYC 7763 64 核 @ 2.45GHz
  内存: 256GB DDR4-3200 ECC
  存储: Samsung PM9A3 3.84TB NVMe SSD
  网络: 25Gbps Mellanox ConnectX-6

软件
  OS: Ubuntu 22.04 LTS，内核 5.15.0
  Python: 3.11.7
  PyArrow: 15.0.0
  Pandas: 2.2.0
  DuckDB: 1.0.0
  PySpark: 3.5.0
```

            

### 9.2 序列化/反序列化对比

            
```
序列化/反序列化性能对比（100 万行 x 10 列，混合类型）

格式              序列化耗时    反序列化耗时    数据大小      总开销
─────────────────────────────────────────────────────────────────
CSV               3.2s          4.8s           312MB        8.0s
JSON              5.1s          7.3s           485MB       12.4s
Pickle            0.8s          1.2s           168MB        2.0s
Arrow IPC 流      0.12s         0.03s          82MB         0.15s
Arrow IPC 文件    0.15s         0.05s          84MB         0.20s
Parquet(Snappy)   0.45s         0.28s          35MB         0.73s

注：Arrow IPC 的反序列化时间极短，因为几乎不需要做数据转换
    Parquet 压缩率更好，但需要编码/解码开销
    Pickle 虽然快，但不跨语言、不安全
```

            
```
# 序列化/反序列化基准测试代码
import time
import pyarrow as pa
import pyarrow.ipc as ipc
import pyarrow.parquet as pq
import pandas as pd
import numpy as np

def create_test_data(n_rows=1_000_000):
    """创建测试数据"""
    rng = np.random.default_rng(42)
    return pa.table({
        "id": pa.array(range(n_rows)),
        "int_col": pa.array(rng.integers(0, 1000000, n_rows)),
        "float_col": pa.array(rng.random(n_rows)),
        "str_col": pa.array([f"value_{i}" for i in range(n_rows)]),
        "bool_col": pa.array(rng.choice([True, False], n_rows)),
        "category": pa.array(rng.choice(["A", "B", "C", "D", "E"], n_rows)),
        "nullable_int": pa.array(
            [i if i % 10 != 0 else None for i in range(n_rows)],
            type=pa.int64(),
        ),
        "ts_col": pa.array(rng.integers(1000000000, 2000000000, n_rows)),
        "small_int": pa.array(rng.integers(0, 100, n_rows).astype(np.int32)),
        "double_col": pa.array(rng.standard_normal(n_rows)),
    })

def benchmark_arrow_ipc(table):
    """基准测试 Arrow IPC"""
    # 序列化
    start = time.perf_counter()
    sink = pa.BufferOutputStream()
    writer = ipc.new_stream(sink, table.schema)
    writer.write_table(table)
    writer.close()
    buf = sink.getvalue()
    ser_time = time.perf_counter() - start

    # 反序列化
    start = time.perf_counter()
    reader = ipc.open_stream(buf)
    result = reader.read_all()
    deser_time = time.perf_counter() - start

    return ser_time, deser_time, buf.size

# table = create_test_data()
# ser, deser, size = benchmark_arrow_ipc(table)
# print(f"Arrow IPC - 序列化: {ser:.3f}s, 反序列化: {deser:.3f}s, 大小: {size/1024**2:.1f}MB")
```

            

### 9.3 跨进程数据传输对比

            
```
跨进程数据传输性能对比（100 万行，通过 Unix Socket）

方式                    传输耗时    CPU 使用率    内存峰值（发送方+接收方）
────────────────────────────────────────────────────────────────────────
CSV over Socket         8.5s       单核 100%    2x 数据大小
Pickle over Socket      2.3s       单核 100%    2x 数据大小
Arrow IPC over Socket   0.18s      单核 15%     1.05x 数据大小
Arrow 共享内存          0.002s     单核 5%      1.0x 数据大小（共享）

关键观察：
  Arrow IPC over Socket 仍然需要一次内存拷贝（内核态 Socket 缓冲区）
  Arrow 共享内存可以完全消除数据拷贝，只传递元数据和内存地址
  CPU 使用率的差异反映了序列化/反序列化的计算开销
```

            

### 9.4 Flight 网络传输对比

            
```
Flight vs JDBC 网络数据传输性能对比（千万行级别，10Gbps 网络）

数据集大小     JDBC (行式)        Flight (列式)      加速比
──────────────────────────────────────────────────────────
100 万行       4.2s               0.5s              8.4x
500 万行       21.0s              2.1s              10.0x
1000 万行      43.5s              3.8s              11.4x
5000 万行      OOM                15.2s             —

分析：
  JDBC 的开销主要在逐行序列化和类型转换
  Flight 直接传输 Arrow RecordBatch，接收方零反序列化
  随着数据量增大，Flight 的加速比增加，因为 Arrow 的批量传输效率更高
  JDBC 在 5000 万行时 OOM，因为需要在内存中维护行式中间缓冲区
```

            

### 9.5 Pandas Arrow
            后端性能

            
```
Pandas 操作性能对比：NumPy 后端 vs Arrow 后端

操作                  NumPy 后端     Arrow 后端     加速比
────────────────────────────────────────────────────────────
字符串列 groupby      3.2s           0.8s          4.0x
字符串列 value_counts 1.5s           0.3s          5.0x
字符串列 内存占用      580MB          95MB          6.1x
整数列 sum            0.05s          0.06s         0.8x
浮点列 mean           0.04s          0.05s         0.8x
读取 CSV(1GB)         12.5s          5.8s          2.2x
to_parquet            2.1s           1.8s          1.2x
read_parquet          1.5s           0.9s          1.7x

分析：
  字符串操作的加速最为明显，因为 Arrow 避免了 Python 对象开销
  数值操作上 NumPy 后端略快，因为 NumPy 的数值计算已经高度优化
  I/O 操作（CSV/Parquet）Arrow 后端更快，减少了格式转换
  内存节省在字符串密集型数据上最为显著
```

            

### 9.6 DuckDB Arrow
            扫描性能

            
```
DuckDB 不同数据源的扫描性能对比（1000 万行聚合查询）

数据源                   扫描+聚合耗时    数据加载耗时    总耗时
──────────────────────────────────────────────────────────────
DuckDB 内部表            0.35s            0s（已加载）   0.35s
Arrow Table (零拷贝)     0.38s            0s（零拷贝）   0.38s
Pandas DataFrame         0.42s            0.15s          0.57s
Parquet 文件(本地)       0.55s            0s（直接扫描） 0.55s
CSV 文件(本地)           2.80s            0s（直接扫描） 2.80s

分析：
  Arrow Table 的零拷贝扫描性能接近 DuckDB 内部表
  Pandas DataFrame 需要额外的数据格式转换时间
  Parquet 文件需要解压缩和解码，但仍然很快
  CSV 文件的解析开销最大
```

            
            

## 十、Arrow 生态展望

            

### 10.1 当前生态版图

            

Arrow 已经成为数据分析生态的事实标准（De Facto
            Standard）内存格式。截至 2025
            年，以下系统已经原生集成或深度支持 Arrow：
            
```
Arrow 生态版图

计算引擎（Compute Engine）
  ├── DuckDB          — 零拷贝扫描 Arrow Table
  ├── DataFusion      — Rust 实现的查询引擎，原生 Arrow
  ├── Velox           — Meta 的向量化执行引擎
  ├── Polars          — Rust DataFrame 库，基于 Arrow2
  └── Acero           — Arrow 原生的流式执行引擎

数据框架（DataFrame Library）
  ├── Pandas          — ArrowDtype 后端
  ├── Polars          — 原生 Arrow 内存格式
  ├── cuDF (RAPIDS)   — GPU Arrow 格式
  └── Vaex            — 外存 DataFrame，Arrow 集成

大数据平台（Big Data Platform）
  ├── Spark           — Arrow 优化的 PySpark 数据交换
  ├── Flink           — Arrow 格式的 Python UDF
  ├── Dremio          — 基于 Arrow Flight 的查询引擎
  └── Snowflake       — Arrow 格式的结果集

数据湖与存储（Data Lake and Storage）
  ├── Delta Lake      — Arrow 读取接口
  ├── Apache Iceberg  — Arrow 读取接口
  ├── Lance           — Arrow 原生的向量存储格式
  └── Substrait       — 查询计划的标准化表示
```

            

### 10.2 Arrow 2.0 格式演进

            

Arrow
            格式本身也在持续演进。以下是正在讨论和实施的改进：
            
```
Arrow 格式演进方向

1. 可变长二进制视图（Variable-Length Binary View）
   传统 Utf8 类型使用连续数据缓冲区 + 偏移量数组
   新的 StringView/BinaryView 类型使用内联短字符串 + 指针引用长字符串
   短字符串（
            

## 参考文献

            

### 规范与文档

            
            
- 

Apache Arrow 官方规范。“Columnar Format
            Specification.” https://arrow.apache.org/docs/format/Columnar.html.
            内存布局的权威定义。
            
- 

Apache Arrow IPC 规范。“IPC Streaming Format and File
            Format.” https://arrow.apache.org/docs/format/IPC.html.
            IPC 消息格式和文件格式的详细描述。
            
- 

Apache Arrow Flight 规范。“Arrow Flight RPC.” https://arrow.apache.org/docs/format/Flight.html.
            Flight 协议的 RPC 接口定义。
            
- 

Apache Arrow Flight SQL 规范。“Arrow Flight SQL.” https://arrow.apache.org/docs/format/FlightSql.html.
            Flight SQL 扩展协议。
            
            

### 论文与技术报告

            
            
- 

W. McKinney. “Apache Arrow and the ‘10 Things I Hate
            About Pandas’.” 2017. Arrow
            项目发起人关于统一内存格式的技术动机。
            
- 

W. McKinney. “Apache Arrow: A Cross-Language
            Development Platform for In-Memory Analytics.” 2019. Arrow
            的设计哲学和跨语言集成方案。
            
- 

D. Abadi et al. “The Design and Implementation of
            Modern Column-Oriented Database Systems.” *Foundations
            and Trends in Databases*, 2013.
            列式存储的理论基础。
            
            

### 源码与实现

            
            
- 

Apache Arrow 源码。https://github.com/apache/arrow.
            多语言实现：C++、Java、Python、Rust、Go、C#、Julia。
            
- 

DuckDB 源码。https://github.com/duckdb/duckdb. DuckDB 与
            Arrow 集成的实现细节。
            
- 

Polars 源码。https://github.com/pola-rs/polars. 基于
            Arrow2 的高性能 DataFrame 库。
            
            

### 书籍

            
            
- 

W. McKinney. *Python for Data Analysis*. 3rd
            Edition. O’Reilly, 2022. 第 5 章介绍了 Pandas 的 Arrow
            后端。
            
- 

A. Petrov. *Database Internals: A Deep Dive into
            How Distributed Data Systems Work*. O’Reilly, 2019.
            存储引擎和列式格式的背景知识。
            
            
            

**上一篇**: Parquet 列式存储格式
            **下一篇**: 时序存储引擎
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Apache Arrow 内存格式与零拷贝

                    

拆解 Arrow 列式内存布局（validity bitmap + value buffer + offset buffer）、零拷贝从何而来，以及 C Data Interface、IPC、Flight 三层跨边界传递。讲清 Arrow（内存计算格式）与 Parquet（磁盘存储格式）如何分工衔接。含 pyarrow 实测 C Data Interface 同地址零拷贝。
                

                
                    

2026-06-29 · database / storage
                    

### 【数据湖与开放表格式】Parquet · Iceberg · Delta · Hudi 内核拆解

                    

拆解 lakehouse 的两层基础：列式文件格式（Parquet/ORC/Arrow）与开放表格式（Iceberg/Delta/Hudi）。讲清没有数据库进程时，如何在对象存储上做 ACID、行级更新、快照与并发，以及 catalog、查询引擎、流式入湖如何拼成可运维的湖仓。面向数据平台工程师与从 OLAP/数仓转型的开发者。
                

                
                    

2025-09-22 · storage
                    

### 【存储工程】序列化格式深度对比

                    

系统对比 Protobuf、FlatBuffers、Cap'n Proto、MessagePack 等序列化格式——性能基准、零拷贝反序列化、兼容性设计与存储系统中的选型实践
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。