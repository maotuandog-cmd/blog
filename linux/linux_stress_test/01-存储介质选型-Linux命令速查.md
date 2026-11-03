# 存储介质选型-Linux 命令速查 (fio/iostat/blktrace/bcache/LVM)

来源: https://quant67.com/post/storage/06-storage-media-selection/storage-media-selection.html
本地原文缓存: /home/obsidian/postgres/learn/quant67-storage-md/06-storage-media-selection__storage-media-selection.md (1541 行)
本文定位: stress_test 视角的压测/选型验证命令,与 linux_perform/IO/ 故障排查视角互补
命令全部来自原文,只做结构化整理与执行注释,不发明任何新命令

================================================================
零、命令分类地图 (按选型决策链路排序)
================================================================

A. 选型前的基线采集
   lsblk / smartctl / nvme smart-log              设备画像

B. 稳态性能压测 (核心)
   fio precondition / randread / randwrite / mixed / seq              五段式压测

C. 实时监控与细粒度分析
   iostat -xz 1                                              平均延迟
   blktrace / blkparse / btt                                  I/O 子系统栈追踪
   iotop / perf                                              进程级归因 (扩展)

D. 块层缓存方案 (混合介质提速)
   make-bcache / dmsetup / lvcreate --type cache              bcache / dm-writecache / lvmcache

E. 介质迁移 (HDD→SSD)
   pvcreate / vgextend / pvmove / vgreduce / pvremove         LVM 在线迁移
   ceph osd pool set ... crush_rule                           分布式存储迁移

F. 健康度/告警
   smartctl -a / nvme smart-log                               SMART 读数
   smartctl -t long / short                                   触发自检 (扩展)

================================================================
一、选型前的设备画像 (原文 9.1 + 9.2)
================================================================

设备列表
```
lsblk -d -o NAME,SIZE,ROTA,TRAN,MODEL
# ROTA=1 是 HDD, =0 是 SSD/NVMe
# TRAN 字段: sata / nvme / usb
```

SMART 健康读数 (HDD/SATA SSD)
```
smartctl -a /dev/sda
# 看 Reallocated_Sector_Ct / Spin_Retry_Count / Temperature_Celsius
```

NVMe 健康读数 (比 SMART 更丰富的设备内部计数器)
```
nvme smart-log /dev/nvme0n1
# 关注 5 项:
#   percentage_used       : SSD 寿命消耗百分比 (>80 触发替换)
#   available_spare       : 可用备用块百分比 (<10 触发告警)
#   media_errors          : 介质错误计数 (任何非零值都要查)
#   num_err_log_entries   : 错误日志条目数
#   warning_temp_time     : 温度超阈值累计毫秒数
```

原文: storage-media-selection.md:1279-1290

================================================================
二、稳态性能压测 (原文 9.3 五段式)
================================================================

【警告】以下全部 fio 命令针对裸设备运行,会清除 /dev/nvme0n1 数据。
生产环境必须先用空盘或 LVM snapshot / 文件作为目标盘。

----------------------------------------------------------------
2.1 设备预处理 (写满两次达到稳态,触发 GC)
----------------------------------------------------------------
原文: storage-media-selection.md:1200-1211
```
fio --name=precondition \
    --ioengine=libaio \
    --direct=1 \
    --rw=write \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --size=100% \
    --loops=2 \
    --filename=/dev/nvme0n1
```
要点:
  --direct=1        绕开 Page Cache,测设备本身 (避免污染测试结果)
  --size=100%       写满整盘
  --loops=2         写两遍,触发 GC,达到稳态
  不加 --runtime    让 fio 自动算完成时间,保证稳态

----------------------------------------------------------------
2.2 持续写入压测 (稳态曲线)
----------------------------------------------------------------
原文: storage-media-selection.md:227-242
```
fio --name=sustained-write \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=32 \
    --numjobs=1 \
    --size=100% \
    --runtime=3600 \
    --time_based \
    --log_avg_msec=1000 \
    --write_bw_log=sustained \
    --write_iops_log=sustained \
    --write_lat_log=sustained \
    --filename=/dev/nvme0n1
```
要点:
  --runtime=3600 + --time_based  跑满 1 小时,观察 SLC cache 耗尽 + GC 介入的曲线
  --log_avg_msec=1000           每 1 秒采一次样,画图用
  典型 NVMe 曲线: 500K IOPS (0-5min) → 250K (5-15min) → 150-200K 稳态 (15min+)

