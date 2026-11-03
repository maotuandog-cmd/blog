# 41 | 案例篇：如何优化 NAT 性能？（上）

原文：[time.geekbang.org/column/article/83189](https://time.geekbang.org/column/article/83189)

NAT 改源/目的 IP。多内网主机共享一个公网 IP，顺带藏内网。可在路由器或 Linux「软路由」上做。Linux NAT 靠 **conntrack**，每条连接都记账，本身就有成本。

## 分类

| 类型 | 映射 |
|------|------|
| 静态 NAT | 内网 IP ↔ 公网 IP 永久一对一 |
| 动态 NAT | 从公网池里临时挑一个 |
| **NAPT**（最常见） | 内网 IP 映射到同一公网 IP 的不同端口 |

NAPT 再分：

- **SNAT**：改源。多内网出公网。链：`nat/POSTROUTING`
- **DNAT**：改目的。公网端口进内网服务。链：`nat/PREROUTING`（转发包）或 `OUTPUT`（本机发出）
- **双向**：SNAT+DNAT，虚机浮动公网 IP 那种一对一

回程不必再配一条对称规则：conntrack 记得这条连接，回来自动改回去。NAT **挡不住**应用层漏洞。

## iptables 表/链

Netfilter：filter / nat / mangle / raw。包按固定顺序过表和链。conntrack 是状态过滤（`-m state`）和 NAT 的底。

```bash
# MASQUERADE：子网统一 SNAT，出口 IP 由内核选
iptables -t nat -A POSTROUTING -s 192.168.0.0/16 -j MASQUERADE

# 指定源
iptables -t nat -A POSTROUTING -s 192.168.0.2 -j SNAT --to-source 100.100.100.100

# DNAT
iptables -t nat -A PREROUTING -d 100.100.100.100 -j DNAT --to-destination 192.168.0.2

sysctl -w net.ipv4.ip_forward=1   # 转发必须开，写入 sysctl.conf
```

MASQUERADE 端口冲突也能工作（用五元组区分）。量一大会打满 conntrack、fd、端口，软路由自己先撑死。NAT 环境下 **禁止 `tcp_tw_recycle`**（4.12 已删）。
