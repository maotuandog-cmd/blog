# 【存储工程】序列化格式深度对比

来源: https://quant67.com/post/storage/44-serialization/serialization.html
日期: 2025-09-22 |

---

上一篇我们讨论了校验和（Checksum）在数据完整性保障中的作用。数据从内存写到磁盘、从一个节点发送到另一个节点，中间还有一个绕不开的步骤：把内存中的结构化数据转换成字节序列，再从字节序列还原回来。这个过程就是序列化（Serialization）与反序列化（Deserialization）。
            

序列化格式的选择直接影响存储系统的三个核心指标：写入吞吐量（编码速度）、读取延迟（解码速度）、磁盘/网络带宽占用（序列化后的数据大小）。不同的格式在这三个维度上做了不同的取舍。Protocol
            Buffers 追求紧凑编码和向后兼容，FlatBuffers 和 Cap’n Proto
            追求零拷贝（Zero-Copy）反序列化以消除解码开销，MessagePack
            和 CBOR 走无模式（Schema-less）路线以换取灵活性，Apache Avro
            则把模式演进（Schema Evolution）做到了核心设计中。
            

本文从存储系统工程师的视角，逐一拆解这些格式的编码原理、内存布局和兼容性设计，再通过基准测试数据和实际存储系统的选型案例，回答一个实际问题：在你的场景里，应该选哪个？
            
            

## 一、序列化在存储系统中的角色

            

### 1.1 从内存到字节流

            

存储系统的核心操作可以归结为两件事：把数据写下去，把数据读回来。内存中的数据是带类型的结构体、对象、哈希表；磁盘和网络上的数据是无类型的字节流。序列化就是连接这两个世界的桥梁。
            

一个键值存储引擎（如 RocksDB）每次 `Put`
            操作，都需要把用户传入的键值对编码成字节序列写入预写日志（WAL）和
            MemTable；每次 `Get` 操作，都需要从 SSTable
            中读取字节序列并解码回用户可用的数据。一个分布式数据库（如
            CockroachDB）的每次 Raft
            日志复制，都需要把提案（Proposal）序列化后通过网络发送给其他副本。
            

序列化格式的选择在这些路径上的影响是乘法效应：如果每次操作多花
            100 纳秒在序列化上，每秒百万次操作就多花 0.1 秒的 CPU
            时间。
            

### 1.2
            格式选择影响的三个维度

            
            
            
            
            
            
            
            
            维度
            影响
            典型场景
            
            
            
            
            编码/解码速度
            直接影响写入吞吐和读取延迟
            高频写入的日志系统、低延迟读取的缓存系统
            
            
            序列化后大小
            影响磁盘占用和网络带宽
            大规模数据存储、跨数据中心复制
            
            
            模式兼容性
            影响系统升级和数据迁移的难度
            长期存储的持久化数据、多版本共存的微服务
            
            
            
            

这三个维度很难同时最优化。紧凑的编码通常需要更多 CPU
            来编解码；零拷贝格式牺牲紧凑性以换取反序列化速度；无模式格式在每条消息里携带字段名，换来了灵活性但增加了体积。
            

### 1.3 序列化不等于压缩

            

一个常见的误解是把序列化和压缩（Compression）混为一谈。序列化是把结构化数据转换成字节序列，保留了数据的完整语义；压缩是对已有的字节序列做冗余消除，不关心数据的语义结构。在实际存储系统中，序列化和压缩通常是两个独立的步骤：先序列化，再压缩。
            

例如，RocksDB 的 SSTable
            先用内部编码格式序列化键值对，再对整个数据块（Block）做
            Snappy 或 LZ4 压缩。Kafka 的消息先用 Protobuf 或 Avro
            序列化，再在批次（Batch）级别做 ZSTD
            压缩。把这两个步骤分开的好处是：序列化格式可以针对数据结构做语义优化（如
            Varint 编码、Delta
            编码），压缩算法可以针对字节模式做统计优化。
            
            

## 二、Schema vs
            Schema-less

            

### 2.1 两种路线

            

序列化格式在设计上的第一个分叉点是：需不需要预定义模式（Schema）？
            

有模式（Schema-based）的格式要求通信双方事先约定数据结构。编码时只写值，不写字段名；解码时依靠模式定义来确定每个字段的位置和类型。代表格式：Protocol
            Buffers、FlatBuffers、Cap’n Proto、Apache Avro。
            

无模式（Schema-less）的格式在每条消息中自描述。编码时把字段名（或等价标识）和值一起写入字节流；解码时不依赖外部模式定义。代表格式：JSON、MessagePack、CBOR。
            

### 2.2 有模式的优势

            
            
- 

**编码紧凑**：字段名不出现在编码结果中，用字段编号（Field
            Number）代替。对于字段名长、字段数多的消息，体积差异显著。
            
- 

**类型安全**：编码和解码都基于模式定义中的类型信息，类型不匹配在编译期（生成代码时）就能发现。
            
- 

**代码生成**：编译器根据模式定义生成各语言的序列化/反序列化代码，减少手写解析逻辑的错误。
            
- 

**文档效果**：`.proto`
            文件、`.fbs`
            文件本身就是接口定义，比口头约定或文档更准确。
            
            

### 2.3 无模式的优势

            
            
- 

**灵活性**：不需要事先约定结构，适合动态类型语言（Python、JavaScript）和结构频繁变化的场景。
            
- 

**调试友好**：序列化后的数据自描述，工具可以直接解析，不需要模式定义文件。
            
- 

**低门槛**：不需要额外的编译步骤（如
            `protoc`），开箱即用。
            
            

### 2.4 工程权衡

            

在存储系统中，持久化到磁盘的数据通常用有模式格式。原因很直接：磁盘上的数据可能存活数月甚至数年，没有模式定义就无法正确解码历史数据。有模式格式的字段编号机制天然支持向后兼容和向前兼容，让系统升级时不必重写全部历史数据。
            

无模式格式更适合以下场景：
            
            
- 配置文件和元数据（结构不固定，变更频繁）
            
- 日志和监控数据（字段经常增减，且通常是追加写入、短期保留）
            
- 动态语言的 RPC 调用（不想引入代码生成的编译步骤）
            
            

