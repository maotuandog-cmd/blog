# 【存储工程】Btrfs：写时复制文件系统

来源: https://quant67.com/post/storage/16-btrfs-cow/btrfs-cow.html
日期: 2025-08-25 |

---

ext4 和 XFS
            走的是”就地更新”路线：数据写到哪个块，就直接覆盖那个块。这条路线简单、高效，但有一个根本性的问题——如果写到一半断电，磁盘上的数据处于半新半旧的状态，文件系统就损坏了。日志（Journal）机制可以缓解这个问题，但它本质上是”先写一遍日志，再写一遍数据”，写放大不可避免。
            

Btrfs（B-tree File
            System）选了另一条路：写时复制（Copy-on-Write，CoW）。修改数据时不覆盖原块，而是把新数据写到新位置，然后原子地更新指针。这个看似简单的设计选择，像多米诺骨牌一样带出了一整套能力——零开销快照、内置校验、透明压缩、多设备管理——全部内建在文件系统里，不依赖外部工具。
            

Btrfs 由甲骨文（Oracle）的 Chris Mason 在 2007
            年启动开发，2009 年合入 Linux 2.6.29
            主线内核。它的设计目标直白：做一个功能上能对标
            ZFS，但原生运行在 Linux
            内核里的现代文件系统。经过十多年发展，Btrfs 已经成为 SUSE
            Linux Enterprise 的默认文件系统，Facebook（现
            Meta）在其生产环境大规模使用，Fedora 从 33
            版开始也将其作为桌面默认选择。
            

本文从 CoW 的核心原理讲起，逐层拆解 Btrfs 的 B-Tree
            结构、子卷与快照机制、透明压缩、内置
            RAID、数据校验与自修复、增量同步、碎片化管理，最后落到生产环境的实战命令和选型评估。所有命令示例基于
            Linux 6.1 内核，在 openSUSE Leap 15.5 和 Ubuntu 22.04
            上验证。
            
            

## 一、Btrfs 设计目标与
            CoW 原理

            

### 1.1 设计目标

            

Btrfs 的设计目标可以归纳为五个方面：
            
            
- **数据完整性**：每个数据块和元数据块都携带校验和（Checksum），读取时自动验证，发现损坏立即报告；
            
- **高效快照**：快照的创建是 O(1)
            操作，不需要复制任何数据，占用空间仅随后续修改增长；
            
- **灵活的存储池**：多个物理设备可以组成一个逻辑文件系统，支持在线添加、移除、替换设备；
            
- **透明压缩**：文件数据在写入磁盘前自动压缩，读取时自动解压，对应用完全透明；
            
- **自修复能力**：在多副本配置下，检测到数据损坏后可以从正确的副本自动恢复。
            
            

这些目标的共同基础就是写时复制（CoW）机制。
            

### 1.2 什么是写时复制

            

传统文件系统（如 ext4）采用就地更新（In-place
            Update）策略：
            
```
就地更新流程：
1. 应用写入文件偏移 0-4KB 的新数据
2. 文件系统找到该偏移对应的磁盘块 X
3. 直接将新数据覆盖写入磁盘块 X
4. 如果此刻断电，块 X 上的数据可能是半新半旧的
```

            

CoW 的做法完全不同：
            
```
CoW 流程：
1. 应用写入文件偏移 0-4KB 的新数据
2. 文件系统分配一个新的磁盘块 Y
3. 将新数据写入磁盘块 Y
4. 更新元数据指针：文件偏移 0-4KB 现在指向块 Y（而非块 X）
5. 释放旧块 X（如果没有快照引用它）
6. 如果写入块 Y 时断电，旧块 X 完好无损，文件系统仍然一致
```

            

关键点在于第 4 步——指针更新本身也是 CoW
            的。修改一个数据块，需要更新它的父节点指针；更新父节点，又需要更新父节点的父节点……一直向上传播到树根（Root）。整棵树的根指针更新是一个原子操作（通常借助超级块的原子写入），这就保证了文件系统在任何时刻都是一致的。
            

### 1.3 CoW 的代价

            

CoW 不是免费的午餐。它带来了两个固有问题：
            

**写放大（Write
            Amplification）**：修改一个叶子节点，整条路径到根节点都要重写。如果树的深度为
            4，一次 4KB 的数据修改可能触发 4 次 16KB 的元数据写入。不过
            Btrfs 通过延迟分配（Delayed
            Allocation）和批量提交（Transaction
            Commit）来摊销这个开销——多次修改可以合并到同一次事务提交中，共享路径上的节点只写一次。
            

**碎片化（Fragmentation）**：因为新数据总是写到新位置，文件的物理布局会随着修改变得碎片化。对于顺序读取的大文件（如数据库数据文件、虚拟机磁盘镜像），碎片化会严重影响性能。Btrfs
            提供了 `autodefrag`
            挂载选项和手动碎片整理工具来缓解这个问题（详见第八节）。
            

### 1.4 CoW 与日志的对比

            

下面对比 CoW 和传统日志机制：
            
```
┌──────────────┬──────────────────────┬─────────────────────┐
│   特性       │  日志（Journal）     │  CoW                │
├──────────────┼──────────────────────┼─────────────────────┤
│ 一致性保证   │ 重放日志恢复         │ 天然原子，无需恢复  │
│ 写放大       │ 数据写两次           │ 路径复制            │
│ 快照支持     │ 需要额外机制（LVM）  │ 天然支持            │
│ 碎片化       │ 较少                 │ 较多                │
│ 崩溃恢复速度 │ 与日志大小成正比     │ 几乎即时            │
│ 实现复杂度   │ 中等                 │ 较高                │
└──────────────┴──────────────────────┴─────────────────────┘
```

            

Btrfs 选择 CoW
            不是因为它在所有维度都更好，而是因为它在快照、校验、多设备管理等方面天然适合，这些功能在日志型文件系统上需要大量额外代码才能实现。
            
            

## 二、CoW B-Tree 数据结构

            

### 2.1 树中之树（Tree of
            Trees）

            

Btrfs 的核心数据结构是一棵 B-Tree
            的森林，官方称为”树中之树”（Tree of
            Trees）。整个文件系统由多棵 B-Tree
            组成，每棵树负责不同类型的数据：
            
```
Btrfs 的树结构：

Root Tree（根树）
├── FS Tree（文件系统树） ── 存储文件、目录的 inode 和数据引用
├── Extent Tree（区段树） ── 管理磁盘空间分配
├── Chunk Tree（块组树）  ── 逻辑地址到物理地址的映射
├── Device Tree（设备树） ── 物理设备信息
├── Checksum Tree（校验树）── 数据块的校验和
├── Log Tree（日志树）    ── fsync 优化用的小型日志
├── UUID Tree（UUID 树）  ── 子卷和快照的 UUID 索引
└── Quota Tree（配额树）  ── 子卷配额信息
```

            

所有这些树共享同一种 B-Tree
            节点格式，通过根树的根节点串联起来。根树本身的根节点地址记录在超级块（Superblock）中。
            

### 2.2 B-Tree 节点格式

            

Btrfs 的 B-Tree 节点大小默认为 16KB（可通过
            `mkfs.btrfs -n` 设置为 4KB 到
            64KB）。每个节点包含一个头部和若干键值对：
            
```
/* 节点头部（简化） */
struct btrfs_header {
    u8  csum[32];        /* 本节点的校验和 */
    u8  fsid[16];        /* 文件系统 UUID */
    u64 bytenr;          /* 本节点在磁盘上的字节偏移 */
    u64 flags;
    u64 generation;      /* 事务代数 */
    u64 owner;           /* 所属树的 ID */
    u32 nritems;         /* 本节点包含的条目数 */
    u8  level;           /* 层级：0=叶子节点 */
};
```

            
```
/* 搜索键（Key）：三元组 */
struct btrfs_key {
    u64 objectid;        /* 对象 ID（如 inode 号） */
    u8  type;            /* 条目类型 */
    u64 offset;          /* 类型相关的偏移量 */
};
```

            

键的三元组设计非常精巧。以文件数据为例：`objectid`
            是 inode 号，`type` 是
            `EXTENT_DATA`，`offset`
            是文件内偏移。这样同一个 inode
            的所有数据范围自然地排列在一起，范围查询极其高效。
            

### 2.3 内部节点与叶子节点

            

内部节点（Internal
            Node）的每个条目包含一个键和一个指向子节点的块指针：
            
