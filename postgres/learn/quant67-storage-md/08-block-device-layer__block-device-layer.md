# 【存储工程】块设备层：bio、request 与 I/O 调度器

来源: https://quant67.com/post/storage/08-block-device-layer/block-device-layer.html
日期: 2025-08-17 |

---

文件系统把”写这个文件”翻译成”写这些逻辑块”，但逻辑块怎么变成磁盘控制器能执行的命令？中间那一层就是块设备层（Block
            Layer）。它做的事不复杂——把上层的 I/O
            请求收集、合并、排序，然后交给设备驱动——但做得好不好，直接决定了存储栈的吞吐和延迟。
            

从 Linux 2.6 到
            5.0，块设备层经历了一次架构级重写：从单队列（Single
            Queue）到多队列（Multi-Queue，即
            blk-mq）。这次重写的驱动力很简单：NVMe
            设备可以同时处理几十万个 I/O
            请求，而旧的单队列架构在一把大锁上排队，成了整个 I/O
            栈最大的瓶颈。
            

本文从块设备层在 I/O 栈中的位置讲起，逐层拆解
            `bio` 结构体、请求合并机制、blk-mq
            多队列架构、四种 I/O 调度器的设计与参数调优，最后落到
            `blktrace` 实战分析和 cgroup I/O
            控制。所有源码引用基于 Linux 6.1 内核，命令示例在 Ubuntu
            22.04（内核 5.15+）上验证。
            
            

## 一、块设备层在 I/O
            栈中的位置

            

### 1.1 I/O 栈全景

            

一次 `write()`
            系统调用从用户空间到磁盘扇区，大致经过以下层次：
            
```
用户空间
  └─ write() 系统调用
       └─ VFS（Virtual File System，虚拟文件系统）
            └─ 具体文件系统（ext4 / XFS / Btrfs）
                 └─ Page Cache（页缓存）
                      └─ 块设备层（Block Layer）    ← 本文聚焦
                           └─ 设备驱动（Device Driver）
                                └─ 硬件控制器（HBA / NVMe Controller）
                                     └─ 存储介质（HDD / SSD）
```

            

块设备层的上游是文件系统和页缓存，下游是设备驱动。它的输入是
            `bio`
            结构体——描述”从哪些内存页读写哪些磁盘扇区”；输出是格式化好的请求（`request`），交给驱动的派发函数。
            

### 1.2 块设备层的核心职责

            

块设备层做四件事：
            
            
- **I/O 提交**：接收上层的
            `bio`，找到对应的块设备和请求队列。
            
- **I/O 合并**：把相邻的 `bio`
            合并成更大的 `request`，减少驱动交互次数。
            
- **I/O 调度**：对 `request`
            排序和优先级控制，平衡吞吐和延迟。
            
- **I/O
            完成**：驱动完成请求后，触发回调通知上层。
            
            

### 1.3 从单队列到多队列

            

Linux 2.6
            时代的块设备层用一个请求队列（`request_queue`）管理所有
            I/O。这个队列由一把自旋锁（`queue_lock`）保护，所有
            CPU 提交 I/O 都要争这把锁。在 HDD
            时代问题不大——设备本身就慢，锁竞争不是瓶颈。但 NVMe
            设备出现后，设备处理 I/O
            的速度远超内核排队的速度，单队列成了性能天花板。
            

Jens Axboe 在 2013 年提出了 blk-mq（Block
            Multi-Queue）架构。核心思路：
            
            
- 每个 CPU 一个软件暂存队列（Software Staging
            Queue），消除提交路径上的锁竞争。
            
- 一个或多个硬件派发队列（Hardware Dispatch
            Queue），直接映射到设备的硬件队列。
            
- 用标签（Tag）追踪每个请求，取代旧的请求编号机制。
            
            

从 Linux 5.0
            开始，旧的单队列代码被彻底删除，所有块设备都走 blk-mq
            路径。
            
```
单队列时代（Linux 2.6 ~ 4.x）：

  CPU 0 ──┐
  CPU 1 ──┤
  CPU 2 ──┼── request_queue（一把锁）──── 设备驱动
  CPU 3 ──┘

多队列时代（Linux 5.0+）：

  CPU 0 ── ctx[0] ──┐                    ┌── hw queue 0 ── 设备驱动
  CPU 1 ── ctx[1] ──┤── I/O 调度器  ────┤
  CPU 2 ── ctx[2] ──┤                    └── hw queue 1 ── 设备驱动
  CPU 3 ── ctx[3] ──┘
```

            

这个架构变化影响了后续所有的 I/O
            调度器设计——新调度器必须能在多队列环境下工作。
            
            

## 二、bio 结构体详解

            

### 2.1 bio：块 I/O 的基本单元

            

`bio`（Block I/O）是内核块设备层的基本 I/O
            描述单元。每个 `bio`
            描述一段连续的磁盘区域和对应的内存页。当文件系统需要读写磁盘时，它构造一个或多个
            `bio`，提交给块设备层。
            

`bio`
            不等于一次磁盘操作。一个大的文件写入可能拆成多个
            `bio`，而多个相邻的 `bio`
            又可能被合并成一个 `request`。
            

### 2.2 struct bio 关键字段

            

以下代码摘自 Linux
            6.1，`include/linux/bio.h`，经删减仅保留核心字段：
            
```
/* Linux 6.1, include/linux/bio.h（删减版） */
struct bio {
    struct bio             *bi_next;      /* 链表指针，用于请求队列 */
    struct block_device    *bi_bdev;      /* 目标块设备 */
    unsigned int            bi_opf;       /* 操作类型 + 标志位 */
    unsigned short          bi_vcnt;      /* bio_vec 数组中的有效条目数 */
    unsigned short          bi_max_vecs;  /* bio_vec 数组的最大容量 */
    atomic_t                __bi_cnt;     /* 引用计数 */
    struct bvec_iter        bi_iter;      /* I/O 进度迭代器 */
    bio_end_io_t           *bi_end_io;    /* I/O 完成回调 */
    void                   *bi_private;   /* 回调的私有数据 */
    unsigned short          bi_write_hint; /* 写入生命周期提示 */
    struct bio_vec         *bi_io_vec;    /* 指向 bio_vec 数组 */
};
```

            

几个关键字段的含义：
            
            
- `bi_bdev`：指向目标块设备，内核通过它找到对应的请求队列。
            
- `bi_opf`：操作类型（读、写、丢弃、刷新等）和标志位的组合。低位是操作码，高位是标志（如
            `REQ_SYNC`、`REQ_META`）。
            
- `bi_io_vec`：指向一个 `bio_vec`
            数组，描述这次 I/O 涉及的内存页。
            
- `bi_iter`：迭代器，跟踪当前 I/O
            进度——已经处理到哪个扇区、哪个 `bio_vec`。
            
- `bi_end_io`：I/O
            完成后的回调函数，负责通知上层（如页缓存的
            `end_bio_bh_io_sync`）。
            
            

