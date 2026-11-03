# Storage Decision Trees (Reference for storage-engineering Skill)

Detailed decision trees for picking storage primitives. Use when the
SKILL.md alone is not enough to answer "which one do I pick for *my*
workload?"

## Tree 1: Pick a Storage Engine (B+Tree vs LSM vs Heap vs Column)

```
START
  │
  ├─ Is the workload analytics / OLAP (>1M rows scanned per query)?
  │   YES → Column store (Parquet, ORC, ClickHouse native, openGauss cstore)
  │   NO  → go next
  │
  ├─ Is the workload write-heavy (>10K writes/sec, SSD-backed)?
  │   YES → Is the data model KV / document / wide-column?
  │           YES → LSM-Tree (RocksDB, LevelDB, Cassandra, HBase, TiKV)
  │           NO  → B+Tree with HOT (PG) or append-only btree (no UPDATE)
  │   NO  → go next
  │
  ├─ Is the workload read-heavy OLTP (lots of point + range queries)?
  │   YES → B+Tree (PG / InnoDB / SQLite / Oracle)
  │   NO  → go next
  │
  └─ Is the workload append-only (logs / events / audit)?
      YES → Heap file + B+Tree index on time (PG) OR LSM-Tree (RocksDB)
      NO  → Default: B+Tree. It is the safest choice for general OLTP.
```

## Tree 2: Pick a B+Tree Concurrency Scheme

```
Do readers block on writers in your workload?
  │
  ├─ YES (read-mostly, infrequent writes):
  │   → Latch coupling (crabbing). Simple, correct.
  │
  ├─ Mixed (50/50 read/write, root is hot):
  │   → Optimistic latch coupling.
  │     99% of writes do not split → no fallback overhead.
  │
  ├─ High write throughput (RDBMS production):
  │   → B-link Tree (PG native, 14+).
  │     Right-link + high-key allow search to continue during SMO.
  │
  └─ High read + low write + want lock-free reads:
      → Optimistic Lock Coupling (OLC, Leis 2016).
        Reads never block writers; ~lock-free on read-heavy workloads.
```

PolarDB variant (see `polardb` notes): adds lock-coupling to B-link
search, eliminating the search-fail-retry corner case.

## Tree 3: Pick a WAL + Recovery Strategy

```
Crash recovery cost tolerance?
  │
  ├─ Cannot afford 30s downtime on crash:
  │   → Aurora-style: 6 copies across 3 AZs, redo from any 4 of 6.
  │     (Quorum write, instant recovery, no redo log replay.)
  │
  ├─ 30-60s acceptable, standard OLTP:
  │   → ARIES-style with strict 2PL/SS2PL.
  │     Group commit + parallel redo apply.
  │     Examples: PG (with parallel replay), MySQL InnoDB, Oracle.
  │
  └─ Single-node, low write rate:
      → CoW B+Tree (LMDB / BoltDB) — no WAL at all, just snapshot reads.
```

Torn page protection:
- PG: `full_page_writes = on` (default).
- InnoDB: Doublewrite Buffer.
- Both acceptable, both add a write. Don't disable.

## Tree 4: Pick a Time-Series Database

```
Source data shape?
  │
  ├─ Pure metrics, < 1M active series, want alert rules:
  │   → Prometheus + Thanos/Mimir for long-term.
  │   Best Grafana + PromQL ecosystem.
  │
  ├─ 1M+ active series, high cardinality:
  │   → VictoriaMetrics.
  │     Lowest memory, best compression, PromQL-compatible.
  │
  ├─ IoT, telemetry, need to JOIN with relational data:
  │   → TimescaleDB (PG extension).
  │     Chunk pruning + native SQL + ACID.
  │
  └─ Event data, not numeric metrics, want SQL:
      → InfluxDB IOx.
        Object storage native (S3/GCS), Apache Arrow + Parquet.
```

When to skip time-series DB entirely:
- < 10K rows/sec, only basic aggregation.
- Already on PG, data is sparse / multi-tenant.
- Need strict ACID across time-series + relational tables.

## Tree 5: Pick a Vector Index

