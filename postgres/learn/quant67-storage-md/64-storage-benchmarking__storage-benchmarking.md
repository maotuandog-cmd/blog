# 【存储工程】存储基准测试方法论

来源: https://quant67.com/post/storage/64-storage-benchmarking/storage-benchmarking.html
日期: 2025-10-12 |

---

一台全新的 NVMe 固态硬盘到货，运维工程师跑了一轮 fio
            测试，报告上写着”随机读 IOPS 达到 100
            万”。三个月后这块盘上线到生产数据库，实际观测到的随机读 IOPS
            却只有 8
            万。领导质问：“你当时测的数据是不是造假？”工程师很委屈——测试命令确实跑过，数字确实是真的，但测试条件和生产条件之间存在巨大的鸿沟。
            

这种”实验室数字”与”生产数字”之间的落差，在存储领域极为普遍。厂商的数据手册（Datasheet）通常给出最优条件下的峰值指标，而生产环境面对的是混合读写、元数据操作、文件系统开销、事务日志同步等多重压力。基准测试（Benchmarking）的核心价值不在于追求最大数字，而在于构建一套可重复、可比较、能反映真实负载的测试方法论。
            

本文从”为什么测试结果和生产有差距”出发，逐一拆解常见测试陷阱，深入讲解
            fio、filebench、YCSB
            三类工具的用法与参数选择，最后落地到标准化测试流程（SOP）和持续集成中的性能回归检测。
            
            

**适用范围** 本文讨论的基准测试主要针对
            Linux 环境下的块设备与文件系统层面，以及关系型 / NoSQL
            数据库的负载测试。 工具版本：fio 3.37、filebench
            1.5-alpha3、YCSB
            0.17.0。不同版本的参数行为可能有差异，文中会标注版本。
            
            
            

## 一、为什么基准测试结果和生产差距大

            

### 1.1
            厂商数据手册的”最优条件”

            

存储厂商发布的性能指标通常基于以下条件：
            
            
- 队列深度（Queue Depth）设为设备上限（如 256）；
            
- 使用 4 KiB 随机读或 128 KiB 顺序读，只测单一方向；
            
- 测试对象是裸设备（Raw Device），绕过文件系统；
            
- 设备处于全新状态，闪存转换层（Flash Translation
            Layer，FTL）无垃圾回收压力；
            
- 测试环境无其他 I/O 竞争。
            
            

这些条件在生产中几乎不可能同时满足。
            

### 1.2 生产负载的复杂性

            

生产环境中的 I/O
            模式远比单一基准测试复杂，至少包含以下维度：
            
            
            
            维度
            基准测试典型设定
            生产环境实际情况
            
            
            
            
            读写比例
            纯读或纯写
            混合读写，比例随业务波动
            
            
            I/O 大小
            固定 4 KiB 或 128 KiB
            从 512 B 到数 MiB 不等
            
            
            访问模式
            纯随机或纯顺序
            局部顺序 + 全局随机混合
            
            
            队列深度
            设备上限（128 ~ 256）
            应用层通常 1 ~ 32
            
            
            数据路径
            裸设备 / O_DIRECT
            文件系统 + Page Cache + fsync
            
            
            设备状态
            全新 / 刚 TRIM
            使用一段时间后，GC 压力增大
            
            
            并发竞争
            独占设备
            多进程 / 多租户共享
            
            
            
            

### 1.3 性能指标的多维性

            

存储性能不是一个标量，而是一个多维向量，至少包括：
            
            
- **吞吐量（Throughput）**：单位时间传输的数据量，单位
            MiB/s 或 GiB/s；
            
- **IOPS（Input/Output Operations Per
            Second）**：单位时间完成的 I/O 操作数；
            
- **延迟（Latency）**：单次 I/O
            从提交到完成的耗时，通常关注平均值、P50、P99、P99.9；
            
- **延迟抖动（Jitter）**：延迟的标准差或极差，反映稳定性。
            
            

这四个指标之间存在权衡关系。增大队列深度可以提升 IOPS
            和吞吐量，但会推高延迟和抖动。一个合格的基准测试报告应当同时呈现多个指标，而不是只挑一个最好看的数字。
            

### 1.4 “跑分”心态的危害

            

如果基准测试的目标是”跑出最大数字”，那么测试结果就失去了工程参考价值。正确的目标应当是：
            
            
- **容量规划**：在预期负载模式下，设备能否满足性能需求？
            
- **选型对比**：在相同条件下，A 设备和 B
            设备谁更适合当前业务？
            
- **回归检测**：软件变更或配置调整后，性能是否出现退化？
            
- **瓶颈定位**：I/O
            栈的哪一层成为了性能瓶颈？
            
            

以这些目标为导向设计测试，才能产出有工程价值的数据。
            
            

## 二、基准测试的常见陷阱

            

### 2.1 缓存预热不充分

            

操作系统的页面缓存（Page
            Cache）和存储设备的内部缓存对性能有显著影响。测试开始后的前几十秒，缓存逐步建立，此时的性能数据不能代表稳态。
            

常见错误：
            
            
- 测试总时长只有 30 秒，前 20 秒都在预热，实际有效数据只有
            10 秒；
            
- 多轮测试之间没有清除缓存，后续轮次命中了前一轮的缓存，导致结果偏高；
            
- 数据库基准测试前没有执行足够的预热查询，缓冲池（Buffer
            Pool）未填满。
            
            

**正确做法**：
            
```
# 清除 Linux Page Cache
sync && echo 3 > /proc/sys/vm/drop_caches

# fio 内置预热参数：ramp_time
fio --name=test --ramp_time=60 --runtime=300 ...
```

            

`ramp_time` 参数指定预热时间，在此期间 fio
            正常发起 I/O 但不记录统计数据。建议预热时间不少于 60
            秒。
            

### 2.2 未达到稳态

            

闪存设备存在一个显著特性：新盘或刚 TRIM
            过的盘，写入性能远高于稳态。这是因为新盘有大量空闲块可以直接写入，不需要触发垃圾回收（Garbage
            Collection，GC）。一旦写满一轮后，FTL 需要在后台执行
            GC，写入性能会显著下降。
            
```
性能
 ^
 │  ┌──────────────┐
 │  │   新盘阶段    │
 │  │  IOPS 很高    │       ┌────────────────────────
 │  │              │       │      稳态阶段
 │  │              │       │   IOPS 趋于稳定
 │  └──────┐       │       │
 │         │ GC 介入│       │
 │         │ 性能下降│       │
 │         └───────┘       │
 └──────────────────────────────────────────────► 时间
       第一轮写满                第二轮之后
```

            