下面这张表总结了本文讨论的各格式在模式维度上的位置：
            
            
            
            
            
            
            
            
            
            格式
            模式要求
            字段标识方式
            IDL 语言
            
            
            
            
            Protocol Buffers
            必须
            字段编号
            `.proto`
            
            
            FlatBuffers
            必须
            字段编号（vtable）
            `.fbs`
            
            
            Cap’n Proto
            必须
            字段编号
            `.capnp`
            
            
            Apache Avro
            必须（但 Schema 随数据存储）
            字段位置（按 Schema 顺序）
            `.avsc`（JSON）/
            `.avdl`（IDL）
            
            
            MessagePack
            不需要
            字段名（字符串）或数组下标
            无
            
            
            CBOR
            不需要
            字段名（字符串或整数标签）
            无（可选 CDDL）
            
            
            JSON
            不需要
            字段名（字符串）
            无
            
            
            
            
            

## 三、Protocol Buffers

            

### 3.1 概述

            

Protocol Buffers（简称 Protobuf）由 Google 在 2001
            年内部开发，2008 年开源。当前主流版本是 proto3（2016
            年发布），proto2 仍在 Google 内部广泛使用。Protobuf
            是存储系统和分布式系统中使用最广泛的序列化格式之一：gRPC
            默认使用 Protobuf 作为传输格式，etcd 用 Protobuf 编码 Raft
            日志和存储数据，CockroachDB 用 Protobuf
            定义内部数据结构。
            

### 3.2 Wire Format 编码原理

            

Protobuf 的线格式（Wire
            Format）是一种基于标签-长度-值（Tag-Length-Value，简称
            TLV）的变长编码。每个字段由一个标签（Tag）和一个值（Value）组成，标签编码了字段编号和线类型（Wire
            Type）。
            

以一个简单的消息定义为例：
            
```
syntax = "proto3";

message Person {
  int32 id = 1;
  string name = 2;
  string email = 3;
}
```

            

编码后的字节布局如下：
            
```
字段结构: [tag] [value]  或  [tag] [length] [value]

Tag 编码:  (field_number   0
 -1 ->  1
  1 ->  2
 -2 ->  3
  2 ->  4
  ...

公式: (n > 31)  （对于 sint32）
```

            

这样，绝对值小的负数也能用少量字节表示。
            

### 3.3 一个完整的编码示例

            

下面用 Python 的 `protobuf`
            库演示编码和手动解析：
            
```
# person.proto 已编译为 person_pb2.py
from person_pb2 import Person

p = Person()
p.id = 150
p.name = "Alice"
p.email = "alice@example.com"

data = p.SerializeToString()
print(f"序列化后大小: {len(data)} 字节")
print(f"十六进制: {data.hex()}")
```

            
```
输出（预期）:
序列化后大小: 30 字节
十六进制: 089601120541 6c69636501a0e616 616c696365406578616d706c652e636f6d
```

            

手动拆解编码结构：
            
```
08        -> Tag: field=1, wire_type=0 (Varint)
96 01     -> Varint: 150  (id)
12        -> Tag: field=2, wire_type=2 (Length-delimited)
05        -> Length: 5
41 6c 69 63 65 -> "Alice"  (name)
1a        -> Tag: field=3, wire_type=2 (Length-delimited)
10        -> Length: 16
61 6c 69 63 65 40 65 78 61 6d 70 6c 65 2e 63 6f 6d -> "alice@example.com"  (email)
```

            

### 3.4 向后兼容与向前兼容

            

Protobuf 的兼容性设计围绕字段编号（Field
            Number）展开。核心规则：
            
            
- 

**新增字段**：新代码发出的消息包含新字段，旧代码遇到不认识的字段编号会跳过（保留未知字段）。这就是向前兼容（Forward
            Compatibility）——旧代码可以处理新格式的消息。
            
- 

**删除字段**：旧消息中包含已删除字段的编号，新代码遇到不认识的字段编号同样会跳过。这就是向后兼容（Backward
            Compatibility）——新代码可以处理旧格式的消息。
            
- 

**禁止修改已有字段的编号和类型**：字段编号是编码的核心标识，改了编号等于创建了一个新字段。
            
- 

**使用 `reserved`
            防止编号复用**：删除字段后，用 `reserved`
            声明保留该编号，避免未来新增字段时意外复用。
            
            
```
syntax = "proto3";

message Person {
  int32 id = 1;
  string name = 2;
  // email 字段已删除，保留编号 3
  reserved 3;
  reserved "email";

  string phone = 4;  // 新增字段
}
```

            

### 3.5 proto2 与 proto3
            的关键差异

            
            
            
            
            
            
            
            
            特性
            proto2
            proto3
            
            
            
            
            字段标签
            `required`/`optional`/`repeated`
            隐式 `optional`/`repeated`
            
            
            默认值
            用户自定义
            固定为类型零值
            
            
            未知字段
            保留
            3.5 版本后保留（早期版本丢弃）
            
            
            `map` 类型
            不支持
            支持
            
            
            JSON 映射
            非标准
            标准定义
            
            
            
            

proto3
            的一个重要设计变化是：字段值等于默认值时不编码。这意味着你无法区分”字段被显式设置为零值”和”字段未设置”。如果业务逻辑需要这个区分，可以使用
            `optional` 关键字（proto3 从 3.15
            版本开始重新支持）或 wrapper 类型。
            

### 3.6
            在存储系统中的注意事项

            

Protobuf 用于持久化存储时有几个需要特别注意的问题：
            
            
- 

**确定性编码（Deterministic
            Serialization）**：Protobuf
            标准不保证相同的消息产生相同的字节序列。`map`
            类型的迭代顺序是不确定的，不同语言的实现可能对字段排序不同。如果需要对序列化后的数据做哈希或签名，必须显式启用确定性编码选项。
            
- 

**消息大小限制**：默认的解析限制是
            64MB（`CodedInputStream::SetTotalBytesLimit`）。存储大对象时需要注意这个限制。
            
- 

**不支持随机访问**：Protobuf
            编码的消息必须从头到尾顺序解析，无法跳到某个字段直接读取。如果只需要消息中的少数几个字段，仍然要解析整条消息。这一点在大消息场景下是性能瓶颈，也是
            FlatBuffers 和 Cap’n Proto 要解决的核心问题。
            
            
            

## 四、FlatBuffers

            

### 4.1 设计动机

            

