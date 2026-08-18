# Phase 1 需求：CAPTCHA Solver 决策层拆分与会话化重构

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-15 |
| 状态 | **Phase 3 Validation 已执行**（报告见 `reports/phase3_validation_summary.md`；暂缓 S6） |
| 触发 | 用户结论：最大问题不是单一 OCR 算法，而是 **识别 / 置信度 / 决策 / 重试 / 验证** 耦合，系统易把「看起来像答案」当成「应该提交的答案」 |
| 依据 | `docs/DESIGN_CAPTCHA_SOLVER.md` §11；E1–E3 收益递减；VLM bench（`vlm-auto-ttl45m`：6 次调用 **0 救回**、错误提交拉低 precision） |
| 父文档 | `DESIGN_CAPTCHA_SOLVER.md`、`REQ_CAPTCHA_SOLVER.md`、`REQ_CAPTCHA_OCR_ACCURACY.md`、`REQ_CAPTCHA_VLM7B.md` |
| 下一阶段禁令 | **禁止再开「E4 预处理 / 再加阈值」类补丁** 作为主迭代 |

---

## 1. 一句话目标

> 把 captcha-solver 从「增强版 heuristic recognizer」升级为带 **显式决策层** 的 solving engine：  
> **Detection → Candidates → Evidence → Decision(ACCEPT/ABSTAIN/RETRY) → Execute → Verify → Feedback**，  
> 优化目标改为 **maximize session_success，约束 false_accept 与尾延迟**，而不是继续堆 OCR 规则。

---

## 2. 问题定性（冻结认知）

### 2.1 根因

当前链路实质是：

```text
截图 → 分类 → OCR/Slider/Click → 得到结果 → confidence → solved=true
```

把下面两件事混成一个概念：

| 概念 | 含义 |
|------|------|
| 识别结果 | 模型认为答案是什么 |
| 决策结果 | 系统是否应该把该答案交出去执行 |

因此同时出现：Singleton→`confidence=1.0`、VLM 固定 `0.75`、冲突 `vlm_prefer`、slider 62% fallback、`auto` 跨类型串行尝试——**本质都是决策层缺失，不是识别层不够复杂**。

### 2.2 实证趋势（已有数据）

| 现象 | 含义 |
|------|------|
| E1–E3：precision↑，会话成功率仍难达硬门槛 | 识别补丁无法替代决策/会话 |
| VLM `auto`（TTL 修正后）：调用 6/15，**0 救回**，错误提交拉低 precision | VLM 当前是候选生成器，不是可信决策器 |
| 未修正 TTL 的早期 bench：大量「会话不存在」 | Verify 时序与慢路径无协同，指标会撒谎 |

### 2.3 判定

> OCR Engine 层已开始复杂化；**Decision / Session / Verify** 层明显不足；继续加算法进入收益递减，且易出现 precision↑、session success 不升反降、latency↑、false accept↑。

---

## 3. 目标架构（七层）

```text
CAPTCHA SESSION
      │
      ▼
┌─────────────┐
│  Detector   │  kind + probability + alternatives
└──────┬──────┘
       ▼
┌──────────────────┐
│ Candidate Engine │  OCR / VLM / Geometry → candidates[]
└────────┬─────────┘
         ▼
 Evidence Aggregator   raw_score / agreement / evidence（禁止混叫 confidence）
         │
         ▼
  Decision Engine
  ├─ ACCEPT
  ├─ ABSTAIN
  └─ RETRY（带原因 → 下一步策略）
         │
         ▼
      Worker Execute
         │
         ▼
        Verify
         │
    SUCCESS / FAIL → Feedback（更新本 session 策略，可选回写观测）
```

### 3.1 分层职责（必须拆开）

| 层 | 输入 | 输出 | 禁止 |
|----|------|------|------|
| Detector | 截图 + hint | `kind`, `P(kind)`, alternatives | 直接 `solved=true` |
| Candidate | 图 + kind + profile | `candidates[]`（来源、原文、原始分） | 独自决定提交 |
| Evidence | candidates | 拆分分数：`raw_score` / `model_confidence` / `agreement_score` / `evidence_score` | 用单一 `confidence` 贯穿全链路 |
| Decision | evidence + policy profile | `ACCEPT` / `ABSTAIN` / `RETRY` + reason_code | 启发式「猜一个也算成功」 |
| Execute | Worker | fill / click / drag | 在 solver 内假装已验证 |
| Verify | 页态 / demo verify | success/fail + 原因 | 忽略失败反馈 |
| Feedback / Retry | fail reason | 下一步 attempt 策略 | `retry == 原样再跑一遍` |

### 3.2 分数语义（强制拆名）

| 名称 | 含义 | 可否当 P(correct) |
|------|------|-------------------|
| `raw_score` | 引擎原始分 / 票权 | 否 |
| `weight_share` | 候选在本轮集合中的相对支持比例 | **否**（不是概率） |
| `model_confidence` | 单模型自报或校准后分（须声明是否校准） | 仅当已校准 |
| `agreement_score` | 多路径一致性 | 否 |
| `evidence_score` | 聚合后的证据强度 | 策略输入 |
| `decision_score` | 仅决策层使用的可阈值量 | 策略输入 |

**禁止**：Singleton 仅因「唯一读数 + LEN 命中」写 `confidence=1.0`。  
**禁止**：VLM 成功写死 `0.75` 并与其它引擎分数直接比大小。  
**禁止**：E2 改写后再被 T2 当作同一语义的 `confidence`。

---

## 4. P0 缺陷（按线上危害排序）

| ID | 缺陷 | 现状表现 | 验收方向 |
|----|------|----------|----------|
| **P0-1** | 错误答案被 ACCEPT | singleton=1.0；VLM 固定 0.75；slider 62% fallback | False Accept 可测、可限流；启发式不得 `solved=true` |
| **P0-2** | 无 Verify feedback 闭环 | solver 不知对错；precision↑≠session success↑ | Attempt 级记录 verify；至少能驱动本 session 的 RETRY 策略 |
| **P0-3** | `auto` 跨类型 fallback 假成功 | OCR fail→slider/click；slider 可 62% 瞎猜 | 跨 kind 仅当 Detector 不确定且候选低风险；禁止「随便猜也算 solved」 |
| **P0-4** | VLM 被当成更高等级 OCR | 默认 `vlm_prefer`；bench 0 救回 + 错交 | VLM 默认仅为 candidate；冲突默认不得优待 VLM |
| **P0-5** | 无 Session / Attempt / Candidate 模型 | 每次 POST 独立；retry=重复 | 引入 `captcha_session_id` / `attempt_id` / `candidate_id`（契约可渐进） |

---

## 5. 分域问题清单（纳入本期范围）

### 5.1 决策与置信度

- 废除「唯一结果 ⇒ 高置信」  
- `weightShare` 不得再命名/使用为校准概率  
- 统一 Decision：`ACCEPT | ABSTAIN | RETRY`，与 `solved` 映射规则写死  
- False Accept 成本 > False Reject（弃权可重试；错交可能风控）

### 5.2 Detector

- 输出 kind 概率与 alternatives，而非只 `max(feature_score)`  
- 不确定区间：主 kind + 二次确认 / 直接 ABSTAIN，而不是静默换引擎猜

### 5.3 Candidate / Evidence

- 承认「同模型 × 相关预处理」是**伪多样性**；投票权重需反映相关（或降权高度相关 variant）  
- std/beta 同意 ≠ 正确概率显著上升；agreement 只作 evidence，不作真理  
- VLM / OCR / Geometry 一律产出 candidate，进入同一聚合器

### 5.4 VLM 策略（修正冻结方向）

| 旧冻结（VLM7B REQ） | 新方向（待你确认） |
|--------------------|-------------------|
| T1–T3 全开 | 默认收紧：优先仅 T1（弃权）或可配置；禁止「稍犹豫就打 7B」 |
| `vlm_prefer` | **默认改为** `abstain_on_conflict` 或 `dddd_prefer`；VLM 只作候选 |
| `VLM=auto` + URL 空 | 明确：无 URL = 功能关；有 URL 仍须独立 decision 才 ACCEPT |
| `TIMEOUT_MS=8000` | 与运行时档位绑定（GPU/CPU profile）；禁止默认与实测差两个数量级却仍显示 Ready |

### 5.5 Retry（智能重试）

`retry != repeat`。按失败原因选择下一步（示例表，实现时可裁剪）：

| 原因 | 下一步 |
|------|--------|
| 多候选分歧 | 换预处理 / 要第三意见 |
| 长度/字符集不符 | segmentation / charset 策略 |
| 单字不稳 | position-level |
| 两模型冲突 | ABSTAIN 或第三候选，禁止默默偏袒 VLM |
| OCR 空 | template 或 VLM（受 profile 限制） |
| kind 不确定 | 加强 Detector / ABSTAIN |
| verify fail | **新截图**新 attempt |
| slider 偏了 | 重定位 track，禁止固定比例瞎猜 |

### 5.6 Session 模型

至少：

```text
Session
 ├─ Attempt 1 → candidates → decision
 ├─ Attempt 2 → …
 └─ Verify → feedback
```

请求可渐进：先在 **附加字段** 支持 `captchaSessionId` / `attemptId`；Worker 必填字段可暂不变。

### 5.7 配置 = Policy Profile（去进程级分叉）

```json
{
  "profile": "demo-strict | dcp-wide | …",
  "detector": {},
  "ocr": {},
  "vlm": {},
  "decision": {},
  "retry": {}
}
```

同一 solver 进程按请求/站点选择 profile，避免 `captcha-solver-1/2/3`。

### 5.8 指标四层（验收用）

```text
Recognition: candidate / top1 / abstain / calibration
Decision:    accept precision / false accept / false abstain
Execution:   fill·click·drag success / timeout
Session:     first-attempt success / eventual success / attempts/session / latency p50·p95·p99
```

**优化目标（约束优化）：**

```text
maximize session_success
subject to false_accept ≤ X
       and p95_latency ≤ Y
```

### 5.9 Slider / Click 边界

- Slider：禁止「找不到结构 → 62% 宽度 → solved=true」；失败必须 ABSTAIN/RETRY  
- 中长期 API 面向 `target` + `execution_hint`（path/duration），避免死钉 `offsetX` 唯一语义  
- Click：明确仅覆盖「几何色块点选」；语义点选（点汽车/数字）列为 **非目标** 或独立 Semantic 引擎，禁止继续堆 `if type==`

### 5.10 可靠性

- 修复 `VLM_MAX_CONCURRENCY` 配置谎言（读了就要生效，或删配置）  
- Health 从「组件存在」升级为「可用」：队列、近期错误率/超时、VLM 是否实际可在 SLA 内返回  
- 评估 ThreadingHTTPServer + 全局 VLM 锁导致的线程堆积；决策层应限制 in-flight

---

## 6. 范围与非目标

### 6.1 本期做（Phase 2 将拆迭代，但需求层一次说清）

1. 引入显式 **Decision** 与分数拆名（可先内嵌模块，不必一次七进程）  
2. 消灭 P0-1 中的三类假高置信 ACCEPT 来源（singleton / VLM 定分 / slider 比例猜）  
3. 收紧 `auto` 跨 kind fallback  
4. 修正 VLM 默认采用逻辑与触发面  
5. Session/Attempt 最小模型 + verify 回写观测（至少 bench/Worker 可传 session id）  
6. Policy profile 雏形（替换纯进程 env 分叉）  
7. 四层指标进 bench 报告  

### 6.2 本期不做

| 项 | 说明 |
|----|------|
| 再开 E4「又一个预处理/投票补丁」作为主线 | ❌ |
| 语义点选 / 极验协议 / Cloudflare | ❌ |
| 云打码 | ❌ |
| 保证公网站 100% | ❌ |
| 一次性重写 Worker 全部契约 | ❌（允许附加字段渐进） |
| 本机无 GPU 时强行把 7B 当默认 ACCEPTor | ❌ |

---

## 7. 与现有 REQ 的关系

| 文档 | 关系 |
|------|------|
| `REQ_CAPTCHA_VLM7B.md` | **部分冻结项作废待重冻**：尤其 `vlm_prefer`、T1–T3 全开作为默认生产策略 |
| `REQ_CAPTCHA_OCR_ACCURACY.md` | 指标从「识别 precision」升级为「约束下的 session_success」 |
| `DESIGN_CAPTCHA_SOLVER.md` | 现状盘点仍有效；改造以本文为准 |

---

## 8. 实施切片（Phase 2）

用户确认后的切片命名：

| 切片 | 内容 | 状态 |
|------|------|------|
| **S1** | Decision Layer + Confidence Semantics（拆分 raw/agreement/evidence/decision；取消 singleton=1.0 / VLM 定分 0.75；VLM 仅 T1 + abstain_on_conflict；Slider 62%→ABSTAIN） | ✅ 完成 |
| **S2** | Session / Attempt **观测模型**（附加字段；**不改行为**） | ✅ 完成 |
| **S3** | Verify / Feedback（decision 与 verifyResult 可关联；**不改当次 decisionScore**） | ✅ 完成 |
| **S4** | **Feedback-driven Adaptive Retry**（Retry Policy Engine；按失败原因，非按次数；maxAttempts=2） | ✅ 完成 |
| **S5** | **Policy / Profile**（按站点/类型参数化 S1–S4；非新决策规则层） | ✅ 完成 |

**Phase 2 主线：✅ 完成**（S1–S5）  
**Phase 3 Validation：✅ 已执行**（结论：S4 保留；主瓶颈曾 = 过易 ACCEPT）  
**False-ACCEPT Reduction：§16 F1 ✅；§17 F2 ✅；F2-D 实验拒绝默认；继续收紧 Gate ❌ 关闭**  
**下一阶段：E1 Evidence Quality**（§18 · Phase 1 REQ）  
**暂缓：S6 命名 / 扩 VLM 为主线 / 扩 S5 / 继续抬 Decision 阈值**

---

## 9. 验收标准（草案）

| 项 | 标准 |
|----|------|
| 语义 | 响应可区分「识别候选」与「决策」；至少日志/附加字段可见 `decision∈{accept,abstain,retry}` |
| False Accept | demo-strict 下，相对改造前 **false accept 不升**；slider/click 无结构时 **不得** `solved=true` |
| VLM | 默认冲突策略 **`abstain_on_conflict`**；默认触发 **仅 T1**；VLM-only ACCEPT 须过 decision 门闩且无假定分 |
| Session | 同一 `sessionId` 下多次 attempt 可关联（S2）；verify 回写与 RETRY（S3+） |
| 指标 | bench 同时输出 Recognition / Decision / Session 层；优化叙述不得只报 top1 |
| 回归 | `VLM_URL` 空时行为与「VLM 未启用」一致；Worker 旧必填字段仍可用 |
| 延迟 | profile 声明 p95 目标；CPU profile 默认不启用分钟级 VLM ACCEPT 路径 |

---

## 10. 冻结确认（2026-08-15）— Phase 2 基线 / S1

| # | 冻结项 | 选择 | 结论 |
|---|--------|------|------|
| 1 | 主线改为决策层拆分，停止 E4 式补丁主线 | **是** | ✅ 冻结 |
| 2 | VLM 冲突默认 | **`abstain_on_conflict`** | ✅ 冻结 |
| 3 | VLM 触发 | **仅 T1** | ✅ 冻结 |
| 4 | Session 字段 | **先附加字段** | ✅ 冻结 |
| 5 | Slider 62% | **立即 ABSTAIN** | ✅ 冻结 |
| 6 | S1 开工 | **是**（范围 = Decision + Confidence Semantics） | ✅ 冻结 |

```text
Phase 2 基线
├── 1. 决策层拆分              ✅
├── 2. VLM conflict=abstain   ✅
├── 3. VLM trigger=T1 only   ✅
├── 4. Session=附加字段       ✅
├── 5. Slider 62%=ABSTAIN     ✅
└── 6. S1 立即开工            ✅（已完成）
```

---

## 11. S2 Phase 1 需求：Session / Attempt 观测模型（待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（S2 六项确认；Phase 2 实现） |
| 原则 | **可追踪、不改行为**：不改 Worker 主流程、不引入 Retry Engine、不引入 poll/session API |
| 目标一句话 | 让一次验证码生命周期可关联 `session → attempt(s) → candidates → decision`，以便回答「为何失败 / 瓶颈在哪 / VLM 有无价值」 |

