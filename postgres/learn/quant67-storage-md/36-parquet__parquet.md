# 【存储工程】Parquet 文件格式深度解析

来源: https://quant67.com/post/storage/36-parquet/parquet.html
日期: 2025-09-14 |

---

上一篇我们讨论了列式存储（Columnar
            Storage）的核心思想：把同一列的数据连续存放，让分析查询只读取需要的列，而不是扫描整行。这个思想落地到具体文件格式时，需要回答一系列工程问题：文件内部怎么组织数据才能同时支持并行读取和列裁剪？同一列的数据用什么编码方式才能最大化压缩率？如何在不读取全部数据的前提下跳过不符合条件的行？
            

Apache Parquet
            是目前大数据生态中使用最广泛的列式文件格式。从
            Spark、Hive、Impala 到 DuckDB、Polars，几乎所有分析引擎都把
            Parquet 作为首选存储格式。它的设计源自 Google Dremel
            论文中的列式编码思想，由 Twitter 和 Cloudera 联合开发，2013
            年进入 Apache 孵化器，目前最新规范版本为 2.10（对应 Parquet
            Format 的 GitHub 仓库）。
            

本文基于 Parquet Format 规范（parquet-format GitHub
            仓库，版本 2.10）和 parquet-java 实现（版本
            1.14.x），从文件结构、编码方式、统计信息、谓词下推、投影下推、版本演进六个维度拆解
            Parquet 的内部机制，再通过 parquet-tools 和 PyArrow
            的实战操作落到工程实践。
            
            

## 一、Parquet 设计目标

            

### 1.1 设计约束

            

Parquet
            要解决的核心问题是：在分布式文件系统（HDFS、S3、GCS）上存储结构化数据，让分析查询尽可能少读数据、尽可能快解码数据。这个目标拆解成几个具体约束：
            
            
- **列裁剪（Column Pruning）**：查询只涉及 3
            列时，不应该读取其余 97 列的数据。
            
- **行组过滤（Row Group
            Filtering）**：查询条件是 `age > 30`
            时，如果某个数据块的 `age` 最大值只有
            25，整个块都应该跳过。
            
- **高压缩率**：同一列的数据类型一致、值域相近，列式存储天然适合压缩。编码方式应该利用这个特性。
            
- **可分片（Splittable）**：MapReduce、Spark
            等框架需要把一个文件拆成多个分片（Split）并行处理。文件格式必须支持在合理边界上切分。
            
- **自描述（Self-Describing）**：文件内部包含完整的模式信息（Schema），不依赖外部元数据服务。
            
- **嵌套结构支持**：现实数据不只有扁平表，还有嵌套的
            struct、array、map 结构。格式必须高效支持嵌套数据。
            
            

### 1.2 Dremel 的遗产

            

Parquet 的嵌套编码方案直接来自 Google 在 2010 年发表的
            Dremel 论文。Dremel 提出了两个关键概念：
            
            
- **定义级别（Definition
            Level）**：记录一个值在嵌套结构中”存在到第几层”。如果一个可选字段（Optional
            Field）的值为 null，Definition Level
            就小于该字段的最大嵌套深度。
            
- **重复级别（Repetition
            Level）**：记录一个值在重复结构（Repeated
            Field）中”从第几层开始重复”。
            
            

这两个整数配合列值本身，可以无损地重建任意深度的嵌套结构，而不需要在列式存储中保留行的边界信息。
            

举一个例子。假设 Schema 定义如下：
            
```
message Document {
  required int64 doc_id;
  repeated group Links {
    optional int64 forward;
    optional int64 backward;
  }
}
```

            

对于 `Links.forward` 这一列，Parquet
            存储的不只是值的序列，还有每个值对应的 Definition Level 和
            Repetition Level。如果某条记录没有 `Links`
            字段，`forward` 的 Definition Level 为 0（Links
            这一层就不存在了）；如果有 `Links` 但
            `forward` 为 null，Definition Level 为 1（Links
            存在，forward 不存在）；如果 `forward`
            有值，Definition Level 为 2。
            

对于扁平表（Flat Schema），所有字段的 Definition Level
            最多为 0 或 1（取决于是否可选），Repetition Level 始终为
            0。这种情况下嵌套编码几乎没有额外开销。
            

### 1.3 与 ORC 的定位差异

            

Parquet 和 ORC（Optimized Row
            Columnar）是大数据生态中两个主要的列式文件格式。它们的设计目标相似，但在几个维度上有所不同：
            
            
            
            
            
            
            
            
            维度
            Parquet
            ORC
            
            
            
            
            嵌套支持
            Dremel 编码，原生支持任意嵌套
            扁平化处理，嵌套支持较弱
            
            
            生态绑定
            Spark、Arrow 生态首选
            Hive 生态首选
            
            
            索引能力
            列统计 + Page Index（2.6 起）
            Bloom Filter + Row Group Index
            
            
            ACID 支持
            依赖 Delta Lake / Iceberg 等外部表格式
            Hive ACID 原生支持
            
            
            压缩率
            取决于编码，整体相当
            取决于编码，整体相当
            
            
            
            

我认为 Parquet 在跨引擎互操作性上有明显优势。ORC
            的核心用户群体集中在 Hive 生态，而 Parquet
            几乎被所有现代分析引擎支持：Spark、DuckDB、Polars、ClickHouse、DataFusion、BigQuery。如果你的数据需要被多个引擎读取，Parquet
            是更安全的选择。
            
            

## 二、Row
            Group/Column Chunk/Page 三级结构

            

### 2.1 文件整体布局

            

一个 Parquet 文件的物理结构分为三层：行组（Row
            Group）、列块（Column Chunk）、页（Page）。文件头部有 4
            字节魔数（Magic Number）`PAR1`，尾部同样有 4 字节
            `PAR1`，尾部魔数之前是文件元数据（File
            Metadata）及其长度。
            
```
┌──────────────────────────────────┐
│  Magic Number: PAR1 (4 bytes)    │
├──────────────────────────────────┤
│  Row Group 0                     │
│  ├── Column Chunk 0 (col_a)      │
│  │   ├── Page 0                  │
│  │   ├── Page 1                  │
│  │   └── Page 2                  │
│  ├── Column Chunk 1 (col_b)      │
│  │   ├── Page 0                  │
│  │   └── Page 1                  │
│  └── Column Chunk 2 (col_c)      │
│      └── Page 0                  │
├──────────────────────────────────┤
│  Row Group 1                     │
│  ├── Column Chunk 0 (col_a)      │
│  │   ├── Page 0                  │
│  │   └── Page 1                  │
│  ├── Column Chunk 1 (col_b)      │
│  │   └── Page 0                  │
│  └── Column Chunk 2 (col_c)      │
│      ├── Page 0                  │
│      └── Page 1                  │
├──────────────────────────────────┤
│  File Metadata (Thrift)          │
│  ├── Schema                      │
│  ├── Row Group Metadata[]        │
│  │   ├── Column Chunk Metadata[] │
│  │   │   ├── file_offset         │
│  │   │   ├── num_values          │
│  │   │   ├── encodings           │
│  │   │   ├── statistics          │
│  │   │   └── ...                 │
│  │   └── total_byte_size         │
│  └── num_rows                    │
├──────────────────────────────────┤
│  Footer Length (4 bytes)         │
│  Magic Number: PAR1 (4 bytes)    │
└──────────────────────────────────┘
```

            

读取 Parquet 文件的第一步是从文件尾部读取
            Footer：先定位到文件末尾的 8 字节（4 字节 Footer Length + 4
            字节魔数），拿到 Footer Length 后再往前读取对应长度的 File
            Metadata。File Metadata 使用 Thrift 编码（Compact
            Protocol），包含完整的 Schema 定义和所有 Row Group
            的元数据。
            

这个”先读尾部”的设计有一个重要意义：写入 Parquet
            文件时可以流式追加数据，一个 Row Group
            写完再写下一个，最后才写
            Footer。如果写入过程中崩溃，丢失的只是最后一个未完成的 Row
            Group 和 Footer。
            