### 2.3
            bio_vec：散列-聚集描述

            

`bio_vec`（Bio Vector）是 `bio`
            的内存描述单元，每个 `bio_vec`
            指向一个内存页的一个连续区间：
            
```
/* Linux 6.1, include/linux/bvec.h */
struct bio_vec {
    struct page  *bv_page;    /* 内存页指针 */
    unsigned int  bv_len;     /* 这段数据的长度（字节） */
    unsigned int  bv_offset;  /* 在页内的起始偏移 */
};
```

            

这三个字段组合起来就是”页 + 偏移 +
            长度”，描述了内存中一段连续的数据缓冲区。多个
            `bio_vec`
            组成散列-聚集（Scatter-Gather）列表，允许一次 I/O
            操作涉及多个不连续的内存页。
            

例如，一个 16KB 的写入可能由 4 个 `bio_vec`
            组成，每个指向一个 4KB 的页面：
            
```
bio
 └─ bi_io_vec[]
      [0] page=0xffff8800, offset=0,    len=4096
      [1] page=0xffff8810, offset=0,    len=4096
      [2] page=0xffff8820, offset=0,    len=4096
      [3] page=0xffff8830, offset=0,    len=4096

总大小 = 4 × 4096 = 16384 字节（16KB）
磁盘区域 = bi_iter.bi_sector 开始的连续 32 个扇区
```

            

### 2.4 bvec_iter：跟踪 I/O
            进度

            

`bvec_iter`（Bio Vec Iterator）是 bio
            内部的进度追踪器：
            
```
/* Linux 6.1, include/linux/bvec.h */
struct bvec_iter {
    sector_t         bi_sector;   /* 当前 I/O 的起始扇区号 */
    unsigned int     bi_size;     /* 剩余字节数 */
    unsigned int     bi_idx;      /* 当前 bio_vec 索引 */
    unsigned int     bi_bvec_done; /* 当前 bio_vec 已完成的字节数 */
};
```

            

为什么需要迭代器？因为一个 `bio`
            可能被拆分（split）。当 `bio`
            跨越了设备的最大请求大小时，块设备层会用
            `bio_split()` 把它拆成两个
            `bio`，共享同一个 `bio_vec`
            数组，但各自有独立的
            `bvec_iter`。这样拆分操作不需要复制内存页的指针。
            

### 2.5 bio 生命周期

            

一个 `bio` 从创建到释放，经历以下阶段：
            
```
1. 分配：bio_alloc() 或 bio_alloc_bioset()
     └─ 从 bio 内存池分配，避免在 I/O 路径上触发内存回收的死锁
2. 填充：设置 bi_bdev、bi_opf，用 bio_add_page() 添加内存页
     └─ bio_add_page() 检查是否超过设备的 max_segments 限制
3. 提交：submit_bio()
     └─ 进入块设备层的合并和调度流程
4. 派发：被合并进 request，或单独作为 request 派发给驱动
     └─ 驱动通过 DMA 把数据搬到磁盘（或从磁盘搬到内存）
5. 完成：驱动调用 bio_endio()
     └─ 触发 bi_end_io 回调
6. 释放：bio_put() 递减引用计数，计数归零时释放
```

            

### 2.6 bio 的操作类型

            

`bi_opf`
            字段由操作码和标志位组合而成。常见的操作码定义在
            `include/linux/blk_types.h`：
            
```
/* Linux 6.1, include/linux/blk_types.h（部分） */
enum req_op {
    REQ_OP_READ     = 0,    /* 读操作 */
    REQ_OP_WRITE    = 1,    /* 写操作 */
    REQ_OP_FLUSH    = 2,    /* 刷新设备写缓存 */
    REQ_OP_DISCARD  = 3,    /* 通知设备某些块不再使用（TRIM） */
    REQ_OP_WRITE_ZEROES = 9, /* 将指定范围写零 */
};
```

            

标志位用于修饰操作的行为：
            
            
            
            标志
            含义
            
            
            
            
            `REQ_SYNC`
            同步 I/O，提交者希望尽快完成
            
            
            `REQ_META`
            元数据 I/O（如 inode、日志块）
            
            
            `REQ_PRIO`
            高优先级 I/O
            
            
            `REQ_FUA`
            强制写穿（Force Unit Access），跳过设备写缓存
            
            
            `REQ_PREFLUSH`
            先刷缓存再执行本次写入
            
            
            
            

这些标志会影响 I/O
            调度器的处理方式。例如，`REQ_SYNC` 的请求在
            mq-deadline
            调度器中会走读队列的逻辑（即使它是写操作），以获得更短的截止时间。
            
            

## 三、Request 与请求合并

            

### 3.1 从 bio 到 request

            

`bio` 进入块设备层后，第一步是尝试合并到已有的
            `request` 中。如果无法合并，就创建一个新的
            `request`。
            

`request` 是块设备层面向驱动的 I/O 单元。一个
            `request` 可以包含多个 `bio`，这些
            `bio`
            描述的磁盘区域必须连续。`request`
            结构体的关键字段：
            
```
/* Linux 6.1, include/linux/blk-mq.h（删减版） */
struct request {
    struct request_queue   *q;           /* 所属请求队列 */
    struct blk_mq_ctx      *mq_ctx;     /* 所属的软件队列上下文 */
    struct blk_mq_hw_ctx   *mq_hctx;    /* 目标硬件队列 */
    unsigned int            cmd_flags;   /* 操作类型和标志 */
    sector_t                __sector;    /* 起始扇区 */
    unsigned int            __data_len;  /* 数据总长度 */
    int                     tag;         /* blk-mq 标签 */
    struct bio             *bio;         /* 第一个 bio */
    struct bio             *biotail;     /* 最后一个 bio */
    struct list_head        queuelist;   /* 队列链表节点 */
    /* ... */
};
```

            

`bio` 和 `biotail` 指向
            `bio` 链表的头尾。当多个 `bio`
            被合并进同一个 `request` 时，它们通过
            `bi_next` 串成链表。
            

### 3.2 合并策略

            

块设备层支持三种合并模式：
            

**后向合并（Back Merge）**：新
            `bio` 的起始扇区紧跟在已有 `request`
            的末尾扇区之后。这是最常见的合并类型——顺序写入天然产生后向合并。
            
```
已有 request: 扇区 [100, 200)
新 bio:       扇区 [200, 250)
合并结果:     扇区 [100, 250)    ← 后向合并
```

            

**前向合并（Front Merge）**：新
            `bio` 的末尾扇区紧接在已有 `request`
            的起始扇区之前。相对少见，但文件系统的预读（Read-Ahead）有时会产生这种模式。
            
```
已有 request: 扇区 [200, 300)
新 bio:       扇区 [150, 200)
合并结果:     扇区 [150, 300)    ← 前向合并
```

            

**不合并（No Merge）**：新 `bio`
            和任何已有 `request`
            都不相邻，或者超过了设备的最大请求大小（`max_sectors_kb`），创建新
            `request`。
            

