
### 1 wallevel
`wal_level` 控制 WAL 中记录多少信息，直接影响复制和恢复能力。

报名编程课程

| wal_level     | 记录内容                          | WAL 量（相对） | 支持能力                   |     |
| ------------- | ----------------------------- | --------- | ---------------------- | --- |
| `minimal`     | 只记录崩溃恢复所需的最小信息                | 最低        | 崩溃恢复（无复制）              |     |
| `replica`（默认） | `minimal` 的所有内容 + 物理复制所需的额外信息 | 中等        | 崩溃恢复 + 流复制             |     |
| `logical`     | `replica` 的所有内容 + 逻辑解码所需的额外信息 | 最高        | 崩溃恢复 + 流复制 + 逻辑复制/逻辑解码 |     |

三级的核心差异在 **FPW 行为**和**附加信息**：

**wal_level = minimal**：在大批量操作（`COPY`、`CREATE TABLE AS`、`CREATE INDEX`）时，如果表在创建或 bulk load 时被标记为 `RELATION_IS_LOCAL` 或使用了 `wal_skip_threshold`，PG 会跳过 WAL 写入。这不是跳过所有 WAL——正常 INSERT/UPDATE/DELETE 仍然写 WAL——而是优化了” [数据](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#)本来就不在 shared_buffers 中（新页面直接被写入新的 relfilenode）“的场景。如果 crash 发生，新创建的表可能丢失，但不影响已存在的表。

报名编程课程

**wal_level = replica**：强制所有操作写完整的 WAL record，包括 FPW。`COPY` 等大批量操作不能跳过 WAL 写入。这是流复制的基础——standby 需要完整的变更历史来保持和 primary 一致。

**wal_level = logical**：在 `replica` 的基础上，额外记录逻辑解码所需的信息：每个 UPDATE 和 DELETE 必须保留旧行的完整 image（不只是操作描述），以便 `pgoutput` 插件能重建行的前后状态。这导致 logical 级别的 WAL 写入量可能比 replica 高出 2-4 倍，取决于 UPDATE/DELETE 的比例。



### 2 刷新wal控制频率
----------------------------

| 名称                             | 含义                                                                                                                                                                                                                                                                                                                                            | 默认值   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `checkpoint_timeout`           | 控制刷新的时间窗口                                                                                                                                                                                                                                                                                                                                     | 5 min |
| `max_wal_size`                 | 控制达到多大会触发刷新                                                                                                                                                                                                                                                                                                                                   | 1 GB  |
| `checkpoint_completion_target` | Checkpoint 的 IO 量取决于脏页数量。如果不做任何控制，checkpoint 开始后 PG 会全力刷脏页，导致 [磁盘](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#) IO 瞬时高峰——这就是 checkpoint IO 风暴。<br>`checkpoint_completion_target` 控制 Checkpointer 如何把刷脏页的工作摊平到 `checkpoint_timeout` 时间窗口内。默认值 0.9 表示：checkpoint 的刷脏工作应该在 checkpoint 间隔的 90% 时间内均匀完成。 | 0.9   |



### 3 wal_sync_method 的语义

`wal_sync_method` 控制 `issue_xlog_fsync()` 使用哪个系统调用来刷盘：

|值|系统调用|语义|
|---|---|---|
|`fsync`（默认 Linux）|`fsync()`|刷 [数据](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#) + 元数据（文件大小不会变就不用刷元数据）|
|`fdatasync`|`fdatasync()`|只刷数据，不刷元数据（文件大小变化时仍刷元数据）|
|`open_datasync`|`open(O_DSYNC)`|每次 `write()` 自带同步语义|
|`open_sync`|`open(O_SYNC)`|每次 `write()` 自带同步语义（+ 元数据）|

在 Linux 上，`fsync` 和 `fdatasync` 的性能差异很小。`open_datasync` 把同步负担交给每次 `write()`，在特定文件系统（如 ext4 +  [data](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#)=ordered）上可以减少一次显式的 fsync 调用，但实测差异通常不如 direct I/O 和 `wal_block_size` 的影响大。

部署Linux服务器

PG 15 引入了实验性支持：`wal_sync_method = 'recovery_init_sync_method'` 设置允许直接使用 `O_DIRECT | O_DSYNC` 组合——数据绕过 OS page cache 直接写入 [磁盘](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#)，消除了 double buffering，但需要存储支持 512B 对齐写入。