```
QPS target? Q = peak queries per second
Data size?  N = number of vectors, d = dimensionality
  │
  ├─ N < 100K,  Q < 1K,  d ≤ 1024:
  │   → pgvector IVFFlat (build fast, decent recall).
  │
  ├─ N < 10M,   Q < 10K,  recall ≥ 95%:
  │   → pgvector HNSW (m=16, ef_construction=100).
  │     or FAISS IndexHNSWFlat (in-memory, faster).
  │
  ├─ N 10M-1B,  Q < 100K,  need recall ≥ 95%:
  │   → Milvus / Qdrant / Weaviate.
  │     GPU acceleration available for FAISS backend.
  │
  ├─ N > 1B,    recall ≥ 95%, can afford SSD:
  │   → Milvus + DiskANN, or Pygmy + ScaNN.
  │
  └─ Need exact results (legal, medical):
      → Brute force. Use SIMD + parallelism. Don't approximate.
```

Memory budget rule of thumb:
- HNSW: ~1.5x raw vector size + 1.5x for the graph edges.
- IVFFlat: raw + 10% for centroids.
- PQ-compressed: 32 bytes/vector + 5% for codebook.
- DiskANN: ~10% of raw in RAM, rest on SSD.

## Tree 6: Pick a Data Lake Format

```
Ecosystem?
  │
  ├─ Spark + Databricks:
  │   → Delta Lake.
  │
  ├─ Trino / Presto / Flink, multi-engine:
  │   → Iceberg.
  │
  ├─ CDC + upsert-heavy, Kafka upstream:
  │   → Hudi.
  │
  └─ Just dumping Parquet files, no transactions needed:
      → Plain Parquet on S3. No metadata layer. Don't over-engineer.
```

The Three-Lake Problem (the shared mental model for all formats):

```
Catalog (mutable)        ←  ←  ←  atomic commits
   ↓ (points at)
Metadata (mutable)      ←  ←  ←  schema evolution
   ↓ (points at)
Data files (immutable)  ←  never modify, only add
```

If you need atomic commits across files, you need a metadata layer. If
you don't, plain Parquet is enough.

## Tree 7: Pick an Object Storage / Compute-Storage Architecture

```
QPS, latency budget, data volume?
  │
  ├─ Latency-critical (< 10ms p99), TB-scale:
  │   → Local NVMe + replication.
  │     Or PolarDB-style shared storage (RDMA + shared SAN).
  │
  ├─ Petabyte-scale, latency-tolerant (seconds):
  │   → Pure separation: Snowflake / BigQuery / Databricks SQL.
  │     S3 for data, compute in K8s.
  │
  ├─ Backup + cold archive:
  │   → S3 / MinIO with lifecycle policies (Glacier after 90 days).
  │
  └─ Mixed: hot on local SSD, warm on S3, cold on Glacier:
      → Tiered storage (HDFS Tiered Storage, S3 Intelligent-Tiering).
```

PG-specific compute-storage options:
- Streaming replication: 1-W + N-R, ~5-30s lag.
- PolarDB: 1-W + 15-R over shared storage, near-zero lag.
- openGauss: similar shared-storage mode.
- pgBackRest to S3: backup-only, no query acceleration.

## Tree 8: Pick a PG-Family DB (2026 snapshot)

```
Multi-master (application-transparent writes to any node)?
  YES → oGRAC (RAC-equivalent, open source).
  NO  → go next
  │
Shared storage (1-W + many-R, near-zero lag)?
  YES → PolarDB PG (Alibaba) or openGauss shared mode.
  NO  → go next
  │
Distributed (scale out by adding nodes, cross-shard queries)?
  YES → OpenTenBase (PG-based) or TiDB (MySQL-compat) or OceanBase.
  NO  → go next
  │
Single-node performance (NUMA + JIT + MOT)?
  YES → openGauss.
  NO  → go next
  │
High UPDATE rate, can't tolerate bloat?
  YES → OpenTeleDB (XStore inplace update, no heap bloat).
  NO  → Plain PG 17/18.
```

The "default" answer is plain PG unless you have a specific reason to
fork. Forks buy specialization; they cost compatibility, ecosystem
size, upgrade complexity.

## Tree 9: Pick an Index (PG-specific)

