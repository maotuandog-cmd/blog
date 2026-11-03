# 【存储工程】数据完整性：从 fsync 到端到端校验

来源: https://quant67.com/post/storage/12-data-integrity/data-integrity.html
日期: 2025-08-21 |

---

**本篇分工（完整性三部曲）**
            
            
            
            
            
            
            
            文章
            分工
            
            
            
            
            **本文**
            `fsync`、写缓存、写屏障、电源故障、RAID
            盲区——**损坏何时发生**
            
            
            [43
            校验和与数据完整性](../43-checksum/checksum.html)
            CRC / xxHash / SHA
            选型、端到端原则、各系统校验实现——**如何检测**
            
            
            [17
            ZFS：数据完整性优先的存储栈](../17-zfs-integrity/zfs-integrity.html)
            Merkle 树、CoW、scrub / 自愈——**标杆 FS
            落地**
            
            
            
            
            

数据丢失最令人恐惧的形式不是磁盘报错——而是数据悄无声息地变了，没有任何告警，没有任何日志，直到几个月后你从备份里恢复出一堆损坏的文件，才发现”完整性”这个词从来就不是理所当然的。
            

一个 `write()`
            系统调用返回成功，数据就安全了吗？不。它只是拷贝到了内核的页缓存（Page
            Cache）里。一次 `fsync()`
            调用完成了，数据就落盘了吗？不一定——磁盘的写缓存可能还没刷到介质上。数据写到了磁盘上，就不会变了吗？更不是——静默数据损坏（Silent
            Data
            Corruption）随时可能发生，而且不会被操作系统或文件系统察觉。
            

本文从最基础的持久化语义开始，逐层向上，分析写缓存风险、写屏障机制、fsync
            代价、电源故障场景、静默损坏现象，最终到校验和策略和端到端数据保护方案。目标是让读者建立起”数据从应用层到磁盘介质，每一层都可能丢失或损坏”的完整认知，并给出每一层的防护手段。**校验和算法对比与
            ZFS Merkle 细节**分别见 43 checksum 与 17
            ZFS。
            
            

## 一、数据持久化的语义

            

### 1.1
            “写到磁盘”到底意味着什么

            

应用程序调用 `write()`
            写入数据时，实际发生的事情和大多数人的直觉相差甚远。理解持久化的完整语义链，是讨论数据完整性的前提。
            

一次写操作在 Linux 上经历以下路径：
            
```
应用程序 write()
    │
    ▼
内核页缓存（Page Cache）     ← write() 在此返回
    │
    ▼
块设备层（Block Layer）
    │
    ▼
磁盘控制器写缓存（Disk Write Cache）
    │
    ▼
持久化介质（磁盘盘片 / NAND Flash）  ← 数据真正持久化
```

            

`write()`
            系统调用的语义是：将数据从用户空间缓冲区拷贝到内核的页缓存中。一旦拷贝完成，`write()`
            就返回成功。此时数据仅存在于易失性的 DRAM
            中，如果系统崩溃或断电，数据就丢失了。
            

### 1.2 fsync 与 fdatasync

            

`fsync()` 是 POSIX
            标准定义的持久化接口，其语义是：将文件描述符关联的所有脏数据和元数据（Metadata）刷新到持久化存储设备上，并等待设备确认写入完成后才返回。
            
```
#include 

// fsync：刷新文件数据 + 全部元数据
int fsync(int fd);

// fdatasync：刷新文件数据 + 必要元数据（跳过访问时间等）
int fdatasync(int fd);
```

            

两者的区别在于元数据的范围：
            
            
            
            
            
            
            
            
            
            
            
            接口
            刷新数据
            文件大小变化
            修改时间（mtime）
            访问时间（atime）
            inode 修改时间（ctime）
            
            
            
            
            `fsync()`
            是
            是
            是
            是
            是
            
            
            `fdatasync()`
            是
            是
            否（如果大小未变）
            否
            否（如果大小未变）
            
            
            
            

`fdatasync()`
            的优势在于：当文件大小没有变化时（例如数据库在预分配的文件中覆盖写），它可以跳过
            inode 的元数据更新，减少一次日志（Journal）提交。在 ext4
            文件系统上，这意味着少一次日志屏障操作，延迟可以减少 30% 到
            50%。
            

本节讲的是 `fsync()`
            返回成功时的语义。它返回失败时反而更危险：脏页会被标记
            clean、数据被丢弃，重试 `fsync()`
            还会假报成功——详见 fsync
            失败的真相：当它返回错误，你的数据可能已经没了。
            

### 1.3
            sync_file_range：部分刷新控制

            

`sync_file_range()`
            提供了更细粒度的控制，允许只刷新文件的一个字节范围，且不保证元数据被刷新：
            
```
#include 

int sync_file_range(int fd, off64_t offset, off64_t nbytes,
                    unsigned int flags);

// flags 组合：
// SYNC_FILE_RANGE_WAIT_BEFORE  等待已提交的写回完成
// SYNC_FILE_RANGE_WRITE        发起写回请求
// SYNC_FILE_RANGE_WAIT_AFTER   等待写回完成
```

            

典型用法是数据库在写预写日志（Write-Ahead
            Log，WAL）时，先用 `sync_file_range()`
            异步发起写回，然后在 `commit` 时再调用
            `fdatasync()` 确保持久化。这种两阶段方式可以将
            fsync 的延迟隐藏在事务处理的过程中。
            

PostgreSQL 从 9.5 版本开始采用这一策略，在
            `XLogWrite` 函数中先调用
            `sync_file_range(SYNC_FILE_RANGE_WRITE)`
            发起异步写回，然后在 `XLogFlush` 中调用
            `fdatasync()` 完成持久化。
            

### 1.4 同步写模式：O_SYNC
            与 O_DSYNC

            

除了事后调用
            `fsync()`，还可以在打开文件时指定同步写标志：
            
```
// O_SYNC：每次 write() 都等价于 write() + fsync()
int fd = open("data.db", O_WRONLY | O_SYNC);

// O_DSYNC：每次 write() 都等价于 write() + fdatasync()
int fd = open("data.db", O_WRONLY | O_DSYNC);

// O_DIRECT | O_DSYNC：绕过页缓存 + 同步刷盘
int fd = open("data.db", O_WRONLY | O_DIRECT | O_DSYNC);
```

            

`O_SYNC` 和 `O_DSYNC` 的区别与
            `fsync()` 和 `fdatasync()`
            的区别完全对应。使用 `O_DSYNC` 而非
            `O_SYNC`
            可以在大多数场景下获得更好的性能，因为每次写入不需要更新完整的
            inode 元数据。
            

### 1.5 持久化保证汇总

            

把上面的接口放在一起比较：
            
            
            
            
            
            
            
            
            
            
            接口 / 标志
            数据持久化
            元数据持久化
            粒度
            典型延迟（NVMe）
            
            
            
            
            `write()`
            否
            否
            不适用
            ~1-5 us
            
            
            `sync_file_range(WRITE)`
            发起写回，不等待
            否
            字节范围
            ~1-5 us
            
            
            `fdatasync()`
            是
            部分
            整个文件
            ~20-100 us
            
            
            `fsync()`
            是
            是
            整个文件
            ~30-150 us
            
            
            `O_DSYNC`
            是（每次写）
            部分（每次写）
            每次 write
            ~20-100 us
            
            
            `O_SYNC`
            是（每次写）
            是（每次写）
            每次 write
            ~30-150 us
            
            
            `O_DIRECT + O_DSYNC`
            是（绕过缓存）
            部分
            每次 write
            ~10-50 us
            
            
            
            

注意：上表中的延迟数据是典型 NVMe SSD
            上的量级估算，具体数值取决于设备型号、队列深度、文件系统类型等因素。
            

### 1.6 一个关键的误区

            

许多程序员认为 `fsync()`
            返回成功就意味着数据一定安全了。但这个假设依赖于两个前提：
            
            
- 磁盘的写缓存（Write Cache）必须是断电安全的（Power-Loss
            Protected），或者已被禁用；
            
- `fsync()`
            的实现必须正确——而历史上，一些文件系统和内核版本的
            `fsync()` 实现存在缺陷。
            
            

第一个问题我们在下一节详细讨论。第二个问题，最著名的案例是
            PostgreSQL 在 2018 年发现的”fsync 错误处理问题”：当
            `fsync()` 因为底层 I/O 错误而失败时，Linux
            内核会清除页面的脏标志（dirty
            flag）。这意味着如果应用程序重试
            `fsync()`，第二次调用会返回成功——因为页面已经不再是脏的了——但数据实际上并没有被持久化。这个问题在
            Linux 4.13 及之前的内核中存在，在 5.x 系列中通过
            `errseq_t` 机制得到了修复。
            
            

