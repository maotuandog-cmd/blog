# GDB 使用说明 (四) 调用栈与变量查看

承接: (一) (二) (三)
本节聚焦: backtrace / frame / print / display / info locals / info args

================================================================
4.1 调用栈 (backtrace) — "我现在在哪儿, 怎么走到这的"
================================================================

每层调用栈 = 一个 frame, 包含:
  - PC (返回地址)
  - SP (栈指针)
  - 寄存器现场
  - 局部变量 / 参数

----------------------------------------------------------------
4.1.1 查看栈
----------------------------------------------------------------
  backtrace                   # 完整调用栈
  # 别名: bt
  bt 5                        # 只看顶层 5 层
  bt full                     # 含每个 frame 的局部变量 (信息多, 慢)

  bt -3                       # 倒数 3 层

  bt inside my_func           # 只显示 my_func 内部的 frame

----------------------------------------------------------------
4.1.2 切换栈帧
----------------------------------------------------------------
  frame 0                     # 切到 #0 (当前调用者, 默认)
  f 1                         # 切到 #1 (上一级调用)
  frame address 0x7fff...     # 按地址切

  up                          # 向调用者方向走一层
  down                        # 向被调用者方向走一层

  up-silently 3               # 切 3 层但不打详细信息

----------------------------------------------------------------
4.1.3 看当前 frame 的信息
----------------------------------------------------------------
  info frame                  # 当前 frame 详情 (PC, saved regs, locals 地址)
  info frame 2                # frame #2 详情

  info locals                 # 当前 frame 的所有局部变量
  info args                   # 当前 frame 的所有参数
  info catch                  # 当前函数的 catch 块 (C++)

  info source                 # 当前 frame 的源文件 / 行号

----------------------------------------------------------------
4.1.4 切栈时的视图变化
----------------------------------------------------------------

切换 frame 后:
  print/p/display/list/disassemble 自动指向新 frame 的上下文

验证是否切换成功:
  info frame
  # 第一行: "Stack frame at 0x7fffffffe5f0:"
  # 第二行: " rip = 0x4005a6 in foo (foo.c:42); saved rip 0x4005b0"

================================================================
4.2 print — 万能变量查看
================================================================

print <expr> 是 GDB 最高频命令

----------------------------------------------------------------
4.2.1 基本用法
----------------------------------------------------------------
  print i                      # 变量
  print i + 1                  # 表达式
  print *ptr                   # 解引用
  print obj.field              # 字段
  print arr[3]                 # 数组元素
  print arr                    # 整个数组
  print ::global_var           # 全局变量 (用 :: 前缀消歧)
  print file1.c::global_var    # 限定文件
  print 'file1.c'::my_func     # 函数指针

----------------------------------------------------------------
4.2.2 调用函数
----------------------------------------------------------------
  print strlen("hello")        # 调函数
  print my_helper(x, y)        # 调自定义函数
  call my_helper(x, y)        # 等价于 print 但不显示结果

⚠️ 调有副作用的函数 = 改了被调试程序的状态!

----------------------------------------------------------------
4.2.3 格式控制
----------------------------------------------------------------
  print/x i                    # 十六进制
  print/d i                    # 有符号十进制 (默认)
  print/u i                    # 无符号十进制
  print/o i                    # 八进制
  print/t i                    # 二进制
  print/c i                    # 字符
  print/f i                    # 浮点
  print/a addr                 # 看 address 对应的符号 (函数/全局变量)
  print/s str_ptr              # 字符串 (到 \0 截止)
  print/r flags                # 位字段展开 (C++ bitfields)
  print/z size                 # size_t 格式

  # 同时显示多种格式
  print/xu i                   # 不会报错但 xu 不存在
  # 正确做法:
  print/x i
  print/u i

----------------------------------------------------------------
4.2.4 容器 (C++)
----------------------------------------------------------------
  print vec                    # std::vector (有 pretty printer 时)
  print vec.size()
  print vec[0]
  print map                    # std::map

⚠️ 默认 GDB 不打印 STL 容器细节, 需装 libstdc++ 的 pretty printer
  (参考第七章)

================================================================
4.3 display — 每次停下自动打印
================================================================

  display i                    # 每次停下自动 print i
  display                      # 看当前所有自动 display
  display/i $pc                # 显示当前指令
  display/x i+1                # 表达式
  undisplay 1                  # 删 #1
  disable display 1
  enable display 1

实战: 调试循环
  (gdb) break foo.c:42
  (gdb) display i
  (gdb) continue
  # 每次到 line 42 都打印 i

================================================================
4.4 修改变量 — 调试利器
================================================================

  set var i = 10
  set var buf[0] = 'A'
  set var *ptr = 0
  set {int}0x601040 = 99      # 写绝对地址
  set logging on               # 之后所有 print 写到日志
  set print elements 50       # 数组只显示前 50 个元素

⚠️ 改内存可能让程序进入未定义状态, 仅用于诊断

================================================================
4.5 info — 信息查看
================================================================

  info locals                  # 局部变量
  info args                    # 参数
  info variables my_*          # 全局变量 (正则)
  info functions my_*          # 函数 (正则)
  info registers               # 寄存器
  info reg $rax                # 单个寄存器
  info all-registers
  info registers float         # 浮点寄存器
  info registers vector        # 向量寄存器
  info address my_global       # 全局变量地址
  info symbol 0x4005a6         # 地址反查符号
  info line *0x4005a6          # 地址 → 行号
  info source                  # 当前源码信息
  info sources                 # 所有已加载的源文件
  info sharedlibrary           # 加载的动态库
  info files                   # 进程加载的所有文件
  info mappings                # 内存映射 (/proc/maps)

