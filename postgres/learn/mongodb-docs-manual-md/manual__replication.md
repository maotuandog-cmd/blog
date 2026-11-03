> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Replication

A *replica set* in MongoDB is a group of [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) processes that maintain the same data set. Replica sets provide redundancy and [high availability](/docs/manual/reference/glossary#std-term-high-availability), and are the basis for all production deployments. This section introduces replication in MongoDB and the components and architecture of replica sets. The section also provides tutorials for common tasks related to replica sets.

You can [deploy a replica set in the UI](https://www.mongodb.com/docs/atlas/tutorial/create-new-cluster/) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Redundancy and Data Availability

Replication provides redundancy and [data availability](/docs/manual/reference/glossary#std-term-high-availability), maintaining multiple copies of data across database servers to tolerate the loss of any single server.

In some cases, replication can provide increased read capacity as clients can send read operations to different servers. Maintaining copies of data in different data centers can increase data locality and availability for distributed applications. You can also maintain additional copies for dedicated purposes, such as disaster recovery, reporting, or backup.

## Replication in MongoDB

A replica set is a group of [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances that maintain the same data set. A replica set contains several data bearing nodes and optionally one arbiter node. Of the data bearing nodes, one and only one member is deemed the primary node, while the other nodes are deemed secondary nodes.

**Warning:**

Each replica set node must belong to one, and only one, replica set. Replica set nodes cannot belong to more than one replica set.

The [primary node](/docs/manual/core/replica-set-primary#std-label-replica-set-primary) receives all write operations. A replica set can have only one primary capable of confirming writes with [`{ w: "majority" }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) write concern, although in some circumstances, another mongod instance may transiently believe itself to also be primary.  The primary records all changes to its data sets in its operation log, that is, the [oplog](/docs/manual/core/replica-set-oplog). For more information on primary node operation, see [Replica Set Primary.](/docs/manual/core/replica-set-primary)

![Diagram of default routing of reads and writes to the primary.](/images/replica-set-read-write-operations-primary.bakedsvg.svg)

The [secondaries](/docs/manual/core/replica-set-secondary#std-label-replica-set-secondary-members-ref) replicate the primary's oplog and apply the operations to their data sets such that the secondaries' data sets reflect the primary's data set. If the primary is unavailable, an eligible secondary holds an election to select a new primary. For more information on secondary members, see [Replica Set Secondary Members.](/docs/manual/core/replica-set-secondary)

![Diagram of a 3 member replica set that consists of a primary and two secondaries.](/images/replica-set-primary-with-two-secondaries.bakedsvg.svg)

If cost constraints prevent adding another secondary, you may add a [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance to a replica set as an [arbiter](/docs/manual/core/replica-set-arbiter#std-label-replica-set-arbiter-configuration). An arbiter participates in [elections](/docs/manual/core/replica-set-elections#std-label-replica-set-elections) but does not hold data (that is, does not provide data redundancy). For more information on arbiters, see [Replica Set Arbiter.](/docs/manual/core/replica-set-arbiter)

![Diagram of a replica set that consists of a primary, a secondary, and an arbiter.](/images/replica-set-primary-with-secondary-and-arbiter.bakedsvg.svg)

An [arbiter](/docs/manual/core/replica-set-arbiter#std-label-replica-set-arbiter-configuration) is always an arbiter whereas a [primary](/docs/manual/core/replica-set-primary#std-label-replica-set-primary) may step down and become a [secondary](/docs/manual/core/replica-set-secondary#std-label-replica-set-secondary-members-ref) and a secondary may become the primary during an election.

## Asynchronous Replication

Secondaries replicate the primary's oplog and apply the operations to their data sets asynchronously. By having the secondaries' data sets reflect the primary's data set, the replica set can continue to function despite the failure of one or more members.

For more information on replication mechanics, see [Replica Set Oplog](/docs/manual/core/replica-set-oplog#std-label-replica-set-oplog) and [Replica Set Data Synchronization.](/docs/manual/core/replica-set-sync#std-label-replica-set-sync)

### Slow Operations

Secondary members of a replica set now [log oplog entries](/docs/manual/core/replica-set-oplog#std-label-slow-oplog-application) that take longer than the slow operation threshold to apply. These slow oplog messages:

- Are logged for the secondaries in the [`diagnostic log`.](/docs/manual/reference/program/mongod#std-option-mongod.--logpath)

- Are logged under the [`REPL`](/docs/manual/reference/log-messages#mongodb-data-REPL) component with the text `applied op: <oplog entry> took <num>ms`.

- Do not depend on the log levels (either at the system or component level)

- Do not depend on the profiling level.

- Are affected by [`slowOpSampleRate`.](/docs/manual/reference/configuration-options#mongodb-setting-operationProfiling.slowOpSampleRate)

The profiler does not capture slow oplog entries.

### Replication Lag and Flow Control

[Replication lag](/docs/manual/reference/glossary#std-term-replication-lag) is a delay between an operation on the [primary](/docs/manual/reference/glossary#std-term-primary) and the application of that operation from the [oplog](/docs/manual/reference/glossary#std-term-oplog) to the [secondary](/docs/manual/reference/glossary#std-term-secondary). Some small delay period may be acceptable, but significant problems emerge as replication lag grows, including building cache pressure on the primary.

Administrators can limit the rate at which the primary applies its writes with the goal of keeping the [`majority committed`](/docs/manual/reference/command/replSetGetStatus#mongodb-data-replSetGetStatus.optimes.lastCommittedOpTime) lag under a configurable maximum value [`flowControlTargetLagSeconds`.](/docs/manual/reference/parameters#mongodb-parameter-param.flowControlTargetLagSeconds)

By default, flow control is [`enabled`.](/docs/manual/reference/parameters#mongodb-parameter-param.enableFlowControl)

With flow control enabled, as the lag grows close to the [`flowControlTargetLagSeconds`](/docs/manual/reference/parameters#mongodb-parameter-param.flowControlTargetLagSeconds), writes on the primary must obtain tickets before taking locks to apply writes. By limiting the number of tickets issued per second, the flow control mechanism attempts to keep the lag under the target.

For more information, see [Check the Replication Lag](/docs/manual/tutorial/troubleshoot-replica-sets#std-label-replica-set-replication-lag) and [Flow Control.](/docs/manual/tutorial/troubleshoot-replica-sets#std-label-flow-control)

## Automatic Failover

When a primary does not communicate with the other members of the set for more than the configured [`electionTimeoutMillis`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) period (10 seconds by default), an eligible secondary calls for an election to nominate itself as the new primary.

![Election in a three-member replica set after the primary becomes unreachable; a secondary is elected.](/images/replica-set-trigger-election.bakedsvg.svg)

The median time before a cluster elects a new primary should not typically exceed 12 seconds, assuming default [`replica configuration settings`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings). This includes time required to mark the primary as [unavailable](/docs/manual/replication#std-label-replication-auto-failover) and call and complete an [election](/docs/manual/core/replica-set-elections#std-label-replica-set-elections). You can tune this time period by modifying the [`settings.electionTimeoutMillis`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) replication configuration option. Factors such as network latency may extend the time required for replica set elections to complete, which in turn affects the amount of time your cluster may operate without a primary. These factors are dependent on your particular cluster architecture.

Lowering the [`electionTimeoutMillis`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.settings.electionTimeoutMillis) replication configuration option from the default `10000` (10 seconds) can result in faster detection of primary failure. However, the cluster may call elections more frequently due to factors such as temporary network latency even if the primary is otherwise healthy. This can result in increased [rollbacks](/docs/manual/core/replica-set-rollbacks#std-label-replica-set-rollback) for [w : 1](/docs/manual/reference/write-concern#std-label-wc-w) write operations.

Your application connection logic should include tolerance for automatic failovers and the subsequent elections. MongoDB drivers can detect the loss of the primary and automatically [retry certain write operations](/docs/manual/core/retryable-writes#std-label-retryable-writes) a single time, providing additional built-in handling of automatic failovers and elections:

Compatible drivers enable retryable writes by default

MongoDB provides [mirrored reads](/docs/manual/replication#std-label-mirrored-reads) to pre-warm electable secondary members' cache with the most recently accessed data. Pre-warming the cache of a secondary can help restore performance more quickly after an election.

To learn more about MongoDB's failover process, see:

- [Replica Set Elections](/docs/manual/core/replica-set-elections#std-label-replica-set-elections)

- [Retryable Writes](/docs/manual/core/retryable-writes#std-label-retryable-writes)

- [Rollbacks During Replica Set Failover](/docs/manual/core/replica-set-rollbacks#std-label-replica-set-rollback)

## Read Operations

### Read Preference

By default, clients read from the primary ; however, clients can specify a [read preference](/docs/manual/core/read-preference) to send read operations to secondaries.

![Diagram of an application that uses read preference secondary.](/images/replica-set-read-preference-secondary.bakedsvg.svg)

[Asynchronous replication](/docs/manual/replication#std-label-asynchronous-replication) to secondaries means that reads from secondaries may return data that does not reflect the state of the data on the primary.

[Transactions](/docs/manual/core/transactions#std-label-transactions) that contain read operations must use read preference [`primary`](/docs/manual/reference/glossary#std-term-primary). All operations in a given transaction must route to the same member.

For information on reading from replica sets, see [Read Preference.](/docs/manual/core/read-preference)

### Data Visibility

Depending on the read concern, clients can see the results of writes before the writes are [durable:](/docs/manual/reference/glossary#std-term-durable)

- Regardless of a write's [write concern](/docs/manual/reference/write-concern#std-label-write-concern), other clients using [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) or [`"available"`](/docs/manual/reference/read-concern-available#mongodb-readconcern-readconcern.-available-) read concern can see the result of a write operation before the write operation is acknowledged to the issuing client.

- Clients using [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) or [`"available"`](/docs/manual/reference/read-concern-available#mongodb-readconcern-readconcern.-available-) read concern can read data which may be subsequently [rolled back](/docs/manual/core/replica-set-rollbacks) during replica set failovers.

For operations in a [multi-document transaction](/docs/manual/core/transactions), when a transaction commits, all data changes made in the transaction are saved and visible outside the transaction. That is, a transaction will not commit some of its changes while rolling back others.

Until a transaction commits, the data changes made in the transaction are not visible outside the transaction.

However, when a transaction writes to multiple shards, not all outside read operations need to wait for the result of the committed transaction to be visible across the shards. For example, if a transaction is committed and write 1 is visible on shard A but write 2 is not yet visible on shard B, an outside read at read concern [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) can read the results of write 1 without seeing write 2.

For more information on read isolations, consistency and recency for MongoDB, see [Read Isolation, Consistency, and Recency.](/docs/manual/core/read-isolation-consistency-recency)

### Mirrored Reads

Mirrored reads reduce the impact of primary elections by pre-warming the caches of [`electable`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) secondary replica set members before a failover occurs. The primary mirrors a sample of the [supported operations](/docs/manual/replication#std-label-mirrored-reads-supported-operations) it receives to electable secondaries.

The size of the subset of [`electable`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) secondary replica set members that receive mirrored reads can be configured with the [`mirrorReads`](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads) parameter. See [Enable/Disable Support for Mirrored Reads](/docs/manual/replication#std-label-mirrored-reads-parameters) for further details.

**Note:**

Mirrored reads do not affect the primary's response to the client. The reads that the primary mirrors to secondaries are "fire-and-forget" operations. The primary doesn't await responses.

#### Targeted Mirrored Reads

Starting in MongoDB 8.2, you can selectively mirror read operations to specific servers that need their caches warmed up by tagging the nodes for read mirroring. Unlike general mirrored reads, targeted read mirroring allows you to target hidden nodes and mirror from both primary and secondary nodes.

You can configure targeted mirrored reads using the `targetedMirroring` field in the [`mirrorReads`](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads) parameter.

#### Supported Operations

Mirrored reads support the following operations:

- [`count`](/docs/manual/reference/command/count#mongodb-dbcommand-dbcmd.count)

- [`distinct`](/docs/manual/reference/command/distinct#mongodb-dbcommand-dbcmd.distinct)

- [`find`](/docs/manual/reference/command/find#mongodb-dbcommand-dbcmd.find)

- [`findAndModify`](/docs/manual/reference/command/findAndModify#mongodb-dbcommand-dbcmd.findAndModify) (Specifically, the filter is sent as a mirrored read)

- [`update`](/docs/manual/reference/command/update#mongodb-dbcommand-dbcmd.update) (Specifically, the filter is sent as a mirrored read)

#### Enable/Disable Support for Mirrored Reads

Mirrored reads are enabled by default and use a default [`sampling rate`](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads) of `0.01`. To disable mirrored reads, set the [`mirrorReads`](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads) parameter to `{
samplingRate: 0.0 }`:

```javascript
db.adminCommand( {
  setParameter: 1,
  mirrorReads: { samplingRate: 0.0 }
} )
```

With a sampling rate greater than `0.0`, the primary mirrors [supported reads](/docs/manual/replication#std-label-mirrored-reads-supported-operations) to a subset of [`electable`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) secondaries. With a sampling rate of `0.01`, the primary mirrors one percent of the supported reads it receives to a selection of electable secondaries.

For example, consider a replica set that consists of one primary and two electable secondaries. If the primary receives `1000` operations that can be mirrored and the sampling rate is `0.01`, the primary mirrors about `10` supported reads to a randomly chosen selection of electable secondaries.

#### Change the Sampling Rate for Mirrored Reads

To change the sampling rate for mirrored reads, set the [`mirrorReads`](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads) parameter to a number between `0.0` and `1.0`:

- A sampling rate of `0.0` disables mirrored reads.

- A sampling rate of a number between `0.0` and `1.0` results in the primary forwarding a random sample of the [supported reads](/docs/manual/replication#std-label-mirrored-reads-supported-operations) at the specified sample rate to electable secondaries.

- A sampling rate of `1.0` results in the primary forwarding all [supported reads](/docs/manual/replication#std-label-mirrored-reads-supported-operations) to electable secondaries.

For details, see [`mirrorReads`.](/docs/manual/reference/parameters#mongodb-parameter-param.mirrorReads)

#### Mirrored Reads Metrics

The [`serverStatus`](/docs/manual/reference/command/serverStatus#mongodb-dbcommand-dbcmd.serverStatus) command and the [`db.serverStatus()`](/docs/manual/reference/method/db.serverStatus#mongodb-method-db.serverStatus) shell method return [`mirroredReads`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.mirroredReads) metrics if you specify the field in the operation:

```javascript
db.serverStatus( { mirroredReads: 1 } )
```

## Transactions

[Multi-document transactions](/docs/manual/core/transactions#std-label-transactions) are available for replica sets.

[Transactions](/docs/manual/core/transactions#std-label-transactions) that contain read operations must use read preference [`primary`](/docs/manual/reference/glossary#std-term-primary). All operations in a given transaction must route to the same member.

Until a transaction commits, the data changes made in the transaction are not visible outside the transaction.

However, when a transaction writes to multiple shards, not all outside read operations need to wait for the result of the committed transaction to be visible across the shards. For example, if a transaction is committed and write 1 is visible on shard A but write 2 is not yet visible on shard B, an outside read at read concern [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) can read the results of write 1 without seeing write 2.

## Change Streams

[Change streams](/docs/manual/changeStreams#std-label-changeStreams) are available for replica sets and sharded clusters. Change streams allow applications to access real-time data changes without the complexity and risk of tailing the oplog. Applications can use change streams to subscribe to all data changes on a collection or collections.

## Additional Features

Replica sets provide a number of options to support application needs. For example, you may deploy a replica set with [members in multiple data centers](/docs/manual/core/replica-set-architecture-geographically-distributed), or control the outcome of elections by adjusting the [`members[n].priority`](/docs/manual/reference/replica-configuration#mongodb-rsconf-rsconf.members-n-.priority) of some members. Replica sets also support dedicated members for reporting, disaster recovery, or backup functions.

See [Priority 0 Replica Set Members](/docs/manual/core/replica-set-priority-0-member#std-label-replica-set-secondary-only-members), [Hidden Replica Set Members](/docs/manual/core/replica-set-hidden-member#std-label-replica-set-hidden-members) and [Delayed Replica Set Members](/docs/manual/core/replica-set-delayed-member#std-label-replica-set-delayed-members) for more information.

In [some circumstances](/docs/manual/core/read-preference-use-cases#std-label-edge-cases), two nodes in a replica set may *transiently* believe that they are the primary, but at most, one of them will be able to complete writes with [`{ w: "majority" }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) write concern. The node that can complete [`{ w: "majority" }`](/docs/manual/reference/write-concern#mongodb-writeconcern-writeconcern.-majority-) writes is the current primary, and the other node is a former primary that has not yet recognized its demotion, typically due to a [network partition](/docs/manual/reference/glossary#std-term-network-partition). When this occurs, clients that connect to the former primary may observe stale data despite having requested read preference [`primary`](/docs/manual/reference/glossary#std-term-primary), and new writes to the former primary will eventually roll back.
