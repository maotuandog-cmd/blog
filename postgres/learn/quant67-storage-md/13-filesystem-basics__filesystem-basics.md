# 【存储工程】文件系统基础：inode、目录与 VFS

来源: https://quant67.com/post/storage/13-filesystem-basics/filesystem-basics.html
日期: 2025-08-22 |

---

磁盘是一个线性的块数组，但没有人愿意用”第 48372
            号扇区”来定位自己的文档。文件系统（File
            System）就是那个把”名字”映射到”数据”的翻译层——它把一片平坦的块空间组织成人类可以理解的层级结构，同时维护着每个文件的权限、大小、时间戳等元数据（Metadata）。
            

这件事听起来简单，做起来却远比想象中复杂。文件系统需要在一块可能随时断电的磁盘上维护复杂的树状数据结构；需要处理数百万个目录项（Directory
            Entry）的高效查找；需要让同一个文件被多个进程同时读写而不出错；还需要在不同的存储介质和不同的文件系统实现之间，向用户态程序提供一套统一的接口。
            

本文从文件系统的核心抽象讲起，逐层拆解超级块（Superblock）、inode、数据块寻址、目录结构、VFS
            层的设计，再到硬链接（Hard Link）与符号链接（Symbolic
            Link）的实现细节，最后落到实际的调试工具和常见故障排查。所有代码引用基于
            Linux 6.1 内核，命令示例在 ext4
            文件系统上验证，部分内容对比了 XFS 和 Btrfs 的实现差异。
            
            

## 一、文件系统的核心抽象

            

### 1.1 从块设备到文件

            

一块裸磁盘（Raw Block
            Device）在操作系统看来就是一个巨大的字节数组。你可以用逻辑块地址（Logical
            Block
            Address，LBA）精确访问任何位置的数据，但仅此而已——没有名字、没有层级、没有权限控制。文件系统的存在就是为了在这个平坦的地址空间之上，构建出人类和程序都能使用的抽象层。
            

文件系统做的核心事情可以概括为一个映射关系：
            
```
路径名（Path Name） → 数据块（Data Blocks） + 元数据（Metadata）

例如：
/home/ltl/notes.txt → 磁盘上的第 10240、10241、10242 号块
                     + 权限 0644、属主 uid=1000、大小 12288 字节
                     + 创建时间、修改时间、访问时间
```

            

这个映射关系看似简单，但支撑它的底层机制——inode
            表、目录树、块分配器、日志系统——构成了文件系统工程的核心复杂度。
            

### 1.2 三个核心抽象

            

所有主流文件系统，无论是 ext4、XFS、Btrfs 还是
            NTFS，都围绕三个核心抽象构建：
            

**文件（File）**：一段有名字的数据序列，附带元数据。文件是用户视角的基本单位。在
            Unix
            的设计哲学中，“一切皆文件”——普通文件、设备、管道（Pipe）、套接字（Socket）都被抽象为文件。
            

**目录（Directory）**：一种特殊的文件，其内容是”名字
            → inode
            编号”的映射表。目录通过嵌套构成了树状的命名空间。
            

**路径（Path）**：从根目录 `/`
            开始，通过一系列目录名到达目标文件的字符串表示。路径解析（Path
            Resolution）是文件系统最频繁的操作之一。
            
```
文件系统的层级结构：

/                          ← 根目录（inode 2）
├── etc/                   ← 目录
│   ├── passwd             ← 普通文件
│   └── hosts              ← 普通文件
├── home/
│   └── ltl/
│       ├── notes.txt      ← 普通文件
│       └── projects/      ← 目录
└── dev/
    ├── sda                ← 块设备文件
    └── null               ← 字符设备文件
```

            

### 1.3 元数据的构成

            

每个文件除了数据本身，还携带一组元数据。这些元数据存储在
            inode 中（后文详述），包括：
            
            
            
            
            
            
            
            
            元数据字段
            含义
            示例
            
            
            
            
            文件类型（File Type）
            普通文件、目录、符号链接等
            `-`、`d`、`l`
            
            
            权限（Permissions）
            读、写、执行权限
            `rwxr-xr-x`（0755）
            
            
            属主（Owner）
            文件拥有者的用户标识符
            uid=1000
            
            
            属组（Group）
            文件所属组的组标识符
            gid=1000
            
            
            大小（Size）
            文件数据的字节数
            12288
            
            
            时间戳（Timestamps）
            访问、修改、状态变更时间
            atime、mtime、ctime
            
            
            链接计数（Link Count）
            指向该 inode 的硬链接数
            1
            
            
            数据块指针（Block Pointers）
            指向实际数据块的地址
            10240、10241、10242
            
            
            
            

### 1.4 为什么需要文件系统

            

直接使用裸块设备虽然性能最高（没有文件系统的元数据开销），但在工程实践中几乎不可用。原因包括：
            
            
- **命名问题**：没有文件名，只能靠块号访问数据，维护成本极高。
            
- **空间管理**：没有块分配器，应用程序需要自己跟踪哪些块是空闲的。
            
- **共享访问**：没有并发控制机制，多个进程同时写入会互相覆盖。
            
- **安全隔离**：没有权限系统，任何进程都可以读写任何数据。
            
- **崩溃恢复**：没有日志或事务机制，断电后数据结构可能损坏。
            
            

这就是为什么即使像数据库这样性能敏感的应用，大多数时候也运行在文件系统之上——虽然有些数据库（如
            Oracle
            ASM）支持直接操作裸设备，但这种用法正在减少，因为现代文件系统（特别是
            XFS 和 ext4 加上 Direct I/O）的开销已经足够低。
            
            

## 二、超级块（Superblock）

            

### 2.1 什么是超级块

            

超级块是文件系统级别的元数据容器，记录着整个文件系统的全局信息。如果说
            inode
            是单个文件的”身份证”，那超级块就是整个文件系统的”户口本”。内核在挂载（Mount）文件系统时，首先读取的就是超级块——没有超级块，内核就无法知道文件系统的类型、大小、状态等基本信息。
            

超级块中存储的典型信息包括：
            
```
超级块内容概览：
┌─────────────────────────────────────┐
│  魔数（Magic Number）                │ → 标识文件系统类型（ext4: 0xEF53）
│  块大小（Block Size）                │ → 通常 4096 字节
│  总块数（Total Blocks）              │ → 文件系统的总容量
│  空闲块数（Free Blocks）             │ → 剩余可用空间
│  总 inode 数（Total Inodes）         │ → 文件系统能容纳的最大文件数
│  空闲 inode 数（Free Inodes）        │ → 剩余可用 inode
│  挂载时间（Mount Time）              │ → 最后一次挂载时间
│  写入时间（Write Time）              │ → 最后一次超级块更新时间
│  挂载计数（Mount Count）             │ → 自上次 fsck 以来的挂载次数
│  文件系统状态（State）               │ → clean / errors / orphan recovery
│  特性标志（Feature Flags）           │ → 支持的文件系统特性
└─────────────────────────────────────┘
```

            

### 2.2 超级块的位置与冗余

            

在 ext4 文件系统中，主超级块位于分区起始位置偏移 1024
            字节处（即第 0 号块组的第一个块，跳过引导扇区）。ext4
            还在多个块组（Block
            Group）中保存超级块的备份副本，以便在主超级块损坏时进行恢复。
            

备份超级块的位置取决于文件系统是否启用了稀疏超级块特性（Sparse
            Superblock Feature）。启用后，备份仅存储在块组号为 0、1 以及
            3、5、7 的幂次方（即
            1、3、5、7、9、25、27、49……）的块组中，而不是每个块组都保存一份，从而节省空间。
            
```
# 查看 ext4 文件系统的超级块备份位置
sudo dumpe2fs /dev/sda1 2>/dev/null | grep -i "superblock"
```

            

输出示例：
            
```
Primary superblock at 0, Group descriptors at 1-1
Backup superblock at 32768, Group descriptors at 32769-32769
Backup superblock at 98304, Group descriptors at 98305-98305
Backup superblock at 163840, Group descriptors at 163841-163841
Backup superblock at 229376, Group descriptors at 229377-229377
Backup superblock at 294912, Group descriptors at 294913-294913
```

            

XFS
            的超级块同样有冗余设计。主超级块位于分配组（Allocation
            Group，AG）0 的起始位置，每个 AG
            的头部都保存一份超级块副本：
            
```
# 查看 XFS 文件系统的超级块信息
sudo xfs_info /dev/sdb1
```

            

### 2.3 Linux
            内核中的 struct super_block

            

在内核中，VFS 层用 `struct super_block`
            来表示一个已挂载的文件系统实例。这个结构体是 VFS
            与具体文件系统实现之间的桥梁：
            
```
/* 简化版 struct super_block — 源自 include/linux/fs.h */
struct super_block {
    struct list_head    s_list;         /* 全局超级块链表 */
    dev_t               s_dev;         /* 设备号 */
    unsigned char        s_blocksize_bits;  /* 块大小的位数 */
    unsigned long       s_blocksize;   /* 块大小（字节） */
    loff_t              s_maxbytes;    /* 最大文件大小 */
    struct file_system_type *s_type;   /* 文件系统类型 */
    const struct super_operations *s_op; /* 超级块操作表 */
    unsigned long       s_flags;       /* 挂载标志 */
    unsigned long       s_magic;       /* 魔数 */
    struct dentry       *s_root;       /* 根目录的 dentry */
    struct list_head    s_inodes;      /* 该文件系统的所有 inode 链表 */
    struct list_head    s_dirty;       /* 脏 inode 链表 */
    struct block_device *s_bdev;       /* 关联的块设备 */
    void                *s_fs_info;    /* 文件系统私有数据 */
    /* ... 还有更多字段 ... */
};
```

            

