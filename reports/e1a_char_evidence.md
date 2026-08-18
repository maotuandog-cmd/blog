# E1-A Character Evidence — Phase 2 报告

## 范围

| 做了 | 没做 |
|------|------|
| ddddocr `probability=True` → `characterEvidence` | 新 OCR / 新 preprocess |
| 写入 result + `observation.candidate` | 改 Decision Gate / decisionScore |
| bench `charEvidenceAnalysis` | S4 / S5 / VLM |

开关：`ocr.charEvidence` / `HERMES_CAPTCHA_CHAR_EVIDENCE`（默认 on）。

## 字段

```json
{
  "candidate": {
    "text": "…",
    "characterEvidence": [
      {"char":"B","position":1,"confidence":0.43,"alternatives":[{"char":"8","score":0.39}],"ambiguous":true,"margin":0.04}
    ],
    "charSummary": {
      "charMinConfidence": 0.43,
      "charMeanConfidence": 0.77,
      "lowConfidencePositions": [1],
      "ambiguousPositions": [1],
      "ambiguousCount": 1
    }
  }
}
```

## Bench（同 F2 协议，观测 only）

`BENCH_LABEL=E1-A-char-evidence` · `reports/captcha_ocr_bench_20260815T092712Z.*`

> 本跑 **未改 Decision**；FA/eventual 波动相对 F2 基线属样本噪声，**不是 E1-A KPI**。

### E1-A 验收问题：false ACCEPT 能否被弱字级证据解释？

| 指标 | 值 |
|------|---:|
| false ACCEPT 数 | 2 |
| FA 中含弱字级证据 | **2 / 2（100%）** |
| true ACCEPT 中含弱字级证据 | 2 / 5（40%） |
| FA 的 mean(charMin) | **0.303** |
| true ACCEPT 的 mean(charMin) | **0.536** |

结论：

1. **字符级信号可用**（ddddocr probability 对齐到 decision text）。  
2. **当前全部 false ACCEPT 都呈现弱字级模式**（low charMin / ambiguous）。  
3. true ACCEPT 的 charMin 均值明显高于 FA → **有初步分离度**，但重叠仍在（true 也有 40% 弱字级），**尚不足以单独驱动 Gate**。  
4. 满足进入 **E1-B candidate margin** 的前提：先有可观测的弱证据解释，再叠加 top1–top2 间距。

## 产物

- `solvers/char_evidence.py`
- `ocr._attach_character_evidence`（ACCEPT 路径附加；恢复 decision 字段）
- `session.build_observation` → `candidate.characterEvidence`
- `tests/test_char_evidence.py`
- bench 汇总字段 `charEvidenceAnalysis`
