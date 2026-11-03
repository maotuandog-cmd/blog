# 【存储工程】Linux I/O 栈全景：从 write() 到磁盘扇区

来源: https://quant67.com/post/storage/07-linux-io-stack/linux-io-stack.html
日期: 2025-08-16 |

---

## 一、I/O 栈全景概览

            

当应用程序调用一次 `write()` 系统调用（System
            Call）时，数据并不会立刻落到磁盘扇区上。
            它需要穿越内核中七个以上的软件层次，每一层都有独立的职责、数据结构和延迟开销。
            理解这条完整路径，是进行存储性能调优和故障诊断的基础。
            

### 1.1 完整路径纵览

            

从用户态到硬件，一次写操作的完整路径如下：
            
```
用户态应用程序
  │  write(fd, buf, len)
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  系统调用入口（syscall entry）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ▼
┌─────────────────────────────────┐
│  VFS 层（Virtual File System）  │
│  统一文件操作接口                │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  文件系统层（ext4 / XFS / ...） │
│  逻辑块 → 物理块映射             │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Page Cache 层                  │
│  内存缓存、脏页管理              │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  块设备层（Block Layer）         │
│  bio 构造、请求合并              │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  I/O 调度器（I/O Scheduler）    │
│  排序、合并、优先级              │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  设备驱动（Device Driver）      │
│  SCSI / NVMe 命令构造           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  硬件控制器 → 磁盘介质           │
│  DMA 传输、扇区写入             │
└─────────────────────────────────┘
```

            

### 1.2 各层延迟预算

            

在一块典型的企业级 NVMe 固态硬盘（Solid State
            Drive）上，各层延迟的量级大致如下：
            
```
层次                        典型延迟           占比
────────────────────────────────────────────────────
系统调用入口/返回            ~0.2 μs           
            
- 

**缓冲写（Buffered
            Write）**：数据先写入页缓存（Page Cache），
            由内核在后台异步刷盘。`write()`
            返回时数据可能还未落盘。
            这是默认模式，延迟最低，但存在数据丢失风险。
            
- 

**直接写（Direct I/O）**：通过
            `O_DIRECT` 标志绕过页缓存，
            数据从用户态缓冲区直接提交到块设备层。延迟更高但可预测，
            数据库等对一致性要求严格的应用通常使用此模式。
            
            

此外，`O_SYNC` 和 `fsync()`
            可以强制将数据和元数据刷到持久存储，
            但这会显著增加延迟，因为需要等待硬件确认写入完成。
            

## 二、VFS 层：统一文件接口

            

虚拟文件系统（Virtual File System）是 Linux
            内核中最重要的抽象层之一。
            它为上层提供统一的文件操作接口，使得应用程序无需关心底层使用的是
            ext4、XFS、Btrfs 还是网络文件系统（Network File
            System）。
            

### 2.1 VFS 四大核心对象

            

VFS 围绕四个核心数据结构组织：
            

**超级块（Superblock）**
            

超级块描述一个已挂载文件系统的全局信息，包括块大小、文件系统类型、
            最大文件大小、挂载选项等。每个挂载点对应一个
            `super_block` 结构体。
            
```
struct super_block {
    struct list_head    s_list;        /* 所有超级块的链表 */
    dev_t               s_dev;         /* 设备标识符 */
    unsigned long       s_blocksize;   /* 块大小（字节） */
    loff_t              s_maxbytes;    /* 最大文件大小 */
    struct file_system_type *s_type;   /* 文件系统类型 */
    const struct super_operations *s_op; /* 超级块操作表 */
    struct dentry       *s_root;       /* 根目录项 */
    /* ... 省略其他字段 ... */
};
```

            

**索引节点（Inode）**
            

索引节点代表文件系统中的一个对象（文件、目录、符号链接等），
            包含文件的元数据信息：权限、大小、时间戳、数据块位置等。
            注意 VFS 层的 inode 是内存中的结构，与磁盘上的 inode
            有所区别。
            
```
struct inode {
    umode_t             i_mode;        /* 文件类型和权限 */
    kuid_t              i_uid;         /* 所有者 UID */
    kgid_t              i_gid;         /* 所有者 GID */
    unsigned int        i_flags;       /* 文件系统标志 */
    const struct inode_operations *i_op;   /* inode 操作表 */
    const struct file_operations  *i_fop;  /* 默认文件操作表 */
    struct super_block  *i_sb;         /* 所属超级块 */
    struct address_space *i_mapping;   /* 关联的地址空间 */
    loff_t              i_size;        /* 文件大小（字节） */
    struct timespec64   i_atime;       /* 最后访问时间 */
    struct timespec64   i_mtime;       /* 最后修改时间 */
    struct timespec64   i_ctime;       /* 最后变更时间 */
    /* ... 省略其他字段 ... */
};
```

            

**目录项（Dentry）**
            

目录项是文件路径中的一个分量，用于加速路径名查找。
            内核维护了一个目录项缓存（Dentry
            Cache），避免重复遍历磁盘目录结构。
            
```
struct dentry {
    unsigned int        d_flags;       /* 目录项标志 */
    struct dentry       *d_parent;     /* 父目录项 */
    struct qstr         d_name;        /* 名称 */
    struct inode        *d_inode;      /* 关联的 inode */
    const struct dentry_operations *d_op; /* 目录项操作表 */
    struct super_block  *d_sb;         /* 所属超级块 */
    /* ... 省略其他字段 ... */
};
```

            

**文件对象（File）**
            

文件对象代表一个进程打开的文件实例。同一个文件被不同进程打开时，
            每个进程拥有独立的文件对象，但共享同一个 inode。
            
```
struct file {
    struct path         f_path;        /* 路径（包含 vfsmount 和 dentry） */
    struct inode        *f_inode;      /* 关联的 inode */
    const struct file_operations *f_op; /* 文件操作表 */
    atomic_long_t       f_count;       /* 引用计数 */
    unsigned int        f_flags;       /* 打开标志（O_RDWR 等） */
    fmode_t             f_mode;        /* 访问模式 */
    loff_t              f_pos;         /* 当前偏移量 */
    struct address_space *f_mapping;   /* 页缓存地址空间 */
    /* ... 省略其他字段 ... */
};
```

            

### 2.2 操作函数表

            

VFS 通过函数指针表实现多态分发（Polymorphic Dispatch）。
            每个具体文件系统在注册时填充自己的函数指针：
            

**file_operations**：定义文件级操作
            
```
struct file_operations {
    loff_t (*llseek)(struct file *, loff_t, int);
    ssize_t (*read_iter)(struct kiocb *, struct iov_iter *);
    ssize_t (*write_iter)(struct kiocb *, struct iov_iter *);
    int (*mmap)(struct file *, struct vm_area_struct *);
    int (*open)(struct inode *, struct file *);
    int (*flush)(struct file *, fl_owner_t);
    int (*release)(struct inode *, struct file *);
    int (*fsync)(struct file *, loff_t, loff_t, int);
    /* ... */
};
```

            

**inode_operations**：定义 inode 级操作
            
```
struct inode_operations {
    struct dentry *(*lookup)(struct inode *, struct dentry *, unsigned int);
    int (*create)(struct mnt_idmap *, struct inode *, struct dentry *, umode_t, bool);
    int (*link)(struct dentry *, struct inode *, struct dentry *);
    int (*unlink)(struct inode *, struct dentry *);
    int (*mkdir)(struct mnt_idmap *, struct inode *, struct dentry *, umode_t);
    int (*rmdir)(struct inode *, struct dentry *);
    /* ... */
};
```

            

### 2.3 VFS 分发机制

            

当用户调用 `write()`
            时，内核的执行路径如下：
            
```
用户态: write(fd, buf, count)
         │
         ▼
