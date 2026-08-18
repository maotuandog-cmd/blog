# Phase 1 需求：Captcha Trace 绑定（attemptId + imageHash）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-17 |
| 状态 | **已确认；Phase 2 进行中**（与视觉层同轮；Trace 为 P0） |
| 目标 | 保证「截图 → 解析 → 填入 → 反馈」在物理上对应**同一帧图像** |
| 解决缺陷 | **S1**（异步刷新导致旧码填新框）· **A1**（假阳性无法溯源） |
| 范围 | `worker-browser` 契约与校验 + `captcha-solver` 契约回显 / 落盘 / feedback 对齐 |
| 非范围 | OCR 算法升级、VLM 升主干、MutationObserver 等图就绪、点选坐标系改造、UI |
| 关联 | `docs/CAPTCHA_SOLVER_DESIGN.md` · `docs/REQ_CAPTCHA_AUTH.md` · `docs/REQ_CAPTCHA_DECISION_SESSION.md` §12（S3 feedback） |

---

## 1. 一句话目标

> Worker 在截图瞬间生成 `attemptId` + `imageHash`；Solver 原样绑定回传并落盘；Worker 填入前用 DOM 指纹拦截「图已刷新」；业务结果经 Feedback 按 `attemptId` 回写，形成可标注的假阳性样本库。

---

## 2. 现状差距（冻结认知）

| 能力 | Solver 今日 | Worker 今日 | 本期缺口 |
|------|-------------|-------------|---------|
| `attemptId` | 多为 Solver 自生成；响应有 | **不生成、不校验** | Worker 生成并作为主键 |
| `imageHash` | 观测里有（解码后算） | **无** | Worker 截图后算，请求必带；响应顶层回显 |
| `timestamp`（截图时刻） | 无统一字段 | **无** | 请求必带 |
| 填入前 DOM 指纹校验 | N/A | **无** | 防 S1 关键拦截 |
| Feedback | `POST /captcha/feedback` 已有，键为 `sessionId`+`attemptId` | **不调用** | Worker 回写；契约字段对齐 |
| 按 hash 落盘样本 | 不完全按 Worker 指纹命名 | N/A | 采集目录对齐 `imageHash` |

结论：**闭环断在编排层**；Solver 侧有半成品，须按本契约统一主键语义。

---

## 3. 契约（冻结）

### 3.1 标识语义

| 字段 | 生成方 | 语义 | 规则 |
|------|--------|------|------|
| `attemptId` | **Worker** | 单次「截图→求解」流水号 | 必填；全局唯一（建议 `att_` + UUID）；Solver **禁止改写**，仅原样回传 |
| `imageHash` | **Worker** | 本帧截图像素指纹 | 必填；见 §3.2；Solver 校验并原样回传 |
| `timestamp` | **Worker** | 截图完成时刻 | 必填；Unix **毫秒** |
| `sessionId` | Worker 可选 | 同一次登录/会话多轮 attempt 分组 | 建议 = `jobId` 或 `jobId`+登录轮次；Feedback 优先用 `attemptId` 关联，`sessionId` 用于分组与兼容旧缓存 |
| `jobId` | 既有 | Hermes 任务 ID | 不变 |

**主键冻结**：端到端溯源与 Feedback 关联以 **`attemptId` 为唯一主键**。`imageHash` 用于防篡改/对帧，不是业务主键（同图可多 attempt，但极少见；若重试必重新截图 → 新 `attemptId` + 新 hash）。

### 3.2 `imageHash` 算法（冻结）

| 项 | 决策 |
|----|------|
| 输入 | **截图原始字节**（PNG/JPEG buffer），**不是** Base64 字符串 |
| 算法 | **SHA-256**，输出 **小写 hex 全长**（64 字符）；文档示例可截断展示 |
| 时机 | `screenshot` 得到 `Buffer` 后立刻计算，再 Base64 编码入请求 |
| Solver 校验 | 解码 `screenshotBase64` 后重算；与请求 `imageHash` 不一致 → `solved:false`，`reason: image_hash_mismatch`，**不落业务答案** |

