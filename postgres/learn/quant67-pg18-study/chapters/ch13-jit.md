# 第 13 章 对照笔记 — JIT 编译 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/13-jit.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch13-jit-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】JIT 编译：为什么 PG 要把 WHERE 子句编译成机器码 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】JIT 编译：为什么 PG 要把 WHERE 子句编译成机器码 2026-06-16 · database · kernel · #postgresql #pg-kernel #jit #llvm #expression-evaluation #tuple-deforming #olap #query-execution #jit-compilation 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #jit #llvm #expression-evaluation #tuple-deforming #olap #query-execution #jit-compilation 目录 JIT 编译：为什么 PG 要把 WHERE 子句编译成机器码 一、JIT 在 PG 中的编译范围 决策的源码路径 为什么需要分级 三、LLVM 会话初始化与模块管理 Provider 模式 会话初始化 惰性编译 四、表达式求值 JIT：从 EEO Opcode 到 LLVM IR 解释器的执行模型 LLVM 表达式编译 五、Tuple 变形 JIT：列提取的加速 为什么 Tuple 变形是瓶颈 七、实验：JIT 加速效果的实际测量 实验环境 实验 1：简单聚合——JIT 得不偿失 实验 2：TPC-H Q1——JIT 大幅加速 实验 3：复杂 WHERE——表达式密集查询 实验 5：I/O 瓶颈查询——JIT 无效 平台兼容性问题 调试与性能分析工具 配置建议 九、关键要点 参考资料 源码（PG 17） 官方文档 关键提交 设计讨论 JIT 编译：为什么 PG 要把 WHERE 子句编译成机器码 执行 SELECT count(*) FROM orders WHERE status = 'pending' AND amount 1000 时，PG 需要解析每一行的 status 和 amount 列值，执行比较运算，再对满足条件的行计数。如果表有 5000 万行，这个”解析列值→比较→计数”的循环要执行 5000 万次。 第 12 章讲的 EEO（Expression Evaluation）解释器用一个编译好的 opcode 序列执行这些操作——每个 opcode 是一个 C 函数指针，解释器在 ExecInterpExpr() 的大循环中逐条跳转执行。问题不在单次调用慢，而在 5000 万次解释开销堆在一起：每次 opcode 分发的 switch 跳转、函数指针调用、结果写回，在数百万次循环中累积为可观的 CPU 开销。 JIT（Just-In-Time）编译就是针对这个场景：把热路径上的表达式求值和 Tuple 列提取直接编译成本地机器码，省掉解释器的 opcode 分发开销。但 JIT 编译本身也有代价——LLVM 生成 IR、优化、编译成机器码都需要 CPU 时间。PG 用三级代价阈值来决定”这个查询值得编译吗，以及编译多深”。 本文从 jit_above_cost 的决策路径出发，拆解 llvmjit.c 和 llvmjit_expr.c 中 JIT 编译的完整流程，并通过实验量化 JIT 在 OLAP 查询中的加速效果和边界。 一、JIT 在 PG 中的编译范围 PG 的 JIT 编译只覆盖两个操作： 1. 表达式求值（Expression Evaluation） WHERE 子句、target list 的表达式计算、聚合函数中的表达式、CASE WHEN 分支等。对应源码 src/backend/jit/llvm/llvmjit_expr.c 。 2. Tuple 变形（Tuple Deforming） 从磁盘上的 Heap Tuple 二进制格式提取各列的值——将 HeapTupleHeaderData + 变长数据解析成 TupleTableSlot 中按列排列的 Datum 数组。对应源码 src/backend/jit/llvm/llvmjit_deform.c 。 以下操作不被 JIT 编译：查询规划（pla
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| llvmjit.c | src/backend/jit/llvm/llvmjit.c | PG18 LLVM 入口 |
| llvmjit_expr.c | src/backend/jit/llvm/llvmjit_expr.c | 表达式编译 |
| llvmjit_deform.c | src/backend/jit/llvm/llvmjit_deform.c | tuple 变形 |
| jit_provider | src/include/jit/jit.h | hook, 默认 _PG_jit_provider |
| GUC | src/backend/utils/misc/guc.c | jit/jit_above_cost/jit_inline_above_cost/jit_optimize_above_cost |
| explain_jit | src/backend/commands/explain.c | EXPLAIN 输出 JIT 耗时 |


## 三、PG18 源码摘录


### 13.1 llvm_compile_expr (llvmjit.c)
```c

```

### 13.2 jit GUC 配置 (guc.c 节选)
```

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 JIT**: 仍是 LLVM, 通过 LLVM 11+ 编译
2. **PG13+ 重整**: src/backend/jit/llvm/{llvmjit, llvmjit_expr, llvmjit_deform}.c 替代 PG11- 的 llvmjit.c 单文件
3. **JIT 适用边界**: 表达式求值 + tuple 变形 (tuple deformation), 不适用事务/网络/磁盘 IO
4. **默认**: jit=off, ON 时 cost >= jit_above_cost (默认 100000) 才触发


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch13-jit-evidence.txt`


### 关键输出
```
          name           | setting | unit 
-------------------------+---------+------
 jit                     | on      | 
 jit_above_cost          | 100000  | 
 jit_debugging_support   | off     | 
 jit_dump_bitcode        | off     | 
 jit_expressions         | on      | 
 jit_inline_above_cost   | 500000  | 
 jit_optimize_above_cost | 500000  | 
 jit_profiling_support   | off     | 
 jit_provider            | llvmjit | 
 jit_tuple_deforming     | on      | 
(10 rows)

 jit 
-----
 on
(1 row)

 jit_above_cost 
----------------
 100000
(1 row)

 jit_provider 
--------------
 llvmjit
(1 row)

SET
SET

```


## 六、GDB 调试示例


观察 JIT 触发:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break llvmjit.c:llvm_compile_expr
(gdb) continue
# 另一窗口: SET jit=ON; SET jit_above_cost=0; EXPLAIN ANALYZE SELECT ...
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 JIT (LLVM 编译表达式+deform)
- 已掌握: jit_above_cost / jit_inline_above_cost / jit_optimize_above_cost 三级阈值
- 待查: Ch.14 B-Tree — 索引访问路径如何与 Volcano 协调
