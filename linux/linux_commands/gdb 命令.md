# gdb 命令使用说明

`gdb`（GNU Project Debugger）是 Linux 下 C/C++ 程序的命令行调试器,支持本地调试、attach 进程、core dump 分析、远程调试、Python 扩展。

完整 9 章系列见 `/home/obsidian/linux/linux_/gdb-*.md`(基础 → 多线程 → core dump → pretty printer → 远程)
本笔记定位: linux_commands/ 下的速查版,补齐命令级索引,与 linux_/ 详尽版互补

本机版本: gdb 17.1 (Ubuntu 17.1-2ubuntu1)
环境: Linux 7.0.0+, x86_64
诊断脚本: bash /home/obsidian/linux/linux_/scripts/check-gdb-env.sh

================================================================
1. 启动模式
================================================================

直接调试:
  gdb ./prog                          从入口开始
  gdb --args ./prog arg1 arg2         带参数
  gdb -ex 'b main' -ex 'run' ./prog   停在 main
  gdb -ex 'starti' ./prog             停在第一条指令

attach 进程:
  gdb -p <pid>                        attach
  gdb -batch -p <pid> -ex 'bt' -ex 'thread apply all bt' -ex detach -ex quit  一次快照

core dump:
  gdb ./prog ./core
  gdb -batch -ex 'bt' -ex quit ./prog ./core
  coredumpctl list                    systemd 系统看 dump 列表
  coredumpctl gdb                     用 GDB 打开最近一次
  coredumpctl gdb PID=1234           指定 PID
  ulimit -c unlimited                 启用 core dump

远程:
  gdb -ex 'target remote 192.168.1.10:9999' -ex 'file ./prog'

================================================================
2. 执行控制
================================================================

  start                               停在 main
  starti                              停在第一条指令
  run [args]                          跑 (可带参)
  continue / c                        继续
  next / n                            下一行 (不进)
  step / s                            下一行 (进)
  finish                              跑完当前函数
  until / u [line]                    跑出循环 / 跑到行
  advance line                        跳到行
  stepi / nexti                       指令级
  reverse-step / reverse-continue     反向 (需 record-full)
  jump *addr                          强制跳转 (危险)

================================================================
3. 断点
================================================================

  break func                          函数入口
  break file:line                     文件:行
  break *addr                         地址
  break func if x > 10                条件
  tbreak func                         临时 (命中一次后删)
  rbreak regex                        正则
  catch syscall open                  捕获系统调用
  catch fork / catch exec / catch vfork
  catch signal SIGSEGV                捕获信号
  info breakpoints                    列出所有断点
  delete N / delete                   删一个/全部
  disable N / enable N                禁用/启用
  enable once N                       命中一次后自动 disable
  condition N expr                    加/改条件
  commands N                          命中后自动执行
    silent
    print i
    continue
  end
  ignore N count                      跳过前 count 次
  save breakpoints bpfile             保存到文件
  source bpfile                       恢复

观察点:
  watch expr                          写时停
  rwatch expr                          读时停
  awatch expr                          读或写都停
  skip function strlen                跳过特定函数

================================================================
4. 调用栈与变量
================================================================

  backtrace / bt                      调用栈
  bt 5 / bt full                      限层数 / 含局部变量
  frame N / f N                       切栈帧
  up / down                           切上层/下层
  info frame / info locals / info args  帧详情/局部/参数
  print / p expr                       看变量
  print/x / print/d / print/u        十六进制/有符号/无符号
  print/o / print/t / print/c        八进制/二进制/字符
  print/s str_ptr                     字符串
  print/a addr                        反查符号
  display expr                         每次停下自动 print
  undisplay N                          取消自动 print
  set var x = 99                       改变量
  set {int}0x601040 = 1                改内存

寄存器:
  info registers                       看寄存器
  p $pc / p $rsp / p $rdi / p $rax   x86_64 关键寄存器

内存查看:
  x/<N><f><s> addr                    examine
  x/16xb / x/16xw / x/16xg           字节/word/8字节
  x/s str_ptr                          字符串
  x/16i $pc                           16 条指令
  find /b begin, end, pattern          内存查找
  dump binary memory file begin end    内存转文件
  restore binary file addr             内存从文件恢复

源码与汇编:
  list / list line / list func        源码
  disassemble                          反汇编
  disassemble /m                       源码 + 汇编混合
  set disassembly-flavor intel        用 Intel 语法 (默认 AT&T)

================================================================
5. 多线程 / 进程
================================================================

  info threads                         线程列表
  thread N                             切线程
  thread apply all bt 5               所有线程跑 bt
  thread apply 1 2 bt                  指定线程
  thread name "worker-1"              当前线程命名
  set scheduler-locking off            默认
  set scheduler-locking on             锁其它线程 (死锁分析)
  set scheduler-locking step           next/step 时锁

多进程:
  info inferiors                       进程列表
  inferior N                           切进程
  set follow-fork-mode child/parent    fork 时跟随
  set detach-on-fork off               fork 时同时调试

================================================================
6. 信号
================================================================

  handle SIGUSR1 nostop noprint pass   不打断进程
  handle SIGSEGV stop print            收到停下并打印
  info signals                         当前信号句柄
  signal SIGUSR1                       主动发信号

