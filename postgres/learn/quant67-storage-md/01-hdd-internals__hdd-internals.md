# 【存储工程】HDD 机械硬盘：旋转时代的工程遗产

来源: https://quant67.com/post/storage/01-hdd-internals/hdd-internals.html
日期: 2025-08-10 |

---

即使在 NVMe SSD 主导高性能存储的今天，HDD
            仍然是全球数据存储的主力。原因很简单：每 GB 的成本。一块
            18TB 的企业级 HDD 大约 300 美元（~0.017
            $/GB），而同容量的企业级 SSD 要 2000 美元以上（~0.11
            $/GB）。对于冷数据、归档、备份、视频监控等场景，HDD
            仍然是唯一经济可行的选择。
            

本文不是 HDD 科普——而是从工程视角分析 HDD
            的物理结构如何决定了它的性能特征，以及这些特征如何影响了上层软件（文件系统、数据库、分布式存储）的设计决策。
            

## 一、HDD 物理结构

            

### 1.1 盘片与磁头

            
```
# HDD 的核心物理组件：

# 1. 盘片（Platter）
# - 铝合金或玻璃基板，双面涂覆磁性材料
# - 直径通常 3.5 英寸（企业/桌面）或 2.5 英寸（笔记本）
# - 现代企业级 HDD 通常有 8-10 个盘片
# - 每个盘片双面记录数据

# 2. 磁头（Head）
# - 每个盘面一个读写磁头
# - 磁头悬浮在盘片表面 ~10nm 处（飞行高度）
# - 写磁头：利用电磁感应改变磁性方向
# - 读磁头：利用巨磁阻效应（GMR）或隧道磁阻效应（TMR）

# 3. 主轴电机（Spindle Motor）
# - 驱动盘片旋转
# - 常见转速：5400 / 7200 / 10000 / 15000 RPM
# - 转速越高，旋转延迟越低，但功耗和噪音越高

# 4. 音圈电机（Voice Coil Motor / Actuator）
# - 驱动磁头臂在盘片上径向移动
# - 寻道时间取决于音圈电机的加速/减速能力
```

            

### 1.2
            数据组织：磁道、扇区与柱面

            
```
盘片俯视图（简化）：

         ┌─────── 外圈磁道（Track 0）
         │
    ┌────┼────────────────────┐
    │    │    ┌──────────┐    │
    │    │    │          │    │  ← 内圈磁道
    │    │    │  主轴    │    │
    │    │    │          │    │
    │    │    └──────────┘    │
    │    │                    │
    │    └─── 磁道（同心圆）   │
    │                         │
    └─────────────────────────┘

侧视图（多盘片）：

    磁头 0 ──→ ═══════════ 盘面 0
                ═══════════ 盘面 1 ←── 磁头 1
    磁头 2 ──→ ═══════════ 盘面 2
                ═══════════ 盘面 3 ←── 磁头 3
    磁头 4 ──→ ═══════════ 盘面 4
                ═══════════ 盘面 5 ←── 磁头 5

    柱面（Cylinder）= 所有盘面上同一半径的磁道集合
    # 同一柱面的数据可以不移动磁头就读取
    # 这就是为什么传统 CHS 寻址使用 Cylinder-Head-Sector
```

            

### 1.3 扇区与逻辑块

            
```
# 扇区（Sector）是 HDD 的最小物理读写单位

# 传统扇区大小：512 字节
# 现代 Advanced Format：4096 字节（4K 原生扇区）

# 512e（512 Emulation）：
# 物理扇区 4KB，但固件模拟 512B 扇区给 OS
# 问题：如果写入不对齐到 4KB 边界
#       HDD 需要 读-改-写（Read-Modify-Write）
#       性能下降严重

# 检查磁盘的扇区大小：
cat /sys/block/sda/queue/physical_block_size
# 4096  （物理扇区大小）

cat /sys/block/sda/queue/logical_block_size
# 512   （逻辑扇区大小，512e）

# 确保分区对齐到物理扇区：
# fdisk / parted 默认已经对齐
# 手动检查：
parted /dev/sda align-check optimal 1
# 1 aligned
```

            

