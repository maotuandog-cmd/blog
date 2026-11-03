# 【存储工程】Page Cache 深度解析

来源: https://quant67.com/post/storage/09-page-cache/page-cache.html
日期: 2025-08-18 |

---

# Page Cache 深度解析

            

应用程序每一次 `read()` 或
            `write()`
            系统调用，感觉像是直接在操作磁盘上的文件，但实际上，内核在中间插入了一层透明的缓存——页缓存（Page
            Cache）。这层缓存用物理内存保存最近访问过的文件数据，使得绝大多数读操作不需要触发磁盘
            I/O，而写操作可以先落到内存，再由后台线程异步刷回存储设备。
            

页缓存是 Linux
            存储栈中最关键的性能组件之一。理解它的工作原理、数据结构、调优参数和监控手段，对于数据库管理员、存储工程师和系统性能分析师来说都是必修课。一个配置不当的页缓存策略，轻则造成不必要的
            I/O 放大，重则触发直接内存回收（Direct
            Reclaim）导致应用延迟飙升，甚至在极端情况下引发 OOM（Out Of
            Memory）杀死关键进程。
            

本文将从页缓存的基本原理出发，逐步深入到内核数据结构、读预取算法、脏页回写机制、内存压力下的行为、监控方法、与数据库的交互，最终落到实际的调优实战。
            
            

## 一、Page Cache
            的角色与原理

            

### 1.1 什么是 Page Cache

            

页缓存（Page Cache）是 Linux
            内核在物理内存中维护的一个文件数据缓存层。当进程通过
            `read()`
            系统调用读取文件时，内核不会每次都去访问底层的块设备（Block
            Device），而是先检查该文件对应的数据页是否已经在内存中。如果在，直接从内存返回数据；如果不在，才从磁盘读取数据，同时将数据缓存到页缓存中，以便后续访问。
            

从本质上讲，页缓存是一个以内存页（通常
            4KB）为粒度的、全局共享的文件数据缓存。它由内核自动管理，对应用程序完全透明——应用程序不需要做任何特殊处理就能享受到缓存带来的性能提升。
            

### 1.2 为什么需要 Page
            Cache

            

页缓存存在的根本原因是存储介质与内存之间巨大的速度差距：
            
```
存储层次                 典型延迟            相对速度
─────────────────────────────────────────────────
L1 Cache                 1 ns               1x
L2 Cache                 4 ns               4x
L3 Cache                 12 ns              12x
DRAM                     80 ns              80x
Intel Optane PMem        300 ns             300x
NVMe SSD（随机读）       100 us             100,000x
SATA SSD（随机读）       200 us             200,000x
HDD（随机读）            8 ms               8,000,000x
```

            

即使是最快的 NVMe 固态硬盘（Solid State
            Drive，SSD），其随机读延迟也比内存慢三个数量级。对于传统的机械硬盘（Hard
            Disk
            Drive，HDD），差距更是达到了五个数量级。页缓存的作用就是用有限的内存资源，尽可能多地缓存”热”数据，将大量的磁盘
            I/O 转化为内存访问，从而大幅降低应用程序的 I/O 延迟。
            

### 1.3 读路径

            

当应用程序调用 `read()`
            读取文件数据时，内核的处理路径如下：
            
```
应用程序调用 read(fd, buf, len)
        |
        v
VFS 层：确定文件的 inode 和偏移量
        |
        v
检查 Page Cache：该偏移量对应的页是否在缓存中？
        |
       / \
      /   \
   命中    未命中
    |        |
    v        v
 从内存    向块设备发起 I/O 请求
 复制到      |
 用户空间    v
    |      数据从磁盘读入内核缓冲区
    |        |
    |        v
    |      将数据页加入 Page Cache
    |        |
    |        v
    |      从内存复制到用户空间
    |        |
    v        v
  返回数据给应用程序
```

            

这个路径揭示了页缓存最重要的性能特征：**缓存命中时，I/O
            操作完全不涉及磁盘，延迟从毫秒级降到微秒级**。在典型的生产服务器上，页缓存的命中率（Hit
            Ratio）通常在 90% 以上——也就是说，10 次读操作中只有 1
            次需要真正访问磁盘。
            

### 1.4 写路径

            

写操作的路径与读操作有本质区别。Linux
            默认采用回写（Write-Back）策略，而不是直写（Write-Through）策略：
            
```
应用程序调用 write(fd, buf, len)
        |
        v
VFS 层：确定文件的 inode 和偏移量
        |
        v
检查 Page Cache：该偏移量对应的页是否在缓存中？
        |
       / \
      /   \
   命中    未命中
    |        |
    v        v
 更新缓存  分配新页，将数据写入
 中的数据    |
    |        v
    v      将新页加入 Page Cache
    |        |
    v        v
  标记该页为"脏页"（Dirty Page）
        |
        v
  write() 系统调用返回（此时数据尚未到达磁盘）
        |
        v
  后台回写线程（Flusher Thread）异步将脏页刷到磁盘
```

            

这种设计的好处是显而易见的：`write()`
            调用几乎立即返回，应用程序不需要等待慢速的磁盘写入完成。代价是在脏页被刷回磁盘之前，如果系统崩溃或断电，这些尚未持久化的数据会丢失。这也是为什么需要
            `fsync()` 或 `fdatasync()`
            来确保数据持久化的原因。
            

### 1.5 缓存淘汰：LRU 列表

            

内存是有限的资源，页缓存不可能无限增长。当系统内存紧张时，内核需要回收一部分页缓存页面来满足新的内存分配请求。Linux
            使用改良的最近最少使用（Least Recently
            Used，LRU）算法来决定淘汰哪些页面。
            

内核维护两个 LRU 列表：
            
```
活跃列表（Active List）
    |
    |  页面被再次访问时提升
    |  列表尾部的页面降级到非活跃列表
    |
    v
非活跃列表（Inactive List）
    |
    |  新读入的页面先进入此列表
    |  被再次访问时提升到活跃列表
    |  列表尾部的页面被淘汰
    |
    v
  回收（Reclaim）
```

            

这种双列表设计被称为”二次机会”（Second
            Chance）算法。它比简单的 LRU 更能抵抗缓存扫描（Cache
            Scan）——当一次性读取大量文件时（例如全量备份），这些只访问一次的页面会停留在非活跃列表中，不会将真正的热数据从活跃列表中挤出去。
            

内核还区分文件页（File-backed Pages）和匿名页（Anonymous
            Pages），分别维护独立的 LRU
            列表。文件页就是页缓存中的页面，而匿名页是没有文件背景的内存页面（如堆、栈分配的内存）。当需要回收内存时，内核可以直接丢弃干净的文件页（因为数据可以从磁盘重新读取），但匿名页必须先写入交换空间（Swap
            Space）才能回收。
            
            

## 二、Page Cache 数据结构

            

### 2.1 struct address_space

            

页缓存的核心数据结构是
            `address_space`，每个文件的索引节点（inode）都关联一个
            `address_space`
            对象。这个结构体管理着该文件所有被缓存的页面：
            
```
/* 简化版 address_space 结构，基于 Linux 6.x 内核 */
struct address_space {
    struct inode        *host;          /* 关联的 inode */
    struct xarray       i_pages;       /* 页面索引结构 */
    atomic_t            i_mmap_writable; /* mmap 可写映射计数 */
    struct rb_root_cached i_mmap;      /* mmap 映射的区间树 */
    unsigned long       nrpages;       /* 缓存的页面总数 */
    pgoff_t             writeback_index; /* 回写起始位置 */
    const struct address_space_operations *a_ops; /* 操作函数表 */
    unsigned long       flags;         /* 标志位 */
    spinlock_t          i_lock;        /* 保护成员的自旋锁 */
    gfp_t               gfp_mask;     /* 内存分配标志 */
    struct list_head    i_private_list; /* 私有列表 */
};
```

            

`a_ops`
            是一个操作函数表，包含了具体文件系统（如
            ext4、XFS）实现的读写函数。当页缓存需要从磁盘读取数据或将脏页写回磁盘时，就会调用这些函数：
            
```
struct address_space_operations {
    int (*writepage)(struct page *page, struct writeback_control *wbc);
    int (*read_folio)(struct file *, struct folio *);
    int (*writepages)(struct address_space *, struct writeback_control *);
    bool (*dirty_folio)(struct address_space *, struct folio *);
    void (*readahead)(struct readahead_control *);
    int (*write_begin)(struct file *, struct address_space *, loff_t,
                       unsigned, struct page **, void **);
    int (*write_end)(struct file *, struct address_space *, loff_t,
                     unsigned, unsigned, struct page *, void *);
    int (*direct_IO)(struct kiocb *, struct iov_iter *);
    /* ... 更多操作 ... */
};
```

            

### 2.2 从基数树到 XArray

            

在早期的 Linux 内核中，`address_space`
            使用基数树（Radix
            Tree）来索引页面。基数树以文件偏移量（以页为单位）作为键，可以在
            O(log n) 时间内查找、插入和删除页面。
            