```
内部节点布局：
┌──────────────────────────────────────────────────┐
│ Header (csum, generation, level, nritems, ...)   │
├──────────┬──────────┬──────────┬──────────────────┤
│ Key₀     │ Key₁     │ Key₂     │ ...              │
│ BlockPtr₀│ BlockPtr₁│ BlockPtr₂│ ...              │
└──────────┴──────────┴──────────┴──────────────────┘
```

            

叶子节点（Leaf
            Node）的条目包含键和内联数据（或对数据块的引用）：
            
```
叶子节点布局：
┌──────────────────────────────────────────────────┐
│ Header                                           │
├──────────┬──────────┬──────────┬──────────────────┤
│ Item₀    │ Item₁    │ Item₂    │ ...              │ ← 从前向后增长
│          │          │          │                  │
│          │     [Free Space]                       │
│          │                                        │
│ Data₂    │ Data₁    │ Data₀    │                  │ ← 从后向前增长
└──────────┴──────────┴──────────┴──────────────────┘
```

            

叶子节点使用双向增长的布局：条目头从前向后排列，数据从后向前填充，两者在中间相遇时节点满。这种设计减少了插入和删除时的数据移动。
            

### 2.4 CoW 语义在 B-Tree
            上的实现

            

当修改一个叶子节点的数据时，CoW 的传播过程如下：
            
```
修改前：                           修改后：
                                   
    Root [gen=100]                     Root' [gen=101]
    /    \                             /    \
   A      B [gen=98]                  A      B' [gen=101]
  / \    / \                         / \    / \
 a1 a2  b1  b2                     a1 a2  b1  b2'
                                              ↑
                                          新分配的叶子
                                          （b2 的修改副本）

注：A 和 a1、a2 没有被修改，所以原封不动地被新根引用。
    只有 Root→B→b2 这条路径被复制了。
    旧的 Root、B、b2 如果没有快照引用，会被回收。
```

            

这就是 CoW B-Tree
            的核心：**只复制修改路径上的节点，未修改的子树通过共享引用避免复制**。这也是快照能做到零开销的原因——创建快照只需要增加一个对当前根节点的引用。
            

### 2.5 事务与代（Generation）

            

Btrfs
            使用事务代（Generation）来管理一致性。每次事务提交，代数加一。每个节点头部记录了它被最后修改的代数。这个设计有两个重要用途：
            
            
- **一致性检查**：父节点记录的子节点代数必须大于等于子节点头部的代数，否则说明数据不一致；
            
- **增量发送**：`btrfs send`
            可以通过比较两个快照之间的代数差异，快速找到被修改的节点（详见第七节）。
            
            
```
# 查看文件系统的当前事务代数
btrfs inspect-internal dump-super /dev/sda1 | grep generation
```

            

输出示例：
            
```
generation              125847
```

            
            

## 三、子卷（Subvolume）与快照（Snapshot）

            

### 3.1 子卷的概念

            

子卷（Subvolume）是 Btrfs
            最具特色的功能之一。一个子卷是文件系统内部的一棵独立的文件系统树（FS
            Tree），拥有自己的 inode
            空间和目录层级。可以把子卷理解为”文件系统中的文件系统”。
            

子卷的特点：
            
            
- **轻量**：创建子卷不分配任何数据块，只创建一个新的
            FS Tree 根节点；
            
- **共享空间**：所有子卷共享同一个存储池的空间，不需要预先划分大小；
            
- **独立挂载**：每个子卷可以单独挂载，使用不同的挂载选项；
            
- **嵌套**：子卷内部可以再创建子卷，形成层级结构。
            
            

### 3.2 创建和管理子卷

            
```
# 创建子卷
btrfs subvolume create /mnt/btrfs/@home
btrfs subvolume create /mnt/btrfs/@var
btrfs subvolume create /mnt/btrfs/@snapshots

# 列出所有子卷
btrfs subvolume list /mnt/btrfs
```

            

输出示例：
            
```
ID 256 gen 100 top level 5 path @home
ID 257 gen 98  top level 5 path @var
ID 258 gen 95  top level 5 path @snapshots
```

            
```
# 查看子卷详细信息
btrfs subvolume show /mnt/btrfs/@home
```

            

输出示例：
            
```
@home
        Name:                   @home
        UUID:                   a1b2c3d4-e5f6-7890-abcd-ef1234567890
        Parent UUID:            -
        Received UUID:          -
        Creation time:          2025-08-25 10:30:00 +0800
        Subvolume ID:           256
        Generation:             100
        Gen at creation:        90
        Parent ID:              5
        Top level ID:           5
        Flags:                  -
        Send transid:           0
        Send time:              2025-08-25 10:30:00 +0800
        Receive transid:        0
        Receive time:           -
        Snapshot(s):
```

            

### 3.3 默认子卷与挂载

            

Btrfs
            的顶层目录（Top-level，ID=5）本身就是一个子卷。可以通过设置默认子卷来控制不带
            `subvol` 选项挂载时看到的内容：
            
```
# 设置默认子卷
btrfs subvolume set-default 256 /mnt/btrfs

# 挂载特定子卷
mount -t btrfs -o subvol=@home /dev/sda1 /home
mount -t btrfs -o subvolid=257 /dev/sda1 /var

# 在 /etc/fstab 中配置
# /dev/sda1  /      btrfs  defaults,subvol=@       0 0
# /dev/sda1  /home  btrfs  defaults,subvol=@home   0 0
# /dev/sda1  /var   btrfs  defaults,subvol=@var    0 0
```

            

### 3.4 快照的原理

            

快照（Snapshot）本质上是一个特殊的子卷——它在创建时共享源子卷的整棵
            FS Tree。创建快照的操作只有两步：
            
            
- 在根树中创建一个新的 FS Tree
            根节点，指向源子卷的根节点；
            
- 将源子卷根节点的引用计数加一。
            
            
```
创建快照前：                       创建快照后：

Root Tree                          Root Tree
    │                                  │
    ├── FS Tree @home (ID=256)         ├── FS Tree @home (ID=256)
    │       │                          │       │
    │       Root ──→ [数据块群]        │       Root ──→ [数据块群] ←── Root
    │                                  │                              │
    │                                  │                     FS Tree @snap (ID=259)
    │                                  │                              │
    └── ...                            └── ...                 新建子卷条目
```

            

因为 CoW 语义，后续对 `@home`
            的修改会创建新的节点副本，而快照仍然引用旧节点。两者只在被修改的部分产生差异，未修改的数据块继续共享。
            

### 3.5 创建和管理快照

            
```
# 创建只读快照
btrfs subvolume snapshot -r /mnt/btrfs/@home \
    /mnt/btrfs/@snapshots/home-2025-08-25

# 创建可写快照
btrfs subvolume snapshot /mnt/btrfs/@home \
    /mnt/btrfs/@snapshots/home-writable

# 删除快照（与删除子卷操作相同）
btrfs subvolume delete /mnt/btrfs/@snapshots/home-writable

# 查看快照占用的独占空间（需要启用配额）
btrfs qgroup show /mnt/btrfs
```

            

### 3.6 快照的实际空间开销

            

快照刚创建时不占用额外空间。随着源子卷的数据被修改，快照需要保留旧版本的数据块，空间开销才开始增长：
            
```
# 启用配额系统来跟踪空间使用
btrfs quota enable /mnt/btrfs

# 查看每个子卷/快照的空间使用
btrfs qgroup show -reF /mnt/btrfs
```

            

输出示例：
            
```
qgroupid         rfer         excl
--------         ----         ----
0/256        12.50GiB     10.20GiB
0/257         3.80GiB      3.80GiB
0/259        12.50GiB      2.30GiB   ← 快照独占 2.3G（源子卷修改了这么多）
```

            

`rfer`（Referenced）是子卷引用的总数据量，`excl`（Exclusive）是该子卷独占的、删除后可以释放的空间。
            

### 3.7 嵌套子卷的注意事项

            

子卷可以嵌套，但有一个重要限制：**快照不会递归地包含嵌套子卷的内容**。如果
            `@home` 内部有一个嵌套子卷
            `@home/docker`，对 `@home`
            创建快照时，`docker`
            子卷在快照中会显示为一个空目录。
            
```
# 嵌套子卷示例
btrfs subvolume create /mnt/btrfs/@home/docker

# 对 @home 创建快照——docker 子卷不会被包含
btrfs subvolume snapshot -r /mnt/btrfs/@home \
    /mnt/btrfs/@snapshots/home-snap
# /mnt/btrfs/@snapshots/home-snap/docker 是一个空目录
```

            

