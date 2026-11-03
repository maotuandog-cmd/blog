## 24.1 总览 [](https://postgres-internals.cn/docs/chapter24/#241-%e6%80%bb%e8%a7%88)

哈希索引 [1](https://postgres-internals.cn/docs/chapter24/#fn:1) 提供了通过特定索引键快速找到元组 ID (TID) 的能力。粗略地说，它只是一个存储在磁盘上的哈希表。哈希索引支持的唯一操作是通过等值条件进行搜索。

将值插入到索引中时，[2](https://postgres-internals.cn/docs/chapter24/#fn:2) 会计算索引键的哈希函数。在 PostgreSQL 中，哈希函数返回 32 位或 64 位整数；这些值的最低几位用作相应桶的编号。键的 TID 和哈希码被添加到所选的桶中。键本身不存储在索引中，因为处理小的定长值更为方便。

索引的哈希表是动态扩展的。[3](https://postgres-internals.cn/docs/chapter24/#fn:3) 最小的桶数是 2。随着索引元组数量的增加，其中一个桶会被分成两个。这个操作使用了一个额外的哈希码位，所以元素只在分裂产生的两个桶之间重新分配；哈希表其他桶的组成保持不变。[4](https://postgres-internals.cn/docs/chapter24/#fn:4)

索引搜索操作 [5](https://postgres-internals.cn/docs/chapter24/#fn:5) 计算索引键的哈希函数和相应的桶号。在所有桶的内容中，搜索将仅返回与键的哈希码相对应的 TIDS。由于桶元素按键的哈希码排序，二分查找可以非常高效地返回匹配的 TIDS。

由于键未存储在哈希表中，因此索引访问方法可能会由于哈希冲突而返回冗余的 TIDS。因此，索引引擎必须重新检查访问方法获取的所有结果。出于同样的原因，也不支持仅索引扫描。

## 24.2 页面布局 [](https://postgres-internals.cn/docs/chapter24/#242-%e9%a1%b5%e9%9d%a2%e5%b8%83%e5%b1%80)

与常规哈希表不同，哈希索引存储在磁盘上。因此，所有数据都必须组织到页面中，最好是以这样的方式：索引操作 (搜索、插入、删除) 尽可能少地访问页面。

哈希索引使用四种类型的页面：

- 元页面 — 零页面，提供索引的"目录"
- 桶页面 — 索引的主页面，每个桶一个页面
- 溢出页面 — 当主桶页面无法容纳所有元素时使用的额外页面
- 位图页面 — 包含位数组的页面，用于跟踪已释放且可以重用的溢出页面

我们可以使用 pageinspect 扩展窥探索引页面。

让我们从一张空表开始：

```bash
=> CREATE EXTENSION pageinspect;
=> CREATE TABLE t(n integer);
=> ANALYZE t;
=> CREATE INDEX ON t USING hash(n);
```

我已经分析了表，因此创建的索引大小将尽可能小；否则，桶的数量将基于假设表包含十个页面的前提来选择。[6](https://postgres-internals.cn/docs/chapter24/#fn:6)

索引包含四个页面：元页面、两个桶页面和一个位图页面 (立即创建以供将来使用)：

```bash
=> SELECT page, hash_page_type(get_raw_page('t_n_idx', page))
FROM generate_series(0,3) page;
 page | hash_page_type
−−−−−−+−−−−−−−−−−−−−−−−
    0 | metapage
    1 | bucket
    2 | bucket
    3 | bitmap
(4 rows)
```

![](https://postgres-internals.cn/docs/chapter24/24-1.png)

元页面包含所有与索引有关的控制信息。目前我们只对一些值感兴趣：

```bash
=> SELECT ntuples, ffactor, maxbucket
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 ntuples | ffactor | maxbucket
−−−−−−−−−+−−−−−−−−−+−−−−−−−−−−−
       0 |     307 |         1
(1 row)
```

每个桶的预估行数显示在 ffactor 字段中。这个值是根据块大小和 _fillfactor_ 存储参数的值计算得出的。如果数据分布绝对均匀且没有哈希冲突，你可以使用更高的 _fillfactor_ 值，但在实际情况中，这会增加页面溢出的风险。

哈希索引最糟糕的情况是当某个键重复多次时，数据分布会出现较大倾斜。由于哈希函数返回同一个值，所有数据都将被放置在同一个桶中，并且增加桶的数量也无济于事。

现在索引为空，如 ntuples 字段所示。让我们通过插入多条具有相同索引键的行来导致桶页面溢出。索引中现在出现了一个溢出页面：

```bash
=> INSERT INTO t(n)
  SELECT 0 FROM generate_series(1,500); -- the same value
=> SELECT page, hash_page_type(get_raw_page('t_n_idx', page))
FROM generate_series(0,4) page;
 page | hash_page_type
−−−−−−+−−−−−−−−−−−−−−−−
    0 | metapage
    1 | bucket
    2 | bucket
    3 | bitmap
    4 | overflow
(5 rows)
```

![](https://postgres-internals.cn/docs/chapter24/24-2.png)

所有页面的综合统计显示，0 号桶是空的，而所有的值都被放置在 1 号桶中：其中一些位于主页面中，而那些不适合主页面的则可以在溢出页面中找到。

```bash
=> SELECT page, live_items, free_size, hasho_bucket
FROM (VALUES (1), (2), (4)) p(page),
  hash_page_stats(get_raw_page('t_n_idx', page));
 page | live_items | free_size | hasho_bucket
−−−−−−+−−−−−−−−−−−−+−−−−−−−−−−−+−−−−−−−−−−−−−−
    1 |          0 |      8148 |            0
    2 |        407 |         8 |            1
    4 |         93 |      6288 |            1
(3 rows)
```

显然，如果同一个桶的元素分布在多个页面上，性能会受到影响。如果数据分布均匀，那么哈希索引表现最佳。

现在，让我们看看桶是如何进行分裂的。当索引中的行数超过可用桶的预估 ffactor 值时，就会发生分裂。此处我们有两个桶，ffactor 是 307，所以当第 615 行被插入到索引中时，桶就会分裂：

```bash
=> SELECT ntuples, ffactor, maxbucket, ovflpoint
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 ntuples | ffactor | maxbucket | ovflpoint
−−−−−−−−−+−−−−−−−−−+−−−−−−−−−−−+−−−−−−−−−−−
     500 |     307 |         1 |         1
(1 row)
=> INSERT INTO t(n)
  SELECT n FROM generate_series(1,115) n; -- now values are different
=> SELECT ntuples, ffactor, maxbucket, ovflpoint
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 ntuples | ffactor | maxbucket | ovflpoint
−−−−−−−−−+−−−−−−−−−+−−−−−−−−−−−+−−−−−−−−−−−
     615 |     307 |         2 |         2
(1 row)
```

maxbucket 值已增加到 2：现在我们有三个桶，编号从 0 到 2。但即使我们只增加了一个桶，页面数量也翻了一倍：

```bash
=> SELECT page, hash_page_type(get_raw_page('t_n_idx', page))
FROM generate_series(0,6) page;
 page | hash_page_type
−−−−−−+−−−−−−−−−−−−−−−−
    0 | metapage
    1 | bucket
    2 | bucket
    3 | bitmap
    4 | overflow
    5 | bucket
    6 | unused
(7 rows)
```

![](https://postgres-internals.cn/docs/chapter24/24-3.png)

其中一个新页面被 2 号桶使用，而另一个页面保持空闲，待桶 3 出现时便会被使用。

```bash
=> SELECT page, live_items, free_size, hasho_bucket
FROM (VALUES (1), (2), (4), (5)) p(page),
  hash_page_stats(get_raw_page('t_n_idx', page));
 page | live_items | free_size | hasho_bucket
−−−−−−+−−−−−−−−−−−−+−−−−−−−−−−−+−−−−−−−−−−−−−−
    1 |         27 |      7608 |            0
    2 |        407 |         8 |            1
    4 |        158 |      4988 |            1
    5 |         23 |      7688 |            2
(4 rows)
```

因此，从操作系统的角度来看，哈希索引呈爆发式增长，尽管从逻辑角度来看，哈希表显示的是逐步增长。

为了一定程度上平缓这种增长，并避免一次分配过多的页面，从第十次增加开始，页面将分成四个相同批次分配，而不是一次性全部分配。

元页面的另外两个字段，实际上是位掩码，提供了桶地址的详细信息：

```bash
=> SELECT maxbucket, highmask::bit(4), lowmask::bit(4)
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 maxbucket | highmask | lowmask
−−−−−−−−−−−+−−−−−−−−−−+−−−−−−−−−
         2 | 0011     | 0001
(1 row)
```

桶号由与 highmask 对应的哈希码确定。但如果得到的桶号不存在 (超过了 maxbucket)，则取 lowmask。[7](https://postgres-internals.cn/docs/chapter24/#fn:7) 在此特例下，我们取两个最低位，这提供了 0 到 3 的值；但如果我们得到 3，我们将只取一个最低位，也就是使用桶 1 代替桶 3。

每次大小翻倍时，新的桶页面作为一个连续的块被分配，而溢出页面和位图页面根据需要被插入到这些片段之间。元页面将插入到每个块中的页面数量保存在 spares 数组中，这使我们有机会基于桶号使用简单的算术来计算其主页面的数量。[8](https://postgres-internals.cn/docs/chapter24/#fn:8)

在这个特定的案例中，第一次增加后插入了两个页面 (一个位图页面和一个溢出页面)，但在第二次增加后还没有发生新的添加：

```sql
=> SELECT spares[2], spares[3]
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 spares | spares
−−−−−−−−+−−−−−−−−
      2 |      2 
(1 row)
```

元页面还存储了一个指向位图页面的指针数组：

```bash
=> SELECT mapp[1]
FROM hash_metapage_info(get_raw_page('t_n_idx', 0));
 mapp
−−−−−−
    3
(1 row)
```

![](https://postgres-internals.cn/docs/chapter24/24-4.png)

当指向死元组的指针被移除时，索引页中的空间会被释放。这发生在页剪枝期间 (当尝试将一个元素插入至一个完全填满的页面时触发) [9](https://postgres-internals.cn/docs/chapter24/#fn:9) 或执行例行清理时。

但是，哈希索引不能收缩：一旦分配，索引页将不会返还给操作系统。主页面永久分配给它们的桶，即使它们根本不包含任何元素；被清理的溢出页面在位图中进行跟踪，并且可以被重用 (可能被另一个桶重用)。减少索引物理大小的唯一方法是使用 REINDEX 或 VACUUM FULL 命令重建。

查询计划并没有指示索引类型：

```bash
=> CREATE INDEX ON flights USING hash(flight_no);
=> EXPLAIN (costs off)
SELECT *
FROM flights
WHERE flight_no = 'PG0001';
                    QUERY PLAN
−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−
 Bitmap Heap Scan on flights
   Recheck Cond: (flight_no = 'PG0001'::bpchar)
   −> Bitmap Index Scan on flights_flight_no_idx
       Index Cond: (flight_no = 'PG0001'::bpchar)
(4 rows)
```

## 24.3 操作符类 [](https://postgres-internals.cn/docs/chapter24/#243-%e6%93%8d%e4%bd%9c%e7%ac%a6%e7%b1%bb)

在 PostgreSQL 10 之前，哈希索引不会记录日志，也就是说，它们既不受故障保护也不被复制，因此不建议使用。但即便如此，它们仍有其价值。问题在于哈希算法被广泛使用 (特别是执行哈希连接和分组)，系统必须知道哪个哈希函数可以用于特定的数据类型。然而，这种对应关系不是静态的：它不能一劳永逸地定义，因为 PostgreSQL 允许动态添加新的数据类型。因此，它由哈希索引的操作符类和特定的数据类型维护。哈希函数本身由类的支持函数表示：

```bash
=> SELECT opfname AS opfamily_name,
  amproc::regproc AS opfamily_procedure
FROM pg_am am
  JOIN pg_opfamily opf ON opfmethod = am.oid
  JOIN pg_amproc amproc ON amprocfamily = opf.oid
WHERE amname = 'hash'
AND amprocnum = 1
ORDER BY opfamily_name, opfamily_procedure;
   opfamily_name    | opfamily_procedure
−−−−−−−−−−−−−−−−−−−−+−−−−−−−−−−−−−−−−−−−−
 aclitem_ops        | hash_aclitem
 array_ops          | hash_array
 bool_ops           | hashchar
 bpchar_ops         | hashbpchar
 bpchar_pattern_ops | hashbpchar
...
 timetz_ops         | timetz_hash
 uuid_ops           | uuid_hash
 xid8_ops           | hashint8
 xid_ops            | hashint4
(38 rows)
```

这些函数返回 32 位整数。尽管它们没有记录在文档中，但可以用来为相应类型的值计算哈希码。

例如，text_ops 族使用 hashtext 函数：

```sql
=> SELECT hashtext('one'), hashtext('two');
  hashtext  | hashtext
−−−−−−−−−−−−+−−−−−−−−−−−−
 1793019229 | 1590507854
(1 row)
```

哈希索引的操作符类只提供等值操作符：

```bash
=> SELECT opfname AS opfamily_name,
  left(amopopr::regoperator::text, 20) AS opfamily_operator
FROM pg_am am
  JOIN pg_opfamily opf ON opfmethod = am.oid
  JOIN pg_amop amop ON amopfamily = opf.oid
WHERE amname = 'hash'
ORDER BY opfamily_name, opfamily_operator;
   opfamily_name    | opfamily_operator
−−−−−−−−−−−−−−−−−−−−+−−−−−−−−−−−−−−−−−−−−−−
 aclitem_ops        | =(aclitem,aclitem)
 array_ops          | =(anyarray,anyarray)
 bool_ops           | =(boolean,boolean)
 ...
 uuid_ops           | =(uuid,uuid)
 xid8_ops           | =(xid8,xid8)
 xid_ops            | =(xid,xid)
(48 rows)
```

## 24.4 属性 [](https://postgres-internals.cn/docs/chapter24/#244-%e5%b1%9e%e6%80%a7)

让我们看一下哈希访问方法赋予系统的索引级属性。

### 24.4.1 访问方法属性 [](https://postgres-internals.cn/docs/chapter24/#2441-%e8%ae%bf%e9%97%ae%e6%96%b9%e6%b3%95%e5%b1%9e%e6%80%a7)

```bash
=> SELECT a.amname, p.name, pg_indexam_has_property(a.oid, p.name)
FROM pg_am a, unnest(array[
  'can_order', 'can_unique', 'can_multi_col',
  'can_exclude', 'can_include'
]) p(name)
WHERE a.amname = 'hash';
 amname |     name      | pg_indexam_has_property
−−−−−−−−+−−−−−−−−−−−−−−−+−−−−−−−−−−−−−−−−−−−−−−−−−
 hash 	| can_order     | f
 hash 	| can_unique    | f
 hash 	| can_multi_col | f
 hash 	| can_exclude   | t
 hash 	| can_include   | f
(5 rows)
```

显然，哈希索引不能用于排序：哈希函数或多或少地随机混合数据。

也不支持唯一约束。然而，哈希索引可以强制执行排它约束，由于唯一支持的函数是等于，因此这种排它具有唯一性的含义：

```bash
=> ALTER TABLE aircrafts_data
  ADD CONSTRAINT unique_range EXCLUDE USING hash(range WITH =);
=> INSERT INTO aircrafts_data
  VALUES ('744','{"ru": "Boeing 747-400"}',11100);
ERROR: conflicting key value violates exclusion constraint
"unique_range"
DETAIL: Key (range)=(11100) conflicts with existing key
(range)=(11100).
```

多列索引和额外的 INCLUDE 列也不支持。

### 24.4.2 索引级属性 [](https://postgres-internals.cn/docs/chapter24/#2442-%e7%b4%a2%e5%bc%95%e7%ba%a7%e5%b1%9e%e6%80%a7)

```bash
=> SELECT p.name, pg_index_has_property('flights_flight_no_idx', p.name)
FROM unnest(array[
  'clusterable', 'index_scan', 'bitmap_scan', 'backward_scan'
]) p(name);
     name      | pg_index_has_property
−−−−−−−−−−−−−−−+−−−−−−−−−−−−−−−−−−−−−−−
 clusterable   | f
 index_scan    | t
 bitmap_scan   | t
 backward_scan | t
(4 rows)
```

哈希索引既支持常规索引扫描也支持位图扫描。

但不支持通过哈希索引进行表聚簇。这很合理，因为很难想象为什么需要基于哈希值来物理排序堆数据。

### 24.4.3 列级属性 [](https://postgres-internals.cn/docs/chapter24/#2443-%e5%88%97%e7%ba%a7%e5%b1%9e%e6%80%a7)

列级属性基本上是由索引访问方法定义的，并且总是具有相同的值。

```bash
=> SELECT p.name,
  pg_index_column_has_property('flights_flight_no_idx', 1, p.name)
FROM unnest(array[
  'asc', 'desc', 'nulls_first', 'nulls_last', 'orderable',
  'distance_orderable', 'returnable', 'search_array', 'search_nulls'
]) p(name);
        name        | pg_index_column_has_property
−−−−−−−−−−−−−−−−−−−−+−−−−−−−−−−−−−−−−−−−−−−−−−−−−−−
 asc                | f
 desc               | f
 nulls_first        | f
 nulls_last         | f
 orderable          | f
 distance_orderable | f
 returnable         | f
 search_array       | f
 search_nulls       | f
(9 rows)
```

由于哈希函数不保留值的顺序，因此所有与排序相关的属性对哈希索引来说均不适用。

哈希索引不能参与仅索引扫描，因为它不存储索引键，需要访问堆。

哈希索引不支持空值，因为等于操作对空值不适用。

在数组中搜索元素也没有实现。

---

1. postgresql.org/docs/14/hash-index.html  
    backend/access/hash/README [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:1)
    
2. backend/access/hash/hashinsert.c [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:2)
    
3. backend/access/hash/hashpage.c, _hash_expandtable function [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:3)
    
4. backend/access/hash/hashpage.c, _hash_getbucketbuf_from_hashkey function [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:4)
    
5. backend/access/hash/hashsearch.c [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:5)
    
6. backend/access/table/tableam.c, table_block_relation_estimate_size function [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:6)
    
7. backend/access/hash/hashutil.c, _hash_hashkey2bucket function [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:7)
    
8. include/access/hash.h, BUCKET_TO_BLKNO macro [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:8)
    
9. backend/access/hash/hashinsert.c, _hash_vacuum_one_page function [↩︎](https://postgres-internals.cn/docs/chapter24/#fnref:9)
    

本中文译文版权归熊灿灿所有。英文原文版权归 Postgres Professional 所有。本译文根据授权翻译与