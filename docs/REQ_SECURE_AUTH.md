# Phase 1 需求：安全登录填写 + 运行中验证码自动探测

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-14 |
| 状态 | **Phase 2 已实现；Phase 3：单测 + E2E 已关（`make smoke-auth` 20/20，含真实站定位）**。增量需求见 `docs/REQ_CAPTCHA_LIVE.md`（已关） |
| 范围协议 | **仅 `BROWSER`（确定性旅程）**；`BROWSER_AGENT` 本期不做 |
| 用户确认 | 提交页安全填写账号密码；**拨测时自动注入登录**；验证码改为**运行中自动探测并填写** |
| 废止 | `docs/REQ_CAPTCHA_AUTH.md` 中「不做 UI 模板」「不做 DOM 探测」 |
| 沿用 | 验证码求解仍外包 Webhook；image / click / slider 自动应用契约不变 |
| 关联 | F-BRW-02 / F-BRW-06 / F-SEC-02 / F-SEC-06 · ADR-007 · `docs/REQ_CAPTCHA_AUTH.md` |

---

## 1. 目标

1. 提交拨测页提供**安全的账号/密码填写**（密码框、不回显、读接口脱敏）。  
2. 用户**不必手写** `fill` / `authSteps` JSON；Worker 在拨测执行时**自动注入登录**（探测或使用可选选择器，填入并提交）。  
3. 旅程运行中（鉴权段与业务段）**自动探测**图形码 / 点选 / 滑块；探测到则截图 → Webhook 求解 → **自动填写/点击/拖拽**，无需显式 `solveCaptcha` 步骤。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| 内置 OCR / 自研滑块引擎 | ❌ 求解仍外包 `HERMES_CAPTCHA_WEBHOOK` |
| 保证过任意验证码 | ❌ ADR-007 |
| 独立密钥库 / KMS / 凭据轮转 | ❌ 本期不建；密码仍随任务存储，读路径脱敏 |
| 加密落地 Redis（at-rest crypto） | ❌ 本期不做；内部存储明文供 Worker/重跑 |
| BROWSER_AGENT 自动填密/打码 | ❌ 密码禁止出域给 LLM（F-SEC-06） |
| 多账号凭据中心、团队共享保险库 | ❌ |
| 改验证码 Webhook 请求/响应字段 | ❌ 沿用现契约 |
| 自动注册 / SSO / 扫码 / OTP / 短信 | ❌ |

---

## 3. 已确认 / 建议冻结

| # | 项 | 决策 | 来源 |
|---|-----|------|------|
| 1 | 提交页账号密码 | **做**；密码 `type=password` | 用户 2026-08-14 |
| 2 | 登录注入时机 | **拨测执行时**由 Worker 自动添加，不在 UI 展开成明文 `fill` 步骤 | 用户 2026-08-14 |
| 3 | 验证码 | **运行中自动探测 + 自动应用**；显式 `solveCaptcha` 保留为可选覆盖 | 用户 2026-08-14 |
| 4 | 协议 | **仅 BROWSER** | 建议冻结 |
| 5 | 求解器 | **仍仅 Webhook** | 沿用 |
| 6 | 选择器 | **可选**；空则 DOM 探测登录框 | 建议冻结 |
| 7 | 读 API 脱敏 | GET/审计/详情中密码 → `[REDACTED]`；Worker 内部与重跑用存储原文 | 建议冻结（F-SEC-02） |
| 8 | 探测失败策略 | 未配 Webhook 且**探测到**验证码 → 步骤失败 `retryable=false`；未探测到则与现网一致 | 建议冻结 |
| 9 | Agent | **本期不做** | 建议冻结 |

---

## 4. 需求明细

### 4.1 安全凭据（提交页 + payload）

提交页（`BROWSER`）增加可选「登录信息」：

