# 【存储工程】POSIX 文件锁：flock、fcntl 与 NFS 锁的工程陷阱

来源: https://quant67.com/post/storage/77-file-locking-pitfalls/file-locking-pitfalls.html
日期: 2026-06-11 |

---

POSIX 文件锁是一个典型的”接口简单，语义复杂”的 Unix
            机制。三个
            API——`flock()`、`fcntl()`、`lockf()`——每个只有几百字的
            man page，但它们的交互方式、释放条件、NFS
            行为和竞态条件，足以让一个经验丰富的系统程序员写出在生产环境中静默失效的代码。
            

本文从三种 API 的语义差异出发，逐一拆解 close-any-fd
            释放陷阱、OFD 锁的设计动机、advisory/mandatory
            模式的差异、F_GETLK 的信息竞态、NFS
            锁的恢复机制，最后讨论各场景下应该用什么来替代文件锁。
            
            

**适用范围** 本文讨论的行为以 Linux 6.x
            内核为依据。`fcntl()` 锁的 POSIX 语义在所有
            Unix-like 系统上基本一致；`flock()` 在 BSD 和
            Linux 上的行为有微妙差异（BSD 的 `flock()` 不排斥
            `fcntl()` 锁）；NFS 锁的行为高度依赖 NFS
            版本和服务器实现。
            
            
            

## 一、三种 API，三种语义

            

### 1.1 flock()：BSD
            风格，与文件描述符绑定

            

`flock()` 来自
            4.2BSD，语义上最简单的文件锁接口：
            
```
#include 

int flock(int fd, int operation);

// operation:
//   LOCK_SH  共享锁（读锁）
//   LOCK_EX  排他锁（写锁）
//   LOCK_UN  解锁
//   LOCK_NB  非阻塞（与上述标志 OR）
```

            

`flock()`
            的核心语义：**锁与打开的文件描述（open file
            description）关联，而非与进程或 inode 关联。**
            这意味着：
            
            
- 同一个进程的多个 fd 指向同一个打开的文件描述（通过
            `dup()`、`dup2()` 或
            `fork()` 继承），它们共享同一把锁。
            
- **共享同一 open file description 的任意
            fd** 被 `close()`
            时，锁即释放——不必是当初调用 `flock()` 的那个 fd
            号。另一次 `open()` 得到的 fd 指向不同 open file
            description，关闭它**不会**释放
            `flock()` 锁。
            
- 如果进程调用了 `fork()`，子进程继承了父进程的
            fd（和对应的文件描述），但**不继承锁**——锁属于打开的文件描述，而
            `fork()` 创建的新进程拥有独立的文件描述表（尽管
            fd 号可能相同）。
            
            

`flock()` 的一个重要特性是：在 Linux
            上，`flock()` 锁和 `fcntl()`
            锁是**完全独立的两套机制**。同一个文件可以被一个
            `flock(LOCK_EX)` 和一个
            `fcntl(F_SETLK, F_WRLCK)`
            同时锁定而互不排斥。这不是标准的 POSIX 行为——它只是 Linux
            的一个实现选择，导致了无数跨平台的 bug。
            

### 1.2 lockf()：POSIX
            的简化锁

            

`lockf()` 是 POSIX.1
            标准的函数，语义上可以理解为 `fcntl()`
            的一个子集：
            
```
#include 

int lockf(int fd, int cmd, off_t len);

// cmd:
//   F_LOCK   排他锁（阻塞）
//   F_TLOCK  排他锁（非阻塞，失败返回 -1 errno=EAGAIN）
//   F_ULOCK  解锁
//   F_TEST   测试锁是否可以被获取
```

            

`lockf()`
            不支持共享锁（读锁）——只有排他锁（写锁）。在 Linux
            上，`lockf()` 通过 `fcntl()`
            实现，所以 `lockf()` 和 `fcntl()`
            的锁是同一套——它们互相排斥。
            

### 1.3 fcntl()：POSIX
            的完整锁接口

            

`fcntl()` 提供了最完整的文件锁功能：
            
