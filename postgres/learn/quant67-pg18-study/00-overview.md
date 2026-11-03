# quant67 PG 内核 26 篇 × PG18.6 源码对照学习大纲

> 课程：https://quant67.com/post/db/postgresql-kernel/index.html (26 篇, 源码以 PG17 为主线)
> 源码：/opt/pg-src/postgresql-18.6/  (PG 18.6)
> 课程本地缓存：/home/obsidian/postgres/learn/quant67-pg-kernel/{01..26}-*.txt
> 学习笔记：/home/obsidian/postgres/learn/quant67-pg18-study/chapters/  (各章对照笔记)
> 进度：本文件是顶层路线, 26 章每章 1 份对照笔记

==============================================================================

## 顶层路线（作者推荐 7 条阅读路径摘录）

按站点「内核开发者」主链推进（WAL 紧跟 Buffer，不放到最后）:

    01 → 02 → 05 → 04 → 03 → 06 → 07 → 08 → 12 → 14 → 09–11 → 15–20 → 21–26

批次 1（01/02/05/04）与批次 2（03/06/07/08）已用 PG18.6 源码 grep + gdb -p 活 backend 验证。

==============================================================================

## 第 01 章 — 进程模型与共享内存  [Foundation]

**作者一句话价值**: Postmaster 启动、backend fork()、共享内存初始化 (CreateSharedMemoryAndSemaphores)、PGPROC / LWLock 数组

**PG18 源码定位 (按重要性排序):**

  - `src/backend/postmaster/postmaster.c` — PostmasterMain, ServerLoop, fork_process.c:BackendStartup, BackendRun
  - `src/backend/storage/ipc/ipci.c` — CreateSharedMemoryAndSemaphores
  - `src/backend/storage/ipc/procarray.c` — ProcArrayAdd, ProcArrayRemove
  - `src/backend/storage/lwlock/lwlock.c` — InitLWLockArray, LWLockAssign
  - `src/include/storage/proc.h` — PGPROC（PG18 无 PGXACT 结构体）

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 把 postmaster.c 的 fork 路径抽到 src/backend/postmaster/{fork_process,launch_backend}.c (PG14+ 完成)；共享内存结构无大改

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch01-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 02 章 — 页面布局与元组格式  [Foundation]

**作者一句话价值**: PageHeaderData、HeapTupleHeaderData (xmin/xmax/ctid/t_infomask)、TOAST 外存

**PG18 源码定位 (按重要性排序):**

  - `src/include/storage/bufpage.h` — PageHeaderData, PageXLogRecPtr
  - `src/include/access/htup_details.h` — HeapTupleHeaderData, t_infomask bits
  - `src/backend/access/heap/heapam.c` — heap_form_tuple, heap_deform_tuple
  - `src/backend/access/common/toast.c` — toast_tuple_external
  - `src/backend/access/heap/hot.c` — heap_update, HeapTupleSatisfiesHOTUpdate

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 HeapTupleHeaderData 仍 23B, 但 xinfomask 新增 HEAP_HAS_REDIRECTION / HEAP_LIVE_TUPLES_AVAILABLE (PG18 增强 logical replication on standby)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch02-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 03 章 — MVCC 实现：CLOG/hint bit/快照可扩展性  [Foundation]

