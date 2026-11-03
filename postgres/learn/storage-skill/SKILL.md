---
name: storage-engineering
description: "Storage picks - engines, indexes, MVCC, timeseries, vectors."
version: 0.1.0
author: maotuan (maotuan), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [storage, database, btree, lsm, mvcc, timeseries, vector, s3, wal, postgresql]
    related_skills: [digoal-blog-analyzer]
---

# Storage Engineering Skill

A condensed, decision-driven storage knowledge base, built from 79 articles
on quant67.com/categories/storage plus 7 deep reads (B+Tree, MVCC, time series,
vectors, data lake, MinIO, compute-storage separation).

This skill is **not** a tutorial. It is a lookup table for: "given a
workload, which storage primitive fits, what are the trade-offs, what
breaks at scale, and where do the corners hide."

## When to Use

- Picking a storage engine (B+Tree vs LSM, row vs column, RUM triangle).
- Diagnosing "why is my DB slow / using too much space / breaking under
  high concurrency" → jump to a specific failure mode.
- Talking to SRE about WAL, ARIES, partial writes, torn pages, doublewrite.
- Choosing between PG / MySQL / PolarDB / oGRAC / OpenTenBase / TiDB /
  OceanBase / openGauss / OpenTeleDB / TimescaleDB / Milvus / MinIO for a
  new project.
- Explaining 3-amplification trade-offs, CLOG vs undo log, RUM conjecture,
  MVCC visibility, lock coupling, blink-tree, blink-tree with
  lock-coupling, Hint Bits, MVCC vacuum pressure, separation of compute
  and storage.

## Don't use for

- Concrete EXPLAIN plans or query tuning → use `digoal-blog-analyzer` or
  `pg_stat_statements` + DBA workflow.
- OS-level filesystem / hardware installation → use `linux` ops skill.
- Database engine internals as a step-by-step learning path → use
  `quant67-pg-kernel` (per-chapter), `taobao-monthly-pg` (per-incident).

## Source Corpus (READ-ONLY truth)

All facts come from these local caches; never write to them:

```
/home/obsidian/postgres/learn/quant67-storage-md/        (79 articles, 4.9 MB)
/home/obsidian/postgres/learn/taobao-monthly-pg/         (65 articles, 1.4 MB)
/home/obsidian/postgres/learn/quant67-storage-7-readings.md   (7 deep reads)
/home/obsidian/postgres/learn/quant67-pg-kernel-notes.md
/home/obsidian/postgres/learn/20260904-pg-32bit-xid-and-64bit-fix.md
/home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
/home/obsidian/postgres/learn/20260904-polardb-postgresql-notes.md
/home/obsidian/postgres/digblog/                         (digoal/blog, 2010-2026)
```

For deep dives see `references/decision-trees.md` and the source articles
directly.

## Speed-Of-Light Storage Pyramid (memorize first)

Seven orders of magnitude, layer by layer:

| Layer                          | Latency      | vs DRAM  |
| ------------------------------ | ------------ | -------- |
| L1 / L2 / L3 cache             | 1 / 4 / 12 ns | 0.01-0.15x |
| DRAM                           | 80 ns         | 1x       |
| Optane PMem (legacy)           | 300 ns        | 4x       |
| NVMe SSD random 4K             | ~100 µs       | 1,250x   |
| SATA SSD random 4K             | ~200 µs       | 2,500x   |
| HDD random 4K                  | ~8 ms         | 100,000x |
| Object (S3) HTTP roundtrip     | 10-50 ms      | 125k-625k |

One HDD random read = millions of CPU instructions. Every cache layer
in the stack exists to keep requests out of the lower half of this table.

The cross-layer principle: **the storage engine owns the upper half
(DRAM, page cache, buffer pool), the kernel owns the lower half
(disk, NIC, RDMA)**. Databases opt out of OS page cache via `O_DIRECT`
because they need eviction, prefetch, and Pin/Unpin semantics the kernel
does not provide.

## RUM Conjecture (the master trade-off)

Three "Rs" can't all be optimal at once:

```
Read amplification (RA)        ↗
Update amplification (UA)   →  RUM conjecture: pick 2, lose 1  ←
Space amplification (SA)        ↘
```

- B+Tree (PG, InnoDB): low RA, **high UA, high SA** (split + reorg, page underfill).
- LSM-Tree (RocksDB, TiKV): low UA, **high RA, high SA** (multi-level reads, compaction).
- Heap file: lowest overhead, but RA = N (no index).

