# GDB 使用说明 (五) 多线程 / 锁 / 信号

承接: (一) (二) (三) (四)
本节聚焦: 多线程调试 / pthread / 死锁 / 信号 / scheduler-locking

================================================================
5.1 多线程入门
================================================================

GDB 视角:
  inferior    = 进程 (PID 维度)
  thread      = 进程内的线程 (LWP 维度)

每个 thread 是独立的执行流, GDB 让你在它们之间切换

================================================================
5.2 线程相关命令
================================================================

----------------------------------------------------------------
5.2.1 查看 / 切换
----------------------------------------------------------------
  info threads                 # 所有线程 (带 * 是当前)
  thread 2                     # 切到 #2
  thread 2.3                   # 切到 inferior 2 的 thread 3 (多进程)
  thread apply 1 2 3 bt         # 对 1/2/3 各跑一次 bt
  thread apply all bt 5        # 所有线程都跑 bt 5
  thread apply all print i     # 所有线程打印 i
  thread find <description>    # 找特定线程 (GDB 12+)

----------------------------------------------------------------
5.2.2 线程名 / 优先级 (GDB 12+)
----------------------------------------------------------------
  thread name "worker-1"       # 给当前 thread 命名
  info threads -name           # 用名字显示

----------------------------------------------------------------
5.2.3 调度策略
----------------------------------------------------------------
  set scheduler-locking off    # 默认, 其它线程继续
  set scheduler-locking on     # 其它线程暂停 (死锁分析)
  set scheduler-locking step    # 仅 next/step 时暂停

⚠️ scheduler-locking on 让死锁变活锁, 但对单线程调试很有用

================================================================
5.3 调试 pthread 程序
================================================================

----------------------------------------------------------------
5.3.1 线程创建
----------------------------------------------------------------
  break pthread_create
  commands 1
    silent
    printf "tid=%d\n", *$rdi
    bt 3
    continue
  end

# 命中 pthread_create 后看: 谁创建了线程, 参数是什么

----------------------------------------------------------------
5.3.2 线程入口
----------------------------------------------------------------
  break start_routine
  commands 1
    silent
    printf "worker thread id=%lu started\n", pthread_self()
    bt 3
    continue
  end

----------------------------------------------------------------
5.3.3 线程局部存储 (TLS)
----------------------------------------------------------------
  print tls_var                # 直接 print TLS 变量
  print 'pthread_self()'        # 调 pthread_self

================================================================
5.4 死锁 / 锁调试
================================================================

死锁两大类:
  - 永久死锁: 互相等 (经典死锁)
  - 活锁: 不断尝试抢锁, 但都被拒

----------------------------------------------------------------
5.4.1 锁状态查看
----------------------------------------------------------------
  # Linux futex (内核视角, 用户态 pthread_mutex 用 futex)
  info threads                  # 卡在哪?

  # 看每个线程在等什么
  thread apply all bt 3

  # 看具体 futex 地址 (内核态)
  cat /proc/<pid>/wchan
  # 卡在 futex_wait 时会显示

  # GDB 视角的 pthread_mutex 状态
  # 需要 pretty printer (见第七章)

----------------------------------------------------------------
5.4.2 经典死锁定位模板
----------------------------------------------------------------

进程"挂死", 但 CPU 很低 (内核态空转)

(gdb) info threads
  * 1 Thread 0x7f...  worker_thread (waiting)
    2 Thread 0x7f...  worker_thread (waiting)

(gdb) thread 1
(gdb) bt
  #0  __lll_lock_wait (futex 地址 X)
  #1  pthread_mutex_lock
  #2  critical_section
  #3  my_func

(gdb) thread 2
(gdb) bt
  #0  __lll_lock_wait (futex 地址 Y)
  #1  pthread_mutex_lock
  #2  critical_section
  #3  another_func

→ A 在等 futex X, B 在等 futex Y, 但 X 在 B 手上, Y 在 A 手上 → 死锁

更高效: 一条命令看所有线程栈
(gdb) thread apply all bt 5

----------------------------------------------------------------
5.4.3 锁顺序审计
----------------------------------------------------------------

打印每次拿锁的顺序:
  (gdb) break pthread_mutex_lock
  (gdb) commands 1
    silent
    printf "lock=%p tid=%lu\n", $rdi, pthread_self()
    bt 2
    continue
  end
  (gdb) continue

  # 输出:
  # lock=0x601000 tid=1234
  #   critical_section (foo.c:100)
  # lock=0x601020 tid=1235
  #   critical_section (foo.c:200)

  # 看出两个线程拿到锁的顺序

================================================================
5.5 信号处理
================================================================

----------------------------------------------------------------
5.5.1 信号句柄配置
----------------------------------------------------------------
  handle SIGINT print nostop pass     # 收到时打印但不打断
  handle SIGINT stop                  # 停下让你看 (默认)
  handle SIGINT noprint nostop pass   # 完全忽略

  info signals                         # 看所有信号句柄
  handle                                # 等价

----------------------------------------------------------------
5.5.2 主动发信号
----------------------------------------------------------------
  signal SIGUSR1                       # 给 inferior 发 SIGUSR1
  signal 0                              # 仅检查它是否响应 (无副作用)

