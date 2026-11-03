# 第 16 章 对照笔记 — GIN 索引 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/16-gin.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch16-gin-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】GIN 索引：倒排索引的内部机制与 Fast Update | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】GIN 索引：倒排索引的内部机制与 Fast Update 2026-06-16 · database · kernel · #postgresql #pg-kernel #gin #inverted-index #full-text-search #tsvector #fast-update #pending-list #bitmap-scan #intarray 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #gin #inverted-index #full-text-search #tsvector #fast-update #pending-list #bitmap-scan #intarray 目录 GIN 索引：倒排索引的内部机制与 Fast Update 一、倒排结构：Entry Tree 与 Posting List / Posting Tree 1.1 为什么是倒排 1.2 Entry Tree：B-Tree over Keys 1.3 Posting List 与 Posting Tree：大小的分界线 2.3 合并时机 2.4 搜索的代价 2.5 关闭 Fast Update 3.2 阶段一：提取查询键 3.3 阶段二：扫描主索引和 Pending List 3.4 阶段三：Bitmap 合并 3.5 阶段四：consistent 过滤 四、全文搜索 tsvector 与数组 _int4 的实现 4.1 tsvector 的 GIN 操作符类 4.2 intarray 的 GIN 操作符类 4.3 JSONB 的 GIN 索引 五、GIN vs GiST：三角权衡与选择建议 5.1 结构差异带来的性能差异 5.2 全文搜索：GIN vs GiST 七、关键要点 参考资料 源码（PG 17） 官方文档 扩展模块 相关文章 GIN 索引：倒排索引的内部机制与 Fast Update PG 有四种内置索引类型：B-Tree 是主键和等值查询的默认选择，GiST 为几何和全文搜索提供平衡树的抽象框架，BRIN 为超大表提供极简的范围摘要。而 GIN（Generalized Inverted Index）处理的是这三种都不擅长的问题： 一个数据行包含多个索引键 。 典型场景随处可见。一个 tsvector 字段从文档中提取出几十个词，每个词都是搜索入口；一个 integer[] 字段包含几十个元素，每个元素都可能出现在 @ 查询中；一个 JSONB 字段的顶层键和值都需要索引。 如果你用 B-Tree 索引数组字段， ANY 查询会把每个元素当成独立的索引查找，效率随元素数量线性退化。GiST 可以做，但 GIN 在”键多而行少”的场景下结构化优势更明显——它的倒排结构把”键到行”的映射直接写死在索引里，搜索时不需要遍历数据行。 本文将逐层拆解 GIN 的内部结构、Fast Update 机制、搜索流程，以及 GIN 和 GiST 的选择权衡。 一、倒排结构：Entry Tree 与 Posting List / Posting Tree 1.1 为什么是倒排 B-Tree 索引的数据模型是”一行 → 一个键”：一行表数据最多对应一个索引条目。GIN 的数据模型是”一个键 → 多行”：一个键值（如一个词、一个数组元素）可能出现在大量行的索引字段中。这是倒排索引（inverted index）的基础模型——不是从行找键，而是从键找行。 GIN 把这种映射拆成两层结构： Entry Tree 负责”键值到键条目”的查找， Posting List / Posting Tree 负责”键条目到行 ID”的映射。 1.2 Entry Tree：B-Tree over Keys Entry Tree 是 GIN 的顶层结构：一个标准 B-Tree，其键是被索引复合值中提取出的每一个原子元素。对于 tsvector 索引，键是每一个词位（lexeme）；对于 intarray 索引，键是数组中的每个整数。 Entry T
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| gininsert | src/backend/access/gin/gininsert.c | 入口 |
| ginEntryInsert | 同上 | 词条插入 |
| gingetbitmap | src/backend/access/gin/ginget.c | bitmap AND/OR |
| ginHeapTupleFastInsert | src/backend/access/gin/ginfast.c | Fast Update pending list |
| processPending | 同上 | 刷 pending list 到主树 |
| ginvacuumcleanup | src/backend/access/gin/ginvacuum.c | vacuum |
| GIN posting list | src/backend/access/gin/ginpostinglist.c | 压缩存储 |


## 三、PG18 源码摘录