## 二、磁盘写缓存（Write
            Cache）的风险

            

### 2.1 写缓存的工作原理

            

几乎所有现代存储设备都内置了写缓存（Write
            Cache），也称为写回缓存（Write-Back
            Cache）。其目的是吸收突发的写入请求，通过合并和重排序（Reordering）来提高写入性能。
            

对于 HDD（Hard Disk
            Drive，机械硬盘），写缓存通常是磁盘控制器上的一块
            DRAM，容量从 8 MB 到 256 MB 不等。写入请求先进入 DRAM
            缓存，控制器向主机报告”写入完成”，然后在后台按照磁头的优化路径将数据写入磁盘盘片。
            

问题在于：DRAM 是易失性存储器。如果在数据从 DRAM
            写入盘片之前发生断电，缓存中的数据就永久丢失了。
            

### 2.2 HDD 写缓存

            
```
# 查看 HDD 写缓存状态
sudo hdparm -W /dev/sda

/dev/sda:
 write-caching =  1 (on)

# 禁用写缓存
sudo hdparm -W 0 /dev/sda

# 启用写缓存
sudo hdparm -W 1 /dev/sda
```

            

大多数企业级 HDD
            出厂时写缓存默认开启。禁用写缓存后，随机写 IOPS
            会显著下降（因为每次写入都要等待磁头寻道和盘片旋转），但数据安全性得到保证。
            

实际工程中，数据库服务器上通常不需要禁用 HDD
            写缓存——前提是有 RAID 控制器（RAID
            Controller）带电池备份单元（Battery Backup Unit，BBU）。BBU
            在断电后可以维持 RAID
            控制器缓存中的数据数十小时，直到电源恢复后再将缓存内容刷入磁盘。
            

### 2.3 SSD 写缓存

            

固态硬盘（Solid State
            Drive，SSD）的写缓存情况更为复杂。SSD 控制器通常使用 DRAM
            作为写缓存，但企业级 SSD
            普遍配备了电容器（Capacitor）作为断电保护（Power-Loss
            Protection，PLP）。当检测到电源中断时，电容器提供的电能足以将
            DRAM 缓存中的数据刷入 NAND Flash。
            
```
SSD 写缓存架构：

消费级 SSD：
  主机 → SSD DRAM 缓存（无断电保护）→ NAND Flash
  风险：断电丢失缓存中的数据

企业级 SSD：
  主机 → SSD DRAM 缓存（电容断电保护）→ NAND Flash
  断电时：电容供电 → DRAM 内容刷入 NAND Flash
  风险：极低（电容失效、容量退化除外）
```

            

判断一块 SSD
            是否具备断电保护能力，不能只看产品定位。需要查看设备规格书中的
            PLP 特性，或者通过 NVMe 标识信息确认：
            
```
# 查看 NVMe SSD 的 Volatile Write Cache 特性
sudo nvme id-ctrl /dev/nvme0 | grep vwc

vwc     : 1

# vwc=1 表示存在易失性写缓存
# 但这不意味着没有断电保护——PLP 是额外的硬件特性
# 需要查看设备规格书确认
```

            

### 2.4 NVMe
            易失性写缓存（VWC）

            

NVMe（Non-Volatile Memory
            Express）规范定义了易失性写缓存（Volatile Write
            Cache，VWC）特性位。当 VWC
            被启用时，设备可以在写入请求的数据到达非易失性介质之前就向主机报告完成。
            
```
# 查看 VWC 状态
sudo nvme get-feature /dev/nvme0 -f 0x06

get-feature:0x06 (Volatile Write Cache), Current value:0x00000001

# 值为 1 表示 VWC 已启用
# 值为 0 表示 VWC 已禁用或设备不支持 VWC
```

            

当主机发送 Flush 命令时（对应用户空间的
            `fsync()`），NVMe
            设备会将易失性写缓存中的所有数据刷入非易失性介质，然后才报告
            Flush 完成。因此，只要 `fsync()` 路径正确地向
            NVMe 设备发送了 Flush 命令，即使 VWC
            开启，数据持久化语义仍然是正确的。
            

### 2.5 RAID
            控制器的电池备份写缓存

            

在企业级存储部署中，RAID
            控制器通常配备了电池备份写缓存（Battery-Backed Write
            Cache，BBWC）或闪存备份写缓存（Flash-Backed Write
            Cache，FBWC）。
            
```
BBWC 工作流程：
  1. 主机发送写入请求
  2. RAID 控制器将数据写入 DRAM 缓存
  3. 控制器向主机报告"写入完成"
  4. 控制器在后台将数据从缓存写入磁盘
  5. 如果断电：电池维持 DRAM 数据（通常 48-72 小时）
  6. 电源恢复后：控制器将缓存数据刷入磁盘

FBWC 工作流程：
  1-4 同上
  5. 如果断电：控制器利用超级电容将 DRAM 数据拷贝到板载 Flash
  6. 电源恢复后：从 Flash 恢复缓存数据，再写入磁盘
```

            

FBWC 比 BBWC
            更可靠，因为超级电容器（Supercapacitor）的寿命远长于锂电池，且不存在电池老化导致备份时间缩短的问题。
            

当 RAID
            控制器的电池电量不足或电池失效时，控制器会自动切换到写通模式（Write-Through
            Mode），此时每次写入都必须等待数据写入磁盘后才返回。这会导致写性能骤降。监控
            RAID 控制器的电池状态是运维的基本要求：
            
```
# 检查 MegaRAID 控制器电池状态
sudo megacli -AdpBbuCmd -GetBbuStatus -aALL

# 检查 HP Smart Array 控制器缓存状态
sudo ssacli ctrl slot=0 show status
```

            
            

## 三、写屏障（Write
            Barrier）与 I/O 顺序

            

### 3.1
            为什么写入顺序至关重要

            

日志式文件系统（Journaling
            Filesystem）的正确性依赖于严格的写入顺序：先将事务写入日志区域，然后写屏障确保日志落盘，最后才将数据写入实际位置。如果写入顺序被打乱——例如磁盘的写缓存重排了请求——崩溃恢复时可能出现日志和数据不一致的情况。
            

考虑 ext4 文件系统在日志模式（Journal
            Mode）下的典型写入序列：
            
```
正确的写入顺序：
  1. 写入日志描述符块（Journal Descriptor Block）
  2. 写入日志数据块（Journal Data Blocks）
  3. 屏障（Barrier）—— 确保 1、2 已落盘
  4. 写入日志提交块（Journal Commit Block）
  5. 屏障（Barrier）—— 确保 4 已落盘
  6. 将数据从日志区域拷贝到实际位置（Checkpoint）

如果步骤 3 的屏障缺失：
  - 提交块可能先于数据块到达磁盘
  - 此时断电，日志显示事务已提交
  - 但日志中的数据块是旧的或未写入的
  - 恢复时会把损坏的数据写入文件 → 静默损坏
```

            

### 3.2 写屏障的历史演变

            

Linux 内核中的写屏障（Write
            Barrier）经历了几次重大变化：
            

**2.6.x 时代**：内核使用
            `WRITE_BARRIER` 标志。一个带屏障的 I/O
            请求会触发三个步骤：刷新磁盘写缓存（Cache
            Flush）、写入数据、再次刷新缓存。这种方式简单但昂贵，因为每个屏障都会刷新整个磁盘缓存。
            

**3.x 时代**：内核移除了旧的
            `WRITE_BARRIER` 机制，替换为更精细的
            `REQ_PREFLUSH` 和 `REQ_FUA`
            标志。这一变更由 Christoph Hellwig 在 2011 年完成（内核
            2.6.37 起开始引入，3.x 中完全替代）。
            

### 3.3 REQ_PREFLUSH 与
            REQ_FUA

            

现代 Linux 内核使用两个标志来控制写入的持久化顺序：
            
```
// REQ_PREFLUSH：在执行本次写入之前，先刷新设备的写缓存
// 确保在本次写入之前提交的所有写入都已持久化

// REQ_FUA：Force Unit Access
// 要求本次写入的数据直接写入持久化介质，绕过设备的写缓存

// 组合使用示例（内核代码）：
bio->bi_opf = REQ_OP_WRITE | REQ_PREFLUSH | REQ_FUA;
```

            

两者的区别：
            
            
            
            
            
            
            
            
            
            标志
            作用
            影响范围
            代价
            
            
            
            
            `REQ_PREFLUSH`
            执行写入前刷新设备缓存
            所有已提交的写入
            高（刷整个缓存）
            
            
            `REQ_FUA`
            本次写入直接落盘
            仅本次写入
            低（一次写入）
            
            
            
            

