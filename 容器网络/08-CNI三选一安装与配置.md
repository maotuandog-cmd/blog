# 08 · CNI 三选一：Cilium / Calico / Flannel（安装 → 配置）

> 选型原则：**生产优先 Cilium 或 Calico**；Flannel 留给学习/小实验。  
> 概念对照：[[04-CNI插件与南北向流量]] · 命令速查：[[07-CNI工具使用]] · 模型：[[03-Kubernetes网络模型与Service]]  
> 官方入口：[Cilium](https://docs.cilium.io/) · [Calico](https://docs.tigera.io/calico/latest/about/) · [Flannel](https://github.com/flannel-io/flannel)

文中版本号为整理时官方文档示例（Cilium CLI 安装示例钉 **1.20.4**，Calico manifests 钉 **v3.33.0**，Flannel release **v0.28.x**）。**上线前请改成当时 stable 版本。**

---

## 〇、先选型，再装

| 路线 | 代表 | 一句话 |
|------|------|--------|
| 功能强 / 可观测 / 安全 | **Cilium** | eBPF 数据面，Hubble，可替 kube-proxy，L7 策略 |
| 成熟稳妥 / 路由友好 | **Calico** | BGP / VXLAN / IPIP，NetworkPolicy 成熟，适合裸金属与混合网 |
| 简单轻量 | **Flannel** | 好装、VXLAN 常见，**不原生做 NetworkPolicy** |

### 场景建议

| 使用场景 | 推荐 |
|----------|------|
| 新建生产集群 | **Cilium** |
| 裸金属 | Calico / Cilium |
| 多机房、跨网段、要 BGP | **Calico** |
| 要 L7 策略 / 流量可视化 | **Cilium + Hubble** |
| 学习 K8s / 资源紧的小实验 | **Flannel** |

### 底层模式（三种都要懂）

| 模式 | 何时用 | 代价 |
|------|--------|------|
| **VXLAN / Geneve Overlay** | 底层**不会**路由 Pod CIDR；节点只要 IP 互通 | MTU 开销、略增 CPU |
| **BGP / Native Routing** | 能控制路由或同 L2，可宣告 Pod 网段 | 少封装；要会运维路由 |
| **eBPF** | Cilium（及 Calico eBPF 选项） | 策略/Service/可观测增强；排障工具链变了 |

**公网互联节点**：不要让 Pod 网段裸跑公网。先用 **WireGuard / 专线 / VPN** 建节点私网，再装 CNI。

### 装之前检查清单（所有 CNI）

1. kubeadm / kubespray / kind 等：**不要先装别的 CNI**，或装前清掉 `/etc/cni/net.d` 旧配置。  
2. `podSubnet` / `--pod-network-cidr` 与 CNI 期望一致（Calico 常用 `192.168.0.0/16` 示例；Flannel 常与 `10.244.0.0/16` 对齐）。  
3. 节点内核：Cilium 要求 **Linux ≥ 5.10**（见官方 System Requirements）。  
4. 防火墙放行：VXLAN **UDP 8472**（Geneve **6081**）；Calico BGP **TCP 179**（若用 BGP）；节点间已有私网互通。

---

## 一、Flannel（学习 / 轻量）

官方仓库与清单：https://github.com/flannel-io/flannel  
常见安装清单：`https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml`

### 1.1 前置

- 集群初始化时指定与 Flannel 一致的 Pod CIDR，例如 kubeadm：

```bash
# 示例：与 kube-flannel.yml 默认 10.244.0.0/16 对齐
kubeadm init --pod-network-cidr=10.244.0.0/16
```

- 仅控制面时，先 `kubeadm join` 完节点再装 CNI，或装完再加节点均可，但 **NotReady 直到 CNI Ready** 是正常的。

### 1.2 安装

官方清单部署在 **`kube-flannel` 命名空间**（需 privileged PSA），见 [flannel kubernetes.md](https://github.com/flannel-io/flannel/blob/master/Documentation/kubernetes.md)。

```bash
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml

kubectl -n kube-flannel get ds,po -o wide
kubectl get nodes   # NotReady → Ready
```

### 1.3 配置要点（ConfigMap / 后端）

清单内 ConfigMap 同时含 **CNI conf** 与 **flannel `net-conf.json`**；`Network` 必须与 `--pod-network-cidr` 一致，默认后端 **VXLAN**。

```json
{
  "Network": "10.244.0.0/16",
  "Backend": {
    "Type": "vxlan"
  }
}
```

| Backend.Type | 说明 |
|--------------|------|
| `vxlan` | 默认；跨节点封装 |
| `host-gw` | 直连路由；节点需二层可达 |
| `wireguard` | 加密后端（版本/清单支持时） |

多网卡 / NAT 场景可用节点 Annotation（官方文档）：

- `flannel.alpha.coreos.com/node-public-ip`：指定隧道对外 IP  
- `flannel.alpha.coreos.com/public-ip-overwrite`：NAT 后对外可达 IP  

改完 ConfigMap：

```bash
kubectl -n kube-flannel rollout restart ds/kube-flannel-ds
```

### 1.4 验证

```bash
kubectl -n kube-flannel get po -o wide
# 节点上：
ip -d link show type vxlan
ip route | head
kubectl run -n default t1 --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl run -n default t2 --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl get pod -o wide
# 互 ping Pod IP
```

### 1.5 局限

- **不实现** Kubernetes NetworkPolicy → 要策略需另配 Calico/Cilium 或换 CNI。  
- 生产可观测、L7、替 kube-proxy 等能力弱于 Cilium。

---

## 二、Calico（生产稳妥 / BGP）

官方 Quickstart：https://docs.tigera.io/calico/latest/getting-started/kubernetes/quickstart  
选型：https://docs.tigera.io/calico/latest/networking/determine-best-networking  
关于：https://docs.tigera.io/calico/latest/about/

### 2.1 干净集群（以 kind 官方 quickstart 为例）

`config.yaml`：

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
networking:
  disableDefaultCNI: true
  podSubnet: 192.168.0.0/16
```

```bash
kind create cluster --name=calico-cluster --config=config.yaml
# 节点会保持 NotReady，直到 Calico 起来
```

裸金属 / kubeadm：初始化时 `--pod-network-cidr=192.168.0.0/16`（或与你自定义 IPPool 一致），且 **不要**先装 Flannel。

### 2.2 安装（Operator 方式，官方当前推荐路径）

版本号请换成文档当时的 release（下例为 **v3.33.0**）：

```bash
# 1) CRD（按 K8s 小版本选官方给出的 YAML）
# K8s ≥ 1.36：
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/v3_projectcalico_org.yaml
# K8s 1.34/1.35：用官方的 v1beta1 清单（见 Quickstart）

# 2) Tigera Operator
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/tigera-operator.yaml

# 3) 安装 Calico（含默认 Installation 等 CR）
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/custom-resources.yaml

# 4) 等待
watch kubectl get tigerastatus
# AVAILABLE 列均为 True 后再继续
kubectl get nodes
```

### 2.3 配置：Overlay vs BGP / 路由

安装后主要看 **Installation** CR（`operator.tigera.io`）与 **IPPool**。

**A. VXLAN Overlay（底层不路由 Pod CIDR 时）**

```yaml
# 概念示例：以你集群里 kubectl get installation -o yaml 为准修改
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
      - cidr: 192.168.0.0/16
        encapsulation: VXLAN   # 或 VXLANCrossSubnet / IPIP / None
        natOutgoing: true
        nodeSelector: all()
```

- `VXLANCrossSubnet`：同子网不封装、跨子网才封装（官方「cross-subnet」思路）。  
- `IPIP`：另一类封装，云/部分环境常用。

**B. BGP / 无封装（能控底层路由时）**

- `encapsulation: None`（或文档中的 BGP 模式）  
- 配置 BGP peer（ToR / 路由器）；节点间宣告 Pod CIDR  
- 适合裸金属、多网段、要与现有网络集成  

改完后观察：

```bash
kubectl get ippools -o wide
calicoctl node status          # 若已装 calicoctl
calicoctl get bgpPeer
```

### 2.4 NetworkPolicy（官方 Quickstart：deny → allow）

**先全局默认拒绝，再精确放行**（摘自 Calico Quickstart）。

```bash
# 1) Global default deny（排除系统命名空间）
kubectl create -f - <<'EOF'
apiVersion: projectcalico.org/v3
kind: GlobalNetworkPolicy
metadata:
  name: default-deny
spec:
  selector: projectcalico.org/namespace not in {'kube-system', 'calico-system', 'calico-apiserver'}
  types:
  - Ingress
  - Egress
EOF

# 2) 允许某客户端 Pod 全部出站（示例：label run=access）
kubectl create -f - <<'EOF'
apiVersion: projectcalico.org/v3
kind: NetworkPolicy
metadata:
  name: allow-busybox-egress
  namespace: quickstart
spec:
  selector: run == 'access'
  types:
  - Egress
  egress:
  - action: Allow
EOF

# 3) 允许 nginx 仅接受来自 access 的入站
kubectl create -f - <<'EOF'
apiVersion: projectcalico.org/v3
kind: NetworkPolicy
metadata:
  name: allow-nginx-ingress
  namespace: quickstart
spec:
  selector: app == 'nginx'
  types:
  - Ingress
  ingress:
  - action: Allow
    source:
      selector: run == 'access'
EOF
```

原生 `networking.k8s.io/NetworkPolicy` 与 Calico CR 都可用；Calico CR（`action` / 全局策略）能力更多。

### 2.5 可观测（Whisker，随新版清单）

```bash
kubectl port-forward -n calico-system service/whisker 8443:8443
# 浏览器 https://localhost:8443 （自签证书需信任）
```

### 2.6 验证

```bash
kubectl get tigerastatus
kubectl -n calico-system get po -o wide
kubectl create ns quickstart
kubectl -n quickstart create deployment nginx --image=nginx
kubectl -n quickstart expose deployment nginx --port=80
kubectl -n quickstart run access --rm -ti --image=busybox -- /bin/sh
# 容器内：wget -qO- http://nginx
```

---

## 三、Cilium（新建生产首选）

官方 Quick Installation：https://docs.cilium.io/en/stable/gettingstarted/k8s-install-default/  
Routing 概念：https://docs.cilium.io/en/stable/network/concepts/routing/  
总文档：https://docs.cilium.io/

### 3.1 前置

- Kubernetes 使用 CNI；**无其它 CNI**（k3s：`--flannel-backend=none --disable-network-policy`）。  
- 内核 ≥ **5.10**。  
- 生产节点建议污点，避免 CNI 未就绪时业务 Pod 跑飞（官方 taint：`node.cilium.io/agent-not-ready=true:NoExecute`）。

### 3.2 安装 Cilium CLI

```bash
CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
CLI_ARCH=amd64
[ "$(uname -m)" = "aarch64" ] && CLI_ARCH=arm64
curl -L --fail --remote-name-all \
  https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}
sha256sum --check cilium-linux-${CLI_ARCH}.tar.gz.sha256sum
sudo tar xzvfC cilium-linux-${CLI_ARCH}.tar.gz /usr/local/bin
rm cilium-linux-${CLI_ARCH}.tar.gz{,.sha256sum}
```

### 3.3 安装 Cilium

**kind（官方示例）**：

```bash
curl -LO https://raw.githubusercontent.com/cilium/cilium/1.20.4/Documentation/installation/kind-config.yaml
kind create cluster --config=kind-config.yaml
```

**通用集群 / k3s（先禁用 Flannel）**：

```bash
# k3s 示例
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='--flannel-backend=none --disable-network-policy' sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

cilium install 1.20.4
cilium status --wait
```

安装器会按发行版尽量自动选配置。GKE / AKS / EKS 见官方同一页专用 tab。

### 3.4 配置：Encapsulation vs Native Routing

对照官方 [Routing](https://docs.cilium.io/en/stable/network/concepts/routing/)：

**A. Encapsulation（默认，要求最少）**

- 节点互通即可；防火墙：**VXLAN UDP 8472** 或 **Geneve UDP 6081**  
- Helm / ConfigMap 关键名（CLI 用 `--set` 时多为 camelCase）：

```yaml
# Agent 配置键（文档）：
tunnel-protocol: vxlan    # 或 geneve
# 默认即为封装模式，无需额外开 native
```

```bash
cilium install 1.20.4 --set tunnelProtocol=geneve
```

**B. Native Routing（少封装，底层必须能路由 Pod CIDR）**

```yaml
routing-mode: native
ipv4-native-routing-cidr: 10.0.0.0/8   # 改成你的 Pod 超网
# 全节点同 L2 时可：
# auto-direct-node-routes: true
```

```bash
cilium install 1.20.4 \
  --set routingMode=native \
  --set ipv4NativeRoutingCIDR=10.0.0.0/8 \
  --set autoDirectNodeRoutes=true
```

**C. 替换 kube-proxy（生产常开）**

```bash
cilium install 1.20.4 --set kubeProxyReplacement=true
# 已有 kube-proxy 时按官方迁移文档处理，避免双 LB 冲突
```

### 3.5 Hubble（可视化）

官方 Next Steps：[Hubble Observability](https://docs.cilium.io/en/stable/gettingstarted/hubble_setup/)

```bash
cilium hubble enable
# 可选 UI
cilium hubble enable --ui
cilium hubble port-forward &
hubble status
hubble observe --last 20
```

### 3.6 NetworkPolicy / L7

- 支持标准 NetworkPolicy。  
- CiliumNetworkPolicy 可做 **L7（HTTP 等）** 与基于 **Identity** 的策略。  
- 建议同样：**先 default-deny，再放行**。

### 3.7 验证

```bash
cilium status --wait
cilium connectivity test
# 期望大量用例通过；失败先看 too many open files / 防火墙 / 内核
```

---

## 四、装完后的通用验收

```bash
kubectl get nodes
kubectl get ds,po -A | rg -i 'cilium|calico|flannel'
kubectl run a --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl run b --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl get pod -o wide
# 同节点 / 跨节点互 ping Pod IP
# 再测 Service、DNS（见 [[06-kind实操与包路径追踪]]）
```

| 检查项 | Flannel | Calico | Cilium |
|--------|---------|--------|--------|
| 节点 Ready | ✓ | ✓ | ✓ |
| Pod 互 ping | ✓ | ✓ | ✓ |
| NetworkPolicy | ✗（原生无） | ✓ | ✓ |
| 流量可视化 | 弱 | Whisker 等 | Hubble |
| 替 kube-proxy | ✗ | 可选 eBPF | 常用 |

工具命令细节：[[07-CNI工具使用]]。

---

## 五、公网互联节点（先 VPN，再 CNI）

节点若靠**公网**互通，不要把 VXLAN/Geneve/BGP 直接裸跑在公网：

1. 用 **WireGuard**（或 IPsec / 专线）在节点间建**加密私网**（例如 `10.10.0.0/24`）。  
2. kubelet / apiserver 广告地址走私网 IP（或至少控制面与 CNI underlay 一致）。  
3. 再装 CNI，选 **Overlay（VXLAN）** 即可；underlay 已是 VPN。  
4. 若坚持原生加密：Flannel `wireguard` 后端、Cilium/Calico 自带 WireGuard 透明加密——仍建议先有稳定节点可达性。

排障顺序：先 `ping`/`wg show` 节点私网 → 再查 CNI Pod → 再查 Pod IP。

---

## 六、按环境生成参数（填完再敲命令）

部署前请明确（可复制填空）：

1. **环境**：裸金属 Ubuntu / 虚拟机 / 公有云 / 混合  
2. **规模**：1–2 / 3–5 / 6–20 / 20+  
3. **节点网络**：同局域网 / 多网段内网 / 内网+公网 / **纯公网**  
4. **用途**：学习 / Homelab / 生产  
5. **K8s 版本**：____  
6. **需求**：NetworkPolicy / 可视化 / 低延迟 / 加密 / BGP  

粗映射：

- 学习 + 同局域网 → **Flannel VXLAN**  
- 生产 + 新建 + 要观测 → **Cilium**（默认 tunnel；能路由再 native）  
- 裸金属 + BGP/多网段 → **Calico**  
- **纯公网节点** → 先 WireGuard 组网，再 Cilium/Calico Overlay  

---

## 七、官方文档索引（深读）

| 主题 | 链接 |
|------|------|
| Cilium 快速安装 | https://docs.cilium.io/en/stable/gettingstarted/k8s-install-default/ |
| Cilium Routing | https://docs.cilium.io/en/stable/network/concepts/routing/ |
| Cilium Hubble | https://docs.cilium.io/en/stable/gettingstarted/hubble_setup/ |
| Calico Quickstart | https://docs.tigera.io/calico/latest/getting-started/kubernetes/quickstart |
| Calico 网络选型 | https://docs.tigera.io/calico/latest/networking/determine-best-networking |
| Flannel | https://github.com/flannel-io/flannel |
| K8s Network Plugins | https://kubernetes.io/docs/concepts/cluster-administration/networking/ |

站内系列对照：[[99-参考阅读清单-quant67]]（11–14 篇）。