最佳实践是将需要独立快照的目录设计为平级子卷，而不是嵌套子卷。典型的布局如下：
            
```
顶层（ID=5）
├── @           ← 挂载到 /
├── @home       ← 挂载到 /home
├── @var        ← 挂载到 /var
├── @docker     ← 挂载到 /var/lib/docker
└── @snapshots  ← 挂载到 /.snapshots
```

            
            

## 四、透明压缩

            

### 4.1 压缩算法选择

            

Btrfs 支持三种压缩算法（Compression Algorithm）：
            
            
            
            算法
            引入内核版本
            压缩比
            压缩速度
            解压速度
            适用场景
            
            
            
            
            zlib
            2.6.29
            高
            慢
            中等
            归档存储，空间优先
            
            
            LZO
            2.6.38
            中
            快
            快
            通用场景
            
            
            zstd
            4.14
            高
            快
            快
            推荐默认选择
            
            
            
            

zstd（Zstandard）是目前推荐的首选算法。它在压缩比上接近
            zlib，但速度快得多；在速度上接近 LZO，但压缩比好得多。
            

### 4.2 压缩级别

            

zstd 支持从 1 到 15 的压缩级别（Compression Level），zlib
            支持 1 到 9：
            
```
# 使用 zstd 默认级别（3）
mount -t btrfs -o compress=zstd /dev/sda1 /mnt

# 指定 zstd 压缩级别
mount -t btrfs -o compress=zstd:6 /dev/sda1 /mnt

# 使用 zlib
mount -t btrfs -o compress=zlib:6 /dev/sda1 /mnt

# 使用 LZO
mount -t btrfs -o compress=lzo /dev/sda1 /mnt
```

            

### 4.3 compress 与
            compress-force 的区别

            

Btrfs
            有一个启发式机制：如果检测到文件的前几个块压缩后体积没有明显缩小，就会标记该文件为不可压缩（`NOCOMPRESS`
            标志），后续写入不再尝试压缩。
            
```
# 普通压缩：遇到不可压缩数据会自动跳过
mount -t btrfs -o compress=zstd /dev/sda1 /mnt

# 强制压缩：始终尝试压缩，忽略启发式判断
mount -t btrfs -o compress-force=zstd /dev/sda1 /mnt
```

            

对于已知内容混合的场景（如包含大量文本文件和少量已压缩媒体文件的目录），默认的
            `compress`
            通常是更好的选择。`compress-force`
            适用于你确定大部分数据可压缩的场景。
            

### 4.4 按文件设置压缩属性

            

除了全局挂载选项，还可以按文件或目录设置压缩属性（Property）：
            
```
# 为目录设置压缩属性（新创建的文件继承）
btrfs property set /mnt/logs compression zstd

# 查看压缩属性
btrfs property get /mnt/logs compression

# 清除压缩属性
btrfs property set /mnt/logs compression ""

# 使用 chattr 设置不压缩标志
chattr +m /mnt/data/video.mp4    # NOCOMPRESS 标志
```

            

注意：修改压缩属性只影响后续写入的数据。已存在的数据需要通过碎片整理触发重新压缩：
            
```
# 对已有文件触发重新压缩
btrfs filesystem defragment -r -czstd /mnt/logs/
```

            

### 4.5 压缩比基准测试

            

以下是在一台配备 NVMe SSD
            的服务器上，对不同类型数据的压缩效果测试：
            
```
测试环境：AMD EPYC 7543，NVMe SSD（Samsung 980 PRO 1TB）
数据集：Linux 6.1 内核源码（约 1.3GB）

┌──────────────┬───────────┬────────────┬────────────┬───────────┐
│ 算法         │ 原始大小  │ 压缩后大小 │ 压缩比     │ 写入速度  │
├──────────────┼───────────┼────────────┼────────────┼───────────┤
│ 无压缩       │ 1.30 GiB  │ 1.30 GiB   │ 1.00x      │ 2.1 GB/s  │
│ lzo          │ 1.30 GiB  │ 0.78 GiB   │ 1.67x      │ 1.8 GB/s  │
│ zstd:1       │ 1.30 GiB  │ 0.52 GiB   │ 2.50x      │ 1.6 GB/s  │
│ zstd:3       │ 1.30 GiB  │ 0.47 GiB   │ 2.77x      │ 1.4 GB/s  │
│ zstd:6       │ 1.30 GiB  │ 0.43 GiB   │ 3.02x      │ 0.9 GB/s  │
│ zstd:15      │ 1.30 GiB  │ 0.39 GiB   │ 3.33x      │ 0.2 GB/s  │
│ zlib:6       │ 1.30 GiB  │ 0.44 GiB   │ 2.95x      │ 0.4 GB/s  │
│ zlib:9       │ 1.30 GiB  │ 0.43 GiB   │ 3.02x      │ 0.3 GB/s  │
└──────────────┴───────────┴────────────┴────────────┴───────────┘
```

            
```
数据集：PostgreSQL 数据库转储文件（约 50GB，纯文本 SQL）

┌──────────────┬───────────┬────────────┬────────────┐
│ 算法         │ 原始大小  │ 压缩后大小 │ 压缩比     │
├──────────────┼───────────┼────────────┼────────────┤
│ 无压缩       │ 50.0 GiB  │ 50.0 GiB   │ 1.00x      │
│ lzo          │ 50.0 GiB  │ 22.7 GiB   │ 2.20x      │
│ zstd:3       │ 50.0 GiB  │ 10.2 GiB   │ 4.90x      │
│ zlib:6       │ 50.0 GiB  │ 9.8 GiB    │ 5.10x      │
└──────────────┴───────────┴────────────┴────────────┘
```

            

关键结论：**zstd:3
            是大多数场景的最佳平衡点**。它的压缩比接近
            zlib:6，但写入速度快 3
            倍以上。只有在存储空间极其紧张且对写入性能不敏感的归档场景，才值得使用更高的压缩级别。
            

### 4.6 压缩对性能的影响

            

压缩并不总是降低性能。对于 I/O 带宽受限的场景（如
            HDD、网络存储），压缩可以减少实际需要传输的数据量，反而提升吞吐量：
            
```
# 查看文件的压缩统计
compsize /mnt/data/
```

            

输出示例：
            
```
Processed 28453 files, 3891 regular extents (3891 inline).
Type       Perc     Disk Usage   Uncompressed Referenced
TOTAL       38%      4.8G         12.5G        12.5G
none       100%      1.2G          1.2G         1.2G
zstd        32%      3.6G         11.3G        11.3G
```

            

`compsize` 工具（需要单独安装）可以显示 Btrfs
            文件系统的实际压缩效果。`Perc`
            列显示压缩后的数据占原始大小的百分比。
            
            

## 五、内置 RAID

            

### 5.1 Btrfs RAID 概述

            

Btrfs 内置了多设备管理和 RAID（Redundant Array of
            Independent Disks，独立磁盘冗余阵列）功能，不需要依赖 mdadm
            或硬件 RAID 控制器。它的 RAID 实现基于块组（Block
            Group）级别的条带化和镜像，而非传统 RAID 的全盘级别。
            

支持的 RAID 配置档案（Profile）：
            
```
┌────────────┬──────────┬──────────┬────────────┬──────────────────┐
│ 配置档案   │ 最少设备 │ 空间利用 │ 容错能力   │ 状态             │
├────────────┼──────────┼──────────┼────────────┼──────────────────┤
│ single     │ 1        │ 100%     │ 无         │ 稳定             │
│ dup        │ 1        │ 50%      │ 无（注1）  │ 稳定             │
│ raid0      │ 2        │ 100%     │ 无         │ 稳定             │
│ raid1      │ 2        │ 50%      │ 1块盘故障  │ 稳定             │
│ raid1c3    │ 3        │ 33%      │ 2块盘故障  │ 稳定（5.5+）     │
│ raid1c4    │ 4        │ 25%      │ 3块盘故障  │ 稳定（5.5+）     │
│ raid10     │ 4        │ 50%      │ 取决于布局 │ 稳定             │
│ raid5      │ 3        │ (N-1)/N  │ 1块盘故障  │ 不稳定（写洞）   │
│ raid6      │ 4        │ (N-2)/N  │ 2块盘故障  │ 不稳定（写洞）   │
└────────────┴──────────┴──────────┴────────────┴──────────────────┘
注1：dup 在同一设备上存储两份副本，可以防范部分扇区损坏，但无法防范整盘故障。
```

            

