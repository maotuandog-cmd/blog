# E1-C.2 / C2-B：跨家族 Captcha OCR（ppllocr）

**范围**：观测 only；**未**改 decisionScore / ACCEPT|ABSTAIN / retry / preprocess / VLM。  
**准入**：captcha-specialized + 字符候选 + cross-family；拒绝 scene-text 空读。

## 选型

| 候选 | 家族 | 域匹配 | 字符候选 | 结论 |
|------|------|--------|----------|------|
| RapidOCR | paddle/scene-text | ❌ 常 empty | 弱 | **拒绝**（会假 conflict） |
| ddddocr beta | 同厂商 | 有 | 弱 | **非**跨家族；C2-B 默认不再回退 |
| **ppllocr** | YOLOv11 + ONNX | ✅ demo 非空 | ✅ `classification_box` | **采用**（默认 secondary） |

依赖：`requirements-ocr.txt` → `ppllocr==2.2`  
开关：`HERMES_CAPTCHA_SECONDARY_OCR=ppllocr`（默认）

统一结构：

```json
{"source":"ppllocr","text":"...","confidence":0.82,"available":true,"charCandidates":[...]}
{"source":"ppllocr","available":false,"reason":"no_character_candidate"}
```

`available=false` / 长度不可比 → **不**计入 `independentConflict`。

## Bench

| 批次 | label | N | 文件 |
|------|-------|--:|------|
| 探针+初跑 | `E1-C2-B-ppllocr` | 60 | `captcha_ocr_bench_20260815T110823Z.json` |
| **主结论** | `E1-C2-B-ppllocr-lengate` | **80** | `captcha_ocr_bench_20260815T111025Z.json` |

协议：`demo-strict` · VLM=off · adaptive=0 · 长度门控 agreement（wantLen=6）。

### 主跑 ACCEPT=23（true=19, FA=4）

#### 1) conflict 净化

| agreement reason | n | 含义 |
|------------------|---:|------|
| `exact` | 4 | 真正独立一致 |
| `mismatch`（同长可比） | 6 | 真正字符冲突 |
| `secondary_length_mismatch` | 13 | YOLO 过检/漏检 → **incomparable**，非 conflict |

归因（verify 已知 primary 对错）：

| label | n | 解释 |
|-------|--:|------|
| `both_agree_correct` | 4 | Case 1：双源一致且对 |
| `secondary_wrong` | 4 | Case 2：primary 对、secondary 错 |
| `primary_wrong_secondary_unknown` | 2 | FA + 同长冲突（secondary 是否对未知） |
| `source_unavailable_or_incomparable` | 13 | Case 3 扩展：长度不可比 |

**结论**：空读假 conflict 已消除；剩余同长 conflict 仍混有 true（4）与 FA（2）→ **仍非 hard gate**。大量「冲突」其实是 secondary 长度不稳。

#### 2) agreement 价值

| | FA | true |
|--|--:|-----:|
| independentAgree | **0** | **4** |
| independentConflict（可比） | 2 | 4 |

- Agree precision（在 ACCEPT 内）：**4/4 = 100%**（本跑）  
- Agree 不出现在 FA → **强正证据**  
- 覆盖仍低（true 中仅 21%）→ 不足以单独驱动 Decision

#### 3) 对 `weak|conflict` 的解释

联合矩阵（lengate）：

| cell | correct | FA | FAR |
|------|--------:|---:|----:|
| `*|agree` | 4 | 0 | 0% |
| `weak\|conflict` | 3 | 2 | 40% |
| `*\|\unknown` | 11 | 2 | 15% |

未出现「大量 weak|conflict → weak|agree」翻转。  
说明当前瓶颈更接近：

```text
缺少稳定的同长第三方确认
（ppllocr 常 length_mismatch / 偶发同长错字）
```

而不是：

```text
decision 不够聪明
```

情况 B（困难区）**仍然成立**；C2-A 裁决未推翻。

## Case 对照

| Case | 现象 | 本跑 |
|------|------|------|
| 1 双源一致 | 提升可信 | ✅ agree 全为 true ACCEPT |
| 2 冲突且 B 更可靠 | 需 source weighting | ⚠ 同长冲突时 secondary 常错（4 secondary_wrong） |
| 3 empty | 不得记 conflict | ✅ available / length 门控 |

## 实现要点

- `solvers/independent_source.py`：默认 `ppllocr`；`available` 字段；长度不可比 ≠ conflict  
- **禁止** RapidOCR 空读回退污染；`ddddocr_beta` 仅显式选择  
- Decision **零行为变化**（单测覆盖）

## 路线裁决

```text
C2-A  ✅ 情况 B
C2-B  ✅ 完成：跨家族源可用；agree=强正证据；conflict 部分净化但仍非 gate
C2-C  ▶ 下一步：离线 soft score（优先 agree bonus，勿对 conflict 重罚）
E1-D  ⏸
```

C2-C 建议只模拟：

```text
decisionScore' = decisionScore + agreeBonus
# 不对 weak|conflict / conflict 做主惩罚（情况 B）
```

可选后续（仍观测）：调 ppllocr `conf/iou` 降过检，提高 comparable 覆盖——不改变 Decision。
