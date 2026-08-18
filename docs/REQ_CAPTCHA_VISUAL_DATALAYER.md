# Phase 1 需求：视觉数据化层（YOLO 定位 + 字符 OCR / 候选融合）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-17 |
| 状态 | **已确认；Phase 2 进行中**（优先级与 Trace 同轮冻结） |
| 一句话 | **不推翻**现有 ddddocr / 预处理投票 / VLM；用 **YOLO 做「字符在哪里」**，OCR/VLM 做「是什么」，经 Candidate Fusion → Decision |
| 解决痛点 | 整图 OCR 被干扰线/粘连拖垮；长度写死；只知错不知哪条路径对 |
| 范围 | 仅 `captcha-solver/` 的 **image** 路径；观测 JSON 可扩展；**不改** Worker 填码契约 |
| 非范围 | YOLO 直接当唯一 OCR、云打码、slider/click、Worker Trace（另轨） |
| 关联 | `REQ_CAPTCHA_OCR_ACCURACY.md` · `REQ_CAPTCHA_DECISION_SESSION.md` · `REQ_CAPTCHA_VLM7B.md` · `REQ_CAPTCHA_TRACE_BINDING.md` |
| 与「禁 E4」关系 | **不是**再调 morph/MIN_CONF；是新增 **检测候选源 + 可解释融合** |

---

## 1. 分工原则（冻结）

| 组件 | 回答的问题 | 不回答 |
|------|------------|--------|
| **YOLO（推荐主定位器）** | 字符在哪里？→ bbox 列表 | 默认不直接当最终答案 |
| **OpenCV 精细分割** | 粘连块怎么切开？ | 类别识别 |
| **OCR（ddddocr 等）** | 这个 crop 是什么字？ | 是否提交 |
| **VLM** | 整图理解 / 冲突仲裁候选 | 包办全链路 |
| **Decision** | 投票、长度、PASS/RETRY/ABSTAIN | 再训一个检测器 |

**明确反对（本期）**：`图片 → YOLO36类 → 最终答案` 作为默认生产路径。  
**明确推荐**：`YOLO(detect character) → crop → OCR(+VLM) → Fusion`。

---

## 2. 目标架构（冻结方向）

```text
                    CAPTCHA
                       │
                       ▼
              Image Preprocess（可选）
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
     原图 OCR        YOLO          VLM
     (raw_ocr)    (character     (整图候选)
                     detect)
                       │
                       ▼
              bbox C1..Cn（按 x 排序）
                       │
              ┌────────┴────────┐
              ▼                 ▼
        单框已是单字？      粘连/过宽框？
              │                 │
              │                 ▼
              │          OpenCV 二次分割
              │                 │
              └────────┬────────┘
                       ▼
                 单字符 crops
                       │
                       ▼
              每 crop → OCR（±VLM）
                       │
                       ▼
              Candidate Fusion
              （raw / yolo+ocr / vlm / 可选 yolo_cls）
                       │
                       ▼
                    Decision
```

长度校验改为（冻结方向）：

```text
detected_chars = len(yolo_boxes)   # 或二次分割后的最终 crop 数
if detected_chars in allowed_lengths:  # 如 {4,5,6}，来自 profile
    继续融合
else:
    RETRY / ABSTAIN（而非写死「必须 6 位」一条路打死）
```

---

## 3. YOLO 训练策略（冻结优先级）

### 3.1 第一优先：单类检测（detect-only）

```text
class = character   # 仅 1 类
```

标注：每张图若干 bbox（不必在检测头上分 0–9/A–Z）。  
推理：出框 → crop → **现有 OCR** 认字。

| 优点 | 说明 |
|------|------|
| 数据/复杂度低 | 只需框，不必框上标对错类也能训检测（分类交给 OCR） |
| 与现网 OCR 兼容 | 不推翻 ddddocr |
| 双模型可纠错 | YOLO 框对 + OCR 错 / 反之，靠 fusion |

### 3.2 第二优先（实验臂，非默认生产）：检测+分类（36 类）

固定字符集站点可训 `0-9A-Z`，产出 `yolo_cls` 候选；**仍须**与 OCR/VLM 投票，禁止 YOLO 独断。

### 3.3 模型选型建议

| 项 | 建议 |
|----|------|
| 系列 | **YOLO11**（Ultralytics）或同代检测模型；以可复现、可 ONNX/本地推理为准 |
| 部署 | `captcha-solver` 可选依赖；无权重时自动跳过 YOLO 通道（等价现网） |
| 权重 | **不**把大权重强行塞进 git；路径 / 下载说明进 README + env |

---

## 4. 分阶段交付

### S0 — 无权重可跑的对照（可与 YOLO 数据准备并行）

连通域 / 投影等 **OpenCV** 分割 → 单字 OCR → `segmented_ocr` 候选。  
目的：不堵在「等 500 张标注」上，也能先验证「单字 OCR」是否涨点。

### S1 — YOLO detect + crop + OCR（**推荐主验证路径**）

