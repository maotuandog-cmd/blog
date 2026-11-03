# PostgreSQL 内核深度学习笔记 (quant67 系列 26 篇)

> 来源: https://quant67.com/tags/pg-kernel.html (土法炼钢 · Liao Tonglang, 2026-06-16 完整发布)
> 本地缓存: `/home/obsidian/postgres/learn/quant67-pg-kernel/` (26 个 .txt + 26 个 .html)
> 总篇幅: ~920 KB 文本 (~30 小时精读)
> 作者定位: "对 PostgreSQL 内核做完整的源码级拆解", "面向想读懂 PG 内核源码、在生产环境排查过问题、准备给 PG 贡献代码的工程师"

---

## 全系列地图 (26 章 → 6 大块)

```
[1. 地基层 Foundation] ─────────────────────────────────
 01 进程模型与共享内存       ← Postmaster fork backend, 共享内存布局
 02 页面布局与元组格式       ← 8KB Page 三层结构, HeapTuple xmin/xmax/ctid
 03 MVCC 实现 (CLOG/hint)   ← SLRU 提交日志, hint bit, snapshot scalability
 04 WAL 内部机制             ← XLogInsert → checkpoint → REDO recovery
 05 Buffer Manager           ← shared_buffers 三层, Clock Sweep, bgwriter
 06 锁管理器                 ← SpinLock → LWLock → Heavyweight Lock 三层
 07 事务与子事务 / 2PC       ← TransState, Savepoint 栈, pg_twophase 状态文件
 08 VACUUM 与 Freezing       ← heap scan / dead tuple / FSM/VM / wraparound

[2. 查询路径 Query Path] ───────────────────────────────
 09 解析与重写                ← Parser → Analyzer → Rewriter → Query Tree
 10 统计信息与代价模型        ← MCV/histogram/correlation, ANALYZE, 选择率
 11 Join 顺序与路径生成       ← Seq/Index/Bitmap scan, NLJ/Hash/Merge, GEQO
 12 执行器与表达式求值        ← Volcano 模型, EEO opcode, TupleSlot 三态
 13 JIT 编译                  ← LLVM, 三级阈值, OLAP 适用边界

[3. 索引体系 Index Family] ─────────────────────────────
 14 B-Tree                    ← 页面分裂 (非 50/50), deduplicate, rightlink
 15 GiST                      ← Consistent/Penalty/PickSplit 接口, 几何/全文
 16 GIN                       ← entry tree + posting list/tree, Fast Update
 17 BRIN + Hash + Bloom       ← 范围摘要, 大表秒级建索引

[4. 复制 Replication] ───────────────────────────────────
 18 流复制                    ← WAL Sender/Receiver, sync 3 语义, slot 溢出
 19 逻辑复制                  ← LogicalDecoding, Reorder Buffer, 4 种冲突
 20 扩展系统与 FDW            ← hook 机制, postgres_fdw pushdown

[5. 运维实战 Ops Practice] ──────────────────────────────
 21 监控体系与告警设计        ← 6 维度监控: 连接 / 膨胀 / WAL / 查询 / 锁 / 命中率
 22 经典故障 5 例             ← 连接风暴 / wraparound / slot 溢出 / OOM / idle-in-tx
 23 性能调查 5 层链           ← pg_stat_statements → EXPLAIN → wait_event → 锁 → OS
 24 数据恢复边界              ← PITR / pg_resetwal / 页面损坏 不可逆边界
 25 大版本升级                ← pg_upgrade --link (硬链接, 不可回滚), 逻辑复制方案
 26 配置陷阱 (11 个 GUC)      ← shared_buffers / work_mem / fsync / huge_pages 等
```

---

## 一、Foundation 8 章 — 内核地基

### Ch.01 进程模型与共享内存

**核心论点:** PG 用多进程 (不是线程) 是工程优势, 不是历史包袱.

**进程类型 (9 种):**
| 进程 | 职责 |
|---|---|
| Postmaster | 监听, fork Backend, 处理子进程 crash |
| Backend | 处理一条连接的所有 SQL (一行 client 一进程) |
| Background Writer | 定期刷 shared_buffers 脏页 |
| WAL Writer | 刷 WAL buffer 到磁盘 |
| Checkpointer | 执行 checkpoint (合并脏页刷盘) |
| Autovacuum Launcher + Worker | 自动 VACUUM/ANALYZE |
| WAL Sender | 流复制主→从 |
| WAL Receiver | 流复制从→主 |
| Logical Replication Worker | 逻辑复制 apply |
| Background Worker (用户注册) | 如 pg_cron, pg_stat_statements 清理 |

