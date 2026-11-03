# 【存储工程】I/O 性能分析工具链

来源: https://quant67.com/post/storage/65-io-analysis-tools/io-analysis-tools.html
日期: 2025-10-13 |

---

线上服务突然变慢，监控面板上看到磁盘利用率飙到 100%，P99
            延迟从 5ms 跳到
            200ms。这时候该看哪个指标？用哪个工具？从哪一层开始查？
            

I/O 性能问题的难点不在于工具本身——Linux 提供了大量的 I/O
            观测工具——而在于理解每个工具观测的是 I/O
            路径中的哪一层，采集的是什么指标，以及不同工具之间如何配合。`iostat`
            看到的延迟高，是因为设备本身慢，还是因为请求在队列里排了太久？`biosnoop`
            显示某个进程 I/O
            频繁，是应用自身的问题，还是文件系统在做元数据操作？这些问题的答案，取决于对
            I/O 栈分层模型的理解。
            

本文按照 I/O
            栈从上到下的顺序，逐一拆解六组核心工具：`iostat`/`iotop`（全局概览）、`blktrace`/`blkparse`（块层追踪）、BCC
            工具集（eBPF
            观测）、`bpftrace`（自定义追踪）、`ftrace`（内核函数追踪）、`perf`（CPU
            与调用栈分析）。每组工具说清楚三件事：观测的是哪一层、核心指标的含义、实际使用的命令和输出解读。最后给出一套
            I/O 瓶颈排查流程和常见问题模式。
            
            

**版本说明** 本文涉及的软件版本：Linux 6.x
            内核、sysstat 12.x（`iostat`）、blktrace
            1.3.0、BCC 0.28+、bpftrace 0.19+、perf
            6.x。不同版本的输出格式和可用选项可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、I/O
            性能问题的分层思维

            

### 1.1 I/O 栈的观测层次

            

Linux I/O
            栈从用户态到硬件，至少有六个可以观测的层次。每一层都有对应的工具和指标，而同一个”I/O
            慢”的现象，在不同层次看到的表现完全不同。
            
```
┌─────────────────────────────────────────────────────┐
│  应用层（Application）                               │
│  观测点：应用日志、strace、opensnoop                  │
│  指标：系统调用延迟、打开文件数、读写字节数            │
├─────────────────────────────────────────────────────┤
│  VFS 层（Virtual File System）                       │
│  观测点：ftrace、vfsstat（BCC）                      │
│  指标：VFS 操作计数、缓存命中率                       │
├─────────────────────────────────────────────────────┤
│  文件系统层（ext4 / XFS / btrfs）                    │
│  观测点：ext4slower、xfsslower（BCC）、ftrace         │
│  指标：文件系统级延迟、journal 提交耗时               │
├─────────────────────────────────────────────────────┤
│  Page Cache 层                                       │
│  观测点：cachestat（BCC）、/proc/meminfo              │
│  指标：缓存命中率、脏页比例、回写速率                  │
├─────────────────────────────────────────────────────┤
│  块设备层（Block Layer）                              │
│  观测点：iostat、blktrace、biosnoop（BCC）            │
│  指标：IOPS、吞吐量、队列深度、设备服务时间            │
├─────────────────────────────────────────────────────┤
│  设备驱动 / 硬件层                                    │
│  观测点：smartctl、nvme-cli、硬件计数器                │
│  指标：介质错误、磨损指标、固件延迟                    │
└─────────────────────────────────────────────────────┘
```

            

理解这张分层图是选择工具的基础。一个常见的错误是：看到
            `iostat` 报告的 `await`
            很高，就认定是磁盘慢。但 `await` 包含了请求在 I/O
            调度队列（I/O Scheduler
            Queue）中的排队时间——如果队列深度很大，`await`
            高可能只是排队时间长，设备本身的服务时间（`svctm`
            在旧版 `iostat`
            中报告，现在已废弃，但概念仍然重要）并不长。
            

### 1.2 延迟在哪里产生

            

I/O 延迟可以分解为五个阶段：
            
            
            
            
            
            
            
            
            
            阶段
            位置
            典型延迟范围
            主要工具
            
            
            
            
            系统调用开销
            用户态到内核态切换
            0.1-1 us
            strace、perf
            
            
            文件系统处理
            inode 查找、journal 提交
            1-100 us
            ext4slower、ftrace
            
            
            Page Cache 处理
            缓存查找、脏页回写
            0.1-10 us（命中）；触发回写时 ms 级
            cachestat
            
            
            块层排队
            I/O 调度、请求合并
            0-数十 ms（取决于队列深度）
            blktrace、biosnoop
            
            
            设备服务
            磁盘读写
            HDD：5-15 ms；SSD：0.05-0.5 ms
            iostat、blktrace
            
            
            
            

这张表说明了一个关键判断方法：如果 I/O
            延迟高，先判断延迟产生在哪个阶段，再选择对应的工具深入分析。盲目用一个工具从头查到尾，既低效又容易误判。
            

### 1.3
            两种思路：自顶向下与基于指标

            

排查 I/O 性能问题有两种基本思路。
            

自顶向下（Top-Down）：从应用层的延迟表现开始，逐层向下追踪，直到找到延迟产生的具体位置。适合”应用变慢了，不知道是不是
            I/O 的问题”这类场景。
            

基于指标（Metric-Based）：先用
            `iostat`、`iotop`
            等工具获取全局指标，根据指标的异常模式快速定位问题方向。适合”已经确认是
            I/O 问题，需要找到具体原因”这类场景。
            

两种思路并不互斥。实际排查中，通常先用全局工具快速扫一遍，确认问题方向，再用专项工具深入分析。
            
            

## 二、iostat 与
            iotop（全局视角）

            

### 2.1 iostat 基础

            

`iostat` 是 `sysstat`
            包提供的块设备统计工具，数据来源是内核的
            `/proc/diskstats`。它是 I/O
            性能分析的第一站——快速获取每个块设备的 IOPS（Input/Output
            Operations Per Second）、吞吐量、延迟和利用率。
            

最常用的命令格式：
            
```
# -x 显示扩展统计，-z 跳过无活动设备，1 表示每秒刷新，5 表示采样 5 次
iostat -xz 1 5
```

            

输出示例（经删减，仅保留关键列）：
            
```
Device     r/s    w/s   rkB/s    wkB/s  rrqm/s  wrqm/s  %rrqm  %wrqm  r_await  w_await  aqu-sz  rareq-sz  wareq-sz  svctm  %util
sda       12.00  85.00  192.00  4480.00    0.00   32.00   0.00  27.35     0.42     2.15    0.18    16.00     52.71   0.62   6.00
nvme0n1  450.00 1200.00 28800.00 76800.00   0.00    0.00   0.00   0.00     0.08     0.05    0.08    64.00     64.00   0.02   3.50
```

            

### 2.2 iostat 关键指标解读

            

每个指标的含义和判断方法：
            

**r/s、w/s**：每秒读写操作数（IOPS）。这是合并后的
            IOPS——内核的 I/O 调度器（I/O
            Scheduler）会将相邻的请求合并（Merge），所以这里的数字通常小于应用实际发出的
            I/O 请求数。
            

**rkB/s、wkB/s**：每秒读写吞吐量。结合 IOPS
            可以算出平均请求大小：`rkB/s / r/s = rareq-sz`。如果平均请求很小（例如
            4KB），说明应用在做随机小 I/O；如果很大（例如 128KB
            以上），说明在做顺序大 I/O 或者合并效果好。
            

