# captcha-solver

独立 **CAPTCHA Solver Service**。不内嵌进 `worker-browser` / Playwright。

Hermes Worker 继续负责：探测、截图、调用本服务、按结果 fill / click / drag、以及验证码是否消失。本进程只做 **Detect → Classify → Solve**。

## Trace 绑定（Phase 2）

Worker 请求应带 `attemptId` / `imageHash`（截图原始字节 SHA-256）/ `timestamp`；响应原样回显。  
观测含 `pipelineTrace.stages[]`（decode / raw_ocr / yolo / yolo_ocr / s0 / fusion …）。**S0 仅为观测，不决定是否提交。**

### Fusion shadow（默认）

`HERMES_CAPTCHA_FUSION=shadow|on|off`（默认 **shadow**）：

| 模式 | 行为 |
|------|------|
| `shadow` | 计算 `shadowDecision` / `shadowDelta`，**不改** `solved`/`text` |
| `on` | Fusion 改写提交结果（需数据验证后再开） |
| `off` | 不算 Fusion |

生产 JSONL **默认不写原图**，只写 hash / attemptId。  
YOLO：`HERMES_CAPTCHA_YOLO_WEIGHTS` + `HERMES_CAPTCHA_DETECT=auto|yolo|off`；无权重时跳过，raw_ocr 照常。  
粘连 split：`HERMES_CAPTCHA_SPLIT=on|off`（默认 on）。宽 bbox 走垂直投影 / 连通域，Trace 记 `stage=split`。

### 训练数据（demo 同款）

```bash
# 生成 1000 张（依赖 ../captcha-demo/node_modules/canvas）
COUNT=1000 node scripts/generate_demo_train_set.mjs
# → datasets/demo_char_detect/{images,labels,gt,data.yaml,manifest.jsonl}

# 安装 YOLO 依赖并训练（单类 character）
.venv/bin/pip install -r requirements-yolo.txt
EPOCHS=40 IMGSZ=320 BATCH=8 .venv/bin/python scripts/train_yolo_char.py
# → runs/detect/demo_char_v1/weights/best.pt
export HERMES_CAPTCHA_YOLO_WEIGHTS=$PWD/runs/detect/demo_char_v1/weights/best.pt
export HERMES_CAPTCHA_DETECT=yolo
```

```bash
# 视觉层 A/B 实验（无数据集时写空报告模板）
captcha-solver/.venv/bin/python scripts/captcha_visual_ab.py
DATA_DIR=/path/to/labeled  captcha-solver/.venv/bin/python scripts/captcha_visual_ab.py
```

仅用于**自己控制的站点或已授权测试环境**。第三方站点（尤其 Cloudflare 等结合浏览器/网络/行为信号的挑战）不在范围内，也不是 OCR 能解决的。

## 架构

```text
Hermes / worker-browser
        │
        │  POST /captcha   (现有 Webhook 契约，勿改字段名)
        ▼
captcha-solver
        │
   Classifier
        │
   ┌────┼────┐
   ▼    ▼    ▼
  OCR  Slider Click
```

不把所有验证码丢给大模型。字符码：**预处理多版本 → ddddocr 投票 → 长度/字符集过滤 → 置信度**；失败回退模板 OCR。滑块走缺口/滑块块检测；点选走彩色目标块。

## 启动

优先用项目 venv（含 ddddocr）。系统 Python 无 pip 时不要往全局装包。

```bash
cd captcha-solver
python3 -m venv .venv
.venv/bin/pip install -r requirements-ocr.txt
.venv/bin/python app.py
# 127.0.0.1:18085
```

venv / `ensurepip` 失败时仍可用系统 Python 跑模板 OCR：

```bash
python3 app.py
```

Worker：

```bash
HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha
```

然后重启 **browser-worker**。换 OCR 引擎只需重启 **captcha-solver**。`make smoke-auth` 仍走 `:18084` mock，不要改成打本服务。

