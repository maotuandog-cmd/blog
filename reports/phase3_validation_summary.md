# Phase 3 Validation Summary

Matrix: `demo-strict` + captcha-demo `@127.0.0.1:3000`

| Cell | Setup | N |
|------|-------|---|
| A | ADAPTIVE=0, VLM=off (baseline) | 30 |
| B | ADAPTIVE=1, VLM=off | 30 |
| C | ADAPTIVE=0, VLM=on (separate tier) | 5 |
| D | ADAPTIVE=1, VLM=on (separate tier) | 5 |

## Core metrics

| Cell | firstAttemptSuccess | eventualSessionSuccess | **falseAcceptRate** | abstainRate | retryRate | retryRecoveryRate | retryFalseAcceptRate | vlmInvokeRate | vlmRecoveryRate | latencyP50 | latencyP95 | latencyP99 |
|------|--------------------:|-----------------------:|-------------------:|------------:|----------:|------------------:|--------------------:|--------------:|----------------:|----------:|----------:|----------:|
| **A** | 26.7% | 26.7% | **65.2%** | 23.3% | 0.0% | n/a | n/a | 0.0% | n/a | 524 | 846 | 857 |
| **B** | 13.3% | 36.7% | **71.4%** | 53.3% | 86.7% | 26.9% | 23.1% | 0.0% | n/a | 1088 | 1640 | 1731 |
| **C** | 60.0% | 60.0% | **25.0%** | 20.0% | 0.0% | n/a | n/a | 20.0% | 0.0% | 650 | 7004 | 8233 |
| **D** | 20.0% | 20.0% | **50.0%** | 60.0% | 80.0% | 0.0% | 25.0% | 60.0% | 0.0% | 9927 | 17474 | 17508 |

## Judgment (priority order)

### 1. falseAcceptRate
- A (baseline): **0.6522**
- B (adaptive): **0.7143**
- A→B: false accept **did not improve** (B higher / still very high). S4 retry recovers some sessions but does not reduce first-attempt false accepts.

### 2. eventualSessionSuccess
- A: **26.7%**
- B: **36.7%**
- B eventual success ↑ vs A (adaptive recovery helped session success).

### 3. retryRecoveryRate
- B: **0.2692** (7/26)
- Positive but modest; many retries still fail / stop after budget.

### 4. Latency
- A P95≈845.6ms; B P95≈1640.4ms (≈2× attempts).
- C/D VLM tier: P95 jumps when VLM fires (C P95≈7004.0ms).

### 5. VLM net benefit (C/D only, N=5 exploratory)
- C vlmInvoke=1, recovery=0
- D vlmInvoke=3, recovery=0
- No clear VLM recovery in this small sample; treat as **not mixing into A/B baseline**.

## Conclusion

```text
session success ↑     (A→B yes)
false accept ↓        (A→B NO — still primary bottleneck)
retry recovery ↑      (B has ~27% recovery when retry used)
latency 可控          (A/B OK without VLM; VLM separate & costly)
```

**Next focus (not S6):** evidence / decision calibration / failure classification — reduce ACCEPT of wrong text before expanding profiles or VLM.

## Report files
- A: `captcha_ocr_bench_20260815T065801Z.json` / `captcha_ocr_bench_20260815T065801Z.md`
- B: `captcha_ocr_bench_20260815T065837Z.json` / `captcha_ocr_bench_20260815T065837Z.md`
- C: `captcha_ocr_bench_20260815T065930Z.json` / `captcha_ocr_bench_20260815T065930Z.md`
- D: `captcha_ocr_bench_20260815T065948Z.json` / `captcha_ocr_bench_20260815T065948Z.md`
