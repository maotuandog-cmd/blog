# Phase 1 需求：C5 Confusion-Aware Decision（风险拦截 + 二次确认）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-18 |
| 状态 | **§12.7 已确认 · Phase 2 进行中（C5-R″-O）** |
| 触发 | C4@0.35/0.75：FP=31 不变；54.3% FP 来自 HIGH_CONF（四视图一致但错） |
| 父文档 | `REQ_CAPTCHA_CHAR_CANDIDATE.md` |
| 关联报告 | `reports/captcha_visual_ab_20260818_093442.md`、`reports/captcha_c4_fp_confusion_20260818_093442.jsonl` |

---

## 1. 问题定性（冻结认知）

```text
YOLO / Crop / Multi-view / Top-2   ≈ 已交付收益
C4 margin/agree 拧螺丝              ≈ 收益耗尽（0.50→0.75 零变化）
Decision 瓶颈                       ← 当前
HIGH_CONF confusion + 非法字符       ← 更深层
```

| 不要再做（本阶段） | 原因 |
|--------------------|------|
| 继续抬 `MIN_MARGIN` / `MIN_AGREE` | agree=0.75 相对 0.50：FP/rescue/PASS 全不变 |
| `FUSION=on` / 让 Decision「更敢猜」 | 历史 FP 高；与 C5 原则相反 |
| 默认全量 VLM | 成本与变量过大；C5 只打高风险位 |
| 无限膨胀 confusion 名单 | 长尾；第一版只冻结可验证子集 |

### 一句话定义（冻结）

> **C5 不是「发现 OCR 错了再改答案」，而是「发现当前答案属于高风险区域时，禁止直接 PASS，并触发二次确认或 RETRY」。**

C5 **不负责**把错误改成正确答案；它负责 **拦截高风险 PASS**。改对是 `SECOND_CONFIRM` provider 的可选结果；失败则 **RETRY**。

---

## 2. C4 参数冻结（上游不再拧）

| 参数 | 冻结值 | 说明 |
|------|--------|------|
| `MIN_MARGIN` | **0.35** | 最后一轮有效收紧 |
| `MIN_AGREE` | **0.50** | 0.75 验证无效，回退并冻结 0.50 |
| Top-K | **2** | 不再扩到 Top-3+ |
| 模式 | **shadow**；`actual=C0` | 现网提交不变 |
| YOLO / VLM 默认 | 冻结 | 不作为本阶段变量 |

```text
C0 → YOLO → C2 multi-view → C3 Top-2 → C4@0.35/0.50 → [C5 risk gate]
```

---

## 3. 目标链路（冻结）

```text
C4 position decision
      ↓
Candidate Risk Classification（C5）
      ├─ 1. 非 charset（非法字符）     → SECOND_CONFIRM 或 RETRY
      ├─ 2. 已知 confusion（charset 内）→ SECOND_CONFIRM 或 RETRY
      ├─ 3. LOW_MARGIN                 → SECOND_CONFIRM 或 RETRY
      ├─ 4. UNSTABLE                   → SECOND_CONFIRM 或 RETRY
      └─ 5. 普通 HIGH_CONF / 健康位    → 保持 PASS 候选（不额外猜）
      ↓
全位仍为 PASS 候选 → shadow PASS
任一位进入确认且未通过 / 直接 RETRY → shadow RETRY
```

**禁止**：C5 在无二次确认证据时，用「另一个候选」直接覆盖并 PASS。

---

## 4. 风险分类（冻结）

### 4.1 Charset 前提

验证码合法字符集记为 `CHARSET`（与现网/demo 生成器一致，实现阶段从配置读取；需求层要求 **必须可配置、可观测**）。

### 4.2 两类 confusion（必须分开）