**rrqm/s、wrqm/s**：每秒合并的读写请求数。合并率高说明
            I/O 模式具有空间局部性（Spatial
            Locality），调度器能有效地将相邻请求拼在一起。如果
            `%wrqm` 很低但 IOPS 很高，可能是随机写负载。
            

**r_await、w_await**：读写请求从进入块层队列到完成的平均时间（毫秒）。这个时间包括排队时间和设备服务时间。对
            SSD 来说，正常值在 0.1ms 以下；对 HDD，正常值在 5-15ms
            之间。如果 `w_await` 突然从 0.1ms 跳到
            50ms，要高度警惕。
            

**aqu-sz**：平均队列深度（Average Queue
            Size）。反映了块设备层排队的请求数量。在旧版
            `iostat` 中这个字段叫
            `avgqu-sz`。队列深度高意味着设备处理不过来，新请求必须排队等待。对于单个
            SATA SSD，队列深度长期大于 2 就值得关注；对 NVMe
            设备，队列深度可以更高但也有上限。
            

**%util**：设备利用率。这个指标经常被误解。`%util`
            表示的是设备至少有一个未完成请求的时间比例，不是设备的”忙碌程度”。对
            HDD 这种一次只能服务一个请求的设备，`%util` 接近
            100% 确实意味着饱和。但对 SSD 和 NVMe
            设备，它们可以并行处理多个请求，`%util` 达到 100%
            不代表设备饱和——只要队列深度在设备能力范围内，设备仍然可以接受更多请求。判断
            NVMe 设备是否饱和，应该看 `aqu-sz` 和
            `r_await`/`w_await`，而不是
            `%util`。
            

### 2.3 iostat 的局限

            

`iostat`
            是采样统计工具，它给出的是时间窗口内的平均值。这意味着：
            

第一，它看不到瞬时尖峰。如果在一秒的采样窗口内，前 10ms
            有一波突发写入导致延迟飙高，但后 990ms
            很空闲，`iostat` 报告的 `w_await`
            会被均摊拉低，看不出问题。
            

第二，它无法关联到具体进程。`iostat`
            只报告设备级别的统计，不知道是哪个进程在做 I/O。需要配合
            `iotop` 或 `biosnoop`
            才能定位到进程。
            

第三，它不区分同步和异步 I/O。`fdatasync()`
            触发的同步写和 Page Cache 回写（Writeback）触发的异步写，在
            `iostat` 看来都是
            `w/s`。但两者对应用的影响完全不同——同步写会阻塞应用线程，异步写不会。
            

### 2.4 iotop：进程级 I/O 视图

            

`iotop` 提供进程级别的 I/O 统计，类似于 I/O
            版的 `top`。它直接读取内核的 taskstats
            接口，可以看到每个进程（或线程）的读写速率和 I/O
            等待时间。
            
```
# -o 只显示有 I/O 活动的进程，-a 累积模式
iotop -o -a
```

            

输出示例：
            
```
Total DISK READ:        45.00 M/s | Total DISK WRITE:       120.00 M/s
Current DISK READ:      45.00 M/s | Current DISK WRITE:     120.00 M/s
    TID  PRIO  USER     DISK READ  DISK WRITE  SWAPIN     IO>    COMMAND
  12345 be/4  mysql      5.00 M/s   80.00 M/s  0.00 %  35.00 %  mysqld --defaults-file=...
  12400 be/4  mysql      0.00 B/s   20.00 M/s  0.00 %  12.00 %  mysqld --defaults-file=...
  23456 be/4  root      40.00 M/s    0.00 B/s  0.00 %   5.00 %  dd if=/dev/sda of=/dev/null
   1234 be/4  root       0.00 B/s   20.00 M/s  0.00 %   8.00 %  [jbd2/sda1-8]
```

            

`IO>` 列显示的是进程花在 I/O
            等待上的时间占比。如果某个进程的 `IO>`
            持续很高（例如 > 50%），说明这个进程大部分时间在等 I/O
            完成，而不是在做计算。这类进程是 I/O 密集型（I/O
            Bound）的。
            

注意输出中的 `[jbd2/sda1-8]`——这是 ext4
            文件系统的日志线程（Journal Block Device
            2）。如果这个线程的写入量很大或 IO 等待时间很高，说明 ext4
            的 journal 提交成为了瓶颈，可能是大量
            `fsync()`/`fdatasync()`
            调用导致的。
            

### 2.5 pidstat 补充：进程级
            I/O 统计

            

`pidstat` 也来自 `sysstat`
            包，可以提供进程级的 I/O
            统计，但格式更适合脚本处理和长时间采样：
            
```
# -d 显示 I/O 统计，1 表示每秒采样，-p ALL 显示所有进程
pidstat -d 1
```

            

输出包含每个进程的 `kB_rd/s`（每秒读取
            KB）、`kB_wr/s`（每秒写入
            KB）、`kB_ccwr/s`（每秒取消的写入
            KB，即写入后在落盘前被截断的部分）。`kB_ccwr/s`
            这个指标容易被忽略，但它能揭示一种有趣的模式：如果应用频繁写入临时文件再删除，这些写入虽然占用了
            Page Cache 带宽，但不会落到磁盘——`kB_ccwr/s`
            就会很高。
            
            

## 三、blktrace 与
            blkparse（块层追踪）

            

### 3.1 blktrace 的定位

            

`iostat` 给出的是统计平均值，看不到单个 I/O
            请求的生命周期。`blktrace`
            填补了这个空白——它在块设备层（Block Layer）对每个 I/O
            请求进行事件级追踪，记录请求从进入块层到完成的每一步。
            

`blktrace` 的数据来源是内核块层的
            tracepoint（追踪点）。它通过 debugfs 与内核通信，将事件写入
            per-CPU 的环形缓冲区（Ring Buffer），然后由用户态的
            `blktrace`
            进程读出并写入文件。`blkparse`
            负责解析这些二进制文件，输出可读的文本。
            

### 3.2 I/O 请求的生命周期

            

要理解 `blktrace` 的输出，首先需要理解一个 I/O
            请求在块层的完整生命周期。`blktrace`
            用单字母代码标记每个阶段：
            
```
应用发起 I/O
     │
     ▼
 Q ──── 请求进入块层队列（Queue）
     │
     ▼
 G ──── 分配 request 结构（Get request）
     │
     ▼
 M ──── 与已有请求合并（Merge），可选
     │
     ▼
 I ──── 插入 I/O 调度队列（Insert）
     │
     ▼
 D ──── 请求派发到设备驱动（Dispatch）
     │
     ▼
 C ──── 请求完成（Complete）
```

            

几个关键的时间差：
            
            
- **Q 到 C**：请求的总延迟，即
            `iostat` 报告的
            `r_await`/`w_await`。
            
- **Q 到
            D**：排队延迟，请求在块层等待的时间。
            
- **D 到
            C**：设备服务时间，请求实际在设备上执行的时间。
            
            

如果 Q-C 很大但 D-C
            很小，说明瓶颈在排队环节，不是设备本身慢。如果 D-C
            就很大，说明设备本身服务慢。
            