```
#include 

struct flock {
    short l_type;    // F_RDLCK（读锁）, F_WRLCK（写锁）, F_UNLCK（解锁）
    short l_whence;  // SEEK_SET, SEEK_CUR, SEEK_END
    off_t l_start;   // 锁区域的起始偏移
    off_t l_len;     // 锁区域的长度（0 表示到文件尾）
    pid_t l_pid;     // 持有锁的进程 PID（F_GETLK 时由内核填充）
};

int fcntl(int fd, int cmd, struct flock *lock);

// cmd:
//   F_SETLK   设置锁（非阻塞，失败返回 -1 errno=EAGAIN）
//   F_SETLKW  设置锁（阻塞，直到成功）
//   F_GETLK   查询锁（检查是否有其他锁冲突）
```

            

`fcntl()` 的核心语义：**锁与进程和 inode
            关联，而非文件描述。**
            
            
- 锁由 (inode, l_start, l_len) 三元组标识。
            
- 关闭**任意一个**指向该 inode 的
            fd，所有该进程持有的 `fcntl()`
            锁都被释放——即使这个 fd 不是当初获取锁的那个 fd。
            
- `fork()` 后，子进程不继承
            `fcntl()` 锁（因为锁属于进程）。
            
- 但 `exec()`
            后，锁仍然保持——因为进程没变。
            
            

`fcntl()`
            支持字节范围（byte-range）锁——可以锁定文件的任意字节范围，而不是整个文件。这使得
            `fcntl()` 适合于数据库的页级并发控制。
            

### 1.4 三种 API 对比

            
```
特性                  flock()           lockf()            fcntl()
────────────────────────────────────────────────────────────
来源                  BSD 4.2           POSIX.1            POSIX.1
锁粒度                整个文件           整个文件            字节范围
共享锁（读锁）        是（LOCK_SH）       否                  是（F_RDLCK）
锁关联对象            打开的文件描述      进程+inode          进程+inode
close 释放            共享 OFD 的 fd     同 inode 任意 fd    同 OFD 全部 fd
                      close 即释放       close 即释放        close 才释放
fork 继承             不继承              不继承              不继承
exec 后保持           不保持              保持                保持
NFS 支持             NFSv4（有限）      无                  NFSv4（有限）
与 fcntl 互斥（Linux） 不互斥             互斥（基于 fcntl）   互斥（基于自身）
```

            
            

## 二、close-any-fd
            释放陷阱

            

这是 POSIX
            文件锁中最著名的陷阱，也是导致生产故障的常见根源。
            

### 2.1 问题描述

            

POSIX
            规范规定：**当进程关闭了任意一个指向某个文件的文件描述符时，该进程持有的该文件上的所有
            `fcntl()` 记录锁（record
            lock）必须被释放。**
            
```
场景：
  1. fd1 = open("data.db", O_RDWR)
  2. fcntl(fd1, F_SETLKW, &lock)  // 获取锁
  3. fd2 = open("data.db", O_RDONLY)  // 打开同一文件
  4. close(fd2)  // 释放了步骤 2 获取的锁！
```

            

锁的释放不需要通过获取锁的那个
            fd（`fd1`）——关闭 `fd2`
            就够了。内核不追踪”哪个 fd
            获取了哪把锁”，它只追踪”这个进程对这个 inode 有哪些锁”。
            

### 2.2 为什么这很危险

            

这个语义在以下场景中制造无声故障：
            

**场景一：库函数内部打开/关闭文件。**
            你的应用通过 `fd1` 获取了 `data.db`
            上的锁。某个第三方库（可能是日志库、配置文件解析库、甚至
            glibc 内部的某些函数）在不知道锁存在的情况下，打开并关闭了
            `data.db`。你的锁在不知情的情况下被静默释放。
            

**场景二：日志轮转。**
            一个长期运行的守护进程持有 `data.db`
            上的锁。运维使用 logrotate 的 `copytruncate`
            模式，以同一进程的身份打开并截断了数据库文件。截断操作打开、close
            了 `data.db`——锁被释放。
            

**场景三：close-on-exec 的副作用。**
            某段代码打开了 `data.db` 并设置了
            `O_CLOEXEC`。之后 `exec()`
            某个命令。`exec()` 成功不会释放锁——但如果在
            `exec()` 之前有一个显式的
            `close()`（为了清理 fd），锁就没了。
            

### 2.3 Open File
            Description 锁（Linux 3.15+）

            

Linux 从 3.15 内核开始引入了一个解决方案：OFD 锁（Open
            File Description Locks），也称为文件描述锁（file-description
            locks）。
            