合并的查找过程使用每个请求队列维护的哈希表（`elevator_hash`），以扇区号为键，快速判断是否存在可合并的
            `request`。
            

### 3.3 合并的限制

            

不是所有相邻的 `bio`
            都能合并。以下情况会阻止合并：
            
            
- 合并后的请求超过 `max_sectors_kb`（默认通常为
            512KB 或 1280KB）。
            
- 合并后的散列-聚集段数超过
            `max_segments`（每个请求最多包含多少个不连续内存段）。
            
- 两个 `bio`
            的操作类型不同（如一个读一个写）。
            
- 设备或调度器禁用了合并（`nomerges`
            标志）。
            
            

可以通过 sysfs 查看和调整这些参数：
            
```
# 查看最大请求大小
cat /sys/block/sda/queue/max_sectors_kb

# 查看最大散列-聚集段数
cat /sys/block/sda/queue/max_segments

# 查看合并策略（0=全部合并，1=不尝试合并，2=不尝试前向合并）
cat /sys/block/sda/queue/nomerges
```

            

### 3.4 Plugging
            机制：批量提交

            

如果每个 `bio`
            到达时都立即尝试合并和派发，效率很低——因为上层往往会在短时间内连续提交多个
            `bio`。Plugging（插塞）机制解决这个问题：先把
            `bio` 攒在每个 CPU
            的本地列表中，等攒够了再一次性提交给调度器。
            

工作流程：
            
```
1. 线程调用 blk_start_plug()，在当前线程的 task_struct 中分配 plug 列表
2. 后续的 submit_bio() 不直接进入调度器，而是挂到 plug 列表
3. 当以下任一条件满足时，触发 unplug：
   - 线程调用 blk_finish_plug()
   - plug 列表达到 BLK_MAX_REQUEST_COUNT（默认 32）
   - 线程在 I/O 上等待（调用 io_schedule()）
4. unplug 时，plug 列表中的 bio 被排序、合并、一次性提交给调度器
```

            

这个机制对顺序 I/O 的效果非常明显。以 `dd`
            写入为例：
            
```
# 写入 1GB 数据（bs=4k），观察合并效果
dd if=/dev/zero of=/mnt/test bs=4k count=262144 oflag=direct 2>&1

# 查看合并统计
cat /sys/block/sda/stat
# 字段含义（按顺序）：
# read_ios read_merges read_sectors read_ticks
# write_ios write_merges write_sectors write_ticks
# in_flight io_ticks time_in_queue
# discard_ios discard_merges discard_sectors discard_ticks
# flush_ios flush_ticks
```

            

`write_merges`
            字段就是后向/前向合并的次数。如果顺序写入没有发生合并，说明
            plug 列表没有正常工作，或者 `nomerges`
            被设置了。
            

### 3.5 合并对性能的影响

            

合并的好处很直观：减少驱动需要处理的请求数。一次 DMA 传输
            256KB 比 64 次传输 4KB 高效得多——减少了中断次数、DMA
            映射开销和驱动的请求处理开销。
            

但合并也有代价：
            
            
- 增加了 I/O 的延迟——bio 要在 plug
            列表中等待合并机会。
            
- 对于 NVMe
            设备，合并的收益递减——设备本身有很深的内部队列，可以高效处理大量小请求。
            
            

实际测试中的经验判断：HDD 场景下合并通常带来 2~5
            倍的吞吐提升，NVMe 场景下合并的收益通常不到 10%。如果你的
            NVMe 工作负载以小 I/O 为主，可以考虑禁用合并来降低延迟：
            
```
# 禁用合并（适用于低延迟 NVMe 场景）
echo 2 > /sys/block/nvme0n1/queue/nomerges
```

            
            

## 四、blk-mq 多队列架构

            

### 4.1 为什么需要多队列

            

单队列架构的瓶颈在 Linux 3.x 时代已经暴露：
            
            
- **锁竞争**：所有 CPU 提交 I/O 都要获取
            `request_queue->queue_lock`。在 32
            核以上的服务器上，这把锁的争用会消耗大量 CPU 时间。
            
- **缓存行抖动**：多个 CPU
            频繁修改同一个队列的元数据，导致缓存一致性协议（MESI）产生大量无效化消息。
            
- **NUMA
            不友好**：请求队列通常分配在一个节点上，远端节点的
            CPU 每次访问都要走内存互联。
            
- **无法匹配硬件并行度**：NVMe 设备有 64
            个以上的硬件队列，但内核只用一个队列喂数据。
            
            

在 IOPS 敏感的场景下（如数据库的随机 4KB
            读写），单队列架构可能把 NVMe 设备的实际性能限制在其能力的
            30% 以下。
            

### 4.2 blk-mq 架构详解

            

blk-mq 的核心数据结构有三个：
            

**软件暂存队列（`blk_mq_ctx`）**：每个
            CPU 一个。`bio` 先进入本 CPU 的软件队列，不需要跨
            CPU 加锁。
            

**硬件派发队列（`blk_mq_hw_ctx`）**：映射到设备的硬件队列。一个设备可以有多个硬件派发队列。典型配置：NVMe
            设备为每个 CPU 创建一个硬件队列；HDD/SATA SSD
            通常只有一个硬件队列。
            

**标签集（`blk_mq_tag_set`）**：为每个硬件队列管理请求标签。标签是一个整数，用于在请求完成时快速定位对应的
            `request` 结构体。
            

数据流：
            
```
submit_bio()
  │
  ├─ 获取当前 CPU 的 blk_mq_ctx
  │
  ├─ 尝试在 plug list 中合并
  │    ├─ 成功 → 合并到已有 request
  │    └─ 失败 → 分配新 request（获取 tag）
  │
  ├─ request 进入 I/O 调度器（如果有的话）
  │    ├─ 调度器决定何时派发
  │    └─ 可能重新排序请求
  │
  └─ 派发到 blk_mq_hw_ctx
       │
       └─ 调用驱动的 queue_rq() 函数
            └─ 驱动把请求写入设备的提交队列（如 NVMe SQ）
```

            

### 4.3 标签机制

            

标签（Tag）是 blk-mq
            的核心创新之一。每个正在处理的请求都分配一个唯一的整数标签，范围是
            `[0, queue_depth)`。
            

标签的作用：
            
            
- **快速查找**：设备完成一个 I/O
            后，返回标签号。内核通过标签号直接索引到
            `request` 结构体，不需要遍历队列。
            
- **流控**：标签的总数等于队列深度。当标签用完时，新请求会等待，自动实现了背压（Backpressure）。
            
- **无锁分配**：标签使用位图（`sbitmap`）管理，支持每
            CPU 缓存，减少跨 CPU 竞争。
            
            
```
# 查看 NVMe 设备的队列深度（标签总数）
cat /sys/block/nvme0n1/queue/nr_requests

# 查看硬件队列数量
ls /sys/block/nvme0n1/mq/
# 输出示例：0  1  2  3  4  5  6  7（8 个硬件队列）

# 查看每个硬件队列的状态
cat /sys/block/nvme0n1/mq/0/nr_reserved_tags
cat /sys/block/nvme0n1/mq/0/nr_tags
```

            

