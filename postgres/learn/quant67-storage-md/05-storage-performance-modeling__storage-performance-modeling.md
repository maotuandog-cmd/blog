# 【存储工程】存储性能建模：IOPS、吞吐与延迟

来源: https://quant67.com/post/storage/05-storage-performance-modeling/storage-performance-modeling.html
日期: 2025-08-14 |

---

存储选型和调优的场景中，最常见的问题是：“这块盘能跑多少
            IOPS？”这个问题本身就有问题——IOPS
            离开了块大小、队列深度、读写比例和延迟约束，就是一个没有意义的数字。
            

一块 NVMe SSD 的规格书上写着”随机读 100 万
            IOPS”，但你的数据库实际只跑出 5
            万——差距不是盘的问题，而是你没有理解存储性能的三要素如何互相制约，也没有在正确的参数空间里做测试。
            

本文做三件事：建立存储性能的数学模型、用 fio（Flexible
            I/O
            Tester）实测验证、把模型落到容量规划和监控的工程实践中。
            

## 一、存储性能三要素

            

存储性能由三个指标描述：IOPS（Input/Output Operations Per
            Second，每秒输入输出操作数）、吞吐量（Throughput）和延迟（Latency）。这三个指标不是独立的，它们通过块大小和队列深度（Queue
            Depth）关联在一起。
            

### IOPS：每秒操作数

            

IOPS 衡量存储设备每秒能完成多少次 I/O
            操作，每次操作处理一个固定大小的数据块。关键点在于：IOPS
            和块大小绑定。同一块盘，4KB 随机读可能跑 10 万 IOPS，但
            256KB 随机读可能只有 5000
            IOPS——不是盘变慢了，而是每次操作搬运的数据量变大了。
            
```
IOPS 的含义：
- 4KB 随机读 100K IOPS → 每秒完成 10 万次 4KB 的读操作
- 64KB 随机读 20K IOPS → 每秒完成 2 万次 64KB 的读操作
- 两者的吞吐量相同：100K × 4KB = 20K × 64KB = 400 MB/s
```

            

IOPS 最常用于描述小块随机 I/O
            的性能，典型场景是数据库的随机读写（4KB~16KB
            的页）。对于大块顺序 I/O（比如视频流、大文件拷贝），IOPS
            不是有意义的指标，应该看吞吐量。
            

### 吞吐量：每秒数据量

            

吞吐量（也叫带宽，Bandwidth）衡量每秒传输的数据量，单位通常是
            MB/s 或 GB/s。吞吐量和 IOPS 的关系是：
            
```
吞吐量 = IOPS × 块大小

例如：
- 100K IOPS × 4KB = 400 MB/s
- 5K IOPS × 1MB = 5000 MB/s
```

            

吞吐量有上限。对于 SATA SSD，接口带宽上限约 560
            MB/s；对于 NVMe SSD（PCIe 4.0 x4），接口带宽上限约 7000
            MB/s。当块大小增大到一定程度，IOPS
            会下降，但吞吐量会先上升然后触及接口或介质的带宽上限。
            

### 延迟：单次操作耗时

            

延迟衡量一次 I/O
            操作从发起到完成的时间。这是用户最直接感知的指标。但”平均延迟”几乎总是一个误导性指标——真正需要关注的是延迟分布（Latency
            Distribution），特别是尾部延迟（Tail Latency）。
            
```
延迟的层次：
- 平均延迟（avg）：所有操作的算术平均
- P50：50% 的操作在此时间内完成（中位数）
- P99：99% 的操作在此时间内完成
- P999：99.9% 的操作在此时间内完成
- 最大延迟（max）：最慢的一次操作

一个真实的 NVMe SSD 延迟分布：
- 平均：80 μs
- P50：70 μs
- P99：200 μs
- P999：1500 μs（1.5 ms）
- 最大：15 ms
```

            

平均延迟 80 μs 看起来很好，但 P999 达到了 1.5 ms——每 1000
            次操作中有 1 次要等 1.5
            毫秒。对于数据库这种延迟敏感的应用，P99 和 P999
            比平均值重要得多。
            

### 三角关系：不可能同时最优

            

IOPS、吞吐量和延迟不是可以独立调优的三个旋钮。它们的关系可以用一句话概括：
            

**增加并发（队列深度）能提升 IOPS
            和吞吐量，但代价是延迟增加。**
            
```
队列深度对性能的影响（NVMe SSD 4KB 随机读，典型趋势）：

队列深度    IOPS        平均延迟      P99 延迟
───────────────────────────────────────────────
1           10,000      100 μs       150 μs
4           38,000      105 μs       200 μs
16          120,000     133 μs       500 μs
32          200,000     160 μs       800 μs
64          350,000     183 μs       1.5 ms
128         500,000     256 μs       3 ms
256         550,000     465 μs       8 ms

注：以上数据为典型企业级 NVMe SSD 的特征趋势，具体数值因型号而异。
```

            

队列深度从 1 增加到 128，IOPS 增长了 50
            倍，但平均延迟也增长了 2.5 倍，P99 延迟增长了 20
            倍。这就是存储性能的核心权衡：你不能同时要最高的 IOPS
            和最低的延迟。
            

### 队列深度：被忽视的关键参数

            

队列深度（Queue Depth，QD）是同时在设备上排队等待处理的
            I/O 请求数量。它是连接 IOPS、吞吐量和延迟的桥梁。
            

对于机械硬盘（HDD），队列深度 1~4
            就能让设备接近饱和——因为 HDD
            的内部并行度很低，只有一个磁头在工作。对于 NVMe
            SSD，设备内部有大量并行通道，需要 32~256
            的队列深度才能充分利用设备能力。
            
```
为什么 NVMe SSD 需要高队列深度？

NVMe SSD 内部架构（简化）：
控制器
├── 通道 0 ─── Die 0 ─── Plane 0, Plane 1
│              Die 1 ─── Plane 0, Plane 1
├── 通道 1 ─── Die 0 ─── Plane 0, Plane 1
│              Die 1 ─── Plane 0, Plane 1
├── ...
└── 通道 7 ─── Die 0 ─── Plane 0, Plane 1
               Die 1 ─── Plane 0, Plane 1

8 通道 × 2 Die × 2 Plane = 32 个可独立执行 I/O 的单元

队列深度为 1 时，同一时刻只有 1 个单元在工作，
其余 31 个单元闲置。队列深度至少要 32，才能让
所有单元都有活干。
```

            

## 二、存储性能数学模型

            

性能调优不能只靠试——需要一个模型来预测”改变参数 X
            会对性能产生什么影响”。排队论（Queueing
            Theory）为存储性能建模提供了数学基础。
            

### 利特尔定律

            

利特尔定律（Little’s Law）是排队论中最基础的公式：
            
```
L = λ × W

L = 系统中的平均请求数（即队列深度 + 正在服务的请求数）
λ = 平均到达率（即 IOPS）
W = 平均逗留时间（即平均延迟）
```

            

翻译到存储场景：
            
