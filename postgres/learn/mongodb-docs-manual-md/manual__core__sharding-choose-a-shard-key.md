> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Choose a Shard Key

When you choose your shard key, consider:

- the [cardinality](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-range) of the shard key

- the [frequency](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency) with which shard key values occur

- whether a potential shard key grows [monotonically](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic)

- [Sharding Query Patterns](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-query-patterns)

- [Shard Key Limitations](/docs/manual/reference/limits#std-label-limits-shard-keys)

**Note:**

- Starting in MongoDB 5.0, you can [change your shard key](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) and redistribute your data using the [`reshardCollection`](/docs/manual/reference/command/reshardCollection#mongodb-dbcommand-dbcmd.reshardCollection) command.

- You can use the [`refineCollectionShardKey`](/docs/manual/reference/command/refineCollectionShardKey#mongodb-dbcommand-dbcmd.refineCollectionShardKey) command to refine a collection's shard key. The [`refineCollectionShardKey`](/docs/manual/reference/command/refineCollectionShardKey#mongodb-dbcommand-dbcmd.refineCollectionShardKey) command adds a suffix field or fields to the existing key to create the new shard key.

- You can update a document's shard key value unless the shard key field is the immutable `_id` field.

**Important:**

If you regularly change a document's shard key value so that the value is in a shard key range owned by a different shard, it may impact cluster performance due to the additional resources involved in migrating the document between shards. For details, see [Data Partitioning with Chunks](/docs/manual/core/sharding-data-partitioning#std-label-sharding-data-partitioning) and [db.collection.updateOne().](/docs/manual/reference/method/db.collection.updateOne#std-label-updateOne-shard-key-modification)

## Shard Key Cardinality

The [cardinality](/docs/manual/reference/glossary#std-term-cardinality) of a shard key determines the maximum number of chunks the balancer can create. Where possible, choose a shard key with high cardinality. A shard key with low cardinality reduces the effectiveness of horizontal scaling in the cluster.

Each unique shard key value can exist on no more than a single chunk at any given time. Consider a dataset that contains user data with a `continent` field. If you chose to shard on `continent`, the shard key would have a cardinality of `7`. A cardinality of `7` means there can be no more than `7` chunks within the sharded cluster, each storing one unique shard key value. This constrains the number of effective shards in the cluster to `7` as well - adding more than seven shards would not provide any benefit.

The following image illustrates a sharded cluster using the field `X` as the shard key. If `X` has low cardinality, the distribution of inserts may look similar to the following:

![Diagram of poor shard key distribution due to low cardinality](/images/sharded-cluster-ranged-distribution-low-cardinal.bakedsvg.svg)

If your data model requires sharding on a key that has low cardinality, consider using an indexed [compound](/docs/manual/reference/glossary#std-term-compound-index) of fields to increase cardinality.

A shard key with high cardinality does not, on its own, guarantee even distribution of data across the sharded cluster. The [frequency](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency) of the shard key and the potential for [monotonically changing shard key values](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic) also contribute to the distribution of the data.

## Shard Key Frequency

The `frequency` of the shard key represents how often a given shard key value occurs in the data. If the majority of documents contain only a subset of the possible shard key values, then the chunks storing the documents with those values can become a bottleneck within the cluster. Furthermore, as those chunks grow, they may become [indivisible chunks](/docs/manual/core/sharding-data-partitioning#std-label-jumbo-chunks) as they cannot be split any further. This reduces the effectiveness of horizontal scaling within the cluster.

The following image illustrates a sharded cluster using the field `X` as the shard key. If a subset of values for `X` occur with high frequency, the distribution of inserts may look similar to the following:

![Diagram of poor shard key distribution due to high frequency](/images/sharded-cluster-ranged-distribution-frequency.bakedsvg.svg)

If your data model requires sharding on a key that has high frequency values, consider using a [compound index](/docs/manual/reference/glossary#std-term-compound-index) using a unique or low frequency value.

A shard key with low frequency does not, on its own, guarantee even distribution of data across the sharded cluster. The [cardinality](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-cardinality) of the shard key and the potential for [monotonically changing shard key values](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic) also contribute to the distribution of the data.

## Monotonically Changing Shard Keys

A shard key on a value that increases or decreases monotonically is more likely to distribute inserts to a single chunk within the cluster.

This occurs because every cluster has a chunk that captures a range with an upper bound of [`MaxKey`](/docs/manual/reference/mongodb-extended-json#mongodb-bsontype-MaxKey). `maxKey` always compares as higher than all other values. Similarly, there is a chunk that captures a range with a lower bound of [`MinKey`](/docs/manual/reference/mongodb-extended-json#mongodb-bsontype-MinKey). `minKey` always compares as lower than all other values.

If the shard key value is always increasing, all new inserts are routed to the chunk with `maxKey` as the upper bound. If the shard key value is always decreasing, all new inserts are routed to the chunk with `minKey` as the lower bound. The shard containing that chunk becomes the bottleneck for write operations.

To optimize data distribution, the chunks that contain the global `maxKey` (or `minKey`) do not stay on the same shard. When a chunk is split, the new chunk with the `maxKey` (or `minKey`) chunk is located on a different shard.

The following image illustrates a sharded cluster using the field `X` as the shard key. If the values for `X` are monotonically increasing, the distribution of inserts may look similar to the following:

![Diagram of poor shard key distribution due to monotonically increasing or decreasing shard key](/images/sharded-cluster-monotonic-distribution.bakedsvg.svg)

If the shard key value was monotonically decreasing, then all inserts would route to `Chunk A` instead.

If your data model requires sharding on a key that changes monotonically, consider using [Hashed Sharding.](/docs/manual/core/hashed-sharding)

A shard key that does not change monotonically does not, on its own, guarantee even distribution of data across the sharded cluster. The [cardinality](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-cardinality) and [frequency](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency) of the shard key also contribute to the distribution of the data.

## Sharding Query Patterns

The ideal shard key distributes data evenly across the sharded cluster while also facilitating common query patterns. When you choose a shard key, consider your most common query patterns and whether a given shard key covers them.

In a sharded cluster, the [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) routes queries to only the shards that contain the relevant data if the queries contain the shard key. When the queries do not contain the shard key, the queries are broadcast to all shards for evaluation. These types of queries are called scatter-gather queries. Queries that involve multiple shards for each request are less efficient and do not scale linearly when more shards are added to the cluster.

This does not apply for aggregation queries that operate on a large amount of data. In these cases, scatter-gather can be a useful approach that allows the query to run in parallel on all shards.

## Use Shard Key Analyzer in 7.0 to Find Your Shard Key

Starting in 7.0, MongoDB makes it easier to choose your shard key. You can use [`analyzeShardKey`](/docs/manual/reference/command/analyzeShardKey#mongodb-dbcommand-dbcmd.analyzeShardKey) which calculates metrics for evaluating a shard key for an unsharded or sharded collection. Metrics are based on sampled queries, allowing you to make a data-driven choice for your shard key.

### Enable Query Sampling

To analyze a shard key, you must enable query sampling on the target collection. For more information, see:

- [`configureQueryAnalyzer`](/docs/manual/reference/command/configureQueryAnalyzer#mongodb-dbcommand-dbcmd.configureQueryAnalyzer) database command

- [`db.collection.configureQueryAnalyzer()`](/docs/manual/reference/method/db.collection.configureQueryAnalyzer#mongodb-method-db.collection.configureQueryAnalyzer) shell method

To monitor the query sampling process, use the [`$currentOp`](/docs/manual/reference/operator/aggregation/currentOp#mongodb-pipeline-pipe.-currentOp) stage. For an example, see [Sampled Queries.](/docs/manual/reference/operator/aggregation/currentOp#std-label-sampled-queries-currentOp-stage)

### Shard Key Analysis Commands

To analyze a shard key, see:

- [`analyzeShardKey`](/docs/manual/reference/command/analyzeShardKey#mongodb-dbcommand-dbcmd.analyzeShardKey) database command

- [`db.collection.analyzeShardKey()`](/docs/manual/reference/method/db.collection.analyzeShardKey#mongodb-method-db.collection.analyzeShardKey) shell method

`analyzeShardKey` returns metrics about key characteristics of a shard key and its read and write distribution. The metrics are based on sampled queries.

- The `keyCharacteristics` field contains metrics about the [cardinality](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-cardinality), [frequency](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency), and [monotonicity](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic) of the shard key.

- The `readWriteDistribution` field contains [metrics](/docs/manual/reference/command/analyzeShardKey#std-label-read-write-distribution-output) about the query routing patterns and the load distribution of shard key ranges.

**See also:**

- [Read Operations to Sharded Clusters](/docs/manual/core/distributed-queries#std-label-read-operations-sharded-clusters)

- [Targeted Operations vs. Broadcast Operations](/docs/manual/core/sharded-cluster-query-router#std-label-sharding-query-router-broadcast-targeted)
