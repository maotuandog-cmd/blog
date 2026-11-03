# 【存储工程】ext4 架构与调优

来源: https://quant67.com/post/storage/14-ext4-architecture/ext4-architecture.html
日期: 2025-08-23 |

---

# ext4 架构与调优

            

ext4 是 Linux 世界中使用最广泛的本地文件系统（Local
            Filesystem）。从 2008 年合入内核主线至今，
            它已经在无数生产服务器、嵌入式设备以及桌面系统上稳定运行了十余年。本文将从磁盘布局、
            核心数据结构、日志机制、分配策略等维度，对 ext4
            进行全面剖析，并结合实际调优场景给出 可落地的最佳实践。
            
            

## 一、ext 系列演进史

            

### 1.1 ext2：奠基之作

            

ext2（Second Extended Filesystem）于 1993 年由 Rémy Card
            开发，是 Linux 上第一个
            被广泛使用的文件系统。它引入了块组（Block
            Group）的概念，将磁盘划分为若干个固定大小的
            块组，每个块组内包含独立的位图（Bitmap）、索引节点表（Inode
            Table）以及数据块（Data Block）。
            这种设计的核心目的是将相关数据放置在物理上相邻的区域，从而减少磁头寻道（Seek）时间。
            

ext2 的主要特征如下：
            
            
- 最大文件系统大小为 4 TiB（使用 4 KiB 块大小时）；
            
- 最大单文件大小为 2 TiB；
            
- 文件名最长 255 字节；
            
- 使用间接块（Indirect
            Block）管理大文件的数据块映射；
            
- 不具备日志（Journal）能力。
            
            

由于缺少日志功能，在系统异常断电后需要对整个文件系统执行
            fsck 检查，大容量分区的
            恢复时间可能长达数十分钟甚至数小时。这一致命缺陷催生了 ext3
            的诞生。
            

### 1.2 ext3：引入日志

            

ext3 于 2001 年由 Stephen Tweedie 开发并合入 Linux 2.4.15
            内核。它在 ext2 的基础上 增加了日志层（Journaling
            Layer），采用 JBD（Journaling Block Device）作为日志后端。
            ext3 保持了与 ext2 完全相同的磁盘布局，因此支持从 ext2
            无损升级到 ext3——只需使用 `tune2fs`
            工具添加日志即可。
            
```
# 从 ext2 升级到 ext3
tune2fs -j /dev/sda1
```

            

ext3 提供了三种日志模式：
            
            
            
            模式
            元数据日志
            数据日志
            性能
            安全性
            
            
            
            
            journal
            是
            是
            低
            高
            
            
            ordered
            是
            否（但保证写入顺序）
            中
            中
            
            
            writeback
            是
            否
            高
            低
            
            
            
            

虽然 ext3 解决了崩溃恢复（Crash
            Recovery）的问题，但它仍然继承了 ext2 的诸多局限：
            
            
- 依旧使用间接块映射，大文件的元数据开销巨大；
            
- 不支持区段（Extent）映射；
            
- 时间戳精度仅为秒级；
            
- 文件系统容量上限仍受 32 位块号限制。
            
            

### 1.3 ext4：全面进化

            

ext4 的开发始于 2006 年，最初以 ext3dev 的名义出现，于
            2008 年在 Linux 2.6.28 中 被正式标记为稳定版本。ext4
            的设计目标是在保持向后兼容的前提下突破 ext3 的性能和容量
            限制。主要改进包括：
            
            
- **区段树（Extent
            Tree）**：使用连续区段替代间接块，大幅减少元数据开销；
            
- **延迟分配（Delayed
            Allocation）**：推迟到数据写回（Writeback）时再分配物理块；
            
- **多块分配器（Multiblock
            Allocator，mballoc）**：一次分配多个连续块；
            
- **持久预分配（Persistent
            Preallocation）**：通过 `fallocate()`
            系统调用预留空间；
            
- **64 位块号**：支持最大 1 EiB
            的文件系统容量；
            
- **纳秒级时间戳（Nanosecond
            Timestamps）**：提高时间精度至纳秒级别；
            
- **在线碎片整理（Online
            Defragmentation）**：无需卸载即可进行碎片整理；
            
- **日志校验和（Journal
            Checksumming）**：提高日志的可靠性。
            
            

下表总结了三代文件系统的关键参数对比：
            
            
            
            特性
            ext2
            ext3
            ext4
            
            
            
            
            最大文件系统容量
            4 TiB
            16 TiB
            1 EiB
            
            
            最大单文件大小
            2 TiB
            2 TiB
            16 TiB
            
            
            子目录数上限
            31998
            31998
            无限制
            
            
            块映射方式
            间接块
            间接块
            区段树
            
            
            日志支持
            无
            有
            有（含校验和）
            
            
            时间戳精度
            秒
            秒
            纳秒
            
            
            在线扩容
            否
            是
            是
            
            
            延迟分配
            否
            否
            是
            
            
            
            
            

## 二、ext4 磁盘布局

            

### 2.1 超级块与块组

            

ext4 的磁盘布局延续了 ext2/ext3 的块组（Block
            Group）架构。整个文件系统被划分为
            若干个大小相等的块组，每个块组包含以下结构：
            
```
+------------------------------------------------------------+
| Block Group 0 | Block Group 1 | ... | Block Group N        |
+------------------------------------------------------------+

单个 Block Group 内部结构：
+--------+--------+--------+--------+--------+---------------+
| Super  | Group  | Data   | Inode  | Inode  | Data          |
| Block  | Desc.  | Bitmap | Bitmap | Table  | Blocks        |
+--------+--------+--------+--------+--------+---------------+
```

            

**超级块（Superblock）**存储文件系统的全局元数据，包括：
            
            
- 总块数、总索引节点数；
            
- 每个块组的块数与索引节点数；
            
- 块大小（通常为 4 KiB）；
            
- 文件系统状态（干净/错误）；
            
- 特性标志（Feature Flags）；
            
- UUID 与卷标。
            
            

超级块的冗余副本分布在多个块组中。默认情况下，ext4
            使用稀疏超级块（Sparse Superblock） 策略——仅在编号为 0、1
            以及 3、5、7 的幂次方的块组中保存超级块副本。这一策略通过
            `sparse_super` 特性标志启用。
            
```
# 查看超级块信息
dumpe2fs -h /dev/sda1 | head -60
```

            

**组描述符（Group
            Descriptor）**紧随超级块之后，为每个块组记录：
            
            
- 块位图的位置；
            
- 索引节点位图的位置；
            
- 索引节点表的起始位置；
            
- 空闲块数、空闲索引节点数、目录数。
            
            

在启用 64 位特性后，组描述符从 32 字节扩展到 64
            字节，以容纳 64 位的块地址。
            

