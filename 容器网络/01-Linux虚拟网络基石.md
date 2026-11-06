# 01 · Linux 虚拟网络基石

> 容器 / K8s 网络几乎全是「拼装 Linux 已有零件」。先认零件，再谈编排。  
> 深读：[quant67 K8s 网络系列 · 第一阶段](https://quant67.com/post/k8s-network/)（Linux 栈 / 虚拟设备 / Netfilter / 隧道 / BGP / eBPF）。

## 1. network namespace（netns）

每个 netns 有独立的：

- 网卡列表、地址、路由表  
- iptables/nft 规则（多数发行版按 ns 隔离）  
- 套接字与 `/proc/net/*`

进程进入某 netns 后，「看到的网络世界」就变了。容器网络隔离的本质就是 **每个容器（或 Pod）一个 netns**。

```bash
# 列出现有 netns
ip netns list

# 临时建一个演示 ns
ip netns add demo
ip netns exec demo ip link
ip netns exec demo ip route
ip netns delete demo
```

宿主机默认 netns 常叫 **root / init netns**（没有单独名字）。

## 2. veth pair（虚拟网线）

`veth` 成对出现：一端发包，另一端立刻收到，像一根短线。

典型用法：

```text
容器 netns 内：eth0  ←——veth——→  宿主机：vethXXXX 接到 bridge
```

```bash
ip link add veth-a type veth peer name veth-b
ip link set veth-a up
ip link set veth-b up
# 把一端挪进 ns：
# ip link set veth-a netns demo
```

记法：**容器侧 eth0 + 宿主机侧 veth* = 一对**。排查连通性时两边都要 `ip link` / `tcpdump`。

## 3. Linux bridge（软件交换机）

二层转发设备：根据 MAC 学习转发表，同网桥端口之间可互通。

Docker 的 `docker0`、很多 CNI 的 `cni0` / `flannel.1` 旁路设备，都是 bridge 或类似逻辑。

```bash
ip link show type bridge
bridge link show          # 端口成员
# 或
brctl show                # 老工具，部分系统需 bridge-utils
```

注意：

- bridge 默认是 **L2**；跨网段仍要靠 **路由 / NAT**。  
- 容器要「出外网」时，常见路径是：容器 → veth → bridge → **宿主机做 SNAT/MASQUERADE** → 物理网卡。

## 4. tun / tap、macvlan、ipvlan（选型直觉）

| 设备 | 层 | 常见用途 |
|------|----|----------|
| **tap** | L2 帧 | VM、部分 VPN |
| **tun** | L3 包 | WireGuard、OpenVPN 等 |
| **macvlan** | 给容器独立 MAC | 少一层 bridge，但看交换机/云限制 |
| **ipvlan** | 共享 MAC、多 IP | 云环境对 MAC 敏感时常用 |

K8s 默认不一定用 macvlan；理解它们是为了读 CNI 文档和排「二层隔离」类问题。

## 5. 路由：包下一跳去哪

每个 netns 一张路由表：`ip route`。

跨节点容器互通，本质是：

1. **Overlay**：包封装进 VXLAN/IPIP/WireGuard，宿主机之间用底层 IP 互通；或  
2. **Underlay / 路由**：把 Pod CIDR 宣告到物理网络（如 Calico BGP），中间路由器知道怎么去 Pod。

```bash
ip route
ip route get 10.244.2.5     # 内核会告诉你走哪张网卡、下一跳
```

## 6. Netfilter：五链与「策略发生的地方」

逻辑链（iptables 视角，nft 是另一套语法、同一套钩子思想）：

```text
进站：PREROUTING → (路由判定) → INPUT → 本地进程
转发：PREROUTING → (路由判定) → FORWARD → POSTROUTING
出站：本地进程 → OUTPUT → POSTROUTING
```

常见表：

- **filter**：放行/拒绝（INPUT/FORWARD/OUTPUT）  
- **nat**：DNAT/SNAT/MASQUERADE（PREROUTING/POSTROUTING/OUTPUT）  
- **mangle / raw**：改包、绕过 conntrack 等

和容器强相关的规则类型：

- **DNAT**：把「宿主机:端口」映射到「容器 IP:端口」（Docker `-p`、NodePort）  
- **SNAT/MASQUERADE**：容器访问外网时改源地址  
- **kube-proxy iptables 模式**：用大量 DNAT + 统计概率做 Service 负载均衡  

```bash
iptables -t nat -L -n -v | head
iptables -t filter -L FORWARD -n -v | head
# 新系统也可能是 nftables：
nft list ruleset | head
```

**conntrack**：连接跟踪表满会导致「莫名丢包 / 新建连不上」。看：

```bash
conntrack -C          # 当前条目数（需 conntrack-tools）
sysctl net.netfilter.nf_conntrack_max
```

## 7. tc / eBPF / XDP（先建立坐标）

| 能力 | 挂载点直觉 | 容器场景 |
|------|------------|----------|
| **tc** | qdisc/class/filter，出口整形、netem 模拟延迟 | 压测、限速 |
| **eBPF（TC/cgroup）** | 可编程过滤/改写/观测 | Cilium、可观测 |
| **XDP** | 驱动/网卡极早期丢弃或转发 | 抗 DDoS、高性能 LB |

入门阶段只需知道：**Cilium 等方案用 eBPF 替代大量 iptables**；排障时「规则不在 iptables 里」可能是 eBPF。

## 8. 最小实验：两 ns + veth + 互通

```bash
ip netns add ns1
ip netns add ns2
ip link add v1 type veth peer name v2
ip link set v1 netns ns1
ip link set v2 netns ns2
ip netns exec ns1 ip addr add 10.10.0.1/24 dev v1
ip netns exec ns2 ip addr add 10.10.0.2/24 dev v2
ip netns exec ns1 ip link set v1 up
ip netns exec ns2 ip link set v2 up
ip netns exec ns1 ip link set lo up
ip netns exec ns2 ip link set lo up
ip netns exec ns1 ping -c 2 10.10.0.2
# 清理
ip netns del ns1; ip netns del ns2
```

做通后，把「ns1 换成容器、v2 接到 bridge」就接近 Docker 默认拓扑。

## 9. 本阶段检查清单

- [ ] 能解释 netns / veth / bridge 各管哪一层  
- [ ] 能画出「容器出网要 SNAT」的路径  
- [ ] 知道查路由用 `ip route get`，查 NAT 用 `iptables -t nat`  
- [ ] 知道 overlay vs 路由 两种跨机互通思路  

下一篇：[[02-容器网络与CNI]]
