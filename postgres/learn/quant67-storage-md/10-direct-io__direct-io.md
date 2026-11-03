# 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

来源: https://quant67.com/post/storage/10-direct-io/direct-io.html
日期: 2025-08-19 |

---

**与 #79 的分工**
            
            
            
            
            
            
            
            文章
            分工
            
            
            
            
            **本文（#10）**
            `O_DIRECT`
            **语义与坑**：对齐、双重缓冲、fsync
            语义、文件系统差异、DAX/SPDK 谱系
            
            
            #79
            O_DIRECT + io_uring
            **组合路径**：`posix_memalign`、`io_uring_register_buffers`、本机
            benchmark 与选型
            
            
            [#11
            异步 I/O](../11-linux-async-io/linux-async-io.html) / [io_uring
            系列](../../io_uring/index.html)
            io_uring 机制与 API；生产坑见 io_uring
            翻车实录
            
            
            
            

**决策边界（何时绕过 Page Cache）**
            
            
- **倾向 `O_DIRECT`**：应用已有
            Buffer Pool / 自管缓存（InnoDB、RocksDB、Ceph
            OSD）；大扫描会污染页缓存；需可预测的刷盘语义。
            
- **保留 Page
            Cache**：无应用层缓存的小文件读、多进程只读共享、依赖内核
            readahead 的通用负载。
            
- **先定缓存策略，再选提交方式**：`O_DIRECT`
            解决「要不要内核再缓存一份」；是否叠加 io_uring 见
            #79，勿在未确认 direct 语义前为 IOPS 上 io_uring。
            
            
            

## 一、为什么需要绕过 Page
            Cache

            

### 1.1 传统 I/O 路径回顾

            

在 Linux 的传统 I/O 路径中，应用程序通过
            `read()` 和 `write()`
            系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User
            Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page
            Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：
            
```
应用程序 write()
    ↓
用户空间缓冲区（User Buffer）
    ↓  （数据拷贝：用户态 → 内核态）
内核页缓存（Page Cache）
    ↓  （内核回写线程异步刷盘）
块设备层 → 磁盘
```

            

读取流程则是反向进行：内核先检查 Page Cache
            中是否已有目标数据，如果命中则直接拷贝给用户空间，不需要访问磁盘；如果未命中则从磁盘读入
            Page Cache，再拷贝给用户空间。
            

这种设计在大多数场景下工作良好：Page Cache
            利用了时间局部性（Temporal Locality）和空间局部性（Spatial
            Locality），让频繁访问的数据驻留在内存中，显著减少了磁盘 I/O
            次数。但在某些特定场景下，这层缓存反而成了负担。
            

### 1.2 双重缓冲问题

            

双重缓冲问题（Double Buffering Problem）是数据库系统使用
            Page Cache 时面临的核心矛盾。以 MySQL 的 InnoDB
            存储引擎为例：
            

InnoDB 自身维护了一个缓冲池（Buffer
            Pool），通常配置为物理内存的 50%～80%。Buffer Pool
            中缓存了数据页、索引页、自适应哈希索引等结构。当 InnoDB
            读取一个 16KB 的数据页时，如果走传统 I/O
            路径，实际发生的事情是：
            
```
磁盘 → Page Cache（内核缓存一份） → InnoDB Buffer Pool（应用层再缓存一份）
```

            

同一份数据在内存中存在两个副本：一份在内核的 Page Cache
            中，一份在 InnoDB 的 Buffer Pool 中。对于一个配置了 64GB
            Buffer Pool 的数据库服务器，这意味着操作系统可能在 Page
            Cache 中额外持有几十 GB 的重复数据，而这些内存本可以被分配给
            Buffer Pool 或其他进程使用。
            

写入路径的浪费同样严重：
            
```
InnoDB Buffer Pool（脏页）
    ↓  （write() 系统调用）
Page Cache（内核再缓存一份脏页）
    ↓  （回写线程异步刷盘）
磁盘
```

            

数据从 Buffer Pool 拷贝到 Page
            Cache，然后再由内核回写到磁盘。这次从用户态到内核态的数据拷贝是完全不必要的——InnoDB
            已经在应用层完成了所有缓存管理工作。
            

### 1.3 内存拷贝的开销

            

每一次 `read()` 或 `write()`
            系统调用，都伴随着一次 `memcpy`
            操作：数据在用户空间缓冲区和内核 Page Cache 之间拷贝。对于
            4KB 的小页，这次拷贝的开销看似微不足道；但当吞吐量达到 GB/s
            级别时，拷贝开销就变得显著了。
            

假设一个数据库每秒刷出 2GB 的脏页，每次拷贝 16KB
            的数据页：
            
```
拷贝次数 = 2GB / 16KB = 131072 次/秒
总拷贝量 = 2GB/秒（用户态 → 内核态）+ 2GB/秒（内核态 → 磁盘 DMA）
```

            

用户态到内核态的那次 `memcpy` 消耗 CPU
            周期，占用内存带宽，并且会污染 CPU 的 L1/L2
            缓存。在高吞吐场景下，这些开销可以占到总 CPU 使用率的
            5%～10%。
            

### 1.4 缓存污染

            

缓存污染（Cache Pollution）是 Page Cache
            在大规模顺序扫描场景下的典型问题。考虑以下场景：
            

一个数据库服务器正常运行时，Page Cache
            中缓存了大量热点数据页，读取命中率维持在 95%
            以上。这时运维人员启动了一个数据备份任务，需要顺序读取整个数据库文件（假设
            500GB）。在传统 I/O 路径下，这 500GB 的数据会依次被读入 Page
            Cache，将原本缓存的热点数据逐出。备份完成后，数据库的缓存命中率可能从
            95% 骤降到 10%，需要很长时间才能重新预热。
            

Linux 内核虽然提供了
            `fadvise(POSIX_FADV_DONTNEED)`
            等机制来缓解这个问题，但应用层往往很难精确控制 Page Cache
            的行为。对于自行管理缓存的数据库系统来说，绕过 Page Cache
            是更彻底的解决方案。
            

### 1.5 何时 Page Cache 有益

            

并非所有场景都适合绕过 Page Cache。以下场景中，Page Cache
            依然是更好的选择：
            
            
- **小文件频繁读取**：配置文件、元数据文件等小文件被频繁读取时，Page
            Cache 的缓存效果显著。
            
- **多进程共享读取**：多个进程读取同一个文件时，Page
            Cache
            提供了天然的数据共享机制，避免每个进程各自缓存一份。
            
- **预读优化**：内核的预读算法（Readahead）能够在顺序读取时提前将数据加载到
            Page
            Cache，对于没有自行实现预读的应用来说，这是一个免费的性能优化。
            
- **应用层无缓存**：如果应用程序没有自己的缓存层，绕过
            Page Cache 意味着每次读取都要访问磁盘，性能会急剧下降。
            
- **写合并**：Page Cache
            可以将多个小写入合并为一个大写入再刷盘，减少磁盘 I/O
            次数。
            
            

简单的判断原则是：如果应用程序已经在应用层实现了完善的缓存管理，并且对缓存策略有精细的控制需求，那么绕过
            Page Cache 是值得考虑的；否则，应该依赖内核 Page Cache。
            
            

## 二、O_DIRECT
            的语义与机制

            

### 2.1 O_DIRECT 标志

            

