# 【存储工程】数据分片策略

来源: https://quant67.com/post/storage/52-data-sharding/data-sharding.html
日期: 2025-09-30 |

---

当单节点的存储容量或吞吐量无法满足需求时，数据分片（Data
            Sharding）是最基本的横向扩展手段。分片的核心问题只有一个：给定一条数据，它应该放到哪个节点上？这个问题看似简单，但不同的回答方式会导致截然不同的工程后果——数据倾斜（Data
            Skew）、扩容时的数据迁移量、范围查询的支持能力、故障恢复的复杂度，全部取决于分片策略的选择。
            

本文从分片的工程动机出发，逐一剖析哈希分片、范围分片、一致性哈希（Consistent
            Hashing）、跳跃一致性哈希（Jump Consistent
            Hash）、会合哈希（Rendezvous Hashing）和 CRUSH
            算法，最后对比这些策略在 Cassandra、TiKV、Kafka、MongoDB
            等实际系统中的应用。讨论的重点不是算法推导，而是每种策略在工程实践中的取舍和陷阱。
            
            

## 一、分片的工程动机

            

### 1.1 为什么需要分片

            

分布式存储系统面临三个基本矛盾：
            

**容量矛盾**。单块磁盘的容量上限是确定的——一块企业级
            SSD 通常在 4-16 TB，即使使用 HDD 也不过 20-24
            TB。当数据量增长到 PB
            级别时，单节点无法承载全部数据，必须将数据分散到多个节点上。
            

**吞吐矛盾**。即使容量够用，单节点的 IOPS
            和带宽也有上限。一块 NVMe SSD 的随机读 IOPS 大约在 100
            万左右，顺序写吞吐约 3-6
            GB/s。当并发请求量超过单节点能力时，必须将负载分散。
            

**可用性矛盾**。单节点是单点故障（Single
            Point of
            Failure）。分片本身不直接解决可用性问题——那是副本（Replication）的工作——但分片是副本策略的前提。没有分片就没有数据单元的边界，副本也无从谈起。
            

### 1.2 分片的核心问题

            

分片策略需要回答以下问题：
            
            
- **映射函数**：给定一个键（Key），如何计算它所属的分片编号？
            
- **负载均衡**：数据和请求是否能均匀分布到各个节点？
            
- **扩缩容成本**：增加或移除节点时，需要迁移多少数据？
            
- **查询支持**：是否支持范围查询（Range
            Query）和有序扫描（Ordered Scan）？
            
- **元数据开销**：分片映射表需要多大的存储空间？客户端如何获取最新映射？
            
            

没有一种分片策略能在所有维度上都最优。哈希分片天然均匀但丧失数据局部性（Data
            Locality），范围分片保留有序性但容易产生热点（Hotspot），一致性哈希减少扩容迁移量但引入了虚拟节点（Virtual
            Node）的管理复杂度。后续各节逐一展开。
            

### 1.3 分片与分区的术语约定

            

“分片”和”分区（Partitioning）“在不同系统中的含义不完全一致。本文采用以下约定：
            
            
            
            
            
            
            
            
            术语
            含义
            举例
            
            
            
            
            分片（Shard）
            数据被拆分后的一个逻辑子集
            MongoDB 的 shard
            
            
            分区（Partition）
            与分片含义相同，侧重逻辑划分
            Kafka 的 partition
            
            
            节点（Node）
            物理或虚拟的存储服务器
            一台服务器或一个容器
            
            
            副本（Replica）
            同一分片的冗余拷贝
            Cassandra 的 replica
            
            
            
            

在本文中，“分片”和”分区”可以互换使用，不做语义区分。
            
            

## 二、哈希分片

            

### 2.1 取模哈希

            

最朴素的哈希分片策略是取模哈希（Modular Hashing）：
            
```
shard_id = hash(key) % N
```

            

其中 `N` 是节点数量，`hash`
            是一个哈希函数。给定相同的 `key` 和
            `N`，映射结果是确定的，客户端可以独立计算目标节点，不依赖中心化的路由表。
            

用 Python 实现一个简单的取模分片：
            
```
import hashlib

def modular_shard(key: str, num_nodes: int) -> int:
    """取模哈希分片：返回分片编号"""
    digest = hashlib.md5(key.encode()).hexdigest()
    hash_value = int(digest, 16)
    return hash_value % num_nodes

# 10 个节点，观察 key 的分布
num_nodes = 10
keys = [f"user:{i}" for i in range(10000)]
distribution = [0] * num_nodes
for k in keys:
    shard = modular_shard(k, num_nodes)
    distribution[shard] += 1

for i, count in enumerate(distribution):
    print(f"Node {i}: {count} keys ({count/100:.1f}%)")
```

            
```
Node 0: 1007 keys (10.1%)
Node 1: 1015 keys (10.2%)
Node 2: 988 keys (9.9%)
Node 3: 1006 keys (10.1%)
Node 4: 983 keys (9.8%)
Node 5: 1012 keys (10.1%)
Node 6: 999 keys (10.0%)
Node 7: 990 keys (9.9%)
Node 8: 1003 keys (10.0%)
Node 9: 997 keys (10.0%)
```

            

数据分布非常均匀。取模哈希的优势在于实现极简、计算快、分布均匀。但它有一个致命缺陷。
            

### 2.2 取模哈希的扩容灾难

            

当节点数从 `N` 变为 `N+1`
            时，几乎所有 key 的分片归属都会改变。考虑 `N=10`
            扩容到 `N=11`：
            
```
def migration_ratio(num_keys: int, old_n: int, new_n: int) -> float:
    """计算扩容时需要迁移的数据比例"""
    migrated = 0
    for i in range(num_keys):
        key = f"key:{i}"
        old_shard = modular_shard(key, old_n)
        new_shard = modular_shard(key, new_n)
        if old_shard != new_shard:
            migrated += 1
    return migrated / num_keys

ratio = migration_ratio(100000, 10, 11)
print(f"迁移比例: {ratio:.1%}")
```

            
```
迁移比例: 90.9%
```

            

