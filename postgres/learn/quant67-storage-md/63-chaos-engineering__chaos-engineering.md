# 【存储工程】存储混沌工程

来源: https://quant67.com/post/storage/63-chaos-engineering/chaos-engineering.html
日期: 2025-10-11 |

---

存储系统的可靠性承诺，最终要靠故障来检验。一个分布式存储集群声称能容忍任意一块磁盘故障，但如果从来没有在生产环境或预发布环境中真正拔过盘、注入过慢
            I/O、破坏过数据校验和，那这个承诺就只是设计文档上的一行字。混沌工程（Chaos
            Engineering）的核心思想是：主动向系统注入可控的故障，观察系统的实际行为是否符合预期，在故障真正发生之前找到薄弱环节。
            

存储层的混沌工程有其特殊性。与网络层的丢包、延迟注入不同，存储层面临的故障模式更加多样：磁盘可能直接不可用，也可能只是变慢；数据可能完整丢失，也可能只是某几个比特翻转；文件系统可能在断电后元数据不一致，也可能只是日志回放变慢。这些故障在生产环境中都真实发生过，而且往往是最难排查的——因为存储故障的症状经常表现为上层应用的超时、数据不一致或性能劣化，距离根因隔了好几层抽象。
            

本文从存储层故障分类开始，逐一拆解磁盘故障注入、慢 I/O
            模拟、数据损坏注入三大类手段，再落到 Chaos Mesh 和
            LitmusChaos 两个 Kubernetes
            生态的混沌工程平台，最后讨论慢盘检测算法和混沌实验的设计方法论。
            
            

**版本说明** 本文涉及的软件版本：Linux 6.x
            内核、Chaos Mesh 2.6.x、LitmusChaos 3.x、fio
            3.36。不同版本的配置项和默认行为可能有差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、混沌工程在存储层的意义

            

### 1.1
            从”设计容错”到”验证容错”

            

分布式存储系统在设计阶段通常会考虑多种故障场景：三副本容忍单盘故障、纠删码（Erasure
            Coding）容忍多盘故障、WAL（Write-Ahead
            Log）保证崩溃一致性。但设计意图和实际行为之间存在鸿沟。代码实现可能有
            bug，配置可能被运维改错，硬件行为可能与假设不符。
            

一个典型的例子：某分布式存储系统设计上支持单副本故障自动恢复，但实际测试发现，当故障副本恰好是
            leader 副本时，leader
            选举和数据回填并发执行，导致回填过程中的写入丢失。这类问题在代码审查和单元测试中很难发现，只有在真正注入故障并观察端到端行为时才会暴露。
            

混沌工程把”我们认为系统能容忍这个故障”变成”我们验证了系统确实能容忍这个故障”。这个区别在存储层尤其关键，因为存储层的故障后果往往是不可逆的——数据一旦丢失或损坏，就无法通过重试来恢复。
            

### 1.2 存储层故障的特殊性

            

与网络故障相比，存储故障有三个显著特点：
            

第一，故障模式多样。网络故障的基本形态是丢包、延迟、分区，可以用少数几个参数描述。存储故障则包括设备不可用、设备变慢、数据静默损坏（Silent
            Data
            Corruption）、元数据丢失、空间耗尽、权限异常等，每种故障的表现形式和影响范围都不同。
            

第二，故障检测滞后。一块慢盘可能让整个存储集群的 P99
            延迟翻倍，但慢盘本身不会报错——它只是每次 I/O
            都比正常盘慢几十毫秒。系统日志里看不到任何错误信息，只有延迟监控指标才能捕捉到异常。静默数据损坏更隐蔽：数据在磁盘上已经损坏，但只有在下次读取并校验时才会被发现。
            

第三，后果严重且不可逆。网络故障通常可以通过重试解决，但存储故障可能导致数据永久丢失。如果三副本中的两副本同时损坏，或者
            WAL 文件在写入过程中断电导致校验失败，数据就真的丢了。
            

### 1.3 混沌工程的原则

            

存储混沌工程不是随机破坏系统，而是有方法论的故障验证。Netflix
            在其混沌工程实践中总结了几个核心原则，将其应用到存储层：
            

第一，建立稳态假设（Steady State
            Hypothesis）。在注入故障前，先定义”正常”是什么。对存储系统而言，稳态通常包括：写入成功率
            > 99.99%、P99 读延迟 < 10ms、数据校验通过率 100%。
            

第二，控制爆炸半径（Blast
            Radius）。从最小范围开始注入故障——先影响单块磁盘，再扩展到单台节点，最后才考虑多节点故障。每次只改变一个变量。
            

第三，自动化回滚。故障注入必须可逆，注入工具必须支持超时自动回滚。不能出现”注入了故障但忘了恢复”的情况。
            

第四，在生产环境或生产级环境中执行。预发布环境的负载模式、数据量、硬件配置与生产环境不同，可能掩盖真实问题。但在生产环境执行需要更严格的爆炸半径控制和回滚机制。
            
            

## 二、存储层故障分类

            

存储层的故障可以沿两个维度分类：故障层次（硬件 / 内核 /
            文件系统 / 应用）和故障形态（完全失败 / 性能劣化 /
            数据损坏）。下表给出主要的故障类型、典型表现和对应的注入工具：
            
            
            
            
            
            
            
            
            
            
            故障类型
            典型表现
            影响范围
            注入工具
            生产发生频率
            
            
            
            
            磁盘完全不可用
            I/O 错误，设备离线
            单盘
            dm-flakey、scsi_debug、热拔盘
            中（年故障率 1-3%）
            
            
            磁盘慢 I/O
            延迟升高 10-100 倍
            单盘，但影响全链路
            dm-delay、tc qdisc、cgroup I/O
            高（尤其 HDD 老化）
            
            
            静默数据损坏
            读取数据与写入不一致
            单扇区到单文件
            libfiu、dd 覆写、bitflip 注入
            低但后果严重
            
            
            文件系统元数据损坏
            挂载失败、fsck 报错
            单分区
            xfs_db、debugfs、断电注入
            低
            
            
            磁盘空间耗尽
            写入失败，ENOSPC
            单分区到单节点
            fallocate 填充、配额限制
            高
            
            
            存储网络分区
            存储节点不可达
            节点间通信
            iptables、tc netem
            中
            
            
            权限 / 挂载异常
            Permission denied、只读文件系统
            单挂载点
            mount -o remount,ro、chmod
            低
            
            
            
            

### 2.1 磁盘故障

            

磁盘故障是存储层最常见的硬件故障。Google 在 2007
            年发表的论文 “Failure Trends in a Large Disk Drive
            Population” 统计了超过 10
            万块磁盘的故障数据，发现年故障率（Annualized Failure
            Rate，AFR）在 1.7% 到 8.6%
            之间，具体取决于磁盘型号和使用年限。Backblaze
            每季度发布的硬盘故障报告也给出了类似的数据范围。
            

磁盘故障的形态不只是”坏了”这一种。按照严重程度可以细分为：
            
            
- **完全故障**：磁盘不响应任何 I/O
            请求，设备在操作系统层面离线。对应 SCSI 层面的
            DID_NO_CONNECT 或 DID_TIME_OUT 状态。
            
- **部分故障**：磁盘能响应部分请求，但某些扇区（Sector）不可读。对应
            SCSI 层面的 MEDIUM_ERROR。
            
- **性能劣化**：磁盘仍然能完成所有 I/O
            请求，但延迟显著升高。HDD 常见于机械臂（Actuator
            Arm）寻道异常，SSD 常见于垃圾回收（Garbage
            Collection）风暴或 NAND 老化导致的读取重试（Read
            Retry）。
            
            

