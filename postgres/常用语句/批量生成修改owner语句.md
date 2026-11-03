如果是 PostgreSQL 批量生成修改 owner 语句，可以通过系统表查询生成 `ALTER ... OWNER TO`。

假设要把对象 owner 改成：

```sql
new_owner
```

---

## 1. 批量修改所有表 owner

```sql
SELECT 
    'ALTER TABLE ' || schemaname || '.' || tablename || 
    ' OWNER TO new_owner;'
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema');
```

生成结果：

```sql
ALTER TABLE public.user_info OWNER TO new_owner;
ALTER TABLE public.orders OWNER TO new_owner;
```

复制执行即可。

---

## 2. 批量修改某个 schema 下的表

例如 `public`：

```sql
SELECT 
    'ALTER TABLE ' || schemaname || '.' || tablename ||
    ' OWNER TO new_owner;'
FROM pg_tables
WHERE schemaname='public';
```

---

## 3. 批量修改序列 owner

很多自增字段依赖 sequence：

```sql
SELECT 
    'ALTER SEQUENCE ' || sequence_schema || '.' || sequence_name ||
    ' OWNER TO new_owner;'
FROM information_schema.sequences
WHERE sequence_schema NOT IN ('pg_catalog','information_schema');
```

---

## 4. 批量修改视图 owner

```sql
SELECT
    'ALTER VIEW ' || schemaname || '.' || viewname ||
    ' OWNER TO new_owner;'
FROM pg_views
WHERE schemaname NOT IN ('pg_catalog','information_schema');
```

---

## 5. 批量修改函数 owner

```sql
SELECT
    'ALTER FUNCTION ' ||
    n.nspname || '.' ||
    p.proname || '(' ||
    pg_get_function_identity_arguments(p.oid) ||
    ') OWNER TO new_owner;'
FROM pg_proc p
JOIN pg_namespace n 
ON p.pronamespace=n.oid
WHERE n.nspname NOT IN ('pg_catalog','information_schema');
```

---

## 6. 一次生成全部对象 owner 修改

```sql
-- 表
SELECT 
'ALTER TABLE '||schemaname||'.'||tablename||
' OWNER TO new_owner;'
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')

UNION ALL

-- 序列
SELECT
'ALTER SEQUENCE '||sequence_schema||'.'||sequence_name||
' OWNER TO new_owner;'
FROM information_schema.sequences
WHERE sequence_schema NOT IN ('pg_catalog','information_schema')

UNION ALL

-- 视图
SELECT
'ALTER VIEW '||schemaname||'.'||viewname||
' OWNER TO new_owner;'
FROM pg_views
WHERE schemaname NOT IN ('pg_catalog','information_schema');
```

---

## 7. 直接执行（DO 块方式）

如果你有权限，可以直接执行：

```sql
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog','information_schema')
    LOOP
        EXECUTE 
        'ALTER TABLE '||
        quote_ident(r.schemaname)||'.'||
        quote_ident(r.tablename)||
        ' OWNER TO new_owner';
    END LOOP;
END $$;
```

---

注意：

1. 执行者必须是：
    
    - 当前对象 owner
        
    - 或 superuser
        
2. 修改 owner 前，新 owner 必须存在：
    

```sql
CREATE USER new_owner;
```

3. 如果是数据库迁移后整体改属主，通常顺序：
    

```
schema owner
 ↓
table owner
 ↓
sequence owner
 ↓
view owner
 ↓
function owner
```

如果你是 **pg_dump 导入后批量改 owner**，也可以直接用：

```bash
pg_restore --no-owner
```

避免生成原 owner。