**Postmaster 主循环:** `ServerLoop` 接收连接 → `fork()` → 子进程走 `InitPostgres()` (设置 MyProc, 初始化 snapshot/快照, 加载 GUC) → 进入 PostgresMain 主循环.

**共享内存初始化:** `CreateSharedMemoryAndSemaphores()` (一次性)
- `BufferDescriptors[N]` + `Buffer Pool` (N × 8KB) — Buffer Manager 用
- `PGPROC[MaxBackends]` + `ProcArray` — 每个 backend 一个槽位
- `PGXACT[MaxBackends]` — 缓存 xid/xmin 加速 snapshot
- `LWLock 数组` — 锁管理器用
- `CLOG SLRU` — 提交日志 (4 个文件: 0000-0003, 8KB/页, 256 字节/事务状态)

**为什么进程而非线程:**
- 一个 backend crash 不影响其他 (地址空间隔离)
- max_connections 限制了 fork 数量, 不会因线程泄漏拖死整库
- 缺点: fork() 代价, 共享内存协调复杂, ContextSwitch 比线程重

**为什么 max_connections 不能乱调大:** 每个连接占用 ~10MB (PGPROC+stack), 1000 连接 = 10GB; 大连接数还会让 ProcArrayLock 扫描慢 (见 Ch.03).

### Ch.02 页面布局与元组格式

**8KB Page 三层结构:**
```
┌─────────────────────────┐  ← 顶部
│ PageHeaderData (24B)    │  pd_lsn(8) + pd_checksum(2) + pd_flags(2)
│                         │  + pd_lower(2) + pd_upper(2) + pd_special(2)
├─────────────────────────┤
│ ItemId 数组 (4B/项)     │  从 pd_lower 向 ↓ 增长
├─────────────────────────┤
│  空闲空间                │
├─────────────────────────┤
│ Tuple N ... Tuple 1     │  从 pd_upper 向 ↑ 增长
├─────────────────────────┤
│ Special Space            │  索引页有 (B-Tree BTPageOpaque)
└─────────────────────────┘  ← 底部
```

**HeapTupleHeaderData (23B):**
- `xmin` (4B): 插入事务 ID
- `xmax` (4B): 删除事务 ID (0 = 未删除)
- `ctid` (6B): (page_no, item_offset) — 行物理位置, 指向自己或下一个版本链
- `t_infomask` (2B): hint bit 标志 (HEAP_XMIN_COMMITTED, HEAP_XMAX_INVALID 等)
- `t_infomask2` (2B): 多事务标志
- `t_hoff` (1B): header 结束位置, 用户数据起点

**TOAST (大字段外存):**
- 触发: 行总长 > 2KB (TOAST_TUPLE_THRESHOLD)
- 四策略: PLAIN (不压缩不外存) / EXTENDED (压缩+外存) / EXTERNAL (只外存) / MAIN (优先压缩, 兜底外存)
- TOAST 表物理结构: 与原表 schema 一致, chunk id 串接
- 用 pageinspect 可观察字节级布局

**HOT Update (Heap Only Tuple):** 当 UPDATE 不改索引列时, 新版本堆在同一个 page 内, 索引 entry 不变 → 减少索引膨胀 + 顺序扫描效率. 条件: `thoff > 26B` 且没有索引列被改.

**fillfactor:** UPDATE 频繁表建议设 70~90, 预留空间给 HOT.

### Ch.03 MVCC 实现 (CLOG + hint bit + snapshot scalability)

**CLOG (Commit Log):**
- 存储位置: `$PGDATA/pg_xact/0000~0003` (SLRU, 4 个 8KB 页轮流覆盖)
- 每事务 2 bit 状态: IN_PROGRESS (00), COMMITTED (01), ABORTED (10), SUBCOMMITTED (11)
- 通过事务 ID mod 4 算出状态位
- 读取路径: `TransactionLogFetch()` → SLRU 缓冲命中则返回, miss 则从磁盘加载 + LRU 淘汰
- 写入路径: 由 walwriter/XLogFlush 间接驱动 (commit/abort 写 WAL, XLOG 文件同步 CLOG 段)

**hint bit (可见性缓存):**
- 谁写: 第一个扫到该 tuple 并提交的事务写 `HEAP_XMIN_COMMITTED`
- 何时写: HeapTupleSatisfiesMVCC() 查 CLOG 后调用 SetHintBits()
- 写坏问题: 必须先 pin buffer + 持 page LSN lock; 否则触发 page 写脏 → WAL 强制刷
- 后果: SELECT 大表会产生大量 WAL (因为 hint bit 写入)