| 字段 | UI | payload | 必填 |
|------|-----|---------|------|
| 用户名 | text | `credentials.username` | 填了密码则必填 |
| 密码 | password，不回显 | `credentials.password` | 填了用户名则必填 |
| 登录 URL | 可选；空=使用任务目标 URL / 首个 navigate | `credentials.loginUrl` | 否 |
| 用户名选择器 | 可选高级 | `credentials.userSelector` | 否 |
| 密码选择器 | 可选高级 | `credentials.passSelector` | 否 |
| 提交按钮选择器 | 可选高级 | `credentials.submitSelector` | 否 |

未填用户名且未填密码 → 行为与现网一致（无自动登录）。

**安全约束（必须）**

| 面 | 规则 |
|----|------|
| UI | 密码框；提交成功后输入框可清空；任务详情**不展示**密码明文 |
| Gateway 读路径 | `GET /v1/jobs/{id}`、创建响应、cancel/rerun **响应**、审计事件：`credentials.password` 及任何 `action=fill` 且选择器匹配 password 的 `value` 替换为 `[REDACTED]` |
| Gateway 写/内部 | Redis 存储与 Worker 领取的报文**保留原文**，否则无法执行与重跑 |
| 日志 | 禁止打印密码、Authorization、完整 Cookie |
| 步骤结果 | 只记 `auth-auto-fill` 成功/失败，**不回写**填入值 |
| LLM | 本期不把凭据交给 Agent |

**不保证**：失败截图 / Playwright Trace 中页面已渲染的密码点（浏览器页面本身可见）。不在本期做 DOM 打码。

### 4.2 拨测时自动注入登录（Worker）

当 `credentials.username` 与 `credentials.password` 均非空：

1. 进入业务 `steps` **之前**执行自动鉴权段（记入 `result.steps`，名前缀 `auth-auto-*`）。  
2. 导航：`loginUrl` 若有则 `goto`；否则若 `steps[0]` 为 `navigate` 则先执行该 navigate（业务段不再重复同一 URL）；否则 `goto` 提交页上的目标 URL。  
3. **定位输入框**  
   - 选择器已给 → 直接用。  
   - 未给 → 探测：`input[type=password]` 作为密码框；同表单或邻近的 `input[type=text|email|tel]` / `name|id|autocomplete` 含 user/account/login/email/用户 作为用户名。  
   - 零个或多个密码框无法唯一确定 → 失败，提示补选择器。  
4. `fill` 用户名、密码（拟人节奏沿用现有，若有）。  
5. **插入验证码探测**（见 4.3）。  
6. 提交：选择器已给则 click；否则 `button[type=submit]` / 可见文本为「登录」「登入」「Sign in」「Log in」的按钮。找不到提交钮且用户未给选择器 → 对密码框按 Enter。  
7. 等待登录完成（密码框消失 **或** URL 变化 **或** 超时，建议 15s）。超时且仍停在登录页 → 鉴权失败，**不跑业务段**（F-BRW-02）。  

若 payload 同时带手写 `authSteps`：先跑自动登录，再跑 `authSteps`，再跑业务 `steps`。

无凭据、仅手写 `authSteps`：保持现网行为。

### 4.3 运行中自动探测验证码

**触发点**（BROWSER 全程，含自动登录与业务步骤之后）：

- 每次 `navigate` / `click` / `fill` / `drag` / 自动提交之后  
- 短暂稳定等待（建议 300–800ms，可与 `resourceSettleMs` 下限对齐）  

**探测信号**（命中任一强信号即可；实现可组合，须可单测）：

| 类 | 示例 |
|----|------|
| 第三方 iframe | 源含 recaptcha / hcaptcha / geetest / captcha / tencent / aliyun / netease |
| 滑块 | `[class*="slider"]` 且与 captcha/verify/geetest 相关；常见「向右滑动」文案 |
| 图形/字符 | `img`/`canvas` 位于 captcha 容器；`input` placeholder/name 含验证码/captcha |
| 点选 | 文案含「请依次点击」「点选」且存在验证码容器 |
| 通用容器 | `[id|class*="captcha" i]`、`[class*="geetest"]` 等 |

**探测到之后**

