# 【存储工程】缓存工程：从 Page Cache 到应用层缓存

来源: https://quant67.com/post/storage/66-cache-engineering/cache-engineering.html
日期: 2025-10-14 |

---

一条 SQL
            查询从应用发出到拿到结果，中间至少经过三层缓存：应用进程内的本地缓存、数据库的缓冲池（Buffer
            Pool）、操作系统的页缓存（Page
            Cache）。每一层都在用内存换时间，试图把数据拦截在离 CPU
            更近的地方，避免请求一路穿透到磁盘。这三层缓存各自有独立的淘汰策略、命中率指标和调优参数，它们之间的协同——或者冲突——直接决定了整个存储栈的性能上限。
            

问题在于，多级缓存的设计远不是”每层都开大一点”这么简单。Page
            Cache 和 Buffer Pool
            的双重缓存会浪费内存；应用层缓存的失效策略一旦设计不当，缓存穿透会在高并发下直接击穿数据库；缓存淘汰算法的选择会导致同样的内存预算下命中率相差
            20%
            以上。更麻烦的是，缓存带来的问题往往在低负载下完全不暴露，只有在流量尖峰或冷启动时才集中爆发。
            

本文从多级缓存的全景开始，逐层拆解 Page Cache、Buffer
            Pool、应用层缓存的机制与调优，对比主流缓存淘汰算法的设计思路与性能特征，然后讨论缓存穿透、击穿、雪崩三类典型问题的防护策略，最后落到缓存预热、大小调优和命中率监控的工程实践。
            
            

**版本说明** 本文涉及的软件版本：Linux 6.x
            内核、MySQL 8.0（InnoDB）、PostgreSQL 16、Redis
            7.x、Caffeine
            3.x。不同版本的默认参数和行为可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、多级缓存的工程意义

            

### 1.1 存储层次与速度鸿沟

            

缓存存在的根本原因是存储层次之间的速度差距。从 CPU
            寄存器到机械硬盘，延迟跨越了七个数量级：
            
```
存储层次                   典型延迟           与 DRAM 的比值
──────────────────────────────────────────────────────────
L1 Cache                   1 ns              0.01x
L2 Cache                   4 ns              0.05x
L3 Cache                   12 ns             0.15x
DRAM                       80 ns             1x
Optane PMem                300 ns            4x
NVMe SSD（随机 4K 读）     ~100 us           1,250x
SATA SSD（随机 4K 读）     ~200 us           2,500x
HDD（随机 4K 读）          ~8 ms             100,000x
```

            

一次 HDD 随机读的延迟，够 CPU 执行数百万条指令。即使是
            NVMe 固态硬盘（Solid State
            Drive，SSD），随机读延迟也比内存慢三个数量级。缓存的工程意义就是用有限的内存资源，把尽可能多的”热”数据拦截在离
            CPU 近的层次，避免请求穿透到慢速存储。
            

### 1.2 多级缓存架构全景

            

一个典型的 Web
            应用的存储读路径，从上到下经过以下缓存层次：
            
```
                    ┌─────────────────────┐
                    │   客户端 / CDN 缓存   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   应用进程本地缓存    │
                    │  （Caffeine / Guava）  │
                    └──────────┬──────────┘
                               │ 未命中
                    ┌──────────▼──────────┐
                    │   分布式缓存          │
                    │  （Redis / Memcached）│
                    └──────────┬──────────┘
                               │ 未命中
                    ┌──────────▼──────────┐
                    │   数据库 Buffer Pool  │
                    │  （InnoDB / PG）      │
                    └──────────┬──────────┘
                               │ 未命中
                    ┌──────────▼──────────┐
                    │   OS Page Cache      │
                    └──────────┬──────────┘
                               │ 未命中
                    ┌──────────▼──────────┐
                    │   块设备 / 磁盘       │
                    └─────────────────────┘
```

            

每一层缓存的设计目标相同——用内存换取更低的访问延迟。但每一层的管理粒度、淘汰策略和一致性保证各不相同。Page
            Cache 以 4KB 页为粒度，由内核全局管理；Buffer Pool 以
            16KB（InnoDB）或
            8KB（PostgreSQL）页为粒度，由数据库进程自行管理；应用层缓存以业务对象为粒度，由应用代码控制失效。
            

### 1.3 多级缓存的核心矛盾

            

多级缓存的设计面临三个核心矛盾：
            

第一，内存重复占用。数据库的 Buffer Pool 和操作系统的
            Page Cache
            默认会对同一份数据各缓存一份，造成双重缓存（Double
            Buffering）。一台 64GB 内存的数据库服务器，如果 Buffer Pool
            分配了 48GB，Page Cache
            又缓存了同样的数据页，实际可用的有效缓存容量远小于物理内存。
            

第二，淘汰策略冲突。不同层次的缓存各自做淘汰决策，互不知晓。Page
            Cache 用类 LRU（Least Recently
            Used，最近最少使用）策略淘汰页面，Buffer Pool 用自己的 LRU
            变体，应用层缓存可能用 W-TinyLFU。一份数据被 Buffer Pool
            认为是热数据保留，但被 Page Cache 淘汰了，下次 Buffer Pool
            淘汰这份数据后再次访问时，就必须走磁盘 I/O。
            

第三，一致性维护成本。应用层缓存与数据库之间没有自动的一致性协议。数据在数据库中更新后，应用层缓存中的旧值如果不主动失效，就会导致读到过期数据。这个问题在分布式环境中更加复杂——多个应用实例的本地缓存如何同步失效？
            

理解这三个矛盾，是后续各节调优讨论的出发点。
            
            

## 二、Page Cache 机制

            

Page Cache 是 Linux
            存储栈中离磁盘最近的一层缓存，由内核透明管理，对应用程序不可见。本系列第
            9 篇已经详细讨论过 Page Cache
            的内部结构和数据路径，本节聚焦于缓存工程视角下的关键机制。
            

### 2.1 基本工作原理

            

Linux
            内核将物理内存划分为固定大小的页（Page），默认大小为
            4KB。当进程通过 `read()`
            系统调用读取文件时，内核先在 Page Cache
            中查找对应的页：命中则直接从内存返回数据，未命中则从块设备读取数据并缓存到
            Page Cache 中。`write()`
            调用默认不直接写磁盘，而是将数据写入 Page Cache
            中的页并标记为脏页（Dirty
            Page），由内核的回写线程（Writeback
            Thread）在后台异步刷盘。
            

Page Cache 的组织结构以文件的 `address_space`
            为索引。每个打开的文件在内核中对应一个
            `inode`，`inode` 关联一个
            `address_space` 结构，`address_space`
            内部用 XArray（早期内核使用基数树 Radix
            Tree）维护文件偏移量到缓存页的映射。查找一个缓存页的时间复杂度为
            O(log n)。
            

### 2.2 预读机制

            

Page Cache
            的性能不只来自缓存命中，还来自预读（Readahead）。内核检测到顺序读模式后，会自动预取后续的数据页到缓存中，使得应用的下一次
            `read()` 调用大概率命中缓存。
            

Linux 的预读算法核心逻辑在 `mm/readahead.c`
            中。默认的预读窗口（Readahead Window）从 128KB
            起步，随着连续顺序读的确认逐步扩大，最大可达到
            `read_ahead_kb` 参数指定的值（默认 128KB，可通过
            `/sys/block//queue/read_ahead_kb`
            调整）。
            
```
# 查看当前块设备的预读窗口大小（单位：KB）
cat /sys/block/sda/queue/read_ahead_kb

# 将预读窗口调整为 256KB
echo 256 > /sys/block/sda/queue/read_ahead_kb
```

            

