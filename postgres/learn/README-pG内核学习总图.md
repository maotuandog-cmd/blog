# PostgreSQL 内核学习总图 (学习入口)

> 目的: 把 4 份核心 PG 学习资料按主题组织, 提供"学某个概念先看哪份笔记"的快速索引.
> 关联资料 (7 份笔记):
>   - quant67-pg-kernel-notes.md (quant67 系列 26 章, 660 行)
>   - quant67-storage-notes.md (quant67/storage 79 篇, 30 KB)
>   - quant67-storage-7-readings.md (quant67 7 篇精读合订本, 全新, 44 KB)
>   - taobao-monthly-pg-notes.md (阿里内核月报 65 篇精华, 851 行)
>   - 20260904-pg-32bit-xid-and-64bit-fix.md (PG 32 位 XID 与 64 位改造, 301 行)
>   - 20260904-pg-fork-databases-source-analysis.md (国产 PG 系衍生 DB, 417 行)
>   - 20260904-polardb-postgresql-notes.md (PolarDB PG 一写多读 + CBQT, 全新, 22 KB)
>   - 原始缓存:
>     - /home/obsidian/postgres/learn/quant67-pg-kernel/ (26 篇 .txt + .html)
>     - /home/obsidian/postgres/learn/taobao-monthly-pg/ (65 篇 markdown)
>     - /home/obsidian/postgres/learn/quant67-storage-md/ (79 篇 markdown, 4.9 MB)

================================================================
一、按"主题概念"反查笔记
================================================================

