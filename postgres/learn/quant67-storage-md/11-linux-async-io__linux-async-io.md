# 【存储工程】Linux 异步 I/O：从 POSIX AIO 到 io_uring

来源: https://quant67.com/post/storage/11-linux-async-io/linux-async-io.html
日期: 2025-08-20 |

---

在存储密集型应用中，I/O 往往是系统瓶颈的核心。传统的同步
            I/O 模型让线程在等待磁盘响应时白白浪费 CPU
            时间片，而线程池模型又带来了上下文切换（Context
            Switch）的开销。异步 I/O（Asynchronous
            I/O）的核心思想很简单：提交 I/O
            请求后立即返回，不阻塞调用线程，等 I/O
            完成后再通过某种机制通知应用程序。
            

Linux 上的异步 I/O 经历了三代演进：POSIX AIO
            是标准化但性能糟糕的用户态实现；Linux Native
            AIO（libaio）是内核级的真异步，但限制苛刻；io_uring 则是
            2019 年引入的革命性方案，通过共享内存环形缓冲区（Ring
            Buffer）实现了近乎零系统调用（Syscall）开销的异步 I/O。
            

本文不是 API
            手册的复述，而是从工程视角分析每一代方案的设计动机、实际性能表现和适用场景，帮助你理解为什么
            io_uring 正在成为 Linux 高性能 I/O 的事实标准。
            

## 一、同步 I/O 的瓶颈

            

### 1.1 阻塞 I/O 模型

            

最简单的 I/O 模型就是阻塞 I/O（Blocking I/O）。调用
            `read()` 或 `write()`
            时，线程会被挂起，直到数据从磁盘传输到用户空间缓冲区（或反过来）才会返回：
            
```
// 阻塞 I/O：线程在 read() 期间完全停滞
int fd = open("/data/block.dat", O_RDONLY);
char buf[4096];

// 如果数据不在页缓存中，线程将阻塞数百微秒到数毫秒
ssize_t n = read(fd, buf, sizeof(buf));
// 线程直到数据就绪才会继续执行
```

            

对于 HDD，一次随机读取的延迟大约是 5-10 毫秒；对于 SATA
            SSD，大约 50-100 微秒；对于 NVMe SSD，大约 10-20
            微秒。在阻塞模型中，线程在这段时间内完全空转，无法做任何有用的工作。
            

### 1.2
            线程池模型的可扩展性问题

            

为了在阻塞 I/O
            下实现并发，最常见的做法是使用线程池（Thread Pool）：
            
```
// 典型的线程池处理模型
void *worker_thread(void *arg) {
    while (1) {
        struct io_task *task = dequeue_task(task_queue);
        // 每个线程处理一个 I/O 请求——阻塞等待
        ssize_t n = pread(task->fd, task->buf, task->len, task->offset);
        task->callback(task, n);
    }
    return NULL;
}

// 创建 N 个工作线程
for (int i = 0; i 
            

这个模型的问题随着并发量增加变得越来越严重：
            
```
并发 I/O 数量    所需线程数    内存开销（8MB 栈/线程）    上下文切换
32               32           256 MB                      可接受
256              256          2 GB                        频繁
1024             1024         8 GB                        灾难性
4096             4096         32 GB                       系统不可用
```

            

### 1.3 上下文切换的代价

            

上下文切换（Context
            Switch）不仅仅是保存和恢复寄存器那么简单。它还涉及：
            
```
上下文切换的隐藏成本：

1. 直接成本
   - 保存/恢复 CPU 寄存器：~100ns
   - 切换内存映射（TLB Flush）：~1-5μs
   - 调度器决策：~100ns

2. 间接成本
   - L1/L2/L3 缓存污染：新线程的工作集覆盖旧线程的热数据
   - TLB（Translation Lookaside Buffer）失效：地址翻译重建
   - 分支预测器（Branch Predictor）状态丢失
   
3. 总体影响
   - 每次上下文切换的实际代价：5-50μs（取决于工作集大小）
   - 当切换频率超过每秒 10,000 次时，系统开始显著退化
   - NVMe SSD 单盘可达 100 万 IOPS——意味着需要 100 万次/秒的切换
```

            

### 1.4
            为什么存储系统需要异步 I/O

            

现代 NVMe SSD 的性能特征决定了同步 I/O
            模型的不可行性：
            
```
设备类型          单次延迟     IOPS 峰值      所需并发 I/O 数
HDD               5ms         200            1-4
SATA SSD          100μs       50,000         16-32
NVMe SSD          15μs        500,000        64-128
Intel Optane       10μs       750,000        128-256
NVMe SSD（多队列） 10μs       1,000,000+     256+
```

            

要充分利用一块 NVMe SSD 的 IOPS
            能力，需要同时保持数百个未完成的 I/O 请求（I/O
            Depth）。如果用线程池模型，就需要数百个线程——这在上下文切换和内存方面都是不可接受的。
            

异步 I/O
            的核心价值在于：用少量线程（甚至单线程）驱动大量并发
            I/O，避免上下文切换的开销，同时保持高 I/O 深度（I/O
            Depth）以充分利用设备带宽。
            

## 二、POSIX AIO（用户态异步
            I/O）

            

### 2.1 API 概述

            

POSIX AIO 是 POSIX 标准（POSIX.1b）中定义的异步 I/O
            接口。它的核心 API 包括：
            
```
#include 

// 异步读取
int aio_read(struct aiocb *aiocbp);

// 异步写入
int aio_write(struct aiocb *aiocbp);

// 检查操作状态（非阻塞）
int aio_error(const struct aiocb *aiocbp);

// 获取操作结果（完成后调用）
ssize_t aio_return(struct aiocb *aiocbp);

// 等待一组操作完成
int aio_suspend(const struct aiocb *const list[], int nent,
                const struct timespec *timeout);

// 取消操作
int aio_cancel(int fd, struct aiocb *aiocbp);

// 批量提交（列表 I/O）
int lio_listio(int mode, struct aiocb *const list[], int nent,
               struct sigevent *sig);
```

            

核心数据结构是 `aiocb`（AIO Control
            Block）：
            
```
struct aiocb {
    int             aio_fildes;     // 文件描述符
    off_t           aio_offset;     // 文件偏移量
    volatile void  *aio_buf;        // 数据缓冲区
    size_t          aio_nbytes;     // 读写字节数
    int             aio_reqprio;    // 请求优先级
    struct sigevent aio_sigevent;   // 完成通知方式
    int             aio_lio_opcode; // lio_listio 操作码
    // ... 内部字段
};
```

            

### 2.2 glibc 实现的真相

            

POSIX AIO 的 API 看起来很合理，但 glibc
            的实现却令人失望。glibc 的 POSIX AIO 并不是真正的内核级异步
            I/O，而是在用户空间通过线程池模拟的：
            
```
POSIX AIO（glibc 实现）的工作流程：

应用线程                    glibc 内部线程池
    |                           |
    |-- aio_read(aiocb) ------->|
    |   （立即返回）              |-- 创建/复用工作线程
    |                           |-- 工作线程调用 pread()（阻塞！）
    |                           |-- pread() 返回
    |                           |-- 设置 aiocb 状态为完成
    ||
    |   （获取结果）
