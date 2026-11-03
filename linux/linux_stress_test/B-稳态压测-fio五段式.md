# B. 稳态性能压测 (核心) — fio 命令全集

原文依据: quant67/storage 06-storage-media-selection.md
  md:227-242   持续写入测试 (看 SLC cache 衰减)
  md:1200-1211 设备预处理 (达到稳态)
  md:1213-1264 五段式压测 (随机读 / 随机写 / 混合 / 顺序读)
  md:1271-1278 关键观察点

================================================================
B.0 fio 安装与原理
================================================================

----------------------------------------------------------------
B.0.1 安装
----------------------------------------------------------------
```
# Debian/Ubuntu
apt-get install fio

# RHEL/CentOS
yum install fio
# 或 EPEL 源
yum install epel-release && yum install fio
```

----------------------------------------------------------------
B.0.2 fio 工作模型 (理解命令的前提)
================================================================

fio 通过 ioengine (I/O 引擎) 把请求提交给内核:

  ioengine=sync      进程同步 read()/write()    绕过内核 AIO
  ioengine=psync     进程同步 O_SYNC           绕过 Page Cache
  ioengine=libaio    Linux 原生异步 AIO          高并发, 主流选择
  ioengine=io_uring  Linux 5.10+ 新异步接口       最低延迟, 2025 推荐
  ioengine=mmap      写到 mmap 文件              文件 IO 压测
  ioengine=posixaio  POSIX AIO
  ioengine=spdk_bdev SPDK 旁路内核              NVMe 极致延迟
  ioengine=null      测试引擎本身开销

关键参数骨架:
  --name        job 名 (输出分组用)
  --ioengine    引擎
  --rw          I/O 模式
  --bs          块大小
  --iodepth     队列深度 (异步模式下未完成请求数)
  --numjobs     并发线程数
  --size/--runtime  容量限制 / 时间限制
  --filename    目标路径或裸设备
  --direct=1    绕过 Page Cache (压测设备必加)
  --ioengine=libaio + --iodepth>1 + --direct=1   NVMe 压测黄金三角

================================================================
B.1 设备预处理 (Precondition) — 让 SSD 进入稳态
================================================================

原文: md:1200-1211
为什么必须做:
  新盘有 SLC cache, 写性能虚高
  经过 GC (垃圾回收) 后, 真实稳态性能可能只有峰值 30-50%
  SNIA PTS 标准要求 precondition 后才能测

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
逐参数解读:
  --rw=write    顺序写 (不是随机, 写整盘效率最高)
  --bs=128k     大块写, 快速写满
  --iodepth=32  高队列, 让 NVMe 满载
  --size=100%   写满整盘
  --loops=2     写 2 遍, 触发 GC 稳定
  不加 --runtime/-time_based: fio 自然结束, 不受时间限制

================================================================
B.2 五段式压测 — 完整命令 (原文逐字摘录)
================================================================

通用前提:
  - 已经过 B.1 预处理
  - 目标设备 /dev/nvme0n1 已知
  - 全部用 --direct=1 + --ioengine=libaio + --output-format=json

----------------------------------------------------------------
B.2.1 第一段: 随机读 QD1 — 数据库索引查找场景
----------------------------------------------------------------
原文: md:1213-1224
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
解读:
  --iodepth=1   关键! 测的是"在线服务真实延迟", 不是峰值吞吐
  --bs=4k       数据库默认块大小
  --runtime=300 + --time_based  跑 5 分钟

观察:
  read: lat (us) P50/P99/P99.9
  IOPS: 稳态值 (看是否达规格书 80%)

----------------------------------------------------------------
B.2.2 第二段: 随机写 QD32 — 数据库更新场景
----------------------------------------------------------------
原文: md:1226-1237
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
解读:
  --iodepth=32  模拟多客户端并发, NVMe 才能发挥并行优势
  这是 SSD 与 HDD 差距最大的场景

观察:
  write: IOPS / lat (us) / bw (KB/s)
  ⚠️ 如果看到 IOPS 阶梯式下降 → SLC cache 耗尽
  稳态 IOPS 比峰值低 30-60% 是正常的

----------------------------------------------------------------
B.2.3 第三段: 混合读写 — 真实 OLTP 负载
----------------------------------------------------------------
原文: md:1239-1251
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
解读:
  --rwmixread=70    70% 读 + 30% 写 (OLTP 典型比例)
  --numjobs=4       4 个线程模拟多客户端
  --iodepth=16      每线程队列深度 16, 总有效 QD=64

观察:
  read: IOPS / write: IOPS / lat (us)
  注意混合模式下写延迟通常比纯写高 20-50%

----------------------------------------------------------------
B.2.4 第四段: 顺序读 — 数据仓库扫描场景
----------------------------------------------------------------
原文: md:1253-1264
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
解读:
  --bs=128k       大块顺序, 贴合 OLAP/备份
  --runtime=120   2 分钟就够 (顺序性能很快稳定)

观察:
  read: bw (KB/s)  → 是否接近接口理论带宽
  PCIe 4.0 NVMe 期望 ~6.5-7 GB/s
  PCIe 5.0 NVMe 期望 ~12-14 GB/s
  SATA SSD 期望 ~530-560 MB/s (接口上限)

================================================================
B.3 持续写入压测 — 看 SLC cache 衰减曲线
================================================================

原文: md:225-242

用途: 验证 SSD 在长时间高负载下是否稳定
典型 NVMe SSD 曲线 (原文 md:248-253):
  0-5 min     500K IOPS  (SLC 缓存阶段)
  5-15 min    250K IOPS  (缓存耗尽, GC 开始)
  15-60 min   150-200K   (稳态性能)

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
解读:
  --runtime=3600            跑 1 小时
  --log_avg_msec=1000       每秒采一次样
  --write_bw_log=sustained  带宽日志目录前缀
  --write_iops_log=sustained IOPS 日志
  --write_lat_log=sustained 延迟日志

