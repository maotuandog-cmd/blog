# 【存储工程】数据均衡与在线迁移

来源: https://quant67.com/post/storage/55-data-balancing/data-balancing.html
日期: 2025-10-03 |

---

分布式存储系统的容量和负载不会永远停在初始状态。节点扩容、节点下线、磁盘更换、热点倾斜——这些事件都要求系统把数据从一组节点搬到另一组节点。数据均衡（Data
            Balancing）就是解决”数据放在哪里”和”怎么搬过去”的工程问题。
            

表面上看，均衡只是把数据块从利用率高的节点搬到利用率低的节点。但一旦进入生产环境，问题就变了：搬迁过程中前台读写不能中断，搬迁带宽不能把业务网络打满，搬迁的优先级要能控制，搬迁过程要可监控、可回滚。
            

本文从工程挑战出发，拆解数据均衡的算法基础、扩容缩容场景的迁移策略、TiKV
            的在线重分片、Ceph 的 PG
            自动均衡，然后深入迁移限速、服务影响评估和监控验证。讨论的软件版本：Ceph
            18.x（Reef）、TiKV 7.x、CockroachDB
            23.x。不同版本的行为和默认参数可能有差异。
            
            

## 一、数据均衡的工程挑战

            

### 1.1
            为什么均衡不是简单的搬运

            

一个理想化的数据均衡器只需要做三件事：计算每个节点的目标数据量、找出需要搬的数据块、把它们搬过去。但生产环境中，这三步每一步都有约束。
            

第一，计算目标状态不是静态的。新节点加入时集群拓扑变化，均衡器计算出的目标分布还没执行完，又有新的节点加入或故障发生。均衡器必须能处理”边搬边变”的情况。
            

第二，搬迁不能影响在线服务。前台读写请求的延迟（Latency）和吞吐（IOPS）有
            SLA 约束。如果均衡器不做限速，大量数据搬迁会抢占磁盘 I/O
            和网络带宽，导致前台请求超时。
            

第三，数据搬迁必须保证一致性。搬迁过程中，同一份数据可能同时存在于源节点和目标节点。读请求应该读到哪一份？写请求应该写到哪一份？如果搬迁中途失败，数据的副本数是否会暂时低于预期？
            

### 1.2 均衡触发的典型场景

            

数据均衡不是一个持续运行的后台任务（虽然有些系统确实这么设计），而是由特定事件触发的：
            
            
            
            
            
            
            
            
            触发事件
            均衡目标
            紧迫程度
            
            
            
            
            新节点加入（扩容）
            将部分数据从旧节点迁移到新节点
            中等，新节点空闲但不影响可用性
            
            
            节点计划下线（缩容）
            将该节点的所有数据迁移到其他节点
            高，下线前必须完成
            
            
            节点故障
            从存活副本重建丢失数据到其他节点
            紧急，副本数已经降低
            
            
            磁盘更换
            将旧磁盘数据迁移到新磁盘
            中等
            
            
            热点倾斜
            将热点数据分散到更多节点
            低，但长期不处理会影响性能
            
            
            副本策略变更
            增加或减少副本数
            低
            
            
            
            

不同触发场景对均衡器的要求不同。节点故障触发的数据重建需要尽快完成以恢复冗余度；扩容触发的迁移则可以慢慢做，但最终要达到均匀分布。
            

### 1.3 均衡的度量指标

            

怎么判断一个集群是否”均衡”？工程中常用以下指标：
            

**容量均衡度**：各节点已用容量占比的标准差。标准差越小，容量分布越均匀。
            
```
假设 4 个节点的容量使用率分别为: 82%, 78%, 85%, 55%

均值 μ = (82 + 78 + 85 + 55) / 4 = 75%
标准差 σ = sqrt(((82-75)² + (78-75)² + (85-75)² + (55-75)²) / 4)
         = sqrt((49 + 9 + 100 + 400) / 4)
         = sqrt(139.5)
         ≈ 11.8%

均衡后目标: 75%, 75%, 75%, 75%  (σ = 0)
```

            

**负载均衡度**：各节点 IOPS
            或带宽的标准差。容量均衡不等于负载均衡——一个节点可能数据量不大但全是热点数据。
            

**分片均衡度**：各节点承载的分片（Shard）或
            PG 数量的标准差。这是 Ceph 和 TiKV
            等系统更常用的指标，因为调度的基本单位是分片而不是字节。
            
            

## 二、数据均衡算法

            

### 2.1 最小数据移动原则

            

数据均衡的核心目标之一是最小化数据移动量（Minimal Data
            Movement）。每搬一个数据块，都要消耗网络带宽、磁盘 I/O 和
            CPU 资源。搬得越少，对在线服务的影响越小。
            

一致性哈希（Consistent
            Hashing）是实现最小数据移动的经典算法。当节点数从 N 变为 N+1
            时，理想情况下只有 1/(N+1)
            的数据需要迁移。对比简单取模哈希（key %
            N），节点数变化时几乎所有数据都要重新分布。
            
```
简单取模 vs 一致性哈希: 数据迁移量对比

假设 100 个数据块，从 4 节点扩到 5 节点:

取模哈希 (key % N):
  扩容前: key % 4 → 节点分布 [25, 25, 25, 25]
  扩容后: key % 5 → 约 80% 的 key 映射到不同节点
  迁移量: ~80 个块

一致性哈希:
  扩容前: 4 节点均分哈希环
  扩容后: 新节点接管相邻节点的部分范围
  迁移量: ~20 个块 (1/5 = 20%)
```

            

但一致性哈希的”均匀性”依赖虚拟节点（Virtual
            Node）的数量。虚拟节点太少，节点之间的负载差异可能很大；虚拟节点太多，路由表的内存开销和查找时间增加。
            

### 2.2 CRUSH 算法的均衡策略

            

Ceph 使用 CRUSH（Controlled Replication Under Scalable
            Hashing）算法来决定数据放置。CRUSH
            是一种伪随机算法：给定对象名和集群拓扑，CRUSH
            确定性地计算出对象应该存放在哪些 OSD（Object Storage
            Daemon）上，不需要查询中心化的元数据表。
            

CRUSH 的均衡性取决于权重（Weight）的分配。每个 OSD
            的权重通常按其磁盘容量设置（例如 4 TB 磁盘权重为 4.0，8 TB
            磁盘权重为 8.0）。CRUSH
            在计算放置时，会按权重比例分配数据。
            
```
CRUSH 权重与数据分布示例:

OSD.0: weight = 4.0 (4 TB)  → 期望承载 4/20 = 20% 的数据
OSD.1: weight = 4.0 (4 TB)  → 期望承载 4/20 = 20% 的数据
OSD.2: weight = 4.0 (4 TB)  → 期望承载 4/20 = 20% 的数据
OSD.3: weight = 8.0 (8 TB)  → 期望承载 8/20 = 40% 的数据
总权重: 20.0

实际分布可能有偏差（CRUSH 是伪随机的），需要通过 PG 数量和 upmap 来修正。
```

            

