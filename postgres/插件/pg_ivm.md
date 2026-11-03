`pg_ivm` 是 PostgreSQL 的一个扩展，用于实现 **增量物化视图（Incremental View Maintenance，IVM）**。

简单理解：

- 普通 `Materialized View`：数据变化后，需要 `REFRESH MATERIALIZED VIEW` 全量刷新。
    
- `pg_ivm`：底层表发生 `INSERT / UPDATE / DELETE` 时，只计算变化部分，然后自动更新物化视图。
    

适合：

- 实时统计
    
- 报表系统
    
- 数据看板
    
- 高频更新的大表聚合查询
    

---

## 1. 普通物化视图的问题

例如：

订单表：

```sql
CREATE TABLE orders (
    id bigint,
    user_id bigint,
    amount numeric,
    created_at timestamp
);
```

创建统计：

```sql
CREATE MATERIALIZED VIEW user_sales AS
SELECT
    user_id,
    sum(amount) total_amount
FROM orders
GROUP BY user_id;
```

数据新增：

```sql
INSERT INTO orders VALUES
(1,100,500,'2026-08-20');
```

此时：

```sql
SELECT * FROM user_sales;
```

还是旧数据。

需要：

```sql
REFRESH MATERIALIZED VIEW user_sales;
```

问题：

数据量大时：

- 扫描全表
    
- 消耗 CPU
    
- 延迟高
    

---

# 2. pg_ivm 创建增量物化视图

使用：

```sql
CREATE INCREMENTAL MATERIALIZED VIEW user_sales AS
SELECT
    user_id,
    sum(amount) total_amount
FROM orders
GROUP BY user_id;
```

之后：

```sql
INSERT INTO orders VALUES
(2,100,200,'2026-08-20');
```

pg_ivm 自动更新：

```sql
SELECT *
FROM user_sales;
```

结果：

```
user_id | total_amount
--------+-------------
100     |700
```

不用 refresh。

---

# 3. 手动刷新

虽然支持自动维护，也可以：

```sql
SELECT refresh_immv('user_sales');
```

通常用于：

- 初始化
    
- 修复
    
- 批量变更后
    

---

# 4. 查看增量物化视图

类似：

```sql
\d user_sales
```

或者：

```sql
SELECT *
FROM pg_matviews;
```

---

# 5. 支持哪些操作

## INSERT

支持：

```sql
INSERT INTO table;
```

例如：

原：

```
商品销量=100
```

新增：

```
+5
```

自动：

```
商品销量=105
```

---

## DELETE

删除：

```sql
DELETE FROM orders
WHERE id=10;
```

自动扣减统计。

---

## UPDATE

例如：

```sql
UPDATE orders
SET amount=1000
WHERE id=1;
```

自动调整。

---

# 6. 常见应用场景

## 实时销售统计

原始表：

```
orders
 |
 |
 pg_ivm
 |
 ↓
daily_sales
```

查询：

```sql
SELECT *
FROM daily_sales;
```

不用每天跑：

```sql
GROUP BY
```

---

## 用户行为分析

事件表：

```
events
```

统计：

```
用户访问次数
活跃用户
PV/UV
```

---

## 监控系统

例如：

服务器指标：

```
metrics
```

生成：

```
5分钟平均CPU
1小时平均内存
```

---

# 7. pg_ivm 和普通 Materialized View 对比

||Materialized View|pg_ivm|
|---|---|---|
|刷新方式|手动|自动增量|
|实时性|低|高|
|计算量|全量|变化部分|
|写入成本|低|增加|
|查询速度|快|快|
|适合报表|一般|优秀|

---

# 8. pg_ivm 和触发器区别

很多人会问：

"为什么不用 trigger?"

区别：

### Trigger

自己维护逻辑：

```
INSERT
 ↓
trigger
 ↓
update统计表
```

缺点：

- 业务代码复杂
    
- 容易出错
    
- 维护困难
    

### pg_ivm

数据库维护：

```
INSERT
 ↓
pg_ivm
 ↓
自动更新视图
```

更接近 PostgreSQL 原生能力。

---

# 9. 限制

pg_ivm 不是所有 SQL 都支持。

例如复杂：

```sql
JOIN
窗口函数
DISTINCT
复杂子查询
```

可能无法增量维护。

适合：

✅

```sql
GROUP BY
COUNT
SUM
AVG
简单 JOIN
```

不适合：

❌

```sql
复杂分析 SQL
机器学习查询
动态 SQL
```

---

# 10. 和 pgvector 的组合

两个扩展解决不同问题：

```
                PostgreSQL

        ┌───────────────┐
        │               │
     pgvector        pg_ivm
        │               │
向量搜索          实时统计
        │               │
RAG/推荐          数据看板
```

例如：

AI 知识库：

```
documents
    |
    +-- embedding(vector)
    |
    +-- pgvector 搜索


usage_log
    |
    +-- pg_ivm
          |
          +-- 热门文档统计
```

一个负责**找内容**，一个负责**实时统计内容热度**。