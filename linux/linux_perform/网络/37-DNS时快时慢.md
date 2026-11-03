# 37 | 案例篇：DNS 解析时快时慢，我该怎么办？

原文：[time.geekbang.org/column/article/81850](https://time.geekbang.org/column/article/81850)

DNS 在应用层，底下多用 UDP/53。域名从右往左分层（`time.geekbang.org`：org → geekbang → time），解析靠缓存 + 递归。`nslookup` 通、`ping` 域名失败，往往是解析路径不同（nsswitch / 反向解析）。

## 工具

```bash
cat /etc/resolv.conf          # nameserver
nslookup time.geekbang.org
nslookup -debug ...           # 看实际连的是谁
dig +trace +nodnssec ...      # 根 → TLD → 权威 NS → A 记录
```

本地映射写 `/etc/hosts`。记录类型：A（域名→IP）、CNAME、NS、PTR（反向）。

## 案例 1：容器里解析失败

现象：`connection timed out; no servers could be reached`，但 `ping 114.114.114.114` 通。  
`-debug` 发现在连 `127.0.0.1:53`，因为容器 `/etc/resolv.conf` 是空的。写上 nameserver 就好。

## 案例 2：又慢又偶发超时

容器 `--dns 8.8.8.8`。`ping 8.8.8.8` RTT ~140ms 且丢包 → 换近的 114 后首次仍可能 ~1s。

优化：本机 **dnsmasq** 做缓存，resolv.conf 指 `127.0.0.1`。首次几百 ms，命中后 ~10ms。多数发行版默认没开 DNS 缓存（Ubuntu 18.04+ 除外），dnsmasq 要配 upstream。

污染/劫持：自己控 DNS、HTTPDNS，或干脆用 IP。

## 开发侧优化

1. **缓存**（过期再问）
2. **预取**（浏览器点链接前就解析）
3. **HTTPDNS** 绕开链路里的 DNS，抗劫持
4. **GSLB**：按位置回最近 IP，兼负载和高可用