### 11.1 目标结构（观测，非状态机驱动）

```text
captcha request
      |
      v
captcha session
      |
      +-- attempt-1
      |      +-- candidates
      |      +-- decision
      |
      +-- attempt-2
             +-- retry reason（仅记录，不自动换策略）
             +-- new evidence
```

> S2 **不实现**全量 Session 状态机驱动执行；`status` 字段仅作**观测标注**（可由 solver 在单次响应中写入当前快照），不触发 Worker 侧状态迁移。

### 11.2 Session 级字段（附加）

```json
{
  "sessionId": "xxx",
  "jobId": "xxx",
  "pageUrl": "xxx",
  "createdAt": "...",
  "captchaKind": "image",
  "status": "solving"
}
```

观测用生命周期枚举（文档约定，非强制状态机）：

```text
CREATED → SOLVING → ANSWER_READY → EXECUTED → VERIFIED | FAILED
```

S2 实现侧预期：solver 单次 `/captcha` 响应至少能带出 `sessionId` + 当前 `status` 快照（多为 `SOLVING` / `ANSWER_READY` / 决策后的等价标注）；`EXECUTED` / `VERIFIED` 依赖 Worker 回写，**S2 不强制**，预留字段即可。

### 11.3 Attempt 级字段（附加）

每一次 solver 决策产生一个 attempt 快照（可嵌在响应 `attempt` 对象，或等价扁平字段）：

```json
{
  "attemptId": "a001",
  "sessionId": "s001",
  "input": {
    "kind": "image",
    "imageHash": "xxx"
  },
  "classifier": {
    "kind": "image",
    "score": 0.93
  },
  "candidates": [
    { "text": "A82K9", "source": "ddddocr", "score": 0.71 },
    { "text": "A82X9", "source": "vlm", "score": 0.66 }
  ],
  "decision": {
    "action": "abstain",
    "reason": "model_conflict"
  }
}
```

约定：

| 字段 | 语义 |
|------|------|
| `sessionId` | 请求传入优先；缺省时 solver 可生成并回传（不要求 Worker 持久化） |
| `attemptId` | 每次 `/captcha` 调用生成；同 session 多次调用可关联 |
| `imageHash` | 截图内容摘要（如 sha256 前缀），便于去重/对照，**不落原图默认** |
| `candidates[].score` | 沿用 S1：为 evidence/model 分，**非校准概率** |
| `decision.action` | 与 S1 `decision` 对齐：`accept` / `abstain` / `retry` |
| `failureReason[]` | 可选数组，仅记录（如 `ocr_conflict` / `kind_uncertain` / `timeout`）；**S2 不消费** |

### 11.4 契约策略（冻结意图）

| 做 | 不做 |
|----|------|
| 在 `/captcha` **响应**中附加 `sessionId` / `attemptId` / `attempt`（或等价） | 不改 Worker：仍 `POST → apply → verify` |
| 请求可透传 `sessionId` / `jobId` / `pageUrl`（已有 `jobId`/`pageUrl` 继续用） | 不新增 `create session` / `poll status` / Worker retry policy |
| 日志与 bench 可读到 attempt 级候选与决策原因 | **不做** Retry Engine / 自动换策略 |
| verify 回写字段可预留 | **不强制** S2 完成 verify 闭环（→ S3） |

Worker 必填字段（`solved` / `text` / `offsetX` / …）**保持不变**；未知附加字段 Worker 忽略。

### 11.5 S2 验收标准（建议）

| 项 | 标准 |
|----|------|
| session 可关联一次验证码生命周期 | ✅ |
| attempt 可记录每次求解 | ✅ |
| candidate 可追踪来源 | ✅ |
| decision reason 可查询 | ✅ |
| verify 结果可回写 | 暂不强制（S3） |
| retry 自动化 | ❌ 不在 S2 |
| Worker / 超时 / webhook 行为相对 S1 | **无故意行为变化** |

完成后应能回答：

1. **为什么失败？**（session + attempt + candidates + decision，而非仅 `captcha failed`）  
2. **85% session success 卡在哪？**（accept vs abstain vs 未来 verify fail 可拆）  
3. **VLM 是否有价值？**（invoked / 救回 / 冲突弃权 / 延迟，可从 attempt 聚合）

### 11.6 冻结确认（2026-08-15）— S2

| # | 项目 | 决策 | 状态 |
|---|------|------|------|
| 1 | S2 定位 | **观测模型 + 附加字段，S1 后零行为变化** | ✅ 冻结 |
| 2 | 状态枚举 | **仅作为 snapshot 标注，不驱动状态机** | ✅ 冻结 |
| 3 | sessionId | **请求透传优先，缺省由 solver 生成并回传** | ✅ 冻结 |
| 4 | 存储 | **响应字段 / 日志 / 可选 JSONL，不引入 DB，不新增 session API** | ✅ 冻结 |
| 5 | verify 回写 | **延期至 S3** | ✅ 冻结 |
| 6 | 开工 | **进入 Phase 2 S2 实现** | ✅ 冻结 |

响应扩展（Worker 忽略未知字段）：

```json
{
  "sessionId": "xxx",
  "attemptId": "xxx",
  "observation": {
    "snapshotStatus": "ANSWER_READY",
    "classifier": { "kind": "image", "score": 0.92 },
    "candidates": [
      { "value": "AB12CD", "source": "ddddocr", "evidenceScore": 0.71 },
      { "value": "AB12XD", "source": "vlm7b", "evidenceScore": 0.63 }
    ],
    "decision": { "action": "abstain", "reason": "model_conflict" }
  },
  "solved": false,
  "reason": "model_conflict"
}
```

字段语义（与 S1 对齐，避免再混淆）：

| 字段 | 含义 |
|------|------|
| `confidence` | decisionScore 镜像，仅表示最终决策强度 |
| `evidenceScore` | 候选证据强度 |
| `agreementScore` | 多来源一致程度 |
| `weightShare` | 投票分布，不代表概率 |
| `decisionReason` | 为什么 ACCEPT / ABSTAIN |
| `sessionId` | 关联一次验证码生命周期 |
| `attemptId` | 一次 solver 尝试 |

S2 **不引入**：`retryCount` / `nextAction` / `policy` / `verifyResult` / `successRate` / `learningLabel`。

---

## 12. S3 Phase 1 需求：Verify Feedback 闭环（待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（S3 六项确认；Phase 2 实现） |
| 原则 | **小步改变**：只建立 `decision ↔ verifyResult` 可关联反馈；不引入自适应重试 / 不反向改写当次 `decisionScore` |
| 目标一句话 | 让 solver 知道「这次 ACCEPT/ABSTAIN 执行后到底怎样」，为 S4 提供真实数据，而不是再堆 heuristic |

### 12.1 闭环结构

```text
Session
  ↓
Attempt
  ↓
Candidate / Decision     ← S1
  ↓
Observation              ← S2（已有 sessionId / attemptId）
  ↓
Worker Execute           ← 保持现有接口
  ↓
Verify                   ← Worker / bench / demo
  ↓
Feedback                 ← S3（回写，只记录）
```

反馈至少能区分：

| 路径 | 反馈语义 |
|------|----------|
| `ACCEPT` → verify OK | `verify_success` |
| `ACCEPT` → verify FAIL | `verify_failed` |
| `ABSTAIN` | `not_executed`（未提交答案） |
| 超时 / 页态不明 | `unknown`（含 `TIMEOUT`） |

### 12.2 硬约束（语义分离）

```text
decision / decisionScore / confidence
        ≠
verifyResult
```

| 允许 | 禁止 |
|------|------|
| 用 `sessionId` + `attemptId` 关联当次决策与后续 verify | **用 verify 结果改写当次** `decisionScore` / `confidence` / `decision` |
| 记录 `verifyLatencyMs` / `verifyReason` / `verifiedAt` | 根据 verify 自动切换 solver / 调阈值 |
| 观测快照 `snapshotStatus` 可标注 `EXECUTED` / `VERIFIED` / `FAILED`（仍只是标注） | 引入 Retry Engine / `nextAction` / 在线学习 |

> 当次 attempt 的 decision 是历史事实；verify 是事后标签。S4 才消费这些标签做策略。

### 12.3 建议契约（附加，兼容现有执行）

**A. 反馈入口（新建，可选调用）**

```text
POST /captcha/feedback
POST /v1/captcha/feedback   （别名）
```

请求示例：

```json
{
  "sessionId": "s_xxx",
  "attemptId": "a_xxx",
  "jobId": "optional",
  "verifyResult": {
    "status": "success | failed | not_executed | unknown",
    "reason": "demo verify message / captcha still visible / timeout / …",
    "latencyMs": 120,
    "verifiedAt": "2026-08-15T06:00:00.000Z",
    "source": "worker | bench | manual"
  }
}
```

响应示例（仅确认落盘/关联，**不返回新的 solved 答案**）：

```json
{
  "ok": true,
  "sessionId": "s_xxx",
  "attemptId": "a_xxx",
  "verifyResult": { "status": "failed", "reason": "…" },
  "linked": true
}
```

**B. Worker / Bench 行为（S3 最小）**

| 调用方 | 建议 |
|--------|------|
| **Bench** | verify 后调用 `/captcha/feedback`（最易先打通闭环） |
| **Worker** | 可选：apply 后若能判定页态，则回写；**不强制**改主流程；失败/超时写 `unknown` |
| **Solver `/captcha`** | 契约不变；ABSTAIN 时可在 observation 中标注「预期 not_executed」，但真正反馈仍以 feedback 为准 |

**C. 存储（延续 S2）**

- 与 S2 同一可选 JSONL（或 `HERMES_CAPTCHA_FEEDBACK_JSONL`），按 `sessionId`+`attemptId` 追加 feedback 行  
- **不要求 DB**；不新增 session 查询/poll API  
- 内存侧可保留短 TTL 的 attempt 索引以便 `linked=true`，丢失则 `linked=false` 但仍接受写入（观测优先）

### 12.4 `verifyResult.status` 枚举冻结（建议）

| status | 含义 |
|--------|------|
| `success` | 执行后验证通过（页态消失 / demo verify OK） |
| `failed` | 执行后验证明确失败 |
| `not_executed` | 未执行提交（典型：decision=abstain，或 Worker 未 apply） |
| `unknown` | 超时、页态不明、中断、无法判定 |

不把 `TIMEOUT` 做成平行顶层枚举：超时归入 `unknown`，`reason` 写 `timeout`（或 `failureReason` 附加）。

### 12.5 S3 明确不做

```text
❌ 自动 retry
❌ retry policy / nextAction
❌ 修改当次 decisionScore / confidence / decision
❌ 根据 verify 自动切换 solver / VLM / 阈值
❌ 学习标签 / 在线调参 / successRate 看板产品化
```

这些属于 **S4 Adaptive Retry**（及以后）。

### 12.6 与 S1/S2 的分层关系

```text
S1  Decision      “我为什么这么决定？”
S2  Observation   “这次请求/尝试是什么？”
S3  Feedback      “这个决定执行后到底成功没有？”
        ↓
S4  Adaptive Retry  （有数据后再做）
```

### 12.7 验收标准（建议）

| 项 | 标准 |
|----|------|
| `sessionId`+`attemptId` 可关联 decision 与 verify | ✅ |
| 能统计 ACCEPT→success / ACCEPT→failed / ABSTAIN→not_executed / unknown | ✅ |
| verify **不**改写当次 decision 字段 | ✅ |
| `/captcha` 求解契约与 S2 行为兼容 | ✅ |
| 自动 retry / 策略切换 | ❌ 不在 S3 |
| Worker 主流程必改 | ❌ 不强制（Bench 闭环优先即可验收） |

完成后应能回答：

1. 某次 ACCEPT 是 **true accept** 还是 **false accept**？  
2. ABSTAIN 是否从未执行（而非执行失败）？  
3. VLM 参与的 attempt，verify 成功/失败分布如何？（为 S4 准备，S3 只记录）

### 12.8 冻结确认（2026-08-15）— S3

| # | 项目 | 决策 | 状态 |
|---|------|------|------|
| 1 | S3 定位 | **Feedback record only，不做 Adaptive Retry** | ✅ 冻结 |
| 2 | verify 对 decision 的影响 | **永不改写当次 `decisionScore` / `confidence`** | ✅ 冻结 |
| 3 | API | **新增 `POST /captcha/feedback`，保持 `/captcha` 不变** | ✅ 冻结 |
| 4 | 接入顺序 | **先 Bench 打通，Worker 回写可选** | ✅ 冻结 |
| 5 | status 枚举 | **`success \| failed \| not_executed \| unknown`** | ✅ 冻结 |
| 6 | 开工 | **进入 Phase 2（S3）** | ✅ 冻结 |

不变量：

```text
decisionScore / confidence  → immutable（attempt 历史）
verifyResult                → separate feedback（事后标签）
```

---

## 13. S4 Phase 1 需求：Feedback-driven Adaptive Retry（待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（S4 六项确认；`maxAttempts=2`；Phase 2 实现） |
| 定位 | **`Feedback-driven Adaptive Retry`**，不是「增加重试次数」 |
| 原则 | 第一版只做 **Retry Policy Engine**；不同时改 OCR / VLM / Worker 执行器 |
| 目标一句话 | 根据 **失败原因**（及 S3 `verifyResult`）决定是否 retry、下一 attempt 用什么 strategy；形成 Attempt N → Feedback → Attempt N+1 闭环 |

### 13.1 闭环位置

```text
S1 Decision → S2 Observation → Execute → S3 Feedback
                                              ↓
                                    S4 Retry Policy
                                              ↓
                                         Attempt N+1
                                    （新 Observation → Decision → …）
```

S4 内部流水线：

```text
Feedback
  ↓
Failure Classification
  ↓
Retry Policy
  ↓
Next Attempt Strategy
  ↓
New Observation → Decision → Execute → Feedback
```

### 13.2 硬原则（建议冻结）

> **Retry 的依据必须是「失败原因」，而不是简单的 attempt 次数。**

禁止退化成：

```text
attempt=1 → OCR
attempt=2 → VLM
attempt=3 → slider
```

应做成：

| 失败分类（示例） | 下一步策略（示例） |
|------------------|-------------------|
| `ocr_conflict` | `alternate_ocr_evidence`（换证据路径 / 预处理侧重，不默默抬 VLM） |
| `kind_uncertain` | `re_detect` |
| `accept_but_verify_failed` | `fresh_capture` + `same_solver`（新截图、新 candidate） |
| `vlm_timeout` / latency unknown | `no_vlm` / `reduced_latency` |
| `slider_unreliable` | **remain ABSTAIN**（不瞎猜 offset） |
| `ACCEPT + success` | **stop**（no_retry） |

### 13.3 第一版范围：Retry Policy Engine only

**输入**（直接消费 S1–S3 已有字段，不新造平行真相）：

```text
sessionId / attemptId
decision / decisionReason / decisionScore
candidates / evidenceScore / agreementScore / weightShare
verifyResult.status / reason / latencyMs
observation.failureReason（若有）
vlmUsed / vlmConflict
```

**输出**（建议附加字段 / 独立 `POST /captcha/retry-plan` 二选一，待冻结）：

```json
{
  "sessionId": "s_xxx",
  "attemptId": "a_xxx",
  "retry": true,
  "nextStrategy": "fresh_capture",
  "reason": "accept_but_verify_failed",
  "failureClass": "accept_but_verify_failed",
  "hints": {
    "vlm": "off",
    "requireFreshScreenshot": true
  }
}
```

| 输出字段 | 含义 |
|----------|------|
| `retry` | `true` / `false` |
| `nextStrategy` | 策略枚举（见下） |
| `reason` / `failureClass` | 为何这样决定（可审计） |
| `hints` | 给下一 attempt / 调用方的约束（如禁 VLM）；**不**直接改历史 decisionScore |

### 13.4 建议策略枚举（v1，可增不可糊）

| `nextStrategy` | 含义 |
|----------------|------|
| `stop` | 不再试 |
| `fresh_capture` | 要求新截图后再求解 |
| `same_solver` | 同引擎再试（常与 fresh_capture 组合） |
| `alternate_preprocess` | 调整预处理 / 证据路径（不堆新 OCR 主线规则） |
| `re_detect` | 重新分类 kind |
| `no_vlm` | 下一 attempt 禁用 VLM |
| `reduced_latency` | 缩短慢路径（禁 VLM / 降超时预算） |
| `remain_abstain` | 明确不再提交（如 slider 不可靠） |