CRUSH 在扩容时的数据移动量取决于新 OSD
            的权重占总权重的比例。加入一个权重为 4.0 的 OSD 到总权重
            20.0 的集群，理论上需要迁移 4/24 ≈ 16.7% 的数据。
            

### 2.3 Range-Based
            分片的均衡

            

TiKV 和 CockroachDB 使用基于范围的分片（Range-Based
            Sharding）。每个分片（TiKV 称为 Region，CockroachDB 称为
            Range）覆盖一段连续的键空间。均衡的基本操作是将 Region
            从一个节点搬到另一个节点。
            

Range-Based
            分片的均衡策略通常包含以下规则，按优先级排列：
            
            
- **副本约束**：确保每个 Region
            的副本分布满足放置规则（例如不同机架）。
            
- **Leader 均衡**：各节点的 Leader Region
            数量尽可能均匀，因为 Leader 承担读写请求。
            
- **容量均衡**：各节点的存储使用量尽可能均匀。
            
- **热点打散**：将读写热点 Region
            分散到不同节点。
            
            

TiKV 的调度器 PD（Placement Driver）周期性地检查各个
            Store（存储节点）的状态，根据上述规则生成调度操作（Operator）。每个
            Operator 描述一个具体的 Region 迁移动作：
            
```
PD 调度决策流程:

1. 收集信息
   Store 1: region_count=1200, leader_count=450, used_size=800GB, capacity=1TB
   Store 2: region_count=800,  leader_count=250, used_size=500GB, capacity=1TB
   Store 3: region_count=1000, leader_count=300, used_size=650GB, capacity=1TB

2. 检测不均衡
   Region 数量标准差: 163.3
   Leader 数量标准差: 82.5
   容量使用率标准差: 12.3%

3. 生成 Operator
   - move-region: Region 42 从 Store 1 → Store 2
   - transfer-leader: Region 108 的 Leader 从 Store 1 → Store 3
   - ...

4. 执行 Operator（限速控制）
   并发 Operator 数量上限: 64
   Store 并发 Operator 数量上限: 2 (默认)
```

            

### 2.4 均衡算法的比较

            
            
            
            
            
            
            
            
            
            特性
            一致性哈希
            CRUSH
            Range-Based
            
            
            
            
            代表系统
            Dynamo、Cassandra
            Ceph
            TiKV、CockroachDB
            
            
            分片类型
            哈希分片
            哈希分片
            范围分片
            
            
            元数据依赖
            轻量路由表
            无中心元数据
            中心化元数据（PD）
            
            
            扩容迁移量
            约 1/(N+1)
            约 W_new/W_total
            按 Region 粒度调度
            
            
            均匀性保障
            依赖虚拟节点数
            依赖 PG 数和权重
            依赖调度器策略
            
            
            热点处理
            需额外机制
            需额外机制
            调度器内置支持
            
            
            拓扑感知
            有限
            原生支持（CRUSH Rule）
            原生支持（Placement Rule）
            
            
            分片分裂/合并
            不支持
            不适用（PG 数固定后很少变）
            原生支持
            
            
            
            
            

## 三、扩容场景的数据迁移

            

### 3.1 扩容的基本流程

            

无论哪种分布式存储系统，扩容的基本流程都是：加入新节点、重新计算数据分布、将部分数据从旧节点迁移到新节点。区别在于”重新计算”和”迁移”的具体实现。
            

以 Ceph 为例，扩容流程如下：
            
```
# 1. 准备新节点，安装 ceph 软件
# 2. 将新 OSD 加入集群
ceph orch daemon add osd :/dev/sdb

# 3. CRUSH 自动更新拓扑，PG 开始重新映射
# 4. 观察数据迁移进度
ceph -s
# 输出示例（经删减）:
#   health: HEALTH_WARN
#          Degraded data redundancy: 1234/100000 objects degraded
#   services:
#     osd: 13 osds: 13 up, 13 in; 156 remapped pgs
#   io:
#     recovery: 1.2 GiB/s, 312 objects/s

# 5. 等待所有 PG 回到 active+clean 状态
ceph -w  # 持续观察
```

            

加入新 OSD 后，CRUSH 重新计算所有 PG（Placement
            Group）的映射。部分 PG 的目标 OSD 集合发生变化，这些 PG 进入
            remapped 状态，开始数据迁移。迁移完成后 PG 回到 active+clean
            状态。
            

### 3.2
            扩容时的数据移动量估算

            

扩容时需要移动多少数据？以 CRUSH 为例，新 OSD
            的权重占总权重的比例决定了理论迁移量。
            
```
扩容数据移动量估算:

扩容前:
  12 个 OSD，每个权重 4.0，总权重 48.0
  总数据量: 48 TB（每 OSD 约 4 TB）
  PG 总数: 1024

加入 1 个新 OSD (权重 4.0):
  新总权重: 52.0
  新 OSD 期望承载: 4.0/52.0 ≈ 7.7% 的数据 ≈ 3.7 TB
  理论迁移量: 3.7 TB（从其他 12 个 OSD 各迁出约 0.3 TB）
  受影响的 PG 数: 约 1024 * 7.7% ≈ 79 个 PG

加入 4 个新 OSD (各权重 4.0):
  新总权重: 64.0
  新 OSD 期望承载: 16.0/64.0 = 25% 的数据
  理论迁移量: 12 TB
  受影响的 PG 数: 约 256 个 PG
```

            

实际迁移量可能与理论值有偏差，原因包括：CRUSH
            的伪随机性导致 PG
            分布不完全均匀、权重调整策略（可以逐步调高权重而非一次性设满）、以及
            PG 数量不够大导致的量化误差。
            

### 3.3 逐步权重调整（Weight
            Ramping）

            

一次性将新 OSD 的权重设为满值会导致大量 PG
            同时迁移，网络和磁盘 I/O
            被打满。工程中常用逐步调整权重（Weight
            Ramping）来平滑迁移过程。
            
```
# Ceph OSD 逐步调整权重示例

# 新加入的 OSD.12，磁盘容量 4TB，初始权重为 0
# 目标权重: 4.0

# 第一步: 设置权重为 1.0 (25% 容量)
ceph osd crush reweight osd.12 1.0
# 等待迁移完成
while ! ceph health | grep -q HEALTH_OK; do sleep 60; done

# 第二步: 设置权重为 2.0 (50% 容量)
ceph osd crush reweight osd.12 2.0
while ! ceph health | grep -q HEALTH_OK; do sleep 60; done

# 第三步: 设置权重为 3.0 (75% 容量)
ceph osd crush reweight osd.12 3.0
while ! ceph health | grep -q HEALTH_OK; do sleep 60; done

# 第四步: 设置权重为 4.0 (100% 容量)
ceph osd crush reweight osd.12 4.0
while ! ceph health | grep -q HEALTH_OK; do sleep 60; done
```

            

