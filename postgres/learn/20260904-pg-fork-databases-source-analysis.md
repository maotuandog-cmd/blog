# digoal/blog 20260904 — 国产 PG 系衍生数据库源码剖析笔记

> 来源: digblog/202609/20260904_02.md (openGauss) + 03.md (oGRAC) + 04.md (OpenTeleDB) + 06.md (OpenTenBase)
> 日期: 2026-09-04
> 主题: 4 款 PG 系国产数据库的工程创新对比 — 存储引擎 / 多主 / 原位更新 / 分布式

================================================================
一、四款数据库全景对比
================================================================

来源: 02/03/04/06 各文 §十五 / §十三 / §十 / §十二

| 数据库       | 主源码 LOC    | 核心创新                  | 类型       |
| ------------ | ------------- | ------------------------- | ---------- |
| openGauss    | 496,946       | MOT + NUMA + 并行 redo + db4ai | 单机性能   |
| oGRAC        | 888,357       | 多主强一致 (DRC+DLS+DCS+DTC)   | 多写集中式 |
| OpenTeleDB   | 256,572       | XStore 原位更新 + XProxy 连接池 | contrib 扩展 |
| OpenTenBase  | 177,791 (主)  | CN/DN/GTM 三件套          | 真分布式   |

PG 主干参照: PostgreSQL 17 ~110 万行 LOC
Postgres-XC/XL 演进链: Postgres-XC → TransLattice → Postgres-XL → OpenTenBase (07 年 5 版本)

================================================================
二、openGauss — 单机性能极致
================================================================

来源: 20260904_02.md §三-§七

2.1 5 大模块 LOC 分布 (wc -l 实查)
| 模块          | 文件数 | LOC       | 占比  |
| ------------- | ------ | --------- | ----- |
| access        | 299    | 292,331   | 58.8% |
| mot           | 368    | 137,342   | 27.6% |
| replication   | 50     | 69,404    | 14.0% |
| cstore        | 19     | 25,895    | 5.2%  |
| lmgr          | 9      | 18,232    | 3.7%  |

关键洞见: access+mot 占 86.4% 代码量, openGauss 的功夫主要在存储引擎
SQL 引擎是 PG 继承的现成代码

2.2 MOT (Memory Optimized Table) 内存优化表
路径: src/gausskernel/storage/mot/
  core/        核心数据结构
  fdw_adapter/ Foreign Data Wrapper (与 PG heap 表互通)
  jit_exec/    LLVM JIT 编译器

JIT 系统 7 个核心文件:
| 文件                       | LOC   | 职责                  |
| -------------------------- | ----- | --------------------- |
| jit_llvm_sp.cpp            | 5,564 | LLVM IR + JIT 编译 (全 openGauss 最大单文件) |
| jit_helpers.cpp            | 4,258 | JIT 辅助函数          |
| jit_context.cpp            | 3,775 | 编译上下文管理        |
| jit_llvm_query_codegen.cpp | 2,637 | 查询代码生成          |
| jit_source.cpp             | 2,393 | IR 源码管理           |
| mot_fdw.cpp                | 2,382 | MOT ↔ heap 桥接       |
| jit_exec.cpp               | 2,293 | JIT 执行入口          |

MOT 表性能来源:
- 全部数据在内存
- NUMA 感知执行
- 算法消除闩锁争用
- 查询 LLVM JIT 编译 (CPU 指令减少 5-10 倍)
- 实测: 350 万 tpmC, 比 PG heap 表快 3-5 倍

2.3 双存储引擎 (mot_fdw.cpp)
- MOT 表 + heap 表可在同一事务读写
- 跨引擎 JOIN 透明: SELECT * FROM orders_legacy o JOIN orders_hot h ON o.id=h.id
- 但 MOT 表不写 WAL, 崩溃恢复靠 checkpoint

2.4 NUMA 优化 (核心代码)
src/gausskernel/storage/access/transam/xlog.cpp:6790-6806
    #ifdef __USE_NUMA
        for (int i = 0; i < g_instance.shmem_cxt.numaNodeNum; i++) {
            char *pInsertLock = (char *)numa_alloc_onnode(allocSize, i);
            add_numa_alloc_info(pInsertLock, allocSize);
        }
    #endif

机制:
- 每 NUMA node 一份独立 XLogInsertLock (原来 PG 全局 1 个)
- 32 核 / 4 NUMA node: 锁争抢率 32 → 8 (降 4 倍)
- 配套: multi_redo_settings.cpp:188 redo CPU 绑 NUMA node

