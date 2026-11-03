# D. 块层缓存方案 — 用 SSD 加速 HDD

原文依据: quant67/storage 06-storage-media-selection.md
  md:806-829  bcache
  md:840-848  dm-writecache
  md:858-870  LVM cache

三方案定位:
  bcache       Linux 内核原生块缓存, 通用, 生产可用 (推荐起步)
  dm-writecache 写专用, 适合"加速顺序写"场景
  LVM cache    与现有 LVM 集成最方便, 已有 LVM 时首选

================================================================
D.0 三方案对比 (选型决策表)
================================================================

  方案          读加速  写加速  复杂度  持久性  适用场景
  ──────────────────────────────────────────────────────
  bcache         ✓       ✓       中      高     通用读写混合
  dm-writecache   ✗       ✓       高      中     写密集顺序流
  LVM cache      ✓       ✓       低      高     已有 LVM 基础设施

================================================================
D.1 bcache — Linux 内核块层缓存
================================================================

原文: md:799-829
bcache 特点:
  内核自带 (>= 3.10), 无需补丁
  支持 writethrough / writeback / writearound 三种模式
  可热插拔缓存设备
  性能最好但 SSD 故障时 writeback 模式可能丢数据

----------------------------------------------------------------
D.1.1 安装
----------------------------------------------------------------
```
# Debian/Ubuntu
apt-get install bcache-tools

# RHEL/CentOS
yum install bcache-tools

# 内核模块 (通常已编译)
modprobe bcache
lsmod | grep bcache
# 没看到则 modprobe 加载
```

----------------------------------------------------------------
D.1.2 准备 SSD 与 HDD (原文 md:811-812)
----------------------------------------------------------------

原文命令:
```
make-bcache -B /dev/sda -C /dev/nvme0n1p1
```

参数:
  -B   后端设备 (Backend) = HDD, 用于持久数据
  -C   缓存设备 (Cache) = SSD, 用于加速
  ⚠️ 这一步会清除两个设备的数据

实际更多选项:
```
make-bcache -B /dev/sda -C /dev/nvme0n1p1 \
    --block-size=4k \          # 缓存块大小
    --bucket-size=128k         # bcache 内部桶大小
```

----------------------------------------------------------------
D.1.3 查看 bcache 设备 (原文 md:815)
----------------------------------------------------------------
```
ls /dev/bcache0
# 出现 /dev/bcache0 即可像普通盘一样用
# 挂载或做 LVM PV 都行

cat /proc/mounts | grep bcache
dmsetup table
lsblk
# 都能看到 bcache0
```

----------------------------------------------------------------
D.1.4 三种缓存模式 (原文 md:821)
----------------------------------------------------------------
```
# 模式对比 (原文 md:818-820):
#   writeback    写入先到 SSD 后台回刷 HDD (性能最好, 但 SSD 故障可能丢未刷盘数据)
#   writethrough 同时写 SSD 和 HDD (安全, 写性能无提升)
#   writearound  写入直接到 HDD 只缓存读 (适合大量顺序写场景)
```

切到 writeback:
```
echo writeback > /sys/block/bcache0/bcache/cache_mode
```

切到 writethrough:
```
echo writethrough > /sys/block/bcache0/bcache/cache_mode
```

切到 writearound:
```
echo writearound > /sys/block/bcache0/bcache/cache_mode
```

实时查看当前模式:
```
cat /sys/block/bcache0/bcache/cache_mode
```

----------------------------------------------------------------
D.1.5 顺序 I/O 阈值 (原文 md:824)
----------------------------------------------------------------

原文命令:
```
echo 0 > /sys/block/bcache0/bcache/sequential_cutoff
```

解读:
  默认 0 = 所有读都被缓存
  调大此值 = 跳过大块顺序读 (避免 SSD 被顺序流污染热点)
  例: 设为 4096 表示连续 4K 以上的顺序读直接到 HDD

