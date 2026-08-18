# 验证码解析器：设计与实现说明（排障用）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-17 |
| 目的 | 分析「不能正确识别」时，先分清是 **编排层**、**截图层**、还是 **OCR 求解层** |
| 代码 | `worker-browser/src/runtime/captcha*.ts` · `captcha-solver/` |
| 压测 | `docs/CAPTCHA_OCR_BENCH.md` · `reports/captcha_ocr_bench_*.md` |

---

## 0. 先澄清：谁在「识别」？

```text
┌─────────────────────────────────────────────────────────────┐
│ worker-browser（Hermes）                                     │
│  · DOM 探测 / 截图 / 调 Webhook / fill·click·drag            │
│  · 【不做 OCR】                                               │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST /captcha
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ captcha-solver（独立进程，默认 :18085）                        │
│  · 分类 image|slider|click                                   │
│  · OCR（ddddocr 投票 / 模板）←【真正「解析字符」的地方】         │
│  · 滑块缺口 / 点选色块                                        │
└─────────────────────────────────────────────────────────────┘
```

| 现象 | 常被误判为 | 实际归属 |
|------|------------|----------|
| 填了错码 / 网站报验证码错误 | 「Hermes 识别差」 | **solver OCR 答错**，或截图内容已变 |
| `solved:false` / abstain | 「没识别」 | solver **主动弃权**（低置信 / 分歧） |
| `solver not configured` | 「解析器坏了」 | Worker **未配** `HERMES_CAPTCHA_WEBHOOK` |
| 探测不到输入框 | 「识别失败」 | **DOM 探测**，OCR 未跑 |
| 2026-08-13 DCP 手测用视觉猜码 | 「解析器」 | **当时未走 captcha-solver**，是人工/模型看图 |

**结论**：要定位「不能正确识别」，必须看 **captcha-solver 的 OCR 路径与入参截图**；Worker 只保证把图送对、把返回文本填进框。

---

## 1. 端到端数据流

### 1.1 Worker 触发

| 入口 | 文件 | 行为 |
|------|------|------|
| 显式步骤 `solveCaptcha` | `browser/steps.ts` → `solveAndApplyCaptcha` | 强制求解 |
| 自动探测（默认开） | `navigate/fill/click/drag` 后 `maybeAutoCaptcha` | DOM 命中且 applicable 才求解 |
| 登录模板 | `journey/login.ts` | 填用户/密码后多次 `maybeAutoCaptcha` |

环境：

| 变量 | 作用 |
|------|------|
| `HERMES_CAPTCHA_WEBHOOK` | 指向 solver（可写 `host:port`，会规范化成 `http://…/captcha`） |
| `HERMES_CAPTCHA_TIMEOUT_SEC` | 默认 60 |
| `HERMES_CAPTCHA_API_KEY` | 可选 Bearer |

### 1.2 截图（影响 OCR 的第一现场）

`screenshotCaptchaRegion`（`captcha.ts`）：

1. 优先对 `imageSelector`（如 `#code`）或 `containerSelector` 做 **locator.screenshot**（紧裁切）。  
2. 等待可见 + boundingBox 非平凡尺寸（避免图未刷出）。  
3. locator 失败再尝试 `page.screenshot({ clip })`。  
4. **禁止**轻易退回整页大图（历史问题：整页/带装饰边导致 `ocr low confidence`）。

**不合理/高风险点（截图层）**

| # | 风险 | 后果 |
|---|------|------|
| S1 | 验证码刷新后截到旧帧 / 空框 | OCR 答非所问或弃权 |
| S2 | `imageSelector` 探测错（旁路 logo） | 图不对 |
| S3 | DCP 在 `login()` 后才显示 `#verification`，探测过早 | `found && !applicable` → skip，不调 OCR |
| S4 | Session Cookie：图与提交必须同浏览器会话 | 另进程下图再填必失败（与 OCR 无关） |

### 1.3 Webhook 契约

**请求（Worker → Solver）**

```json
{
  "jobId": "...",
  "pageUrl": "...",
  "kind": "auto|image|click|slider",
  "screenshotBase64": "<png/jpeg>",
  "hint": { "selector": "#verification", "imageSelector": "#code", "..." }
}
```

**响应（Solver → Worker）**

| kind | 成功字段 | Worker 动作 |
|------|----------|-------------|
| image | `solved, text[, fillSelector]` | `page.fill(selector, text)` |
| click | `solved, points[{x,y}]` | `mouse.click`（viewport） |
| slider | `solved, offsetX` 或 `track` | `dragByDelta` / 轨迹 |
| 失败 | `solved:false, reason` | 抛错，旅程失败 |