### 1.4 ZBR（Zone Bit
            Recording）

            
```
# 传统 HDD 每个磁道的扇区数相同
# 问题：外圈磁道周长更长，存储密度被浪费

# ZBR 解决方案：
# 将磁道分成多个区域（Zone）
# 外圈区域每磁道扇区数更多

# 外圈（Zone 0）：每磁道 ~1000 个扇区
# 中圈（Zone 5）：每磁道 ~800 个扇区
# 内圈（Zone 10）：每磁道 ~600 个扇区

# 工程影响：
# 外圈的顺序读写速度比内圈快 ~40-50%
# 这就是为什么 HDD "前半部分"比"后半部分"快
# 分区时把性能敏感的数据放在外圈（低 LBA 地址）

# 用 hdparm 验证：
hdparm -t /dev/sda  # 测试顺序读取速率
# 在外圈（开头）：~200 MB/s
# 在内圈（末尾）：~120 MB/s

# 实际测量不同位置的吞吐：
dd if=/dev/sda of=/dev/null bs=1M count=1024 skip=0    # 外圈
dd if=/dev/sda of=/dev/null bs=1M count=1024 skip=10000 # 内圈
```

            

## 二、HDD 性能模型

            

### 2.1 三大延迟组成

            

一次随机读取的延迟由三部分组成：
            
```
# 总延迟 = 寻道时间 + 旋转延迟 + 传输时间

# 1. 寻道时间（Seek Time）
# 磁头从当前磁道移动到目标磁道的时间
# 取决于磁头移动的物理距离
#
# 典型值（7200 RPM 企业级）：
# - 全行程寻道（最远）：  ~15 ms
# - 平均寻道（随机）：    ~8 ms
# - 相邻磁道（短寻道）：  ~0.5 ms
# - 零寻道（同磁道）：    0 ms

# 2. 旋转延迟（Rotational Latency）
# 目标扇区旋转到磁头下方的等待时间
# 平均值 = 旋转一圈时间 / 2
#
# 不同转速的平均旋转延迟：
#  5400 RPM: 60/5400/2 = 5.56 ms
#  7200 RPM: 60/7200/2 = 4.17 ms
# 10000 RPM: 60/10000/2 = 3.00 ms
# 15000 RPM: 60/15000/2 = 2.00 ms

# 3. 传输时间（Transfer Time）
# 数据从盘片传输到磁盘缓冲区的时间
# 通常远小于前两者（
            

### 2.2 顺序 vs
            随机的性能差异

            
```
# 顺序 I/O：磁头不需要移动（或只移动很短距离）
# 随机 I/O：每次读写都要寻道 + 旋转等待

# 7200 RPM HDD 的典型性能：
#
# | I/O 模式      | 延迟      | IOPS   | 吞吐      |
# |--------------|----------|--------|----------|
# | 顺序读（外圈） | N/A      | N/A    | ~200 MB/s |
# | 顺序读（内圈） | N/A      | N/A    | ~120 MB/s |
# | 顺序写        | N/A      | N/A    | ~180 MB/s |
# | 随机读 4KB    | ~12 ms   | ~80    | ~0.3 MB/s |
# | 随机写 4KB    | ~12 ms   | ~80    | ~0.3 MB/s |
# | 随机读 64KB   | ~12 ms   | ~80    | ~5 MB/s   |

# 关键观察：
# 1. 顺序 vs 随机的吞吐差异可达 500 倍以上
# 2. 随机 I/O 性能几乎不受 I/O 大小影响（延迟主导）
# 3. 顺序 I/O 性能随 I/O 大小线性增长

# 这解释了为什么 HDD 时代的软件设计如此重视：
# - 日志结构写入（WAL、LSM-Tree）
# - 大块顺序写入（批量提交）
# - 电梯算法 I/O 调度（减少寻道距离）
# - 预读取（readahead）
```

            

### 2.3 队列深度与 NCQ

            
```
# NCQ（Native Command Queuing）允许 HDD 重排序 I/O 请求
# 最小化磁头移动距离——类似电梯调度