**正确做法**：在正式测试前，先用顺序写把设备写满至少两遍，让设备进入稳态：
            
```
# 预调节：连续写满设备两遍
fio --name=precondition --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=write --bs=1M \
    --iodepth=32 --numjobs=1 --loops=2 --size=100%
```

            

SNIA（Storage Networking Industry Association）的
            PTS（Performance Test Specification）标准建议对企业级 SSD
            执行至少两轮全盘写入后再采集数据。
            

### 2.3 负载模式不匹配

            

用纯随机 4 KiB
            读测试来评估一个主要跑顺序写入的日志系统，结论没有任何参考价值。测试负载必须尽可能模拟真实业务的
            I/O 特征。
            

**负载特征采集方法**：
            
```
# 使用 blktrace 采集生产 I/O 模式
blktrace -d /dev/sda -o trace_output
blkparse -i trace_output -d trace_output.blktrace.bin

# 使用 btt 分析 I/O 分布
btt -i trace_output.blktrace.bin -o analysis

# 查看 I/O 大小分布
btt -i trace_output.blktrace.bin -B offset_output
```

            

从采集结果中提取以下关键参数，用于构造测试负载：
            
            
- 读写比例；
            
- I/O 大小分布（直方图）；
            
- 随机 / 顺序比例；
            
- 队列深度分布；
            
- 请求到达速率（IOPS 上限）。
            
            

### 2.4 测试时间太短

            

一些间歇性的性能问题——例如 SSD 的热节流（Thermal
            Throttling）、后台 GC、RAID
            重建、日志切换——只有在足够长的测试时间窗口内才会暴露。
            

**建议最低测试时间**：
            
            
            
            测试目标
            最低运行时间
            说明
            
            
            
            
            快速验证
            5 分钟
            仅用于开发阶段的冒烟测试
            
            
            选型对比
            30 分钟
            需覆盖至少一轮 GC 周期
            
            
            容量规划
            2 小时
            覆盖热节流、GC 波动
            
            
            耐久性评估
            24 小时以上
            覆盖完整的日变化周期
            
            
            
            

### 2.5 忽略延迟分布

            

只看平均延迟是危险的。两个设备平均延迟都是 100 微秒，但 A
            设备的 P99 是 200 微秒，B 设备的 P99 是 5
            毫秒——在真实业务中，B 设备会导致大量慢查询。
            

fio
            提供了完整的延迟百分位统计功能（后文详述），必须在测试报告中包含
            P50、P99、P99.9、P99.99 等百分位数据。
            
            

## 三、fio 参数深度解析

            

fio（Flexible I/O
            Tester）是存储基准测试的事实标准工具。它支持丰富的参数组合，但参数选择不当会导致测试结果偏离真实性能。
            

### 3.1 ioengine——I/O 引擎选择

            

ioengine 参数决定 fio 使用哪种系统调用提交 I/O
            请求。不同引擎对性能的影响很大。
            
            
            
            ioengine
            系统调用
            异步支持
            适用场景
            
            
            
            
            sync
            read/write
            否
            模拟单线程同步应用
            
            
            psync
            pread/pwrite
            否
            模拟多线程同步应用
            
            
            libaio
            io_submit/io_getevents
            是
            Linux 原生异步 I/O，最常用
            
            
            io_uring
            io_uring_enter
            是
            Linux 5.1+ 高性能异步 I/O
            
            
            posixaio
            aio_read/aio_write
            是
            POSIX 异步 I/O，跨平台
            
            
            mmap
            mmap + msync
            否
            模拟 mmap 访问模式
            
            
            
            

**选择建议**：
            
            
- 测试裸设备或 O_DIRECT 性能：首选
            `io_uring`（内核 5.10+），其次
            `libaio`；
            
- 模拟数据库 I/O：根据数据库实际使用的引擎选择，例如
            PostgreSQL 使用 `psync`，MySQL InnoDB 使用
            `libaio`；
            
- 跨平台对比：使用 `posixaio`。
            
            
```
# 使用 io_uring 引擎测试
fio --name=test --ioengine=io_uring --direct=1 \
    --filename=/dev/nvme0n1 --rw=randread --bs=4k \
    --iodepth=64 --numjobs=4 --runtime=300 --time_based
```

            

### 3.2 iodepth——I/O 队列深度

            

iodepth 控制每个 job 并发提交的 I/O 请求数量。这是影响
            IOPS 和延迟的关键参数。
            
```
                  IOPS
                   ^
                   │              ┌────────────────── 设备 IOPS 上限
                   │           ┌──┘
                   │        ┌──┘
                   │     ┌──┘
                   │  ┌──┘
                   │──┘
                   └──────────────────────────────► iodepth
                   1  2  4  8  16 32 64 128 256

                  延迟
                   ^
                   │                          ┌───
                   │                       ┌──┘
                   │                    ┌──┘
                   │              ┌─────┘
                   │──────────────┘
                   └──────────────────────────────► iodepth
                   1  2  4  8  16 32 64 128 256
```

            

随着 iodepth 增加，IOPS
            逐步上升直到设备饱和，但延迟也会持续增加。工程上需要找到”拐点”——IOPS
            增长趋于平缓而延迟尚可接受的位置。
            

**关键注意事项**：
            
            
- `ioengine=sync` 或 `psync`
            时，iodepth 参数无效，因为同步引擎每次只能有 1
            个在途（In-flight）请求；
            
- 要实现真正的高队列深度，必须使用异步引擎（libaio 或
            io_uring）；
            
- 如果 iodepth
            设得比设备硬件队列深度还大，多余的请求会在软件层排队，推高延迟但不增加
            IOPS。
            
            
```
# 对比不同 iodepth 的影响
for qd in 1 2 4 8 16 32 64 128; do
    echo "=== iodepth=$qd ==="
    fio --name=qd_test --ioengine=libaio --direct=1 \
        --filename=/dev/nvme0n1 --rw=randread --bs=4k \
        --iodepth=$qd --numjobs=1 --runtime=60 --time_based \
        --group_reporting --output-format=json \
        --output=result_qd_${qd}.json
done
```

            

### 3.3 bs——块大小

            

bs（Block Size）指定每次 I/O
            操作的数据大小。不同的块大小对 IOPS
            和吞吐量的影响方向相反：
            
            
- 小块（4 KiB）：IOPS 高，吞吐量低——适合测试随机 I/O
            能力；
            
- 大块（128 KiB ~ 1 MiB）：IOPS 低，吞吐量高——适合测试顺序
            I/O 带宽。
            
            