```

            

这意味着 POSIX AIO
            本质上就是系统帮你管理了一个线程池，每个异步操作仍然会在底层阻塞一个线程。这带来的问题包括：
            
            
- 线程创建和销毁的开销
            
- 线程池管理的复杂性
            
- 与直接使用线程池相比没有性能优势
            
- 信号通知机制在多线程程序中容易出问题
            
            

### 2.3 通知机制

            

POSIX AIO 支持两种完成通知方式：
            
```
// 方式一：信号通知（Signal Notification）
struct aiocb cb;
memset(&cb, 0, sizeof(cb));
cb.aio_fildes = fd;
cb.aio_buf = buffer;
cb.aio_nbytes = BUF_SIZE;
cb.aio_offset = 0;

// 使用信号通知完成
cb.aio_sigevent.sigev_notify = SIGEV_SIGNAL;
cb.aio_sigevent.sigev_signo = SIGUSR1;
cb.aio_sigevent.sigev_value.sival_ptr = &cb;

// 方式二：线程回调通知（Thread Callback）
cb.aio_sigevent.sigev_notify = SIGEV_THREAD;
cb.aio_sigevent.sigev_notify_function = my_callback;
cb.aio_sigevent.sigev_notify_attributes = NULL;
cb.aio_sigevent.sigev_value.sival_ptr = &cb;

// 方式三：不通知，由应用主动轮询
cb.aio_sigevent.sigev_notify = SIGEV_NONE;
```

            

信号通知在多线程环境中极易引发竞争条件和信号丢失问题；线程回调会创建额外的线程，增加开销。这两种方式在实践中都不理想。
            

### 2.4 完整示例

            

以下是一个使用 POSIX AIO 进行异步文件读取的完整示例：
            
```
#define _GNU_SOURCE
#include 
#include 
#include 
#include 
#include 
#include 
#include 
#include 

#define BUF_SIZE 4096
#define NUM_OPS  4