查看当前值:
```
cat /sys/block/bcache0/bcache/sequential_cutoff
```

----------------------------------------------------------------
D.1.6 命中率监控 (原文 md:828)
----------------------------------------------------------------
```
cat /sys/block/bcache0/bcache/stats_total/cache_hit_ratio
# 输出如 "66" 表示 66% 命中率

cat /sys/block/bcache0/bcache/stats_total/*
# 完整统计: hit / miss / bypass / 分配等
```

观察指标:
  cache_hit_ratio       命中率, < 30% 说明缓存太小或工作负载不合适
  cache_bypass_count    跳过的请求数 (受 sequential_cutoff 影响)
  cache_replacement     换出的桶数 (持续涨说明容量压力)

----------------------------------------------------------------
D.1.7 停止 / 分离 bcache
----------------------------------------------------------------
```
# 1. 解除挂载 / LVM 引用
umount /mnt/bcache

# 2. 停止 bcache 设备
echo 1 > /sys/block/bcache0/bcache/stop

# 3. 撤销注册
make-bcache -u /dev/sda
make-bcache -u /dev/nvme0n1p1
```

================================================================
D.2 dm-writecache — device-mapper 写缓存
================================================================

原文: md:833-848
特点:
  写专用 (读仍走 HDD)
  支持 pmem (持久内存) 和 ssd 模式
  内核版本要求 >= 5.0

----------------------------------------------------------------
D.2.1 内核模块
----------------------------------------------------------------
```
modprobe dm-writecache
lsmod | grep dm_writecache
```

----------------------------------------------------------------
D.2.2 创建设备 (原文 md:843-848)
----------------------------------------------------------------
原文命令:
```
dmsetup create cached-disk --table \
  "0 $(blockdev --getsz /dev/sda) writecache p /dev/sda /dev/nvme0n1p1 4096 0"
```

参数逐行解读:
  dmsetup create cached-disk       创建设备映射名 cached-disk
  --table "0 LBA writecache p BACKEND CACHE BS EXTRA"
    0                  起始扇区 (从 0 开始)
    $(blockdev --getsz /dev/sda)
                       后端设备总扇区数 (=整个 HDD)
    writecache         dm target 类型
    p                  pmem 模式 (另一选项: s = ssd 模式)
    /dev/sda           后端设备 (HDD)
    /dev/nvme0n1p1     缓存设备 (SSD)
    4096               块大小 (扇区, 4096 × 512 = 2MB)
    0                  额外参数 (flags)

----------------------------------------------------------------
D.2.3 pmem 模式 vs ssd 模式
----------------------------------------------------------------

  p (pmem)    假设缓存介质稳定 (Optane 等), write 立即返回
  s (ssd)     SSD 模式, 延迟更高但更安全

Optane 已停产, 现多用 s 模式。

----------------------------------------------------------------
D.2.4 查看与监控
----------------------------------------------------------------
```
dmsetup status cached-disk
# 输出: cached-disk: 0 7814037168 writecache ...

dmsetup table cached-disk
# 查看完整参数

dmsetup info cached-disk
# 元数据
```

----------------------------------------------------------------
D.2.5 停止
----------------------------------------------------------------
```
dmsetup remove cached-disk
# 注意: 不自动回写缓存, 需先 flush
# 安全做法:
dmsetup suspend --noflush --nolockfs cached-disk
sync
dmsetup resume cached-disk
dmsetup remove cached-disk
```

================================================================
D.3 LVM cache — 与现有 LVM 集成
================================================================

原文: md:852-870
特点:
  与现有 LVM 无缝集成 (无需新创建设备)
  支持 dm-cache 内核引擎
  不丢数据 + 可热移除

----------------------------------------------------------------
D.3.1 前置: 已有 LV (原文 md:865-866 隐含前提)
----------------------------------------------------------------
```
lvs
# 假设已有:
#   vg0           卷组
#   vg0/data_lv   已有数据卷 (在 HDD 上)
#   /dev/nvme0n1p1  SSD 分区 (用作缓存)
```

