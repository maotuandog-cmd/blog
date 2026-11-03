> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# MongoDB Performance

As you develop and operate applications with MongoDB, you may need to analyze the performance of the application and its database. When you encounter degraded performance, it is often a function of database access strategies, hardware availability, and the number of open database connections.

You may experience performance limitations from inadequate or inappropriate indexing strategies or poor schema design patterns. [Locking Performance](/docs/manual/administration/analyzing-mongodb-performance#std-label-analyzing-performance-locks) discusses how these can impact MongoDB's internal locking.

Performance issues may indicate that the database is operating at capacity and that it is time to add additional capacity to the database. In particular, the application's working set should fit in the available physical memory.

In some cases performance issues may be temporary and related to abnormal traffic load. As discussed in [Number of Connections](/docs/manual/administration/analyzing-mongodb-performance#std-label-number-of-connections), scaling can help reduce excessive traffic.

Database profiling can help you understand what operations are causing degradation.

## Locking Performance

MongoDB uses a locking system to ensure data set consistency. If certain operations are long-running or a queue forms, performance degrades as requests and operations wait for the lock.

Lock-related slowdowns can be intermittent. To see if the lock has been affecting your performance, see the [locks](/docs/manual/reference/command/serverStatus#std-label-server-status-locks) section and the [globalLock](/docs/manual/reference/command/serverStatus#std-label-globalLock) section of the [`serverStatus`](/docs/manual/reference/command/serverStatus#mongodb-dbcommand-dbcmd.serverStatus) output.

**Note:**

Some `serverStatus` response fields are not returned on MongoDB Atlas Free clusters or Flex clusters. For more information, see [Limited Commands](https://www.mongodb.com/docs/atlas/unsupported-commands/#std-label-free-shard-commands-with-limits) in the MongoDB Atlas documentation.

Dividing [`locks.<type>.timeAcquiringMicros`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.locks.-type-.timeAcquiringMicros) by [`locks.<type>.acquireWaitCount`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.locks.-type-.acquireWaitCount) can give an approximate average wait time for a particular lock mode.

[`locks.<type>.deadlockCount`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.locks.-type-.deadlockCount) provides the number of times the lock acquisitions encountered deadlocks.

If [`globalLock.currentQueue.total`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.globalLock.currentQueue.total) is consistently high, many requests may be waiting for a lock. This indicates a possible concurrency issue that may be affecting performance.

If [`globalLock.totalTime`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.globalLock.totalTime) is high relative to [`uptime`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.uptime), the database has been in a locked state for a significant period.

Long queries can result from:

- Ineffective use of indexes

- Non-optimal schema design

- Poor query structure

- System architecture issues

- Insufficient RAM resulting in disk reads

## Number of Connections

In some cases, the number of connections between the applications and the database can overwhelm the server's ability to handle requests. The following fields in the [`serverStatus`](/docs/manual/reference/command/serverStatus#mongodb-dbcommand-dbcmd.serverStatus) document provide insight:

- [`connections`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.connections) is a container for the following two fields:

  - [`connections.current`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.connections.current) the total number of current clients connected to the database instance.

  - [`connections.available`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.connections.available) the total number of unused connections available for new clients.

Many concurrent application requests may overwhelm the server's ability to keep up with demand. If this is the case, increase the capacity of your deployment.

For write-heavy applications, deploy [sharding](/docs/manual/sharding) and add one or more [shards](/docs/manual/reference/glossary#std-term-shard) to a [sharded cluster](/docs/manual/reference/glossary#std-term-sharded-cluster) to distribute load among [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances.

Spikes in the number of connections can also result from application or driver errors. All officially supported MongoDB drivers implement connection pooling, which allows clients to use and reuse connections more efficiently. An extremely high number of connections, particularly without corresponding workload, often indicates a driver or other configuration error.

### Self-Managed Connection Limits

Unless constrained by system-wide limits, the maximum number of incoming connections supported by MongoDB is configured with the [`maxIncomingConnections`](/docs/manual/reference/configuration-options#mongodb-setting-net.maxIncomingConnections) setting. On Unix-based systems, system-wide limits can be modified using the `ulimit` command, or by editing your system's `/etc/sysctl` file. See [UNIX `ulimit` Settings for Self-Managed Deployments](/docs/manual/reference/ulimit#std-label-ulimit) for more information.

### MongoDB Atlas Connection Limits

MongoDB Atlas sets the limit for concurrent incoming connections based on the cluster tier and class. To learn more, see [Connection Limits and Cluster Tier](https://www.mongodb.com/docs/atlas/reference/atlas-limits/#std-label-connection-limits) in the Atlas documentation.