----------------------------------------------------------------
2.3 随机读压测 (数据库索引查找)
----------------------------------------------------------------
原文: storage-media-selection.md:1213-1224
```
fio --name=rand-read \
    --ioengine=libaio \
    --direct=1 \
    --rw=randread \
    --bs=4k \
    --iodepth=1 \
    --numjobs=1 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json
```
要点:
  --iodepth=1  测 QD1 延迟 (在线服务最关心)
  --bs=4k      数据库块大小
  --output-format=json  便于后续脚本解析 P99

----------------------------------------------------------------
2.4 随机写压测 (数据库更新)
----------------------------------------------------------------
原文: storage-media-selection.md:1226-1237
```
fio --name=rand-write \
    --ioengine=libaio \
    --direct=1 \
    --rw=randwrite \
    --bs=4k \
    --iodepth=32 \
    --numjobs=1 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json
```
要点:
  --iodepth=32  模拟高并发,体现 NVMe 协议多队列优势

----------------------------------------------------------------
2.5 混合读写压测 (真实 OLTP 负载)
----------------------------------------------------------------
原文: storage-media-selection.md:1239-1251
```
fio --name=mixed-rw \
    --ioengine=libaio \
    --direct=1 \
    --rw=randrw \
    --rwmixread=70 \
    --bs=4k \
    --iodepth=16 \
    --numjobs=4 \
    --runtime=300 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json
```
要点:
  --rwmixread=70   70% 读 + 30% 写,贴合 OLTP 典型读写比
  --numjobs=4      多线程模拟多客户端

----------------------------------------------------------------
2.6 顺序读压测 (数据仓库扫描)
----------------------------------------------------------------
原文: storage-media-selection.md:1253-1264
```
fio --name=seq-read \
    --ioengine=libaio \
    --direct=1 \
    --rw=read \
    --bs=128k \
    --iodepth=32 \
    --numjobs=1 \
    --runtime=120 \
    --time_based \
    --filename=/dev/nvme0n1 \
    --output-format=json
```
要点:
  --bs=128k        大块顺序,贴合 OLAP / 备份场景
  关注是否接近接口理论带宽 (PCIe 4.0 NVMe ~7 GB/s)

----------------------------------------------------------------
2.7 五段式压测的关键观察点
----------------------------------------------------------------
原文: storage-media-selection.md:1271-1278

  指标            关注什么
  ──────────────────────────────────────────
  IOPS            是否达到规格书标称值的 80% 以上
  延迟分布        P99 / P999 是否有明显尖峰
  吞吐量          顺序读写是否接近接口理论带宽
  稳定性          5 分钟测试内 IOPS 标准差是否 <10%

================================================================
三、实时 I/O 监控 (原文 5.2 / 9.3)
================================================================

----------------------------------------------------------------
3.1 iostat 平均延迟监控
----------------------------------------------------------------
原文: storage-media-selection.md:692-694, 1292-1296
```
iostat -xz 1 5
```
常用形式:
  iostat -xz 1       每秒刷新,无限循环
  iostat -xz 1 5     每秒刷新,共 5 次 (适合脚本)
  iostat -xz -p ALL 1  按设备路径展示 (比 /dev/nvme0n1 更易读)

关注列:
  r_await / w_await    平均请求延迟 (ms),P50 级别
  rrqm/s + wrqm/s      合并率,过高说明上层 I/O 太碎
  aqu-sz / avgqu-sz    平均队列深度
  %util                设备利用率 (SSD/NVMe 上 %util=100% 不一定饱和,要看 await)
  svctm                已废弃 (iostat 12+ 版本)
  
