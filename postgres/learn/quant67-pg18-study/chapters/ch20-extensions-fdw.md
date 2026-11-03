# 第 20 章 对照笔记 — 扩展系统与 FDW (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/20-extensions-fdw.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch20-extensions-fdw-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】扩展系统与 FDW：PG 的 hook 机制如何让扩展影响 Planner 决策 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】扩展系统与 FDW：PG 的 hook 机制如何让扩展影响 Planner 决策 2026-06-16 · database · kernel · #postgresql #pg-kernel #extensions #fdw #foreign-data-wrapper #postgres-fdw #hook #pushdown #planner #executor 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #extensions #fdw #foreign-data-wrapper #postgres-fdw #hook #pushdown #planner #executor 目录 扩展系统与 FDW：PG 的 hook 机制如何让扩展影响 Planner 决策 一、扩展的 SQL 入口：CREATE EXTENSION 与 .control 文件 1.1 CREATE EXTENSION 的执行流程 1.3 对应 SQL 安装脚本 2.2 Executor 层 Hook 2.4 路径级 Hook（Pathlist 干预） 2.6 认证 Hook 2.8 Hook 调用链与冲突 三、FDW 的接口体系：FdwRoutine 3.1 FdwRoutine 的核心回调 3.2 三个规划回调：扩展如何影响 Planner 四、postgres_fdw 的 pushdown 机制 4.1 什么会被 pushdown 4.2 什么不会被 pushdown 4.3 pushdown 决策的源码路径 5.2 验证各类型 pushdown 5.4 用 auto_explain 捕获 FDW 查询计划 6.2 统计信息过期 6.4 join_collapse_limit 对 FDW JOIN pushdown 的影响 6.5 事务隔离的不一致 七、关键要点 参考资料 源码（PG 17） 官方文档 论文/标准 扩展系统与 FDW：PG 的 hook 机制如何让扩展影响 Planner 决策 如果你用过 postgres_fdw 跨库查询，大概率遇到过这样一个问题：一个简单的 SELECT * FROM remote_t WHERE id = 1 跑得很慢， EXPLAIN (VERBOSE) 一看，发现 WHERE 条件根本没推到远端——PG 把远程表数据全拉回本地，然后在本地做过滤。 这不是 bug，这是扩展需要显式实现 pushdown 逻辑的结果。PG 的扩展系统给外部代码插入了 planner 和 executor 的决策路径，但能插到什么深度、改变了哪些决策，取决于你用的 hook 在哪个层次。 本文从两套并行机制拆解 PG 扩展体系：全局 hook 机制（让扩展在七个子系统中插入自定义逻辑）和 FDW 的 FdwRoutine 回调接口（让外部表参与 planner 的代价估算与路径生成）。理解这两套机制，你就能判断一个扩展”到底改了 PG 的什么行为”，以及 postgres_fdw 的 pushdown 为什么有些 SQL 能推、有些不能推。 一、扩展的 SQL 入口：CREATE EXTENSION 与 .control 文件 1.1 CREATE EXTENSION 的执行流程 在 SQL 层面，扩展安装只需要一条命令： CREATE EXTENSION postgres_fdw; ```text 这条命令背后的执行路径在 `src / backend / commands / extension.c` 的 `CreateExtension()` 中： ```text CreateExtension() → 读取 .control 文件 → 解析扩展元数据 → 检查依赖（requires 字段）和版本兼容 → parse_extension_script() → 解析 SQL 安装脚本 → 依次执行每条 SQL（CREATE FUNCTION、CREATE FOREIGN DATA WRAPP
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| FmgrHook | src/include/fmgr.h | 函数管理器 |
| GetFdwRoutine | src/backend/foreign/foreign.c | FDW 入口 |
| FdwRoutine | src/include/foreign/fdw.h | 回调表 |
| GetForeignPlan | src/backend/foreign/fdwapi.c | planner 调用 |
| BeginForeignScan | 同上 | executor 调用 |
| IterateForeignScan | 同上 | 拉数据 |
| postgres_fdw | contrib/postgres_fdw/postgres_fdw.c | PG-to-PG FDW |


## 三、PG18 源码摘录


### 20.1 GetFdwRoutine (foreign.c)
```c
FdwRoutine *
GetFdwRoutine(Oid fdwhandler)
{
	Datum		datum;
	FdwRoutine *routine;

	/* Check if the access to foreign tables is restricted */
	if (unlikely((restrict_nonsystem_relation_kind & RESTRICT_RELKIND_FOREIGN_TABLE) != 0))
	{
		/* there must not be built-in FDW handler  */
		ereport(ERROR,
				(errcode(ERRCODE_OBJECT_NOT_IN_PREREQUISITE_STATE),
				 errmsg("access to non-system foreign table is restricted")));
	}

	datum = OidFunctionCall0(fdwhandler);
	routine = (FdwRoutine *) DatumGetPointer(datum);

	if (routine == NULL || !IsA(routine, FdwRoutine))
		elog(ERROR, "foreign-data wrapper handler function %u did not return an FdwRoutine struct",
			 fdwhandler);

	return routine;
}
```

### 20.2 FdwRoutine 结构 (fdw.h)
```c

```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 FDW API**: 仍是 FdwRoutine 回调表 + postgres_fdw
2. **Pushdown**: postgres_fdw 支持 SELECT/JOIN/AGG/ORDER BY 推到远端
3. **Foreign Table**: PG18 仍用 CREATE FOREIGN TABLE + SERVER + USER MAPPING
4. **async_capable**: PG14+ FDW 异步连接, PG18 沿用 (主要给外部大数据源)


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch20-extensions-fdw-evidence.txt`


### 关键输出
```

```


## 六、GDB 调试示例


观察 FDW 调用:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break fdwapi.c:fdwapi.c:24 IterateForeignScan
(gdb) continue
# 另一窗口: SELECT * FROM ft_passwd LIMIT 5;
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 FDW API + FdwRoutine 回调 + postgres_fdw pushdown
- 待查: Ch.21-26 运维实战 — 监控/故障/性能调查/恢复/升级/配置陷阱
