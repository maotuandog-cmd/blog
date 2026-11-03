# pg_jieba PostgreSQL 中文分词插件使用介绍（无需编译版）

## 1. pg_jieba 简介

`pg_jieba` 是 PostgreSQL 的中文分词扩展，基于 **jieba 中文分词库**，可以让 PostgreSQL 支持中文全文检索。

主要功能：

- 中文分词
    
- 中文全文搜索
    
- 自定义词典
    
- 分词测试
    
- 配合 PostgreSQL 全文检索（GIN 索引）
    

适用于：

- 中文文章搜索
    
- 商品搜索
    
- 日志检索
    
- 知识库检索
    
- 文档系统
    

---

# 2. 使用环境

示例：

```text
PostgreSQL >= 10
Linux
已安装 pg_jieba 扩展包
```

不需要：

- 下载源码
    
- cmake 编译
    
- gcc 编译
    
- 手工安装插件
    

直接安装 PostgreSQL 扩展包即可。

---

# 3. 安装 pg_jieba（无需编译）

## 方法一：使用系统安装包

### Ubuntu / Debian

```bash
apt update

apt install postgresql-15-pg-jieba
```

例如 PostgreSQL 15：

```bash
apt install postgresql-15-pg-jieba
```

---

### CentOS / Rocky Linux

如果仓库提供：

```bash
yum install pg_jieba
```

或者：

```bash
dnf install pg_jieba
```

---

安装完成后检查：

```bash
ls /usr/share/postgresql/*/extension/
```

看到：

```text
pg_jieba.control
pg_jieba--*.sql
```

说明安装成功。

---

# 4. 创建扩展

进入数据库：

```bash
psql -d testdb
```

执行：

```sql
CREATE EXTENSION pg_jieba;
```

查看：

```sql
\dx
```

结果：

```text
pg_jieba | 1.x | public | Chinese segmentation extension
```

---

# 5. 基础使用

## 查看分词结果

```sql
SELECT * FROM jieba_tokenize('南京市长江大桥');
```

结果类似：

```text
南京市
长江
大桥
```

---

## 测试分词

```sql
SELECT jieba('PostgreSQL数据库中文搜索测试');
```

---

# 6. 创建中文全文搜索配置

pg_jieba 提供中文解析器。

查看：

```sql
\dF
```

查看文本搜索配置：

```sql
SELECT *
FROM pg_ts_config;
```

---

创建中文配置：

```sql
CREATE TEXT SEARCH CONFIGURATION jieba_conf
(PARSER = jieba);
```

---

添加词法规则：

```sql
ALTER TEXT SEARCH CONFIGURATION jieba_conf
ADD MAPPING FOR n,v,a,i,e,l WITH simple;
```

---

测试：

```sql
SELECT
to_tsvector(
'jieba_conf',
'PostgreSQL数据库中文全文搜索'
);
```

结果：

```text
'postgresql':1
'数据库':2
'中文':3
'全文':4
'搜索':5
```

---

# 7. 表字段建立全文索引

假设文章表：

```sql
CREATE TABLE article
(
    id bigserial PRIMARY KEY,
    title text,
    content text
);
```

插入：

```sql
INSERT INTO article(title,content)
VALUES
(
'PostgreSQL中文搜索',
'pg_jieba实现数据库中文全文检索'
);
```

---

创建 GIN 索引：

```sql
CREATE INDEX idx_article_fts
ON article
USING gin(
to_tsvector(
'jieba_conf',
title || content
)
);
```

---

# 8. 中文搜索

查询：

```sql
SELECT *
FROM article
WHERE
to_tsvector(
'jieba_conf',
title || content
)
@@
to_tsquery(
'jieba_conf',
'数据库'
);
```

返回：

```text
PostgreSQL中文搜索
```

---

# 9. 自定义词典

默认 jieba：

例如：

```
阿里云数据库
```

可能被切：

```
阿里
云
数据库
```

可以添加：

```
阿里云数据库
```

作为一个词。

---

## 创建词典目录

查看：

```sql
SHOW shared_preload_libraries;
```

找到 pg_jieba 配置目录。

常见：

```bash
/usr/share/postgresql/15/tsearch_data/
```

创建：

```bash
jieba.dict
```

内容：

```
阿里云数据库
PostgreSQL
Greenplum
数据仓库
```

---

重载：

```sql
SELECT pg_reload_conf();
```

---

测试：

```sql
SELECT jieba_tokenize(
'阿里云数据库PostgreSQL'
);
```

---

# 10. 常用管理命令

查看扩展：

```sql
\dx pg_jieba
```

查看函数：

```sql
\df jieba*
```

查看配置：

```sql
\dF+
```

删除：

```sql
DROP EXTENSION pg_jieba;
```

---

# 11. 性能建议

## 不建议实时分词

不要：

```sql
WHERE jieba(content) LIKE '%关键词%'
```

原因：

- 每次重新分词
    
- 无法使用索引
    
- 大表性能差
    

---

推荐：

增加字段：

```sql
ALTER TABLE article
ADD COLUMN content_tsv tsvector;
```

维护：

```sql
UPDATE article
SET content_tsv =
to_tsvector(
'jieba_conf',
content
);
```

索引：

```sql
CREATE INDEX idx_article_tsv
ON article
USING gin(content_tsv);
```

查询：

```sql
WHERE content_tsv @@ to_tsquery('数据库');
```

---

# 12. 常见问题

## CREATE EXTENSION 找不到

错误：

```text
ERROR: extension "pg_jieba" is not available
```

检查：

```bash
find / -name pg_jieba.control
```

如果没有：

说明扩展包未安装。

---

## PostgreSQL版本不匹配

例如：

PG15：

```bash
postgresql-15-pg-jieba
```

不能直接用于：

```text
PostgreSQL 14
```

需要对应版本。

---

# 13. 推荐应用架构

生产环境：

```
业务表
 |
 |
触发器
 |
 ↓
tsvector字段
 |
 ↓
GIN索引
 |
 ↓
pg_jieba中文分词
 |
 ↓
全文搜索
```

---

## 总结

不编译安装 pg_jieba 的核心流程：

```bash
# 1. 安装插件
apt install postgresql-15-pg-jieba

# 2. 创建扩展
CREATE EXTENSION pg_jieba;

# 3. 测试分词
SELECT jieba_tokenize('中文测试');

# 4. 创建全文搜索配置

# 5. tsvector + GIN索引

# 6. tsquery查询
```

对于 PostgreSQL 中文搜索场景，`pg_jieba + tsvector + GIN` 是目前比较成熟、纯数据库内实现的方案。