关键字段说明：
            
            
- `s_op`：指向 `super_operations`
            结构体，定义了操作超级块的方法集，包括分配
            inode（`alloc_inode`）、销毁
            inode（`destroy_inode`）、写回超级块（`write_super`）、同步文件系统（`sync_fs`）等。
            
- `s_root`：指向文件系统根目录的目录项缓存（dentry），是路径解析的起点。
            
- `s_fs_info`：指向具体文件系统的私有数据。对于
            ext4，这里指向 `struct ext4_sb_info`，包含了 ext4
            特有的超级块信息。
            
            

### 2.4 查看超级块信息的工具

            

**dumpe2fs**——ext2/ext3/ext4
            的瑞士军刀：
            
```
# 显示文件系统的完整超级块信息
sudo dumpe2fs -h /dev/sda1

# 输出示例（部分）：
# Filesystem volume name:   
# Last mounted on:          /
# Filesystem UUID:          a1b2c3d4-e5f6-7890-abcd-ef1234567890
# Filesystem magic number:  0xEF53
# Filesystem state:         clean
# Inode count:              6553600
# Block count:              26214400
# Free blocks:              18234567
# Free inodes:              6123456
# Block size:               4096
# Inode size:               256
# Journal size:             128M
```

            

**tune2fs**——查看和修改 ext
            系列文件系统参数：
            
```
# 查看文件系统的可调参数
sudo tune2fs -l /dev/sda1

# 设置最大挂载次数（触发自动 fsck 的阈值）
sudo tune2fs -c 30 /dev/sda1

# 设置检查间隔（180 天）
sudo tune2fs -i 180d /dev/sda1
```

            

**xfs_info**——XFS 文件系统信息：
            
```
# 查看已挂载的 XFS 文件系统信息
sudo xfs_info /mnt/data

# 输出示例：
# meta-data=/dev/sdb1    isize=512    agcount=4, agsize=6553600 blks
#          =              sectsz=512   attr=2, projid32bit=1
# data     =              bsize=4096   blocks=26214400, imaxpct=25
#          =              sunit=0      swidth=0 blks
# naming   =version 2     bsize=4096   ascii-ci=0, ftype=1
# log      =internal log  bsize=4096   blocks=12800, version=2
# realtime =none          extsz=4096   blocks=0, rtextents=0
```

            

### 2.5 超级块损坏与恢复

            

超级块损坏是文件系统故障中最严重的情形之一。典型症状是挂载失败，内核日志报告无法读取超级块或魔数不匹配。
            

对于 ext4，可以使用备份超级块进行恢复：
            
```
# 第一步：找到备份超级块的位置
sudo mke2fs -n /dev/sda1 2>&1 | grep -i "superblock"

# 第二步：使用备份超级块运行 fsck
sudo e2fsck -b 32768 /dev/sda1

# 第三步：如果 fsck 成功，尝试挂载
sudo mount /dev/sda1 /mnt/recovery
```

            

对于 XFS，修复工具是 `xfs_repair`：
            
```
# XFS 文件系统修复（必须先卸载）
sudo umount /dev/sdb1
sudo xfs_repair /dev/sdb1

# 如果主超级块损坏，使用备份 AG 头进行修复
sudo xfs_repair -L /dev/sdb1
```

            

需要注意的是，`xfs_repair -L`
            会丢弃日志（Log），可能导致最近未完成的事务中的数据丢失。这是最后手段。
            
            

## 三、inode 详解

            

### 3.1 什么是 inode

            

inode（Index Node，索引节点）是 Unix/Linux
            文件系统中最核心的数据结构之一。每个文件（包括目录）都对应一个
            inode，它存储了文件的全部元数据——除了文件名以外的所有信息。文件名存储在目录中，而不是
            inode 里——这一设计决策使得硬链接成为可能。
            

可以这样理解 inode 的角色：
            
```
目录（Directory）          inode                     数据块（Data Blocks）
┌──────────────┐      ┌─────────────────┐      ┌──────────────────┐
│ notes.txt → 42│ ──→ │ inode #42       │ ──→ │ 块 10240: "Hello │
│ readme → 87  │      │ mode: 0644      │      │ 块 10241: World" │
│ data.csv → 42│ ──→ │ uid: 1000       │      └──────────────────┘
└──────────────┘      │ size: 12288     │
                      │ blocks: 10240.. │
                      │ links: 2        │
                      └─────────────────┘

注意：notes.txt 和 data.csv 指向同一个 inode（硬链接）
```

            

### 3.2 inode 的字段详解

            

一个 inode 中包含以下关键字段：
            
```
/* 简化版 ext4 磁盘 inode — 源自 fs/ext4/ext4.h */
struct ext4_inode {
    __le16  i_mode;         /* 文件类型和权限 */
    __le16  i_uid;          /* 属主用户 ID（低 16 位） */
    __le32  i_size_lo;      /* 文件大小（低 32 位） */
    __le32  i_atime;        /* 最后访问时间 */
    __le32  i_ctime;        /* inode 状态变更时间 */
    __le32  i_mtime;        /* 最后修改时间 */
    __le32  i_dtime;        /* 删除时间 */
    __le16  i_gid;          /* 属组 ID（低 16 位） */
    __le16  i_links_count;  /* 硬链接计数 */
    __le32  i_blocks_lo;    /* 已分配的 512 字节块数 */
    __le32  i_flags;        /* 文件标志 */
    __le32  i_block[15];    /* 块指针数组 */
    /* ... ext4 扩展字段 ... */
    __le16  i_extra_isize;  /* 扩展 inode 的额外大小 */
    __le32  i_crtime;       /* 创建时间（ext4 扩展） */
};
```

            

各字段含义的详细说明：
            

**i_mode**（16 位）：编码文件类型和权限。高
            4
            位表示文件类型（普通文件、目录、符号链接、块设备、字符设备、管道、套接字），低
            12 位表示权限（包括 SUID、SGID、Sticky Bit 和 rwx
            三组权限位）。
            

**时间戳**：传统 Unix
            有三个时间戳——atime（Access
            Time，访问时间）、mtime（Modification
            Time，数据修改时间）、ctime（Change Time，inode
            状态变更时间）。ext4 增加了 crtime（Creation
            Time，创建时间），并将所有时间戳从 32 位扩展为 34
            位加纳秒精度，解决了 2038 年问题（Year 2038 Problem）。
            

**i_blocks_lo**：注意这里记录的是 512
            字节扇区数，而非文件系统的块数。一个 4096
            字节的文件系统块对应 8 个 512 字节扇区。
            

**i_block[15]**：这个 15 元素的数组在
            ext2/ext3 中用于存储块指针（直接和间接），在 ext4
            中被重新解释为 extent 树的根节点。
            

### 3.3 inode 编号

            

每个 inode 在其所在的文件系统内有一个唯一的编号（Inode
            Number），从 1 开始递增。一些特殊 inode
            编号有预定义的含义：
            
            
            
            inode 编号
            用途
            
            
            
            
            1
            坏块 inode（Bad Blocks Inode），记录磁盘上的坏扇区
            
            
            2
            根目录 inode（Root Directory），是路径解析的起点
            
            
            3
            ACL 索引 inode（用于 ext3 的用户空间 ACL）
            
            
            4
            ACL 数据 inode
            
            
            5
            引导加载器 inode
            
            
            6
            未删除目录 inode（Undelete Directory）
            
            
            7
            预留组描述符 inode（Reserved Group Descriptors）
            
            
            8
            日志 inode（Journal Inode）
            
            
            11
            第一个非预留 inode（ext4 中通常是 lost+found 目录）
            
            
            
            
```
# 查看根目录的 inode 编号
ls -id /
# 输出：2 /

# 查看日志 inode
sudo debugfs -R "stat " /dev/sda1 2>/dev/null | head -5
```

            

### 3.4 inode 表：固定分配
            vs 动态分配

            

**ext4 的固定分配方式**：在
            `mkfs.ext4` 格式化时，inode
            表的大小就已经确定。每个块组（Block
            Group）内保留一段连续的块来存储 inode 表，inode
            总数在格式化后不可更改（除非使用
            `resize2fs`）。默认情况下，每 16384
            字节数据空间分配一个 inode。
            
```
# 格式化时指定 inode 密度
sudo mkfs.ext4 -i 8192 /dev/sdb1    # 每 8KB 数据一个 inode（更多 inode）
sudo mkfs.ext4 -i 65536 /dev/sdb1   # 每 64KB 数据一个 inode（更少 inode）

# 格式化时直接指定 inode 数量
sudo mkfs.ext4 -N 10000000 /dev/sdb1
```

            

**XFS 的动态分配方式**：XFS 按需分配
            inode。当一个分配组（AG）中的 inode 空间用尽时，XFS 会在该
            AG 内动态分配新的 inode 块（Inode Chunk，每次 64 个
            inode）。这意味着 XFS 几乎不会出现 inode
            耗尽的问题（只要有空闲数据块）。
            