# 没有 NCQ：按请求到达顺序执行
# 请求序列：磁道 100 → 500 → 200 → 400 → 300
# 磁头移动：100→500→200→400→300 = 总移动 1100 磁道

# 有 NCQ：重排序为最近优先
# 优化序列：100 → 200 → 300 → 400 → 500
# 磁头移动：100→200→300→400→500 = 总移动 400 磁道

# NCQ 的效果取决于队列深度：
# 队列深度 1：无法优化（只有一个请求）
# 队列深度 4：IOPS 提升 ~20-40%
# 队列深度 32：IOPS 提升 ~50-80%（HDD 上限通常是 32）

# 检查 NCQ 支持：
hdparm -I /dev/sda | grep -i "queue"
# Queue depth: 32

# 检查当前队列深度设置：
cat /sys/block/sda/device/queue_depth
# 32

# 调整队列深度（通常不需要）：
echo 32 > /sys/block/sda/device/queue_depth
```

            

## 三、CMR vs SMR

            

### 3.1
            CMR（Conventional Magnetic Recording）

            
```
# CMR 是传统的磁记录方式
# 每个磁道独立——写入一个磁道不影响相邻磁道

# 磁道布局（简化）：
#  ┌──────┐ ┌──────┐ ┌──────┐
#  │Track1│ │Track2│ │Track3│  ← 磁道之间有保护间隙
#  └──────┘ └──────┘ └──────┘

# 优点：
# - 任意位置随机写入，性能一致
# - 不需要特殊的写入策略
# - 与所有操作系统和文件系统完全兼容

# 缺点：
# - 面密度受限于磁道宽度和保护间隙
# - 容量增长遇到瓶颈
```

            

### 3.2 SMR（Shingled
            Magnetic Recording）

            
```
# SMR 让磁道部分重叠（像屋顶瓦片 shingled）
# 写磁头比读磁头宽——写入时覆盖相邻磁道的一部分

# 磁道布局（简化）：
#  ┌────────────┐
#  │  Track 1    │
#  └──┬─────────┤
#     │ Track 2  │       ← 磁道部分重叠
#     └──┬──────┤
#        │Track3│
#        └──────┘

# 优点：面密度提升 ~20-25%（同样盘片存储更多数据）
# 缺点：写入限制——修改一个磁道会破坏后面重叠的磁道

# SMR 的三种管理模式：

# 1. DM-SMR（Device Managed）
# 固件自动处理 SMR 复杂性
# 对 OS 透明，但随机写入性能可能骤降
# 代表：WD Red（某些型号引发争议）
# 风险：RAID 重建时性能崩塌

# 2. HM-SMR（Host Managed）
# OS 必须按照 Zone 规则写入（顺序写入）
# 需要专门的文件系统支持（如 f2fs、btrfs zoned）
# 性能可预测，但软件适配成本高

# 3. HA-SMR（Host Aware）
# 混合模式——既接受随机写入也优化顺序写入
# OS 可以选择是否遵循 Zone 规则
```

            

### 3.3 SMR 的工程影响

            
```
# SMR 硬盘识别：
# 问题：部分厂商不在规格表中明确标注 SMR

# 方法 1：检查 Zoned Block Device 支持
cat /sys/block/sda/queue/zoned
# none      → CMR
# host-managed → HM-SMR
# host-aware   → HA-SMR
# （DM-SMR 可能显示 none——固件隐藏了）

# 方法 2：查看硬盘型号对照表
hdparm -I /dev/sda | grep "Model"
# 然后查厂商文档确认

# SMR 的生产建议：
# ✓ 适合：冷存储、归档、视频监控（顺序写入为主）
# ✓ 适合：对象存储后端（大文件顺序写入）
# ✗ 避免：RAID 5/6（重建时随机写入性能崩塌）
# ✗ 避免：数据库（随机写入密集）
# ✗ 避免：NAS 共享存储（混合读写负载）

# WD Red SMR 事件的教训：
# 2020 年 WD 在 NAS 硬盘中使用 DM-SMR 但未明确标注
# 用户在 RAID 重建时发现性能骤降
# 教训：采购 HDD 时必须确认是 CMR 还是 SMR
```

            

## 四、HDD 健康监控

            

### 4.1 SMART 监控

            
```
# SMART（Self-Monitoring, Analysis, and Reporting Technology）
# 硬盘内置的健康监控系统

