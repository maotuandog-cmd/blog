# 【存储工程】事务隔离级别的存储实现

来源: https://quant67.com/post/storage/28-transaction-isolation/transaction-isolation.html
日期: 2025-09-06 |

---

数据库事务的四大特性 ACID
            中，隔离性（Isolation）是最复杂的一项。原子性靠 WAL
            保证（参见 [WAL
            与崩溃恢复](../27-wal-aries/wal-aries.html)），持久性靠 fsync
            落盘，一致性是应用层语义——唯独隔离性，需要存储引擎在并发控制层面做出大量取舍。SQL
            标准定义了四个隔离级别，但标准本身只描述了”禁止哪些异常现象”，没有规定实现方式。现实中，不同数据库选择了截然不同的技术路线：Oracle
            和 PostgreSQL 走多版本并发控制（MVCC）路线，早期 DB2 和 SQL
            Server 走锁（Locking）路线，TiDB 走分布式 MVCC
            路线。同一个隔离级别在不同数据库中的实际行为可能完全不同——MySQL
            的可重复读（Repeatable Read）能防止幻读，而 SQL
            标准的可重复读允许幻读；PostgreSQL
            的可序列化（Serializable）基于 SSI 算法，而 MySQL
            的可序列化基于锁。
            

本文从隔离级别的定义与异常现象出发，逐一拆解两阶段锁（2PL）、MVCC、SSI、Percolator
            四种主流实现路线，深入 PostgreSQL 和 MySQL InnoDB
            的源码级实现细节，用可复现的 SQL
            示例演示各级别下的异常行为，最后给出面向不同负载的隔离级别选择建议。关于
            MVCC 的基础理论，可参阅 MVCC 原理详解。
            
            

## 一、事务隔离级别回顾

            

### 1.1 ACID 中的隔离性

            

事务（Transaction）是数据库操作的逻辑单元。ACID
            四大特性中：
            
            
- **原子性（Atomicity）**：事务中的操作要么全部成功，要么全部回滚；
            
- **一致性（Consistency）**：事务执行前后，数据库从一个一致状态迁移到另一个一致状态；
            
- **隔离性（Isolation）**：并发事务之间互不干扰，每个事务看到的数据就像自己独占数据库一样；
            
- **持久性（Durability）**：事务提交后，其修改永久生效，即使系统崩溃也不丢失。
            
            

隔离性的最严格定义是可序列化（Serializability）：并发事务的执行效果等价于某种串行执行顺序。但完全的可序列化代价太高——所有读写都要加锁、排队——因此
            SQL
            标准（SQL-92）定义了四个隔离级别，允许在性能与正确性之间做取舍。
            

### 1.2 SQL
            标准的四个隔离级别

            

SQL-92 标准通过”禁止哪些异常现象”来定义隔离级别：
            
            
            
            
            
            
            
            
            
            隔离级别
            脏读（Dirty Read）
            不可重复读（Non-Repeatable Read）
            幻读（Phantom Read）
            
            
            
            
            读未提交（Read Uncommitted）
            允许
            允许
            允许
            
            
            读已提交（Read Committed）
            禁止
            允许
            允许
            
            
            可重复读（Repeatable Read）
            禁止
            禁止
            允许
            
            
            可序列化（Serializable）
            禁止
            禁止
            禁止
            
            
            
            

这个表格是教科书的经典总结，但存在一个根本性缺陷：它只列举了三种异常，实际上还有更多异常（如写偏斜）不在标准范围内。这意味着即使满足
            SQL 标准的可重复读，仍然可能出现某些非序列化的异常行为。
            

### 1.3 异常现象详解

            

**脏读（Dirty Read）**：事务 T1
            修改了一行数据但尚未提交，事务 T2
            读到了这个未提交的修改。如果 T1 随后回滚，T2
            读到的就是一条从未在数据库中”正式存在”过的数据。
            
```
-- 脏读示例
-- T1                              -- T2
BEGIN;
UPDATE accounts
  SET balance = balance - 100
  WHERE id = 1;
                                   BEGIN;
                                   SELECT balance FROM accounts
                                     WHERE id = 1;
                                   -- 读到 T1 未提交的修改值
ROLLBACK;
                                   -- T2 基于错误数据做决策
                                   COMMIT;
```

            

**不可重复读（Non-Repeatable Read）**：事务
            T1 在同一事务内两次读取同一行数据，得到不同的值。原因是 T2
            在 T1 的两次读取之间修改并提交了该行。
            
```
-- 不可重复读示例
-- T1                              -- T2
BEGIN;
SELECT balance FROM accounts
  WHERE id = 1;
-- 返回 1000
                                   BEGIN;
                                   UPDATE accounts
                                     SET balance = 900
                                     WHERE id = 1;
                                   COMMIT;
SELECT balance FROM accounts
  WHERE id = 1;
-- 返回 900（同一事务内两次读取结果不同）
COMMIT;
```

            

**幻读（Phantom Read）**：事务 T1
            按某个条件查询得到一组行，事务 T2
            插入或删除了满足该条件的行并提交，T1
            再次按同一条件查询，得到了不同的行集合。幻读的关键在于它涉及的是行集合的变化，而非单行数据的变化。
            
```
-- 幻读示例
-- T1                              -- T2
BEGIN;
SELECT * FROM orders
  WHERE amount > 1000;
-- 返回 3 行
                                   BEGIN;
                                   INSERT INTO orders (id, amount)
                                     VALUES (99, 1500);
                                   COMMIT;
SELECT * FROM orders
  WHERE amount > 1000;
-- 返回 4 行（多了一条幻影行）
COMMIT;
```

            

**写偏斜（Write Skew）**：这是 SQL
            标准未涵盖但在实践中极其重要的一种异常。两个事务各自读取了一组重叠的数据，然后基于各自读到的数据做出了不冲突的写操作，但两个写操作组合后违反了某个约束条件。
            
```
-- 写偏斜示例：医院值班系统要求至少一人在岗
-- T1                              -- T2
BEGIN;                             BEGIN;
SELECT count(*) FROM on_call
  WHERE shift = 'night';
-- 返回 2（Alice 和 Bob）
                                   SELECT count(*) FROM on_call
                                     WHERE shift = 'night';
                                   -- 返回 2（Alice 和 Bob）
-- 觉得还有 Bob 在，可以下班
UPDATE on_call
  SET status = 'off'
  WHERE name = 'Alice'
  AND shift = 'night';
                                   -- 觉得还有 Alice 在，可以下班
                                   UPDATE on_call
                                     SET status = 'off'
                                     WHERE name = 'Bob'
                                     AND shift = 'night';
COMMIT;                            COMMIT;
-- 结果：夜班无人值守！
```

            

### 1.4 Berenson 等人的批判

            

1995 年，Jim Gray 等人发表了经典论文”A Critique of ANSI
            SQL Isolation Levels”，指出 SQL
            标准的隔离级别定义存在严重不足：
            
            
- 标准基于锁模型定义异常，无法准确描述 MVCC
            系统的行为；
            
- 遗漏了多种异常现象，包括丢失更新（Lost
            Update）、读偏斜（Read Skew）和写偏斜（Write Skew）；
            
- 对幻读的定义过于狭窄，仅考虑了 INSERT
            导致的幻影行，未考虑 UPDATE 和 DELETE。
            
            

该论文重新定义了基于现象（Phenomenon）的隔离级别体系，成为后续理论研究的基础。Adya
            在 1999
            年的博士论文中进一步将隔离级别形式化为基于依赖图（Dependency
            Graph）的定义，建立了更严格的理论框架。
            
            

## 二、锁式隔离：两阶段锁（2PL）

            

### 2.1 锁的基本类型

            

在基于锁的并发控制中，数据库使用两种基本锁类型：
            
            
- **共享锁（Shared Lock，S
            锁）**：也称读锁。多个事务可以同时持有同一数据对象的
            S 锁；
            
- **排他锁（Exclusive Lock，X
            锁）**：也称写锁。一个事务持有 X
            锁时，其他事务不能获取该数据对象的任何锁。
            
            

锁的兼容矩阵如下：
            
            
            
            
            请求 S 锁
            请求 X 锁
            
            
            
            
            已持有 S 锁
            兼容
            冲突
            
            
            已持有 X 锁
            冲突
            冲突
            
            
            
            

除了行级锁，数据库还需要意向锁（Intention
            Lock）来支持多粒度锁定（Multiple Granularity
            Locking）。意向锁是加在表级或页级的锁，表示事务打算在更细粒度上获取锁：
            
            