增加一个节点就要迁移约 90% 的数据。理论上，取模哈希从
            `N` 扩容到 `N+1` 时的迁移比例约为
            `N/(N+1)`，节点越多，迁移比例越接近
            100%。这在生产环境中是不可接受的——迁移期间的网络带宽消耗、服务降级和数据不一致风险都会被放大。
            

### 2.3 热点问题

            

即使哈希函数能把 key
            均匀分散，也不代表负载是均匀的。热点问题来源于两个层面：
            

**数据量倾斜**。某些 key 对应的数据比其他
            key
            大得多。例如在社交网络中，一个拥有千万粉丝的用户的粉丝列表和一个普通用户的粉丝列表，数据量可能差几个数量级。哈希分片只保证
            key 的数量均匀，不保证数据量均匀。
            

**访问量倾斜**。某些 key
            的访问频率远高于其他
            key。一条爆款新闻的阅读量可能是普通新闻的一万倍。即使这条新闻的数据只有几
            KB，集中的访问也会把对应节点打满。
            

哈希分片对热点问题没有内在的解决机制。常见的缓解手段包括：在热点
            key 后面追加随机后缀（Key
            Salting）将负载分散到多个分片，或者在分片之上增加缓存层。但这些都是应用层的补丁，不是分片策略本身的能力。
            
            

## 三、范围分片

            

### 3.1 基本原理

            

范围分片（Range Partitioning）将 key
            空间按照某种有序规则切分为连续的区间，每个区间对应一个分片。典型的做法是维护一张分片映射表：
            
```
分片 1: [""       , "customer:00500")
分片 2: ["customer:00500", "customer:01000")
分片 3: ["customer:01000", "customer:01500")
分片 4: ["customer:01500", "customer:02000")
分片 5: ["customer:02000", +∞)
```

            

给定一个
            key，在映射表中做一次二分查找就能确定它属于哪个分片。
            

范围分片的最大优势是**保留了 key
            的有序性**。以下查询可以高效执行：
            
            
- 范围查询：`SELECT * FROM orders WHERE order_date BETWEEN '2025-01-01' AND '2025-01-31'`
            
- 前缀扫描：获取某个用户的所有订单
            
- 有序遍历：按 key 顺序导出全部数据
            
            

这些操作在哈希分片中要么需要扫描所有节点（Scatter-Gather），要么根本无法高效执行。
            

### 3.2 分片边界的选择

            

范围分片的关键难点在于如何确定分片边界（Split
            Point）。常见的策略有三种：
            

**预设固定边界**。在建表时就确定分片边界，之后不再变化。HBase
            的预分区（Pre-splitting）就是这种做法。优点是简单，缺点是必须提前了解数据分布，选错了就会导致严重倾斜。
            
```
// HBase 预分区示例
byte[][] splitKeys = new byte[][] {
    Bytes.toBytes("customer:00500"),
    Bytes.toBytes("customer:01000"),
    Bytes.toBytes("customer:01500"),
    Bytes.toBytes("customer:02000")
};
admin.createTable(tableDesc, splitKeys);
```

            

**自动分裂与合并**。当一个分片的数据量超过阈值时自动分裂（Split）为两个分片，数据量过小时与相邻分片合并（Merge）。TiKV
            采用这种策略，默认的分片（Region）大小上限是 144
            MB（从早期的 96 MB 调整而来），超过就触发分裂。
            

**采样驱动**。系统定期对数据进行采样，根据采样结果重新计算分片边界。MongoDB
            的 Balancer 使用类似机制，通过统计每个分片的数据量和 chunk
            数来决定是否迁移。
            

### 3.3 分裂与合并的工程细节

            

以 TiKV 的 Region
            分裂为例，整个流程涉及多个组件协调：
            
```
                     PD（调度中心）
                    ┌──────────┐
                    │ 分片映射表  │
                    │ 调度决策   │
                    └────┬─────┘
                         │ 更新映射
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       ┌────────┐  ┌────────┐  ┌────────┐
       │ TiKV-1 │  │ TiKV-2 │  │ TiKV-3 │
       │Region A│  │Region B│  │Region C│
       │[a, m)  │  │[m, t)  │  │[t, +∞) │
       └────────┘  └────────┘  └────────┘

Region B 超过大小阈值，触发分裂：

       ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
       │ TiKV-1 │  │ TiKV-2 │  │ TiKV-2 │  │ TiKV-3 │
       │Region A│  │Region B│  │Region D│  │Region C│
       │[a, m)  │  │[m, p)  │  │[p, t)  │  │[t, +∞) │
       └────────┘  └────────┘  └────────┘  └────────┘
```

            

分裂过程中有几个关键的工程约束：
            
            
- **分裂点的选择**。TiKV 不是简单地取中间
            key，而是根据实际数据分布选择分裂点，避免分裂后两个 Region
            大小差异过大。
            
- **分裂期间的写入**。分裂操作通过 Raft
            日志同步到所有副本，在此过程中对 Region
            的写入会短暂阻塞（通常在毫秒级）。
            
- **元数据更新**。分裂完成后需要向
            PD（Placement Driver）上报新的 Region
            信息，客户端会在下次请求时刷新路由缓存。
            
            

合并的反向流程更复杂——需要确保两个相邻 Region
            的所有副本都在同一组节点上，否则还需要先做副本迁移，这会引入额外的调度延迟。
            

### 3.4 范围分片的热点

            

范围分片最容易产生热点的场景是**单调递增的
            key**。典型案例：
            
            
- 时间戳作为 key 前缀：所有新写入都集中在最后一个分片
            
- 自增 ID：效果和时间戳类似
            
- 用户 ID 按注册顺序分配：新用户的写入集中在尾部分片
            
            

解决思路通常是对 key 做变换。例如 HBase
            中常见的做法是对行键（Row Key）做反转或加盐：
            