**Btrfs 的 B 树方式**：Btrfs 将 inode
            存储在其核心的 B 树（Copy-on-Write B-Tree）结构中，inode
            数量完全动态，没有预分配的概念。
            

### 3.5 inode 大小的演进

            

不同版本的 ext 文件系统使用不同大小的磁盘 inode
            结构：
            
            
            
            文件系统
            inode 大小
            说明
            
            
            
            
            ext2
            128 字节
            基础 inode 字段
            
            
            ext3
            128 字节（默认）
            与 ext2 兼容
            
            
            ext4
            256 字节（默认）
            扩展时间戳、内联扩展属性
            
            
            
            

ext4 将 inode 从 128 字节扩大到 256 字节，多出的 128
            字节用于：
            
            
- **纳秒时间戳**：传统的秒级时间戳无法满足高性能应用的需求。
            
- **创建时间（crtime）**：ext2/ext3
            没有文件创建时间的概念。
            
- **内联扩展属性（Inline Extended
            Attributes）**：小的扩展属性（如 SELinux
            安全标签）可以直接存储在 inode 内，避免额外的磁盘寻道。
            
- **校验和（Checksum）**：inode 自身的 CRC32C
            校验和，用于检测元数据损坏。
            
            
```
# 查看文件系统使用的 inode 大小
sudo dumpe2fs -h /dev/sda1 2>/dev/null | grep "Inode size"
# 输出：Inode size:               256
```

            

### 3.6 用 stat 读取 inode
            信息

            

`stat` 命令是查看文件 inode
            信息最直接的工具：
            
```
stat /etc/passwd
```

            

输出：
            
```
  File: /etc/passwd
  Size: 2745            Blocks: 8          IO Block: 4096   regular file
Device: 801h/2049d      Inode: 131074      Links: 1
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
Access: 2025-08-20 10:30:15.123456789 +0800
Modify: 2025-08-15 09:20:30.987654321 +0800
Change: 2025-08-15 09:20:30.987654321 +0800
 Birth: 2025-01-10 14:00:00.000000000 +0800
```

            

各项含义：
            
            
- **Size**：文件内容的字节数（2745
            字节）。
            
- **Blocks**：已分配的 512 字节块数（8 个，即
            4096 字节 = 1 个文件系统块）。
            
- **IO Block**：文件系统的 I/O 块大小（4096
            字节）。
            
- **Inode**：inode 编号（131074）。
            
- **Links**：硬链接计数（1）。
            
- **Birth**：文件创建时间（ext4
            特有，某些工具可能不显示）。
            
            

### 3.7 inode 耗尽

            

一个常见的生产故障场景是：`df`
            显示磁盘还有大量可用空间，但创建新文件时却报 “No space left
            on device” 错误。这通常是 inode 耗尽导致的。
            
```
# 查看 inode 使用情况
df -i

# 输出示例：
# Filesystem       Inodes  IUsed    IFree IUse% Mounted on
# /dev/sda1      6553600 6553600        0  100% /
# 注意：IFree 为 0，但 df -h 可能显示还有大量空闲空间
```

            

inode 耗尽的典型原因：
            
            
- **大量小文件**：邮件服务器、缓存目录中可能存在数百万个小文件，每个文件消耗一个
            inode，但只占用少量数据块。
            
- **临时文件未清理**：应用程序崩溃后留下大量临时文件。
            
- **inode 密度配置不当**：格式化时
            `-i` 参数设置过大（每个 inode
            对应的数据空间太多）。
            
            

排查和解决方法：
            
```
# 找出 inode 使用最多的目录
sudo find / -xdev -printf '%h\n' | sort | uniq -c | sort -rn | head -20

# 更高效的方式：按目录统计文件数量
for dir in /var /home /opt /srv; do
    echo "$(find "$dir" -xdev -type f 2>/dev/null | wc -l) $dir"
done | sort -rn

# 解决方案：
# 1. 删除不需要的文件
# 2. 如果是 ext4，考虑备份数据后用更小的 -i 参数重新格式化
# 3. 考虑迁移到 XFS 或 Btrfs（动态 inode 分配）
```

            
            

## 四、数据块寻址

            

### 4.1
            传统间接块寻址（ext2/ext3）

            

ext2 和 ext3
            使用经典的多级间接指针方案来寻址文件的数据块。每个 inode
            包含一个 15 元素的块指针数组
            `i_block[15]`，其中：
            
            
- `i_block[0]` 到 `i_block[11]`：12
            个直接块指针（Direct Block
            Pointers），每个直接指向一个数据块。
            
- `i_block[12]`：一级间接块指针（Single
            Indirect），指向一个”指针块”，该块中存储了更多数据块地址。
            
- `i_block[13]`：二级间接块指针（Double
            Indirect），指向一个”指针块”，其中每个条目又指向一个”指针块”。
            
- `i_block[14]`：三级间接块指针（Triple
            Indirect），再多一层嵌套。
            
            
```
inode
┌───────────┐
│ block[0]  │ ──→ 数据块 0
│ block[1]  │ ──→ 数据块 1
│ ...       │
│ block[11] │ ──→ 数据块 11
│ block[12] │ ──→ ┌──────────────┐     （一级间接块）
│           │     │ ptr → 数据块 12│
│           │     │ ptr → 数据块 13│
│           │     │ ...           │
│           │     │ ptr → 数据块 N │    N = 12 + 块大小/4 - 1
│           │     └──────────────┘
│ block[13] │ ──→ 二级间接块 ──→ 间接块 ──→ 数据块
│ block[14] │ ──→ 三级间接块 ──→ 间接块 ──→ 间接块 ──→ 数据块
└───────────┘
```

            

以 4096 字节块大小为例，每个指针占 4
            字节，一个间接块可以存储 1024 个指针：
            
            
            
            寻址级别
            可寻址块数
            对应文件大小
            
            
            
            
            直接（12 个指针）
            12
            48 KB
            
            
            一级间接
            1024
            4 MB
            
            
            二级间接
            1024 x 1024 = 1048576
            4 GB
            
            
            三级间接
            1024 x 1024 x 1024
            4 TB
            
            
            **合计**
            **约 10 亿块**
            **约 4 TB**
            
            
            
            

这种方案的问题是，对于大型顺序文件，元数据开销巨大。一个
            1 GB 的连续文件需要大约 262144
            个块指针——即使这些块在磁盘上是连续的。
            

### 4.2 基于区段的寻址（ext4）

            

ext4 引入了区段（Extent）的概念来替代间接块指针。一个
            extent 描述一段连续的数据块范围：
            
```
/* ext4 extent 结构 — 源自 fs/ext4/ext4_extents.h */
struct ext4_extent {
    __le32  ee_block;      /* extent 覆盖的第一个逻辑块号 */
    __le16  ee_len;        /* extent 覆盖的块数 */
    __le16  ee_start_hi;   /* 起始物理块号（高 16 位） */
    __le32  ee_start_lo;   /* 起始物理块号（低 32 位） */
};
```

            

一个 extent 只用 12 字节就能描述最多 32768 个连续块（128
            MB），而同样的范围在间接块方案中需要 32768 个指针（128 KB
            的元数据）。
            
```
间接块方案 vs Extent 方案 — 同样描述 128 MB 连续数据：

间接块：32768 个 4 字节指针 = 128 KB 元数据
Extent：1 个 12 字节 extent = 12 字节元数据

元数据节省比例：99.99%
```

            

### 4.3 Extent 树

            

inode 的 `i_block[15]` 数组（共 60 字节）在
            ext4 中被重新解释为一个 extent 树的根节点。这 60
            字节可以容纳一个 12 字节的 extent 头（Header）和最多 4 个
            extent 条目。
            
```
i_block[15] 在 ext4 中的布局（60 字节）：

┌──────────────────────────────┐
│ Extent Header（12 字节）      │
│   eh_magic: 0xF30A           │
│   eh_entries: 当前条目数      │
│   eh_max: 最大条目数（4）      │
│   eh_depth: 树深度            │
├──────────────────────────────┤
│ Extent 1（12 字节）           │  ← 直接嵌入 inode
│ Extent 2（12 字节）           │
│ Extent 3（12 字节）           │
│ Extent 4（12 字节）           │
└──────────────────────────────┘
```

            

对于小文件（4 个 extent 以内），所有寻址信息都在 inode
            内，不需要额外的磁盘访问。当 extent 数量超过 4 个时，ext4 将
            extent 树扩展为 B
            树（HTree），每个内部节点是一个磁盘块，可以存储数百个 extent
            索引或叶子条目。
            
```
大文件的 Extent B 树结构：

                    inode（根节点）
                   /       |       \
                  /        |        \
        索引块 A      索引块 B      索引块 C
        /    \         /    \         /    \
   叶子块1  叶子块2  叶子块3  叶子块4  叶子块5  叶子块6
   [ext1]  [ext2]  [ext3]  [ext4]  [ext5]  [ext6]
   [ext7]  [ext8]  ...     ...     ...     [extN]

每个叶子块可以存储 ~340 个 extent（4096/12 ≈ 340）
每个 extent 最多覆盖 128 MB
单层叶子就能描述 340 x 128 MB ≈ 42 GB
```

            