从 Linux 4.20
            开始，内核引入了扩展数组（XArray）来替代基数树。XArray 在
            API 层面更简洁，并且在底层做了多项优化：
            
```
XArray 相比 Radix Tree 的改进：
─────────────────────────────────
1. 统一的锁机制（内置自旋锁，减少外部锁的使用）
2. 更好的多序项（Multi-order Entry）支持
3. 标记（Mark）系统替代了旧的标签（Tag）系统
4. 更直观的迭代器 API
5. 支持原子操作（xa_cmpxchg 等）
```

            

在页缓存的上下文中，XArray
            的标记系统特别重要。内核使用标记来快速找到具有特定属性的页面，例如脏页或正在回写的页面：
            
```
/* XArray 标记定义 */
#define PAGECACHE_TAG_DIRTY     XA_MARK_0   /* 脏页标记 */
#define PAGECACHE_TAG_WRITEBACK XA_MARK_1   /* 回写中标记 */
#define PAGECACHE_TAG_TOWRITE   XA_MARK_2   /* 待写标记 */
```

            

通过这些标记，内核可以快速遍历某个文件的所有脏页，而不需要扫描整个
            XArray。
            

### 2.3 页面标志

            

每个物理内存页都有一组标志位（Page Flags），存储在
            `struct page` 的 `flags`
            字段中。与页缓存相关的关键标志包括：
            
```
/* 页缓存相关的页面标志 */
PG_locked       /* 页面被锁定，I/O 进行中 */
PG_uptodate     /* 页面内容与磁盘一致（或已被正确填充） */
PG_dirty        /* 页面已被修改，尚未写回磁盘 */
PG_writeback    /* 页面正在被写回磁盘 */
PG_lru          /* 页面在 LRU 列表中 */
PG_active       /* 页面在活跃 LRU 列表中 */
PG_referenced   /* 页面最近被访问过 */
PG_private      /* 页面有文件系统的私有数据（如 buffer_head） */
```

            

这些标志的状态转换反映了页面在页缓存中的生命周期：
            
```
新分配的页面
    |
    v
PG_locked（从磁盘读取数据中）
    |
    v
PG_uptodate + PG_lru（数据读取完成，加入 LRU）
    |
   / \
  /   \
被读取  被修改
  |       |
  v       v
PG_referenced  PG_dirty（标记为脏页）
  |               |
  v               v
PG_active      后台回写触发
（提升到活跃列表）  |
                   v
              PG_writeback（写回进行中）
                   |
                   v
              清除 PG_dirty 和 PG_writeback（写回完成）
```

            

### 2.4 folio：多页复合单元

            

传统上，页缓存以单个 4KB 页面为操作单位。但随着存储设备的
            I/O 粒度越来越大（NVMe SSD 的内部页大小通常是 16KB），以 4KB
            为单位管理缓存变得低效——元数据开销大、TLB（Translation
            Lookaside Buffer）压力高。
            

从 Linux 5.16 开始，内核引入了 folio 的概念。一个 folio
            是一组物理连续的页面，可以作为一个整体进行操作：
            
```
/* folio 结构（简化） */
struct folio {
    /* 内部包含 struct page */
    unsigned long flags;       /* 页面标志 */
    struct address_space *mapping; /* 所属的 address_space */
    pgoff_t index;             /* 文件偏移（以页为单位） */
    unsigned int order;        /* 2^order 个页面 */
    atomic_t _mapcount;        /* 映射计数 */
    atomic_t _refcount;        /* 引用计数 */
    /* ... */
};
```

            

folio 的关键特性：
            
```
folio 相比传统 page 的优势：
──────────────────────────────
1. 减少元数据开销（一个 folio 管理多个页面）
2. 提高大 I/O 效率（一次操作处理更多数据）
3. 减少 TLB 压力（使用大页/透明大页）
4. 简化代码（消除了 compound page 的复杂性）
5. 与文件系统块大小更好地对齐
```

            

### 2.5 页面索引机制

            

页缓存通过文件偏移量来索引页面。给定一个文件偏移量
            `offset`，对应的页面索引（Page
            Index）计算方式如下：
            
```
/* 将字节偏移转换为页面索引 */
pgoff_t index = offset >> PAGE_SHIFT;  /* PAGE_SHIFT = 12，即除以 4096 */
```

            

查找页面的典型流程：
            
```
/* 在页缓存中查找页面（简化版） */
struct folio *filemap_get_folio(struct address_space *mapping,
                                pgoff_t index)
{
    struct folio *folio;

    /* 在 XArray 中查找 */
    folio = xa_load(&mapping->i_pages, index);
    if (folio && !folio_try_get(folio))
        folio = NULL;

    return folio;
}
```

            

当查找未命中时，内核会分配新的 folio
            并从磁盘读取数据：
            
```
/* 缓存未命中时的处理（简化版） */
struct folio *filemap_get_folio_or_read(struct address_space *mapping,
                                        pgoff_t index,
                                        struct file *file)
{
    struct folio *folio;

    folio = filemap_get_folio(mapping, index);
    if (folio)
        return folio;  /* 命中 */

    /* 未命中：分配新 folio */
    folio = filemap_alloc_folio(mapping->gfp_mask, 0);
    if (!folio)
        return ERR_PTR(-ENOMEM);

    /* 将 folio 加入 XArray */
    xa_store(&mapping->i_pages, index, folio, GFP_KERNEL);

    /* 从磁盘读取数据 */
    mapping->a_ops->read_folio(file, folio);

    return folio;
}
```

            
            

## 三、读预取（Readahead）

            

### 3.1 顺序检测与预读窗口

            

读预取（Readahead）是页缓存最重要的性能优化之一。其核心思想是：如果内核检测到应用程序正在顺序读取文件，就提前将后续的数据页读入缓存，使得应用程序的下一次
            `read()` 调用能够直接命中缓存。
            

内核在每个打开文件的 `struct file`
            中维护一个预读状态结构：
            
```
struct file_ra_state {
    pgoff_t start;          /* 当前预读窗口的起始位置 */
    unsigned int size;      /* 当前预读窗口的大小（页数） */
    unsigned int async_size; /* 异步预读部分的大小 */
    unsigned int ra_pages;  /* 最大预读大小（页数） */
    unsigned int mmap_miss; /* mmap 顺序性计数器 */
    loff_t prev_pos;        /* 上一次读取的位置 */
};
```

            

顺序检测的基本逻辑是：如果当前读取的位置紧接上一次读取的结束位置，就判定为顺序读取，并启动或扩大预读窗口。
            

### 3.2
            初始预读大小与最大预读

            

当内核首次检测到顺序读取模式时，会设置一个初始预读大小。这个大小取决于多个因素：
            
```
初始预读大小的确定：
────────────────────
1. 首次读取：通常为请求大小的 2-4 倍，但不超过 ra_pages
2. 后续读取：预读窗口逐步翻倍增长
3. 最大限制：受 ra_pages 约束（默认 128 页 = 512KB）
```

            

最大预读大小由以下参数控制：
            
```
# 查看当前预读大小（单位：KB）
cat /sys/block/sda/queue/read_ahead_kb
# 典型默认值：128（即 128KB = 32 页）

# 查看系统级默认值
sysctl vm.readahead_pages
```

            

预读窗口的增长过程：
            
```
时间 ──────────────────────────────────────────>

第 1 次读取：请求 4KB
预读窗口：[page 0 ~ page 3]（16KB，初始大小）

第 2 次读取：命中缓存
预读窗口：[page 4 ~ page 11]（32KB，翻倍）

第 3 次读取：命中缓存
预读窗口：[page 12 ~ page 27]（64KB，翻倍）

第 4 次读取：命中缓存
预读窗口：[page 28 ~ page 59]（128KB，翻倍）

第 5 次读取：命中缓存
预读窗口：[page 60 ~ page 123]（256KB，翻倍）

... 直到达到 read_ahead_kb 设定的最大值
```

            

### 3.3 同步预读与异步预读

            

预读分为同步预读（Synchronous
            Readahead）和异步预读（Asynchronous
            Readahead）两种模式：
            
```
预读窗口布局：
┌──────────────────────────────┬───────────────────┐
│       同步预读区域            │   异步预读区域     │
│  （必须等待 I/O 完成）        │（提前触发预读）     │
└──────────────────────────────┴───────────────────┘
^                              ^                   ^
start                    async boundary          start + size
```

            
            
- 

**同步预读**：当应用程序读取的页面不在缓存中时触发。内核必须等待
            I/O
            完成，将数据页读入缓存后才能返回给应用程序。这是冷启动时的必经之路。
            
- 

**异步预读**：当应用程序读取到预读窗口中的”异步标记”位置时触发。此时当前请求的数据已经在缓存中（可以立即返回），但内核同时发起一个后台
            I/O
            请求，提前将下一批数据读入缓存。这样应用程序的下一次读取仍然能命中缓存。
            
            
