# 【存储工程】LMDB 与内存映射存储

来源: https://quant67.com/post/storage/33-lmdb-mmap/lmdb-mmap.html
日期: 2025-09-11 |

---

数据库存储引擎通常自己管理一块内存，维护 Buffer Pool，用
            `read()`/`pread()`
            把磁盘页加载进来，再用 LRU 或 Clock
            算法做淘汰。这套方案灵活、可控，但代码量大、调优参数多，且引入了用户态到内核态的数据拷贝。有没有一种方式，让操作系统直接把磁盘文件映射到进程地址空间，数据库只管读指针，不管搬数据？
            

这就是内存映射 I/O（Memory-Mapped
            I/O）的思路。LMDB（Lightning Memory-Mapped
            Database）把这条路走到了极致：整个数据库文件通过
            `mmap()`
            映射到进程地址空间，读操作直接访问指针，零拷贝、零分配；写操作通过写时复制（Copy-on-Write）B+Tree
            实现事务隔离，不需要 WAL（Write-Ahead Log），不需要 Buffer
            Pool，不需要后台压缩线程。整个代码库不到一万行 C
            代码，却能在读密集负载下跑出极高的性能。
            

但 mmap 不是银弹。页缺失（Page
            Fault）的延迟不可预测，TLB（Translation Lookaside
            Buffer）压力在大数据库上急剧上升，I/O
            错误无法被应用层优雅地捕获，写操作只能串行化——这些限制决定了
            mmap 存储引擎的适用边界。
            

本文从 mmap 的内核机制讲起，拆解 LMDB
            的架构和事务模型，再横向对比 BoltDB 和 BadgerDB 两个 Go
            生态的存储引擎，并对照站内 RocksDB
            工程实践（WAL + Buffer Pool/Block Cache 路线）与 SQLite
            十亿行实验（WAL + 可选 `PRAGMA mmap_size`
            的谨慎用法），最后讨论 mmap
            存储的适用边界。**本篇不给出未标注环境的自测
            QPS/延迟表格**；外部论文数据会标明出处与假设。
            

所有源码引用基于 LMDB 0.9.31、BoltDB
            1.3.x（bbolt）、BadgerDB v4。
            
            

## 一、mmap 工作原理

            

### 1.1 从 read/pread 到 mmap

            

传统的文件 I/O
            路径是这样的：应用程序分配一块用户态缓冲区，调用
            `read()` 或 `pread()`
            系统调用，内核从磁盘读取数据到 Page Cache，再从 Page Cache
            拷贝到用户态缓冲区。读一次数据，至少经过一次内存拷贝：
            
```
应用程序 pread(fd, buf, len, offset)
    │
    ▼
内核：查找 Page Cache
    │  命中 → 拷贝到 buf
    │  未命中 → 从磁盘读入 Page Cache → 拷贝到 buf
    │
    ▼
pread() 返回，数据在 buf 中
```

            

`mmap()`
            走的是另一条路。它不分配用户态缓冲区，而是把文件的一段区间直接映射到进程的虚拟地址空间。映射完成后，应用程序通过普通的指针解引用访问文件内容，不需要任何系统调用：
            
```
void *addr = mmap(NULL, file_size, PROT_READ, MAP_SHARED, fd, 0);
// 现在 addr[0..file_size-1] 就是文件内容
// 读取第 4096 字节开始的 4KB：直接 memcpy(dst, addr + 4096, 4096)
```

            

### 1.2 虚拟内存与页表

            

`mmap()`
            调用本身不会读取任何磁盘数据。它只做一件事：在进程的虚拟地址空间中建立一段映射关系，把虚拟页（Virtual
            Page）和文件的某个偏移量关联起来。内核在页表（Page
            Table）中记录这个映射，但对应的物理页帧（Physical Page
            Frame）此时并不分配。
            

虚拟地址空间的布局如下：
            
```
┌─────────────────────────┐  高地址
│        内核空间           │
├─────────────────────────┤
│          栈              │
│          ↓              │
│       （空闲区域）        │
│          ↑              │
│   mmap 映射区域          │  ← mmap() 在这里分配虚拟地址
│       （空闲区域）        │
│          ↑              │
│          堆              │
├─────────────────────────┤
│      数据段 / BSS        │
├─────────────────────────┤
│        代码段             │
└─────────────────────────┘  低地址
```

            

### 1.3 页缺失处理

            

当应用程序第一次访问 mmap 映射区域中的某个地址时，CPU
            查页表发现该虚拟页没有对应的物理页帧，触发页缺失（Page
            Fault）。内核的页缺失处理流程：
            
            
- CPU 产生 Page Fault 异常，陷入内核。
            
- 内核检查虚拟地址是否合法（是否在 mmap
            映射范围内）。
            
- 分配一个物理页帧。
            
- 检查 Page Cache 中是否已有该文件偏移量对应的页。
            
- 如果 Page Cache 命中，直接把 Page Cache
            中的物理页帧映射到进程页表。
            
- 如果 Page Cache 未命中，发起磁盘 I/O，把数据读入 Page
            Cache，再映射到页表。
            
- 更新页表项（PTE），设置权限位。
            
- CPU 重新执行触发 Page Fault 的那条指令。
            
            
```
应用程序访问 addr[offset]
    │
    ▼
CPU 查页表 → PTE 无效
    │
    ▼
Page Fault 异常 → 陷入内核
    │
    ▼
内核：检查 VMA → 合法
    │
    ├─ Page Cache 命中 → 映射物理页到页表
    │
    └─ Page Cache 未命中 → 磁盘 I/O → 填充 Page Cache → 映射物理页到页表
    │
    ▼
返回用户态，CPU 重新执行该指令
```

            

这里有一个关键区别：Page Cache
            命中时发生的是次要页缺失（Minor Page
            Fault），只需要更新页表，延迟在微秒级；Page Cache
            未命中时发生的是主要页缺失（Major Page Fault），需要等待磁盘
            I/O，延迟在毫秒级。对于 SSD，一次 Major Page Fault 大约
            50-200 微秒；对于 HDD，可能达到 5-15 毫秒。
            

### 1.4 mmap 与 Page Cache
            的关系

            

mmap 和 `read()`/`pread()`
            底层共享同一份 Page Cache。一个文件不管是通过
            `pread()` 读取还是通过 mmap 访问，内核都只在 Page
            Cache
            中维护一份数据副本。区别在于数据到达应用程序的路径：
            
```
pread() 路径：  磁盘 → Page Cache → 用户态缓冲区（一次拷贝）
mmap 路径：     磁盘 → Page Cache ← 进程页表直接映射（零拷贝）
```

            

mmap
            的零拷贝（Zero-Copy）特性来源于此：应用程序的虚拟地址直接指向
            Page Cache 中的物理页帧，读取数据时不需要
            `memcpy()`。这对于读密集型数据库来说是一个显著优势——每次读操作省掉一次内存拷贝，省掉一次系统调用。
            

### 1.5 mmap 的参数与标志

            

`mmap()`
            的几个关键参数对存储引擎的行为有直接影响：
            
```
void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
```

            
            
            
            参数
            常用值
            含义
            
            
            
            
            `prot`
            `PROT_READ`
            只读映射，写入触发 SIGSEGV
            
            
            `prot`
            `PROT_READ \| PROT_WRITE`
            读写映射
            
            
            `flags`
            `MAP_SHARED`
            修改写回文件，多进程可见
            
            
            `flags`
            `MAP_PRIVATE`
            写时复制，修改不写回文件
            
            
            `offset`
            页大小对齐
            映射的起始偏移量
            
            
            
            

LMDB 对数据文件使用 `PROT_READ | MAP_SHARED`
            映射。**默认写路径不通过 mmap
            改映射区**——新页用 `pwrite()`
            追加到文件末尾，提交时用 `fdatasync()` 刷盘后再
            `mmap`/`mremap`
            扩大可见范围（`MDB_WRITEMAP`
            标志下才允许向映射区直接写，行为与默认路径不同）。这与 RocksDB
            的「WAL + MemTable flush + Compaction 原地/合并写
            SST」、以及 SQLite
            默认的「WAL 顺序追加 + 数据库页
            `read()`/`write()`」都不同：LMDB
            把**读**交给 mmap
            零拷贝，把**写**交给显式 syscall + 双 meta
            原子切换，刻意避开「脏 mmap 页何时回盘」与 WAL
            顺序的纠缠。
            

### 1.6 预读与 madvise

            