### 4.4 间接块 vs Extent
            的性能比较

            
            
            
            比较维度
            间接块（ext2/ext3）
            Extent（ext4）
            
            
            
            
            小文件寻址
            直接指针，1 次 I/O
            inode 内 extent，0 次额外 I/O
            
            
            大文件顺序读
            需频繁读间接块
            extent 合并，极少额外 I/O
            
            
            随机读
            可能需 1-3 次间接块读取
            树查找，通常 1-2 次
            
            
            元数据空间
            与文件大小线性增长
            与 extent 数（碎片程度）成正比
            
            
            碎片影响
            指针开销固定
            碎片多 → extent 多 → 树更深
            
            
            
            

### 4.5 碎片与 Extent

            

虽然 extent
            方案对连续分配非常高效，但文件碎片化（Fragmentation）会增加
            extent 数量，降低 extent 的优势。ext4
            提供了在线碎片整理工具：
            
```
# 查看单个文件的碎片情况
filefrag -v /var/log/syslog

# 输出示例：
# Filesystem type is: ef53
# File size of /var/log/syslog is 1234567 (302 blocks of 4096 bytes)
# ext:   logical_offset:  physical_offset: length:   expected: flags:
#    0:        0..      63:   1048576..  1048639:     64:
#    1:       64..     127:   2097152..  2097215:     64:  1048640:
#    2:      128..     301:   3145728..  3145901:    174:  2097216: last,eof
# /var/log/syslog: 3 extents found

# 对单个文件进行碎片整理
sudo e4defrag /var/log/syslog

# 对整个文件系统进行碎片整理（在线）
sudo e4defrag /dev/sda1
```

            
            

## 五、目录实现

            

### 5.1 目录的本质

            

在 Unix
            文件系统中，目录本身就是一种特殊的文件。普通文件的数据内容是用户的数据，而目录的数据内容是一张”名字到
            inode 编号”的映射表。每个映射条目称为一个目录项（Directory
            Entry）。
            
```
目录 /home/ltl 的数据块内容：

┌──────────┬────────┬──────┬─────────────────┐
│ inode 号  │ 记录长度 │ 名长  │ 文件名           │
├──────────┼────────┼──────┼─────────────────┤
│     42   │   16   │   1  │ .               │  ← 当前目录
│     30   │   16   │   2  │ ..              │  ← 父目录
│    103   │   24   │   9  │ notes.txt       │
│    104   │   24   │  10  │ readme.md       │
│    105   │   20   │   8  │ projects        │
│    106   │   20   │   7  │ .bashrc         │
└──────────┴────────┴──────┴─────────────────┘
```

            

注意 `.` 和 `..`
            两个特殊条目：`.` 指向目录自身的
            inode，`..` 指向父目录的 inode。这就是
            `cd ..` 能回到上级目录的实现基础。
            

### 5.2 线性目录（ext2）

            

ext2
            最初使用线性目录结构：目录项按创建顺序存储在目录的数据块中。查找一个文件名需要从头扫描所有目录项，直到找到匹配的名字或到达末尾。
            
```
线性查找过程（查找 "readme.md"）：

扫描 "."        → 不匹配
扫描 ".."       → 不匹配
扫描 "notes.txt" → 不匹配
扫描 "readme.md" → 匹配！返回 inode 104

时间复杂度：O(n)，n 为目录中的条目数
```

            

对于小目录（几十个文件），线性扫描足够快。但当目录中有数千甚至数万个文件时，每次文件查找都要遍历整个目录，性能急剧下降。
            

### 5.3 哈希目录（ext3/ext4
            htree）

            

ext3 引入了 htree（Hashed Tree）结构来加速目录查找。htree
            本质上是一个 B 树变体，使用文件名的半 MD4 哈希值（Half MD4
            Hash）作为索引键。
            
```
htree 的结构：

                    根节点（目录的第一个数据块）
                    ┌─────────────────────┐
                    │ dot/dotdot 条目       │
                    │ 索引条目 1: hash → 块 A│
                    │ 索引条目 2: hash → 块 B│
                    │ 索引条目 3: hash → 块 C│
                    └─────────────────────┘
                     /         |         \
                    /          |          \
              叶子块 A     叶子块 B     叶子块 C
              [目录项]     [目录项]     [目录项]
              [目录项]     [目录项]     [目录项]
```

            

查找过程：
            
            
- 计算目标文件名的哈希值。
            
- 在根节点的索引中二分查找，确定目标哈希落在哪个叶子块。
            
- 读取对应的叶子块，在其中线性搜索匹配的文件名。
            
            

时间复杂度从 O(n) 降低到 O(1)（哈希计算） + O(log
            n)（索引查找） + O(m)（叶子块内线性搜索，m 远小于 n）。
            
```
# 检查目录是否使用了 htree
sudo debugfs -R "htree_dump /home/ltl" /dev/sda1 2>/dev/null | head -20

# 启用/禁用 htree 特性
sudo tune2fs -O dir_index /dev/sda1    # 启用
sudo tune2fs -O ^dir_index /dev/sda1   # 禁用
```

            

### 5.4 B 树目录（XFS）

            

XFS 根据目录大小自动选择不同的存储策略：
            
            
            
            
            
            
            
            
            目录大小
            存储方式
            说明
            
            
            
            
            极小（≤ 几个条目）
            短格式（Shortform）
            目录项内联在 inode 中
            
            
            小（一个数据块）
            块格式（Block）
            所有条目在一个磁盘块中，带尾部哈希表
            
            
            中（多个数据块）
            叶格式（Leaf）
            数据块 + 独立的叶子索引块
            
            
            大（非常多条目）
            节点格式（Node）
            完整的 B+ 树索引
            
            
            
            

XFS 的 B+ 树（B-Plus
            Tree）结构对包含数百万文件的大目录性能优异，查找时间复杂度为
            O(log
            n)，且内部节点只存储键值（哈希），不存储目录项数据，进一步提高了扇出比（Fan-out
            Ratio）和缓存命中率。
            

### 5.5 目录项的磁盘结构

            

ext4 的目录项结构（启用 `filetype`
            特性时）：
            
```
/* ext4 目录项 — 源自 fs/ext4/ext4.h */
struct ext4_dir_entry_2 {
    __le32  inode;          /* inode 编号 */
    __le16  rec_len;        /* 本条目占用的总字节数 */
    __u8    name_len;       /* 文件名长度 */
    __u8    file_type;      /* 文件类型（普通、目录、符号链接等） */
    char    name[];         /* 文件名（不以 NULL 结尾） */
};
```

            

`file_type` 字段的引入使得
            `readdir()` 操作不需要额外读取 inode
            就能知道条目的类型，显著减少了 `ls -l` 等命令的
            I/O 次数。
            

`rec_len`
            字段用于定位下一个目录项。删除文件时，不会在目录数据块中物理移除目录项，而是将被删条目的
            `rec_len`
            合并到前一个条目中，形成一个”空洞”。新建文件时，这些空洞可以被复用。
            

### 5.6 大目录性能问题

            

当单个目录中包含数百万个文件时，即使有 htree 或 B
            树索引，性能仍然会受到影响：
            
            
- **目录数据块的膨胀**：每个目录项至少占 12
            字节（8 字节固定头 + 至少 4 字节文件名），百万文件至少需要约
            12 MB 的目录数据。
            
- **哈希冲突**：htree 使用的 32
            位哈希值在百万级条目时冲突概率上升。
            
- **元数据缓存压力**：大量目录项占用 VFS
            的目录项缓存（dentry cache），可能挤出其他有用的缓存。
            
- **日志开销**：每次在大目录中创建或删除文件，都需要将变更的目录块写入日志。
            
            

应对策略：
            
```
# 反面示例：100 万个文件放在一个目录中
# 这会导致 ls、find、rm 等操作极慢

# 正面示例：按哈希分桶
# 使用两级子目录，每级 256 个桶
# 文件 abcdef.dat → ab/cd/abcdef.dat
# 这样每个叶子目录最多只有 ~15 个文件

# 创建分桶目录结构
for a in $(seq -w 0 255 | xargs printf '%02x\n'); do
    for b in $(seq -w 0 255 | xargs printf '%02x\n'); do
        mkdir -p "/data/$a/$b"
    done
done
```

            

实际系统中，Maildir 邮件存储、Git
            对象存储（`.git/objects`）、HTTP
            缓存都采用类似的分桶策略。
            
            

## 六、VFS（Virtual File
            System）

            

### 6.1 为什么需要 VFS

            

Linux 支持几十种文件系统——ext4、XFS、Btrfs、NFS（Network
            File System，网络文件系统）、FUSE（Filesystem in
            Userspace，用户态文件系统）、procfs（进程文件系统）、sysfs（系统文件系统）等。每种文件系统的内部实现差异巨大，但用户态程序只使用一套系统调用（`open`、`read`、`write`、`close`、`stat`、`mkdir`
            等）就能操作所有文件系统上的文件。
            

这种统一性是通过 VFS（Virtual File
            System，虚拟文件系统）层实现的。VFS
            定义了一套抽象接口，每种具体文件系统只需实现这套接口，就能无缝融入
            Linux 的文件操作框架。
            
```
用户态程序的视角（不需要关心底层文件系统）：

open("/home/ltl/notes.txt", O_RDONLY)  → fd = 3
read(3, buf, 4096)                     → 读取 4096 字节
close(3)                               → 关闭文件

以上操作无论底层是 ext4、XFS 还是 NFS，调用方式完全相同。

内核中的分发机制：

用户态 open()
    │
    ▼
VFS 层：路径解析、权限检查、分发
    │
    ├── ext4？  → ext4_file_open()
    ├── XFS？   → xfs_file_open()
    ├── NFS？   → nfs_file_open()
    └── Btrfs？ → btrfs_file_open()
```

            

