> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Production Considerations

The following page lists some production considerations for running transactions. These apply whether you run transactions on replica sets or sharded clusters. For running transactions on sharded clusters, see also the [Production Considerations (Sharded Clusters)](/docs/manual/core/transactions-sharded-clusters) for additional considerations that are specific to sharded clusters.

## Availability

- MongoDB [standalone](/docs/manual/reference/glossary#std-term-standalone) deployments do not support transactions. To use transactions, your deployment must be a multiple node replica set.

- MongoDB supports multi-document transactions on replica sets.

- Distributed transactions add support for multi-document transactions on sharded clusters and incorporates the existing support for multi-document transactions on replica sets.

**Note: Distributed Transactions and Multi-Document Transactions**

The two terms are synonymous. Distributed transactions refer to multi-document transactions on sharded clusters and replica sets. Multi-document transactions (whether on sharded clusters or replica sets) are also known as distributed transactions.

## Feature Compatibility

To use transactions, the [featureCompatibilityVersion](/docs/manual/reference/command/setFeatureCompatibilityVersion#std-label-view-fcv) for all members of the deployment must be at least:

| Deployment | Minimum `featureCompatibilityVersion` |
| --- | --- |
| Replica Set | `4.0` |
| Sharded Cluster | `4.2` |

To check the FCV for a member, connect to the member and run the following command:

```javascript
db.adminCommand( { getParameter: 1, featureCompatibilityVersion: 1 } )
```

For more information, see the [`setFeatureCompatibilityVersion`](/docs/manual/reference/command/setFeatureCompatibilityVersion#mongodb-dbcommand-dbcmd.setFeatureCompatibilityVersion) reference page.

## Runtime Limit

**Note:**

To configure maximum transaction lifetimes in MongoDB Atlas, see [Set Transaction Lifetime](https://www.mongodb.com/docs/atlas/cluster-additional-settings/#set-transaction-lifetime) in the Atlas documentation.

By default, a transaction must have a runtime of less than one minute. You can modify this limit using [`transactionLifetimeLimitSeconds`](/docs/manual/reference/parameters#mongodb-parameter-param.transactionLifetimeLimitSeconds) for the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances. For sharded clusters, the parameter must be modified for all shard replica set members. Transactions that exceeds this limit are considered expired and will be aborted by a periodic cleanup process.

For sharded clusters, you can also specify a `maxTimeMS` limit on `commitTransaction`. For more information, see [Sharded Clusters Transactions Time Limit.](/docs/manual/core/transactions-sharded-clusters#std-label-transactions-sharded-clusters-time-limit)

## Oplog Size Limit

MongoDB creates as many oplog entries as necessary to the encapsulate all write operations in a transaction, instead of a single entry for all write operations in the transaction. This removes the 16MB total size limit for a transaction imposed by the single oplog entry for all its write operations. Although the total size limit is removed, each oplog entry still must be within the BSON document size limit of 16MB.

## WiredTiger Cache

To prevent storage cache pressure from negatively impacting the performance:

- When you abandon a transaction, abort the transaction.

- When you encounter an error during individual operation in the transaction, abort and retry the transaction.

The [`transactionLifetimeLimitSeconds`](/docs/manual/reference/parameters#mongodb-parameter-param.transactionLifetimeLimitSeconds) also ensures that expired transactions are aborted periodically to relieve storage cache pressure.

[Contact support](https://www.mongodb.com/docs/atlas/support/#std-label-request-support) if you experience any cache pressure issues.

**Note:**

If you have an uncommitted transaction that causes excessive pressure on the [WiredTiger cache](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger), the transaction aborts and returns a [write conflict](/docs/manual/reference/glossary#std-term-write-conflict) error.

If a transaction is too large to ever fit in the WiredTiger cache, the transaction aborts and returns a `TransactionTooLargeForCache` error.

## Transactions and Security

- If running with [access control](/docs/manual/core/authorization#std-label-authorization), you must have [privileges](/docs/manual/reference/built-in-roles#std-label-built-in-roles) for the [operations in the transaction.](/docs/manual/core/transactions#std-label-transactions-operations)

- If running with [auditing](/docs/manual/core/auditing#std-label-auditing), operations in an aborted transaction are still audited. However, there is no audit event that indicates that the transaction aborted.

## Shard Configuration Restriction

You cannot run transactions on a sharded cluster that has a shard with [`writeConcernMajorityJournalDefault`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.writeConcernMajorityJournalDefault) set to `false` (such as a shard with a voting member that uses the [in-memory storage engine](/docs/manual/core/inmemory#std-label-storage-inmemory)).

## Sharded Clusters and Arbiters

You cannot change a [shard key](/docs/manual/reference/glossary#std-term-shard-key) using a transaction if the replica set has an arbiter. Arbiters cannot participate in the data operations required for multi-shard transactions.

Transactions whose write operations span multiple shards will error and abort if any transaction operation reads from or writes to a shard that contains an arbiter.

## Acquiring Locks

By default, transactions wait up to `5` milliseconds to acquire locks required by the operations in the transaction. If the transaction cannot acquire its required locks within the `5` milliseconds, the transaction aborts.

Transactions release all locks upon abort or commit.

**Tip:**

When creating or dropping a collection immediately before starting a transaction, if the collection is accessed within the transaction, issue the create or drop operation with write concern [`"majority"`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) to ensure that the transaction can acquire the required locks.

### Lock Request Timeout

**Note:**

MongoDB Atlas clusters restrict the use of the [`setParameter`](/docs/manual/reference/command/setParameter#mongodb-dbcommand-dbcmd.setParameter) command. For more information, see [Unsupported Commands in Atlas](https://www.mongodb.com/docs/atlas/unsupported-commands/#std-label-unsupported-commands) in the Atlas documentation.

To modify your Atlas cluster parameters, contact [Atlas Support.](https://www.mongodb.com/docs/atlas/support/)

You can use the [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis) parameter to adjust how long transactions wait to acquire locks. Increasing [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis) allows operations in the transactions to wait the specified time to acquire the required locks. This can help obviate transaction aborts on momentary concurrent lock acquisitions, like fast-running metadata operations. However, this could possibly delay the abort of deadlocked transaction operations.

You can also use operation-specific timeout by setting [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis) to `-1`.

## Pending DDL Operations and Transactions

If a multi-document transaction is in progress, new DDL operations that affect the same database(s) or collection(s) wait behind the transaction. While these pending DDL operations exist, new transactions that access the same database(s) or collection(s) as the pending DDL operations cannot obtain the required locks and and will abort after waiting [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis). In addition, new non-transaction operations that access the same database(s) or collection(s) will block until they reach their `maxTimeMS` limit.

Consider the following scenarios:

DDL Operation That Requires a Collection Lock

While an in-progress transaction is performing various CRUD operations on the `employees` collection in the `hr` database, an administrator issues the [`db.collection.createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) DDL operation against the `employees` collection. [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) requires an exclusive collection lock on the collection.

Until the in-progress transaction completes, the [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) operation must wait to obtain the lock. Any new transaction that affects the `employees` collection and starts while the [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) is pending must wait until after [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) completes.

The pending [`createIndex()`](/docs/manual/reference/method/db.collection.createIndex#mongodb-method-db.collection.createIndex) DDL operation does not affect transactions on other collections in the `hr` database. For example, a new transaction on the `contractors` collection in the `hr` database can start and complete as normal.

DDL Operation That Requires a Database Lock

While an in-progress transaction is performing various CRUD operations on the `employees` collection in the `hr` database, an administrator issues the [`renameCollection`](/docs/manual/reference/command/renameCollection#mongodb-dbcommand-dbcmd.renameCollection) DDL operation to rename the `vendors.contractors` collection to `hr.contractors`. `renameCollection` requires a database lock on the target database (`hr`) when it differs from the source database (`vendors`).

Until the in-progress transaction completes, the `renameCollection` operation must wait to obtain the lock. Any new transaction that affects the `hr` database or *any* of its collections and starts while the `renameCollection` is pending must wait until after `renameCollection` completes.

In either scenario, if the DDL operation remains pending for more than [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis), pending transactions waiting behind that operation abort. That is, the value of [`maxTransactionLockRequestTimeoutMillis`](/docs/manual/reference/parameters#mongodb-parameter-param.maxTransactionLockRequestTimeoutMillis) must at least cover the time required for the in-progress transaction *and* the pending DDL operation to complete.

**See also:**

- [In-progress Transactions and Write Conflicts](/docs/manual/core/transactions-production-consideration#std-label-transactions-write-conflicts)

- [In-progress Transactions and Stale Reads](/docs/manual/core/transactions-production-consideration#std-label-transactions-stale-reads)

- [Which administrative commands lock a database?](/docs/manual/faq/concurrency#std-label-faq-concurrency-database-lock)

- [Which administrative commands lock a collection?](/docs/manual/faq/concurrency#std-label-faq-concurrency-collection-lock)

## In-progress Transactions and Write Conflicts

If a transaction is in progress and a write outside the transaction modifies a document that an operation in the transaction later tries to modify, the transaction aborts because of a write conflict.

If a transaction is in progress and has taken a lock to modify a document, when a write outside the transaction tries to modify the same document, the write waits until the transaction ends.

**See also:**

- [Acquiring Locks](/docs/manual/core/transactions-production-consideration#std-label-txns-locks)

- [Pending DDL Operations and Transactions](/docs/manual/core/transactions-production-consideration#std-label-txn-prod-considerations-ddl)

- [`$currentOp output`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-data--currentOp.prepareReadConflicts)

## In-progress Transactions and Stale Reads

Read operations inside a transaction can return old data, which is known as a [stale read](/docs/manual/reference/glossary#std-term-stale-read). Read operations inside a transaction are not guaranteed to see writes performed by other committed transactions or non-transactional writes. For example, consider the following sequence:

1. A transaction is in-progress.

2. A write outside the transaction deletes a document.

3. A read operation inside the transaction can read the now-deleted document since the operation uses a snapshot from before the write operation.

To avoid stale reads inside transactions for a single document, you can use the [`db.collection.findOneAndUpdate()`](/docs/manual/reference/method/db.collection.findOneAndUpdate#mongodb-method-db.collection.findOneAndUpdate) method. The following [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) example demonstrates how you can use `db.collection.findOneAndUpdate()` to take a [write lock](/docs/manual/reference/glossary#std-term-write-lock) and ensure that your reads are up to date:

1. Insert a document into the `employees` collection

   ```javascript
   db.getSiblingDB("hr").employees.insertOne(
      { _id: 1, status: "Active" }
   )
   ```

2. Start a session

   ```javascript
   session = db.getMongo().startSession( { readPreference: { mode: "primary" } } )
   ```

3. Start a transaction

   ```javascript
   session.startTransaction( { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } } )

   employeesCollection = session.getDatabase("hr").employees
   ```

4. Use `db.collection.findOneAndUpdate()` inside the transaction

   ```javascript
   employeeDoc = employeesCollection.findOneAndUpdate(
      { _id: 1, status: "Active" },
      { $set: { lockId: ObjectId() } },
      { returnNewDocument: true }
   )
   ```

   Note that inside the transaction, the `findOneAndUpdate` operation sets a new `lockId` field. You can set `lockId` field to any value, as long as it modifies the document. By updating the document, the transaction acquires a lock.

   If an operation outside of the transaction attempts to modify the document before you commit the transaction, MongoDB returns a write conflict error to the external operation.

5. Commit the transaction

   ```javascript
   session.commitTransaction()
   ```

   After you commit the transaction, MongoDB releases the lock.

   **Note:**

   If any operation in the transaction fails, the transaction aborts and all data changes made in the transaction are discarded without ever becoming visible in the collection.

## In-progress Transactions and Chunk Migration

[Chunk migration](/docs/manual/core/sharding-balancer-administration#std-label-chunk-migration-procedure) acquires exclusive collection locks during certain stages.

If an ongoing transaction has a lock on a collection and a chunk migration that involves that collection starts, these migration stages must wait for the transaction to release the locks on the collection, thereby impacting the performance of chunk migrations.

If a chunk migration interleaves with a transaction (for instance, if a transaction starts while a chunk migration is already in progress and the migration completes before the transaction takes a lock on the collection), the transaction errors during the commit and aborts.

Depending on how the two operations interleave, some sample errors include (the error messages have been abbreviated):

- `an error from cluster data placement change ... migration commit in progress for <namespace>`

- `Cannot find shardId the chunk belonged to at cluster time ...`

**See also:**

[`shardingStatistics.countDonorMoveChunkLockTimeout`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.shardingStatistics.countDonorMoveChunkLockTimeout)

## Outside Reads During Commit

During the commit for a transaction, outside read operations may try to read the same documents that will be modified by the transaction. If the transaction writes to multiple shards, then during the commit attempt across the shards:

- Outside reads that use read concern [`"snapshot"`](/docs/manual/reference/read-concern-snapshot#mongodb-readconcern-readconcern.-snapshot-) or [`"linearizable"`](/docs/manual/reference/read-concern-linearizable#mongodb-readconcern-readconcern.-linearizable-) wait until all writes of a transaction are visible.

- Outside reads that are part of causally consistent sessions (those that include [afterClusterTime](/docs/manual/reference/read-concern#std-label-afterClusterTime)) wait until all writes of a transaction are visible.

- Outside reads using other read concerns do not wait until all writes of a transaction are visible, but instead read the before-transaction version of the documents.

## Additional Information

**See also:**

[Production Considerations (Sharded Clusters)](/docs/manual/core/transactions-sharded-clusters)