```
/* 异步预读触发条件（简化版） */
void page_cache_async_readahead(struct address_space *mapping,
                                 struct file_ra_state *ra,
                                 struct file *file,
                                 pgoff_t index)
{
    /* 如果读取位置到达异步标记，触发下一轮预读 */
    if (index == ra->start + ra->size - ra->async_size)
        ondemand_readahead(mapping, ra, file, true, index);
}
```

            

### 3.4 read_ahead_kb 调优

            

`read_ahead_kb` 是预读调优中最重要的参数：
            
```
# 查看所有块设备的预读大小
for dev in /sys/block/*/queue/read_ahead_kb; do
    echo "$(dirname $(dirname $dev) | xargs basename): $(cat $dev) KB"
done

# 设置特定设备的预读大小
echo 256 > /sys/block/sda/queue/read_ahead_kb

# 使用 blockdev 命令设置（单位：512 字节扇区）
blockdev --setra 512 /dev/sda   # 设置为 256KB（512 * 512B）
blockdev --getra /dev/sda       # 查看当前设置
```

            

不同场景下的推荐值：
            
```
工作负载类型              推荐 read_ahead_kb    原因
──────────────────────────────────────────────────────────
顺序读密集型（视频流）    1024-4096             最大化吞吐
数据库（OLTP）            64-128                减少无用预读
数据库（OLAP/分析）       256-1024              大范围扫描受益
随机读密集型              32-64                 预读几乎无用，减少浪费
NVMe SSD                 128-256               延迟低，中等预读即可
HDD                      256-1024              弥补高延迟
RAID 阵列                与条带大小对齐         避免跨条带读取
```

            

### 3.5 对顺序读性能的影响

            

预读对顺序读的性能提升是巨大的。以下是一个简单的基准测试（Benchmark）示例：
            
```
# 清除页缓存以获得冷启动数据
sync && echo 3 > /proc/sys/vm/drop_caches

# 测试不同预读大小下的顺序读吞吐（使用 dd）
for ra in 32 128 512 2048; do
    echo $ra > /sys/block/sda/queue/read_ahead_kb
    sync && echo 3 > /proc/sys/vm/drop_caches
    echo "read_ahead_kb = $ra"
    dd if=/data/testfile of=/dev/null bs=1M count=1024 2>&1 | grep -E 'copied|bytes'
    echo "---"
done
```

            

典型的性能对比（HDD，顺序读 1GB 文件）：
            
```
read_ahead_kb    吞吐量        说明
────────────────────────────────────────
32               80 MB/s      预读窗口太小，频繁触发同步 I/O
128              150 MB/s     默认值，合理的平衡点
512              180 MB/s     更大的 I/O 合并，接近磁盘极限
2048             185 MB/s     收益递减，额外内存消耗
```

            

### 3.6
            预读的负面影响：随机 I/O 工作负载

            

预读并非总是有益的。对于随机 I/O（Random
            I/O）工作负载，预读不仅没有帮助，反而会造成性能损失：
            
```
随机读场景下预读的负面影响：
──────────────────────────────
1. 带宽浪费：预读的数据不会被后续访问使用
2. 内存浪费：无用的预读数据占据了页缓存空间
3. I/O 放大：实际的磁盘 I/O 量是应用请求量的数倍
4. 缓存污染：热数据被无用的预读数据挤出缓存
```

            

对于数据库这类混合工作负载的应用，可以通过
            `posix_fadvise()`
            系统调用对不同的文件或文件区域设置不同的预读策略。
            

### 3.7 posix_fadvise 与
            madvise

            

应用程序可以通过 `posix_fadvise()` 和
            `madvise()` 主动告知内核自己的访问模式：
            
```
#include 

int fd = open("/data/sequential_file", O_RDONLY);

/* 告知内核：将顺序访问这个文件 */
posix_fadvise(fd, 0, 0, POSIX_FADV_SEQUENTIAL);
/* 效果：预读窗口大小翻倍 */

/* 告知内核：将随机访问这个文件 */
posix_fadvise(fd, 0, 0, POSIX_FADV_RANDOM);
/* 效果：禁用预读 */

/* 告知内核：即将访问某个区域 */
posix_fadvise(fd, offset, length, POSIX_FADV_WILLNEED);
/* 效果：立即将指定区域预读到缓存 */

/* 告知内核：不再需要某个区域的缓存 */
posix_fadvise(fd, offset, length, POSIX_FADV_DONTNEED);
/* 效果：将指定区域的页面从缓存中淘汰 */
```

            

对于使用 `mmap()` 映射的文件区域，使用
            `madvise()` 代替：
            
```
#include 

void *addr = mmap(NULL, size, PROT_READ, MAP_SHARED, fd, 0);

/* 告知内核：将顺序访问这片内存区域 */
madvise(addr, size, MADV_SEQUENTIAL);

/* 告知内核：将随机访问这片内存区域 */
madvise(addr, size, MADV_RANDOM);

/* 告知内核：即将访问某个区域 */
madvise(addr + offset, length, MADV_WILLNEED);

/* 告知内核：不再需要某个区域 */
madvise(addr + offset, length, MADV_DONTNEED);
```

            
            

## 四、脏页与回写（Writeback）

            

### 4.1 脏页参数详解

            

脏页（Dirty
            Page）管理是页缓存中最复杂也最关键的部分。内核通过一组
            sysctl 参数来控制脏页的行为：
            
```
# 查看所有脏页相关参数
sysctl -a | grep dirty
```

            

**dirty_ratio / dirty_bytes**
            
```
# 脏页占可用内存的最大比例（百分比）
sysctl vm.dirty_ratio
# 默认值：20（即 20%）

# 或者以字节数指定绝对上限
sysctl vm.dirty_bytes
# 默认值：0（表示使用 dirty_ratio）
```

            

当脏页总量达到 `dirty_ratio`
            时，**执行写操作的进程会被阻塞**，直到有足够的脏页被刷回磁盘。这是一个硬限制，确保脏页不会无限增长：
            
```
dirty_ratio 的行为：
────────────────────
                  正常写入        写入被阻塞
脏页比例：0% ═══════════════════╪══════════> 100%
                              dirty_ratio
                              （默认 20%）
```

            

**dirty_background_ratio /
            dirty_background_bytes**
            
```
# 触发后台回写的脏页比例（百分比）
sysctl vm.dirty_background_ratio
# 默认值：10（即 10%）

# 或者以字节数指定
sysctl vm.dirty_background_bytes
# 默认值：0（表示使用 dirty_background_ratio）
```

            

当脏页总量达到 `dirty_background_ratio`
            时，内核**唤醒后台回写线程**开始将脏页刷回磁盘，但写操作的进程不会被阻塞：
            
```
脏页参数的完整行为：
──────────────────────
         后台回写             节流          写入阻塞
          未启动               区域            区域
 0% ═════════╪═══════════════════╪═════════════> 100%
      dirty_background_ratio  dirty_ratio
           （默认 10%）       （默认 20%）

- 脏页 = 20%：写进程被完全阻塞，等待脏页下降
```

            

**dirty_expire_centisecs**
            
```
# 脏页的过期时间（单位：百分之一秒）
sysctl vm.dirty_expire_centisecs
# 默认值：3000（即 30 秒）
```

            

超过这个时间的脏页会被回写线程优先刷回磁盘，即使脏页总量没有达到阈值。这确保了数据不会在内存中停留太久。
            

**dirty_writeback_centisecs**
            
```
# 回写线程的唤醒间隔（单位：百分之一秒）
sysctl vm.dirty_writeback_centisecs
# 默认值：500（即 5 秒）
```

            

回写线程每隔这个时间就会被唤醒一次，检查是否有过期的脏页需要刷回磁盘。
            

### 4.2 回写线程

            

Linux
            内核使用专用的内核线程来执行脏页回写。在现代内核中，每个后端设备接口（Backing
            Device Info，BDI）都有自己的回写线程：
            
```
# 查看系统中的回写线程
ps aux | grep -E 'flush|writeback'
# 典型输出：
# root  [kworker/u8:0-flush-253:0]  # 设备 253:0 的回写线程
# root  [kworker/u8:1-flush-8:0]    # 设备 8:0 的回写线程
```

            

回写线程的工作流程：
            
```
回写线程唤醒
    |
    v
检查是否有过期脏页（age > dirty_expire_centisecs）
    |
   / \
  是   否
  |     |
  v     v
回写   检查脏页总量是否超过 dirty_background_ratio
过期     |
脏页    / \
  |   是   否
  |    |    |
  |    v    v
  |  回写   继续睡眠
  |  脏页   dirty_writeback_centisecs
  |    |
  v    v
继续回写直到脏页降到安全水位
    |
    v
  睡眠
```

            

### 4.3 回写触发条件

            

脏页回写可以由三种方式触发：
            