预读对顺序 I/O
            密集型场景（如数据仓库扫描、日志处理、备份）效果显著，但对随机
            I/O 场景（如 OLTP
            数据库）反而有害——预读的数据没有被访问就被淘汰，白白占用内存并浪费磁盘带宽。数据库通常使用直接
            I/O（Direct I/O）绕过 Page
            Cache，就是为了避免预读带来的干扰。
            

### 2.3 脏页回写

            

写操作进入 Page Cache
            后，数据处于”脏”状态，尚未持久化到磁盘。内核通过以下参数控制脏页回写的时机：
            
```
参数                              默认值     含义
──────────────────────────────────────────────────────────────────
vm.dirty_ratio                    20%       脏页占可用内存的比例上限；
                                            超过时触发同步回写，阻塞写入进程
vm.dirty_background_ratio         10%       脏页占可用内存的比例；
                                            超过时触发后台异步回写
vm.dirty_expire_centisecs         3000      脏页在内存中停留的最长时间（单位：厘秒，
                                            即 30 秒）；超时的脏页会被后台线程刷盘
vm.dirty_writeback_centisecs      500       后台回写线程的唤醒周期（单位：厘秒，
                                            即每 5 秒唤醒一次检查脏页）
```

            

这些参数的取值直接影响写入延迟和数据安全性之间的平衡。`dirty_ratio`
            设得太高，断电时丢失的数据量更大；设得太低，写入操作更容易被同步回写阻塞。对于数据库服务器，通常建议降低
            `dirty_ratio` 和
            `dirty_background_ratio`，避免大量脏页堆积导致的突发刷盘（Writeback
            Storm）。
            
```
# 数据库服务器推荐的脏页参数
sysctl -w vm.dirty_ratio=5
sysctl -w vm.dirty_background_ratio=2
```

            

### 2.4 内存回收与 Page
            Cache 淘汰

            

当系统内存不足时，内核的内存回收机制（Memory
            Reclaim）会回收 Page Cache 中的页面。Linux
            使用双链表结构——活跃链表（Active
            List）和非活跃链表（Inactive List）——实现类 LRU
            淘汰。页面首次被缓存时进入非活跃链表，被再次访问后晋升到活跃链表。回收时优先淘汰非活跃链表尾部的页面。
            

这个机制与数据库 Buffer Pool 的淘汰策略会产生冲突。假设
            InnoDB 的 Buffer Pool 保留了某些热数据页，但 Page Cache
            层并不知道这些页”正被上层使用”——如果内存紧张，Page Cache
            可能淘汰这些页在文件系统层面的缓存副本。当 Buffer Pool
            最终淘汰这些页后再次读取时，就需要走磁盘 I/O。使用 O_DIRECT
            绕过 Page Cache
            可以避免这种双重缓存问题，这也是大多数数据库引擎的默认做法。
            

可以通过 `/proc/meminfo` 观察 Page Cache
            的状态：
            
```
# 查看 Page Cache 相关内存指标
grep -E "^(Cached|Buffers|Dirty|Writeback|Active\(file\)|Inactive\(file\))" /proc/meminfo
```

            
```
Buffers:          234516 kB
Cached:         12847392 kB
Dirty:             18432 kB
Writeback:             0 kB
Active(file):    8392764 kB
Inactive(file):  4219840 kB
```

            

`Cached` 表示当前 Page Cache
            占用的内存总量，`Dirty`
            表示尚未刷盘的脏页大小，`Active(file)` 和
            `Inactive(file)`
            分别对应活跃和非活跃文件页的大小。
            

### 2.5 Page Cache 的局限

            

Page Cache 的设计目标是通用文件 I/O
            加速，但在数据库场景下有几个显著局限：
            

第一，淘汰粒度太粗。Page Cache
            的淘汰决策基于页面级别的访问时间，无法区分”一个页面里只有一行被频繁访问”和”整个页面都被频繁访问”。数据库引擎对数据的访问模式有更精细的理解，可以做出更优的淘汰决策。
            

第二，无法感知事务语义。Page Cache
            不知道哪些脏页属于已提交事务、哪些属于未提交事务。数据库需要自己维护
            WAL（Write-Ahead Log，预写式日志）来保证崩溃一致性，Page
            Cache
            的异步回写机制无法满足事务持久性（Durability）要求。
            

第三，全局竞争。Page Cache
            是系统全局共享的，数据库进程的缓存页和其他进程的缓存页混在一起。一个
            `find /`
            命令扫描整个文件系统产生的缓存页，可能把数据库的热数据挤出去。
            

这些局限是数据库引擎选择自建 Buffer Pool 而非依赖 Page
            Cache 的根本原因。
            
            

## 三、Buffer Pool

            

数据库引擎不满足于操作系统提供的通用缓存，选择在用户态自行管理缓冲池。Buffer
            Pool 的设计目标是：用数据库自己对访问模式的理解，做出比 Page
            Cache 更精准的缓存决策。
            

### 3.1 InnoDB Buffer Pool

            

InnoDB 是 MySQL 的默认存储引擎，其 Buffer Pool
            是整个引擎的性能核心。Buffer Pool 以 16KB
            页为粒度缓存数据页和索引页，默认大小由
            `innodb_buffer_pool_size` 参数控制。
            

#### 内存结构

            

InnoDB Buffer Pool 的内存区域包含以下组成部分：
            
```
┌──────────────────────────────────────────────────────┐
│                  Buffer Pool Instance                │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           数据页 / 索引页缓存                    │  │
│  │        （占 Buffer Pool 的绝大部分）              │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Change Buffer │  │ Adaptive Hash│  │ Lock Info  │ │
│  │ （插入缓冲）  │  │ Index（AHI） │  │ （锁信息） │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                      │
│  LRU List ─── Flush List ─── Free List               │
└──────────────────────────────────────────────────────┘
```

            

Buffer Pool 内部维护三条链表：
            
            
- **空闲链表**（Free
            List）：尚未被使用的空闲页。
            
- **LRU 链表**（LRU
            List）：按访问时间排序的已使用页，用于淘汰决策。
            
- **刷新链表**（Flush
            List）：包含脏页的链表，按页面第一次变脏的 LSN（Log Sequence
            Number，日志序列号）排序，用于刷盘决策。
            
            

#### 改进的 LRU 算法

            

InnoDB 的 LRU 链表不是简单的标准
            LRU，而是将链表分成两段：
            
```
LRU List
┌───────────────────────────────────────────────────────┐
│  young 区域（热端）  │  midpoint  │  old 区域（冷端）  │
│      5/8             │     插入点  │      3/8          │
│  ← 最近访问的页      │            │    新加载的页 →     │
└───────────────────────────────────────────────────────┘
```

            

新读入 Buffer Pool 的页不会直接插入链表头部，而是插入
            midpoint 位置（默认距离链表尾部 3/8 处，由
            `innodb_old_blocks_pct` 参数控制，默认值
            37）。这个设计解决了全表扫描（Full Table Scan）污染 Buffer
            Pool 的问题——扫描读入的大量数据页进入 old
            区域，如果在短时间内没有被再次访问，就会从尾部被淘汰，不会影响
            young 区域中的热数据。
            

只有当 old 区域的页在停留超过
            `innodb_old_blocks_time`（默认 1000
            毫秒）后被再次访问，才会被移动到 young
            区域的头部。这个时间窗口进一步过滤了扫描操作产生的短暂访问。
            
```
-- 查看 Buffer Pool 状态
SHOW ENGINE INNODB STATUS\G

-- 关键指标
-- Buffer pool hit rate: 命中率，正常应 > 99.9%
-- Pages made young / not young: 页面在 young 和 old 区域之间的移动
-- LRU len: LRU 链表长度
```

            