================================================================
4.6 反汇编 / 源码 / 寄存器 三视图
================================================================

  list                         # 当前行附近 10 行
  list 100                     # 100 行附近
  list foo.c:42                # 指定文件:行
  list my_func                 # 函数体
  list -                       # 上一段
  set listsize 30              # 每次 list 行数

  disassemble                  # 当前函数反汇编
  disassemble /r               # 含原始字节
  disassemble /m               # 源码 + 汇编混合 (最常用)
  disassemble $pc-32, $pc+32   # 当前指令前后
  disassemble my_func
  disassemble 0x4005a6

  # x86 语法: AT&T (默认) / Intel
  set disassembly-flavor intel

  # 跳转指令
  jump *0x4005a6               # 强制跳到某地址执行 (危险!)
  jump foo.c:42                # 跳到指定行

================================================================
4.7 内存查看 (examine / x)
================================================================

  x/<count><format><size> <addr>
  # count  数量
  # format x/d/u/o/t/a/f/i/s (按 p 同)
  # size   b/byte/h/halfword/w/word/g/giant(8B)

  x/16xb 0x601000             # 16 个字节, 十六进制
  x/16i $pc                   # 当前指令往后 16 条
  x/s str_ptr                 # 字符串
  x/4gx $rsp                  # 栈顶 4 个 8 字节
  x/64b array                 # 数组 64 字节

  # 找内容
  find /b 0x601000, 0x601100, 0x12
  # 在 [0x601000, 0x601100) 找字节 0x12

  find /g 0x601000, +0x100, 0xdeadbeef
  # 找 32-bit deadbeef

================================================================
4.8 寄存器操作
================================================================

  info registers               # 看寄存器
  p $rax                       # 单个
  p $rdi                       # 第一参数 (x86_64 调用约定)
  p $xmm0                      # 浮点寄存器
  p $rip                       # PC
  p $rsp                       # 栈指针

  set $rax = 10                # 改寄存器
  set $rdi = 0                 # 改第一参数

  # ptregs 显示所有寄存器
  info registers all

================================================================
4.9 内存读写
----------------------------------------------------------------
  set {int}0x601040 = 99
  # 把 0x601040 当 int, 写 99
  set {char[10]}buf = "hello"
  # 把 buf 当字符数组, 写字符串

  dump binary memory dump.bin 0x400000 0x500000
  # 把内存段写到文件
  dump ihex memory dump.hex 0x400000 0x500000
  # Intel HEX 格式

  restore binary dump.bin 0x601000
  # 从文件恢复内存

================================================================
4.10 调用约定速查 (x86_64 System V)
================================================================

  参数顺序:  rdi, rsi, rdx, rcx, r8, r9
  返回值:    rax
  第 7+ 参数: 栈
  caller-saved:  rax, rcx, rdx, rsi, rdi, r8, r9, r10, r11
  callee-saved:  rbx, rbp, r12, r13, r14, r15

  反汇编时, 一旦看到 call <func>:
  - 看 rdi/rsi/rdx 拿到前 3 个参数
  - call 后看 rax 拿返回值
  - 配合 p $rip 看 PC 是否在预期位置

================================================================
4.11 调试优化代码 (实战指南)
================================================================

-O0 vs -O2 区别:
  - 变量被优化掉 (寄存器)
  - 行号错位 (多条指令对应同一行)
  - 函数 inline
  - 循环展开 (break loop 多次命中)
  - 死代码消除 (有些代码永远跑不到)

应对:
  set debug compile-info on
  set debug symbol-loading on

  # 看 PC 附近的源码
  disassemble /m $pc-16, $pc+16

  # 用 print 而不是 display
  print *&var                  # 强取地址, 触发未优化副本

  # 看被优化掉的变量, 用 $rdi / $rsi 推断参数

  # 重新编译带 -O0 的副本
  CFLAGS=-O0 make

================================================================
4.12 实战模板: 段错误分析
================================================================

进程崩了, GDB 显示 SIGSEGV:

(gdb) bt                         调用栈
(gdb) info registers             寄存器
(gdb) disassemble $pc-32, $pc+32  反汇编
(gdb) x/16gx $rsp                栈内容
(gdb) info locals                当前 frame 局部变量

判断:
  - PC 在 0x0                  → NULL 指针解引用
  - PC 在某函数中但参数坏      → 调用者参数错
  - SP 接近 NULL                → 栈溢出 (无限递归)

================================================================
4.13 实战模板: 函数调用链分析
================================================================

想看清"业务请求进来, 调了哪些函数":

(gdb) rbreak my_module_.*        在 my_module 所有函数设断点
(gdb) commands 1-100
  silent
  bt 3
  continue
end
(gdb) continue
# 类似打日志, 不真正停下

更精确: 设条件断点只在特定 trace_id 时停
(gdb) break my_func if trace_id == 12345

================================================================
术语表 (本章)
================================================================

  frame               调用栈的一层
  backtrace (bt)      列出调用栈
  rip/eip             指令指针 (x86_64/x86)
  rsp/esp             栈指针
  rbp/ebp             基址指针 (frame pointer)
  rdi/rsi/rdx/rcx     x86_64 前 4 个参数
  rax                 返回值
  display             每次停下自动 print
  info locals         当前 frame 局部变量
  info args           当前 frame 参数
  find                内存查找
  jump                强制跳到指定位置执行