```
队列深度 = IOPS × 平均延迟

例如：
- 队列深度 32，平均延迟 100 μs
- IOPS = 32 / 0.0001s = 320,000 IOPS

反过来用：
- 目标 IOPS = 100,000，延迟要求 ≤ 200 μs
- 需要的队列深度 = 100,000 × 0.0002 = 20
```

            

利特尔定律的价值在于：给定三个变量中的任意两个，就能算出第三个。不需要知道延迟分布的具体形状，也不需要知道调度策略——它对所有稳态系统都成立。
            

### 利用率定律

            

利用率定律（Utilization
            Law）把设备利用率（Utilization）和服务时间（Service
            Time）联系起来：
            
```
U = λ × S

U = 设备利用率（0 到 1 之间）
λ = 到达率（IOPS）
S = 平均服务时间（每个请求在设备上的实际处理时间）
```

            

当利用率接近 1
            时，设备接近饱和。排队论告诉我们，排队延迟在利用率超过 70%
            之后会急剧增加：
            
```
M/M/1 排队模型下，平均响应时间 R：

R = S / (1 - U)

U = 0.5 → R = 2S      （利用率 50%，响应时间是服务时间的 2 倍）
U = 0.7 → R = 3.3S    （利用率 70%，响应时间是服务时间的 3.3 倍）
U = 0.8 → R = 5S      （利用率 80%，响应时间翻了 5 倍）
U = 0.9 → R = 10S     （利用率 90%，响应时间翻了 10 倍）
U = 0.95 → R = 20S    （利用率 95%，响应时间已经不可接受）
```

            

这就是为什么存储设备的利用率不能长期超过
            70~80%：一旦过了拐点，延迟会急剧恶化。`iostat`
            报告的 `%util` 如果长期高于
            80%，基本可以判定设备成为瓶颈。
            

### 队列深度与延迟的关系

            

队列深度增加时，吞吐量（IOPS）会先线性增长，然后逐渐饱和；延迟则会先保持平稳，然后指数级增长。这个关系可以用排队论的基本模型来理解：
            
```
性能曲线的典型形态：

IOPS                               延迟
  │      ┌────────── 饱和            │               ╱
  │     ╱                            │              ╱
  │    ╱                             │             ╱
  │   ╱                              │           ╱
  │  ╱                               │         ╱
  │ ╱                                │    ───╱
  │╱                                 │───
  └──────────────── QD               └──────────────── QD
      线性区  拐点  饱和区                平稳区  拐点  爆炸区
```

            

对于单个设备，存在一个最佳工作点（Knee
            Point）：队列深度刚好让设备充分利用，但还没有进入延迟爆炸区。工程上通常把这个点定在设备利用率
            60~70% 的位置。
            

### HDD 性能模型

            

HDD 的单次 I/O 延迟可以分解为三个物理时间：
            
```
HDD 单次随机 I/O 延迟 = 寻道时间 + 旋转延迟 + 传输时间

1. 寻道时间（Seek Time）
   - 磁头从当前磁道移动到目标磁道的时间
   - 典型值：平均 4~8 ms（企业级 7200 RPM）
   - 最坏情况（全行程寻道）：15~20 ms
   - 最好情况（相邻磁道）：0.5~1 ms

2. 旋转延迟（Rotational Latency）
   - 等待目标扇区旋转到磁头下方的时间
   - 平均值 = 旋转一圈时间 / 2
   - 7200 RPM → 一圈 8.33 ms → 平均旋转延迟 4.17 ms
   - 10000 RPM → 一圈 6 ms → 平均旋转延迟 3 ms
   - 15000 RPM → 一圈 4 ms → 平均旋转延迟 2 ms

3. 传输时间（Transfer Time）
   - 数据从盘片读到缓冲区（或反向）的时间
   - 取决于盘片的面密度和转速
   - 典型值：4KB 数据约 0.01~0.05 ms（可忽略）

典型 7200 RPM 企业级 HDD 的随机 4KB 读：
   延迟 ≈ 5 ms（寻道）+ 4.17 ms（旋转）+ 0.02 ms（传输）
        ≈ 9.2 ms

对应的 IOPS 上限（单线程）：
   IOPS = 1000 ms / 9.2 ms ≈ 109

这就是为什么一块 7200 RPM HDD 的随机 IOPS 通常只有 100~200。
```

            

对于顺序
            I/O，寻道时间和旋转延迟大幅减少（磁头基本不移动，数据连续排列在相邻扇区），性能主要受限于传输速率，典型值
            150~250 MB/s。
            

### SSD 性能模型

            

SSD 没有机械部件，性能模型和 HDD 完全不同。SSD
            的性能取决于内部并行度（Internal Parallelism）：
            
```
SSD 内部并行层次：

通道级并行（Channel-level）
├── 多个通道独立传输数据
├── 企业级 NVMe SSD 通常 8~16 个通道
└── 不同通道的操作可以完全并行

芯片级并行（Die-level / Chip-level）
├── 同一通道上可以挂多个 Die
├── 不同 Die 之间可以交错操作（Interleaving）
└── 通常每通道 2~4 个 Die

平面级并行（Plane-level）
├── 一个 Die 内通常有 2~4 个 Plane
├── 多平面操作（Multi-plane Operation）允许同时读写不同 Plane
└── 进一步倍增并行度

页级流水线（Page-level Pipeline）
├── 读操作：数据从 NAND 阵列读到页寄存器，再通过通道传输
├── 两个阶段可以流水线化
└── 减少总传输时间

SSD 理论最大 IOPS 估算：
   = 通道数 × 每通道 Die 数 × 每 Die Plane 数 / 单次读延迟

例如：8 通道 × 2 Die × 2 Plane = 32 个并行单元
单次 NAND 页读延迟 ≈ 50 μs（TLC）
理论 IOPS = 32 / 0.00005s = 640,000 IOPS

实际 IOPS 会低于理论值，因为：
- FTL（Flash Translation Layer）查表开销
- 控制器调度开销
- 垃圾回收（GC）和磨损均衡干扰
- 通道竞争和总线冲突
```

            

## 三、fio 基准测试实战

            

fio（Flexible I/O
            Tester）是存储基准测试的事实标准工具。作者 Jens Axboe
            同时也是 Linux 内核块层（Block Layer）的主要维护者，fio 对
            Linux I/O 栈的覆盖是最完整的。
            

### 安装

            
```
# Debian / Ubuntu
sudo apt-get install -y fio

# CentOS / RHEL
sudo yum install -y fio

# 从源码编译（获取最新版本）
git clone https://github.com/axboe/fio.git
cd fio
./configure
make
sudo make install

# 确认版本
fio --version
```

            

### 核心参数

            

fio 的参数很多，但核心参数只有几个：
            
