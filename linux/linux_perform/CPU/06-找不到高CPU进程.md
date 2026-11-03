# 06 | 系统 CPU 很高，却找不到高 CPU 的应用？

原文：[time.geekbang.org/column/article/70822](https://time.geekbang.org/column/article/70822)

## 现象

`top` 里 **%us 80%+**，但进程列表里最高才 2～3%，把所有进程 %CPU 加起来也对不上系统使用率。

原因：系统 CPU 使用率还包含 **短时进程**。它们跑完就退出，`top`/`pidstat` 采样间隔抓不住，PID 还一直在变。

## 线索

1. 看 **Tasks: N running**，就绪队列是否异常多  
2. 找状态为 **R** 的进程，不要只看 %CPU 排序  
3. 案例里 R 的是一闪而过的 `stress`，PID 每次不同  
4. `ps`/`pidstat -p` 再查已经没了 → 短时进程或崩溃重启

## 找父进程

```bash
pstree | grep stress
# php-fpm---sh---stress
```

PHP 每个请求 `exec("/usr/local/bin/stress -t 1 -d 1")`。注释说模拟 I/O，实际因权限失败（`mkstemp failed: Permission denied`），大量进程启动即失败，把 **us/sy** 打高，**wa 并不高**。

交叉验证：

```bash
perf record -g -- sleep 15
perf report          # stress 约占 77% 时钟，热点在 random()
```

`perf` 里常出现 **swapper**（idle 线程），跟业务无关，先用 top 缩小范围再 perf。

## 专盯短时进程：execsnoop

基于 ftrace，盯 `exec()`：

```bash
execsnoop
# PCOMM  PID  PPID  RET ARGS
# stress ... /usr/local/bin/stress -t 1 -d 1
```

没有现成包可从 bcc/GitHub 装；老内核可用 SystemTap 类似脚本。

## 小结

系统使用率 = 所有进程用户态/内核态 + 中断 + iowait + 内核线程 + **已消失的短时进程**。  
`top` 对不上时：看 Running 数 → `pstree` → `perf record -g` → `execsnoop`。
