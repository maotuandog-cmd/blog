# Phase 1 需求：浏览器 Web Vitals + 失败 Trace + Prometheus 契约

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-13 |
| 状态 | **Phase 2+联调完成（E2E ✅）；剩余体验项见 DEFECTS D13/D14** |
| 前置 | 用户确认：Hermes **不做告警产品**；告警交 Prometheus / Alertmanager |
| 关联 | `docs/REQUIREMENTS.md`（F-BRW-*、F-OBS-01、G3）· `docs/PHASE2.md` · `docs/ADR.md` |

---

## 1. 目标

在现有 `BROWSER` / `BROWSER_AGENT` 上补齐两类能力，且**不引入应用内告警**：

1. **可选 Web Vitals / 合成体验指标采集**，写入任务结果，并暴露为可刮取的 Prometheus 指标。  
2. **失败（或可选：超阈）时保留 Playwright Trace**，增强排障，与现有截图/页面文本并列。  
3. **提供 Alertmanager 规则示例文档**（仅配置样例，不在 Hermes 内实现规则引擎/通知）。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| Hermes UI「告警中心」产品化 | 不实现规则、通知、静默、认领 |
| 应用内启发式告警升级为正式功能 | 现有占位可保留为运维调试，不作为验收 |
| 全站 RUM / 后端 APM / 慢 SQL | 边界外 |
| 默认全开录屏、全量 HAR（含响应体） | 本期不做；HAR 仅可作为后续可选 |
| Trace Base64 塞进 Job / 仅本地 path | **已否决**；Trace 走 **MinIO（S3 兼容）**，结果只留 URL |
| INP 真实用户交互采样 | 合成拨测用 **TBT** 替代 |
| F-LLM-07、Web 终端、多地域地图 | 不在本期 |

---

## 3. 需求明细

### 3.1 F-BRW-09：可选 Web Vitals 采集（P1）

**描述**  
任务 payload 增加开关 `collectWebVitals`（默认 `false`）。开启后，在旅程合适时机（建议：业务段导航稳定后 / `networkidle` 或现有 `resourceSettleMs` 对齐）采集合成监控指标。

**最低采集集（须写入 `result.metrics`，单位注明）**

| 指标键（建议） | 含义 | 单位 |
|----------------|------|------|
| `hermes_browser_ttfb_ms` | Navigation TTFB | ms |
| `hermes_browser_fcp_ms` | First Contentful Paint | ms |
| `hermes_browser_lcp_ms` | Largest Contentful Paint | ms |
| `hermes_browser_tbt_ms` | Total Blocking Time（Long Task 合成替代 INP） | ms |
| `hermes_browser_dom_nodes` | 采集时刻 DOM 节点数 | count |
| `hermes_browser_js_heap_used_bytes` | JS 堆已用（Chromium `performance.memory`，不可用则为缺省/不写） | bytes |

**附加**

- 允许在 `result.extra.webVitals` 放原始/调试字段（采集时刻、是否超时等）。  
- 采不到的项：**不造假 0**；可省略该键或显式 `-1`（须在文档固定一种语义，推荐「省略」）。  
- 与 `collectResources` 独立：可只开其一，可同时开。  
- **仅 `BROWSER`**；`BROWSER_AGENT` **本期不采 Web Vitals**（Agent 失败 Trace 仍按 §3.3，若适用）。

**验收**

- [x] 默认关闭时，行为与现网一致（无额外明显开销要求：无强制 PerformanceObserver）。  
- [x] 开启后，成功任务的 `result.metrics` 至少含 TTFB、FCP、LCP 中能稳定采到的项；TBT/DOM 尽量提供。  
- [x] 冒烟：静态页（如 `:18081`）可复现非空 LCP 或 FCP。

---

### 3.2 F-OBS-02：浏览器体验指标 Prometheus 暴露（P1）

**描述**  
Gateway（或约定的唯一刮取端）`/metrics` 增加与浏览器拨测体验相关的指标，供 Prometheus 刮取；**告警规则不在 Hermes 实现**。

**建议指标（标签须可控，避免高基数爆炸）**

| 名称 | 类型 | 标签（建议） | 说明 |
|------|------|--------------|------|
| `hermes_browser_journey_finished_total` | Counter | `protocol`, `success`, `app` | 旅程终态次数；`app` 来自 `labels.app` 或缺省 `job.name`（需截断/规范化） |
| `hermes_browser_vitals_ttfb_milliseconds` | Histogram 或 Gauge | `protocol`, `app` | 最近/观测分布；**推荐 Histogram** |
| `hermes_browser_vitals_lcp_milliseconds` | Histogram | `protocol`, `app` | 同上 |
| `hermes_browser_vitals_fcp_milliseconds` | Histogram | `protocol`, `app` | 同上 |
| `hermes_browser_vitals_tbt_milliseconds` | Histogram | `protocol`, `app` | 可选 |

**约束**

- `app` 标签：仅使用任务显式 `labels.app` 或规范化后的 `name`；禁止用完整 URL 当标签。  
- URL 级明细留在 Job 结果 / 审计，不进 Prometheus 标签。  
- 仅在任务成功采到对应 vitals 时 observe；失败旅程仍计 `journey_finished{success="false"}`。

**验收**

- [x] `GET /metrics`（**worker-core** `HERMES_METRICS_ADDR`，默认 `:8081`）含上述指标族（名称可微调，但须文档冻结）。→ **T-Prom-01**  
- [x] 跑通一次带 `collectWebVitals` 的成功任务后，对应 bucket/gauge 有增量。→ **T-Prom-01**  
- [x] `deploy/` 或 `docs/` 提供 **Alertmanager 规则示例**（成功率、LCP P95），标明「示例配置，非 Hermes 功能」。