attach 服务端进程必设:
  handle SIGUSR1 nostop noprint pass
  handle SIGUSR2 nostop noprint pass
  handle SIGPIPE nostop noprint pass
  set scheduler-locking off

================================================================
7. ptrace 权限
================================================================

默认 kernel.yama.ptrace_scope=1 限制 attach

永久修法 (推荐):
  sudo setcap cap_sys_ptrace+ep /usr/bin/gdb

临时:
  sudo sysctl -w kernel.yama.ptrace_scope=0
  sudo gdb -p <pid>

验证:
  cat /proc/sys/kernel/yama/ptrace_scope
  getcap /usr/bin/gdb

================================================================
8. .gdbinit 配置
================================================================

~/.gdbinit (GDB 启动自动加载):

  set pagination on
  set height 0
  set print pretty on
  set print array on
  set print symbol-loading full
  set history save on
  set history filename ~/. ~/.gdb_history

加载 Python pretty printer:
  python
  import sys, os
  helper = os.path.expanduser("~/.hermes/cache/<system>-gdb.py")
  if os.path.exists(helper):
      sys.path.insert(0, os.path.dirname(helper))
      try:
          import <system>-gdb
          print(f"[<system>-gdb] loaded")
      except Exception as e:
          print(f"[<system>-gdb] load failed: {e}")
  end

================================================================
9. Python 扩展 (Pretty Printer)
================================================================

GDB 17+ 移除了 gdb.events.Stopped, 自定义命令需手动 invoke
示例 ~/.hermes/cache/<system>-gdb.py:

```python
import gdb

def _int(v):
    try: return int(v)
    except: return 0

class MyStructPrinter:
    def __init__(self, val): self.val = val
    def to_string(self):
        v = self.val
        return f"MyStruct {{ field={_int(v['field'])} }}"

class MyCmd(gdb.Command):
    """mycmd <addr> : 打印 MyStruct"""
    def __init__(self): super().__init__("mycmd", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        val = gdb.parse_and_eval(arg.strip()).dereference()
        print(MyStructPrinter(val).to_string())

# 注册
gdb.printing.register_pretty_printer(
    gdb.current_objfile(),
    gdb.printing.RegexpCollectionPrettyPrinter("<system>")
)
MyCmd()
print("[<system>-gdb] registered: mycmd")
```

GDB 内:
  print obj               → 自动用 pretty printer
  mycmd 0x601040          → 自定义命令

================================================================
10. 远程调试
================================================================

目标机:
  gdbserver :9999 ./app
  gdbserver :9999 --attach <pid>

调试机:
  gdb
  (gdb) target remote 192.168.1.10:9999
  (gdb) file /path/to/binary
  (gdb) set sysroot /target-root

SSH 隧道 (安全):
  ssh -L 9999:localhost:9999 user@target

跨平台:
  apt install gdb-multiarch
  gdb-multiarch -ex 'set sysroot /opt/arm-rootfs' -ex 'target remote ...'

================================================================
11. 一页索引
================================================================

启动        start | starti | run | continue | attach | generate-core-file
栈          bt | frame | up | down | info frame | info locals | info args
变量        print | display | whatis | ptype | set var | call
断点        break / tbreak / rbreak | condition | commands | delete / disable | info breakpoints
观察点      watch / rwatch / awatch | skip
执行        next | step | finish | until | advance | reverse-* | jump
线程        info threads | thread | thread apply | set scheduler-locking
进程        info inferiors | inferior | set follow-fork-mode | set detach-on-fork
信号        handle | info signals | signal
内存        x/<N><f><s> | find | dump | restore | set {type}
源码/汇编   list | disassemble | set disassembly-flavor
寄存器      info registers | p $rax
配置        set | show | help
核心        core-file | coredumpctl | ulimit -c | sysctl core_pattern
远程        target remote | target extended-remote | gdbserver
Python      gdb.Command | gdb.Parameter | gdb.Function | gdb.Value

================================================================
12. 常用错误与解决
================================================================

  Cannot access memory at address 0x0
    → NULL 指针或栈坏

  No symbol "var" in current context
    → 二进制没 -g, 或变量被优化掉 (-O2)

  value optimized out
    → -O2 优化掉局部变量, 编译 -O0 或用寄存器 $rdi 等推断

  ptrace: Operation not permitted
    → ptrace_scope=1 且没 setcap
    → 修法见第 7 节

  Single stepping until exit from function __lll_lock_wait
    → 多线程 + scheduler-locking=on 卡住
    → set scheduler-locking off 或 detach

  Selected thread is running
    → 切线程时正在跑, 用 Ctrl-C 中断

================================================================
13. 与同目录其它文件的关系
================================================================

  linux_/gdb-01 ~ gdb-09   完整 9 章详解 + 实战模板
  linux_/scripts/check-gdb-env.sh  环境诊断
  本文件                    速查版 (本目录新增)

================================================================
与其它笔记的关联
================================================================

  linux/linux_/gdb-*.md                  详尽版
  ~/.hermes/skills/software-development/systems-source-study-with-gdb/  skill 源

  排查技巧:
  linux_perform/CPU/05-CPU使用率100%.md    高 CPU 排查 (GDB 是定位工具)
  linux_perform/CPU/07-不可中断与僵尸-上.md  不可中断进程状态

================================================================
参考命令
================================================================

  info gdb                            在线手册
  man gdb
  help breakpoints / help data        分类帮助
  help user-defined                   自定义命令