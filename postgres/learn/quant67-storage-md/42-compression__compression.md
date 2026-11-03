# 【存储工程】压缩算法工程实践

来源: https://quant67.com/post/storage/42-compression/compression.html
日期: 2025-09-20 |

---

存储系统写入磁盘的数据，绝大多数情况下存在冗余。日志文件里反复出现的时间戳格式、键值存储中前缀相似的
            key、列式存储中大量重复的枚举值——这些冗余意味着可以用更少的字节表达相同的信息。压缩（Compression）就是做这件事的：用
            CPU 时间换磁盘空间和 I/O 带宽。
            

但压缩不是免费的。每一次压缩和解压都消耗 CPU
            周期，选错算法可能让系统的尾延迟（Tail
            Latency）翻倍，甚至让压缩线程拖慢前台写入。一个存储工程师需要回答的核心问题不是”要不要压缩”，而是”在这个场景下，用哪个算法、哪个压缩级别、压缩哪一层数据，能让整体吞吐量和延迟达到最优”。
            

本文系统对比 LZ4、Zstd、Snappy、Brotli、Zlib
            等压缩算法在存储引擎中的工程实践。内容涵盖算法原理、API
            使用、压缩率与速度的实测对比、存储引擎中的配置方法，以及一套可操作的选型决策树。
            
            

**版本说明** 本文涉及的压缩库版本：LZ4
            1.10.x、Zstd 1.5.x、Snappy 1.2.x、Brotli 1.1.x、Zlib
            1.3.x。存储引擎版本：RocksDB 9.x、MySQL 8.4、PostgreSQL
            17、Kafka
            3.7。不同版本的默认行为和参数范围可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、压缩在存储系统中的角色

            

### 1.1 空间与速度的权衡

            

存储系统引入压缩的直接收益是减少磁盘占用。但在现代硬件上，压缩的间接收益往往更重要：减少
            I/O 传输量。
            

一块 SATA SSD 的顺序读带宽大约 500 MB/s，一颗现代 CPU
            核心运行 LZ4 解压的吞吐量可以超过 4000
            MB/s。这意味着如果压缩率（Compression Ratio）达到
            2:1，从磁盘读取压缩数据再解压，总耗时反而比直接读取未压缩数据更短——因为需要从磁盘读取的字节量减半了，而解压的
            CPU 开销远小于省下的 I/O 时间。
            

这个关系可以用一个简单的公式表达：
            
```
T_compressed = (原始大小 / 压缩率) / 磁盘带宽 + 原始大小 / 解压速度
T_uncompressed = 原始大小 / 磁盘带宽

当 T_compressed  列编码、字典编码、变长整数
                    |
              存储引擎层 ---------> 块压缩（Block Compression）      透明压缩（Btrfs、ZFS）
                    |
              块设备层 -----------> 硬件压缩（NVMe 控制器）
```

            

本文聚焦的是存储引擎层的块压缩（Block
            Compression）。这一层的压缩以数据块（Block）为单位——RocksDB
            默认以 4 KB 的数据块为压缩单元，Parquet
            以行组中的列块（Column
            Chunk）为压缩单元。块压缩的优势在于：可以按块随机访问（不需要解压整个文件），压缩算法的选择权在存储引擎手中，可以根据数据特征和访问模式灵活配置。
            

### 1.3
            衡量压缩效果的核心指标

            

评估一个压缩算法在存储场景中的表现，需要关注四个维度：
            
            
            
            
            
            
            
            
            指标
            定义
            重要性
            
            
            
            
            压缩率（Compression Ratio）
            原始大小 / 压缩后大小
            直接决定磁盘空间节省比例
            
            
            压缩速度（Compression Speed）
            每秒可压缩的原始数据量（MB/s）
            影响写入路径的 CPU 开销
            
            
            解压速度（Decompression Speed）
            每秒可解压的原始数据量（MB/s）
            影响读取路径的延迟
            
            
            CPU 占用率
            压缩/解压过程中消耗的 CPU 核心数
            影响系统整体吞吐量
            
            
            
            

不同场景对这四个指标的侧重不同。写密集型的日志系统（如
            Kafka）更关注压缩速度，因为数据通常只写入一次但很少被读取；读密集型的分析引擎（如
            ClickHouse）更关注解压速度和压缩率；在线事务处理系统（OLTP）则需要在压缩率和延迟之间找到平衡点。
            
            

## 二、压缩算法分类

            

压缩算法的核心思想是消除数据中的冗余。根据消除冗余的方式，可以将常见的压缩算法分为三大类。
            

### 2.1 字典方法（Dictionary
            Methods）

            

字典方法的基本思路是：在已经处理过的数据中寻找重复的字节序列，用一个短的”引用”替代重复出现的内容。
            

LZ77 算法族是字典方法的代表。LZ77 由 Abraham Lempel 和
            Jacob Ziv 在 1977 年提出，它维护一个滑动窗口（Sliding
            Window），在窗口内搜索与当前待编码数据匹配的最长子串。如果找到匹配，就输出一个
            (偏移量, 长度)
            的引用对；如果没找到匹配，就直接输出原始字节（称为字面量，Literal）。
            
```
原始数据: ABCDEFABCDEFGHIJ

LZ77 编码过程:
位置 0-5:  输出字面量 ABCDEF      （窗口中没有匹配）
位置 6-11: 输出引用 (offset=6, length=6)  （匹配窗口中位置 0-5 的 ABCDEF）
位置 12-15: 输出字面量 GHIJ        （窗口中没有匹配）
```

            

LZ4、Snappy、Zstd、Zlib/Deflate 都属于 LZ77
            的变体或改进。它们的核心差异在于：
            
            
- 匹配搜索算法：哈希链（Hash Chain）、二叉搜索树（Binary
            Search Tree）、哈希表（Hash
            Table）等，搜索算法的精度和速度直接决定压缩率和压缩速度的取舍；
            
- 引用编码方式：如何用最少的比特表示偏移量和长度；
            
- 字面量编码方式：是否对未匹配的字面量做进一步压缩（如
            Deflate 会用霍夫曼编码压缩字面量，LZ4
            则直接输出原始字节）。
            
            

### 2.2
            统计方法（Statistical Methods）

            

统计方法根据符号出现的频率分配不同长度的编码——高频符号用短编码，低频符号用长编码。
            

霍夫曼编码（Huffman
            Coding）是最经典的统计方法。它根据符号频率构建一棵二叉树，频率高的符号离根节点近（编码短），频率低的符号离根节点远（编码长）。Deflate
            算法（Zlib 的核心）就是 LZ77 + 霍夫曼编码的组合：先用 LZ77
            消除重复，再用霍夫曼编码压缩 LZ77 的输出。
            