**Snapshot Scalability (PG 14 优化):**
- 旧: GetSnapshotData() 持 ProcArrayLock 共享锁, 扫描所有 PGPROC 取 xmin/xmax
- 新: xid/xmin 缓存到 PGXACT 数组, 通过原子读 + LWLock 减少持锁路径
- PG 14 后 snapshot cost 不再随连接数线性增长

**事务 ID 回卷 (Wraparound):**
- 32 位 XID → 20 亿事务上限
- 防线: `xidStopLimit` (停止分配新 XID), `xidWrapLimit` (强制只读)
- 监控: `age(datfrozenxid)` 在 pg_database; 接近 2 亿要警惕
- 救命: Anti-wraparound VACUUM (autovacuum_freeze_max_age 触发)

**PG vs InnoDB MVCC 关键差异:**
- PG: append-only heap, 通过 CLOG 判断可见, **不立即回收 dead tuple** (VACUUM 后台)
- InnoDB: undo log, 旧版本在 undo 段, 通过回滚指针找历史版本, **purge 线程回收 undo**
- PG 批量 UPDATE 性能差 (dead tuple 不回收, 索引膨胀)
- InnoDB 短事务延迟低, 但 undo 膨胀需要 purge

### Ch.04 WAL 内部机制

**XLogInsert() 路径:**
1. `WALInsertLock` (LWLock) → 获取写入 slot
2. 拷贝 XLogRecord 到 WAL buffer (默认 `wal_buffers=16MB`)
3. 更新 `XLogCtl->LogwrtRqst` 通知 walwriter
4. 释放锁

**XLogRecord 物理布局:**
```
XLogRecord (24B Header)
  + Block Headers (每个 BlockReference 16B)
  + Data (主数据 + 备份块 full_page_image)
```

**Checkpoint 两阶段:**
- Phase 1: 计算脏页队列 + flush 关系 (锁 Cache)
- Phase 2: 实际写盘 + 更新 control file (锁 ControlFile)
- `checkpoint_completion_target=0.9` 让 checkpoint 摊平到 90% 时间窗, 减小 IO 尖峰

**wal_level 三级:**
- `minimal`:  只 crash recovery (基础)
- `replica`:  + WAL 包含足够信息给流复制 standby
- `logical`:  + 逻辑解码信息 (pgoutput 插件可用)

**坑:**
- `max_wal_size` 设小 → WAL 段频繁切换, 性能塌方
- checkpoint IO 风暴 → 调 `bgwriter_lru_maxpages`, `bgwriter_delay`
- `pg_waldump` 是查问题 WAL record 的瑞士军刀

### Ch.05 Buffer Manager

**shared_buffers 三层:**
- `BufferDescriptors[N]` (每个 ~32B): 描述符数组
- `Buffer Pool` (N × 8KB): 实际页数据
- `Buffer Strategy` (`StrategyControl`): Clock Sweep 状态 (nextVictimBuffer, completePasses)
- `Buffer Table`: hash table (relfilenode, blocknum) → buffer index

**ReadBuffer 路径:**
1. 算 buffer tag (relfilenode + blocknum)
2. 查 Buffer Table → 命中则 pin + return
3. miss → StrategyGetBuffer() (Clock Sweep 找 victim) → ReadBuffer_common → IO → return

**Buffer 状态机:**
```
EMPTY → (分配) → just_allocated → (Read) → pinned_dirty/clean
       → (写脏) → pinned_dirty → (bgwriter) → unpinned_clean → (victim) → EMPTY
```

**bgwriter 触发条件:**
- 后台循环 `BgWriterDelay` (默认 200ms) 触发
- 当 `bgwriter_lru_percent` 比例的 buffer 可回收时, 提前刷
- 后台 checkpoint 触发 (与 checkpointer 协同)

**Ring Buffer (缓存隔离):**
- `BAS_BULKREAD`: 大顺序扫描专用 (避免污染正常缓存, `effective_cache_size` 影响)
- `BAS_BULKWRITE`: COPY/INSERT bulk 专用
- `BAS_VACUUM`: VACUUM 专用

**为什么 shared_buffers 不是越大越好:**
1. **Double buffering**: shared_buffers 和 OS page cache 双重缓存 → 浪费内存
2. **Checkpoint IO 尖峰**: 脏页越多, checkpoint 写越猛
3. **Clock sweep 扫描延迟**: buffer 池大, sweep 一圈耗时长, 替换决策退化
- 经验值: **8~16GB** (RAM 的 25%), 超过则收益递减

**诊断:** `pg_buffercache` 扩展观察 buffer 分布.

### Ch.06 锁管理器 (三层体系)

