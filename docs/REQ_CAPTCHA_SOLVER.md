# Phase 1 需求：自建验证码识别服务（Webhook 实现）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-14 |
| 状态 | **Phase 2 已实现；Phase 3：T-Solv-01–05 单测已关；T-Solv-07 `smoke-auth` 20/20 已关；T-Solv-06 未关** |
| 范围协议 | **独立进程**；不改 Worker 探测/填写契约；不改 `BROWSER_AGENT` |
| 触发 | 用户：不想依赖外部打码厂商，在本仓库新建目录开发识别（文字 / 滑动 / 点击），供已有 `HERMES_CAPTCHA_WEBHOOK` 调用 |
| 父需求 | `docs/REQ_CAPTCHA_AUTH.md`（契约）· `docs/REQ_SECURE_AUTH.md`（自动探测）· `docs/REQ_CAPTCHA_LIVE.md`（定位/填写） |
| 关联缺陷 | D22（无识图 Webhook 时真实站无法「填对」） |

---

## 1. 目标

在仓库内新增**独立识别服务**，实现现有 Webhook 契约，使 browser-worker 在探测到验证码后能调用本服务完成：

1. **图形/字符码（image）**：从图中读出字符，返回 `text`，由 Worker `fill`。  
2. **滑块（slider）**：从图/缺口估计位移，返回 `offsetX` 或 `track`，由 Worker `drag`。  
3. **点选（click）**：从图中估计点击坐标，返回 `points`，由 Worker 依次 `mouse.click`。

Worker **继续只负责**：定位控件、截图、HTTP 调用、按响应填写/点击/拖拽。识别算法全部放在新目录，不塞进 `worker-browser`。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| 改 Webhook JSON 字段名 | ❌ 沿用现契约；可增补可选字段，旧 Worker 必须仍能解析 |
| 把 OCR/CV 编进 `worker-browser` | ❌ 识别与拨测解耦 |
| 替换 `scripts/auth_e2e_server.py` mock | ❌ `make smoke-auth` 仍用确定性 mock（`AB12` / 固定点 / `offsetX=140`） |
| 保证过任意验证码（极验 iframe、行为风控、旋转拼图变体） | ❌ 沿用 ADR-007；本期是「可跑通的自建求解器」 |
| 打码厂商 SDK / 人机打码平台 | ❌ 本期自研本地识别 |
| UI 里填打码 Key、供应商市场 | ❌ 仍只配环境变量 |
| BROWSER_AGENT 调本服务 | ❌ |

---

## 3. 建议冻结

| # | 项 | 决策 | 来源 |
|---|-----|------|------|
| 1 | 形态 | 仓库根目录新包 **`captcha-solver/`**，独立 HTTP 进程 | 用户：新建目录开发 |
| 2 | 对接方式 | 仅作为 `HERMES_CAPTCHA_WEBHOOK` 的实现；**不改** Worker 请求/响应必填字段 | 沿用契约 |
| 3 | 类型 | **image + click + slider**（`kind=auto` 时服务根据图 + `hint.kindGuess` 选择算法） | 用户 |
| 4 | 语言 | **Python 3**（OCR/OpenCV 生态）；不跟 Worker 的 Node 混编 | 建议冻结 |
| 5 | 监听 | 默认 `127.0.0.1:18085`；路径 `POST /captcha`、`GET /health` | 建议冻结（避开 fixture `:18083` / mock `:18084`） |
| 6 | 配置 | Worker：`HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha`；可选 `HERMES_CAPTCHA_API_KEY` | 沿用 |
| 7 | 失败 | 认不出 → `{ "solved": false, "reason": "..." }` HTTP 200；崩溃/超时由 Worker 既有逻辑处理 | 沿用 |
| 8 | 精度承诺 | **尽力而为**：简单字符码、常规缺口滑块、可见图标点选；不承诺公网站 100% | 建议冻结 |
| 9 | 冒烟 | 本服务自测 + 可选联调 fixture；**不破坏** `make smoke-auth` 20/20 | 建议冻结 |
| 10 | 日志 | 打 `jobId` / `kind` / `solved` / 返回摘要；默认**不落盘完整截图** | 建议冻结 |

---

## 4. 需求明细

### 4.1 目录与职责

```
captcha-solver/          # 本期新建
  README.md              # 启动、契约、如何接到 Worker
  app.py / 等价入口      # HTTP
  solvers/
    image.py             # 字符 OCR
    slider.py            # 缺口 / 位移
    click.py             # 多点坐标
  tests/                 # 用合成图或仓库内 fixture 图
```

| 组件 | 职责 |
|------|------|
| `captcha-solver` | 解码 `screenshotBase64` → 识别 → 返回契约 JSON |
| `worker-browser` | 不变：探测、截图、调用 URL、应用结果 |
| `scripts/auth_e2e_server.py` | 仍只服务 E2E mock，不承担生产识别 |

