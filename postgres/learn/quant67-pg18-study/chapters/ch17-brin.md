# 第 17 章 对照笔记 — BRIN 与其他索引 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/17-brin.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch17-brin-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】BRIN 与其他索引：什么时候不建 B-Tree 反而更好 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】BRIN 与其他索引：什么时候不建 B-Tree 反而更好 2026-06-16 · database · kernel · #postgresql #pg-kernel #brin #hash-index #bloom-index #btree #index-selection #brin-revmap #page-range 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #brin #hash-index #bloom-index #btree #index-selection #brin-revmap #page-range 目录 BRIN 与其他索引：什么时候不建 B-Tree 反而更好 一、BRIN 的哲学：范围摘要替代逐行索引 问题场景 BRIN 插入与维护 三、运维场景：BRIN 的坑与排查 坑 1：数据物理无序时 BRIN 退化为全表扫描 坑 2：pages_per_range 选太大 坑 4：BRIN 扫描的 IO 模式 四、Hash 索引：WAL 安全边界与适用场景 历史包袱：PG 9.x 的 Hash 索引不支持 WAL 五、Bloom 索引：多列任意组合过滤 问题场景 Bloom 索引的代价与收益 Bloom 索引的参数选择 Bloom 索引的限制 六、索引选择决策树 代价速查表 七、实验：BRIN vs B-Tree 在时序数据上的对比 环境与数据 查询性能对比 八、关键要点 参考资料 源码（PG 17） 官方文档 BRIN 与其他索引：什么时候不建 B-Tree 反而更好 如果你有一张 1TB 的传感器数据表，按时间列 ts 查询某一天的数据。建 B-Tree 索引需要扫描每一行、排序、写 WAL——索引本身可能 200GB，建索引跑一下午。但你会本能地意识到这件事的荒谬： ts 列的值天然有序，新数据 ts 越来越大， ts 与物理存储位置高度相关。有没有一种索引，只利用”page range 内的最大值和最小值”，而不逐行建立指针？ 有。BRIN（Block Range INdex）做的事情就是这个。它不是 B-Tree 的替代品，而是在”数据物理有序、表太大、查询只关心范围”的场景下，把索引空间和时间开销从 \(O(n)\) 降到 \(O(n/\text{range\_size})\) 。 本文从 BRIN 的内部结构（revmap + summary tuple）出发，说明它如何用极小的代价提供范围过滤能力。随后讨论另外两种”不建 B-Tree”的索引：Hash 索引的 WAL 安全边界，以及 Bloom 索引的多列任意组合过滤场景。最后给出索引选择的代价对比表和决策树。 一、BRIN 的哲学：范围摘要替代逐行索引 问题场景 CREATE TABLE sensor_data ( ts TIMESTAMPTZ, dev_id INTEGER , temp DOUBLE PRECISION ); -- 每天 1000 万行，运行一年 -- 总行数：~36 亿 -- 表大小：~300GB -- 常见查询：查某一天的温度 SELECT * FROM sensor_data WHERE ts BETWEEN &#39;2025-06-01&#39; AND &#39;2025-06-02&#39; ; ```text B - Tree 在这个场景下有两个问题： 1. ** 建索引代价 ** ：B - Tree 需要读全表、排序、写 WAL， 300 GB 表上可能需要数小时。索引本身大约 50 - 80 GB。 2. ** 索引维护代价 ** ：每次 INSERT 都要更新 B - Tree，可能触发页面分裂和 WAL 写入。每天 1000 万行的写入速度下，索引维护可能成为瓶颈。 BRIN 的观察很简单：如果 `ts` 值与物理存储位置高度相关（新数据自然追加到表的后面），那么每个 page range（比如 128 个连续页面 = 1 MB）只需要存两条信息——这个 range 内 `ts` 
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| brinbuild | src/backend/access/brin/brin.c | 元数据构建 |
| brininsert | 同上 | 单条插入 (会更新摘要) |
| bringetbitmap | 同上 | 范围扫描 |
| revmap | src/backend/access/brin/brin_revmap.c | 块号→摘要页 映射 |
| hash 索引 | src/backend/access/hash/hash.c | PG11+ WAL-logged |
| Bloom 扩展 | contrib/bloom/blinsert.c | 多列联合过滤 |


## 三、PG18 源码摘录


