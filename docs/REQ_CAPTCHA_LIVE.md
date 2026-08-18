# Phase 1 需求：真实环境验证码定位与正确填写

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-14 |
| 状态 | **Phase 2 已实现；Phase 3：单测 + E2E 已关（`make smoke-auth` 20/20）** |
| 范围协议 | **仅 `BROWSER`**；不改 `BROWSER_AGENT` |
| 触发 | 任务 `ui-probe`（`0d218ed5-…`）打真实站 `https://51yunwei.com.cn/DCP/`：探测后对不存在的 `#captcha` `fill` 超时；账号密码未填；并非「验证码填错」 |
| 父需求 | `docs/REQ_SECURE_AUTH.md`（自动登录 + 运行中探测）· `docs/REQ_CAPTCHA_AUTH.md`（Webhook 契约） |
| 关联缺陷 | D19（真实站探测误报） |

---

## 1. 目标

在**真实登录页**（非本机 fixture）上：

1. **定位**：根据当前页面 DOM / 可见性，找出验证码输入框、图形区域、点选区或滑块把手，而不是使用本地 mock 写死的 `#captcha`。  
2. **填写**：把求解结果填到**刚才定位到的、可填写的控件**上；字符码填对后应能继续登录（求解仍外包，见 §2）。  
3. **时机**：验证码常在用户名失焦、点登录之后才出现；必须按真实页面节奏再探测，而不是只在首次 `navigate` 时打一次。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| 内置 OCR / 自研滑块 / 点选引擎 | ❌ 沿用 ADR-007：正确答案仍由 `HERMES_CAPTCHA_WEBHOOK` 给出 |
| 保证过任意验证码（含风控、行为检测、iframe 内极验） | ❌ |
| 把本机 mock webhook 当生产打码服务 | ❌ mock 只服务 `127.0.0.1` fixture |
| 改 Webhook JSON 字段名（破坏现契约） | ❌ 可**增补** `hint` 字段，不删旧字段 |
| BROWSER_AGENT 填密/打码 | ❌ |
| 独立打码供应商 SDK | ❌ 仍只 Webhook |

**职责划分（冻结建议）**

| 职责 | 谁负责 |
|------|--------|
| 验证码**在哪**、截哪一块图、往哪个控件填 | **Hermes Worker**（以当前页为准） |
| 图上的字 / 点哪里 / 滑多远 | **外部 Webhook** |
| 本机 `auth_e2e_server.py` 对未知站点返回 `AB12` + `#captcha` | **禁止用于真实站**；fixture 专用 |

没有可用的生产 Webhook 时，真实站**不能**「填对」；本期把 Hermes 侧定位与应用做对，并让 mock 不再覆盖真实选择器。

---

## 3. 现场问题（已核实，作为本期范围依据）

| 现象 | 原因 |
|------|------|
| `waiting for locator('#captcha')` 30s | 应用选择器时 **Webhook `fillSelector` 优先于页面探测**；mock 对非 `/login-click|slider` 一律返回 `#captcha` + `AB12` |
| 步骤只有 `auth-auto` 失败 | 失败发生在 **navigate 后第一次自动打码**，尚未 `fill` 用户名/密码 |
| 结束仍停在「您好，欢迎登录！…图形验证码」 | 从未提交登录 |
| DCP 实际控件 | 账号 `#username`、密码 `#password`、图形码输入 **`#verification`**（常隐藏）、图 **`#code`**；失焦/点登录后才显示 |

本期验收不以「过 DCP 风控」为必须，但 **DCP 这类「本页 img + 本页 input」图形码**必须能：定位到 `#verification`（或等价探测结果）、把求解文本填进去，而不是去填不存在的 `#captcha`。

---

## 4. 已确认 / 建议冻结

