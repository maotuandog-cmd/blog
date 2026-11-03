# 【存储工程】Buffer Pool：数据库的内存管理

来源: https://quant67.com/post/storage/26-buffer-pool/buffer-pool.html
日期: 2025-09-04 |

---

# Buffer
            Pool：数据库的内存管理

            

数据库存储引擎的核心工作，是把磁盘上的页读进内存、在内存里修改、再写回磁盘。操作系统本身已经提供了页缓存（Page
            Cache）来做这件事，但几乎所有严肃的数据库系统——MySQL、PostgreSQL、Oracle、SQL
            Server——都选择绕过操作系统的页缓存，自己在用户态维护一块叫做缓冲池（Buffer
            Pool）的内存区域。
            

这不是重复造轮子。数据库对内存管理有一组操作系统无法满足的需求：精确的淘汰控制、脏页刷新顺序的保证、预读策略与查询计划的联动、以及页面的固定与释放语义。任何一项做不好，轻则性能下降，重则数据损坏。
            

本文从”为什么不用 Page Cache”这个问题出发，逐步拆解
            Buffer Pool
            的架构设计、页面替换算法、脏页管理、预读机制，再分别剖析
            MySQL InnoDB 和 PostgreSQL
            的具体实现，最后落到调优方法和监控诊断。
            
            

## 一、为什么数据库不用
            Page Cache

            

操作系统的页缓存是一个通用的文件数据缓存层，对所有应用透明。数据库不用它，不是因为它”不好”，而是因为通用方案在数据库这个特定场景下会引发几个严重问题。
            

### Double Buffering 问题

            

如果数据库通过标准的
            `read()`/`write()`
            系统调用访问数据文件，数据会在两个地方各存一份：操作系统的页缓存里一份，数据库自己的
            Buffer Pool 里一份。这就是双重缓冲（Double
            Buffering）问题。
            
```
应用层:    Buffer Pool    [Page A] [Page B] [Page C]
                              |        |        |
                          read()/write()
                              |        |        |
内核层:    Page Cache      [Page A] [Page B] [Page C]
                              |        |        |
                          块设备 I/O
                              |        |        |
存储层:    磁盘            [Page A] [Page B] [Page C]
```

            

同一份数据在内存中占了两倍空间。对于一个配置了 128GB
            Buffer Pool 的数据库实例，Page Cache 可能额外占用接近 128GB
            的内存，导致可用内存被大量浪费。这就是为什么数据库通常使用直接
            I/O（Direct I/O），通过 `O_DIRECT`
            标志绕过页缓存，让数据只在 Buffer Pool 里存一份。
            

### 淘汰控制的缺失

            

操作系统的页缓存使用一套全局的内存回收策略，由内核的
            `kswapd` 线程和直接回收（Direct
            Reclaim）路径控制。数据库对此没有任何发言权：
            
            
- 内核不知道哪些页是”热”数据，哪些是全表扫描带进来的一次性数据；
            
- 内核可能在内存压力下把数据库的关键索引页淘汰掉，去保留某个日志文件的缓存；
            
- 内核的 LRU 实现（实际上是双链表 active/inactive
            list）对数据库的访问模式并不友好。
            
            

数据库需要自己决定”淘汰哪一页”，而不是把这个决定交给一个对查询计划一无所知的内核。
            

### 预读控制的缺失

            

内核的预读（Readahead）算法针对顺序读做了优化，会在检测到顺序模式时自动扩大预读窗口。但数据库的读取模式远比”顺序”或”随机”复杂：
            
            
- 索引扫描时，叶子节点在物理上可能不连续，但逻辑上是顺序的；
            
- 范围查询可以提前知道需要读哪些页，但内核无法从
            `read()` 调用中推断出这一点；
            
- 全表扫描时需要大量预读，但又不能把 Buffer Pool
            里的热数据挤掉。
            
            

数据库需要根据查询计划主动发起预读，而不是被动依赖内核的启发式算法。
            

### Pin/Unpin 语义

            

数据库在修改一个页的时候，必须保证这个页不会被淘汰出内存——因为页上可能有未提交的事务数据，或者有正在进行的
            B-Tree 分裂操作。这就是固定（Pin）语义：一个页被 pin
            住之后，不管内存多紧张，都不能被淘汰。
            

操作系统的页缓存没有提供这种语义。`mlock()`
            可以锁定内存页，但它的粒度是进程级别的，无法精确控制到单个数据库页面。而且
            `mlock()`
            的使用有权限限制和数量限制，不适合数据库这种需要频繁
            pin/unpin 大量页面的场景。
            

### 脏页刷新顺序的保证

            

这可能是最关键的原因。数据库需要保证脏页（Dirty
            Page）的刷新顺序满足预写日志（Write-Ahead
            Logging，WAL）的约束：在刷出一个脏数据页之前，该页对应的所有
            WAL 记录必须先持久化到日志文件中。操作系统的页缓存不了解 WAL
            协议，它可能在任何时候、以任何顺序把脏页刷回磁盘，这会破坏数据库的崩溃恢复保证。
            

这五个原因加在一起，就解释了为什么数据库要自己管理内存。接下来看
            Buffer Pool 的具体架构。
            
            

## 二、Buffer Pool 架构

            

Buffer Pool
            的核心职责是：管理一块固定大小的内存区域，把磁盘上的数据页按需加载进来，提供给上层的查询引擎和事务管理器使用，并在内存不够时选择合适的页淘汰出去。
            

### 整体结构

            

一个典型的 Buffer Pool 由以下几个组件构成：
            
```
┌──────────────────────────────────────────────────┐
│                   Buffer Pool                     │
│                                                   │
│  ┌────────────┐    ┌──────────────────────────┐  │
│  │ Page Table  │    │      Frame Array          │  │
│  │ (Hash Map)  │    │                           │  │
│  │             │    │  Frame 0: [Page 数据 16KB] │  │
│  │ (5,3) -> 0  │    │  Frame 1: [Page 数据 16KB] │  │
│  │ (5,7) -> 1  │    │  Frame 2: [Page 数据 16KB] │  │
│  │ (8,1) -> 2  │    │  Frame 3: [空闲]          │  │
│  │ ...         │    │  ...                       │  │
│  └────────────┘    └──────────────────────────┘  │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │          Page Descriptors                  │    │
│  │  Frame 0: page_id=(5,3) pin=2 dirty=true  │    │
│  │  Frame 1: page_id=(5,7) pin=0 dirty=false │    │
│  │  Frame 2: page_id=(8,1) pin=1 dirty=true  │    │
│  │  Frame 3: page_id=null  pin=0 dirty=false │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  ┌──────────────┐  ┌──────────────┐              │
│  │  Free List    │  │ Replacer     │              │
│  │  [3, 4, 5...] │  │ (LRU/Clock)  │              │
│  └──────────────┘  └──────────────┘              │
└──────────────────────────────────────────────────┘
```

            

### 页表（Page Table）

            

页表是一个哈希表（Hash Table），负责从逻辑页标识（Page
            ID）映射到物理帧编号（Frame
            ID）。页标识通常由表空间编号（Tablespace ID）和页号（Page
            Number）组成，例如 `(5, 3)` 表示表空间 5 中的第 3
            页。
            

当上层请求一个页时，Buffer Pool
            先查页表：如果命中，直接返回对应帧中的数据；如果未命中，就需要从磁盘读取，并在帧数组中找到一个空闲帧（或淘汰一个旧页）来存放新数据。
            

