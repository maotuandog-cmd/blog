# quant67/storage 7 篇精读合订本

> 来源: quant67/storage 25, 28, 38, 39, 40, 48, 57 章
> 日期: 2026-09-04
> 本地缓存: /home/obsidian/postgres/learn/quant67-storage-md/ (5.1 MB)
> 选篇标准: 跟 PG/PolarDB 笔记体系 + 国产 DB 笔记 + 生产实战强相关
> 写作风格: 按 quant67-pg-kernel 笔记结构, 大量保留 quant67 原文事实/代码/参数
> 关联笔记: README-pG内核学习总图.md, quant67-storage-notes.md, digblog 全部, polardb 全部

================================================================
一、25 章 B+Tree 与 B+Tree 工程实现 (基于 1921 行精读)
================================================================

1.1 B-Tree 起源与设计目标
来源: §1
- 1970 年 Rudolf Bayer + Edward McCreight (波音) 提出
- 统治关系型数据库索引层 50+ 年 (PG/InnoDB/SQLite/Oracle/SQL Server)
- 核心目标: 把树高度压到 3-4 层, 每次查找只 3-4 次 I/O
- 做法: 节点大小对齐到磁盘页 (4-16KB), 每节点容纳成百上千个键 → 高扇出 (Fanout)

1.2 B-Tree 高度估算
来源: §1.3
  h ≤ log_{⌈m/2⌉}((n+1)/2)
  
InnoDB 实测 (16KB page, 8B bigint 主键, 6B 指针):
- 扇出约 1170
- 1 层 → 1169 条
- 2 层 → 137 万条
- 3 层 → 16 亿条
- 4 层 → 1.87 万亿条

→ 三层 B+Tree 索引 16 亿条, 根+内部节点常驻内存时实际 I/O 只需 1-2 次

1.3 B-Tree vs B+Tree 关键差异
来源: §2

| 特性     | B-Tree                | B+Tree (主流选择)        |
| -------- | --------------------- | ------------------------- |
| 数据位置 | 所有节点              | 仅叶子节点                |
| 叶子链表 | 无                    | 有 (双向链表)             |
| 内部扇出 | 较低                  | 较高 (不存数据)            |
| 范围查询 | 需中序遍历            | 叶子链表顺序扫描 (优)     |
| 单点查找 | 可能中间层命中        | 必须到叶子                |
| 全扫描   | 遍历所有节点          | 仅遍历叶子                |
| 空间     | 键不重复              | 分隔键有副本              |
| 实际使用 | 文件系统 (部分)       | 几乎所有 RDBMS            |

B+Tree 优势的具体表现:
- OLTP 范围查询 (`WHERE id BETWEEN 100 AND 200`) → 顺序扫描, 性能提升一个数量级
- 内部节点全部常驻内存, 单点查找只读 1 个叶子页

1.4 页内布局: Slotted Page
来源: §3

Slotted Page 结构:
  Page Header (页 ID/类型/槽位数/LSN/校验和)
  Slot Array → (向右增长, 2 字节/槽位, 指向 Cell 位置)
  Free Space (中间)
  Cell Data ← (向左增长, 实际数据)
  Page Trailer (校验和)

优势:
- 插入只需追加 Cell + 移动 2 字节槽位 (O(1) + 极小开销)
- 删除只需移除槽位, Cell 数据标记可回收
- 槽位跟 Cell 物理顺序解耦

页大小权衡:
- InnoDB 默认 16KB, PG 8KB, SQLite 4KB
- 越大: 扇出高/树矮/I/O 少, 但写放大严重
- 越小: 写放大小/缓存多页, 但树高/I/O 多

1.5 分裂与合并
来源: §4

叶子节点分裂:
  1. 创建新叶子页
  2. 把后半部分记录移到新页
  3. 更新叶子链表指针 (双向)
  4. 把新页最小键 (分隔键) 插入父节点

根节点分裂 → 树长高 1 层 (最坏情况)

3 种分裂策略:
| 策略     | 描述                                | 空间利用率     |
| -------- | ----------------------------------- | -------------- |
| 50/50    | 传统, 左右各半                      | ~50% (顺序插入) |
| 90/10    | InnoDB 顺序插入模式 (PAGE_LAST_INSERT+PAGE_DIRECTION) | ~100% |
| 前缀分裂 | PG, 选短分隔键                      | 较高           |

合并 (Merge) vs 重分配 (Redistribution):
- 重分配: 从兄弟借一个键 + 更新父分隔键 (轻)
- 合并: 两节点合并 + 删父分隔键 (重, 可能级联)
- PG nbtree 不做合并, 只标记空页复用
- InnoDB MERGE_THRESHOLD 默认 50% 才尝试合并, 失败不重试

1.6 并发控制: 4 种方案
来源: §5

锁 vs 闩锁 (Latch) 关键区分:
| 属性     | Lock (锁)         | Latch (闩锁)          |
| -------- | ----------------- | --------------------- |
| 保护     | 逻辑资源 (行)     | 物理资源 (页)         |
| 持续时间 | 整个事务          | 一次操作              |
| 死锁     | 检测 + 回滚       | 编码保证无死锁        |
| 模式     | S/X/IS/IX/SIX     | Read/Write            |
| 开销     | 较大              | 极小                  |

B+Tree 用 Latch, 不是 Lock

(1) Latch Coupling / Crabbing (螃蟹协议, 经典):
  读: 当前节点加 Read Latch → 子节点加 Read Latch → 释放父
  写: 当前节点加 Write Latch → 子节点加 Write Latch → 子节点"安全"(不分裂)则释放所有祖先 → 重复
  
  悲观问题: 根节点 Write Latch 是全局热点, 高并发瓶颈

(2) Optimistic Latch Coupling (乐观):
  - 乐观阶段: 内部节点只加 Read Latch, 叶子加 Write Latch
  - 检查阶段: 叶子不需要分裂 → 直接完成
  - 回退阶段: 需要分裂 → 释放所有 Latch, 改悲观模式重新来
  
  大多数写操作不需要分裂, 很少回退 → 显著减少根锁竞争

(3) B-link Tree (Lehman-Yao 1981) — 跟 PG 笔记关联:
  - 每个节点加 right-link pointer + high-key
  - 写: 加 SMO 期间 search 仍能通过 right-link 找到正确节点
  - → 不需要同时锁父+子, 锁粒度降到 1 个节点
  - 详见 polardb 笔记 §六 + quant67-storage-md 25 章 §5.6