# 安装 smartmontools
apt-get install smartmontools

# 查看完整 SMART 信息
smartctl -a /dev/sda

# 关键 SMART 属性：

# ID  属性名                     阈值    说明
# 1   Raw_Read_Error_Rate        N/A     读取错误率（厂商算法不同）
# 5   Reallocated_Sector_Count   ★★★★★  重新分配扇区数
# 7   Seek_Error_Rate            ★★★    寻道错误率
# 9   Power_On_Hours             N/A     通电时间
# 10  Spin_Retry_Count           ★★★    主轴启动重试次数
# 187 Reported_Uncorrectable     ★★★★★  不可纠正的错误数
# 188 Command_Timeout            ★★★★   命令超时次数
# 197 Current_Pending_Sector     ★★★★★  当前待重映射扇区数
# 198 Offline_Uncorrectable      ★★★★★  离线不可纠正扇区数
# 199 UDMA_CRC_Error_Count       ★★★    SATA 线缆错误

# 最关键的三个属性（任何一个异常都应该立即更换）：
# 5   Reallocated_Sector_Count > 0  → 磁盘有坏扇区
# 197 Current_Pending_Sector > 0    → 有等待重映射的扇区
# 198 Offline_Uncorrectable > 0     → 有无法修复的扇区

# 开启 SMART 自动监控
smartctl -s on /dev/sda

# 运行短测试（约 2 分钟）
smartctl -t short /dev/sda

# 运行长测试（可能需要数小时）
smartctl -t long /dev/sda

# 查看测试结果
smartctl -l selftest /dev/sda
```

            

### 4.2 SMART 监控脚本

            
```
#!/bin/bash
# hdd-health-check.sh
# HDD 健康检查脚本

set -euo pipefail

ALERT_EMAIL="ops@example.com"
CRITICAL_ATTRS="5 187 197 198"

for disk in /dev/sd[a-z]; do
    [ -b "$disk" ] || continue

    echo "=== 检查 $disk ==="

    # 获取 SMART 健康状态
    health=$(smartctl -H "$disk" 2>/dev/null | grep "SMART overall" | awk '{print $NF}')

    if [ "$health" != "PASSED" ]; then
        echo "CRITICAL: $disk SMART health = $health"
        # 发送告警
        continue
    fi

    # 检查关键属性
    for attr_id in $CRITICAL_ATTRS; do
        raw_value=$(smartctl -A "$disk" 2>/dev/null | \
            awk -v id="$attr_id" '$1 == id {print $10}')

        if [ -n "$raw_value" ] && [ "$raw_value" != "0" ]; then
            attr_name=$(smartctl -A "$disk" 2>/dev/null | \
                awk -v id="$attr_id" '$1 == id {print $2}')
            echo "WARNING: $disk $attr_name (ID=$attr_id) = $raw_value"
        fi
    done

    # 检查通电时间
    hours=$(smartctl -A "$disk" 2>/dev/null | \
        awk '$1 == 9 {print $10}')
    if [ -n "$hours" ]; then
        years=$(echo "scale=1; $hours / 8760" | bc)
        echo "Info: $disk 通电 $hours 小时（$years 年）"

        # 企业级 HDD 通常保修 5 年
        if [ "$hours" -gt 35000 ]; then
            echo "WARNING: $disk 已超过 4 年通电时间"
        fi
    fi

    echo ""
done
```

            

### 4.3 磁盘性能基准测试

            
```
# 使用 hdparm 快速测试
# 测试缓冲区读取速度（不经过磁盘，测试接口）
hdparm -T /dev/sda
# Timing cached reads: 12000 MB in 2.00 seconds = 6000 MB/sec

# 测试磁盘顺序读取速度
hdparm -t /dev/sda
# Timing buffered disk reads: 400 MB in 3.01 seconds = 132.89 MB/sec

# 使用 dd 测试顺序写入
dd if=/dev/zero of=/tmp/test bs=1M count=1024 conv=fdatasync
# 1073741824 bytes transferred in 6.2 seconds (173 MB/s)