int main(int argc, char *argv[]) {
    if (argc \n", argv[0]);
        return 1;
    }

    int fd = open(argv[1], O_RDONLY);
    if (fd 
            

编译命令：
            
```
gcc -o posix_aio_demo posix_aio_demo.c -lrt
```

            

### 2.5 POSIX AIO
            的局限性总结

            
```
POSIX AIO 的主要问题：

1. 伪异步：glibc 实现使用用户态线程池，并非内核级异步
2. 性能差：与手动管理线程池相比没有优势，甚至更差
3. API 复杂：aiocb 结构体字段繁多，错误处理困难
4. 通知机制不可靠：信号在多线程中易出问题
5. 缺乏批量操作：lio_listio 的实现质量因平台而异
6. 无法利用内核优化：无法绕过页缓存，无法合并请求
7. 可移植性虚假：各平台实现差异大，行为不一致
```

            

## 三、Linux Native
            AIO（libaio）

            

### 3.1 真正的内核异步 I/O

            

Linux Native AIO（通常称为 libaio 或 kaio）是 Linux
            内核（Kernel）提供的真正异步 I/O 接口。与 POSIX AIO
            不同，libaio 的 I/O
            请求直接提交给内核，由内核异步完成——不需要额外的用户态线程。
            

核心系统调用：
            
```
#include 
- 

// 创建异步 I/O 上下文
int io_setup(unsigned nr_events, io_context_t *ctx_idp);

// 提交 I/O 请求
int io_submit(io_context_t ctx_id, long nr, struct iocb **iocbpp);

// 等待 I/O 完成事件
int io_getevents(io_context_t ctx_id, long min_nr, long nr,
                 struct io_event *events, struct timespec *timeout);

// 销毁异步 I/O 上下文
int io_destroy(io_context_t ctx_id);
```

            

### 3.2 iocb
            结构体与事件处理

            
```
// I/O 控制块（I/O Control Block）
struct iocb {
    __u64   aio_data;       // 用户自定义数据（回调时返回）
    __u32   aio_key;        // 内核内部使用
    __u16   aio_lio_opcode; // 操作类型：IOCB_CMD_PREAD / IOCB_CMD_PWRITE
    __s16   aio_reqprio;    // 请求优先级
    __u32   aio_fildes;     // 文件描述符
    __u64   aio_buf;        // 缓冲区地址
    __u64   aio_nbytes;     // 字节数
    __s64   aio_offset;     // 文件偏移量
    // ... 其他字段
};

// 完成事件
struct io_event {
    __u64   data;           // 来自 iocb.aio_data 的用户数据
    __u64   obj;            // 指向原始 iocb 的指针
    __s64   res;            // 操作结果（成功时为字节数，失败时为负错误码）
    __s64   res2;           // 保留字段
};
```

            

libaio 提供了便捷的宏来初始化 `iocb`：
            
```
// 初始化 iocb 用于读操作
void io_prep_pread(struct iocb *iocb, int fd, void *buf,
                   size_t count, long long offset);

// 初始化 iocb 用于写操作
void io_prep_pwrite(struct iocb *iocb, int fd, void *buf,
                    size_t count, long long offset);

// 设置用户自定义数据
void io_set_callback(struct iocb *iocb, io_callback_t handler);
```

            

### 3.3 O_DIRECT 限制

            

libaio 最大的限制是：它要求文件以 `O_DIRECT`
            模式打开，并且缓冲区必须对齐（Aligned）。如果不使用
            `O_DIRECT`，libaio 会退化为同步操作——内核会在
            `io_submit()` 内部完成 I/O，而不是异步返回。
            
```
// libaio 要求 O_DIRECT 打开文件
int fd = open("/data/test.dat", O_RDONLY | O_DIRECT);

// 缓冲区必须按扇区大小（通常 512 字节）对齐
void *buf;
int ret = posix_memalign(&buf, 512, 4096);
if (ret != 0) {
    fprintf(stderr, "posix_memalign 失败\n");
    return 1;
}

// I/O 大小也必须是扇区大小的整数倍
// 4096 = 512 * 8  --> OK
// 4000             --> 会返回 -EINVAL
```

            

这个限制意味着 libaio 不支持缓冲 I/O（Buffered
            I/O），无法利用页缓存（Page
            Cache）。对于需要频繁读取热数据的场景，应用程序必须自己实现缓存层。
            

### 3.4 完整示例

            
```
#define _GNU_SOURCE
#include 
#include 
#include 
#include 
#include 
#include 
- 
#include 

#define BUF_SIZE   4096
#define ALIGN_SIZE 512
#define NUM_OPS    8
#define MAX_EVENTS 32

int main(int argc, char *argv[]) {
    if (argc \n", argv[0]);
        return 1;
    }

    // 必须使用 O_DIRECT
    int fd = open(argv[1], O_RDONLY | O_DIRECT);
    if (fd  0) {
        // 至少等待 1 个事件，最多收割 remaining 个
        int n = io_getevents(ctx, 1, remaining, events, NULL);
        if (n 
            

编译命令：
            
```
gcc -o libaio_demo libaio_demo.c -laio
```

            

### 3.5 libaio 与 POSIX AIO
            的对比

            
```
特性                    POSIX AIO（glibc）       Linux Native AIO（libaio）
─────────────────────────────────────────────────────────────────────────
实现层级                用户态线程池               内核态
是否真异步              否                         是
需要 O_DIRECT           否                         是
支持缓冲 I/O            是                         否
批量提交                有限（lio_listio）         是（io_submit 批量）
完成通知                信号/线程回调               io_getevents 轮询
每个请求的开销          一个线程                    无额外线程
适用场景                兼容性需求                  数据库、存储引擎
典型用户                很少有人使用               MySQL InnoDB、Oracle
API 复杂度              中等                       较低
性能（4K 随机读 IOPS）  约 50,000                  约 400,000
```

            

### 3.6 libaio 的局限性

            

尽管 libaio 是真正的内核异步
            I/O，但它仍然有不少限制：
            
```
libaio 的主要限制：

1. 强制 O_DIRECT：不支持缓冲 I/O，应用必须自己管理缓存
2. 特定文件系统限制：某些文件系统（如旧版 ext3）不完全支持
3. 元数据操作不支持：只支持数据读写，不支持 fsync、stat 等
4. 有时仍然同步：某些条件下（如文件扩展），io_submit 会阻塞
5. 每次 io_getevents 需要系统调用：高频收割有一定开销
6. 不支持网络 I/O：只能用于块设备和文件
7. API 不够现代：缺乏链式操作、超时控制等特性
```

            

## 四、io_uring 设计革新

            

### 4.1 诞生背景

            

io_uring 由 Linux 内核块层（Block Layer）维护者 Jens
            Axboe 于 2019 年设计，随 Linux 5.1
            内核合入主线。它的设计目标很明确：解决 libaio
            的所有限制，同时实现接近零系统调用开销的异步 I/O。
            
```
io_uring 要解决的核心问题：

1. 系统调用开销：libaio 每次提交和收割都需要 syscall
   → io_uring：通过共享内存环形缓冲区，提交和收割可以无 syscall

2. O_DIRECT 限制：libaio 不支持缓冲 I/O
   → io_uring：完全支持缓冲 I/O 和直接 I/O

3. 操作类型限制：libaio 只支持读写
   → io_uring：支持 fsync、fallocate、accept、recv、send 等 60+ 种操作

4. 无法链式操作：libaio 的请求之间无法表达依赖
   → io_uring：支持链式 SQE，可表达 write → fsync 的顺序依赖

5. 批量效率：libaio 的 io_submit 仍需拷贝 iocb 数组
   → io_uring：SQE 直接写入共享内存，无需拷贝
```

            

### 4.2 共享内存环形缓冲区

            

io_uring
            的核心设计思想是在用户空间和内核空间之间建立两个共享的环形缓冲区（Ring
            Buffer）：
            
```
用户空间                              内核空间
┌──────────────┐                    ┌──────────────┐
│   应用程序    │                    │    内核       │
│              │                    │              │
│  ┌────────┐  │    共享内存         │  ┌────────┐  │
│  │  SQ    │──│───────────────────│──│  SQ    │  │
│  │ (提交) │  │  Submission Queue  │  │ (消费) │  │
│  └────────┘  │                    │  └────────┘  │
│              │                    │              │
│  ┌────────┐  │    共享内存         │  ┌────────┐  │
│  │  CQ    │──│───────────────────│──│  CQ    │  │
│  │ (消费) │  │  Completion Queue  │  │ (生产) │  │
│  └────────┘  │                    │  └────────┘  │
└──────────────┘                    └──────────────┘

SQ（Submission Queue）：应用写入请求 → 内核读取并执行
CQ（Completion Queue）：内核写入结果 → 应用读取完成事件

关键：两个环形缓冲区通过 mmap 映射到用户空间，
     读写操作只需要修改内存中的头尾指针——无需系统调用！
```

            

### 4.3 SQE 与 CQE

            

提交队列条目（Submission Queue
            Entry，SQE）和完成队列条目（Completion Queue Entry，CQE）是
            io_uring 的基本数据单元：
            
```
// SQE：描述一个 I/O 请求（64 字节）
struct io_uring_sqe {
    __u8    opcode;         // 操作码：IORING_OP_READ, IORING_OP_WRITE, ...
    __u8    flags;          // 标志：IOSQE_IO_LINK, IOSQE_FIXED_FILE, ...
    __u16   ioprio;         // I/O 优先级
    __s32   fd;             // 文件描述符
    union {
        __u64 off;          // 文件偏移量
        __u64 addr2;
    };
    union {
        __u64 addr;         // 缓冲区地址
        __u64 splice_off_in;
    };
    __u32   len;            // 缓冲区长度
    union {
        __kernel_rwf_t rw_flags;  // 读写标志
        __u32   fsync_flags;      // fsync 标志
        // ... 其他操作特定的标志
    };
    __u64   user_data;      // 用户自定义数据（CQE 中原样返回）
    // ... 填充字段
};

// CQE：描述一个完成事件（16 字节）
struct io_uring_cqe {
    __u64   user_data;      // 来自 SQE 的用户数据
    __s32   res;            // 操作结果（字节数或负错误码）
    __u32   flags;          // 标志（如 IORING_CQE_F_MORE）
};
```

            

### 4.4 三个系统调用

            

尽管 io_uring 的目标是减少系统调用，但它仍然需要三个基础
            syscall：
            
```
#include 
- 
#include 

// 1. 初始化 io_uring 实例
//    创建 SQ 和 CQ，返回用于 mmap 的文件描述符
int io_uring_setup(unsigned entries, struct io_uring_params *p);

// 2. 提交 SQE 并/或等待 CQE
//    to_submit：要提交的 SQE 数量
//    min_complete：最少等待完成的 CQE 数量
//    flags：IORING_ENTER_GETEVENTS, IORING_ENTER_SQ_WAKEUP, ...
int io_uring_enter(unsigned fd, unsigned to_submit,
                   unsigned min_complete, unsigned flags,
                   sigset_t *sig);

// 3. 注册资源（文件描述符、缓冲区等）以减少每次操作的开销
int io_uring_register(unsigned fd, unsigned opcode,
                      void *arg, unsigned nr_args);
```

            

在最优场景下（SQPOLL 模式），应用只需要在初始化时调用
            `io_uring_setup()` 和
            `io_uring_register()`，之后的提交和收割完全在用户空间完成，无需任何系统调用。
            

### 4.5 零拷贝提交路径

            

传统异步 I/O（如
            libaio）的提交流程需要将用户空间的请求描述符拷贝到内核空间。io_uring
            消除了这个拷贝：
            
```
libaio 提交路径：
  用户态: 填充 iocb 数组
  ──── io_submit() 系统调用 ────
  内核态: 拷贝 iocb 数组到内核空间
          解析请求，提交到块层
  ──── 返回用户态 ────

io_uring 提交路径：
  用户态: 直接写入 SQE 到共享内存环形缓冲区
          更新 SQ tail 指针
  ──── io_uring_enter()（或 SQPOLL 模式下无需 syscall）────
  内核态: 直接从共享内存读取 SQE（零拷贝）
          提交到块层
  ──── 返回用户态（或无需返回）────
```

            

### 4.6 批量操作

            

io_uring 的环形缓冲区天然支持批量操作。应用可以先写入多个
            SQE，然后通过一次 `io_uring_enter()`
            调用提交所有请求：
            
```
// 批量提交示例流程
for (int i = 0; i 
```
#include 
- 

// 初始化 io_uring 实例
int io_uring_queue_init(unsigned entries, struct io_uring *ring,
                        unsigned flags);

// 获取一个空闲的 SQE 槽位
struct io_uring_sqe *io_uring_get_sqe(struct io_uring *ring);

// 准备各种操作
void io_uring_prep_readv(struct io_uring_sqe *sqe, int fd,
                         const struct iovec *iovecs,
                         unsigned nr_vecs, off_t offset);
void io_uring_prep_writev(struct io_uring_sqe *sqe, int fd,
                          const struct iovec *iovecs,
                          unsigned nr_vecs, off_t offset);
void io_uring_prep_read(struct io_uring_sqe *sqe, int fd,
                        void *buf, unsigned nbytes, off_t offset);
void io_uring_prep_write(struct io_uring_sqe *sqe, int fd,
                         void *buf, unsigned nbytes, off_t offset);
void io_uring_prep_fsync(struct io_uring_sqe *sqe, int fd,
                         unsigned flags);

// 设置用户数据
void io_uring_sqe_set_data(struct io_uring_sqe *sqe, void *data);

// 提交请求
int io_uring_submit(struct io_uring *ring);

// 等待完成事件
int io_uring_wait_cqe(struct io_uring *ring,
                      struct io_uring_cqe **cqe_ptr);
int io_uring_peek_cqe(struct io_uring *ring,
                      struct io_uring_cqe **cqe_ptr);

// 标记 CQE 已处理
void io_uring_cqe_seen(struct io_uring *ring,
                       struct io_uring_cqe *cqe);

// 获取用户数据
void *io_uring_cqe_get_data(struct io_uring_cqe *cqe);

// 销毁
void io_uring_queue_exit(struct io_uring *ring);
```

            

### 5.2 基本工作流程

            

io_uring 的典型工作流程非常清晰：
            
```
io_uring 编程工作流：

1. 初始化
   io_uring_queue_init(队列深度, &ring, flags)

2. 提交请求（可重复多次）
   sqe = io_uring_get_sqe(&ring)         // 获取 SQE 槽位
   io_uring_prep_readv(sqe, fd, ...)     // 填充操作
   io_uring_sqe_set_data(sqe, user_ptr)  // 设置用户数据
   io_uring_submit(&ring)                // 提交到内核

3. 收割完成事件
   io_uring_wait_cqe(&ring, &cqe)        // 等待完成
   result = cqe->res                      // 获取结果
   user_ptr = io_uring_cqe_get_data(cqe)  // 获取用户数据
   io_uring_cqe_seen(&ring, cqe)          // 标记已处理

4. 清理
   io_uring_queue_exit(&ring)
```

            

### 5.3
            完整示例：异步文件读取

            
```
#define _GNU_SOURCE
#include 
#include 
#include 
#include 
#include 
#include 
- 

#define QUEUE_DEPTH 16
#define BUF_SIZE    4096
#define NUM_READS   8

struct read_request {
    int      index;
    off_t    offset;
    char     buf[BUF_SIZE];
    struct iovec iov;
};

int main(int argc, char *argv[]) {
    if (argc \n", argv[0]);
        return 1;
    }

    // 打开文件
    int fd = open(argv[1], O_RDONLY);
    if (fd res index, strerror(-cqe->res));
        } else {
            printf("请求 %d 完成：偏移 %lld，读取 %d 字节\n",
                   req->index, (long long)req->offset, cqe->res);
        }

        io_uring_cqe_seen(&ring, cqe);
    }

    // 清理
    free(reqs);
    io_uring_queue_exit(&ring);
    close(fd);
    return 0;
}
```

            

编译命令：
            
```
gcc -o uring_read_demo uring_read_demo.c -luring
```

            

### 5.4 完整示例：链式写入与
            fsync

            

在存储引擎中，一个常见的需求是”写入数据后立即 fsync
            刷盘”。io_uring 的链式 SQE（Linked
            SQE）可以优雅地表达这种依赖关系：
            
```
#define _GNU_SOURCE
#include 
#include 
#include 
#include 
#include 
#include 
- 

#define QUEUE_DEPTH 32
#define BUF_SIZE    4096

enum op_type {
    OP_WRITE = 1,
    OP_FSYNC = 2,
};

struct op_context {
    enum op_type type;
    int          seq;
};

int main(int argc, char *argv[]) {
    if (argc \n", argv[0]);
        return 1;
    }

    int fd = open(argv[1], O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd flags |= IOSQE_IO_LINK;  // 链接到下一个 SQE

        contexts[i * 2].type = OP_WRITE;
        contexts[i * 2].seq = i;
        io_uring_sqe_set_data(sqe_write, &contexts[i * 2]);

        // fsync SQE（链中的下一个操作）
        struct io_uring_sqe *sqe_fsync = io_uring_get_sqe(&ring);
        if (!sqe_fsync) {
            fprintf(stderr, "无法获取 SQE\n");
            return 1;
        }
        io_uring_prep_fsync(sqe_fsync, fd, 0);

        contexts[i * 2 + 1].type = OP_FSYNC;
        contexts[i * 2 + 1].seq = i;
        io_uring_sqe_set_data(sqe_fsync, &contexts[i * 2 + 1]);
    }

    // 提交所有链式操作
    ret = io_uring_submit(&ring);
    printf("已提交 %d 个 SQE（%d 组 write→fsync 链）\n", ret, num_writes);

    // 收割所有完成事件
    int total_cqes = num_writes * 2;
    for (int i = 0; i type == OP_WRITE) ? "WRITE" : "FSYNC";

        if (cqe->res seq, op_name, strerror(-cqe->res));
        } else {
            printf("链 %d %s 完成（结果: %d）\n",
                   ctx->seq, op_name, cqe->res);
        }

        io_uring_cqe_seen(&ring, cqe);
    }

    free(write_buf);
    free(contexts);
    io_uring_queue_exit(&ring);
    close(fd);
    return 0;
}
```

            

### 5.5 错误处理要点

            
```
// io_uring 错误处理的关键模式

// 1. 初始化失败
struct io_uring ring;
int ret = io_uring_queue_init(QUEUE_DEPTH, &ring, 0);
if (ret res == -EAGAIN) {
    // 资源暂时不可用，可重试
} else if (cqe->res == -ECANCELED) {
    // 操作被取消（链式操作中前序失败）
} else if (cqe->res == -EINVAL) {
    // 参数无效（检查缓冲区对齐、文件描述符等）
} else if (cqe->res res));
}

// 4. 短读/短写处理
if (cqe->res >= 0 && (size_t)cqe->res res;
    new_offset = original_offset + cqe->res;
}
```

            

## 六、io_uring 高级特性

            

### 6.1 SQPOLL 模式

            

SQPOLL（Submission Queue Polling）模式是 io_uring
            最激进的优化：内核启动一个专用的轮询线程（Kernel
            Thread），持续检查 SQ 是否有新的 SQE。应用只需要将 SQE
            写入共享内存并更新 tail
            指针，内核线程就会自动发现并提交——完全不需要
            `io_uring_enter()` 系统调用。
            
```
// 启用 SQPOLL 模式
struct io_uring ring;
struct io_uring_params params;
memset(¶ms, 0, sizeof(params));
params.flags = IORING_SETUP_SQPOLL;
params.sq_thread_idle = 2000;  // 空闲 2 秒后内核线程休眠

int ret = io_uring_queue_init_params(QUEUE_DEPTH, &ring, ¶ms);
if (ret 
            

SQPOLL 模式下的数据流：
            
```
SQPOLL 模式工作流程：

应用线程                         内核 SQPOLL 线程
    |                                |
    |-- 写入 SQE 到共享内存 -------->|（自动检测到新 SQE）
    |   （无 syscall！）              |-- 提交到块层
    |                                |-- I/O 完成
    |                                |-- 写入 CQE 到共享内存
    |
```
// 注册固定文件描述符（Fixed Files）
int fds[MAX_FDS];
for (int i = 0; i flags |= IOSQE_FIXED_FILE;                // 标记使用固定文件

// 注册固定缓冲区（Fixed Buffers）
struct iovec iovecs[NUM_BUFS];
for (int i = 0; i 
            

性能影响：
            
```
固定资源的性能收益（4K 随机读，队列深度 128）：

配置                           IOPS       相对提升
普通文件 + 普通缓冲区          680,000    基准
固定文件 + 普通缓冲区          720,000    +5.9%
普通文件 + 固定缓冲区          730,000    +7.4%
固定文件 + 固定缓冲区          780,000    +14.7%
固定文件 + 固定缓冲区 + SQPOLL  820,000    +20.6%
```

            

### 6.3 链式 SQE（Linked SQE）

            

链式 SQE 允许表达操作间的依赖关系。链中的每个 SQE 通过
            `IOSQE_IO_LINK`
            标志连接，后续操作只有在前序操作成功后才会执行：
            
```
// 链式操作：write → fdatasync → write → fdatasync
// 如果链中任何操作失败，后续操作会被取消（返回 -ECANCELED）

struct io_uring_sqe *sqe;

// 第一次写入（链的起始）
sqe = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe, fd, data1, len1, offset1);
sqe->flags |= IOSQE_IO_LINK;  // 链接到下一个

// fdatasync（只刷数据，不刷元数据）
sqe = io_uring_get_sqe(&ring);
io_uring_prep_fsync(sqe, fd, IORING_FSYNC_DATASYNC);
sqe->flags |= IOSQE_IO_LINK;  // 继续链接

// 第二次写入
sqe = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe, fd, data2, len2, offset2);
sqe->flags |= IOSQE_IO_LINK;

// 最后的 fdatasync（链的结尾，不设置 LINK 标志）
sqe = io_uring_get_sqe(&ring);
io_uring_prep_fsync(sqe, fd, IORING_FSYNC_DATASYNC);

// 硬链接（IOSQE_IO_HARDLINK）：即使前序操作失败，也继续执行后续操作
sqe = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe, fd, data3, len3, offset3);
sqe->flags |= IOSQE_IO_HARDLINK;