| 产出 | source |
|------|--------|
| 整图 | `raw_ocr` |
| YOLO→crop→OCR | `yolo_ocr`（或 `segmented_ocr` 且 `segmenter=yolo`） |
| 可选 | `vlm` |

**S1 不做**：36 类 YOLO 默认开启；完整 S3 加权公式唯一门槛。

### S2 — 字符级多候选 + 低置信位重识

同前版：位级 `[{char,score}]`；优先单字重处理。

### S3 — 多版本图 + 加权 Decision

同前版；`segmentation_quality` 可来自 YOLO conf / 框数稳定性。

### 粘连补丁（S1 即应具备降级）

YOLO 只出合并框 `[8B]`、`[K7]` 时：

```text
YOLO 框 → OpenCV 精细分割 → 单字 → OCR → Fusion
```

无精细分割成功则该通道降权或弃权，**不瞎猜填满长度**。

---

## 5. 内部表示（增补）

在既有 `candidates[]` / `characters[]` / `decision` 上增加检测侧观测：

```json
{
  "detection": {
    "engine": "yolo|opencv|none",
    "boxes": [
      { "xyxy": [x1, y1, x2, y2], "conf": 0.93, "class": "character" }
    ],
    "detected_chars": 5,
    "allowed_lengths": [4, 5, 6]
  },
  "candidates": [
    { "source": "raw_ocr", "text": "8B3K7", "confidence": 0.82 },
    { "source": "yolo_ocr", "text": "8B3K7", "confidence": 0.94 },
    { "source": "vlm", "text": "8B3K7", "confidence": 0.88 },
    { "source": "yolo_cls", "text": "8B3K7", "confidence": 0.90 }
  ]
}
```

`yolo_cls` 仅在 36 类实验开启时出现。

可解释性：能回答「YOLO 框数 / raw 错 / yolo_ocr 对 / VLM 对 → 最终」。

---

## 6. 模块落位

```text
captcha-solver/solvers/
  preprocess/
  segmentation/
    opencv_cc.py      # S0
    yolo_detect.py    # S1 detect-only
    refine_split.py   # 粘连二次分割
  recognition/
    raw_ocr / char_ocr / vlm
  decision/
    candidate_fusion / voting / ...
```

---

## 7. 门禁实验（扩大为 A–E）

数据：建议 **500–2000** 张（有答案）；YOLO 路径另需 **bbox 标注**（detect-only 可先只标框；36 类再标字符）。

| 臂 | 管线 |
|----|------|
| **A** | 原图 → OCR |
| **B** | 原图 → VLM（或现网 VLM 策略） |
| **C** | YOLO detect → crop → OCR |
| **D** | YOLO detect+classify（36 类，可选） |
| **E** | YOLO + OCR + VLM 投票（+ 可选 raw） |

**重点对比：A vs C vs E**（用户建议）。  
OpenCV-only 分割可作为 **C0** 旁路写入同一报告，便于无权重时对照。

| 判定 | 动作 |
|------|------|
| **C ≫ A** | 证明「检测 + 单字 OCR」有效 → 允许默认开 `yolo_ocr` 候选 |
| **E ≫ C** | 再加重 VLM 仲裁；仍非 VLM 包办 |
| **D vs C** | 仅当 D 稳定优于 C 且运维成本可接受，才考虑弱化 OCR |
| C ≈ A | 不默认开 YOLO；查标注/粘连/域名分布，避免空转 GPU |

开关建议：

| 变量 | 含义 |
|------|------|
| `HERMES_CAPTCHA_DETECT=off\|opencv\|yolo\|auto` | 定位器 |
| `HERMES_CAPTCHA_YOLO_WEIGHTS=` | 权重路径；空则 yolo 不可用 |
| `HERMES_CAPTCHA_YOLO_CLS=0\|1` | 是否启用 36 类候选（默认 0） |

---

## 8. 非目标（本期）

| 项 | 说明 |
|----|------|
| YOLO 独断最终答案（无 OCR/VLM fusion） | ❌ 默认禁止 |
| 无标注集就宣称 YOLO 涨点并默认开启 | ❌ |
| 把 PaddleOCR 强行换掉 ddddocr 作为前提 | ❌ 可另开实验；S1 默认继续 ddddocr 认 crop |
| 训练流水线产品化（自动标注平台） | ❌ 本期脚本+目录约定即可 |
| Worker / Trace / slider | ❌ |

---

## 9. 验收

| ID | 内容 |
|----|------|
| T-Vis-01 | `DETECT=off` 与现网等价 |
| T-Vis-02 | OpenCV 或 YOLO 路径产出 `yolo_ocr`/`segmented_ocr` 与 `detection.boxes` |
| T-Vis-03 | 框数 ∉ `allowed_lengths` → RETRY/ABSTAIN 可测，且不写死单一长度 |
| T-Vis-04 | 粘连宽框触发 refine 或降权（单测 fixture） |
| T-Vis-05 | 门禁报告含 **A/C/E**（有权重时）；无权重时含 A/C0 |
| T-Vis-06 | 无权重时不崩溃，仅跳过 YOLO 通道 |

