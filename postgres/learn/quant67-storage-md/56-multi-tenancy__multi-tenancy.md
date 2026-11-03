# 【存储工程】多租户存储隔离

来源: https://quant67.com/post/storage/56-multi-tenancy/multi-tenancy.html
日期: 2025-10-04 |

---

一个存储集群同时服务多个租户（Tenant），是公有云、私有云和企业级平台的常态。数据库团队要跑在线事务，大数据团队要跑批量分析，AI
            团队要灌训练数据——它们共享同一套 Ceph
            集群或对象存储。问题随之而来：某个租户跑了一次全表扫描，其他租户的延迟立刻飙升；一个租户写满了磁盘，整个集群不可用；运维人员误操作删了另一个租户的桶，事后无法追责。
            

多租户存储隔离（Multi-Tenant Storage
            Isolation）要解决的核心问题是：在共享物理资源的前提下，让每个租户获得可预测的性能、独立的容量边界、严格的权限隔离和可审计的操作记录。这不是单一技术能解决的，而是配额管理、QoS
            调度、访问控制、加密隔离和审计日志的组合工程。
            

本文从隔离模型开始，逐一拆解配额、QoS、噪音邻居、RBAC、加密和审计的设计与实现，最后给出
            Ceph 和 MinIO 两个实战配置。
            
            

**版本说明** 本文涉及的软件版本：Ceph
            18.x（Reef）、MinIO RELEASE.2024-06-xx、Linux 6.x
            内核。不同版本的配置项和默认值可能存在差异，涉及版本差异的地方会单独标注。
            
            
            

## 一、多租户存储的工程挑战

            

### 1.1 共享带来的根本矛盾

            

多租户存储的核心矛盾是资源共享与隔离保证之间的冲突。共享的好处很直接：提高资源利用率、降低运维成本、简化部署架构。但共享也意味着一个租户的行为会影响另一个租户的体验。
            

这个矛盾在存储层尤其突出，原因有三：
            

第一，存储 I/O 的延迟对干扰极其敏感。一块 NVMe
            固态硬盘（SSD）的 4K 随机读延迟通常在 100
            微秒左右，但一旦有大量顺序写入抢占了设备队列，随机读延迟可以飙升到毫秒级——涨了
            10 倍以上。
            

第二，存储容量是硬性约束。CPU
            和内存超卖后最坏情况是变慢，但磁盘写满后的后果是数据丢失或服务中断。
            

第三，存储数据具有持久性。一次误删或越权访问造成的损失是永久的，不像内存数据可以重新计算。
            

### 1.2 隔离的五个维度

            

一个完整的多租户存储隔离方案需要覆盖五个维度：
            
            
            
            维度
            问题
            对应机制
            
            
            
            
            容量隔离
            一个租户写满磁盘，其他租户无法写入
            配额管理（Quota）
            
            
            性能隔离
            一个租户的 I/O 风暴影响其他租户延迟
            QoS 调度
            
            
            访问隔离
            一个租户能读写另一个租户的数据
            RBAC / 权限模型
            
            
            数据隔离
            一个租户的数据在物理层面可被另一个租户读取
            加密隔离
            
            
            操作隔离
            误操作或恶意操作无法追踪和追责
            审计日志
            
            
            
            

这五个维度缺一不可。只做了 RBAC
            但没做配额，一个租户就能耗尽整个集群的容量；只做了配额但没做
            QoS，一个租户就能用高 IOPS（Input/Output Operations Per
            Second）拖垮整条链路。
            

### 1.3 隔离强度的光谱

            

隔离不是非黑即白的。从弱到强，大致可以分成这几个级别：
            
            
- **逻辑隔离**：同一个存储池，通过命名空间（Namespace）或前缀区分租户数据。隔离靠软件策略，物理上完全共享。
            
- **资源隔离**：同一个集群，但为每个租户分配独立的存储池或独立的
            OSD（Object Storage
            Daemon）子集。性能干扰被限制在池级别。
            
- **物理隔离**：每个租户使用独立的集群。隔离最强，成本最高，运维复杂度也最高。
            
            

实际工程中，绝大多数场景选择逻辑隔离加资源隔离的混合方案，只有合规要求极高的场景（如金融监管数据、医疗隐私数据）才使用物理隔离。
            
            

## 二、隔离模型（共享集群/独占池/混合）

            

### 2.1 共享集群模型

            

共享集群模型（Shared
            Cluster）是最简单的多租户方案：所有租户的数据写入同一个存储池，通过逻辑标识（租户
            ID、命名空间、桶前缀）区分归属。
            
```
+--------------------------------------------------+
|                   共享存储集群                      |
|  +----------+  +----------+  +----------+        |
|  | OSD 0    |  | OSD 1    |  | OSD 2    |  ...   |
|  | 租户A数据 |  | 租户B数据 |  | 租户A数据 |        |
|  | 租户C数据 |  | 租户A数据 |  | 租户C数据 |        |
|  +----------+  +----------+  +----------+        |
+--------------------------------------------------+
```

            

优点：资源利用率最高、运维最简单、扩缩容对所有租户统一生效。
            

缺点：性能隔离基本不存在，一个租户的大量写入会抢占磁盘带宽和设备队列，直接影响其他租户的延迟。容量隔离依赖软件层面的配额限制，如果配额策略有漏洞，一个租户就能写满整个集群。
            

适用场景：内部开发测试环境、租户间信任度高且负载可预测的场景。
            

### 2.2 独占池模型

            

独占池模型（Dedicated
            Pool）为每个租户分配独立的存储池（Pool），每个池绑定特定的
            OSD 子集。通过 CRUSH 规则（Controlled Replication Under
            Scalable
            Hashing）控制数据放置，让不同租户的数据落在不同的物理磁盘上。
            
```
graph TB
    subgraph "存储集群"
        subgraph "租户 A 池"
            OSD0["OSD 0"]
            OSD1["OSD 1"]
            OSD2["OSD 2"]
        end
        subgraph "租户 B 池"
            OSD3["OSD 3"]
            OSD4["OSD 4"]
            OSD5["OSD 5"]
        end
        subgraph "租户 C 池"
            OSD6["OSD 6"]
            OSD7["OSD 7"]
            OSD8["OSD 8"]
        end
    end
```

            

上图展示了独占池模型的基本结构：每个租户的池绑定独立的
            OSD 子集，数据在物理层面隔离。
            

优点：性能隔离较好，一个租户的 I/O
            不会直接影响其他租户的磁盘；容量隔离天然存在，每个池的容量就是该租户的容量上限。
            