#### Buffer Pool 大小配置

            

`innodb_buffer_pool_size` 是 InnoDB
            最关键的调优参数。一般建议：
            
            
- 专用数据库服务器：设为物理内存的 70-80%。
            
- 共享服务器：根据数据库实际工作集大小和其他进程的内存需求综合判断。
            
            
```
-- 动态调整 Buffer Pool 大小（MySQL 5.7+）
SET GLOBAL innodb_buffer_pool_size = 48 * 1024 * 1024 * 1024;  -- 48GB
```

            

MySQL 8.0 支持在线调整 Buffer Pool
            大小，但调整过程中会有短暂的性能波动。调整时以
            `innodb_buffer_pool_chunk_size`（默认
            128MB）为粒度扩展或收缩。
            

#### 多实例并行

            

当 Buffer Pool 超过 1GB
            时，建议将其划分为多个实例以减少并发访问时的互斥锁竞争：
            
```
# my.cnf
[mysqld]
innodb_buffer_pool_size = 48G
innodb_buffer_pool_instances = 16  # 每个实例 3GB
```

            

每个实例拥有独立的 LRU 链表、Free List 和 Flush
            List，减少了多线程并发读写 Buffer Pool 时的锁争用。
            

### 3.2 PostgreSQL Shared
            Buffers

            

PostgreSQL 的缓冲池称为共享缓冲区（Shared
            Buffers），设计思路与 InnoDB Buffer Pool
            类似但有显著差异。
            

#### 基本结构

            

PostgreSQL 的 Shared Buffers 以 8KB 页为粒度（与
            PostgreSQL 的默认块大小一致），使用哈希表（Hash
            Table）实现缓冲区标签（Buffer Tag）到缓冲区描述符（Buffer
            Descriptor）的映射。每个缓冲区描述符记录了页面的引用计数（Pin
            Count）和使用计数（Usage Count），用于淘汰决策。
            

#### Clock-Sweep 淘汰算法

            

PostgreSQL 没有使用 LRU
            链表，而是采用时钟扫描（Clock-Sweep）算法。每个缓冲区有一个使用计数器（Usage
            Count），每次被访问时计数器加一（上限为
            5）。当需要淘汰页面时，时钟指针顺序扫描缓冲区数组，每扫过一个页面将其使用计数减一，直到找到计数为零的页面进行替换。
            
```
Clock-Sweep 算法示意：

时钟指针 →  [3] [1] [0] [2] [5] [0] [1] [0] [3]
                          ↑                   
                    计数为 0，替换此页
```

            

这种算法的优点是实现简单、不需要维护排序链表、没有链表操作的锁开销。缺点是淘汰精度不如
            LRU——使用计数只能粗略反映访问频率，无法精确捕捉访问时间的先后关系。
            

#### Shared Buffers
            大小配置

            

PostgreSQL 的 `shared_buffers`
            参数默认值非常保守（128MB），通常需要调大。但与 InnoDB
            不同，PostgreSQL 更依赖操作系统的 Page Cache，因此
            `shared_buffers` 不应设得过大。
            
```
# postgresql.conf
shared_buffers = 8GB          # 推荐：物理内存的 25%
effective_cache_size = 48GB   # 告知查询优化器可用的总缓存大小
                              # （Shared Buffers + OS Page Cache）
```

            

`effective_cache_size`
            不分配实际内存，只影响查询计划器对索引扫描与顺序扫描的成本估算。设得太小会导致优化器倾向于顺序扫描。
            

### 3.3 双重缓存问题

            

InnoDB 默认使用 O_DIRECT 打开数据文件，绕过 Page
            Cache，避免双重缓存。但 InnoDB 的日志文件（redo
            log）和系统表空间文件在某些配置下仍然经过 Page Cache。
            

PostgreSQL 默认不使用 O_DIRECT，所有数据页同时存在于
            Shared Buffers 和 Page Cache 中。这意味着一台 64GB 内存的
            PostgreSQL 服务器，如果 `shared_buffers` 设为
            16GB，同样的 16GB 数据可能在 Page Cache
            中还有一份副本，有效缓存容量并没有翻倍。
            
            
            
            特性
            InnoDB Buffer Pool
            PostgreSQL Shared Buffers
            
            
            
            
            页大小
            16KB
            8KB
            
            
            默认大小
            128MB
            128MB
            
            
            推荐大小
            物理内存的 70-80%
            物理内存的 25%
            
            
            淘汰算法
            改进 LRU（young/old 分区）
            Clock-Sweep
            
            
            使用 O_DIRECT
            是（数据文件）
            否（默认）
            
            
            双重缓存
            基本避免
            存在
            
            
            在线调整大小
            支持（MySQL 8.0+）
            需要重启
            
            
            多实例
            支持
            不支持
            
            
            
            

### 3.4 Buffer Pool 预热

            

数据库重启后 Buffer Pool
            是空的，所有数据页都需要从磁盘重新加载。这个冷启动过程可能持续几十分钟甚至数小时，期间数据库的查询延迟会显著升高。
            

InnoDB 提供了 Buffer Pool 预热功能：关闭时将 Buffer Pool
            中的页面列表（不是数据本身）转储到磁盘，重启后根据列表重新加载页面。
            
```
# my.cnf
[mysqld]
innodb_buffer_pool_dump_at_shutdown = ON   # 关闭时转储
innodb_buffer_pool_load_at_startup = ON    # 启动时加载
innodb_buffer_pool_dump_pct = 75           # 转储最近使用的 75% 的页面
```

            

PostgreSQL 没有内置的 Shared Buffers 预热功能，但可以使用
            `pg_prewarm`
            扩展手动将特定表或索引加载到缓冲区：
            
```
-- 安装 pg_prewarm 扩展
CREATE EXTENSION pg_prewarm;

-- 将 orders 表预加载到 Shared Buffers
SELECT pg_prewarm('orders');

-- 将 orders 表的主键索引预加载到 Shared Buffers
SELECT pg_prewarm('orders_pkey');
```

            
            

## 四、应用层缓存

            

Page Cache 和 Buffer Pool
            属于存储栈内部的缓存，对应用代码透明。应用层缓存由开发者显式管理，缓存的是业务对象而非原始数据页，粒度更粗但更贴近业务访问模式。
            

### 4.1 本地缓存

            

本地缓存（Local
            Cache）运行在应用进程内存中，访问延迟与一次哈希表查找相当（纳秒级）。常见的
            Java 本地缓存库包括 Caffeine、Guava Cache 和 Ehcache。
            

#### Caffeine

            

Caffeine 是目前 Java 生态中性能最优的本地缓存库，其核心是
            W-TinyLFU 淘汰算法（后文详述）。基本使用方式：
            
```
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Cache;

Cache userCache = Caffeine.newBuilder()
    .maximumSize(10_000)                   // 最大缓存条目数
    .expireAfterWrite(Duration.ofMinutes(5)) // 写入后 5 分钟过期
    .recordStats()                          // 启用统计（命中率等）
    .build();

// 手动加载
User user = userCache.get(userId, key -> userService.loadFromDB(key));

// 查看命中率
CacheStats stats = userCache.stats();
System.out.println("Hit rate: " + stats.hitRate());
System.out.println("Eviction count: " + stats.evictionCount());
```

            

本地缓存的优点是延迟极低、没有网络开销、不依赖外部服务。缺点是每个应用实例各自维护一份缓存，存在数据一致性问题——实例
            A 更新了数据库，实例 B 的本地缓存中还是旧值。
            