```
触发方式          条件                         行为
─────────────────────────────────────────────────────────
定时器触发        每隔 dirty_writeback_centisecs  回写过期脏页
阈值触发          脏页达到 dirty_background_ratio  后台回写开始
同步触发          应用调用 sync/fsync/fdatasync    同步回写所有/指定脏页
```

            
```
# 手动触发全局同步回写
sync

# 对单个文件进行同步
# fsync - 同步数据和元数据
python3 -c "
import os
fd = os.open('/data/file', os.O_WRONLY)
os.fsync(fd)
os.close(fd)
"

# fdatasync - 仅同步数据（不含不影响读取的元数据）
python3 -c "
import os
fd = os.open('/data/file', os.O_WRONLY)
os.fdatasync(fd)
os.close(fd)
"
```

            

### 4.4 WBT：回写节流

            

回写节流（Writeback Throttling，WBT）是 Linux 4.10
            引入的一项机制，专门用于
            blk-mq（多队列块设备层）。它通过监控写操作的延迟来自动调节脏页回写的速率，防止回写风暴导致读延迟飙升：
            
```
# 查看 WBT 状态
cat /sys/block/sda/queue/wbt_lat_usec
# 默认值：75000（75ms）——目标延迟

# 禁用 WBT
echo 0 > /sys/block/sda/queue/wbt_lat_usec

# 设置目标延迟（微秒）
echo 50000 > /sys/block/sda/queue/wbt_lat_usec
```

            

WBT 的工作原理：
            
```
1. 监控写请求的完成延迟
2. 如果延迟超过目标值（wbt_lat_usec），减少允许的在途写请求数
3. 如果延迟低于目标值，逐步增加允许的在途写请求数
4. 通过这种反馈机制，在吞吐和延迟之间找到平衡
```

            

### 4.5 数据库场景的脏页调优

            

数据库服务器对脏页参数非常敏感。配置不当会导致周期性的性能抖动（Performance
            Jitter）——即”回写风暴”（Writeback Storm）。
            
```
# 数据库服务器推荐的脏页参数

# 降低后台回写阈值，让回写更频繁、更平滑
sysctl -w vm.dirty_background_ratio=3
# 或者使用绝对值（适用于大内存服务器）
# sysctl -w vm.dirty_background_bytes=268435456  # 256MB

# 降低硬限制，减少突发回写的数据量
sysctl -w vm.dirty_ratio=10
# 或者使用绝对值
# sysctl -w vm.dirty_bytes=1073741824  # 1GB

# 缩短脏页过期时间
sysctl -w vm.dirty_expire_centisecs=1000  # 10 秒

# 缩短回写线程唤醒间隔
sysctl -w vm.dirty_writeback_centisecs=300  # 3 秒
```

            

这些调优的核心思路是”少量多次”——让回写线程更频繁地工作，每次刷回少量脏页，而不是等脏页积累到很大量时一次性刷回。后者会导致
            I/O 带宽被回写操作独占，前台的读请求延迟飙升。
            
```
# 持久化 sysctl 配置
cat >> /etc/sysctl.d/90-dirty-pages.conf 
            
            

## 五、内存压力下的
            Page Cache 行为

            

### 5.1 内存回收：kswapd
            与直接回收

            

当系统可用内存低于特定水位线（Watermark）时，内核会启动内存回收机制。回收的主要目标之一就是页缓存中的页面。
            

内核定义了三个水位线：
            
```
内存水位线：
──────────────────────────────────────────
high    ─── kswapd 停止回收
          |
          |  kswapd 在此区间内工作
          |
low     ─── kswapd 被唤醒，开始后台回收
          |
          |  如果 kswapd 来不及回收
          |
min     ─── 触发直接回收（Direct Reclaim）
          |
          |  紧急保留区域
          |
  0     ─── 内存完全耗尽，触发 OOM Killer
```

            
```
# 查看当前水位线（单位：页）
cat /proc/zoneinfo | grep -E 'Node|pages free|min|low|high' | head -20
```

            

**kswapd**
            是一个后台内核线程，当可用内存降到 `low`
            水位线以下时被唤醒，它在后台异步回收内存页面，直到可用内存恢复到
            `high`
            水位线以上。这个过程对应用程序是透明的。
            

**直接回收**（Direct
            Reclaim）发生在可用内存降到 `min` 水位线以下，且
            kswapd
            来不及回收足够内存时。此时，执行内存分配的进程（即触发
            `page fault` 或 `malloc`
            的进程）被迫自己执行内存回收，**进程会被阻塞**直到回收到足够的内存。这是导致应用延迟飙升的主要原因之一。
            
```
# 查看直接回收的发生次数
grep -E 'pgsteal_direct|allocstall' /proc/vmstat
# allocstall_normal    12345   # 直接回收触发次数
# pgsteal_direct       98765   # 直接回收回收的页面数
```

            

### 5.2 页缓存淘汰与交换

            

在内存回收过程中，内核面临一个关键选择：淘汰页缓存页面（文件页），还是将匿名页换出到交换空间？
            
```
回收页面的类型与代价：
──────────────────────────────────────────────
类型        干净的文件页    脏的文件页    匿名页
──────────────────────────────────────────────
回收动作    直接丢弃       先回写再丢弃   写入 Swap
I/O 代价    无             一次写 I/O     一次写 I/O
恢复方式    从磁盘重读     从磁盘重读     从 Swap 重读
适用场景    优先回收       次优先         尽量避免
```

            

干净的文件页是最理想的回收对象——它们可以直接被丢弃，不需要任何
            I/O 操作，因为数据可以随时从磁盘文件重新读取。
            

### 5.3 swappiness 参数

            

`swappiness`
            参数控制内核在回收内存时，倾向于回收文件页还是匿名页：
            
```
# 查看当前 swappiness 值
sysctl vm.swappiness
# 默认值：60

# 设置 swappiness
sysctl -w vm.swappiness=10
```

            
```
swappiness 值的含义：
──────────────────────────────────
0     极度偏好回收文件页，几乎不使用 swap
      （但并非完全禁用 swap，极端内存压力下仍会换出）
10    强烈偏好回收文件页
60    默认值，在文件页和匿名页之间取得平衡
100   同等对待文件页和匿名页
200   极度偏好换出匿名页（Linux 5.8+ cgroup v2）
```

            

对于数据库服务器，通常建议将 `swappiness`
            设为较低值（如 1 或
            10）。原因是数据库通常有自己的缓冲池（Buffer Pool），比如
            InnoDB 的 Buffer Pool 或 PostgreSQL 的 Shared
            Buffers，这些内存被分配为匿名页。如果
            `swappiness`
            太高，内核可能会把数据库缓冲池中的热数据换出到磁盘，导致灾难性的性能下降。
            

### 5.4 OOM Killer 与页缓存

            

当内存回收（包括页缓存淘汰和交换）都无法释放足够的内存时，内核会触发
            OOM Killer（Out Of Memory
            Killer）来杀死一个或多个进程以释放内存。
            

一个常见的误解是”系统还有很多缓存内存，不应该
            OOM”。事实上，OOM Killer
            在判断是否触发时，已经考虑了可回收的页缓存：
            
```
# 查看 OOM 相关信息
dmesg | grep -i "oom\|out of memory" | tail -10

# 查看进程的 oom_score（值越高越可能被杀）
cat /proc/

/oom_score

# 调整进程的 OOM 优先级（-1000 到 1000）
echo -500 > /proc/

/oom_score_adj    # 降低被杀概率
echo -1000 > /proc/

/oom_score_adj   # 完全豁免（谨慎使用）
```

            

### 5.5 vm.min_free_kbytes
            与水位线

            

`vm.min_free_kbytes`
            参数直接影响内存水位线的计算：
            
```
# 查看当前值
sysctl vm.min_free_kbytes
# 默认值取决于物理内存大小，通常为几十 MB

# 设置更大的值以留出更多安全裕量
sysctl -w vm.min_free_kbytes=262144  # 256MB
```

            
```
水位线计算（近似）：
──────────────────────
min = vm.min_free_kbytes 对应的页数
low = min + min / 4
high = min + min / 2
```

            

增大 `vm.min_free_kbytes`
            的效果是提高所有水位线，让 kswapd
            更早开始工作，减少直接回收的概率。但设置过大会白白浪费内存（这些内存被保留不用）。
            

对于大内存服务器（如 256GB+），推荐将
            `vm.min_free_kbytes` 设为
            1-2GB，以确保在突发大量内存分配时有足够的缓冲空间，避免直接回收。
            

### 5.6 抖动检测：PSI
            内存压力

            

压力失速信息（Pressure Stall Information，PSI）是 Linux
            4.20 引入的一项功能，可以量化系统因内存（以及
            CPU、I/O）不足而导致的性能损失：
            
```
# 查看内存压力
cat /proc/pressure/memory
# 输出示例：
# some avg10=0.50 avg60=0.25 avg300=0.10 total=123456
# full avg10=0.10 avg60=0.05 avg300=0.02 total=23456
```

            
```
PSI 内存指标说明：
──────────────────
some：至少有一个任务因内存压力而被延迟的时间比例
full：所有任务都因内存压力而被延迟的时间比例