```
// 原始 key：时间戳在前，写入集中
String rowKey = timestamp + ":" + userId;

// 优化方案 1：哈希前缀打散
String salt = String.valueOf(userId.hashCode() % 16);
String rowKey = salt + ":" + timestamp + ":" + userId;

// 优化方案 2：反转时间戳
String reversedTs = String.valueOf(Long.MAX_VALUE - timestamp);
String rowKey = reversedTs + ":" + userId;
```

            

但这些变换都以牺牲范围查询能力为代价——加盐之后，按时间范围查询就必须对所有盐值的分片做并行扫描。
            
            

## 四、一致性哈希与虚拟节点

            

### 4.1 一致性哈希的基本思想

            

一致性哈希（Consistent Hashing）由 Karger 等人在 1997
            年的论文 *Consistent Hashing and Random Trees*
            中提出。核心思想是将哈希空间组织为一个环（Hash
            Ring），节点和数据都映射到环上的某个位置，数据归属于环上顺时针方向遇到的第一个节点。
            
```
                    0
                    │
           Node D ──┤
                    │
        270 ────────┼──────── 90
                    │
                    ├── Node B
                    │
                   180
                    │
           Node A ──┤        Node C ──┤
                    │                 │
```

            

映射规则：从数据的哈希位置出发，沿顺时针方向找到的第一个节点就是它的归属节点。
            

用 Python 实现一致性哈希的核心逻辑：
            
```
import hashlib
import bisect
from typing import List, Optional

class ConsistentHash:
    """一致性哈希环"""

    def __init__(self):
        self._ring: List[int] = []       # 排序的哈希位置列表
        self._nodes: dict[int, str] = {} # 哈希位置 -> 节点名称

    def _hash(self, key: str) -> int:
        digest = hashlib.sha256(key.encode()).hexdigest()
        return int(digest, 16) % (2 ** 32)

    def add_node(self, node: str) -> None:
        h = self._hash(node)
        if h not in self._nodes:
            self._nodes[h] = node
            bisect.insort(self._ring, h)

    def remove_node(self, node: str) -> None:
        h = self._hash(node)
        if h in self._nodes:
            del self._nodes[h]
            self._ring.remove(h)

    def get_node(self, key: str) -> Optional[str]:
        if not self._ring:
            return None
        h = self._hash(key)
        idx = bisect.bisect_right(self._ring, h)
        if idx == len(self._ring):
            idx = 0
        return self._nodes[self._ring[idx]]
```

            

### 4.2 扩容时的迁移量

            

一致性哈希的关键优势在于扩缩容时只影响相邻节点。当新增一个节点
            E 时，只有 E 的逆时针方向前一个节点的部分数据需要迁移到
            E，其他节点完全不受影响。
            

理论上，`N` 个节点新增一个节点时的迁移比例约为
            `1/(N+1)`——远好于取模哈希的
            `N/(N+1)`。
            

对于同样从 10 个节点扩容到 11
            个节点的场景，两种策略的迁移量差异如下：
            
```
扩容迁移量对比（10000 个 key）：

节点数变化    取模哈希迁移比例    一致性哈希迁移比例
10 → 11      ~90.9%             ~9.1%
100 → 101    ~99.0%             ~1.0%
1000 → 1001  ~99.9%             ~0.1%
```

            

节点数越多，一致性哈希的迁移量优势越明显。在千节点规模的集群中，新增一个节点只需迁移约
            0.1% 的数据，而取模哈希则需要几乎全量重分布。
            

### 4.3 数据倾斜与虚拟节点

            

原始一致性哈希有一个严重的实际问题：当节点数较少时，数据分布极不均匀。三个节点可能出现一个节点承载
            50% 数据、另一个只承载 15%
            的情况。原因是每个节点只在环上占一个点，点的间距取决于哈希值的随机性，节点越少，偏差越大。
            

虚拟节点（Virtual Node，简称
            vnode）是解决方案：每个物理节点在环上映射为多个虚拟节点。如果每个物理节点有
            150 个虚拟节点，环上就有 `N * 150`
            个点，统计均匀性大幅改善。
            
```
class ConsistentHashWithVNodes:
    """带虚拟节点的一致性哈希"""

    def __init__(self, num_vnodes: int = 150):
        self._num_vnodes = num_vnodes
        self._ring: List[int] = []
        self._nodes: dict[int, str] = {}

    def _hash(self, key: str) -> int:
        digest = hashlib.sha256(key.encode()).hexdigest()
        return int(digest, 16) % (2 ** 32)

    def add_node(self, node: str) -> None:
        for i in range(self._num_vnodes):
            vnode_key = f"{node}#vnode{i}"
            h = self._hash(vnode_key)
            self._nodes[h] = node
            bisect.insort(self._ring, h)

    def remove_node(self, node: str) -> None:
        for i in range(self._num_vnodes):
            vnode_key = f"{node}#vnode{i}"
            h = self._hash(vnode_key)
            if h in self._nodes:
                del self._nodes[h]
                self._ring.remove(h)

    def get_node(self, key: str) -> Optional[str]:
        if not self._ring:
            return None
        h = self._hash(key)
        idx = bisect.bisect_right(self._ring, h)
        if idx == len(self._ring):
            idx = 0
        return self._nodes[self._ring[idx]]
```

            

虚拟节点数量的选择需要权衡：
            
            
            
            虚拟节点数
            负载标准差（5 节点）
            环上总点数
            查找时间复杂度
            
            
            
            
            1
            ~40%
            5
            O(log 5)
            
            
            10
            ~15%
            50
            O(log 50)
            
            
            50
            ~7%
            250
            O(log 250)
            
            
            150
            ~4%
            750
            O(log 750)
            
            
            500
            ~2%
            2500
            O(log 2500)
            
            
            
            

Cassandra 在早期版本中默认使用 256
            个虚拟节点（`num_tokens: 256`），后来在 4.0
            版本将默认值调整为
            16，原因是虚拟节点数过多会导致流式修复（Streaming
            Repair）和启动时间增加。这说明虚拟节点数不是越多越好——需要在负载均衡和运维成本之间找到平衡点。
            