**作者一句话价值**: CLOG SLRU 页面与事务状态位、hint bit 写入时机、PG14 snapshot scalability 优化

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/transam/clog.c` — TransactionIdSetPageStatus, TransactionIdGetStatus
  - `src/backend/access/transam/slru.c` — SimpleLruReadPage, SimpleLruWritePage
  - `src/backend/access/heap/heapam.c` — HeapTupleSatisfiesMVCC (hint bit 写入)
  - `src/backend/storage/ipc/procarray.c` — GetSnapshotData, PG14+ xmin caching
  - `src/backend/access/transam/twophase.c` — 2PC CLOG 接口

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 CLOG 仍是 SLRU, 但提交日志 page size 仍是 8KB/BLCKSZ, 256 事务/页 (BLCKSZ/2); snapshot scalability 沿用 PG14 GetSnapshotData 路径

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch03-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 04 章 — WAL 内部机制  [Foundation]

**作者一句话价值**: XLogInsert() 完整路径、WAL record 物理布局、Checkpoint 两阶段、wal_sync_method、checkpoint IO 风暴

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/transam/xlog.c` — XLogInsert, XLogFlush, XLogBackgroundFlush
  - `src/backend/access/transam/xloginsert.c` — XLogRecordAssemble, XLogInsertRecord
  - `src/backend/access/transam/xlogreader.c` — XLogDecodeNextRecord
  - `src/backend/postmaster/checkpointer.c` — CheckpointerMain, CreateCheckPoint
  - `src/backend/storage/buffer/bufmgr.c` — BufferSync (checkpoint 两阶段)

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 在 WAL 层多了 'wal_summary' 机制 (PG15+); Checkpoint 仍两阶段, 但 XLogFlush 接口已被 walwriter 路径统一

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch04-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 05 章 — Buffer Manager  [Foundation]

**作者一句话价值**: shared_buffers 三层组织、Clock sweep 替换、buffer 状态机、bgwriter 触发条件、BAS_BULKREAD/VACUUM 策略

**PG18 源码定位 (按重要性排序):**

  - `src/backend/storage/buffer/bufmgr.c` — ReadBuffer, ReleaseBuffer, PinBuffer, UnpinBuffer
  - `src/backend/storage/buffer/freelist.c` — GetBufferFromRing, StrategyGetBuffer (clock sweep)
  - `src/backend/storage/buffer/localbuf.c` — local buffer 路径
  - `src/backend/postmaster/bgwriter.c` — BgWriterMain, BgBufferSync
  - `src/include/storage/buf_internals.h` — BufferDesc, BufferStrategyControl

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 buffer 状态机相同; AIO (异步 IO) 在 PG18 正式 GA, 但 bufmgr.c 主路径未动, 见 src/backend/storage/aio/

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch05-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 06 章 — 锁管理器  [Foundation]

**作者一句话价值**: SpinLock → LWLock → Heavyweight Lock 三层、LWLock 演进 (PG 9.4 → PG16)、DeadLockCheck() 等待图、行级锁 lock bits

**PG18 源码定位 (按重要性排序):**

  - `src/backend/storage/lmgr/lwlock.c` — LWLockAcquire, LWLockRelease
  - `src/backend/storage/lmgr/lock.c` — LockAcquire, LockRelease, DeadLockCheck
  - `src/backend/storage/lmgr/proc.c` — ProcSleep, ProcWakeup
  - `src/include/storage/lwlock.h` — LWLock 模式 (LW_EXCLUSIVE/LW_SHARED)
  - `src/include/storage/lock.h` — LOCKTAG, PROCLOCK

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 锁管理器沿用 PG16 之后的 LWLock 队列实现; DeadLockCheck 算法未变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch06-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 07 章 — 事务与子事务/2PC  [Foundation]

