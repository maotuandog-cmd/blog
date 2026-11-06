# 03 · Kubernetes 网络模型与 Service

> 承接 [[02-容器网络与CNI]]。  
> 深读：[三条规则统治一切](https://quant67.com/post/k8s-network/07-k8s-network-model/k8s-network-model.html)、系列 08–10、15–16。

## 1. 三条铁律（网络模型的全部「硬约束」）

官方 Cluster Networking 的核心可概括为：

1. **每个 Pod 独立 IP；任意 Pod 互通且路径上不因「伪装身份」做 NAT**  
   （发出去的源 Pod IP，对端看到的也应是该 IP。）  
2. **Node 上的进程能和所有 Pod 通信**  
   （kubelet 探针、节点 Agent 必须摸得到 Pod。）  
3. **Pod 看到的「自己的 IP」与别人看到的一致**  
   （不靠宿主机端口映射来「假扮」自己。）

本质诉求：**集群内扁平、可寻址、可追溯。**  
实现方式不限：VXLAN、BGP、eBPF……只要结果满足三条。

### 常见误解

| 误解 | 澄清 |
|------|------|
| Pod IP 永不变化 | Pod 重建常换 IP；稳定入口靠 Service / DNS |
| 「不经 NAT」包含访问 Service | **Service VIP → Pod** 往往有 DNAT/等价改写；铁律约束的是 **Pod↔Pod** |
| 同节点一定走 bridge | 部分 CNI/eBPF 会短路，不经传统 bridge |

## 2. 谁保证这三条？——CNI + 节点网络

```text
kubelet/CRI 创建 sandbox netns
        ↓
CNI ADD：发地址、插 veth、写路由、（可选）写策略
        ↓
同节点：bridge / eBPF 转发
跨节点：overlay 或 underlay 路由
```

控制面（apiserver/etcd）**不算在包路径上**；包路径挂了先查节点/CNI/Service，不要先怪 etcd。  
（Pending 调不起来是调度问题，见 quant67 附录 nodeSelector 篇。）

## 3. Service：稳定入口，不是「第四条铁律」

Service 解决：**一组 Pod 的稳定虚拟 IP / DNS 名 + 负载均衡**。

| 类型 | 作用 |
|------|------|
| **ClusterIP** | 集群内 VIP |
| **NodePort** | 每节点开端口转发到后端 |
| **LoadBalancer** | 云/MetalLB 等分配外部 LB |
| **ExternalName** | DNS CNAME 别名 |
| **Headless** | 无 ClusterIP，DNS 直接解到 Pod |

流量语义（简化）：

```text
客户端 → Service IP:Port ──(DNAT / eBPF LB)──→ 某后端 Pod IP:targetPort
```

注意：这里对 VIP 的改写 **不违背**「Pod↔Pod 不经 NAT」；客户端若直连 Pod IP，仍应按铁律保留源地址。

## 4. kube-proxy：三种数据面

kube-proxy 盯 Service/Endpoint(Slice)，编程本机转发。

| 模式 | 机制 | 特点 |
|------|------|------|
| **iptables** | 大量 DNAT + 概率匹配 | 兼容好；规则多时更新慢 |
| **IPVS** | 内核 IPVS 负载均衡 | 大规模 Service 更稳 |
| **eBPF**（常由 Cilium 等替换 kube-proxy） | 套接字/TC 等路径直接 LB | 性能与可观测强；排障工具变了 |

```bash
kubectl get svc -A
kubectl get endpointslices -n <ns>
# 节点上（iptables 模式举例）
iptables -t nat -L KUBE-SERVICES -n | head
```

## 5. DNS：CoreDNS

集群内名字：

- `my-svc.my-ns.svc.cluster.local` → ClusterIP（或 Headless 的 Pod 列表）  
- Pod DNS 策略由 `dnsPolicy` / `dnsConfig` 控制  

常见坑：**DNS 查询偶发 ~5s 延迟**（conntrack race、ndots、上游超时等）——排障见 [[05-策略安全与排障]]。

```bash
kubectl -n kube-system get deploy,svc -l k8s-app=kube-dns
kubectl run -it --rm debug --image=busybox:1.36 --restart=Never -- nslookup kubernetes-dns.kube-system
```

## 6. 包路径速记

### Pod A → Pod B（异节点，VXLAN 举例）

```text
A:eth0 → veth → 本机路由/桥
  → VTEP 封装 VXLAN（外层 NodeA→NodeB）
  → 物理网络
  → NodeB 解封装 → 桥/veth → B:eth0
```

### Pod → ClusterIP Service

```text
Pod 路由到 Service CIDR
  → kube-proxy/eBPF 选后端并 DNAT（或等价）
  → 再走 Pod↔Pod 路径（可能本机或跨节点）
```

### 外部 → NodePort

```text
外部 → NodeIP:NodePort → DNAT 到 Pod →（可能再 SNAT，视 externalTrafficPolicy）
```

`externalTrafficPolicy: Local` 可保留客户端源 IP，但只调度到本节点有后端的 Node。

## 7. 本阶段检查清单

- [ ] 能默写三条铁律及适用边界（Service 例外）  
- [ ] 能说明 pause/sandbox、CNI、kube-proxy 的分工  
- [ ] 知道 iptables / IPVS / eBPF 三种 Service 实现  
- [ ] 能区分直连 Pod IP vs 访问 Service VIP  

下一篇：[[04-CNI插件与南北向流量]]