### 6.2 VFS 的四大核心对象

            

VFS 围绕四种核心对象构建其抽象层：
            

**1. 超级块对象（Superblock Object）——struct
            super_block**
            

代表一个已挂载的文件系统实例。前文已详细讨论。
            

**2. inode 对象（Inode Object）——struct
            inode**
            

代表一个具体的文件。VFS 层的 `struct inode`
            与磁盘上的 inode 不同——前者是内存中的运行时表示，包含了 VFS
            需要的通用字段和指向具体文件系统操作的函数指针表。
            
```
/* 简化版 struct inode — 源自 include/linux/fs.h */
struct inode {
    umode_t             i_mode;      /* 文件类型和权限 */
    kuid_t              i_uid;       /* 属主 */
    kgid_t              i_gid;       /* 属组 */
    unsigned int        i_flags;     /* 文件系统标志 */
    const struct inode_operations *i_op;  /* inode 操作表 */
    struct super_block  *i_sb;       /* 所属超级块 */
    struct address_space *i_mapping; /* 页缓存映射 */
    unsigned long       i_ino;       /* inode 编号 */
    atomic_t            i_count;     /* 引用计数 */
    loff_t              i_size;      /* 文件大小 */
    struct timespec64   i_atime;     /* 访问时间 */
    struct timespec64   i_mtime;     /* 修改时间 */
    struct timespec64   i_ctime;     /* 变更时间 */
    const struct file_operations *i_fop; /* 默认文件操作表 */
    union {
        struct pipe_inode_info  *i_pipe; /* 管道 */
        struct cdev             *i_cdev; /* 字符设备 */
        struct block_device     *i_bdev; /* 块设备 */
    };
    /* ... 更多字段 ... */
};
```

            

**3. 目录项对象（Dentry Object）——struct
            dentry**
            

代表路径中的一个分量（Component）。例如路径
            `/home/ltl/notes.txt` 会涉及 4 个
            dentry：`/`、`home`、`ltl`、`notes.txt`。dentry
            是路径解析的核心数据结构，也是 VFS
            性能优化的关键——内核维护一个 dentry
            缓存（dcache），将最近访问过的路径分量缓存在内存中，避免重复的磁盘查找。
            
```
/* 简化版 struct dentry — 源自 include/linux/dcache.h */
struct dentry {
    unsigned int        d_flags;     /* dentry 标志 */
    struct dentry       *d_parent;   /* 父目录的 dentry */
    struct qstr         d_name;      /* 文件名 */
    struct inode        *d_inode;    /* 关联的 inode */
    const struct dentry_operations *d_op; /* dentry 操作表 */
    struct super_block  *d_sb;       /* 所属超级块 */
    struct hlist_bl_node d_hash;     /* 哈希表节点（用于 dcache 查找） */
    struct list_head    d_child;     /* 兄弟 dentry 链表 */
    struct list_head    d_subdirs;   /* 子 dentry 链表 */
    /* ... 更多字段 ... */
};
```

            

dentry 有三种状态：
            
            
- **正使用（in use）**：`d_inode`
            指向有效 inode，引用计数大于 0。
            
- **未使用（unused）**：`d_inode`
            指向有效 inode，但引用计数为 0。仍保留在 dcache
            中，可被回收。
            
- **负状态（negative）**：`d_inode`
            为 NULL，表示该路径不存在。负 dentry
            的缓存避免了对不存在文件的重复磁盘查找。
            
            

**4. 文件对象（File Object）——struct
            file**
            

代表一个进程打开的文件。它是进程级别的概念——同一个文件被两个进程打开，就有两个
            `struct file` 对象，但它们可能指向同一个
            inode。
            
```
/* 简化版 struct file — 源自 include/linux/fs.h */
struct file {
    struct path         f_path;       /* 包含 dentry 和 vfsmount */
    struct inode        *f_inode;     /* 关联的 inode */
    const struct file_operations *f_op; /* 文件操作表 */
    atomic_long_t       f_count;      /* 引用计数 */
    unsigned int        f_flags;      /* 打开标志（O_RDONLY 等） */
    fmode_t             f_mode;       /* 访问模式 */
    loff_t              f_pos;        /* 当前文件偏移量 */
    struct fown_struct  f_owner;      /* 异步 I/O 所有者 */
    void                *private_data;/* 文件系统私有数据 */
    /* ... 更多字段 ... */
};
```

            

`f_pos`
            是文件的当前读写位置，`lseek()`
            系统调用修改的就是这个字段。每个 `struct file`
            独立维护自己的
            `f_pos`，所以同一个文件被多次打开后，各自的读写位置互不影响。
            

### 6.3 VFS 操作表

            

VFS 的核心设计模式是”操作表”——每种 VFS
            对象都关联一个函数指针表（Operations
            Table），具体文件系统通过填充这些函数指针来实现自己的行为。
            
```
/* 超级块操作表 */
struct super_operations {
    struct inode *(*alloc_inode)(struct super_block *sb);
    void (*destroy_inode)(struct inode *);
    void (*dirty_inode)(struct inode *, int flags);
    int (*write_inode)(struct inode *, struct writeback_control *wbc);
    void (*evict_inode)(struct inode *);
    void (*put_super)(struct super_block *);
    int (*sync_fs)(struct super_block *sb, int wait);
    int (*statfs)(struct dentry *, struct kstatfs *);
    /* ... */
};

/* inode 操作表 */
struct inode_operations {
    struct dentry *(*lookup)(struct inode *, struct dentry *, unsigned int);
    int (*create)(struct mnt_idmap *, struct inode *, struct dentry *,
                  umode_t, bool);
    int (*link)(struct dentry *, struct inode *, struct dentry *);
    int (*unlink)(struct inode *, struct dentry *);
    int (*symlink)(struct inode *, struct dentry *, const char *);
    int (*mkdir)(struct inode *, struct dentry *, umode_t);
    int (*rmdir)(struct inode *, struct dentry *);
    int (*rename)(struct mnt_idmap *, struct inode *, struct dentry *,
                  struct inode *, struct dentry *, unsigned int);
    /* ... */
};

/* 文件操作表 */
struct file_operations {
    loff_t (*llseek)(struct file *, loff_t, int);
    ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);
    ssize_t (*read_iter)(struct kiocb *, struct iov_iter *);
    ssize_t (*write_iter)(struct kiocb *, struct iov_iter *);
    int (*open)(struct inode *, struct file *);
    int (*release)(struct inode *, struct file *);
    int (*fsync)(struct file *, loff_t, loff_t, int datasync);
    long (*unlocked_ioctl)(struct file *, unsigned int, unsigned long);
    int (*mmap)(struct file *, struct vm_area_struct *);
    /* ... */
};
```

            

例如，当用户态调用
            `open("/home/ltl/notes.txt", O_RDONLY)`
            时，内核的执行路径大致如下：
            
```
1. 系统调用入口：sys_open()
2. VFS 路径解析：path_lookup() 逐级查找 dentry
   a. 查找 "/"    → dcache 命中，或读取磁盘 inode 2
   b. 查找 "home" → 调用父目录 inode 的 i_op->lookup()
   c. 查找 "ltl"  → 调用父目录 inode 的 i_op->lookup()
   d. 查找 "notes.txt" → 调用父目录 inode 的 i_op->lookup()
3. 权限检查：inode_permission()
4. 打开文件：调用 inode 的 i_fop->open()
5. 创建 struct file 对象，关联 dentry 和 inode
6. 安装到进程的文件描述符表，返回 fd
```

            

### 6.4 文件系统注册与挂载

            

**注册**：每种文件系统在内核中通过
            `register_filesystem()`
            函数注册自己的类型信息。注册信息包括文件系统的名称和挂载方法：
            
```
/* 文件系统类型 — 源自 include/linux/fs.h */
struct file_system_type {
    const char *name;                    /* 文件系统名称，如 "ext4" */
    int fs_flags;                        /* 标志 */
    int (*init_fs_context)(struct fs_context *);  /* 初始化挂载上下文 */
    struct dentry *(*mount)(struct file_system_type *, int,
                            const char *, void *);  /* 挂载方法 */
    void (*kill_sb)(struct super_block *);           /* 卸载方法 */
    struct module *owner;                /* 所属内核模块 */
    struct file_system_type *next;       /* 链表指针 */
    /* ... */
};

/* ext4 的注册 — 源自 fs/ext4/super.c */
static struct file_system_type ext4_fs_type = {
    .owner          = THIS_MODULE,
    .name           = "ext4",
    .init_fs_context = ext4_init_fs_context,
    .kill_sb        = kill_block_super,
    .fs_flags       = FS_REQUIRES_DEV | FS_ALLOW_IDMAP,
};

/* 模块初始化时注册 */
static int __init ext4_init(void) {
    /* ... */
    err = register_filesystem(&ext4_fs_type);
    /* ... */
}
```

            
```
# 查看内核当前支持的所有文件系统
cat /proc/filesystems

# 输出示例：
# nodev   sysfs
# nodev   tmpfs
# nodev   bdev
# nodev   proc
# nodev   devtmpfs
#         ext3
#         ext4
#         xfs
#         btrfs
# nodev   fuse
```

            