`O_DIRECT` 是 Linux
            提供的一个文件打开标志（Open
            Flag），用于告知内核在读写该文件时绕过页缓存（Page
            Cache），让数据直接在用户空间缓冲区和块设备之间传输。其基本用法如下：
            
```
#include 

int fd = open("/data/myfile.dat", O_RDWR | O_DIRECT);
if (fd 
            

`O_DIRECT` 最早在 SGI 的 IRIX
            操作系统中引入，后来被 Linux 2.4.10 版本采纳。POSIX
            标准并未定义 `O_DIRECT`，它是一个 Linux
            特有的扩展。在 FreeBSD 中有类似的实现，但在 macOS 中需要使用
            `fcntl(F_NOCACHE)` 来达到类似效果。
            

### 2.2 内核实现原理

            

当应用程序使用 `O_DIRECT`
            打开文件并执行读写操作时，内核的 I/O
            路径发生了根本性的变化：
            

**传统缓冲 I/O 路径：**
            
```
用户空间缓冲区 ──memcpy──→ Page Cache ──→ BIO 层 ──→ 块设备驱动 ──→ 磁盘
```

            

**O_DIRECT I/O 路径：**
            
```
用户空间缓冲区 ──────────────→ BIO 层 ──→ 块设备驱动 ──→ 磁盘
```

            

在 O_DIRECT
            路径中，内核直接将用户空间缓冲区的物理页面（Physical
            Page）映射到 BIO（Block I/O）请求中，通过 DMA（Direct Memory
            Access，直接内存访问）在用户空间缓冲区和磁盘控制器之间传输数据。这消除了数据在用户空间和内核空间之间的拷贝，也避免了
            Page Cache 的内存占用。
            

内核中的关键代码路径位于
            `fs/direct-io.c`（通用实现）和各文件系统的
            `direct_IO` 方法中。以 ext4 为例，其
            `ext4_direct_IO()` 函数负责将 O_DIRECT
            请求转化为对块设备的直接操作。
            

### 2.3 对齐要求

            

O_DIRECT 最重要也最容易出错的约束就是对齐要求（Alignment
            Requirements）。使用 O_DIRECT
            时，以下三个参数必须满足对齐条件：
            
            
- **缓冲区地址**（Buffer
            Address）：用户空间缓冲区的起始地址必须对齐到逻辑块大小。
            
- **文件偏移量**（File
            Offset）：读写操作的起始偏移量必须对齐到逻辑块大小。
            
- **传输长度**（Transfer
            Length）：每次读写的字节数必须是逻辑块大小的整数倍。
            
            

如果任何一个条件不满足，`read()` 或
            `write()` 系统调用会返回 `-1`，并将
            `errno` 设置为 `EINVAL`。
            

### 2.4
            逻辑块大小与物理块大小

            

对齐的基准是文件系统的逻辑块大小（Logical Block
            Size），通常为 512 字节或 4096
            字节。可以通过以下命令查询：
            
```
# 查询逻辑块大小（逻辑扇区大小）
blockdev --getss /dev/sda

# 查询物理块大小（物理扇区大小）
blockdev --getpbsz /dev/sda

# 查询文件系统块大小
stat -f --format="%S" /data

# 或者通过 sysfs 查看
cat /sys/block/sda/queue/logical_block_size
cat /sys/block/sda/queue/physical_block_size
```

            

在实际编程中，最安全的做法是对齐到 4096
            字节（4KB），因为这是目前最常见的物理扇区大小和页面大小。部分旧设备使用
            512 字节的逻辑扇区，但对齐到 4096 字节总是兼容的。
            

可以通过 `statvfs()`
            在运行时获取文件系统块大小：
            
```
#include 

struct statvfs st;
if (statvfs("/data", &st) == 0) {
    printf("文件系统块大小：%lu 字节\n", st.f_bsize);
}
```

            

### 2.5 O_DIRECT
            不保证持久性

            

一个常见的误解是认为 O_DIRECT
            写入完成后数据就已经安全地持久化到磁盘上了。事实并非如此。
            

`O_DIRECT` 只保证数据绕过了内核的 Page
            Cache，但数据到达块设备层后，可能仍然停留在以下位置：
            
            
- **磁盘控制器的写缓存**（Disk Write Cache /
            Volatile Write Cache）
            
- **RAID 控制器的写缓存**（RAID Controller
            Write Cache）
            
- **SAN/NAS 设备的缓存层**
            
            

如果在数据停留在这些硬件缓存中时发生掉电，数据仍然会丢失。要保证持久性，必须在
            `write()` 之后调用 `fsync()` 或
            `fdatasync()`，或者在 `open()`
            时同时指定 `O_DIRECT | O_SYNC`。
            
```
/* O_DIRECT 写入 + fsync 持久化 */
ssize_t n = write(fd, aligned_buf, block_size);
if (n > 0) {
    if (fsync(fd) 
            
            

## 三、O_DIRECT 编程实战（C
            语言）

            

### 3.1 分配对齐缓冲区

            

使用 O_DIRECT 的第一步是分配满足对齐要求的缓冲区。标准的
            `malloc()` 返回的地址通常只对齐到 8 字节或 16
            字节，不满足 O_DIRECT 的要求。Linux
            提供了两种方式分配对齐内存：
            

**方式一：`posix_memalign()`**
            
```
#include 
#include 

void *buf = NULL;
int ret = posix_memalign(&buf, 4096, 4096);
if (ret != 0) {
    fprintf(stderr, "posix_memalign failed: %s\n", strerror(ret));
    return -1;
}
/* 使用 buf 进行 O_DIRECT 读写 */
free(buf);  /* 使用 free() 释放 */
```

            

`posix_memalign()`
            的第一个参数是指向指针的指针，第二个参数是对齐边界（必须是 2
            的幂且是 `sizeof(void *)`
            的倍数），第三个参数是分配大小。
            

**方式二：`aligned_alloc()`（C11
            标准）**
            
```
#include 

void *buf = aligned_alloc(4096, 4096);
if (buf == NULL) {
    perror("aligned_alloc failed");
    return -1;
}
/* 使用 buf */
free(buf);
```

            

`aligned_alloc()`
            要求分配大小必须是对齐边界的整数倍。
            

**方式三：`memalign()`（已过时，不推荐）**
            
```
#include 

void *buf = memalign(4096, 4096);  /* 非 POSIX 标准，已过时 */
```

            

在实际项目中，推荐使用
            `posix_memalign()`，因为它是 POSIX
            标准接口，可移植性最好。
            

### 3.2 打开文件并执行直接
            I/O

            
```
#include 
#include 
#include 
#include 
#include 
#include 

#define BLOCK_SIZE 4096
#define FILE_PATH "/data/testfile.dat"

int main(void)
{
    int fd;
    void *buf = NULL;
    ssize_t n;

    /* 分配对齐缓冲区 */
    int ret = posix_memalign(&buf, BLOCK_SIZE, BLOCK_SIZE);
    if (ret != 0) {
        fprintf(stderr, "posix_memalign: %s\n", strerror(ret));
        return 1;
    }

    /* 使用 O_DIRECT 打开文件 */
    fd = open(FILE_PATH, O_RDWR | O_CREAT | O_DIRECT, 0644);
    if (fd 
            

编译运行：
            
```
gcc -o direct_io_demo direct_io_demo.c -Wall -Wextra
./direct_io_demo
```

            

### 3.3 对齐错误的处理

            

当对齐条件不满足时，系统调用会返回
            `EINVAL`。以下示例演示如何检测和处理对齐错误：
            
```
#include 
#include 
#include 
#include 
#include 
#include 

int main(void)
{
    int fd;
    ssize_t n;

    fd = open("/data/testfile.dat", O_RDWR | O_CREAT | O_DIRECT, 0644);
    if (fd 
            

### 3.4 使用 pread/pwrite
            实现并发访问

            

在多线程环境中，使用 `pread()` 和
            `pwrite()` 可以避免文件偏移量的竞争条件（Race
            Condition），因为这两个系统调用将偏移量作为参数传入，不依赖文件描述符的当前位置：
            
```
#include 
#include 
#include 
#include 
#include 
#include 

#define BLOCK_SIZE 4096
#define NUM_THREADS 4

typedef struct {
    int fd;
    int thread_id;
} thread_arg_t;

void *writer_thread(void *arg)
{
    thread_arg_t *ta = (thread_arg_t *)arg;
    void *buf = NULL;
    posix_memalign(&buf, BLOCK_SIZE, BLOCK_SIZE);

    /* 每个线程写入不同的偏移位置 */
    off_t offset = (off_t)ta->thread_id * BLOCK_SIZE;
    memset(buf, 'A' + ta->thread_id, BLOCK_SIZE);

    ssize_t n = pwrite(ta->fd, buf, BLOCK_SIZE, offset);
    if (n thread_id, (long)offset, n);
    }

    free(buf);
    return NULL;
}

int main(void)
{
    int fd = open("/data/concurrent_test.dat",
                  O_RDWR | O_CREAT | O_DIRECT, 0644);
    if (fd 
            

编译时需要链接 pthread 库：
            
```
gcc -o concurrent_dio concurrent_dio.c -Wall -Wextra -lpthread
```

            
            

## 四、O_DIRECT
            编程实战（Rust）

            

### 4.1 基本的 O_DIRECT
            文件操作

            

Rust 标准库的 `std::fs::OpenOptions`
            不直接支持 `O_DIRECT` 标志，需要通过
            `std::os::unix::fs::OpenOptionsExt`
            扩展来设置自定义标志：
            
```
use std::fs::OpenOptions;
use std::io::{Read, Write, Seek, SeekFrom};
use std::os::unix::fs::OpenOptionsExt;

fn main() -> std::io::Result {
    let fd = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .custom_flags(libc::O_DIRECT)
        .open("/data/testfile.dat")?;

    println!("文件以 O_DIRECT 模式打开成功");
    Ok(())
}
```

            

在 `Cargo.toml` 中添加 `libc`
            依赖：
            
```
[dependencies]
libc = "0.2"
```

            

### 4.2 对齐缓冲区分配

            

Rust 中可以使用 `std::alloc`
            模块分配对齐内存：
            
```
use std::alloc::{alloc, dealloc, Layout};

struct AlignedBuffer {
    ptr: *mut u8,
    layout: Layout,
}

impl AlignedBuffer {
    fn new(size: usize, alignment: usize) -> Self {
        let layout = Layout::from_size_align(size, alignment)
            .expect("无效的布局参数");
        let ptr = unsafe { alloc(layout) };
        if ptr.is_null() {
            panic!("内存分配失败");
        }
        AlignedBuffer { ptr, layout }
    }

    fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.layout.size()) }
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.layout.size()) }
    }
}