缺点：资源利用率低——租户 A 的池空闲时，租户 B
            无法借用这些 OSD
            的容量和带宽；扩缩容需要按租户单独操作，运维复杂度高；OSD
            数量必须足够多，否则无法为每个租户分出独立的子集。
            

适用场景：租户数量有限、负载差异大、对性能隔离要求高的企业私有云。
            

### 2.3 混合模型

            

混合模型（Hybrid）在实践中最常见：默认使用共享池，对高优先级租户或合规要求高的租户分配独占池。
            
```
+--------------------------------------------------+
|                   存储集群                         |
|  +--------------------+  +--------------------+  |
|  |   共享池            |  |   独占池（租户 A）   |  |
|  |   租户 B、C、D 共享  |  |   仅租户 A 使用     |  |
|  |   OSD 0, 1, 2, 3   |  |   OSD 4, 5, 6      |  |
|  +--------------------+  +--------------------+  |
+--------------------------------------------------+
```

            

共享池内部通过配额和 QoS
            做租户间隔离，独占池通过物理分离保证关键租户不受干扰。这个模型在资源利用率和隔离强度之间取得了平衡。
            

### 2.4 三种模型对比

            
            
            
            维度
            共享集群
            独占池
            混合模型
            
            
            
            
            资源利用率
            高
            低
            中
            
            
            性能隔离
            弱
            强
            可选
            
            
            容量隔离
            依赖配额
            天然隔离
            按池区分
            
            
            运维复杂度
            低
            高
            中
            
            
            扩缩容灵活性
            高
            低
            中
            
            
            适用租户数量
            多
            少
            中
            
            
            典型场景
            开发测试、SaaS
            金融、医疗
            企业私有云
            
            
            
            

选择哪种模型取决于两个核心变量：租户的隔离要求（合规、SLA）和集群的硬件规模（OSD
            数量是否足以分池）。如果集群只有 12 块 OSD，硬分成 4
            个独占池每池 3 块
            OSD，既无法保证副本放置的多样性，也没有扩展余量——这种情况下共享池加
            QoS 是更务实的选择。
            
            

## 三、配额管理（容量/IOPS/带宽配额）

            

### 3.1 配额的三个维度

            

配额管理（Quota
            Management）是多租户隔离的第一道防线。一个完整的配额体系需要覆盖三个维度：
            
            
- **容量配额**：限制租户可使用的存储空间总量，防止一个租户耗尽集群容量。
            
- **IOPS 配额**：限制租户每秒的 I/O
            操作次数，防止一个租户用大量小 I/O 抢占设备队列。
            
- **带宽配额**：限制租户每秒的数据传输量，防止一个租户用大块顺序
            I/O 占满磁盘带宽。
            
            

三个维度必须同时存在。只限容量不限 IOPS，一个租户可以用 1
            TB 配额跑出 100 万 IOPS 拖垮整个集群；只限 IOPS
            不限带宽，一个租户可以用少量大块 I/O 吃光网络带宽。
            

### 3.2 容量配额的实现

            

容量配额的实现相对直接：维护每个租户的已用空间计数，写入前检查是否超过限额。
            

在 Ceph 中，可以通过 Pool Quota 或 RGW（RADOS
            Gateway）用户配额实现：
            
```
# Ceph Pool 级别配额：限制池最大容量为 500 GB
ceph osd pool set-quota tenant-a-pool max_bytes 536870912000

# Ceph Pool 级别配额：限制池最大对象数为 100 万
ceph osd pool set-quota tenant-a-pool max_objects 1000000
```

            

在 MinIO 中，通过桶配额（Bucket Quota）实现：
            
```
# MinIO 设置桶的硬配额为 100 GB
mc admin bucket quota myminio/tenant-a-bucket --hard 100GB
```

            

容量配额有两种模式：
            
            
- **硬配额（Hard
            Quota）**：超过限额后拒绝新的写入请求，返回错误。
            
- **软配额（Soft
            Quota）**：超过限额后发出告警，但不阻止写入。
            
            

生产环境通常两者结合使用：软配额设为硬配额的
            80%，触发告警提醒租户清理数据；硬配额作为最后防线，防止集群被写满。
            

### 3.3 IOPS
            和带宽配额的实现

            

IOPS
            和带宽配额的实现比容量配额复杂，因为它们是速率限制，涉及时间窗口和突发处理。
            

常见的实现方式是令牌桶算法（Token
            Bucket）：每个租户维护一个令牌桶，按配额速率持续填充令牌，每次
            I/O 消耗对应数量的令牌。桶中没有令牌时，I/O
            请求被排队或拒绝。这部分细节在下一节 QoS 调度中展开。
            

在 Ceph 中，OSD 级别的 QoS 通过 `mclock`
            调度器实现（Ceph Reef 版本默认启用）。mclock 支持为每个 QoS
            类别（client、recovery、background）设置 IOPS
            的预留值（Reservation）、权重（Weight）和上限值（Limit）。
            

在 Linux 内核层面，可以通过 blk-throttle 为 cgroup 设置
            IOPS 和带宽限制：
            
```
# 为 cgroup 设置 IOPS 上限：读 5000 IOPS，写 3000 IOPS
echo "8:0 riops=5000 wiops=3000" > \
    /sys/fs/cgroup/io.max

# 为 cgroup 设置带宽上限：读 200 MB/s，写 100 MB/s
echo "8:0 rbps=209715200 wbps=104857600" > \
    /sys/fs/cgroup/io.max
```

            

### 3.4 配额的层次结构

            

一个实际的多租户系统中，配额往往是分层的：
            
```
组织配额（Organization Quota）
  └── 项目配额（Project Quota）
       └── 桶配额（Bucket Quota）
            └── 用户配额（User Quota）
```

            

层次配额的规则是：子级配额之和不能超过父级配额。组织配额
            1 TB，下面三个项目各分 500
            GB，那就需要超分（Overcommit）策略——类似内存超卖，允许子级配额之和大于父级配额，但实际使用量之和不能超过父级。
            

超分策略需要配合监控和告警：当组织的实际使用量接近配额上限时，系统需要能够拒绝新的写入，即使某个项目还没有用完自己的配额。
            

### 3.5 配额执行的一致性问题

            

分布式系统中，配额执行面临一致性挑战。如果配额检查在客户端做，多个客户端并发写入时可能超过限额；如果配额检查在服务端集中做，服务端就成了瓶颈。
            

常见的折中方案是租约（Lease）机制：
            
            
- 中心节点维护全局配额和已用量。
            
- 每个客户端节点向中心节点申请一个本地配额租约，例如”本地可用
            10 GB”。
            
- 客户端在本地配额租约范围内不需要与中心节点通信，直接允许写入。
            