**挂载**：`mount`
            系统调用触发以下过程：
            
            
- VFS 根据文件系统类型名称（如 “ext4”）找到对应的
            `file_system_type`。
            
- 调用其 `mount` 方法（或新的
            `init_fs_context`
            方法），读取设备上的超级块。
            
- 创建 VFS 层的 `struct super_block`
            对象。
            
- 建立挂载点（Mount Point）：将文件系统的根 dentry
            关联到挂载点的 dentry 上。
            
            
```
# 查看当前所有挂载点
mount | column -t
# 或更详细的视图
cat /proc/mounts

# 查看挂载点的文件系统类型和选项
findmnt --target /home
```

            

### 6.5 挂载命名空间

            

Linux 的挂载命名空间（Mount
            Namespace）允许不同的进程看到不同的挂载树。这是容器（Container）技术的基础之一——每个容器有自己的挂载命名空间，看到的文件系统层级与宿主机不同。
            
```
# 在新的挂载命名空间中运行 shell
sudo unshare --mount /bin/bash

# 在这个 shell 中做的挂载操作对宿主机不可见
mount -t tmpfs none /mnt/test
# 退出 shell 后，/mnt/test 的挂载自动消失
```

            
            

## 七、硬链接与软链接

            

### 7.1 硬链接（Hard Link）

            

硬链接的本质非常简单：在一个目录中添加一个新的目录项，指向一个已有的
            inode。新的目录项和原来的目录项地位完全对等——没有”原始文件”和”链接文件”的区别，它们只是同一个
            inode 的不同名字。
            
```
创建硬链接前：

目录 /home/ltl:
┌──────────────────┐
│ notes.txt → inode 42 │
└──────────────────┘

inode 42:
┌─────────────────┐
│ links_count: 1  │
│ mode: 0644      │
│ size: 1234      │
│ blocks: ...     │
└─────────────────┘

创建硬链接后（ln notes.txt backup.txt）：

目录 /home/ltl:
┌──────────────────────┐
│ notes.txt  → inode 42 │
│ backup.txt → inode 42 │
└──────────────────────┘

inode 42:
┌─────────────────┐
│ links_count: 2  │  ← 链接计数增加到 2
│ mode: 0644      │
│ size: 1234      │
│ blocks: ...     │
└─────────────────┘
```

            

创建硬链接不会复制数据，也不会消耗额外的数据块——只是在目录中增加了一个条目，并将
            inode 的链接计数加 1。删除文件时（`unlink`
            系统调用），内核将链接计数减 1，只有当链接计数降为 0
            且没有进程打开该文件时，才真正释放 inode 和数据块。
            
```
# 创建硬链接
ln /home/ltl/notes.txt /home/ltl/backup.txt

# 验证两个文件指向同一个 inode
ls -i /home/ltl/notes.txt /home/ltl/backup.txt
# 输出：42 /home/ltl/notes.txt    42 /home/ltl/backup.txt

# 查看链接计数
stat /home/ltl/notes.txt | grep Links
# 输出：Links: 2
```

            

### 7.2 硬链接的限制

            

硬链接有两个重要限制：
            

**1. 不能跨文件系统**：inode
            编号只在单个文件系统内唯一。如果允许跨文件系统的硬链接，一个
            inode 编号在不同文件系统中可能指向不同的文件，导致歧义。
            
```
# 尝试跨文件系统创建硬链接
ln /home/ltl/notes.txt /mnt/usb/backup.txt
# 错误：Invalid cross-device link
```

            

**2.
            不能链接到目录**：如果允许对目录创建硬链接，目录树可能出现环路（Cycle），导致
            `find`、`du`、`rm -r`
            等递归遍历工具陷入无限循环。虽然内核理论上可以检测环路，但这会使文件系统代码复杂度大幅增加。
            
```
# 尝试对目录创建硬链接
ln /home/ltl/projects /home/ltl/projects_link
# 错误：hard link not allowed for directory
```

            

例外情况：`.` 和 `..`
            实际上就是指向目录的硬链接。空目录的链接计数是 2（自身的
            `.`
            和父目录中的条目），每增加一个子目录，链接计数加
            1（因为子目录的 `..` 指向了它）。
            
```
# 空目录的链接计数
mkdir testdir
stat testdir | grep Links
# 输出：Links: 2

# 添加一个子目录后
mkdir testdir/sub
stat testdir | grep Links
# 输出：Links: 3
```

            

### 7.3 符号链接（Symbolic
            Link）

            

符号链接（Symlink，软链接）是一种独立的文件类型，它的数据内容就是一个路径字符串。当内核在路径解析过程中遇到符号链接时，会读取链接的内容，然后继续解析目标路径。
            
```
符号链接的结构：

目录 /home/ltl:
┌──────────────────────┐
│ notes.txt  → inode 42│   ← 普通文件
│ shortcut   → inode 99│   ← 符号链接
└──────────────────────┘

inode 99（符号链接）：
┌─────────────────────────────┐
│ mode: lrwxrwxrwx            │
│ size: 9                     │  ← 路径字符串的长度
│ data: "notes.txt"           │  ← 路径字符串
└─────────────────────────────┘

访问 /home/ltl/shortcut 时：
1. VFS 解析路径，到达 inode 99
2. 发现 inode 99 是符号链接
3. 读取链接内容："notes.txt"
4. 重新从当前目录解析 "notes.txt"
5. 到达 inode 42，获取真正的文件数据
```

            

符号链接没有硬链接的限制：
            
            
- **可以跨文件系统**：符号链接存储的是路径字符串，不是
            inode 编号。
            
- **可以指向目录**：内核通过限制符号链接的递归解析深度（默认
            40 层）来防止无限循环。
            
            
```
# 创建符号链接
ln -s /home/ltl/notes.txt /home/ltl/shortcut

# 查看符号链接的详细信息
ls -l /home/ltl/shortcut
# 输出：lrwxrwxrwx 1 ltl ltl 22 Aug 20 10:00 shortcut -> /home/ltl/notes.txt

# 读取符号链接自身的内容
readlink /home/ltl/shortcut
# 输出：/home/ltl/notes.txt

# 获取符号链接的最终目标（解析所有中间链接）
readlink -f /home/ltl/shortcut
```

            

### 7.4 快速符号链接

            

如果符号链接的目标路径足够短（ext4 中通常 ≤ 60
            字节），路径字符串可以直接存储在 inode 的
            `i_block[15]` 数组中（60
            字节），不需要分配额外的数据块。这种优化称为快速符号链接（Fast
            Symlink）。
            
```
快速符号链接 vs 普通符号链接：

快速符号链接（目标路径 ≤ 60 字节）：
┌──────────────────────────────────┐
│ inode                            │
│   ...                            │
│   i_block[0..14]: "notes.txt\0"  │  ← 路径内联在 inode 中
│   ...                            │
└──────────────────────────────────┘
读取成本：0 次额外磁盘 I/O

普通符号链接（目标路径 > 60 字节）：
┌──────────────────────────────────┐
│ inode                            │
│   ...                            │
│   i_block[0]: → 数据块 5678      │  ← 指向存储路径的数据块
│   ...                            │
└──────────────────────────────────┘
数据块 5678:
┌────────────────────────────────────────┐
│ "/very/long/path/to/some/deeply/nested │
│ /directory/structure/file.txt\0"       │
└────────────────────────────────────────┘
读取成本：1 次额外磁盘 I/O
```

            

### 7.5 悬空符号链接

            

当符号链接的目标文件被删除或移动后，符号链接仍然存在，但指向一个不存在的路径。这种符号链接称为悬空符号链接（Dangling
            Symlink）。
            
```
# 创建符号链接
ln -s /home/ltl/notes.txt /home/ltl/shortcut

# 删除目标文件
rm /home/ltl/notes.txt

# 符号链接仍然存在，但指向无效路径
ls -l /home/ltl/shortcut
# 输出：lrwxrwxrwx 1 ltl ltl 22 Aug 20 10:00 shortcut -> /home/ltl/notes.txt
# （某些终端会用红色显示悬空链接）

# 尝试读取会报错
cat /home/ltl/shortcut
# 错误：No such file or directory

# 查找所有悬空符号链接
find /home/ltl -xtype l
# 或
find /home/ltl -type l ! -exec test -e {} \; -print
```

            

### 7.6
            硬链接与符号链接的对比

            
            
            
            特性
            硬链接
            符号链接
            
            
            
            
            本质
            目录项指向已有 inode
            独立文件，内容是路径字符串
            
            
            inode
            与原文件共享同一个 inode
            有自己独立的 inode
            
            
            跨文件系统
            不可以
            可以
            
            
            链接到目录
            不可以
            可以
            
            
            目标删除后
            数据仍可通过其他链接访问
            成为悬空链接
            
            
            磁盘开销
            仅一个目录项
            一个 inode + 可能的数据块
            
            
            性能
            无额外间接层
            需要额外的路径解析
            
            
            识别方式
            `ls -i` 看 inode 编号
            `ls -l` 显示 `l` 类型
            
            
            
            

