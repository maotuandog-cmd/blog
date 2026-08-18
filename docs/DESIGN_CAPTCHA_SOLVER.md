# captcha-solver 设计实现文档（现状盘点）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-15 |
| 目的 | 描述**当前已实现**的验证码解析器设计与实现，供审阅不合理处 |
| 范围 | `captcha-solver/` 主体 + Worker Webhook 对接要点 |
| 非范围 | 改造方案见 `docs/REQ_CAPTCHA_DECISION_SESSION.md`（Phase 1，待冻结） |
| 关联 | `REQ_CAPTCHA_SOLVER.md`、`REQ_CAPTCHA_OCR.md`、`REQ_CAPTCHA_OCR_ACCURACY.md`、`REQ_CAPTCHA_VLM7B.md`、`CAPTCHA_OCR_BENCH.md` |

---

## 1. 定位与边界

### 1.1 一句话

> Hermes **不内置识图**；`captcha-solver` 是独立 HTTP 进程，实现 `HERMES_CAPTCHA_WEBHOOK` 契约：收到截图 → Detect/Classify → Solve → 返回 `solved` + 结果字段。

### 1.2 做 / 不做

| 做 | 不做 |
|----|------|
| image / slider / click 三类求解 | 浏览器自动化、填表、点选执行 |
| ddddocr 多变体投票 + 可选本地 VLM 二次识别 | 云打码 / 外呼商业 API（默认） |
| 与 Worker 现有 JSON 契约兼容 | 改 Gateway / Worker 必填字段 |
| 失败落盘、health、bench | 保证公网站 / 极验 / Cloudflare 100% |

### 1.3 系统上下文

```text
┌─────────────┐   job    ┌──────────────┐  POST /captcha   ┌─────────────────┐
│  hermes-ui  │ ───────► │ gateway +    │ ───────────────► │ captcha-solver  │
│             │          │ worker-core  │                  │  :18085         │
└─────────────┘          │ dispatcher   │                  └────────┬────────┘
                         └──────┬───────┘                           │
                                │                                   │ 可选
                                ▼                                   ▼
                         ┌──────────────┐                  ┌─────────────────┐
                         │browser-worker│ 截图/填码/拖拽    │ Ollama/vLLM     │
                         │   :8090      │                  │ /v1/chat/...    │
                         └──────────────┘                  └─────────────────┘
```

- **Verify（答案是否正确）不在 solver**：Worker 填完后再探测验证码是否消失；bench 则打 demo 的 `/api/captcha/verify`。

---

## 2. 目录与模块职责

```text
captcha-solver/
├── app.py                 # ThreadingHTTPServer：路由、鉴权、health、日志
├── solvers/
│   ├── dispatch.py        # solve_request：解码 → 分类 → 引擎 → 失败落盘
│   ├── classify.py        # kind 路由（显式 / hint / 特征分）
│   ├── decode.py          # base64 → PIL
│   ├── ocr.py             # image 主路径：dddd + 投票门闩 + VLM 钩子 + 模板
│   ├── enhance.py         # 预处理变体 ocr_variants
│   ├── preprocess.py      # 灰度 / 墨迹 / 连通域基础
│   ├── vlm.py             # 本地 7B 二次识别
│   ├── slider.py          # 滑块 offsetX
│   └── click.py           # 点选 points
└── tests/
    ├── test_solver.py
    └── fixtures.py
```

| 模块 | 职责 |
|------|------|
| `app.py` | HTTP 适配；把 Hermes body 交给 `solve_request`；打印 engine/votes/vlmUsed |
| `dispatch.py` | 无状态编排；`auto` 失败时依次尝试其余引擎 |
| `ocr.py` | **字符码核心**：归一化、投票、E1/E2/E3、模板、调用 VLM |
| `vlm.py` | 触发条件、OpenAI 兼容调用、与 dddd 合并策略 |
| `enhance.py` | 按彩色/灰度生成 ≤6 个预处理图 |