### 3.4 文件系统如何使用
            Flush 和 FUA

            

**ext4** 在提交日志事务时的策略：
            
```
ext4 日志提交流程（jbd2）：
  1. 写入日志描述符块和数据块
  2. 发送 REQ_PREFLUSH（刷新设备缓存，确保数据块已落盘）
  3. 写入提交块，带 REQ_FUA 标志（提交块直接落盘）

这样：
  - 步骤 2 保证了数据块在提交块之前到达介质
  - 步骤 3 保证了提交块本身不会滞留在设备缓存中
  - 崩溃恢复时：如果提交块存在，数据块一定完整
```

            

**XFS** 的日志提交策略类似，但 XFS
            的日志（Log）结构与 ext4 的 jbd2 不同。XFS
            使用循环日志缓冲区，通过 `xlog_sync()`
            函数提交日志记录：
            
```
XFS 日志提交：
  1. 将日志记录写入 In-Core Log Buffer
  2. 当缓冲区满或 fsync 触发：写入磁盘上的日志区域
  3. 写入 Commit Record，带 REQ_PREFLUSH | REQ_FUA
  4. 通知等待的 fsync 调用者：事务已提交
```

            

### 3.5 对性能的影响

            

缓存刷新操作的代价因设备类型而异：
            
```
Flush 操作的典型延迟：

HDD（7200 RPM）：
  - Cache Flush：2-10 ms（取决于缓存中脏数据量）
  - 这意味着每秒最多 100-500 次 Flush 操作

SATA SSD：
  - Cache Flush：0.1-1 ms
  - FUA 通常不被 SATA 协议支持，退化为 Flush

NVMe SSD：
  - Cache Flush：10-100 us
  - FUA：几乎无额外开销（硬件原生支持）
```

            

NVMe 设备上 FUA 的高效性是其相对于 SATA
            设备的一个重要优势。SATA 协议虽然定义了 FUA 位，但大多数
            SATA 设备不支持它，内核会将 FUA
            请求退化为一个普通写入加一次完整的缓存刷新。
            

可以通过查看内核日志确认设备对 Flush 和 FUA
            的支持情况：
            
```
# 查看块设备的 Flush/FUA 支持
dmesg | grep -i "write cache\|flush\|fua"

# 典型输出示例：
# sd 0:0:0:0: [sda] Write cache: enabled, read cache: enabled, supports DPO and FUA
# nvme nvme0: 16/0/0 default/read/poll queues
```

            
            

## 四、fsync 的代价与优化

            

### 4.1 fsync 延迟的构成

            

一次 `fsync()`
            调用的延迟可以分解为以下几个部分：
            
```
fsync() 延迟分解：

1. 页缓存写回延迟
   └─ 将脏页提交到块设备层的队列
   └─ 如果脏页数量多，可能需要多次 I/O

2. 文件系统日志提交延迟
   └─ ext4：jbd2 日志提交（描述符 + 数据 + 提交块）
   └─ XFS：日志强制刷新（log force）
   └─ 包含 Flush + FUA 操作

3. 设备写入延迟
   └─ 数据和日志实际写入持久化介质的时间
   └─ HDD：受寻道和旋转延迟影响
   └─ SSD：受 NAND 编程延迟和垃圾回收影响

4. 设备缓存刷新延迟
   └─ Flush 命令导致设备刷新内部写缓存
```

            

### 4.2 ext4 上的 fsync 代价

            

ext4 的日志系统 jbd2 在处理 `fsync()`
            时，需要提交一个完整的日志事务。即使只修改了一个字节的文件数据，也至少需要写入：
            
            
- 一个日志描述符块（32 字节有效数据，占一个块）
            
- 修改的文件数据块
            
- 修改的 inode 块（如果文件大小改变了）
            
- 一个日志提交块
            
            

加上两次磁盘缓存刷新（提交前一次，提交后一次），一次
            `fsync()` 至少需要 2 次 Flush + 若干次写入。
            

更严重的问题是：jbd2
            使用的是全局日志。同一个文件系统上所有文件的
            `fsync()`
            共享同一个日志事务。这意味着如果两个不相关的文件同时调用
            `fsync()`，它们的日志操作会被序列化。
            
```
# 用 strace 测量 fsync 延迟
strace -e trace=fsync -T -p $(pidof postgres) 2>&1 | head -20

# -T 显示每个系统调用的耗时
# 输出示例：
# fsync(34)                               = 0 
# fsync(34)                               = 0 
# fsync(34)                               = 0   ← 异常值
```

            

### 4.3 XFS 上的 fsync 代价

            

XFS 的日志提交（Log Force）比 ext4 的 jbd2
            更高效，原因有两个：
            
            
- XFS 使用延迟分配（Delayed
            Allocation），减少了不必要的元数据日志操作；
            
- XFS 的日志是真正的循环缓冲区，日志写入的粒度更细。
            
            

但 XFS 的 `fsync()`
            有一个特殊行为：它不仅会强制刷新当前文件的日志记录，还会刷新所有在该日志记录之前的日志记录。这是因为日志的有序性要求——不能只持久化后面的记录而跳过前面的。
            

### 4.4 组提交（Group Commit）

            

组提交（Group Commit）是优化 `fsync()`
            性能最有效的技术之一。其核心思想是：多个并发的
            `fsync()`
            请求共享同一次日志提交和磁盘刷新操作。
            
```
无组提交（串行 fsync）：
  事务1 → fsync → Flush → 写日志 → Flush → 完成
  事务2 → fsync → Flush → 写日志 → Flush → 完成
  事务3 → fsync → Flush → 写日志 → Flush → 完成
  总计：6 次 Flush

有组提交：
  事务1 ─┐
  事务2 ─┤→ 合并 → Flush → 写日志(1+2+3) → Flush → 全部完成
  事务3 ─┘
  总计：2 次 Flush
```

            

### 4.5 数据库的 WAL 组提交

            

数据库的预写日志（Write-Ahead Log，WAL）是
            `fsync()` 最密集的使用场景。以 PostgreSQL
            为例，WAL 组提交的实现：
            
```
PostgreSQL WAL 组提交流程：

1. 事务 A 完成，需要持久化 WAL
2. 事务 A 获取 WAL 写入锁，成为 Leader
3. 在等待锁期间，事务 B、C 也完成了
4. Leader A 将 A、B、C 的 WAL 记录一起写入
5. Leader A 调用一次 fdatasync()
6. A、B、C 同时收到"持久化完成"的通知

配置参数：
  commit_delay = 10        # 微秒，等待更多事务加入
  commit_siblings = 5      # 至少有这么多活跃事务时才等待
```

            

MySQL/InnoDB 的组提交实现更为复杂，分为三个阶段：
            
```
MySQL InnoDB 组提交：

Flush 阶段：将 redo log 从 log buffer 写入操作系统缓存
Sync 阶段：调用 fsync() 将 redo log 持久化
Commit 阶段：写入 binlog 并提交事务

每个阶段都有一个队列和一个 Leader：
  - Leader 负责处理整个队列的操作
  - 其他事务等待 Leader 完成

参数：
  innodb_flush_log_at_trx_commit = 1  # 每次提交都 fsync
  sync_binlog = 1                      # 每次提交都同步 binlog
```

            

### 4.6 测量 fsync 延迟

            

在生产环境中监控 fsync
            延迟是容量规划和故障排查的基础：
            
```
# 方法一：使用 perf 追踪 fsync 延迟分布
sudo perf trace -e fsync -p $(pidof postgres) --duration 10000 2>&1 | \
  awk '/fsync/ {print $NF}' | sort -n | tail -20

# 方法二：使用 bpftrace 统计 fsync 延迟直方图
sudo bpftrace -e '
tracepoint:syscalls:sys_enter_fsync { @start[tid] = nsecs; }
tracepoint:syscalls:sys_exit_fsync /@ start[tid]/ {
    @usecs = hist((nsecs - @start[tid]) / 1000);
    delete(@start[tid]);
}
' -c 'sleep 10'

# 方法三：简单的 fsync 延迟基准测试
# 使用 fio 测量
fio --name=fsync-test \
    --filename=testfile \
    --size=1G \
    --bs=4k \
    --rw=randwrite \
    --fsync=1 \
    --ioengine=sync \
    --runtime=30 \
    --time_based

# 关注输出中的 fsync/fdatasync/sync_file_range 延迟：
#   fsync/fdatasync/sync_file_range:
#     sync (usec): min=18, max=4523, avg=67.21, stdev=42.15
```

            
            

## 五、电源故障场景分析

            

### 5.1 电源故障时发生了什么

            

断电是数据完整性面临的最严峻考验。从存储栈的各层来看，断电时会有以下影响：
            