| # | 项 | 决策 | 来源 |
|---|-----|------|------|
| 1 | 定位以**当前页 DOM** 为准 | **做** | 用户 2026-08-14 |
| 2 | 能把码填到正确位置 | **做** | 用户 2026-08-14 |
| 3 | 正确答案来源 | **仍仅 Webhook**；不内置 OCR | 建议冻结（沿用） |
| 4 | Webhook `fillSelector` vs 探测选择器 | **仅当该 locator 在当前页存在且可 fill/drag 时才用**；否则回退探测结果；两者都无效 → 失败并写明两个选择器 | 建议冻结 |
| 5 | 探测对象 | **必须是可操作控件**：image → 可见 `input`/`textarea`；slider → 可见把手；不得对 `div`/`img` 调用 `page.fill` | 建议冻结 |
| 6 | 出现时机 | 用户名 `fill` 后 **blur**；密码 fill 后；提交 click 后；若图已出现但输入框未出现 → 短等再探测（建议最多 5s，间隔 400ms） | 建议冻结 |
| 7 | 截图 | 优先验证码 **img/canvas/容器** 裁剪；失败再退回视口；`hint.selector` 带上探测到的填写控件 | 建议冻结 |
| 8 | mock webhook | 仅对 fixture URL（`127.0.0.1:18083`）返回固定 `AB12`/`#captcha`；其它 URL **不得**写死 `#captcha`。实现上：`fillSelector` 用请求 `hint.selector`（若有） | 建议冻结 |
| 9 | 生产 Webhook | 打真实站必须配置**能识图的**求解服务；UI/README 明确：本机 mock 不能过公网站 | 建议冻结 |
| 10 | 协议 | 仅 BROWSER | 建议冻结 |
| 11 | 高级选择器 | 提交页可选「验证码输入框选择器」→ `credentials.captchaSelector`；空则探测 | 建议冻结 |

---

## 5. 需求明细

### 5.1 选择器解析（应用求解结果之前）

解析顺序：

1. 用户提供的 `credentials.captchaSelector` 或显式 `solveCaptcha.selector`（若该元素当前可见且可操作）。  
2. 本次探测得到的 `inputSelector` / `handleSelector`（按 kind）。  
3. Webhook 返回的 `fillSelector`，**且** `locator.count()>0` 且对 image 而言可 `fill`（`input`/`textarea`/`contenteditable`）。  

禁止：对不可 fill 的节点调用 `page.fill` 并空等 30s。  
失败文案须含：探测 selector、webhook `fillSelector`、页面 URL，便于区分「没找到框」和「码填错」。

### 5.2 探测规则补强（相对现网）

现网问题：容器/`img` 命中即可判 `image`，`selector` 可能是 `#captcha` 容器而不是输入框；隐藏的 `#verification` 被 `vis()` 丢掉后，应用阶段又被 mock 指到不存在的框。

补强：

| 规则 | 说明 |
|------|------|
| image 填写目标 | 仅 `input`/`textarea`：`id|name|placeholder|aria-label` 含 captcha/验证码/校验码，**或**紧邻验证码图的可见输入框 |
| 图与框分离 | 有可见验证码图、暂无可见输入框 → **等待**（§4.6），不要立刻用容器 id 去 `fill` |
| 文案弱信号 | 仅页面出现「图形验证码」四字、没有可见图/框 → **不**调用 Webhook |
| 用户名失焦 | 自动登录 `fill` 用户名后 `blur`，再探测（覆盖 DCP 一类延迟出码） |
| iframe 第三方码 | 探测为 `auto`/`click`/`slider` 时可截视口并交给 Webhook；**不**保证 iframe 内操作成功（非目标） |

分类优先级不变：slider → click → image。

### 5.3 截图与 hint（让求解器「有机会填对」）

Webhook 请求沿用现字段，`hint` **增补**（旧求解器可忽略）：

| hint 字段 | 说明 |
|-----------|------|
| `selector` | 填写/拖拽目标（现有） |
| `imageSelector` | 可选，验证码图/canvas |
| `kindGuess` | Worker 探测的 kind |

`screenshotBase64`：有 `imageSelector` 则截该节点（加少量 padding）；否则截容器；再否则视口。

Worker 把 Webhook 返回的 `text` **原样**填入解析后的选择器（不去改码、不截断），这是 Hermes 侧「填写正确」的全部含义。

### 5.4 应用后校验