### 4.4 一致性哈希的工程局限

            

虽然一致性哈希在理论上很优雅，但在实际系统中存在几个工程层面的不足：
            

**异构节点处理不自然**。如果集群中有的节点配备了
            NVMe SSD、有的还在用
            HDD，我们希望高性能节点承担更多数据。虚拟节点可以通过给高性能节点分配更多
            vnode
            来实现，但调整比例时需要重新计算和迁移，操作不够灵活。
            

**元数据开销**。每个虚拟节点都需要在环上记录一条映射关系。当集群有
            1000 个物理节点、每个节点 256 个 vnode 时，环上有 256000
            个条目。虽然内存占用不大（几
            MB），但在节点变更时需要同步这些映射到所有客户端，增加了元数据管理的复杂度。
            

**副本放置约束难以表达**。一致性哈希的顺时针选择规则无法直接表达”三个副本必须分布在不同机架”或”必须在不同可用区”这类拓扑感知（Topology-aware）的放置策略。虽然可以在选择时跳过不满足约束的节点，但实现起来不够优雅，且可能破坏负载均衡。
            
            

## 五、跳跃一致性哈希（Jump
            Consistent Hash）

            

### 5.1 算法原理

            

跳跃一致性哈希（Jump Consistent Hash）由 Google 的 John
            Lamping 和 Eric Veach 在 2014 年的论文 *A Fast, Minimal
            Memory, Consistent Hash Algorithm*
            中提出。整个算法只有几行代码：
            
```
int32_t jump_consistent_hash(uint64_t key, int32_t num_buckets) {
    int64_t b = -1, j = 0;
    while (j > 33) + 1)));
    }
    return (int32_t)b;
}
```

            

用 Python 实现同样的逻辑：
            
```
def jump_consistent_hash(key: int, num_buckets: int) -> int:
    """跳跃一致性哈希：返回桶编号"""
    b, j = -1, 0
    while j > 33) + 1)))
    return b
```

            

### 5.2 核心特性

            

跳跃一致性哈希有三个突出的优点：
            

**零内存开销**。不需要维护任何数据结构——没有哈希环，没有虚拟节点表，只有一个纯函数。内存占用为
            O(1)。
            

**完美均匀**。不是”近似均匀”，是数学意义上的完美均匀。每个桶（Bucket）分到的
            key 数量差异在统计噪声范围内。
            

**最小迁移**。从 `N` 个桶扩容到
            `N+1` 个桶时，恰好有 `1/(N+1)` 的 key
            被迁移到新桶，这是理论最优值。
            

性能方面，`jump_consistent_hash`
            的时间复杂度是 O(ln N)，在 1000 个桶的情况下大约需要 7
            次循环迭代。
            

### 5.3 局限与适用场景

            

跳跃一致性哈希有两个硬限制：
            

**只支持尾部扩缩容**。桶的编号必须是 0 到
            N-1
            的连续整数，只能从尾部添加或移除桶。不能移除中间的某个桶——比如你不能说”把
            3
            号桶下线”，只能移除编号最大的桶。这意味着它不适合需要任意节点上下线的场景。
            

**桶没有名称**。算法返回的是一个整数编号，不是节点标识。需要额外维护编号到节点的映射。如果某个节点故障需要下线，不能直接移除对应的桶编号，只能替换该编号对应的节点。
            

这些特性决定了跳跃一致性哈希适合**节点拓扑相对稳定、主要需求是横向扩容**的场景：
            
            
- 数据库代理层（Proxy）的路由：后端节点编号固定，主要操作是加新节点
            
- 缓存集群的分片：节点故障时用替代节点填充，而不是缩减桶数
            
- 负载均衡器的后端选择：Google
            在内部的负载均衡中使用了这个算法
            
            
            

## 六、会合哈希（Rendezvous
            Hashing）

            

### 6.1 算法思想

            

会合哈希（Rendezvous
            Hashing），也叫最高随机权重哈希（Highest Random
            Weight，HRW），由 Thaler 和 Ravishankar 在 1998
            年提出。思路很直接：对于每个
            key，计算它与每个节点的”亲和度分数”，选择分数最高的节点。
            
```
import hashlib

def rendezvous_hash(key: str, nodes: list[str]) -> str:
    """会合哈希：返回亲和度最高的节点"""
    best_node = None
    best_score = -1
    for node in nodes:
        score_input = f"{key}:{node}"
        digest = hashlib.sha256(score_input.encode()).hexdigest()
        score = int(digest, 16)
        if score > best_score:
            best_score = score
            best_node = node
    return best_node
```

            

### 6.2 核心特性

            

**节点增删只影响最小范围**。移除一个节点时，只有原本映射到该节点的
            key 需要重新分配——它们会各自找到自己的次高分节点。其他 key
            的归属完全不变。增加一个节点时，只有新节点成为某些 key
            的最高分节点时，那些 key 才会迁移过来。迁移量是理论最优的
            `1/(N+1)`。
            

**节点可以任意增删**。不像跳跃一致性哈希要求桶编号连续，会合哈希的节点列表可以任意增减。移除中间的某个节点完全没有问题。
            

**天然支持权重**。可以通过对不同节点的分数乘以权重系数来实现异构节点的负载分配：
            
```
def weighted_rendezvous_hash(key: str, nodes: dict[str, float]) -> str:
    """加权会合哈希：nodes 是 {节点名: 权重} 的字典"""
    best_node = None
    best_score = -1.0
    for node, weight in nodes.items():
        score_input = f"{key}:{node}"
        digest = hashlib.sha256(score_input.encode()).hexdigest()
        raw_score = int(digest, 16) / (2 ** 256)  # 归一化到 [0, 1)
        # 用对数变换实现加权：-weight / ln(score)
        import math
        if raw_score > 0:
            weighted_score = weight / (-math.log(raw_score))
        else:
            weighted_score = float('inf')
        if weighted_score > best_score:
            best_score = weighted_score
            best_node = node
    return best_node
```

            

