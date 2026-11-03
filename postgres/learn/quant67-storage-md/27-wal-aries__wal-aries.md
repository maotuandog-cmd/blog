# 【存储工程】WAL 与崩溃恢复：ARIES 协议

来源: https://quant67.com/post/storage/27-wal-aries/wal-aries.html
日期: 2025-09-05 |

---

数据库最核心的承诺之一是持久性（Durability）：事务一旦提交，其修改不会因系统崩溃而丢失。实现这一承诺的关键技术是预写式日志（Write-Ahead
            Logging，WAL）。WAL
            的思想极其简单——先写日志，再改数据页——但围绕它构建一套完整的崩溃恢复协议，却需要处理大量的边界情况：部分写入、事务回滚、检查点、并发控制之间的交互等。
            

ARIES（Algorithm for Recovery and Isolation Exploiting
            Semantics）是 IBM 研究院在 1992
            年提出的崩溃恢复协议。三十多年过去，它仍然是工业界数据库（DB2、SQL
            Server、PostgreSQL、MySQL InnoDB）崩溃恢复的理论基础。理解
            ARIES，就等于理解了绝大多数关系型数据库在断电、进程崩溃后如何恢复到一致状态。
            

本文从崩溃恢复的核心难题出发，依次讲解 WAL
            的三条规则、日志记录格式、ARIES 协议的三个阶段，再以 MySQL
            InnoDB 为实例分析工业级实现，最后讨论 WAL
            的写放大问题与优化手段。关于 WAL 在 LSM-Tree
            场景下的应用，可参考 WAL 与
            MemTable。
            
            

**适用范围说明**
            本文聚焦于基于页（page-oriented）的存储引擎。LSM-Tree
            类引擎的 WAL 机制有所不同，不在本文讨论范围内。ARIES
            协议的描述基于原始论文（Mohan et al., 1992），具体实现（如
            InnoDB）会在细节上有所调整。
            
            
            

## 一、崩溃恢复问题

            

### 1.1 为什么崩溃恢复困难

            

数据库系统在正常运行时，大量数据页缓存在缓冲池（Buffer
            Pool）中。事务对数据的修改首先发生在内存中的脏页（Dirty
            Page）上，然后在某个时刻才刷写到磁盘。这种设计带来了巨大的性能优势——随机写变成了顺序写加上延迟的批量刷盘——但也引入了一个根本性问题：如果系统在脏页刷写到磁盘之前崩溃，这些修改就会丢失。
            

更糟糕的是，崩溃可能发生在任何时刻：
            
            
- 一个事务修改了 10 个数据页，只有 3 个被刷到磁盘；
            
- 操作系统正在写一个 16 KB 的数据页，只写了前 8 KB
            就断电了；
            
- 一个长事务正在执行
            `ROLLBACK`，回滚到一半时系统崩溃。
            
            

崩溃恢复协议需要处理所有这些情况，保证两个不变量（Invariant）：
            
            
- **已提交事务的修改必须持久化**——即使它们还没来得及刷盘。
            
- **未提交事务的修改必须被撤销**——即使它们的部分脏页已经刷到了磁盘。
            
            

### 1.2 部分写入问题

            

磁盘的原子写入单元通常是 512 字节（传统扇区）或 4
            KB（高级格式扇区），而数据库的页大小通常是 8
            KB（PostgreSQL）或 16
            KB（InnoDB）。这意味着一次页面写入需要多次扇区写入，断电可能导致页面只写了一半，产生所谓的「撕裂页」（Torn
            Page）。
            
```
数据页写入过程（16 KB 页 = 4 × 4 KB 扇区）：

正常写入：
  扇区 1 [✓] → 扇区 2 [✓] → 扇区 3 [✓] → 扇区 4 [✓]
  结果：完整页面，数据一致

断电时的撕裂写：
  扇区 1 [✓] → 扇区 2 [✓] → 扇区 3 [部分] → 扇区 4 [✗]
  结果：页面损坏，前半部分是新数据，后半部分是旧数据
```

            

撕裂页问题不能仅靠 WAL 解决——WAL
            的重做（Redo）操作假设目标页面本身是完好的（要么是旧版本，要么是新版本，但不能是半新半旧）。InnoDB
            通过双写缓冲区（Doublewrite
            Buffer）来解决这个问题，我们在第九节详细讨论。
            

### 1.3 写入顺序保证

            

现代存储栈有多层缓存：CPU 缓存、文件系统页缓存（Page
            Cache）、磁盘控制器写缓存、磁盘本身的写缓存。任何一层都可能对写入进行重排序。对于
            WAL 来说，关键的顺序保证是：
            

**日志记录必须在对应的数据页之前到达持久化存储。**
            

如果数据页先于日志被刷到磁盘，然后系统崩溃，恢复程序就无法得知这个数据页被修改过，也就无法判断它是否需要被撤销。
            

实现这一保证的手段包括：
            
```
// 典型的 WAL 写入流程（伪代码）
void write_and_flush_wal(LogRecord *record) {
    // 1. 将日志记录追加到 WAL 缓冲区
    wal_buffer_append(record);

    // 2. 将 WAL 缓冲区写入文件
    write(wal_fd, wal_buffer, wal_buffer_size);

    // 3. 强制刷盘：fsync 保证数据到达持久化存储
    //    而非停留在操作系统的页缓存中
    fsync(wal_fd);
}

// 只有在 WAL 刷盘完成后，才允许数据页被刷出缓冲池
void flush_dirty_page(Page *page) {
    // 检查：该页面的最新修改对应的日志是否已经刷盘
    if (page->page_lsn > wal_flushed_lsn) {
        // 先刷日志
        flush_wal_up_to(page->page_lsn);
    }
    // 现在可以安全地刷数据页
    write(data_fd, page, PAGE_SIZE);
    fsync(data_fd);
}
```

            

`fsync()`
            系统调用是保证写入持久化的核心手段。需要注意的是，某些文件系统（如
            ext3 的 `data=writeback` 模式）的
            `fsync` 行为可能不符合预期，生产环境中通常使用
            `O_DIRECT` + `O_DSYNC` 或者明确的
            `fdatasync()` 来确保写入顺序。
            

### 1.4 崩溃恢复的目标

            

总结来说，崩溃恢复协议需要达成以下目标：
            
            
            
            目标
            含义
            
            
            
            
            原子性（Atomicity）
            事务的所有修改要么全部生效，要么全部不生效
            
            
            持久性（Durability）
            已提交事务的修改在崩溃后仍然存在
            
            
            一致性（Consistency）
            恢复后的数据库处于一个逻辑一致的状态
            
            
            高性能
            正常运行时的开销尽可能小
            
            
            快速恢复
            崩溃后的恢复时间尽可能短
            
            
            
            
            

## 二、WAL 三条规则

            

### 2.1 预写规则（Write-Ahead
            Rule）

            

预写规则是 WAL 的核心，也是它名字的由来：
            
            

**在将修改后的数据页写入磁盘之前，必须先将对应的日志记录写入持久化存储。**
            
            

形式化地表述：对于数据页 P 上的任何修改 M，如果 M
            对应的日志记录为 L，那么 L 必须在 P 之前被写入磁盘。
            

这条规则保证了撤销（Undo）的可能性：如果系统崩溃，恢复程序可以通过日志记录中的前像（Before-Image）将未提交事务的修改回滚。
            
```
预写规则保证的时序：

时间线：──────────────────────────────────→

正确的顺序：
  日志写入磁盘 ─────────────→ 数据页写入磁盘
       ↑                            ↑
    日志 fsync                  数据页 fsync

违反预写规则（危险！）：
  数据页写入磁盘 ─→ 崩溃！─→ 日志还在内存中
       ↑                         ↑
    无法撤销这个修改         日志丢失了
```

            

### 2.2 重做规则（Redo Rule）

            
            

**事务提交时，其所有日志记录必须已经写入持久化存储。**
            
            