Ceph 的 `ceph-mgr` 模块 `balancer`
            也支持自动化的权重调整。设置
            `osd_crush_initial_weight` 可以控制新 OSD
            加入时的初始权重。
            

### 3.4 扩容期间的读写路由

            

扩容期间，部分 PG 正在从旧 OSD 迁移到新
            OSD。这段时间内，读写请求的路由需要特别处理：
            
            
- **写请求**：Ceph 在 PG
            迁移期间，写请求同时写入旧 OSD 和新 OSD（即 acting set 和 up
            set 都接收写入），确保迁移完成后新 OSD 的数据是最新的。
            
- **读请求**：读请求由 Primary OSD 处理。如果
            Primary 发生变化（从旧 OSD 变为新 OSD），在新 OSD
            完成数据同步之前，读请求仍由旧 Primary 处理。
            
            
```
PG 迁移期间的读写路由 (Ceph):

迁移前: PG 1.2a  acting=[OSD.1, OSD.3, OSD.5]  up=[OSD.1, OSD.3, OSD.5]
迁移中: PG 1.2a  acting=[OSD.1, OSD.3, OSD.5]  up=[OSD.1, OSD.3, OSD.12]
  ├── 读请求 → OSD.1 (Primary，不变)
  ├── 写请求 → OSD.1, OSD.3, OSD.5 + OSD.12 (同时写入新旧)
  └── OSD.12 从 OSD.5 拉取历史数据 (backfill)
迁移后: PG 1.2a  acting=[OSD.1, OSD.3, OSD.12]  up=[OSD.1, OSD.3, OSD.12]
  ├── 读请求 → OSD.1 (Primary)
  └── 写请求 → OSD.1, OSD.3, OSD.12
```

            

TiKV 的扩容迁移使用 Raft 协议的 AddLearner →
            PromoteLearner → RemovePeer 流程。新节点先作为 Learner 复制
            Region 的 Raft 日志，数据追齐后提升为
            Voter，旧节点的副本被移除。整个过程中 Leader
            不变，读写不中断。
            
            

## 四、缩容场景的数据排空

            

### 4.1 计划下线与数据排空

            

缩容（Decommission）是扩容的逆过程：将一个节点标记为即将下线，把该节点上的所有数据迁移到其他节点，确认数据完全排空后再物理移除节点。
            

与扩容不同，缩容有一个硬约束：数据排空完成之前节点不能下线，否则会丢失数据或降低副本数。
            

### 4.2 Ceph 的缩容流程

            
```
# Ceph 节点缩容流程

# 1. 将 OSD 标记为 out（不再接收新数据）
ceph osd out osd.5

# CRUSH 重新计算，OSD.5 上的 PG 开始迁移到其他 OSD
# 2. 观察迁移进度
ceph osd df tree | grep osd.5
# 输出示例:
#  5  ssd  3.63689  2.10000  1.43000  68.10  0.95  100   osd.5

# 3. 等待 OSD.5 上的 PG 全部迁走
while ceph pg ls-by-osd osd.5 | grep -c 'active'; do
    echo "PGs remaining on OSD.5: $(ceph pg ls-by-osd osd.5 | grep -c 'active')"
    sleep 60
done

# 4. 确认 OSD.5 上没有数据后，停止 OSD 进程
sudo systemctl stop ceph-osd@5

# 5. 从 CRUSH map 和集群中移除
ceph osd purge 5 --yes-i-really-mean-it

# 6. 清理物理磁盘
ceph-volume lvm zap /dev/sdb --destroy
```

            

`ceph osd out` 会将 OSD 的权重设为 0，触发
            CRUSH 重新计算。所有映射到 OSD.5 的 PG 会被重新分配到其他
            OSD。这个过程称为 backfill（回填）。
            

### 4.3 TiKV 的缩容流程

            

TiKV 通过 PD 的 `store delete`
            命令触发缩容：
            
```
# TiKV 节点缩容

# 1. 查看当前 Store 信息
pd-ctl store
# 输出示例（经删减）:
# {
#   "stores": [
#     {"id": 1, "address": "10.0.1.1:20160", "state_name": "Up",
#      "region_count": 1200, "leader_count": 400},
#     {"id": 4, "address": "10.0.1.4:20160", "state_name": "Up",
#      "region_count": 1100, "leader_count": 380}
#   ]
# }

# 2. 标记 Store 4 为下线状态
pd-ctl store delete 4
# Store 4 状态变为 Offline

# 3. PD 开始调度 Store 4 上的所有 Region 到其他 Store
# 每个 Region 通过 Raft ConfChange 完成副本迁移:
#   Region R1: AddPeer(Store 2) → TransferLeader(Store 2) → RemovePeer(Store 4)
#   Region R2: AddPeer(Store 3) → TransferLeader(Store 3) → RemovePeer(Store 4)
#   ...

# 4. 观察进度
pd-ctl store 4
# region_count 应逐渐减少到 0
# 状态从 Offline 变为 Tombstone 表示排空完成
```

            

PD 在缩容时的调度会考虑目标 Store 的容量和 Region
            分布，避免把所有 Region 都堆到同一个 Store。
            

### 4.4 缩容的容量预检

            

缩容前必须验证剩余节点是否有足够的容量接收被排空节点的数据。如果剩余容量不足，缩容会卡住，数据无法完全迁出。
            
```
缩容容量预检:

当前集群:
  Store 1: used=600GB, capacity=1TB, available=400GB
  Store 2: used=550GB, capacity=1TB, available=450GB
  Store 3: used=700GB, capacity=1TB, available=300GB
  Store 4: used=650GB, capacity=1TB, available=350GB  ← 计划下线

Store 4 需要排空: 650GB
剩余节点可用容量: 400 + 450 + 300 = 1150GB
650GB 
            

## 五、在线重分片

            

### 5.1 为什么需要重分片

            

Range-Based
            分片系统中，每个分片覆盖一段键空间范围。随着数据写入，某些分片可能变得很大（数据量超过阈值），或者某些键范围成为访问热点。重分片（Resharding）通过分裂（Split）和合并（Merge）操作调整分片大小和数量。
            

TiKV 中，每个 Region 的默认大小阈值为 144
            MB（可配置）。当一个 Region 的数据量超过阈值时，TiKV
            自动将其分裂为两个 Region。当相邻的两个 Region
            都很小时，TiKV 可以将它们合并为一个。
            

### 5.2 TiKV Region Split
            的实现

            

Region Split（分裂）是 TiKV
            数据均衡的基础操作。分裂过程在 Raft
            层面实现，保证分裂期间的读写一致性。
            
```
TiKV Region Split 流程:

分裂前:
  Region 1: [key_a, key_z)  Leader=Store 1, Peers=[Store 1, Store 2, Store 3]
  数据量: 280 MB (超过阈值 144 MB)

1. Leader 检测到 Region 大小超过阈值
2. Leader 选择分裂点 (split key)，通常选择 Region 中间位置的 key
   split_key = key_m

