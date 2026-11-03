# 第 12 章 对照笔记 — 执行器与表达式求值 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/12-executor.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch12-executor-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】执行器与表达式求值：从计划树到行数据的一趟流水 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】执行器与表达式求值：从计划树到行数据的一趟流水 2026-06-16 · database · kernel · #postgresql #pg-kernel #executor #volcano-model #expression-evaluation #hash-join #tupleslot #wait-event #pg-blocking-pids #explain-analyze 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #executor #volcano-model #expression-evaluation #hash-join #tupleslot #wait-event #pg-blocking-pids #explain-analyze 目录 执行器与表达式求值：从计划树到行数据的一趟流水 一、火山模型：三条控制流 1.1 入口函数 1.3 ExecProcNode：每次返回一行 二、Hash Join：内存中的构建与探测 2.1 两阶段流程 2.2 Hash 表的内存结构 3.3 编译过程 3.4 解释执行循环 4.3 Heap Slot：完整的堆元组 4.5 Slot 操作接口 六、运维：查询 hang 住不动时的诊断 6.1 wait_event 是第一现场 6.3 EXPLAIN 行数偏差诊断 6.4 执行器层面的排查命令总结 7.2 观察 Hash Join 的 batch 溢出 7.3 观察 EEO 编译结果 八、关键要点 参考资料 源码（PG 17） 官方文档 论文 实验工具 执行器与表达式求值：从计划树到行数据的一趟流水 你给 PG 发了一条 SQL，planner 给了一个计划——然后呢？执行器（Executor）负责把计划树变成实际的行数据。它按”火山模型”自上而下驱动算子树：父节点每次调用子节点的 ExecProcNode() 拉一行数据，处理完返回给更上层，最终回到客户端。这不是简单的 for 循环——每一步都涉及内存分配（TupleTableSlot）、表达式求值（ WHERE 条件、 SELECT 列表、聚合参数）、以及算子内部的复杂状态机（hash join 的构建/探测阶段切换）。 一条 SQL 执行到底要经过多少函数调用？本文从 execMain.c 的入口一路追到 execExprInterp.c 的 opcode 解释循环，再深入到 nodeHashjoin.c 的 hash 表构建与探测。最后讨论一个运维核心问题：查询 hang 住不动时，从哪里下手诊断。 一、火山模型：三条控制流 PG 执行器的设计遵循经典的 Volcano（迭代器）模型 。每个算子（plan node）对外暴露统一的接口： ExecInitNode() 初始化状态 → ExecProcNode() 每次调用返回一行 → ExecEndNode() 清理资源。parent 算子不知道 child 是 SeqScan、IndexScan 还是 HashJoin——它只管调 ExecProcNode() 拉数据。 1.1 入口函数 执行器的入口在 src/backend/executor/execMain.c 中： // src/backend/executor/execMain.c, ExecutorStart() void ExecutorStart ( QueryDesc * queryDesc , int eflags ) { // 1. 初始化执行状态（EState） // 2. 为计划树中每个节点调用 ExecInitNode() // 3. 为 expression tree 编译 opcode（EEO） ExecInitPlan ( queryDesc , estate , eflags ); ... } // src/backend/executor/execMain.c, ExecutorRun() void ExecutorRun ( QueryDesc * queryDesc ,
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| ExecutorRun | src/backend/executor/executor.c | 入口 |
| ExecInitNode | 同上 | 初始化 Plan tree |
| ExecProcNode | 同上 | Volcano: 每次 fetch 一个 tuple |
| ExecEndNode | 同上 | 收尾 |
| ExecutePlan | src/backend/executor/execMain.c | 主循环 |
| ExprEval | src/backend/executor/execExpr.c | 表达式编译 |
| EEOP_* | src/include/executor/execExpr.h | opcode |
| TupleTableSlot | src/backend/executor/tuptable.c | tuple 缓存 |
| wait_event | src/backend/postmaster/pgstat.c | 等待事件报告 |


## 三、PG18 源码摘录


### 12.1 ExecInitNode 分发 (executor.c)
```c

```

### 12.2 ExecutePlan 主循环 (execMain.c)
```c
static void
ExecutePlan(QueryDesc *queryDesc,
			CmdType operation,
			bool sendTuples,
			uint64 numberTuples,
			ScanDirection direction,
			DestReceiver *dest)
{
	EState	   *estate = queryDesc->estate;
	PlanState  *planstate = queryDesc->planstate;
	bool		use_parallel_mode;
	TupleTableSlot *slot;
	uint64		current_tuple_count;

	/*
	 * initialize local variables
	 */
	current_tuple_count = 0;

	/*
	 * Set the direction.
	 */
	estate->es_direction = direction;

	/*
	 * Set up parallel mode if appropriate.
	 *
	 * Parallel mode only supports complete execution of a plan.  If we've
	 * already partially executed it, or if the caller asks us to exit early,
	 * we must force the plan to run without parallelism.
	 */
	if (queryDesc->already_executed || numberTuples != 0)
		use_parallel_mode = false;
	else
		use_parallel_mode = queryDesc->plannedstmt->parallelModeNeeded;
	queryDesc->already_executed = true;

	estate->es_use_parallel_mode = use_parallel_mode;
	if (use_parallel_mode)
		EnterParallelMode();

	/*
	 * Loop until we've processed the proper number of tuples from the plan.
	 */
	for (;;)
	{
		/* Reset the per-output-tuple exprcontext */
		ResetPerTupleExprContext(estate);

		/*
		 * Execute the plan and obtain a tuple
		 */
		slot = ExecProcNode(planstate);

		/*
		 * if the tuple is null, then we assume there is nothing more to
		 * process so we just end the loop...
		 */
		if (TupIsNull(slot))
			break;

		/*
		 * If we have a junk filter, then project a new tuple with
```