> 刮取约定：journey/vitals/jobs_finished 在 **worker-core**；Gateway `:8080/metrics` 为入队等控制面指标。

---

### 3.3 F-BRW-10：失败 Playwright Trace → MinIO（P1）

**描述**  
在现有 F-BRW-04（截图 + 页面文本）基础上，失败时额外产出 Playwright **trace**（`tracing.start` / `stop`），上传至 **MinIO（S3 兼容）**，任务结果只保留可访问的 URL（及可选过期时间），便于用 [trace.playwright.dev](https://trace.playwright.dev/) 回放。

**行为**

| 场景 | 行为 |
|------|------|
| `BROWSER` 任务失败 | 默认尝试生成 Trace 并上传 MinIO |
| `BROWSER_AGENT` 任务失败 | **同期支持** Trace → MinIO（排障需要；与 Vitals 范围无关） |
| 任务成功 | 默认 **不** 生成/上传 Trace |
| 可选 payload 开关 | `captureTrace?: "on_failure" \| "always" \| "never"`，默认 `on_failure` |
| MinIO 未配置或上传失败 | 任务仍按原逻辑失败/成功；`artifacts.traceError` 记录原因；截图/文本仍按 F-BRW-04 保留 |

**产物形态（已确认：MinIO）**

- 对象键建议：`hermes/traces/{yyyy}/{mm}/{jobId}.zip`（可调）。  
- `artifacts.traceUrl`：预签名 URL 或网关可访问的下载地址（须文档冻结一种）。  
- `artifacts.traceObjectKey`（可选）：便于运维定位。  
- **禁止**默认把整包 Trace Base64 写入 Redis Job（体积与多副本成本过高）。  
- 截图本期可仍用 Base64（现状）；后续可同样迁 MinIO（非本需求强制）。

**配置（环境变量，名称可在 Phase 2 微调）**

| 变量 | 说明 |
|------|------|
| `HERMES_S3_ENDPOINT` | MinIO/S3 endpoint |
| `HERMES_S3_BUCKET` | bucket |
| `HERMES_S3_ACCESS_KEY` / `HERMES_S3_SECRET_KEY` | 凭证 |
| `HERMES_S3_REGION` | 可选 |
| `HERMES_S3_FORCE_PATH_STYLE` | MinIO 通常为 true |
| `HERMES_TRACE_URL_TTL_SEC` | 预签名过期（若用预签名） |

未配置 S3 时：不阻断拨测主流程；Trace 能力降级为「无 URL + traceError」。

**非本期**：全量视频；含响应体的 HAR。

**验收**

- [x] 故意失败的 BROWSER 任务：MinIO 中有 zip；Job 含 `traceUrl`（或明确的 `traceError`）。→ **T-Trace-01**  
- [x] 成功任务默认无 Trace 对象。→ **T-Trace-01**  
- [x] UI 任务详情：有 `traceUrl` 时可打开/下载。  
- [x] `deploy/` 提供 MinIO 本地 docker 样例与所需环境变量说明。

---

## 4. 配置与安全

- 密钥/Cookie 不得因 Trace 明文扩大暴露面：Trace 默认即可；若后续开 HAR，必须 `content: omit` 并另开需求。  
- 域名白名单、鉴权、租约、重试策略不变；BROWSER 确定性失败仍 `retryable=false`。  
- `collectWebVitals` / Trace 不得绕过 allowlist。

---

## 5. UI（范围内）

| 项 | 要求 |
|----|------|
| 提交页 | BROWSER 增加 `collectWebVitals` 开关（Agent 表单不出现该开关） |
| 任务详情 | 展示 vitals 数值；Trace 提供 `traceUrl` 链接 |
| 性能页 | 抽样可读 TTFB/FCP/LCP（`collectWebVitals` 任务）；**不**做告警配置 |
| 告警页 | 维持「交由 Prometheus」说明；不新增规则引擎 |

---

## 6. 测试与文档

| ID | 内容 |
|----|------|
| T-Vitals-01 | `collectWebVitals=true` 静态页 → metrics 含 FCP/LCP（或文档允许的子集） |
| T-Trace-01 | 断言失败 → MinIO 有对象且 Job 含 `traceUrl`（或 `traceError`） |
| T-Prom-01 | `/metrics` 刮取含 journey / vitals 指标 |
| 文档 | `docs/TEST.md` 补用例；`deploy/alertmanager-browser-examples.yml`（名称可调）仅作示例 |

---

## 7. 确认清单

| # | 项 | 状态 |
|---|-----|------|
| 1 | Trace 存储 | ✅ MinIO，结果留 `traceUrl` |
| 2 | Prometheus `app` 标签、不用 URL | ✅ |
| 3 | `collectWebVitals` | ✅ **仅 BROWSER**（Agent 不采） |
| 4 | Agent 失败 Trace → MinIO | ✅ 支持（与 Vitals 解耦） |
| 5 | 进入 Phase 2 开发 | ✅ 已实现（worker / metrics / UI / deploy 样例） |

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-13 | 首稿；明确不做 Hermes 内告警 |
| 0.2 | 2026-08-13 | Trace 改为 MinIO；确认 app 标签 |
| 0.3 | 2026-08-13 | Vitals **仅 BROWSER**；需求冻结待开 Phase 2 |
| 0.4 | 2026-08-13 | Phase 2 落地：Vitals/Trace→MinIO/Prometheus/UI/Alertmanager 示例 |
| 0.5 | 2026-08-13 | E2E 通过；冻结刮取端为 worker-core `:8081`（D15） |