### 3.3 基本使用

            
```
# 对 /dev/sda 追踪 10 秒
blktrace -d /dev/sda -w 10 -o trace

# 解析追踪数据
blkparse -i trace -o trace.txt
```

            

`blkparse` 输出示例（经删减）：
            
```
  8,0    0        1     0.000000000  12345  Q   W 123456 + 8 [mysqld]
  8,0    0        2     0.000001200  12345  G   W 123456 + 8 [mysqld]
  8,0    0        3     0.000002500  12345  I   W 123456 + 8 [mysqld]
  8,0    0        4     0.000010000  12345  D   W 123456 + 8 [mysqld]
  8,0    0        5     0.000250000     0  C   W 123456 + 8 [0]
```

            

各列含义：
            
            
- `8,0`：设备号（主设备号,次设备号），这里对应
            `/dev/sda`。
            
- `0`：CPU 编号。
            
- `1`：序列号。
            
- `0.000000000`：时间戳（秒）。
            
- `12345`：进程 PID。
            
- `Q`/`G`/`I`/`D`/`C`：事件类型。
            
- `W`：写操作（`R` 表示读）。
            
- `123456 + 8`：起始扇区号 + 扇区数量（每个扇区
            512 字节，8 个扇区即 4KB）。
            
- `[mysqld]`：进程名。
            
            

### 3.4 btt：统计延迟分布

            

`blktrace` 套件自带的 `btt`
            工具可以从追踪数据中提取延迟统计：
            
```
# 合并各 CPU 的追踪数据
blkparse -i trace -d trace.bin

# 用 btt 分析
btt -i trace.bin
```

            

`btt` 输出中最有价值的是
            Q2C（总延迟）、Q2D（排队延迟）、D2C（设备延迟）的统计分布：
            
```
==================== All Coverage ====================

           Q2C       Q2D       D2C
 ---------- ---------- ----------
 AVG        0.000250   0.000010   0.000240
 MIN        0.000050   0.000002   0.000048
 MAX        0.025000   0.015000   0.012000
```

            

这组数据直接回答了”延迟花在哪里”的问题。上面这个例子中，平均
            Q2C 是 250us，其中 Q2D（排队）只有 10us，D2C（设备服务）是
            240us——说明设备延迟占主导。但如果 MAX Q2D 达到
            15ms，说明偶尔会出现排队时间很长的情况，可能是 I/O
            突发导致。
            

### 3.5 实战：诊断写延迟抖动

            

以下是用 `blktrace`
            定位写延迟抖动的实际案例。
            

**问题现象**：数据库服务的 P99
            写延迟周期性地从 0.5ms 跳到 20ms，周期大约 30
            秒。`iostat` 显示 `w_await`
            平均值正常（1ms 左右），但 P99 确实有尖峰。
            

**分析过程**：
            
```
# 采集 120 秒的追踪数据，覆盖多个周期
blktrace -d /dev/nvme0n1 -w 120 -o latency_trace

# 解析并用 btt 分析延迟分布
blkparse -i latency_trace -d latency_trace.bin
btt -i latency_trace.bin -l latency_trace.d2c_latency
```

            

`btt` 输出的 D2C
            延迟文件（`latency_trace.d2c_latency`）可以用来画延迟分布图。分析发现：95%
            的写请求的 D2C 在 0.1-0.3ms 之间，但每隔约 30 秒会出现一批
            D2C 超过 15ms 的请求。
            

进一步检查这些高延迟请求的扇区范围，发现它们集中在磁盘的特定
            LBA（Logical Block Address）区间。结合 SSD 的 FTL（Flash
            Translation Layer）行为分析，这个周期与 SSD
            的垃圾回收（Garbage Collection，GC）周期吻合——SSD 每隔约 30
            秒触发一次后台 GC，GC 期间前台写请求被暂停。
            

**解决方案**：调整 SSD 的
            OP（Over-Provisioning）预留空间比例从 7% 提高到 28%，减少 GC
            频率和单次 GC 的耗时。调整后 P99 写延迟稳定在 1ms 以内。
            

### 3.6 blktrace
            的开销与注意事项

            

`blktrace` 的追踪开销不可忽略：
            
            
- 每个 I/O 事件产生约 40 字节的追踪数据。在高 IOPS（例如
            100K IOPS）场景下，每秒产生的数据量约为 100K * 6 事件 * 40B
            = 24MB/s。
            
- 追踪数据写入磁盘本身也会产生
            I/O，如果追踪数据写到被追踪的同一个设备上，会导致观测结果失真。建议将追踪输出写到不同的设备上。
            
- 在生产环境中，建议使用 `-w`
            参数限制追踪时间，避免追踪数据文件无限增长。
            
            
            

## 四、BCC
            工具集（biosnoop/biotop/ext4slower/bitesize）

            

### 4.1 BCC 与 eBPF 概述

            

BCC（BPF Compiler Collection）是一套基于 eBPF（extended
            Berkeley Packet Filter）的 Linux 追踪工具集。与
            `blktrace` 相比，BCC 工具有两个显著优势：
            

第一，开销更低。eBPF
            程序在内核中运行，数据可以在内核态就完成聚合（例如统计延迟分布的直方图），只将聚合结果传回用户态，避免了像
            `blktrace` 那样将每个事件都传到用户态的开销。
            

第二，观测范围更广。`blktrace`
            只能观测块设备层，而 BCC
            工具可以挂载到内核中几乎任何函数上——从 VFS
            层到文件系统层到块设备层到设备驱动层都可以观测。
            

BCC 工具集中与 I/O 分析直接相关的核心工具：
            
            
            
            
            
            
            
            
            
            工具
            观测层
            功能
            数据来源
            
            
            
            
            `biosnoop`
            块设备层
            追踪每个块 I/O 请求的延迟
            block tracepoints
            
            
            `biotop`
            块设备层
            按进程统计块 I/O，类似 top
            block tracepoints
            
            
            `ext4slower`
            文件系统层
            显示超过阈值的 ext4 操作
            ext4 tracepoints
            
            
            `xfsslower`
            文件系统层
            显示超过阈值的 XFS 操作
            XFS tracepoints
            
            
            `bitesize`
            块设备层
            按进程统计 I/O 请求大小分布
            block tracepoints
            
            
            `cachestat`
            Page Cache
            统计 Page Cache 命中率
            vfs/mm tracepoints
            
            
            `filetop`
            VFS 层
            按文件统计读写量
            VFS tracepoints
            
            
            
            

### 4.2
            biosnoop：每请求延迟追踪

            

`biosnoop` 追踪每一个块 I/O
            请求，输出该请求的发起进程、设备、扇区、大小和延迟。它是
            `blktrace`
            的轻量替代——不需要生成大量追踪文件，直接在终端输出结果。
            
```
# 追踪所有块设备的 I/O 请求
biosnoop
```

            

输出示例：
            
```
TIME(s)     COMM           PID    DISK    T SECTOR      BYTES   LAT(ms)
0.000000    mysqld         12345  nvme0n1 W 12345678    4096      0.08
0.000120    mysqld         12345  nvme0n1 W 12345686    4096      0.07
0.000250    jbd2/sda1-8    1234   sda     W 87654321    32768     1.25
0.001500    kworker/3:1    567    sda     W 87654400    131072    3.40
0.005000    dd             23456  sda     R 0           131072    8.50
```

            

从这个输出可以直接看到：
            
            
- `mysqld` 对 `nvme0n1`
            的写入延迟稳定在 0.08ms，属正常范围。
            
