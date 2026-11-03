> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Aggregation Operations

Aggregation operations process multiple documents and return computed results. You can use aggregation operations to:

- Group values from multiple documents.

- Compute a single result from the grouped data.

- Analyze data changes over time.

- Query the most up-to-date version of your data.

The aggregation operators in MongoDB let you run analytics on your cluster without moving data to another platform.

## Get Started

To perform aggregation operations, you can use:

- [Aggregation pipelines](/docs/manual/aggregation#std-label-aggregation-pipeline-intro), the preferred method.

- [Single purpose aggregation methods](/docs/manual/aggregation#std-label-single-purpose-agg-methods), which have less functionality than an aggregation pipeline.

You can [run aggregation pipelines in the UI](https://www.mongodb.com/docs/atlas/atlas-ui/agg-pipeline/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Aggregation Pipelines

An aggregation pipeline consists of one or more [stages](/docs/manual/reference/mql/aggregation-stages#std-label-aggregation-pipeline-operator-reference) that process documents. These documents can come from a collection, a view, or a specially designed stage.

Each stage performs an operation on the input documents. For example, a stage can [`$filter`](/docs/manual/reference/operator/aggregation/filter#mongodb-expression-exp.-filter) documents, [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) documents, and calculate values. The documents that a stage outputs are then passed to the next stage in the pipeline.

An aggregation pipeline can return results for groups of documents. You can also update documents with an aggregation pipeline using the stages shown in [Updates with Aggregation Pipeline.](/docs/manual/tutorial/update-documents-with-aggregation-pipeline#std-label-updates-agg-pipeline)

**Note:**

Aggregation pipelines run with the [`db.collection.aggregate()`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) method do not modify documents in a collection, unless the pipeline contains a [`$merge`](/docs/manual/reference/operator/aggregation/merge#mongodb-pipeline-pipe.-merge) or [`$out`](/docs/manual/reference/operator/aggregation/out#mongodb-pipeline-pipe.-out) stage.

### Aggregation Pipeline Example

The examples on this page use data from the [sample\_mflix sample dataset](/docs/manual/sample-data/sample-mflix#std-label-sample-mflix). For details on how to load this dataset into your self-managed MongoDB deployment, see [Load the sample dataset](/docs/manual/sample-data/load-sample-data-local#std-label-sample-dataset-local). If you made any modifications to the sample databases, you may need to drop and recreate the databases to run the examples on this page.

The following pipeline finds the top three directors who have directed the most movies in the database.

Use a [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) stage to filter to movies that have directors listed (excluding documents where the directors field is null or empty):

```javascript
{
    $match : {
        "directors" : { $exists: true, $ne: null, $not: {$size: 0} }
    }
},

```

The `$match` stage reduces the number of documents in our pipeline by filtering out movies without director information. Next, use [`$unwind`](/docs/manual/reference/operator/aggregation/unwind#mongodb-pipeline-pipe.-unwind) to deconstruct the directors array so you can count movies per individual director:

```javascript
{
    $unwind : "$directors"
},

```

Use [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) to group documents by director name and count each director's movies:

```javascript
{
    $group : {
    _id : "$directors",
    movieCount : {
        $sum: 1
        }
    }
},

```

Use [`$sort`](/docs/manual/reference/operator/aggregation/sort#mongodb-pipeline-pipe.-sort) to order the remaining documents in descending order by movie count:

```javascript
{
    $sort : {
        movieCount : -1
    }
},

```

Use [`$limit`](/docs/manual/reference/operator/aggregation/limit#mongodb-pipeline-pipe.-limit) to return the top three directors:

```javascript
{
    $limit : 3
}

```

The full pipeline:

```javascript
db.movies.aggregate(
  [
    {
        $match : {
            "directors" : { $exists: true, $ne: null, $not: {$size: 0} }
        }
    },
    {
        $unwind : "$directors"
    },
    {
        $group : {
        _id : "$directors",
        movieCount : {
            $sum: 1
            }
        }
    },
    {
        $sort : {
            movieCount : -1
        }
    },
    {
        $limit : 3
    }
  ]
)

```

The pipeline returns these results:

```javascript
[
  { _id: 'Woody Allen', movieCount: 40 },
  { _id: 'Martin Scorsese', movieCount: 32 },
  { _id: 'Takashi Miike', movieCount: 31 }
]

```

For runnable examples containing sample input documents, see [Complete Aggregation Pipeline Examples.](/docs/manual/core/aggregation-pipeline#std-label-aggregation-pipeline-examples)

To learn more about aggregation pipelines, see [Aggregation Pipeline.](/docs/manual/core/aggregation-pipeline#std-label-aggregation-pipeline)

## Single Purpose Aggregation Methods

Single purpose aggregation methods aggregate documents from a single collection. These methods have less functionality than an aggregation pipeline.

| Method | Description |
| --- | --- |
| [`db.collection.estimatedDocumentCount()`](/docs/manual/reference/method/db.collection.estimatedDocumentCount#mongodb-method-db.collection.estimatedDocumentCount) | Returns an approximate count of the documents in a collection or a view. |
| [`db.collection.count()`](/docs/manual/reference/method/db.collection.count#mongodb-method-db.collection.count) | Returns a count of the number of documents in a collection or a view. |
| [`db.collection.distinct()`](/docs/manual/reference/method/db.collection.distinct#mongodb-method-db.collection.distinct) | Returns an array of documents that have distinct values for the specified field. |
