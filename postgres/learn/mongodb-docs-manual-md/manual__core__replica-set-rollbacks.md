> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Rollbacks During Replica Set Failover

A rollback reverts write operations on a former [primary](/docs/manual/reference/glossary#std-term-primary) when the member rejoins its [replica set](/docs/manual/reference/glossary#std-term-replica-set) after a [failover](/docs/manual/reference/glossary#std-term-failover). A rollback is necessary only if the primary had accepted write operations that the [secondaries](/docs/manual/reference/glossary#std-term-secondary) had **not** successfully replicated before the primary stepped down. When the primary rejoins the set as a secondary, it reverts, or "rolls back," its write operations to maintain database consistency with the other members.

MongoDB attempts to avoid rollbacks, which should be rare. When a rollback does occur, it is often the result of a network partition. Secondaries that can not keep up with the throughput of operations on the former primary, increase the size and impact of the rollback.

A rollback does *not* occur if the write operations replicate to another member of the replica set before the primary steps down *and* if that member remains available and accessible to a majority of the replica set.

## Collect Rollback Data

### Configure Rollback Data

The [`createRollbackDataFiles`](/docs/manual/reference/parameters#mongodb-parameter-param.createRollbackDataFiles) parameter controls whether or not rollback files are created during rollbacks.

### Rollback Data

By default, when a rollback occurs, MongoDB writes the rollback data to [BSON](/docs/manual/reference/glossary#std-term-BSON) files.

For each collection whose data is rolled back, the rollback files are located in a `<dbpath>/rollback/<collectionUUID>` directory and have filenames of the form:

```none
removed.<timestamp>.bson
```

For example, if data for the collection `comments` in the `reporting` database rolled back:

```none
<dbpath>/rollback/20f74796-d5ea-42f5-8c95-f79b39bad190/removed.2020-02-19T04-57-11.0.bson
```

where `<dbpath>` is the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod)'s [`dbPath`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath)

**Tip: Collection Name**

To get the collection name, you can search for `rollback file` in the MongoDB log. For example, if the log file is `/var/log/mongodb/mongod.log`, you can use `grep` to search for instances of `"rollback file"` in the log:

```bash
grep "rollback file" /var/log/mongodb/mongod.log
```

Alternatively, you can loop through all the databases and run [`db.getCollectionInfos()`](/docs/manual/reference/method/db.getCollectionInfos#mongodb-method-db.getCollectionInfos) for the specific UUID until you get a match. For example:

```javascript
var mydatabases=db.adminCommand("listDatabases").databases;
var foundcollection=false;

for (var i = 0; i < mydatabases.length; i++) {
   let mdb = db.getSiblingDB(mydatabases[i].name);
   collections = mdb.getCollectionInfos( { "info.uuid": UUID("20f74796-d5ea-42f5-8c95-f79b39bad190") } );

   for (var j = 0; j < collections.length; j++) {   // Array of 1 element
      foundcollection=true;
      print(mydatabases[i].name + '.' + collections[j].name);
      break;
   }

   if (foundcollection) { break; }
}
```

### Rollback Data Exclusion

If the operation to roll back is a collection drop or a document deletion, the rollback of the collection drop or document deletion is not written to the rollback data directory.

**Warning:**

If write operations use [`{ w: 1 }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-number-) write concern, the rollback directory may exclude writes submitted after an [oplog hole](/docs/manual/reference/glossary#std-term-oplog-hole) if the primary restarts before the write operation completes.

### Read Rollback Data

To read the contents of the rollback files, use [`bsondump`](https://www.mongodb.com/docs/database-tools/bsondump/#mongodb-binary-bin.bsondump). Based on the content and the knowledge of their applications, administrators can decide the next course of action to take.

## Avoid Replica Set Rollbacks

For replica sets, the [write concern](/docs/manual/reference/write-concern#std-label-write-concern) [`{ w: 1 }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-number-) only provides acknowledgment of write operations on the primary. Data may be rolled back if the primary steps down before the write operations have replicated to any of the secondaries. This includes data written in [multi-document transactions](/docs/manual/core/transactions) that commit using [`{ w: 1 }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-number-) write concern.

### Journaling and Write Concern `majority`

To prevent rollbacks of data that have been acknowledged to the client, run all voting members with journaling enabled and use [\{ w: "majority" } write concern](/docs/manual/reference/write-concern#std-label-wc-w) to guarantee that the write operations propagate to a majority of the replica set nodes before returning with acknowledgment to the issuing client.

Starting in MongoDB 5.0, `{ w: "majority" }` is the default write concern for *most* MongoDB deployments. See [Implicit Default Write Concern.](/docs/manual/reference/write-concern#std-label-wc-default-behavior)

With [`writeConcernMajorityJournalDefault`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.writeConcernMajorityJournalDefault) set to `false`, MongoDB does not wait for [`w: "majority"`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) writes to be written to the on-disk journal before acknowledging the writes. As such, [`"majority"`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) write operations could possibly roll back in the event of a transient loss (e.g. crash and restart) of a majority of nodes in a given replica set.

### Visibility of Data That Can Be Rolled Back

- Regardless of a write's [write concern](/docs/manual/reference/write-concern#std-label-write-concern), other clients using [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) or [`"available"`](/docs/manual/reference/read-concern-available#mongodb-readconcern-readconcern.-available-) read concern can see the result of a write operation before the write operation is acknowledged to the issuing client.

- Clients using [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) or [`"available"`](/docs/manual/reference/read-concern-available#mongodb-readconcern-readconcern.-available-) read concern can read data which may be subsequently [rolled back](/docs/manual/core/replica-set-rollbacks) during replica set failovers.

For operations in a [multi-document transaction](/docs/manual/core/transactions), when a transaction commits, all data changes made in the transaction are saved and visible outside the transaction. That is, a transaction will not commit some of its changes while rolling back others.

Until a transaction commits, the data changes made in the transaction are not visible outside the transaction.

However, when a transaction writes to multiple shards, not all outside read operations need to wait for the result of the committed transaction to be visible across the shards. For example, if a transaction is committed and write 1 is visible on shard A but write 2 is not yet visible on shard B, an outside read at read concern [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) can read the results of write 1 without seeing write 2.

## Rollback Considerations

### User Operations

Starting in version 4.2, MongoDB kills all in-progress user operations when a member enters the [`ROLLBACK`](/docs/manual/reference/replica-states#mongodb-replstate-replstate.ROLLBACK) state.

### Index Builds

- For [feature compatibility version (fcv)](/docs/manual/reference/command/setFeatureCompatibilityVersion#std-label-view-fcv) `"4.2"`, MongoDB waits for any in-progress [index builds](/docs/manual/core/index-creation#std-label-index-operations) to finish before starting a rollback.

For more information on the index build process, see [Index Builds on Populated Collections.](/docs/manual/core/index-creation#std-label-index-operations)

### Index Operations When [`"majority"`](/docs/manual/reference/read-concern-majority#mongodb-readconcern-readconcern.-majority-) Read Concern is Disabled

If you disable [`"majority"`](/docs/manual/reference/read-concern-majority#mongodb-readconcern-readconcern.-majority-) read concern, MongoDB prevents [`collMod`](/docs/manual/reference/command/collMod#mongodb-dbcommand-dbcmd.collMod) commands which modify an index from [rolling back](/docs/manual/core/replica-set-rollbacks#std-label-replica-set-rollbacks). If you need to roll back `collMod` commands, you must resync the affected nodes with the [primary](/docs/manual/reference/glossary#std-term-primary) node.

### Size Limitations

MongoDB supports the following rollback algorithms, which have different size limitations:

- **Recover to a Timestamp**, where a former primary reverts to a consistent point in time and applies operations until it catches up to the sync source's branch of history. This is the default rollback algorithm.

  When using this algorithm, MongoDB does not limit the amount of data you can roll back.

- **Rollback via Refetch**, where a former primary finds the common point between its [oplog](/docs/manual/reference/glossary#std-term-oplog) and the sync source's oplog. Then, the member examines and reverts all operations in its oplog until it reaches this common point. Rollback via Refetch occurs only when the [`enableMajorityReadConcern`](/docs/manual/reference/configuration-options#mongodb-setting-replication.enableMajorityReadConcern) setting in your configuration file is set to `false`.

  When using this algorithm, MongoDB can only roll back up to 300 MB of data.

  **Note:**

  Starting in MongoDB 5.0, [`enableMajorityReadConcern`](/docs/manual/reference/configuration-options#mongodb-setting-replication.enableMajorityReadConcern) is set to `true` and cannot be changed.

### Rollback Elapsed Time Limitations

The rollback time limit defaults to 24 hours and is configurable using the [`rollbackTimeLimitSecs`](/docs/manual/reference/parameters#mongodb-parameter-param.rollbackTimeLimitSecs) parameter.

MongoDB measures elapsed time as the time between the first common operation in the oplogs to  the last entry in the oplog of the member being rolled back.

**See also:**

[Replica Set High Availability](/docs/manual/core/replica-set-high-availability) and [Replica Set Elections.](/docs/manual/core/replica-set-elections)