### 2.2 行组（Row Group）

            

行组是 Parquet
            中最粗粒度的数据分区单元。一个行组包含一批行（通常几十万到几百万行），这些行的所有列数据都在同一个行组内。行组有两个核心作用：
            
            
- **并行处理单元**：MapReduce 和 Spark 的一个
            Task
            通常处理一个或多个行组。行组之间没有数据依赖，可以完全并行。
            
- **I/O
            调度单元**：读取一个行组的某些列时，只需要发起对应列块的
            I/O 请求，不需要读取其他行组的数据。
            
            

行组的大小对性能影响很大。行组太小，元数据占比高，列的压缩效果差，且
            I/O 请求过于碎片化。行组太大，一个 Task
            的内存占用高，且无法细粒度并行。Parquet
            官方文档建议行组大小在 128MB 到 1GB 之间，Spark 默认使用
            128MB。
            

行组的行数不是固定的，它由写入时的行组大小限制决定。写入方会累积数据，当累积大小接近目标行组大小时，把当前数据刷写为一个行组。因此，不同行组的行数可能不同。
            

### 2.3 列块（Column Chunk）

            

一个行组中，每一列的数据构成一个列块。列块是列维度上的数据分区单元。一个列块只包含一列的数据，且这些数据在文件中连续存放。
            

列块的元数据（Column Chunk Metadata）记录在 File Metadata
            中，包括：
            
            
- `file_offset`：列块在文件中的起始偏移量。
            
- `total_compressed_size`：压缩后的总字节数。
            
- `total_uncompressed_size`：未压缩的总字节数。
            
- `num_values`：值的数量（包括 null）。
            
- `encodings`：该列块使用的编码方式列表。
            
- `codec`：压缩编解码器（Snappy、Zstd、LZ4
            等）。
            
- `statistics`：列级统计信息（最小值、最大值、null
            计数等）。
            
            

列块是投影下推（Projection
            Pushdown）的基本单位。如果查询不涉及某一列，读取器直接跳过该列的所有列块，不发起任何
            I/O。
            

### 2.4 页（Page）

            

页是 Parquet
            中最细粒度的数据单元，也是编码（Encoding）和压缩（Compression）的基本单位。一个列块由一个或多个页组成。Parquet
            定义了三种页类型：
            
            
- **数据页（Data Page）**：存储列值本身，以及
            Definition Level 和 Repetition Level。
            
- **字典页（Dictionary
            Page）**：如果列使用了字典编码（Dictionary
            Encoding），字典页存储字典条目。一个列块最多有一个字典页，且必须出现在所有数据页之前。
            
- **索引页（Index Page）**：Parquet 2.6
            引入的 Page Index 机制中使用的偏移量索引和列索引页。
            
            

数据页的默认大小为
            1MB（未压缩）。页太小会增加页头开销和解码次数；页太大会降低谓词下推的过滤精度（因为统计信息是按页粒度记录的）。
            

数据页有两个版本：Data Page V1 和 Data Page V2。V2 在
            Parquet 2.0 中引入，主要变化是把 Definition Level 和
            Repetition Level
            的编码从页数据中分离出来，放到页头中独立的部分，使得跳过不需要的页时不必解码
            Level 数据。
            

一个数据页（V1）的二进制布局如下：
            
```
┌─────────────────────────────────────┐
│  Page Header (Thrift)               │
│  ├── page_type: DATA_PAGE           │
│  ├── uncompressed_page_size         │
│  ├── compressed_page_size           │
│  ├── num_values                     │
│  ├── encoding                       │
│  ├── definition_level_encoding      │
│  └── repetition_level_encoding      │
├─────────────────────────────────────┤
│  Repetition Levels (encoded)        │
├─────────────────────────────────────┤
│  Definition Levels (encoded)        │
├─────────────────────────────────────┤
│  Values (encoded + compressed)      │
└─────────────────────────────────────┘
```

            

Data Page V2 的布局有一处关键不同：Repetition Level 和
            Definition Level 不参与压缩，只有 Values
            部分被压缩。这使得读取器可以先读取 Level 数据判断哪些值为
            null，再决定是否需要解压 Values 部分。
            
```
┌──────────────────────────────────────┐
│  Page Header (Thrift)                │
│  ├── page_type: DATA_PAGE_V2        │
│  ├── num_values                      │
│  ├── num_nulls                       │
│  ├── num_rows                        │
│  ├── encoding                        │
│  ├── definition_levels_byte_length   │
│  ├── repetition_levels_byte_length   │
│  └── is_compressed                   │
├──────────────────────────────────────┤
│  Repetition Levels (NOT compressed)  │
├──────────────────────────────────────┤
│  Definition Levels (NOT compressed)  │
├──────────────────────────────────────┤
│  Values (compressed)                 │
└──────────────────────────────────────┘
```

            

### 2.5 三级结构的协作

            

这三层结构之间的关系可以用一个类比来理解：
            
            
- **行组**
            类似书架上的一本书，包含一段完整的行数据。
            
- **列块**
            类似书中的一个章节，只包含一个主题（列）的内容。
            
- **页**
            类似章节中的一页纸，是实际读取和解码的最小单位。
            
            

查询引擎读取 Parquet 文件的典型流程是：
            
            
- 读取 Footer，获取 Schema 和所有行组的元数据。
            
- 根据查询涉及的列，确定需要读取哪些列块（投影下推）。
            
- 根据查询的过滤条件和行组/列块的统计信息，跳过不符合条件的行组（谓词下推）。
            
- 对于需要读取的列块，按页逐个解码，应用页级别的过滤（如果有
            Page Index）。
            
- 将解码后的列数据重组为行或批次，交给上层算子处理。
            
            
            

## 三、编码方式

            

Parquet
            支持多种编码方式（Encoding），目标是利用同一列数据的统计特征来减少存储空间和加速解码。编码发生在压缩之前：数据先编码，再压缩。选择合适的编码方式通常比选择压缩算法更能影响文件大小和读取性能。
            

### 3.1 Plain 编码

            

普通编码（Plain
            Encoding）是最简单的编码方式：值按原始二进制格式连续存放。固定长度类型（INT32、INT64、FLOAT、DOUBLE）直接写入字节序列；变长类型（BYTE_ARRAY）先写
            4 字节长度前缀，再写内容。
            
```
# INT32 Plain Encoding
[value0: 4 bytes][value1: 4 bytes][value2: 4 bytes]...

# BYTE_ARRAY Plain Encoding
[len0: 4 bytes][data0: len0 bytes][len1: 4 bytes][data1: len1 bytes]...
```

            

Plain
            编码没有任何压缩效果，但解码速度最快——直接读取字节，不需要任何计算。当列的基数（Cardinality）很高、值之间没有规律时，Plain
            编码配合通用压缩算法（如 Zstd）可能是最好的选择。
            

### 3.2
            字典编码（Dictionary Encoding）

            

字典编码是 Parquet
            中使用最广泛的编码方式。它的原理是：如果一列的去重值（Distinct
            Values）数量远小于总行数，就建立一个字典（Dictionary），把每个值映射为一个整数索引，然后只存储索引序列。
            
```
字典页（Dictionary Page）:
  entries = ["Beijing", "Shanghai", "Guangzhou", "Shenzhen"]

数据页（Data Page）:
  indices = [0, 1, 0, 2, 3, 1, 0, 2, ...]
```

            

字典编码的索引序列本身通常使用 RLE/Bit-Packing
            混合编码（见下文）进一步压缩。例如，如果字典只有 4
            个条目，每个索引只需要 2 位（Bit），1000 个值只需要 250
            字节（加上 RLE 压缩可能更少），而原始字符串可能需要几十
            KB。
            

字典编码有一个硬限制：字典页的大小不能超过页大小限制（默认
            1MB）。当列的基数超过这个限制时，写入器会放弃字典编码，回退到
            Plain 编码。这个回退称为”字典回退（Dictionary
            Fallback）“。实际工程中，当列的基数超过几万到几十万时（取决于值的平均长度），字典编码就会失效。
            