内核在处理 mmap
            页缺失时，默认会执行预读（Readahead）——不只读当前触发 Page
            Fault 的那一页，还会多读几页进来。预读窗口通常从 16KB
            开始，随着顺序访问模式的检测逐步增大到 128KB 或更多。
            

应用程序可以通过 `madvise()`
            系统调用向内核提示访问模式：
            
```
// 提示内核：即将顺序访问这段区域
madvise(addr, length, MADV_SEQUENTIAL);

// 提示内核：访问模式是随机的，不要预读
madvise(addr, length, MADV_RANDOM);

// 提示内核：这段区域即将被访问，请预先加载
madvise(addr, length, MADV_WILLNEED);

// 提示内核：这段区域暂时不需要了，可以释放物理页
madvise(addr, length, MADV_DONTNEED);
```

            

LMDB 在打开数据库时不设置
            `MADV_SEQUENTIAL`，因为 B+Tree
            的访问模式是随机的。部分场景下会使用
            `MADV_RANDOM` 来关闭预读，避免不必要的磁盘
            I/O。
            
            

## 二、mmap 的优势与陷阱

            

### 2.1 优势：零拷贝读取

            

mmap 最明显的优势是零拷贝读取（Zero-Copy
            Read）。应用程序通过指针直接访问 Page Cache
            中的数据，不需要分配缓冲区、不需要系统调用、不需要内存拷贝。对于一个嵌入式数据库来说，这意味着：
            
            
- 读操作的 CPU 开销极低。
            
- 不需要维护 Buffer Pool，代码复杂度大幅下降。
            
- 不需要 Buffer Pool 大小的调优参数。
            
- 多个读事务可以同时访问同一份物理内存，内存利用率高。
            
            

在读密集型负载下，mmap
            数据库的热读延迟可以低到**微秒级以下**（数据已在
            Page Cache、且 B+Tree
            深度较浅时）——具体数字高度依赖数据集、树深与
            CPU；本篇不在无环境标注下写「几百纳秒」类结论。
            

### 2.2
            优势：操作系统管理内存

            

使用 mmap 意味着把内存管理完全交给操作系统。Page Cache
            的淘汰策略、脏页回写时机、物理内存分配——这些全部由内核的
            MM（Memory
            Management）子系统处理。数据库不需要实现自己的页面替换算法，不需要追踪哪些页是干净的、哪些是脏的。
            

这对于嵌入式数据库（Embedded
            Database）来说尤其有吸引力。嵌入式数据库通常作为库链接到应用程序中，不作为独立进程运行，配置越少越好。LMDB
            的初始化只需要指定数据库文件路径和最大映射大小，不需要配置缓冲池容量、预读策略、后台刷新线程等参数。
            

### 2.3 陷阱：TLB 压力

            

TLB（Translation Lookaside Buffer，地址转换后备缓冲器）是
            CPU 中缓存虚拟地址到物理地址映射的硬件缓存。现代 x86-64 CPU
            的 TLB 容量有限：
            
            
            
            TLB 级别
            容量（典型值）
            页大小
            覆盖范围
            
            
            
            
            L1 dTLB
            64 条目
            4KB
            256KB
            
            
            L2 sTLB
            1536 条目
            4KB
            6MB
            
            
            L1 dTLB（大页）
            32 条目
            2MB
            64MB
            
            
            
            

当数据库文件很大——比如 100GB——mmap 映射区域覆盖了 2500
            万个 4KB 页。任何时刻 TLB 只能缓存几千个页的映射关系。B+Tree
            的随机访问模式导致 TLB 频繁缺失（TLB Miss），每次 TLB Miss
            需要 CPU 执行页表遍历（Page Table
            Walk），在四级页表结构下最多需要四次内存访问。这个开销在数据库文件很大、工作集远超
            TLB 覆盖范围时变得显著。
            

Andy Pavlo 等人在 2022 年的论文”Are You Sure You Want to
            Use MMAP in Your Database Management System?“中测量了 TLB
            Miss 的影响：当数据库大小超过几 GB 时，mmap
            数据库的随机读延迟比使用 Buffer Pool + `pread()`
            的方案高出 10-30%，主要瓶颈就在 TLB Miss 和 Page Table Walk
            上。
            

使用大页（Huge Pages，2MB 或 1GB
            页）可以缓解这个问题。LMDB 支持通过
            `MDB_WRITEMAP`
            标志配合操作系统的透明大页（Transparent Huge
            Pages，THP）使用 2MB 页，将 TLB 覆盖范围扩大 512 倍。但 THP
            本身也有问题——内存碎片化时分配 2MB
            连续物理页可能触发压缩（Compaction），引入不可预测的延迟。
            

### 2.4 陷阱：页缺失不可预测

            

`pread()` 是同步系统调用：调用者知道自己在等待
            I/O，可以主动做超时控制、错误重试。mmap
            的页缺失则不同——它发生在普通的内存访问指令上，对应用程序完全透明。一条
            `mov rax, [rbx]` 指令，在 Page Cache
            命中时耗时几纳秒，在触发 Major Page Fault
            时可能阻塞几毫秒。应用程序无法区分这两种情况，也无法为 mmap
            读取设置超时。
            

这种不可预测性对延迟敏感的数据库系统是一个问题。在传统的
            Buffer Pool 架构中，数据库可以用异步
            I/O（`io_uring`、`aio`）预取需要的页，在
            I/O 完成前处理其他请求。mmap
            做不到这一点——页缺失发生时当前线程直接阻塞，直到 I/O
            完成。
            

### 2.5 陷阱：I/O 错误处理

            

这是 mmap 存储引擎最严重的工程问题之一。当
            `pread()` 遇到磁盘 I/O 错误时，它返回
            `-1` 并设置
            `errno`，应用程序可以优雅地处理——记录日志、返回错误、重试或关闭。
            

mmap 的 I/O 错误处理则完全不同。当 Page Fault
            处理过程中发生磁盘 I/O
            错误时，内核的行为取决于具体情况：
            
            
- 对于读操作触发的 Page Fault：内核向进程发送
            `SIGBUS` 信号。如果进程没有注册 SIGBUS
            处理函数，进程直接被杀死。
            
- 即使注册了 SIGBUS
            处理函数，从信号处理函数中恢复也极其困难——你需要知道是哪个线程、哪个地址触发了错误，然后用
            `longjmp` 或其他机制跳出。
            
- 在多线程环境下，SIGBUS
            信号处理的正确性几乎无法保证。
            
            
```
// SIGBUS 处理的简化示例——实际工程中这段代码很难写对
static sigjmp_buf jmpbuf;
static volatile sig_atomic_t got_sigbus = 0;

void sigbus_handler(int sig) {
    got_sigbus = 1;
    siglongjmp(jmpbuf, 1);
}

int safe_mmap_read(void *addr, void *dst, size_t len) {
    struct sigaction sa = { .sa_handler = sigbus_handler };
    sigaction(SIGBUS, &sa, NULL);

    if (sigsetjmp(jmpbuf, 1) == 0) {
        memcpy(dst, addr, len);  // 可能触发 SIGBUS
        return 0;
    } else {
        return -1;  // I/O 错误
    }
}
```

            

LMDB 的做法是注册一个全局 SIGBUS
            处理函数，在处理函数中设置错误标志，然后在事务结束时检查这个标志。这种方法可以工作，但不够健壮。Howard
            Chu（LMDB 作者）在多个场合承认 mmap I/O
            错误处理是一个已知的薄弱环节。
            

### 2.6
            陷阱：无法控制回写时机

            

使用 `MAP_SHARED` 映射并写入 mmap
            区域时，内核会在它认为合适的时机把脏页写回磁盘。应用程序无法精确控制哪些页在什么时候被写回。这对数据库的持久化语义有直接影响：
            
            
- Buffer Pool 架构可以实现”只在 WAL
            已持久化后才允许刷脏页”的策略（WAL 的 Force-at-Commit
            规则）。
            
- mmap 架构下，内核可能在 WAL
            持久化之前就把脏数据页写回磁盘，破坏崩溃恢复的正确性。
            
            

LMDB 通过完全不使用 WAL 来回避这个问题——它的 CoW B+Tree
            设计保证在任何时刻磁盘上都有一份完整的、一致的数据库状态。但这也意味着
            LMDB 放弃了 WAL 带来的写入性能优势（批量提交、组提交）。
            