→ Engine selection = which amplification you can tolerate.

**3 LSM compaction strategies**:

| Strategy | UA | RA | SA | Use case |
| -------- | -- | -- | -- | -------- |
| Leveled  | high | low | low | read-heavy (RocksDB default) |
| Tiered   | low  | high | high | write-heavy (Cassandra) |
| FIFO     | lowest | mid | high | TTL/time-series |

## 4 Data Structures (any storage engine is a combination)

```
Heap file  ─  append-only, O(N) read, O(1) insert (with FSM)
Hash       ─  O(1) point lookup, no range (Bitcask / PG hash)
B+Tree     ─  O(log N) point + range, leaves linked (PG / InnoDB / SQLite / Oracle)
LSM-Tree   ─  append + background compact, O(log N) point, range via sorted run
```

Real systems combine them: PG heap with B+Tree indexes, RocksDB SSTable
on LSM, Parquet on column-store, etc.

## Storage Engine API (KV abstraction)

```go
type StorageEngine interface {
    Get(key) (value, err)
    Put(key, value) error
    Delete(key) error
    Scan(startKey, endKey) (Iterator, err)
    WriteBatch(batch) error
}
```

Everything else (transactions, indexes, queries) is built on top of these
five operations. Backing them: durability, read efficiency, write
efficiency, space efficiency — the four requirements no design can
maximize simultaneously.

## B+Tree Engineering Cheat Sheet

Tree height math (InnoDB 16KB page, 8B key, 6B ptr → fanout ~1170):

| Height | Max rows   |
| ------ | ---------- |
| 1      | 1,169      |
| 2      | 1.37M      |
| 3      | 1.6B       |
| 4      | 1.87T      |

3 layers = 16B rows. If internal nodes are cached, point lookup = 1 disk I/O.

### Page layout (Slotted Page)
- Page Header + Slot Array → grows right
- Cell Data ← grows left
- Insert = append cell + insert 2-byte slot. O(1) + tiny slot shift.
- Delete = remove slot, mark cell reusable.

### Splits
- 50/50: classic, but ~50% utilization on sequential inserts.
- 90/10: InnoDB detects `PAGE_LAST_INSERT` + `PAGE_DIRECTION == PAGE_RIGHT`,
  only moves the new row, ~100% utilization.
- Prefix split (PG): short separator keys → higher fanout.

### Concurrency control (4 evolutions)
| Scheme | Lock granularity | Cost | Modern use |
| ------ | ---------------- | ---- | ---------- |
| Latch coupling (crabbing) | 2 nodes | Root hot | Basic B+Tree |
| Optimistic latch coupling | 1 node (write at leaf) | Falls back rarely | Most production |
| B-link Tree (Lehman-Yao 1981) | 1 node + right-link + high-key | Right-link redirect | PG native |
| Optimistic Lock Coupling (Leis 2016) | Version counter, no read lock | Almost lock-free | High-concurrency research |

PG uses B-link Tree. PolarDB extends with lock-coupling on search to
eliminate the SMO race (see `references/decision-trees.md` §B-link).

### Prefix compression + suffix truncation
- Group prefix compression: every 16 keys, store a restart point with
  full key. LevelDB / RocksDB SSTable uses this.
- Suffix truncation (PG 12+): internal node separator keys only need
  enough bytes to discriminate left/right.

### Bulk loading
Sort + bottom-up construction beats 1-by-1 insert by 3-5x (InnoDB
`ALGORITHM=INPLACE`, PG `CREATE INDEX`).

### CoW B+Tree (LMDB, BoltDB)
- Modify → write to new page, parent pointer → new page, up to root.
- Pros: no WAL needed, lock-free readers (snapshot from chosen root).
- Cons: write amplification (every level copied), space reclamation
  blocked by long-running readers.
- Use: read-heavy + snapshots + embed (etcd uses BoltDB).

## MVCC and Isolation (the 4 anomalies)

| Anomaly              | Description                                         |
| -------------------- | --------------------------------------------------- |
| Dirty read           | Read uncommitted data, then T1 rolls back.         |
| Non-repeatable read  | Same row, different value, in same transaction.     |
| Phantom read         | Range query returns different set (new rows).      |
| Write skew           | Two T's read overlapping, write non-conflicting, constraint breaks (not in SQL-92). |

SQL-92 4 isolation levels (only the first 3 anomalies):