```
// OFD 锁使用 fcntl() 的 F_OFD_SETLK 等命令
// 行为类似 fcntl() 锁，但锁关联对象是"打开的文件描述"而非"进程+inode"

struct flock lock = {
    .l_type = F_WRLCK,
    .l_whence = SEEK_SET,
    .l_start = 0,
    .l_len = 0,       // 整个文件
};

// 获取 OFD 写锁（阻塞）
fcntl(fd, F_OFD_SETLKW, &lock);

// 获取 OFD 写锁（非阻塞）
int ret = fcntl(fd, F_OFD_SETLK, &lock);
if (ret == -1 && errno == EAGAIN) {
    // 锁被其他人持有
}
```

            

OFD 锁的关键语义差异：
            
```
特性                  fcntl() 传统锁       OFD 锁
──────────────────────────────────────────────────
锁关联对象            进程 + inode         打开的文件描述
dup() 后             共享锁（同一进程）     共享锁
fork() 后             不继承                不继承
close() 释放         任意 fd close         只有获取锁的那个打开文件描述的全部 fd close
exec() 后             保持                  保持
字节范围              支持                  支持
与 fcntl 互斥         互斥                  互斥
```

            

OFD
            锁的核心改进：**只有获取锁的那个”打开的文件描述”上的所有
            fd 都关闭后，锁才被释放。**
            `close(fd2)`（如果 `fd2` 来自不同的
            `open()` 调用）不会释放 `fd1` 上的 OFD
            锁。
            

这消除了 close-any-fd 问题，但代价是：OFD 锁的 API 不是
            POSIX 标准（这是 Linux
            特有的扩展），跨平台代码不能使用。语义上，OFD 锁更接近
            `flock()`（绑定 open file description），但通过
            `fcntl()` 命令族实现，并与传统
            `fcntl()` 记录锁互斥。
            

### 2.4 实际示例

            

以下程序演示了 close-any-fd 陷阱和 OFD 锁的区别：
            
```
/*
 * 演示：fcntl() 锁的 close-any-fd 陷阱 vs OFD 锁
 * 编译：gcc -o lock-test lock-test.c
 * 运行：./lock-test posix   # 测试传统 fcntl 锁
 *       ./lock-test ofd     # 测试 OFD 锁
 */
#include 
#include 
#include 
#include 
#include 
#include 
#include 

void test_posix_lock(const char *path) {
    int fd1 = open(path, O_RDWR | O_CREAT, 0644);
    int fd2 = open(path, O_RDONLY);

    struct flock lk = {
        .l_type = F_WRLCK,
        .l_whence = SEEK_SET,
        .l_start = 0,
        .l_len = 0,
    };

    // fd1 获取写锁
    if (fcntl(fd1, F_SETLK, &lk) == -1) {
        perror("fcntl(F_SETLK) on fd1");
        exit(1);
    }
    printf("[POSIX] fd1 获取写锁成功\n");

    // 关闭 fd2 —— 这会释放 fd1 上的锁！
    close(fd2);
    printf("[POSIX] 关闭 fd2\n");

    // 验证锁是否还在
    // 从另一个进程（自己 fork）尝试获取同一文件的锁
    pid_t pid = fork();
    if (pid == 0) {
        // 子进程：尝试获取写锁
        int fd3 = open(path, O_RDWR);
        lk.l_type = F_WRLCK;
        if (fcntl(fd3, F_SETLK, &lk) == -1) {
            if (errno == EAGAIN)
                printf("[POSIX] 锁仍然存在（fd1 还在持有）\n");
            else
                perror("fcntl");
        } else {
            printf("[POSIX] 锁已丢失！子进程成功获取了写锁\n");
        }
        close(fd3);
        exit(0);
    }
    waitpid(pid, NULL, 0);
    close(fd1);
}

void test_ofd_lock(const char *path) {
    int fd1 = open(path, O_RDWR | O_CREAT, 0644);
    int fd2 = open(path, O_RDONLY);

    struct flock lk = {
        .l_type = F_WRLCK,
        .l_whence = SEEK_SET,
        .l_start = 0,
        .l_len = 0,
    };

    // fd1 获取 OFD 写锁
    if (fcntl(fd1, F_OFD_SETLK, &lk) == -1) {
        perror("fcntl(F_OFD_SETLK) on fd1");
        exit(1);
    }
    printf("[OFD] fd1 获取 OFD 写锁成功\n");

    // 关闭 fd2 —— OFD 锁不受影响
    close(fd2);
    printf("[OFD] 关闭 fd2\n");

    // 验证锁是否还在
    pid_t pid = fork();
    if (pid == 0) {
        int fd3 = open(path, O_RDWR);
        lk.l_type = F_WRLCK;
        if (fcntl(fd3, F_OFD_SETLK, &lk) == -1) {
            if (errno == EAGAIN)
                printf("[OFD] 锁仍然存在（fd1 还在持有）\n");
            else
                perror("fcntl");
        } else {
            printf("[OFD] 锁已丢失！\n");
        }
        close(fd3);
        exit(0);
    }
    waitpid(pid, NULL, 0);
    close(fd1);
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "用法: %s [posix|ofd]\n", argv[0]);
        return 1;
    }

    const char *path = "/tmp/lock-test-file";
    // 确保文件存在且有一定大小
    int fd = open(path, O_RDWR | O_CREAT | O_TRUNC, 0644);
    write(fd, "test data\n", 10);
    close(fd);

    if (strcmp(argv[1], "posix") == 0)
        test_posix_lock(path);
    else if (strcmp(argv[1], "ofd") == 0)
        test_ofd_lock(path);
    else
        fprintf(stderr, "未知参数: %s\n", argv[1]);

    unlink(path);
    return 0;
}
```

            