### 2.2 慢 I/O

            

慢 I/O
            是存储系统中最隐蔽的故障类型。一块慢盘不会触发任何错误告警——它只是比正常盘慢。但在分布式系统中，一次请求的完成时间取决于最慢的那个分片（Shard），一块慢盘可能拖慢整个集群的尾延迟。
            

慢 I/O 的成因包括：
            
            
- HDD 机械部件老化，寻道时间从 5ms 退化到 50ms
            
- SSD NAND 颗粒老化，读取需要多次重试（Read
            Retry），延迟从 100us 升至 10ms
            
- SSD 后台垃圾回收（GC）占用控制器带宽，前台 I/O
            被暂停
            
- RAID 控制器缓存策略切换（例如从 Write-Back 退化到
            Write-Through）
            
- 存储网络拥塞（iSCSI、NFS 场景）
            
            

### 2.3 数据损坏

            

数据损坏分为两类：可检测的和不可检测的。
            

可检测的损坏会在读取时触发 I/O 错误，例如磁盘控制器的 CRC
            校验失败、ECC（Error Correction
            Code）纠错失败。这类故障处理起来相对简单——读取失败，切换到其他副本。
            

不可检测的损坏（即静默数据损坏）更危险。数据在磁盘上被改变了，但磁盘控制器没有检测到。这种情况确实存在：CERN
            在 2007 年的研究中发现，在其存储集群中，每 10^15
            比特读取就有约 1 比特的静默错误。NetApp 的 ZFS
            团队也报告过类似的数据。虽然概率很低，但在大规模存储系统中，数据量足够大时，这个概率就变成了必然事件。
            

### 2.4 文件系统与空间故障

            

文件系统层面的故障主要是元数据不一致和空间耗尽。元数据不一致通常由非正常关机（断电、内核
            panic）触发——尽管现代日志文件系统（ext4 的 journal、XFS 的
            log）能防止大多数元数据不一致，但边界条件下仍有可能出现问题。Wisconsin
            大学的 ALICE（Application-Level Intelligent Crash
            Explorer）项目专门研究应用层在崩溃后的状态一致性问题。
            

空间耗尽（ENOSPC）是一种经常被忽略的故障模式。很多存储系统在
            ENOSPC 时的行为没有被充分测试——WAL 写不进去了，Compaction
            做不了了，元数据更新失败了——这些场景下系统是否能优雅降级（Graceful
            Degradation），而不是直接崩溃或数据损坏？
            
            

## 三、磁盘故障注入

            

### 3.1
            dm-flakey：Device Mapper 层故障注入

            

dm-flakey 是 Linux 内核自带的设备映射目标（Device Mapper
            Target），可以让一个块设备在指定时间内正常工作，然后在另一段时间内返回
            I/O
            错误。它工作在块设备层，不依赖任何用户态工具，适合模拟磁盘间歇性故障。
            

dm-flakey 的基本模型是两个时间段交替：
            
```
├── up_interval ──┤── down_interval ──┤── up_interval ──┤── ...
│  正常处理 I/O    │  丢弃/返回错误     │  正常处理 I/O    │
```

            

创建一个 dm-flakey 设备的基本步骤：
            
```
# 1. 创建一个用于测试的环回设备
dd if=/dev/zero of=test_disk.img bs=1M count=1024
LOOP_DEV=$(losetup --find --show test_disk.img)
echo "环回设备: $LOOP_DEV"

# 2. 获取设备大小（以扇区为单位）
SECTORS=$(blockdev --getsz "$LOOP_DEV")

# 3. 创建 dm-flakey 设备
# 格式:   flakey     []
# 下面的配置：每 30 秒正常，之后 5 秒返回错误
echo "0 $SECTORS flakey $LOOP_DEV 0 30 5" | dmsetup create flakey-test

# 4. 在 dm-flakey 设备上创建文件系统并挂载
mkfs.ext4 /dev/mapper/flakey-test
mkdir -p /mnt/flakey-test
mount /dev/mapper/flakey-test /mnt/flakey-test
```

            

在 down_interval
            期间，默认行为是丢弃所有写入并让读取返回错误。可以通过额外参数控制故障行为：
            
```
# 只丢弃写入，读取仍然正常（模拟写故障）
echo "0 $SECTORS flakey $LOOP_DEV 0 30 5 1 drop_writes" | dmsetup create flakey-write-only

# 在 down_interval 期间对写入数据进行比特翻转（模拟静默损坏）
echo "0 $SECTORS flakey $LOOP_DEV 0 30 5 1 corrupt_bio_byte 1 w 0 0" | dmsetup create flakey-corrupt
```

            

`corrupt_bio_byte` 参数的格式是
            `corrupt_bio_byte    `，其中
            ``
            是要损坏的字节偏移量，``
            指定读（r）还是写（w），``
            是要异或的值（0 表示随机）。
            

清理 dm-flakey 设备：
            
```
umount /mnt/flakey-test
dmsetup remove flakey-test
losetup -d "$LOOP_DEV"
rm test_disk.img
```

            

### 3.2 scsi_debug：虚拟 SCSI
            设备

            

scsi_debug 是一个内核模块，可以创建虚拟的 SCSI 设备。与
            dm-flakey 相比，scsi_debug 工作在 SCSI
            层，能模拟更底层的故障，例如 SCSI 命令超时、特定
            LBA（Logical Block Address）的读取错误。
            
```
# 加载 scsi_debug 模块，创建一个 1GB 的虚拟 SCSI 磁盘
# num_tgts: 目标数量  dev_size_mb: 设备大小
modprobe scsi_debug num_tgts=1 dev_size_mb=1024

# 查看创建的设备
lsscsi | grep scsi_debug
# 输出示例: [2:0:0:0] disk Linux scsi_debug 0191 /dev/sdb

# 注入介质错误（Medium Error）：让特定 LBA 范围不可读
# 通过 sysfs 接口注入
echo "0+100" > /sys/bus/pseudo/drivers/scsi_debug/medium_error_start
echo "100" > /sys/bus/pseudo/drivers/scsi_debug/medium_error_count

# 模拟命令超时
echo "5" > /sys/bus/pseudo/drivers/scsi_debug/every_nth
echo "1" > /sys/bus/pseudo/drivers/scsi_debug/opts  # 1 = SDEBUG_OPT_TIMEOUT
```

            

scsi_debug 的优势在于能模拟 SCSI
            层面的错误码，这对测试存储系统的 SCSI
            错误处理路径非常有用。但它只能创建虚拟设备，无法对已有的物理磁盘注入故障。
            

### 3.3 实践：dm-flakey
            下测试数据库恢复

            

下面是一个完整的实验：在 dm-flakey 设备上运行 SQLite
            数据库，注入磁盘故障，观察数据库在故障后能否正确恢复。
            