avg10/avg60/avg300：过去 10 秒/60 秒/300 秒的移动平均值
total：自系统启动以来的总延迟时间（微秒）
```

            

可以设置 PSI 触发器来在内存压力超过阈值时接收通知：
            
```
# 当 10 秒内 some 指标超过 25% 时触发
echo "some 250000 1000000" > /proc/pressure/memory
# 含义：在 1 秒窗口内，如果等待时间超过 250ms（25%），触发通知
```

            

PSI
            是比单纯监控可用内存更好的内存压力指标。一个系统可能只有 2%
            的可用内存，但如果工作集完全在页缓存中且没有新的大量分配需求，PSI
            内存压力为 0——系统运行良好。
            
            

## 六、Page Cache 监控

            

### 6.1 free 命令

            

`free`
            是最常用的内存查看命令，但很多人误读了它的输出：
            
```
free -h
```

            
```
              total        used        free      shared  buff/cache   available
Mem:           62Gi        8.5Gi       1.2Gi       256Mi       52.3Gi      53.0Gi
Swap:          8.0Gi       0.5Gi       7.5Gi
```

            

关键字段解读：
            
```
字段          含义
──────────────────────────────────────────────────────────
total         物理内存总量
used          已使用的内存（不含 buff/cache）
free          完全空闲的内存（未被任何东西使用）
shared        tmpfs 等共享内存使用量
buff/cache    缓冲区（Buffer）和页缓存（Page Cache）的总和
available     应用程序实际可用的内存（free + 可回收的 cache）
```

            

**常见误解**：看到 `free` 只有
            1.2GB 就以为系统快没内存了。实际上 `available`
            才是判断内存是否充足的正确指标。在上面的例子中，尽管
            `free` 只有 1.2GB，但 `available` 有
            53GB——因为页缓存中的大部分页面都可以被回收。
            

### 6.2 /proc/meminfo

            

`/proc/meminfo` 提供了最详细的内存信息：
            
```
# 查看页缓存相关的关键指标
grep -E 'Cached|Dirty|Writeback|AnonPages|Buffers|Active\(file\)|Inactive\(file\)' /proc/meminfo
```

            
```
字段              含义
──────────────────────────────────────────────────────────
Cached            页缓存大小（不含 tmpfs 使用的内存）
Buffers           块设备缓冲区大小（元数据缓存）
Dirty             当前脏页总量
Writeback         正在回写的页面总量
AnonPages         匿名页总量（堆、栈等）
Active(file)      活跃的文件页（页缓存中经常访问的页面）
Inactive(file)    非活跃的文件页（页缓存中不常访问的页面）
```

            

监控脚本示例：
            
```
#!/bin/bash
# 每秒输出页缓存关键指标
while true; do
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    cached=$(grep '^Cached:' /proc/meminfo | awk '{print $2}')
    dirty=$(grep '^Dirty:' /proc/meminfo | awk '{print $2}')
    writeback=$(grep '^Writeback:' /proc/meminfo | awk '{print $2}')
    active_file=$(grep '^Active(file):' /proc/meminfo | awk '{print $2}')
    inactive_file=$(grep '^Inactive(file):' /proc/meminfo | awk '{print $2}')

    printf "%s  Cached: %8s kB  Dirty: %8s kB  WB: %6s kB  Act: %8s kB  Inact: %8s kB\n" \
        "$timestamp" "$cached" "$dirty" "$writeback" "$active_file" "$inactive_file"

    sleep 1
done
```

            

### 6.3 vmstat

            

`vmstat` 提供了系统级的 I/O 和内存统计：
            
```
# 每秒输出一次 vmstat
vmstat 1 5
```

            
```
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2  0  51200 125000  84000 5400000    0    0   120  2400  800 1200  5  3 90  2  0
 1  0  51200 124000  84000 5401000    0    0    80  1600  750 1100  4  2 92  2  0
```

            

与页缓存相关的列：
            
```
列名    含义                                    关注点
────────────────────────────────────────────────────────────
cache   页缓存大小                              持续下降可能表示内存压力
si      从 swap 读入的数据量（KB/s）            非零表示正在使用 swap
so      写入 swap 的数据量（KB/s）              非零表示内存不足
bi      从块设备读入的数据量（KB/s）            包含缓存未命中导致的磁盘读
bo      写入块设备的数据量（KB/s）              包含脏页回写
wa      CPU 等待 I/O 的时间比例                 高值表示 I/O 瓶颈
```

            

### 6.4 /proc/vmstat

            

`/proc/vmstat`
            包含了大量内核虚拟内存子系统的计数器：
            
```
# 页缓存命中和未命中（如果内核版本支持）
grep -E 'pgpgin|pgpgout|pswpin|pswpout|pgfault|pgmajfault' /proc/vmstat
```

            
```
关键计数器：
──────────────────────────────────────────────────
pgpgin          从磁盘读入的页面数（含页缓存填充）
pgpgout         写入磁盘的页面数（含脏页回写）
pswpin          从 swap 读入的页面数
pswpout         写入 swap 的页面数
pgfault         缺页异常总数（含 minor fault）
pgmajfault      主缺页异常数（需要磁盘 I/O 的缺页）
```

            

主缺页异常（Major Page
            Fault）意味着请求的页面不在页缓存中，必须从磁盘读取。监控
            `pgmajfault`
            的增长率可以直观地反映页缓存的未命中情况：
            
```
# 监控主缺页异常率
watch -n 1 'grep pgmajfault /proc/vmstat'
```

            

### 6.5 sar 历史数据

            

`sar` 命令（来自 sysstat
            包）可以收集和查看历史性能数据：
            
```
# 内存使用历史（含页缓存）
sar -r 1 5
# 输出：kbmemfree kbavail kbbuffers kbcached kbcommit %commit kbactive kbinact kbdirty

# 分页活动历史
sar -B 1 5
# 输出：pgpgin/s pgpgout/s fault/s majflt/s pgfree/s pgscank/s pgscand/s pgsteal/s

# 查看历史数据（指定日期）
sar -r -f /var/log/sysstat/sa18   # 查看 18 号的数据
```

            

`sar -B` 中的关键指标：
            
```
指标        含义                              告警阈值
────────────────────────────────────────────────────
pgscank/s   kswapd 每秒扫描的页面数           持续 > 0 表示内存压力
pgscand/s   直接回收每秒扫描的页面数          > 0 表示严重内存压力
pgsteal/s   每秒成功回收的页面数              应接近 pgscank/s + pgscand/s
majflt/s    每秒主缺页异常数                  持续高值表示缓存不足
```

            

### 6.6 BCC
            工具：cachestat 与 cachetop

            

BCC（BPF Compiler Collection）提供了基于 eBPF（Extended
            Berkeley Packet Filter）的高级页缓存监控工具：
            
```
# 安装 bcc-tools（Ubuntu/Debian）
apt install bcc-tools

# cachestat：全局页缓存命中率统计（每秒）
cachestat 1
```

            
```
# cachestat 输出示例：
    HITS   MISSES  DIRTIES HITRATIO   BUFFERS_MB  CACHED_MB
   15382      234      180   98.50%          82      5273
   14890      156      220   98.96%          82      5275
   16001       89       95   99.45%          82      5276
```

            
```
# cachetop：按进程显示页缓存命中率
cachetop 5
```

            
```
# cachetop 输出示例：
PID      UID      CMD              HITS     MISSES   DIRTIES  READ_HIT%  WRITE_HIT%
18234    postgres postgres         12345    89       234      99.28%     100.00%
18240    mysql    mysqld           8901     456      567      95.12%     100.00%
1024     root     rsync            2345     3456     0        40.42%     -
```

            

`cachetop`
            特别有用——它能精确地告诉你哪个进程的页缓存命中率低，从而定位需要优化的应用。
            

### 6.7
            fincore：检查文件缓存状态

            

`fincore` 命令（来自 util-linux
            包）可以查看特定文件有多少数据在页缓存中：
            
```
# 查看文件的缓存状态
fincore /var/lib/postgresql/14/main/base/16384/16385

