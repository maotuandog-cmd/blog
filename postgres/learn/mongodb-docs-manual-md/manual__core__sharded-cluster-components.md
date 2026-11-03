> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# Sharded Cluster Components

A MongoDB [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster) consists of the following components:

- [shard](/docs/manual/core/sharded-cluster-shards#std-label-shards-concepts): Each shard contains a subset of the sharded data. Each shard must be deployed as a [replica set.](/docs/manual/reference/glossary#std-term-replica-set)

- [Routing with mongos](/docs/manual/core/sharded-cluster-query-router): The `mongos` acts as a query router, providing an interface between client applications and the sharded cluster.

- [config servers](/docs/manual/core/sharded-cluster-config-servers#std-label-sharding-config-server): Config servers store metadata and configuration settings for the cluster. Config servers must be deployed as a replica set (CSRS).

## Production Configuration

In a production cluster, ensure that data is redundant and that your systems are highly available. Consider the following for a production sharded cluster deployment:

- Deploy Config Servers as a 3 member [replica set](/docs/manual/reference/glossary#std-term-replica-set)

- Deploy each Shard as a 3 member [replica set](/docs/manual/reference/glossary#std-term-replica-set)

- Deploy one or more [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) routers

### Replica Set Distribution

For production deployments, we recommend deplying config server and shard replica sets on at least three data centers. This configuration provides high availability in case a single data center goes down.

### Number of Shards

Sharding requires at least two shards to distribute sharded data. Single shard sharded clusters may be useful if you plan on enabling sharding in the  near future, but do not need to at the time of deployment.

### Number of `mongos` and Distribution

[`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) routers support high availability and scalability when deploying multiple `mongos` instances. If a proxy or load balancer is between the application and the `mongos` routers, you must configure it for [client affinity](/docs/manual/reference/glossary#std-term-client-affinity). Client affinity allows every connection from a single client to reach the same `mongos`. For shard-level high availability, either:

- Add `mongos` instances on the same hardware where `mongod` instances are already running.

- Embed `mongos` routers on the same hardware where the application is hosted.

[`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) routers communicate frequently with your config servers. As you increase the number of routers, performance may degrade. If performance degrades, reduce the number of routers.

The following diagram shows a common sharded cluster architecture used in production:

![Diagram that shows a production-level sharded cluster containing multiple shards and mongos routers.](/images/sharded-cluster-production-architecture.png)

## Development Configuration

For testing and development, you can deploy a sharded cluster with a minimum number of components. These **non-production** clusters have the following components:

- One [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instance.

- A single shard [replica set.](/docs/manual/reference/glossary#std-term-replica-set)

- A replica set [config server.](/docs/manual/core/sharded-cluster-config-servers#std-label-sharding-config-server)

The following diagram shows a sharded cluster architecture used for **development only**:

![Diagram that shows a development sharded cluster containing a single shard and mongos router.](/images/sharded-cluster-test-architecture.png)

**Warning:**

Use the test cluster architecture for testing and development only.

**See also:**

[Deploy a Self-Managed Sharded Cluster](/docs/manual/tutorial/deploy-shard-cluster/)