1. 未配置 `HERMES_CAPTCHA_WEBHOOK` → 失败：`captcha detected but solver not configured`，`retryable=false`。  
2. 已配置 → 截图（优先容器，否则视口）→ 现有 Webhook 契约 → **自动应用** fill / 多点 click / drag（与 F-BRW-06 相同）。  
3. 应用后再等验证码消失；仍在则**再求一次**（同一出现最多 2 次）。  
4. 整单最多 **3 次**成功/失败求解；超限失败。  
5. 无验证码的页面：探测为否，**不得**调用 Webhook，行为与现网一致。

显式 `{ "action": "solveCaptcha" }` **保留**：强制求解，不依赖探测。

`autoCaptcha` payload 开关：默认 **`true`**（BROWSER）。设 `false` 则关闭自动探测，仅显式步骤生效。

### 4.4 UI

- 提交页：登录信息折叠/可选区块；高级选择器默认收起。  
- 不提供验证码类型选择（运行时探测）。  
- 文案提示：需 Worker 配置 `HERMES_CAPTCHA_WEBHOOK` 才能过验证码。  
- 任务详情：凭据区密码显示 `[REDACTED]`；步骤失败 message 可含 captcha/login 原因（不含密码）。

### 4.5 Agent

本期不增强。现有 `maybeSolveCaptcha` 粗钩子可原样保留，不纳入验收。

---

## 5. 验收与测试

| ID | 内容 |
|----|------|
| T-Cred-01 | 提交页填用户名+密码 → 创建任务；GET 详情密码为 `[REDACTED]` |
| T-Cred-02 | 静态登录页（无验证码）：自动探测账号/密码框并登录，再跑业务断言 |
| T-Cred-03 | 无凭据提交：与现网一致，不注入 auth-auto |
| T-Cred-04 | 多密码框且无选择器 → FAILED，提示补选择器，不跑业务段 |
| T-Cred-05 | 重跑终态任务：仍能用存储原文登录成功（响应仍脱敏） |
| T-CapAuto-01 | 登录后出现 mock 字符码：自动探测 → fill → 成功 |
| T-CapAuto-02 | mock 点选：自动探测 → click points → 成功 |
| T-CapAuto-03 | mock 滑块：自动探测 → drag → 成功 |
| T-CapAuto-04 | 无验证码页：不调用 Webhook |
| T-CapAuto-05 | 探测到验证码但未配 Webhook → FAILED，非 RETRY_WAIT |
| T-CapAuto-06 | `autoCaptcha=false`：出现验证码也不自动打码 |
| 回归 | `make smoke-browser`（S12/S13）仍绿 |

---

## 6. 确认清单

| # | 项 | 状态 |
|---|-----|------|
| 1 | UI 安全填写账号密码 | ✅ 用户已确认 |
| 2 | 拨测时 Worker 自动注入登录 | ✅ 用户已确认 |
| 3 | 运行中自动探测验证码并填写 | ✅ 用户已确认 |
| 4 | 仅 BROWSER；Agent 不做 | ✅ 按建议冻结 |
| 5 | 求解仍 Webhook；无内置打码 | ✅ 按建议冻结 |
| 6 | 选择器可选；空则探测 | ✅ 按建议冻结 |
| 7 | 读 API 脱敏、存储原文供执行/重跑 | ✅ 按建议冻结 |
| 8 | 未配 Webhook 且探测到验证码则失败 | ✅ 按建议冻结 |
| 9 | 进入 Phase 2 | ✅ 2026-08-14 用户确认 |

---

## 7. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-14 | 首稿：废止「无 UI / 无探测」；安全凭据 + 运行时验证码探测 |
| 0.2 | 2026-08-14 | 用户确认默认项；冻结并进入 Phase 2 |
| 0.3 | 2026-08-14 | Phase 3：单测关；E2E 列入 D16 |
| 0.4 | 2026-08-14 | E2E 关闭：`scripts/auth_captcha_smoke.sh` 15/15 |
| 0.5 | 2026-08-14 | 增量：真实环境验证码定位与正确填写 → `docs/REQ_CAPTCHA_LIVE.md` |
| 0.6 | 2026-08-14 | 定位增量 Phase 3 关闭：`smoke-auth` 20/20 |
