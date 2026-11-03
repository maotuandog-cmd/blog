### 8.1 Checkpoint IO 风暴：根因与调优

**症状**：系统每 5 分钟出现一次 IO 写入高峰，高峰期间查询延迟显著增加，`iostat` 显示 [磁盘](https://quant67.com/post/db/postgresql-kernel/04-wal-internals/04-wal-internals.html#) util 接近 100%。

**根因**：checkpoint 触发后，Checkpointer 需要在固定时间窗口内刷完所有脏页。如果窗口太短或脏页太多，就会形成 IO 风暴。

**排查路径**：

````
-- 1. 观察 checkpoint 触发频率
SELECT * FROM pg_stat_bgwriter;
-- 关注 checkpoints_timed（时间触发）和 checkpoints_req（WAL 触发）的比值
-- 如果 checkpoints_req >> checkpoints_timed，说明 max_wal_size 太容易触发

-- 2. 观察 checkpoint 写入量
-- buffers_checkpoint：checkpoint 刷了多少 buffer
-- buffers_clean：bgwriter 刷了多少 buffer
-- 如果 buffers_checkpoint >> buffers_clean，说明 bgwriter 没分担足够的脏页刷盘

-- 3. 看实际的 WAL 写入速率
SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') / 1024 / 1024 AS wal_mb;
-- 连续两次执行，除以时间差，得到 WAL 写入速率（MB/s）

-- 4. 确认 checkpoint 间隔
SELECT * FROM pg_control_checkpoint();
-- 对比两次查询的 checkpoint_time 字段的间隔
```text

**调优策略**：

1. **增大 `max_wal_size`**：如果 `checkpoints_req`（WAL 触发）过多，说明 WAL 段积累太快。把 `max_wal_size` 从 1GB 调到 8-16GB 能显著降低 checkpoint 频率。但代价是：崩溃恢复时需要重放更多的 WAL，恢复时间变长。恢复时间 ≈ WAL 量 / 恢复吞吐（SSD 上约 200-500MB/s）。16GB WAL 在 SSD 上恢复约 30-80 秒。

2. **增加 `checkpoint_timeout`**：如果脏页总量不大但 `checkpoint_timeout` 触发太快（默认 5 分钟），可以调大（如 15-30 分钟）。代价同样是更长的恢复时间。

3. **调整 `checkpoint_completion_target`**：如果 checkpoint 由 `max_wal_size` 触发，并且 WAL 写入速率接近或超过磁盘带宽的一半，`completion_target` 设为 0.9 可能根本不够。此时该调到 0.5-0.7 吗？不是——Cheap 的"摊平窗口" = `min(checkpoint_timeout, max_wal_size / WAL 写入速率) * completion_target`。如果这个窗口太小，该调的其实是 `max_wal_size`。

4. **启用 `wal_compression = zstd`**（PG 15+）：压缩 FPW 镜像，减少 WAL 写入量。CPU 开销可控（zstd 压缩比和速度的平衡很好），能显著降低 checkpoint 期间的 WAL 写入压力。

5. **提高 `bgwriter` 的积极性**：bgwriter 能在 checkpoint 之前刷掉一部分脏页，减少 checkpoint 的压力。相关参数：`bgwriter_lru_maxpages`（每次最多刷多少页）、`bgwriter_delay`（多久醒来一次）。bgwriter 按 `bgwriter_lru_multiplier` 计算每次应刷的页数，公式基于最近的平均 buffer 替换需求。

### 8.2 max_wal_size 设小导致 WAL 段疯狂切换

**症状**：`pg_stat_bgwriter` 中 `checkpoints_req` 非常高（每秒多次），`pg_ls_waldir()` 显示 WAL 文件不断创建和删除，但每个文件都很小。系统 CPU sys 高（大量 `walwriter` 的 `open()`/`unlink()` 系统调用）。

**根因**：`max_wal_size` 设得过小，WAL 段积累速度远超设定值。每次 WAL 超过 `max_wal_size`，PG 触发一次 checkpoint，刷脏页后回收 WAL 段。如果 WAL 写入速率很高，这个循环在几秒内完成，然后又触发下一次 checkpoint。每次 checkpoint 带来的 FPW 写入进一步增加了 WAL 量，形成恶性循环。

```bash
# 观察 WAL 段文件大小和创建速率
ls -lh $PGDATA/pg_wal/ | head -20

# 观察 WAL segment 切换频率（PG 日志或 pg_stat_wal）
SELECT * FROM pg_stat_wal;
-- wal_segment_size 默认 16MB，所以：
-- wal_bytes / 16MB = segment 切换次数
-- 如果 wal_bytes 增长 1GB 而 max_wal_size=1GB，每 1GB 触发一次 checkpoint
````

**修复**：`max_wal_size` 应该设为约 **3-5 倍** 于”正常负载下一个 checkpoint_timeout 时间窗口内的 WAL 写入量”。计算：WAL 写入速率 (MB/s) × `checkpoint_timeout` (s) × 3。例如 WAL 写入速率 20MB/s，`checkpoint_timeout=300s`，则 `max_wal_size ≥ 20 × 300 × 3 = 18GB`。

报名编程课程

### 8.3 pg_waldump：定位问题 WAL Record

`pg_waldump` 是 PG 自带的 WAL 解码工具，可以把 WAL segment 中的 record 转成人类可读的格式。

**常用命令**：

````
# 查看当前 WAL 段中最新 10 条 record
pg_waldump -p $PGDATA/pg_wal -n 10

# 从指定 LSN 开始查看
pg_waldump -p $PGDATA/pg_wal -s 0/01000028 -n 20

# 只看特定 RMGR（如 Heap）的 record
pg_waldump -p $PGDATA/pg_wal -r Heap -n 20

# 只看特定事务 ID
pg_waldump -p $PGDATA/pg_wal -x 12345

# 查看 record 的统计信息（按 RMGR 和 record 类型统计数量和大小）
pg_waldump -p $PGDATA/pg_wal --stats

# 输出格式：
# rmgr: Heap        len (rec/tot):     54/    54, tx:        585,
#     lsn: 0/01000028, prev 0/01000000, desc: INSERT off 2, blkref #0: ...
# rmgr 表示资源管理器，desc 是对操作的描述
```text

**排查场景 1：WAL 写入量异常大**

```bash
# 统计各 RMGR 的 WAL 输出量
pg_waldump -p $PGDATA/pg_wal -z 0/01000000 --stats=record 2>&1 | head -30
````

如果 `Heap` 占 80% 以上，且操作类型以 `INSERT` 为主，说明是正常的写入。如果 `Heap` 的 `FPW`（整页镜像）占比过高，说明 checkpoint 频率太高导致大量 FPW——回到 8.1 节调整参数。

报名编程课程

**排查场景 2：定位某个事务写了多少 WAL**

````
# 查找事务 12345 的开始和结束
pg_waldump -p $PGDATA/pg_wal -x 12345

# 统计此事务的 WAL 量
pg_waldump -p $PGDATA/pg_wal -x 12345 | awk 'BEGIN{sum=0} /len.*tot:/{match($0, /[0-9]+\/[0-9]+/); print $0; sum+=gensub(/.*\/([0-9]+),.*/, "\\1", "g", $0)} END{print "Total bytes:", sum}'





````

**排查场景 3：确认 WAL 段是否可安全回收**

```sql
# 查看 replication slot 的 restart_lsn
SELECT slot_name, restart_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) / 1024 / 1024 AS lag_mb
FROM pg_replication_slots;

# restart_lsn 之前的 WAL 段不能回收。
# 如果某个 slot 的 lag_mb 很大且 active=false，说明 standby 已经离线
# WAL 一直攒着不被回收——最终可能导致 pg_wal 占满磁盘