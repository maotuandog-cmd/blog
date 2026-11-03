# 20 | 为什么 Swap 变高了（下）

原文：[time.geekbang.org/column/article/75973](https://time.geekbang.org/column/article/75973)

上讲原理，这讲定位。大文件读把 Buffer 打满时，系统**照样会 Swap 匿名页**，不会只收文件页。

## 开 Swap（文件方式）

```bash
fallocate -l 8G /mnt/swapfile
chmod 600 /mnt/swapfile
mkswap /mnt/swapfile
swapon /mnt/swapfile
free
```

关：`swapoff -a`。持久化还要改 fstab。云主机多数默认 Swap=0，就不会有 si/so。

## 案例：dd 狂读盘

`dd if=/dev/sda1 of=/dev/null bs=1G count=2048` 只有读。

```bash
sar -r -S 1
```

先看内存表、再看 Swap 表（单位 KB）：

| 指标 | 含义 |
|------|------|
| kbcommit / %commit | 进程申请内存之和的估计，防溢出；**不含** buffer/cache。所以可以小于 kbmemused |
| kbactive | 最近用过，不太会收 |
| kbinact | 不常访问，可能被收 |
| kbswpused / %swpused | Swap 占用 |

现象：free 不断变成 Buffer；%memused 到 98% 后 Swap 开始涨，Buffer 和 free 在小范围抖。`cachetop` 对得上：dd 命中约 50%，MISSES 很高。

`watch -d grep -A 15 'Normal' /proc/zoneinfo`：`pages_free` 掉到 **low** 以下会弹回 **high** 以上 —— 回收和 dd 再申请在循环。回收文件页 → Buffer 降；回收匿名页 → Swap 升。

默认 `swappiness=60` 比较中性，有时多收文件页、有时多换匿名页。

## 谁被换出去了

`/proc/<pid>/status` 的 **VmSwap**：

```bash
for file in /proc/+([0-9])/status; do
  awk '/VmSwap|Name|^Pid/{printf $2 " " $3}END{print ""}' $file
done | sort -k 3 -n -r | head
```

（通配写成 `*` 会扫到 `self` 等特殊项。）也可以 `smem --sort swap`。

案例里往往是 dockerd 这类后台被换出，它们再访问这些页就会变慢。

## 怎么把 Swap 用下去

1. **禁止 Swap**（内存够就关；现在云主机默认如此）
2. 必须开就 **降低 swappiness**（倾向，不是开关）
3. 延迟敏感进程用 `mlock()` / `mlockall()` 锁页，不让换出

线上 `swapoff -a && swapon -a` 能清空已换出页，但等于强制换回，内存已经紧时可能更糟。

`swappiness=0` **仍可能 Swap**：剩余 + 文件页不够时还是得换匿名页。没开 Swap 分区/文件，这个参数才彻底无效。
