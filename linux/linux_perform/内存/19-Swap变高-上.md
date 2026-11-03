# 19 | 为什么 Swap 变高了（上）

原文：[time.geekbang.org/column/article/75797](https://time.geekbang.org/column/article/75797)

内存紧了两条路：**回收** 或 **OOM**。本讲讲回收，特别是 Swap。

## 能回收什么

| 类型 | 是什么 | 怎么收 |
|------|--------|--------|
| 文件页 | Cache、Buffer、文件映射页 | 干净页直接丢，下次从盘再读；脏页先 `fsync` 或 `pdflush` 写回 |
| 匿名页 | 堆等动态分配、没有文件托底 | 不能直接丢，只能 **Swap 换出** |

Swap = 一块盘或一个本地文件当内存用。换出：不常用的匿名页写盘、腾内存；换入：再访问时读回来。磁盘远慢于内存，Swap 一忙就是性能问题。

现在内存便宜仍有用处：不想立刻被 OOM、笔记本休眠/快开机。多数业务（尤其 Java / Hadoop / ES / K8s）更倾向关掉：GC 扫堆时若页在盘上就是一串磁盘 I/O；K8s 开 Swap 还会让 cgroup 内存上限失效。嵌入式常关，少写 Flash。

关掉：`swapoff`；持久化从 fstab 删掉。**不要指望 `swappiness=0` 禁止 Swap。**

## 什么时候回收

1. **直接回收**：来了大块申请，剩余不够，当场收
2. **kswapd0** 定期扫，看三个水位（相对 `pages_free`）：

| 剩余内存位置 | 含义 |
|--------------|------|
| &lt; min | 用户态基本没了，只剩内核能分 |
| min ~ low | 压力大，kswapd0 收到 **high** 才停 |
| low ~ high | 有压力，还能应付新申请 |
| &gt; high | 宽松 |

`min_free_kbytes` 定 min，另外两个算出来：

```text
pages_low  = pages_min * 5/4
pages_high = pages_min * 3/2
```

剩余掉到 **low** 以下就开始定期回收。

## 明明还有空闲也会 Swap：NUMA

每个 Node 有自己的本地内存，再分成 DMA / NORMAL / MOVABLE 等 zone。水位是 **按 zone** 看的，不是整机。一个 Node 紧了，别的 Node 还空着，照样可能 Swap。

```bash
numactl --hardware
cat /proc/zoneinfo    # min/low/high、free、活跃/非活跃匿名页和文件页
```

`zone_reclaim_mode`：

- `0`（默认）：本 Node 不够可以从别的 Node 借，也可以本地回收
- `1/2/4`：只收本地；`2` 可回写脏页；`4` 允许用 Swap 收

## swappiness：倾向，不是百分比

`/proc/sys/vm/swappiness` 0–100：越大越爱换匿名页，越小越爱丢文件页。

即使设成 0，当 **剩余内存 + 文件页 &lt; 页高阈值** 时仍可能 Swap。水位决定**何时**收，swappiness 只影响**先收哪类**。