```
#!/bin/bash
# 实验：dm-flakey 下 SQLite 崩溃恢复测试

set -euo pipefail

IMG_FILE="sqlite_flakey_test.img"
DM_NAME="sqlite-flakey"
MOUNT_POINT="/mnt/sqlite-flakey"

# 创建测试环境
dd if=/dev/zero of="$IMG_FILE" bs=1M count=512
LOOP_DEV=$(losetup --find --show "$IMG_FILE")
SECTORS=$(blockdev --getsz "$LOOP_DEV")

# 初始阶段：创建正常设备，建库并写入基线数据
echo "0 $SECTORS linear $LOOP_DEV 0" | dmsetup create "$DM_NAME"
mkfs.ext4 -q /dev/mapper/"$DM_NAME"
mkdir -p "$MOUNT_POINT"
mount /dev/mapper/"$DM_NAME" "$MOUNT_POINT"

# 创建数据库并写入 10000 行基线数据
sqlite3 "$MOUNT_POINT/test.db" &1 || true
BEGIN;
$(for i in $(seq 1 1000); do
    idx=$((10000 + (batch - 1) * 1000 + i))
    echo "INSERT OR REPLACE INTO data VALUES($idx, 'flakey_row_$idx', hex(randomblob(16)));"
done)
COMMIT;
EOF
    echo "  批次 $batch 完成（或失败）"
    sleep 8  # 等待经过一个 down_interval
done

# 恢复到正常模式，检查数据库完整性
umount "$MOUNT_POINT" 2>/dev/null || true
dmsetup remove "$DM_NAME"
echo "0 $SECTORS linear $LOOP_DEV 0" | dmsetup create "$DM_NAME"
mount /dev/mapper/"$DM_NAME" "$MOUNT_POINT"

echo "=== 数据库完整性检查 ==="
sqlite3 "$MOUNT_POINT/test.db" "PRAGMA integrity_check;"
echo "=== 实际行数 ==="
sqlite3 "$MOUNT_POINT/test.db" "SELECT count(*) FROM data;"

# 清理
umount "$MOUNT_POINT"
dmsetup remove "$DM_NAME"
losetup -d "$LOOP_DEV"
rm "$IMG_FILE"
```

            

这个实验的关键观察点是：SQLite 的 WAL
            模式是否能在部分写入被丢弃的情况下保持数据库一致性。预期结果是
            `PRAGMA integrity_check` 返回
            `ok`，实际行数可能少于预期（因为部分事务的写入被丢弃了），但不应该出现数据库损坏。
            
            

## 四、慢 I/O 模拟

            

### 4.1
            dm-delay：块设备层延迟注入

            

dm-delay 是另一个 Device Mapper 目标，能为经过的 I/O
            请求添加固定延迟。与 dm-flakey 不同，dm-delay
            不会丢弃或损坏数据，只是让 I/O 变慢。
            
```
# 创建环回设备
dd if=/dev/zero of=slow_disk.img bs=1M count=1024
LOOP_DEV=$(losetup --find --show slow_disk.img)
SECTORS=$(blockdev --getsz "$LOOP_DEV")

# 创建 dm-delay 设备
# 格式:   delay    [  ]
# 读延迟 50ms，写延迟 100ms
echo "0 $SECTORS delay $LOOP_DEV 0 50 $LOOP_DEV 0 100" | dmsetup create slow-disk

# 格式化并挂载
mkfs.ext4 -q /dev/mapper/slow-disk
mkdir -p /mnt/slow-disk
mount /dev/mapper/slow-disk /mnt/slow-disk

# 用 fio 验证延迟注入效果
fio --name=latency-test \
    --filename=/mnt/slow-disk/testfile \
    --size=64M \
    --bs=4k \
    --rw=randread \
    --direct=1 \
    --ioengine=libaio \
    --iodepth=1 \
    --numjobs=1 \
    --runtime=10 \
    --time_based \
    --group_reporting
```

            

dm-delay
            的局限是只能注入固定延迟，无法模拟延迟抖动（Jitter）。真实的慢盘延迟分布通常不是固定值，而是呈现长尾分布——大部分请求正常，少量请求延迟异常高。
            

### 4.2 tc qdisc
            netem：网络层延迟注入

            

对于 NFS、iSCSI 等网络存储场景，可以用 Linux
            流量控制（Traffic Control，tc）的 netem（Network
            Emulator）模块注入网络层延迟：
            
```
# 对 eth0 接口添加延迟：平均 50ms，标准差 20ms，相关性 25%
tc qdisc add dev eth0 root netem delay 50ms 20ms 25%

# 更复杂的场景：延迟 + 丢包 + 包重排序
tc qdisc add dev eth0 root netem \
    delay 50ms 20ms 25% \
    loss 0.1% \
    reorder 5% 50%

# 只对特定端口生效（例如 iSCSI 3260 端口）
tc qdisc add dev eth0 root handle 1: prio
tc qdisc add dev eth0 parent 1:3 handle 30: netem delay 50ms 20ms
tc filter add dev eth0 protocol ip parent 1:0 prio 3 u32 \
    match ip dport 3260 0xffff flowid 1:3

# 查看当前 qdisc 配置
tc qdisc show dev eth0

# 删除 qdisc 规则
tc qdisc del dev eth0 root
```

            

netem
            的优势在于能模拟真实的网络延迟分布，包括抖动和相关性。但它只对网络存储有效，对本地磁盘无效。
            

### 4.3 cgroup v2 I/O 限制

            

cgroup v2 的 io 控制器可以限制进程组的 I/O 带宽和
            IOPS（I/O Operations Per Second），间接模拟慢盘效果：
            
```
# 确认 cgroup v2 已挂载
mount | grep cgroup2

# 创建 cgroup
mkdir -p /sys/fs/cgroup/io-throttle

# 查看目标设备的 major:minor 号
ls -la /dev/sda
# 假设是 8:0

# 设置 I/O 带宽限制：读 10MB/s，写 5MB/s
echo "8:0 rbps=10485760 wbps=5242880" > /sys/fs/cgroup/io-throttle/io.max

# 设置 IOPS 限制：读 100 IOPS，写 50 IOPS
echo "8:0 riops=100 wiops=50" > /sys/fs/cgroup/io-throttle/io.max

# 同时限制带宽和 IOPS
echo "8:0 rbps=10485760 wbps=5242880 riops=100 wiops=50" > /sys/fs/cgroup/io-throttle/io.max

# 将目标进程加入 cgroup
echo $PID > /sys/fs/cgroup/io-throttle/cgroup.procs

# 查看当前 I/O 统计
cat /sys/fs/cgroup/io-throttle/io.stat
```

            

cgroup I/O
            限制的特点是粒度在进程组级别——可以只限制特定应用的
            I/O，而不影响同一台机器上的其他进程。这在多租户环境中更接近真实场景。
            

### 4.4 三种慢 I/O
            注入方式对比

            
            
            
            对比维度
            dm-delay
            tc netem
            cgroup v2 io
            
            
            
            
            工作层次
            块设备层
            网络层
            进程调度层
            
            
            适用场景
            本地磁盘
            网络存储（NFS/iSCSI）
            本地磁盘 + 网络存储
            
            
            延迟模型
            固定延迟
            正态分布 + 相关性
            带宽/IOPS 上限
            
            
            抖动模拟
            不支持
            支持
            间接（通过排队）
            
            
            影响粒度
            整个块设备
            网络接口/端口
            进程组
            
            
            对上层透明
            是
            是
            是
            
            
            内核依赖
            Device Mapper
            TC 子系统
            cgroup v2
            
            
            配置复杂度
            低
            中
            中
            
            
            
            

我认为在实际的混沌实验中，这三种工具应该组合使用。dm-delay
            适合测试存储引擎在固定延迟下的超时处理逻辑；tc netem
            适合测试分布式存储在网络抖动下的一致性协议表现；cgroup I/O
            限制适合测试多租户场景下的资源隔离效果。单独使用任何一种都无法覆盖全部场景。
            
            

## 五、数据损坏注入

            

### 5.1
            libfiu：用户态故障注入框架

            

