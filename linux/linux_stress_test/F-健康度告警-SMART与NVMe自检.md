# F. 健康度/告警 — SMART 自检与触发

原文依据: quant67/storage 06-storage-media-selection.md
  md:1279-1290  SMART 与 NVMe 读数
  md:1307-1315  告警阈值表

================================================================
F.0 命令在选型后生命周期的位置
================================================================

  设备上线后必须做的事:
  ① 周期采集 SMART (月/周)
  ② NVMe 寿命预警 (percentage_used)
  ③ 阈值告警触发替换决策

================================================================
F.1 SMART 健康读数 (HDD/SATA SSD)
================================================================

原文: md:1279
```
smartctl -a /dev/sda
```

----------------------------------------------------------------
F.1.1 采集脚本化
----------------------------------------------------------------
```
# 单次采集
smartctl -a /dev/sda -l selftest

# 关键属性 (脚本解析用)
smartctl -A /dev/sda

# 仅健康状态
smartctl -H /dev/sda
# PASSED / FAILED!

# 一次采所有设备
for dev in /dev/sd? /dev/nvme?n1; do
    echo "=== $dev ==="
    smartctl -H "$dev" 2>/dev/null
done
```

----------------------------------------------------------------
F.1.2 SMART 属性 ID 与告警 (原文 md:1307-1315 + 扩展)
================================================================

  ID  名称                     HDD 告警     SSD 告警       物理含义
  ─────────────────────────────────────────────────────────────────
  5   Reallocated_Sector_Ct    > 10         > 0            已重映射坏块
  10  Spin_Retry_Count         > 0          N/A            马达/寻道问题
  187 Reported_Uncorrect       > 0          > 0            未纠正错误计数
  188 Command_Timeout          > 0          > 0            命令超时
  196 Reallocated_Event_Count  > 0          > 0            重映射事件计数
  197 Current_Pending_Sector   > 0          N/A            待重映射 (亚健康)
  198 Offline_Uncorrectable    > 0          N/A            离线不可纠正
  199 UDMA_CRC_Error_Count     > 0          N/A            数据线干扰
  177 Wear_Leveling_Count      N/A          剩余<10%       SSD 寿命 (Intel)
  173 Wear_Leveling_Count      N/A          剩余<10%       SSD 寿命 (三星)
  231 SSD_Life_Left            N/A          < 10%          SSD 寿命 (SandForce)

⚠️ 厂商 ID 不统一
  - 不同厂商同一物理量用不同 ID
  - 关键是看 RAW_VALUE 与"该厂商标准值"的差值

----------------------------------------------------------------
F.1.3 触发自检 (原文 F 类扩展项)
================================================================

用途: 主动验证硬盘健康, 类似 fsck
原文 md:1280 列了 smartctl -a, 这里展开 -t 子命令

```
# 短自检 (~2 分钟)
smartctl -t short /dev/sda

# 长自检 (数小时, 扫全盘)
smartctl -t long /dev/sda

# 搬运自检 (测试运输后是否损坏)
smartctl -t conveyance /dev/sda

# 离线自检 (立刻执行, 不影响前台)
smartctl -t offline /dev/sda
```

查看自检结果:
```
smartctl -l selftest /dev/sda
# 输出 (例):
# Num  Test              Status                 Remaining
# # 1  Short offline     Completed without error   00%
# # 2  Long offline      Completed with errors     40%

smartctl -l selftest -l error /dev/sda
# 同时看错误日志
```

定时自检 (cron):
```
# 每周日 02:00 长自检
0 2 * * 0 /usr/sbin/smartctl -t long /dev/sda
```

================================================================
F.2 NVMe 健康读数
================================================================

原文: md:1283
```
nvme smart-log /dev/nvme0n1
```

----------------------------------------------------------------
F.2.1 关键字段 (原文 md:1284-1289)
================================================================

  percentage_used            SSD 寿命消耗百分比
                             → 100 表示已到额定寿命
                             → 建议告警阈值: > 80%

  available_spare            剩余备用块百分比
                             → 备用块耗尽后无法替换坏块
                             → 建议告警阈值: < 10%

  media_errors               介质错误
                             → 任何 >0 都应立即排查
                             → 表示 NAND 物理层出错

  num_err_log_entries        错误日志条目数
                             → >0 表示有错误未查
                             → 用 nvme get-log 查

  warning_temp_time          温度超阈累计毫秒
                             → 持续非零 = 散热不足

  critical_compliance_time   致命温度持续时间
                             → 非零表示真出过事

  temperature                当前温度 (°C)
                             → 接近节流温度会降速

