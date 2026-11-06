# 06 · kind 实操：追踪一个包的路径

> 目标：在本机用 kind 起一个多节点集群，亲手验证 **同节点 / 跨节点 Pod 互通** 与 **Service**，并对照 [[01-Linux虚拟网络基石]]、[[03-Kubernetes网络模型与Service]]。  
> 环境假设：Linux + Docker；本机若尚未安装，先装 Docker、`kind`、`kubectl`。  
> 深读对照：quant67 [07 网络模型文内 kind 实验](https://quant67.com/post/k8s-network/07-k8s-network-model/k8s-network-model.html)。

## 0. 准备

```bash
# 检查
docker info >/dev/null && echo docker_ok
command -v kind kubectl

# 未安装时可参考（版本号按当时官方调整）：
# curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.27.0/kind-linux-amd64 && chmod +x ./kind && sudo mv ./kind /usr/local/bin/
# kubectl：https://kubernetes.io/docs/tasks/tools/
```

## 1. 建多节点集群

`kind-config.yaml`：

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```bash
kind create cluster --name netlab --config kind-config.yaml
kubectl get nodes -o wide
```

默认 CNI 一般为 kindnet（满足三条铁律即可；本实验不换 Cilium）。

用完删除：

```bash
kind delete cluster --name netlab
```

## 2. 部署测试 Pod（尽量落到不同节点）

```bash
kubectl create ns netlab

kubectl -n netlab run a --image=busybox:1.36 --restart=Never --command -- sleep 3600
kubectl -n netlab run b --image=busybox:1.36 --restart=Never --command -- sleep 3600
kubectl -n netlab run c --image=busybox:1.36 --restart=Never --command -- sleep 3600

# 看落点与 IP
kubectl -n netlab get pod -o wide
```

若三个都在同一 worker：删掉其中一个，用 `nodeName` 钉到另一节点（仅实验用）：

```bash
kubectl -n netlab delete pod c --force --grace-period=0
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: c
  namespace: netlab
spec:
  nodeName: netlab-worker2   # 改成 kubectl get node 里真实名字
  containers:
  - name: c
    image: busybox:1.36
    command: ["sleep","3600"]
EOF
kubectl -n netlab get pod -o wide
```

记下：

- 同节点一对：例如 `a`、`b`  
- 跨节点一对：例如 `a`、`c`  
- 各自 `POD_IP`、`NODE`

## 3. 实验 A：同节点 Pod → Pod

```bash
IP_B=$(kubectl -n netlab get pod b -o jsonpath='{.status.podIP}')
kubectl -n netlab exec a -- ping -c 3 "$IP_B"
```

节点上观察（另开终端）：

```bash
# kind 节点是容器，先找 worker 容器
docker ps --format '{{.Names}}' | grep netlab-worker

# 进节点看网桥 / veth（接口名因 CNI 而异）
docker exec -it netlab-worker bash -lc 'ip -br link; ip route; bridge link 2>/dev/null | head'
```

预期：通；路径大致为 `eth0 → veth → 桥/转发 → 对端 veth`（具体设备名看 `ip link`）。

## 4. 实验 B：跨节点 Pod → Pod

```bash
IP_C=$(kubectl -n netlab get pod c -o jsonpath='{.status.podIP}')
kubectl -n netlab exec a -- ping -c 3 "$IP_C"
```

在 **两端节点** 上抓包对比（接口名按实际改，可用 `any`）：

```bash
# 源节点
docker exec -it netlab-worker bash -lc "tcpdump -ni any host $IP_C -c 5"

# 目的节点
docker exec -it netlab-worker2 bash -lc "tcpdump -ni any host $IP_C -c 5"
```

观察：

- Pod 内层：源/目的是否仍是 Pod IP（符合「不经 NAT」）  
- 若有 VXLAN/封装：外层是否变成 **Node IP ↔ Node IP**

## 5. 实验 C：Service

```bash
kubectl -n netlab expose pod b --name svc-b --port=80 --target-port=80
# busybox 没有 80 服务，改用 wget 测 DNS/VIP 更合适：先起一个真正的 HTTP
kubectl -n netlab delete svc svc-b --ignore-not-found
kubectl -n netlab run web --image=nginx:1.27 --port=80
kubectl -n netlab expose pod web --name web --port=80
kubectl -n netlab get svc web -o wide

VIP=$(kubectl -n netlab get svc web -o jsonpath='{.spec.clusterIP}')
kubectl -n netlab exec a -- wget -qO- --timeout=3 "http://$VIP/" | head
kubectl -n netlab exec a -- wget -qO- --timeout=3 "http://web.netlab.svc.cluster.local/" | head
```

节点上看 Service 规则是否存在（iptables 模式时）：

```bash
docker exec netlab-worker bash -lc 'iptables -t nat -L KUBE-SERVICES -n 2>/dev/null | head -20'
```

预期：访问 VIP / DNS 名成功；直连 `web` 的 Pod IP:80 也应成功——对比「走 Service」与「直连 Pod」。

## 6. 实验 D：进 Pod netns 看「自己的 IP」

```bash
# 找到 pause/业务容器在节点上的 PID（containerd）
NODE=$(kubectl -n netlab get pod a -o jsonpath='{.spec.nodeName}')
# 在对应 kind 节点容器内：
docker exec -it "$NODE" bash -lc '
  PID=$(crictl inspect $(crictl ps -q --name a | head -1) 2>/dev/null | sed -n "s/.*\"pid\": *\([0-9]*\).*/\1/p" | head -1)
  echo PID=$PID
  nsenter -t "$PID" -n ip addr
  nsenter -t "$PID" -n ip route
'
```

对照铁律 3：Pod 内 `eth0` 地址应等于 `kubectl get pod -o wide` 里看到的 IP。

> 若节点上没有 `crictl`/`nsenter`，可：`kubectl -n netlab exec a -- ip addr`（busybox 需带 `ip`；没有则换 `nicolaka/netshoot` 镜像重做 Pod）。

## 7. 建议记录表（做完填）

| 项 | 结果 |
|----|------|
| CNI / 插件 | |
| 同节点 ping | 通 / 不通 |
| 跨节点 ping | 通 / 不通；是否看到封装 |
| Service ClusterIP | 通 / 不通 |
| DNS | 通 / 不通 |
| Pod 内 IP 与 API 是否一致 | |

## 8. 和笔记的对应关系

| 你看到的现象 | 回看 |
|--------------|------|
| veth / 桥 / 路由 | [[01-Linux虚拟网络基石]] |
| 为何要直连 Pod IP 且源 IP 不变 | [[03-Kubernetes网络模型与Service]] |
| VIP→Pod、iptables KUBE-* | [[03-Kubernetes网络模型与Service]] |
| 不通时怎么分层查 | [[05-策略安全与排障]] |

## 9. 注意

- kind 节点是 **Docker 容器套容器**，抓包接口名与裸机不同，以 `ip link` 为准。  
- 本机资源紧时把 worker 减到 2 个节点即可。  
- 笔记本休眠不影响理解；集群可随时 `kind delete` 重建。

CNI 命令：[[07-CNI工具使用]] · 总览：[[00-总览与学习路线]] · 阅读清单：[[99-参考阅读清单-quant67]]
