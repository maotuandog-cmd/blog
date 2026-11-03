> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Troubleshoot Shard Keys

The ideal shard key allows MongoDB to distribute documents evenly throughout the cluster while facilitating common query patterns. A suboptimal shard key can lead to the following problems:

- [Jumbo chunks](/docs/manual/core/sharding-troubleshooting-shard-keys#std-label-sharding-troubleshooting-jumbo-chunks)

- [Uneven load distribution](/docs/manual/core/sharding-troubleshooting-shard-keys#std-label-sharding-troubleshooting-monotonicity)

- [Decreased query performance over time](/docs/manual/core/sharding-troubleshooting-shard-keys#std-label-sharding-troubleshooting-scatter-gather)

In the following you can find out more about common problems with shard keys and how to resolve them.

## Jumbo Chunks

If you are seeing [jumbo chunks](/docs/manual/core/sharding-data-partitioning#std-label-jumbo-chunks), either the [cardinality](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-cardinality) of your shard key is insufficient or the [frequency](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-frequency) of the shard key values is unevenly distributed.

To increase the cardinality of your shard key or change the distribution of your shard key values, you can:

- [refine your shard key](/docs/manual/core/sharding-refine-a-shard-key#std-label-shard-key-refine) by adding a suffix field or fields to the existing key to increase cardinality

- [reshard your collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) using a different shard key with higher cardinality

To learn whether you should reshard your collection or refine your shard key, see [Change a Shard Key.](/docs/manual/core/sharding-change-a-shard-key#std-label-change-a-shard-key)

To only change the distribution of your shard key values, you can also consider using [Hashed Sharding](/docs/manual/core/hashed-sharding) to distribute your data more evenly.

For advice on choosing a shard key see [Choose a Shard Key.](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-shard-key-selection)

## Uneven Load Distribution

If your cluster is experiencing uneven load distribution, check if your shard key increases [monotonically](/docs/manual/core/sharding-choose-a-shard-key#std-label-shard-key-monotonic). A shard key that is a monotonically increasing field, leads to an uneven read and write distribution.

Consider an `orders` collection that is sharded on an `order_id` field. The `order_id` is an integer which increases by one with each order.

- New documents are generally written to the same shard and chunk. The shard and chunk that receive the writes are called *hot* shard and *hot* chunk. The *hot* shard changes over time. When chunks are split, the hot chunk moves to a different shard to optimize data distribution.

- If users are more likely to interact with recent orders, which are all on the same shard, the shard that contains recent orders will receive most of the traffic.

If you have a monotonically increasing shard key, consider [resharding your collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding). For advice on choosing a shard key see [Choose a Shard Key.](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-shard-key-selection)

If your data model requires sharding on a key that changes monotonically, consider using [Hashed Sharding.](/docs/manual/core/hashed-sharding)

## Decreased Query Performance Over Time

If you are noticing decreased query performance over time, it is possible that your cluster is performing [scatter-gather queries.](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-query-patterns)

To evaluate if your cluster is performing scatter-gather queries, check if your most common queries include the shard key.

If you include the shard key in your queries, check if your shard key is hashed. With [Hashed Sharding](/docs/manual/core/hashed-sharding), documents are not stored in ascending or descending order of the shard key field value. Performing range based queries on the shard key value on data that is not stored in ascending or descending order results in less performant scatter-gather queries. If range based queries on your shard key are a common access pattern, consider [resharding your collection.](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding)

If you do not include the shard key in your most common queries, it is possible that you could increase performance by [resharding your collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding). For advice on choosing a shard key see [Choose a Shard Key.](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-shard-key-selection)
