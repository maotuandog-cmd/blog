# 需求文档 · Lab 集群 CNI：Flannel → Cilium

> **阶段**：Phase 1（仅需求，不含实施步骤/脚本）  
> **环境**：KVM 四节点 Lab · `192.168.100.10–13` · kubeadm **v1.37.2** · containerd **2.2.2** · Ubuntu **26.04.1** · 内核 **7.0.0**  
> **现状**：Flannel VXLAN · Pod CIDR `10.244.0.0/16` · 验收用 nginx Deployment/Service 仍在  
> **关联**：[[容器网络/08-CNI三选一安装与配置]] · [[03-KVM四节点集群部署手册]] · quant67 [13 · Cilium](https://quant67.com/post/k8s-network/13-cilium/cilium.html)

---

## 1. 目标

将当前 Lab 集群的 **Pod 网络 CNI 从 Flannel 切换为 Cilium**，使：

1. 四节点保持 **Ready**，CoreDNS **Running**  
2. Pod 跨节点互通、ClusterIP / DNS 可用  
3. 后续可按需启用 Hubble / NetworkPolicy（本需求以「网络可用」为主，可观测为可选验收）

---

## 2. 范围

### 2.1 In Scope

| 项 | 说明 |
|----|------|
| 卸载 Flannel | 移除 `kube-flannel` 命名空间及相关 DaemonSet/RBAC/ConfigMap；清理节点上 Flannel CNI 配置，避免双 CNI |
| 安装 Cilium | 使用官方推荐方式（Cilium CLI 或 Helm），版本与 **Kubernetes 1.37** 兼容表对齐（实施时钉 stable） |
| 数据面 | Lab 为同 NAT `192.168.100.0/24`，优先 **VXLAN/Geneve Overlay**（不强制 BGP/原生路由） |
| kube-proxy | 明确二选一并写入实施说明：① 保留现有 kube-proxy；② Cilium kube-proxy-replacement（需额外验收 Service） |
| 验收 | 节点 Ready、Cilium Agent Ready、CoreDNS、跨节点 curl/DNS；可重建或替换现有 nginx 探针 |
| 文档 | 更新 `03-KVM四节点集群部署手册` CNI 章节；与 `08-CNI三选一` 交叉引用 |

### 2.2 Out of Scope（本阶段不做）

- 重建整个 kubeadm 集群（除非切换失败且无法恢复）  
- 生产级 NetworkPolicy / 零信任策略全集  
- BGP、多集群 Cluster Mesh、Gateway API 全量落地  
- 替换宿主机 NAT / 代理架构  
- 把 Calico 作为备选并行安装  

---

## 3. 约束与前提

| 约束 | 详情 |
|------|------|
| 内核 | 已满足 Cilium 常见要求（≥ 5.10；本 Lab 为 7.0） |
| 镜像/网络 | 节点经 `192.168.100.1:17897` 代理；`ghcr.io` / `quay.io` 需可达；Docker Hub 不稳定时用镜像加速 |
| 清单拉取 | GitHub raw 可能 TLS 失败；允许 CLI/Helm chart 走代理或国内可用源 |
| Pod CIDR | 当前集群已是 `10.244.0.0/16`；Cilium 需与现有 `podSubnet` 一致或采用兼容的 IPAM（Cluster Pool），**禁止**与节点网 `192.168.100.0/24`、Service `10.96.0.0/12` 冲突 |
| 业务影响 | 切换窗口内现有 Pod 网络会中断；验收用 nginx 可删重建 |
| 权限 | 通过 `ops@192.168.100.10` 的 kubectl / 各节点 sudo |

---

## 4. 功能需求

| ID | 需求 | 优先级 |
|----|------|--------|
| R1 | 集群中仅保留 **一套** CNI（Cilium），无 Flannel 残留导致的双栈 CNI conf | P0 |
| R2 | 全部节点 `Ready`，`cilium-*` Agent（及必要 Operator）健康 | P0 |
| R3 | CoreDNS Running；`*.svc.cluster.local` 可解析 | P0 |
| R4 | 跨节点 Pod ↔ Pod、Pod → ClusterIP 互通 | P0 |
| R5 | 明确 kube-proxy 策略并验证 ClusterIP/NodePort（若启用 replacement） | P0 |
| R6 | （可选）Hubble relay/UI 或 `cilium connectivity test` 子集通过 | P1 |
| R7 | 手册与笔记反映「本 Lab 默认 CNI = Cilium」 | P1 |

---

## 5. 非功能需求

- **可回滚**：保留切换前 Flannel 清单备份路径（如 `/maotuan/kvm-k8s/backup/`）；失败时可回退 Flannel 或记录「需重建」条件  
- **可重复**：步骤可在本 Lab 再次执行；关键版本号写入手册  
- **资源**：四台 VM 规格以现有为准；若 Cilium + Hubble 内存紧张，默认关闭 UI 或缩配置  

---

## 6. 验收标准

1. `kubectl get nodes` → 4 × Ready  
2. `cilium status`（或等价 kubectl 检查）无持续 Error/CrashLoop  
3. 删除旧 nginx 后重新部署（可用 DaoCloud 等可达镜像）→ Service HTTP 200/欢迎页  
4. `nslookup <svc>.default.svc.cluster.local` 指向正确 ClusterIP  
5. `/etc/cni/net.d` 无 Flannel 主配置残留（仅 Cilium 相关）  
6. 手册已更新 CNI 章节与检查清单  

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| 双 CNI / 节点 NotReady | 先卸 Flannel 并清 `net.d`，再装 Cilium；装完再起工作负载 |
| 镜像拉取失败 | 代理 + 镜像仓库替换；必要时宿主机拉取导入 |
| kube-proxy 与 Cilium 冲突 | 实施前选定模式；replacement 时按官方顺序关/替 kube-proxy |
| 短暂全网中断 | Lab 可接受；提前告知；不在此窗口跑长任务 |
| K8s 1.37 与 Cilium 版本不匹配 | 查官方 Compatibility；选标注支持的最新 stable |

---

## 8. 待确认（进入 Phase 2 前默认值）

若无额外回复，Phase 2 采用以下默认：

1. **kube-proxy**：保留 kube-proxy（降低切换风险）；不强制 kube-proxy-replacement  
2. **Hubble**：先装 Cilium 网络；Hubble 作为可选加装  
3. **安装方式**：优先 Cilium CLI（与笔记 `08` 一致）  
4. **不重建集群**，在现有四节点上原地切换  

---

## 9. 阶段门禁

| 阶段 | 产出 | 本响应 |
|------|------|--------|
| **Phase 1** | 本需求文档 | ✅ |
| **Phase 2** | 卸载 Flannel + 安装 Cilium + 验收 | ✅（Cilium 1.18.4 OK） |
| Phase 3 | 问题/偏差记录（镜像、代理、版本等） | 待开始 |

确认本需求（或改默认项）后进入 **Phase 2 实施**。
