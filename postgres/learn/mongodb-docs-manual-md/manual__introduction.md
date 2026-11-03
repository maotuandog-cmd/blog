> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Introduction to MongoDB

You can create a MongoDB database in the following environments:

- [MongoDB Atlas](https://www.mongodb.com/docs/atlas): The fully managed service for MongoDB deployments in the cloud

* [MongoDB Enterprise](/docs/manual/administration/install-enterprise#std-label-install-mdb-enterprise): The subscription-based, self-managed version of MongoDB

* [MongoDB Community](/docs/manual/administration/install-community#std-label-install-mdb-community-edition): The source-available, free-to-use, and self-managed version of MongoDB

To learn more about creating a MongoDB database with the Atlas UI, see [Get Started with Atlas.](https://www.mongodb.com/docs/get-started/#std-label-unified-get-started)

## Document Database

A record in MongoDB is a document, which is a data structure composed of field and value pairs. MongoDB documents are similar to JSON objects. The values of fields may include other documents, arrays, and arrays of documents.

![A MongoDB document.](/images/crud-annotated-document.svg)

The advantages of using documents are:

- Documents correspond to native data types in many programming languages.

- Embedded documents and arrays reduce need for expensive joins.

- Dynamic schema supports fluent polymorphism.

### Collections/Views/On-Demand Materialized Views

MongoDB stores documents in [collections](/docs/manual/core/databases-and-collections#std-label-collections). Collections are analogous to tables in relational databases.

In addition to collections, MongoDB supports:

- Read-only [Views](/docs/manual/core/views)

- [On-Demand Materialized Views](/docs/manual/core/materialized-views)

## Key Features

### High Performance

MongoDB provides high performance data persistence. In particular,

- Support for embedded data models reduces I/O activity on database system.

- Indexes support faster queries and can include keys from embedded documents and arrays.

### Query API

The MongoDB Query API supports [read and write operations (CRUD)](/docs/manual/crud#std-label-crud) as well as:

- [Data Aggregation](/docs/manual/core/aggregation-pipeline#std-label-aggregation-pipeline)

- [Text Search](/docs/manual/text-search#std-label-text-search) and [Geospatial Queries.](/docs/manual/tutorial/geospatial-tutorial)

**See also:**

- [SQL to MongoDB Mapping Chart](/docs/manual/reference/sql-comparison)

- [SQL to Aggregation Mapping Chart](/docs/manual/reference/sql-aggregation-comparison)

### High Availability

MongoDB's replication facility, called [replica set](/docs/manual/replication#std-label-replication), provides:

- *automatic* failover

- data redundancy.

A [replica set](/docs/manual/replication#std-label-replication) is a group of MongoDB servers that maintain the same data set, providing redundancy and increasing data availability.

### Horizontal Scalability

MongoDB provides horizontal scalability as part of its *core* functionality:

- [Sharding](/docs/manual/sharding#std-label-sharding-introduction) distributes data across a cluster of machines.

- Starting in 3.4, MongoDB supports creating [zones](/docs/manual/core/zone-sharding#std-label-zone-sharding) of data based on the [shard key](/docs/manual/reference/glossary#std-term-shard-key). In a balanced cluster, MongoDB directs reads and writes covered by a zone only to those shards inside the zone. See the [Zones](/docs/manual/core/zone-sharding#std-label-zone-sharding) manual page for more information.

### Support for Multiple Storage Engines

MongoDB supports [multiple storage engines:](/docs/manual/core/storage-engines)

- [WiredTiger Storage Engine](/docs/manual/core/wiredtiger) (including support for [Encryption at Rest)](/docs/manual/core/security-encryption-at-rest)

- [In-Memory Storage Engine for Self-Managed Deployments.](/docs/manual/core/inmemory)

In addition, MongoDB provides pluggable storage engine API that allows third parties to develop storage engines for MongoDB.
