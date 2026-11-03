# GDB 使用说明 (九) 附录 — 一页索引与速查

承接: (一) - (八)
本节聚焦: 一页索引 / 命令速查表 / 常见错误码 / 学习路线

================================================================
9.1 一页索引 (核心命令)
================================================================

启动 / attach:
  gdb ./prog                          从入口跑
  gdb --args ./prog arg1              带参
  gdb -p <pid>                        attach 进程
  gdb -c core ./prog                  看 coredump
  gdb -batch -ex 'bt' -ex quit ./prog 批处理
  gdb -batch -p <pid> -ex 'bt' -ex detach -ex quit  attach + 一次 bt + detach

常用元命令:
  set <param> <val>                   设参数
  show <param>                        看参数
  info <topic>                        看状态
  help <topic>                        帮助
  show version                          GDB 版本
  quit / Ctrl-d                       退出

执行控制:
  start                               停在 main
  starti                              停在第一条指令
  run [args]                          跑
  continue / c                        继续
  next / n                            下一行 (不进)
  step / s                            下一行 (进)
  finish                              跑完当前函数
  until / u [line]                    跑出循环
  advance line                        跳到行
  stepi / nexti                       指令级 step / next
  reverse-step / reverse-continue     反向
  jump *addr                          强制跳转

断点:
  break main / b main                 函数入口
  break file:line                     文件:行
  break *addr                         地址
  break if cond                       条件断点
  break func thread 2                 仅在线程 2 命中
  tbreak                              临时断点
  rbreak regex                        正则
  catch syscall open                  catch 系统调用
  catch fork                          catch fork
  catch signal SIGSEGV                catch 信号

观察点:
  watch expr                          写时停
  rwatch expr                          读时停
  awatch expr                          读写都停

断点管理:
  info breakpoints                    / info b
  disable N / enable N                禁用/启用
  delete N / delete                    删
  condition N expr                     加条件
  commands N                          命中后自动执行
  ignore N count                       跳过前 count 次
  save breakpoints bpfile              保存
  source bpfile                       恢复

栈与变量:
  backtrace / bt                      / bt full / bt N
  frame N / f N / up / down           切栈帧
  info frame                          帧详情
  info locals / info args             局部变量 / 参数
  print / p expr                       看变量
  print/x / print/s / print/t          格式
  call expr                            调函数
  display expr                         自动显示
  info variables regex                全局变量
  info functions regex                函数

线程与进程:
  info threads                         线程列表
  thread N                             切线程
  thread apply all bt 5               所有线程跑
  set scheduler-locking off/on/step    调度策略
  info inferiors                       多进程
  inferior N                           切进程
  set follow-fork-mode parent/child   fork 跟随

内存:
  x/<N><f><s> addr                     examine
  x/16xb / x/16xw / x/16xg / x/16i  内存查看
  dump binary memory file begin end   内存转文件
  restore binary file addr            内存从文件恢复
  find /b begin, end, pattern         内存查找

源码与汇编:
  list / list line / list func       源码
  disassemble / disassemble /m       反汇编
  set disassembly-flavor intel/at&t  语法
  set listsize 30

寄存器:
  info registers / info reg $rax       寄存器
  p $pc / p $rsp / p $rdi            常用寄存器

信号:
  handle SIGUSR1 nostop noprint pass 信号句柄
  info signals                         当前信号句柄
  signal SIGUSR1                       主动发

core dump:
  generate-core-file /tmp/core         GDB 内生成
  coredumpctl list / info / gdb         systemd
  ulimit -c unlimited                  启用

远程:
  target remote host:port              连接
  target extended-remote host:port     异步模式
  set sysroot /path/to/root            远端根

================================================================
9.2 启动模式速查
================================================================

  场景                          命令
  ──────────────────────────────────────────────────
  普通调试                      gdb ./prog
  带参调试                      gdb --args ./prog arg1 arg2
  启动停在 main                gdb -ex 'b main' -ex 'run' ./prog
  启动停在第一条指令            gdb -ex 'starti' ./prog
  attach 进程                  gdb -p <pid>
  attach 后立刻打快照           gdb -batch -p <pid> -ex 'thread apply all bt 5' -ex detach -ex quit
  看 coredump                  gdb ./prog ./core
  批量分析 coredump             gdb -batch -ex 'bt' -ex 'thread apply all bt' ./prog ./core
  远程调试                     gdb -ex 'target remote host:9999' -ex 'file ./prog'
  远程 + 文件系统               gdb -ex 'set sysroot /target-root' -ex 'target remote host:9999'