# 输出示例：
# RES  PAGES  SIZE FILE
# 12M   3072  120M /var/lib/postgresql/14/main/base/16384/16385
# 说明：120MB 的文件中有 12MB（3072 页）在页缓存中
```

            
```
# 批量查看目录下所有文件的缓存状态
fincore /var/lib/postgresql/14/main/base/16384/* 2>/dev/null | sort -k1 -h -r | head -20
```

            

也可以使用 `vmtouch`
            工具获取更详细的信息：
            
```
# 安装 vmtouch
apt install vmtouch

# 查看文件的缓存状态
vmtouch /var/lib/postgresql/14/main/base/16384/16385

# 输出示例：
#            Files: 1
#      Directories: 0
#   Resident Pages: 3072/30720  12M/120M  10.0%
#          Elapsed: 0.005 seconds
```

            

### 6.8 综合监控脚本

            

以下是一个综合监控页缓存状态的脚本：
            
```
#!/bin/bash
# page_cache_monitor.sh - 页缓存综合监控脚本

INTERVAL=${1:-5}

echo "=== Page Cache Monitor (interval: ${INTERVAL}s) ==="
echo ""

prev_pgpgin=$(awk '/^pgpgin / {print $2}' /proc/vmstat)
prev_pgpgout=$(awk '/^pgpgout / {print $2}' /proc/vmstat)
prev_pgmajfault=$(awk '/^pgmajfault / {print $2}' /proc/vmstat)
prev_pgsteal_direct=$(awk '/^pgsteal_direct / {print $2}' /proc/vmstat)

printf "%-20s %10s %10s %10s %10s %10s %10s %10s\n" \
    "Timestamp" "Cached_MB" "Dirty_MB" "WB_MB" "PgIn/s" "PgOut/s" "MajFlt/s" "DRecl/s"
echo "─────────────────────────────────────────────────────────────────────────────────────────────"

while true; do
    sleep "$INTERVAL"

    timestamp=$(date '+%H:%M:%S')
    cached=$(awk '/^Cached:/ {printf "%.0f", $2/1024}' /proc/meminfo)
    dirty=$(awk '/^Dirty:/ {printf "%.0f", $2/1024}' /proc/meminfo)
    writeback=$(awk '/^Writeback:/ {printf "%.0f", $2/1024}' /proc/meminfo)

    curr_pgpgin=$(awk '/^pgpgin / {print $2}' /proc/vmstat)
    curr_pgpgout=$(awk '/^pgpgout / {print $2}' /proc/vmstat)
    curr_pgmajfault=$(awk '/^pgmajfault / {print $2}' /proc/vmstat)
    curr_pgsteal_direct=$(awk '/^pgsteal_direct / {print $2}' /proc/vmstat)

    pgin_rate=$(( (curr_pgpgin - prev_pgpgin) / INTERVAL ))
    pgout_rate=$(( (curr_pgpgout - prev_pgpgout) / INTERVAL ))
    majfault_rate=$(( (curr_pgmajfault - prev_pgmajfault) / INTERVAL ))
    drecl_rate=$(( (curr_pgsteal_direct - prev_pgsteal_direct) / INTERVAL ))

    printf "%-20s %10s %10s %10s %10s %10s %10s %10s\n" \
        "$timestamp" "$cached" "$dirty" "$writeback" "$pgin_rate" "$pgout_rate" \
        "$majfault_rate" "$drecl_rate"

    prev_pgpgin=$curr_pgpgin
    prev_pgpgout=$curr_pgpgout
    prev_pgmajfault=$curr_pgmajfault
    prev_pgsteal_direct=$curr_pgsteal_direct
done
```

            
            

## 七、Page Cache 与数据库

            

### 7.1 双重缓冲问题

            

大多数数据库都有自己的缓冲池（Buffer
            Pool），这就导致了”双重缓冲”（Double
            Buffering）问题——同一份数据同时存在于数据库的缓冲池和操作系统的页缓存中，浪费了宝贵的内存资源。
            
```
双重缓冲的数据路径：
──────────────────────────────────────────

读取路径：
磁盘 ──> Page Cache ──> 数据库 Buffer Pool ──> 应用程序
         （内核管理）     （数据库管理）

写入路径：
应用程序 ──> 数据库 Buffer Pool ──> Page Cache ──> 磁盘
              （数据库管理）        （内核管理）

问题：同一份 16KB 的 InnoDB 页面，在内存中可能存在两份拷贝
```

            

不同数据库对这个问题的处理策略不同：
            
```
数据库          缓冲池             页缓存策略         说明
─────────────────────────────────────────────────────────────
MySQL/InnoDB    Buffer Pool       O_DIRECT           绕过页缓存，避免双重缓冲
PostgreSQL      Shared Buffers    依赖页缓存          共享缓冲区通常设为内存的 25%
Oracle          SGA               O_DIRECT           绕过页缓存
MongoDB/WiredTiger 内部缓存       依赖页缓存          默认使用 50% 可用内存
RocksDB         Block Cache       O_DIRECT（可选）    默认绕过页缓存
```

            

### 7.2 O_DIRECT 绕过页缓存

            

直接 I/O（Direct I/O）通过在 `open()` 时指定
            `O_DIRECT`
            标志，绕过页缓存，直接在用户空间缓冲区和块设备之间传输数据：
            
```
#include 
#include 

/* 打开文件时指定 O_DIRECT */
int fd = open("/data/db/tablespace", O_RDWR | O_DIRECT);

/* O_DIRECT 的对齐要求：
 * 1. 用户缓冲区地址必须按 512 字节（或文件系统块大小）对齐
 * 2. I/O 大小必须是 512 字节（或文件系统块大小）的倍数
 * 3. 文件偏移量必须是 512 字节（或文件系统块大小）的倍数
 */

/* 分配对齐的缓冲区 */
void *buf;
posix_memalign(&buf, 4096, 16384);  /* 4KB 对齐，16KB 大小 */

/* 直接读写 */
pread(fd, buf, 16384, offset);
pwrite(fd, buf, 16384, offset);
```

            

InnoDB 的 `innodb_flush_method`
            参数控制是否使用 O_DIRECT：
            
```
innodb_flush_method 选项：
──────────────────────────────────────────────
fsync           默认值，使用 fsync() 刷新，不用 O_DIRECT
O_DIRECT        数据文件使用 O_DIRECT，日志文件使用 fsync()
O_DIRECT_NO_FSYNC  数据文件使用 O_DIRECT，假设元数据无需 fsync
O_DSYNC         日志文件使用 O_DSYNC
```

            

### 7.3 PostgreSQL
            与操作系统缓存的交互

            

PostgreSQL 的设计哲学与 InnoDB
            不同——它**依赖**操作系统的页缓存，而不是绕过它。这有几个重要的工程含义：
            
```
PostgreSQL 的内存架构：
──────────────────────────────────────
Shared Buffers（通常为总内存的 25%）
    |
    | PostgreSQL 管理的缓存层
    | 使用时钟扫描（Clock Sweep）算法淘汰
    |
    v
操作系统 Page Cache（占据大部分剩余内存）
    |
    | 内核管理的缓存层
    | 使用 LRU 算法淘汰
    |
    v
磁盘
```

            
```
# PostgreSQL 推荐配置示例（64GB 内存服务器）

# shared_buffers = 16GB（总内存的 25%）
# 不宜设置过大，因为操作系统还需要页缓存空间

# effective_cache_size = 48GB（shared_buffers + 预期的页缓存大小）
# 这不是内存分配参数，而是查询优化器的提示
# 告诉优化器"大约有这么多数据可以从缓存中获取"

# 操作系统参数
sysctl -w vm.swappiness=1          # 尽量不换出匿名页
sysctl -w vm.dirty_background_ratio=2  # 尽早开始回写
sysctl -w vm.dirty_ratio=5            # 降低硬限制
```

            

`shared_buffers` 不宜设置过大的原因是
            PostgreSQL
            在做检查点（Checkpoint）时需要刷出共享缓冲区中的脏页。如果共享缓冲区太大，检查点期间会产生大量的集中写入，导致
            I/O 风暴。
            

### 7.4
            依赖页缓存还是应用缓冲池

            

选择依赖页缓存还是应用自建缓冲池，取决于具体的工作负载特征：
            
```
选择页缓存的场景：
──────────────────
- 应用不需要精细控制缓存淘汰策略
- 多个进程/应用需要共享同一份缓存数据
- 应用开发复杂度敏感，不想自己管理缓存
- 文件访问模式以顺序读为主

选择应用缓冲池的场景：
──────────────────────
- 需要精确控制哪些数据留在缓存中
- 需要自定义淘汰策略（如 LRU-K、ARC）
- 数据页大小与操作系统页大小不一致
- 需要做页面级别的锁管理
- 高性能数据库等对延迟极度敏感的场景
```

            

### 7.5 数据库服务器调优策略

            

针对数据库服务器的页缓存调优策略汇总：
            
```
#!/bin/bash
# db_server_tuning.sh - 数据库服务器页缓存相关调优

# 1. 减少 swap 使用倾向
sysctl -w vm.swappiness=1

# 2. 保守的脏页参数
sysctl -w vm.dirty_background_ratio=3
sysctl -w vm.dirty_ratio=10
sysctl -w vm.dirty_expire_centisecs=1000
sysctl -w vm.dirty_writeback_centisecs=300

# 3. 增大最小空闲内存保留
# 对于 64GB 内存的服务器
sysctl -w vm.min_free_kbytes=524288  # 512MB