```
关键参数说明：

--rw=          I/O 模式
               read        顺序读
               write       顺序写
               randread    随机读
               randwrite   随机写
               randrw      混合随机读写（配合 --rwmixread 控制读比例）

--bs=          块大小
               4k          4KB（数据库典型场景）
               64k         64KB
               1m          1MB（大文件传输场景）

--iodepth=     队列深度
               1           同步 I/O（一次只发一个请求）
               32          异步 I/O，同时排 32 个请求
               256         高并发，充分利用 NVMe 设备

--numjobs=     并行作业数
               1           单线程
               4           4 个线程并行

--runtime=     测试持续时间
               60          运行 60 秒
               300         运行 5 分钟（建议至少 60 秒）

--size=        每个作业的测试文件大小
               1g          1GB
               10g         10GB（建议大于设备缓存）

--ioengine=    I/O 引擎
               libaio      Linux 原生异步 I/O（推荐）
               io_uring    Linux 5.1+ 新一代异步 I/O
               sync        同步 I/O
               psync       pread/pwrite 同步 I/O

--direct=1     绕过页缓存（Page Cache），直接对设备做 I/O
               测试设备性能时必须加这个参数

--group_reporting  合并多个作业的统计数据
```

            

### 标准测试用例

            

下面是四个最常用的基准测试命令，覆盖了存储性能评估的基本面：
            
```
# 1. 4KB 随机读 —— 衡量 IOPS 能力
fio --name=randread-4k \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=32 \
    --numjobs=4 \
    --size=1g \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/dev/sdb

# 2. 4KB 随机写 —— 衡量写入 IOPS 和写放大
fio --name=randwrite-4k \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=32 \
    --numjobs=4 \
    --size=1g \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/dev/sdb

# 3. 128KB 顺序读 —— 衡量吞吐量上限
fio --name=seqread-128k \
    --ioengine=libaio \
    --direct=1 \
    --rw=read \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --size=1g \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/dev/sdb

# 4. 128KB 顺序写 —— 衡量写入吞吐量
fio --name=seqwrite-128k \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --size=1g \
    --runtime=60 \
    --time_based \
    --group_reporting \
    --filename=/dev/sdb
```

            

### fio 输出解读

            

fio 的输出信息密度很高，需要知道每个字段的含义：
            
```
fio 典型输出（以 4KB 随机读为例，输出经删减）：

randread-4k: (groupid=0, jobs=4): err= 0: pid=12345: Mon Aug 14 10:00:00 2025
  read: IOPS=285k, BW=1114MiB/s (1168MB/s)(65.3GiB/60001msec)
    slat (nsec): min=1200, max=85600, avg=1850.32, stdev=520.15
    clat (usec): min=18, max=12500, avg=420.50, stdev=185.30
     lat (usec): min=20, max=12520, avg=422.35, stdev=185.50
    clat percentiles (usec):
     |  1.00th=[   95],  5.00th=[  135], 10.00th=[  167],
     | 20.00th=[  225], 30.00th=[  285], 50.00th=[  375],
     | 70.00th=[  490], 80.00th=[  570], 90.00th=[  685],
     | 95.00th=[  800], 99.00th=[ 1120], 99.50th=[ 1400],
     | 99.90th=[ 3200], 99.95th=[ 5000], 99.99th=[ 9500]
   bw (  KiB/s): min=980000, max=1200000, per=100.00%, avg=1141000.00
   iops        : min=245000, max=300000, avg=285250.00
  lat (usec)   : 50=0.01%, 100=1.20%, 250=22.30%, 500=48.50%
  lat (usec)   : 750=20.00%, 1000=5.50%
  lat (msec)   : 2=2.00%, 4=0.40%, 10=0.08%, 20=0.01%
```

            

各字段含义：
            
```
字段解读：

IOPS=285k          每秒完成 28.5 万次 I/O 操作
BW=1114MiB/s       吞吐量 1114 MiB/s（1168 MB/s）

slat（Submission Latency）提交延迟
  从应用调用 I/O 到请求进入内核队列的时间
  正常值应该在个位数 μs 以内

clat（Completion Latency）完成延迟
  从请求进入设备队列到完成的时间
  这是最核心的延迟指标

lat（Total Latency）总延迟
  lat ≈ slat + clat

clat percentiles    延迟百分位分布
  P99 = 1120 μs    99% 的请求在 1.12 ms 内完成
  P999 = 3200 μs   99.9% 的请求在 3.2 ms 内完成

bw                  带宽统计（最小、最大、平均）
iops                IOPS 统计（最小、最大、平均）
```

            

### fio 作业文件

            

命令行参数适合临时测试，正式基准测试建议使用作业文件（Job
            File），方便复现和版本管理：
            
```
; 文件名：storage-benchmark.fio
; 用途：全面评估存储设备性能

[global]
ioengine=libaio
direct=1
time_based
runtime=120
size=4g
group_reporting
filename=/dev/sdb

; 4KB 随机读 —— IOPS 能力
[rand-read-4k-qd1]
rw=randread
bs=4k
iodepth=1
numjobs=1
stonewall

[rand-read-4k-qd32]
rw=randread
bs=4k
iodepth=32
numjobs=4
stonewall

; 4KB 随机写 —— 写入 IOPS
[rand-write-4k-qd32]
rw=randwrite
bs=4k
iodepth=32
numjobs=4
stonewall

; 128KB 顺序读 —— 读吞吐量
[seq-read-128k]
rw=read
bs=128k
iodepth=32
numjobs=1
stonewall

; 128KB 顺序写 —— 写吞吐量
[seq-write-128k]
rw=write
bs=128k
iodepth=32
numjobs=1
stonewall

; 混合随机读写 —— 模拟数据库负载
[randrw-4k-mix]
rw=randrw
rwmixread=70
bs=4k
iodepth=16
numjobs=4
stonewall
```

            
```
# 运行作业文件
fio storage-benchmark.fio

# 输出 JSON 格式结果，便于后续分析
fio storage-benchmark.fio --output-format=json --output=result.json

# 用 fio 的 terse 模式输出，便于脚本解析
fio storage-benchmark.fio --output-format=terse
```

            

### 常见错误与规避

            

用 fio 测试时，有几个容易踩的坑：
            

**错误一：没加 `--direct=1`。**
            不加这个参数，数据会经过页缓存（Page
            Cache）。你测到的不是设备性能，而是内存性能。对于小文件和短时间测试，缓存命中率极高，测出的
            IOPS 可能是真实值的 10~100 倍。
            

**错误二：测试文件太小。** SSD
            有设备端缓存（DRAM 缓存或 SLC
            缓存）。如果测试文件小于缓存容量，测到的是缓存性能而不是
            NAND 性能。建议测试文件大小至少为设备容量的 2
            倍缓存大小以上，或者用整个设备做测试。
            

**错误三：运行时间太短。** SSD
            在短时间内可能表现出突发性能（Burst
            Performance），远高于稳态性能（Steady State）。建议至少运行
            60 秒，正式测试运行 300
            秒以上。写入测试尤其需要长时间运行，因为垃圾回收（Garbage
            Collection，GC）的影响要几分钟后才会体现。
            

**错误四：队列深度设为 1 就下结论。**
            队列深度 1
            只能测出设备的最低延迟，无法反映设备在高并发下的吞吐能力。需要测试多个队列深度（1、4、16、32、64、128），画出
            IOPS-延迟曲线，才能完整描述设备的性能特征。
            

**错误五：使用文件系统而非裸设备。**
            文件系统会引入额外的开销（日志、元数据更新、空间分配）。如果目的是评估设备本身的性能，应该直接用块设备（`/dev/sdb`）做测试。如果目的是评估应用场景下的性能，才应该在文件系统上测试。
            