告警阈值 (原文:1307-1315):
  指标                  HDD 告警           SSD 告警
  ────────────────────────────────────────────────
  平均读延迟            > 20 ms            > 1 ms
  P99 读延迟            > 50 ms            > 5 ms
  设备利用率            > 90% 持续 5 分钟   > 95% 持续 5 分钟

----------------------------------------------------------------
3.2 blktrace 细粒度 I/O 栈追踪
----------------------------------------------------------------
原文: storage-media-selection.md:697-699, 1299
```
blktrace -d /dev/nvme0n1 -o trace
blkparse -i trace -d trace.bin
btt -i trace.bin
```
简化管道 (适合一次性观察):
```
blktrace -d /dev/nvme0n1 -o - | blkparse -i - -o trace.txt
```
用途:
  区分 I/O 时间花在 bio 入队 / 调度 / 设备处理 / 完成哪一段
  诊断 %util 低但延迟高 (常见: 请求排队在调度器)
  
依赖安装:
  blktrace / blkparse 在 util-linux 包
  btt 在 blktrace 包,部分发行版独立为 btt

================================================================
四、块层缓存方案 (原文 6.2 SSD 加速 HDD)
================================================================

----------------------------------------------------------------
4.1 bcache (内核块层,生产可用)
----------------------------------------------------------------
原文: storage-media-selection.md:806-829
```
# 1. 安装工具
apt-get install bcache-tools      # Debian/Ubuntu
yum install bcache-tools          # RHEL/CentOS

# 2. 准备缓存设备 (SSD) + 后端设备 (HDD)
# 警告: 以下操作会清除设备数据
make-bcache -B /dev/sda -C /dev/nvme0n1p1

# 3. 查看 bcache 设备
ls /dev/bcache0

# 4. 设置缓存模式
# writeback   写入先到 SSD 后台回刷 (性能最好,SSD 故障可能丢未刷盘数据)
# writethrough 同时写 SSD 和 HDD (安全,但写性能无提升)
# writearound  写入直接到 HDD,只缓存读 (适合大量顺序写)
echo writeback > /sys/block/bcache0/bcache/cache_mode

# 5. 顺序 I/O 缓存阈值 (默认 0 = 全缓存)
# 设大值可跳过大块顺序读,避免 SSD 被顺序流覆盖掉热点
echo 0 > /sys/block/bcache0/bcache/sequential_cutoff

# 6. 命中率监控
cat /sys/block/bcache0/bcache/stats_total/cache_hit_ratio
```

----------------------------------------------------------------
4.2 dm-writecache (device-mapper 写缓存)
----------------------------------------------------------------
原文: storage-media-selection.md:840-848
```
# /dev/nvme0n1p1 是 SSD 缓存, /dev/sda 是 HDD
dmsetup create cached-disk --table \
  "0 $(blockdev --getsz /dev/sda) writecache p /dev/sda /dev/nvme0n1p1 4096 0"
# 0                                    起始 LBA
# $(blockdev --getsz /dev/sda)         后端设备扇区数 (= 整个 HDD)
# writecache                           target 类型
# p                                    pmem 模式 (另一选项 s 表示 SSD 模式)
# /dev/sda /dev/nvme0n1p1              后端 + 缓存
# 4096                                 块大小 (扇区)
# 0                                    额外参数
```

----------------------------------------------------------------
4.3 LVM cache (与现有 LVM 集成最方便)
----------------------------------------------------------------
原文: storage-media-selection.md:858-870
```
# 1. 创建缓存池 + 元数据 (在 SSD 上)
lvcreate -L 100G -n cache_pool vg0 /dev/nvme0n1p1
lvcreate -L 1G -n cache_meta vg0 /dev/nvme0n1p1

# 2. 初始化缓存池
lvconvert --type cache-pool \
  --poolmetadata vg0/cache_meta vg0/cache_pool

# 3. 把缓存附加到已有数据卷 (HDD LV)
lvconvert --type cache --cachepool vg0/cache_pool vg0/data_lv

# 4. 查看缓存状态
lvs -o+cache_policy,cache_settings,cache_mode
```

