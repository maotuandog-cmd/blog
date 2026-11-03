# A. 选型前的基线采集 — 设备画像命令

原文依据: quant67/storage 06-storage-media-selection.md
  md:1279  smartctl -a /dev/sda
  md:1283  nvme smart-log /dev/nvme0n1

================================================================
A.1 lsblk — 列出块设备树
================================================================

为什么放在最前:
  压测/迁移/缓存方案第一步都是"看清楚手头有几块盘,各是什么类型"
  lsblk 能秒级区分 HDD / SATA SSD / NVMe,比 smartctl 更快更直观

----------------------------------------------------------------
A.1.1 基础列出
----------------------------------------------------------------
```
lsblk
# 默认输出: NAME MAJ:MIN RM SIZE RO TYPE MOUNTPOINT
# TYPE: disk / part / lvm / rom
```

只看物理盘 (不看分区):
```
lsblk -d
# 隐藏空设备 (如已删除的多路径路径)
lsblk -d -e 7
#   排除 major=7 (loop) 这类回环设备
```

----------------------------------------------------------------
A.1.2 选型关键字段 — 一次看清介质类型
----------------------------------------------------------------
```
lsblk -d -o NAME,SIZE,ROTA,TRAN,MODEL
```
字段含义:
  NAME      设备名 (sda / nvme0n1)
  SIZE      容量
  ROTA      1=机械盘 0=固态盘 (这是最直接的判别字段)
  TRAN      总线类型 (sata / nvme / usb / virtio)
  MODEL     厂商型号 (选型时要与厂商规格书核对)

典型输出:
  NAME        SIZE ROTA TRAN   MODEL
  sda       18.2T    1 sata   ST18000NM003D    (Seagate Exos, HDD)
  nvme0n1   3.84T    0 nvme   Samsung MZQL23T8HCLS-00A07 (NVMe SSD)

加 FSTYPE/MOUNTPOINT 看挂载情况:
```
lsblk -o NAME,SIZE,ROTA,TRAN,FSTYPE,MOUNTPOINT,MODEL
```

----------------------------------------------------------------
A.1.3 完整拓扑 (含 LVM / dm 设备)
----------------------------------------------------------------
```
lsblk -o NAME,TYPE,SIZE,ROTA,TRAN
# TYPE=disk 物理盘
# TYPE=part 分区
# TYPE=lvm  LVM 逻辑卷
# TYPE=dm   device-mapper (LVM / LUKS / dm-cache 等都是 dm)
```

看反向映射 (哪个物理盘撑起这个 LV):
```
lsblk -t
# 或单 LV:
lsblk /dev/vg0/data_lv
```

----------------------------------------------------------------
A.1.4 与选型决策的连接
----------------------------------------------------------------

  看到 ROTA=1,TRAN=sata   → HDD (走 NVMe 测试无意义)
  看到 ROTA=0,TRAN=sata   → SATA SSD (SATA 600MB/s 带宽上限)
  看到 ROTA=0,TRAN=nvme   → NVMe SSD (候选重点测试对象)
  看到 MODEL 含 Optane     → 已停产产品 (新品不选)

================================================================
A.2 smartctl — HDD/SATA SSD 的 SMART 读数
================================================================

----------------------------------------------------------------
A.2.1 安装
----------------------------------------------------------------
```
# Debian/Ubuntu
apt-get install smartmontools

# RHEL/CentOS
yum install smartmontools
```

----------------------------------------------------------------
A.2.2 启用 SMART (新盘默认开启,某些 RAID 卡需显式开)
----------------------------------------------------------------
```
smartctl -s on /dev/sda
#   启用 SMART 监控
#   某些 SATA 控制器默认禁用, 必须先 on 才能读到 SMART
```

