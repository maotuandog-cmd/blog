# 01 · etcd 生产内核（蒸馏）

> 原文系列：[etcd / 生产内核](https://quant67.com/post/etcd/) · 全景：[01 生产全景](https://quant67.com/post/etcd/01-production-overview/01-production-overview.html)  
> 版本锚：**etcd v3.5.33** · 地图：[[00-分类学习地图]] · 使用侧备份：[[kubernetes/10-升级与备份入门]]  
> 续作：K8s 耦合见原文 13；apiserver 侧见 [[02-kube-apiserver控制面内核]]

## 1. 本系列回答什么

etcd 生产路径里：**写/读/Watch 失败落在哪一层**；Revision MVCC + 单 Raft 组换来了什么排障坐标；何时该离开 etcd（TiKV/FDB/ZK）。

**不写**：Raft 论文全书、apiserver storage 全书、跑分排行。

## 2. 五轴坐标系（排障先点名轴）

口诀：**先点名轴，再下钻组件**——不要一上来 defrag 或换盘。

| 轴 | 可核对锚点 | 典型失败表象 |
|----|------------|--------------|
| **Raft** | Leader、index/term、quorum、learner | no leader、选举风暴、复制 lag |
| **WAL** | 段文件、snapshot、fsync、**committed vs applied** | 重启慢、WAL corrupt、snapshot 失败 |
| **MVCC** | Revision、treeIndex、bbolt、quota、compaction | `database space exceeded`、写 stall |
| **Watch** | start rev、synced/unsynced、`ErrCompacted` | Watch 断流、追赶 OOM、控制器大面积 resync |
| **Lease** | KeepAlive、checkpoint、TTL | 锁提前释放、**Node NotReady 漂移**（K8s Node Lease） |

### 三个不变量（原文强调）

1. **写必经 Raft**；读可分叉（线性一致 ReadIndex vs Serializable 本地读）。  
2. **committed ≠ applied**：多数派 ACK 不等于 MVCC/Watch 已追上。  
3. **全局 Revision 全序**绑在单 Raft 组上 → 写扩展有硬顶。

## 3. 写路径速记

```text
propose → WAL fsync → quorum commit → apply → MVCC/bbolt → watch notify
```

- WAL 存的是 **Raft 条目**，不是业务 KV 语义本身。  
- apply 串行；bbolt **单写者** → 与单 Raft 组一起构成写吞吐上限。

## 4. 与 Kubernetes 的耦合（必记）

| 概念 | 关系 |
|------|------|
| `resourceVersion` | 映射自 etcd **mod revision**（细节见 apiserver 04） |
| 对象存储 | 几乎只有 **apiserver** 直连 etcd（key 多在 `/registry/`） |
| Node Lease | 心跳走 **Lease 轴**；Leader 切换时 TTL 语义可表现为节点抖动 |
| Informer Watch | 依赖 Watch 轴；compaction 过猛 + 客户端 rev 落后 → `ErrCompacted` → 全量 list |

本库 kubeadm 集群：etcd 常 **stacked** 在控制面；备份用 snapshot（见 kubernetes/10），机制见原文 **14 运维与升级**。

## 5. 推荐阅读子集（不必一次 16 篇）

| 目的 | 篇目 |
|------|------|
| 建立坐标 | **01** 全景 → **15** 排障五轴 |
| 懂持久化 | 03 WAL → 04 MVCC → 05 bbolt |
| 懂 Watch/容量 | 09 Watch → 12 Compaction/quota |
| K8s 值班 | **13** 控制面耦合 → 14 运维 |
| 选型边界 | 16 选型收束 |

完整目录见系列首页。排障口令表深读：[15 排障五轴](https://quant67.com/post/etcd/)（站内 15 篇路径以 index 为准）。

## 6. 值班最小动作（有集群时）

```bash
# 示意：端点/证书按你的 stacked etcd 实际路径
etcdctl endpoint status -w table
etcdctl endpoint health
# 看：leader、DB size、是否有 NOSPACE alarm
# revision / raft 指数异常 → 先定轴再动手
```

无集群时不要伪造输出；先把五轴记熟。

## 7. 检查清单

- [ ] 能背出五轴名称，并各举一个症状  
- [ ] 能解释 committed 与 applied 为何要分列  
- [ ] 知道 Node NotReady 不一定是 CNI，也可能是 Lease/etcd  
- [ ] 升级/维护前会做 snapshot（kubernetes/10）

下一篇：[[02-kube-apiserver控制面内核]]