```
# 测试不同块大小的吞吐量
for bs in 4k 8k 16k 32k 64k 128k 256k 512k 1M; do
    fio --name=bs_test --ioengine=libaio --direct=1 \
        --filename=/dev/nvme0n1 --rw=read --bs=$bs \
        --iodepth=32 --numjobs=1 --runtime=60 --time_based \
        --group_reporting --output-format=json \
        --output=result_bs_${bs}.json
done
```

            

**混合块大小**：生产环境中 I/O
            大小通常不是固定的。fio 支持用 `bsrange`
            指定范围，或用 `bssplit` 指定精确分布：
            
```
# fio job 文件：混合块大小
[mixed_bs]
ioengine=libaio
direct=1
filename=/dev/nvme0n1
rw=randrw
rwmixread=70
bssplit=4k/50:8k/30:64k/15:256k/5
iodepth=32
numjobs=4
runtime=300
time_based
group_reporting
```

            

上面的 `bssplit` 表示：50% 的 I/O 使用 4
            KiB，30% 使用 8 KiB，15% 使用 64 KiB，5% 使用 256 KiB。
            

### 3.4 numjobs——并行作业数

            

numjobs 控制 fio 启动多少个并行进程（或线程）。每个 job
            都有独立的 iodepth。
            

**总并发 I/O 数 = numjobs x iodepth**
            
```
# 4 个 job，每个 iodepth=32，总并发 128
fio --name=test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randread --bs=4k \
    --iodepth=32 --numjobs=4 --runtime=300 --time_based \
    --group_reporting
```

            

注意事项：
            
            
- `--group_reporting` 会将所有 job
            的结果汇总为一行，便于阅读；
            
- 如果 numjobs 过大但 CPU 核心数不足，fio
            进程本身可能成为瓶颈——此时 IOPS 不再增长，CPU
            使用率却很高；
            
- 测试文件系统时，每个 job 默认操作同名文件，需要用
            `--filename_format` 或 `--directory`
            让不同 job 操作不同文件。
            
            

### 3.5 runtime 与
            time_based

            
```
# runtime=300 表示运行 300 秒
# time_based 表示即使文件读/写完了也继续循环
fio --name=test --runtime=300 --time_based ...
```

            

如果不加 `--time_based`，fio
            会在文件读/写完毕后停止，即使还没到 runtime
            时间。对于小文件或小 size
            的测试，可能几秒就结束了，远达不到预期测试时长。
            

### 3.6 direct——绕过 Page
            Cache

            
```
# direct=1 使用 O_DIRECT，绕过 Page Cache
fio --direct=1 ...

# direct=0（默认）经过 Page Cache
fio --direct=0 ...
```

            
            
- 测试设备真实性能时应使用 `direct=1`；
            
- 测试包含 Page Cache 效果的端到端性能时使用
            `direct=0`；
            
- 混合测试中如果一部分需要
            O_DIRECT、一部分不需要，应拆成多个 job。
            
            

### 3.7 完整参数速查表

            
            
            
            参数
            含义
            常用值
            默认值
            
            
            
            
            ioengine
            I/O 引擎
            libaio, io_uring
            sync
            
            
            direct
            绕过 Page Cache
            0, 1
            0
            
            
            rw
            读写模式
            read, write, randread, randwrite, randrw
            read
            
            
            bs
            块大小
            4k, 8k, 64k, 128k, 1M
            4k
            
            
            iodepth
            队列深度
            1 ~ 256
            1
            
            
            numjobs
            并行作业数
            1 ~ CPU 核数
            1
            
            
            runtime
            运行时间（秒）
            60 ~ 3600
            无限
            
            
            ramp_time
            预热时间（秒）
            30 ~ 120
            0
            
            
            size
            测试文件大小
            1G ~ 设备容量
            无
            
            
            rwmixread
            混合读写中读的比例
            0 ~ 100
            50
            
            
            filename
            测试文件或设备路径
            /dev/nvme0n1
            无
            
            
            group_reporting
            汇总所有 job 的结果
            无值参数
            关闭
            
            
            time_based
            按时间运行而非按文件大小
            无值参数
            关闭
            
            
            output-format
            输出格式
            normal, json, json+
            normal
            
            
            
            
            

## 四、fio 高级用法

            

### 4.1 多任务混合负载

            

生产环境中，一块设备同时承载多种不同特征的 I/O 负载。fio
            的 Job
            文件语法允许在一个配置文件中定义多个任务段，每个任务段有独立的参数。
            
```
# mixed_workload.fio —— 模拟数据库混合负载
[global]
ioengine=libaio
direct=1
filename=/dev/nvme0n1
runtime=600
time_based
ramp_time=60

# 模拟数据页随机读写（InnoDB Buffer Pool 缺页）
[data_pages]
rw=randrw
rwmixread=80
bs=16k
iodepth=32
numjobs=4

# 模拟 redo log 顺序写
[redo_log]
rw=write
bs=4k
iodepth=4
numjobs=1
size=2G
offset=0

# 模拟 binlog 顺序写
[binlog]
rw=write
bs=8k
iodepth=2
numjobs=1
size=4G
offset=2G
```

            

运行：
            
```
fio mixed_workload.fio --output-format=json --output=mixed_result.json
```

            

每个任务段会独立报告统计数据，可以清楚看到不同负载之间的性能分配和相互影响。
            

### 4.2 延迟统计与百分位分析

            

fio 内置了详细的延迟统计功能，通过以下参数控制：
            
```
fio --name=lat_test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randread --bs=4k \
    --iodepth=16 --numjobs=4 --runtime=300 --time_based \
    --group_reporting \
    --lat_percentiles=1 \
    --clat_percentiles=1 \
    --percentile_list=1:5:10:20:30:40:50:60:70:80:90:95:99:99.5:99.9:99.95:99.99
```

            

参数说明：
            
            
- `lat_percentiles=1`：启用总延迟（提交延迟 +
            完成延迟）的百分位统计；
            
- `clat_percentiles=1`：启用完成延迟（Completion
            Latency）的百分位统计；
            
- `percentile_list`：自定义需要报告的百分位数列表。
            
            

fio 报告三种延迟指标：
            
            
            
            
            
            
            
            
            延迟类型
            含义
            对应字段
            
            
            
            
            slat（Submission Latency）
            从 fio 调用提交函数到内核接受请求的时间
            slat
            
            
            clat（Completion Latency）
            从内核接受请求到完成的时间
            clat
            
            
            lat（Total Latency）
            slat + clat，即 fio 观测到的端到端延迟
            lat
            
            
            
            

在 fio 3.x 中，JSON
            输出格式（`--output-format=json`）会包含完整的百分位数据，便于后续脚本解析。
            