**Layer 1: SpinLock** (硬件原子指令)
- 实现: `pg_spinlock_impl.h`, TAS (Test-And-Set)
- 持锁时间: < 100ns, 不能 sleep
- 用法: PGPROC 数组、LWLock 内部 pin

**Layer 2: LWLock (Lightweight Lock)**
- PG 9.4 前: 单 LWLockLock 串行化所有 LWLock 操作 → 扩展性差
- PG 9.4~13: 引入 LWLockWaitListLock 分片等待队列
- PG 14~16: 进一步分片 + 优化等待者唤醒路径
- PG 16+: 每个 LWLock 一个独立的等待队列 (无全局瓶颈)
- 用法: shared_buffers 中的 buffer header, ProcArrayLock, WALInsertLock

**Layer 3: Heavyweight Lock (LMLock)**
- `LockAcquire()` 完整路径: 先快路径 (无冲突) → 慢路径 (冲突则阻塞)
- 锁表: `LOCK` 结构体 hash (locktag → waiter queue)
- 锁粒度: relation / page / tuple / transaction / object
- 8 种 LOCKMODE: `AccessShare` < `RowShare` < `RowExclusive` < `ShareUpdateExclusive` < `Share` < `ShareRowExclusive` < `Exclusive` < `AccessExclusive`

**死锁检测:**
- `DeadLockCheck()` 周期性运行 (默认 1s)
- 构建等待图 (waits-for graph), DFS 检测环
- 找到环 → 选择代价最小的事务 abort (cancel + error)

**行级锁:**
- `SELECT ... FOR UPDATE` → 写 `t_infomask` 的 `HEAP_XMAX_LOCK_ONLY` + 多事务 ID
- 不在 pg_locks 中显示 (行锁不进锁表, 由 HeapTupleSatisfiesMVCC 处理)
- 监控: `pg_locks` 看 heavyweight lock, `pg_blocking_pids()` 找等待链

### Ch.07 事务与子事务 / 2PC

**TransState 状态机:**
```
DEFAULT → STARTED → PARALLEL_CMD? → INPROGRESS → COMMIT (COMMITTING → COMMIT_COMPLETE)
                              ↓
                          BLOCKED → INPROGRESS
                              ↓
                         ABORT (ABORTING → ABORT_COMPLETE)
```

**子事务 (Savepoint):**
- `TransactionState` 是一个**栈**: 顶层 xact 栈底, savepoint 入栈
- `ResourceOwner` 嵌套管理 (每个 savepoint 一个 RO)
- 子事务 commit 时合并到父事务, abort 时只回滚到 savepoint
- 警告: 子事务栈过深 → 内存膨胀 + 影响 Wraparound (每个子事务消耗 XID)

**两阶段提交 (2PC):**
- PREPARE → 写 WAL + 写入 `$PGDATA/pg_twophase/<xid>` 状态文件
- COMMIT PREPARED → 外部协调者发命令, 原子提交
- 状态文件格式: 二进制, 含 gid, xid, 数据库 oid, 用户信息
- 2PC 泄露: `pg_prepared_xacts` 表查; 异常时手动 `COMMIT/ROLLBACK PREPARED`

### Ch.08 VACUUM 与 Freezing

**VACUUM 完整流程:**
1. **heap scan**: 全表扫, 标记 dead tuple (xmax < OldestXmin)
2. **dead tuple 回收**: 从 FSM (Free Space Map) 拿可用空间, 把 dead tuple slot 标记为空
3. **索引清理**: 删除指向 dead tuple 的索引 entry
4. **FSM/VM 更新**: 记录 free space + visibility map

**Visibility Map (VM):**
- 每页 1 bit (all-visible flag)
- Index-Only Scan 依赖 VM 判断全可见, 不进 heap
- VACUUM 后更新 VM

**Free Space Map (FSM):**
- 跟踪每页可用空间大小
- INSERT 用 FSM 选择合适页 (避免页分裂)

**Freezing:**
- 触发: `autovacuum_freeze_max_age` (默认 2 亿事务)
- 操作: 把 `t_infomask` 中 `HEAP_XMIN_FROZEN` 标记置位, 等价于所有老事务都可见
- Anti-wraparound VACUUM: 强制 vacuum, 防止 wraparound 触发停库只读

**Wraparound 危机时间线:**
```
n_tup_del 增长 → autovacuum 跟不上 → age(datfrozenxid) 接近 2 亿
   → xidStopLimit (2.14 亿) → 拒绝分配新 XID (error: database is not accepting commands)
   → xidWrapLimit (~2.15 亿) → 强制只读 (只能 VACUUM FREEZE 修复)
   → 必须手动 VACUUM FREEZE 才能恢复
```

