# 42 | 案例篇：如何优化 NAT 性能？（下）

原文：[time.geekbang.org/column/article/83520](https://time.geekbang.org/column/article/83520)

Docker `-p` 就是 DNAT。host 网络 vs `-p 8080:8080`：ab 5000 并发时 host 约 6500 QPS，DNAT 直接超时；拉长超时后只剩 76 QPS、延迟 65s。conntrack 是全局的，不算进 netns。

## 定位

1. `dmesg` 出现 `nf_conntrack: table full, dropping packet`
2. SystemTap 盯 `kfree_skb`：大量丢在 `nf_hook_slow`
3. `perf record -a -g` 展开：`ipv4_conntrack_in`（查/分配跟踪）、`br_nf_pre_routing`（容器网桥）、`iptable_nat_ipv4_in`（DNAT）

## 关键参数

```bash
sysctl -a | grep conntrack
# nf_conntrack_count   当前
# nf_conntrack_max     上限（案例默认 1000，5000 并发必满）
# nf_conntrack_buckets 哈希桶数
```

哈希表：桶数 = buckets，平均链长 ≈ max/buckets。内存约 `max*376 + buckets*16` 字节。

案例把 max 调到 131072 后 QPS 回到 ~6300，仍略差于 host（Connect 355ms vs 177ms）。Docker 不一定走 NAT：`--network=host` 就没有。

```bash
conntrack -L -o extended | wc -l
conntrack -L -o extended | awk '/tcp/ {sum[$6]++} END {for(i in sum) print i,sum[i]}'
```

压测时大量 **TIME_WAIT**，默认 `nf_conntrack_tcp_timeout_time_wait=120`，连接多就该缩短。

## 优化方向

- 调大 max/buckets，缩短各状态超时
- 业务机若不用状态过滤，可避免加载 conntrack（iptables 用到状态规则仍会拉起来）
- 固定映射、不必动态跟踪 → **无状态 NAT**（tc / DPDK）
- 多容器 SNAT 抢本地端口可能偶发 1s/3s 延迟（非事务插入 conntrack）
