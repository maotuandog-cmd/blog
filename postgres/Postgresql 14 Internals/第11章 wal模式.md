## 11.1 性能 [](https://postgres-internals.cn/docs/chapter11/#111-%e6%80%a7%e8%83%bd)

当服务器正常运行时，WAL 文件会不断写入磁盘。然而，这些写入是顺序的：几乎没有随机访问，因此即使是 HDD 也能应对这项任务。因为这种类型的负载与典型的数据文件访问非常不同，因此可能值得为 WAL 文件设置单独的物理存储，并将 PGDATA/pg_wal 目录替换为指向已挂载文件系统中目录的符号链接。

> 有几种情况需要同时写入和读取 WAL 文件。第一个显而易见的例子是崩溃恢复；第二个是流复制。walsender [1](https://postgres-internals.cn/docs/chapter11/#fn:1) 进程直接从文件中读取 WAL 条目 [2](https://postgres-internals.cn/docs/chapter11/#fn:2)，如果备库没有接收到需要的 WAL 条目，那么 walsender 进程将从文件中读取，只是读取过程是顺序的，而不是随机的 (也有可能在主库的操作系统缓存中找到相应的 WAL 条目)。

WAL 条目可以按以下模式之一写入：

- 同步模式在事务提交时，将所有相关的 WAL 条目保存至磁盘之前会禁止任何进一步的操作。
- 异步模式意味着立即提交事务，随后在后台将 WAL 条目写入磁盘。

当前模式由 _synchronous_commit_ 参数定义。

**同步模式**。为了可靠地记录提交的事实，仅仅将 WAL 条目传递给操作系统是不够的；你还必须确保磁盘同步已经成功完成。由于同步涉及实际的 IO 操作 (非常慢)，因此尽可能少地执行它是有益的。

为此，完成事务并将 WAL 条目写入磁盘的后端进程可以按照 _commit_delay_ 参数定义的时间暂停一小会。但是，这只会发生在系统中至少有 _commit_siblings_ 个活跃事务的情况下 [3](https://postgres-internals.cn/docs/chapter11/#fn:3)：在这段暂停期间，其中一些事务可能会完成，服务器会设法一次性同步所有的 WAL 条目。这很像扶着电梯门让某人赶上电梯。

默认情况下不会暂停。只有在执行大量短 OLTP 事务的系统中，修改 _commit_delay_ 参数才有意义。

在潜在的暂停之后，完成事务的进程将所有累积的 WAL 条目刷新到磁盘并执行同步 (重要的是保存提交记录以及之前与此事务相关的所有条目；其余的被写入，只是因为不会增加成本)。

从此刻起，ACID 的持久性要求得到保证 — 事务被认为已可靠提交了 [4](https://postgres-internals.cn/docs/chapter11/#fn:4)。这就是为什么同步模式是默认模式的原因。

同步提交的缺点是延迟较长 (COMMIT 命令直到同步结束才返回控制) 和较低的系统吞吐量，尤其是对于 OLTP 负载。

**异步模式**。为了开启异步提交 [5](https://postgres-internals.cn/docs/chapter11/#fn:5)，你需要关闭 _synchronous_commit_ 参数。

在异步模式下，WAL 条目由 walwriter [6](https://postgres-internals.cn/docs/chapter11/#fn:6) 进程写入磁盘，该进程在工作和休息之间交替。暂停的持续时间由 _wal_writer_delay_ 定义。

从暂停中醒来后，walwriter 进程检查缓存中是否有新的完全填满的 WAL 页面。如果出现任何此类页面，那么 walwriter 进程会跳过当前的页面，将此类页面写入磁盘。否则，它会写入当前半空的页面，因为它已经被唤醒了 [7](https://postgres-internals.cn/docs/chapter11/#fn:7)。

这个算法的目的是避免多次刷新同一个页面，这对于数据变化密集的工作负载可以带来显著的性能提升。

虽然 WAL 缓存使用环形缓冲区，但 walwriter 在到达缓存的最后一页时会停止；暂停后，下一个写入周期会从第一页开始。因此，在最坏的情况下，walwriter 需要运行 3 次才能到达特定的 WAL 条目：首先，写入所有位于缓存末尾的完整页面，然后它会回到开头，最后处理包含该条目的未满页面。但在大多数情况下，它只需要一到两个周期。

每当写入 _wal_writer_flush_after_ 量的数据后，便会执行同步，并在写入周期结束时再次执行同步。

异步提交比同步提交更快，因为它们不必等待磁盘物理写入。但是可靠性会受到影响：你可能会丢失在故障前三倍 _wal_writer_delay_ 时间范围内提交的数据 (默认为 0.6 秒)。

在实际情况中，这两种模式相辅相成。在同步模式下，与长事务相关的 WAL 条目仍然可以异步写入以释放 WAL 缓冲区。反之亦然，即使在异步模式下，与即将从缓冲区缓存中逐出的页面相关的 WAL 条目也会立即刷新到磁盘 — 否则无法继续操作。

在大多数情况下，系统设计人员必须在性能和持久性之间做出艰难的选择。

_synchronous_commit_ 参数也可以针对特定事务设置。如果可以在应用程序级别将所有事务分类为绝对关键 (如处理财务数据) 或不那么重要，那么你可以提高性能，同时冒着只丢失非关键事务的风险。

为了了解异步提交潜在的性能增益，让我们使用 pgbench [8](https://postgres-internals.cn/docs/chapter11/#fn:8) 测试比较两种模式下的延迟和吞吐量。

首先，初始化所需的表：

```bash
postgres$ /usr/local/pgsql/bin/pgbench -i internals
```

在同步模式下开始一次 30 秒的测试：

```bash
postgres$ /usr/local/pgsql/bin/pgbench -T 30 internals
pgbench (14.7)
starting vacuum...end.
transaction type: <builtin: TPC−B (sort of)>
scaling factor: 1
query mode: simple
number of clients: 1
number of threads: 1
duration: 30 s
number of transactions actually processed: 20123
latency average = 1.491 ms
initial connection time = 2.507 ms
tps = 670.809688 (without initial connection time)
```

现在在异步模式下执行相同的测试：

```bash
=> ALTER SYSTEM SET synchronous_commit = off;
=> SELECT pg_reload_conf();
postgres$ /usr/local/pgsql/bin/pgbench -T 30 internals
pgbench (14.7)
starting vacuum...end.
transaction type: <builtin: TPC−B (sort of)>
scaling factor: 1
query mode: simple
number of clients: 1
number of threads: 1
duration: 30 s
number of transactions actually processed: 61809
latency average = 0.485 ms
initial connection time = 1.915 ms
tps = 2060.399861 (without initial connection time)
```

在异步模式下，这个简单的基准测试体现了显著降低的延迟和更高的吞吐量 (TPS)。 当然，每个特定系统都会根据当前负载有自己的数据，但很明显，对短小 OLTP 事务的影响是非常明显的。

让我们恢复默认设置：

```bash
=> ALTER SYSTEM RESET synchronous_commit;
=> SELECT pg_reload_conf();
```

## 11.2 容错性 [](https://postgres-internals.cn/docs/chapter11/#112-%e5%ae%b9%e9%94%99%e6%80%a7)

不言而喻，预写日志必须保证在任何情况下都能进行崩溃恢复 (除非持久性存储本身损坏了)。影响数据一致性的因素有很多，但我将只介绍最重要的几个：缓存、数据损坏和非原子写入 [9](https://postgres-internals.cn/docs/chapter11/#fn:9)。

### 11.2.1 缓存 [](https://postgres-internals.cn/docs/chapter11/#1121-%e7%bc%93%e5%ad%98)

数据在到达非易失性存储 (比如硬盘) 之前，会通过各种缓存。

磁盘写入只是指示操作系统将数据放入其缓存中 (这也容易发生崩溃，就像 RAM 的任何其他部分一样)。实际的写入操作是异步执行的，具体由操作系统的 I/O 调度器的设置决定。

一旦调度器决定刷新累积的数据，这些数据就会被转移到存储设备的缓存中 (比如 HDD)。存储设备也可以推迟写入，例如，将相邻的页面组合一起。RAID 控制器在磁盘和操作系统之间又添加了一层缓存。

除非采取特殊措施，否则数据何时可靠地存储在磁盘上仍然未知。这通常不是那么重要，因为我们有 WAL，但是 WAL 条目本身必须立即可靠地保存在磁盘上 [10](https://postgres-internals.cn/docs/chapter11/#fn:10)。异步模式同样如此 — 否则，无法保证 WAL 条目在修改的数据之前到达磁盘。

检查点进程也必须以可靠的方式保存数据，确保脏页从操作系统缓存进入磁盘。此外，它还必须同步其他进程已经执行的所有文件操作 (如页面写入或文件删除)：当检查点完成时，所有这些操作的结果必须已经保存在磁盘上 [11](https://postgres-internals.cn/docs/chapter11/#fn:11)。

还有一些其他情况需要 fail-safe 写入，例如在 minimal WAL 级别下执行未记录日志的操作。

操作系统提供了多种方式以保证将数据立即写入非易失性存储。所有方式都可归结为以下两种主要方式：要么在写入后调用单独的同步命令 (例如 fsync 或 fdatasync)，要么在打开或写入文件时指定执行同步的要求 (甚至绕过操作系统缓存的直接写入)。

pg_test_fsync 工具可以帮助你根据操作系统和文件系统确认同步 WAL 的最佳方式；首选方式可以在 _wal_sync_method_ 参数中指定。对于其他操作，会自动选择合适的同步方式，无法配置 [12](https://postgres-internals.cn/docs/chapter11/#fn:12)。

这里一个微妙的方面是，在每种特定情况下，最合适的方式取决于硬件。例如，如果你使用带有备用电池的控制器，那么可以利用其缓存，因为电池可以在断电时保护数据。

你应该记住，异步提交和缺乏同步是两个完全不同的事情。关闭同步 (通过 _fsync_ 参数) 可以提高系统性能，但任何故障都会导致致命的数据丢失。异步模式可以保证崩溃恢复到一致的状态，但一些最新的数据更新可能会丢失。

### 11.2.2 数据损坏 [](https://postgres-internals.cn/docs/chapter11/#1122-%e6%95%b0%e6%8d%ae%e6%8d%9f%e5%9d%8f)

技术设备并不是完美无缺的，数据在内存中、磁盘上，或通过接口电缆传输时都可能受损。这类错误通常在硬件层处理，但仍有些可能会遗漏。

为了及时发现问题，PostgreSQL 始终通过校验和保护 WAL 条目。

数据页也可以计算校验和 [13](https://postgres-internals.cn/docs/chapter11/#fn:13)。这可以在集群初始化期间完成，也可以在服务器停止时 [14](https://postgres-internals.cn/docs/chapter11/#fn:14) 通过运行 pg_checksum [15](https://postgres-internals.cn/docs/chapter11/#fn:15) 工具来完成。

在生产系统中，应该始终启用校验和，尽管有一些 (较小的) 计算和验证的开销。这提高了及时发现数据损坏的机会，即使仍然会存在一些极端的情况：

- 只有在访问页面时才会执行校验和检验，因此数据损坏可能会在很长一段时间内都不会被察觉，直到它扩散到所有备份，导致没有了正确数据的来源。
- 被归零的页面被视为是正确的，因此如果文件系统错误地将页面归零，那么这个问题将不会被发现。
- 校验和仅针对表的主分支计算；其他分支和文件 (例如 CLOG 中的事务状态) 仍然不受保护。

让我们看一下只读 data_checksums 参数，以确保启用了校验和：

```bash
=> SHOW data_checksums;
 data_checksums
−−−−−−−−−−−−−−−−
 on
(1 row)
```

现在停止服务器，并将表的主分支的第零页中的若干字节清零：

```bash
=> SELECT pg_relation_filepath('wal');
 pg_relation_filepath
−−−−−−−−−−−−−−−−−−−−−−
 base/16391/16562
(1 row)

postgres$ pg_ctl stop
postgres$ dd if=/dev/zero of=/usr/local/pgsql/data/base/16391/16562 \
oflag=dsync conv=notrunc bs=1 count=8
8+0 records in
8+0 records out
8 bytes copied, 0,00776573 s, 1,0 kB/s
```

再次启动服务器：

```bash
postgres$ pg_ctl start -l /home/postgres/logfile
```

实际上，我们可以让服务器保持运行 — 只需将页面写入磁盘并将其从缓存中驱逐 (否则，服务器将继续使用其缓存版本)。但这样的工作流程难以复现。

现在，让我们尝试读取该表：

```bash
=> SELECT * FROM wal LIMIT 1;
WARNING: page verification failed, calculated checksum 20397 but
expected 28733
ERROR: invalid page in block 0 of relation base/16391/16562
```

如果无法从备份中恢复数据，那么至少尝试读取损坏的页面是有意义的 (有可能得到混乱的输出)。 为此，你需要启用 _ignore_checksum_failure_ 参数：

```bash
=> SET ignore_checksum_failure = on;
=> SELECT * FROM wal LIMIT 1;
WARNING: page verification failed, calculated checksum 20397 but
expected 28733
 id
−−−−
  2
(1 row)
```

在此情况下，一切都进行得很顺利，因为我们损坏的是页头的非关键部分 (最新 WAL 条目的 LSN)，而不是数据本身。

### 11.2.3 非原子写 [](https://postgres-internals.cn/docs/chapter11/#1123-%e9%9d%9e%e5%8e%9f%e5%ad%90%e5%86%99)

数据库页面通常占 8 kB，但是在更底层，写入是按块执行的，这些块通常更小 (通常是 512 字节或 4 kB)。 因此，如果发生故障，页面可能仅写入了部分。在恢复期间，将常规的 WAL 条目应用于这类页面是没有意义的。

为了避免部分写入，PostgreSQL 会在 WAL 中保存检查点启动之后首次被修改页面的完整镜像 (FPI)。此行为由 _full_page_writes_ 参数控制，但将其关闭可能会导致严重的数据损坏。

如果恢复进程在 WAL 中遇到了 FPI ，那么它将无条件地将其写入磁盘 (不检查它的 LSN )；就像任何 WAL 条目一样，FPI 也受到校验和的保护，因此其损坏不会被忽视。然后，常规 WAL 条目将应用于这一状态，这一状态被保证是正确的。

没有单独的 WAL 条目类型用于设置提示位：这种操作被认为是非关键性的，因为任何访问页面的查询都会重新设置所需的位。但是，任何提示位的更改都会影响页面的校验和。 因此，如果启用了校验和 (或者打开了 _wal_log_hints_ 参数)，提示位的修改也将记录为 FPIs [16](https://postgres-internals.cn/docs/chapter11/#fn:16)。

即使日志机制从 FPI [17](https://postgres-internals.cn/docs/chapter11/#fn:17) 中排除了空白空间，生成的 WAL 文件的大小仍然会显著增加。如果通过 _wal_compression_ 参数启用了 WAL 压缩，这种情况可以大大改善。

让我们使用 pgbench 工具进行一个简单的实验。我们将执行一个检查点，并立即开始一项带有事务数量限制的基准测试：

```bash
=> CHECKPOINT;
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/42CE5DA8
(1 row)

postgres$ /usr/local/pgsql/bin/pgbench -t 20000 internals
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/449113E0
(1 row)
```

这是生成的 WAL 条目的大小：

```bash
=> SELECT pg_size_pretty('0/449755C0'::pg_lsn - '0/42CE5DA8'::pg_lsn);
 pg_size_pretty
−−−−−−−−−−−−−−−−
 29 MB
(1 row)
```

在此示例中，FPIs 占总 WAL 大小的一半以上。你可以在收集的统计数据中查看，其中显示了每种资源类型 (Type) 的 WAL 条目数量 (N)、常规条目的大小 (Record size) 以及 FPI 大小：

```bash
postgres$ /usr/local/pgsql/bin/pg_waldump --stats \
-p /usr/local/pgsql/data/pg_wal -s 0/42CE5DA8 -e 0/449755C0
Type            N      (%)   Record size      (%)   FPI size      (%)
−−−−            −      −−−   −−−−−−−−−−−      −−−   −−−−−−−−      −−−
XLOG         4294 (  3,31)        210406 (  2,50)   19820068 ( 93,78)
Transaction 20004 ( 15,41)        680536 (  8,10)          0 (  0,00)
Storage         1 (  0,00)            42 (  0,00)          0 (  0,00)
CLOG            1 (  0,00)            30 (  0,00)          0 (  0,00)
Standby         6 (  0,00)           416 (  0,00)          0 (  0,00)
Heap2       24774 ( 19,09)       1536253 ( 18,27)      24576 (  0,12)
Heap        80234 ( 61,81)       5946242 ( 70,73)     295664 (  1,40)
Btree         494 (  0,38)         32747 (  0,39)     993860 (  4,70)
           −−−−−−               −−−−−−−−            −−−−−−−−
Total      129808                8406672 [28,46%]   21134168 [71,54%]
```

如果数据页在检查点之间被多次修改，这个比率会更小。这是另一个减少执行检查点的原因。

重复相同的实验，看看压缩是否有帮助。

```bash
=> ALTER SYSTEM SET wal_compression = on;
=> SELECT pg_reload_conf();
=> CHECKPOINT;

=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/44EBC518
(1 row)
postgres$ /usr/local/pgsql/bin/pgbench -t 20000 internals
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/45975008
(1 row)
```

这是启用压缩后的 WAL 大小：

```bash
=> SELECT pg_size_pretty('0/457653B0'::pg_lsn - '0/44D4C228'::pg_lsn);
 pg_size_pretty
−−−−−−−−−−−−−−−−
 10 MB
(1 row)
postgres$ /usr/local/pgsql/bin/pg_waldump --stats \
-p /usr/local/pgsql/data/pg_wal -s 0/44D4C228 -e 0/457653B0
Type            N      (%)       Record size      (%)   FPI size      (%)
−−−−            −      −−−       −−−−−−−−−−−      −−−   −−−−−−−−      −−−
XLOG          344 (  0,29)             17530 (  0,22)     435492 ( 17,75)
Transaction 20001 ( 16,73)            680114 (  8,68)          0 (  0,00)
Storage         1 (  0,00)                42 (  0,00)          0 (  0,00)
Standby         5 (  0,00)               330 (  0,00)          0 (  0,00)
Heap2       18946 ( 15,84)           1207425 ( 15,42)     101601 (  4,14)
Heap        80141 ( 67,02)           5918020 ( 75,56)    1627008 ( 66,31)
Btree         143 (  0,12)              8443 (  0,11)     289654 ( 11,80)
           −−−−−−                   −−−−−−−−            −−−−−−−−
Total      119581                    7831904 [76,14%]    2453755 [23,86%]
```

总而言之，当启用了校验和或 _full_page_writes_ 导致了大量 FPI 时 (几乎总是如此)，尽管会有一些额外的 CPU 开销，使用压缩仍是有意义的。

## 11.3 WAL 级别 [](https://postgres-internals.cn/docs/chapter11/#113-wal-%e7%ba%a7%e5%88%ab)

预写日志的主要目的是实现崩溃恢复。但是，如果你扩展了记录信息的范围，那么 WAL 也可以用于其他目的。PostgreSQL 提供了 minimal、replica 和 logical 三个日志级别。每个级别包括前一个级别记录的所有内容，并增加了一些额外信息。

正在使用的级别由 _wal_level_ 参数定义；修改这个参数需要重启服务器。

### 11.3.1 Minimal [](https://postgres-internals.cn/docs/chapter11/#1131-minimal)

minimal 级别仅保证崩溃恢复。为了节省空间，如果当前事务中创建或截断表的操作涉及大量数据插入 (比如 CREATE TABLE AS SELECT 或者 CREATE INDEX 命令) [18](https://postgres-internals.cn/docs/chapter11/#fn:18)，则不记录这些操作。所有需要的数据都会立即刷新到磁盘，而不是记录这些操作，并且系统表的更改在事务提交后立即可见。

如果此类操作因故障而中断，那么已写入磁盘的数据会不可见，一致性不会受到影响。如果操作完成时发生了故障，所有需要应用后续 WAL 条目的数据都已保存至磁盘上了。

对于新创建的表，必须写入以使此优化生效的数据量由 _wal_skip_threshold_ 参数定义。

让我们看看在 minimal 级别记录了什么。

默认情况下，使用了更高的 replica 级别，此级别支持数据复制。如果选择 minimal 级别，还必须在 _max_wal_senders_ 参数中将允许的 walsender 进程数设置为零：

```bash
=> ALTER SYSTEM SET wal_level = minimal;
=> ALTER SYSTEM SET max_wal_senders = 0;
```

为使这些更改生效，需要重启服务器：

```bash
postgres$ pg_ctl restart -l /home/postgres/logfile
```

注意此时 WAL 的位置：

```bash
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/45767698
(1 row)
```

截断表并在同一事务中继续插入新行，直至超过了 wal_skip_threshold：

```bash
=> BEGIN;
=> TRUNCATE TABLE wal;
=> INSERT INTO wal
     SELECT id FROM generate_series(1,100000) id;
=> COMMIT;
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/45767840
(1 row)
```

> 我使用了 TRUNCATE 命令而不是创建新表，因为这生成的 WAL 条目更少。

让我们使用已经掌握的 pg_waldump 工具来检查生成的 WAL。

```bash
postgres$ /usr/local/pgsql/bin/pg_waldump \
-p /usr/local/pgsql/data/pg_wal -s 0/45767698 -e 0/45767840#
rmgr: Storage     len (rec/tot):     42/    42, tx:          0, lsn:
0/45767698, prev 0/45767660, desc: CREATE base/16391/24784
rmgr: Heap        len (rec/tot):    123/   123, tx:     122844, lsn:
0/457676C8, prev 0/45767698, desc: UPDATE off 45 xmax 122844 flags
0x60 ; new off 48 xmax 0, blkref #0: rel 1663/16391/1259 blk 0
rmgr: Btree       len (rec/tot):     64/    64, tx:     122844, lsn:
0/45767748, prev 0/457676C8, desc: INSERT_LEAF off 176, blkref #0:
rel 1663/16391/2662 blk 2
rmgr: Btree       len (rec/tot):    64/     64, tx:     122844, lsn:
0/45767788, prev 0/45767748, desc: INSERT_LEAF off 147, blkref #0:
rel 1663/16391/2663 blk 2
rmgr: Btree       len (rec/tot):    64/     64, tx:     122844, lsn:
0/457677C8, prev 0/45767788, desc: INSERT_LEAF off 254, blkref #0:
rel 1663/16391/3455 blk 4
rmgr: Transaction len (rec/tot):    54/     54, tx:     122844, lsn:
0/45767808, prev 0/457677C8, desc: COMMIT 2023−03−06 14:03:58.395214
MSK; rels: base/16391/24783
```

第一个条目记录了新表的创建 (因为 TRUNCATE 实际上重写了表)。

接下来的四个条目与系统表操作相关。它们反映了 pg_class 表及其三个索引的更改。

最后，还有一个与提交相关的条目。数据插入没有被记录。

### 11.3.2 Replica [](https://postgres-internals.cn/docs/chapter11/#1132-replica)

在崩溃恢复期间，重放 WAL 条目以恢复磁盘上的数据，达到一致的状态。备份恢复以类似的方式工作，但它还可以使用 WAL 归档将数据库状态恢复至指定的恢复目标点。归档 WAL 条目的数量可能非常大 (例如，跨越好几天)，因此恢复周期将包括多个检查点。因此，minimal 级别是不够的：如果操作未被记录，就无法重复执行它。对于备份恢复，WAL 文件必须包含所有的操作。

复制也是如此：未记录日志的命令不会发送到备库，也不会在备库上重放。

如果备库用于执行查询，那么事情会变得更加复杂。首先，备库需要知道在主库上获取的排它锁的信息，因为这些排它锁可能与备库上的查询冲突。其次，备库必须能够捕获快照，这需要活跃事务的信息。当我们处理备库时，本地事务和在主库上运行的事务都必须考虑在内。

将这些数据发送给备库的唯一方式是定期将其写入 WAL [19](https://postgres-internals.cn/docs/chapter11/#fn:19) 文件。这项工作由 bgwriter [20](https://postgres-internals.cn/docs/chapter11/#fn:20) 进程完成，每 15 秒执行一次 (此间隔时间是硬编码的)。

从备份中进行数据恢复和使用物理复制的能力在 replica 级别下得到保证。

默认使用 replica 级别 ，因此我们可以简单地重置上面配置的参数并重启服务器：

```bash
=> ALTER SYSTEM RESET wal_level;
=> ALTER SYSTEM RESET max_wal_senders;

postgres$ pg_ctl restart -l /home/postgres/logfile
```

让我们重复与之前相同的工作流 (但这次我们将只插入一行，以获得更整洁的输出)：

```bash
=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/45D88E48
(1 row)

=> BEGIN;
=> TRUNCATE TABLE wal;
=> INSERT INTO wal VALUES (42);
=> COMMIT;

=> SELECT pg_current_wal_insert_lsn();
 pg_current_wal_insert_lsn
−−−−−−−−−−−−−−−−−−−−−−−−−−−
 0/45D89108
(1 row)
```

看一下生成的 WAL 条目。

除了我们在 minimal 级别看到的内容之外，我们还获得了以下条目：

- 与复制相关的 Standby 资源管理器条目：RUNNING_XACTS (活跃事务) 和 LOCK
- 记录 INSERT + INIT 操作的条目，该操作初始化了一个新页面并将新行插入到此页面

```bash
postgres$ /usr/local/pgsql/bin/pg_waldump \
-p /usr/local/pgsql/data/pg_wal -s 0/45D88E48 -e 0/45D89108
rmgr: Standby     len (rec/tot):     42/    42, tx:     122846, lsn:
0/45D88E48, prev 0/45D88DD0, desc: LOCK xid 122846 db 16391 rel 16562
rmgr: Storage     len (rec/tot):     42/    42, tx:     122846, lsn:
0/45D88E78, prev 0/45D88E48, desc: CREATE base/16391/24786
rmgr: Heap        len (rec/tot):    123/   123, tx:     122846, lsn:
0/45D88EA8, prev 0/45D88E78, desc: UPDATE off 49 xmax 122846 flags
0x60 ; new off 50 xmax 0, blkref #0: rel 1663/16391/1259 blk 0
rmgr: Btree       len (rec/tot):    64/     64, tx:     122846, lsn:
0/45D88F28, prev 0/45D88EA8, desc: INSERT_LEAF off 178, blkref #0:
rel 1663/16391/2662 blk 2
rmgr: Btree       len (rec/tot):    64/     64, tx:     122846, lsn:
0/45D88F68, prev 0/45D88F28, desc: INSERT_LEAF off 149, blkref #0:
rel 1663/16391/2663 blk 2
rmgr: Btree       len (rec/tot):    64/     64, tx:     122846, lsn:
0/45D88FA8, prev 0/45D88F68, desc: INSERT_LEAF off 256, blkref #0:
rel 1663/16391/3455 blk 4
rmgr: Heap        len (rec/tot):    59/     59, tx:     122846, lsn:
0/45D88FE8, prev 0/45D88FA8, desc: INSERT+INIT off 1 flags 0x00,
blkref #0: rel 1663/16391/24786 blk 0
rmgr: Standby     len (rec/tot):    42/     42, tx:          0, lsn:
0/45D89028, prev 0/45D88FE8, desc: LOCK xid 122846 db 16391 rel 16562
rmgr: Standby     len (rec/tot):    54/     54, tx:          0, lsn:
0/45D89058, prev 0/45D89028, desc: RUNNING_XACTS nextXid 122847
latestCompletedXid 122845 oldestRunningXid 122846; 1 xacts: 122846
rmgr: Transaction len (rec/tot):   114/    114, tx:     122846, lsn:
0/45D89090, prev 0/45D89058, desc: COMMIT 2023−03−06 14:04:14.538399
MSK; rels: base/16391/24785; inval msgs: catcache 51 catcache 50
relcache 16562
```

### 11.3.3 Logical [](https://postgres-internals.cn/docs/chapter11/#1133-logical)

最后但同样重要的是，logical 级别支持逻辑解码和逻辑复制。它必须在发布端激活。

如果我们查看 WAL 条目，会发现该级别与 replica 几乎相同：它添加了与复制源相关的条目，以及一些可能由应用程序生成的任意逻辑条目。大多数情况下，逻辑解码依赖于有关活跃事务的信息 (RUNNING_XACTS)，因为逻辑解码需要捕获快照以跟踪系统表的更改。

---

1. backend/replication/walsender.c [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:1)
    
2. backend/access/transam/xlogreader.c [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:2)
    
3. backend/access/transam/xlog.c, XLogFlush function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:3)
    
4. backend/access/transam/xlog.c, RecordTransactionCommit function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:4)
    
5. postgresql.org/docs/14/wal-async-commit.html [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:5)
    
6. backend/postmaster/walwriter.c [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:6)
    
7. backend/access/transam/xlog.c, XLogBackgroundFlush function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:7)
    
8. postgresql.org/docs/14/pgbench.html [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:8)
    
9. postgresql.org/docs/14/wal-reliability.html [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:9)
    
10. backend/access/transam/xlog.c, issue_xlog_fsync function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:10)
    
11. backend/storage/sync/sync.c [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:11)
    
12. backend/storage/file/fd.c, pg_fsync function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:12)
    
13. backend/storage/page/README [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:13)
    
14. commitfest.postgresql.org/27/2260 [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:14)
    
15. postgresql.org/docs/14/app-pgchecksums.html [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:15)
    
16. backend/storage/buffer/bufmgr.c, MarkBufferDirtyHint function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:16)
    
17. backend/access/transam/xloginsert.c, XLogRecordAssemble function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:17)
    
18. include/utils/rel.h, RelationNeedsWAL macro [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:18)
    
19. backend/storage/ipc/standby, LogStandbySnapshot function [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:19)
    
20. backend/postmaster/bgwriter.c [↩︎](https://postgres-internals.cn/docs/chapter11/#fnref:20)