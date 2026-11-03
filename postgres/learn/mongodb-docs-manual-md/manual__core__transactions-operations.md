> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Transactions and Operations

MongoDB provides the ability to use transactions across multiple operations, collections, databases, documents, and shards.

## Operations Supported in Multi-Document Transactions

### CRUD Operations

The following read/write operations are allowed in transactions:

| Method | Command | Note |
| --- | --- | --- |
| [`db.collection.aggregate()`](/docs/manual/reference/method/db.collection.aggregate#mongodb-method-db.collection.aggregate) | [`aggregate`](/docs/manual/reference/command/aggregate#mongodb-dbcommand-dbcmd.aggregate) | Excluding the following stages: [`$collStats`](/docs/manual/reference/operator/aggregation/collStats#mongodb-pipeline-pipe.-collStats); [`$currentOp`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-pipeline-pipe.-currentOp); [`$indexStats`](/docs/manual/reference/operator/aggregation/indexStats#mongodb-pipeline-pipe.-indexStats); [`$listLocalSessions`](/docs/manual/reference/operator/aggregation/listLocalSessions#mongodb-pipeline-pipe.-listLocalSessions); [`$listSessions`](/docs/manual/reference/operator/aggregation/listSessions#mongodb-pipeline-pipe.-listSessions); [`$merge`](/docs/manual/reference/operator/aggregation/merge#mongodb-pipeline-pipe.-merge); [`$out`](/docs/manual/reference/operator/aggregation/out#mongodb-pipeline-pipe.-out); [`$planCacheStats`](/docs/manual/reference/operator/aggregation/planCacheStats#mongodb-pipeline-pipe.-planCacheStats); [`$unionWith`](/docs/manual/reference/operator/aggregation/unionWith#mongodb-pipeline-pipe.-unionWith) |
| [`db.collection.countDocuments()`](/docs/manual/reference/method/db.collection.countDocuments#mongodb-method-db.collection.countDocuments) |  | Excluding the following query operator expressions: [`$where`](/docs/manual/reference/operator/query/where#mongodb-query-op.-where); [`$near`](/docs/manual/reference/operator/query/near#mongodb-query-op.-near); [`$nearSphere`](/docs/manual/reference/operator/query/nearSphere#mongodb-query-op.-nearSphere) The method uses the [`$match`](/docs/manual/reference/operator/aggregation/match#mongodb-pipeline-pipe.-match) aggregation stage for the query and [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) aggregation stage with a [`$sum`](/docs/manual/reference/operator/aggregation/sum#mongodb-group-grp.-sum) expression to perform the count. |
| [`db.collection.distinct()`](/docs/manual/reference/method/db.collection.distinct#mongodb-method-db.collection.distinct) | [`distinct`](/docs/manual/reference/command/distinct#mongodb-dbcommand-dbcmd.distinct) | Available on unsharded collections. For sharded collections, use the aggregation pipeline with the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stage. See [Distinct Operation](/docs/manual/core/transactions-operations#std-label-transactions-operations-distinct). |
| [`db.collection.find()`](/docs/manual/reference/method/db.collection.find#mongodb-method-db.collection.find) | [`find`](/docs/manual/reference/command/find#mongodb-dbcommand-dbcmd.find) | |
| [`db.collection.deleteMany()`](/docs/manual/reference/method/db.collection.deleteMany#mongodb-method-db.collection.deleteMany)[`db.collection.deleteOne()`](/docs/manual/reference/method/db.collection.deleteOne#mongodb-method-db.collection.deleteOne)[`db.collection.remove()`](/docs/manual/reference/method/db.collection.remove#mongodb-method-db.collection.remove) | [`delete`](/docs/manual/reference/command/delete#mongodb-dbcommand-dbcmd.delete) | |
| [`db.collection.findOneAndDelete()`](/docs/manual/reference/method/db.collection.findOneAndDelete#mongodb-method-db.collection.findOneAndDelete)[`db.collection.findOneAndReplace()`](/docs/manual/reference/method/db.collection.findOneAndReplace#mongodb-method-db.collection.findOneAndReplace)[`db.collection.findOneAndUpdate()`](/docs/manual/reference/method/db.collection.findOneAndUpdate#mongodb-method-db.collection.findOneAndUpdate) | [`findAndModify`](/docs/manual/reference/command/findAndModify#mongodb-dbcommand-dbcmd.findAndModify) | If the update or replace operation is run with `upsert: true` on a non-existing collection, the collection is implicitly created. For more details, see [Administration Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl) |
| [`db.collection.insertMany()`](/docs/manual/reference/method/db.collection.insertMany#mongodb-method-db.collection.insertMany)[`db.collection.insertOne()`](/docs/manual/reference/method/db.collection.insertOne#mongodb-method-db.collection.insertOne) | [`insert`](/docs/manual/reference/command/insert#mongodb-dbcommand-dbcmd.insert) | If run on a non-existing collection, the collection is implicitly created. For more details, see [Administration Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl) |
| [`db.collection.updateOne()`](/docs/manual/reference/method/db.collection.updateOne#mongodb-method-db.collection.updateOne)[`db.collection.updateMany()`](/docs/manual/reference/method/db.collection.updateMany#mongodb-method-db.collection.updateMany)[`db.collection.replaceOne()`](/docs/manual/reference/method/db.collection.replaceOne#mongodb-method-db.collection.replaceOne) | [`update`](/docs/manual/reference/command/update#mongodb-dbcommand-dbcmd.update) | If run on a non-existing collection, the collection is implicitly created. For more details, see [Administration Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl) |
| [`db.collection.bulkWrite()`](/docs/manual/reference/method/db.collection.bulkWrite#mongodb-method-db.collection.bulkWrite)Various [Bulk Operations](/docs/manual/reference/method#std-label-bulk-operation-methods) |  | If run on a non-existing collection, the collection is implicitly created. For more details, see [Administration Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl) |

**Note: Updates to Shard Key Values**

You can update a document's shard key value (unless the shard key field is the immutable `_id` field) by issuing single-document update / findAndModify operations either in a transaction or as a [retryable write](/docs/manual/core/retryable-writes#std-label-retryable-writes). For details, see [Change a Document's Shard Key Value.](/docs/manual/core/sharding-change-shard-key-value#std-label-update-shard-key)

### Count Operation

To perform a count operation within a transaction, use the [`$count`](/docs/manual/reference/operator/aggregation/count#mongodb-pipeline-pipe.-count) aggregation stage or the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) (with a [`$sum`](/docs/manual/reference/operator/aggregation/sum#mongodb-group-grp.-sum) expression) aggregation stage.

MongoDB drivers provide a collection-level API `countDocuments(filter, options)` as a helper method that uses the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) with a [`$sum`](/docs/manual/reference/operator/aggregation/sum#mongodb-group-grp.-sum) expression to perform a count.

[`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) provides the [`db.collection.countDocuments()`](/docs/manual/reference/method/db.collection.countDocuments#mongodb-method-db.collection.countDocuments) helper method that uses the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) with a [`$sum`](/docs/manual/reference/operator/aggregation/sum#mongodb-group-grp.-sum) expression to perform a count.

### Distinct Operation

To perform a distinct operation within a transaction:

- For unsharded collections, you can use the [`db.collection.distinct()`](/docs/manual/reference/method/db.collection.distinct#mongodb-method-db.collection.distinct) method/the [`distinct`](/docs/manual/reference/command/distinct#mongodb-dbcommand-dbcmd.distinct) command as well as the aggregation pipeline with the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stage.

- For sharded collections, you cannot use the [`db.collection.distinct()`](/docs/manual/reference/method/db.collection.distinct#mongodb-method-db.collection.distinct) method or the [`distinct`](/docs/manual/reference/command/distinct#mongodb-dbcommand-dbcmd.distinct) command.

  To find the distinct values for a sharded collection, use the aggregation pipeline with the [`$group`](/docs/manual/reference/operator/aggregation/group#mongodb-pipeline-pipe.-group) stage instead. For example:

  - Instead of `db.coll.distinct("x")`, use

    ```javascript
    db.coll.aggregate([
       { $group: { _id: null, distinctValues: { $addToSet: "$x" } } },
       { $project: { _id: 0 } }
    ])
    ```

  - Instead of `db.coll.distinct("x", { status: "A" })`, use:

    ```javascript
    db.coll.aggregate([
       { $match: { status: "A" } },
       { $group: { _id: null, distinctValues: { $addToSet: "$x" } } },
       { $project: { _id: 0 } }
    ])
    ```

  The pipeline returns a cursor to a document:

  ```javascript
  { "distinctValues" : [ 2, 3, 1 ] }
  ```

  Iterate the cursor to access the results document.

### Administration Operations

You can create collections and indexes in transactions. For details, see [Create Collections and Indexes in a Transaction](/docs/manual/core/transactions#std-label-transactions-create-collections-indexes). The collections used in a transaction can be in different databases.

**Note:**

You cannot create new collections in cross-shard write transactions. For example, if you write to an existing collection in one shard and implicitly create a collection in a different shard, MongoDB cannot perform both operations in the same transaction.

You can create collections and indexes inside a [distributed transaction](/docs/manual/core/transactions#std-label-transactions-create-collections-indexes) if the transaction is not a cross-shard write transaction.

#### Explicit Create Operations

| Command | Method | Notes |
| --- | --- | --- |
| [`create`](/docs/manual/reference/command/create#mongodb-dbcommand-dbcmd.create) | [`db.createCollection()`](/docs/manual/reference/method/db.createCollection#mongodb-method-db.createCollection) | See also the [Implicit Create Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl-implicit) |
| [`createIndexes`](/docs/manual/reference/command/createIndexes#mongodb-dbcommand-dbcmd.createIndexes) | [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex)[`db.collection.createIndexes()`](/docs/manual/reference/method/db.collection.createIndexes#mongodb-method-db.collection.createIndexes) | The index to create must either be on a non-existing collection, in which case, the collection is created as part of the operation, or on a new empty collection created earlier in the same transaction. |

**Note:**

For explicit creation of a collection or an index inside a transaction, the transaction read concern level must be [`"local"`.](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-)

For more information on creating collections and indexes in a transaction, see [Create Collections and Indexes in a Transaction.](/docs/manual/core/transactions#std-label-transactions-create-collections-indexes)

#### Implicit Create Operations

You can also implicitly create a collection through the following write operations against a non-existing collection:

| Method Run against Non-Existing Collection | Command Run against Non-Existing Collection |
| --- | --- |
| [`db.collection.findAndModify()`](/docs/manual/reference/method/db.collection.findAndModify#mongodb-method-db.collection.findAndModify) with `upsert: true`[`db.collection.findOneAndReplace()`](/docs/manual/reference/method/db.collection.findOneAndReplace#mongodb-method-db.collection.findOneAndReplace) with `upsert: true`[`db.collection.findOneAndUpdate()`](/docs/manual/reference/method/db.collection.findOneAndUpdate#mongodb-method-db.collection.findOneAndUpdate) with `upsert: true` | [`findAndModify`](/docs/manual/reference/command/findAndModify#mongodb-dbcommand-dbcmd.findAndModify) with `upsert: true` |
| [`db.collection.insertMany()`](/docs/manual/reference/method/db.collection.insertMany#mongodb-method-db.collection.insertMany)[`db.collection.insertOne()`](/docs/manual/reference/method/db.collection.insertOne#mongodb-method-db.collection.insertOne) | [`insert`](/docs/manual/reference/command/insert#mongodb-dbcommand-dbcmd.insert) |
| [`db.collection.updateOne()`](/docs/manual/reference/method/db.collection.updateOne#mongodb-method-db.collection.updateOne) with `upsert: true`[`db.collection.updateMany()`](/docs/manual/reference/method/db.collection.updateMany#mongodb-method-db.collection.updateMany) with `upsert: true`[`db.collection.replaceOne()`](/docs/manual/reference/method/db.collection.replaceOne#mongodb-method-db.collection.replaceOne) with `upsert: true` | [`update`](/docs/manual/reference/command/update#mongodb-dbcommand-dbcmd.update) with `upsert: true` |
| [`db.collection.bulkWrite()`](/docs/manual/reference/method/db.collection.bulkWrite#mongodb-method-db.collection.bulkWrite)  with insert or `upsert:true` operationsVarious [Bulk Operations](/docs/manual/reference/method#std-label-bulk-operation-methods) with insert or `upsert:true` operations | |

For other CRUD operations allowed in transactions, see [CRUD Operations.](/docs/manual/core/transactions-operations#std-label-transactions-operations-crud)

For more information on creating collections and indexes in a transaction, see [Create Collections and Indexes in a Transaction.](/docs/manual/core/transactions#std-label-transactions-create-collections-indexes)

### Informational Operations

Informational commands, such as [`hello`](/docs/manual/reference/command/hello#mongodb-dbcommand-dbcmd.hello), [`buildInfo`](/docs/manual/reference/command/buildInfo#mongodb-dbcommand-dbcmd.buildInfo), [`connectionStatus`](/docs/manual/reference/command/connectionStatus#mongodb-dbcommand-dbcmd.connectionStatus) (and their helper methods) are allowed in transactions; however, they cannot be the first operation in the transaction.

## Restricted Operations

The following operations are not allowed in transactions:

- Creating new collections in cross-shard write transactions. For example, if you write to an existing collection in one shard and implicitly create a collection in a different shard, MongoDB cannot perform both operations in the same transaction.

- [Explicit creation of collections](/docs/manual/core/transactions-operations#std-label-transactions-operations-ddl-explicit), e.g. [`db.createCollection()`](/docs/manual/reference/method/db.createCollection#mongodb-method-db.createCollection) method, and indexes, e.g. [`db.collection.createIndexes()`](/docs/manual/reference/method/db.collection.createIndexes#mongodb-method-db.collection.createIndexes) and [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) methods, when using a read concern level other than [`"local"`.](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-)

- The [`listCollections`](/docs/manual/reference/command/listCollections#mongodb-dbcommand-dbcmd.listCollections) and [`listIndexes`](/docs/manual/reference/command/listIndexes#mongodb-dbcommand-dbcmd.listIndexes) commands and their helper methods.

- Other non-CRUD and non-informational operations, such as [`createUser`](/docs/manual/reference/command/createUser#mongodb-dbcommand-dbcmd.createUser), [`getParameter`](/docs/manual/reference/command/getParameter#mongodb-dbcommand-dbcmd.getParameter), [`count`](/docs/manual/reference/command/count#mongodb-dbcommand-dbcmd.count) and their helpers.

- Parallel operations. To update multiple namespaces concurrently, consider using the [`bulkWrite`](/docs/manual/reference/command/bulkWrite#mongodb-dbcommand-dbcmd.bulkWrite) command instead.

- Writes to [capped](/docs/manual/core/capped-collections#std-label-manual-capped-collection) collections.

- Using read concern [`"snapshot"`](/docs/manual/reference/read-concern-snapshot#mongodb-readconcern-readconcern.-snapshot-) when reading from a [capped](/docs/manual/core/capped-collections#std-label-manual-capped-collection) collection. (Starting in MongoDB 5.0)

- Reads/writes to collections in the `config`, `admin`, or `local` databases.

- Writes to `system.*` collections.

- Using `explain` or similar commands to return the supported operation's query plan.

- Calling [`getMore`](/docs/manual/reference/command/getMore#mongodb-dbcommand-dbcmd.getMore) on cursors created outside of a transaction, or calling [`getMore`](/docs/manual/reference/command/getMore#mongodb-dbcommand-dbcmd.getMore) outside of a transaction on cursors created within a transaction.

- Specifying the [`killCursors`](/docs/manual/reference/command/killCursors#mongodb-dbcommand-dbcmd.killCursors) command as the first operation in a [transaction.](/docs/manual/core/transactions#std-label-transactions)

  **Note:**

  If you run the `killCursors` command within a transaction, the server immediately stops the specified cursors. It does **not** wait for the transaction to commit.

**See also:**

[Pending DDL Operations and Transactions](/docs/manual/core/transactions-production-consideration#std-label-txn-prod-considerations-ddl)