# 使用 fio 进行更精确的测试

# 顺序读取
fio --name=seq-read \
    --ioengine=libaio \
    --direct=1 \
    --bs=1M \
    --rw=read \
    --size=1G \
    --numjobs=1 \
    --filename=/dev/sda \
    --readonly

# 随机读取 4KB
fio --name=rand-read \
    --ioengine=libaio \
    --direct=1 \
    --bs=4k \
    --rw=randread \
    --size=1G \
    --numjobs=1 \
    --iodepth=32 \
    --filename=/dev/sda \
    --readonly \
    --runtime=60

# 混合随机读写（70% 读 30% 写）
fio --name=mixed \
    --ioengine=libaio \
    --direct=1 \
    --bs=4k \
    --rw=randrw \
    --rwmixread=70 \
    --size=1G \
    --numjobs=4 \
    --iodepth=32 \
    --filename=/dev/sda \
    --runtime=60
```

            

## 五、I/O 调度与优化

            

### 5.1 I/O 调度器对 HDD
            的影响

            
```
# Linux I/O 调度器对 HDD 性能影响显著
# 因为 HDD 的寻道开销大，调度器的排序效果明显

# 查看当前 I/O 调度器
cat /sys/block/sda/queue/scheduler
# [mq-deadline] none

# 可选调度器：
# mq-deadline — 默认，适合 HDD，按截止时间+方向排序
# bfq         — 适合桌面/交互场景，按进程公平分配
# kyber       — 适合 SSD/NVMe，低延迟优先
# none        — 无调度，适合 NVMe（设备内部排序）

# 对于 HDD，推荐 mq-deadline 或 bfq
echo mq-deadline > /sys/block/sda/queue/scheduler

# mq-deadline 参数调优：
# 读写请求的超时时间
cat /sys/block/sda/queue/iosched/read_expire
# 500  (ms)
cat /sys/block/sda/queue/iosched/write_expire
# 5000 (ms)

# 批处理前的请求数——更大的值有更好的合并效果
cat /sys/block/sda/queue/iosched/fifo_batch
# 16

# 写入饥饿限制——每 writes_starved 次读服务后必须服务一次写
cat /sys/block/sda/queue/iosched/writes_starved
# 2
```

            

### 5.2 预读取（Readahead）

            
```
# 预读取是 HDD 上最有效的优化之一
# 原理：顺序读取检测后，提前读取后续数据到 Page Cache

# 查看当前预读取设置（单位：512 字节扇区）
blockdev --getra /dev/sda
# 256  (= 128KB)

# 设置更大的预读取值（适合顺序读取密集场景）
blockdev --setra 1024 /dev/sda  # 512KB

# 更激进的设置（适合流式读取场景）
blockdev --setra 4096 /dev/sda  # 2MB

# 对于数据库场景，可能需要较小的预读取
# 因为数据库通常使用 Direct I/O 或自己管理缓存
blockdev --setra 256 /dev/sda   # 128KB

# 内核的预读取算法：
# 1. 检测到连续读取模式
# 2. 逐步增加预读取窗口大小（ramp up）
# 3. 到达最大值后保持（steady state）
# 4. 检测到随机读取后关闭预读取

# 查看预读取统计
cat /proc/sys/vm/page-cluster
# 3  (= 2^3 = 8 个页面 = 32KB，swap 预读取)
```

            

### 5.3 写入缓存

            
```
# HDD 内部有 DRAM 缓存（通常 64-256MB）
# 写入缓存让写操作立即返回，数据稍后写入盘片

# 检查写入缓存状态
hdparm -W /dev/sda
# write-caching =  1 (on)

# 关闭写入缓存（数据安全优先）
hdparm -W 0 /dev/sda
# 性能下降 ~2-5x
# 但保证 fsync 后数据确实在盘片上

# 开启写入缓存（性能优先）
hdparm -W 1 /dev/sda
# 风险：突然断电可能丢失缓存中的数据
# 缓解：使用 UPS + 有电容的 RAID 卡