### 4.4 CPU 亲和性与 NUMA
            感知

            

blk-mq 的队列映射通过 `blk_mq_map_queues()`
            实现，支持三种映射策略：
            
            
- **默认映射**：每个 CPU
            映射到一个硬件队列。如果硬件队列数小于 CPU 数，多个 CPU
            共享一个硬件队列。
            
- **NUMA 感知映射**：优先把同一 NUMA 节点的
            CPU 映射到同一个硬件队列，减少跨节点内存访问。
            
- **管理队列映射**：为管理命令（如 NVMe admin
            命令）分配专用队列。
            
            

NVMe 驱动默认每个 CPU 分配一个 I/O
            队列（如果设备支持足够多的队列）。这意味着每个 CPU
            有自己独立的提交队列和完成队列，从提交到完成全程无锁。
            

查看 CPU 到队列的映射：
            
```
# 查看 CPU 亲和性
for i in /sys/block/nvme0n1/mq/*/cpu_list; do
    echo "$(dirname $i | xargs basename): $(cat $i)"
done
# 输出示例：
# 0: 0
# 1: 1
# 2: 2
# 3: 3
```

            

### 4.5 blk-mq sysfs 接口

            

blk-mq 在 sysfs 中暴露了丰富的调试信息：
            
```
# 队列级别参数
/sys/block//queue/
├── nr_requests          # 队列深度
├── scheduler            # 当前 I/O 调度器
├── nomerges             # 合并策略
├── max_sectors_kb       # 单个请求最大大小
├── read_ahead_kb        # 预读大小
├── rotational           # 是否旋转设备（0=SSD，1=HDD）
├── io_poll              # 是否启用轮询
└── write_cache          # 写缓存状态

# 多队列级别信息
/sys/block//mq/
├── 0/
│   ├── nr_tags          # 该队列的标签总数
│   ├── nr_reserved_tags # 预留标签数
│   ├── cpu_list         # 映射到该队列的 CPU 列表
│   └── dispatched       # 派发统计
├── 1/
│   └── ...
└── ...
```

            
            

## 五、I/O 调度器深度解析

            

Linux 5.0+ 的 blk-mq 架构支持四种 I/O 调度器（I/O
            Scheduler）：`mq-deadline`、`bfq`、`kyber`
            和
            `none`。调度器位于软件队列和硬件派发队列之间，决定请求的派发顺序。
            

不同调度器的设计目标不同：
            
            
            
            调度器
            设计目标
            适用场景
            
            
            
            
            `mq-deadline`
            保证延迟上界
            HDD、混合负载
            
            
            `bfq`
            公平带宽分配
            桌面、cgroup 隔离
            
            
            `kyber`
            延迟目标驱动
            NVMe、快速设备
            
            
            `none`
            最小开销
            NVMe 内部调度
            
            
            
            

### 5.1 mq-deadline

            

`mq-deadline` 是 `deadline`
            调度器的多队列版本，代码位于
            `block/mq-deadline.c`。它的核心思路：在优化吞吐的同时，保证每个请求在截止时间前被服务。
            

#### 数据结构

            

`mq-deadline` 维护四个队列：
            
```
读排序队列（rb_tree）    写排序队列（rb_tree）
      ↕                        ↕
读 FIFO 队列（list）     写 FIFO 队列（list）
```

            
            
- **排序队列**：按扇区号排序的红黑树。从排序队列派发请求可以减少磁头移动距离（对
            HDD 有意义）。
            
- **FIFO
            队列**：按到达时间排序的链表。当请求在 FIFO
            队列中等待超过截止时间，调度器切换到 FIFO
            模式派发，防止饿死。
            
            

#### 关键参数

            
```
# 查看 mq-deadline 参数
ls /sys/block/sda/queue/iosched/
# 输出：fifo_batch  front_merges  read_expire  write_expire  writes_starved

# 各参数含义和默认值：
cat /sys/block/sda/queue/iosched/read_expire
# 500（毫秒）—— 读请求的截止时间

cat /sys/block/sda/queue/iosched/write_expire
# 5000（毫秒）—— 写请求的截止时间

cat /sys/block/sda/queue/iosched/writes_starved
# 2 —— 连续服务多少批读请求后，必须服务一批写请求

cat /sys/block/sda/queue/iosched/fifo_batch
# 16 —— 从 FIFO 切换到排序模式前，连续派发多少个 FIFO 请求

cat /sys/block/sda/queue/iosched/front_merges
# 1 —— 是否允许前向合并（0=禁用，1=启用）
```

            

#### 派发逻辑

            

调度器每次选择下一个要派发的请求时，按以下优先级决策：
            
            
- 检查读 FIFO 队列，是否有请求超过
            `read_expire`（500ms）。如果有，立即派发——读延迟敏感。
            
- 检查写 FIFO 队列，是否有请求超过
            `write_expire`（5000ms）。如果有，派发写请求。
            
- 如果没有超时请求，看 `writes_starved`
            计数器。如果已经连续服务了 `writes_starved`
            批读请求而没有服务写请求，切换到写队列。
            
- 从排序队列按扇区顺序派发，这样磁头做单向扫描，类似电梯算法（Elevator
            Algorithm）。
            
            

读优先的设计基于一个观察：读操作通常是同步的——应用程序在等读结果返回，而写操作通常是异步的——写入页缓存后应用程序就继续执行了。所以读延迟直接影响应用响应时间，写延迟的容忍度更高。
            

#### 适用场景

            

`mq-deadline` 适合以下场景：
            
            
- HDD 设备：排序派发减少寻道时间，截止时间防止饿死。
            
- 混合读写负载：读优先策略保护交互式应用的响应时间。
            
- 数据库服务器：`read_expire`
            保证读延迟上界。
            
            

对于 NVMe 设备，`mq-deadline`
            的排序逻辑没有意义（NVMe
            没有磁头移动），但截止时间机制仍然有用——可以防止在高写入压力下读延迟飙升。
            

### 5.2 BFQ（Budget Fair
            Queueing）

            

BFQ（预算公平排队）调度器的设计目标是公平带宽分配和低延迟保证，代码位于
            `block/bfq-iosched.c`。它基于 WF²Q+（Worst-case
            Fair Weighted Fair Queueing Plus）算法，为每个进程（或
            cgroup）分配独立的 I/O 队列和预算。
            

#### 核心概念

            

**每进程队列**：BFQ 为每个提交 I/O
            的进程创建一个独立的内部队列（`bfq_queue`）。调度器在这些队列之间轮转服务。
            

**预算（Budget）**：每个进程队列每次被服务时，获得一个预算——以扇区数衡量。进程队列可以持续派发请求，直到预算耗尽或没有更多请求。预算大小根据进程的
            I/O 模式动态调整：顺序 I/O
            获得更大预算（因为顺序访问效率高），随机 I/O
            获得较小预算。
            