| 变量 | 说明 |
|------|------|
| `HERMES_CAPTCHA_SOLVER_HOST` | 默认 `127.0.0.1` |
| `HERMES_CAPTCHA_SOLVER_PORT` | 默认 `18085` |
| `HERMES_CAPTCHA_API_KEY` | 可选；与 Worker Bearer 一致时校验 |
| `HERMES_CAPTCHA_OCR` | `auto`（默认：ddddocr 多版本投票 → 模板） / `ddddocr` / `template` |
| `HERMES_CAPTCHA_OCR_MIN_CONF` | 投票置信度下限，默认 `0.5`；低于此值不把 text 当成功 |
| `HERMES_CAPTCHA_OCR_LEN` | 可选；期望验证码长度（如 demo 固定 `6`） |
| `HERMES_CAPTCHA_OCR_CHARSET` | 可选；允许的 ASCII 字母数字子集 |
| `HERMES_CAPTCHA_OCR_CASE` | `lower`（默认）/ `keep`；与大小写不敏感校验站点对齐 |
| `HERMES_CAPTCHA_OCR_SOFT_CONF` | 彩色 soft 门槛，默认 `0.45`；≥`MIN_CONF` 则关闭 soft |
| `HERMES_CAPTCHA_OCR_BETA` | `1` 启用 beta 模型并行读 |
| `HERMES_CAPTCHA_OCR_AGREE` | beta 开启时默认 `1`：融合结果须双侧支持，否则弃权 |
| `HERMES_CAPTCHA_OCR_AGREE_RELAX` | `1` 关闭分歧弃权（回退 E1 行为） |
| `HERMES_CAPTCHA_OCR_AGREE_MIN` | 同意阈值，默认 `1.0`（双侧均出现赢家拼写） |
| `HERMES_CAPTCHA_OCR_MORPH_WEIGHT` | `morph_*` 投票权重，默认 **`0.8`**；`0` 等于不计入 |
| `HERMES_CAPTCHA_VLM` | `off` / **`auto`（默认）** / `always`；本地 7B 二次识别 |
| `HERMES_CAPTCHA_VLM_URL` | 本地 OpenAI 兼容基址，如 `http://127.0.0.1:11434/v1`；**空则不调用** |
| `HERMES_CAPTCHA_VLM_MODEL` | 默认 `qwen2.5vl:7b`（Ollama 库实际标签；旧名 `qwen2-vl:7b` 不存在） |
| `HERMES_CAPTCHA_VLM_TIMEOUT_MS` | 默认 `8000` |
| `HERMES_CAPTCHA_VLM_MIN_DDDD_CONF` | 仅当 `VLM_TRIGGERS` 含 `t2` 时使用（默认 `0.55`） |
| `HERMES_CAPTCHA_VLM_WEAK_SHARE` | 仅当 `VLM_TRIGGERS` 含 `t3` 时使用（默认 `0.5`） |
| `HERMES_CAPTCHA_VLM_TRIGGERS` | 默认 **`t1`**（仅 primary 未 solved）；可选 `t1,t2,t3` |
| `HERMES_CAPTCHA_VLM_POLICY` | 冲突策略：默认 **`abstain_on_conflict`**；可选 `dddd_prefer` / `vlm_prefer` |
| `HERMES_CAPTCHA_VLM_MAX_CONCURRENCY` | 默认 `1` |
| `HERMES_CAPTCHA_OBS_JSONL` | 可选；观测记录追加写入该 JSONL 路径（S2；默认关闭） |

### Session / Attempt 观测（S2）

响应在 Worker 必填字段之外附加（可忽略）：

- `sessionId`：请求透传 `sessionId` / `captchaSessionId` 优先，否则 solver 生成
- `attemptId`：每次 `/captcha` 调用唯一
- `observation`：`snapshotStatus` / `classifier` / `candidates` / `decision` / 可选 `failureReason`

不改变 `solved` / apply / verify 流程；无 session API、无 polling、无 retry。详见 `docs/REQ_CAPTCHA_DECISION_SESSION.md` §11。

### Verify Feedback（S3）

```bash
POST /captcha/feedback
POST /v1/captcha/feedback
```

用 `sessionId` + `attemptId` 关联当次 decision 与事后 `verifyResult`（`success|failed|not_executed|unknown`）。**不改写**当次 `decisionScore` / `confidence`。可选 `HERMES_CAPTCHA_FEEDBACK_JSONL`（未设则写入 `OBS_JSONL`）。Bench 已在 verify 后自动回写；Worker 回写可选。详见 REQ §12。

### Adaptive Retry（S4）

