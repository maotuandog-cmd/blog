# mysql.taobao.org/monthly PostgreSQL 专栏学习笔记

> 来源: http://mysql.taobao.org/monthly/ (阿里内核月报 PG 专栏)
> 全站 PG 相关文章: 162 篇 (2015/02 - 2026/07)
> 本笔记聚焦: 65 篇高价值文章 (按 tag + 关键字 + recent 筛选)
> 本地缓存: /home/obsidian/postgres/learn/taobao-monthly-pg/ (65 篇 markdown, 1.2 MB)
> 关联笔记: quant67-pg-kernel-notes.md, digblog-20260904-pg-*.md
> 学习日期: 2026-09-04

================================================================
一、阿里内核月报 PG 专栏概览
================================================================

1.1 覆盖范围
- 总文章: 162 篇 PG 相关
- 时间跨度: 2015/02 - 2026/07 (11 年)
- 产出峰期: 2015-2019 (139 篇, 占 86%), 对应 PG 9.4-12 时代
- 2020-2023 断更期 (11 篇), 阿里重心转向 PolarDB/MySQL 8
- 2024+ 重新活跃 (13 篇), 主题更现代 (MemoryContext/blink-tree/逻辑复制/CBQT)

1.2 标签分布 (TOP)
| 标签              | 篇数 | 说明                              |
| ----------------- | ---- | --------------------------------- |
| 应用案例          | 46   | 实战用法                          |
| 特性分析          | 28   | 单个特性深度解析                  |
| 源码分析          | 10   | 源码级拆解                        |
| 最佳实践          | 10   | 调优 / 规范                       |
| 答疑解惑          | 7    | 问题排查                          |
| 引擎特性          | 6    | 内核特性                          |
| 内核特性/开发     | 4    | 内核开发                          |
| 追根究底/捉虫     | 2    | 罕见 bug 追查                     |

1.3 与 PG 主线版本对应
2015 = PG 9.4-9.5 时代 (BRIN, JSONB, Logical Decoding 引入)
2016 = PG 9.6 时代 (并行查询起步, Plan Hint)
2017 = PG 10 时代 (Logical Replication GA, 分区表, 声明式分区)
2018 = PG 11 时代 (并行 Hash Join, Partition-wise JOIN, JIT 起步)
2019 = PG 12 时代 (PL/pgSQL, 分区表增强)
2020-2022 = 阿里重心外移, 少量 PolarDB PG 文章
2024+ = PG 16-17 时代 (逻辑复制完善, MemoryContext 深入, Blink-tree)

================================================================
二、MVCC 与可见性
================================================================

来源: 2017/10 MVCC机制浅析, 2019/08 多版本并发控制介绍及实例分析, 2018/12 Hint Bits 简介
关联: quant67 ch02/ch03, digblog-20260904-pg-32bit-xid-and-64bit-fix.md

2.1 两种 MVCC 实现路径
- 回滚段式: Oracle, MySQL InnoDB — 旧版本存在回滚段
- 堆内多版本: PostgreSQL — 旧版本留在原 page, 通过 t_ctid 形成版本链

PG 的优缺点:
- 优点: 事务回滚立即完成; 无 ORA-1555 错误; 不需维护回滚段空间
- 缺点: 旧版本需清理 (→ autovacuum); 旧版本可能导致查询扫更多 block

