# PolarDB PostgreSQL OR 子句转 UNION ALL

来源: http://mysql.taobao.org/monthly/2025/01/02/
标签: recent

---

# 概述

本文介绍了 PolarDB PostgreSQL 支持的 “OR 子句转 UNION ALL” 的查询改写功能。

# 背景信息

目前， PostgreSQL 优化器对于 SQL 中的 OR 子句过滤条件并没有太多优化能力。假如 OR 子句过滤条件中只涉及到一张表，并且过滤条件上都有合适的索引，优化器会为这种场景生成一个 BitmapOr 的 index path。例如：

```
explain select * from my_test where (id = 123 or name = '123' or salary = 123.0);
                                      QUERY PLAN
---------------------------------------------------------------------------------------
 Bitmap Heap Scan on my_test  (cost=12.90..24.33 rows=3 width=15)
   Recheck Cond: ((id = 123) OR ((name)::text = '123'::text) OR (salary = 123.0))
   ->  BitmapOr  (cost=12.90..12.90 rows=3 width=0)
         ->  Bitmap Index Scan on my_test_id_idx  (cost=0.00..4.30 rows=1 width=0)
               Index Cond: (id = 123)
         ->  Bitmap Index Scan on my_test_name_idx  (cost=0.00..4.30 rows=1 width=0)
               Index Cond: ((name)::text = '123'::text)
         ->  Bitmap Index Scan on my_test_salary_idx  (cost=0.00..4.30 rows=1 width=0)
               Index Cond: (salary = 123.0)
(9 rows)

```

而如果 OR 子句中涉及到多张表，优化器只能将这个 OR 子句作为连接后的过滤条件，可能会让 SQL 执行慢。例如：

```
explain analyze select * from t1 join t2 on t1.id = t2.id where (t1.num = 1 or t2.cnt = 2);
                                                    QUERY PLAN
-------------------------------------------------------------------------------------------------------------------
 Hash Join  (cost=299.00..660.50 rows=110 width=51) (actual time=5.992..15.673 rows=110 loops=1)
   Hash Cond: (t1.id = t2.id)
   Join Filter: ((t1.num = 1) OR (t2.cnt = 2))
   Rows Removed by Join Filter: 9890
   ->  Seq Scan on t1  (cost=0.00..174.00 rows=10000 width=25) (actual time=0.012..2.080 rows=10000 loops=1)
   ->  Hash  (cost=174.00..174.00 rows=10000 width=26) (actual time=5.855..5.857 rows=10000 loops=1)
         Buckets: 16384  Batches: 1  Memory Usage: 704kB
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.007..1.779 rows=10000 loops=1)
 Planning Time: 1.237 ms
 Execution Time: 15.836 ms
(10 rows)

```

这里 OR 子句被当作一个整体，优化器无法使用`t1.num`或者`t2.cnt`上的索引，导致`t1`与`t2`走全表扫描。

实际上，OR 子句在逻辑上可以转化为 UNION ALL 包含两个或多个分支的查询形式。例如上面的 case 可以改写为：

```
explain analyze
select * from t1 join t2 on t1.id = t2.id where t1.num = 1
union all
select * from t1 join t2 on t1.id = t2.id where t2.cnt = 2 and (t1.num != 1 or (t1.num = 1) is null);
                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Append  (cost=85.48..412.26 rows=110 width=51) (actual time=0.350..4.832 rows=110 loops=1)
   ->  Hash Join  (cost=85.48..297.98 rows=100 width=51) (actual time=0.349..4.653 rows=100 loops=1)
         Hash Cond: (t2.id = t1.id)
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.009..1.719 rows=10000 loops=1)
         ->  Hash  (cost=84.23..84.23 rows=100 width=25) (actual time=0.318..0.320 rows=100 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 14kB
               ->  Bitmap Heap Scan on t1  (cost=5.06..84.23 rows=100 width=25) (actual time=0.065..0.265 rows=100 loops=1)
                     Recheck Cond: (num = 1)
                     Heap Blocks: exact=73
                     ->  Bitmap Index Scan on t1_num_idx  (cost=0.00..5.04 rows=100 width=0) (actual time=0.037..0.037 rows=100 loops=1)
                           Index Cond: (num = 1)
   ->  Nested Loop  (cost=4.65..112.63 rows=10 width=51) (actual time=0.049..0.159 rows=10 loops=1)
         ->  Bitmap Heap Scan on t2 t2_1  (cost=4.36..33.46 rows=10 width=26) (actual time=0.026..0.045 rows=10 loops=1)
               Recheck Cond: (cnt = 2)
               Heap Blocks: exact=10
               ->  Bitmap Index Scan on t2_cnt_idx  (cost=0.00..4.36 rows=10 width=0) (actual time=0.017..0.018 rows=10 loops=1)
                     Index Cond: (cnt = 2)
         ->  Index Scan using t1_id_idx on t1 t1_1  (cost=0.29..7.91 rows=1 width=25) (actual time=0.009..0.009 rows=1 loops=10)
               Index Cond: (id = t2_1.id)
               Filter: ((num <> 1) OR ((num = 1) IS NULL))
 Planning Time: 1.150 ms
 Execution Time: 5.014 ms
(22 rows)

```

