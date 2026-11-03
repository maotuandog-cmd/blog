`pg_locks` 是 PostgreSQL 的系统视图，用于查看当前数据库中的**锁信息**。

它是排查：

- SQL 卡住
    
- 死锁
    
- 长事务
    
- 数据库等待
    
- UPDATE/DELETE 阻塞
    

最常用的工具之一。

---

## 1. 查看当前所有锁

```sql
SELECT *
FROM pg_locks;
```

常见字段：

|字段|说明|
|---|---|
|pid|进程 ID|
|locktype|锁类型|
|relation|被锁对象|
|mode|锁模式|
|granted|是否已经获得锁|
|transactionid|事务 ID|

---

# 2. 查看谁在阻塞谁（最常用）

```sql
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_locks blocked_locks
ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocking_locks
ON blocking_locks.locktype = blocked_locks.locktype
AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking
ON blocking.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

结果类似：

```
blocked_pid | blocking_pid
------------+-------------
12345       | 67890
```

表示：

```
12345 等待 67890 释放锁
```

---

# 3. 查看正在执行的 SQL

通常和 `pg_locks` 一起看：

```sql
SELECT
    pid,
    usename,
    state,
    query,
    query_start
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start;
```

关注：

- 执行时间长
    
- idle in transaction
    

---

# 4. 查看表锁

根据表名：

```sql
SELECT
    l.pid,
    c.relname,
    l.mode,
    l.granted
FROM pg_locks l
JOIN pg_class c
ON l.relation = c.oid
WHERE c.relname='orders';
```

例如：

```
pid    relname    mode              granted
------------------------------------------------
1234   orders     RowExclusiveLock  true
5678   orders     AccessShareLock   true
```

---

# 5. PostgreSQL 常见锁类型

## AccessShareLock

普通查询：

```sql
SELECT *
FROM users;
```

产生：

```
AccessShareLock
```

---

## RowExclusiveLock

修改数据：

```sql
INSERT
UPDATE
DELETE
```

产生：

```
RowExclusiveLock
```

---

## AccessExclusiveLock

最强锁。

例如：

```sql
ALTER TABLE
DROP TABLE
TRUNCATE
```

会阻塞大量操作。

---

# 6. 查询未提交事务

非常重要：

```sql
SELECT
    pid,
    usename,
    state,
    xact_start,
    query
FROM pg_stat_activity
WHERE state='idle in transaction';
```

例如：

```
pid     xact_start
--------------------------
1234    10:00:01
```

说明：

事务打开很久，但是没有提交。

可能导致：

- 锁不释放
    
- vacuum 无法清理
    
- 表膨胀
    

---

# 7. 找出最长事务

```sql
SELECT
    pid,
    now()-xact_start AS duration,
    query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY duration DESC;
```

---

# 8. 终止阻塞连接

先查看：

```sql
SELECT pid,query
FROM pg_stat_activity;
```

取消 SQL：

```sql
SELECT pg_cancel_backend(pid);
```

例如：

```sql
SELECT pg_cancel_backend(12345);
```

只是取消当前 SQL。

---

强制断开：

```sql
SELECT pg_terminate_backend(pid);
```

例如：

```sql
SELECT pg_terminate_backend(12345);
```

会：

- 回滚事务
    
- 释放锁
    

生产环境需要谨慎。

---

# 9. 查看死锁风险

查看等待：

```sql
SELECT
    pid,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE wait_event IS NOT NULL;
```

例如：

```
wait_event_type | wait_event
--------------------------------
Lock            | relation
```

表示正在等待锁。

---

# 10. 常见排查流程

生产遇到：

> SQL 卡住

一般：

### ① 找等待

```sql
SELECT *
FROM pg_stat_activity
WHERE wait_event IS NOT NULL;
```

↓

### ② 找锁

```sql
SELECT *
FROM pg_locks;
```

↓

### ③ 找阻塞者

```sql
pg_stat_activity + pg_locks
```

↓

### ④ 判断

- 是否长事务
    
- 是否 DDL
    
- 是否忘记 commit
    

↓

### ⑤ 处理

```sql
pg_cancel_backend()
```

或：

```sql
pg_terminate_backend()
```

---

运维场景中，`pg_locks + pg_stat_activity + pg_stat_user_tables` 基本是 PostgreSQL 锁问题排查的三件套。