| Level          | Dirty | Non-repeat | Phantom |
| -------------- | ----- | ---------- | -------- |
| Read Uncommitted | Y     | Y          | Y        |
| Read Committed   | N     | Y          | Y        |
| Repeatable Read  | N     | N          | Y        |
| Serializable     | N     | N          | N        |

→ Serializable requires preventing write skew → needs SSI or S2PL.

### PG MVCC: heap-table versions
- HeapTuple: `xmin` (insert txid), `xmax` (delete/lock txid), `cmin/cmax`,
  `ctid` (pointing to new version).
- `UPDATE` = mark old + insert new (two tuples).
- Hint Bits (4 bits in t_infomask): HEAP_XMIN_COMMITTED, HEAP_XMIN_INVALID,
  HEAP_XMIN_FROZEN, HEAP_XMAX_COMMITTED, HEAP_XMAX_INVALID.
  - Side effect: hint-bit write on first access can dirty the page, which
    under `data_checksums` or `wal_log_hints` triggers a Full Page Image
    WAL write for an otherwise read-only `SELECT`. **Pure SELECT can produce
    disk writes.**
- Visibility Map (VM): per-page `all-visible` + `all-frozen` bits.
  Enables Index-Only Scan (skip heap fetch) and VACUUM skip.
- Snapshot: `xmin:xmax:xip_list` (e.g. `100:105:102,104`).
- VACUUM: reclaims dead tuples, updates FSM/VM. Autovacuum triggers when
  `dead_tuples > 50 + 0.2 * n_live_tup`.
- XID wraparound: 32-bit, ~2.1B "future" threshold → autovacuum_freeze_max_age.
  See `references/decision-trees.md` §XID for the full story.

### InnoDB MVCC: undo log versions
- Row stores DB_TRX_ID (6B) + DB_ROLL_PTR (7B) → undo log.
- Read View: `m_ids` (active txids), `m_low_limit_id`, `m_up_limit_id`,
  `m_creator_trx_id`.
- RC = new Read View per SELECT; RR = one Read View for whole transaction.
- Gap Locks + Next-Key Locks → InnoDB RR prevents phantoms (unlike SQL
  standard which allows them).
- Purge thread reclaims undo pages when `DB_TRX_ID < min(m_up_limit_id)`
  across all active Read Views.

### SSI (Serializable Snapshot Isolation)
- PG 9.1+ uses SSI for Serializable (not S2PL).
- SIREAD locks: predicate read tracking, 3 granularities (tuple → page →
  relation) auto-upgrade.
- Detects dangerous 2-edge `T1 --rw--> T2 --rw--> T3` (or cycle) patterns.
- False positives exist; tune `max_pred_locks_per_transaction` (default 64)
  / `_per_relation` (10) / `_per_page` (4).
- Application must retry on `SQLSTATE 40001 SerializationFailure`.

### TiDB Percolator
- 3 Column Families: Default (data) + Lock (lock) + Write (commit marker).
- Prewrite (acquire locks, write data with `start_ts`) + Commit (write Write CF, delete Lock CF).
- Async Commit: skip the 2nd TSO, derive `commit_ts` from prewrite max.
- 1PC: single-region transactions skip Commit phase.

## WAL and ARIES (the recovery contract)

WAL three rules:
1. Log must be flushed before the data page it describes.
2. Log must be flushed before the data page is dirty-evicted.
3. All log records for a transaction must be flushed before COMMIT.

ARIES three phases (Recovery):
1. **Analysis**: scan from last checkpoint, rebuild dirty page table +
   active transaction table.
2. **Redo**: replay all committed modifications from the redo LSN.
3. **Undo**: roll back uncommitted transactions via compensation logs.

Torn page problem: 8KB page = 4 × 2KB sectors. Power loss mid-write
produces a "torn page" — first half new, second half old.
- PG: `full_page_writes` (default on) → write whole page to WAL on first
  dirty after checkpoint.
- InnoDB: Doublewrite Buffer (write to shared area first, then real
  location).
- Either is acceptable, both add a write.

LSN (Log Sequence Number): monotonic, every WAL record has one. Each
record's prevLSN chains the transaction's modification log.

Checkpoint: periodic record of "min LSN of all dirty pages". Recovery
scans from checkpoint, not from beginning. Two copies (current +
prev) in control file for crash safety during checkpoint itself.

## Time-Series Optimization (4 levers)

Workload: append-only, time-ordered, query recent windows, hot/cold split.

