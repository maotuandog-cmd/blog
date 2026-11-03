# GDB 使用说明 (二) 调试环境与准备

承接: (一) 原理与基本概念
本节聚焦: ptrace 权限 / .gdbinit / 信号句柄 / 多进程调试 / 常见启动模式

================================================================
2.1 ptrace 权限 — 你每次 attach 都会撞到的墙
================================================================

Linux 默认 kernel.yama.ptrace_scope=1, 限制跨进程 attach
本机: 当前 = 1, gdb 已 setcap cap_sys_ptrace=ep → 已解

三种修法对比 (优先 A):

| 修法                                 | 持久 | sudo | 备注                              |
|--------------------------------------|------|------|----------------------------------|
| A. sudo setcap cap_sys_ptrace+ep /usr/bin/gdb | 是   | 一次 | 最干净, 普通用户即可 attach       |
| B. sudo sysctl -w kernel.yama.ptrace_scope=0  | 否   | 每次 | 重启后失效                        |
| C. sudo gdb -p <pid>                          | 否   | 每会话 | 每次提示 sudo, 但无需 setcap      |

----------------------------------------------------------------
2.1.1 检查当前状态
----------------------------------------------------------------
  cat /proc/sys/kernel/yama/ptrace_scope
  # 0 = classic (允许任意 attach)
  # 1 = restricted (默认, 仅同用户父子)
  # 2 = admin only
  # 3 = no attach (容器常见)

  getcap /usr/bin/gdb
  # 输出如: /usr/bin/gdb cap_sys_ptrace=ep → 已修

----------------------------------------------------------------
2.1.2 永久修法 (A)
----------------------------------------------------------------
  sudo setcap cap_sys_ptrace+ep /usr/bin/gdb
  # 之后任何用户都能 attach 同 uid 进程

⚠️ 升级 gdb 后 setcap 会失效, 需重设

================================================================
2.2 .gdbinit — GDB 全局初始化
================================================================

GDB 启动时自动执行 ~/.gdbinit (本机: /home/maotuan/.gdbinit)
不存在时不会报错; 推荐新建一份, 放通用配置。

----------------------------------------------------------------
2.2.1 最小化 .gdbinit
----------------------------------------------------------------
  # ~/.gdbinit

  # 1. 分页: 一屏显示不完时暂停 (默认 on)
  set pagination on
  set height 0

  # 2. 美化输出
  set print pretty on
  set print array on
  set print array-indexes on
  set print symbol-loading full
  set print demangle on

  # 3. 历史
  set history save on
  set history filename ~/.gdb_history
  set history size 10000

  # 4. 编辑模式 (可选)
  # set editing-mode vi

  # 5. 不显示 "Type this sentence..." 启动横幅
  set verbose off

  # 6. GDB 17+: 不自动注册 python pretty printer, 手动加载
  # python ... end (见第七章)

----------------------------------------------------------------
2.2.2 危险全局配置 (新手不要轻易加)
----------------------------------------------------------------
  set confirm off        # 危险操作不二次确认
  set pagination off     # 输出可能刷屏
  set logging file /tmp/gdb.log
  set logging on         # 所有命令记日志 (适合故障排查时)

================================================================
2.3 信号句柄 — attach 不卡死的关键
================================================================

服务端进程 (PG, Redis, MySQL 等) 大量用 SIGUSR1/SIGUSR2/SIGPIPE 做 IPC
GDB 默认会在这些信号停下, 表现为"attach 后进程像卡死"

attach 后立刻执行 (bundled 成 pgsetup / <sys>setup 自定义命令):
  handle SIGUSR1 nostop noprint pass
  handle SIGUSR2 nostop noprint pass
  handle SIGPIPE nostop noprint pass
  set scheduler-locking off

完整信号句柄表:
  handle SIGUSR1 print nostop pass     # 看到但不停
  handle SIGUSR1 noprint nostop pass   # 完全不打扰
  handle SIGUSR1 stop                  # 默认: 停下让你看

恢复默认:
  handle SIGUSR1 print stop pass

查看当前所有信号句柄:
  info signals
  # 或:
  handle

================================================================
2.4 启动模式详解
================================================================

----------------------------------------------------------------
2.4.1 直接调试 (本机程序)
----------------------------------------------------------------
  gdb ./program
  gdb --args ./program arg1 arg2
  # --args 后所有参数原样传给程序

  gdb -batch -ex 'commands' -ex '...' -ex quit ./program
  # -batch 跑完自动退出 (脚本/CI 用)

----------------------------------------------------------------
2.4.2 attach 进程 (在线调试)
----------------------------------------------------------------
  gdb -p <pid>
  # 进入后默认停在 SIGTRAP, 输入 continue 让进程继续

  gdb -batch -p <pid> -ex 'bt' -ex 'info threads' -ex detach -ex quit
  # 取一次快照就跑

⚠️ attach 前确认:
  - 进程非关键 (有主备吗?)
  - 没有 hotfix 中
  - 有 dump 备份吗 (避免 GDB 自己崩溃)

----------------------------------------------------------------
2.4.3 离线 coredump
----------------------------------------------------------------
  gdb ./program core
  gdb -c core -ex bt -ex quit ./program

详情见第六章。

================================================================
2.5 follow-fork-mode — 调试 fork 子进程
================================================================

多进程服务 (nginx / gunicorn) 用 fork 派生子进程, 默认 GDB 跟父进程

  set follow-fork-mode child      # 跟子进程
  set follow-fork-mode parent     # 跟父进程 (默认)
  set detach-on-fork on           # fork 时 GDB 释放另一个
  set detach-on-fork off          # fork 时 GDB 同时调试两个

