# E1-D.1：Agree Bonus Stability Validation

**范围**：只比较 `evidenceScoreRaw` vs `evidenceScoreAdjusted`；不改 threshold / retry / VLM / bonus 幅度。

- sources: `E1-D1-agree-stability`
- rounds=120 ACCEPT=26 (true=13, FA=13)
- agree coverage=0.0769 (2/26)
- FA∩agree=**0**

## Separation

| | trueMean | faMean | gap | AUC | PR-AUC |
|-|---------|-------:|----:|----:|-------:|
| raw | 0.7015 | 0.6797 | 0.0218 | 0.5533 | 0.6693 |
| adjusted | 0.7168 | 0.6797 | 0.0371 | 0.5651 | 0.6723 |
| Δ |  |  | 0.0153 | 0.0118 | 0.003 |

## Top-k precision

| | top50 precision | top50 FAR | top75 precision |
|-|----------------:|----------:|----------------:|
| raw | 0.4615 | 0.5385 | 0.6 |
| adjusted | 0.5385 | 0.4615 | 0.6 |

## Agree samples

| outcome | text | raw | adj | secondary |
|---------|------|----:|----:|-----------|
| correct | `oesrrs` | 0.6455 | 0.7455 | `oesRRs` |
| correct | `4cfgoe` | 0.8607 | 0.9607 | `4cFGoe` |

## 裁决

**情况 B** — FA∩agree=0 but coverage still low → keep optional evidence boost; do NOT enter Decision Calibration

### 判据回顾

| 情况 | 条件 | 下一步 |
|------|------|--------|
| A | 覆盖↑ + FA≈0 + precision/分离↑ | 可讨论 Decision Calibration |
| B | FA低但覆盖极低 | 保持 optional boost；不进 Calibration |

继续冻结：不调 bonus 值 / 不加 conflict 惩罚 / 不改 threshold / 不扩 VLM / 不改 retry。

```json
{
  "bonusValueUnchanged": true,
  "conflictPenalty": false,
  "thresholdChanged": false,
  "decisionCalibration": false
}
```

## 附录：与 C2-B 合并池（跨 session 复核）

| 项 | 值 |
|----|---:|
| ACCEPT | 61 |
| agree coverage | 0.1311 (8) |
| FA∩agree | 0 |
| raw → adj gap | 0.002 → 0.0225 |
| ΔAUC / ΔPR-AUC | 0.0373 / 0.0163 |
| top50 precision raw→adj | 0.6 → 0.6 |
| **合并裁决** | **B** |

合并池同样 **情况 B**：安全（FA∩agree=0）且有小幅分离收益，但 agree 覆盖仍低（13%），**不足以进入 Decision Calibration**。

```text
E1-D Agree Bonus     ✅ keep optional
E1-D.1               ✅ 情况 B
Decision Calibration ⏸
```