```
电源故障时各层的状态：

应用层：
  └─ 进程被立即终止，无清理机会
  └─ 未调用 fsync 的数据：全部丢失

页缓存层：
  └─ 所有脏页（Dirty Pages）：全部丢失
  └─ 这包括已 write() 但未 fsync() 的数据

块设备层：
  └─ I/O 调度队列中的请求：全部丢失

磁盘写缓存：
  └─ 无断电保护：数据丢失
  └─ 有断电保护（PLP/BBU）：数据保留

持久化介质：
  └─ 已到达介质的数据：保留
  └─ 但正在写入的数据可能出现"撕裂写"
```

            

### 5.2 撕裂写（Torn Write）

            

撕裂写（Torn
            Write）是指一次写操作只有部分数据到达了持久化介质。这通常发生在写操作被断电中断时。
            

对于
            HDD，一个扇区（Sector）的写入是否原子取决于磁头在断电瞬间的位置。传统的
            512 字节扇区写入通常被认为是原子的，但 4K
            扇区的原子性取决于具体设备。
            

对于 SSD，NAND Flash
            的编程操作以页（Page）为单位，典型大小为 4KB 或 16KB。一次
            Flash 编程操作的原子性由 SSD
            控制器保证，但跨页的写入不是原子的。
            
```
撕裂写示例：

应用写入 8KB 数据（两个 4KB 页）：
  Page 1: [AAAA AAAA AAAA AAAA]  → 写入成功
  Page 2: [BBBB BBBB BBBB BBBB]  → 断电，写入中断

断电后磁盘上的状态：
  Page 1: [AAAA AAAA AAAA AAAA]  ← 新数据
  Page 2: [xxxx xxxx xxxx xxxx]  ← 旧数据或部分新数据

如果这 8KB 是一个数据库页（Database Page）：
  → 页的前半部分是新数据，后半部分是旧数据
  → 校验和（Checksum）不匹配 → 检测到损坏
  → 但如果没有校验和 → 静默损坏
```

            

数据库通过以下策略防止撕裂写：
            
            
- **双写缓冲（Doublewrite Buffer）**：InnoDB
            在写入数据页之前，先将页的副本写入一个连续的区域。恢复时如果检测到撕裂写，从双写缓冲区恢复完整的页。
            
- **全页写入（Full Page Write）**：PostgreSQL
            在 WAL 检查点后第一次修改某个页时，将整个页的内容写入
            WAL。恢复时用完整的页覆盖可能被撕裂的页。
            
            

### 5.3 元数据不一致

            

即使没有撕裂写，写入重排序也可能导致元数据不一致。最典型的场景是：
            
```
场景：向文件追加数据

正确顺序：
  1. 分配新数据块
  2. 写入数据
  3. 更新 inode 的文件大小和块指针
  4. fsync

如果步骤 3 先于步骤 2 到达磁盘：
  - 断电后：inode 指向一个已分配但未写入数据的块
  - 读取该文件会得到旧数据或零
  - 文件系统认为文件是完整的（元数据一致）
  - 但数据是错误的 → 静默损坏
```

            

ext4 在 `data=ordered`
            模式下（默认模式）通过强制数据先于元数据写入来防止这种情况。但
            `data=writeback` 模式下不提供这种保证——所以
            `data=writeback`
            虽然性能更高，但在断电场景下有数据损坏的风险。
            

### 5.4
            文件系统恢复：日志回放

            

日志式文件系统通过日志回放（Journal
            Replay）从崩溃中恢复：
            
```
ext4 日志恢复流程：

1. 挂载时检测到 Dirty Flag（上次未正常卸载）
2. 扫描日志区域，查找已提交的事务
   └─ 事务有完整的提交块 → 有效事务
   └─ 事务没有提交块 → 不完整，丢弃
3. 回放有效事务：
   └─ 将日志中的数据块拷贝到实际位置
4. 清除日志
5. 正常挂载

恢复时间取决于日志大小和未完成的事务数量。
对于默认 128 MB 的日志，恢复通常在几秒内完成。
```

            

### 5.5 数据库恢复：WAL 回放

            

数据库的恢复机制类似于文件系统的日志恢复，但在应用层面实现：
            
```
PostgreSQL 崩溃恢复：

1. 找到最近的检查点（Checkpoint）位置
2. 从该位置开始顺序读取 WAL 记录
3. 对每条 WAL 记录：
   a. 检查对应的数据页是否需要重做
   b. 如果页的 LSN 
```
# 方法一：使用 dm-flakey 模拟 I/O 故障
# 创建一个会随机丢失写入的设备映射

# 设置 dm-flakey：正常运行 30 秒，然后丢弃所有写入 5 秒
echo "0 $(blockdev --getsz /dev/sdb) flakey /dev/sdb 0 30 5" | \
  sudo dmsetup create flakey-test

# 方法二：使用 dm-flakey 只丢弃写入（保持读取正常）
echo "0 $(blockdev --getsz /dev/sdb) flakey /dev/sdb 0 30 5 1 drop_writes" | \
  sudo dmsetup create flakey-test

# 方法三：使用 libeatmydata 完全禁用 fsync
# （仅用于测试，了解应用在无 fsync 保护下的行为）
LD_PRELOAD=libeatmydata.so ./my_application

# 清理 dm-flakey 设备
sudo dmsetup remove flakey-test
```

            

更系统化的电源故障测试方法是使用专用的测试框架，例如
            Jepsen 项目使用的方法：通过 IPMI 或 PDU（Power Distribution
            Unit，电力分配单元）控制物理断电，然后检查数据库在恢复后数据是否一致。
            

### 5.7
            真实世界的电源故障研究

            

2013 年，来自威斯康星大学麦迪逊分校（University of
            Wisconsin-Madison）的研究团队发表了一项系统性的文件系统崩溃一致性研究。他们开发了一个名为
            BOB（Block Order Breaker）的工具，系统地测试了
            ext2、ext3、ext4、Btrfs、XFS 和 ReiserFS
            在各种崩溃场景下的行为。
            

主要发现包括：
            
            
- ext4 在 `data=ordered`
            模式下表现最稳定，但在特定的日志满（Journal
            Full）场景下仍有问题；
            
- Btrfs
            由于采用写时复制（Copy-on-Write，COW）策略，在大多数场景下表现良好，但在快照相关操作中发现了问题；
            
- 所有被测试的文件系统都至少存在一个可能导致数据不一致的崩溃场景。
            
            

这一研究表明：完全依赖文件系统来保证数据完整性是不够的。应用层（特别是数据库）需要自己的持久化策略和一致性验证机制。
            
            

## 六、静默数据损坏（Silent
            Data Corruption）

            

### 6.1 什么是静默数据损坏

            

静默数据损坏（Silent Data Corruption，也称
            SDC）是指存储介质上的数据在没有任何错误报告的情况下发生了改变。与磁盘故障（I/O
            错误）不同，SDC
            不会触发任何告警——操作系统和文件系统认为数据是正常的，但读出的内容已经不是当初写入的了。
            

这类损坏也被称为”比特腐烂”（Bit
            Rot），因为数据仿佛在”腐烂”——随时间推移悄无声息地改变。
            

### 6.2 损坏的来源

            

静默数据损坏的来源多种多样：
            
```
硬件层面：
  1. 宇宙射线（Cosmic Rays）引起的位翻转（Bit Flip）
     └─ DRAM 中的单粒子翻转事件（Single-Event Upset，SEU）
     └─ ECC 内存可以纠正单比特错误，检测双比特错误
     └─ 但如果数据在非 ECC 的路径上被损坏，ECC 无法保护

  2. 磁盘固件缺陷（Firmware Bug）
     └─ 固件在读取或写入时引入错误
     └─ 某些固件版本的特定操作序列触发数据损坏
     └─ 这是真实存在的问题，不是理论风险

  3. 线缆和连接器问题
     └─ SATA/SAS 线缆信号退化
     └─ 连接器接触不良导致传输错误
     └─ SATA 的 CRC 校验可以检测传输错误
     └─ 但如果 CRC 本身被绕过（某些控制器缺陷），错误会传播

  4. 控制器缺陷
     └─ RAID 控制器在奇偶校验（Parity）计算中引入错误
     └─ HBA（Host Bus Adapter）的 DMA 传输错误
     └─ SSD 控制器的 ECC 解码错误

软件层面：
  5. 内核错误
     └─ 页缓存管理缺陷导致错误的页被写入磁盘
     └─ 块设备层的请求合并错误

  6. 文件系统缺陷
     └─ 块分配错误导致两个文件指向同一个数据块
     └─ 日志回放逻辑错误
