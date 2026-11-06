# 11 · Lab Master 常用命令速查

> 环境：`ops@192.168.100.10`（k8s-master01）· kubeadm **v1.37.2** · CNI **Cilium 1.18.4** · 保留 kube-proxy  
> 通用 kubectl：[[08-运维日常]] · 排障：[[09-排障手册]] · CNI：[[容器网络/07-CNI工具使用]] · 部署：[[03-KVM四节点集群部署手册]]

---

## 0. 登录与 kubeconfig（先过这关）

```bash
# 宿主机 → master
ssh ops@192.168.100.10

# 推荐用 ops（已有 ~/.kube/config）
kubectl get nodes

# 若用 root：须有 /root/.kube/config，否则会连 localhost:8080 报错
sudo mkdir -p /root/.kube
sudo cp -f /etc/kubernetes/admin.conf /root/.kube/config
sudo chmod 600 /root/.kube/config
# 或临时：
export KUBECONFIG=/etc/kubernetes/admin.conf
```

| 现象 | 原因 | 处理 |
|------|------|------|
| `dial tcp [::1]:8080: connection refused` | 当前用户无 kubeconfig | 拷 `admin.conf` 或 `export KUBECONFIG=...` |
| Cilium status 全红但连 8080 | 同上，不是 Cilium 挂了 | 先修 kubectl 再 `cilium status` |

---

## 1. 集群一眼看健康

```bash
kubectl get nodes -o wide
kubectl get pods -A -o wide
kubectl get svc -A
kubectl get --raw='/readyz?verbose' | head
kubectl version
```

---

## 2. Cilium（本 Lab 默认 CNI）

```bash
cilium status                 # 总览：期望 Cilium/Operator/Envoy = OK
cilium status --verbose
cilium version

# Agent / Operator Pod
kubectl -n kube-system get pods -o wide | grep -E 'cilium|NAME'
kubectl -n kube-system logs -l app.kubernetes.io/name=cilium-agent --tail=100

# 进本机 agent 看 endpoint / 服务
kubectl -n kube-system exec -it ds/cilium -c cilium-agent -- cilium status
kubectl -n kube-system exec -it ds/cilium -c cilium-agent -- cilium endpoint list
kubectl -n kube-system exec -it ds/cilium -c cilium-agent -- cilium service list

# 节点 CNI 配置（应仅有 05-cilium.conflist）
sudo ls -la /etc/cni/net.d/
```

可选（耗时长、会拉镜像）：

```bash
cilium connectivity test
# Hubble 未开；需要时：cilium hubble enable
```

---

## 3. 工作负载与 Service 验收

```bash
# 部署（docker.io 不通时用 DaoCloud）
kubectl create deployment nginx --image=docker.m.daocloud.io/library/nginx:1.27-alpine --replicas=2
kubectl expose deployment nginx --port=80
kubectl rollout status deploy/nginx
kubectl get pods -o wide -l app=nginx
kubectl get svc nginx

# DNS + HTTP
kubectl run dns-lookup --rm -i --restart=Never \
  --image=docker.m.daocloud.io/library/busybox:1.36 --command -- \
  nslookup nginx.default.svc.cluster.local

kubectl run dns-test --rm -i --restart=Never \
  --image=docker.m.daocloud.io/library/busybox:1.36 --command -- \
  wget -qO- --timeout=8 http://nginx.default.svc.cluster.local

# 清理
kubectl delete deploy nginx svc nginx --ignore-not-found
```

---

## 4. 日志 / 事件 / 进容器

```bash
kubectl describe pod <pod> -n <ns>
kubectl logs -f deploy/<名> -n <ns>
kubectl logs <pod> -n <ns> --tail=200
kubectl logs <pod> -n <ns> --previous
kubectl get events -A --sort-by=.lastTimestamp | tail -30

kubectl exec -it <pod> -n <ns> -- sh
kubectl port-forward svc/nginx 8080:80
```

---

## 5. 节点侧（kubelet / containerd）

```bash
sudo systemctl status kubelet containerd --no-pager
sudo journalctl -u kubelet -e --no-pager | tail -80
sudo crictl ps
ls /etc/kubernetes/manifests/          # 静态 Pod
```

代理（拉镜像用，已配在 containerd）：`HTTP(S)_PROXY=http://192.168.100.1:17897`

---

## 6. 扩缩与滚动

```bash
kubectl scale deploy/nginx --replicas=3
kubectl set image deploy/nginx nginx=docker.m.daocloud.io/library/nginx:1.27-alpine
kubectl rollout status deploy/nginx
kubectl rollout undo deploy/nginx
kubectl apply -f app.yaml
kubectl delete -f app.yaml
```

---

## 7. 一页速查

| 目的 | 命令 |
|------|------|
| API 通不通 | `kubectl get nodes` |
| CNI 通不通 | `cilium status` |
| Pod 落点 / IP | `kubectl get po -A -o wide` |
| 为何 Pending | `kubectl describe pod ...` → Events |
| DNS | `nslookup xxx.default.svc.cluster.local`（busybox） |
| Service HTTP | `wget -qO- http://<svc>.<ns>.svc.cluster.local` |
| root 连不上 API | 配 `/root/.kube/config` |
| 镜像 EOF | 换 `docker.m.daocloud.io/library/...` |

下一篇：[[09-排障手册]]