```
# 正确的测试前准备流程

# 1. 确认测试设备（注意不要选错盘）
lsblk
# NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINT
# sda      8:0    0   500G  0 disk
# └─sda1   8:1    0   500G  0 part /
# sdb      8:16   0   1.8T  0 disk          ← 待测设备

# 2. 确认设备没有被挂载
mount | grep sdb
# （应该没有输出）

# 3. 如果测试写入，确认设备上没有重要数据
# 写入测试会销毁所有数据

# 4. 如果是 SSD，先用 fio 做预处理（填满整个设备）
# 模拟稳态性能而非出厂初始性能
fio --name=precondition \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --size=100% \
    --filename=/dev/sdb
```

            

## 四、不同存储介质的性能画像

            

不同存储介质在
            IOPS、吞吐量、延迟三个维度上的表现差异巨大。这一节给出各类介质在典型工作负载下的性能数据，作为选型和容量规划的参考基线。
            
            

以下数据来自公开的产品规格书和技术评测，代表各类介质的典型性能水平，具体数值因型号和配置而异。
            
            

### 各介质性能对比

            
```
4KB 随机读性能对比（队列深度 32）：

介质类型           IOPS        平均延迟      P99 延迟     每 GB 成本
──────────────────────────────────────────────────────────────────────
7200 RPM HDD       ~180        ~8 ms         ~20 ms       ~$0.015
10K RPM HDD        ~250        ~5 ms         ~15 ms       ~$0.03
15K RPM HDD        ~350        ~3.5 ms       ~10 ms       ~$0.05
SATA SSD           ~90,000     ~0.15 ms      ~0.5 ms      ~$0.08
NVMe SSD (TLC)     ~500,000    ~0.08 ms      ~0.3 ms      ~$0.10
NVMe SSD (高端)     ~1,000,000  ~0.06 ms      ~0.15 ms     ~$0.20
Intel Optane        ~550,000    ~0.01 ms      ~0.02 ms     ~$0.50
```

            
```
128KB 顺序读吞吐量对比：

介质类型           吞吐量 (MB/s)    接口带宽限制
──────────────────────────────────────────────────
7200 RPM HDD       150-250         SATA 6Gbps (~560 MB/s)
SATA SSD           500-560         SATA 6Gbps (~560 MB/s)
NVMe SSD (PCIe 3.0 x4)   3000-3500     PCIe 3.0 x4 (~3.9 GB/s)
NVMe SSD (PCIe 4.0 x4)   6000-7000     PCIe 4.0 x4 (~7.8 GB/s)
NVMe SSD (PCIe 5.0 x4)   10000-14000   PCIe 5.0 x4 (~15.7 GB/s)
Intel Optane        2500-2700      PCIe 3.0 x4 (~3.9 GB/s)
```

            

### HDD 性能画像

            

HDD 的核心特征是：顺序性能尚可，随机性能极差。
            
```
7200 RPM 企业级 HDD 典型性能：

                    IOPS        吞吐量        平均延迟
顺序读              -           200 MB/s      -
顺序写              -           190 MB/s      -
随机读 (QD=1)       ~100        0.4 MB/s      ~9 ms
随机读 (QD=32)      ~180        0.7 MB/s      ~8 ms（NCQ 优化后）
随机写 (QD=1)       ~100        0.4 MB/s      ~9 ms
随机写 (QD=32)      ~180        0.7 MB/s      ~8 ms

关键观察：
1. 队列深度对 HDD 随机性能的帮助有限（~1.8x），因为 NCQ 只能做有限的请求重排
2. 随机读写 IOPS 差距不大，因为瓶颈在机械运动，不在 NAND 编程
3. 顺序和随机性能差距达 500 倍以上
4. 这就是为什么数据库在 HDD 上要尽一切努力把随机写变成顺序写（WAL / LSM-Tree）
```

            

### SATA SSD 性能画像

            

SATA SSD 受限于 SATA 接口带宽（约 560
            MB/s），顺序性能接近接口上限，但随机性能已经比 HDD
            好了两个数量级：
            
```
SATA SSD（企业级 TLC）典型性能：

队列深度    随机读 IOPS    随机写 IOPS    读延迟      写延迟
─────────────────────────────────────────────────────────────
1           8,000          20,000         120 μs      50 μs
4           28,000         55,000         140 μs      70 μs
16          70,000         70,000         220 μs      220 μs
32          90,000         75,000         350 μs      420 μs

注意：
1. 随机写在低队列深度时比随机读快，因为 SSD 控制器可以先写入 DRAM 缓存再确认
2. 高队列深度时写 IOPS 可能下降，因为 DRAM 缓存写满后要等 NAND 编程
3. 顺序读写均接近 SATA 接口上限 ~550 MB/s
```

            

### NVMe SSD 性能画像

            

NVMe SSD 通过 PCIe 直连 CPU，彻底摆脱了 SATA
            接口的带宽限制，同时 NVMe 协议本身支持 64K 队列、每队列 64K
            命令的并发深度：
            
```
NVMe SSD（企业级 TLC，PCIe 4.0 x4）典型性能：

队列深度    随机读 IOPS    随机写 IOPS    读延迟      写延迟
─────────────────────────────────────────────────────────────
1           12,000         50,000         80 μs       20 μs
4           45,000         150,000        88 μs       26 μs
16          160,000        300,000        100 μs      53 μs
32          300,000        400,000        106 μs      80 μs
64          500,000        450,000        128 μs      142 μs
128         700,000        470,000        183 μs      272 μs
256         800,000        480,000        320 μs      533 μs

关键观察：
1. 随机读 IOPS 随队列深度线性增长直到约 QD=128
2. 随机写 IOPS 在 QD=64 后趋于饱和（NAND 编程速度限制）
3. QD=1 到 QD=256，读延迟增长了 4 倍，但 IOPS 增长了 66 倍
4. 吞吐量：QD=32 随机读 300K × 4KB = 1.17 GB/s；顺序读可达 6.5 GB/s
```

            

### Optane
            持久内存的特殊地位

            

Intel Optane（基于 3D XPoint 技术）的核心优势不是 IOPS
            峰值，而是延迟的一致性（Consistency）：
            
```
Optane P5800X 典型性能：

队列深度    随机读 IOPS    随机读延迟    P99 延迟     P999 延迟
──────────────────────────────────────────────────────────────
1           15,000         7 μs         10 μs        12 μs
4           55,000         7.5 μs       11 μs        14 μs
16          200,000        8 μs         12 μs        16 μs
32          400,000        9 μs         14 μs        20 μs
64          550,000        11 μs        18 μs        25 μs

对比 NVMe TLC SSD：
- 平均延迟：Optane 低 10 倍
- P99/P999 延迟：Optane 低 15~20 倍
- P999/avg 比值：Optane ≈ 1.7x，TLC SSD ≈ 10~40x

Optane 的延迟分布极其紧凑，几乎没有长尾。
这使它成为对延迟一致性极度敏感的场景（如金融交易系统、元数据服务）的理想选择。
```

            

