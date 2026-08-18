# F2-D Singleton Micro-tuning — Bench 对照

## 设定

| | A: F2 baseline | B: F2-D |
|--|----------------|---------|
| 代码 | decorrelate on，`singletonGate=false` | + `HERMES_CAPTCHA_OCR_SINGLETON_GATE=1` |
| 协议 | N=30, demo-strict, VLM=off, adaptive=0 | 同 |
| 报告 | `captcha_ocr_bench_20260815T091358Z` | `captcha_ocr_bench_20260815T091833Z` |

F2-D 门闩（**非整禁 singleton**）：

1. `votes≤1` 且 `nValid≥2` → `singleton_amid_disagreement`（单票 amid 分歧）
2. 纯 singleton → 要求 `evidence ≥ singletonMinEvidence`（默认 0.65）
3. 可选 LEN 不一致 → abstain

默认 profile 仍为 **`singletonGate: false`**（实验开关，未默认开启）。

## 结果

| 指标 | F2 | F2-D | Δ |
|------|---:|-----:|---|
| **falseAcceptRate** | 12.5% | **0.0%** | ↓ |
| **eventualSessionSuccess** | 23.3% | **16.7%** | **−6.6pp** |
| **abstainRate** | 73.3% | **83.3%** | **+10pp** |
| SINGLETON falseAccept | 1 | **0** | ↓ |
| ACCEPT 样本 | 8 | 5 | 少 3（含原 2 次正确 singleton 样） |

## 判定（按约定）

```text
成功：SINGLETON FA↓ + overall FA 不恶化 + eventual 不明显下降
拒绝：singleton FA↓ 但 eventual 明显下降 或 abstain 继续大幅膨胀
```

**判定：拒绝默认启用 F2-D。**

- FA 与 SINGLETON FA 确实更好，但靠的是再切掉一批「结构上与 FA 不可分」的单票 ACCEPT（含正确样本）。
- eventual −6.6pp、abstain 再 +10pp，符合「继续收紧 Gate 的同一失败模式」。

## 结论

1. **F2（A/B/C）保持为当前默认**；`singletonGate` 默认关闭。  
2. **停止继续加 Decision Gate** 作为主优化方向。  
3. 残留 singleton/单票问题，下一步应研究 **Evidence 质量**（字符级置信 / 独立模型证据），而不是再抬阈值。

## 开关

```bash
# 仅实验
HERMES_CAPTCHA_OCR_SINGLETON_GATE=1
HERMES_CAPTCHA_OCR_SINGLETON_MIN_EVIDENCE=0.65   # 可选
```