----------------------------------------------------------------
D.3.2 创建缓存池 + 元数据 (原文 md:861-862)
----------------------------------------------------------------
原文命令:
```
lvcreate -L 100G -n cache_pool vg0 /dev/nvme0n1p1
lvcreate -L 1G -n cache_meta vg0 /dev/nvme0n1p1
```

参数:
  -L 100G        缓存池大小 (一般 100G-200G, 不用整 SSD)
  -n cache_pool   LV 名
  vg0            卷组
  /dev/nvme0n1p1 创建在哪个 PV

⚠️ cache_meta 必须 < cache_pool (一般 1/1000 大小)
  计算公式: meta ≈ cache_pool / 1000, 最小 8MB

----------------------------------------------------------------
D.3.3 初始化缓存池 (原文 md:865)
----------------------------------------------------------------
```
lvconvert --type cache-pool \
  --poolmetadata vg0/cache_meta vg0/cache_pool
```

参数:
  --type cache-pool     把 cache_pool LV 升级为缓存池
  --poolmetadata         指定元数据 LV

----------------------------------------------------------------
D.3.4 附加到现有数据卷 (原文 md:866)
----------------------------------------------------------------
```
lvconvert --type cache --cachepool vg0/cache_pool vg0/data_lv
```

参数:
  --type cache          把 cache-pool 装到现有数据卷
  --cachepool           指定缓存池 LV
  vg0/data_lv           目标数据 LV

完成后 vg0/data_lv 自动跑在缓存之上。

----------------------------------------------------------------
D.3.5 查看缓存状态 (原文 md:869)
----------------------------------------------------------------
```
lvs -o+cache_policy,cache_settings,cache_mode
```

输出列:
  CachePolicy        缓存策略 (clean / dirty)
  CacheSettings      mq / smq 调度模式
  CacheMode          writethrough / writeback / writearound

查看缓存占用:
```
lvs -a vg0/cache_pool -o+data_percent
# 看 cache_pool 填了多少
```

----------------------------------------------------------------
D.3.6 切换缓存模式
----------------------------------------------------------------
```
# 切到 writeback (性能优先)
lvchange --cachepolicy writeback vg0/data_lv

# 切回 writethrough (安全)
lvchange --cachepolicy writethrough vg0/data_lv
```

----------------------------------------------------------------
D.3.7 移除缓存
----------------------------------------------------------------
```
# 1. 拆缓存
lvconvert --uncache vg0/data_lv
# 数据落回 HDD

# 2. 删元数据与池
lvremove vg0/cache_meta
lvremove vg0/cache_pool
```

================================================================
D.4 三方案混合使用建议
================================================================

场景 1: 已有 LVM, 想加速 HDD
  → LVM cache (改动最小)

场景 2: 没有 LVM, 但想加速已有挂载点
  → bcache (无需重做 LVM)

场景 3: 只想加速顺序写, 读不在乎
  → dm-writecache

场景 4: 已用 bcache, 想换 SSD
  → bcache 内核支持动态换缓存设备

================================================================
D.5 三方案的局限与坑
================================================================

bcache:
  某些发行版 (RHEL) 内核可能没编译
  writeback 模式下 SSD 故障可能丢数据 (建议先写盘测试)

dm-writecache:
  pmem 模式依赖 Optane (已停产)
  缓存设备必须是快速介质, SATA SSD 用 ssd 模式

LVM cache:
  cache_pool 占 SSD 容量, 不能另做他用
  老式 RHEL 内核 (5.x 前) 不支持 dm-cache

================================================================
D 类命令 → 决策节点
================================================================

bcache / lvmcache 上线
   ↓
   iostat 监控命中率与延迟 (C 类)
   ↓
   命中率 < 30%     → 缓存太小, 扩容
   命中率 > 80%     → 一切正常
   写延迟反而升高   → 切到 writethrough 或 writearound