这条规则也称为「强制日志」（Force-Log-at-Commit）。它保证了持久性：即使事务提交后数据页还没有刷盘，恢复程序也可以通过日志记录中的后像（After-Image）重新应用这些修改。
            
```
事务提交流程：

BEGIN TRANSACTION T1
  UPDATE account SET balance = balance - 100 WHERE id = 1;
  → 生成日志记录 L1: 

  UPDATE account SET balance = balance + 100 WHERE id = 2;
  → 生成日志记录 L2: 

COMMIT T1
  → 将 L1、L2（以及 COMMIT 记录）刷盘
  → fsync(wal_fd)
  → 返回「提交成功」给客户端

  此时 account_page_5 和 account_page_8 可能还在缓冲池中，
  尚未刷入磁盘——这是允许的，因为日志已经持久化了。
```

            

### 2.3 撤销规则（Undo Rule）

            
            

**如果数据库允许未提交事务的脏页被刷入磁盘（Steal
            策略），那么日志中必须包含足够的信息来撤销这些修改。**
            
            

这条规则的前提是 Steal 策略。理解它需要先理解 Force/Steal
            缓冲池策略。
            

### 2.4 Force vs No-Force

            

Force
            策略决定的是：**事务提交时，是否强制将所有脏页刷入磁盘？**
            
            
            
            
            
            
            
            
            
            策略
            行为
            优点
            缺点
            
            
            
            
            Force
            提交时强制刷所有脏页
            恢复简单：不需要 Redo
            提交延迟高，大量随机 I/O
            
            
            No-Force
            提交时只刷日志，脏页延迟刷写
            提交速度快
            恢复时需要 Redo
            
            
            
            

几乎所有现代数据库都采用 No-Force
            策略。提交时只需要一次顺序写（日志刷盘），而不是多次随机写（数据页刷盘），性能差距可以达到一个数量级。
            

### 2.5 Steal vs No-Steal

            

Steal
            策略决定的是：**是否允许将未提交事务修改过的脏页刷入磁盘？**
            
            
            
            
            
            
            
            
            
            策略
            行为
            优点
            缺点
            
            
            
            
            Steal
            允许刷未提交事务的脏页
            缓冲池管理灵活，内存压力小
            恢复时需要 Undo
            
            
            No-Steal
            不允许刷未提交事务的脏页
            恢复简单：不需要 Undo
            长事务可能撑爆缓冲池
            
            
            
            

Steal 策略在内存受限的环境下至关重要。如果采用
            No-Steal，一个修改了百万行数据的长事务会把所有相关脏页「钉」在缓冲池中，可能导致内存耗尽。
            

### 2.6 策略组合

            

四种组合的对比：
            
```
                    Steal               No-Steal
              ┌──────────────────┬──────────────────┐
              │                  │                  │
   No-Force   │  需要 Redo+Undo  │   只需要 Redo    │
              │  （ARIES 采用）   │                  │
              │                  │                  │
              ├──────────────────┼──────────────────┤
              │                  │                  │
   Force      │  只需要 Undo     │  不需要恢复日志   │
              │                  │  （但性能最差）   │
              │                  │                  │
              └──────────────────┴──────────────────┘
```

            

ARIES 采用 **Steal + No-Force**
            组合，获得最大的灵活性和性能，代价是恢复逻辑最复杂——需要同时支持
            Redo 和 Undo。这正是 ARIES 存在的意义。
            
            

## 三、日志记录格式

            

### 3.1 日志序列号（LSN）

            

日志序列号（Log Sequence Number，LSN）是 WAL
            系统中最关键的概念。每条日志记录都有一个唯一的、单调递增的
            LSN。LSN 的具体含义因实现而异：
            
            
- **InnoDB**：LSN
            是日志文件中的字节偏移量（Byte Offset）
            
- **PostgreSQL**：LSN 也是 WAL
            文件中的字节位置
            
- **学术描述**：通常简化为整数序号
            
            

LSN 贯穿整个恢复协议，充当了多个关键角色：
            
```
LSN 的用途：

1. 数据页头部的 page_lsn：
   记录「最后一次修改该页面的日志记录的 LSN」
   → 用于 Redo 阶段判断是否需要重做

2. 日志记录中的 prev_lsn：
   指向「同一事务的上一条日志记录」
   → 用于 Undo 阶段沿事务链回滚

3. 全局的 flushed_lsn：
   记录「已经刷入磁盘的日志的最大 LSN」
   → 用于判断数据页是否可以安全刷盘（预写规则）

4. 检查点中的 checkpoint_lsn：
   记录「检查点开始时的 LSN」
   → 用于 Analysis 阶段确定扫描起点
```

            

### 3.2 普通日志记录结构

            

一条完整的更新日志记录（Update Log
            Record）包含以下字段：
            
```
┌──────────────────────────────────────────────────────────┐
│                    Update Log Record                      │
├──────────┬───────────┬───────────┬───────────────────────┤
│  LSN     │  TransID  │  PrevLSN  │  Type                 │
│  (日志   │  (事务    │  (同一事务│  (UPDATE/INSERT/       │
│   序列号) │   标识符)  │  上一条   │   DELETE/COMMIT/      │
│          │           │   LSN)    │   ABORT/CLR/...)      │
├──────────┴───────────┴───────────┴───────────────────────┤
│  PageID          │  Offset       │  Length               │
│  (被修改的页面ID) │  (页内偏移)    │  (修改数据长度)       │
├──────────────────┴───────────────┴───────────────────────┤
│  Before-Image (修改前的数据，用于 Undo)                    │
├──────────────────────────────────────────────────────────┤
│  After-Image  (修改后的数据，用于 Redo)                    │
└──────────────────────────────────────────────────────────┘
```

            

字段详解：
            
            
            
            字段
            大小（典型）
            用途
            
            
            
            
            LSN
            8 字节
            唯一标识这条日志记录
            
            
            TransID
            4-8 字节
            标识产生这条记录的事务
            
            
            PrevLSN
            8 字节
            指向同一事务的上一条日志，构成事务链
            
            
            Type
            1 字节
            记录类型
            
            
            PageID
            4-8 字节
            被修改的数据页编号
            
            
            Offset
            2 字节
            页内偏移
            
            
            Length
            2 字节
            修改的数据长度
            
            
            Before-Image
            可变
            修改前的数据值（物理 Undo）
            
            
            After-Image
            可变
            修改后的数据值（物理 Redo）
            
            
            
            

### 3.3 日志记录类型

            

ARIES 定义了多种日志记录类型：
            
```
日志记录类型：

UPDATE     ── 普通的数据修改（包含 before-image 和 after-image）
COMMIT     ── 事务提交标记（无数据内容）
ABORT      ── 事务中止标记
CLR        ── 补偿日志记录（Compensation Log Record）
BEGIN_CKPT ── 检查点开始
END_CKPT   ── 检查点结束（包含脏页表和活动事务表）
```

            

### 3.4 补偿日志记录（CLR）

            

补偿日志记录（Compensation Log Record，CLR）是 ARIES
            最精妙的设计之一。当系统执行 Undo
            操作（无论是正常回滚还是崩溃恢复期间的 Undo
            阶段）时，每撤销一条日志记录，就会写入一条 CLR。
            

CLR 的关键字段：
            
```
┌──────────────────────────────────────────────────────────┐
│             Compensation Log Record (CLR)                 │
├──────────┬───────────┬───────────┬───────────────────────┤
│  LSN     │  TransID  │  PrevLSN  │  Type = CLR           │
├──────────┴───────────┴───────────┴───────────────────────┤
│  PageID          │  Undo-Data (撤销操作的内容)            │
├──────────────────┴───────────────────────────────────────┤
│  UndoNextLSN：指向下一条需要被撤销的日志记录              │
│  （即被撤销记录的 PrevLSN）                               │
└──────────────────────────────────────────────────────────┘
```

            

CLR 的核心价值在于 `UndoNextLSN`
            字段。它指向「下一条需要被 Undo 的日志记录」，使得：
            
            