实测输出（Linux 6.8，gcc 编译）：
            
```
$ ./lock-test posix
[POSIX] fd1 获取写锁成功
[POSIX] 关闭 fd2
[POSIX] 锁已丢失！子进程成功获取了写锁

$ ./lock-test ofd
[OFD] fd1 获取 OFD 写锁成功
[OFD] 关闭 fd2
[OFD] 锁仍然存在（fd1 还在持有）
```

            
            

## 三、Advisory vs
            Mandatory 锁

            

### 3.1 Advisory
            Locking（建议锁）

            

`flock()` 和 `fcntl()`
            默认都是建议锁（Advisory
            Lock）。“建议”的意思是：内核不会阻止一个不检查锁的进程读写文件。锁只在所有参与者都主动检查时才有效。Linux
            的默认行为就是 advisory——这是一个被反复误解的特性。
            
```
建议锁的工作方式：

进程 A: fcntl(fd, F_SETLKW, &write_lock) → 成功
进程 B: write(fd, buf, len) → 成功！（忽略锁）
进程 B: fcntl(fd, F_SETLK, &write_lock) → EAGAIN（只有主动检查才生效）
```

            

### 3.2 Mandatory
            Locking（强制锁）

            

强制锁（Mandatory
            Lock）能阻止任何不持有锁的进程读写文件——不只是
            `fcntl()` 调用者，连 `read()` 和
            `write()` 也会被内核拦截。
            

启用强制锁需要两个条件：
            
            
- 文件系统以 `-o mand` 选项挂载。
            
- 文件的 set-group-ID 位被设置，且 group-execute
            位被清除。
            
            
```
# 启用强制锁
mount -o mand /dev/sda1 /mnt/data

# 设置文件的强制锁标志
chmod g+s,g-x /mnt/data/locked_file
ls -l /mnt/data/locked_file
# -rw-r-Sr-- 1 root root 0 Jan 1 00:00 /mnt/data/locked_file
#       ^
#   大写 S = setgid 置位 + group execute 未置位 = 强制锁
```

            

强制锁在理论上是完美的保护，在实践中几乎从未被使用。原因：
            
            
- **拒绝服务风险。** 如果持有强制锁的进程
            crash 了，锁不会自动释放（进程 crash 会导致内核释放
            `fcntl()` 锁——但这里说的是锁的持有者还没 crash
            只是因为 bug 卡住了）。
            
- **与 mmap 的交互不明确。**
            `mmap()` 的读写不经过
            `read()`/`write()`
            系统调用，强制锁对其行为的限制取决于内核版本。
            
- **与 O_NONBLOCK 的交互复杂。** 设置了
            `O_NONBLOCK` 的 fd 遇到强制锁时行为不同。
            
- **性能退化的可能。** 每次
            `read()`/`write()`
            都要检查强制锁。
            
            

Linux 内核文档明确表示强制锁是”broken by
            design”，不建议使用。大多数 Unix
            系统实际上已经废弃或从不支持强制锁。
            
            

## 四、F_GETLK 的信息竞态

            