### 4.3 延迟日志与时序分析

            
```
fio --name=log_test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randread --bs=4k \
    --iodepth=16 --numjobs=1 --runtime=300 --time_based \
    --write_lat_log=latency_log \
    --log_avg_msec=1000
```

            
            
- `write_lat_log`：将逐个 I/O
            的延迟数据写入日志文件；
            
- `log_avg_msec=1000`：每 1000
            毫秒汇总一次，输出平均值而非逐条记录（减少日志体积）。
            
            

生成的日志文件可以用 fio 自带的
            `fio_generate_plots` 或 Python
            脚本绘制延迟随时间变化的曲线，帮助发现间歇性延迟尖峰。
            
```
import pandas as pd
import matplotlib.pyplot as plt

# 解析 fio 延迟日志
df = pd.read_csv(
    "latency_log_clat.1.log",
    header=None,
    names=["time_ms", "latency_ns", "direction", "bs", "offset", "cmd_prio"],
    usecols=[0, 1, 2],
)

df["latency_us"] = df["latency_ns"] / 1000.0
df["time_s"] = df["time_ms"] / 1000.0

fig, ax = plt.subplots(figsize=(14, 5))
ax.plot(df["time_s"], df["latency_us"], linewidth=0.5, alpha=0.7)
ax.set_xlabel("时间 (s)")
ax.set_ylabel("完成延迟 (us)")
ax.set_title("NVMe 随机读延迟时序图")
plt.tight_layout()
plt.savefig("latency_timeline.png", dpi=150)
```

            

### 4.4 数据验证模式

            

fio
            支持在写入后验证数据完整性，用于检测静默数据损坏（Silent
            Data Corruption）：
            
```
fio --name=verify_test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=write --bs=4k \
    --iodepth=32 --numjobs=1 --size=10G \
    --verify=crc32c --verify_fatal=1 --verify_dump=1 \
    --do_verify=1
```

            

参数说明：
            
            
- `verify=crc32c`：使用 CRC32C
            校验写入数据（也支持 md5、sha256 等）；
            
- `verify_fatal=1`：发现校验错误时立即终止测试；
            
- `verify_dump=1`：校验错误时转储期望值和实际值，便于分析；
            
- `do_verify=1`：写入完成后立即执行验证读取。
            
            

### 4.5 稳态检测

            

fio 3.x 支持自动稳态检测（Steady State Detection），在
            I/O 指标达到稳态后自动停止测试：
            
```
fio --name=ss_test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randwrite --bs=4k \
    --iodepth=32 --numjobs=4 \
    --ss=iops:10% --ss_dur=300 --ss_ramp=120 \
    --time_based --runtime=7200
```

            

参数说明：
            
            
- `ss=iops:10%`：当 IOPS 在观测窗口内的波动小于
            10% 时，判定为稳态；
            
- `ss_dur=300`：稳态观测窗口为 300 秒；
            
- `ss_ramp=120`：前 120
            秒的数据不参与稳态判断；
            
- `runtime=7200`：最长运行 2 小时，如果 2
            小时内未达到稳态则强制结束。
            
            
            

## 五、filebench
            工作负载定义

            

### 5.1 filebench 简介

            

fio 擅长裸设备或简单文件的 I/O
            测试，但无法模拟真实的文件系统操作模式——例如”创建目录 →
            创建文件 → 写入数据 → 追加 → 读取 →
            删除”这样的操作序列。filebench
            填补了这一空白，它通过工作负载模型语言（Workload Model
            Language，WML）定义复杂的文件系统操作流程。
            

filebench 预置了多个经典工作负载：
            
            
            
            工作负载名称
            模拟场景
            核心操作
            
            
            
            
            fileserver
            文件服务器
            创建、写入、追加、读取、删除
            
            
            webserver
            Web 静态服务器
            大量小文件随机读
            
            
            varmail
            邮件服务器
            创建、追加、读取、删除、fsync
            
            
            oltp
            数据库 OLTP
            随机读写、fsync
            
            
            videoserver
            视频流服务器
            大文件顺序读
            
            
            
            

### 5.2 WML 语法解析

            

以下是一个自定义的 filebench 工作负载定义文件示例：
            
```
# custom_fileserver.f — 自定义文件服务器工作负载
define fileset name=datafiles, path=/mnt/test, size=16k, entries=100000, \
    dirwidth=20, prealloc=80, readonly

define fileset name=logfiles, path=/mnt/test/logs, size=1m, entries=1000, \
    dirwidth=5, prealloc

define process name=filereader, instances=8
{
    thread name=reader, memsize=10m, instances=4
    {
        flowop openfile name=openfile1, filesetname=datafiles, fd=1
        flowop readwholefile name=readfile1, fd=1, iosize=1m
        flowop closefile name=closefile1, fd=1

        flowop openfile name=openfile2, filesetname=datafiles, fd=2
        flowop readwholefile name=readfile2, fd=2, iosize=1m
        flowop closefile name=closefile2, fd=2
    }
}

define process name=filewriter, instances=2
{
    thread name=writer, memsize=10m, instances=2
    {
        flowop createfile name=createfile1, filesetname=logfiles, fd=3
        flowop writewholefile name=writefile1, fd=3, iosize=1m
        flowop fsync name=fsync1, fd=3
        flowop closefile name=closefile3, fd=3
    }
}

run 600
```

            

WML 的核心概念：
            
            
- **fileset**：文件集合，定义文件路径、大小、数量、目录宽度、是否预分配；
            
- **process**：操作进程，可以指定实例数；
            
- **thread**：进程内的线程，执行一系列操作流（flowop）；
            
- **flowop**：原子操作——openfile、readwholefile、writewholefile、appendfile、createfile、deletefile、fsync、closefile
            等。
            
            

### 5.3 运行 filebench

            
```
# 使用预置工作负载
filebench -f /usr/share/filebench/workloads/fileserver.f

# 使用自定义工作负载
filebench -f custom_fileserver.f
```

            

filebench 需要 root 权限运行（或使用 `sysctl`
            调整
            `vm.max_map_count`），因为它需要分配大量共享内存段。
            

### 5.4 filebench 与 fio
            的互补关系

            
            
            
            对比维度
            fio
            filebench
            
            
            
            
            测试层面
            块 I/O 层
            文件系统操作层
            
            
            I/O 模式
            简单（顺序/随机/混合）
            复杂（多步骤操作流程）
            
            
            元数据操作
            不支持
            支持（创建/删除/重命名等）
            
            
            fsync 模拟
            支持（fsync 参数）
            支持（flowop）
            
            
            配置灵活性
            高（命令行 + job 文件）
            高（WML 脚本）
            
            
            适用设备
            裸设备或文件
            仅文件系统
            
            
            社区活跃度
            非常活跃
            维护较少
            
            
            
            