(4) Optimistic Lock Coupling (OLC, Leis 2016/2019):
  - 用版本号代替 Read Latch
  - struct Node { uint64_t version; ... }
  - 读: v = node->version → 读数据 → 校验 v 未变
  - 写: lock (置写标记) → 改数据 → unlock (递增 version)
  - 读完全不修改共享状态, 多核 CPU 无 cache line invalidation
  - 高并发读为主负载下接近无锁数据结构性能

1.7 前缀压缩 + 后缀截断
来源: §6

目标: 同 16KB 页塞更多键, 提升扇出

前缀压缩 (Prefix Compression):
  公共前缀存 1 次, 后续键只存后缀
  例: "https://www.example.com/products/" 存 1 次, "apple"/"banana"/"cherry" 存后缀

增量编码 (Delta Encoding):
  Slot 0: 完整键
  Slot 1+: prefix_len=N (与前一个共享 N 字节) + 后缀

PG B-Tree (nbtree) 用 deduplication (PG 13+) + suffix truncation (PG 12+)

后缀截断 (Suffix Truncation):
  内部节点分隔键不需要完整, 能区分左右子树即可
  例: "Alexander" vs "Bert" → 分隔键可以只 "B"
  节省 80% 空间
  PG 12+ 引入, Peter Geoghegan 提交

分组前缀压缩 (Group Prefix Compression):
  - 每 16 个键设一个重启点 (Restart Point), 重启点存完整键
  - 二分查找先在组间跳转, 再组内顺序解压
  - LevelDB/RocksDB SSTable 用的就是这个

1.8 批量加载 (Bulk Loading)
来源: §7

自底向上构建 (Bottom-up Construction):
  1. 排序输入数据
  2. 填充叶子层 (每页达 Fill Factor)
  3. 构建内部层 (用叶子分隔键 + 指针填页)
  4. 直到根节点只 1 页

Fill Factor (装填因子):
  - 100%: 空间最高, 后续插入立即分裂
  - 70-90%: 预留空间给后续随机插入
  - 50%: 跟逐条插入最坏情况一致, 通常不需要

实际:
  - InnoDB ALGORITHM=INPLACE: 排序索引构建, 比旧版本快 3-5 倍
  - PG CREATE INDEX: 默认外部排序 + 自底向上 (CONCURRENTLY 走逐条插入, 慢但非阻塞)
  - SQLite: Sorter 临时排序 + 批量写入

I/O 模式以顺序写为主, 跟逐条插入的随机 I/O 性能差几十倍

1.9 写时复制 (CoW) B-Tree — LMDB/BoltDB
来源: §8

核心思想: 修改节点不原地更新, 写到新页, 父节点指针指向新页 (向上传播到根)

LMDB 三大设计:
  - 双根节点 (交替更新, 崩溃时另一个仍可用)
  - 不需要 WAL (旧版本始终完整)
  - 读事务无锁 (记录开始时的根指针即快照)

跟 PG MVCC 对比:
  - PG: 每行存 xmin/xmax, 需要 VACUUM 回收
  - LMDB: 树级版本管理, 粒度粗但简单

代价:
  - 写放大: 4 层树每改 1 行需写 4 页
  - 碎片化
  - 空间回收延迟: 长事务阻止旧页回收 → 文件不断增长
  - 不适合写密集/大量随机更新/长事务

适用: 读多写少 + 需要一致性快照 + 嵌入式 (LMDB 1 万行 C 代码)
代表: LMDB (Howard Chu, OpenLDAP), BoltDB (Go, etcd)

1.10 InnoDB B+Tree 关键实现
来源: §9

聚簇索引 (Clustered Index):
  - InnoDB 表数据即 B+Tree 叶子内容 (IOT, Index-Organized Table)
  - 主键 = 聚簇索引
  - 二级索引叶子存主键 (不是物理地址), 回表需要二次查找

16KB Page 结构:
  - FIL Header (38B) + Page Header (56B)
  - Infimum + Supremum 虚拟记录 (各 13B)
  - User Records (next_record 链表)
  - Page Directory (稀疏, 每 4-8 条记录一个槽)
  - FIL Trailer (8B)

自适应哈希索引 (AHI):
  - 监控 B+Tree 查找模式, 自动为热点前缀建内存 Hash
  - 等值查询从 3 次页访问 → 1 次
  - innodb_adaptive_hash_index 默认 ON
  - MySQL 8.0 分 8 个分区 (innodb_adaptive_hash_index_parts), 减少全局闩锁争用

Change Buffer:
  - 二级索引页不在缓冲池时, 不立即读, 缓存修改到 Change Buffer
  - 也是一棵 B+Tree, 存在 ibdata1
  - 页下次被读入时, 合并 (Merge) 缓存的修改
  - 显著减少写密集负载的二级索引随机 I/O

页分裂源码定位:
  storage/innobase/btr/btr0btr.cc → btr_page_split_and_insert()
  关键步骤: 选择分裂点 → 创建新页 → 移动记录 → 更新链表 → 插父节点 → 写 redo log

1.11 可视化与调试
来源: §10

InnoDB:
  - innodb_ruby (jeremycole/innodb_ruby) 解析 .ibd
  - innodb_space space-index-pages-summary 看每页 level/data/free/records
  - MySQL 8.0: mysql.innodb_index_stats (n_leaf_pages, size, n_diff_pfx01)
  - innodb_metrics: index_page_splits, index_page_reorg_attempts

PG:
  - pageinspect 扩展 (CREATE EXTENSION pageinspect)
  - bt_metap: 看 root 页 + level (树高)
  - bt_page_stats: 看特定页 (blkno, type='r/i/l', live_items, dead_items)
  - bt_page_items: 看页内条目 (itemoffset, ctid, itemlen, data)

诊断案例 (UUID 主键写入性能下降):
  - 原因: UUID 随机 → 每次插入命中不同叶子 → 50/50 分裂 → 空间 50%
  - 解: 改 UUID v7 (时间有序) 或自增 bigint 主键

跟 quant67-pg-kernel 笔记交叉:
  ch14 B-Tree (PG nbtree) ↔ 本章 §7 批量加载
  ch15 GiST / ch16 GIN / ch17 BRIN 跟 B+Tree 互补, 适用不同场景

================================================================
二、28 章 事务隔离级别的存储实现 (基于 2415 行精读)
================================================================

2.1 ACID 四大特性
来源: §1
- 原子性 (Atomicity): WAL 保证
- 一致性 (Consistency): 应用层语义
- 隔离性 (Isolation): 并发控制取舍
- 持久性 (Durability): fsync 落盘