2.2 HeapTupleHeaderData 关键字段
  t_xmin    插入该元组的事务 ID (32 位)
  t_xmax    删除或更新该元组的事务 ID (32 位, =0 表示未删除)
  t_cid     命令号 (CommandId, 同事务多 SQL 区分)
  t_ctid    二元组 (page#, item#), 指向新版本或自身
  t_infomask    元组状态, 含 Hint Bits (HEAP_XMIN_FROZEN 等 5 个 bit)

2.3 可见性 9 条规则 (基于 interdb 总结)
按 t_xmin 状态分支:
- ABORTED → Invisible (Rule 1)
- IN_PROGRESS + t_xmin=current → 看 t_max (Rule 2 Visible, Rule 3 Invisible)
- IN_PROGRESS + t_xmin≠current → Invisible (Rule 4)
- COMMITTED + t_xmin 在 snapshot 中活跃 → Invisible (Rule 5)
- COMMITTED + t_max=0 或 ABORTED → Visible (Rule 6)
- COMMITTED + t_max IN_PROGRESS + t_max=current → Invisible (Rule 7)
- COMMITTED + t_max IN_PROGRESS + t_max≠current → Visible (Rule 8)
- COMMITTED + t_max COMMITTED + t_max 在 snapshot 中活跃 → Visible (Rule 9)
- COMMITTED + t_max COMMITTED + t_max 不活跃 → Invisible (Rule 10)

→ 完整 10 条规则见 2018/12 文章

2.4 事务快照结构 (SnapshotData)
格式: xmin:xmax:xip_list
- xmin: 最早 active 的 txid (小于它的都已 commit/abort)
- xmax: 第一个未分配的 xid (≥ 它的事务在快照生成时都不可见)
- xip_list: 快照生成时所有 active 事务的 txid

RC 隔离: 每条命令前重新拿 snapshot
RR/SERIALIZABLE: 第一条命令拿 snapshot, 整个事务复用

2.5 Hint Bits (4 个 bit 位 + 1 个派生)
  #define HEAP_XMIN_COMMITTED  0x0100  /* t_xmin committed */
  #define HEAP_XMIN_INVALID    0x0200  /* t_xmin aborted */
  #define HEAP_XMIN_FROZEN     (HEAP_XMIN_COMMITTED|HEAP_XMIN_INVALID)
  #define HEAP_XMAX_COMMITTED  0x0400
  #define HEAP_XMAX_INVALID    0x0800

延迟更新: PG 不在 commit 时主动更新, 而是在第一次访问时
(SetHintBits), 通过 CLOG 读状态写入 t_infomask

副作用 (重要):
- 开启 data_checksums 或 wal_log_hints=on 时, 第一次"脏化"该 page 是
  因 Hint Bits → 必须写 Full Page Image 到 WAL (即使 SELECT)
- 表现为: 纯 SELECT 也触发磁盘写入
- 函数: MarkBufferDirtyHint
- 跟 full_page_writes 无关, 是独立的

2.6 PG 隔离级别映射 (vs SQL 标准)
| Level              | Dirty Read | Non-repeat | Phantom | Serial Anomaly |
| ------------------ | ---------- | ---------- | ------- | -------------- |
| Read uncommitted   | Not in PG (=RC) | Possible | Possible | Possible |
| Read committed     | Not possible   | Possible | Possible | Possible       |
| Repeatable read    | Not possible   | Not possible | Not in PG (=无幻读) | Possible |
| Serializable       | Not possible   | Not possible | Not possible | Not possible |

PG 的特殊点:
- RU 实际 = RC (不允许脏读)
- RR 不允许幻读 (跟 SQL 标准不同, SQL 标准 RR 允许幻读)

================================================================
三、CLOG (Commit Log) 详解
================================================================

来源: 2015/09 clog异步提交一致性, 2018/12 Hint Bits
关联: quant67 ch03 MVCC, digblog 64 位 XID 笔记

3.1 4 种事务状态 (2 bit/事务)
  IN_PROGRESS    0x00
  COMMITTED      0x01
  ABORTED        0x02
  SUB_COMMITTED  0x03  (仅子事务用)

3.2 物理结构
- 持久化: pg_xact/ (PG 10 前叫 pg_clog)
- 每个 page 8KB (BLCKSZ), 32K 个事务/page (4 事务/字节 × 8K)
- 文件命名: 0000, 0001...
- 每段最大 32 个 page (SLRU_PAGES_PER_SEGMENT), 默认 256KB/段
- 内存缓存: Min(32, Max(4, NBuffers / 512)) 个 SLRU slot

3.3 CLOG buffer 数量公式 (PG 9.2+)
  CLOGShmemBuffers = Min(32, Max(4, NBuffers / 512))
含义:
- NBuffers < 2048 → 4 个 slot
- NBuffers ≥ 16384 → 32 个 slot
- 测试发现 64 核服务器, 并发请求可能超过 32 个, 这是已知扩展限制

3.4 pg_fsync 触发时机 (重要)
pg_fsync 触发条件 (从代码逐级分析):
1. GetNewTransactionId() → ExtendCLOG(xid)
2. ExtendCLOG: 余数=0 才扩展; 否则直接返回
3. ZeroCLOGPage → SimpleLruZeroPage → SlruSelectLRUPage
4. 选 slot: 先看是否有 EMPTY, 没有选 LRU dirty slot
5. 选到 dirty slot → SlruInternalWritePage → SlruPhysicalWritePage
6. ctl->do_fsync=true → pg_fsync(fd)

do_fsync 区分:
- pg_clog / multixact: do_fsync=true (默认)
- pg_subtrans / pg_notify: do_fsync=false

3.5 CLOG 扩展触发频率
每 32K 个事务要扩展一个 CLOG PAGE, 每次要 zero-fill + fsync
- 一次扩展约 100us 级, 但持有 XidGenLock + CLogControlLock
- 不可预测的响应延迟: 扩展 CLOG PAGE 时所有等 clog PAGE 的会话都阻塞

3.6 CLOG 与 XID wraparound 关联
CLOG truncate 跟 vacuum 强绑定: 老的 XID 状态可以被覆盖 (已 freeze)
→ digblog 64 位 XID 笔记 §四: CLOG truncate 频率大幅降低

================================================================
四、Checkpoint 机制双视角
================================================================

来源: 2015/09 checkpoint调度, 2017/04 checkpoint机制浅析

4.1 checkpoint 触发条件 (xlog.h flag)
  CHECKPOINT_IS_SHUTDOWN      0x0001  shutdown
  CHECKPOINT_END_OF_RECOVERY  0x0002  recovery 完成后
  CHECKPOINT_IMMEDIATE        0x0004  立即执行
  CHECKPOINT_FORCE            0x0008  强制, 即使无活动
  CHECKPOINT_WAIT             0x0010  等待完成
  CHECKPOINT_CAUSE_XLOG       0x0020  WAL 量超阈值
  CHECKPOINT_CAUSE_TIME       0x0040  周期触发
  CHECKPOINT_FLUSH_ALL        0x0080  含 unlogged table

4.2 关键参数 (PG 11 前/后)
| 参数                       | 默认值     | 说明                                |
| -------------------------- | ---------- | ----------------------------------- |
| checkpoint_segments        | 3          | WAL segment 数量阈值 (PG11 前)     |
| max_wal_size               | 1GB        | 新版替代 checkpoint_segments        |
| checkpoint_timeout         | 5min       | 最大间隔                            |
| checkpoint_completion_target| 0.5       | 完成时间占间隔比例 (0.9 推荐)       |
| checkpoint_warning         | 30s        | 实际间隔小于此值时警告              |

4.3 checkpoint_completion_target 的精妙
目的: 把"集中在尾部"的 fsync 摊薄到整个时间窗口

调度公式 (2015/09):
  IsCheckpointOnSchedule() = 新产生的日志文件数 / checkpoint_segments
                              是否 < checkpoint_completion_target

实际效果:
  checkpoint_segments=16, target=0.9, timeout=300s
  → 触发时新产生第 16 个日志, 触发 checkpoint
  → 每次 write 脏页后, 新日志 < 16*0.9=15 时 sleep
  → 整体耗时 = min(产生 15 个日志时间, 270s) + fsync 时间
  → 最终实际生成 checkpoint_segments * (1 + completion_target) 个新日志

推荐值: segments ≥ 16, completion_target = 0.9, timeout = 300s
→ checkpoint 间隔可达 1 分钟以上

4.4 CreateCheckPoint 流程
1. 遍历所有 buffer, 脏页 BM_DIRTY → BM_CHECKPOINT_NEEDED
2. CheckPointGuts 刷共享内存
3. 生成新 CheckPoint 记录写 WAL
4. 更新 pg_control / 共享内存 XlogCtl / 统计信息

CheckPointGuts 调用顺序:
  CheckPointCLOG()
  CheckPointSUBTRANS()
  CheckPointMultiXact()
  CheckPointPredicate()
  CheckPointRelationMap()
  CheckPointBuffers()      ← performs all required fsyncs
  CheckPointTwoPhase()     ← 2PC

前 4 个走 SLRU SimpleLruFlush
后 2 个直接调 pg_fsync

4.5 ControlFileData 关键字段
  checkPoint       最近一次完整 checkpoint 的 LSN
  prevCheckPoint   上一次完整 checkpoint (冗余, 防写过程崩溃)
  checkPointCopy   最近一次 CheckPoint 对象
  minRecoveryPoint
  minRecoveryPointTLI

checkpoint 不完整保护: 系统在所有页面写完前崩溃 → 磁盘上是"上一个完整 checkpoint" + 未刷新的页面

4.6 时间线 (Timeline) 与 PITR
WAL 文件名: TimeLineID (8位) + 逻辑日志 ID (8位) + 段 ID (8位)
  例: 00000001 00000001 0000008F

每次归档恢复后产生新时间线, 伴随 .history 文件记录前序时间线
PITR 时通过 .history 快速定位目标 WAL 段, 不必扫描全部

4.7 bgwriter / checkpointer 协作
BackgroundWriterMain → BgBufferSync → SyncOneBuffer → FlushBuffer
                                         ↓ write (page cache, 不 fsync)
                                         ↓ ForwardFsyncRequest → pendingOpsTable
CheckPointGuts → CheckPointBuffers → mdsync → pg_fsync → fsync
目的: 合并 IO, 减少 fsync 调用次数

================================================================
五、Autovacuum 双进程深度剖析
================================================================

来源: 2017/12 launcher, 2018/02 worker
关联: digblog-20260904-pg-32bit-xid-and-64bit-fix.md §四 freeze

5.1 双进程角色
- autovacuum launcher: 守护/调度 (一个 postmaster 下唯一一个)
- autovacuum worker: 具体清理 (最多 autovacuum_max_workers 个)

5.2 launcher 关键数据结构
  /* struct to keep track of databases in launcher */
  typedef struct avl_dbase {
      Oid          adl_datid;        /* hash key */
      TimestampTz  adl_next_worker;  /* 下次启动 worker 的时间 */
      int          adl_score;        /* database 分值 */
      dlist_node   adl_node;
  } avl_dbase;

5.3 launcher 调度逻辑 (launcher_determine_sleep)
1. 空闲 worker 列表空 → sleep autovacuum_naptime
2. DatabaseList 不空 → sleep 到最晚那个 database 的期望时间
3. 否则 sleep autovacuum_naptime
4. 已晚于期望时间 → 最小休眠 100ms

每个 database 期望占用时间 = autovacuum_naptime / adl_score

5.4 启动 worker 的 database 选取优先级
1. 数据库最大 xid 超 autovacuum_freeze_max_age → 立即启动
2. 数据库最大 multixact 超 autovacuum_multixact_freeze_max_age
3. 否则选最久没执行的 database

→ 这一点对运维很关键: 长事务导致某个 db xid 推进慢, 会优先被 vacuum

5.5 launcher 共享内存 AutoVacuumShmemStruct
  typedef struct {
      sig_atomic_t av_signal[AutoVacNumSignals];
      pid_t        av_launcherpid;
      dlist_head   av_freeWorkers;
      dlist_head   av_runningWorkers;
      WorkerInfo   av_startingWorker;
      AutoVacuumWorkItem av_workItems[NUM_WORKITEMS];
  } AutoVacuumShmemStruct;

worker 3 状态: 空闲 / 启动中 / 运行中
启动超时 (超过 autovacuum_naptime) → 重置

5.6 worker 启动后关键 GUC 重写
  zero_damaged_pages = off       (清理时不能忽略坏页)
  statement_timeout = 0          (不被 timeout 阻塞)
  lock_timeout = 0
  idle_in_transaction_session_timeout = 0
  default_transaction_isolation = read committed  (避免 deadlock)
  synchronous_commit = local     (不受备库影响)

5.7 vacuum 触发条件 (do_autovacuum)
| 触发原因     | 条件                                                    |
| ------------ | ------------------------------------------------------- |
| vacuum       | dead tuples > autovacuum_vacuum_threshold + scale_factor*reltuples |
| analyze      | changed tuples > autovacuum_analyze_threshold + scale_factor*reltuples |
| wraparound   | age > autovacuum_freeze_max_age 或 relminmxid < threshold |

5.8 vacuum_cost_delay 限速机制
内部计数器跟踪 I/O 开销 (vacuum_cost_page_hit=1, miss=10, dirty=20)
累计超过 vacuum_cost_limit → sleep vacuum_cost_delay ms
目的: 平摊清理开销, 避免对在线查询影响

5.9 worker ↔ launcher 协作流程
launcher:
  rebuild_database_list → 计算 adl_score
  launcher_determine_sleep → 决定 sleep
  launch_worker → 发 PMSIGNAL_START_AUTOVAC_WORKER 给 postmaster
  → Postmaster: StartAutovacuumWorker → StartAutoVacWorker → AutoVacWorkerMain

worker:
  注册信号 → 改 GUC → 读 av_startingWorker 拿 db → 加入 av_runningWorkers
  → 连接 db → 读 xid/multixact → do_autovacuum
  → 遍历 pg_class → 判断需不需要 vacuum/analyze/wraparound
  → autovacuum_do_vac_analyze → 释放 → 更新 datfrozenxid

================================================================
六、Heap Only Tuple (HOT) — UPDATE 索引 IO 优化
================================================================

来源: 2018/11 HOT 案例
关联: quant67 ch05 buffer manager, XStore 原位更新对比

6.1 PG 原生 UPDATE 的 IO 放大
8.3 之前: 每个 tuple 版本对应一个索引 POINT
→ UPDATE 一次 = N 个索引各写 1 次 = 大量 IO

6.2 HOT 触发条件 (2 个必要条件)
必要条件 A: UPDATE 不能改变任何索引字段的值
必要条件 B: 新版本必须能在同一个 heap page 内
            (HOT chain 不能跨 page)

6.3 HOT 机制本质
- 通过 HEAP PAGE 内部 LINK (t_ctid) 串起所有 tuple 版本
- 索引不更新 (节省 N 个索引的 IO)

6.4 实测对比 (pageinspect 验证)
3 个索引 (id/c1/c2), 10 行数据
- HOT update (c3=c3+1, 不动索引字段) → 索引不变, ctid 链 (0,1)→(0,13)
- HOT update (c2=c2, 索引字段值不变) → 索引不变
- NON-HOT update (c2=c2+1) → 3 个索引各加一个 POINT

6.5 索引垃圾回收顺序
vacuum 时先回收索引 dead tuple, 再回收 heap dead tuple
观察 vacuum verbose 输出: "scanned index ... to remove N row versions"

6.6 PG 10+ 二级索引 (indirect index)
PG 10 引入, 用于解决"更新字段没索引,但需要索引导向旧版本"的场景
与 HOT 互补

6.7 HOT vs XStore 对比 (来自 digblog)
| 维度         | HOT (PG 8.3+)              | XStore (OpenTeleDB)        |
| ------------ | -------------------------- | -------------------------- |
| 适用         | 索引字段不变 + 同 page     | 所有 UPDATE                |
| 旧版本位置   | heap page 内 (t_ctid 链)  | 独立 Undo 文件             |
| 索引维护     | 索引不更新 (但 NON-HOT 时更新) | 索引原位更新 (inplace)   |
| vacuum       | 仍需扫 dead tuple          | 不需扫 heap/索引 dead tuple |
| 副作用       | 索引可能碎片 (chain 断裂) | 索引 leaf 碎片化 (xbtrecycle) |
| 跨 page      | 不支持 (chain 断)          | 支持                       |

================================================================
七、行锁与多版本并发
================================================================

来源: 2018/12 行锁实现

7.1 4 种行锁模式
  FOR KEY SHARE
  FOR SHARE
  FOR NO KEY UPDATE    (delete 取 FOR UPDATE; update 看是否有唯一索引)
  FOR UPDATE

7.2 行锁加锁流程 (以 UPDATE 为例)
1. 加事务 Exclusive 锁 (AssignTransactionId → LockAcquire, 内存锁)
2. 判断是否需要锁等待 (HeapTupleSatisfiesUpdate 看 xmax/multixact 是否活跃)
3. 加 tuple 锁 (heap_acquire_tuplock, 多事务改同一行时排队)
4. 等待 Xmax 事务 Share 锁 (XactLockTableWait, 释放 page 锁避免阻塞其他 tuple)
5. 唤醒后重新检查 xmax

tuple 锁 vs 事务锁:
- tuple 锁: 保护"修改元组"的顺序, 修改完立即释放
- 事务锁: 整个事务期间持有, commit/abort 才释放

7.3 MultiXact 机制
场景: FOR SHARE / FOR KEY SHARE — 一个 tuple 上可能有多个事务持锁
- 单个事务: 直接用 xmax
- 多事务: 生成 MultiXactId, 锁成员放在 MultiXactMemberPage, xmax 存 MultiXactId
- 物理位置: pg_multixact/ 目录, 同样 SLRU 缓存

7.4 行锁 vs Oracle/MySQL 对比
| 维度       | PostgreSQL              | Oracle                  | MySQL InnoDB        |
| ---------- | ----------------------- | ----------------------- | ------------------- |
| 锁存储     | tuple header (xmax/multi) | ITL (Interested Transaction List) | bitmap            |
| 共享锁     | 支持 FOR SHARE          | 不支持 select for share  | 支持 LOCK IN SHARE MODE |
| 高并发写   | 多个 multi 转 SLRU      | ITL 受限易冲突          | bitmap 内存占用大   |

================================================================
八、复制与一致性快照迁移
================================================================

来源: 2017/12 一致性快照迁移数据

8.1 pg_export_snapshot (PG 9.3+)
导出当前事务快照唯一 ID, 供其他事务复用:
  BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  SELECT pg_export_snapshot();   -- 返回 '000003A1-1'
  
  -- 另一连接:
  BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  SET TRANSACTION SNAPSHOT '000003A1-1';
应用场景:
- 多连接并行 pg_dump -j N (directory 模式)
- pg_dump / pg_restore 的并行实现

8.2 严格一致的全量+增量数据迁移方案
核心: 利用 pg_export_snapshot 拿到"全量起始一致性点", 同步启动 logical replication slot

7 步流程:
1. 主进程 CREATE_REPLICATION_SLOT (返回结果集第 4 列是 snapshotid)
   → 类似 MySQL GTID, 标识"从这里开始的所有变更"
2. N 个子进程 SET TRANSACTION SNAPSHOT <id>, 并行 dump
3. 同时启动一个连接持续拉取增量 WAL, 解析落盘
4. 全量 dump 完成后, 开始追增量
5. 接近追平时, 停主库写
6. 数据完全追上, 做数据校验
7. 校验通过, 应用切到目的端

vs MySQL binlog GTID 思路:
- MySQL binlog 用 unix 时间戳 (早期) / GTID (后期)
- PG 用 snapshotid (LSN-based, 不会回退)

8.3 Logical Decoding 原理
- 类似 MySQL binlog 同步
- 把 redo (物理日志) 解析成逻辑日志
- 通过 output plugin 自定义格式 (pgoutput / test_decoding 等)
- 输出格式灵活: PG-to-PG 部分对象迁移 / PG-to-异构 DB / 持续同步

================================================================
九、Checkpoint 双进程视角 (深)
================================================================

参见 §四, 补充与 digblog XID 笔记的关联:

9.1 checkpoint 与 XID freeze 的关系
- vacuum_rel 完成 freeze → 修改 tuple header → 写 WAL → checkpoint 持久化
- freeze 后 CLOG 中"老 XID"段可以被 truncate → 释放 pg_xact 空间

9.2 64 位 XID 后 checkpoint 变化
digblog §九 阶段 2:
- 引入 freeze 优化: autovacuum 不再扫 all-visible page
- autovacuum IO 降 50%+

================================================================
十、9 种索引原理与场景
================================================================

来源: 2019/04 9种索引, 2017/02 GIN 多列组合, 2015/05 BRIN, 2017/02 聚集存储与BRIN

10.1 PG 索引开放性
6 大扩展接口: 数据类型 / 操作符 / FDW / 编程语言 / 索引方法 / 函数
索引方法: btree / hash / gin / gist / sp-gist / brin / bloom / rum / zombodb
          / bitmap (Greenplum extend)
内部优化: BitmapAnd / BitmapOr 合并多个索引扫描

10.2 9 种索引对比

| 索引     | 原理                          | 适用场景                         |
| -------- | ----------------------------- | -------------------------------- |
| btree    | 经典 B-Tree                   | 通用, 支持排序/范围              |
| hash     | 存 VALUE 的哈希值             | 等值查询, 长字符串               |
| gin      | 倒排 (col_val:tid_list)       | 多值类型 (数组/全文/jsonb)       |
| gist     | 通用搜索树模板                | 几何/范围/IP/PostGIS             |
| sp-gist  | 空间分区 (非平衡)             | 范围/IP, 支持 quad-tree/k-d tree |
| brin     | 块级摘要 (LOSSLY)             | 时序/物理相关性强的列             |
| bloom    | bloom filter                  | 任意列组合等值                    |
| rum      | gin + ts_rank                 | 全文检索带排名                    |
| zombodb  | 与 ES 集成                    | 全文+结构化                       |

10.3 btree 索引大小限制
"index row size 3720 exceeds maximum 2712" 错误
- 单条索引 entry 不能超过 BLCKSZ 的 1/3 (默认 8KB → 2712B)
- 解决: 用 hash 索引 / 用 MD5 函数索引 / 用全文索引

10.4 GIN 多列展开式 B 树 (创新用法)
"任意列组合等效查询"
- CREATE INDEX ON t USING gin (c1, c2, c3, ..., c9);
- 一次创建, 支持任意 c1=? OR c2=? AND c3=? 等组合
- 内部通过 BitmapAnd / BitmapOr 合并多个扫描
- 实测 9 列 10 万行复杂 OR 查询 ~6ms

跟 bloom 对比:
- bloom: 一个索引, 概率命中, 支持 = 查询
- gin: 多列展开, 精确, 支持范围

10.5 BRIN 索引细节
块级摘要: 不是每行一个 entry, 而是每 N 个块一个摘要
适用: 时序数据 / 物理相关性强的列 (按插入顺序存储)
- 数据量: 1 亿行表 BRIN 索引可能只有几 MB
- 反例: 频繁 UPDATE 的随机数据 (物理相关性破坏, BRIN 失效)

10.6 多列索引与单列索引权衡
复合索引 index(a,b,c):
- WHERE a=? AND b>? AND c=? → 全用
- WHERE b=? AND c=? → 只能用 b 起 (B-Tree 前缀性)
- WHERE c=? → 完全用不上
- WHERE a=? OR b=? → 用不上 (OR 不能用 B-Tree)

OR 查询要走 BitmapOr 或 GIN 多列索引

================================================================
十一、并行查询 (PG 9.6 → 11 → 12+)
================================================================

来源: 2019/01 并行查询概述, 2018/07 PG11并行Hash Join
关联: digblog oGRAC/OpenTenBase 也都用并行

11.1 发展时间线
- 9.6 (2016): 并行 SeqScan, IndexScan, BitmapHeapScan, IndexOnlyScan, NestLoop, MergeJoin
- 10 (2017): 并行 HashJoin (但每个 worker 独立构建 HashTable)
- 11 (2018): 真并行 HashJoin (共享 HashTable) + 并行 Append + Partition-wise JOIN
- 12+ (2019+): 持续完善

11.2 基础组件
- Background Worker Process: 动态启动, 通过 postmaster kill 信号启动
- Dynamic Shared Memory: 运行时动态创建, 执行完释放
- 通信: 基于动态共享内存的 tuple queue + error queue

11.3 并行扫描分配
block-by-block 策略:
- 多进程维护全局指针 next
- 指向下一个待扫描 block
- 取 block 时移动 next 指针
- IndexScan: next 指向下一个索引叶子节点
- IndexOnlyScan: 无需回 heap

11.4 并行 Hash Join 演进
| 版本  | 实现                              | 缺点                       |
| ----- | --------------------------------- | -------------------------- |
| 9.6   | 只支持左表并行, 右表每个 worker 重扫 | 右表重复扫描 N 次          |
| 10    | 仍每 worker 构建私有 HashTable    | 内存浪费 N 倍              |
| 11    | 真共享 HashTable                  | 动态共享内存管理复杂       |

11.5 并行 Append / Partition-wise JOIN (PG 11)
场景: 分区表 WHERE pkey=const → 每个分区独立并行
转换:
  原: HashJoin → Append → 分区 1, 2, 3...
  转: Append → (HashJoin p1), (HashJoin p2), (HashJoin p3)...

11.6 并行度计算规则
并行度公式:
  workers = log(table_size / min_parallel_table_scan_size) / log(3) + 1

例: min_parallel_table_scan_size=8MB
- [8MB, 24MB) → 1 worker
- [24MB, 72MB) → 2 worker
- [72MB, 216MB) → 3 worker

关键参数:
- max_parallel_workers_per_gather (单节点最大, 默认 2)
- max_worker_processes (全局总最大)
- max_parallel_workers (并行 worker 总数)
- force_parallel_mode (调试用, 强制并行)

11.7 并行代价估算
并行度除数 parallel_divisor:
  parallel_divisor = path->parallel_workers;
  if (parallel_leader_participation) {
      leader_contribution = 1.0 - (0.3 * path->parallel_workers);
      if (leader_contribution > 0) parallel_divisor += leader_contribution;
  }
  // workers > 3 → leader 不参与子计划

新增代价值:
- parallel_tuple_cost: worker→master 每 tuple 传输代价 (默认 0.1)
- parallel_setup_cost: 启动 worker 进程的固定代价 (默认 1000)

11.8 并行限制 (PG 11)
- 写数据/锁行 不支持并行
- CREATE TABLE AS / SELECT INTO / CREATE MATERIALIZED VIEW 支持
- CTE (WITH) 不支持并行
- DECLARE CURSOR 不支持
- 包含 PARALLEL UNSAFE 函数 不支持
- serializable 隔离 不支持并行

================================================================
十二、MemoryContext 深入 (2024/08 精华篇)
================================================================

来源: 2024/08 MemoryContext 标准实现解读

12.1 内存架构分类
- 共享内存 (shared memory area): Postmaster 启动时分配, 固定大小, 管理简单
- 本地内存 (local memory area): 每个 backend 自己管理, 复杂, 易泄漏

PG 自 7.1 引入 MemoryContext 解决本地内存问题

12.2 标准 Context 类型
- TopMemoryContext: 根, 永不释放
- CacheMemoryContext: relcache/catcache/plancache, 永不释放
- MessageContext: 前端命令 + parser/plan tree, 每外部循环重置
- TopTransactionContext: 顶层事务, 周期结束重置
- ErrorContext: 错误恢复, 始终保留 8KB 防止 OOM 崩溃

12.3 抽象类型设计 (OOP)
  typedef struct MemoryContextMethods {
      void *(*alloc)(MemoryContext, Size);
      void  (*free_p)(MemoryContext, void*);
      void *(*realloc)(MemoryContext, void*, Size);
      void  (*reset)(MemoryContext);
      void  (*delete_context)(MemoryContext);
      Size  (*get_chunk_space)(MemoryContext, void*);
      bool  (*is_empty)(MemoryContext);
      void  (*stats)(MemoryContext, ...);
  } MemoryContextMethods;
  
  typedef struct MemoryContextData {
      NodeTag type;
      bool isReset, allowInCritSection;
      Size mem_allocated;
      const MemoryContextMethods *methods;  // 虚函数表
      MemoryContext parent, firstchild, prevchild, nextchild;
      const char *name, *ident;
      MemoryContextCallback *reset_cbs;
  } MemoryContextData;

→ AllocSetContext 必须把 MemoryContextData 作为第一个字段 (C 实现继承)

12.4 AllocSet 标准实现
数据结构:
  typedef struct AllocSetContext {
      MemoryContextData header;       // 必须第一个字段
      AllocBlock blocks;              // malloc 出的 block 链表头
      AllocChunk freelist[ALLOCSET_NUM_FREELISTS]; // 11 个 freelist
      Size initBlockSize, maxBlockSize, nextBlockSize;
      Size allocChunkLimit;           // 默认 8KB, 不能超 maxBlockSize/4
      AllocBlock keeper;              // reset 后保留的初始 block
      int freeListIndex;
  } AllocSetContext;

三种底层实现:
- aset.c (标准, 保留 freelist)
- slab.c (大对象直接归还 OS)
- generation.c (新一代优化)

12.5 AllocSetAlloc 流程
1. size > allocChunkLimit → 直接 malloc 一个 block 作为 chunk
2. 否则查 freelist[对应 size 档]
3. freelist 没有 → block 剩余空间也不足 → 把剩余放合适 freelist
4. → malloc nextBlockSize 大小的 block → 切 chunk
5. → 返回 chunk

12.6 AllocSetFree 流程
1. 释放 chunk
2. size > allocChunkLimit → 调 free() 归 OS
3. 否则挂到对应 size 的 freelist 链头

12.7 AllocSetFreeList (优化)
两层 freelist:
- context_freelists[0]: 默认参数候选集
- context_freelists[1]: 小参数候选集
- 每个 AllocSetFreeList 数量上限 100 (MAX_FREE_CONTEXTS)
- LIFO 取用, 溢出时全部释放
- 避免 AllocSet 频繁创建/删除

================================================================
十三、其他重要知识点
================================================================

13.1 异步提交一致性 (2015/09)
synchronous_commit = on/off/local
- on: 等待 WAL fsync (主从一致)
- off: 不等待 (主库崩溃可能丢最近提交)
- local: 只等本地 fsync, 不等备库 (适合 autovacuum)

13.2 WAL 段命名规则 (2017/04)
8位16进制 TimeLineID + 8位逻辑日志 ID + 8位段 ID
  例: 00000001000000010000008F
PITR 通过 .history 文件追溯时间线

13.3 物理备份内部原理 (2018/08)
- pg_basebackup → 流复制协议
- 全量 copy data dir + WAL
- 启动时从基础备份 + replay WAL 恢复

13.4 WAL 优化 (PG 11+)
- wal_level = replica (默认)
- max_wal_size / min_wal_size (替代 checkpoint_segments)
- wal_compression = on (zstd 压缩 full page image)

================================================================
十四、跨笔记交叉引用
================================================================

14.1 与 quant67-pg-kernel-notes.md 对应
| 月报主题              | quant67 章节       |
| --------------------- | ------------------ |
| MVCC / CLOG           | ch03 MVCC          |
| Page / HeapTuple      | ch02 页面与元组    |
| WAL / Checkpoint      | ch04 WAL 内部      |
| Autovacuum            | ch08 vacuum        |
| MemoryContext         | ch01 共享内存      |
| 9 种索引              | ch14-17 BTree/GiST/GIN/BRIN |
| 事务快照 / 行锁       | ch07 事务与子事务   |
| 并行查询              | ch12 执行器        |

14.2 与 digblog-20260904-pg-32bit-xid-and-64bit-fix.md 对应
| 月报主题              | digblog 章节       |
| --------------------- | ------------------ |
| CLOG truncate         | §四 freeze IO      |
| autovacuum launcher   | §四 freeze 时机    |
| Hint Bits + WAL       | §四 CLOG 状态查询  |
| 异步提交              | §七 应用开发者建议  |

14.3 与 digblog-20260904-pg-fork-databases-source-analysis.md 对应
| 月报主题              | 国产 DB 对应点     |
| --------------------- | ------------------ |
| HOT                   | oGRAC §DRC / XStore §xheap |
| autovacuum            | OpenTenBase GTM 不需要 vacuum |
| 9 种索引              | OpenTenBase DN 用 PG 原生索引 |
| MemoryContext         | 各 fork 在 contrib 层扩展     |
| 并行查询              | openGauss 并行 redo / oGRAC DTC |
| 复制 / 快照           | OpenTenBase GTM GXID / 逻辑复制 |

================================================================
十五、核心结论
================================================================

15.1 PG MVCC 的核心矛盾
- heap 存多版本 → 写多版本简单, 读靠快照
- 代价: 表膨胀 + autovacuum + CLOG/SubTrans/MultiXact 维护
- 三种缓解: HOT (索引不更新) / 逻辑复制 (拆堆到独立存储) / 原位更新 (XStore/zheap)
- 终极解: 64 位 XID + page epoch (见 digblog 笔记 §三-§五)

15.2 PG 索引选型决策树
| 场景                       | 推荐索引             |
| -------------------------- | -------------------- |
| 通用等值/范围/排序         | btree                |
| 长字符串等值               | hash                 |
| 数组 / JSONB / 全文        | gin                  |
| 几何/范围/IP/PostGIS       | gist / sp-gist       |
| 时序/物理相关              | brin                 |
| 任意列组合等值             | bloom / gin 多列展开 |
| 全文 + 排名                | rum                  |

15.3 PG 并行查询适用边界
- 数据量大但单查询简单 (SeqScan / IndexScan)
- OLAP / 报表 / 离线分析
- 不适用: OLTP 高频小事务 / 写操作 / CTE / serializable

15.4 MemoryContext 设计精髓
- 树状结构 → 批量释放防泄漏
- 虚函数表 (C 的 OOP) → 多实现可替换 (aset/slab/generation)
- 两级 freelist → 减少 AllocSet 创建/删除开销
- keeper block → reset 时保留初始 block, 不全释放

15.5 阿里 PG 月报的独特价值
相比 PG 官方文档和社区博客:
- 中文源码级深度拆解 (阿里内核团队)
- 实战案例丰富 (RDS/PolarDB 应用场景)
- 跨版本横向对比 (PG 9.4 → 17)
- 跟阿里自研数据库交叉验证 (PolarDB/OpenTenBase)
- 时间跨度 11 年, 看技术演进清晰

→ 跟 digblog (德哥 blog) 互为补充:
- digblog: 德哥个人视角, 国产 DB 源码剖析为主
- taobao-monthly: 阿里团队视角, PG 内核特性 + 实战为主

================================================================
十六、未深入但有价值的文章 (按主题索引)
================================================================

逻辑复制 / 高可用:
  2015/02/03 Replication Slot
  2015/03/08 Logical Decoding 探索
  2015/10/04 PG 主备流复制机制 (注: 本次未抓取)
  2016/01/09 Plan Hint
  2016/04/05 上百 TB 数据增量处理
  2025/03/01 一文搞懂 PostgreSQL 逻辑复制的全部原理

锁与并发:
  2021/07/03 死锁检测与解决
  2024/07/03 子事务探秘
  2026/07/02 Buffer Access 5 Rules
  2026/07/03 HeapTable + Pin vs InnoDB IOT

查询优化:
  2016/03/03 优化器逻辑推理
  2016/09/07 PG 优化器浅析
  2017/02/07 PG 优化器物理查询优化
  2017/08/07 pathkey 与索引排序
  2024/12/04 慢 SQL 优化分享
  2025/01/02 PolarDB OR 子句转 UNION ALL
  2025/01/08 PolarDB CBQT

版本演进:
  2020/06/05 PG 13 Beta 1 初体验
  2021/01/08 PG 13 新特性
  2021/12/01 PG 14 新特性浅析

物理备份 / 安全:
  2018/08/06 物理备份内部原理
  2020/07/06 SQL 防火墙内核浅析
  2020/03/02 PG 通信协议

================================================================
十七、本地缓存目录速查
================================================================

路径: /home/obsidian/postgres/learn/taobao-monthly-pg/
文件数: 65 篇
总大小: ~1.2 MB

文件命名规范:
  YYYY-MM-DD--<原标题>.md

每篇文件结构:
  # <标题>
  来源: <URL>
  标签: <tag/feature-word/recent>
  
  ---
  
  ## <章节>
  正文...

可按 ls | grep <关键字> 检索, 或用 ripgrep 跨文件搜索具体概念。

================================================================
十八、引用源
================================================================

阿里内核月报 PG 专栏: http://mysql.taobao.org/monthly/
本次筛选高价值文章数: 65 / 162
本地缓存: /home/obsidian/postgres/learn/taobao-monthly-pg/

关联笔记:
- /home/obsidian/postgres/learn/quant67-pg-kernel-notes.md
- /home/obsidian/postgres/learn/20260904-pg-32bit-xid-and-64bit-fix.md
- /home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