**作者一句话价值**: TransState、savepoint 栈、2PC WAL+pg_twophase、AssignTransactionId、xidStopLimit/xidWrapLimit

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/transam/xact.c` — TransState 状态机, StartTransaction, CommitTransaction
  - `src/backend/access/transam/subtrans.c` — SubTrans linked stack
  - `src/backend/access/transam/twophase.c` — pg_twophase 状态机, GXACT
  - `src/backend/storage/ipc/procarray.c` — AssignTransactionId, GetNewTransactionId
  - `src/include/access/xact.h` — TransactionState 栈

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 事务状态机未变; 2PC 仍用 pg_twophase 文件; AssignTransactionId 未变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch07-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 08 章 — VACUUM 与 Freezing  [Foundation]

**作者一句话价值**: scan→vacuum→index cleanup→FSM/VM、anti-wraparound VACUUM 触发链、age(relfrozenxid) → 只读 shutdown

**PG18 源码定位 (按重要性排序):**

  - `src/backend/commands/vacuum.c` — vacuum, vacuum_rel
  - `src/backend/access/heap/vacuumlazy.c` — lazy_scan_heap, lazy_vacuum_heap, lazy_cleanup_index
  - `src/backend/access/heap/vacuum.c` — heap_vacuum_rel
  - `src/backend/access/heap/visibilitymap.c` — visibilitymap_set, visibilitymap_test
  - `src/backend/commands/vacuum.c` — SetTransactionIdLimit (anti-wraparound)

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 vacuum 新增 'skip' on visible pages via VM, 但 lazy_scan_heap 流程未变; pg_stat_progress_vacuum 新增 phase='scanning heap' 改进

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch08-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 09 章 — 查询解析与重写  [Query]

**作者一句话价值**: gram.y → RawStmt → parse_analyze() → pg_rewrite 视图展开、Query 结构体 rtable/jointree/targetList

**PG18 源码定位 (按重要性排序):**

  - `src/backend/parser/gram.y` — bison 文法, RawStmt 生成
  - `src/backend/parser/parser.c` — raw_parser
  - `src/backend/parser/analyze.c` — parse_analyze, transformStmt
  - `src/backend/rewrite/rewriteHandler.c` — RewriteQuery, ApplyRule
  - `src/include/nodes/parsenodes.h` — Query 结构体
  - `src/backend/tcop/postgres.c` — pg_analyze_and_rewrite

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 parser/rewriter 路径未变; 视图 RLS 处理在 pg_rewrite 链路稳定

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch09-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 10 章 — 统计信息与代价模型  [Query]

**作者一句话价值**: pg_statistic (MCV/histogram/correlation)、ANALYZE 采样、random_page_cost 在 NVMe 上为什么该改、扩展统计

**PG18 源码定位 (按重要性排序):**

  - `src/backend/statistics/extended_stats.c` — BuildRelationExtStatistics
  - `src/backend/commands/analyze.c` — analyze_rel, compute_scalar_stats, compute_trivariate_stats
  - `src/backend/utils/adt/selfuncs.c` — eqsel, scalarltsel, var_eq_const
  - `src/backend/optimizer/util/plancat.c` — get_relation_info (统计信息加载)
  - `src/include/catalog/pg_statistic.h` — pg_statistic 行格式

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 统计信息路径未变; 仍使用 pg_statistic + 扩展统计

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch10-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 11 章 — Join 顺序与路径生成  [Query]

**作者一句话价值**: make_one_rel()、SeqScan/IndexScan/IndexOnlyScan/BitmapScan、NestLoop/HashJoin/MergeJoin 代价、GEQO

**PG18 源码定位 (按重要性排序):**

  - `src/backend/optimizer/plan/planner.c` — standard_planner, make_one_rel
  - `src/backend/optimizer/path/allpaths.c` — set_base_rel_pathlists, make_rel_from_joinlist
  - `src/backend/optimizer/geqo/geqo_main.c` — geqo, geqo_eval
  - `src/backend/optimizer/path/costsize.c` — cost_seqscan, cost_index, cost_nestloop, cost_hashjoin
  - `src/backend/optimizer/path/joinpath.c` — try_nestloop_pathlist, try_hashjoin_path
  - `src/include/optimizer/geqo.h` — geqo_threshold

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 path 生成算法未变; GEQO 阈值仍 12 (geqo_threshold)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch11-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 12 章 — 执行器与表达式求值  [Query]

**作者一句话价值**: Volcano ExecInitNode/ExecProcNode/ExecEndNode、EEO opcode、TupleTableSlot、wait_event+pg_blocking_pids() 诊断

**PG18 源码定位 (按重要性排序):**

  - `src/backend/executor/executor.c` — ExecutorRun, ExecInitNode, ExecProcNode, ExecEndNode
  - `src/backend/executor/execMain.c` — ExecutorStart, ExecutePlan
  - `src/backend/executor/execQual.c` — ExecEvalExpr, EEOP_* opcodes
  - `src/backend/executor/tuptable.c` — TupleTableSlot, MakeTupleTableSlot
  - `src/backend/utils/adt/date.c (例)` — 表达式求值具体函数
  - `src/backend/postmaster/pgstat.c` — wait_event 报告

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 Volcano 模型 + EEO 未变; wait_event 仍由 pgstat 报告

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch12-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 13 章 — JIT 编译  [Query]

**作者一句话价值**: LLVM 集成 (llvmjit.c)、JIT 范围 (表达式+tuple 变形)、jit_above_cost 决策、JIT 适用边界

**PG18 源码定位 (按重要性排序):**

  - `src/backend/jit/jit.c` — llvm_compile_expr, jit_release_context
  - `src/backend/jit/llvm/llvmjit.c` — llvmjit_compile_expr (PG13+ 重整)
  - `src/backend/jit/llvm/llvmjit_expr.c` — JIT 表达式编译
  - `src/backend/jit/llvm/llvmjit_deform.c` — JIT tuple 变形
  - `src/include/jit/jit.h` — JitProvider hooks
  - `src/backend/commands/explain.c` — JIT 耗时显示

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 JIT 仍是 LLVM, jit_above_cost 默认 100000

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch13-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 14 章 — B-Tree 索引  [Index]

**作者一句话价值**: BTPageOpaque/high key/rightlink、_bt_split() 页面分裂、PG12+ deduplicate_items

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/nbtree/nbtinsert.c` — _bt_insert, _bt_split, _bt_findsplitloc
  - `src/backend/access/nbtree/nbtpage.c` — _bt_initpage, _bt_split
  - `src/backend/access/nbtree/nbtsearch.c` — _bt_search, _bt_next
  - `src/backend/access/nbtree/nbtutils.c` — _bt_compare, _bt_keep_natts_fast
  - `src/include/access/nbtree.h` — BTPageOpaqueData, IndexTupleData

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 B-Tree 沿用 PG17; deduplicate_items 已稳定

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch14-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 15 章 — GiST 索引  [Index]