sqe = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe, fd, data4, len4, offset4);

io_uring_submit(&ring);
```

            

### 6.4
            多次触发操作（Multishot）

            

传统的 I/O 操作是一次性的：一个 SQE 产生一个
            CQE。多次触发操作（Multishot Operation）允许一个 SQE
            产生多个 CQE，适用于需要反复执行相同操作的场景：
            
```
// Multishot accept：一个 SQE 持续接受新连接
struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_multishot_accept(sqe, listen_fd, NULL, NULL, 0);
io_uring_sqe_set_data64(sqe, ACCEPT_TAG);
io_uring_submit(&ring);

// 每次有新连接到来，都会产生一个 CQE
// CQE 的 flags 中包含 IORING_CQE_F_MORE 表示还会有更多
while (1) {
    struct io_uring_cqe *cqe;
    io_uring_wait_cqe(&ring, &cqe);

    if (cqe->res res;
        // 处理新连接
    }

    // 检查是否还有更多（IORING_CQE_F_MORE）
    int more = cqe->flags & IORING_CQE_F_MORE;
    io_uring_cqe_seen(&ring, cqe);

    if (!more) {
        // Multishot 操作终止，需要重新提交
        break;
    }
}
```

            

### 6.5 io_uring 与网络 I/O

            

io_uring 不仅支持文件 I/O，还支持丰富的网络操作：
            
```
// 支持的网络操作码
IORING_OP_ACCEPT        // 接受连接
IORING_OP_CONNECT       // 发起连接
IORING_OP_RECV          // 接收数据
IORING_OP_SEND          // 发送数据
IORING_OP_RECVMSG       // 接收消息（带辅助数据）
IORING_OP_SENDMSG       // 发送消息
IORING_OP_SHUTDOWN      // 关闭连接
IORING_OP_SOCKET        // 创建套接字（内核 5.19+）
IORING_OP_SEND_ZC       // 零拷贝发送（内核 6.0+）