### 5.2 创建多设备文件系统

            
```
# 创建 RAID-1 文件系统（数据和元数据都镜像）
mkfs.btrfs -d raid1 -m raid1 /dev/sdb /dev/sdc

# 创建混合配置：数据 RAID-0，元数据 RAID-1
mkfs.btrfs -d raid0 -m raid1 /dev/sdb /dev/sdc /dev/sdd

# 挂载多设备文件系统
mount /dev/sdb /mnt/btrfs

# 查看文件系统的设备组成
btrfs filesystem show /mnt/btrfs
```

            

输出示例：
            
```
Label: none  uuid: 12345678-abcd-efgh-ijkl-1234567890ab
        Total devices 2 FS bytes used 15.30GiB
        devid    1 size 100.00GiB used 20.00GiB path /dev/sdb
        devid    2 size 100.00GiB used 20.00GiB path /dev/sdc
```

            

### 5.3
            元数据镜像（Metadata Mirroring）

            

即使数据不做 RAID，Btrfs
            默认也会对元数据进行保护。在单设备上，元数据默认使用
            `dup`（双份存储）；在多设备上，默认使用
            `raid1`。这是因为元数据丢失比数据丢失更具灾难性——一个损坏的元数据节点可能导致整个子树不可访问。
            
```
# 查看块组的分配情况
btrfs filesystem df /mnt/btrfs
```

            

输出示例：
            
```
Data, RAID1: total=40.00GiB, used=15.30GiB
System, RAID1: total=32.00MiB, used=16.00KiB
Metadata, RAID1: total=2.00GiB, used=512.00MiB
GlobalReserve, single: total=128.00MiB, used=0.00B
```

            

### 5.4 在线添加和移除设备

            
```
# 添加新设备
btrfs device add /dev/sdd /mnt/btrfs

# 添加后需要重新平衡数据分布
btrfs balance start -dconvert=raid1 -mconvert=raid1 /mnt/btrfs

# 移除设备（数据会自动迁移到剩余设备）
btrfs device remove /dev/sdc /mnt/btrfs

# 替换故障设备
btrfs replace start /dev/sdc /dev/sde /mnt/btrfs

# 查看替换进度
btrfs replace status /mnt/btrfs
```

            

### 5.5 RAID-5/6 的已知问题

            

Btrfs 的 RAID-5/6 实现存在一个严重的问题——写洞（Write
            Hole）。这个问题在 mdadm 的 RAID-5/6 中也存在，但 mdadm 有
            bitmap 机制来缓解。
            

写洞的本质：在一次条带（Stripe）写入过程中，如果系统崩溃，可能出现数据块和校验块不一致的状态。重启后，RAID
            层无法判断哪个块是正确的。
            
```
RAID-5 写洞场景：

正常写入一个条带：
  Disk1: [D1_new]  Disk2: [D2]  Disk3: [P_new]
  
崩溃点：D1_new 已写入，P_new 尚未写入
  Disk1: [D1_new]  Disk2: [D2]  Disk3: [P_old]

重启后：
  P_old 是基于 D1_old 和 D2 计算的
  但 D1 已经变成了 D1_new
  校验不一致 → 无法确定哪个盘的数据是正确的
```

            

**生产建议：不要在生产环境使用 Btrfs 的
            RAID-5/6。** 如果需要 RAID-5/6 级别的容错，可以在
            mdadm RAID-5/6 之上创建 Btrfs 单设备文件系统，或者使用 Btrfs
            的 RAID-1/RAID-1c3/RAID-10。
            

### 5.6 RAID 配置的最佳实践

            
```
┌───────────────────────┬─────────────────────────────────┐
│ 场景                  │ 推荐配置                        │
├───────────────────────┼─────────────────────────────────┤
│ 桌面/笔记本单盘       │ data=single, meta=dup           │
│ 双盘镜像              │ data=raid1, meta=raid1          │
│ 三盘以上，容错优先    │ data=raid1c3, meta=raid1c3      │
│ 四盘以上，性能与容错  │ data=raid10, meta=raid1c3       │
│ 大容量存储池          │ data=raid1, meta=raid1c3        │
│ 需要 RAID-5/6 容错    │ mdadm RAID-5/6 + btrfs single  │
└───────────────────────┴─────────────────────────────────┘
```

            
            

## 六、数据校验与自修复

            

### 6.1
            逐块校验和（Per-block Checksum）

            

Btrfs
            对每个数据块和元数据块都计算校验和（Checksum），默认使用
            CRC32C 算法。从 Linux 5.5 开始，还支持更强的校验算法：
            
```
┌──────────────┬────────────┬─────────────┬──────────────────┐
│ 算法         │ 校验和长度 │ 碰撞概率    │ 引入内核版本     │
├──────────────┼────────────┼─────────────┼──────────────────┤
│ crc32c       │ 4 字节     │ 1/2³²       │ 2.6.29（默认）   │
│ xxhash64     │ 8 字节     │ 1/2⁶⁴       │ 5.5              │
│ sha256       │ 32 字节    │ 极低        │ 5.5              │
│ blake2b-256  │ 32 字节    │ 极低        │ 5.5              │
└──────────────┴────────────┴─────────────┴──────────────────┘
```

            
```
# 创建使用 xxhash64 校验的文件系统
mkfs.btrfs --csum xxhash64 /dev/sda1

# 创建使用 blake2b 校验的文件系统
mkfs.btrfs --csum blake2b /dev/sda1

# 查看当前文件系统使用的校验算法
btrfs inspect-internal dump-super /dev/sda1 | grep csum_type
```

            

### 6.2 校验和的存储与验证

            

校验和存储在专门的校验树（Checksum
            Tree）中。每次读取数据块时，Btrfs
            会重新计算校验和并与存储的值比较：
            
```
数据读取校验流程：

1. 应用请求读取文件 offset 0-4KB
2. Btrfs 在 FS Tree 中找到对应的数据区段（Extent）引用
3. 从磁盘读取数据块
4. 从校验树中查找该数据块的存储校验和
5. 计算读取数据的校验和
6. 比较两个校验和：
   - 匹配：返回数据给应用
   - 不匹配：报告 I/O 错误（或尝试自修复）
```

            

对于元数据块，校验和直接存储在节点头部的
            `csum` 字段中，不需要查询校验树。
            

### 6.3
            Scrub：主动数据完整性检查

            

Scrub 是 Btrfs
            的主动数据完整性验证工具。它会读取文件系统中的每个数据块和元数据块，验证校验和，并报告（或修复）发现的错误：
            
```
# 启动 scrub（后台运行）
btrfs scrub start /mnt/btrfs

# 查看 scrub 状态
btrfs scrub status /mnt/btrfs
```

            

输出示例：
            
```
UUID:             12345678-abcd-efgh-ijkl-1234567890ab
Scrub started:    Sun Aug 25 02:00:00 2025
Status:           finished
Duration:         0:15:32
Total to scrub:   150.30GiB
Rate:             165.83MiB/s
Error summary:    csum=2
  Corrected:      2
  Uncorrectable:  0
```

            
```
# 暂停和恢复 scrub
btrfs scrub cancel /mnt/btrfs
btrfs scrub resume /mnt/btrfs

# 设置定时 scrub（systemd timer）
systemctl enable btrfs-scrub@-.timer        # 根文件系统
systemctl enable btrfs-scrub@mnt-data.timer # /mnt/data
```

            

### 6.4 自修复（Self-healing）

            

在多副本配置（RAID-1、RAID-1c3、RAID-10 等）下，Btrfs
            可以自动修复损坏的数据块：
            
```
自修复流程：

1. 读取数据块 X 的副本 A
2. 校验和不匹配 → 副本 A 损坏
3. 读取数据块 X 的副本 B（位于另一块磁盘）
4. 校验和匹配 → 副本 B 正确
5. 用副本 B 的内容覆盖副本 A → 修复完成
6. 返回正确数据给应用
7. 写入内核日志：BTRFS info: read error corrected
```

            
```
# 模拟数据损坏并验证自修复（仅用于测试）
# 先创建一个 RAID-1 文件系统
mkfs.btrfs -d raid1 -m raid1 /dev/sdb /dev/sdc
mount /dev/sdb /mnt/test

# 写入测试文件
dd if=/dev/urandom of=/mnt/test/testfile bs=1M count=100
sync

# 记录文件的校验和
sha256sum /mnt/test/testfile > /mnt/test/checksum.txt

# 卸载文件系统
umount /mnt/test

# 在一块盘上制造损坏（覆盖部分数据区域）
dd if=/dev/zero of=/dev/sdb bs=1M count=10 seek=500

# 重新挂载并验证
mount /dev/sdb /mnt/test
sha256sum -c /mnt/test/checksum.txt
# 应输出：testfile: OK（Btrfs 自动从 /dev/sdc 读取了正确数据）

# 运行 scrub 修复损坏的副本
btrfs scrub start -B /mnt/test
```

            