#### 本地缓存的一致性策略

            

解决多实例本地缓存一致性的常见方案：
            

第一，设置较短的过期时间（TTL）。适用于对一致性要求不高的场景，比如商品详情页的展示数据。数据更新后最多等一个
            TTL 周期就会自动失效。
            

第二，通过消息队列广播失效通知。数据更新时，发布一条失效消息到
            Redis Pub/Sub 或
            Kafka，所有实例订阅该消息并主动删除本地缓存中的对应条目。
            

第三，使用版本号。缓存条目携带版本号，每次读取时与数据源的版本号比对，不一致则重新加载。
            

### 4.2 分布式缓存

            

分布式缓存独立于应用进程部署，所有应用实例共享同一份缓存数据，天然解决了一致性问题。代价是每次缓存访问需要一次网络往返（Round-Trip
            Time，RTT），延迟从纳秒级上升到百微秒到毫秒级。
            

#### Redis

            

Redis
            是目前使用最广泛的分布式缓存。单线程事件驱动模型使其在读写简单键值对时具有极高的吞吐量。Redis
            7.0 引入了多线程 I/O，进一步提升了网络 I/O
            密集场景下的性能。
            
```
# Redis 基本缓存操作
# SET 带过期时间
redis-cli SET user:1001 '{"name":"Alice","age":30}' EX 300

# GET
redis-cli GET user:1001

# 查看内存使用
redis-cli INFO memory
```

            

Redis 的内存淘汰策略通过 `maxmemory-policy`
            配置：
            
```
策略                    行为
────────────────────────────────────────────────────────────
noeviction              内存满时拒绝写入，返回错误
allkeys-lru             从所有 key 中用近似 LRU 淘汰
volatile-lru            从设置了过期时间的 key 中用近似 LRU 淘汰
allkeys-lfu             从所有 key 中用近似 LFU 淘汰（Redis 4.0+）
volatile-lfu            从设置了过期时间的 key 中用近似 LFU 淘汰
allkeys-random          从所有 key 中随机淘汰
volatile-random         从设置了过期时间的 key 中随机淘汰
volatile-ttl            淘汰 TTL 最小的 key
```

            

Redis 的 LRU 和 LFU
            都是近似实现：不维护全局排序链表，而是随机采样若干
            key，在样本中选择最该淘汰的。采样数量由
            `maxmemory-samples` 参数控制（默认
            5），增大该值可以提高淘汰精度但增加 CPU 开销。
            

#### Memcached

            

Memcached 使用 Slab
            分配器管理内存，将内存划分为固定大小的 Slab Class，每个
            Class
            存储特定大小范围的对象。这种设计避免了内存碎片，但可能导致
            Slab Calcification——某些 Slab Class 的空间用完而其他 Class
            还有大量空闲。
            

与 Redis 相比，Memcached
            更简单（只支持字符串值）、多线程（天然利用多核）、没有持久化开销。在纯缓存场景下（不需要丰富数据结构），Memcached
            的多线程架构在高并发下的吞吐量可能优于单线程 Redis。
            

### 4.3 多级应用缓存架构

            

实际生产环境通常同时使用本地缓存和分布式缓存，构成两级应用缓存：
            
```
请求 → 本地缓存（L1，Caffeine）
         │ 未命中
         ▼
       分布式缓存（L2，Redis）
         │ 未命中
         ▼
       数据库
         │ 查询结果
         ▼
       回填 L2 → 回填 L1 → 返回响应
```

            

这种架构的关键设计决策：
            

第一，L1 的容量远小于 L2，只缓存最热的数据。典型配置：L1
            缓存 1 万到 10 万条目，L2 缓存千万级条目。
            

第二，L1 的过期时间短于 L2。L1 的 TTL 通常在 1-5 分钟，L2
            的 TTL 在 15-60 分钟。更短的 L1 TTL 限制了一致性窗口。
            

第三，数据更新时先删 L2 再删 L1。或者更常见的做法是只删
            L2，让 L1 自然过期。
            
```
// 两级缓存的读路径示例
public User getUser(String userId) {
    // L1: 本地缓存
    User user = localCache.getIfPresent(userId);
    if (user != null) {
        return user;
    }

    // L2: Redis
    String json = redis.get("user:" + userId);
    if (json != null) {
        user = deserialize(json);
        localCache.put(userId, user);
        return user;
    }

    // L3: 数据库
    user = userDao.findById(userId);
    if (user != null) {
        redis.setex("user:" + userId, 1800, serialize(user));
        localCache.put(userId, user);
    }
    return user;
}
```

            
            

## 五、缓存淘汰算法对比

            

缓存的容量有限，当缓存满时需要淘汰部分条目来为新数据腾出空间。淘汰算法的目标是在有限的空间内最大化命中率。不同算法在命中率、实现复杂度、内存开销之间做出不同的取舍。
            

### 5.1 LRU

            

LRU（Least Recently
            Used，最近最少使用）是最经典的缓存淘汰算法。核心思想：淘汰最长时间没有被访问的条目。
            

实现方式通常是哈希表加双向链表：哈希表提供 O(1)
            的查找能力，双向链表维护访问顺序。每次访问一个条目时将其移动到链表头部，淘汰时移除链表尾部的条目。
            
```
# LRU Cache 的核心实现（Python 示意）
class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, key):
        if key not in self.cache:
            return None
        self.cache.move_to_end(key)
        return self.cache[key]

    def put(self, key, value):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)
```

            

LRU 的优点是实现简单、对具有时间局部性（Temporal
            Locality）的访问模式效果好。缺点是对频率不敏感——一个被频繁访问的热点条目，只要有一段时间没被访问就会被淘汰；而一次性扫描操作会把大量冷数据推到链表头部，驱逐真正的热数据（这就是前面提到的
            InnoDB 要用 young/old 分区解决的问题）。
            

### 5.2 LFU

            

LFU（Least Frequently
            Used，最不经常使用）基于访问频率做淘汰决策：淘汰访问次数最少的条目。
            

LFU 解决了 LRU
            对扫描污染敏感的问题——即使一次性扫描读入大量数据，这些数据的访问频率仍然是
            1，不会驱逐频率更高的热数据。但 LFU 有自己的问题：
            

第一，频率累积导致”缓存污染”。一个条目在历史上被大量访问，但现在已经不再被需要（比如一个过了热度的热搜词），由于累积频率很高，很难被淘汰。
            

第二，新条目冷启动困难。新加入的条目频率为
            1，即使后续会变成热数据，在频率积累起来之前容易被淘汰。
            

第三，维护成本高。需要维护精确的频率计数和按频率排序的数据结构，通常实现为最小堆或多层链表。
            

### 5.3 W-TinyLFU

            

W-TinyLFU 是 Caffeine 缓存库使用的淘汰算法，由 Gil
            Einziger、Roy Friedman 和 Ben Manes 在 2017 年的论文
            “TinyLFU: A Highly Efficient Cache Admission Policy”
            及其后续工作中提出。它结合了 LRU 和 LFU
            的优点，同时用极低的内存开销近似频率统计。
            

#### 架构设计

            

W-TinyLFU 将缓存空间分为两部分：
            
```
┌──────────────┐     ┌─────────────────────────────────────┐
│  Window Cache │     │          Main Cache                 │
│   （~1%）     │     │          （~99%）                    │
│              │     │                                     │
│   LRU 淘汰   │ ──→ │  Probation（~20%） → Protected（~80%）│
│              │ 准入 │     LRU 淘汰          LRU 淘汰      │
│              │ 过滤 │                                     │
└──────────────┘     └─────────────────────────────────────┘
                 ↑
          TinyLFU 频率过滤器
        （Count-Min Sketch）
```

            