// 示例：异步 recv
struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_recv(sqe, client_fd, recv_buf, buf_size, 0);
io_uring_sqe_set_data(sqe, conn_ctx);
io_uring_submit(&ring);
```

            

### 6.6 提供缓冲区环（Buffer
            Ring）

            

内核 5.19 引入的缓冲区环（Provided Buffer
            Ring）允许内核自动从预注册的缓冲区池中选择缓冲区，避免了应用为每个
            I/O 请求预先分配缓冲区的需要：
            
```
// 设置缓冲区环
struct io_uring_buf_ring *br;
int bgid = 0;  // Buffer Group ID

// 注册缓冲区环
br = io_uring_setup_buf_ring(&ring, NUM_BUFS, bgid, 0, &ret);
if (!br) {
    fprintf(stderr, "设置缓冲区环失败: %s\n", strerror(-ret));
    return 1;
}

// 向缓冲区环添加缓冲区
for (int i = 0; i flags |= IOSQE_BUFFER_SELECT;                // 让内核选择缓冲区
sqe->buf_group = bgid;                             // 指定缓冲区组

// 在 CQE 中获取内核选择的缓冲区 ID
struct io_uring_cqe *cqe;
io_uring_wait_cqe(&ring, &cqe);
int buf_id = cqe->flags >> IORING_CQE_BUFFER_SHIFT;
char *selected_buf = bufs[buf_id];
```

            

## 七、io_uring
            在存储系统中的应用

            

### 7.1 SPDK 与 io_uring

            

SPDK（Storage Performance Development Kit）是 Intel
            开发的高性能存储框架，传统上使用用户态 NVMe 驱动（Userspace
            NVMe Driver）绕过内核以获得极致性能。自 SPDK 20.01 起，SPDK
            也支持 io_uring
            作为后端，为不需要或无法使用用户态驱动的场景提供了高性能替代方案：
            
```
SPDK 的 I/O 后端选择：

后端                性能          部署复杂度    适用场景
用户态 NVMe 驱动    最高          高            专用存储节点
io_uring            很高          低            通用服务器
libaio              高            低            旧内核兼容
内核 NVMe 驱动      基准          最低          普通应用
```

            

### 7.2 RocksDB 的 io_uring
            后端

            

RocksDB 从 6.7 版本开始引入了 io_uring
            支持，主要用于多文件并行读取（MultiGet）操作。RocksDB 的
            `MultiRead` 接口利用 io_uring 将多个 SST
            文件的读取请求合并为一次批量提交：
            
```
RocksDB MultiGet 的 io_uring 优化：

传统流程（同步）：
  MultiGet(keys) → 逐个文件 pread() → 逐个返回
  
io_uring 流程：
  MultiGet(keys)
    → 确定需要读取的 SST 文件和偏移
    → 批量提交 io_uring 读取请求
    → 一次性收割所有完成事件
    → 返回结果

性能提升（100 个 key 的 MultiGet，NVMe SSD）：
  同步 pread：  ~800μs
  io_uring：    ~200μs（约 4 倍提升）
```

            

### 7.3 PostgreSQL 与
            io_uring

            

PostgreSQL 社区正在积极探索 io_uring
            的集成。主要的应用场景包括：
            
```
PostgreSQL io_uring 潜在应用：

1. WAL 写入：write → fdatasync 链式操作
2. 检查点（Checkpoint）：并行刷脏页（Dirty Page Flush）
3. 预读取（Prefetch）：索引扫描时的异步预读
4. 排序溢出（External Sort）：临时文件的异步读写
5. 并行恢复（Recovery）：WAL 回放时的批量 I/O

当前状态：
  - Andres Freund 的 AIO 子系统补丁集正在评审中
  - 预计在 PostgreSQL 18 或 19 中合入
  - 初步基准测试显示检查点性能提升 30-50%
```

            

### 7.4 自定义存储引擎中的
            io_uring

            

在构建自定义存储引擎时，io_uring 的典型使用模式如下：
            
```
// 存储引擎中的典型 io_uring 集成模式
struct storage_engine {
    struct io_uring ring;
    int             data_fd;
    int             wal_fd;
    // ...
};

// 初始化
int storage_engine_init(struct storage_engine *engine) {
    struct io_uring_params params;
    memset(¶ms, 0, sizeof(params));

    // 生产环境建议的参数
    params.flags = IORING_SETUP_COOP_TASKRUN   // 减少内核中断
                 | IORING_SETUP_SINGLE_ISSUER;  // 单线程提交优化

    return io_uring_queue_init_params(256, &engine->ring, ¶ms);
}

// WAL 写入：write + fdatasync 链式操作
int storage_engine_wal_write(struct storage_engine *engine,
                             const void *data, size_t len,
                             off_t offset) {
    struct io_uring_sqe *sqe;

    // write SQE
    sqe = io_uring_get_sqe(&engine->ring);
    io_uring_prep_write(sqe, engine->wal_fd, data, len, offset);
    sqe->flags |= IOSQE_IO_LINK;
    io_uring_sqe_set_data64(sqe, WAL_WRITE_TAG);

    // fdatasync SQE
    sqe = io_uring_get_sqe(&engine->ring);
    io_uring_prep_fsync(sqe, engine->wal_fd, IORING_FSYNC_DATASYNC);
    io_uring_sqe_set_data64(sqe, WAL_FSYNC_TAG);

    return io_uring_submit(&engine->ring);
}
```

            

### 7.5 相关文章

            

关于 io_uring
            在生产环境中的更多实践，可以参考本站的其他文章：
            
            
- [io_uring
            核心概念](../../io_uring/01-core-concepts.html)——深入理解提交队列与完成队列的设计
            
- io_uring
            vs epoll 性能对比——在网络场景下的性能基准测试
            
- [liburing
            API 详解](../../io_uring/03-liburing-api.html)——liburing 库的完整 API 参考
            
- io_uring
            高级特性——SQPOLL、固定资源、多次触发等
            
- io_uring
            生产环境实践——生产部署的经验总结
            
            

## 八、三代异步 I/O
            性能对比

            

### 8.1 基准测试环境

            
```
测试环境：

硬件：
  CPU：AMD EPYC 7763（64 核 128 线程）
  内存：256 GB DDR4 3200MHz
  存储：Samsung PM9A3 3.84TB NVMe SSD
        顺序读：6,900 MB/s
        顺序写：4,000 MB/s
        随机读 4K：1,000,000 IOPS
        随机写 4K：180,000 IOPS

软件：
  内核：Linux 6.1.0
  文件系统：ext4（data=ordered）
  fio 版本：3.36
  libaio 版本：0.3.113
  liburing 版本：2.5
```

            

### 8.2 fio 基准测试配置

            
```
; fio 配置文件：4K 随机读，不同异步引擎

[global]
filename=/dev/nvme0n1
direct=1
rw=randread
bs=4k
size=10g
runtime=60
time_based=1
group_reporting=1
numjobs=1

; POSIX AIO 引擎
[posixaio]
ioengine=posixaio
iodepth=128

; libaio 引擎
[libaio]
ioengine=libaio
iodepth=128

; io_uring 引擎（基础模式）
[io_uring]
ioengine=io_uring
iodepth=128

; io_uring + SQPOLL 模式
[io_uring_sqpoll]
ioengine=io_uring
iodepth=128
sqthread_poll=1

; io_uring + 固定文件 + SQPOLL
[io_uring_full]
ioengine=io_uring
iodepth=128
sqthread_poll=1
registerfiles=1
fixedbufs=1
```

            

运行命令：
            
```
# 分别测试各引擎
fio --section=posixaio    randread_bench.fio --output=posixaio_result.json --output-format=json
fio --section=libaio      randread_bench.fio --output=libaio_result.json   --output-format=json
fio --section=io_uring    randread_bench.fio --output=uring_result.json    --output-format=json
fio --section=io_uring_sqpoll randread_bench.fio --output=uring_sq_result.json --output-format=json
```

            

### 8.3 IOPS 对比

            
```
4K 随机读 IOPS（iodepth=128，单任务）：

引擎                       IOPS          相对性能
─────────────────────────────────────────────────
POSIX AIO                  65,000        基准（1.0x）
libaio                     420,000       6.5x
io_uring                   480,000       7.4x
io_uring + SQPOLL          520,000       8.0x
io_uring + SQPOLL + 固定   550,000       8.5x

不同队列深度下的 IOPS：

队列深度    POSIX AIO    libaio      io_uring    io_uring+SQPOLL
1           12,000       14,000      15,000      15,500
4           38,000       52,000      58,000      60,000
16          55,000       180,000     210,000     225,000
32          60,000       300,000     350,000     380,000
64          63,000       380,000     430,000     470,000
128         65,000       420,000     480,000     520,000
256         65,000       430,000     490,000     540,000
```

            

### 8.4 CPU 开销对比

            
```
CPU 利用率（达到相同 IOPS 时的 CPU 消耗）：

目标 IOPS：200,000（4K 随机读）

引擎                  CPU 核心利用率    系统调用次数/秒    上下文切换/秒
────────────────────────────────────────────────────────────────────────
POSIX AIO             无法达到          N/A               N/A
libaio                45%               ~200,000          ~15,000
io_uring              32%               ~50,000           ~8,000
io_uring + SQPOLL     28%               ~1,000            ~2,000

注意：POSIX AIO 在此配置下最高只能达到约 65,000 IOPS，
无法满足 200,000 IOPS 的目标。

每个 I/O 操作的平均 CPU 开销：

引擎                  每 I/O 的 CPU 时间
────────────────────────────────────────
POSIX AIO             ~15μs（包含线程管理）
libaio                ~2.2μs
io_uring              ~1.5μs
io_uring + SQPOLL     ~1.1μs
```

            

### 8.5 延迟分布对比

            
```
4K 随机读延迟分布（iodepth=32）：

百分位     POSIX AIO    libaio     io_uring    io_uring+SQPOLL
───────────────────────────────────────────────────────────────
P50        180μs        85μs       78μs        72μs
P90        320μs        120μs      105μs       95μs
P95        480μs        155μs      130μs       115μs
P99        1,200μs      280μs      210μs       180μs
P99.9      3,500μs      650μs      420μs       350μs
P99.99     8,000μs      1,800μs    950μs       780μs

关键观察：
1. POSIX AIO 的尾延迟极差，P99.99 是 io_uring+SQPOLL 的 10 倍
2. io_uring 的尾延迟比 libaio 好约 30-40%
3. SQPOLL 模式在尾延迟方面有显著优势（消除了 syscall 抖动）
```

            

### 8.6 综合对比表

            
```
┌─────────────────┬──────────────┬──────────────┬──────────────┐
│     特性         │  POSIX AIO   │  libaio      │  io_uring    │
├─────────────────┼──────────────┼──────────────┼──────────────┤
│ 引入版本         │ POSIX.1b     │ Linux 2.6    │ Linux 5.1    │
│ 实现层级         │ 用户态       │ 内核态        │ 内核态       │
│ 真正异步         │ 否           │ 是            │ 是           │
│ 需要 O_DIRECT   │ 否           │ 是            │ 否           │
│ 支持缓冲 I/O    │ 是           │ 否            │ 是           │
│ 支持网络 I/O    │ 否           │ 否            │ 是           │
│ 支持 fsync      │ 否           │ 否            │ 是           │
│ 链式操作         │ 否           │ 否            │ 是           │
│ 零拷贝提交       │ 否           │ 否            │ 是           │
│ 轮询模式         │ 否           │ 否            │ 是（SQPOLL） │
│ 固定资源注册     │ 否           │ 否            │ 是           │
│ 多次触发操作     │ 否           │ 否            │ 是           │
│ 缓冲区自动选择   │ 否           │ 否            │ 是           │
│ 4K 随机读 IOPS  │ ~65K         │ ~420K         │ ~520K        │
│ 每 I/O CPU 开销 │ ~15μs        │ ~2.2μs        │ ~1.1μs       │
│ P99 延迟         │ 1,200μs      │ 280μs         │ 180μs        │
│ 适用场景         │ 不推荐       │ 数据库引擎     │ 通用         │
│ 典型用户         │ 几乎无       │ MySQL/Oracle  │ 新项目首选    │
│ 维护状态         │ 不活跃       │ 维护模式       │ 活跃开发     │
└─────────────────┴──────────────┴──────────────┴──────────────┘
```

            

## 九、io_uring
            安全与最佳实践

            

### 9.1 容器环境中的安全限制

            

io_uring 的强大能力也带来了安全风险。由于 io_uring
            可以执行许多通常需要单独系统调用的操作，它成为了一个潜在的攻击面。许多容器运行时（Container
            Runtime）默认禁用 io_uring：
            
```
各容器运行时对 io_uring 的默认策略：

运行时/平台        默认策略        原因
─────────────────────────────────────────────
Docker             禁用           seccomp 默认过滤
Kubernetes         禁用           继承容器运行时策略
containerd         禁用           seccomp 默认过滤
gVisor             不支持         沙箱架构限制
Firecracker        不支持         微虚拟机限制
AWS Lambda         不支持         安全沙箱
Google Cloud Run   不支持         gVisor 沙箱

在 Docker 中启用 io_uring（不推荐在生产环境中使用）：
  docker run --security-opt seccomp=unconfined ...
  或自定义 seccomp 配置文件，允许 io_uring_setup、io_uring_enter、io_uring_register
```

            

### 9.2 Seccomp 与 io_uring

            

seccomp（Secure Computing Mode）是 Linux
            的系统调用过滤机制。要在 seccomp 环境中使用
            io_uring，需要显式允许相关的系统调用：
            
```
{
    "defaultAction": "SCMP_ACT_ERRNO",
    "syscalls": [
        {
            "names": [
                "io_uring_setup",
                "io_uring_enter",
                "io_uring_register"
            ],
            "action": "SCMP_ACT_ALLOW"
        }
    ]
}
```

            

需要注意的是，允许 `io_uring_enter`
            意味着应用可以通过 io_uring 执行
            `openat`、`read`、`write`、`accept`
            等操作，即使这些系统调用本身被 seccomp
            过滤。这极大地扩展了应用的能力边界，因此需要谨慎评估安全影响。
            

### 9.3 资源限制

            

io_uring 的内存使用受 `RLIMIT_MEMLOCK`
            限制：
            
```
# 查看当前 RLIMIT_MEMLOCK 限制
ulimit -l

# 临时增加限制（需要 root）
ulimit -l unlimited

# 永久配置（/etc/security/limits.conf）
#             
myapp      soft    memlock      unlimited
myapp      hard    memlock      unlimited
```

            

io_uring 的内存消耗估算：
            
```
io_uring 内存消耗：

SQE 大小：64 字节
CQE 大小：16 字节
默认 CQ 大小 = 2 * SQ 大小

队列深度    SQ 内存    CQ 内存    其他开销    总计
32          2 KB       1 KB       ~4 KB       ~7 KB
128         8 KB       4 KB       ~4 KB       ~16 KB
512         32 KB      16 KB      ~4 KB       ~52 KB
4096        256 KB     128 KB     ~4 KB       ~388 KB
32768       2 MB       1 MB       ~4 KB       ~3 MB

注意：固定缓冲区的内存不计入上述估算。
注册大量固定缓冲区需要额外的锁定内存。
```

            

### 9.4 内核版本兼容性

            

io_uring 在不同内核版本中引入了不同的特性：
            
```
io_uring 特性与内核版本对应关系：

内核版本    引入特性
──────────────────────────────────────────────────────
5.1         io_uring 基础功能（read/write/fsync/poll）
5.2         增加更多操作码
5.3         IORING_SETUP_SQPOLL
5.4         固定文件/缓冲区注册
5.5         io_uring_probe 能力探测
5.6         IORING_OP_SPLICE, IORING_OP_READ/WRITE
5.7         IORING_OP_OPENAT2, 更多网络操作
5.10        IOSQE_IO_HARDLINK 改进
5.11        多个 io_uring 实例优化
5.12        IORING_OP_SHUTDOWN, 限制接口
5.13        IORING_OP_RENAMEAT, IORING_OP_MKDIRAT
5.15        IORING_OP_SOCKET
5.18        IORING_SETUP_COOP_TASKRUN
5.19        提供缓冲区环（Buffer Ring）
6.0         IORING_OP_SEND_ZC（零拷贝发送）
6.1         IORING_SETUP_SINGLE_ISSUER
6.2         IORING_SETUP_DEFER_TASKRUN
6.7         IORING_OP_WAITID, 更多操作
```

            

### 9.5 生产部署检查清单

            
```
io_uring 生产部署检查清单：

环境准备：
  □ 确认内核版本 >= 5.10（推荐 5.15+）
  □ 确认 RLIMIT_MEMLOCK 足够（或设为 unlimited）
  □ 如在容器中运行，确认 seccomp 策略允许 io_uring
  □ 安装对应版本的 liburing

初始化配置：
  □ 队列深度根据预期并发 I/O 数设置（通常 128-1024）
  □ 评估是否需要 SQPOLL（仅在高 IOPS 场景使用）
  □ 如果使用 SQPOLL，评估 CPU 核心分配
  □ 使用 io_uring_probe 检测内核支持的操作码

性能优化：
  □ 高频访问的文件使用固定文件描述符
  □ 频繁使用的缓冲区使用固定缓冲区
  □ 设置 IORING_SETUP_COOP_TASKRUN（内核 5.18+）
  □ 单线程场景设置 IORING_SETUP_SINGLE_ISSUER（内核 6.1+）
  □ 批量提交 SQE，避免每个请求单独 submit

错误处理：
  □ 检查每个 CQE 的 res 字段
  □ 处理短读/短写
  □ 处理 -ECANCELED（链式操作中断）
  □ 处理 -EAGAIN（资源暂时不可用，需重试）
  □ 实现优雅降级：io_uring 不可用时回退到 libaio 或同步 I/O

监控指标：
  □ 未完成 I/O 数量（in-flight）
  □ SQ 和 CQ 的填充率
  □ I/O 延迟分布（P50/P95/P99）
  □ 系统调用频率（perf stat 或 strace -c）
  □ CPU 利用率（区分用户态和内核态）
```

            

### 9.6 调试 io_uring 问题

            
```
# 1. 检查内核是否支持 io_uring
cat /proc/version
# 确认内核版本 >= 5.1

# 2. 检查 io_uring 能力
# 使用 liburing 的 io_uring_probe
# 或者查看内核配置
grep IO_URING /boot/config-$(uname -r)

# 3. 使用 perf 跟踪 io_uring 事件
perf trace -e 'io_uring:*' -- ./my_uring_app

# 4. 使用 bpftrace 观察 io_uring 行为
bpftrace -e 'tracepoint:io_uring:io_uring_submit_sqe {
    printf("opcode=%d, fd=%d\n", args->opcode, args->fd);
}'

