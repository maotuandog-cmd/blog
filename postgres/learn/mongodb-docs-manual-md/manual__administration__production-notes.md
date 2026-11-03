> For the complete MongoDB documentation index, see www.mongodb.com/docs/llms.txt

<!--
Tab options on this page. Append to the .md URL to filter:
  ?tabs=<id,...>   select specific tabs (e.g. ?tabs=nodejs,shell)
  ?allTabs=true    include every tab
  (no param)       default: one tab per tabset

Available tabs:
  other tabs: systemd-numa-steps, custom-scripts-numa-steps
-->

# Production Notes for Self-Managed Deployments

This page details system configurations that affect MongoDB, especially when running in production.

**Note:**

[MongoDB Atlas](https://www.mongodb.com/atlas/database) is a cloud-hosted database-as-a-service. If you can leverage public clouds, Atlas automatically addresses many of the considerations present in these Production Notes, as well as offering the following benefits:

- **Security:** Atlas reduces configuration required for security features like encryption, auditing, and role-based access control.

- **Scalability:** You can automatically scale your Atlas cluster based on usage. You can also configure granular scaling for compute, IOPS, and storage.

- **Availability:** Atlas has a 99.995% uptime SLA. You can also configure multi-region and multi-cloud deployments with automated failover and continuous backups.

- **Performance:** You can use built-in tools like Query Insights and Performance Advisor to optimize performance, improve database operations, and manage costs.

- **Full Text Search:** You can build performant, relevance-based search functionality into your Atlas application.

For more information, see the [Atlas documentation](https://docs.atlas.mongodb.com) and [Atlas Production Notes.](https://www.mongodb.com/docs/atlas/production-notes/)

## Platform Support

For running **in production**, refer to the [Recommended Platforms](/docs/manual/administration/production-notes#std-label-prod-notes-recommended-platforms) for operating system recommendations.

## Platform Support Notes

**Warning: MongoDB Is Incompatible with Linux Kernel 6.19 Through 7.0.13**

Due to an incompatibility between certain Linux kernel releases and the currently vendored version of TCMalloc, running MongoDB with a Linux kernel version from 6.19 through 7.0.13 can cause MongoDB to crash. To prevent this crash, MongoDB detects these kernel versions and stops during startup. This incompatibility affects all MongoDB packages, including those obtained from the MongoDB website, a package manager, or Docker.

Linux kernel version 7.0.14 and later resolves this incompatibility. To run MongoDB on an affected system, upgrade to Linux kernel version 7.0.14 or later.

### x86\_64

MongoDB requires the following minimum `x86_64` microarchitectures:

- For Intel `x86_64`, MongoDB requires one of:

  - a *Haswell* or later Core processor, or

  - a *Tiger Lake* or later Celeron or Pentium processor.

- For AMD `x86_64`, MongoDB requires:

  - a *Bulldozer* or later processor.

Starting in MongoDB 5.0, [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod), [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos), and the legacy [`mongo`](/docs/manual/reference/mongo#mongodb-binary-bin.mongo) shell no longer support `x86_64` platforms which do not meet this minimum microarchitecture requirement.

- MongoDB only supports Oracle Linux running the  Red Hat Compatible Kernel (RHCK). MongoDB does **not** support the Unbreakable Enterprise Kernel (UEK).

- MongoDB 5.0 requires use of the AVX instruction set, available on [select Intel and AMD processors.](https://en.wikipedia.org/wiki/Advanced_Vector_Extensions#CPUs_with_AVX)

### ARM64

MongoDB on `arm64` requires the *ARMv8.2-A* or later microarchitecture.

Starting in MongoDB 5.0, [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod), [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos), and the legacy [`mongo`](/docs/manual/reference/mongo#mongodb-binary-bin.mongo) shell no longer support `arm64` platforms which do not meet this minimum microarchitecture requirement.

To use the *ARM v8.4-A* or later microarchitecture, use MongoDB version 7.0 or later.

**Note:**

MongoDB no longer supports single board hardware lacking the proper CPU architecture (Raspberry Pi 4). See [Compatibility Changes in MongoDB 5.0](https://www.mongodb.com/docs/manual/release-notes/5.0-compatibility/#removed-raspberry-pi-support) for more information.

## Platform Support Matrix

For details on supported platforms, see:

- [Supported Platforms for MongoDB Enterprise](https://www.mongodb.com/docs/enterprise-platform-support/#std-label-landing-enterprise-platform-support)

- [Supported Platforms for MongoDB Community](https://www.mongodb.com/docs/community-platform-support/#std-label-landing-community-platform-support)

### Recommended Platforms

While MongoDB supports a variety of platforms, the following operating systems are recommended for production use on `x86_64` architecture:

- Amazon Linux

- Debian

- RHEL (Red Hat Enterprise Linux)&#x20;

- SLES

- Ubuntu LTS

- Windows Server

For best results, run the latest version of your platform. If you run an older version, make sure that your version is supported by its provider.

MongoDB on-premises products released for RHEL version 8.0+ are compatible with Rocky Linux version 8.0+ and AlmaLinux version 8.0+, contingent upon those distributions meeting their obligation to deliver full RHEL compatibility.

**See also:**

[Platform Specific Considerations](/docs/manual/administration/production-notes#std-label-prod-notes-platform-considerations)

### Use the Latest Stable Packages

Be sure you have the latest stable release.

MongoDB releases are available on the MongoDB Download Center:

- [MongoDB Enterprise Advanced](https://www.mongodb.com/try/download/enterprise-advanced)

- [MongoDB Community Edition](https://www.mongodb.com/try/download/community-edition)

For details on upgrading to the most current minor release, see [Upgrade to the Latest Self-Managed Patch Release of MongoDB.](/docs/manual/tutorial/upgrade-revision#std-label-upgrade-to-latest-revision)

The following related packages are also available on the MongoDB Download Center:

- [Tools](https://www.mongodb.com/try/download/tools)

- [Atlas SQL Interface](https://www.mongodb.com/try/download/atlas-sql)

- [Mobile & Edge](https://www.mongodb.com/try/download/realm)

For other MongoDB products, see their [respective documentation](https://www.mongodb.com/docs/).

## MongoDB `dbPath`

The files in the [`dbPath`](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath) directory must correspond to the configured [storage engine](/docs/manual/reference/glossary#std-term-storage-engine). [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) will not start if [`dbPath`](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath) contains data files created by a storage engine other than the one specified by [`--storageEngine`.](/docs/manual/reference/program/mongod#std-option-mongod.--storageEngine)

[`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) must possess read and write permissions for the specified [`dbPath`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath)

If you use an antivirus (AV) scanner or an endpoint detection and response (EDR) scanner, configure your scanner to exclude the [`database storage path`](/docs/manual/reference/configuration-options#mongodb-setting-storage.dbPath) and the [`database log path`](/docs/manual/reference/configuration-options#mongodb-setting-systemLog.path) from the scan.

The data files in the `database storage path` are compressed. Additionally, if you use the [encrypted storage engine](/docs/manual/core/security-encryption-at-rest#std-label-security-encryption-at-rest), the data files are also encrypted. The I/O and CPU costs to scan these files may significantly decrease performance without providing any security benefits.

If you don't exclude the directories in your `database storage path` and `database log path`, the scanner could quarantine or delete important files. Missing or quarantined files can corrupt your database and crash your MongoDB instance.

## Concurrency

### WiredTiger

[WiredTiger](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger) supports concurrent access by readers and writers to the documents in a collection. Clients can read documents while write operations are in progress, and multiple threads can modify different documents in a collection at the same time.

**See also:**

[Allocate Sufficient RAM and CPU](/docs/manual/administration/production-notes#std-label-prod-notes-ram) provides information about how WiredTiger takes advantage of multiple CPU cores and how to improve operation throughput.

## Data Consistency

### Journaling

MongoDB uses *write ahead logging* to an on-disk [journal](/docs/manual/reference/glossary#std-term-journal). Journaling guarantees that MongoDB can quickly recover [write operations](/docs/manual/crud#std-label-crud) that were written to the journal but not written to data files in cases where [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) terminated due to a crash or other serious failure. See [Journaling](/docs/manual/core/journaling#std-label-journaling-internals) for more information.

### Read Concern

You can use [causally consistent sessions](/docs/manual/core/read-isolation-consistency-recency#std-label-sessions) to read your own writes, if the writes request acknowledgment.

### Write Concern

[Write Concern](/docs/manual/reference/write-concern#std-label-write-concern) describes the level of acknowledgment requested from MongoDB for write operations. The level of the write concerns affects how quickly the write operation returns. When write operations have a *weak* write concern, they return quickly. With *stronger* write concerns, clients must wait after sending a write operation until MongoDB confirms the write operation at the requested write concern level. With insufficient write concerns, write operations may appear to a client to have succeeded, but may not persist in some cases of server failure.

See the [Write Concern](/docs/manual/reference/write-concern#std-label-write-concern) document for more information about choosing an appropriate write concern level for your deployment.

## Networking

### Use Trusted Networking Environments

Always run MongoDB in a *trusted environment*, with network rules that prevent access from *all* unknown computers, systems, and networks. Like any sensitive system that depends on network access, restrict your MongoDB deployment to specific systems that require access, such as application servers, monitoring services, and other MongoDB components.

**Important:**

By default, [authorization](/docs/manual/core/authorization#std-label-authorization) is not enabled, and [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) assumes a trusted environment. Enable [`authorization`](/docs/manual/reference/configuration-options#mongodb-setting-security.authorization) mode as needed. For more information on authentication mechanisms supported in MongoDB as well as authorization in MongoDB, see [Authentication on Self-Managed Deployments](/docs/manual/core/authentication#std-label-authentication) and [Role-Based Access Control in Self-Managed Deployments.](/docs/manual/core/authorization#std-label-authorization)

For additional information and considerations on security, refer to the documents in the [Security Section](/docs/manual/security#std-label-security), specifically:

- [Security Checklist for Self-Managed Deployments](/docs/manual/administration/security-checklist)

- [Network and Configuration Hardening for Self-Managed Deployments](/docs/manual/core/security-hardening)

For Windows users, consider the [Windows Server Technet Article on TCP Configuration](http://technet.microsoft.com/en-us/library/dd349797.aspx) when deploying MongoDB on Windows.

### Disable HTTP Interface

The HTTP interface is disabled by default. Do not enable the HTTP interface in production environments.

### Manage Connection Pool Sizes

Avoid overloading the connection resources of a [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) or [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instance by adjusting the connection pool size to suit your use case. Start at 110-115% of the typical number of current database requests, and modify the connection pool size as needed. Refer to the [Connection Pool Options](/docs/manual/reference/connection-string-options#std-label-connection-pool-options) for adjusting the connection pool size.

The [`connPoolStats`](/docs/manual/reference/command/connPoolStats#mongodb-dbcommand-dbcmd.connPoolStats) command returns information regarding the number of open connections to the current database for [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) and [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances in sharded clusters.

See also [Allocate Sufficient RAM and CPU.](/docs/manual/administration/production-notes#std-label-prod-notes-ram)

### Adjust tcp\_keepalive\_time

If the TCP keepalive value is greater than the TCP idle timeout on your cloud provider's load balancer, the system might silently drop connections. To reduce this risk, set `tcp_keepalive_time` to 120.

**Note:**

You need to restart [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) processes for new system-wide keepalive settings to take effect.

- To view the keepalive setting on Linux, use one of the following commands:

  ```bash
  sysctl net.ipv4.tcp_keepalive_time
  ```

  Or:

  ```bash
  cat /proc/sys/net/ipv4/tcp_keepalive_time
  ```

  The value is measured in seconds.

  **Note:**

  Although the setting name includes `ipv4`, the `tcp_keepalive_time` value applies to both IPv4 and IPv6.

- To change the `tcp_keepalive_time` value, you can use one of the following commands, supplying a *\<value>* in seconds:

  ```bash
  sudo sysctl -w net.ipv4.tcp_keepalive_time=<value>
  ```

  Or:

  ```bash
  echo <value> | sudo tee /proc/sys/net/ipv4/tcp_keepalive_time
  ```

  These operations do not persist across system reboots. To persist the setting, add the following line to `/etc/sysctl.conf`, supplying a *\<value>* in seconds, and reboot the machine:

  ```bash
  net.ipv4.tcp_keepalive_time = <value>
  ```

  Keepalive values greater than `300` seconds, (5 minutes) will be overridden on [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) sockets and set to `300` seconds.

* To view the keepalive setting on Windows, issue the following command:

  ```powershell
  reg query HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters /v KeepAliveTime
  ```

  The registry value is not present by default. The system default, used if the value is absent, is `7200000` milliseconds or `0x6ddd00` in hexadecimal.

* To change the `KeepAliveTime` value, use the following command in an Administrator Command Prompt, where `<value>` is expressed in hexadecimal (e.g. `120000` is `0x1d4c0`):

  ```powershell
  reg add HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\ /t REG_DWORD /v KeepAliveTime /d <value>
  ```

  Windows users should consider the [Windows Server Technet Article on KeepAliveTime](https://technet.microsoft.com/en-us/library/cc957549.aspx) for more information on setting keepalive for MongoDB deployments on Windows systems. Keepalive values greater than or equal to *600000* milliseconds (10 minutes) will be ignored by [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`.](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos)

## Hardware Considerations

MongoDB is designed for commodity hardware and has few hardware requirements or limitations. MongoDB's core components run on little-endian hardware, primarily x86/x86\_64 processors. Client libraries (drivers) can run on big or little endian systems.

### Allocate Sufficient RAM and CPU

At a minimum, ensure that each [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) or [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instance has access to two real cores or one multi-core physical CPU.

#### WiredTiger

The [WiredTiger](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger) storage engine is multithreaded and can take advantage of additional CPU cores. Specifically, the total number of active threads (concurrent operations) relative to the number of available CPUs can impact performance:

- Throughput *increases* as the number of concurrent active operations increases up to the number of CPUs.

- Throughput *decreases* as the number of concurrent active operations exceeds the number of CPUs by some threshold amount.

The threshold depends on your application. You can determine the optimum number of concurrent active operations for your application by experimenting and measuring throughput. The output from [`mongostat`](https://www.mongodb.com/docs/database-tools/mongostat/#mongodb-binary-bin.mongostat) provides statistics on the number of active reads/writes in the (`ar|aw`) column.

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

**Note:**

The [`storage.wiredTiger.engineConfig.cacheSizeGB`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizeGB) limits the size of the WiredTiger internal cache. The operating system uses the available free memory for filesystem cache, which allows the compressed MongoDB data files to stay in memory. In addition, the operating system uses any free RAM to buffer file system blocks and file system cache.

To accommodate the additional consumers of RAM, you may have to decrease WiredTiger internal cache size.

The default WiredTiger internal cache size value assumes that there is a single [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance per machine. If a single machine contains multiple MongoDB instances, decrease the setting to accommodate the other [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances.

If you run [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) in a container (for example, `lxc`, `cgroups`, Docker, etc.) that does *not* have access to all of the RAM available in a system, you must set [`storage.wiredTiger.engineConfig.cacheSizeGB`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizeGB) or [`storage.wiredTiger.engineConfig.cacheSizePct`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizePct) to a value less than the amount of RAM available in the container. The exact amount depends on the other processes running in the container. See [`memLimitMB`.](/docs/manual/reference/command/hostInfo#mongodb-data-hostInfo.system.memLimitMB)

You can only provide one of either [`storage.wiredTiger.engineConfig.cacheSizeGB`](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizeGB) or [`storage.wiredTiger.engineConfig.cacheSizePct`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.cacheSizePct)

To view statistics on the cache and eviction rate, see the [`wiredTiger.cache`](/docs/manual/reference/command/serverStatus#mongodb-serverstatus-serverstatus.wiredTiger.cache) field returned from the [`serverStatus`](/docs/manual/reference/command/serverStatus#mongodb-dbcommand-dbcmd.serverStatus) command.

#### Compression and Encryption

When using encryption, CPUs equipped with AES-NI instruction-set extensions show significant performance advantages. If you are using MongoDB Enterprise with the [Encrypted Storage Engine](/docs/manual/core/security-encryption-at-rest#std-label-encrypted-storage-engine), choose a CPU that supports AES-NI for better performance.

**See also:**

[Concurrency](/docs/manual/administration/production-notes#std-label-prod-notes-concurrency)

### Use Solid State Disks (SSDs)

MongoDB has good results and a good price-performance ratio with SATA SSD (Solid State Disk).

Use SSD if available and economical.

Commodity (SATA) spinning drives are often a good option, as the random I/O performance increase with more expensive spinning drives is not that dramatic (only on the order of 2x). Using SSDs or increasing RAM may be more effective in increasing I/O throughput.

### MongoDB and NUMA Hardware

Running MongoDB on a system with Non-Uniform Memory Access (NUMA) can cause a number of operational problems, including slow performance for periods of time and high system process usage.

When running MongoDB servers and clients on NUMA hardware, you should configure a memory interleave policy so that the host behaves in a non-NUMA fashion. MongoDB checks NUMA settings on start up when deployed on Linux (since version 2.0) and Windows (since version 2.6) machines. If the NUMA configuration may degrade performance, MongoDB prints a warning.

The `numad` daemon process can also reduce [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) performance. You should ensure `numad` is not enabled on MongoDB servers.

**See also:**

- [The MySQL "swap insanity" problem and the effects of NUMA](http://jcole.us/blog/archives/2010/09/28/mysql-swap-insanity-and-the-numa-architecture/) post, which describes the effects of NUMA on databases. The post introduces NUMA and its goals, and illustrates how these goals are not compatible with production databases. Although the blog post addresses the impact of NUMA for MySQL, the issues for MongoDB are similar.

- [NUMA: An Overview](https://queue.acm.org/detail.cfm?id=2513149).

#### Configuring NUMA on Windows

On Windows, memory interleaving must be enabled through the machine's BIOS. Consult your system documentation for details.

#### Configuring NUMA on Linux

On Linux, you must disable *zone reclaim* and also ensure that your [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances are started by `numactl`, which is generally configured through your platform's init system. You must perform both of these operations to properly disable NUMA for use with MongoDB.

1. Disable *zone reclaim* with one of the following commands:

   ```bash
   echo 0 | sudo tee /proc/sys/vm/zone_reclaim_mode
   ```

   ```bash
   sudo sysctl -w vm.zone_reclaim_mode=0
   ```

2. Ensure that [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) and [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) are started by `numactl`. This is generally configured through your platform's init system. Run the following command to determine which init system is in use on your platform:

   ```bash
   ps --no-headers -o comm 1
   ```

   - If "`systemd`", your platform uses the **systemd** init system, and you *must* follow the steps in the **systemd** tab below to edit your MongoDB service file(s).

   - If "`init`", your platform uses the *SysV Init* system, and you *do not* need to perform this step. The default MongoDB init script for SysV Init includes the necessary steps to start MongoDB instances via `numactl` by default.

   - If you manage your own init scripts and you are not using either of these init systems, you *must* follow the steps in the **Custom init scripts** tab below to edit your custom init script(s).

   ### systemd

   You must use `numactl` to start each of your [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instances, including all [config servers](/docs/manual/core/sharded-cluster-config-servers#std-label-sharding-config-server), [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances, and clients. Edit the default **systemd** service file for each as follows:

   1. Copy the default MongoDB service file:

      ```bash
      sudo cp /lib/systemd/system/mongod.service /etc/systemd/system/
      ```

   2. Edit the `/etc/systemd/system/mongod.service` file, and update the `ExecStart` statement to begin with:

      ```bash
      /usr/bin/numactl --interleave=all
      ```

      **Example:**

      If your existing `ExecStart` statement reads:

      ```bash
      ExecStart=/usr/bin/mongod --config /etc/mongod.conf
      ```

      Update that statement to read:

      ```bash
      ExecStart=/usr/bin/numactl --interleave=all /usr/bin/mongod --config /etc/mongod.conf
      ```

   3. Apply the change to `systemd`:

      ```bash
      sudo systemctl daemon-reload
      ```

   4. Restart any running `mongod` instances:

      ```bash
      sudo systemctl stop mongod
      sudo systemctl start mongod
      ```

   5. If applicable, repeat these steps for any [`mongos`](/docs/manual/reference/program/mongos#mongodb-binary-bin.mongos) instances.

For more information, see the [Documentation for /proc/sys/vm/\*](http://www.kernel.org/doc/Documentation/sysctl/vm.txt).

### Disk and Storage Systems

#### Swap

MongoDB performs best where swapping can be avoided or kept to a minimum, as retrieving data from swap will always be slower than accessing data in RAM. However, if the system hosting MongoDB runs out of RAM, swapping can prevent the Linux OOM Killer from terminating the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) process.

Generally, you should choose one of the following swap strategies:

1. Assign swap space on your system, and configure the kernel to only permit swapping under high memory load, or

2. Do not assign swap space on your system, and configure the kernel to disable swapping entirely

See [Set vm.swappiness](/docs/manual/administration/production-notes#std-label-set-swappiness) for instructions on configuring swap on your Linux system following these guidelines.

**Note:**

If your MongoDB instance is hosted on a system that also runs other software, such as a webserver, you should choose the first swap strategy. Do *not* disable swap in this case. If possible, it is highly recommended that you run MongoDB on its own dedicated system.

#### RAID

For optimal performance in terms of the storage layer, use disks backed by RAID-10. RAID-5 and RAID-6 do not typically provide sufficient performance to support a MongoDB deployment.

#### Remote Filesystems (NFS)

With the WiredTiger storage engine, WiredTiger objects may be stored on remote file systems if the remote file system conforms to ISO/IEC 9945-1:1996 (POSIX.1). Because remote file systems are often slower than local file systems, using a remote file system for storage may degrade performance.

If you decide to use NFS, add the following NFS options to your `/etc/fstab` file:

- `bg`

- `hard`

- `nolock`

- `noatime`

- `nointr`

Depending on your kernel version, some of these values may already be set as the default. Consult your platform's documentation for more information.

#### Separate Components onto Different Storage Devices

For improved performance, consider separating your database's data, journal, and logs onto different storage devices, based on your application's access and write pattern. Mount the components as separate filesystems and use symbolic links to map each component's path to the device storing it.

For the WiredTiger storage engine, you can also store the indexes on a different storage device. See [`storage.wiredTiger.engineConfig.directoryForIndexes`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.engineConfig.directoryForIndexes)

**Note:**

Using different storage devices will affect your ability to create snapshot-style backups of your data, since the files will be on different devices and volumes.

#### Scheduling

##### Scheduling for Virtual or Cloud Hosted Devices

For local block devices attached to a virtual machine instance via the hypervisor or hosted by a cloud hosting provider, the guest operating system should use the [none scheduler](/docs/manual/reference/glossary#std-term-none-scheduler) for best performance. The `none` scheduler allows the operating system to defer I/O scheduling to the underlying hypervisor.

If you are running multiple workloads in the same VM or in your own data center, use the [kyber scheduler.](/docs/manual/reference/glossary#std-term-kyber-scheduler)

**Note:**

The [kyber scheduler](/docs/manual/reference/glossary#std-term-kyber-scheduler) is only available on Linux kernels starting in version 4.12.

##### Scheduling for Physical Servers

For physical servers using NVMe or SSD drives, the operating system should use the [none scheduler.](/docs/manual/reference/glossary#std-term-none-scheduler)

For physical servers using spinning disks, the operating system should use the *mq-deadline* scheduler. The *mq-deadline* scheduler caps maximum latency per request and maintains a good disk throughput that is best for disk-intensive database applications.

## Architecture

### Replica Sets

See the [Replica Set Architectures](/docs/manual/core/replica-set-architectures#std-label-replica-set-architecture) document for an overview of architectural considerations for replica set deployments.

### Sharded Clusters

See [Sharded Cluster Production Architecture](/docs/manual/core/sharded-cluster-components#std-label-sharding-shards) for an overview of recommended sharded cluster architectures for production deployments.

**See also:**

[Development Checklist](/docs/manual/administration/production-checklist-development)

## Compression

WiredTiger can compress collection data using one of the following compression library:

- [snappy](/docs/manual/reference/glossary#std-term-snappy)

  Provides a lower compression rate than `zlib` or `zstd` but has a lower CPU cost than either.

- [zlib](/docs/manual/reference/glossary#std-term-zlib)

  Provides better compression rate than `snappy` but has a higher CPU cost than both `snappy` and `zstd`.

- [zstd](/docs/manual/reference/glossary#std-term-zstd)

  Provides better compression rate than both `snappy` and `zlib` and has a lower CPU cost than `zlib`.

By default, WiredTiger uses [snappy](/docs/manual/reference/glossary#std-term-snappy) compression library. To change the compression setting, see [`storage.wiredTiger.collectionConfig.blockCompressor`.](/docs/manual/reference/configuration-options#mongodb-setting-storage.wiredTiger.collectionConfig.blockCompressor)

WiredTiger uses [prefix compression](/docs/manual/reference/glossary#std-term-prefix-compression) on all indexes by default.

## Clock Synchronization

MongoDB [components](/docs/manual/reference/program#std-label-mongodb-package-components) keep logical clocks for supporting time-dependent operations. Using [NTP](http://www.ntp.org/) to synchronize host machine clocks mitigates the risk of clock drift between components. Clock drift between components increases the likelihood of incorrect or abnormal behavior of time-dependent operations like the following:

- If the underlying system clock of any given MongoDB component drifts a year or more from other components in the same deployment, communication between those members may become unreliable or halt altogether.

  The [`maxAcceptableLogicalClockDriftSecs`](/docs/manual/reference/parameters#mongodb-parameter-param.maxAcceptableLogicalClockDriftSecs) parameter controls the amount of acceptable clock drift between components. Clusters with a lower value of `maxAcceptableLogicalClockDriftSecs` have a correspondingly lower tolerance for clock drift.

- Two cluster members with different system clocks may return different values for operations that return the current cluster or system time, such as [`Date()`](/docs/manual/reference/mongodb-extended-json#mongodb-bsontype-Date), [`NOW`](/docs/manual/reference/aggregation-variables#mongodb-variable-variable.NOW), and [`CLUSTER_TIME`.](/docs/manual/reference/aggregation-variables#mongodb-variable-variable.CLUSTER_TIME)

- Features which rely on timekeeping may have inconsistent or unpredictable behavior in clusters with clock drift between MongoDB components.

## Platform Specific Considerations

### MongoDB on Linux

#### Kernel and File Systems

When running MongoDB in production on Linux, you should use Linux kernel version 2.6.36 or later, with either the XFS or EXT4 filesystem. If possible, use XFS as it generally performs better with MongoDB.

With the [WiredTiger storage engine](/docs/manual/core/wiredtiger#std-label-storage-wiredtiger), using XFS is **strongly recommended** for data bearing nodes to avoid performance issues that may occur when using EXT4 with WiredTiger.

- In general, if you use the XFS file system, use at least version `2.6.25` of the Linux Kernel.

- If you use the EXT4 file system, use at least version `2.6.28` of the Linux Kernel.

- On Red Hat Enterprise Linux and CentOS, use at least version `2.6.18-194` of the Linux kernel.

#### System C Library

MongoDB uses the [GNU C Library](http://www.gnu.org/software/libc/) (glibc) on Linux. Generally, each Linux distro provides its own vetted version of this library. For best results, use the latest update available for this system-provided version. You can check whether you have the latest version installed by using your system's package manager. For example:

- On RHEL (Red Hat Enterprise Linux) / CentOS, the following command updates the system-provided GNU C Library:

  ```bash
  sudo yum update glibc
  ```

- On Ubuntu / Debian, the following command updates the system-provided GNU C Library:

  ```bash
  sudo apt-get install libc6
  ```

#### `fsync()` on Directories

**Important:**

MongoDB requires a filesystem that supports `fsync()` *on directories*. For example, HGFS and Virtual Box's shared folders do *not* support this operation.

#### Set `vm.swappiness` to `1` or `0`

"Swappiness" is a Linux kernel setting that influences the behavior of the Virtual Memory manager. The `vm.swappiness` setting ranges from `0` to `100`: the higher the value, the more strongly it prefers swapping memory pages to disk over dropping pages from RAM.

- A setting of `0` disables swapping entirely .

- A setting of `1` permits the kernel to swap only to avoid out-of-memory problems.

- A setting of `60` tells the kernel to swap to disk often, and is the default value on many Linux distributions.

- A setting of `100` tells the kernel to swap aggressively to disk.

MongoDB performs best where swapping can be avoided or kept to a minimum. As such you should set `vm.swappiness` to either `1` or `0` depending on your application needs and cluster configuration.

**Note:**

Most system and user processes run within a cgroup, which, by default, sets the `vm.swappiness` to `60`. If you are running RHEL (Red Hat Enterprise Linux) / CentOS, set `vm.force_cgroup_v2_swappiness` to `1` to ensure that the specified `vm.swappiness` value overrides any cgroup defaults.

With Linux kernel versions previous to `3.5`, or RHEL (Red Hat Enterprise Linux) / CentOS kernel versions previous to `2.6.32-303`,  a `vm.swappiness` setting of `0` would still allow the kernel to swap in certain emergency situations.

**Note:**

If your MongoDB instance is hosted on a system that also runs other software, such as a webserver, you should set `vm.swappiness` to `1`. If possible, it is highly recommended that you run MongoDB on its own dedicated system.

- To check the current swappiness setting on your system, run:

  ```bash
  cat /proc/sys/vm/swappiness
  ```

- To change swappiness on your system:

  1. Edit the `/etc/sysctl.conf` file and add the following line:

     ```bash
     vm.swappiness = 1
     ```

  2. Run the following command to apply the setting:

     ```bash
     sudo sysctl -p
     ```

**Note:**

If you are running RHEL / CentOS and using a `tuned` performance profile, you must also edit your chosen profile to set `vm.swappiness` to `1` or `0`.

#### Recommended Configuration

For **all** MongoDB deployments:

- Use the Network Time Protocol (NTP) to synchronize time among your hosts. This is especially important in sharded clusters.

For the **WiredTiger** storage engines, consider the following recommendations:

- Turn off `atime` for the storage volume containing the [database files.](/docs/manual/reference/glossary#std-term-dbpath)

- Adjust the `ulimit` settings for your platform according to the recommendations in the [ulimit](/docs/manual/reference/ulimit#std-label-ulimit) reference. Low `ulimit` values will negatively affect MongoDB when under heavy use and can lead to failed connections to MongoDB processes and loss of service.

  **Note:**

  If the `ulimit` value for number of open files is under `64000`, MongoDB generates a startup warning.

- If you are running MongoDB 8.0, [enable Transparent Hugepages.](/docs/manual/administration/tcmalloc-performance#std-label-enable-thp)

  - If you are running MongoDB 7.0 or earlier, [disable Transparent Hugepages](/docs/manual/tutorial/disable-transparent-huge-pages#std-label-disable-thp). In earlier versions, MongoDB performs better with typical (4096 bytes) virtual memory pages.

- Disable NUMA in your BIOS. If that is not possible, see [MongoDB on NUMA Hardware.](/docs/manual/administration/production-notes#std-label-production-numa)

- Configure SELinux for MongoDB **if** you are **not** using the default MongoDB directory paths or [ports.](/docs/manual/reference/default-mongodb-port)

  **Note:**

  If you are using SELinux, any MongoDB operation that requires [server-side JavaScript](/docs/manual/core/server-side-javascript#std-label-server-side-javascript) will result in segfault errors. [Disable Server-Side Execution of JavaScript](/docs/manual/core/server-side-javascript#std-label-disable-server-side-js) describes how to disable execution of server-side JavaScript.

For the **WiredTiger** storage engine:

- Set the readahead setting between 8 and 32 regardless of storage media type (spinning disk, SSD, etc.).

  Higher readahead commonly benefits sequential I/O operations. Because MongoDB disk access patterns are generally random, if you use higher readahead settings you get limited benefit and it can degrade performance. For optimal MongoDB performance, set readahead between 8 and 32, unless testing shows a measurable, repeatable, and reliable benefit from a higher value. [MongoDB commercial support](https://support.mongodb.com/welcome) can advise on alternate readahead configurations.

#### MongoDB and TLS/SSL Libraries

On Linux platforms, you may observe one of the following statements in the MongoDB log:

```none
<path to TLS/SSL libs>/libssl.so.<version>: no version information available (required by /usr/bin/mongod)
<path to TLS/SSL libs>/libcrypto.so.<version>: no version information available (required by /usr/bin/mongod)
```

These warnings indicate that the system's TLS/SSL libraries are different from the TLS/SSL libraries that the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) was compiled against. Typically these messages do not require intervention; however, you can use the following operations to determine the symbol versions that [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) expects:

```bash
objdump -T <path to mongod>/mongod | grep " SSL_"
objdump -T <path to mongod>/mongod | grep " CRYPTO_"
```

These operations will return output that resembles one the of the following lines:

```none
0000000000000000      DF *UND*       0000000000000000  libssl.so.10 SSL_write
0000000000000000      DF *UND*       0000000000000000  OPENSSL_1.0.0 SSL_write
```

The last two strings in this output are the symbol version and symbol name. Compare these values with the values returned by the following operations to detect symbol version mismatches:

```bash
objdump -T <path to TLS/SSL libs>/libssl.so.1*
objdump -T <path to TLS/SSL libs>/libcrypto.so.1*
```

This procedure is neither exact nor exhaustive: many symbols used by [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) from the `libcrypto` library do not begin with `CRYPTO_`.

### MongoDB on Windows

For MongoDB instances using the WiredTiger storage engine, performance on Windows is comparable to performance on Linux.

### MongoDB on Virtual Environments

This section describes considerations when running MongoDB in some of the more common virtual environments.

For all platforms, consider [Scheduling.](/docs/manual/administration/production-notes#std-label-virtualized-disks-scheduling)

#### AWS (Amazon Web Services) EC2 (Elastic Compute Cloud)

There are two performance configurations to consider:

- Reproducible performance for performance testing or benchmarking, and

- Raw maximum performance

To tune performance on EC2 (Elastic Compute Cloud) for either configuration, you should:

- Enable AWS (Amazon Web Services) [Enhanced Networking](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking.html#enabling_enhanced_networking) for your instance. Not all instance types support Enhanced Networking.

  To learn more about Enhanced Networking, see to the [AWS documentation](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking.html#enabling_enhanced_networking).

- Set `tcp_keepalive_time` to 120.

If you are concerned more about reproducible performance on EC2 (Elastic Compute Cloud), you should also:

- Use provisioned IOPS (Input/Output Operations Per Second) for the storage, with separate devices for journal and data. Do not use the ephemeral (SSD (Solid State Disk)) storage available on most instance types as their performance changes moment to moment. (The `i` series is a notable exception, but very expensive.)

- Disable DVFS (dynamic voltage and frequency scaling) and CPU (central processing unit) power saving modes.

  **See also:**

  [Amazon documentation on Processor State Control](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/processor_state_control.html)

- Disable hyperthreading.

  **See also:**

  [Amazon blog post on disabling Hyper-Threading](https://aws.amazon.com/blogs/compute/disabling-intel-hyper-threading-technology-on-amazon-linux/).

- Use `numactl` to bind memory locality to a single socket.

#### Azure

Use [Premium Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-block-blob-premium). Microsoft Azure offers two general types of storage: Standard storage, and Premium storage. MongoDB on Azure has better performance when using Premium storage than it does with Standard storage.

#### VMware

MongoDB is compatible with VMware.

VMware supports *memory overcommitment*, where you can assign more memory to your virtual machines than the physical machine has available. When memory is overcommitted, the hypervisor reallocates memory between the virtual machines. VMware's balloon driver (`vmmemctl`) reclaims the pages that are considered least valuable.

The balloon driver resides inside the guest operating system. Under certain configurations, when the balloon driver expands, it can interfere with MongoDB's memory management and affect MongoDB's performance.

To prevent negative performance impact from the balloon driver and memory overcommitment features, reserve the full amount of memory for the virtual machine running MongoDB. Reserving the appropriate amount of memory for the virtual machine prevents the balloon from inflating in the local operating system when there is memory pressure in the hypervisor.

Even though the balloon driver and memory overcommitment features can negatively affect MongoDB performance under certain configurations, **do not disable these features**. If you disable these features, the hypervisor may use its swap space to fulfill memory requests, which negatively affects performance.

Ensure that virtual machines stay on a specific ESX/ESXi host by setting VMware's [affinity rules](https://docs.vmware.com/en/VMware-vSphere/7.0/com.vmware.vsphere.resmgmt.doc/GUID-2FB90EF5-7733-4095-8B66-F10D6C57B820.html). If you must manually migrate a virtual machine to another host and the [`mongod`](/docs/manual/reference/program/mongod#mongodb-binary-bin.mongod) instance on the virtual machine is the [primary](/docs/manual/reference/glossary#std-term-primary), you must first [`step down`](/docs/manual/reference/method/rs.stepDown#mongodb-method-rs.stepDown) the primary and then [`shut down the instance`.](/docs/manual/reference/method/db.shutdownServer#mongodb-method-db.shutdownServer)

Follow the networking best practices for [vMotion](https://docs.vmware.com/en/VMware-vSphere/7.0/com.vmware.vsphere.vcenterhost.doc/GUID-7DAD15D4-7F41-4913-9F16-567289E22977.html) and [VMKernel](https://knowledge.broadcom.com/external/article?legacyId=2054994). Failure to follow the best practices can result in performance problems and affect [replica set](/docs/manual/core/replica-set-high-availability) and [sharded cluster](/docs/manual/sharding#std-label-sharding-sharded-cluster) high availability mechanisms.

You can clone a virtual machine running MongoDB. You might use this function to deploy a new virtual host to add as a member of a replica set.

#### KVM

MongoDB is compatible with KVM.

KVM supports *memory overcommitment*, where you can assign more memory to your virtual machines than the physical machine has available. When memory is overcommitted, the hypervisor reallocates memory between the virtual machines. KVM's balloon driver  reclaims the pages that are considered least valuable.

The balloon driver resides inside the guest operating system. Under certain configurations, when the balloon driver expands, it can interfere with MongoDB's memory management and affect MongoDB's performance.

To prevent negative performance impact from the balloon driver and memory overcommitment features, reserve the full amount of memory for the virtual machine running MongoDB. Reserving the appropriate amount of memory for the virtual machine prevents the balloon from inflating in the local operating system when there is memory pressure in the hypervisor.

Even though the balloon driver and memory overcommitment features can negatively affect MongoDB performance under certain configurations, **do not disable these features**. If you disable these features, the hypervisor may use its swap space to fulfill memory requests, which negatively affects performance.

## Performance Monitoring

### iostat

On Linux, use the `iostat` command to check if disk I/O is a bottleneck for your database. Specify a number of seconds when running iostat to avoid displaying stats covering the time since server boot.

For example, the following command will display extended statistics and the time for each displayed report, with traffic in MB/s, at one second intervals:

```bash
iostat -xmt 1
```

Key fields from `iostat`:

- `%util`: the primary field to check. It indicates what percent of the time the device or drive is in use.

- `avgrq-sz`: average request size. Smaller values reflect more random IO operations.

### bwm-ng

[bwm-ng](http://www.gropp.org/?id=projects\&sub=bwm-ng) is a command-line tool for monitoring network use. If you suspect a network-based bottleneck, you may use `bwm-ng` to begin your diagnostic process.

## Backups

To make backups of your MongoDB database, see [MongoDB Backup Methods Overview.](/docs/manual/core/backups#std-label-backup-methods)
