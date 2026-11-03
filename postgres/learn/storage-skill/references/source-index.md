# Source Index for storage-engineering Skill

Maps every topic in the SKILL.md and decision-trees.md to the source
articles in the local corpus. Use this when you need to cite or
deep-dive.

All sources are READ-ONLY. Never modify.

## Storage Hardware and IO

| Topic | Source | Path |
| ----- | ------ | ---- |
| HDD internals | quant67/storage 01 | `quant67-storage-md/01-hdd-internals__hdd-internals.md` |
| SSD NAND FTL | quant67/storage 02 | `quant67-storage-md/02-ssd-nand-flash__ssd-nand-flash.md` |
| NVMe protocol | quant67/storage 03 | `quant67-storage-md/03-nvme-protocol__nvme-protocol.md` |
| Storage performance modeling | quant67/storage 05 | `quant67-storage-md/05-storage-performance-modeling__storage-performance-modeling.md` |
| Storage media selection | quant67/storage 06 | `quant67-storage-md/06-storage-media-selection__storage-media-selection.md` |
| Linux IO stack | quant67/storage 07 | `quant67-storage-md/07-linux-io-stack__linux-io-stack.md` |
| Block device layer | quant67/storage 08 | `quant67-storage-md/08-block-device-layer__block-device-layer.md` |
| Page Cache | quant67/storage 09 | `quant67-storage-md/09-page-cache__page-cache.md` |
| Direct I/O | quant67/storage 10 | `quant67-storage-md/10-direct-io__direct-io.md` |
| io_uring | quant67/storage 79 | `quant67-storage-md/79-o-direct-io-uring__o-direct-io-uring.md` |
| POSIX file locks (pitfalls) | quant67/storage 77 | `quant67-storage-md/77-file-locking-pitfalls__file-locking-pitfalls.md` |
| Small file problem | quant67/storage 75 | `quant67-storage-md/75-small-file-problem__small-file-problem.md` |

## Storage Engines (data structures)

| Topic | Source | Path |
| ----- | ------ | ---- |
| Storage engine overview (4 structures) | quant67/storage 24 | `quant67-storage-md/24-storage-engine-overview__storage-engine-overview.md` |
| B+Tree engineering (deep) | quant67/storage 25 | `quant67-storage-md/25-btree-engineering__btree-engineering.md` |
| B+Tree + 4 concurrency schemes | quant67-storage-7-readings §1 | `quant67-storage-7-readings.md` |
| Buffer Pool | quant67/storage 26 | `quant67-storage-md/26-buffer-pool__buffer-pool.md` |
| WAL + ARIES | quant67/storage 27 | `quant67-storage-md/27-wal-aries__wal-aries.md` |
| Index structures (7 types) | quant67/storage 29 | `quant67-storage-md/29-index-structures__index-structures.md` |
| Bitcask / log-structured | quant67/storage 30 | `quant67-storage-md/30-bitcask__bitcask.md` |
| LSM-Tree + 3 amplifications | quant67/storage 31 | `quant67-storage-md/31-lsm-tree-tuning__lsm-tree-tuning.md` |
| RocksDB practice | quant67/storage 32 | `quant67-storage-md/32-rocksdb-practice__rocksdb-practice.md` |
| LMDB / mmap storage | quant67/storage 33 | `quant67-storage-md/33-lmdb-mmap__lmdb-mmap.md` |
| Embedded engine comparison | quant67/storage 34 | `quant67-storage-md/34-embedded-engine-comparison__embedded-engine-comparison.md` |

## MVCC and Isolation

| Topic | Source | Path |
| ----- | ------ | ---- |
| Storage engine overview (MVCC intro) | quant67/storage 24 §1.2 | `quant67-storage-md/24-storage-engine-overview__storage-engine-overview.md` |
| Transaction isolation (deep) | quant67/storage 28 | `quant67-storage-md/28-transaction-isolation__transaction-isolation.md` |
| MVCC + 4 anomalies + SSI + Percolator | quant67-storage-7-readings §2 | `quant67-storage-7-readings.md` |
| PG MVCC (xmin/xmax/Hint Bits/VM/VACUUM) | taobao §二 + §五 | `taobao-monthly-pg-notes.md` |
| XID wraparound (32-bit issue) | digblog-xid 笔记 | `20260904-pg-32bit-xid-and-64bit-fix.md` |

## Column-Store and Data Lake

| Topic | Source | Path |
| ----- | ------ | ---- |
| Column storage 10x speedup | quant67/storage 35 | `quant67-storage-md/35-columnar-storage__columnar-storage.md` |
| Parquet format deep dive | quant67/storage 36 | `quant67-storage-md/36-parquet__parquet.md` |
| Apache Arrow (zero-copy) | quant67/storage 37 | `quant67-storage-md/37-arrow__arrow.md` |
| Data lake formats (Delta/Iceberg/Hudi) | quant67/storage 40 | `quant67-storage-md/40-data-lake-formats__data-lake-formats.md` |
| Data lake encoding | quant67/storage 41 | `quant67-storage-md/41-data-encoding__data-encoding.md` |
| Compression algorithms | quant67/storage 42 | `quant67-storage-md/42-compression__compression.md` |

## Time-Series and Vector