查看子进程:
  info inferiors
  inferior <num>                  # 切换当前 inferior
  detach inferior <num>           # 释放

================================================================
2.6 工作目录与文件路径
================================================================

调试程序加载的 .so / 配置文件路径可能跟启动时不一样

  set cwd /path/to/workdir
  # 切换 inferior 的工作目录

  show env                        # 当前环境变量
  set env LD_LIBRARY_PATH /opt/lib
  set env MY_VAR my_value
  unset env MY_VAR

================================================================
2.7 启动前诊断脚本
================================================================

参考 skill: systems-source-study-with-gdb/scripts/check-gdb-prereqs.sh
  # 用法: ./check-gdb-prereqs.sh /path/to/binary [pid]
  # 检查: GDB 版本 / debug info / ptrace / pretty printer / 目标进程

本机已通过 (GDB 17.1, gdb 有 setcap cap_sys_ptrace=ep)

================================================================
2.8 实用启动模式合集
================================================================

| 场景                        | 命令                                                |
|----------------------------|----------------------------------------------------|
| 普通调试                    | gdb --args ./prog arg1                              |
| 看启动失败                  | gdb -batch -ex 'run' -ex 'bt' ./prog                |
| 看运行中进程栈              | gdb -batch -p $PID -ex 'bt 30' -ex 'detach'         |
| 看所有线程栈                | gdb -batch -p $PID -ex 'thread apply all bt 10'    |
| 看 coredump                 | gdb -c core -batch -ex 'bt' -ex 'info threads' ./prog |
| 远程调试                    | gdb                                              |
|                             |   target remote 192.168.1.10:9999                  |
| 容器内 attach (host 上)    | nsenter -t 1 -m -p -F -- gdb -p <pid_in_container> |

================================================================
2.9 常用 GDB 命令: 启动后第一件事
================================================================

进入 GDB 后, 三个命令最快给你全局视图:
  (gdb) info files                 加载了哪些文件 / 入口地址
  (gdb) info functions             列出所有函数 (正则匹配: info functions my_*)
  (gdb) info variables             列出所有全局变量 (正则匹配)
  (gdb) info address <symbol>      看某符号的地址
  (gdb) info registers             当前寄存器
  (gdb) info threads               当前所有线程
  (gdb) info inferiors             多进程场景

================================================================
2.10 gdbserver — 远程 / 嵌入式调试
================================================================

gdbserver 跑在目标机器 (无 GUI / 资源少), GDB 通过网络连过来:

目标机:
  gdbserver :9999 ./prog arg1
  # 或 attach 到运行中:
  gdbserver :9999 --attach <pid>

调试机:
  gdb
  (gdb) target remote 192.168.1.10:9999
  (gdb) set sysroot /target/root     # 远端文件系统的根
  # 本地有完整源码的话, gdb 会用本地符号表

跨平台 (嵌入式):
  gdb-multiarch -ex 'set sysroot /opt/cross/rootfs' \
                -ex 'target remote 192.168.1.10:9999'

================================================================
2.11 调试容器内进程
================================================================

容器内 GDB 看不到宿主进程; 但宿主 GDB 可 attach 容器内进程:

方案 A: nsenter (直接进容器命名空间)
  PID_IN_CONTAINER=$(docker inspect --format '{{.State.Pid}}' my_container)
  sudo nsenter -t $PID_IN_CONTAINER -m -p -F -- gdb -p <pid>

方案 B: 容器内跑 gdbserver
  docker exec -it my_container gdbserver :9999 --attach 1
  # 宿主:
  gdb -ex 'target remote 127.0.0.1:9999'

方案 C: 容器开启特权 (不推荐生产)
  docker run --cap-add=SYS_PTRACE --security-opt seccomp=unconfined ...

================================================================
2.12 启动时的常见错误
================================================================

  "Cannot access memory at address 0x..."
    → 栈坏了 / 函数参数未初始化 / 优化掉局部变量

  "No symbol table loaded"
    → 二进制没编译 -g, 或 readelf 看不到 .debug_info

  "ptrace: Operation not permitted"
    → ptrace_scope=1 且没 setcap, 见 2.1

  "Single stepping until exit from function __GI___libc_write"
    → 多线程 + scheduler-locking=on 死循环, 见 2.13

  "warning: ... section ... ignored"
    → DWARF 版本不匹配, 见 1.4.1 debuginfod

================================================================
2.13 多线程 scheduler-locking 设置
================================================================

debug 一个线程时, 其它线程怎么办:

  set scheduler-locking off      # 默认, 其它线程继续跑 (推荐线上调试)
  set scheduler-locking on       # 其它线程暂停 (死锁分析好用)
  set scheduler-locking step     # next/step 时暂停其它线程, 其它时刻继续

  show scheduler-locking

⚠️ 默认 off 是有意为之: 让被调试进程继续服务请求
⚠️ lock=on 可能让死锁变活锁 (其它线程也卡住)

================================================================
术语表 (本章)
================================================================

  .gdbinit                GDB 启动文件
  inferior                GDB 术语, "被调试进程/线程组"
  scheduler-locking       多线程时其它线程的调度策略
  signal handle           GDB 对信号的拦截策略
  detach-on-fork          fork 时 GDB 是否释放另一个进程
  follow-fork-mode        fork 时跟父还是子
  gdbserver               远程调试被调试端
  nsenter                 进进程命名空间 (调试容器)
  setcap                  给可执行文件加 capability