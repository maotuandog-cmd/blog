# 39 | 案例篇：怎么缓解 DDoS 攻击带来的性能下降问题？

原文：[time.geekbang.org/column/article/82573](https://time.geekbang.org/column/article/82573)

到了机器上只能**缓解**，清不掉。标题是「缓解」不是「解决」。

## 三类打法

| 类型 | 打什么 |
|------|--------|
| 耗尽带宽 | 链路灌满，正常包过不去。流量型只能在机房外清洗 |
| 耗尽 OS | CPU/内存/连接表打满 |
| 耗尽应用 | 大量无效请求占逻辑；慢速 DDoS 流量不一定大 |

已知峰值：GitHub 1.35Tbps / 1.26 亿 PPS。

## 案例：SYN Flood

`hping3 -S -p 80 -i u10 <目标>`（可加 `--flood` / `--rand-source`）。正常 curl 从 2ms 变成 10s 超时。

排查：

```bash
sar -n DEV 1          # PPS 两万但 BPS 才 1MB → 约 54B 小包
tcpdump -i eth0 -n tcp port 80   # Flags [S] 海量 SYN
netstat -n -p | grep SYN_REC     # 半开 SYN_RECV
```

源 IP 固定时可 `iptables -I INPUT -s ... -p tcp -j DROP`（REJECT 还要回 ICMP，更费资源）。源随机则限速：

```bash
iptables -A INPUT -p tcp --syn -m limit --limit 1/s -j ACCEPT
iptables -I INPUT -p tcp --dport 80 --syn -m recent --name SYN_FLOOD --update --seconds 60 --hitcount 10 -j REJECT
```

## 事先调内核（写入 `/etc/sysctl.conf` 后 `sysctl -p`）

```text
net.ipv4.tcp_max_syn_backlog = 1024   # 半连接队列，默认常 256
net.ipv4.tcp_synack_retries = 1       # SYN+ACK 重试，默认 5
net.ipv4.tcp_syncookies = 1           # 用 cookie 当序号，不再占半连接；开了 backlog 失效
```

PPS 极大时内核协议栈本身就是负担 → XDP/DPDK 在进栈前丢掉。带宽打满只能靠运营商/高防/清洗设备。

应用层：缓存、WAF、CDN。多队列绑核能摊 softirq，但会多占 CPU。
