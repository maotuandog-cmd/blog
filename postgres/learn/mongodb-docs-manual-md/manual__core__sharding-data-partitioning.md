> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Data Partitioning with Chunks

MongoDB uses the [shard key](/docs/manual/reference/glossary#std-term-shard-key) associated to the collection to partition the data into [chunks](/docs/manual/reference/glossary#std-term-chunk) owned by a specific shard. A [chunk](/docs/manual/reference/glossary#std-term-chunk) consists of a [range](/docs/manual/reference/glossary#std-term-range) of sharded data. Each chunk has inclusive lower and exclusive upper limits based on the [shard key.](/docs/manual/reference/glossary#std-term-shard-key)

![Diagram of the shard key value space segmented into smaller ranges or chunks.](/images/sharding-range-based.bakedsvg.svg)

The smallest unit of data a chunk can represent is a single unique shard key value.

## Initial Chunks

### Populated Collection

- The sharding operation creates one large initial chunk to cover all of the shard key values.

- After the initial chunk creation, the balancer moves ranges off of the initial chunk when it needs to start balancing data.

### Empty Collection

- If you have [zones and zone ranges](/docs/manual/core/zone-sharding#std-label-zone-sharding) defined for an empty or non-existing collection.

  - The sharding operation creates empty chunks for the defined zone ranges and any additional chunks to cover the entire range of the shard key values and performs an initial chunk distribution based on the zone ranges. This initial creation and distribution of chunks allows for faster setup of zoned sharding.

  - After the initial distribution, the balancer manages the chunk distribution going forward.

- If you do not have zones and zone ranges defined for an empty or non-existing collection:

  - For hashed sharding:

    - The sharding operation creates empty chunks to cover the entire range of the shard key values and performs an initial chunk distribution. By default, the operation creates 2 chunks per shard and migrates across the cluster.

    - After the initial distribution, the balancer manages the chunk distribution going forward.

  - For ranged sharding:

    - The sharding operation creates a single empty chunk to cover the entire range of the shard key values.

    - After the initial chunk creation, the balancer migrates the initial chunk across the shards as appropriate and manages the chunk distribution going forward.

**See also:**

[`sh.balancerCollectionStatus()`](/docs/manual/reference/method/sh.balancerCollectionStatus#mongodb-method-sh.balancerCollectionStatus)

## Range Size

The default [range](/docs/manual/reference/glossary#std-term-range) size in MongoDB is 128 megabytes. You can [increase or reduce the chunk size](/docs/manual/tutorial/modify-chunk-size-in-sharded-cluster#std-label-tutorial-modifying-range-size). Consider the implications of changing the default chunk size:

1. Small ranges lead to a more even distribution of data at the expense of more frequent migrations, which adds overhead at the query routing ([`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos)) layer.

2. Large ranges lead to fewer migrations, reducing networking and internal overhead at the query routing layer, but may result in an uneven distribution of data.

3. Range size affects the [Maximum Number of Documents Per Range to Migrate.](/docs/manual/reference/limits#mongodb-limit-Maximum-Number-of-Documents-Per-Range-to-Migrate)

For most deployments, a slightly uneven data distribution is preferable to frequent migrations.

## Range Migration

MongoDB migrates data ranges in a [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster) to distribute the data of a sharded collection evenly among shards. Migrations may be either:

- Manual. Only use manual migration in limited cases, such as to distribute data during bulk inserts. See [Migrating Chunks Manually](/docs/manual/tutorial/migrate-chunks-in-sharded-cluster#std-label-migrate-chunks-sharded-cluster) for more details.

* Automatic. The [balancer](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing) process automatically migrates data when there is an uneven distribution of a sharded collection's data across the shards. See [Migration Thresholds](/docs/manual/core/sharding-balancer-administration#std-label-sharding-migration-thresholds) for more details.

For more information on the sharded cluster [balancer](/docs/manual/reference/glossary#std-term-balancer), see [Sharded Cluster Balancer.](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing)

**See also:**

[`shardingStatistics.countDonorMoveChunkLockTimeout`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.shardingStatistics.countDonorMoveChunkLockTimeout)

### Balancing

The [balancer](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing-internals) is a background process that manages data migrations. If the data imbalance between the largest and smallest shard exceeds the [migration thresholds](/docs/manual/core/sharding-balancer-administration#std-label-sharding-migration-thresholds), the balancer begins migrating data across the cluster.

![Collection distributed across 3 shards triggers a chunk migration after reaching threshold of 2.](/images/sharding-migrating.bakedsvg.svg)

You can [manage](/docs/manual/tutorial/manage-sharded-cluster-balancer#std-label-sharded-cluster-balancer) certain aspects of the balancer. The balancer also respects any [zones](/docs/manual/reference/glossary#std-term-zone) created as a part of configuring zones in a sharded cluster.

See [Sharded Cluster Balancer](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing) for more information on the [balancer.](/docs/manual/reference/glossary#std-term-balancer)

### Reshard to Balance

When you run the [`sh.shardCollection()`](/docs/manual/reference/method/sh.shardCollection#mongodb-method-sh.shardCollection) method, the balancer begins distributing the collection data to other shards in the cluster. A single shard can only participate in one chunk migration at a time. When MongoDB succeeds in copying a range of data from one shard to another, the range on the donor shard is marked for removal by the range deleter. This process is slow and resource intensive.

Starting in MongoDB 8.0, if your deployment meets the [resource requirements](/docs/manual/core/reshard-to-same-key#std-label-reshard-to-same-key-req), it's recommended that you use the [`sh.shardAndDistributeCollection()`](/docs/manual/reference/method/sh.shardAndDistributeCollection#mongodb-method-sh.shardAndDistributeCollection) method to shard the collection. This method wraps the [`shardCollection`](/docs/manual/reference/command/shardCollection#mongodb-dbcommand-dbcmd.shardCollection) and [`reshardCollection`](/docs/manual/reference/command/reshardCollection#mongodb-dbcommand-dbcmd.reshardCollection) commands to shard the collection and immediately reshard it to the same key. This causes MongoDB to rebalance data across the shards without waiting on the balancer.

For more information, see [Reshard to the Same Shard Key.](/docs/manual/core/reshard-to-same-key#std-label-reshard-to-same-key)

## Indivisible/Jumbo Chunks

Chunks that grow beyond the [specified chunk size](/docs/manual/core/sharding-data-partitioning#std-label-sharding-chunk-size) but cannot be split are called **jumbo** chunks. The most common cause is when a chunk represents a single shard key value. Jumbo chunks can become a performance bottleneck, especially if the shard key value occurs with high [frequency.](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency)

Starting in MongoDB 5.0, you can [reshard a collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) by changing a document's shard key.

The [`refineCollectionShardKey`](/docs/manual/reference/command/refineCollectionShardKey#mongodb-dbcommand-dbcmd.refineCollectionShardKey) command enables more fine-grained data distribution and can resolve jumbo chunks caused by insufficient shard key cardinality.

To learn whether you should reshard your collection or refine your shard key, see [Change a Shard Key.](/docs/manual/core/sharding-change-a-shard-key#std-label-change-a-shard-key)

For more information, see:

- [Clear `jumbo` Flag](/docs/manual/tutorial/clear-jumbo-flag#std-label-clear-jumbo-flag)

- [Maximum Number of Documents Per Range to Migrate](/docs/manual/core/sharding-balancer-administration#std-label-migration-chunk-size-limit)