算术编码（Arithmetic
            Coding）比霍夫曼编码的理论压缩率更高，但计算量更大。它将整个消息编码为一个
            [0, 1)
            区间内的实数，每个符号根据其概率缩小这个区间。现代压缩算法中，非对称数字系统（Asymmetric
            Numeral Systems, ANS）是算术编码的高效替代，Zstd
            在熵编码阶段使用的有限状态熵编码（Finite State Entropy,
            FSE）就是 ANS 的一种实现。
            

### 2.3 变换方法（Transform
            Methods）

            

变换方法不直接压缩数据，而是将数据变换为更适合压缩的形式。
            

Burrows-Wheeler
            变换（BWT）是代表性的变换方法。它对输入数据做一次可逆的排列变换，使得相似的上下文聚集在一起，变换后的数据用简单的行程编码（Run-Length
            Encoding, RLE）或移动到前端编码（Move-to-Front,
            MTF）就能获得很高的压缩率。bzip2 就是基于 BWT
            的压缩算法。
            

在存储引擎中，变换方法通常不单独使用，而是作为预处理步骤。例如，列式存储引擎中的位洗牌（Bit
            Shuffle）和字节洗牌（Byte
            Shuffle）就是变换方法的实际应用——把多个整数的相同位重新排列在一起，让高位字节（通常是零或相似值）集中出现，从而提高后续
            LZ4/Zstd 的压缩率。
            

### 2.4
            存储引擎中常用算法的归类

            
            
            
            
            
            
            
            
            
            
            算法
            主要方法
            熵编码
            典型压缩率
            设计侧重
            
            
            
            
            LZ4
            LZ77 变体
            无
            2.0-2.5:1
            极速压缩/解压
            
            
            Snappy
            LZ77 变体
            无
            1.5-2.0:1
            低延迟
            
            
            Zstd
            LZ77 + FSE/Huffman
            ANS（FSE）
            2.5-3.5:1
            压缩率与速度平衡
            
            
            Zlib（Deflate）
            LZ77 + Huffman
            霍夫曼
            2.5-3.0:1
            通用兼容性
            
            
            Brotli
            LZ77 + ANS + 预定义字典
            ANS
            3.0-4.0:1
            HTTP 内容压缩
            
            
            
            
            

## 三、LZ4：速度优先的压缩

            

### 3.1 设计目标与原理

            

LZ4 由 Yann Collet 在 2011
            年设计，目标明确：在保持可用压缩率的前提下，最大化压缩和解压速度。它是目前解压速度最快的通用压缩算法之一，单核解压吞吐量可以超过
            4 GB/s（取决于数据特征和硬件平台）。
            

LZ4 的核心设计决策：
            
            
- **极简的匹配搜索**：使用单级哈希表（Hash
            Table），每个位置只尝试一次匹配。这意味着它可能错过更长的匹配（降低压缩率），但搜索速度极快。
            
- **不做熵编码**：LZ77
            的输出直接以字节对齐的格式写入，不经过霍夫曼或 ANS
            编码。这省去了熵编码和熵解码的 CPU
            开销，但牺牲了压缩率。
            
- **面向现代 CPU
            优化的编码格式**：偏移量和长度的编码方式避免了位操作（Bit
            Manipulation），全部以字节为单位，解压时可以利用 64
            位寄存器和内存复制指令（如
            `memcpy`）做批量处理。
            
            

LZ4 的帧格式（Frame Format）定义了两种模式：
            
            
- **LZ4 块格式（Block
            Format）**：压缩单个数据块，没有帧头和校验信息，适合存储引擎内部使用；
            
- **LZ4 帧格式（Frame
            Format）**：包含魔数（Magic Number）、帧描述符（Frame
            Descriptor）、校验和（Checksum），适合文件存储和网络传输。
            
            

LZ4 还提供了一个高压缩率变体——LZ4HC（LZ4 High
            Compression）。LZ4HC
            使用更复杂的匹配搜索（哈希链），在牺牲压缩速度的情况下获得更高的压缩率，但解压速度与标准
            LZ4 完全相同。
            

### 3.2 C API 使用

            

LZ4 的 API 设计简洁，核心函数只有几个：
            
```
#include 
#include 
#include 
#include 

int main(void) {
    // 准备原始数据
    const char *original = "ABCDEFABCDEFGHIJABCDEFABCDEF";
    int original_size = (int)strlen(original);

    // 计算压缩后的最大可能大小
    int max_compressed_size = LZ4_compressBound(original_size);
    char *compressed = malloc(max_compressed_size);

    // 压缩
    int compressed_size = LZ4_compress_default(
        original,           // 源数据
        compressed,         // 目标缓冲区
        original_size,      // 源数据大小
        max_compressed_size // 目标缓冲区大小
    );
    if (compressed_size = 原始大小）
    );
    if (decompressed_size 
            

编译和链接：
            
```
gcc -O2 -o lz4_demo lz4_demo.c -llz4
```

            

### 3.3 LZ4HC 高压缩模式

            
```
#include 