**实践建议**：先用 fio
            测试设备级性能上限，再用 filebench
            测试文件系统操作的综合性能，两者结合才能全面评估存储栈的能力。
            
            

## 六、YCSB 数据库基准测试

            

### 6.1 YCSB 简介

            

YCSB（Yahoo! Cloud Serving
            Benchmark）是一个数据库基准测试框架，由 Yahoo Research 在
            2010
            年发布。它的设计目标是提供一套标准化的工作负载，用于对比不同数据库系统在相同负载下的性能表现。
            

YCSB 的架构分为两层：
            
```
┌─────────────────────────────────────────────────────────┐
│                      YCSB 客户端                         │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ 工作负载生成  │  │  延迟统计    │  │  吞吐量控制  │     │
│  │  (Workload)  │  │ (Histogram) │  │ (Throttle)  │     │
│  └──────┬──────┘  └─────────────┘  └─────────────┘     │
│         │                                               │
│  ┌──────▼──────────────────────────────────────────┐    │
│  │              数据库接口层 (DB Interface)          │    │
│  └──────┬──────────┬──────────┬──────────┬────────┘    │
│         │          │          │          │              │
│  ┌──────▼──┐ ┌─────▼───┐ ┌───▼─────┐ ┌─▼────────┐    │
│  │  MySQL  │ │  Redis  │ │ MongoDB │ │ Cassandra│    │
│  │ Binding │ │ Binding │ │ Binding │ │ Binding  │    │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘    │
└─────────────────────────────────────────────────────────┘
         │          │          │          │
         ▼          ▼          ▼          ▼
    ┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
    │  MySQL  │ │  Redis │ │MongoDB │ │Cassandra │
    │  Server │ │ Server │ │ Server │ │  Server  │
    └─────────┘ └────────┘ └────────┘ └──────────┘
```

            

### 6.2 标准工作负载

            

YCSB 预定义了 6 种核心工作负载（Core
            Workloads），每种对应不同的应用场景：
            
            
            
            工作负载
            操作分布
            模拟场景
            
            
            
            
            A（Update Heavy）
            50% 读 + 50% 更新
            会话存储（Session Store）
            
            
            B（Read Mostly）
            95% 读 + 5% 更新
            照片标签系统
            
            
            C（Read Only）
            100% 读
            用户画像缓存
            
            
            D（Read Latest）
            95% 读 + 5% 插入，热点偏向最新记录
            用户时间线
            
            
            E（Short Ranges）
            95% 扫描 + 5% 插入
            会话线索系统
            
            
            F（Read-Modify-Write）
            50% 读 + 50% 读-改-写
            用户数据库
            
            
            
            

### 6.3 YCSB 测试流程

            

YCSB 测试分为两个阶段：数据加载（Load Phase）和运行（Run
            Phase）。
            
```
# 阶段一：加载数据
bin/ycsb load jdbc -s \
    -P workloads/workloada \
    -p db.url="jdbc:mysql://127.0.0.1:3306/ycsb_db" \
    -p db.user=ycsb \
    -p db.passwd=ycsb_password \
    -p recordcount=1000000 \
    -p insertorder=hashed \
    -threads 16

# 阶段二：运行工作负载
bin/ycsb run jdbc -s \
    -P workloads/workloada \
    -p db.url="jdbc:mysql://127.0.0.1:3306/ycsb_db" \
    -p db.user=ycsb \
    -p db.passwd=ycsb_password \
    -p operationcount=10000000 \
    -p requestdistribution=zipfian \
    -threads 64 \
    -p maxexecutiontime=1800 \
    -p measurementtype=hdrhistogram \
    -p hdrhistogram.percentiles=50,90,95,99,99.9,99.99
```

            

关键参数说明：
            
            
- `recordcount`：加载阶段插入的记录数；
            
- `operationcount`：运行阶段的总操作数；
            
- `requestdistribution`：请求分布，常用
            `uniform`（均匀）、`zipfian`（齐普夫分布，模拟热点访问）、`latest`（偏向最新记录）；
            
- `threads`：客户端并发线程数；
            
- `measurementtype`：延迟统计方式，`hdrhistogram`
            提供高精度百分位数据；
            
- `maxexecutiontime`：最长运行时间（秒）。
            
            

### 6.4 自定义工作负载

            

可以通过修改工作负载配置文件来构造符合业务特征的测试：
            
```
# custom_workload.properties —— 模拟电商订单系统
recordcount=5000000
operationcount=50000000
workload=site.ycsb.workloads.CoreWorkload

# 读写比例：70% 读 + 20% 更新 + 10% 插入
readproportion=0.70
updateproportion=0.20
insertproportion=0.10
scanproportion=0
readmodifywriteproportion=0

# 请求分布：齐普夫分布，模拟热门商品
requestdistribution=zipfian

# 字段配置
fieldcount=10
fieldlength=100

# 表名
table=orders
```

            

### 6.5 YCSB 结果解读

            

YCSB 的输出包含每种操作类型的吞吐量和延迟统计：
            
```
[OVERALL], RunTime(ms), 1800032
[OVERALL], Throughput(ops/sec), 55554.56

[READ], Operations, 35012345
[READ], AverageLatency(us), 856.23
[READ], 50thPercentileLatency(us), 612
[READ], 95thPercentileLatency(us), 2134
[READ], 99thPercentileLatency(us), 5890
[READ], 99.9thPercentileLatency(us), 23456

[UPDATE], Operations, 14998765
[UPDATE], AverageLatency(us), 1243.56
[UPDATE], 50thPercentileLatency(us), 892
[UPDATE], 95thPercentileLatency(us), 3456
[UPDATE], 99thPercentileLatency(us), 8901
[UPDATE], 99.9thPercentileLatency(us), 34567
```

            

**关注重点**：
            
            
- 吞吐量是否达到预期——如果远低于目标，需要排查瓶颈；
            
- P99 与平均延迟的差距——差距越大说明延迟抖动越严重；
            
- 不同操作类型的延迟差异——写操作通常比读操作慢，但如果差距异常大，可能是日志同步或刷盘策略的问题。
            
            
            

## 七、测试环境隔离与可重复性

            

### 7.1 环境隔离的重要性

            