```
Query pattern?
  │
  ├─ WHERE col = const, single column:
  │   → btree (default) OR hash (if long strings + equality only)
  │
  ├─ WHERE col = const, multiple columns, AND:
  │   → btree composite (column order matters: leftmost prefix)
  │   or GIN multi-column expanded
  │
  ├─ WHERE col = const, multiple columns, OR:
  │   → BitmapOr with single-column btree indexes
  │   or GIN multi-column
  │   or rewrite as UNION ALL (PolarDB CBQT does this)
  │
  ├─ Range + sort:
  │   → btree (already supports it)
  │
  ├─ Array contains / JSONB path / full-text:
  │   → GIN
  │
  ├─ Geometric / range / PostGIS:
  │   → GiST (or sp-gist for non-balanced data)
  │
  ├─ Time series with physical insertion order:
  │   → BRIN (10-100x smaller than btree, slight recall loss)
  │
  ├─ Full-text with ranking:
  │   → rum (GIN variant with ranking)
  │
  └─ Fuzzy / typo-tolerant search:
      → pg_trgm (trigram) GIN
```

Common mistakes:
- Index on low-cardinality column (e.g. boolean) → btree useless, use partial index.
- Index on high-update column → bloat, consider hash or BRIN.
- Too many indexes → every write updates all of them; rule of thumb 3-5 per table.
- Multi-column btree wrong order → btree useless for queries that don't use the leftmost column.

## Tree 10: Diagnose Storage Performance (the 5-step flow)

```
Step 1: Identify the symptom
  │
  ├─ Slow queries (long Execution Time)
  │   → Step 2
  ├─ High CPU on DB
  │   → Step 3
  ├─ High IO / disk wait
  │   → Step 4
  ├─ High memory / OOM
  │   → Step 5
  └─ Replication lag growing
      → check apply worker, network, replay lag

Step 2: Slow query → EXPLAIN ANALYZE
  - Seq Scan on large table → missing index (Tree 9)
  - Bitmap Heap Scan + lossy → work_mem too low
  - Nested Loop with high rows → consider Hash Join
  - Sort method external → work_mem too low
  - "never executed" → planner statistics stale, run ANALYZE

Step 3: High CPU → check wait events
  - IO:DataFileRead → buffer pool too small, increase shared_buffers
  - LWLock:buffer_content → contention, scale reads
  - CPU runqueue > cores → CPU-bound, scale out or simplify query
  - ClientRead/Write → network or client-side bottleneck

Step 4: High IO → check page cache hit ratio
  - < 99% → buffer pool too small OR scan-heavy workload
  - WAL volume > expected → check full_page_writes, FPI ratio
  - Checkpoint too frequent → increase shared_buffers, tune checkpoint_segments/timeout

Step 5: High memory
  - Per-backend memory leak → check work_mem, hash_mem_multiplier
  - shared_buffers + OS cache double-counted → O_DIRECT where possible
  - Long transactions hold catalog → kill idle-in-transaction
  - For LSM: compaction pending growing → scale compute or slow writes
```

## Tree 11: Pick a Compression Strategy

```
Data type and access pattern?
  │
  ├─ Time-series float, sequential access:
  │   → Gorilla XOR + Delta-of-Delta. Universal in TSDBs.
  │
  ├─ Small range integers (timestamps, IDs):
  │   → Delta + Simple-8b / varint. TimescaleDB default.
  │
  ├─ Low-cardinality strings (enums, tags):
  │   → Dictionary encoding + RLE.
  │
  ├─ High-cardinality strings (UUIDs, names):
  │   → LZ4 / Zstd. Don't try to be clever.
  │
  ├─ Booleans:
  │   → Bitmap or run-length.
  │
  └─ Mixed (columnar with all of the above):
      → Parquet/Arrow with per-column codec selection.
```

Compression ratio vs speed (general):
- LZ4: 2-3x, very fast
- Zstd: 3-5x, fast
- Snappy: 2-3x, fast (Google's default)
- Gorilla: 10-100x for time-series, fast decode
- bzip2: 4-6x, slow
- LZMA/xz: 5-8x, very slow

Default to Zstd for general use; LZ4 for hot data; Gorilla for metrics.