### 17.1 brinbuild (brin.c)
```c
IndexBuildResult *
brinbuild(Relation heap, Relation index, IndexInfo *indexInfo)
{
	IndexBuildResult *result;
	double		reltuples;
	double		idxtuples;
	BrinRevmap *revmap;
	BrinBuildState *state;
	Buffer		meta;
	BlockNumber pagesPerRange;

	/*
	 * We expect to be called exactly once for any index relation.
	 */
	if (RelationGetNumberOfBlocks(index) != 0)
		elog(ERROR, "index \"%s\" already contains data",
			 RelationGetRelationName(index));

	/*
	 * Critical section not required, because on error the creation of the
	 * whole relation will be rolled back.
	 */

	meta = ExtendBufferedRel(BMR_REL(index), MAIN_FORKNUM, NULL,
							 EB_LOCK_FIRST | EB_SKIP_EXTENSION_LOCK);
	Assert(BufferGetBlockNumber(meta) == BRIN_METAPAGE_BLKNO);

	brin_metapage_init(BufferGetPage(meta), BrinGetPagesPerRange(index),
					   BRIN_CURRENT_VERSION);
	MarkBufferDirty(meta);

	if (RelationNeedsWAL(index))
	{
		xl_brin_createidx xlrec;
		XLogRecPtr	recptr;
		Page		page;

		xlrec.version = BRIN_CURRENT_VERSION;
		xlrec.pagesPerRange = BrinGetPagesPerRange(index);

		XLogBeginInsert();
		XLogRegisterData(&xlrec, SizeOfBrinCreateIdx);
		XLogRegisterBuffer(0, meta, REGBUF_WILL_INIT | REGBUF_STANDARD);

		recptr = XLogInsert(RM_BRIN_ID, XLOG_BRIN_CREATE_INDEX);

		page = BufferGetPage(meta);
		PageSetLSN(page, recptr);
	}

	UnlockReleaseBuffer(meta);

	/*
	 * Initialize our state, including the deformed tuple state.
	 */
	revmap = brinRevmapInitialize(index, &pagesPerRange);
	state = initialize_brin_bui
```

### 17.2 hashinsert (hash.c)
```c
bool
hashinsert(Relation rel, Datum *values, bool *isnull,
		   ItemPointer ht_ctid, Relation heapRel,
		   IndexUniqueCheck checkUnique,
		   bool indexUnchanged,
		   IndexInfo *indexInfo)
{
	Datum		index_values[1];
	bool		index_isnull[1];
	IndexTuple	itup;

	/* convert data to a hash key; on failure, do not insert anything */
	if (!_hash_convert_tuple(rel,
							 values, isnull,
							 index_values, index_isnull))
		return false;

	/* form an index tuple and point it at the heap tuple */
	itup = index_form_tuple(RelationGetDescr(rel), index_values, index_isnull);
	itup->t_tid = *ht_ctid;

	_hash_doinsert(rel, itup, heapRel, false);

	pfree(itup);

	return false;
}
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 BRIN**: 算法未变, 每个 N-block range 存一组 min/max
2. **PG11+ hash WAL**: 已稳定, PG18 仍可用 hash 索引 (PG10 之前不推荐生产)
3. **Bloom**: 仍为 contrib 扩展, 适合多列 "AND" 联合查询, 但代价高
4. **BRIN pages_per_range**: 默认 128, 越小越精细, 越大越紧凑


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch17-brin-evidence.txt`


### 关键输出
```
DROP TABLE
CREATE TABLE
INSERT 0 1000000
ANALYZE
CREATE INDEX
 brin_size 
-----------
 24 kB
(1 row)

DROP INDEX
CREATE INDEX
 btree_size 
------------
 21 MB
(1 row)

DROP INDEX
CREATE INDEX
CREATE INDEX
                                 QUERY PLAN                                  
-----------------------------------------------------------------------------
 Index Scan using t_brin_id_idx on t_brin  (cost=0.00..8.02 rows=1 width=19)
   Index Cond: (id = 500000)
(2 rows)


```


## 六、GDB 调试示例


观察 BRIN 摘要构建:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break brin.c:brinbuild
(gdb) continue
# 另一窗口: CREATE INDEX ON t_brin USING brin(t);
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 BRIN/Hash/Bloom 三种特殊索引
- 待查: Ch.18 流复制 — WAL Sender/Receiver 主从协议