- 本地配额用尽后，向中心节点申请新的租约。
            
- 中心节点定期回收未使用的租约，重新分配给其他客户端。
            
            

这个方案的代价是配额执行不精确：全局已用量可能在短时间内超过限额，超出量等于所有未用完的本地租约之和。对于容量配额，这通常可以接受——差个几
            GB 不影响大局。但对于 IOPS
            和带宽配额，本地租约的粒度需要更细。
            
            

## 四、QoS
            调度（令牌桶/优先级队列/公平调度）

            

### 4.1 QoS 的目标

            

服务质量（Quality of
            Service）调度是性能隔离的核心机制。它要解决的问题是：在总
            I/O 能力有限的情况下，如何公平或按优先级分配 I/O
            资源给不同的租户。
            

QoS 调度需要满足三个属性：
            
            
- **预留（Reservation）**：每个租户有一个最低保证的
            IOPS 或带宽。即使集群满载，预留量也必须得到满足。
            
- **上限（Limit）**：每个租户有一个最大允许的
            IOPS 或带宽。即使集群空闲，租户也不能超过上限。
            
- **权重（Weight）**：集群有富余能力时，按权重比例分配给各租户。
            
            

### 4.2 令牌桶算法

            

令牌桶（Token
            Bucket）是实现速率限制最常用的算法。它的工作原理如下：
            
```
令牌桶模型：

  令牌生成速率 r（令牌/秒）
       |
       v
  +----------+
  | 令牌桶    |  容量 b（突发上限）
  | ●●●●●●●  |
  | ●●●●●    |
  +----------+
       |
       v
  I/O 请求消耗令牌
  - 桶中有令牌 → 放行，消耗令牌
  - 桶中无令牌 → 排队或拒绝
```

            

令牌桶有两个参数：
            
            
- **速率 r**：每秒生成的令牌数，对应 IOPS
            或带宽配额。
            
- **桶深度
            b**：桶最多能存放的令牌数，对应允许的突发量（Burst）。
            
            

假设一个租户的 IOPS 配额是 1000，桶深度是
            200。如果该租户空闲了 0.2 秒，桶中积累了 200
            个令牌。此时它可以一次性发出 200 个
            I/O（突发），之后回到每秒 1000 的速率。
            

令牌桶的实现很简洁。以下是一个 Go
            语言的简化实现，用于说明核心逻辑：
            
```
package ratelimit

import (
    "sync"
    "time"
)

// TokenBucket 实现一个基本的令牌桶速率限制器
type TokenBucket struct {
    mu       sync.Mutex
    rate     float64   // 令牌生成速率（令牌/秒）
    burst    float64   // 桶深度（最大令牌数）
    tokens   float64   // 当前令牌数
    lastTime time.Time // 上次令牌计算时间
}

// NewTokenBucket 创建一个令牌桶
// rate: 每秒生成的令牌数
// burst: 桶深度，即最大突发量
func NewTokenBucket(rate float64, burst float64) *TokenBucket {
    return &TokenBucket{
        rate:     rate,
        burst:    burst,
        tokens:   burst, // 初始填满
        lastTime: time.Now(),
    }
}

// Allow 判断是否允许消耗 n 个令牌
// 返回 true 表示放行，false 表示令牌不足
func (tb *TokenBucket) Allow(n float64) bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(tb.lastTime).Seconds()
    tb.lastTime = now

    // 补充令牌
    tb.tokens += elapsed * tb.rate
    if tb.tokens > tb.burst {
        tb.tokens = tb.burst
    }

    // 检查令牌是否足够
    if tb.tokens >= n {
        tb.tokens -= n
        return true
    }
    return false
}
```

            

### 4.3 优先级队列

            

令牌桶解决了单个租户的速率限制，但没有解决多个租户之间的调度问题。当多个租户的
            I/O 请求同时到达时，谁先被服务？
            

优先级队列（Priority
            Queue）是一种简单的调度策略：为每个租户或每类 I/O
            分配优先级，高优先级的请求先被处理。
            
```
优先级队列调度：

  高优先级（在线事务）  →  [请求 A] [请求 B]  →  先处理
  中优先级（分析查询）  →  [请求 C] [请求 D]  →  次处理
  低优先级（批量导入）  →  [请求 E] [请求 F]  →  最后处理
                                                    ↓
                                               存储设备
```

            

优先级队列的问题是饥饿（Starvation）：如果高优先级请求源源不断，低优先级请求永远得不到服务。解决方案是为每个优先级设置最低服务速率（预留值），确保低优先级至少能获得一定比例的
            I/O 能力。
            

### 4.4 加权公平队列

            

加权公平队列（Weighted Fair
            Queuing，WFQ）是兼顾公平性和差异化的调度算法。每个租户分配一个权重，调度器按权重比例分配
            I/O 带宽。
            

假设三个租户的权重分别是 4、2、1，集群总 IOPS 为
            7000。空闲时每个租户都可以跑满自己的上限，但集群满载时，三个租户分别获得
            4000、2000、1000 IOPS。
            

WFQ 的核心思想是虚拟时间（Virtual
            Time）：每个租户维护一个虚拟时间戳，每完成一次
            I/O，虚拟时间戳按 `1/权重`
            递增。调度器始终选择虚拟时间戳最小的租户的请求来服务。权重越大，虚拟时间递增越慢，获得服务的机会就越多。
            

### 4.5 dmclock 调度算法

            

Ceph 从 Reef 版本开始在 OSD 层面默认启用 mClock
            调度器。mClock 是 dmclock 算法的 Ceph 实现，来源于 VMware
            Research 的论文（Gulati et al., “mclock: Handling Throughput
            Variability for Hypervisor IO Scheduling”, OSDI 2010）。
            

dmclock
            的核心思想是为每个客户端同时维护三个属性：预留（R）、权重（W）和上限（L）。调度决策分两个阶段：
            
            
- **预留阶段**：扫描所有客户端，如果某个客户端的服务速率低于其预留值，优先服务它。
            
- **权重阶段**：预留都满足后，剩余能力按权重分配，但不超过各客户端的上限。
            
            

这个两阶段设计同时解决了优先级队列的饥饿问题和简单公平队列缺乏差异化的问题。
            

### 4.6 QoS 调度的实际考量

            

在实际系统中，QoS 调度还需要考虑以下问题：
            

**调度粒度**：在哪一层做调度？客户端层（Gateway）、中间层（MDS/Monitor）还是存储层（OSD）？越靠近存储层，调度越精确但开销越大。Ceph
            mClock 在 OSD 层面调度，直接控制磁盘 I/O 的发送顺序。
            