3. Leader 提交 Split 命令作为 Raft 日志
   AdminRequest::Split { split_key: key_m, new_region_id: 2 }

4. 所有 Peer 应用 Split 日志:
   - 更新 Region 1 的范围为 [key_a, key_m)
   - 创建 Region 2，范围为 [key_m, key_z)
   - Region 2 的 Peer 列表与 Region 1 相同（同节点，不搬数据）
   - 各自更新 Region epoch

5. PD 更新路由表

分裂后:
  Region 1: [key_a, key_m)  Leader=Store 1  数据量: ~140 MB
  Region 2: [key_m, key_z)  Leader=Store 1  数据量: ~140 MB
```

            

关键点：Split 操作只修改元数据（Region 范围和
            epoch），不搬移数据。数据仍然在同一组节点上，只是逻辑上被分成了两个
            Region。后续 PD 会通过调度操作将 Region 2 的 Leader 或 Peer
            迁移到其他节点以实现负载均衡。
            
```
sequenceDiagram
    participant Leader as Region Leader
(Store 1)
    participant Follower1 as Follower
(Store 2)
    participant Follower2 as Follower
(Store 3)
    participant PD as PD Server

    Leader->>Leader: 检测 Region 大小 > 阈值
    Leader->>Leader: 计算 split_key
    Leader->>Leader: 向 PD 申请新 Region ID
    PD-->>Leader: 返回 new_region_id=2
    Leader->>Follower1: Raft Propose: AdminSplit(split_key, region_id=2)
    Leader->>Follower2: Raft Propose: AdminSplit(split_key, region_id=2)
    Follower1-->>Leader: Raft ACK
    Follower2-->>Leader: Raft ACK
    Leader->>Leader: Raft Commit + Apply Split
    Leader->>Follower1: Raft Commit
    Leader->>Follower2: Raft Commit
    Follower1->>Follower1: Apply Split
    Follower2->>Follower2: Apply Split
    Leader->>PD: 上报 Region 1 和 Region 2 的信息
    PD->>PD: 更新路由表
```

            

### 5.3 TiKV Region Merge
            的实现

            

Region Merge（合并）是 Split 的逆操作，将两个相邻的小
            Region 合并为一个。Merge 比 Split
            复杂得多，因为涉及两个独立的 Raft Group 的协调。
            

TiKV 的 Region Merge 过程：
            
            
- PD 检测到两个相邻的 Region（A 和
            B）都很小（默认阈值：Region 大小 < 20 MB 且 key 数量 <
            200000）。
            
- PD 向 Region A 的 Leader 发送 Merge 调度命令。
            
- Region A 的 Leader 先确保 Region A 和 Region B 的 Peer
            分布一致（如果不一致，先通过 ConfChange 调整）。
            
- Region A 提交 PrepareMerge 日志，Region B 提交
            CommitMerge 日志。
            
- Region B 的数据并入 Region A，Region B 被销毁。
            
            
```
Region Merge 示例:

合并前:
  Region 10: [key_a, key_m)  大小=8MB   Peers=[Store1, Store2, Store3]
  Region 11: [key_m, key_z)  大小=12MB  Peers=[Store1, Store2, Store3]

触发条件: 两个 Region 都小于 20MB，且键范围相邻

合并后:
  Region 10: [key_a, key_z)  大小=20MB  Peers=[Store1, Store2, Store3]
  Region 11: 被销毁
```

            

Merge 操作的风险比 Split 高。如果 Merge 过程中某个 Peer
            出现网络分区，可能导致部分 Peer 已经完成 Merge 而部分 Peer
            尚未完成，需要通过 Raft 的日志重放来保证一致性。TiKV 的
            Merge 实现中有详细的异常处理逻辑来应对这些情况。
            

### 5.4 CockroachDB 的
            Range 分裂与合并

            

CockroachDB 的 Range 分裂机制与 TiKV
            类似但有一些差异：
            
            
- **分裂阈值**：默认 512 MB（TiKV 为 144
            MB），可通过 `CONFIGURE ZONE` 调整。
            
- **分裂点选择**：CockroachDB
            不仅按大小分裂，还支持按负载分裂（Load-Based
            Splitting）。当某个 Range 的 QPS
            超过阈值时，即使大小未超限也会分裂。
            
- **合并策略**：CockroachDB 在 Range
            的大小低于阈值且 QPS 较低时自动合并。
            
            
```
-- CockroachDB: 调整 Range 分裂大小
ALTER TABLE orders CONFIGURE ZONE USING range_max_bytes = 134217728;  -- 128 MB
ALTER TABLE orders CONFIGURE ZONE USING range_min_bytes = 16777216;   -- 16 MB

-- 查看 Range 分布
SHOW RANGES FROM TABLE orders;
-- 输出示例:
--   start_key | end_key | range_id | range_size_mb | lease_holder | replicas
--   /1        | /1000   | 42       | 98.3          | 3            | {1,2,3}
--   /1000     | /2000   | 43       | 112.5         | 1            | {1,2,3}
--   /2000     | /3000   | 44       | 87.2          | 2            | {1,2,3}
```

            
            

## 六、Ceph PG 自动均衡

            

### 6.1 PG
            数量与均衡性的关系

            

Ceph 中，PG（Placement
            Group）是数据放置的基本单位。每个对象通过哈希映射到一个
            PG，每个 PG 通过 CRUSH 映射到一组 OSD。PG
            数量直接影响数据分布的均匀性。
            

PG 数量太少，数据分布不均匀。极端情况下，如果只有 1 个
            PG，所有数据都在同一组 OSD 上，其他 OSD 完全空闲。PG
            数量太多，每个 PG 包含的对象很少，PG
            本身的元数据开销变得显著，且 Peering（PG
            状态协商）的开销增大。
            

经验公式：
            
```
PG 数量推荐公式:

Total PGs = (OSD 总数 * 每 OSD 目标 PG 数) / 副本数

其中"每 OSD 目标 PG 数"通常取 100~200。

示例:
  OSD 总数 = 36
  副本数 = 3
  目标每 OSD PG 数 = 100

  Total PGs = (36 * 100) / 3 = 1200
  取最近的 2 的幂: 1024

PG 数量对均匀性的影响:

  PG 数 = 16,  OSD 数 = 12: 每 OSD 平均 4 个 PG，标准差约 1.5  → 不均匀
  PG 数 = 64,  OSD 数 = 12: 每 OSD 平均 16 个 PG，标准差约 3.0 → 中等
  PG 数 = 256, OSD 数 = 12: 每 OSD 平均 64 个 PG，标准差约 6.0 → 较均匀
  PG 数 = 1024,OSD 数 = 12: 每 OSD 平均 256 个 PG，标准差约 12  → 均匀