基准测试结果的价值取决于可重复性。如果每次测试的环境条件不同，结果就没有可比性。以下因素必须严格控制：
            
            
            
            
            
            
            
            
            因素
            潜在影响
            控制方法
            
            
            
            
            CPU 频率调节
            节能模式降低 CPU 频率，影响 I/O 提交速率
            固定为性能模式
            
            
            NUMA 亲和性
            跨 NUMA 节点访问内存增加延迟
            绑定 CPU 和内存到同一 NUMA 节点
            
            
            内存压力
            页面回收（Page Reclaim）消耗 CPU 和 I/O 带宽
            确保空闲内存充足
            
            
            后台 I/O
            系统日志、监控采集、备份任务
            停止无关服务
            
            
            网络 I/O
            远程存储测试受网络抖动影响
            使用专用测试网络
            
            
            温度
            SSD 高温触发热节流
            监控温度，控制环境温度
            
            
            
            

### 7.2 CPU 与 NUMA 配置

            
```
# 禁用 CPU 频率调节，锁定最高频率
cpupower frequency-set -g performance

# 查看 NUMA 拓扑
numactl --hardware

# 将 fio 绑定到 NUMA node 0
numactl --cpunodebind=0 --membind=0 \
    fio --name=test --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randread --bs=4k \
    --iodepth=32 --numjobs=4 --runtime=300 --time_based
```

            

### 7.3 中断亲和性

            

NVMe 设备的中断处理分布在多个 CPU
            核心上。如果中断处理核心与 fio 运行核心不一致，I/O
            完成通知需要跨核传递，增加延迟。
            
```
# 查看 NVMe 设备的中断分布
cat /proc/interrupts | grep nvme

# 查看当前中断亲和性
for irq in $(grep nvme /proc/interrupts | awk '{print $1}' | tr -d ':'); do
    echo "IRQ $irq: $(cat /proc/irq/$irq/smp_affinity_list)"
done

# 将 NVMe 中断绑定到指定 CPU 核心
echo 0-7 > /proc/irq//smp_affinity_list
```

            

### 7.4 I/O 调度器

            

不同的 I/O 调度器（I/O Scheduler）对性能有显著影响：
            
```
# 查看当前调度器
cat /sys/block/nvme0n1/queue/scheduler

# 对 NVMe 设备建议使用 none（直通）
echo none > /sys/block/nvme0n1/queue/scheduler

# 对 SATA SSD 可以使用 mq-deadline
echo mq-deadline > /sys/block/sda/queue/scheduler
```

            

### 7.5 可重复性清单

            

每次测试前执行以下标准化步骤：
            
```
#!/bin/bash
# pre_benchmark.sh —— 测试前环境准备脚本

set -euo pipefail

DEVICE=${1:-/dev/nvme0n1}

echo "=== 1. 记录系统信息 ==="
uname -a
cat /etc/os-release | head -5
lscpu | grep -E "Model name|Socket|Core|Thread"
free -h
lsblk -d -o NAME,MODEL,SIZE,ROTA,SCHED,PHY-SEC,LOG-SEC "$DEVICE"

echo "=== 2. 固定 CPU 频率 ==="
cpupower frequency-set -g performance 2>/dev/null || true

echo "=== 3. 设置 I/O 调度器 ==="
DEVNAME=$(basename "$DEVICE")
echo none > "/sys/block/$DEVNAME/queue/scheduler" 2>/dev/null || true

echo "=== 4. 清除 Page Cache ==="
sync && echo 3 > /proc/sys/vm/drop_caches

echo "=== 5. 停止无关服务 ==="
systemctl stop rsyslog 2>/dev/null || true
systemctl stop cron 2>/dev/null || true

echo "=== 6. 记录设备温度 ==="
smartctl -A "$DEVICE" 2>/dev/null | grep -i temperature || true

echo "=== 7. 记录设备 SMART 信息 ==="
smartctl -i "$DEVICE" 2>/dev/null | grep -E "Model|Serial|Firmware|Capacity" || true

echo "=== 环境准备完成 ==="
```

            

### 7.6 结果记录规范

            

每次测试的结果应当包含以下元数据，确保事后可以复现：
            
```
{
    "test_id": "bench-20251012-001",
    "timestamp": "2025-10-12T14:30:00+08:00",
    "environment": {
        "kernel": "6.1.0-22-amd64",
        "cpu": "Intel Xeon Gold 6348 @ 2.60GHz",
        "memory_gb": 256,
        "device": "Samsung PM9A3 3.84TB",
        "firmware": "GDC7302Q",
        "filesystem": "none (raw device)",
        "scheduler": "none",
        "cpu_governor": "performance"
    },
    "tool": {
        "name": "fio",
        "version": "3.37",
        "command": "fio --name=test --ioengine=libaio ..."
    },
    "results": {
        "iops": 523456,
        "throughput_mib_s": 2044.75,
        "latency_avg_us": 121.8,
        "latency_p50_us": 98,
        "latency_p99_us": 312,
        "latency_p999_us": 1024
    }
}
```

            
            

## 八、存储基准测试 SOP

            

### 8.1 SOP 流程概览

            

将前文讨论的方法论整合为一套标准操作流程（Standard
            Operating
            Procedure，SOP），确保团队每个人都按相同的步骤执行测试。
            
```
┌────────────────────────────────────────────────────────────────────┐
│                     存储基准测试 SOP 流程                          │
│                                                                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ 1.需求   │    │ 2.环境   │    │ 3.设备   │    │ 4.预热   │     │
│  │   定义   │───►│   准备   │───►│  预调节  │───►│  与稳态  │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
│                                                       │            │
│                                                       ▼            │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ 8.归档   │    │ 7.报告   │    │ 6.多轮   │    │ 5.执行   │     │
│  │  与回顾  │◄───│   生成   │◄───│   验证   │◄───│   测试   │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
└────────────────────────────────────────────────────────────────────┘
```

            

### 8.2 阶段一：需求定义

            

在开始测试之前，明确以下问题：
            
            
- **测试目标**：选型对比？容量规划？回归检测？
            
- **目标负载**：读写比例？I/O
            大小？随机/顺序比例？队列深度？
            
- **关注指标**：IOPS？吞吐量？延迟百分位？
            
- **通过标准**：IOPS 不低于多少？P99
            延迟不超过多少？
            
            

将这些信息写入测试计划文档，作为测试的输入。
            

### 8.3 阶段二：环境准备

            

按照 7.5
            节的清单执行环境标准化，并记录完整的硬件软件配置信息。
            

### 8.4 阶段三：设备预调节

            

对于闪存设备（SSD / NVMe），执行稳态预调节：
            
