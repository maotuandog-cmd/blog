# GDB 使用说明 (一) 原理与基本概念

定位: 通用 GDB 实操手册, 同时适配研究大型 C/C++ 系统源码与线上 bug 调试
适用范围: 本机 GDB 17.1 (Ubuntu 17.1-2ubuntu1), Linux 7.0.0+, x86_64
skill 参考: systems-source-study-with-gdb (Pretty printer / ptrace 等)
笔记路径: /home/obsidian/linux/linux_/

================================================================
0.1 速查卡片 — "GDB 是什么/干什么"
================================================================

GDB = GNU Project Debugger, GNU 工程调试器
  作用: 让程序"停在你想停的地方, 看你想看的东西"
  适用: C / C++ / Fortran / Go (部分) / Rust (部分) / 汇编
  不适用: Java (用 jdb) / Python (用 pdb / debugpy) / JS (用 inspect)
  本机版本: gdb 17.1 (Ubuntu 17.1-2ubuntu1)
  协议: 本地 attach / gdbserver 远程 / coredump 离线

================================================================
0.2 GDB 三种启动方式
================================================================

① 直接调试可执行文件 (从入口开始)
  gdb ./a.out
  gdb --args ./a.out arg1 arg2 arg3

② attach 到已在运行的进程 (适合线上 / 长跑)
  gdb -p <pid>
  # 注意: 进程会立刻停在 SIGTRAP, 不要 attach 到生产关键进程

③ 离线分析 core dump (事后追查)
  gdb ./a.out core
  gdb -c core ./a.out

================================================================
0.3 GDB 核心工作模型 (理解所有命令的前提)
================================================================

GDB 通过 ptrace() 系统调用接管目标进程:

  GDB 进程                    目标进程 (被调试者)
  ┌────────────┐  ptrace    ┌────────────┐
  │ gdb       │◄──────────►│ a.out     │
  │ - 主线程  │ 读写寄存器  │ - 用户态  │
  │ - 事件循环│ 读写内存    │ - 内核态  │
  │ - 命令解析│ 注入信号    │            │
  └────────────┘            └────────────┘

GDB 能做 / 不能做的事:
  ✓ 读 / 写目标进程内存
  ✓ 读 / 写所有通用寄存器 + 程序计数器 (PC)
  ✓ 在指定 PC / 内存地址上插入 int3 断点
  ✓ 拦截并伪造信号
  ✗ 改磁盘文件 (那是编辑器的事)
  ✗ 改其他进程 (除非也 attach)
  ✗ 让"优化掉"的变量复活 (见 1.4 -O0 与 -O2 的差距)

================================================================
0.4 调试符号 (debug info) — 没有它, GDB 是瞎子
================================================================

调试符号 = 编译器把"机器码地址 → 源码行号" / "结构体字段名"
保存在 ELF 文件的 .debug_* 段里。

关键编译标志:
  -g          基础 DWARF
  -g3         额外宏定义
  -ggdb       GNU 扩展 (推荐)
  -O0         不优化 (调试器友好)
  -O2/-O3     优化 (断点/变量会被优化掉, 见 1.5)
  -fno-omit-frame-pointer  保留栈帧指针 (bt 才能看到栈)

推荐调试构建:
  CFLAGS="-O0 -g3 -ggdb -fno-omit-frame-pointer"

看一个二进制有没有调试符号:
  file /path/to/bin
  # 输出含 "with debug_info" 才有

  objdump --syms /path/to/bin | head
  # 或:
  readelf -S /path/to/bin | grep debug
  # 应看到 .debug_info / .debug_line / .debug_frame

----------------------------------------------------------------
0.4.1 第三方无符号程序的急救: debuginfod
----------------------------------------------------------------

现代发行版把调试符号拆分到 debuginfo 包, 通过网络按需下载:
  Debian/Ubuntu:    sudo apt install debuginfod
  Fedora/RHEL:      dnf debuginfo-install <pkg>

启用 (GDB 10+):
  set debuginfod enabled on
  set debuginfod urls https://debuginfod.ubuntu.com

================================================================
0.5 GDB 命令界面
================================================================

GDB 是 CLI, 但也有 TUI / GUI:

  CLI:        gdb> print i
  TUI:        gdb> tui enable        # 上下分屏 (源码 + 命令)
  CGDB:       htop 风格的源码界面 (apt install cgdb)
  GDB Dashboard:  https://github.com/cyrus-and/gdb-dashboard
  IDE 集成:    VSCode / CLion / Emacs gdb-mi / Vim termdebug

本笔记全部用 CLI 表达。

================================================================
0.6 命令分类地图
================================================================

本笔记按 9 个大类组织 GDB 命令:

  (一) 原理与基本概念              ← 本文
  (二) 调试环境与准备              ← 启动模式 / ptrace / 多线程
  (三) 断点 / 观察点 / 控制执行     ← break / watch / next / step
  (四) 调用栈与变量查看             ← backtrace / frame / print / display
  (五) 多线程 / 锁 / 信号           ← thread / lock / handle SIGUSR1
  (六) core dump 与事后分析         ← generate-core-file / coredumpctl
  (七) pretty printer 与自定义命令  ← Python GDB 扩展 (重点)
  (八) 远程调试 (gdbserver)         ← target remote / multiarch
  (九) 附录 / 速查                  ← 一页索引

================================================================
0.7 第一个完整 GDB 会话 (5 分钟上手)
================================================================

假设 hello.c:
  #include <stdio.h>
  int main(int argc, char **argv) {
      int sum = 0;
      for (int i = 1; i <= 100; i++) sum += i;
      printf("sum = %d\n", sum);
      return 0;
  }

编译 (必须带 -g):
  gcc -O0 -g3 -ggdb hello.c -o hello

启动 + 跑:
  gdb ./hello

GDB 内交互 (粗体是用户输入):
  (gdb) break main           在 main 函数设断点
  (gdb) run                  跑程序, 会停在 main 第一行
  (gdb) next                 下一行 (不进函数)
  (gdb) print sum            看 sum 变量值
  (gdb) print i              看循环变量 i
  (gdb) continue             跑到下一个断点 / 结束
  (gdb) quit                 退出 GDB

关键快捷键 (默认 emacs 模式):
  Enter       重复上一条命令
  Tab         命令补全
  Ctrl-d      退出 (在空行)
  Ctrl-a/e    行首/行尾
  ↑/↓         历史命令

切换 vi 编辑模式:
  set editing-mode vi

================================================================
0.8 帮助系统
================================================================

(h) help [COMMAND]
  help                     顶层类别列表
  help breakpoints          所有断点命令
  help data                 所有数据查看命令
  help user-defined         用户自定义命令

文档:
  info gdb                  在线手册
  man gdb
  https://sourceware.org/gdb/current/onlinedocs/gdb/

================================================================
术语表 (本章)
================================================================

  DWARF            调试信息格式 (.debug_* 段)
  ptrace           Linux 进程调试系统调用
  frame            调用栈中的一层
  breakpoint       断点 (int3 指令)
  watchpoint       观察点 (硬件/软件内存监视)
  coredump         进程崩溃时的内存快照
  inferior         GDB 术语, "被调试进程"
  TUI              Text User Interface (GDB 内置分屏)
  debuginfod       按需下载调试符号的协议
  reverse debug    反向调试, "时间倒流"
  ranger-step      Range stepping, 跳过函数而非进入
  scheduler-locking GDB 在断点时是否让其他线程跑