Parquet
            的写入器通常默认启用字典编码，并在写入过程中动态监测字典大小。一旦字典超限，当前页及后续页切换到
            Plain
            编码。同一个列块内可能前几个页使用字典编码，后几个页使用
            Plain 编码，这在元数据的 `encodings`
            字段中有体现。
            

### 3.3 RLE/Bit-Packing
            混合编码

            

游程编码（Run-Length
            Encoding，RLE）和位打包（Bit-Packing）是 Parquet
            用来编码小整数序列的核心方法。它们通常组合使用，称为
            RLE/Bit-Packing 混合编码（Hybrid Encoding）。
            

这个编码方式用于两个场景：
            
            
- 字典编码的索引序列。
            
- Definition Level 和 Repetition Level 序列。
            
            

混合编码的基本思想是：对于连续重复的值，使用
            RLE（记录值和重复次数）；对于不重复的值，使用
            Bit-Packing（把多个小整数打包到一组字节中）。编码器在写入时动态选择
            RLE 还是 Bit-Packing，以较小者为准。
            

编码格式以变长整数（VarInt）开头作为 header。header
            的最低位标识编码类型：
            
            
- `header & 1 == 0`：RLE
            编码。`header >> 1`
            是重复次数。后面跟一个用最少字节数表示的值。
            
- `header & 1 == 1`：Bit-Packing
            编码。`header >> 1` 是组数（每组 8
            个值）。后面跟打包后的字节序列。
            
            
```
# 示例：bit_width = 3，编码序列 [5, 5, 5, 5, 5, 5, 5, 5, 1, 2, 3, 4, 5, 6, 7, 8]

# 前 8 个值全是 5，使用 RLE：
# header = 8 
            
            
            
            
            
            
            
            数据特征
            推荐编码
            原因
            
            
            
            
            低基数字符串/整数（基数 < 10000）
            Dictionary
            字典索引远小于原始值
            
            
            高基数字符串
            Plain + Zstd
            字典会溢出，直接压缩更好
            
            
            单调递增整数（时间戳、ID）
            Delta Binary Packing
            差值极小，位宽低
            
            
            已排序字符串
            Delta Strings
            前缀压缩效果好
            
            
            浮点数
            Byte Stream Split + Zstd
            字节流重排提升压缩率
            
            
            Boolean
            RLE
            只有两个值，RLE 极度有效
            
            
            
            

大多数写入器（包括
            PyArrow、parquet-java）会根据列类型和统计信息自动选择编码方式。通常不需要手动指定，但了解编码原理有助于诊断压缩率不理想的问题。
            
            

## 四、统计信息与谓词下推

            

### 4.1 列统计信息（Column
            Statistics）

            

Parquet
            在写入时为每个列块记录统计信息（Statistics），存储在 Column
            Chunk Metadata 中。标准统计字段包括：
            
            
- `min`：该列块中的最小值。
            
- `max`：该列块中的最大值。
            
- `null_count`：null 值的数量。
            
- `distinct_count`：去重值的数量（可选，不是所有写入器都填写）。
            
- `num_values`：非 null 值的数量。
            
            

这些统计信息是谓词下推（Predicate
            Pushdown）的基础。查询引擎在读取数据之前先检查统计信息，判断当前行组/列块是否可能包含符合条件的数据。
            

有一个容易踩的坑：Parquet 早期版本（1.x
            规范）中，字符串类型的 `min`/`max`
            统计信息使用有符号字节比较（Signed Byte
            Comparison），而实际字符串比较应该是无符号的。这导致统计信息不可靠，一些读取器会忽略字符串列的统计信息。Parquet
            2.0 规范引入了 `min_value`/`max_value`
            字段，使用正确的无符号比较语义，同时废弃了旧的
            `min`/`max` 字段。
            

### 4.2 谓词下推原理

            

谓词下推（Predicate
            Pushdown）是指查询引擎把过滤条件”下推”到存储层，让存储层在读取数据时就跳过不符合条件的数据块。在
            Parquet 中，谓词下推发生在两个层级：
            

**行组级别**：读取器检查行组内每个相关列块的统计信息。如果过滤条件与统计信息矛盾，整个行组被跳过。
            
```
查询条件: WHERE age > 30

行组 0: age 列统计 min=18, max=25
  → max(25)  30 的行 → 跳过整个行组

行组 1: age 列统计 min=22, max=55
  → max(55) > 30，可能有符合条件的行 → 需要读取

行组 2: age 列统计 min=35, max=60
  → min(35) > 30，所有行都符合条件 → 需要读取
```

            

**页级别**（Page Index，Parquet 2.6
            起）：对于需要读取的行组，读取器进一步检查每个数据页的统计信息，跳过不符合条件的页。
            

### 4.3 Page Index

            

Parquet 2.6 引入了页索引（Page
            Index）机制，把统计信息的粒度从行组/列块级别细化到页级别。Page
            Index 由两个结构组成：
            
            
- **列索引（Column
            Index）**：记录每个数据页的 min/max 值和 null
            计数。
            
- **偏移量索引（Offset
            Index）**：记录每个数据页在文件中的偏移量和大小。
            
            

这两个索引结构存储在 File Metadata
            中（而不是内联在数据页里），这样读取器可以在读取任何数据页之前就获取所有页的统计信息。
            
```
Column Index for column "age":
  page 0: min=18, max=22, null_count=0
  page 1: min=19, max=25, null_count=2
  page 2: min=28, max=55, null_count=0

Offset Index for column "age":
  page 0: offset=1024, compressed_size=4096
  page 1: offset=5120, compressed_size=3840
  page 2: offset=8960, compressed_size=4096

查询条件: WHERE age > 30
  → page 0: max=22  30 → 需要读取
```

            

Page Index 在大行组场景下特别有用。如果一个行组有 100
            万行、分成 100 个页，没有 Page Index
            时要么读取整个行组，要么完全跳过。有了 Page
            Index，可以只读取 2-3 个页，I/O 量减少一到两个数量级。
            

### 4.4 Bloom Filter

            

Parquet 2.7 引入了布隆过滤器（Bloom Filter）支持。Bloom
            Filter
            是一种概率数据结构，可以快速判断”一个值是否可能在集合中”。它有两种结果：
            
            
- “一定不在”：可以安全地跳过该数据块。
            
- “可能在”：需要读取数据块进一步验证。
            
            

Bloom Filter
            对等值查询（`column = value`）特别有效，弥补了
            min/max 统计信息在高基数列上的不足。例如，一个列块的
            min=1、max=1000000，查询 `id = 42` 时，min/max
            无法排除这个列块，但 Bloom Filter 可以判断 42
            是否可能存在于该列块中。
            
```
Column Chunk Metadata:
  statistics: min=1, max=1000000
  bloom_filter: [bit_array, num_hashes, hash_algorithm]

查询: WHERE id = 42
  min/max 检查: 1 
            
            
            谓词类型
            min/max
            Bloom Filter
            Page Index
            
            
            
            
            `col = value`
            部分有效
            高度有效
            部分有效
            
            
            `col > value`
            有效
            不适用
            有效
            
            
            `col 
            有效
            不适用
            有效
            
            
            `col BETWEEN a AND b`
            有效
            不适用
            有效
            
            
            `col IN (v1, v2, ...)`
            部分有效
            有效
            部分有效
            
            
            `col IS NULL`
            有效（null_count）
            不适用
            有效
            
            
            `col LIKE 'prefix%'`
            有效（字符串有序时）
            不适用
            有效
            
            
            
            

我认为在实际工程中，min/max
            统计信息能处理大部分场景，Page Index 是进阶优化，Bloom
            Filter
            则是针对等值查询的补充。三者不是互斥的，而是分层配合。
            
            

## 五、投影下推

            

### 5.1 投影下推原理

            

投影下推（Projection
            Pushdown）是列式存储最基本的优势：查询只涉及表中的部分列时，只读取这些列的数据，完全跳过其他列。这在行式存储（如
            CSV、JSON）中无法做到——即使只需要一列，也必须解析整行。
            

Parquet
            的列块在文件中独立存放，每个列块的偏移量和大小记录在 File
            Metadata
            中。读取器根据查询涉及的列列表，只向存储层发起对应列块的读取请求。
            
```
Schema: id (INT64), name (STRING), age (INT32), address (STRING), salary (DOUBLE)

