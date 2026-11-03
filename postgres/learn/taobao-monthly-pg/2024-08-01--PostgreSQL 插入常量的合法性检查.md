# PostgreSQL 插入常量的合法性检查

来源: http://mysql.taobao.org/monthly/2024/08/01/
标签: recent

---

**本文简单介绍 PostgreSQL 数据库如何对 INSERT 语句中的常量进行合法性检查**，检查逻辑从上到下涉及到词法分析、语法解析、语义分析、查询优化、参数绑定、执行器等多个模块。

全文的所有代码都以 PostgreSQL 14 为例，所有 SQL 示例都基于如下表定义：

```
CREATE TABLE test_table(
    column_char CHAR(3),
    column_int INT,
    column_num NUMERIC(4, 2)
);

```

## 词法&语法解析

在 `src/backend/parser/scan.l` 中进行**词法分析**，以 `INSERT INTO test_table VALUES('123', 123, 1.23, 123456789123456789, 1.x)` 语句为例：

  
- 字符串  ’123’  识别为 Sconst，即 String Const，**字符串常量**；
  
- 浮点数  1.23  识别为 FCONST，即 Float Const，**浮点数常量**；
  
- 整数  123  识别为 ICONST，即 Integer Const，**整数常量**；
  
- 超过 INT 类型上限的整数  123456789123456789  则无法用 ICONST 表达，在 `process_integer_literal` 函数中会判断数字是否超过了 INT 的范围，超过则识别为 FCONST：

```
……
if (*endptr != '\0' || errno == ERANGE)
{
    /* integer too large (or contains decimal pt), treat it as a float */
    return FCONST;
}
……
return ICONST;

```

  
- “1.x”这个符号**既不能识别为数字常量，也不能识别为字符串，因此词法分析失败，直接报错**：

```
postgres=# INSERT INTO test_table VALUES('123', 123, 1.23, 123456789123456789, 1.x);
ERROR:  syntax error at or near "x"
LINE 1: ...est_table VALUES('123', 123, 1.23, 123456789123456789, 1.x);
                                                                    ^

```

在词法分析之后，再通过 `src/backend/parser/gram.y` 进行**语法解析**。常量通过算术表达式非终结符 `a_expr`（Arithmetic Expression）的相关逻辑来匹配。**根据词法解析阶段给出的类型，分别构造对应的 Const 节点（C 语言结构体）来保存常量值**。

```
AexprConst: Iconst
				{
					$$ = makeIntConst($1, @1);
				}
			| FCONST
				{
					$$ = makeFloatConst($1, @1);
				}
			| Sconst
				{
					$$ = makeStringConst($1, @1);
				}
			| ……

```

## 语义分析

经过之前的词法&语法分析，生成了一棵符合 PostgreSQL 语法规范的语法树，然而**合法的语法树并不一定有合法的语义**。如下所示，我们向 INT 列插入一个字符串，它符合 PostgreSQL 的语法规范，然而它的语义是错误的，插入的类型不符合列的定义。**因此需要对语法树进行进一步的语义分析**。

```
postgres=# INSERT INTO test_table(column_int) VALUES('abc');
ERROR:  invalid input syntax for type integer: "abc"
LINE 1: INSERT INTO test_table(column_int) VALUES('abc');
                                                  ^

```

示例中语义分析报错的函数调用链为：`pg_analyze_and_rewrite->parse_analyze->…->transformInsertRow->transformAssignedExpr->coerce_to_target_type->coerce_type->…->InputFunctionCall->int4in`

其中 `transformAssignedExpr` 函数的大致逻辑为：

  
- **获取原始字符串类型**：从语法解析阶段构造的 Const 节点中获取常量的原始类型，示例中的’abc’是字符串类型；
  