| 类 | 条件 | 例 | 第一版策略倾向 |
|----|------|-----|----------------|
| **A. 字符集内混淆** | `GT∈CHARSET ∧ OCR∈CHARSET ∧ GT≠OCR` 的历史高频 **方向性** pair | `H→B`, `V→Y`, `V→W`… | **C5-R′**：Top-1=OCR **且** Top-2 含 confuseWith → RETRY（禁止合并为 H↔B） |
| **B. 非法字符污染** | `OCR ∉ CHARSET` | `I→至`, `L→长`, `X→义` | **不得直接 PASS**；默认 RETRY 或强制二次确认 |

**B 优先于 A**：非法字符是硬规则，不依赖 confusion 表是否收全。

### 4.3 已知混淆表（第一版约束）

- **禁止**无限 list：第一版仅纳入 **实验可复现、频次≥N 或人工评审** 的 pair（N 默认建议 2，待确认）。
- 表结构（逻辑）：`{ from: OCR候选, confuseWith: [GT候选…], source: "val_fp_20260818" }`。
- 方向：以 **OCR 输出侧** 触发（例如选中 `B` 且表中 `B` 常与 `H` 混淆）→ 风险，而非「猜 GT 是什么」。
- 表外 LONG_TAIL：第一版 **不** 自动 PASS 改判；保持 C4 结果。

### 4.4 与 C4 reason 的关系

| C4 reason | C5 默认 |
|-----------|---------|
| `LOW_MARGIN` | 已高风险 → 二次确认 / RETRY（可与 C4 合并，不重复猜） |
| `UNSTABLE` | 同上 |
| `HIGH_MARGIN` | 过 C4 后，再跑 charset / confusion |
| `HIGH_CONF` | 过 C4 后，**必须**再跑 charset / confusion（主战场） |

---

## 5. 二次确认抽象（冻结）

### 5.1 不绑定 VLM

```text
SECOND_CONFIRM_PROVIDER ∈ { strict_ocr | character_classifier | vlm | none }
```

| Provider | 含义（需求层） | 本 Phase 1 |
|----------|----------------|------------|
| `none` | 高风险直接 RETRY，不做改判 | 允许作为 **第一实现切片** |
| `strict_ocr` | 更严/不同预处理的单字符 OCR | 后续 |
| `character_classifier` | 专用小分类器 | 后续 |
| `vlm` | 仅对该 crop/位调用 | 最后 |

架构要求：C5 只依赖 **统一接口**（输入：crop + candidates + risk；输出：`confirm_char | abstain` + 置信度），换 provider 不改 Decision 状态机。

### 5.2 Provider 结果规则

| Provider 结果 | C5 位决策 |
|---------------|-----------|
| `abstain` / 失败 / 超时 | **RETRY**（整串） |
| `confirm_char` 且 ∈ CHARSET，且与原候选一致 | 可维持 PASS |
| `confirm_char` 且 ∈ CHARSET，且 ≠ 原候选 | **不得自动 PASS**；第一版建议仍 **RETRY**，或仅 shadow 记录「若采纳会怎样」（防猜） |
| `confirm_char` ∉ CHARSET | **RETRY** |

> 第一版推荐默认：**C5 = 风险拦截 + `provider=none`（直接 RETRY）**；二次改判作为独立实验臂，避免再次抬 FP。

---

## 6. Trace / 数据结构（冻结）

每个被 C5 拦截（或二次确认）的 position **必须**可观测，例如：

```json
{
  "position": 3,
  "candidate": "B",
  "riskType": "KNOWN_CONFUSION",
  "confusionWith": ["H"],
  "topK": ["B", "H"],
  "margin": 0.41,
  "viewAgreement": 1.0,
  "action": "SECOND_CONFIRM",
  "provider": "none",
  "providerResult": null,
  "final": "RETRY"
}
```

| `riskType`（枚举） | 含义 |
|--------------------|------|
| `ILLEGAL_CHAR` | OCR ∉ CHARSET |
| `KNOWN_CONFUSION` | 命中已知 pair |
| `LOW_MARGIN` | 继承 C4 |
| `UNSTABLE` | 继承 C4 |
| `NONE` | 无额外风险 |