`fcntl(fd, F_GETLK, &lock)`
            查询”有没有进程持有一个与我指定的锁冲突的锁”。返回值被写入
            `lock.l_type`（如果无冲突，则为
            `F_UNLCK`），冲突时 `lock.l_pid`
            包含持有冲突锁的进程 PID。
            

问题在于：**F_GETLK
            的返回值在返回到调用者时已经过期。** 在 F_GETLK
            返回”无冲突”的瞬间和调用者调用 F_SETLK
            的瞬间之间，另一个进程可能恰好获取了一把冲突的锁。
            
```
进程 A                              进程 B
───────                             ───────
fcntl(fd, F_GETLK, &lk)
→ 返回 F_UNLCK（无冲突）
                                     fcntl(fd, F_SETLK, &write_lock)
                                     → 获取锁成功
fcntl(fd, F_SETLK, &write_lock)     ← 基于过时信息
→ 返回 EAGAIN（冲突！）              ← 不是预期的结果
```

            

这是一个
            TOCTOU（Time-of-Check-Time-of-Use）竞态。**你不能用
            F_GETLK + F_SETLK 来实现”安全地检查并设置锁”。**
            正确的做法是直接调 F_SETLK（非阻塞）并处理
            EAGAIN/EACCES：
            
```
// 错误做法：
fcntl(fd, F_GETLK, &lk);
if (lk.l_type == F_UNLCK) {
    fcntl(fd, F_SETLK, &lk);  // 竞态窗口
}

// 正确做法：
if (fcntl(fd, F_SETLK, &lk) == -1) {
    if (errno == EAGAIN || errno == EACCES) {
        // 锁被持有，处理冲突
    }
}
```

            

F_GETLK
            的唯一安全用途是**信息性的**——你想知道谁在持有锁（PID），用于日志记录或调试。不要用它来做加锁决策。
            
            

## 五、NFS 锁：从不完全可靠

            

NFS（Network File System）的文件锁机制是整个 POSIX
            文件锁中最不可靠的部分。这里的不可靠不是因为 POSIX 规范有
            bug，而是因为网络分区、客户端 crash、服务器 reboot
            这些事件在网络文件系统中无法完美处理。
            

### 5.1 NFSv3：NLM 协议

            

NFSv3 使用独立的 NLM（Network Lock
            Manager）协议来管理文件锁。NLM 依赖三个守护进程：
            
            
- `lockd`：处理锁请求的守护进程，运行在客户端和服务器两侧。
            
- `statd`：网络状态监视器，跟踪客户端和服务器的运行状态。
            
- `sm-notify`：在 reboot
            后通知对端”我重启了，之前的状态失效了”。
            
            
```
NLM 锁获取流程：

客户端 lockd ──┬── NLM_LOCK 请求 ──▶ 服务器 lockd
               │                         │
               │                         ▼
               │                    检查锁冲突
               │                    授予或拒绝锁
               │                         │
               ◀── NLM_LOCK 响应 ────     │
               │    (granted / denied)
               ▼
          客户端 statd 注册监视
          "服务器如果 reboot，通知我"
```

            

NLM 的核心问题在于崩溃恢复：
            
            
- 服务器 reboot 后，`statd` 向所有客户端发送
            `SM_NOTIFY`，告知”服务端重启了”。
            
- 客户端收到 `SM_NOTIFY`
            后，应当重新获取所有锁（reclaim）。
            
- 但锁的 reclaim 不是原子的——在 reclaim
            期间，不同客户端的锁请求顺序可能导致与 reboot
            前不同的锁状态。
            
- 更糟的是：如果客户端在服务器 reboot 期间也 crash
            了（如机房断电），服务端 reboot 后客户端还来不及
            reclaim，另一个客户端可能拿到了锁——而 crash
            的客户端在恢复后认为锁仍然属于自己。
            
            

这就是 NFSv3 锁的”grace period”问题：reboot
            后有一段宽限期（通常 45–90 秒），期间只有 reclaim
            请求被接受，新的锁请求被拒绝。但这段时间的实际行为高度依赖
            NFS 服务器实现。
            

### 5.2 NFSv4：租约模型

            

NFSv4 将锁集成到协议本身（不再需要独立的
            NLM/statd）。锁使用租约（lease）模型：
            
            
- 客户端获取锁时，获得一个租约（默认 90
            秒，可配置）。
            
- 客户端必须在租约过期前续约（renew）。
            
- 如果租约过期（客户端失联），服务器释放锁。
            