# 生产建议：
# - 有 UPS 和 BBU 的企业环境：开启写入缓存
# - 没有电池保护的环境：关闭写入缓存
# - 数据库服务器：取决于 RAID 卡是否有 BBU
#   有 BBU：RAID 卡的写入缓存代替磁盘缓存
#   没有 BBU：关闭磁盘写入缓存，依赖 fsync
```

            

## 六、HDD
            在现代存储架构中的位置

            

### 6.1 适用场景分析

            
```
# HDD 仍然有不可替代的场景：

# 1. 冷数据存储（Cold Storage）
# - 数据访问频率 
            

### 6.2 HDD + SSD 混合架构

            
```
# 在很多场景下，HDD + SSD 混合架构是最经济的方案

# 模式 1：SSD 作为缓存（dm-cache / bcache）
#
# ┌─────────────┐
# │   应用       │
# └──────┬──────┘
#        │
# ┌──────┴──────┐
# │  dm-cache   │  ← 缓存层
# ├─────┬───────┤
# │ SSD │  HDD  │
# │缓存 │  数据  │
# └─────┘───────┘
#
# 设置 dm-cache：
# 1. 创建缓存数据卷
lvcreate -L 100G -n cache_data vg0 /dev/ssd
# 2. 创建缓存元数据卷
lvcreate -L 1G -n cache_meta vg0 /dev/ssd
# 3. 创建缓存池
lvconvert --type cache-pool --poolmetadata vg0/cache_meta vg0/cache_data
# 4. 将缓存池附加到 HDD 逻辑卷
lvconvert --type cache --cachepool vg0/cache_data vg0/hdd_lv

# 模式 2：bcache
# 类似 dm-cache，但更专注于块设备缓存
make-bcache -B /dev/sda -C /dev/nvme0n1p1
# -B: backing device (HDD)
# -C: cache device (SSD)

# 设置缓存策略
echo writeback > /sys/block/bcache0/bcache/cache_mode
# writeback: 写入先到 SSD 缓存，然后异步写回 HDD
# writethrough: 写入同时到 SSD 和 HDD（更安全）
# writearound: 写入直接到 HDD，只有读取命中时缓存

# 模式 3：应用级分层
# 数据库：
#   WAL/redo log → SSD（小量随机写入，延迟敏感）
#   数据文件   → HDD（大量顺序读写）
#   临时表空间 → SSD（临时排序、哈希连接）
```

            

### 6.3 HDD 容量趋势

            
            
            
            技术
            容量
            时间
            说明
            
            
            
            
            PMR/CMR
            20TB
            现在
            传统磁记录
            
            
            SMR
            24TB
            现在
            叠瓦式，顺序写入
            
            
            HAMR
            30TB+
            2024+
            热辅助磁记录
            
            
            MAMR
            28TB+
            2024+
            微波辅助磁记录
            
            
            
            
```
# HAMR（Heat-Assisted Magnetic Recording）
# 用激光加热写入区域，减小磁性颗粒尺寸
# 提高面密度，单盘容量预计达到 50TB+

# MAMR（Microwave-Assisted Magnetic Recording）
# 用微波振荡器辅助写入
# WD 的技术路线

# 对工程师的影响：
# 1. 单盘容量增大 → RAID 重建时间更长 → RAID 5 风险更高
# 2. 需要考虑更高的 RAID 冗余级别（RAID 6/RAID-Z2）
# 3. 或使用纠删码替代传统 RAID
```

            

## 七、故障分析与数据恢复

            

### 7.1 常见故障类型

            
```
# 1. 坏扇区（Bad Sectors）
# 症状：SMART 197/198 属性非零
# 影响：读取该扇区返回 I/O 错误
# 处理：
#   - 少量坏扇区：HDD 自动重映射（备用扇区）
#   - 大量坏扇区：更换硬盘
#   - 使用 badblocks 扫描：
badblocks -nsv /dev/sda   # 非破坏性读写测试

# 2. 磁头故障（Head Crash）
# 症状：咔嗒声、无法识别
# 原因：磁头触碰盘面
# 处理：需要专业数据恢复（洁净室）

# 3. 电路板故障（PCB Failure）
# 症状：不转、不识别
# 处理：更换同型号 PCB（不一定成功）

# 4. 固件损坏（Firmware Corruption）
# 症状：卡在启动、识别但不可访问
# 处理：专业固件修复工具

# 5. 电机故障（Motor Failure）
# 症状：不转、嗡嗡声
# 处理：专业数据恢复
```

            