- `jbd2` 内核线程（ext4 journal）对
            `sda` 的写入延迟 1.25ms，合理。
            
- `kworker` 线程（Page Cache 回写）的写入延迟
            3.4ms，偏高。
            
- `dd` 进程的读取延迟 8.5ms，如果是 HDD
            则正常。
            
            

`biosnoop` 还支持按设备名或 PID 过滤：
            
```
# 只追踪 nvme0n1 设备
biosnoop -d nvme0n1

# 只追踪 PID 12345 的 I/O
biosnoop -p 12345
```

            

### 4.3 biotop：进程级 I/O Top

            

`biotop` 每隔一段时间（默认 1
            秒）刷新一次，按进程统计块 I/O 的读写速率和平均延迟，类似于
            I/O 版的 `top`：
            
```
biotop
```

            

输出示例：
            
```
PID    COMM           D MAJ MIN  DISK        I/O   Kbytes  AVGms
12345  mysqld         W 259   0  nvme0n1    2500   10240    0.08
12345  mysqld         R 259   0  nvme0n1     800    6400    0.06
1234   jbd2/sda1-8    W   8   0  sda         120    3840    1.30
23456  dd             R   8   0  sda          50    6400    8.20
567    kworker/3:1    W   8   0  sda          30    3840    3.50
```

            

与 `iotop` 的区别：`iotop`
            看到的是进程通过系统调用发出的 I/O，`biotop`
            看到的是实际到达块设备层的
            I/O。两者可能不一致——如果数据命中了 Page Cache，应用读取时
            `iotop` 会计数但 `biotop`
            不会（因为没有产生块 I/O）。反过来，Page Cache 回写产生的块
            I/O 会在 `biotop` 中显示（归属于
            `kworker` 或 `flush` 内核线程），但在
            `iotop`
            中可能归属于原始写入进程，也可能归属于内核线程，取决于回写路径。
            

### 4.4 ext4slower
            / xfsslower：文件系统级慢操作

            

`ext4slower` 追踪 ext4
            文件系统中延迟超过阈值的操作，包括读、写、打开、fsync
            等。默认阈值是 10ms，可以调整。
            
```
# 显示延迟超过 1ms 的 ext4 操作
ext4slower 1
```

            

输出示例：
            
```
Tracing ext4 operations slower than 1 ms
TIME     COMM           PID    T BYTES   OFF_KB   LAT(ms) FILENAME
08:15:30 mysqld         12345  S 0       0         15.23  ib_logfile0
08:15:30 mysqld         12345  W 16384   1024       2.10  ibdata1
08:15:31 mysqld         12345  S 0       0         12.80  ib_logfile0
08:15:45 tar            23456  R 131072  0          5.60  backup.tar.gz
```

            

`T` 列的含义：`R`
            读、`W` 写、`O` 打开、`S`
            同步（fsync/fdatasync）。
            

上面的输出揭示了一个典型模式：`mysqld` 的
            `fsync`（`S`
            操作）延迟很高（12-15ms），而普通写入（`W`）只有
            2ms。这说明瓶颈在 `fsync` 的 journal
            提交路径上，而不是数据写入本身。可能的原因包括：ext4 的
            journal 模式配置为 `data=journal`（所有数据都经过
            journal，开销大）而不是默认的
            `data=ordered`，或者 journal
            所在的设备本身慢。
            

### 4.5 bitesize：I/O
            请求大小分布

            

`bitesize` 按进程统计块 I/O
            请求的大小分布，以直方图（Histogram）形式展示：
            
```
# 追踪 10 秒后输出
bitesize 10
```

            

输出示例：
            
```
Process Name = mysqld
     Kbytes              : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 3500     |****************************************|
         8 -> 15         : 1200     |**************                          |
        16 -> 31         : 300      |***                                     |
        32 -> 63         : 50       |*                                       |

Process Name = kworker/3:1
     Kbytes              : count     distribution
         0 -> 1          : 0        |                                        |
         2 -> 3          : 0        |                                        |
         4 -> 7          : 20       |*                                       |
         8 -> 15         : 50       |***                                     |
        16 -> 31         : 100      |*****                                   |
        32 -> 63         : 200      |**********                              |
        64 -> 127        : 500      |*************************               |
       128 -> 255        : 800      |****************************************|
```

            

这个输出告诉我们：`mysqld` 的 I/O 以 4KB
            小请求为主（典型的数据库页大小），而
            `kworker`（Page Cache 回写线程）的 I/O 以
            128-256KB 的大请求为主。如果想提升 `mysqld` 的
            I/O 效率，可以考虑增大 InnoDB 的
            `innodb_page_size` 或调整
            `innodb_io_capacity` 来改善批量写入行为。
            
            

## 五、bpftrace 自定义追踪

            

### 5.1 bpftrace 与 BCC
            的关系

            

BCC
            提供的是预定义的工具——`biosnoop`、`ext4slower`
            等都是写好的 Python/C
            程序，拿来就用。但如果预定义工具不能满足需求——比如需要同时追踪块
            I/O
            延迟和对应的文件路径，或者需要按特定条件过滤和聚合——就需要
            `bpftrace`。
            

`bpftrace` 是一种高级追踪语言，语法类似
            AWK，可以编写一行或几行脚本来实现自定义的内核追踪。它底层同样使用
            eBPF，但提供了比 BCC 更简洁的编程接口。
            

### 5.2 常用 I/O 追踪脚本

            

**追踪块 I/O 延迟分布（直方图）**：
            
```
#!/usr/bin/env bpftrace

// 追踪块 I/O 请求延迟，按设备输出直方图
tracepoint:block:block_rq_issue
{
    @start[args->dev, args->sector] = nsecs;
}

tracepoint:block:block_rq_complete
/@start[args->dev, args->sector]/
{
    $lat = nsecs - @start[args->dev, args->sector];
    @usecs = hist($lat / 1000);
    delete(@start[args->dev, args->sector]);
}

END
{
    clear(@start);
}
```

            

运行方式：
            
```
bpftrace io_latency_hist.bt
```

            

输出示例（按 Ctrl-C 终止后显示）：
            
```
@usecs:
[0]                  120 |                                        |
[1]                  450 |*                                       |
[2, 4)              3200 |*********                               |
[4, 8)              8500 |*************************               |
[8, 16)            13000 |****************************************|
[16, 32)            6200 |*******************                     |
[32, 64)            2100 |******                                  |
[64, 128)            800 |**                                      |
[128, 256)           200 |*                                       |
[256, 512)            50 |                                        |
[512, 1K)             10 |                                        |
[1K, 2K)               3 |                                        |
```

            

这个直方图直接展示了 I/O 延迟分布的全貌——大多数请求在
            8-16us 完成（NVMe 设备的典型延迟），但有少量请求延迟超过
            100us 甚至 1ms，这些就是需要关注的尾延迟（Tail
            Latency）。
            

**按进程和操作类型统计 I/O 字节数**：
            
```
#!/usr/bin/env bpftrace

// 按进程名和读写类型统计 I/O 字节数
tracepoint:block:block_rq_issue
{
    @bytes[comm, args->rwbs] = sum(args->bytes);
}

interval:s:5
{
    print(@bytes);
    clear(@bytes);
}
```

            

**追踪超过阈值的慢 I/O 并输出调用栈**：
            