# 5. 查看 io_uring 实例信息（内核 5.12+）
cat /proc/

/fdinfo/

# 6. 检查 RLIMIT_MEMLOCK
grep "locked" /proc/

/status

# 7. 使用 strace 观察系统调用
strace -e io_uring_setup,io_uring_enter,io_uring_register ./my_uring_app
```

            

常见问题排查：
            
```
问题                          可能原因                      解决方案
─────────────────────────────────────────────────────────────────────────
io_uring_setup 返回 ENOMEM    RLIMIT_MEMLOCK 不足           增加 memlock 限制
io_uring_setup 返回 ENOSYS    内核不支持 io_uring           升级内核到 5.1+
SQPOLL 返回 EPERM             权限不足                      使用 root 或 CAP_SYS_NICE
CQE 返回 -EINVAL              缓冲区未对齐或参数错误        检查对齐和参数
CQE 返回 -ECANCELED           链式操作前序失败              检查链中每个操作的参数
CQE 返回 -EBADF               文件描述符无效                检查 fd 是否已关闭
性能低于预期                   队列深度不足或未批量提交       增加队列深度，批量 submit
SQPOLL 线程 CPU 100%          正常行为（持续轮询）           评估是否真需要 SQPOLL
```

            

## 十、总结与技术选型

            

### 10.1 何时使用哪种方案

            
```
技术选型决策树：