格式: 概念 → 推荐阅读顺序 (笔记名#章节)

─────────────────────────────────────────────────────────────────
1. MVCC / 可见性 / 快照
─────────────────────────────────────────────────────────────────
学懂 MVCC 必读 3 份, 顺序:
  [1] quant67 ch03 MVCC 实现 (CLOG/hint)
      ← 9.6 万行最权威, 含 hint bit / snapshot scalability
  [2] taobao §二 MVCC 与可见性 (含 10 条规则)
      ← 阿里月报版, 清晰可读, 实战向
  [3] digblog-fork §二 openGauss / §四 OpenTeleDB
      ← 看国产 DB 怎么改造 MVCC (MOT 全内存 / XStore 原位更新)

相关章节:
  - taobao §三 CLOG 详解 (pg_fsync 触发链路 + buffer 数量公式)
  - taobao §六 Heap Only Tuple (HOT 索引 IO 优化)
  - digblog-xid §二 freeze 标志位 (MVCC + freeze 的接口)

─────────────────────────────────────────────────────────────────
2. XID / freeze / 32 位事务号困境
─────────────────────────────────────────────────────────────────
这是 PG 最深的"狗皮膏药", 直接看 digblog-xid 笔记:
  [1] digblog-xid 全部 (12 节)
      ← PG 半圆困境 + Heikki page epoch + 金仓 64 位 XID
  [2] quant67 ch08 VACUUM 与 Freezing
      ← freeze 实现机制 (heap scan / dead tuple / FSM/VM / wraparound)
  [3] taobao §三 CLOG + §五 Autovacuum
      ← XID 关联的 CLOG truncate / autovacuum 调度
  [4] quant67 ch22 经典故障 5 例 (含 wraparound 案例)

─────────────────────────────────────────────────────────────────
3. CLOG / SLRU / Subtrans / Multixact
─────────────────────────────────────────────────────────────────
  [1] quant67 ch03 MVCC (CLOG 部分)
  [2] taobao §三 CLOG 详解 (源码级, 含 SlruSelectLRUPage 流程)
  [3] quant67 ch07 事务与子事务 (pg_subtrans / 2PC)
  [4] taobao §七 行锁 (MultiXact 部分)

─────────────────────────────────────────────────────────────────
4. WAL / Checkpoint / 恢复
─────────────────────────────────────────────────────────────────
  [1] quant67 ch04 WAL 内部机制 (XLogInsert → checkpoint → REDO)
  [2] taobao §四 Checkpoint 机制 (含 completion_target 数学)
  [3] taobao §五 Autovacuum (与 checkpoint 协作)
  [4] quant67 ch24 数据恢复边界 (PITR / pg_resetwal)

─────────────────────────────────────────────────────────────────
5. Autovacuum (launcher + worker)
─────────────────────────────────────────────────────────────────
  [1] quant67 ch08 VACUUM (整体)
  [2] taobao §五 Autovacuum 双进程深度 (源码级)
      ← 2017/12 launcher + 2018/02 worker 两篇精华
  [3] digblog-xid §四 freeze 机制 (vacuum 跟 freeze 关联)

─────────────────────────────────────────────────────────────────
6. 进程模型 / 共享内存 / 后台进程
─────────────────────────────────────────────────────────────────
  [1] quant67 ch01 进程模型与共享内存 (Postmaster fork backend)
  [2] quant67 ch05 Buffer Manager (shared_buffers 三层)
  [3] taobao §十二 MemoryContext (本地内存管理)
  [4] taobao §十一 并行查询 (Background Worker 动态启动)

─────────────────────────────────────────────────────────────────
7. 锁 / 行锁 / 死锁
─────────────────────────────────────────────────────────────────
  [1] quant67 ch06 锁管理器 (SpinLock → LWLock → Heavyweight 三层)
  [2] taobao §七 行锁与多版本并发 (4 种行锁模式 + MultiXact)
  [3] quant67 ch22 经典故障 (idle-in-tx 案例)

─────────────────────────────────────────────────────────────────
8. 索引体系 (btree / gin / gist / spgist / brin / hash / bloom)
─────────────────────────────────────────────────────────────────
  [1] quant67 ch14-17 (B-Tree / GiST / GIN / BRIN+Hash+Bloom)
      ← 每章含源码 + 应用场景
  [2] taobao §十 9 种索引原理与场景 (实战对比表)
  [3] taobao §十一 并行查询 (并行索引扫描)

─────────────────────────────────────────────────────────────────
9. 查询优化器 / 执行器
─────────────────────────────────────────────────────────────────
  [1] quant67 ch09 解析与重写
  [2] quant67 ch10 统计信息与代价模型 (MCV/histogram/correlation)
  [3] quant67 ch11 Join 顺序与路径生成 (GEQO)
  [4] quant67 ch12 执行器与表达式求值 (Volcano 模型)
  [5] quant67 ch13 JIT 编译 (LLVM)
  [6] taobao §十一 并行查询 (partial path / parallel_divisor)

─────────────────────────────────────────────────────────────────
10. 并行查询 / Background Worker / DSM
─────────────────────────────────────────────────────────────────
  [1] quant67 ch12 执行器 (并行算子部分)
  [2] taobao §十一 并行查询 (PG 9.6→12+ 演进时间线)
  [3] digblog-fork §二 openGauss NUMA-aware XLogInsertLock

─────────────────────────────────────────────────────────────────
11. 复制 (流复制 / 逻辑复制 / 快照)
─────────────────────────────────────────────────────────────────
  [1] quant67 ch18 流复制 (WAL Sender/Receiver / sync 3 语义)
  [2] quant67 ch19 逻辑复制 (LogicalDecoding / 4 种冲突)
  [3] quant67 ch20 扩展系统与 FDW
  [4] taobao §八 一致性快照迁移 (7 步法, 含 logical slot)

─────────────────────────────────────────────────────────────────
12. 内存管理 (MemoryContext / AllocSet)
─────────────────────────────────────────────────────────────────
  [1] quant67 ch01 (共享内存部分)
  [2] taobao §十二 MemoryContext (含 AllocSetAlloc 流程 + 虚函数表)
      ← 2024/08 精华篇, 跟 PG 14.11 源码同步

─────────────────────────────────────────────────────────────────
13. 事务 / 子事务 / 2PC / Savepoint
─────────────────────────────────────────────────────────────────
  [1] quant67 ch07 事务与子事务
  [2] digblog-fork §四 OpenTeleDB (XStore 跟子事务的兼容性)

─────────────────────────────────────────────────────────────────
14. 国产 PG 系衍生 DB (openGauss / oGRAC / OpenTeleDB / OpenTenBase)
─────────────────────────────────────────────────────────────────
全部看 digblog-fork 笔记:
  [1] digblog-fork §二 openGauss (MOT + NUMA + 并行 redo + db4ai)
  [2] digblog-fork §三 oGRAC (DRC + DLS + DCS + DTC, 类 RAC)
  [3] digblog-fork §四 OpenTeleDB (XStore 原位更新 + Undo)
  [4] digblog-fork §五 OpenTenBase (CN + DN + GTM 真分布式)
  [5] digblog-fork §六 生态定位 (PG 系多主对比表)

关联主题:
  - 看 openGauss MOT → 跟 quant67 ch12/13 (执行器 + JIT) 对比
  - 看 oGRAC 多主 → 跟 taobao §七 行锁 + §八 复制对比
  - 看 XStore 原位更新 → 跟 taobao §六 HOT 对比
  - 看 OpenTenBase GTM → 跟 digblog-xid §四 64 位 XID 关联

─────────────────────────────────────────────────────────────────
15. 64 位 XID 改造 (金仓 V9 / Heikki 方案 / 社区 RFC)
─────────────────────────────────────────────────────────────────
  [1] digblog-xid 全部 (PG 32 位困境 + Heikki page epoch + 金仓)
  [2] quant67 ch08 VACUUM (freeze 部分, 64 位化后 freeze 频率变化)
  [3] digblog-fork §二 openGauss (NUMA-aware CLOG 改造)

─────────────────────────────────────────────────────────────────
17. 监控 / 性能调查 / 故障排查
─────────────────────────────────────────────────────────────────
  [1] quant67 ch21 监控体系与告警设计 (6 维度)
  [2] quant67 ch22 经典故障 5 例
  [3] quant67 ch23 性能调查 5 层链 (pg_stat_statements → wait_event)
  [4] quant67 ch24 数据恢复边界
  [5] quant67 ch26 配置陷阱 (11 个 GUC)

─────────────────────────────────────────────────────────────────
18. 大版本升级 / 兼容性 / 配置
─────────────────────────────────────────────────────────────────
  [1] quant67 ch25 大版本升级 (pg_upgrade --link 风险)
  [2] quant67 ch26 配置陷阱 (11 个 GUC: shared_buffers/work_mem/fsync 等)

─────────────────────────────────────────────────────────────────
19. PolarDB PostgreSQL 专有 (一写多读 + 共享存储 + CBQT + blink-tree)
─────────────────────────────────────────────────────────────────
  [1] polardb 笔记全部 (13 节)
      ← 阿里云自研, 一写多读, PolarStore 共享存储, RDMA, Parallel Index Scan,
         CBQT 框架, blink-tree 增强
  [2] taobao 2024/08/04 blink-tree (含 PolarDB vs PG 详细对比)
  [3] taobao 2025/01/02 OR 转 UNION ALL (CBQT 应用案例)
  [4] taobao 2025/01/08 CBQT 框架 (PolarDB 独有查询优化)
  [5] quant67 ch14 B-Tree (blink-tree 基础)
  [6] quant67 ch12 执行器 (并行查询基础, PolarDB Parallel Index Scan 基础)

─────────────────────────────────────────────────────────────────
20. PG 跟 MySQL / Oracle 跨 DB 对比
─────────────────────────────────────────────────────────────────
  [1] quant67 ch23 性能调查 (跟 MySQL/Oracle 故障模式对比)
  [2] digblog-xid §十 应用开发者建议 (PG 系跨库事务号设计哲学)
  [3] digblog-fork §六 国产 DB 生态定位 (PolarDB/OceanBase/TiDB/GaussDB 等)

─────────────────────────────────────────────────────────────────
21. 通用存储引擎 (B+Tree / LSM-Tree / 列存 / 对象存储)
─────────────────────────────────────────────────────────────────
  (跨 DB, 跨语言, 工业级通用)
  [1] quant67-storage 笔记全部 (18 节, 30 KB)
      ← 24 存储引擎概览, 25 B+Tree 实现, 26 Buffer Pool, 27 ARIES WAL,
         28 事务隔离实现, 29 7 种索引, 30 Bitcask/日志结构, 31 LSM 三种放大,
         32 RocksDB 实践, 33 LMDB, 34 嵌入式引擎对比, 35 列存, 36 Parquet,
         37 Arrow, 38 时序, 39 向量索引
  [2] quant67-pg-kernel ch14-17 (PG B-Tree/GiST/GIN/BRIN 实现, 跟 §七-八互为补充)
  [3] taobao §十 9 种索引 (实战对比, 跟 §八 互补)

─────────────────────────────────────────────────────────────────
22. 缓存工程 (Page Cache + Buffer Pool + 应用层)
─────────────────────────────────────────────────────────────────
  [1] quant67-storage §十二 缓存工程 (基于 66 章)
  [2] quant67-pg-kernel ch05 Buffer Manager
  [3] quant67-storage §五 Buffer Pool (基于 26 章, DB 视角)
  [4] quant67-storage 09 Page Cache (Linux 视角)

─────────────────────────────────────────────────────────────────
23. 存算分离 / 共享存储 / PolarStore 类架构
─────────────────────────────────────────────────────────────────
  [1] polardb 笔记 §二 PolarStore (阿里云)
  [2] quant67-storage 57 存算分离架构 (通用)
  [3] quant67-storage 70/71 云块/云对象存储内部

================================================================
二、按"学习目标"推荐路径
================================================================

A. 入门者 (1-3 个月, 想搞懂 PG 怎么工作)
   顺序:
   1. quant67 ch01 进程模型 → 知道 PG 进程怎么跑
   2. quant67 ch02 页面布局 → 知道数据怎么存
   3. quant67 ch03 MVCC → 知道并发怎么管
   4. quant67 ch14 B-Tree → 知道索引怎么用
   5. quant67 ch04 WAL → 知道持久化怎么保
   6. quant67 ch08 VACUUM → 知道旧数据怎么清
   7. quant67 ch22 经典故障 → 知道常见坑
   8. 配套读 taobao 对应章节 (实战案例)

B. 内核开发者 (3-6 个月, 想给 PG 贡献代码)
   顺序:
   1. quant67 全部 26 章 (按顺序)
   2. taobao §十二 MemoryContext (PG 14 内存机制)
   3. digblog-xid 全部 (XID 困境 + Heikki 方案)
   4. taobao §五 Autovacuum (源码级)
   5. taobao §十一 并行查询 (Background Worker + DSM)
   6. quant67 ch18-19 复制 (流 + 逻辑)
   7. digblog-fork 全部 (看国产 DB 怎么改造 PG 内核)

C. DBA / 运维 (1-2 个月, 解决生产问题)
   顺序:
   1. quant67 ch21-26 (运维实战 6 章)
   2. taobao §五 Autovacuum (调优)
   3. taobao §四 Checkpoint (调优参数)
   4. quant67 ch22 经典故障
   5. taobao §十 索引选型
   6. digblog-xid §十 应用开发者建议 (监控告警阈值)

D. 国产 DB 评估者 (2-4 周, 想搞懂 openGauss/oGRAC/OpenTeleDB/OpenTenBase)
   顺序:
   1. 先有 PG 内核基础 (走 A 路径的前 6 章)
   2. digblog-fork 全部
   3. taobao §八 一致性快照迁移 (迁移实战)
   4. taobao §十 索引 (看哪些跟 PG 兼容)
   5. digblog-xid §七 金仓 64 位 XID (国产内核改造代表)

================================================================
三、按"PG 版本演进"看时间线
================================================================

PG 9.4 (2014):
  - quant67 ch17 BRIN (首次引入)
  - taobao BRIN 案例

PG 9.5 (2016):
  - quant67 ch07 2PC / SAVEPOINT 增强
  - taobao 2015/12/07 表膨胀

PG 9.6 (2016):
  - 并行查询起步 (taobao §十一)
  - 聚合 OP 复用 (taobao 2016/10)

PG 10 (2017):
  - 逻辑复制 GA (quant67 ch19)
  - 声明式分区表 (taobao 2020/09 并发建索引)
  - 间接索引 (HOT 升级)
  - taobao §十二 MemoryContext (PG 14 已稳定)

PG 11 (2018):
  - 真并行 Hash Join (taobao §十一)
  - 并行 Append + Partition-wise JOIN
  - JIT 起步 (quant67 ch13)

PG 12 (2019):
  - taobao §十 9 种索引 (PG 12 已具备)
  - 多版本并发控制介绍及实例分析

PG 13 (2020):
  - taobao 2020/06/05 Beta 1 初体验
  - taobao 2021/01/08 PG 13 新特性

PG 14 (2021):
  - taobao 2021/12/01 新特性浅析
  - taobao §十二 MemoryContext 标准实现 (PG 14.11 源码)

PG 16 (2023):
  - digblog-xid §八 PG 16 引入 xid8 (但只解决用户字段, 非内部分配)

PG 17 (2024):
  - taobao 2024/07 子事务探秘
  - taobao 2024/08 MemoryContext 深入
  - taobao 2024/08/04 Blink-tree 实现笔记
  - taobao 2025/03 逻辑复制全部原理

PG 18 (2025-2026):
  - digblog-xid §八 仍未合并 64 位 XID
  - taobao 2026/07 Buffer Access 5 Rules / HeapTable + Pin

PolarDB PG (阿里云) 演进:
  - 基于 PG 14 开源版, 持续跟进主线
  - v1.0 (2020): PolarStore 共享存储 + 一写多读
  - v2.0 (2021): Parallel Index Scan (blink-tree 增强)
  - v2.2 (2023): CBQT 框架 (子连接下推 + OR 转 UNION ALL)
  - v2.3+ (2024-2025): 持续优化 RDMA 路径, RDMA over Converged Ethernet
  - 相关: polardb 笔记 §一-§四

================================================================
四、4 份笔记的定位差异 (避免重复阅读)
================================================================

| 笔记                    | 作者视角       | 深度          | 重点              | 时效性         |
| ----------------------- | -------------- | ------------- | ----------------- | -------------- |
| quant67-pg-kernel       | quant67 个人   | 源码级        | PG 全栈 26 章     | PG 17/18       |
| quant67-storage         | quant67 个人   | 源码级        | 通用存储 79 篇    | 2025-2026 最新 |
| quant67-storage-7-readings | quant67 个人 | 精读 7 篇     | B+Tree/MVCC/时序/向量 + 数据湖/MinIO/存算分离 | 2025-2026 |
| taobao-monthly-pg       | 阿里内核团队   | 源码+实战     | 9 大主题 + 65 篇  | PG 9.4-17      |
| digblog-xid             | 德哥个人       | 综述+对比     | 32 位 XID 专题    | PG 18 + 金仓 V9|
| digblog-fork            | 德哥个人       | 源码+模块     | 4 款国产 DB       | 2026 年最新版 |
| polardb-postgresql      | 阿里云 + 阿里内核团队 | 架构+代码 | 一写多读 + CBQT + blink-tree | PolarDB v2.x   |

阅读优先级建议:
- 入门先读 quant67-pg-kernel (PG 体系完整)
- 想懂通用存储 → quant67-storage (DB 无关, 跨 PG/MySQL/RocksDB/列存)
- 实战查 taobao (代码片段可复制)
- XID 看 digblog-xid (Heikki 方案最权威)
- 国产 DB 看 digblog-fork (4 款对比清晰)
- PolarDB 专有看 polardb 笔记 (一写多读 + CBQT 是核心差异化)
- 跨库对比查总图 §一.20

================================================================
五、关键交叉引用表
================================================================

当在 A 笔记看到某主题时, 应跳转到 B 笔记的对应章节:

A 笔记位置                            →  B 笔记位置
─────────────────────────────────────────────────────
quant67 ch03 MVCC                      →  taobao §二/三 (CLOG/Hint Bits)
quant67 ch04 WAL                       →  taobao §四 (Checkpoint)
quant67 ch05 Buffer Manager            →  taobao §十二 (MemoryContext)
quant67 ch06 锁管理器                  →  taobao §七 (行锁/MultiXact)
quant67 ch07 事务/2PC                  →  taobao §八 (一致性快照迁移)
quant67 ch08 VACUUM/Freeze             →  taobao §五 (Autovacuum)
                                       →  digblog-xid §二/三/四
quant67 ch11 Join 顺序                 →  taobao §十一 (并行 Hash Join)
quant67 ch12 执行器                    →  taobao §十一 (并行查询)
quant67 ch14 B-Tree                    →  taobao §十 (9 种索引)
quant67 ch16 GIN                       →  taobao §十.4 (GIN 多列展开)
quant67 ch17 BRIN                      →  taobao §十.5 (BRIN 时序)
quant67 ch18 流复制                    →  taobao §八 (一致性快照)
quant67 ch19 逻辑复制                  →  taobao §八 (logical decoding)
quant67 ch20 FDW                       →  digblog-fork §五 OpenTenBase FDW
quant67 ch22 wraparound 故障           →  digblog-xid §一/二 (半圆困境)
quant67 ch24 数据恢复                  →  taobao §四 (Timeline + PITR)
quant67 ch26 GUC 陷阱                  →  taobao §四 (checkpoint 参数)

─────────────────────────────────────────────────────
taobao §三 CLOG                       →  quant67 ch03 (MVCC)
taobao §四 Checkpoint                 →  quant67 ch04 (WAL)
taobao §五 Autovacuum                 →  quant67 ch08 (VACUUM)
taobao §六 HOT                        →  digblog-fork §四 (XStore 对比)
taobao §七 行锁                       →  quant67 ch06 (锁)
taobao §八 快照迁移                   →  quant67 ch18-19 (复制)
taobao §十 9 种索引                   →  quant67 ch14-17 (索引)
taobao §十一 并行查询                 →  quant67 ch11-12 (Join/Executor)
taobao §十二 MemoryContext            →  quant67 ch01/ch05 (进程/Buffer)

─────────────────────────────────────────────────────
digblog-xid §四 Heikki epoch          →  quant67 ch08 (freeze)
digblog-xid §七 金仓 64 位            →  quant67 ch07 (事务) + taobao §五 (autovacuum)
digblog-xid §九 3 阶段合并            →  taobao §三/五 (CLOG/Autovacuum 配合)

─────────────────────────────────────────────────────
digblog-fork §二 openGauss MOT        →  quant67 ch12-13 (执行器 + JIT)
digblog-fork §三 oGRAC DRC            →  taobao §七 (行锁) + §八 (复制)
digblog-fork §四 OpenTeleDB XStore    →  taobao §六 (HOT) + quant67 ch08 (VACUUM)
digblog-fork §五 OpenTenBase GTM      →  digblog-xid 全部 (GXID 64 位)

─────────────────────────────────────────────────────
polardb §四 Parallel Index Scan     →  taobao 2024/08 blink-tree 对比
polardb §五 CBQT                    →  taobao 2025/01 OR 转 UNION ALL
                                       taobao 2025/01 CBQT 框架
polardb §六 blink-tree              →  taobao 2024/08 blink-tree 详细对比
                                       quant67 ch14 B-Tree
polardb §七 国产 DB 对比            →  digblog-fork 全部 (四款国产 DB)

================================================================
六、待补充 / 未来学习方向
================================================================

1. 国产 DB 国产数据库源码:
   - PolarDB (阿里) — ✅ 已完成, 见 polardb 笔记
   - GaussDB (华为) — 集中式 + 多副本, 不同于 oGRAC
   - TDSQL (腾讯) — 跟 OpenTenBase 同源
   - GoldenDB (中兴) — 金融级

2. PG 18 关键特性:
   - async I/O (PG 18 主要特性)
   - logical replication subscriber 优化
   - 跳过 vacuum 改进

3. 实操验证:
   - PG 18.6 源码 + debug 二进制：已具备 (`/opt/pg-src/postgresql-18.6`, `/opt/pg-18`)
   - GDB attach 活 backend：批次 1（ch01/02/05/04）已打通（`setcap cap_sys_ptrace`；笔记在 `learn/quant67-pg18-study/`）
   - 待做：freeze 风暴测试 (digblog-xid §五 2.1)；批次 2 锁/MVCC 断点

4. 学习路径推荐:
   → 把本总图打印或收藏, 每次想深入某个主题, 查表找对应章节
   → 跟 MongoDB 笔记交叉 (quant67 笔记末尾有 "与 MongoDB 交叉点")

================================================================
七、引用源
================================================================

- /home/obsidian/postgres/learn/quant67-pg-kernel-notes.md
- /home/obsidian/postgres/learn/quant67-storage-notes.md
- /home/obsidian/postgres/learn/quant67-storage-7-readings.md
- /home/obsidian/postgres/learn/taobao-monthly-pg-notes.md
- /home/obsidian/postgres/learn/20260904-pg-32bit-xid-and-64bit-fix.md
- /home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
- /home/obsidian/postgres/learn/20260904-polardb-postgresql-notes.md

本地缓存:
- /home/obsidian/postgres/learn/quant67-pg-kernel/ (26 篇 .txt + 26 篇 .html, 920KB)
- /home/obsidian/postgres/learn/quant67-storage-md/ (79 篇 markdown, 4.9 MB)
- /home/obsidian/postgres/learn/taobao-monthly-pg/ (65 篇 markdown, 1.4MB)
- /home/obsidian/postgres/digblog/ (digoal blog 本地克隆, 持续同步)
- /home/obsidian/postgres/learn/quant67-pg18-study/ (quant67 PG18 章节研究)