sys_write(fd, buf, count)          /* 系统调用入口 */
         │
         ▼
ksys_write(fd, buf, count)         /* 内部实现 */
  ├── fdget_pos(fd)                /* 通过 fd 查找 file 对象 */
  │     └── current->files->fdt->fd[fd]
  └── vfs_write(file, buf, count, &pos)
         │
         ▼
vfs_write()
  ├── rw_verify_area()             /* 权限和区域检查 */
  └── new_sync_write() 或 call_write_iter()
         │
         ▼
file->f_op->write_iter(kiocb, iov_iter)
         │
         ▼
ext4_file_write_iter()  /  xfs_file_write_iter()  /  ...
```

            

这里的关键在于 `file->f_op->write_iter`
            这一行：VFS 通过文件对象中存储的
            函数指针表，将调用分发到具体文件系统的实现。这是经典的面向对象设计在
            C 语言中的体现。
            

### 2.4 文件描述符查找

            

从文件描述符（File
            Descriptor）到文件对象的查找过程值得单独说明。
            每个进程维护一个文件描述符表（File Descriptor Table），
            本质上是一个指针数组，下标就是文件描述符的值：
            
```
/* 简化的查找过程 */
struct file *fget(unsigned int fd)
{
    struct files_struct *files = current->files;
    struct fdtable *fdt = rcu_dereference(files->fdt);

    if (fd max_fds) {
        struct file *file = rcu_dereference(fdt->fd[fd]);
        if (file)
            get_file(file);  /* 增加引用计数 */
        return file;
    }
    return NULL;
}
```

            

整个查找过程在
            RCU（Read-Copy-Update）保护下完成，开销极低。
            

## 三、文件系统层

            

文件系统层负责将逻辑文件操作转换为对底层块设备的物理操作。
            核心任务包括：逻辑块到物理块的映射、空间分配、元数据管理和一致性保证。
            

### 3.1 逻辑块与物理块映射

            

文件在逻辑上是一段连续的字节流，但在磁盘上可能分散存储在不同的物理块中。
            文件系统的核心数据结构之一就是维护这种映射关系。
            

**ext4 的 Extent 方式**
            

ext4 使用区段（Extent）来描述连续的物理块范围：
            
```
struct ext4_extent {
    __le32  ee_block;      /* 逻辑块号（文件内偏移） */
    __le16  ee_len;        /* 连续块数 */
    __le16  ee_start_hi;   /* 物理块号高 16 位 */
    __le32  ee_start_lo;   /* 物理块号低 32 位 */
};
```

            

一个 Extent 可以描述最多 32768 个连续块（128 MB，按 4 KB
            块大小计算）。 对于顺序写入的大文件，可能只需要少量 Extent
            就能描述整个文件， 查找效率远高于传统的间接块（Indirect
            Block）映射。
            

ext4 将 Extent 组织为一棵 B+ 树（B+
            Tree）。当文件较小时， 所有 Extent 可以直接存储在 inode
            中（最多 4 个）。 当文件变大时，自动扩展为多级索引结构。
            
```
ext4 Extent B+ 树结构：

inode
├── extent_header (depth=1)
├── extent_idx → 指向叶子节点块
│     ├── extent_header (depth=0)
│     ├── extent: 逻辑块 0-127   → 物理块 1000-1127
│     ├── extent: 逻辑块 128-511 → 物理块 2000-2383
│     └── extent: 逻辑块 512-639 → 物理块 5000-5127
└── extent_idx → 指向另一个叶子节点块
      └── ...
```

            

**XFS 的 B+ 树方式**
            

XFS 同样使用 Extent
            来描述连续块范围，但其索引结构更加精细。 XFS
            为每个文件维护独立的 B+
            树，支持更大规模的文件和更高效的查找。 XFS
            的分配组（Allocation Group）机制还允许并行分配，
            在多线程写入场景下性能优势明显。
            
```
XFS Extent 记录（128 位）：
┌──────────────────────────────────────────────────────┐
│ 逻辑偏移（54 位）│ 物理块号（52 位）│ 块数（21 位）│标志│
└──────────────────────────────────────────────────────┘
```

            

### 3.2 日志（Journaling）机制

            

文件系统的元数据操作（如创建文件、修改目录、更新
            inode）涉及多个块的修改。
            如果在操作中途发生掉电或崩溃，文件系统可能处于不一致状态。
            预写日志（Write-Ahead
            Log）机制通过先将修改记录到日志区域来解决这个问题。
            

**ext4 的 JBD2 日志**
            

ext4 使用 JBD2（Journaling Block Device
            2）子系统管理日志。 日志操作的基本流程如下：
            
```
1. 开始事务（Transaction Begin）
2. 将要修改的元数据块写入日志区域（Journal Area）
3. 提交事务（Transaction Commit）— 写入提交记录
4. 将元数据块写入最终位置（Checkpoint）
5. 释放日志空间
```

            

ext4 支持三种日志模式：
            
```
日志模式              日志内容              性能        安全性
─────────────────────────────────────────────────────────────
journal              元数据 + 数据          最低        最高
ordered（默认）      仅元数据              中等        中等
writeback            仅元数据              最高        最低
```

            
            
- `journal`
            模式：元数据和文件数据都经过日志，安全但性能最差。
            
- `ordered`
            模式：只有元数据经过日志，但保证数据先于元数据落盘。
            
- `writeback`
            模式：只有元数据经过日志，数据写入顺序不保证。
            
            

可通过挂载选项切换：
            
```
# 查看当前日志模式
cat /proc/fs/ext4/sda1/options | grep journal

# 以 ordered 模式挂载
mount -o data=ordered /dev/sda1 /mnt

# 以 writeback 模式挂载（高性能场景）
mount -o data=writeback /dev/sda1 /mnt
```

            

### 3.3 延迟分配（Delayed
            Allocation）

            

传统文件系统在 `write()`
            调用时就立即分配磁盘块。 ext4 和 XFS
            都实现了延迟分配（Delayed Allocation）：
            写操作只将数据放入页缓存并标记为脏页，块分配推迟到实际刷盘时进行。
            

延迟分配的优势：
            
            
- **减少碎片**：积累多个写操作后一次性分配，更容易分配连续块。
            
- **减少元数据更新**：临时文件可能在刷盘前就被删除，节省了不必要的块分配和回收。
            
- **提高吞吐**：批量分配减少了分配器的锁竞争。
            
            
```
延迟分配流程：

write() 调用时：
  1. 数据复制到 Page Cache
  2. 页面标记为脏（dirty）
  3. 记录 "需要 N 个块" 的预留信息
  4. 不分配实际磁盘块 → 返回

刷盘时（writeback 触发）：
  1. 查找连续的脏页范围
  2. 一次性分配连续磁盘块
  3. 构造 bio 提交 I/O
  4. 更新 Extent 树
```

            

但延迟分配也有风险：如果系统在刷盘前崩溃，已写入页缓存但未落盘的数据会丢失。
            对于需要持久化保证的场景，必须显式调用 `fsync()`
            或使用 `O_SYNC` 标志。
            

### 3.4 ext4
            写路径的关键函数

            

以 ext4
            为例，一次缓冲写操作在文件系统层的关键函数调用链：
            
```
ext4_file_write_iter()
  └── ext4_buffered_write_iter()
        └── generic_perform_write()
              ├── ext4_write_begin()
              │     ├── grab_cache_page_write_begin()  /* 获取/分配页面 */
              │     └── ext4_journal_start()           /* 开始日志事务 */
              ├── copy_page_from_iter()                /* 用户数据 → 页缓存 */
              └── ext4_write_end()
                    ├── ext4_journal_stop()             /* 结束日志事务 */
                    └── mark_inode_dirty()              /* 标记 inode 脏 */
