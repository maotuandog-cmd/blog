# 第 09 章 对照笔记 — 查询解析与重写 (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/09-parse-rewrite.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch09-parse-rewrite-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】查询解析与重写：从 SQL 字符串到 Query Tree | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】查询解析与重写：从 SQL 字符串到 Query Tree 2026-06-16 · database · kernel · #postgresql #pg-kernel #parser #analyzer #rewriter #gram-y #query-tree #parse-analyze #pg-rewrite #view-expansion #rtable #jointree 文章导航 分类入口 database kernel 标签入口 #postgresql #pg-kernel #parser #analyzer #rewriter #gram-y #query-tree #parse-analyze #pg-rewrite #view-expansion #rtable #jointree 目录 查询解析与重写：从 SQL 字符串到 Query Tree 一、查询编译流水线：三步到位 2.2 语法分析：gram.y 的关键规则 2.3 raw_parser()：解析入口 3.2 名称解析：表名到 OID 3.3 类型推导 四、Rewriter：规则系统与视图展开 4.1 pg_rewrite 规则系统 4.3 rewriteHandler.c 的核心函数 5.1 rtable：范围表 5.3 targetList：目标列表 6.2 观察 parse tree 6.5 用 nodeToString 在代码中观察 七、关键要点 参考资料 源码（PG 17） 官方文档 论文 查询解析与重写：从 SQL 字符串到 Query Tree 你用 psql 敲下 SELECT name, salary FROM employees WHERE dept_id = 3 ORDER BY salary DESC LIMIT 5; 并按下回车。在这条 SQL 被执行器拿到手里之前，它要经过 Parser、Analyzer、Rewriter 三个阶段的变形——从一段文本变成一棵语义完整的 Query Tree。 这三个阶段在 PG 源码中分属三个目录： src/backend/parser/ （词法和语法分析）、 src/backend/parser/ （语义分析，同目录不同文件）、 src/backend/rewrite/ （规则系统和视图展开）。每层有独立的职责边界：Parser 只保证语法正确，Analyzer 负责”这个名字指的是哪个表/列/函数”，Rewriter 负责”视图其实是一条子查询，把它展开”。 本文从源码路径拆解这三个阶段的内部流程，重点解释 Query 结构体在堆满了 rtable、jointree、targetList 之后到底长什么样——以及你能用 debug_print_parse 和 debug_print_rewritten 自己观察每一步的输出。 一、查询编译流水线：三步到位 一条 SQL 从文本到可执行的 Query Tree 的完整路径如下： flowchart LR SQL[ SQL 字符串 ] -- P[ Parser br/ (gram.y + scan.l) ] P -- RT[ RawStmt br/ (语法树) ] RT -- A[ Analyzer br/ (parse_analyze) ] A -- QT[ Query br/ (语义树) ] QT -- RW[ Rewriter br/ (rewriteQuery) ] RW -- QT2[ Query Tree br/ (展开后) ] QT2 -- PL[ Planner br/ (第 10-11 章) ] ```text 三个阶段的职责边界： | 阶段 | 输入 | 输出 | 做什么 | 源码入口 | |------|------|------|--------|---------| | Parser | SQL 字符串 | `List *raw_parsetree_list`（`RawStmt` 链表） | 词法分析 (scan.l) + 语法分析 (gram.y)，构建语法树
```

## 二、PG18 源码定位


| 概念 | PG18 文件 | 说明 |
|---|---|---|
| gram.y | src/backend/parser/gram.y | bison 文法, 生成 RawStmt |
| raw_parser | src/backend/parser/parser.c | 入口, 调 yyparse |
| parse_analyze | src/backend/parser/analyze.c | 语义分析 → Query |
| transformStmt | 同上 | 把 RawStmt 转 Query |
| RewriteQuery | src/backend/rewrite/rewriteHandler.c | 视图展开, RLS 应用 |
| ApplyRule | src/backend/rewrite/rewriteHandler.c | pg_rewrite 规则系统 |
| Query 结构 | src/include/nodes/parsenodes.h | rtable/jointree/targetList |
| PostgresMain | src/backend/tcop/postgres.c | 接收 SQL, 调 pg_parse/analyze/rewrite |


## 三、PG18 源码摘录


### 9.1 raw_parser 主路径 (parser.c)
```c
List *
raw_parser(const char *str, RawParseMode mode)
{
	core_yyscan_t yyscanner;
	base_yy_extra_type yyextra;
	int			yyresult;

	/* initialize the flex scanner */
	yyscanner = scanner_init(str, &yyextra.core_yy_extra,
							 &ScanKeywords, ScanKeywordTokens);

	/* base_yylex() only needs us to initialize the lookahead token, if any */
	if (mode == RAW_PARSE_DEFAULT)
		yyextra.have_lookahead = false;
	else
	{
		/* this array is indexed by RawParseMode enum */
		static const int mode_token[] = {
			[RAW_PARSE_DEFAULT] = 0,
			[RAW_PARSE_TYPE_NAME] = MODE_TYPE_NAME,
			[RAW_PARSE_PLPGSQL_EXPR] = MODE_PLPGSQL_EXPR,
			[RAW_PARSE_PLPGSQL_ASSIGN1] = MODE_PLPGSQL_ASSIGN1,
			[RAW_PARSE_PLPGSQL_ASSIGN2] = MODE_PLPGSQL_ASSIGN2,
			[RAW_PARSE_PLPGSQL_ASSIGN3] = MODE_PLPGSQL_ASSIGN3,
		};

		yyextra.have_lookahead = true;
		yyextra.lookahead_token = mode_token[mode];
		yyextra.lookahead_yylloc = 0;
		yyextra.lookahead_end = NULL;
	}

	/* initialize the bison parser */
	parser_init(&yyextra);

	/* Parse! */
	yyresult = base_yyparse(yyscanner);

	/* Clean up (release memory) */
	scanner_finish(yyscanner);

	if (yyresult)				/* error */
		return NIL;

	return yyextra.parsetree;
}
```

### 9.2 parse_analyze (analyze.c)
```c