需要异步 I/O？
  ├─ 否 → 使用同步 I/O（read/write/pread/pwrite）
  └─ 是 → 内核版本 >= 5.10？
           ├─ 是 → 使用 io_uring（首选方案）
           │       ├─ IOPS > 100K？ → 考虑 SQPOLL
           │       ├─ 需要网络 + 文件？ → io_uring 统一处理
           │       └─ 容器环境？ → 确认 seccomp 策略
           └─ 否 → 可以使用 O_DIRECT？
                    ├─ 是 → 使用 libaio
                    └─ 否 → 使用线程池 + 同步 I/O
                            （不推荐 POSIX AIO）
```

            

### 10.2 三代方案的演进逻辑

            

Linux 异步 I/O
            的三代演进反映了系统编程领域的核心矛盾——性能与通用性之间的平衡：
            
```
第一代：POSIX AIO
  设计目标：标准化、可移植
  实际效果：用户态模拟，性能糟糕
  教训：标准化不能以牺牲性能为代价

第二代：libaio
  设计目标：真正的内核异步 I/O
  实际效果：性能优秀，但限制太多（O_DIRECT）
  教训：过于严格的约束会限制适用场景

第三代：io_uring
  设计目标：高性能 + 通用性 + 可扩展
  实际效果：接近完美的异步 I/O 框架
  关键创新：共享内存环形缓冲区消除了 syscall 瓶颈