最严格定义: 可序列化 (Serializability) = 等价某种串行执行
SQL-92 定义 4 个隔离级别 (基于"禁止哪些异常"):

| 隔离级别          | 脏读 | 不可重复读 | 幻读 |
| ----------------- | ---- | ---------- | ---- |
| Read Uncommitted | 允许 | 允许       | 允许 |
| Read Committed   | 禁止 | 允许       | 允许 |
| Repeatable Read  | 禁止 | 禁止       | 允许 |
| Serializable     | 禁止 | 禁止       | 禁止 |

注意: 实际还有"写偏斜"等不在标准内的异常

2.2 4 大异常详解
来源: §1.3

脏读 (Dirty Read): 读到未提交数据, T1 回滚后 T2 读到"从未存在"的数据
不可重复读 (Non-repeatable): 同事务两次读同一行, 结果不同
幻读 (Phantom): 同事务两次范围查询, 行集合变化
写偏斜 (Write Skew): 各自读 → 写看似不冲突 → 组合违反约束
  经典案例: 医院值班 (Alice+Bob 都下班 → 夜班无人)

Berenson 1995 批判:
- 标准基于锁模型, 无法描述 MVCC
- 遗漏 Lost Update, Read Skew, Write Skew
- 幻读定义过窄 (只考虑 INSERT)

2.3 锁式隔离: 2PL
来源: §2

锁类型:
- 共享锁 S (读): 多个事务可同时持
- 排他锁 X (写): 排他
- 意向锁 IS/IX: 表/页级, 表达"我打算在更细粒度加锁"

2PL 两阶段锁:
- 增长阶段: 只加锁不释放
- 收缩阶段: 只释放不加新锁
- 锁点: 拿最后一把锁的时刻, 按锁点排序 = 合法串行顺序

SS2PL (强严格 2PL, 主流): 所有锁都在 commit/rollback 后才释放
- 避免级联回滚, 简化恢复

2PL 实现各隔离级别:
| 级别            | 读锁策略            | 写锁策略        |
| --------------- | ------------------- | --------------- |
| RU              | 不加读锁            | 长写锁          |
| RC              | 短读锁 (读完即释放) | 长写锁          |
| RR              | 长读锁 (持到事务结束)| 长写锁         |
| Serializable    | 长读锁 + 谓词锁      | 长写锁         |

谓词锁 = 锁住"满足条件的所有行 (含未来插入)" → 实际用 Index-Range Lock / Gap Lock 近似

死锁 Coffman 4 条件: 互斥 + 持有并等待 + 不可抢占 + 循环等待
处理: Wait-Die / Wound-Wait (预防) 或 Wait-for Graph 检测 (检测)

2PL 性能问题: 读写冲突 + 锁开销 + 死锁 → 推动 MVCC 发展

2.4 MVCC 基础
来源: §3

核心: 每次修改不覆盖, 创建新版本; 读选可见版本, 写创建新版本
→ "读不阻塞写, 写不阻塞读" (但写写仍互斥)

快照读 (Snapshot Read) vs 当前读 (Current Read):
- 快照: 普通 SELECT, 不加锁
- 当前: SELECT FOR UPDATE / UPDATE / DELETE, 加锁读最新已提交

PG MVCC 特殊点:
- 所有版本存堆表里
- 旧版本 xmax 标记, 新版本 xmin 标记
- UPDATE = 删旧 + 插新 (留两个版本)

版本回收: 旧版本不被任何活跃事务需要时才能回收
- PG: VACUUM 进程
- InnoDB: purge 线程
- 不及时 → 表膨胀 / 性能下降 / XID 耗尽 (PG)

2.5 PostgreSQL MVCC 实现
来源: §4

堆元组 (HeapTuple) 关键字段:
- xmin: 插入该元组的事务 ID
- xmax: 删除/锁定该元组的事务 ID (=0 表示未删)
- cmin/cmax: 事务内命令号
- ctid: 物理位置 (page, item), 指向新版本

可见性判断简化版:
  1. xmin 未提交且不是当前事务 → 不可见
  2. xmin 已回滚 → 不可见
  3. xmin 已提交:
     a. xmax 为空 → 可见
     b. xmax 未提交 → 可见
     c. xmax 已回滚 → 可见
     d. xmax 已提交 → 不可见

快照 (SnapshotData): xmin:xmax:xip_list 格式
  SELECT txid_current_snapshot() 返回 "xmin:xmax:xip_list"

Hint Bits (4 个):
  HEAP_XMIN_COMMITTED  0x0100
  HEAP_XMIN_INVALID    0x0200
  HEAP_XMIN_FROZEN     (XMIN_COMMITTED|INVALID)
  HEAP_XMAX_COMMITTED  0x0400
  HEAP_XMAX_INVALID    0x0800

延迟更新: 第一次访问时通过 SetHintBits 写回
副作用: 写 Hint Bits 会让 page 变脏 → 即使纯 SELECT 也可能产生写 I/O
        (开启 data_checksums 或 wal_log_hints 时更明显, 写 FPI 到 WAL)

可见性映射 (Visibility Map, VM):
- 每个 page 两个 bit: all-visible + all-frozen
- Index-Only Scan 优化: all-visible 不需回表
- VACUUM 优化: 跳过 all-visible page

VACUUM 两种模式:
- 普通 VACUUM: 标记 dead tuple 复用, 更新 FSM/VM
- VACUUM FULL: 重写整表, 锁表, 生产慎用
- Autovacuum: 阈值触发 (默认 dead_tuples > 50 + 0.2 * n_live)

XID 回卷 (32-bit, 42 亿): 详见 digblog-xid 笔记
- frozen xmin = FrozenTransactionId = 2
- 接近 20 亿触发 autovacuum_freeze_max_age

2.6 MySQL InnoDB MVCC
来源: §5

跟 PG 关键差异: 旧版本存在 undo log (回滚段), 不是堆表里

行隐藏字段:
- DB_TRX_ID (6B): 最后修改事务 ID
- DB_ROLL_PTR (7B): 指向 undo log 上一个版本
- DB_ROW_ID (6B): 隐藏 row id (无显式主键时)

Read View 结构:
  m_ids: 所有活跃事务 ID 列表
  m_low_limit_id: 下一个要分配的事务 ID
  m_up_limit_id: 活跃事务中最小 ID
  m_creator_trx_id: 当前事务自己的 ID