FlatBuffers 由 Google 的 Wouter van Oortmerssen 在 2014
            年开发，最初面向游戏开发场景。游戏引擎需要每帧处理大量数据（场景图、物理状态、网络同步），传统的序列化-解码流程（先分配内存，再逐字段解析填充）会产生不可接受的延迟和
            GC 压力。
            

FlatBuffers 的核心目标是零拷贝反序列化（Zero-Copy
            Deserialization）：接收到序列化数据后，不需要解码，直接在原始字节缓冲区（Buffer）上读取字段值。不分配额外内存，不做数据拷贝，不做解析——“反序列化”的时间复杂度是
            O(1)。
            

### 4.2 内存布局

            

FlatBuffers 的二进制格式由以下几个部分组成：
            
```
┌─────────────────────────────────────────────┐
│                FlatBuffer                    │
├─────────────────────────────────────────────┤
│  Root Table Offset (4 bytes, uint32)         │  string/子表) │     │
│  └─────────────────────────────────────┘     │
├─────────────────────────────────────────────┤
│  String / Vector / Nested Table Data         │
└─────────────────────────────────────────────┘
```

            

关键设计点：
            
            
- 

**VTable（虚表）**：每种 Table
            类型对应一个
            VTable，记录每个字段在对象数据区域中的偏移量。如果某个字段的偏移量为
            0，表示该字段未设置，返回默认值。多个相同结构的对象可以共享同一个
            VTable，节省空间。
            
- 

**相对偏移**：所有引用类型的指针都用相对偏移（Relative
            Offset）表示，而不是绝对地址。这让缓冲区可以在内存中自由移动（比如通过
            `mmap`
            映射文件、通过网络传输）而不需要修复指针。
            
- 

**内联标量（Inline
            Scalars）**：整数、浮点数等标量类型直接内联存储在
            Table
            的数据区域中。字符串（String）、向量（Vector）和嵌套表（Nested
            Table）通过偏移引用。
            
            

### 4.3 Schema
            定义与代码生成

            

FlatBuffers 使用 `.fbs` 文件定义模式：
            
```
namespace storage.example;

enum Color : byte { Red = 0, Green, Blue }

table Monster {
  pos: Vec3;
  mana: short = 150;
  hp: short = 100;
  name: string (required);
  color: Color = Blue;
  inventory: [ubyte];
  weapons: [Weapon];
  equipped: Equipment;
}

table Weapon {
  name: string;
  damage: short;
}

struct Vec3 {
  x: float;
  y: float;
  z: float;
}

union Equipment { Weapon }

root_type Monster;
```

            

`table` 和 `struct`
            的区别：`struct`
            的字段不能缺失、不能变更，数据直接内联存储，没有 VTable
            开销；`table` 支持字段的增删和默认值，有 VTable
            间接层。对于已知不会变更的小型固定结构（如坐标、时间戳），用
            `struct` 性能更好。
            

用 `flatc` 编译器生成 C++
            代码后，读取数据不需要解析：
            
```
#include "monster_generated.h"

// data 是从文件/网络接收的原始字节缓冲区
const uint8_t* data = receive_buffer();
size_t size = receive_size();

// "反序列化"：只是一次指针转换，O(1)
auto monster = GetMonster(data);

// 直接读取字段，通过 VTable 查找偏移
auto hp = monster->hp();          // 内联读取，无拷贝
auto name = monster->name();      // 返回指向缓冲区内字符串的指针
auto pos = monster->pos();        // struct 直接内联
auto weapons = monster->weapons();
if (weapons) {
    for (size_t i = 0; i size(); i++) {
        auto w = weapons->Get(i);
        // w->name() 和 w->damage() 同样是零拷贝读取
    }
}
```

            

### 4.4 兼容性规则

            

FlatBuffers 的兼容性规则比 Protobuf 更严格：
            
            
- 新字段只能追加到 Table 定义的末尾（因为 VTable
            按字段定义顺序索引）。
            
- 不能删除字段，但可以标记为
            `deprecated`（VTable
            中对应位置保留，但代码生成器不再生成访问方法）。
            
- 不能修改字段类型。
            
- `struct` 的字段不能增减或重排。
            
            

### 4.5 适用场景与局限

            

FlatBuffers
            最大的优势是读取密集型场景：数据写一次、读多次，而且每次读取只访问少数字段。在这种模式下，零拷贝反序列化的优势最明显——不需要解析整条消息就能访问任意字段。
            

局限性：
            
            
- 编码后体积通常比 Protobuf 大
            10%~30%，因为需要对齐填充（Alignment Padding）和 VTable
            开销。
            
- 构建（序列化）过程比 Protobuf
            复杂：需要先创建所有子对象，再从叶子到根组装 Buffer。
            
- 缓冲区是不可变的，修改已序列化的数据需要重新构建整个
            Buffer。
            
- 生态和工具链不如 Protobuf 成熟。
            
            
            

## 五、Cap’n Proto

            

### 5.1 设计哲学

            

Cap’n Proto 由 Kenton Varda 开发——他也是 Protobuf v2
            的主要作者。Cap’n Proto 可以看作”Protobuf 设计者对 Protobuf
            缺陷的反思”。它的核心设计哲学是：序列化格式和内存表示应该是同一种格式。也就是说，数据在内存中的布局就是线上传输和磁盘持久化的格式，反序列化的成本为零。
            

Cap’n Proto 的口号是”infinitely
            faster”——不是”很快”，而是”反序列化时间为零”。
            

### 5.2 编码方式

            

Cap’n Proto
            把数据组织成固定大小的段（Segment），每个段是一块连续内存。消息由一个或多个段组成，段的列表记录在消息头部。
            
```
消息结构:
┌────────────────────────────┐
│  Segment Count (4 bytes)   │
│  Segment 0 Size (4 bytes)  │
│  Segment 1 Size (4 bytes)  │
│  ...                       │
│  Padding to 8-byte align   │
├────────────────────────────┤
│  Segment 0 Data            │
│  ┌──────────────────────┐  │
│  │  Root Struct Pointer  │  │
│  │  Data Section         │  │  
            
- **Struct
            Pointer**：指向一个结构体，编码了数据段大小和指针段大小。
            
- **List
            Pointer**：指向一个列表，编码了元素类型和元素数量。
            
- **Far
            Pointer**：跨段引用，编码了目标段编号和段内偏移。
            
            

### 5.3 Schema 定义

            

Cap’n Proto 的模式定义语言与 Protobuf
            类似，但有几个独特设计：
            
```
@0xdbb9ad1f14bf0b36;  # 文件唯一标识符