### 2.2 弹性块组（Flex Block
            Group）

            

传统的块组设计将元数据分散在各个块组中，导致读取元数据时磁头需要频繁跳转。ext4
            引入了 弹性块组（Flexible Block
            Group，flex_bg）特性来解决这一问题。
            

flex_bg
            将若干个连续的块组组合成一个弹性块组，并将这些块组的位图和索引节点表集中存储
            在第一个块组中。这样做的好处是：
            
            
- 元数据更集中，减少了寻道操作；
            
- 数据区域更加连续，有利于大文件的顺序分配；
            
- 与 mballoc 配合时，能分配更大的连续区域。
            
            
```
# 查看 flex_bg 大小
dumpe2fs -h /dev/sda1 | grep "Flex block group size"
```

            

默认的 flex_bg 大小为 16，即每 16
            个块组组成一个弹性块组。使用 4 KiB 块大小时，
            一个标准块组包含 32768 个块（128
            MiB），因此一个弹性块组的大小为 2 GiB。
            

### 2.3 64 位支持

            

传统 ext3 使用 32 位块号，在 4 KiB
            块大小下，文件系统容量上限为：
            
```
2^32 × 4 KiB = 16 TiB
```

            

ext4 引入了 `64bit` 特性标志，将块号扩展到 48
            位（当前实现），理论上限为：
            
```
2^48 × 4 KiB = 1 EiB
```

            

启用 64
            位支持后，组描述符、区段索引等数据结构中的块号字段从 32
            位扩展为 48 位。 需要注意的是，64 位支持必须在
            `mkfs.ext4` 时指定，无法事后添加：
            
```
# 创建支持 64 位块号的文件系统
mkfs.ext4 -O 64bit /dev/sda1
```

            

### 2.4 索引节点（Inode）结构

            

ext4 的索引节点（Inode）默认大小为 256 字节（ext3 为 128
            字节），扩展的空间用于 存储：
            
            
- 纳秒级时间戳（创建时间 crtime、修改时间 mtime、访问时间
            atime、变更时间 ctime）；
            
- 区段树的根节点；
            
- 扩展属性（Extended
            Attributes，xattr）的内联存储空间。
            
            

索引节点中与区段相关的 60
            字节空间（`i_block[15]`）被重新定义为区段树的根：
            
```
struct ext4_inode {
    __le16  i_mode;         /* 文件模式 */
    __le16  i_uid;          /* 所有者 UID 低 16 位 */
    __le32  i_size_lo;      /* 文件大小低 32 位 */
    __le32  i_atime;        /* 访问时间 */
    __le32  i_ctime;        /* 变更时间 */
    __le32  i_mtime;        /* 修改时间 */
    __le32  i_dtime;        /* 删除时间 */
    __le16  i_gid;          /* 组 GID 低 16 位 */
    __le16  i_links_count;  /* 硬链接计数 */
    __le32  i_blocks_lo;    /* 块计数低 32 位 */
    __le32  i_flags;        /* 文件标志 */
    /* ... */
    __le32  i_block[15];    /* 区段树根节点 / 间接块指针 */
    /* ... */
};
```

            

### 2.5 目录结构

            

ext4 支持两种目录实现：
            
            
- 

**线性目录（Linear
            Directory）**：目录项按顺序排列，查找时需要遍历整个目录。
            适用于目录项较少的场景。
            
- 

**哈希树目录（HTree
            Directory）**：使用半满 B 树（Half-full
            B-tree）加速查找，
            将目录项按文件名的哈希值组织。当目录项数量超过一个块的容量时自动启用。
            
            
```
# 查看目录是否使用 htree
debugfs -R "htree_dump /path/to/dir" /dev/sda1
```

            

哈希树目录（HTree Directory）使用的哈希算法默认为
            `half_md4`，也支持 `tea` 和
            `legacy` 等算法。哈希算法可以在创建文件系统时通过
            `-E hash_alg` 选项指定。
            
            

## 三、Extent Tree

            

### 3.1 间接块的局限性

            

在 ext2/ext3 中，文件的数据块映射采用间接块（Indirect
            Block）机制。每个索引节点 包含 15 个块指针：
            
            
- 指针 0-11：直接指向数据块（直接块）；
            
- 指针 12：指向一级间接块（Single Indirect Block）；
            
- 指针 13：指向二级间接块（Double Indirect Block）；
            
- 指针 14：指向三级间接块（Triple Indirect Block）。
            
            
```
Inode
+------+
| 0-11 | -----> 数据块 （12 个直接块）
+------+
|  12  | -----> [间接块] -----> 数据块
+------+
|  13  | -----> [二级间接块] -----> [间接块] -----> 数据块
+------+
|  14  | -----> [三级间接块] -----> [二级间接块] -----> [间接块] -----> 数据块
+------+
```

            

使用 4 KiB 块大小时，一个间接块可以容纳 1024 个 32
            位块号。对于一个连续写入的 1 GiB 文件，间接块机制需要分配约
            256 个额外的元数据块来存储映射关系。这带来了
            严重的性能问题：
            
            
- 元数据块分散在磁盘各处，读取大文件时需要多次寻道；
            
- 删除大文件时需要逐级回收间接块，耗时较长；
            
- 元数据占用了大量的磁盘空间和内存缓存。
            
            

### 3.2 区段的设计

            

ext4
            使用区段（Extent）替代间接块。一个区段表示一段连续的物理块到逻辑块的映射：
            
```
struct ext4_extent {
    __le32  ee_block;       /* 逻辑块号起始位置 */
    __le16  ee_len;         /* 区段覆盖的块数（最大 32768） */
    __le16  ee_start_hi;    /* 物理块号高 16 位 */
    __le32  ee_start_lo;    /* 物理块号低 32 位 */
};
```

            

每个区段占 12 字节，描述了最多 32768 个连续块（128
            MiB）的映射。对于一个完全 连续的 1 GiB 文件，仅需要 8
            个区段即可完成映射，相比间接块的 256 个元数据块，
            元数据开销大幅降低。
            

### 3.3 区段树结构

            

当文件的区段数量超过索引节点中 `i_block`
            字段能容纳的上限（4 个区段）时，ext4 使用 区段树（Extent
            Tree）来组织区段。区段树是一棵 B+ 树（B+
            Tree），由三种节点组成：
            

**区段头（Extent Header）**：
            
```
struct ext4_extent_header {
    __le16  eh_magic;       /* 魔数，0xF30A */
    __le16  eh_entries;     /* 有效条目数 */
    __le16  eh_max;         /* 最大条目容量 */
    __le16  eh_depth;       /* 树的深度（叶子节点为 0） */
    __le32  eh_generation;  /* 树的版本号 */
};
```

            

**区段索引（Extent Index）**——内部节点：
            