```

            

### 6.2 pg-autoscaler 模块

            

Ceph Nautilus（14.x）引入的 `pg-autoscaler`
            模块可以自动调整每个 Pool 的 PG 数量。它根据 Pool
            的实际数据量和 OSD 数量，周期性地计算推荐的 PG 数量，并在
            `warn` 或 `on`
            模式下自动执行调整。
            
```
# 启用 pg-autoscaler 模块
ceph mgr module enable pg_autoscaler

# 查看各 Pool 的 PG 自动缩放状态
ceph osd pool autoscale-status
# 输出示例:
# POOL                  SIZE  TARGET SIZE  RATE  RAW CAPACITY  RATIO  TARGET RATIO  EFF. RATIO  BIAS  PG_NUM  NEW PG_NUM  AUTOSCALE  BULK
# rbd_pool              450G                3.0        12.0T   0.11                                1    128         256        on      False
# cephfs_data           1.2T                3.0        12.0T   0.30                                1    256                    on      True
# rgw_buckets           800G                3.0        12.0T   0.20                                1    128         256        on      True

# 为特定 Pool 设置自动缩放模式
ceph osd pool set rbd_pool pg_autoscale_mode on    # 自动调整
ceph osd pool set rbd_pool pg_autoscale_mode warn  # 仅告警
ceph osd pool set rbd_pool pg_autoscale_mode off   # 关闭
```

            

`pg-autoscaler` 的计算逻辑：
            
            
- 根据 Pool 的实际数据量和目标占比（target ratio 或 target
            size）估算该 Pool 应占的 PG 数量。
            
- 考虑所有 Pool 的汇总需求和 OSD 总数。
            
- 如果当前 PG 数量与推荐值偏差较大，生成调整操作。
            
- PG 数量的调整（pg_num 增大或缩小）会触发 PG
            分裂或合并，进而导致数据迁移。
            
            

### 6.3 PG 分裂与合并

            

当 pg_num 增大时，现有 PG 需要分裂（Split）。Ceph 的 PG
            分裂逻辑：
            
```
PG 分裂示例 (pg_num 从 4 增加到 8):

分裂前:
  PG 0 (hash 范围 0x0000~0x3FFF) → OSD [1, 3, 5]
  PG 1 (hash 范围 0x4000~0x7FFF) → OSD [2, 4, 6]
  PG 2 (hash 范围 0x8000~0xBFFF) → OSD [3, 5, 1]
  PG 3 (hash 范围 0xC000~0xFFFF) → OSD [4, 6, 2]

分裂后:
  PG 0 (hash 范围 0x0000~0x1FFF) → OSD [1, 3, 5]  (PG 0 保留前半)
  PG 4 (hash 范围 0x2000~0x3FFF) → OSD [?, ?, ?]  (PG 0 分裂出的新 PG)
  PG 1 (hash 范围 0x4000~0x5FFF) → OSD [2, 4, 6]
  PG 5 (hash 范围 0x6000~0x7FFF) → OSD [?, ?, ?]
  PG 2 (hash 范围 0x8000~0x9FFF) → OSD [3, 5, 1]
  PG 6 (hash 范围 0xA000~0xBFFF) → OSD [?, ?, ?]
  PG 3 (hash 范围 0xC000~0xDFFF) → OSD [4, 6, 2]
  PG 7 (hash 范围 0xE000~0xFFFF) → OSD [?, ?, ?]

新 PG (4, 5, 6, 7) 通过 CRUSH 计算映射到 OSD，可能触发数据迁移。
```

            

pg_num 缩小时，PG 会合并（Merge）。两个相关的 PG
            合并为一个，对象重新归属到合并后的 PG。
            

### 6.4 upmap 均衡

            

即使 PG 数量合理，CRUSH 的伪随机性仍可能导致部分 OSD
            承载的 PG 数量偏多或偏少。upmap 是 Ceph
            Luminous（12.x）引入的精细均衡机制，允许管理员（或自动均衡器）指定个别
            PG 的 OSD 映射，覆盖 CRUSH 的默认计算结果。
            
```
# 查看当前 PG 分布的均匀性
ceph balancer eval
# 输出示例:
# current cluster score 0.012345 (lower is better)

# 使用 upmap 模式的自动均衡器
ceph balancer mode upmap

# 启用自动均衡
ceph balancer on

# 手动生成均衡计划并预览
ceph balancer optimize my_plan
ceph balancer show my_plan
# 输出示例（经删减）:
# Plan my_plan (12 changes):
#   osd.3: pg 1.2a → osd.7
#   osd.5: pg 2.1f → osd.9
#   ...

# 执行均衡计划
ceph balancer execute my_plan
```

            

upmap 的优势在于它可以做到精确的单 PG 调整，而不像
            reweight 那样影响所有 PG。一个 upmap 条目只影响一个 PG
            的映射，因此可以在不影响其他 PG 的情况下修正个别 OSD
            的负载偏差。
            

### 6.5 balancer
            模块的工作原理

            

Ceph 的 `balancer` 模块（ceph-mgr
            插件）支持两种均衡模式：
            
            
            
            
            
            
            
            
            
            模式
            工作方式
            优点
            缺点
            
            
            
            
            crush-compat
            调整 OSD 的 CRUSH reweight
            全局生效，不需要 upmap 支持
            精度有限，可能引起连锁 PG 迁移
            
            
            upmap
            为个别 PG 设置 OSD 映射覆盖
            精确控制，最小化数据移动
            需要客户端支持 upmap（Luminous+）
            
            
            
            

`balancer` 模块的工作流程：
            
            
- 计算当前集群的均衡分数（score），分数越低越均衡。
            
- 生成一组调整操作（plan），使分数降低。
            
- 评估 plan 的效果（预期分数变化）。
            
- 执行 plan 中的操作。
            
- 等待数据迁移完成。
            
- 重复以上步骤。
            
            

`balancer`
            在自动模式（`ceph balancer on`）下会持续运行，每隔一段时间生成并执行均衡计划。可以通过配置参数控制每次执行的最大调整数量和执行间隔。
            
            

## 七、迁移限速与优先级控制

            

### 7.1 为什么需要限速

            

数据迁移和前台业务共享同一套网络和存储资源。不做限速的话，大规模数据迁移会把磁盘
            I/O 带宽和网络带宽打满，导致前台读写延迟急剧上升。
            

以一个典型场景为例：集群有 10 Gbps
            的内部网络，正常业务使用 3 Gbps，剩余 7 Gbps
            看起来可以用于迁移。但迁移产生的大量顺序 I/O 会把磁盘的随机
            I/O 能力挤掉——一块 HDD 在做大量顺序写入时，随机读 IOPS
            可能从 150 降到 20 以下。网络不是唯一的瓶颈，磁盘才是。
            

### 7.2 Ceph 的迁移限速参数

            

Ceph 提供了多个参数来控制 Recovery（恢复）和
            Backfill（回填）的速度：
            
```
# Recovery 相关参数（适用于 OSD 故障后的数据恢复）
ceph config set osd osd_recovery_max_active 3          # 每 OSD 并发恢复操作数
ceph config set osd osd_recovery_max_active_hdd 3      # HDD 特定值
ceph config set osd osd_recovery_max_active_ssd 10     # SSD 特定值
ceph config set osd osd_recovery_sleep 0               # 每次恢复操作之间的休眠时间（秒）
ceph config set osd osd_recovery_sleep_hdd 0.1         # HDD 特定值
ceph config set osd osd_recovery_sleep_ssd 0            # SSD 特定值
ceph config set osd osd_recovery_op_priority 3          # 恢复操作优先级 (1-63)
ceph config set osd osd_recovery_max_chunk 8388608      # 单次恢复的最大数据量 (字节)

