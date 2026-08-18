# Phase 1 需求：本地 7B 视觉模型辅助验证码识别

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-15 |
| 状态 | **Phase 2 已实现**；待 Phase 3 问题单 / 实机验收 |
| 范围 | 仅 `captcha-solver/` 的 **image** 识别链路；不改 Hermes / Worker Webhook 契约 |
| 触发 | DCP 等实站上 ddddocr 常弃权或读错；用户要求本地 **7B 图像模型**仅作 **ddddocr 不准时的回退** |
| 父需求 | `docs/REQ_CAPTCHA_SOLVER.md`、`docs/REQ_CAPTCHA_OCR.md` |
| 关联 | E1–E3 Selective OCR；`docs/CAPTCHA_OCR_BENCH.md` |
| 冻结确认 | 2026-08-15：① Qwen2-VL-7B + 本地 OpenAI 兼容（Ollama/vLLM）② T1–T3 全开 ③ 冲突 `vlm_prefer` ④ 默认 `HERMES_CAPTCHA_VLM=auto` |

---

## 1. 一句话目标

> **主路径仍是 ddddocr（快、本地、零外呼）；仅当 ddddocr「不准 / 不敢交」时，再调用本机 7B 视觉模型做二次识别。**

```text
截图
  → ddddocr（多变体 + 投票 + 现有决策门闩）
       ├─ ACCEPT（高可信）→ 直接返回 text
       └─ 不准 / 弃权 / 低可信
            → 本地 7B VLM（可选）
                 ├─ ACCEPT → 返回 text（engine=vlm7b）
                 └─ 仍失败 → solved=false（与现契约一致）
```

---

## 2. 什么叫「ddddocr 不准」（触发条件）

须 **显式、可配置**，禁止「每次都打 7B」。默认满足 **任一** 即触发二次识别（可用 env 开关单条）：

| 触发 | 说明 | 默认 |
|------|------|------|
| T1 弃权 | ddddocr 最终 `solved=false`（含 low confidence / disagreement） | **开** |
| T2 低决策分 | `solved=true` 但 `confidence < VLM_MIN_DDDD_CONF`（默认 0.55） | **开** |
| T3 弱共识 | 有效读数 ≥2 且赢家权重占比 `< VLM_WEAK_SHARE`（默认 0.5） | **开** |
| T4 强制 | `HERMES_CAPTCHA_VLM=always`（仅调试） | 关 |

**不触发（必须跳过 7B）**：

- `HERMES_CAPTCHA_VLM=0/off` 或模型未就绪  
- 模板 OCR 路径（`HERMES_CAPTCHA_OCR=template`）  
- 非 image（slider/click）  
- 图过小 / 解码失败（与现失败原因一致）

---

## 3. 产品与架构边界

### 做

1. 在 `captcha-solver` 内增加 **可选** VLM 后端（本地推理，默认不外呼）。  
2. ddddocr 主路径逻辑保持；VLM 仅挂在「二次机会」钩子。  
3. 响应兼容现契约：`solved` / `text` / `confidence` / `engine` / `reason`；可增 `vlmUsed`、`ddddText`（可选，便于排障）。  
4. 健康检查暴露：`vlmReady`、`vlmModel`、是否启用。  
5. 超时、并发、显存占用可配置；超时则等同未启用，回落 ddddocr 结果（含弃权）。

### 不做

| 项 | 说明 |
|----|------|
| 改 Worker / Gateway JSON 主字段 | ❌ |
| 默认每次请求都跑 7B | ❌ |
| 云 API / 打码平台 | ❌（本期） |
| 用 7B 解滑块/点选/极验 | ❌ |
| 保证某公网站 100% | ❌ |
| 把 7B 权重打进 git | ❌（本地路径 / 首次拉取说明） |

---

## 4. 模型与运行时（建议冻结项，确认时选定）

| # | 项 | 建议默认 | 备注 |
|---|-----|----------|------|
| M1 | 参数量 | **约 7B** 多模态（可识图+出短文本） | 具体权重名确认时写死一条（如 Qwen2-VL-7B-Instruct / 等价本地包） |
| M2 | 推理 | **本机**（优先 GPU；无 GPU 可 CPU 但须文档标明极慢） | |
| M3 | 接入形态 | OpenAI 兼容 **本地 HTTP**（如 ollama / vLLM / llama.cpp server）**或** 进程内引擎二选一 | Phase 1 建议优先 **HTTP 本地服务**，与 Solver 进程解耦 |
| M4 | 输入 | 验证码 RGB PNG（可先缩放到最长边 ≤512） | 与 Worker 截紧图配合 |
| M5 | 输出 | 仅字母数字串；再走现有 `normalize_captcha_text`（LEN/CHARSET/CASE） | 禁止把模型闲聊写入 `text` |
| M6 | Prompt | 固定短提示：「只输出验证码字符，无空格无解释」 | 可 env 覆盖 |