- **意向共享锁（IS）**：事务打算对表中某些行加
            S 锁；
            
- **意向排他锁（IX）**：事务打算对表中某些行加
            X 锁。
            
            
```
多粒度锁的层次结构：

    Database
       |
    Table（IS / IX / S / X）
       |
    Page（IS / IX / S / X）
       |
    Row（S / X）
```

            

### 2.2 两阶段锁协议

            

两阶段锁（Two-Phase
            Locking，2PL）协议是保证可序列化的经典方法。协议要求每个事务的锁操作分为两个阶段：
            
            
- **增长阶段（Growing
            Phase）**：事务只能获取锁，不能释放锁；
            
- **收缩阶段（Shrinking
            Phase）**：事务只能释放锁，不能获取新锁。
            
            
```
事务生命周期中的锁数量变化：

锁数量
  ^
  |        /\
  |       /  \
  |      /    \
  |     /      \
  |    /        \
  |   /          \
  |  /            \
  | /              \
  +---+------+------+---> 时间
      增长阶段  收缩阶段
         ↑
      锁点（Lock Point）
```

            

锁点（Lock Point）是事务获取到最后一把锁的时刻。2PL
            保证了可序列化性：所有事务按其锁点排序，就是一个合法的串行执行顺序。
            

### 2.3 严格两阶段锁（Strict
            2PL）

            

基本 2PL
            有一个问题：事务可能在提交前释放锁，导致级联回滚（Cascading
            Abort）。为了避免这个问题，实际系统使用严格两阶段锁（Strict
            2PL）：
            
            
- **严格 2PL（Strict
            2PL）**：所有排他锁必须在事务提交或回滚后才释放；
            
- **强严格 2PL（Strong Strict
            2PL，SS2PL）**：所有锁（包括共享锁和排他锁）都必须在事务提交或回滚后才释放。
            
            
```
严格 2PL 的锁生命周期：

锁数量
  ^
  |      ___________
  |     /           |
  |    /            |
  |   /             |
  |  /              |
  | /               |
  +---+--------+----+---> 时间
      增长阶段   COMMIT/ROLLBACK
                 所有锁一次性释放
```

            

SS2PL
            是目前大多数基于锁的数据库系统采用的协议。它不仅保证可序列化，还避免了级联回滚，并且使得恢复处理更加简单。
            

### 2.4 2PL
            如何实现各隔离级别

            

通过调整锁的获取和释放策略，2PL
            可以实现不同的隔离级别：
            
            
            
            隔离级别
            读锁策略
            写锁策略
            
            
            
            
            读未提交（Read Uncommitted）
            不加读锁
            长写锁（持有到事务结束）
            
            
            读已提交（Read Committed）
            短读锁（读完立即释放）
            长写锁
            
            
            可重复读（Repeatable Read）
            长读锁（持有到事务结束）
            长写锁
            
            
            可序列化（Serializable）
            长读锁 + 谓词锁
            长写锁
            
            
            
            

谓词锁（Predicate
            Lock）是防止幻读的关键。它锁定的不是具体的行，而是满足某个查询条件的所有行——包括当前不存在但未来可能插入的行。由于谓词锁的实现代价很高，实践中通常使用索引区间锁（Index-Range
            Lock）或间隙锁（Gap Lock）来近似实现。
            

### 2.5 死锁检测与处理

            

2PL
            的一个固有问题是死锁（Deadlock）：两个或多个事务相互等待对方释放锁，形成循环等待。
            
```
死锁示例：

T1: LOCK(A) → 等待 LOCK(B)
                    ↑
                    |
T2: LOCK(B) → 等待 LOCK(A)
```

            

数据库处理死锁的方式有两种：
            

**死锁预防（Deadlock
            Prevention）**：在事务请求锁之前，判断是否可能导致死锁。常见策略包括：
            
            
- **Wait-Die**：老事务等待年轻事务释放锁，年轻事务请求老事务的锁时直接回滚（死亡）；
            
- **Wound-Wait**：老事务强制回滚持有锁的年轻事务（伤害），年轻事务等待老事务释放锁。
            
            

**死锁检测（Deadlock
            Detection）**：允许死锁发生，但定期检测并打破死锁。数据库维护一个等待图（Wait-for
            Graph），如果检测到环路，就选择一个代价最小的事务作为牺牲者（Victim）回滚。
            
```
等待图（Wait-for Graph）：

T1 --等待--> T2 --等待--> T3
                          |
                          |等待
                          v
                         T1   ← 检测到环路！回滚代价最小的事务
```

            

死锁检测的频率是一个权衡：检测太频繁浪费
            CPU，检测太慢则死锁持续时间长。MySQL InnoDB
            默认在每次锁等待时立即进行死锁检测（即被动触发，而非周期性扫描），PostgreSQL
            在等待超时后进行检测。
            

### 2.6 2PL 的性能问题

            

2PL 的主要问题在于：
            
            
- **读写冲突**：读操作需要加 S
            锁，写操作需要加 X 锁，读写之间互相阻塞。在读多写少的 OLTP
            场景下，大量读事务被少量写事务阻塞，严重降低吞吐量；
            
- **锁开销**：每个锁占用内存，锁管理器需要维护哈希表，锁的获取和释放需要原子操作或互斥锁保护，在高并发下成为瓶颈；
            
- **死锁**：2PL
            无法避免死锁，死锁检测和事务回滚都有代价。
            
            

正是这些问题推动了 MVCC
            技术的发展——通过维护数据的多个版本，让读操作不需要加锁，从而避免读写冲突。
            
            

## 三、MVCC 基础

            

### 3.1 核心思想

            

多版本并发控制（Multi-Version Concurrency
            Control，MVCC）的核心思想极其简洁：每次修改数据时，不是就地覆盖旧值，而是创建一个新版本。读操作根据事务的时间点选择可见的版本，写操作创建新版本。读和写操作之间不再需要互相等待。
            
```
MVCC 版本链示例：

行 key = 1 的版本链：

  版本 3（最新）   版本 2           版本 1（最旧）
  +----------+    +----------+    +----------+
  | value: C |    | value: B |    | value: A |
  | txn: 300 |--->| txn: 200 |--->| txn: 100 |
  | ts: t3   |    | ts: t2   |    | ts: t1   |
  +----------+    +----------+    +----------+

事务 250 启动时的快照读：
  → 选择版本 2（txn 200  250，或未提交）
```

            

MVCC 有几个关键的设计决策：
            
            
- **版本存储方式**：旧版本存在哪里——原地存储（如
            PostgreSQL 的堆表）还是独立的版本存储区（如 MySQL InnoDB 的
            undo log）；
            
- **版本可见性判断**：如何快速判断一个版本对当前事务是否可见；
            
- **版本回收**：旧版本何时可以安全删除，如何高效回收。
            
            

### 3.2 快照读与当前读

            

MVCC 系统中有两类读操作：
            
            
- **快照读（Snapshot
            Read）**：读取事务启动时（或语句开始时）的数据快照。不加锁，不阻塞写操作。普通的
            `SELECT` 语句就是快照读；
            
- **当前读（Current
            Read）**：读取数据的最新已提交版本，并对读取的数据加锁。`SELECT ... FOR UPDATE`、`SELECT ... FOR SHARE`、`UPDATE`、`DELETE`
            等语句会触发当前读。
            
            
```
-- 快照读：不加锁，读取快照版本
SELECT * FROM accounts WHERE id = 1;

-- 当前读：加锁，读取最新版本
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;

-- 当前读：UPDATE 语句隐含当前读
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
```

            

快照读与当前读的区分是 MVCC
            系统实现不同隔离级别的关键。在读已提交级别下，每条语句都创建一个新快照；在可重复读级别下，整个事务使用同一个快照。
            

### 3.3 读写不阻塞的本质

            

传统锁机制下，读操作需要加 S 锁，写操作需要加 X 锁，S
            锁和 X 锁互斥，因此读写相互阻塞。MVCC 下：
            
            
- 读操作读取旧版本，不需要加锁；
            
- 写操作创建新版本，不影响旧版本的可见性；
            
- 写和写之间仍然需要互斥（通常通过行锁实现）。
            
            

这就是 MVCC
            的核心优势：“读不阻塞写，写不阻塞读”。但要注意，**写和写之间仍然需要互斥**——两个事务同时修改同一行数据时，只有一个能成功，另一个必须等待或回滚。
            

### 3.4 版本回收的必要性

            

MVCC
            不断创建新版本，如果不回收旧版本，数据库会膨胀到不可接受的程度。版本回收的条件是：当一个旧版本不再被任何活跃事务需要时，就可以安全删除。这需要跟踪所有活跃事务中最老的快照时间点。
            

