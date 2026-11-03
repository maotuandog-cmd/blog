> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Aggregation Pipeline Limits

Aggregation operations with the [`aggregate`](/docs/manual/reference/command/aggregate#mongodb-dbcommand-dbcmd.aggregate) command have the following limitations.

## Result Size Restrictions

The [`aggregate`](/docs/manual/reference/command/aggregate#mongodb-dbcommand-dbcmd.aggregate) command can either return a cursor or store the results in a collection. Each document in the result set is subject to the 16 mebibyte [BSON Document Size limit](/docs/manual/reference/limits#mongodb-limit-BSON-Document-Size). If any single document exceeds the [BSON Document Size limit](/docs/manual/reference/limits#mongodb-limit-BSON-Document-Size), the aggregation produces an error. The limit only applies to the returned documents. During the pipeline processing, the documents may exceed this size. The [`db.collection.aggregate()`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) method returns a cursor by default.

## Number of Stages Restrictions

MongoDB limits the number of [aggregation pipeline stages](/docs/manual/reference/mql/aggregation-stages#std-label-aggregation-pipeline-operator-reference) allowed in a single pipeline to 1000.

If an aggregation pipeline exceeds the stage limit before or after being parsed, you receive an error.

## Memory Restrictions

Starting in MongoDB 6.0, the [`allowDiskUseByDefault`](/docs/manual/reference/parameters#mongodb-parameter-param.allowDiskUseByDefault) parameter controls whether pipeline stages that require more than 100 megabytes of memory to execute write temporary files to disk by default.

- If [`allowDiskUseByDefault`](/docs/manual/reference/parameters#mongodb-parameter-param.allowDiskUseByDefault) is set to `true`, pipeline stages that require more than 100 megabytes of memory to execute write temporary files to disk by default. You can disable writing temporary files to disk for specific `find` or `aggregate` commands using the `{ allowDiskUse: false }` option.

- If [`allowDiskUseByDefault`](/docs/manual/reference/parameters#mongodb-parameter-param.allowDiskUseByDefault) is set to `false`, pipeline stages that require more than 100 megabytes of memory to execute raise an error by default. You can enable writing temporary files to disk for specific `find` or `aggregate` using the `{ allowDiskUse: true }` option.

The [`$search`](https://www.mongodb.com/docs/search/query/aggregation-stages/search/#mongodb-pipeline-pipe.-search) aggregation stage is not restricted to 100 megabytes of RAM because it runs in a separate process.

Examples of stages that can write temporary files to disk when [allowDiskUse](/docs/manual/reference/command/aggregate#std-label-aggregate-cmd-allowDiskUse) is `true` are:

- [`$bucket`](/docs/manual/reference/operator/aggregation/bucket#mongodb-pipeline-pipe.-bucket)

- [`$bucketAuto`](/docs/manual/reference/operator/aggregation/bucketAuto#mongodb-pipeline-pipe.-bucketAuto)

- [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group)

- [`$setWindowFields`](/docs/manual/reference/operator/aggregation/setWindowFields#mongodb-pipeline-pipe.-setWindowFields)

- [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) when the sort operation is not supported by an index

- [`$sortByCount`](/docs/manual/reference/operator/aggregation/sortByCount#mongodb-pipeline-pipe.-sortByCount)

**Note:**

Pipeline stages operate on streams of documents with each pipeline stage taking in documents, processing them, and then outputting the resulting documents.

Some stages can't output any documents until they have processed all incoming documents. These pipeline stages must keep their stage output in RAM until all incoming documents are processed. As a result, these pipeline stages may require more space than the 100 MB limit.

If the results of one of your [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) pipeline stages exceed the limit, consider [adding a $limit stage.](/docs/manual/reference/operator/aggregation/sort#std-label-sort-limit-sequence)

The [profiler log messages](/docs/manual/tutorial/manage-the-database-profiler#std-label-database-profiler) and [diagnostic log messages](/docs/manual/reference/log-messages#std-label-log-messages-ref) includes a `usedDisk` indicator if any aggregation stage wrote data to temporary files due to [memory restrictions.](/docs/manual/core/aggregation-pipeline-limits#std-label-agg-memory-restrictions)