**权重（Weight）**：每个进程队列有一个权重值（默认
            100），权重越大，分配的带宽越多。权重可以通过 cgroup 的
            `io.weight` 参数设置。
            

#### 低延迟启发式

            

BFQ
            有一套启发式机制来识别交互式应用（如文件浏览器、桌面应用）并给予低延迟优待：
            
            
- 如果一个进程在短时间内只提交了少量 I/O（“短突发”），BFQ
            判断它可能是交互式应用，给予更高的调度优先级。
            
- 如果一个进程长时间持续提交大量 I/O（“长流”），BFQ
            判断它是后台任务，正常按权重分配。
            
            

这个启发式在桌面场景下效果显著：即使后台在大量拷贝文件，文件管理器打开目录仍然很快。
            

#### 关键参数

            
```
# 查看 BFQ 参数
ls /sys/block/sda/queue/iosched/
# 部分输出：
# back_seek_max        back_seek_penalty
# fifo_expire_async    fifo_expire_sync
# low_latency          max_budget
# slice_idle           slice_idle_us
# strict_guarantees    timeout_sync

# 关键参数含义：

cat /sys/block/sda/queue/iosched/slice_idle
# 8（毫秒）—— 进程队列空闲等待时间
# 当一个进程队列暂时没有请求时，BFQ 等待这么久再切换到下一个队列
# 目的：给顺序 I/O 一个机会继续提交后续请求

cat /sys/block/sda/queue/iosched/low_latency
# 1 —— 是否启用低延迟启发式（0=禁用，1=启用）

cat /sys/block/sda/queue/iosched/strict_guarantees
# 0 —— 是否严格保证权重比例
# 设为 1 时，BFQ 会更严格地按权重分配带宽，但可能降低总吞吐

cat /sys/block/sda/queue/iosched/fifo_expire_sync
# 125（毫秒）—— 同步请求（通常是读）的截止时间

cat /sys/block/sda/queue/iosched/fifo_expire_async
# 250（毫秒）—— 异步请求（通常是写）的截止时间
```

            

#### 适用场景

            

BFQ 适合以下场景：
            
            
- **桌面系统**：低延迟启发式保证交互式应用的响应速度。
            
- **cgroup I/O
            隔离**：多租户环境中按权重分配带宽。
            
- **混合负载**：后台批量 I/O 不影响前台交互式
            I/O。
            
            

BFQ 的代价是 CPU 开销较高——每进程队列的管理和 WF²Q+
            算法的虚拟时间计算都不便宜。在高 IOPS 场景（如 NVMe 随机 4KB
            读写）下，BFQ 自身的 CPU 消耗可能成为瓶颈。
            

### 5.3 kyber

            

kyber 调度器采用延迟目标驱动的设计，代码位于
            `block/kyber-iosched.c`。它不排序请求、不按进程分配队列，而是通过控制并发请求数来达成延迟目标。
            

#### 设计原理

            

kyber 把 I/O
            分成两个优先级域（Domain）：读域和写域。每个域有独立的令牌（Token）池。调度器监控每个域的完成延迟，如果延迟超过目标值，就减少该域的令牌数（降低并发），反之增加令牌数。
            
```
请求到达
  │
  ├─ 是读请求 → 申请读令牌
  │    ├─ 有令牌 → 派发
  │    └─ 无令牌 → 等待
  │
  └─ 是写请求 → 申请写令牌
       ├─ 有令牌 → 派发
       └─ 无令牌 → 等待

令牌数量动态调整：
  if 实际延迟 > 目标延迟:
      减少令牌数 → 降低并发 → 降低延迟
  if 实际延迟 
```
# 查看 kyber 参数
ls /sys/block/nvme0n1/queue/iosched/
# 输出：read_lat_nsec  write_lat_nsec

cat /sys/block/nvme0n1/queue/iosched/read_lat_nsec
# 2000000（纳秒）= 2ms —— 读延迟目标

cat /sys/block/nvme0n1/queue/iosched/write_lat_nsec
# 10000000（纳秒）= 10ms —— 写延迟目标
```

            

参数很简单——只需要告诉调度器你期望的读写延迟目标，调度器自动调节并发来满足目标。
            

#### 适用场景

            

kyber 适合以下场景：
            
            
- **NVMe 设备**：简单轻量，CPU
            开销极低。
            
- **延迟敏感的在线服务**：自动调节并发，防止设备过载导致延迟飙升。
            
- **快速存储设备**：设备本身有内部调度，不需要内核再做排序。
            
            

kyber 不适合
            HDD——它不做排序，无法优化磁头移动；也不提供公平性保证——不区分进程，只看读写两个域。
            

### 5.4 none（noop）

            

`none`
            不是真正的调度器——它只是一个简单的先进先出（FIFO）队列，不排序、不合并、不做任何智能调度。
            
```
请求到达 → 直接进入 FIFO 队列 → 按到达顺序派发给驱动
```

            

`none` 的使用场景：
            
            
- **NVMe
            设备**：设备控制器有自己的高级调度算法，内核再排序是多余的。
            
- **虚拟化环境**：虚拟磁盘背后是宿主机的 I/O
            调度器，客户机不需要再调度。
            
- **极致低延迟**：减少内核路径上的 CPU
            消耗。
            
            

大多数 Linux 发行版对 NVMe 设备默认使用
            `none`，对 HDD 默认使用
            `mq-deadline`。
            
            

## 六、I/O 调度器选择与切换

            

### 6.1 查看当前调度器

            
```
# 查看某个设备的当前调度器
cat /sys/block/sda/queue/scheduler
# 输出示例：[mq-deadline] kyber bfq none
# 方括号中的就是当前生效的调度器

