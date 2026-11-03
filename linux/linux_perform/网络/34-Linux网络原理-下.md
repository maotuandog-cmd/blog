# 34 | 关于 Linux 网络，你必须知道这些（下）

原文：[time.geekbang.org/column/article/81057](https://time.geekbang.org/column/article/81057)

## 核心指标

| 指标 | 含义 |
|------|------|
| 带宽 | 链路最大速率，b/s |
| 吞吐量 | 单位时间成功传输量；吞吐/带宽 = 使用率 |
| 延时 | 握手耗时或 RTT，场景不同含义不同 |
| PPS | 包/秒，评转发能力。交换机常线性转发；Linux 转发易受包大小影响 |
| 其他 | 可用性、并发连接数、丢包率、重传率 |

## 网卡配置：`ip` 优于 `ifconfig`

看 `RUNNING` / `LOWER_UP`（物理连通）、MTU、IP/MAC，以及 RX/TX 的 errors、dropped、overruns、carrier、collisions。

| 计数 | 含义 |
|------|------|
| errors | 校验、帧同步等错误 |
| dropped | 已进 Ring Buffer，内存不够等再丢 |
| overruns | I/O 太快，Ring Buffer 来不及处理（队列满） |
| carrier | 双工不匹配、线缆问题 |
| collisions | 碰撞 |

统计是累加值，生产上通常不清；真要清得停网卡并 `rmmod` 驱动。

## 套接字：`ss` 优于 `netstat`

Recv-Q / Send-Q 平时应接近 0，非 0 就是堆积。含义随状态变：

| 状态 | Recv-Q | Send-Q |
|------|--------|--------|
| ESTABLISHED | 应用还没取走的字节 | 对端还没 ACK 的字节 |
| LISTEN | **全连接队列当前长度** | 全连接队列最大长度 |

- 全连接：三次握手完成，等 `accept()`
- 半连接：只收到 SYN，在 `tcp_max_syn_backlog` 管的那条队列（系统级）；`ss` 里 LISTEN 的 Send-Q 是套接字级全连接上限，两者不是同一个数

`netstat -s` 看协议栈细节（重传、失败握手等）；`ss -s` 只给摘要。

## 吞吐和 PPS

```bash
sar -n DEV 1          # rxpck/s txpck/s rxkB/s txkB/s %ifutil
ethtool eth0 | grep Speed   # 带宽，单位是 bit（千兆=1000Mb/s）
```

全双工 `%ifutil` = max(rx, tx) / Bandwidth。

连通性和 RTT 用 `ping`（ICMP）。