```

            

### 6.3 研究数据：口径与边界

            

静默损坏的**发生率**高度依赖测量方法：是在读路径上做主动
            checksum、依赖 FS 内置校验，还是等应用发现逻辑错误。以下只列
            FAST / SIGMETRICS 等 A
            级论文中可核对的表述，**不合成「通用年化 SDC
            率」**。
            

**CERN 文件样本（Bairavasundaram et al., FAST
            2008）**：
            

论文报告 CERN 对约 **300
            万**文件的校验扫描中，约 **0.33%**
            出现校验和不匹配。样本为特定磁带/磁盘混合栈与校验策略，**不能**直接外推为「任意集群每盘每年
            N 次 SDC」。
            

**NetApp 磁盘级统计（同上 FAST
            2008）**：
            

在约 **150 万块**磁盘、**41
            个月**观测、**主动校验和比对**前提下，论文给出近线
            SATA 与光纤通道盘上的不匹配频率（例如近线 SATA 约
            **每万盘每年 3000 次**量级——见原文 Table /
            正文，随接口与批次变化）。这是**检测到的**
            mismatch，含 misdirected write、lost write
            等类型，不等于「无校验条件下 OS 无感知的 bit rot 率」。
            

**Google DRAM（Schroeder, Pinheiro & Weber,
            SIGMETRICS 2009）**：
            

约 **8%** DIMM
            在年内至少一次**可纠正**内存错误；与磁盘 SDC
            无直接换算关系。
            

**不宜引用的说法**：把磁盘 AFR（Schroeder
            & Gibson, FAST 2007）百分比当作 SDC
            率、或混用不同论文的「每 PB
            读取一次错误」与「每盘每年」——口径不同，见 43 checksum §1.2 与
            §〇 开放问题。
            

共同结论仍是：**大规模存储必须把 SDC
            当作常态风险**，而非极端边缘事件；检测手段见下一节与
            [43 checksum](../43-checksum/checksum.html)。
            

### 6.4 为什么 RAID
            不能防止比特腐烂

            

传统 RAID
            通过冗余（镜像或奇偶校验）来防止磁盘故障导致的数据丢失，但它对静默数据损坏的防护能力非常有限：
            
```
RAID 对静默损坏的局限：

RAID 1（镜像）：
  - 两块盘的数据不一致时：RAID 无法判断哪个是正确的
  - RAID 控制器通常选择主盘的数据 → 可能返回损坏的数据
  - 除非有校验和来验证哪个副本是正确的

RAID 5/6（奇偶校验）：
  - 正常读取只读一块盘，不验证奇偶校验
  - 只有在磁盘故障需要重建时才使用奇偶校验
  - 如果一块盘有静默损坏，正常读取时不会被发现
  - 如果另一块盘故障需要重建，损坏的数据会被用来计算 → 重建出错误的数据

RAID 扫描（Scrubbing）：
  - 后台读取所有数据并验证奇偶校验一致性
  - 可以发现奇偶校验不一致的情况
  - 但同样无法判断是数据盘错误还是奇偶校验盘错误
  - 通常假设奇偶校验正确 → 可能"修复"出错误的数据
```

            

### 6.5 SMART 的局限

            

自监测分析和报告技术（Self-Monitoring, Analysis and
            Reporting
            Technology，SMART）可以报告磁盘的健康状态，包括重分配扇区数（Reallocated
            Sector Count）、待重映射扇区数（Current Pending Sector
            Count）等。但 SMART 无法检测静默数据损坏——因为 SMART
            关注的是磁盘的物理健康状况（磁头定位、电机转速、温度等），而不是数据内容的正确性。
            

一个 SMART
            报告完全健康的磁盘，仍然可能存在静默数据损坏。SMART
            能做的最多是预警磁盘即将故障，给你时间做数据迁移——但对已经发生的静默损坏无能为力。
            
            

## 七、校验和（Checksum）策略

            

### 7.1 为什么需要校验和

            

前面的分析表明，从 DRAM
            到磁盘的每一环都可能引入错误，而操作系统和文件系统的默认行为不会检测这些错误。校验和（Checksum）是检测数据损坏的最基本手段：在写入时计算数据的校验和并存储，在读取时重新计算并比较。如果不匹配，说明数据已被损坏。
            

算法对比、性能表与 Fletcher / xxHash / SHA 选型见
            **[43
            校验和与数据完整性](../43-checksum/checksum.html)**；本节只保留与持久化路径相关的
            FS / DB 落点。
            

### 7.2 常用校验和算法

            
```
算法对比：

CRC32C（Castagnoli CRC-32）：
  - 输出：32 位
  - 特点：多项式优化，对突发错误检测能力强
  - 性能：~20 GB/s（使用 SSE 4.2 硬件指令）
  - 使用者：Btrfs、ext4 元数据、iSCSI、PostgreSQL

xxHash（xxHash64 / XXH3）：
  - 输出：64 位 / 128 位
  - 特点：极高的计算速度，良好的分布性
  - 性能：~30-60 GB/s（取决于实现和数据长度）
  - 使用者：Linux 内核（某些子系统）、LZ4 帧格式

SHA-256：
  - 输出：256 位
  - 特点：密码学安全，碰撞率极低
  - 性能：~0.5-1 GB/s（软件实现）/ ~5 GB/s（SHA-NI 硬件加速）
  - 使用者：ZFS（可选）、Git、内容寻址存储

Fletcher 校验和：
  - 输出：可变（常用 Fletcher-4）
  - 特点：计算简单，中等错误检测能力
  - 性能：~10-20 GB/s
  - 使用者：ZFS（默认校验和算法）
```

            

### 7.3 文件系统级校验和

            

**Btrfs**
            对每个数据块和元数据块都计算校验和，并将校验和存储在独立的校验和树（Checksum
            Tree）中：
            
```
Btrfs 校验和架构：

数据块：
  [数据块 0] → CRC32C → 存入校验和树
  [数据块 1] → CRC32C → 存入校验和树
  ...

元数据块：
  [B-tree 节点] → CRC32C → 存储在节点头部

读取时：
  1. 从磁盘读取数据块
  2. 从校验和树读取期望的校验和
  3. 对数据块计算实际校验和
  4. 比较：匹配则返回数据，不匹配则报错
  5. 如果有冗余副本（RAID 1/10），尝试从副本读取

支持的算法（Linux 5.5+）：
  - CRC32C（默认）
  - xxHash64
  - SHA-256
  - BLAKE2b-256
```

            

**ZFS** 的校验和机制更为全面。ZFS 使用
            Merkle 树（Merkle
            Tree）结构：每个数据块的校验和存储在其父元数据块中，父元数据块的校验和又存储在更上层的元数据中，一直到超级块（Uberblock）。完整
            blkptr 布局、算法表与 scrub 见 **17 ZFS
            §3** 与 **43 checksum
            §8.1**。
            

### 7.4 数据库级校验和

            

**PostgreSQL** 从 9.3
            版本开始支持页校验和（Page Checksum）。启用后，每个 8KB
            数据页的头部会存储一个 16
            位的校验和。每次读取数据页时，后台进程会验证校验和：
            
```
# PostgreSQL 初始化集群时启用页校验和
initdb --data-checksums -D /var/lib/postgresql/data

# 对已有集群启用（需要停机）
pg_checksums --enable -D /var/lib/postgresql/data

# 检查校验和是否已启用
pg_controldata /var/lib/postgresql/data | grep checksum

# 输出示例：
# Data page checksum version:           1
```

            

**InnoDB**（MySQL 的默认存储引擎）对每个
            16KB 数据页计算校验和，默认使用 CRC32 算法：
            
```
-- 查看 InnoDB 校验和算法
SHOW VARIABLES LIKE 'innodb_checksum_algorithm';

-- 可选值：
-- crc32（默认，推荐）
-- strict_crc32（仅接受 crc32 校验和）
-- innodb（旧版算法，兼容 MySQL 5.5 之前版本）
-- none（禁用校验和——危险！）
```

            

### 7.5 选择合适的校验和算法

            
```
决策指南：

场景                     推荐算法        原因
─────────────────────────────────────────────────
文件系统数据块            CRC32C         硬件加速，检测能力强
数据库页                  CRC32C         同上
网络传输校验              CRC32C         iSCSI/NVMe-oF 标准
内容寻址存储              SHA-256        抗碰撞要求高
去重系统                  SHA-256/BLAKE2 需要密码学安全
快速数据校验（非安全场景） xxHash         极高性能
ZFS 默认                  Fletcher-4     历史原因，平衡性能和检测能力
```

            

### 7.6 校验和的性能开销

            

校验和计算的 CPU 开销通常远小于 I/O
            开销，但在高吞吐场景下仍然值得关注：
            
```
校验和开销估算（单核，现代 x86 CPU）：

