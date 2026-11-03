> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Indexes

Indexes support efficient execution of queries in MongoDB. Without indexes, MongoDB must scan every document in a collection to return query results. If an appropriate index exists for a query, MongoDB uses the index to limit the number of documents it must scan.

Although indexes improve query performance, adding an index has negative performance impact for write operations. For collections with a high write-to-read ratio, indexes are expensive because each insert must also update any indexes.

## Use Cases

If your application repeatedly runs queries on the same fields, create an index on those fields to improve performance. For example, consider the following scenarios:

| Scenario | Index Type |
| --- | --- |
| A human resources department often needs to look up employees by employee ID. You can create an index on the employee ID field to improve query performance. | [Single Field Index](/docs/manual/core/indexes/index-types/index-single#std-label-indexes-single-field) |
| A salesperson often needs to look up client information by location. Location is stored in an embedded object with fields like `state`, `city`, and `zipcode`. You can create an index on the `location` object to improve performance for queries on that object. When you create an index on an embedded document, only queries that specify the entire embedded document use the index. Queries on a specific field within the document do not use the index. | [Single Field Index](/docs/manual/core/indexes/index-types/index-single#std-label-indexes-single-field) on an embedded document |
| A grocery store manager often needs to look up inventory items by name and quantity to determine which items are low stock. You can create a single index on both the `item` and `quantity` fields to improve query performance. | [Compound Index](/docs/manual/core/indexes/index-types/index-compound#std-label-index-type-compound) |

## Get Started

You can create and manage indexes in [MongoDB Atlas](https://www.mongodb.com/docs/atlas), with a driver method, or with the MongoDB Shell.

### Create and Manage Indexes in MongoDB Atlas

For deployments hosted in MongoDB Atlas, you can create and manage indexes with the MongoDB Atlas UI or the Atlas CLI. MongoDB Atlas also includes a Performance Advisor that recommends indexes to improve slow queries, ranks suggested indexes by impact, and recommends which indexes to drop.

To learn how to create and manage indexes using the MongoDB Atlas UI or the Atlas CLI, see [Create, View, Drop, and Hide Indexes.](https://www.mongodb.com/docs/atlas/atlas-ui/indexes/)

To learn more about the MongoDB Atlas Performance Advisor, see [Monitor and Improve Slow Queries.](https://www.mongodb.com/docs/atlas/performance-advisor/)

### Create and Manage Indexes with a Driver Method or the MongoDB Shell

You can create and manage indexes with a driver method or the MongoDB Shell. To learn more, see the following resources:

- [Create an Index](/docs/manual/core/indexes/create-index#std-label-manual-create-an-index)

- [Create a Compound Index](/docs/manual/core/indexes/index-types/index-compound/create-compound-index#std-label-index-create-compound)

- [Create an Index on an Array Field](/docs/manual/core/indexes/index-types/index-multikey/create-multikey-index-basic#std-label-index-create-multikey-basic)

- [Create an Index to Support Geospatial Queries](/docs/manual/core/indexes/index-types/index-geospatial#std-label-geospatial-index)

## Details

Indexes are special data structures that store a small portion of the collection's data set in an easy-to-traverse form. MongoDB indexes use a [B-tree](https://en.wikipedia.org/wiki/B-tree) data structure.

The index stores the value of a specific field or set of fields, ordered by the value of the field. The ordering of the index entries supports efficient equality matches and range-based query operations. In addition, MongoDB can return sorted results using the ordering in the index.

### Restrictions

For index key length limits and per-collection index limits, see [Index Limitations.](/docs/manual/reference/limits#std-label-index-limitations)

### Default Index

MongoDB creates a [unique index](/docs/manual/core/index-unique#std-label-index-type-unique) on the [\_id](/docs/manual/core/document#std-label-document-id-field) field during the creation of a collection. The `_id` index prevents clients from inserting two documents with the same value for the `_id` field. You cannot drop this index.

**Note:**

In [sharded clusters](/docs/manual/reference/glossary#std-term-sharded-cluster), if you do *not* use the `_id` field as the [shard key](/docs/manual/reference/glossary#std-term-shard-key), then your application **must** ensure the uniqueness of the values in the `_id` field. You can do this by using a field with an auto-generated [ObjectId.](/docs/manual/reference/glossary#std-term-ObjectId)

### Index Names

The default name for an index is the concatenation of the indexed keys and each key's direction in the index (`1` or `-1`) using underscores as a separator. For example, an index created on `{ item : 1, quantity:
-1 }` has the name `item_1_quantity_-1`.

You cannot rename an index once created. Instead, you must [drop](/docs/manual/core/indexes/drop-index#std-label-drop-an-index) and recreate the index with a new name.

To learn how to specify the name for an index, see [Specify an Index Name.](/docs/manual/core/indexes/create-index/specify-index-name#std-label-specify-index-name)

### Index Build Performance

Applications may encounter reduced performance during index builds, including limited read/write access to the collection. For more information on the index build process, see [Index Builds on Populated Collections](/docs/manual/core/index-creation#std-label-index-operations), including the [Index Builds in Replicated Environments](/docs/manual/core/index-creation#std-label-index-operations-replicated-build) section.

## Learn More

- MongoDB provides several index types to support specific data and queries. To learn more, see [Index Types.](/docs/manual/core/indexes/index-types#std-label-index-types)

- To learn what properties and behaviors you can specify in your index, see [Index Properties.](/docs/manual/core/indexes/index-properties#std-label-index-properties)

- To review considerations for creating an index, see [Indexing Strategies.](/docs/manual/applications/indexes#std-label-manual-indexing-strategies)

- To learn about the performance impact of indexes, see [Operational Factors and Data Models.](/docs/manual/data-modeling/best-practices#std-label-data-model-indexes)

- To learn about query settings and indexes, see [`setQuerySettings`.](/docs/manual/reference/command/setQuerySettings#mongodb-dbcommand-dbcmd.setQuerySettings)