### 7.7 实用命令汇总

            
```
# 创建硬链接
ln source_file hard_link_name

# 创建符号链接
ln -s target_path symlink_name

# 创建相对符号链接
ln -sr target_file symlink_name

# 读取符号链接目标
readlink symlink_name

# 递归解析符号链接（获取最终路径）
readlink -f symlink_name

# 查找所有硬链接（通过 inode 编号）
find /path -inum 12345

# 查找所有符号链接
find /path -type l

# 查找悬空符号链接
find /path -xtype l

# 跟随符号链接的 find 操作
find -L /path -name "*.txt"
```

            
            

## 八、文件系统内部结构探索

            

### 8.1 debugfs：ext
            文件系统的调试器

            

`debugfs` 是 ext2/ext3/ext4
            文件系统的交互式调试工具，可以直接查看和修改文件系统的内部数据结构。它以只读模式打开文件系统（除非显式指定
            `-w`），对排查问题非常有用。
            
```
# 以只读模式打开文件系统
sudo debugfs /dev/sda1

# 常用 debugfs 命令：
# 查看 inode 信息
debugfs: stat 
debugfs: stat /path/to/file

# 列出目录内容（显示 inode 编号）
debugfs: ls -l /home/ltl

# 显示 inode 的数据块映射
debugfs: blocks 

# 显示 inode 的 extent 树
debugfs: extents 

# 查看超级块信息
debugfs: stats

# 查看块组描述符
debugfs: show_super_stats

# 查看 htree 目录的内部结构
debugfs: htree_dump /home/ltl

# 查看日志（journal）内容
debugfs: logdump
```

            

实际使用示例——追踪一个文件的内部结构：
            
```
# 查看 /etc/passwd 的 inode 详情
sudo debugfs -R "stat /etc/passwd" /dev/sda1 2>/dev/null
```

            

输出示例：
            
```
Inode: 131074   Type: regular    Mode:  0644   Flags: 0x80000
Generation: 1234567890   Version: 0x00000001
User:     0   Group:     0   Project:     0   Size: 2745
File ACL: 0
Links: 1   Blockcount: 8
Fragment:  Address: 0    Number: 0    Size: 0
 ctime: 0x64e5a1b0:3b9ac9ff -- Wed Aug 23 09:20:30 2025
 atime: 0x64e6c3a0:075bcd15 -- Thu Aug 24 10:30:15 2025
 mtime: 0x64e5a1b0:3b9ac9ff -- Wed Aug 23 09:20:30 2025
 crtime: 0x63bd8c00:00000000 -- Tue Jan 10 14:00:00 2025
Size of extra inode fields: 32
Inode checksum: 0x12345678
EXTENTS:
(0):524288
```

            

### 8.2
            dumpe2fs：文件系统信息全景

            
```
# 查看文件系统概要信息
sudo dumpe2fs -h /dev/sda1 2>/dev/null

# 查看所有块组的信息
sudo dumpe2fs /dev/sda1 2>/dev/null | head -100

# 查看特定块组
sudo dumpe2fs /dev/sda1 2>/dev/null | grep -A 10 "Group 0"
```

            

块组信息输出示例：
            
```
Group 0: (Blocks 0-32767)
  Primary superblock at 0, Group descriptors at 1-1
  Reserved GDT blocks at 2-128
  Block bitmap at 129 (+129)
  Inode bitmap at 145 (+145)
  Inode table at 161-672 (+161)
  24513 free blocks, 8181 free inodes, 2 directories
  Free blocks: 8255-32767
  Free inodes: 12-8192
```

            

### 8.3 stat：一站式 inode
            查询

            
```
# 查看文件的 inode 信息
stat /home/ltl/notes.txt

# 格式化输出特定字段
stat --format='Inode: %i  Size: %s  Blocks: %b  Links: %h' /home/ltl/notes.txt

# 查看文件系统的 inode 和块统计
stat -f /home/ltl/notes.txt
```

            

`stat -f` 输出示例：
            
```
  File: "/home/ltl/notes.txt"
    ID: 801        Namelen: 255     Type: ext2/ext3
Block size: 4096   Fundamental block size: 4096
Blocks: Total: 26214400  Free: 18234567  Available: 17234567
Inodes: Total: 6553600   Free: 6123456
```

            

### 8.4 filefrag：碎片分析

            
```
# 查看文件的碎片情况
filefrag /var/log/syslog

# 详细输出（显示每个 extent）
filefrag -v /var/log/syslog

# 批量检查目录下所有文件的碎片
filefrag /var/log/*

# 输出示例：
# /var/log/syslog: 3 extents found
# /var/log/auth.log: 1 extent found
# /var/log/kern.log: 2 extents found
```

            

### 8.5 ls -i：查看 inode
            编号

            
```
# 显示 inode 编号
ls -i /home/ltl/

# 输出示例：
# 131074 notes.txt
# 131075 readme.md
# 131076 projects
# 131074 backup.txt    ← 与 notes.txt 相同的 inode（硬链接）

# 配合 -l 选项
ls -li /home/ltl/
```

            

### 8.6
            实战：从路径追踪到数据块

            

下面演示一个完整的追踪过程——从文件路径一步步到达磁盘上的数据块：
            
```
# 步骤 1：找到文件的 inode 编号
ls -i /etc/passwd
# 输出：131074 /etc/passwd

# 步骤 2：查看 inode 的详细信息
stat /etc/passwd

# 步骤 3：用 debugfs 查看 inode 的数据块映射
sudo debugfs -R "blocks " /dev/sda1 2>/dev/null
# 输出：524288

# 步骤 4：用 debugfs 查看 extent 详情
sudo debugfs -R "extents " /dev/sda1 2>/dev/null
# 输出：
# Level Entries    Logical      Physical Length Flags
#  0/ 0   1/  1     0 -     0  524288 - 524288      1

# 步骤 5：直接读取数据块的内容（仅用于验证，生产环境慎用）
sudo dd if=/dev/sda1 bs=4096 skip=524288 count=1 2>/dev/null | head -5
# 输出：文件的实际内容（应该看到 /etc/passwd 的前几行）

# 步骤 6：追踪路径解析过程
# /etc/passwd 的解析链：
# "/" → inode 2 → 查找 "etc" → inode X → 查找 "passwd" → inode 131074
sudo debugfs -R "ls -l " /dev/sda1 2>/dev/null | grep etc
# 输出显示 etc 目录的 inode 编号

# 步骤 7：查看目录 inode 的 htree 结构
sudo debugfs -R "htree_dump /etc" /dev/sda1 2>/dev/null | head -20
```

            

这个追踪过程揭示了文件系统的核心路径：
            
```
路径字符串 "/etc/passwd"
      │
      ▼
dentry 缓存查找（dcache lookup）
      │
      ├── 命中 → 直接获得 inode
      │
      └── 未命中 → 逐级解析
            │
            ▼
      根目录 dentry（inode 2）
            │
            ▼
      在根目录中查找 "etc"（读目录数据块）
            │
            ▼
      获得 etc 的 dentry 和 inode
            │
            ▼
      在 etc 目录中查找 "passwd"
            │
            ▼
      获得 passwd 的 dentry 和 inode（131074）
            │
            ▼
      从 inode 131074 读取 extent 信息
            │
            ▼
      extent: 逻辑块 0 → 物理块 524288，长度 1
            │
            ▼
      读取物理块 524288 的内容 → 返回给用户态
```

            
            

## 九、常见问题与排查

            

### 9.1 “No
            space left on device”——但磁盘明明有空间

            

这是 Linux
            系统管理中最经典的排查场景之一。`df -h`
            显示文件系统还有充足的空间，但创建文件或写入数据时却报 “No
            space left on device” 错误。
            

**原因 1：inode 耗尽**
            
```
# 检查 inode 使用情况
df -i /

# 如果 IUse% 接近或等于 100%，说明 inode 已耗尽
# Filesystem      Inodes  IUsed   IFree IUse% Mounted on
# /dev/sda1     6553600 6553598       2  100% /

# 解决方案：找到并清理大量小文件
sudo find / -xdev -type f | wc -l
sudo find / -xdev -printf '%h\n' | sort | uniq -c | sort -rn | head -10
```

            

**原因 2：已删除但仍被打开的文件**
            

当一个文件被删除（`unlink`）但仍有进程持有其文件描述符时，文件的磁盘空间不会被释放。`df`
            的 Used
            计数不包括这些文件（因为目录项已删除），但实际空间仍被占用。
            
```
# 查找被删除但仍打开的文件
sudo lsof +L1

# 输出示例：
# COMMAND   PID   USER   FD   TYPE DEVICE  SIZE/OFF NLINK  NODE NAME
# nginx    1234   root   12u   REG    8,1 2147483648     0 12345 /var/log/nginx/access.log (deleted)

# 解决方案：重启持有该文件的进程
# 或使用 truncate 清空文件内容（不关闭文件描述符）
```

            

**原因 3：保留块（Reserved Blocks）**
            

ext4 默认预留 5% 的磁盘空间给 root
            用户，防止普通用户将磁盘填满导致系统无法运行。当普通用户看到
            “No space left on device” 时，root
            用户可能仍然可以写入。
            
```
# 查看保留块的比例
sudo tune2fs -l /dev/sda1 | grep "Reserved block count"

# 调整保留块比例（生产环境中大容量磁盘可以降低到 1%）
sudo tune2fs -m 1 /dev/sda1
```

            

### 9.2 大目录性能退化

            

**症状**：`ls`
            一个目录需要几秒甚至几十秒；`rm -r`
            一个包含大量文件的目录极慢。
            

