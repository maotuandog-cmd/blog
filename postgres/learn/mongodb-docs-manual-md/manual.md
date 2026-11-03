> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# What is MongoDB?

MongoDB is a document database designed to help developers build modern applications faster. It stores data in flexible, JSON-like documents, making it easy to model data the same way your application code uses it. The flexible schema lets you evolve your data model without downtime, iterate quickly, and easily handle non-uniform data.

MongoDB provides a powerful query engine, horizontal scaling, and built-in high availability so you can support everything from rapid prototyping to large, mission-critical workloads.

MongoDB is a fully-transactional operational database that supports a wide range of workload types including:

- [Document-based structured search (OLTP)](/docs/manual/reference/mql#std-label-mql-reference)

- [Data aggregation](/docs/manual/aggregation#std-label-aggregation)

- [Full-text search](https://www.mongodb.com/docs/search/#std-label-fts-top-ref)

- [Vector search](https://www.mongodb.com/docs/vector-search/#std-label-fts-vector-search)

- [Geospatial search](/docs/manual/geospatial-queries)

- [Time series](/docs/manual/core/timeseries-collections#std-label-manual-timeseries-landing)

## Core Architecture

MongoDB is built on several core architectural components that distinguish it from relational databases:

- [Document Database](/docs/manual/index#std-label-manual-landing-document-database): The flexible document data model lets you map your data to your application's needs.

- [Transactions](/docs/manual/index#std-label-manual-landing-transactions): Multi-document ACID transactions allow complex operations that require data consistency.

- [High Availability](/docs/manual/index#std-label-manual-landing-high-availability): Replication and automatic failover ensure your data is always available.

- [Horizontal Scaling](/docs/manual/index#std-label-manual-landing-horizontal-scaling): Sharding enables horizontal scaling to handle large datasets and high throughput.

### Document Database

A record in MongoDB is a document, which is a data structure composed of field and value pairs. MongoDB documents are similar to JSON objects. The values of fields may include other documents, arrays, and arrays of documents.

MongoDB's flexible object-oriented data model lets you structure data in a way that mirrors the object models in your codebase. This eliminates the need for the complex object-relational mapping required when using relational databases.

Here is an example of a MongoDB document that shows how documents can express complex, hierarchical data in a format that mirrors your application's object model:

```javascript
{
  _id: ObjectId("507f1f77bcf86cd799439011"),
  name: "Alice",
  birthdate: ISODate("1990-01-01T00:00:00Z"),
  address: {
    street: "123 Main St",
    city: "Springfield",
    state: "IL"
  },
  hobbies: ["reading", "hiking", "coding"]
}
```

Additional advantages of the document data model are:

- Documents correspond to native data types in many programming languages.

- Embedded documents and arrays reduce need for expensive joins that can slow down performance.

- Dynamic schemas support polymorphism, which allows varied structures among documents in the same collection.

MongoDB stores documents in [Collections](/docs/manual/core/databases-and-collections#std-label-collections). Collections are similar to relational tables but do not enforce a rigid, pre-defined schema.

In addition to collections, MongoDB supports read-only [views.](/docs/manual/core/views#std-label-views-landing-page)

### Transactions

MongoDB supports multi-document transactions, which let you run multiple read and write operations as a single all-or-nothing event.

Key transaction features include:

- **ACID Guarantees:** Transactions provide atomicity, consistency, isolation, and durability across multiple operations.

- **Multi-Document Operations:** You can run complex operations that span multiple documents while maintaining data consistency.

- **Distributed Transactions:** You can coordinate transactions across sharded clusters with the same ACID guarantees.

To learn more, see [Transactions.](/docs/manual/core/transactions#std-label-transactions)

### High Availability

MongoDB's built-in replication mechanism provides automatic failover, data redundancy, and increased read capacity. With automatic failover, if the primary server becomes unavailable, the cluster automatically elects a new primary, which ensures that writes remain available. Additionally, multiple copies of your data are stored across different servers to improve data durability.

### Horizontal Scaling

MongoDB natively supports horizontal scaling through a technique called [Sharding.](/docs/manual/sharding#std-label-sharding-introduction)

Key sharding features include:

- **Automatic Data Distribution:** MongoDB automatically partitions data based on a shard key and distributes it across a cluster of machines.

- **Zone Sharding:** You can define geographical zones to control the placement of documents based on shard key ranges.

- **Shard Key Refinement:** You can refine your shard key to improve performance as your application evolves.