- **CLR 自身永远不需要被
            Undo**——如果回滚过程中又崩溃了，恢复程序通过
            `UndoNextLSN`
            跳过已经撤销的记录，从断点继续。
            
- **Undo
            操作是幂等的**——无论崩溃和恢复发生多少次，最终结果都是正确的。
            
            

举一个具体的例子：
            
```
事务 T1 的日志链与回滚过程：

原始日志（从上到下 LSN 递增）：
  LSN=10: 
  LSN=20: 
  LSN=30: 

T1 执行 ABORT，开始回滚：

Step 1: 撤销 LSN=30，写入 CLR
  LSN=35: 

Step 2: 撤销 LSN=20，写入 CLR
  LSN=40: 

     ──── 此时系统崩溃！ ────

恢复时的 Undo 阶段：
  发现 T1 未提交，需要继续回滚。
  找到 T1 最新的日志记录 LSN=40（CLR）。
  UndoNextLSN=10，直接跳到 LSN=10 继续撤销。
  不需要重新撤销 LSN=30 和 LSN=20。

Step 3: 撤销 LSN=10，写入 CLR
  LSN=45: 

  UndoNextLSN=NULL，表示 T1 的所有修改已经撤销完毕。
  写入 ABORT 记录，T1 回滚完成。
```

            

### 3.5 物理日志 vs 逻辑日志

            

ARIES
            使用的是**物理逻辑日志**（Physiological
            Logging）：
            
            
- **物理的**：日志记录绑定到具体的页面（PageID）。
            
- **逻辑的**：页面内部的修改用逻辑操作描述（如「在
            B+ 树叶子节点中插入键值
            K」），而非记录整个页面的前后像。
            
            

这种混合方式的优点：
            
```
纯物理日志（Page-Level）：
  记录整个 16 KB 页面的 before-image 和 after-image
  → 日志量巨大（每次修改 32 KB 日志）
  → 但 Redo/Undo 简单：直接覆盖页面

纯逻辑日志（Operation-Level）：
  记录 "INSERT INTO table VALUES (1, 'Alice')"
  → 日志量小
  → 但 Redo 需要重新执行 SQL，依赖索引结构等上下文
  → 且不能保证幂等性

物理逻辑日志（Physiological）：
  记录 "在 PageID=42 的偏移 200 处写入 8 字节: 0x..."
  → 日志量适中
  → Redo/Undo 只需定位到具体页面，操作明确
  → 这是 ARIES 和大多数工业实现的选择
```

            
            

## 四、ARIES 协议概览

            

### 4.1 三大设计原则

            

ARIES 协议建立在三大设计原则之上：
            
            
- **Write-Ahead
            Logging**：日志先于数据页写入磁盘。
            
- **Repeating History During
            Redo**：重做阶段重放所有日志记录（包括未提交事务的），将数据库恢复到崩溃前一刻的精确状态。
            
- **Logging Changes During
            Undo**：撤销操作本身也会被记录（CLR），防止重复撤销。
            
            

第二条原则——「重放历史」——是 ARIES
            与早期恢复算法的关键区别。早期算法在 Redo
            阶段只重做已提交事务的修改，这看似高效，实际上会导致复杂的正确性问题（如锁的恢复）。ARIES
            选择了更简单的路径：先完全重放历史，再撤销未提交事务。
            

### 4.2 三阶段概览

            

ARIES 的崩溃恢复分为三个阶段，按顺序执行：
            
```
崩溃恢复三阶段：

     日志文件
     ┌─────────────────────────────────────────────────────┐
     │  ...  │ CKPT │  ...  │  ...  │  ...  │  ... │ 崩溃  │
     └───────┼──────┼───────┼───────┼───────┼──────┼───────┘
             │      │                              │
             │      │←──── Analysis 阶段 ─────────→│
             │      │  从检查点开始，正向扫描日志     │
             │      │  重建脏页表和活动事务表         │
             │      │                              │
             │      │←──── Redo 阶段 ─────────────→│
             │      │  从最小 recLSN 开始，正向扫描  │
             │      │  重做所有日志记录              │
             │      │                              │
             │      │←──── Undo 阶段 ─────────────→│
             │      │  从最大 LSN 开始，反向扫描     │
             │      │  撤销所有未提交事务             │
             │      │                              │
```

            

### 4.3 核心数据结构

            

ARIES
            依赖两个关键的内存数据结构，它们在正常运行时由事务管理器维护，在恢复的
            Analysis 阶段被重建：
            

**脏页表（Dirty Page Table，DPT）**
            
```
脏页表：记录所有在缓冲池中被修改但尚未刷入磁盘的页面

┌──────────┬──────────┐
│  PageID  │  recLSN  │
├──────────┼──────────┤
│  Page_5  │  LSN=100 │  ← 该页面第一次被弄脏时的 LSN
│  Page_8  │  LSN=150 │
│  Page_12 │  LSN=200 │
│  Page_3  │  LSN=250 │
└──────────┴──────────┘

recLSN（Recovery LSN）：
  该页面自上次刷盘以来，第一次被修改时对应的日志 LSN。
  Redo 阶段用 recLSN 来确定「这个页面最早可能需要从哪条日志开始重做」。
```

            

**活动事务表（Active Transaction
            Table，ATT）**
            
```
活动事务表：记录所有正在执行的事务

┌──────────┬──────────┬───────────┐
│ TransID  │  Status  │  LastLSN  │
├──────────┼──────────┼───────────┤
│  T1      │  Running │  LSN=300  │  ← T1 最近一条日志的 LSN
│  T2      │  Running │  LSN=280  │
│  T3      │  Aborting│  LSN=310  │  ← T3 正在回滚中
└──────────┴──────────┴───────────┘

LastLSN：
  事务最近一条日志记录的 LSN。
  Undo 阶段从这里开始，沿 PrevLSN 链反向回滚。
```

            

### 4.4 为什么 ARIES
            是黄金标准

            

ARIES
            之所以成为工业标准，是因为它在正确性、性能和灵活性之间取得了最佳平衡：
            
            
            
            特性
            ARIES 的做法
            优势
            
            
            
            
            Steal + No-Force
            允许最灵活的缓冲池管理
            正常运行时高性能
            
            
            Physiological Logging
            页面级定位 + 逻辑操作
            日志量适中且可并发
            
            
            CLR
            撤销操作也记日志
            支持嵌套回滚，恢复幂等
            
            
            Repeating History
            Redo 所有操作
            简化恢复逻辑，支持细粒度锁恢复
            
            
            Fuzzy Checkpoint
            检查点不阻塞事务
            正常运行时几乎零开销
            
            
            
            

### 4.5 学术谱系：ARIES
            与现代实现分叉

            

ARIES 不是单一产品，而是一族崩溃恢复协议的理论起点：
            
```
Mohan et al. (TODS 1992) — ARIES 主论文
    Steal + No-Force + Physiological Logging + CLR + Repeating History
         │
         ├─→ Mohan & Levine (SIGMOD 1992) — ARIES/IM（B+ 树索引恢复）
         ├─→ Mohan (VLDB 1999) — Repeating History Beyond ARIES（扩展讨论）
         │
         └─→ 生产实现分叉（均继承 WAL + LSN + Checkpoint 思想，细节各异）
                ├─ IBM DB2 / SQL Server — 最接近论文三阶段框架
                ├─ PostgreSQL — REDO 中心 + CLOG/MVCC 处理未提交事务（见下节对照）
                └─ MySQL InnoDB — Redo + 独立 Undo 表空间 + 异步回滚
```

            

理解 ARIES
            的价值在于把握**不变量**（预写、幂等重做、撤销可续作），而非要求每个数据库逐行复现
            Analysis/Redo/Undo
            伪代码。Mohan（1999）已指出：新存储介质（NVRAM、远程复制）会改变「何谓刷盘」的前提，但
            WAL 顺序与 LSN 单调性仍是共识。
            

### 4.6 与
            PostgreSQL WAL、InnoDB Redo/Undo 的对照

            