```
# SSD 稳态预调节脚本
#!/bin/bash
DEVICE=${1:-/dev/nvme0n1}
ROUNDS=${2:-2}

echo "开始稳态预调节：设备=$DEVICE，写入轮数=$ROUNDS"

for i in $(seq 1 $ROUNDS); do
    echo "=== 第 $i 轮全盘顺序写 ==="
    fio --name=precondition_round_${i} \
        --ioengine=libaio --direct=1 \
        --filename=$DEVICE --rw=write --bs=1M \
        --iodepth=32 --numjobs=1 --size=100% \
        --output-format=normal
    echo "第 $i 轮完成"
done

echo "稳态预调节完成"
```

            

### 8.5
            阶段四：预热与稳态确认

            

正式测试前先运行一轮短时间的预热测试，确认设备已进入稳态：
            
```
# 预热测试（不记录结果）
fio --name=warmup --ioengine=libaio --direct=1 \
    --filename=/dev/nvme0n1 --rw=randwrite --bs=4k \
    --iodepth=32 --numjobs=4 --runtime=120 --time_based \
    --group_reporting
```

            

观察预热测试的 IOPS 是否稳定。如果 IOPS
            仍在持续下降，说明稳态预调节不充分，需要继续写入。
            

### 8.6 阶段五：执行测试

            

按照需求定义阶段确定的参数执行测试。建议使用 fio job
            文件而非命令行参数，便于版本管理和复现。
            
```
# sop_randread.fio —— 标准随机读测试
[global]
ioengine=libaio
direct=1
filename=/dev/nvme0n1
time_based
group_reporting
ramp_time=60

[4k_randread_qd1]
rw=randread
bs=4k
iodepth=1
numjobs=1
runtime=300

[4k_randread_qd32]
rw=randread
bs=4k
iodepth=32
numjobs=1
runtime=300

[4k_randread_qd128]
rw=randread
bs=4k
iodepth=128
numjobs=1
runtime=300

[4k_randread_qd32_nj4]
rw=randread
bs=4k
iodepth=32
numjobs=4
runtime=300
```

            

### 8.7 阶段六：多轮验证

            

单次测试结果可能受到偶然因素影响。至少执行 3
            轮测试，计算均值和标准差。如果标准差超过均值的
            5%，说明测试环境不够稳定，需要排查干扰因素。
            
```
import json
import statistics

results = []
for i in range(1, 4):
    with open(f"result_round_{i}.json") as f:
        data = json.load(f)
        iops = data["jobs"][0]["read"]["iops"]
        results.append(iops)

mean_iops = statistics.mean(results)
stdev_iops = statistics.stdev(results)
cv = stdev_iops / mean_iops * 100

print(f"三轮 IOPS: {results}")
print(f"均值: {mean_iops:.0f}")
print(f"标准差: {stdev_iops:.0f}")
print(f"变异系数: {cv:.1f}%")

if cv > 5:
    print("警告：变异系数超过 5%，测试结果可重复性不足")
else:
    print("通过：测试结果可重复性良好")
```

            

### 8.8 阶段七：报告生成

            

测试报告应当包含以下内容：
            
            
- 测试目标与背景；
            
- 硬件软件环境信息；
            
- 测试参数（fio 命令或 job 文件）；
            
- 多轮测试的原始数据与汇总统计；
            
- 延迟百分位数据；
            
- 延迟时序图（如有异常波动需重点分析）；
            
- 结论与建议。
            
            

### 8.9 阶段八：归档与回顾

            
            
- 将测试配置文件、原始结果文件、分析脚本一并提交到版本管理系统；
            
- 使用统一的命名规范：`___`；
            
- 建立历史测试数据索引，便于后续查阅和趋势分析。
            
            
            

## 九、性能回归测试集成（CI/CD）

            

### 9.1
            为什么需要性能回归测试

            

代码变更可能引入性能退化（Performance
            Regression），例如：
            
            
- 存储引擎的代码优化引入了额外的锁竞争；
            
- 文件系统驱动的补丁增加了元数据开销；
            
- 数据库升级改变了缓冲区管理策略。
            
            

如果没有自动化的性能回归测试，这些退化往往在上线后才被发现。将基准测试集成到持续集成/持续交付（Continuous
            Integration/Continuous
            Delivery，CI/CD）流水线中，可以在代码合并前就发现性能问题。
            

### 9.2
            性能回归测试的设计原则

            

与正确性测试不同，性能测试的结果具有统计波动性，不能简单地用”通过/失败”来判断。需要建立统计基线（Baseline）和阈值（Threshold）。
            

**核心原则**：
            
            
- **基线动态更新**：使用滑动窗口（例如最近 20
            次主干构建的结果均值）作为基线；
            
- **阈值设置**：通常设为基线的 ±N%（如 IOPS
            降幅超过 5% 触发告警，超过 10% 阻断合并）；
            
- **统计显著性**：使用统计检验（如 t
            检验）判断性能差异是否显著，避免因随机波动误报；
            
- **最小测试集**：CI
            中的性能测试时间有限，选择最能代表核心场景的 2 ~ 3
            个工作负载。
            
            

### 9.3 CI
            集成实践：GitHub Actions 示例

            

以下是一个将 fio 基准测试集成到 GitHub Actions
            的示例配置：
            
```
# .github/workflows/perf-regression.yml
name: Performance Regression Test

on:
  pull_request:
    paths:
      - "src/storage/**"
      - "src/io/**"

jobs:
  benchmark:
    runs-on: [self-hosted, benchmark-runner]
    timeout-minutes: 60

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Build
        run: make build

      - name: Prepare environment
        run: |
          sudo cpupower frequency-set -g performance
          sudo sync && sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'

      - name: Run benchmark
        run: |
          sudo fio benchmark/ci_workload.fio \
            --output-format=json \
            --output=benchmark_result.json

      - name: Compare with baseline
        run: |
          python3 scripts/compare_benchmark.py \
            --baseline baseline/latest.json \
            --current benchmark_result.json \
            --threshold-iops 5 \
            --threshold-lat-p99 10

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: benchmark_result.json

      - name: Update baseline (main branch only)
        if: github.ref == 'refs/heads/main'
        run: |
          cp benchmark_result.json baseline/latest.json
          python3 scripts/update_baseline_window.py \
            --result benchmark_result.json \
            --window-size 20
```

            