----------------------------------------------------------------
F.2.2 NVMe 告警阈值表 (原文 md:1314 + 扩展)
================================================================

  指标                      告警阈值           含义
  ───────────────────────────────────────────
  percentage_used            > 80%             计划替换窗口
  available_spare            < 10%             备用块告急
  media_errors               > 0               介质坏
  num_err_log_entries        > 0               有错未查
  warning_temp_time          持续非零          散热问题
  temperature                ≥ 70°C            节流边缘

----------------------------------------------------------------
F.2.3 NVMe 深度自检 (原文扩展)
================================================================

NVMe 自检通过 nvme 工具触发:
```
# 短期自检 (短时, 类比 smartctl -t short)
nvme device-self-test /dev/nvme0n1 --namespace-id=1 --self-test-code=1

# 长期自检 (长时, 类比 smartctl -t long)
nvme device-self-test /dev/nvme0n1 --namespace-id=1 --self-test-code=2

# 查看结果
nvme self-test-log /dev/nvme0n1 --namespace-id=1
```

----------------------------------------------------------------
F.2.4 NVMe 持久事件日志
================================================================
```
nvme get-telemetry-log /dev/nvme0n1 --output-file=/tmp/nvme-telem.bin
# 持久事件日志: 温度/读/写/错等
# 可发厂商做 RMA 前的证据
```

================================================================
F.3 统一告警阈值表 (原文 md:1307-1315)
================================================================

  指标                          HDD 告警阈值          SSD 告警阈值
  ─────────────────────────────────────────────────────────────────
  平均读延迟 (r_await)          > 20 ms              > 1 ms
  P99 读延迟 (iostat 看不到)    > 50 ms              > 5 ms
  设备利用率 (%util)            > 90% 持续 5min      > 95% 持续 5min
  SMART Reallocated_Sectors     > 10                 N/A
  SMART Spin_Retry_Count        > 0                  N/A
  SSD percentage_used           N/A                  > 80%
  SSD available_spare           N/A                  < 10%
  NVMe temperature              ≥ 55°C               ≥ 70°C

================================================================
F.4 触发替换的决策树
================================================================

  SMART Reallocated > 10?
    → 是 → 立即替换, 数据迁移走 E 类

  Spin_Retry > 0?
    → 是 → 立即替换 (HDD 机械故障征兆)

  NVMe percentage_used > 80%?
    → 是 → 90 天内计划替换
         进入"高警戒", 加快 SMART 频率

  NVMe available_spare < 10%?
    → 是 → 30 天内替换

  NVMe media_errors > 0?
    → 是 → 立即替换

  iostat r_await 超阈值 (持续 5min)?
    → 是 → 容量已饱和, 走 E 类扩 SSD

================================================================
F.5 自检消耗与权衡
================================================================

  HDD 长自检           几乎无消耗 (磁介质读)
  SSD 自检              消耗 P/E 循环 (每次扣寿命)
  NVMe 自检             消耗 P/E 循环 (短期自检消耗少)

建议:
  HDD 月度长自检
  SSD 季度短期自检
  NVMe 季度短期自检 + 半年长期自检

================================================================
F.6 推荐监控频率
================================================================

  设备类型     监控内容                频率
  ────────────────────────────────────────
  HDD        SMART 关键属性             每日
  HDD        长自检                     每月
  SSD        SMART + wear leveling      每周
  SSD        短期自检                   季度
  NVMe       nvme smart-log             每日
  NVMe       短期自检                   季度
  NVMe       长期自检                   半年

================================================================
F.7 自动化巡检 — 综合脚本
================================================================

已就绪的脚本: scripts/storage_health_check.sh
位于 /home/obsidian/linux/linux_stress_test/scripts/

执行:
```
sudo /home/obsidian/linux/linux_stress_test/scripts/storage_health_check.sh
```
输出: NVMe + HDD + SSD 三段 SMART + iostat 快照
退出码: 0 健康, 1 有告警, 2 依赖缺失

cron 化:
```
# /etc/cron.d/storage-health
0 6 * * * root /home/obsidian/linux/linux_stress_test/scripts/storage_health_check.sh >> /var/log/storage_health.log 2>&1
# 每天早 6 点
```

================================================================
F 类命令 → 决策节点 (闭环)
================================================================

  SMART 巡检
     ↓
  指标超阈值 → 触发替换决策
     ↓
  走 E 类迁移到新盘
     ↓
  上线后纳入新一轮 F 类巡检