**监控 SQL:**
```sql
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY age DESC;
-- age > 200M = 紧急
-- age > 2^31 = 强制只读
```

---

## 二、查询路径 5 章

### Ch.09 解析与重写 (SQL 字符串 → Query Tree)

**三阶段:**
1. **Parser** (`gram.y` Bison 语法) → `RawStmt` 语法树 (纯字符串位置)
2. **Analyzer** (`parse_analyze()`) → `Query` 结构 (表名/列名解析, 类型推导, 权限检查)
3. **Rewriter** (`pg_rewrite` 规则系统) → 展开视图 + 应用 RLS 策略

**Query 关键字段:**
- `rtable` (RangeTblEntry* 列表): 涉及的表
- `jointree` (FromExpr): JOIN 树
- `targetList` (TargetEntry* 列表): SELECT 列
- `qual` (Expr*): WHERE 条件
- `sortClause` / `groupClause` / `havingQual`: 排序/分组/过滤

**调试参数:**
- `debug_print_parse = on` → 打印 parse 后 RawStmt
- `debug_print_rewritten = on` → 打印 rewrite 后 Query

### Ch.10 统计信息与代价模型 (优化器为什么选错索引)

**pg_statistic 三类信息:**
- **MCV** (Most Common Values): 高频值精确计数 (≤100 个)
- **Histogram** (直方图): 连续值分布, 默认 100 桶
- **Correlation**: 物理顺序 vs 逻辑顺序相关性 (-1~1), 影响索引扫描代价

**ANALYZE 采样:**
- 默认采样 `300 * statistics_target` 行 (statistics_target 默认 100 = 3 万行)
- 大表采样不足 → MCV/histogram 失真
- `ALTER TABLE t SET STATISTICS 1000` 提高精度, 代价是 ANALYZE 变慢

**代价模型常量:**
- `seq_page_cost = 1.0`: 顺序页 IO 基准
- `random_page_cost = 4.0`: 随机页 IO (机械盘时代, SSD 建议 1.1)
- `cpu_tuple_cost = 0.01`: 处理每行 CPU
- `cpu_index_tuple_cost = 0.005`: 索引扫描每行
- `cpu_operator_cost = 0.0025`: 每个 operator

**创建扩展统计解决多列相关:**
```sql
CREATE STATISTICS s1 (dependencies, ndistinct, mcv) ON city, country FROM users;
ANALYZE users;
```

**统计信息漂移诊断:**
```sql
SELECT schemaname, tablename, last_analyze, last_autoanalyze,
       n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > 100000  -- 改了 10 万行未 analyze
ORDER BY n_mod_since_analyze DESC;
```

### Ch.11 Join 顺序与路径生成

**4 种扫描:**
| 扫描 | 触发条件 | 代价 |
|---|---|---|
| SeqScan | 无可用索引 / 小表 | 顺序扫, 受益于 cache |
| IndexScan | 选择率低 + B-Tree | 随机 IO 多 |
| IndexOnlyScan | VM 全可见 + 索引覆盖 | 几乎最优 |
| BitmapScan | 多条件 OR / 选择率中等 | Heap fetch + bitmap 合并 |

**3 种 Join:**
| Join | 适用场景 |
|---|---|
| Nested Loop | 外表小 + 内表有索引 |
| Hash Join | 等值连接 + 内存可装下 hash 表 |
| Merge Join | 两表都已已排序 + 大表 |

**GEQO 切换:** `geqo_threshold=12` (默认), Join 关系数 > 12 时用遗传算法 (避免 DP 指数爆炸).

### Ch.12 执行器与表达式求值

**Volcano 模型:**
- `ExecInitNode()` → 初始化计划节点 (递归)
- 循环 `ExecProcNode()` → 拉取一行 (pull-based)
- `ExecEndNode()` → 清理资源
- 每个节点实现这 3 个回调

**EEO (Expression Evaluation Operator):**
- 表达式编译为 opcode 序列 (FUNCSELECT, VAR, CONST, AND, OR 等)
- 解释执行 (PG 11 之前), JIT 后编译为机器码
- 单行: 100 个 opcode 解释执行 ~10us; JIT 后 ~1us

**TupleTableSlot 三态:**
- `TTS_VIRTUAL`: 不存数据, 指向原内存 (适合 INSERT)
- `TTS_HEAP`: 拷贝到 slot 内存 (默认)
- `TTS_MINIMAL`: 物理 tuple 指针 + 最少字段拷贝

