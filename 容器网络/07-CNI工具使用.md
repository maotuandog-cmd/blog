# 07 · CNI 工具使用

> 目标：会看配置、会调插件、会手工 ADD/DEL 验证，会用常见 CNI 的运维命令。  
> 概念见 [[02-容器网络与CNI]]；选型见 [[04-CNI插件与南北向流量]]；安装→配置见 [[08-CNI三选一安装与配置]]。  
> 官方：[`cnitool`](https://www.cni.dev/docs/cnitool/) · [CNI SPEC](https://www.cni.dev/docs/spec/) · [containernetworking/plugins](https://github.com/containernetworking/plugins)

## 1. 节点上两套目录（先认门）

| 路径 | 作用 |
|------|------|
| `/etc/cni/net.d/` | 网络配置：`*.conf` / `*.conflist` / `*.json` |
| `/opt/cni/bin/` | 插件二进制：`bridge`、`host-local`、`portmap`、`loopback`、厂商插件等 |

kubelet / CRI 调 CNI 时：读 `net.d` → 按 `type` / `plugins[]` 在 `CNI_PATH`（通常即 `/opt/cni/bin`）里找可执行文件 → `ADD`/`DEL`/`CHECK`。

```bash
ls -la /etc/cni/net.d/
ls -la /opt/cni/bin/
# kind 节点在容器里：
# docker exec -it <node> ls /etc/cni/net.d /opt/cni/bin
```

### conf vs conflist

- **`.conf`**：单个插件  
- **`.conflist`**：有序插件链（常见：`loopback` → `bridge`/`xxx` → `portmap`）

同目录多个文件时，**字典序第一个**常被当作默认网络（具体以运行时为准；不要留过期 conf）。

```bash
# 看当前生效配置（示例）
sudo cat /etc/cni/net.d/*.conflist 2>/dev/null | head -80
sudo cat /etc/cni/net.d/*.conf 2>/dev/null | head -40
```

## 2. 环境变量约定（插件真正吃的接口）

手工调插件或写脚本时，核心是这些环境变量（stdin 再喂 JSON 配置）：

| 变量 | 含义 |
|------|------|
| `CNI_COMMAND` | `ADD` / `DEL` / `CHECK` / `VERSION` |
| `CNI_CONTAINERID` | 容器/沙箱 ID（任意唯一字符串也可用于实验） |
| `CNI_NETNS` | netns 路径，如 `/var/run/netns/testing` |
| `CNI_IFNAME` | 容器内接口名，通常 `eth0` |
| `CNI_PATH` | 插件搜索路径，如 `/opt/cni/bin` |
| `CNI_ARGS` | 可选；K8s 会塞 `K8S_POD_NAME=...;K8S_POD_NAMESPACE=...;...` |

`ADD` 成功时插件向 **stdout** 打结果 JSON（IP、网关、DNS 等）；失败信息多在 stderr。

## 3. `cnitool`：对着已有 netns 做 ADD/CHECK/DEL

适合：**脱离 K8s，单独验证「这份 conf + 这批 bin」能不能配网。**

### 安装

```bash
# 需要 Go
go install github.com/containernetworking/cni/cnitool@latest
# 或从 containernetworking/cni 源码 make

# 标准插件（bridge/host-local/...）
git clone https://github.com/containernetworking/plugins.git
cd plugins && ./build_linux.sh
# 产物在 ./bin/
```

### 最小闭环

```bash
# 1) 写配置（网络名 myptp 要和 cnitool 参数一致）
sudo mkdir -p /etc/cni/net.d
echo '{"cniVersion":"0.4.0","name":"myptp","type":"ptp","ipMasq":true,"ipam":{"type":"host-local","subnet":"172.16.29.0/24","routes":[{"dst":"0.0.0.0/0"}]}}' \
  | sudo tee /etc/cni/net.d/10-myptp.conf

# 2) 建空 netns
sudo ip netns add testing

# 3) ADD：把接口配进 ns
sudo NETCONFPATH=/etc/cni/net.d CNI_PATH=./bin \
  cnitool add myptp /var/run/netns/testing

# 4) CHECK（spec 0.4.0+）
sudo NETCONFPATH=/etc/cni/net.d CNI_PATH=./bin \
  cnitool check myptp /var/run/netns/testing

# 5) 验证
sudo ip -n testing addr
sudo ip netns exec testing ping -c 1 172.16.29.1   # 视插件网关而定

# 6) 清理
sudo NETCONFPATH=/etc/cni/net.d CNI_PATH=./bin \
  cnitool del myptp /var/run/netns/testing
sudo ip netns del testing
```

要点：

- `NETCONFPATH` 默认 `/etc/cni/net.d`，按 **name** 找配置  
- `CNI_PATH` 指向插件目录（实验用 `./bin`，节点上用 `/opt/cni/bin`）  
- 参数顺序：`cnitool <add|check|del> <网络名> <netns路径>`

## 4. 直接调插件二进制（不经过 cnitool）

理解「运行时到底执行了什么」时有用：

```bash
sudo ip netns add demo
export CNI_COMMAND=ADD
export CNI_CONTAINERID=demo123
export CNI_NETNS=/var/run/netns/demo
export CNI_IFNAME=eth0
export CNI_PATH=/opt/cni/bin

# stdin 喂完整 conf；type=bridge 时会再调 CNI_PATH 里的 bridge、host-local 等
sudo -E /opt/cni/bin/bridge < /etc/cni/net.d/10-xxx.conf

# 清理
export CNI_COMMAND=DEL
sudo -E /opt/cni/bin/bridge < /etc/cni/net.d/10-xxx.conf
sudo ip netns del demo
```

conflist 场景下，运行时按列表依次调用多个插件；手工调试时优先用 **`cnitool` + 官方文档示例**，少自己拼链。

## 5. 和 CRI / Kubernetes 一起看

### 看 Pod 的网络结果

```bash
kubectl get pod -o wide -n <ns>
kubectl describe pod <pod> -n <ns>   # IP、CNI 相关 Event
```

### 节点上找 sandbox netns（containerd）

```bash
# 在 node 上
crictl pods
crictl inspectp <pod-uid-or-id> | rg -i 'network|ip|ns'
# netns 常见路径形态：
# /var/run/netns/... 或 /proc/<pause-pid>/ns/net
ls /var/run/netns 2>/dev/null
```

### 常见失败落点

| 现象 | 先查 |
|------|------|
| Pod `ContainerCreating` 一直转 | kubelet/CRI 日志里 CNI ADD 报错 |
| `failed to find plugin` | `/opt/cni/bin` 缺二进制或权限不对 |
| `no IP` / IPAM 失败 | 子网耗尽、host-local 数据目录、厂商 IPAM |
| 删 Pod 后网卡残留 | DEL 失败；手工 `cnitool del` / 清 veth |
| 多份 conf 冲突 | `/etc/cni/net.d` 只留当前 CNI 的一份 |

```bash
# kubelet 日志（发行版路径不同）
journalctl -u kubelet -p err --since "30 min ago" | rg -i cni
```

## 6. 各家 CNI 运维命令（日常）

### Flannel

```bash
kubectl -n kube-flannel get ds,po -o wide
# 节点：
ip link show type vxlan
ip route | rg flannel
```

### Calico

```bash
kubectl -n calico-system get po -o wide   # 或 kube-system，视安装方式
# calicoctl（需单独安装并配置 datastore）
calicoctl get nodes
calicoctl get ipPool -o wide
calicoctl node status          # BGP 邻居
calicoctl get workloadEndpoint
# 策略
calicoctl get networkPolicy -A
```

### Cilium（eBPF）

```bash
cilium status
cilium node list
cilium endpoint list
cilium service list
cilium policy get
# 可观测
hubble status
hubble observe --pod <ns>/<pod> --last 20
# 节点调试
cilium-dbg status 2>/dev/null || true
bpftool map show | head
```

排障时：**不要只盯 iptables**；先看 `cilium status` / Hubble drop。

### kind 默认 kindnet

```bash
kubectl -n kube-system get ds,po | rg kindnet
docker exec <kind-worker> ls /etc/cni/net.d /opt/cni/bin
docker exec <kind-worker> ip -br link
```

## 7. 推荐练习（30 分钟）

1. 在空节点（或本机实验机）用 **ptp/bridge + host-local** + `cnitool` 走通 ADD → ping → DEL。  
2. 在 kind 节点上 `ls` 出真实 `net.d` / `bin`，对照 `kubectl get pod -o wide`。  
3. 故意弄错 `CNI_PATH` 或删掉某个插件，看 ADD 报错信息长什么样。  
4. 若装了 Cilium：对一次「Policy drop」用 `hubble observe` 抓原因。

## 8. 速查表

| 你想… | 用什么 |
|-------|--------|
| 验证 conf+插件能否配网 | `cnitool add/check/del` |
| 看集群装了哪套 CNI | `ls /etc/cni/net.d` + `kubectl get ds -A` |
| 看 Pod IP / 落点 | `kubectl get pod -o wide` |
| 进 sandbox 看网卡 | `crictl` + `nsenter` / `ip netns` |
| Calico BGP / Pool | `calicoctl` |
| Cilium 策略与丢包 | `cilium` / `hubble` |
| 概念与模型 | [[02-容器网络与CNI]] [[03-Kubernetes网络模型与Service]] |
| 三选一安装配置 | [[08-CNI三选一安装与配置]] |
| kind 跟包 | [[06-kind实操与包路径追踪]] |

## 9. 安全注意

- 在**生产节点**上对正在用的网络名随意 `cnitool del` 会搞挂 Pod，只在实验 ns / 实验机做。  
- 不要把过期的 `/etc/cni/net.d` 配置留在目录里。  
- 改 conf 后通常要重建 Pod（或重启网络 Agent）才全局生效，视 CNI 而定。