### 2.7 mmap 优劣势总结

            
            
            
            维度
            mmap
            pread + Buffer Pool
            
            
            
            
            读取路径
            指针访问，零拷贝
            系统调用 + 内存拷贝
            
            
            内存管理
            操作系统自动管理
            数据库自行管理
            
            
            代码复杂度
            低
            高
            
            
            大文件 TLB 压力
            高
            低（只映射 Buffer Pool）
            
            
            页缺失延迟
            不可预测
            可控（异步 I/O）
            
            
            I/O 错误处理
            SIGBUS，难以恢复
            返回错误码，易于处理
            
            
            回写控制
            无法精确控制
            完全可控
            
            
            异步 I/O
            不支持
            支持（io_uring 等）
            
            
            
            
            

## 三、LMDB 架构

            

### 3.1 设计目标

            

LMDB（Lightning Memory-Mapped Database）由 Howard Chu 从
            2011 年开始开发，最初是为了替代 OpenLDAP 使用的 Berkeley
            DB（BDB）。设计目标非常明确：
            
            
- 极简：不到一万行 C 代码，单个 C 文件 + 一个头文件。
            
- 嵌入式：作为库链接到应用程序中，不是独立服务。
            
- 读性能极高：读操作零拷贝、零分配、无锁。
            
- 崩溃安全：任何时刻断电，数据库不损坏。
            
- 事务支持：完整的 ACID 语义。
            
            

### 3.2 数据文件布局

            

LMDB 使用单个数据文件（默认名
            `data.mdb`）和一个锁文件（`lock.mdb`）。数据文件被划分为固定大小的页（默认
            4096 字节，与操作系统页大小一致）。文件布局如下：
            
```
┌──────────────────────┐  页 0
│   Meta Page 0        │  ← 元数据页 0
├──────────────────────┤  页 1
│   Meta Page 1        │  ← 元数据页 1
├──────────────────────┤  页 2
│   B+Tree 页          │
├──────────────────────┤
│   B+Tree 页          │
├──────────────────────┤
│        ...           │
├──────────────────────┤
│   空闲页             │
├──────────────────────┤
│        ...           │
└──────────────────────┘  最后一页
```

            

### 3.3 两个元数据页

            

LMDB 的核心设计之一是使用两个元数据页（Meta Page 0 和
            Meta Page 1）实现原子提交。每个元数据页包含：
            
            
- 数据库的魔数（Magic Number）和版本号。
            
- B+Tree 根页的页号。
            
- 空闲页列表的根页号。
            
- 当前事务 ID（txnid）。
            
- 数据库大小（已使用的页数）。
            
            
```
// LMDB 元数据页结构（简化）
// 源码：libraries/liblmdb/lmdb.h, MDB_meta
typedef struct MDB_meta {
    uint32_t  mm_magic;       // 魔数：0xBEEFC0DE
    uint32_t  mm_version;     // 格式版本
    MDB_db    mm_dbs[2];      // 主数据库和空闲页数据库的根信息
    pgno_t    mm_last_pg;     // 最后使用的页号
    txnid_t   mm_txnid;       // 事务 ID
} MDB_meta;
```

            

两个元数据页交替更新：事务 N 写 Meta Page 0，事务 N+1 写
            Meta Page 1，事务 N+2 又写 Meta Page
            0。由于元数据页只有几十字节的有效数据，且位于页内对齐的位置，一次写入操作在现代硬件上是原子的（假设扇区写入是原子的，这在
            512 字节和 4KB 扇区的磁盘上通常成立）。
            

数据库启动时，LMDB 读取两个元数据页，选择
            `txnid`
            较大的那个作为当前有效版本。如果最后一次写入在写元数据页时崩溃了，那个元数据页可能是损坏的（校验和不对），LMDB
            就用另一个元数据页——它包含上一次成功提交的状态。
            
```
提交事务 N 的流程：

1. 写入所有修改过的 B+Tree 数据页（CoW 副本）
2. fdatasync()   ← 保证数据页先落盘
3. 写入 Meta Page (N % 2)，包含新的根页号和事务 ID
4. fdatasync()   ← 保证元数据页落盘

崩溃恢复：
- 步骤 1 或 2 崩溃：元数据页未更新，数据库回到事务 N-1 的状态
- 步骤 3 崩溃：元数据页可能损坏，LMDB 使用另一个元数据页，回到事务 N-1
- 步骤 4 之后崩溃：事务 N 已完整提交
```

            

### 3.4
            mmap 语义与 CoW B+Tree 的「只追加 / 不原地改」边界

            

把 LMDB 的持久化语义拆成两层，才能和 RocksDB/SQLite
            对照：
            
            
            
            
            
            
            
            
            层次
            LMDB 行为
            与 mmap 的关系
            
            
            
            
            **已提交树**
            旧 B+Tree
            页永不原地修改；写事务只**追加**新页
            mmap 映射区对读事务是稳定的只读视图
            
            
            **提交点**
            切换 meta 页（txnid 更大的一侧生效）
            读事务绑定的 root **不随写推进而变**
            
            
            **崩溃**
            依赖「数据页先 `fdatasync`，再写 meta 再
            `fdatasync`」
            断电后最多丢失**进行中的写事务**；已提交树仍完整
            
            
            
            

**边界一：不是 WAL 的 redo/undo。** RocksDB
            先写 WAL 再改 MemTable/SST，崩溃靠日志重放；LMDB **无
            WAL**，靠 CoW + 双 meta
            保证「磁盘上总存在一棵完整树」。代价是随机小写要写整条
            root→leaf 路径（§4.4），而 LSM 可把写批成顺序 WAL。
            

**边界二：不是 SQLite 的 pager 原地更新。**
            SQLite 默认在 B-Tree 页内原地改 cell，靠 WAL
            保证崩溃可恢复；`PRAGMA mmap_size`
            只加速**读**，写仍走 WAL 与 pager（sqlite-billion-rows
            讨论 wal-index 的 mmap 与 Hipp 对 mmap
            读路径的保留态度）。LMDB
            则**禁止**对活跃树页原地写——读无锁与崩溃简单性来自这一约束。
            

**边界三：空闲页回收 vs 读快照。** CoW
            产生的旧页进入 freeDB，只有「最老活跃读事务的 txnid
            之前」的版本才可回收（§3.6）。这是 MVCC
            在**整棵树粒度**上的 GC 规则，与 RocksDB 的
            compaction 或 SQLite 的 vacuum 问题域不同。
            
```
读事务 R：mmap 指针 → root@txnid=5 的子图（只读）
写事务 W：pwrite 新页 → fdatasync → 写 meta@txnid=6 → fdatasync
         旧页 {5,3,7} 进入 freeDB，R 仍合法引用它们
R 结束后：txnid≤5 的旧页才可被 W' 复用
```

            

### 3.5 写时复制 B+Tree

            

LMDB 使用写时复制（Copy-on-Write，CoW）B+Tree
            作为核心数据结构。CoW 的含义是：修改 B+Tree
            中的任何一个节点时，不在原位更新，而是把该节点复制到一个新页上进行修改，然后把父节点的指针指向新页。由于父节点也被修改了，父节点也需要复制——这个过程一直向上传播到根节点。
            

一次写事务中修改一个叶子节点的 CoW 过程：
            
```
修改前：                          修改后：

Meta → Root(页5)                 Meta' → Root'(页20)
        ├── Internal(页3)                 ├── Internal'(页21)
        │   ├── Leaf(页7)                 │   ├── Leaf'(页22)  ← 新数据
        │   └── Leaf(页8)                 │   └── Leaf(页8)    ← 不变，共享
        └── Internal(页4)                 └── Internal(页4)    ← 不变，共享
            ├── Leaf(页9)                     ├── Leaf(页9)
            └── Leaf(页10)                    └── Leaf(页10)

旧页 5, 3, 7 变成空闲页，可以被后续事务复用。
```

            

CoW B+Tree 的关键特性：
            
            
- 旧版本的树始终完整。在新事务的元数据页写入之前，旧的根页和它引用的所有页仍然组成一棵完整、一致的
            B+Tree。
            
- 不需要 WAL。传统的就地更新（In-Place Update）B+Tree 需要
            WAL 来保证崩溃恢复——先写 WAL 记录，再修改数据页。CoW
            不修改任何已有的页，只创建新页，因此不需要 WAL。
            
- 读操作不受写操作影响。读事务看到的是某个元数据页指向的那棵树，这棵树的所有页在读事务期间不会被修改。
            
            

### 3.6 空闲页管理

            

CoW
            每次修改都会产生旧页。这些旧页不能立即回收——可能还有活跃的读事务在引用它们。LMDB
            维护一个空闲页列表（Free Page List），本身也存储在一棵
            B+Tree 中。空闲页列表记录了每个事务释放的页号：
            