---

## 10. 与 Trace / 数据闭环

| 轨道 | 关系 |
|------|------|
| Trace + Feedback 假阳性 | 为 YOLO/OCR 提供 Bad Case 图；**不阻塞**本实验启动 |
| 本需求 | 提供 `detection` + `candidates` 便于标注回流 |

标注最小集：`image` + `bboxes[]`（+ 可选 `char` 标签用于评测 crop-OCR，非检测训练必需）。

---

## 11. 确认清单（已冻结 2026-08-17）

| # | 项 | 冻结 |
|---|-----|------|
| 1 | YOLO **只做字符定位**（单类 `character`）；OCR 认字 | ✅ |
| 2 | **双模型**：禁止 YOLO 独断；无权重时 raw_ocr 仍正常 | ✅ |
| 3 | 长度由检测框数 ∈ `allowed_lengths` | ✅ |
| 4 | Trace 与本需求 **同轮**；顺序 Trace → S0 → YOLO 骨架 → 实验 → Fusion | ✅ |
| 5 | 门禁 **A/B/C/D/E**；核心对比 A vs C vs E | ✅ |
| 6 | 生产 Trace **默认不落原图**（hash/trace_id）；离线集才存图+GT | ✅ |
| 7 | **S0 = 观测型 baseline**（length/bbox/geometry/OCR 空否）；**S0 PASS ≠ 提交 PASS** | ✅ |
| 8 | 进入 Phase 2 | ✅ |

### Phase 2 优先级（冻结）

```text
P0  Trace / Schema / S0（观测）          ✅ 已落地
P1  YOLO inference adapter（无权重不崩）  ✅
P1  bbox → crop → OCR                   ✅
P1  实验脚本 A/B/C/D/E                   ✅
```

### Phase 2 续（冻结 2026-08-17 · 用户确认）

```text
P2.1  Fusion（简单可解释） ✅ shadow
P2.2  Decision shadow mode ✅
P2.3  粘连 split ✅
P2.4  A–E 真实数据对比 + 错误分类  ← 当前
P2.5  根据数据决定是否训练/开 Fusion
```

### P2.4 实验结论冻结（n=50 预跑，2026-08-17）

| 结论 | 含义 |
|------|------|
| C 52% ≫ A 10% | **字符定位**是核心增益；路线成立 |
| B ≈ A | 简单预处理不是主矛盾；禁再堆 threshold/blur 当主迭代 |
| E shadow FP 高 / shadow_looser 多 | **禁止**此时 `FUSION=on`；C 作正式候选，Fusion 继续 shadow |
| 下一动作 | **先跑满 200 val** → C 错误分类 → char-level → bbox R/P → 再评估 split/Fusion |

### P2.4 执行顺序（冻结）

```text
① 200 张完整 A–E（Fusion=shadow）
② 分析 C 错误类型
③ character-level accuracy
④ YOLO bbox recall / precision
⑤ 按需强化 OpenCV 粘连 split
⑥ 再跑 C'
⑦ Fusion 继续 Shadow
⑧ 最后才调 Fusion FP / 考虑 on
```
| 项 | 冻结 |
|----|------|
| Fusion 第一版 | 无复杂加权公式；冲突 → RETRY/ABSTAIN，不强行猜 |
| 默认模式 | `HERMES_CAPTCHA_FUSION=shadow`（或未设视为 shadow） |
| `on` | 显式开启后 Fusion 才改写 `solved`/`text`/`decision` |
| `off` | 不算 Fusion |
| S0 | 继续 `gatesSubmit: false` |
| 训练 YOLO / 36 类 | 排在 P2.5，本轮不做 |

Shadow 对比字段（观测）：

```text
actualDecision  = 现网 raw_ocr 决策
shadowDecision  = Fusion 决策
shadowDelta     = agree | shadow_stricter | shadow_looser | conflict_text
```

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-17 | 视觉数据化层：分割 / 候选 / S1–S3 / A–D 门禁 |
| 0.2 | 2026-08-17 | 纳入 YOLO：detect-only 优先、双模型、A–E 门禁、粘连二次分割、长度=框数 |
| 0.3 | 2026-08-17 | 用户确认 Phase 2；冻结 Trace 同轮优先级；S0 改为观测型 baseline |
| 0.4 | 2026-08-17 | 冻结 P2.1 Fusion + P2.2 shadow；P2.3 split / P2.5 训练后置 |
| 0.5 | 2026-08-17 | P2.3 落地：宽 bbox → 垂直投影/连通域 split；Trace `stage=split` |
| 0.6 | 2026-08-17 | n=50 证明 C≫A；冻结 Fusion=shadow；P2.4=先跑满 200+错误分类 |
| 0.7 | 2026-08-17 | n=200：C=57%，char=85.9%，bbox≈99.5%；YOLO 降级；下一阶段见 `REQ_CAPTCHA_CHAR_CANDIDATE.md` |