查询: SELECT name, salary FROM table WHERE age > 30

投影下推: 只读取 name, age, salary 三列的列块
         跳过 id 和 address 列块
         （age 用于过滤，过滤完成后可以丢弃）
```

            

### 5.2 投影下推的 I/O 节省

            

投影下推的 I/O
            节省量取决于查询涉及的列数占总列数的比例。分析场景中，宽表（几十到几百列）是常态，但单次查询通常只涉及
            5-10 列。这意味着投影下推可以减少 90%-99% 的 I/O。
            

以一个具体例子说明。假设一个表有 100
            列，每列的数据量大致相同，总文件大小 10GB：
            
            
            
            查询列数
            行式存储读取量
            列式存储读取量
            节省比例
            
            
            
            
            1
            10 GB
            100 MB
            99%
            
            
            5
            10 GB
            500 MB
            95%
            
            
            10
            10 GB
            1 GB
            90%
            
            
            50
            10 GB
            5 GB
            50%
            
            
            100
            10 GB
            10 GB
            0%
            
            
            
            

在对象存储（S3、GCS）上，投影下推的收益更大，因为每次 I/O
            请求都有网络延迟，减少请求数量和数据传输量直接降低查询延迟和成本。
            

### 5.3 嵌套列的投影

            

Parquet 对嵌套结构的投影支持比较细致。如果 Schema
            中有一个 Struct 类型的列：
            
```
message Record {
  required group user {
    required string name;
    optional int32 age;
    optional string email;
  }
  required int64 timestamp;
}
```

            

查询只需要 `user.name` 和
            `timestamp` 时，Parquet 可以只读取
            `user.name` 和 `timestamp`
            的列块，跳过 `user.age` 和
            `user.email`。嵌套结构在 Parquet
            内部被展平为独立的叶子列（Leaf
            Column），每个叶子列有独立的列块。
            

对于 Array（Repeated）类型和 Map
            类型，情况稍微复杂。Array 元素的数量通过 Repetition Level
            编码，Map 的 key 和 value
            是两个独立的叶子列。投影下推仍然在叶子列级别进行。
            
            

## 六、Parquet 版本演进

            

### 6.1 版本号体系

            

Parquet
            的版本号容易混淆，因为存在两个独立的版本号体系：
            
            
- **Format
            Version**：文件格式规范的版本号，定义在
            parquet-format 仓库中。重要版本包括
            1.0、2.0、2.4、2.6、2.7、2.8、2.9、2.10。
            
- **Writer
            Version**：写入器声明的兼容版本号，存储在 File
            Metadata 的 `created_by` 字段中。例如
            `parquet-mr version 1.14.1` 表示使用 parquet-java
            1.14.1 版本写入。
            
            

Format Version
            决定了文件中可以使用哪些特性。为了向后兼容，大多数写入器默认使用
            Format Version 1.0
            的特性子集，除非显式配置为使用更高版本的特性。
            

### 6.2 各版本关键变化

            
            
            
            版本
            年份
            关键特性
            
            
            
            
            1.0
            2013
            初始版本：三级结构、基本编码、Thrift 元数据
            
            
            2.0
            2014
            Data Page V2、Delta 编码、修正字符串统计信息语义
            
            
            2.4
            2018
            逻辑类型（Logical Type）重构，替代旧的
            ConvertedType
            
            
            2.6
            2019
            Page Index（Column Index + Offset Index）
            
            
            2.7
            2020
            Bloom Filter 支持
            
            
            2.8
            2021
            Byte Stream Split 编码
            
            
            2.9
            2022
            16 位浮点（FLOAT16）类型
            
            
            2.10
            2023
            Geometry 和 Geography 逻辑类型（GeoParquet）
            
            
            
            

### 6.3 逻辑类型（Logical
            Type）

            

Parquet 的物理类型（Physical
            Type）只有七种：BOOLEAN、INT32、INT64、FLOAT、DOUBLE、BYTE_ARRAY、FIXED_LEN_BYTE_ARRAY。逻辑类型（Logical
            Type）在物理类型之上定义更丰富的语义：
            
            
            
            
            
            
            
            
            逻辑类型
            物理类型
            语义
            
            
            
            
            STRING
            BYTE_ARRAY
            UTF-8 字符串
            
            
            DECIMAL
            INT32/INT64/FIXED_LEN_BYTE_ARRAY/BYTE_ARRAY
            定点数，带精度和标度
            
            
            DATE
            INT32
            日期，Unix 纪元以来的天数
            
            
            TIME
            INT32/INT64
            时间，毫秒或微秒精度
            
            
            TIMESTAMP
            INT64
            时间戳，毫秒、微秒或纳秒精度
            
            
            UUID
            FIXED_LEN_BYTE_ARRAY(16)
            128 位 UUID
            
            
            LIST
            group
            有序列表
            
            
            MAP
            group
            键值映射
            
            
            ENUM
            BYTE_ARRAY
            枚举字符串
            
            
            JSON
            BYTE_ARRAY
            JSON 字符串
            
            
            BSON
            BYTE_ARRAY
            BSON 二进制
            
            
            FLOAT16
            FIXED_LEN_BYTE_ARRAY(2)
            IEEE 754 半精度浮点数
            
            
            
            

Parquet 2.4 之前使用 `ConvertedType`
            枚举来表示逻辑类型，2.4 之后改为 `LogicalType`
            结构体，能携带更多参数（如 TIMESTAMP
            的精度和时区信息）。新的写入器应该使用
            LogicalType，但同时写入 ConvertedType 以兼容旧的读取器。
            

### 6.4 兼容性实践

            

我认为在实际工程中处理 Parquet
            版本兼容性时，有三条原则：
            
            
- 

**写入时保守，读取时宽容。**
            写入器默认使用 Format Version 1.0
            的特性，除非确认所有消费者都支持更高版本。读取器应该尽量支持所有已知版本。
            
- 

**显式声明 writer version。** 使用
            PyArrow 写入时通过 `version`
            参数控制（`"1.0"` 或 `"2.6"`）。使用
            Spark 时通过
            `spark.sql.parquet.writeLegacyFormat`
            控制。
            
- 

**测试下游兼容性。**
            写入后用目标引擎实际读取验证。Hive 对 Data Page V2
            的支持历史上有过问题，Spark 对 Page Index
            的利用程度在不同版本间有差异。
            
            
            

## 七、parquet-tools 实战

            

### 7.1 安装

            

parquet-tools 有多个实现。推荐使用 Python 版本的
            `parquet-tools`（基于 PyArrow）或 Apache 官方的
            `parquet-cli`（基于 Java）。
            
```
# Python 版本（推荐，轻量）
pip install parquet-tools

# 或者直接使用 PyArrow 自带的命令行功能
pip install pyarrow
```

            

Apache 官方的 parquet-cli 需要 Java 环境：
            
```
# 下载 parquet-cli JAR
# https://repo1.maven.org/maven2/org/apache/parquet/parquet-cli/
java -jar parquet-cli-1.14.1.jar meta input.parquet
```

            

### 7.2 查看 Schema

            
```
# 查看文件的 Schema
parquet-tools schema input.parquet
```

            

输出示例：
            
```
message schema {
  required int64 id;
  optional binary name (STRING);
  optional int32 age;
  optional double salary;
  optional binary city (STRING);
  optional int64 created_at (TIMESTAMP(MILLIS,true));
}
```

            

这里 `binary` 是 Parquet 的物理类型名称，对应
            `BYTE_ARRAY`。括号中的 `STRING` 和
            `TIMESTAMP(MILLIS,true)` 是逻辑类型注解。
            

### 7.3 查看元数据

            
```
# 查看文件级元数据
parquet-tools meta input.parquet
```

            

输出示例（简化）：
            
```
File Metadata:
  Version: 2.6
  Created By: parquet-cpp-arrow version 15.0.0
  Num Row Groups: 3
  Total Rows: 1500000