```
#!/usr/bin/env bpftrace

// 追踪延迟超过 10ms 的块 I/O 请求，输出进程信息
tracepoint:block:block_rq_issue
{
    @start[args->dev, args->sector] = nsecs;
    @comm[args->dev, args->sector] = comm;
    @pid_map[args->dev, args->sector] = pid;
}

tracepoint:block:block_rq_complete
/@start[args->dev, args->sector]/
{
    $lat = nsecs - @start[args->dev, args->sector];
    if ($lat > 10000000) {  // 10ms = 10,000,000 ns
        printf("SLOW IO: %s (pid=%d) dev=%d sector=%lld lat=%dms\n",
            @comm[args->dev, args->sector],
            @pid_map[args->dev, args->sector],
            args->dev, args->sector,
            $lat / 1000000);
    }
    delete(@start[args->dev, args->sector]);
    delete(@comm[args->dev, args->sector]);
    delete(@pid_map[args->dev, args->sector]);
}
```

            

### 5.3 追踪文件系统级延迟

            

`bpftrace`
            可以挂载到文件系统的内核函数上，追踪文件系统级别的延迟。以下脚本追踪
            ext4 的 `fsync` 延迟：
            
```
#!/usr/bin/env bpftrace

// 追踪 ext4 fsync 延迟分布
kprobe:ext4_sync_file
{
    @start[tid] = nsecs;
}

kretprobe:ext4_sync_file
/@start[tid]/
{
    $lat = nsecs - @start[tid];
    @fsync_us = hist($lat / 1000);
    delete(@start[tid]);
}
```

            

这个脚本比 `ext4slower`
            更灵活——它可以和其他追踪点组合使用。例如，同时追踪
            `ext4_sync_file` 和
            `blk_mq_start_request`，就能看到一次
            `fsync` 调用到底触发了多少个块 I/O 请求。
            

### 5.4 bpftrace 的局限

            

`bpftrace`
            的设计目标是简洁，这也带来了一些限制：
            
            
- 字符串处理能力有限，不能做复杂的字符串拼接或正则匹配。
            
- 不支持循环，无法遍历内核数据结构中的链表。
            
- Map（映射）的 key 最多支持有限数量的字段。
            
- 在高频率事件上（例如 100K+ IOPS
            的每个请求都追踪）可能有可观的开销，需要评估。
            
            

如果需要更复杂的逻辑，回退到 BCC（用 Python + C 编写 eBPF
            程序）或直接用 libbpf 编写 C 程序。
            
            

## 六、ftrace 追踪 I/O 路径

            

### 6.1 ftrace 概述

            

ftrace（Function Tracer）是 Linux
            内核内建的追踪框架，不需要安装任何额外工具。它通过
            `/sys/kernel/tracing`（或旧版的
            `/sys/kernel/debug/tracing`）目录下的文件接口控制，可以追踪内核函数调用、跟踪事件、记录函数执行时间。
            

ftrace 在 I/O 分析中的主要用途：
            
            
- 追踪 I/O 请求在内核中的完整调用路径。
            
- 记录特定内核函数的执行时间。
            
- 结合 function_graph tracer 生成可读的调用关系图。
            
            

### 6.2 使用
            function_graph 追踪 I/O 路径

            

`function_graph` tracer
            可以显示内核函数的调用层次和耗时，非常适合追踪一个 I/O
            请求在内核中走过的完整路径。
            
```
# 进入 tracing 目录
cd /sys/kernel/tracing

# 设置 function_graph tracer
echo function_graph > current_tracer

# 只追踪块 I/O 相关的函数
echo 'blk_*' > set_ftrace_filter
echo 'submit_bio*' >> set_ftrace_filter
echo 'ext4_file_write_iter' >> set_ftrace_filter

# 限制追踪深度，避免输出过多
echo 5 > max_graph_depth

# 只追踪特定进程
echo $PID > set_ftrace_pid

# 开始追踪
echo 1 > tracing_on

# 等待一段时间后停止
sleep 5
echo 0 > tracing_on

# 查看结果
cat trace
```

            

输出示例（经删减）：
            
```
# tracer: function_graph
#
# CPU  DURATION                  FUNCTION CALLS
# |     |   |                     |   |   |   |
   2)               |  ext4_file_write_iter() {
   2)               |    ext4_buffered_write_iter() {
   2)   0.450 us    |      ext4_write_checks();
   2)               |      generic_perform_write() {
   2)               |        ext4_da_write_begin() {
   2)   0.280 us    |          ext4_journal_check_start();
   2)   1.200 us    |          grab_cache_page_write_begin();
   2)   2.100 us    |        }
   2)   0.150 us    |        copy_page_from_iter_atomic();
   2)               |        ext4_da_write_end() {
   2)   0.320 us    |          generic_write_end();
   2)   0.650 us    |        }
   2)   4.200 us    |      }
   2)   5.800 us    |    }
   2)   6.100 us    |  }
```

            

这段输出清楚地展示了一次 ext4 buffered write
            的内核调用路径和每一步的耗时。可以看到：
            
            
- 整个 `ext4_file_write_iter` 耗时 6.1us。
            
- 其中 `grab_cache_page_write_begin`（获取 Page
            Cache 页面）耗时 1.2us，是最耗时的步骤。
            
- `copy_page_from_iter_atomic`（将用户态数据拷贝到内核页面）只要
            0.15us。
            
            

### 6.3 使用 trace
            event 追踪块 I/O 事件

            

ftrace 的 trace event 机制与 `blktrace`
            使用相同的内核 tracepoint，但不需要专门的
            `blktrace` 工具：
            
```
cd /sys/kernel/tracing

# 启用块 I/O 相关的 trace event
echo 1 > events/block/block_rq_issue/enable
echo 1 > events/block/block_rq_complete/enable

# 可选：按设备过滤（假设设备号为 259,0 即 nvme0n1）
echo 'dev == 0x10300' > events/block/block_rq_issue/filter

# 开始追踪
echo 1 > tracing_on
sleep 5
echo 0 > tracing_on

# 查看结果
cat trace
```

            

输出示例：
            
```
     mysqld-12345 [002] .... 12345.678900: block_rq_issue: 259,0 W 4096 () 12345678 + 8 [mysqld]
     -0     [002] ..s. 12345.679150: block_rq_complete: 259,0 W () 12345678 + 8 [0]
```

            

### 6.4 trace-cmd：ftrace
            的友好前端

            

直接操作 `/sys/kernel/tracing`
            下的文件比较繁琐且容易出错。`trace-cmd` 是 ftrace
            的命令行前端，简化了操作流程：
            
```
# 录制块 I/O 事件，持续 10 秒
trace-cmd record -e block:block_rq_issue -e block:block_rq_complete sleep 10

# 查看录制结果
trace-cmd report
```

            

`trace-cmd` 还支持 function graph 追踪：
            
```
# 录制 ext4 写路径的 function graph
trace-cmd record -p function_graph -g ext4_file_write_iter -P $PID sleep 5
trace-cmd report
```

            

这比手动设置 ftrace 文件系统接口方便得多。
            

### 6.5 ftrace 与
            blktrace / BCC 的选择

            

