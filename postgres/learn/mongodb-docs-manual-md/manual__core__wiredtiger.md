> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

# WiredTiger Storage Engine

The WiredTiger storage engine is the default storage engine. For existing deployments, if you do not specify the `--storageEngine` or the [`storage.engine`](/docs/manual/reference/configuration-options#mongodb-setting-storage.engine) setting, the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance can automatically determine the storage engine used to create the data files in the `--dbpath` or [`storage.dbPath`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath)

Deployments hosted in the following environments can use the WiredTiger storage engine:

- [MongoDB Atlas](https://www.mongodb.com/docs/atlas): The fully managed service for MongoDB deployments in the cloud

**Note:**

All MongoDB Atlas deployments use the WiredTiger storage engine.

- [MongoDB Enterprise](/docs/manual/administration/install-enterprise#std-label-install-mdb-enterprise): The subscription-based, self-managed version of MongoDB

- [MongoDB Community](/docs/manual/administration/install-community#std-label-install-mdb-community-edition): The source-available, free-to-use, and self-managed version of MongoDB

To learn more about WiredTiger memory use for deployments hosted in MongoDB Atlas, see [Memory](https://www.mongodb.com/docs/atlas/sizing-tier-selection/#memory).

## Operation and Limitations

The following operational notes and limitations apply to the WiredTiger engine:

- You can't pin documents to the WiredTiger cache.

- WiredTiger doesn't reserve a portion of the cache for reads and another for writes.

- WiredTiger allocates its cache to the entire [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance. WiredTiger doesn't allocate cache on a per-database or per-collection level.

## Transaction (Read and Write) Concurrency

Starting in version 7.0, MongoDB uses a default algorithm to dynamically adjust the maximum number of concurrent storage engine transactions, or read and write tickets. The dynamic concurrent storage engine transaction algorithm optimizes database throughput during cluster overload.

**Note:**

The dynamic algorithm also results in lower overall ticket usage, even under normal conditions, because the algorithm starts with a much lower baseline number of available tickets. As a result, when upgrading to MongoDB 7.0, you may observe a significant drop in ticket usage, which is expected behavior.

The maximum number of concurrent storage engine transactions, or read and write tickets, never exceeds 128 read tickets and 128 write tickets and may differ across nodes in a cluster. The maximum number of read tickets and write tickets within a single node are always equal.

To specify a maximum number of read and write transactions, or read and write tickets, that the dynamic maximum can not exceed, use [`storageEngineConcurrentReadTransactions`](/docs/manual/reference/parameters#mongodb-parameter-param.storageEngineConcurrentReadTransactions) and [`storageEngineConcurrentWriteTransactions`.](/docs/manual/reference/parameters#mongodb-parameter-param.storageEngineConcurrentWriteTransactions)

If you want to disable the dynamic concurrent storage engine transactions algorithm, file a support request to work with a MongoDB Technical Services Engineer.

To view the number of concurrent read transactions (read tickets) and write transactions (write tickets) allowed in the WiredTiger storage engine, use the [`serverStatus`](/docs/manual/reference/command/serverStatus#mongodb-dbcommand-dbcmd.serverStatus) command and see the [`queues.execution`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.queues.execution) response document.

**Note:**

A low value of [`available`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.available) in [`queues.execution`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.queues.execution) does not indicate a cluster overload. Use the number of queued read and write tickets as an indication of cluster overload.

## Document Level Concurrency

WiredTiger uses *document-level* concurrency control for write operations. As a result, multiple clients can modify different documents of a collection at the same time.

For most read and write operations, WiredTiger uses optimistic concurrency control. WiredTiger uses only intent locks at the global, database and collection levels. When the storage engine detects conflicts between two operations, one will incur a write conflict causing MongoDB to transparently retry that operation.

Some global operations, typically short lived operations involving multiple databases, still require a global "instance-wide" lock. Some other operations, such as [`renameCollection`](/docs/manual/reference/command/renameCollection#mongodb-dbcommand-dbcmd.renameCollection), still require an exclusive database lock in certain circumstances.

## Snapshots and Checkpoints

WiredTiger uses MultiVersion Concurrency Control (MVCC). At the start of an operation, WiredTiger provides a point-in-time snapshot of the data to the operation. A snapshot presents a consistent view of the in-memory data.

When writing to disk, WiredTiger writes all the data in a snapshot to disk in a consistent way across all data files. The now-[durable](/docs/manual/reference/glossary#std-term-durable) data act as a *checkpoint* in the data files. The *checkpoint* ensures that the data files are consistent up to and including the last checkpoint; i.e. checkpoints can act as recovery points.

MongoDB configures WiredTiger to create checkpoints, specifically, writing the snapshot data to disk at intervals of 60 seconds.

During the write of a new checkpoint, the previous checkpoint is still valid. As such, even if MongoDB terminates or encounters an error while writing a new checkpoint, upon restart, MongoDB can recover from the last valid checkpoint.

The new checkpoint becomes accessible and permanent when WiredTiger's metadata table is atomically updated to reference the new checkpoint. Once the new checkpoint is accessible, WiredTiger frees pages from the old checkpoints.

### Snapshot History Retention

Starting in MongoDB 5.0, you can use the [`minSnapshotHistoryWindowInSeconds`](/docs/manual/reference/parameters#mongodb-parameter-param.minSnapshotHistoryWindowInSeconds) parameter to specify how long WiredTiger keeps the snapshot history.

Increasing the value of [`minSnapshotHistoryWindowInSeconds`](/docs/manual/reference/parameters#mongodb-parameter-param.minSnapshotHistoryWindowInSeconds) increases disk usage because the server must maintain the history of older modified values within the specified time window. The amount of disk space used depends on your workload, with higher volume workloads requiring more disk space.

MongoDB maintains the snapshot history in the `WiredTigerHS.wt` file, located in your specified [`dbPath`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath)

## Journal

WiredTiger uses a write-ahead log (i.e. journal) in combination with [checkpoints](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger-checkpoints) to ensure data durability.

The WiredTiger journal persists all data modifications between checkpoints. If MongoDB exits between checkpoints, it uses the journal to replay all data modified since the last checkpoint. For information on the frequency with which MongoDB writes the journal data to disk, see [Journaling Process.](/docs/manual/core/journaling#std-label-journal-process)

WiredTiger journal is compressed using the [snappy](/docs/manual/reference/glossary#std-term-snappy) compression library. To specify a different compression algorithm or no compression, use the [`storage.wiredTiger.engineConfig.journalCompressor`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.journalCompressor) setting. For details on changing the journal compressor, see [Change WiredTiger Journal Compressor.](/docs/manual/tutorial/manage-journaling#std-label-manage-journaling-change-wt-journal-compressor)

**Note:**

If a log record is less than or equal to 128 bytes, which is the minimum [log record size for WiredTiger](/docs/manual/core/journaling#std-label-wt-jouraling-record), WiredTiger does not compress that record.

**See also:**

[Journaling with WiredTiger](/docs/manual/core/journaling#std-label-journaling-wiredTiger)

## Compression

With WiredTiger, MongoDB supports compression for all collections and indexes. Compression minimizes storage use at the expense of additional CPU.

By default, WiredTiger uses block compression with the [snappy](/docs/manual/reference/glossary#std-term-snappy) compression library for most collections and [prefix compression](/docs/manual/reference/glossary#std-term-prefix-compression) for all indexes. However, the default block compression for time-series collections is [zstd.](/docs/manual/reference/glossary#std-term-zstd)

For collections, the following block compression libraries are also available:

- [zlib](/docs/manual/reference/glossary#std-term-zlib)

- [zstd](/docs/manual/reference/glossary#std-term-zstd)

To specify an alternate compression algorithm or no compression, use the [`storage.wiredTiger.collectionConfig.blockCompressor`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.collectionConfig.blockCompressor) setting.

For indexes, to disable [prefix compression](/docs/manual/reference/glossary#std-term-prefix-compression), use the [`storage.wiredTiger.indexConfig.prefixCompression`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.indexConfig.prefixCompression) setting.

Compression settings are also configurable on a per-collection and per-index basis during collection and index creation. See [Specify Storage Engine Options](/docs/manual/reference/method/db.createCollection#std-label-create-collection-storage-engine-options) and [db.collection.createIndex() storageEngine option.](/docs/manual/reference/method/db.collection.createIndex#std-label-createIndex-options)

For most workloads, the default compression settings balance storage efficiency and processing requirements.

The WiredTiger journal is also compressed by default. For information on journal compression, see [Journal.](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger-journal)

## Memory Use

With WiredTiger, MongoDB utilizes both the WiredTiger internal cache and the filesystem cache.

##### Cache Configuration Settings

The default WiredTiger internal cache size is the larger of either:

- 50% of (RAM - 1GB), or

- 0.256 GB.

For example, on a system with a total of 4GB of RAM the WiredTiger cache uses 1.5GB of RAM (`0.5 * (4GB - 1GB) =
1.5 GB`). When providing a specific cache size ensure the RAM does not exceed the bounds of 0.256GB to 10000GB.

Avoid increasing the WiredTiger internal cache size above its default value. If your case requires to do so, you can use `--wiredTigerCacheSizePct` to account for changes in memory due to vertical. You must specify a percentage of up to 80% of available memory. Calculated values can range from 0.256GB to 10000GB. For example, on a system with 2GB of RAM the `--wiredTigerCacheSizePct` cannot be set to 10 because 10% of 2GB is 0.2 GB, which is less than 0.256GB.

**Note:**

In some instances, such as when running in a container that is configured to use less RAM than the amount of memory provisioned for the host, you must account for the limits. You may need to configure the WiredTiger cache to an appropriate value, as WiredTiger may not account for the memory limits of the specific container in certain cases.

To view the [`memory limit`](/docs/manual/reference/command/hostInfo#mongodb-data-hostInfo.system.memLimitMB), the value that WiredTiger utilizes as the maximum amount of RAM available use the [`hostInfo`](/docs/manual/reference/command/hostInfo#mongodb-dbcommand-dbcmd.hostInfo) command.

By default, WiredTiger uses Snappy block compression for all collections and prefix compression for all indexes. Compression defaults are configurable at a global level and can also be set on a per-collection and per-index basis during collection and index creation.

Different representations are used for data in the WiredTiger internal cache versus the on-disk format:

- Data in the filesystem cache is the same as the on-disk format, including benefits of any compression for data files. The filesystem cache is used by the operating system to reduce disk I/O.

- Indexes loaded in the WiredTiger internal cache have a different data representation to the on-disk format, but can still take advantage of index prefix compression to reduce RAM usage. Index prefix compression deduplicates common prefixes from indexed fields.

- Collection data in the WiredTiger internal cache is uncompressed and uses a different representation from the on-disk format. Block compression can provide significant on-disk storage savings, but data must be uncompressed to be manipulated by the server.

With the filesystem cache, MongoDB automatically uses all free memory that is not used by the WiredTiger cache or by other processes.

To adjust the size of the WiredTiger internal cache, see [`--wiredTigerCacheSizeGB`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizeGB) and [`storage.wiredTiger.engineConfig.cacheSizeGB`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizeGB). Avoid increasing the WiredTiger internal cache size above its default value. If your use case requires increased internal cache size, see [`--wiredTigerCacheSizePct`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizePct) and [`storage.wiredTiger.engineConfig.cacheSizePct`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizePct)

With the filesystem cache, MongoDB automatically uses all free memory that is not used by the WiredTiger cache or by other processes.

**Note:**

The [`--wiredTigerCacheSizeGB`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizeGB) limits the size of the WiredTiger internal cache. The operating system uses the available free memory for filesystem cache, which allows the compressed MongoDB data files to stay in memory. In addition, the operating system uses any free RAM to buffer file system blocks and file system cache.

To accommodate the additional consumers of RAM, you may have to decrease WiredTiger internal cache size.

The default WiredTiger internal cache size value assumes that there is a single [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance per machine. If a single machine contains multiple MongoDB instances, decrease the setting to accommodate the other [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances.

If you run [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) in a container (for example, `lxc`, `cgroups`, Docker, etc.) that does *not* have access to all of the RAM available in a system, you must set [`--wiredTigerCacheSizeGB`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizeGB) or [`--wiredTigerCacheSizePct`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizePct) to a value less than the amount of RAM available in the container. The exact amount depends on the other processes running in the container. See [`memLimitMB`.](/docs/manual/reference/command/hostInfo#mongodb-data-hostInfo.system.memLimitMB)

You can only provide one of either [`--wiredTigerCacheSizeGB`](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizeGB) or [`--wiredTigerCacheSizePct`.](/docs/manual/reference/program/mongod#std-option-mongod.--wiredTigerCacheSizePct)