Window Cache 使用简单的 LRU，捕获突发的短期热点。当
            Window Cache 淘汰一个条目时，TinyLFU 准入过滤器（Admission
            Filter）比较该条目与 Main Cache
            中即将被淘汰的条目的访问频率：如果新条目的频率更高，替换旧条目；否则丢弃新条目。
            

#### 频率估计：Count-Min
            Sketch

            

TinyLFU 用 Count-Min
            Sketch（CMS）数据结构近似记录所有访问过的 key 的频率。CMS
            使用多个哈希函数将 key
            映射到一个紧凑的计数器数组中，查询时取所有哈希位置的最小值作为频率估计。
            

CMS 的内存开销极低——每个条目只需要 4 个 bit
            的计数器（频率上限
            15），整个频率统计器的内存占缓存总内存的不到
            1%。为了解决频率累积导致的历史热点无法淘汰的问题，CMS
            定期执行衰减（Aging）：所有计数器除以 2。
            

### 5.4 ARC

            

ARC（Adaptive Replacement Cache，自适应替换缓存）由
            Nimrod Megiddo 和 Dharmendra S. Modha 在 2003 年的论文 “ARC:
            A Self-Tuning, Low Overhead Replacement Cache” 中提出。ZFS
            文件系统使用 ARC 作为其缓存淘汰算法。
            

ARC 维护两个 LRU 链表和两个”幽灵”链表（Ghost List）：
            
```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   B1     │  │    T1    │  │    T2    │  │    B2    │
│ （幽灵） │  │ （最近） │  │ （频繁） │  │ （幽灵） │
│ 记录被   │  │ 只被访问 │  │ 被访问   │  │ 记录被   │
│ T1淘汰的 │  │ 过一次的 │  │ 过多次的 │  │ T2淘汰的 │
│ key      │  │ 数据页   │  │ 数据页   │  │ key      │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
                    ↑                ↑
              缓存空间在 T1 和 T2 之间自适应分配
```

            
            
- **T1**：存放只被访问过一次的页面（最近性缓存）。
            
- **T2**：存放被访问过两次及以上的页面（频率缓存）。
            
- **B1**：T1 淘汰的页面的
            key（幽灵条目，不存储实际数据）。
            
- **B2**：T2 淘汰的页面的 key。
            
            

ARC 的自适应机制：当一个访问命中 B1（被 T1
            淘汰的页面又被访问了），说明 T1 太小了，应该给 T1
            更多空间；当一个访问命中 B2，说明 T2 太小了。ARC 根据 B1 和
            B2 的命中情况动态调整 T1 和 T2
            的大小比例，无需手动配置。
            

### 5.5 CLOCK

            

CLOCK 算法是 LRU
            的一种近似实现，用循环数组和一个时钟指针替代了双向链表。每个缓存条目有一个引用位（Reference
            Bit）：被访问时设为
            1。当需要淘汰时，时钟指针顺序扫描，遇到引用位为 1
            的条目将其清零并跳过，遇到引用位为 0 的条目则淘汰。
            

CLOCK
            的优点是实现简单、无需链表操作、并发友好。PostgreSQL 的
            Shared Buffers 就使用 Clock-Sweep（CLOCK 的变体，用多 bit
            计数器替代单 bit 引用位）。缺点是淘汰精度不如
            LRU——所有”最近被访问过”的条目在 CLOCK
            看来是等价的，无法区分”一秒前访问”和”一分钟前访问”。
            

### 5.6 算法对比

            
            
            
            
            
            
            
            
            
            
            
            
            算法
            命中率
            扫描抗性
            内存开销
            实现复杂度
            自适应能力
            典型使用者
            
            
            
            
            LRU
            中等
            差
            低（链表指针）
            低
            无
            Memcached、Redis（近似）
            
            
            LFU
            较高
            好
            中（频率计数）
            中
            无
            Redis 4.0+（近似）
            
            
            W-TinyLFU
            高
            好
            低（CMS）
            高
            部分（窗口自适应）
            Caffeine
            
            
            ARC
            高
            好
            中（幽灵链表）
            高
            强（自适应 T1/T2）
            ZFS
            
            
            CLOCK
            中等
            差
            极低（引用位）
            低
            无
            PostgreSQL
            
            
            
            
            

**工程判断**：对于大多数应用层缓存场景，W-TinyLFU（Caffeine）是当前综合表现最好的选择——命中率接近
            ARC，内存开销远低于 ARC，且不受 ARC 专利限制（IBM 持有 ARC
            专利，2023 年已过期）。对于数据库 Buffer
            Pool，引擎自带的定制算法（InnoDB 的 young/old
            LRU、PostgreSQL 的
            Clock-Sweep）已经针对数据库访问模式做了优化，通常不需要替换。
            
            
            

## 六、缓存穿透、击穿与雪崩

            

缓存的设计假设是”大多数请求命中缓存”。当这个假设被打破时，大量请求直接打到后端数据源，可能引发连锁故障。根据打破方式的不同，分为穿透、击穿和雪崩三类。
            

### 6.1 缓存穿透

            

缓存穿透（Cache
            Penetration）指查询一个缓存和数据库中都不存在的数据。每次查询都穿过缓存直达数据库，缓存形同虚设。
            

典型场景：恶意请求使用不存在的 ID（如负数 ID
            或随机字符串）反复查询接口，绕过缓存层直接压到数据库。
            

#### 防护策略一：缓存空值

            

查询数据库发现数据不存在时，仍然在缓存中写入一个空值标记，设置较短的过期时间。后续相同的查询命中缓存中的空值标记，直接返回”不存在”，不再查库。
            
```
public User getUser(String userId) {
    // 检查缓存
    ValueWrapper cached = redis.get("user:" + userId);
    if (cached != null) {
        return cached.isNull() ? null : cached.getValue();
    }

    // 查数据库
    User user = userDao.findById(userId);
    if (user != null) {
        redis.setex("user:" + userId, 1800, serialize(user));
    } else {
        // 缓存空值，过期时间设短（如 60 秒）
        redis.setex("user:" + userId, 60, NULL_MARKER);
    }
    return user;
}
```

            

局限：如果攻击者使用每次不同的随机
            key，缓存空值无效——每个 key
            只会被查询一次，缓存的空值永远不会被命中，反而浪费缓存空间。
            

#### 防护策略二：布隆过滤器

            

布隆过滤器（Bloom
            Filter）是一种空间高效的概率性数据结构，用于判断一个元素是否”可能存在”于集合中。将所有合法
            key
            预加载到布隆过滤器中，查询前先过滤器判断——如果过滤器说不存在，那一定不存在，直接返回；如果说可能存在，再查缓存和数据库。
            
```
请求 → 布隆过滤器判断 key 是否可能存在
         │
        / \
  不存在   可能存在
    │         │
  直接返回   查缓存 → 查数据库
```

            

布隆过滤器的误判率（False Positive
            Rate）可以通过调整过滤器大小和哈希函数数量来控制。对于 1
            亿个 key，使用约 120MB 内存可以将误判率控制在 1% 以下。
            
```
# Redis 内置的布隆过滤器（需要 RedisBloom 模块）
# 创建布隆过滤器，误判率 0.01，预期元素数量 1000000
redis-cli BF.RESERVE user_filter 0.01 1000000

# 添加元素
redis-cli BF.ADD user_filter user:1001

# 检查元素是否存在
redis-cli BF.EXISTS user_filter user:9999
```

            

### 6.2 缓存击穿

            