**I/O 大小归一化**：一个 4 KB 的 I/O 和一个
            4 MB 的 I/O 对磁盘的消耗完全不同，但在 IOPS 计数上都是
            1。合理的做法是把大 I/O 按标准块大小（如 4 KB）换算成等价
            IOPS，或者直接用带宽而非 IOPS 作为调度单位。
            

**延迟 vs
            吞吐量**：令牌桶和公平队列主要控制吞吐量（IOPS/带宽），但租户更关心的往往是延迟。吞吐量限制可以防止一个租户用掉过多资源，但不能保证延迟——一个
            I/O
            可能在队列中排了很久才被服务。延迟保证需要更复杂的调度算法，如基于
            deadline 的调度。
            
            

## 五、噪音邻居问题（检测与缓解）

            

### 5.1 什么是噪音邻居

            

噪音邻居（Noisy
            Neighbor）是多租户系统中最常见的性能问题：一个租户的高负载行为导致同一物理资源上其他租户的性能下降。
            

在存储场景中，噪音邻居的典型表现：
            
            
- 租户 A
            做大规模数据导入，产生连续的顺序写入，抢占了磁盘的写入带宽和设备队列深度。
            
- 租户 B 的在线事务请求（小块随机读写）延迟从 200
            微秒飙升到 5 毫秒。
            
- 租户 B 的用户感知到”系统变慢了”，但从租户 B
            自己的监控看，I/O 量并没有增加。
            
            

根本原因是存储设备（磁盘、SSD）是排他性资源：同一块磁盘在同一时刻只能服务一个
            I/O 请求。设备内部的队列深度有限（NVMe SSD 通常 64-1024
            个队列条目），一旦被大量请求填满，新请求的等待时间就会急剧增加。
            

### 5.2 噪音邻居的检测

            

检测噪音邻居需要关联两类数据：
            

**受害者侧指标**：某个租户的 I/O
            延迟异常升高，但自身的 I/O
            提交速率没有变化。这是典型的被干扰信号——延迟升高不是因为自己负载增加，而是因为底层资源被别人抢占了。
            

**制造者侧指标**：某个租户的 IOPS
            或带宽突然飙升，远超其历史基线或配额。
            

检测算法的基本逻辑：
            
```
# 噪音邻居检测伪代码

def detect_noisy_neighbor(metrics: dict, window_sec: int = 60):
    """
    metrics 结构:
    {
        tenant_id: {
            "iops": [...],       # 时间序列
            "latency_p99": [...],
            "bandwidth": [...]
        }
    }
    """
    victims = []
    suspects = []

    for tenant_id, data in metrics.items():
        avg_latency = mean(data["latency_p99"][-window_sec:])
        baseline_latency = mean(data["latency_p99"][-3600:-window_sec])
        avg_iops = mean(data["iops"][-window_sec:])
        baseline_iops = mean(data["iops"][-3600:-window_sec])

        # 延迟飙升但自身负载未增加 → 受害者
        if avg_latency > baseline_latency * 3 and avg_iops  baseline_iops * 5:
            suspects.append(tenant_id)

    return victims, suspects
```

            

这段逻辑只是检测的起点。实际系统中还需要结合拓扑信息（受害者和嫌疑制造者是否在同一组
            OSD 上）来确认因果关系。
            

### 5.3 噪音邻居的缓解策略

            

检测到噪音邻居后，缓解策略从温和到激进依次有：
            

**1. 降速（Throttle）**：对制造者的 I/O
            速率施加临时限制。这是最常用的手段，通过动态调整令牌桶的速率参数实现。
            

**2. 队列隔离**：将制造者的 I/O
            请求调度到低优先级队列。不直接拒绝请求，但降低其被服务的优先级，让受害者的请求先得到处理。
            

**3.
            数据迁移**：将制造者或受害者的数据迁移到不同的 OSD
            子集，从物理层面消除干扰。这是最有效但成本最高的手段——数据迁移本身就会产生
            I/O 负载。
            

**4. 弹性扩容**：如果集群整体能力不足，增加
            OSD 节点分摊负载。
            

在实践中，这四种策略通常组合使用：先用降速缓解燃眉之急，然后评估是否需要做数据迁移或扩容。
            

### 5.4 预防优于检测

            

比起事后检测，更有效的做法是在架构层面预防噪音邻居：
            
            
- **入口限速**：在网关层对每个租户的请求速率做硬限制，确保超额请求在进入存储集群之前就被拦截。
            
- **I/O 分类**：将批量
            I/O（如数据导入、压缩、垃圾回收）与在线
            I/O（如用户请求）分到不同的队列，给在线 I/O
            更高的优先级。
            
- **容量规划**：集群总 IOPS
            能力应留有余量（通常建议峰值利用率不超过
            70%），为突发负载留出缓冲空间。
            
            
            

## 六、存储级
            RBAC（权限模型设计）

            

### 6.1 为什么需要存储级
            RBAC

            

基于角色的访问控制（Role-Based Access
            Control，RBAC）在应用层面已经很普遍，但存储层面的 RBAC
            有其特殊需求。
            

应用层 RBAC 控制的是”用户能调用哪个 API”，存储层 RBAC
            控制的是”这个身份能读写哪些桶、哪些对象、哪些路径”。两者的区别在于：
            
            
- 存储层的访问主体不仅是人，还有服务账号（Service
            Account）、应用进程、CI/CD 流水线。
            
- 存储层的操作粒度更细——不仅区分读和写，还要区分列举（List）、删除（Delete）、设置生命周期策略（Lifecycle）、修改
            ACL 等操作。
            
- 存储层的对象数量可能极大（百亿级），无法为每个对象单独设置权限，必须依赖基于路径前缀或标签的规则。
            
            

### 6.2 权限模型设计

            

一个典型的存储级 RBAC 模型包含以下实体：
            
```
身份（Identity）
  └── 角色（Role）
       └── 策略（Policy）
            └── 规则（Statement）
                 ├── 效果（Effect）: Allow / Deny
                 ├── 操作（Action）: GetObject, PutObject, DeleteObject, ...
                 └── 资源（Resource）: bucket/prefix/*
```

            

这个结构和 AWS IAM（Identity and Access
            Management）策略高度相似，因为 S3
            兼容的对象存储基本都采用了这套模型。
            

一个策略示例：
            
```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::tenant-a-bucket/data/*"
    },
    {
      "Effect": "Deny",
      "Action": [
        "s3:DeleteObject",
        "s3:DeleteBucket"
      ],
      "Resource": "arn:aws:s3:::tenant-a-bucket/*"
    }
  ]
}
```

            

