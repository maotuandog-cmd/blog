# GDB 使用说明 (六) core dump 与事后调试

承接: (一) (二) (三) (四) (五)
本节聚焦: 让进程在崩溃时留 dump, 用 GDB 离线分析

================================================================
6.1 为什么需要 core dump
================================================================

线上进程崩了, 但:
  - 不能再现场
  - 重启后无法重现
  - attach 时已经挂了
  - 上报只有 "segmentation fault"

core dump 是进程崩溃瞬间的"快照":
  - 完整内存
  - 寄存器
  - 文件描述符
  - 加载的库 / 符号

有了它, 哪怕进程已经死了, 也能像 attach 一样看当时的状态

================================================================
6.2 启用 core dump
================================================================

----------------------------------------------------------------
6.2.1 内核参数
----------------------------------------------------------------
  ulimit -c unlimited         # 当前 shell 不限制大小
  # 持久化:
  cat /etc/security/limits.conf
  *   soft    core    unlimited
  *   hard    core    unlimited

  # systemd 服务, 写到 service 文件
  LimitCORE=infinity

----------------------------------------------------------------
6.2.2 默认路径 (本机 Linux 7.0.0)
----------------------------------------------------------------
  /proc/sys/kernel/core_pattern
  # 内容决定 core 文件命名与处理
  # 默认: core (写到当前目录, 名叫 core)
  # systemd-coredump: |/lib/systemd/systemd-coredump (交给 systemd)

----------------------------------------------------------------
6.2.3 命名规则 — 让 dump 自带 PID + 程序名 + 时间
----------------------------------------------------------------
  sudo sysctl -w kernel.core_pattern='core.%e.%p.%t'
  # %e 可执行文件名
  # %p PID
  # %t 时间戳
  # %h 主机名
  # 例: core.myprog.1234.1700000000

  sudo sysctl -w kernel.core_uses_pid=1   # 加 .pid 后缀

其它参数:
  /proc/sys/kernel/core_pipe_limit        # 同时能跑几个 coredump helper
  /proc/sys/kernel/core_omit_vdso         # 1 = 排除 vdso (省空间)
  /proc/sys/kernel/core_emit_note         # 1 = 加 PT_NOTE

----------------------------------------------------------------
6.2.4 检查当前配置
----------------------------------------------------------------
  ulimit -c                    # 当前 shell 的限制
  sysctl kernel.core_pattern   # 全局 core 命名
  cat /proc/sys/kernel/core_pattern

================================================================
6.3 systemd-coredump 体系 (现代 Linux 默认)
----------------------------------------------------------------

----------------------------------------------------------------
6.3.1 启用与查询
----------------------------------------------------------------
  systemctl status systemd-coredump.socket
  sudo systemctl enable --now systemd-coredump.socket

  coredumpctl list               # 所有历史 dump
  # 输出:
  # TIME                          PID  UID  GID  SIG  EXE
  # 2026-01-01 12:00:00           1234 1000 1000 11   /usr/bin/myprog

  coredumpctl info               # 最近一次 dump 详情
  coredumpctl info PID=1234      # 指定 PID

  coredumpctl gdb                # 用 GDB 打开最近一次
  coredumpctl gdb PID=1234       # 指定 PID
  coredumpctl debug              # 等价 coredumpctl gdb

----------------------------------------------------------------
6.3.2 取出 dump 文件
----------------------------------------------------------------
  coredumpctl dump --output /tmp/core.1234 --binary
  # 提取原始 ELF core
  # 然后: gdb /usr/bin/myprog /tmp/core.1234

  coredumpctl dump --output /tmp/core.1234 --decompress
  # 提取并解压 (默认压缩存储)

================================================================
6.3.3 清理旧 dump
----------------------------------------------------------------
  coredumpctl list
  sudo coredumpctl delete PID=1234
  # 或清空:
  sudo rm -rf /var/lib/systemd/coredump/

================================================================
6.4 在 GDB 里生成 dump (运行中进程)
================================================================