struct Person {
  name @0 :Text;
  birthdate @3 :Date;
  email @1 :Text;
  phones @2 :List(PhoneNumber);

  struct PhoneNumber {
    number @0 :Text;
    type @1 :Type;
    enum Type {
      mobile @0;
      home @1;
      work @2;
    }
  }
}

struct Date {
  year @0 :Int16;
  month @1 :UInt8;
  day @2 :UInt8;
}
```

            

注意
            `@0`、`@1`、`@2`、`@3`
            这些注解——它们是字段编号，但与字段在源码中的定义顺序无关。上面的例子中，`birthdate`
            的编号是 `@3`，定义在
            `email`（`@1`）之前。这种设计让你可以按语义逻辑组织
            Schema 文件，不受字段编号顺序的约束。
            

### 5.4 Cap’n Proto vs
            Protobuf

            
            
            
            
            
            
            
            
            维度
            Protobuf
            Cap’n Proto
            
            
            
            
            反序列化
            需要解析并构建内存对象
            零拷贝，直接在缓冲区上读取
            
            
            编码紧凑性
            Varint 编码，紧凑
            固定宽度，对齐填充，体积较大
            
            
            随机访问
            不支持
            支持（通过指针直接跳转）
            
            
            构建速度
            中等
            快（直接写入内存布局）
            
            
            生态成熟度
            非常成熟，广泛使用
            较小，社区有限
            
            
            RPC 框架
            gRPC
            Cap’n Proto RPC（内置）
            
            
            语言支持
            官方支持 10+ 语言
            C++、Rust 质量高，其他语言参差不齐
            
            
            可变消息
            需要反序列化-修改-重新序列化
            支持原地修改（Builder API）
            
            
            
            

### 5.5 零拷贝的代价

            

零拷贝反序列化不是免费午餐。Cap’n Proto（和
            FlatBuffers）为此付出的代价包括：
            
            
- 

**对齐开销**：所有标量字段按自然对齐存储。一个
            `bool` 字段仍然占 1
            字节（在对齐后可能浪费更多）。Protobuf 的 Varint
            编码下，大部分小整数只占 1~2 字节。
            
- 

**默认值不压缩**：Protobuf（proto3）中，字段值等于默认值时不编码；Cap’n
            Proto 中，所有字段都占据固定空间（值与默认值做 XOR
            存储，默认值变成全零，有利于压缩但不减少原始大小）。
            
- 

**安全验证**：零拷贝意味着直接在不可信的输入数据上操作。必须验证指针偏移的合法性、防止循环引用、检查缓冲区边界。Cap’n
            Proto 内置了遍历限制（Traversal
            Limit）来防御恶意构造的深层嵌套消息。
            
- 

**不适合持久化搜索**：零拷贝格式适合”读取后处理”的模式，但不适合在磁盘上直接搜索。如果需要按某个字段范围查询，仍然需要索引。
            
            
            

## 六、MessagePack 与 CBOR

            

### 6.1 MessagePack

            

MessagePack 是一种紧凑的二进制序列化格式（Compact Binary
            Serialization Format），设计目标是”像 JSON
            一样灵活，但更小更快”。它由 Sadayuki Furuhashi 在 2008
            年开发，目前在 Redis 的部分客户端协议、Fluentd
            日志收集器、Neovim 的远程插件协议中使用。
            

MessagePack 的类型系统与 JSON 对应：
            
            
            
            JSON 类型
            MessagePack 类型
            编码特点
            
            
            
            
            null
            nil
            1 字节 `0xc0`
            
            
            boolean
            bool
            1 字节 `0xc2`/`0xc3`
            
            
            number（整数）
            int/uint
            1~9 字节，正小整数（0~127）只需 1 字节
            
            
            number（浮点）
            float32/float64
            5 或 9 字节
            
            
            string
            str
            前缀长度 + UTF-8 数据
            
            
            array
            array
            前缀长度 + 元素序列
            
            
            object
            map
            前缀长度 + 键值对序列
            
            
            （无）
            bin
            二进制数据，JSON 没有对应类型
            
            
            （无）
            ext
            扩展类型，用户自定义
            
            
            
            

编码规则的核心设计是”小值用少字节”：
            
```
正整数 0~127:        1 字节  (0x00 ~ 0x7f，值直接编码在类型字节中)
负整数 -32~-1:       1 字节  (0xe0 ~ 0xff)
uint8:               2 字节  (0xcc + 1 字节值)
uint16:              3 字节  (0xcd + 2 字节值)
uint32:              5 字节  (0xce + 4 字节值)
uint64:              9 字节  (0xcf + 8 字节值)
fixstr (长度 0~31):  1 + len 字节  (长度编码在类型字节中)
str8:                2 + len 字节
str16:               3 + len 字节
fixmap (0~15 对):    1 + data 字节
fixarray (0~15 元素): 1 + data 字节
```

            

一个 Python 示例：
            
```
import msgpack

data = {
    "id": 42,
    "name": "Alice",
    "scores": [98, 85, 92],
    "active": True,
}

packed = msgpack.packb(data, use_bin_type=True)
print(f"JSON 大小:        {len(str(data).encode())} 字节")
print(f"MessagePack 大小: {len(packed)} 字节")
print(f"十六进制:         {packed.hex()}")