- **获取目标列的类型**：从[pg_attribute](http://postgres.cn/docs/14/catalog-pg-attribute.html)系统表中获取需要插入的列的类型，示例中 column_int 列为 INT 类型；
  
- **将原始类型强转为目标类型**：调用 coerce_to_target_type 函数，强制将输入的字符串’abc’转为该列的 INT 类型。

`coerce_to_target_type` 函数最终调用了 INT 类型的输入函数 `int4in`，转换过程发现字符串’abc’无法转为 INT。可以执行 `SELECT int4in('abc')` 语句直接复现该报错：

```
postgres=# SELECT int4in('abc');
ERROR:  invalid input syntax for type integer: "abc"

```

各种数据类型在语义分析阶段的处理流程是一致的，只是 `InputFunctionCall` 最后调用的转换函数不同：**INT 类型使用 `int4in` 函数、NUMERIC 类型使用 `numeric_in` 函数，CHAR 类型使用 `bpcharin` 函数，VARCHAR 类型使用 `varcharin` 函数……**

几个特殊情况：

  
- 如果语法解析得到的**Const 节点类型与列的目标类型一致**（比如 `INSERT INTO test_table(column_int) VALUES(11)` 向 INT 列插入 INT 值，类型一致），**`coerce_type` 函数会认为不需要转换**，直接返回，这样可以降低一定的转换开销。
  
- 前文提到，词法分析会**把超出 INT 类型上限的整数识别为浮点数（NUMERIC 类型）的常量**。假如目标列的类型是 INT，则 `coerce_type` **函数需要把 NUMERIC 类型的常量转为 INT 类型**。它不会直接像 CHAR 类型那样在语义分析阶段直接调用 `InputFunctionCall->bpcharin` 函数，而是调用 `build_coercion_expression` 函数**构造一个 FuncExpr 节点，在节点中保存 `numeric_int4` 函数，到查询改写阶段再去调用 `numeric_int4` 执行转换**。
  
- 对于有 type mode（比如 CHAR 类型的长度、NUMERIC 类型的精度）的类型，在语义分析阶段并不会检查长度和精度。以 CHAR 类型为例，假如列的定义是 CHAR(3)，而 INSERT 语句插入长度为 5 的字符串’abcde’，在语义分析阶段并不会报错，要到后续的查询改写阶段才会检查 type mode。换句话说：**在语义分析阶段用 `bpcharin` 系列函数转换到目标类型，后续的查询改写阶段再用 `bpchar` 系列函数转换到目标长度和精度。**

`coerce_type` 函数没有把 type mode 值传递到 `bpcharin` 系列函数，所以语义分析时没有检查长度和精度。为什么不能检查呢？如下所示，PostgreSQL 社区代码注释说，如果将 type mode 传下去，可能会根据 type mode 进行隐式类型转换，根据精度进行强制转换，结果可能不符合预期，但是没有具体说明怎么不符合预期，暂未找到更多有效的说明。不过可以确定的是，正因为在这里没有检查 type mode，所以后续的查询改写阶段需要检查。

```
/*
 * For most types we pass typmod -1 to the input routine, because
 * existing input routines follow implicit-coercion semantics for
 * length checks, which is not always what we want here.  Any length
 * constraint will be applied later by our caller.  An exception
 * however is the INTERVAL type, for which we *must* pass the typmod
 * or it won't be able to obey the bizarre SQL-spec input rules. (Ugly
 * as sin, but so is this part of the spec...)
 */

```

## 查询改写

之前的语义分析阶段已经将常量转换到插入列的目标类型，现在**进入优化器的查询改写模块，进一步检查 type mode，也就是类型的长度和精度信息。**

以 `INSERT INTO test_table(column_num) VALUES(123.4);` 为例，在查询优化器中的关键调用路径为：

`pg_plan_query->planner->…->eval_const_expressions_mutator->…->evaluate_expr->…->numeric->apply_typmod`

其中 `eval_const_expressions_mutator` 函数进行常量表达式的转换，对于 NUMERIC 类型，**调用 `numeric->apply_typmod` 检查 type mode**。在如下的示例中，NUMERIC 类型的 type mode 表示的整数长度最多 2 位，而实际插入的整数部分有 3 位，因此报错。

```
postgres=# INSERT INTO test_table(column_num) VALUES(123.4);
ERROR:  numeric field overflow
DETAIL:  A field with precision 4, scale 2 must round to an absolute value less than 10^2.

```

我们比较一下之前的语义分析阶段调用的 `numeric_in` 函数和现在的查询改写阶段调用的 `numeric` 函数：

  
- `numeric_in` 函数输入参数为字符串，输出参数为 numeric 类型，函数作用是**把原始的字符串转为 numeric 类型**；
  
- `numeric` 函数输入和输出参数都是 numeric 类型，但是两者的精度可以不同，函数作用是**把 numeric 类型转换到特定的精度**。

```
postgres=# \df numeric_in
                             List of functions
   Schema   |    Name    | Result data type |  Argument data types
------------+------------+------------------+-----------------------
 pg_catalog | numeric_in | numeric          | cstring, oid, integer

postgres=# \df numeric
                          List of functions
   Schema   |  Name   | Result data type | Argument data types
------------+---------+------------------+---------------------
 pg_catalog | numeric | numeric          | numeric, integer

```

CHAR、VARCHAR 等类型的长度检查逻辑也与 NUMERIC 同理，只是具体调用的检查函数略有不同，分别为 `bpchar`、`varchar` 函数。

## 参数绑定

**并非所有的 SQL 执行都需要进入以上提到的词法分析、语法解析、语义分析、查询改写等模块**，PostgreSQL 支持 Prepared Statement，允许一次 prepare 以后进行多次执行，多次执行过程中可以复用缓存的执行计划，不需要每次都进入解析器和优化器，降低了调用开销。同时这也意味着存在另一条函数调用路径，在这一条路径上**需要检查 Prepared Statement 的参数常量是否合法**。

在真实的业务系统中，Prepared Statement 常通过 Java 来使用。这里为了简单，只给出 SQL 示例：

```
-- 一次prepare
PREPARE insert_values AS INSERT INTO test_table VALUES($1, $2, $3);
-- 多次执行
EXECUTE insert_values('abc', 123, 1.23);
EXECUTE insert_values('abcd', 1234, 1.234);

```

由于 prepare 阶段只声明了参数的占位符$1、$2、$3，还没有传入真正的参数，因此**prepare 阶段无法检查常量的合法性**。

在后续的 execute 阶段传入了真实的参数值，因此**在 execute 阶段进行参数合法性检查**，假如检查不通过，同样也会报错：

```
postgres=# EXECUTE insert_values('abc', 123, 'abc');
ERROR:  invalid input syntax for type numeric: "abc"
LINE 1: EXECUTE insert_values('abc', 123, 'abc');
                                          ^

```

报错时的函数调用链为：`ExecuteQuery->EvaluateParams->coerce_to_target_type->…->OidInputFunctionCall->int4in`

由于每次执行的参数都可能不同，所以**每次进行参数绑定时都调用 `EvaluateParams` 进行合法性检查。与语义分析部分相似的是，这里也调用了 `coerce_to_target_type` 函数来将原始字符串转换为目标列的类型，因此同样可以检测出输入常量与列的类型不匹配的错误**。不过同样也无法检测字段超长的问题，需要等到执行器阶段才能检测。

特殊情况：前文提到过，对于超过 INT 类型范围的整数，会构造一个带有 `numeric_int4` 函数的 FuncExpr 节点，这里的 `EvaluateParams` 函数会调用 FuncExpr 节点中的 `numeric_int4` 函数，尝试将大整数转为 INT 类型。其思路与其他类型调用 `coerce_to_target_type` 函数进行转换是一样的，只是调用的函数有所不同。

此外，**参数绑定阶段还需要为后续的执行器阶段做一些准备工作**：通过 `ExecuteQuery->EvaluateParams->ExecPrepareExprList->ExecPrepareExpr->ExecInitExpr->ExecInitExprRec` 这个调用链，遍历 Prepared Statement 的每一个传入参数，**把参数节点填入执行计划中的 ExprState::d.func.fcinfo_data 字段，并根据参数的类型准备好该类型需要的精度检查和类型转换函数**，比如 NUMERIC 类型调用的是 `numeric` 函数，CHAR 类型调用的是 `bpchar` 函数，等到执行器阶段再去执行这些函数。

## 执行器

对于 Prepared Statement，在前文的参数绑定阶段已经进行了参数类型的合法性检查与类型转换，但是还没有检查参数的精度和长度，**type mode（精度和长度）的检查发生在执行器阶段。**

前文提到，参数绑定阶段已经在执行计划的 ExprState 结构体中保存了一些转换和求值函数，执行器阶段只需要根据执行计划中的信息逐步去执行即可。具体的调用链为：

`ExecuteQuery->…->ExecutePlan->…->ExecModifyTable->…->ExecInterpExpr->numeric->apply_typmod`

`ExecInterpExpr` 函数**按照 ExprState::steps 中的步骤逐个调用 d.func.fcinfo_data 中的函数，将参数转为指定精度，然后插入到表中**。假如有多个参数需要转换，则有多个 step。如果 `numeric`、`bpchar` 等函数在求值、精度转换的过程中发生精度检查失败，同样会报错：

```
postgres=# EXECUTE insert_values('abc', 123, 123.4);
ERROR:  numeric field overflow
DETAIL:  A field with precision 4, scale 2 must round to an absolute value less than 10^2.

```

## 总结

本文简单分析了 PostgreSQL 数据库对 INSERT 语句中常量的合法性检查逻辑，大致分为以下场景：

  
- 语法解析：将常量初步划分为整数、浮点数、字符串等几类，保存到各个类型的 Const 节点，供后续步骤使用。
  
- 对于普通查询：
    
      
- 语义分析：调用 `int4in`、`numeric_in`、`bpcharin` 等函数，将 Const 节点中的原始常量值转为插入列的目标类型（但不检查精度）。
      
- 查询改写：调用 `numeric_int4`、`numeric`、`bpchar` 等函数将数值转换到指定精度或长度。
    
  
  
- 对于 Prepared Statement，不需要经过语义分析、查询改写模块，只需要根据每次绑定参数值并执行：
    
      
- 参数绑定：调用 `int4in`、`numeric_in`、`bpcharin` 等函数，将参数的原始字符串转为插入列的目标类型（但不检查精度）。与普通查询的语义分析阶段高度相似，调用的转换函数也相同。
      
- 执行器：调用 `numeric`、`bpchar` 等函数将参数值转换到指定精度或长度，并插入到表中。与普通查询的查询改写阶段高度相似，调用的转换函数也相同。