### 7.2 URE 与 RAID 重建风险

            
```
# URE（Unrecoverable Read Error）
# 硬盘在读取时遇到无法纠正的错误

# 企业级 HDD URE 率：1 in 10^15 bits（~125TB 读取一次错误）
# 消费级 HDD URE 率：1 in 10^14 bits（~12.5TB 读取一次错误）

# RAID 重建时的 URE 风险计算：
# 假设 RAID 5，6 块 18TB 企业级 HDD
# 一块硬盘故障，开始重建
# 需要读取 5 × 18TB = 90TB 数据

# 在 90TB 读取中遇到 URE 的概率：
# P = 1 - (1 - 90TB/125TB) ≈ 72%
# 也就是说 RAID 5 重建有 72% 的概率因为 URE 失败！

# 这就是为什么大容量 HDD 不应该使用 RAID 5：
# RAID 6 或 RAID-Z2 至少允许两块盘同时故障
# 或者使用纠删码（如 Ceph 的 k+m 纠删码）

# 消费级 HDD 更糟：
# P = 1 - (1 - 90TB/12.5TB) ≈ 100%（几乎必然失败）
# 消费级 HDD 绝对不应该用于大容量 RAID
```

            

### 7.3 硬盘采购与选型

            
```
# 企业级 vs 消费级 HDD 的关键差异：

# | 属性           | 企业级          | 消费级         |
# |---------------|----------------|---------------|
# | URE 率         | 10^15          | 10^14         |
# | MTBF          | 2,000,000 小时  | 750,000 小时   |
# | 工作负载       | 550 TB/年       | 55 TB/年       |
# | 转速           | 7200 RPM       | 5400-7200 RPM |
# | 保修           | 5 年            | 2-3 年         |
# | 振动保护       | 有             | 无            |
# | 价格（18TB）   | ~$300          | ~$250         |

# 选型指南：
# NAS：企业级 NAS 盘（WD Red Plus/Pro, Seagate IronWolf/Pro）
# 服务器：企业级（WD Ultrastar, Seagate Exos）
# 监控：监控专用（WD Purple, Seagate SkyHawk）
# 桌面/备份：消费级（WD Blue, Seagate Barracuda）
# 冷存储/归档：大容量 SMR 或企业级 CMR

# 关键：确认是 CMR 还是 SMR！
# 尤其在 RAID/ZFS 场景下，SMR 盘可能导致严重的性能问题
```

            

## 八、HDD
            对软件设计的影响

            

### 8.1 文件系统设计

            
```
# HDD 的物理特性深刻影响了文件系统的设计：

# 1. Block Group / Allocation Group
# ext4 的 block group、XFS 的 allocation group
# 将相关数据（inode + data block）放在物理相近的位置
# 减少寻道距离

# 2. 延迟分配（Delayed Allocation）
# 不立即分配物理块，等缓冲区满后批量分配
# 连续分配物理块，提高顺序性

# 3. 预分配（Preallocation）
# fallocate() 一次性预留连续空间
# 避免后续写入时的碎片化
fallocate -l 1G /var/lib/mysql/data.ibd

# 4. 日志模式
# ext4 的 journal 也要考虑日志文件的物理位置
# 日志和数据如果在同一盘，会产生额外的寻道
# 生产建议：日志放在 SSD 上

# 5. 碎片整理
# HDD 上文件碎片化会导致大量寻道
# e4defrag 可以整理 ext4 碎片
e4defrag -v /dev/sda1
```

            