### 6.5
            数据完整性与硬件层的关系

            

Btrfs 的校验和可以检测到以下类型的数据损坏：
            
            
- **位翻转（Bit
            Rot）**：磁盘介质老化导致的静默数据损坏；
            
- **固件缺陷（Firmware
            Bug）**：磁盘控制器错误地写入或读取数据；
            
- **幻影写入（Phantom
            Write）**：磁盘报告写入成功但实际未写入；
            
- **错位写入（Misdirected
            Write）**：数据被写到了错误的位置。
            
            

但 Btrfs 的校验和**无法**防范：
            
            
- **内存错误（Memory Error）**：如果 RAM
            中的数据在写入磁盘前就已损坏，Btrfs
            会为损坏的数据计算一个”正确的”校验和。使用 ECC
            内存（Error-Correcting Code
            Memory）是防范这类问题的正确做法。
            
            
            

## 七、Send/Receive
            增量同步

            

### 7.1 Send/Receive 概述

            

`btrfs send` 和 `btrfs receive` 是
            Btrfs 内置的增量备份机制。`send`
            将一个只读快照序列化为一个数据流（Stream），`receive`
            在目标端将这个数据流还原为一个只读快照。
            
```
Send/Receive 工作原理：

源端：                              目标端：
                                   
 @data ──快照──→ snap_new           
     │           │                  snap_new'
     │       btrfs send ──→ [数据流] ──→ btrfs receive
     │           │                      │
     └──快照──→ snap_old ·· 参照 ··→ snap_old'
```

            

### 7.2 全量发送

            
```
# 创建只读快照
btrfs subvolume snapshot -r /mnt/source/@data \
    /mnt/source/@snapshots/data-snap-001

# 全量发送到本地目标
btrfs send /mnt/source/@snapshots/data-snap-001 | \
    btrfs receive /mnt/backup/

# 全量发送到远程主机
btrfs send /mnt/source/@snapshots/data-snap-001 | \
    ssh backup-server "btrfs receive /mnt/backup/"

# 发送到文件（离线传输）
btrfs send /mnt/source/@snapshots/data-snap-001 \
    -f /mnt/external/backup-001.btrfs
```

            

### 7.3 增量发送

            

增量发送是 `btrfs send`
            的精髓。它通过比较两个快照之间的差异，只发送变化的数据：
            
```
# 第一次：全量发送
btrfs subvolume snapshot -r /mnt/source/@data \
    /mnt/source/@snapshots/data-snap-001
btrfs send /mnt/source/@snapshots/data-snap-001 | \
    btrfs receive /mnt/backup/

# 后续：增量发送
btrfs subvolume snapshot -r /mnt/source/@data \
    /mnt/source/@snapshots/data-snap-002
btrfs send -p /mnt/source/@snapshots/data-snap-001 \
    /mnt/source/@snapshots/data-snap-002 | \
    btrfs receive /mnt/backup/

# 再次增量
btrfs subvolume snapshot -r /mnt/source/@data \
    /mnt/source/@snapshots/data-snap-003
btrfs send -p /mnt/source/@snapshots/data-snap-002 \
    /mnt/source/@snapshots/data-snap-003 | \
    btrfs receive /mnt/backup/
```

            

`-p`（parent）参数指定父快照。`btrfs send`
            会利用 B-Tree
            的代（Generation）信息，快速定位两个快照之间新增、修改和删除的数据。这比
            rsync
            的逐文件比较高效得多，因为它在文件系统元数据层面操作，不需要遍历所有文件。
            

### 7.4 增量同步的效率分析

            
```
假设场景：
- 源文件系统总数据量：500 GiB
- 两次快照之间修改了 2 GiB 数据
- 新增了 1000 个小文件（总计 500 MiB）
- 删除了 200 个文件

rsync 全量比较：
- 需要读取源端和目标端所有文件的元数据
- 对于修改的文件，需要计算校验和比较
- 耗时：约 30 分钟（大部分时间花在文件遍历和校验上）

btrfs send 增量：
- 只比较 B-Tree 中 generation 变化的节点
- 直接定位到修改的数据块
- 耗时：约 2 分钟（主要是传输 2.5 GiB 的数据）
```

            

### 7.5 自动化备份脚本

            
```
#!/bin/bash
# btrfs-backup.sh - 自动化增量备份脚本

SOURCE_VOL="/mnt/data/@important"
SNAP_DIR="/mnt/data/@snapshots"
BACKUP_DIR="/mnt/backup"
DATE=$(date +%Y%m%d-%H%M%S)
SNAP_NAME="important-${DATE}"
RETENTION=30  # 保留最近 30 个快照

# 创建新的只读快照
btrfs subvolume snapshot -r "${SOURCE_VOL}" "${SNAP_DIR}/${SNAP_NAME}"

# 找到上一个快照作为父快照
PREV_SNAP=$(ls -1d "${SNAP_DIR}"/important-* 2>/dev/null | \
    sort | tail -2 | head -1)

if [ "${PREV_SNAP}" = "${SNAP_DIR}/${SNAP_NAME}" ]; then
    # 没有上一个快照，全量发送
    echo "全量发送：${SNAP_NAME}"
    btrfs send "${SNAP_DIR}/${SNAP_NAME}" | \
        btrfs receive "${BACKUP_DIR}/"
else
    # 增量发送
    echo "增量发送：${SNAP_NAME}（基于 $(basename ${PREV_SNAP})）"
    btrfs send -p "${PREV_SNAP}" "${SNAP_DIR}/${SNAP_NAME}" | \
        btrfs receive "${BACKUP_DIR}/"
fi

# 清理过期快照（源端和目标端同步清理）
ls -1d "${SNAP_DIR}"/important-* | sort | head -n -${RETENTION} | \
    while read snap; do
        echo "删除过期快照：$(basename ${snap})"
        btrfs subvolume delete "${snap}"
        btrfs subvolume delete "${BACKUP_DIR}/$(basename ${snap})" \
            2>/dev/null
    done

echo "备份完成：${SNAP_NAME}"
```

            

### 7.6 Send/Receive 的限制

            
            
- **只读快照**：`btrfs send`
            只能发送只读快照。如果需要在目标端修改数据，需要先创建一个可写快照；
            
- **父快照依赖**：增量发送的目标端必须存在对应的父快照。如果父快照被删除，只能重新全量发送；
            
- **不跨文件系统**：send 流是 Btrfs
            特有格式，目标必须是 Btrfs 文件系统；
            
- **UUID 匹配**：目标端的父快照 UUID
            必须与源端的 `Received UUID` 匹配。
            
            
            

## 八、碎片化与空间管理

            

### 8.1 CoW 碎片化的成因

            

CoW
            文件系统天然容易产生碎片化（Fragmentation）。原因很直观：文件的初始写入可能是顺序的，但后续修改总是分配新块，这些新块可能分布在磁盘的任意位置。
            
```
文件初始写入（顺序）：
Block: [100][101][102][103][104][105][106][107]

经过多次修改后（碎片化）：
Block: [100][205][102][310][104][450][106][520]
      原始块 ^新块 原始块  ^新块 原始块  ^新块
```

            

碎片化对 HDD 的影响远大于 SSD。HDD
            的随机读取需要磁头寻道，碎片化导致大量寻道操作，严重降低顺序读取性能。SSD
            没有机械寻道，碎片化的影响主要体现在 I/O
            请求合并效率的降低。
            

### 8.2 autodefrag 挂载选项

            

`autodefrag` 是 Btrfs
            内置的自动碎片整理（Automatic Defragmentation）机制：
            
```
# 启用自动碎片整理
mount -t btrfs -o autodefrag /dev/sda1 /mnt

# 在 /etc/fstab 中启用
# /dev/sda1  /mnt  btrfs  defaults,autodefrag  0 0
```

            