```

            

io_uring 不仅仅是一个更快的异步 I/O 接口——它代表了 Linux
            系统调用架构的一次范式转变：从”每个操作一个
            syscall”转向”通过共享内存批量通信”。这种设计理念正在影响
            Linux
            内核的其他子系统，可能成为未来高性能系统编程的基础范式。
            
            

**上一篇**: Direct I/O 与
            O_DIRECT：绕过缓存的得与失 **下一篇**: 数据完整性：从
            fsync 到端到端校验
            
            

## 参考资料

            
            
- Jens Axboe, “Efficient IO with io_uring”, Kernel.dk,
            2019. [https://kernel.dk/io_uring.pdf](https://kernel.dk/io_uring.pdf)
            
- Jens Axboe, “What’s new with io_uring”, Kernel Recipes
            2022. [https://kernel.dk/io_uring-whatsnew.pdf](https://kernel.dk/io_uring-whatsnew.pdf)
            
- liburing GitHub 仓库. https://github.com/axboe/liburing
            
- Linux Kernel Documentation, “io_uring”. https://www.kernel.org/doc/html/latest/userspace-api/io_uring.html
            
- Shuveb Hussain, “Lord of the io_uring”, 2020. https://unixism.net/loti/
            
- libaio GitHub 仓库. [https://pagure.io/libaio](https://pagure.io/libaio)
            
- Linux man-pages, “io_setup(2), io_submit(2),
            io_getevents(2)”. https://man7.org/linux/man-pages/man2/io_setup.2.html
            
- Linux man-pages, “aio_read(3), aio_write(3)”. https://man7.org/linux/man-pages/man3/aio_read.3.html
            
- Mark Callaghan, “io_uring and RocksDB”, 2020. https://smalldatum.blogspot.com/
            
- Andres Freund, “Asynchronous I/O for PostgreSQL”,
            PostgreSQL Wiki. https://wiki.postgresql.org/wiki/AIO
            
- SPDK io_uring bdev module. https://spdk.io/doc/bdev.html
            
- fio Documentation, “I/O Engines”. https://fio.readthedocs.io/en/latest/fio_doc.html
            
- LWN.net, “Ringing in a new asynchronous I/O API”,
            Jonathan Corbet, 2019. https://lwn.net/Articles/776703/
            
- LWN.net, “The rapid growth of io_uring”, Jonathan
            Corbet, 2020. [https://lwn.net/Articles/810414/](https://lwn.net/Articles/810414/)
            
- Hao Xu, “io_uring and security”, LPC 2022. https://lpc.events/event/16/contributions/1218/
            
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-06-12 · storage
                    

### 【存储工程】O_DIRECT 与 io_uring：固定缓冲区、register_buffers 与工程选型

                    

拆解 O_DIRECT 对齐约束与 io_uring 固定缓冲区（IORING_REGISTER_BUFFERS）如何叠加；对比 buffered/Direct I/O 的 io_uring 实测 IOPS，给出数据库与块设备场景选型。
                

                
                    

2025-08-16 · storage
                    

### 【存储工程】Linux I/O 栈全景：从 write() 到磁盘扇区

                    

当应用程序调用一次 write() 系统调用（System Call）时，数据并不会立刻落到磁盘扇区上。 它需要穿越内核中七个以上的软件层次，每一层都有独立的职责、数据结构和延迟开销。 理解这条完整路径，是进行存储性能调优和故障诊断的基础。
                

                
                    

2026-05-18 · os
                    

### 【操作系统百科】io_uring 内核内部

                    

io_uring 用共享内存 ring buffer 实现零 syscall 异步 I/O——SQ/CQ、SQPOLL、IOPOLL、注册 fd/buffer、multishot、安全模型演化。本文深入内核实现与工程实践。
                

                
                    

2026-05-17 · os
                    

### 【操作系统百科】POSIX AIO 与 libaio

                    

Linux 有两套异步 I/O——glibc POSIX AIO（线程池伪装）和内核 libaio（io_submit/io_getevents，限制重重）。本文讲两者实现、O_DIRECT 约束、io_cancel 不可用性、与 epoll 的不可组合问题。