改写后`t1.num`和`t2.cnt`上的索引都能够被利用上，减少了中间处理的数据量，提高了执行性能。

# 功能介绍

正如[PostgreSQL 慢 SQL 优化分享](https://zhuanlan.zhihu.com/p/715913733) case 18 所描述的那样，这是一个常见的场景，某些数据库，如 Oracle，已经支持了 OR 子句转 UNION ALL 的查询改写能力，因此我们在 PolarDB PostgreSQL 中也支持了这个查询改写的能力。

**它能够在生成计划期间尝试将合适的 OR 子句转换成 UNION ALL 的形式，再进行基于代价的路径选择，最终得到一个更优的执行计划**。

## 解决的关键问题

PolarDB PostgreSQL 要实现 OR 子句转 UNION ALL 的查询改写能力，需要考虑以下几个关键问题：

  
- **查询变换的逻辑等价性**：查询变换一定要保证逻辑上是等价的，OR 子句转换成 UNION ALL 的等价改写可以利用集合的概念，将整个结果集分割成多个独立的子集的和；而在实际转换中，需要注意 NULL 值的处理。
  
- **查询变换的时机**：SQL 中的 OR 子句会被预处理，这个过程中 OR 子句可能会被优化、整合、删除，因此合理的查询变换时机需要在 OR 子句预处理之后进行。
  
- **转换前后的计划抉择**：OR 子句转换成 UNION ALL 之后并不一定会得到更优的执行计划，因此需要和未变换时的计划进行比较，进行基于代价的路径选择。
  
- **性能的考量**：对于简单的 SQL，进行变换的代价反而会拖慢 SQL 的运行效率；或者 SQL 中存在多个 OR 子句，亦或一个 OR 子句的条件数量很多，这种极端场景的性能影响，也需要考虑。
  
- **变换后的优化**：转换成 UNION ALL 之后，SQL 可能会能够再次应用一些优化器的优化能力，比如外链接消除、筛选条件简化等，因此还需要考虑转换后的优化能力应用。

## 使用方式

OR 子句转 UNION ALL 能力受参数控制，相关的参数名称和作用，如下所示：

  
- `polar_cbqt_cost_threshold`参数用于控制对 SQL 尝试进行 OR 转换的阈值，默认值为 50000，如果 SQL 原始的执行计划总代价（cost 值）没有超过阈值，则不会进行 OR 转换，具体取值为：
    
      
- `[0, +∞)`，参数值设置为 0 时，表示对任何 SQL 都尝试进行 OR 转换（不建议设置为 0，可能会让所有 SQL 计划时间变长，影响性能）。
    
  
  
- `polar_cbqt_convert_or_to_union_all_mode`参数用于控制 OR 子句转换功能的开关，默认值为 off，具体的取值为：
    
      
- `OFF`，关闭 OR 子句转 UNION ALL 功能；
      
- `ON`，开启 OR 子句转 UNION ALL 功能；
      
- `FORCE`，开启 OR 子句转 UNION ALL，如果有转换后的路径，则强制选择转换后的路径（可能并不是总代价最低的路径）。
    
  

## 注意事项

  
- `polar_cbqt_cost_threshold`设置为 0 或者`polar_cbqt_convert_or_to_union_all_mode`设置为 FORCE，将会强制 SQL 运用优化，**对于指定 SQL 强制 OR 转 UNION ALL 优化，建议使用 hint 来设置**；
  
- 如果 OR 子句中的条件只涉及到一张表，优化器不会尝试进行 OR 子句的转换；
  
- 如果 SQL 中存在多个合适的 OR 子句，在强制模式下，会选择多个合适 OR 子句的总代价最小的路径；
  
- 如果一个 OR 子句的参数超过了 6 个，优化器不会对这个 OR 子句进行转换；
  
- 如果一个 SQL 的 OR 子句数量超过了 6 个，将会只对前 6 个 OR 子进行转换选择。

## 示例

### 前期准备

```
CREATE TABLE t1(id int, num int, dsc text, log_date text);
CREATE TABLE t2(id int, cnt int, change text, op_date text);

INSERT INTO t1 SELECT i, i%100, 'test'||1, to_char('1990-10-10'::date + i, 'YYYY-MM-DD') FROM generate_series(1,10000)i;
INSERT INTO t2 SELECT i, i%1000, 'now'||i, to_char('1990-10-10'::date + i, 'YYYY-MM-DD') FROM generate_series(1,10000)i;

CREATE INDEX ON t1(id);
CREATE INDEX ON t1(num);
CREATE INDEX ON t2(id);
CREATE INDEX ON t2(cnt);

analyze t1;
analyze t2;

```

### 基本功能

#### 功能关闭

```
set polar_cbqt_cost_threshold to 100;
set polar_cbqt_convert_or_to_union_all_mode to off;

explain analyze select * from t1 join t2 on t1.id = t2.id where (t1.num = 1 or t2.cnt = 2);
                                                    QUERY PLAN
-------------------------------------------------------------------------------------------------------------------
 Hash Join  (cost=299.00..660.50 rows=110 width=51) (actual time=5.992..15.673 rows=110 loops=1)
   Hash Cond: (t1.id = t2.id)
   Join Filter: ((t1.num = 1) OR (t2.cnt = 2))
   Rows Removed by Join Filter: 9890
   ->  Seq Scan on t1  (cost=0.00..174.00 rows=10000 width=25) (actual time=0.012..2.080 rows=10000 loops=1)
   ->  Hash  (cost=174.00..174.00 rows=10000 width=26) (actual time=5.855..5.857 rows=10000 loops=1)
         Buckets: 16384  Batches: 1  Memory Usage: 704kB
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.007..1.779 rows=10000 loops=1)
 Planning Time: 1.237 ms
 Execution Time: 15.836 ms
(10 rows)

```

#### 功能开启

```
set polar_cbqt_cost_threshold to 100;
set polar_cbqt_convert_or_to_union_all_mode to on;

explain analyze select * from t1 join t2 on t1.id = t2.id where (t1.num = 1 or t2.cnt = 2);
                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Append  (cost=85.48..411.16 rows=110 width=51) (actual time=0.396..4.822 rows=110 loops=1)
   ->  Hash Join  (cost=85.48..297.98 rows=100 width=51) (actual time=0.395..4.639 rows=100 loops=1)
         Hash Cond: (t2.id = t1.id)
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.010..1.750 rows=10000 loops=1)
         ->  Hash  (cost=84.23..84.23 rows=100 width=25) (actual time=0.333..0.335 rows=100 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 14kB
               ->  Bitmap Heap Scan on t1  (cost=5.06..84.23 rows=100 width=25) (actual time=0.056..0.247 rows=100 loops=1)
                     Recheck Cond: (num = 1)
                     Heap Blocks: exact=73
                     ->  Bitmap Index Scan on t1_num_idx  (cost=0.00..5.04 rows=100 width=0) (actual time=0.028..0.028 rows=100 loops=1)
                           Index Cond: (num = 1)
   ->  Nested Loop  (cost=4.65..112.63 rows=10 width=51) (actual time=0.049..0.164 rows=10 loops=1)
         ->  Bitmap Heap Scan on t2  (cost=4.36..33.46 rows=10 width=26) (actual time=0.027..0.044 rows=10 loops=1)
               Recheck Cond: (cnt = 2)
               Heap Blocks: exact=10
               ->  Bitmap Index Scan on t2_cnt_idx  (cost=0.00..4.36 rows=10 width=0) (actual time=0.019..0.019 rows=10 loops=1)
                     Index Cond: (cnt = 2)
         ->  Index Scan using t1_id_idx on t1  (cost=0.29..7.91 rows=1 width=25) (actual time=0.010..0.010 rows=1 loops=10)
               Index Cond: (id = t2.id)
               Filter: ((num <> 1) OR ((num = 1) IS NULL))
 Planning Time: 2.903 ms
 Execution Time: 4.980 ms
(22 rows)

```

可以看到，开启 OR 子句转 UNION ALL 功能后，执行计划中可以利用上`t1.num`和`t2.cnt`上的索引，达到了和手动改写成 UNION ALL 相同的效果。

### 强制选择功能

#### 功能开启

```
set polar_cbqt_cost_threshold to 100;
set polar_cbqt_convert_or_to_union_all_mode to on;

explain analyze select * from t1, t2 where t1.dsc= t2.change and (t1.log_date = '2024-01-01' or t2.op_date = '2024-01-01');
                                                    QUERY PLAN
-------------------------------------------------------------------------------------------------------------------
 Hash Join  (cost=299.00..660.50 rows=2 width=51) (actual time=14.321..14.325 rows=0 loops=1)
   Hash Cond: (t1.dsc = t2.change)
   Join Filter: ((t1.log_date = '2024-01-01'::text) OR (t2.op_date = '2024-01-01'::text))
   ->  Seq Scan on t1  (cost=0.00..174.00 rows=10000 width=25) (actual time=0.016..3.204 rows=10000 loops=1)
   ->  Hash  (cost=174.00..174.00 rows=10000 width=26) (actual time=6.506..6.508 rows=10000 loops=1)
         Buckets: 16384  Batches: 1  Memory Usage: 704kB
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.006..1.755 rows=10000 loops=1)
 Planning Time: 0.932 ms
 Execution Time: 14.571 ms
(9 rows)

```

#### 强制选择

```
set polar_cbqt_cost_threshold to 100;
set polar_cbqt_convert_or_to_union_all_mode to force;

explain analyze select * from t1, t2 where t1.dsc= t2.change and (t1.log_date = '2024-01-01' or t2.op_date = '2024-01-01');
                                                   QUERY PLAN
-----------------------------------------------------------------------------------------------------------------
 Append  (cost=199.01..871.05 rows=2 width=51) (actual time=9.915..9.923 rows=0 loops=1)
   ->  Hash Join  (cost=199.01..410.52 rows=1 width=51) (actual time=5.046..5.050 rows=0 loops=1)
         Hash Cond: (t2.change = t1.dsc)
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.015..0.015 rows=1 loops=1)
         ->  Hash  (cost=199.00..199.00 rows=1 width=25) (actual time=5.014..5.016 rows=0 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 8kB
               ->  Seq Scan on t1  (cost=0.00..199.00 rows=1 width=25) (actual time=5.013..5.013 rows=0 loops=1)
                     Filter: (log_date = '2024-01-01'::text)
                     Rows Removed by Filter: 10000
   ->  Hash Join  (cost=199.01..460.52 rows=1 width=51) (actual time=4.865..4.867 rows=0 loops=1)
         Hash Cond: (t1.dsc = t2.change)
         ->  Seq Scan on t1  (cost=0.00..224.00 rows=9999 width=25) (actual time=0.015..0.016 rows=1 loops=1)
               Filter: ((log_date <> '2024-01-01'::text) OR ((log_date = '2024-01-01'::text) IS NULL))
         ->  Hash  (cost=199.00..199.00 rows=1 width=26) (actual time=4.828..4.829 rows=0 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 8kB
               ->  Seq Scan on t2  (cost=0.00..199.00 rows=1 width=26) (actual time=4.827..4.827 rows=0 loops=1)
                     Filter: (op_date = '2024-01-01'::text)
                     Rows Removed by Filter: 10000
 Planning Time: 0.777 ms
 Execution Time: 10.088 ms
(20 rows)

```

对比转换前后的执行计划总代价，发现不进行 OR 子句转换的总代价更低。因此，在非强制模式下，优化器就不会选择 OR 子句转换后的路径。然而，在强制模式下，优化器会强制选择 OR 子句转换后的路径。强制转换模式适用于优化器无法准确估算代价，需要固定查询选择 OR 转 UNION ALL 变换的场景。

### 使用 hint

OR 子句转换还能配合 hint 功能进行 SQL 级别的功能控制:

```
explain analyze /*+ Set(polar_cbqt_convert_or_to_union_all_mode force) Set(polar_cbqt_cost_threshold 0) */ select * from t1, t2 where t1.dsc= t2.change and (t1.log_date = '2024-01-01' or t2.op_date = '2024-01-01');
                                                   QUERY PLAN
-----------------------------------------------------------------------------------------------------------------
 Append  (cost=199.01..871.05 rows=2 width=51) (actual time=9.684..9.691 rows=0 loops=1)
   ->  Hash Join  (cost=199.01..410.52 rows=1 width=51) (actual time=4.711..4.714 rows=0 loops=1)
         Hash Cond: (t2.change = t1.dsc)
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.013..0.013 rows=1 loops=1)
         ->  Hash  (cost=199.00..199.00 rows=1 width=25) (actual time=4.682..4.684 rows=0 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 8kB
               ->  Seq Scan on t1  (cost=0.00..199.00 rows=1 width=25) (actual time=4.681..4.681 rows=0 loops=1)
                     Filter: (log_date = '2024-01-01'::text)
                     Rows Removed by Filter: 10000
   ->  Hash Join  (cost=199.01..460.52 rows=1 width=51) (actual time=4.969..4.970 rows=0 loops=1)
         Hash Cond: (t1.dsc = t2.change)
         ->  Seq Scan on t1  (cost=0.00..224.00 rows=9999 width=25) (actual time=0.018..0.018 rows=1 loops=1)
               Filter: ((log_date <> '2024-01-01'::text) OR ((log_date = '2024-01-01'::text) IS NULL))
         ->  Hash  (cost=199.00..199.00 rows=1 width=26) (actual time=4.935..4.936 rows=0 loops=1)
               Buckets: 1024  Batches: 1  Memory Usage: 8kB
               ->  Seq Scan on t2  (cost=0.00..199.00 rows=1 width=26) (actual time=4.934..4.934 rows=0 loops=1)
                     Filter: (op_date = '2024-01-01'::text)
                     Rows Removed by Filter: 10000
 Planning Time: 0.798 ms
 Execution Time: 9.858 ms
(20 rows)

```

### 转换阈值

在基本功能验证中，原始 SQL 执行计划的总 cost 值为 660.50。因此我们将转换阈值设置成高于这个值，再次执行相同的 SQL：

```
set polar_cbqt_cost_threshold to 1000; -- 设置阈值
set polar_cbqt_convert_or_to_union_all_mode to force; -- 强制选择转换后的路径

explain analyze select * from t1 join t2 on t1.id = t2.id where (t1.num = 1 or t2.cnt = 2);
                                                    QUERY PLAN
-------------------------------------------------------------------------------------------------------------------
 Hash Join  (cost=299.00..660.50 rows=110 width=51) (actual time=6.374..15.802 rows=110 loops=1)
   Hash Cond: (t1.id = t2.id)
   Join Filter: ((t1.num = 1) OR (t2.cnt = 2))
   Rows Removed by Join Filter: 9890
   ->  Seq Scan on t1  (cost=0.00..174.00 rows=10000 width=25) (actual time=0.011..2.038 rows=10000 loops=1)
   ->  Hash  (cost=174.00..174.00 rows=10000 width=26) (actual time=6.266..6.268 rows=10000 loops=1)
         Buckets: 16384  Batches: 1  Memory Usage: 704kB
         ->  Seq Scan on t2  (cost=0.00..174.00 rows=10000 width=26) (actual time=0.006..1.778 rows=10000 loops=1)
 Planning Time: 0.663 ms
 Execution Time: 16.036 ms
(10 rows)

```

可以看到，即使处于强制模式，优化器也依然选择原始的路径。这是因为原始计划的总代价没有超过阈值，所以不会尝试去进行 OR 子句转化。

# 参考资料

[1] [阿里云OR子句转UNION ALL用户使用文档](https://help.aliyun.com/zh/polardb/polardb-for-oracle/or-clause-to-union-all?spm=a2c4g.11186623.help-menu-2249963.d_5_9_2.1f6868f7qriCtG)