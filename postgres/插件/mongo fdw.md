# MongoDB FDW 使用介绍（PostgreSQL 访问 MongoDB）

`mongo_fdw` 是 PostgreSQL 的 Foreign Data Wrapper（外部数据封装器）插件，可以让 PostgreSQL **直接访问 MongoDB 集合（collection）**，在 PG 中像查询表一样查询 MongoDB 数据。

适用场景：

- PostgreSQL 与 MongoDB 数据融合
    
- 数据迁移
    
- 报表查询
    
- 异构数据库联查
    
- MongoDB 数据分析
    

架构：

```
PostgreSQL
    |
    |  mongo_fdw
    |
    ↓
MongoDB Collection
```

---

# 1. 环境要求

示例：

```
PostgreSQL 15
MongoDB 6.x
Linux
```

需要：

- PostgreSQL
- MongoDB 客户端库
- mongo_fdw 扩展


---

# 2. 安装 mongo_fdw

## 方式一：源码编译（传统方式）

安装依赖：

Ubuntu：

```bash
apt install gcc make git
apt install postgresql-server-dev-15
apt install libbson-dev
apt install libmongoc-dev
```

下载：

```bash
git clone https://github.com/EnterpriseDB/mongo_fdw.git
```

编译：

```bash
cd mongo_fdw

make

make install
```

安装后检查：

```bash
ls /usr/share/postgresql/15/extension/
```

应该看到：

```
mongo_fdw.control
mongo_fdw--*.sql
```

---

## 方式二：已有 RPM/DEB 包

部分发行版或 EDB 仓库提供：

```bash
yum install mongo_fdw
```

或者：

```bash
apt install postgresql-15-mongo-fdw
```

（根据系统仓库情况）

---

# 3. PostgreSQL 创建扩展

进入数据库：

```bash
psql -d testdb
```

执行：

```sql
CREATE EXTENSION mongo_fdw;
```

检查：

```sql
\dx
```

结果：

```
mongo_fdw | 1.1
```

---

# 4. 创建 MongoDB Server

假设 MongoDB：

```
IP:
192.168.1.100

端口:
27017

数据库:
test
```

创建：

```sql
CREATE SERVER mongo_server
FOREIGN DATA WRAPPER mongo_fdw
OPTIONS (
    address '192.168.1.100',
    port '27017'
);
```

---

# 5. 创建用户映射

MongoDB 用户：

```
mongo_user
mongo_pass
```

PG：

```sql
CREATE USER MAPPING FOR postgres
SERVER mongo_server
OPTIONS (
    username 'mongo_user',
    password 'mongo_pass'
);
```

---

# 6. 创建 MongoDB 外部表

MongoDB：

```
database:
test

collection:
users
```

PG：

```sql
CREATE FOREIGN TABLE users_fdw
(
    id text,
    name text,
    age int,
    address text
)
SERVER mongo_server
OPTIONS (
    database 'test',
    collection 'users'
);
```

---

# 7. 查询 MongoDB

现在直接：

```sql
SELECT *
FROM users_fdw;
```

实际访问：

```
PostgreSQL SQL
       |
       ↓
mongo_fdw
       |
       ↓
MongoDB users collection
```

---

# 8. 条件查询

例如：

```sql
SELECT *
FROM users_fdw
WHERE age > 30;
```

mongo_fdw 会尝试下推条件：

PG：

```sql
WHERE age > 30
```

转换：

Mongo:

```javascript
{
 age:{
   $gt:30
 }
}
```

---

# 9. 查看 MongoDB 外表

psql：

```sql
\det
```

结果：

```
Schema | Table
-------+-------------
public | users_fdw
```

查看详情：

```sql
\d+ users_fdw
```

---

# 10. 查看 FDW 配置

## 查看 FDW

```sql
\dew
```

---

## 查看 Server

```sql
\des
```

SQL：

```sql
SELECT *
FROM pg_foreign_server;
```