在 PostgreSQL 中，版本回收由 VACUUM 进程负责；在 MySQL
            InnoDB 中，由 purge 线程负责清理 undo log
            中的旧版本。版本回收不及时会导致：
            
            
- 磁盘空间膨胀（PostgreSQL 的表膨胀问题尤为突出）；
            
- 查询性能下降（需要遍历更长的版本链）；
            
- 事务 ID 耗尽（PostgreSQL 的 32 位事务 ID
            回卷问题）。
            
            
            

## 四、PostgreSQL MVCC
            实现

            

### 4.1 堆元组的版本标记

            

PostgreSQL 的 MVCC
            实现最大的特点是：所有版本都存储在堆表（Heap
            Table）中。每个堆元组（Heap Tuple）包含以下与 MVCC
            相关的系统字段：
            
            
- **xmin**：创建该元组的事务 ID。INSERT
            操作设置 xmin；
            
- **xmax**：删除或锁定该元组的事务 ID。DELETE
            操作设置 xmax，UPDATE 操作在旧元组上设置 xmax
            并创建新元组；
            
- **cmin /
            cmax**：事务内的命令序号，用于处理同一事务内多条语句的可见性；
            
- **ctid**：指向该元组最新版本的物理位置（行指针）。
            
            
```
PostgreSQL 堆表中的版本链（UPDATE 操作后）：

Page N:                         Page M:
+------------------+            +------------------+
| Tuple (旧版本)    |            | Tuple (新版本)    |
| xmin = 100       |  ctid 指向  | xmin = 200       |
| xmax = 200       | ---------> | xmax = 0         |
| data = 'old'     |            | data = 'new'     |
+------------------+            +------------------+
```

            

注意一个关键设计选择：PostgreSQL 的 UPDATE
            不是就地修改，而是”标记旧版本为删除 +
            插入新版本”。这意味着一次 UPDATE
            会在堆表中留下两个元组——旧元组的 xmax 被设置为更新事务的
            ID，新元组的 xmin 被设置为更新事务的 ID。
            

### 4.2 可见性判断规则

            

PostgreSQL 判断一个元组对事务 T
            是否可见的核心规则如下：
            
```
可见性判断逻辑（简化版）：

1. 如果 xmin 对应的事务未提交且不是当前事务 → 不可见
2. 如果 xmin 对应的事务已回滚 → 不可见
3. 如果 xmin 对应的事务已提交（或是当前事务）：
   a. 如果 xmax 为空（未被删除） → 可见
   b. 如果 xmax 对应的事务未提交 → 可见（删除尚未生效）
   c. 如果 xmax 对应的事务已回滚 → 可见（删除被取消）
   d. 如果 xmax 对应的事务已提交 → 不可见（已被删除）
```

            

在可重复读和可序列化级别下，还需要额外检查事务的快照（Snapshot）。快照由三部分组成：
            
            
- **xmin**：快照创建时最小的活跃事务 ID。小于
            xmin 的事务必然已经完成（提交或回滚）；
            
- **xmax**：快照创建时下一个将要分配的事务
            ID。大于等于 xmax 的事务在快照创建后才开始；
            
- **xip[]**：快照创建时所有活跃事务的 ID
            列表。
            
            
```
-- 查看当前快照
SELECT txid_current_snapshot();
-- 返回格式：xmin:xmax:xip_list
-- 例如：100:105:102,104
-- 含义：事务 100 之前的都已完成，
--       事务 105 及之后的还未开始，
--       事务 102 和 104 在快照创建时仍在进行中
```

            

### 4.3 Hint Bits 优化

            

每次判断可见性都要查询事务提交状态（存储在 CLOG / pg_xact
            中）非常昂贵。PostgreSQL 使用提示位（Hint
            Bits）来优化：当第一次判断某个元组的可见性时，将事务的提交/回滚状态写回元组头部的信息位中。后续判断可以直接读取提示位，避免查询
            CLOG。
            
```
元组头部的 Hint Bits：

t_infomask 字段中的关键标志位：
  HEAP_XMIN_COMMITTED  (0x0100)  -- xmin 事务已提交
  HEAP_XMIN_INVALID    (0x0200)  -- xmin 事务已回滚
  HEAP_XMAX_COMMITTED  (0x0400)  -- xmax 事务已提交
  HEAP_XMAX_INVALID    (0x0800)  -- xmax 事务已回滚
```

            

提示位的写入会导致页面变脏（Dirty
            Page），需要写回磁盘。这意味着即使是纯读操作，PostgreSQL
            也可能产生写 I/O——这是一个经常让 DBA 感到意外的行为。
            

### 4.4 可见性映射（Visibility
            Map）

            

可见性映射（Visibility
            Map，VM）是堆表的一个辅助文件，为堆表中的每个页面维护两个标志位：
            
            
- **all-visible**：页面中的所有元组对所有活跃事务都可见（无需逐元组判断）；
            
- **all-frozen**：页面中的所有元组都已冻结（不受事务
            ID 回卷影响）。
            
            
```
可见性映射结构：

堆表文件：  [Page 0] [Page 1] [Page 2] [Page 3] ...
VM 文件：    [ 1,0 ]  [ 0,0 ]  [ 1,1 ]  [ 1,0 ]  ...
              ↑               ↑
              all-visible      all-visible + all-frozen
```

            

VM 的主要用途：
            
            
- **仅索引扫描（Index-Only Scan）**：如果 VM
            标记某个页面为 all-visible，索引扫描就不需要回表（Heap
            Fetch），直接从索引中返回数据；
            
- **VACUUM 优化**：VACUUM 可以跳过
            all-visible 的页面，大幅减少扫描量。
            
            

### 4.5 VACUUM 机制

            

PostgreSQL 的 VACUUM
            负责回收旧版本占用的空间。有两种模式：
            

**普通 VACUUM（Lazy VACUUM）**：
            
            
- 扫描堆表页面，找到所有不再被任何活跃事务需要的死元组（Dead
            Tuple）；
            
- 将死元组标记为可复用空间，更新 Free Space
            Map（FSM）；
            
- 更新 VM 标志位；
            
- 截断文件末尾的全空页面（可选）。
            
            
```
-- 手动执行 VACUUM
VACUUM accounts;

-- VACUUM VERBOSE 显示详细信息
VACUUM VERBOSE accounts;

-- 查看表的死元组数量
SELECT relname, n_live_tup, n_dead_tup,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname = 'accounts';
```

            

**VACUUM
            FULL**：重写整个表，彻底消除空间碎片。但会锁住整个表，生产环境慎用。
            

**Autovacuum**：后台自动运行的 VACUUM
            进程。当死元组的比例超过阈值（默认 20%）时自动触发。
            
```
-- Autovacuum 关键参数
-- autovacuum_vacuum_threshold = 50        -- 最小死元组数
-- autovacuum_vacuum_scale_factor = 0.2    -- 死元组占比阈值
-- 触发条件：dead_tuples > threshold + scale_factor * n_live_tup
```

            

### 4.6 事务 ID 回卷问题

            

PostgreSQL 使用 32 位无符号整数作为事务
            ID（txid），最大值约为 42 亿。事务 ID 采用环形比较（Modular
            Arithmetic）：在环形空间中，“过去”的事务 ID 在当前 ID
            的前半圈（约 21 亿个），“未来”的事务 ID 在后半圈。
            
```
事务 ID 的环形空间：

              0
              |
     "未来"   |   "过去"
              |
  2^31 ------+------ 当前 txid
              |
     "未来"   |   "过去"
              |
           2^32
```

            

当事务 ID
            接近回卷点时，原本”过去”的事务会变成”未来”的事务，导致旧数据突然对所有事务不可见。为了防止这种灾难，PostgreSQL
            引入了冻结（Freeze）机制：
            
            
- VACUUM 在处理旧元组时，将其 xmin 替换为特殊的
            FrozenTransactionId（值为 2）；
            
- 冻结后的元组对所有事务永远可见，不受事务 ID
            回卷影响；
            
- 参数 `vacuum_freeze_min_age`
            控制元组存活多少个事务后被冻结（默认 5000 万）。
            
            
```
-- 查看各表的最大事务年龄
SELECT relname, age(relfrozenxid) AS xid_age
FROM pg_class
WHERE relkind = 'r'
ORDER BY xid_age DESC
LIMIT 10;

-- 强制冻结
VACUUM FREEZE accounts;
```

            