| `action` | 含义 |
|----------|------|
| `PASS_CANDIDATE` | 不拦截 |
| `SECOND_CONFIRM` | 调用 provider |
| `RETRY` | 直接或确认后放弃 |

整串级仍保持：

- `actualDecision` = **C0**
- `shadowDecision` = C4+C5 管线
- `c0Text` 始终可回退
- 新增：`c5Triggers[]`、`c5TriggerRate`、按 `riskType` 计数

---

## 7. 实验臂与指标（冻结）

### 7.1 实验臂（建议）

| 臂 | 含义 |
|----|------|
| **C0** | 基线（现网 actual） |
| **C4** | @0.35/0.50 shadow（对照） |
| **C5-R** | C4 + 风险拦截，`provider=none`（高风险→RETRY） |
| **C5-S** | （可选后期）+ `strict_ocr` 二次确认 |
| **C5-V** | （更后期）+ VLM；仅高风险位 |

默认：**先 C5-R**，证明「拦截是否对准真危险」；再开 provider。

### 7.2 必报指标

| 指标 | 目的 |
|------|------|
| FP | 错误 PASS 是否下降 |
| true rescue | C0 错 → shadow 对 |
| break correct | C0 对 → shadow 错 |
| PASS rate / retry rate | 代价 |
| **C5 trigger rate** | 触发频率 |
| **C5 trigger precision** | 触发位中「相对 GT 确实危险/错误」的比例 |
| C5 rescue rate | 触发后最终变对（仅 provider≠none） |
| C5 false-rescue rate | 触发后错误改判 |
| latency | 增量可接受 |
| 按 `riskType` 拆分的 FP↓ / trigger | 规则是否打在要害 |

**特别关注**：

```text
C5 trigger 次数
    ↓
其中真正危险（该位相对 GT 错误，或非法字符）的比例
```

若 trigger 40 次仅 3 次真危险 → 规则过宽，收紧 confusion 表 / 非法规则，而不是加 provider。

### 7.3 验收优先级（冻结）

```text
1. FP ↓（相对 C4）
2. break correct ≈ 0 且不升
3. C5 trigger precision 足够高（规则对准危险）
4. 保留部分 rescue（不强制超过 C0 整串）
5. retry / latency 可接受
6. actual 始终可回退 C0
```

**不要求**第一版 C5 整串准确率超过 C0；要求 **宁可 RETRY，也不扩大敢猜面**。

---

## 8. 非目标

| 项 | 说明 |
|----|------|
| 重训 YOLO / 扩检测类 | ❌ |
| 继续调 C4 margin/agree | ❌ |
| 无限 confusion 列表 / 自动学习大表上线 | ❌（表变更需评审） |
| 默认全图 VLM | ❌ |
| C5 live 改写提交 | ❌（先 shadow；门槛同 C4：FP 可接受再谈） |
| 用 majority/Fusion「猜一个」填满整串 | ❌ |

---

## 9. 验收条目（需求级）

| ID | 内容 |
|----|------|
| T-C5-01 | 非法字符（∉ CHARSET）不得 shadow PASS |
| T-C5-02 | 已知 confusion 命中 → Trace 含 `riskType=KNOWN_CONFUSION` |
| T-C5-03 | `provider=none` 时高风险位 → RETRY，不改写为另一候选 PASS |
| T-C5-04 | Provider 接口可替换，Decision 状态机不依赖 VLM |
| T-C5-05 | 报告含 FP / rescue / break / trigger rate / trigger precision |
| T-C5-06 | actual=C0 可回退；默认 pipeline 不含 live C5 |

---

## 10. 确认清单（请回复）