attach 后立刻触发 dump:
  (gdb) attach <pid>
  (gdb) generate-core-file /tmp/core.gdb
  Saved corefile /tmp/core.gdb
  (gdb) gcore /tmp/core.gdb       # 简写
  (gdb) detach
  (gdb) quit

之后:
  gdb ./myprog /tmp/core.gdb

⚠️ 生成 core 时进程暂停, 业务可能 hang 一秒, 慎用生产

================================================================
6.5 分析 core 的 GDB 命令
================================================================

启动:
  gdb ./myprog core
  gdb -batch -ex 'bt' -ex 'info threads' -ex quit ./myprog core
  # 批处理模式看快照

通用流程:
  (gdb) bt                       # 调用栈
  (gdb) bt full                  # 含局部变量
  (gdb) info threads             # 多线程场景
  (gdb) thread apply all bt 3    # 所有线程栈
  (gdb) info registers           # 寄存器
  (gdb) disassemble $pc-32, $pc+32   # 崩溃点附近反汇编
  (gdb) x/i $pc                  # 当前指令
  (gdb) info proc mappings       # 内存映射

自动判断信号:
  (gdb) print $_siginfo
  # 显示信号编号 + 原因

================================================================
6.6 常见崩溃模式诊断
================================================================

----------------------------------------------------------------
6.6.1 SIGSEGV (signal 11) 段错误
----------------------------------------------------------------
  bt → 看 PC 在哪
  PC = 0x0 附近                → NULL 指针解引用
  PC 在某函数但参数错          → 调用者传错
  x/i $pc                       → 看正在执行的指令 (mov *rax, ...)
  p $rdi                        → 看传入参数
  p *(void**)$rsp               → 看返回地址 (栈是否被踩)

----------------------------------------------------------------
6.6.2 SIGABRT (signal 6)
----------------------------------------------------------------
  通常是 assert 失败
  (gdb) bt
  # 顶上是 raise → abort → assert → 你的代码

  看 assert 失败的信息:
  (gdb) frame N                   # 切到 assert 那一层
  (gdb) print assertion_text
  # 取决于编译时是否保留 assert 字符串

----------------------------------------------------------------
6.6.3 SIGFPE (signal 8) 除零
----------------------------------------------------------------
  (gdb) x/i $pc
  # 看是不是 div / idiv 指令
  (gdb) p $rsi
  # x86 除法: rax / rcx → rax 商, rdx 余数

----------------------------------------------------------------
6.6.4 SIGBUS (signal 7)
----------------------------------------------------------------
  典型: 跨页访问 unaligned
  (gdb) x/i $pc
  # movaps / movdqa 访问未对齐地址

  pthread_mutex_double_unlock 也常见
  (gdb) print mutex
  # 看 mutex.owner 是不是 0

================================================================
6.7 看当时的堆/栈/全局变量
================================================================

  (gdb) info locals              # 当前 frame 的局部变量
  (gdb) info args                # 当前 frame 的参数
  (gdb) info variables global    # 全局变量

  (gdb) print *ptr               # 解引用
  (gdb) print *(buf_t*)0x601040  # 强转类型

  (gdb) print *(MyStruct*)0x601040

  (gdb) x/64x 0x601000           # 看一段内存
  (gdb) x/s 0x601100             # 看字符串

================================================================
6.8 heap 检查
================================================================

  (gdb) print *(malloc_chunk*)ptr-16
  # glibc 内存块头部结构

  # 使用 GDB 调试 tcmalloc / jemalloc
  # 见各项目文档

================================================================
6.9 多线程 core 的分析
================================================================

  (gdb) info threads
    Id   Target Id
  * 1    Thread 0x7f...  LWP 1234 "myprog" (running)
    2    Thread 0x7f...  LWP 1235 "myprog"
    3    Thread 0x7f...  LWP 1236 "myprog"

  (gdb) thread apply all bt 5
  # 所有线程栈都打

  找到崩溃的线程:
  (gdb) print $_siginfo
  # 通常是当时执行的线程崩了

  (gdb) thread apply all frame apply all print *my_global
  # 所有线程都看某个全局