### 3.3 Worker → Solver 请求（`POST /captcha`）

在既有字段上**新增必填**（对 Hermes Worker 路径）：

```json
{
  "jobId": "job_12345",
  "attemptId": "att_88a9b2c1-...",
  "imageHash": "e10adc3949ba59abbe56e057f20f883e...",
  "timestamp": 1723863457000,
  "pageUrl": "https://...",
  "kind": "auto",
  "screenshotBase64": "<png/jpeg>",
  "hint": { },
  "sessionId": "optional-session"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `attemptId` | ✅ | Worker 生成 |
| `imageHash` | ✅ | §3.2 |
| `timestamp` | ✅ | 截图毫秒时间戳 |
| `sessionId` | 推荐 | 兼容既有 Feedback 缓存键；缺省时 Solver 可用 `jobId` 派生，但须写入响应 |
| 其余 | 同现网 | `jobId` / `pageUrl` / `kind` / `screenshotBase64` / `hint` |

**兼容**：无 `attemptId` 的旧客户端，Solver 可自生成并回传（过渡期）；**Hermes Worker 本期必须自生成**，不得依赖 Solver 生成。

### 3.4 Solver → Worker 响应

顶层**必须**回显：

```json
{
  "attemptId": "att_88a9b2c1-...",
  "imageHash": "e10adc3949ba59abbe56e057f20f883e...",
  "sessionId": "...",
  "kind": "image",
  "solved": true,
  "text": "ABCD",
  "confidence": 0.85,
  "decision": "accept"
}
```

| 规则 | 说明 |
|------|------|
| 回显一致 | `attemptId` / `imageHash` 与请求完全一致（hash mismatch 路径除外可不回业务字段） |
| Worker 校验 | 若响应 `attemptId` ≠ 本地本次 → **丢弃结果**，视为协议错误，触发重试（不填码） |
| 既有字段 | `solved` / `kind` / `text` / `points` / `offsetX` / `reason` 等不变 |

### 3.5 Feedback（`POST /captcha/feedback`）

Worker 在**已知网站校验结果**后异步回写（不阻塞旅程主路径的失败抛错；见 §5）。

```json
{
  "attemptId": "att_88a9b2c1-...",
  "sessionId": "optional-same-as-solve",
  "siteResult": "failed",
  "failReason": "captcha_wrong",
  "timestamp": 1723863462000,
  "imageHash": "可选：再次确认帧"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `attemptId` | ✅ | 关联当次求解 |
| `siteResult` | ✅ | `passed` \| `failed` \| `unknown` |
| `failReason` | 条件 | `failed` 时建议填写（如 `captcha_wrong` / `login_failed` / `timeout`） |
| `timestamp` | 推荐 | 观测网站结果的时刻 |
| `sessionId` | 推荐 | 与 solve 一致；便于兼容现网 `sessionId`+`attemptId` 缓存 |
| `imageHash` | 可选 | 便于样本侧二次校验 |

**与现网字段映射（冻结）**

| 本文契约 | 现网 Solver（兼容别名） |
|----------|-------------------------|
| `siteResult: passed` | `status` / `verifyResult.status` → `success`（已有 `passed` 别名） |
| `siteResult: failed` | → `failed` |
| `siteResult: unknown` | → `unknown` |
| `failReason` | → `reason` |

Solver 须接受本契约字段；内部可继续写入既有 `verifyResult` 结构。**不得**因 feedback 改写当次 `decision` / `confidence` / `decisionScore`（与 REQ 决策会话一致）。

**关联规则（冻结）**

1. 优先：`attemptId` 命中已注册 attempt → `linked: true`。  
2. 若现网缓存仍为 `(sessionId, attemptId)` 复合键：Worker **应同时带上** solve 时的 `sessionId`；Solver 过渡期须支持「仅 `attemptId`」查找（索引扩展）。  
3. 未命中：`ok: true, linked: false`（仍落盘反馈事件，不抛 5xx）。

---

## 4. Worker 行为（防 S1）

适用路径：`solveAndApplyCaptcha` 及自动探测触发的同一求解管线。

### 4.1 帧指纹：渐进式校验（Progressive Validation）

仅比对 `<img src>` **不够**：Canvas 重绘与 CSS `background-image` 切换常不改 DOM 属性。本期 Worker **冻结**下列分级策略，按成本从低到高组合；目标是覆盖多数站点，并把填入前额外开销压在约 **≤20ms** 量级。

指纹对象记入本次 attempt 上下文，与 `attemptId` 同生命周期。目标元素 = `imageSelector` / 容器 / 探测命中节点（与截图同源）。

#### 4.1.1 通道与优先级（P0 强制）

| 级 | 通道 ID | 适用 | 采集方式 | 典型成本 | 判定「已刷新」 |
|----|---------|------|----------|----------|----------------|
| L0 | `img_src` | `<img>` / 有 `src` 的媒体 | `src` 或 `currentSrc` + attached + box 整数宽高 | ~1ms | 字符串或尺寸变化，或 detached |
| L1 | `canvas_dataurl` | `HTMLCanvasElement` | `locator.evaluate(el => el.toDataURL())` | ~1–5ms | DataURL 字符串不等 |
| L2 | `computed_bg` | CSS 背景图 | `getComputedStyle(el).backgroundImage` | ~1ms | 计算样式字符串不等 |
| L3 | `micro_clip_hash` | 上述皆无效 / Canvas tainted / 复杂 DOM·Shadow | 元素 **中心 10×10** clip 截图 → SHA-256（同 §3.2 算法，字节级） | ~10–20ms | hash 不等 |

**渐进规则（冻结）**

1. **截图前（before）**：对目标节点尝试采集所有**适用且成功**的通道，写入 `frameFingerprint.before`。  
2. **填入前（after）**：对**同一组已成功通道**再采一次，写入 `frameFingerprint.after`。  
3. **任一成功通道** before≠after → 判定 **帧失效**（`captcha_frame_stale`）。  
4. L0–L2 均失败或结果为空/无效（如 `backgroundImage === "none"`、Canvas `toDataURL` 抛错）→ **必须**启用 L3；L3 失败（无 boundingBox 等）→ 视为无法校验，**保守策略：按帧失效处理**（不填码），`failReason: frame_fingerprint_unavailable`。  
5. **禁止**仅依赖 MutationObserver 作为主手段（成本与漏判；可另开 REQ）。

#### 4.1.2 Canvas 污染（Tainted）降级

`toDataURL()` 因跨域污染抛错时：该通道记为 `unavailable`，**自动降级 L3**，不中断求解请求本身。

#### 4.1.3 旁路：网络静默监控（P1 可选，本期不强制）

等待 OCR 窗口内监听 `page.on('response')`：响应 `content-type` 为 `image/*`，或 URL 匹配可配置正则（默认含 `captcha|vcode|verifycode|isvalid|/code` 等）。计数 > 0 → 可与指纹结果 **OR** 判定刷新。

| 项 | 决策 |
|----|------|
| 本期 | **P1 可选**；默认关，`HERMES_CAPTCHA_FRAME_NET_WATCH=1` 开启 |
| 与指纹关系 | 开启时：网络命中 **或** 指纹变化 → 帧失效 |
| 非目标 | 不解析响应体；不做全量 request 拦截改写 |

#### 4.1.4 指纹结构（逻辑，非强制 JSON Schema）

```text
frameFingerprint: {
  channels: [
    { id: "img_src"|"canvas_dataurl"|"computed_bg"|"micro_clip_hash",
      ok: boolean, value?: string, error?: string }
  ],
  capturedAt: number
}
```

日志可打通道 id 与是否变化；**禁止**把完整 DataURL / 大图写入普通 info 日志（过长）；比对在内存完成即可。

### 4.2 生成指纹并请求

1. 采集 `frameFingerprint.before`（§4.1）  
2. 业务截图 → `Buffer`（全尺寸验证码区域，供 OCR）  
3. `imageHash = sha256(Buffer)`  
4. `attemptId = "att_" + uuid`  
5. `timestamp = Date.now()`  
6. POST `/captcha`（含上列字段）

说明：`imageHash` 是 **OCR 入参整帧** 指纹；L3 的 `micro_clip_hash` 是 **填入前防刷新** 的廉价探针，二者职责不同，不可互相替代。

### 4.3 填入前校验（关键拦截）

Solver 返回且 `solved === true` 后、执行 `fill` / `click` / `drag` **之前**：

| 检查 | 失败动作 |
|------|----------|
| 响应 `attemptId` === 本地 | 否 → 丢弃，不填码 |
| 响应 `imageHash` === 本地 | 否 → 丢弃，不填码 |
| §4.1 渐进指纹：before vs after（+ 可选网络监视） | 变化或无法校验 → **丢弃 OCR 结果**，本轮「帧失效」 |

**帧失效**不得把旧文本写入新框。处理策略（冻结）：

| 策略 | 决策 |
|------|------|
| 显式 `solveCaptcha` 步骤 | 抛错，message 含 `captcha_frame_stale`（或 `frame_fingerprint_unavailable`）；`retryable` **本期保持与现网一致**（默认 false），除非另开 REQ 改重试语义 |
| 自动探测路径 | 本轮 skip/失败按现有 auto 策略；**禁止**静默填旧码 |
| Feedback | 对该 `attemptId` 回写 `siteResult: unknown`，`failReason: frame_stale` / `frame_fingerprint_unavailable`（若已调用过 solver） |

### 4.4 Feedback 触发时机（最小集）

| 时机 | `siteResult` | 说明 |
|------|--------------|------|
| 帧失效 / attemptId 不匹配丢弃 | `unknown` + `frame_stale` / `attempt_mismatch` | 未真正提交到网站 |
| Solver `solved:false`（弃权等） | `unknown` 或可不发（冻结：**发**，`failReason`=solver reason） | 便于统计弃权 |
| 旅程后续断言/登录成功可判定 | `passed` | 若本期无法可靠判定成功 → 允许只做失败路径 |
| 页面出现「验证码错误」类文案（可选启发式） | `failed` + `captcha_wrong` | **本期不做通用启发式**；仅当调用方/登录模板显式传入结果，或测试夹具注入 |

**本期 P0 强制**：只要走完一次 solve 请求，Worker **至少**在「丢弃结果 / 步骤失败」时回写 feedback。  
**本期 P1 可选**：「登录成功」`passed` 回写（依赖登录模板或显式钩子，不强制通用 DOM 猜成功）。

Feedback URL：由 `HERMES_CAPTCHA_WEBHOOK` 推导（`/captcha` → `/captcha/feedback`），超时短、失败只打日志不拖垮主旅程。

---

## 5. Solver 行为（解 A1）

### 5.1 请求处理

1. 校验必填（Hermes 路径）：`attemptId`、`imageHash`、`timestamp`、图。  
2. 重算 hash；mismatch → 明确失败，不答题。  
3. 注册 attempt（内存/既有缓存），键至少含 `attemptId`；保留 `sessionId` 兼容。  
4. 求解；响应顶层回显 `attemptId`、`imageHash`、`sessionId`。

### 5.2 落盘对齐（采集）

当开启采集（环境变量，默认建议关，bench/训练开）：

| 文件 | 内容 |
|------|------|
| `{imageHash}.png`（或 `.jpg`） | 本帧图像 |
| `{imageHash}.{attemptId}.json` | `attemptId`、`imageHash`、`sessionId`、`jobId`、解析文本、`decision`、`confidence`、时间戳等 |

同 hash 多 attempt 时用 `attemptId` 区分 JSON，避免覆盖。

环境变量建议名：`HERMES_CAPTCHA_CAPTURE_DIR`（空=不落盘）。

### 5.3 Feedback 与 Bad Case

1. 按 `attemptId` 更新/追加 verify 结果到对应 JSON 与 JSONL。  
2. **假阳性定义（冻结）**：`decision`/`solved` 为接受提交 **且** `siteResult=failed` 且 `failReason` 表明验证码错误（或登录模板标记为 captcha）。  
3. 提供只读列举或 JSONL 过滤即可；**本期不做**标注平台对接。

---

## 6. 非目标

| 项 | 说明 |
|----|------|
| OCR / VLM / morph 调参 | ❌ |
| MutationObserver 等图 / 作帧校验主手段 | ❌（可另开 REQ） |
| 网络监视作 P0 必选 | ❌ 本期 P1 可选（§4.1.3） |
| 通用「验证码错误」DOM 嗅探 | ❌ P0 不做 |
| 改 `retryable` 全局语义 | ❌ 除非另确认 |
| BROWSER_AGENT | ❌ |
| UI 展示 Trace | ❌ 可选日志字段即可 |

---

## 7. 验收用例

| ID | 内容 |
|----|------|
| T-Trace-01 | Worker 请求含 `attemptId`+`imageHash`+`timestamp`；响应原样回显 |
| T-Trace-02 | 篡改请求 hash / 与图不符 → Solver `image_hash_mismatch`，无有效 `text` |
| T-Trace-03 | 响应 `attemptId` 与本地不一致 → Worker 不填码 |
| T-Trace-04 | mock：截图后改 `<img src>` → 填入前拦截，`captcha_frame_stale`，不调用 fill |
| T-Trace-04b | mock：Canvas `toDataURL` 变化 → 拦截（L1） |
| T-Trace-04c | mock：`backgroundImage` 变化 → 拦截（L2） |
| T-Trace-04d | L0–L2 不可用时走 L3：中心 10×10 hash 变化 → 拦截 |
| T-Trace-04e | Canvas tainted：`toDataURL` 失败后降级 L3，仍能判定刷新 |
| T-Trace-05 | Feedback：`attemptId` 可 `linked`；假阳性记录可查（accept + failed） |
| T-Trace-06 | 开启 `CAPTURE_DIR`：存在与 hash 对齐的图像与 JSON |
| T-Trace-07 | 旧客户端无 `attemptId`：Solver 仍可自生成（兼容，不作为 Hermes 主路径） |

文档：更新 `captcha-solver/README`、`worker-browser` 契约说明、`CAPTCHA_SOLVER_DESIGN` 契约节。

---

## 8. 确认清单（已冻结 2026-08-17）

| # | 项 | 冻结 |
|---|-----|------|
| 1 | `imageHash` = SHA-256(**原始截图字节**)，非 Base64 字符串 | ✅ |
| 2 | `attemptId` 由 **Worker** 生成；Feedback **主键** = `attemptId` | ✅ |
| 3 | 填入前 **渐进式帧指纹**（L0 img → L1 canvas → L2 bg → L3 10×10）；帧失效不填码 | ✅ |
| 3b | 网络监视仅 P1 可选，默认关 | ✅ |
| 3c | 指纹全失败时保守不填码（`frame_fingerprint_unavailable`） | ✅ |
| 4 | Feedback P0：失败/丢弃必回写；登录成功 `passed` 为 P1 可选 | ✅ |
| 5 | 不做通用「验证码错误」页面嗅探 | ✅ |
| 6 | 采集落盘默认关，靠 `HERMES_CAPTCHA_CAPTURE_DIR` 打开 | ✅ |
| 7 | 进入 Phase 2 实现 | ✅ 与视觉层同轮；Trace 为 P0 |
| 8 | 生产默认不落原图，只留 hash / attemptId | ✅ |

与 `REQ_CAPTCHA_VISUAL_DATALAYER.md` §11 Phase 2 优先级一并执行。

---

## 9. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-17 | 首稿：按用户契约方案冻结 Trace 绑定；对齐现网 feedback 别名与 Worker 缺口 |
| 0.2 | 2026-08-17 | §4.1 升级为渐进式帧校验：Canvas DataURL / computed bg / 10×10 micro-hash；网络监视列为 P1 |
| 0.3 | 2026-08-17 | 确认进 Phase 2；与视觉层同轮；生产不落原图 |