下文对照 ARIES 论文抽象、PostgreSQL 17 WAL 实现与 InnoDB
            8.0 实现。内核细节分别见 PG
            WAL 内部机制、InnoDB
            Redo Log、InnoDB
            Undo Log。
            
            
            
            
            
            
            
            
            
            维度
            ARIES（Mohan et al., 1992）
            PostgreSQL WAL
            InnoDB（Redo + Undo）
            
            
            
            
            恢复阶段
            Analysis → Redo → Undo 三阶段显式分离
            `StartupXLOG()` 以 checkpoint REDO
            指针为起点做 REDO；未提交事务依赖
            CLOG/快照语义清理，**无独立 Analysis/Undo
            阶段**
            启动时 Redo 扫描 + Undo 回滚未提交事务；**Redo
            完成后可先对外服务，Undo 可后台执行**
            
            
            Undo 信息存放
            UPDATE 记录的 before-image；Undo 写 CLR
            不在 WAL 存行级 before-image；多版本与 abort 由 heap +
            CLOG + 可见性规则处理
            **独立 Undo Tablespace**；Undo
            页修改本身也产生 Redo
            
            
            检查点
            Fuzzy：`BEGIN_CKPT` / `END_CKPT`
            携带 DPT+ATT 快照
            两阶段 checkpoint：`GetRedoRecPtr()` 定 REDO
            点 → 刷脏页 → 写 checkpoint record → 更新
            `pg_control`
            按 Redo 空间使用率（约 75%）自适应推进 checkpoint
            
            
            幂等重做键
            页面 `page_lsn` vs 记录 LSN
            页面 `pd_lsn` vs record LSN
            页面 `page_lsn` vs record LSN
            
            
            补偿记录
            **CLR**（`UndoNextLSN`
            跳过已撤销项）
            无 CLR；崩溃后依赖 WAL 重放 + 事务状态位
            Undo 链 + Purge；回滚进度可续作但结构不同于 ARIES
            CLR
            
            
            撕裂页
            论文假设页级原子性或外部分机制
            **FPW**（Full Page Write）写入 WAL
            **Doublewrite Buffer**
            
            
            Steal + No-Force
            论文标准组合
            支持（脏页可先于 commit 落盘，commit 强制 WAL
            flush）
            支持（`innodb_flush_log_at_trx_commit`
            控制持久化语义）
            
            
            逻辑/物理日志
            Physiological（页定位 + 操作描述）
            RMGR 分发；heap/btree 等逻辑操作 + 可选 FPW
            MLOG 类型码（`MLOG_REC_INSERT` 等）+
            物理偏移
            
            
            
            

PostgreSQL 与 InnoDB 都满足 WAL 预写与 LSN 单调性，但
            **Undo 放在哪里、恢复分几个阶段**
            是最显著的分叉：PG 把「谁提交了」交给 CLOG/MVCC，InnoDB 把
            before-image 放进 Undo 段并为之写
            Redo——读内核文时应对照这一列，避免用 ARIES
            伪代码生搬硬套。
            
            

## 五、Analysis 阶段

            

### 5.1 Analysis 阶段的目标

            

Analysis
            阶段是恢复的第一步，它的目标是通过正向扫描日志，重建崩溃时刻的两个关键数据结构：
            
            
- **脏页表（DPT）**：确定哪些页面可能需要被重做。
            
- **活动事务表（ATT）**：确定哪些事务需要被撤销。
            
            

此外，Analysis 还确定了 Redo 阶段的起始点——DPT 中最小的
            `recLSN`。
            

### 5.2 扫描起点

            

Analysis 从最近一次成功的检查点（Checkpoint）的
            `BEGIN_CKPT` 记录开始扫描。检查点的
            `END_CKPT` 记录中包含了检查点时刻的 DPT 和 ATT
            快照，作为 Analysis 的初始值。
            
```
Analysis 阶段的扫描范围：

日志文件：
  ┌──────┬──────────┬───────────────────────────────────┬──────┐
  │ ...  │BEGIN_CKPT│      END_CKPT                     │      │
  │      │ LSN=500  │ LSN=510                           │      │
  │      │          │ DPT: {P5:100, P8:150}             │ 崩溃 │
  │      │          │ ATT: {T1:Running:300, T2:Run:280} │      │
  └──────┴──────────┴───────────────────────────────────┴──────┘
                     ↑                                    ↑
               Analysis 起点                        Analysis 终点
```

            

### 5.3 Analysis 算法

            
```
# Analysis 阶段伪代码

def analysis_phase(checkpoint_lsn):
    # 1. 从检查点的 END_CKPT 记录中读取初始 DPT 和 ATT
    end_ckpt = read_log_record(checkpoint_lsn)
    dirty_page_table = end_ckpt.dpt.copy()  # 脏页表
    active_trans_table = end_ckpt.att.copy()  # 活动事务表

    # 2. 从检查点之后的第一条日志开始，正向扫描到日志末尾
    lsn = checkpoint_lsn + 1
    while lsn 
            

### 5.4 Analysis 的精确性

            

需要注意的是，Analysis 阶段重建的 DPT
            是**保守的**（Conservative）：它可能包含一些实际上已经刷盘的页面。这是因为在检查点之后，后台线程可能已经将某些脏页刷入了磁盘，但
            Analysis 无法得知这一点（日志中不记录刷盘事件）。
            

这种保守性是安全的：Redo
            阶段在处理每个页面时，会比较页面上的 `page_lsn`
            和日志记录的
            LSN，如果页面已经包含了这次修改（`page_lsn >= record.lsn`），就跳过重做。多余的页面只会导致一些不必要的页面读取和
            LSN 比较，不会影响正确性。
            
            

## 六、Redo 阶段

            

### 6.1 重放历史（Repeating
            History）

            

Redo 阶段的核心原则是**重放历史**：从 DPT
            中最小的 `recLSN`
            开始，正向扫描日志，重做所有需要重做的修改——包括未提交事务的修改。
            

这个设计看起来违反直觉：为什么要重做即将被撤销的修改？原因有两个：
            
            
- 

**简化恢复逻辑**：重放所有历史后，数据库回到崩溃前一刻的精确状态。此时所有锁、所有数据页都和崩溃前一样，Undo
            阶段可以像正常回滚一样工作，无需特殊处理。
            
- 

**支持细粒度锁恢复**：如果只重做已提交事务，那些被未提交事务持有的锁信息就丢失了。在多用户环境中，这可能导致恢复后的数据库暴露不一致状态。
            
            

### 6.2 Redo 算法

            
```
# Redo 阶段伪代码

def redo_phase(dirty_page_table):
    # 1. 确定 Redo 起点：DPT 中最小的 recLSN
    redo_lsn = min(page.rec_lsn for page in dirty_page_table.values())

    # 2. 从 redo_lsn 开始，正向扫描日志
    lsn = redo_lsn
    while lsn = 页面的 recLSN
            elif lsn = lsn:
                    need_redo = False  # 页面已包含此修改

            # 5. 执行重做
            if need_redo:
                page = read_page_from_disk(page_id)
                apply_redo(page, record)  # 应用 after-image
                page.page_lsn = lsn       # 更新页面 LSN
                # 注意：不立即刷盘，由缓冲池管理器后续处理

        lsn = next_lsn(lsn)
```

            

### 6.3 Redo 的优化：LSN 比较

            

Redo 阶段最重要的优化是通过 LSN
            比较跳过不必要的重做：
            
```
LSN 比较的三层过滤：

第一层：DPT 过滤
  页面不在 DPT 中 → 跳过
  （该页面在检查点后没有被修改过，或已经刷盘）

第二层：recLSN 过滤
  record.LSN = record.LSN → 跳过
  （该修改已经体现在磁盘上的页面中）

示例：
  DPT: {Page_5: recLSN=100, Page_8: recLSN=200}

  LSN=90,  Page_5: 第一层通过，第二层过滤（90 = 100）
                   → 读取 Page_5，发现 page_lsn=180
                   → 第三层过滤（180 >= 150）→ 跳过
  LSN=190, Page_5: 第一层通过，第二层通过
                   → 读取 Page_5，发现 page_lsn=180
                   → 190 > 180 → 需要重做！