### 12.3 TupleTableSlot (tuptable.c)
```c

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 Volcano 模型**: 未变, pull-based, 每次 ExecProcNode 返回一个 tuple
2. **Expr JIT**: PG12+ 引入 LLVM JIT, PG18 沿用 (见 ch13)
3. **pg_blocking_pids()**: PG9.6+, PG18 用于排查锁等待链
4. **wait_event**: PG14+ 引入 wait_event_name 表, PG18 沿用


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch12-executor-evidence.txt`


### 关键输出
```
  pid  | state  | wait_event_type | wait_event |                                query                                 
-------+--------+-----------------+------------+----------------------------------------------------------------------
 47606 | active |                 |            |                                                                     +
       |        |                 |            | -- 当前查询                                                         +
       |        |                 |            | SELECT pid, state, wait_event_type, wait_event, query               +
       |        |                 |            | FROM pg_stat_activity WHERE backend_type='client backend';          +
       |        |                 |            |                                                                     +
       |        |                 |            | -- 找阻塞链                                                         +
       |        |                 |            | DROP TABLE IF EXISTS t_block;                                       +
       |        |                 |            | CREATE TABLE t_block (id int, v text);                              +
       |        |                 |            | INSERT INTO t_block VALUES (1, 'a');                                +
       |        |                 |            |                                                                     +
       |        |                 |            | -- session 1: BEGIN; UPDATE 不提交                                  +
       |        |                 |            | -- session 2: UPDATE 同一行 (会等)                                  +
       |        |                 |            | -- session 3: SELECT pg_blocking_pids(pid), * FROM pg_stat_activity;+
       |        |                 |            |                                                                     +
       |        |                 |            | -- 观察 Volcano 调度: 复杂 SELECT                                   +
       |        |                 |            | EXPLAIN (ANALYZE, VERBOSE, BUFFERS)                                 +
       |        |                 |            | SELECT a.id, b.payload, c.payload                                   +
       |        |                 |            | FROM a JOIN b ON a.id=b.aid JOIN c ON a.id=c.aid                    +
       |        |                 |            | WHERE a.val LIKE 'a%';                                              +
       |        |                 |            | 
(1 row)

DROP TABLE
CREATE TABLE
INSERT 0 1
                                                           QUERY PLAN                                                            
---------------------------------------------------------------------------------------------------------------------------------
 Hash Join  (cost=19.12..93.87 rows=5000 width=12) (actual time=3.691..14.536 rows=5000.00 loops=1)
   Output: a.id, b.payload, c.payload
   Hash Cond: (b.aid = a.id)
   Buffers: shared hit=10
   ->  Seq Scan on public.b  (cost=0.00..16.00 rows=1000 width=8) (actual time=0.038..1.576 rows=1000.00 loops=1)
         Output: b.aid, b.payload
         Buffers: shared hit=6
   ->  Hash  (cost=12.87..12.87 rows=500 width=12) (actual time=3.642..3.657 rows=500.00 loops=1)
         Output: a.id, c.payload, c.aid
         Buckets: 1024  Batches: 1  Memory Usage: 32kB
         Buffers: shared hit=4
         ->  Hash Join  (cost=3.50..12.87 rows=500 width=12) (actual time=0.443..2.829 rows=500.00 loops=1)
               Output: a.id, c.payload, c.aid
               Inner Unique: true
               Hash Cond: (c.aid = a.id)
               Buffers: shared hit=4
               ->  Seq Scan on public.c  (cost=0.00..8.00 rows=500 width=8) (actual time=0.065..0.865 rows=500.00 loops=1)
                     Output: c.aid, c.payload
                     Buffers: shared hit=3
               ->  Hash  (cost=2.25..2.25 rows=100 width=4) (actual time=0.358..0.364 rows=100.00 loops=1)
                     Output: a.id
                     Buckets: 1024  Batches: 1  Memory Usage: 12kB
                     Buffers: shared hit=1
                     ->  Seq Scan on public.a  (cost=0.00..2.25 rows=100 width=4) (actual time=0.025..0.188 rows=100.00 loops=1)
                           Output: a.id
                           Filter: (a.val ~~ 'a%'::text)
                           Buffers: shared hit=1
 Planning:
   Buffers: shared hit=145
 Planning Time: 1.029 ms
 Execution Time: 21.507 ms
(31 rows)


```


## 六、GDB 调试示例


观察 Volcano 调度:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break executor.c:ExecProcNode
(gdb) break execMain.c:ExecutePlan
(gdb) continue
# 另一窗口: SELECT * FROM a JOIN b ON ...;
# GDB 会不停停在 ExecProcNode, 每次打 nodeTag 看走哪个 plan
(gdb) commands 1
  silent
  printf "ExecProcNode: tag=%d\n", ((PlanState*)$rdi)->plan->type
  continue
end
```

观察 wait_event 上报:
```
# 在慢查询上 attach GDB
(gdb) pgproc    # 看 waitStatus
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 Volcano 模型 (ExecInitNode / ExecProcNode / ExecEndNode)
- 已掌握: TupleTableSlot, ExprEval opcode
- 待查: Ch.13 JIT — PG18 LLVM JIT 何时启用