可见性判断:
  1. trx_id == m_creator_trx_id → 可见 (自己的)
  2. trx_id < m_up_limit_id → 可见 (早就提交)
  3. trx_id >= m_low_limit_id → 不可见 (之后开始的)
  4. m_up_limit_id <= trx_id < m_low_limit_id:
     - 在 m_ids 中 → 不可见 (活跃)
     - 不在 m_ids 中 → 可见

RC 每次 SELECT 创建新 Read View, RR 整个事务复用

间隙锁 (Gap Lock) + 临键锁 (Next-Key Lock):
- InnoDB RR 通过锁防幻读, 跟 SQL 标准 RR 允许幻读不同
- 4 种场景:
  1. 唯一索引等值找到 → 只加记录锁
  2. 唯一索引等值未找到 → 加间隙锁
  3. 非唯一索引等值 → Next-Key Lock
  4. 范围查询 → 多个 Next-Key Lock
- 例子: id=1,5,10 时, id=3 加 Gap Lock 锁 (1,5)

死锁诊断:
  SHOW ENGINE INNODB STATUS\G → "LATEST DETECTED DEADLOCK" 段
  MySQL 8.0 performance_schema.data_locks / data_lock_waits

PG 死锁: log_lock_waits=on, deadlock_timeout=1s
  查 pg_locks + pg_stat_activity JOIN

2.7 SSI (Serializable Snapshot Isolation)
来源: §6

快照隔离 (SI) 仍允许写偏斜 → 不可序列化
SSI 由 Michael Cahill 2008 提出, PG 9.1+ 切换到 SSI

核心: rw-dependency 检测
  T1 读了 v, T2 改了 v → T1 → T2 rw 边
  危险结构: T1 --rw--> T2 --rw--> T3 (T1=T3 时成环)
  → 中止其中一个事务

PG SSI 关键:
  SIREAD 锁: 不真阻塞, 只记录"哪个事务读了哪些数据"
    3 种粒度: tuple → page → relation (自动升级, 减少内存)
  rw-conflict 列表: 写入与 SIREAD 冲突时记录
  BEGIN ISOLATION LEVEL SERIALIZABLE + 检测失败 → COMMIT 报错
    "could not serialize access due to read/write dependencies"

误杀 (False Positives): SIREAD 粒度升级 + 不区分具体值 + 已提交合并 → 保守
调整: max_pred_locks_per_transaction (默认 64) / _per_relation (10) / _per_page (4)
应用层: 捕获 SerializationFailure 错误, 指数退避重试

2.8 TiDB Percolator 分布式事务
来源: §7

分布式事务 3 挑战: 全局时序 + 原子提交 + 分布式锁

Percolator (Google 2010) 核心组件:
- TSO (Timestamp Oracle): 全局单调递增时间戳
- 两阶段提交: Prewrite + Commit
- 3 Column Families: Default (数据) + Lock (锁) + Write (已提交版本)

Prewrite 阶段:
  1. 拿 start_ts from TSO
  2. 选 Primary Key, 其余 Secondary
  3. 对每个 key: 检 Write CF 写写冲突 / 检 Lock CF 锁冲突
  4. 写 Lock CF + Default CF (key 含 start_ts)

Commit 阶段:
  1. 拿 commit_ts from TSO
  2. 提交 Primary: 写 Write CF + 删 Lock CF (单 Region 原子)
  3. 异步提交 Secondary (Primary 成功就确定)

TiDB 优化:
- Async Commit: commit_ts 下推到 TiKV, 消除第二次 TSO (1 次 TSO, 2 RPC)
- 1PC: 单 Region 事务 Prewrite 直接提交 (1 TSO, 1 RPC)

2.9 各隔离级别下的异常复现
来源: §8 (重要实战案例)

脏读 (RU): T1 改未提交, T2 读到 → T1 rollback → T2 读到"幻数据"
幻读 (RC): T1 范围查询 3 行, T2 插 1 行 commit, T1 再查 4 行
丢失更新 (RC/RR): T1 读 1000+100, T2 读 1000+200, T1 写 1100, T2 写 1200 → T1 +100 丢失
  → 改: UPDATE balance = balance + 100 (原子) 或 SELECT FOR UPDATE

写偏斜 (RR): 详见 2.2 医院值班案例
  → 用 SERIALIZABLE 自动检测; 改: 业务层 SELECT FOR UPDATE

2.10 隔离级别选择指南
来源: §10

各 DB 默认隔离级别:
| 数据库        | 默认         |
| ------------- | ------------ |
| PostgreSQL    | RC (社区推荐) |
| MySQL InnoDB  | RR (历史原因) |
| Oracle        | RC (无 RR)   |
| SQL Server    | RC           |
| TiDB          | RR           |
| CockroachDB   | Serializable |

按场景选:
- 高吞吐 OLTP: RC + 应用层 FOR UPDATE
- 报表查询: RR (一致快照) + 只读副本
- 严格一致性: Serializable + 重试逻辑
- 分布式: 看框架 (TiDB RR / CockroachDB SER)

PG RC 的重要细节: 实际"RU = RC" (不允许脏读, PG 内部选择)
→ 详见 taobao §二 + digblog-xid 笔记

================================================================
三、38 章 时序存储引擎 (基于 1885 行精读)
================================================================

3.1 时序数据特征
来源: §1

数据模型: [指标名 + 标签集合 + 时间戳 + 数值]
Prometheus 例子:
  http_requests_total{method="GET", handler="/api/v1/query"} 1625000000000 42.0

5 大特征:
1. 只追加不修改 (传感器 10:00:00 采集不会被改)
2. 写入速率稳定可预测
3. 数据天然有序 (按时间单调)
4. 查询集中在最近时间窗口 + 聚合
5. 明显冷热分层 (最近 2h 热, 1-7d 温, >30d 冷)

高基数 (High Cardinality) 头号敌人:
- 1000 台机器 × 500 指标 × 5 标签 × 10 取值 → 天文级时间线数
- 倒排索引膨胀 + 内存飙升 + Posting List 合并开销大 + 压缩率下降

3.2 通用 DB 不适合的原因
来源: §2

PostgreSQL 存时序 4 大问题:
1. B-Tree 索引写放大: 每插入 1 行, 至少更新 2 棵 B-Tree
2. 行存储浪费: metric_name + tags 重复存
3. MVCC 开销: xmin/xmax + 死元组 + VACUUM
4. 删除效率低: 按时间范围 DELETE 极慢

3.3 Gorilla 压缩 (Facebook 2015)
来源: §3