---

## 3. HTTP 契约

### 3.1 端点

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/health`（及 `/healthz`、`/v1/captcha/health`） | 存活与能力探测 |
| POST | `/captcha`（及 `/v1/captcha/solve`、`/solve`） | Hermes Webhook 求解 |
| POST | `/captcha/feedback`（及 `/v1/captcha/feedback`） | S3 verify 回写（不改 decision） |
| POST | `/v1/captcha/detect` | 只分类不求解 |

鉴权：若配置 `HERMES_CAPTCHA_API_KEY`，需 `Authorization: Bearer …`，否则 **401**。  
识别失败一般为 **HTTP 200** + `solved:false`（避免 Worker 把契约失败当传输错误）。

### 3.2 请求（求解）

```json
{
  "jobId": "string",
  "pageUrl": "string",
  "kind": "auto|image|click|slider",
  "screenshotBase64": "...",
  "hint": { "selector": "...", "imageSelector": "...", "kindGuess": "...", "siteKey": "..." }
}
```

`screenshotBase64` 亦兼容 `screenshot_base64` / `imageBase64` / `image`。

### 3.3 响应（Worker 必填语义）

| kind | 成功必填 |
|------|----------|
| image | `solved`, `kind:"image"`, `text` |
| click | `solved`, `kind:"click"`, `coord`, `points[]` |
| slider | `solved`, `kind:"slider"`, `offsetX`（可选 `track`） |
| 失败 | `solved:false`, `reason` |

**附加字段**（排障 / bench，Worker 可忽略）：  
`success`, `confidence`, `latency_ms`, `classifiedAs`, `classifierConfidence`, `engine`, `preprocess`, `votes`, `weightScore`, `weightShare`, `decision`, `decisionReason`, `decisionScore`, `evidenceScore`, `agreementScore`, `agreement`, `ocrConf`, `stdText`, `betaText`, `vlmUsed`, `ddddText`, `vlmText`, `vlmConflict`, `vlmRaw`, `failImage`, **`sessionId`**, **`attemptId`**, **`observation`**（S2 观测快照）, **`profile`**（S5）。

### 3.4 Health 字段

`ok`, `service`, `engines`, `ocrMode`, `ddddocr`, `ocrMinConf`, `ocrSoftConf`, `ocrAgree`, `ocrMorphWeight`, `vlmMode`, `vlmReady`, `vlmUrl`, `vlmModel`, `hermesWebhook`。

---

## 4. 总调度（`dispatch.solve_request`）

```text
extract_b64 → decode_image
     → classify(img, req) → kind
     → ENGINES[kind](img)
     → 若 requested_kind==auto 且未 solved：
           依次尝试其余 image / slider / click
     → 补 success、latency_ms、classifiedAs
     → image 且未 solved → 可选落盘 FAIL_DIR
```

**分类优先级**（`classify.py`）：显式 `kind` → `hint.kindGuess` → `max(click/slider/ocr.feature_score)`。

---

## 5. 字符码 OCR 设计（主路径）

### 5.1 模式（`HERMES_CAPTCHA_OCR`）

| 模式 | 行为 |
|------|------|
| `auto`（默认） | ddddocr 投票 →（可选 VLM）→ 灰度且 dddd 完全 miss 时模板 |
| `ddddocr` | 同 dddd 路径；模板条件同上 |
| `template` | **只**模板；**不跑 dddd、不跑 VLM** |

彩色判定：`chroma_ratio(img) >= 0.05`。

### 5.2 预处理（`enhance.ocr_variants`，最多 6 路）

**非彩色：** `raw` → 可选 `up2` → `trim_up2` → `gray_contrast` → 可选 `clahe` → 可选 `bin`  

**彩色：** `raw` → 可选 `up2` → `trim_up2` → `chroma_ink` → `morph_up2` → `gray_contrast`  
（故意不用 bin/CLAHE，避免抹掉彩色字形）

### 5.3 读数与融合（`_try_ddddocr`）

```text
对每个 variant:
  std 引擎 classification → normalize → std_readings
  若 BETA：beta 引擎 → normalize → beta_readings（name+"+beta"）