**作者一句话价值**: Consistent/Union/Penalty/PickSplit 接口、DFS + Consistent 过滤、point_ops/tsvector_ops

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/gist/gist.c` — gistinsert, gistgettuple, gistbeginscan
  - `src/backend/access/gist/gistsplit.c` — gistSplitByKey, picksplit
  - `src/backend/access/gist/gistbuild.c` — gistBuildCallback
  - `src/backend/access/gist/gistproc.c` — Consistent, Union, Penalty 实现
  - `src/include/access/gist.h` — GISTSTATE, GISTENTRY

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 GiST 未变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch15-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 16 章 — GIN 索引  [Index]

**作者一句话价值**: entry tree + posting tree/list、Fast Update pending list、gingetbitmap() bitmap AND/OR

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/gin/gininsert.c` — gininsert, ginEntryInsert
  - `src/backend/access/gin/ginget.c` — gingetbitmap, scanPendingInsert
  - `src/backend/access/gin/ginfast.c` — ginHeapTupleFastInsert, processPending
  - `src/backend/access/gin/ginvacuum.c` — ginvacuumcleanup
  - `src/backend/access/gin/ginpostinglist.c` — addItem, mergeItem

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 GIN 未变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch16-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 17 章 — BRIN + Hash + Bloom  [Index]