Row Group 0:
  Num Rows: 500000
  Total Byte Size: 42315678
  Column: id
    Type: INT64
    Encodings: PLAIN, RLE
    Compression: ZSTD
    Num Values: 500000
    Null Count: 0
    Min: 1
    Max: 500000
    Compressed Size: 1234567
    Uncompressed Size: 4000000
  Column: name
    Type: BYTE_ARRAY
    Encodings: PLAIN, RLE, PLAIN_DICTIONARY
    Compression: ZSTD
    Num Values: 500000
    Null Count: 1234
    Min: Aaron
    Max: Zylstra
    Compressed Size: 5678901
    Uncompressed Size: 12345678
  ...
```

            

### 7.4 查看数据内容

            
```
# 查看前 10 行数据
parquet-tools head -n 10 input.parquet

# 查看指定列的前 5 行
parquet-tools head -n 5 -c id,name input.parquet
```

            

### 7.5 查看 Row Group
            详细信息

            
```
# 使用 PyArrow 查看详细的 Row Group 元数据
python3 -c "
import pyarrow.parquet as pq
f = pq.ParquetFile('input.parquet')
print('Num Row Groups:', f.metadata.num_row_groups)
for i in range(f.metadata.num_row_groups):
    rg = f.metadata.row_group(i)
    print(f'Row Group {i}: {rg.num_rows} rows, {rg.total_byte_size} bytes')
    for j in range(rg.num_columns):
        col = rg.column(j)
        print(f'  Column {j} ({col.path_in_schema}):')
        print(f'    Encoding: {col.encodings}')
        print(f'    Compression: {col.compression}')
        if col.statistics:
            stats = col.statistics
            print(f'    Min: {stats.min}, Max: {stats.max}')
            print(f'    Null Count: {stats.null_count}')
"
```

            

### 7.6 检查 Page Index

            
```
# 查看 Page Index 信息（需要文件写入时启用）
python3 -c "
import pyarrow.parquet as pq
f = pq.ParquetFile('input.parquet')
metadata = f.metadata
for i in range(metadata.num_row_groups):
    rg = metadata.row_group(i)
    for j in range(rg.num_columns):
        col = rg.column(j)
        print(f'Row Group {i}, Column {j} ({col.path_in_schema}):')
        print(f'  Has Column Index: {col.is_stats_set}')
"
```

            

### 7.7 文件大小分析

            

在诊断 Parquet
            文件的存储效率时，一个常用方法是分析每列的压缩率：
            
```
python3 -c "
import pyarrow.parquet as pq
f = pq.ParquetFile('input.parquet')
metadata = f.metadata
print(f'Total file rows: {metadata.num_rows}')
print(f'Total row groups: {metadata.num_row_groups}')
print()
print(f'{\"Column\":12} {\"Uncompressed\":>14} {\"Ratio\":>8}')
print('-' * 68)

col_stats = {}
for i in range(metadata.num_row_groups):
    rg = metadata.row_group(i)
    for j in range(rg.num_columns):
        col = rg.column(j)
        name = col.path_in_schema
        if name not in col_stats:
            col_stats[name] = [0, 0]
        col_stats[name][0] += col.total_compressed_size
        col_stats[name][1] += col.total_uncompressed_size

for name, (comp, uncomp) in col_stats.items():
    ratio = comp / uncomp if uncomp > 0 else 0
    print(f'{name:12,} {uncomp:>14,} {ratio:>7.1%}')
"
```

            
            

## 八、PyArrow 读写
            Parquet

            

### 8.1 基本写入

            

PyArrow 是目前最常用的 Parquet 读写库之一。它基于 C++
            实现的 parquet-cpp，性能接近原生代码。
            
```
import pyarrow as pa
import pyarrow.parquet as pq

# 构造数据
table = pa.table({
    "id": pa.array(range(1000000), type=pa.int64()),
    "name": pa.array([f"user_{i}" for i in range(1000000)], type=pa.string()),
    "age": pa.array([20 + (i % 50) for i in range(1000000)], type=pa.int32()),
    "salary": pa.array([3000.0 + i * 0.5 for i in range(1000000)], type=pa.float64()),
    "city": pa.array(["Beijing", "Shanghai", "Guangzhou", "Shenzhen"] * 250000,
                     type=pa.string()),
})

# 写入 Parquet 文件
pq.write_table(
    table,
    "output.parquet",
    compression="zstd",
    compression_level=3,
    row_group_size=500000,
    version="2.6",
    write_statistics=True,
    use_dictionary=True,
)
```

            

关键参数说明：
            
            
- `compression`：压缩算法。常用选项包括
            `"snappy"`（速度快、压缩率一般）、`"zstd"`（压缩率高、速度稍慢）、`"gzip"`（兼容性好、速度最慢）、`"lz4"`（速度最快、压缩率最低）。
            
- `compression_level`：压缩级别。Zstd 支持
            1-22，默认 3。级别越高压缩率越好，但写入速度越慢。
            
- `row_group_size`：每个行组的行数上限。
            
- `version`：Parquet Format
            Version。`"1.0"` 使用 Data Page
            V1，`"2.6"` 使用 Data Page V2 并写入 Page
            Index。
            
- `use_dictionary`：是否启用字典编码。可以传
            `True`（所有列）、`False`（所有列不用）或列名列表。
            
            

### 8.2 基本读取

            
```
import pyarrow.parquet as pq

# 读取整个文件
table = pq.read_table("output.parquet")
print(f"Rows: {table.num_rows}, Columns: {table.num_columns}")
print(table.schema)

# 投影下推：只读取指定列
table = pq.read_table("output.parquet", columns=["name", "salary"])

# 谓词下推：使用过滤条件
table = pq.read_table(
    "output.parquet",
    filters=[
        ("age", ">", 30),
        ("city", "=", "Beijing"),
    ],
)
```

            

`filters`
            参数接受一个条件列表，列表中的条件默认以 AND 连接。PyArrow
            会将这些条件转换为行组级别和页级别（如果有 Page
            Index）的过滤。
            

### 8.3 分区写入

            

分区（Partitioning）是处理大数据集的标准做法。PyArrow
            支持按列值将数据写入不同的子目录：
            
```
import pyarrow as pa
import pyarrow.parquet as pq

table = pa.table({
    "date": ["2025-01-01", "2025-01-01", "2025-01-02", "2025-01-02"],
    "city": ["Beijing", "Shanghai", "Beijing", "Guangzhou"],
    "value": [100, 200, 300, 400],
})

# 按 date 和 city 分区写入
pq.write_to_dataset(
    table,
    root_path="output_partitioned",
    partition_cols=["date", "city"],
    compression="zstd",
)
```

            

写入后的目录结构：
            
```
output_partitioned/
├── date=2025-01-01/
│   ├── city=Beijing/
│   │   └── part-0.parquet
│   └── city=Shanghai/
│       └── part-0.parquet
└── date=2025-01-02/
    ├── city=Beijing/
    │   └── part-0.parquet
    └── city=Guangzhou/
        └── part-0.parquet
```

            

分区下推（Partition
            Pruning）比行组级谓词下推更高效：查询条件涉及分区列时，读取器直接跳过不匹配的子目录，连文件都不需要打开。
            

### 8.4 流式写入（逐行组写入）

            

对于无法一次性放入内存的大数据集，可以使用
            `ParquetWriter` 逐行组写入：
            
```
import pyarrow as pa
import pyarrow.parquet as pq

schema = pa.schema([
    ("id", pa.int64()),
    ("value", pa.float64()),
])

writer = pq.ParquetWriter(
    "large_output.parquet",
    schema,
    compression="zstd",
    version="2.6",
)

# 模拟分批生成数据
for batch_idx in range(10):
    batch = pa.table({
        "id": pa.array(range(batch_idx * 100000, (batch_idx + 1) * 100000)),
        "value": pa.array([float(i) * 0.1 for i in range(100000)]),
    })
    writer.write_table(batch)

