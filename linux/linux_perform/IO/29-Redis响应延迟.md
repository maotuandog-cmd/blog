# 29 | Redis 响应严重延迟怎么解决？

原文：[time.geekbang.org/column/article/78984](https://time.geekbang.org/column/article/78984)

查询缓存接口要 10 秒。不要把性能完全押在 OS 页缓存上，用 Redis/Memcached 自己管；但 Redis **开了持久化**照样能把延迟打爆。

## 现象：iowait 高，盘却不忙

- top：CPU0 **wa 84%**，redis-server 在 D，内存很空
- `iostat -x`：写约 2.5MB/s，**`%util` = 0**

**iowait ≠ 磁盘瓶颈。** 它只是「CPU 这段时间在等 I/O」的占比。没有别的活干时，一点点 I/O 也能把 wa 抬很高。盘饱和要看 `%util`、await、队列。

`iotop` 里某进程 DISK READ/WRITE 为 0 但 IO> 99%，跟磁盘 `%util` 不是一回事，先 `man iotop`。

## 谁在写

`pidstat -d` → redis-server 在写。`strace -f -T -tt -p` 里频繁 `write` + **`fdatasync`（一次 5ms+）**。`lsof`：fd 7 → `/data/appendonly.aof`。

这就是 AOF：`appendonly` + `appendfsync`。`always` 时每条命令都 `fdatasync`，查询接口里还在 SADD，等于读路径上同步刷盘。

## 处理

按场景改持久化，别默认 `always`：

| 配置 | 行为 |
|------|------|
| `appendfsync always` | 每条命令 fsync，最安全最慢 |
| `everysec` | 每秒一次，常见折中 |
| `no` | 交给 OS |

纯缓存、可丢可重建：关 AOF。`strace` 开销大，只在已经很慢时用来拆调用，别当监控。

nmon 一类监控更适合日常；间隔太大或指标不全时再上机用 top/pidstat 抠细节。