`autodefrag`
            的工作原理：在每次数据提交时，检测到碎片化的区段（Extent），将其标记为需要整理。一个内核后台线程会定期处理这些标记，将碎片化的小区段合并为连续的大区段。
            

注意：`autodefrag`
            适合频繁小写入的工作负载（如数据库、虚拟机磁盘），但对于大文件顺序写入的场景（如日志文件），它的开销大于收益。
            

### 8.3 手动碎片整理

            
```
# 对单个文件进行碎片整理
btrfs filesystem defragment /mnt/data/database.db

# 对目录递归进行碎片整理
btrfs filesystem defragment -r /mnt/data/

# 碎片整理时同时设置压缩
btrfs filesystem defragment -r -czstd /mnt/data/

# 控制碎片整理的目标区段大小
btrfs filesystem defragment -t 32M /mnt/data/database.db
```

            

**重要警告**：碎片整理会破坏快照之间的数据共享。碎片整理后，原本快照和当前数据共享的块会变成各自独立的副本，导致空间使用量暴增。如果依赖快照节省空间，谨慎使用碎片整理。
            

### 8.4 Balance：块组重新分配

            

Balance 操作重新分配块组（Block
            Group）中的数据。它的主要用途是：
            
            
- **转换 RAID 配置档案**：如从 single 转换为
            raid1；
            
- **平衡多设备间的数据分布**：添加新设备后，让数据均匀分布；
            
- **回收未充分利用的块组**：释放大量删除后留下的空闲块组。
            
            
```
# 全量 balance（非常耗时，不推荐）
btrfs balance start /mnt/btrfs

# 只平衡使用率低于 50% 的数据块组
btrfs balance start -dusage=50 /mnt/btrfs

# 只平衡使用率低于 30% 的元数据块组
btrfs balance start -musage=30 /mnt/btrfs

# 转换 RAID 配置
btrfs balance start -dconvert=raid1 -mconvert=raid1 /mnt/btrfs

# 查看 balance 进度
btrfs balance status /mnt/btrfs

# 暂停和恢复 balance
btrfs balance pause /mnt/btrfs
btrfs balance resume /mnt/btrfs

# 取消 balance
btrfs balance cancel /mnt/btrfs
```

            

### 8.5 Space Cache
            v2（Free Space Tree）

            

Btrfs 需要快速知道哪些磁盘空间是空闲的。早期版本使用
            space_cache
            v1，它在每个块组开头存储一个空闲空间位图（Bitmap）。这种方式的问题是：在大型文件系统上，加载空闲空间缓存可能需要很长时间。
            

Space Cache v2（也叫 Free Space Tree）使用一棵专门的
            B-Tree 来管理空闲空间信息。它的优势：
            
            
- **快速挂载**：不需要扫描每个块组的位图；
            
- **事务安全**：空闲空间信息也纳入 CoW
            事务保护；
            
- **可扩展**：适用于 PB 级文件系统。
            
            
```
# 创建文件系统时启用 space_cache v2（现代内核默认启用）
mkfs.btrfs -O free-space-tree /dev/sda1

# 在挂载时从 v1 迁移到 v2
mount -t btrfs -o clear_cache,space_cache=v2 /dev/sda1 /mnt

# 查看是否启用了 space_cache v2
btrfs inspect-internal dump-super /dev/sda1 | grep FREE_SPACE_TREE
```

            

### 8.6 空间使用的查看与分析

            
```
# 查看文件系统整体使用情况
btrfs filesystem usage /mnt/btrfs
```

            

输出示例：
            
```
Overall:
    Device size:                 200.00GiB
    Device allocated:             85.03GiB
    Device unallocated:          114.97GiB
    Device missing:                  0.00B
    Device slack:                    0.00B
    Used:                         60.15GiB
    Free (estimated):            135.42GiB      (min: 77.94GiB)
    Free (statfs, df):           135.42GiB
    Data ratio:                       1.00
    Metadata ratio:                   2.00
    Global reserve:              256.00MiB      (used: 0.00B)
    Multiple profiles:                  no

Data,single: Size:80.00GiB, Used:58.20GiB (72.75%)
   /dev/sdb       80.00GiB

Metadata,DUP: Size:2.00GiB, Used:960.50MiB (46.90%)
   /dev/sdb        4.00GiB

System,DUP: Size:8.00MiB, Used:16.00KiB (0.20%)
   /dev/sdb       16.00MiB

Unallocated:
   /dev/sdb      114.97GiB
```

            

注意 `Device allocated` 和 `Used`
            的区别：Btrfs
            先将磁盘空间分配为块组，再在块组内分配给文件。`allocated`
            是已分配的块组总量，`Used`
            是块组内实际使用的量。如果出现”磁盘空间不足”但
            `df`
            显示还有空间，可能是块组分配策略的问题，需要运行
            `btrfs balance` 回收空闲块组。
            
            

## 九、Btrfs 管理实战

            

### 9.1 文件系统创建与挂载

            
```
# 基本创建
mkfs.btrfs /dev/sda1

# 指定标签和节点大小
mkfs.btrfs -L mydata -n 16k /dev/sda1

# 指定校验算法
mkfs.btrfs --csum xxhash64 /dev/sda1

# 混合模式（适合小型设备，数据和元数据混合存储）
mkfs.btrfs -M /dev/sda1

# 推荐的挂载选项
mount -t btrfs -o compress=zstd:3,space_cache=v2,noatime /dev/sda1 /mnt
```

            

推荐的 `/etc/fstab` 配置：
            
```
# Btrfs 根分区推荐挂载选项
UUID=xxx  /      btrfs  defaults,subvol=@,compress=zstd:3,noatime,space_cache=v2  0 0
UUID=xxx  /home  btrfs  defaults,subvol=@home,compress=zstd:3,noatime             0 0
UUID=xxx  /var   btrfs  defaults,subvol=@var,compress=zstd:3,noatime              0 0
```

            

### 9.2 子卷管理命令汇总

            
```
# 创建子卷
btrfs subvolume create /mnt/@data

# 列出子卷
btrfs subvolume list /mnt
btrfs subvolume list -a /mnt          # 包括绝对路径
btrfs subvolume list -t /mnt          # 表格格式
btrfs subvolume list -s /mnt          # 只列出快照

# 查看子卷信息
btrfs subvolume show /mnt/@data

# 删除子卷
btrfs subvolume delete /mnt/@data
btrfs subvolume delete -c /mnt/@data  # 提交后再返回（确保空间立即释放）

# 设置默认子卷
btrfs subvolume set-default 256 /mnt

# 获取默认子卷
btrfs subvolume get-default /mnt
```

            

### 9.3 快照管理命令汇总

            
```
# 创建只读快照
btrfs subvolume snapshot -r /mnt/@data /mnt/@snapshots/data-$(date +%Y%m%d)

# 创建可写快照
btrfs subvolume snapshot /mnt/@data /mnt/@snapshots/data-writable

# 从快照回滚
# 方法1：重命名子卷
mv /mnt/@data /mnt/@data.broken
btrfs subvolume snapshot /mnt/@snapshots/data-20250825 /mnt/@data

# 方法2：删除旧子卷，从快照创建新子卷
btrfs subvolume delete /mnt/@data
btrfs subvolume snapshot /mnt/@snapshots/data-20250825 /mnt/@data
```

            

### 9.4 文件系统维护命令

            
```
# 查看文件系统信息
btrfs filesystem show             # 所有 Btrfs 文件系统
btrfs filesystem show /mnt        # 指定挂载点
btrfs filesystem df /mnt          # 空间分配详情
btrfs filesystem usage /mnt       # 详细空间使用报告
btrfs filesystem du /mnt/somedir  # 目录空间使用（考虑共享区段）

# 在线调整大小
btrfs filesystem resize +50G /mnt   # 扩展 50G
btrfs filesystem resize -20G /mnt   # 缩减 20G
btrfs filesystem resize max /mnt    # 扩展到设备最大容量

# 标签管理
btrfs filesystem label /mnt "my-data"
btrfs filesystem label /mnt           # 查看标签
```

            

### 9.5 设备管理命令

            
```
# 查看设备统计（I/O 错误计数）
btrfs device stats /mnt
```

            

输出示例：
            