缓存击穿（Cache Breakdown，也称 Hot Key
            Expiration）指一个热点 key
            在缓存中过期的瞬间，大量并发请求同时涌入数据库查询该 key
            对应的数据。每个请求都发现缓存未命中，都去查数据库并回填缓存，导致数据库在短时间内承受巨大压力。
            

与缓存穿透不同，击穿涉及的是真实存在且被高频访问的数据——问题出在缓存过期的时间窗口。
            

#### 防护策略一：互斥锁

            

使用分布式锁确保同一时刻只有一个请求去加载数据，其他请求等待或返回旧值。
            
```
public User getUser(String userId) {
    String cacheKey = "user:" + userId;
    String lockKey = "lock:user:" + userId;

    User user = redis.get(cacheKey);
    if (user != null) {
        return user;
    }

    // 尝试获取分布式锁（SET NX EX）
    boolean locked = redis.set(lockKey, "1", "NX", "EX", 5);
    if (locked) {
        try {
            // 双重检查：获取锁后再查一次缓存
            user = redis.get(cacheKey);
            if (user != null) {
                return user;
            }
            // 查数据库并回填缓存
            user = userDao.findById(userId);
            redis.setex(cacheKey, 1800, serialize(user));
            return user;
        } finally {
            redis.del(lockKey);
        }
    } else {
        // 未获取到锁，短暂等待后重试
        Thread.sleep(50);
        return getUser(userId);
    }
}
```

            

这种方案的代价是引入了锁竞争和重试逻辑，增加了请求延迟。如果加载数据的时间较长（比如需要跨服务调用），等待的请求可能超时。
            

#### 防护策略二：逻辑过期

            

缓存条目不设置物理过期时间（TTL），而是在值中嵌入一个逻辑过期时间戳。读取时检查逻辑过期时间：如果未过期，直接返回；如果已过期，返回旧值的同时异步触发一个后台线程去更新缓存。
            
```
public User getUser(String userId) {
    String cacheKey = "user:" + userId;
    CachedValue cached = redis.get(cacheKey);

    if (cached == null) {
        // 缓存完全不存在，同步加载
        return loadAndCache(userId);
    }

    if (!cached.isLogicallyExpired()) {
        return cached.getValue();
    }

    // 逻辑过期，返回旧值，异步更新
    asyncExecutor.submit(() -> loadAndCache(userId));
    return cached.getValue();
}
```

            

这种方案保证了读请求永远不会阻塞，但代价是在异步更新完成之前，读取到的是过期数据。适用于对一致性要求不高的场景。
            

#### 防护策略三：提前续期

            

在缓存过期之前主动刷新。比如缓存的 TTL 是 30 分钟，当剩余
            TTL 低于 5 分钟时，访问该 key 的请求触发异步更新。这样热点
            key 的缓存永远不会真正过期。
            

### 6.3 缓存雪崩

            

缓存雪崩（Cache
            Avalanche）指大量缓存条目在同一时间段集中过期，导致大量请求同时穿透到数据库。与击穿不同，雪崩影响的不是单个热点
            key，而是大批量 key 的集体失效。
            

常见触发场景：
            
            
- 缓存预热时所有 key
            设置了相同的过期时间，到期后同时失效。
            
- Redis 实例宕机，所有缓存瞬间不可用。
            
            

#### 防护策略一：过期时间加随机偏移

            
```
// 基础过期时间 30 分钟，加 0-5 分钟的随机偏移
int baseTTL = 1800;
int jitter = ThreadLocalRandom.current().nextInt(300);
redis.setex(cacheKey, baseTTL + jitter, value);
```

            

随机偏移将集中过期分散到一个时间窗口内，避免大量 key
            同时失效。
            

#### 防护策略二：多级缓存兜底

            

使用本地缓存（L1）作为分布式缓存（L2）的兜底层。当 L2
            不可用时，L1 仍然可以承接部分请求，降低对数据库的冲击。L1
            的过期时间设置得比 L2 长一些，确保 L2 失效后 L1
            还能覆盖一段时间。
            

#### 防护策略三：熔断与限流

            

当缓存大面积失效导致数据库压力飙升时，应用层的熔断器（Circuit
            Breaker）自动触发降级：对非核心查询直接返回默认值或错误，只允许核心查询通过。配合限流（Rate
            Limiting）控制到数据库的并发查询数。
            
```
// Resilience4j 熔断器配置示例
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .failureRateThreshold(50)        // 失败率超过 50% 触发熔断
    .waitDurationInOpenState(Duration.ofSeconds(30))  // 熔断 30 秒
    .slidingWindowSize(100)          // 统计窗口大小
    .build();
```

            

### 6.4 三类问题对比

            
            
            
            
            
            
            
            
            
            问题类型
            触发条件
            影响范围
            核心防护
            
            
            
            
            穿透
            查询不存在的数据
            取决于攻击量
            布隆过滤器 + 缓存空值
            
            
            击穿
            单个热点 key 过期
            单 key 对应的数据库查询
            互斥锁 / 逻辑过期
            
            
            雪崩
            大量 key 同时过期或缓存服务宕机
            全局
            过期时间随机化 + 多级缓存 + 熔断
            
            
            
            
            

## 七、缓存预热策略

            

缓存预热（Cache
            Warming）指在系统启动或缓存重建后，主动将热点数据加载到缓存中，避免冷启动期间大量请求穿透到数据库。
            

### 7.1 冷启动问题

            

一个空缓存的代价远不只是命中率为零。冷启动时的连锁反应：
            
```
缓存为空 → 所有请求穿透到数据库
         → 数据库负载飙升
         → 查询延迟升高
         → 应用超时增加
         → 更多请求堆积
         → 数据库连接池耗尽
         → 级联故障
```

            

对于高流量系统，冷启动如果不做预热，相当于用全量流量直接冲击数据库。如果数据库平时承受的是
            10% 的穿透流量，冷启动意味着瞬间 10 倍的负载。
            

### 7.2 预热方式

            

#### 基于历史访问日志

            

分析过去一段时间的访问日志，提取高频访问的
            key，在系统启动时批量加载到缓存中。
            
```
# 从访问日志中统计高频 key 并预热到 Redis
import redis
from collections import Counter

def warm_cache_from_log(log_path, redis_client, top_n=10000):
    counter = Counter()
    with open(log_path) as f:
        for line in f:
            key = extract_cache_key(line)
            if key:
                counter[key] += 1

    hot_keys = counter.most_common(top_n)
    pipeline = redis_client.pipeline()
    for key, count in hot_keys:
        value = load_from_database(key)
        if value is not None:
            pipeline.setex(key, 3600, serialize(value))

    pipeline.execute()
    print(f"Warmed {len(hot_keys)} keys")
```

            

这种方式的前提是有可用的访问日志且日志能反映真实的热点分布。如果业务模式有周期性变化（比如工作日和周末的热点不同），需要选择合适时间段的日志。
            

#### 基于数据库 Buffer Pool
            快照

            

前面第三节已经提到，InnoDB 支持 Buffer Pool
            转储和恢复。类似地，应用层缓存也可以在正常关闭时将缓存内容序列化到磁盘，重启时反序列化恢复。
            
```
// Caffeine 不直接支持序列化，但可以用以下方式实现
// 关闭时导出缓存内容
Map snapshot = localCache.asMap();
objectMapper.writeValue(new File("cache_snapshot.json"), snapshot);

// 启动时加载
Map saved = objectMapper.readValue(
    new File("cache_snapshot.json"),
    new TypeReference>() {}
);
saved.forEach((key, value) -> localCache.put(key, value));
```

            

#### 渐进式预热

            