算法       吞吐量          每 4KB 块耗时    占 NVMe 读取延迟比例
─────────────────────────────────────────────────────────────
CRC32C     ~20 GB/s       ~0.2 us          ~2%
xxHash64   ~30 GB/s       ~0.13 us         ~1.3%
SHA-256    ~1 GB/s        ~4 us            ~40%（过高）
BLAKE2b    ~3 GB/s        ~1.3 us          ~13%

结论：
  - CRC32C 和 xxHash 的开销可忽略
  - SHA-256 仅在需要密码学安全时使用
  - 在 NVMe 高 IOPS 场景下，校验和计算可能成为 CPU 瓶颈
  - 可以使用 SIMD 或多线程来分摊校验和计算
```

            
            

## 八、端到端数据保护

            

### 8.1 端到端完整性的含义

            

端到端数据保护（End-to-End Data
            Protection）的目标是：从数据在应用层生成的那一刻起，到数据被持久化到存储介质上，再到数据被读回应用层——在整个路径上的任何一个环节发生的数据损坏都能被检测到。
            
```
数据保护的覆盖范围：

传统方案（仅磁盘 ECC）：
  应用 → 内核 → [HBA] → [线缆] → 磁盘控制器 → [ECC] → 介质
                  ↑        ↑          ↑
               无保护    无保护     无保护

端到端方案（应用层校验和 + DIF）：
  应用 → [校验和] → 内核 → [DIF] → HBA → [DIF] → 磁盘 → 介质
    ↑                        ↑               ↑          ↑
  应用校验               块层验证        传输验证     介质 ECC

完整方案（ZFS/Btrfs + 应用校验和）：
  应用 → [应用校验和] → 文件系统 → [块校验和] → 设备 → 介质
    ↑                       ↑                      ↑
  应用层验证             文件系统验证            设备层验证
```

            

### 8.2 T10-PI（DIF/DIX）

            

T10 保护信息（T10 Protection Information，T10-PI）是 SCSI
            标准定义的端到端数据保护机制。它为每个逻辑扇区附加一个 8
            字节的保护信息元组（Protection Information Tuple）：
            
```
T10-PI 保护信息格式（每扇区 8 字节）：

+------------------+------------------+------------------+
|  Guard Tag (2B)  |  App Tag (2B)    |  Ref Tag (4B)    |
+------------------+------------------+------------------+

Guard Tag（保护标签）：
  - 数据的 CRC16 校验和
  - 用于检测数据传输过程中的比特翻转

Application Tag（应用标签）：
  - 由应用程序定义的标签
  - 用于逻辑分区或标记

Reference Tag（引用标签）：
  - 通常设置为逻辑块地址（LBA）
  - 用于检测"写入错误位置"（Misdirected Write）
```

            

T10-PI 定义了三种保护类型：
            
```
Type 1：Guard + App + Ref（Ref = LBA）
  - 最严格，检测比特翻转和写入错误位置
  - Reference Tag 与逻辑块地址绑定

Type 2：Guard + App + Ref（Ref = 初始值 + 偏移）
  - 类似 Type 1，但 Ref Tag 使用初始值加偏移量
  - 支持非连续 LBA 的保护

Type 3：Guard + App（Ref 不使用）
  - 只检测比特翻转，不检测写入错误位置
  - 灵活性最高
```

            

### 8.3 DIF 与 DIX

            

数据完整性字段（Data Integrity
            Field，DIF）和数据完整性扩展（Data Integrity
            Extension，DIX）是 T10-PI 在 Linux 上的实现：
            
```
DIF（Data Integrity Field）：
  - 保护信息由 HBA 或磁盘控制器生成和验证
  - 保护范围：HBA → 线缆 → 磁盘控制器 → 介质
  - 不保护：主机内存 → HBA 的路径

DIX（Data Integrity Extension）：
  - 保护信息由操作系统（块层）生成
  - 保护范围：操作系统 → HBA → 线缆 → 磁盘控制器 → 介质
  - 覆盖了从操作系统到介质的完整路径
```

            

### 8.4 在 Linux 上启用
            DIF/DIX

            
```
# 检查磁盘是否支持 DIF
sudo sg_readcap -l /dev/sda

# 查看保护信息类型
# 输出中 "Protection information" 部分：
# prot_en=1 表示支持
# p_type=1 表示 Type 1

# 格式化磁盘以启用 DIF（危险操作！会擦除所有数据）
# Type 1 保护，保护信息在最后 8 字节
sudo sg_format --format --fmtpinfo=1 /dev/sda

# 检查块设备的完整性元数据
cat /sys/block/sda/integrity/format
# 输出示例：T10-DIF-TYPE1-CRC

# 查看完整性配置
cat /sys/block/sda/integrity/read_verify
cat /sys/block/sda/integrity/write_generate
# 1 = 启用，0 = 禁用
```

            

在实际部署中，DIF/DIX 的使用率并不高。原因包括：
            
            
- 需要 HBA 和磁盘同时支持，硬件兼容性是障碍；
            
- 每个扇区额外 8 字节的元数据会降低有效容量；
            
- 软件栈的支持不够成熟，某些文件系统和数据库不能正确处理保护信息。
            
            

我认为 DIF/DIX
            更适合对数据完整性有极端要求的场景（金融系统、医疗影像存储），对于大多数互联网应用，文件系统级和应用级的校验和已经足够。
            

### 8.5 ZFS 与 Btrfs
            的数据完整性对比

            
```
特性                    ZFS                         Btrfs
────────────────────────────────────────────────────────────────
校验和算法              Fletcher-4（默认）           CRC32C（默认）
                       SHA-256（可选）               xxHash/SHA-256/BLAKE2b
校验和粒度              每个数据块                   每个数据块
校验和存储              父元数据块中（Merkle 树）     独立的校验和树
写时复制                是                           是
自修复（Self-Healing）   是（RAID-Z/Mirror）          是（RAID 1/10）
元数据冗余              自动 3 份副本                 可配置
快照                    是                           是
发送/接收               是                           是
RAID 实现               RAID-Z1/Z2/Z3               内核 RAID（有限）
内存需求                高（ARC 缓存）               低
稳定性                  成熟                         仍在改进
许可证                  CDDL（不含在内核主线）        GPL（内核主线）
```

            

两者在数据完整性方面的核心区别在于校验和的存储位置。ZFS
            的 Merkle
            树结构意味着：如果一个数据块的校验和被损坏，其父块的校验和也会不匹配，从而可以检测到校验和本身的损坏。而
            Btrfs
            的独立校验和树虽然也有校验和保护，但校验和树本身是一个独立的
            B
            树结构，理论上存在一种（概率极低的）场景：数据块和校验和同时被以一致的方式损坏。
            

### 8.6 RAID 扫描与验证

            

对于使用硬件 RAID 或 Linux 软件 RAID（md）的系统，定期的
            RAID 扫描（Scrubbing）是检测静默数据损坏的重要手段：
            
```
# Linux 软件 RAID 手动触发扫描
echo check > /sys/block/md0/md/sync_action

# 查看扫描进度
cat /proc/mdstat

# 查看发现的不一致块数
cat /sys/block/md0/md/mismatch_cnt

# 自动定期扫描（大多数发行版默认每周日执行）
cat /etc/cron.d/mdadm

# 对于 ZFS
sudo zpool scrub tank

# 查看 ZFS scrub 状态
sudo zpool status tank
#   scan: scrub in progress since Mon Aug 21 02:00:01 2025
#     256G scanned at 1.02G/s, 128G issued at 512M/s
#     0 repaired, 50.00% done

# 对于 Btrfs
sudo btrfs scrub start /mnt/data

# 查看 Btrfs scrub 状态
sudo btrfs scrub status /mnt/data
#   Scrub started:    Mon Aug 21 02:00:01 2025
#   Status:           running
#   Duration:         0:05:23
#   Total to scrub:   256.00GiB
#   Bytes scrubbed:   128.00GiB
#   Errors:           0
```

            
            

## 九、数据完整性验证工具

            

### 9.1 表面扫描：badblocks

            

`badblocks`
            是最基础的磁盘表面扫描工具，用于检测不可读的扇区（Bad
            Sector）：
            
```
# 只读模式扫描（安全，不会破坏数据）
sudo badblocks -sv /dev/sdb

# 非破坏性读写测试（先读取原内容，写入测试模式，再恢复原内容）
# 警告：如果中途断电，数据会丢失
sudo badblocks -nsv /dev/sdb

# 破坏性写入测试（会擦除所有数据！）
sudo badblocks -wsv /dev/sdb