如果 `age(relfrozenxid)` 接近 20
            亿（`autovacuum_freeze_max_age`
            默认值），PostgreSQL
            会发出警告甚至进入只读模式以自我保护。这是 PostgreSQL
            运维中最常见的紧急事件之一。
            
            

## 五、MySQL InnoDB MVCC
            实现

            

### 5.1 Undo Log 版本链

            

与 PostgreSQL 不同，MySQL InnoDB 将旧版本存储在独立的
            undo log 中，而非堆表里。每行数据在聚簇索引（Clustered
            Index）中只保留最新版本，旧版本通过回滚段指针（Roll
            Pointer）链接到 undo log 中。
            
```
InnoDB 的版本链结构：

聚簇索引页：
+---------------------+
| 行记录 (最新版本)     |
| DB_TRX_ID = 300     |
| DB_ROLL_PTR --------|--+
+---------------------+  |
                          v
                    Undo Log:
                    +----------------+
                    | 旧版本数据       |
                    | DB_TRX_ID = 200 |
                    | DB_ROLL_PTR ----|--+
                    +----------------+  |
                                        v
                                  +----------------+
                                  | 更旧版本数据     |
                                  | DB_TRX_ID = 100 |
                                  | DB_ROLL_PTR = ∅ |
                                  +----------------+
```

            

每行记录包含三个隐藏字段：
            
            
- **DB_TRX_ID**（6 字节）：最后修改该行的事务
            ID；
            
- **DB_ROLL_PTR**（7 字节）：回滚段指针，指向
            undo log 中该行的上一个版本；
            
- **DB_ROW_ID**（6 字节）：行
            ID，当表没有显式主键时自动生成。
            
            

### 5.2 Read View 机制

            

InnoDB 使用读视图（Read
            View）来实现快照读的可见性判断。Read View
            在事务第一次执行快照读时创建（可重复读级别）或每条语句执行时创建（读已提交级别），包含以下信息：
            
            
- **m_ids**：创建 Read View 时所有活跃事务的
            ID 列表；
            
- **m_low_limit_id**：创建 Read View
            时下一个将要分配的事务 ID（即当前系统中最大事务 ID +
            1）；
            
- **m_up_limit_id**：创建 Read View
            时活跃事务中最小的事务 ID；
            
- **m_creator_trx_id**：创建该 Read View
            的事务自身的 ID。
            
            

可见性判断算法：
            
```
判断事务 trx_id 的修改对当前 Read View 是否可见：

1. 如果 trx_id == m_creator_trx_id
   → 可见（自己的修改当然可见）

2. 如果 trx_id = m_low_limit_id
   → 不可见（该事务在 Read View 创建后才开始）

4. 如果 m_up_limit_id 
```
-- 设置隔离级别为 Read Committed
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- RC 级别下的行为
BEGIN;
SELECT * FROM accounts WHERE id = 1;  -- 创建 Read View #1
-- 返回 balance = 1000

-- 另一个事务提交了 balance = 900

SELECT * FROM accounts WHERE id = 1;  -- 创建新的 Read View #2
-- 返回 balance = 900（看到了其他事务的提交）

COMMIT;
```

            
```
-- 设置隔离级别为 Repeatable Read
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- RR 级别下的行为
BEGIN;
SELECT * FROM accounts WHERE id = 1;  -- 创建 Read View（整个事务复用）
-- 返回 balance = 1000

-- 另一个事务提交了 balance = 900

SELECT * FROM accounts WHERE id = 1;  -- 复用同一个 Read View
-- 返回 balance = 1000（看不到其他事务的提交）

COMMIT;
```

            

### 5.4 间隙锁与 Next-Key
            Lock

            

InnoDB 在可重复读级别下使用间隙锁（Gap
            Lock）和临键锁（Next-Key Lock）来防止幻读。这是 InnoDB 与
            SQL 标准在 RR 级别上的重要差异——标准的 RR 允许幻读，但
            InnoDB 的 RR 通过锁机制防止了大部分幻读场景。
            

**间隙锁（Gap
            Lock）**：锁定索引记录之间的间隙，防止其他事务在该间隙中插入新记录。间隙锁本身不锁定任何已存在的记录。
            

**临键锁（Next-Key Lock）**：记录锁 +
            间隙锁的组合。锁定一个索引记录及其前面的间隙。
            
```
假设索引中有记录：10, 20, 30

索引空间：
(-∞, 10] (10, 20] (20, 30] (30, +∞)
   ↑         ↑        ↑        ↑
Next-Key  Next-Key Next-Key  Gap Lock
 Lock      Lock     Lock

当执行 SELECT * FROM t WHERE id = 25 FOR UPDATE 时：
  → 加 Next-Key Lock 锁定 (20, 30]
  → 防止在 20 到 30 之间插入新记录
```

            

间隙锁的行为取决于查询条件和索引类型：
            
```
-- 情况一：唯一索引上的等值查询，找到记录
-- 只加记录锁，不加间隙锁
SELECT * FROM t WHERE id = 20 FOR UPDATE;

-- 情况二：唯一索引上的等值查询，未找到记录
-- 加间隙锁，锁定记录所在的间隙
SELECT * FROM t WHERE id = 25 FOR UPDATE;
-- 锁定间隙 (20, 30)

-- 情况三：非唯一索引上的等值查询
-- 加 Next-Key Lock
SELECT * FROM t WHERE name = 'Alice' FOR UPDATE;

-- 情况四：范围查询
-- 加多个 Next-Key Lock 覆盖范围
SELECT * FROM t WHERE id >= 15 AND id 
            

### 5.5 InnoDB 锁信息诊断

            

MySQL 8.0 提供了丰富的锁信息查询手段：
            
```
-- 查看当前所有锁
SELECT * FROM performance_schema.data_locks;

-- 查看锁等待关系
SELECT * FROM performance_schema.data_lock_waits;

-- 查看 InnoDB 引擎状态（包含死锁信息）
SHOW ENGINE INNODB STATUS\G

-- 查看最近一次死锁信息
-- 在 SHOW ENGINE INNODB STATUS 输出中搜索
-- "LATEST DETECTED DEADLOCK" 部分
```

            
```
-- 典型的锁信息输出示例
SELECT ENGINE_LOCK_ID, ENGINE_TRANSACTION_ID,
       LOCK_TYPE, LOCK_MODE, LOCK_STATUS,
       LOCK_DATA
FROM performance_schema.data_locks;

-- 输出示例：
-- +----------------+------------------------+-----------+-----------+-------------+-----------+
-- | ENGINE_LOCK_ID | ENGINE_TRANSACTION_ID  | LOCK_TYPE | LOCK_MODE | LOCK_STATUS | LOCK_DATA |
-- +----------------+------------------------+-----------+-----------+-------------+-----------+
-- | ...            | 12345                  | RECORD    | X         | GRANTED     | 20        |
-- | ...            | 12345                  | RECORD    | X,GAP     | GRANTED     | 30        |
-- | ...            | 12346                  | RECORD    | X         | WAITING     | 20        |
-- +----------------+------------------------+-----------+-----------+-------------+-----------+
```

            

### 5.6 Purge 线程与版本回收

            

InnoDB 的 purge 线程负责清理 undo log
            中不再需要的旧版本。当一个旧版本的 DB_TRX_ID 小于所有活跃
            Read View 的 m_up_limit_id 时，该版本可以被安全清理。
            
```
-- 查看 purge 状态
SHOW ENGINE INNODB STATUS\G
-- 关注 "History list length" 字段
-- 该值持续增大说明 purge 跟不上写入速度

-- 查看 undo tablespace 使用情况
SELECT TABLESPACE_NAME, FILE_NAME, AUTOEXTEND_SIZE
FROM information_schema.FILES
WHERE FILE_TYPE = 'UNDO LOG';
```

            

长事务是 purge
            的天敌：一个运行数小时的查询事务会阻止所有在其之后创建的旧版本被回收，导致
            undo log 膨胀。
            
            

## 六、SSI（Serializable
            Snapshot Isolation）

            

### 6.1 快照隔离的不足

            

快照隔离（Snapshot
            Isolation，SI）提供了优于可重复读的隔离性——它防止了幻读，但仍然允许写偏斜（Write
            Skew）异常。
            

回顾写偏斜的本质：两个事务各自读取了重叠的数据，做出了看似独立的写操作，但组合后违反了约束。在快照隔离下，每个事务看到的都是一致的快照，不会看到对方的未提交写入，因此无法检测到冲突。
            