### 16.1 ginHeapTupleFastInsert (ginfast.c)
```c
void
ginHeapTupleFastInsert(GinState *ginstate, GinTupleCollector *collector)
{
	Relation	index = ginstate->index;
	Buffer		metabuffer;
	Page		metapage;
	GinMetaPageData *metadata = NULL;
	Buffer		buffer = InvalidBuffer;
	Page		page = NULL;
	ginxlogUpdateMeta data;
	bool		separateList = false;
	bool		needCleanup = false;
	int			cleanupSize;
	bool		needWal;

	if (collector->ntuples == 0)
		return;

	needWal = RelationNeedsWAL(index);

	data.locator = index->rd_locator;
	data.ntuples = 0;
	data.newRightlink = data.prevTail = InvalidBlockNumber;

	metabuffer = ReadBuffer(index, GIN_METAPAGE_BLKNO);
	metapage = BufferGetPage(metabuffer);

	/*
	 * An insertion to the pending list could logically belong anywhere in the
	 * tree, so it conflicts with all serializable scans.  All scans acquire a
	 * predicate lock on the metabuffer to represent that.  Therefore we'll
	 * check for conflicts in, but not until we have the page locked and are
	 * ready to modify the page.
	 */

	if (collector->sumsize + collector->ntuples * sizeof(ItemIdData) > GinListPageSize)
	{
		/*
		 * Total size is greater than one page => make sublist
		 */
		separateList = true;
	}
	else
	{
		LockBuffer(metabuffer, GIN_EXCLUSIVE);
		metadata = GinPageGetMeta(metapage);

		if (metadata->head == InvalidBlockNumber ||
			collector->sumsize + collector->ntuples * sizeof(ItemIdData) > metadata->tailFreeSize)
		{
			/*
			 * Pending list is empty or total size is greater than freespace
			 * on tail page => make subli
```

### 16.2 gingetbitmap 主路径
```c
gingetbitmap(IndexScanDesc scan, TIDBitmap *tbm)
{
	GinScanOpaque so = (GinScanOpaque) scan->opaque;
	int64		ntids;
	ItemPointerData iptr;
	bool		recheck;

	/*
	 * Set up the scan keys, and check for unsatisfiable query.
	 */
	ginFreeScanKeys(so);		/* there should be no keys yet, but just to be
								 * sure */
	ginNewScanKey(scan);

	if (GinIsVoidRes(scan))
		return 0;

	ntids = 0;

	/*
	 * First, scan the pending list and collect any matching entries into the
	 * bitmap.  After we scan a pending item, some other backend could post it
	 * into the main index, and so we might visit it a second time during the
	 * main scan.  This is okay because we'll just re-set the same bit in the
	 * bitmap.  (The possibility of duplicate visits is a major reason why GIN
	 * can't support the amgettuple API, however.) Note that it would not do
	 * to scan the main index before the pending list, since concurrent
	 * cleanup could then make us miss entries entirely.
	 */
	scanPendingInsert(scan, tbm, &ntids);

	/*
	 * Now scan the main index.
	 */
	startScan(scan);

	ItemPointerSetMin(&iptr);

	for (;;)
	{
		if (!scanGetItem(scan, iptr, &iptr, &recheck))
			break;

		if (ItemPointerIsLossyPage(&iptr))
			tbm_add_page(tbm, ItemPointerGetBlockNumber(&iptr));
		else
			tbm_add_tuples(tbm, &iptr, 1, recheck);
		ntids++;
	}

	return ntids;
}
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 GIN**: 仍是 entry tree + posting tree/list 两层结构
2. **Fast Update**: 仍是 pending list 攒批量刷, 由 GIN_PENDING_LIST_LIMIT (默认 4MB) 控制
3. **GIN vs GiST**: 见 ch15 — GIN 适合「词包内多元素」(全文检索), GiST 适合「几何/全文+范围」


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch16-gin-evidence.txt`


### 关键输出
```
DROP TABLE
CREATE TABLE
INSERT 0 10000
CREATE INDEX
ANALYZE
                                                     QUERY PLAN                                                     
--------------------------------------------------------------------------------------------------------------------
 Aggregate  (cost=2814.00..2814.01 rows=1 width=8) (actual time=76.311..76.318 rows=1.00 loops=1)
   Buffers: shared hit=164
   ->  Seq Scan on t_gin  (cost=0.00..2789.00 rows=10000 width=0) (actual time=0.024..61.846 rows=10000.00 loops=1)
         Filter: (body @@ to_tsquery('postgresql & database'::text))
         Buffers: shared hit=164
 Planning:
   Buffers: shared hit=14
 Planning Time: 0.247 ms
 Execution Time: 76.353 ms
(9 rows)

 gin_size 
----------
 1272 kB
(1 row)


```


## 六、GDB 调试示例


观察 GIN pending list 刷盘:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break ginfast.c:ginHeapTupleFastInsert
(gdb) break ginfast.c:processPending
(gdb) continue
# 另一窗口: INSERT INTO t_gin ...
# VACUUM t_gin;  # 触发 processPending
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 GIN 倒排结构 + pending list 批量
- 待查: Ch.17 BRIN/Hash — 超大表秒级索引