```

            

这种多层过滤使得 Redo
            阶段在大多数情况下只需要重做少量日志记录，大大缩短了恢复时间。
            

### 6.4 Redo 的幂等性

            

Redo
            操作是幂等的（Idempotent）：对同一条日志记录重做多次，结果和重做一次相同。这由
            `page_lsn`
            机制保证——第一次重做后，`page_lsn`
            被更新为该记录的 LSN，后续重做会被 LSN 比较跳过。
            

幂等性意味着即使恢复过程中再次崩溃，重新执行恢复也是安全的。
            
            

## 七、Undo 阶段

            

### 7.1 Undo 阶段的目标

            

经过 Redo
            阶段，数据库已经恢复到崩溃前一刻的状态——包括所有未提交事务的修改。Undo
            阶段的目标是撤销所有未提交事务的修改，使数据库回到一致状态。
            

ATT 中所有状态不是 `Committing`
            的事务都需要被撤销。
            

### 7.2 Undo 算法

            
```
# Undo 阶段伪代码

def undo_phase(active_trans_table):
    # 1. 收集所有需要撤销的事务的 LastLSN
    to_undo = []
    for trans_id, info in active_trans_table.items():
        if info.status != 'Committing':
            to_undo.append(info.last_lsn)

    # 2. 构建一个最大堆（按 LSN 降序处理）
    undo_heap = MaxHeap(to_undo)

    # 3. 从最大 LSN 开始，反向处理
    while undo_heap.is_not_empty():
        lsn = undo_heap.pop_max()
        record = read_log_record(lsn)

        if record.type == 'CLR':
            # CLR 记录不需要被撤销
            # 但需要继续沿链回滚：跟随 UndoNextLSN
            if record.undo_next_lsn is not None:
                undo_heap.push(record.undo_next_lsn)
            else:
                # UndoNextLSN = NULL，该事务的所有修改已撤销
                write_end_record(record.trans_id)

        elif record.type == 'UPDATE':
            # 撤销这条更新：应用 before-image
            page = read_page_from_disk(record.page_id)
            apply_undo(page, record)  # 恢复 before-image

            # 写入 CLR 记录
            clr = CLR(
                trans_id=record.trans_id,
                page_id=record.page_id,
                undo_data=record.before_image,
                undo_next_lsn=record.prev_lsn  # 指向上一条需要撤销的记录
            )
            write_log_record(clr)

            # 继续沿事务链回滚
            if record.prev_lsn is not None:
                undo_heap.push(record.prev_lsn)
            else:
                # 事务的所有修改已撤销
                write_end_record(record.trans_id)
```

            

### 7.3 为什么用最大堆

            

Undo 阶段使用最大堆（Max-Heap）按 LSN
            降序处理多个事务的回滚。这个设计使得多个事务可以「交错」撤销，而日志文件只需要一次反向扫描。
            
```
多事务并行 Undo 示例：

日志文件中的记录（按 LSN 递增）：
  LSN=100: T1, UPDATE, PageA
  LSN=110: T2, UPDATE, PageB
  LSN=120: T1, UPDATE, PageC
  LSN=130: T2, UPDATE, PageD
  LSN=140: T1, UPDATE, PageE

ATT: {T1: LastLSN=140, T2: LastLSN=130}

最大堆初始状态：[140, 130]

Step 1: pop 140 → 撤销 T1 的 LSN=140，写 CLR
        push T1.PrevLSN=120 → 堆: [130, 120]

Step 2: pop 130 → 撤销 T2 的 LSN=130，写 CLR
        push T2.PrevLSN=110 → 堆: [120, 110]

Step 3: pop 120 → 撤销 T1 的 LSN=120，写 CLR
        push T1.PrevLSN=100 → 堆: [110, 100]

Step 4: pop 110 → 撤销 T2 的 LSN=110，写 CLR
        T2.PrevLSN=NULL → T2 撤销完成，写 END
        堆: [100]

Step 5: pop 100 → 撤销 T1 的 LSN=100，写 CLR
        T1.PrevLSN=NULL → T1 撤销完成，写 END
        堆: 空

Undo 阶段完成。
```

            

### 7.4 CLR 防止重复 Undo

            

CLR 的 `UndoNextLSN`
            字段解决了一个关键问题：如果 Undo
            阶段执行到一半时系统再次崩溃，恢复程序不需要重新撤销已经处理过的记录。
            
```
Undo 阶段中崩溃的处理：

第一次恢复的 Undo 阶段：
  撤销 LSN=140 → 写 CLR(LSN=150, UndoNext=120)
  撤销 LSN=130 → 写 CLR(LSN=155, UndoNext=110)
  ──── 崩溃！ ────

第二次恢复：
  Analysis 阶段：发现 T1(LastLSN=150)、T2(LastLSN=155) 未提交
  Redo 阶段：重做包括 CLR 在内的所有记录
  Undo 阶段：
    pop LSN=155 → CLR，UndoNext=110 → push 110
    pop LSN=150 → CLR，UndoNext=120 → push 120
    pop LSN=120 → UPDATE，撤销，写新 CLR
    pop LSN=110 → UPDATE，撤销，写新 CLR
    ...

  注意：LSN=140 和 LSN=130 不会被重复撤销！
  CLR 的 UndoNextLSN 跳过了它们。
```

            

这就是「Logging Changes During Undo」原则的威力：通过记录
            Undo 操作本身，ARIES
            保证了恢复过程的幂等性，无论崩溃发生多少次。
            
            

## 八、检查点（Checkpoint）

            

### 8.1 为什么需要检查点

            

没有检查点，每次崩溃恢复都需要从日志文件的最开头扫描——如果系统已经运行了数月，日志可能有数百
            GB，恢复时间不可接受。
            

检查点的作用是在日志中插入一个「快照标记」，告诉恢复程序：「在这个点之前的所有已提交事务的修改都已经持久化了，你只需要从这里开始扫描。」
            

### 8.2 简单检查点（Simple
            Checkpoint）

            

最简单的检查点策略：
            
```
简单检查点流程：

1. 暂停所有事务执行（Stop the World）
2. 将缓冲池中所有脏页刷入磁盘
3. 将当前 DPT 和 ATT 写入日志
4. 恢复事务执行

优点：恢复简单——只需要处理检查点之后的日志
缺点：暂停事务执行 → 不可接受的延迟峰值
      刷所有脏页 → 大量 I/O，可能需要数秒到数分钟
```

            

简单检查点在生产环境中基本不可用。如果缓冲池有 128
            GB，脏页比例 30%，刷写 38 GB 数据即使在 SSD
            上也需要数十秒。
            

### 8.3 模糊检查点（Fuzzy
            Checkpoint）

            

ARIES 采用模糊检查点，它不暂停事务，也不强制刷脏页：
            
```
模糊检查点流程：

1. 写入 BEGIN_CKPT 记录到日志
2. 获取当前 DPT 和 ATT 的快照（短暂加锁）
3. 写入 END_CKPT 记录到日志，内含 DPT 和 ATT 快照
4. 将 BEGIN_CKPT 的 LSN 记录到特殊的 master record 中
   （master record 在固定的磁盘位置，恢复时首先读取）