### 8.2 数据库设计

            
```
# 数据库的很多设计决策都源于 HDD 的性能特征：

# 1. B-Tree 的页面大小
# InnoDB 默认 16KB 页面——匹配 HDD 的一次 I/O 粒度
# 太小：每次 I/O 传输的有效数据少
# 太大：修改一个值要写入更多数据

# 2. WAL（Write-Ahead Logging）
# 随机写入 → 先转换为顺序写入（WAL）
# 然后在后台合并回数据文件（checkpoint）
# 顺序写 WAL 远快于随机写数据页

# 3. 聚簇索引（Clustered Index）
# InnoDB 按主键物理排序数据
# 范围查询 = 顺序 I/O（而非随机 I/O）

# 4. 批量提交（Group Commit）
# 多个事务的 WAL 记录合并成一次 fsync
# 减少 fsync 次数（每次 fsync 至少一次旋转延迟）

# 5. Buffer Pool
# 用内存缓存频繁访问的数据页
# 将随机读取转化为内存操作
# Buffer Pool 命中率是 HDD 上数据库性能的关键指标
```

            

### 8.3 分布式存储设计

            
```
# 分布式存储系统如何应对 HDD 的弱点：

# 1. 日志结构写入（Log-Structured Write）
# Ceph BlueStore、HDFS 都使用日志结构写入
# 所有写入变成追加写入（顺序 I/O）
# 后台 compaction 整理数据

# 2. SSD + HDD 混合
# Ceph BlueStore：
#   RocksDB 元数据 → NVMe SSD
#   WAL/Journal → SSD
#   Object data → HDD
# 配置示例：
# [osd]
# bluestore_block_db_path = /dev/nvme0n1p1    # RocksDB on SSD
# bluestore_block_wal_path = /dev/nvme0n1p2   # WAL on SSD
# bluestore_block_path = /dev/sda             # Data on HDD

# 3. 大块写入
# HDFS 默认块大小 128MB（从 64MB 增加到 128MB）
# 每次写入 128MB 连续数据，充分利用 HDD 的顺序吞吐

# 4. 数据放置策略
# 同一 block group 的副本不放在同一机架
# 故障域意识的数据分布
```

            

## 参考文献

            
            
- Seagate Technology, “Hard Disk Drive Specification,”
            seagate.com.
            
- Western Digital, “Advanced Format Technology Brief,”
            westerndigital.com.
            
- Schroeder, B., Gibson, G., “Disk Failures in the Real
            World: What Does an MTTF of 1,000,000 Hours Mean to You?,”
            FAST, 2007.
            
- Pinheiro, E., Weber, W., Barroso, L., “Failure Trends in
            a Large Disk Drive Population,” FAST, 2007.
            
- Agrawal, N. et al., “Design Tradeoffs for SSD
            Performance,” USENIX ATC, 2008.
            
- Backblaze, “Hard Drive Stats,”
            backblaze.com/cloud-storage/resources/hard-drive-test-data.
            
            
            

**下一篇**: SSD 与 NAND
            Flash：FTL、写放大与磨损均衡
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-18 · storage
                    

### 【存储工程】云块存储架构

                    

深入剖析云块存储——分布式块存储架构原理、AWS EBS与阿里云ESSD架构分析、云盘性能规格解读、性能测试方法与选型成本优化
                

                
                    

2025-10-12 · storage
                    

### 【存储工程】存储基准测试方法论

                    

深入剖析存储基准测试的方法论——fio 参数解析、filebench 工作负载定义、YCSB 数据库基准、测试陷阱规避与性能回归测试集成
                

                
                    

2025-08-14 · storage
                    

### 【存储工程】存储性能建模：IOPS、吞吐与延迟

                    

存储性能不是一个数字，而是 IOPS、吞吐量和延迟在特定工作负载下的函数关系。本文从排队论模型出发，用 fio 实测验证，覆盖从 HDD 到 NVMe SSD 的性能画像，最终落到容量规划和监控体系的工程实践。
                

                
                    

2025-08-15 · storage
                    

### 【存储工程】存储介质选型指南

                    

存储选型不是'SSD 比 HDD 快所以选 SSD'这么简单。不同工作负载对 IOPS、吞吐、延迟、容量、成本的权重完全不同。本文从性能、可靠性、成本三个维度对比 HDD、SATA SSD、NVMe SSD、Optane/PMem 和磁带，给出面向具体工作负载的选型决策框架和分层存储架构设计方法。