- image：fill 后不在本步用错误码文案做 OCR 校验。  
- 若验证码控件仍在且未超求解预算 → 再求一次（沿用最多 2 次出现 / 整单 3 次）。  
- 登录提交后仍停在登录页：鉴权失败，message 区分「验证码仍在」与「账号密码错误」（若页面有可见错误文案可附带，不含密码）。

### 5.5 自动登录顺序（修订）

当存在凭据时：

1. `goto` 登录 URL  
2. 定位账号/密码框（现规则）  
3. fill 用户名 → **blur** → 探测/打码（若已出现）  
4. fill 密码 → 探测/打码（若已出现）  
5. click 登录 / Enter  
6. 若此时才出码：探测/打码 → **再次提交一次**（同一提交选择器或再次 Enter）  
7. `waitLoginSettled`

navigate 后若**尚无**可填写验证码框，不得因弱信号调用 Webhook 并 `fill` 无效选择器。

### 5.6 UI / 配置

- 高级区增加可选「验证码输入框选择器」。  
- 提交页提示：真实站点需配置**识图 Webhook**；本机 `:18084` mock 只用于 fixture。  
- 任务详情失败原因展示完整 selector 解析信息（无密码）。

### 5.7 Worker 配置

| 变量 | 说明 |
|------|------|
| `HERMES_CAPTCHA_WEBHOOK` | 生产必须指向真实求解器 |
| 本机 mock | 仅 `scripts/auth_e2e_server.py` + `make smoke-auth` |

不在本期做验证码供应商市场或 UI 里填打码 Key（仍用环境变量 `HERMES_CAPTCHA_API_KEY`）。

---

## 6. 验收与测试

| ID | 内容 |
|----|------|
| T-LiveCap-01 | fixture `/login-image`：探测 selector 为 `#captcha`（或可见输入框），fill 后登录成功；`make smoke-auth` 回归仍绿 |
| T-LiveCap-02 | 静态页：验证码图 + 输入框 id=`#verification`（无 `#captcha`）；mock **不得** fill `#captcha`；应 fill `#verification` 并成功 |
| T-LiveCap-03 | 静态页：仅有「图形验证码」文案、无图无框 → 不调用 Webhook |
| T-LiveCap-04 | 静态页：先无码，用户名 blur 后出现 `#verification` → 在 blur 后探测并 fill，再提交成功 |
| T-LiveCap-05 | Webhook 返回不存在的 `fillSelector`，探测有有效输入框 → 用探测框 fill，不超时 |
| T-LiveCap-06 | 单测：image 分类在只有容器、没有可见 input 时 **found 但不可 apply**（或 found=false 直到 input 出现），不得产出对 div 的 fill |
| 回归 | `make smoke-auth` 15 条保持通过；`make smoke-browser` |

**非门禁（手工/可选）**：对 `51yunwei.com.cn/DCP/` 配置真实 Webhook 后，应填 `#verification` 而非 `#captcha`；过站成败取决于求解器与风控，不作为 `make smoke-auth` 失败条件。

---

## 7. 确认清单

| # | 项 | 状态 |
|---|-----|------|
| 1 | 真实页 DOM 定位验证码位置 | ✅ |
| 2 | 填到正确控件；禁止无效 `#captcha` 空等 | ✅ |
| 3 | 仍无内置 OCR；正确答案来自生产 Webhook | ✅ |
| 4 | `fillSelector` 必须在页上可操作，否则回退探测 | ✅ |
| 5 | 用户名 blur 后再探测；延迟出码后可二次提交 | ✅ |
| 6 | 截图裁剪验证码区域 + hint.selector | ✅ |
| 7 | mock 不得对公网站写死 `#captcha`/`AB12` 作为唯一路径 | ✅ |
| 8 | 可选 `credentials.captchaSelector` | ✅ |
| 9 | 进入 Phase 2 | ✅ 2026-08-14 用户确认 |

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-14 | 首稿：真实站定位与正确填写 |
| 0.2 | 2026-08-14 | 用户确认冻结；进入 Phase 2 |
| 0.3 | 2026-08-14 | Phase 3：`make smoke-auth` 20/20；关闭 D21 |