**资源门禁（验收前必须说清）**：目标机显存建议 ≥8–12GB（量化后可降）；不满足则 `vlmReady=false`，行为与未安装一致。

---

## 5. 决策合并规则

```text
dddd = ddddocr 结果
vlm  = 7B 结果（仅触发时）

若未触发 VLM → 返回 dddd

若触发：
  1) vlm 规范化后为空 → 返回 dddd（保持原 solved/reason）
  2) vlm 合法且 dddd 弃权 → ACCEPT vlm（engine=vlm7b）
  3) 两者都有 text：
       - 相同（casefold）→ ACCEPT，confidence=max(dddd,vlm) 或加权
       - 不同 → 默认采用 vlm（二次意见优先），或
         HERMES_CAPTCHA_VLM_POLICY=dddd_prefer|vlm_prefer|abstain_on_conflict
         （建议默认 vlm_prefer；冲突弃权作可选项）
```

禁止：dddd 已高置信 ACCEPT 时仍调用 7B（除非 `always`）。

---

## 6. 配置（env 草案）

| 变量 | 默认 | 含义 |
|------|------|------|
| `HERMES_CAPTCHA_VLM` | `auto` | `off` / `auto` / `always` |
| `HERMES_CAPTCHA_VLM_URL` | 空 | 本地 OpenAI 兼容 endpoint（如 `http://127.0.0.1:11434/v1`） |
| `HERMES_CAPTCHA_VLM_MODEL` | `qwen2.5vl:7b` | Ollama 库实际标签（`qwen2-vl:7b` 不存在） |
| `HERMES_CAPTCHA_VLM_TIMEOUT_MS` | `8000` | 单次超时 |
| `HERMES_CAPTCHA_VLM_MIN_DDDD_CONF` | `0.55` | 低于则视为「不准」可触发 |
| `HERMES_CAPTCHA_VLM_WEAK_SHARE` | `0.5` | 弱共识阈值 |
| `HERMES_CAPTCHA_VLM_POLICY` | `vlm_prefer` | 冲突策略（冻结） |
| `HERMES_CAPTCHA_VLM_MAX_CONCURRENCY` | `1` | 防显存打爆 |

---

## 7. 验收标准

| 项 | 标准 |
|----|------|
| 契约 | Worker 仅靠原字段即可填码；无强制新字段 |
| 默认关闭 | `VLM=off` 时行为与当前 Solver **比特级一致**（单测回归） |
| 触发节制 | DCP/demo 压测中，`auto` 下 7B 调用率 **&lt; 50%** 请求（可调；需在报告给出） |
| 延迟 | 未触发时 P95 相对现状增幅 **&lt; 5%**；触发时单次允许数秒级，须有超时 |
| 准确率 | 在「dddd 弃权子集」上，启用 VLM 后该子集会话成功率 **明显上升**（报告给出前后对比，至少 40 张实拍或 bench 失败回放） |
| 失败态 | 7B 挂掉 / 超时 → 不 500，返回 dddd 结果或弃权 |
| 单测 | mock VLM：触发 / 不触发 / 超时 / 冲突策略 |

---

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 7B 慢、拖垮 Worker 超时 | 独立超时；并发=1；Worker `captchaTimeout` 文档建议 ≥15–30s |
| 显存不足 | `vlmReady=false`；量化 / 小上下文；不默认开启 |
| 7B 幻觉乱输出 | 强 normalize + 长度/字符集；冲突可 abstain |
| 「不准」定义过宽 → 几乎每次打 7B | 调用率验收门禁；默认阈值偏严 |
| 与 demo 严配置打架 | 站点分配置（DCP 宽 / demo 严）写进运维说明 |

---

## 9. Phase 2 实施顺序（确认后）

1. 抽象 `SecondaryOCR` 接口 + HTTP 本地 VLM 适配  
2. 在 `solve_image` 末尾接触发条件与合并策略  
3. `/health` + env；失败落盘可附带 `vlmUsed`  
4. mock 单测 + 实拍/失败集回放对比报告  
5. 文档：如何起本地 7B 服务、推荐机型、与 DCP 宽配置组合  

---

## 10. 确认项（已冻结）

1. **模型**：Qwen2-VL-7B + 本地 OpenAI 兼容（Ollama/vLLM）  
2. **触发**：T1–T3 全开；`always` 仅调试  
3. **冲突**：默认 `vlm_prefer`  
4. **默认**：`HERMES_CAPTCHA_VLM=auto`（无 `VLM_URL` 时等同未启用）
