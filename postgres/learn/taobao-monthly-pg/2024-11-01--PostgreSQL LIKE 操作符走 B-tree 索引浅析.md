# PostgreSQL LIKE 操作符走 B-tree 索引浅析

来源: http://mysql.taobao.org/monthly/2024/11/01/
标签: recent

---

# 背景

LIKE 操作符是 PostgreSQL 支持的三种模式匹配方法之一。一般情况下，如果 SQL 中有模式匹配的过滤条件期望走索引，我们更推荐使用 GIN 或者 GIST 索引，同时配合创建一些插件，比如 pg_trgm，来达到更理想的效果。**如果模式匹配字符串的模式以常量前缀开头，即满足前缀匹配，那么 B-tree 索引也可能被使用。能走 B-tree 索引的理论基础是因为前缀匹配可以被转换成一个范围查询。**本文将对 LIKE 操作符前缀匹配走 B-tree 索引的原理作简要分析。

后面将会涉及到索引访问方法的 opclass（操作符类）和 opfamily（操作符族）的概念，可以参考[另一篇文章](https://zhuanlan.zhihu.com/p/6274893280)。

# 分析

创建一张表 test，具体的创建语句为：

```postgresql
create table test(id int, c2 varchar(20));
insert into test select i, i from generate_series(1,100000)i;
create index idx_test_id_1 on test(id);
create index idx_test_c2_1 on test(c2);
analyze test;

```

## 一般场景

如果我们执行`explain select * from test where id > 1 and id  1::numeric and id 
  
- **过滤条件转换成index_key OP right_arg的形式；**
  
- **`OP`在索引对应的 opfamily 中。**

条件 1 一般默认满足，或者通过操作符的 commutator 交换左右位置也能满足，这里重点介绍下条件 2。

查看 [create index](https://www.postgresql.org/docs/14/sql-createindex.html) 的语法可以看到，在创建索引时可以指定对应的 opclass：

![](/monthly/pic/202411/like-b-tree-img/image_4.png)

如果没有指定，**就会根据每个 index_key 的类型，选择对应的默认 opclass。**每种索引可以为一种类型定义多个 opclass，但是默认的 opclass 有且只有一个。每个 opclass 又属于一个 opfamily，可以通过 pg_opclass 查看对应关系，比如 SQL 1 中用到的索引，是 B-tree 的 int 类型，系统表中的内容为：

![](/monthly/pic/202411/like-b-tree-img/image_5.png)

可以看到 B-tree 的 int 类型只有一个默认的 int4_ops。通过查看 pg_index ，我们可以进一步确认对应关系:

![](/monthly/pic/202411/like-b-tree-img/image_6.png)

我们找到了对应的 opfamily，然后通过查询看到 SQL 1 过滤条件的操作符都在其中：

![](/monthly/pic/202411/like-b-tree-img/image_7.png)

因此条件 2 也满足，能够走索引。

SQL 2 在没有创建表达式索引之前，不能够走索引，也是因为过滤条件最终的操作符为`OP(numeric, numeric)`，不在对应的 opfamily 中。创建表达时索引之后，SQL 2 就能够走表达式索引的关键因素就是上面所说的，opcalss 是根据 index_key 的类型来选择。这个例子中表达式索引的 index_key 是 numeric 类型，所以会默认选择 numeric 类型的 opclass，而`OP(numeric, numeric)`操作符在相应 opfamily 中，因此能够走索引。

![](/monthly/pic/202411/like-b-tree-img/image_8.png)

## LIKE 前缀匹配场景

如果我们执行`explain select * from test where c2 like '111%';`（SQL 3）将会看到执行计划也没有走索引：

![](/monthly/pic/202411/like-b-tree-img/image_9.png)

从执行计划中还可以得到另一个信息，PostgrSQL 会将 LIKE 转换成`~~`操作符。这个操作是在语法解析的时候完成的：

![](/monthly/pic/202411/like-b-tree-img/image_10.png)

类似的行为还有 NOT LIKE 被替换成`!~~`，ILIKE 被替换成`~~*`，NOT ILIKE 被替换成`!~~*`。

依照前面的分析，发现`~~`确实不在 B-tree varchar 类型默认 opclass 所在的 opfamily 中：

![](/monthly/pic/202411/like-b-tree-img/image_11.png)

那这里是不是不符合一般场景的条件，才没有走索引的呢？其实并不是，[官方文档](https://www.postgresql.org/docs/14/indexes-opclass.html)给出了这样的示例：

![](/monthly/pic/202411/like-b-tree-img/image_12.png)

我们查看测试库的字符排序规则以及字符分类信息，确实不是标准的“C” 区：

![](/monthly/pic/202411/like-b-tree-img/image_13.png)

因此，执行`create index idx_test_c2_2 on test(c2 varchar_pattern_ops);`创建索引，再次执行 SQL 3，可以看到已经走了索引：

![](/monthly/pic/202411/like-b-tree-img/image_14.png)

但是这里走索引的操作符并不是`~~`，并且`~~`也同样不在对应的 opfamily 中：

![](/monthly/pic/202411/like-b-tree-img/image_15.png)

出现这种现象的原因是对于 LIKE 这类前缀匹配查询是否能够走 B-tree 索引，PostgreSQL 在进行索引匹配时会进行特殊处理：

  
- **检测模式匹配字符串是否以常量开头，如果是就表示可能可以走索引；**
  
- **检测索引的 opfammily 是否为 xxx_pattern_ops 对应的 opfamily，如果是则能够生成索引路径；**
  
- **2 不满足，则会检测字符的排序规则是否为标准“C” 区，如果满足要求也能够生成索引路径；**
  
- **如果能够生成索引路径，则会在真正生成索引路径时，将过滤条件转换为范围条件，用于 index cond。**

这里有两个值得注意的点：

  
- 如果 database 的字符排序规则和字符分类（两者需要绑定）都是标准“C”区。LIKE 前缀匹配也能使用默认 opclass 的 B-tree 索引（这种情况下默认操作符排序与字符排序的结果一致）：

![](/monthly/pic/202411/like-b-tree-img/image_16.png)

当然，指定 xxx_pattern_ops 的方式也完全可以使用，并且从总体代价上看，示例 SQL 会优先使用后者：

![](/monthly/pic/202411/like-b-tree-img/image_17.png)

  
- 如果我们手动将 SQL 改写成范围查询`explain select * from test where c2 >= '111' and c2 

![](/monthly/pic/202411/like-b-tree-img/image_18.png)