选择器优先级（填框）：**用户指定 > DOM probe > webhook.fillSelector**（且须可见/可填）。

### 1.4 Solver 内部（真正解析）

```text
decode_image(b64)
    → classify(img, req)          # image / slider / click
    → ENGINES[kind](img)
         image  → ocr.solve_image
         slider → slider.solve_slider
         click  → click.solve_click
    →（auto 且失败）依次 fallback 其它引擎
    → 附加 observation / captchaType / sessionId（观测用）
```

入口：`captcha-solver/solvers/dispatch.py` · HTTP：`captcha-solver/app.py`（`POST /captcha`）。

---

## 2. OCR 管线（字符码）—「识别错」主战场

文件：`captcha-solver/solvers/ocr.py`（`solve_image`）。

### 2.1 主路径（`HERMES_CAPTCHA_OCR=auto`，默认）

1. **预处理多版本**（`enhance.ocr_variants`）：灰度 / 彩色 soft / morph 等。  
2. **ddddocr** 多版本读字（可选 beta 并行）。  
3. **投票**：按权重（含 `HERMES_CAPTCHA_OCR_MORPH_WEIGHT`，默认 **0.8**）汇总。  
4. **门禁**  
   - `MIN_CONF`（默认 0.5）：低于则不 ACCEPT。  
   - `SOFT_CONF`（默认 0.45）：彩色 soft 路径门槛。  
   - `AGREE`（beta 开启时默认）：双侧须支持同一拼写，否则 **abstain**。  
   - 可选 `OCR_LEN` / `OCR_CHARSET` / `OCR_CASE=lower`。  
5. 未过门禁 → **`solved:false` + reason（常见 `ocr low confidence`）**。  
6. ddddocr 未命中 → **模板匹配**回退（直立字形滑窗 IoU）。  
7. 可选 **VLM**（`HERMES_CAPTCHA_VLM`，需本地模型 URL；空则不调）。

### 2.2 决策语义

| decision | 含义 | Worker 侧 |
|----------|------|-----------|
| accept | `solved:true` + `text` | 填入输入框 |
| abstain | 不敢答 | 步骤失败 / 可触发重试策略 |
| （错误 accept） | 答错但自信 | 网站「验证码输入错误」← **假阴性难查，需 feedback** |

### 2.3 压测结论（摘要）

见 `docs/CAPTCHA_OCR_BENCH.md`：

- 首试成功率约 **40%** 量级（demo）；会话重试后可到 ~70–85%。  
- **硬验收未过**；假接受 / 扭曲彩色字（DCP 类）仍是主缺口。  
- morph 权重默认 0.8；过低（0.5）会明显伤 Precision。

---

## 3. DOM 探测（不是 OCR，但会挡住 OCR）

文件：`captchaDetect.ts` · `gatherCaptchaSnapshot` / `classifyCaptcha` / `maybeAutoCaptcha`。

**分类优先级**：滑块把手 → 滑块文案 → 点选文案 → **可填验证码输入** → 仅有图（applicable=false）→ iframe。

**DCP（`#username` / `#password` / `#verification` / `#code`）相关坑**

| # | 现象 | 原因 |
|---|------|------|
| D1 | 首屏无验证码区 | `isvalid.htm` 为 true 时才 `.img-boxes.show()`；需 blur/登录点击后才出现 |
| D2 | `found=true, applicable=false` | 有 `#code` 图但输入尚未可见 → **不调 solver**，只 wait-input |
| D3 | 选错 input | `#vcode` / `#opt` 也叫 `name=verification`；探测靠 placeholder/id 启发 |
| D4 | 探测用英文/中文关键词 | 漏匹配则「找不到验证码」 |

预算：每 job 最多求解约 **3** 次（`captchaBudget`）；单次 probe 内最多再试 2 轮。

---

## 4. 「不能正确识别」定位清单

按顺序查，避免瞎改 OCR：

### Step A — 是否根本没跑到 OCR？

```bash
# Worker 日志关键字
[captcha] … probe …
[captcha] … webhook-request …
[captcha] … webhook-response …
```

| 日志 | 含义 |
|------|------|
| `skip` / `no fillable captcha control` | DOM 阶段，**未识别** |
| `solver not configured` | 未配 Webhook |
| `webhook-response` + `solved:false` | **OCR/引擎弃权或失败** |
| `solved:true` + 网站仍报错 | **OCR 答错** 或 **截图与提交码不同步** |
| `text=AB12` + fixture 警告 | 打到了 **mock**，不是真 OCR |

### Step B — 截图是否「可读、同步」？

1. 从观测 JSONL / 临时落盘取出本次 `screenshotBase64`。  
2. 人眼看是否为 **仅验证码小图**（非整页）。  
3. 确认填码前 **未再次 changeimg()**（否则码已换）。