```
-- 快照隔离下的写偏斜示例（黑白棋盘约束）
-- 约束：黑色和白色的总数相等
-- 初始状态：黑 = 5，白 = 5

-- T1                              -- T2
BEGIN;                             BEGIN;
SELECT count FROM colors
  WHERE color = 'black';
-- 黑 = 5
                                   SELECT count FROM colors
                                     WHERE color = 'white';
                                   -- 白 = 5
UPDATE colors
  SET count = count + 1
  WHERE color = 'black';
-- 黑 = 6
                                   UPDATE colors
                                     SET count = count + 1
                                     WHERE color = 'white';
                                   -- 白 = 6
COMMIT;                            COMMIT;
-- 最终：黑 = 6，白 = 6（约束被打破）
```

            

### 6.2 SSI 算法原理

            

可序列化快照隔离（Serializable Snapshot
            Isolation，SSI）是 Michael Cahill 在 2008
            年提出的算法，它在快照隔离的基础上增加了读写冲突（rw-conflict）的检测，能够捕获写偏斜等异常。
            

SSI 的核心概念是读写依赖（rw-dependency）：如果事务 T1
            读取了某个数据对象 x 的版本 v，而事务 T2 随后修改了 x
            创建了新版本 v’，那么从 T1 到 T2 存在一条 rw-dependency
            边。
            

SSI 检测异常的定理（基于 Fekete 等人 2005
            年的研究）：
            
```
SSI 检测规则：

在一个快照隔离的依赖图中，如果存在非序列化的调度，
则必然存在两条连续的 rw-dependency 边形成一个"危险结构"：

  T1 --rw--> T2 --rw--> T3

其中 T1 和 T3 可能是同一个事务（即形成环）。

SSI 的做法：
1. 跟踪所有 rw-dependency 关系；
2. 当检测到"连续两条 rw-dependency"模式时，
   中止其中一个事务来打破潜在的不可序列化调度。
```

            

### 6.3 PostgreSQL 的 SSI
            实现

            

PostgreSQL 从 9.1 版本开始，将可序列化隔离级别从基于 S2PL
            的实现切换为基于 SSI 的实现。实现涉及两个关键数据结构：
            

**SIREAD
            锁**：当事务在可序列化级别执行快照读时，PostgreSQL
            会记录”哪个事务读取了哪些数据”，但不真正阻塞其他事务。SIREAD
            锁存在三种粒度：
            
            
- 元组级别（Tuple）；
            
- 页面级别（Page）——当元组级 SIREAD
            锁过多时自动升级；
            
- 关系级别（Relation）——当页面级 SIREAD
            锁过多时自动升级。
            
            

**rw-conflict
            列表**：当一个事务写入的数据与另一个事务的 SIREAD
            锁冲突时，记录一条 rw-conflict。
            
```
-- 在 PostgreSQL 中使用 SSI
BEGIN ISOLATION LEVEL SERIALIZABLE;

-- 执行正常的 SQL 操作
SELECT * FROM accounts WHERE id = 1;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;

COMMIT;
-- 如果检测到不可序列化的依赖，COMMIT 会失败：
-- ERROR:  could not serialize access due to read/write dependencies
--         among transactions
```

            

### 6.4 误杀（False
            Positives）问题

            

SSI
            的检测是保守的——它可能中止实际上不会导致异常的事务。这些误杀（False
            Positives）来源于：
            
            
- **粒度升级**：SIREAD
            锁从元组级升级到页面级或关系级时，锁的范围扩大，可能引入不存在的冲突；
            
- **不区分读取的具体值**：SSI 只知道”T1
            读了表 X”，不知道”T1 读了 X 中哪些行”，导致误判；
            
- **已提交事务的依赖信息保留不足**：为了控制内存使用，PostgreSQL
            会在事务提交后合并其依赖信息，丢失部分精度。
            
            
```
-- 调整 SSI 相关参数以减少误杀
-- max_pred_locks_per_transaction：每个事务最大 SIREAD 锁数量
-- max_pred_locks_per_relation：每个关系最大 SIREAD 锁数量
-- max_pred_locks_per_page：每个页面最大 SIREAD 锁数量

-- 增大这些值可以延迟粒度升级，减少误杀，但增加内存消耗
ALTER SYSTEM SET max_pred_locks_per_transaction = 128;
```

            

在误杀率方面，PostgreSQL 的 SSI 实现在典型 OLTP
            负载下表现良好。但在涉及大范围扫描的场景下，SIREAD
            锁粒度升级可能导致较高的误杀率。应用层需要准备好处理序列化失败——通常的做法是捕获错误后重试事务。
            
```
# 应用层处理 SSI 序列化失败的重试逻辑
import psycopg2

def execute_with_retry(conn, sql, params, max_retries=3):
    for attempt in range(max_retries):
        try:
            with conn.cursor() as cur:
                conn.autocommit = False
                cur.execute(
                    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"
                )
                cur.execute(sql, params)
                conn.commit()
                return
        except psycopg2.errors.SerializationFailure:
            conn.rollback()
            if attempt == max_retries - 1:
                raise
            # 指数退避
            time.sleep(0.1 * (2 ** attempt))
```

            
            

## 七、TiDB Percolator
            事务模型

            

### 7.1 分布式事务的挑战

            

在单机数据库中，锁管理器和 MVCC
            版本链都在本地内存中，事务协调的开销很低。但在分布式数据库中，数据分布在多个节点上，一个事务可能涉及多个节点上的数据。这带来了几个核心挑战：
            
            
- **全局时序**：如何确定分布式环境下事务的先后顺序；
            
- **原子提交**：如何保证跨节点事务的原子性；
            
- **分布式锁**：如何在多节点之间协调锁。
            
            

### 7.2 Percolator 模型概述

            

Percolator 是 Google 在 2010
            年发表的论文中提出的分布式事务模型，最初设计用于 Google
            的增量网页索引系统。TiDB 的事务模型直接借鉴了
            Percolator。
            

Percolator 的核心组件：
            
            
- **时间戳预言机（Timestamp
            Oracle，TSO）**：全局单调递增的时间戳分配服务。每个事务在开始时获取一个
            start_ts，在提交时获取一个 commit_ts；
            
- **两阶段提交（Two-Phase
            Commit）**：事务的提交分为 Prewrite 和 Commit
            两个阶段；
            
- **列存储**：每行数据在底层 KV
            存储中有多个”列”——data 列存储实际数据，lock
            列存储锁信息，write 列存储已提交版本的元数据。
            
            

### 7.3 数据的存储结构

            

在 TiDB 中，底层使用 TiKV 作为分布式 KV 存储。每行数据在
            TiKV 中对应三个 Column Family（CF）：
            
```
TiKV 中的数据组织：

Default CF（数据列）：
  key: {row_key}_{start_ts}
  value: 实际数据

Lock CF（锁列）：
  key: {row_key}
  value: {lock_type, primary_key, start_ts, ttl}

Write CF（写入列）：
  key: {row_key}_{commit_ts}
  value: {write_type, start_ts}
```

            

### 7.4 两阶段提交流程

            

**第一阶段：Prewrite**
            
```
Prewrite 流程：

1. 事务从 TSO 获取 start_ts；
2. 选择一个 key 作为 Primary Key，其余为 Secondary Keys；
3. 对每个涉及的 key：
   a. 检查 Write CF 中是否有 commit_ts > start_ts 的记录
      → 如果有，说明存在写写冲突，事务回滚；
   b. 检查 Lock CF 中是否已有其他事务的锁
      → 如果有，说明存在锁冲突，尝试清理或等待；
   c. 写入 Lock CF：记录锁信息，指向 Primary Key；
   d. 写入 Default CF：写入数据，key 中包含 start_ts；
```

            

**第二阶段：Commit**
            
```
Commit 流程：

1. 事务从 TSO 获取 commit_ts；
2. 提交 Primary Key：
   a. 检查 Primary Key 的锁是否仍然存在；
   b. 写入 Write CF：记录 {commit_ts → start_ts} 的映射；
   c. 删除 Lock CF 中 Primary Key 的锁；
   d. 以上三步作为单个 Region 内的原子操作；
3. 异步提交 Secondary Keys：
   a. 对每个 Secondary Key 执行与 Primary 相同的操作；
   b. Secondary 的提交可以异步进行，因为一旦 Primary 提交成功，
      事务的提交状态就已经确定。
```

            

### 7.5 读操作流程

            
```
快照读流程（使用 start_ts 作为快照时间戳）：

1. 检查 Lock CF 中是否有 start_ts 
```
-- TiDB 中查看事务信息
-- 查看当前活跃事务
SELECT * FROM information_schema.cluster_tidb_trx
  LIMIT 10;