退化: 单 NUMA node 时 numa_alloc_onnode 自动 fallback 到 malloc (不会变慢)

2.5 并行 redo (RTO < 10s 来源)
PG 传统: 单线程 redo, 备机滞后主机, 切换分钟级
openGauss: WAL 落盘同时分发给多 worker (按"日志类型 + 操作页"哈希分配)
- 备机实时跟上主机 → 切换几乎 0 追日志 → RTO < 10s
- 网络抖动时 CheckRedoBindConfigValid 降级为单线程 (保正确性)

2.6 dbmind AI 运维
src/gausskernel/dbmind/
  db4ai/      (pca.cpp / kmeans.cpp / xgboost.cpp — 原生 ML 算法)
  deepsql/    (AI SQL 扩展)
  gs_dbmind/  (智能诊断)
  kernel/     (AI 与内核交互)

训练模型存在系统表 gs_model_warehouse — 不是黑盒 AI, 是数据库对象
SQL 调用: gs_train_model / gs_predict — AI 集成在 SQL 里, 不外挂工具

2.7 关键源码定位
- xlog.cpp:6794 numa_alloc_onnode (NUMA-aware XLogInsertLock)
- jit_llvm_sp.cpp:5564 行 (MOT JIT)
- multi_redo_settings.cpp:188 (并行 redo NUMA 绑定)
- db4ai/executor/algorithms/pca.cpp + kmeans.cpp + xgboost.cpp

================================================================
三、oGRAC — 多主强一致 (开源 RAC 等价)
================================================================

来源: 20260904_03.md §二-§四

3.1 真实规模
- pkg/src 88.8 万行 C/C++ (比 PG16 ~110 万略小, 比 openGauss 170 万小一半)
- 27,649 个函数 (codegraph 索引)

3.2 DTC + DLS + DCS + DRC 四件套
所有多主代码集中在 pkg/src/cluster/:

| 文件              | 行数   | 职责                                |
| ----------------- | ------ | ----------------------------------- |
| dtc_database.c    | 418    | 多主数据库初始化 (每节点 undo/logfile) |
| dtc_session.c     | 173    | 多主 session 管理                   |
| dtc_recovery.c    | 10,217 | 多主崩溃恢复 (整个项目最大文件)     |
| dtc_dc.c          | 1,403  | Distributed Cache — 远程 page 缓存  |
| dtc_dcs.c         | 3,464  | Distributed Consensus Service       |
| dtc_dls.c         | 2,109  | Distributed Lock Service            |

3.3 DRC (Distributed Row Cache) — 远程 page 在本地缓存
类比 Oracle RAC cache fusion
锁模式 (dtc_drc.h:50):
  typedef enum en_drc_lock_mode {
    DRC_LOCK_NULL = 0,        // 锁无效
    DRC_LOCK_SHARE = 1,       // 共享锁 (读)
    DRC_LOCK_EXCLUSIVE = 2,   // 排他锁 (写)
    DRC_LOCK_MODE_MAX = 3,
  } drc_lock_mode_e;

3 种锁 + Page Latch 兼容矩阵 (dcs_page_latch_usable) 是核心:
- 本地 page 已有 X → 远程请求 X 可, 但必须等本地释放
- 本地 page 已有 S → 远程请求 X 必须先升级到 X

3.4 DLS (Distributed Lock Service) — 行锁跨节点
真实代码 dtc_dls.c:
  static status_t dls_request_msg(knl_session_t *session, drid_t *id,
                                  uint8 dst_inst, uint32 cmd, ...) {
    msg_lock_req_t lock_req;
    mes_init_send_head(&lock_req.head, cmd, sizeof(msg_lock_req_t),
                       OG_INVALID_ID32, src_inst, dst_inst, session->id, ...);
  }

多主写入流程:
1. 节点 A 收 INSERT, 把行所在 page 的行锁请求通过 MES 发到 page owner 节点
2. Owner 节点把 X 锁授予 A
3. A 修改本地 page buffer, 通过 MES 同步给 owner
4. Owner 刷盘 + redo

3.5 DCS (Distributed Consensus Service) — 多节点对提交达成一致
- 实际是 Paxos/Raft 类算法
- 代码里看到 pcr_heap_undo.c / pcr_heap_scan.c (PCR = Paxos Consensus Recovery)
- Prepare / Promise / Commit 三阶段