# 参数说明：
# -s 显示进度
# -v 详细输出
# -b 4096 指定块大小（默认 1024）
# -c 1024 每次测试的块数
```

            

`badblocks`
            能检测物理层面的不可读扇区，但不能检测静默数据损坏——因为它只测试”能不能读写”，不测试”读出的内容是否正确”。
            

### 9.2
            磁盘健康监控：smartctl

            
```
# 查看磁盘整体健康状态
sudo smartctl -H /dev/sda

# 输出关键 SMART 属性
sudo smartctl -A /dev/sda

# 关注以下属性：
#   5  Reallocated_Sector_Ct    重分配扇区数（坏扇区被替换的数量）
# 187  Reported_Uncorrect       不可纠正错误数
# 188  Command_Timeout          命令超时次数
# 197  Current_Pending_Sector   待重映射扇区数
# 198  Offline_Uncorrectable    离线不可纠正扇区数

# NVMe 磁盘的 SMART 信息
sudo smartctl -a /dev/nvme0

# 关注：
# Critical Warning: 0x00
# Media and Data Integrity Errors: 0
# Error Information Log Entries: 0
# Warning Comp. Temperature: 70 Celsius
# Critical Comp. Temperature: 80 Celsius

# 启动后台自检
sudo smartctl -t short /dev/sda    # 短自检，约 2 分钟
sudo smartctl -t long /dev/sda     # 长自检，可能数小时

# 查看自检结果
sudo smartctl -l selftest /dev/sda
```

            

### 9.3 文件系统完整性检查

            
```
# ext4 文件系统检查（需要先卸载）
sudo umount /dev/sda1
sudo e2fsck -f /dev/sda1

# XFS 在线扫描（不需要卸载，Linux 4.15+）
sudo xfs_scrub /mnt/data

# XFS 离线修复
sudo xfs_repair /dev/sda1

# Btrfs 在线扫描
sudo btrfs scrub start /mnt/data
sudo btrfs scrub status /mnt/data

# Btrfs 文件系统检查（只读模式）
sudo btrfs check /dev/sda1

# ZFS 扫描
sudo zpool scrub tank
sudo zpool status tank
```

            

### 9.4 数据库完整性验证

            
```
# PostgreSQL 页校验和验证
# 方法一：在线检查（需要 pg_stat_statements 或相关扩展）
# 后端会在读取页时自动验证校验和
# 损坏的页会记录在日志中：
# WARNING: page verification failed, calculated checksum 12345
#          but expected 54321

# 方法二：离线检查（需要停机）
pg_checksums --check -D /var/lib/postgresql/data

# 输出示例：
# Checksum scan completed
# Data checksum version: 1
# Files scanned:  12345
# Blocks scanned: 678901
# Bad checksums:  0
```

            
```
-- MySQL/InnoDB 页校验和验证
-- innochecksum 工具（离线）
-- 对单个表空间文件检查校验和：
-- $ innochecksum /var/lib/mysql/mydb/mytable.ibd

-- 在线监控：查看校验和失败的页数
SHOW STATUS LIKE 'Innodb_pages_read';

-- 如果怀疑有损坏，尝试全表扫描
-- 这会触发 InnoDB 读取并验证所有数据页
SELECT COUNT(*) FROM mydb.mytable;

-- 如果有损坏的页，错误日志中会出现：
-- InnoDB: Database page corruption on disk or a failed
-- file read of page [page_id]
```

            

### 9.5 综合完整性检查脚本

            

以下脚本展示了一个综合性的数据完整性检查流程的核心逻辑：
            
```
#!/bin/bash
# 数据完整性检查脚本
# 用途：定期检查存储系统的数据完整性
# 建议通过 cron 每周执行一次

set -euo pipefail

LOG_FILE="/var/log/integrity-check.log"
ALERT_EMAIL="admin@example.com"
ERRORS=0

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

check_smart() {
    local device="$1"
    log "检查 SMART 状态: $device"

    # 检查整体健康状态
    if ! sudo smartctl -H "$device" | grep -q "PASSED"; then
        log "警告: $device SMART 健康检查未通过"
        ERRORS=$((ERRORS + 1))
    fi

    # 检查关键属性
    local reallocated
    reallocated=$(sudo smartctl -A "$device" | \
        awk '/Reallocated_Sector_Ct/ {print $10}')
    if [ -n "$reallocated" ] && [ "$reallocated" -gt 0 ]; then
        log "警告: $device 有 $reallocated 个重分配扇区"
        ERRORS=$((ERRORS + 1))
    fi
}

check_raid() {
    log "检查 RAID 状态"

    # 检查 Linux 软件 RAID
    if [ -f /proc/mdstat ]; then
        # 触发 RAID 扫描
        for md in /sys/block/md*/md/sync_action; do
            [ -f "$md" ] && echo check > "$md"
        done

        # 等待扫描完成
        sleep 5
        while grep -q "check" /sys/block/md*/md/sync_action 2>/dev/null; do
            sleep 60
        done

        # 检查不一致块数
        for cnt in /sys/block/md*/md/mismatch_cnt; do
            if [ -f "$cnt" ]; then
                local mismatches
                mismatches=$(cat "$cnt")
                if [ "$mismatches" -gt 0 ]; then
                    local md_name
                    md_name=$(echo "$cnt" | grep -oP 'md\d+')
                    log "警告: $md_name 发现 $mismatches 个不一致块"
                    ERRORS=$((ERRORS + 1))
                fi
            fi
        done
    fi
}

check_filesystem() {
    local mountpoint="$1"
    local fstype
    fstype=$(df -T "$mountpoint" | awk 'NR==2 {print $2}')

    log "检查文件系统: $mountpoint ($fstype)"

    case "$fstype" in
        btrfs)
            sudo btrfs scrub start -B "$mountpoint" 2>> "$LOG_FILE"
            local scrub_errors
            scrub_errors=$(sudo btrfs scrub status "$mountpoint" | \
                grep -oP 'Error summary:\s+\K.*')
            if [ "$scrub_errors" != "no errors found" ]; then
                log "警告: Btrfs scrub 发现错误: $scrub_errors"
                ERRORS=$((ERRORS + 1))
            fi
            ;;
        xfs)
            if command -v xfs_scrub &> /dev/null; then
                sudo xfs_scrub "$mountpoint" 2>> "$LOG_FILE" || {
                    log "警告: xfs_scrub 发现问题"
                    ERRORS=$((ERRORS + 1))
                }
            fi
            ;;
        *)
            log "跳过: $fstype 不支持在线完整性检查"
            ;;
    esac
}

# 主流程
log "=== 开始数据完整性检查 ==="

# 检查所有磁盘的 SMART 状态
for dev in /dev/sd? /dev/nvme?n1; do
    [ -b "$dev" ] && check_smart "$dev"
done

# 检查 RAID
check_raid

# 检查文件系统
check_filesystem "/mnt/data"

# 汇总
log "=== 检查完成，发现 $ERRORS 个问题 ==="

if [ "$ERRORS" -gt 0 ]; then
    log "发送告警邮件到 $ALERT_EMAIL"
    mail -s "数据完整性告警: 发现 $ERRORS 个问题" \
        "$ALERT_EMAIL" 
            
            

## 十、数据完整性最佳实践

            

### 10.1 纵深防御（Defense in
            Depth）

            

数据完整性的核心策略是纵深防御：在存储栈的多个层次都部署校验和和验证机制，确保任何单一层次的故障都不会导致静默数据损坏传播到最终用户。
            
```
推荐的纵深防御层次：

第 1 层：应用层
  └─ 关键数据的应用级校验和
  └─ 例如：数据库页校验和、对象存储的 Content-MD5

第 2 层：文件系统层
  └─ 启用文件系统的数据校验和
  └─ 推荐 Btrfs 或 ZFS
  └─ 如果使用 ext4/XFS，至少启用元数据校验和

第 3 层：块设备层
  └─ RAID 定期扫描
  └─ DIF/DIX（如果硬件支持）

第 4 层：存储设备层
  └─ SMART 监控
  └─ 设备固件保持更新

第 5 层：备份层
  └─ 备份数据的校验和验证
  └─ 定期恢复测试
```

            

### 10.2 文件系统校验和配置

            
```
# Btrfs：创建带校验和的文件系统
sudo mkfs.btrfs -d raid1 -m raid1 /dev/sda /dev/sdb

# Btrfs：使用 xxHash 算法（性能更高）
sudo mkfs.btrfs --csum xxhash /dev/sda

# ZFS：创建带校验和的存储池
sudo zpool create tank mirror /dev/sda /dev/sdb

# ZFS：设置校验和算法
sudo zfs set checksum=sha256 tank/important-data

# ext4：启用元数据校验和（创建时指定）
sudo mkfs.ext4 -O metadata_csum /dev/sda1

# XFS：启用元数据校验和（XFS v5 格式，默认启用）
sudo mkfs.xfs -m crc=1 /dev/sda1
```

            