-- 查看锁等待信息
SELECT * FROM information_schema.data_lock_waits;

-- 查看 TSO 信息
ADMIN SHOW DDL;
```

            

### 7.6 Async Commit 与 1PC
            优化

            

原始的 Percolator 模型需要两次 TSO 请求（start_ts 和
            commit_ts）和至少两轮 RPC（Prewrite 和 Commit）。TiDB
            引入了两项优化：
            

**Async Commit**：将 commit_ts 的计算下推到
            TiKV 端，消除第二次 TSO 请求。commit_ts 取所有 Prewrite
            中最大的 `max(prewrite_ts) + 1`。
            

**1PC（One-Phase
            Commit）**：当事务只涉及一个 Region 时，可以在
            Prewrite 阶段直接完成提交，省去 Commit 阶段。
            
```
优化效果对比：

模式             TSO 请求    RPC 轮次    适用场景
标准 2PC          2           2+        跨 Region 事务
Async Commit      1           2         跨 Region 事务
1PC               1           1         单 Region 事务
```

            

### 7.7 分布式死锁检测

            

TiDB 使用集中式死锁检测器（位于 PD 或 TiKV
            的特定节点）。当事务在 TiKV
            上遇到锁冲突并需要等待时，会向死锁检测器报告等待关系。检测器维护全局等待图，检测到环路时选择一个事务中止。
            
```
-- TiDB 死锁相关配置
-- pessimistic-txn.deadlock-history-capacity：死锁历史记录数量
-- pessimistic-txn.deadlock-history-collect-retryable：
--   是否收集可重试死锁

-- 查看死锁历史
SELECT * FROM information_schema.deadlocks;
```

            
            

## 八、各隔离级别异常现象复现

            

本节通过可复现的 SQL
            示例，演示各隔离级别下的异常行为。所有示例均基于以下表结构：
            
```
CREATE TABLE accounts (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    balance DECIMAL(10, 2)
);

INSERT INTO accounts VALUES
    (1, 'Alice', 1000.00),
    (2, 'Bob',   2000.00),
    (3, 'Carol', 3000.00);
```

            

### 8.1 脏读复现（Read
            Uncommitted）

            
```
-- 终端 1（MySQL）
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
BEGIN;
SELECT balance FROM accounts WHERE id = 1;
-- 返回 1000.00

-- 终端 2
BEGIN;
UPDATE accounts SET balance = 500.00 WHERE id = 1;
-- 不提交

-- 终端 1
SELECT balance FROM accounts WHERE id = 1;
-- 返回 500.00 ← 脏读！读到了未提交的数据

-- 终端 2
ROLLBACK;

-- 终端 1
SELECT balance FROM accounts WHERE id = 1;
-- 返回 1000.00（回到原值，之前读到的 500 从未真正生效）
COMMIT;
```

            

注意：PostgreSQL
            的读未提交级别实际上等同于读已提交，不会出现脏读。这是
            PostgreSQL 的实现选择——它认为允许脏读没有实际价值。
            

### 8.2
            不可重复读复现（Read Committed）

            
```
-- 终端 1（PostgreSQL 或 MySQL，RC 级别）
BEGIN;
SELECT balance FROM accounts WHERE id = 1;
-- 返回 1000.00

-- 终端 2
BEGIN;
UPDATE accounts SET balance = 800.00 WHERE id = 1;
COMMIT;

-- 终端 1
SELECT balance FROM accounts WHERE id = 1;
-- 返回 800.00 ← 不可重复读！同一事务两次读取结果不同
COMMIT;
```

            

### 8.3 幻读复现（Read
            Committed）

            
```
-- 终端 1（RC 级别）
BEGIN;
SELECT count(*) FROM accounts WHERE balance > 1500;
-- 返回 1（只有 Bob 的 2000）

-- 终端 2
BEGIN;
INSERT INTO accounts VALUES (4, 'Dave', 2500.00);
COMMIT;

-- 终端 1
SELECT count(*) FROM accounts WHERE balance > 1500;
-- 返回 2 ← 幻读！出现了新的满足条件的行
COMMIT;
```

            

### 8.4 MySQL RR
            级别下幻读的部分防护

            

MySQL InnoDB 在 RR 级别下，快照读（普通 SELECT）通过 MVCC
            防止幻读，但当前读（SELECT … FOR UPDATE）通过 Gap Lock
            防止幻读：
            
```
-- 终端 1（MySQL RR 级别）
BEGIN;
SELECT * FROM accounts WHERE balance > 1500;
-- 返回 1 行（Bob）

-- 终端 2
BEGIN;
INSERT INTO accounts VALUES (4, 'Dave', 2500.00);
-- 在没有适当索引的情况下，可能被 Gap Lock 阻塞
COMMIT;

-- 终端 1
SELECT * FROM accounts WHERE balance > 1500;
-- 仍返回 1 行（MVCC 快照读，看不到 Dave）

SELECT * FROM accounts WHERE balance > 1500 FOR UPDATE;
-- 当前读，可能返回 2 行（取决于锁的时序）
COMMIT;
```

            

### 8.5
            写偏斜复现（Repeatable Read / Snapshot Isolation）

            
```
-- 准备数据
CREATE TABLE on_call (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    shift VARCHAR(20),
    status VARCHAR(10) DEFAULT 'on'
);
INSERT INTO on_call VALUES (1, 'Alice', 'night', 'on');
INSERT INTO on_call VALUES (2, 'Bob',   'night', 'on');

-- 终端 1（PostgreSQL RR 级别）
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM on_call
  WHERE shift = 'night' AND status = 'on';
-- 返回 2

-- 终端 2（PostgreSQL RR 级别）
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM on_call
  WHERE shift = 'night' AND status = 'on';
-- 返回 2

-- 终端 1
UPDATE on_call SET status = 'off'
  WHERE name = 'Alice' AND shift = 'night';

-- 终端 2
UPDATE on_call SET status = 'off'
  WHERE name = 'Bob' AND shift = 'night';

-- 终端 1
COMMIT;

-- 终端 2
COMMIT;
-- 两个事务都成功提交！
-- 结果：夜班无人值守，写偏斜发生了

-- 如果使用 SERIALIZABLE 级别，终端 2 的 COMMIT 会失败：
-- ERROR: could not serialize access due to read/write dependencies
```

            

### 8.6 丢失更新复现

            
```
-- 准备
-- accounts 表中 id=1 的 balance = 1000

-- 终端 1（RC 或 RR 级别）
BEGIN;
SELECT balance FROM accounts WHERE id = 1;
-- 返回 1000
-- 应用层计算：1000 + 100 = 1100

-- 终端 2（RC 或 RR 级别）
BEGIN;
SELECT balance FROM accounts WHERE id = 1;
-- 返回 1000
-- 应用层计算：1000 + 200 = 1200

-- 终端 1
UPDATE accounts SET balance = 1100 WHERE id = 1;
COMMIT;

-- 终端 2
UPDATE accounts SET balance = 1200 WHERE id = 1;
COMMIT;
-- 最终 balance = 1200，终端 1 的 +100 操作丢失了！

-- 正确做法：使用原子操作
UPDATE accounts SET balance = balance + 100 WHERE id = 1;
-- 或使用 SELECT ... FOR UPDATE 获取行锁
```

            
            

## 九、锁等待与死锁分析

            

### 9.1 锁等待超时

            

当事务请求的锁被其他事务持有时，请求方会进入等待状态。如果等待时间超过阈值，数据库会返回超时错误。
            
```
-- MySQL：查看和设置锁等待超时
SHOW VARIABLES LIKE 'innodb_lock_wait_timeout';
-- 默认 50 秒

SET SESSION innodb_lock_wait_timeout = 10;
-- 设为 10 秒

-- 超时后的错误信息：
-- ERROR 1205 (HY000): Lock wait timeout exceeded;
-- try restarting transaction
```

            
```
-- PostgreSQL：查看和设置锁等待超时
SHOW lock_timeout;
-- 默认 0（无超时，无限等待）

SET lock_timeout = '10s';
-- 设为 10 秒

-- 超时后的错误信息：
-- ERROR: canceling statement due to lock timeout

-- deadlock_timeout：死锁检测触发的等待时间阈值
SHOW deadlock_timeout;
-- 默认 1s
```

            

### 9.2 死锁的产生条件

            

死锁的四个必要条件（Coffman 条件）：
            
            
- **互斥条件**：资源不能共享（X
            锁互斥）；
            
- **持有并等待**：事务持有至少一个锁，同时等待获取其他锁；
            
- **不可抢占**：已获得的锁不能被强行剥夺；
            
- **循环等待**：存在事务的循环等待链。
            
            

### 9.3 死锁实战案例

            

**案例一：经典双行交叉更新死锁**
            
```
-- 终端 1
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- 获取 id=1 的 X 锁