## 五、I/O 模式分析

            

存储性能不只取决于设备，也取决于工作负载的 I/O 模式（I/O
            Pattern）。同一块盘在不同 I/O 模式下的性能差距可以超过 100
            倍。
            

### 顺序与随机

            

顺序 I/O（Sequential I/O）指按照 LBA（Logical Block
            Address，逻辑块地址）递增或递减的顺序访问数据。随机
            I/O（Random I/O）指 LBA 之间没有空间局部性。
            
```
顺序 vs 随机对性能的影响：

                    HDD (7200 RPM)      NVMe SSD (TLC)
顺序读 (128KB)      200 MB/s             6500 MB/s
随机读 (4KB)         0.7 MB/s             1200 MB/s
顺序/随机比值        285x                 5.4x

HDD 上顺序和随机性能差距 285 倍——因为随机 I/O 要反复寻道。
SSD 上差距收窄到 5.4 倍——但仍然存在，原因是：
1. 顺序 I/O 用大块传输，单次操作搬更多数据
2. SSD 控制器对顺序 I/O 有预读优化
3. NAND 的页大小通常 4~16KB，顺序写更容易对齐
```

            

### 读与写与混合

            

读和写的性能差异在不同介质上表现不同：
            
```
读写性能差异：

HDD：
  随机读和随机写的延迟基本相同（都受机械运动限制）

SSD：
  写通常比读慢：
  - NAND 编程（写入）延迟：TLC ~1500 μs，QLC ~5000 μs
  - NAND 页读延迟：TLC ~50 μs，QLC ~75 μs
  - 但 SSD 控制器用 DRAM 缓存掩盖写延迟，短期写入可能看起来很快
  - 长时间大量写入后，缓存写满，性能会显著下降（写悬崖）

混合读写（Mixed I/O）：
  混合工作负载的性能通常低于纯读或纯写
  原因：读写请求竞争内部资源，SSD 控制器调度复杂度增加
```

            

### 块大小的影响

            

块大小（Block Size）对性能的影响是非线性的：
            
```
块大小对 NVMe SSD 性能的影响（随机读，QD=32）：

块大小    IOPS        吞吐量        延迟
──────────────────────────────────────────
512B      350,000     171 MB/s      91 μs
4KB       300,000     1172 MB/s     106 μs
8KB       250,000     1953 MB/s     128 μs
16KB      180,000     2812 MB/s     177 μs
64KB      80,000      5000 MB/s     400 μs
128KB     45,000      5625 MB/s     711 μs
256KB     25,000      6250 MB/s     1.28 ms
1MB       7,000       7000 MB/s     4.57 ms

观察：
1. 块大小从 4KB 增加到 1MB，IOPS 下降了 43 倍
2. 但吞吐量增加了 6 倍，逼近接口带宽上限
3. 延迟也随块大小增加——每次操作传输的数据越多，耗时越长
4. 没有"最佳块大小"，选择取决于工作负载特征
```

            

### I/O 模式追踪工具

            

blktrace（Block Layer Trace）和 blkparse 是 Linux
            内核块层的追踪工具，用于捕获和分析实际工作负载的 I/O
            模式：
            
```
# 开始追踪 /dev/sdb 的 I/O 活动
sudo blktrace -d /dev/sdb -o trace

# 在另一个终端运行你的工作负载...

# 停止追踪（Ctrl+C）
# 解析追踪文件
blkparse -i trace -o trace.txt

# blkparse 输出示例（经删减）：
#  8,16   1        1     0.000000000 12345  Q   R 1048576 + 8 [mysqld]
#  8,16   1        2     0.000001200 12345  G   R 1048576 + 8 [mysqld]
#  8,16   1        3     0.000002500 12345  D   R 1048576 + 8 [mysqld]
#  8,16   1        4     0.000085000 12345  C   R 1048576 + 8 [0]

# 字段含义：
# 设备号  CPU  序号  时间戳          PID    动作 类型 起始扇区 + 扇区数 [进程名]
# 动作：Q=排队  G=获取请求  D=下发设备  C=完成
# 类型：R=读  W=写
```

            

用 `btt`（blktrace
            自带工具）生成统计摘要：
            
```
# 生成 I/O 延迟统计
btt -i trace.bin -o summary

# 输出内容包括：
# - Q2C：从排队到完成的端到端延迟分布
# - D2C：从下发设备到完成的设备延迟分布
# - Q2D：排队等待时间分布
# - 每个进程的 I/O 统计
# - 顺序/随机比例
# - I/O 大小分布
```

            

使用 `bpftrace` 做轻量级的 I/O 模式分析：
            
```
# 统计各进程的 I/O 大小分布（使用 block:block_rq_issue 跟踪点）
sudo bpftrace -e '
tracepoint:block:block_rq_issue {
    @io_size[comm] = hist(args->bytes);
}
'

# 统计 I/O 延迟分布（使用 block_rq_issue 和 block_rq_complete 配对）
sudo bpftrace -e '
tracepoint:block:block_rq_issue {
    @start[args->sector] = nsecs;
}
tracepoint:block:block_rq_complete
/@start[args->sector]/ {
    @usecs = hist((nsecs - @start[args->sector]) / 1000);
    delete(@start[args->sector]);
}
'

# 输出示例（经删减）：
# @usecs:
# [16, 32)         120 |@@                              |
# [32, 64)        2500 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
# [64, 128)       1800 |@@@@@@@@@@@@@@@@@@@@@@@         |
# [128, 256)       450 |@@@@@                           |
# [256, 512)        80 |@                               |
# [512, 1K)         15 |                                |
# [1K, 2K)           3 |                                |
```

            

## 六、存储性能瓶颈定位

            

性能问题排查的第一步不是调参数，而是定位瓶颈在哪里：是设备本身、文件系统、内核
            I/O 栈，还是应用层？
            

### iostat 深度解读

            

`iostat`（来自 sysstat
            包）是存储性能分析最常用的工具：
            
```
# 每秒刷新一次，显示扩展统计
iostat -xz 1

# 典型输出（经删减）：
# Device   r/s    w/s    rkB/s    wkB/s  rrqm/s  wrqm/s  await  r_await  w_await  %util
# sda     150.00  50.00  4800.0   1600.0   5.00    20.00   2.50    2.00     4.00   35.00
# sdb    5000.00 2000.00 20000.0  8000.0   0.00     0.00   0.12    0.10     0.15   45.00
```

            

各字段的含义和诊断价值：
            