**wait_event 诊断:**
```sql
SELECT pid, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE wait_event IS NOT NULL;
```
- `Lock` / `LWLock` / `IO` / `IPC` / `Timeout` / `BufferPin` 等

### Ch.13 JIT 编译

**三级阈值:**
- `jit_above_cost = 100000`: 代价 > 100k 才开 JIT
- `jit_inline_above_cost = 500000`: 内联阈值
- `jit_optimize_above_cost = 500000`: LLVM 优化阈值

**流程:** `Plan → EEO opcode → LLVM IR → machine code → 执行`

**适用:** OLAP (大查询扫百万行, WHERE 多表达式)
**不适用:** OLTP (JIT 编译开销 >> 节省时间)

---

## 三、索引体系 4 章

### Ch.14 B-Tree (默认索引)

**核心实现:**
- `BTPageOpaque`: high key (页最大 key) + rightlink (右兄弟页指针)
- 页面分裂 `_bt_split()`: **不是 50/50**! PG 选择分裂点使两边使用率均衡
- `deduplicate_items` (PG 12+): 重复 key 用 posting list 压缩 (e.g. 100 个相同 key 共享 posting list)
- B-Tree WAL 记录: `BTREE_INSERT_LEAF`, `BTREE_SPLIT_L`, `BTREE_SPLIT_R`

**诊断:**
```sql
SELECT * FROM bt_metap('idx_name');   -- 索引元信息
SELECT * FROM bt_page_items('idx_name', 1);  -- 第 1 页 item 详情
```

### Ch.15 GiST (Generalized Search Tree)

**接口:** 6 个回调函数 (用户实现):
- `Consistent`: key 是否匹配 query
- `Union`: 多个 key 合并为 1 个
- `Penalty`: 选择插入路径 (找增量最小的)
- `PickSplit`: 决定如何分裂
- `Compress` / `Decompress`: 内外格式转换

**适用:** 几何 (point_ops)、全文 (tsvector_ops)、范围、网络地址 — **"像什么"变成索引查找**

### Ch.16 GIN (Generalized Inverted Index)

**三层结构:**
- `entry tree`: B-Tree 存 keys (e.g. 词项)
- `posting list`: 叶子节点存 key → tuple ID 列表 (单页可装时用)
- `posting tree`: 当 list 太大, 升级为 B-Tree

**Fast Update:** pending list 暂存新插入, `gin_clean_pending_list` 异步合并 (后台 worker)
- 写性能好, 但读要扫 list + tree, 合并前会膨胀

### Ch.17 BRIN + Hash + Bloom

**BRIN (Block Range INdex):**
- 每个 page range (默认 128 页 = 1MB) 存 min/max 摘要
- 1TB 表建 BRIN: 秒级 vs B-Tree 小时级
- 适用: 时序数据, append-only, 自然按某列排序
- 不适用: 随机 UPDATE 频繁

**Hash 索引 (PG 10+ WAL 安全):**
- 之前 crash unsafe, PG 10 加 WAL logging 后可用于生产
- 仅等值查询

**Bloom 索引:** 多列任意组合过滤 (支持 IN, =, AND/OR), 假阳性可接受

**索引决策树:**
```
频繁等值? → B-Tree (默认)
字段是数组/全文? → GIN
"像什么"搜索 (几何/范围/IP)? → GiST
自然排序大表 (时序)? → BRIN
多列任意组合? → Bloom
频繁等值 + 写少? → Hash
```

---

## 四、复制 3 章

### Ch.18 流复制

**链路:** WAL Sender (`WalSndLoop` → `XLogSendPhysical`) → WAL Receiver (`WalRcvLoop`)

**同步 3 语义:**
- `async` (默认): 主不等待备, 性能好但丢数据风险
- `on` (sync): 至少 1 个备 fsync 才返回
- `remote_write`: 备写到 OS page cache 即返回 (次严格)

**Replication Slot:**
- 防止 WAL 被回收 (主保留 slot 需要的 WAL)
- slot 溢出多米诺: standby 宕机 → slot 阻止 WAL 回收 → `pg_wal` 填满 → primary PANIC
- 救命: `wal_keep_size` 兜底, 或定期监控 `pg_replication_slots`

**Failover 时序:**
1. 检测 primary 故障 (heartbeat 超时)
2. 新 primary 选举
3. Timeline fork (TLI+1) → 避免旧主复用
4. 老 primary 用 `pg_rewind` 重对线 (若原历史兼容)

### Ch.19 逻辑复制

**链路:** WAL → LogicalDecodingContext → Reorder Buffer (按 COMMIT 排序 + 重建快照) → pgoutput 插件 → Subscriber

