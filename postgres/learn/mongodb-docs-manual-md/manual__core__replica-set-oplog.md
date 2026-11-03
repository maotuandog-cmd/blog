> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Replica Set Oplog

The [oplog](/docs/manual/reference/glossary#std-term-oplog) (operations log) is a special [capped collection](/docs/manual/reference/glossary#std-term-capped-collection) that keeps a rolling record of all operations that modify the data stored in your databases. If write operations do not modify any data or fail, they do not create oplog entries.

Unlike other capped collections, the oplog can grow past its configured size limit to avoid deleting the [`majority commit point`.](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.optimes.lastCommittedOpTime)

MongoDB applies database operations on the [primary](/docs/manual/reference/glossary#std-term-primary) and then records the operations on the primary's oplog. The [secondary](/docs/manual/reference/glossary#std-term-secondary) members then copy and apply these operations in an asynchronous process. All replica set members contain a copy of the oplog, in the [`local.oplog.rs`](/docs/manual/reference/local-database#mongodb-data-local.oplog.rs) collection, which allows them to maintain the current state of the database.

To facilitate replication, all replica set members send heartbeats (pings) to all other members. Any [secondary](/docs/manual/reference/glossary#std-term-secondary) member can import oplog entries from any other member.

Each operation in the oplog is [idempotent](/docs/manual/reference/glossary#std-term-idempotent). That is, oplog operations produce the same results whether applied once or multiple times to the target dataset.

## Oplog Size

When you start a replica set member for the first time, MongoDB creates an oplog of a default size if you do not specify the oplog size.

For Unix and Windows systems

The default oplog size depends on the storage engine:

| Storage Engine | Default Oplog Size |
| --- | --- |
| [WiredTiger Storage Engine](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger) | 5% of free disk space |
| [In-Memory Storage Engine for Self-Managed Deployments](/docs/manual/core/inmemory#std-label-storage-inmemory) | 5% of physical memory |

The default oplog size has the following constraints:

- The minimum oplog size is 990 MB. If 5% of free disk space or physical memory (whichever is applicable based on your storage engine) is less than 990 MB, the default oplog size is 990 MB.

- The maximum default oplog size is 50 GB. If 5% of free disk space or physical memory (whichever is applicable based on your storage engine) is greater than 50 GB, the default oplog size is 50 GB.

For 64-bit macOS systems

The default oplog size is 192 MB of either free disk space or physical memory depending on the storage engine:

| Storage Engine | Default Oplog Size |
| --- | --- |
| [WiredTiger Storage Engine](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger) | 192 MB of free disk space |
| [In-Memory Storage Engine for Self-Managed Deployments](/docs/manual/core/inmemory#std-label-storage-inmemory) | 192 MB of physical memory |

In most cases, the default oplog size is sufficient. For example, if an oplog is 5% of free disk space and fills up in 24 hours of operations, then secondaries can stop copying entries from the oplog for up to 24 hours without becoming too stale to continue replicating.

Before [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) creates an oplog, you can specify its size with the [`oplogSizeMB`](/docs/manual/reference/configuration-options#mongodb-setting-replication.oplogSizeMB) option. Once you have started a replica set member for the first time, use the [`replSetResizeOplog`](/docs/manual/reference/command/replSetResizeOplog#mongodb-dbcommand-dbcmd.replSetResizeOplog) administrative command to change the oplog size. [`replSetResizeOplog`](/docs/manual/reference/command/replSetResizeOplog#mongodb-dbcommand-dbcmd.replSetResizeOplog) enables you to resize the oplog dynamically without restarting the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) process.

### Minimum Oplog Retention Period

You can specify the minimum number of hours to preserve an oplog entry where [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) only removes an oplog entry *if* both of the following criteria are met:

- The oplog has reached the [maximum configured size.](/docs/manual/core/replica-set-oplog#std-label-replica-set-oplog-sizing)

- The oplog entry is older than the configured number of hours based on the host system clock.

By default MongoDB does not set a minimum oplog retention period and automatically truncates the oplog starting with the oldest entries to maintain the configured maximum oplog size.

To configure the minimum oplog retention period when starting the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod), either:

- Add the [`storage.oplogMinRetentionHours`](/docs/manual/reference/configuration-options#mongodb-setting-storage.oplogMinRetentionHours) setting to the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) [configuration file.](/docs/manual/reference/configuration-options#std-label-configuration-options)

  *-or-*

- Add the [`--oplogMinRetentionHours`](/docs/manual/reference/program/mongod#std-option-mongod.--oplogMinRetentionHours) command line option.

To configure the minimum oplog retention period on a running [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod), use [`replSetResizeOplog`](/docs/manual/reference/command/replSetResizeOplog#mongodb-dbcommand-dbcmd.replSetResizeOplog). Setting the minimum oplog retention period while the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) is running overrides any values set on startup. You must update the value of the corresponding configuration file setting or command line option to persist those changes through a server restart.

### Oplog Window

[oplog](/docs/manual/reference/glossary#std-term-oplog) entries are time-stamped. The oplog window is the time difference between the newest and the oldest timestamps in the `oplog`. If a secondary node loses connection with the primary, it can only use [replication](/docs/manual/replication#std-label-replication) to sync up again if the connection is restored within the oplog window.

## Workloads that Might Require a Larger Oplog Size

If you can predict your replica set's workload to resemble one of the following patterns, then you might want to create an oplog that is larger than the default. Conversely, if your application predominantly performs reads with a minimal amount of write operations, a smaller oplog may be sufficient.

### Updates to Multiple Documents at Once

The oplog must translate multi-updates into individual operations in order to maintain [idempotency](/docs/manual/reference/glossary#std-term-idempotent). This can use a great deal of oplog space without a corresponding increase in data size or disk use.

### Deletions Equal the Same Amount of Data as Inserts

If you delete roughly the same amount of data as you insert, the database does not grow significantly in disk use, but the size of the operation log can be quite large.

### Significant Number of In-Place Updates

If a significant portion of the workload is updates that do not increase the size of the documents, the database records a large number of operations but does not change the quantity of data on disk.

## Oplog Status

To view oplog status, including the size and the time range of operations, issue the [`rs.printReplicationInfo()`](/docs/manual/reference/method/rs.printReplicationInfo#mongodb-method-rs.printReplicationInfo) method. For more information on oplog status, see [Check the Size of the Oplog.](/docs/manual/tutorial/troubleshoot-replica-sets#std-label-replica-set-troubleshooting-check-oplog-size)

### Replication Lag and Flow Control

Under various exceptional situations, updates to a [secondary's](/docs/manual/reference/glossary#std-term-secondary) oplog might lag behind the desired performance time. Use [`db.getReplicationInfo()`](/docs/manual/reference/method/db.getReplicationInfo#mongodb-method-db.getReplicationInfo) from a secondary member and the replication status output to assess the current state of replication and determine if there is any unintended replication delay.

Administrators can limit the rate at which the primary applies its writes with the goal of keeping the [`majority committed`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.optimes.lastCommittedOpTime) lag under a configurable maximum value [`flowControlTargetLagSeconds`.](/docs/manual/reference/parameters#mongodb-parameter-param.flowControlTargetLagSeconds)

By default, flow control is [`enabled`.](/docs/manual/reference/parameters#mongodb-parameter-param.enableFlowControl)

See [Replication Lag](/docs/manual/tutorial/troubleshoot-replica-sets#std-label-replica-set-replication-lag) for more information.

## Slow Oplog Application

Secondary members of a replica set log oplog entries that take longer than the slow operation threshold to apply. These messages are [`logged`](/docs/manual/reference/program/mongod#std-option-mongod.--logpath) for the secondaries under the [`REPL`](/docs/manual/reference/log-messages#mongodb-data-REPL) component with the text `applied op: <oplog entry> took <num>ms`.

```none
2018-11-16T12:31:35.886-05:00 I REPL   [repl writer worker 13] applied op: command { ... }, took 112ms
```

The slow oplog application logging on secondaries are:

- Not affected by the [`logLevel`/](/docs/manual/reference/parameters#mongodb-parameter-param.logLevel)[`systemLog.verbosity`](/docs/manual/reference/configuration-options#mongodb-setting-systemLog.verbosity) level (or the [`systemLog.component.replication.verbosity`](/docs/manual/reference/configuration-options#mongodb-setting-systemLog.component.replication.verbosity) level); that is, for oplog entries, the secondary logs only the slow oplog entries. Increasing the verbosity level does not log all oplog entries.

- Not captured by the [profiler](/docs/manual/tutorial/manage-the-database-profiler) and not affected by the profiling level.

For more information on setting the slow operation threshold, see

- [`mongod --slowms`](/docs/manual/reference/program/mongod#std-option-mongod.--slowms)

- [`slowOpThresholdMs`](/docs/manual/reference/configuration-options#mongodb-setting-operationProfiling.slowOpThresholdMs)

- [`slowOpInProgressThresholdMs`](/docs/manual/reference/configuration-options#mongodb-setting-operationProfiling.slowOpInProgressThresholdMs)

- The [`profile`](/docs/manual/reference/command/profile#mongodb-dbcommand-dbcmd.profile) command or [`db.setProfilingLevel()`](/docs/manual/reference/method/db.setProfilingLevel#mongodb-method-db.setProfilingLevel) shell helper method.

## Oplog Collection Behavior

You cannot [`drop`](/docs/manual/reference/command/drop#mongodb-dbcommand-dbcmd.drop) the `local.oplog.rs` collection from any replica set member if your MongoDB deployment uses the [WiredTiger Storage Engine](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger). You cannot drop the `local.oplog.rs` collection from a standalone MongoDB instance. [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) requires the oplog for both [Replication](/docs/manual/replication#std-label-replication) and recovery of a node if the node goes down.

Starting in MongoDB 5.0, it is no longer possible to perform manual write operations to the [oplog](/docs/manual/core/replica-set-oplog#std-label-replica-set-oplog) on a cluster running as a [replica set](/docs/manual/replication#std-label-replication). Performing write operations to the oplog when running as a [standalone instance](/docs/manual/reference/glossary#std-term-standalone) should only be done with guidance from MongoDB Support.
