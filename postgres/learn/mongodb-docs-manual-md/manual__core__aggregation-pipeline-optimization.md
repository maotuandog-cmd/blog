> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Aggregation Pipeline Optimization

Aggregation pipeline operations have an optimization phase that reshapes the pipeline for improved performance.

To see how the optimizer transforms a pipeline, include the [`explain`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) option in the [`db.collection.aggregate()`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) method.

Optimizations are subject to change between releases.

This page also describes how to improve performance using [indexes and document filters.](/docs/manual/core/aggregation-pipeline-optimization#std-label-aggregation-pipeline-optimization-indexes-and-filters)

You can [run aggregation pipelines in the UI](https://www.mongodb.com/docs/atlas/atlas-ui/agg-pipeline/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Projection Optimization

The aggregation pipeline can determine if it requires only a subset of the fields in the documents to obtain the results. If so, the pipeline only uses those fields, reducing the amount of data passing through the pipeline.

### `$project` Stage Placement

When you use a [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) stage it should typically be the last stage in your pipeline, used to specify which fields to return to the client.

Using a `$project` stage at the beginning or middle of a pipeline to reduce the number of fields passed to subsequent pipeline stages is unlikely to improve performance, because the database performs this optimization automatically.

## Pipeline Sequence Optimization

### (`$project` or `$unset` or `$addFields` or `$set`) + `$match` Sequence Optimization

For an aggregation pipeline that contains a projection stage ([`$addFields`](/docs/manual/reference/operator/aggregation/addFields#mongodb-pipeline-pipe.-addFields), [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project), [`$set`](/docs/manual/reference/operator/aggregation/set#mongodb-pipeline-pipe.-set), or [`$unset`](/docs/manual/reference/operator/aggregation/unset#mongodb-pipeline-pipe.-unset)) followed by a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage, MongoDB moves any filters in the `$match` stage that do not require values computed in the projection stage to a new `$match` stage before the projection.

If an aggregation pipeline contains multiple projection or `$match` stages, MongoDB performs this optimization for each `$match` stage, moving each `$match` filter before all projection stages that the filter does not depend on.

Consider a pipeline with the following stages:

```javascript
{
   $addFields: {
      maxTime: { $max: "$times" },
      minTime: { $min: "$times" }
   }
},
{
   $project: {
      _id: 1,
      name: 1,
      times: 1,
      maxTime: 1,
      minTime: 1,
      avgTime: { $avg: ["$maxTime", "$minTime"] }
   }
},
{
   $match: {
      name: "Joe Schmoe",
      maxTime: { $lt: 20 },
      minTime: { $gt: 5 },
      avgTime: { $gt: 7 }
   }
}
```

The optimizer breaks up the `$match` stage into four individual filters, one for each key in the `$match` query document. The optimizer then moves each filter before as many projection stages as possible, creating new `$match` stages as needed.

Given this example, the optimizer automatically produces the following *optimized* pipeline:

```javascript
{ $match: { name: "Joe Schmoe" } },
{ $addFields: {
    maxTime: { $max: "$times" },
    minTime: { $min: "$times" }
} },
{ $match: { maxTime: { $lt: 20 }, minTime: { $gt: 5 } } },
{ $project: {
    _id: 1, name: 1, times: 1, maxTime: 1, minTime: 1,
    avgTime: { $avg: ["$maxTime", "$minTime"] }
} },
{ $match: { avgTime: { $gt: 7 } } }
```

**Note:**

The optimized pipeline is not intended to be run manually. The original and optimized pipelines return the same results.

You can see the optimized pipeline in the [explain plan.](/docs/manual/reference/method/db.collection.aggregate#std-label-example-aggregate-method-explain-option)

The [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) filter `{ avgTime: { $gt: 7 } }` depends on the [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) stage to compute the `avgTime` field. The [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) stage is the last projection stage in this pipeline, so the [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) filter on `avgTime` could not be moved.

The `maxTime` and `minTime` fields are computed in the [`$addFields`](/docs/manual/reference/operator/aggregation/addFields#mongodb-pipeline-pipe.-addFields) stage but have no dependency on the [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) stage. The optimizer created a new [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage for the filters on these fields and placed it before the [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) stage.

The [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) filter `{ name: "Joe Schmoe" }` does not use any values computed in either the [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) or [`$addFields`](/docs/manual/reference/operator/aggregation/addFields#mongodb-pipeline-pipe.-addFields) stages so it was moved to a new [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage before both of the projection stages.

After optimization, the filter `{ name: "Joe Schmoe" }` is in a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage at the beginning of the pipeline. This has the added benefit of allowing the aggregation to use an index on the `name` field when initially querying the collection.

### `$sort` + `$match` Sequence Optimization

When you have a sequence with [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) followed by a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match), the [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) moves before the [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) to minimize the number of objects to sort. For example, if the pipeline consists of the following stages:

```javascript
{ $sort: { age : -1 } },
{ $match: { status: 'A' } }
```

During the optimization phase, the optimizer transforms the sequence to the following:

```javascript
{ $match: { status: 'A' } },
{ $sort: { age : -1 } }
```

### `$redact` + `$match` Sequence Optimization

When a [`$redact`](/docs/manual/reference/operator/aggregation/redact#mongodb-pipeline-pipe.-redact) stage is immediately followed by a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match), the optimizer can sometimes add a portion of the `$match` before the `$redact`. If the added `$match` is at the start of the pipeline, the aggregation can use an index and query the collection to limit the documents that enter the pipeline. See [Improve Performance with Indexes and Document Filters.](/docs/manual/core/aggregation-pipeline-optimization#std-label-aggregation-pipeline-optimization-indexes-and-filters)

For example, if the pipeline consists of the following stages:

```javascript
{ $redact: { $cond: { if: { $eq: [ "$level", 5 ] }, then: "$$PRUNE", else: "$$DESCEND" } } },
{ $match: { year: 2014, category: { $ne: "Z" } } }
```

The optimizer can add the same [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage before the [`$redact`](/docs/manual/reference/operator/aggregation/redact#mongodb-pipeline-pipe.-redact) stage:

```javascript
{ $match: { year: 2014 } },
{ $redact: { $cond: { if: { $eq: [ "$level", 5 ] }, then: "$$PRUNE", else: "$$DESCEND" } } },
{ $match: { year: 2014, category: { $ne: "Z" } } }
```

### `$project`/`$unset` + `$skip` Sequence Optimization

When you have a sequence with [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project) or [`$unset`](/docs/manual/reference/operator/aggregation/unset#mongodb-pipeline-pipe.-unset) followed by [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip), the [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) moves before [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project). For example, if the pipeline consists of the following stages:

```javascript
{ $sort: { age : -1 } },
{ $project: { status: 1, name: 1 } },
{ $skip: 5 }
```

During the optimization phase, the optimizer transforms the sequence to the following:

```javascript
{ $sort: { age : -1 } },
{ $skip: 5 },
{ $project: { status: 1, name: 1 } }
```

## Pipeline Coalescence Optimization

When possible, the optimization phase coalesces a pipeline stage into its predecessor. Generally, coalescence occurs *after* any sequence reordering optimization.

### `$sort` + `$limit` Coalescence

When a [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) precedes a [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit), the optimizer can coalesce the `$limit` into the `$sort` if no intervening stages modify the number of documents (for example, [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) or [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group)). MongoDB does not coalesce the `$limit` into the `$sort` if intervening stages change the document count.

For example, if the pipeline consists of the following stages:

```javascript
{ $sort : { age : -1 } },
{ $project : { age : 1, status : 1, name : 1 } },
{ $limit: 5 }
```

During the optimization phase, the optimizer coalesces the sequence to the following:

```javascript
{
    "$sort" : {
       "sortKey" : {
          "age" : -1
       },
       "limit" : Long(5)
    }
},
{ "$project" : {
         "age" : 1,
         "status" : 1,
         "name" : 1
  }
}
```

This allows the sort operation to only maintain the top `n` results as it progresses, where `n` is the specified limit, and MongoDB only needs to store `n` items in memory . See [`$sort` Operator and Memory](/docs/manual/reference/operator/aggregation/sort#std-label-sort-and-memory) for more information.

**Note: Sequence Optimization with $skip**

If a [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) stage sits between the [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) and [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) stages, MongoDB coalesces the `$limit` into the `$sort` and increases the `$limit` value by the `$skip` amount. See [`$sort` + `$skip` + `$limit` Sequence](/docs/manual/core/aggregation-pipeline-optimization#std-label-agg-sort-skip-limit-sequence) for an example.

The optimization still applies when `allowDiskUse` is `true` and the `n` items exceed the [aggregation memory limit.](/docs/manual/core/aggregation-pipeline-limits#std-label-agg-memory-restrictions)

### `$limit` + `$limit` Coalescence

When a [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) immediately follows another [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit), the two stages can coalesce into a single [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) where the limit amount is the *smaller* of the two initial limit amounts. For example, a pipeline contains the following sequence:

```javascript
{ $limit: 100 },
{ $limit: 10 }
```

Then the second [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) stage can coalesce into the first [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) stage and result in a single [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) stage where the limit amount `10` is the minimum of the two initial limits `100` and `10`.

```javascript
{ $limit: 10 }
```

### `$skip` + `$skip` Coalescence

When a [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) immediately follows another [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip), the two stages can coalesce into a single [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) where the skip amount is the *sum* of the two initial skip amounts. For example, a pipeline contains the following sequence:

```javascript
{ $skip: 5 },
{ $skip: 2 }
```

Then the second [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) stage can coalesce into the first [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) stage and result in a single [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) stage where the skip amount `7` is the sum of the two initial limits `5` and `2`.

```javascript
{ $skip: 7 }
```

### `$match` + `$match` Coalescence

When a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) immediately follows another [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match), the two stages can coalesce into a single [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) combining the conditions with an [`$and`](/docs/manual/reference/operator/aggregation/and#mongodb-expression-exp.-and). For example, a pipeline contains the following sequence:

```javascript
{ $match: { year: 2014 } },
{ $match: { status: "A" } }
```

Then the second [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage can coalesce into the first [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage and result in a single [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage

```javascript
{ $match: { $and: [ { "year" : 2014 }, { "status" : "A" } ] } }
```

### `$lookup`, `$unwind`, and `$match` Coalescence

When [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) immediately follows [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup), and the [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) operates on the `as` field of the [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup), the optimizer coalesces the [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) into the [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup) stage. This avoids creating large intermediate documents. Furthermore, if [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) is followed by a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) on any `as` subfield of the [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup), the optimizer also coalesces the [`$match`.](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match)

For example, a pipeline contains the following sequence:

```javascript
{
   $lookup: {
     from: "otherCollection",
     as: "resultingArray",
     localField: "x",
     foreignField: "y"
   }
},
{ $unwind: "$resultingArray"  },
{ $match: {
    "resultingArray.foo": "bar"
  }
}
```

The optimizer coalesces the [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) and [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stages into the [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup) stage. If you run the aggregation with `explain` option, the `explain` output shows the coalesced stages:

```javascript
{
   $lookup: {
     from: "otherCollection",
     as: "resultingArray",
     localField: "x",
     foreignField: "y",
     let: {},
     pipeline: [
       {
         $match: {
           "foo": {
             "$eq": "bar"
           }
         }
       }
     ],
     unwinding: {
       "preserveNullAndEmptyArrays": false
     }
   }
}
```

You can see this optimized pipeline in the [explain plan.](/docs/manual/reference/method/db.collection.aggregate#std-label-example-aggregate-method-explain-option)

The `unwinding` field shown in the previous `explain` output differs from the `$unwind` stage. The `unwinding` field shows how the pipeline is internally optimized. The `$unwind` stage deconstructs an array field from the input documents and outputs a document for each element.

## Slot-Based Query Execution Engine Pipeline Optimizations

MongoDB can use the [slot-based query execution engine](/docs/manual/reference/sbe#std-label-sbe-landing) to execute certain pipeline stages when specific conditions are met. In most cases, the slot-based execution engine provides improved performance and reduced CPU and memory costs compared to the classic query engine.

To verify that the slot-based execution engine is used, run the aggregation with the `explain` option. This option outputs information on the aggregation's query plan. For more information on using `explain` with aggregations, see [Return Information on Aggregation Pipeline Operation.](/docs/manual/reference/method/db.collection.aggregate#std-label-example-aggregate-method-explain-option)

The following sections describe:

- The conditions when the slot-based execution engine is used for aggregation.

- How to verify if the slot-based execution engine was used.

### `$group` Optimization

**New in version 5.2**

Starting in version 5.2, MongoDB uses the [slot-based execution query engine](/docs/manual/reference/sbe#std-label-sbe-landing) to execute [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stages if either:

- `$group` is the first stage in the pipeline.

- All preceding stages in the pipeline can also be executed by the slot-based execution engine.

When the slot-based query execution engine is used for [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group), the [explain results](/docs/manual/reference/explain-results#std-label-explain-results) include `queryPlanner.winningPlan.queryPlan.stage:
"GROUP"`.

The location of the `queryPlanner` object depends on whether the pipeline contains stages after the `$group` stage that cannot be executed using the slot-based execution engine.

- If `$group` is the last stage or all stages after `$group` can be executed using the slot-based execution engine, the `queryPlanner` object is in the top-level `explain` output object (`explain.queryPlanner`).

- If the pipeline contains stages after `$group` that cannot be executed using the slot-based execution engine, the `queryPlanner` object is in `explain.stages[0].$cursor.queryPlanner`.

### `$lookup` Optimization

**New in version 6.0**

Starting in version 6.0, MongoDB can use the [slot-based execution query engine](/docs/manual/reference/sbe#std-label-sbe-landing) to execute [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup) stages if *all* preceding stages in the pipeline can also be executed by the slot-based execution engine and none of the following conditions are true:

- The `$lookup` operation executes a pipeline on a foreign collection. To see an example of this kind of operation, see [Join Conditions and Subqueries on a Foreign Collection.](/docs/manual/reference/operator/aggregation/lookup#std-label-lookup-syntax-let-pipeline)

- The `$lookup`'s `localField` or `foreignField` specify numeric components. For example: `{ localField: "restaurant.0.review" }`.

- The `from` field of any `$lookup` in the pipeline specifies a view or sharded collection.

When the slot-based query execution engine is used for [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup), the [explain results](/docs/manual/reference/explain-results#std-label-explain-results) include `queryPlanner.winningPlan.queryPlan.stage: "EQ_LOOKUP"`. `EQ_LOOKUP` means "equality lookup".

The location of the `queryPlanner` object depends on whether the pipeline contains stages after the `$lookup` stage that cannot be executed using the slot-based execution engine.

- If `$lookup` is the last stage or all stages after `$lookup` can be executed using the slot-based execution engine, the `queryPlanner` object is in the top-level `explain` output object (`explain.queryPlanner`).

- If the pipeline contains stages after `$lookup` that cannot be executed using the slot-based execution engine, the `queryPlanner` object is in `explain.stages[0].$cursor.queryPlanner`.

## Improve Performance with Indexes and Document Filters

The following sections show how you can improve aggregation performance using indexes and document filters.

### Indexes

An aggregation pipeline can use [indexes](/docs/manual/indexes#std-label-indexes) from the input collection to improve performance. Using an index limits the amount of documents a stage processes. Ideally, an index can [cover](/docs/manual/core/query-optimization#std-label-read-operations-covered-query) the stage query. A covered query has especially high performance, since the index returns all matching documents.

For example, a pipeline that consists of [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match), [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort), [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) can benefit from indexes at every stage:

- An index on the `$match` query field efficiently identifies the relevant data

- An index on the sorting field returns data in sorted order for the `$sort` stage

- An index on the grouping field that matches the `$sort` order returns all of the field values needed for the `$group` stage, making it a covered query.

To determine whether a pipeline uses indexes, review the query plan and look for `IXSCAN` or `DISTINCT_SCAN` plans.

**Note:**

In some cases, the query planner uses a `DISTINCT_SCAN` index plan that returns one document per index key value. `DISTINCT_SCAN` executes faster than `IXSCAN` if there are multiple documents per key value. However, index scan parameters might affect the time comparison of `DISTINCT_SCAN` and `IXSCAN`.

For early stages in your aggregation pipeline, consider indexing the query fields. Stages that can benefit from indexes are:

[`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage

During the `$match` stage, the server can use an index if `$match` is the first stage in the pipeline, after any optimizations from the [query planner.](/docs/manual/core/query-plans#std-label-query-plans-query-optimization)

[`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) stage

During the `$sort` stage, the server can use an index if the stage is not preceded by a [`$project`](/docs/manual/reference/operator/aggregation/project#mongodb-pipeline-pipe.-project), [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind), or [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stage.

[`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stage

During the `$group` stage, the server can use an index to quickly find the [`$first`](/docs/manual/reference/operator/aggregation/first#mongodb-group-grp.-first) or [`$last`](/docs/manual/reference/operator/aggregation/last#mongodb-group-grp.-last) document in each group if the stage meets both of these conditions:

- The pipeline [`sorts`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) and [`groups`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) by the same field.

- The `$group` stage only uses the [`$first`](/docs/manual/reference/operator/aggregation/first#mongodb-group-grp.-first) or [`$last`](/docs/manual/reference/operator/aggregation/last#mongodb-group-grp.-last) accumulator operator.

See [$group Performance Optimizations](/docs/manual/reference/operator/aggregation/group#std-label-group-pipeline-optimization) for an example.

[`$geoNear`](/docs/manual/reference/operator/aggregation/geoNear#mongodb-pipeline-pipe.-geoNear) stage

The server always uses an index for the `$geoNear` stage, since it requires a [geospatial index.](/docs/manual/geospatial-queries#std-label-index-feature-geospatial)

Additionally, stages later in the pipeline that retrieve data from other, unmodified collections can use indexes on those collections for optimization. These stages include:

- [`$lookup`](/docs/manual/reference/operator/aggregation/lookup#mongodb-pipeline-pipe.-lookup)

- [`$graphLookup`](/docs/manual/reference/operator/aggregation/graphLookup#mongodb-pipeline-pipe.-graphLookup)

- [`$unionWith`](/docs/manual/reference/operator/aggregation/unionWith#mongodb-pipeline-pipe.-unionWith)

### Document Filters

If your aggregation operation requires only a subset of the documents in a collection, filter the documents first:

- Use the [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match), [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit), and [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) stages to restrict the documents that enter the pipeline.

- When possible, put [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) at the beginning of the pipeline to use indexes that scan the matching documents in a collection.

- [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) followed by [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) at the start of the pipeline is equivalent to a single query with a sort, and can use an index.

## Example

### `$sort` + `$skip` + `$limit` Sequence

A pipeline contains a sequence of [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) followed by a [`$skip`](/docs/manual/reference/operator/aggregation/skip#mongodb-pipeline-pipe.-skip) followed by a [`$limit`:](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit)

```javascript
{ $sort: { age : -1 } },
{ $skip: 10 },
{ $limit: 5 }
```

The optimizer performs [`$sort` + `$limit` Coalescence](/docs/manual/core/aggregation-pipeline-optimization#std-label-agg-sort-limit-coalescence) to transforms the sequence to the following:

```javascript
{
   "$sort" : {
      "sortKey" : {
         "age" : -1
      },
      "limit" : Long(15)
   }
},
{
   "$skip" : Long(10)
}
```

MongoDB increases the [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) amount with the reordering.

**See also:**

[`explain`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) option in the [`db.collection.aggregate()`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate)