核心: 相邻数据点高度相似, 用极少比特编码
2 大编码:

(1) 时间戳压缩 — Delta-of-Delta 编码:
  t = 1625000000, 1625000015, 1625000030, 1625000045, 1625000061, 1625000075
  delta = 15, 15, 15, 16, 14
  delta-of-delta = 0, 0, 0, 1, -2

编码规则 (变长):
  d = 0                  → 1 位 ('0')
  -63 ≤ d ≤ 64          → 9 位 ('10' + 7 位值)
  -255 ≤ d ≤ 256        → 12 位
  -2047 ≤ d ≤ 2048      → 16 位
  其他                   → 36 位 ('1111' + 32 位值)

  → 稳定间隔 96% 时间为 1 位, 时间戳压缩到 1.04 位

(2) 数值压缩 — XOR Delta 编码:
  浮点数相邻值二进制相似, XOR 有大量前导零 + 尾随零
  编码规则:
    XOR = 0 (值不变)        → 1 位 ('0')
    XOR ≠ 0, 范围跟上次同   → '10' + meaningful bits
    XOR ≠ 0, 范围变化       → '11' + 5 位前导零 + 6 位 meaningful 长度 + meaningful bits

Facebook 实测压缩率 (生产环境):
  时间戳: 1.04 位/点 (64x)
  数值:   0.33 位/点 (194x)
  合计:   1.37 位/点 (93x)
  → 10 亿数据点 = 163 MB

3.4 Prometheus TSDB
来源: §4

架构:
  ┌────────────────────────────────────┐
  │        Prometheus Server            │
  │  ┌──────────┐  ┌──────────┐        │
  │  │  Scrape  │  │  Rules   │  Query│
  │  │  Manager │  │  Engine  │  Eng │
  │  └────┬─────┘  └────┬─────┘        │
  │       │              │              │
  │  ┌────▼──────────────▼─────────────┐│
  │  │   Head (内存) + WAL             ││
  │  │   Persistent Blocks (磁盘)      ││
  │  └──────────────────────────────────┘│
  └────────────────────────────────────┘

Head Block:
- memSeries 每条活跃时间线
- 默认 Chunk 120 个采样点 或 2 小时
- Chunk 内部用 Gorilla 压缩
- 写入路径: Appender → 找 memSeries → 检单调 → 追加 Gorilla → 写 WAL → 更新 posting

WAL:
- 128MB 分段
- 4 种记录: Series / Samples / Tombstone / Exemplar
- Checkpoint 定期清理已持久化到 Block 的数据

Block 持久化:
- 不可变磁盘块, 默认 2h 切
- 目录结构: <ULID>/{meta.json, index, chunks/, tombstones}
- Compaction: 指数级合并 (2h×3 → 6h×3 → 18h×3 → 54h)

倒排索引: label_name → label_value → posting_list (sorted series refs)
查询 `{method="GET", handler="/api"}`: 取 2 个 posting list 交集

3.5 InfluxDB IOx (v3.0)
来源: §5

InfluxDB 存储引擎演进:
  v0.8  → LevelDB (LSM-Tree)  Compaction 风暴
  v0.9  → BoltDB (B+Tree/mmap) 高基数内存暴涨
  v0.10 → TSM (自研 LSM)     列查询不够高效
  v3.0  → IOx (Arrow + Parquet) 云原生

IOx 架构:
  查询层: SQL/InfluxQL Parser + DataFusion Query Engine
  元数据: Catalog (数据库→表→分区→文件)
  存储层: WAL + Object Store (S3/GCS/本地)

写入路径:
  客户端 Line Protocol → 解析 Arrow RecordBatch → 写 WAL → 追加 Mutable Buffer
  → Buffer 达阈值转不可变 RecordBatch → 后台编码 Parquet → 上传 Object Store
  → Catalog 更新元数据

Parquet 内部:
  Row Group → Column (time RLE+PLAIN / host/region DICTIONARY / 数值 PLAIN+Zstd)
  Footer: Schema + Row Group 元数据 + Column Statistics (min/max 谓词下推)

优势: 标准 Parquet+Arrow 生态 + 对象存储原生 + SQL + 列式分析 + 存算解耦
权衡: 最新数据查询延迟较高 + 高频点查不如 Prometheus + Parquet 批量刷盘有延迟

3.6 TimescaleDB
来源: §6

理念: 不是从零构建, 而是 PostgreSQL 扩展, 叠加时序优化
优势: 完整 SQL + PG 生态 (pgvector/PostGIS) + ACID + 工具链熟悉

Hypertable + Chunk:
  Hypertable metrics (逻辑表)
  ├── Chunk 1 [Day 1]
  ├── Chunk 2 [Day 2]
  ├── ...
  └── Chunk N [Day N]

  CREATE TABLE metrics (time TIMESTAMPTZ, device_id TEXT, temperature FLOAT);
  SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day');

3 大优势:
1. Chunk Exclusion: 查 1h 只扫 1 个 Chunk, 跳过其他
2. 高效删除: drop_chunks('metrics', older_than => INTERVAL '30 days') 几乎瞬时
3. 按 Chunk 独立压缩: 热 Chunk 行存, 冷 Chunk 转列式压缩

列式压缩编码:
| 类型        | 编码                |
| ----------- | ------------------- |
| 时间戳      | Delta + Simple-8b   |
| 浮点        | Gorilla XOR         |
| 整数        | Delta + Simple-8b   |
| 低基字符串  | Dictionary + RLE    |
| 高基字符串  | LZ4/Zstd            |
| 布尔        | Bitmap              |

压缩率: 1 亿行 38GB → 2.1GB (18x), 聚合查询 5.1s → 0.4s

连续聚合 (Continuous Aggregates):
  CREATE MATERIALIZED VIEW hourly_temp WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 hour', time), device_id, avg(temp) FROM metrics GROUP BY 1, 2;
  add_continuous_aggregate_policy(..., start_offset => '2h', end_offset => '30m', schedule_interval => '30m');
  → 增量刷新, 不是全量重算

3.7 VictoriaMetrics
来源: §7

目标: 极致压缩 + 低内存 + 高吞吐 + 简单运维, 作为 Prometheus 长期存储

架构: vminsert (写入代理, 无状态) + vmstorage (存储节点, 有状态)
  + vmselect (查询代理, 无状态)
- 同条时间线数据一致性哈希到同一 vmstorage (数据局部性)

存储引擎:
  data/small/2024_01_29/part_0/{metaindex.bin, index.bin, timestamps.bin, values.bin}
  data/big/2024_01/    ← 合并后大分区
  data/indexdb/        ← LSM-Tree 倒排索引