---

## 查看 Mapping

```sql
\deu
```

---

# 11. 插入 MongoDB

如果版本支持：

```sql
INSERT INTO users_fdw
VALUES
(
'1001',
'tom',
25,
'beijing'
);
```

对应：

MongoDB：

```javascript
{
 id:"1001",
 name:"tom",
 age:25,
 address:"beijing"
}
```

---

# 12. 更新 MongoDB

```sql
UPDATE users_fdw
SET age=30
WHERE id='1001';
```

---

# 13. 删除

```sql
DELETE FROM users_fdw
WHERE id='1001';
```

---

# 14. 常见问题

## 1）字段类型不匹配

MongoDB：

```json
{
 age:"20"
}
```

PG：

```sql
age int
```

可能报错。

建议：

```sql
age text
```

或者转换。

---

## 2）Mongo ObjectId

MongoDB:

```javascript
_id:ObjectId(...)
```

PG：

```sql
id text
```

例如：

```sql
SELECT _id
FROM users_fdw;
```

---

## 3）性能问题

不要：

```sql
SELECT *
FROM mongo_table;
```

大集合扫描。

建议：

限制：

```sql
SELECT *
FROM mongo_table
WHERE id='100';
```

MongoDB 建索引：

```javascript
db.users.createIndex(
{
 id:1
}
)
```

---

# 15. 生产使用建议

## 推荐架构

```
MongoDB
    |
    |
 mongo_fdw
    |
    |
 PostgreSQL
    |
    |
 数据分析/BI
```

适合：

✅ 小规模查询  
✅ 报表  
✅ 数据同步

不适合：

❌ 大量 JOIN  
❌ 高并发 OLTP  
❌ 全量扫描 MongoDB

---

# 16. 数据迁移场景

Mongo → PostgreSQL：

```sql
CREATE TABLE users AS
SELECT *
FROM users_fdw;
```

增量同步：

```sql
INSERT INTO pg_users
SELECT *
FROM users_fdw
WHERE update_time > now()-interval '1 day';
```

---

# 17. 删除配置

删除外表：

```sql
DROP FOREIGN TABLE users_fdw;
```

删除 Server：

```sql
DROP SERVER mongo_server CASCADE;
```

删除扩展：

```sql
DROP EXTENSION mongo_fdw;
```

---

## 运维常用检查

```sql
-- 查看 FDW
\dew

-- 查看 Mongo Server
\des

-- 查看外表
\det

-- 查看外表定义
\d+ users_fdw

-- 测试连接
SELECT count(*) FROM users_fdw;
```

---

补充：如果是**生产环境 PostgreSQL 访问 MongoDB**，现在也常用 **MongoDB 官方 Connector / ETL（如 Debezium CDC、Kafka、Airbyte）** 替代 `mongo_fdw`，因为 FDW 更适合查询联邦，不适合大数据量同步。




#### 修改server配置
你可以使用 `ALTER SERVER` 命令来修改外部服务器的选项。

  

因为这两个 server 当前的端口（port）已经是 `27017`，所以你只需要将 `address` 的值修改为 `127.0.0.1` 即可。

  

请在 `psql` 命令行中执行以下 SQL 语句：

  

SQL

```
-- 修改 aif 服务器的地址
ALTER SERVER aif OPTIONS (SET address '127.0.0.1');

-- 修改 mongo_server 服务器的地址
ALTER SERVER mongo_server OPTIONS (SET address '127.0.0.1');
```

**补充说明：**

如果你想在一条命令中同时显式指定修改 IP 和端口（即使端口没变），语法是这样的：

  

SQL

```
ALTER SERVER aif OPTIONS (SET address '127.0.0.1', SET port '27017');
ALTER SERVER mongo_server OPTIONS (SET address '127.0.0.1', SET port '27017');
```

修改完成后，你可以再次使用 `\des+ aif` 和 `\des+ mongo_server` 来验证修改结果。