libfiu（Fault Injection in Userspace）是一个 C
            语言的用户态故障注入库，通过预加载（LD_PRELOAD）机制拦截
            POSIX I/O 调用，在指定条件下返回错误或修改数据。
            
```
# 安装 libfiu（Ubuntu/Debian）
apt-get install -y fiu-utils libfiu-dev

# 基本用法：让 open() 系统调用以一定概率失败
# fiu-run 会预加载 libfiu 的拦截库
fiu-run -c "enable name=posix/io/rw/read,failinfo=5" -- cat /etc/hostname

# 更精细的控制：通过 fiu-ctrl 动态启用/禁用故障点
# 1. 启动目标程序，开启 fiu 控制通道
fiu-run -x -- my_storage_app &
APP_PID=$!

# 2. 在运行时启用特定故障点
fiu-ctrl -c "enable name=posix/io/rw/write,probability=0.01" $APP_PID

# 3. 观察一段时间后禁用故障
fiu-ctrl -c "disable name=posix/io/rw/write" $APP_PID
```

            

libfiu 的优势是不需要修改应用代码，通过 LD_PRELOAD
            拦截系统调用即可注入故障。但它只能拦截用户态的 libc
            调用——如果应用直接使用 `syscall()` 或者使用了
            io_uring，就无法拦截。
            

### 5.2 手动比特翻转注入

            

对于测试存储系统的校验和（Checksum）机制，最直接的方法是在数据写入磁盘后手动翻转几个比特：
            
```
#!/usr/bin/env python3
"""
对指定文件的指定偏移量进行比特翻转，模拟静默数据损坏。
注意：此脚本会直接修改文件内容，仅用于测试环境。
"""
import os
import sys
import random

def flip_bits(filepath: str, offset: int, num_bits: int = 1) -> None:
    """在文件的指定偏移量处翻转指定数量的比特。"""
    with open(filepath, "r+b") as f:
        f.seek(offset)
        original_byte = f.read(1)
        if not original_byte:
            print(f"错误：偏移量 {offset} 超出文件大小", file=sys.stderr)
            sys.exit(1)

        byte_val = original_byte[0]
        for _ in range(num_bits):
            bit_pos = random.randint(0, 7)
            byte_val ^= (1  修改后: 0x{byte_val:02x}")

if __name__ == "__main__":
    if len(sys.argv)   [翻转比特数]")
        sys.exit(1)

    filepath = sys.argv[1]
    offset = int(sys.argv[2])
    num_bits = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    flip_bits(filepath, offset, num_bits)
```

            

配合 ZFS 或 Btrfs
            等支持数据校验和的文件系统使用，可以验证其校验和检测机制是否有效：
            
```
# 在 ZFS 池中写入测试文件
dd if=/dev/urandom of=/zpool/test/datafile bs=1M count=100
md5sum /zpool/test/datafile  # 记录校验和

# 绕过 ZFS 直接在底层设备上翻转比特
# 先找到文件在底层设备上的物理位置
zdb -ddddd zpool/test datafile

# 对底层设备进行比特翻转
python3 flip_bits.py /dev/sdb 1048576 4

# 读取文件，观察 ZFS 是否检测到损坏
cat /zpool/test/datafile > /dev/null
# 检查 ZFS 事件日志
zpool events | grep -i "checksum"

# 执行 scrub 主动检测
zpool scrub zpool
zpool status -v zpool
```

            

### 5.3
            ALICE：应用级崩溃一致性检测

            

ALICE（Application-Level Intelligent Crash Explorer）是
            Wisconsin
            大学开发的工具，用于系统性地测试应用程序在任意崩溃点后的状态一致性。它通过记录应用程序的所有
            I/O 操作，然后模拟在每一个 I/O
            操作之间发生崩溃，检查应用程序在恢复后是否能回到一致状态。
            

ALICE 的工作流程如下：
            
```
┌─────────────────────────────────────────────────────────┐
│                    ALICE 工作流程                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 录制阶段                                            │
│     ┌──────────┐    ┌──────────────┐                    │
│     │ 应用程序  │───▶│ ALICE 记录器  │                    │
│     └──────────┘    └──────┬───────┘                    │
│                           │                             │
│                    记录所有 I/O 操作                      │
│                    (write, fsync, rename, ...)           │
│                           │                             │
│  2. 分析阶段              ▼                              │
│     ┌─────────────────────────────┐                     │
│     │ 在每个 I/O 操作之间模拟崩溃   │                     │
│     │                             │                     │
│     │  op1 ─ crash? ─ op2 ─ crash?│─ op3 ─ ...         │
│     └─────────────┬───────────────┘                     │
│                   │                                     │
│  3. 验证阶段      ▼                                      │
│     ┌─────────────────────────────┐                     │
│     │ 对每个崩溃点：                │                     │
│     │   - 重放该点之前的 I/O        │                     │
│     │   - 启动应用恢复流程          │                     │
│     │   - 检查数据一致性            │                     │
│     └─────────────────────────────┘                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

            

ALICE 的发现令人警醒：在其 2014 年发表的论文 “All File
            Systems Are Not Created Equal” 中，研究团队测试了当时主流的
            11 个应用程序（包括 LevelDB、SQLite、PostgreSQL 等），发现了
            60 多个崩溃一致性 bug。其中一些 bug
            会导致数据丢失，而这些应用在正常运行时都声称支持崩溃安全（Crash
            Safety）。
            

这个结果说明：即使应用程序正确使用了
            `fsync()`，文件系统层面的语义差异（例如 ext4 在
            data=ordered 和 data=writeback
            模式下的行为差异）仍然可能导致崩溃后的数据不一致。存储混沌工程不能只测试”磁盘坏了会怎样”，还需要测试”写到一半断电了会怎样”。
            
            

## 六、Chaos Mesh IOChaos
            实战

            

### 6.1 Chaos Mesh 架构概述

            

Chaos Mesh（混沌网格）是 PingCAP 开源的 Kubernetes
            原生混沌工程平台。其核心架构由三部分组成：
            
            
- **chaos-controller-manager**：运行在控制平面（Control
            Plane），接收用户提交的混沌实验 CRD（Custom Resource
            Definition），调度到目标 Pod。
            
- **chaos-daemon**：以 DaemonSet
            形式运行在每个节点上，拥有宿主机的特权权限，负责实际的故障注入操作（例如通过
            ptrace 拦截系统调用、操作 iptables、修改 cgroup
            配置）。
            
- **chaos-dashboard**：Web
            UI，提供实验管理、执行历史和事件查看。
            
            

IOChaos 是 Chaos Mesh 提供的 I/O 层故障注入能力，通过
            FUSE（Filesystem in
            Userspace）机制拦截目标容器的文件系统调用，注入延迟、错误或数据损坏。
            

### 6.2 IOChaos 工作原理

            

IOChaos 的注入流程如下：
            
            
- chaos-daemon 在目标 Pod 的 mount namespace 中注入一个
            FUSE 守护进程
            
- 将目标路径的挂载点替换为 FUSE 文件系统
            
- 所有经过该路径的文件系统调用（open、read、write、fsync
            等）都被 FUSE 守护进程拦截
            
- FUSE
            守护进程根据实验配置决定是否注入故障（延迟、错误码、数据修改）
            
- 实验结束后，恢复原始挂载点
            
            
```
# IOChaos 示例：对数据库容器的数据目录注入延迟和错误
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: db-io-delay
  namespace: chaos-testing