```
[/dev/sdb].write_io_errs    0
[/dev/sdb].read_io_errs     0
[/dev/sdb].flush_io_errs    0
[/dev/sdb].corruption_errs  0
[/dev/sdb].generation_errs  0
```

            
```
# 重置错误计数
btrfs device stats -z /mnt

# 添加设备
btrfs device add /dev/sdc /mnt

# 移除设备
btrfs device remove /dev/sdb /mnt
btrfs device remove missing /mnt  # 移除已丢失的设备

# 替换设备
btrfs replace start /dev/sdb /dev/sdd /mnt
btrfs replace status /mnt
btrfs replace cancel /mnt
```

            

### 9.6 配额管理

            
```
# 启用配额
btrfs quota enable /mnt

# 查看配额组
btrfs qgroup show /mnt
btrfs qgroup show -reF /mnt  # 人类可读格式，包含独占空间

# 设置配额限制
btrfs qgroup limit 50G 0/256 /mnt      # 限制子卷 256 使用 50G
btrfs qgroup limit none 0/256 /mnt     # 取消限制

# 禁用配额
btrfs quota disable /mnt
```

            

**注意**：Btrfs
            的配额功能（qgroup）在历史上有性能问题，特别是在频繁创建和删除快照的场景。从
            Linux 6.1 开始（引入
            squota——简单配额），性能有了显著改善。在启用配额之前，建议评估对工作负载的影响。
            

### 9.7 检查与修复

            
```
# 检查文件系统（需要先卸载）
btrfs check /dev/sda1

# 只读模式检查（默认，安全）
btrfs check --readonly /dev/sda1

# 低内存模式检查（适合内存不足的系统）
btrfs check --mode=lowmem /dev/sda1

# 修复模式（谨慎使用，建议先备份）
btrfs check --repair /dev/sda1

# 抢救数据（当文件系统严重损坏时）
btrfs rescue super-recover /dev/sda1  # 恢复超级块
btrfs rescue chunk-recover /dev/sda1  # 恢复块映射
btrfs restore /dev/sda1 /mnt/rescue/  # 提取可恢复的文件
```

            

### 9.8 性能调优选项

            
```
# 推荐的挂载选项组合（SSD）
mount -t btrfs -o noatime,compress=zstd:3,space_cache=v2,discard=async /dev/nvme0n1p1 /mnt

# 推荐的挂载选项组合（HDD）
mount -t btrfs -o noatime,compress=zstd:3,space_cache=v2,autodefrag /dev/sda1 /mnt
```

            

挂载选项详解：
            
```
┌──────────────────┬──────────────────────────────────────────────────┐
│ 选项             │ 说明                                             │
├──────────────────┼──────────────────────────────────────────────────┤
│ noatime          │ 不更新访问时间戳，减少元数据写入                 │
│ compress=zstd:3  │ 使用 zstd 压缩，级别 3                          │
│ space_cache=v2   │ 使用 Free Space Tree，加快空闲空间查找           │
│ discard=async    │ 异步 TRIM，适用于 SSD                           │
│ autodefrag       │ 自动碎片整理，适用于 HDD 或小写入工作负载       │
│ commit=120       │ 事务提交间隔（秒），增大可提高吞吐但增加风险    │
│ ssd              │ 针对 SSD 优化（通常自动检测）                   │
│ nossd            │ 禁用 SSD 优化                                   │
│ thread_pool=N    │ 工作线程数，默认为 min(CPU数, 8)                │
│ max_inline=2048  │ 内联数据的最大大小（字节）                      │
└──────────────────┴──────────────────────────────────────────────────┘
```

            

### 9.9 监控与告警

            
```
# 使用 btrfs device stats 监控磁盘错误
#!/bin/bash
# btrfs-monitor.sh - 监控 Btrfs 设备错误

MOUNTPOINT="/mnt/data"
ALERT_THRESHOLD=0

errors=$(btrfs device stats "${MOUNTPOINT}" 2>/dev/null | \
    awk -F' ' '{sum += $NF} END {print sum}')

if [ "${errors}" -gt "${ALERT_THRESHOLD}" ]; then
    echo "警告：Btrfs 设备在 ${MOUNTPOINT} 上检测到 ${errors} 个错误"
    btrfs device stats "${MOUNTPOINT}"
    # 可以在此处添加邮件或消息通知
fi
```

            
```
# 通过 sysfs 查看 Btrfs 运行时信息
cat /sys/fs/btrfs/*/allocation/data/total_bytes
cat /sys/fs/btrfs/*/allocation/data/bytes_used
cat /sys/fs/btrfs/*/allocation/metadata/total_bytes
cat /sys/fs/btrfs/*/allocation/metadata/bytes_used
```

            
            

## 十、Btrfs 生产评估

            

### 10.1 SUSE 的选择

            

SUSE Linux Enterprise Server（SLES）从 12 版开始将 Btrfs
            作为系统分区的默认文件系统。SUSE
            的方案有几个值得注意的设计决策：
            
            
- **根分区用 Btrfs，数据分区用 XFS**：SUSE
            建议将 `/` 放在 Btrfs
            上（利用快照做系统回滚），将 `/home`
            和数据库等大数据目录放在 XFS 上；
            
- **Snapper 集成**：SUSE 开发了 Snapper
            工具，自动在
            `zypper`（软件包管理器）操作前后创建快照，系统升级出问题可以一键回滚；
            
- **只使用稳定功能**：SUSE 明确不支持
            RAID-5/6，推荐使用 RAID-1 或外部 RAID。
            
            
```
# SUSE Snapper 典型操作
snapper list                    # 列出所有快照
snapper create -d "before update" # 手动创建快照
snapper rollback 42             # 回滚到快照 42
snapper diff 41..42             # 查看两个快照之间的差异
```

            

### 10.2 Facebook/Meta
            的大规模使用

            

Facebook（现 Meta）是 Btrfs 最大的企业级用户之一。Chris
            Mason 在离开 Oracle 后加入 Facebook，继续推动 Btrfs
            的开发。Facebook 的使用方式：
            
            
- **操作系统分区**：所有服务器的
            `/` 分区使用 Btrfs，利用压缩节省 SSD
            空间，利用快照加速系统部署和回滚；
            
- **压缩节省成本**：zstd 压缩在典型 Web
            服务器上可以节省 20-30% 的 SSD
            空间，在百万台服务器的规模下，这意味着巨大的成本节约；
            
- **不使用 Btrfs RAID**：Facebook
            的存储冗余在应用层解决（如 HDFS、RocksDB
            的多副本），文件系统层面使用 Btrfs single 配置；
            
- **深度参与内核开发**：Facebook 的工程师是
            Btrfs
            内核代码的主要贡献者之一，许多稳定性改进来自他们的生产环境反馈。
            
            

### 10.3 Fedora 桌面的采用

            

Fedora 从 33 版（2020 年发布）开始将 Btrfs
            作为桌面安装的默认文件系统。其方案的要点：
            
            
- **透明压缩**：默认启用
            `compress=zstd:1`；
            
- **平级子卷布局**：`@`（根）和
            `@home` 作为平级子卷；
            
- **不使用 Btrfs
            RAID**：桌面系统通常是单盘配置。
            
            

### 10.4 已知局限性

            

尽管 Btrfs 已经相当成熟，但仍有一些需要注意的局限：
            
```
┌────────────────────────┬────────────────────────────────────────────────┐
│ 局限                   │ 详情                                           │
├────────────────────────┼────────────────────────────────────────────────┤
│ RAID-5/6 不稳定        │ 写洞问题未解决，生产环境不可用                 │
│ 碎片化                 │ CoW 导致碎片化，对 HDD 随机读性能影响显著      │
│ 数据库工作负载         │ 随机小写入 + CoW = 严重碎片化和写放大           │
│ 配额性能               │ qgroup 在大量快照时开销显著（6.1 后改善）       │
│ reflink 跨子卷不支持   │ cp --reflink 不能跨子卷使用                    │
│ swap 文件限制          │ 交换文件需要特殊设置（nodatacow, 固定大小）     │
│ NFS 导出               │ 子卷导出需要特殊配置                           │
│ fsck 能力              │ btrfs check --repair 功能不如 e2fsck 成熟      │
└────────────────────────┴────────────────────────────────────────────────┘
```

            

### 10.5 Btrfs
            上的数据库工作负载

            

数据库（特别是像 MySQL InnoDB、PostgreSQL
            这样的传统关系数据库）通常不适合直接运行在 Btrfs
            上。原因：
            
            
- 数据库自己管理数据文件的物理布局，CoW
            会破坏这种布局优化；
            
- 随机小写入 + CoW = 大量碎片化 + 写放大；
            