示例映射（Policy 表，实现时表驱动）：

```text
ACCEPT + failed      → retry=true,  strategy=fresh_capture (+ same_solver)
ABSTAIN + not_executed
  · ocr_conflict     → retry=true,  strategy=alternate_preprocess
  · kind_uncertain   → retry=true,  strategy=re_detect
  · slider_unreliable→ retry=false, strategy=remain_abstain
TIMEOUT + unknown    → retry=true,  strategy=no_vlm | reduced_latency
ACCEPT + success     → retry=false, strategy=stop
```

### 13.5 S4 第一版明确不做

```text
❌ 同时改写 OCR / VLM 识别算法主路径
❌ 改 Worker 执行器核心（fill/drag 实现）
❌ 按 attempt 序号硬切 OCR→VLM→slider
❌ 用 verify 回写改写历史 decisionScore（S3 不变量继续有效）
❌ 在线学习 / 自动调参 / 多站点 Policy Profile 产品化（→ S5）
❌ 无限重试：须有 maxAttempts / budget（建议默认小，如 2～3）
```

### 13.6 接入方式（待选，进入冻结）

| 方案 | 说明 | 倾向 |
|------|------|------|
| **A. 纯函数 + Bench 驱动** | `plan_retry(attempt, feedback) → plan`；Bench / 可选 Worker 在 feedback 后调用；`/captcha` 仍无状态机 | **推荐 v1**（与 S2/S3「小步」一致） |
| **B. feedback 响应附带 `retryPlan`** | `POST /captcha/feedback` 响应增加 `retryPlan`；仍不自动发起下一 solve | 可选增强 |
| **C. Solver 内自动连环 solve** | 一次 `/captcha` 内自动多 attempt | **v1 不做**（行为变化面过大） |

Worker：v1 **不强制**改造；Bench 用 `RETRIES` 从「盲目重试」升级为「按 `retryPlan` 重试」即可验收。

### 13.7 与既有不变量的关系

```text
decisionScore / confidence  → 仍 immutable（历史 attempt）
observation                 → 仍 snapshot
verifyResult                → 仍 separate feedback
retryPlan                   → 新层：面向「下一次」，不污染「上一次」
```

### 13.8 验收标准（建议）

| 项 | 标准 |
|----|------|
| 能按 **failure class** 输出不同 `nextStrategy` | ✅ |
| `ACCEPT+success` → `stop`；`ACCEPT+failed` 与 `ABSTAIN+not_executed` **策略不同** | ✅ |
| 不存在「仅按 attempt 序号」的默认阶梯 | ✅ |
| 历史 attempt 的 decisionScore 不被 retry 改写 | ✅ |
| Bench 可展示：按 plan 重试 vs 旧盲目 RETRIES 的对照（可选） | ✅ |
| 自动改 OCR/VLM 权重或 Worker 执行器 | ❌ 不在 S4 v1 |

### 13.9 冻结确认（2026-08-15）— S4

| # | 项 | 决策 | 状态 |
|---|-----|------|------|
| 1 | 定位 | **按失败原因的 Adaptive Retry** | ✅ 冻结 |
| 2 | v1 范围 | **Policy Engine only** | ✅ 冻结 |
| 3 | 策略方式 | **禁止 attempt 阶梯，按 failure class** | ✅ 冻结 |
| 4 | 接入方式 | **方案 A：纯函数 + Bench 驱动，可选 feedback 附带 plan** | ✅ 冻结 |
| 5 | `maxAttempts` | **2** | ✅ 冻结 |
| 6 | 开工 | **进入 Phase 2（S4）** | ✅ 冻结 |

正式定义：

> **S4 = Feedback-driven Adaptive Retry / Policy Engine / maxAttempts=2 / 纯函数 + Bench 驱动。**

不变量延续：历史 `decisionScore` / `confidence` **永不修改**。

---

## 14. S5 Phase 1 需求：Policy / Profile（待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（S5 六项确认；Phase 2 实现） |
| 定位 | **`S5 = Policy/Profile`**：把 S1–S4 已验证的参数 **配置化 / 可切换**，解决「demo-strict 与 DCP-wide 同进程无法同时最优、依赖手工 env 重启」 |
| 原则 | Profile 是 **参数包**，不是新的业务规则引擎；禁止用 profile 偷偷引入 `if site == xxx` 式决策逻辑 |

### 14.1 为什么现在开 S5

S1–S4 已形成受预算约束的可解释闭环。继续横向加 solver 技巧收益递减。当前缺口是：

```text
不同站点 / 验证码类型
        ↓
需要不同的 decision / VLM / retry 参数
        ↓
今天靠进程级 env + 重启
```

S5 目标形态：

```json
{
  "profile": "dcp-wide",
  "decision": {},
  "vlm": {},
  "retry": {}
}
```

请求携带：

```json
{ "profile": "dcp-wide" }
```

同一 solver 进程可服务多 profile，**无需为换参重启**。

### 14.2 Profile 负责什么（v1）

Profile 只绑定 **已存在、已冻结语义** 的旋钮：

```text
profile
  ├─ OCR thresholds      （minConf / softConf / morphWeight / agreeMin / LEN / CHARSET …）
  ├─ VLM policy          （mode / triggers / conflict policy / timeout）
  ├─ decision thresholds （与 S1 门闩一致的可配阈值；不改变分数语义）
  ├─ retry policy        （maxAttempts；可选 failureClass→strategy 表覆盖）
  ├─ unsupported behavior（如 slider 不可靠 → remain_abstain，保持 S4 默认）
  └─ meta                （name / description / captchaKinds 提示）
```

示例（示意，非最终字段名）：

```json
{
  "name": "demo-strict",
  "decision": {
    "minConf": 0.5,
    "softConf": 0.45
  },
  "ocr": {
    "len": 6,
    "charset": "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
    "morphWeight": 0.8,
    "agree": true
  },
  "vlm": {
    "mode": "auto",
    "triggers": ["t1"],
    "policy": "abstain_on_conflict",
    "timeoutMs": 8000
  },
  "retry": {
    "maxAttempts": 2
  }
}
```

```json
{
  "name": "dcp-wide",
  "decision": { "minConf": 0.45, "softConf": 0.40 },
  "ocr": { "len": null, "charset": null },
  "vlm": { "mode": "off" },
  "retry": { "maxAttempts": 2 }
}
```

### 14.3 Profile 不负责什么（v1）

```text
❌ 动态在线学习 / 根据 verify 自动改写 profile
❌ 数据库配置中心 / 远程配置下发产品化
❌ 自动调参 / A-B 在线优化
❌ Worker 大改（Worker 最多透传 profile 名字）
❌ 新的 failure class / 新的 decision 语义（那是改 S1/S4，不是 S5）
❌ 在 profile 里写脚本或自定义函数
❌ 用 profile 绕过 S1–S4 不变量（如把 confidence 改回「假概率」、恢复 slider 62%）
```

### 14.4 覆盖优先级（建议冻结）

从高到低：

```text
1. 单次请求显式字段
   （如 req.retryHints、req 上已有的 kind / 个别覆盖键）
        ↓
2. 请求指定的 profile
   （req.profile / req.policyProfile）
        ↓
3. 进程默认 profile
   （HERMES_CAPTCHA_PROFILE=demo-strict）
        ↓
4. 内置 defaults
   （与当前 S1–S4 冻结默认一致）
        ↓
5. 遗留进程 env
   （HERMES_CAPTCHA_OCR_MIN_CONF 等）
```

**关于 env 的过渡策略（待选）：**

| 方案 | 说明 |
|------|------|
| **A. env 低于 profile** | profile 生效时覆盖同名 env；无 profile 时 env 仍可用（兼容旧部署） |
| **B. env 仅作 bootstrap** | 只用于选择默认 profile 名与 JSON 路径；具体旋钮以 profile 为准 |
| **C. env 最高** | 运维紧急覆盖（易再次「隐性规则」，**不推荐 v1**） |

**推荐 v1：B + 少量紧急 escape**（仅 `HERMES_CAPTCHA_PROFILE` / `HERMES_CAPTCHA_PROFILES_DIR`），具体阈值进 profile 文件。

### 14.5 存储与加载（v1）

| 项 | 建议 |
|----|------|
| 格式 | 本地 JSON（或 YAML）文件，如 `captcha-solver/profiles/*.json` |
| 内置 | 至少 `demo-strict`、`dcp-wide`（或等价命名）与 `default` |
| 热加载 | v1 可启动时加载 + 可选 `mtime` 刷新；**不做**远程推送 |
| 响应可见 | `/captcha` 响应 observation 或顶层附加 `profile` 名（便于 S2 观测） |
| Health | `/health` 列出已加载 profile 名与当前默认 |

### 14.6 与 S1–S4 的边界

```text
S1 Decision     语义与分数含义（不可被 profile 重新定义）
S2 Observation  记录用了哪个 profile
S3 Feedback     不因 profile 改写历史 decisionScore
S4 Retry        maxAttempts / 策略表可由 profile 参数化，failureClass 集合不变
S5 Profile      只选参数，不发明新控制流
```

### 14.7 验收标准（建议）

| 项 | 标准 |
|----|------|
| 同一进程、两次请求分别 `profile=demo-strict` / `dcp-wide`，行为按各自参数，**无需重启** | ✅ |
| 请求未带 profile 时走默认 profile | ✅ |
| 响应/观测可看到所用 `profile` 名 | ✅ |
| 不引入 DB / 在线学习 / 自动改 profile | ✅ |
| S1–S4 不变量仍成立 | ✅ |
| 禁止 `if site==` 散落业务 | ✅（站点差异只进 profile 文件） |

### 14.8 冻结确认（2026-08-15）— S5

| # | 项 | 决策 | 状态 |
|---|-----|------|------|
| 1 | S5 定位 | **Policy/Profile，不新增 Decision 层** | ✅ 冻结 |
| 2 | 参数范围 | **仅参数化已有旋钮** | ✅ 冻结 |
| 3 | 明确不做 | **学习 / DB / 自动调参 / Worker 大改** | ✅ 冻结 |
| 4 | 优先级 | **请求字段 → 请求 profile → 默认 profile → 内置 defaults；env 仅 bootstrap（方案 B）** | ✅ 冻结 |
| 5 | 内置 Profile | **`demo-strict` + `dcp-wide`（+ `default`）** | ✅ 冻结 |
| 6 | 开工 | **进入 Phase 2（S5）** | ✅ 冻结 |

> **S5 = Policy/Profile：只改变参数值，不改变 S1–S4 语义与不变量。**

---

## 15. Phase 3：Validation / Benchmark / Hardening（待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **待确认冻结**（确认前不扩 S6 / 不堆新 solver 规则） |
| 背景 | Phase 2 主线 S1–S5 **已完成**；38 单测证明结构未明显破坏，**不能**证明策略在真实数据上有效 |
| 定位 | **验证 S1–S5 收益**，而不是继续扩功能 |

### 15.1 阶段判定

```text
S1 Decision          ✅
S2 Observation       ✅
S3 Feedback          ✅
S4 Adaptive Retry    ✅
S5 Policy/Profile    ✅

Phase 2 主线         ✅ 完成
Phase 3              → Validation / Benchmark / Hardening
（暂缓 S6）
```

### 15.2 核心判断问题

> S1–S5 是否让 **session success ↑、false accept ↓、retry recovery ↑，且 latency 可控**？

若否：不继续加 Profile / solver 规则；回到 **evidence / decision calibration / failure classification**。

### 15.3 必看指标

```text
first_attempt_success
eventual_session_success
false_accept_rate
abstain_rate
retry_recovery_rate
VLM_recovery_rate
VLM_false_accept_rate
p50 / p95 / p99 latency
```

反馈交叉表（须可按 `profile / captcha kind / strategy` 分组）：

```text
ACCEPT + success
ACCEPT + failed
ABSTAIN + not_executed
RETRY + success
RETRY + failed
TIMEOUT + unknown
```

### 15.4 Phase 3 建议做 / 不做

| 做 | 不做 |
|----|------|
| 固定 profile 对照 bench（至少 `demo-strict`；可选 `dcp-wide`） | 立刻开 S6 新功能切片 |
| `ADAPTIVE_RETRY=0` vs `=1` 对照 | 再堆 OCR/E4 式补丁作为主线 |
| 报告按 feedback 状态与 failureClass 分组 | 在线学习 / 自动改 profile |
| 记录 latency 分位与 VLM 调用成本 | 扩大 VLM 触发面（仍保持 T1） |
| 发现校准问题时回修 S1/S4 分类或阈值（小步） | 用 verify 回写改历史 decisionScore |

### 15.5 建议验收门槛（草案，可改）

相对「S1 前 / 无 adaptive」基线（同 demo、同 rounds）：

| 指标 | 期望方向 |
|------|----------|
| eventual session success | ↑ 或不降 |
| false accept（ACCEPT→failed / ACCEPT） | ↓ 或不升 |
| retry_recovery_rate | 有可解释正贡献，或证明「不该 retry」的类正确 stop |
| p95 latency | 在声明预算内（CPU+VLM 场景单独报告） |

### 15.6 冻结确认（2026-08-15）— Phase 3 Validation

| # | 项 | 决策 | 状态 |
|---|-----|------|------|
| 1 | 暂缓 S6，进入 Validation | **是** | ✅ 冻结 |
| 2 | 主面 | **`demo-strict` + demo** | ✅ 冻结 |
| 3 | 对照组 | **`ADAPTIVE_RETRY=0` vs `1`** | ✅ 冻结 |
| 4 | 报告方式 | **扩展现有 bench，不新建系统** | ✅ 冻结 |
| 5 | VLM | **默认 off；另设单独 VLM 档** | ✅ 冻结 |
| 6 | 开跑 | **执行 benchmark 并出报告** | ✅ 冻结 |

实验矩阵：

```text
A: demo-strict + ADAPTIVE_RETRY=0 + VLM=off   ← baseline
B: demo-strict + ADAPTIVE_RETRY=1 + VLM=off   ← S4 收益
C: demo-strict + ADAPTIVE_RETRY=0 + VLM=on    ← VLM 单独
D: demo-strict + ADAPTIVE_RETRY=1 + VLM=on    ← 组合（不与 A/B 混报）
```

判断优先级：falseAccept ↓ → eventualSuccess ↑ → retryRecovery → latency → VLM 净收益。

### 15.7 Phase 3 执行结论（2026-08-15）

报告：`reports/phase3_validation_summary.md`（A/B N=30；C/D N=5 探索档）。

| 发现 | 含义 |
|------|------|
| A→B eventual 26.7%→36.7%，retryRecovery≈26.9% | **S4 保留**：Feedback-driven Retry 有救回价值 |
| A→B falseAccept 65.2%→71.4% | **主瓶颈已转为「过易 ACCEPT」**，不是「不会重试」 |
| A/B P95 可接受；C/D VLM 无清晰救回且延迟高 | **VLM 暂缓**；不并入主结论 |
| S5 已够用 | **暂不继续扩展 Profile** |

架构信号：

> 系统现在「会恢复」，但恢复的是一个不够可靠的决策系统。

---

## 16. Phase 3 Follow-up：False-ACCEPT Reduction（已冻结）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（2026-08-15）；先实现 **F1 Attribution**，完成后再决定 F2 |
| 定位 | **只做一件事：降低 ACCEPT 的错误率**；建立 False-ACCEPT attribution |
| 不做 | 扩 VLM、扩 S5 Profile、新开 solver、改 S4 主逻辑（S4 保留）；F1 **不改** OCR / Decision Gate / Profile / Worker |

### 16.0 冻结确认（6 项全部通过）

| # | 项 | 决策 |
|---|----|------|
| 1 | 下一阶段 | **False-ACCEPT Reduction**，不进入 S6 / VLM / S5 扩展 |
| 2 | S4 | **保留，不重做 Retry Policy** |
| 3 | 归因 | **采用封闭集 failure / false-accept attribution 类别** |
| 4 | 顺序 | **先 F1 归因，再 F2 改 Decision Gate；禁止未归因先改 OCR** |
| 5 | 验收 | **falseAccept ↓，eventual success 不发生明显回退** |
| 6 | 开工 | **先实现 F1** |

F1 边界（严格）：