----------------------------------------------------------------
5.5.3 调试信号处理函数
----------------------------------------------------------------
  break sig_handler
  condition 1 signo == 15               # 仅 SIGTERM 触发
  continue

================================================================
5.6 调试 fork / exec / 多进程
================================================================

fork:
  catch fork
  # 命中时: GDB 跟父进程还是子进程?
  set follow-fork-mode child
  set detach-on-fork off                # 同时调试两个

  info inferiors
  inferior 1                            # 切回父
  inferior 2                            # 切到子

exec:
  catch exec

vfork:
  catch vfork

================================================================
5.7 线程栈特殊问题
================================================================

----------------------------------------------------------------
5.7.1 线程栈太小
----------------------------------------------------------------
  (gdb) info threads
  # 输出里 Thread <id> (tid=N) 后括号是 pthread ID, 不是栈地址

  ulimit -s                             # 主线程栈大小
  pthread_attr_getstack(&attr, &addr, &size)

----------------------------------------------------------------
5.7.2 线程栈破坏 (memory corruption)
----------------------------------------------------------------
  (gdb) x/16gx $rsp-$rsp%16            # 对齐后看栈
  (gdb) info frame
  # saved regs 异常 → 栈溢出

================================================================
5.8 原子操作 / 无锁编程
================================================================

  # C11 atomics / C++ atomics
  print atomic_val
  # 优化掉时显示 "<optimized out>"

  # 用 hardware watchpoint 抓谁改了
  watch atomic_val
  # 任何线程改动它都会停下

================================================================
5.9 多线程调试命令速查
================================================================

  info threads               所有线程
  thread <id>                切换当前线程
  thread apply all <cmd>     所有线程跑同一命令
  thread apply 1 2 <cmd>     指定线程跑
  thread name "name"         当前线程命名
  set scheduler-locking off/on/step

================================================================
5.10 实战模板: 现场进程高 CPU
================================================================

进程 100% CPU, 怀疑死循环:

# 1. 找到有问题的 LWP (内核态)
top -H -p <pid>
# 看哪个 LWP 占 CPU 高

# 2. attach GDB
gdb -p <pid>

# 3. 切到高 CPU 的 LWP
(gdb) info threads
# 找到对应 thread id
(gdb) thread 5

# 4. 多次取栈
(gdb) bt 10
(gdb) thread 5
(gdb) bt 10
(gdb) thread 5
(gdb) bt 10

# 如果三次 bt 都停在同一位置 → 真有死循环
# 如果位置在变 → 正常 CPU 占用

# 5. 看它在循环什么
(gdb) list $pc
(gdb) print loop_counter

================================================================
5.11 实战模板: 现场进程 hang (无响应)
================================================================

(gdb) thread apply all bt 10
# 看每个线程卡在哪

多数线程在同一个 futex → 在等一个永远不会来的锁
线程在多个 mutex 上交替 → 死锁
线程在 pthread_cond_wait → 某个条件永远不满足

进一步:
(gdb) thread 1
(gdb) print mutex_var
# 看锁状态
(gdb) print *(pthread_mutex_t*)lock_addr
# 解锁结构体

================================================================
5.12 ThreadSanitizer 配合
================================================================

编译加 -fsanitize=thread (见 TSan):
  gcc -O0 -g -fsanitize=thread -ltsan foo.c -o foo
  ./foo
  # 运行时 TSan 直接报告 data race

GDB 调试 TSan 报告:
  (gdb) break __tsan_on_report
  (gdb) run
  # TSan 报错时停下
  (gdb) bt

================================================================
5.13 并发原语速查
================================================================

| 类型              | POSIX 名                | 调试要点                    |
|------------------|------------------------|----------------------------|
| 互斥锁            | pthread_mutex_t         | 看 owner / wait list        |
| 读写锁            | pthread_rwlock_t        | 同上                        |
| 条件变量          | pthread_cond_t          | pthread_cond_wait 栈在哪    |
| 自旋锁            | pthread_spinlock_t      | 紧循环, 注意 100% CPU        |
| 信号量            | sem_t                   | count                      |
| 屏障              | pthread_barrier_t       | count                      |
| 无锁原子          | std::atomic<T>          | 用 watch 抓                |
| C++ future       | std::future             | 看 promise state            |

⚠️ 用户态看 pthread_mutex 内部细节需要 pretty printer (第七章)

================================================================
5.14 多进程 + 多线程
================================================================

  set follow-fork-mode child
  set detach-on-fork off

  info inferiors                # 看所有进程
  inferior 1                    # 切进程
  inferior 2                    # 切另一个进程

  # 当前进程的所有线程
  thread apply all bt 3

  # 跨进程: inferior 1 所有线程
  inferior 1
  thread apply all bt 3

================================================================
术语表 (本章)
================================================================

  LWP               轻量级进程, 内核调度单位 (Linux thread id)
  pthread_t         用户态 thread id (跟 LWP 不一定相同)
  futex             Linux 用户态同步原语 (pthread_mutex 内部用)
  scheduler-locking GDB 行为: 是否允许其它线程继续跑
  deadlock          互相等对方手里的资源
  livelock          不断尝试但都失败
  data race         无同步的并发访问
  TSan              ThreadSanitizer, 编译期插入运行时检查