- 客户端恢复连接后，有 re-establishment period 来 reclaim
            锁。
            
            

租约模型比 NLM 的崩溃恢复更干净，但仍然不完美：
            
            
- **租约超时的代价。**
            如果客户端因为网络抖动没有及时续约，锁就被释放了——其他客户端可能获取锁并写入。原客户端恢复后，锁已经不属于它了。应用程序通常不知道这件事。
            
- **reclaim 期间的行为差异。** 不同 NFSv4
            服务器（Linux knfsd、NetApp、EMC Isilon）在 reclaim
            期间的行为不尽相同。
            
- **锁的丢失对应用程序不可见。**
            除非应用程序主动检查锁状态（通过某些特定接口），否则锁的丢失是静默的。
            
            

### 5.3 工程建议

            

对于 NFS 上的文件锁：
            
            
- 不要把 NFS
            文件锁当作数据一致性的唯一保证。锁可以在你不注意的时候被释放。
            
- 如果必须在 NFS
            上使用锁，**总是在数据中嵌入版本号或校验和**，写入时验证期望的版本，读取时验证校验和。
            
- 考虑用租约机制在应用层重新实现——定期续约，定期验证锁的有效性。
            
- 对于新项目，强烈建议避免 NFS
            文件锁。用数据库、分布式锁服务（etcd/ZooKeeper）或对象存储的条件写操作来替代。
            
            
            

## 六、真实世界的故障模式

            

### 6.1
            “我们用了 flock 做单例，然后 logrotate 把它弄没了”

            

这是一个反复出现的生产故障模式：
            
            
- 守护进程启动时调用
            `flock(pidfile_fd, LOCK_EX | LOCK_NB)`
            确保只有一个实例。
            
- logrotate 配置了 `copytruncate`
            模式——复制日志文件内容，然后 `truncate`
            原文件。
            
- `copytruncate` 的某些实现会
            `open()` + `close()`
            日志文件所在的目录，或者操作 PID 文件本身。
            
- 如果任何操作触发了 `close()` on
            一个指向锁文件的
            fd（包括不小心打开又关闭了锁文件），`flock()`
            锁被释放。
            
- 监控脚本检测不到锁，启动第二个守护进程实例——数据冲突。
            
            

这个问题的修复有几种方式：
            
            
- **避免 close-any-fd**：持有锁的 fd
            永远不关闭。在启动后立即 `dup()` 该 fd 并关闭原始
            fd，确保没有其他代码路径能意外关闭共享 open file description
            的 fd。
            
- **改用 OFD 锁**：Linux 3.15+ 上，OFD
            锁不受「另一次 `open()` 后
            `close()`」影响；`flock()` pidfile
            若被第三方意外 close 共享 fd，仍有风险。
            
- **改用 pidfile + kill(pid, 0)**：检查 PID
            文件中的进程是否仍在运行，而不是依赖锁——但这也受 PID
            回收问题影响。`copytruncate` 主要危及
            **fcntl() 记录锁**（同 inode 任意 fd close
            即释放），对 `flock()` 仅在同进程误 close 共享 fd
            时才有影响。
            
            

### 6.2 NFS 双写

            

经典的 NFS 锁故障：
            
            
- 两个应用服务器（A 和 B）通过 NFS
            共享同一个文件存储。
            
- 两台服务器都在 NFS
            挂载上运行一个批处理任务，处理同一个文件，使用
            `fcntl()` 锁来互斥。
            
- 网络抖动导致 NFS 客户端 A 的租约超时。NFS 服务器释放了 A
            的锁。
            
- B 在 reclaim 窗口结束后成功获取了锁，开始处理文件。
            
- 网络恢复后，A
            不知道锁已经丢失——它仍然认为自己持有锁。
            
- 两台服务器同时写入同一个文件——数据错乱。
            
            

这类问题的根本原因是：**NFS
            锁的失效对应用层不透明。** 应用程序的锁状态和 NFS
            客户端的锁状态之间没有同步机制。
            
            

## 七、安全的替代方案

            

### 7.1 原子文件操作

            

对于”确保只有一个写入者”这种最简单的场景，原子文件操作比锁更可靠：
            
