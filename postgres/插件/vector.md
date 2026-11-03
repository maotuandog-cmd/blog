`pgvector` 的核心使用场景是：**把向量存进 PostgreSQL，然后进行相似度搜索（Similarity Search）**。下面重点介绍查询、索引优化、常用 SQL 和实际使用方式，不涉及安装。

---

## 1. 基础向量查询

假设有表：

```sql
CREATE TABLE documents (
    id bigserial PRIMARY KEY,
    content text,
    embedding vector(1536)
);
```

其中：

- `content`：文本内容
    
- `embedding`：文本对应的向量
    
- `1536`：向量维度（例如 OpenAI embedding 常见维度）
    

---

## 2. 最简单的相似度查询

### 欧氏距离（L2）

```sql
SELECT 
    id,
    content,
    embedding <-> '[0.12,0.34,...]' AS distance
FROM documents
ORDER BY embedding <-> '[0.12,0.34,...]'
LIMIT 10;
```

含义：

- `<->` 表示 L2 距离
    
- 距离越小越相似
    
- 返回最接近的 10 条
    

---

## 3. 余弦相似度查询（最常用）

大部分文本 embedding 推荐使用 cosine。

```sql
SELECT
    id,
    content,
    1 - (embedding <=> '[0.12,0.34,...]') AS similarity
FROM documents
ORDER BY embedding <=> '[0.12,0.34,...]'
LIMIT 10;
```

说明：

`<=>`：

- cosine distance
    
- 越小越相似
    

转换成相似度：

```
similarity = 1 - distance
```

例如：

|distance|similarity|
|---|---|
|0.05|0.95|
|0.20|0.80|
|0.80|0.20|

---

## 4. 内积查询

如果你的模型输出已经归一化：

```sql
SELECT
    id,
    content
FROM documents
ORDER BY embedding <#> '[0.12,0.34,...]'
LIMIT 10;
```

符号：

```
<#>
```

代表 negative inner product。

适合：

- 已经 normalize 的 embedding
    
- 部分推荐系统
    

---

# 5. 带业务条件过滤查询

实际项目通常不是全库搜索。

例如：

只搜索某个用户：

```sql
SELECT
    id,
    content
FROM documents
WHERE user_id = 100
ORDER BY embedding <=> '[0.1,0.2,...]'
LIMIT 5;
```

---

知识库场景：

```sql
SELECT
    id,
    content
FROM documents
WHERE category='技术文档'
ORDER BY embedding <=> '[0.1,0.2,...]'
LIMIT 10;
```

---

# 6. TopK + 相似度阈值

例如只要相似度 > 0.8：

```sql
SELECT *
FROM (
    SELECT
        id,
        content,
        1-(embedding <=> '[0.1,0.2,...]') similarity
    FROM documents
) t
WHERE similarity > 0.8
ORDER BY similarity DESC;
```

常用于：

- RAG
    
- FAQ机器人
    
- 搜索推荐
    

---

# 7. 创建向量索引

数据量小：

几十万以内：

直接：

```sql
ORDER BY embedding <=> query_vector
```

即可。

百万级：

需要 ANN 索引。

---

## HNSW 索引（推荐）

```sql
CREATE INDEX documents_embedding_idx
ON documents
USING hnsw
(embedding vector_cosine_ops);
```

查询：

```sql
SELECT *
FROM documents
ORDER BY embedding <=> '[...]'
LIMIT 10;
```

自动使用索引。

---

HNSW 参数调整：

```sql
SET hnsw.ef_search = 100;
```

默认：

```
40
```

提高：

- 查询准确率 ↑
    
- 查询速度 ↓
    

例如：

```sql
SET hnsw.ef_search = 200;
```

适合：

高质量搜索。

---

# 8. IVFFlat 索引

另一种：

```sql
CREATE INDEX documents_embedding_idx
ON documents
USING ivfflat
(embedding vector_cosine_ops)
WITH (lists = 100);
```

查询前：

```sql
SET ivfflat.probes = 10;
```

参数：

|参数|作用|
|---|---|
|lists|聚类数量|
|probes|搜索多少个cluster|

---

经验：

数据量：

|数据量|建议|
|---|---|
|<10万|不用索引|
|10万-100万|HNSW|
|100万以上|HNSW 或 IVFFlat|

---

# 9. 多字段 + 向量混合查询

例如：

商品搜索：

```sql
SELECT
    id,
    name,
    price,
    embedding <=> '[...]' distance
FROM products
WHERE price < 1000
ORDER BY embedding <=> '[...]'
LIMIT 20;
```

流程：

```
价格过滤
    ↓
向量召回
    ↓
排序
```

---

# 10. RAG 知识库典型查询

表：

```sql
CREATE TABLE knowledge (
    id bigint,
    question text,
    answer text,
    embedding vector(1536)
);
```

用户问题：

```
如何重启数据库？
```

生成 query embedding：

```
[0.123,0.456...]
```

查询：

```sql
SELECT
    question,
    answer,
    1-(embedding <=> '[query_vector]') score
FROM knowledge
ORDER BY embedding <=> '[query_vector]'
LIMIT 5;
```

结果：

```
问题1:
PostgreSQL如何重启服务

答案:
systemctl restart postgresql
```

然后交给 LLM 生成最终回答。

---

# 11. 分页查询注意

不要：

```sql
LIMIT 10 OFFSET 100000;
```

向量搜索分页效率很差。

推荐：

保存距离：

第一次：

```sql
LIMIT 20
```

下一页：

使用游标方式。

例如：

```sql
WHERE distance > last_distance
```

---

# 12. 查看执行计划

确认是否走索引：

```sql
EXPLAIN ANALYZE
SELECT *
FROM documents
ORDER BY embedding <=> '[...]'
LIMIT 10;
```

看到：

```
Index Scan using documents_embedding_idx
```

说明正常。

---

# 13. 常见优化建议

### embedding 字段

推荐：

```sql
embedding vector(1536)
```

不要：

```sql
text
```

保存：

```
[0.123,0.456,...]
```

否则无法索引。

---

### 查询时保持距离算法一致

创建：

```sql
vector_cosine_ops
```

查询：

```sql
<=>
```

不要：

索引 cosine

查询 L2：

```sql
<->
```

否则可能不用索引。

---

### 大规模数据

建议：

```
文本
 ↓
切片(chunk)
 ↓
embedding
 ↓
pgvector
 ↓
HNSW
 ↓
TopK
 ↓
LLM
```

---

## 常见生产组合

|场景|推荐|
|---|---|
|企业知识库|HNSW + cosine|
|客服机器人|cosine + 阈值|
|商品推荐|inner product|
|图片搜索|L2/cosine|
|百万级文档|HNSW|
|千万级|pgvector + 分区 + 过滤|

实际项目中，pgvector 最重要的不是存向量，而是**设计好查询条件、索引类型、召回数量和过滤策略**。对于 RAG 系统，通常 `HNSW + cosine + metadata过滤 + rerank` 是目前最常见组合。