**作者一句话价值**: BRIN 范围摘要、hash WAL 现状、Bloom 适用场景

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/brin/brin.c` — brinbuild, brininsert, bringetbitmap
  - `src/backend/access/brin/brin_revmap.c` — revmap 映射
  - `src/backend/access/brin/brin_pageops.c` — brin_page_op
  - `src/backend/access/hash/hash.c` — hashbuild, hashinsert (PG11+ WAL)
  - `contrib/bloom/blinsert.c` — Bloom 扩展

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 BRIN 未变; hash 索引已 WAL-logged (PG11+)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch17-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 18 章 — 流复制  [Repl]

**作者一句话价值**: WalSndLoop()/WalRcvLoop() 协议、同步复制三级语义、slot 机制、slot 溢出 PANIC 因果链

**PG18 源码定位 (按重要性排序):**

  - `src/backend/replication/walsender.c` — WalSndLoop, XLogSend
  - `src/backend/replication/walreceiver.c` — WalRcvLoop, XLogPageRead
  - `src/backend/replication/slot.c` — ReplicationSlotCreate, ReplicationSlotRelease
  - `src/backend/replication/syncrep.c` — SyncRepWaitForLSN, SyncRepQueueWait
  - `src/backend/replication/logic/ (同步复制状态)` — sync_standby_names

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 流复制未变; sync_standby_names 优先级 (PG16+ quorum) 已稳定

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch18-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 19 章 — 逻辑复制与逻辑解码  [Repl]

**作者一句话价值**: Logical Decoding Context、Reorder Buffer、pgoutput、Publication/Subscription、四种冲突

**PG18 源码定位 (按重要性排序):**

  - `src/backend/replication/logic/logicallauncher.c` — ApplyLauncherMain
  - `src/backend/replication/logical/worker.c` — ApplyWorkerMain, apply_handle_insert/update/delete
  - `src/backend/replication/logical/reorderbuffer.c` — ReorderBufferCommit, ReorderBufferIterTXN
  - `src/backend/replication/logical/logical.c` — pgoutput, ReorderBufferChange
  - `src/backend/replication/pgoutput/pgoutput.c` — pg_output_begin/insert/update
  - `src/include/replication/logicallauncher.h` — 订阅同步冲突类型

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 logical replication 未变; subscriptions parallel apply 已 PG16+ GA

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch19-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 20 章 — 扩展系统与 FDW  [Repl]

**作者一句话价值**: hook 全景、FdwRoutine 回调、postgres_fdw pushdown

**PG18 源码定位 (按重要性排序):**

  - `src/include/fmgr.h` — FmgrHook, needs_fmgr_hook
  - `src/backend/foreign/foreign.c` — GetFdwRoutine, FdwRoutine
  - `src/backend/foreign/fdwapi.c` — FDW API (GetForeignPlan, BeginForeignScan, IterateForeignScan)
  - `src/backend/optimizer/plan/createplan.c` — create_foreignscan_plan
  - `contrib/postgres_fdw/postgres_fdw.c` — postgres_fdw 实现, GetForeignRelSize, pushdown

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 FDW API 稳定; postgres_fdw 路径未变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch20-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 21 章 — 监控体系与告警设计  [Ops]

**作者一句话价值**: 六个监控维度、告警阈值的内核依据、pg_stat_statements/pgBadger/pg_exporter 集成

**PG18 源码定位 (按重要性排序):**

  - `src/backend/utils/adt/pgstatfuncs.c` — pg_stat_get_* 视图函数
  - `src/backend/utils/misc/guc.c` — GUC 表
  - `contrib/pg_stat_statements/pg_stat_statements.c` — pg_stat_statements
  - `src/include/pgstat.h` — PgStat_StatDBEntry, WaitEvent
  - `src/backend/postmaster/pgstat.c` — pgstat_report_wait_start/end

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 pg_stat_* 视图新增: pg_stat_progress_vacuum (PG16+); wait_event 新增 'AIO' 类 (PG18)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch21-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 22 章 — 经典故障 5 例  [Ops]

**作者一句话价值**: 连接风暴/事务ID wraparound/replication slot溢出/OOM连锁kill/长事务隐性破坏

**PG18 源码定位 (按重要性排序):**

  - `src/backend/utils/error/elog.c` — 错误状态、进程退出
  - `src/backend/storage/ipc/procarray.c` — OldestXmin 计算 (长事务)
  - `src/backend/storage/lmgr/lock.c` — lock_table 阻塞
  - `src/backend/access/transam/varsup.c` — xidStopLimit, xidWrapLimit
  - `src/backend/postmaster/postmaster.c` — BackendCrashRecovery

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 新增 aio worker 池, 但故障形态基本不变; 长事务仍是 vacuum xmin 阻塞主因

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch22-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 23 章 — 性能异常调查方法论  [Ops]

**作者一句话价值**: 五层链 pg_stat_statements→EXPLAIN(BUFFERS)→wait_event→pg_locks→perf/bpftrace

**PG18 源码定位 (按重要性排序):**

  - `src/backend/commands/explain.c` — ExplainQuery, ExplainPrintPlan
  - `src/backend/executor/execMain.c` — InstrStartNode, InstrStopNode
  - `src/backend/postmaster/pgstat.c` — wait_event 记录
  - `contrib/pg_stat_statements/pg_stat_statements.c` — pg_stat_statements 内部
  - `src/backend/utils/adt/pg_locks.c` — pg_locks

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 wait_event 多 'AIO' 类; 其余调查方法论不变

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch23-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 24 章 — 数据恢复与损坏应对  [Ops]

**作者一句话价值**: PITR 三个关键窗口、pg_resetwal 最后手段、页面损坏不可逆边界

**PG18 源码定位 (按重要性排序):**

  - `src/backend/access/transam/xlog.c` — StartupXLOG, recovery 入口
  - `src/backend/access/transam/xlogrecovery.c` — replay xlog, recovery 状态
  - `src/backend/access/transam/timeline.c` — TLI 历史
  - `src/backend/access/rmgrdesc/*` — WAL resource manager 解码
  - `src/bin/pg_resetwal/pg_resetwal.c` — pg_resetwal 实现 (源)
  - `src/bin/pg_basebackup/pg_basebackup.c` — pg_basebackup

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 pg_resetwal 选项新增 -u/-x 处理未提交事务 (PG14+); PITR 路径稳定

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch24-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 25 章 — 大版本升级与迁移实战  [Ops]

**作者一句话价值**: pg_upgrade --link 零拷贝零回滚、逻辑复制方案、跨大版本迁移边界

**PG18 源码定位 (按重要性排序):**

  - `src/bin/pg_upgrade/pg_upgrade.c` — main, transferFile
  - `src/bin/pg_upgrade/check.c` — check_and_dump_old_cluster
  - `src/bin/pg_upgrade/file.c` — transfer_relfile
  - `contrib/pg_upgrade_support/` — PG17+ pg_upgrade_support 函数

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 pg_upgrade 路径不变; 但 PG18 起 logical replication subscription worker 已 parallel apply (升级时需停订阅)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch25-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/


## 第 26 章 — 配置陷阱 (11 个 GUC)  [Ops]

**作者一句话价值**: work_mem 真正语义、fsync=off 诱惑代价、huge_pages Docker 静默退化、random_page_cost=4 在 NVMe 上离谱

**PG18 源码定位 (按重要性排序):**

  - `src/backend/utils/misc/guc.c` — GUC 全部定义
  - `src/backend/utils/misc/guc_tables.c` — GUC 表
  - `src/include/utils/guc.h` — GUC 分类 (PGC_SIGHUP/PGC_USERSET/PGC_SIGHUP)
  - `src/backend/storage/buffer/bufmgr.c` — shared_buffers 实际使用
  - `src/backend/executor/execGrouping.c` — work_mem hash join 实际分配
  - `src/backend/access/transam/xlog.c` — fsync GUC 影响 XLogWrite

**PG18 vs 课程(以 PG17 为主线) 差异点**: PG18 GUC 变化: huge_pages 处理逻辑调整; wal_buffers 默认 -1 (auto); shared_buffers 默认 128MB (沿用)

**实操验证 (在 /opt/pg-18 的 PG18 实例):**

  - 章节笔记 chapters/ch26-*.md 中给出 1-3 个可执行验证, 真实跑出输出贴入 evidence/