```text
Candidate / Evidence → Decision=ACCEPT → Verify=failed → False-ACCEPT Attribution → closed-set reason
```

只回答「**为什么这个 ACCEPT 最终被证明是错的**」。  
必须区分 `false accept` vs `solver failure / abstain / timeout`——不要把所有失败塞进 False-ACCEPT。

F1 产物 = 归因报告（主来源 / 占比 / 哪类最值得进 F2），**不是**新阈值。

### 16.1 目标分层

```text
S4 回答：为什么没成功？ → Retry
本阶段回答：为什么这个错误答案当初被 ACCEPT？ → Decision Calibration
```

```text
Decision Failure（给 S4）
├── abstain
├── timeout
└── unsupported

False Accept Diagnosis（给 Calibration）
├── WEAK_EVIDENCE
├── CORRELATED_VOTES
├── CANDIDATE_AMBIGUITY
├── SINGLETON_ACCEPT
├── WRONG_KIND
├── GEOMETRY_FALSE_POSITIVE
├── MODEL_CONFLICT
├── OTHER
└── UNATTRIBUTABLE
```

### 16.2 归因标签（v1 封闭集）

对每次 **ACCEPT**（对照 success / failed）打标签；**仅** `verify=failed` 计为 falseAccept：

| 标签 | 怀疑机制 |
|------|----------|
| `SINGLETON_ACCEPT` | 单读 / 弱独立证据仍过门 |
| `WEAK_EVIDENCE` | evidence/decisionScore 刚过门槛；含 agreement 不足 |
| `CORRELATED_VOTES` | 多 preprocess 伪共识（同源模型相关变体当独立证据） |
| `CANDIDATE_AMBIGUITY` | 候选值分歧仍 ACCEPT |
| `WRONG_KIND` | 分类错误导致错误引擎 ACCEPT |
| `GEOMETRY_FALSE_POSITIVE` | 几何启发式假阳性（slider/click 残留） |
| `MODEL_CONFLICT` | 多引擎冲突却仍 ACCEPT（门闩漏洞） |
| `OTHER` | 可归因但未落入上列 |
| `UNATTRIBUTABLE` | 证据不足无法归类 |

归因结果须能回到原始 attempt（`sessionId` / `attemptId` / `decision` / `feedback` / `falseAccept`）。

每类统计：`acceptCount` / `acceptFailed` / `falseAcceptRate` / `shareOfFalseAccepts`，找出大头。

### 16.3 优先怀疑（基于现有设计，待 F1 数据证实）

1. **多 variant 伪共识**：raw/up2/trim/gray 同源相关 → evidence 系统性偏高  
2. **ACCEPT gate 偏召回**：应重审 `evidenceScore` / `agreementScore` / `decisionScore` 门闩，而非再改 OCR  
3. **内部冲突未门闩**：variant 间拼写分歧仍多数 ACCEPT；不能只靠 VLM conflict→abstain  
4. **failureClass 需双轨**：执行失败分类 ≠ 错误接受分类  

### 16.4 工作切片

| 切片 | 内容 | 状态 |
|------|------|------|
| F1 | Attribution：对 bench ACCEPT 结果自动打上表标签 + 按类汇总 | **✅ 完成**（见 `reports/f1_false_accept_attribution.md`） |
| F2 | 基于 F1 大头，**仅改 Decision gate / 去相关证据规则**（不堆新 OCR） | **✅ 完成**（见 `reports/f2_decorrelate_bench.md`） |
| F2-D | Singleton micro-tune（实验） | **✅ 完成且拒绝默认**（见 `reports/f2d_singleton_microtune.md`） |
| F3 | 复跑 A/B（VLM=off） | **并入 F2 bench**；后续以 E1 验收矩阵为准 |
| E1 | Evidence Quality（字符级 / margin / 独立源 / 重定义 score） | **Phase 1 REQ**（见 §18） |

### 16.5 冻结点（已确认）

见 §16.0；F1 已完成。F2 冻结见 §17。

---

## 17. F2：Decision Gate / 去相关证据（已冻结 · Phase 1 REQ）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 2 ✅ 完成**（2026-08-15）；Bench 见 `reports/f2_decorrelate_bench.md` |
| 依据 | F1：Phase3-A 中 **13/15**、F1 复跑 **17/17** false ACCEPT → `CORRELATED_VOTES` |
| 定位 | **降低「同一 ddddocr 错误被多 preprocess 重复投票形成伪共识」导致的 false ACCEPT** |
| 不做 | 新 OCR 算法、新 preprocess、改 S4、改 S5、开 VLM、扩识别能力 |

### 17.0 冻结确认

| 项 | 决策 |
|----|------|
| F2 目标 | **降低 `CORRELATED_VOTES` 导致的 false ACCEPT** |
| 第一优先级 | **证据去相关（Evidence de-correlation）** |
| 第二优先级 | **Decision Gate 收紧** |
| OCR | **不新增识别算法 / 不堆新 preprocess** |
| S4 | **保持不变** |
| S5 | **保持不变**（本切片不改 profile 包；门闩参数可在 decision/ocr 路径默认值体现） |
| VLM | **继续暂缓** |
| 验收 | **falseAccept ↓，且 eventualSuccess 不明显恶化**；须同步观察 abstain ↑ |

### 17.1 问题陈述（现状）

当前 `fuse_ocr_votes` 将各 preprocess 读数按字符串聚合后：

```text
votes = |同文 bucket|
weightShare = 同文权重 / 全部读数权重
evidenceScore ≈ weightShare（非 singleton）
→ evidenceScore ≥ threshold ⇒ ACCEPT
```

因此：

```text
dddd/raw, dddd/up2, dddd/trim_up2, dddd/gray → 同一错误文本 A
```

会被计为 **votes≈4、高 weightShare**，形成**伪独立共识**。  
F2 **不是**把「4 votes」机械改成「1 vote」展示字段，而是让决策层识别：

```text
same_model / same_source / same_preprocess_family
```

这些高度相关结果，避免当成多源独立证据。

目标语义：

```text
evidence_group = ddddocr
support = A
independent_sources = 1
```

而不是：

```text
votes = 4  ⇒  强独立证据
```

### 17.2 目标流水线（严格两层）

```text
raw readings
    ↓
Evidence de-correlation     ← F2 第一优先
    ↓
independent evidence groups
    ↓
Decision Gate               ← F2 第二优先
    ↓
ACCEPT / ABSTAIN
```

### 17.3 实现切片顺序（必须可拆分验收）

| 子切片 | 内容 | 目的 |
|--------|------|------|
| **F2-A** | Evidence Grouping：按 `engine/model` + preprocess family 将读数归入 evidence group；组内同文只计 **1 个独立源**（或等价 `independentSources`） | 暴露「去相关」本身的收益 |
| **F2-B** | Correlated-vote penalty / cap：组内多 variant 不得线性抬高 `evidenceScore`；可用 cap / 次线性放大 / `correlatedPenalty` | 限制伪共识强度 |
| **F2-C** | Decision Gate：在去相关后的分数上收紧 ACCEPT（可含：最低 `independentSources`、singleton 更严、弱 agreement 拒收） | 区分「去相关」vs「单纯抬阈值」 |
| **Bench** | 同 Phase3-A 协议（`demo-strict`，VLM=off，adaptive=0，N≥30）对比基线 | 看清收益来源 |
| 第二轮 | 仅当 F2-A/B 后仍需，再微调 Gate | 避免一次改太多无法归因 |

**禁止**：一次改动把 A+B+C 揉成无法拆开的黑盒门槛上调。  
实现时须可分步对照（分 commit 或开关：先 decorrelate，再 gate 收紧）。

### 17.4 语义字段（加法优先）

在现有 `weightShare` / `evidenceScore` / `agreementScore` / `decisionScore` 之上，至少可观察：

| 字段 | 含义 |
|------|------|
| `independentSources` | 支持赢家文本的独立证据组数量（去相关后） |
| `evidenceGroups` | 组摘要（如 `[{engine, family, support, nVariants}]`）— 可放 observation |
| `correlatedVotes` | 组内相关读数计数（诊断；供 F1 对照） |
| `votes` | **可保留**为原始读数票数（兼容）；**不得**再被当成独立源数 |

不变量延续：

- `weightShare` ≠ P(correct)
- `confidence` 仍镜像 `decisionScore`
- 历史 attempt 的 decision 不被 feedback 改写（S3）

### 17.5 验收指标（必须同时看）

对标 Phase3-A 基线（`falseAcceptRate≈65.2%`，`eventualSessionSuccess≈26.7%`，`abstainRate≈23.3%`）：

| 指标 | 期望 |
|------|------|
| `falseAcceptRate` | **↓**（主成功条件） |
| `CORRELATED_VOTES` falseAccept 计数 / share | **↓**（F1 归因复跑验证去相关生效） |
| `SINGLETON_ACCEPT` falseAccept | 不显著恶化（避免把问题挪到单读） |
| `eventualSessionSuccess` | **不明显下降**（相对基线；建议相对降幅 ≤ ~5pp 或同 N 下不崩） |
| `abstainRate` | **必须报告升幅**（风险监控，不是单独成功条件） |
| `firstAttemptSuccess` | 报告；可随 FA↓ 同向或略降 |
| `P95 latency` | 不明显恶化（去相关应为 O(variants) 轻量计算） |

**失败形态（明确拒绝）**：

```text
falseAccept ↓  仅因大量 ACCEPT→ABSTAIN，同时 eventualSuccess 明显崩塌
```

成功形态：

```text
falseAccept ↓
+ eventualSuccess 不明显下降
+ 归因上 CORRELATED_VOTES FA 份额下降
```

### 17.6 非目标 / 禁区

| 禁止 | 原因 |
|------|------|
| 新增 OCR 引擎 / 新 preprocess 变体 | F1 已证明瓶颈在伪共识，不在识别广度 |
| 改 S4 Retry Policy | S4 保留；FA 应在第一次 ACCEPT 前解决 |
| 改 S5 Profile 包结构 / 扩 profile | 本阶段不扩配置面 |
| 打开 / 依赖 VLM | 继续暂缓 |
| 仅调高 `minConf` 而不做 grouping | 无法证明收益来自去相关 |
| 用 verify 回写改历史 decisionScore | S3 不变量 |

### 17.7 Phase 2 开工检查清单

1. F2 目标 = 降 `CORRELATED_VOTES` FA，不是扩识别？  
2. 顺序 = **F2-A → F2-B → F2-C → Bench**？  
3. OCR / S4 / S5 / VLM 边界如上？  
4. 验收 = FA↓ + eventual 不明显恶化，且报告 abstain↑？  

### 17.8 确认记录

| # | 项 | 状态 |
|---|----|------|
| 1 | 进入 F2 = Decision Gate / 去相关证据 | ✅ 用户确认 |
| 2 | 首要对象 = `CORRELATED_VOTES` 伪共识 | ✅ |
| 3 | 优先级 = 去相关 → Gate；OCR/S4/S5/VLM 不动 | ✅ |
| 4 | 实现顺序 F2-A → B → C → Bench | ✅ 建议采纳 |
| 5 | 验收双条件（FA↓ + eventual 不崩） | ✅ |

**Phase 1（REQ）完成。** 回复「进入 Phase 2」或「实现 F2」后按 F2-A → F2-B → F2-C 写代码。

### 17.9 F2-D Singleton Micro-tuning（实验 · 正式拒绝默认）

| 项 | 内容 |
|----|------|
| 动机 | F2 后残留 FA ≈ `SINGLETON_ACCEPT`；abstain 已高 |
| 做法 | 可选 `decision.singletonGate`：单票 amid 分歧 / 弱纯 singleton 需额外证据（**非整禁**） |
| Bench | 见 `reports/f2d_singleton_microtune.md` |
| 判定 | **拒绝默认开启**（FA 12.5%→0%，但 eventual 23.3%→16.7%，abstain 73.3%→83.3%） |
| 关键发现 | 残留 FA 与 2 次正确 ACCEPT **同构**（`votes=1 / nValid=2 / chroma`）→ Gate 无法分离 true/false |

### 17.10 F2 阶段正式冻结（2026-08-15 · 用户确认）

| 项 | 状态 |
|----|------|
| F2-A Evidence Grouping | ✅ |
| F2-B Correlated Vote Cap | ✅ |
| F2-C Decision Gate（correlated） | ✅ |
| F2-D Singleton Experiment | ✅ **rejected as default** |
| `singletonGate` | **冻结为 `false`**（保留 feature flag，不删除） |
| **继续收紧 Decision Gate** | **❌ 正式关闭** |

冻结认知：

```text
问题已不是「Gate 太宽」
而是「Evidence 缺少 true/false ACCEPT 区分能力」

继续调 threshold / confidence / agreement / singleton gate
只能改变 accept/abstain 比例
无法提高 true accept / false accept 分离度
```

默认运行面 = **F2-A/B/C**；下一阶段 = **§18 E1 Evidence Quality**（先 REQ，再实现）。

---

## 18. E1：Evidence Quality Improvement（Phase 1 REQ · 待确认后实现）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 REQ**（确认前不写实现代码） |
| 命名 | **E1**（不用 S6，避免与 S1–S5 主线混淆） |
| 定位 | 提升 evidence 对 **true ACCEPT / false ACCEPT** 的区分能力 |
| 不做 | 继续收紧 Decision Gate；不以 FA=0 为成功；不把 VLM 当默认独立源（暂缓策略不变，除非单独冻结） |

### 18.0 目标流水线

```text
Evidence（质量 / 独立信号）
    ↓
Independent signal quality
    ↓
Decision（沿用 F2；不再加严默认门闩）
```

而不是：

```text
Decision → more strict gate
```

### 18.1 基线与验收（相对 F2，非相对 Phase3-A 裸跑）

F2 默认基线（`reports/f2_decorrelate_bench.md`）：

| 指标 | F2 基线 | E1 目标 |
|------|--------:|---------|
| falseAcceptRate | 12.5% | **≤ 12.5%**（不恶化） |
| eventualSessionSuccess | 23.3% | **≥ 23.3%**（最好提升） |
| abstainRate | 73.3% | **不继续升高**（最好下降） |

叙事目标：

> 用更好的 evidence，把一部分 **当前 ABSTAIN** 样本变成 **正确 ACCEPT**；  
> **禁止**再用「多拒绝」刷低 FA（F2-D 已证伪该路线）。

非目标：`FA=0`（F2-D 已证明可靠 abstain 做到，但 eventual 崩）。

### 18.2 优先级切片

| 切片 | 内容 | 优先级 |
|------|------|--------|
| **E1-A** | **字符级证据** `charEvidence[]`（每字 confidence / alternatives） | **最高** |
| **E1-B** | **候选间距 / margin**（top1–top2 gap；近邻拼写） | 高 |
| **E1-C** | **真正独立来源**（非同模型 preprocess 变体；独立 OCR / 字符分类器） | 中（能力依赖大） |
| **E1-D** | **重定义 evidenceScore / decisionScore** = f(independentSources, charConfidence, candidateMargin, …)；`voteCount` 权重最低 | 在 A/B（及可选 C）有信号后 |

### 18.3 E1-A：字符级证据（最高优先）

现状缺口：只有整串 `text` + 标量 score，无法表达「单字不确定」。

目标结构（加法字段，示例）：

```json
{
  "text": "AB12CD",
  "charEvidence": [
    {"i": 0, "char": "A", "confidence": 0.92, "alternatives": []},
    {"i": 1, "char": "B", "confidence": 0.42, "alternatives": [{"char": "8", "confidence": 0.40}]}
  ],
  "charMinConfidence": 0.42,
  "charMeanConfidence": 0.67
}
```

约束：

- 优先从现有引擎可暴露的信号获取；**若 ddddocr 无法给字级分**，须在实现前记录 capability gap，并选替代（裁剪单字分类 / 第二引擎），不得假装有字级分。
- Decision 默认 **不**仅因 `charMin` 低就再抬全局阈值；E1-A 先 **产出可观测字段 + bench 分层**（true vs false accept 的 charMin 分布），再决定是否进入 E1-D 融合。

### 18.4 E1-B：候选间距 / 边界质量

目标：暴露 top1 / top2 及 gap，例如：

```text
AB12CD  0.72
ABIZCD  0.70   → margin=0.02 → 不应轻易 ACCEPT
```