================================================================
9.3 调试特定场景模板
================================================================

----------------------------------------------------------------
9.3.1 段错误
----------------------------------------------------------------
  (gdb) bt
  (gdb) info registers
  (gdb) x/i $pc
  (gdb) print $rdi / $rsi / $rdx     # 调用约定前 3 参数
  (gdb) info locals

----------------------------------------------------------------
9.3.2 死循环 / 高 CPU
----------------------------------------------------------------
  # 找高 CPU LWP
  top -H -p <pid>
  # attach + 切线程 + 多次 bt
  gdb -batch -p <pid> -ex 'thread 3' -ex 'bt 10' -ex detach -ex quit

----------------------------------------------------------------
9.3.3 进程 hang / 卡住
----------------------------------------------------------------
  gdb -batch -p <pid> -ex 'thread apply all bt 10' -ex 'info threads' -ex detach -ex quit

----------------------------------------------------------------
9.3.4 数据竞争
----------------------------------------------------------------
  # 编译 -fsanitize=thread
  # 运行时自动报
  # GDB 停到报错位置
  (gdb) bt full

----------------------------------------------------------------
9.3.5 内存泄漏
----------------------------------------------------------------
  # 编译带 valgrind / AddressSanitizer
  valgrind --leak-check=full ./prog
  # 或 ASan:
  CFLAGS=-fsanitize=address ./prog

  # GDB 调试 ASan 报告:
  (gdb) break __asan_report_error
  (gdb) run

----------------------------------------------------------------
9.3.6 函数返回值异常
----------------------------------------------------------------
  (gdb) break my_func
  (gdb) commands 1
    silent
    finish
    print $rax
    continue
  end

----------------------------------------------------------------
9.3.7 单步过 std::cout / printf
----------------------------------------------------------------
  skip function printf
  skip function std::operator<<
  # 或:
  (gdb) skip file uninteresting.c

----------------------------------------------------------------
9.3.8 反汇编查看编译器生成的代码
----------------------------------------------------------------
  (gdb) disassemble /m my_func
  # /m 源码 + 汇编混合

----------------------------------------------------------------
9.3.9 看某个对象的地址 + 类型
----------------------------------------------------------------
  (gdb) print &obj
  (gdb) whatis obj
  (gdb) ptype obj

----------------------------------------------------------------
9.3.10 改内存做实验
----------------------------------------------------------------
  (gdb) set var x = 99
  (gdb) set {int}0x601040 = 1
  (gdb) set var buf = {'a', 'b', 'c'}
  # ⚠ 改完不要继续跑到生产

================================================================
9.4 常见错误信息
================================================================

  Cannot access memory at address 0x0
    → NULL 指针解引用, 或栈坏了

  No symbol "my_var" in current context
    → 二进制没编译 -g, 或变量被优化掉

  value optimized out
    → -O2 把变量优化到寄存器, 用 print $rdi 推断, 或编译 -O0

  ptrace: Operation not permitted
    → kernel.yama.ptrace_scope=1 且没 setcap
    → 修法见 (二) 2.1

  The program is not being run
    → 没 run 或没 attach, 或进程已退出

  Argument list too long
    → 命令行参数太长, 用文件传参

  warning: Unable to find dynamic linker breakpoint function
    → 动态库未加载, info sharedlibrary 查看

  Cannot find bounds of current function
    → 当前不在函数内 (在裸 asm 或 _start)

  Single stepping until exit from function ...
    → 多线程 + scheduler-locking=on 死循环

  Selected thread is running
    → 切线程时线程正在运行, 用 interrupt 强制停

================================================================
9.5 性能 / 选项设置
================================================================

  set print elements 0              数组全显示
  set print elements 50             数组前 50 个
  set print pretty on               换行
  set print array on                数组打印
  set print null-stop on            字符串遇 NULL 截止
  set pagination on                 一屏分页
  set height 0                      不限行数
  set width 0                       不限列数
  set print thread-events on        线程事件打印
  set scheduler-locking off          默认

================================================================
9.6 学习路线
================================================================

新手 (入门):
  1. 5 分钟上手 (一) 0.7
  2. 断点 + print + continue (三) + (四)
  3. attach 进程 (二)
  5. core dump 分析 (六)

中级 (项目级):
  1. 多线程调试 (五)
  2. 反汇编 + 寄存器 (四) 10-11
  3. 信号 + scheduler-locking (二) 2.3 + 2.13
  4. 写 .gdbinit (二) 2.2
  5. 用 IDE / TUI (一) 0.5