页表的实现通常使用带桶锁（Bucket
            Lock）的哈希表，以支持高并发访问。每个桶有自己的锁，不同桶的操作可以并行进行。
            

### 帧数组（Frame Array）

            

帧数组是 Buffer Pool
            实际存储数据的内存区域。它被划分为固定大小的槽位，每个槽位叫一个帧（Frame），大小等于一个数据库页的大小。例如，InnoDB
            默认页大小为 16KB，如果 Buffer Pool 大小为
            16GB，那么帧数组包含 `16GB / 16KB = 1,048,576`
            个帧。
            

帧数组在数据库启动时一次性分配，运行期间不再扩缩。这避免了动态内存分配带来的碎片和延迟问题。
            

### 页描述符（Page
            Descriptor）

            

每个帧都有一个对应的页描述符，记录该帧的元数据：
            
```
struct BufferPageDescriptor {
    page_id_t   page_id;      // 当前帧中存放的页标识
    uint32_t    pin_count;    // 引用计数，>0 时不可淘汰
    bool        is_dirty;     // 是否被修改过
    lsn_t       page_lsn;    // 页面最后修改的 LSN
    lsn_t       oldest_lsn;  // 页面第一次变脏时的 LSN
    // ... 锁、统计信息等
};
```

            

几个关键字段的含义：
            

**引用计数（Pin
            Count）**：当一个线程正在访问某个页时，它会对该页执行
            pin 操作，将 `pin_count` 加 1；访问结束后执行
            unpin 操作，将 `pin_count` 减 1。只有
            `pin_count` 为 0 的页才能被淘汰。如果一个线程 pin
            了一个页后忘记 unpin，这个页就会永远留在 Buffer Pool
            中，逐渐导致可用帧耗尽——这是一个常见的 Buffer Pool
            泄漏（Buffer Pool Leak）问题。
            

**脏标志（Dirty
            Flag）**：当页面被修改后，`is_dirty`
            被设为
            true。脏页在被淘汰前必须先刷回磁盘，否则修改就会丢失。刷盘完成后，`is_dirty`
            重置为 false。
            

**日志序列号（Log Sequence
            Number，LSN）**：`page_lsn`
            记录了该页最后一次被修改时对应的 WAL
            日志位置。这个值在崩溃恢复时至关重要：恢复进程通过比较页面
            LSN 和日志
            LSN，判断哪些修改需要重做（Redo），哪些需要撤销（Undo）。
            

### 空闲列表（Free List）

            

空闲列表维护所有未被使用的帧编号。当需要加载一个新页时，Buffer
            Pool
            先从空闲列表中取帧；如果空闲列表为空，就需要通过页面替换器淘汰一个旧页来腾出空间。
            

### 页面获取流程

            

当上层请求一个页时，Buffer Pool 的处理流程如下：
            
```
FetchPage(page_id):
  1. 在页表中查找 page_id
  2. 如果命中（Cache Hit）:
     a. 找到对应的 frame_id
     b. pin_count++
     c. 更新替换器的访问记录
     d. 返回帧的指针
  3. 如果未命中（Cache Miss）:
     a. 从空闲列表取一个 frame_id
     b. 如果空闲列表为空:
        i.  调用替换器选择一个 victim frame
        ii. 如果 victim 是脏页，先刷盘
        iii. 从页表中删除 victim 的映射
     c. 从磁盘读取 page_id 的数据到 frame
     d. 在页表中插入 (page_id -> frame_id)
     e. 初始化描述符: pin_count=1, dirty=false
     f. 返回帧的指针
```

            

这个流程中，步骤 3.b 是性能关键路径。如果频繁发生 Cache
            Miss 且需要淘汰脏页，每次 Miss
            都会触发一次磁盘写（刷脏页）和一次磁盘读（加载新页），延迟会非常高。这就是为什么
            Buffer Pool 的大小和替换策略对数据库性能至关重要。
            
            

## 三、页面替换策略

            

当 Buffer Pool
            满了、又需要加载新页时，必须选择一个现有页淘汰出去。选择哪个页淘汰，就是页面替换（Page
            Replacement）策略要解决的问题。理想情况下，应该淘汰”未来最长时间不会被访问的页”——这是
            Belady
            的最优替换算法（OPT），但它需要预知未来，无法实现。所有实际算法都是在近似
            OPT。
            

### LRU（Least Recently
            Used）

            

最近最少使用（LRU）是最直观的替换策略：淘汰最近最长时间没有被访问的页。
            

实现方式是维护一个双向链表。每次访问一个页，就把它移到链表头部；需要淘汰时，从链表尾部取页。这样链表尾部始终是”最久没被访问”的页。
            
```
class LRUReplacer:
    def __init__(self, capacity):
        self.capacity = capacity
        self.cache = OrderedDict()  # frame_id -> 访问时间

    def access(self, frame_id):
        """记录一次访问"""
        if frame_id in self.cache:
            self.cache.move_to_end(frame_id)
        else:
            self.cache[frame_id] = True

    def evict(self):
        """淘汰最久未访问的帧"""
        if not self.cache:
            return None
        frame_id, _ = self.cache.popitem(last=False)
        return frame_id
```

            

LRU 的优点是简单、对时间局部性（Temporal
            Locality）好的工作负载效果不错。但它有一个严重的缺陷：**对扫描操作（Sequential
            Scan）极度脆弱**。
            

考虑这样一个场景：Buffer Pool 有 1000 个帧，其中 900
            个存放着频繁访问的热数据。现在执行一次全表扫描，依次读取
            5000 个页。扫描过程中，每个新页都会被放到 LRU
            链表头部，把热数据逐渐挤到尾部并淘汰出去。扫描结束后，Buffer
            Pool
            里装的全是刚扫描过、但以后不会再访问的数据，而原来的热数据全被淘汰了。这就是
            LRU 污染（LRU Pollution）问题。
            

### Clock 算法

            

时钟（Clock）算法是 LRU
            的一种近似实现，也叫二次机会（Second
            Chance）算法。它用一个环形缓冲区和一个时钟指针代替 LRU
            的双向链表，降低了实现的复杂度和每次访问的开销。
            

每个帧有一个引用位（Reference
            Bit）。当页被访问时，引用位设为
            1。淘汰时，时钟指针顺时针扫描：
            
            
- 如果当前帧的引用位为 1，把它清为
            0（给一次”第二次机会”），指针前进；
            
