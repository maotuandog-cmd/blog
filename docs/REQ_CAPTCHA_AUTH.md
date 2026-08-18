# Phase 1 需求：登录鉴权增强 + 验证码可插拔（F-BRW-06 · F-DET-03）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-13 |
| 状态 | **Phase 2 已实现（单测绿；E2E 需自备 webhook）**。UI 模板与运行中 DOM 探测已改由 `docs/REQ_SECURE_AUTH.md` 覆盖 |
| 范围协议 | **仅 `BROWSER`（确定性旅程）**；`BROWSER_AGENT` 本期不做 |
| 前置 | `fill`/`click` 可填账号密码；无内置打码；Webhook 钩子过粗 |
| 关联 | `docs/REQUIREMENTS.md`（F-BRW-02/06、F-DET-03）· `docs/ADR.md`（ADR-007） |

---

## 1. 目标

1. 确定性旅程中，对**图形码（image）/ 点选（click）/ 滑块（slider）**提供统一 `solveCaptcha` 步骤。  
2. 调用外部 Webhook 求解后，**由 Hermes 自动执行**填字 / 点击坐标 / 拖拽，旅程作者无需再手写后续操作步。  
3. **不做** DOM 自动探测；**不做**提交页登录模板；**不改** Agent。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| 内置 OCR / 自研滑块引擎 | ❌ 求解外包 Webhook |
| DOM 自动发现验证码并触发 | ❌ 已确认不做 |
| UI 登录/验证码向导 | ❌ 已确认不做 |
| BROWSER_AGENT / LLM 发 `solveCaptcha` | ❌ 本期不做（现有粗钩子可保留不增强） |
| 多供应商 SDK 抽象 | ❌ 仅 Webhook 契约 |
| 保证过任意验证码 | ❌ ADR-007 |

---

## 3. 已确认决策

| # | 项 | 决策 |
|---|-----|------|
| 1 | 验证码类型 | **image + 点选(click) + slider**；`solveCaptcha` 后 **自动应用**求解结果 |
| 2 | DOM 自动探测 | **不做** |
| 3 | 求解器形态 | **仅 Webhook**（未口头确认，按建议冻结） |
| 4 | 失败重试 | **`retryable=false`**（未口头确认，按建议冻结） |
| 5 | UI 模板 | **不做** |
| 6 | Agent | **本期不考虑** |

---

## 4. 需求明细

### 4.1 扩展动作（仅 BROWSER `authSteps` / `steps`）

| action | 语义 |
|--------|------|
| 现有 `navigate`/`fill`/`click`/`wait`/`assertText`/`screenshot` | 不变 |
| `solveCaptcha` | 截图（及可选 hint）→ Webhook → **自动**按响应执行 fill / 多点 click / drag |
| `drag` | 底层拖拽原语（可被 `solveCaptcha` 内部调用；也可供脚本显式使用） |

`solveCaptcha` 入参（建议）：

| 字段 | 说明 |
|------|------|
| `kind` | 默认 **`auto`**；也可显式 `image` \| `click` \| `slider` |
| `selector` | 可选：验证码容器 / 输入框 / 滑块把手 |
| `value` | 可选：透传 hint（如 siteKey） |
| `timeoutSec` | 可选：覆盖求解超时 |

**自动应用规则（冻结）**

| Webhook 返回 | Hermes 行为 |
|--------------|-------------|
| `{ "solved": true, "kind": "image", "text": "…" }` | 向 `selector`（或响应指定 `fillSelector`）`fill` 文本 |
| `{ "solved": true, "kind": "click", "points": [{x,y},…] }` | 按坐标依次 click（坐标系：响应须声明 `coord":"viewport"|"page"`，默认 viewport） |
| `{ "solved": true, "kind": "slider", "offsetX": N }` 或 `track` | 对 `selector`（滑块）执行 drag / 轨迹 |
| `{ "solved": false, "reason": "…" }` 或超时 / 未配置 | 步骤失败 → 旅程失败，`retryable=false` |

未配置 `HERMES_CAPTCHA_WEBHOOK` 时调用 `solveCaptcha` → 立即失败，明确错误信息。

---

### 4.2 Webhook 契约

**请求**

```json
{
  "jobId": "...",
  "pageUrl": "...",
  "kind": "auto|image|click|slider",
  "screenshotBase64": "...",
  "hint": { "selector": "...", "siteKey": "..." }
}
```

**响应**：见上表；`kind` 在 `auto` 请求时由求解器回传实际类型。

| 环境变量 | 说明 |
|----------|------|
| `HERMES_CAPTCHA_WEBHOOK` | 必配才可跑 `solveCaptcha` |
| `HERMES_CAPTCHA_TIMEOUT_SEC` | 默认 60 |
| `HERMES_CAPTCHA_API_KEY` | 可选，写入请求头 |

---

### 4.3 触发方式

- **仅显式步骤**：旅程中写 `{ "action": "solveCaptcha", ... }`。  
- **不做** navigate/click 后的自动探测。

典型鉴权段：

```json
"authSteps": [
  { "action": "navigate", "url": "https://app.example/login" },
  { "action": "fill", "selector": "#user", "value": "alice" },
  { "action": "fill", "selector": "#pass", "value": "***" },
  { "action": "solveCaptcha", "kind": "auto", "selector": ".captcha" },
  { "action": "click", "selector": "button[type=submit]" }
]
```

---

### 4.4 UI

- 提交页：**不做**登录/验证码表单。  
- 任务详情：沿用现有步骤错误展示即可（失败 message 含 captcha 原因）。

---

### 4.5 Agent

- 本期**不增强**；不要求 Agent 走新契约。  
- 现有 `maybeSolveCaptcha` 可原样保留，不纳入本需求验收。

---

## 5. 验收与测试

| ID | 内容 |
|----|------|
| T-Auth-01 | 无验证码：fill×2 + click 仍成功 |
| T-Cap-01 | mock：image → 自动 fill → 成功 |
| T-Cap-02 | mock：click points → 自动点击 → 成功 |
| T-Cap-03 | mock：slider offsetX → 自动 drag → 成功 |
| T-Cap-04 | 无 Webhook + `solveCaptcha` → FAILED，非 RETRY_WAIT |
| 文档 | `worker-browser/README` 契约；`docs/TEST.md` 补用例 |

---

## 6. 确认清单（已关）

| # | 项 | 状态 |
|---|-----|------|
| 1 | image + 点选 + slider，求解后自动应用 | ✅ |
| 2 | 不做 DOM 自动探测 | ✅ |
| 3 | 仅 Webhook | ✅（建议默认） |
| 4 | `retryable=false` | ✅（建议默认） |
| 5 | 不做 UI 模板 | ✅ |
| 6 | 不做 Agent | ✅ |
| 7 | 进入 Phase 2 | ✅ 已实现（`solveCaptcha`/`drag` + Webhook 契约） |

---

## 7. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-13 | 首稿 |
| 0.2 | 2026-08-13 | 用户确认：点选+image+slider 自动应用；不做探测/UI/Agent；冻结待开 Phase 2 |
| 0.3 | 2026-08-13 | Phase 2：worker `solveCaptcha`/`drag`；Go step 字段；单测 captcha_ok |