unpacked = msgpack.unpackb(packed, raw=False)
print(f"解码结果: {unpacked}")
```

            
```
输出（预期）:
JSON 大小:        63 字节
MessagePack 大小: 34 字节
十六进制:         84a26964...
解码结果: {'id': 42, 'name': 'Alice', 'scores': [98, 85, 92], 'active': True}
```

            

### 6.2 CBOR

            

CBOR（Concise Binary Object
            Representation，简洁二进制对象表示）由 IETF 在 RFC 8949
            中标准化。它的设计目标与 MessagePack 类似——JSON
            的二进制替代——但更强调标准化和可扩展性。
            

CBOR 与 MessagePack 的关键区别：
            
            
            
            
            
            
            
            
            维度
            MessagePack
            CBOR
            
            
            
            
            标准化
            社区规范
            IETF RFC 8949
            
            
            标签系统
            ext 类型（type code 0~127）
            语义标签（Semantic Tag），编号空间更大
            
            
            日期/时间
            需要 ext 扩展
            标准标签（Tag 0 = 日期字符串，Tag 1 = Unix 时间戳）
            
            
            大数支持
            需要 ext 扩展
            标准标签（Tag 2/3 = Bignum）
            
            
            确定性编码
            未标准化
            RFC 8949 Section 4.2 定义了确定性编码规则
            
            
            应用场景
            Redis、Fluentd、Neovim
            WebAuthn（FIDO2）、COSE（加密消息）、IoT（CoAP
            协议）
            
            
            
            

CBOR 在物联网（IoT）和安全协议领域的采用度更高。WebAuthn
            协议用 CBOR
            编码认证器（Authenticator）数据，CoAP（Constrained
            Application Protocol）用 CBOR
            作为默认数据格式。如果你的存储系统需要与这些协议交互，CBOR
            是更自然的选择。
            

### 6.3
            无模式格式在存储中的位置

            

MessagePack 和 CBOR
            在存储系统中通常不作为核心数据格式，而是用在以下场景：
            
            
- 

**配置和元数据存储**：Redis 用
            MessagePack
            编码集群元数据。配置的结构可能随版本变化，无模式格式的灵活性在这里是优势。
            
- 

**日志和事件流**：Fluentd 用 MessagePack
            作为内部消息格式。日志字段不固定，无模式格式避免了频繁更新
            Schema 定义。
            
- 

**嵌入式和资源受限环境**：CBOR
            的编解码器实现简单，代码体积小，适合单片机（MCU）和嵌入式设备。
            
- 

**临时缓存**：缓存数据的生命周期短，不需要长期兼容性保证，无模式格式的开箱即用特性更有吸引力。
            
            
            

## 七、Apache Avro

            

### 7.1 设计特点

            

Apache Avro 由 Hadoop 之父 Doug Cutting 在 2009
            年开发，最初是为了解决 Hadoop 生态中序列化格式的痛点。在
            Avro 之前，Hadoop 使用自己的 Writable
            接口做序列化，代码繁琐且不支持跨语言。Protobuf
            虽然跨语言，但需要代码生成步骤，在 Hadoop 的动态 MapReduce
            场景中不够灵活。
            

Avro 的核心设计特点：
            
            
- 

**Schema 随数据存储**：Avro
            数据文件（`.avro`）的文件头包含完整的 Schema
            定义（JSON 格式）。解码时不需要外部的 Schema
            文件，文件本身自描述。
            
- 

**无字段标签**：与 Protobuf
            的字段编号不同，Avro
            编码时不写入任何字段标识。编码顺序完全由 Schema
            定义中的字段顺序决定。这使得编码最紧凑，但也意味着编码和解码必须使用兼容的
            Schema。
            
- 

**Schema Evolution 靠双 Schema
            匹配**：读取数据时，同时使用写入时的 Schema（Writer’s
            Schema）和当前的 Schema（Reader’s
            Schema），通过字段名匹配来处理差异。新增的字段用默认值填充，删除的字段直接跳过。
            
- 

**一等公民的动态类型支持**：Avro
            可以在运行时根据 JSON Schema
            做编解码，不需要预先生成代码。这在 Hadoop 和 Kafka
            的动态数据管道中非常有用。
            
            

### 7.2 Schema 定义

            

Avro Schema 用 JSON 定义：
            
```
{
  "type": "record",
  "name": "User",
  "namespace": "com.example",
  "fields": [
    {"name": "id", "type": "long"},
    {"name": "name", "type": "string"},
    {"name": "email", "type": ["null", "string"], "default": null},
    {"name": "age", "type": "int", "default": 0},
    {
      "name": "address",
      "type": {
        "type": "record",
        "name": "Address",
        "fields": [
          {"name": "street", "type": "string"},
          {"name": "city", "type": "string"},
          {"name": "zip", "type": "string"}
        ]
      }
    }
  ]
}
```

            

也可以用 Avro IDL（`.avdl`）：
            
```
@namespace("com.example")
protocol UserProtocol {
  record Address {
    string street;
    string city;
    string zip;
  }

  record User {
    long id;
    string name;
    union { null, string } email = null;
    int age = 0;
    Address address;
  }
}
```

            

### 7.3 编码原理

            

Avro
            的编码极其紧凑，因为不写入任何字段标识或类型标记。编码完全按照
            Schema 中字段的定义顺序，逐字段写入值。
            
```
Avro 基本类型编码:
  null:     0 字节（什么都不写）
  boolean:  1 字节（0 或 1）
  int/long: Varint（ZigZag 编码后的变长整数）
  float:    4 字节（IEEE 754）
  double:   8 字节（IEEE 754）
  string:   Varint 长度 + UTF-8 字节
  bytes:    Varint 长度 + 原始字节
  enum:     Varint（枚举值的序号）
  union:    Varint 索引（指示 union 中哪个类型）+ 值编码
```

            

以 `User` 记录为例，一条记录的编码：
            
```
[id: Varint]
[name: Varint长度 + UTF-8]
[email: Varint索引(0=null, 1=string) + 可选的字符串值]
[age: Varint]
[address.street: Varint长度 + UTF-8]
[address.city: Varint长度 + UTF-8]
[address.zip: Varint长度 + UTF-8]
```

            

没有字段编号，没有字段名，没有类型标记——纯数据。这让 Avro
            的编码大小通常是所有格式中最小的。
            

### 7.4 Schema Evolution

            

Avro 的 Schema 演进（Schema
            Evolution）机制是它区别于其他格式的核心特性。读写双方可以使用不同版本的
            Schema，Avro 运行时负责兼容。
            

规则如下：
            
            
- 

**新增字段**：Reader’s Schema
            中有、Writer’s Schema
            中没有的字段，使用默认值填充。因此新增字段必须提供默认值。
            
- 

**删除字段**：Writer’s Schema
            中有、Reader’s Schema 中没有的字段，解码时跳过。
            
- 

**字段匹配靠名称**：不是靠编号，而是靠字段名匹配。这意味着字段名一旦确定就不能改，但字段的定义顺序可以随意调整。
            
- 

**类型提升（Type
            Promotion）**：`int` 可以提升为
            `long`、`float` 或
            `double`；`long` 可以提升为
            `float` 或
            `double`；`float` 可以提升为
            `double`。
            
            
```
Schema Evolution 兼容性矩阵:

                    Reader's Schema
                    有字段 A    无字段 A