----------------------------------------------------------------
A.2.4 查看所有属性 (-a 即 ALL)
----------------------------------------------------------------
```
smartctl -a /dev/sda
```
原文: md:1280
输出分两段:
  ① INFORMATION SECTION      设备型号/序列号/固件版本
  ② SMART attributes (ID #, ATTRIBUTE_NAME, FLAG, VALUE, WORST, THRESHOLD, TYPE, UPDATED, WHEN_FAILED, RAW_VALUE)
  ③ SMART self-test log status   上一次自检结果

----------------------------------------------------------------
A.2.5 关键属性速查 (原文告警阈值见 F 类)
----------------------------------------------------------------

属性 ID  名称                  介质       告警值        物理含义
─────────────────────────────────────────────────────────────────
5        Temperature_Celsius    通用       > 55°C        工作温度
5        Reallocated_Sector_Ct HDD/SSD    > 10          已重映射坏块, 磁介质退化
10       Spin_Retry_Count       HDD       > 0           马达/寻道故障征兆
187     Reported_Uncorrect     HDD/SSD   > 0           上报未纠正错误
188     Command_Timeout        HDD/SSD   > 0           命令超时次数
196     Reallocated_Event_Count 部分 SSD   > 0           重映射事件计数
197     Current_Pending_Sector  HDD       > 0           待重映射扇区 (亚健康)
198     Offline_Uncorrectable   HDD       > 0           离线不可纠正
199     UDMA_CRC_Error_Count   HDD       > 0           数据线干扰 / 接触不良
177     Wear_Leveling_Count    SSD       剩余值<10%     磨损均衡状态 (Intel SSD)
173     Wear_Leveling_Count    SSD       寿命计        (三星 SSD 用这个 ID)
231     SSD_Life_Left          SSD       < 10%         (SandForce 系)

按 ID 取属性:
```
smartctl -A /dev/sda
# 等价于 -a 中 attributes 那段
# 适合脚本解析
```

----------------------------------------------------------------
A.2.6 触发自检 (原文 F 类扩展项)
----------------------------------------------------------------
原文未列出, 但选型时常用:
```
smartctl -t short /dev/sda       # 短自检, ~2 分钟
smartctl -t long /dev/sda        # 长自检, 数小时, 扫全盘
smartctl -t conveyance /dev/sda  # 搬运自检
smartctl -t offline /dev/sda     # 离线自检, 立刻执行

# 查看自检进度
smartctl -l selftest /dev/sda
# 或
smartctl -l selftest -l error /dev/sda
```

----------------------------------------------------------------
A.2.7 RAID 卡后的设备如何读 SMART
----------------------------------------------------------------

硬件 RAID 卡 (MegaRAID / HPE Smart Array) 默认透传:
```
smartctl -a /dev/sg0     # 用 sg 设备
# 或
smartctl -a -d megaraid,0 /dev/sda    # 物理盘 0
smartctl -a -d megaraid,1 /dev/sda    # 物理盘 1
```

================================================================
A.3 nvme-cli — NVMe SSD 的"SMART + 更多"
================================================================

原文: md:1283  nvme smart-log /dev/nvme0n1

NVMe 没有传统 SMART (ATA), 但 nvme-cli 提供的 smart-log
比 SMART 字段更丰富, 而且是 SSD 内部计数器, 比 SMART 准确

----------------------------------------------------------------
A.3.1 安装
----------------------------------------------------------------
```
apt-get install nvme-cli      # Debian/Ubuntu
yum install nvme-cli          # RHEL/CentOS
```

----------------------------------------------------------------
A.3.2 nvme smart-log 详解
----------------------------------------------------------------
```
nvme smart-log /dev/nvme0n1
```
输出字段 (与原文 md:1283-1289 严格对应):
  critical_warning            致命警告位图 (00h 健康)
  temperature                  当前温度 (°C)
  available_spare              剩余备用块比例 (%)
  available_spare_threshold    备用块告警阈值
  percentage_used              已用寿命比例 (%), 100 表示已到寿命
  endurance_grp_critical_warning_summary
  data_units_read              读数据量 (1000 × 512B 单元)
  data_units_written           写数据量 (用于推算 DWPD)
  power_on_hours               通电累计小时
  unsafe_shutdowns             非安全关机次数
  media_errors                 介质错误 (任何 >0 都要查)
  num_err_log_entries          错误日志条目数
  warning_temp_time            温度超阈累计时间 (min)
  critical_compliance_time     致命温度持续时间 (min)

----------------------------------------------------------------
A.3.3 关键告警项 (与原文 md:1284-1289 + md:1314 一致)
----------------------------------------------------------------

  关注字段                    告警值        工程意义
  ─────────────────────────────────────────────
  percentage_used             > 80%         寿命过半, 计划替换
  available_spare             < 10%         备用块告急, 替换在即
  media_errors                > 0           物理介质出错, 立即换
  num_err_log_entries         > 0           有错未查, 排查 nvme get-log
  warning_temp_time           持续非零      散热不足, 检查风道
  temperature                 ≥ 70°C        接近节流阈值

----------------------------------------------------------------
A.3.4 NVMe 其它常用子命令
----------------------------------------------------------------
```
nvme list                       # 列出所有 NVMe 设备
nvme id-ctrl /dev/nvme0n1       # 控制器 identify, 看 PCIe 宽度/速率
nvme id-ns /dev/nvme0n1         # 命名空间 identify, 看容量/格式化
nvme get-log /dev/nvme0n1 --log-id=1   # 错误日志
nvme get-log /dev/nvme0n1 --log-id=2   # SMART/健康日志 (同 smart-log)
nvme fw-log /dev/nvme0n1        # 固件日志
nvme reset /dev/nvme0n1         # 控制器复位 (危险, IO 中断)
nvme format /dev/nvme0n1n1 --lbaf=0   # 低级格式化, 清盘
nvme read /dev/nvme0n1n1 -z 4096 -s 0 -d /tmp/dump.bin   # 直接读扇区
nvme write /dev/nvme0n1n1 -z 4096 -s 0 -d /tmp/dump.bin  # 直接写扇区
```

----------------------------------------------------------------
A.3.5 与 SMART 工具的差别
----------------------------------------------------------------

SMART (smartctl)   ATA 命令集     通用 HDD/SATA SSD    标准字段少
nvme smart-log      NVMe Admin     NVMe SSD              SSD 内部计数器
                   更准

实战建议:
  NVMe 盘 → 以 nvme smart-log 为主
  SATA SSD/HDD → smartctl -A
  Optane (存量) → smartctl -A + 厂商工具

================================================================
A 类常见坑
================================================================

1. 设备名漂移
   重启后 /dev/sda 可能变成 /dev/sdb (尤其多盘机器)
   → 用 /dev/disk/by-id/ 或 /dev/disk/by-uuid/ 持久化
   ```
   ls -l /dev/disk/by-id/
   # ata-Samsung_SSD_980_PRO_2TB_S5GXNG0M812345
   # nvme-Samsung_SSD_980_PRO_2TB_S5GXNG0M812345
   ```

2. NVMe 设备是 /dev/nvme0n1, 不是 /dev/nvme0
   → 多分区是 nvme0n1p1, nvme0n1p2

3. 虚拟化环境中 smartctl 读不到真实盘
   → VMware: /dev/sda 透传
   → KVM virtio-blk: 读到的是 host 缓存, 不准
   → 云厂商 EBS: 走厂商监控 API, 不靠 smartctl

================================================================
A 类命令 → 决策节点
================================================================

lsblk        看清手头有几块盘, 介质类型
smartctl     HDD/SATA SSD 健康度 (Reallocated / Temperature)
nvme         NVMe 寿命 (percentage_used) + 健康 (media_errors)
             ↓
             进入 B 类: 五段式 fio 压测验证规格