Policy Engine：`feedback → failureClass → retryPlan`（默认 `maxAttempts=2`）。  
`POST /captcha/feedback` 响应附带 `retryPlan`（可用 `includeRetryPlan=0` 关闭）。  
Bench：`ADAPTIVE_RETRY=1` 按 plan 重试（非盲目 `RETRIES`）。下一 attempt 可通过 `retryHints`（如 `vlm=off`）约束，**不**改历史 decision。详见 REQ §13。

### Policy / Profile（S5）

请求携带 `"profile": "demo-strict"` 或 `"dcp-wide"`（默认见 `HERMES_CAPTCHA_PROFILE`，仅 bootstrap）。  
内置文件：`captcha-solver/profiles/*.json`。可选 `HERMES_CAPTCHA_PROFILES_DIR`。  
优先级：请求字段 / `profileOverrides` → `req.profile` → 默认 profile → 内置 defaults。  
**Profile 只改参数值，不改 S1–S4 语义。** 响应含 `profile`；`/health` 列出 `profiles`。

### 本地 7B VLM（可选）

ddddocr 主路径不变；默认仅在 **T1（primary 弃权）** 时调用本机视觉模型。冲突默认 **ABSTAIN**（不因模型更大而覆盖 dddd）。需先起 OpenAI 兼容服务，例如 Ollama：

```bash
ollama pull qwen2.5vl:7b
# 默认已监听 11434

export HERMES_CAPTCHA_VLM=auto
export HERMES_CAPTCHA_VLM_URL=http://127.0.0.1:11434/v1
export HERMES_CAPTCHA_VLM_MODEL=qwen2.5vl:7b
# 再启动 captcha-solver；/health 应见 vlmReady=true
```

未设置 `VLM_URL` 时行为与未安装 VLM 一致。Worker `captchaTimeout` 建议 ≥15–30s（触发 7B 时可能数秒）。详见 `docs/REQ_CAPTCHA_VLM7B.md`。

## 多轮准确率压测（:3000 demo）

```bash
# solver 按上表配 LEN/CHARSET 后：
ROUNDS=50 captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py
```

报告写入 `reports/captcha_ocr_bench_*.md`。说明见 `docs/CAPTCHA_OCR_BENCH.md`。

## HTTP

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/health` | 存活 |
| POST | `/captcha` | **Hermes 适配**（`HERMES_CAPTCHA_WEBHOOK`） |
| POST | `/captcha/feedback` | **S3** verify 回写（`sessionId`+`attemptId`） |
| POST | `/v1/captcha/solve` | 同上，多 `success`/`confidence` |
| POST | `/v1/captcha/detect` | 只分类，不求解 |
| POST | `/v1/captcha/feedback` | feedback 别名 |

Hermes 请求：`jobId`、`pageUrl`、`kind`、`screenshotBase64`、`hint`。

成功响应（Worker 只认这些必填语义）：

- image：`{ "solved": true, "kind": "image", "text": "..." }`
- click：`{ "solved": true, "kind": "click", "coord": "viewport", "points": [{"x","y"}] }`
- slider：`{ "solved": true, "kind": "slider", "offsetX": N }`
- 失败：`{ "solved": false, "reason": "..." }`，HTTP **200**

附加字段（Worker 可忽略）：`success`、`confidence`、`latency_ms`、`classifiedAs`、`engine`（`ddddocr` / `template` / `vlm7b` / `ddddocr+vlm7b`）、`preprocess`、`votes`、`vlmUsed`、`ddddText`、`vlmText`。

本服务**没有浏览器、没有 Redis 队列、不做 Verify**。Verify 在 Worker：应用后再探测验证码是否还在。

## 测试

```bash
# 有 .venv 时 Makefile 会用 venv Python（含 ddddocr 用例）
make test-captcha-solver
# 或：
python3 -m unittest discover -s tests -v
```

无 ddddocr 时 T-Ocr-02 会 skip，其余用例走模板。

## 精度

字符码流水线（`auto`）：

```text
ROI（Worker 已裁）→ raw / 放大 / 灰度对比度 / 去白边 / CLAHE / 二值化
                 → ddddocr × N → 投票 → [A-Za-z0-9] 且长度 4–6
                 → confidence = 得票 / 有效次数（仅 1 条有效时用 1/尝试次数）
                 → 低于 HERMES_CAPTCHA_OCR_MIN_CONF 则 solved:false，再试模板
```

自己的测试图可过单测。公网站、极验、Cloudflare Turnstile **不保证**。HTTP 契约保持不变。