| # | 项 | 建议默认 | 待你确认 |
|---|-----|----------|----------|
| 1 | C5 定义 = **风险拦截**，不是「改对答案」 | ✅ | |
| 2 | C4 冻结 `margin=0.35` / `agree=0.50`；停止拧门槛 | ✅ | |
| 3 | 混淆分 **A 集内** / **B 非法**；B 硬拒绝 | ✅ | |
| 4 | 第一版混淆表 **有限、可评审**；禁止无限 list | ✅ | |
| 5 | `SECOND_CONFIRM_PROVIDER` 抽象；首切片 `none`→RETRY | ✅ | |
| 6 | 二次确认改判默认 **不自动 PASS**（先 shadow 观测） | ✅ | |
| 7 | 实验先 **C5-R**，再 provider；VLM 最后 | ✅ | |
| 8 | 指标含 trigger rate / trigger precision；actual=C0 | ✅ | |
| 9 | 确认后进入 **本需求 Phase 2**（先 C5-R 实现） | ✅ 2026-08-18 |

### Phase 2 冻结补充（C5-R / C5-R′）

| 项 | 值 |
|----|-----|
| Provider | **none**（风险 → RETRY） |
| 改判自动 PASS | **禁止** |
| Confusion 表 | `solvers/data/c5_confusion_v1.json`（仅 n≥2：**方向性** `H→B`, `V→Y`, `V→W`；禁止合并为 ↔） |
| KNOWN_CONFUSION | **C5-R′**：Top-1=ocr **且** Top-2 含 confuseWith |
| C4 上游 | margin=0.35 / agree=0.50 |
| actual | **C0**；C5 shadow |

### C5-R′ 实验冻结结论（2026-08-18）

| 臂 | FP | retry | break | KNOWN_CONFUSION precision |
|----|---:|------:|------:|--------------------------:|
| C4@0.35 | 31 | 40% | 2 | — |
| C5-R | 10 | 67.5% | 0 | 11.9%（过宽） |
| **C5-R′** | **23** | **44%** | **1** | **100%（2/2）** |

**冻结认知：**

> C5-R′ 是目前最接近生产形态的 Risk Gate，但还不能作为最终 PASS 决策。  
> **下一步不要继续扩大 confusion 硬拦截**，而应处理「HIGH_CONF 单候选 + 方向性表内 OCR」错误。

| 不要再做 | 原因 |
|----------|------|
| 恢复「见 B/Y/W 就 RETRY」（C5-R） | precision 崩到 11.9%；retry 不可接受 |
| 无限加长 confusion 表硬拦 | 与 C5-R′ 校准方向相反 |
| 立刻接 VLM | 先验证单候选风险是否值得拦 |

报告：`reports/captcha_visual_ab_20260818_113302.md`

---

## 12. Phase 1：C5-R″ — HIGH_CONF 单候选 confusion（待确认）

| 项 | 内容 |
|----|------|
| 状态 | **待确认冻结**（仅需求，不含实现） |
| 触发 | C5-R′ FP=23，剩余多为 HIGH_CONF 单候选且落在方向性表 OCR 侧 |
| 父结论 | C5-R′ 冻结为基线 Risk Gate |

### 12.1 问题

```text
OCR Top-1 = B
Top-K     = [B]          ← 无 Top-2
历史表    = H→B（方向性）
C5-R′    → 不触发 → PASS → 可能 FP
```

### 12.2 风险等级（冻结草案）

| Level | 条件 | 默认动作（第一版） |
|-------|------|-------------------|
| **L0** | 普通 HIGH_CONF / 健康位 | PASS 候选 |
| **L1** | HIGH_CONF + **单候选** + Top-1∈表 OCR 侧（方向性） | **观测 / 可选 shadow RETRY**；不自动改判 |
| **L2** | Top-2 confusion（= 现 C5-R′ `KNOWN_CONFUSION`） | RETRY |
| **L3** | `ILLEGAL_CHAR` | RETRY |
| （继承） | `LOW_MARGIN` / `UNSTABLE` | RETRY |

**禁止**：L1 恢复为「见表内 OCR 就硬 RETRY」（那是 C5-R）。

### 12.3 `HIGH_CONF_SINGLE_CONFUSION` 定义

