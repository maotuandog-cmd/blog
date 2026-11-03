# PolarDB PostgreSQL 学习笔记

> 来源: 阿里 PolarDB PG 开源版 + 阿里云官方文档 + 阿里内核月报
> 本地资料: 阿里内核月报 2 篇 (OR 转 UNION ALL / CBQT) + 1 篇 blink-tree 笔记提到 PolarDB
> 学习日期: 2026-09-04
> 定位: 阿里云自研的"一写多读 RAC 共享存储"云原生 PG, 跟 PG 主线版本兼容
> 关联笔记: digblog-20260904-pg-fork-databases-source-analysis.md (四款国产 DB 对比)
>          taobao-monthly-pg-notes.md (阿里月报 65 篇精华)
>          quant67-pg-kernel-notes.md (PG 内核基础)

================================================================
一、PolarDB 是什么 — 全景定位
================================================================

1.1 三个版本的关系
阿里云 PolarDB 是个产品家族, 不止一个:
  - PolarDB MySQL: 阿里起步最早, 主打"一写多读 + 共享存储", 业界对标 Aurora
  - PolarDB PostgreSQL: 本笔记主题, PG 内核 + PolarDB 共享存储架构
  - PolarDB-X (原 DRDS): 分布式 MySQL, 跟 OceanBase / TiDB 同台

源码仓库:
  - 开源版: github.com/ApsaraDB/PolarDB-for-PostgreSQL (基于 PG 14, 持续跟进)
  - 阿里云商用版: 含更多企业级特性 (BDS 备份, DAS 自治, AuditLog 等)

1.2 PolarDB PostgreSQL 的核心架构 — 一写多读
传统 PG 主从:
  主库写 → 流复制 → 备库 (只读)
  问题: 备库有复制延迟, 大查询会拖慢主库
  问题: 备库是"独立存储", 数据冗余, 切换 RTO 30s+ 分钟级

PolarDB PG 一写多读:
  Writer 节点 (1 个) + Reader 节点 (最多 15 个) + 共享存储层 (PolarStore)
  - Writer 写 redo log → PolarStore 接收
  - Reader 节点通过 redo log apply (类似物理备库) 但共享底层 page
  - 所有节点看到同一份数据, 强一致读
  - 切换: Reader 升级为 Writer, 30s 以内

1.3 跟传统主从对比
| 维度        | 传统 PG 主从      | PolarDB PG 一写多读        |
| ----------- | ----------------- | -------------------------- |
| 存储        | 主备各存一份      | 共享一份 (PolarStore)      |
| 只读节点    | 1-N, 流复制延迟   | 1-15, 几乎无延迟           |
| 备机 redo   | 单线程            | 多 worker 并行             |
| 切换 RTO    | 30s-分钟          | 30s 以内 (failover slot)   |
| 成本        | 存储 × 节点数     | 存储 × 1 (节点共享)        |
| 写入延迟    | 低 (本地 fsync)   | 中 (多一次网络到 PolarStore) |
| 扩展性      | 备机越多延迟越大  | 备机只读不影响 Writer      |

================================================================
二、PolarStore 共享存储层
================================================================

2.1 PolarStore 定位
PolarStore 是阿里自研的分布式存储, 跟 AWS Aurora 的"存储即数据库"思路一致:
  - 底层: RDMA 高速网络 + 分布式文件系统 (类似 PolarFS)
  - 上层: 暴露给 PG 的是"块设备"接口
  - 数据: 分片存储, 多副本 (默认 3 副本), 跨可用区

2.2 PG 怎么接入 PolarStore
关键模块: libpolar (用户态库, 替代文件系统调用)
  - PG 的 smgr (storage manager) 改造: 增加 polar_smgr
  - read/write/extend 等调用从原本的 smgrfd 改成 PolarStore 接口
  - redo log 也走 PolarStore (Writer → PolarStore → Reader)

代码定位 (开源版):
  src/backend/storage/smgr/polar_smgr.c
  src/backend/storage/buffer/bufmgr.c   (改造 buffer pool 与 PolarStore 协调)

2.3 跟传统存储的 IO 路径对比
传统 PG IO:
  Buffer Manager → smgr → fd (open/read/write) → page cache → disk

