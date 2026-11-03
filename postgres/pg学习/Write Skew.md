这篇文章核心讲的是 **Write Skew（写偏斜）为什么会发生，以及为什么 Snapshot Isolation 看起来很像 Serializable，但实际上不是**。作者最后还把这个问题和 PostgreSQL 的 Serializable Snapshot Isolation（SSI）联系起来。([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/?utm_source=chatgpt.com "What write skew looks like"))

你如果主要用 PostgreSQL，我建议不要从 CockroachDB 的实现细节切入，而是直接用 **PG + MVCC + 两个并发事务**理解。

---

# 先说结论

一句话：

> **Write Skew = 两个事务读了彼此不会修改的东西，但它们共同维护的业务约束被并发执行破坏了。**

最典型的形式：

```text
T1: 读 A
T2: 读 B

T1: 写 B
T2: 写 A
```

注意：

```text
T1 和 T2 写的是不同的行
```

所以数据库很容易认为：

> “你俩又没有写同一行，冲突什么？”

但实际上：

```text
T1 依赖 A
T2 依赖 B

A 和 B 之间存在一个业务约束
```

于是两个事务同时成功，就可能把这个约束打破。

这就是 **write skew**。

---

# 1. 用一个非常现实的 PG 例子

假设有一个值班医生表：

```sql
CREATE TABLE doctors (
    id   int primary key,
    name text,
    on_call boolean
);
```

数据：

```text
id | name | on_call
---+------+---------
1  | Alice | true
2  | Bob   | true
```

业务规则：

> **至少有一个医生值班。**

也就是说：

```text
Alice = true OR Bob = true
```

现在 Alice 和 Bob 都想下班。

---

# 2. 两个事务同时执行

### Transaction 1

Alice 下班：

```sql
BEGIN;

SELECT count(*)
FROM doctors
WHERE on_call = true;
```

看到：

```text
2
```

于是：

```sql
UPDATE doctors
SET on_call = false
WHERE id = 1;

COMMIT;
```

---

### Transaction 2

与此同时 Bob 也下班：

```sql
BEGIN;

SELECT count(*)
FROM doctors
WHERE on_call = true;
```

也看到：

```text
2
```

然后：

```sql
UPDATE doctors
SET on_call = false
WHERE id = 2;

COMMIT;
```

最后：

```text
id | name  | on_call
---+-------+---------
1  | Alice | false
2  | Bob   | false
```

**没有医生值班了。**

业务约束：

```text
至少一个医生 on_call
```

被破坏。

这就是 Write Skew。

---

# 3. 最关键的问题：为什么数据库没发现？

这里是理解这篇文章的核心。

把两个事务简化一下：

```text
T1                         T2

读 Alice = true             读 Bob = true
读 Bob   = true             读 Alice = true

写 Alice = false            写 Bob = false
```

实际上更准确地说：

```text
T1 READ: Alice, Bob
T1 WRITE: Alice

T2 READ: Alice, Bob
T2 WRITE: Bob
```

注意：

```text
T1 写 Alice
T2 写 Bob
```

**Write Set 没有交集。**

所以如果你的隔离机制只关心：

```text
两个并发事务不能写同一个东西
```

那么：

```text
T1: write Alice
T2: write Bob
```

完全合法。

但是：

```text
T1 读取了 Bob
T2 又修改了 Bob

T2 读取了 Alice
T1 又修改了 Alice
```

这里实际上存在两个非常重要的：

```text
read → write
```

依赖。

---

# 4. 这就是文章里面最重要的 rw dependency

文章里面把事务之间的关系分成：

```text
wr
ww
rw
```

其中：

### wr

```text
T1 WRITE → T2 READ
```

例如：

```text
T1:
UPDATE users SET name = 'Tom';

T2:
SELECT name FROM users;
```

T2 读到了 T1 写的数据。

所以：

```text
T1 → T2
```

---

### ww

```text
T1 WRITE → T2 WRITE
```

两个事务修改同一个东西。

例如：

```text
T1:
UPDATE account SET balance = 100 WHERE id = 1;

T2:
UPDATE account SET balance = 200 WHERE id = 1;
```

---

### rw

这个最关键：

```text
T1 READ → T2 WRITE
```

也叫：

> **anti-dependency**

例如：

```text
T1:
SELECT balance FROM account WHERE id = 1;
```

然后：