字段：`candidateMargin`、`runnerUpText`、`runnerUpScore`、`candidateRanking`；以及由 E1-A 派生的 `charMinMargin` / `charRunnerUpText`。

**实现结论（2026-08-15）**：F2-C 全票一致 ACCEPT 后，vote-share runner-up 在 ACCEPT 上几乎总是空（`candidateMargin=1.0`）。  
**有区分力的是 `charMinMargin`**。E1-D 融合时应优先消费字级 margin，而非 preprocess 第二拼写。

### 18.5 E1-C：真正独立来源

明确区分：

| 不是独立源 | 是独立源（方向） |
|------------|------------------|
| 同一 ddddocr 的 raw/up2/gray | 不同模型家族（easyocr / paddle / tesseract / custom） |
| 同模型 beta 若高度相关则弱独立 | 字符级分类器（与整串 OCR 不同归纳偏置） |

沿用 F2 的 `independentSources` 语义；**禁止**再把 preprocess `variantCount` 当独立源。

**实现结论（2026-08-15）**见 `reports/e1c_independent_source.md`：

- RapidOCR 对本 demo 验证码域几乎无效 → 回退 `ddddocr_beta` raw-only（`weak_same_vendor`）。
- Bench：FA independentAgree **0%**，true **55.6%** → 有区分力，但仍有重叠；**不进入 E1-D 改 Gate/score**。
- 下一步：换 captcha-capable 跨家族二级源，或联合 E1-A 信号做对照实验后再谈 E1-D。

### 18.5.1 E1-C.1：A×B×C 联合归因（离线 · 2026-08-15）

见 `reports/e1c1_joint_evidence.md`（脚本 `scripts/e1c1_joint_evidence_report.py`）。

| 发现 | 数值 | 裁决 |
|------|------|------|
| FA 全部落在 `weak\|conflict` | **100%** | 联合格对 FA 有解释力 |
| true 仍落在同格 | **33%** | **禁止**对该格硬 gate |
| 非该格 ACCEPT 的 FAR | **0%**（6/6） | A×C 优于单轴，仍非完美分类器 |
| `strong\|agree` 中的 FA | **0%** | 高可信格干净但覆盖不全 |

冻结：

```text
F2-A/B/C          ✅ 保留
singletonGate     ❌ false
E1-A / E1-B / E1-C ✅ 观测保留
E1-C.1            ✅ 联合归因完成
E1-D Score/Gate   ⏸ 继续暂停
```

E1-D 前置仍未满足：需要更干净的 conflict 语义（跨家族 captcha OCR）或可证明分离度的软加权设计，而不是阈值/gate。

### 18.5.2 E1-C.1 结论确认（2026-08-15 · 用户确认）

认知冻结：

> Evidence 之间存在互补性，但目前还没有单独维度可以安全成为 **hard gate**。  
> `weak|conflict` 是 **risk signal**，不是 `wrong` 标签。

| 组合 | 结论 |
|------|------|
| strong + agree | 高可信，覆盖不足 |
| strong + conflict | 不能直接判错 |
| weak + agree | 不能直接判错 |
| weak + conflict | 高风险，但不是纯错误（本跑 FA 4/4，true 仍 3） |

方向：

```text
risk signal → soft evidence weight
（禁止）risk signal → hard reject
```

当前冻结：

```text
F2-A/B/C              ✅
singletonGate         ❌ false
E1-A / E1-B / E1-C    ✅
E1-C.1                ✅
E1-D                  ⏸
```

### 18.5.3 E1-C.2：Evidence Stability Validation（已冻结 · Phase 2）

| 项 | 内容 |
|----|------|
| 状态 | **已冻结**（2026-08-15 六项确认）；Phase 2 **先执行 C2-A** |
| 定位 | 验证联合证据信号是否 **稳定可复现**，找到可安全进入 soft evidenceScore 的维度 |
| 非目标 | hard gate；改 decisionScore / confidence / ACCEPT|ABSTAIN；改 S4 retry；加 preprocess；扩 VLM；线上 E1-D |

#### 问题陈述

E1-C.1 样本量过小（ACCEPT=13，`weak|conflict` FA=4 / true=3）。无法区分：

| 情况 | 含义 | 对后续动作 |
|------|------|------------|
| **A** | 格内 FAR 高且稳定（如 FA≫true） | soft penalty 有价值 |
| **B** | 格内 FA≈true | 困难区；需更强 evidence（跨家族源），而非加权 |

同时，当前 `independent conflict` 的裁判质量不足（RapidOCR 能力不匹配；beta 为 weak_same_vendor）。

#### 工作包（建议顺序）

| 包 | 名称 | 内容 | 产出 |
|----|------|------|------|
| **C2-A** | 扩大联合证据统计 | 在现有 F2 + E1 观测下重跑 bench，目标 **N≥100**，且 `weak\|conflict` 子集尽量 **≥30 ACCEPT** | 更新 A×B×C 矩阵 + 情况 A/B 判定；报告 `reports/e1c2_stability.md` |
| **C2-B** | E1-CrossSource 选型探针 | 评估 **captcha-specialized + 可出字符候选 + 跨模型家族** 的二级源；**禁止** scene-text / 普通 OCR 空读污染 | capability 矩阵 + 是否可接入观测（仍不改 Decision） |
| **C2-C** | 离线 soft score simulation | **仅离线**：`newScore = oldScore ± bonuses/penalties`；算 ROC / FAR / coverage；**零线上行为变化** | `reports/e1c2_soft_score_sim.md`；决定是否值得开 E1-D |

建议执行顺序：

```text
1. C2-A 扩大 weak|conflict 样本
     ↓
2. C2-B 验证跨家族 OCR（并行可启动选型，接入在 A 有基线后）
     ↓
3. C2-C 离线 soft evidenceScore simulation
     ↓
4. 再决定是否进入 E1-D
```

#### C2-A 验收问题（必须回答）

1. `weak|conflict` 在大样本下的 **格内 FAR**、占 FA / 占 true 份额是否接近 E1-C.1？  
2. 非该格 ACCEPT 的 FAR 是否仍接近 0？  
3. `weak|conflict|loose` vs `|tight` 是否出现可复现偏置？（仍只作观测）  
4. 若出现情况 A（高 FAR 稳定）→ 允许进入 C2-C；若情况 B → 优先 C2-B，暂缓软加权。

#### C2-B 二级源准入（硬条件）

候选必须同时满足：

```text
同一 captcha domain 可用
+ 能输出字符候选（或至少稳定整串且非空）
+ 与 ddddocr 具有模型差异（cross-family）
```

明确拒绝：RapidOCR 式空读、仅 scene-text、无候选的「永远 conflict」源。

验证问题：

> conflict 是否主要来自 ddddocr 自身不确定，而不是验证码本身不可识别。

#### C2-C 约束

- 只在已有 bench JSON / 重跑结果上 **事后重算**；不改 `decision.py` 默认路径。  
- 禁止把 simulation 最优阈值直接固化为 hard gate。  
- 成功标准：**分离度↑**（true/FA score 分布可分），且若模拟 apply 阈值，**eventual 不塌、abstain 不失控**（相对 F2 基线叙事）。

#### 禁区（继承 + 强化）

| 禁止 | 原因 |
|------|------|
| `weak\|conflict → ABSTAIN` 硬规则 | E1-C.1 + F2-D 同类失败 |
| 调 decision threshold / 开 singletonGate | 刷 FA 路线已关闭 |
| 增加 preprocess 冒充独立源 | F2 已否定 |
| 扩 VLM / 改 retry | 本阶段无关 |
| 未证明稳定就上线 soft score | 重复「调权重→误杀→回滚」 |

#### 冻结确认（E1-C.2 · 2026-08-15）

| # | 项 | 决策 |
|---|----|------|
| 1 | E1-C.1 结论 + E1-D ⏸ | ✅ |
| 2 | 下一阶段 = E1-C.2（C2-A→B→C） | ✅ |
| 3 | C2-A：N≥100，且 `weak\|conflict` 尽量 ≥30 | ✅ |
| 4 | C2-B：captcha + 字符候选 + cross-family；拒 scene-text 空读 | ✅ |
| 5 | C2-C soft score 仅离线 | ✅ |
| 6 | Phase 2 先 C2-A | ✅ |

#### C2-A 实现结论（2026-08-15）

见 `reports/e1c2_stability.md`（合并 N=250；`weak|conflict` N=31）。

| 项 | 结果 |
|----|------|
| 格内 FAR | **54.8%**（17 FA / 14 true） |
| trueShareInCell | **45.2%** |
| FAR Wilson 95% | [0.38, 0.71]（不支持 A） |
| 占 FA / 占 true | 70.8% / 34.1%（与 E1-C.1 方向一致） |
| **裁决** | **情况 B** → 困难区；优先 **C2-B**，暂缓以该格为主的 soft penalty |

用户确认（2026-08-15）：情况 B 成立；`weak|conflict` = hard region ≠ wrong region；不进入 hard gate / 主因子 soft penalty / threshold 调整。

```text
C2-A  ✅
C2-B  ✅（见下）
C2-C  ▶
E1-D  ⏸
```

#### C2-B 实现结论（2026-08-15）

见 `reports/e1c2_cross_source.md`。

| 项 | 结果 |
|----|------|
| 选型 | **ppllocr**（YOLOv11/ONNX）；拒 RapidOCR 空读；默认不再回退 ddddocr_beta |
| available 语义 | empty / 长度不可比 → **非** independentConflict |
| agree | FA **0** / true 有命中；本跑 agree→true **4/4**（强正证据，覆盖偏低） |
| 同长 conflict | 仍混 true（secondary_wrong 常见）→ **不可 hard gate** |
| weak\|conflict | 未系统性转为 weak\|agree；情况 B 未推翻 |
| Decision | **零变化** |

下一步：**C2-C 离线 soft simulation**（优先 agree bonus，避免 conflict 重罚）。

#### C2-C 实现结论（2026-08-15）

见 `reports/e1c2_soft_score_sim.md`（合并 C2-B 两跑 N=140，ACCEPT=35；脚本 `scripts/e1c2_soft_score_sim.py`）。

| 检查 | 结果 |
|------|------|
| Sim A（+agree bonus）分离 gap | baseline −0.013 → **+0.011** ✅ |
| agree 在 FA 中 | **0%** ✅ |
| top-50% precision | **持平**（排序收益有限） |
| FA↓ ∧ abstain↓ 工作点 | **不存在**（abstain 无文本，只能降 ACCEPT） |
| conflict / weak\|conflict 主惩罚 | ❌ 禁止 |
| **E1-D 入口** | **有条件放开**：仅 **optional independentAgree soft bonus**；非 hard accept；非 conflict gate |

```text
C2-A ✅ · C2-B ✅ · C2-C ✅
E1-D Agree Bonus ✅（窄范围已落地）· Decision Calibration ⏸
```

用户确认开工（2026-08-15）：仅 independentAgree soft bonus。

### 18.6 E1-D：independentAgree Soft Bonus（窄范围 · 已实现）

| 项 | 内容 |
|----|------|
| 定位 | 校准已有 `evidenceScore` 的排序/分离；**不是**重设计 Decision / 抬 threshold |
| 模块 | `solvers/evidence_adjust.py`；decide 前在 `fuse_ocr_votes(..., img=)` 接入 |
| 开关 | `decision.independentAgreeBonus` / `HERMES_CAPTCHA_AGREE_BONUS`；幅度 `decision.agreeBonus`（默认 0.1） |
| demo-strict | **on**（对照）；全局默认 **off** |
| 报告 | `reports/e1d_agree_bonus_sim.md` |

冻结边界：

```text
✅ independentAgree → +bonus → evidenceScore（同 threshold）
❌ conflict penalty
❌ weak|conflict penalty
❌ charRisk 主惩罚
❌ 改 threshold / hard gate / hard accept on agree
❌ 现在进入 Decision Calibration（用抬阈值刷 FA/abstain）
```

字段：`evidenceScoreRaw` / `evidenceScoreAdjusted` / `evidenceAdjustment`。

完整 score 融合公式（independentSources、charMargin…）**延期**，直至 agree coverage 与 Candidate 层改进后再议。

用户确认（2026-08-15）：E1-D 窄范围落地正确；**暂不进入 Decision Calibration**。

### 18.6.1 E1-D.1：Agree Bonus Stability Validation（✅ 情况 B）

| 项 | 内容 |
|----|------|
| 定位 | 验证 agreeBonus 在更大样本上是否 **稳定** 提供排序收益 |
| 主跑 | N=120 label=`E1-D1-agree-stability`；报告 `reports/e1d1_stability.md` |
| 方法 | 只比较 raw vs adjusted；不改 threshold / bonus 幅度 / retry / VLM |

主跑结果（ACCEPT=26）：

| 指标 | raw | adjusted |
|------|----:|---------:|
| gap | 0.022 | **0.037** |
| AUC | 0.553 | 0.565 |
| PR-AUC | 0.669 | 0.672 |
| top50 precision | 0.462 | **0.538** |
| agree coverage | — | **7.7%**（2/26） |
| FA∩agree | — | **0** |

合并 C2-B 池（ACCEPT=61）：coverage **13.1%**，FA∩agree=0，gap/AUC 小幅↑，仍 **情况 B**。

**裁决：情况 B** — 保持 optional evidence boost；**不进入 Decision Calibration**。

用户确认（2026-08-15）：E1-D.1 情况 B 成立；`independentAgree` = 高质量正向 evidence，**不是**足够覆盖的 decision driver；Decision Calibration 继续 ⏸。

```text
E1-D Agree Bonus         ✅
E1-D.1 Stability         ✅ 情况 B
Decision Calibration     ⏸
下一阶段                 ▶ E2 Evidence Coverage Expansion（先 REQ）
```

继续冻结：不调 bonus 值 · 不加 conflict/weak\|conflict 惩罚 · 不改 threshold · 不扩 VLM · 不改 retry。

### 18.7 工作顺序（更新）

```text
E1（Evidence Quality）整段              ✅ 收口于 E1-D.1 情况 B
  → E2 Evidence Coverage Expansion      ▶ REQ（§19）
  → （覆盖达标后再议）Decision Calibration ⏸
```

禁止：把 E1-D / E2 做成「又一个阈值 / hard gate」。

### 18.8 非目标 / 禁区

| 禁止 | 原因 |
|------|------|
| 继续收紧默认 Decision Gate | F2-D 已关闭该路线 |
| 以 FA=0 为 KPI | 与 eventual/abstain 冲突 |
| 新 preprocess 变体冒充独立源 | F2 已否定 |
| 未确认能力就伪造 charEvidence | 污染归因 |
| `weak\|conflict` hard reject | E1-C.1 已证伪 |
| 改名 S6 做大而全重构 | 范围失控 |

### 18.9 待确认冻结点

（E1 主线早期冻结点已关闭；当前见 **§18.5.3 E1-C.2 待确认冻结点**。）

### 18.10 确认记录