整个过程：
- 不暂停事务
- 不刷脏页
- 只写两条日志记录 + 更新 master record
- 开销极小
```

            

模糊检查点的「模糊」体现在：检查点记录的 DPT 和 ATT
            只是一个近似快照，不精确。但这没关系——Analysis
            阶段会从这个快照出发，通过扫描后续日志来修正它。
            

### 8.4
            检查点频率与恢复时间的权衡

            

检查点间隔与崩溃恢复工作量呈单调关系：间隔越长，两次
            checkpoint 之间累积的 WAL 越多，Analysis/Redo
            需要扫描的范围越大；间隔越短，正常运行时 checkpoint
            触发的刷脏 I/O 越频繁。InnoDB 不按固定时间做
            checkpoint，而是根据 Redo Log
            使用率触发——当使用量达到总容量约 75% 时加速刷脏并推进
            checkpoint（详见 InnoDB
            Redo Log 内部机制）。PostgreSQL 则由
            `checkpoint_timeout` 与 `max_wal_size`
            共同决定触发时机；`max_wal_size` 过小会导致 WAL
            段频繁切换并引发 checkpoint I/O 聚集（见 PG
            WAL 内部机制 第九节）。
            

**本文不给出恢复秒级估算**——恢复时间取决于
            WAL 体积、存储吞吐、并行度、是否需要 FPW/Doublewrite
            修复以及工作负载，未在同一环境实测前不宜写死数字。
            

### 8.5 检查点与日志回收

            

检查点还有另一个关键作用：确定哪些日志可以被安全回收。
            
```
日志回收规则：

  检查点 LSN 之前的日志 → 可以回收（覆盖重用）
  检查点 LSN 之后的日志 → 必须保留

日志文件（环形缓冲区）：
  ┌─────────────────────────────────────────────────────────┐
  │ 可回收 │ 可回收 │  CKPT  │ 活跃日志 │  活跃日志  │ 可回收 │
  │ （旧）  │ （旧）  │        │          │           │ （旧） │
  └────────┴────────┴────────┴──────────┴───────────┴───────┘
                      ↑                               ↑
                 checkpoint_lsn                   current_lsn

  如果活跃日志追上了 checkpoint_lsn → 必须强制做检查点
  否则日志空间耗尽，所有事务阻塞
```

            
            

## 九、MySQL InnoDB
            崩溃恢复

            

### 9.1 InnoDB 的日志架构

            

InnoDB 的崩溃恢复机制基于
            ARIES，但在实现上有自己的特点。InnoDB 有两种日志：
            
            
            
            
            
            
            
            
            日志类型
            功能
            对应 ARIES 概念
            
            
            
            
            Redo Log
            记录页面的物理修改，用于崩溃后重做
            ARIES 的 Redo 日志
            
            
            Undo Log
            记录事务的逻辑反操作，用于回滚和 MVCC
            ARIES 的 Undo 信息
            
            
            
            

注意 InnoDB 的一个重要区别：Undo Log
            存储在数据文件的特殊段（Undo Tablespace）中，而非 WAL
            文件中。这意味着 Undo Log 本身的修改也会产生 Redo Log
            记录。
            
```
InnoDB 的日志交互：

  事务执行 UPDATE：
  ┌─────────────────────────────────────────────────────┐
  │ 1. 在 Undo 段中分配空间，写入 Undo 记录              │
  │    （记录修改前的数据，供回滚和 MVCC 使用）           │
  │                                                     │
  │ 2. 修改数据页（Buffer Pool 中的脏页）                │
  │                                                     │
  │ 3. 生成 Redo Log 记录：                              │
  │    a) Undo 段页面的修改 → Redo 记录                  │
  │    b) 数据页的修改 → Redo 记录                       │
  │                                                     │
  │ 4. Redo 记录写入 Log Buffer                          │
  └─────────────────────────────────────────────────────┘
```

            

### 9.2 Redo Log 结构

            

InnoDB 的 Redo Log 是一组固定大小的文件，循环使用：
            
```
# 查看 InnoDB Redo Log 配置
mysql -e "SHOW VARIABLES LIKE 'innodb_redo_log%';"
# innodb_redo_log_capacity    104857600  (100 MB，MySQL 8.0.30+ 统一配置)

# 旧版配置方式（MySQL 8.0.30 之前）
# innodb_log_file_size    50331648   (48 MB per file)
# innodb_log_files_in_group  2      (2 files)
# 总容量 = 48 MB × 2 = 96 MB
```

            
```
Redo Log 文件布局（循环写入）：

  ib_logfile0                    ib_logfile1
  ┌─────────────────────┐      ┌─────────────────────┐
  │  Log Block 1 (512B) │      │  Log Block N+1      │
  │  Log Block 2 (512B) │      │  Log Block N+2      │
  │  ...                │ ───→ │  ...                │ ───→ 回到 file0
  │  Log Block N        │      │  Log Block 2N       │
  └─────────────────────┘      └─────────────────────┘

  每个 Log Block = 512 字节（匹配磁盘扇区大小）
  头部 12 字节 + 数据区 496 字节 + 尾部 4 字节

  Log Block Header：
  ┌──────────────┬───────────┬──────────────────────┐
  │ Block Number │ Data Len  │ First Record Offset  │
  │  (4 bytes)   │ (2 bytes) │ (2 bytes)            │
  ├──────────────┴───────────┴──────────────────────┤
  │             Log Record Data (496 bytes)          │
  ├─────────────────────────────────────────────────┤
  │             Checksum (4 bytes)                   │
  └─────────────────────────────────────────────────┘
```

            

### 9.3 InnoDB 的 LSN

            

InnoDB 的 LSN 是 Redo Log 中的字节偏移量，一个 8
            字节的无符号整数：
            
```
-- 查看当前 LSN 状态
SHOW ENGINE INNODB STATUS\G

---
LOG
---
Log sequence number          3456789012
Log buffer assigned up to    3456789012
Log buffer completed up to   3456789012
Log written up to            3456789012
Log flushed up to            3456789000
Added dirty pages up to      3456789012
Pages flushed up to          3456780000
Last checkpoint at           3456770000
```

            

这些 LSN 值的含义：
            
```
InnoDB LSN 层次：

  Log sequence number     当前最新的 LSN（Log Buffer 中）
         ↓
  Log flushed up to       已经 fsync 到磁盘的 LSN
         ↓
  Pages flushed up to     对应脏页已刷盘的最大 LSN
         ↓
  Last checkpoint at      最近检查点的 LSN

  恢复时需要 Redo 的日志范围：
  [Last checkpoint at, Log flushed up to]
```

            

### 9.4
            双写缓冲区（Doublewrite Buffer）

            

双写缓冲区是 InnoDB 解决撕裂页问题的方案：
            
```
双写缓冲区机制：

普通刷盘（有撕裂风险）：
  Buffer Pool 脏页 ──→ 数据文件中的目标位置
                         ↑ 断电导致撕裂

双写缓冲区刷盘（安全）：
  Buffer Pool 脏页
       │
       ├─→ 1. 写入 Doublewrite Buffer（系统表空间中的连续区域）
       │      fsync()
       │
       └─→ 2. 写入数据文件中的实际位置
              fsync()

恢复时的处理：
  a) 读取数据页，检查 checksum
  b) 如果 checksum 正确 → 页面完整，正常恢复
  c) 如果 checksum 错误 → 页面撕裂
     → 从 Doublewrite Buffer 中读取该页面的完整副本
     → 用完整副本覆盖损坏的页面
     → 然后继续正常的 Redo 恢复
```

            

双写缓冲区的写入是**顺序的**（连续磁盘区域），所以额外的
            I/O 开销相对有限。在支持原子写入的存储设备（如某些企业级 SSD
            或使用 `O_ATOMIC`
            的文件系统）上，可以关闭双写缓冲区以提升性能：
            
```
-- 关闭双写缓冲区（仅在存储层保证原子写入时）
SET GLOBAL innodb_doublewrite = OFF;
```

            

### 9.5 InnoDB 崩溃恢复流程

            

InnoDB 的崩溃恢复在 `mysqld`
            启动时自动执行：
            
```
InnoDB 崩溃恢复流程：

1. 读取 Redo Log 文件头部，找到 checkpoint LSN
   ┌─────────────────────────────────────┐
   │  读取 ib_logfile0 的头部            │
   │  获取 checkpoint_1 和 checkpoint_2  │
   │  选择 LSN 较大（较新）的那个         │
   └─────────────────────────────────────┘