```
struct ext4_extent_idx {
    __le32  ei_block;       /* 该子树覆盖的起始逻辑块号 */
    __le32  ei_leaf_lo;     /* 子节点块号低 32 位 */
    __le16  ei_leaf_hi;     /* 子节点块号高 16 位 */
    __le16  ei_unused;      /* 保留字段 */
};
```

            

**区段（Extent）**——叶子节点：
            
```
区段树（Extent Tree）示例：

                    [Header|Index0|Index1]         
            
- 首先尝试与相邻的已有区段合并（如果物理块连续且总长度不超过
            32768）；
            
- 如果无法合并，在叶子节点中插入新的区段条目；
            
- 如果叶子节点已满，则进行节点分裂（Split），并在父节点中添加新的索引项；
            
- 分裂可能级联到根节点，导致树的深度增加。
            
            

**删除（Truncate/Punch Hole）**：
            

ext4 支持两种删除方式：
            
            
- **截断（Truncate）**：缩小文件大小，移除尾部的区段；
            
- **打洞（Hole
            Punching）**：释放文件中间的数据块，创建稀疏区域。
            
            
```
# 在文件中打洞（释放 offset 1M 开始的 4M 数据）
fallocate -p -o 1048576 -l 4194304 /path/to/file
```

            

### 3.5 区段状态标志

            

区段的 `ee_len`
            字段的最高位用作”未初始化”标志。当该位为 1
            时，表示这个区段已经 分配了物理块，但尚未写入有效数据（通过
            `fallocate` 预分配的空间）。读取未初始化的
            区段时，文件系统返回零填充数据，而不是实际读取磁盘。
            
```
# 使用 filefrag 查看文件的区段映射
filefrag -v /path/to/file
```

            

输出示例：
            
```
Filesystem type is: ef53
File size of testfile is 1073741824 (262144 blocks of 4096 bytes)
 ext:     logical_offset:        physical_offset: length:   expected: flags:
   0:        0..   32767:      34816..     67583:  32768:
   1:    32768..   65535:      67584..    100351:  32768:
   2:    65536..   98303:     100352..    133119:  32768:
   ...
```

            
            

## 四、日志（Journaling）

            

### 4.1 日志的基本原理

            

日志（Journaling）机制通过预写日志（Write-Ahead
            Logging，WAL）保证文件系统的
            一致性。基本思路是：在修改文件系统的实际数据结构之前，先将修改操作记录到一个独立的
            日志区域中。如果在修改过程中发生崩溃，恢复时可以通过重放（Replay）日志来恢复到一致
            状态。
            

日志的工作流程如下：
            
```
1. 开始事务（Transaction Begin）
2. 将元数据修改写入日志区域
3. 提交事务（Transaction Commit）
4. 将修改写回到文件系统实际位置（Checkpoint）
5. 释放日志空间
```

            

### 4.2 JBD2 日志层

            

ext4 使用 JBD2（Journaling Block Device
            2）作为日志后端，相比 ext3 使用的 JBD， 主要改进包括：
            
            
- 支持 64 位块号；
            
- 支持日志校验和（Journal Checksum）；
            
- 提高了并发性能。
            
            

JBD2 的核心概念：
            
            
- **事务（Transaction）**：一组原子性的文件系统修改操作；
            
- **句柄（Handle）**：用户态操作对应的日志操作句柄，一个事务可以包含多个句柄；
            
- **日志超级块（Journal
            Superblock）**：存储日志的全局信息；
            
- **描述符块（Descriptor
            Block）**：记录事务中包含的数据块列表；
            
- **提交块（Commit
            Block）**：标记事务提交完成；
            
- **撤销块（Revoke
            Block）**：标记不需要重放的块。
            
            
```
日志区域布局：
+----------+------+------+------+--------+------+------+--------+---+
| Journal  | Desc | Data | Data | Commit | Desc | Data | Commit |...|
| Super    | Block| Block| Block| Block  | Block| Block| Block  |   |
+----------+------+------+------+--------+------+------+--------+---+
           |||
```

            

### 4.3 三种日志模式

            

ext4 沿用了 ext3
            的三种日志模式，各有不同的性能与安全性权衡：
            

**journal 模式（数据日志模式）**：
            

所有数据和元数据都先写入日志，然后再写回到实际位置。这是最安全的模式，但也是性能
            最低的模式，因为所有数据实际上被写了两次。
            
```
# 以 journal 模式挂载
mount -o data=journal /dev/sda1 /mnt
```

            

适用场景：对数据完整性要求极高的场景，例如金融交易数据库。
            

**ordered 模式（有序模式，默认）**：
            

只有元数据写入日志。数据块在元数据提交到日志之前被写入到最终位置。这保证了如果
            元数据更新可见，对应的数据一定已经写入磁盘。
            
```
# ordered 为默认模式，等价于不指定
mount -o data=ordered /dev/sda1 /mnt
```

            

适用场景：大多数通用工作负载。
            

**writeback 模式（回写模式）**：
            

只有元数据写入日志，数据块可以在元数据提交之前或之后写入。这是性能最高的模式，但在
            崩溃后可能出现文件内容与元数据不一致的情况——例如文件大小已增长但内容是旧数据或
            垃圾数据。
            
```
# 以 writeback 模式挂载
mount -o data=writeback /dev/sda1 /mnt
```

            

适用场景：对写入性能要求高且应用自身保证数据一致性的场景，例如使用
            O_DIRECT 和 自有 WAL 的数据库。
            

### 4.4 日志校验和

            

ext4 引入了日志校验和（Journal
            Checksum）功能，为每个日志事务计算 CRC32 或 CRC32C
            校验和。恢复时，如果校验和不匹配，则跳过该事务，避免重放损坏的日志数据
            导致二次损坏。
            
```
# 启用日志校验和
tune2fs -O journal_checksum /dev/sda1
```

            

在 Linux 3.6 及更高版本中，推荐使用
            `journal_checksum` 替代早期的
            `journal_async_commit` 选项。CRC32C
            校验和的计算可以利用现代 CPU 的硬件加速指令 （如 Intel 的
            SSE 4.2），几乎不会增加额外的性能开销。
            

### 4.5 日志大小调优

            

日志的大小直接影响事务的吞吐量。默认情况下，`mkfs.ext4`
            会根据文件系统的总大小 自动设置日志大小，范围通常在 64 MiB
            到 256 MiB 之间。
            
```
# 指定日志大小为 256 MiB
mkfs.ext4 -J size=256 /dev/sda1

