# 第 15 章 对照笔记 — GiST 索引 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/15-gist.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch15-gist-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】GiST 索引：一套接口搞定几何、全文、数组——通用搜索树怎么把 像什么 变成索引查找 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】GiST 索引：一套接口搞定几何、全文、数组——通用搜索树怎么把 像什么 变成索引查找 2026-06-16 · database · kernel · #postgresql #pg-kernel #gist #index #consistent #penalty #picksplit #point-ops #tsvector-ops #full-text-search #geometric-index #generalized-search-tree 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #gist #index #consistent #penalty #picksplit #point-ops #tsvector-ops #full-text-search #geometric-index #generalized-search-tree 目录 GiST 索引：一套接口搞定几何、全文、数组——通用搜索树怎么把”像什么”变成索引查找 一、GiST 的设计动机与核心抽象 Consistent(giststate, entry, query, strategy, recheck) Union(giststate, entryvec, attrsz) Penalty(giststate, origentry, newentry) PickSplit(giststate, entryvec, left, right, delta) Compress(giststate, entry) / Decompress(giststate, entry) GiST 页面布局 搜索流程 并发搜索的 rightlink 机制 五、point_ops：几何索引的 GiST 实现 Compress：point → BOX Penalty：MBR 面积增量 六、tsvector_ops：全文搜索的 GiST 实现 签名树原理 Compress / Decompress 七、运维：GiST vs GIN 的选择与常见坑 GiST vs GIN 对比 选择规则 索引膨胀与 VACUUM KNN 查询的性能陷阱 八、关键要点 参考资料 源码（PG 17） 官方文档 论文 实验工具 GiST 索引：一套接口搞定几何、全文、数组——通用搜索树怎么把”像什么”变成索引查找 假设你要在一个包含 100 万个地理坐标的表中查找距离 (116.38, 39.90) 最近的 10 个点。B-Tree 帮不了你——它只能做一维排序，没法回答”二维空间中谁离我最近”。全文搜索也类似——找包含 “database” AND “index” 的文档，不是找某个确切值，而是找满足布尔谓词的集合。 PG 的答案是 GiST（Generalized Search Tree，通用搜索树）。它不定义具体的索引逻辑，而是定义一组抽象算子接口——Consistent、Union、Penalty、PickSplit——你只需按你的数据类型实现这几个函数，就能得到一个完整的平衡搜索树索引。 point_ops 用这套接口做空间索引（R-Tree 风格）， tsvector_ops 用同一套接口做全文搜索（签名树风格）。本文从这组接口出发，拆解搜索、插入、分裂的完整流程。 一、GiST 的设计动机与核心抽象 B-Tree 的核心能力是 一维全序比较 ：给定任意两个键，总能判定它们之间的大小关系。这个前提很多数据类型不满足： 几何类型 ： (1,2) 和 (3,4) 谁大谁小？没有天然的全序。查询”覆盖哪些点”或”谁离我最近”是空间包含或距离度量问题。 全文搜索 ： 'database' 'index' 有意义吗？查询 to_tsquery('database index') 是集合包含问题。 范围类型 ： [1,10) 和 [5,15) 有部分序——可以说谁包含谁、谁和谁重叠，但不能说谁更大。 GiST 把这些类型统一为一种抽象： 每个 key 是一种 p
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| gistinsert | src/backend/access/gist/gist.c | 入口 |
| gistgettuple | 同上 | 搜索 |
| gistSplitByKey | src/backend/access/gist/gistsplit.c | PickSplit 实现 |
| gistBuildCallback | src/backend/access/gist/gistbuild.c | bulk build |
| GISTSTATE | src/include/access/gist.h | 操作符类状态 |
| point_ops | contrib/btree_gist (示例) | 几何类型 |
| tsvector_ops | contrib/pg_trgm (示例) | 全文 |


## 三、PG18 源码摘录


### 15.1 gistinsert (gist.c)
```c
bool
gistinsert(Relation r, Datum *values, bool *isnull,
		   ItemPointer ht_ctid, Relation heapRel,
		   IndexUniqueCheck checkUnique,
		   bool indexUnchanged,
		   IndexInfo *indexInfo)
{
	GISTSTATE  *giststate = (GISTSTATE *) indexInfo->ii_AmCache;
	IndexTuple	itup;
	MemoryContext oldCxt;

	/* Initialize GISTSTATE cache if first call in this statement */
	if (giststate == NULL)
	{
		oldCxt = MemoryContextSwitchTo(indexInfo->ii_Context);
		giststate = initGISTstate(r);
		giststate->tempCxt = createTempGistContext();
		indexInfo->ii_AmCache = giststate;
		MemoryContextSwitchTo(oldCxt);
	}

	oldCxt = MemoryContextSwitchTo(giststate->tempCxt);

	itup = gistFormTuple(giststate, r, values, isnull, true);
	itup->t_tid = *ht_ctid;

	gistdoinsert(r, itup, 0, giststate, heapRel, false);

	/* cleanup */
	MemoryContextSwitchTo(oldCxt);
	MemoryContextReset(giststate->tempCxt);

	return false;
}
```

### 15.2 gistgettuple 主路径
```c

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 GiST**: 算法未变, 仍是 Consistent/Union/Penalty/PickSplit 抽象接口
2. **Bulk build**: gistbuild.c 仍是无锁 sorting 算法 (PG9.1+)
3. **GiST 适用场景**: 几何 (point/polygon/box) + 全文 (tsvector) + 范围 (range types)
4. **GIN vs GiST**: 见 ch16 对照


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch15-gist-evidence.txt`


### 关键输出
```
DROP TABLE
CREATE TABLE
INSERT 0 5000
CREATE INDEX
CREATE INDEX
ANALYZE
                                                        QUERY PLAN                                                        
--------------------------------------------------------------------------------------------------------------------------
 Bitmap Heap Scan on t_gist  (cost=4.19..19.07 rows=5 width=36) (actual time=0.426..1.755 rows=808.00 loops=1)
   Recheck Cond: (p <@ '(0.7,0.7),(0.3,0.3)'::box)
   Heap Blocks: exact=42
   Buffers: shared hit=42 read=12
   ->  Bitmap Index Scan on t_gist_p_idx  (cost=0.00..4.18 rows=5 width=0) (actual time=0.404..0.406 rows=808.00 loops=1)
         Index Cond: (p <@ '(0.7,0.7),(0.3,0.3)'::box)
         Index Searches: 1
         Buffers: shared read=12
 Planning:
   Buffers: shared hit=13
 Planning Time: 0.196 ms
 Execution Time: 2.909 ms
(12 rows)

                                                        QUERY PLAN                                                        
--------------------------------------------------------------------------------------------------------------------------
 Index Scan using t_gist_ts_idx on t_gist  (cost=0.40..8.42 rows=1 width=36) (actual time=0.075..0.245 rows=1.00 loops=1)
   Index Cond: (ts @@ to_tsquery('word1'::text))
   Index Searches: 1
   Buffers: shared hit=9
 Planning:
   Buffers: shared hit=2 read=1
 Planning Time: 0.149 ms
 Execution Time: 0.266 ms
(8 rows)

 gist_p | gist_ts 
--------+---------
 328 kB | 168 kB
(1 row)


```


## 六、GDB 调试示例


观察 GiST 插入/搜索:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break gist.c:gistinsert
(gdb) break gist.c:gistgettuple
(gdb) continue
# 另一窗口: INSERT INTO t_gist ... / SELECT * FROM t_gist WHERE p <@ ...
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 GiST 抽象接口 + bulk build 算法
- 待查: Ch.16 GIN — 倒排结构 vs GiST 树状结构的取舍