| # | 项 | 状态 |
|---|----|------|
| 1 | F2-D 结论确认；继续收紧 Gate ❌ | ✅ 用户确认 |
| 2 | `singletonGate=false` + 保留 flag | ✅ |
| 3 | 下一阶段 = E1 Evidence Quality | ✅ |
| 4 | 先 REQ 再实现 | ✅ |
| 5 | E1-A…D 优先级与验收（对标 F2） | ✅ 用户确认（2026-08-15） |
| 6 | E1 Phase 2 先做 **E1-A 观测 only** | ✅ 完成（见 `reports/e1a_char_evidence.md`） |
| 7 | E1-B candidate margin 观测 | ✅ 完成（见 `reports/e1b_candidate_margin.md`）；F2 后 vote margin 退化，**有效信号在 charMinMargin** |
| 8 | E1-C Independent Source 观测 | ✅ 完成（见 `reports/e1c_independent_source.md`）；FA agree 0% / true 56%；**暂缓 E1-D** |
| 8b | E1-C.1 A×B×C 联合归因 | ✅ 完成（见 `reports/e1c1_joint_evidence.md`）；FA 100% ∈ `weak\|conflict`，true 仍 33% → **继续 ⏸ E1-D** |
| 8c | E1-C.1 结论确认；risk≠wrong；下一阶段 E1-C.2 | ✅ 用户确认（2026-08-15） |
| 8d | E1-C.2 六项冻结；Phase 2 先 C2-A | ✅ 用户确认（2026-08-15） |
| 8e | C2-A 扩样本完成 | ✅ N=250，情况 B；用户确认 hard region ≠ wrong |
| 8f | C2-B 跨家族 OCR | ✅ ppllocr；agree=强正证据；见 `reports/e1c2_cross_source.md` |
| 8g | C2-C 离线 soft sim | ✅ agree soft factor 有效；见 `reports/e1c2_soft_score_sim.md` |
| 9 | E1-D Agree Bonus（窄） | ✅ 用户确认落地；Decision Calibration ⏸ |
| 9b | E1-D.1 Stability Validation | ✅ **情况 B**；用户确认（2026-08-15）；Decision Calibration ⏸ |
| 10 | Decision Calibration | **paused**（覆盖不足；改走 E2） |
| 11 | 下一阶段 = E2 Evidence Coverage Expansion | ✅ 用户确认；六项冻结（2026-08-15） |
| 12 | E2-A Captcha Type Detector | ✅ demo 齐次；用户确认 type≠分流；见 `reports/e2a_captcha_type.md` |
| 13 | E2-B 目标重冻（有效覆盖，非 type routing） | ✅ 用户确认；先 B2 再 B1 |
| 14 | E2-B2 Comparable 分类 | ✅ `secondaryComparison`；见 `reports/e2b2_comparable.md`；下一包 **E2-B1** |
| 15 | E2-B2 结论确认；进入 E2-B1 Phase 1（目标收紧） | ✅ 用户确认（2026-08-15）；见 §19.11 |
| 16 | E2-B1 六项冻结 + reason codes；Phase 2 | ✅ 用户确认（2026-08-15）；见 §19.12 |
| 17 | E2-B1 结论确认；MISSING 降级；下一阶段 = Evidence Engine v0.1（E2-C ⏸） | ✅ 用户确认方向（2026-08-15）；见 §19.13 / §20 |
| 18 | Evidence Engine §20.7 五项冻结；Phase 2 EE-1 | ✅ 用户确认（2026-08-15）；EE-1 见 §20.8 |
| 19 | EE-1 确认；进入 EE-2 Evidence Bundle | ✅ 用户确认（2026-08-15）；见 §20.9 |
| 20 | EE-2 确认；进入 EE-3 Captcha Adapter | ✅ 用户确认（2026-08-15）；见 §20.10 |
| 21 | EE-3 确认；进入 EE-4 Compatibility Layer | ✅ 用户确认（2026-08-15）；见 §20.11 |
| 22 | EE-4 确认；进入 EE-5 Evidence Regression Bench | ✅ 用户确认（2026-08-15）；见 §20.12 |
| 23 | EE-5 确认；EE-6 重定义为 Generic Ingestion API（非内置 SRE） | ✅ 方向确认；**主线暂停**（改攻识别准确度，见 §22） |
| 24 | 暂停 EE-6；进入验证码识别准确度 Phase 1 | ✅ 用户确认；A0 见 `reports/a0_abstain_attribution.md` |
| 25 | A0 五项确认；Phase 2 观测实现 | ✅ 用户确认（2026-08-15）；见 `reports/a0_abstain_attribution.md` |
| 26 | A1 确认判断；离线 correlatedMinAgree 仿真 | ✅ 情况 B/C；**勿单放宽**；见 `reports/a1_correlated_gate_sim.md`；下一包 **A2** |

### 18.11 E1-A 实现状态（Phase 2）

| 项 | 内容 |
|----|------|
| 模块 | `solvers/char_evidence.py` + `ocr._attach_character_evidence` |
| 行为 | **只写 observation / candidate.characterEvidence**；不改 decisionScore / confidence / accept\|abstain |
| 来源 | ddddocr `classification(..., probability=True)` 按位 charset 分布 |
| 开关 | `ocr.charEvidence` / `HERMES_CAPTCHA_CHAR_EVIDENCE`（默认 on） |
| 验收焦点 | false ACCEPT 是否可由弱字级证据解释（bench `charEvidenceAnalysis`） | **✅**：本跑 FA 2/2 弱字级；FA charMin 均值 0.30 vs true 0.54 |

---

## 19. E2：Evidence Coverage Expansion（Phase 1 REQ · 待冻结）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 REQ**；确认前 **不写实现代码** |
| 触发 | E1-D.1 情况 B：`independentAgree` 安全但覆盖 ~8–13%，不能驱动 Decision |
| 定位 | **扩大可靠 evidence 覆盖率**，不是调分 / 改 Decision |
| 非目标 | Decision Calibration；调 threshold；conflict/weak\|conflict 惩罚；抬 agreeBonus；扩 VLM；改 retry；preprocess 伪独立源 |

### 19.1 一句话目标

> 不改变已有决策逻辑，增加可靠 evidence 覆盖率，让更多当前 abstain / uncertain 样本具备可判断信息。

不是：

```text
score tuning → 更多 ACCEPT
```

而是：

```text
evidence acquisition → 更多样本有可比对的独立证据 / 可观测候选
```

### 19.2 冻结认知（Evidence 层终态 · E1 收口）

| 信号 | 定位 | 用途 | 禁止 |
|------|------|------|------|
| `independentAgree` | 高质量正向、低覆盖 | optional soft boost / 排序 | hard accept、降阈值、rewrite Decision |
| `weak\|conflict` | hard region | 风险画像 | 主惩罚、reject 条件 |
| `independentConflict` | mixed | 观测 | 直接降权、gate |
| `singletonGate` | experiment only | flag 保留 | 默认 `false` |
| Character / Margin | 风险信号 | 观测 | hard gate |

```text
Character / Margin     → 风险信号，不能 hard gate
independentAgree       → 正向 soft boost，不能当 decision driver
```

### 19.3 问题陈述

当前瓶颈：

```text
independentAgree：准，但少（≈13% ACCEPT）
abstain：无文本 → 任何 calibration 只能优化 ACCEPT 池
ppllocr：常 length_mismatch → 不可比，浪费二次源
```

因此 E2 要回答：

> 如何让更多样本获得 **可靠、可比** 的 independent evidence（及 abstain 上的候选信息）？

### 19.4 工作包（建议优先级）

| 包 | 名称 | 内容 | 产出 |
|----|------|------|------|
| **E2-A** | Captcha type Detector | ✅ 完成；demo 齐次，**排除 type 分流** | `captchaType` 观测 |
| **E2-B** | Secondary **effective coverage** | 重冻：非 type routing；B1 hint + B2 comparable + B3 暂缓 | 见 §19.9 |
| **E2-C** | Abstain Candidate Generation | pending（依赖可靠候选，稍后） | abstain 可观测候选 |

建议顺序（更新）：

```text
E2-A ✅（排除 type 分流）
  → E2-B1/B2（uncertainty hint + comparable 归因）
  → E2-B3?（更多源，gated）
  → E2-C Abstain candidates
  → （agree coverage 达讨论门槛后再议）Decision Calibration
```

### 19.5 验收指标（E2，相对 E1-D.1 基线）

| 指标 | 目标方向 |
|------|----------|
| `independentAgree` coverage（ACCEPT 内） | 显著高于 ~13%（具体门槛待冻结，建议先盯 ≥25% 再谈 Calibration） |
| FA∩agree | 保持 ≈0 |
| comparable rate（非 length_mismatch / unavailable） | ↑ |
| abstain 带 candidate 文本比例 | E2-C 后从 ~0 提升（观测） |
| Decision 行为 | **默认路径零变化**（除非单独冻结的开关实验） |

### 19.6 禁区（继承 + 强化）

| 禁止 | 原因 |
|------|------|
| Decision Calibration / 改 threshold | E1-D.1 情况 B |
| 增大 agreeBonus 刷分 | 覆盖问题不是幅度问题 |
| conflict / weak\|conflict 主惩罚 | hard/mixed region |
| 所有请求无脑跑多 OCR | 成本 + 空读污染；需 uncertainty hint（E2-B1），**非** type skip |
| 按 captchaType skip secondary | E2-A 已证伪（demo） |
| preprocess 变体冒充独立源 | F2 已否定 |
| 扩 VLM / 改 retry 当 E2 主手段 | 偏离 coverage 目标 |

### 19.7 冻结确认（E2 · 2026-08-15）

| # | 项 | 决策 |
|---|----|------|
| 1 | 情况 B + Decision Calibration ⏸ | ✅ |
| 2 | 下一阶段 = E2 Evidence Coverage Expansion | ✅ |
| 3 | 顺序 E2-A → E2-B → E2-C | ✅ |
| 4 | E2 默认不改 Decision / threshold / gate / retry | ✅ |
| 5 | Calibration 讨论门槛 agree coverage ≥25%（非自动开启） | ✅ |
| 6 | 先做 E2-A Captcha Type Detector | ✅ |

### 19.8 E2-A 实现状态（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 模块 | `solvers/captcha_type.py`；`dispatch` 附加字段 |
| 类型 | `text_simple` \| `text_distorted` \| `slider` \| `click` \| `unsupported` |
| 行为 | **只写** `captchaType` observation（含 `routingHint.recommendSecondary`）；`applied=false` |
| 开关 | `ocr.captchaTypeDetect` / `HERMES_CAPTCHA_TYPE_DETECT`（默认 on） |
| 报告 | `reports/e2a_captcha_type.md`（N=40 demo-strict） |

Bench 结论（demo-strict）：

| 发现 | 值 |
|------|-----|
| type 分布 | **100% `text_distorted`**（齐次） |
| recommendSecondary | 40/40 true（hint only，未 applied） |
| Decision | **未改** |
| 裁决 | `weak_or_homogeneous` → demo 上 type 不足以分流；字段仍保留供多域 / E2-B |

**E2-B 目标重冻（用户确认 2026-08-15）**：type ≠ routing discriminator；不再投入「按 type skip secondary」。  
E2-B 改为：**提高 secondary evidence 有效覆盖率**（可比 + agree 机会），不是 type 分流。

```text
E2-A Captcha Type   ✅（齐次；排除 type 分流）
E2-B Coverage       ▶ B2 ✅ → B1 next → B3 ⏸
E2-C Abstain        pending
Decision Calibration ⏸
```

### 19.9 E2-B：Secondary Coverage（Phase 1 已冻结）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 已冻结**（2026-08-15）；默认不改线上 secondary 执行路径 |
| 目标 | 提高 **comparable rate** 与 **independentAgree coverage**；保持 FA∩agree≈0 |
| 非目标 | Decision / threshold / gate / retry；conflict/weak\|conflict 惩罚；堆更多 OCR vote；按 captchaType skip secondary |

#### 问题重述

```text
ddddocr + ppllocr
        ↓
length_mismatch / unavailable / incomparable
        ↓
independentAgree coverage 仅 8~13%
```

最大损失是 **不可比**，不是 conflict。

#### 子包顺序（已冻结 · 实现优先 B2）

| 包 | 名称 | 内容 | 产出 |
|----|------|------|------|
| **E2-B2** | Comparable evidence analysis（**先做**） | 拆分 incomparable：`length_mismatch` / `empty` / `unsupported_chars` / `low_confidence`；统一 `secondaryComparison`；禁止把不可比算 conflict | ✅ `reports/e2b2_comparable.md` |
| **E2-B1** | Primary uncertainty → secondary routing **hint** | **只记录「为何需要 secondary」**；不强制调用；信号仅限已验证 evidence（char / candidate / evidence 缺口）；见 §19.11 | observation + hint×B2 关联报告 |
| **E2-B3** | Secondary ensemble | **暂缓**；须先证明更多独立源 ⇒ coverage↑ 且 agree precision 不降，否则重入 correlated vote | 仅当 B1/B2 证伪「单源可修」后再开 |

```text
E2-B2 comparable taxonomy + analysis  ✅
  → E2-B1 routing hint (obs)          ▶ Phase 1 REQ §19.11
  → E2-B3 more sources? (gated)       ⏸
```

#### E2-B1 路由依据（摘要 · 详见 §19.11）

> 记录建议，不改变执行。禁止「primary 不好 → 强制 secondary」。

允许信号：`charMin` / `charMinMargin`、候选不稳定（已有 runner）、`independentAgree=false`（=缺少增强，≠失败）。  
禁止信号：`captchaType`、attempt/retry、`decisionScore`。

契约（目标形态）：

```json
{
  "routingHint": {
    "recommendSecondary": true,
    "priority": "medium",
    "applied": false,
    "reasons": [
      {"code": "LOW_CHAR_MARGIN", "value": 0.12}
    ]
  }
}
```

#### E2-B2 不可比分类（必须）

```json
{
  "secondaryComparison": {
    "comparable": false,
    "reason": "length_mismatch"
  }
}
```

`reason ∈ { length_mismatch, empty, unsupported_chars, low_confidence, source_unavailable, … }`  
**不可比 ≠ independentConflict**（继承 C2-B）。

#### 验收指标（相对 E1-D.1 / E2-A 基线）

| 指标 | 方向 |
|------|------|
| comparable rate（ACCEPT） | ↑（主 KPI） |
| independentAgree coverage | ↑（观察能否逼近讨论门槛 25%） |
| FA∩agree | 保持 ≈0 |
| 无效 secondary 调用（若 hint 被模拟） | ↓ |
| Decision 行为 | **零变化** |

不把 FA=0 当主目标。

#### 禁区

| 禁止 | 原因 |
|------|------|
| 按 captchaType skip secondary 当主策略 | E2-A 已证伪（demo 齐次） |
| 立刻上 ocr3/ocr4 ensemble | F2：more votes ≠ more evidence |
| 改 Decision / threshold / retry / VLM | E2 冻结 |
| 把 length_mismatch 记为 conflict | 污染 agree/conflict 语义 |

#### 待确认冻结点（E2-B）

~~（已确认）~~

#### E2-B 冻结确认（2026-08-15）

| # | 项 | 决策 |
|---|----|------|
| 1 | type 不作为 skip secondary 主策略 | ✅ |
| 2 | E2-B = 提高有效覆盖（comparable + agree） | ✅ |
| 3 | 顺序 B1 → B2 → B3；B3 暂缓 | ✅ |
| 4 | Phase 2 默认只观测/hint，不改实际 secondary 调用 | ✅ |
| 5 | **先 B2 comparable 分类，再 B1 routing hint** | ✅ |

### 19.10 E2-B2 实现状态（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 模块 | `solvers/independent_source.py`：`build_secondary_comparison` + 统一 reason |
| 字段 | `secondaryComparison{status,reason,primary,secondary}`；`comparisonStatus` / `comparisonReason` |
| status | `agree` \| `conflict` \| `incomparable` |
| incomparable reasons | `length_mismatch` / `empty` / `no_candidate` / `unsupported_chars` / `low_confidence` / … |
| 行为 | **观测 only**；不改 secondary 调用 / Decision |
| 报告 | `reports/e2b2_comparable.md` |
| 验收（N=40 ACCEPT=12） | comparableRate=0.25；conflict=0（length_mismatch→incomparable）；agreeCoverage=0.25；FA∩agree=0 |

```text
E2-B2 Comparable   ✅ 结论冻结（见 §19.11 前记）
E2-B1 Routing Hint ▶ Phase 1 REQ §19.11
E2-B3 Ensemble     ⏸
E2-C Abstain       pending
```

### 19.11 E2-B1：Secondary Routing Hint（Phase 1 已冻结）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 已冻结**（2026-08-15）；Phase 2 见 §19.12 |
| 前置 | E2-B2 ✅；B2 结论见下「前记」 |
| 定位 | 记录「为何需要 secondary evidence」的 **建议**；**不改变** secondary 调用 / Decision / Retry / OCR 集合 |
| 非目标 | 强制调 secondary；加规则堆栈；按 type/score/attempt 分流；自动 routing 落地 |

#### 前记：E2-B2 结论冻结

已证明 conflict 桶曾被不可比污染；现拆为：

```text
secondaryComparison → agree | conflict | incomparable
```

| 指标 | E2-B2（N=40 ACCEPT=12） | 解释 |
|------|-------------------------|------|
| comparable | 25% | 偏低 |
| agree | 25% | 小样本有效；FA∩agree=0 |
| conflict | 0 | 此前假 conflict 已拆出 |

> 瓶颈不是 Decision，而是 **secondary evidence 产生条件不足**（大量 length_mismatch → incomparable）。

#### 一句话目标

