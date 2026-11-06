# 99 · 参考阅读清单（quant67）

> 本目录笔记是压缩主线；细节、抓包实验与源码引用以站内系列为准。  
> 总目录：[系列索引 · 三、网络与 I/O](https://quant67.com/post/series/index.html#%E4%B8%89%E7%BD%91%E7%BB%9C%E4%B8%8E-io)  
> 分类：[network](https://quant67.com/categories/network.html) · [kubernetes](https://quant67.com/categories/kubernetes.html)  
> 控制面（etcd/apiserver）地图：[[kubernetes/quant67/00-分类学习地图]]

## 主线：Kubernetes 网络深度系列

入口：https://quant67.com/post/k8s-network/

| 阶段 | 篇目（系列编号） | 对应本目录 |
|------|------------------|------------|
| Linux 基石 | 01 栈全景 · 02 虚拟设备 · 03 Netfilter · 04 路由隧道 · 05 BGP · 06 eBPF | [[01-Linux虚拟网络基石]] |
| K8s 模型 | 07 网络模型 · 08 CNI · 09 Service/kube-proxy · 10 双栈 | [[02-容器网络与CNI]] [[03-Kubernetes网络模型与Service]] [[07-CNI工具使用]] |
| CNI 对比 | 11 Flannel · 12 Calico · 13 Cilium · 14 选型 | [[04-CNI插件与南北向流量]] [[08-CNI三选一安装与配置]] |
| 发现与入口 | 15 CoreDNS · 16 Service 进阶 · 17 Ingress · 18 Gateway API | [[03-Kubernetes网络模型与Service]] [[04-CNI插件与南北向流量]] |
| 安全 | 19 NetworkPolicy · 20 身份/零信任 · 21 eBPF vs Netfilter · 22 加密 | [[05-策略安全与排障]] |
| 性能与排障 | 23 MTU · 24 DSR · 25 可观测 · 26 疑难手册 | [[05-策略安全与排障]] |
| 多集群/演进 | 27–30 | 按需 |
| 附录 | 31 nodeSelector / 放置（别把 Pending 当网络故障） | 排障前必读 |

精选直达：

- [07 · 网络模型三条规则](https://quant67.com/post/k8s-network/07-k8s-network-model/k8s-network-model.html)  
- [13 · Cilium](https://quant67.com/post/k8s-network/13-cilium/cilium.html)  
- [18 · Gateway API](https://quant67.com/post/k8s-network/18-gateway-api/gateway-api.html)  
- [31 · nodeSelector](https://quant67.com/post/k8s-network/31-node-selector/node-selector.html)

## 同方向续作（按需加深）

| 系列 | 入口 | 何时读 |
|------|------|--------|
| Linux / eBPF | https://quant67.com/post/linux/ | XDP、eBPF 机制 |
| Cilium eBPF 数据面内核 | https://quant67.com/post/cilium/ | 替代 kube-proxy、Hubble、策略 map（安装向仍用本目录 08） |
| etcd / kube-apiserver | [[kubernetes/quant67/00-分类学习地图]] | 控制面五轴；与网络排障分列 |
| Envoy / Istio / Linkerd / Envoy Gateway | 见系列总索引 3.9–3.14、3.16 | 网格与南北向控制面 |
| 网络工程 | https://quant67.com/post/network/ | TCP/QUIC/CDN/tc 等通用网络 |
| 容器运行时 | 系列索引 3.6 | 从零理解 runtime / microVM |

## 与本库其它笔记

| 路径 | 内容 |
|------|------|
| `/opt/obsidian/docker/Docker 网络实现原理.md` | Docker bridge/NAT/iptables **实测** |
| `/opt/obsidian/docker/Docker 存储与网络.md` | 使用向存储+网络 |
| `/opt/obsidian/linux/linux_commands/ip.md` 等 | `ip`/`ss`/`tcpdump` 命令速查 |

## 推荐学习节奏

1. 本目录 `01 → 03` 读完并做 netns/veth 小实验  
2. 精读 quant67 **07**，有集群再跟文内 kind 实验  
3. 按工作需要选读 11–14 或 23–26  
4. 上 eBPF CNI 后再进 cilium 内核系列  

回到总览：[[00-总览与学习路线]]