输出: sustained.1.log / sustained_*.log
  fio 自带工具画图:
  ```
  fio_generate_plots=sustained
  # 生成 PNG 折线图
  ```

================================================================
B.4 五段式压测的输出关注点 (原文 md:1271-1278)
================================================================

  指标         关注什么                                 告警信号
  ─────────────────────────────────────────────────────────
  IOPS         是否达到规格书标称值的 80% 以上            < 50% 规格值
  延迟 P99     是否有尖锐长尾                           P99 > 5ms (NVMe)
  延迟 P999    GC/固件内部操作导致的尖峰                 P999 > 500us
  吞吐量       顺序读写是否接近接口理论带宽               实际 < 理论 70%
  稳定性       5 分钟测试内 IOPS 标准差是否 <10%          > 20% 不稳定
  clat 分布    percentile 列里 P99.9/P99.99 长尾          远超 P99

JSON 输出解析 (Python 一行):
```
python3 -c '
import json,sys
d = json.load(open("rand-read.json"))
j = d["jobs"][0]
print(f"read IOPS  = {j[\"read\"][\"io_bytes\"]/j[\"read\"][\"runtime\"]/1024:.1f} KB/s")
print(f"clat P50   = {j[\"read\"][\"clat_ns\"][\"percentile\"][\"50.000000\"]/1000:.1f} us")
print(f"clat P99   = {j[\"read\"][\"clat_ns\"][\"percentile\"][\"99.000000\"]/1000:.1f} us")
'
```

================================================================
B.5 fio 常用参数速查表
================================================================

I/O 模式
  --rw=read          顺序读
  --rw=write         顺序写
  --rw=randread      随机读
  --rw=randwrite     随机写
  --rw=randrw        混合 (与 --rwmixread 配合)
  --rw=trim          发送 TRIM (SSD 需配 --filename=文件系统)
  --rw=trimwrite     写后 TRIM (循环)

块大小
  --bs=4k            数据库
  --bs=16k           小文件
  --bs=64k           默认
  --bs=128k          数据仓库
  --bs=1m            备份/视频
  --bsrange=4k-1m    多块大小测试

队列
  --iodepth=N        单 job 队列深度
  --numjobs=N        并发 job 数
  --iodepth_batch_submit / _complete   批提交
  --serialize_overlap 1                 严格串行

时间/容量
  --runtime=N        跑 N 秒
  --time_based       即使写满也继续跑到 runtime
  --size=N%          用设备容量的 N%
  --loops=N          重复 N 次

输出
  --output-format=normal  人类可读
  --output-format=json    JSON (脚本解析)
  --output-format=json+   JSON + 文本
  --log_avg_msec=N        采样间隔
  --write_bw_log=DIR      带宽日志
  --write_iops_log=DIR    IOPS 日志
  --write_lat_log=DIR     延迟日志

Page Cache 行为
  --direct=1        绕过 Page Cache (测设备, 必加)
  --invalidate=1    测试前失效 Page Cache
  --sync=0/1        write 是否走 sync IO

IO 引擎
  --ioengine=sync       同步, 简单
  --ioengine=psync      同步 + O_SYNC
  --ioengine=libaio     Linux AIO, 主流
  --ioengine=io_uring   Linux 5.10+, 2025 推荐
  --ioengine=mmap       mmap 文件
  --ioengine=posixaio   POSIX AIO (兼容 BSD)
  --ioengine=spdk_bdev  SPDK 用户态旁路

其它
  --name=           job 名
  --filename=       目标 (裸设备 / 文件 / 多目标用 :file1:file2)
  --verify=md5/crc32 写后校验 (慢, 调试用)
  --rate_iops=50000 限速 (模拟真实负载)
  --thinktime=N     思考时间 (模拟人工操作)
  --thread          用线程代替进程
  --group_reporting 多 job 合并报告

================================================================
B.6 fio 文件系统级测试 (不需要裸设备)
================================================================

测文件系统 (ext4 / xfs) 性能而非底层设备:
```
fio --name=fs-test \
    --directory=/mnt/nvme \
    --ioengine=libaio \
    --rw=randrw \
    --rwmixread=70 \
    --bs=4k \
    --iodepth=16 \
    --numjobs=4 \
    --size=10G \
    --runtime=300 \
    --time_based
```
注意:
  不加 --direct=1 (走 Page Cache, 这是应用实际行为)
  不指定 --filename, 用 --directory 自动建临时文件
  --size=10G 比 --size=100% 更省盘

================================================================
B.7 测试模板套用
================================================================

原文给了完整命令 (B.1-B.3), 但生产环境需调整:
  --filename=/dev/nvme0n1
     → 替换为实际设备路径
     → 测试裸盘:
        /dev/nvme0n1        NVMe 整盘
        /dev/sda            SATA 整盘
     → 测试 LV:
        /dev/vg0/data_lv
     → 测试分区:
        /dev/nvme0n1p3
     → 测试文件:
        /mnt/nvme/test.bin

⚠️ 裸设备测试会清空数据, 建议:
  - 新采购盘
  - 拆机的旧盘
  - 测试机空闲盘
  - 已备份盘

================================================================
B 类命令 → 决策节点
================================================================

fio 五段式
  ↓
  对比规格书
  ↓
  IOPS/延迟达标     → 上线 (进入 E 类迁移)
  IOPS/延迟不达标   → 选更高端型号 / 启用块层缓存 (进入 D 类)
  SLC cache 暴跌    → 写入放大问题严重, 调整工作负载或更换型号