2. 从 checkpoint LSN 开始扫描 Redo Log
   ┌─────────────────────────────────────┐
   │  正向扫描，解析每条 Redo 记录       │
   │  按 space_id + page_no 分组         │
   │  构建需要恢复的页面集合              │
   └─────────────────────────────────────┘

3. 应用 Redo Log（对应 ARIES 的 Redo 阶段）
   ┌─────────────────────────────────────┐
   │  对每个需要恢复的页面：              │
   │  a) 从磁盘读取页面                  │
   │  b) 检查 checksum，如失败则从        │
   │     Doublewrite Buffer 恢复         │
   │  c) 比较 page_lsn 和 record_lsn     │
   │  d) 如果需要，应用 Redo 记录        │
   └─────────────────────────────────────┘

4. 回滚未提交事务（对应 ARIES 的 Undo 阶段）
   ┌─────────────────────────────────────┐
   │  打开 Undo Tablespace               │
   │  找到所有活跃事务的 Undo 记录        │
   │  逆序应用 Undo 记录                  │
   │  标记事务为已回滚                    │
   │                                     │
   │  注意：InnoDB 可以先完成 Redo，      │
   │  然后在后台线程中异步执行 Undo，     │
   │  让数据库尽快对外提供服务            │
   └─────────────────────────────────────┘

5. 清理与初始化
   ┌─────────────────────────────────────┐
   │  推进 checkpoint                    │
   │  启动 Purge 线程清理旧版本          │
   │  数据库就绪，接受连接               │
   └─────────────────────────────────────┘
```

            

### 9.6 InnoDB Redo Log
            记录类型

            

InnoDB 定义了大量的 Redo Log 记录类型（MySQL 8.0 中超过
            60 种），以下是最常见的几类：
            
```
// InnoDB Redo Log 记录类型（storage/innobase/include/mtr0types.h）
// 以下为部分常见类型

#define MLOG_1BYTE             1   // 写入 1 字节
#define MLOG_2BYTES            2   // 写入 2 字节
#define MLOG_4BYTES            4   // 写入 4 字节
#define MLOG_8BYTES            8   // 写入 8 字节
#define MLOG_WRITE_STRING      30  // 写入任意长度字符串

#define MLOG_REC_INSERT        9   // 插入紧凑格式记录
#define MLOG_REC_UPDATE        14  // 原地更新记录

#define MLOG_UNDO_INSERT       11  // 插入 Undo 记录
#define MLOG_UNDO_INIT         19  // 初始化 Undo 页

#define MLOG_PAGE_CREATE       16  // 创建新页
#define MLOG_INIT_FILE_PAGE    24  // 初始化数据文件页

#define MLOG_COMP_REC_INSERT   38  // 紧凑行格式的插入
#define MLOG_COMP_REC_DELETE   42  // 紧凑行格式的删除
```

            

每种类型都对应着不同的页面修改操作。Redo 恢复时，InnoDB
            根据类型码分发到对应的重做函数。
            

### 9.7 后台 Undo 回滚

            

InnoDB 的一个重要优化是：**Undo
            阶段可以在后台执行**。Redo
            阶段完成后，数据库就可以接受新的连接和查询——未提交事务的回滚在后台线程中进行。
            

这一优化的可行性源于 InnoDB 的 MVCC
            机制：未提交事务的修改对新事务不可见（通过 Undo Log
            中的旧版本提供一致性读），所以即使回滚尚未完成，数据库对外也是一致的。
            
```
-- 查看后台 Undo 回滚进度
SHOW ENGINE INNODB STATUS\G

-- 在 TRANSACTIONS 部分会显示：
-- Trx id counter: 12345
-- ...
-- History list length: 1000
-- ...
-- ---TRANSACTION 12340, ACTIVE 5 sec recovering
-- ...rolling back table `mydb`.`orders`...
-- 0 rows undo'd
```

            
            

## 十、WAL 写放大与优化

            

### 10.1 WAL 的写放大问题

            

WAL
            本身引入了额外的写入量：每次数据修改都需要先写日志，然后在某个时刻再写数据页。加上检查点和
            Undo Log，实际的写放大（Write
            Amplification）可能相当可观：
            
```
一次 UPDATE 操作的写入量分析：

用户操作：UPDATE t SET val = 'new' WHERE id = 1;
修改数据量：~100 字节

实际写入磁盘的数据：
  1. Redo Log 记录          ~200 字节
  2. Undo Log 记录          ~150 字节
  3. Undo 页的 Redo 记录     ~100 字节
  4. 最终的数据页刷盘        16,384 字节（整个 16 KB 页）
  5. Doublewrite Buffer     16,384 字节（页面的副本）

总写入量：~33 KB
修改数据量：~100 字节
写放大倍数：~330x

注意：数据页刷盘和 Doublewrite 是延迟批量操作，
     同一页面的多次修改可以合并为一次刷盘，
     实际的摊销写放大远低于上述最坏情况。
```

            

### 10.2 组提交（Group Commit）

            

组提交是减少 WAL `fsync`
            开销的最有效手段。核心思想：将多个并发事务的日志合并为一次
            `fsync`：
            
```
无组提交（每个事务独立 fsync）：

  T1: write log ─→ fsync ─→ 返回
  T2:              write log ─→ fsync ─→ 返回
  T3:                           write log ─→ fsync ─→ 返回

  3 个事务 = 3 次 fsync（每次 ~1-10ms）

有组提交（合并 fsync）：

  T1: write log ──┐
  T2: write log ──┼─→ 一次 fsync ─→ 全部返回
  T3: write log ──┘

  3 个事务 = 1 次 fsync
```

            

InnoDB 的组提交实现：
            
```
InnoDB Group Commit 流程（MySQL 8.0）：

三阶段提交（与 Binlog 配合）：

1. Flush 阶段
   ┌───────────────────────────────────────┐
   │  Leader 线程收集队列中所有等待的事务  │
   │  将它们的 Redo Log 从 Log Buffer      │
   │  写入（write）到日志文件              │
   └───────────────────────────────────────┘

2. Sync 阶段
   ┌───────────────────────────────────────┐
   │  对日志文件执行一次 fsync             │
   │  一次 fsync 覆盖所有收集到的事务      │
   └───────────────────────────────────────┘

3. Commit 阶段
   ┌───────────────────────────────────────┐
   │  更新事务状态为已提交                 │
   │  释放锁，通知所有等待的线程           │
   └───────────────────────────────────────┘

关键配置：
  innodb_flush_log_at_trx_commit = 1  -- 每次提交都 fsync（最安全）
  innodb_flush_log_at_trx_commit = 2  -- 每次提交 write，每秒 fsync
  innodb_flush_log_at_trx_commit = 0  -- 每秒 write + fsync（最快但风险最高）
```

            
```
-- 查看组提交相关配置
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';
-- 值为 1（默认，最安全）

-- 在主从复制场景中，binlog 的组提交配置：
SHOW VARIABLES LIKE 'binlog_group_commit%';
-- binlog_group_commit_sync_delay = 0       (微秒)
-- binlog_group_commit_sync_no_delay_count = 0
```

            

### 10.3 日志压缩

            

对于写入密集的工作负载，WAL
            的大小可能成为瓶颈。日志压缩可以减少日志量：
            
```
日志压缩策略：

1. 页面压缩（MySQL 8.0.30+）
   InnoDB 可以在写入 Redo Log 前对日志记录进行压缩
   压缩算法：zlib
   适用场景：大量 BLOB/TEXT 类型的更新

2. 逻辑压缩
   将多条对同一页面的 Redo 记录合并为一条
   例如：同一事务对同一行的多次更新 → 只保留最终状态

3. 差量编码
   对 before-image 和 after-image 只记录差异部分
   而非完整的数据值
   节省空间的效果取决于修改的数据类型
```

            

### 10.4 并行恢复（Parallel
            Recovery）

            

传统的 ARIES
            恢复是单线程的，对于大型数据库，恢复时间可能很长。现代实现引入了并行恢复：
            
```
并行恢复策略：

