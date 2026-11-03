# 49 | 案例篇：内核线程 CPU 利用率太高，我该怎么办？

原文：[time.geekbang.org/column/article/86330](https://time.geekbang.org/column/article/86330)

用户态祖先是 PID 1（systemd）；内核线程祖先是 **PID 2 `kthreadd`**。CMD 带中括号的就是内核线程。`strace`/`pstack`/`lsof` 对它们基本没用。

```bash
ps -f --ppid 2 -p 2
ps -ef | grep '\[.*\]'
```

| 线程 | 干什么 |
|------|--------|
| ksoftirqd/N | 每 CPU 一个，跑软中断 |
| kswapd0 | 回收内存 |
| kworker/CPU:ID 或 kworker/uPOOL:ID | 工作队列（绑定 / 不绑定） |
| migration/N | 负载均衡迁进程 |
| jbd2/sda1-8 | ext4 日志 |
| pdflush | 脏页回写（3.10 后并进 kworker） |

高并发时 ksoftirqd 升高，多半是收发包软中断。案例：hping3 打 Nginx，`si` ~30%，top 里最高就是 ksoftirqd。`/proc/pid/stack` 只能看到 `smpboot_thread_fn`。

## perf + 火焰图

```bash
perf record -a -g -p 9 -- sleep 30
perf report
# 生成火焰图
perf script -i perf.data | ./stackcollapse-perf.pl --all | ./flamegraph.pl > ksoftirqd.svg
```

读图：横轴=采样占比（同层按字母排，颜色无含义）；纵轴=调用栈，下是父函数。on-CPU 图只算真正占 CPU 的时间，不含睡眠。点函数可放大；完整流程不在一根柱子里，TCP/conntrack 可能在旁边小火苗。

本案例热点：`net_rx_action` → `netif_receive_skb` → 网桥 `br_handle_frame` → `br_nf_pre_routing`（DNAT）→ 再收一次 → `ip_forward` 发出。Docker 自动建 veth、docker0、NAT，包要过桥和 netfilter 两遍。

其他图：off-CPU（等 I/O/锁）、内存（如 `perf record -e syscalls:sys_enter_mmap -a -g`）、热/冷、差分（红涨蓝跌）。Go 用内置 pprof 更省事。