压缩优化 (在 Gorilla 基础上):
- 常量间隔检测 (delta 相同只存 1 个)
- 整数优化 (浮点实际是整数时用变长整数)
- ZSTD 二次压缩
- 降精度压缩 (丢浮点低位噪声)

3.8 性能对比 (TSBS 基准, 1000 主机 × 10 指标 × 3 天)
来源: §8

写入性能 (点/秒):
| 数据库            | 写入速率   | 磁盘占用 | CPU 使用率 |
| ----------------- | ---------- | -------- | ----------- |
| VictoriaMetrics   | 1,200,000  | 1.8 GB   | 35%         |
| Prometheus TSDB   | 680,000    | 3.4 GB   | 42%         |
| InfluxDB IOx      | 450,000    | 2.1 GB   | 58%         |
| TimescaleDB       | 180,000    | 8.6 GB   | 71%         |
| PostgreSQL (原生) | 35,000     | 42 GB    | 89%         |

压缩率 (字节/数据点):
| 数据库            | 字节/点  | 压缩率  |
| ----------------- | -------- | ------- |
| VictoriaMetrics   | 0.7      | 183x    |
| InfluxDB IOx      | 0.8      | 160x    |
| Prometheus TSDB   | 1.3      | 98x     |
| TimescaleDB (压缩)| 1.6      | 80x     |
| PostgreSQL (原生) | 16.2     | 8x      |

查询延迟 P99 (ms): VM < Prom < IOx < TimescaleDB (TimescaleDB 唯一支持 JOIN)

3.9 选型指南
来源: §9

| 场景                                | 推荐                |
| ----------------------------------- | ------------------- |
| Kubernetes 监控                     | Prometheus + Thanos/Mimir |
| 百万级时间线                        | VictoriaMetrics     |
| IoT + SQL + 关系数据 JOIN          | TimescaleDB         |
| 长期 + 标准 SQL + 物化视图         | InfluxDB IOx        |
| 通用 + 大数据生态 (Spark/Flink)    | InfluxDB IOx        |
| 已有 PG + 扩展时序                  | TimescaleDB         |

跟 PG 笔记交叉:
- digblog 笔记提到的 TimescaleDB / Prometheus 都在这里
- polardb §六 提到 "Grafana + Prometheus" 是 PolarDB 监控标准
- quant67-pg-kernel ch20 提到 PG FDW 机制可对接 TimescaleDB
- 实际: PG + TimescaleDB 是 PG 生态做时序的标准方案

================================================================
四、39 章 向量存储与 ANN 索引 (基于 2573 行精读)
================================================================

4.1 问题规模
来源: §0 引言

场景: 1 亿条 768 维向量找最相似 10 条
暴力: 768 次乘法 + 1 次求和/向量, 1 亿向量 = 768 亿次浮点运算
单核 CPU 跑几十秒 → 无法响应用户搜索

4.2 三种距离度量
来源: §一
- L2 (欧氏距离): 等高线是圆
- 余弦相似度: 等高线是从原点出发的射线
- 内积 (IP): 等高线是垂直于向量的超平面

归一化后: L2 距离 ≡ 余弦距离 (1 - cos), 余弦 ≡ IP (因为 ||a||=||b||=1)

4.3 ANN 算法 (Approximate Nearest Neighbor)
来源: §一 + quant67-storage-md 39 §

(1) KD-Tree:
- 二叉空间分割, 维度 d 时最近邻复杂度 O(log n)
- 维度 > 20 时退化 (curse of dimensionality), 实际不适用

(2) LSH (Locality-Sensitive Hashing):
- 哈希函数让相似向量大概率落同一桶
- 多表 + 多哈希, 召回率高但内存大
- Facebook 早期图片搜索用过

(3) HNSW (Hierarchical Navigable Small World, 2016):
- 分层图结构, 顶层"高速公路", 底层精细导航
- 搜索 O(log n), 接近 100% 召回率
- 当前工业界主流
- 详见 frontier 系列 (db-frontier/08)

(4) 量化 (Quantization):
- PQ (Product Quantization): 把向量切 8 段, 每段聚类 256 个 centroid
- 压缩到 32 字节/向量, 内存降 24x
- IVF-PQ: 倒排 + PQ 组合, FAISS 标配
- SQ (Scalar Quantization): float32 → int8, 简单

(5) DiskANN (2019, Microsoft):
- SSD 上的图索引, 内存只存导航节点
- 十亿级向量单节点可行
- DiskANN + Vamana 图

4.4 FAISS 选型
来源: §一 (Meta 开源, 向量检索标准库)

```python
import faiss

# 1. 全量暴力 (基线)
index = faiss.IndexFlatL2(d)  # d=768

# 2. IVF (聚类, 适合百万级)
quantizer = faiss.IndexFlatL2(d)
index = faiss.IndexIVFFlat(quantizer, d, nlist=4096)
index.train(vectors)
index.add(vectors)
index.nprobe = 32  # 搜索时探查的聚类数

# 3. HNSW (高精度, 适合千万级)
index = faiss.IndexHNSWFlat(d, M=32)  # M=每节点连接数
index.hnsw.efConstruction = 200  # 构建时的探索深度
index.hnsw.efSearch = 64  # 搜索时的探索深度

# 4. PQ (内存压缩)
index = faiss.IndexIVFPQ(quantizer, d, nlist, M=8, nbits=8)

# 5. OPQ (优化 PQ, 推荐)
index = faiss.IndexIVFOPQ(quantizer, d, nlist, M=8, nbits=8)
```

4.5 RAG 场景注意点
来源: §最后 (quant67 llm-infra/17-18)

召回精度 vs 延迟权衡:
- Top-1 召回率 90% 需要 efSearch ≥ 64 (P99 5ms)
- Top-1 召回率 95% 需要 efSearch ≥ 128 (P99 15ms)
- Top-1 召回率 99% 需要 efSearch ≥ 256 (P99 50ms) + re-rank

RAG 召回后通常 re-rank (cross-encoder), 所以 Top-10 → Top-3 重排比 Top-100 → Top-10 重排性价比高

4.6 pgvector 跟专用引擎对比
来源: 39 §跟 quant67-storage-notes §十六 / quant67-storage-md 39 §