### 10.3 数据库校验和配置

            
```
# PostgreSQL：启用页校验和
# 新集群
initdb --data-checksums -D /var/lib/postgresql/data

# 已有集群（PostgreSQL 12+，需要停机）
pg_checksums --enable -D /var/lib/postgresql/data

# 确认启用状态
psql -c "SHOW data_checksums;"
#  data_checksums
# ----------------
#  on
```

            
```
-- MySQL/InnoDB：校验和默认启用
-- 确认配置
SHOW VARIABLES LIKE 'innodb_checksum_algorithm';
-- 确保值为 crc32（默认值，性能最优）

-- 如果使用旧版本升级，确认没有使用 none
-- SET GLOBAL innodb_checksum_algorithm = 'crc32';
```

            

### 10.4 UPS 与写缓存策略

            

不间断电源（Uninterruptible Power
            Supply，UPS）是数据完整性的基础设施保障：
            
```
UPS + 写缓存的配置策略：

有 UPS + 企业级 SSD（PLP）：
  └─ 可以安全启用磁盘写缓存
  └─ fsync 语义得到完整保证
  └─ 性能最优

有 UPS + 消费级 SSD（无 PLP）：
  └─ 建议禁用磁盘写缓存
  └─ 或者接受 UPS 电池耗尽时的数据丢失风险
  └─ UPS 应配置为在电池电量低于 30% 时触发安全关机

无 UPS + 企业级 SSD（PLP）：
  └─ PLP 保护写缓存中的数据
  └─ 但操作系统页缓存中的脏页会丢失
  └─ 需要依赖 fsync 和 WAL 保证一致性

无 UPS + 消费级 SSD（无 PLP）：
  └─ 最高风险配置
  └─ 必须禁用磁盘写缓存
  └─ 且不能依赖文件系统的日志完整性
  └─ 建议使用带校验和的文件系统（Btrfs/ZFS）

RAID 控制器：
  └─ 有 BBU/FBWC：启用写回缓存（Write-Back）
  └─ BBU 电量低或失效：自动切换为写通（Write-Through）
  └─ 监控告警：BBU 状态必须纳入监控
```

            

### 10.5 定期扫描计划

            
```
# 推荐的扫描计划（通过 cron 或 systemd timer 实现）

# 每日：SMART 短自检
# /etc/cron.d/smart-check
0 3 * * * root smartctl -t short /dev/sda

# 每周：RAID 扫描
# /etc/cron.d/raid-check
0 2 * * 0 root echo check > /sys/block/md0/md/sync_action

# 每周：Btrfs scrub
# /etc/cron.d/btrfs-scrub
0 2 * * 0 root btrfs scrub start /mnt/data

# 每月：ZFS scrub
# /etc/cron.d/zfs-scrub
0 2 1 * * root zpool scrub tank

# 每月：SMART 长自检
0 2 15 * * root smartctl -t long /dev/sda

# 每季度：数据库校验和全量检查
# （需要在低峰期执行，会增加 I/O 负载）
0 2 1 1,4,7,10 * root pg_checksums --check \
    -D /var/lib/postgresql/data >> /var/log/pg-checksum.log 2>&1
```

            

### 10.6 监控与告警

            

数据完整性问题的发现越早，修复成本越低。以下是需要监控和告警的关键指标：
            
```
磁盘层面：
  - SMART 属性异常（Reallocated Sectors > 0）
  - SMART 自检失败
  - I/O 错误计数增长（/proc/diskstats、dmesg）
  - NVMe Media and Data Integrity Errors > 0

RAID 层面：
  - RAID 扫描发现不一致块（mismatch_cnt > 0）
  - RAID 阵列降级（Degraded）
  - BBU 电量低于阈值
  - 热备盘（Hot Spare）被激活

文件系统层面：
  - Btrfs/ZFS scrub 发现错误
  - ext4/XFS 内核日志中的校验和错误
  - 文件系统只读挂载（Read-Only Remount）

数据库层面：
  - PostgreSQL：page verification failed 日志
  - MySQL/InnoDB：page corruption 错误日志
  - 校验和不匹配计数器增长

备份层面：
  - 备份校验和验证失败
  - 备份恢复测试失败
```

            

### 10.7 备份验证

            

备份本身也可能存在数据损坏。一个从未验证过的备份，和没有备份之间的区别，只有在你真正需要恢复时才会体会到：
            
```
# PostgreSQL 备份验证
# 1. 使用 pg_verifybackup 验证基础备份的完整性
pg_verifybackup /path/to/backup

# 2. 定期恢复测试
# 在测试环境中恢复备份，验证数据一致性
pg_restore -d test_db /path/to/backup/base.tar.gz
psql -d test_db -c "SELECT count(*) FROM critical_table;"

# 通用的文件备份验证
# 创建备份时计算校验和
find /data -type f -exec sha256sum {} \; > /backup/checksums.sha256

# 验证备份文件的校验和
cd /backup/data
sha256sum -c /backup/checksums.sha256

# 输出示例：
# file1.dat: OK
# file2.dat: OK
# file3.dat: FAILED    ← 数据损坏
# sha256sum: WARNING: 1 computed checksum did NOT match
```

            
            

## 十一、开放问题

            
            
- **崩溃一致性与 SDC 的边界**：Pillai et
            al.（OSDI 2014）表明应用不能假设任意 FS 在断电下一致——与 SDC
            检测（checksum）是正交问题；统一测试框架仍缺。
            
- **DIF/DIX uptake**：T10-PI 在 Linux
            块层可用，但与 ZFS/Btrfs
            原生校验叠加时的语义分工未标准化（§8.2–8.4）。
            
- **SDC 率可比性**：field study 口径分裂（见
            §6.3）；运维 SLA 多依赖 scrub 检出率而非先验概率。
            
- **备份即最后防线**：无 FS 校验的 ext4/XFS
            上，应用 checksum 库与离线 sha256 扫描谁更
            cost-effective——缺同 workload 公开对比。
            
            
            

## 参考资料

            

### 规范与内核文档

            
            
- Linux
            `Documentation/block/data-integrity.rst` —
            DIF/DIX 块层框架
            
- PostgreSQL WAL Configuration — https://www.postgresql.org/docs/current/wal-configuration.html
            
            

### 论文

            
            
- Pillai et al. (2014). *All File Systems Are Not
            Created Equal.* OSDI — §5.7 崩溃一致性。
            
- Bairavasundaram et al. (2008). *An Analysis of Data
            Corruption in the Storage Stack.* FAST — §6.3。
            
- Bairavasundaram et al. (2007). *Latent Sector
            Errors.* SIGMETRICS。
            
- Schroeder & Gibson (2007). *Disk Failures in the
            Real World.* FAST。
            
- Schroeder, Pinheiro & Weber (2009). *DRAM Errors
            in the Wild.* SIGMETRICS。
            
- Zheng et al. (2013). *Understanding the Robustness of
            SSDs under Power Fault.* FAST — §5.6。
            
- Bonwick & Ahrens (2006). *The Zettabyte File
            System.* StorageSS — ZFS 端到端校验起源。
            
- Alagappan et al. (2018). *Protocol-Aware
            Recovery.* FAST。
            
            

### 关联篇目

            
            
- [43
            校验和与数据完整性](../43-checksum/checksum.html)
            
- [17
            ZFS：数据完整性优先的存储栈](../17-zfs-integrity/zfs-integrity.html)
            
            
            

**上一篇**: Linux 异步
            I/O：从 POSIX AIO 到 io_uring **下一篇**:
            文件系统基础：inode、目录与
            VFS
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-21 · storage
                    

### 【存储工程】校验和与数据完整性

                    

深入分析存储系统中的数据完整性保障——CRC32C、xxHash、SHA-256 的性能对比，静默数据损坏的检测与防护，端到端校验架构设计
                

                
                    

2025-08-26 · storage
                    

### 【存储工程】ZFS：数据完整性优先的存储栈

                    

ZFS 三层架构、Merkle 端到端校验、CoW、ARC、RAID-Z 与运维；算法选型与 field study 口径见 checksum / data-integrity 篇。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

O_DIRECT 的语义、对齐约束、文件系统坑与何时该/不该绕过 Page Cache；io_uring 组合路径见 #79。
                

                
                    

2025-10-15 · storage
                    

### 【存储工程】写入性能优化

                    

深入分析存储写入性能优化——WAL 分组提交、批量写入、Write Buffer 调优、fsync 频率控制、写入限速与写停顿分析