| Topic | Source | Path |
| ----- | ------ | ---- |
| Time-series engine (Gorilla, Prometheus, IOx, Timescale, VM) | quant67/storage 38 | `quant67-storage-md/38-timeseries-engine__timeseries-engine.md` |
| Vector storage + ANN | quant67/storage 39 | `quant67-storage-md/39-vector-storage__vector-storage.md` |
| Vector index + engines deep dive | quant67-storage-7-readings §4 | `quant67-storage-7-readings.md` |
| TimescaleDB 7-readings §3 | `quant67-storage-7-readings.md` |

## Object Storage and Distributed

| Topic | Source | Path |
| ----- | ------ | ---- |
| MinIO architecture | quant67/storage 48 | `quant67-storage-md/48-minio__minio.md` |
| Erasure coding | quant67/storage 49 | `quant67-storage-md/49-erasure-coding__erasure-coding.md` |
| Object storage gateway | quant67/storage 50 | `quant67-storage-md/50-object-gateway__object-gateway.md` |
| Object storage performance | quant67/storage 51 | `quant67-storage-md/51-object-performance__object-performance.md` |
| Compute-storage separation | quant67/storage 57 | `quant67-storage-md/57-compute-storage-separation__compute-storage-separation.md` |
| Data durability | quant67/storage 58 | `quant67-storage-md/58-data-durability__data-durability.md` |
| Storage failure modes | quant67/storage 59 | `quant67-storage-md/59-storage-failures__storage-failures.md` |

## PG-Family Databases (2026 snapshot)

| Topic | Source | Path |
| ----- | ------ | ---- |
| PolarDB PG (1-W + 15-R + CBQT + blink-tree) | polardb 笔记 | `20260904-polardb-postgresql-notes.md` |
| openGauss (NUMA + MOT + parallel redo + db4ai) | digblog-fork §二 | `20260904-pg-fork-databases-source-analysis.md` |
| oGRAC (multi-master, DRC + DLS + DCS + DTC) | digblog-fork §三 | `20260904-pg-fork-databases-source-analysis.md` |
| OpenTeleDB (XStore inplace update + Undo) | digblog-fork §四 | `20260904-pg-fork-databases-source-analysis.md` |
| OpenTenBase (CN + DN + GTM, real distributed) | digblog-fork §五 | `20260904-pg-fork-databases-source-analysis.md` |
| 5-DB comparison table | digblog-fork §六 | `20260904-pg-fork-databases-source-analysis.md` |
| XID 64-bit fix (Kingbase V9) | digblog-xid 全部 | `20260904-pg-32bit-xid-and-64bit-fix.md` |
| Heikki page epoch (root solution for 32-bit XID) | digblog-xid §四 | `20260904-pg-32bit-xid-and-64bit-fix.md` |
| PG Kernel 26 chapters (the foundation) | quant67-pg-kernel 全部 | `quant67-pg-kernel-notes.md` |

## Cross-corpus: Alibaba monthly PG articles

`taobao-monthly-pg-notes.md` and `quant67-storage-md/2*/2*/-*.md` are the two
main corpora. Cross-references:

| Topic | taobao (PG) | quant67/storage (general) |
| ----- | ----------- | ------------------------- |
| CLOG / SLRU | §三 | §六 (ARIES 上下文) |
| Autovacuum | §五 | - |
| WAL / Checkpoint | §四 | §六 (ARIES) |
| HOT | §六 | §1.5 |
| B+Tree / 7 indexes | §十 | §1 + §8 |
| Parallel query | §十一 | §1.6 (Latch Coupling) |
| 9 isolation abnormal examples | - | §2.9 |
| MemoryContext | §十二 | - |

## Cross-corpus: digoal/blog

For application-pattern and lived-experience content (国产 DB usage, 社区
运营, 故障复盘), see `digblog/` (12MB+ local cache). Use the
`digoal-blog-analyzer` skill.

Key digblog tags for storage-related content:
- "内核原理与开发" (class/14) — kernel internals
- "最佳实践" (class/17) — best practices
- "问题诊断与性能优化" (class/10) — diagnostics
- "高可用" (class/6) — high availability
- "备份恢复容灾" (class/4) — backup/DR

## How to Cite a Fact

When answering a storage question, format citations as:

```
According to quant67/storage 25 §1.3:
- InnoDB 16KB page, 8B key, 6B ptr → fanout ~1170
- 3-layer B+Tree indexes 1.6B rows
- (Bayer & McCreight 1972 paper reference)
```

Or:

```
From taobao-monthly-pg §十 9 种索引:
- 7 index types compared (B+Tree, hash, GIN, GiST, SP-GiST, BRIN, bloom)
- index row size limit 1/3 of buffer page (2712B for 8KB pages)
```

## Total Corpus Stats

| Corpus | Articles | Size | Coverage |
| ------ | -------- | ---- | -------- |
| quant67/storage-md | 79 | 4.9 MB | 2025-2026 general storage |
| taobao-monthly-pg | 65 | 1.4 MB | 2015-2019 PG Alibaba monthly |
| quant67-pg-kernel | 26 | 920 KB | PG kernel foundation |
| digblog | 100+ | 12+ MB | 2010-2026 PG/PolarDB/国产 DB |
| 7-readings | (summary) | 44 KB | Deep reads of 7 storage articles |
| 3 digblog notes | 3 | 55 KB | XID + forks + PolarDB |

Total: ~21 MB of local storage knowledge, queryable offline.