================================================================
6.10 远程 core (容器 / K8s 抓的)
================================================================

  # 1. 从容器内取出 core
  kubectl cp pod:/tmp/core.1234 ./core.1234

  # 2. 同机有相同二进制 + 同机有调试符号 → gdb 加载
  gdb /usr/bin/myprog core.1234

  # 3. 跨机: 把调试符号放 ~/.cache/gdb 或用 debuginfod
  set sysroot /target-root      # 远端根目录 (含 /lib /usr/lib)
  # gdb 会去 sysroot 下找对应 .so

================================================================
6.11 让进程在崩溃前留 dump
================================================================

  # /proc/sys/kernel/core_pattern 调成:
  # |/path/to/save_core.sh %e %p %t

  cat > /usr/local/bin/save_core.sh <<'EOF'
#!/bin/bash
EXE=$1
PID=$2
TIME=$3
mkdir -p /var/coredump
echo "/var/coredump/${EXE}.${PID}.${TIME}" > /proc/sys/kernel/core_pipe_limit
EOF
  chmod +x /usr/local/bin/save_core.sh

  # 也可用 abrt-hookccpp 自动收集

================================================================
6.12 自动化 dump 处理
================================================================

dump 上来后用 GDB 批量提取信息:
  #!/bin/bash
  CORE=$1
  BIN=$2
  gdb -batch \
    -ex "file $BIN" \
    -ex "core-file $CORE" \
    -ex "bt" \
    -ex "thread apply all bt 5" \
    -ex "info registers" \
    -ex "print \$_siginfo" \
    -ex quit

  ./analyze_core.sh ./core.1234 /usr/bin/myprog > report.txt

================================================================
6.13 实战模板: 完整崩溃分析流程
================================================================

1. 拿到 core 文件 (或 coredumpctl info 找到路径)

2. 加载:
   gdb /usr/bin/myprog /path/to/core

3. 看信号:
   (gdb) print $_siginfo

4. 看栈:
   (gdb) bt

5. 看崩溃点附近代码:
   (gdb) frame 0
   (gdb) disassemble /m

6. 看相关变量:
   (gdb) info locals
   (gdb) info args

7. 看所有线程:
   (gdb) thread apply all bt 3

8. 看崩溃点的反汇编:
   (gdb) x/8i $pc

9. 看寄存器 + 调用约定推断:
   (gdb) info registers
   (gdb) p $rdi       # 第一参数

10. 输出报告:
   (gdb) set logging file /tmp/analysis.txt
   (gdb) set logging on
   (gdb) bt full
   (gdb) info registers
   (gdb) info threads
   (gdb) set logging off

================================================================
6.14 core 文件不在本机的问题
================================================================

  # 不同机器的二进制 → 文件名要完全匹配
  # 不同版本的 .so → unmatch
  # GDB 提示: "warning: core file may not match specified executable"

  解决:
  - 用同版本 build 的二进制
  - 用同版本 .so
  - 用 debuginfod 自动下载

  set debug-file-directory /opt/myprog-debug
  # 把所有调试符号放这个目录

================================================================
6.15 core dump 大小控制
================================================================

core 文件可能很大 (几十 GB), 磁盘要预留空间

  /proc/sys/kernel/core_pipe_limit      # 同时处理的 core 数
  ulimit -c 1024                          # 限 1MB
  # 生产环境, 重要的进程可设 unlimited, 其它限小

================================================================
术语表 (本章)
================================================================

  core dump           进程崩溃时的内存快照
  SIGSEGV             段错误 (信号 11)
  SIGABRT             abort() (信号 6, 通常是 assert 失败)
  SIGBUS              总线错误 (信号 7, 未对齐访问等)
  SIGFPE              算术错误 (信号 8, 除零)
  coredumpctl         systemd 的 core 管理工具
  core_pattern        core 文件命名规则 (sysctl)
  $_siginfo           GDB 内置, 当前收到的信号
  $pc                 程序计数器, 崩溃时的指令地址
  PT_NOTE             ELF 段, 包含元信息 (program headers 等)