**4 种冲突:**
| 冲突类型 | 表现 | 修复 |
|---|---|---|
| update_missing | UPDATE 行已被删 | 静默跳过 |
| delete_missing | DELETE 行已被删 | 静默跳过 |
| duplicate_key | INSERT 主键冲突 | **ERROR 停止复制** |
| 序列冲突 | 序列值在两端都生成 | **不会复制序列** |

**延迟放大:** 大事务在 Reorder Buffer 中堆积, 直到 commit 才一次性应用

### Ch.20 扩展系统与 FDW

**Hook 机制:** 全局函数指针, 覆盖 7 个子系统
- `planner_hook`: 自定义规划器 (e.g. Citus 改成分布式计划)
- `ExecutorStart_hook`: 执行前插入逻辑
- `ProcessUtility_hook`: DDL 时拦截

**FDW (Foreign Data Wrapper) 接口:**
- `GetForeignRelSize` / `GetForeignPaths` / `GetForeignPlan`: 影响 planner 代价
- `BeginForeignScan` / `IterateForeignScan`: 执行
- `ExplainForeignScan`: EXPLAIN 输出

**postgres_fdw pushdown 边界:**
- WHERE 中函数 = 内置函数 (e.g. =, <>) 可 pushdown
- `ORDER BY ... LIMIT N` 可 pushdown (PG 12+)
- 子查询 / JOIN 通常不可 pushdown

---

## 五、运维实战 6 章 — DBA 必读

### Ch.21 监控体系 (6 维度)

| 维度 | 关键指标 | 告警阈值 (内核依据) |
|---|---|---|
| **连接与 wait_event** | active_connections, max_connections 比例 | > 80% 警惕 |
| **存储膨胀 / wraparound** | `age(datfrozenxid)`, table bloat | age > 2 亿紧急 |
| **WAL 与复制延迟** | `pg_stat_replication.replay_lag`, WAL 段数 | lag > 1min 警告 |
| **查询性能** | pg_stat_statements.total_exec_time 突变 | p95 突增 2x 告警 |
| **锁等待链** | `pg_blocking_pids()` 深度 | 链长 > 5 紧急 |
| **shared_buffers 命中率** | `pg_stat_database.blks_hit/blks_read` | 命中率骗局: 99% 也可能 IO 打满 |

**监控陷阱:**
- `pg_stat_statements` queryid 在不同版本可能冲突
- `track_io_timing` 开 → 开销 ~5%, 不要无脑开
- `pg_stat_activity` 自身查询代价 (扫所有 backend), 不能放高频监控

### Ch.22 经典故障 5 例

| 故障 | 触发 | 排查断点 | 修复 |
|---|---|---|---|
| **连接风暴 + work_mem 链** | 连接数突增 × sort 内存爆炸 | `pg_stat_activity` 看 backend 状态 | 用连接池 + 调小 `work_mem` |
| **Wraparound** | autovacuum 失效 + 长期 freeze 滞后 | `age(datfrozenxid)` + 强制只读日志 | 手动 `VACUUM FREEZE` |
| **Slot 溢出** | standby 长期宕机 | `pg_replication_slots` 看 restart_lsn 落后 | 删 slot 或修备机 |
| **OOM kill** | work_mem × 连接数 > RAM | dmesg OOM + `pg_stat_activity` | 调 work_mem, 加 RAM |
| **idle-in-transaction 长事务** | 应用忘了 commit | `pg_stat_activity.state='idle in transaction'` | `idle_in_transaction_session_timeout` |

### Ch.23 性能调查 5 层链

```
L1: pg_stat_statements 定位可疑 queryid
   ↓
L2: EXPLAIN (ANALYZE, BUFFERS) 解剖计划
   ↓ (看 wait_event)
L3: pg_stat_activity 诊断等待类型
   ↓ (看锁)
L4: pg_locks + pg_blocking_pids() 追踪锁等待树
   ↓ (看 IO/CPU)
L5: iostat / perf / bpftrace OS 层
```

**特殊场景:**
- **CPU 100% 无慢查询** → LWLock 自旋 (ProcArrayLock / WALInsertLock), 用 pg_wait_sampling 采样
- **命中率 99% 但 IO 打满** → 检查 `effective_io_concurrency`, seq scan 没用到 OS readahead
- **计划缓存快慢切换** → plan_cache_mode = force_custom_plan 强制每次重新规划

### Ch.24 数据恢复边界