================================================================
五、介质迁移 (原文 9.5 在线迁移)
================================================================

----------------------------------------------------------------
5.1 LVM 在线迁移 (推荐: 业务不中断)
----------------------------------------------------------------
原文: storage-media-selection.md:1352-1362
```
# 1. 把新 SSD 加入卷组
pvcreate /dev/nvme0n1p1
vgextend vg0 /dev/nvme0n1p1

# 2. 在后台把数据从旧 HDD 迁到 SSD (业务不中断)
pvmove /dev/sda1 /dev/nvme0n1p1

# 3. 迁移完成后把旧 PV 从 VG 移除
vgreduce vg0 /dev/sda1
pvremove /dev/sda1
```
注意:
  pvmove 期间会同步数据,大量数据需数小时
  可在 screen / tmux / nohup 后台运行
  监控迁移进度: lvs 或 pvs

----------------------------------------------------------------
5.2 分布式存储迁移 (Ceph 介质类切换)
----------------------------------------------------------------
原文: storage-media-selection.md:1382-1387
```
# 把 pool 的 CRUSH 规则从 HDD class 改为 SSD class
ceph osd pool set mypool crush_rule ssd_rule
# Ceph 自动后台 rebalance 数据

# 监控迁移进度
ceph -s
ceph osd pool stats mypool
```

================================================================
六、告警阈值速查 (原文 9.3)
================================================================

原文表格 (storage-media-selection.md:1307-1315)

  指标                          HDD 告警          SSD 告警
  ─────────────────────────────────────────────────────────
  平均读延迟                    > 20 ms           > 1 ms
  P99 读延迟                    > 50 ms           > 5 ms
  设备利用率 (%util)            > 90% 持续 5min   > 95% 持续 5min
  SMART Reallocated Sectors     > 10              N/A
  SSD percentage_used           N/A               > 80%
  SSD available_spare           N/A               < 10%
  NVMe 温度                      > 55°C            > 70°C

================================================================
七、命令在选型决策链路上的位置
================================================================

  决策节点              用到的命令
  ──────────────────────────────────────────────
  1. 摸清现有设备        lsblk / smartctl / nvme smart-log
  2. 验证新盘规格        fio precondition + 五段式压测
  3. 选 SSD 缓存方案     bcache / dm-writecache / lvmcache 三选一
  4. 在线切换介质        LVM pvmove / Ceph crush_rule
  5. 上线后持续监控      iostat + SMART 周期巡检
  6. 触发替换决策        告警阈值触发,见第六章

================================================================
八、与其它笔记的关联
================================================================

  linux_perform/IO/24-磁盘IO怎么工作-上.md    I/O 原理 (为何 QD1 vs QD32 差 30 倍)
  linux_perform/IO/30-IO瓶颈定位套路.md        故障排查视角,与本笔记互补
  quant67-storage-md/06-storage-media-selection__storage-media-selection.md  原文 1541 行
  quant67-storage-md/05-storage-performance-modeling__storage-performance-modeling.md  性能建模 (IOPS/吞吐/延迟公式)

================================================================
术语表
================================================================

  fio                  Flexible I/O Tester,存储基准测试事实标准
  SNIA PTS             Storage Networking Industry Association Performance Test Spec
  DWPD                 Drive Writes Per Day,每日全盘写入次数
  TBW                  Total Bytes Written,寿命内总写入量
  OP                   Over-Provisioning,SSD 预留空间
  GC                   Garbage Collection,NAND Flash 垃圾回收
  SLC cache            TLC/QLC NAND 用一部分单元模拟 SLC 提升写性能
  MTBF / AFR           Mean Time Between Failures / Annualized Failure Rate
  URE                  Unrecoverable Read Error
  Page Cache           Linux 内核页缓存,Direct I/O 绕过它
  bcache               Linux 内核块设备缓存,SSD 加速 HDD
  dm-writecache        device-mapper 写缓存 target
  lvmcache             LVM 自带的 SSD 缓存机制
  CRUSH rule           Ceph 数据分布规则,可按介质类切换