```
空闲页数据库（freeDB）：
  txnid=100 → [页5, 页3, 页7]     ← 事务 100 释放的页
  txnid=101 → [页12, 页15]        ← 事务 101 释放的页
  txnid=102 → [页20, 页21, 页22]  ← 事务 102 释放的页
```

            

当一个新的写事务需要分配页时，它首先检查空闲页列表中是否有可用的页。一个旧页只有在所有可能引用它的读事务都已结束后才能被回收。具体来说，如果当前最老的活跃读事务的
            txnid 是 101，那么 txnid=100 释放的页可以安全回收，但
            txnid=101 和 txnid=102 释放的页不行。
            

这个设计有一个重要的工程含义：长时间运行的读事务会阻止空闲页回收，导致数据库文件持续增长。这是
            LMDB 使用中最常见的陷阱之一。
            

### 3.7 单写者/多读者

            

LMDB 采用单写者/多读者（Single-Writer /
            Multi-Reader）模型：
            
            
- 同一时刻只允许一个写事务。写事务之间通过互斥锁（Mutex）串行化。
            
- 读事务不需要任何锁。多个读事务可以并发执行，互不干扰。
            
- 读事务和写事务之间也不互相阻塞。
            
            

这个模型的实现依赖 CoW B+Tree 和两个元数据页：
            
            
- 读事务开始时，读取当前有效的元数据页，获取 B+Tree
            的根页号。之后的所有读操作都沿着这个根页遍历。由于 CoW
            不修改已有的页，读事务看到的树始终是一致的快照。
            
- 写事务在新页上构建修改后的树，不影响任何读事务。写事务提交时，原子地更新元数据页，后续的新读事务看到新版本，已有的读事务继续看到旧版本。
            
            
```
时间线：

读事务 R1 开始 → 看到 Meta(txnid=5) → Root(页100)
                                                          写事务 W1 开始
                                                          修改页，创建新页
                                                          提交：Meta(txnid=6) → Root(页200)
读事务 R1 继续 → 仍然沿 Root(页100) 读取                  写事务 W1 结束
读事务 R2 开始 → 看到 Meta(txnid=6) → Root(页200)
读事务 R1 结束
```

            
            

## 四、LMDB 事务模型

            

### 4.1 MVCC 的实现

            

LMDB 实现了一种简洁的多版本并发控制（Multi-Version
            Concurrency Control，MVCC）。与 PostgreSQL 或 InnoDB 的 MVCC
            不同，LMDB 的多版本不是在每行数据上维护版本链，而是通过 CoW
            B+Tree 在整棵树的粒度上实现版本管理。
            

每次写事务提交，都会产生一棵全新的
            B+Tree（虽然大部分页是共享的）。不同版本的树通过元数据页中的
            `txnid` 区分。读事务在开始时绑定到某个
            `txnid`，之后只访问该版本的树。
            

这种粗粒度的 MVCC 实现带来两个好处：
            
            
- 读事务完全无锁。不需要版本链遍历，不需要可见性判断，不需要垃圾回收（GC）线程。
            
- 读事务看到的快照是天然一致的。不存在幻读（Phantom
            Read）、不可重复读等问题——读事务从头到尾看到的是同一棵树。
            
            

代价是写事务必须串行化。每次只能有一个写事务在修改树，因为
            CoW 的提交需要原子地更新元数据页中的根页号。
            

### 4.2 读事务

            

LMDB 的读事务极其轻量。开启一个读事务只需要做三件事：
            
            
- 在共享的读者表（Reader Table）中注册当前读事务的
            `txnid`。读者表存储在锁文件（`lock.mdb`）中，通过共享内存映射在多进程间共享。
            
- 读取当前有效的元数据页，获取 B+Tree 根页号。
            
- 返回事务句柄。
            
            

整个过程不涉及内存分配、不获取互斥锁、不做任何
            I/O。读事务期间的所有读操作都是指针访问——通过 mmap 直接读取
            B+Tree 节点的内容。
            
```
// 读事务的典型使用模式（C API）
MDB_txn *txn;
MDB_val key, data;

mdb_txn_begin(env, NULL, MDB_RDONLY, &txn);  // 开启只读事务

key.mv_data = "user:1001";
key.mv_size = strlen("user:1001");

int rc = mdb_get(txn, dbi, &key, &data);     // 查询：data.mv_data 直接指向 mmap 区域
if (rc == 0) {
    // data.mv_data 是指向 mmap 内存的指针，零拷贝
    printf("value: %.*s\n", (int)data.mv_size, (char *)data.mv_data);
}

mdb_txn_abort(txn);                           // 结束事务
```

            

注意 `data.mv_data` 返回的指针直接指向 mmap
            映射的内存区域。在事务结束之前，这个指针始终有效，指向的数据不会被修改。事务结束后，指针可能失效——对应的页可能被后续写事务回收。
            

### 4.3 写事务

            

写事务的流程比读事务复杂得多：
            
            
- 获取写互斥锁（每个环境只允许一个写事务）。
            
- 读取当前有效的元数据页。
            
- 开始修改。每次修改 B+Tree
            中的一个页时，先把该页复制到新分配的页上（CoW），在新页上做修改，更新父节点的指针（父节点也需要
            CoW）。
            
- 提交时，先用 `fdatasync()`
            把所有新数据页刷盘，再写入新的元数据页，再
            `fdatasync()` 把元数据页刷盘。
            
- 释放写互斥锁。
            
            
```
// 写事务的典型使用模式
MDB_txn *txn;
MDB_val key, data;

mdb_txn_begin(env, NULL, 0, &txn);            // 开启读写事务

key.mv_data = "user:1001";
key.mv_size = strlen("user:1001");
data.mv_data = "{\"name\":\"Alice\",\"age\":30}";
data.mv_size = strlen(data.mv_data);

mdb_put(txn, dbi, &key, &data, 0);            // 写入

int rc = mdb_txn_commit(txn);                  // 提交：CoW + fdatasync
if (rc != 0) {
    fprintf(stderr, "commit failed: %s\n", mdb_strerror(rc));
}
```

            

### 4.4 写放大分析

            

CoW B+Tree 的写放大（Write
            Amplification）与树的深度成正比。修改一个叶子节点需要复制从叶子到根的整条路径上的所有节点。对于一棵深度为
            D 的 B+Tree，修改一个键值对需要写入 D 个页。
            

典型的 LMDB B+Tree 深度：
            
            
            
            数据量
            页大小
            估计树深度
            单次修改写入页数
            
            
            
            
            100MB
            4KB
            3-4
            3-4
            
            
            1GB
            4KB
            4-5
            4-5
            
            
            10GB
            4KB
            5-6
            5-6
            
            
            100GB
            4KB
            6-7
            6-7
            
            
            
            

加上空闲页列表的更新和元数据页的写入，一次单键写入的实际
            I/O 量大约是 `(D + 2) * page_size`。对于 4KB
            页、深度 5 的树，单次写入大约 28KB。
            

与基于 WAL 的存储引擎相比，CoW B+Tree
            的随机小写入性能较差。WAL
            的写入是顺序追加，可以通过组提交（Group
            Commit）把多个事务的日志批量刷盘。CoW
            的每次提交都需要写多个分散的页，随机 I/O 开销较大。
            

### 4.5 嵌套事务

            

LMDB 支持嵌套事务（Nested
            Transaction）。子事务可以在父事务的上下文中开启，子事务提交后修改对父事务可见，子事务回滚后修改被丢弃：
            
```
MDB_txn *parent_txn, *child_txn;

mdb_txn_begin(env, NULL, 0, &parent_txn);

// 开启子事务
mdb_txn_begin(env, parent_txn, 0, &child_txn);
mdb_put(child_txn, dbi, &key1, &val1, 0);
mdb_txn_commit(child_txn);     // 子事务提交，修改对 parent_txn 可见

// 开启另一个子事务
mdb_txn_begin(env, parent_txn, 0, &child_txn);
mdb_put(child_txn, dbi, &key2, &val2, 0);
mdb_txn_abort(child_txn);      // 子事务回滚，key2 的修改被丢弃

mdb_txn_commit(parent_txn);    // 最终提交：只有 key1 被持久化
```

            

嵌套事务的实现方式是保存点（Savepoint）：子事务开始时记录当前已分配的页号，子事务回滚时把这些页释放回空闲列表。
            
            

## 五、LMDB 编程实战

            

### 5.1 C API 核心对象

            