```

            

## 四、Page Cache 层

            

页缓存（Page Cache）是 Linux 存储子系统的核心缓存机制。
            它以内存页（通常 4 KB）为单位缓存文件数据，
            位于文件系统层和块设备层之间，对上下两层都透明。
            

### 4.1 缓冲写入过程

            

一次典型的缓冲写操作在页缓存层的处理过程：
            
```
write(fd, buf, 8192)  — 写入 8192 字节（2 个页面）

步骤 1：查找或创建页面
  ├── 计算文件偏移对应的页索引：index = offset >> PAGE_SHIFT
  ├── 在 address_space 的 xarray 中查找页面
  ├── 如果命中：直接使用
  └── 如果未命中：分配新页面并插入 xarray

步骤 2：数据复制
  └── copy_from_user(page_address + offset_in_page, user_buf, len)

步骤 3：标记脏页
  ├── SetPageDirty(page)
  ├── __set_page_dirty_nobuffers() 或 __set_page_dirty_buffers()
  └── 将页面加入 inode 的脏页链表

步骤 4：返回用户态
  └── write() 系统调用返回，数据尚未落盘
```

            

### 4.2 地址空间与 xarray

            

每个 inode 关联一个地址空间（Address
            Space）对象，用于管理该文件的所有缓存页。
            地址空间的核心索引结构是 xarray（原来使用基数树 Radix Tree，
            在内核 4.20 版本后迁移到 xarray）。
            
```
struct address_space {
    struct inode        *host;          /* 所属 inode */
    struct xarray       i_pages;       /* 页面索引（xarray） */
    atomic_t            i_mmap_writable; /* 可写映射计数 */
    struct rb_root_cached i_mmap;      /* 私有和共享映射 */
    unsigned long       nrpages;       /* 总页面数 */
    const struct address_space_operations *a_ops; /* 操作表 */
    gfp_t               gfp_mask;      /* 页面分配标志 */
    /* ... */
};
```

            

xarray
            是一种紧凑的基数树实现，支持高效的按索引查找、插入和范围操作。
            页面查找的时间复杂度为 O(log n)，其中 n 是文件的页面数。
            
```
/* 页面查找示意 */
struct folio *filemap_get_folio(struct address_space *mapping,
                                pgoff_t index)
{
    struct folio *folio;

    folio = xa_load(&mapping->i_pages, index);
    if (folio && !folio_try_get(folio))
        folio = NULL;

    return folio;
}
```

            

### 4.3 预读算法（Readahead）

            

对于顺序读取模式，内核实现了自适应预读（Adaptive
            Readahead）算法，
            在应用程序请求数据之前就预先将后续数据加载到页缓存中。
            
```
预读窗口示意：

文件偏移 ─────────────────────────────────────────────→

        │← 当前窗口 →│← 预读窗口 →│
        ├─────────────┼────────────┤
        │ 已读取/正在  │ 异步预读    │
        │ 读取的页面    │ 正在加载    │
        ├─────────────┼────────────┤

初始预读大小：    通常为 128 KB（32 页）
最大预读大小：    /sys/block//queue/read_ahead_kb（默认 128 KB）
增长策略：        检测到顺序模式后，窗口逐步增大至最大值
```

            

预读参数可以动态调整：
            
```
# 查看当前预读大小
cat /sys/block/sda/queue/read_ahead_kb

# 增大预读窗口（适用于大文件顺序读取场景）
echo 2048 > /sys/block/sda/queue/read_ahead_kb

# 使用 blockdev 命令设置
blockdev --setra 4096 /dev/sda   # 单位为 512 字节扇区，4096 = 2048 KB
```

            

对于数据库等随机读取场景，过大的预读窗口反而浪费内存和
            I/O 带宽， 应当适当减小预读值。
            

### 4.4 脏页回写机制

            

脏页不会一直留在内存中，内核通过多种机制触发回写（Writeback）：
            

**周期性回写**：内核线程
            `kworker` 定期扫描脏页。
            

**阈值触发回写**：当脏页比例超过阈值时触发。
            
```
# 查看当前脏页相关参数
sysctl vm.dirty_ratio
sysctl vm.dirty_background_ratio
sysctl vm.dirty_expire_centisecs
sysctl vm.dirty_writeback_centisecs
```

            

各参数的含义和默认值：
            
```
参数                            默认值    含义
──────────────────────────────────────────────────────────────────
vm.dirty_ratio                  20       脏页占可用内存的百分比上限；
                                         超过此阈值，写操作将同步等待回写
vm.dirty_background_ratio       10       后台回写启动阈值；
                                         脏页超过此比例，后台线程开始刷盘
vm.dirty_expire_centisecs       3000     脏页过期时间（30 秒）；
                                         超过此时间的脏页会被优先回写
vm.dirty_writeback_centisecs    500      回写线程唤醒间隔（5 秒）
```

            

回写的触发时机：
            
```
1. 后台回写：脏页比例 > dirty_background_ratio
   └── 由 kworker 线程异步执行，不阻塞写操作

2. 前台回写：脏页比例 > dirty_ratio
   └── write() 调用被阻塞，直到脏页比例降下来

3. 周期回写：每 dirty_writeback_centisecs 检查一次
   └── 回写过期脏页（存在时间 > dirty_expire_centisecs）

4. 显式回写：fsync() / fdatasync() / sync()
   └── 等待指定文件/所有文件的脏页全部落盘

5. 内存压力回写：可用内存不足时
   └── 由 kswapd / direct reclaim 触发
```

            

针对高吞吐写入场景的调优示例：
            
```
# 增大脏页阈值，允许更多数据缓存在内存中
sysctl -w vm.dirty_ratio=40
sysctl -w vm.dirty_background_ratio=10

# 对于有 UPS 保护的系统，可适当延长过期时间
sysctl -w vm.dirty_expire_centisecs=6000

# 对于数据安全要求高的场景，减小阈值和过期时间
sysctl -w vm.dirty_ratio=5
sysctl -w vm.dirty_background_ratio=2
sysctl -w vm.dirty_expire_centisecs=500
```

            

### 4.5 页缓存的内存统计

            

可以通过以下方式查看页缓存的使用情况：
            
```
# 查看整体内存使用（Cached 即页缓存大小）
free -h

# 详细信息
cat /proc/meminfo | grep -E "Cached|Dirty|Writeback"

# 输出示例：
# Cached:          8234576 kB
# Dirty:              1284 kB
# Writeback:             0 kB
```

            
```
# 查看特定文件的缓存状态（需要 vmtouch 工具）
vmtouch /var/log/syslog
# 输出示例：
#            Files: 1
#      Directories: 0
#   Resident Pages: 128/256  50%
#          Elapsed: 0.001 seconds
```

            

## 五、块设备层（Block
            Layer）

            

块设备层是页缓存和设备驱动之间的桥梁。
            它将文件系统的块级操作封装成标准的 I/O 请求，
            并通过合并、排序等优化减少实际发送给设备的命令数量。
            

### 5.1 bio 结构——基本 I/O
            单元

            

bio（Block I/O）是块设备层最基本的数据结构，
            描述一次从连续逻辑块地址到内存页面的映射：
            
```
struct bio {
    struct bio          *bi_next;      /* 链表中的下一个 bio */
    struct block_device *bi_bdev;      /* 目标块设备 */
    unsigned int        bi_opf;        /* 操作类型和标志 */
    unsigned short      bi_flags;      /* bio 标志 */
    unsigned short      bi_ioprio;     /* I/O 优先级 */
    sector_t            bi_iter.bi_sector;  /* 起始扇区号 */
    unsigned int        bi_iter.bi_size;    /* 剩余字节数 */
    struct bio_vec      *bi_io_vec;    /* bio_vec 数组 */
    unsigned short      bi_vcnt;       /* bio_vec 数量 */
    unsigned short      bi_max_vecs;   /* 最大 bio_vec 数 */
    bio_end_io_t        *bi_end_io;    /* 完成回调函数 */
    void                *bi_private;   /* 私有数据 */
    /* ... */
};
```

            

每个 `bio_vec`
            描述一个内存页面中的一段数据：
            
```
struct bio_vec {
    struct page  *bv_page;     /* 内存页面 */
    unsigned int  bv_len;      /* 数据长度 */
    unsigned int  bv_offset;   /* 页内偏移 */
};
```

            

一个 bio 可以包含多个
            bio_vec，实现分散/聚集（Scatter/Gather）I/O。
            

### 5.2 请求合并与 Plugging

            

当多个相邻的 bio
            提交时，块设备层会尝试将它们合并成一个更大的请求（Request），
            减少发送给设备的命令数量。
            

**前向合并（Front Merge）**：新 bio
            的结束位置与现有请求的起始位置相邻。 **后向合并（Back
            Merge）**：新 bio
            的起始位置与现有请求的结束位置相邻。
            
```
合并示意：