Writer's Schema
  有字段 A          正常读取    跳过
  无字段 A          用默认值    不涉及
```

            

### 7.5 Avro 在 Kafka
            中的应用

            

Apache Kafka 是 Avro 最重要的应用场景之一。Confluent
            开发的 Schema Registry 专门为 Kafka 消息提供 Schema
            管理：
            
            
- 生产者（Producer）向 Schema Registry 注册
            Schema，获得一个 Schema ID。
            
- 生产者将 Schema ID 写入消息头部（5 字节：1 字节魔数 + 4
            字节 Schema ID），消息体用 Avro 编码。
            
- 消费者（Consumer）从消息中读取 Schema ID，向 Schema
            Registry 获取对应的 Schema，用它来解码消息体。
            
- Schema Registry 维护 Schema
            的版本历史，并在注册新版本时检查兼容性（向后兼容、向前兼容或双向兼容）。
            
            
```
生产者                    Schema Registry              消费者
  │                            │                          │
  │── 注册 Schema v2 ────────>│                          │
  ││
  │   [magic=0][id=5][avro payload]                       │
  │                            │                          │
  │                            ││
  │                            │                          │
  │                            │   用 Schema v2 解码消息    │
```

            

这种设计让消息体中不包含 Schema 信息（不像 Avro
            文件那样在头部嵌入完整 Schema），每条消息只多 5
            字节开销。Schema 的兼容性检查集中在 Registry
            侧完成，避免了消费者收到无法解码的消息。
            

### 7.6 Avro vs Protobuf

            
            
            
            维度
            Avro
            Protobuf
            
            
            
            
            字段标识
            字段名（Schema 匹配）
            字段编号
            
            
            编码紧凑性
            最紧凑（无标签开销）
            紧凑（Varint 标签）
            
            
            代码生成
            可选（支持动态解码）
            必须
            
            
            Schema 分发
            随数据或通过 Registry
            需要另行分发 `.proto` 文件
            
            
            动态语言支持
            好（运行时 Schema 解析）
            一般（需要编译步骤）
            
            
            Hadoop/Kafka 生态
            一等公民
            需要插件适配
            
            
            gRPC 集成
            需要适配
            原生支持
            
            
            类型系统
            union 需要显式建模
            oneof
            
            
            
            

选择 Avro 还是
            Protobuf，最大的决定因素往往是生态：如果你在 Kafka/Hadoop
            生态中工作，Avro + Schema Registry 是成熟方案；如果你在 gRPC
            微服务生态中工作，Protobuf 是自然选择。
            
            

## 八、序列化性能基准测试

            

### 8.1 测试维度

            

序列化格式的性能评估至少需要覆盖三个维度：
            
            
- **编码速度（Encode/Serialize）**：从内存结构体到字节序列的时间。
            
- **解码速度（Decode/Deserialize）**：从字节序列到内存结构体的时间。
            
- **序列化后大小（Encoded
            Size）**：字节序列的体积。
            
            

需要注意的是：不同的基准测试使用不同的数据集、不同的消息结构、不同的语言实现，结果可能差异很大。下面的数据综合自多个公开基准测试项目（包括
            Google 的 FlatBuffers benchmark、Cap’n Proto 作者的
            benchmark、以及社区的 serialization-benchmark
            项目），旨在呈现各格式间的相对差异和量级关系，而非精确的绝对数值。
            

### 8.2 相对性能对比

            

以下数据基于一个中等复杂度的消息结构（包含嵌套对象、重复字段、字符串和整数），使用
            C++ 实现，在 x86-64 平台上测量。数据经过归一化处理，以
            Protobuf 作为基准（1.0x）：
            
            
            
            格式
            编码速度
            解码速度
            序列化大小
            
            
            
            
            Protocol Buffers
            1.0x
            1.0x
            1.0x（基准）
            
            
            FlatBuffers
            约 1.0~1.5x
            约 10~100x
            约 1.1~1.3x
            
            
            Cap’n Proto
            约 1.5~3.0x
            约 10~100x（零拷贝）
            约 1.2~1.5x
            
            
            MessagePack
            约 0.8~1.2x
            约 0.5~1.0x
            约 0.9~1.1x
            
            
            Avro
            约 1.0~1.5x
            约 0.8~1.2x
            约 0.8~0.95x
            
            
            JSON
            约 0.2~0.5x
            约 0.1~0.3x
            约 2.0~3.0x
            
            
            
            

说明：
            
            
- FlatBuffers 和 Cap’n Proto
            的”解码速度”指的是从缓冲区读取全部字段的时间。如果只读取少数字段，零拷贝的优势更大（只访问需要的字段，不触碰其他数据）。
            
- 上表中的倍数是近似范围。具体数值因消息结构、字段数量、字符串比例、嵌套深度而异。字符串占比高时，各格式的差距会缩小（因为字符串编码在所有格式中都是长度前缀
            + 原始数据）。
            
- JSON
            的编码大小远大于二进制格式，主要原因是字段名重复出现且数值用文本表示。
            
            

### 8.3 不同访问模式下的表现

            

零拷贝格式（FlatBuffers、Cap’n
            Proto）的真正优势在于部分读取（Partial Read）场景：
            
```
场景：消息包含 50 个字段，只需要读取其中 2 个

                    读取全部字段    只读取 2 个字段
Protobuf            100%            100%（必须解析整条消息）
FlatBuffers         120%            约 5%（只做 2 次 VTable 查找）
Cap'n Proto         110%            约 3%（只做 2 次指针追踪）
```

            

这解释了为什么 FlatBuffers
            在游戏引擎中受欢迎：游戏每帧可能收到大量状态更新，但每个系统只关心自己需要的几个字段。如果用
            Protobuf，每次都要解析整条消息再丢弃不需要的字段；用
            FlatBuffers，直接跳到目标字段读取。
            

### 8.4 序列化大小的分解

            

下面以一个具体消息为例，分解各格式的空间开销来源：
            
```
消息内容:
  id:    42           (整数)
  name:  "Alice"      (5 字节字符串)
  email: "a@b.com"    (7 字节字符串)
  age:   30           (整数)
  score: 98.5         (浮点数)

各格式编码大小估算:

JSON:
  {"id":42,"name":"Alice","email":"a@b.com","age":30,"score":98.5}
  = 64 字节（字段名 + 引号 + 分隔符占大量空间）