# Backfill 相关参数（适用于扩容/缩容时的数据回填）
ceph config set osd osd_max_backfills 1                 # 每 OSD 并发回填操作数
ceph config set osd osd_backfill_scan_min 64            # 回填扫描的最小对象数
ceph config set osd osd_backfill_scan_max 512           # 回填扫描的最大对象数
ceph config set osd osd_backfill_full_ratio 0.85        # OSD 使用率超过此值时停止回填
```

            

这些参数的调优需要在迁移速度和业务影响之间取平衡。以下是一组针对不同场景的推荐配置：
            
```
场景一: 业务低峰期加速迁移（优先迁移完成）

  osd_recovery_max_active = 5
  osd_recovery_sleep_hdd = 0
  osd_max_backfills = 3
  osd_recovery_op_priority = 10

  预期效果: 迁移速度约 200~500 MB/s/OSD (取决于磁盘)
  业务影响: 显著，前台延迟可能上升 50%~200%

场景二: 业务高峰期温和迁移（优先保护业务）

  osd_recovery_max_active = 1
  osd_recovery_sleep_hdd = 0.5
  osd_max_backfills = 1
  osd_recovery_op_priority = 1

  预期效果: 迁移速度约 20~50 MB/s/OSD
  业务影响: 轻微，前台延迟上升 
```
# PD 调度速度相关配置

# 每个 Store 允许的并发调度操作数
pd-ctl config set max-pending-peer-count 64

# 全局调度速率限制
pd-ctl config set leader-schedule-limit 4       # Leader 迁移并发数
pd-ctl config set region-schedule-limit 2048    # Region 迁移并发数
pd-ctl config set replica-schedule-limit 64     # 副本调度并发数
pd-ctl config set merge-schedule-limit 8        # Merge 调度并发数

# 单 Store 调度速率
pd-ctl config set max-store-preparing-time 48h  # Store 上线准备时间限制

# TiKV 端的限速: 快照发送速率限制
# 在 tikv.toml 中配置:
# [server]
# snap-max-write-bytes-per-sec = "100MB"
```

            

TiKV 的调度限速思路与 Ceph 不同。Ceph 在 OSD
            级别控制并发数和休眠时间，TiKV 在 PD
            级别控制全局调度操作数量，同时在 TiKV
            端限制快照传输带宽。
            

### 7.4 优先级控制

            

不同类型的迁移有不同的紧迫程度。一个合理的优先级体系：
            
```
迁移优先级（从高到低）:

1. 副本修复 (Repair)
   场景: OSD/Store 故障，副本数低于配置值
   紧迫度: 最高——副本数不足时数据面临丢失风险
   策略: 不受限速约束（或使用更高的速率限制）

2. 缩容排空 (Decommission)
   场景: 节点计划下线
   紧迫度: 高——运维人员等待下线完成
   策略: 中等速率限制

3. 均衡调度 (Rebalance)
   场景: 节点间容量或负载不均匀
   紧迫度: 低——不影响可用性
   策略: 低速率限制，仅在业务低峰期执行

4. 后台整理 (Compaction/Defragment)
   场景: 存储引擎碎片整理
   紧迫度: 最低
   策略: 最低速率，可随时暂停
```

            

Ceph 通过 `osd_recovery_op_priority`
            参数控制优先级，范围
            1~63。数值越高优先级越高。Recovery（故障恢复）的默认优先级高于
            Backfill（回填）。
            
            

## 八、迁移对在线服务的影响

            

### 8.1 延迟影响分析

            

数据迁移对在线服务的影响主要体现在两个维度：延迟上升和
            IOPS 下降。
            

延迟上升的原因：
            
            
- **磁盘 I/O
            竞争**：迁移产生大量顺序读写，占用磁盘带宽，前台的随机
            I/O 排队时间增加。
            
- **网络带宽竞争**：迁移流量占用内部网络带宽，前台副本同步和客户端通信的延迟增加。
            
- **CPU
            竞争**：纠删码的编解码、数据校验、压缩解压等操作占用
            CPU 资源。
            
- **内存竞争**：迁移过程中的数据缓存占用 Page
            Cache，前台热数据可能被换出。
            
            
```
迁移对 HDD 延迟的影响（典型值）:

无迁移:
  随机读延迟 (4K): ~8 ms (P50), ~15 ms (P99)
  随机写延迟 (4K): ~5 ms (P50), ~12 ms (P99)
  随机读 IOPS: ~150

轻度迁移 (1 并发 backfill):
  随机读延迟 (4K): ~12 ms (P50), ~35 ms (P99)  ↑50%/↑133%
  随机写延迟 (4K): ~8 ms (P50),  ~25 ms (P99)  ↑60%/↑108%
  随机读 IOPS: ~100                             ↓33%

重度迁移 (3 并发 backfill):
  随机读延迟 (4K): ~25 ms (P50), ~80 ms (P99)  ↑212%/↑433%
  随机写延迟 (4K): ~15 ms (P50), ~60 ms (P99)  ↑200%/↑400%
  随机读 IOPS: ~40                              ↓73%

注: 以上数据为典型 7200 RPM HDD 场景下的经验值，
    实际影响取决于磁盘型号、I/O 模式、迁移数据量等因素。
```

            

SSD 场景下的影响相对较小，因为 SSD 的随机 I/O 能力远强于
            HDD，迁移的顺序 I/O 对随机 I/O 的影响更小。但 SSD
            的写放大（Write Amplification）和垃圾回收（Garbage
            Collection）可能在迁移期间被触发，导致偶发的延迟尖峰。
            

### 8.2 IOPS 影响建模

            

迁移对 IOPS 的影响可以用一个简化模型来估算。假设磁盘的总
            I/O 能力为 C（IOPS 或 MB/s），前台业务需要 W_fg，迁移需要
            W_bg：
            
```
简化模型:

  可用前台 IOPS = C - W_bg

  约束:
    W_fg + W_bg = W_min (SLA 要求的最低 IOPS)

  因此:
    W_bg 
            
- **时间窗口调度**：在业务低峰期（例如凌晨
            2:00~6:00）开启或加速迁移，高峰期减速或暂停。
            
            
```
# Ceph: 使用 crontab 在低峰期加速迁移