- 如果引用位为 0，选择这个帧作为淘汰对象。
            
            
```
class ClockReplacer:
    def __init__(self, capacity):
        self.capacity = capacity
        self.frames = [False] * capacity  # 引用位
        self.in_pool = [False] * capacity # 是否可被淘汰
        self.hand = 0                     # 时钟指针

    def access(self, frame_id):
        """记录访问，设置引用位"""
        self.frames[frame_id] = True
        self.in_pool[frame_id] = True

    def evict(self):
        """时钟扫描，找到淘汰对象"""
        scanned = 0
        while scanned 
            

Clock 算法的优势在于每次访问只需要设置一个位，不需要像
            LRU 那样移动链表节点。在高并发场景下，LRU
            链表的头部会成为热点，而 Clock
            的引用位设置可以无锁完成。PostgreSQL 的 Shared Buffers
            就使用 Clock-Sweep 算法。
            

但 Clock 算法同样无法解决扫描污染问题。
            

### LRU-K

            

LRU-K
            算法的核心思想是：不只看一个页”最近一次”的访问时间，而是看它”最近第
            K 次”的访问时间。只有被访问至少 K
            次的页才有资格进入主缓冲区；访问不足 K
            次的页，即使刚刚被访问过，也优先被淘汰。
            

实际应用中最常用的是
            LRU-2（K=2）。每个页维护两个时间戳：最近一次访问时间和倒数第二次访问时间。淘汰时，比较所有页的”倒数第二次访问时间”，选择最小的那个。
            

LRU-K
            的核心优势在于它能区分”偶尔访问一次”和”反复访问”的页面。全表扫描带进来的页只会被访问一次，倒数第二次访问时间为负无穷（或不存在），所以会被优先淘汰，不会污染热数据。
            

这个算法由 O’Neil、O’Neil 和 Weikum 在 1993 年的论文”The
            LRU-K Page Replacement Algorithm for Database Disk
            Buffering”中提出。
            

### 2Q（Two Queue）

            

2Q 算法由 Johnson 和 Shasha 在 1994 年提出，是 LRU-2
            的一种简化实现。它用两个队列代替了 LRU-K
            的精确时间戳维护：
            
            
- **A1 队列（FIFO）**：新加载的页先进入 A1
            队列。A1 队列按先进先出（First In, First
            Out）顺序淘汰；
            
- **Am 队列（LRU）**：如果一个页在 A1
            队列中被再次访问，就将它提升到 Am 队列。Am 队列按 LRU
            策略管理。
            
            

淘汰策略：优先从 A1 队列尾部淘汰；如果 A1 为空，再从 Am
            队列尾部淘汰。
            
```
新页 ──→ [ A1 队列 (FIFO) ] ──→ 淘汰
              │ 再次命中
              ▼
         [ Am 队列 (LRU) ] ──→ 淘汰
```

            

2Q
            的优点是实现简单，且能有效抵抗扫描污染：全表扫描带进来的页只会在
            A1 队列中待一会儿就被淘汰，不会影响 Am
            队列中的热数据。InnoDB 的 Buffer Pool 就采用了类似 2Q
            的思想，将 LRU 链表分成 young 和 old 两个子链表。
            

### ARC（Adaptive
            Replacement Cache）

            

自适应替换缓存（Adaptive Replacement Cache）由 IBM 的
            Megiddo 和 Modha 在 2003 年提出。ARC
            的核心创新是：它不仅维护缓存中的页列表，还维护”最近被淘汰的页”的幽灵列表（Ghost
            List），并根据幽灵列表的命中情况动态调整策略。
            

ARC 维护四个列表：
            
            
- **T1**：只被访问过一次的页（类似 2Q 的
            A1）；
            
- **T2**：被访问过多次的页（类似 2Q 的
            Am）；
            
- **B1**：最近从 T1
            中淘汰的页的标识（幽灵列表，不存数据）；
            
- **B2**：最近从 T2
            中淘汰的页的标识（幽灵列表，不存数据）。
            
            

关键机制在于自适应参数 `p`，它控制 T1 和 T2
            的大小分配：
            
            
- 如果新请求的页在 B1
            中命中（说明刚刚被淘汰的”一次性”页其实还会再用），就增大
            `p`，给 T1 分配更多空间；
            
- 如果新请求的页在 B2
            中命中（说明刚刚被淘汰的”热”页其实还会再用），就减小
            `p`，给 T2 分配更多空间。
            
            

ARC
            的优势在于它能自动适应工作负载的变化，不需要手动调参。在混合负载（OLTP
            + 分析查询）的场景下，ARC 通常比静态的 LRU 或 2Q
            表现更好。ZFS 文件系统使用的就是 ARC 的一个变体。
            

但 ARC 有专利限制（IBM 持有专利至 2014
            年），这限制了它在开源数据库中的使用。
            

### 替换策略对比

            
            
            
            维度
            LRU
            Clock
            LRU-K
            2Q
            ARC
            
            
            
            
            实现复杂度
            低
            低
            中
            中
            高
            
            
            每次访问开销
            链表移动
            设位
            更新时间戳
            链表移动
            链表移动
            
            
            并发友好度
            差（链表热点）
            好（无锁设位）
            中
            中
            中
            
            
            抗扫描污染
            差
            差
            好
            好
            好
            
            
            自适应能力
            无
            无
            弱
            无
            强
            
            
            空间开销
            O(n)
            O(n)
            O(n)
            O(n)
            O(2n)（幽灵列表）
            
            
            实际采用
            早期系统
            PostgreSQL
            理论研究
            InnoDB（变体）
            ZFS
            
            
            
            

我认为在数据库场景下，纯 LRU
            已经不再是一个合理的选择。任何生产级数据库都需要至少具备抗扫描污染的能力，2Q
            或 Clock-Sweep 加分区是目前的工程主流。ARC
            在理论上更优，但实现复杂度和历史专利问题使它在开源数据库中没有被广泛采用。
            
            

## 四、脏页管理与刷新策略

            

Buffer Pool 中的页面被修改后就变成了脏页。脏页管理是
            Buffer Pool
            最复杂的部分之一，因为它直接关系到数据的持久性保证和系统的
            I/O 性能。
            

### 脏页追踪

            

每个页描述符中有一个 `is_dirty`
            标志，标记该页是否被修改过。但光有这个标志是不够的，数据库还需要追踪脏页的修改顺序，以支持高效的检查点（Checkpoint）操作。
            

常见的脏页追踪方式：
            

**脏页链表（Flush List）**：InnoDB
            维护一个按 `oldest_modification_lsn`
            排序的脏页链表。`oldest_modification_lsn`
            是该页第一次变脏时的
            LSN。检查点推进时，从链表尾部（最老的脏页）开始刷盘。
            

**脏页位图（Dirty
            Bitmap）**：某些系统使用位图来追踪哪些帧是脏的。位图紧凑，扫描速度快，但无法提供顺序信息。
            

### WAL 约束

            

预写日志（WAL）协议规定了一条硬约束：
            

**在将一个脏数据页刷回磁盘之前，该页上所有修改对应的
            WAL 记录必须先被刷到日志文件中。**
            

用公式表示：
            
```
刷出数据页 P 的前提条件：
  flushed_lsn >= page_lsn(P)
```

            

其中 `flushed_lsn` 是 WAL
            日志已经持久化到磁盘的最大 LSN，`page_lsn(P)`
            是页面 P 上最后一次修改对应的 LSN。
            

如果违反这个约束——数据页先刷了，日志还没刷——那么在数据页刷盘后、日志刷盘前如果发生崩溃，恢复进程就无法知道这个页上做了什么修改，数据就会处于不一致状态。
            

这个约束要求 Buffer Pool 的脏页刷新逻辑和 WAL
            子系统紧密配合。每次刷脏页之前，都要检查该页的
            `page_lsn` 是否已经被 WAL 覆盖。
            

### 检查点（Checkpoint）

            

检查点是数据库定期执行的一个操作，目的是：
            
            
- 将所有（或部分）脏页刷回磁盘；
            
- 推进 WAL
            日志的可回收点——检查点之前的日志可以被回收，因为对应的数据页已经持久化了。
            
            

检查点的实现方式主要有两种：
            

**Sharp
            Checkpoint**：在检查点时刻，停止所有写操作，把所有脏页全部刷盘。这种方式实现简单，但会造成写停顿（Write
            Stall），在生产环境中不可接受。MySQL 在关闭时使用 Sharp
            Checkpoint。
            

**Fuzzy
            Checkpoint**：不停止写操作，而是记录检查点开始时的
            LSN，然后在后台逐步刷出脏页。在恢复时，需要从检查点 LSN
            开始重放日志。InnoDB 在正常运行时使用 Fuzzy Checkpoint。
            
```
WAL 日志流:
  ... [LSN 100] [LSN 101] ... [LSN 500] [LSN 501] ...
                  ↑                        ↑
         checkpoint_lsn=100         current_lsn=501

  Buffer Pool 中脏页的 oldest_modification_lsn:
  Page A: 100  ← 最老的脏页
  Page B: 200
  Page C: 350
  Page D: 500

  检查点推进: 把 oldest_modification_lsn 