Gorilla compression (Facebook 2015, near-universal):
- Timestamps: Delta-of-Delta encoding → 1.04 bits/sample (96% of deltas
  are 0 → 1 bit).
- Values: XOR-of-neighbors encoding → 0.33 bits/sample (most bits are
  leading/trailing zeros in IEEE 754 diff).
- Total: **1.37 bits/sample = 93x compression**.

Chunking by time:
- TimescaleDB Hypertable: 1+ day chunks, query prunes to 1 chunk, drop
  chunks = `DROP TABLE` (instant).
- Prometheus: 2-hour blocks, 120-sample chunks, exponential compaction
  (2h×3 → 6h×3 → 18h×3 → 54h).
- VictoriaMetrics: daily partitions, big/small merge, ZSTD on top of Gorilla.

Prometheus architecture (canonical pattern):
- Head block in memory (memSeries per time-series, Gorilla chunks).
- WAL for crash safety of head.
- Append-only blocks on disk with inverted index per block.
- Block compaction merges old blocks.

TSBS benchmark (1000 hosts × 10 metrics × 3 days):
| DB              | Write/s   | Disk   | Compression |
| --------------- | --------- | ------ | ----------- |
| VictoriaMetrics | 1.2M      | 1.8 GB | 183x        |
| InfluxDB IOx    | 450K      | 2.1 GB | 160x        |
| Prometheus      | 680K      | 3.4 GB | 98x         |
| TimescaleDB     | 180K      | 8.6 GB | 39-80x      |
| PG native       | 35K       | 42 GB  | 8x          |

**TimescaleDB is the only one that supports SQL JOIN against relational
data.** That's the deciding factor for IoT + business data.

## Vector Search (ANN) — the 4-algorithm landscape

Problem: 100M × 768-dim brute force = 76.8B ops, 30+ seconds single-thread.
Need sub-linear with acceptable recall.

| Algorithm | Best for | Recall | Memory | Latency |
| --------- | -------- | ------ | ------ | ------- |
| KD-Tree   | d ≤ 20    | exact | low | low |
| LSH       | huge scale, low precision | low-mid | high | mid |
| HNSW      | general (default) | 95-99% | high (in-memory) | low |
| PQ / OPQ  | memory-constrained | 90-95% | very low | mid |
| DiskANN  | SSD-resident billion-scale | 95%+ | low (SSD) | mid |

### pgvector vs dedicated engine

| Dimension | pgvector | Milvus / Qdrant / Weaviate |
| --------- | -------- | -------------------------- |
| Integration | inside PG, SQL + ACID | standalone service |
| Index | HNSW (0.5+) + IVFFlat | HNSW / DiskANN / IVF-PQ |
| Scale | ~10M (single PG) | 100M+ (distributed) |
| ACID | strong | eventual |
| Mixed queries (vector + SQL) | strong JOINs | weak |

**Pick pgvector when**: already on PG, ≤10M vectors, need vector +
relational JOINs in same transaction.
**Pick Milvus/Qdrant when**: 10M+ vectors, RAG scale, can run
separate service.

### HNSW recall vs latency (RAG-tuned)
- efSearch = 64 → ~90% recall@10, P99 ~5ms
- efSearch = 128 → ~95% recall@10, P99 ~15ms
- efSearch = 256 → ~99% recall@10, P99 ~50ms

Re-rank after ANN (cross-encoder) → better to over-fetch then re-rank
than to chase perfect recall.

## Column-Store and Data Lake (the analytics side)

Row store reads full rows; analytics queries read 3 of 100 columns →
90%+ waste. Column store fixes this + enables 10-100x compression +
vectorized execution.

Parquet (canonical format): row group × column chunk × page.
- Predicate pushdown: per-row-group min/max stats → skip irrelevant
  groups.
- Column pruning: only read involved columns.
- Dremel's Definition/Repetition Level for nested data.

Three open table formats:

| Format | Backed by | Strength |
| ------ | --------- | -------- |
| Delta Lake | Databricks | Spark integration |
| Iceberg | Netflix / Apache | Trino/Presto, hidden partitioning |
| Hudi | Uber / Apache | upsert / delete primitives |

**Pick Iceberg for**: Trino/Spark ecosystem, schema evolution heavy.
**Pick Delta for**: Databricks / Spark-native pipeline.
**Pick Hudi for**: CDC + upsert-heavy streaming.

## Object Storage and Compute-Storage Separation