writer.close()  # 必须显式关闭，写入 Footer
```

            

每次调用 `write_table()`
            会写入一个新的行组。如果不显式关闭 Writer，Footer
            不会写入，文件将不可读。推荐使用上下文管理器（Context
            Manager）：
            
```
with pq.ParquetWriter("output.parquet", schema, compression="zstd") as writer:
    for batch in data_batches:
        writer.write_table(batch)
# 离开 with 块时自动关闭
```

            

### 8.5 读取元数据

            
```
import pyarrow.parquet as pq

# 只读取元数据，不读取数据
metadata = pq.read_metadata("output.parquet")
print(f"Format Version: {metadata.format_version}")
print(f"Created By: {metadata.created_by}")
print(f"Num Rows: {metadata.num_rows}")
print(f"Num Row Groups: {metadata.num_row_groups}")
print(f"Num Columns: {metadata.num_columns}")

# 检查 Schema
schema = pq.read_schema("output.parquet")
print(schema)

# 检查单个 Row Group
for i in range(metadata.num_row_groups):
    rg = metadata.row_group(i)
    print(f"\nRow Group {i}:")
    print(f"  Rows: {rg.num_rows}")
    print(f"  Size: {rg.total_byte_size:,} bytes")
```

            

### 8.6 控制编码方式

            

PyArrow 允许按列指定编码方式：
            
```
import pyarrow as pa
import pyarrow.parquet as pq

table = pa.table({
    "ts": pa.array(range(0, 1000000, 1), type=pa.int64()),
    "temperature": pa.array([20.5 + i * 0.001 for i in range(1000000)],
                            type=pa.float32()),
    "status": pa.array(["OK", "WARN", "ERROR"] * 333333 + ["OK"],
                       type=pa.string()),
})

pq.write_table(
    table,
    "encoded.parquet",
    compression="zstd",
    use_dictionary=["status"],         # 只对 status 列启用字典编码
    column_encoding={
        "ts": "DELTA_BINARY_PACKED",   # 时间戳用 Delta 编码
        "temperature": "BYTE_STREAM_SPLIT",  # 浮点用 Byte Stream Split
    },
    write_statistics=True,
    version="2.6",
)

# 验证编码方式
f = pq.ParquetFile("encoded.parquet")
rg = f.metadata.row_group(0)
for i in range(rg.num_columns):
    col = rg.column(i)
    print(f"{col.path_in_schema}: encodings={col.encodings}, "
          f"compression={col.compression}")
```

            

### 8.7 Pandas 互操作

            

PyArrow 与 Pandas 的互操作是最常见的使用场景：
            
```
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Pandas DataFrame → Parquet
df = pd.DataFrame({
    "id": range(100000),
    "name": [f"item_{i}" for i in range(100000)],
    "price": [round(i * 0.99, 2) for i in range(100000)],
})
df.to_parquet("from_pandas.parquet", engine="pyarrow", compression="zstd")

# Parquet → Pandas DataFrame
df2 = pd.read_parquet("from_pandas.parquet", columns=["name", "price"])
print(df2.head())
```

            

需要注意的是，Pandas 的 `NaN` 和 Parquet 的
            null 语义不完全一致。Pandas 使用 `NaN`
            表示缺失值（对于浮点列），使用 `None` 或
            `pd.NA`（对于 Nullable 整数类型）。PyArrow
            在转换时会自动处理，但边界情况下可能需要显式指定类型映射。
            
            

## 九、Row Group 大小调优

            

### 9.1 Row Group
            大小的影响因素

            

行组大小是 Parquet
            文件性能调优中最重要的参数之一。它影响四个方面：
            
            
- **I/O 效率**：行组越大，每次 I/O
            请求读取的有效数据越多，元数据开销占比越低。
            
- **并行度**：行组是并行处理的基本单位。行组太少，Task
            数量不足，集群利用率低。
            
- **内存占用**：写入器需要在内存中缓存一个行组的数据才能刷写。行组越大，写入时的内存峰值越高。
            
- **谓词下推精度**：行组越小，统计信息的覆盖范围越小，过滤效果越好。但行组太小，元数据膨胀，整体性能反而下降。
            
            

### 9.2 行组大小 vs HDFS
            Block 大小

            

在 HDFS 上，一个经典的建议是让行组大小等于 HDFS Block
            大小（默认 128MB）。原因是：
            
            
- 如果行组大小小于 Block 大小，一个 Block
            可能包含多个行组或行组的一部分。MapReduce 的一个 Task
            处理一个 Block 时，可能需要读取相邻 Block
            中的数据来完成一个行组的读取，产生跨节点网络 I/O。
            
- 如果行组大小等于 Block 大小，一个行组恰好占一个
            Block，数据本地性（Data Locality）最好。
            
            

但在对象存储（S3、GCS）上，没有 Block
            的概念，数据本地性也不适用。此时行组大小的选择更自由。一般建议在
            128MB 到 512MB 之间，根据查询模式调整。
            

### 9.3 不同场景下的推荐大小

            
            
            
            场景
            推荐行组大小
            原因
            
            
            
            
            HDFS + Spark/Hive
            128MB（与 Block 对齐）
            数据本地性最优
            
            
            S3 + Spark
            128MB-256MB
            平衡 I/O 粒度和并行度
            
            
            DuckDB 单机分析
            256MB-1GB
            行组切换开销大于 I/O 收益
            
            
            实时查询（Impala、Presto）
            64MB-128MB
            减少单次查询的延迟
            
            
            频繁使用谓词下推
            64MB-128MB
            更细粒度的统计信息
            
            
            宽表（>100 列）
            256MB-512MB
            每列的列块足够大，压缩效果好
            
            
            
            

### 9.4 Spark 中的配置

            
```
# Spark 行组大小配置
spark.conf.set("spark.sql.parquet.rowGroupSize", str(128 * 1024 * 1024))  # 128MB

# 或者在写入时指定
df.write \
    .option("parquet.block.size", str(256 * 1024 * 1024)) \
    .parquet("output_path")
```

            

Spark 中 `parquet.block.size` 和
            `spark.sql.parquet.rowGroupSize`
            是同义参数，都控制行组的目标大小（以字节为单位）。注意这是目标大小，实际行组大小可能略有偏差，因为写入器在接近目标大小时才决定是否刷写。
            

### 9.5 行组行数 vs 行组大小

            

有两种方式控制行组粒度：按行数和按字节大小。PyArrow 的
            `row_group_size` 参数控制的是行数上限，而 Spark
            的 `parquet.block.size`
            控制的是字节大小上限。
            

行数控制更简单直观，但不同列的宽度差异可能导致实际字节大小差异很大。字节大小控制更贴近
            I/O
            行为，但需要写入器在写入过程中估算已累积数据的字节大小。
            

我认为在大多数场景下，按字节大小控制更合理。如果使用
            PyArrow
            且需要精确控制字节大小，可以预估每行的平均大小，再换算为行数：
            
```
# 假设每行平均 200 字节，目标行组大小 128MB
avg_row_bytes = 200
target_rg_bytes = 128 * 1024 * 1024
row_group_size = target_rg_bytes // avg_row_bytes  # 约 671,000 行
```

            

### 9.6 实测调优方法

            

调优行组大小的建议步骤：
            
            
- 用实际数据写入多个不同行组大小的文件。
            
- 记录文件大小和写入时间。
            
- 用实际查询测试读取性能。
            
- 检查行组统计信息的过滤效果。
            
            
```
import pyarrow as pa
import pyarrow.parquet as pq
import time

# 生成测试数据
table = pa.table({
    "id": pa.array(range(5000000), type=pa.int64()),
    "value": pa.array([float(i % 1000) for i in range(5000000)], type=pa.float64()),
    "category": pa.array([f"cat_{i % 100}" for i in range(5000000)], type=pa.string()),
})