不在启动时一次性加载所有热点数据，而是通过流量调度逐步增加流量。比如灰度发布时，先将
            1%
            的流量导到新实例，缓存逐步填充，命中率上升到稳定水平后再增加流量比例。
            
```
时间线：
t0: 新实例启动，导入 1% 流量
t1: 命中率达到 80%，增加到 10% 流量
t2: 命中率达到 95%，增加到 50% 流量
t3: 命中率达到 99%，切换全量流量
```

            

这种方式对业务无侵入，但需要流量调度基础设施（如 Nginx
            权重配置或 Kubernetes Service 的流量分配）的支持。
            

### 7.3 预热的注意事项

            

第一，控制预热速率。一次性从数据库加载数万条数据会对数据库产生压力，预热过程本身不应成为数据库的负担。建议使用限流机制控制每秒加载的条目数。
            

第二，预热数据的时效性。如果预热使用的是几小时前的快照，快照中的部分数据可能已经过期。预热后缓存中的数据可能与数据库不一致，需要配合正常的过期淘汰机制逐步修正。
            

第三，避免预热与正常流量竞争资源。预热加载大量数据可能挤占缓存空间，导致正常流量产生的热数据被淘汰。可以考虑预热数据设置较短的初始
            TTL，让正常流量的缓存条目逐步替换预热数据。
            
            

## 八、缓存大小调优

            

缓存不是越大越好。增加缓存容量可以提高命中率，但受边际收益递减规律约束——命中率从
            90% 提升到 95% 可能只需要翻倍缓存大小，但从 95% 提升到 99%
            可能需要 10
            倍的容量。缓存占用的内存有机会成本：多分给缓存的内存，就不能用于应用堆、Buffer
            Pool 或操作系统的 Page Cache。
            

### 8.1 工作集模型

            

缓存调优的出发点是工作集（Working
            Set）的概念：在一个给定的时间窗口内，应用实际访问的不同 key
            的集合。如果缓存容量能覆盖整个工作集，命中率理论上可以接近
            100%（不考虑首次加载的冷启动未命中）。
            
```
    命中率
    100% ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
     │                            ___________________
     │                     ______/
     │                ____/
     │           ____/
     │       ___/
     │    __/
     │  _/
     │ /
     │/
     └────────────────────────────────────────────────
     0           缓存容量 →           工作集大小

     拐点：当缓存容量接近工作集大小时，
     命中率增长趋于平缓，继续增加缓存容量的收益递减。
```

            

实际的工作集大小可以通过以下方式估算：
            
```
# Redis：统计一段时间内的不同 key 数量
# 使用 SCAN 命令遍历所有 key（生产环境慎用，建议在从库执行）
redis-cli --scan --pattern '*' | wc -l

# Redis 内存分析
redis-cli MEMORY DOCTOR
redis-cli INFO keyspace
```

            

### 8.2
            命中率与容量的经验关系

            

对于符合 Zipf 分布（少数 key 被高频访问、大量 key
            被低频访问）的典型 Web
            应用流量，命中率与缓存容量的关系大致如下：
            
            
            
            缓存容量（占工作集比例）
            典型命中率（Zipf 分布）
            
            
            
            
            1%
            30-50%
            
            
            5%
            60-75%
            
            
            10%
            75-85%
            
            
            20%
            85-92%
            
            
            50%
            95-98%
            
            
            100%
            ~99.9%
            
            
            
            

这只是粗略估计，实际命中率取决于具体的访问分布。如果访问分布更集中（少数
            key
            占绝大多数请求），较小的缓存就能获得高命中率；如果分布较均匀，则需要更大的缓存。
            

### 8.3 成本效益分析

            

缓存调优本质上是一个经济决策：增加缓存容量的内存成本
            vs. 减少的数据库查询成本（包括延迟降低带来的用户体验提升）。
            

一个粗略的计算框架：
            
```
假设：
  当前命中率 = 90%
  总请求量 = 100,000 QPS
  穿透到数据库的查询 = 10,000 QPS
  每次数据库查询成本 = 5ms 延迟 + 对应的数据库资源
  缓存命中延迟 = 0.5ms

如果增加缓存容量使命中率从 90% → 95%：
  穿透查询减少 = 5,000 QPS
  节省的数据库资源 = 5,000 * 5ms = 25,000 ms/s = 25 核秒/秒

如果增加缓存容量需要额外 16GB 内存：
  内存成本 vs. 数据库资源节省 → 需要根据实际成本计算 ROI
```

            

### 8.4 各层缓存的推荐大小

            
            
            
            缓存层次
            推荐大小
            调整依据
            
            
            
            
            应用本地缓存（L1）
            1万-10万条目
            热点集中度和单条目大小
            
            
            Redis（L2）
            可用内存的 70-80%
            `maxmemory` 配置，留空间给 fork
            
            
            InnoDB Buffer Pool
            物理内存的 70-80%
            专用服务器
            
            
            PostgreSQL Shared Buffers
            物理内存的 25%
            依赖 Page Cache
            
            
            Page Cache
            系统自动管理
            减少 Buffer Pool 后自动扩大
            
            
            
            

Redis 的 `maxmemory` 不要设满物理内存。Redis
            执行 `BGSAVE`（RDB 持久化）时会 fork 子进程，fork
            过程中的写时复制（Copy-on-Write，COW）需要额外内存。如果
            `maxmemory` 设得太满，`BGSAVE`
            期间可能触发 OOM。
            
            

## 九、缓存命中率监控

            

缓存命中率是衡量缓存效果的核心指标。命中率下降通常是性能问题的先兆——在用户感知到延迟升高之前，命中率的变化已经可以被监控系统捕捉到。
            

### 9.1 核心监控指标

            
```
指标                    计算方式                   告警阈值（参考）
──────────────────────────────────────────────────────────────────
命中率（Hit Rate）      hits / (hits + misses)      5% 需要关注
淘汰频率（Eviction Rate）evictions / second        突增时需要排查
内存使用率              used_memory / maxmemory    > 90% 考虑扩容
延迟（Latency）         P50 / P99 / P999          与基线比较
```

            

### 9.2 Redis 监控

            
```
# Redis INFO 命令查看缓存统计
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses"
```

            
```
keyspace_hits:48293847
keyspace_misses:2847561
```

            

命中率计算：`48293847 / (48293847 + 2847561) = 94.4%`。
            
```
# 使用 redis-cli --stat 实时监控
redis-cli --stat -i 5
```

            
```
------- data ------ --------------------- load -------------------- - child -
keys       mem      clients blocked requests            connections
1284561    3.21G    142     0       58291048 (+23847)    2841
1284558    3.21G    139     0       58314895 (+23847)    2841
```

            

更细粒度的监控可以通过 Redis 的 `LATENCY`
            子系统和 `SLOWLOG` 实现：
            
```
# 启用延迟监控（超过 10ms 的操作记录）
redis-cli CONFIG SET latency-monitor-threshold 10

# 查看延迟事件
redis-cli LATENCY LATEST

# 查看慢日志
redis-cli SLOWLOG GET 10
```

            

### 9.3 InnoDB Buffer Pool
            监控

            
```
-- 查看 Buffer Pool 命中率
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
```

            

关键指标：
            
```
Innodb_buffer_pool_read_requests    = 259384710    -- 逻辑读请求总数
Innodb_buffer_pool_reads            = 1847293      -- 穿透到磁盘的物理读次数
```

            

命中率：`1 - (1847293 / 259384710) = 99.29%`。
            

如果命中率低于 99%，通常意味着 Buffer Pool
            太小或者工作集发生了变化。可以通过
            `SHOW ENGINE INNODB STATUS` 的
            `BUFFER POOL AND MEMORY` 段获取更详细的信息：
            