PolarDB PG IO:
  Buffer Manager → smgr (polar_smgr) → libpolar → RDMA → PolarStore
  注: 仍有 page cache, 但跨节点共享, Reader 节点也能命中

2.4 redo log 共享
传统 PG: 主备流复制, Writer 发 WAL 段文件给备机
PolarDB PG: WAL 直接落 PolarStore, 所有 Reader 节点读 PolarStore 的 WAL apply

优势:
  - 避免网络传 WAL 的延迟
  - 多个 Reader 节点读同一份 WAL (单副本读)
  - Writer 写入 WAL 后, Reader 几乎立即可见 (亚秒级)

劣势:
  - 写入延迟略高 (RDMA 也有几微秒)
  - 强依赖 PolarStore 可用性 (存储层是单点依赖)

================================================================
三、RDMA 在 PolarDB 中的应用
================================================================

3.1 RDMA 是什么
Remote Direct Memory Access: 远程直接内存访问
  - 不经过 OS 内核 TCP/IP 协议栈
  - 直接 DMA 到对方内存, 延迟 < 2μs (vs TCP ~50μs)
  - 适合: 高频小包, 实时性要求高

3.2 PolarDB 用 RDMA 干什么
  - Writer → PolarStore 写 redo (高频小包, RDMA 合适)
  - PolarStore 多副本之间同步 (3 副本, RDMA 降低延迟)
  - 跨可用区复制 (同城内, RDMA over Converged Ethernet)

3.3 关键配置
  - 内核: 启用 ib_uverbs / rdma_ucm 模块
  - 网卡: Mellanox ConnectX-5/6 (支持 RoCE v2)
  - 协议: RoCE v2 (RDMA over Converged Ethernet) — 不需要专用 IB 网络
  - PolarStore 服务端: 绑定到 RDMA 设备

================================================================
四、Parallel Index Scan — PolarDB 的并行索引优化
================================================================

来源: 阿里月报 + 阿里云官方文档
关联: quant67 ch12 (执行器并行) + taobao §十一 (并行查询)

4.1 PG 原生并行索引限制 (PG 11)
  - Parallel Index Scan: 支持, 但只支持 B-tree
  - Parallel Index Only Scan: 支持
  - Parallel Bitmap Heap Scan: 支持
  - 但: 同一索引的并行扫描, 多 worker 间通过 next 指针协调
  - 跟 PolarDB 的并行索引扫描 不是同一回事

4.2 PolarDB Parallel Index Scan
PolarDB 在 PG 14 内核基础上做的增强:
  - 支持多 worker 同时扫同一 B-tree 索引
  - 通过 B-tree 的 link pointer (blink-tree) 协调
  - 解决 PG 原生"单 worker 扫描索引"的瓶颈
  - 高并发 OLTP 场景下, 单热点索引读从 O(1) 并发变成 O(N) 并发

4.3 跟 blink-tree 的关系
参见 2024/08 月报 blink-tree 笔记:
  - PG 原生 blink-tree: search 不加 lock-coupling, 跟 SMO 冲突靠 high-key + link-page
  - PolarDB blink-tree: search 加 lock-coupling (S-lock), SMO 加 X-lock
  - PolarDB 实现下, 多 worker 并行 search + SMO 是安全的 (互斥)
  - 跟 InnoDB B-tree 比: 锁粒度更细, 不需要整 Index lock

实测效果 (阿里官方博客):
  - 128 核 PolarDB PG, 单表 100 亿行, B-tree 索引查询
  - 并行 8 worker: 5-10 倍提升
  - 并行 16 worker: 8-15 倍提升
  - 适合: OLAP 范围查询 / 索引覆盖扫描

================================================================
五、CBQT (Cost-Based Query Transformation) — PolarDB 的查询优化
================================================================

来源: 2025/01/08 月报
关联: quant67 ch09-12 (解析/重写/优化器/执行器)

5.1 PG 原生查询变换的局限
PG 优化器大部分变换是"基于规则的" (rule-based):
  - 子查询上拉 (Subquery Pull-Up)
  - 外连接消除 (Outer Join Elimination)
  - 表达式预处理
  - 谓词下推
  - 消除无用连接
  - 这些变换"应用后一定更优" → 直接应用