impl Drop for AlignedBuffer {
    fn drop(&mut self) {
        unsafe { dealloc(self.ptr, self.layout) };
    }
}
```

            

### 4.3 完整的直接 I/O 示例

            
```
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::alloc::{alloc, dealloc, Layout};

const BLOCK_SIZE: usize = 4096;

struct AlignedBuffer {
    ptr: *mut u8,
    layout: Layout,
    len: usize,
}

impl AlignedBuffer {
    fn new(size: usize, alignment: usize) -> Self {
        let layout = Layout::from_size_align(size, alignment)
            .expect("无效的布局参数");
        let ptr = unsafe { alloc(layout) };
        if ptr.is_null() {
            panic!("内存分配失败");
        }
        AlignedBuffer { ptr, layout, len: size }
    }

    fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) }
    }
}

impl Drop for AlignedBuffer {
    fn drop(&mut self) {
        unsafe { dealloc(self.ptr, self.layout) };
    }
}

fn direct_write(fd: i32, buf: &[u8], offset: i64) -> Result {
    let n = unsafe {
        libc::pwrite(fd, buf.as_ptr() as *const libc::c_void,
                     buf.len(), offset)
    };
    if n  Result {
    let n = unsafe {
        libc::pread(fd, buf.as_mut_ptr() as *mut libc::c_void,
                    buf.len(), offset)
    };
    if n  Result> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .custom_flags(libc::O_DIRECT)
        .open("/data/rust_dio_test.dat")?;

    let fd = file.as_raw_fd();

    /* 写入 */
    let mut write_buf = AlignedBuffer::new(BLOCK_SIZE, BLOCK_SIZE);
    write_buf.as_mut_slice().fill(b'R');
    let written = direct_write(fd, write_buf.as_slice(), 0)?;
    println!("写入 {} 字节", written);

    /* fsync 确保持久化 */
    unsafe { libc::fsync(fd) };

    /* 读取 */
    let mut read_buf = AlignedBuffer::new(BLOCK_SIZE, BLOCK_SIZE);
    let read_n = direct_read(fd, read_buf.as_mut_slice(), 0)?;
    println!("读取 {} 字节，首字节：{}", read_n, read_buf.as_slice()[0] as char);

    Ok(())
}
```

            

### 4.4 安全封装

            

在生产代码中，建议将直接 I/O 操作封装为安全的 Rust
            接口，隐藏底层的 `unsafe` 细节：
            
```
use std::fs::File;
use std::io;
use std::os::unix::io::AsRawFd;
use std::path::Path;

pub struct DirectFile {
    file: File,
    block_size: usize,
}

impl DirectFile {
    pub fn open>(path: P, block_size: usize) -> io::Result {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .custom_flags(libc::O_DIRECT)
            .open(path)?;
        Ok(DirectFile { file, block_size })
    }

    pub fn write_block(&self, block_num: u64, data: &[u8]) -> io::Result {
        if data.len() != self.block_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "数据长度必须等于块大小"
            ));
        }
        if data.as_ptr() as usize % self.block_size != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "缓冲区地址未对齐"
            ));
        }
        let offset = (block_num as i64) * (self.block_size as i64);
        let fd = self.file.as_raw_fd();
        let n = unsafe {
            libc::pwrite(fd, data.as_ptr() as *const libc::c_void,
                         data.len(), offset)
        };
        if n  io::Result {
        self.file.sync_all()
    }
}
```

            
            

## 五、O_DIRECT +
            fsync：数据持久化保证

            

### 5.1 写入顺序与持久化语义

            

理解数据持久化需要区分三个层次：
            
            
- **应用层可见**：`write()`
            返回成功，数据对同一进程（以及其他使用 `O_DIRECT`
            读取的进程）可见。
            
- **内核层可见**：数据到达块设备驱动层，已提交到硬件队列。
            
- **持久化完成**：数据已写入非易失性存储介质（磁盘盘片、NAND
            闪存颗粒）。
            
            

`O_DIRECT`
            只保证数据到达第二个层次——内核块设备层。从块设备层到实际持久化之间，还有磁盘控制器的写缓存（通常为
            64MB～256MB 的
            DRAM）。要达到第三个层次，必须执行显式的同步操作。
            

标准的持久化写入模式如下：
            
```
/* 第一步：O_DIRECT 写入——数据到达块设备层 */
ssize_t n = pwrite(fd, aligned_buf, BLOCK_SIZE, offset);
if (n != BLOCK_SIZE) {
    /* 处理部分写入或错误 */
}

