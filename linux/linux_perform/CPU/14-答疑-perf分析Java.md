# 14 | 答疑：如何用 perf 分析 Java 程序？

原文：[time.geekbang.org/column/article/73738](https://time.geekbang.org/column/article/73738)

CPU 篇核心工具：会 `perf record` + `perf report` 就够入门。内核符号看不懂可以先跳过。

## 1. 只看到十六进制地址，没有函数名

看界面最底下的警告，常见：

```text
Failed to open /opt/bitnami/php/lib/php/extensions/opcache.so, continuing without symbols
```

perf 找不到依赖库的符号。容器应用的库都在镜像里，宿主机上尤其容易这样。二进制被 `strip` 掉符号表也会只剩地址——磁盘够大，建议编译时保留符号。

四个办法（前两个一般不推荐）：

| 方法 | 做法 | 注意 |
|------|------|------|
| 宿主机拼同样路径的库 | 可行 | 麻烦，还污染主机 |
| 容器里跑 perf | 要特权；或把 `perf_event_paranoid` 改成 `-1` | 安全风险 |
| `--symfs` 指到容器根 | `bindfs /proc/$PID/root /tmp/foo` 再 `perf report --symfs /tmp/foo` | 要 bindfs ≥ 1.13.10；用完 umount |
| 宿主机 `record`，容器里 `report` | 把 `perf.data` `docker cp` 进去 | **最常用** |

推荐流程：

```bash
perf record -g -p <pid>    # 采十几秒后 Ctrl+C
docker cp perf.data phpfpm:/tmp
docker exec -it phpfpm bash
apt-get update && apt-get install -y linux-perf procps
perf_4.9 report            # 用镜像里装的版本，不要用跟内核绑死的 perf 软链
```

Debian 容器：`apt-get install -y linux-perf`  
Ubuntu 宿主机：`linux-tools-common linux-tools-generic linux-tools-$(uname -r)`

容器里 `kptr_restrict` 限制内核地址时：

```bash
echo 0 > /proc/sys/kernel/kptr_restrict
```

## 2. 分析 Java

JVM 自己管栈，系统层只能看到 JVM 函数，看不到 Java 方法名。

- perf_events 支持 JIT，但需要 `/tmp/perf-PID.map` 做符号翻译（可用 perf-map-agent 生成）
- 要完整调用栈，JDK 加 `-XX:+PreserveFramePointer`
- 细节看 Netflix 博客 *Java in Flames*

先抓整体分析思路，不要一上来陷进某门语言的工具细节。原理在各语言里是通的。

## 3. 很多符号没有调用栈

`perf report -g` 默认阈值 **0.5%**。事件占比低于这个值就不展开。第 08 讲 app 只有 0.34%，所以看不到栈。

```bash
perf report -g graph,0.3    # 阈值降到 0.3%
```

`-g` = `--call-graph`，默认大致是 `graph,0.5,caller,function,percent`。细节 `man perf-report`。

## 4. 怎么读 report：为什么忽略 99% 的 swapper

这里的 **swapper 不是 SWAP 分区**。系统初始化后它变成最低优先级的空闲任务：CPU 没事干就跑它。展开栈会看到时间都在 `do_idle`。

多任务系统里，**次数多 ≠ 瓶颈**。所以案例里丢掉 99% 的 swapper，去看 0.3% 的 app。这也是为什么不能一上来只跑 perf：要多个指标交叉验证。

| 列 | 含义 |
|----|------|
| Self | 这个函数自己 |
| Children | 它直接/间接调用的子函数合计 |

工具本身也有开销：perf 这类动态追踪会有损失（对时钟特别敏感的应用可能很伤）；`vmstat` / `pidstat` 读 `/proc`，基本无额外损耗。

## 5. 书和资料

- Brendan Gregg《Systems Performance》（中译《性能之巅》）
- 个人站点：[brendangregg.com](http://www.brendangregg.com/) 的 Linux Performance 页（工具图谱、演讲）

第一遍看不懂正常。先抓主线：原理 → 分析思路 → 再抠细节。