### 9.4 基线比较脚本

            
```
#!/usr/bin/env python3
"""compare_benchmark.py —— 基准测试结果对比脚本"""

import argparse
import json
import sys

def load_results(path: str) -> dict:
    """从 fio JSON 输出文件中提取关键指标。"""
    with open(path) as f:
        data = json.load(f)

    job = data["jobs"][0]
    read = job.get("read", {})
    write = job.get("write", {})

    return {
        "read_iops": read.get("iops", 0),
        "write_iops": write.get("iops", 0),
        "read_lat_p99_us": read.get("clat_ns", {}).get("percentile", {}).get("99.000000", 0) / 1000,
        "write_lat_p99_us": write.get("clat_ns", {}).get("percentile", {}).get("99.000000", 0) / 1000,
    }

def compare(baseline: dict, current: dict, threshold_iops: float, threshold_lat: float) -> bool:
    """对比当前结果与基线，返回是否通过。"""
    passed = True

    for metric in ["read_iops", "write_iops"]:
        if baseline[metric] == 0:
            continue
        change = (current[metric] - baseline[metric]) / baseline[metric] * 100
        status = "PASS" if change >= -threshold_iops else "FAIL"
        if status == "FAIL":
            passed = False
        print(f"[{status}] {metric}: baseline={baseline[metric]:.0f}, "
              f"current={current[metric]:.0f}, change={change:+.1f}%")

    for metric in ["read_lat_p99_us", "write_lat_p99_us"]:
        if baseline[metric] == 0:
            continue
        change = (current[metric] - baseline[metric]) / baseline[metric] * 100
        status = "PASS" if change 
            

### 9.5 处理性能测试的噪声

            

CI
            环境中的性能测试天然存在噪声。以下方法可以降低误报率：
            
            
- **专用测试机器**：性能测试必须在专用的物理机上运行，不要在共享的虚拟机或容器中运行；
            
- **多轮取中值**：运行 3 ~ 5
            轮取中位数而非均值，中位数对异常值更鲁棒；
            
- **滑动窗口基线**：使用最近 N
            次主干构建的中位数作为基线，而非单次结果；
            
- **分级告警**：轻微退化（5% ~
            10%）触发告警但不阻断，严重退化（>
            10%）才阻断流水线。
            
            
```
import statistics

def compute_robust_baseline(history: list[float], window: int = 20) -> float:
    """使用滑动窗口中位数计算鲁棒基线。"""
    recent = history[-window:]
    return statistics.median(recent)

def is_regression(current: float, baseline: float, threshold_pct: float) -> bool:
    """判断当前值是否构成性能回归。"""
    if baseline == 0:
        return False
    change_pct = (current - baseline) / baseline * 100
    return change_pct 
            

### 9.6 性能趋势看板

            

将历史测试结果可视化，构建性能趋势看板（Dashboard），帮助团队及时发现渐进式的性能退化：
            
```
import json
import os
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

def plot_performance_trend(results_dir: str, output_path: str):
    """绘制性能趋势图。"""
    dates = []
    iops_values = []

    for filename in sorted(os.listdir(results_dir)):
        if not filename.endswith(".json"):
            continue
        filepath = os.path.join(results_dir, filename)
        with open(filepath) as f:
            data = json.load(f)

        date_str = filename.split("_")[0]
        date = datetime.strptime(date_str, "%Y%m%d")
        iops = data["jobs"][0]["read"]["iops"]

        dates.append(date)
        iops_values.append(iops)

    fig, ax = plt.subplots(figsize=(14, 5))
    ax.plot(dates, iops_values, marker="o", markersize=3, linewidth=1)
    ax.set_xlabel("日期")
    ax.set_ylabel("IOPS")
    ax.set_title("随机读 IOPS 趋势")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
    fig.autofmt_xdate()
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"趋势图已保存: {output_path}")
```

            
            

## 十、参考文献

            
            
- 

Axboe, Jens. “fio - Flexible I/O Tester.” GitHub, https://github.com/axboe/fio 。fio
            项目源码与文档，包含完整的参数说明和示例。
            
- 

Tarasov, Vasily, et al. “Filebench: A Flexible
            Framework for File System Benchmarking.” ;login: The USENIX
            Magazine, vol. 41, no. 1, 2016 。filebench
            的设计论文，详细介绍了 WML 语法和工作负载建模方法。
            
- 

Cooper, Brian F., et al. “Benchmarking Cloud Serving
            Systems with YCSB.” Proceedings of the 1st ACM Symposium on
            Cloud Computing (SoCC), 2010 。YCSB
            的原始论文，定义了标准工作负载和评测方法论。
            
- 

SNIA. “Solid State Storage Performance Test
            Specification (PTS) v2.0.1.” Storage Networking Industry
            Association, 2015 。企业级 SSD
            性能测试的行业标准，定义了稳态预调节和测试流程。
            
- 

Linux Kernel Documentation. “Block I/O Layer.” https://www.kernel.org/doc/html/latest/block/index.html
            。Linux 块 I/O 子系统的官方文档，包括 I/O
            调度器和队列管理。
            
- 

Bjorling, Matias, et al. “Linux Block IO: Introducing
            Multi-queue SSD Access on Multi-core Systems.” Proceedings
            of the 6th International Systems and Storage Conference
            (SYSTOR), 2013 。多队列块 I/O 架构的论文，解释了 blk-mq
            对高性能存储设备的意义。
            
- 

Intel. “Data Plane Development Kit (DPDK) - Storage
            Performance Development Kit (SPDK).” https://spdk.io/
            。用户态存储驱动框架，在基准测试中可作为替代 I/O
            路径。
            
- 

Gil Tene. “HDR Histogram.” GitHub, https://github.com/HdrHistogram/HdrHistogram
            。高动态范围直方图库，YCSB
            使用其进行延迟百分位统计。
            
            
            

**上一篇**: 存储混沌工程
            **下一篇**: I/O
            性能分析工具链
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-14 · storage
                    

### 【存储工程】存储性能建模：IOPS、吞吐与延迟

                    

存储性能不是一个数字，而是 IOPS、吞吐量和延迟在特定工作负载下的函数关系。本文从排队论模型出发，用 fio 实测验证，覆盖从 HDD 到 NVMe SSD 的性能画像，最终落到容量规划和监控体系的工程实践。
                

                
                    

2025-10-18 · storage
                    

### 【存储工程】云块存储架构

                    

深入剖析云块存储——分布式块存储架构原理、AWS EBS与阿里云ESSD架构分析、云盘性能规格解读、性能测试方法与选型成本优化
                

                
                    

2025-08-27 · storage
                    

### 【存储工程】文件系统选型与基准测试

                    

在生产环境中，文件系统（Filesystem）的选择直接影响存储栈的性能上限、数据安全边界和运维复杂度。本文将从设计目标、元数据性能、数据吞吐、典型业务场景、基准测试方法论等多个维度，对 ext4、XFS、Btrfs（B-tree Filesystem）、ZFS（Zettabyte File System）四种主流文件…
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。