这个策略允许对 `tenant-a-bucket/data/`
            前缀下的对象进行读写，但禁止删除任何对象和桶。
            

### 6.3 多租户 RBAC
            的常见角色

            
            
            
            角色
            权限范围
            典型操作
            
            
            
            
            租户管理员
            本租户所有桶和对象
            创建/删除桶、管理用户、设置策略
            
            
            开发者
            本租户指定桶
            读写对象、列举对象
            
            
            只读用户
            本租户指定前缀
            读取对象、列举对象
            
            
            CI/CD 服务账号
            本租户构建桶
            上传构建产物、读取依赖
            
            
            审计员
            本租户所有桶（只读）
            读取对象、读取审计日志
            
            
            平台管理员
            所有租户所有桶
            管理配额、查看用量、处理工单
            
            
            
            

### 6.4 权限评估逻辑

            

当一个请求到达时，权限评估遵循以下逻辑：
            
```
flowchart TD
    A["收到请求"] --> B{"是否有显式 Deny？"}
    B -- 是 --> C["拒绝请求"]
    B -- 否 --> D{"是否有显式 Allow？"}
    D -- 是 --> E["允许请求"]
    D -- 否 --> F["默认拒绝"]
```

            

上图展示了权限评估的基本流程：显式拒绝优先于显式允许，未匹配任何规则时默认拒绝（Deny
            by Default）。
            

关键原则：
            
            
- **默认拒绝**：没有匹配到任何 Allow
            规则的请求一律拒绝。
            
- **显式拒绝优先**：如果同时匹配了 Allow 和
            Deny 规则，Deny 优先。
            
- **最小权限**：只授予完成任务所需的最小权限集。
            
            

### 6.5 跨租户访问控制

            

有时租户之间需要共享特定数据——例如租户 A
            的分析结果需要被租户 B 读取。跨租户访问有两种实现方式：
            

**桶策略（Bucket
            Policy）**：在桶级别设置跨账户访问策略，明确允许另一个租户的特定身份访问。
            
```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::tenant-b:user/analyst"},
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::tenant-a-shared/reports/*"
    }
  ]
}
```

            

**预签名 URL（Presigned
            URL）**：生成一个有时效的 URL，持有该 URL
            的任何人都可以访问指定对象。适合临时分享，不适合长期访问。
            

两种方式各有适用场景：桶策略适合长期、稳定的跨租户访问关系；预签名
            URL 适合临时、一次性的数据共享。
            
            

## 七、加密隔离（租户级密钥管理）

            

### 7.1 为什么逻辑隔离不够

            

RBAC
            提供的是逻辑隔离：通过权限策略阻止未授权的访问。但逻辑隔离有两个盲区：
            
            
- **存储介质层面**：如果攻击者获得了物理磁盘（如报废回收时未彻底擦除），RBAC
            无法保护磁盘上的明文数据。
            
- **运维人员层面**：平台管理员有权限访问底层存储，RBAC
            无法阻止管理员直接读取租户数据。
            
            

加密隔离（Encryption
            Isolation）解决的就是这两个问题：即使获得了物理介质或管理员权限，没有租户的密钥也无法解密数据。
            

### 7.2 加密层次

            

存储加密可以在不同层次实现：
            
            
            
            加密层次
            实现位置
            密钥管理者
            对存储系统透明
            
            
            
            
            客户端加密（CSE）
            应用端
            租户自己
            是
            
            
            服务端加密（SSE）
            存储网关
            存储平台或租户
            否
            
            
            磁盘加密（FDE）
            块设备层
            平台运维
            是
            
            
            
            

**客户端加密（Client-Side
            Encryption，CSE）**：租户在上传前自行加密数据，存储系统只看到密文。密钥完全由租户控制，即使存储平台被攻破也无法解密。缺点是存储系统无法对加密数据做服务端索引、压缩或去重。
            

**服务端加密（Server-Side
            Encryption，SSE）**：存储系统在写入磁盘前加密数据，在读取时解密。对客户端透明，支持索引和检索。SSE
            又分两种：
            
            
- **SSE-S3**：存储平台管理密钥。简单但平台管理员可以解密。
            
- **SSE-KMS**：密钥存储在外部密钥管理服务（Key
            Management
            Service，KMS）中，每个租户使用不同的主密钥（Master
            Key）。存储平台在需要时向 KMS 请求数据密钥（Data
            Key），用数据密钥加解密数据，数据密钥用主密钥加密后随数据一起存储。
            
            

**磁盘加密（Full Disk
            Encryption，FDE）**：在块设备层面用 LUKS（Linux
            Unified Key
            Setup）或硬件自加密驱动器（SED）加密整块磁盘。只防止物理介质泄露，不区分租户。
            

### 7.3 租户级密钥管理架构

            

多租户加密隔离的推荐方案是 SSE-KMS
            配合每租户独立主密钥：
            
