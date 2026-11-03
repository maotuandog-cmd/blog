# 16 | 怎么理解 Buffer 和 Cache？

原文：[time.geekbang.org/column/article/74633](https://time.geekbang.org/column/article/74633)

`free` 里的 buff/cache 是两者之和。不要靠网文死记，同一指标会随内核/工具版本变。查 `man free`、`man proc`。

## 指标从哪来

都来自 `/proc/meminfo`：

| free 列 | 对应 | 含义 |
|---------|------|------|
| Buffers | `Buffers` | 内核缓冲区，缓存**磁盘块**（裸设备） |
| Cache | `Cached` + `SReclaimable` | 页缓存 + 可回收 Slab |
| buff/cache | 上面两项之和 | |

Slab 拆成：`SReclaimable`（能回收）和 `SUnreclaim`（内存紧也不能收）。

文档写 Buffer「通常不大（20MB 左右）」是老说法，现在可以很大。`vmstat` 的 bi/bo 文档里块按 1KB 计，磁盘分区 block 常见仍是 4KB，别混。

## 文件 vs 磁盘

- **普通文件**：经过文件系统 → 用 **Cache**（Page Cache）
- **块设备 / 分区**（裸 I/O）：跳过文件系统 → 用 **Buffer**

磁盘是块设备，可分区；分区上建文件系统再挂载，才能当普通文件读写。`ls -l` 看类型。

早期 Linux 文件数据会先 Buffer 再 Page Cache（缓存两次）。现在统一了：文件走 Page Cache；非文件走 Buffer。

读写都走缓存，不只写：

| 操作 | 主要涨的是 |
|------|------------|
| 写文件 `dd ... of=/tmp/file` | Cache |
| 写磁盘 `dd ... of=/dev/sdb1` | Buffer（Cache 也会略涨） |
| 读文件 | Cache |
| 读磁盘 | Buffer |

写文件时 Cache 先涨、磁盘 bo 滞后：数据先在页缓存，过一会才刷盘。程序可以在真正落盘前返回。

**实验注意**：往 `/dev/sdb1` 写会毁分区。只有一块盘就别做。清理缓存：

```bash
echo 3 > /proc/sys/vm/drop_caches   # 文件页 + dentry + inode
vmstat 1                            # buff/cache，bi/bo
```

绕开文件系统不一定更快：少一层可能快，但多数情况文件系统缓存让走文件更快。

## 统计「所有进程物理内存」别把 RSS 相加

RSS / SHR 会把共享页（库、代码段、Page Cache 映射）重复算。用 `/proc/<pid>/smaps` 的 **PSS**：私有页 + 共享页按进程数摊。所有进程 PSS 相加才接近真实占用。

socket buffer 算在 Cache 一侧。