spec:
  action: latency
  mode: one
  selector:
    namespaces:
      - production
    labelSelectors:
      app: tikv
  volumePath: /var/lib/tikv
  path: "/var/lib/tikv/db/**"
  delay: "100ms"
  percent: 50         # 50% 的 I/O 操作受影响
  duration: "5m"
  methods:
    - read
    - write
```

            

### 6.3 IOChaos 完整实战

            

下面是一个完整的 IOChaos 实验，模拟 TiKV
            节点磁盘延迟升高，观察 TiDB 集群的读写延迟变化：
            
```
# 1. 部署 Chaos Mesh（假设已有 Kubernetes 集群）
# helm repo add chaos-mesh https://charts.chaos-mesh.org
# helm install chaos-mesh chaos-mesh/chaos-mesh -n chaos-mesh --create-namespace

# 2. 定义稳态假设（通过 Prometheus 查询验证）
# - TiDB QPS > 1000
# - TiDB P99 延迟 
            
```
# 4. IOChaos 实验：TiKV I/O 错误注入
---
apiVersion: chaos-mesh.org/v1alpha1
kind: IOChaos
metadata:
  name: tikv-io-error
  namespace: chaos-testing
spec:
  action: fault
  mode: one
  selector:
    namespaces:
      - tidb-cluster
    labelSelectors:
      app.kubernetes.io/component: tikv
  volumePath: /var/lib/tikv
  path: "/var/lib/tikv/db/**.sst"   # 只影响 SST 文件
  errno: 5                           # EIO (I/O error)
  percent: 10                         # 10% 的读操作返回错误
  duration: "5m"
  methods:
    - read
```

            
```
# 5. 使用 Workflow 编排多阶段实验
---
apiVersion: chaos-mesh.org/v1alpha1
kind: Workflow
metadata:
  name: tikv-io-chaos-workflow
  namespace: chaos-testing
spec:
  entry: io-chaos-sequence
  templates:
    - name: io-chaos-sequence
      templateType: Serial
      deadline: "30m"
      children:
        - io-latency-phase
        - recovery-check
        - io-error-phase
        - final-check
    - name: io-latency-phase
      templateType: IOChaos
      deadline: "10m"
      ioChaos:
        action: latency
        mode: one
        selector:
          namespaces:
            - tidb-cluster
          labelSelectors:
            app.kubernetes.io/component: tikv
        volumePath: /var/lib/tikv
        path: "/var/lib/tikv/**"
        delay: "200ms"
        percent: 100
        methods:
          - write
    - name: recovery-check
      templateType: Suspend
      deadline: "5m"   # 等待 5 分钟观察恢复
    - name: io-error-phase
      templateType: IOChaos
      deadline: "5m"
      ioChaos:
        action: fault
        mode: one
        selector:
          namespaces:
            - tidb-cluster
          labelSelectors:
            app.kubernetes.io/component: tikv
        volumePath: /var/lib/tikv
        path: "/var/lib/tikv/**"
        errno: 5
        percent: 5
        methods:
          - read
    - name: final-check
      templateType: Suspend
      deadline: "5m"
```

            

### 6.4 IOChaos 的局限性

            

IOChaos 基于 FUSE
            拦截文件系统调用，这个设计带来了几个限制：
            

第一，FUSE 本身引入额外延迟。即使不注入任何故障，FUSE
            路径的 I/O 延迟也比原生文件系统高——每次 I/O
            需要经过内核到用户态再到内核的往返。对于延迟敏感的存储引擎，这个基线偏差需要在实验设计中考虑。
            

第二，IOChaos 无法模拟块设备层的故障。FUSE
            拦截的是文件系统调用（open、read、write），而不是块设备
            I/O（bio 提交、块合并）。某些存储系统直接操作块设备（例如
            Ceph OSD 的 BlueStore），IOChaos 对这类场景无效。
            

第三，对 Direct I/O 和 io_uring 的支持有限。使用 O_DIRECT
            的应用绕过了 Page Cache，FUSE
            拦截路径可能与预期不同。io_uring 的异步提交路径也可能不经过
            FUSE 拦截点。
            
            

## 七、LitmusChaos
            磁盘故障实验

            

### 7.1
            LitmusChaos 与 Chaos Mesh 的定位差异

            

LitmusChaos 是 CNCF（Cloud Native Computing
            Foundation）孵化项目，采用了与 Chaos Mesh
            不同的设计理念。核心差异在于：
            
            
            
            对比维度
            Chaos Mesh
            LitmusChaos
            
            
            
            
            故障注入方式
            DaemonSet + 特权操作
            ChaosEngine + 实验 Pod
            
            
            实验定义
            自定义 CRD
            ChaosExperiment + ChaosEngine
            
            
            社区生态
            PingCAP 主导
            CNCF 孵化，社区贡献
            
            
            实验仓库
            内置
            ChaosHub（中心化实验仓库）
            
            
            稳态验证
            外部（Prometheus/Grafana）
            内置 Probe 机制
            
            
            磁盘故障
            IOChaos（FUSE）
            disk-fill、disk-loss、node-io-stress
            
            
            许可证
            Apache 2.0
            Apache 2.0
            
            
            
            

LitmusChaos 的 Probe
            机制是一个重要特性：可以在实验定义中直接声明稳态假设，而不需要依赖外部监控系统。
            

### 7.2 磁盘填充实验

            

disk-fill
            实验通过在目标容器中创建大文件消耗磁盘空间，模拟 ENOSPC
            场景：
            
```
# ChaosExperiment：磁盘填充
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosExperiment
metadata:
  name: disk-fill
  namespace: litmus
spec:
  definition:
    scope: Namespaced
    permissions:
      - apiGroups: [""]
        resources: ["pods"]
        verbs: ["create", "delete", "get", "list"]
    image: litmuschaos/go-runner:latest
    args:
      - -c
      - ./experiments -name disk-fill
    command:
      - /bin/bash
    env:
      - name: FILL_PERCENTAGE
        value: "90"
      - name: TOTAL_CHAOS_DURATION
        value: "300"   # 持续 5 分钟
      - name: TARGET_CONTAINER
        value: "tikv"
      - name: CONTAINER_PATH
        value: "/var/lib/tikv"
---
# ChaosEngine：绑定实验到目标应用
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: tikv-disk-fill
  namespace: tidb-cluster
spec:
  appinfo:
    appns: tidb-cluster
    applabel: "app.kubernetes.io/component=tikv"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: disk-fill
      spec:
        probe:
          - name: tikv-health-check
            type: httpProbe
            httpProbe/inputs:
              url: "http://tikv-svc:20180/status"
              method:
                get:
                  criteria: "=="
                  responseCode: "200"
            mode: Continuous
            runProperties:
              probeTimeout: 5s
              interval: 10s
              retry: 3
          - name: data-integrity-check
            type: cmdProbe
            cmdProbe/inputs:
              command: "mysql -h tidb-svc -e 'SELECT count(*) FROM test.verify_table'"
              comparator:
                type: int
                criteria: ">="
                value: "1000"
            mode: Edge
            runProperties:
              probeTimeout: 10s
              interval: 30s
```

            

### 7.3 节点 I/O 压力实验

            

node-io-stress 实验使用 stress-ng 在目标节点上产生大量
            I/O 负载，模拟邻居噪音（Noisy Neighbor）场景：
            