```
+------------+     +------------+     +------------------+
| 租户 A     |     | 存储网关    |     | KMS              |
| 上传对象    | --> | 请求数据密钥 | --> | 用租户 A 主密钥   |
|            |     | DEK-A      | 
            
- 租户 A 上传对象时，存储网关生成一个随机的数据密钥（Data
            Encryption Key，DEK）。
            
- 网关用 DEK 加密对象数据。
            
- 网关调用 KMS，用租户 A 的主密钥（Master Key）加密
            DEK，得到加密后的 DEK（Encrypted DEK）。
            
- 密文数据和加密后的 DEK 一起写入存储后端。
            
- 读取时，网关从存储后端取出加密后的 DEK，调用 KMS
            解密得到明文 DEK，再用明文 DEK 解密数据。
            
            

这种信封加密（Envelope
            Encryption）的好处是：主密钥永远不离开
            KMS，即使存储后端被攻破，攻击者拿到的只有密文和加密后的
            DEK，没有主密钥就无法解密。
            

### 7.4 密钥轮换

            

密钥轮换（Key
            Rotation）是加密运维的必要操作。轮换分两层：
            

**主密钥轮换**：在 KMS
            中生成新版本的主密钥。已有数据不需要重新加密——它们的 DEK
            仍然用旧版本主密钥解密，只是新写入的数据会用新版本主密钥加密
            DEK。这叫做惰性轮换（Lazy Rotation）。
            

**数据密钥轮换**：如果需要彻底用新密钥保护旧数据，就必须读取旧数据、用旧
            DEK 解密、生成新 DEK
            重新加密、写回。这个操作开销很大，通常只在密钥泄露时才执行。
            

### 7.5 加密对性能的影响

            

加密不是免费的。AES-256-GCM（Advanced Encryption
            Standard）在现代 CPU
            上有硬件加速指令（AES-NI），加解密吞吐量可以达到数
            GB/s，通常不会成为瓶颈。但以下场景需要注意：
            
            
- 每次读写都需要调用 KMS 解密 DEK，KMS 的延迟会叠加到每次
            I/O 上。缓解方案是在网关本地缓存
            DEK，设置合理的过期时间。
            
- 加密后的数据无法利用存储系统的去重和压缩功能（密文看起来是随机数据）。如果需要去重或压缩，必须在加密前执行。
            
            
            

## 八、审计日志（操作追踪与合规）

            

### 8.1 审计日志的作用

            

审计日志（Audit
            Log）记录”谁在什么时间对什么资源做了什么操作，结果是什么”。在多租户存储中，审计日志有三个核心作用：
            
            
- **安全事件调查**：数据泄露或误删后，通过审计日志追溯操作链，定位责任人和时间线。
            
- **合规要求**：金融、医疗、政务等行业的合规标准（如
            SOC
            2、HIPAA、等保三级）明确要求存储操作必须有完整的审计记录。
            
- **异常检测**：通过分析审计日志中的访问模式，检测异常行为（如非工作时间的大量数据下载）。
            
            

### 8.2 审计日志的内容

            

一条完整的存储审计日志至少包含以下字段：
            
```
{
  "timestamp": "2025-10-04T14:23:17.452Z",
  "event_id": "evt-a1b2c3d4",
  "tenant_id": "tenant-a",
  "principal": {
    "type": "user",
    "id": "user-john",
    "ip": "10.0.1.42",
    "user_agent": "aws-sdk-go/1.50.0"
  },
  "action": "s3:PutObject",
  "resource": {
    "bucket": "tenant-a-data",
    "key": "reports/2025/q3-summary.parquet",
    "version_id": "v3"
  },
  "request": {
    "id": "req-x7y8z9",
    "content_length": 15728640,
    "content_type": "application/octet-stream",
    "encryption": "SSE-KMS",
    "kms_key_id": "arn:aws:kms:us-east-1:tenant-a:key/abcd-1234"
  },
  "response": {
    "status": 200,
    "etag": "\"d41d8cd98f00b204e9800998ecf8427e\"",
    "duration_ms": 342
  }
}
```

            

关键字段的设计要点：
            
            
- **tenant_id**：必须包含，用于按租户筛选日志。
            
- **principal**：不仅记录用户
            ID，还要记录来源 IP 和客户端标识，便于排查异常来源。
            
- **action**：使用标准化的操作名称（如 S3 API
            名称），不要用自定义的非标准命名。
            
- **resource**：包含完整的资源路径，包括版本号。
            
- **response**：记录操作结果和耗时，失败请求的日志同样重要。
            
            

### 8.3 审计日志的存储与保护

            

审计日志本身需要被保护，否则攻击者可以通过篡改或删除日志来掩盖痕迹。
            

**不可变存储**：审计日志写入后不可修改和删除。实现方式包括：
            - 使用对象存储的 Object Lock（对象锁定）功能，设置
            WORM（Write Once Read Many）策略。 -
            使用独立的日志存储系统，与主存储集群物理分离，防止管理员同时控制数据和日志。
            

**日志完整性校验**：每条日志记录附带哈希链（Hash
            Chain）——每条记录的哈希值包含前一条记录的哈希值，形成链式结构。篡改任何一条记录都会破坏链的连续性。
            
```
日志完整性链：

  记录 1              记录 2              记录 3
  +--------+         +--------+         +--------+
  | data_1 |    +--> | data_2 |    +--> | data_3 |
  | hash_1 | ---+    | hash_2 | ---+    | hash_3 |
  +--------+         +--------+         +--------+
  hash_1 =           hash_2 =           hash_3 =
  H(data_1)          H(data_2||hash_1)  H(data_3||hash_2)
```

            

**日志保留策略**：合规要求通常规定日志保留期限（如
            SOC 2 要求至少保留 1
            年）。日志保留策略需要和存储成本平衡——审计日志的量可能很大，尤其是对象存储中每个
            GET
            请求都产生一条日志。可以按操作类型分级：写入和删除操作的日志长期保留，读取操作的日志保留较短时间。
            

### 8.4 审计日志的分析

            

审计日志的价值不仅在于事后追溯，还在于实时分析。以下是几个典型的分析场景：
            

**异常访问检测**：统计每个用户的操作频率和时间分布，识别偏离基线的行为。
            
```
# 示例：统计某租户过去一小时内各用户的 DeleteObject 操作次数
# 假设日志以 JSON Lines 格式存储在文件中
cat audit-log-2025-10-04.jsonl | \
    jq -r 'select(.tenant_id == "tenant-a" and .action == "s3:DeleteObject") | .principal.id' | \
    sort | uniq -c | sort -rn | head -10
```

            

**跨租户访问告警**：检测是否有身份试图访问非本租户的资源。
            

**大批量下载检测**：识别短时间内大量
            GetObject 操作，可能是数据泄露的信号。
            
            

## 九、Ceph QoS 配置实战

            

### 9.1 环境说明

            

本节演示在 Ceph Reef（18.x）集群上配置多租户 QoS
            的完整流程。
            

假设集群环境如下： - 3 个 OSD 节点，每节点 4 块 NVMe
            SSD，共 12 个 OSD - 使用 RGW（RADOS Gateway）提供 S3
            兼容接口 -
            两个租户：`tenant-prod`（生产环境，高优先级）和
            `tenant-dev`（开发环境，低优先级）
            

### 9.2 创建租户隔离的存储池

            

首先为两个租户创建独立的存储池，通过 CRUSH
            规则将数据放置在不同的 OSD 子集上：
            
```
# 创建 CRUSH 规则，将数据限制在特定的 OSD 类
# 假设已通过 CRUSH bucket 将 OSD 分为 prod 和 dev 两组
ceph osd crush rule create-replicated rule-prod default host ssd-prod
ceph osd crush rule create-replicated rule-dev default host ssd-dev

# 创建存储池并绑定 CRUSH 规则
ceph osd pool create tenant-prod-pool 64 64 replicated rule-prod
ceph osd pool create tenant-dev-pool 32 32 replicated rule-dev

# 设置副本数
ceph osd pool set tenant-prod-pool size 3
ceph osd pool set tenant-dev-pool size 2

# 启用池的应用标签
ceph osd pool application enable tenant-prod-pool rgw
ceph osd pool application enable tenant-dev-pool rgw
```

            

### 9.3 配置容量配额

            
```
# 生产池配额：2 TB
ceph osd pool set-quota tenant-prod-pool max_bytes 2199023255552

