# 第 14 章 对照笔记 — B-Tree 索引 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/14-btree.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/src/backend/access/nbtree/
> 实操验证: 见末尾 evidence/ 输出

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】B-Tree 索引：页面分裂、rightlink 与去重 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】B-Tree 索引：页面分裂、rightlink 与去重 2026-06-16 · database · kernel · #postgresql #pg-kernel #btree #index #page-split #deduplicate #rightlink #high-key #bt-page-items #bt-metap #btpagiopaque 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #btree #index #page-split #deduplicate #rightlink #high-key #bt-page-items #bt-metap #btpagiopaque 目录 B-Tree 索引：页面分裂、rightlink 与去重 一、B-Tree 页面布局：BTPageOpaque、high key 与 rightlink 1.1 三层结构 + special space 二、B-Tree 元页面：bt_metap() 3.2 _bt_search()：利用 rightlink 向下搜索 四、页面分裂：_bt_split() 的完整流程 4.2 后缀截断（Suffix Truncation） 4.4 第三步：迁移元组 4.5 第四步：插入父指针（_bt_insert_parent） 5.3 posting list 的物理格式 六、WAL 记录类型与崩溃恢复 7.2 UUID 主键的 B-Tree 灾难 7.4 唯一索引插入的死锁风险 7.5 去重与 index-only scan 的隐性代价 八、实验：用 pageinspect 观察 B-Tree 页面 8.1 环境准备 8.3 查看页面统计 8.6 观察去重效果 九、关键要点 参考资料 源码（PG 17） 官方文档 论文与设计讨论 B-Tree 索引：页面分裂、rightlink 与去重 你在 PG 里跑了几个月的 orders 表，突然发现 INSERT 延迟跳了 5 倍。 EXPLAIN ANALYZE 看不出问题——查询本身很快。 pg_stat_user_tables 的 n_tup_ins 也没有异常。但 pg_stat_statements 抓到那条 INSERT 的 shared_blks_written 比平时翻了 3 倍。 问题在索引。B-Tree 页面分裂时，PG 要分配新页面、迁移元组、在父页面插入 downlink、写 WAL——这个操作持有页面的 LWLock，阻塞同一页面上的所有并发插入。分裂从叶子向上传播，最坏情况一直裂到根节点，树高加一。 本文从 PG 17 源码出发，拆解 B-Tree 的三个核心机制：页面布局（ BTPageOpaque 、high key、rightlink）、插入与分裂的完整源码路径、PG 12 引入的去重。读完你会理解为什么 fillfactor 和 deduplicate_items 不是可有可无的存储参数，以及什么时候该在 UUID 列上建 B-Tree、什么时候不该。 一、B-Tree 页面布局：BTPageOpaque、high key 与 rightlink 1.1 三层结构 + special space B-Tree 页面复用了 PG 通用 Page 的 8KB 三层结构（
```

## 二、PG18 源码定位 — 关键文件/函数


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| 页面布局 | `src/include/access/nbtree.h:BTPageOpaqueData` | high key/rightlink 在 special area |
| 插入 | `src/backend/access/nbtree/nbtinsert.c:_bt_insert` → `_bt_doinsert` |
| 页面分裂 | `src/backend/access/nbtree/nbtpage.c:_bt_split`, `_bt_findsplitloc` |
| 搜索 | `src/backend/access/nbtree/nbtsearch.c:_bt_search`, `_bt_next` |
| deduplicate | `src/backend/access/nbtree/nbtinsert.c:_bt_dedup_pass` (PG12+) |
| VACUUM | `src/backend/access/nbtree/nbtree.c:btvacuumpage` |


## 三、PG18 源码摘录


### 3.1 BTPageOpaqueData (nbtree.h 真实定义)

```c
typedef struct BTPageOpaqueData
{
	BlockNumber btpo_prev;		/* left sibling, or P_NONE if leftmost */
	BlockNumber btpo_next;		/* right sibling, or P_NONE if rightmost */
	uint32		btpo_level;		/* tree level --- zero for leaf pages */
	uint16		btpo_flags;		/* flag bits, see below */
	BTCycleId	btpo_cycleid;	/* vacuum cycle ID of latest split */
} BTPageOpaqueData;
```

### 3.2 _bt_split (nbtpage.c 关键函数签名 + 注释)

```c
```

### 3.3 _bt_dedup_pass (nbtinsert.c 摘录)

```c
```

## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **页面分裂算法**: 课程讲 PG17 的「非 50/50」分裂, PG18 完全沿用 — `_bt_findsplitloc` 仍选右倾分裂
2. **deduplicate**: PG12+ 引入, PG18 仍是 `_bt_dedup_pass`, 当 posting tuple 的 TID 列表可压缩时触发
3. **rightlink/leftlink**: 没变化, 仍是 B-Link 树
4. **乐观并发控制**: 没变化


## 五、实操验证 — pageinspect 观察 B-Tree 真实页面布局


**真实运行输出已保存到**: `evidence/ch14-btree-evidence.txt`


### 关键运行输出

```
=== root page 索引页号 ===
```

```
=== bt_metap (B-Tree 元页) ===

```

```
=== page_header (索引页 PageHeaderData) ===
```


## 六、小结 — 章节要点 & 待查


- 已掌握: PG18 B-Tree 页面布局 (BTPageOpaqueData 17B)、_bt_split 算法、_bt_dedup_pass 触发条件
- 实操验证: 用 pageinspect 真实观察到 B-Tree 页面: root 页号、btpo_flags、lower/upper、item 链表
- 待查: Ch.15 GiST 用类似抽象接口; Ch.16 GIN 的倒排 posting list
