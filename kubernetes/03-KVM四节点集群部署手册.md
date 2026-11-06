# 03 · Linux + KVM：四节点 Kubernetes 集群完整部署手册（本机版）

> 承接 [[02-kubeadm安装集群]]（通用步骤）· CNI：[[容器网络/08-CNI三选一安装与配置]] · 切换需求：[[REQ-CNI切换Cilium]]  
> 概念排障：[[09-排障手册]] · etcd 备份机制：[[quant67/01-etcd生产内核]]  
> 官方：[libvirt](https://ubuntu.com/server/docs/how-to/virtualisation/libvirt/) · [kubeadm install v1.37](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/) · [Cilium](https://docs.cilium.io/)

本文按**本机实测环境**改写，不是通用教材照抄。

## 〇、本机锁定参数

| 项 | 值 |
|----|-----|
| 宿主机 | Linux + KVM（**AMD** / `kvm_amd`）+ QEMU + libvirt |
| Lab 根目录 | **`/maotuan/kvm-k8s/`**（独立盘 ~914G 可用） |
| ISO | `/maotuan/kvm-k8s/iso/ubuntu-26.04.1-live-server-amd64.iso` → 链到 `~/下载/` |
| 镜像/备份 | `/maotuan/kvm-k8s/images/` · `/maotuan/kvm-k8s/backup/` |
| 客机 OS | **Ubuntu Server 26.04.1 LTS** |
| 集群 | 1 Master + 3 Worker · kubeadm · containerd · **Cilium**（VXLAN）· stacked etcd |
| K8s | **v1.37**（`pkgs.k8s.io/.../v1.37/...`，四台同 minor） |
| 网络 | libvirt NAT **`k8s-nat`** · `192.168.100.0/24` · 网关 `.1` |

### 资源分配

| 节点 | vCPU | RAM | 盘 (qcow2) | IP |
|------|------|-----|------------|-----|
| k8s-master01 | 4 | 6 GB | 60 G | 192.168.100.10 |
| k8s-worker01 | 4 | 8 GB | 60 G | 192.168.100.11 |
| k8s-worker02 | 3 | 8 GB | 60 G | 192.168.100.12 |
| k8s-worker03 | 3 | 8 GB | 60 G | 192.168.100.13 |
| **合计** | **14** | **30 GB** | **240 G 上限（动态）** | |

宿主机约 45 GB 内存：客机 30 GB 后需给桌面/libvirt/缓存留余量。

### 开建前必做

```bash
# 1) 释放内存：本机常有 win11（约 16GB）。暂停仍占内存，建议关机
virsh list --all
virsh shutdown win11    # 或 destroy（粗暴）
# 确认 available 大致 ≥ 32G 再开四台
free -h

# 2) 确认 Lab 目录与 ISO
ls -lh /maotuan/kvm-k8s/iso/
df -h /maotuan
```

合盖休眠会影响整集群；长时间实验请关自动睡眠。

---

## 一、架构

```text
笔记本宿主机（KVM）
└── k8s-nat 192.168.100.0/24 (NAT, virbr-k8s)
    ├── k8s-master01  .10   控制面 + etcd
    ├── k8s-worker01  .11
    ├── k8s-worker02  .12
    └── k8s-worker03  .13
```

NAT 原因：节点互通、能上网装包、宿主机可 SSH，且不绑死家庭/公司 Wi‑Fi 物理桥。

---

## 二、宿主机 KVM 检查

```bash
egrep -c '(svm|vmx)' /proc/cpuinfo   # AMD 看 svm；有值即可
lsmod | grep kvm
ls -l /dev/kvm
virsh version
virsh list --all
virsh net-list --all
```

缺工具时（Debian/Ubuntu 系示例）：

```bash
sudo apt update
sudo apt install -y qemu-kvm libvirt-daemon-system libvirt-clients \
  virtinst virt-manager virt-viewer cpu-checker
sudo systemctl enable --now libvirtd   # 服务名以本机为准
sudo usermod -aG libvirt,kvm "$USER"   # 重新登录后生效
```

本机用户 `maotuan` 已在 `libvirt` 组。

---

## 三、创建 `k8s-nat` 网络

不推荐占用默认 `default`/`virbr0` 做实验网，单独建：

```bash
cat > /tmp/k8s-nat.xml <<'EOF'
<network>
  <name>k8s-nat</name>
  <forward mode='nat'/>
  <bridge name='virbr-k8s' stp='on' delay='0'/>
  <ip address='192.168.100.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.100.100' end='192.168.100.200'/>
    </dhcp>
  </ip>
</network>
EOF

sudo virsh net-define /tmp/k8s-nat.xml
sudo virsh net-start k8s-nat
sudo virsh net-autostart k8s-nat
sudo virsh net-list --all
ip -br addr show virbr-k8s
```

预期：`k8s-nat` active；桥上 `192.168.100.1/24`。

---

## 四、创建四台 Ubuntu 虚拟机

### 4.0 推荐：cloud 镜像无人值守（本机已验证）

Live Server autoinstall 易卡在装包；本机已改用 **Ubuntu 26.04 cloud 镜像 + cloud-init**：

```bash
# 重建四台（会删现有盘）
sudo bash /maotuan/kvm-k8s/scripts/cloudimg-rebuild.sh
# 约 1～2 分钟后：
ssh ops@192.168.100.10   # 密码见 /maotuan/kvm-k8s/backup/ops-password.txt
```

镜像路径：`/maotuan/kvm-k8s/iso/ubuntu-26.04-server-cloudimg-amd64.img`

### 4.1 virt-install（手工 Live ISO，可选）

```bash
ISO=/maotuan/kvm-k8s/iso/ubuntu-26.04.1-live-server-amd64.iso
IMGDIR=/maotuan/kvm-k8s/images
ls -lh "$ISO"

create_vm() {
  local NAME=$1 CPU=$2 RAM=$3 DISK=$4
  sudo virt-install \
    --name "$NAME" \
    --virt-type kvm \
    --memory "$RAM" \
    --vcpus "$CPU" \
    --cpu host-passthrough \
    --os-variant ubuntu24.04 \   # 本机 osinfo 尚无 ubuntu26.04，用 24.04 即可
    --disk path="${IMGDIR}/${NAME}.qcow2",size="$DISK",format=qcow2,bus=virtio \
    --network network=k8s-nat,model=virtio \
    --graphics spice \
    --video virtio \
    --cdrom "$ISO" \
    --noautoconsole
}

# 若报 unknown os-variant，改为：--os-variant ubuntu24.04 或 generic
create_vm k8s-master01 4 6144 60
create_vm k8s-worker01 4 8192 60
create_vm k8s-worker02 3 8192 60
create_vm k8s-worker03 3 8192 60

sudo virsh list --all
```

### 4.2 安装系统

```bash
virt-manager   # 打开四台控制台装 Ubuntu Server
```

建议：主机名与节点名一致；用户 `ops`；勾选 OpenSSH；先 DHCP；整盘安装；不要桌面。  
**不要**用已初始化 SSH 的磁盘做简单克隆冒充四台（主机密钥冲突）。

### 4.3 静态 IP（Netplan）

先查网卡名：`ip -br link`（可能是 `ens3` / `enp1s0` 等）。

Master 示例 `/etc/netplan/01-k8s.yaml`：

```yaml
network:
  version: 2
  ethernets:
    ens3:          # 改成实际网卡名
      dhcp4: false
      addresses:
        - 192.168.100.10/24
      routes:
        - to: default
          via: 192.168.100.1
      nameservers:
        addresses:
          - 192.168.100.1
          - 1.1.1.1
```

Worker 只改地址为 `.11` / `.12` / `.13`。

```bash
sudo chmod 600 /etc/netplan/01-k8s.yaml
sudo netplan apply
```

### 4.4 主机名与 hosts

各节点：`hostnamectl set-hostname k8s-master01`（等）。四台都写：

```bash
sudo tee -a /etc/hosts <<'EOF'
192.168.100.10 k8s-master01
192.168.100.11 k8s-worker01
192.168.100.12 k8s-worker02
192.168.100.13 k8s-worker03
EOF
```

宿主机验收：

```bash
ssh ops@192.168.100.10
# …11 12 13；节点互 ping
```

**阶段验收**：四 VM 起来、静态 IP、SSH、互通。

---

## 五、四节点统一初始化（全部节点）

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget vim git chrony ca-certificates gnupg \
  apt-transport-https jq iproute2 iptables
sudo systemctl enable --now chrony

sudo swapoff -a
# 注释 /etc/fstab 中 swap 行
free -h; swapon --show

sudo tee /etc/modules-load.d/k8s.conf <<'EOF'
overlay
br_netfilter
EOF
sudo modprobe overlay br_netfilter

sudo tee /etc/sysctl.d/99-kubernetes-cri.conf <<'EOF'
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system

curl -I https://pkgs.k8s.io    # 不通则先修 NAT/DNS/代理
```

---

## 六、containerd（全部节点）

```bash
sudo apt install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
grep SystemdCgroup /etc/containerd/config.toml   # 确认 true；containerd 2.x 核对实际 runc 段
sudo systemctl enable --now containerd
sudo systemctl restart containerd

sudo apt install -y cri-tools || true   # 无包则装官方 crictl 发布包
sudo tee /etc/crictl.yaml <<'EOF'
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
EOF
sudo crictl info
```

**阶段验收**：四台 `containerd` active，`crictl info` 成功。

---

## 七、kubeadm / kubelet / kubectl（v1.37）

全部节点：

```bash
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.37/deb/Release.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.37/deb/ /' \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt update
apt-cache madison kubeadm | head

sudo apt install -y kubelet kubeadm
sudo apt-mark hold kubelet kubeadm
sudo systemctl enable kubelet
```

仅 Master（及可选宿主机）：

```bash
sudo apt install -y kubectl
sudo apt-mark hold kubectl
kubeadm version; kubelet --version; kubectl version --client
```

kubelet 在 init 前反复重启属正常。

---

## 八、初始化 Master

| 参数 | 值 |
|------|-----|
| advertise | 192.168.100.10:6443 |
| Pod CIDR | 10.244.0.0/16（对齐 Cilium Cluster Pool） |
| Service CIDR | 10.96.0.0/12 |
| CRI | `unix:///run/containerd/containerd.sock` |

```bash
K8S_VERSION=$(kubeadm version -o short)
# 国内拉不动 registry.k8s.io 时用阿里云；pause 需与 containerd sandbox_image 对齐并本地 retag
sudo tee /etc/kubernetes/kubeadm-init.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint:
  advertiseAddress: 192.168.100.10
  bindPort: 6443
nodeRegistration:
  criSocket: unix:///run/containerd/containerd.sock
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: ${K8S_VERSION}
controlPlaneEndpoint: "192.168.100.10:6443"
imageRepository: registry.aliyuncs.com/google_containers
networking:
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/12"
EOF

# 示例：ctr 拉阿里云 pause 后 tag 为 registry.k8s.io/pause:3.10.2，并写入 containerd sandbox_image
sudo kubeadm init --config /etc/kubernetes/kubeadm-init.yaml
```

若 `v1beta4` 报错，用 `kubeadm config print init-defaults` 看本版 API 再改。

```bash
mkdir -p "$HOME/.kube"
sudo cp -i /etc/kubernetes/admin.conf "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
kubectl get nodes    # 无 CNI 前 NotReady 正常
```

保存输出中的 join；勿外传 `admin.conf`。

---

## 九、Cilium（当前默认 CNI）

本 Lab 已从 Flannel **原地切换**为 Cilium **v1.18.4**（VXLAN，`10.244.0.0/16`，**保留 kube-proxy**）。细节见 [[REQ-CNI切换Cilium]]、[[容器网络/08-CNI三选一安装与配置]]。

```bash
# 宿主机代理下装 CLI（示例 v0.20.2），拷到 master：/usr/local/bin/cilium
# 若集群上仍有 Flannel：先删 kube-flannel，清各节点 /etc/cni/net.d/*flannel*，再装
export HTTPS_PROXY=http://192.168.100.1:17897 HTTP_PROXY=http://192.168.100.1:17897
export NO_PROXY=localhost,127.0.0.1,192.168.100.0/24,10.0.0.0/8,10.244.0.0/16,10.96.0.0/12,.svc,.cluster.local
cilium install --version 1.18.4 \
  --set ipam.operator.clusterPoolIPv4PodCIDRList="{10.244.0.0/16}" \
  --set routingMode=tunnel --set tunnelProtocol=vxlan \
  --set kubeProxyReplacement=false
cilium status --wait
kubectl get nodes -o wide   # 4 Ready；net.d 仅 05-cilium.conflist
```

镜像来自 `quay.io/cilium/*`，节点 containerd 需走宿主机代理。UDP **8472**（VXLAN）。

业务镜像若 `docker.io` EOF，可临时改 DaoCloud：`docker.m.daocloud.io/library/<image>`。

---

## 十、Worker 加入

Master：

```bash
sudo kubeadm token create --print-join-command
```

每台 Worker（补上 cri-socket）：

```bash
sudo kubeadm join 192.168.100.10:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --cri-socket unix:///run/containerd/containerd.sock
```

```bash
kubectl get nodes -o wide
kubectl label node k8s-worker01 node-role.kubernetes.io/worker=
kubectl label node k8s-worker02 node-role.kubernetes.io/worker=
kubectl label node k8s-worker03 node-role.kubernetes.io/worker=
```

---

## 十一、功能验收

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide

kubectl create deployment nginx --image=nginx:stable --replicas=6
kubectl expose deployment nginx --port=80 --target-port=80 --type=ClusterIP
kubectl get pods -o wide
kubectl run dns-test --image=busybox:1.36 --restart=Never -it --rm -- \
  wget -qO- http://nginx
```

可选：`cordon` / `drain` / `uncordon` 练维护（有重要负载时勿乱 drain）。

---

## 十二、备份

### etcd 快照（Master）

```bash
ETCD_ID=$(sudo crictl ps -q --name etcd | head -n 1)
sudo crictl exec "$ETCD_ID" etcdctl snapshot save /var/lib/etcd/snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

sudo mkdir -p /maotuan/kvm-k8s/backup
# 从 guest 拷到宿主机示例（在宿主机执行）：
# scp ops@192.168.100.10:/tmp/snapshot.db /maotuan/kvm-k8s/backup/
```

### KVM 快照

可在「OS 装完 / runtime 就绪 / 集群 Ready」等节点打 virt 快照；**四台独立快照 ≠ 集群一致**，不能代替 etcd 备份。

---

## 十三、端口（实验向）

| 端口 | 用途 |
|------|------|
| TCP 6443 | API |
| TCP 2379–2380 | etcd（勿对不可信网暴露） |
| TCP 10250 | kubelet |
| UDP 8472 | Cilium VXLAN |
| 30000–32767 | NodePort（按需） |

---

## 十四、后续组件（先别一次装满）

基础跑稳后再加：Helm → Ingress → Metrics Server → Prometheus/Grafana → 存储 CSI。  
先看：`free -h` · `kubectl describe nodes` · `kubectl get po -A`。

---

## 十五、验收清单

- [ ] win11 等大内存 VM 已释放；`free -h` 够开四客机  
- [ ] `/maotuan/kvm-k8s/{iso,images,backup}` 可用  
- [ ] `k8s-nat` active，`.1` 网关在  
- [ ] 四 Ubuntu 26.04 静态 IP + SSH + 互 ping  
- [ ] swap off；模块/sysctl；containerd + SystemdCgroup  
- [ ] kube 组件 v1.37 一致且 hold  
- [ ] init + Cilium + 三 Worker Ready  
- [ ] CoreDNS / 跨节点 Pod / ClusterIP + DNS 测通  
- [ ] etcd 快照落到 `/maotuan/kvm-k8s/backup/`  

重置客机集群：`kubeadm reset -f`；整机重来：`virsh destroy/undefine` + 删 qcow2（慎）。

---

## 十六、目录速查

```text
/maotuan/kvm-k8s/
├── iso/ubuntu-26.04.1-live-server-amd64.iso   # symlink
├── images/                                    # *.qcow2
├── backup/                                    # etcd/配置
└── scripts/                                   # 可放 create_vm 等
```

通用 kubeadm 说明仍见 [[02-kubeadm安装集群]]；本篇只钉**本机 Lab 路径与四节点流程**。