```
-- InnoDB 邻居刷新设置
-- 0: 关闭邻居刷新（推荐 SSD）
-- 1: 刷新同一个 extent 内的连续脏页（默认值，适合 HDD）
-- 2: 刷新同一个 extent 内的所有脏页
SET GLOBAL innodb_flush_neighbors = 0;
```

            

**异步 I/O（Asynchronous I/O）**：使用 Linux
            的 AIO
            接口（`io_submit`/`io_getevents`
            或较新的
            `io_uring`）提交脏页刷新请求，避免线程阻塞在 I/O
            等待上。InnoDB 支持通过 `innodb_use_native_aio`
            启用原生异步 I/O。
            
            

## 五、预读（Prefetching）

            

预读的目标是在数据被实际需要之前就把它加载到 Buffer Pool
            中，避免查询在等待磁盘 I/O 时阻塞。好的预读策略可以让磁盘
            I/O 和 CPU 计算重叠执行，显著提升吞吐量。但错误的预读会浪费
            I/O 带宽，还会把热数据从 Buffer Pool 中挤掉。
            

### 线性预读（Sequential
            Prefetch）

            

线性预读是最基本的预读方式：当检测到对某个区域（Extent）内的页面存在顺序访问模式时，自动将后续的页面提前读入
            Buffer Pool。
            

InnoDB 的线性预读由参数
            `innodb_read_ahead_threshold` 控制。当一个
            extent（默认 64 个连续页，共
            1MB）中有超过阈值数量的页被顺序访问时，InnoDB
            会异步预读下一个 extent 的所有页面。
            
```
-- 当一个 extent 中有 56 个页被顺序访问时，触发线性预读
SET GLOBAL innodb_read_ahead_threshold = 56;
```

            

阈值设得太低，会导致过度预读；设得太高，预读触发太迟，效果不明显。默认值
            56 在大多数场景下是合理的。
            

线性预读适用于全表扫描、顺序索引扫描等顺序访问模式。对于随机访问，线性预读不会触发，也不应该触发。
            

### 随机预读（Random
            Prefetch）

            

InnoDB 曾经支持随机预读：当一个 extent
            中有一定数量的页被访问（不要求顺序）时，把整个 extent
            的剩余页面都读进来。但这个特性在实践中被证明弊大于利，因为在
            OLTP 工作负载下，同一个 extent
            中的多个页被访问可能只是巧合，并不意味着整个 extent
            都是热数据。
            

MySQL 5.5
            以后默认关闭了随机预读（`innodb_random_read_ahead = OFF`），建议保持关闭。
            

### 索引预读

            

当执行索引范围扫描时，查询引擎可以根据索引的叶子节点中记录的数据页指针，提前知道接下来需要读哪些数据页。这些数据页在磁盘上可能不连续，但它们的列表是已知的。
            
```
索引叶子节点扫描:
  Leaf 1 → 数据页 [100, 105, 108]
  Leaf 2 → 数据页 [200, 203, 207]
  Leaf 3 → 数据页 [300, 301, 305]

索引预读: 在处理 Leaf 1 的数据页时，异步提交 Leaf 2 的数据页读取请求
```

            

这种预读方式比线性预读更精确，因为它知道确切要读哪些页，不会浪费
            I/O 在不需要的页上。
            

### 查询驱动预读（Query-Driven
            Prefetch）

            

更高级的预读方式是让查询优化器参与预读决策。查询优化器知道查询计划的完整结构：它知道接下来要做哪些表的扫描、需要访问哪些索引、估计要读多少数据。这些信息可以用来驱动精确的预读。
            

例如，一个嵌套循环连接（Nested Loop Join）查询：
            
```
SELECT o.order_id, c.name
FROM orders o JOIN customers c ON o.customer_id = c.id
WHERE o.order_date > '2025-01-01';
```

            

查询优化器知道外层循环会扫描 `orders`
            表的某个范围，内层循环会逐个查找 `customers`
            表的主键。在处理当前批次的 `orders`
            行时，可以提前把下一批次对应的 `customers`
            页面预读进来。
            

这种预读在学术文献中有充分的讨论，但在实际数据库产品中的实现程度参差不齐。一些数据库通过
            Batch Key
            Access（BKA）连接方式间接实现了这种效果：先收集一批连接键，排序后批量查找，使得内层表的访问从随机变成接近顺序。
            

### 预读的风险

            

预读不是越多越好。过度预读会带来几个问题：
            
            
- **I/O
            带宽浪费**：预读进来的页如果不会被实际使用，I/O
            带宽就白白浪费了；
            
- **Buffer Pool
            污染**：预读的页会占用帧，可能把真正的热数据挤掉；
            
- **CPU 开销**：管理预读请求和处理 I/O
            完成事件本身也有 CPU 开销。
            
            

InnoDB 提供了两个状态变量来监控预读的效果：
            
```
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_ahead%';
```

            
```
+---------------------------------------+--------+
| Variable_name                         | Value  |
+---------------------------------------+--------+
| Innodb_buffer_pool_read_ahead         | 153280 |
| Innodb_buffer_pool_read_ahead_evicted | 2048   |
+---------------------------------------+--------+
```

            

`Innodb_buffer_pool_read_ahead_evicted`
            表示预读进来但还没被使用就被淘汰的页数。如果这个值占
            `Innodb_buffer_pool_read_ahead`
            的比例很高（比如超过 20%），说明预读过于激进，可以考虑提高
            `innodb_read_ahead_threshold`。
            
            

## 六、MySQL InnoDB Buffer
            Pool

            

InnoDB 是 MySQL 的默认存储引擎，它的 Buffer Pool
            实现是数据库领域中最成熟、最经过实战检验的实现之一。
            

### Buffer Pool 实例

            

从 MySQL 5.6 开始，InnoDB 支持将 Buffer Pool
            分成多个实例（Instance）。每个实例有自己的 LRU 链表、Free
            链表、Flush 链表和互斥锁。页面按 `page_id`
            哈希分配到不同的实例，不同实例的操作可以并行进行，减少了锁争用。
            