```
SHOW ENGINE INNODB STATUS\G
```

            

关注输出中的以下字段：
            
```
Buffer pool hit rate 999 / 1000
Pages made young 184729, not young 29384
```

            

### 9.4 PostgreSQL
            Shared Buffers 监控

            

PostgreSQL 通过 `pg_stat_bgwriter` 和
            `pg_buffercache` 扩展提供缓冲区监控：
            
```
-- 安装 pg_buffercache 扩展
CREATE EXTENSION pg_buffercache;

-- 查看缓冲区使用分布：哪些表占用了多少缓冲区
SELECT c.relname,
       count(*) AS buffers,
       pg_size_pretty(count(*) * 8192) AS buffer_size
FROM pg_buffercache b
JOIN pg_class c ON b.relfilenode = c.relfilenode
WHERE b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND c.relname NOT LIKE 'pg_%'
GROUP BY c.relname
ORDER BY buffers DESC
LIMIT 20;
```

            
```
-- 查看缓冲区命中率
SELECT
    sum(blks_hit) AS cache_hits,
    sum(blks_read) AS disk_reads,
    round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 2)
        AS hit_rate_pct
FROM pg_stat_database
WHERE datname = current_database();
```

            

### 9.5 Page Cache 监控

            

Page Cache
            的命中率没有内核直接暴露的计数器，但可以通过以下方式间接观测：
            
```
# 方式一：cachestat（BCC/bpftrace 工具集）
# 实时统计 Page Cache 的命中和未命中
sudo cachestat-bpfcc 5
```

            
```
    HITS   MISSES  DIRTIES  HITRATIO   BUFFERS_MB  CACHED_MB
   18293      147       42    99.20%         229      12543
   17841      183       38    98.98%         229      12548
   19102       91       55    99.52%         229      12551
```

            
```
# 方式二：通过 /proc/vmstat 计算
# pgpgin: 从磁盘读入的页数（单位：KB）
# pgpgout: 写出到磁盘的页数（单位：KB）
cat /proc/vmstat | grep -E "pgpgin|pgpgout|pgfault|pgmajfault"
```

            
```
pgpgin 28473921
pgpgout 19284710
pgfault 584729103
pgmajfault 184729
```

            

`pgfault`
            是总缺页次数（包括次要缺页和主要缺页），`pgmajfault`
            是主要缺页（Major Page
            Fault，需要从磁盘读取数据的缺页）次数。Page Cache
            命中率可以近似为：`1 - pgmajfault / pgfault`。
            

### 9.6 监控实践建议

            

第一，命中率监控要区分时间维度。整体命中率可能是
            99%，但在每天凌晨的批量任务期间可能降到
            60%。需要将命中率按时间窗口（如每分钟）绘制折线图，而不是只看一个全局平均值。
            

第二，命中率要与业务指标关联。单独看命中率没有意义——99%
            的命中率在 1000 QPS 下意味着每秒 10 次穿透，在 100000 QPS
            下意味着每秒 1000
            次穿透。后者可能已经超过数据库的承受能力。
            

第三，淘汰率突增是预警信号。如果淘汰率（每秒淘汰的条目数）突然升高，通常意味着缓存容量不足以容纳工作集，或者工作集发生了突变。这时候需要排查是流量模式变化、缓存配置变更还是内存泄漏。
            

第四，建立命中率基线。正常运行状态下的命中率应该记录为基线，后续的监控告警以偏离基线的百分比触发，而不是固定的绝对阈值。不同业务的”正常”命中率可能差异很大。
            
            

## 十、参考文献

            

### 论文

            
            
- 

Einziger, G., Friedman, R., Manes, B. “TinyLFU: A
            Highly Efficient Cache Admission Policy.” ACM Transactions
            on Storage, 2017. W-TinyLFU
            算法的理论基础和实验评估。
            
- 

Megiddo, N., Modha, D. S. “ARC: A Self-Tuning, Low
            Overhead Replacement Cache.” FAST 2003. ARC
            自适应替换缓存算法的提出与分析。
            
- 

O’Neil, E. J., O’Neil, P. E., Weikum, G. “The LRU-K
            Page Replacement Algorithm for Database Disk Buffering.”
            SIGMOD 1993. LRU-K
            算法，对数据库缓冲区管理有深远影响。
            
- 

Corbet, J. “Trees I: Radix trees.” LWN.net, 2006.
            Linux 内核页缓存数据结构的演进。
            
- 

Corbato, F. J. “A Paging Experiment with the Multics
            System.” MIT Project MAC, 1968.
            工作集模型的早期研究。
            
            

### 官方文档

            
            
- 

MySQL 8.0 Reference Manual: InnoDB Buffer Pool. https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool.html
            . Buffer Pool 配置与管理。
            
- 

PostgreSQL 16 Documentation: Resource Consumption. https://www.postgresql.org/docs/16/runtime-config-resource.html
            . shared_buffers 等缓冲区参数。
            
- 

Redis Documentation: Memory Optimization. https://redis.io/docs/management/optimization/memory-optimization/
            . Redis 内存管理和淘汰策略。
            
- 

Linux Kernel Documentation: vm.dirty_ratio,
            vm.dirty_background_ratio. https://www.kernel.org/doc/Documentation/sysctl/vm.txt
            . Page Cache 脏页回写参数。
            
- 

Caffeine Wiki: Efficiency. https://github.com/ben-manes/caffeine/wiki/Efficiency
            . Caffeine 缓存库的 W-TinyLFU 算法实现和性能评估。
            
            

### 源码

            
            
- 

Linux 6.x, `mm/readahead.c`. Page Cache
            预读算法实现。
            
- 

Linux 6.x, `mm/filemap.c`. Page Cache
            的核心读写路径。
            
- 

MySQL 8.0,
            `storage/innobase/buf/buf0lru.cc`. InnoDB Buffer
            Pool 的 LRU 淘汰实现。
            
- 

PostgreSQL 16,
            `src/backend/storage/buffer/freelist.c`.
            Clock-Sweep 缓冲区淘汰算法实现。
            
            
            

**上一篇**: I/O
            性能分析工具链 **下一篇**: 写入性能优化
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-04 · storage
                    

### 【存储工程】Buffer Pool：数据库的内存管理

                    

数据库为什么不直接使用操作系统的 Page Cache，而要自己管理一块内存？本文从 double buffering 问题讲起，拆解 Buffer Pool 的架构、页面替换算法、脏页刷新策略、预读机制，再分别剖析 MySQL InnoDB 和 PostgreSQL 的实现细节，最后落到大小调优与监控诊断。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

在 Linux 的传统 I/O 路径中，应用程序通过 read() 和 write() 系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：
                

                
                    

2025-08-26 · storage
                    

### 【存储工程】ZFS：数据完整性优先的存储栈

                    

在存储系统的世界里，大多数文件系统把"性能"放在第一位，把"完整性"当作锦上添花的特性。ZFS 的做法恰好相反——它把数据完整性视为最基本的不可协商的属性，然后在此基础上构建性能优化。这种设计哲学上的根本差异，使得 ZFS 在诞生近二十年后，仍然是数据保护领域无可替代的存储栈。
                

                
                    

2025-08-16 · storage
                    

### 【存储工程】Linux I/O 栈全景：从 write() 到磁盘扇区

                    

当应用程序调用一次 write() 系统调用（System Call）时，数据并不会立刻落到磁盘扇区上。 它需要穿越内核中七个以上的软件层次，每一层都有独立的职责、数据结构和延迟开销。 理解这条完整路径，是进行存储性能调优和故障诊断的基础。