// LZ4HC 压缩，级别范围 1-12，默认 9
int compressed_size = LZ4_compress_HC(
    original,
    compressed,
    original_size,
    max_compressed_size,
    LZ4HC_CLEVEL_DEFAULT  // 值为 9
);
```

            

LZ4HC 各压缩级别的典型表现：
            
            
            
            级别
            压缩速度（MB/s）
            压缩率
            适用场景
            
            
            
            
            1-3
            200-400
            2.0-2.2:1
            写入频繁但需要比 LZ4 更好的压缩率
            
            
            4-6
            80-200
            2.2-2.5:1
            均衡场景
            
            
            7-9
            30-80
            2.5-2.8:1
            冷数据、归档
            
            
            10-12
            10-30
            2.8-3.0:1
            极致压缩率（很少使用）
            
            
            
            

### 3.4 适用场景

            

LZ4 最适合以下存储场景：
            
            
- **热数据层**：LSM-Tree 的 L0/L1
            层，数据会被频繁读取和压缩（Compaction），需要极低的压缩/解压延迟；
            
- **实时日志系统**：写入吞吐量是瓶颈，压缩不能成为写路径的性能瓶颈；
            
- **内存缓存的溢出层**：数据从内存淘汰到磁盘时需要快速压缩，重新加载时需要快速解压；
            
- **网络传输**：在带宽有限的网络中传输数据，LZ4
            的压缩速度足以跟上网络线速。
            
            

LZ4
            不适合的场景：磁盘空间是主要成本、数据访问频率极低（冷存储）——这些场景应选择压缩率更高的算法。
            
            

## 四、Zstd：压缩率与速度的平衡

            

### 4.1 设计背景

            

Zstandard（简称 Zstd）同样由 Yann Collet 设计，2015 年在
            Facebook 内部启动，2016 年发布 1.0 版本。Zstd 的设计目标是在
            Zlib 级别的压缩率下，提供接近 LZ4 级别的解压速度——填补
            LZ4（速度快但压缩率一般）和
            Zlib（压缩率好但速度慢）之间的空白。
            

Zstd 的核心技术创新：
            
            
- **有限状态熵编码（Finite State Entropy,
            FSE）**：基于非对称数字系统（ANS）的熵编码器，比霍夫曼编码的压缩率更高，但解码速度几乎相同。FSE
            是 Zstd 压缩率优于 Zlib 的关键原因之一。
            
- **超大滑动窗口**：Zstd 支持最大 128 MB
            的窗口大小（Zlib 的 Deflate 限制为 32
            KB），更大的窗口意味着可以引用更远处的匹配，对重复模式间隔较大的数据（如日志）效果更好。
            
- **预训练字典（Trained
            Dictionary）**：可以从一组样本数据中训练出一个压缩字典，在压缩小数据块时显著提高压缩率。
            
- **灵活的压缩级别**：1 到 22
            级，外加负数级别（-1 到
            -131072）用于超快压缩。每个级别对应不同的匹配搜索深度、窗口大小和策略组合。
            
            

### 4.2 压缩级别详解

            

Zstd 的压缩级别覆盖了极宽的速度-压缩率频谱：
            
            
            
            级别范围
            压缩速度（MB/s）
            解压速度（MB/s）
            压缩率
            用途
            
            
            
            
            -5 到 -1
            800-1200
            1500-2000
            1.8-2.2:1
            超快模式，接近 LZ4
            
            
            1-3
            300-600
            1000-1500
            2.5-2.8:1
            默认范围，推荐起点
            
            
            4-9
            80-300
            800-1200
            2.8-3.2:1
            中等压缩
            
            
            10-15
            20-80
            600-1000
            3.2-3.6:1
            高压缩
            
            
            16-19
            5-20
            500-800
            3.5-3.8:1
            归档级别
            
            
            20-22
            1-5
            400-600
            3.8-4.0:1
            极致压缩（很少使用）
            
            
            
            

注意一个关键特性：**Zstd
            的解压速度基本不受压缩级别影响**。无论用级别 1
            还是级别 22
            压缩的数据，解压速度几乎相同。这意味着可以在写入时用较高级别换取更好的压缩率，而不会影响读取性能。
            

### 4.3 预训练字典

            

Zstd 的字典训练功能是其在小数据块场景中的杀手级特性。
            

压缩算法依赖在数据内部找到重复模式。当数据块很小（如 1-4
            KB）时，块内可供搜索的上下文有限，压缩率会急剧下降。预训练字典的思路是：从大量相似的数据样本中提取公共模式，压缩时引用字典中的模式，而不仅仅是当前块内的模式。
            

训练字典的命令行方式：
            
```
# 收集样本文件到一个目录
ls samples/
# sample_001.json  sample_002.json  ... sample_1000.json