**诊断**：
            
```
# 统计目录中的文件数量
ls -f /path/to/large/dir | wc -l

# 查看目录自身的大小（目录数据块的总大小，不是内容的大小）
ls -ld /path/to/large/dir
# -d 标志只显示目录本身的信息

# 查看目录是否使用了 htree
sudo debugfs -R "htree_dump /path/to/large/dir" /dev/sda1 2>/dev/null
```

            

**缓解措施**：
            
```
# 1. 避免使用 ls（它会排序），改用 ls -f（不排序）或 find
ls -f /path/to/large/dir | head

# 2. 使用 find + xargs 替代 rm -r（减少内存压力）
find /path/to/large/dir -type f -delete

# 3. 对于需要删除整个目录的情况，考虑直接删除底层文件系统结构
# （极端情况下，重新创建文件系统可能比删除快）

# 4. 预防措施：使用分桶目录结构
```

            

### 9.3 硬链接计数限制

            

ext4 的硬链接计数存储在一个 16
            位字段中（`i_links_count`），理论上限为
            65535。当一个目录下的子目录数量接近这个上限时（每个子目录的
            `..` 都是父目录的一个硬链接），就会触发 “Too many
            links” 错误。
            
```
# 检查目录的链接计数
stat /some/directory | grep Links

# ext4 启用 dir_nlink 特性后，当链接计数达到 65000 时
# 会将链接计数设置为 1（表示"未知"），允许继续创建子目录
# 但此时某些工具可能无法正确报告链接计数
sudo tune2fs -l /dev/sda1 | grep dir_nlink
```

            

XFS 没有这个限制——它使用 32 位链接计数字段，支持最多 40
            亿个硬链接。
            

### 9.4 lost+found 目录

            

`lost+found` 是 ext
            系列文件系统在格式化时自动创建的特殊目录，位于文件系统的根目录下。当
            `fsck`（File System
            Check）修复文件系统时，如果发现了一些有数据但没有目录项指向它们的
            inode（即”孤儿 inode”），就会将这些文件放入
            `lost+found` 目录中，以 inode
            编号作为文件名。
            
```
# 查看 lost+found 目录
ls -la /lost+found/

# 如果 fsck 恢复了文件，会看到类似：
# drwxr-xr-x 2 root root 16384 Jan  1 00:00 .
# drwxr-xr-x 23 root root  4096 Aug 20 10:00 ..
# -rw-r--r-- 1 root root  12345 Jul 15 09:30 #12345
# -rw-r--r-- 1 root root  67890 Jul 20 14:20 #67890

# 恢复后需要手动检查这些文件的内容，确定它们原本属于哪里
file /lost+found/#12345
```

            

`lost+found`
            目录在格式化时会预分配数据块，确保在文件系统损坏的情况下仍然有空间存放恢复的文件。这也是为什么不应该删除这个目录。
            

### 9.5 fsck 基础

            

`fsck`（File System
            Check）是文件系统一致性检查和修复工具。它通过扫描文件系统的元数据结构（超级块、inode
            表、块位图、目录结构），检测并修复不一致性。
            
```
# 对 ext4 文件系统运行 fsck（必须先卸载或以只读方式挂载）
sudo umount /dev/sda1
sudo e2fsck -f /dev/sda1

# 自动修复所有问题（生产环境慎用）
sudo e2fsck -fy /dev/sda1

# 只检查不修复（只读模式）
sudo e2fsck -n /dev/sda1

# XFS 的修复工具
sudo xfs_repair /dev/sdb1

# Btrfs 的检查工具
sudo btrfs check /dev/sdc1
```

            

`fsck` 检查的主要内容包括：
            
            
- **超级块一致性**：魔数、块大小、inode
            计数等是否合理。
            
- **inode 状态**：inode
            的字段值是否在合法范围内。
            
- **块位图一致性**：已分配块和空闲块的位图是否与实际
            inode 引用一致。
            
- **inode 位图一致性**：已分配 inode 和空闲
            inode 的位图是否正确。
            
- **目录结构**：目录项是否指向有效的
            inode；`.` 和 `..` 是否正确。
            
- **链接计数**：inode
            的链接计数是否与实际指向它的目录项数量一致。
            
- **孤儿
            inode**：是否存在没有目录项指向但已分配的
            inode。
            
            

现代文件系统（ext4、XFS、Btrfs）都支持日志（Journal）机制，在正常关机和启动过程中通过重放日志来恢复一致性，大大减少了
            `fsck`
            全量扫描的需求。只有在日志无法恢复的严重损坏情况下，才需要运行完整的
            `fsck`。
            
            

## 十、性能考量与最佳实践

            

### 10.1 inode 与块大小的选择

            

格式化文件系统时，块大小和 inode
            密度的选择对性能和空间利用率有直接影响：
            
```
# 大量小文件（邮件服务器、缓存）
# 使用较小的 inode 间距，确保 inode 充足
sudo mkfs.ext4 -i 4096 -b 4096 /dev/sdb1

# 大文件为主（视频存储、数据库）
# 使用较大的 inode 间距，减少 inode 表占用的空间
sudo mkfs.ext4 -i 65536 -b 4096 /dev/sdb1

# XFS 的情况：inode 动态分配，不需要预先规划
sudo mkfs.xfs /dev/sdb1
```

            

### 10.2 目录组织策略

            
```
# 避免单目录下放置超过 10 万个文件
# 使用两级哈希分桶：
# 文件名的 MD5 前 4 个字符作为两级目录
# 例如：文件 "report.pdf" 的 MD5 = "abc123..."
# 存储路径：/data/ab/c1/report.pdf
```

            

### 10.3 挂载选项调优

            
```
# 关闭 atime 更新（减少不必要的元数据写入）
mount -o noatime /dev/sda1 /mnt/data

# 使用 relatime（只在 mtime 比 atime 新时更新 atime）
mount -o relatime /dev/sda1 /mnt/data

# 启用 discard（SSD TRIM 支持）
mount -o discard /dev/sda1 /mnt/data

# 在 /etc/fstab 中配置
# /dev/sda1  /mnt/data  ext4  defaults,noatime,discard  0  2
```

            
            

## 参考文献

            
            
- 

Bovet, Daniel P. and Marco Cesati. “Understanding the
            Linux Kernel.” 3rd Edition, O’Reilly Media, 2005.
            第十二章：Virtual Filesystem.
            
- 

Love, Robert. “Linux Kernel Development.” 3rd
            Edition, Addison-Wesley, 2010. 第十三章：The Virtual
            Filesystem.
            
- 

Mathur, Avantika, Mingming Cao, et al. “The New ext4
            Filesystem: Current Status and Future Plans.” Proceedings of
            the Linux Symposium, 2007.
            
- 

Ts’o, Theodore and Stephen Tweedie. “Planned
            Extensions to the Linux Ext2/Ext3 Filesystem.” Proceedings
            of the FREENIX Track, USENIX Annual Technical Conference,
            2002.
            
- 

Sweeney, Adam, et al. “Scalability in the XFS File
            System.” Proceedings of the USENIX Annual Technical
            Conference, 1996.
            
- 

Linux 内核源码：`fs/ext4/` 目录，特别是
            `super.c`、`inode.c`、`namei.c`、`extents.c`.
            版本 6.1. https://elixir.bootlin.com/linux/v6.1/source/fs/ext4
            
- 

Linux 内核源码：`include/linux/fs.h`（VFS
            核心数据结构定义）. https://elixir.bootlin.com/linux/v6.1/source/include/linux/fs.h
            
- 

Linux
            内核源码：`include/linux/dcache.h`（dentry
            缓存定义）. https://elixir.bootlin.com/linux/v6.1/source/include/linux/dcache.h
            
- 

Linux
            内核文档：`Documentation/filesystems/ext4/`. https://www.kernel.org/doc/html/latest/filesystems/ext4/
            
- 

Card, Rémy, Theodore Ts’o, and Stephen Tweedie.
            “Design and Implementation of the Second Extended
            Filesystem.” Proceedings of the First Dutch International
            Symposium on Linux, 1994.
            
- 

McKusick, Marshall Kirk, et al. “A Fast File System
            for UNIX.” ACM Transactions on Computer Systems,
            2(3):181-197, 1984.
            
- 

Hellwig, Christoph. “XFS: The Big Storage File System
            for Linux.” USENIX ;login: Magazine, 2009.
            
            
            

**上一篇**: 数据完整性：从
            fsync 到端到端校验 **下一篇**: ext4
            架构与调优
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。
                

                
                    

2026-05-08 · os
                    

### 【操作系统百科】VFS 四层抽象

                    

Linux 的一切皆文件靠 VFS 实现——superblock、inode、dentry、file 四层抽象加 ops 表。本文讲 VFS 核心数据结构、dcache、inode cache、RCU lookup，以及文件系统如何插入 VFS。
                

                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。
                

                
                    

2025-08-23 · storage
                    

### 【存储工程】ext4 架构与调优

                    

ext4 是 Linux 世界中使用最广泛的本地文件系统（Local Filesystem）。从 2008 年合入内核主线至今， 它已经在无数生产服务器、嵌入式设备以及桌面系统上稳定运行了十余年。本文将从磁盘布局、 核心数据结构、日志机制、分配策略等维度，对 ext4 进行全面剖析，并结合实际调优场景给出 可落地的最佳…