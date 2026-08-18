# Phase 1 需求：字符级候选 + Crop 扩边 + 保守 Fusion（P3）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-17 |
| 状态 | **§7 已冻结 · Phase 2 进行中**（C1→C2→C3→C4；C5 暂缓） |
| 触发 | val n=200：C 57%≪字符级 85.9%；bbox R/P≈99.5%；失败 66% 为 `ocr_partial_wrong` |
| 父文档 | `REQ_CAPTCHA_VISUAL_DATALAYER.md` |
| 关联报告 | `reports/captcha_visual_ab_20260817_150110.md` |

---

## 1. 问题定性（冻结认知）

```text
YOLO 定位     99.6% recall / 99.4% precision   ← 已够用
Crop          ~22% 失败标为 bbox_crop_cut      ← 可改进
字符 OCR      85.9% character-level            ← 主战场
整串          57.0%                            ← 乘积效应（一位错整串挂）
```

| 不要再做（本阶段） | 原因 |
|--------------------|------|
| 继续训更强 YOLO / 36 类 | bbox 已近天花板 |
| 整图 preprocess 当主手段 | B≈A，整图增强无增益 |
| `FUSION=on` | shadow FP=72/200，shadow_looser=149 |
| 默认全量 VLM | D 未证明价值 |

**一句话**：瓶颈从「找字符」转为「单字符不确定时不要硬猜 + 扩边/多视图投票 + 全位达标才 PASS」。

---

## 2. 目标链路（冻结）

```text
YOLO (冻结，基本不动)
  ↓
bbox → expanded crops (±0/5/10/15%)
  ↓
per-crop multi-view preprocess (灰度/对比度/二值/放大) → OCR
  ↓
position → candidates[{char, score}, …]   # Top-K，禁止低置信强制 Top-1
  ↓
character-level conservative Fusion
  ↓
全部 position 过门槛 → PASS
任一低置信 / 冲突 → RETRY（不猜）
  ↓
（可选后期）仅低置信位 → VLM fallback
```

---

## 3. 分阶段实验臂（代替旧 A–E 主对比）

| 臂 | 方案 | 相对 C0 |
|----|------|---------|
| **C0** | 当前 YOLO + 单 crop + Top-1 OCR（基线 57%） | — |
| **C1** | + expanded crop 多尺度 | 验 crop_cut |
| **C2** | + 单字符 multi-view preprocess OCR | 验局部预处理 |
| **C3** | + Top-K char candidates | 验候选可解释性 |
| **C4** | + **conservative** char-level Fusion（默认仍 shadow 或独立评分） | 验整串↑且 FP↓ |
| **C5** | + 低置信位 VLM fallback | 最后才开 |

每臂必须报：`首试准确率`、`字符准确率`、`FP`、`FN`、`retry/abstain`、`latency`。

**理论锚点**：字符级若从 85.9% → ~92%，6 位整串期望会明显抬升（在检测已稳前提下）。

---

## 4. 需求明细

### 4.1 Character candidates（P3.1）

每位输出 Top-K（建议 K=3）：

```json
{
  "position": 3,
  "candidates": [
    {"char": "K", "score": 0.52},
    {"char": "X", "score": 0.31},
    {"char": "R", "score": 0.17}
  ]
}
```

规则：低置信 **不得** 单独强制写成唯一答案；进入 Fusion 由门槛决定 PASS/RETRY。

### 4.2 Crop refinement（P3.2）

对每个 YOLO bbox 生成扩边系列：`0% / +5% / +10% / +15%`（可配置；必要时含 −5%）。  
多 crop OCR 结果并入该 position 的 candidates / 投票。

目标：压 `bbox_crop_cut`（当前失败中 22.1%）。

### 4.3 Multi-view char OCR（P3.3）

预处理作用域 = **单字符 crop**，不是整图：

- 原图 / 灰度 / 对比度 / 二值 / 放大  

同 position 多视图投票（如 3/4 → K）。

### 4.4 Conservative Fusion（P3.4）

**禁止**仅做整串 majority。改为：

1. 按 position 聚合 candidates  
2. 每位：高置信且无强冲突 → 选中；否则该位 FAIL  
3. **所有位 PASS** 才整串 PASS；否则 RETRY  
4. 默认模式继续 **shadow** 对比 actual=C0/C 路径，直到 FP 可接受再谈 `on`

可叠加：从失败集统计 confusion pair（K↔X、8↔B…），对易混位触发二次识别（扩边/多视图/可选 VLM）。

### 4.5 VLM（P3.5，后置）

仅当某位 score &lt; 阈值时调用；不做默认全量。

### 4.6 开关与回退（Phase 2）