# 训练字典，--maxdict 指定字典大小（字节）
zstd --train samples/* -o my_dict --maxdict=32768
```

            

在 C 代码中使用字典：
            
```
#include 
#include 
#include 

int compress_with_dict(const void *src, size_t src_size,
                       void *dst, size_t dst_capacity,
                       const void *dict, size_t dict_size) {
    // 创建压缩字典（可复用，避免反复解析字典开销）
    ZSTD_CDict *cdict = ZSTD_createCDict(dict, dict_size, 3);
    if (cdict == NULL) {
        fprintf(stderr, "创建压缩字典失败\n");
        return -1;
    }

    // 创建压缩上下文
    ZSTD_CCtx *cctx = ZSTD_createCCtx();

    // 使用字典压缩
    size_t compressed_size = ZSTD_compress_usingCDict(
        cctx, dst, dst_capacity, src, src_size, cdict
    );
    if (ZSTD_isError(compressed_size)) {
        fprintf(stderr, "压缩失败: %s\n", ZSTD_getErrorName(compressed_size));
        ZSTD_freeCCtx(cctx);
        ZSTD_freeCDict(cdict);
        return -1;
    }

    ZSTD_freeCCtx(cctx);
    ZSTD_freeCDict(cdict);
    return (int)compressed_size;
}

int decompress_with_dict(const void *src, size_t src_size,
                         void *dst, size_t dst_capacity,
                         const void *dict, size_t dict_size) {
    // 创建解压字典
    ZSTD_DDict *ddict = ZSTD_createDDict(dict, dict_size);
    ZSTD_DCtx *dctx = ZSTD_createDCtx();

    size_t decompressed_size = ZSTD_decompress_usingDDict(
        dctx, dst, dst_capacity, src, src_size, ddict
    );
    if (ZSTD_isError(decompressed_size)) {
        fprintf(stderr, "解压失败: %s\n", ZSTD_getErrorName(decompressed_size));
        ZSTD_freeDCtx(dctx);
        ZSTD_freeDDict(ddict);
        return -1;
    }

    ZSTD_freeDCtx(dctx);
    ZSTD_freeDDict(ddict);
    return (int)decompressed_size;
}
```

            

字典训练的效果示例——压缩 1 KB 的 JSON 日志条目：
            
            
            
            方式
            压缩率
            
            
            
            
            Zstd 级别 3（无字典）
            1.8:1
            
            
            Zstd 级别 3 + 16 KB 字典
            3.5:1
            
            
            Zstd 级别 3 + 32 KB 字典
            4.2:1
            
            
            
            

对小数据块，字典可以把压缩率提升一倍以上。
            

### 4.4 流式压缩

            

存储引擎中的数据通常以流的方式写入——MemTable 刷盘、WAL
            追加写、SST 文件生成都是流式操作。Zstd 的流式 API（Streaming
            API）允许逐块输入数据，内部维护压缩状态：
            
```
#include 
#include 

int stream_compress(FILE *fin, FILE *fout, int level) {
    ZSTD_CCtx *cctx = ZSTD_createCCtx();
    ZSTD_CCtx_setParameter(cctx, ZSTD_c_compressionLevel, level);

    size_t const in_buf_size = ZSTD_CStreamInSize();   // 推荐输入缓冲区大小
    size_t const out_buf_size = ZSTD_CStreamOutSize();  // 推荐输出缓冲区大小
    void *in_buf = malloc(in_buf_size);
    void *out_buf = malloc(out_buf_size);

    size_t read_size;
    while ((read_size = fread(in_buf, 1, in_buf_size, fin)) > 0) {
        int last_chunk = (read_size 
            

### 4.5 适用场景

            

Zstd 是当前存储引擎中最通用的压缩算法选择：
            
            
- **LSM-Tree 的中间层和底层**：RocksDB 从 6.x
            版本开始推荐在底层使用 Zstd（替代 Snappy 或 Zlib）；
            
- **日志存储**：Kafka 从 2.1.0 版本开始支持
            Zstd，在同等压缩率下吞吐量优于 Gzip；
            
- **列式存储文件**：Parquet、ORC 都支持 Zstd
            作为列块的压缩编码；
            
- **数据库页压缩**：MySQL 8.0 的 InnoDB 支持
            Zstd 页压缩。
            
            
            

## 五、Snappy：Google
            的工程选择

            

### 5.1 设计哲学

            

Snappy 由 Google 在 2011 年开源，在 Google 内部的名称是
            Zippy。它的设计哲学与 LZ4
            类似——速度第一，但在工程实现上有不同的侧重点。
            

Google 的设计目标（引用自 Snappy 的 README）：
            
            
- 不追求最大压缩率，也不追求与其他压缩库的兼容性；
            
- 追求非常高的速度和合理的压缩率；
            
- 在 64 位模式下的 x86 处理器上，压缩速度大约 250
            MB/s，解压速度大约 500 MB/s；
            
- 设计为即使面对恶意输入也是安全的（不会崩溃、不会无限循环）。
            
            

最后一点值得注意——“面对恶意输入的安全性”在存储引擎中很重要。存储引擎需要处理用户写入的任意数据，如果压缩/解压算法在遇到特定模式时崩溃或进入死循环，等于把一个拒绝服务攻击（Denial
            of Service, DoS）的入口暴露给了用户。
            

### 5.2 与 LZ4 的技术差异

            

Snappy 和 LZ4 都是 LZ77
            变体且都不做熵编码，但实现细节有明显差异：
            
            
            
            对比维度
            Snappy
            LZ4
            
            
            
            
            最小匹配长度
            4 字节
            4 字节
            
            
            哈希表键长度
            4 字节
            取决于加速因子
            
            
            偏移量编码
            变长编码（1-5 字节）
            固定 2 字节（Little-Endian）
            
            
            最大偏移量
            可配置，默认 32 KB
            64 KB
            
            
            块格式
            自定义流格式
            标准化的 LZ4 Block Format
            
            
            解压速度
            约 500 MB/s
            约 4000 MB/s
            
            
            压缩率
            略低于 LZ4
            略高于 Snappy
            
            
            
            

LZ4 在解压速度上的优势来自其更激进的内存对齐设计——LZ4
            的编码格式允许在解压时直接使用 8 字节宽的内存复制操作，而
            Snappy 的变长编码在解码偏移量时需要更多的分支判断。
            

### 5.3 在 Google
            基础设施中的应用

            

Snappy 在 Google 内部被广泛使用：
            
            
- **Bigtable**：使用 Snappy 作为默认的
            SSTable 压缩算法。Bigtable 的读写路径对延迟极其敏感，Snappy
            的低延迟特性与 Bigtable 的设计目标一致。
            
- **LevelDB**：Google 开源的 LSM-Tree
            引擎，默认使用 Snappy 压缩。LevelDB 是 Bigtable
            的简化版本，Snappy 的选择是从 Bigtable 继承的。
            
- **MapReduce**：中间数据（Intermediate
            Data）使用 Snappy 压缩，在 Mapper 和 Reducer 之间的 Shuffle
            阶段减少网络传输量。
            
- **gRPC**：支持 Snappy
            作为消息压缩编码。
            
            

Snappy 在 Google
            之外的影响也很大——Cassandra、HBase、MongoDB 都支持或默认使用
            Snappy。但随着 Zstd 和 LZ4
            的成熟，新的存储系统更倾向于选择这两者。
            

### 5.4 使用示例

            
```
#include 
#include 
#include 

int main() {
    std::string input = "ABCDEFABCDEFGHIJABCDEFABCDEF";
    std::string compressed;
    std::string decompressed;

    // 压缩
    snappy::Compress(input.data(), input.size(), &compressed);
    std::cout 
            
            

## 六、Brotli 与 Zlib

            

### 6.1 Zlib（Deflate）

            

Zlib 是最古老、最广泛部署的压缩库之一，其核心是 Deflate
            算法——LZ77 + 霍夫曼编码的组合，定义在 RFC 1951 中。Zlib
            本身是 Deflate
            的一个封装，增加了头部和校验和（Adler-32），定义在 RFC 1950
            中。Gzip 是在 Deflate 之上再包一层文件头和 CRC-32
            校验的文件格式，定义在 RFC 1952 中。
            
```
Gzip  = Gzip 头部 + Deflate 压缩数据 + CRC-32 校验
Zlib  = Zlib 头部 + Deflate 压缩数据 + Adler-32 校验
```

            

Zlib 的压缩级别范围是 1-9：
            
            
            
            级别
            压缩速度（MB/s）
            压缩率
            说明
            
            
            
            
            1
            100-150
            2.2:1
            最快，最低压缩率
            
            
            6
            30-50
            2.7:1
            默认级别
            
            
            9
            10-20
            2.8:1
            最慢，最高压缩率
            
            
            
            

Zlib 在存储引擎中的地位正在被 Zstd 取代。Zstd 级别 3
            的压缩率与 Zlib 级别 9 相当，但压缩速度快 5-10
            倍，解压速度快 3-5 倍。不过 Zlib
            的优势在于无处不在的兼容性——几乎所有编程语言的标准库都内置了
            Zlib 支持，几乎所有操作系统都预装了 libz。
            

### 6.2 Brotli

            

Brotli 由 Google 在 2015 年发布，最初设计目标是替代 Gzip
            用于 HTTP 内容压缩。Brotli 的核心技术特点：
            
            
- **预定义静态字典**：Brotli 内置了一个 120
            KB 的静态字典，包含 HTML、CSS、JavaScript
            中常见的关键字和模式。这使得 Brotli 在压缩 Web
            内容时效果特别好。
            
- **ANS 熵编码**：与 Zstd 类似，Brotli 使用
            ANS 做熵编码，理论压缩率高于霍夫曼编码。
            
- **二阶上下文建模（Context
            Modeling）**：Brotli
            根据前一个字节的值选择不同的概率模型，对文本数据效果显著。
            
            

Brotli 的压缩级别范围是 0-11：
            
            
            
            级别
            压缩速度（MB/s）
            解压速度（MB/s）
            压缩率
            用途
            
            
            
            
            0-1
            200-400
            400-600
            2.0-2.5:1
            快速模式
            
            
            4-6
            30-80
            350-500
            3.0-3.5:1
            通用模式
            
            
            9-11
            1-10
            300-450
            3.5-4.5:1
            最大压缩
            
            
            
            

### 6.3 Brotli
            在存储场景中的定位

            

Brotli 在纯存储引擎场景中使用较少，原因有二：
            
            
- **压缩速度偏慢**：在高压缩级别下，Brotli
            的压缩速度显著低于 Zstd，而压缩率的提升有限；
            
- **解压速度不如 LZ4 和
            Zstd**：存储引擎的读路径对解压速度敏感，Brotli
            在这方面不占优势。
            
            

Brotli 的最佳应用场景是：
            
            
- **CDN 和 Web
            服务器**：静态资源（HTML、CSS、JavaScript）可以在部署时用
            Brotli
            高级别预压缩，利用其出色的压缩率减少传输大小。所有现代浏览器都支持
            Brotli（`Content-Encoding: br`）。
            
- **冷数据归档**：数据写入后极少读取的场景，可以用
            Brotli 高级别获得最大压缩率。
            
            
            

## 七、压缩级别与 CPU
            开销的工程权衡

            

### 7.1 压缩不是免费的

            

存储引擎中的压缩操作发生在数据写入路径上，解压操作发生在数据读取路径上。每一次压缩和解压都消耗
            CPU 周期，这些 CPU 周期本来可以用于处理前台请求。
            

在 LSM-Tree 引擎中，CPU
            开销的主要来源是压缩（Compaction）过程。Compaction
            需要读取多个 SST
            文件的数据块、解压、合并排序、重新压缩、写回磁盘。如果压缩算法的
            CPU 开销太高，Compaction
            的速度跟不上写入速度，就会触发写停顿（Write Stall）。
            

### 7.2 CPU 开销的量化方法

            

衡量压缩的 CPU
            开销，不能只看压缩速度（MB/s），还需要考虑”每字节压缩消耗的
            CPU 纳秒数”和”每压缩一个字节实际节省了多少磁盘空间”。
            

一个实用的度量是压缩效率（Compression Efficiency）：
            
```
压缩效率 = (1 - 1/压缩率) / 压缩时间每字节

含义：每花费 1 纳秒 CPU 时间，能节省多少磁盘空间比例。
```

            

下面是各算法在典型文本数据上的压缩效率对比（数据来自 Zstd
            官方基准测试，使用 Silesia 语料库，单核 Intel
            i9-9900K）：
            
            
            
            
            
            
            
            
            
            
            
            算法
            压缩率
            压缩速度（MB/s）
            解压速度（MB/s）
            空间节省率
            压缩效率
            
            
            
            
            LZ4 默认
            2.101
            780
            4220
            52.4%
            高
            
            
            LZ4HC 级别 9
            2.721
            41
            4220
            63.2%
            中
            
            
            Snappy
            2.091
            565
            1730
            52.2%
            中高
            
            
            Zstd 级别 1
            2.883
            515
            1380
            65.3%
            高
            
            
            Zstd 级别 3
            2.933
            340
            1360
            65.9%
            中高
            
            
            Zstd 级别 9
            3.235
            78
            1290
            69.1%
            中
            
            
            Zstd 级别 19
            3.426
            6.4
            1170
            70.8%
            低
            
            
            Zlib 级别 1
            2.743
            100
            400
            63.5%
            中低
            
            
            Zlib 级别 6
            3.099
            33
            390
            67.7%
            低
            
            
            Zlib 级别 9
            3.106
            12
            390
            67.8%
            很低
            
            
            
            

从这张表可以看出几个关键结论：
            
            
- **Zstd 级别 1
            是综合效率最高的选择**：压缩率超过 Zlib 级别
            6，压缩速度是 Zlib 级别 6 的 15 倍，解压速度是 3.5 倍。
            
- **LZ4 在解压速度上无可匹敌**：4220 MB/s
            的解压速度是其他所有算法的 3-10 倍。
            
- **Zlib 的性价比在所有维度上都被 Zstd
            超越**：除了兼容性，没有技术理由在新系统中继续使用
            Zlib。
            
- **超高压缩级别的边际收益递减严重**：Zstd
            从级别 9 到级别 19，压缩率只提升了 6%，但压缩速度下降了 12
            倍。
            
            

### 7.3 分层压缩策略

            

基于上述分析，存储引擎中的最佳实践是对不同层的数据使用不同的压缩算法——这就是分层压缩策略（Tiered
            Compression Strategy）。
            
```
                        +-----------+
                        | MemTable  |  （内存中，不压缩）
                        +-----------+
                              |
                              v
+--------+--------+--------+--------+--------+
|  L0    |  L1    |  L2    |  L3    |  L4    |
| 无压缩 |  LZ4   |  LZ4   |  Zstd  |  Zstd  |
| 或 LZ4 |        |        | 级别3  | 级别6  |
+--------+--------+--------+--------+--------+
  热数据                                冷数据
  高频访问                              低频访问
  速度优先                              空间优先
```

            

逻辑很清晰：
            
            
- **L0 层**：刚从 MemTable
            刷下来的数据，很快会参与 Compaction，不压缩或使用 LZ4
            以最小化 Compaction 的 CPU 开销；
            
- **L1/L2 层**：仍然属于热数据，使用 LZ4
            保证读取延迟；
            
- **L3
            及更深层**：数据逐渐变冷，访问频率下降，使用 Zstd
            获得更好的压缩率，节省磁盘空间。
            
            

RocksDB
            原生支持按层配置不同的压缩算法，这在第九节详细说明。
            
            

## 八、不同数据类型的压缩效果实测

            

### 8.1 测试方法

            

不同类型的数据具有不同的内部结构和冗余模式，压缩效果差异很大。下面使用各压缩算法在几种典型存储数据类型上的表现做对比。
            

测试工具和参数：
            
```
# 使用各压缩工具的命令行版本，测量压缩率和速度
# LZ4
lz4 -B4 input_file output_file

# Zstd（级别 3）
zstd -3 input_file -o output_file

# Snappy（使用 python-snappy 或 snzip 工具）
snzip input_file

# Zlib（使用 gzip 命令，级别 6）
gzip -6 -k input_file

# Brotli（级别 6）
brotli -6 input_file -o output_file
```

            

### 8.2 各数据类型的压缩效果

            

以下数据基于对各类典型存储数据的压缩率对比（使用 100 MB
            量级的样本数据）：
            
            
            
            
            
            
            
            
            
            
            
            
            数据类型
            LZ4
            Zstd-3
            Snappy
            Zlib-6
            Brotli-6
            说明
            
            
            
            
            JSON 日志
            3.2:1
            5.1:1
            2.8:1
            4.8:1
            5.5:1
            大量重复的字段名和结构
            
            
            CSV 表格
            3.5:1
            5.5:1
            3.1:1
            5.2:1
            5.9:1
            列头重复、数值有规律
            
            
            Protocol Buffers
            1.8:1
            2.5:1
            1.6:1
            2.3:1
            2.7:1
            已经是紧凑编码，冗余较少
            
            
            整数序列（int64）
            1.5:1
            2.0:1
            1.4:1
            1.9:1
            2.1:1
            随机整数几乎不可压缩
            
            
            时间序列（时间戳+浮点数）
            2.8:1
            4.2:1
            2.5:1
            3.9:1
            4.5:1
            时间戳有递增规律
            
            
            SQL 建表语句和查询
            4.5:1
            7.2:1
            4.0:1
            6.8:1
            7.8:1
            大量重复关键字
            
            
            随机二进制
            1.00:1
            1.00:1
            1.00:1
            1.00:1
            1.00:1
            不可压缩（熵最大）
            
            
            已压缩数据（JPEG）
            1.00:1
            1.01:1
            1.00:1
            1.00:1
            1.01:1
            已压缩，无冗余可消除
            
            
            
            

关键发现：
            
            
- **文本类数据（JSON、CSV、SQL）的压缩效果最好**：这些数据包含大量重复的关键字、字段名和结构，LZ77
            类算法能找到大量匹配。
            
- **已经编码的二进制数据（Protocol
            Buffers、压缩图像）效果较差**：Protocol Buffers
            使用变长整数编码（Varint），本身已经消除了部分冗余。
            
- **随机数据和已压缩数据完全不可压缩**：这是信息论的基本结论——如果数据已经是最大熵的，任何压缩算法都无法进一步减小其大小。
            
- **Zstd 在几乎所有数据类型上都优于
            Zlib**：即使在 Zstd
            的低压缩级别（3）下，压缩率也接近或超过 Zlib
            的默认级别（6）。
            
            

### 8.3 预处理对压缩率的影响

            

对于特定数据类型，在压缩之前做适当的预处理可以显著提高压缩率。
            

**增量编码（Delta Encoding）**
            适用于递增序列（如时间戳）：
            
```
import struct

def delta_encode(timestamps):
    """将递增的时间戳序列转换为差值序列"""
    if not timestamps:
        return b""
    result = struct.pack("
            

**字节洗牌（Byte Shuffle）**
            适用于固定宽度的数值数组：
            
```
原始布局（4 个 int32，每个 4 字节）:
  [B0 B1 B2 B3] [B0 B1 B2 B3] [B0 B1 B2 B3] [B0 B1 B2 B3]

字节洗牌后:
  [B0 B0 B0 B0] [B1 B1 B1 B1] [B2 B2 B2 B2] [B3 B3 B3 B3]
```

            

洗牌后，相同位置的字节被排列在一起。如果这些整数的高位字节相似（例如都是小正数，高位字节全为
            0），洗牌后会产生大量连续的相同字节，LZ4/Zstd
            可以高效压缩。
            

Apache Arrow 和 Blosc 库都内置了字节洗牌功能，与 LZ4/Zstd
            配合使用效果显著。
            
            

## 九、存储引擎中的压缩配置

            

### 9.1 RocksDB

            

RocksDB
            对压缩的支持最为灵活，支持按层配置不同的压缩算法。
            

基本配置：
            
```
#include 
#include 
#include 

rocksdb::Options options;

// 方式一：所有层使用同一种压缩算法
options.compression = rocksdb::kZSTD;

// 方式二：按层配置不同的压缩算法（推荐）
options.compression_per_level = {
    rocksdb::kNoCompression,      // L0：不压缩
    rocksdb::kLZ4Compression,     // L1：LZ4
    rocksdb::kLZ4Compression,     // L2：LZ4
    rocksdb::kZSTD,               // L3：Zstd
    rocksdb::kZSTD,               // L4：Zstd
    rocksdb::kZSTD,               // L5：Zstd
    rocksdb::kZSTD                // L6：Zstd
};

// 配置 Zstd 的压缩级别
options.compression_opts.level = 3;

// 配置 Zstd 字典（可选，适用于小数据块）
options.compression_opts.zstd_max_train_bytes = 16 * 1024;  // 训练数据大小
options.compression_opts.max_dict_bytes = 16 * 1024;         // 字典大小

// 配置 bottommost 层使用更高压缩级别
options.bottommost_compression = rocksdb::kZSTD;
options.bottommost_compression_opts.level = 6;

// 数据块大小（影响压缩效果，更大的块通常压缩率更高）
rocksdb::BlockBasedTableOptions table_options;
table_options.block_size = 16 * 1024;  // 16 KB（默认 4 KB）
options.table_factory.reset(
    rocksdb::NewBlockBasedTableFactory(table_options)
);
```

            

RocksDB 支持的压缩算法常量：
            
```
enum CompressionType : unsigned char {
    kNoCompression     = 0x0,
    kSnappyCompression = 0x1,
    kZlibCompression   = 0x2,
    kBZip2Compression  = 0x3,
    kLZ4Compression    = 0x4,
    kLZ4HCCompression  = 0x5,
    kXpressCompression = 0x6,
    kZSTD              = 0x7,
};
```

            

RocksDB
            的数据块大小（`block_size`）对压缩效果有直接影响：
            
            
            
            block_size
            压缩率
            随机读性能
            说明
            
            
            
            
            4 KB（默认）
            基准
            最优
            每次读取解压的数据量最小
            
            
            16 KB
            提升 10-20%
            略有下降
            更大的上下文帮助找到更多匹配
            
            
            64 KB
            提升 15-30%
            明显下降
            随机读需要解压更多无用数据
            
            
            256 KB
            提升 20-35%
            大幅下降
            仅适合顺序扫描场景
            
            
            
            

### 9.2 MySQL（InnoDB）

            

MySQL 的 InnoDB 存储引擎支持两种压缩方式：
            

**传统表压缩（Table Compression）**：
            
```
-- 创建压缩表，KEY_BLOCK_SIZE 指定压缩后的页大小（KB）
CREATE TABLE logs (
    id BIGINT PRIMARY KEY,
    timestamp DATETIME NOT NULL,
    message TEXT
) ENGINE=InnoDB
  ROW_FORMAT=COMPRESSED
  KEY_BLOCK_SIZE=8;
```

            

`KEY_BLOCK_SIZE` 的含义：InnoDB 默认页大小是
            16 KB，设置 `KEY_BLOCK_SIZE=8`
            表示压缩后的页目标大小为 8 KB。如果某个页的数据压缩后超过 8
            KB，InnoDB 会进行页分裂（Page Split）。
            

**页级透明压缩（Transparent Page
            Compression）**，MySQL 8.0 引入：
            
```
-- 使用 Zlib 压缩
CREATE TABLE events (
    id BIGINT PRIMARY KEY,
    data JSON
) ENGINE=InnoDB
  COMPRESSION='zlib';

-- 使用 LZ4 压缩（MySQL 8.0.18+）
CREATE TABLE events_lz4 (
    id BIGINT PRIMARY KEY,
    data JSON
) ENGINE=InnoDB
  COMPRESSION='lz4';

-- 使用 Zstd 压缩（MySQL 8.4+）
ALTER TABLE events COMPRESSION='zstd';
```

            

透明页压缩依赖文件系统的打孔（Hole
            Punching）功能——压缩后页的尾部空间通过
            `fallocate(FALLOC_FL_PUNCH_HOLE)`
            释放回文件系统。这要求文件系统支持稀疏文件（Sparse
            File），如 ext4 或 XFS。
            

### 9.3 PostgreSQL

            

PostgreSQL 的主表使用 TOAST（The Oversized-Attribute
            Storage Technique）机制自动压缩大字段。从 PostgreSQL 14
            开始支持选择压缩算法：
            
```
-- 查看当前默认压缩算法
SHOW default_toast_compression;

-- 设置默认压缩算法为 LZ4（PostgreSQL 14+）
SET default_toast_compression = 'lz4';

-- 建表时指定列的压缩算法
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title TEXT,
    content TEXT COMPRESSION lz4,    -- 使用 LZ4
    metadata JSONB COMPRESSION pglz  -- 使用 PostgreSQL 内置的 pglz
);

-- 修改已有列的压缩算法
ALTER TABLE documents ALTER COLUMN content SET COMPRESSION lz4;
```

            

PostgreSQL 支持的压缩算法：
            
            
            
            算法
            说明
            版本要求
            
            
            
            
            pglz
            PostgreSQL 内置算法，无需外部依赖
            所有版本
            
            
            lz4
            需要编译时启用 `--with-lz4`
            PostgreSQL 14+
            
            
            
            

需要注意的是，`ALTER TABLE ... SET COMPRESSION`
            只影响后续写入的数据，已有数据不会被自动重新压缩。要重新压缩已有数据，需要执行
            `VACUUM FULL` 或 `pg_repack`。
            

### 9.4 Kafka

            

Kafka 的压缩发生在消息批次（Record
            Batch）级别，而不是单条消息级别。生产者（Producer）将多条消息打包成一个批次后整体压缩，消费者（Consumer）接收到批次后整体解压。这种批次级压缩比逐条压缩效率高得多，因为同一批次内的消息通常结构相似，LZ77
            类算法可以找到大量跨消息的匹配。
            

生产者配置：
            
```
# 压缩算法选择
compression.type=zstd

# 批次大小（字节），更大的批次通常压缩率更高
batch.size=65536

# 延迟发送以积累更多消息到同一批次
linger.ms=5
```

            

Kafka 支持的压缩算法及对比：
            
            
            
            算法
            Kafka 版本
            压缩率（JSON 日志）
            生产者吞吐量影响
            
            
            
            
            none
            所有
            1:1
            基准
            
            
            gzip
            所有
            5.0:1
            下降 40-60%
            
            
            snappy
            所有
            2.8:1
            下降 5-10%
            
            
            lz4
            0.10.0+
            3.2:1
            下降 3-8%
            
            
            zstd
            2.1.0+
            5.1:1
            下降 10-20%
            
            
            
            

Kafka 的 Broker 端可以配置压缩策略：
            
```
# Broker 端：是否重新压缩消息
# producer - 保持生产者的压缩格式（默认）
# uncompressed - Broker 存储未压缩数据
# gzip/snappy/lz4/zstd - Broker 用指定算法重新压缩
compression.type=producer
```

            

生产环境中的推荐做法是让生产者使用 Zstd 压缩，Broker 配置
            `compression.type=producer` 直接存储，避免 Broker
            端的重新压缩开销。
            
            

## 十、压缩算法选型决策树

            

在实际项目中选择压缩算法时，可以按照以下决策树逐步缩小选择范围。
            
```
                         开始选型
                           |
                           v
                  是否需要兼容现有系统？
                   /                \
                 是                  否
                 |                    |
                 v                    v
          现有系统用什么？      数据是否已经编码或压缩？
          直接沿用              /                    \
                              是                      否
                              |                        |
                              v                        v
                       不压缩或 LZ4            读写比例如何？
                     （收益很小）              /       |       \
                                          写多读少  读写均衡  读少写多
                                            |        |         |
                                            v        v         v
                                          Zstd     Zstd      LZ4
                                         级别1-3   级别3-6
                                            |        |         |
                                            v        v         v
                                     数据块是否很小（
            
            
            
            
            
            
            
            场景
            推荐算法
            理由
            
            
            
            
            LSM-Tree 热数据层（L0/L1）
            LZ4 或不压缩
            数据频繁参与 Compaction，速度优先
            
            
            LSM-Tree 冷数据层（L3+）
            Zstd 级别 3-6
            访问频率低，空间优先
            
            
            OLTP 数据库页压缩
            LZ4 或 Zstd 级别 1-3
            延迟敏感，需要平衡
            
            
            消息队列（Kafka 等）
            Zstd 级别 3
            批次压缩效率高，网络带宽敏感
            
            
            列式存储文件（Parquet 等）
            Zstd 级别 3-6
            列数据结构规律性强，压缩率高
            
            
            HTTP 内容压缩
            Brotli 级别 4-6
            静态资源可预压缩，内置 Web 字典
            
            
            实时日志采集
            LZ4
            写入吞吐量优先
            
            
            冷数据归档
            Zstd 级别 9-15
            只写一次、极少读取
            
            
            嵌入式/IoT 设备
            LZ4 或 Snappy
            CPU 资源有限
            
            
            小数据块（<4 KB）
            Zstd + 训练字典
            字典显著提升小块压缩率
            
            
            
            

选型的核心原则：
            
            
- **默认选 Zstd 级别
            3**，除非有明确的理由选择其他算法。Zstd
            在压缩率、速度、CPU 开销三个维度上都处于帕累托前沿（Pareto
            Frontier）。
            
- **对延迟敏感的热路径用 LZ4**。LZ4
            的解压速度比 Zstd 快 3-4 倍，在 P99
            延迟敏感的场景中这个差距很关键。
            
- **不要在新系统中使用 Zlib**。Zstd
            在所有维度上都优于 Zlib，唯一的例外是需要与不支持 Zstd
            的旧系统兼容。
            
- **Snappy 只在 Google
            生态或历史遗留系统中使用**。新项目应优先选择
            LZ4（速度场景）或 Zstd（通用场景）。
            
- **压缩级别的选择比算法的选择更重要**。同一个算法的不同级别之间的性能差异，往往大于不同算法在相同”性能档位”之间的差异。
            
            
            

## 十一、参考文献

            

### 标准与规范

            
            
- 

RFC 1950, “ZLIB Compressed Data Format Specification
            version 3.3,” P. Deutsch, J-L. Gailly, 1996. Zlib
            格式规范。
            
- 

RFC 1951, “DEFLATE Compressed Data Format
            Specification version 1.3,” P. Deutsch, 1996. Deflate
            算法规范。
            
- 

RFC 1952, “GZIP file format specification version
            4.3,” P. Deutsch, 1996. Gzip 文件格式规范。
            
- 

RFC 7932, “Brotli Compressed Data Format,” J.
            Alakuijala, Z. Szabadka, 2016. Brotli
            压缩格式规范。
            
- 

LZ4 Frame Format Description, https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md.
            LZ4 帧格式规范。
            
- 

LZ4 Block Format Description, https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md.
            LZ4 块格式规范。
            
- 

Zstandard Compression Format, RFC 8478, https://datatracker.ietf.org/doc/html/rfc8478.
            Zstd 压缩格式规范。
            
            

### 论文与技术文档

            
            
- 

J. Ziv, A. Lempel, “A Universal Algorithm for
            Sequential Data Compression,” *IEEE Transactions on
            Information Theory*, vol. 23, no. 3, pp. 337-343, 1977.
            LZ77 原始论文。
            
- 

J. Duda, “Asymmetric numeral systems: entropy coding
            combining speed of Huffman coding with compression rate of
            arithmetic coding,” arXiv:1311.2540, 2013. ANS
            编码的理论基础，Zstd 和 Brotli 的熵编码核心。
            
- 

Y. Collet, “Finite State Entropy - A new breed of
            entropy coder,” 2013, https://github.com/Cyan4973/FiniteStateEntropy.
            FSE 编码器的设计文档，Zstd 的熵编码实现。
            
- 

Y. Collet, M. Kucherawy, “Zstandard Compression and
            the ‘application/zstd’ Media Type,” RFC 8878, 2021. Zstd
            的正式标准化文档。
            
            

### 源码

            
            
- 

`lz4/lz4`, GitHub 仓库, https://github.com/lz4/lz4. LZ4
            压缩库源码，`lib/lz4.c`
            是核心压缩/解压实现。
            
- 

`facebook/zstd`, GitHub 仓库, https://github.com/facebook/zstd. Zstd
            压缩库源码，`lib/compress/` 和
            `lib/decompress/`
            分别是压缩和解压的实现。
            
- 

`google/snappy`, GitHub 仓库, https://github.com/google/snappy. Snappy
            压缩库源码。
            
- 

`google/brotli`, GitHub 仓库, https://github.com/google/brotli. Brotli
            压缩库源码。
            
- 

`madler/zlib`, GitHub 仓库, https://github.com/madler/zlib. Zlib
            压缩库源码。
            
            

### 存储引擎文档

            
            
- 

RocksDB Compression Wiki, https://github.com/facebook/rocksdb/wiki/Compression.
            RocksDB 压缩配置的官方文档。
            
- 

MySQL InnoDB Table Compression, https://dev.mysql.com/doc/refman/8.4/en/innodb-compression.html.
            MySQL InnoDB 表压缩的官方文档。
            
- 

PostgreSQL TOAST, https://www.postgresql.org/docs/17/storage-toast.html.
            PostgreSQL TOAST 机制文档。
            
- 

Kafka Compression, https://kafka.apache.org/documentation/#producerconfigs_compression.type.
            Kafka 压缩配置文档。
            
            

### 基准测试

            
            
- 

Zstd Benchmarks, https://github.com/facebook/zstd#benchmarks.
            Zstd 官方基准测试数据，基于 Silesia 语料库，包含与
            LZ4、Snappy、Zlib 的对比。
            
- 

lzbench, [https://github.com/inikep/lzbench](https://github.com/inikep/lzbench).
            一个开源的压缩算法基准测试框架，支持几十种压缩算法的统一对比。
            
            
            

**上一篇**: 存储编码技术：从变长整数到字典编码
            **下一篇**: 校验和与数据完整性
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】压缩与编码

                    

ClickHouse 列压缩：LZ4、ZSTD、Delta、DoubleDelta、Gorilla 时序编码与列类型关系；CODEC 链顺序、LowCardinality 与 PG TOAST 对照。压缩比须本机实测，本文不编造倍数。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】列式编码与压缩

                    

拆解 Parquet 的两层缩减：专用编码（dictionary / RLE / DELTA_BINARY_PACKED / BYTE_STREAM_SPLIT）降熵，再用 zstd/snappy/lz4/gzip 压字节。用 pyarrow 在同一列上实测不同编码+压缩组合的体积与读取耗时（3M 行，7 轮中位数），并与 ClickHouse CODEC 做同思想不同落地的对照。
                

                
                    

2026-06-18 · database / storage
                    

### 【列存引擎内核】ClickHouse 与 DuckDB 源码级拆解

                    

主选 ClickHouse 拆解 MergeTree 存储格式、向量化执行与分布式协调；DuckDB 作为嵌入式 OLAP 对照。覆盖列存文件布局、merge 机制、跳数索引与生产故障模式，面向数据平台工程师与从 PG/MySQL 转 OLAP 的 DBA。
                

                
                    

2025-09-13 · storage
                    

### 【存储工程】列式存储原理：为什么分析查询快 10 倍

                    

一条典型的分析查询只访问表中数百列里的三四列，行式存储却把整行数据从磁盘搬进内存，绝大多数字节在读入后立刻被丢弃。列式存储（Columnar Storage）把同一列的值连续存放，查询只需要读取涉及到的列，I/O 量可以降低一到两个数量级。但 I/O 减少只是故事的一半——列式布局还为压缩、向量化执行（Vectoriz…