```
iostat -x 字段解读：

r/s, w/s         每秒读/写操作数（IOPS）
                 → 和你预期的 IOPS 对比，偏低说明应用发的不够或被其他地方卡住

rkB/s, wkB/s     每秒读/写数据量（KB/s）
                 → 吞吐量。rkB/s / r/s = 平均读请求大小

rrqm/s, wrqm/s   每秒合并的读/写请求数
                 → 合并说明有连续的小 I/O 被内核合并成大 I/O

avgqu-sz         平均请求队列长度
                 → 相当于利特尔定律中的 L
                 → 如果 avgqu-sz 持续大于设备能力，设备在排队

await            I/O 请求的平均等待时间（ms），包括排队和服务
                 → 最直接的延迟指标
                 → HDD 正常值 5~15 ms，SSD 正常值 0.05~0.5 ms

r_await, w_await 分开统计的读/写等待时间
                 → 写通常比读快（SSD 有缓存），如果 w_await 突然变高
                   可能是 SSD 缓存写满或正在 GC

%util            设备利用率
                 → 注意：对于并行设备（SSD），%util=100% 不代表设备饱和
                 → %util 只表示设备在该秒内至少有一个 I/O 在处理的时间比例
                 → 对于 SSD，应该结合 IOPS 和延迟来判断是否饱和
```

            

**关于 `%util` 的常见误解：**
            `%util` 的计算方式是”设备忙碌时间 /
            采样时间”。对于
            HDD（一次只能服务一个请求），`%util` 接近 100%
            确实意味着设备饱和。但对于
            SSD（可以同时服务数百个请求），`%util=100%`
            只说明每一毫秒都有至少一个请求在处理，设备可能远未饱和。判断
            SSD 是否饱和，应该看 IOPS 是否达到设备规格上限，以及
            `await` 是否开始异常升高。
            

### iotop：按进程排查

            

当 `iostat` 显示设备有大量
            I/O，但不确定是哪个进程产生的：
            
```
# 实时显示每个进程的 I/O 使用情况
sudo iotop -o -P

# 典型输出（经删减）：
# Total DISK READ:       50.00 M/s | Total DISK WRITE:      20.00 M/s
# PID    PRIO  USER     DISK READ  DISK WRITE  SWAPIN     IO>    COMMAND
# 12345  be/4  mysql     45.00 M/s   15.00 M/s  0.00 %  35.00 % mysqld
# 23456  be/4  root       5.00 M/s    5.00 M/s  0.00 %  10.00 % rsync
```

            
```
# 如果 iotop 不可用，也可以从 /proc 获取进程级 I/O 统计
cat /proc/12345/io

# 输出示例：
# rchar: 1234567890     （进程读取的字节数，包括缓存命中）
# wchar: 567890123      （进程写入的字节数，包括缓存）
# syscr: 100000         （read 系统调用次数）
# syscw: 50000          （write 系统调用次数）
# read_bytes: 890000000 （实际从存储设备读取的字节数）
# write_bytes: 450000000（实际写入存储设备的字节数）
# cancelled_write_bytes: 0
```

            

### /proc/diskstats 详解

            

`/proc/diskstats` 是 `iostat`
            数据的原始来源，包含内核维护的块设备统计计数器：
            
```
cat /proc/diskstats | grep sdb
# 输出（数字为累积计数器）：
#  8  16 sdb 1234567 5000 98765432 456000 567890 20000 45678901 234000 0 345000 690000 0 0 0 0 1000 2000
```

            
```
/proc/diskstats 各字段（从第 4 个字段开始，内核文档 Documentation/admin-guide/iostats.rst）：

字段 1:  读完成次数（rd_ios）
字段 2:  读合并次数（rd_merges）
字段 3:  读扇区数（rd_sectors）—— 每扇区 512 字节
字段 4:  读花费的毫秒数（rd_ticks）
字段 5:  写完成次数（wr_ios）
字段 6:  写合并次数（wr_merges）
字段 7:  写扇区数（wr_sectors）
字段 8:  写花费的毫秒数（wr_ticks）
字段 9:  当前正在处理的 I/O 数（in_flight）—— 瞬时值，不是累积值
字段 10: I/O 花费的毫秒数（io_ticks）—— 设备忙碌时间
字段 11: 加权 I/O 花费的毫秒数（time_in_queue）

iostat 的计算方式：
  r/s = Δrd_ios / Δtime
  w/s = Δwr_ios / Δtime
  await = (Δrd_ticks + Δwr_ticks) / (Δrd_ios + Δwr_ios)
  %util = Δio_ticks / Δtime × 100%
```

            

### 瓶颈定位决策树

            
```
存储性能瓶颈定位流程：

1. 应用层面的 I/O 延迟高吗？
   │
   ├── 是 → 检查 iostat await
   │         │
   │         ├── await 高 → 设备级瓶颈
   │         │    │
   │         │    ├── %util 持续 >80%（HDD）或 IOPS 接近规格上限（SSD）
   │         │    │   → 设备能力不足，升级设备或分散负载
   │         │    │
   │         │    ├── IOPS 远低于规格上限但 await 高
   │         │    │   → 检查 I/O 调度器、RAID 配置、SSD GC 状态
   │         │    │
   │         │    └── 间歇性 await 飙高
   │         │        → 可能是 SSD GC、RAID 重建、或后台任务干扰
   │         │
   │         └── await 正常 → 不是设备瓶颈
   │              │
   │              ├── 检查文件系统层面
   │              │   → 日志写入争用？元数据操作慢？锁竞争？
   │              │
   │              └── 检查内核 I/O 栈
   │                  → I/O 调度器队列满？cgroup I/O 限制？
   │
   └── 否 → 瓶颈不在存储，检查 CPU、内存、网络
```

            

## 七、延迟分布与尾延迟

            

### 平均延迟的误导性

            

假设一个存储系统的延迟如下：
            
```
场景：某存储系统处理 100 万次请求

延迟分布：
  99.0% 的请求：100 μs
  0.9% 的请求：1 ms（1000 μs）
  0.1% 的请求：50 ms（50000 μs）

平均延迟 = 0.99 × 100 + 0.009 × 1000 + 0.001 × 50000
         = 99 + 9 + 50
         = 158 μs

看起来不错？但 P99 = 1 ms，P999 = 50 ms。

如果一个用户请求要查询 100 个分片：
  至少一个分片 > 1 ms 的概率 = 1 - (0.99)^100 = 63.4%
  至少一个分片 > 50 ms 的概率 = 1 - (0.999)^100 = 9.5%

换句话说：
  63% 的用户请求会遇到 > 1 ms 的延迟
  近 10% 的用户请求会遇到 > 50 ms 的延迟

平均值完全掩盖了这个问题。
```

            

这就是为什么分布式系统中尾延迟特别重要：一个用户请求往往涉及多个后端节点，任何一个节点的慢响应都会拖累整体延迟。节点数越多，被尾延迟击中的概率越高。
            

### 尾延迟的来源

            

存储层面导致尾延迟的常见原因：
            
```
尾延迟来源分析：

1. SSD 垃圾回收（Garbage Collection）
   - SSD 写入时如果没有空闲块，需要先擦除旧块
   - 擦除操作耗时 3~15 ms（远高于正常读写的 μs 级别）
   - 如果 GC 和前台 I/O 竞争资源，前台延迟会跳变到 ms 级

2. 队列深度饱和
   - 设备处理能力有限，队列满后新请求必须等待
   - 排队延迟可以从 μs 级暴增到 ms 级
   - 利特尔定律：QD 越高，平均延迟越高

3. 热节流（Thermal Throttling）
   - NVMe SSD 在高负载下温度升高
   - 超过阈值（通常 70~80°C）后控制器降低性能以保护硬件
   - 表现为持续高负载几分钟后性能突然下降

4. NAND 读干扰和刷新
   - 频繁读取相邻页可能导致数据位翻转
   - 控制器定期执行数据刷新（Read Disturb Refresh），期间会阻塞正常 I/O

5. 操作系统层面
   - 内核调度导致 I/O 提交线程被抢占
   - 内存压力导致页回收（Page Reclaim）阻塞 I/O
   - 文件系统日志提交（Journal Commit）引入同步等待
```

            