```

### 9.3 Query 结构 (parsenodes.h)
```c
typedef struct Query
{
	NodeTag		type;

	CmdType		commandType;	/* select|insert|update|delete|merge|utility */

	/* where did I come from? */
	QuerySource querySource pg_node_attr(query_jumble_ignore);

	/*
	 * query identifier (can be set by plugins); ignored for equal, as it
	 * might not be set; also not stored.  This is the result of the query
	 * jumble, hence ignored.
	 *
	 * We store this as a signed value as this is the form it's displayed to
	 * users in places such as EXPLAIN and pg_stat_statements.  Primarily this
	 * is done due to lack of an SQL type to represent the full range of
	 * uint64.
	 */
	int64		queryId pg_node_attr(equal_ignore, query_jumble_ignore, read_write_ignore, read_as(0));

	/* do I set the command result tag? */
	bool		canSetTag pg_node_attr(query_jumble_ignore);

	Node	   *utilityStmt;	/* non-null if commandType == CMD_UTILITY */

	/*
	 * rtable index of target relation for INSERT/UPDATE/DELETE/MERGE; 0 for
	 * SELECT.  This is ignored in the query jumble as unrelated to the
	 * compilation of the query ID.
	 */
	int			resultRelation pg_node_attr(query_jumble_ignore);

	/* has aggregates in tlist or havingQual */
	bool		hasAggs pg_node_attr(query_jumble_ignore);
	/* has window functions in tlist */
	bool		hasWindowFuncs pg_node_attr(query_jumble_ignore);
	/* has set-returning functions in tlist */
	bool		hasTargetSRFs pg_node_attr(query_jumble_ignore);
	/* has subquery SubLink */
	bool		hasSubLinks pg_node_attr(query_jumble_ignore);
	/* distinctClause is from DISTINCT ON */
	bool		hasDistinctOn pg_node_attr(query_jumble_ignore);
	/* WITH RECURSIVE was specified */
	bool		hasRecursive pg_node_attr(query_jumble_ignore);
	/* has INSERT/UPDATE/DELETE/MERGE in WITH */
	bool		hasModifyingCTE pg_node_attr(query_jumble_ignore);
	/* FOR [KEY] UPDATE/SHARE was specified */
	bool		hasForUpdate pg_node_attr(query_jumble_ignore);
	/* rewriter has applied some RLS policy */
	bool		hasRowSecurity pg_node_attr(query_jumble_ignore);
	/* parser has added an RTE_GROUP RTE */
	bool		hasGroupRTE pg_node_attr(query_jumble_ignore);
	/* is a RETURN statement */
	bool		isReturn pg_node_attr(query_jumble_ignore);

	List	   *cteList;		/* WITH list (of CommonTableExpr's) */

	List	   *rtable;			/* list of range table entries */

	/*
	 * list of RTEPermissionInfo nodes for the rtable entries having
	 * perminfoindex > 0
	 */
	List	   *rteperminfos pg_node_attr(query_jumble_ignore);
	FromExpr   *jointree;		/* table join tree (FROM and WHERE clauses);
	
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 解析器**: 未变, 仍是 gram.y + raw_parser + parse_analyze 链
2. **RLS (Row-Level Security)**: PG9.5+, PG18 沿用, 在 Rewriter/Planner 之间插入
3. **视图展开**: 仍是 pg_rewrite (规则系统), 课程重点是 "为何视图本质是 ON SELECT DO INSTEAD SELECT"
4. **CTE 物化**: PG12+ 默认非物化, PG18 仍是 NON_MATERIALIZED, 改 MATERIALIZED 显式


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch09-parse-rewrite-evidence.txt`


### 关键输出
```
 view_name | rule_event | rule_def 
-----------+------------+----------
(0 rows)

DROP VIEW

```


## 六、GDB 调试示例


观察一条 SQL 走完整解析-重写链:
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break parser.c:raw_parser
(gdb) break analyze.c:parse_analyze
(gdb) break rewriteHandler.c:RewriteQuery
(gdb) continue
# 另一窗口: SELECT * FROM t_lock;
# GDB 会依次停在 3 个断点, bt 看调用链
(gdb) bt     # raw_parser 栈: PostgresMain → exec_simple_query → raw_parser
```

观察 Query 结构 (重写后):
```
(gdb) break analyze.c:parse_analyze_fixedparams
(gdb) commands
  silent
  printf "parse_analyze → pstate=%p\n", $rdi
  finish
  p *(Query*)$rax
  continue
end
```


## 七、小结 — 与下章衔接


- 已掌握: PG18 parser → analyzer → rewriter 三步链
- 已掌握: Query 结构 (rtable/jointree/targetList/qual)
- 待查: Ch.10 统计信息 — 解析后 Planner 如何根据 pg_statistic 选路径
