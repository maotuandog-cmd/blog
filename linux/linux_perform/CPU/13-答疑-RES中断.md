# 13 | 答疑：无法模拟 RES 中断怎么办？

原文：[time.geekbang.org/column/article/73381](https://time.geekbang.org/column/article/73381)

CPU 篇练习踩坑集。工具是手段，指标才是对象。看不懂输出先 `man`。

## 1. pidstat 没有 `%wait`

`%wait` 是 sysstat **11.5.5** 才有的「进程等 CPU 的时间百分比」。CentOS 仓库里的 sysstat 往往更旧，没有这一列。

没有新工具也能查：指标多半来自 `/proc`。学习时尽量用新工具，生产老系统就回 `/proc`。

**不要把 pidstat 的 `%wait` 和 top 的 `wa` 对比。**

| 指标 | 含义 | 进程状态 |
|------|------|----------|
| pidstat `%wait` | 等 CPU | 已在就绪队列，Running |
| top `wa` / iowait | 等块设备 I/O | 不可中断 D |

## 2. `stress -i` 模拟不出 iowait

`-i` 走的是 `sync()`。缓冲区没多少脏数据时，磁盘几乎不忙，SSD 上尤其明显：iowait 一直 0，却因为大量系统调用把 **sy** 打高。

改用 stress-ng，顺带读写临时文件：

```bash
stress-ng -i 1 --hdd 1 --timeout 600
```

## 3. 模拟不出 RES（重调度中断）

RES 是调度器把任务分散到别的 CPU 时用的，靠处理器间中断（IPI）。**只有一个逻辑核时根本不会发生**，所以单核机器上看不到 RES 升高。

上下文切换照样会爆：`cs` 从几百到十几万，非自愿切换尤其高 = 线程在抢 CPU。`pidstat -u -t 1` 常见现象：每个线程 `%wait` 70%+，`%CPU` 不到 10%。

sysbench 参数因版本而异：

```bash
# Ubuntu 18.04
sysbench --threads=10 --max-time=300 threads run

# Ubuntu 16.04
sysbench --num-threads=10 --max-time=300 --test=threads run
```

## 4. I/O 案例有的压死、有的没瓶颈

机器磁盘差太多：HDD / 低端 SSD / 高端 SSD 差几倍到几十倍。作者机器刚好卡在瓶颈；HDD 可能 I/O 使用率长期 100% 甚至系统无响应；好 SSD 可能压不出来。

案例只扫了 `/dev/xvd`、`/dev/sd`。用 `/dev/nvme` 的可能容器启动后马上 exited。新版 app 可指定设备：

```bash
docker run --privileged --name=app -itd feisky/app:iowait \
  /app -d /dev/sdb -s 67108864 -c 20
docker logs app
```

- `-d` 磁盘（默认 sd/xvd 前缀）
- `-s` 每次读多少字节，默认 64MB
- `-c` 每个子进程读几次，默认 20

## 5. vmstat 第一行特别离谱

`man vmstat`：第一行是**开机以来的平均值**；后面几行才是你设的采样间隔。进程和内存那几列始终是瞬时值。

输出不符合常识 → 先查手册，再上网问。不同版本选项含义可能不一样。