# 查看当前日志大小
dumpe2fs -h /dev/sda1 | grep "Journal size"
```

            

对于写入密集型工作负载，增大日志可以容纳更多的并发事务，减少日志空间不足导致的
            阻塞。但日志过大也会增加恢复时间。经验法则是将日志大小设为文件系统总大小的
            1% 左右， 但不超过 1 GiB。
            

### 4.6 提交间隔

            

日志事务的提交间隔（Commit
            Interval）决定了日志缓冲区中的数据多久被强制刷写到
            磁盘。默认值为 5 秒。
            
```
# 设置提交间隔为 30 秒
mount -o commit=30 /dev/sda1 /mnt
```

            

增大提交间隔可以聚合更多的小写入操作，提高吞吐量，但也增加了崩溃时丢失数据的
            时间窗口。对于可以容忍少量数据丢失的应用（如日志收集系统），可以将提交间隔设为
            30-60 秒。
            
            

## 五、延迟分配（Delayed
            Allocation）

            

### 5.1 传统分配方式的问题

            

在 ext3 中，当应用程序调用 `write()`
            将数据写入页缓存（Page Cache）时，文件系统
            会立即为这些脏页（Dirty
            Page）分配物理块号。这种”即时分配”的方式存在以下问题：
            
            
- 在数据实际写回磁盘之前，文件系统无法预知文件的最终大小和写入模式，导致分配决策
            不够优化；
            
- 对于短生命周期的临时文件，分配了物理块后又很快删除，造成不必要的开销；
            
- 元数据更新频繁，增加了日志压力。
            
            

### 5.2 延迟分配的工作机制

            

延迟分配（Delayed Allocation，delalloc）是 ext4
            的默认行为。其核心思想是：当数据
            写入页缓存时，不立即分配物理块，而是仅在内存中做标记（保留空间计数）；直到脏页
            需要被写回磁盘时（由内核的回写（Writeback）机制触发），才真正调用块分配器分配物理块。
            
```
传统分配流程：
write() -> 分配物理块 -> 数据写入页缓存 -> 回写到磁盘

延迟分配流程：
write() -> 数据写入页缓存（不分配块） -> 回写触发 -> 分配物理块 -> 写入磁盘
```

            

### 5.3 延迟分配的优势

            
            
- 

**更好的连续性**：回写时可以看到文件的完整写入范围，从而分配更大的连续区段，
            减少碎片化（Fragmentation）；
            
- 

**减少元数据开销**：多个小写入可以合并为一个大区段，减少区段树的深度和复杂度；
            
- 

**消除短生命周期文件的开销**：如果一个临时文件在回写之前就被删除，则完全不需要
            进行物理块分配和元数据更新；
            
- 

**与 mballoc
            协同**：延迟分配为多块分配器提供了更大的分配请求，使其能做出更优
            的分配决策。
            
            

### 5.4 延迟分配的风险

            

延迟分配引入了一个潜在的数据丢失风险：如果应用程序调用
            `write()` 后没有调用 `fsync()`
            就发生崩溃，由于物理块尚未分配，已写入页缓存的数据将完全丢失。在
            ext3 的 ordered 模式下，虽然也不保证 `write()`
            后的数据持久化，但至少文件不会出现”零长度” 的情况。
            

这一行为在 2009
            年引发了广泛讨论。内核开发者随后引入了以下缓解措施：
            
            
- 对于 `rename()` 和 `truncate()`
            等关键操作，在操作前强制刷写相关文件的脏页；
            
- 应用程序应在关键数据写入后显式调用 `fsync()`
            或使用 `O_SYNC` 标志。
            
            
```
# 禁用延迟分配（不推荐，仅用于调试）
mount -o nodelalloc /dev/sda1 /mnt
```

            

### 5.5 空间预留机制

            

延迟分配需要一个精确的空间预留（Space
            Reservation）机制，以避免在回写时发现物理
            空间不足的问题。ext4 在内存中维护了以下计数器：
            
            
- `s_dirtyclusters_counter`：待分配的脏簇数量；
            
- `i_reserved_data_blocks`：每个索引节点预留的数据块数量。
            
            

当预留空间不足时，`write()` 调用会返回
            `ENOSPC`（磁盘空间不足）错误，而不是等到
            回写时才报错。这种提前检测机制保证了延迟分配的可靠性。
            
            

## 六、多块分配与预分配

            

### 6.1 mballoc 分配器

            

ext4 的多块分配器（Multiblock
            Allocator，mballoc）是一个复杂的块分配引擎，它能
            在一次分配请求中分配多个连续的物理块。相比 ext3
            的逐块分配方式，mballoc 大幅减少
            了分配器的调用次数和锁竞争。
            

mballoc 的核心策略包括：
            

**伙伴系统（Buddy System）**：
            

mballoc
            为每个块组维护一个伙伴系统，用于快速查找指定大小的连续空闲块。伙伴系统
            以 2 的幂次方为单位管理空闲空间：
            
```
伙伴系统层级（4 KiB 块大小）：
Order 0:  4 KiB 块
Order 1:  8 KiB（2 个连续块）
Order 2:  16 KiB（4 个连续块）
...
Order 13: 32 MiB（8192 个连续块）
```

            

**预分配池（Preallocation Pool）**：
            

mballoc 维护两种预分配池：
            
            
- **索引节点预分配（Inode
            Preallocation，PA_INODE）**：为单个文件预留连续空间，
            后续写入可以直接使用预留的块，无需重新搜索；
            
- **局部组预分配（Locality Group
            Preallocation，PA_LGROUP）**：为同一 CPU 上的
            小文件分配提供局部性优化。
            
            
```
分配策略决策流程：

分配请求
    |
    v
是否为大请求（>= 阈值）？
    |           |
    是          否
    |           |
    v           v
  使用伙伴    使用局部组
  系统分配    预分配池
    |           |
    v           v
  搜索最佳    从预分配池
  匹配块组    取出块
```

            

### 6.2 分配策略参数

            

mballoc 的行为可以通过 sysfs 参数调节：
            
```
# 查看 mballoc 参数
ls /sys/fs/ext4/sda1/

# 流式分配的阈值（单位：块）
cat /sys/fs/ext4/sda1/mb_stream_req

# 设置流式分配阈值为 64 块
echo 64 > /sys/fs/ext4/sda1/mb_stream_req

# 分配器统计信息
cat /proc/fs/ext4/sda1/mb_groups
```

            

重要的 mballoc 参数：
            
            
            
            参数
            默认值
            说明
            
            
            
            
            `mb_stream_req`
            16
            小于此值的分配请求使用局部组预分配
            
            
            `mb_group_prealloc`
            512
            局部组预分配的块数
            
            
            `mb_min_to_scan`
            10
            搜索最佳匹配时最少扫描的块组数
            
            
            `mb_max_to_scan`
            200
            搜索最佳匹配时最多扫描的块组数
            
            
            `mb_order2_req`
            2
            2 的幂次方大小请求的最小阶数
            
            
            
            

### 6.3 fallocate 预分配

            

`fallocate()` 系统调用（System
            Call）允许应用程序预先分配文件空间，而无需实际写入
            数据。这对于以下场景非常有用：
            
            
- 数据库预分配数据文件和日志文件；
            
- 虚拟机磁盘镜像的创建；
            
- 避免写入过程中因空间不足而失败。
            
            
```
# 预分配 1 GiB 的文件
fallocate -l 1G /path/to/file