> 在已有 evidence 上标注「是否建议补 secondary」，只写 observation；用 hint 覆盖/精度及其与 B2 comparable·agree 的关联做验收，**不**用 success / FAR 当主 KPI。

#### 禁止做成的形状

```text
primary 不好 → 强制调用 secondary → 困难样本全堆 OCR → 噪声↑
```

B1 **只做**：

```text
Evidence Assessment → routingHint（建议）→ applied=false
```

#### 输出契约

```json
{
  "routingHint": {
    "recommendSecondary": true,
    "priority": "high|medium|low",
    "applied": false,
    "reasons": [
      {"code": "LOW_CHAR_CONFIDENCE", "value": 0.21},
      {"code": "LOW_CHAR_MARGIN", "value": 0.12},
      {"code": "CANDIDATE_UNCERTAIN", "value": 0.05},
      {"code": "MISSING_INDEPENDENT_AGREE", "value": null}
    ]
  }
}
```

| 字段 | 约定 |
|------|------|
| `recommendSecondary` | bool；是否建议补 secondary |
| `priority` | `high` / `medium` / `low`；由 reasons 强度合成，**不**驱动执行 |
| `applied` | **恒 false**（本包） |
| `reasons[]` | 结构化原因；可多条；带已有观测 value |

与 E2-A：`captcha_type.routingHint` 为 type 占位；B1 以 **evidence 版** `routingHint` 为权威 observation（可保留 type 字段在 `captchaType` 下，但 **不得**用 type 决定 `recommendSecondary`）。

#### 允许的 Hint 来源（仅已验证信号）

| # | 来源 | code 示例 | 说明 |
|---|------|-----------|------|
| 1 | 字符风险（E1） | `LOW_CHAR_CONFIDENCE` / `LOW_CHAR_MARGIN` | 用 `charMin` / `charMinMargin`；阈值来自既有分布，Phase 2 写死可观测阈值即可 |
| 2 | 候选不稳定（E1-B） | `CANDIDATE_UNCERTAIN` | 已有 top vs runner（如文本近、margin 紧）；**不**引入新 vote |
| 3 | Evidence 缺口（E1-C/B2） | `MISSING_INDEPENDENT_AGREE` | `independentAgree=false` 只表示 **缺少增强证据**，≠ 失败 / ≠ 应惩罚 |

#### 明确冻结、不得进入 B1 的因素

| 禁止 | 原因 |
|------|------|
| `captchaType` | E2-A：demo 100% `text_distorted`，无分流价值 |
| attempt / retry 序号 | S4 职责；B1 不按时序堆 secondary |
| `decisionScore` / threshold 邻近 | 与 Decision 耦合；污染观测目标 |
| 强制 / 跳过实际 secondary 调用 | 本包 `applied=false` |
| 新增 OCR 模型 / ensemble | E2-B3 冻结 |
| 改 Decision / Retry / VLM / agreeBonus | E2 全局冻结 |

#### 验收指标（观测 only）

**不看**（主 KPI）：`success` / `falseAccept`（行为未变，无意义）。

| # | 指标 | 含义 |
|---|------|------|
| 1 | **hint 覆盖（FA）** | FA 中 `recommendSecondary=true` 比例；是否抓住困难 ACCEPT |
| 2 | **hint precision** | `recommendSecondary=true` 中「真困难」比例（困难定义：弱 char / 紧 margin / incomparable / 事后 FA 或 wrong；Phase 2 报告写清操作定义） |
| 3 | **与 B2 关联** | hint=true 子集上 `secondaryComparison` 的 comparable / agree 分布；期望叙事是「hint 对准需要增强的样本」，**不**要求本包立刻抬高全局 comparable（调用路径未变） |

对照分析可做：hint=true vs false 的 comparableRate / agreeRate（仍为事后描述，非优化目标）。

#### Phase 2 实现边界（确认后才开工）

| 做 | 不做 |
|----|------|
| 新模块（如 `solvers/routing_hint.py`）合成 evidence hint | 改 `read_secondary` 调用条件 |
| 接线 observation / bench 聚合 | 改 decide / threshold / retry |
| 报告 `reports/e2b1_routing_hint.md` | 自动 routing / applied=true |
| 单测：信号→reasons / applied 恒 false | 按 type 或 score 写 recommend |

#### B1 完成后才讨论（本包不决定）

- 是否值得 **自动** routing（`applied` 可 true）
- 是否进入 **E2-C** Abstain Evidence
- 是否抽象 Evidence Engine

#### 待确认冻结点（E2-B1）

| # | 项 | 建议决策 |
|---|----|----------|
| 1 | B1 = 只生成 hint，`applied=false` | ✅ |
| 2 | 不改 secondary 调用 / Decision / Retry / OCR 集合 | ✅ |
| 3 | 信号仅限 char / candidate / missing agree | ✅ |
| 4 | 禁用 type / attempt / decisionScore | ✅ |
| 5 | 主验收 = hint 覆盖·精度·与 B2 关联；非 success/FAR | ✅ |
| 6 | 确认后进入 Phase 2 实现 | ✅ 用户确认（2026-08-15） |

#### reason code 冻结（Phase 2）

| code | 来源 | 语义 |
|------|------|------|
| `LOW_CHAR_CONFIDENCE` | `charMin` | 字符弱 |
| `LOW_CHAR_MARGIN` | `charMinMargin` | 位级不稳定 |
| `CANDIDATE_UNSTABLE` | tight / runner / char runner | 候选不稳定（不引入新 vote） |
| `MISSING_INDEPENDENT_EVIDENCE` | `independentAgree=false` | **缺少增强证据**（≠答案错误） |

禁止：`LOW_DECISION_SCORE` 及任何 decisionScore / type / attempt 驱动的 reason。

### 19.12 E2-B1 实现状态（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 模块 | `solvers/routing_hint.py` + `session.attach_observation` |
| 字段 | 顶层 / observation.`routingHint`；`applied` 恒 false |
| 行为 | **观测 only**；不改 secondary 调用 / Decision / Retry / OCR |
| 报告 | `reports/e2b1_routing_hint.md` |
| KPI（N=40 ACCEPT=18） | FA hintCoverage=**1.0**；hintPrecisionHard=**1.0**；applied=0；hint=true comparableRate=0.39 / agreeRate=0.06 |
| 裁决 | 观测 ✅；`MISSING_*` alone ≈ 非 agree ACCEPT 全 hint → **自动 routing 仍 ⏸**；区分看 high/medium |

```text
E2-B2 Comparable   ✅
E2-B1 Routing Hint ✅
E2-B3 Ensemble     ⏸
E2-C Abstain       ⏸（让位于 Evidence Engine）
Evidence Engine    ▶ §20
```

### 19.13 E2-B1 结论冻结（用户确认 · 2026-08-15）

> **E2-B1 验证了「是否值得获取更多证据」方向成立，但也证明了不能简单把所有「缺少证据」都当作 routing 信号。**

| KPI | 结果 | 判断 |
|-----|------|------|
| FA hint coverage | 9/9 = 100% | ✅ 能捕获风险 |
| hint precision | 18/18 = 100% | ✅ 高风险样本有效（定义含 incomparable） |
| applied | 0 | ✅ 未改行为 |
| comparable / agree（hint=true） | 0.39 / 0.06 | 中等 / 偏低 — 本包未改调用，不要求抬升 |

#### 架构分界

```text
类型 A：真正 evidence gap
  char 弱 / margin 紧 / candidate 不稳
  → 值得获取 secondary

类型 B：其实已够，只是没有第二来源
  char 全高，仅 independentAgree=false
  → 不是高优先 routing
```

`MISSING_INDEPENDENT_EVIDENCE` 语义正确（缺增强 ≠ 错误），但 **信息量不足**，覆盖过宽。

#### 冻结：保留 / 降级 / 暂停

| 动作 | 项 | 约定 |
|------|----|------|
| **保留（真 gap）** | `LOW_CHAR_CONFIDENCE` / `LOW_CHAR_MARGIN` / `CANDIDATE_UNSTABLE` | 可驱动 `recommendSecondary`；priority **high/medium** |
| **降级** | `MISSING_INDEPENDENT_EVIDENCE` | 不得作高优先；改为 `OPTIONAL_EVIDENCE` 或仅 observation；priority 最高 **low**；单独出现时 **不**视为强 routing |
| **暂停** | Routing 自动执行（`applied=true`） | ⏸ |
| **暂停** | Decision Calibration / OCR Ensemble / 立刻上 E2-C | ⏸ |

#### 路线调整

```text
原：E2-B2 → E2-B1 → E2-C
新：E2-B2 ✅ → E2-B1 ✅ → Evidence Engine v0.1 ▶ → E2-C 作为第一个 Adapter
```

原因：已解耦「识别结果」与「支持识别的证据」；继续堆 E2-C 会把抽象继续绑死在 captcha solver。E2-C 仍有价值，但是 **Engine 上的第一个适配器**，不是下一块主线。

#### 待确认（进入 §20 Phase 2 前）

| # | 项 | 建议 |
|---|----|------|
| 1 | 接受 §19.13 结论冻结 | ✅ |
| 2 | `MISSING_*` → `OPTIONAL_EVIDENCE` / low-only（可在 Engine 前做小补丁） | ✅ |
| 3 | 下一阶段 = Evidence Engine v0.1（非 E2-C） | ✅ |
| 4 | 自动 routing / Calibration / Ensemble 保持 ⏸ | ✅ |

---

## 20. Evidence Engine v0.1（Phase 1 已冻结 · Phase 2 进行中）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 已冻结**（§20.7 ✅）；Phase 2 按 EE-1→EE-4 推进 |
| 触发 | E2-B1 架构分界：Candidate / Evidence / Comparison / RoutingHint / Decision 已在 captcha 路径成形 |
| 定位 | **抽接口与契约**，不是大重构；OCR 只是第一个域适配 |
| 非目标 | 重写 captcha-solver；上 E2-C 全量；自动 routing；调 Decision；堆 OCR；SRE/Agent 生产落地 |
| 目录 | `evidence-engine/`（**不**放在 `captcha-solver/` 内） |

### 20.1 一句话目标

> 把已验证的「候选 + 证据 + 比较 + 缺口提示 + 决策」沉淀为可复用 Evidence Engine 契约；captcha 作为 Adapter #0 对照映射，不绑死实现。

### 20.2 已成形流水线（从 captcha 抽象）

```text
Image / Signal
      ↓
   Candidate          （值 + source）
      ↓
   Evidence[]         （char_confidence / margin / …）
      ↓
   Comparison         （agree | conflict | incomparable）  ← E2-B2
      ↓
   EvidenceGap / RoutingHint  （真 gap vs optional）     ← E2-B1
      ↓
   Decision           （accept | abstain | …）           ← 现有；本包不改语义
```

### 20.3 v0.1 范围（只抽接口）

落地目录（Python；**不**放在 `captcha-solver/`）：

```text
evidence-engine/
├── core/
│   ├── candidate.py
│   ├── evidence.py
│   ├── comparison.py
│   ├── gap.py
│   └── explain.py
├── adapters/
│   └── captcha/          # EE-3+
└── tests/
```

| 构件 | captcha 已有对照 | v0.1 产出 |
|------|------------------|-----------|
| Candidate | `text` + `engine`/`ddddocr` | 统一 JSON/类型 |
| Evidence | `charMin` / `charMinMargin` / vote margin | `type` + `score` + 可选 payload |
| Comparison | `secondaryComparison` | 复用 status/reason（+ `unknown`） |
| Gap / Routing | `routingHint` reasons | **真 gap** vs `OPTIONAL_EVIDENCE` |
| Explain | `decision` / scores observation | 只读；**不改**阈值 |

### 20.4 明确不做（v0.1）

| 禁止 | 原因 |
|------|------|
| 大搬家 / 重写 `fuse_ocr_votes` | 风险高；本包要契约稳定 |
| 自动 `applied=true` | B1 已证 MISSING 过宽 |
| 实现 SRE/Agent 生产路径 | 仅保留扩展叙事 |
| 先做 E2-C 全量 abstain 候选 | E2-C = Adapter 后置 |
| 用 Engine 调 threshold / agreeBonus | Decision Calibration 仍 ⏸ |

### 20.5 Phase 2 拆包顺序（已冻结）

```text
EE-1  Core Model          ✅
EE-2  Evidence Bundle     ✅
EE-3  Captcha Adapter     ✅
EE-4  Compatibility Layer ✅
EE-5  Regression Bench    ✅
EE-6  Generic Ingestion   ▶ §21
EE-7  Evidence Evaluation
EE-8  Domain Adapter SDK
```

**不要先改 captcha-solver**（直至 EE-4 显式兼容层）。

1. Core 类型与 Gap 规则（§19.13）
2. EvidenceBundle 聚合
3. captcha Adapter 映射（observation → Bundle）
4. 兼容层（可选投影；行为零变化）
5. 对照 bench（信息保持，不看 success/FAR）

### 20.6 验收（v0.1）

| 指标 | 含义 |
|------|------|
| 契约完整性 | 五段均可由现有 captcha observation 填充 |
| 行为零变化 | Decision / secondary 调用 / FAR 叙事不因映射改变 |
| Gap 纯度 | 真 gap ⊆ {LOW_CHAR_*, CANDIDATE_UNSTABLE}；OPTIONAL 不抬 priority |
| 可扩展叙述 | 文档给出 SRE/Agent 各一示例映射（不实现） |
| **不看** | falseAccept / success / latency（行为不变） |

### 20.7 冻结确认（Evidence Engine v0.1 · 2026-08-15）

| # | 项 | 决策 |
|---|----|------|
| 1 | 下一主线 = Evidence Engine v0.1，E2-C ⏸ 后置为 Adapter | ✅ |
| 2 | v0.1 = 接口/契约 + captcha 映射，不大重构 | ✅ |
| 3 | Gap：真 gap = char/candidate；MISSING→OPTIONAL / low-only | ✅ |
| 4 | 自动 routing / Calibration / Ensemble 保持 ⏸ | ✅ |
| 5 | 进入 Phase 2（EE-1→EE-4） | ✅ |

### 20.8 EE-1 Core Model（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 路径 | `evidence-engine/core/{candidate,evidence,comparison,gap,explain}.py` |
| Comparison status | `agree` \| `conflict` \| `incomparable` \| `unknown` |
| Gap | 真 gap = `LOW_CHAR_*` / `CANDIDATE_UNSTABLE`；`MISSING_*` → `OPTIONAL_EVIDENCE`（severity 钳制 low） |
| Explain | 只读 decision 观测；无打分逻辑 |
| 行为 | **未改** captcha-solver |
| 测试 | `evidence-engine/tests/test_core_models.py` |

```text
EE-1 Core     ✅
EE-2 Bundle   ✅ 见 §20.9
EE-3 Adapter  ✅ 见 §20.10
EE-4 Compat   ✅ 见 §20.11
```

### 20.9 EE-2 Evidence Bundle（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 路径 | `evidence-engine/core/bundle.py` → `EvidenceBundle` / `BundleSummary` |
| 字段 | `candidateSet` / `evidences` / `comparisons` / `gaps` / `summary` / 可选 `explain` |
| 增量 API | `add_candidate` / `add_evidence` / `add_comparison` / `add_gap` |
| 禁区 | **无** `accept` / Decision 打分 / 权重融合 / 学习 |
| summary | `evidenceQuality` / `supportCount` / `riskCount` / `primaryGap` / `gapHint`（applied=false） |
| 序列化 | `to_dict` / `to_json_dict` / `from_dict`（JSON/JSONL 友好） |
| 行为 | **未改** captcha-solver |
| 测试 | `evidence-engine/tests/test_bundle.py` |

```text
EE-1 Core     ✅
EE-2 Bundle   ✅
EE-3 Adapter  ✅ 见 §20.10
EE-4 Compat   ✅ 见 §20.11
```

### 20.10 EE-3 Captcha Adapter（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 路径 | `evidence-engine/adapters/captcha/{mapper,candidate_mapper,evidence_mapper,comparison_mapper,gap_mapper}.py` |
| API | **仅** `build_bundle` / `build_bundle_dict`（无 `solve`） |
| 旁路 | `captcha-solver/solvers/evidence_bundle_obs.py` → `observation.evidenceBundle` |
| Gap | `MISSING_*` → `OPTIONAL_EVIDENCE`；真 gap 保持 strong 叙事 |
| 行为 | Decision / retry / secondary 调用 **不变**；旧字段保留 |
| 开关 | `ocr.evidenceBundle` / `HERMES_CAPTCHA_EVIDENCE_BUNDLE`（默认 on） |
| 测试 | `evidence-engine/tests/test_captcha_adapter.py` + `captcha-solver/tests/test_evidence_bundle_obs.py` |