- 数据库自己有 WAL（预写日志），不需要文件系统层面的 CoW
            保护。
            
            

如果必须在 Btrfs 上运行数据库，建议的做法：
            
```
# 为数据库数据目录禁用 CoW
chattr +C /var/lib/mysql/
chattr +C /var/lib/postgresql/

# 或者在创建目录时就设置 NOCOW
mkdir /var/lib/mysql
chattr +C /var/lib/mysql
# 注意：chattr +C 只对空目录或新文件生效
```

            

`+C`
            标志（NOCOW）禁用了该目录下新文件的写时复制。这意味着这些文件会被就地更新，失去了
            CoW
            的保护（校验和也会被禁用），但避免了碎片化和写放大。这本质上是让文件系统在该目录下退化为类似
            ext4 的行为。
            

### 10.6 Btrfs
            上的虚拟机磁盘镜像

            

虚拟机磁盘镜像（如 QCOW2、raw
            格式）面临与数据库类似的问题。但 Btrfs
            提供了一些针对性的优化：
            
```
# 方法1：为 VM 磁盘目录设置 NOCOW
chattr +C /var/lib/libvirt/images/

# 方法2：使用 reflink 快速克隆 VM 镜像
cp --reflink=always base.qcow2 vm-clone-01.qcow2
cp --reflink=always base.qcow2 vm-clone-02.qcow2
# 两个克隆共享 base 的所有数据块，只有修改部分占用额外空间
```

            

`reflink` 复制是 Btrfs
            的一个强大功能。它创建文件的”浅拷贝”——新文件和原文件共享所有数据块，只有后续修改的部分才分配新空间。这对于
            VM 模板部署非常高效。
            

### 10.7 什么时候用 Btrfs

            
```
推荐使用 Btrfs 的场景：
✓ 需要文件系统级快照和回滚（如桌面系统、开发环境）
✓ 需要透明压缩节省空间（如日志服务器、构建服务器）
✓ 需要数据完整性校验（如长期存档）
✓ 需要灵活的多设备存储池（小规模 NAS）
✓ 需要增量备份（btrfs send/receive）
✓ 使用 SUSE Linux Enterprise（官方推荐和支持）

不推荐使用 Btrfs 的场景：
✗ 需要 RAID-5/6 级别的容错
✗ 高性能数据库工作负载（PostgreSQL、MySQL 等）
✗ 对文件系统修复工具的成熟度有严格要求
✗ 需要极致的顺序 I/O 性能（如大型视频文件存储）
✗ 生产环境的关键数据且团队没有 Btrfs 运维经验
```

            

### 10.8 Btrfs 与 ZFS
            的选型对比

            
```
┌──────────────────┬──────────────────────┬──────────────────────┐
│ 维度             │ Btrfs                │ ZFS                  │
├──────────────────┼──────────────────────┼──────────────────────┤
│ 内核集成         │ 原生内核模块         │ 外部模块（许可证）   │
│ 许可证           │ GPLv2                │ CDDL（与 GPL 不兼容）│
│ RAID 稳定性      │ 1/10 稳定，5/6 不可用│ RAID-Z1/Z2/Z3 成熟  │
│ 压缩             │ zstd/lzo/zlib        │ lz4/zstd/gzip        │
│ 快照             │ 可写快照             │ 只读快照+克隆        │
│ 发送/接收        │ 支持                 │ 支持                 │
│ 去重             │ 离线去重（慢）       │ 在线/离线去重        │
│ 缓存层           │ 无                   │ ARC/L2ARC/SLOG       │
│ 内存需求         │ 低                   │ 高（推荐 1GB/TB）    │
│ 社区             │ Linux 内核社区       │ OpenZFS 社区         │
│ 企业支持         │ SUSE                 │ Ubuntu（Canonical）  │
│ 成熟度           │ 逐步成熟             │ 非常成熟（20+ 年）   │
└──────────────────┴──────────────────────┴──────────────────────┘
```

            

简单总结：如果你在 Linux
            上需要一个与内核深度集成、许可证无争议、功能丰富的现代文件系统，且不需要
            RAID-5/6，Btrfs
            是自然的选择。如果你需要企业级存储池管理、成熟的
            RAID-Z、丰富的缓存层，且不介意外部内核模块和较高的内存开销，ZFS
            更合适。
            

### 10.9 Btrfs 的发展方向

            

截至 2025 年，Btrfs 社区正在积极推进的方向包括：
            
            
- **RAID-5/6
            写洞修复**：虽然进展缓慢，但仍然是长期目标；
            
- **extent tree
            v2**：重新设计区段树，解决大型文件系统的扩展性问题；
            
- **带区（Zoned）设备支持**：适配 ZNS（Zoned
            Namespace）SSD 和 SMR（Shingled Magnetic
            Recording）HDD；
            
- **在线
            fsck**：不需要卸载文件系统即可进行一致性检查；
            
- **简单配额（squota）**：更高效的配额实现，减少性能开销。
            
            
            

## 附：参考资料

            
            
- Btrfs Wiki 官方文档：https://btrfs.wiki.kernel.org/
            
- Btrfs 内核文档：https://www.kernel.org/doc/html/latest/filesystems/btrfs.html
            
- Btrfs 设计文档（原始）：https://btrfs.wiki.kernel.org/index.php/Design_notes
            
- Chris Mason, “Btrfs: The Linux B-Tree Filesystem”, Linux
            Plumbers Conference, 2008
            
- Btrfs 源码（Linux 内核）：https://github.com/torvalds/linux/tree/master/fs/btrfs
            
- SUSE Btrfs 管理指南：https://documentation.suse.com/sles/15-SP5/html/SLES-all/cha-snapper.html
            
- Facebook/Meta Btrfs 使用报告：https://facebookmicrosites.github.io/btrfs/
            
- Fedora Btrfs 变更提案：https://fedoraproject.org/wiki/Changes/BtrfsByDefault
            
- zstd 压缩算法：https://facebook.github.io/zstd/
            
- compsize 工具：https://github.com/kilobyte/compsize
            
- Btrfs Scrub 文档：https://btrfs.readthedocs.io/en/latest/btrfs-scrub.html
            
- Btrfs Send/Receive 协议：https://btrfs.readthedocs.io/en/latest/btrfs-send.html
            
- Btrfs 挂载选项详解：https://btrfs.readthedocs.io/en/latest/Administration.html
            
- Btrfs 常见问题：https://btrfs.wiki.kernel.org/index.php/FAQ
            
- Josef Bacik, “Btrfs: The Linux B-tree Filesystem”, Linux
            Storage, Filesystem, and Memory-Management Summit, 2023
            
            
            

**上一篇**: XFS
            架构：大文件与高并发 **下一篇**: ZFS：数据完整性优先的存储栈
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-01 · storage
                    

### 【存储工程】存储快照与精简配置

                    

存储系统有两个看似独立、实则紧密交织的能力：快照（Snapshot）和精简配置（Thin Provisioning）。快照解决的是"时间维度"的问题——在任意时刻冻结数据状态，用于备份、回滚或测试；精简配置解决的是"空间维度"的问题——让存储容量按需分配，避免预先占满物理磁盘。两者的交叉点在于写时复制（Copy-on-…
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】列式编码与压缩

                    

拆解 Parquet 的两层缩减：专用编码（dictionary / RLE / DELTA_BINARY_PACKED / BYTE_STREAM_SPLIT）降熵，再用 zstd/snappy/lz4/gzip 压字节。用 pyarrow 在同一列上实测不同编码+压缩组合的体积与读取耗时（3M 行，7 轮中位数），并与 ClickHouse CODEC 做同思想不同落地的对照。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Iceberg 元数据树

                    

拆解 Iceberg 的四层元数据：catalog 指针 → metadata.json → manifest list（snapshot）→ manifest file → data file。讲清 snapshot 与 manifest 里的分区数据和列级 stats（lower/upper bound、null/value count）如何让一次查询不 list 目录就收敛到文件集合，并给出表规范 V1/V2/V3 的版本边界。基于 pyiceberg 0.11.1 真实建表逐层 dump。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】时间旅行、Schema 与分区演进

                    

讲清 Iceberg 的 snapshot 过期、回滚与按时间/快照读如何工作；schema evolution 为何按 field ID 而非位置来增删改名重排；以及演进对老数据文件与老 reader 的兼容边界与陷阱，附 PyIceberg 真实实验验证字段映射与时间旅行。