# 凌晨 2:00 加速
0 2 * * * ceph config set osd osd_recovery_max_active 5 && \
          ceph config set osd osd_max_backfills 3 && \
          ceph config set osd osd_recovery_sleep_hdd 0

# 早上 8:00 减速
0 8 * * * ceph config set osd osd_recovery_max_active 1 && \
          ceph config set osd osd_max_backfills 1 && \
          ceph config set osd osd_recovery_sleep_hdd 0.5
```

            
            
- **网络隔离**：将迁移流量和前台业务流量放在不同的网络上。Ceph
            支持分离 public network（客户端通信）和 cluster network（OSD
            间复制和恢复）。
            
            
```
Ceph 双网络架构:

客户端 ──── public network (10.0.1.0/24) ──── OSD
                                                │
OSD ──── cluster network (10.0.2.0/24) ──── OSD
         (迁移/恢复/心跳流量走这个网络)

配置:
  [global]
  public_network = 10.0.1.0/24
  cluster_network = 10.0.2.0/24
```

            
            
- **I/O 优先级**：在操作系统层面使用 ionice
            降低迁移进程的 I/O 优先级。
            
            
```
# 将 Ceph OSD 恢复线程设置为 idle I/O 优先级
# Ceph 内部通过 osd_recovery_op_priority 控制，
# 操作系统层面可以通过 cgroup 进一步限制:

# 创建 cgroup 限制迁移 I/O
cgcreate -g blkio:/ceph_recovery
echo "8:0 10485760" > /sys/fs/cgroup/blkio/ceph_recovery/blkio.throttle.write_bps_device
# 限制 /dev/sda (8:0) 的写带宽为 10 MB/s
```

            
            
- **分批迁移**：不要一次启动所有节点的迁移，而是分批进行。例如扩容
            4 个节点时，逐个加入而不是同时加入。
            
            
            

## 九、数据迁移监控与验证

            

### 9.1 迁移进度监控

            

数据迁移是一个长时间运行的过程（大规模集群可能持续数天），需要实时监控进度和健康状态。
            

**Ceph 迁移监控**：
            
```
# 集群整体状态
ceph -s
# 关注:
#   health: HEALTH_WARN 表示有正在进行的恢复/回填
#   data: x/y objects degraded (z%) 表示降级对象数量
#   io: recovery 带宽

# 查看正在恢复的 PG
ceph pg ls remapped
ceph pg ls recovering
ceph pg ls backfilling

# 查看每个 OSD 的恢复状态
ceph osd perf
# 输出示例:
# osd  commit_latency(ms)  apply_latency(ms)
#  0                  1                   2
#  1                  3                   5    ← 延迟偏高，可能在做恢复

# 查看恢复速率
ceph -w 2>&1 | grep recovery
# 输出示例:
# 2025-10-03 14:30:12  recovery: 1.5 GiB/s, 384 objects/s
# 2025-10-03 14:30:42  recovery: 1.3 GiB/s, 351 objects/s

# 估算剩余时间
# 降级对象数 / 恢复速率 = 剩余时间
# 例如: 50000 objects / 350 objects/s ≈ 143 秒 ≈ 2.4 分钟
```

            

**TiKV 迁移监控**：
            
```
# 查看调度状态
pd-ctl region --jq '.regions | length'          # 总 Region 数
pd-ctl operator show                            # 当前正在执行的调度操作

# 查看 Store 状态
pd-ctl store --jq '.stores[] | {id: .store.id, state: .store.state_name, region_count: .status.region_count, leader_count: .status.leader_count}'
# 输出示例:
# {"id":1,"state":"Up","region_count":1150,"leader_count":385}
# {"id":2,"state":"Up","region_count":1100,"leader_count":370}
# {"id":4,"state":"Offline","region_count":250,"leader_count":0}
#   ← Store 4 正在缩容，region_count 逐渐减少

# Grafana 监控面板关键指标:
# - PD → Operator: operator 创建/完成速率
# - TiKV → Scheduler: pending commands, snapshot 发送速率
# - TiKV → Thread CPU: scheduler-worker, raftstore CPU 使用率
```

            

### 9.2 迁移完成验证

            

迁移完成后需要验证数据的完整性和分布的均匀性。
            
```
# Ceph: 验证迁移完成

# 1. 确认集群健康
ceph health detail
# 应该输出: HEALTH_OK

# 2. 确认所有 PG 状态为 active+clean
ceph pg stat
# 输出示例:
# 1024 pgs: 1024 active+clean; 48 TiB data, 145 TiB used, 287 TiB / 432 TiB avail

# 3. 验证数据分布均匀性
ceph osd df tree
# 输出示例（经删减）:
# ID  CLASS  WEIGHT   REWEIGHT  SIZE     RAW USE  DATA     OMAP     META     AVAIL    %USE   VAR   PGS
#  0  ssd    3.63689   1.00000  3.63TiB  2.42TiB  2.40TiB  100MiB   20GiB  1.21TiB  66.67  1.00  256
#  1  ssd    3.63689   1.00000  3.63TiB  2.38TiB  2.36TiB   95MiB   19GiB  1.25TiB  65.56  0.98  252
# 12  ssd    3.63689   1.00000  3.63TiB  2.44TiB  2.42TiB  105MiB   21GiB  1.19TiB  67.22  1.01  260
# VAR 列接近 1.00 表示分布均匀

# 4. 检查均衡分数
ceph balancer eval
# 输出: current cluster score 0.00234 (lower is better)

# 5. 数据完整性校验 (deep scrub)
ceph pg deep-scrub 

# 或等待自动 deep scrub 周期完成
```

            
```
# TiKV: 验证迁移完成

# 1. 确认没有正在执行的调度操作
pd-ctl operator show
# 输出应该为空或只有少量常规调度

# 2. 确认 Store 状态
pd-ctl store
# 所有活跃 Store 状态应该为 Up
# 已缩容的 Store 状态应该为 Tombstone

# 3. 检查 Region 分布
pd-ctl region --jq '.regions | group_by(.leader.store_id) | map({store_id: .[0].leader.store_id, count: length})'
# 各 Store 的 Leader Region 数量应该大致均匀

# 4. 数据一致性检查
# TiKV 通过 Raft 日志保证一致性，通常不需要额外的校验步骤
# 但可以通过 tikv-ctl consistency-check 命令对特定 Region 做一致性检查
tikv-ctl --host 10.0.1.1:20160 consistency-check -r 42
```

            

### 9.3 迁移过程中的告警规则

            

生产环境中应该为数据迁移设置告警规则，以便在迁移异常时及时发现。
            
```
# Prometheus 告警规则示例 (Ceph)

groups:
  - name: ceph_migration
    rules:
      # 迁移持续时间过长
      - alert: CephRecoveryTooSlow
        expr: ceph_pg_degraded > 0 and ceph_recovery_bytes_rate  100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "OSD 写入延迟过高"
          description: "OSD {{ $labels.ceph_daemon }} apply 延迟超过 100ms"

      # 降级 PG 数量不减反增
      - alert: CephDegradedPGIncreasing
        expr: delta(ceph_pg_degraded[15m]) > 0
        for: 15m
        labels:
          severity: critical
        annotations:
          summary: "降级 PG 数量在增加"
          description: "过去 15 分钟降级 PG 数量持续增加，可能有新的 OSD 故障"