| 维度       | pgvector                     | Milvus/Weaviate/Qdrant        |
| ---------- | ---------------------------- | ----------------------------- |
| 集成       | PG 内部, 标准 SQL + 事务     | 独立服务, 需 ETL              |
| 索引       | HNSW (0.5+) + IVFFlat        | HNSW, DiskANN, IVF-PQ         |
| 规模       | 千万级 (单 PG)               | 百亿级 (分布式)                |
| 性能       | 中等, 8KB 页装箱限制         | 高, 优化到 SIMD                |
| ACID       | 强 (跟 PG 事务)              | 弱 (最终一致)                  |
| 混合查询   | JOIN 强 (向量 + 结构化)      | 弱 (需自实现)                  |
| 适用       | 已有 PG + 中小规模向量       | 千万+ 向量或 RAG 生产         |

pgvector 配置示例 (PG 16+):
```sql
CREATE EXTENSION vector;
CREATE TABLE embeddings (
  id BIGINT PRIMARY KEY,
  content TEXT,
  embedding vector(1536)  -- OpenAI ada-002
);
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- 查询时 SET hnsw.ef_search = 100 调精度
```

跟现有笔记交叉:
- quant67-storage-notes §十六 已收录 pgvector / HNSW / IVFFlat
- 跟 digblog-xid 笔记无直接交叉
- 跟 polardb 笔记无直接交叉
- 待补充: 选专门做一篇 "pgvector 实战" (跟 quant67-pg18-study 章节结合)

================================================================
五、40 章 数据湖存储格式 (Delta Lake / Iceberg / Hudi)
================================================================

来源: 摘要核心事实 (本页受上下文限制, 不展开源码细节)

5.1 Lakehouse 三层架构
- 数据文件 (不可变 Parquet/ORC)
- 元数据层 (可变 schema/版本/快照)
- Catalog (REST/DB, 跨系统协调)

5.2 三大开放表格式对比
| 格式       | 提出者          | 核心模型           | 特点                    |
| ---------- | --------------- | ------------------ | ----------------------- |
| Delta Lake | Databricks      | _delta_log JSON 日志 | 跟 Spark 深度集成      |
| Iceberg    | Netflix (Apache)| 元数据 + manifest 列表 | 跟 Trino/Presto 友好    |
| Hudi       | Uber (Apache)   | timeline + 文件级 | upsert/delete 原生     |

5.3 关键能力对比
- ACID 事务: 都支持
- 模式演进 (Schema Evolution): 都支持
- 时间旅行 (Time Travel): 都支持
- 隐藏分区 (Hidden Partitioning): Iceberg 原生, Delta 通过 partition, Hudi 通过 clustering
- 索引: Iceberg 元数据层, Hudi 多种, Delta 有限

5.4 跟 PG/国产 DB 关联
- openGauss 兼容 Parquet (列存 cstore 用列存思路)
- Greenplum AO/AOCO 跟 Parquet 思路相近
- TiFlash (TiDB 列存层) 跟 Parquet 生态兼容
- ClickHouse 自主列存 + Parquet 导入/导出

→ 详见 quant67-storage-notes §十一

================================================================
六、48 章 MinIO 原理和架构
================================================================

来源: 摘要核心事实

6.1 MinIO 是什么
- S3 兼容的开源对象存储
- 用 Go 编写, 单一二进制 (部署简单)
- 纠删码 (Erasure Coding) 替代多副本, 节省 50% 存储
- 高性能 (顺序写优化, GPU 加速)

6.2 架构核心
- 分布式模式: 多节点组成 Erasure Set
- 每个对象被切 N 个数据块 + M 个校验块 (如 12+4)
- 允许 N+M 个节点中丢 M 个仍能恢复
- 写: 切块 + Reed-Solomon 编码 + 分散到 M+N 个节点
- 读: 收集 N 个数据块即可重组

6.3 跟其他对象存储对比
| 产品         | 兼容 | 性能   | 部署   | 生态           |
| ------------ | ---- | ------ | ------ | -------------- |
| MinIO        | S3   | 很高   | 简单   | K8s 原生       |
| Ceph RGW     | S3+  | 中     | 复杂   | 完整 (RGW+RBD+FS) |
| 阿里 OSS     | 自有 | 很高   | 云服务 | 阿里云         |
| AWS S3       | 标准 | 基准   | 云服务 | AWS            |

6.4 跟 PG/国产 DB 关联
- PolarDB 笔记提到的"PolarStore" 跟 MinIO 都是自研对象存储
- MinIO 适合做 PG 备份存储 (pgbackrest + S3)
- 跟 digblog 笔记的"对象存储"主题一致

================================================================
七、57 章 计算存储分离架构
================================================================

来源: 摘要核心事实

7.1 传统存算一体 vs 存算分离
| 维度       | 存算一体            | 存算分离                |
| ---------- | ------------------- | ----------------------- |
| 资源利用   | 计算/存储绑定, 易浪费 | 独立伸缩, 利用率高     |
| 弹性       | 扩节点 = 扩双重     | 各自独立扩              |
| 成本       | 高 (要冗余)         | 低 (按需)              |
| 延迟       | 低 (本地)          | 略高 (网络 RDMA 优化) |
| 适用       | 性能敏感 OLTP      | 弹性 + 海量数据       |

7.2 代表实现
- Snowflake: 计算 warehouse + S3 存储
- BigQuery: serverless + Colossus
- Databricks: SQL warehouse + Delta Lake (S3)
- Redshift Spectrum: 查询 S3 数据不加载
- PolarDB PG: 共享存储 PolarStore (一写多读)
- openGauss: 主备 + 共享存储

7.3 关键技术
- 缓存: 本地 SSD 缓存热数据, 远端对象存全量
- 谓词下推: 读取时按 min/max 跳过无关文件
- 列裁剪: 只读涉及列
- RDMA / NVMe-oF: 低延迟网络访问远端

7.4 跟现有笔记交叉
- polardb 笔记 §二: PolarStore 是存算分离的阿里实现
- 跟 quant67-storage-md 57 完整内容结合, 是"云原生数据库"主题
- digblog-fork 笔记: openGauss / OpenTenBase 都涉及存算分离

================================================================
八、7 篇精读的交叉引用
================================================================

8.1 跟 quant67-pg-kernel 笔记
| 主题          | quant67 章节       | 本笔记            |
| ------------- | ------------------ | ----------------- |
| MVCC          | ch03               | §2.5-2.6          |
| 锁            | ch06               | §2.3 (2PL) + §2.6 (Gap Lock) |
| B-Tree        | ch14               | §1 全部 (更深)     |
| Buffer Pool   | ch05               | §1.10 (InnoDB)    |
| 索引          | ch14-17            | §1                |
| 时序          | (无)               | §3 (TimescaleDB 走 PG 扩展) |
| 向量          | (无)               | §4 (pgvector 走 PG 扩展) |

