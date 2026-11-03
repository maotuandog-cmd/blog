# 11 | 如何迅速分析出系统 CPU 的瓶颈？

原文：[time.geekbang.org/column/article/72685](https://time.geekbang.org/column/article/72685)

CPU 篇总复习 + 实战小抄。不要把所有工具跑一遍。

## 指标清单

| 指标 | 含义 | 高了往哪走 |
|------|------|------------|
| us / ni | 用户态 | 查应用 |
| sy | 内核态（不含中断） | 系统调用、内核线程 |
| wa | 等 I/O | 磁盘 / NFS，不是套接字 |
| si / hi | 软/硬中断 | `/proc/softirqs`、`/proc/interrupts` |
| st / guest | 虚拟化 | 超卖或虚拟机本身 |
| load | 平均活跃进程数 | 对比逻辑核；跟 r/b 对照 |
| 自愿切换 cswch | 等资源 | I/O、锁 |
| 非自愿 nvcswch | 被抢走 | 抢 CPU |
| CPU Cache 命中 | L1/L2/L3 | `perf`；**虚拟机里看不到物理 cache** |

load 理想 ≈ 逻辑 CPU 个数。

## 先跑这三个

`top` + `vmstat` + `pidstat` 几乎覆盖所有关键 CPU 指标。

```bash
top              # us/sy/wa/si、load、zombie、按 1 看每核
vmstat 1         # r/b、cs、in
pidstat -u -w 1  # 进程 us/sy、自愿/非自愿切换
```

关联（文中虚线图的文字版）：

```text
top.us 高 ──► pidstat 找进程 ──► strace / perf
top.load 高 ──► vmstat.r 高 → 回 top/pidstat 找 Running
              ──► vmstat.b 高 → dstat/sar 走 I/O
top.si 高 ──► /proc/softirqs ──► NET_RX 则 sar + tcpdump
进程对不上系统使用率 ──► Running 短时进程 / execsnoop / perf record
```

## 各案例对应工具（过一遍就能回忆）

| 场景 | 工具链 |
|------|--------|
| 负载高 | uptime → mpstat → pidstat |
| 切换多 | vmstat → pidstat -w → pidstat -wt |
| 某进程 100% | top → perf top -g |
| 系统很高找不到进程 | top 看 Running → perf record → execsnoop |
| 大量 D/Z + wa | dstat → pidstat -d → perf（D 变 Z 时 strace 无效） |
| si 高 | watch /proc/softirqs → sar -n DEV → tcpdump |

## 记住

从**指标找工具**，或从**已安装的工具找指标**。具体参数当时 `man`，不必背。先练熟 top / vmstat / pidstat / perf。