# 开发池配额：500 GB
ceph osd pool set-quota tenant-dev-pool max_bytes 536870912000

# 查看配额设置
ceph osd pool get-quota tenant-prod-pool
ceph osd pool get-quota tenant-dev-pool
```

            

### 9.4 配置 mClock QoS

            

Ceph Reef 默认使用 mClock 调度器。mClock 将 OSD 的 I/O
            分为三类：
            
            
- `client`：前台客户端 I/O
            
- `recovery`：数据恢复 I/O
            
- `background_best_effort`：后台任务（Scrub、深度
            Scrub 等）
            
            

可以通过 mClock
            配置文件为不同类别设置预留、权重和上限：
            
```
# 查看当前 mClock 调度器状态
ceph config get osd osd_op_queue

# 确认使用 mClock 调度器
ceph config set osd osd_op_queue mclock_scheduler

# 使用内置的 QoS 配置模板
# 可选值：high_client_ops（优先客户端）、
#         balanced（平衡）、
#         high_recovery_ops（优先恢复）
ceph config set osd osd_mclock_profile high_client_ops

# 查看 mClock 的各类别参数
ceph config show osd.0 | grep mclock
```

            

`high_client_ops` 配置模板的默认参数如下：
            
            
            
            类别
            预留（Reservation）
            权重（Weight）
            上限（Limit）
            
            
            
            
            client
            50%
            2
            无上限
            
            
            recovery
            25%
            1
            100 IOPS
            
            
            background_best_effort
            25%
            1
            100 IOPS
            
            
            
            

如果默认模板不满足需求，可以自定义参数：
            
```
# 自定义 client 类别的预留值（占 OSD 总 IOPS 的比例）
ceph config set osd osd_mclock_scheduler_client_res 60

# 自定义 recovery 类别的上限值
ceph config set osd osd_mclock_scheduler_client_lim 0
ceph config set osd osd_mclock_scheduler_background_recovery_lim 50

# 自定义权重
ceph config set osd osd_mclock_scheduler_client_wgt 3
ceph config set osd osd_mclock_scheduler_background_recovery_wgt 1
```

            

### 9.5 配置 RGW 用户与配额

            
```
# 创建 RGW 租户用户
radosgw-admin user create \
    --uid="prod-admin" \
    --display-name="Production Admin" \
    --tenant="tenant-prod"

radosgw-admin user create \
    --uid="dev-user" \
    --display-name="Dev User" \
    --tenant="tenant-dev"

# 为租户设置用户级配额
radosgw-admin quota set \
    --quota-scope=user \
    --uid="prod-admin" \
    --tenant="tenant-prod" \
    --max-size=1T \
    --max-objects=10000000

radosgw-admin quota set \
    --quota-scope=user \
    --uid="dev-user" \
    --tenant="tenant-dev" \
    --max-size=200G \
    --max-objects=1000000

# 启用配额
radosgw-admin quota enable \
    --quota-scope=user \
    --uid="prod-admin" \
    --tenant="tenant-prod"

radosgw-admin quota enable \
    --quota-scope=user \
    --uid="dev-user" \
    --tenant="tenant-dev"

# 查看配额状态
radosgw-admin user info --uid="prod-admin" --tenant="tenant-prod"
```

            

### 9.6 配置 RGW
            请求速率限制

            

Ceph RGW 从 Pacific 版本开始支持请求速率限制（Rate
            Limiting）：
            
```
# 启用速率限制功能
radosgw-admin ratelimit enable --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev"

# 设置 dev-user 的读请求速率上限：每秒 500 次
radosgw-admin ratelimit set --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev" \
    --max-read-ops=500

# 设置 dev-user 的写请求速率上限：每秒 200 次
radosgw-admin ratelimit set --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev" \
    --max-write-ops=200

# 设置 dev-user 的读带宽上限：100 MB/s
radosgw-admin ratelimit set --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev" \
    --max-read-bytes=104857600

# 设置 dev-user 的写带宽上限：50 MB/s
radosgw-admin ratelimit set --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev" \
    --max-write-bytes=52428800

# 查看速率限制配置
radosgw-admin ratelimit get --ratelimit-scope=user \
    --uid="dev-user" --tenant="tenant-dev"
```

            

### 9.7 验证 QoS 效果

            

配置完成后，用 `fio` 或 `s3bench`
            验证 QoS 是否生效：
            
```
# 使用 s3cmd 上传测试文件，观察 dev-user 的速率限制
s3cmd --access_key=DEV_ACCESS_KEY \
      --secret_key=DEV_SECRET_KEY \
      --host=rgw-endpoint:8080 \
      --host-bucket="%(bucket)s.rgw-endpoint:8080" \
      put largefile.bin s3://test-bucket/largefile.bin

# 在另一个终端观察 OSD 的 I/O 统计
ceph osd perf

# 查看 mClock 调度器的实时统计
ceph daemon osd.0 dump_mempools
ceph daemon osd.0 perf dump | grep mclock
```

            
            

## 十、MinIO
            多租户设置实战

            

### 10.1 MinIO 多租户方案选择

            

MinIO 支持两种多租户架构：
            
            
- **多实例（Multi-Instance）**：每个租户运行独立的
            MinIO 实例。隔离最强，但资源开销大。
            
- **单实例多桶（Single-Instance
            Multi-Bucket）**：所有租户共享一个 MinIO
            实例，通过桶、策略和 IAM 实现隔离。
            
            

本节演示单实例多桶方案，因为它在实践中更常见。
            

### 10.2
            创建租户用户和访问密钥

            
```
# 设置 MinIO 客户端别名
mc alias set myminio http://minio-server:9000 ADMIN_ACCESS_KEY ADMIN_SECRET_KEY

# 创建租户专属桶
mc mb myminio/tenant-alpha-data
mc mb myminio/tenant-alpha-logs
mc mb myminio/tenant-beta-data
mc mb myminio/tenant-beta-logs

# 创建租户管理员用户
mc admin user add myminio alpha-admin Alpha-Secret-Key-123
mc admin user add myminio beta-admin Beta-Secret-Key-456

# 创建只读用户
mc admin user add myminio alpha-reader Alpha-Reader-Key-789
```

            

### 10.3 创建 IAM 策略

            
```
# 创建租户 Alpha 的管理策略文件
cat > alpha-admin-policy.json  alpha-reader-policy.json 
            

