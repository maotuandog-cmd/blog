PostgreSQL 查询慢 SQL 分析常用方法如下。

## 1. 查看当前正在执行的慢 SQL

### PG 9.6+

```sql
SELECT
    pid,
    usename,
    client_addr,
    now() - query_start AS duration,
    state,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY duration DESC;
```

重点看：

- `duration` 执行时间
    
- `wait_event` 是否锁等待
    
- `query` SQL 内容
    

---

## 2. 查询执行超过 N 秒的 SQL

例如超过 5 秒：

```sql
SELECT
    pid,
    now() - query_start AS runtime,
    usename,
    query
FROM pg_stat_activity
WHERE state = 'active'
AND now() - query_start > interval '5 seconds'
ORDER BY runtime DESC;
```

---

## 3. 查看历史慢 SQL（推荐）

需要开启 `pg_stat_statements`。

### 开启插件

修改：

```conf
shared_preload_libraries = 'pg_stat_statements'
```

重启 PostgreSQL。

创建：

```sql
CREATE EXTENSION pg_stat_statements;
```

---

### 查询执行最慢 SQL

按总耗时：

```sql
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

---

按平均耗时：

```sql
SELECT
    query,
    calls,
    mean_exec_time,
    total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

---

按执行次数：

```sql
SELECT
    query,
    calls,
    mean_exec_time
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

---

## 4. 分析单条 SQL

使用：

```sql
EXPLAIN ANALYZE
SQL;
```

例如：

```sql
EXPLAIN ANALYZE
SELECT *
FROM users
WHERE id=100;
```

重点看：

### 全表扫描

危险：

```
Seq Scan on users
```

说明没有走索引。

### 索引扫描

正常：

```
Index Scan using idx_users_id
```

### 实际行数差异

例如：

```
rows=100000
rows=10
```

说明统计信息不准。

执行：

```sql
ANALYZE 表名;
```

---

## 5. 查看锁导致的慢 SQL

### 当前锁

```sql
SELECT
    blocked_locks.pid AS blocked_pid,
    blocking_locks.pid AS blocking_pid,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked_activity
ON blocked_activity.pid = blocked_locks.pid
JOIN pg_locks blocking_locks
ON blocking_locks.locktype = blocked_locks.locktype
AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
AND blocking_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocking_activity
ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

---

## 6. 查看大表是否导致慢查询

表大小：

```sql
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

---

## 7. 找缺失索引

查看顺序扫描：

```sql
SELECT
    relname,
    seq_scan,
    idx_scan,
    n_live_tup
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;
```

如果：

```
seq_scan 很高
idx_scan 很低
```

可能缺索引。

---

## 8. 生产环境推荐配置

`postgresql.conf`：

```conf
log_min_duration_statement = 1000
```

记录超过 1 秒 SQL。

日志：

```bash
tail -f postgresql.log
```

---

## 运维排查流程推荐

遇到 PG 慢：

```
1. pg_stat_activity
        |
        ↓
2. 看是否锁等待
        |
        ↓
3. pg_stat_statements 找 TOP SQL
        |
        ↓
4. EXPLAIN ANALYZE
        |
        ↓
5. 优化索引/SQL
        |
        ↓
6. ANALYZE/VACUUM
```

如果是生产库，建议优先装：

```sql
CREATE EXTENSION pg_stat_statements;
```

它是 PostgreSQL 排查慢 SQL 最重要的工具。