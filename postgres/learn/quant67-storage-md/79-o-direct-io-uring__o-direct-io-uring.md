# 【存储工程】O_DIRECT 与 io_uring：固定缓冲区、register_buffers 与工程选型

来源: https://quant67.com/post/storage/79-o-direct-io-uring/o-direct-io-uring.html
日期: 2026-06-12 |

---

**与 #10 的分工**
            
            
            
            
            
            
            
            文章
            分工
            
            
            
            
            [#10 Direct
            I/O](../10-direct-io/direct-io.html)
            **`O_DIRECT`
            语义与坑**：对齐、双重缓冲、何时绕过 Page
            Cache、文件系统差异
            
            
            **本文（#79）**
            **组合路径**：在已决定 direct 的前提下，用
            io_uring 批量提交；`register_buffers` / 本机
            benchmark
            
            
            [io_uring 系列](../../io_uring/index.html) ·
            内核内部
            SQ/CQ 机制与 opcode
            
            
            io_uring
            生产翻车实录
            版本矩阵、SQPOLL、容器 Seccomp——**上线 io_uring
            前必读**
            
            
            
            

**决策顺序**：先按 #10 判断是否绕过 Page
            Cache → 再决定是否用 io_uring 降 syscall →
            最后在**目标内核**上实测
            `register_buffers` + `O_DIRECT`（本文
            WSL2 6.6 上曾 EFAULT，不可外推）。
            
            

数据库和块存储引擎常同时遇到两件事：**用
            `O_DIRECT` 绕过 Page Cache
            避免双重缓冲**（见 #10），以及
            **用 io_uring 降低 syscall 开销**（见 io_uring
            内核内部）。两者可以组合，但对齐、`posix_memalign`、`io_uring_register_buffers`
            和 `IOSQE_FIXED_FILE`
            各有一层约束。本文把组合路径、**标注环境**的实测与选型边界写清楚。
            
            

**测试环境说明** 下文 benchmark 在 Linux
            6.6.87（WSL2）、liburing 2.14、ext4
            文件系统、`/tmp` 上实测。块设备裸盘与 NVMe
            上的绝对 IOPS
            会更高；结论侧重**路径差异与约束**，不跨环境比绝对数值。
            
            
            

## 一、为什么要把两者放在一起

            
```
flowchart LR
    APP[应用 Buffer Pool]
    UR[io_uring SQ/CQ]
    VFS[VFS + 文件系统]
    PC[Page Cache]
    DISK[块设备]
    APP -->|O_DIRECT 路径| UR --> VFS --> DISK
    APP -->|缓冲 I/O| UR --> VFS --> PC --> DISK
```

            
            
            
            
            
            
            
            
            路径
            数据副本
            典型用户
            
            
            
            
            缓冲 I/O + Page Cache
            用户缓冲 + 页缓存
            通用文件、小文件
            
            
            `O_DIRECT`
            仅用户缓冲（对齐后直写块层）
            InnoDB 数据文件、Ceph OSD、自定义引擎
            
            
            `O_DIRECT` + io_uring
            同上 + 批量提交减少 syscall
            高 IOPS 数据库、NVMe 压测工具
            
            
            
            

`O_DIRECT`
            解决**缓存语义**；io_uring
            解决**提交效率**。互不替代。是否绕过 Page Cache
            的判据见 [#10
            文首决策边界](../10-direct-io/direct-io.html)。
            
            

## 二、决策边界（何时组合）

            
            
            
            
            
            
            
            
            问题
            倾向
            说明
            
            
            
            
            应用是否自管缓存？
            是 → 考虑 `O_DIRECT`
            InnoDB Buffer Pool、RocksDB block cache 等（#10）
            
            
            瓶颈在 memcpy / 双缓存还是 syscall？
            前者 → direct；后者 → io_uring
            两者可叠加，但须分别验证
            
            
            工作负载
            随机 4K/16K 页、高 QD
            常见数据库页路径；顺序大扫描未必需要 io_uring
            
            
            文件系统
            ext4/XFS 本地块设备
            NFS/FUSE 对 direct 支持参差，先测通再组合
            
            
            生产内核
            对照 iouring-production
            版本矩阵
            `register_buffers` 泄漏、CQE overflow 等与
            5.10/5.15 边界相关
            
            
            
            

**谱系（简）**：POSIX AIO/libaio（真异步块
            I/O，接口残缺）→ epoll（就绪通知，仍同步 read/write）→
            io_uring（完成通知，可与 `O_DIRECT`
            叠加）。性能不是单调递增，低并发下 epoll 延迟可能更优（见 07
            epoll vs io_uring）。
            
            