三者的适用场景不同：
            
            
            
            
            
            
            
            
            
            维度
            ftrace
            blktrace
            BCC/bpftrace
            
            
            
            
            安装要求
            内核内建，无需安装
            需要 blktrace 包
            需要 BCC/bpftrace 包和内核头文件
            
            
            观测范围
            任意内核函数
            仅块设备层
            任意内核函数 + tracepoint
            
            
            输出形式
            文本流
            二进制追踪文件
            文本流或聚合统计
            
            
            聚合能力
            无，只输出原始事件
            btt 可做统计
            内核态聚合，开销低
            
            
            生产环境安全性
            需谨慎，function tracer 开销大
            中等开销
            低开销（聚合模式）
            
            
            适合场景
            追踪内核调用路径、函数耗时
            块层详细分析、延迟分解
            生产环境持续观测、自定义分析
            
            
            
            

经验规则：开发和调试阶段用 ftrace 看调用路径，性能分析用
            blktrace 做延迟分解，生产监控用 BCC/bpftrace
            做低开销观测。
            
            

## 七、perf 分析 I/O 栈 CPU
            消耗

            

### 7.1 I/O 路径上的 CPU 开销

            

I/O
            性能不只是磁盘的事。数据从应用到达磁盘，中间经过系统调用、VFS、文件系统、块层、驱动等多层软件处理，每一层都消耗
            CPU。在高 IOPS 场景下（例如 NVMe 设备轻松达到数十万
            IOPS），I/O 路径上的 CPU 开销可能成为瓶颈——磁盘还没饱和，CPU
            先跑满了。
            

`perf` 是 Linux
            内核提供的性能分析工具，可以通过采样（Sampling）CPU
            的调用栈，找出 I/O 路径上哪些函数消耗了最多的 CPU 时间。
            

### 7.2 perf record
            + perf report：找到热点函数

            
```
# 对整个系统采样 30 秒，采样频率 999Hz，记录调用栈
perf record -a -g -F 999 -- sleep 30

# 查看报告
perf report --no-children
```

            

在 `perf report` 的交互界面中，按 overhead
            排序，找到与 I/O 相关的内核函数。典型的 I/O
            路径热点函数包括：
            
```
Overhead  Command    Shared Object       Symbol
  12.50%  mysqld     [kernel.kallsyms]   [k] copy_user_enhanced_fast_string
   8.30%  mysqld     [kernel.kallsyms]   [k] blk_mq_submit_bio
   5.20%  mysqld     [kernel.kallsyms]   [k] ext4_file_write_iter
   4.10%  mysqld     [kernel.kallsyms]   [k] __block_commit_write
   3.80%  mysqld     [kernel.kallsyms]   [k] submit_bio_noacct
   2.50%  mysqld     [kernel.kallsyms]   [k] blk_mq_try_issue_directly
```

            

从这个输出可以看到：`copy_user_enhanced_fast_string`（用户态到内核态的数据拷贝）占了
            12.5% 的 CPU，是最大的热点。这在大量小 I/O
            场景下很典型——每次 4KB
            的写入都需要做一次内存拷贝，拷贝操作本身累积起来占了可观的
            CPU 时间。
            

### 7.3 perf 与火焰图

            

`perf record` 的输出可以转换为火焰图（Flame
            Graph），以可视化的方式展示调用栈和 CPU 占比。Brendan Gregg
            开发的 FlameGraph 工具是标准做法：
            
```
# 采样
perf record -a -g -F 999 -- sleep 30

# 生成折叠调用栈
perf script | stackcollapse-perf.pl > out.folded

# 生成火焰图 SVG
flamegraph.pl out.folded > io_flamegraph.svg
```

            

火焰图的 X 轴是调用栈的宽度（占 CPU 时间的比例），Y
            轴是调用深度。在 I/O
            相关的火焰图中，通常可以看到几个明显的”塔”：
            
            
- `write()` ->
            `ext4_file_write_iter` ->
            `generic_perform_write` ->
            `copy_page_from_iter_atomic`：应用写路径。
            
- `kworker` -> `wb_workfn` ->
            `ext4_writepages` ->
            `submit_bio`：Page Cache 回写路径。
            
- 中断处理路径：`nvme_irq` ->
            `blk_mq_complete_request` -> … ：I/O
            完成中断处理。
            
            

如果某个”塔”占的比例异常大，就是优化的切入点。
            

### 7.4 perf stat：量化 I/O
            路径指令数

            

`perf stat` 可以精确计数特定操作的 CPU
            指令数、缓存命中率等硬件性能计数器（Hardware Performance
            Counter）：
            
```
# 统计 fio 运行期间的 CPU 指令数和 IPC
perf stat -e instructions,cycles,cache-misses,cache-references -- \
    fio --name=test --ioengine=libaio --direct=1 --bs=4k --rw=randread \
    --size=1G --numjobs=1 --runtime=10 --filename=/dev/nvme0n1
```

            

输出示例：
            
```
 Performance counter stats for 'fio ...':

     2,345,678,901      instructions              #    1.20  insn per cycle
     1,954,732,418      cycles
        12,345,678      cache-misses              #   15.30 % of all cache refs
        80,691,358      cache-references

      10.005234567 seconds time elapsed
```

            

IPC（Instructions Per Cycle）是一个关键指标。I/O
            密集型负载的 IPC 通常较低（< 1.0），因为 CPU
            经常在等待内存或 I/O 完成。如果 IPC 接近或超过 1.0，说明 CPU
            在 I/O
            路径上确实在做大量计算工作（例如校验和计算、加密），而不只是等待。
            

### 7.5 perf trace：I/O
            系统调用追踪

            

`perf trace` 是 `strace`
            的低开销替代品，可以追踪系统调用而不像 `strace`
            那样用 ptrace 机制带来巨大开销：
            
```
# 追踪 PID 12345 的 I/O 相关系统调用
perf trace -e read,write,fsync,fdatasync,pread64,pwrite64 -p 12345
```

            

输出示例：
            
```
     0.000 ( 0.008 ms): mysqld/12345 pwrite64(fd: 45, buf: 0x7f..., count: 16384, offset: 1048576) = 16384
     0.012 ( 0.005 ms): mysqld/12345 pwrite64(fd: 45, buf: 0x7f..., count: 16384, offset: 1064960) = 16384
     0.020 (12.300 ms): mysqld/12345 fdatasync(fd: 45)                                              = 0
```

            

这段输出清楚地展示了：两次 `pwrite64`
            调用非常快（8us 和 5us），因为它们只是写入 Page
            Cache。但紧接着的 `fdatasync` 调用花了
            12.3ms——这个时间就是数据从 Page Cache
            刷到磁盘的实际耗时，是真正的 I/O 延迟。
            

`perf trace` 相比 `strace`
            的开销通常低一个数量级，可以在生产环境中使用。
            
            

## 八、I/O 性能排查流程图

            

### 8.1 排查决策树

            

以下流程图总结了 I/O 性能问题的排查路径。从”I/O
            延迟高”这个症状出发，逐步缩小范围：
            
```
                    I/O 延迟高
                       │
                       ▼
              ┌─── iostat -xz 1 ───┐
              │                     │
              ▼                     ▼
       %util  80%
       且 await 高             且 await 高
              │                     │
              ▼                     ▼
    不是设备瓶颈，          检查 aqu-sz
    向上层排查               是否很大
              │                     │
              ▼               ┌─────┴─────┐
    ext4slower /              ▼           ▼
    xfsslower              aqu-sz 大    aqu-sz 小
    检查文件系统           排队拥塞      设备本身慢
    级延迟                    │           │
              │               ▼           ▼
              ▼          biotop 找     smartctl
    cachestat           高 I/O 进程    检查设备
    检查缓存             调整队列深度   健康状态
    命中率                或限速
              │
              ▼
      命中率低 → 内存不足或工作集太大
      命中率高但延迟高 → 检查 fsync 路径
```

            