LMDB 的 C API 围绕四个核心对象设计：
            
            
            
            
            
            
            
            
            
            对象
            类型
            生命周期
            说明
            
            
            
            
            环境（Environment）
            `MDB_env`
            进程级
            管理数据库文件、mmap 映射、锁
            
            
            事务（Transaction）
            `MDB_txn`
            操作级
            读事务或写事务
            
            
            数据库句柄（Database Handle）
            `MDB_dbi`
            环境级
            一个环境可以包含多个命名数据库
            
            
            游标（Cursor）
            `MDB_cursor`
            事务级
            遍历 B+Tree 的迭代器
            
            
            
            

### 5.2 完整的 C 使用示例

            

以下是一个完整的 LMDB
            使用示例，覆盖环境创建、写入、读取、游标遍历：
            
```
#include 
#include 
#include 
#include "lmdb.h"

#define CHECK(rc) do { \
    if ((rc) != MDB_SUCCESS) { \
        fprintf(stderr, "Error: %s (%d) at %s:%d\n", \
                mdb_strerror(rc), rc, __FILE__, __LINE__); \
        exit(1); \
    } \
} while(0)

int main(void) {
    MDB_env *env;
    MDB_txn *txn;
    MDB_dbi dbi;
    MDB_val key, data;
    MDB_cursor *cursor;
    int rc;

    // 1. 创建并配置环境
    CHECK(mdb_env_create(&env));
    CHECK(mdb_env_set_mapsize(env, 1UL 
            

编译和运行：
            
```
mkdir -p testdb
gcc -O2 -o lmdb_demo lmdb_demo.c liblmdb.a -lpthread
./lmdb_demo
```

            

预期输出：
            
```
cherry = 3.00

--- 全部键值对 ---
  apple = 1.20
  banana = 0.50
  cherry = 3.00
  date = 5.50
  elderberry = 8.00
```

            

### 5.3 Go 语言封装示例

            

在 Go 生态中，常用的 LMDB 绑定是
            `github.com/bmatsuo/lmdb-go`（基于 CGo
            封装）。以下是对应的 Go 代码：
            
```
package main

import (
    "fmt"
    "log"

    "github.com/bmatsuo/lmdb-go/lmdb"
)