### 6.3 性能代价与优化

            

会合哈希的最大缺点是计算复杂度为
            O(N)——每次查找都要遍历所有节点。当节点数量较小（几十到几百）时，这不是问题；但当节点数达到数千时，每次路由都要计算数千次哈希，开销不可忽略。
            

优化方向有两个：
            

**骨架哈希（Skeleton-based Rendezvous
            Hashing）**。将节点组织成树形结构，在每一层做会合哈希选择，将复杂度降低到
            O(log N)。但实现复杂度大幅增加。
            

**分层会合哈希**。先用一次哈希选择分组，再在组内做会合哈希。例如
            1000 个节点分成 32 组，第一层在 32 个组中选择（32
            次哈希），第二层在约 31 个节点中选择（31 次哈希），总共约 63
            次哈希，远小于 1000 次。
            

在实践中，会合哈希最常见的应用场景是分布式缓存和 CDN
            的节点选择——节点数量通常在几十到几百的范围内，O(N)
            的复杂度完全可以接受。GitHub 的负载均衡系统 GLB
            就使用了会合哈希。
            
            

## 七、CRUSH 算法（Ceph
            的分片策略）

            

### 7.1 CRUSH 的设计目标

            

CRUSH（Controlled Replication Under Scalable Hashing）是
            Ceph 存储系统的核心数据放置算法，由 Sage Weil 在 2006
            年的论文 *CRUSH: Controlled, Scalable, Decentralized
            Placement of Replicated Data* 中提出。
            

CRUSH
            要解决的问题比单纯的分片更复杂：它不仅要决定数据放在哪个节点，还要同时处理副本放置、故障域隔离和异构硬件权重。具体来说，CRUSH
            需要满足以下目标：
            
            
- **去中心化**。任何客户端都能独立计算数据位置，不依赖中心化的查表服务。
            
- **拓扑感知**。副本必须分布在不同的故障域（Failure
            Domain）——不同机架、不同机柜、不同数据中心。
            
- **权重支持**。不同容量和性能的存储设备应该承担不同的数据量。
            
- **稳定性**。增减节点时，数据迁移量应该接近理论最小值。
            
            

### 7.2 CRUSH Map 与集群拓扑

            

CRUSH 用一棵层次化的树——CRUSH
            Map——来描述集群的物理拓扑。树的叶子节点是 OSD（Object
            Storage
            Daemon，即实际的存储进程），非叶子节点表示故障域层次：
            
```
root default
├── datacenter dc1
│   ├── rack rack1
│   │   ├── host node1
│   │   │   ├── osd.0  (weight: 3.64)
│   │   │   └── osd.1  (weight: 3.64)
│   │   └── host node2
│   │       ├── osd.2  (weight: 7.28)
│   │       └── osd.3  (weight: 7.28)
│   └── rack rack2
│       ├── host node3
│       │   ├── osd.4  (weight: 3.64)
│       │   └── osd.5  (weight: 3.64)
│       └── host node4
│           ├── osd.6  (weight: 7.28)
│           └── osd.7  (weight: 7.28)
└── datacenter dc2
    └── ...
```

            

权重（Weight）通常以 TB 为单位设定——一块 4 TB
            的磁盘权重为 3.64（格式化后可用容量），一块 8 TB
            的磁盘权重为 7.28。CRUSH
            会按权重比例分配数据，确保大容量磁盘承担更多数据。
            

### 7.3 CRUSH 放置规则

            

CRUSH 通过放置规则（Placement
            Rule）定义数据的放置策略。一条典型规则如下：
            
```
rule replicated_rack {
    id 0
    type replicated
    step take default
    step chooseleaf firstn 0 type rack
    step emit
}
```

            

这条规则的含义是：
            
            
- `take default`：从根节点 `default`
            开始。
            
- `chooseleaf firstn 0 type rack`：选择 N
            个不同的机架（`type rack`），在每个机架中选择一个叶子节点（OSD）。`firstn 0`
            表示选择的数量等于副本数（由存储池配置决定）。
            
- `emit`：输出选择结果。
            
            

如果副本数为 3，这条规则就会在三个不同机架中各选一个
            OSD，保证任何一个机架整体故障都不会丢失数据。
            

### 7.4 CRUSH 的哈希选择过程

            

CRUSH
            在每一层选择节点时使用的是一种确定性的伪随机算法。以
            `straw2`（Ceph Hammer
            版本后的默认桶类型）为例，选择过程如下：
            
```
对于每个候选节点 i：
    draw(i) = hash(pgid, attempt, i) * weight(i) 的对数变换
选择 draw 值最大的节点
```

            

`straw2`
            的名称来源于”抽签”比喻——每个候选节点抽一根”签”，签的长度由哈希值和权重共同决定，签最长的节点胜出。这种方式保证了：
            
            
- 增减某个节点时，只有与该节点直接竞争的 key
            会被重新分配
            
- 权重越大的节点”抽到长签”的概率越高，从而承担更多数据
            
            

用 Python 演示 `straw2` 的选择逻辑：
            
```
import hashlib
import math

def crush_straw2_select(pgid: int, candidates: dict[str, float]) -> str:
    """
    模拟 CRUSH straw2 选择算法
    candidates: {节点名: 权重}
    """
    best_node = None
    best_draw = -float('inf')

    for node, weight in candidates.items():
        # 计算哈希值
        hash_input = f"{pgid}:{node}"
        digest = hashlib.sha256(hash_input.encode()).hexdigest()
        hash_val = int(digest, 16) % (2 ** 32)

        # 归一化到 (0, 1] 并做对数变换
        normalized = (hash_val + 1) / (2 ** 32 + 1)
        draw = math.log(normalized) / weight if weight > 0 else -float('inf')

        # draw 值最大（最接近 0）的节点胜出
        if draw > best_draw:
            best_draw = draw
            best_node = node

    return best_node
```

            

### 7.5 CRUSH 的工程代价

            