```
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: node-io-stress-test
  namespace: litmus
spec:
  appinfo:
    appns: tidb-cluster
    applabel: "app.kubernetes.io/component=tikv"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: node-io-stress
      spec:
        components:
          env:
            - name: FILESYSTEM_UTILIZATION_PERCENTAGE
              value: "80"
            - name: NUMBER_OF_WORKERS
              value: "4"
            - name: TOTAL_CHAOS_DURATION
              value: "600"     # 持续 10 分钟
            - name: VOLUME_MOUNT_PATH
              value: "/var/lib/tikv"
        probe:
          - name: p99-latency-check
            type: promProbe
            promProbe/inputs:
              endpoint: "http://prometheus:9090"
              query: "histogram_quantile(0.99, sum(rate(tikv_grpc_msg_duration_seconds_bucket[1m])) by (le))"
              comparator:
                type: float
                criteria: "
            

LitmusChaos 的 Probe
            机制使得”稳态假设”可以作为实验定义的一部分，而不是事后手动检查。实验结束时，如果任何
            Probe 的断言失败，实验结果会被标记为
            fail——这表示系统在故障注入后的行为不符合预期，需要调查。
            
            

## 八、慢盘检测算法

            

### 8.1 问题定义

            

慢盘检测（Slow Disk
            Detection）是混沌工程的反面：混沌工程是主动注入故障观察系统反应，慢盘检测是在生产环境中被动识别出那些性能异常的磁盘。两者在算法层面有交集——混沌工程中模拟的慢盘需要符合真实慢盘的延迟特征，而慢盘检测算法则需要用混沌工程来验证其准确性。
            

慢盘检测的核心挑战是：如何在没有固定阈值的情况下，判断一块磁盘是否”异常慢”。固定阈值（例如”P99
            延迟超过 50ms
            就告警”）在实践中很难维护——不同型号的磁盘正常延迟不同，不同负载模式下的延迟也不同，同一块磁盘在不同时段的延迟也会波动。
            

### 8.2 延迟百分位方法

            

最基础的慢盘检测方法是基于延迟百分位数（Latency
            Percentile）。对每块磁盘持续采集 I/O 延迟，计算
            P50、P99、P999
            等分位数，然后与同组（同型号、同负载）的其他磁盘进行横向比较。
            
```
#!/usr/bin/env python3
"""
基于 MAD（中位数绝对偏差）的慢盘检测算法。
MAD 比标准差更能抵抗离群值的干扰。
"""
import numpy as np
from dataclasses import dataclass

@dataclass
class DiskLatencyStats:
    disk_id: str
    p50_us: float   # 中位数延迟（微秒）
    p99_us: float   # P99 延迟（微秒）
    p999_us: float  # P999 延迟（微秒）
    iops: float     # 当前 IOPS

def detect_slow_disks(
    stats_list: list[DiskLatencyStats],
    threshold_multiplier: float = 3.0
) -> list[tuple[str, str]]:
    """
    使用 MAD 方法检测慢盘。
    返回 (disk_id, reason) 的列表。

    MAD = median(|Xi - median(X)|)
    异常阈值 = median(X) + threshold_multiplier * 1.4826 * MAD
    1.4826 是将 MAD 转换为标准差估计的常数（正态分布下）。
    """
    if len(stats_list)  threshold:
                deviation = (metric_val - median_val) / (1.4826 * mad)
                slow_disks.append((
                    stats.disk_id,
                    f"{metric_name} 延迟 {metric_val:.0f}us "
                    f"超过阈值 {threshold:.0f}us "
                    f"（偏离 {deviation:.1f} 倍 MAD）"
                ))

    return slow_disks

# 使用示例
if __name__ == "__main__":
    disk_stats = [
        DiskLatencyStats("sda", 120, 450, 2100, 5000),
        DiskLatencyStats("sdb", 115, 430, 1980, 5200),
        DiskLatencyStats("sdc", 125, 470, 2050, 4800),
        DiskLatencyStats("sdd", 118, 440, 2000, 5100),
        DiskLatencyStats("sde", 350, 1500, 8500, 2000),  # 慢盘
        DiskLatencyStats("sdf", 122, 460, 2080, 4900),
        DiskLatencyStats("sdg", 130, 480, 2150, 4700),
        DiskLatencyStats("sdh", 119, 435, 1990, 5050),
    ]

    results = detect_slow_disks(disk_stats)
    for disk_id, reason in results:
        print(f"[慢盘告警] {disk_id}: {reason}")
```

            

执行输出示例：
            
```
[慢盘告警] sde: P50 延迟 350us 超过阈值 171us（偏离 32.3 倍 MAD）
[慢盘告警] sde: P99 延迟 1500us 超过阈值 559us（偏离 30.8 倍 MAD）
[慢盘告警] sde: P999 延迟 8500us 超过阈值 2485us（偏离 27.0 倍 MAD）
```

            

### 8.3 滑动窗口异常检测

            

MAD
            方法对横向比较有效（同一时刻比较不同磁盘），但无法检测所有磁盘同时劣化的场景（例如存储网络整体变慢）。需要结合纵向比较（同一块磁盘的历史延迟）：
            
```
#!/usr/bin/env python3
"""
基于指数加权移动平均（EWMA）的纵向慢盘检测。
"""
from collections import deque

class EWMADetector:
    """
    使用 EWMA（Exponentially Weighted Moving Average）跟踪延迟趋势，
    当当前延迟显著偏离历史趋势时触发告警。
    """

    def __init__(self, alpha: float = 0.1, sigma_threshold: float = 3.0):
        """
        alpha: EWMA 衰减因子，越小越平滑
        sigma_threshold: 告警阈值（偏离几倍标准差）
        """
        self.alpha = alpha
        self.sigma_threshold = sigma_threshold
        self.ewma: float | None = None
        self.ewma_var: float = 0.0  # EWMA 方差
        self.sample_count: int = 0

    def update(self, latency_us: float) -> tuple[bool, str]:
        """
        输入一个新的延迟样本，返回 (是否异常, 原因描述)。
        """
        self.sample_count += 1

        if self.ewma is None:
            self.ewma = latency_us
            return False, ""

        # 更新 EWMA 均值
        diff = latency_us - self.ewma
        self.ewma = self.alpha * latency_us + (1 - self.alpha) * self.ewma

        # 更新 EWMA 方差
        self.ewma_var = (1 - self.alpha) * (self.ewma_var + self.alpha * diff * diff)
        ewma_std = self.ewma_var ** 0.5

        if self.sample_count  0 and abs(diff) > self.sigma_threshold * ewma_std:
            return True, (
                f"当前延迟 {latency_us:.0f}us 偏离 EWMA {self.ewma:.0f}us "
                f"达 {abs(diff)/ewma_std:.1f} 倍标准差"
            )

        return False, ""