## 三、O_DIRECT
            硬约束（复习）

            

来自 #10，组合 io_uring
            前必须满足：
            
            
- **缓冲区地址、长度、文件偏移**
            均按逻辑块大小对齐（ext4 常见 4 KB）。
            
- 使用 `posix_memalign(4096, size)` 或
            `mmap` 对齐映射，不要用普通
            `malloc`。
            
- 文件系统与块层需支持 direct
            I/O；部分网络文件系统不支持或行为怪异。
            
- `O_DIRECT` 与 `mmap`
            同一文件混用会踩坑；`sendfile` 等页缓存路径与
            direct fd 不兼容。
            
            
```
void *buf;
posix_memalign(&buf, 4096, 4096);
int fd = open(path, O_RDWR | O_CREAT | O_TRUNC | O_DIRECT, 0644);
```

            
            

## 四、io_uring
            固定缓冲区：`io_uring_register_buffers`

            

### 4.1 作用

            

每次 `read`/`write` 传统路径需要
            pin 用户页。`io_uring_register_buffers()`
            预先注册一组 `iovec`，内核长期持有映射，后续 SQE
            可通过 **buf_index** 引用，减少 per-I/O
            页表开销。
            
```
struct io_uring ring;
io_uring_queue_init(256, &ring, 0);

struct iovec iov = { .iov_base = aligned_buf, .iov_len = 4096 };
io_uring_register_buffers(&ring, &iov, 1);

struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe, fd, NULL, 4096, offset);
sqe->buf_index = 0;   /* 使用注册缓冲区槽位 0 */
io_uring_submit(&ring);
```

            

与 `IORING_REGISTER_FILES`（固定 fd
            槽位）独立：前者优化**缓冲区 pin**，后者优化
            **fd 查找**。
            

### 4.2 与
            `O_DIRECT` 叠加时的注意点

            
            
- 注册缓冲区本身必须是 **O_DIRECT
            合法的对齐内存**。
            
- 部分内核版本对 `register_buffers` +
            `O_DIRECT` + `NULL`
            用户地址组合的行为曾有 bug；升级内核后应回归测试。
            
- 本文环境实测：`O_DIRECT` + 普通
            `io_uring_prep_write(sqe, fd, buf, ...)`
            **成功**；`register_buffers` +
            `buf_index` 路径返回
            **-EFAULT（14）**——说明该组合在当前 WSL2 6.6
            栈上未走通，**生产启用前必须在目标内核上验证**。
            
            

### 4.3 Provided
            Buffers（进阶）

            

`IOSQE_BUFFER_SELECT` +
            `io_uring_setup_buf_ring` 是更新的缓冲池模型（见
            [io_uring
            高级特性](../../io_uring/05-advanced-features.html)），适合网络收包；块设备 Direct I/O
            场景更常见仍是 **register_buffers**
            或每请求显式缓冲区。
            
            

## 五、实测：三种
            io_uring 写路径（10k × 4KB）

            

测试程序对同一 ext4 文件顺序写 10000 次 4 KB（约 40
            MB），对比：
            
            
- 缓冲 I/O + io_uring（无 `O_DIRECT`）
            
- `O_DIRECT` + io_uring（对齐缓冲，无
            register）
            
- `O_DIRECT` +
            `register_buffers`（本文环境失败）
            
            
```
buffered io_uring write:     0.284 s, ~35242 IOPS
O_DIRECT io_uring write:     0.271 s, ~36840 IOPS
O_DIRECT + register_buffers: EFAULT（未成功完成）
```

            

解读（限于本环境）：
            
            
- 40 MB 规模下，缓冲与 Direct 的 IOPS
            接近——瓶颈尚未到设备上限，差异主要体现在**是否污染
            Page Cache**。
            
- `register_buffers`
            失败说明：**不能假设注册缓冲在所有 Direct
            组合下开箱即用**，需单独测通再上线。
            
            

完整复现可参考 liburing 示例 `examples/reg-wr`
            与 `man io_uring_register_buffers`。
            
            

## 六、与 epoll / 同步
            read 的选型

            
            
            
            
            
            
            
            
            场景
            更常见选择
            原因
            
            
            
            
            数据库 16KB 页随机读写
            `O_DIRECT` + 同步或 libaio/io_uring
            缓存语义由 Buffer Pool 掌控
            
            
            高并发网络 + 小包
            epoll 或 io_uring（常非 Direct）
            延迟与连接管理优先
            
            
            块设备裸盘压测
            `O_DIRECT` +
            io_uring/libaio，`direct=1`
            见 #64
            基准方法论
            
            
            大量空闲连接
            epoll 可能更省（见 io_uring
            vs epoll）
            io_uring 每连接状态成本
            
            
            
            