# 查看所有块设备的调度器
for dev in /sys/block/*/queue/scheduler; do
    echo "$(echo $dev | cut -d/ -f4): $(cat $dev)"
done
```

            

### 6.2 运行时切换

            

切换调度器不需要卸载文件系统或重启，直接写入 sysfs
            即可：
            
```
# 切换到 bfq
echo bfq > /sys/block/sda/queue/scheduler

# 切换到 none
echo none > /sys/block/nvme0n1/queue/scheduler

# 切换到 kyber
echo kyber > /sys/block/nvme0n1/queue/scheduler

# 验证
cat /sys/block/sda/queue/scheduler
```

            

注意：切换调度器是立即生效的，但已经在旧调度器队列中的请求会先处理完毕。切换过程中可能有短暂的性能抖动。
            

### 6.3 内核启动参数

            

通过内核命令行参数设置默认调度器：
            
```
# 在 GRUB 配置中添加
GRUB_CMDLINE_LINUX="elevator=mq-deadline"

# 更新 GRUB
update-grub
```

            

从 Linux 5.x 开始，`elevator` 参数只影响 HDD
            等传统设备。NVMe 设备的默认调度器由内核自动选择（通常是
            `none`）。
            

### 6.4 udev 规则自动选择

            

对于不同类型的设备使用不同调度器，udev
            规则是最优雅的方案：
            
```
# /etc/udev/rules.d/60-io-scheduler.rules

# HDD：使用 mq-deadline
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="1", \
    ATTR{queue/scheduler}="mq-deadline"

# SATA/SAS SSD：使用 mq-deadline
ACTION=="add|change", KERNEL=="sd[a-z]", ATTR{queue/rotational}=="0", \
    ATTR{queue/scheduler}="mq-deadline"

# NVMe：使用 none
ACTION=="add|change", KERNEL=="nvme[0-9]*", ATTR{queue/scheduler}="none"
```

            

### 6.5 调度器性能对比

            

以下是不同调度器在典型工作负载下的特征对比。这不是具体的
            IOPS 数字（因为高度依赖硬件和负载），而是定性的对比：
            
            
            
            维度
            none
            mq-deadline
            bfq
            kyber
            
            
            
            
            HDD 顺序吞吐
            差
            好
            好
            差
            
            
            HDD 随机 IOPS
            差
            中
            中
            差
            
            
            NVMe 随机 IOPS
            优
            好
            中
            好
            
            
            NVMe 延迟
            优
            好
            中
            优
            
            
            读写公平性
            无
            中（读优先）
            优
            中
            
            
            进程间公平性
            无
            无
            优
            无
            
            
            CPU 开销
            极低
            低
            高
            低
            
            
            cgroup 支持
            无
            无
            优
            无
            
            
            
            

选择建议的简化决策树：
            
```
设备类型？
├─ HDD → mq-deadline
├─ SATA/SAS SSD
│   ├─ 需要 cgroup 隔离？ → bfq
│   └─ 不需要 → mq-deadline
└─ NVMe
    ├─ 需要延迟控制？ → kyber
    ├─ 需要 cgroup 隔离？ → bfq
    └─ 追求极致性能？ → none
```

            
            

## 七、blktrace 实战

            

### 7.1 blktrace 简介

            

`blktrace`（Block
            Trace）是块设备层的跟踪工具，可以记录每个 I/O
            请求在块设备层中的完整生命周期。它通过内核的 tracepoint
            机制捕获事件，几乎没有性能开销（相比 `strace`
            等工具）。
            

安装：
            
```
# Debian/Ubuntu
apt-get install blktrace

# RHEL/CentOS
yum install blktrace
```

            

### 7.2 基本用法

            

`blktrace` 采集数据，`blkparse`
            解析数据，`btt` 做统计分析。
            
```
# 采集 sda 的跟踪数据，持续 10 秒
blktrace -d /dev/sda -w 10 -o trace

# 解析跟踪数据
blkparse -i trace -o trace.txt

# 查看输出（截取关键行）
head -30 trace.txt
```

            

### 7.3 事件类型

            

`blkparse`
            输出中的每一行代表一个事件。关键事件类型：
            
            
            
            事件代码
            名称
            含义
            
            
            
            
            Q
            Queue
            bio 进入请求队列
            
            
            G
            Get Request
            分配了新的 request 结构体
            
            
            M
            Merge
            bio 被合并到已有的 request
            
            
            I
            Insert
            request 被插入调度器队列
            
            
            D
            Dispatch
            request 被派发给设备驱动
            
            
            C
            Complete
            设备完成了这个请求
            
            
            P
            Plug
            队列被塞住
            
            
            U
            Unplug
            队列被拔塞
            
            
            
            

一个典型的 I/O 请求生命周期在 `blkparse`
            输出中的体现：
            
```
8,0    1        1     0.000000000  1234  Q   W 12345 + 8 [dd]
8,0    1        2     0.000001200  1234  G   W 12345 + 8 [dd]
8,0    1        3     0.000002400  1234  I   W 12345 + 8 [dd]
8,0    1        4     0.000010000  1234  D   W 12345 + 8 [dd]
8,0    1        5     0.001500000     0  C   W 12345 + 8 [0]
```

            

解读：
            
            
- 第 1 行：进程 1234（dd）提交了一个写请求，起始扇区
            12345，长度 8 个扇区（4KB）。
            
- 第 2 行：分配了一个新的
            request（说明没有发生合并）。
            
- 第 3 行：request 被插入调度器队列。
            
- 第 4 行：request 被派发给驱动。
            
- 第 5 行：设备完成了请求。总耗时 = 0.001500 - 0.000000 =
            1.5ms。
            
            

### 7.4 分析合并效率

            

通过 `blkparse` 可以统计合并率：
            
```
# 采集跟踪数据
blktrace -d /dev/sda -w 10 -o merge_test

# 统计各事件类型的数量
blkparse -i merge_test -q -d merge_test.bin
btt -i merge_test.bin -q merge_stats.txt 2>/dev/null

# 手动统计合并率
blkparse -i merge_test -f "%a\n" | sort | uniq -c | sort -rn
# 输出示例：
#  52341 Q     ← 总提交的 bio 数
#  12045 G     ← 分配的新 request 数
#  40296 M     ← 合并的 bio 数
#   8123 D     ← 派发的 request 数

# 合并率 = M / Q = 40296 / 52341 ≈ 77%
# 请求缩减率 = 1 - D/Q = 1 - 8123/52341 ≈ 84%
```

            

77% 的合并率意味着大部分 I/O
            是顺序或准顺序的。如果合并率接近 0%，说明 I/O 完全随机。
            

### 7.5 分析队列深度

            

通过 `btt`
            可以生成队列深度随时间变化的统计：
            
```
# 采集数据
blktrace -d /dev/sda -w 30 -o depth_test

# 生成合并后的二进制文件
blkparse -i depth_test -d depth_test.bin

# 用 btt 分析
btt -i depth_test.bin
# 输出包含：
# Q2Q  —— 两次提交之间的时间间隔
# Q2G  —— 从提交到分配 request 的时间
# G2I  —— 从分配 request 到插入调度器的时间
# I2D  —— 从插入调度器到派发给驱动的时间（调度器排队时间）
# D2C  —— 从派发到完成的时间（设备处理时间）
# Q2C  —— 从提交到完成的总时间（端到端延迟）
```

            

各时间段的含义对诊断问题很有帮助：
            
            
- `Q2G`
            大说明内存分配慢（可能是内存紧张）。
            
- `I2D` 大说明调度器队列长或调度延迟高。
            
- `D2C` 大说明设备本身慢。
            
- `Q2C` 是用户感知到的 I/O 延迟。
            
            

### 7.6
            实战：诊断顺序写性能下降

            

假设你发现顺序写入吞吐量从预期的 200 MB/s 下降到 80
            MB/s，可以这样排查：
            
```
# 1. 开始跟踪
blktrace -d /dev/sda -w 10 -o diag &

# 2. 跑写入测试
dd if=/dev/zero of=/mnt/test bs=1M count=1024 oflag=direct 2>&1

# 3. 停止跟踪
kill %1

# 4. 分析
blkparse -i diag -d diag.bin
btt -i diag.bin

# 重点看：
# - 合并率：如果低于 50%，说明 I/O 被拆得太碎
# - I2D 时间：如果很高，说明调度器有瓶颈
# - D2C 时间：如果很高，说明设备慢（可能是 HDD 碎片、SSD 写放大）
# - max_sectors_kb：如果太小，请求被截断，吞吐下降
```

            
            

## 八、I/O 优先级与 cgroup
            控制

            

### 8.1 ionice：进程级 I/O
            优先级

            

`ionice` 命令设置进程的 I/O
            调度类别和优先级。Linux 的 I/O 优先级分三个类别：
            
            
            
            类别
            编号
            含义
            优先级范围
            
            
            
            
            实时（Realtime）
            1
            最高优先级，总是优先服务
            0-7（0 最高）
            
            
            尽力而为（Best-effort）
            2
            默认类别，按优先级轮转
            0-7（0 最高）
            
            
            空闲（Idle）
            3
            最低优先级，只在无其他 I/O 时服务
            无
            
            
            
            
```
# 查看进程的 I/O 优先级
ionice -p 

# 以空闲优先级运行备份任务
ionice -c 3 rsync -av /data/ /backup/

# 以尽力而为、优先级 7（最低）运行
ionice -c 2 -n 7 tar czf backup.tar.gz /data/

# 以实时优先级运行数据库（谨慎使用）
ionice -c 1 -n 0 mysqld
```

            

注意：I/O 优先级只在使用 BFQ 或
            CFQ（已废弃）调度器时生效。`mq-deadline`、`kyber`
            和 `none` 不感知 I/O 优先级。
            

### 8.2 cgroup v1：blkio
            控制器

            

cgroup v1 的 `blkio` 控制器提供两种 I/O
            限制方式：
            

**权重分配（`blkio.weight`）**：按比例分配
            I/O 带宽，仅在 BFQ 调度器下有效。
            
```
# 设置 cgroup 权重
echo 100 > /sys/fs/cgroup/blkio/group_a/blkio.weight   # 默认权重
echo 500 > /sys/fs/cgroup/blkio/group_b/blkio.weight   # 5 倍带宽

# group_b 大约获得 group_a 5 倍的 I/O 带宽
```

            

**速率限制（`blkio.throttle`）**：硬限制每秒读写字节数或
            IOPS。
            
```
# 限制 sda 的读带宽为 10 MB/s
echo "8:0 10485760" > /sys/fs/cgroup/blkio/db_group/blkio.throttle.read_bps_device

# 限制 sda 的写 IOPS 为 1000
echo "8:0 1000" > /sys/fs/cgroup/blkio/db_group/blkio.throttle.write_iops_device
```

            

设备号 `8:0` 对应
            `/dev/sda`，可以通过 `ls -l /dev/sda`
            或 `cat /proc/partitions` 查看。
            

### 8.3 cgroup v2：io 控制器

            

cgroup v2 统一了权重和限流接口，比 v1 更简洁：
            
```
# 启用 io 控制器
echo "+io" > /sys/fs/cgroup/cgroup.subtree_control

# 设置权重（范围 1-10000，默认 100）
echo "default 200" > /sys/fs/cgroup/mygroup/io.weight

# 设置带宽限制
# 格式：MAJ:MIN rbps= wbps= riops= wiops=
echo "8:0 rbps=10485760 wbps=5242880 riops=max wiops=1000" \
    > /sys/fs/cgroup/mygroup/io.max

# 查看当前 I/O 统计
cat /sys/fs/cgroup/mygroup/io.stat
# 输出示例：
# 8:0 rbytes=1048576 wbytes=524288 rios=256 wios=128 dbytes=0 dios=0
```

            

cgroup v2 的 `io.weight` 同样依赖 BFQ
            调度器。如果使用 `mq-deadline` 或
            `none`，只有
            `io.max`（硬限制）生效。
            

### 8.4
            实战：隔离数据库与批处理任务

            

一个常见场景：同一台服务器上运行 MySQL
            和每日备份任务。没有 I/O
            隔离时，备份的大量顺序读写会严重干扰数据库的随机 I/O。
            

用 cgroup v2 + BFQ 实现隔离：
            
```
# 1. 对 sda 启用 BFQ
echo bfq > /sys/block/sda/queue/scheduler

# 2. 创建 cgroup
mkdir /sys/fs/cgroup/db
mkdir /sys/fs/cgroup/backup

# 3. 设置权重——数据库获得 5 倍于备份的带宽
echo "default 500" > /sys/fs/cgroup/db/io.weight
echo "default 100" > /sys/fs/cgroup/backup/io.weight

# 4. 限制备份的绝对带宽（兜底保护）
echo "8:0 rbps=52428800 wbps=52428800" > /sys/fs/cgroup/backup/io.max
# 读写各限制 50 MB/s

# 5. 把进程加入 cgroup
echo  > /sys/fs/cgroup/db/cgroup.procs
echo  > /sys/fs/cgroup/backup/cgroup.procs

# 6. 验证
cat /sys/fs/cgroup/db/io.stat
cat /sys/fs/cgroup/backup/io.stat
```

            

权重 + 硬限制的组合提供了双重保护：正常情况下按 5:1
            分配带宽，即使备份突发也不会超过 50 MB/s。
            
            

## 九、块设备层调优

            

### 9.1 队列深度：nr_requests

            

`nr_requests`
            控制每个硬件队列能同时处理的最大请求数：
            
```
# 查看当前值
cat /sys/block/sda/queue/nr_requests
# 默认值通常是 64（HDD）或 1023（NVMe）

# 调整
echo 128 > /sys/block/sda/queue/nr_requests
```

            

调优原则：
            
            
- **增大
            `nr_requests`**：允许更多请求排队，提高设备利用率和吞吐量，但增加延迟。适合吞吐优先的批处理场景。
            
- **减小
            `nr_requests`**：限制队列深度，降低排队延迟，但可能降低吞吐。适合延迟敏感的在线服务。
            
            

一个经验判断：对于数据库服务器，NVMe 设备的
            `nr_requests` 设为 64~256
            通常是合理的范围——比默认值小，换取更稳定的延迟。
            

### 9.2 预读：read_ahead_kb

            

预读（Read-Ahead）是内核在检测到顺序读模式时，提前读取后续数据到页缓存：
            
```
# 查看当前预读大小
cat /sys/block/sda/queue/read_ahead_kb
# 默认 128KB

# 增大预读（适合大文件顺序读）
echo 2048 > /sys/block/sda/queue/read_ahead_kb

# 减小预读（适合随机读为主的工作负载）
echo 32 > /sys/block/sda/queue/read_ahead_kb
```

            

预读的效果取决于工作负载：
            
            
            
            
            
            
            
            
            工作负载
            推荐预读
            原因
            
            
            
            
            大文件顺序读（视频、备份）
            1024~4096 KB
            预读命中率高，减少 I/O 次数
            
            
            数据库（随机读为主）
            64~128 KB
            预读浪费带宽，污染页缓存
            
            
            小文件大量读取
            32~64 KB
            文件小于预读窗口时预读无意义
            
            
            
            

### 9.3
            最大请求大小：max_sectors_kb

            

`max_sectors_kb`
            限制单个请求能包含的最大数据量：
            
```
# 查看当前值和硬件上限
cat /sys/block/sda/queue/max_sectors_kb
cat /sys/block/sda/queue/max_hw_sectors_kb

# 调整（不能超过 max_hw_sectors_kb）
echo 1280 > /sys/block/sda/queue/max_sectors_kb
```

            

增大 `max_sectors_kb`
            允许更大的请求，减少请求数量，对顺序 I/O
            有利。但过大的请求可能增加单次 I/O
            的延迟，影响其他等待中的请求。
            

### 9.4 rotational 标志

            

`rotational`
            标志告诉内核这个设备是否有旋转介质：
            
```
cat /sys/block/sda/queue/rotational
# 1 = HDD（旋转设备）
# 0 = SSD/NVMe（非旋转设备）
```

            

这个标志影响：
            
            
- I/O 调度器的默认选择。
            
- 文件系统的分配策略（如 ext4
            对旋转设备倾向于分配连续块）。
            
- `fstrim` 和 TRIM 操作的自动触发。
            
            

某些 SSD 可能被错误识别为旋转设备（特别是通过 USB 或 RAID
            卡连接时）。手动修正：
            
```
echo 0 > /sys/block/sda/queue/rotational
```

            

### 9.5
            不同设备类型的推荐配置

            

以下是面向不同设备类型的块设备层参数推荐。这些数值来自工程经验和社区实践，不是绝对最优值——实际调优应以实测为准。
            

**HDD（7200 RPM 企业级）**：
            
```
echo mq-deadline > /sys/block/sda/queue/scheduler
echo 128 > /sys/block/sda/queue/nr_requests
echo 256 > /sys/block/sda/queue/read_ahead_kb
echo 1280 > /sys/block/sda/queue/max_sectors_kb
echo 1 > /sys/block/sda/queue/rotational
echo 0 > /sys/block/sda/queue/nomerges
```

            

**SATA SSD**：
            
```
echo mq-deadline > /sys/block/sda/queue/scheduler
echo 64 > /sys/block/sda/queue/nr_requests
echo 128 > /sys/block/sda/queue/read_ahead_kb
echo 512 > /sys/block/sda/queue/max_sectors_kb
echo 0 > /sys/block/sda/queue/rotational
echo 0 > /sys/block/sda/queue/nomerges
```

            

**NVMe SSD（通用服务器）**：
            
```
echo none > /sys/block/nvme0n1/queue/scheduler
echo 256 > /sys/block/nvme0n1/queue/nr_requests
echo 128 > /sys/block/nvme0n1/queue/read_ahead_kb
echo 0 > /sys/block/nvme0n1/queue/rotational
echo 2 > /sys/block/nvme0n1/queue/nomerges
```

            

**NVMe SSD（延迟敏感型，如数据库）**：
            
```
echo kyber > /sys/block/nvme0n1/queue/scheduler
echo 128 > /sys/block/nvme0n1/queue/nr_requests
echo 64 > /sys/block/nvme0n1/queue/read_ahead_kb
echo 0 > /sys/block/nvme0n1/queue/rotational
# 设置延迟目标
echo 2000000 > /sys/block/nvme0n1/queue/iosched/read_lat_nsec   # 2ms
echo 10000000 > /sys/block/nvme0n1/queue/iosched/write_lat_nsec  # 10ms
```

            

### 9.6 诊断高 await 问题

            

`iostat` 中的 `await`（平均 I/O
            等待时间）升高是最常见的存储性能问题。诊断步骤：
            
```
# 1. 确认问题
iostat -xz 1
# 关注 await、r_await、w_await 列
# 正常值：HDD 
            
            

## 参考文献

            

### 内核源码

            
            
- Linux
            6.1，`block/blk-core.c`——块设备层核心代码，包含
            `submit_bio()` 入口。
            
- Linux 6.1，`block/blk-mq.c`——blk-mq
            多队列架构实现。
            
- Linux 6.1，`block/mq-deadline.c`——mq-deadline
            调度器实现。
            
- Linux 6.1，`block/bfq-iosched.c`——BFQ
            调度器实现。
            
- Linux 6.1，`block/kyber-iosched.c`——kyber
            调度器实现。
            
- Linux 6.1，`include/linux/bio.h`——bio
            结构体定义。
            
- Linux 6.1，`include/linux/blk-mq.h`——blk-mq
            数据结构定义。
            
            

### 内核文档

            
            
- `Documentation/block/blk-mq.rst`——blk-mq
            架构设计文档。
            
- `Documentation/block/bfq-iosched.rst`——BFQ
            调度器官方文档。
            
- `Documentation/block/kyber-iosched.rst`——kyber
            调度器文档。
            
- `Documentation/block/deadline-iosched.rst`——deadline
            调度器文档。
            
- `Documentation/admin-guide/cgroup-v2.rst`——cgroup
            v2 io 控制器文档。
            
            

### 论文与演讲

            
            
- Axboe, Jens. “Linux Block IO: Present and Future.”
            Ottawa Linux Symposium, 2004.
            
- Axboe, Jens. “blk-mq: new multi-queue block IO queueing
            mechanism.” Linux Plumbers Conference, 2013.
            
- Valente, Paolo. “BFQ, Budget Fair Queueing.” Linux
            Plumbers Conference, 2017.
            
- Bjørling, Matias et al. “Linux Block IO: Introducing
            Multi-Queue SSD Access on Multi-Core Systems.” SYSTOR,
            2013.
            
            

### 工具文档

            
            
- `blktrace(8)` 手册页——blktrace
            使用说明。
            
- `blkparse(1)` 手册页——blkparse
            输出格式说明。
            
- `btt(1)` 手册页——btt 统计分析工具。
            
- `ionice(1)` 手册页——I/O 优先级设置。
            
            
            

**上一篇**: Linux I/O
            栈全景：从 write() 到磁盘扇区 **下一篇**:
            [Page Cache
            深度解析](../09-page-cache/page-cache.html)
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-16 · storage
                    

### 【存储工程】Linux I/O 栈全景：从 write() 到磁盘扇区

                    

当应用程序调用一次 write() 系统调用（System Call）时，数据并不会立刻落到磁盘扇区上。 它需要穿越内核中七个以上的软件层次，每一层都有独立的职责、数据结构和延迟开销。 理解这条完整路径，是进行存储性能调优和故障诊断的基础。
                

                
                    

2025-07-15 · algorithms
                    

### I/O 调度：CFQ → mq-deadline → BFQ → kyber

                    

你把数据库从 HDD 迁移到了 NVMe SSD，IOPS 涨了 100 倍——然后你发现 I/O 调度器还在用 CFQ，它正在用复杂的算法把你的 NVMe 搞慢。NVMe 时代，最好的调度器可能是'不调度'。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。