```

            

### 8.4 业界实践

            

实际的慢盘检测系统通常结合横向和纵向两种方法。以下是几个业界的做法：
            

**HDFS 慢盘检测**。Hadoop 3.x
            引入了慢节点检测机制（HDFS-11461），DataNode 定期向 NameNode
            报告每块磁盘的 I/O 延迟百分位数，NameNode
            在全局视角下使用中位数比较法识别慢盘，然后将慢节点的信息下发给
            DFSClient，DFSClient 在选择数据块位置时规避慢节点。
            

**Ceph 慢 OSD 检测**。Ceph 从 Nautilus
            版本（14.x）开始引入了慢请求检测（Slow Request），OSD
            进程会跟踪每个 I/O
            操作在各阶段的耗时，当某个阶段超过阈值（默认 30
            秒）时记录慢请求日志。但这个机制是基于固定阈值的，不是基于统计异常的，存在阈值难以调优的问题。
            

我认为慢盘检测的核心难点不在于算法本身——MAD 和 EWMA
            都是成熟的统计方法——而在于特征选取和阈值自适应。不同的存储负载模式（顺序写
            vs 随机读、大 I/O vs 小
            I/O）下，正常延迟的分布形态完全不同。一个实用的慢盘检测系统需要按负载类型分桶统计，而不是把所有
            I/O 延迟混在一起比较。
            
            

## 九、存储混沌实验设计方法论

            

### 9.1 实验设计三要素

            

一个合格的混沌实验需要明确三个要素：假设（Hypothesis）、变量（Variable）和爆炸半径（Blast
            Radius）。
            

**假设**描述的是”我们期望系统在故障注入后表现出什么行为”。假设必须是可证伪的（Falsifiable），不能是”系统应该正常工作”这种模糊表述。好的假设示例：
            
            
- “当一个 TiKV 节点的磁盘延迟增加 200ms 时，TiDB 的 P99
            查询延迟不超过 500ms，且所有写入最终成功”
            
- “当 Ceph OSD 的数据盘空间超过 95% 时，新的写入请求在 10
            秒内返回 ENOSPC 错误，而不是无限等待”
            
- “当 etcd 的 WAL 磁盘发生 10% 的写 I/O 错误时，etcd
            集群在 30 秒内完成 leader
            切换，客户端感知到的不可用时间不超过 5 秒”
            
            

**变量**分为自变量（注入的故障）和因变量（观察的指标）。每次实验只改变一个自变量，同时记录多个因变量：
            
```
自变量（故障注入参数）：
  - 故障类型：延迟 / 错误 / 数据损坏
  - 故障强度：延迟 50ms / 100ms / 200ms / 500ms
  - 故障范围：单盘 / 单节点 / 多节点
  - 故障持续时间：1min / 5min / 30min
  - 故障模式：持续 / 间歇

因变量（观测指标）：
  - 延迟：P50 / P99 / P999
  - 吞吐：QPS / 带宽
  - 错误率：写入失败率 / 读取失败率
  - 一致性：数据校验通过率
  - 恢复时间：从故障注入到指标恢复正常的时间
```

            

**爆炸半径**是故障影响的范围。存储混沌实验的爆炸半径控制尤其重要，因为存储故障可能导致不可逆的数据丢失。建议按以下顺序逐步扩大爆炸半径：
            
```
第 1 阶段：开发/测试环境，无真实用户流量
    └── 验证故障注入工具本身是否按预期工作
第 2 阶段：预发布环境，模拟流量
    └── 验证系统的故障处理逻辑是否正确
第 3 阶段：生产环境，灰度流量（
```
experiment:
  id: "CHAOS-STORAGE-2025-042"
  name: "TiKV 单节点慢盘对 TiDB P99 延迟的影响"
  date: "2025-10-01"
  owner: "storage-team"

hypothesis:
  statement: >
    当一个 TiKV 节点的磁盘写延迟增加 200ms 时，
    TiDB 的 P99 查询延迟不超过 500ms，
    且所有已确认的写入事务不丢失。
  pass_criteria:
    - "tidb_p99_latency_ms 
            
            

## 十、自动化混沌测试集成

            

### 10.1 CI/CD 流水线集成

            

混沌测试应该像单元测试一样，成为 CI/CD
            流水线的一部分。但与单元测试不同，混沌测试需要完整的集群环境和足够的运行时间。实际的集成策略通常分两级：
            
            
- **快速混沌测试**（每次 PR
            合并后执行）：在临时集群中运行 5-10
            个核心混沌场景，每个场景持续 2-3 分钟，总耗时 30-60
            分钟。
            
- **完整混沌测试**（每周定期执行）：在长期运行的测试集群中运行完整的混沌测试矩阵，包括多故障组合和长持续时间场景，总耗时
            4-8 小时。
            
            

以下是一个基于 GitHub Actions 的混沌测试集成示例：
            
```
# .github/workflows/chaos-test.yml
name: Storage Chaos Tests

on:
  schedule:
    - cron: "0 2 * * 1"   # 每周一凌晨 2 点
  workflow_dispatch:        # 手动触发

jobs:
  setup-cluster:
    runs-on: self-hosted
    outputs:
      cluster-name: ${{ steps.create.outputs.name }}
    steps:
      - name: 创建测试集群
        id: create
        run: |
          CLUSTER_NAME="chaos-test-$(date +%Y%m%d%H%M)"
          kind create cluster --name "$CLUSTER_NAME" --config kind-config.yaml
          echo "name=$CLUSTER_NAME" >> "$GITHUB_OUTPUT"

      - name: 部署存储系统
        run: |
          helm install tidb-operator pingcap/tidb-operator -n tidb-admin --create-namespace
          kubectl apply -f tidb-cluster.yaml
          kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=tikv \
            --timeout=600s -n tidb-cluster

      - name: 部署 Chaos Mesh
        run: |
          helm install chaos-mesh chaos-mesh/chaos-mesh -n chaos-mesh --create-namespace
          kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=controller-manager \
            --timeout=300s -n chaos-mesh

  run-chaos-tests:
    needs: setup-cluster
    runs-on: self-hosted
    strategy:
      fail-fast: false
      matrix:
        scenario:
          - name: "disk-latency-50ms"
            manifest: "chaos/io-latency-50ms.yaml"
            duration: 300
          - name: "disk-latency-200ms"
            manifest: "chaos/io-latency-200ms.yaml"
            duration: 300
          - name: "disk-io-error"
            manifest: "chaos/io-error-5pct.yaml"
            duration: 180
          - name: "disk-fill-90pct"
            manifest: "chaos/disk-fill-90.yaml"
            duration: 300
    steps:
      - uses: actions/checkout@v4

      - name: 采集基线数据
        run: |
          ./scripts/collect-baseline.sh \
            --duration 120 \
            --output "baseline-${{ matrix.scenario.name }}.json"

      - name: 执行混沌实验
        run: |
          kubectl apply -f "${{ matrix.scenario.manifest }}"
          sleep "${{ matrix.scenario.duration }}"

      - name: 验证稳态假设
        run: |
          ./scripts/verify-steady-state.sh \
            --baseline "baseline-${{ matrix.scenario.name }}.json" \
            --scenario "${{ matrix.scenario.name }}"

      - name: 清理混沌实验
        if: always()
        run: kubectl delete -f "${{ matrix.scenario.manifest }}" --ignore-not-found

      - name: 等待恢复并验证
        run: |
          sleep 120  # 等待系统恢复
          ./scripts/verify-recovery.sh

  cleanup:
    needs: [setup-cluster, run-chaos-tests]
    if: always()
    runs-on: self-hosted
    steps:
      - name: 删除测试集群
        run: kind delete cluster --name "${{ needs.setup-cluster.outputs.cluster-name }}"
```

            

### 10.2 混沌测试结果判定

            

混沌测试的结果判定不是简单的”通过/失败”。需要区分三种结果：
            
```
┌──────────────────────────────────────────────────────────┐
│                 混沌测试结果分类                           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  结果 1：假设成立（PASS）                                  │
│    系统在故障注入后的行为符合预期                            │
│    → 增强了对系统可靠性的信心                               │
│    → 继续扩大爆炸半径或增加故障强度                          │
│                                                          │
│  结果 2：假设不成立（FAIL）                                 │
│    系统行为不符合预期，但没有造成数据丢失                     │
│    → 记录问题，创建修复工单                                 │
│    → 修复后重新执行实验                                     │
│                                                          │
│  结果 3：实验失控（ABORT）                                  │
│    故障注入导致了非预期的级联故障或数据丢失                    │
│    → 立即执行回滚                                          │
│    → 事后复盘，改进爆炸半径控制                              │
│    → 降低故障强度后重试                                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

            