### 8.2 排查步骤详解

            

**第一步：iostat 全局扫描。** 运行
            `iostat -xz 1 5`，关注三个核心指标：`%util`（是否有设备层面的忙碌）、`r_await`/`w_await`（延迟是否正常）、`aqu-sz`（排队是否拥塞）。这一步的目的是判断：问题出在设备层还是上层软件。
            

**第二步：iotop / biotop 定位进程。**
            如果第一步发现设备确实繁忙，用 `iotop -o` 或
            `biotop` 找到哪个进程在做最多的
            I/O。区分是应用进程的直接 I/O
            还是内核线程（`jbd2`、`kworker`、`flush`）的后台
            I/O。
            

**第三步：biosnoop 看单请求延迟。**
            如果需要进一步区分排队延迟和设备延迟，用
            `biosnoop` 看每个请求的延迟。也可以用
            `blktrace` + `btt`
            做更精确的延迟分解（Q2D vs D2C）。
            

**第四步：向上层追溯。**
            如果设备层延迟正常，但应用层延迟高，用
            `ext4slower`/`xfsslower`
            检查文件系统层，用 `cachestat` 检查 Page Cache
            命中率，用 `perf trace` 检查系统调用延迟。
            

**第五步：perf 分析 CPU 瓶颈。** 如果 I/O
            设备和软件栈都正常，但 CPU 利用率很高，用
            `perf record` + 火焰图分析 I/O 路径上的 CPU
            热点。
            

### 8.3 快速检查清单

            

在执行上述流程之前，先做一组快速检查，排除常见的简单原因：
            
```
# 1. 磁盘空间是否充足
df -h

# 2. 文件系统是否处于只读状态（可能因为 I/O 错误触发）
mount | grep -E '(ro,|readonly)'

# 3. 是否有 I/O 错误（检查内核日志）
dmesg | grep -i -E '(error|fail|reset|timeout)' | tail -20

# 4. I/O 调度器配置
cat /sys/block/sda/queue/scheduler
cat /sys/block/nvme0n1/queue/scheduler

# 5. 队列深度配置
cat /sys/block/nvme0n1/queue/nr_requests

# 6. readahead 配置
blockdev --getra /dev/sda
```

            
            

## 九、常见 I/O
            瓶颈模式与解决方案

            

### 9.1 模式一：Page Cache
            回写风暴

            

**症状**：应用的写延迟周期性地飙高，`iostat`
            显示 `w/s` 和 `wkB/s`
            出现周期性尖峰，`iotop` 显示 `kworker`
            或 `flush-*` 线程的写入量突然变大。
            

**根因**：应用持续做 buffered write（写入
            Page Cache），脏页（Dirty Page）在 Page Cache
            中累积。当脏页比例达到
            `dirty_background_ratio`（默认
            10%）时，内核启动后台回写（Background Writeback）；当达到
            `dirty_ratio`（默认
            20%）时，应用的写入会被阻塞，直到脏页比例降下来。阻塞期间应用的写延迟会从微秒级跳到几百毫秒甚至秒级。
            

**诊断命令**：
            
```
# 查看当前脏页量
cat /proc/meminfo | grep -i dirty

# 查看脏页阈值
sysctl vm.dirty_ratio vm.dirty_background_ratio vm.dirty_expire_centisecs

# 用 cachestat（BCC）观察实时缓存行为
cachestat 1
```

            

**解决方案**：
            
            
- 降低 `dirty_background_ratio`（例如从 10%
            调到 5%），让后台回写更早启动，避免脏页堆积。
            
- 降低 `dirty_ratio`（例如从 20% 调到
            10%），降低前台阻塞时的脏页量。
            
- 如果是数据库类应用，考虑使用 Direct
            I/O（`O_DIRECT`）绕过 Page
            Cache，由应用自己管理缓存。
            
            
```
# 调整脏页阈值（临时生效）
sysctl -w vm.dirty_background_ratio=5
sysctl -w vm.dirty_ratio=10
```

            

### 9.2 模式二：随机小 I/O
            打满 HDD

            

**症状**：HDD 设备的 `%util` 接近
            100%，`r_await` 达到 10-30ms，`r/s` 在
            100-200 之间（远低于 SSD 的能力），应用延迟高。
            

**根因**：HDD 的随机 I/O
            性能受限于机械寻道（Seek）时间，典型的随机 IOPS 只有
            100-200。如果应用的 I/O
            模式是随机读（例如数据库的索引查找），HDD 很容易被打满。
            

**诊断命令**：
            
```
# 检查 I/O 请求大小分布
bitesize 10

# 检查 I/O 的顺序性（看 blktrace 输出中的扇区号是否连续）
blktrace -d /dev/sda -w 5 -o seq_check
blkparse -i seq_check | awk '{print $8}' | head -100
```

            

**解决方案**：
            
            
- 将随机读密集的数据（例如数据库索引）迁移到 SSD。
            
- 增加内存，提升 Page Cache 命中率，减少实际落到磁盘的
            I/O。
            
- 调整 I/O 调度器：HDD 使用 `mq-deadline` 或
            `bfq` 调度器可以优化排序和合并。
            
            

### 9.3 模式三：fsync 延迟高

            

**症状**：应用的
            `fsync()`/`fdatasync()`
            延迟持续较高，`ext4slower` 显示
            `S`（sync）操作延迟 10-50ms。
            

**根因**：`fsync`
            需要将文件的所有脏数据和元数据刷到持久化存储。它的延迟取决于：脏数据量、设备写入速度、journal
            提交开销。如果应用每次事务都调用
            `fsync`（典型的数据库行为），`fsync`
            的延迟直接决定了事务吞吐量。
            

**诊断命令**：
            
```
# 追踪 fsync 延迟
ext4slower 1

# 看 fsync 触发的块 I/O 数量和大小
bpftrace -e 'kprobe:ext4_sync_file { @start[tid] = nsecs; }
kretprobe:ext4_sync_file /@start[tid]/ {
    printf("fsync lat: %d us\n", (nsecs - @start[tid]) / 1000);
    delete(@start[tid]);
}'

# 检查 ext4 的 journal 模式
mount | grep ext4
# 输出中 data=ordered 表示默认模式，data=journal 表示全 journal 模式
```

            

**解决方案**：
            
            
- 确认 ext4 的 journal 模式不是
            `data=journal`（除非有特殊需求），默认的
            `data=ordered` 开销更低。
            
- 如果使用 NVMe 设备，确认 `fsync`
            延迟是否与设备能力匹配——NVMe 的 `fsync`
            延迟应该在 0.1-1ms 之间。
            
- 考虑批量提交：将多个 `fsync`
            合并成一个（Group Commit），减少 journal 提交次数。InnoDB 的
            `innodb_flush_log_at_trx_commit=2`
            就是一种批量提交策略。
            
- 如果 journal 设备是瓶颈，将 ext4 的 journal
            放到单独的快速设备上（`tune2fs -J device=`）。
            
            