CRUSH
            的强大来自于它的灵活性，但这也带来了工程复杂度：
            

**CRUSH Map 维护**。每次增减
            OSD、调整权重或修改故障域结构，都需要更新 CRUSH Map
            并广播到所有客户端和 OSD。在大规模集群（数千个
            OSD）中，CRUSH Map 本身可能有数十
            KB，更新频率过高会增加网络开销。
            

**PG 数量规划**。Ceph 在 CRUSH
            之上还有一层放置组（Placement
            Group，PG）的概念。数据先映射到 PG（通过哈希取模），再由
            CRUSH 将 PG 映射到 OSD 组。PG
            数量的选择直接影响负载均衡的粒度和恢复时的并行度。PG
            过少导致数据倾斜，PG 过多导致内存和 peering 开销增大。Ceph
            官方建议每个 OSD 承载 100-200 个 PG。
            

**数据迁移的可控性**。虽然 CRUSH
            的理论迁移量接近最优，但实际操作中，调整 CRUSH Map
            可能触发大量 PG 的重新映射。Ceph 提供了
            `osd_max_backfills`（默认值 1）和
            `osd_recovery_max_active`（默认值
            3）等参数来限制并发回填速率，避免恢复流量影响前台 I/O。
            
            

## 八、分片在实际系统中的应用

            

### 8.1
            Cassandra：一致性哈希 + 虚拟节点

            

Cassandra
            是一致性哈希在生产系统中最典型的应用。数据根据分区键（Partition
            Key）的哈希值映射到 token 环上。每个节点负责环上一段连续的
            token 范围。
            

关键设计决策：
            
            
- 

**分区器**（Partitioner）。默认使用
            `Murmur3Partitioner`，将 key 哈希为一个 64
            位整数，token 范围是
            `[-2^63, 2^63)`。早期版本使用的
            `RandomPartitioner` 基于
            MD5，性能较差，已不推荐使用。
            
- 

**虚拟节点**。Cassandra 3.x 默认
            `num_tokens: 256`，每个节点在环上占 256
            段。Cassandra 4.0 将默认值降低为
            `num_tokens: 16`，并引入了一种新的 token
            分配算法，在更少的 vnode
            数下实现更好的均衡。这个调整的动机是减少跨节点的数据流式传输量和降低启动时间。
            
- 

**副本放置**。副本策略（Replication
            Strategy）定义在 keyspace
            层面。`NetworkTopologyStrategy`
            支持多数据中心部署，在每个数据中心内沿 token
            环顺时针选择不同机架上的节点作为副本。
            
            
```
# cassandra.yaml 中虚拟节点配置
num_tokens: 16
allocate_tokens_for_local_replication_factor: 3
```

            

### 8.2 TiKV：范围分片 + Raft
            组

            

TiKV 采用范围分片，将 key 空间划分为连续的 Region。每个
            Region 默认大小上限 144 MB。Region
            是调度和副本的基本单位——每个 Region 独立组成一个 Raft
            组（Raft Group），通过 Raft 协议在多个 TiKV
            节点上维护副本一致性。
            

关键设计决策：
            
            
- 

**Region 分裂**。当一个 Region
            的数据量超过阈值（`region-split-size`，默认 144
            MB）或 key
            数量超过阈值（`region-split-keys`，默认
            1440000）时，自动从中间位置分裂为两个
            Region。分裂点通过采样实际 key
            分布来选择，而非简单取中点。
            
- 

**Region 合并**。当相邻的两个 Region
            都小于 `region-merge-size`（默认 20 MB）且 key
            数量少于 `region-merge-keys`（默认 200000）时，PD
            会调度合并操作。合并操作需要两个 Region
            的所有副本都在健康状态。
            
- 

**热点调度**。PD 会监控每个 Region
            的读写流量，当检测到热点 Region 时，可以通过 Region
            分裂（将热点 Region 拆成更细的粒度）和 Leader
            转移（将读热点的 Leader 分散到不同节点）来缓解。
            
            
```
# tikv.toml 中 Region 分片相关配置
[coprocessor]
region-split-size = "144MB"
region-split-keys = 1440000
region-max-size = "144MB"
region-max-keys = 1440000

[raftstore]
region-merge-size-diff = "20MB"
```

            

### 8.3 Kafka：固定分区 +
            键哈希

            

Kafka
            的分片策略相对简单：每个主题（Topic）在创建时指定分区（Partition）数量，之后分区数量通常不变（虽然可以增加，但不推荐，因为会破坏
            key 到分区的映射关系）。
            

关键设计决策：
            
            
- 

**分区策略**。默认的
            `DefaultPartitioner` 行为：如果消息有 key，使用
            `murmur2(key) % numPartitions`
            决定目标分区；如果消息没有 key，使用粘性分区策略（Sticky
            Partitioner），在一个批次内将消息发送到同一个分区，减少请求数。
            
- 

**分区数不可减少**。Kafka
            不支持减少分区数，因为这会导致消费者组（Consumer
            Group）的偏移量（Offset）语义混乱。只能增加分区数，但增加后带
            key 的消息的路由会改变，可能导致同一个 key
            的消息分散到不同分区，破坏顺序保证。
            
- 

**分区再均衡**。分区在 Broker
            之间的分配由控制器（Controller）管理。当 Broker
            增减时，需要手动或通过工具（如
            `kafka-reassign-partitions.sh`）重新分配分区。KRaft
            模式下的分区迁移流程与 ZooKeeper 模式基本一致。
            
            
```
// Kafka 生产者自定义分区器示例
public class OrderPartitioner implements Partitioner {
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                         Object value, byte[] valueBytes, Cluster cluster) {
        List partitions = cluster.partitionsForTopic(topic);
        int numPartitions = partitions.size();
        if (keyBytes == null) {
            // 无 key 时轮询
            return ThreadLocalRandom.current().nextInt(numPartitions);
        }
        // 有 key 时用 murmur2 哈希
        return Utils.toPositive(Utils.murmur2(keyBytes)) % numPartitions;
    }
}
```

            