MessagePack:
  85 a2 69 64 2a a4 6e 61 6d 65 a5 41 6c 69 63 65 ...
  约 38 字节（字段名用短字符串编码，值紧凑）

Protobuf:
  08 2a 12 05 41 6c 69 63 65 1a 07 61 40 62 ...
  约 25 字节（无字段名，Varint 标签 + 值）

Avro:
  54 0a 41 6c 69 63 65 02 0e 61 40 62 ...
  约 22 字节（无标签，纯值序列）

FlatBuffers:
  约 64~80 字节（VTable + 对齐填充 + 字符串偏移）

Cap'n Proto:
  约 56~72 字节（段头 + 指针段 + 数据段 + 字符串）
```

            

可以看到：对于小消息，零拷贝格式的空间开销反而最大。它们的优势体现在大消息和部分读取场景中，而不是体积。
            
            

## 九、存储系统中的序列化选型

            

### 9.1 实际系统的选择

            

下面梳理几个知名存储系统的序列化选型，以及它们做出这些选择的原因。
            

#### RocksDB

            

RocksDB
            没有使用通用序列化格式，而是自定义了紧凑的二进制编码。键值对在
            MemTable 和 SSTable
            中的编码方式是手工设计的，每个字节都有明确用途：
            
```
SSTable Block 中的键值编码:
┌───────────────────────────────────────────────────┐
│ shared_key_len (Varint)                           │ 与前一个 key 的公共前缀长度
│ unshared_key_len (Varint)                         │ 非公共部分的长度
│ value_len (Varint)                                │ 值的长度
│ unshared_key_data (unshared_key_len bytes)         │ 键的非公共部分
│ value_data (value_len bytes)                      │ 值
└───────────────────────────────────────────────────┘
```

            

RocksDB 选择自定义编码而不是 Protobuf 的原因：
            
            
- 键值对的结构极其简单且固定，通用序列化格式的灵活性用不上。
            
- 性能要求极端——每次读写都走这个编码路径，多一次间接调用都不行。
            
- 前缀压缩（Prefix Compression）是 RocksDB
            的核心优化，通用格式不支持。
            
            

但 RocksDB 在元数据和配置方面使用了
            Protobuf。`MANIFEST`
            文件中的版本编辑记录（VersionEdit）用 Protobuf
            编码，因为这些数据结构更复杂、更新频率低、且需要兼容性保证。
            

源码参考：RocksDB，`db/version_edit.cc`，`VersionEdit::EncodeTo()`
            使用 Protobuf 编码。
            

#### etcd

            

etcd 在存储层和 Raft 协议层全面使用 Protobuf。每条 Raft
            日志条目（Entry）、每次键值操作的请求和响应、存储在 BoltDB
            中的键值对——全部用 Protobuf 编码。
            

etcd 选择 Protobuf 的原因：
            
            
- etcd 是 Kubernetes 的核心组件，需要跨版本兼容。Protobuf
            的字段编号机制保证了旧版本的 etcd
            可以读取新版本写入的数据。
            
- Raft 日志需要在多个节点间传输和持久化，Protobuf
            的编码紧凑性直接减少网络带宽和磁盘占用。
            
- Go 语言有成熟的 Protobuf 支持。
            
            

源码参考：etcd
            v3.5，`api/etcdserverpb/rpc.proto` 定义了 etcd
            的全部 API。
            

#### Apache Kafka

            

Kafka 本身的消息协议使用自定义二进制格式（Kafka
            Protocol），但消息内容（Payload）的序列化由用户决定。在
            Confluent 生态中，Avro + Schema Registry 是推荐方案。
            

Kafka 消息内容使用 Avro 的理由：
            
            
- Kafka
            是数据管道，生产者和消费者可能由不同团队用不同语言开发。Avro
            的 Schema Registry 提供了集中式的模式管理。
            
- 数据管道中的消息格式经常演变，Avro 的 Schema Evolution
            机制让格式变更不需要同步更新所有消费者。
            
- Avro
            的编码最紧凑，对于每秒百万条消息的场景，体积差异直接影响网络和存储成本。
            
            

Confluent 从 2023 年开始也正式支持 Protobuf 和 JSON
            Schema 作为 Schema Registry 的格式选项，不再局限于
            Avro。
            

#### CockroachDB

            

CockroachDB 内部使用 Protobuf
            编码几乎所有的内部数据结构：事务记录（Transaction
            Record）、范围描述符（Range Descriptor）、表描述符（Table
            Descriptor）等。键值对的值在存储层用 Protobuf 编码。
            

但 CockroachDB
            的行数据（用户表的行）使用自定义的列编码格式，直接映射到
            RocksDB 的键值对。原因和 RocksDB
            类似：行数据的编解码在热路径上，通用格式的开销不可接受。
            

源码参考：CockroachDB，`pkg/roachpb/data.proto`
            定义了核心数据结构。
            

### 9.2 选型决策框架

            

根据上述分析，可以总结一个选型决策流程：
            
```
                        ┌──────────────────┐
                        │  是否在热路径上？  │
                        └────────┬─────────┘
                           │           │
                          是           否
                           │           │
                   ┌───────┴───┐   ┌───┴──────────────┐
                   │ 消息结构   │   │  Protobuf / Avro  │
                   │ 是否固定？ │   │  按生态选择        │
                   └─────┬─────┘   └──────────────────┘
                     │        │
                   固定      可变
                     │        │
            ┌────────┴──┐  ┌──┴──────────────┐
            │ 自定义编码  │  │ 读多还是写多？   │
            │ 或 struct  │  └──┬──────────┬──┘
            └───────────┘     │          │
                           读多        写多
                              │          │
                     ┌────────┴──┐  ┌────┴──────────┐
                     │ FlatBuffers│  │ Protobuf      │
                     │ Cap'n Proto│  │（编码更紧凑）  │
                     └───────────┘  └───────────────┘