1. 按页面分区并行 Redo（InnoDB 的方式）
   ┌──────────────────────────────────────────────┐
   │  扫描 Redo Log，按 (space_id, page_no)        │
   │  将记录分配到不同的工作线程                    │
   │                                               │
   │  Thread 1: Page_1, Page_5, Page_9, ...        │
   │  Thread 2: Page_2, Page_6, Page_10, ...       │
   │  Thread 3: Page_3, Page_7, Page_11, ...       │
   │  Thread 4: Page_4, Page_8, Page_12, ...       │
   │                                               │
   │  约束：同一页面的所有 Redo 记录必须由           │
   │       同一线程按 LSN 顺序处理                  │
   └──────────────────────────────────────────────┘

2. 分阶段并行
   ┌──────────────────────────────────────────────┐
   │  Analysis 阶段：单线程（通常很快）             │
   │  Redo 阶段：多线程并行                        │
   │  Undo 阶段：多事务并行                        │
   └──────────────────────────────────────────────┘
```

            

InnoDB 在 MySQL 8.0 中的并行恢复支持：
            
```
-- 查看并行恢复相关配置
SHOW VARIABLES LIKE 'innodb_recovery_parallelism';
-- 默认值：1（单线程）
-- MySQL 8.0.30+ 支持多线程 Redo 扫描和应用
```

            

### 10.5 其他优化手段

            

除了上述主要优化外，还有一些值得关注的技术：
            

**异步 I/O**
            
```
InnoDB 使用 Linux 原生异步 I/O（libaio）来加速页面读写：

  innodb_use_native_aio = ON   （默认开启）

  恢复时的页面读取可以并发进行：
  多个 Redo 记录涉及不同页面 → 并发提交读 I/O → 批量等待完成
```

            

**自适应检查点**
            
```
InnoDB 的自适应检查点策略：

  1. 监控 Redo Log 的使用率
  2. 当使用率达到 75%，开始加速刷脏页
  3. 当使用率达到接近 100%，进入「同步刷盘」模式
     （所有事务阻塞直到腾出日志空间）

  目标：避免日志空间耗尽，同时最小化正常运行时的刷盘开销

  相关参数：
  innodb_io_capacity       = 200    （正常刷盘 IOPS 上限）
  innodb_io_capacity_max   = 2000   （紧急刷盘 IOPS 上限）
  innodb_max_dirty_pages_pct = 90   （脏页比例上限）
```

            

**WAL 预分配**
            
```
预分配日志文件空间可以避免文件系统元数据更新带来的额外 fsync：

  InnoDB 在启动时就预分配固定大小的 Redo Log 文件。
  日志写入只是覆盖已有空间，不涉及文件扩展。

  对比：
  - 动态扩展的日志文件：write → extend file → fsync metadata → fsync data
  - 预分配的日志文件：write → fsync data（省去了元数据更新）
```

            
            

## 十一、开放问题

            
            
- 

**ARIES 三阶段框架与 MVCC
            引擎的边界在哪里？** PostgreSQL 证明了「仅 REDO +
            事务状态位 + 多版本读」可以支撑生产负载，但长事务
            abort、逻辑复制与备库延迟场景下，缺 explicit Undo
            链是否增加运维复杂度？InnoDB 的独立 Undo + 异步回滚是更贴近
            ARIES 的折中，还是必要设计——目前缺少在**同
            workload** 下可比的公开故障语义研究。
            
- 

**并行恢复的上限由什么决定？** InnoDB
            8.0.30+ 支持多线程 Redo 应用，约束是「同一页面的 Redo 必须按
            LSN
            顺序由同一线程处理」。当单页热点（索引根页、元数据页）集中时，并行度收益可能迅速衰减——这与
            ARIES 论文时代「单线程 Redo
            足够」的假设是否仍成立，取决于硬件并行 I/O 与 workload
            skew，而非单条经验法则。
            
- 

**字节可寻址持久内存（NVM）会否改变 WAL
            形态？** Mohan（VLDB 1999）已讨论超越经典 ARIES
            的方向；若数据页与日志可在同一持久域按 cache line
            原子更新，Force/Steal 组合与 checkpoint
            语义可能需要重新定义——这是研究愿景与生产部署之间的长期间隙。
            
            
            

## 参考文献

            

### 论文

            
            
- 

C. Mohan, D. Haderle, B. Lindsay, H. Pirahesh, P.
            Schwarz. “ARIES: A Transaction Recovery Method Supporting
            Fine-Granularity Locking and Partial Rollbacks Using
            Write-Ahead Logging.” *ACM Transactions on Database
            Systems*, 17(1):94-162, March 1992.
            
- 

C. Mohan, F. Levine. “ARIES/IM: An Efficient and High
            Concurrency Index Management Method Using Write-Ahead
            Logging.” *Proceedings of SIGMOD*, 1992.
            
- 

C. Mohan. “Repeating History Beyond ARIES.”
            *Proceedings of VLDB*, 1999.
            
            

### 规范与设计文档

            
            
- 

PostgreSQL Documentation, Chapter 30: *Reliability
            and the Write-Ahead Log* — WAL
            配置、checkpoint、崩溃恢复语义。
            
- 

MySQL Reference Manual 8.0 — InnoDB
            Recovery、InnoDB
            Redo Log、InnoDB
            Doublewrite Buffer。
            
            

### 源码

            
            
- 

PostgreSQL
            17：`src/backend/access/transam/xlog.c`（`StartupXLOG()`、`CreateCheckPoint()`）；`src/include/access/xlogrecord.h`（`XLogRecord`、`pd_lsn`）。
            
- 

MySQL/InnoDB
            8.0：`storage/innobase/log/log0recv.cc`（崩溃恢复入口）；`storage/innobase/include/mtr0types.h`（Redo
            记录类型）；`storage/innobase/trx/trx0undo.cc`（Undo
            段管理）。
            
            

### 系列内对照阅读

            
            
- 

PG
            WAL 内部机制：从事务提交到磁盘刷写 —
            XLogInsert、checkpoint 两阶段、REDO 幂等。
            
- 

InnoDB
            Redo Log 内部机制 — LSN 层次、mtr、组提交。
            
- 

InnoDB
            Undo Log 与事务回滚 — Undo 段、Purge、长事务 history
            list。
            
            
            

**上一篇**: Buffer
            Pool：数据库的内存管理 **下一篇**: 事务隔离级别的存储实现
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-10-15 · storage
                    

### 【存储工程】写入性能优化

                    

深入分析存储写入性能优化——WAL 分组提交、批量写入、Write Buffer 调优、fsync 频率控制、写入限速与写停顿分析
                

                
                    

2025-09-09 · storage
                    

### 【存储工程】LSM-Tree 工程调优：三种放大的权衡

                    

LSM-Tree 的核心设计是把随机写转换为顺序写，但这个转换不是免费的。写入经过 MemTable 刷盘、再经过多次 Compaction 合并，每一字节的用户数据在磁盘上可能被反复读写数十次。读取一个 key 时，最坏情况下需要逐层搜索，直到命中或遍历全部层级。与此同时，旧版本数据和墓碑标记占用的额外空间，在 Co…
                

                
                    

2025-08-21 · storage
                    

### 【存储工程】数据完整性：从 fsync 到端到端校验

                    

数据丢失最令人恐惧的形式不是磁盘报错——而是数据悄无声息地变了，没有任何告警，没有任何日志，直到几个月后你从备份里恢复出一堆损坏的文件，才发现"完整性"这个词从来就不是理所当然的。
                

                
                    

2025-08-19 · storage
                    

### 【存储工程】Direct I/O 与 O_DIRECT：绕过缓存的得与失

                    

在 Linux 的传统 I/O 路径中，应用程序通过 read() 和 write() 系统调用与文件交互时，数据并不会直接在用户空间缓冲区（User Buffer）和磁盘之间传输。内核会在两者之间插入一层页缓存（Page Cache），作为磁盘数据在内存中的缓存副本。一次典型的写入流程如下：