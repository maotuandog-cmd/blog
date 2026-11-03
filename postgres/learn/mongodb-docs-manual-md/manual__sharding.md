> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Sharding

[Sharding](/docs/manual/sharding) is a method for distributing data across multiple machines. MongoDB uses sharding to support deployments with very large data sets and high throughput operations.

Database systems with large data sets or high throughput applications can challenge the capacity of a single server. For example, high query rates can exhaust the CPU capacity of the server. Working set sizes larger than the system's RAM stress the I/O capacity of disk drives.

Two methods address system growth: vertical and horizontal scaling.

*Vertical Scaling* increases the capacity of a single server by using a more powerful CPU, adding more RAM, or expanding storage. Available technology and cloud provider hardware configurations impose a practical maximum for vertical scaling.

*Horizontal Scaling* involves dividing the system dataset and load over multiple servers, adding more servers to increase capacity as required. Each machine handles a subset of the overall workload, which can cost less than high-end hardware for a single machine. The trade-off is increased complexity in infrastructure and maintenance.

You can [shard clusters in the UI](https://www.mongodb.com/docs/atlas/cluster-additional-settings/#std-label-create-cluster-sharding) for deployments hosted in [MongoDB Atlas.](https://www.mongodb.com/docs/atlas)

## Sharded Cluster

**Note:**

A MongoDB [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster) consists of the following components:

- [shard](/docs/manual/core/sharded-cluster-shards#std-label-shards-concepts): Each shard contains a subset of the sharded data. Each shard must be deployed as a [replica set.](/docs/manual/reference/glossary#std-term-replica-set)

- [Routing with mongos](/docs/manual/core/sharded-cluster-query-router): The `mongos` acts as a query router, providing an interface between client applications and the sharded cluster.

- [config servers](/docs/manual/core/sharded-cluster-config-servers#std-label-sharding-config-server): Config servers store metadata and configuration settings for the cluster. Config servers must be deployed as a replica set (CSRS).

The following graphic describes the interaction of components within a sharded cluster:

![Sample sharded cluster with 3 config servers, 2+ \`\`mongos\`\` routers, and replica set shards.](/images/sharded-cluster-production-architecture.bakedsvg.svg)

MongoDB shards data at the [collection](/docs/manual/reference/glossary#std-term-collection) level, distributing the collection data across the shards in the cluster.

## Shard Keys

MongoDB uses the [shard key](/docs/manual/core/sharding-shard-key#std-label-sharding-shard-key) to distribute the collection's documents across shards. The shard key consists of a field or multiple fields in the documents.

Documents in sharded collections can be missing the shard key fields. Missing shard key fields are treated as having null values when distributing the documents across shards but not when routing queries. For more information, see [Set Missing Shard Key Fields.](/docs/manual/core/sharding-shard-key#std-label-shard-key-missing)

You select the shard key when [sharding a collection.](/docs/manual/core/sharding-shard-key#std-label-sharding-shard-key-creation)

- Starting in MongoDB 5.0, you can [reshard a collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) by changing a collection's shard key.

- You can [refine a shard key](/docs/manual/core/sharding-refine-a-shard-key#std-label-shard-key-refine) by adding a suffix field or fields to the existing shard key.

A document's shard key value determines its distribution across the shards. You can update a document's shard key value unless your shard key field is the immutable `_id` field. For more information, see [Change a Document's Shard Key Value.](/docs/manual/core/sharding-change-shard-key-value#std-label-update-shard-key)

### Shard Key Index

To shard a populated collection, the collection must have an [index](/docs/manual/reference/command/collMod#mongodb-collflag-index) that starts with the shard key. When sharding an empty collection, MongoDB creates the supporting index if the collection does not already have an appropriate index for the specified shard key. See [Shard Key Indexes.](/docs/manual/core/sharding-shard-key-indexes#std-label-sharding-shard-key-indexes)

### Shard Key Strategy

The choice of shard key and its backing index can also affect the [sharding strategy](/docs/manual/sharding#std-label-sharding-strategy) that your cluster can use.

**See also:**

[Choose a Shard Key](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-shard-key-selection)

## Chunks

MongoDB partitions sharded data into [chunks](/docs/manual/reference/glossary#std-term-chunk). Each chunk has an inclusive lower and exclusive upper range based on the [shard key.](/docs/manual/reference/glossary#std-term-shard-key)

## Balancer and Even Data Distribution

To achieve an even data distribution across all shards in the cluster, a [balancer](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing) runs in the background to migrate [ranges](/docs/manual/reference/glossary#std-term-range) across the [shards.](/docs/manual/reference/glossary#std-term-shard)

**See also:**

[Range Migration](/docs/manual/core/sharding-data-partitioning#std-label-sharding-range-migration)

## Advantages of Sharding

### Reads / Writes

MongoDB distributes the read and write workload across the [shards](/docs/manual/reference/glossary#std-term-shard) in the [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster), allowing each shard to process a subset of cluster operations. Both read and write workloads can be scaled horizontally across the cluster by adding more shards.

For queries that include the shard key or the prefix of a [compound](/docs/manual/reference/glossary#std-term-compound-index) shard key, [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) can target the query at a specific shard or set of shards. These [targeted operations](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-mongos-targeted) are generally more efficient than [broadcasting](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-mongos-broadcast) to every shard in the cluster.

### Storage Capacity

[Sharding](/docs/manual/sharding) distributes data across the [shards](/docs/manual/reference/glossary#std-term-shard) in the cluster, allowing each shard to contain a subset of the total cluster data. As the data set grows, additional shards increase the storage capacity of the cluster.

### High Availability

The deployment of config servers and shards as replica sets provide increased availability.

Even if one or more shard replica sets become completely unavailable, the sharded cluster can continue to perform partial reads and writes. That is, while data on the unavailable shard(s) cannot be accessed, reads or writes directed at the available shards can still succeed.

## Considerations Before Sharding

Sharded cluster infrastructure requirements and complexity require careful planning, execution, and maintenance.

While you can [reshard your collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) later, carefully consider your shard key choice to avoid scalability and performance issues.

**See also:**

[Choose a Shard Key](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-shard-key-selection)

To understand the operational requirements and restrictions for sharding your collection, see [Operational Restrictions in Sharded Clusters.](/docs/manual/core/sharded-cluster-requirements)

If queries do *not* include the shard key or the prefix of a [compound](/docs/manual/reference/glossary#std-term-compound-index) shard key, [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) performs a [broadcast operation](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-mongos-broadcast), querying *all* shards in the sharded cluster. These scatter/gather queries can be long running operations.

Starting in MongoDB 5.1, when starting, restarting or adding a [shard server](/docs/manual/core/sharded-cluster-components#std-label-sharding-shards) with [`sh.addShard()`](/docs/manual/reference/method/sh.addShard#mongodb-method-sh.addShard) the [Cluster Wide Write Concern (CWWC)](/docs/manual/reference/command/setDefaultRWConcern#std-label-set_global_default_write_concern) must be set.

If the `CWWC` is not set and the shard is configured such that the [default write concern](/docs/manual/reference/write-concern#std-label-write-concern) is `{ w : 1 }` the shard server will fail to start or be added and returns an error.

See [default write concern calculations](/docs/manual/reference/mongodb-defaults#std-label-default-wc-formula) for details on how the default write concern is calculated.

**Note:**

If you have an active support contract with MongoDB, consider contacting your account representative for assistance with sharded cluster planning and deployment.

### Reshard to Balance

When you run the [`sh.shardCollection()`](/docs/manual/reference/method/sh.shardCollection#mongodb-method-sh.shardCollection) method, the balancer begins distributing the collection data to other shards in the cluster. A single shard can only participate in one chunk migration at a time. When MongoDB succeeds in copying a range of data from one shard to another, the range on the donor shard is marked for removal by the range deleter. This process is slow and resource intensive.

Starting in MongoDB 8.0, if your deployment meets the [resource requirements](/docs/manual/core/reshard-to-same-key#std-label-reshard-to-same-key-req), it's recommended that you use the [`sh.shardAndDistributeCollection()`](/docs/manual/reference/method/sh.shardAndDistributeCollection#mongodb-method-sh.shardAndDistributeCollection) method to shard the collection. This method wraps the [`shardCollection`](/docs/manual/reference/command/shardCollection#mongodb-dbcommand-dbcmd.shardCollection) and [`reshardCollection`](/docs/manual/reference/command/reshardCollection#mongodb-dbcommand-dbcmd.reshardCollection) commands to shard the collection and immediately reshard it to the same key. This causes MongoDB to rebalance data across the shards without waiting on the balancer.

For more information, see [Reshard to the Same Shard Key.](/docs/manual/core/reshard-to-same-key#std-label-reshard-to-same-key)

## Sharded and Non-Sharded Collections

A database can have a mixture of sharded and unsharded collections. Sharded collections are [partitioned](/docs/manual/reference/glossary#std-term-data-partition) and distributed across the [shards](/docs/manual/reference/glossary#std-term-shard) in the cluster. Unsharded collections can be located on any shard but cannot span across shards.

![Primary shard (Shard A) with non-sharded collections and chunks of sharded collection documents.](/images/sharded-cluster-primary-shard.bakedsvg.svg)

## Connecting to a Sharded Cluster

You must connect to a [mongos](/docs/manual/reference/program/mongos#std-program-mongos) router to interact with any collection in the [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster). This includes sharded *and* unsharded collections. Clients should *never* connect to a single shard to perform read or write operations.

Starting in MongoDB 8.3, you can only run [DDL operations](/docs/manual/reference/ddl-operations#std-label-ddl-operations) and [`applyOps`](/docs/manual/reference/command/applyOps#mongodb-dbcommand-dbcmd.applyOps) on a `mongos` for all sharded clusters. These operations may be temporarily unavailable while transitioning from a replica set to a sharded cluster.

![Applications querying mongos for both sharded and unsharded collections.](/images/sharded-cluster-mixed.bakedsvg.svg)

You can connect to a [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) the same way you connect to a [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) using the [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) or a MongoDB [driver.](https://www.mongodb.com/docs/drivers/)

**Note:**

Starting in MongoDB 8.0, you can only run [certain commands](/docs/manual/reference/supported-shard-direct-commands#std-label-node-direct-commands) on nodes in sharded clusters. If you attempt to connect directly to a node and run an unsupported command, MongoDB returns an error:

```none
"You are connecting to a sharded cluster improperly by connecting directly
to a shard. Please connect to the cluster via a router (mongos)."
```

To run a non-supported database command directly against a node in a sharded cluster, you must either connect to `mongos` or have the maintenance-only `directShardOperations` role.

## Sharding Strategy

MongoDB supports two sharding strategies for distributing data across [sharded clusters.](/docs/manual/reference/glossary#std-term-sharded-cluster)

### Hashed Sharding

Hashed Sharding computes a hash of the shard key field's value. Each [chunk](/docs/manual/reference/glossary#std-term-chunk) is then assigned a range based on the hashed shard key values.

**Tip:**

MongoDB automatically computes the hashes when resolving queries using hashed indexes.  Applications do **not** need to compute hashes.

![Diagram of the hashed based segmentation.](/images/sharding-hash-based.bakedsvg.svg)

Hashed values are unlikely to share the same [chunk](/docs/manual/reference/glossary#std-term-chunk), providing more even data distribution, especially for shard keys that change [monotonically.](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic)

However, hashed distribution means that range-based queries on the shard key are less likely to target a single shard, resulting in more cluster-wide [broadcast operations.](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-mongos-broadcast)

See [Hashed Sharding](/docs/manual/core/hashed-sharding) for more information.

### Ranged Sharding

Ranged sharding divides data into ranges based on the shard key values, with each [chunk](/docs/manual/reference/glossary#std-term-chunk) assigned one of those ranges.

![Diagram of the shard key value space segmented into smaller ranges or chunks.](/images/sharding-range-based.bakedsvg.svg)

A range of shard keys whose values are "close" are more likely to reside on the same [chunk](/docs/manual/reference/glossary#std-term-chunk). This allows for [targeted operations](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-mongos-targeted) as a [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) can route the operations to only the shards that contain the required data.

The efficiency of ranged sharding depends on the shard key chosen. Poorly considered shard keys can result in uneven distribution of data, which can negate some benefits of sharding or can cause performance bottlenecks. See [shard key selection for range-based sharding.](/docs/manual/core/ranged-sharding#std-label-sharding-ranged-shard-key)

See [Ranged Sharding](/docs/manual/core/ranged-sharding) for more information.

## Zones in Sharded Clusters

Zones improve the locality of data for sharded clusters that span multiple data centers.

In sharded clusters, you can create [zones](/docs/manual/reference/glossary#std-term-zone) of sharded data based on the [shard key](/docs/manual/reference/glossary#std-term-shard-key). You can associate each zone with one or more shards in the cluster. A shard can associate with any number of zones. In a balanced cluster, MongoDB migrates [chunks](/docs/manual/reference/glossary#std-term-chunk) covered by a zone only to those shards associated with the zone.

Each zone covers one or more ranges of [shard key](/docs/manual/reference/glossary#std-term-shard-key) values. Each range a zone covers is always inclusive of its lower boundary and exclusive of its upper boundary.

![Diagram of data distribution based on zones in a sharded cluster](/images/sharded-cluster-zones.bakedsvg.svg)

You must use fields contained in the [shard key](/docs/manual/reference/glossary#std-term-shard-key) when defining a new range for a zone to cover. If using a [compound](/docs/manual/reference/glossary#std-term-compound-index) shard key, the range must include the prefix of the shard key. See [shard keys in zones](/docs/manual/core/zone-sharding#std-label-zone-sharding-shard-key) for more information.

Consider potential future zone use when choosing a shard key.

**Tip:**

Setting up zones and zone ranges *before* you shard an empty or a non-existing collection allows for a faster setup of zoned sharding.

See [zones](/docs/manual/core/zone-sharding#std-label-zone-sharding) for more information.

## Collations in Sharding

Use the [`shardCollection`](/docs/manual/reference/command/shardCollection#mongodb-dbcommand-dbcmd.shardCollection) command with the `collation : { locale : "simple" }` option to shard a collection which has a [default collation](/docs/manual/reference/collation#std-label-collation). Successful sharding requires that:

- The collection must have an index whose prefix is the shard key

- The index must have the collation `{ locale: "simple" }`

When creating new collections with a collation, ensure these conditions are met before sharding the collection.

**Note:**

Queries on the sharded collection continue to use the default collation configured for the collection. To use the shard key index's `simple` collation, specify `{locale : "simple"}` in the query's [collation document.](/docs/manual/reference/collation#std-label-collation)

See [`shardCollection`](/docs/manual/reference/command/shardCollection#mongodb-dbcommand-dbcmd.shardCollection) for more information about sharding and collation.

## Change Streams

[Change streams](/docs/manual/changeStreams#std-label-changeStreams) are available for replica sets and sharded clusters. Change streams allow applications to access real-time data changes without the complexity and risk of tailing the oplog.

## Transactions

[Distributed transactions](/docs/manual/core/transactions#std-label-transactions) support multi-document transactions on sharded clusters.

Until a transaction commits, the data changes made in the transaction are not visible outside the transaction.

However, when a transaction writes to multiple shards, not all outside read operations need to wait for the result of the committed transaction to be visible across the shards. For example, if a transaction is committed and write 1 is visible on shard A but write 2 is not yet visible on shard B, an outside read at read concern [`"local"`](/docs/manual/reference/read-concern-local#mongodb-readconcern-readconcern.-local-) can read the results of write 1 without seeing write 2.

## Learn More

### Practical MongoDB Aggregations E-Book

For more information on how sharding works with [aggregations](/docs/manual/core/aggregation-pipeline#std-label-aggregation-pipeline), read the sharding chapter in the [Practical MongoDB Aggregations](https://www.practical-mongodb-aggregations.com/guides/sharding.html) e-book.

### Additional Information

- [Transactions](/docs/manual/core/transactions)

- [Production Considerations](/docs/manual/core/transactions-production-consideration)

- [Production Considerations (Sharded Clusters)](/docs/manual/core/transactions-sharded-clusters)