### 4.2 Webhook 契约（沿用，服务必须实现）

**请求**（Worker 已发送）

```json
{
  "jobId": "...",
  "pageUrl": "...",
  "kind": "auto|image|click|slider",
  "screenshotBase64": "...",
  "hint": {
    "selector": "...",
    "imageSelector": "...",
    "kindGuess": "image|click|slider|auto",
    "siteKey": "..."
  }
}
```

**响应**（与 Worker `applyCaptchaSolution` 对齐）

| 场景 | JSON |
|------|------|
| 字符码 | `{ "solved": true, "kind": "image", "text": "..." }` |
| 点选 | `{ "solved": true, "kind": "click", "coord": "viewport", "points": [{"x":n,"y":n}, ...] }` |
| 滑块 | `{ "solved": true, "kind": "slider", "offsetX": N }` 或附加 `track` |
| 失败 | `{ "solved": false, "reason": "..." }` |

坐标默认 **viewport**（与现 Worker 一致）。`text` 原样返回，不做大小写猜测以外的改写（Worker 原样 `fill`）。

`kind=auto`：优先 `hint.kindGuess`；否则按「滑块特征 → 点选特征 → 字符 OCR」尝试；都失败则 `solved: false`。

### 4.3 算法范围（本期）

| 类型 | 本期做 | 明确不做 |
|------|--------|----------|
| image | 本地 OCR（推荐 ddddocr / ONNX；无网也可跑的离线模型） | 接入第三方打码 HTTP API |
| slider | 缺口/拼图模板匹配或边缘差，输出像素位移 | 自研对抗极验轨迹风控；不保证行为检测过关 |
| click | 从图中估计需点击的若干点（文案「请依次点击」类的图标/文字块） | iframe 内第三方点选引擎、语义「点出所有红绿灯」的开放集保证 |

无图、空 base64、解码失败 → `solved: false`。

### 4.4 与现网联调

1. 启动 `captcha-solver`。  
2. browser-worker 环境增加 `HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha` 后重启。  
3. 提交页 / fixture（`/login-verification`、`/login-click`、`/login-slider`）可指向本服务做**人工/脚本联调**。  
4. `make smoke-auth` **不得**默认改成打本服务（避免 OCR 非确定导致 20/20 变红）。

`configs/example.env` 增加注释示例；`configs/env` 由运维按需填写，不把密钥写进文档。

### 4.5 安全与运维

- 默认只绑 `127.0.0.1`。  
- 若配置了 Worker 侧 `HERMES_CAPTCHA_API_KEY`，本服务校验 `Authorization: Bearer`。  
- 不把截图写进任务详情；本服务日志默认不含 base64。

---

## 5. 验收与测试

| ID | 内容 | 期望 |
|----|------|------|
| T-Solv-01 | `GET /health` | 200 |
| T-Solv-02 | 合成/样例**字符图** POST `/captcha` `kind=image` | `solved=true` 且 `text` 与标签一致（允许小字符集） |
| T-Solv-03 | 样例**滑块/缺口图** `kind=slider` | `solved=true` 且 `offsetX` 在约定误差内（如 ±8px） |
| T-Solv-04 | 样例**点选图** `kind=click` | `solved=true` 且 `points` 落在目标块内 |
| T-Solv-05 | 空图 / 无法识别 | `solved=false`，HTTP 200 |
| T-Solv-06 | Worker 指向本服务 + fixture 字符页 | 任务 SUCCESS，步骤/日志出现真实 `text`（非写死 AB12，除非图就是 AB12） |
| T-Solv-07 | `make smoke-auth` | 仍 20/20（继续用 `:18084` mock） |
| 文档 | `captcha-solver/README.md`；`worker-browser/README` 增加「自建求解器」指针 | |

---

## 6. 确认清单（请确认后进入 Phase 2）

| # | 项 | 状态 |
|---|-----|------|
| 1 | 新建目录 `captcha-solver/`，独立进程，不改 Worker 契约 | ✅ |
| 2 | 覆盖 image + click + slider | ✅ |
| 3 | Python 3 + 离线 OCR/CV | ✅ |
| 4 | 默认 `:18085/captcha`；`smoke-auth` 仍用 mock | ✅ |
| 5 | 不保证过任意公网站 / 极验 | ✅ |
| 6 | 失败返回 `solved: false`，不抛成 500（业务失败） | ✅ |

Phase 2 已落地：`captcha-solver/`（Classify → OCR / Slider / Click）。Hermes 仍走 `POST /captcha`；另提供 `/v1/captcha/solve` 与 `/v1/captcha/detect`。无 Playwright、无 Redis。Verify 仍在 Worker。第三方 / Cloudflare 不在范围。