# 打洞（释放文件中间的空间）
fallocate -p -o 0 -l 512M /path/to/file

# 折叠（移除文件中间的数据）
fallocate -c -o 0 -l 512M /path/to/file

# 插入空洞
fallocate -i -o 0 -l 512M /path/to/file

# 零填充
fallocate -z -o 0 -l 512M /path/to/file
```

            

在 ext4 内部，`fallocate`
            会创建标记为”未初始化（Uninitialized）“的区段。这些区段
            在读取时返回零值，只有在首次写入后才标记为已初始化。
            
```
/* 内核中的 fallocate 实现路径 */
/* fs/ext4/extents.c: ext4_fallocate() */
int ext4_fallocate(struct file *file, int mode,
                   loff_t offset, loff_t len)
{
    /* 分配未初始化区段 */
    /* 更新索引节点的 i_disksize（不改变 i_size） */
    /* ... */
}
```

            

### 6.4 分配对齐

            

对于 SSD（Solid State Drive）和高级格式硬盘（Advanced
            Format HDD），块分配的 对齐非常重要。`mkfs.ext4`
            能自动检测设备的物理扇区大小和最优 I/O 大小，并据此
            设置对齐参数：
            
```
# 手动指定条带宽度和步长
mkfs.ext4 -E stride=16,stripe-width=64 /dev/md0

# 查看对齐参数
dumpe2fs -h /dev/md0 | grep -E "stride|stripe"
```

            

对于 RAID（Redundant Array of Independent
            Disks）阵列：
            
            
- `stride`：单个磁盘的条带深度（以块为单位）；
            
- `stripe-width`：整个阵列的条带宽度（stride ×
            数据盘数量）。
            
            
            

## 七、在线碎片整理

            

### 7.1 碎片化的成因

            

即使 ext4
            具备延迟分配和多块分配等先进的分配策略，文件系统在长期使用后仍然会
            不可避免地产生碎片化：
            
            
- **文件修改与追加写入**：在原有区段之后追加写入时，如果相邻空间已被其他文件占用，
            新分配的块可能位于磁盘的其他位置；
            
- **并发写入**：多个文件同时写入，各自的数据块交替分配在磁盘上；
            
- **删除与创建交替进行**：频繁的文件删除在空闲空间中制造了大量不连续的空洞；
            
- **文件系统接近满载**：可用空间减少时，连续空间更难获得。
            
            

### 7.2 诊断碎片化

            

使用 `filefrag`
            工具可以查看单个文件的碎片情况：
            
```
# 查看文件的区段数量
filefrag /path/to/file

# 查看详细的区段映射
filefrag -v /path/to/file
```

            

使用 `e2freefrag`
            可以查看文件系统的空闲空间碎片分布：
            
```
# 查看空闲空间碎片
e2freefrag /dev/sda1
```

            

输出示例：
            
```
Device: /dev/sda1
Blocksize: 4096 bytes
Total blocks: 26214400
Free blocks: 15728640 (60.0%)

Min. free extent: 4 KB
Max. free extent: 2048 MB
Avg. free extent: 128 KB

EXTENT SIZE RANGE :  FREE EXTENTS  FREE BLOCKS  PERCENT
    4K...    8K-  :          1024         1024    0.01%
    8K...   16K-  :           512         1024    0.01%
   16K...   32K-  :           256          512    0.00%
   ...
```

            

### 7.3
            在线碎片整理（e4defrag）

            

ext4 支持在线碎片整理（Online
            Defragmentation），可以在文件系统挂载的状态下进行，
            无需停机。碎片整理通过 `e4defrag` 工具完成：
            
```
# 对整个文件系统进行碎片整理
e4defrag /mnt

# 对单个文件进行碎片整理
e4defrag /path/to/file

# 对目录下的所有文件进行碎片整理
e4defrag /mnt/data/
```

            

`e4defrag` 的工作原理：
            
            
- 通过 `EXT4_IOC_MOVE_EXT` ioctl
            将源文件的数据复制到一个临时的”供体文件” （Donor
            File）的连续区段中；
            
- 原子地交换源文件与供体文件的区段映射；
            
- 删除供体文件。
            
            

这种基于区段交换的方式保证了碎片整理过程的原子性——即使在整理过程中发生崩溃，
            文件数据也不会丢失。
            

### 7.4 碎片整理的实践建议

            
            
- **定期检查**：通过定时任务（Cron
            Job）定期运行 `filefrag`
            统计关键文件的碎片程度；
            
- **低峰期执行**：碎片整理会产生大量
            I/O，应在系统负载较低时执行；
            
- **优先整理热点文件**：对数据库文件、虚拟机磁盘镜像等频繁访问的大文件优先整理；
            
- **保留足够空闲空间**：文件系统使用率维持在
            80% 以下可有效减缓碎片化。
            
            
```
# 定时碎片整理的 cron 配置示例
# 每周日凌晨 3 点执行碎片整理
0 3 * * 0 /usr/sbin/e4defrag /mnt/data >> /var/log/e4defrag.log 2>&1
```

            
            

## 八、ext4 高级特性

            

### 8.1 大块分配（bigalloc）

            

大块分配（bigalloc）特性将多个磁盘块组合为一个”簇（Cluster）“，以簇为单位进行
            分配。这减少了位图的大小和块分配器的开销，特别适用于超大文件系统。
            
```
# 创建使用 64 KiB 簇的文件系统
mkfs.ext4 -O bigalloc -C 65536 /dev/sda1
```

            

bigalloc 的优势：
            
            
- 位图变小（块位图变为簇位图），减少内存占用；
            
- 分配粒度增大，有利于大文件的连续分配；
            
- 减少区段数量，降低区段树的深度。
            
            

注意事项：
            
            
- bigalloc 会增加小文件的空间浪费（内部碎片）；
            
- 与某些特性（如在线碎片整理）的兼容性需要验证；
            
- 建议仅在大文件主导的场景中使用。
            
            

### 8.2 项目配额（Project
            Quota）

            

项目配额（Project
            Quota）允许管理员为特定的”项目”设置磁盘空间和索引节点的使用限额。
            与传统的用户配额（User Quota）和组配额（Group
            Quota）不同，项目配额可以跨用户和组
            进行空间管理，更适合多租户环境。
            
```
# 启用项目配额
mkfs.ext4 -O project,quota /dev/sda1

