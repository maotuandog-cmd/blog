# 02 · kube-apiserver 控制面内核（蒸馏）

> 原文系列：[kube-apiserver / 控制面内核](https://quant67.com/post/apiserver/) · 全景：[01 控制面全景](https://quant67.com/post/apiserver/01-controlplane-overview/01-controlplane-overview.html)  
> 版本锚：**Kubernetes v1.30.3**（etcd 后端对照 **v3.5.33**）  
> 前置：[[01-etcd生产内核]] · 使用排障：[[kubernetes/09-排障手册]] · 地图：[[00-分类学习地图]]

## 1. 本系列回答什么

REST 请求失败落在 **HandlerChain 的哪一层**；watch cache 相对直打 etcd 换来什么坐标；**504 如何与 etcd 五轴分列**（不要 etcd 一卡就怪磁盘）。

**不写**：scheduler / controller-manager 内核；etcd Raft 全书（见 01）。

## 2. 五轴坐标系

口诀同样：**先点名 apiserver 轴，再下钻**——不要一上来扩副本或换 etcd。

| 轴 | 可核对锚点 | 典型失败表象 |
|----|------------|--------------|
| **Storage / etcd** | `storage.Interface`、codec、`/registry/`、GuaranteedUpdate | 写超时但 etcd「看起来」健康；transform/加密错误 |
| **Watch / cache** | cacher、bookmark、`resourceVersion`、穿透 etcd | **410 Gone**、List 风暴、Informer 断流 |
| **Admission** | 内置插件顺序、Mutating→Validating、webhook | 创建慢、webhook 503、突变不符合预期 |
| **Auth** | AuthN / AuthZ / Audit | **401** vs **403**；勿与 etcd mTLS 混淆 |
| **APF / 流控** | FlowSchema、PriorityLevel、max-in-flight | 排队、**504 误判成 etcd lag**、OOM |

请求大致顺序（简化）：

```text
客户端 → AuthN → AuthZ/Audit → Admission → APF 排队
       → REST → storage / watch-cache → etcd
```

## 3. 症状 → 轴（速查）

| 症状 | 优先轴 | 勿先做 |
|------|--------|--------|
| 全员 401 | AuthN | 重启 etcd |
| 全员 403 | AuthZ / RBAC | 盲目加 apiserver 副本 |
| 写返回 webhook 相关 503 | Admission | 只扩 apiserver |
| 写慢 / 504 | **APF → Storage** | 直接 defrag etcd |
| Watch **410 Gone** | Watch/cache | 乱删 Pod「试试」 |
| List 导致内存暴涨 | Watch/List → APF | 只加 etcd 节点 |
| 日志 `etcd request failed` | Storage → 再看 [[01-etcd生产内核]] | 只重启 apiserver 了事 |

深表见原文 [15 排障五轴](https://quant67.com/post/apiserver/15-troubleshoot/15-troubleshoot.html)。

## 4. 推荐阅读子集

| 路径 | 篇目 | 适合 |
|------|------|------|
| **必读核心** | 01 → 03 → 05 → 12 → **15** | 快速建立五轴 |
| 504 归因 | 01 → 05 → 09 → 12 → 15 | 超时分列 |
| Watch / 410 | 04 → 05 → 07 → 15 | Informer / List 风暴 |
| 安全准入 | 08 → 10 → 11 | 401/403/webhook |
| 运维 | 14 → 15 | HA、flags、与 etcd 联检 |

完整 01–16 目录：[系列首页](https://quant67.com/post/apiserver/)。

## 5. 和本库 kubeadm 笔记的衔接

| 使用层问题 | 升维到本系列 |
|------------|--------------|
| `kubectl` 偶发超时 | APF vs etcd lag（轴 5 vs 轴 1） |
| 控制器不 reconcile | Watch 410 / compact（轴 2 + etcd Watch） |
| 装了 ValidatingWebhook 后创建极慢 | 轴 3 timeout/failurePolicy |
| 升级控制面 | 原文 14 + kubernetes/10；certs / graceful shutdown |
| CRD / 聚合 API 503 | 原文 13 扩展边界（别当普通 etcd 故障） |

多副本 apiserver：**无内部 leader election**，共享同一 etcd；可用性靠副本 + etcd 健康，见原文 14。

## 6. 与 etcd 五轴如何联查

```text
先问：错误码 / audit / apiserver 日志像不像 Auth·Admission·APF？
  → 是：留在 apiserver 轴
  → 否且出现 etcd_request / compact / no leader：转入 etcd 五轴（本目录 01）
两轴都可疑：用「排除树」——原文 16 选型篇
```

## 7. 检查清单

- [ ] 能背出 apiserver 五轴，并与 etcd 五轴区分  
- [ ] 看到 504 会先想 APF，而不是只骂 etcd  
- [ ] 看到 410 知道是 Watch/RV/compaction 语义  
- [ ] 知道 webhook 失败与存储失败证据包不同  

地图：[[00-分类学习地图]] · 版本表：[[99-系列入口与版本锚]]