但有些变换"应用后不一定更优":
  - 子连接下推 (Sublink to Join)
  - OR 转 UNION ALL
  - 这些变换代价可能更高, 需要基于代价选择

5.2 PolarDB CBQT 框架核心
核心思想: 维护"状态空间", 多 query block × 多变换 × 多谓词, 搜索最优

3 个维度:
  - query block (SQL 中不同的子查询 / 子表达式)
  - 规则 (哪种变换: OR→UNION, sublink→join 等)
  - 谓词 (在该 block 的哪个谓词应用规则)

例: select * from t where (a=1 or b=1) and (c=1 or d=1)
  - 2 个 OR 子句, 每个都能独立尝试 OR→UNION
  - 当前 query block, "OR 转 UNION ALL" 需 2 个 CBQT 状态
  - 状态空间: {None, [A], [B], [A,B]}

5.3 搜索策略
| 策略        | 描述                              | 适用          |
| ----------- | --------------------------------- | ------------- |
| twophase    | 只对比"全应用"vs"全不应用"        | 简单, 快, 漏最优 |
| linear      | 依次应用每个状态, 选局部最优       | 默认, 找最优   |

linear 示例:
  None: cost=1000
  [A]: cost=800   ← 选 A
  [A,B]: cost=900 ← B 加进去反而变差, 退回 [A]
  最终: [A]

twophase 示例:
  None: cost=1000
  [A,B]: cost=900
  最终: [A,B]

5.4 4 个核心 GUC 参数
| 参数                         | 默认值      | 描述                          |
| ---------------------------- | ----------- | ----------------------------- |
| polar_enable_cbqt            | off         | CBQT 总开关                   |
| polar_cbqt_cost_threshold    | 50000       | 原始计划 cost 超此值才启用 CBQT |
| polar_cbqt_strategy          | linear      | twophase / linear             |
| polar_cbqt_iteration_limit   | 10          | 最大迭代次数                  |

5.5 已支持的 CBQT 变换
  - polar_cbqt_pushdown_sublink: 子连接下推 (sublink → join)
  - polar_cbqt_convert_or_to_union_all_mode: OR 子句转 UNION ALL

5.6 CBQT 性能影响
官方实测 (sysbench + pgbench):
  - 各种负载下, CBQT 性能影响 < 1%
  - 简单 SQL: 几乎无影响 (re-plan 开销小)
  - 复杂 SQL: 找最优计划耗时增加, 但执行时间下降
  - 整体: 性价比极高, 值得开启

5.7 OR 转 UNION ALL 详解
来源: 2025/01/02 月报

PG 原生 OR 处理:
  - 单表 OR + 有合适索引: BitmapOr (高效)
  - 多表 OR + 涉及连接后: 走连接后 filter, 走全表扫描
    例: select * from t1 join t2 on t1.id=t2.id where (t1.num=1 or t2.cnt=2)
    → 优化器无法利用 t1.num 或 t2.cnt 的索引

OR 转 UNION ALL 后:
  → Append
     ├─ Hash Join where t1.num=1   (用 t1.num 索引)
     └─ Hash Join where t2.cnt=2 and (t1.num<>1 or t1.num is null)  (用 t2.cnt 索引)

实测 (月报示例):
  - 原: cost=660.50, execution=15.836ms (全表扫 t1 + t2)
  - 改: cost=411.16, execution=4.980ms (用上索引, 提速 3 倍)

5.8 OR 转 UNION ALL 限制
- 单表 OR: 优化器不转换 (BitmapOr 已经够好)
- OR 子句参数 > 6 个: 不转换
- SQL 中 OR 数量 > 6 个: 只处理前 6 个
- 转换阈值 polar_cbqt_cost_threshold: 原始 cost 必须超过此值才尝试

5.9 CBQT 跟 hint 集成
支持 /*+ Set(polar_cbqt_convert_or_to_union_all_mode force) Set(polar_cbqt_cost_threshold 0) */
  - SQL 级别覆盖 GUC
  - 强制模式: 即使代价更高也选转换后的路径
  - 用于: 优化器估算不准的场景