# 挂载时启用项目配额
mount -o prjquota /dev/sda1 /mnt

# 设置目录的项目 ID
chattr +P -p 100 /mnt/project_a/

# 设置项目配额限制
repquota -Ps /mnt
edquota -P 100
```

            

### 8.3 内联数据（Inline
            Data）

            

对于非常小的文件（通常小于 60 字节），ext4
            可以将文件数据直接存储在索引节点中，
            而不需要分配额外的数据块。这一特性称为内联数据（Inline
            Data，inline_data）。
            
```
# 创建支持内联数据的文件系统
mkfs.ext4 -O inline_data -I 256 /dev/sda1
```

            

内联数据的存储位置是索引节点中原本用于区段树 /
            间接块指针的 `i_block` 字段（60 字节）
            以及扩展属性（xattr）区域。对于包含大量小文件的场景（如邮件服务器的
            Maildir 目录）， 内联数据可以显著减少磁盘 I/O
            和空间浪费。
            

### 8.4
            文件系统级加密（fscrypt）

            

ext4 从 Linux 4.1
            开始支持文件系统级加密（Filesystem-level
            Encryption，fscrypt）。 加密以目录为单位进行，使用
            AES-256-XTS 加密文件内容，使用 AES-256-CTS-CBC
            加密文件名。
            
```
# 启用加密特性
tune2fs -O encrypt /dev/sda1

# 生成加密密钥
fscryptctl get_policy /mnt/encrypted_dir

# 设置加密策略
fscrypt encrypt /mnt/secret_dir
```

            

fscrypt 的设计优势：
            
            
- 加密在文件系统层完成，对应用透明；
            
- 不同目录可以使用不同的密钥；
            
- 支持硬件加速（AES-NI）；
            
- 与页缓存集成，加密/解密在 I/O 路径中完成。
            
            

### 8.5
            元数据校验和（Metadata Checksums）

            

ext4
            支持对所有元数据（超级块、组描述符、位图、索引节点、区段、目录项）计算
            CRC32C
            校验和。一旦检测到校验和不匹配，文件系统会将受影响的块组标记为损坏并触发错误处理。
            
```
# 创建启用元数据校验和的文件系统
mkfs.ext4 -O metadata_csum /dev/sda1

# 为已有文件系统启用校验和（需要离线）
tune2fs -O metadata_csum /dev/sda1
e2fsck -Df /dev/sda1
```

            

### 8.6 快速提交（Fast
            Commit）

            

快速提交（Fast Commit）是 Linux 5.10
            引入的日志优化特性。传统的 JBD2 日志以
            完整的块为单位记录修改，即使只修改了块中的几个字节，也需要记录整个
            4 KiB 块。 快速提交通过记录更细粒度的修改操作（如”在目录 X
            中添加条目 Y”），减少了日志写入量。
            
```
# 启用快速提交
tune2fs -O fast_commit /dev/sda1
```

            
            

## 九、ext4 调优实战

            

### 9.1 mkfs 选项优化

            

创建文件系统时的选项对后续性能影响深远，且大多数选项无法事后更改。
            
```
# 针对大文件场景的 mkfs 配置
mkfs.ext4 \
    -O 64bit,extent,flex_bg,metadata_csum,huge_file \
    -b 4096 \
    -i 1048576 \
    -I 256 \
    -J size=256 \
    -E stride=16,stripe-width=64,lazy_itable_init=1 \
    -T largefile \
    /dev/sda1
```

            

参数说明：
            
            
            
            
            
            
            
            参数
            说明
            
            
            
            
            `-b 4096`
            块大小 4 KiB（默认值，适合大多数场景）
            
            
            `-i 1048576`
            每 1 MiB
            分配一个索引节点（大文件场景，减少索引节点浪费）
            
            
            `-I 256`
            索引节点大小 256 字节（默认值）
            
            
            `-J size=256`
            日志大小 256 MiB
            
            
            `-E lazy_itable_init=1`
            延迟初始化索引节点表
            
            
            `-T largefile`
            使用大文件预设配置
            
            
            
            
```
# 针对小文件场景的 mkfs 配置（如邮件服务器）
mkfs.ext4 \
    -O inline_data,metadata_csum \
    -b 4096 \
    -i 4096 \
    -I 512 \
    -J size=128 \
    -T news \
    /dev/sda1
```

            

### 9.2 挂载选项优化

            
```
# 通用优化挂载选项
mount -o noatime,nodiratime,barrier=1,commit=5 /dev/sda1 /mnt

# 写入密集型工作负载
mount -o noatime,data=writeback,barrier=0,commit=30,delalloc /dev/sda1 /mnt

# 数据安全优先
mount -o noatime,data=journal,barrier=1,commit=1 /dev/sda1 /mnt
```

            

关键挂载选项说明：
            
            
            
            选项
            说明
            建议
            
            
            
            
            `noatime`
            不更新访问时间
            几乎所有场景都应启用
            
            
            `nodiratime`
            不更新目录访问时间
            `noatime` 已隐含此选项
            
            
            `barrier=1`
            启用写屏障（Write Barrier）
            默认启用，保证数据安全
            
            
            `commit=N`
            日志提交间隔（秒）
            默认 5 秒
            
            
            `delalloc`
            延迟分配
            默认启用
            
            
            `discard`
            启用 TRIM 支持
            SSD 场景应启用
            
            
            `max_batch_time`
            最大批处理时间（微秒）
            写入密集型可增大
            
            
            
            

### 9.3 sysctl 参数调优

            

内核的虚拟内存（Virtual Memory）子系统参数对 ext4
            的性能有重要影响：
            
```
# 调整脏页回写参数
# 脏页占内存比例的阈值，超过后开始后台回写
sysctl -w vm.dirty_background_ratio=5

# 脏页占内存比例的硬限制，超过后进程被阻塞
sysctl -w vm.dirty_ratio=20

# 脏页最长存留时间（厘秒，即 1/100 秒）
sysctl -w vm.dirty_expire_centisecs=3000

# 回写线程唤醒间隔（厘秒）
sysctl -w vm.dirty_writeback_centisecs=500
```

            

对于不同的工作负载，建议如下：
            
```
# 数据库服务器（减少脏页积累，降低突发写入延迟）
sysctl -w vm.dirty_background_ratio=3
sysctl -w vm.dirty_ratio=10
sysctl -w vm.dirty_expire_centisecs=1500
sysctl -w vm.dirty_writeback_centisecs=100

