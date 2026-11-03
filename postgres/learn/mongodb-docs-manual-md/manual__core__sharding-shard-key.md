> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Shard Keys

The shard key is either a single indexed [field](/docs/manual/reference/glossary#std-term-field) or multiple fields covered by a [compound index](/docs/manual/reference/glossary#std-term-compound-index) that determines the distribution of the collection's [documents](/docs/manual/reference/glossary#std-term-document) among the cluster's [shards](/docs/manual/reference/glossary#std-term-shard). For details, see [Shard Key Indexes.](/docs/manual/core/sharding-shard-key-indexes#std-label-sharding-shard-key-indexes)

MongoDB divides the span of shard key values (or hashed shard key values) into non-overlapping ranges. Each range is associated with a [chunk](/docs/manual/reference/glossary#std-term-chunk), and MongoDB attempts to distribute chunks evenly among the shards in the cluster.

![Diagram of the shard key value space segmented into smaller ranges or chunks.](/images/sharding-range-based.bakedsvg.svg)

## Shard a Collection

You can use the [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/#mongodb-binary-bin.mongosh) method [`sh.shardCollection()`](/docs/manual/reference/method/sh.shardCollection#mongodb-method-sh.shardCollection) to shard a collection. To shard a collection, you must specify the full namespace of the collection that you want to shard and the shard key.

```javascript
sh.shardCollection(<namespace>, <key>) // Optional parameters omitted
```

| `namespace` | Specify the full namespace of the collection that you want to shard (`"<database>.<collection>"`). |
| --- | --- |
| `key` | Specify a document `{ <shard key field1>: <1|"hashed">, ... }` where `1` indicates [range-based sharding](/docs/manual/core/ranged-sharding#std-label-sharding-ranged); `"hashed"` indicates [hashed sharding.](/docs/manual/core/hashed-sharding#std-label-sharding-hashed) |

For more information on the sharding method, see [`sh.shardCollection()`.](/docs/manual/reference/method/sh.shardCollection#mongodb-method-sh.shardCollection)

## Choose a Shard Key

The choice of shard key affects the creation and [distribution of data](/docs/manual/core/sharding-balancer-administration#std-label-sharding-balancing) across the available [shards](/docs/manual/reference/glossary#std-term-shard). The ideal shard key allows MongoDB to distribute documents evenly throughout the cluster while also facilitating common query patterns.

For details, see the [Choose a Shard Key](/docs/manual/core/sharding-choose-a-shard-key#std-label-sharding-internals-choose-shard-key) page.

## Change a Shard Key

You can change a shard key in two ways:

- You can [refine a shard key](/docs/manual/core/sharding-refine-a-shard-key#std-label-shard-key-refine) by adding fields to your existing key.

- You can change a shard key entirely and [reshard a collection](/docs/manual/core/sharding-reshard-a-collection#std-label-sharding-resharding) with the new key.

For details, see the [Change a Shard Key](/docs/manual/core/sharding-change-a-shard-key#std-label-change-a-shard-key) page.

## Change Shard Key Field Value for a Document

You can change the value for the shard key field in any document in your collection unless the shard key field is the `_id` field. This can affect which shard the document lives on.

For details, see [Change a Document's Shard Key Value.](/docs/manual/core/sharding-change-shard-key-value#std-label-update-shard-key)

## Set Missing Shard Key Fields

Documents in your collection can be missing fields that your shard key specifies. By default, documents that are missing fields specified by your shard key live in the same chunk range as shard keys with null values.

For details, see [Set Missing Shard Key Fields.](/docs/manual/core/sharding-set-missing-shard-key-fields#std-label-shard-key-missing-set)

## Display a Shard Key

Use [`db.printShardingStatus()`](/docs/manual/reference/method/db.printShardingStatus#mongodb-method-db.printShardingStatus) to display the shard key used for your collection.

For details, see [Display a Shard Key.](/docs/manual/core/sharding-find-shard-key#std-label-sharding-display-shard-key)

## Troubleshoot

Common issues caused by a suboptimal shard key are:

- Jumbo chunks

- Uneven load distribution

- Decreased query performance

For details, see [Troubleshoot Shard Keys.](/docs/manual/core/sharding-troubleshooting-shard-keys#std-label-shardkey-troubleshoot-shard-keys)