请求队列中已有：[扇区 100-200]

新 bio 到达：[扇区 200-300]
  → 后向合并：[扇区 100-300]

新 bio 到达：[扇区 50-100]
  → 前向合并：[扇区 50-300]
```

            

**Plugging 机制**
            

为了给合并操作留出时间窗口，内核使用了 plugging
            机制：
            
```
1. 线程开始提交 I/O 时，创建一个 "plug"
2. 后续的 bio 暂存在 plug 列表中，不立即发送
3. 线程主动 "unplug" 或调度出去时，批量提交所有暂存的 bio
4. 批量提交时进行合并和排序优化
```

            
```
/* Plugging 使用示例（内核代码） */
struct blk_plug plug;

blk_start_plug(&plug);
/* 提交多个 bio */
submit_bio(bio1);
submit_bio(bio2);
submit_bio(bio3);
blk_finish_plug(&plug);  /* 批量提交并合并 */
```

            

### 5.3 bio 到 request
            的转换

            

bio 是面向数据的结构，而 request 是面向设备的结构。
            块设备层将一个或多个 bio 合并成一个 request：
            
```
struct request {
    struct request_queue *q;           /* 所属请求队列 */
    struct blk_mq_ctx   *mq_ctx;      /* 多队列上下文 */
    struct blk_mq_hw_ctx *mq_hctx;    /* 硬件队列上下文 */
    sector_t             __sector;     /* 起始扇区 */
    unsigned int         __data_len;   /* 数据总长度 */
    struct bio           *bio;         /* 第一个 bio */
    struct bio           *biotail;     /* 最后一个 bio */
    /* ... */
};
```

            

### 5.4 多队列架构（blk-mq）

            

传统的单队列块设备层在多核系统上存在严重的锁竞争问题。
            从内核 3.13 开始引入的多队列块设备层（Multi-Queue Block
            Layer，简称 blk-mq）
            彻底重新设计了请求提交和完成的路径。
            
```
blk-mq 架构：

CPU 0 ──→ [软件队列 0] ──┐
CPU 1 ──→ [软件队列 1] ──┤
CPU 2 ──→ [软件队列 2] ──┼──→ [硬件队列 0] ──→ 设备
CPU 3 ──→ [软件队列 3] ──┤         ↕
                          └──→ [硬件队列 1] ──→ 设备
                                   ↕
每个 CPU 有独立的软件队列         多个硬件队列
（Software Queue），避免        （Hardware Queue），
CPU 之间的锁竞争               对应设备的提交队列
```

            

blk-mq 的核心组件：
            
            
- 

**软件分发队列（Software Staging
            Queue）**： 每个 CPU 一个，bio 首先进入本 CPU
            的软件队列。 此队列使用 per-CPU 数据结构，避免跨 CPU
            锁竞争。
            
- 

**硬件分发队列（Hardware Dispatch
            Queue）**：
            对应设备驱动的提交队列。数量通常与设备支持的队列数一致。
            NVMe 设备通常支持多个硬件队列（可配置）。
            
- 

**标签（Tag）分配**：
            每个正在处理的请求分配一个唯一的标签，用于匹配完成回调。
            
            
```
# 查看块设备的队列信息
ls /sys/block/nvme0n1/mq/

# 查看硬件队列数量
cat /sys/block/nvme0n1/queue/nr_requests

# 查看某个硬件队列的 CPU 亲和性
cat /sys/block/nvme0n1/mq/0/cpu_list
```

            

### 5.5 提交路径与完成路径

            

**提交路径（Submission Path）**：
            
```
submit_bio()
  └── submit_bio_noacct()
        └── __submit_bio()
              └── blk_mq_submit_bio()
                    ├── blk_mq_get_request()       /* 分配 request 和 tag */
                    ├── blk_mq_bio_to_request()     /* bio → request */
                    └── blk_mq_run_hw_queue()       /* 提交到硬件队列 */
                          └── blk_mq_dispatch_rq_list()
                                └── q->mq_ops->queue_rq()  /* 驱动回调 */
```

            

**完成路径（Completion Path）**：
            
```
设备中断 → 驱动完成处理
  └── blk_mq_complete_request()
        └── blk_mq_end_request()
              ├── blk_update_request()       /* 更新请求状态 */
              ├── bio_endio(req->bio)         /* 回调每个 bio 的完成函数 */
              └── blk_mq_free_request()      /* 释放 request 和 tag */
```

            

## 六、I/O 调度器

            

I/O 调度器（I/O Scheduler）位于块设备层内部，
            负责对等待提交的请求进行排序和调度，以优化设备的吞吐量或延迟。
            

### 6.1 调度器演进历史

            

Linux I/O 调度器经历了几个重要的演进阶段：
            
```
时间线        调度器              适用场景
─────────────────────────────────────────────────────────
2.6 早期      Linus Elevator      最早的基础调度器
2.6.x         Anticipatory        增加了预测性等待
2.6.x         CFQ                 完全公平队列（默认）
2.6.x         Deadline            截止时间保证
4.12+         mq-deadline         多队列版 deadline
4.12+         BFQ                 预算公平队列
4.12+         Kyber               延迟目标调度器
4.12+         none                透传（无调度）
```

            

从内核 5.0 开始，传统的单队列调度器（CFQ、deadline
            等）已被移除， 仅保留多队列版本的调度器。
            

### 6.2 mq-deadline 调度器

            

mq-deadline 是最常用的通用型调度器，
            基于截止时间（Deadline）保证每个请求在合理时间内得到服务。
            

核心机制：
            
```
mq-deadline 维护的数据结构：

读请求排序队列（按扇区号排序）──→ 用于合并和顺序访问优化
读请求截止队列（按提交时间排序）──→ 用于防止饥饿

写请求排序队列（按扇区号排序）──→ 同上
写请求截止队列（按提交时间排序）──→ 同上

调度策略：
1. 优先服务读请求（读延迟敏感）
2. 按排序队列顺序批量派发（减少寻道）
3. 如果有请求超过截止时间，立即派发（防止饥饿）
4. 读写交替时，插入一定数量的写请求
```

            

关键参数：
            
```
# 查看当前调度器
cat /sys/block/sda/queue/scheduler
# 输出：[mq-deadline] kyber bfq none

# 切换调度器
echo mq-deadline > /sys/block/sda/queue/scheduler

# 查看 mq-deadline 参数
ls /sys/block/sda/queue/iosched/

# 读截止时间（毫秒），默认 500
cat /sys/block/sda/queue/iosched/read_expire