# 4. 禁用透明大页（对数据库通常有害）
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag

# 5. 调整 NUMA 策略（如果是多 NUMA 节点服务器）
sysctl -w vm.zone_reclaim_mode=0  # 允许跨 NUMA 节点分配

# 6. 对于使用 O_DIRECT 的数据库（如 MySQL），减小预读
echo 64 > /sys/block/sda/queue/read_ahead_kb
```

            
            

## 八、Page Cache 高级操作

            

### 8.1 清除页缓存

            

Linux 提供了一个接口来手动清除各种缓存：
            
```
# 清除页缓存
sync && echo 1 > /proc/sys/vm/drop_caches

# 清除 dentries 和 inodes 缓存
sync && echo 2 > /proc/sys/vm/drop_caches

# 清除页缓存、dentries 和 inodes 缓存
sync && echo 3 > /proc/sys/vm/drop_caches
```

            

**注意**：`sync` 必须在
            `drop_caches`
            之前执行，否则脏页不会被清除（`drop_caches`
            只清除干净的缓存页面，不会丢弃脏页）。
            
```
drop_caches 的使用场景：
──────────────────────────
适用：
- 基准测试前清除缓存，获得冷启动数据
- 调试页缓存相关问题
- 观察没有缓存时的真实 I/O 模式

不适用（生产环境慎用）：
- 试图"释放内存"——页缓存本身就是有效利用内存
- 定期清除缓存——会导致性能急剧下降
- 作为 OOM 的应对手段——应该排查真正的内存泄漏
```

            

### 8.2 posix_fadvise
            缓存控制

            

`posix_fadvise()`
            是应用程序控制页缓存行为的主要接口：
            
```
#include 

int fd = open("datafile", O_RDONLY);

/* FADV_DONTNEED：从缓存中淘汰指定区域 */
/* 适用于日志处理：读完即丢，避免缓存污染 */
posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);

/* FADV_WILLNEED：将指定区域预读到缓存 */
/* 适用于已知即将访问的数据 */
posix_fadvise(fd, offset, length, POSIX_FADV_WILLNEED);

/* FADV_NOREUSE：提示数据只会被访问一次 */
/* 注意：在许多 Linux 版本中这个提示被忽略 */
posix_fadvise(fd, 0, 0, POSIX_FADV_NOREUSE);
```

            

`FADV_DONTNEED`
            的一个经典用例是日志聚合系统。当 rsync
            或日志收集器顺序读取大量日志文件时，这些数据只需要读取一次就会被发送到远端，不需要留在缓存中：
            
```
# 使用 dd 读取文件后立即丢弃缓存
dd if=/var/log/syslog of=/dev/null bs=1M
# 文件数据现在占据了页缓存

# 用 python 调用 posix_fadvise 清除
python3 -c "
import os
fd = os.open('/var/log/syslog', os.O_RDONLY)
os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
os.close(fd)
"
```

            

### 8.3 madvise 控制 mmap
            区域

            

对于使用 `mmap()` 映射的文件区域，使用
            `madvise()` 来提供访问模式提示：
            
```
#include 
#include 

int fd = open("datafile", O_RDONLY);
size_t size = 1024 * 1024 * 1024;  /* 1GB */
void *addr = mmap(NULL, size, PROT_READ, MAP_SHARED, fd, 0);

/* MADV_SEQUENTIAL：顺序访问，增大预读 */
madvise(addr, size, MADV_SEQUENTIAL);

/* MADV_RANDOM：随机访问，禁用预读 */
madvise(addr, size, MADV_RANDOM);

/* MADV_WILLNEED：即将访问，预读到缓存 */
madvise(addr + offset, length, MADV_WILLNEED);

/* MADV_DONTNEED：不再需要，可以淘汰 */
/* 注意：对于 MAP_PRIVATE 映射，这会丢弃修改 */
madvise(addr + offset, length, MADV_DONTNEED);

/* MADV_FREE：页面可以被延迟回收（Linux 4.5+） */
/* 比 MADV_DONTNEED 更高效：只在内存压力时才回收 */
madvise(addr + offset, length, MADV_FREE);
```

            

### 8.4 sync_file_range
            精细回写控制

            

`sync_file_range()` 提供了比
            `fsync()`
            更精细的回写控制，允许应用程序控制文件特定区域的回写行为：
            
```
#include 

int fd = open("datafile", O_WRONLY);

/* 将指定范围的脏页提交到回写队列，但不等待完成 */
sync_file_range(fd, offset, length,
                SYNC_FILE_RANGE_WRITE);

/* 等待之前提交的回写完成 */
sync_file_range(fd, offset, length,
                SYNC_FILE_RANGE_WAIT_BEFORE | SYNC_FILE_RANGE_WRITE |
                SYNC_FILE_RANGE_WAIT_AFTER);
```

            
```
sync_file_range 的标志位：
──────────────────────────────────────────────────
SYNC_FILE_RANGE_WAIT_BEFORE   等待已提交的回写完成
SYNC_FILE_RANGE_WRITE         将脏页提交到回写队列
SYNC_FILE_RANGE_WAIT_AFTER    等待本次提交的回写完成

组合使用：
- 仅 WRITE：异步提交回写，不等待（最常用）
- WAIT_BEFORE | WRITE | WAIT_AFTER：等价于对范围做 fdatasync
- WAIT_BEFORE | WRITE：确保之前的回写完成后再提交新的
```

            

**注意**：`sync_file_range()`
            **不保证数据持久化**，因为它不会刷新文件元数据，也不会确保底层存储设备的写缓存被刷新。如果需要数据持久化保证，仍然需要使用
            `fsync()` 或 `fdatasync()`。
            

### 8.5 文件锁与页缓存一致性

            

页缓存保证同一台机器上多个进程通过
            `read()`/`write()`
            访问同一文件时的数据一致性——因为所有进程共享同一个页缓存。但在以下场景中需要额外注意：
            
```
页缓存一致性边界：
──────────────────────────────────────
一致的场景：
- 同一台机器上的多个进程通过 read/write 访问同一文件
- 同一台机器上的 mmap 和 read/write 混合使用（内核保证一致）

不一致的场景：
- 网络文件系统（NFS/CIFS）：不同客户端的页缓存相互独立
- O_DIRECT 和 buffered I/O 混合使用同一文件
- 使用 mmap(MAP_PRIVATE) 后修改的数据不会写回文件
```

            

在网络文件系统上使用文件锁（`flock()` 或
            `fcntl()`
            锁）时，需要特别注意页缓存一致性问题：
            
```
#include 
#include 

int fd = open("/nfs/shared/data", O_RDWR);

/* 获取排他锁 */
flock(fd, LOCK_EX);

/* 在 NFS 上，获取锁后必须使缓存失效才能看到最新数据 */
/* 可以通过关闭并重新打开文件，或使用 O_DIRECT 来实现 */

/* ... 读写操作 ... */

/* 释放锁前确保数据持久化 */
fsync(fd);
flock(fd, LOCK_UN);
```

            
            

## 九、Page Cache 调优实战

            

### 9.1
            面向工作负载的调优方案

            

页缓存调优没有万能的参数配置。正确的方法是分析工作负载特征，然后针对性地调整参数。
            
```
工作负载分析维度：
──────────────────────────────────────
1. 读写比例：读密集 vs 写密集 vs 混合
2. 访问模式：顺序 vs 随机 vs 混合
3. 工作集大小：是否能放入内存
4. 延迟敏感度：在线服务 vs 批处理
5. 数据一致性要求：允许丢失 vs 严格持久化
```

            

### 9.2 高吞吐流式处理

            

视频流、日志收集、数据管道等场景的特征是大量顺序读写，对吞吐量要求高，对延迟不敏感：
            
```
#!/bin/bash
# streaming_tuning.sh - 高吞吐流式处理调优

# 增大预读窗口，最大化顺序读吞吐
echo 2048 > /sys/block/sda/queue/read_ahead_kb

# 允许更多脏页积累，减少回写频率，提高写合并机会
sysctl -w vm.dirty_background_ratio=10
sysctl -w vm.dirty_ratio=40
sysctl -w vm.dirty_expire_centisecs=6000   # 60 秒
sysctl -w vm.dirty_writeback_centisecs=1000  # 10 秒

# 增加 I/O 调度器队列深度（NVMe 设备）
echo 1024 > /sys/block/nvme0n1/queue/nr_requests

# 对于单次读取的大文件，建议应用使用 FADV_SEQUENTIAL
# 以下是 Python 示例：
python3 -c "
import os
fd = os.open('/data/video/large_file.mp4', os.O_RDONLY)
os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_SEQUENTIAL)
# ... 流式读取 ...
os.close(fd)
"
```

            

### 9.3 低延迟数据库

            

在线事务处理（Online Transaction
            Processing，OLTP）数据库的特征是随机读写、延迟敏感、数据一致性要求高：
            
```
#!/bin/bash
# oltp_tuning.sh - 低延迟数据库调优