```
-- 查看 Buffer Pool 实例数
SHOW VARIABLES LIKE 'innodb_buffer_pool_instances';

-- 设置 Buffer Pool 实例数（需要重启）
-- 推荐值：当 buffer_pool_size >= 1GB 时，设为 8 或 16
-- buffer_pool_size 
            

每个实例的大小 = `innodb_buffer_pool_size` /
            `innodb_buffer_pool_instances`。实例数不宜过多，因为每个实例都有自己的管理开销。经验上，每个实例至少
            1GB 是合理的。
            

### Chunk 机制

            

从 MySQL 5.7.5 开始，InnoDB 引入了 chunk
            机制，允许在线调整 Buffer Pool 大小（Online Buffer Pool
            Resizing）。Buffer Pool 被划分为多个 chunk，每个 chunk
            是一块连续的内存区域，默认大小 128MB（由
            `innodb_buffer_pool_chunk_size` 控制）。
            
```
Buffer Pool Instance 0:
  Chunk 0: 128MB  [Frame 0 ... Frame 8191]
  Chunk 1: 128MB  [Frame 8192 ... Frame 16383]
  ...

Buffer Pool Instance 1:
  Chunk 0: 128MB
  Chunk 1: 128MB
  ...
```

            

扩大 Buffer Pool 时，InnoDB 分配新的 chunk
            并将其加入实例；缩小时，释放多余的
            chunk。这个过程不需要重启数据库，但缩小操作可能需要先淘汰大量页面，会有短暂的性能波动。
            

`innodb_buffer_pool_size` 的有效值必须是
            `innodb_buffer_pool_chunk_size * innodb_buffer_pool_instances`
            的整数倍。如果设置的值不满足这个条件，InnoDB
            会自动向上调整。
            

### Old/Young 子链表

            

InnoDB 的 LRU 链表被分成两个子链表：young 子链表和 old
            子链表。这就是前面提到的 2Q 思想的实现。
            
```
LRU 链表:
  ┌────── young 区域（约 5/8）──────┐┌────── old 区域（约 3/8）──────┐
  │ 热数据，频繁访问的页             ││ 新加载的页，一次性扫描数据     │
  │ ←── head                        ││                    tail ──→   │
  └──────────────────────────────────┘└──────────────────────────────┘
                                      ↑
                                  midpoint
```

            

新读入的页不会直接放到 LRU 链表头部，而是放到 old
            区域的头部（即 midpoint
            位置）。这样，全表扫描带进来的页只会在 old
            区域中待着，不会把 young 区域的热数据挤掉。
            

一个页要从 old 区域提升到 young
            区域，需要满足两个条件：
            
            
- 页在 old 区域中停留的时间超过
            `innodb_old_blocks_time`（默认 1000 毫秒）；
            
- 页被再次访问。
            
            

这个时间窗口的设计非常巧妙：全表扫描时，每个页被读入后很快就被下一个页替换了，停留时间远不到
            1 秒，所以不会被提升到 young
            区域；而真正的热数据，会在较长时间跨度内被反复访问，自然会进入
            young 区域。
            
```
-- 查看 old 区域占比（默认 37%，即约 3/8）
SHOW VARIABLES LIKE 'innodb_old_blocks_pct';

-- 查看 old 区域停留时间阈值（毫秒）
SHOW VARIABLES LIKE 'innodb_old_blocks_time';
```

            

### 自适应刷新（Adaptive
            Flushing）

            

InnoDB
            的自适应刷新机制（`innodb_adaptive_flushing`）会根据当前的脏页比例和
            Redo Log 生成速度动态调整刷新速率。
            

核心逻辑是：
            
            
- 计算当前脏页比例；
            
- 计算 Redo Log 的消耗速度；
            
- 估算如果不加速刷新，Redo Log 多久会被写满；
            
- 根据以上信息，计算每秒需要刷出多少页。
            
            

InnoDB 中相关的参数：
            
```
-- 自适应刷新开关（默认 ON）
SHOW VARIABLES LIKE 'innodb_adaptive_flushing';

-- 脏页比例低水位（低于此值不触发自适应刷新，默认 10%）
SHOW VARIABLES LIKE 'innodb_adaptive_flushing_lwm';

-- 最大脏页比例（超过此值会激进刷新，默认 90%）
SHOW VARIABLES LIKE 'innodb_max_dirty_pages_pct';

-- 最大脏页比例低水位（开始预刷新的阈值，默认 10%）
SHOW VARIABLES LIKE 'innodb_max_dirty_pages_pct_lwm';

-- Page Cleaner 线程数（默认 4，建议与 buffer_pool_instances 一致）
SHOW VARIABLES LIKE 'innodb_page_cleaners';

-- I/O 容量限制
SHOW VARIABLES LIKE 'innodb_io_capacity';          -- 正常刷新速率上限（默认 200 IOPS）
SHOW VARIABLES LIKE 'innodb_io_capacity_max';      -- 紧急刷新速率上限（默认 2000 IOPS）
```

            

`innodb_io_capacity` 和
            `innodb_io_capacity_max`
            的设置应该匹配底层存储设备的实际能力。对于 HDD，200-400 IOPS
            是合理的；对于 SATA SSD，可以设到 2000-5000；对于 NVMe
            SSD，可以设到 10000-20000
            或更高。设得太低，脏页刷不出去，Redo Log
            会被写满导致写停顿；设得太高，刷新 I/O 会抢占正常查询的 I/O
            带宽。
            

### 用 SHOW ENGINE
            INNODB STATUS 监控

            

`SHOW ENGINE INNODB STATUS` 的
            `BUFFER POOL AND MEMORY` 区域包含了 Buffer Pool
            的关键指标：
            
```
SHOW ENGINE INNODB STATUS\G
```

            

输出中的关键段落（以下输出经删减，仅保留 Buffer Pool
            相关部分）：
            
```
----------------------
BUFFER POOL AND MEMORY
----------------------
Total large memory allocated 137363456
Dictionary memory allocated 365080
Buffer pool size   8192
Free buffers       1024
Database pages     7128
Old database pages 2611
Modified db pages  320
Pending reads      0
Pending writes: LRU 0, flush list 0, single page 0
Pages made young 12450, not young 78230
0.00 youngs/s, 0.00 non-youngs/s
Pages read 45230, created 1200, written 8900
0.00 reads/s, 0.00 creates/s, 0.00 writes/s
Buffer pool hit rate 998 / 1000, young-making rate 5 / 1000 not 15 / 1000
Pages read ahead 0.00/s, evicted without access 0.00/s, Random read ahead 0.00/s
LRU len: 7128, unzip_LRU len: 0
I/O sum[56]:cur[0], unzip sum[0]:cur[0]
```

            

几个核心指标的解读：
            
            
- **Buffer pool hit rate**：命中率，998/1000
            表示 99.8%。低于 99% 通常意味着 Buffer Pool 太小；
            
- **Pages made young / not young**：页从 old
            区域提升到 young 区域的次数，以及因为
            `innodb_old_blocks_time`
            限制未能提升的次数；
            
- **Modified db
            pages**：当前脏页数量。如果这个值持续很高（接近
            `innodb_max_dirty_pages_pct`
            对应的页数），说明刷新跟不上写入；
            
- **evicted without
            access**：预读进来但没被访问就被淘汰的页数，如果很高说明预读过于激进；
            
- **Pending reads/writes**：等待中的 I/O
            请求数量，如果持续不为 0，说明 I/O 成为瓶颈。
            
            

也可以通过 `INFORMATION_SCHEMA`
            获取结构化数据：
            
```
SELECT
    POOL_ID,
    POOL_SIZE,
    FREE_BUFFERS,
    DATABASE_PAGES,
    OLD_DATABASE_PAGES,
    MODIFIED_DATABASE_PAGES,
    PAGES_MADE_YOUNG,
    PAGES_NOT_MADE_YOUNG,
    HIT_RATE