# 文件服务器（允许更多脏页积累，提高吞吐量）
sysctl -w vm.dirty_background_ratio=10
sysctl -w vm.dirty_ratio=40
sysctl -w vm.dirty_expire_centisecs=6000
sysctl -w vm.dirty_writeback_centisecs=500
```

            

### 9.4 I/O 调度器调优

            

I/O 调度器（I/O Scheduler）的选择对 ext4
            在不同存储介质上的性能有显著影响：
            
```
# 查看当前 I/O 调度器
cat /sys/block/sda/queue/scheduler

# HDD 推荐使用 mq-deadline 或 bfq
echo mq-deadline > /sys/block/sda/queue/scheduler

# SSD/NVMe 推荐使用 none（直通模式）
echo none > /sys/block/nvme0n1/queue/scheduler

# 调整队列深度
echo 128 > /sys/block/sda/queue/nr_requests
```

            

### 9.5 数据库工作负载调优

            

数据库（如 MySQL/PostgreSQL）通常使用 O_DIRECT
            绕过页缓存，并通过自有的缓冲池 （Buffer
            Pool）管理数据缓存。针对数据库工作负载的 ext4 调优要点：
            
```
# 数据库场景的推荐挂载选项
mount -o noatime,data=writeback,barrier=1,commit=5,nodelalloc /dev/sda1 /mnt/data

# 数据库的数据目录通常禁用延迟分配
# 因为数据库自行管理 fsync 语义，延迟分配的优势不明显
# 且可能导致 ENOSPC 错误的时机不可预测
```

            

MySQL InnoDB 的推荐配置：
            
```
# my.cnf
[mysqld]
innodb_flush_method = O_DIRECT
innodb_file_per_table = ON
innodb_flush_log_at_trx_commit = 1
innodb_doublewrite = ON
```

            

PostgreSQL 的推荐配置：
            
```
# postgresql.conf
wal_level = replica
fsync = on
synchronous_commit = on
full_page_writes = on
wal_buffers = 64MB
checkpoint_timeout = 15min
```

            

### 9.6 预分配数据库文件

            

对于数据库文件，使用 `fallocate`
            预分配可以避免写入过程中的块分配开销和碎片化：
            
```
# 预分配 InnoDB 数据文件
fallocate -l 10G /mnt/data/mysql/ibdata1

# 预分配 WAL 文件
fallocate -l 1G /mnt/data/pg_wal/000000010000000000000001
```

            

### 9.7 ext4 日常维护

            
```
# 检查文件系统（需要卸载）
e2fsck -f /dev/sda1

# 在线调整文件系统大小（扩容）
resize2fs /dev/sda1

# 查看文件系统特性
tune2fs -l /dev/sda1

# 修改文件系统标签
tune2fs -L "data" /dev/sda1

# 设置挂载次数检查间隔
tune2fs -c 50 /dev/sda1

# 设置时间检查间隔
tune2fs -i 3m /dev/sda1

# 启用/禁用特性
tune2fs -O ^has_journal /dev/sda1
tune2fs -O has_journal /dev/sda1
```

            

### 9.8 性能基准测试方法

            

在进行调优时，建立可重复的基准测试（Benchmark）方法至关重要：
            
```
# 使用 fio 进行基准测试
# 顺序写入测试
fio --name=seq-write \
    --ioengine=libaio \
    --direct=1 \
    --bs=1M \
    --size=4G \
    --numjobs=1 \
    --rw=write \
    --group_reporting \
    --filename=/mnt/testfile

# 随机读写混合测试（模拟数据库）
fio --name=rand-rw \
    --ioengine=libaio \
    --direct=1 \
    --bs=4K \
    --size=4G \
    --numjobs=16 \
    --rw=randrw \
    --rwmixread=70 \
    --iodepth=32 \
    --group_reporting \
    --filename=/mnt/testfile

# 元数据密集测试（模拟邮件服务器）
fio --name=metadata \
    --ioengine=libaio \
    --direct=0 \
    --bs=4K \
    --size=64K \
    --numjobs=8 \
    --rw=randwrite \
    --nrfiles=10000 \
    --group_reporting \
    --directory=/mnt/test/
```

            
```
# 在测试前清除缓存
sync
echo 3 > /proc/sys/vm/drop_caches

# 使用 iostat 监控磁盘 I/O
iostat -xz 1
```

            
            

## 十、ext4 vs XFS 对比

            

### 10.1 架构差异概述

            

ext4 和 XFS 是 Linux
            上最主要的两个本地文件系统。两者在架构理念上有根本性的差异：
            
            
            
            维度
            ext4
            XFS
            
            
            
            
            设计年代
            2006 年（基于 ext2 1993 年的设计）
            1993 年（SGI IRIX）
            
            
            元数据组织
            块组 + 位图
            分配组（Allocation Group） + B+ 树
            
            
            块映射
            区段树（B+ 树）
            B+ 树（bmbt）
            
            
            空闲空间管理
            位图
            B+ 树
            
            
            日志实现
            JBD2（独立模块）
            内建日志
            
            
            目录组织
            线性/HTree
            B+ 树
            
            
            索引节点分配
            静态预分配
            动态分配
            
            
            引用链接（Reflink）
            不支持
            支持
            
            
            在线缩容
            不支持
            不支持
            
            
            在线扩容
            支持
            支持
            
            
            反向映射（Reverse Mapping）
            不支持
            支持（rmap）
            
            
            
            

### 10.2 性能对比方法论

            

进行有意义的性能对比需要严格的方法论：
            
            
- **控制变量**：使用相同的硬件、内核版本、挂载选项（在语义等价的范围内）；
            
- **多次运行**：每个测试至少运行 3
            次取中位数，排除异常值；
            
- **预热阶段**：每次测试前执行一轮预热以消除冷启动效应；
            
- **清除缓存**：每次测试前清除页缓存和目录项缓存（dentry
            cache）；
            
- **监控系统状态**：使用
            `iostat`、`vmstat`、`perf`
            记录测试期间的系统行为。
            
            

### 10.3 各工作负载对比

            

**顺序大文件 I/O**：
            

在顺序读写大文件的场景下，ext4 和 XFS
            的性能差距很小，两者都能接近磁盘或 SSD 的 硬件带宽上限。XFS
            在超大文件（>1
            TiB）场景下由于动态索引节点分配和更灵活的分配组
            机制，可能略有优势。
            
```
顺序写入 4 GiB 文件（NVMe SSD，fio，direct=1，bs=1M）：
ext4:  2850 MiB/s
XFS:   2870 MiB/s
差异:  
            
            
            场景
            推荐文件系统
            原因
            
            
            
            
            通用服务器
            ext4
            稳定成熟，工具链完善
            
            
            大文件存储
            XFS
            动态索引节点，B+ 树分配
            
            
            小文件海量存储
            ext4
            位图分配效率高
            
            
            高并发写入
            XFS
            分配组并行分配
            
            
            数据库（MySQL）
            ext4 或 XFS
            差距不大，选择熟悉的
            
            
            数据库（PostgreSQL）
            XFS
            WAL 写入性能更好
            
            
            容器存储
            XFS + project quota
            配额隔离更灵活
            
            
            虚拟化存储
            XFS
            reflink 支持快速克隆
            
            
            嵌入式/小型设备
            ext4
            代码简单，资源占用少
            
            
            需要在线缩容
            ext4
            XFS 不支持在线缩容
            
            
            
            

