# 38 | 案例篇：怎么使用 tcpdump 和 Wireshark 分析网络流量？

原文：[time.geekbang.org/column/article/82321](https://time.geekbang.org/column/article/82321)

套路：**服务器上 tcpdump 抓，本机 Wireshark 看**。tcpdump 基于 libpcap / `AF_PACKET`。

## ping 很慢但 RTT 不大

`ping -c3 geektime.org` 三次 ICMP 各 ~30ms，汇总却 **11s**。`nslookup` 只要 44ms，不是 A 记录慢。

```bash
tcpdump -nn udp port 53 or host 35.190.27.188
```

抓到：A 查询很快 → ICMP 正常 → **两次 PTR 反向解析发出后没应答，各卡 5s**。很多 IP 没 PTR，工具默认反查名字就会拖死。

解决：`ping -n`（网络工具普遍有 `-n`/`-nn` 关名称解析）。  
案例里用 iptables 丢掉含 `googleusercontent` 的 UDP/53 响应，就是在模拟 PTR 超时。

## tcpdump 常用

格式：`时间戳 协议 源.端口 > 目的.端口 详情`

| 选项 | 作用 |
|------|------|
| `-nn` | 不反解 IP/端口 |
| `-i eth0` | 网卡 |
| `-w file.pcap` | 存盘给 Wireshark |
| `-c N` | 抓 N 个就停 |
| `-v/-vv` | 更详细解码 |

过滤（pcap-filter）：`host`、`net`、`port`/`portrange`、`tcp`/`udp`/`icmp`、`src`/`dst`，用 `and`/`or`/`not` 组合。例：`tcpdump -nn host example.com -w web.pcap`。

## Wireshark

着色区分协议；点包看各层头；Statistics → Flow Graph → TCP Flows 看握手/挥手。

HTTP 例：三次握手 → 请求/响应 → 断开。实际常是 **三次挥手**（服务端把 ACK+FIN 合并）；数据没发完才会先 ACK 再 FIN（四次）。

HTTPS：有私钥才能解；否则 MitM。无图形界面可用 tshark。