```text
T2:
UPDATE account SET balance = 0 WHERE id = 1;
```

T1 读了一个旧版本，而 T2 后面把这个数据修改了。

文章特别强调：

> 在 Snapshot Isolation 中，**并发事务之间真正可能形成的依赖主要就是 rw dependency**。([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/ "What write skew looks like"))

---

# 5. 把刚才的医生例子画出来

假设：

```text
T1 = Alice 下班
T2 = Bob 下班
```

那么：

```text
             READ Bob
                │
                │
                ▼
T1 ──────────────────────► WRITE Alice
│
│
│
│
│
│
▼
READ Alice
                │
                │
                ▼
             WRITE Bob
                         T2
```

更直观一点：

```text
T1                              T2

READ Alice=true
READ Bob=true

                                READ Alice=true
                                READ Bob=true

WRITE Alice=false
                                WRITE Bob=false

COMMIT                          COMMIT
```

从依赖关系看：

```text
T1 READ Bob
        │
        ▼
T2 WRITE Bob

T2 READ Alice
        │
        ▼
T1 WRITE Alice
```

因此形成：

```text
T1 ──rw──> T2
▲          │
│          │ rw
└──────────┘
```

**形成环。**

这就是为什么文章后面一直在讲：

> serialization graph 有没有 cycle。([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/ "What write skew looks like"))

---

# 6. 为什么普通 Snapshot Isolation 会允许这个事情？

这里就到了 PG 最重要的知识点。

PostgreSQL 的：

```text
READ COMMITTED
REPEATABLE READ
SERIALIZABLE
```

不是简单的：

```text
低级 / 中级 / 高级
```

而是背后的并发控制机制不同。

PG 使用 MVCC。

你可以简单理解成：

```text
数据库：

Alice
 ├── version 1
 └── version 2

Bob
 ├── version 1
 └── version 2
```

一个事务开始之后，会拿到一个自己的 snapshot。

例如：

```text
T1 snapshot = S100
T2 snapshot = S100
```

那么：

```text
T1 看到了 S100
T2 也看到了 S100
```

即使：

```text
T1 后面修改 Alice
T2 后面修改 Bob
```

因为修改的是不同的 row：

```text
Alice ← T1

Bob   ← T2
```

并不会产生传统意义上的：

```text
UPDATE 同一行
```

冲突。

---

# 7. 这就是 Snapshot Isolation 的“坑”

Snapshot Isolation 很强。

它可以避免很多问题：

```text
dirty read
non-repeatable read
lost update
```

但是它不是：

```text
Serializable
```

因为：

> **每个事务看到的 snapshot 都是一致的，并不代表所有事务组合起来等价于某一个串行执行。**

这句话非常重要。

---

# 8. 什么叫 Serializable？

假设：

```text
T1 = Alice 下班
T2 = Bob 下班
```

如果真正串行：

### 情况 A

```text
T1 先执行

看到：
Alice=true
Bob=true

Alice=false

然后 T2：

看到：
Alice=false
Bob=true

发现不能下班
ROLLBACK
```

最终：

```text
Alice=false
Bob=true
```

---

### 情况 B

```text
T2 先执行

Bob=false

T1 再执行

发现 Alice=true
Bob=false

所以不能下班
ROLLBACK
```

最终：

```text
Alice=true
Bob=false
```

这两种结果都是合理的。

但绝不可能出现：

```text
Alice=false
Bob=false
```

因为没有任何一个合理的串行顺序可以得到这个结果。

所以：

```text
Alice=false
Bob=false
```

就是：

> **non-serializable execution**

---

# 9. PG 的 REPEATABLE READ 会怎么样？

这个地方特别值得你亲自实验。

在 PostgreSQL 中：

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

本质上使用的是基于 MVCC 的 snapshot isolation 风格机制。