FROM INFORMATION_SCHEMA.INNODB_BUFFER_POOL_STATS;
```

            
            

## 七、PostgreSQL Shared
            Buffers

            

PostgreSQL 的内存管理架构与 InnoDB
            有本质的不同。PostgreSQL
            是多进程架构（每个连接一个后端进程），所有进程通过共享内存（Shared
            Memory）访问同一块缓冲区——共享缓冲区（Shared Buffers）。
            

### shared_buffers 参数

            

`shared_buffers` 是 PostgreSQL 中 Buffer Pool
            的等价物，控制用于缓存数据页的共享内存大小。默认值是
            128MB，在生产环境中通常需要调大。
            
```
# postgresql.conf
shared_buffers = 8GB    # 推荐值：物理内存的 25%
```

            

PostgreSQL 社区的通用建议是将 `shared_buffers`
            设为物理内存的 25%。但这个建议的背景是：PostgreSQL
            还依赖操作系统的 Page Cache 来做第二层缓存。PostgreSQL 使用
            Buffered I/O（不是 Direct I/O），数据会在 Shared Buffers 和
            Page Cache 中各存一份。
            

这确实是一个 Double Buffering 的问题，但 PostgreSQL
            社区认为这个代价是可接受的，理由是：
            
            
- Page Cache 可以缓存比 `shared_buffers`
            大得多的数据集；
            
- Page Cache 的 LRU 策略虽然不如数据库自己的策略精确，但在
            `shared_buffers`
            未命中时提供了一个”兜底”层；
            
- 使用 Direct I/O 会失去操作系统的预读优化和 I/O
            调度。
            
            

这是一个工程取舍的问题。不同的系统做了不同的选择，不存在绝对的对错。
            

### Clock-Sweep 替换算法

            

PostgreSQL 使用 Clock-Sweep 算法管理 Shared Buffers
            中的页面替换。每个缓冲区描述符（Buffer
            Descriptor）有一个使用计数（Usage
            Count），而不是简单的引用位。
            

当一个页面被访问时，`usage_count` 加
            1，最大值为 5。时钟指针扫描时，如果 `usage_count`
            大于 0，就减 1 并跳过；如果 `usage_count` 为
            0，就选择该页淘汰。
            
```
// PostgreSQL 源码 src/backend/storage/buffer/freelist.c 中的逻辑（经简化）
// 基于 PostgreSQL 16
for (;;) {
    buf = GetBufferDescriptor(ClockSweepTick());

    if (buf->usage_count > 0) {
        buf->usage_count--;
        continue;
    }

    if (buf->refcount == 0) {
        // 找到淘汰目标
        return buf;
    }
}
```

            

`usage_count` 的上限为
            5，这意味着一个被频繁访问的页最多需要被时钟指针扫过 5
            次才会被淘汰。这提供了一定程度的”频率”保护——访问越频繁的页，`usage_count`
            越高，越不容易被淘汰。
            

但与 InnoDB 的 old/young 分区相比，Clock-Sweep
            对大规模顺序扫描的抵抗能力较弱。PostgreSQL
            通过另一种机制来解决这个问题。
            

### Ring
            Buffer：大扫描的隔离机制

            

当 PostgreSQL
            检测到以下操作时，会分配一个小的环形缓冲区（Ring
            Buffer），将该操作的 I/O 限制在这个环形缓冲区内，避免污染主
            Shared Buffers：
            
            
            
            
            
            
            
            
            操作类型
            Ring Buffer 大小
            触发条件
            
            
            
            
            批量读（Bulk Read）
            256KB（32 页）
            全表顺序扫描大于 `shared_buffers / 4`
            的表
            
            
            批量写（Bulk Write）
            16MB（2048 页）
            `COPY`、`CREATE TABLE AS SELECT`、`ALTER TABLE`
            
            
            `VACUUM`
            256KB（32 页）
            `VACUUM` 操作
            
            
            
            

Ring Buffer
            的工作方式是：操作只能使用环形缓冲区内的帧，写满后从头开始覆盖。这样，无论扫描的表有多大，最多只占用
            Ring Buffer 大小的共享内存，不会影响 Shared Buffers
            中其他热数据。
            

这个设计在效果上类似于 InnoDB 的 old
            子链表，但实现更加直接。
            

### bgwriter 后台写进程

            

`bgwriter`（Background Writer）是 PostgreSQL
            的后台脏页刷新进程，负责定期扫描 Shared
            Buffers，将脏页刷回磁盘，以确保总有足够的干净页供后端进程使用。
            

核心参数：
            
```
# postgresql.conf
bgwriter_delay = 200ms              # 扫描间隔
bgwriter_lru_maxpages = 100         # 每次扫描最多刷出的页数
bgwriter_lru_multiplier = 2.0       # 根据最近的需求预估需要多少干净页
bgwriter_flush_after = 512kB        # 累积写入量达到此值后强制 fsync
```

            

`bgwriter_lru_multiplier`
            的工作方式是：bgwriter
            统计两次扫描之间后端进程使用了多少个干净页（记为
            N），然后在下一次扫描时尝试刷出
            `N * bgwriter_lru_multiplier` 个脏页。这样
            bgwriter 可以自动跟上写入速度的变化。
            

如果 bgwriter
            来不及刷出足够的干净页，后端进程在需要帧时就不得不自己刷脏页——这会导致查询延迟增加。可以通过
            `pg_stat_bgwriter` 视图监控：
            
```
SELECT
    buffers_clean,          -- bgwriter 刷出的页数
    maxwritten_clean,       -- bgwriter 因达到 lru_maxpages 限制而停止的次数
    buffers_backend,        -- 后端进程自己刷出的页数（应该尽量为 0）
    buffers_alloc           -- 分配的新页数