3.6 oGRAC 是 openGauss 衍生项目 (代码证据)
dtc_drc.h:48:
  #define DRC_IN_REFORMER_MODE_RELEASE_VERSION {24, 6, 0, 4}
- oGRAC 当前开源版本 0.6.0
- 版本号 + 基于 openGauss → 衍生关系确认

3.7 性能代价
- 多主 INSERT 延迟 ~5-20ms, 单机 PG INSERT ~0.5ms (10-40 倍)
- 多主 = 延迟换应用透明
- 类比 Oracle RAC (RAC 写延迟也比单机高 10 倍)

================================================================
四、OpenTeleDB — XStore contrib 原位更新
================================================================

来源: 20260904_04.md §三-§五

4.1 三模块验证 (代码实查)
| 模块  | 路径                  | LOC      | 验证                          |
| ----- | --------------------- | -------- | ----------------------------- |
| XStore | contrib/xstore/      | 54,712   | ✅ 真实存在, contrib 扩展    |
| XProxy | contrib/xproxy/sources/ | 70,997 | ✅ 独立 C 实现, epoll 架构  |
| XRaft | -                    | -        | ❌ 代码里没找到 (gap 诚实记录) |

XStore 子模块:
  xheap/   23,333 LOC  原位更新堆表引擎
  xbtree/  16,055 LOC  原位更新 BTree 索引
  undo/     8,242 LOC  Undo 日志体系

4.2 PG 原生 UPDATE 问题
1. 产生 dead tuple (新版本追加, 旧版本 t_xmax 标记)
2. 写两份 heap page
3. 写两份 index page
→ 表膨胀, vacuum 必须扫表 → 性能抖动 40%+

4.3 XStore 原位更新 (xheapam.c:1140 真实代码)
  exec_evaluate_inplace_update(Relation relation, ...,
                              bool *inplace_update) {
    bool use_inplace_update = true;  // 默认走原位更新
    ExecQual...   // 评估 WHERE
  }

XStore inplace update 流程:
1. 找到目标 tuple (用 RowPtr 直接定位)
2. 把旧版本整行复制到 Undo 日志 (不留在 page 里)
3. 在原位更新列
4. 更新索引 (索引也是原位更新)
5. 提交后, 旧版本只在 Undo 日志里, 不在 heap page 里

4.4 Undo 体系 (undo/ 8,242 LOC)
  undolog.c       3,636 行  Undo 日志入口
  undobuffer.c    Undo 缓冲区管理
  undorecord.c    Undo 记录格式
  undofile.c      Undo 文件 I/O
  undoxlog.c      Undo WAL 集成
  undofetch.c     Undo 历史版本读取 (回滚/老快照)
  undotxn.c       Undo 事务管理
  undoworker.c    Undo 后台 worker (回收过期 Undo)
  undodesc.c      Undo 描述符

关键洞见:
- Heap page 只有最新版本 — 不积累 dead tuple
- Undo 文件是"时间机器" — 任意时间点版本都能从 Undo 找回来
- 不需要 vacuum 回收 heap — 只需 Undo worker 清理过期 Undo

undolog.c 头部: "Portions Copyright 2020 Huawei Technologies Co.,Ltd"
→ 借鉴了 openGauss zheap 思想

4.5 BTree 索引原位更新 (xbtvisibility.c:268)
注释: "if it was an inplace update, we just need to check undo..."
- 索引 tuple 标记走原位更新 (改 key, 不 delete + insert)
- 索引 tuple 跟 Undo 日志挂钩 — 老快照能看到老索引
- 不需要 vacuum 扫表回收索引 dead tuple

4.6 与 zheap 关系
- zheap (2017 openGauss / 2019 PG 提案): 用 TPD (Tuple Processing Data) 存 undo
- XStore: 独立 Undo 文件体系, 跟 heap page 完全物理分离

4.7 索引原位更新代价
- 好处: 不需要 vacuum 扫表回收索引 dead tuple
- 代价: 索引 leaf page 碎片化 (xbtrecycle.c 后台渐进式整理)
- DBA 实操: 跑久了要定期 REINDEX CONCURRENTLY

================================================================
五、OpenTenBase — 真分布式 (CN/DN/GTM)
================================================================

来源: 20260904_06.md §一-§七

5.1 演进链 (07 年 5 大版本)
Postgres-XC → TransLattice → Postgres-XL → OpenTenBase
v2.2 → v2.4 → v2.5 → v2.6.0 (当前最新)