io_uring 不是 epoll 的完全替代；`O_DIRECT`
            也不是所有存储栈的默认。组合用于：**已决定绕过页缓存，且需要批量异步提交**。
            
            

## 七、工程检查清单

            
```
□ 缓冲区 4K（或设备块大小）对齐
□ open 带 O_DIRECT；ftruncate 预分配避免 ENOSPC 中途失败
□ 文件系统 block size 与 I/O 大小兼容
□ io_uring register_buffers 在目标内核实测通过
□ 监控 iowait 与 Buffer Pool 命中率，确认没有「双缓存」
□ 与 fsync/fsync 策略一致（见 #12 数据完整性）
```

            
            

## 八、与系列文章的衔接

            
            
- 页缓存路径：Page Cache、Linux I/O
            栈
            
- io_uring 机制：内核内部、异步 I/O
            综述、[io_uring
            系列索引](../../io_uring/index.html)
            
- 生产坑：io_uring
            翻车实录
            
- liburing API：03 liburing
            API、Golang
            集成
            
            
            

## 九、开放问题

            
            
- **`io_uring_register_buffers` +
            `O_DIRECT` 的内核组合行为未完全文档化。**
            本文 WSL2 6.6.87 上 `buf_index` 路径
            EFAULT，而显式用户指针可成功——说明必须按**目标内核+FS**回归，不能假设
            register 一定降 pin 开销。
            
- **SQPOLL / IOPOLL 与 direct 写的一致性。**
            轮询模式降低 syscall，但 idle CPU 与容器 Seccomp 限制见 iouring-production；与数据库
            fsync 策略叠加时的延迟尖刺仍缺统一 benchmark 口径。
            
            
            

## 参考资料

            

### 规范 / 手册

            
            
- Linux
            `man 2 open`（`O_DIRECT`）、`man io_uring_register_buffers`、`man io_uring_prep_read/write`
            
            

### 源码

            
            
- Linux
            内核：`fs/direct-io.c`、`io_uring/opdef.c`
            
            

### 论文 / 设计文档

            
            
- J. Axboe, *Efficient IO with io_uring* — https://kernel.dk/io_uring.pdf
            
            

### 实验 / 本站

            
            
- 复现：`examples/storage/79-o-direct-io-uring/`（`make && make run`）
            
- [#10 Direct
            I/O](../10-direct-io/direct-io.html)、#64
            存储基准测试、io_uring
            生产翻车实录
            
            
            

**上一篇**: 存储事故复盘
            **相关**: io_uring
            内核内部 · Direct I/O 详解 ·
            [Linux
            异步 I/O](../11-linux-async-io/linux-async-io.html) · io_uring
            生产翻车实录 · [SPDK /
            用户态存储栈](../../spdk/index.html)（绕过内核块层的另一条路径）
        

## 读完这篇，下一步读什么

优先读同系列或同问题的下一篇，把单篇消费变成主题集群。
                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

O_DIRECT 什么时候该用：双重缓冲、对齐约束、文件系统坑，以及与 io_uring 组合路径的边界。
                

                
                    

2025-08-20 · storage
                    

### 【存储工程】Linux 异步 I/O：从 POSIX AIO 到 io_uring

                    

在高吞吐存储系统中，同步 I/O 是性能的天花板。本文系统梳理 Linux 下三代异步 I/O 方案——POSIX AIO、Linux Native AIO（libaio）和 io_uring——的设计原理、编程接口、性能特征与工程实践，帮助你在实际项目中做出正确的技术选型。
                

                
                    

2025-08-12 · storage
                    

### 【存储工程】NVMe 协议与存储接口演进

                    

存储接口（Storage Interface）是连接主机与存储介质的桥梁，其协议设计直接决定了数据访问的延迟、吞吐量和并发能力。从早期的并行接口到现代的非易失性内存快捷通道（Non-Volatile Memory Express，NVMe），存储协议经历了数十年的演进。本文将系统梳理存储接口的发展历程，深入剖析 NVM…
                

                
                    

2026-04-22 · storage
                    

### 存储工程索引

                    

汇总本站存储工程系列文章，覆盖 HDD、SSD、NVMe、持久内存、索引结构、压缩、分布式存储与对象存储。