### 10.5 迁移注意事项

            

从 ext4 迁移到 XFS（或反向迁移）时需要注意：
            
            
- 两者的挂载选项不完全相同，需要逐一对照转换；
            
- XFS 不支持在线缩容，迁移前需确认容量规划；
            
- 备份和恢复工具不同：ext4 使用
            `dump/restore`，XFS 使用
            `xfsdump/xfsrestore`；
            
- 文件系统级加密（fscrypt）在两者上的行为一致；
            
- ACL（Access Control
            List）和扩展属性在两者上的语义相同。
            
            
            

## 附录

            

### 附录 A：ext4
            特性标志速查表

            
```
# 查看已启用的特性标志
tune2fs -l /dev/sda1 | grep "Filesystem features"
```

            

常用特性标志：
            
            
            
            标志
            说明
            默认
            
            
            
            
            `has_journal`
            日志支持
            是
            
            
            `extent`
            区段映射
            是
            
            
            `flex_bg`
            弹性块组
            是
            
            
            `64bit`
            64 位块号
            是（新版 e2fsprogs）
            
            
            `metadata_csum`
            元数据校验和
            是（新版 e2fsprogs）
            
            
            `dir_index`
            HTree 目录索引
            是
            
            
            `huge_file`
            大文件支持
            是
            
            
            `uninit_bg`
            延迟初始化块组
            是
            
            
            `bigalloc`
            大块分配
            否
            
            
            `inline_data`
            内联数据
            否
            
            
            `encrypt`
            文件系统加密
            否
            
            
            `project`
            项目配额
            否
            
            
            `fast_commit`
            快速提交
            否
            
            
            
            

### 附录 B：常用诊断命令

            
```
# 查看超级块信息
dumpe2fs -h /dev/sda1

# 查看块组详情
dumpe2fs /dev/sda1 | less

# 交互式调试
debugfs /dev/sda1

# 在 debugfs 中查看索引节点
debugfs: stat 

# 在 debugfs 中查看区段树
debugfs: extent_open 
debugfs: extent_dump

# 查看文件的区段映射
filefrag -v /path/to/file

# 查看空闲空间碎片
e2freefrag /dev/sda1

# 查看 mballoc 统计
cat /proc/fs/ext4/sda1/mb_groups

# 查看延迟分配统计
cat /proc/fs/ext4/sda1/delayed_allocation_blocks

# 查看日志状态
dumpe2fs -h /dev/sda1 | grep -i journal
```

            

### 附录 C：故障排除

            

**场景一：文件系统只读挂载**
            
```
# 查看系统日志
dmesg | grep -i ext4

# 常见原因：检测到元数据错误，文件系统自动切换为只读
# 解决方案：卸载后执行 e2fsck
umount /mnt
e2fsck -f /dev/sda1
mount /dev/sda1 /mnt
```

            

**场景二：ENOSPC 但 df 显示有空间**
            
```
# 可能原因 1：索引节点用尽
df -i /mnt

# 可能原因 2：预留块（Reserved Blocks）
# 默认预留 5% 空间给 root 用户
tune2fs -l /dev/sda1 | grep "Reserved block count"

# 减少预留比例（生产环境建议保留 1-2%）
tune2fs -m 1 /dev/sda1

# 可能原因 3：延迟分配的空间预留
cat /proc/fs/ext4/sda1/delayed_allocation_blocks
```

            

**场景三：性能突降**
            
```
# 检查日志是否阻塞
cat /proc/fs/ext4/sda1/journal_task

# 检查碎片化程度
filefrag /path/to/slow_file

# 检查 I/O 调度器
cat /sys/block/sda/queue/scheduler

# 检查磁盘健康状态
smartctl -a /dev/sda
```

            
            

## 参考资料

            
            
- ext4 官方 Wiki：[https://ext4.wiki.kernel.org/](https://ext4.wiki.kernel.org/)
            
- 内核文档 ext4 章节：https://www.kernel.org/doc/html/latest/filesystems/ext4/
            
- e2fsprogs 源代码：https://git.kernel.org/pub/scm/fs/ext2/e2fsprogs.git
            
- Theodore Ts’o，“ext4: The Next Generation of the ext2/3
            Filesystem”，Proceedings of the Linux Symposium，2008
            
- Mathur A.，Cao M.，Bhattacharya S.，Dilger A.，Tomas
            A.，Vivier L.，“The New ext4 filesystem: Current Status and
            Future Plans”，Proceedings of the Linux Symposium，2007
            
- 内核源码 fs/ext4/ 目录：https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/fs/ext4
            
- JBD2 文档：https://www.kernel.org/doc/html/latest/filesystems/ext4/journal.html
            
- fio 官方文档：[https://fio.readthedocs.io/](https://fio.readthedocs.io/)
            
- XFS 官方文档：[https://xfs.wiki.kernel.org/](https://xfs.wiki.kernel.org/)
            
- Rik van Riel，“Virtual Memory in the Linux
            Kernel”，内核虚拟内存子系统文档
            
- LWN.net，“ext4 and data loss”，2009：https://lwn.net/Articles/322823/
            
- LWN.net，“Ext4 delayed allocation and the zero-length
            file problem”，2009：https://lwn.net/Articles/326471/
            
- Linux 内核 Documentation/filesystems/ext4.txt：https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/Documentation/filesystems/ext4
            
            
            

**上一篇**: 文件系统基础：inode、目录与
            VFS
            

**下一篇**: XFS
            架构：大文件与高并发
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。
                

                
                    

2026-06-28 · linux / storage
                    

### fsync 失败的真相：当它返回错误，你的数据可能已经没了

                    

fsync() 返回 EIO 后再调一次为什么会成功？为什么这反而是灾难？从 2018 fsyncgate 到 Linux errseq_t，再到本机内核 6.6 上用 dm-error 单块故障注入的实测，讲清 writeback 失败时脏页被标记 clean、数据静默丢失的真相，以及 PostgreSQL 为什么选择 PANIC。
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】磁盘空间耗尽：从 70% 到 ENOSPC 的行为退化链

                    

逐层拆解 ext4、XFS、Btrfs、ZFS 从 70% 填充到 100% 耗尽过程中的块分配退化、碎片化加剧和 ENOSPC 故障模式，给出各文件系统的容量红线、监控阈值和应急恢复方法。
                

                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。