5.2 三大组件
| 组件 | 全称                  | 职责                          |
| ---- | --------------------- | ----------------------------- |
| CN   | Coordinator Node      | 解析 + 分布式规划 + 跨 DN 聚合 |
| DN   | DataNode              | 实际数据存储 + 实际执行       |
| GTM  | Global Transaction    | 全局事务号 + 全局快照 + 全局序列号 |

5.3 GTM (src/gtm/ 76,237 LOC, 占主源码 42%)
GTM 主文件:
  gtm_store.c     5,508 行  GTM 存储
  gtm_xlog.c      4,477 行  GTM WAL (独立于 PG WAL)
  gtm_txn.c       4,028 行  全局事务管理
  gtm_client.c    4,507 行  GTM 客户端
  gtm_seq.c       3,761 行  全局序列号
  gtm_opt_handler.c 3,571 行 通用处理
  proxy/          4,198 行  GTM Proxy (性能优化层)

GTM 干的事:
- 全局事务号分配 (全局唯一 64-bit GXID)
- 全局快照管理 (全集群 MVCC 一致性)
- 全局序列号 (跨 DN 的 nextval 一致)
- GTM 自己的 WAL (持久化, 崩了能恢复)

5.4 backend 调 GTM (src/backend/access/transam/gtm.c:2379)
  GetSnapshotGTM(GlobalTransactionId gxid, bool canbe_grouped) {
    ShowUsageCommon("GetSnapshotGTM", &start_r, &start_t);
    // 通过 libpq 协议从 GTM 拿全局快照
  }

重连机制:
  int reconnect_gtm_retry_times = 3;       // 3 次
  int reconnect_gtm_retry_interval = 500;  // 间隔 500ms
  // 失败 → SQL 报错 (GTM 挂了 = 所有 DML 不能提交, 只读可)

5.5 GTM Proxy (src/gtm/proxy/ 4,198 行)
- 缓存 GTM 响应 (快照/序列号)
- 本地代理 CN/DN 的 GTM 请求
- 减少 GTM Master 负载
- 与 oGRAC DCS 区别: DCS 是强一致共识 (Paxos/Raft), GTM Proxy 是性能优化层

5.6 5 大 contrib
| contrib                            | LOC      | 用途              |
| ---------------------------------- | -------- | ----------------- |
| opentenbase_ora_package_function   | 49,475   | Oracle 兼容包 (占 contrib 1/3) |
| pgxc_ctl                           | 15,354   | 老版集群管理      |
| opentenbase_ctl                    | 6,325    | 新版集群管理 (K8s)|
| pgvector                           | 11,912   | AI 向量数据库     |
| postgres_fdw                       | 10,950   | 外部数据源        |

5.7 Oracle 兼容包细节 (49,475 行)
  dbms_random    Oracle DBMS_RANDOM
  dbms_assert    Oracle DBMS_ASSERT
  dbms_lob       Oracle DBMS_LOB (大对象)
  dbms_pipe      Oracle DBMS_PIPE
  dbms_md_backup Oracle 备份管理
  nvarchar2      Oracle NVARCHAR2 类型
  varchar2       Oracle VARCHAR2 类型
  opentenbase_ora_raw Oracle RAW 类型
- 29 个升级 SQL 文件 (--3.19--3.20.sql 到 --3.26--3.27.sql)
- 持续维护 5+ 年

5.8 v2.6.0 新创新
1. PostGIS 空间数据库支持
2. KubeBlock Kubernetes 部署
3. Grafana/Prometheus 监控
核心转变: 从"能跑"到"易运维"

5.9 全局事务号 = 64-bit GXID (无 wraparound)
- PG 原生 32-bit XID 会 wraparound
- OpenTenBase GTM 直接给 64-bit GXID
- 理论上限 2^64 = 1844 京个事务

5.10 GTM 单点风险
- GTM 挂了 = 所有 DML 不能提交 (只读查询可以)
- 生产建议: GTM Master + GTM Standby (v2.6.0 自动 failover)

================================================================
六、PG 系国产数据库生态定位 (2026)
================================================================

来源: 02/03/04/06 各文末生态对比表