```

            

### 9.4
            一个完整的扩容迁移实践

            

以下是一个 Ceph
            集群扩容的完整操作流程，从规划到验证：
            
```
场景: 12 OSD 集群扩容到 16 OSD

=== 第一阶段: 规划 ===

当前集群:
  12 个 OSD (ssd, 每个 4TB, 权重 4.0)
  3 个 Pool: rbd_pool (pg_num=256), cephfs_data (pg_num=512), rgw_buckets (pg_num=256)
  副本数: 3
  总数据量: 32 TB
  平均 OSD 使用率: 73%

扩容计划:
  新增 4 个 OSD (同规格 4TB SSD)
  新总权重: 16 * 4.0 = 64.0
  理论迁移量: 32TB * (16.0/64.0) = 8 TB
  预估迁移时间 (限速 100MB/s/OSD): 8TB / (4 * 100MB/s) ≈ 5.7 小时

=== 第二阶段: 预检 ===

  1. 确认集群健康: ceph health → HEALTH_OK
  2. 确认所有 PG 为 active+clean
  3. 确认新节点硬件和网络就绪
  4. 备份 CRUSH map: ceph osd getcrushmap -o crushmap.backup
  5. 记录当前 OSD 分布: ceph osd df tree > osd_df_before.txt

=== 第三阶段: 执行 ===

  1. 设置限速参数 (保护业务)
     ceph config set osd osd_recovery_max_active 3
     ceph config set osd osd_max_backfills 1
     ceph config set osd osd_recovery_sleep_hdd 0

  2. 逐个加入新 OSD
     第 1 个 OSD: ceph orch daemon add osd host-new-1:/dev/sdb
     等待 active+clean 或确认迁移进度稳定后再加入下一个

  3. 持续监控
     watch -n 30 'ceph -s | grep -E "health|recovery|remapped"'

=== 第四阶段: 验证 ===

  1. ceph health → HEALTH_OK
  2. ceph pg stat → 所有 PG active+clean
  3. ceph osd df tree → 各 OSD 使用率均匀 (VAR ≈ 1.0)
  4. ceph balancer eval → score 
            

## 十、参考文献

            

### 论文

            
            
- 

Weil, S. A., Brandt, S. A., Miller, E. L., et
            al. (2006). *CRUSH: Controlled, Scalable, Decentralized
            Placement of Replicated Data*. SC ’06. CRUSH
            算法的原始论文，详细描述了 Ceph
            的数据放置策略和均衡机制。
            
- 

Huang, D., Liu, Q., Cui, Q., et al. (2020). *TiDB:
            A Raft-based HTAP Database*. VLDB ’20. TiDB/TiKV
            的整体架构论文，包含 Region 调度和数据均衡的设计。
            
- 

Taft, R., Sharber, I., Matei, A., et al. (2020).
            *CockroachDB: The Resilient Geo-Distributed SQL
            Database*. SIGMOD ’20. CockroachDB 的架构论文，包含
            Range 分裂、合并和自动均衡的设计。
            
- 

Karger, D., Lehman, E., Leighton, T., et al. (1997).
            *Consistent Hashing and Random Trees: Distributed Caching
            Protocols for Relieving Hot Spots on the World Wide
            Web*. STOC ’97. 一致性哈希的原始论文。
            
- 

DeCandia, G., Hastorun, D., Jampani, M., et
            al. (2007). *Dynamo: Amazon’s Highly Available Key-value
            Store*. SOSP ’07. Dynamo
            的一致性哈希和虚拟节点方案。
            
            

### 官方文档

            
            
- 

Ceph 官方文档 - PG Autoscaler. https://docs.ceph.com/en/latest/rados/operations/placement-groups/#autoscaling-placement-groups.
            PG 自动缩放模块的配置和使用说明。
            
- 

Ceph 官方文档 - Balancer Module. https://docs.ceph.com/en/latest/mgr/balancer/.
            Ceph balancer 模块的工作原理和配置参数。
            
- 

Ceph 官方文档 - Control Commands: Recovery. https://docs.ceph.com/en/latest/rados/configuration/osd-config-ref/#recovery.
            OSD 恢复和回填的配置参数详解。
            
- 

TiKV 官方文档 - PD Scheduling. https://docs.pingcap.com/tidb/stable/pd-scheduling-best-practices.
            TiKV PD 调度策略和最佳实践。
            
- 

TiKV 官方文档 - Scale a TiDB Cluster. https://docs.pingcap.com/tidb/stable/scale-tidb-using-tiup.
            TiDB/TiKV 集群扩缩容操作指南。
            
- 

CockroachDB 官方文档 - Architecture: Replication
            Layer. https://www.cockroachlabs.com/docs/stable/architecture/replication-layer.
            CockroachDB 的副本层架构，包含 Range
            分裂合并和自动均衡。
            
            

### 源码参考

            
            
- 

Ceph 源码 - `src/osd/PG.cc`,
            `src/osd/PrimaryLogPG.cc`. PG
            恢复和回填的实现逻辑。版本：Ceph 18.x (Reef)。
            
- 

TiKV 源码 -
            `components/raftstore/src/store/peer.rs`,
            `components/pd_client/src/lib.rs`. Region 调度和
            PD 通信的实现。版本：TiKV 7.x。
            
- 

CockroachDB 源码 -
            `pkg/kv/kvserver/allocator.go`,
            `pkg/kv/kvserver/replicate_queue.go`. Range
            均衡器和副本队列的实现。版本：CockroachDB 23.x。
            
            
            

**上一篇**: 元数据管理
            **下一篇**: 多租户存储隔离
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Parquet 文件格式深拆

                    

拆 Parquet 的物理结构：file → row group → column chunk → page，footer 里的 FileMetaData（Thrift）与 PAR1 magic。讲清 PLAIN/RLE-bitpacking/字典/DELTA_BINARY_PACKED/BYTE_STREAM_SPLIT 各自压谁，Dremel 的 repetition/definition level 如何表达嵌套，column index/offset index 与 split-block bloom filter 怎样让谓词在读盘前裁掉 page。基于本机 pyarrow 24.0.0 真实 dump footer 与编码。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】ORC 文件格式与 Parquet 对照

                    

ORC 用 stripe 而非 row group、用三级统计（file/stripe/row-group index）而非独立 page index、用 PRESENT/DATA 等 stream 而非 page 组织一列。本文按 ORC 规范拆其文件尾（postscript + footer）、stripe 内部结构与 RLEv2 整数编码，并用本机 pyarrow 24.0.0 把同一份 30 万行数据写成 ORC 与 Parquet，对比真实体积与物理布局，最后给出什么场景仍用 ORC。