8.2 跟 digblog 笔记
| 主题         | digblog 笔记                       | 本精读        |
| ------------ | ---------------------------------- | ------------- |
| XID/freeze   | digblog-xid §四 freeze            | §2.5-2.6 (MVCC 实现) |
| 国产 DB 架构  | digblog-fork §二-五              | §1 B+Tree + §7 存算分离 |
| XStore 原位更新 | digblog-fork §四 XStore        | §1.5-1.6 (B+Tree 写入优化) |

8.3 跟 polardb 笔记
| 主题          | polardb 笔记         | 本精读            |
| ------------- | -------------------- | ----------------- |
| 共享存储      | §二 PolarStore       | §7 存算分离       |
| Blink-Tree    | §六                  | §1.6 (B-link Tree) |
| CBQT          | §五                  | (无, 优化器独立)   |
| PolarDB 监控  | (无)                 | §3.4 Prometheus   |

8.4 跟 taobao-monthly 笔记
| 主题          | taobao 章节          | 本精读            |
| ------------- | -------------------- | ----------------- |
| CLOG / Hint Bits | §三                | §2.5 (PG MVCC)  |
| 索引          | §十                  | §1 (B+Tree 全部) |
| 并行查询      | §十一                | §1.6 (B+Tree 并发) |
| HOT           | §六                  | §1.5-1.6          |
| 慢 SQL 优化   | 2024/12              | §1.10-1.11 (B+Tree 诊断) |

================================================================
九、最值得记的 5 个事实
================================================================

1. B+Tree 统治 50 年, 关键设计目标: 树高 3-4 层
   - InnoDB 16KB 页, 8B bigint 键, 扇出 1170
   - 3 层索引 16 亿条
   - 内部节点常驻内存时, 单点查只 1 次 I/O

2. PostgreSQL MVCC 的 4 个隐藏真相
   - 堆表存所有版本 (vs InnoDB undo log)
   - 纯 SELECT 也会产生写 I/O (Hint Bits)
   - VACUUM 是版本回收的唯一机制
   - 32 位 XID 是核心瓶颈 (详见 digblog-xid)

3. B-link Tree + lock-coupling 是高并发 B+Tree 的关键
   - PG 原生: search 不加 lock-coupling, SMO 期间可能失败需重试
   - PolarDB: 加 lock-coupling, 一次性成功, 并发更高

4. 时序数据的 3 大核心优化
   - Gorilla 压缩: 时间戳 1.04 位 + 数值 0.33 位 = 1.37 位/数据点 (93x)
   - Chunk 按时间分区: 查询剪枝 + 块级删除
   - 列存冷数据: 高压缩率, 适合 OLAP 查询

5. 向量检索选型决策
   - < 千万向量 + 已有 PG: pgvector (HNSW)
   - 千万~亿: FAISS + HNSW (内存) 或 DiskANN (SSD)
   - 亿级以上: Milvus/Qdrant 分布式
   - 召回率 vs 延迟: efSearch 64=90%, 128=95%, 256=99%

================================================================
十、7 篇精读合订本的本地缓存
================================================================

7 篇全文 (1921-2573 行/篇):
- 25-btree-engineering: 1921 行 (69KB)
- 28-transaction-isolation: 2415 行 (73KB)
- 38-timeseries-engine: 1885 行 (69KB)
- 39-vector-storage: 2573 行 (76KB)
- 40-data-lake-formats: 1830 行 (~70KB)
- 48-minio: 2042 行 (~75KB)
- 57-compute-storage-separation: 1852 行 (73KB)

合计: 14518 行 + 505KB (HTML 原文 79 篇 4.9 MB)

路径: /home/obsidian/postgres/learn/quant67-storage-md/
命名: NN-topic-slug__topic-slug.md

================================================================
十一、未来深入方向
================================================================

1. 25 章补充:
   - 读 §6 全部 (WAL + 锁的细节)
   - 补 PG nbtree 源码: src/backend/access/nbtree/

2. 28 章补充:
   - 读 §1 全部 (PostgreSQL MVCC 详解)
   - 读 §4 全部 (PG HeapTuple 源码)

3. 38 章补充:
   - 读 §5-7 全部 (各 TSDB 实现细节)
   - 实操: 部署 Prometheus + VictoriaMetrics 压测

4. 39 章补充:
   - 读 HNSW/DiskANN 论文级内容 (frontier 系列)
   - 实战: pgvector 千万级数据性能调优

5. 40/48/57 章补充:
   - 部署 MinIO + Iceberg 跑通数据湖
   - 部署 Snowflake/PolarDB 存算分离架构

6. 跨主题串联:
   - 写 "国产 DB 的 B+Tree 改造" 专题 (openGauss MOT / OpenTeleDB XStore)
   - 写 "PG pgvector 实战" 专题 (跟 RAG 应用结合)
   - 写 "时序 DB 选型" 专题 (PG+TimescaleDB vs 专用 TSDB)

================================================================
十二、引用源
================================================================

quant67 storage 7 篇精读:
- /home/obsidian/postgres/learn/quant67-storage-md/25-btree-engineering__btree-engineering.md
- /home/obsidian/postgres/learn/quant67-storage-md/28-transaction-isolation__transaction-isolation.md
- /home/obsidian/postgres/learn/quant67-storage-md/38-timeseries-engine__timeseries-engine.md
- /home/obsidian/postgres/learn/quant67-storage-md/39-vector-storage__vector-storage.md
- /home/obsidian/postgres/learn/quant67-storage-md/40-data-lake-formats__data-lake-formats.md
- /home/obsidian/postgres/learn/quant67-storage-md/48-minio__minio.md
- /home/obsidian/postgres/learn/quant67-storage-md/57-compute-storage-separation__compute-storage-separation.md

quant67 总览笔记:
- /home/obsidian/postgres/learn/quant67-storage-notes.md

关联笔记:
- /home/obsidian/postgres/learn/quant67-pg-kernel-notes.md
- /home/obsidian/postgres/learn/taobao-monthly-pg-notes.md
- /home/obsidian/postgres/learn/20260904-pg-32bit-xid-and-64bit-fix.md
- /home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
- /home/obsidian/postgres/learn/20260904-polardb-postgresql-notes.md
- /home/obsidian/postgres/learn/README-pG内核学习总图.md