# 测试不同行组大小
for rg_size in [50000, 100000, 500000, 1000000, 5000000]:
    start = time.time()
    pq.write_table(
        table,
        f"test_rg_{rg_size}.parquet",
        compression="zstd",
        row_group_size=rg_size,
    )
    write_time = time.time() - start

    f = pq.ParquetFile(f"test_rg_{rg_size}.parquet")
    import os
    file_size = os.path.getsize(f"test_rg_{rg_size}.parquet")
    print(f"RG Size: {rg_size:>10,}  "
          f"Row Groups: {f.metadata.num_row_groups:>3}  "
          f"File Size: {file_size:>12,}  "
          f"Write Time: {write_time:.2f}s")
```

            
            

## 十、Parquet 最佳实践

            

### 10.1 压缩算法选择

            

压缩算法的选择需要在压缩率、压缩速度和解压速度之间权衡：
            
            
            
            算法
            压缩率
            压缩速度
            解压速度
            适用场景
            
            
            
            
            Snappy
            中等
            快
            极快
            交互查询，解压速度优先
            
            
            Zstd
            高
            中等
            快
            通用推荐，压缩率和速度平衡
            
            
            LZ4
            较低
            极快
            极快
            极端速度要求
            
            
            Gzip
            高
            慢
            中等
            兼容性要求，冷数据归档
            
            
            不压缩
            无
            无开销
            无开销
            数据已经不可压缩
            
            
            
            

Zstd 是目前大多数场景下的最佳选择。它的压缩率接近
            Gzip，但解压速度接近 Snappy。Zstd
            的压缩级别可调（1-22），级别 3 是一个常用的平衡点。
            
```
# Zstd 不同级别的对比测试
import pyarrow.parquet as pq
import os

for level in [1, 3, 6, 9, 15]:
    pq.write_table(table, f"zstd_l{level}.parquet",
                   compression="zstd", compression_level=level)
    size = os.path.getsize(f"zstd_l{level}.parquet")
    print(f"Zstd level {level:>2}: {size:>12,} bytes")
```

            

### 10.2 排序对压缩率的影响

            

数据写入前按低基数列排序，可以显著提升压缩率。原因有两个：
            
            
- 排序后同一列的相邻值更可能相同或相近，字典编码和 RLE
            编码的效率更高。
            
- 排序后行组内的统计信息（min/max）范围更窄，谓词下推的过滤效果更好。
            
            
```
import pyarrow as pa
import pyarrow.parquet as pq
import os

# 未排序写入
table_unsorted = pa.table({
    "region": pa.array(["East", "West", "North", "South"] * 250000),
    "product": pa.array([f"P{i % 50}" for i in range(1000000)]),
    "amount": pa.array([float(i % 10000) for i in range(1000000)]),
})
pq.write_table(table_unsorted, "unsorted.parquet", compression="zstd")

# 按 region + product 排序后写入
indices = pa.compute.sort_indices(table_unsorted, sort_keys=[
    ("region", "ascending"), ("product", "ascending")
])
table_sorted = table_unsorted.take(indices)
pq.write_table(table_sorted, "sorted.parquet", compression="zstd")

print(f"Unsorted: {os.path.getsize('unsorted.parquet'):>12,} bytes")
print(f"Sorted:   {os.path.getsize('sorted.parquet'):>12,} bytes")
```

            

排序的收益取决于数据特征。低基数列放在排序键前面效果最好。对于已经按时间顺序生成的数据（如日志、事件），时间列天然有序，不需要额外排序。
            

### 10.3 分区策略

            

分区（Partitioning）把数据按一个或多个列的值拆分到不同的文件或目录中。分区的目标是让查询引擎在扫描前就排除大量无关数据。
            

分区策略的选择原则：
            
            
- **分区列应该是查询中最常出现在 WHERE
            子句中的列。**
            典型的分区列包括日期、地区、业务类型。
            
- **分区数量不宜过多。**
            每个分区对应一个或多个文件，分区过多导致小文件问题（Small
            File
            Problem），增加元数据开销和文件系统负担。一般建议总分区数不超过
            10000。
            
- **单个分区文件不宜太小。**
            理想情况下每个分区文件至少
            64MB-128MB。如果分区后每个文件只有几
            MB，应该降低分区粒度或合并小文件。
            
- **分区列不应该是高基数列。** 用
            `user_id`
            作为分区列会产生数百万个分区目录，这是灾难性的。
            
            
```
# 合理的分区策略
pq.write_to_dataset(
    table,
    root_path="events",
    partition_cols=["date", "region"],  # 低基数列
    compression="zstd",
)

# 不合理的分区策略（避免）
# partition_cols=["user_id"]  # 高基数，会产生大量小文件
```

            

### 10.4 Schema 设计

            

Parquet Schema 设计影响存储效率和查询性能：
            
            
- 

**使用最紧凑的物理类型。** 如果值域在
            INT32 范围内，不要用 INT64。FLOAT 够用时不要用
            DOUBLE。每个值省 4 字节，100 万行就省 4MB。
            
- 

**字符串 vs 枚举。**
            如果一个字符串列的取值只有几十种，考虑在应用层转换为整数编码。虽然
            Parquet
            的字典编码也能达到类似效果，但显式使用整数类型更可控。
            
- 

**避免过深的嵌套。** Parquet
            支持任意深度的嵌套结构，但嵌套越深，Definition Level 和
            Repetition Level
            的开销越大，编解码越慢。如果可以，把嵌套结构展平。
            
- 

**合理使用可选字段。** Required
            字段不需要存储 Definition Level（始终为最大值），比 Optional
            字段少一个编码开销。如果某列不可能为 null，声明为
            Required。
            
            

### 10.5 小文件合并

            

小文件是 Parquet
            使用中最常见的性能问题之一。大量小文件导致：
            
            
- 元数据开销大：每个文件都有独立的 Footer 和 Schema。
            
- I/O 次数多：打开每个文件都需要至少两次 I/O（读取 Footer
            + 读取数据）。
            
- 调度开销大：每个文件可能产生一个独立的 Task。
            
- 压缩率低：数据量太少，编码和压缩的效率下降。
            
            

合并小文件的方法：
            
```
import pyarrow.parquet as pq
import pyarrow.dataset as ds

# 读取包含大量小文件的目录
dataset = ds.dataset("small_files_dir", format="parquet")
table = dataset.to_table()

# 写入合并后的文件
pq.write_table(
    table,
    "merged.parquet",
    compression="zstd",
    row_group_size=1000000,
)
```

            

对于 Spark 环境，可以使用 `coalesce()` 或
            `repartition()` 控制输出文件数量：
            
```
# Spark 中控制输出文件数量
df.coalesce(10).write.parquet("output_path")

# 或按目标文件大小重新分区
spark.conf.set("spark.sql.files.maxRecordsPerFile", 1000000)
df.write.parquet("output_path")
```

            

### 10.6 写入性能优化

            

写入 Parquet 文件时的几个优化建议：
            
            
- 

**批量写入。** 避免逐行写入。每次
            `write_table()` 应该传入至少几万行的数据。PyArrow
            的写入器在内部按行组缓存数据，频繁调用小批量写入会增加
            Python 层面的开销。
            
- 

**选择合适的压缩级别。** Zstd level 1-3
            通常是写入速度和压缩率的最佳平衡点。级别 9
            以上的写入速度会显著下降，但压缩率提升有限。
            
- 

**禁用不需要的特性。**
            如果不需要统计信息（例如只做全表扫描），可以关闭统计写入以加速写入。如果某些列不需要字典编码（例如高基数字符串），显式禁用以避免字典构建的开销。
            
            
```
pq.write_table(
    table,
    "fast_write.parquet",
    compression="zstd",
    compression_level=1,
    write_statistics=False,       # 不需要统计信息时关闭
    use_dictionary=["category"],  # 只对低基数列启用字典
)
```

            

### 10.7 读取性能优化

            

读取 Parquet 文件时的几个优化建议：
            
            
- 

**始终使用投影下推。**
            只读取查询需要的列。这是 Parquet 最基本的优化手段。
            
- 

**利用谓词下推。**
            把过滤条件传递给读取器，而不是读取全部数据后在应用层过滤。
            
- 

**使用 `read_table`
            而不是逐行读取。** PyArrow 的批量读取利用了 SIMD
            解码和内存预分配，比 Python
            层面的逐行处理快几个数量级。
            
- 

**预读元数据。**
            如果需要多次读取同一个文件的不同列，先读取元数据并缓存，避免重复的
            Footer 读取。
            
            
```
# 预读元数据
pf = pq.ParquetFile("large_file.parquet")
metadata = pf.metadata  # 缓存元数据