```text
EE-1 Core     ✅
EE-2 Bundle   ✅
EE-3 Adapter  ✅
EE-4 Compat   ✅ 见 §20.11
EE-5 Bench    ▶ next
EE-6 SRE Adapter（建议） pending
```

### 20.11 EE-4 Compatibility Layer（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 路径 | `evidence-engine/compat/{schema,legacy,explanation}.py` |
| Schema | `observation.schemaVersion=1.0` + `evidenceSchemaVersion=1.0` |
| 正向 | legacy captcha fields → `EvidenceBundle`（经 EE-3 adapter） |
| 反向 | `bundle_to_legacy_mirrors`（**不覆盖** text/solved/decision） |
| Explain | `observation.explanation[]`：support / risk / gap / comparison / info |
| 接线 | `evidence_bundle_obs.attach_evidence_bundle` 合并旁路字段 |
| 禁区 | 不改 `/captcha` 契约、不迁 Decision、不改 Worker、不改 retry |
| 验收 | contract diff=0；ABSTAIN 亦有 bundle；见 `tests/test_compat.py` |

```text
EE-1 … EE-4   ✅
EE-5 Regression Bench ✅ 见 §20.12
EE-6 SRE Adapter      ▶ 建议下一步
```

### 20.12 EE-5 Evidence Regression Bench（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 路径 | `evidence-engine/bench/{dataset,runner,evaluator,diff,report}.py` |
| Dataset | `evidence-engine/datasets/captcha-demo-v1/`（结果快照 + evidenceExpectation） |
| 五维 | Contract / Completeness / Quality / Explanation / Decision Isolation |
| Diff | `decisionDiff` vs `evidenceDiff` + changes[] |
| 报告 | `evidence-engine/reports/ee5_*`（markdown + json）；**report-only** |
| 禁区 | 不调权 / 不训练 / 不阻断 deploy |
| 首跑 | cases=5；contract=PASS；completeness=80%；explanation=100%；decisionIsolation=PASS；degradation=0 |

```text
EE-1…EE-5     ✅
EE-6 Generic Ingestion API  ▶ §21 Phase 1
EE-7 Evidence Evaluation
EE-8 Domain Adapter SDK
EE-9 Agent Integration
```

---

## 21. EE-6 Generic Evidence Ingestion API（Phase 1 REQ · 待确认）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 REQ**；确认前 **不写实现代码** |
| 前置 | EE-1…EE-5 ✅；CAPTCHA 已证明「不确定识别」可证据化 |
| 定位 | **证据编排层（Evidence Orchestration）**：接收任意领域的 Candidate / Observation，组织 Evidence / Comparison / Gap / Explanation |
| 非定位 | 内置 CPU / Mongo / CAPTCHA / 网络规则平台；诊断结论机；Agent 执行器 |
| 关系 | 现有 `adapters/captcha` = **第一个领域 Adapter 样例**（证明用）；领域逻辑应逐步外置（EE-8 SDK） |

### 21.0 方向纠偏（相对旧 §21 SRE 稿）

~~EE-6 = SRE / NodeCPUHigh Adapter~~ → **作废作为主线**。

NodeCPU / Memory / Network / Bug / Security **仅作举例**，不得写入 Engine 核心。

错误演进：

```text
Evidence Engine
  + CPU规则 + Mongo规则 + CAPTCHA规则 + …
  → 另一个 AIOps 规则平台
```

正确演进：

```text
        任意领域 Adapter（外置）
                  ↓
         Evidence Ingestion API
                  ↓
            Evidence Engine Core
    （不知道 DB / 网络 / 验证码是什么）
```

### 21.1 一句话目标

> 给 Engine 一组通用信息（case / query / candidates / observations），由它负责组织证据、发现关系、解释缺口——**不**负责领域语义与最终裁决。

### 21.2 输入契约（Ingestion Contract）

```json
{
  "caseId": "xxx",
  "query": { "question": "为什么服务不可用?" },
  "candidates": [
    { "id": "c1", "value": "database_connection_failure", "source": "caller", "sourceFamily": "hypothesis" },
    { "id": "c2", "value": "network_latency", "source": "caller", "sourceFamily": "hypothesis" }
  ],
  "observations": [
    { "id": "o1", "source": "log", "content": "connection timeout", "timestamp": "…" },
    { "id": "o2", "source": "metric", "name": "connection_error_rate", "value": 0.8 }
  ],
  "metadata": {}
}
```

建议类型名：`EvidenceInput`（`case_id` / `candidates` / `observations` / `query?` / `metadata?`）。

Engine **不知道**也不推断：数据库 / 网络 / 验证码 / CVE 的领域含义。

### 21.3 内部流水线（保持领域无关）

```text
Observation
    ↓
Evidence Extractor（通用：把 observation 规范成 Evidence 项）
    ↓
Evidence
    ↓
Comparison（同源/多源 agree|conflict|incomparable|unknown）
    ↓
Gap（覆盖缺口 / 独立性缺口；缺证据 ≠ 错误）
    ↓
Explanation + Bundle summary
```

可选输出：**Evidence Quality Model**（非最终 confidence）：

```json
{
  "quality": {
    "coverage": 0.8,
    "independence": 0.6,
    "consistency": 0.7
  }
}
```

禁止把 `quality` 写成 `root_cause_confidence` / `accept`。

### 21.4 场景举例（仅叙事，非内置规则）

| 场景 | 输入摘要 | Engine 只看到 |
|------|----------|----------------|
| 验证码 | OCR candidate + secondary | Candidate / Evidence / Comparison |
| 代码 Bug | NPE candidate + stack + diff | 同上 |
| 安全告警 | credential_leak + log + scanner | 同上 |
| SRE CPU |（由**外部** adapter 先译成 Input） | 同上 |

CAPTCHA 已走通的路径继续有效：领域 Adapter 把领域数据 → `EvidenceInput` 或直接填 Bundle；**Engine 不新增 captcha/SRE if 分支**。

### 21.5 Phase 2 建议落地（确认后）

| 模块 | 职责 |
|------|------|
| `evidence-engine/ingestion/input.py` | `EvidenceInput` / Observation 模型 |
| `evidence-engine/ingestion/builder.py` | `build_bundle_from_input(input) → EvidenceBundle` |
| `evidence-engine/ingestion/extractor.py` | Observation → Evidence（通用启发式：有 value/score/content） |
| `evidence-engine/ingestion/quality.py` | coverage / independence / consistency（可解释、可关） |
| 测试 | 用 **抽象** fixtures（非 NodeCPU 专用）；可选 1 条 captcha 形 Input 对照 |

**不**新增 `adapters/observability/` 作为 Engine 内置领域包（SRE 示例若需要，放 docs 或外部 repo / 后续 EE-8）。

现有 `adapters/captcha`：本包 **不搬迁**；文档标明「过渡样例，目标外置」。

### 21.6 明确不做（冻结）

| 禁止 | 原因 |
|------|------|
| Engine 内写 CPU / Mem / Network / Mongo 规则 | 退化成规则平台 |
| 自动修复 / Agent / 告警系统 | EE-9 / 产品层 |
| Diagnosis Policy（归因话术策略） | EE-7 |
| Domain Adapter SDK 完整外置 | EE-8 |
| 用 ingestion 改 captcha Decision | Isolation 已冻结 |
| 诊断准确率 / 修复成功率 KPI | 本包看契约与编排完整性 |

### 21.7 验收（Phase 2）

| # | 指标 | 含义 |
|---|------|------|
| 1 | Contract | 任意合法 `EvidenceInput` → 完整 `EvidenceBundle` + explanation |
| 2 | Domain-agnostic | 同 builder 处理 ≥2 类抽象场景 fixture（如「两源同意」「缺一源」），无领域 if |
| 3 | Gap ≠ wrong | 缺 observation 产生 Gap/incomplete，不产生假 conflict |
| 4 | Quality ≠ Decision | quality 三维可输出且无 accept/root_cause 字段 |
| 5 | Captcha 不回归 | 现有 captcha adapter / EE-5 bench 仍可通过 |

### 21.8 调整后路线

```text
EE-1 Core Model              ✅
EE-2 Bundle                  ✅
EE-3 Captcha Adapter         ✅（样例 Adapter #0）
EE-4 Compatibility           ✅
EE-5 Regression Bench        ✅
EE-6 Generic Ingestion API   ▶ 本文
EE-7 Evidence Evaluation     （质量/一致性评估加深）
EE-8 Domain Adapter SDK      （captcha/SRE/code 外置模板）
EE-9 Agent Integration       （执行层）
```

### 21.9 待确认冻结点（EE-6）

| # | 项 | 建议决策 |
|---|----|----------|
| 1 | EE-6 = Generic Ingestion API，**不是**内置 SRE Adapter | ✅ |
| 2 | Engine 无领域规则；CPU/Mem/Net 仅文档举例 | ✅ |
| 3 | 输入 = `EvidenceInput{candidates, observations, …}` | ✅ |
| 4 | 输出 = Bundle + Explanation + 可选 quality 三维 | ✅ |
| 5 | captcha adapter 暂留作样例，目标 EE-8 外置 | ✅ |
| 6 | 确认后进入 Phase 2 实现 | ⏸ **主线暂停**（用户改攻识别准确度 §22） |

---

## 22. 验证码识别准确度恢复（Phase 1 REQ · 待确认）

| 项 | 内容 |
|----|------|
| 状态 | **Phase 1 REQ**；确认前 **不写实现代码** |
| 触发 | 用户：暂停 EE-6；日志大量 `decision=abstain` / `reason=ocr low confidence`；体验为「识别不准」 |
| 前置 | F2/E1/E2 证据链已落地；`demo-strict` + `correlatedMinAgree=1.0` |
| 定位 | 提高 **有效求解率**（正确 ACCEPT），同时守住 **FAR≈0**（填错仍比不填更糟） |
| 非目标 | 继续 EE-6；抬 threshold 赌命中；开 VLM 当主线；堆 OCR ensemble（E2-B3 仍冻）；破坏 Decision Isolation |

### 22.1 日志现象（2026-08-15 smoke + 手工）

```text
solved=True  text=r7cwdq|5ge5qc  conf≈0.5556  decision=accept   ← 刚过 minConf=0.5
solved=False text=               conf=0.0     decision=abstain  reason=ocr low confidence
```

冒烟 N=5：`firstAttemptSuccess=0.40`，`FAR=0`，`abstainRate=0.60`。

### 22.2 问题重述（先分清两类失败）

用户感知「不准」在日志上主要是：

| 类型 | 表现 | 本阶段含义 |
|------|------|------------|
| **A. Decision 弃权** | fuse 无命中 → `ocr low confidence` / abstain | **当前主损失**；OCR 可能有字但未过 F2/阈值 |
| **B. 识别错误** | ACCEPT 后 verify 失败（wrong） | 本跑 smoke **0**；仍须防抬召回时 FAR↑ |

禁止一上来「把 minConf 降到 0.3」——那会把 A 直接变成 B。

### 22.3 已冻结约束（不可破坏）

```text
填错 > 不填（更糟）
F2 decorrelate + correlatedMinAgree=1.0（默认真值）
independentAgree 软加成可保留；MISSING≠强 routing
Decision Calibration / 自动 routing / OCR ensemble 仍 ⏸
```

### 22.4 根因假设（Phase 2 先验证再改）

| # | 假设 | 依据 |
|---|------|------|
| H1 | 多预处理投票难达成 **unanimous**（F2）→ evidenceScore 上不去 / fuse 返回 None | accept 样本 `votes=1`、conf 刚过 0.5 |
| H2 | softConf 路径未救起足够样本 | soft=0.45 仅略低于 min=0.5 |
| H3 | secondary 大量 `length_mismatch` → 无 agreeBonus，召回无增强 | E2-B2 comparable 偏低 |
| H4 | 真 OCR 空读 / 乱码被 charset·len 门掉 | 需在 abstain 上保留「门前候选」观测 |

### 22.5 建议切片顺序（小步）

| 包 | 名称 | 内容 | 产出 |
|----|------|------|------|
| **A0** | Abstain Attribution | 对 abstain 分类：`no_reading` / `len_mismatch` / `charset_strip` / `below_threshold` / `correlated_disagree` | 分布报告；确认 H1–H4 |
| **A1** | Vote / Preprocess Recall | 在 **不降 FAR 目标** 下，观测「若放宽 correlatedMinAgree 或增加稳定预处理」的离线仿真 | 仿真表；默认仍不改线上除非确认 |
| **A2** | Secondary Comparable | 针对 length_mismatch：规范化对齐（不引入 ocr3） | comparable↑、agree 机会↑ |
| **A3** | Narrow Gate Tune | **仅当 A0 证明主损失在 threshold 带** 才讨论 soft/min 微调；须带 FAR 护栏 | 小步 profile 实验 |

```text
A0 归因 ▶ → A1/A2 提有效证据 → A3 才碰阈值
```

### 22.6 验收 KPI（相对当前 demo-strict 基线）

| 指标 | 方向 | 护栏 |
|------|------|------|
| firstAttemptSuccess / eventualSessionSuccess | ↑ | — |
| abstainRate（在成功↑ 前提下） | ↓ | — |
| falseAcceptRate | **不恶化**（目标保持 ≈0 或显著不升） | **硬护栏** |
| 日志 `ocr low confidence` 占比 | ↓（被归因拆开后） | — |

不把「abstain→0」当目标。

### 22.7 禁区

| 禁止 | 原因 |
|------|------|
| 先降 minConf 冲成功率 | 易 FAR↑ |
| 立刻开 VLM / 多 OCR ensemble | 主线已证伪/成本高 |
| 关掉 F2 decorrelate 换召回 | 回到 correlated 假共识 |
| 继续 EE-6 并行大改 | 用户要求先准识别 |
| 无 A0 归因就改 Decision | 优化错误目标 |

### 22.8 待确认冻结点

| # | 项 | 建议决策 |
|---|----|----------|
| 1 | EE-6 / Evidence Engine 主线 **暂停** | ✅ |
| 2 | 本期目标 = 有效求解↑ + FAR 护栏 | ✅ |
| 3 | 主损失先按 **abstain/low-confidence** 归因，不先当「OCR 模型不够」 | ✅ |
| 4 | 顺序 **A0 → A1/A2 → A3**；默认不先改阈值 | ✅ |
| 5 | 确认后 Phase 2 先做 **A0 Abstain Attribution**（观测 only） | ✅ 用户确认（2026-08-15） |

### 22.9 A0 实现状态（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 模块 | `solvers/abstain_attr.py`；fuse 弃权时 thread-local probe；`solve_image` 合并 |
| 字段 | `abstainReasonDetail{primary,secondary,vote,gate,bucket,…}` / `abstainCandidateText` / `abstainBucket` |
| 行为 | **观测 only**；fuse 仍 `return None` → soft/template 路径不变 |
| 报告 | `reports/a0_abstain_attribution.md` |
| 首跑 N=40 abstain=30 | SINGLE_SOURCE **40%** · CORRELATED_GATE **30%** · NO_READING **23%**；candidate 残留率 **70%**；FAR=0 |

**裁决**：情况 1 → **A1** ✅ 已跑；仿真结论 **勿单独放宽 correlatedMinAgree** → 下一包 **A2**。

### 22.10 A1 实现状态（Phase 2 · ✅）

| 项 | 内容 |
|----|------|
| 脚本 | `scripts/a1_correlated_gate_sim.py` |
| 矩阵 | baseline 1.0 / 0.9 / 0.85 / 0.8 / 0.75 + joint(agr≥0.8∧ev≥0.55) |
| 行为 | **仅离线仿真**；线上 `correlatedMinAgree` 未改 |
| 报告 | `reports/a1_correlated_gate_sim.md` |
| 首跑 N=40 | baseline FAR=0.40；C_0.8 恢复 precision=0；D_0.75 恢复 precision=0.2 且 FAR↑ |
| 裁决 | **情况 B/C** — 禁止单放宽 minAgree；下一步 **A2 Secondary Comparable** |