# 写截止时间（毫秒），默认 5000
cat /sys/block/sda/queue/iosched/write_expire

# 每次批量派发的请求数
cat /sys/block/sda/queue/iosched/fifo_batch
```

            

### 6.3 BFQ 调度器

            

BFQ（Budget Fair Queueing）调度器为每个进程分配 I/O
            “预算”， 确保带宽在进程间公平分配，同时保持低延迟。
            
```
BFQ 核心概念：

1. 每个进程关联一个 BFQ 队列
2. 调度器轮流服务各队列，每次分配固定 "预算"（扇区数）
3. 预算用完或队列空闲后，切换到下一个队列
4. 对交互式进程（低带宽、间歇性 I/O）给予更高优先级
```

            

BFQ 的优势在于桌面和嵌入式场景：
            即使后台有大量写入操作，前台应用的 I/O
            延迟也能保持在可接受范围内。
            
```
# 切换到 BFQ
echo bfq > /sys/block/sda/queue/scheduler

# BFQ 特有参数
# 低延迟模式（默认启用，对交互式进程优化）
cat /sys/block/sda/queue/iosched/low_latency

# 后台 I/O 的权重
cat /sys/block/sda/queue/iosched/back_seek_penalty
```

            

### 6.4 Kyber 调度器

            

Kyber 是一个面向延迟目标（Latency
            Target）的轻量级调度器， 特别适合 NVMe 等高性能设备。
            
```
Kyber 工作原理：

1. 维护两个延迟目标：读延迟目标和写延迟目标
2. 监控实际延迟，动态调整队列深度
3. 如果实际延迟超过目标，减少并发请求数
4. 如果实际延迟低于目标，增加并发请求数
```

            
```
# 切换到 Kyber
echo kyber > /sys/block/nvme0n1/queue/scheduler

# 查看延迟目标
cat /sys/block/nvme0n1/queue/iosched/read_lat_nsec   # 默认 2000000 (2ms)
cat /sys/block/nvme0n1/queue/iosched/write_lat_nsec  # 默认 10000000 (10ms)

# 调整读延迟目标为 1ms
echo 1000000 > /sys/block/nvme0n1/queue/iosched/read_lat_nsec
```

            

### 6.5 none（无调度器）

            

对于 NVMe 等内部已有高效调度机制的设备，使用
            `none` 调度器可以避免
            软件层的重复调度开销。请求直接透传到硬件队列。
            
```
# 对 NVMe 设备使用 none 调度器
echo none > /sys/block/nvme0n1/queue/scheduler
```

            

### 6.6 调度器选择指南

            
```
设备类型              推荐调度器        原因
────────────────────────────────────────────────────────────────
机械硬盘（HDD）       mq-deadline       减少寻道，防止饥饿
SATA SSD              mq-deadline       通用型，适用广泛
NVMe SSD              none 或 kyber     设备内部已有调度
桌面系统              BFQ               保证交互式应用响应
虚拟机磁盘            mq-deadline       宿主机已有调度
高性能数据库          none              最低延迟
```

            

## 七、设备驱动与硬件

            

设备驱动层是内核与物理硬件之间的接口。
            不同类型的存储设备使用不同的驱动子系统。
            

### 7.1 SCSI 子系统

            

SCSI（Small Computer System Interface）子系统是 Linux 中
            最成熟的存储驱动框架。不仅用于传统 SCSI 设备， SATA 硬盘通过
            libata 层也使用 SCSI 子系统的上层接口。
            
```
SCSI 子系统层次：

块设备层
    │
    ▼
┌───────────────────────┐
│ SCSI 上层驱动          │ sd（磁盘）、sr（光驱）、st（磁带）
├───────────────────────┤
│ SCSI 中间层            │ 错误处理、命令排队、超时管理
├───────────────────────┤
│ SCSI 下层驱动（HBA）   │ ata_piix、ahci、megaraid 等
└───────────────────────┘
    │
    ▼
  硬件控制器
```

            

SCSI 命令描述块（Command Descriptor Block，简称 CDB）是
            SCSI 协议的核心：
            
```
WRITE(10) 命令 CDB 结构（10 字节）：

字节   内容
──────────────────────────
0      操作码（0x2A）
1      标志位
2-5    逻辑块地址（LBA）
6      分组号
7-8    传输长度（块数）
9      控制字节
```

            

### 7.2 NVMe 驱动

            

NVMe（Non-Volatile Memory
            Express）是专为闪存存储设计的协议， 直接通过 PCIe 总线与 CPU
            通信，无需 SCSI 层的转换开销。
            
```
NVMe 架构：

应用程序
    │
    ▼
块设备层（blk-mq）
    │
    ▼
┌──────────────────────────┐
│  NVMe 驱动               │
│  ├── 提交队列（SQ）       │  每个 CPU 可有独立的 SQ
│  ├── 完成队列（CQ）       │  处理设备完成通知
│  └── 管理队列（Admin Q）  │  设备管理命令
└──────────────────────────┘
    │ PCIe
    ▼
┌──────────────────────────┐
│  NVMe 控制器              │
│  ├── 内部调度器            │
│  ├── 闪存转换层（FTL）     │
│  └── NAND Flash           │
└──────────────────────────┘
```

            

NVMe 的提交/完成队列模型：
            
```
NVMe 命令提交流程：

1. 驱动构造 NVMe 命令（64 字节），写入提交队列（Submission Queue）尾部
2. 更新提交队列的门铃寄存器（Doorbell Register），通知控制器
3. 控制器从提交队列取出命令，执行 I/O 操作
4. 完成后，控制器将完成条目（16 字节）写入完成队列（Completion Queue）
5. 控制器触发中断，通知驱动
6. 驱动从完成队列读取结果，执行回调
```

            
```
# 查看 NVMe 设备信息
nvme list

# 查看详细控制器信息
nvme id-ctrl /dev/nvme0 -H

# 查看命名空间信息
nvme id-ns /dev/nvme0n1 -H

# 查看队列数量
cat /sys/block/nvme0n1/device/queue_count