### 8.4
            MongoDB：范围分片与哈希分片并存

            

MongoDB
            同时支持范围分片和哈希分片，由用户在创建分片集合时选择。
            
```
// 范围分片
sh.shardCollection("mydb.orders", { "order_date": 1 })

// 哈希分片
sh.shardCollection("mydb.users", { "user_id": "hashed" })
```

            

关键设计决策：
            
            
- 

**分片键不可修改**。一旦选定分片键（Shard
            Key），不能更改。MongoDB 5.0 引入了
            `reshardCollection`
            命令，允许更换分片键，但操作代价很大——需要将所有数据重新分发，在大集合上可能耗时数小时。
            
- 

**Chunk
            分裂与均衡**。数据按分片键范围划分为 Chunk（默认最大
            128 MB）。当 Chunk 超过阈值时自动分裂。Balancer 进程在后台将
            Chunk 从”重”的分片迁移到”轻”的分片，目标是各分片的 Chunk
            数量大致相等。
            
- 

**Jumbo Chunk
            问题**。如果大量文档的分片键值相同，它们会被聚集在同一个
            Chunk 中且无法分裂（因为分裂要求 Chunk
            内至少有两个不同的分片键值）。这种”超大块”（Jumbo
            Chunk）会导致该分片数据倾斜且无法通过均衡器迁移。避免 Jumbo
            Chunk 的关键是选择高基数（High
            Cardinality）的分片键。
            
            

### 8.5 实际系统分片策略对比

            
            
            
            
            
            
            
            
            
            
            维度
            Cassandra
            TiKV
            Kafka
            MongoDB
            
            
            
            
            分片策略
            一致性哈希 + vnode
            范围分片
            固定分区 + 哈希
            范围/哈希可选
            
            
            分片粒度
            token 范围
            Region（144 MB）
            Partition
            Chunk（128 MB）
            
            
            范围查询
            不支持（跨分区 scatter）
            原生支持
            不适用
            范围分片支持
            
            
            自动分裂
            N/A（vnode 固定）
            支持
            不支持
            支持
            
            
            扩容迁移量
            约 1/(N+1)
            按 Region 迁移
            手动再分配
            Balancer 自动
            
            
            元数据管理
            Gossip 协议同步
            PD 集中管理
            Controller 集中
            Config Server
            
            
            热点处理
            key 加盐
            Region 分裂 + Leader 转移
            分区级
            Balancer
            
            
            
            
            

## 九、分片策略选型指南

            

### 9.1 决策树

            

选择分片策略时，可以按以下决策路径思考：
            
```
需要范围查询吗？
├── 是 → 范围分片
│        ├── 数据量增长快、分布不可预测？ → 自动分裂（TiKV 模式）
│        └── 数据分布已知、追求简单？ → 预设固定边界（HBase 模式）
└── 否 → 哈希分片
         ├── 节点拓扑稳定、追求极致性能？ → 跳跃一致性哈希
         ├── 节点需要任意增删、需要权重？ → 会合哈希
         ├── 需要拓扑感知和故障域隔离？ → CRUSH
         └── 通用场景、生态成熟？ → 一致性哈希 + 虚拟节点
```

            

### 9.2 关键权衡维度

            
            
            
            
            
            
            
            
            
            
            
            
            维度
            取模哈希
            一致性哈希
            跳跃哈希
            会合哈希
            范围分片
            CRUSH
            
            
            
            
            实现复杂度
            极低
            中
            低
            低
            高
            高
            
            
            负载均衡
            均匀
            依赖 vnode 数
            完美均匀
            均匀
            依赖边界选择
            依赖权重配置
            
            
            扩容迁移量
            N/(N+1)
            1/(N+1)
            1/(N+1)
            1/(N+1)
            按分片迁移
            接近 1/(N+1)
            
            
            缩容灵活性
            任意
            任意
            仅尾部
            任意
            任意
            任意
            
            
            范围查询
            不支持
            不支持
            不支持
            不支持
            支持
            不支持
            
            
            内存开销
            O(1)
            O(N * vnode)
            O(1)
            O(N)
            O(分片数)
            O(拓扑节点数)
            
            
            拓扑感知
            无
            有限
            无
            无
            无
            原生支持
            
            
            异构权重
            不支持
            vnode 近似
            不支持
            原生支持
            不直接相关
            原生支持
            
            
            
            

### 9.3 工程建议

            

**大多数场景下，一致性哈希 +
            虚拟节点是最稳妥的选择**。它的生态最成熟，各种语言都有生产级实现，运维经验也最丰富。虚拟节点数推荐从
            16-32 开始，根据实际的负载均衡效果再调整。
            

**如果系统的核心查询模式是范围扫描，范围分片是唯一的选择**。此时要重点关注分片键的设计——避免单调递增、确保高基数、考虑查询模式和写入模式的平衡。TiKV
            的自动分裂合并模式在大多数场景下比手动预分区更省心，但需要一个可靠的调度中心（PD）。
            

**跳跃一致性哈希适合内部基础设施组件**。它的实现简单、性能极好、负载完美均匀，非常适合用在代理层、负载均衡器、缓存路由这类场景。但前提是你的节点拓扑相对稳定，不需要频繁下线中间节点。
            

**CRUSH
            适合大规模存储集群**。当集群规模达到数百上千个节点、需要跨机架跨数据中心的故障域隔离、且硬件配置不一致时，CRUSH
            的拓扑感知和权重机制能体现出价值。但它的运维门槛也最高——CRUSH
            Map 的维护、PG
            数量的规划、回填速率的控制，每一项都需要经验积累。
            

### 9.4
            一个完整的实践案例：为订单系统选择分片策略

            

假设我们要为一个日订单量千万级的电商系统设计分片方案。核心表是订单表，包含以下字段：
            
```
CREATE TABLE orders (
    order_id    BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    shop_id     BIGINT NOT NULL,
    order_time  TIMESTAMP NOT NULL,
    total_amount DECIMAL(12,2),
    status      TINYINT,
    -- 其他字段省略
);
```

            

