# 02 · kubeadm 安装集群

> 承接 [[01-集群安装选型]]。对照官方：  
> [Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/) ·  
> [Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/) ·  
> [containerd](https://kubernetes.io/docs/setup/production-environment/container-runtimes/#containerd)  
> **本机四节点逐步手册（路径/ISO/网络已钉死）**：[[03-KVM四节点集群部署手册]]

示例 minor：**v1.33**（本机 Lab 用 **v1.37**，见上篇）。所有节点执行「机器准备 + 运行时 + kube 包」；仅首节点 `init`，其余 `join`。

---

## 1. 机器准备（每台）

### 1.1 唯一性与互通

```bash
hostnamectl   # 主机名互不重复
ip link
sudo cat /sys/class/dmi/id/product_uuid
ip route show | head   # 看 default via；广告地址通常取默认网关侧 IP
```

多网卡且默认路由不是你想要的集群网：优先改路由，使「默认网关 IP」就是集群通信 IP。必要时再用：

- `kubeadm init --apiserver-advertise-address=<IP>`
- kubelet `--node-ip`（写在 kubeadm 配置 `nodeRegistration.kubeletExtraArgs`）

### 1.2 端口

至少放行（完整表见官方 Ports and Protocols）：

| 用途 | 端口 |
|------|------|
| API | TCP 6443 |
| etcd（本机/控制面间） | TCP 2379–2380 |
| kubelet | TCP 10250 |
| kube-scheduler / controller | TCP 10259 / 10257 |
| NodePort 范围 | TCP/UDP 30000–32767 |
| CNI（例 VXLAN） | UDP 8472 等 |

### 1.3 Swap

kubelet 默认检测到 swap 可能拒绝启动。Homelab 常见做法：关闭 swap。

```bash
sudo swapoff -a
# 持久关闭：注释 /etc/fstab 中 swap 行
```

若保留 swap：需在 kubelet 配置 `failSwapOn: false`（并理解官方 Swap 文档）；本期默认 **关 swap**。

### 1.4 内核模块与转发

```bash
cat <<'EOF' | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

cat <<'EOF' | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sudo sysctl --system
```

---

## 2. 安装 containerd（每台）

按发行版安装 containerd 后，启用 **SystemdCgroup**（与 kubelet 一致），否则易出现 Pod 起不来。

```bash
# 示例：已安装 containerd 后
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
# 将 SystemdCgroup = false 改为 true（在 runc.options 段）
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
sudo systemctl enable --now containerd
sudo systemctl restart containerd
```

CRI 套接字：`unix:///var/run/containerd/containerd.sock`  
多运行时并存时，`kubeadm` 加 `--cri-socket=unix:///var/run/containerd/containerd.sock`。

---

## 3. 安装 kubeadm / kubelet / kubectl（每台）

使用 **pkgs.k8s.io**（旧 `apt.kubernetes.io` 已废弃）。以下为 **Debian/Ubuntu + v1.33**：

```bash
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
sudo mkdir -p -m 755 /etc/apt/keyrings

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.33/deb/Release.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.33/deb/ /' \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
sudo systemctl enable --now kubelet
```

此时 kubelet 可能反复重启（等 `kubeadm init/join`），属正常。

RHEL/Rocky：用官方对应 `rpm` 仓库页（同 minor），`exclude=kubelet kubeadm kubectl ...`，安装时 `--disableexcludes=kubernetes`。

**版本偏斜**：kubelet 不可高于 apiserver；三者尽量同 minor。

---

## 4. 初始化控制面（仅首节点）

先定 Pod CIDR（须与 CNI 一致），例如：

| CNI | 常用示例 CIDR |
|-----|----------------|
| Flannel | `10.244.0.0/16` |
| Calico | `192.168.0.0/16` |
| Cilium | 可用默认 Cluster Pool，或你自定义 |

**单控制面最小命令：**

```bash
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=<控制面IP>
```

**以后可能扩多控制面**：init 时必须带共享端点（DNS 或 LB IP）：

```bash
sudo kubeadm init \
  --control-plane-endpoint=cluster-endpoint:6443 \
  --pod-network-cidr=10.244.0.0/16 \
  --upload-certs
```

无 `--control-plane-endpoint` 建好的单控制面，**kubeadm 不支持**事后原地改成 HA。

成功后按输出配置 kubectl（普通用户）：

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown "$(id -u):$(id -g)" $HOME/.kube/config
kubectl get nodes   # 控制面 Ready=False 直到装上 CNI，属正常
```

**安全**：`admin.conf` 等价高权限，勿外传。`super-admin.conf` 更危险，移走保管。

保存输出中的 **`kubeadm join ...`** 整行。

令牌过期后：

```bash
kubeadm token create --print-join-command
```

---

## 5. 安装 Pod 网络（CNI）

**必须先装 CNI**，否则 CoreDNS 起不来、节点一直 NotReady。

- 详细步骤：[[容器网络/08-CNI三选一安装与配置]]  
- 生产建议 Cilium 或 Calico；学习可用 Flannel  

CIDR 不得与宿主机网段冲突。装完：

```bash
kubectl get nodes
kubectl -n kube-system get po
# 或 cilium status / calico tigerastatus，视插件而定
```

单节点想调度业务 Pod（去掉控制面污点，仅实验）：

```bash
kubectl taint nodes --all node-role.kubernetes.io/control-plane-
```

---

## 6. 加入 worker

在已安装 runtime + kube 包的节点上执行 init 输出的 join（root）：

```bash
sudo kubeadm join <API地址>:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

控制面：

```bash
kubectl get nodes -o wide
```

---

## 7. 可选：配置文件 init

复杂参数用配置文件（官方 *Using kubeadm init with a configuration file*）。示意：

```yaml
# kubeadm-config.yaml（字段以你目标版本 API 为准）
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: v1.33.0
networking:
  podSubnet: 10.244.0.0/16
controlPlaneEndpoint: "cluster-endpoint:6443"
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint:
  advertiseAddress: 192.168.1.10
  bindPort: 6443
```

```bash
sudo kubeadm init --config=kubeadm-config.yaml
```

`apiVersion` 随版本变化，生成骨架：

```bash
kubeadm config print init-defaults > kubeadm-config.yaml
# 再编辑
```

---

## 8. 重置与重来

```bash
sudo kubeadm reset -f
# 按需清理：/etc/cni/net.d、iptables、残留挂载
sudo rm -rf /etc/cni/net.d
```

再重新 init/join。

---

## 9. 本阶段检查清单

- [ ] 所有节点 containerd + `SystemdCgroup=true`  
- [ ] kubelet/kubeadm/kubectl 同 minor 且 hold  
- [ ] `kubeadm init` 成功，`kubectl get nodes` 可见控制面  
- [ ] CNI Ready，CoreDNS Running，节点 Ready  
- [ ] 至少一台 worker `join` 成功（或单节点已去污点）  
- [ ] join 命令与 admin.conf 已安全存放  

下一篇：[[03-工作负载基础]]
