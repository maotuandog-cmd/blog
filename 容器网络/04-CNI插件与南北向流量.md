# 04 · CNI 插件与南北向流量

> 承接 [[03-Kubernetes网络模型与Service]]。  
> 深读：quant67 系列 11–14（Flannel/Calico/Cilium/选型）、15–18（DNS/Ingress/Gateway）；Cilium 内核续作见 [cilium 系列](https://quant67.com/post/cilium/)。

## 1. 选型前先问清的问题

1. 底层网络能否宣告 / 路由 **Pod CIDR**？（能 → 倾向路由型；不能 → overlay）  
2. 是否需要强 **NetworkPolicy** / 身份策略 / 加密？  
3. 集群规模（Service、Pod 数量）能否接受 iptables kube-proxy？  
4. 运维团队能否接受 eBPF 排障工具链？  
5. 是否已有云厂商 VPC CNI（AWS/GCP/Azure）必须对齐？

## 2. Flannel：简单 overlay

- 典型：**VXLAN** 跨节点；同节点常走 bridge  
- **host-gw**：直接把其他节点 Pod 网段写成路由（要求二层可达）  
- 优点：好装、好懂  
- 上限：策略能力弱、大规模/复杂策略场景不够  

适合：学习、小集群、对策略要求低。

## 3. Calico：路由 + 策略

- 经典：**BGP** 通告 Pod 路由（Felix + BIRD/Typha 等组件）  
- 也可走 VXLAN/IPIP 封装模式（看环境）  
- **NetworkPolicy** 实现成熟  
- 另有 eBPF 数据面选项  

适合：要策略、能控底层路由、或需要与传统网络集成。

## 4. Cilium：eBPF 数据面

- Pod 连通、Service LB、可观测（Hubble）大量走 **eBPF**  
- 可用 **Identity**（基于标签）做策略，而不只绑 IP  
- 可部分/完全 **替代 kube-proxy**  
- 可延伸到加密、网格部分能力、ClusterMesh  

适合：要性能与可观测、接受 eBPF 栈；排障要从 `cilium`/`hubble`/`bpftool` 入手，不能只盯 iptables。

## 5. 横向对比（记忆用）

| | Flannel | Calico | Cilium |
|--|---------|--------|--------|
| 跨节点 | VXLAN / host-gw | BGP / 隧道 | eBPF + 路由/隧道等 |
| NetworkPolicy | 弱/靠其他 | 强 | 强（身份模型） |
| kube-proxy | 通常仍要 | 通常仍要 | 可替换 |
| 学习曲线 | 低 | 中 | 中高 |
| 可观测 | 一般 | 一般+ | Hubble 强 |

详细决策树读 quant67「CNI 选型决策」篇，勿只看跑分。  
**安装到配置落地**：[[08-CNI三选一安装与配置]]。

## 6. 南北向：Ingress 与 Gateway API

### Ingress（经典）

```text
外部 HTTPS → Ingress Controller（Nginx/Traefik/…）
           → 按 Host/Path 转到后端 Service → Pod
```

- 资源：`Ingress` + Controller 实现差异大  
- 注解（annotations）常变成「厂商方言」

### Gateway API（继任方向）

角色分离更清晰：

| 资源直觉 | 谁关心 |
|----------|--------|
| **GatewayClass / Gateway** | 集群/基础设施（监听端口、证书位） |
| **HTTPRoute / GRPCRoute / …** | 应用（路由规则、挂到哪个 Gateway） |

优点：标准化路由表达、权限分离；落地时注意控制器版本（Envoy Gateway / Cilium Gateway / Nginx Gateway Fabric 等）与 CRD 版本。

```bash
kubectl get gatewayclass,gateway,httproute -A
# 老集群可能仍是：
kubectl get ingress -A
```

## 7. 东西向 vs 南北向（别混）

| | 方向 | 典型组件 |
|--|------|----------|
| **东西向** | Pod↔Pod、Service 集群内 | CNI、kube-proxy/eBPF |
| **南北向** | 集群外↔集群内 | LB、NodePort、Ingress、Gateway |

Service Mesh（Istio/Linkerd）主要叠在**应用流量治理/mTLS**，不是替代 CNI；Ambient / sidecar 是另一条线，见 quant67 Istio/Linkerd/Cilium 系列。

## 8. 本阶段检查清单

- [ ] 能按「底层路由能力 / 策略 / 规模」口头选型  
- [ ] 能说出 Flannel / Calico / Cilium 各一句话定位  
- [ ] 分清 Ingress 与 Gateway API 的职责切分  
- [ ] 分清东西向 vs 南北向  

运维命令：[[07-CNI工具使用]] · 安装配置：[[08-CNI三选一安装与配置]] · 下一篇：[[05-策略安全与排障]]