# 后续按行组读取
for i in range(metadata.num_row_groups):
    rg_table = pf.read_row_group(i, columns=["col_a", "col_b"])
    # 处理 rg_table
```

            
            
- **使用 `ParquetDataset`
            读取分区数据。** 它自动处理分区发现和分区裁剪。
            
            
```
dataset = pq.ParquetDataset(
    "partitioned_data",
    filters=[("date", "=", "2025-01-15")],
)
table = dataset.read(columns=["user_id", "amount"])
```

            

### 10.8 Schema 演化

            

Parquet 支持有限的 Schema 演化（Schema Evolution）：
            
            
- **添加新列**：新增的列在旧文件中自动填充为
            null。这是最安全的演化操作。
            
- **删除列**：读取时指定不包含已删除列的列列表。旧文件中仍然包含该列的数据，但不会被读取。
            
- **重命名列**：Parquet
            按列名匹配，重命名等同于删除旧列 + 新增新列。
            
- **修改类型**：不支持直接修改列的物理类型。需要写入新文件。
            
            
```
# Schema 演化：读取添加了新列的混合数据集
dataset = ds.dataset("evolved_data", format="parquet")
# PyArrow 自动合并不同文件的 Schema
# 旧文件中缺失的新列会被填充为 null
table = dataset.to_table()
print(table.schema)
```

            

在 Delta Lake 和 Apache Iceberg 等表格式中，Schema
            演化有更完善的支持，包括类型安全的类型扩展（如 INT32 到
            INT64）和列重命名追踪。如果需要频繁的 Schema 变更，建议在
            Parquet 上层使用这些表格式。
            

### 10.9 与其他格式的互操作

            

Parquet 作为中间格式，经常需要与其他格式互转：
            
```
import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.csv as csv
import pyarrow.json as json_arrow

# CSV → Parquet
csv_table = csv.read_csv("input.csv")
pq.write_table(csv_table, "from_csv.parquet", compression="zstd")

# JSON → Parquet
json_table = json_arrow.read_json("input.json")
pq.write_table(json_table, "from_json.parquet", compression="zstd")

# Parquet → CSV
table = pq.read_table("input.parquet")
csv.write_csv(table, "output.csv")
```

            

CSV 和 JSON 转 Parquet
            时需要注意类型推断的准确性。PyArrow 的 CSV Reader
            会自动推断类型，但可能把整数推断为浮点数或把日期推断为字符串。显式指定
            Schema 可以避免这个问题：
            
```
schema = pa.schema([
    ("id", pa.int64()),
    ("name", pa.string()),
    ("date", pa.date32()),
    ("amount", pa.decimal128(10, 2)),
])
csv_table = csv.read_csv("input.csv", convert_options=csv.ConvertOptions(
    column_types=schema,
))
```

            

### 10.10 监控与诊断

            

生产环境中使用 Parquet 时，建议监控以下指标：
            
            
- **文件大小分布**：检查是否有大量小文件。
            
- **行组大小分布**：检查行组大小是否在合理范围内。
            
- **列压缩率**：识别压缩率异常低的列，考虑调整编码方式或排序策略。
            
- **谓词下推命中率**：检查有多少行组被统计信息过滤掉，评估数据排序和分区策略的效果。
            
            
```
import pyarrow.parquet as pq
import os

def diagnose_parquet(file_path):
    """诊断 Parquet 文件的健康状况。"""
    file_size = os.path.getsize(file_path)
    metadata = pq.read_metadata(file_path)

    print(f"File: {file_path}")
    print(f"Size: {file_size:,} bytes ({file_size / 1024 / 1024:.1f} MB)")
    print(f"Rows: {metadata.num_rows:,}")
    print(f"Columns: {metadata.num_columns}")
    print(f"Row Groups: {metadata.num_row_groups}")
    print(f"Avg Row Group Size: "
          f"{file_size / metadata.num_row_groups / 1024 / 1024:.1f} MB")
    print(f"Bytes per Row: {file_size / metadata.num_rows:.1f}")
    print()

    # 检查小行组
    small_rg_count = 0
    for i in range(metadata.num_row_groups):
        rg = metadata.row_group(i)
        rg_size_mb = rg.total_byte_size / 1024 / 1024
        if rg_size_mb  0:
        print(f"[WARN] {small_rg_count} row groups smaller than 10MB")

    # 检查列压缩率
    print(f"\n{'Column':12} {'Ratio':>8}")
    print("-" * 54)
    for j in range(metadata.num_columns):
        total_comp = 0
        total_uncomp = 0
        col_name = ""
        for i in range(metadata.num_row_groups):
            col = metadata.row_group(i).column(j)
            col_name = col.path_in_schema
            total_comp += col.total_compressed_size
            total_uncomp += col.total_uncompressed_size
        ratio = total_comp / total_uncomp if total_uncomp > 0 else 0
        flag = " [!]" if ratio > 0.9 else ""
        print(f"{col_name:12} {ratio:>7.1%}{flag}")

diagnose_parquet("output.parquet")
```

            

输出中 `[!]` 标记的列压缩率高于
            90%（接近不可压缩），可能需要关注。常见原因包括：数据本身随机性高（如
            UUID、哈希值）、已经是压缩过的二进制数据、或者编码方式不匹配。
            
            

## 参考资料

            

### 论文

            
            
- 

S. Melnik, A. Gubarev, J. J. Long, G. Romer, S.
            Shivakumar, M. Tolton, T. Vassilakis. “Dremel: Interactive
            Analysis of Web-Scale Datasets.” *VLDB*, 2010.
            Parquet 嵌套编码方案的理论基础。
            
- 

D. Lemire, L. Boytsov. “Decoding billions of integers
            in milliseconds through vectorized bit packing.”
            *Software: Practice and Experience*, 2015. Delta
            Binary Packing 编码的参考实现。
            
            

### 规范与源码

            
            
- 

Apache Parquet Format 规范。https://github.com/apache/parquet-format.
            版本参考：2.10。
            
- 

Apache Parquet Java 实现。https://github.com/apache/parquet-java.
            版本参考：1.14.x。
            
- 

Apache Arrow（含 parquet-cpp）。https://github.com/apache/arrow. PyArrow
            的底层实现。
            
            

### 文档

            
            
- 

PyArrow Parquet 文档。https://arrow.apache.org/docs/python/parquet.html.
            Python API 参考。
            
- 

Spark Parquet 数据源文档。https://spark.apache.org/docs/latest/sql-data-sources-parquet.html.
            Spark 中的 Parquet 配置项。
            
            
            

**上一篇**: 列式存储原理
            **下一篇**: Arrow 内存格式
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】ORC 文件格式与 Parquet 对照

                    

ORC 用 stripe 而非 row group、用三级统计（file/stripe/row-group index）而非独立 page index、用 PRESENT/DATA 等 stream 而非 page 组织一列。本文按 ORC 规范拆其文件尾（postscript + footer）、stripe 内部结构与 RLEv2 整数编码，并用本机 pyarrow 24.0.0 把同一份 30 万行数据写成 ORC 与 Parquet，对比真实体积与物理布局，最后给出什么场景仍用 ORC。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Apache Arrow 内存格式与零拷贝

                    

拆解 Arrow 列式内存布局（validity bitmap + value buffer + offset buffer）、零拷贝从何而来，以及 C Data Interface、IPC、Flight 三层跨边界传递。讲清 Arrow（内存计算格式）与 Parquet（磁盘存储格式）如何分工衔接。含 pyarrow 实测 C Data Interface 同地址零拷贝。