Object storage: HTTP API (S3), blobs, no block semantics. Latency is
HTTP-bound; aim for "fewer, larger requests."

MinIO:
- S3-compatible, single Go binary, easy ops.
- Erasure coding (e.g. 12+4) instead of 3x replication → ~50% storage saving.
- Use for: PG backups (pgbackrest + S3), data lake, cold tier.

Compute-storage separation:
- Compute scales with query load; storage scales with data volume.
- Snowflake / BigQuery / Databricks SQL: pure separation, cold reads from S3.
- PolarDB PG: shared-storage 1-Writer + N-Reader over PolarStore.
- openGauss: optional shared-disk mode.
- OpenTenBase: separate CN/DN/GTM, each scalable.

Key enablers:
- RDMA / NVMe-oF: low-latency network to storage.
- Predicate / column pushdown: skip irrelevant data on remote read.
- Caching: local SSD cache of hot data.

## Database Landscape (PG family, 2026)

| DB          | Differentiator | Multi-master | Shared storage |
| ----------- | -------------- | ------------ | -------------- |
| PG (vanilla)| 18.x, FDW ecosystem | no | no |
| PolarDB PG  | 1-W + 15-R, PolarStore, CBQT, parallel index scan | no | yes (PolarStore) |
| openGauss   | NUMA + MOT + parallel redo + db4ai | no | optional |
| oGRAC       | DRC+DLS+DCS+DTC, RAC-like multi-master | yes (4) | no |
| OpenTeleDB  | XStore inplace-update + Undo, contrib | no | no |
| OpenTenBase | CN/DN/GTM 3-tier, real distributed | no | no |

Storage-layer impact:
- openGauss MOT = full in-memory table + LLVM JIT (no disk I/O for hot data).
- OpenTeleDB XStore = no heap bloat (Undo off-page), index stays small
  but accumulates fragmentation → periodic `REINDEX CONCURRENTLY`.
- OpenTenBase GTM = 64-bit global txid (no wraparound, no freeze).
- PolarDB = reader nodes share one storage, near-zero replication lag.

→ Pick by workload:
- **1-W + many-R, large data, want ACID** → PolarDB
- **Single-node OLTP peak performance** → openGauss
- **Multi-master cluster (RAC equivalent)** → oGRAC
- **Frequent UPDATE, want no vacuum** → OpenTeleDB (XStore tables)
- **Distributed scale-out, need SQL** → OpenTenBase / TiDB

## Index Selection (PG)

| Use case | Index | Notes |
| -------- | ----- | ----- |
| General equality / range / sort | btree | Default choice |
| Long-string equality only | hash | B-tree has 1/3-page limit (2712B for 8KB pages) |
| Array / JSONB / full-text | GIN | GIN multi-column expanded index for any-combination |
| Geometric / range / IP / PostGIS | GiST | General balanced tree template |
| Time series with physical correlation | BRIN | Block-level summary, tiny index, ~10-100x smaller |
| Any-column equality combination | bloom / GIN multi-col | Tradeoff: probabilistic vs exact |
| Full-text + ranking | rum | GIN with ranking |
| Geo + text (Zombodb) | zombodb | PG + ES bridge |

Multi-column index decision:
- index(a, b, c) supports: a / a+b / a+b+c (leftmost prefix).
- a=1 OR b=1 → B-tree useless; use BitmapOr or GIN multi-col.
- OR with JOIN post-filter: rewrite to UNION ALL (PolarDB CBQT does this).

## Buffer Pool Tuning (DB-level)

PG (`shared_buffers`): 25% of RAM. Never set above 40% on dedicated server.
InnoDB (`innodb_buffer_pool_size`): 50-70% of RAM.
- `innodb_buffer_pool_instances`: >1 splits the pool to reduce mutex
  contention on >8GB pools.
- `innodb_adaptive_hash_index` (default ON): in-memory hash for hot
  B+Tree paths. Off if range scans dominate.
- `innodb_change_buffering = all`: defers secondary index updates when
  target page not in pool.

## Monitoring That Catches Storage Bugs Early

- 4 must-have metrics: `pages_read/s`, `pages_written/s`, buffer hit ratio
  (>99% is healthy), WAL generated/s, checkpoint distance.
- Watch `pg_stat_user_tables.n_dead_tup` and `n_mod_since_analyze`
  → autovacuum health.