```

            

### 9.3 混合使用

            

实际系统中，不同的数据路径可能使用不同的序列化格式。这是正常的工程选择，不需要追求全局统一：
            
            
- **热路径数据**（每次读写都经过的路径）：自定义编码或零拷贝格式，追求极致性能。
            
- **元数据和控制面**（配置、版本信息、节点描述符）：Protobuf，追求兼容性和可维护性。
            
- **外部接口**（API、数据导入导出）：按生态选择，gRPC
            生态用 Protobuf，数据管道用 Avro，Web 接口用 JSON。
            
- **调试和日志**：JSON 或
            MessagePack，追求可读性和灵活性。
            
            

### 9.4 一个实际的选型示例

            

假设你在设计一个分布式时序数据库（Time-Series
            Database），需要处理以下数据：
            
```
数据点结构:
  metric_name: string       （指标名称）
  timestamp:   int64        （Unix 纳秒时间戳）
  value:       double       （指标值）
  tags:        map  （标签键值对）
```

            

分析各格式的适用性：
            
```
// 方案一：Protobuf（适合 RPC 和持久化元数据）
// 定义在 .proto 文件中
//
// message DataPoint {
//   string metric_name = 1;
//   int64 timestamp = 2;
//   double value = 3;
//   map tags = 4;
// }

// 方案二：自定义编码（适合热路径写入）
// 针对时序数据的特点优化：
//   - metric_name 做字典编码，用 uint32 ID 替代字符串
//   - timestamp 做 Delta 编码，存储与前一个时间戳的差值
//   - value 做 XOR 编码（Gorilla 压缩）
//   - tags 做字典编码

func encodeDataPoint(buf []byte, dp DataPoint, prev DataPoint) []byte {
    // metric ID（字典编码后的 4 字节）
    buf = binary.AppendUvarint(buf, uint64(dp.MetricID))
    // timestamp delta（通常很小，Varint 编码只需 1~2 字节）
    delta := dp.Timestamp - prev.Timestamp
    buf = binary.AppendVarint(buf, delta)
    // value XOR（与前一个值做 XOR，前导零和尾随零用位压缩）
    buf = appendXORFloat(buf, dp.Value, prev.Value)
    // tags（字典编码后的 tag ID 列表）
    buf = binary.AppendUvarint(buf, uint64(len(dp.TagIDs)))
    for _, tagID := range dp.TagIDs {
        buf = binary.AppendUvarint(buf, uint64(tagID))
    }
    return buf
}
```

            

在这个例子中，热路径的写入使用自定义编码（每个数据点只需要几个字节），元数据（指标注册、标签字典、分片信息）使用
            Protobuf，对外 API 使用 gRPC +
            Protobuf。三种格式在各自的位置上都是合理选择。
            
            

## 十、参考文献

            

### 规范与官方文档

            
            
- 

Google Protocol Buffers Language Guide (proto3). https://protobuf.dev/programming-guides/proto3/.
            Protobuf proto3 语法和编码规范。
            
- 

Google Protocol Buffers Encoding. https://protobuf.dev/programming-guides/encoding/.
            Wire Format 编码细节。
            
- 

Google FlatBuffers Documentation. https://google.github.io/flatbuffers/.
            FlatBuffers 格式规范和使用指南。
            
- 

Cap’n Proto Documentation. https://capnproto.org/. Cap’n Proto
            格式规范、编码方式和 RPC 框架。
            
- 

MessagePack Specification. https://github.com/msgpack/msgpack/blob/master/spec.md.
            MessagePack 编码格式规范。
            
- 

RFC 8949: Concise Binary Object Representation
            (CBOR). [https://www.rfc-editor.org/rfc/rfc8949](https://www.rfc-editor.org/rfc/rfc8949). CBOR
            格式的 IETF 标准。
            
- 

Apache Avro Specification 1.11.x. https://avro.apache.org/docs/current/specification/.
            Avro 编码格式和 Schema 演进规则。
            
            

### 源码参考

            
            
- 

RocksDB. https://github.com/facebook/rocksdb.
            版本参考：8.x。`db/version_edit.cc` 中的 Protobuf
            编码，`table/block_based/`
            中的自定义键值编码。
            
- 

etcd. [https://github.com/etcd-io/etcd](https://github.com/etcd-io/etcd).
            版本参考：3.5.x。`api/etcdserverpb/rpc.proto`
            定义了全部 API。
            
- 

CockroachDB. https://github.com/cockroachdb/cockroach.
            `pkg/roachpb/data.proto`
            定义了核心数据结构。
            
            

### 论文与设计文档

            
            
- 

Kenton Varda. “Cap’n Proto: Introduction.” https://capnproto.org/news/2013-06-13-capnproto-0.1.html.
            Cap’n Proto 设计动机。
            
- 

Wouter van Oortmerssen. “FlatBuffers: Memory
            Efficient Serialization Library.” https://google.github.io/flatbuffers/flatbuffers_white_paper.html.
            FlatBuffers 设计白皮书。
            
- 

Confluent Schema Registry Documentation. https://docs.confluent.io/platform/current/schema-registry/.
            Avro Schema 在 Kafka 生态中的使用。
            
            

### 基准测试

            
            
- 

Google FlatBuffers Benchmarks. https://google.github.io/flatbuffers/flatbuffers_benchmarks.html.
            FlatBuffers 官方性能对比。
            
- 

Cap’n Proto Benchmarks. https://capnproto.org/news/2014-06-17-capnproto-flatbuffers-sbe.html.
            Cap’n Proto 与 FlatBuffers、SBE 的性能对比。
            
            
            

**上一篇**: 校验和与数据完整性
            **下一篇**: 存储加密工程
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-02-03 · system-design
                    

### 序列化格式的真正代价：protobuf vs flatbuffers vs capnproto

                    

不只测速度。schema evolution 的兼容性、zero-copy 的真实收益、生成代码的可维护性——这些才是选型时真正要看的东西。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Apache Arrow 内存格式与零拷贝

                    

拆解 Arrow 列式内存布局（validity bitmap + value buffer + offset buffer）、零拷贝从何而来，以及 C Data Interface、IPC、Flight 三层跨边界传递。讲清 Arrow（内存计算格式）与 Parquet（磁盘存储格式）如何分工衔接。含 pyarrow 实测 C Data Interface 同地址零拷贝。
                

                
                    

2025-09-15 · storage
                    

### 【存储工程】Apache Arrow：零拷贝内存列式格式

                    

在大数据和分析系统的演进过程中，一个反复出现的性能瓶颈不是计算本身，而是数据在不同系统之间搬运时的序列化（Serialization）与反序列化（Deserialization）开销。Pandas 把数据交给 Spark，Spark 把结果传给 R，R 再把子集喂给 TensorFlow——每一次跨系统传递，数据都要从…
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。