```
/*
 * 使用 O_EXCL + rename 的原子写模式
 * 这比文件锁更可靠，因为文件系统的 rename 是原子的
 */

// 创建临时文件并写入
int tmpfd = open("/data/.mydata.tmp", O_WRONLY | O_CREAT | O_EXCL, 0644);
write(tmpfd, data, datalen);
fsync(tmpfd);
close(tmpfd);

// 原子替换
rename("/data/.mydata.tmp", "/data/mydata");
// rename 成功后，mydata 要么是完整的新版本，要么是未写入——无中间态
```

            

### 7.2 数据库

            

对于需要多进程/多线程并发读写的场景，SQLite 的 WAL
            模式提供了事务级并发控制，比手动实现文件锁可靠得多：
            
```
PRAGMA journal_mode=WAL;
-- SQLite 在 WAL 模式下允许多个读者和一个写者并发
-- 不需要手动管理文件锁
```

            

### 7.3 分布式协调

            

对于跨机器的锁需求，etcd、ZooKeeper 或 Consul
            的分布式锁比 NFS
            文件锁可靠得多。这些系统是为分布式环境设计的，有明确的租约/会话机制和处理网络分区的策略。
            

### 7.4
            什么时候文件锁仍然是正确答案

            

文件锁并非一无是处。以下场景中文件锁仍然是最自然的选择：
            
            
- `systemd` 的 PID 文件锁（`flock()`
            确保单例）——单机，本地文件系统，生命周期清晰。
            
- 本地多进程对共享日志文件的协调——纯本地场景，不受网络影响。
            
- 包管理器的并发安装锁（如 `dpkg` 的 frontend
            lock）——短生命周期，本地操作。
            
            

判断规则：**如果”锁的持有者和所有竞争者都在同一台机器上”，且”不需要跨网络”，那么
            POSIX 文件锁通常是安全且正确的选择。**
            一旦跨越了网络（NFS），或者涉及
            `fork()`/`dup()` 等 fd
            操作，就需要重新评估锁策略。
            
            

## 八、总结

            
```
场景                                  推荐方案
────────────────────────────────────────────────────────
单机单进程互斥（启动检查）              flock() on pidfile
单机多进程文件协调                      OFD 锁（优先）或 fcntl() + 严格 fd 管理
跨机器文件锁                           避免。用数据库 / etcd / 对象存储条件写
NFS 上的任何锁                         强烈不推荐。考虑应用层版本号+校验和
需要检查锁状态（调试用）                F_GETLK（仅用于调试！）
需要检查并设置锁（做决策）              直接 F_SETLK 并处理 EAGAIN
```

            

POSIX
            文件锁的核心矛盾是：接口足够简单，让人以为可以随意使用；但语义足够复杂，让正确使用成为一项需要阅读内核源码的技能。理解
            close-any-fd、OFD 锁、NFS
            租约这些机制不是在”深入细节”——这些就是 POSIX
            文件锁的本质。不理解它们就等于不理解文件锁。
            
            

## 参考资料

            
            
- POSIX.1-2017, Section 2.9.5.4: Advisory Locking. IEEE
            Std 1003.1-2017.
            
- Linux man-pages: `man 2 flock`,
            `man 2 fcntl`, `man 2 lockf`,
            `man 2 open`.
            
- Linux 内核源码：`fs/locks.c`（POSIX
            锁的核心实现）、`fs/fcntl.c`（fcntl 的
            F_SETLK/F_GETLK 路径）。
            
- RFC 7530, Section 9: Locking. NFSv4
            的锁和租约模型规范。
            
- RFC 1813, Chapter 5: NLM Protocol. NFSv3 的 NLM/NSM
            协议。
            
- Neil Brown. “A Quick Guide to Linux File Locking.”
            LWN.net, 2016. —— [https://lwn.net/Articles/667078/](https://lwn.net/Articles/667078/)
            
- systemd 文档：`systemd.exec(5)` 中的 PIDFile
            说明和 `flock()` 行为。
            
            
            

**上一篇**: 磁盘空间耗尽：从
            70% 到 ENOSPC 的行为退化链 **下一篇**: 存储事故复盘：经典生产故障的根因与教训
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-18 · storage
                    

### 【存储工程】Page Cache 深度解析

                    

应用程序每一次 read() 或 write() 系统调用，感觉像是直接在操作磁盘上的文件，但实际上，内核在中间插入了一层透明的缓存——页缓存（Page Cache）。这层缓存用物理内存保存最近访问过的文件数据，使得绝大多数读操作不需要触发磁盘 I/O，而写操作可以先落到内存，再由后台线程异步刷回存储设备。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。