# PostgreSQL 事件触发器 tag 原理简析

来源: http://mysql.taobao.org/monthly/2024/09/01/
标签: recent

---

在 PostgreSQL 数据库中，Event Trigger（事件触发器）是一种触发机制，用于响应特定的数据库事件。与常规的 DML 触发器（响应行级别或语句级别操作）不同，事件触发器在 DDL 操作的生命周期中触发，触发时执行用户指定的存储过程或函数，可以用于监控或限制数据库结构的变更。
本文对事件触发器的 tag 这个小特性进行简单的原理分析，文中提到的函数和数据结构来源于 [PostgreSQL 15 源码](https://github.com/postgres/postgres/tree/REL_15_STABLE)。

## 简介

创建事件触发器的语法如下，允许使用 `filter_variable` 指定触发条件，确保触发器只在发生某些特定事件时触发。从 PostgreSQL [官方文档](http://postgres.cn/docs/15/sql-createeventtrigger.html)可知，当前 PostgreSQL 唯一支持的 `filter_variable` 是 tag。

```
CREATE EVENT TRIGGER name
    ON event
    [ WHEN filter_variable IN (filter_value [, ... ]) [ AND ... ] ]
    EXECUTE { FUNCTION | PROCEDURE } function_name()

```

通过一个示例来说明 tag 的用法。PostgreSQL 中有 `ddl_command_start`、`ddl_command_end`、`table_rewrite` 和 `sql_drop` 这四种事件类型，我们全文都以 `ddl_command_start` 事件为例，其他事件的处理逻辑是类似的。

假设有下面这样一个触发器函数，打印触发时的 DDL 事件名称（实际业务场景中可以将函数逻辑替换为业务逻辑），我们基于它创建两个事件触发器。

```
CREATE OR REPLACE FUNCTION log_ddl_commands()
RETURNS EVENT_TRIGGER AS $$
BEGIN
  RAISE NOTICE 'DDL Command: %', tg_tag;
END;
$$ LANGUAGE PLpgSQL;

```

第一个触发器的触发时机为 `ddl_command_start`，在 DDL 命令开始时触发，对所有 DDL 都有效。

```
CREATE EVENT TRIGGER ddl_command_logger
ON ddl_command_start
EXECUTE FUNCTION log_ddl_commands();

```

第二个触发器使用了 `WHEN TAG IN ('CREATE TABLE', 'CREATE INDEX')` 条件，它指定的 tag 为 `CREATE TABLE` 和 `CREATE INDEX`，因此触发器只在创建表、创建索引时触发，这属于 DDL 的一个很小的子集，可以实现**按照 DDL 细分类型精准触发**。

```
CREATE EVENT TRIGGER create_command_logger
ON ddl_command_start
WHEN TAG IN ('CREATE TABLE', 'CREATE INDEX')
EXECUTE FUNCTION log_ddl_commands();

```

## tag 检查与保存

### 语法解析

在 gram.y 中进行语法解析，`CREATE EVENT TRIGGER` 相关逻辑如下，构建一个 `CreateEventTrigStmt` 结构体，tag 相关的表达式保存到 **CreateEventTrigStmt->whenclause** 中。

```
CreateEventTrigStmt:
  ……
  | CREATE EVENT TRIGGER name ON ColLabel
    WHEN event_trigger_when_list
    EXECUTE FUNCTION_or_PROCEDURE func_name '(' ')'
        {
            CreateEventTrigStmt *n = makeNode(CreateEventTrigStmt);
            n->whenclause = $8;
            ……
        }

```

语法解析器最终生成一棵语法树，在 PostgreSQL 中通常称为 parse tree。

### tag 合法性校验

`standard_ProcessUtility` 函数会处理各种 DDL 命令的 parse tree，对于 `CreateEventTrigStmt` 类型的 parse tree，调用 **CreateEventTrigger** 函数进行处理。

由于用户在 `CREATE EVENT TRIGGER` 语法中指定的 tag 可能是任意字符串，所以 `CreateEventTrigger` 函数需要调用 **validate_ddl_tags** 判断 `CreateEventTrigStmt->whenclause` 中的 tag 字符串是否合法。那么具体哪些 tag 是合法的呢？这个信息保存在 **tag_behavior** 数组中，数组的定义在 `tcop/cmdtaglist.h` 头文件中，所有的 tag 按照字典序排列。

```
static const CommandTagBehavior tag_behavior[COMMAND_TAG_NEXTTAG] = {
#include "tcop/cmdtaglist.h"
};

```

`tcop/cmdtaglist.h` 中包含了 PostgreSQL 支持的所有 DDL 对应的 tag，当前一共 191 种，部分 tag 定义如下，其中第 1 个字段是宏名，第 2、3、4、5 个字段依次保存到 `CommandTagBehavior` 结构。

```
PG_CMDTAG(CMDTAG_CREATE_STATISTICS, "CREATE STATISTICS", true, false, false)
PG_CMDTAG(CMDTAG_CREATE_SUBSCRIPTION, "CREATE SUBSCRIPTION", true, false, false)
PG_CMDTAG(CMDTAG_CREATE_TABLE, "CREATE TABLE", true, false, false)

```

```
typedef struct CommandTagBehavior
{
	const char *name;
	const bool	event_trigger_ok;
	const bool	table_rewrite_ok;
	const bool	display_rowcount;
} CommandTagBehavior;

```

`CommandTagBehavior->event_trigger_ok` 表示该 DDL 是否支持事件触发器，当前有 122/191 种 DDL 是允许事件触发器的。

介绍完了 `tag_behavior` 数组的定义，我们再回到前面的 `validate_ddl_tags` 函数，它需要判断用户在 `CREATE EVENT TRIGGER` 命令中指定的 tag 是否合法，就需要去 `tag_behavior` 数组中查找该 tag。由于该数组的长度为 191，为了提升查找性能，在 `GetCommandTagEnum` 函数中**使用二分查找**，这样做的前提是数组中所有 tag 按照字典序排列。假如没有找到，直接报错：

```
postgres=# CREATE EVENT TRIGGER invalid_command_logger
ON ddl_command_start
WHEN TAG IN ('invalid tag1', 'invalig tag2')
EXECUTE FUNCTION log_ddl_commands();
ERROR:  filter value "invalid tag1" not recognized for filter variable "tag"

```

从数组中找到 tag 以后，还需要进一步判断它的 **CommandTagBehavior->event_trigger_ok** 是否为 true，如果为 false，则表示该 DDL 命令不支持事件触发器，也需要报错，比如 `REINDEX` 命令：

```
postgres=# CREATE EVENT TRIGGER invalid_command_logger
ON ddl_command_start
WHEN TAG IN ('REINDEX')
EXECUTE FUNCTION log_ddl_commands();
ERROR:  event triggers are not supported for REINDEX

```

部分 DDL 为何不支持事件触发器，暂时没有去探究，推测是没有实际应用场景或实现上有难度。

### tag 保存

如果以上合法性检查通过，`CreateEventTrigger` 函数最终通过调用 **insert_event_trigger_tuple** 将事件触发器的各项信息持久化到 [**pg_catalog.pg_event_trigger**](http://postgres.cn/docs/15/catalog-pg-event-trigger.html) **系统表**，其中 **evttags** 字段中保存 tag 的名称，如果没有指定 tag，则为空。

```
postgres=# SELECT evtname, evttags FROM pg_catalog.pg_event_trigger;
        evtname        |             evttags
-----------------------+---------------------------------
 ddl_command_logger    |
 create_command_logger | {"CREATE TABLE","CREATE INDEX"}
(2 rows)

```

## tag 匹配与触发

### 效果验证

前面我们创建了两个事件触发器，一个对所有 DDL 触发，一个对 `CREATE TABLE`、`CREATE INDEX` 这两种 tag 触发，我们测试一下它的效果。

如下所示，执行 `CREATE TABLE` 和 `CREATE INDEX`，两个触发器同时触发，打印了两条信息：

```
postgres=# CREATE TABLE test_table(a INT);
NOTICE:  DDL Command: CREATE TABLE
NOTICE:  DDL Command: CREATE TABLE
CREATE TABLE

postgres=# CREATE INDEX ON test_table(a);
NOTICE:  DDL Command: CREATE INDEX
NOTICE:  DDL Command: CREATE INDEX
CREATE INDEX

```

执行 `DROP TABLE`，只打印一条信息，因为指定了 tag 的触发器此时不会触发，`DROP TABLE` 与我们指定的 tag 不匹配。

```
postgres=# DROP TABLE test_table;
NOTICE:  DDL Command: DROP TABLE
DROP TABLE

```

### 触发逻辑

在 DDL 命令执行过程中，如何精准触发与该命令匹配的触发器？由于 **ProcessUtilitySlow** 是所有 DDL 命令的处理入口，所以 PostgreSQL 很自然地将事件触发器的处理逻辑放在了这里。

在 `ProcessUtilitySlow` 的开头调用 **EventTriggerDDLCommandStart** 函数处理 `ddl_command_start` 事件类型的触发器，在结尾处调用 `EventTriggerDDLCommandEnd` 函数处理 `ddl_command_end` 事件类型的触发器。

我们以 `EventTriggerDDLCommandStart` 为例，它会调用 **EventTriggerCommonSetup** 查找当前 DDL 命令对应的 tag 的所有触发器，返回触发器需要执行的函数列表：

  
- 调用 `CreateCommandTag`，从 parse tree 获取当前 DDL 命令的 tag 类型，判断该 tag 的 `CommandTagBehavior->event_trigger_ok` 是否为 true，不为 true 则报错。
    
      
- 其实在之前的 `CreateEventTrigger` 函数中已经进行过相关判断了，不为 true 的情况根本就无法创建成功，如果一切运行正常，那么这里的检查是不需要的。不过这里还是进行了二次检查，防止在某些 bug 场景下发生了 tag 不符合预期的情况。
      
- 考虑到这个额外的检查是有性能开销的，所以这部分代码只会在 PostgreSQL 内核开发者常用的 debug 模式下运行，在实际的生产环境中不会运行，通过 `USE_ASSERT_CHECKING` 宏来控制。
    
  
  
- 调用 **EventCacheLookup** 从缓存中查找该事件类型对应的触发器列表 cachelist，前面我们定义了两个 `ddl_command_start` 触发器，所以列表长度为 2。
  
- 遍历 cachelist 中的所有触发器，逐个调用 **filter_event_trigger 根据 tag 过滤**出与当前 DDL 事件的 tag 匹配的触发器。

`EventTriggerCommonSetup` 返回的 runlist 是触发器需要执行的函数的 oid 列表，最终交给 `EventTriggerInvoke` 去执行。

### Event Trigger Cache

上一节提到，`EventTriggerDDLCommandStart` 函数调用 `EventCacheLookup` 去查找 `ddl_command_end` 事件的所有触发器，这里的 cache 就是 Event Trigger Cache。

#### 缓存结构

Event Trigger Cache 是内存中的一个哈希表：

```
static HTAB *EventTriggerCache;

```

  
- 哈希表的 **key 是事件类型**（包括`ddl_command_start`、`ddl_command_end`、 `table_rewrite`和`sql_drop`）
  
- 哈希表的 **value 是 EventTriggerCacheEntry 的链表**，表示该事件类型下的多个触发器，每个触发器的 `EventTriggerCacheEntry` 节点都包含该触发器执行的函数 oid、触发器的 tag 等信息

```
+-------------------+------------------------------------------------------+
|       Key         |                      Value                           |
+-------------------+------------------------------------------------------+
| ddl_command_start | [EventTriggerCacheEntry] -> [EventTriggerCacheEntry] |
|                   |     fnoid: function_oid_1  |   fnoid: function_oid_2 |
|                   |     tagset: {tag1, tag2}   |   tagset: {tag3}        |
|                   |------------------------------------------------------|
| ddl_command_end   | [EventTriggerCacheEntry]                             |
|                   |     fnoid: function_oid_3                            |
|                   |     tagset: {tag4, tag5}                             |
|                   |------------------------------------------------------|
| table_rewrite     | [EventTriggerCacheEntry] -> [EventTriggerCacheEntry] |
|                   |     fnoid: function_oid_4  |   fnoid: function_oid_5 |
|                   |     tagset: {tag6}         |    tagset: {}           |
|                   |------------------------------------------------------|
| sql_drop          | [EventTriggerCacheEntry]                             |
|                   |     fnoid: function_oid_6                            |
|                   |     tagset: {tag7}                                   |
+-------------------+------------------------------------------------------+

```

#### 缓存构建

首次调用 `EventCacheLookup` 查找 cache 时，发现 cache 为空，就会调用 **BuildEventTriggerCache** 构建 cache，它从 `pg_catalog.pg_event_trigger` 系统表中读取出所有的行，逐行构建 `EventTriggerCacheEntry` 结构体。

evtevent 字段可能有四种取值（`ddl_command_start`、`ddl_command_end`、 `table_rewrite` 和 `sql_drop`），对应哈希表的四种 key，根据该值决定将新结构体存入哈希表的哪个 key 的 `EventTriggerCacheEntry` 链表中。

#### 缓存查找

使用哈希表缓存时实际分为两次查找：

  
- **事件类型过滤**：`EventCacheLookup` 根据 key 的取值从哈希表中找到该事件类型对应的触发器链表，这一步可以从 `ddl_command_start`、`ddl_command_end`、`table_rewrite` 和 `sql_drop` 这 4 种事件类型中找出与之匹配的那一种事件。
  
- **tag 过滤**：由于每一种事件类型都可能有多个触发器，所以 `EventTriggerCommonSetup` 需要再遍历链表中的每一个 `EventTriggerCacheEntry` 结构，根据其中的 tagset 字段判断 tag 是否匹配，过滤掉 tag 不匹配的触发器。

#### 性能优化

前面我们提到，tag 在 `pg_catalog.pg_event_trigger` 系统表中存储的是原始字符串，而哈希表缓存中的 tagset 就是从该系统表读出并构建的。

```
postgres=# SELECT evtname, evttags FROM pg_catalog.pg_event_trigger;
        evtname        |             evttags
-----------------------+---------------------------------
 ddl_command_logger    |
 create_command_logger | {"CREATE TABLE","CREATE INDEX"}
(2 rows)

```

如果我们需要通过字符串来判断 tag 是否匹配，主要有两个问题：

  
- 假如 tag 很多（最多可以同时指定 100 多种 tag），则内存中需要保存所有的这些 tag 字符串，带来额外的内存占用开销；
  
- 每一次触发之前都需要将当前 DDL 命令的 tag 与哈希表中的多个 tag 进行字符串全文匹配，带来额外的计算开销。

为了解决这一问题，PostgreSQL 使用了 Bitmapset 来优化：

  
- `BuildEventTriggerCache` 读取 `pg_catalog.pg_event_trigger` 系统表并构建哈希表时，会调用 `DecodeTextArrayToBitmapset` 将 evttags 中的 tag 字符串转为 Bitmapset。前面提到过所有的 tag 都在 `tcop/cmdtaglist.h` 中定义了对应的宏，每个 tag 的宏都是一个唯一的数字，这些数字很方便构造 **Bitmapset**，空间占用比字符串少。
  
- `EventTriggerCommonSetup->filter_event_trigger` 中使用 **bms_is_member** 来判断 tag 是否在 Bitmapset 中，比较速度比全文匹配要快。