FROM pg_stat_bgwriter;
```

            

如果 `buffers_backend` 持续增长，说明 bgwriter
            跟不上节奏，需要调大 `bgwriter_lru_maxpages`
            或减小 `bgwriter_delay`。
            

### checkpointer
            检查点进程

            

PostgreSQL 9.2 开始将检查点逻辑从 bgwriter
            中分离出来，由独立的 `checkpointer`
            进程负责。checkpointer 在以下条件下触发检查点：
            
            
- WAL 日志量达到 `max_wal_size`（默认
            1GB）；
            
- 距离上次检查点的时间达到
            `checkpoint_timeout`（默认 5 分钟）；
            
- 手动执行 `CHECKPOINT` 命令。
            
            
```
# postgresql.conf
checkpoint_timeout = 15min          # 检查点最大间隔
max_wal_size = 4GB                  # 触发检查点的 WAL 累积量
checkpoint_completion_target = 0.9  # 检查点刷新在下次检查点前完成的比例
```

            

`checkpoint_completion_target`
            控制检查点的刷新”舒适度”。设为 0.9
            意味着检查点会尝试在下次检查点触发前 90%
            的时间内完成所有脏页的刷新，平滑 I/O
            负载，避免集中刷新造成的 I/O 尖峰。
            
            

## 八、Buffer Pool
            大小调优

            

Buffer Pool
            的大小是数据库性能调优中最关键的参数之一。设得太小，缓存命中率低，磁盘
            I/O
            成为瓶颈；设得太大，操作系统和其他进程的可用内存不足，可能触发
            swap 甚至 OOM。
            

### 初始估算方法

            

一个基本的出发点是根据物理内存和数据库角色来分配：
            
            
            
            场景
            Buffer Pool 建议大小
            
            
            
            
            专用数据库服务器（InnoDB）
            物理内存的 70%-80%
            
            
            专用数据库服务器（PostgreSQL）
            物理内存的 25%（依赖 Page Cache）
            
            
            混合部署（数据库 + 应用）
            物理内存的 40%-50%
            
            
            容器化部署
            容器内存限制的 60%-70%
            
            
            
            

InnoDB 的建议值比 PostgreSQL 高很多，是因为 InnoDB 使用
            Direct I/O，Buffer Pool 是唯一的数据缓存层；而 PostgreSQL
            使用 Buffered I/O，Page Cache 提供了额外的缓存。
            

但这些只是起点。实际的最优大小取决于工作集（Working
            Set）的大小和访问模式。
            

### 工作集分析

            

工作集是指在一段时间内被实际访问到的数据页集合。如果
            Buffer Pool 能装下整个工作集，命中率就会接近
            100%；如果装不下，命中率取决于替换算法对冷热数据的区分能力。
            

InnoDB 提供了一种间接估算工作集大小的方式——通过观察不同
            Buffer Pool 大小下的命中率变化：
            
```
-- 查看当前命中率
SELECT
    (1 - (
        (SELECT VARIABLE_VALUE FROM performance_schema.global_status
         WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads')
        /
        (SELECT VARIABLE_VALUE FROM performance_schema.global_status
         WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')
    )) * 100 AS hit_rate_pct;
```

            

如果命中率已经是 99.9%，增大 Buffer Pool
            不会有明显收益；如果命中率只有 95%，那 5% 的未命中意味着每
            20 次读请求就有一次要走磁盘，增大 Buffer Pool
            可能会显著改善性能。
            

### 命中率与性能的非线性关系

            

命中率和性能之间的关系不是线性的。假设 Buffer Pool
            命中延迟为 0.1ms，磁盘读取延迟为 5ms：
            
```
命中率    平均延迟            相对性能
99.9%    0.1*0.999 + 5*0.001 = 0.105ms    1.00x
99.0%    0.1*0.99  + 5*0.01  = 0.149ms    0.70x
95.0%    0.1*0.95  + 5*0.05  = 0.345ms    0.30x
90.0%    0.1*0.90  + 5*0.10  = 0.590ms    0.18x
```

            

从 99.9% 下降到 99.0% ，平均延迟增加了 42%；从 99.0%
            下降到
            95.0%，延迟又翻了一倍多。这说明在高命中率区间，每一个百分点的提升都很有价值。
            

### 内存压力的平衡

            

增大 Buffer Pool
            不是没有代价的。数据库之外的内存需求包括：
            
            
- **操作系统**：内核、页表、slab
            缓存等，通常需要 1-2GB；
            
- **Page Cache**（PostgreSQL
            场景）：用于缓存数据文件，越大越好；
            
- **连接内存**：每个数据库连接需要分配排序缓冲区、哈希连接缓冲区等。InnoDB
            中，每个连接的
            `sort_buffer_size`、`join_buffer_size`、`read_buffer_size`
            等加起来可能有几 MB；如果有 500 个活跃连接，这就是几
            GB；
            
- **其他进程**：监控代理、日志收集、备份工具等。
            
            

一个安全的做法是：
            
```
buffer_pool_size 
```
-- 在线扩大 Buffer Pool
SET GLOBAL innodb_buffer_pool_size = 16 * 1024 * 1024 * 1024;  -- 16GB

-- 查看调整进度
SHOW STATUS LIKE 'Innodb_buffer_pool_resize_status';
```

            

调整过程中，InnoDB 会：
            
            
- 扩大时：分配新的 chunk，将其加入实例；
            
- 缩小时：标记多余的
            chunk，等待其中的页被淘汰后释放。
            
            

缩小操作可能需要较长时间，因为需要等待 chunk
            中所有页都被淘汰或迁移。在此期间，Buffer Pool
            的行为是正常的，但可能会有更频繁的页面淘汰。
            

PostgreSQL 调整 `shared_buffers`
            需要重启，这是它相比 InnoDB 的一个劣势。不过 PostgreSQL 16
            引入了一些动态调整的初步支持。
            
            

## 九、Buffer Pool
            监控与诊断

            

Buffer Pool 的状态直接反映数据库的 I/O
            健康状况。建立持续的监控是性能调优的基础。
            

### 核心监控指标

            

以下是需要持续关注的 Buffer Pool 指标：
            
            
            
            指标
            含义
            健康范围
            
            
            
            
            命中率
            缓存命中次数 / 总读请求次数
            >= 99%
            
            
            脏页比例
            脏页数 / 总页数
            < 75%（InnoDB）
            
            
            空闲页数
            Free List 中的帧数
            > 0
            
            
            淘汰速率
            每秒淘汰的页数
            平稳，无突增
            
            
            后端刷盘数（PG）
            后端进程自己刷出的脏页数
            尽量为 0
            
            
            预读浪费率
            预读后未被访问就淘汰的比例
            < 20%
            
            
            等待 I/O 数
            Pending Reads/Writes
            尽量为 0
            
            
            
            

### InnoDB 监控脚本

            

以下脚本收集 InnoDB Buffer Pool
            的关键指标，适合接入监控系统：
            
```
-- InnoDB Buffer Pool 健康检查
SELECT
    'buffer_pool_size_gb' AS metric,
    ROUND(@@innodb_buffer_pool_size / 1024 / 1024 / 1024, 2) AS value
UNION ALL
SELECT
    'hit_rate_pct',
    ROUND((1 - s1.VARIABLE_VALUE / s2.VARIABLE_VALUE) * 100, 2)
FROM
    performance_schema.global_status s1,
    performance_schema.global_status s2
WHERE
    s1.VARIABLE_NAME = 'Innodb_buffer_pool_reads'
    AND s2.VARIABLE_NAME = 'Innodb_buffer_pool_read_requests'
UNION ALL
SELECT
    'dirty_pages',
    VARIABLE_VALUE
FROM performance_schema.global_status
WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_dirty'
UNION ALL
SELECT
    'free_pages',
    VARIABLE_VALUE
FROM performance_schema.global_status
WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_free'
UNION ALL
SELECT
    'total_pages',
    VARIABLE_VALUE
FROM performance_schema.global_status
WHERE VARIABLE_NAME = 'Innodb_buffer_pool_pages_total'
UNION ALL
SELECT
    'pending_reads',
    VARIABLE_VALUE
FROM performance_schema.global_status
WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads';
```

            

### PostgreSQL 监控查询

            
```
-- Shared Buffers 使用情况（需要 pg_buffercache 扩展）
CREATE EXTENSION IF NOT EXISTS pg_buffercache;

-- 各数据库的缓冲区占用
SELECT
    d.datname AS database,
    COUNT(*) AS buffers,
    COUNT(*) FILTER (WHERE b.isdirty) AS dirty_buffers,
    pg_size_pretty(COUNT(*) * 8192::bigint) AS size
FROM pg_buffercache b
JOIN pg_database d ON d.oid = b.reldatabase
GROUP BY d.datname
ORDER BY buffers DESC;
```

            
```
-- 各表的缓冲区占用（定位哪些表占了最多缓存）
SELECT
    c.relname AS table_name,
    COUNT(*) AS buffers,
    COUNT(*) FILTER (WHERE b.isdirty) AS dirty_buffers,
    ROUND(100.0 * COUNT(*) / (SELECT setting::int
        FROM pg_settings WHERE name = 'shared_buffers'), 1) AS pct_of_total
FROM pg_buffercache b
JOIN pg_class c ON c.relfilenode = b.relfilenode
WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY c.relname
ORDER BY buffers DESC
LIMIT 20;
```

            
```
-- bgwriter 与 checkpointer 统计
SELECT
    buffers_checkpoint,     -- checkpointer 刷出的页数
    buffers_clean,          -- bgwriter 刷出的页数
    maxwritten_clean,       -- bgwriter 达到限制而停止的次数
    buffers_backend,        -- 后端进程自己刷出的页数
    buffers_backend_fsync,  -- 后端进程自己执行 fsync 的次数（应该为 0）
    buffers_alloc,          -- 分配的缓冲区总数
    stats_reset             -- 统计信息上次重置的时间
FROM pg_stat_bgwriter;
```

            

### 命中率下降的排查流程

            

当发现 Buffer Pool 命中率下降时，按以下流程排查：
            
```
命中率下降
  │
  ├── 是否有大量全表扫描？
  │     └── 是 → 检查查询计划，添加索引或优化查询
  │           └── InnoDB: 检查 Pages not made young 是否异常增加
  │           └── PG: 检查 Ring Buffer 是否生效
  │
  ├── 工作集是否增大？
  │     └── 是 → 考虑增大 Buffer Pool
  │           └── 先确认内存是否充足
  │
  ├── 是否有连接数暴增？
  │     └── 是 → 连接内存挤占了 Buffer Pool 的有效空间
  │           └── 检查连接池配置
  │
  └── 是否有大事务或长事务？
        └── 是 → 长事务可能导致大量页面被 pin 住无法淘汰
              └── 检查事务状态，终止异常事务
```

            

### 脏页比例过高的排查

            
```
脏页比例过高
  │
  ├── 写入速率是否突增？
  │     └── 是 → 确认是否是批量导入或大更新操作
  │           └── 如果是临时性的，等操作完成即可
  │           └── 如果是持续性的，调大 innodb_io_capacity
  │
  ├── I/O 带宽是否饱和？
  │     └── 是 → 存储设备成为瓶颈
  │           └── 检查 iostat，确认设备利用率
  │           └── 考虑升级存储或分散 I/O
  │
  └── Page Cleaner / bgwriter 是否正常工作？
        └── InnoDB: 检查 innodb_page_cleaners 数量
        └── PG: 检查 buffers_backend 是否持续增长
```

            

### 持续监控建议

            

生产环境中，建议将以下指标接入时序数据库（如
            Prometheus）进行持续监控和告警：
            
```
# Prometheus 告警规则示例（以 InnoDB 为例）
groups:
  - name: buffer_pool
    rules:
      - alert: BufferPoolHitRateLow
        expr: |
          (1 - rate(mysql_global_status_innodb_buffer_pool_reads[5m])
               / rate(mysql_global_status_innodb_buffer_pool_read_requests[5m])
          )  0.75
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "脏页比例超过 75%"

      - alert: BufferPoolFreePagesCritical
        expr: mysql_global_status_innodb_buffer_pool_pages_free 
            

对于 PostgreSQL，可以通过 `pg_stat_bgwriter`
            指标设置类似的告警，重点关注 `buffers_backend`
            的增长速率——如果后端进程频繁自己刷脏页，说明 bgwriter
            配置不足或 I/O 带宽不够。
            
            

## 参考资料

            

### 论文

            
            
- Elizabeth J. O’Neil, Patrick E. O’Neil, Gerhard Weikum.
            “The LRU-K Page Replacement Algorithm for Database Disk
            Buffering”. ACM SIGMOD, 1993.
            
- Theodore Johnson, Dennis Shasha. “2Q: A Low Overhead
            High Performance Buffer Management Replacement Algorithm”.
            VLDB, 1994.
            
- Nimrod Megiddo, Dharmendra S. Modha. “ARC: A
            Self-Tuning, Low Overhead Replacement Cache”. USENIX FAST,
            2003.
            
- C. Mohan, Don Haderle, Bruce Lindsay, Hamid Pirahesh,
            Peter Schwarz. “ARIES: A Transaction Recovery Method
            Supporting Fine-Granularity Locking and Partial Rollbacks
            Using Write-Ahead Logging”. ACM Transactions on Database
            Systems, 1992.
            
- Goetz Graefe. “A Survey of B-Tree Locking Techniques”.
            ACM Transactions on Database Systems, 2010.
            
            

### 官方文档

            
            
- MySQL 8.0 Reference Manual, Chapter 15.5.1: “Buffer
            Pool”. https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool.html
            
- MySQL 8.0 Reference Manual, Chapter 15.8.3.4:
            “Configuring InnoDB Buffer Pool Prefetching (Read-Ahead)”.
            https://dev.mysql.com/doc/refman/8.0/en/innodb-performance-read_ahead.html
            
- PostgreSQL 16 Documentation, Chapter 20.4: “Resource
            Consumption — Shared Buffers”. https://www.postgresql.org/docs/16/runtime-config-resource.html
            
- PostgreSQL 16 Documentation, Chapter 30.5: “WAL
            Configuration”. https://www.postgresql.org/docs/16/wal-configuration.html
            
            

### 源码

            
            
- MySQL/InnoDB Buffer Pool
            实现：`storage/innobase/buf/buf0buf.cc`、`storage/innobase/buf/buf0lru.cc`、`storage/innobase/buf/buf0flu.cc`（MySQL
            8.0）
            
- PostgreSQL Shared Buffers
            实现：`src/backend/storage/buffer/bufmgr.c`、`src/backend/storage/buffer/freelist.c`（PostgreSQL
            16）
            
            

### 书籍

            
            
- Ramakrishnan, Gehrke. “Database Management Systems”. 3rd
            Edition, Chapter 9: “Buffer Manager”.
            
- Silberschatz, Korth, Sudarshan. “Database System
            Concepts”. 7th Edition, Chapter 13: “Data Storage
            Structures”.
            
            
            

**上一篇**: B-Tree
            与 B+Tree：页式存储引擎的工程实现
            

**下一篇**: WAL 与崩溃恢复：ARIES
            协议
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-14 · storage
                    

### 【存储工程】缓存工程：从 Page Cache 到应用层缓存

                    

深入分析存储多级缓存架构——Page Cache、Buffer Pool、应用缓存的协同设计，缓存淘汰算法对比，缓存穿透/击穿/雪崩的防护策略
                

                
                    

2025-07-15 · algorithms
                    

### 页面置换算法：LRU 的谎言与 ARC 的真相

                    

教科书说 LRU 是最好的页面置换算法。然后你在数据库上跑了一次全表扫描，热数据全被冲走了。本文从 Bélády 的最优算法出发，逐层揭示 LRU 的理论缺陷，到 CLOCK 的工程妥协，再到 ARC 的自适应智慧。
                

                
                    

2026-04-27 · algorithms
                    

### 缓冲池管理算法：LRU-K → 2Q → CLOCK-Pro

                    

每个数据库工程师都该理解的内存管理核心。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。