### Step C — Solver 决策细节

看响应字段：

| 字段 | 用途 |
|------|------|
| `reason` | 如 `ocr low confidence` |
| `confidence` / `votes` | 投票是否勉强 |
| `engine` / `preprocess` | ddddocr vs template |
| `decision` / `observation` | accept vs abstain |
| `abstainReasonDetail` / `abstainBucket` | 弃权归因 |
| `profile` | `dcp-wide` / `demo-strict` 等阈值不同 |

健康检查：

```bash
curl -s http://127.0.0.1:18085/health
```

确认 `ddddocr: true`、`ocrMinConf`、`vlmReady`。

### Step D — 用 bench 复现

```bash
# 见 docs/CAPTCHA_OCR_BENCH.md / scripts/captcha_ocr_bench.py
# 固定 demo 或落盘的 DCP 图做离线 OCR，隔离浏览器抖动
```

---

## 5. 已知不合理 / 薄弱设计（评审清单）

### 5.1 架构层

| ID | 问题 | 影响 |
|----|------|------|
| A1 | Worker 与 Solver **无截图哈希绑定**到反馈 | 难证明「填的就是这张图的 OCR」 |
| A2 | `antiDetect.maybeSolveCaptcha` 仍是旧钩子（整页截图 + 只认 `solved`） | Agent 路径与主契约不一致 |
| A3 | click 坐标默认 viewport，契约曾提 `coord` 但应用路径弱 | 点选易偏 |

### 5.2 截图 / 探测

| ID | 问题 | 影响 |
|----|------|------|
| S3/D1 | DCP 延迟展示验证码 | 时序敏感；易 skip 或截空 |
| D3 | 多 `name=verification` | 可能填错框 |
| S1 | 刷新不同步 | 「识别对了却校验失败」假象 |

### 5.3 OCR

| ID | 问题 | 影响 |
|----|------|------|
| O1 | 首试成功率偏低（~40% demo） | 生产必须依赖重试/弃权 |
| O2 | 扭曲彩色字（DCP）对 ddddocr/模板都不友好 | **错码主因** |
| O3 | 高阈值 → 多 abstain；低阈值 → 多假接受 | 需按站点 profile 调 |
| O4 | 模板回退假设「直立可分割字形」 | 旋转粘连字基本无效 |
| O5 | VLM 默认依赖本地 URL，未配则等于关闭 | 二次识别常未启用 |
| O6 | morph 权重敏感 | 乱调会同时伤召回与 Precision |

### 5.4 与「识别失败」的对应

| 用户体感 | 优先查 |
|----------|--------|
| 从不填码 | A：探测 / Webhook 配置 / applicable |
| 经常不填（弃权） | C：`MIN_CONF` / AGREE / 截图质量 |
| 常填错 | C：OCR 能力 + 截图同步；看 feedback `failed` |
| 偶发成功 | O1+重试；会话策略是否开启 |

---

## 6. 推荐排障最小闭环（DCP）

1. 确认 browser-worker：`HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha` 且已重启。  
2. 确认 captcha-solver 在跑，`/health` 中 `ddddocr: true`。  
3. 跑一单登录，抓 Worker `[captcha] webhook-response` 的 `text/solved/reason`。  
4. 若 `solved:true` 仍失败：比对当次截图与填入 text，查是否刷新。  
5. 若 `solved:false`：把同一张 base64 单独 POST 到 `/captcha`，调低 `OCR_MIN_CONF` 或换 `profile=dcp-wide` 做 A/B（只作实验）。  
6. 用 `POST /captcha/feedback` 把网站校验结果挂回 `attemptId`（假接受归因）。

---

## 7. 代码索引

| 模块 | 路径 |
|------|------|
| 截图 + Webhook + 应用 | `worker-browser/src/runtime/captcha.ts` |
| DOM 探测 / 自动触发 | `worker-browser/src/runtime/captchaDetect.ts` |
| 日志 / trace | `worker-browser/src/runtime/captchaLog.ts` |
| 步骤挂载 | `worker-browser/src/browser/steps.ts` |
| 登录编排 | `worker-browser/src/journey/login.ts` |
| Solver HTTP | `captcha-solver/app.py` |
| 分发 | `captcha-solver/solvers/dispatch.py` |
| OCR | `captcha-solver/solvers/ocr.py` |
| 说明 / 环境变量 | `captcha-solver/README.md` |
| 压测结论 | `docs/CAPTCHA_OCR_BENCH.md` |

---

## 8. 修订

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0 | 2026-08-17 | 首版：编排 vs OCR 分层 + 失败定位清单（供不合理点评审） |
