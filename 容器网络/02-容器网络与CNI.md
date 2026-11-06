# 02 · 容器网络与 CNI

> 承接 [[01-Linux虚拟网络基石]]。  
> Docker 细节已有：[[Docker 网络实现原理]]。本篇只抓「和 K8s 模型冲突的点」+ CNI 接口。  
> 深读：quant67 [K8s 网络模型](https://quant67.com/post/k8s-network/07-k8s-network-model/k8s-network-model.html)、系列第 08 篇 CNI 规范。

## 1. 单机容器默认长什么样（Docker bridge）

```text
┌─ container netns ─┐     ┌──────── host ────────┐
│ eth0 172.17.0.2   │─veth─│ vethXXX              │
└───────────────────┘     │    ↓                  │
                          │ docker0 (bridge)      │
                          │ 172.17.0.1/16         │
                          │    ↓ iptables NAT     │
                          │ eth0 物理网卡          │
                          └───────────────────────┘
```

特征：

1. **每容器一个 netns + 一对 veth**  
2. **同 bridge 二层互通**（同一 `docker0` / 自定义 bridge）  
3. **出网靠 MASQUERADE**；**入网靠 `-p` DNAT**  
4. 容器内看到的源 IP，出了宿主机常被改掉 → **不满足「端到端保留 Pod IP」**

这就是为什么：**Docker 默认网络 ≠ Kubernetes 网络模型**。

## 2. 「端口映射」模型 vs 「每容器一 IP」模型

| | Docker 经典用法 | K8s Pod 模型 |
|--|-----------------|--------------|
| 寻址 | 宿主机 IP + 端口 | Pod IP（集群内扁平） |
| NAT | 进出都常见 | Pod↔Pod **禁止靠 NAT 伪装** |
| 应用配置 | 要知道映射端口 | 直接连对方 Pod/Service IP |
| 复杂度落点 | 应用/编排要记端口 | 基础设施（CNI）保证互通 |

K8s 选择把复杂度推到 CNI：应用像在一个大二层/三层扁平网里通信。

## 3. Pod ≠ 单容器：pause 与共享 netns

一个 Pod 内多个容器 **共享同一个 network namespace**（同一张网卡、同一 IP、同一端口空间）。

- **pause / sandbox 容器**：先创建并「占住」这个 netns  
- 业务容器：`joined` 进同一个 netns  
- 所以 Pod IP 是挂在 sandbox 上的；业务容器生命周期变化，网络身份仍在

直觉：

```text
Pod = 一个 netns + 一个（组）IP + 多个共享该 ns 的容器
```

## 4. CNI：把「配网」标准化

CNI（Container Network Interface）约定：运行时（containerd/CRI-O）在创建/删除沙箱时调用插件。

核心操作：

| 操作 | 含义 |
|------|------|
| **ADD** | 把接口塞进 netns、配 IP/路由/DNS 相关结果 |
| **DEL** | 清理接口与地址 |
| **CHECK** | 校验当前配置是否仍正确 |
| **VERSION** | 能力协商 |

配置一般在节点：

```text
/etc/cni/net.d/*.conf(list)
/opt/cni/bin/   # 插件二进制
```

调用链（简化）：

```text
kubelet → CRI (RunPodSandbox)
       → 创建 pause + netns
       → 调 CNI ADD（传入 netns 路径、Pod 元数据）
       → 插件配置 veth/IPAM/路由/策略
       → 再启动业务容器加入该 netns
```

**CNI 不负责 Service 负载均衡**（那是 kube-proxy / eBPF 替换层的事）；CNI 负责 **Pod 网卡与连通性**。

## 5. 同节点 vs 跨节点（容器视角）

### 同节点

常见路径（bridge 型 CNI）：

```text
PodA eth0 → veth → cni0/bridge → veth → PodB eth0
```

L2 转发，开销相对小。

### 跨节点

必须回答：对端 Pod IP 如何从本机出去？

1. **Overlay（如 Flannel VXLAN）**  
   包封装，外层源/目的是 **Node IP**，内层才是 Pod IP。  
2. **路由（如 Calico BGP / host-gw）**  
   节点路由表知道「某 Pod CIDR 在某节点」，直接路由，无隧道封装（或少封装）。

选型时先问：**底层网络是否允许/方便宣告 Pod CIDR？** 不能则 overlay 更省事，能则路由通常更简单、更快。

## 6. 和 Docker 笔记怎么配合读

| 问题 | 去哪看 |
|------|--------|
| docker0、自定义 bridge、`-p` 规则实测 | [[Docker 网络实现原理]] |
| compose / 常用命令 | [[docker-compose 使用说明]]、[[Docker 常用命令]] |
| 为何 K8s 不用默认 docker0 模型 | **本篇 + [[03-Kubernetes网络模型与Service]]** |

## 7. 本阶段检查清单

- [ ] 能画出 Docker bridge + NAT 拓扑  
- [ ] 能说明 pause/sandbox 与 Pod IP 的关系  
- [ ] 知道 CNI ADD/DEL 时机，以及「不管 Service」  
- [ ] 能对比 overlay vs 路由 跨节点  

工具实操：[[07-CNI工具使用]] · 下一篇：[[03-Kubernetes网络模型与Service]]