# 查看每个 CPU 的队列映射
cat /sys/block/nvme0n1/mq/*/cpu_list
```

            

### 7.3 DMA 与分散/聚集列表

            

直接内存访问（Direct Memory Access，简称
            DMA）使设备可以直接读写主内存， 无需 CPU
            逐字节搬运数据。
            

分散/聚集列表（Scatter/Gather List，简称 SGL）允许一次
            DMA 传输 涉及多个不连续的内存区域：
            
```
分散/聚集 DMA：

物理内存                          磁盘
┌──────┐                         ┌──────┐
│页面 A │──┐                      │ LBA  │
├──────┤  │    DMA 控制器         │  0   │
│页面 B │──┼──→ ════════ ──→     │  1   │
├──────┤  │                      │  2   │
│页面 C │──┘                      │  3   │
└──────┘                         └──────┘

三个不连续的内存页面通过一次 DMA 操作写入连续的磁盘块。
```

            

### 7.4 中断处理演进

            

存储设备使用中断（Interrupt）通知 CPU 操作完成。
            中断机制经历了三代演进：
            
```
演进                  特点                          限制
────────────────────────────────────────────────────────────
传统 IRQ              共享中断线                     需要遍历所有共享设备
                      电平/边沿触发                  中断号有限
MSI                   消息信号中断                   每设备最多 32 个中断
（Message Signaled    写入特定内存地址触发中断
  Interrupt）         不需要物理中断线
MSI-X                 扩展消息信号中断               支持 2048 个中断向量
                      每个中断可独立路由到不同 CPU    可实现完全的每队列中断
                      NVMe 设备标配
```

            

对于 NVMe 设备，MSI-X
            至关重要：每个完成队列可以关联独立的中断向量，
            中断直接路由到处理该队列的 CPU，避免跨 CPU
            的中断处理开销。
            
```
# 查看设备中断类型和分配
cat /proc/interrupts | grep nvme

# 输出示例：
#  CPU0   CPU1   CPU2   CPU3
#  1234   0      0      0     IR-PCI-MSI-X  nvme0q0
#  0      5678   0      0     IR-PCI-MSI-X  nvme0q1
#  0      0      9012   0     IR-PCI-MSI-X  nvme0q2
#  0      0      0      3456  IR-PCI-MSI-X  nvme0q3
```

            

### 7.5 完成队列处理

            

当设备完成 I/O 操作后，完成处理的路径：
            
```
1. 设备将完成条目写入完成队列（CQ）
2. 设备触发 MSI-X 中断
3. CPU 执行中断处理程序（Top Half）
     └── 将工作提交到软中断（softirq）
4. 软中断处理（Bottom Half）
     ├── 遍历完成队列，处理所有完成条目
     ├── 调用 blk_mq_complete_request()
     └── 触发 bio 完成回调
5. 更新完成队列头指针，通知设备释放队列空间
```

            

中断合并（Interrupt Coalescing）是一项重要的优化：
            设备可以积累多个完成条目后再触发一次中断，减少中断处理开销。
            但这会增加单个 I/O 的延迟，需要在吞吐量和延迟之间权衡。
            
```
# NVMe 设备的中断合并设置
nvme get-feature /dev/nvme0 -f 0x08 -H
# 设置中断合并：聚合时间 100μs，聚合阈值 8 个完成条目
nvme set-feature /dev/nvme0 -f 0x08 -v 0x00080064
```

            

## 八、ftrace/bpftrace
            追踪 I/O 路径

            

Linux 内核提供了丰富的追踪工具，可以深入观察 I/O
            请求在各层的行为。 本节介绍几种常用的追踪方法。
            

### 8.1 ftrace：函数图追踪

            

ftrace 是内核内置的追踪框架（Tracing Framework），
            无需安装额外工具即可使用。函数图追踪器（Function Graph
            Tracer） 可以记录函数的调用关系和执行时间。
            
```
# 启用函数图追踪器
echo function_graph > /sys/kernel/debug/tracing/current_tracer

# 只追踪 I/O 相关函数
echo 'vfs_write' > /sys/kernel/debug/tracing/set_graph_function
echo 'ext4_file_write_iter' >> /sys/kernel/debug/tracing/set_graph_function
echo 'submit_bio' >> /sys/kernel/debug/tracing/set_graph_function

# 设置追踪深度，避免输出过多
echo 5 > /sys/kernel/debug/tracing/max_graph_depth

# 启用追踪
echo 1 > /sys/kernel/debug/tracing/tracing_on

# 触发一次写操作
dd if=/dev/zero of=/mnt/test bs=4k count=1 oflag=direct 2>/dev/null

# 读取追踪结果
cat /sys/kernel/debug/tracing/trace

# 清理
echo 0 > /sys/kernel/debug/tracing/tracing_on
echo nop > /sys/kernel/debug/tracing/current_tracer
```

            

典型的追踪输出：
            
```
# tracer: function_graph
#
# CPU  DURATION                  FUNCTION CALLS
# |     |   |                     |   |   |   |
  0)               |  vfs_write() {
  0)               |    new_sync_write() {
  0)               |      ext4_file_write_iter() {
  0)               |        ext4_dio_write_iter() {
  0)               |          iomap_dio_rw() {
  0)               |            submit_bio() {
  0)               |              submit_bio_noacct() {
  0)   0.521 us    |                blk_mq_submit_bio();
  0)   1.102 us    |              }
  0)   1.453 us    |            }
  0) + 28.774 us   |          }
  0) + 29.523 us   |        }
  0) + 30.102 us   |      }
  0) + 30.847 us   |    }
  0) + 31.295 us   |  }
```

            

### 8.2 blktrace 与 blkparse

            

blktrace 专门用于追踪块设备层的事件， 可以记录每个 I/O
            请求的完整生命周期。
            
```
# 启动 blktrace 追踪（追踪 10 秒）
blktrace -d /dev/sda -o trace -w 10

# 在另一个终端触发 I/O
dd if=/dev/zero of=/mnt/test bs=4k count=1000

# 解析追踪结果
blkparse -i trace -o trace.txt

# 生成统计摘要
blkparse -i trace -d trace.bin
btt -i trace.bin
```

            

blktrace 事件类型说明：
            
```
事件代码    含义                    说明
──────────────────────────────────────────────────────
Q           Queued                 请求进入队列
G           Get request            获取 request 结构
I           Inserted               插入调度器队列
D           Dispatched             派发到驱动
C           Completed              设备完成
M           Merged（back）         后向合并
F           Front merged           前向合并
P           Plug                   启动 plug
U           Unplug                 释放 plug
```

            

blkparse 输出示例：
            
```
  8,0    0        1     0.000000000  1234  Q   W 1000 + 8 [dd]
  8,0    0        2     0.000001234  1234  G   W 1000 + 8 [dd]
  8,0    0        3     0.000002345  1234  I   W 1000 + 8 [dd]
  8,0    0        4     0.000005678  1234  D   W 1000 + 8 [dd]
  8,0    0        5     0.000125000     0  C   W 1000 + 8 [0]
```

            

从这个输出可以看出： - 请求在 0 时刻入队（Q） - 经过约 1
            μs 获取 request（G） - 再经过约 1 μs 插入调度队列（I） - 约
            3 μs 后派发给驱动（D） - 约 120 μs 后设备完成（C）
            

### 8.3 bpftrace 一行追踪

            

bpftrace 是基于 eBPF（extended Berkeley Packet
            Filter）的高级追踪工具，
            可以用简洁的脚本实现复杂的追踪和统计。
            

**测量块设备 I/O 延迟分布**：
            
```
# 按设备统计 I/O 延迟直方图
bpftrace -e '
tracepoint:block:block_rq_issue {
    @start[args->dev, args->sector] = nsecs;
}
tracepoint:block:block_rq_complete {
    if (@start[args->dev, args->sector]) {
        @usecs = hist((nsecs - @start[args->dev, args->sector]) / 1000);
        delete(@start[args->dev, args->sector]);
    }
}'
```

            

**追踪 write() 系统调用延迟**：
            
```
# 按进程统计 write() 延迟
bpftrace -e '
tracepoint:syscalls:sys_enter_write {
    @start[tid] = nsecs;
}
tracepoint:syscalls:sys_exit_write {
    if (@start[tid]) {
        @write_us[comm] = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
    }
}'
```

            

**追踪文件系统层延迟**：
            
```
# ext4 写操作延迟
bpftrace -e '
kprobe:ext4_file_write_iter {
    @start[tid] = nsecs;
}
kretprobe:ext4_file_write_iter {
    if (@start[tid]) {
        @ext4_write_us = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
    }
}'
```

            

**按进程统计 I/O 大小**：
            
```
# 各进程的 I/O 请求大小分布
bpftrace -e '
tracepoint:block:block_rq_issue {
    @io_size[comm] = hist(args->bytes);
}'
```

            

### 8.4 BCC 工具集

            

BCC（BPF Compiler Collection）提供了大量开箱即用的 I/O
            分析工具：
            

**biolatency——块设备 I/O 延迟直方图**：
            
```
# 按设备和操作类型分组的延迟直方图
biolatency -D -F

# 输出示例：
# disk = nvme0n1  flags = W
#      usecs               : count     distribution
#          0 -> 1          : 0        |                    |
#          2 -> 3          : 0        |                    |
#          4 -> 7          : 12       |*                   |
#          8 -> 15         : 156      |*************       |
#         16 -> 31         : 478      |********************|
#         32 -> 63         : 234      |*********           |
#         64 -> 127        : 45       |*                   |
#        128 -> 255        : 3        |                    |
```

            

**biosnoop——逐个 I/O 请求追踪**：
            
```
# 追踪每个块设备 I/O 请求
biosnoop

# 输出示例：
# TIME(s)     COMM           PID    DISK    T  SECTOR     BYTES   LAT(ms)
# 0.000000    mysqld         1234   nvme0n1 W  12345678   4096    0.02
# 0.000125    mysqld         1234   nvme0n1 R  23456789   16384   0.03
# 0.001234    jbd2/sda1-8    567    sda     W  98765432   8192    0.15
```

            

**ext4slower——追踪慢速 ext4 操作**：
            
```
# 追踪延迟超过 1ms 的 ext4 操作
ext4slower 1

# 输出示例：
# TIME     COMM           PID    T BYTES   OFF_KB   LAT(ms) FILENAME
# 09:15:23 mysqld         1234   W 16384   0        3.45    ib_logfile0
# 09:15:24 tar            5678   R 131072  1024     2.10    backup.tar
```

            

### 8.5 实战：追踪一次
            write() 的完整路径

            

下面通过一个完整的实验，追踪一次 `write()`
            系统调用 从用户态到设备完成的全过程：
            
```
#!/bin/bash
# trace_write.sh - 追踪 write() 完整路径

TRACEFS=/sys/kernel/debug/tracing

# 重置追踪器
echo 0 > $TRACEFS/tracing_on
echo > $TRACEFS/trace
echo function_graph > $TRACEFS/current_tracer

# 设置追踪过滤
echo 'vfs_write' > $TRACEFS/set_graph_function
echo 10 > $TRACEFS/max_graph_depth

# 只追踪特定进程（稍后启动）
echo > $TRACEFS/set_ftrace_pid

# 启用追踪
echo 1 > $TRACEFS/tracing_on

# 执行写操作并记录 PID
echo $$ > $TRACEFS/set_ftrace_pid
dd if=/dev/zero of=/mnt/test bs=4k count=1 oflag=direct 2>/dev/null

# 停止追踪
echo 0 > $TRACEFS/tracing_on

# 输出结果
cat $TRACEFS/trace

# 清理
echo nop > $TRACEFS/current_tracer
rm -f /mnt/test
```

            

## 九、各层延迟测量实战

            

定位 I/O
            性能瓶颈的关键在于逐层测量延迟，找出延迟最大的环节。
            本节提供各层延迟的测量方法和常见瓶颈模式。
            

### 9.1 VFS 层开销测量

            

VFS 层的开销主要来自文件描述符查找、权限检查和路径分发。
            可以通过对比直接函数调用和系统调用入口的延迟来衡量：
            
```
# 使用 bpftrace 测量 VFS 层开销
bpftrace -e '
kprobe:vfs_write {
    @vfs_start[tid] = nsecs;
}
kprobe:ext4_file_write_iter {
    if (@vfs_start[tid]) {
        @vfs_overhead_ns = hist(nsecs - @vfs_start[tid]);
        delete(@vfs_start[tid]);
    }
}' -c 'dd if=/dev/zero of=/mnt/test bs=4k count=10000 2>/dev/null'
```

            

### 9.2 文件系统层开销测量

            

文件系统层的开销包括块映射查找、日志操作、空间分配等：
            
```
# 测量 ext4 写操作中各子函数的开销
bpftrace -e '
kprobe:ext4_file_write_iter { @fs_start[tid] = nsecs; }
kretprobe:ext4_file_write_iter {
    if (@fs_start[tid]) {
        @fs_lat_us = hist((nsecs - @fs_start[tid]) / 1000);
        delete(@fs_start[tid]);
    }
}
kprobe:ext4_journal_start { @jnl_start[tid] = nsecs; }
kretprobe:ext4_journal_start {
    if (@jnl_start[tid]) {
        @journal_start_us = hist((nsecs - @jnl_start[tid]) / 1000);
        delete(@jnl_start[tid]);
    }
}' -c 'dd if=/dev/zero of=/mnt/test bs=4k count=10000 2>/dev/null'
```

            

### 9.3 块设备层排队延迟

            

块设备层的排队延迟反映了请求在调度器中等待的时间：
            
```
# 使用 blktrace 分析排队延迟
blktrace -d /dev/sda -w 10 -o blk_trace

# 使用 btt 生成详细延迟分解
blkparse -i blk_trace -d blk_trace.bin
btt -i blk_trace.bin -o btt_report

# btt 输出的关键指标：
# Q2Q  — 请求到达间隔
# Q2G  — 从入队到获取 request 结构的延迟
# G2I  — 从获取 request 到插入调度队列的延迟
# I2D  — 从插入调度队列到派发给驱动的延迟（排队延迟）
# D2C  — 从派发到设备完成的延迟（设备延迟）
# Q2C  — 从入队到完成的总延迟
```

            
```
btt 输出示例：

==================== All Coverage ====================
            ALL           MIN           AVG           MAX           N
  Q2Q       0.000001023   0.000245678   0.125678901   40960
  Q2G       0.000000123   0.000001234   0.000012345   40960
  G2I       0.000000045   0.000000567   0.000005678   40960
  I2D       0.000000234   0.000003456   0.000034567   40960
  D2C       0.000012345   0.000098765   0.000987654   40960
  Q2C       0.000015678   0.000104022   0.001040123   40960
```

            

从这个输出可以看出，设备延迟（D2C）占了总延迟（Q2C）的
            95% 以上， 说明瓶颈在硬件层而非软件层。
            

### 9.4 设备延迟测量

            

直接测量设备的原始 I/O 延迟：
            
```
# 使用 fio 测量设备原始延迟（4K 随机读）
fio --name=latency_test \
    --filename=/dev/nvme0n1 \
    --ioengine=io_uring \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=1 \
    --numjobs=1 \
    --runtime=10 \
    --time_based \
    --group_reporting \
    --output-format=json

# 使用 ioping 快速测量延迟
ioping -c 100 /dev/sda
# 输出示例：
# 4 KiB 
            

### 9.5 端到端延迟分解实例

            

下面是一个综合实例，使用多种工具分解一次写操作的端到端延迟：
            
```
#!/bin/bash
# latency_breakdown.sh - I/O 延迟分解测量

echo "=== 第一步：测量端到端延迟 ==="
bpftrace -e '
tracepoint:syscalls:sys_enter_write /comm == "dd"/ {
    @start[tid] = nsecs;
}
tracepoint:syscalls:sys_exit_write /comm == "dd"/ {
    if (@start[tid]) {
        @total_us = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
    }
}' -c 'dd if=/dev/zero of=/mnt/test bs=4k count=10000 oflag=direct 2>/dev/null'

echo ""
echo "=== 第二步：测量各层延迟 ==="
bpftrace -e '
kprobe:vfs_write /comm == "dd"/ {
    @vfs[tid] = nsecs;
}
kprobe:ext4_file_write_iter /comm == "dd"/ {
    @fs[tid] = nsecs;
    if (@vfs[tid]) {
        @vfs_us = hist((nsecs - @vfs[tid]) / 1000);
    }
}
kprobe:submit_bio /comm == "dd"/ {
    @blk[tid] = nsecs;
    if (@fs[tid]) {
        @fs_us = hist((nsecs - @fs[tid]) / 1000);
    }
}
tracepoint:block:block_rq_issue /comm == "dd"/ {
    @dev[tid] = nsecs;
    if (@blk[tid]) {
        @blk_us = hist((nsecs - @blk[tid]) / 1000);
    }
}
tracepoint:block:block_rq_complete {
    if (@dev[tid]) {
        @dev_us = hist((nsecs - @dev[tid]) / 1000);
        delete(@dev[tid]);
    }
    delete(@vfs[tid]);
    delete(@fs[tid]);
    delete(@blk[tid]);
}' -c 'dd if=/dev/zero of=/mnt/test bs=4k count=10000 oflag=direct 2>/dev/null'
```

            

### 9.6 常见瓶颈模式与诊断

            

**模式一：设备延迟高**
            
```
症状：D2C 延迟占比 > 95%
原因：设备本身速度慢，或设备过载
诊断：
  - 检查设备利用率：iostat -x 1
  - 检查队列深度：avgqu-sz
  - 检查 await（平均 I/O 等待时间）
解决：
  - 减少 I/O 负载
  - 升级到更快的存储设备
  - 优化应用程序的 I/O 模式
```

            

**模式二：调度器排队延迟高**
            
```
症状：I2D 延迟异常高
原因：调度器不匹配，或请求队列满
诊断：
  - 检查调度器类型：cat /sys/block/sda/queue/scheduler
  - 检查队列深度限制：cat /sys/block/sda/queue/nr_requests
  - 检查是否有 I/O 优先级不合理的进程
解决：
  - 切换到更合适的调度器
  - 增大 nr_requests
  - 使用 ionice 调整进程 I/O 优先级
```

            

**模式三：文件系统日志瓶颈**
            
```
症状：文件系统层延迟高，特别是元数据操作
原因：日志写入成为瓶颈
诊断：
  - 检查日志模式
  - 检查日志设备是否与数据设备共享
  - 使用 ext4slower 追踪慢操作
解决：
  - 将日志放到独立的快速设备上
  - 切换到 writeback 日志模式（如果可接受）
  - 减少 fsync() 频率
```

            

**模式四：Page Cache 抖动**
            
```
症状：缓存命中率低，频繁的页面回收
原因：工作集大于可用内存
诊断：
  - 检查 /proc/meminfo 中的 Cached 和 Active/Inactive 页面
  - 使用 cachestat（BCC 工具）监控缓存命中率
  - 检查 sar -B 中的 pgpgin/pgpgout
解决：
  - 增加物理内存
  - 调整应用程序的工作集大小
  - 对于数据库等应用，使用 O_DIRECT 绕过页缓存
```

            

**模式五：锁竞争导致的延迟**
            
```
症状：多线程写入时延迟波动大
原因：inode 锁、journal 锁等竞争
诊断：
  - 使用 lock_stat 或 lockdep 分析锁竞争
  - perf lock 报告
解决：
  - 将写入分散到多个文件
  - 使用 XFS（分配组并行）
  - 减少 fsync() 频率
```

            

### 9.7 实用监控命令速查

            

以下是日常 I/O 性能监控中常用的命令：
            
```
# 实时 I/O 统计（每秒刷新）
iostat -xz 1

# 关键指标说明：
# r/s, w/s     — 每秒读/写请求数
# rkB/s, wkB/s — 每秒读/写数据量
# await        — 平均 I/O 响应时间（毫秒）
# r_await      — 平均读响应时间
# w_await      — 平均写响应时间
# avgqu-sz     — 平均队列深度
# %util        — 设备利用率

# 每个进程的 I/O 使用情况
iotop -oP

# 块设备队列信息
cat /sys/block/sda/stat
# 字段：读次数 读合并数 读扇区数 读耗时(ms)
#        写次数 写合并数 写扇区数 写耗时(ms)
#        正在处理的请求数 I/O 耗时(ms) 加权 I/O 耗时(ms)

# 查看脏页状态
watch -n 1 'grep -E "Dirty|Writeback" /proc/meminfo'

# 文件系统级统计（ext4）
cat /proc/fs/ext4/sda1/mb_groups  # 块分配组信息
cat /sys/fs/ext4/sda1/delayed_allocation_blocks  # 延迟分配块数
```

            

## 参考文献

            
            
- 

Robert Love，“Linux Kernel Development”，Third
            Edition，Addison-Wesley Professional，2010。第 13-16
            章详细介绍了 VFS、块设备层和页缓存的实现。
            
- 

Bovet D P，Cesati M，“Understanding the Linux
            Kernel”，Third Edition，O’Reilly Media，2005。第 14-15
            章覆盖了块设备驱动和页缓存的设计。
            
- 

Linux 内核源码，`fs/read_write.c`：VFS
            读写路径的核心实现。可在 https://elixir.bootlin.com/linux/latest/source/fs/read_write.c
            查阅。
            
- 

Linux
            内核源码，`block/blk-mq.c`：多队列块设备层实现。可在
            https://elixir.bootlin.com/linux/latest/source/block/blk-mq.c
            查阅。
            
- 

Jens Axboe，“Linux Block IO — Present and
            Future”，Ottawa Linux
            Symposium，2004。介绍了块设备层的设计演进。
            
- 

Linux
            内核源码，`mm/filemap.c`：页缓存核心操作实现。可在
            https://elixir.bootlin.com/linux/latest/source/mm/filemap.c
            查阅。
            
- 

Linux 内核源码，`fs/ext4/file.c`：ext4
            文件操作实现。可在 https://elixir.bootlin.com/linux/latest/source/fs/ext4/file.c
            查阅。
            
- 

Jonathan Corbet，“The multiqueue block
            layer”，LWN.net，2013。https://lwn.net/Articles/552904/
            
- 

Brendan Gregg，“BPF Performance
            Tools”，Addison-Wesley Professional，2019。第 9
            章详细介绍了块设备和文件系统的 BPF 追踪方法。
            
- 

Linux 内核文档，“Block layer documentation”，https://docs.kernel.org/block/index.html
            
- 

Linux
            内核源码，`block/mq-deadline.c`：mq-deadline
            调度器实现。可在 https://elixir.bootlin.com/linux/latest/source/block/mq-deadline.c
            查阅。
            
- 

Linux
            内核源码，`drivers/nvme/host/core.c`：NVMe
            驱动核心实现。可在 https://elixir.bootlin.com/linux/latest/source/drivers/nvme/host/core.c
            查阅。
            
- 

NVM Express Base Specification，Revision 2.0，NVM
            Express Workgroup，2021。定义了 NVMe
            命令集和队列模型。
            
- 

Brendan Gregg，“Systems Performance: Enterprise and
            the Cloud”，Second Edition，Addison-Wesley
            Professional，2020。第 9 章和第 14 章覆盖了 I/O
            性能分析方法论。
            
            
            

**上一篇**: 存储介质选型指南
            **下一篇**: 块设备层：bio、request
            与 I/O 调度器
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-17 · storage
                    

### 【存储工程】块设备层：bio、request 与 I/O 调度器

                    

文件系统把"写这个文件"翻译成"写这些逻辑块"，但逻辑块怎么变成磁盘控制器能执行的命令？中间那一层就是块设备层（Block Layer）。它做的事不复杂——把上层的 I/O 请求收集、合并、排序，然后交给设备驱动——但做得好不好，直接决定了存储栈的吞吐和延迟。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

在 Linux 的传统 I/O 路径中，应用程序通过 read() 和 write() 系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：
                

                
                    

2025-10-13 · storage
                    

### 【存储工程】I/O 性能分析工具链

                    

系统梳理 Linux I/O 性能分析工具——iostat、blktrace、BCC/bpftrace、ftrace、perf 的使用方法，以及 I/O 瓶颈排查流程与常见问题模式
                

                
                    

2025-10-14 · storage
                    

### 【存储工程】缓存工程：从 Page Cache 到应用层缓存

                    

深入分析存储多级缓存架构——Page Cache、Buffer Pool、应用缓存的协同设计，缓存淘汰算法对比，缓存穿透/击穿/雪崩的防护策略