- Watch `age(relfrozenxid)` for wraparound risk.
- `pg_stat_progress_vacuum`: vacuum progress.
- `pg_locks`: long-held locks, especially when `granted = false`.
- For LSM (RocksDB): compaction pending bytes, write stall count.

## Pitfalls (the embarrassing ones)

1. **Setting `shared_buffers` too high (>40% of RAM)**: kernel page
   cache starvation, slower recovery.
2. **UUID v4 as primary key**: random inserts → 50/50 splits → ~50% page
   utilization, fragmented pages, full B+Tree. Use UUID v7 (time-ordered)
   or bigserial.
3. **InnoDB on spinning disk with `innodb_flush_log_at_trx_commit=1`**:
   every commit = fsync. Either battery-backed write cache, or
   `innodb_flush_log_at_trx_commit=2` (1s loss on crash).
4. **Long-running read transaction in PG**: blocks autovacuum from
   reclaiming tuples it can see → table bloat.
5. **TimescaleDB chunks not configured**: default 7 days. Wrong chunk
   size either bloats catalog (too small) or kills query pruning (too big).
6. **pgvector without HNSW index**: brute force scales O(N). At 10K
   rows it is fine; at 1M it is unusable.
7. **HNSW ef_construction too low (default 64)**: build is fast but
   recall suffers. Raise to 100-200 for production.
8. **Disabling `full_page_writes` on PG**: corruption after crash, period.
9. **S3 request-based pricing on tiny objects**: batch objects > 1MB,
  use S3 Express One Zone, or move to instance store.
10. **Forgetting data_checksums on PG after bulk load**: rebuild via
    `pg_checksums` offline.

11. **Asking "which next step?" after every completion** (workflow
    pitfall, not storage): when finishing the main deliverable, list
    3-5 concrete follow-ups in a single "可选下一步" block and let the
    user pick. Don't ask one option at a time across turns — the user
    will either accept everything (already implied) or steer. The
    single-question clarifier often times out (no user present to
    answer), wasting a turn. Default to the most informative next step
    and offer the others as bullet options.

12. **Writing a new SKILL.md with a colon in `description:`** (skill
    authoring pitfall, not storage): YAML parses `Storage picks: ...` as
    a nested mapping, which crashes the docs generator. Either rewrite
    to avoid the colon (`Storage picks - ...`) or wrap the value in
    double quotes (`description: "Storage picks: ..."`). Quotes don't
    count toward the 60-char hardline.

## How to Use This Skill (operational guidance)

When asked a storage question, follow this loop:

1. **Identify the layer** (hardware / OS / engine / application).
2. **Find the right primitive** in this SKILL.md (B+Tree / LSM / MVCC /
   WAL / ANN / etc.).
3. **Quote the constraint**: which of the 3 amplifications, the
   anomaly, or the layer speed-of-light is the bottleneck?
4. **If the answer is "depends on workload"** (it usually is), use
   the decision tree in `references/decision-trees.md`.
5. **Cite the source** by name (e.g. "from quant67/storage 25 章 §1.3
   B+Tree 高度估算" or "taobao-monthly §十 索引对比"). Never make up facts
   not in the corpus.

## Verification

After answering, confirm:
- [ ] Every claim traces to a specific source article or is marked
  as a derived principle.
- [ ] Numbers (B+Tree heights, compression rates, latency) are quoted
  from the corpus, not invented.
- [ ] The recommendation includes the **trade-off**, not just the
  upside.
- [ ] If the question is "which DB", the answer includes the 5-PG-family
  comparison row from the landscape table.
- [ ] After the main answer, follow-ups are listed as a single
  "可选下一步" block (3-5 bullets), not as chained per-turn
  clarifiers (Pitfall 11).
- [ ] If this session creates or edits a SKILL.md, the frontmatter
  passes: name ≤ 64ch, description ≤ 60ch with no colon (or quoted),
  ends with period, author format "user (handle), Hermes Agent",
  platforms audit-honest (Pitfall 12).

## References

- `references/decision-trees.md` — full decision trees for picking
  storage engines, indexes, and DBs by workload.
- `references/source-index.md` — full index of which quant67 chapter
  covers what topic, for fast lookups.
- `quant67-storage-7-readings.md` (in `learn/`) — 7 deep reads with
  full source quoting.
- `taobao-monthly-pg-notes.md` (in `learn/`) — 65 Alibaba monthly PG
  articles distilled.
- `digblog` (in `postgres/`) — 2010-2026 digoal blog with PG / PolarDB /
  国产 DB content.