readings = std + beta
hit = fuse_ocr_votes(threshold=MIN_CONF)          # E3 加权整串投票
若未命中且 colorful 且 SOFT_CONF < MIN_CONF:
  hit = fuse_ocr_votes(threshold=SOFT_CONF)       # E1 soft
若 AGREE 开启（需 BETA）:
  hit = gate_on_agreement(hit, std, beta)         # E2
否则 decision=accept
```

### 5.4 文本归一化（`normalize_captcha_text`）

1. 只保留 ASCII `[A-Za-z0-9]`（剥 CJK 等）  
2. 可选 `OCR_CHARSET` 精确过滤（**无** l↔L 模糊映射）  
3. 长度：若设 `OCR_LEN` 则必须精确；否则合法 **4–6**；否则变 `""`

### 5.5 投票置信度（E3，`fuse_ocr_votes`）

- 按 `casefold` 分组；`morph*` 权重 = `MORPH_WEIGHT`（默认 **0.8**），其余 **1.0**  
- 赢家：`(长度命中 LEN 加分, 加权分, 票数, 串长, fold)`  
- **confidence**：
  - 仅 1 条有效且长度 = LEN → **1.0**（singleton 信任）
  - 否则 `score / total_weight`（即 weightShare）  
- 可选 `OCR_POS_VOTE` 位置投票（默认关）

### 5.6 E1 Soft / E2 Agreement / E3 Morph（演进层）

| 层 | 开关 | 意图 | 现状摘要 |
|----|------|------|----------|
| E1 | `SOFT_CONF` 默认 0.45 | 彩色略降门槛少弃权 | precision↑；会话成功率仍难达 85% |
| E2 | `BETA`+`AGREE` | 双模型同意才交卷 | 错答↓；beta 空则降级 E1 |
| E3 | `MORPH_WEIGHT` 默认 0.8 | morph 变体降权防带偏 | bench 选定 0.8 |

E2 accept 时：`confidence = 0.5*ocrConf + 0.5*agreement`，且 `ocrConf ≥ min(MIN, SOFT)`。

### 5.7 模板回退（`_solve_template`）

条件：dddd **完全 miss**（返回 `None`）∧ 非彩色 ∧ VLM 仍未 solved。  

- 彩色 → 直接拒绝（模板只认直立深色字）  
- 否则 IoU 滑窗模板匹配  

注：`_solve_blobs`（连通域+旋转）**已实现但未挂到 `solve_image`**。

### 5.8 `solve_image` 终态顺序

```text
OCR=template? → 仅模板，结束
hit = dddd 或 合成弃权 stub
should_invoke_vlm? → try_vlm → merge；若 solved 则返回
dddd_miss ∧ ¬colorful ∧ ¬solved → 模板
否则返回 hit（补 vlmUsed=false）
```

---

## 6. VLM 二次识别设计

### 6.1 目标（冻结）

主路径仍是 ddddocr；仅当「不准 / 不敢交」时调用本机 7B 视觉模型。  
冻结确认：Qwen2.5-VL 系 + OpenAI 兼容本地 HTTP；T1–T3 全开；冲突 `vlm_prefer`；默认 `VLM=auto`。

### 6.2 就绪与触发（`should_invoke_vlm`）

**就绪 `vlm_ready`：** `mode≠off` 且 `VLM_URL`、`MODEL` 非空；可选探测 `GET {URL}/models`（失败仍允许稍后试）。

| 触发 | 条件 | 默认 |
|------|------|------|
| T1 | `solved=false` | 开 |
| T2 | `confidence < VLM_MIN_DDDD_CONF`（0.55） | 开 |
| T3 | `votes≥2` 且 `0 < weightShare < WEAK_SHARE`（0.5） | 开 |
| T4 | `VLM=always` | 调试 |

高置信 ACCEPT 且 conf≥0.55 且共识不弱 → **不打 VLM**。

### 6.3 调用形态（`call_vlm_raw` / `try_vlm`）

- `POST {VLM_URL}/chat/completions`  
- `temperature=0`, `max_tokens=32`  
- 图缩到最长边 ≤512，data-URL PNG  
- 原始输出再走 `normalize_captcha_text`  
- 成功时固定 `confidence=0.75`, `engine=vlm7b`  
- 并发：模块级 `Semaphore(1)`（见 §8 缺口）

### 6.4 合并策略（`merge_dddd_vlm`）

| 情况 | 行为 |
|------|------|
| 无 VLM 结果 | 原 dddd |
| VLM 空/失败 | 保留 dddd |
| dddd 弃权 + VLM 有字 | 用 VLM |
| 两者相同（casefold） | ACCEPT，`ddddocr+vlm7b`，conf=max |
| 冲突 + `vlm_prefer` | **用 VLM**（默认） |
| 冲突 + `dddd_prefer` | 留 dddd |
| 冲突 + `abstain_on_conflict` | 弃权 |

### 6.5 与 Worker 超时关系

| 组件 | 默认超时 | 含义 |
|------|----------|------|
| `HERMES_CAPTCHA_VLM_TIMEOUT_MS` | **8000** | solver 内单次 VLM |
| `HERMES_CAPTCHA_TIMEOUT_SEC` | **60** | Worker 调 webhook 总超时 |
| CPU 实测 | ~480–960s / 次 | 远超上述默认 |

→ 未显式加长超时时，CPU VLM **几乎必然超时回落**。

---

## 7. Slider / Click（摘要）

| 引擎 | 方法 | 输出 |
|------|------|------|
| slider | 暗色近方块 blob：左滑块、右缺口 → `offsetX`；失败则约 62% 宽启发式 | `offsetX` |
| click | 高饱和色块 ≥2 → 各中心点 | `points`, `coord=viewport` |

能力边界：无语义点选、无对抗轨迹、无极验协议。

---

## 8. 配置一览（实现默认值）

### 8.1 Solver

| 变量 | 默认 | 说明 |
|------|------|------|
| `HERMES_CAPTCHA_SOLVER_HOST/PORT` | `127.0.0.1` / `18085` | 监听 |
| `HERMES_CAPTCHA_API_KEY` | 空 | 可选 Bearer |
| `HERMES_CAPTCHA_OCR` | `auto` | 引擎模式 |
| `HERMES_CAPTCHA_OCR_MIN_CONF` | `0.5` | 投票门槛 |
| `HERMES_CAPTCHA_OCR_SOFT_CONF` | `0.45` | E1 彩色 soft |
| `HERMES_CAPTCHA_OCR_LEN` | 空 | 精确长度 |
| `HERMES_CAPTCHA_OCR_CHARSET` | 空 | 字符白名单 |
| `HERMES_CAPTCHA_OCR_CASE` | `lower` | 大小写 |
| `HERMES_CAPTCHA_OCR_BETA` | 关 | 需显式开启 |
| `HERMES_CAPTCHA_OCR_AGREE` | `1` | 仅 beta 时生效 |
| `HERMES_CAPTCHA_OCR_AGREE_RELAX` | 关 | 关闭分歧弃权 |
| `HERMES_CAPTCHA_OCR_AGREE_MIN` | `1.0` | 同意阈值 |
| `HERMES_CAPTCHA_OCR_MORPH_WEIGHT` | `0.8` | morph 权重 |
| `HERMES_CAPTCHA_OCR_POS_VOTE` | 关 | 位置投票 |
| `HERMES_CAPTCHA_FAIL_DIR` | `/tmp/hermes-captcha-fails` | 失败图 |
| `HERMES_CAPTCHA_VLM` | `auto` | off/auto/always |
| `HERMES_CAPTCHA_VLM_URL` | 空 | 空则永不调用 |
| `HERMES_CAPTCHA_VLM_MODEL` | `qwen2.5vl:7b` | Ollama 实际标签 |
| `HERMES_CAPTCHA_VLM_TIMEOUT_MS` | `8000` | 与 CPU 实测严重不符 |
| `HERMES_CAPTCHA_VLM_MIN_DDDD_CONF` | `0.55` | T2 |
| `HERMES_CAPTCHA_VLM_WEAK_SHARE` | `0.5` | T3 |
| `HERMES_CAPTCHA_VLM_POLICY` | `vlm_prefer` | 冲突策略 |
| `HERMES_CAPTCHA_VLM_MAX_CONCURRENCY` | `1` | **已读未接线** |
| `HERMES_CAPTCHA_VLM_PROMPT` | 内置短英文 | 可覆盖 |

### 8.2 Worker

| 变量 | 默认 |
|------|------|
| `HERMES_CAPTCHA_WEBHOOK` | 空 = 未配置 |
| `HERMES_CAPTCHA_TIMEOUT_SEC` | `60` |
| `HERMES_CAPTCHA_API_KEY` | 空 |

### 8.3 两套常用运行画像（运维事实）

| 画像 | 典型用途 | 特征 |
|------|----------|------|
| demo-strict | `:3000` bench | `LEN=6` + 去混淆 charset + `BETA+AGREE` + 较高门槛 |
| DCP-wide | 实站宽配 | 无 LEN/CHARSET、`AGREE=0`、`MIN/SOFT` 略松 |

同一进程**不能**同时最优服务两套站点；需分进程或分配置重启。

---

## 9. Worker 侧对接要点（`worker-browser`）

1. `screenshotCaptchaRegion`：优先 locator 紧裁截图（避免整页）  
2. `POST` webhook：`{jobId, pageUrl, kind, screenshotBase64, hint}`  
3. `applyCaptchaSolution`：image→fill；click→逐点 click；slider→track 或 drag  
4. **不在 Worker 内校验答案对错**；只看填后验证码是否还在  

相关：`HERMES_CAPTCHA_WEBHOOK`、`HERMES_CAPTCHA_TIMEOUT_SEC`。

---

## 10. 实测与验收现状（供分析）

| 来源 | 要点 |
|------|------|
| E1–E3 | Soft/Agree/Morph 改善 precision；会话成功率硬门槛（如 85%）多轮未过 |
| VLM Phase1 | 已冻结；Phase2 已实现；CPU 实机可通 |
| Bench `vlm-off-baseline` | 首试 33.3%，precision 76.9%，弃权多 |
| Bench `vlm-auto-ttl45m` | 首试 26.7%；VLM 6 次 **0 救回**；3 次错误提交 |
| 无效对照 | 曾用 2min demo TTL + 8min VLM → 大量「会话不存在」，**不能**当准确率 |

---

## 11. 已知实现缺口与可疑设计点（审阅清单）

> 下列为**现状观察**，便于你标「不合理」；不预设改造优先级。

### 11.1 架构 / 产品

1. **双站点配置未产品化**：demo-strict 与 DCP-wide 靠手工重启 env，易配错。  
2. **Verify 与 Solver 时序割裂**：慢二次识别（VLM）与站点 session TTL 无协同；Worker 超时与 VLM 超时默认也不匹配。  
3. **`vlm_prefer` 与「dddd 已较准」冲突**：bench 显示 VLM 错答会覆盖/替代，拉低 precision。  
4. **VLM 成功置信度写死 0.75**：无模型校准，却能通过 T2/合并逻辑影响决策观感。  
5. **默认 `VLM=auto` 但 `VLM_URL` 默认空**：名义默认开、实际默认关；文档与运维心智易混。  
6. **默认 `VLM_TIMEOUT_MS=8000`**：与 7B CPU 分钟级延迟数量级不符；未配长超时等于功能虚设。

### 11.2 OCR 决策

7. **Singleton @ LEN → confidence=1.0**：单路读数可「满置信」，soft/agree 管不住；错答成本高。  
8. **E2 `confidence` 被改写成 0.5·ocr+0.5·agree**：与 E3 weightShare 语义混用，T2（按 confidence 阈值）触发含义漂移。  
9. **T3 依赖 `weightShare`**：弃权 stub / agreement 拒绝路径可能缺字段 → T3 失效或不稳定。  
10. **彩色禁止模板、灰度才模板**：合理防错，但 auto 下「dddd miss 的灰度难例」与「彩色难例」待遇不对称。  
11. **`_solve_blobs` 死代码**：旋转字符路径未接线。  
12. **CHARSET 过滤无混淆映射**：与 demo 去 `0/O/1/I/l` 策略一致，但对 VLM 大小写混输依赖 `CASE=lower`。  
13. **`auto` 失败连环试 slider/click**：字符图可能被几何引擎「假成功」（低置信启发式滑块尤甚）。

### 11.3 VLM 实现

14. **`VLM_MAX_CONCURRENCY` 未真正改 semaphore**：配置谎言。  
15. **只支持 OpenAI `/v1/chat/completions`**：Ollama 原生 `/api/generate` 未接（参考脚本有，本实现无）。  
16. **未使用 ddddocr `probability=True`**：T2 用的是投票 conf，不是字符级概率。  
17. **触发面偏宽（T1+T2+T3）**：CPU 下调用率高、延迟爆炸；bench 调用率约 40%。  
18. **无「仅弃权子集才采用 VLM」的 precision 保护**：空结果正确保持弃权，但错误文本照样提交。

### 11.4 运维 / 观测

19. **Health 不暴露 VLM 超时、策略、触发阈值**：排障靠读 env。  
20. **Bench HTTP 原默认 60s**：已加 `SOLVER_TIMEOUT_S`，但与 Worker 60s 默认仍不一致。  
21. **失败落盘不含 VLM 原始对话**：仅有 `vlmRaw` 截断字段（若返回）。  
22. **captcha-demo 源码 root 只读**：本机改 TTL 需复制进程，正式树与 bench 环境易分叉。

### 11.5 能力边界（文档已声明，仍属产品风险）

23. Slider/Click 仅为几何/色块启发式。  
24. 不对抗 Cloudflare / 行为风控 / 协议级验证码。  
25. 截图质量强依赖 Worker 裁剪；历史曾整页截图导致 OCR 崩。

---

## 12. 关键符号索引

| 职责 | 符号 | 文件 |
|------|------|------|
| HTTP | `SolverHandler` | `captcha-solver/app.py` |
| 入口 | `solve_request` | `solvers/dispatch.py` |
| 分类 | `classify` | `solvers/classify.py` |
| 图像求解 | `solve_image` | `solvers/ocr.py` |
| 变体 | `ocr_variants` | `solvers/enhance.py` |
| 投票/门闩 | `fuse_ocr_votes`, `gate_on_agreement`, `soft_conf` | `solvers/ocr.py` |
| 归一化 | `normalize_captcha_text` | `solvers/ocr.py` |
| VLM | `should_invoke_vlm`, `try_vlm`, `merge_dddd_vlm` | `solvers/vlm.py` |
| Worker | `callCaptchaSolver`, `applyCaptchaSolution` | `worker-browser/src/runtime/captcha.ts` |

---

## 13. 使用本文档的方式

1. 按 §11 清单打标：同意 / 不同意 / 需数据。  
2. 对要改的项开 **Phase 1 需求**（单份 REQ，不直接改代码）。  
3. 准确率数字以 `reports/captcha_ocr_bench_*.md` 为准；引用时注明是否含 VLM、是否已修正 session TTL。