# 保守的脏页参数：减少回写风暴
sysctl -w vm.dirty_background_ratio=3
sysctl -w vm.dirty_ratio=10
sysctl -w vm.dirty_expire_centisecs=500    # 5 秒
sysctl -w vm.dirty_writeback_centisecs=100  # 1 秒

# 几乎不使用 swap
sysctl -w vm.swappiness=1

# 增大安全裕量，避免直接回收
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MIN_FREE=$((TOTAL_MEM_KB / 128))  # 约 0.78% 的总内存
if [ $MIN_FREE -lt 524288 ]; then
    MIN_FREE=524288  # 至少 512MB
fi
sysctl -w vm.min_free_kbytes=$MIN_FREE

# 减小预读（数据库多为随机 I/O）
echo 64 > /sys/block/sda/queue/read_ahead_kb

# 禁用透明大页
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag

# NUMA 优化
sysctl -w vm.zone_reclaim_mode=0

# 对于使用 O_DIRECT 的 MySQL/InnoDB：
# innodb_flush_method = O_DIRECT
# innodb_buffer_pool_size = 总内存的 70-80%
```

            

### 9.4
            日志聚合：防止缓存污染

            

日志聚合系统（如
            Fluentd、Logstash、rsync）的特征是顺序读取大量文件，每个文件只读一次：
            
```
#!/bin/bash
# log_aggregation_tuning.sh - 日志聚合调优

# 中等预读（日志是顺序读，但每个文件只读一次）
echo 256 > /sys/block/sda/queue/read_ahead_kb

# 适中的脏页参数
sysctl -w vm.dirty_background_ratio=5
sysctl -w vm.dirty_ratio=15
```

            

在应用层面防止缓存污染的最佳实践：
            
```
/* log_reader.c - 读取日志文件后释放缓存 */
#include 
#include 
#include 

void process_log_file(const char *path) {
    int fd = open(path, O_RDONLY);
    if (fd  0) {
        /* 处理日志数据 */
        process_data(buf, n);

        /* 已读过的区域不再需要，从缓存淘汰 */
        posix_fadvise(fd, 0, offset, POSIX_FADV_DONTNEED);
        offset += n;
    }

    /* 最后一段也淘汰 */
    posix_fadvise(fd, 0, 0, POSIX_FADV_DONTNEED);
    close(fd);
}
```

            

### 9.5 综合调优清单

            

以下是页缓存调优的完整参数清单：
            
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Page Cache 调优清单                                   │
├──────────────────────────────────┬───────────────────────────────────────────┤
│ 参数                             │ 说明与建议                                │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.dirty_background_ratio        │ 后台回写启动阈值                          │
│                                  │ 数据库：3-5%  流式：10-20%               │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.dirty_ratio                   │ 写阻塞阈值                                │
│                                  │ 数据库：10-15%  流式：30-40%             │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.dirty_expire_centisecs        │ 脏页过期时间                              │
│                                  │ 数据库：500-1000  流式：3000-6000        │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.dirty_writeback_centisecs     │ 回写线程唤醒间隔                          │
│                                  │ 数据库：100-300  流式：500-1000          │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.swappiness                    │ 交换倾向                                  │
│                                  │ 数据库：1-10  通用：30-60                │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.min_free_kbytes               │ 最小空闲内存保留                          │
│                                  │ 根据总内存设置，通常 512MB-2GB           │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ vm.vfs_cache_pressure            │ VFS 缓存回收压力                          │
│                                  │ 默认 100，增大则更积极回收 dentry/inode  │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ read_ahead_kb                    │ 预读大小                                  │
│                                  │ 随机 I/O：32-64  顺序 I/O：256-4096     │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ wbt_lat_usec                     │ 回写节流目标延迟                          │
│                                  │ SSD：50000-75000  HDD：禁用（0）         │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ transparent_hugepage             │ 透明大页                                  │
│                                  │ 数据库：never  通用：madvise             │
├──────────────────────────────────┼───────────────────────────────────────────┤
│ zone_reclaim_mode                │ NUMA 区域回收                             │
│                                  │ 数据库：0  NUMA 敏感应用：1              │
└──────────────────────────────────┴───────────────────────────────────────────┘
```

            

调优验证步骤：
            
```
#!/bin/bash
# verify_tuning.sh - 验证页缓存调优效果

echo "=== 当前内核参数 ==="
sysctl vm.dirty_background_ratio \
       vm.dirty_ratio \
       vm.dirty_expire_centisecs \
       vm.dirty_writeback_centisecs \
       vm.swappiness \
       vm.min_free_kbytes \
       vm.vfs_cache_pressure

echo ""
echo "=== 块设备参数 ==="
for dev in /sys/block/sd* /sys/block/nvme*; do
    [ -d "$dev" ] || continue
    name=$(basename "$dev")
    ra=$(cat "$dev/queue/read_ahead_kb" 2>/dev/null)
    wbt=$(cat "$dev/queue/wbt_lat_usec" 2>/dev/null)
    echo "$name: read_ahead_kb=$ra  wbt_lat_usec=$wbt"
done

echo ""
echo "=== 当前内存状态 ==="
free -h

echo ""
echo "=== 脏页状态 ==="
grep -E 'Dirty|Writeback' /proc/meminfo

echo ""
echo "=== 内存压力 ==="
cat /proc/pressure/memory 2>/dev/null || echo "PSI not available"

echo ""
echo "=== 透明大页状态 ==="
cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null

echo ""
echo "=== 直接回收统计 ==="
grep -E 'allocstall|pgsteal_direct' /proc/vmstat
```

            
            

## 参考文献

            
            
- Mel Gorman. *Understanding the Linux Virtual Memory
            Manager*. Prentice Hall, 2004.
            
- Robert Love. *Linux Kernel Development*, 3rd
            Edition. Addison-Wesley, 2010.
            
- Linux 内核文档：Documentation/admin-guide/sysctl/vm.rst.
            https://www.kernel.org/doc/Documentation/admin-guide/sysctl/vm.rst
            
- Linux 内核文档：Documentation/filesystems/vfs.rst. https://www.kernel.org/doc/Documentation/filesystems/vfs.rst
            
- Matthew Wilcox. “XArray: A New Data Structure for the
            Linux Kernel.” LWN.net, 2018. https://lwn.net/Articles/745073/
            
- Matthew Wilcox. “Folios.” LWN.net, 2021. https://lwn.net/Articles/849538/
            
- Jens Axboe. “Writeback Throttling.” LWN.net, 2016. https://lwn.net/Articles/682582/
            
- Brendan Gregg. *Systems Performance: Enterprise and
            the Cloud*, 2nd Edition. Addison-Wesley, 2020.
            
- PostgreSQL 文档：Resource Consumption - Memory. https://www.postgresql.org/docs/current/runtime-config-resource.html
            
- MySQL 文档：InnoDB Disk I/O and File Space Management.
            https://dev.mysql.com/doc/refman/8.0/en/innodb-disk-io.html
            
- Linux
            内核文档：Documentation/admin-guide/mm/concepts.rst. https://www.kernel.org/doc/Documentation/admin-guide/mm/concepts.rst
            
- Jonathan Corbet. “Toward better readahead.” LWN.net,
            2020. [https://lwn.net/Articles/835757/](https://lwn.net/Articles/835757/)
            
- Facebook Engineering. “Pressure Stall Information for
            CPU, Memory, and IO.” 2018. https://facebookmicrosites.github.io/psi/
            
- Brendan Gregg. *BPF Performance Tools*.
            Addison-Wesley, 2019.
            
            
            

**上一篇**: 块设备层：bio、request
            与 I/O 调度器 **下一篇**: Direct I/O 与
            O_DIRECT：绕过缓存的得与失
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-28 · linux / storage
                    

### fsync 失败的真相：当它返回错误，你的数据可能已经没了

                    

fsync() 返回 EIO 后再调一次为什么会成功？为什么这反而是灾难？从 2018 fsyncgate 到 Linux errseq_t，再到本机内核 6.6 上用 dm-error 单块故障注入的实测，讲清 writeback 失败时脏页被标记 clean、数据静默丢失的真相，以及 PostgreSQL 为什么选择 PANIC。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

在 Linux 的传统 I/O 路径中，应用程序通过 read() 和 write() 系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】POSIX 文件锁：flock、fcntl 与 NFS 锁的工程陷阱

                    

拆解 POSIX 文件锁三大 API 的语义差异，深入 close-any-fd 释放陷阱、OFD 锁机制、F_GETLK 竞态和 NFS 锁恢复的工程真相，给出每种场景的正确选择。
                

                
                    

2025-10-14 · storage
                    

### 【存储工程】缓存工程：从 Page Cache 到应用层缓存

                    

深入分析存储多级缓存架构——Page Cache、Buffer Pool、应用缓存的协同设计，缓存淘汰算法对比，缓存穿透/击穿/雪崩的防护策略