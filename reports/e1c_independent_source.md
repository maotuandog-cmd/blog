# E1-C Independent Source — Phase 2 报告

## 范围

| 做了 | 没做 |
|------|------|
| `independentEvidence` + `sourceAgreement` 观测 | 改 Decision / decisionScore / Gate |
| 优先 RapidOCR（跨家族）；失败则 **ddddocr beta raw 单次**（弱独立） | preprocess 变体投票当独立源 |
| bench `independentSourceAnalysis` | S4/S5/VLM |

## 字段

```json
{
  "independentEvidence": [
    {"source":"ddddocr","text":"t2fmbz","confidence":0.86,"independence":"primary"},
    {"source":"ddddocr_beta","text":"r2fmbz","independence":"weak_same_vendor","crossFamilyStatus":"empty"}
  ],
  "sourceAgreement": {"agree":false,"charDiff":1,"positions":[0]}
}
```

## 能力事实

| 二级源 | 结果 |
|--------|------|
| RapidOCR（paddle_onnx） | **对本 demo 验证码域几乎读不出**（scene-text 检测器） |
| 回退 `ddddocr_beta` raw-only | 可产出文本；`independence=weak_same_vendor`（同厂商不同权重，**非** preprocess 堆叠） |

因此本轮是：**弱独立探针实验**，不是完美跨家族引擎验收。RapidOCR 仍保留为优先路径，待换 captcha-capable 二级引擎。

## Bench（观测 only）

`E1-C-independent-source` · `reports/captcha_ocr_bench_20260815T095640Z.*`

### 验收问题：independent agreement 是否比 preprocess 一致更有区分力？

| 指标 | FA (n=4) | true ACCEPT (n=9) |
|------|--------:|------------------:|
| **independentAgree** | **0 / 4（0%）** | **5 / 9（55.6%）** |
| independentConflict | **4 / 4（100%）** | 4 / 9（44.4%） |

对比 E1-A（同跑）：

| | FA | true |
|--|---:|-----:|
| weak char | 4/4 | 6/9 |

结论：

1. **方向正确**：false ACCEPT **全部**与二级源冲突；true ACCEPT 过半一致。  
2. 仍有重叠：true 也有 ~44% conflict → **还不能单独改 Gate**（避免 F2-D）。  
3. 即便二级源多是 `ddddocr_beta`（弱独立），分离度已强于「仅看 preprocess 全票一致」。  
4. **E1-D 仍不宜立刻融合改分**；下一步应换真正跨家族 captcha OCR，或在观测矩阵上把 `independentAgree` 与 `charMin` 联合分析后再开对照实验。

## 产物

- `solvers/independent_source.py`
- `ocr._attach_character_evidence` 内附加 E1-C（不改 decision）
- `tests/test_independent_source.py`
- optional dep: `rapidocr-onnxruntime` in `requirements-ocr.txt`