/* 第二步：fsync——刷出硬件写缓存，保证持久化 */
if (fsync(fd) 
            

### 5.2 fsync 与 fdatasync
            的区别

            

`fsync()` 和 `fdatasync()`
            都用于将文件的修改同步到磁盘，但它们在元数据（Metadata）处理上有差异：
            
            
            
            操作
            数据同步
            元数据同步
            典型延迟
            
            
            
            
            `fsync()`
            是
            全部元数据（包括 mtime、atime）
            较高
            
            
            `fdatasync()`
            是
            仅影响后续读取的元数据（如文件大小）
            较低
            
            
            
            

对于数据库的预分配文件（文件大小不变，只更新内容），`fdatasync()`
            的性能优于
            `fsync()`，因为它不需要更新文件的修改时间戳。
            
```
/* 文件大小未变的覆盖写入，使用 fdatasync 即可 */
pwrite(fd, buf, BLOCK_SIZE, offset);  /* 覆盖已有数据，大小不变 */
fdatasync(fd);                         /* 不更新 mtime，性能更好 */

/* 追加写入（文件大小改变），必须使用 fsync */
pwrite(fd, buf, BLOCK_SIZE, new_offset);  /* 写入到文件末尾之后 */
fsync(fd);                                 /* 需要同步文件大小元数据 */
```

            

### 5.3 sync_file_range
            的细粒度控制

            

`sync_file_range()` 提供了比
            `fsync()`
            更细粒度的同步控制，允许只同步文件的一个特定范围，并且可以异步启动回写：
            
```
#include 

/* 异步启动回写，不等待完成 */
sync_file_range(fd, offset, length,
                SYNC_FILE_RANGE_WRITE);

/* 等待之前启动的回写完成 */
sync_file_range(fd, offset, length,
                SYNC_FILE_RANGE_WAIT_BEFORE |
                SYNC_FILE_RANGE_WRITE |
                SYNC_FILE_RANGE_WAIT_AFTER);
```

            

需要特别注意的是，`sync_file_range()`
            不保证元数据的同步，也不保证数据在掉电后一定可恢复。它主要用于性能优化——提前启动回写以减少后续
            `fsync()` 的等待时间。PostgreSQL 在 WAL
            预写日志中就使用了这种两阶段同步策略。
            

### 5.4 fsync-after-rename
            模式

            

在需要原子性替换文件内容的场景下，`fsync-after-rename`
            是一种常用的模式。其基本流程如下：
            
```
/* 第一步：创建临时文件并写入新内容 */
int tmp_fd = open("/data/config.tmp",
                  O_WRONLY | O_CREAT | O_DIRECT, 0644);
pwrite(tmp_fd, new_data, data_len, 0);

/* 第二步：同步临时文件的数据 */
fsync(tmp_fd);
close(tmp_fd);

/* 第三步：原子性重命名 */
rename("/data/config.tmp", "/data/config.dat");

/* 第四步：同步目录元数据（确保 rename 操作持久化） */
int dir_fd = open("/data", O_RDONLY);
fsync(dir_fd);
close(dir_fd);
```

            

这个模式保证了即使在任何一步之后发生掉电，文件要么是旧的完整内容，要么是新的完整内容，不会出现半写入的损坏状态。RocksDB
            的 SST 文件写入和 etcd 的快照保存都使用了这种模式。
            

### 5.5 磁盘写缓存与写屏障

            

现代磁盘通常启用了写缓存（Write
            Cache），也称为易失性写缓存（Volatile Write
            Cache）。当应用程序调用 `fsync()`
            时，内核会向磁盘发送缓存刷出命令（Cache Flush
            Command）：
            
            
- **SATA/SAS 磁盘**：`FLUSH CACHE`
            或 `FLUSH CACHE EXT` 命令
            
- **NVMe 设备**（Non-Volatile Memory
            Express）：Flush 命令
            
            

这些命令指示磁盘将其内部写缓存中的所有数据刷到持久存储介质上。在
            `fsync()`
            返回之前，内核会等待磁盘确认刷出操作完成。
            

写屏障（Write
            Barrier）是内核用来保证写入顺序的机制。在启用写屏障的情况下，内核保证屏障之前的写入在屏障之后的写入到达磁盘之前完成。可以通过以下命令查看和控制磁盘写缓存：
            
```
# 查看磁盘写缓存状态
hdparm -W /dev/sda

# 禁用磁盘写缓存（谨慎使用，会降低性能）
hdparm -W0 /dev/sda

# 启用磁盘写缓存
hdparm -W1 /dev/sda
```

            

对于带有电池备份单元（Battery Backup Unit，BBU）的 RAID
            控制器，写缓存是由电池保护的，即使掉电也不会丢失数据。在这种配置下，`fsync()`
            只需要将数据从操作系统层面刷到 RAID
            控制器的缓存中即可，延迟更低。
            
            

## 六、各数据库的 Direct
            I/O 策略

            

### 6.1 MySQL/InnoDB

            

InnoDB 提供了 `innodb_flush_method`
            参数来控制数据文件和日志文件的 I/O 方式：
            
```
# MySQL 配置文件 my.cnf
[mysqld]
innodb_flush_method = O_DIRECT
```

            

可选值及其含义：
            
            
            
            
            
            
            
            
            
            值
            数据文件
            日志文件
            说明
            
            
            
            
            `fsync`（默认）
            缓冲 I/O + fsync
            缓冲 I/O + fsync
            依赖 Page Cache
            
            
            `O_DIRECT`
            O_DIRECT + fsync
            缓冲 I/O + fsync
            数据文件绕过缓存
            
            
            `O_DIRECT_NO_FSYNC`
            O_DIRECT（无 fsync）
            缓冲 I/O + fsync
            依赖硬件保证持久性
            
            
            `O_DSYNC`
            缓冲 I/O + fsync
            O_SYNC
            日志同步写入
            
            
            
            

在生产环境中，`O_DIRECT` 是最常用的配置，因为
            InnoDB 的 Buffer Pool 已经提供了应用层缓存，再使用 Page
            Cache 只会浪费内存。`O_DIRECT_NO_FSYNC`
            仅适用于配备 BBU RAID
            控制器的环境，在这种环境下可以安全地省略 `fsync`
            调用。
            

日志文件（Redo Log）仍然使用缓冲 I/O，是因为 InnoDB 的
            Redo Log 写入模式（小块追加写入）更适合 Page Cache
            的写合并特性。并且 InnoDB 通过
            `innodb_flush_log_at_trx_commit`
            参数精确控制日志的刷盘时机。
            

### 6.2 PostgreSQL

            

PostgreSQL 默认不使用
            `O_DIRECT`，而是完全依赖操作系统的 Page
            Cache。这是一个有争议的设计决策，PostgreSQL
            社区的理由包括：
            
            
- PostgreSQL 的共享缓冲区（Shared
            Buffers）通常只配置为物理内存的 25%，剩余内存留给 Page Cache
            使用。
            
- PostgreSQL 的预读和缓存管理不如 InnoDB 精细，需要 Page
            Cache 作为补充。
            
- `O_DIRECT`
            的对齐要求增加了代码复杂性和平台可移植性问题。
            
            

从 PostgreSQL 16 开始，引入了 `io_method`
            参数的实验性支持。未来版本可能会提供 `O_DIRECT`
            选项。
            

社区中有人通过修改源码测试了
            `O_DIRECT`，结果表明：在 Shared Buffers
            大于可用内存 50% 的配置下，`O_DIRECT` 可以减少约
            30% 的内存占用，但随机读性能会有 10%～20% 的下降（因为失去了
            Page Cache 的缓存作用）。
            

### 6.3 RocksDB

            

RocksDB 提供了细粒度的 O_DIRECT 控制选项：
            
```
rocksdb::Options options;

/* 读取时使用 O_DIRECT */
options.use_direct_reads = true;

/* 刷写和压缩时使用 O_DIRECT */
options.use_direct_io_for_flush_and_compaction = true;
```

            

RocksDB 的 O_DIRECT 策略反映了 LSM-Tree（Log-Structured
            Merge Tree）的 I/O 特征：
            
            
- **读取路径**：用户读取首先检查 MemTable 和
            Block Cache。未命中时才访问 SST 文件。启用
            `use_direct_reads` 可以避免 Page Cache 缓存 SST
            文件数据，因为 Block Cache 已经提供了缓存。
            
- **写入/压缩路径**：刷写（Flush）和压缩（Compaction）操作涉及大量顺序
            I/O，会严重污染 Page Cache。启用
            `use_direct_io_for_flush_and_compaction`
            可以防止这种污染。
            
            

### 6.4 MongoDB/WiredTiger

            

MongoDB 的 WiredTiger 存储引擎支持通过
            `--wiredTigerDirectoryForDirectIO`
            选项或配置文件启用 O_DIRECT：
            
```
# mongod.conf
storage:
  wiredTiger:
    engineConfig:
      directoryForIndexes: true
    collectionConfig:
      blockCompressor: snappy
```

            

WiredTiger 也可以通过更底层的引擎配置字符串启用
            O_DIRECT：
            
```
direct_io=[data,log,checkpoint]
```

            

WiredTiger 自行维护了一个内部缓存（WiredTiger Internal
            Cache），其大小默认为 `(RAM - 1GB) / 2` 或
            256MB（取较大值）。启用 O_DIRECT
            时，所有数据访问都通过这个内部缓存进行，不依赖操作系统 Page
            Cache。
            

### 6.5 SQLite

            

SQLite 不支持
            `O_DIRECT`。其设计理念是作为一个嵌入式数据库，运行在各种环境下（包括不支持
            O_DIRECT 的文件系统和操作系统），因此不使用平台特定的 I/O
            优化。
            

SQLite 使用标准的缓冲 I/O 加 `fsync()`
            来保证数据持久性。其 VFS（Virtual File
            System，虚拟文件系统）层提供了足够的抽象，用户可以通过自定义
            VFS 实现来使用 O_DIRECT，但这不在官方支持范围内。
            

### 6.6 策略对比总结

            
            
            
            数据库
            默认 I/O
            O_DIRECT 支持
            应用层缓存
            适用场景
            
            
            
            
            MySQL/InnoDB
            缓冲 I/O
            完善
            Buffer Pool
            OLTP
            
            
            PostgreSQL
            缓冲 I/O
            实验性
            Shared Buffers
            OLTP/OLAP
            
            
            RocksDB
            可配置
            细粒度
            Block Cache + MemTable
            写密集型
            
            
            MongoDB/WiredTiger
            缓冲 I/O
            支持
            Internal Cache
            文档存储
            
            
            SQLite
            缓冲 I/O
            不支持
            页缓存
            嵌入式
            
            
            
            
            

## 七、O_DIRECT
            的限制与陷阱

            

### 7.1 对齐违规

            

对齐违规是 O_DIRECT
            最常见的错误来源。以下总结了三种对齐要求及其常见的违规场景：
            
```
1. 缓冲区地址对齐：
   ✗ malloc(4096)                     → 地址可能不对齐
   ✓ posix_memalign(&buf, 4096, 4096) → 地址保证 4096 字节对齐

2. 文件偏移量对齐：
   ✗ pwrite(fd, buf, 4096, 100)       → 偏移 100 不对齐
   ✓ pwrite(fd, buf, 4096, 4096)      → 偏移 4096 对齐

3. 传输长度对齐：
   ✗ pwrite(fd, buf, 1000, 0)         → 长度 1000 不是块大小的倍数
   ✓ pwrite(fd, buf, 4096, 0)         → 长度 4096 是块大小的倍数
```

            

在调试对齐问题时，可以使用 `strace`
            观察系统调用的参数和返回值：
            
```
strace -e trace=read,write,pread64,pwrite64 ./my_program 2>&1 | grep EINVAL
```

            

### 7.2 混合 I/O
            模式的不一致性

            

在同一个文件上同时使用 O_DIRECT 和缓冲 I/O
            是危险的。考虑以下场景：
            
```
/* 进程 A：缓冲写入 */
int fd_buf = open("/data/file.dat", O_WRONLY);
write(fd_buf, "hello", 5);  /* 数据写入 Page Cache */

/* 进程 B：O_DIRECT 读取 */
int fd_dio = open("/data/file.dat", O_RDONLY | O_DIRECT);
pread(fd_dio, buf, 4096, 0);  /* 直接从磁盘读取，可能看不到 A 的写入 */
```

            

进程 A 通过缓冲 I/O 写入的数据停留在 Page Cache
            中，尚未刷到磁盘。进程 B 通过 O_DIRECT 读取时绕过了 Page
            Cache，直接从磁盘读取，因此读到的是旧数据。
            

Linux
            内核文档明确警告了这种用法的风险。如果必须混合使用两种模式，需要在缓冲写入后执行
            `fsync()` 以确保数据已刷到磁盘，然后再进行
            O_DIRECT 读取。
            

### 7.3
            特殊文件系统上的行为差异

            

O_DIRECT 在不同文件系统和存储后端上的行为并不一致：
            

**tmpfs**：tmpfs
            是基于内存的文件系统，所有数据都存储在 Page Cache 中。在
            tmpfs 上使用 O_DIRECT 时，内核会静默地忽略
            `O_DIRECT` 标志，退回到缓冲 I/O。这意味着在 tmpfs
            上测试 O_DIRECT
            代码的行为可能与在实际磁盘文件系统上不同。
            

**NFS（Network File
            System，网络文件系统）**：NFS 对 O_DIRECT
            的支持取决于服务端和客户端的版本。NFSv3 和 NFSv4 支持
            O_DIRECT，但语义与本地文件系统有所不同——O_DIRECT
            只保证客户端不缓存数据，服务端可能仍然使用缓存。在某些 NFS
            实现中，O_DIRECT 会导致每个 I/O
            操作都等待服务端确认，严重影响性能。
            

**FUSE（Filesystem in Userspace）**：FUSE
            文件系统对 O_DIRECT 的支持在 Linux 6.6 之前是受限的。FUSE
            守护进程默认使用缓冲 I/O 与内核交互，即使应用程序指定了
            O_DIRECT。从 Linux 6.6 开始，FUSE 引入了 O_DIRECT
            直通（Passthrough）模式，可以将 O_DIRECT
            请求直接传递给底层文件系统。
            

### 7.4 小随机读取的性能回退

            

在没有应用层缓存的情况下使用 O_DIRECT
            进行小随机读取，性能可能比缓冲 I/O 差得多。原因在于：
            
            
- **缓冲 I/O
            路径**：内核的预读算法会在读取一个 4KB
            页时，预读后续的 128KB 数据到 Page
            Cache。如果后续读取命中了这些预读数据，就不需要额外的磁盘
            I/O。
            
- **O_DIRECT 路径**：每次读取精确地请求
            4KB，不会预读。即使后续访问的是相邻数据，也需要单独的磁盘
            I/O。
            
            

在 HDD（Hard Disk
            Drive，机械硬盘）上，每次随机读取的寻道时间约为 5～10
            毫秒。使用 O_DIRECT
            的小随机读取会频繁触发寻道，吞吐量可能只有缓冲 I/O
            的十分之一。即使在 SSD（Solid State
            Drive，固态硬盘）上，O_DIRECT
            的小随机读取性能也会因为缺少预读而略低于缓冲 I/O。
            

### 7.5
            文件系统元数据仍经过 Page Cache

            

O_DIRECT
            只能绕过文件数据的缓存，文件系统元数据（目录项、inode、块分配位图等）的读写仍然经过
            Page Cache。这意味着：
            
            
- `rename()`、`mkdir()`、`link()`
            等元数据操作仍然需要 `fsync()`
            来保证持久性。
            
- 文件系统的日志（ext4 的 JBD2、XFS 的日志）仍然使用缓冲
            I/O。
            
- 扩展属性（Extended Attributes）的读写也经过 Page
            Cache。
            
            

### 7.6 ext4 与 XFS
            的行为差异

            

ext4 和 XFS 在 O_DIRECT
            的实现上有一些值得注意的差异：
            

**ext4**： - 当 O_DIRECT
            写入导致文件扩展（文件大小增长）时，ext4
            可能需要分配新的数据块。这个分配过程涉及元数据更新，可能会阻塞
            O_DIRECT 写入。 - ext4 的 `data=ordered`
            日志模式下，O_DIRECT 写入仍然受到日志提交（Journal
            Commit）的影响。 -
            对于未对齐到文件系统块大小的文件末尾区域，ext4
            可能会退回到缓冲 I/O。
            

**XFS**： - XFS 对 O_DIRECT
            的支持更加成熟和一致，是大规模存储系统中最常用的文件系统。 -
            XFS 支持 O_DIRECT 与 `fallocate()`
            结合使用，可以预分配磁盘空间避免写入时的块分配开销。 - XFS
            的 extent-based 分配策略使得大文件的 O_DIRECT
            顺序写入更加高效。 - XFS 在 O_DIRECT
            模式下对并发写入同一文件的支持比 ext4 更好，不需要获取 inode
            互斥锁。
            

生产环境中的数据库服务器，如果使用 O_DIRECT，通常推荐搭配
            XFS 文件系统。
            
            

## 八、性能对比测试

            
            

**环境声明**：本节 fio/sysbench
            命令可在读者环境复现；表中数字为**同一套命令在 8.1
            所述硬件上的示例输出形态**，用于说明趋势（冷缓存 vs
            热缓存、双重缓冲内存占用），**不是跨环境通用
            IOPS**——结论须在本机重跑后采信。
            
            

### 8.1 测试环境

            
```
硬件配置：
  CPU：Intel Xeon Gold 6248R（24 核 48 线程）
  内存：256GB DDR4-2933
  存储：Intel P4610 NVMe SSD（3.2TB）
  文件系统：XFS（4KB 块大小）

软件环境：
  操作系统：Ubuntu 22.04 LTS
  内核版本：5.15.0
  fio 版本：3.33
```

            

### 8.2 顺序写入对比

            

使用 `fio` 测试 128KB 顺序写入，比较缓冲 I/O
            和 O_DIRECT 的性能：
            
```
# 缓冲 I/O 顺序写入
fio --name=buffered_seq_write \
    --ioengine=sync \
    --rw=write \
    --bs=128k \
    --size=10G \
    --numjobs=1 \
    --direct=0 \
    --fsync=0 \
    --filename=/data/fio_test \
    --output-format=json

# O_DIRECT 顺序写入
fio --name=direct_seq_write \
    --ioengine=sync \
    --rw=write \
    --bs=128k \
    --size=10G \
    --numjobs=1 \
    --direct=1 \
    --fsync=0 \
    --filename=/data/fio_test \
    --output-format=json
```

            

示例输出形态（128KB 顺序写，本机 fio 复现）：
            
```
                      缓冲 I/O        O_DIRECT
吞吐量 / 延迟 / CPU     本机测量        本机测量
趋势（常见）            写合并可能更高吞吐   memcpy 更少，延迟尖刺更少
```

            

在顺序写入场景中，缓冲 I/O 的吞吐量略高（得益于 Page
            Cache 的写合并），但 CPU 使用率也更高（因为 memcpy
            开销）。O_DIRECT 的延迟略高但更稳定，没有因为 Page Cache
            回写而产生的延迟尖刺（Latency Spike）。
            

### 8.3 随机读取对比

            

使用 `fio` 测试 4KB 随机读取：
            
```
# 缓冲 I/O 随机读取（冷缓存）
echo 3 > /proc/sys/vm/drop_caches
fio --name=buffered_rand_read \
    --ioengine=sync \
    --rw=randread \
    --bs=4k \
    --size=10G \
    --numjobs=1 \
    --direct=0 \
    --filename=/data/fio_test \
    --runtime=60 \
    --time_based \
    --output-format=json

# O_DIRECT 随机读取
fio --name=direct_rand_read \
    --ioengine=sync \
    --rw=randread \
    --bs=4k \
    --size=10G \
    --numjobs=1 \
    --direct=1 \
    --filename=/data/fio_test \
    --runtime=60 \
    --time_based \
    --output-format=json
```

            

示例输出形态（须在本机 fio 复现后替换）：
            
```
                      缓冲 I/O（冷缓存）   缓冲 I/O（热缓存）   O_DIRECT
IOPS                   （本机测量）          （本机测量）         （本机测量）
平均 / P99 延迟         冷缓存通常高于热缓存   热缓存命中时最低      与冷缓存接近，少 memcpy
```

            

随机读取场景中，如果数据能够全部放入 Page
            Cache（热缓存），缓冲 I/O 的性能远超
            O_DIRECT。但在冷缓存场景下，两者性能接近，O_DIRECT
            甚至因为减少了 memcpy 开销而在 P99 延迟上略有优势。
            

### 8.4 数据库负载测试

            

使用 sysbench 测试 MySQL/InnoDB 在不同 I/O
            模式下的性能：
            
```
# 准备数据（10 张表，每张 100 万行）
sysbench oltp_read_write \
    --mysql-host=127.0.0.1 \
    --mysql-port=3306 \
    --mysql-user=root \
    --mysql-db=sbtest \
    --tables=10 \
    --table-size=1000000 \
    prepare

# 运行基准测试
sysbench oltp_read_write \
    --mysql-host=127.0.0.1 \
    --mysql-port=3306 \
    --mysql-user=root \
    --mysql-db=sbtest \
    --tables=10 \
    --table-size=1000000 \
    --threads=32 \
    --time=300 \
    --report-interval=10 \
    run
```

            

示例对比维度（sysbench 在本机 MySQL 上复现；勿跨环境引用
            TPS）：
            
```
innodb_flush_method    关注指标
fsync                  TPS、P95、总内存（含 Page Cache 膨胀）
O_DIRECT               双重缓冲消除后，内存可转给 Buffer Pool
O_DIRECT_NO_FSYNC      刷盘语义变化，须单独评估数据安全
```

            

在 Buffer Pool 能够覆盖工作集（Working
            Set）的情况下，O_DIRECT 模式的性能优于默认的
            `fsync` 模式。主要收益来自：
            
            
- 消除了双重缓冲，释放了更多内存。
            
- 减少了 memcpy 开销。
            
- 避免了 Page Cache 回写产生的延迟尖刺。
            
            

### 8.5 fio 高级测试命令

            

以下是一些更详细的 fio 测试命令，用于评估 O_DIRECT
            在不同场景下的表现：
            
```
# 混合随机读写（70% 读 / 30% 写）
fio --name=mixed_rw \
    --ioengine=libaio \
    --rw=randrw \
    --rwmixread=70 \
    --bs=4k \
    --size=10G \
    --numjobs=4 \
    --iodepth=32 \
    --direct=1 \
    --filename=/data/fio_test \
    --runtime=120 \
    --time_based \
    --group_reporting

# 延迟直方图测试
fio --name=latency_test \
    --ioengine=libaio \
    --rw=randread \
    --bs=4k \
    --size=10G \
    --numjobs=1 \
    --iodepth=1 \
    --direct=1 \
    --filename=/data/fio_test \
    --runtime=60 \
    --time_based \
    --lat_percentiles=1 \
    --percentile_list=50:90:95:99:99.9:99.99

# O_DIRECT + io_uring 引擎
fio --name=io_uring_test \
    --ioengine=io_uring \
    --rw=randread \
    --bs=4k \
    --size=10G \
    --numjobs=1 \
    --iodepth=128 \
    --direct=1 \
    --fixedbufs=1 \
    --sqthread_poll=1 \
    --filename=/data/fio_test \
    --runtime=60 \
    --time_based
```

            

### 8.6 O_DIRECT
            的适用场景总结

            

基于以上测试结果，可以总结出 O_DIRECT 的适用场景：
            

**O_DIRECT 占优的场景：**
            
            
- 数据库系统已有应用层缓存（Buffer Pool / Block
            Cache）
            
- 高吞吐顺序写入，要求稳定延迟
            
- 大文件顺序扫描（避免 Page Cache 污染）
            
- 内存受限环境（避免双重缓冲的内存浪费）
            
            

**缓冲 I/O 占优的场景：**
            
            
- 应用无自有缓存，依赖 Page Cache 提升重复读性能
            
- 小文件频繁读写
            
- 多进程共享读取同一文件
            
- 随机读取工作集远大于可用内存
            
            

### 8.7 内存使用对比

            

以下是对比缓冲 I/O 和 O_DIRECT
            在数据库场景下的内存使用情况：
            
```
# 查看 Page Cache 使用量
cat /proc/meminfo | grep -E "^(MemTotal|MemFree|Cached|Buffers|Active\(file\)|Inactive\(file\))"

# 查看特定文件的 Page Cache 占用（需要 vmtouch 工具）
vmtouch /data/mysql/ibdata1
vmtouch -v /data/mysql/ib_logfile0
```

            

示例对比维度（`vmtouch` +
            `/proc/meminfo`，本机复现）：
            
```
指标                    缓冲 I/O（fsync）    O_DIRECT
InnoDB Buffer Pool      配置值               配置值
Page Cache 占用         常随数据文件膨胀      通常仅元数据/日志
可用内存                常被 Page Cache 挤占  可转给 Buffer Pool
```

            
            

## 九、替代方案与未来

            

### 9.1 io_uring 与异步直接
            I/O

            

io_uring 解决的是**提交效率**（批量
            SQ/CQ、减少 syscall），不替代 `O_DIRECT`
            的缓存语义。机制见 #11 Linux
            异步 I/O 与 [io_uring
            系列索引](../../io_uring/index.html)；**`O_DIRECT` + io_uring
            的对齐、`register_buffers` 与本机 IOPS
            对比**见 #79。生产启用前须读
            io_uring
            翻车实录 中的版本边界与内核 bug。
            

下面保留最小可读示例（完整组合路径与 benchmark
            不在本文展开）：
            
```
#include 
- 
#include 
#include 
#include 
#include 

#define BLOCK_SIZE 4096
#define QUEUE_DEPTH 64

int main(void)
{
    struct io_uring ring;
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int fd;
    void *buf;

    /* 初始化 io_uring，启用内核轮询线程 */
    struct io_uring_params params;
    memset(¶ms, 0, sizeof(params));
    params.flags = IORING_SETUP_SQPOLL;
    params.sq_thread_idle = 2000;  /* 空闲 2 秒后休眠 */

    int ret = io_uring_queue_init_params(QUEUE_DEPTH, &ring, ¶ms);
    if (ret res res));
        } else {
            printf("异步读取完成：%d 字节\n", cqe->res);
        }
        io_uring_cqe_seen(&ring, cqe);
    }

    free(buf);
    close(fd);
    io_uring_queue_exit(&ring);
    return 0;
}
```

            

编译：
            
```
gcc -o io_uring_dio io_uring_dio.c -luring -Wall -Wextra
```

            

绝对 IOPS 与设备、队列深度、是否
            `register_buffers` 强相关；本站仅在 #79
            给出**标注环境**的本机实测，本文不列跨环境数字。
            

### 9.2
            DAX：持久内存的直接访问

            

DAX（Direct Access，直接访问）是为持久内存（Persistent
            Memory，PMEM）设计的一种文件访问模式。与 O_DIRECT 不同，DAX
            完全绕过了内核的 I/O 栈和块设备层，允许应用程序通过
            `mmap()`
            直接映射持久内存到用户空间地址空间，然后通过普通的
            load/store 指令读写数据。
            
```
传统 I/O 路径：    应用 → 系统调用 → VFS → 文件系统 → 块设备 → 磁盘
O_DIRECT 路径：   应用 → 系统调用 → VFS → 文件系统 → 块设备 → 磁盘（绕过 Page Cache）
DAX 路径：        应用 → 直接 load/store → 持久内存（绕过所有中间层）
```

            

要使用 DAX，需要满足以下条件：
            
            
- 硬件：支持持久内存的平台（如 Intel Optane DCPMM）
            
- 文件系统：ext4 或 XFS，以 `-o dax`
            选项挂载
            
- 应用程序：使用 `mmap()` 映射文件，使用
            `clflush` / `clwb` 指令保证持久性
            
            
```
# 挂载 DAX 文件系统
mkfs.xfs /dev/pmem0
mount -o dax /dev/pmem0 /mnt/pmem

# 或者使用 per-file DAX（Linux 5.8+）
xfs_io -c "chattr +x" /mnt/pmem/myfile
```

            

DAX
            消除了所有软件层面的开销，读写延迟可以降低到数百纳秒级别。但
            DAX 要求应用程序自行管理数据一致性和持久化（通过 CPU
            缓存刷出指令），编程复杂度远高于 O_DIRECT。
            

PMDK（Persistent Memory Development
            Kit，持久内存开发套件）提供了一系列库和工具来简化 DAX
            编程。
            

### 9.3 FUSE 与 O_DIRECT
            直通

            

FUSE（Filesystem in
            Userspace，用户空间文件系统）允许在用户空间实现文件系统。传统的
            FUSE 实现中，即使应用程序指定了 O_DIRECT，数据仍然会经过
            FUSE 守护进程的用户空间缓冲区，无法真正绕过缓存。
            

Linux 6.6 内核引入了 FUSE 的直通模式（Passthrough
            Mode），允许 FUSE 文件系统将 I/O
            请求直接转发到底层文件系统，无需经过 FUSE 守护进程。这解决了
            FUSE 文件系统在 O_DIRECT 场景下的性能瓶颈。
            

直通模式的典型应用场景包括：
            
            
- **Android 的 FUSE 文件系统**：Android 使用
            FUSE 实现存储访问框架（Storage Access
            Framework），直通模式可以显著提升 Android 设备的 I/O
            性能。
            
- **容器存储驱动**：一些容器存储方案使用 FUSE
            实现overlay文件系统，直通模式可以减少容器 I/O 的延迟。
            
- **加密文件系统**：eCryptfs
            等加密文件系统使用 FUSE
            实现，直通模式可以在加密解密不需要时（如已解密区域的读取）提供更好的性能。
            
            

### 9.4 O_DIRECT
            在新内核中的演进

            

O_DIRECT 在 Linux
            内核中持续演进，以下是近年来的重要变化：
            

**Linux 5.1（2019）**：io_uring 框架引入，为
            O_DIRECT 提供了高性能的异步接口。
            

**Linux 5.4（2019）**：`io_uring`
            增加了 `IOSQE_FIXED_FILE`
            标志，允许预注册文件描述符，减少每次 I/O
            操作的系统调用开销。
            

**Linux 5.6（2020）**：`io_uring`
            引入
            `IORING_REGISTER_BUFFERS`，允许预注册用户空间缓冲区。对于
            O_DIRECT 来说，预注册缓冲区可以避免每次 I/O
            操作时的页表锁定（Page Pinning）开销。
            

**Linux 5.11（2021）**：优化了 O_DIRECT 在
            ext4 上的并发写入性能，减少了 inode 锁的争用。
            

**Linux 6.1（2022）**：引入了
            `IORING_SETUP_SINGLE_ISSUER` 标志，针对单线程
            O_DIRECT 工作负载优化了 io_uring 的性能。
            

**Linux 6.6（2023）**：FUSE 直通模式支持
            O_DIRECT。
            

**Linux 6.7（2024）**：改进了大块 O_DIRECT
            写入在 XFS 上的性能，减少了对块分配锁的依赖。
            

这些演进表明，内核社区在持续优化 O_DIRECT
            的性能和可用性，O_DIRECT
            在可预见的未来仍将是高性能存储系统的核心技术。
            

### 9.5 面向未来的 I/O 架构

            

综合来看，Linux I/O
            栈的发展趋势是提供越来越多的方式让应用程序直接控制 I/O
            路径：
            
```
灵活性增加 ──────────────────────────────→
┌──────────┐  ┌──────────┐  ┌─────┐  ┌─────┐
│ 缓冲 I/O │  │ O_DIRECT │  │ DAX │  │SPDK │
│          │  │          │  │     │  │     │
│ 内核完全 │  │ 绕过     │  │ 绕过 │  │ 完全│
│ 管理缓存 │  │ Page     │  │ 整个 │  │ 绕过│
│          │  │ Cache    │  │ I/O  │  │ 内核│
│          │  │          │  │ 栈   │  │     │
└──────────┘  └──────────┘  └─────┘  └─────┘
控制力增加 ──────────────────────────────→
复杂度增加 ──────────────────────────────→
```

            

SPDK（Storage Performance Development
            Kit，存储性能开发套件）代表了最极端的方式：完全绕过内核，在用户空间直接与
            NVMe 设备交互。SPDK 可以达到最低的延迟和最高的
            IOPS，但要求应用程序完全接管设备管理、中断处理和内存管理等工作。
            

对于大多数数据库系统来说，`O_DIRECT`
            解决缓存语义；是否叠加 io_uring 见 #79。更极端的用户态路径是
            SPDK（完全绕过内核块层）。
            
            

## 十、开放问题

            
            
- **Copy-on-write 与 reflink 文件系统上的 direct
            语义。** Btrfs/ZFS 等 CoW 路径下
            `O_DIRECT` 与快照、克隆的交互仍依赖具体 FS
            实现；生产前须在目标文件系统上实测写顺序与空间分配。
            
- **Buffered 与 direct 混用同一 inode。**
            部分内核/FS 组合对同一文件混用 `mmap`/缓冲 fd 与
            `O_DIRECT` fd 的行为不一致；InnoDB
            等引擎通常整库统一 direct，避免 silent corruption
            类风险。
            
            
            

## 参考资料

            

### 规范 / 手册

            
            
- Linux
            `man 2 open`（`O_DIRECT`）、`man 2 fsync`、`fadvise(2)`
            
- Linux Kernel Documentation — ext4/XFS direct I/O
            说明
            
            

### 源码

            
            
- Linux 内核 `fs/direct-io.c`、各文件系统
            `*_direct_IO` 入口
            
            

### 论文 / 书

            
            
- Sweeney, A. *Scalability in the XFS File
            System*（USENIX ATC 1996）— direct I/O 工程起源之一
            
- Mathur et al., *The new ext4 filesystem*（Linux
            Symposium 2007）
            
- Love, R. *Linux Kernel Development*, 3rd ed.
            
            

### 实验 / 工具 / 文档

            
            
- MySQL Reference Manual —
            `innodb_flush_method`
            
- RocksDB Wiki — Direct IO
            
- fio、`vmtouch`（本节 benchmark
            复现工具）
            
- 本站 #79
            O_DIRECT + io_uring、#64
            存储基准方法论
            
            
            

**上一篇**：Page Cache
            深度解析 **下一篇**：Linux 异步
            I/O：从 POSIX AIO 到 io_uring **相关**：O_DIRECT
            与 io_uring 组合工程
        

## 读完这篇，下一步读什么

优先读同系列或同问题的下一篇，把单篇消费变成主题集群。
                
                    

2026-06-12 · storage
                    

### 【存储工程】O_DIRECT 与 io_uring：固定缓冲区、register_buffers 与工程选型

                    

拆解 O_DIRECT 对齐约束与 io_uring 固定缓冲区（IORING_REGISTER_BUFFERS）如何叠加；对比 buffered/Direct I/O 的 io_uring 实测 IOPS，给出数据库与块设备场景选型。
                

                
                    

2025-08-21 · storage
                    

### 【存储工程】数据完整性：从 fsync 到端到端校验

                    

从 fsync 语义、写屏障与电源故障到静默损坏与端到端校验——建立存储栈各层丢失/损坏认知；算法选型见 checksum 篇，ZFS 实现见 zfs-integrity 篇。
                

                
                    

2025-10-14 · storage
                    

### 【存储工程】缓存工程：从 Page Cache 到应用层缓存

                    

深入分析存储多级缓存架构——Page Cache、Buffer Pool、应用缓存的协同设计，缓存淘汰算法对比，缓存穿透/击穿/雪崩的防护策略
                

                
                    

2025-10-15 · storage
                    

### 【存储工程】写入性能优化

                    

深入分析存储写入性能优化——WAL 分组提交、批量写入、Write Buffer 调优、fsync 频率控制、写入限速与写停顿分析