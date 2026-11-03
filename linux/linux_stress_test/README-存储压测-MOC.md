# linux_stress_test 存储压力测试目录 (MOC)

来源: 整理自 quant67/storage 06-storage-media-selection 一篇中的 Linux 命令
学习日期: 2026-09-07
定位: 与 linux_perform/IO/ (故障排查视角) 互补,本目录是压测/选型验证视角

================================================================
文件清单 (按命令类别 A-F 排序)
================================================================

A. A-设备画像-选型前基线采集.md       lsblk / smartctl / nvme smart-log
B. B-稳态压测-fio五段式.md            五段式 fio + precondition + sustained
C. C-实时监控-iostat-blktrace-iotop-perf.md   监控告警与细粒度分析
D. D-块层缓存-bcache-dmwritecache-lvmcache.md  bcache / dm-writecache / lvmcache 三方案
E. E-介质迁移-LVM与Ceph在线迁移.md    LVM pvmove / 主从切换 / Ceph crush
F. F-健康度告警-SMART与NVMe自检.md    SMART 自检 + NVMe 自检 + 告警阈值

综合
   01-存储介质选型-Linux命令速查.md    总览,所有命令的一页索引
   README-存储压测-MOC.md               本文件

脚本 (scripts/ 子目录)
   scripts/storage_health_check.sh      SMART+NVMe+iostat 一键巡检 (F 类实践)
   scripts/lvm_migrate_hdd_to_ssd.sh    LVM 在线迁移 HDD→SSD (E 类实践)

================================================================
A-F 选型决策链路
================================================================

         A.设备画像
              ↓
         B.fio五段式压测
            ↓            ↘
         C.监控验证     性能不达标
            ↓              ↓
         达标      (考虑换盘/D类缓存)
            ↓
         D.块层缓存 (可选, 用 SSD 加速 HDD)
            ↓
         E.介质迁移 (旧盘→新盘, 在线)
            ↓
         F.持续巡检 (触发替换决策)

================================================================
本目录与其它目录的分工
================================================================

  linux_perform/IO/    故障排查视角 (慢/卡顿 → 定位 → 优化)
  linux_stress_test/   压测验证视角 (选型 → 压测 → 监控 → 迁移)

两者都涉及 fio/iostat,但侧重点不同:
  perform 用 fio 是为了复现故障 → 优化对比
  stress 用 fio 是为了验证介质规格 → 决定是否采购/上线

================================================================
阅读顺序 (首次接触存储选型)
================================================================

1. 01-存储介质选型-Linux命令速查.md   看总览, 决定从哪类深入
2. 按需选读:
   选型前                → A (设备画像)
   验证新盘规格          → B (fio 五段式)
   上线后定位慢          → C (iostat/blktrace)
   想用 SSD 加速 HDD     → D (三方案对比)
   业务不中断换盘        → E (LVM pvmove)
   上线后周期巡检        → F (SMART 告警)
3. 跑通 scripts/storage_health_check.sh 看本地设备长啥样
4. (如需压测) 在闲置盘上跑五段式 fio (注意 --direct=1 会绕过 Page Cache)
5. (如需迁移) 用 scripts/lvm_migrate_hdd_to_ssd.sh,先在测试环境演练

================================================================
风险提示
================================================================

- 所有 fio --direct=1 --filename=/dev/... 命令直写裸设备,会清除数据,生产环境慎用
- pvmove 期间不要重启,中断后可用 pvmove --abort 恢复
- 触发 NVMe 自检会消耗 SSD 寿命 (有限的 P/E 循环)
- smartctl -t long 短则数分钟长则数小时,生产环境放低峰期

================================================================
覆盖率核对 (vs 原文 21 个核心命令)
================================================================

原文命令                              笔记章节
─────────────────────────────────────────────────
iostat -xz 1                          C.1.2
blktrace -d /dev/nvme0n1 -o trace    C.2.2
blkparse -i trace -d trace.bin        C.2.2
btt -i trace.bin                      C.2.2
blktrace -d /dev/nvme0n1 -o - | blkparse -i - -o trace.txt  C.2.4
smartctl -a /dev/sda                  F.1.1
nvme smart-log /dev/nvme0n1           F.2.1
make-bcache -B /dev/sda -C /dev/nvme0n1p1  D.1.2
echo writeback > /sys/block/bcache0/bcache/cache_mode    D.1.4
dmsetup create cached-disk --table ...                  D.2.2
lvcreate -L 100G -n cache_pool vg0 /dev/nvme0n1p1        D.3.2
lvcreate -L 1G -n cache_meta vg0 /dev/nvme0n1p1          D.3.2
lvconvert --type cache-pool --poolmetadata ...           D.3.3
lvconvert --type cache --cachepool vg0/cache_pool vg0/data_lv  D.3.4
lvs -o+cache_policy,cache_settings,cache_mode            D.3.5
pvcreate /dev/nvme0n1p1                                  E.1.1
vgextend vg0 /dev/nvme0n1p1                              E.1.1
pvmove /dev/sda1 /dev/nvme0n1p1                          E.1.2
vgreduce vg0 /dev/sda1                                   E.1.3
pvremove /dev/sda1                                       E.1.3
ceph osd pool set mypool crush_rule ssd_rule             E.3.2
ceph -s                                                  E.3.3

+ 五段式 fio (原文未列在 21 行去重集内, 但在原文大代码块中): B.2 逐字收录
+ 扩展命令 (iotop / perf / pvremove / lvchange / make-bcache -u 等): 收录于各章节