func main() {
    // 创建环境
    env, err := lmdb.NewEnv()
    if err != nil {
        log.Fatal(err)
    }
    defer env.Close()

    env.SetMapSize(1 
            

### 5.4 常见使用陷阱

            

使用 LMDB 时有几个容易踩的坑：
            

**mapsize 必须预先设定。**
            `mdb_env_set_mapsize()`
            设定的是虚拟地址空间的最大映射大小，不是实际的磁盘空间占用。设太小会导致
            `MDB_MAP_FULL` 错误；设太大在 32
            位系统上会耗尽地址空间。在 64 位系统上，建议设为预期数据量的
            2-5 倍。
            

**读事务必须及时关闭。**
            长时间打开的读事务会阻止空闲页回收，导致数据库文件不断膨胀。一个常见的错误是在
            goroutine 或线程中开启读事务后忘记关闭。
            

**读事务不能跨线程使用。** LMDB
            的读事务和线程绑定。在一个线程中开启的读事务不能在另一个线程中使用。Go
            的 goroutine 调度器可能把 goroutine
            迁移到不同的操作系统线程上，因此在 Go 中使用 LMDB 需要调用
            `runtime.LockOSThread()`。
            

**mdb_get 返回的指针在事务结束后失效。**
            如果需要在事务外使用数据，必须在事务内复制。
            
            

## 六、BoltDB 设计

            

### 6.1 从 LMDB 到 BoltDB

            

BoltDB 是 Ben Johnson 在 2013 年开发的纯 Go
            嵌入式键值存储，设计直接受 LMDB 启发。它的核心思路和 LMDB
            一致：单文件、mmap 读取、CoW B+Tree、单写者/多读者、不使用
            WAL。BoltDB
            的原始仓库（`github.com/boltdb/bolt`）已经归档，目前由
            etcd 社区维护的
            bbolt（`go.etcd.io/bbolt`）是活跃的分支。
            

BoltDB/bbolt 在 etcd 中用作底层存储引擎，负责持久化 etcd
            的键值数据和 Raft 日志。
            

### 6.2 架构对比

            

BoltDB 和 LMDB 在架构上高度相似，但有几个关键差异：
            
```
                LMDB                          BoltDB
语言：          C                             Go
mmap 用途：     只读映射                      读写映射（MAP_SHARED）
元数据页：      2 个元数据页交替              同样 2 个元数据页
写入方式：      pwrite() + fdatasync()        mmap 写 + fdatasync()
空闲页管理：    B+Tree 存储                   freelist 结构体
命名数据库：    支持（MDB_dbi）               支持（Bucket）
嵌套事务：      支持                          不支持
最大数据库：    受 mapsize 限制               受 mapsize 限制
```

            

### 6.3 BoltDB 的 Bucket

            

BoltDB 用 Bucket（桶）的概念替代 LMDB 的命名数据库。每个
            Bucket 是一棵独立的 B+Tree，Bucket 可以嵌套——一个 Bucket
            里可以包含子 Bucket：
            
```
db.Update(func(tx *bbolt.Tx) error {
    // 创建顶层 Bucket
    users, err := tx.CreateBucketIfNotExists([]byte("users"))
    if err != nil {
        return err
    }

    // 在 users Bucket 内创建子 Bucket
    profile, err := users.CreateBucketIfNotExists([]byte("profile"))
    if err != nil {
        return err
    }

    return profile.Put([]byte("name"), []byte("Alice"))
})
```

            

### 6.4 BoltDB 的页布局

            

BoltDB 的页结构与 LMDB 类似，但页头（Page
            Header）的字段有所不同：
            
```
// bbolt 源码：page.go（简化）
type page struct {
    id       pgid     // 页号
    flags    uint16   // 页类型：branchPage / leafPage / metaPage / freelistPage
    count    uint16   // 页内元素数量
    overflow uint32   // 溢出页数量（大键值对可能跨多页）
}
```

            

BoltDB 的页类型包括：
            
            
            
            类型
            值
            用途
            
            
            
            
            `branchPageFlag`
            0x01
            B+Tree 内部节点
            
            
            `leafPageFlag`
            0x02
            B+Tree 叶子节点
            
            
            `metaPageFlag`
            0x04
            元数据页
            
            
            `freelistPageFlag`
            0x10
            空闲页列表
            
            
            
            

### 6.5 BoltDB 的空闲页管理

            

BoltDB 的空闲页管理与 LMDB 不同。LMDB
            把空闲页列表存储在一棵 B+Tree 中，而 BoltDB
            使用一个简单的列表，序列化后存储在一个或多个 freelist
            页中：
            
```
// bbolt 源码：freelist.go（简化）
type freelist struct {
    ids     []pgid            // 已释放且可复用的页号
    pending map[txid][]pgid   // 已释放但还有读事务引用的页号
    cache   map[pgid]bool     // 查找缓存
}
```

            

这个设计在页数不多时简单高效，但在数据库很大、空闲页很多时，freelist
            的序列化和反序列化会成为性能瓶颈。bbolt 后来引入了
            `FreelistType: FreelistMapType` 选项，使用
            HashMap 替代有序数组来优化空闲页分配。
            

### 6.6 BoltDB 的写入路径

            

BoltDB 的写事务提交流程：
            
```
1. 平衡 B+Tree（rebalance）：合并过小的节点
2. 分裂 B+Tree（spill）：分裂过大的节点，分配新页
3. 释放旧页到 freelist.pending
4. 序列化 freelist 到 freelist 页
5. 写入所有脏页到 mmap 区域
6. fdatasync()
7. 写入元数据页
8. fdatasync()
```

            

### 6.7 etcd 中的 BoltDB

            

etcd 使用 bbolt 作为底层持久化存储。etcd 的 MVCC 层在
            bbolt 之上实现了自己的版本管理：每个键的每个版本都存储为
            bbolt 中的一个键值对，键的格式是
            `revision`（全局递增版本号），值是键名、值、创建版本、修改版本等元数据。
            
```
etcd MVCC 层
    │
    ▼
bbolt 事务：
    key = revision(1, 0) → {key: "/foo", value: "bar", create_rev: 1, mod_rev: 1}
    key = revision(2, 0) → {key: "/foo", value: "baz", create_rev: 1, mod_rev: 2}
    key = revision(3, 0) → {key: "/bar", value: "qux", create_rev: 3, mod_rev: 3}
```

            

etcd 的压缩（Compaction）操作会删除旧版本的键值对，对应
            bbolt 层面的 `Delete` 操作。
            
            

## 七、BadgerDB

            

### 7.1 设计动机

            

BadgerDB 是 Dgraph Labs 从 2017 年开始开发的 Go
            嵌入式键值存储。与 LMDB 和 BoltDB 的 B+Tree
            路线不同，BadgerDB 采用 LSM-Tree（Log-Structured
            Merge-Tree）架构。它的设计直接受 WiscKey 论文（“WiscKey:
            Separating Keys from Values in SSD-Conscious Storage”，Lu et
            al., USENIX FAST
            2016）启发，核心思想是把键和值分开存储：
            
            
- 键和值的元数据存储在 LSM-Tree 中。
            
- 值本身存储在单独的值日志（Value Log，简称
            vLog）中。
            
            
```
传统 LSM-Tree（如 RocksDB）：
  MemTable → SSTable L0 → SSTable L1 → ... → SSTable Ln
  每个 SSTable 包含完整的 key-value 对

BadgerDB（WiscKey 分离）：
  MemTable → SSTable L0 → SSTable L1 → ... → SSTable Ln
  SSTable 只存储 key + value_pointer
  值存储在独立的 Value Log 文件中
```

            

### 7.2 值分离的好处

            

值分离（Key-Value Separation）的核心好处是降低 LSM-Tree
            压缩（Compaction）的写放大。在传统 LSM-Tree
            中，压缩需要读取旧 SSTable 中的所有键值对，按键排序后写入新
            SSTable。如果值很大（例如几 KB 到几 MB），压缩的 I/O
            量主要由值的大小决定。
            

值分离后，SSTable 中只存储键和值指针（通常 16-32
            字节），压缩时搬运的数据量大幅减少。值只在值日志中写入一次（追加写入），不参与
            LSM-Tree 的压缩过程。
            

写放大对比（假设值大小 1KB，10 层 LSM-Tree，放大因子
            10）：
            
            
            
            
            
            
            
            
            方案
            压缩写放大
            说明
            
            
            
            
            传统 LSM-Tree
            约 10 倍
            每层压缩搬运完整键值对
            
            
            WiscKey 值分离
            约 10 倍（键） + 1 倍（值）
            键的写放大不变，但键很小；值只写一次
            
            
            
            

当值大小远大于键大小时，值分离的写放大优势非常明显。
            

### 7.3 值日志与垃圾回收

            

值分离引入了一个新问题：值日志中的旧值如何清理？当一个键被更新或删除时，LSM-Tree
            中的旧条目最终会被压缩清理，但值日志中的旧值仍然占据空间。
            

BadgerDB 通过值日志垃圾回收（Value Log
            GC）解决这个问题：
            
            
- 选择一个旧的值日志文件。
            
- 扫描文件中的每个值条目。
            
- 查询
            LSM-Tree，检查该条目对应的键是否仍然指向这个值日志位置。
            
- 如果是，把值重新写入当前活跃的值日志文件。
            
- 如果不是，丢弃。
            
- 旧的值日志文件整体删除。
            
            
```
值日志 GC 流程：

旧值日志文件（vlog.0001）：
  [key=a, val=100] [key=b, val=200] [key=c, val=300]

LSM-Tree 中的当前状态：
  key=a → vlog.0003:offset=500  （已更新，指向更新的 vlog）
  key=b → vlog.0001:offset=100  （仍有效）
  key=c → (已删除)

GC 后：
  key=b 的值被拷贝到当前 vlog
  vlog.0001 被删除
```

            

值日志 GC 的代价是需要额外的读 I/O（扫描旧值日志）和写
            I/O（重写有效值）。如果值日志中大部分值仍然有效，GC
            的效率很低。
            

### 7.4 BadgerDB 的事务模型

            

BadgerDB 支持可序列化快照隔离（Serializable Snapshot
            Isolation，SSI）级别的事务。与 LMDB
            的单写者模型不同，BadgerDB
            允许多个并发写事务，通过乐观并发控制（Optimistic Concurrency
            Control，OCC）检测冲突：
            
```
db.Update(func(txn *badger.Txn) error {
    // 读取
    item, err := txn.Get([]byte("balance"))
    if err != nil {
        return err
    }

    var balance int
    item.Value(func(val []byte) error {
        balance = parseBalance(val)
        return nil
    })

    // 修改
    balance += 100
    return txn.Set([]byte("balance"), []byte(fmt.Sprintf("%d", balance)))
})
```

            

如果两个并发写事务修改了同一个键，提交时会检测到冲突（通过比较事务开始时的版本号和当前版本号），其中一个事务会收到
            `ErrConflict` 错误，需要重试。
            

### 7.5 BadgerDB 的使用场景

            

BadgerDB 在
            Dgraph（分布式图数据库）中用作底层存储引擎。它适合的场景包括：
            
            
- 值较大（几 KB 到几 MB）的键值存储。
            
- 写入量大的工作负载（值分离降低了写放大）。
            
- 需要并发写事务的场景（OCC 允许多个写事务并发）。
            
            

不适合的场景包括：
            
            
- 值很小的键值存储（值分离的额外指针开销反而增加了空间占用）。
            
- 范围扫描密集型工作负载（范围扫描需要从值日志中随机读取值，破坏了顺序访问模式）。
            
            
            

## 八、LMDB vs
            BoltDB vs BadgerDB 对比

            

### 8.1 架构层面

            
            
            
            
            
            
            
            
            
            维度
            LMDB
            BoltDB (bbolt)
            BadgerDB
            
            
            
            
            语言
            C
            Go
            Go
            
            
            数据结构
            CoW B+Tree
            CoW B+Tree
            LSM-Tree + vLog
            
            
            读取方式
            mmap 零拷贝
            mmap 零拷贝
            内存表 + SSTable
            
            
            写入方式
            pwrite + fdatasync
            mmap 写 + fdatasync
            WAL + MemTable flush
            
            
            WAL
            无
            无
            有
            
            
            单文件
            是（data.mdb）
            是（.db）
            否（多 SSTable + vLog）
            
            
            代码行数
            约 1 万行 C
            约 5 千行 Go
            约 5 万行 Go
            
            
            
            

### 8.2 并发模型

            
            
            
            维度
            LMDB
            BoltDB
            BadgerDB
            
            
            
            
            写并发
            单写者
            单写者
            多写者（OCC）
            
            
            读并发
            多读者，无锁
            多读者，无锁
            多读者
            
            
            读写互斥
            不互斥
            不互斥
            不互斥
            
            
            事务隔离级别
            快照隔离
            快照隔离
            可序列化快照隔离
            
            
            跨进程访问
            支持
            不支持
            不支持
            
            
            
            

LMDB
            的一个独特优势是支持多进程并发访问同一个数据库文件。多个进程可以同时打开同一个
            `data.mdb`，共享同一份 mmap
            映射，通过锁文件协调写事务。BoltDB 和 BadgerDB
            都只支持单进程内的并发。
            

### 8.3
            写入性能（机制对比，无统一 benchmark）

            

三者的写入延迟差异主要来自数据结构与提交路径，**不宜在没有同环境实测时比较具体微秒数**：
            
            
            
            
            
            
            
            
            引擎
            提交路径要点
            典型瓶颈
            
            
            
            
            **LMDB**
            CoW 路径页 + freeDB + **两次
            `fdatasync`**
            随机页写 + 同步刷盘
            
            
            **BoltDB**
            CoW + freelist 序列化 + mmap 脏页 + **两次
            `fdatasync`**
            同上，freelist 放大
            
            
            **BadgerDB**
            WAL 追加 + MemTable（可选 sync）
            WAL fsync；后台 compaction 另计
            
            
            
            

定性结论：BadgerDB 的单条同步写通常低于 CoW B+Tree 双
            fsync 路径；LMDB/BoltDB 适合**批量写事务**分摊
            fsync。本站未在统一硬件上跑三引擎对比，不在此列 ns/op
            表。
            

### 8.4 读取性能（热数据 vs
            冷数据）

            

**热数据（已在 Page Cache）**：LMDB/BoltDB
            的读路径都是 mmap 指针 + B+Tree 遍历，通常快于 BadgerDB
            的多层 LSM 查找——但具体倍数取决于 key
            分布、树深与是否值分离；本篇不列未实测的 ns/op。
            

**冷数据 / 大库**：当工作集超出内存，Major
            Page Fault 与 TLB Miss 主导延迟；此时 mmap 相对
            `pread` + 固定大小 Buffer Pool
            的优势会缩小甚至反转（见 §9.2 引用的 CIDR 2022
            论文数据，**引用数据，非本站自测**）。
            

范围扫描：B+Tree 叶子链表顺序读通常优于 BadgerDB
            值分离模式下的 vLog 随机读；BadgerDB 关闭值分离后 LSM
            扫描会改善，但仍受层数影响。
            

### 8.5 内存使用

            
            
            
            
            
            
            
            
            
            维度
            LMDB
            BoltDB
            BadgerDB
            
            
            
            
            虚拟地址空间
            mapsize（可能很大）
            mapsize
            较小
            
            
            物理内存（RSS）
            由 Page Cache 决定
            由 Page Cache 决定
            MemTable + Block Cache
            
            
            内存可控性
            低（OS 管理）
            低（OS 管理）
            高（可配置）
            
            
            
            

LMDB 和 BoltDB 的物理内存占用取决于操作系统的 Page Cache
            策略——如果系统内存充裕，热数据会常驻 Page
            Cache；如果内存紧张，操作系统会淘汰 Page Cache
            页。应用程序无法精确控制数据库占用多少物理内存。
            

BadgerDB 的内存占用更可控：MemTable 大小可配置，Block
            Cache（SSTable 数据块的缓存）大小可配置。
            

### 8.6 选型建议

            
            
            
            场景
            推荐
            理由
            
            
            
            
            读多写少，嵌入式
            LMDB
            零拷贝读取，极低读延迟
            
            
            Go 生态，需要简单可靠
            bbolt
            纯 Go，API 简洁
            
            
            写密集型，值较大
            BadgerDB
            LSM-Tree + 值分离，低写放大
            
            
            多进程共享
            LMDB
            唯一支持多进程的选项
            
            
            需要精确控制内存
            BadgerDB
            可配置 MemTable 和 Block Cache
            
            
            一致性要求极高
            LMDB / bbolt
            CoW 设计天然保证一致性
            
            
            
            
            

## 九、mmap 与
            Buffer Pool：外部研究数据

            

### 9.1 测试方法论

            

评估 mmap 性能时需要关注以下指标：
            
            
- **热读取延迟**：数据全部在 Page Cache
            中时的读取延迟。
            
- **冷读取延迟**：数据不在 Page Cache
            中，需要触发 Major Page Fault 的延迟。
            
- **TLB Miss 率**：通过
            `perf stat` 的 `dTLB-load-misses`
            事件监测。
            
- **Page Fault 次数**：通过
            `perf stat` 的 `page-faults`
            事件监测。
            
            

对比 mmap 与 `pread` + Buffer Pool
            时，必须固定：**数据库大小、工作集比例、页大小、随机/顺序比例、CPU
            型号、是否绑核、存储介质**——任一变量变化都可能导致结论反转。下文
            §9.2–9.4 均为 **Crotty et al., CIDR 2022
            引用数据**，不是本站在本机复现的结果。
            

### 9.2 mmap vs pread
            微基准测试

            

以下是一个简单的 mmap vs pread
            随机读取基准测试的设计思路：
            
```
// mmap 随机读取
void bench_mmap_random_read(void *addr, size_t file_size, int num_reads) {
    char buf[4096];
    for (int i = 0; i 
            

不同数据库规模下，Crotty et al.（CIDR 2022）对 mmap 与
            `pread` + Buffer Pool
            的对比结论是**趋势性**的（原文 Figure/Table
            与实验环境见其论文
            §4–5，此处不逐字抄数以免与版本/硬件绑定）：
            
            
            
            
            
            
            
            工作集相对内存
            趋势
            
            
            
            
            数据基本全在 Page Cache
            mmap 随机读通常优于 `pread`（省 syscall
            与拷贝）
            
            
            数据大于内存、随机访问
            TLB Miss 与 major fault 上升，mmap 优势缩小
            
            
            极大库 + 随机读
            二者接近或 Buffer Pool 方案略优（取决于 Buffer Pool
            大小与预取）
            
            
            
            

规律：热数据 mmap 占优；冷数据与大库场景下 mmap 的
            TLB/Page Fault 成本不可忽视——这与 §2.3 的 TLB 讨论一致。
            

### 9.3 TLB Miss 的影响

            

CIDR 2022 论文用 `perf stat` 对比 mmap
            全库映射与固定大小 Buffer Pool
            方案：**在映射范围远大于 TLB 覆盖时，mmap 的
            dTLB-load-misses
            比例可高出数量级**，总耗时随数据库体积上升而恶化。本站未在本环境复现该
            microbenchmark；若需自测，应固定
            `--db-size`、读次数、页大小并记录 CPU
            型号与是否启用 THP，例如：
            
```
perf stat -e dTLB-load-misses,dTLB-loads,page-faults \
  ./your_mmap_bench --db-size=10GB --reads=1000000
```

            

定性结论：Buffer Pool 只映射有限虚拟范围，TLB
            压力可控；mmap 映射整库时 B+Tree 随机跳转会频繁挤掉 TLB
            条目。
            

### 9.4 大页对 mmap
            性能的影响

            

使用 2MB 大页（Huge Pages）可以显著降低 TLB Miss 率（CIDR
            2022 与 LMDB 社区实践均报告这一方向）。配置示例：
            
```
echo 8192 > /proc/sys/vm/nr_hugepages
# 或使用 MAP_HUGETLB / THP（部署需单独评估延迟抖动）
```

            

**趋势**（CIDR 2022，引用）：在相同随机读
            workload 下，2MB 大页相对 4KB 页可明显降低 dTLB miss
            比例并缩短平均读延迟；代价是需要预留连续物理内存，THP
            在碎片化场景可能引入 compaction
            抖动。本站未在本文环境复现具体 miss 率与 us/op 数字。
            

### 9.5 LMDB
            性能：机制约束而非 benchmark 排名

            

LMDB 官方与社区 benchmark 报告过极高的多读者
            QPS，但**高度依赖**「数据已在 Page
            Cache、读事务极短、无并发写、mapsize
            充足」等条件；不同帖子使用的
            CPU、记录大小、线程数不一致，**不可横向排名**。
            

从机制可直接推出的约束（无需 benchmark）：
            
            
- **读扩展**：多读者无锁，只读 mmap 页 ——
            适合只读副本扩展；写者仍单线程。
            
- **写吞吐上限**：每提交两次
            `fdatasync` —— 单条同步写适合低 QPS
            元数据场景；高 QPS 写应合并事务。
            
- **空间**：长寿命读事务阻止 freeDB 回收 ——
            文件膨胀是运维问题，不是「慢」的问题。
            
            

若需与 RocksDB
            或 SQLite 对比，应在本机用相同 key/value 分布跑
            `mdb_stat`/自定义脚本并记录完整环境（CPU、OS、存储、采样次数与指标口径）；本篇不提供未跑过的三引擎数字表。
            

### 9.6 三引擎对比：选型维度

            
            
            
            
            
            
            
            
            
            维度
            LMDB
            bbolt
            BadgerDB
            
            
            
            
            读路径
            mmap B+Tree
            mmap B+Tree
            LSM +（可选）vLog
            
            
            写路径
            CoW + 双 fsync
            CoW + 双 fsync
            WAL + compaction
            
            
            多进程
            支持
            不支持
            不支持
            
            
            与 RocksDB 关系
            对照组（B+Tree mmap）
            etcd 本地元数据
            Dgraph 本地 KV
            
            
            
            

具体 ns/op 取决于 workload；选型见 §8.6 与
            §10，不在此重复未标注环境的 benchmark 表。
            
            

## 十、何时使用 mmap
            存储引擎

            

### 10.1 适合的场景

            

mmap 存储引擎（以 LMDB 为代表）最适合以下场景：
            

**读密集型嵌入式数据库。**
            如果工作负载以读取为主（读写比 10:1 或更高），LMDB
            的零拷贝读取可以提供接近内存数据库的读取性能。典型的例子：配置存储、元数据存储、缓存层。
            

**中小规模数据库。** 当数据库大小在几百 MB
            到几 GB 范围内时，大部分数据可以常驻 Page Cache，mmap 的 TLB
            压力尚可接受。LMDB 在这个规模下的综合性能非常好。
            

**需要多进程共享的场景。** LMDB
            是少数支持多进程并发访问同一个数据库文件的嵌入式存储引擎。多个进程可以同时读取，一个进程写入时不阻塞其他进程的读取。OpenLDAP
            的 `slapd` 就利用了这个特性。
            

**需要极简部署的场景。** LMDB
            是单文件数据库，不需要后台进程、不需要日志文件、不需要配置文件。部署一个
            LMDB 数据库只需要把一个 C 库链接到应用程序中。
            

**需要强一致性保证的场景。** CoW B+Tree
            的设计保证在任何时刻断电，数据库都处于一致状态。不需要额外的崩溃恢复机制，不需要修复工具。etcd
            选择 bbolt 作为底层存储，部分原因就是这个特性。
            

### 10.2 不适合的场景

            

**写密集型工作负载。** CoW B+Tree
            每次写入都需要复制从叶子到根的路径，加上两次
            `fdatasync()`，写入延迟和写放大都不理想。如果写入量很大，LSM-Tree
            引擎（RocksDB、BadgerDB）是更好的选择。
            

**大规模数据库。**
            当数据库大小超过物理内存时，mmap 的 TLB 压力和 Page Fault
            延迟成为主要瓶颈。Andy Pavlo
            等人的研究表明，在数据库大小超过可用内存的场景下，使用
            Buffer Pool + pread 的方案性能优于 mmap。
            

**延迟敏感型系统。** mmap 的 Page Fault
            延迟不可预测——同一个读操作可能在 200 纳秒和 5
            毫秒之间波动。如果系统对尾延迟（p99/p999）有严格要求，mmap
            不是好的选择。
            

**需要精确内存控制的场景。**
            在多租户环境或容器化部署中，通常需要精确控制每个服务的内存使用。mmap
            把内存管理交给操作系统，应用程序无法限制数据库占用的 Page
            Cache 容量。
            

### 10.3 工程建议

            

基于前面的分析，给出以下工程建议：
            

**1. 读事务要短。** LMDB 和 BoltDB
            中，长时间运行的读事务会阻止空闲页回收。设计上应该把读事务控制在毫秒级，避免在读事务中做耗时的计算或网络操作。
            

**2. 批量提交。** 每次写事务的固定开销（两次
            fdatasync）很高。如果写入量大，应该在一个事务中提交多个键值对，分摊
            fdatasync 的开销。
            

**3. mapsize 设置。** 在 64
            位系统上，mapsize 可以设为一个比实际数据大很多的值（比如
            1TB），因为虚拟地址空间是充裕的。但在容器环境中要注意，一些监控工具会把
            mmap 的虚拟地址空间计入内存使用，可能触发 OOM Killer
            的误判。
            

**4. 考虑大页。** 如果数据库在几 GB
            以上且读取性能关键，配置 2MB 大页可以有效降低 TLB Miss
            率。
            

**5. 监控数据库文件增长。** 定期检查 LMDB
            数据库文件的大小和空闲页比例。如果文件持续增长但实际数据量没有增加，说明有长时间运行的读事务阻止了空闲页回收。
            

**6. 注意 Go 的 goroutine 调度。** 在 Go
            中使用 LMDB
            时，读事务必须绑定到操作系统线程（`runtime.LockOSThread()`）。BoltDB/bbolt
            在 API 层面处理了这个问题（`View` 和
            `Update` 方法内部处理了线程绑定），但直接使用
            lmdb-go 需要开发者自己处理。
            

### 10.4 mmap 存储引擎的未来

            

mmap 存储引擎面临的核心挑战来自硬件趋势的变化。NVMe SSD
            的延迟已经降到个位数微秒，Page Fault
            处理的内核开销成为瓶颈。Andy Pavlo
            的研究团队认为，随着存储介质速度的提升，mmap 的 Page Fault
            开销占比会越来越大，Buffer Pool + 异步 I/O
            的方案会更有优势。
            

但在嵌入式数据库的特定场景下——数据量中等、读多写少、追求简单——mmap
            仍然是一个合理的选择。LMDB
            的设计证明了在正确的约束条件下，简单的架构可以提供极好的性能和可靠性。
            
            

## 十一、开放问题

            

**1. 单写者能否扩展。** LMDB/BoltDB 的全局写
            mutex 是正确性约束（CoW + 单 meta
            切换），不是实现疏忽。多写者需要分库、分片，或改用
            LSM（RocksDB/BadgerDB）——**是否存在保持 B+Tree + mmap
            读优势的多写协议**，在 peer-reviewed 文献里仍缺少与
            LMDB 同假设（嵌入式、单文件、无 WAL）的可部署方案。
            

**2. 崩溃一致性与 meta 原子写。** LMDB 假设
            meta 页写入在 512B/4KB 扇区上原子；混合 SMR/ZNS 设备、某些
            copy-on-write
            文件系统或远程块存储上，「单扇区原子」是否仍成立，需要按部署介质单独验证——与
            RocksDB
            依赖 WAL fsync 的假设是不同故障模型。
            

**3. mmap + SIGBUS 的可恢复语义。** Pavlo et
            al.（CIDR 2022）与 SQLite 作者对 mmap 的保留态度（sqlite-billion-rows）指向同一缺口：**读路径触发的
            I/O 错误难以像 `pread` 一样返回
            errno**。LMDB 的全局 SIGBUS
            处理在生产多线程服务里是否足够健壮，缺少形式化论证。
            

**4. 大库 TLB 与异步 I/O 趋势。** 随着 NVMe
            延迟下降，Page Fault 内核路径占比上升；Buffer Pool +
            `io_uring` 能否系统性击败大映射 mmap，在 OLTP
            随机读场景仍依赖 workload 测量——CIDR 2022
            给出的是特定实现与规模下的结论，不能外推为「mmap
            已死」。
            
            

## 参考资料

            

### 论文

            
            
- L. Lu, T. S. Pillai, H. Gopalakrishnan, A. C.
            Arpaci-Dusseau, R. H. Arpaci-Dusseau. *WiscKey:
            Separating Keys from Values in SSD-Conscious Storage.*
            **USENIX FAST**, 2016.
            
- A. Crotty, V. Leis, A. Pavlo. *Are You Sure You Want
            to Use MMAP in Your Database Management System?*
            **CIDR**, 2022.（§9.2–9.4 引用数据出处）
            
- H. Chu. *MDB: A Memory-Mapped Database and Backend
            for OpenLDAP.* OpenLDAP Technical Report, 2012.
            
            

### 源码与官方文档

            
            
- LMDB 0.9.31 源码与文档：http://www.lmdb.tech/doc/
            
- bbolt（etcd-io）：https://github.com/etcd-io/bbolt
            
- BadgerDB v4：https://github.com/dgraph-io/badger
            
- Linux 内核文档：Memory Management — https://www.kernel.org/doc/html/latest/admin-guide/mm/
            
            

### 书籍

            
            
- A. Petrov. *Database Internals.* O’Reilly,
            2019.
            
- M. Gorman. *Understanding the Linux Virtual Memory
            Manager.* Prentice Hall, 2004.
            
            

### 站内对照

            
            
- RocksDB
            工程实践 — WAL + Block Cache 路线
            
- SQLite
            十亿行与 wal-index mmap — WAL 读加速与 mmap
            保留态度
            
- 嵌入式存储引擎对比（下一篇）
            
            
            

**上一篇**: RocksDB
            调优实践 **下一篇**: 嵌入式存储引擎对比
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-12 · storage
                    

### 【存储工程】嵌入式存储引擎对比

                    

当我们提到"数据库"时，多数人首先想到的是 MySQL、PostgreSQL 这类以独立进程运行的数据库服务器。客户端通过网络协议连接到服务器，服务器管理存储、索引、事务和并发控制。然而，还有一类存储系统以库（Library）的形式直接链接到应用进程中，不需要独立的服务器进程，不需要网络通信，不需要序列化和反序列化——…
                

                
                    

2025-08-21 · storage
                    

### 【存储工程】数据完整性：从 fsync 到端到端校验

                    

从 fsync 语义、写屏障与电源故障到静默损坏与端到端校验——建立存储栈各层丢失/损坏认知；算法选型见 checksum 篇，ZFS 实现见 zfs-integrity 篇。
                

                
                    

2025-08-26 · storage
                    

### 【存储工程】ZFS：数据完整性优先的存储栈

                    

ZFS 三层架构、Merkle 端到端校验、CoW、ARC、RAID-Z 与运维；算法选型与 field study 口径见 checksum / data-integrity 篇。
                

                
                    

2025-09-21 · storage
                    

### 【存储工程】校验和与数据完整性

                    

深入分析存储系统中的数据完整性保障——CRC32C、xxHash、SHA-256 的性能对比，静默数据损坏的检测与防护，端到端校验架构设计