-- 终端 2
BEGIN;
UPDATE accounts SET balance = balance - 200 WHERE id = 2;
-- 获取 id=2 的 X 锁

-- 终端 1
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
-- 等待 id=2 的 X 锁（被终端 2 持有）

-- 终端 2
UPDATE accounts SET balance = balance + 200 WHERE id = 1;
-- 等待 id=1 的 X 锁（被终端 1 持有）
-- 死锁！数据库检测到后回滚其中一个事务
```

            

**案例二：Gap Lock 导致的死锁**
            
```
-- 这种死锁在 MySQL RR 级别下更常见
-- 假设 accounts 表有记录 id = 1, 5, 10

-- 终端 1
BEGIN;
SELECT * FROM accounts WHERE id = 3 FOR UPDATE;
-- id=3 不存在，加 Gap Lock 锁定间隙 (1, 5)

-- 终端 2
BEGIN;
SELECT * FROM accounts WHERE id = 4 FOR UPDATE;
-- id=4 不存在，加 Gap Lock 锁定间隙 (1, 5)
-- Gap Lock 之间不冲突，所以可以同时持有

-- 终端 1
INSERT INTO accounts VALUES (3, 'New1', 100);
-- 尝试插入到间隙 (1, 5)，被终端 2 的 Gap Lock 阻塞

-- 终端 2
INSERT INTO accounts VALUES (4, 'New2', 200);
-- 尝试插入到间隙 (1, 5)，被终端 1 的 Gap Lock 阻塞
-- 死锁！
```

            

### 9.4 死锁诊断工具

            

**MySQL 死锁诊断**：
            
```
-- 查看最近的死锁信息
SHOW ENGINE INNODB STATUS\G

-- 关键输出段：
-- ========================
-- LATEST DETECTED DEADLOCK
-- ========================
-- *** (1) TRANSACTION:
-- TRANSACTION 12345, ACTIVE 10 sec starting index read
-- mysql tables in use 1, locked 1
-- LOCK WAIT 3 lock struct(s), heap size 1136, 2 row lock(s)
-- *** (1) HOLDS THE LOCK(S):
-- RECORD LOCKS space id 100 page no 3 n bits 72 index PRIMARY
-- *** (1) WAITING FOR THIS LOCK TO BE GRANTED:
-- RECORD LOCKS space id 100 page no 3 n bits 72 index PRIMARY
-- *** (2) TRANSACTION:
-- ...
-- *** WE ROLL BACK TRANSACTION (2)
```

            
```
-- 开启死锁日志记录到错误日志
SET GLOBAL innodb_print_all_deadlocks = ON;
```

            

**PostgreSQL 死锁诊断**：
            
```
-- PostgreSQL 在日志中记录死锁信息
-- 配置日志参数
-- log_lock_waits = on          -- 记录等待超过 deadlock_timeout 的锁
-- deadlock_timeout = '1s'      -- 死锁检测触发时间

-- 查看当前锁信息
SELECT pid, locktype, relation::regclass, mode, granted
FROM pg_locks
WHERE NOT granted;

-- 查看锁等待链
SELECT blocked.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocked_activity.query AS blocked_query,
       blocking.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked
JOIN pg_catalog.pg_stat_activity blocked_activity
  ON blocked_activity.pid = blocked.pid
JOIN pg_catalog.pg_locks blocking
  ON blocking.locktype = blocked.locktype
  AND blocking.relation = blocked.relation
  AND blocking.pid != blocked.pid
JOIN pg_catalog.pg_stat_activity blocking_activity
  ON blocking_activity.pid = blocking.pid
WHERE NOT blocked.granted;
```

            

### 9.5 死锁预防策略

            

在应用层面，可以通过以下策略减少死锁的发生：
            
            
- **固定加锁顺序**：所有事务按照相同的顺序访问资源。例如，总是按
            id 从小到大更新行；
            
            
```
-- 错误：不同顺序访问
-- T1: UPDATE ... WHERE id = 1; UPDATE ... WHERE id = 2;
-- T2: UPDATE ... WHERE id = 2; UPDATE ... WHERE id = 1;

-- 正确：统一顺序访问
-- T1: UPDATE ... WHERE id = 1; UPDATE ... WHERE id = 2;
-- T2: UPDATE ... WHERE id = 1; UPDATE ... WHERE id = 2;
```

            
            
- **减小事务粒度**：缩短事务持锁时间，减少冲突窗口；
            
- **使用乐观锁**：通过版本号或时间戳检测冲突，避免加锁；
            
            
```
-- 乐观锁模式
UPDATE accounts
  SET balance = balance - 100, version = version + 1
  WHERE id = 1 AND version = 5;
-- 如果 affected_rows = 0，说明版本已变更，需要重试
```

            
            
- **降低隔离级别**：在读已提交级别下，间隙锁不生效，减少了死锁的可能性；
            
- **设置合理的超时**：缩短锁等待超时时间，让阻塞的事务尽快失败和重试。
            
            

### 9.6 长事务的危害

            

长事务是锁等待和死锁的主要诱因，还会导致以下问题：
            
            
- **阻塞其他事务**：长事务持有的锁会阻塞后续事务；
            
- **阻止版本回收**：长事务的快照阻止旧版本被清理，导致
            undo log 或堆表膨胀；
            
- **增加死锁概率**：事务持锁时间越长，与其他事务形成循环等待的概率越大。
            
            
```
-- MySQL：查找长事务
SELECT trx_id, trx_state, trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS duration_sec,
       trx_rows_locked, trx_rows_modified,
       trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started ASC;

-- PostgreSQL：查找长事务
SELECT pid, now() - xact_start AS duration,
       state, query
FROM pg_stat_activity
WHERE state != 'idle'
  AND xact_start IS NOT NULL
ORDER BY xact_start ASC;

-- PostgreSQL：查找阻止 VACUUM 的长事务
SELECT pid, backend_xid, backend_xmin,
       now() - xact_start AS duration,
       query
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY backend_xmin ASC
LIMIT 5;
```

            
            

## 十、隔离级别选择指南

            

### 10.1 性能与正确性的权衡

            

隔离级别的选择本质上是在性能与正确性之间做权衡。更高的隔离级别提供更强的一致性保证，但通常伴随更高的性能开销：
            
```
隔离级别与开销关系：

                正确性保证
                    ↑
  Serializable      |  ★★★★★   最强保证，最高开销
                    |
  Repeatable Read   |  ★★★★    防止大部分异常，中等开销
                    |
  Read Committed    |  ★★★     基本保证，较低开销
                    |
  Read Uncommitted  |  ★       几乎无保证，最低开销
                    +-----------------------------→ 性能
```

            

但实际情况比这个简化模型复杂得多：
            
            
- 基于 MVCC
            的可重复读开销可能与读已提交相差不大（区别仅在于 Read View
            的创建时机）；
            
- PostgreSQL 的 SSI
            实现使得可序列化的读操作开销接近快照隔离，只在提交时增加额外检查；
            
- 间隙锁在某些负载下可能导致可重复读比读已提交慢得多（因为锁冲突增加）。
            
            

### 10.2
            各数据库的默认隔离级别

            
            
            
            
            
            
            
            
            数据库
            默认隔离级别
            说明
            
            
            
            
            PostgreSQL
            Read Committed
            社区认为 RC 是最佳默认值
            
            
            MySQL InnoDB
            Repeatable Read
            历史原因（基于 binlog 的复制需要 RR）
            
            
            Oracle
            Read Committed
            Oracle 不支持 RR，只有 RC 和 Serializable
            
            
            SQL Server
            Read Committed
            默认基于锁的 RC，可开启基于快照的 RC
            
            
            TiDB
            Repeatable Read
            兼容 MySQL 的选择
            
            
            CockroachDB
            Serializable
            始终运行在 Serializable 级别
            
            
            
            

### 10.3 按场景选择

            

**场景一：高吞吐 OLTP（电商、支付）**
            
            
- **推荐级别**：读已提交（Read
            Committed）；
            
- **理由**：大部分 OLTP
            操作是简单的单行读写，RC
            级别的并发度最高。对于需要更强一致性的操作（如转账），在应用层使用
            `SELECT ... FOR UPDATE`
            配合业务逻辑来保证正确性；
            
- **注意**：MySQL 在 RC
            级别下不使用间隙锁，死锁概率更低，但需要注意 binlog
            格式必须设为 ROW。
            
            
```
-- MySQL RC 级别下的转账操作
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- 获取行锁，读取最新值
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

            