查询模式分析：
            
            
            
            查询场景
            频率
            模式
            
            
            
            
            用户查看自己的订单列表
            极高
            按 user_id 点查 + 按 order_time 排序
            
            
            商家查看店铺订单
            高
            按 shop_id 点查 + 按 order_time 排序
            
            
            按订单号查询
            高
            按 order_id 点查
            
            
            按时间范围统计
            低
            按 order_time 范围扫描
            
            
            
            

分片键的选择：
            

**方案 A：按 order_id 哈希分片**。order_id
            的基数最高，分布最均匀。但用户查询自己的订单需要扫描所有分片（scatter-gather），对用户侧查询不友好。
            

**方案 B：按 user_id
            哈希分片**。用户查询自己的订单只需要访问一个分片，非常高效。但大卖家的订单会集中在一个分片，产生数据倾斜。商家查询店铺订单也需要扫描所有分片。
            

**方案 C：按 user_id 哈希分片 + 二级索引表按
            shop_id 分片**。主表按 user_id
            分片解决用户侧查询，另建一张索引表按 shop_id
            分片解决商家侧查询。代价是维护两份数据的一致性。
            

实际工程中方案 C
            是最常见的选择。分片键的选择本质上是在回答”最高频的查询模式是什么”这个问题。如果无法用一个分片键同时满足所有查询模式，就需要通过冗余数据（二级索引表、物化视图）来弥补。
            

分片数量的计算：
            
```
每日新增订单：10,000,000
单条订单大小：约 500 字节
每日数据增量：10,000,000 × 500 B ≈ 5 GB
保留 3 年数据：5 GB × 365 × 3 ≈ 5.5 TB
预留 2 倍余量：5.5 TB × 2 = 11 TB

单分片目标容量：50-100 GB（兼顾查询性能和运维粒度）
分片数量：11 TB / 100 GB ≈ 110 → 取 128（2 的幂次，便于取模）
```

            

128 个分片分布在 16-32 个物理节点上，每个节点承载 4-8
            个分片。使用一致性哈希将 user_id 映射到 128
            个分片，每个分片内部按 order_time 排序存储。
            

扩容规划：当数据量接近单分片容量上限时，可以将分片数从
            128 扩展到
            256。如果使用一致性哈希做分片路由，扩容时只需迁移约一半的数据；如果使用取模哈希且分片数翻倍（2
            的幂次扩容），可以利用”翻倍取模”的特性——每个旧分片的数据恰好分裂到两个新分片中，迁移逻辑简单且迁移量恰好是
            50%。这也是实际工程中分片数常选择 2 的幂次的原因之一。
            

完整的路由逻辑：
            
```
import hashlib

NUM_SHARDS = 128

def get_shard(user_id: int) -> int:
    """根据 user_id 计算分片编号"""
    key = str(user_id).encode()
    digest = hashlib.md5(key).hexdigest()
    return int(digest, 16) % NUM_SHARDS

def get_node(shard_id: int, shard_to_node: dict[int, str]) -> str:
    """根据分片编号查找物理节点"""
    return shard_to_node[shard_id]

# 使用示例
shard = get_shard(user_id=123456)
node = get_node(shard, shard_to_node={0: "node-01", 1: "node-01", 2: "node-02", ...})
```

            
            

## 十、参考文献

            

### 论文

            
            
- David Karger et al., “Consistent Hashing and Random
            Trees: Distributed Caching Protocols for Relieving Hot Spots
            on the World Wide Web”, ACM STOC, 1997 ——
            一致性哈希的原始论文，提出了哈希环和虚拟节点的基本思想
            
- John Lamping, Eric Veach, “A Fast, Minimal Memory,
            Consistent Hash Algorithm”, arXiv:1406.2294, 2014 ——
            跳跃一致性哈希的论文，证明了 O(1) 内存和 O(ln N)
            时间的理论最优性
            
- David Thaler, Chinya Ravishankar, “Using Name-Based
            Mappings to Increase Hit Rates”, IEEE/ACM Transactions on
            Networking, 1998 —— 会合哈希（HRW）的原始论文
            
- Sage Weil et al., “CRUSH: Controlled, Scalable,
            Decentralized Placement of Replicated Data”, SC’06, 2006 ——
            CRUSH 算法的论文，详细描述了 Ceph 的数据放置策略
            
- Sage Weil, “Ceph: Reliable, Scalable, and
            High-Performance Distributed Storage”, PhD Thesis, UC Santa
            Cruz, 2007 —— Weil 的博士论文，包含 CRUSH 的完整推导和 Ceph
            架构设计
            
            

### 官方文档与技术资料

            
            
- Apache Cassandra Documentation: Architecture —
            Partitioners — 分区器的实现细节和 num_tokens 配置建议
            
- TiKV Documentation: Region — Region
            的分裂、合并和调度机制
            
- Apache Kafka Documentation: Partitioning — 分区策略和
            DefaultPartitioner 行为说明
            
- MongoDB Manual: Sharding — 分片架构、分片键选择和 Chunk
            管理
            
- Ceph Documentation: CRUSH Maps — CRUSH Map
            的配置、放置规则和桶类型说明
            
            

### 源码参考

            
            
- Cassandra
            `Murmur3Partitioner`：`org.apache.cassandra.dht.Murmur3Partitioner`
            —— 默认分区器的实现
            
- TiKV Region
            分裂逻辑：`components/raftstore/src/store/worker/split_check.rs`
            —— 分裂检查的核心代码
            
- Kafka
            `DefaultPartitioner`：`org.apache.kafka.clients.producer.internals.DefaultPartitioner`
            —— 默认分区策略的实现
            
- Ceph CRUSH 算法：`src/crush/mapper.c` ——
            CRUSH 的 C 实现，包含 `straw2` 选择算法
            
            
            

**上一篇**: 对象存储性能工程
            **下一篇**: 副本与复制策略
        

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