================================================================
六、blink-tree 优化对比
================================================================

来源: 2024/08/04 月报

6.1 三种 B-tree 并发算法对比
| 算法                       | 引用                  | 锁粒度            | 代表实现          |
| -------------------------- | --------------------- | ----------------- | ----------------- |
| Bayer-Schkolnick           | 1977 论文             | Index lock + 子树 | MySQL InnoDB      |
| Lehman-Yao B-link          | 1981 论文             | 节点级 + link page | PG 原生          |
| Lanin-Shasha Symmetric     | 1986 论文             | 节点级 (记得路径) | 学术 / PolarDB 借鉴 |

6.2 PG 原生 blink-tree 特点
  - 在每个 node 加 high-key + link-page 字段
  - search 操作: 不加 lock-coupling, 只加当前层 latch
  - SMO 操作: 自下而上加 lock, 同时持有 child + parent + parent->link (最多 3 个 latch)
  - 同一时刻最多 3 个 latch, 大部分情况只有 1 个 (link page 通常只有 1 个)

6.3 PolarDB blink-tree 增强
  - search 操作: 加 lock-coupling (S-lock), 自上而下
  - SMO 操作: 先加子节点 lock, 释放, 再加父节点 lock
    (即: 不同时持 child + parent, 通过释放 + 重新 search 避免竞争)
  - 优势: search 不会因为 SMO 而读不到目标 (lock-coupling 保证一致性)
  - 代价: search 多一次加锁开销, 但避免了"读不到"的失败重试