### 10.4 配置桶配额

            
```
# 设置桶的硬配额
mc admin bucket quota myminio/tenant-alpha-data --hard 500GB
mc admin bucket quota myminio/tenant-alpha-logs --hard 100GB
mc admin bucket quota myminio/tenant-beta-data --hard 200GB
mc admin bucket quota myminio/tenant-beta-logs --hard 50GB

# 查看配额
mc admin bucket quota myminio/tenant-alpha-data
```

            

### 10.5 配置服务端加密

            

MinIO 支持 SSE-KMS，可以集成 HashiCorp Vault 作为
            KMS：
            
```
# MinIO 环境变量配置（加密部分）
# 以下变量在 MinIO 启动时设置
MINIO_KMS_KES_ENDPOINT: "https://kes-server:7373"
MINIO_KMS_KES_CERT_FILE: "/etc/minio/certs/kes-client.cert"
MINIO_KMS_KES_KEY_FILE: "/etc/minio/certs/kes-client.key"
MINIO_KMS_KES_CAPATH: "/etc/minio/certs/kes-ca.cert"
MINIO_KMS_KES_KEY_NAME: "minio-default-key"
```

            

为每个租户桶设置独立的加密密钥：
            
```
# 为租户 Alpha 创建专用密钥
kes key create tenant-alpha-key

# 为租户 Beta 创建专用密钥
kes key create tenant-beta-key

# 为桶设置默认加密配置
mc encrypt set sse-kms tenant-alpha-key myminio/tenant-alpha-data
mc encrypt set sse-kms tenant-beta-key myminio/tenant-beta-data

# 验证加密配置
mc encrypt info myminio/tenant-alpha-data
```

            

### 10.6 配置审计日志

            

MinIO 支持将审计日志发送到 Webhook 或 Kafka：
            
```
# 配置审计日志输出到 Webhook
mc admin config set myminio audit_webhook:primary \
    endpoint="https://audit-collector.internal:8443/minio-audit" \
    auth_token="Bearer audit-token-xxxxx" \
    client_cert="/etc/minio/certs/audit-client.cert" \
    client_key="/etc/minio/certs/audit-client.key"

# 配置审计日志输出到 Kafka
mc admin config set myminio audit_kafka:primary \
    brokers="kafka-1:9092,kafka-2:9092,kafka-3:9092" \
    topic="minio-audit-logs"

# 重启 MinIO 使配置生效
mc admin service restart myminio
```

            

### 10.7
            配置对象锁定（合规保留）

            

对于需要满足合规要求的租户，可以启用对象锁定：
            
```
# 创建启用对象锁定的桶（必须在桶创建时启用）
mc mb myminio/tenant-alpha-compliance --with-lock

# 设置默认保留策略：合规模式（Compliance），保留 365 天
mc retention set --default compliance 365d myminio/tenant-alpha-compliance
```

            

合规模式（Compliance
            Mode）下，任何人（包括管理员）在保留期内都无法删除或覆盖对象。治理模式（Governance
            Mode）则允许有特殊权限的用户绕过保留策略。
            

### 10.8 验证隔离效果

            
```
# 用 alpha-admin 身份访问 Alpha 桶——应成功
mc alias set alpha http://minio-server:9000 alpha-admin Alpha-Secret-Key-123
mc ls alpha/tenant-alpha-data/

# 用 alpha-admin 身份访问 Beta 桶——应被拒绝
mc ls alpha/tenant-beta-data/
# 预期输出: Access Denied

# 用 alpha-reader 身份尝试写入——应被拒绝
mc alias set alpha-ro http://minio-server:9000 alpha-reader Alpha-Reader-Key-789
mc cp test.txt alpha-ro/tenant-alpha-data/
# 预期输出: Access Denied

# 用 alpha-reader 身份读取——应成功
mc cat alpha-ro/tenant-alpha-data/existing-file.txt
```

            
            

## 十一、参考文献

            

### 论文

            
            
- 

Gulati, A., Merchant, A., Varman, P., “mclock:
            Handling Throughput Variability for Hypervisor IO
            Scheduling”, OSDI 2010. mClock/dmclock
            调度算法的原始论文，Ceph mClock 调度器的理论基础。
            
- 

Shue, D., Freedman, M. J., Shaikh, A., “Performance
            Isolation and Fairness for Multi-Tenant Cloud Storage”, OSDI
            2012.
            多租户存储性能隔离的经典论文，讨论了公平调度和隔离保证的理论框架。
            
            

### 官方文档

            
            
- 

Ceph Documentation, “OSD Config Reference - mClock”,
            https://docs.ceph.com/en/reef/rados/configuration/mclock-config-ref/.
            Ceph Reef 版本 mClock 调度器的配置参考文档。
            
- 

Ceph Documentation, “RGW Multi-tenancy”, https://docs.ceph.com/en/reef/radosgw/multitenancy/.
            Ceph RGW 多租户功能的官方文档。
            
- 

Ceph Documentation, “Quota Management”, https://docs.ceph.com/en/reef/rados/operations/pools/#set-pool-quotas.
            Ceph 存储池配额设置文档。
            
- 

Ceph Documentation, “RGW Rate Limiting”, https://docs.ceph.com/en/reef/radosgw/rate-limiting/.
            Ceph RGW 请求速率限制文档。
            
- 

MinIO Documentation, “Multi-Tenancy”, https://min.io/docs/minio/linux/operations/concepts/multi-tenancy.html.
            MinIO 多租户架构设计文档。
            
- 

MinIO Documentation, “Bucket Quota”, https://min.io/docs/minio/linux/administration/bucket-quota.html.
            MinIO 桶配额设置文档。
            
- 

MinIO Documentation, “Server-Side Encryption with
            KMS”, https://min.io/docs/minio/linux/operations/server-side-encryption.html.
            MinIO SSE-KMS 配置文档。
            
- 

MinIO Documentation, “Audit Logging”, https://min.io/docs/minio/linux/operations/monitoring/minio-audit-logging.html.
            MinIO 审计日志配置文档。
            
            

### 规范与标准

            
            
- 

AWS, “IAM JSON Policy Reference”, https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html.
            S3 兼容存储的 IAM 策略语法参考。
            
- 

NIST SP 800-57, “Recommendation for Key Management”,
            2020.
            密钥管理的工程规范，涵盖密钥生命周期、轮换策略和保护要求。
            
            

### 源码

            
            
- 

Ceph 源码,
            `src/osd/scheduler/mClockScheduler.cc`, https://github.com/ceph/ceph. Ceph mClock
            调度器的核心实现。
            
- 

MinIO 源码, `cmd/iam.go`, https://github.com/minio/minio. MinIO IAM
            策略评估的核心逻辑。
            
            
            

**上一篇**: 数据均衡与在线迁移
            **下一篇**: 存储与计算分离架构
        

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