```text
C4 decision = PASS
AND reason ∈ {HIGH_CONF}（或等价：仅 1 个非空候选 / Top-K size==1）
AND Top-1 ∈ confusion_v1.ocr（方向性表 OCR 侧）
AND Top-2 不存在或不含 confuseWith   ← 与 L2 互斥
```

Trace 示例：

```json
{
  "position": 3,
  "candidate": "B",
  "riskType": "HIGH_CONF_SINGLE_CONFUSION",
  "riskLevel": "L1",
  "confusionWith": ["H"],
  "direction": "H->B",
  "topK": ["B"],
  "action": "OBSERVE",
  "provider": "none",
  "final": "PASS"
}
```

第一版实验臂建议二选一（确认时选定）：

| 臂 | L1 行为 | 目的 |
|----|---------|------|
| **C5-R″-O** | 只打 Trace（`action=OBSERVE`，final 仍 PASS） | 测 precision，零 retry 增量 |
| **C5-R″-R** | shadow RETRY（与 L2 同，仍 actual=C0） | 测 FP↓ vs retry↑ |

**建议先做 C5-R″-O，再可选开 -R。**

### 12.4 Confusion 表 v2 结构（需求，不实现学习）

不存「B → dangerous」，而存「B 在什么上下文危险」：

```json
{
  "ocr": "B",
  "possible_gt": ["H"],
  "direction": "H->B",
  "count": 3,
  "risk": "medium",
  "trigger": ["top2_contains_pair", "single_high_conf"]
}
```

- `top2_contains_pair` → L2（已实现于 C5-R′）  
- `single_high_conf` → L1（C5-R″）  
- **方向字段必填**；禁止 `H↔B` 合并条目  

### 12.5 实验指标（C5-R″）

相对冻结基线 **C5-R′**：

| 指标 | 目的 |
|------|------|
| L1 trigger 数 | 覆盖面 |
| L1 中真实 FP 位比例（precision） | 是否值得拦 |
| 若 -R：FP Δ、retry Δ、break Δ | 生产甜点是否出现 |
| 方向性 pair 命中明细（保留 `H→B`） | 表 v2 输入 |

**验收优先级：**

```text
1. L1 precision 足够高（不是见 B 就触发）
2. break ≈ 0
3. 若开 -R：FP 23 → ~12–15 且 retry ≲ 50%
4. 仍不接 VLM / 不自动 PASS 改判
```

### 12.6 路线（冻结意图）

```text
C5-R′ 冻结（生产形态 Risk Gate 基线）
       ↓
C5-R″ L1 HIGH_CONF 单候选 confusion（先 OBSERVE，再可选 RETRY）
       ↓
评估是否值得 RETRY
       ↓
最后才接 provider（strict_ocr / classifier / VLM）
```

### 12.7 确认清单（C5-R″）

| # | 项 | 建议默认 | 待你确认 |
|---|-----|----------|----------|
| 1 | C5-R′ 冻结为当前最佳 Risk Gate；不扩大硬 confusion | ✅ | |
| 2 | 新增 L1=`HIGH_CONF_SINGLE_CONFUSION`；与 L2 互斥 | ✅ | |
| 3 | 第一实验臂 **C5-R″-O（只观测）** | ✅ | |
| 4 | 可选第二臂 C5-R″-R（shadow RETRY） | 观测后再开 | |
| 5 | 表保持方向性；规划 v2 上下文字段；禁止 ↔ | ✅ | |
| 6 | 仍不接 VLM；改判不自动 PASS | ✅ | |
| 7 | 确认后进入 **C5-R″ Phase 2** | ✅ 2026-08-18 | |

---

## 13. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-18 | Phase 1：C5 confusion-aware；拦截优先；provider 抽象；C4 门槛冻结 |
| 0.2 | 2026-08-18 | C5-R / C5-R′ 实验；KNOWN_CONFUSION=Top-2 关系 |
| 0.4 | 2026-08-18 | **§12.7 确认**；C5-R″-O Phase 2：L1 OBSERVE + shadow 统计 |