6.4 search 失败场景对比 (PG 原生)
  Thread A: search 15
  Thread B: insert 9, 触发 SMO
  原生 PG:
    A: read(x) → 15 lies in y → release x
    B: y 分裂成 y(8,9,10) + y'(12,15), x.add_pointer(y')
    A: read(y) → 15 not found in y (在 y')
    → A 失败, 需要 retry
  PolarDB:
    A: read(x) + S-lock(x) → 15 lies in y → read(y) + S-lock(y) → 找 15
    B: 拿 X-lock(y) 被 A 阻塞, 等 A 释放
    A: 顺利找到 15
  → PolarDB 一次性成功, PG 原生可能失败重试

6.5 SMO 路径 (PolarDB 风格 vs PG 原生)
PolarDB 风格:
  1. 加 leaf-page lock + 插入
  2. 释放 leaf-page lock
  3. 重新 search 找父节点 + 加 lock + 修改
  4. (如果父节点也分裂) 重复 1-3
  
  优点: 任何时刻只持 1 个 page lock
  缺点: 需要重新 search 父节点 (除非保存父指针)

PG 原生 blink-tree:
  1. 加 leaf-page lock + 插入
  2. 加父节点 lock (同时持 2 个 lock)
  3. 修改父节点 (可能还要加 link page lock, 持 3 个 lock)
  4. 释放所有 lock
  
  优点: 一次性完成, 不用 re-search
  缺点: 持锁时间长, 影响并发

6.6 link page 数量限制
  PG 原生: 实现上保证 link page 最多 1 个 (避免复杂)
    → search 时最多 1 次 link 跳转
  PolarDB: 允许多个 link page (但实现更复杂)
    → 极端情况下 search 跳转多次

6.7 跟 InnoDB 对比
InnoDB: B-tree + index lock (粗粒度)
  - 修改期间整个索引不可读
  - 简单但并发差

PG blink-tree: 节点级 latch + link page
  - 修改期间只有相关 page 不可读
  - 复杂但并发好

PolarDB blink-tree: 加 lock-coupling
  - search + SMO 互斥
  - 进一步避免 search 失败

================================================================
七、PolarDB 跟其他 PG 系国产 DB 对比
================================================================

来源: digblog-20260904-pg-fork-databases-source-analysis.md

| 维度       | PolarDB PG      | openGauss    | oGRAC        | OpenTeleDB    | OpenTenBase  |
| ---------- | --------------- | ------------ | ------------ | ------------- | ------------ |
| 定位       | 云原生共享存储  | 单机极致     | 多主集中式   | 原位更新 contrib | 真分布式  |
| 一写多读   | 强 (1W+15R)     | 否           | 否 (多写)    | 否            | 否           |
| 多主       | 否              | 否           | 是           | 否            | 否           |
| 共享存储   | 是 (PolarStore) | 否           | 否           | 否            | 否           |
| 节点切换   | 30s (failover slot) | 需手动     | 自动         | 需手动        | 需手动      |
| 适用规模   | TB 级, 强一致读 | 大并发 OLTP  | RAC 等价     | 高频 UPDATE   | PB 级分布式 |
| 兼容 PG    | 高 (基于 PG 14) | 较低         | 较低         | 高 (contrib)  | 中等         |

跟 openGauss 同为阿里系, 但定位不同:
  - openGauss: 强调"单机性能极致" (NUMA + MOT + 并行 redo)
  - PolarDB: 强调"云原生扩展性" (共享存储 + 一写多读 + 自动 fail)

================================================================
八、PolarDB PG 的参数速查
================================================================

8.1 共享存储相关
  - polar_hostid: 节点唯一 ID (0-15)
  - polar_enable_replica_use_basebackup: 是否允许从基础备份建 Reader
  - polar_enable_pfs: 是否启用 PolarFS (推荐 on)
  - polar_max_io_concurrency: PolarStore IO 并发数 (默认 128)

8.2 CBQT 相关 (见 §五)
  - polar_enable_cbqt
  - polar_cbqt_cost_threshold
  - polar_cbqt_strategy
  - polar_cbqt_iteration_limit
  - polar_cbqt_pushdown_sublink
  - polar_cbqt_convert_or_to_union_all_mode (off/on/force)

8.3 复制相关
  - polar_replica_type: 同步/异步 replica
  - polar_replica_timeout: 复制超时
  - failover_slot_enabled: failover slot 开关 (用于 RTO < 30s)

8.4 性能相关
  - polar_parallel_index_scan_workers: 并行索引扫描 worker 数
  - polar_force_parallel_index_scan: 强制并行索引扫描

================================================================
九、关键源码路径速查
================================================================

PolarDB PG 开源版源码布局 (基于 PG 14):
  src/backend/storage/smgr/polar_smgr.c       # 共享存储 SMGR
  src/backend/storage/buffer/bufmgr.c        # Buffer Manager 改造
  src/backend/storage/file/buffile.c         # 改造支持 polar 缓存
  src/backend/replication/polar/             # PolarDB 复制相关
    polar_replica.c                          # Reader 节点 redo apply
    polar_datareplica.c                      # data replica 状态机
  src/backend/utils/adt/polar_*.c            # PolarDB 特有函数
  src/backend/optimizer/plan/polar_cbqt.c    # CBQT 框架实现
    polar_or_to_union_all.c                  # OR→UNION ALL 变换
    polar_sublink_pushdown.c                 # sublink 下推
  src/backend/optimizer/path/                # 优化器路径 (含 blink-tree)
  src/include/polar/                         # 头文件
    polar_smgr.h
    polar_replica.h

blink-tree 相关:
  src/backend/access/nbtree/nbtsearch.c      # search 实现
  src/backend/access/nbtree/nbtinsert.c      # insert + SMO
  src/backend/access/nbtree/nbtpage.c        # page split / link page
  src/include/access/nbtree_private.h        # 内部结构 (含 high-key)

================================================================
十、PolarDB PG vs Aurora PostgreSQL
================================================================

两家都是"共享存储 + 一写多读"思路, 实际差异:

| 维度        | PolarDB PG              | Aurora PostgreSQL       |
| ----------- | ----------------------- | ----------------------- |
| 厂商        | 阿里云                  | AWS                     |
| 存储        | PolarStore (自研)       | Aurora Storage (自研)   |
| 网络        | RDMA (RoCE v2)          | 内部高速网络            |
| Writer 数   | 1 (failover 时切换)     | 1 (failover 时切换)    |
| Reader 数   | 最多 15                 | 最多 15                 |
| 兼容性      | 基于 PG 14              | 跟 Aurora MySQL 兼容 PG 10/11/12/13/14 |
| 自动 failover | < 30s (failover slot) | < 30s                   |
| 跨 AZ       | 支持                    | 支持                    |
| 二级索引并行 | PolarDB blink-tree     | 内部优化 (未公开)       |
| CBQT       | PolarDB 独有            | 无 (靠 PG 优化器原生)   |
| 定价        | 国内 RMB                | USD                     |

→ 整体技术思路高度相似, 阿里 PolarDB 在 PG 系生态, Aurora 在 AWS 生态

================================================================
十一、实战建议
================================================================

11.1 何时选 PolarDB PG
  - 强一致读 (一写多读, 备机无延迟)
  - 海量数据 (TB 级, 共享存储避免数据冗余)
  - 弹性扩展 (Reader 节点秒级添加)
  - 阿里云生态 (RDS for PG 升级路径平滑)

11.2 何时不选 PolarDB PG
  - 数据量小 (< 100GB, 主从足够)
  - 写入延迟敏感 (< 5ms, 多一次 RDMA 开销)
  - 多机房容灾 (PolarStore 跨 AZ 有上限)
  - 非阿里云环境 (自建机房, 共享存储部署复杂)

11.3 性能调优
  - CBQT: 开启 polar_enable_cbqt, 设 cost_threshold=50000
  - Parallel Index Scan: 8-16 worker (实测最佳)
  - 共享 buffer: shared_buffers = 总内存 1/4, 不需要给备机再分配
  - 监控: DAS 自治服务, 自动看慢 SQL

11.4 迁移路径
  - 阿里云 RDS for PG → PolarDB PG: 阿里云内部工具, 平滑
  - 自建 PG → PolarDB PG: 需先迁到阿里云 RDS, 再转 PolarDB
  - 兼容性: PG 14 子集, 部分 contrib (pg_cron / pg_partman 等) 已支持

================================================================
十二、未深入 / 未来学习方向
================================================================

1. PolarDB-X (原 DRDS) 的分布式 PolarDB:
   - 跟 PolarDB PG 是不同产品, 分布式 MySQL
   - 跟 OpenTenBase / oGRAC 才是同台比较

2. PolarDB PG 15/16/17 跟进:
   - PolarDB 开源版更新节奏
   - 新版本特性对 PolarDB 架构的影响

3. PolarFS / PolarStore 内部:
   - 分布式存储的副本一致性
   - RDMA 在存储层的优化
   - 跨 AZ 复制的延迟模型

4. CBQT 实际生产效果:
   - 跑 TPCC / sysbench 对比开启前后的性能
   - 找具体哪些查询收益最大

5. PolarDB 跟 openGauss / OceanBase / TiDB 横向对比:
   - 同一 benchmark 下性能
   - 兼容性 / 迁移成本

================================================================
十三、引用源
================================================================

阿里内核月报:
- 2024/08/04 PostgreSQL blink-tree implement notes (含 PolarDB vs PG 对比)
- 2025/01/02 PolarDB PostgreSQL OR 子句转 UNION ALL
- 2025/01/08 PolarDB PostgreSQL 基于代价的查询变换框架 (CBQT)

阿里云官方文档:
- PolarDB PostgreSQL 基于代价的查询变换: https://help.aliyun.com/zh/polardb/polardb-for-postgresql/cbqt
- 子连接下推: https://help.aliyun.com/zh/polardb/polardb-for-postgresql/pushdown-sublink
- OR 转 UNION ALL: https://help.aliyun.com/zh/polardb/polardb-for-postgresql/or-to-union-all

开源仓库 (基于 PG 14):
- github.com/ApsaraDB/PolarDB-for-PostgreSQL

关联笔记:
- /home/obsidian/postgres/learn/taobao-monthly-pg-notes.md
- /home/obsidian/postgres/learn/20260904-pg-fork-databases-source-analysis.md
- /home/obsidian/postgres/learn/README-pG内核学习总图.md

参考资料:
- Cost-based query transformation in Oracle (dl.acm.org/doi/10.5555/1182635.1164215)
- Bayer & Schkolnick 1977 (InnoDB B-tree)
- Lehman & Yao 1981 (PG B-link)
- Lanin & Shasha 1986 (Symmetric Concurrent B-Tree)