高级 (系统研究级):
  1. Pretty printer + 自定义命令 (七)
  2. Python 脚本扩展 (七)
  3. 远程调试 + gdbserver (八)
  4. 反向调试 + record/replay (八) 8.10
  5. coredumpctl + abrt + systemd 集成 (六)
  6. K8s / 容器调试 (八) 8.5

专家级:
  1. 改 GDB 源码 (gdb-12 +)
  2. JIT 接口 (GDB 7.4+, JIT compiler 集成调试)
  3. Multi-inferior + multi-process
  4. Tracepoint + trace 文件 (TDP)

================================================================
9.7 推荐资源
================================================================

官方:
  https://sourceware.org/gdb/
  https://sourceware.org/gdb/current/onlinedocs/gdb/
  https://sourceware.org/gdb/wiki/

教程:
  "How to debug C++ programs" (各种 vendor wiki)
  Beej's Quick Guide to GDB
  https://beej.us/guide/bggdb/

书:
  "The Art of Debugging with GDB, DDD, and Eclipse"
  "GDB Pocket Reference"

工具:
  GDB Dashboard (github.com/cyrus-and/gdb-dashboard)
  CGDB (github.com/cgdb/cgdb)
  PEDA (github.com/longld/peda)
  GEF (github.com/hugsy/gef)
  pwndbg (github.com/pwndbg/pwndbg) — 适合 CTF/二进制
  systemtap, bpftrace — 内核级 tracing

本机:
  已装 GDB 17.1, 已 setcap cap_sys_ptrace+ep

================================================================
9.8 GDB 调试流程图 (高层)
================================================================

  问题是什么?
    │
    ├── 段错误 / SIGSEGV
    │     │
    │     ├─ 有 core dump? ─→ gdb -c core ./prog → 6.13
    │     │
    │     └─ 无 / 想复现   ─→ run → 崩溃 → 6.13
    │
    ├── 高 CPU / 死循环
    │     │
    │     └─ top -H → attach → 切线程 → 多次 bt → 5.10
    │
    ├── 进程 hang
    │     │
    │     └─ attach → thread apply all bt → 5.11
    │
    ├── 死锁
    │     │
    │     └─ 线程栈 + 看 mutex owner → 5.4.2
    │
    ├── 数据错误
    │     │
    │     ├─ 知道在哪发生?  → break → print
    │     │
    │     └─ 不知道        → rbreak → print 路径
    │
    ├── 内存泄漏
    │     │
    │     └─ valgrind / ASan → 5.3.5
    │
    └── 系统研究 (PG/Redis)
          │
          └─ Pretty printer + 跟踪关键函数 → 7.15

================================================================
9.9 性能数字参考
================================================================

本机 GDB 17.1:
  - attach 进程: < 100ms
  - 单步执行: ~1ms (本地)
  - 单步执行: ~10-50ms (gdbserver 网络)
  - record-full 慢 50-100 倍
  - record-btrace 慢 < 5 倍
  - Pretty printer 简单位字段: ~10us
  - Pretty printer STL: ~100us-1ms

================================================================
9.10 完整文件清单
================================================================

/home/obsidian/linux/linux_/
  gdb-01-原理与基本概念.md            7591 字节  (一) 原理
  gdb-02-调试环境与准备.md           11853 字节  (二) ptrace / .gdbinit / 信号
  gdb-03-断点与控制执行.md           10539 字节  (三) break / watch / step
  gdb-04-调用栈与变量查看.md         12656 字节  (四) bt / frame / print
  gdb-05-多线程-锁-信号.md           11973 字节  (五) 线程 / 锁 / 信号
  gdb-06-core-dump与事后调试.md       12472 字节  (六) coredump
  gdb-07-pretty-printer与自定义命令.md 15787 字节  (七) Python 扩展
  gdb-08-远程调试与系统集成.md       13794 字节  (八) gdbserver / IDE / CI
  gdb-09-附录一页索引.md                       本文件 (九) 速查

================================================================
术语表 (本章)
================================================================

  GDB RSP          GDB Remote Serial Protocol
  coredumpctl      systemd 的 core 管理工具
  scheduler-locking 断点时是否锁调度
  ptrace_scope     yama ptrace 限制
  debugger-stub    GDB 的远程调试协议实现
  debuginfod       按需下载调试符号的协议
  CTF              Capture The Flag (GDB 重度使用场景)