| 数据库       | 多主支持 | 实现方式                  | 适用场景                |
| ------------ | -------- | ------------------------- | ----------------------- |
| openGauss    | 否       | NUMA + MOT 单机极致       | 高并发 OLTP 单机        |
| oGRAC        | 是       | DTC+DRC+DCS+DLS (Paxos/Raft) | RAC 等价, 应用透明多写 |
| OpenTeleDB   | 否       | XStore 原位更新 (contrib) | 高频 UPDATE, 真空抖动敏感 |
| OpenTenBase  | 否       | CN/DN/GTM 分布式          | 大数据量分布式          |
| OceanBase    | 是 (早期)| 改良 Paxos                | 分布式 + 多主           |
| TiDB         | 是 (早期)| Raft                      | 分布式 HTAP             |
| GaussDB      | 是       | 集中式 + 多副本           | 华为云                  |
| PolarDB      | 否       | 主从 + 读写分离           | 阿里云                  |
| KingbaseES   | 否       | 主从 (8.x 才有逻辑复制)   | Oracle 兼容 + 国产化    |
| MySQL InnoDB | 部分     | Group Replication         | MySQL 系多主            |

================================================================
七、关键源码路径速查 (供后续深读用)
================================================================

openGauss:
  src/gausskernel/storage/mot/jit_exec/jit_llvm_sp.cpp   (5,564 行 MOT JIT)
  src/gausskernel/storage/access/transam/xlog.cpp:6794  (NUMA XLogInsertLock)
  src/gausskernel/storage/access/transam/multi_redo_settings.cpp:188 (并行 redo)
  src/gausskernel/dbmind/db4ai/executor/algorithms/     (pca/kmeans/xgboost)

oGRAC:
  pkg/src/cluster/dtc_recovery.c   (10,217 行, 多主恢复)
  pkg/src/cluster/dtc_dcs.c        (3,464 行, 分布式共识)
  pkg/src/cluster/dtc_dls.c        (2,109 行, 分布式锁)
  pkg/src/cluster/dtc_drc.h:50     (DRC 锁定义)

OpenTeleDB:
  contrib/xstore/src/xheap/xheapam.c         (原位更新核心)
  contrib/xstore/src/xbtree/xbtvisibility.c:268  (索引原位更新)
  contrib/xstore/src/undo/undolog.c          (Undo 体系入口)
  contrib/xproxy/sources/frontend.c          (XProxy 前端)

OpenTenBase:
  src/gtm/main/gtm_store.c          (5,508 行, GTM 存储)
  src/gtm/main/gtm_xlog.c           (4,477 行, GTM WAL)
  src/gtm/main/gtm_txn.c            (4,028 行, 全局事务)
  src/backend/access/transam/gtm.c:2379  (backend 调 GTM)
  contrib/opentenbase_ora_package_function/   (49,475 行 Oracle 兼容)
  contrib/pgvector/                  (11,912 行向量数据库)

================================================================
八、给生产选型的诚实问题 (来自 digoal)
================================================================

共同 4 问:
1. 你真的需要 [MOT/多主/原位更新/分布式] 吗?
   - 单机 PG 8TB / 数十万 QPS 很多场景够用
   - 别为了技术而技术

2. 你能承受 [学习曲线/延迟/碎片/复杂度] 吗?
   - MOT: OOM 风险, 冷热数据切分新课题
   - 多主: 10-40 倍延迟
   - XStore: 索引碎片化, 定期 REINDEX CONCURRENTLY
   - 分布式: 运维复杂度 3-5 倍单机 PG

3. 你的团队能维护吗?
   - 死锁检测 / 网络分区 / GTM 故障预案写过吗?

4. 兼容性差异你接受吗?
   - 各 fork 都有兼容性 gap, 部分 PG 扩展 (pg_stat_statements 某些钩子, pg_repack) 可能不直接兼容
   - 老应用先跑一遍 DDL 验证

================================================================
九、引用源
================================================================

- digoal 20260904_02.md 《openGauss 源码深度剖析: 从一行 INSERT 看国产顶级数据库的内核细节》
- digoal 20260904_03.md 《oGRAC 项目深度剖析: 华为这个开源多主关系数据库是怎么炼成的?》
- digoal 20260904_04.md 《OpenTeleDB 源码深度剖析: 从一行 UPDATE 看天翼云怎么给 PostgreSQL 装上原地更新引擎》
- digoal 20260904_06.md 《OpenTenBase 源码深度剖析: 从一行 SQL 看腾讯系分布式数据库的 3 大组件协作》

仓库:
  openGauss-server  https://gitee.com/opengauss/openGauss-server
  oGRAC             https://gitcode.com/opengauss/oGRAC
  OpenTeleDB        https://gitee.com/opengauss/OpenTeleDB
  OpenTenBase       https://github.com/OpenTenBase/OpenTenBase