| 操作 | 做什么 | 不做什么 | 不可逆后果 |
|---|---|---|---|
| **PITR** | 基于 base backup + WAL replay 到时间点 | 不能跨 timeline 错乱恢复 | 需要完整 WAL 段链 |
| **pg_resetwal** | 修改 control file 的 nextXID/log/时间线 | 不修复损坏数据页, 不更新 CLOG | hint bit 失效 → 必须 VACUUM |
| **pg_checksums** | 启动时校验所有数据页 checksum | 运行时检测需要 `verify_heapam` | 检测但不修复 |
| **zero_damaged_pages** | 让查询跳过损坏页返回空 | 不修复数据, 只是绕过 | 数据永久丢失 |
| **pg_dump 物理备份** | 逻辑导出 | 不能跨大版本直接恢复 (但有 pg_upgrade) | N/A |

### Ch.25 大版本升级

**pg_upgrade 三种模式:**
| 模式 | 速度 | 不可回滚原因 |
|---|---|---|
| `--link` (硬链接) | **最快** (秒级) | 硬链接指向新版本二进制格式 (格式升级不可逆) |
| `--clone` (CoW) | 快 | 同上, CoW 复制后升级 |
| `--copy` (物理复制) | 慢 | 同上, 但可以保留旧目录备份 |

**为什么没有回滚:** PG 大版本升级修改了数据文件格式 (e.g. page header, 系统表), 旧版本二进制无法读新文件.

**低停机方案 (跨大版本):**
- 用逻辑复制建发布订阅 (旧版主 → 新版从)
- 切换时停旧主, 升新从为主
- 盲区: 序列 / large object / DDL (CREATE TABLE 等) 不通过逻辑复制

### Ch.26 配置陷阱 11 GUC

| GUC | 陷阱 | 正确设置 |
|---|---|---|
| **shared_buffers** | 超过 25% RAM → double buffering 反噬 | RAM 的 25%, 通常 8-16GB |
| **work_mem** | "每个操作" 不是 "每个查询", 大查询 × 多次 sort 爆炸 | 4-64MB, 看并发 |
| **effective_cache_size** | 不是缓存分配, 是优化器提示 | RAM 的 50-75% |
| **random_page_cost** | SSD 还设 4.0 → 优化器偏向 SeqScan | SSD 改 1.1, NVMe 改 1.0 |
| **fsync=off** | crash 后数据损坏 (WAL 不刷盘) | **永远 on** (除非测试) |
| **synchronous_commit=off** | crash 后丢最近事务 | 异步副本或批处理可关 |
| **huge_pages** | 容器默认未配 → 静默退化为普通页 | 容器需 `vm.nr_hugepages` 或 `huge_pages=try` |
| **maintenance_work_mem** | 不足 → autovacuum 瘫痪 (索引大时尤其) | 256MB-1GB |
| **idle_in_transaction_session_timeout** | 默认 0 (无限) → 应用忘了 commit 会锁一堆 tuple | 设 30s-5min |
| **log_lock_waits** | 默认 off → 锁等待看不到 | **on** |
| **log_min_duration_statement + auto_explain** | 一起开 → 日志洪水 | 单独开, 加 sampling |

---

## 与 MongoDB / PolarDB 知识体系交叉点

| PG 概念 | MongoDB 对应 | PolarDB 增强 |
|---|---|---|
| Heap Tuple + CLOG | _id + 版本链 | 同 PG |
| `t_infomask` hint bit | (无, MongoDB 不做可见性缓存) | 同 PG |
| `pg_xact` SLRU | (无, MongoDB 用 oplog 间接驱动) | 同 PG |
| B-Tree / GIN / BRIN | (MongoDB 只有 B-tree + 全文 + geo) | 同 PG |
| WAL + 流复制 | Oplog + 副本集 | 一写多读 RAC (共享存储) |
| `pg_stat_statements` | mongostat / db.serverStatus() | 同 PG |
| Anti-wraparound VACUUM | (无对应, MongoDB 用 capped collection 防) | 同 PG |
| Logical replication | Change streams | 同 PG |

---

## 个人下一步学习路径

读完这 26 章后, 想继续深挖的方向:

1. **PG 16 新特性**: logical replication subscriber 增强, ICU 默认, 监控视图扩展
2. **PolarDB 内核差异**: 一写多读 RAC 共享存储层, RDMA, parallel index scan
3. **Citus 分布式**: 分布式规划器 hook (对应 Ch.20 FDW hook 机制)
4. **pgvector / VectorChord 源码**: HNSW 算法 + IVFFlat, 走 GiST 接口
5. **监控实战**: 把 Ch.21 6 维度落地到 Prometheus + Grafana
6. **故障演练**: 在测试环境复现 Ch.22 5 个故障, 练手 pg_resetwal / PITR / 复制 slot 修复