| 变量 | 默认 | 含义 |
|------|------|------|
| `HERMES_CAPTCHA_CHAR_PIPELINE` | `c0` | `c0`…`c4`；生产默认 C0 |
| `HERMES_CAPTCHA_CROP_PADS` | `0,0.05,0.10,0.15` | C1+ 扩边比例 |
| `HERMES_CAPTCHA_CHAR_TOPK` | `3` | C3+ Top-K |
| `HERMES_CAPTCHA_CHAR_MIN_SCORE` | `0.55` | C4 位级过门槛 |
| `HERMES_CAPTCHA_FUSION` | `shadow` | 继续 shadow；C4 不 live apply |

Trace：`yoloOcr.c0Text` / `c0Characters` 始终保留；C4 时 `actualDecision=C0`，`shadowDecision=C4`，`charShadowMatrix` 四格统计。

---

## 5. 非目标

| 项 | 说明 |
|----|------|
| 重训 YOLO / 升检测精度为主目标 | ❌ |
| 整图 morph/threshold 主迭代 | ❌ |
| 立即 `FUSION=on` | ❌ |
| 默认 VLM 主干 | ❌ |

---

## 6. 验收

| ID | 内容 |
|----|------|
| T-Char-01 | 单测：position 产出 Top-K candidates |
| T-Char-02 | C1：扩边 crop 可配置且可观测 |
| T-Char-03 | C2：同 crop 多视图写入 candidates |
| T-Char-04 | C4 shadow：任一位低置信 → RETRY，不硬拼整串 |
| T-Char-05 | 实验报告：C0–C4（及可选 C5）对比表 + 字符级准确率 |
| T-Char-06 | 相对 C0：首试↑ 且 shadow/live FP 不恶化（门槛写入报告） |

---

## 7. 确认清单（已冻结 2026-08-17）

| # | 项 | 冻结 |
|---|-----|------|
| 1 | YOLO **冻结**，本阶段不训检测 | ✅ |
| 2 | 主战场 = crop 扩边 + 多视图 + Top-K + 保守位级 Fusion | ✅ |
| 3 | 实验臂改为 **C0–C5**（C5 进入独立 Phase 1） | ✅ |
| 4 | Fusion 默认 **shadow**；全位过门槛才 PASS | ✅ |
| 5 | VLM 仅低置信 / 高风险 fallback，排 C5 provider 末位 | ✅ |
| 6 | 进入 Phase 2：C1 → C2 → C3 → C4 | ✅ |
| 7 | **C0 可回退**：C1～C4 任一优化不得降低 C0 可用性；默认/失败回退 C0 | ✅ |
| 8 | C3：`actual=C0` / shadow candidates；先测 Top-2/Top-3；**不加 Fusion**；看 Oracle recall | ✅ |
| 9 | C4：K=2；margin≥0.20 + agreement；shadow；actual=C0；看 FP/挽回矩阵 | ✅ |
| 10 | C4 调参：`margin=0.35`；`agree=0.75` 验证无效 → **冻结 agree=0.50**；停止拧门槛 | ✅ |
| 11 | C5：见 **`REQ_CAPTCHA_C5_CONFUSION.md`**（Phase 1 仅需求） | ⏳ |

### C4 运行参数（冻结 2026-08-18）

| 参数 | 值 |
|------|-----|
| `MIN_MARGIN` | **0.35** |
| `MIN_AGREE` | **0.50** |
| Top-K | **2** |
| live | **否**（shadow；actual=C0） |

### 回退原则（冻结）

> 所有 C1～C4 必须保持 C0 可回退。任何单项优化不得降低现有 C0 的可用性。  
> 开关：`HERMES_CAPTCHA_CHAR_PIPELINE=c0|c1|c2|c3|c4`（默认 **c0**）。

### 验收指标（冻结）

1. whole-string accuracy ↑  
2. character accuracy ↑  
3. false positive **不升**  
4. retry rate 可接受  
5. latency 增量可接受  
6. C0 可随时 fallback  

**宁可 RETRY，也不要把低置信候选强行变成 PASS。**

### Phase 2 实现顺序

```text
C0 (基线可回退)
 → C1 扩边 Crop（先验证 crop_cut↓）
 → C2 单字符多视图
 → C3 Top-2/3 Candidate
 → C4 位级 Conservative Fusion（shadow；actual=C0）
 → C5 VLM（暂缓）
```

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-17 | 据 n=200 结论：停 YOLO 主优化，转字符级候选路线 |
| 0.2 | 2026-08-17 | §7 确认；C0 回退原则；验收以 FP 为先；开 Phase 2 |
| 0.3 | 2026-08-18 | C4 门槛冻结 0.35/0.50；C5 外迁至 `REQ_CAPTCHA_C5_CONFUSION.md` |