### 用 fio 测量延迟分布

            

fio 可以输出详细的延迟直方图（Histogram）：
            
```
# 使用 --lat_percentiles=1 输出完整百分位延迟
fio --name=lat-test \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=1 \
    --numjobs=1 \
    --size=1g \
    --runtime=120 \
    --time_based \
    --lat_percentiles=1 \
    --percentile_list=50:90:95:99:99.5:99.9:99.95:99.99 \
    --filename=/dev/sdb

# 使用 --write_lat_log 输出每个 I/O 的延迟记录
fio --name=lat-trace \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=1 \
    --numjobs=1 \
    --size=1g \
    --runtime=60 \
    --time_based \
    --write_lat_log=latency \
    --filename=/dev/sdb

# latency_lat.log 格式：
# 时间戳(ms), 延迟(ns), 方向(0=读/1=写), 块大小, 偏移量, 命令标志
# 可以用 fio 自带的 fio_generate_plots 生成图表

# 生成延迟随时间变化的图表
fio_generate_plots latency
```

            

### 协调遗漏问题

            

协调遗漏（Coordinated
            Omission）是基准测试中的一个经典陷阱，由 Gil Tene 在 2013
            年提出。问题出在大多数基准测试工具对”发送速率”的处理方式上：
            
```
协调遗漏问题：

正常情况下，客户端以固定间隔发送请求：
  t=0ms   发送请求 1
  t=1ms   发送请求 2
  t=2ms   发送请求 3
  ...

如果请求 2 因为服务端卡顿耗时 100ms：
  t=0ms   发送请求 1，1ms 后完成
  t=1ms   发送请求 2，100ms 后完成（在 t=101ms 完成）
  t=101ms 发送请求 3（等请求 2 完成后才发）
  t=102ms 发送请求 4

问题：请求 3 和 4 的发送被推迟了，但它们的响应时间可能很快（1ms）。
     工具记录的延迟是：1ms, 100ms, 1ms, 1ms
     实际用户感知的延迟是：1ms, 100ms, 100ms, 101ms
     （因为请求 3 本该在 t=2ms 发送，实际在 t=101ms 才发出）

结果：工具统计的 P99 远低于用户实际感受的 P99。

fio 在 --rate 或 --rate_iops 模式下也会遇到这个问题。
解决方案：
1. 使用 --rate_process=poisson 让请求按泊松分布到达
2. 使用独立的延迟测量通道
3. 使用 wrk2（HTTP 基准测试）等修正了协调遗漏的工具
```

            

## 八、容量规划与选型计算

            

选型不是翻规格书选最贵的——而是根据工作负载特征，计算出需要多少
            IOPS 和吞吐量，然后选择满足要求且成本最低的方案。
            

### 工作负载特征化

            

容量规划的第一步是搞清楚工作负载长什么样：
            
```
工作负载特征化清单：

1. I/O 模式
   - 顺序占比 vs 随机占比
   - 读写比例
   - 典型块大小（取分布，不要只看平均值）
   - 是否有突发特征（Burst）

2. 性能需求
   - 峰值 IOPS 需求
   - 峰值吞吐量需求
   - 延迟要求（P99 还是 P999？上限是多少？）

3. 容量需求
   - 当前数据量
   - 年增长率
   - 保留期限
   - 是否需要冗余（RAID / 副本）

4. 可用性需求
   - 允许的停机时间
   - 数据持久性要求
   - 故障恢复时间
```

            

从现有系统采集工作负载特征：
            
```
# 使用 iostat 采集基线数据
# 建议采集至少 24 小时，覆盖业务高峰和低谷
iostat -xz 10 8640 > iostat_baseline.txt

# 分析平均和峰值
awk '/sdb/ {
    reads += $4; writes += $5;
    read_kb += $6; write_kb += $7;
    await_sum += $10; count++;
    if ($4 > max_reads) max_reads = $4;
    if ($10 > max_await) max_await = $10;
}
END {
    printf "平均读 IOPS: %.0f\n", reads/count;
    printf "平均写 IOPS: %.0f\n", writes/count;
    printf "平均读吞吐: %.0f KB/s\n", read_kb/count;
    printf "平均写吞吐: %.0f KB/s\n", write_kb/count;
    printf "平均延迟: %.2f ms\n", await_sum/count;
    printf "峰值读 IOPS: %.0f\n", max_reads;
    printf "峰值延迟: %.2f ms\n", max_await;
}' iostat_baseline.txt
```

            

### IOPS 预算计算

            
```
IOPS 预算计算示例：MySQL 数据库

已知条件：
- 峰值 TPS（Transactions Per Second）：5000
- 每个事务的平均 I/O 操作：
  - 随机读：8 次（索引查找 + 数据页读取）
  - 随机写：2 次（数据页更新）
  - 顺序写：1 次（Redo Log）

IOPS 需求计算：
  随机读 IOPS = 5000 × 8 = 40,000
  随机写 IOPS = 5000 × 2 = 10,000
  顺序写 IOPS = 5000 × 1 = 5,000（但顺序写通常用吞吐量衡量）

总随机 IOPS 需求 = 40,000 + 10,000 = 50,000

加上安全余量（建议 30~50%）：
  设计 IOPS = 50,000 × 1.4 = 70,000

延迟要求：
  数据库对读延迟敏感，P99 目标  3750 MB/s

结论：HDD 方案在满足容量的同时，也恰好满足了吞吐量需求。
     不需要用 NVMe SSD，省下大量成本。
```

            

### 数据库存储选型案例

            
```
完整选型案例：在线交易系统数据库

需求规格：
  - 峰值 TPS：10,000
  - 数据量：2TB（年增长 30%）
  - 读写比例：7:3
  - P99 延迟要求：
```
# 告警规则示例（Prometheus Alertmanager 格式）

groups:
  - name: storage_alerts
    rules:
      # 延迟告警：P99 延迟超过阈值
      - alert: HighDiskLatency
        expr: |
          rate(node_disk_read_time_seconds_total[5m])
          / rate(node_disk_reads_completed_total[5m]) * 1000 > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "磁盘读延迟超过 10ms"
          description: "设备 {{ $labels.device }} 平均读延迟 {{ $value }}ms"

      # 利用率告警：持续高利用率
      - alert: HighDiskUtilization
        expr: |
          rate(node_disk_io_time_seconds_total[5m]) * 100 > 85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "磁盘利用率持续超过 85%"
          description: "设备 {{ $labels.device }} 利用率 {{ $value }}%"

      # 队列深度告警：队列积压
      - alert: HighDiskQueueDepth
        expr: node_disk_io_now > 64
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘队列深度异常"
          description: "设备 {{ $labels.device }} 当前队列深度 {{ $value }}"

      # 写吞吐量突增：可能是日志风暴或数据倾斜
      - alert: DiskWriteSpike
        expr: |
          rate(node_disk_written_bytes_total[5m]) / 1024 / 1024 > 500
          and rate(node_disk_written_bytes_total[5m]) / 1024 / 1024
          > 3 * avg_over_time(
              rate(node_disk_written_bytes_total[1h])[24h:1h]
            ) / 1024 / 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "磁盘写入量突增"