### 10.3 混沌测试指标采集

            

自动化混沌测试的关键基础设施是指标采集和对比。以下是一个用
            Prometheus 查询采集混沌实验前后指标的脚本框架：
            
```
#!/bin/bash
# collect-and-compare.sh
# 混沌实验前后指标采集与对比

set -euo pipefail

PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus:9090}"
BASELINE_DURATION="${BASELINE_DURATION:-300}"  # 基线采集时长（秒）

query_prometheus() {
    local query="$1"
    local time="$2"
    curl -s "${PROMETHEUS_URL}/api/v1/query" \
        --data-urlencode "query=${query}" \
        --data-urlencode "time=${time}" | \
        python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['result'][0]['value'][1] if d['data']['result'] else 'N/A')"
}

echo "=== 基线采集（故障注入前） ==="
BASELINE_END=$(date +%s)
BASELINE_START=$((BASELINE_END - BASELINE_DURATION))

BASELINE_P99=$(query_prometheus \
    'histogram_quantile(0.99, sum(rate(tikv_grpc_msg_duration_seconds_bucket{type="kv_prewrite"}[5m])) by (le))' \
    "$BASELINE_END")
BASELINE_QPS=$(query_prometheus \
    'sum(rate(tikv_grpc_msg_duration_seconds_count{type="kv_prewrite"}[5m]))' \
    "$BASELINE_END")

echo "  P99 延迟: ${BASELINE_P99}s"
echo "  QPS: ${BASELINE_QPS}"

echo ""
echo "=== 等待故障注入期结束 ==="
echo "  （由外部脚本控制故障注入）"

echo ""
echo "=== 故障期间指标 ==="
CHAOS_END=$(date +%s)
CHAOS_P99=$(query_prometheus \
    'histogram_quantile(0.99, sum(rate(tikv_grpc_msg_duration_seconds_bucket{type="kv_prewrite"}[5m])) by (le))' \
    "$CHAOS_END")
CHAOS_QPS=$(query_prometheus \
    'sum(rate(tikv_grpc_msg_duration_seconds_count{type="kv_prewrite"}[5m]))' \
    "$CHAOS_END")

echo "  P99 延迟: ${CHAOS_P99}s"
echo "  QPS: ${CHAOS_QPS}"

echo ""
echo "=== 对比 ==="
python3 -c "
baseline_p99 = float('${BASELINE_P99}')
chaos_p99 = float('${CHAOS_P99}')
baseline_qps = float('${BASELINE_QPS}')
chaos_qps = float('${CHAOS_QPS}')

p99_ratio = chaos_p99 / baseline_p99 if baseline_p99 > 0 else float('inf')
qps_ratio = chaos_qps / baseline_qps if baseline_qps > 0 else 0

print(f'  P99 延迟变化: {p99_ratio:.2f}x (基线 {baseline_p99*1000:.1f}ms -> 故障期 {chaos_p99*1000:.1f}ms)')
print(f'  QPS 变化: {qps_ratio:.2f}x (基线 {baseline_qps:.0f} -> 故障期 {chaos_qps:.0f})')
print()

if p99_ratio > 10:
    print('  [FAIL] P99 延迟上升超过 10 倍')
elif p99_ratio > 5:
    print('  [WARN] P99 延迟上升超过 5 倍')
else:
    print('  [PASS] P99 延迟变化在可接受范围内')

if qps_ratio 
            

### 10.4 长期实践建议

            

存储混沌工程不是一次性的活动，而是持续的实践。几个长期运行的建议：
            

第一，维护混沌测试矩阵。把所有已知的故障场景、注入参数、预期行为整理成一张矩阵表，定期执行，确保每次代码变更后系统的容错能力没有退化。
            

第二，从故障中学习。每次生产环境的存储故障都应该被转化为一个新的混沌测试场景。如果某次生产故障没有被现有的混沌测试覆盖，说明测试矩阵有盲区。
            

第三，关注恢复时间。系统能否容忍故障很重要，但从故障中恢复需要多长时间同样重要。混沌实验不能只关注”故障期间系统是否正常”，还需要关注”故障消除后系统需要多久才能回到稳态”。
            

第四，避免”混沌疲劳”。如果混沌测试的结果总是
            PASS，团队会逐渐失去关注。这时需要提高故障强度、扩大爆炸半径、组合多种故障，持续挑战系统的边界。反过来，如果混沌测试频繁
            FAIL
            但没有人修复问题，混沌工程就退化成了”定期证明系统不行”的仪式。
            
            

## 十一、参考文献

            
            
- 

Basiri, A., Behnam, N., de Rooij, R., et al. “Chaos
            Engineering.” IEEE Software, 33(3), 2016. Netflix
            混沌工程方法论的奠基论文。
            
- 

Pillai, T. S., Chidambaram, V., Alagappan, R., et
            al. “All File Systems Are Not Created Equal: On the
            Complexity of Crafting Crash-Consistent Applications.” OSDI
            2014. ALICE 项目，系统性测试了 11
            个应用程序的崩溃一致性问题。
            
- 

Pinheiro, E., Weber, W. D., Barroso, L. A. “Failure
            Trends in a Large Disk Drive Population.” FAST 2007. Google
            对超过 10 万块磁盘的故障率统计分析。
            
- 

Schroeder, B., Gibson, G. A. “Disk Failures in the
            Real World: What Does an MTTF of 1,000,000 Hours Mean to
            You?” FAST 2007. 磁盘实际故障率与厂商标称 MTTF
            的差异分析。
            
- 

Chaos Mesh 官方文档. https://chaos-mesh.org/docs/ . IOChaos
            的设计与使用。
            
- 

LitmusChaos 官方文档. https://docs.litmuschaos.io/ .
            ChaosEngine、ChaosExperiment 和 Probe 机制。
            
- 

Linux 内核文档: Device Mapper - dm-flakey. https://docs.kernel.org/admin-guide/device-mapper/dm-flakey.html
            . dm-flakey 的参数和行为定义。
            
- 

Linux 内核文档: Device Mapper - dm-delay. https://docs.kernel.org/admin-guide/device-mapper/delay.html
            . dm-delay 的参数格式。
            
- 

Backblaze Hard Drive Stats. https://www.backblaze.com/cloud-storage/resources/hard-drive-test-data
            . 持续更新的硬盘故障率统计数据。
            
- 

Gunawi, H. S., Hao, M., Suminto, R. O., et al. “Why
            Does the Cloud Stop Computing? Lessons from Hundreds of
            Service Outages.” SoCC 2016.
            云计算故障原因分类与分析。
            
            
            

**上一篇**: 数据生命周期管理
            **下一篇**: 存储基准测试方法论
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-07 · storage
                    

### 【存储工程】存储故障模式

                    

全面分析存储系统的静默故障——比特翻转、扇区错误、丢失写、撕裂写、固件 bug 与灰色故障，以及 CERN/Google 的大规模数据损坏研究
                

                
                    

2026-06-18 · architecture / observability
                    

### 【可观测性工程】混沌工程：ChaosBlade、Chaos Mesh 与可观测性闭环

                    

混沌工程验证可观测性与告警是否发现故障：稳态假设、ChaosBlade/Chaos Mesh/LitmusChaos 对比、爆炸半径控制、SLO 判定与 Reliability Backlog 闭环。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。