**场景二：报表查询（需要一致性视图）**
            
            
- **推荐级别**：可重复读（Repeatable
            Read）；
            
- **理由**：报表查询通常涉及多个表的关联查询，需要在一个一致的时间点上读取所有数据。RR
            级别提供事务级别的一致性快照；
            
- **注意**：长时间运行的报表查询会阻止版本回收，建议在只读副本上执行。
            
            
```
-- 在一致性快照上执行报表查询
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
BEGIN READ ONLY;
SELECT sum(balance) FROM accounts;
SELECT count(*) FROM transactions WHERE date = '2025-09-06';
-- 两条查询看到的是同一时间点的数据
COMMIT;
```

            

**场景三：严格一致性需求（金融对账、库存管理）**
            
            
- **推荐级别**：可序列化（Serializable）；
            
- **理由**：涉及复杂的业务约束检查，可能出现写偏斜等异常。使用可序列化级别可以让数据库自动检测和防止所有异常；
            
- **注意**：应用层必须准备好处理序列化失败（PostgreSQL
            SSI）或锁等待超时（MySQL），实现重试逻辑。
            
            
```
-- PostgreSQL SSI 级别下的约束检查
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT count(*) FROM on_call
  WHERE shift = 'night' AND status = 'on';
-- 如果在岗人数 > 1，允许下班
UPDATE on_call SET status = 'off'
  WHERE name = 'Alice' AND shift = 'night';
COMMIT;
-- 如果检测到写偏斜，自动回滚
```

            

**场景四：分布式系统**
            
            
- **推荐级别**：取决于框架和业务；
            
- TiDB 默认
            RR（快照隔离），支持悲观事务模式下的当前读锁保护；
            
- CockroachDB 只提供
            Serializable，简化了应用开发的心智负担；
            
- 分布式系统中网络延迟是主要瓶颈，隔离级别本身的开销差异相对较小。
            
            

### 10.4 通用建议

            
            
- **从 RC 开始**：大部分 Web 应用在 RC
            级别下就能正常工作。只在确实需要更强隔离时才提升级别；
            
- **不要混用隔离级别**：同一系统中使用多种隔离级别会增加理解和调试的复杂度；
            
- **理解你用的数据库**：同一个隔离级别在不同数据库中的行为可能不同。MySQL
            的 RR 不等于 PostgreSQL 的 RR；
            
- **监控锁争用**：无论选择哪个级别，都要监控锁等待时间和死锁频率；
            
- **小事务优先**：缩短事务的持续时间是减少并发冲突最有效的手段；
            
- **重试机制是必需的**：在任何隔离级别下，事务都可能因为死锁、锁超时或序列化失败而需要重试。
            
            
```
# 通用的事务重试框架
import time
import random

def run_transaction(connection, transaction_func, max_retries=5):
    """执行事务，遇到可重试错误时自动重试。"""
    for attempt in range(max_retries):
        try:
            result = transaction_func(connection)
            connection.commit()
            return result
        except Exception as e:
            connection.rollback()
            error_code = getattr(e, 'pgcode', '') or str(getattr(e, 'errno', ''))
            # 可重试错误：死锁、序列化失败、锁等待超时
            retryable = error_code in ('40001', '40P01', '1205', '1213')
            if not retryable or attempt == max_retries - 1:
                raise
            # 指数退避 + 随机抖动
            delay = min(0.1 * (2 ** attempt) + random.uniform(0, 0.1), 5.0)
            time.sleep(delay)
    raise RuntimeError("事务重试次数耗尽")
```

            

### 10.5
            隔离级别与索引设计的关系

            

隔离级别的选择还会影响索引设计策略。在 MySQL InnoDB
            中：
            
            
- **RC
            级别**：不使用间隙锁，索引的唯一性约束就是唯一的并发控制点。缺少合适索引时，扫描到的每一行都会加记录锁然后释放（不满足条件的行会立即释放锁）；
            
- **RR 级别**：使用间隙锁和 Next-Key
            Lock。缺少合适索引时，可能锁定大范围的间隙，甚至全表。因此在
            RR 级别下，良好的索引设计对并发性能尤为重要。
            
            
```
-- RR 级别下，缺少索引导致锁范围过大的示例
-- 假设 accounts 表在 balance 列上没有索引

-- 终端 1
BEGIN;
SELECT * FROM accounts WHERE balance > 1000 FOR UPDATE;
-- 由于没有 balance 索引，InnoDB 执行全表扫描
-- 锁定所有扫描到的行及其间隙

-- 终端 2
BEGIN;
INSERT INTO accounts VALUES (100, 'Test', 500);
-- 可能被阻塞！即使 balance=500 不满足 > 1000 的条件
-- 因为 Gap Lock 锁定了整个索引范围

-- 解决方案：为 balance 列创建索引
CREATE INDEX idx_balance ON accounts(balance);
-- 有了索引后，锁的范围缩小到 balance > 1000 的区间
```

            
            

## 附：参考资料

            
            
- Berenson, H., Bernstein, P., Gray, J., et al. “A
            Critique of ANSI SQL Isolation Levels.” *ACM SIGMOD
            Record*, 1995. https://www.microsoft.com/en-us/research/publication/a-critique-of-ansi-sql-isolation-levels/
            
- Cahill, M. J., Röhm, U., Fekete, A. D. “Serializable
            Isolation for Snapshot Databases.” *ACM SIGMOD*,
            2008. https://dl.acm.org/doi/10.1145/1376616.1376690
            
- Peng, D., Dabek, F. “Large-scale Incremental Processing
            Using Distributed Transactions and Notifications.”
            *OSDI*, 2010. https://research.google/pubs/pub36726/
            
- Fekete, A., Liarokapis, D., O’Neil, E., O’Neil, P.,
            Shasha, D. “Making Snapshot Isolation Serializable.” *ACM
            TODS*, 2005. https://dl.acm.org/doi/10.1145/1071610.1071615
            
- Adya, A. “Weak Consistency: A Generalized Theory and
            Optimistic Implementations for Distributed Transactions.”
            PhD Thesis, MIT, 1999. https://pmg.csail.mit.edu/papers/adya-phd.pdf
            
- PostgreSQL 官方文档：Transaction Isolation. https://www.postgresql.org/docs/current/transaction-iso.html
            
- MySQL 官方文档：InnoDB Transaction Isolation Levels. https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html
            
- MySQL 官方文档：InnoDB Locking. https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html
            
- TiDB 官方文档：事务概览. https://docs.pingcap.com/zh/tidb/stable/transaction-overview
            
- Ports, D. R. K., Grittner, K. “Serializable Snapshot
            Isolation in PostgreSQL.” *PVLDB*, 2012. https://drkp.net/papers/ssi-vldb12.pdf
            
- PostgreSQL 官方文档：VACUUM. https://www.postgresql.org/docs/current/sql-vacuum.html
            
- MySQL 官方文档：InnoDB Multi-Versioning. https://dev.mysql.com/doc/refman/8.0/en/innodb-multi-versioning.html
            
- Eswaran, K. P., Gray, J. N., Lorie, R. A., Traiger, I.
            L. “The Notions of Consistency and Predicate Locks in a
            Database System.” *Communications of the ACM*, 1976.
            https://dl.acm.org/doi/10.1145/360363.360369
            
- Gray, J., Reuter, A. *Transaction Processing:
            Concepts and Techniques*. Morgan Kaufmann, 1993.
            
- Huang, D., Liu, Q., et al. “TiDB: A Raft-based HTAP
            Database.” *PVLDB*, 2020. https://dl.acm.org/doi/10.14778/3415478.3415535
            
            
            

**上一篇**: WAL 与崩溃恢复：ARIES
            协议 **下一篇**: 索引结构：从
            B+Tree 到倒排索引
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】ORC 文件格式与 Parquet 对照

                    

ORC 用 stripe 而非 row group、用三级统计（file/stripe/row-group index）而非独立 page index、用 PRESENT/DATA 等 stream 而非 page 组织一列。本文按 ORC 规范拆其文件尾（postscript + footer）、stripe 内部结构与 RLEv2 整数编码，并用本机 pyarrow 24.0.0 把同一份 30 万行数据写成 ORC 与 Parquet，对比真实体积与物理布局，最后给出什么场景仍用 ORC。