### 9.4 模式四：I/O
            调度器配置不当

            

**症状**：SSD/NVMe 设备的 `await`
            偏高，但设备本身
            D2C（设备服务时间）正常，Q2D（排队时间）偏长。
            

**根因**：I/O 调度器（I/O
            Scheduler）的选择影响请求排序和合并行为。Linux
            提供三种多队列调度器：`none`（无调度，直接派发）、`mq-deadline`（按截止时间排序）、`bfq`（带公平性的调度）。对
            NVMe 设备，`none` 调度器通常是最优选择——NVMe
            设备有自己的硬件队列和调度逻辑，软件层再做排序反而增加延迟。
            

**诊断命令**：
            
```
# 检查当前调度器
cat /sys/block/nvme0n1/queue/scheduler
# 输出示例：[none] mq-deadline

# 检查队列深度
cat /sys/block/nvme0n1/queue/nr_requests
```

            

**解决方案**：
            
```
# NVMe 设备使用 none 调度器
echo none > /sys/block/nvme0n1/queue/scheduler

# HDD 设备使用 mq-deadline 调度器
echo mq-deadline > /sys/block/sda/queue/scheduler
```

            

### 9.5 模式五：NUMA 跨节点
            I/O

            

**症状**：多路服务器上，I/O 延迟和 CPU
            使用率都偏高，且与 CPU 绑核策略相关——某些核上运行的线程 I/O
            延迟明显高于其他核。
            

**根因**：在 NUMA（Non-Uniform Memory
            Access）架构的服务器上，如果 I/O 处理线程运行在远端 NUMA
            节点上（即与 NVMe 控制器所在的 PCIe 总线不在同一个 NUMA
            节点），每次 I/O 操作都需要跨 NUMA 节点访问内存和 PCIe
            设备，延迟增加。
            

**诊断命令**：
            
```
# 查看 NVMe 设备的 NUMA 节点归属
cat /sys/block/nvme0n1/device/numa_node

# 查看进程的 CPU 亲和性
taskset -p $PID

# 用 perf 查看是否有大量远端内存访问
perf stat -e node-load-misses,node-store-misses -p $PID -- sleep 10
```

            

**解决方案**：
            
            
- 将 I/O 密集型线程绑定到与 NVMe 设备同一个 NUMA 节点的
            CPU 上。
            
- 配置 NVMe 的 I/O 队列与 CPU 的亲和性。
            
            

### 9.6 各模式速查对照表

            
            
            
            
            
            
            
            
            
            模式
            关键指标
            首选诊断工具
            核心解决方向
            
            
            
            
            Page Cache 回写风暴
            `w_await` 周期性飙高，`Dirty`
            页接近阈值
            cachestat、`/proc/meminfo`
            调低脏页阈值或改用 Direct I/O
            
            
            随机小 I/O 打满 HDD
            `%util` 100%，IOPS
            低（100-200），`rareq-sz` 小
            bitesize、iostat
            换 SSD 或增大缓存
            
            
            fsync 延迟高
            ext4slower 显示 S 操作 > 10ms
            ext4slower、perf trace
            Group Commit 或 journal 分离
            
            
            I/O 调度器不当
            Q2D 长、D2C 正常
            blktrace + btt
            NVMe 用 none 调度器
            
            
            NUMA 跨节点 I/O
            特定 CPU 延迟偏高，`node-load-misses` 高
            perf stat、numactl
            CPU 亲和性绑定
            
            
            
            
            

## 十、参考文献

            

### 规范与源码

            
            
- 

Linux 内核文档: Block Layer. https://docs.kernel.org/block/ . 块设备层的
            tracepoint 定义和 I/O 调度器文档。
            
- 

Linux 内核文档: ftrace. https://docs.kernel.org/trace/ftrace.html .
            ftrace 的使用方法、function_graph tracer 和 trace event
            机制。
            
- 

Linux 内核源码
            `block/blk-mq.c`、`block/blk-core.c`（Linux
            6.x）。块层请求提交和完成路径的实现。
            
- 

sysstat 项目源码. https://github.com/sysstat/sysstat .
            `iostat`、`pidstat` 等工具的实现，包括
            `/proc/diskstats` 的解析逻辑。
            
            

### 书籍与论文

            
            
- 

Gregg, Brendan. *Systems Performance: Enterprise
            and the Cloud*. 2nd Edition, Pearson, 2020. 第 9 章
            “Disks” 系统讲解了 I/O 性能分析方法论和工具链。
            
- 

Gregg, Brendan. *BPF Performance Tools*.
            Addison-Wesley, 2019. 第 9 章 “Disk I/O” 详细介绍了
            `biosnoop`、`biotop`、`bitesize`
            等 BCC 工具的设计和使用。
            
- 

Axboe, Jens. “blktrace User Guide.” https://www.kernel.org/doc/html/latest/block/blktrace.html
            . `blktrace` 的事件代码定义和 `btt`
            的统计方法。
            
            

### 工具与实验

            
            
- 

BCC (BPF Compiler Collection) 项目. https://github.com/iovisor/bcc .
            `biosnoop`、`biotop`、`ext4slower`、`bitesize`、`cachestat`
            等工具的源码和使用文档。
            
- 

bpftrace 项目. https://github.com/bpftrace/bpftrace .
            bpftrace 语法参考、内置变量和函数说明。
            
- 

Gregg, Brendan. FlameGraph. https://github.com/brendangregg/FlameGraph .
            `perf` 输出转火焰图的标准工具链。
            
            
            

**上一篇**: 存储基准测试方法论
            **下一篇**: 缓存工程：从
            Page Cache 到应用层缓存
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-16 · storage
                    

### 【存储工程】Linux I/O 栈全景：从 write() 到磁盘扇区

                    

当应用程序调用一次 write() 系统调用（System Call）时，数据并不会立刻落到磁盘扇区上。 它需要穿越内核中七个以上的软件层次，每一层都有独立的职责、数据结构和延迟开销。 理解这条完整路径，是进行存储性能调优和故障诊断的基础。
                

                
                    

2026-06-18 · architecture / observability
                    

### 【可观测性工程】内核追踪：ftrace、kprobe、uprobe、tracepoint 生产实战

                    

当用户态观测工具无法定位问题时，深入 Linux 内核追踪层。拆解 ftrace、tracepoint、kprobe、uprobe、bpftrace 的适用场景、WSL/生产复现步骤、安全边界，以及与 eBPF 全景和 linux-net 系列的阅读边界。
                

                
                    

2025-07-23 · linux / networking
                    

### 【Linux 网络子系统深度拆解】内核网络追踪工具箱：bpftrace/perf/ftrace 实战

                    

从内核 tracepoint 定义出发，系统讲解 bpftrace、perf、ftrace 三大工具在网络诊断中的实战用法：TCP 重传根因分析、softirq 延迟定位、收发包路径延迟剖析、conntrack 表满监控、per-function 火焰图，以及各工具的适用场景与性能开销对比。
                

                
                    

2027-02-10 · linux / ebpf
                    

### 【eBPF 系列】eBPF 性能分析工具链：perf → BCC → bpftrace → Parca 的演化

                    

你有火焰图，但它只能告诉你 CPU 在忙什么——CPU 不忙的时候呢？从 perf 到 Parca，Linux 性能分析工具链走过了 15 年，是时候搞清楚每个工具的真正定位了。