所以刚才这种 **write skew 是可能发生的**。Cockroach Labs 自己的隔离级别对比也明确把 PostgreSQL `REPEATABLE READ` 标记为可能出现 write skew，而 PostgreSQL `SERIALIZABLE` 则不会。([CockroachDB](https://www.cockroachlabs.com/blog/db-consistency-isolation-terminology/?utm_source=chatgpt.com "How to talk about consistency and isolation in distributed DBs"))

也就是说：

```text
REPEATABLE READ
```

并不等于：

```text
SERIALIZABLE
```

这是很多 PG 用户特别容易搞混的地方。

---

# 10. 那 PG SERIALIZABLE 怎么解决？

PostgreSQL 的 Serializable 采用的是：

> **Serializable Snapshot Isolation（SSI）**

这点和文章后半部分直接对应。文章明确提到了 PostgreSQL 使用 SSI，通过追踪 `rw` dependency 来避免形成危险的依赖环。([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/ "What write skew looks like"))

简单理解：

```text
T1 READ Bob
       ↓
T2 WRITE Bob

T2 READ Alice
       ↓
T1 WRITE Alice
```

PG 发现：

```text
T1 ──rw──> T2
T2 ──rw──> T1
```

存在形成 serialization cycle 的可能。

于是：

> **至少杀掉一个事务。**

例如：

```text
T1 COMMIT
T2 → ERROR
```

你可能看到类似：

```text
ERROR: could not serialize access due to read/write dependencies among transactions
```

于是应用程序需要：

```text
BEGIN
  ↓
执行事务
  ↓
COMMIT
  ↓
成功？
 ├── YES → done
 └── NO  → retry
```

这也是为什么 PostgreSQL 的 SERIALIZABLE 事务在应用层通常需要 retry loop。

---

# 11. 这里有一个非常容易混淆的点

很多人会认为：

> “Serializable 就是数据库把事务一个一个执行。”

**不是。**

这是理解 SSI 非常重要的一步。

PostgreSQL 的 Serializable 并不意味着：

```text
T1
 ↓
T2
 ↓
T3
 ↓
T4
```

真的排队执行。

它依然可以：

```text
T1 ──────────────
        T2 ──────────────
              T3 ────────
```

并发执行。

只是数据库保证：

> 最终提交成功的事务集合，在逻辑上必须等价于某一个串行执行顺序。

所以：

```text
物理上并发
```

≠

```text
逻辑上非串行
```

Serializable 的目标就是：

```text
物理并发执行
       ↓
最终效果
       ↓
等价于串行执行
```

---

# 12. 为什么文章一直强调“cycle”？

因为可以把事务看成一个图。

例如：

```text
       rw
T1 ─────────> T2
▲              │
│              │ rw
│              ▼
└──────────── T3
```

如果：

```text
T1 → T2
T2 → T3
T3 → T1
```

那么：

```text
cycle
```

一旦存在这样的 cycle：

> 就不存在一个合法的串行顺序可以解释这个执行结果。

所以：

```text
Serializable
        ↓
Serialization graph
        ↓
不能有 cycle
```

这其实是整篇文章最核心的理论。

文章明确给出了这个判断：**一个 history 是 serializable，当且仅当它的 serialization graph 没有 cycle。** ([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/ "What write skew looks like"))

---

# 13. 你作为运维，最应该记住这个实际问题

假设线上有：

```sql
BEGIN;

SELECT ...
-- 做业务判断

UPDATE ...

COMMIT;
```

很多业务代码都是：

```text
SELECT 判断条件
        ↓
if 满足
        ↓
UPDATE
```

例如：

```text
库存扣减
余额转账
优惠券领取
配额分配
抢锁
订单状态转换
排班
权限修改
```

如果：

```text
SELECT 检查的是一组数据
```

但是：

```text
UPDATE 只修改其中一部分
```

就要警惕：

> **Write Skew。**

---

# 14. 一个更贴近生产环境的例子：库存

假设：

```text
inventory

sku | stock
----+------
A   | 10
B   | 10
```

业务约束：

```text
A + B >= 10
```

两个事务：

```text
T1:
SELECT stock FROM inventory
→ A=10, B=10

T2:
SELECT stock FROM inventory
→ A=10, B=10
```

然后：

```text
T1:
A = 0

T2:
B = 0
```

最终：

```text
A = 0
B = 0
```

于是：

```text
A + B = 0
```

违反：

```text
A + B >= 10
```

但：

```text
T1 UPDATE A
T2 UPDATE B
```

**完全没有更新同一行。**

这就是为什么：

> “我们用了事务，所以不会有并发问题。”

这个说法是错的。

真正的问题是：

```text
事务
+
什么 isolation level
+
什么业务 invariant
```

三者要一起看。

---

# 15. READ COMMITTED / REPEATABLE READ / SERIALIZABLE 怎么理解

可以粗略记成：

|PG 隔离级别|Snapshot|Write Skew|
|---|--:|--:|
|READ COMMITTED|每条语句自己的 snapshot|✅ 可能|
|REPEATABLE READ|一个事务固定 snapshot|✅ 可能|
|SERIALIZABLE|snapshot + SSI|❌ 不允许|

PG 的 `SERIALIZABLE` 会在检测到可能导致不可串行化的并发依赖时，让事务失败，而不是默默产生错误的最终状态。([CockroachDB](https://www.cockroachlabs.com/blog/db-consistency-isolation-terminology/?utm_source=chatgpt.com "How to talk about consistency and isolation in distributed DBs"))

---

# 16. 那 `SELECT FOR UPDATE` 能解决吗？

很多时候可以，而且这是生产环境非常实用的手段。

比如刚才医生问题：

```sql
BEGIN;

SELECT *
FROM doctors
WHERE on_call = true
FOR UPDATE;
```

这样你明确告诉 PG：

> 我要基于这些行做决定，而且我要锁住它们。

那么两个事务竞争的时候：

```text
T1
SELECT ... FOR UPDATE
       ↓
锁住 Alice/Bob
       ↓
T2
SELECT ... FOR UPDATE
       ↓
等待
```

T1 提交以后：

```text
T2 获得锁
       ↓
重新看到最新状态
       ↓
发现已经不能下班
```

因此不会出现两个事务同时通过业务判断的问题。

不过这和 SERIALIZABLE 是两个不同思路：

```text
SELECT FOR UPDATE
=
主动悲观加锁

SERIALIZABLE / SSI
=
允许并发，发现危险依赖后让事务失败
```

Cockroach Labs 自己也指出，`SELECT FOR UPDATE` 的一个作用就是更早获得锁，从而减少因为并发导致的事务 retry。([CockroachDB](https://www.cockroachlabs.com/blog/when-and-why-to-use-select-for-update-in-cockroachdb/?utm_source=chatgpt.com "When and why to use SELECT FOR UPDATE in CockroachDB"))

---

# 17. 把这篇文章压缩成一张图

你可以把它理解成：

```text
                    数据库事务
                        │
                        ▼
                      MVCC
                        │
                        ▼
                Snapshot Isolation
                        │
              ┌─────────┴─────────┐
              │                   │
          优点：快             缺点：可能
          并发高               Write Skew
                                  │
                                  ▼
                         rw dependency
                                  │
                         ┌────────┴────────┐
                         │                 │
                       T1 → T2          T2 → T1
                         │                 │
                         └────────┬────────┘
                                  ▼
                                cycle
                                  │
                                  ▼
                         非 Serializable
                                  │
                                  ▼
                    PostgreSQL SERIALIZABLE
                                  │
                                  ▼
                     SSI 检测危险依赖
                                  │
                         ┌────────┴────────┐
                         │                 │
                      安全提交          危险事务
                                        ↓
                                      abort
                                        ↓
                                      retry
```

---

## 最后给你一个最重要的认知

**Write Skew 不是“两个事务修改同一行导致冲突”。**

恰恰相反，它最典型的特点是：

```text
T1 修改 A
T2 修改 B
```

**两个事务修改不同的数据，因此数据库看起来没有冲突。**

但是：

```text
T1 读取 A、B → 修改 A
T2 读取 A、B → 修改 B
```

两个事务共同依赖：

```text
A + B 必须满足某个 invariant
```

于是：

```text
T1 的修改破坏了 T2 判断时依赖的事实
T2 的修改又破坏了 T1 判断时依赖的事实
```

最终：

```text
T1 →rw T2
T2 →rw T1
```

形成：

```text
cycle
```

这就是 **Write Skew**。

而 PostgreSQL 的 `SERIALIZABLE` 本质上就是在 **允许 MVCC 并发执行的同时，防止这种依赖最终形成不可串行化的结果**；代价就是某些事务会收到 serialization failure，需要应用重试。([CockroachDB](https://www.cockroachlabs.com/blog/what-write-skew-looks-like/ "What write skew looks like"))

如果你愿意继续往下钻，我建议下一步直接做一个 **“PostgreSQL 两个 psql 窗口实战实验”**：我可以给你一套可以复制粘贴的 SQL，分别演示 **READ COMMITTED、REPEATABLE READ、SERIALIZABLE 下同一个 Write Skew 到底分别发生什么**，包括每一步为什么能看到那个结果。