```

            
```
各类存储介质的建议告警阈值：

                    HDD             SATA SSD        NVMe SSD
─────────────────────────────────────────────────────────────
延迟 Warning        > 20 ms         > 2 ms          > 1 ms
延迟 Critical       > 50 ms         > 10 ms         > 5 ms
利用率 Warning      > 80%           > 85%           仅供参考
利用率 Critical     > 95%           > 95%           仅供参考
队列深度 Warning    > 4             > 64            > 256
队列深度 Critical   > 16            > 128           > 512

注意：
- SSD 的 %util 不能直接反映饱和度，延迟是更可靠的信号
- 阈值应根据实际基线调整，而不是直接套用固定数值
- 建议先观察一周的正常波动范围，再设定阈值
```

            

### 持续基准测试

            

在 CI/CD（Continuous Integration / Continuous
            Delivery）流水线中集成存储基准测试，可以及早发现性能退化：
            
```
#!/bin/bash
# storage-bench-ci.sh
# 在 CI/CD 中运行的轻量级存储基准测试

DEVICE="/dev/sdb"
RESULT_DIR="./bench-results"
THRESHOLD_FILE="./bench-thresholds.json"

mkdir -p "$RESULT_DIR"

# 运行标准化测试（短时间，减少 CI 耗时）
fio --name=ci-randread \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=32 \
    --numjobs=1 \
    --size=512m \
    --runtime=30 \
    --time_based \
    --group_reporting \
    --output-format=json \
    --output="$RESULT_DIR/randread.json" \
    --filename="$DEVICE"

# 提取关键指标
IOPS=$(python3 -c "
import json, sys
with open('$RESULT_DIR/randread.json') as f:
    data = json.load(f)
job = data['jobs'][0]
print(int(job['read']['iops']))
")

LAT_P99=$(python3 -c "
import json, sys
with open('$RESULT_DIR/randread.json') as f:
    data = json.load(f)
job = data['jobs'][0]
# clat_ns percentiles
p99 = job['read']['clat_ns']['percentile']['99.000000']
print(f'{p99 / 1000:.1f}')
")

echo "随机读 IOPS: $IOPS"
echo "P99 延迟: ${LAT_P99} μs"

# 和阈值对比
# 如果 IOPS 低于基线 20% 或延迟高于基线 2 倍，标记为性能退化
```

            
```
CI/CD 存储基准测试的注意事项：

1. 使用独占的测试设备，避免和其他测试共享 I/O
2. 每次测试前做设备预处理（至少写满一次），保证一致的起始状态
3. 测试时间可以短（30~60 秒），但要多次运行取中位数
4. 记录完整的环境信息（内核版本、SSD 固件版本、温度）
5. 设定合理的容忍范围（比如 ±10%），避免因正常波动触发误报
6. 保留历史结果，建立趋势图，及时发现渐进式性能退化
```

            

## 十、总结

            

存储性能建模的核心思路可以归纳为三步：
            

第一步，理解三要素的关系：IOPS、吞吐量和延迟不是独立的指标，而是通过块大小和队列深度耦合在一起。利特尔定律（`QD = IOPS × Latency`）是连接它们的数学桥梁。
            

第二步，基于工作负载做测试：用 fio
            在正确的参数空间（对应你的实际工作负载）下测试，而不是照搬规格书上的峰值数据。注意
            `--direct=1`、足够的测试时间、足够大的测试文件、覆盖多个队列深度。
            

第三步，把模型落到工程实践中：容量规划时用 IOPS
            和吞吐量预算倒推设备需求，生产环境中用 Prometheus + Grafana
            持续监控，用告警规则提前发现瓶颈。
            

存储性能调优没有银弹。HDD 适合大容量冷数据，NVMe SSD
            适合高 IOPS 热数据，Optane
            适合对延迟一致性有极端要求的场景。选型的依据不是”越贵越好”，而是”每
            IOPS 成本”或”每 TB 成本”在你的工作负载下哪个更优。
            
            

**参考资料**
            

规范与文档：
            
            
- NVMe Specification, Revision 2.0, NVM Express, Inc.,
            2021 — NVMe 命令队列和 I/O 模型
            
- Linux Kernel Documentation,
            `Documentation/admin-guide/iostats.rst` —
            `/proc/diskstats` 字段定义
            
- fio Documentation, `HOWTO` and
            `README`, [https://github.com/axboe/fio](https://github.com/axboe/fio) — fio
            参数和输出格式
            
            

论文与书籍：
            
            
- Jain, R., “The Art of Computer Systems Performance
            Analysis”, Wiley, 1991 — 排队论与容量规划方法论
            
- Little, J.D.C., “A Proof for the Queuing Formula: L =
            λW”, Operations Research, 1961 — 利特尔定律的原始证明
            
- Dean, J. and Barroso, L.A., “The Tail at Scale”,
            Communications of the ACM, 2013 —
            分布式系统中的尾延迟问题
            
- Tene, G., “How NOT to Measure Latency”, Strange Loop
            Conference, 2013 — 协调遗漏问题
            
            

工具与实践：
            
            
- Gregg, B., “Systems Performance: Enterprise and the
            Cloud”, 2nd Edition, Pearson, 2020 — 第 9 章 Disks
            
- Axboe, J., fio 源码仓库, https://github.com/axboe/fio —
            基准测试工具
            
- blktrace 和 blkparse, Linux 内核工具集, https://git.kernel.org/pub/scm/linux/kernel/git/axboe/blktrace.git
            — 块层追踪
            
            
            

**上一篇**: 持久化内存与存储层次
            **下一篇**: 存储介质选型指南
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-12 · storage
                    

### 【存储工程】存储基准测试方法论

                    

深入剖析存储基准测试的方法论——fio 参数解析、filebench 工作负载定义、YCSB 数据库基准、测试陷阱规避与性能回归测试集成
                

                
                    

2025-10-18 · storage
                    

### 【存储工程】云块存储架构

                    

深入剖析云块存储——分布式块存储架构原理、AWS EBS与阿里云ESSD架构分析、云盘性能规格解读、性能测试方法与选型成本优化
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。
                

                
                    

2025-08-27 · storage
                    

### 【存储工程】文件系统选型与基准测试

                    

在生产环境中，文件系统（Filesystem）的选择直接影响存储栈的性能上限、数据安全边界和运维复杂度。本文将从设计目标、元数据性能、数据吞吐、典型业务场景、基准测试方法论等多个维度，对 ext4、XFS、Btrfs（B-tree Filesystem）、ZFS（Zettabyte File System）四种主流文件…