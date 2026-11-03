# DuckDB SQL 完整使用指南

> 最后更新：2026-08-27
> 适用版本：DuckDB v1.5.x / v2.0
> 官方文档：https://duckdb.org/docs/current/

---

## 目录

1. [概述与特点](#一概述与特点)
2. [数据类型](#二数据类型)
3. [表达式与运算符](#三表达式与运算符)
4. [基础查询 (SELECT)](#四基础查询-select)
5. [过滤与排序 (WHERE / ORDER BY / LIMIT)](#五过滤与排序)
6. [聚合与分组 (GROUP BY / HAVING)](#六聚合与分组)
7. [JOIN 连接](#七join-连接)
8. [子查询](#八子查询)
9. [CTE 与递归 CTE](#九cte-与递归-cte)
10. [窗口函数](#十窗口函数)
11. [集合操作](#十一集合操作)
12. [PIVOT / UNPIVOT 数据透视](#十二pivot--unpivot-数据透视)
13. [SAMPLE 采样](#十三sample-采样)
15. [COPY 与数据导入导出](#十四copy-与数据导入导出)
15. [数据变更 (DML)](#十五数据变更-dml)
16. [数据定义 (DDL)](#十六数据定义-ddl)
17. [视图](#十七视图)
18. [索引](#十八索引)
19. [序列](#十九序列)
20. [宏 (Macro)](#二十宏-macro)
21. [预处理语句](#二十一预处理语句)
22. [事务](#二十二事务)
23. [EXPLAIN / EXPLAIN ANALYZE](#二十三explain--explain-analyze)
24. [PRAGMA / SET](#二十四pragma--set)
25. [半结构化数据 (JSON / LIST / STRUCT / MAP)](#二十五半结构化数据)
26. [全文搜索 (FTS)](#二十六全文搜索-fts)

---

## 一、概述与特点

DuckDB 是一个**进程内（in-process）的 OLAP 数据库**，类似 SQLite 之于客户端应用。它的 SQL 实现**高度兼容 PostgreSQL**，同时针对分析型负载做了大量优化。

**特点：**
- **嵌入式**：单个库文件，无独立 server
- **列式存储 + 向量化执行**：OLAP 性能极佳
- **零配置**：无需建账号、设权限、调参数
- **丰富的数据源**：直接读 CSV / Parquet / JSON / Excel / 数据库
- **ACID 事务**：支持 MVCC、快照隔离

---

## 二、数据类型

### 2.1 数值类型

| 类型 | 描述 |
|------|------|
| `TINYINT` / `INT1` | 1 字节有符号整数 |
| `SMALLINT` / `INT2` | 2 字节有符号整数 |
| `INTEGER` / `INT4` / `INT` | 4 字节有符号整数 |
| `BIGINT` / `INT8` | 8 字节有符号整数 |
| `HUGEINT` / `INT128` | 128 位整数 |
| `UTINYINT` / `USMALLINT` / `UINTEGER` / `UBIGINT` | 无符号整数 |
| `FLOAT` / `REAL` | 4 字节浮点 |
| `DOUBLE` | 8 字节浮点 |
| `DECIMAL(precision, scale)` / `NUMERIC` | 精确小数 |
| `BOOL` / `BOOLEAN` | 布尔 |

### 2.2 字符串类型

| 类型 | 描述 |
|------|------|
| `VARCHAR` / `TEXT` / `STRING` | UTF-8 字符串 |
| `BLOB` | 二进制大对象 |

### 2.3 日期/时间类型

| 类型 | 格式 | 描述 |
|------|------|------|
| `DATE` | `YYYY-MM-DD` | 日期 |
| `TIME` | `HH:MM:SS[.SSS]` | 时间 |
| `TIMESTAMP` | `YYYY-MM-DD HH:MM:SS[.SSS]` | 时间戳（无时区） |
| `TIMESTAMP WITH TIME ZONE` / `TIMESTAMPTZ` | 同上 + 时区 | 带时区时间戳 |
| `INTERVAL` | `1 year 2 months 3 days ...` | 时间间隔 |

### 2.4 结构化类型

| 类型 | 示例 |
|------|------|
| `LIST` | `[1, 2, 3]` |
| `STRUCT` | `{'name': 'Alice', 'age': 30}` |
| `MAP` | `MAP {'a': 1, 'b': 2}` |
| `UNION` | `UNION(num INTEGER, str VARCHAR)` |

### 2.5 半结构化

- `JSON`（v1.5+ 原生 JSON 类型，可直接存 JSON 文本）

---

## 三、表达式与运算符

### 3.1 比较运算符

`=` `!=` `<>` `<` `>` `<=` `>=`

```sql
SELECT * FROM users WHERE age >= 18 AND age <= 65;
```

### 3.2 逻辑运算符

`AND` `OR` `NOT`

### 3.3 算术运算符

`+` `-` `*` `/` `%` `**`（幂）

### 3.4 字符串运算符

```sql
-- 拼接
SELECT 'Hello' || ' ' || 'World';
-- LIKE / ILIKE
SELECT * FROM users WHERE name LIKE 'A%';
SELECT * FROM users WHERE name ILIKE 'a%';  -- 不区分大小写
-- 正则
SELECT * FROM logs WHERE msg ~ 'error.*timeout';
```

### 3.5 特殊语法糖

```sql
-- BETWEEN
WHERE age BETWEEN 18 AND 65;
-- IN
WHERE country IN ('US', 'CN', 'JP');
-- IS NULL / IS NOT NULL
WHERE email IS NOT NULL;
```

---

## 四、基础查询 (SELECT)

```sql
SELECT col1, col2 AS alias, expr1 + expr2 AS computed
FROM table_name
[WHERE condition]
[GROUP BY ...]
[HAVING ...]
[ORDER BY ...]
[LIMIT n OFFSET m];
```

### 4.1 DISTINCT

```sql
SELECT DISTINCT country FROM users;
```

### 4.2 通配符

```sql
SELECT * FROM users;
SELECT u.*, o.total FROM users u;
```

---

## 五、过滤与排序

### 5.1 WHERE

```sql
SELECT * FROM orders
WHERE status = 'completed'
  AND order_date >= '2026-01-01'
  AND total > 100;
```

### 5.2 ORDER BY

```sql
SELECT * FROM products ORDER BY price DESC, name ASC;
-- NULL 排序控制
ORDER BY price DESC NULLS LAST;
```

### 5.3 LIMIT / OFFSET

```sql
SELECT * FROM logs ORDER BY ts DESC LIMIT 100 OFFSET 200;
-- 等价于分页第 3 页
```

### 5.4 FETCH FIRST

```sql
SELECT * FROM logs ORDER BY ts DESC
FETCH FIRST 10 ROWS ONLY;
```

---

## 六、聚合与分组

```sql
SELECT
    category,
    COUNT(*)        AS n,
    AVG(price)      AS avg_price,
    MIN(price)      AS min_price,
    MAX(price)      AS max_price,
    SUM(quantity)   AS total_qty,
    LISTAGG(name, ', ') AS names  -- DuckDB 特有
FROM products
GROUP BY category
HAVING AVG(price) > 10
ORDER BY n DESC;
```

### 6.1 GROUP BY ALL（DuckDB 简化语法）

自动按 SELECT 中所有非聚合列分组：

```sql
SELECT category, region, COUNT(*), SUM(sales)
FROM sales
GROUP BY ALL;
```

### 6.2 过滤聚合（DuckDB 特有 FILTER 子句）

```sql
SELECT
    COUNT(*)                    AS total,
    COUNT(*) FILTER (WHERE status = 'ok')  AS ok_count,
    SUM(amount) FILTER (WHERE region = 'CN') AS cn_amount
FROM orders;
```

---

## 七、JOIN 连接

### 7.1 INNER JOIN

```sql
SELECT o.id, c.name, o.total
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id;
```

### 7.2 LEFT / RIGHT / FULL OUTER JOIN

```sql
SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;
SELECT * FROM a RIGHT JOIN b ON a.id = b.a_id;
SELECT * FROM a FULL OUTER JOIN b ON a.id = b.a_id;
```

### 7.3 CROSS JOIN

```sql
SELECT * FROM colors CROSS JOIN sizes;  -- 笛卡尔积
```

### 7.4 ASOF JOIN（时序数据专用）

匹配**最近且不超过**的记录：

```sql
SELECT t.time, t.symbol, q.price
FROM trades t
ASOF JOIN quotes q
  ON t.symbol = q.symbol
 AND t.time >= q.time;  -- 取引语时间 ≤ trade 时间的最近一条
```

### 7.5 LATERAL JOIN（相关子查询当表）

```sql
SELECT u.id, recent.order_count
FROM users u, LATERAL (
    SELECT COUNT(*) AS order_count
    FROM orders o
    WHERE o.user_id = u.id
) recent;
```

### 7.6 NATURAL JOIN / USING

```sql
SELECT * FROM a NATURAL JOIN b;
SELECT * FROM a JOIN b USING (id);
```

---

## 八、子查询

### 8.1 标量子查询

```sql
SELECT name, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;
```

### 8.2 IN / EXISTS

```sql
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);

SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

---

## 九、CTE 与递归 CTE

### 9.1 普通 CTE

```sql
WITH active_users AS (
    SELECT * FROM users WHERE active = true
),
top_spenders AS (
    SELECT user_id, SUM(total) AS spent
    FROM orders
    WHERE user_id IN (SELECT id FROM active_users)
    GROUP BY user_id
)
SELECT u.name, ts.spent
FROM active_users u JOIN top_spenders ts ON u.id = ts.user_id
ORDER BY ts.spent DESC LIMIT 10;
```

### 9.2 递归 CTE（WITH RECURSIVE）

**示例：组织架构遍历**

```sql
WITH RECURSIVE org_tree AS (
    -- 基础：根节点
    SELECT id, name, manager_id, 0 AS depth, [name] AS path
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    -- 递归：下级员工
    SELECT e.id, e.name, e.manager_id, t.depth + 1, list_append(t.path, e.name)
    FROM employees e
    JOIN org_tree t ON e.manager_id = t.id
)
SELECT * FROM org_tree ORDER BY depth, name;
```

**示例：数字序列生成**

```sql
WITH RECURSIVE nums AS (
    SELECT 1 AS n
    UNION ALL
    SELECT n + 1 FROM nums WHERE n < 100
)
SELECT * FROM nums;
```

---

## 十、窗口函数

### 10.1 OVER 基础

```sql
SELECT
    name,
    salary,
    department,
    AVG(salary) OVER (PARTITION BY department) AS dept_avg,
    RANK()       OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank
FROM employees;
```

### 10.2 排名函数

```sql
ROW_NUMBER() OVER (...)   -- 唯一递增序号
RANK()       OVER (...)   -- 相同值同名次，跳号
DENSE_RANK() OVER (...)   -- 相同值同名次，不跳号
PERCENT_RANK() OVER (...) -- 百分比排名
CUME_DIST()   OVER (...)  -- 累积分布
NTILE(4)      OVER (...)  -- 四分位
```

### 10.3 偏移函数

```sql
LAG(col, 1, default)   OVER (...)  -- 上一行
LEAD(col, 1, default)  OVER (...)  -- 下一行
FIRST_VALUE(col)       OVER (...)  -- 分区内第一个
LAST_VALUE(col)        OVER (...)  -- 分区内最后一个
NTH_VALUE(col, n)      OVER (...)  -- 分区内第 n 个
```

### 10.4 窗口帧（Frame）

```sql
SELECT
    ts,
    value,
    AVG(value) OVER (
        ORDER BY ts
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW   -- 7 行移动平均
    ) AS moving_avg_7
FROM metrics;
```

帧类型：`ROWS` / `RANGE` / `GROUPS`
边界：`UNBOUNDED PRECEDING` / `n PRECEDING` / `CURRENT ROW` / `n FOLLOWING` / `UNBOUNDED FOLLOWING`

### 10.5 命名窗口（WINDOW 子句）

```sql
SELECT
    name,
    salary,
    SUM(salary)   OVER w AS cum_sum,
    RANK()        OVER w AS rk,
    AVG(salary)   OVER w AS avg_sal
FROM employees
WINDOW w AS (PARTITION BY department ORDER BY salary)
ORDER BY department, salary;
```

---

## 十一、集合操作

```sql
SELECT id FROM a
UNION          -- 去重
SELECT id FROM b;

SELECT id FROM a
UNION ALL      -- 不去重
SELECT id FROM b;

SELECT id FROM a
INTERSECT
SELECT id FROM b;

SELECT id FROM a
EXCEPT         -- 差集
SELECT id FROM b;
```

---

## 十二、PIVOT / UNPIVOT 数据透视

### 12.1 PIVOT（行转列）

```sql
-- 把每个 product 的月度销售转成列
SELECT * FROM (
    SELECT product, month, sales FROM monthly_sales
)
PIVOT (
    SUM(sales) AS total
    FOR month IN ('Jan', 'Feb', 'Mar')
);
```

### 12.2 UNPIVOT（列转行）

```sql
SELECT * FROM quarterly_sales
UNPIVOT (
    sales_amount FOR quarter IN (q1, q2, q3, q4)
);
```

---

## 十三、SAMPLE 采样

```sql
-- 随机抽 10%
SELECT * FROM large_table USING SAMPLE 10%;
-- 抽 1000 行
SELECT * FROM large_table USING SAMPLE 1000 ROWS;
-- reservoir sampling（可复现）
SELECT * FROM large_table USING SAMPLE 10% RESERVOIR(42);
```

---

## 十四、COPY 与数据导入导出

### 14.1 从文件读取

```sql
-- CSV
SELECT * FROM read_csv('data.csv', auto_detect=true);
COPY table_name FROM 'data.csv' (HEADER, DELIMITER ',');

-- Parquet
SELECT * FROM read_parquet('data.parquet');
COPY table_name FROM 'data.parquet';

-- JSON
SELECT * FROM read_json('data.json', auto_detect=true);
COPY table_name FROM 'data.json' (FORMAT 'json', auto_detect=true);

-- 多文件/通配符
SELECT * FROM read_parquet('logs/*.parquet');

-- 直接当表用
SELECT * FROM 'data.parquet';
```

### 14.2 写入文件

```sql
COPY (SELECT * FROM users WHERE active = true)
TO 'active.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (SELECT * FROM sales)
TO 'sales.csv' (HEADER, DELIMITER ',');
```

### 14.3 read_csv 高级选项

```sql
SELECT * FROM read_csv(
    'data.csv',
    header          = true,
    delimiter       = ',',
    quote           = '"',
    escape          = '"',
    null_string     = ['', 'NULL', 'NA'],
    skip            = 0,
    nrows           = 100000,
    columns         = {'id': 'INTEGER', 'name': 'VARCHAR'},
    types           = ['INTEGER', 'VARCHAR'],
    sample_size     = 10000,    -- 自动类型推断的采样行数
    all_varchar     = false,
    auto_detect     = true
);
```

---

## 十五、数据变更 (DML)

### 15.1 INSERT

```sql
INSERT INTO users (id, name, email)
VALUES (1, 'Alice', 'a@example.com');

INSERT INTO users
SELECT id, name, email FROM staging_users;
```

### 15.2 UPDATE

```sql
UPDATE users SET active = false WHERE last_login < '2025-01-01';

-- 用表关联更新
UPDATE users
SET country = c.code
FROM country_mapping c
WHERE users.ip_country = c.name;
```

### 15.3 DELETE

```sql
DELETE FROM logs WHERE ts < '2025-01-01';

DELETE FROM users
WHERE id IN (SELECT user_id FROM banned_users);
```

### 15.4 MERGE（UPSERT）

```sql
MERGE INTO target t
USING source s
ON t.id = s.id
WHEN MATCHED THEN
    UPDATE SET value = s.value, updated_at = now()
WHEN NOT MATCHED THEN
    INSERT (id, value, created_at) VALUES (s.id, s.value, now());
```

### 15.5 TRUNCATE

```sql
TRUNCATE TABLE logs;
TRUNCATE TABLE logs RESTART IDENTITY;  -- 重置自增
```

---

## 十六、数据定义 (DDL)

### 16.1 CREATE TABLE

```sql
CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    email       VARCHAR UNIQUE NOT NULL,
    name        VARCHAR,
    age         INTEGER CHECK (age >= 0),
    created_at  TIMESTAMP DEFAULT current_timestamp,
    metadata    STRUCT(name VARCHAR, tags LIST<VARCHAR>)
);

-- 从查询结果建表
CREATE TABLE active_users AS
SELECT * FROM users WHERE active = true;

-- 只建表结构
CREATE TABLE users_backup AS SELECT * FROM users WHERE 1=0;
```

### 16.2 ALTER TABLE

```sql
ALTER TABLE users ADD COLUMN phone VARCHAR;
ALTER TABLE users DROP COLUMN phone;
ALTER TABLE users RENAME COLUMN name TO full_name;
ALTER TABLE users RENAME TO members;
ALTER TABLE users ALTER COLUMN age SET DEFAULT 0;
```

### 16.3 DROP

```sql
DROP TABLE users;
DROP TABLE IF EXISTS users;
DROP TABLE users CASCADE;  -- 删依赖
```

### 16.4 临时表

```sql
CREATE TEMP TABLE tmp_results (id INTEGER, val DOUBLE);
```

### 16.5 主键 / 外键 / UNIQUE / CHECK

```sql
CREATE TABLE orders (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id),
    total      DECIMAL(10,2) CHECK (total >= 0),
    UNIQUE (user_id, order_no)
);
```

---

## 十七、视图

### 17.1 普通视图

```sql
CREATE VIEW active_users AS
SELECT id, name, email FROM users WHERE active = true;

SELECT * FROM active_users;
```

### 17.2 物化视图（结果持久化的视图）

```sql
CREATE MATERIALIZED VIEW daily_sales AS
SELECT
    date_trunc('day', order_time) AS day,
    SUM(total) AS sales
FROM orders
GROUP BY day;

-- 刷新
REFRESH MATERIALIZED VIEW daily_sales;
```

### 17.3 递归视图

```sql
CREATE RECURSIVE VIEW org_tree AS
SELECT id, name, manager_id, 0 AS depth
FROM employees
WHERE manager_id IS NULL
UNION ALL
SELECT e.id, e.name, e.manager_id, t.depth + 1
FROM employees e JOIN org_tree t ON e.manager_id = t.id;
```

---

## 十八、索引

### 18.1 创建索引

DuckDB 默认对主键、UNIQUE 约束自动创建索引（**ART — Adaptive Radix Tree**）。

```sql
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_username ON users(username);
```

### 18.2 ART 索引

DuckDB 使用 ART 自适应基数树索引，适合：
- 高基数列（很多不同值）
- 等值查询、范围查询

不推荐对低基数列（如性别）建索引——DuckDB 的 min/max 索引自动会做。

### 18.3 删除

```sql
DROP INDEX idx_users_email;
```

---

## 十九、序列

```sql
CREATE SEQUENCE user_id_seq START 1 INCREMENT 1;

SELECT nextval('user_id_seq');   -- 下一个
SELECT currval('user_id_seq');   -- 当前

-- 在 INSERT 中使用
INSERT INTO users (id, name) VALUES (nextval('user_id_seq'), 'Alice');

DROP SEQUENCE user_id_seq;
```

---

## 二十、宏 (Macro)

### 20.1 标量宏

```sql
CREATE MACRO add(a, b) AS a + b;
SELECT add(1, 2);  -- 3
```

### 20.2 表宏

```sql
CREATE MACRO top_n(t, n) AS TABLE
SELECT * FROM t ORDER BY 1 LIMIT n;

SELECT * FROM top_n(orders, 10);
```

### 20.3 带默认值

```sql
CREATE MACRO greet(name := 'World') AS 'Hello, ' || name || '!';
SELECT greet();             -- Hello, World!
SELECT greet('Alice');      -- Hello, Alice!
```

---

## 二十一、预处理语句

### 21.1 PREPARE / EXECUTE

```sql
PREPARE get_user AS SELECT * FROM users WHERE id = $1;

EXECUTE get_user(42);
EXECUTE get_user(43);
```

### 21.2 DEALLOCATE

```sql
DEALLOCATE get_user;
DEALLOCATE ALL;
```

### 21.3 Python API 中使用

```python
import duckdb
con = duckdb.connect()
con.execute("PREPARE get_user AS SELECT * FROM users WHERE id = ?")
result = con.execute("EXECUTE get_user(?)", [42]).fetchall()
```

---

## 二十二、事务

DuckDB 默认 **ACID**、**MVCC**、**快照隔离**。

```sql
BEGIN;          -- 或 BEGIN TRANSACTION
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;         -- 提交

-- 失败回滚
BEGIN;
UPDATE ...;
ROLLBACK;       -- 撤销
```

### 22.1 SAVEPOINT（v1.4+）

```sql
BEGIN;
INSERT INTO logs ...;
SAVEPOINT sp1;
INSERT INTO logs ...;  -- 失败
ROLLBACK TO SAVEPOINT sp1;
INSERT INTO logs ...;  -- 重试
COMMIT;
```

---

## 二十三、EXPLAIN / EXPLAIN ANALYZE

### 23.1 查看执行计划

```sql
EXPLAIN SELECT * FROM users JOIN orders ON users.id = orders.user_id;
```

### 23.2 实际执行统计

```sql
EXPLAIN ANALYZE
SELECT u.name, COUNT(*) FROM users u JOIN orders o ON u.id = o.user_id
GROUP BY u.name;
```

输出包含每步的实际行数、耗时、内存使用，帮助定位性能瓶颈。

---

## 二十四、PRAGMA / SET

### 24.1 PRAGMA（运行时配置）

```sql
PRAGMA threads=8;                  -- 并行线程数
PRAGMA memory_limit='4GB';         -- 内存上限
PRAGMA temp_directory='/tmp/duckdb'; -- 临时文件目录
PRAGMA enable_progress_bar;        -- 启用进度条
PRAGMA enable_optimizer;           -- 启用优化器
PRAGMA enable_object_cache;        -- 启用对象缓存
PRAGMA checkpoint_threshold='1GB'; -- checkpoint 阈值
PRAGMA version;                    -- 查看版本
PRAGMA database_list;              -- 所有数据库
PRAGMA show_tables;                -- 当前表列表
PRAGMA table_info('users');        -- 表结构
PRAGMA functions;                  -- 所有函数
```

### 24.2 SET（会话级设置）

```sql
SET threads = 8;
SET memory_limit = '4GB';
SET schema = 'analytics';
SET search_path = 'main,analytics';
```

### 24.3 重置

```sql
RESET threads;
RESET ALL;
```

---

## 二十五、半结构化数据

### 25.1 LIST 操作

```sql
-- 创建
SELECT [1, 2, 3] AS lst;

-- 访问（下标从 1 开始）
SELECT lst[1], lst[-1] FROM (SELECT [1, 2, 3] AS lst);

-- 展开
SELECT unnest([1, 2, 3]);
SELECT * FROM unnest([1, 2, 3]) AS t(x);

-- LIST 函数
SELECT list_length([1,2,3]);
SELECT list_concat([1,2], [3,4]);
SELECT list_sort([3,1,2]);
SELECT list_distinct([1,1,2,3]);
SELECT list_aggregate([1,2,3], 'sum');
SELECT list_transform([1,2,3], x -> x * 2);  -- [2,4,6]
SELECT list_filter([1,2,3,4], x -> x > 2);   -- [3,4]
```

### 25.2 STRUCT 操作

```sql
-- 创建
SELECT {'name': 'Alice', 'age': 30} AS s;

-- 字段访问
SELECT s.name, s.age FROM (SELECT {'name': 'Alice', 'age': 30} AS s);

-- 函数
SELECT struct_pack(a := 1, b := 'x');
SELECT struct_extract(s, 'name');
```

### 25.3 MAP 操作

```sql
SELECT MAP {'a': 1, 'b': 2} AS m;
SELECT m['a'] FROM (SELECT MAP {'a': 1} AS m);
SELECT map_keys(MAP {'a': 1, 'b': 2});   -- [a, b]
SELECT map_values(MAP {'a': 1, 'b': 2}); -- [1, 2]
```

### 25.4 JSON

DuckDB v1.5+ 提供原生 JSON 类型。

```sql
-- 直接构造 JSON
SELECT json('{"a": 1, "b": [2, 3]}');

-- 从 JSON 文本
SELECT '{"a": 1}'::JSON;

-- 访问
SELECT json_extract('{"a": {"b": 1}}', '$.a.b');   -- 1
SELECT json_extract_string('{"name": "Alice"}', '$.name');  -- 'Alice'

-- 展开 JSON 数组为表
SELECT * FROM json_each('[1, 2, 3]');
SELECT * FROM json_keys('{"a": 1, "b": 2}');
SELECT json_structure('{"a": 1, "b": [2, 3]}');
```

### 25.5 嵌套类型与 GROUP BY / ORDER BY

```sql
-- LIST 可比较
SELECT * FROM t ORDER BY lst;

-- STRUCT 也可比较
SELECT * FROM t ORDER BY s;
```

---

## 二十六、全文搜索 (FTS)

DuckDB 提供 **FTS 扩展**（类似 Lucene 的全文检索）。

### 26.1 安装

```sql
INSTALL fts;
LOAD fts;
```

### 26.2 建索引

```sql
PRAGMA create_fts_index('docs', 'id', 'title', 'body');
```

### 26.3 查询

```sql
-- 匹配
SELECT * FROM docs WHERE fts_main_docs.match_bm25(id, 'duckdb analytics') IS NOT NULL;

-- 高亮
SELECT id, fts_main_docs.highlight(title, body) FROM docs
WHERE fts_main_docs.match_bm25(id, 'duckdb') IS NOT NULL;
```

---

## 附录：常用函数速查

### A. 字符串函数

```sql
length(s), upper(s), lower(s), trim(s), ltrim(s), rtrim(s)
substring(s, start, length), left(s, n), right(s, n)
replace(s, from, to), split(s, sep)
contains(s, sub), starts_with(s, pre), ends_with(s, suf)
regexp_matches(s, pattern), regexp_extract(s, pattern, group)
regexp_replace(s, pattern, replacement)
format('Hello, {}', name)
```

### B. 日期/时间函数

```sql
current_date, current_time, current_timestamp, now()
date_part('year', ts), year(ts), month(ts), day(ts), hour(ts), minute(ts), second(ts)
date_trunc('day', ts)
date_add(ts, INTERVAL 1 DAY), date_diff('day', a, b)
age(timestamp1, timestamp2)
extract(year FROM ts)
strftime(ts, '%Y-%m-%d'), strptime(s, '%Y-%m-%d')
```

### C. 数学函数

```sql
abs, ceil, floor, round, trunc, mod
power, sqrt, exp, ln, log10
sin, cos, tan, asin, acos, atan, atan2
pi, e
random(), setseed(0.42)
```

### D. 聚合函数

```sql
count(*), count(distinct x), count_filter(x, where_clause) -- DuckDB
sum, max, min, avg, product
stddev, variance, median, mode
first, last
list, listagg
string_agg(s, sep), array_agg(x)
approx_count_distinct(x)
arg_min, arg_max
```

### E. 类型转换

```sql
CAST(x AS INTEGER)
x::INTEGER
TRY_CAST(x AS INTEGER)   -- 失败返回 NULL
```

---

## 参考资源

- [DuckDB 官方文档 — SQL](https://duckdb.org/docs/current/sql/introduction)
- [DuckDB 官方文档 — Statements](https://duckdb.org/docs/sql/statements)
- [DuckDB 官方文档 — Functions](https://duckdb.org/docs/sql/functions)
- [DuckDB 官方文档 — Data Types](https://duckdb.org/docs/sql/data-types)
- [DuckDB 数据分析实战](https://duckdb.org/why_duckdb)
- [DuckDB GitHub](https://github.com/duckdb/duckdb)

---

**作者备注：** DuckDB 演进活跃（当前 v1.5.x，已预告 v2.0），建议每季度查看官方文档获取新增特性。