> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Reshard a Collection

The ideal shard key allows MongoDB to distribute documents evenly throughout the cluster while facilitating common query patterns. A suboptimal shard key can lead to performance or scaling issues due to uneven data distribution. You can change the shard key for a collection to change the distribution of your data across a cluster.

Starting in MongoDB 8.0, you can reshard a collection on the same shard key, allowing you to redistribute data to include new shards or to different zones without changing your shard key. To reshard to the same shard key, set [forceRedistribution](/docs/manual/reference/command/reshardCollection#std-label-forceRedistribution-field) to `true`.

Starting in MongoDB 8.0.10, you can reshard a time series collection. All shards in the time series collection must run version 8.0.10 or later to reshard.

**Note:**

Before resharding your collection, read [Troubleshoot Shard Keys](/docs/manual/core/sharding-troubleshooting-shard-keys#std-label-shardkey-troubleshoot-shard-keys) for information on common performance and scaling issues and advice on how to fix them.

## About this Task

- Only one collection can be resharded at a time.

- [`writeConcernMajorityJournalDefault`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.writeConcernMajorityJournalDefault) must be `true`.

- To reshard a collection that has a [uniqueness](/docs/manual/core/index-unique#std-label-index-type-unique) constraint, the new shard key must satisfy the [unique index requirements](/docs/manual/core/sharding-shard-key-indexes#std-label-sharding-shard-key-unique) for any existing unique indexes.

- The following commands and corresponding shell methods are not supported on the collection that is being resharded while the resharding operation is in progress:

  - [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod)

  - [`convertToCapped`](/docs/manual/reference/command/convertToCapped#mongodb-dbcommand-dbcmd.convertToCapped)

  - [`createIndexes`](/docs/manual/reference/command/createIndexes#mongodb-dbcommand-dbcmd.createIndexes)

  - [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex)

  - [`drop`](/docs/manual/reference/command/drop#mongodb-dbcommand-dbcmd.drop)

  - [`drop()`](/docs/manual/reference/method/db.collection.drop#mongodb-method-db.collection.drop)

  - [`dropIndexes`](/docs/manual/reference/command/dropIndexes#mongodb-dbcommand-dbcmd.dropIndexes)

  - [`dropIndex()`](/docs/manual/reference/method/db.collection.dropIndex#mongodb-method-db.collection.dropIndex)

  - [`renameCollection`](/docs/manual/reference/command/renameCollection#mongodb-dbcommand-dbcmd.renameCollection)

  - [`renameCollection()`](/docs/manual/reference/method/db.collection.renameCollection#mongodb-method-db.collection.renameCollection)

- If you run one of the following operations, the operation waits until resharding completes before executing:

  - [`addShard`](/docs/manual/reference/command/addShard#mongodb-dbcommand-dbcmd.addShard)

  - [`removeShard`](/docs/manual/reference/command/removeShard#mongodb-dbcommand-dbcmd.removeShard)

  - [`dropDatabase`](/docs/manual/reference/command/dropDatabase#mongodb-dbcommand-dbcmd.dropDatabase) on the database hosting the collection undergoing resharding

- If the collection you're resharding uses [MongoDB Search](https://www.mongodb.com/docs/atlas/atlas-search/), the search index becomes unavailable when the resharding operation completes. You need to manually rebuild the search index once the resharding operation completes.

- If the collection you're resharding is archived in [Atlas Online Archives](https://www.mongodb.com/docs/atlas/online-archive/manage-online-archive/#std-label-manage-online-archive), the online archive files are marked as `Orphaned` once the resharding operation completes. You can [create](https://www.mongodb.com/docs/atlas/online-archive/configure-online-archive/) another online archive for the same database, collection, and fields as the orphaned archive as long as there is no other archive for that same combination in the `Active` state.

## Before you Begin

Before you begin resharding your collection, ensure that you meet the following requirements:

- Your application can tolerate a period of **two seconds** where the affected collection blocks writes. During the time period where writes are blocked, your application experiences an increase in latency.

  If your workload cannot tolerate this requirement, consider [refining your shard key](/docs/manual/core/sharding-refine-a-shard-key#std-label-shard-key-refine) instead.

- Your database meets these resource requirements:

  - Ensure that the available storage space on each recipient shard is at least twice the storage size of the collection that you want to reshard plus its total index size, divided by the number of shards:

    ```none
    ( ( collection_storage_size + index_size ) * 2 ) / shard_count = storage_req
    ```

    For example, consider a collection with a storage size of 2 TB data and a 400 GB index. To distribute it across four shards you'd need:

    ```none
    ( ( 2 TB collection + 0.4 TB index ) * 2 ) / 4 shards = 1.2 TB storage
    ```

    To reshard this collection, each shard requires 1.2 TB of available storage.

    On MongoDB Atlas, you may need to upgrade to the next tier of storage for the reshard operation. You can downgrade once the operation completes.

  - Ensure that your I/O capacity is below 50%.

  - Ensure that your CPU load is below 80%.

  **Important:**

  These requirements are not enforced by the database. A failure to allocate enough resources can result in:

  - the database running out of space and shutting down

  - decreased performance

  - the operation taking longer than expected

  If your application has time periods with less traffic, perform this operation on the collection during that time if possible.

- You do not need to create an index on the new shard key before resharding. The resharding operation builds the required indexes automatically during the index phase.

- No index builds are in progress. To check for running index builds, use `$currentOp`:

  ```javascript
  db.getSiblingDB("admin").aggregate( [
     { $currentOp : { idleConnections: true } },
     { $match: {
           $or: [
               { "op": "command", "command.createIndexes": { $exists: true } },
               { "op": "none", "msg": /^Index Build/ }
           ]
        }
     }
  ] )
  ```

  In the result document, if the `inprog` field value is an empty array, there are no index builds in progress:

  ```javascript
  {
     inprog: [],
     ok: 1,
     '$clusterTime': { ... },
     operationTime: <timestamp>
  }
  ```

* You must rewrite your application's queries to use **both** the current shard key and the new shard key.

  **Tip:**

  If your application can tolerate downtime, you can perform these steps to avoid rewriting your application's queries to use both the current and new shard keys:

  1. Stop your application.

  2. Rewrite your application to use the **new** shard key.

  3. Wait until the resharding operation completes. To monitor the resharding process, use the [`$currentOp`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-pipeline-pipe.-currentOp) pipeline stage.

  4. Deploy your rewritten application.

  Before the resharding operation completes, the following queries return an error if the query filter does not include either the current shard key or a unique field (like `_id`):

  - [`deleteOne()`](/docs/manual/reference/method/db.collection.deleteOne#mongodb-method-db.collection.deleteOne)

  - [`findAndModify()`](/docs/manual/reference/method/db.collection.findAndModify#mongodb-method-db.collection.findAndModify)

  - [`findOneAndDelete()`](/docs/manual/reference/method/db.collection.findOneAndDelete#mongodb-method-db.collection.findOneAndDelete)

  - [`findOneAndReplace()`](/docs/manual/reference/method/db.collection.findOneAndReplace#mongodb-method-db.collection.findOneAndReplace)

  - [`findOneAndUpdate()`](/docs/manual/reference/method/db.collection.findOneAndUpdate#mongodb-method-db.collection.findOneAndUpdate)

  - [`replaceOne()`](/docs/manual/reference/method/db.collection.replaceOne#mongodb-method-db.collection.replaceOne)

  - [`updateOne()`](/docs/manual/reference/method/db.collection.updateOne#mongodb-method-db.collection.updateOne)

  For optimal performance, we recommend that you also rewrite other queries to include the new shard key.

  Once the resharding operation completes, you can remove the old shard key from the queries.

**Note:**

A resharding operation is a write-intensive process which can generate increased rates of oplog. You may wish to:

- set a fixed oplog size to prevent unbounded oplog growth.

- increase the oplog size to minimize the chance that one or more secondary nodes becomes stale.

See the [Replica Set Oplog](/docs/manual/core/replica-set-oplog#std-label-replica-set-oplog) documentation for more details.

## Steps

**Important:**

We strongly recommend that you check the [About this Task](/docs/manual/core/sharding-reshard-a-collection#std-label-resharding-limitations) and read the [Steps](/docs/manual/core/sharding-reshard-a-collection#std-label-resharding_process) section in full before resharding your collection.

In a collection resharding operation, a shard can be a:

- **donor**, which currently stores [chunks](/docs/manual/reference/glossary#std-term-chunk) for the sharded collection.

- **recipient**, which stores new chunks for the sharded collection based on the [shard keys](/docs/manual/reference/glossary#std-term-shard-key) and [zones.](/docs/manual/core/zone-sharding#std-label-zone-sharding)

A shard can be donor and a recipient at the same time.

The config server primary is always the resharding coordinator and starts each phase of the resharding operation.

1. Disable the Balancer

   You must turn off the balancer before you begin the process of resharding a collection. To disable the balancer, see [here](https://www.mongodb.com/docs/manual/tutorial/manage-sharded-cluster-balancer/#disable-the-balancer).

2. Start the resharding operation.

   While connected to the [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos), issue a [`reshardCollection`](/docs/manual/reference/command/reshardCollection#mongodb-dbcommand-dbcmd.reshardCollection) command that specifies the collection to be resharded and the new shard key:

   ```javascript
   db.adminCommand({
     reshardCollection: "<database>.<collection>",
     key: <shardkey>
   })
   ```

   MongoDB sets the max number of seconds to block writes to two seconds and begins the resharding operation.

   To reshard to the same shard key, set [forceRedistribution](/docs/manual/reference/command/reshardCollection#std-label-forceRedistribution-field) to `true`:

   ```javascript
   db.adminCommand({
     reshardCollection: "<database>.<collection>",
     key: <shardkey>,
     forceRedistribution: true
   })
   ```

   You can also use [`sh.reshardCollection()`](/docs/manual/reference/method/sh.reshardCollection#mongodb-method-sh.reshardCollection) to reshard a collection with the same key. For an example, see [Redistribute Data to New Shards.](/docs/manual/reference/method/sh.reshardCollection#std-label-reshardCollection-to-same-key)

3. Monitor the resharding operation.

   To monitor the resharding operation, you can use the [`$currentOp`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-pipeline-pipe.-currentOp) pipeline stage:

   ```javascript
   db.getSiblingDB("admin").aggregate([
     { $currentOp: { allUsers: true, localOps: false } },
     {
       $match: {
         type: "op",
         "originatingCommand.reshardCollection": "<database>.<collection>"
       }
     }
   ])
   ```

   **Note:**

   To see updated values, you need to continuously run the preceeding pipeline.

   The [`$currentOp`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-pipeline-pipe.-currentOp) pipeline outputs:

   - `totalOperationTimeElapsedSecs`: elapsed operation time in seconds

   - `remainingOperationTimeEstimatedSecs`: estimated time remaining in seconds for the current [resharding operation](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding). It is returned as `-1` when a new resharding operation starts.

     Starting in MongoDB 7.0, `remainingOperationTimeEstimatedSecs` is also available on the coordinator during a resharding operation.

     `remainingOperationTimeEstimatedSecs` is set to a pessimistic time estimate:

     - The catch-up phase time estimate is set to the clone phase time, which is a relatively long time.

     - In practice, if there are only a few pending write operations, the actual catch-up phase time is relatively short.

   ```javascript
   [
     {
       shard: '<shard>',
       type: 'op',
       desc: 'ReshardingRecipientService | ReshardingDonorService | ReshardingCoordinatorService <reshardingUUID>',
       op: 'command',
       ns: '<database>.<collection>',
       originatingCommand: {
         reshardCollection: '<database>.<collection>',
         key: <shardkey>,
         unique: <boolean>,
         collation: { locale: 'simple' }
       },
       totalOperationTimeElapsedSecs: <number>,
       remainingOperationTimeEstimatedSecs: <number>,
       ...
     },
     ...
   ]
   ```

4. Re-enable the Balancer.

   To enable the balancer, see [here](https://www.mongodb.com/docs/manual/tutorial/manage-sharded-cluster-balancer/#enable-the-balancer).

## Behavior

### Minimum Duration of a Resharding Operation

The minimum duration of a resharding operation is always 5 minutes.

### Retryable Writes

[Retryable writes](/docs/manual/core/retryable-writes#std-label-retryable-writes) initiated before or during resharding can be retried during and after the collection has been resharded for up to 5 minutes. After 5 minutes you may be unable to find the definitive result of the write and subsequent attempts to retry the write fail with an `IncompleteTransactionHistory` error.

### Reshard Limitations

- If the collection uses [Atlas Search](https://www.mongodb.com/docs/search/#std-label-atlas-search), the search index becomes unavailable after the operation completes. To restore it, manually rebuild the search index.

- Collections that use queryable encryption are not supported.

## Error Case

### Duplicate `_id` Values

The resharding operation fails if `_id` values are not globally unique to avoid corrupting collection data. Duplicate `_id` values can also prevent successful chunk migration. If you have documents with duplicate `_id` values, copy the data from each into a new document, and then delete the duplicate documents.
