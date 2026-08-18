# E1-D：independentAgree Soft Bonus

**范围**：仅 `independentAgree` 正向 bonus；**禁止** conflict/char/weak|conflict 惩罚；**不改** threshold。

- bonus=0.1
- rounds=140 ACCEPT=35
- coverage unchanged: **True**
- FA ∩ agree: **0** (safety zero=True)
- true ∩ agree: **6**

## Score distributions (ACCEPT pool)

| | trueMean | faMean | gap | AUC |
|-|---------|:-------:|----:|----:|
| baseline | 0.6792 | 0.6917 | -0.0125 | 0.4402 |
| +agree bonus | 0.7022 | 0.6917 | 0.0105 | 0.4979 |

## Top-k precision (same coverage)

| | top50 precision | top50 FAR |
|-|----------------:|----------:|
| baseline | 0.7222 | 0.2778 |
| adjusted | 0.7222 | 0.2778 |

## Agree samples (moved by +bonus)

| outcome | text | baseline | adjusted | secondary |
|---------|------|---------:|---------:|-----------|
| correct | `nxkoh5` | 0.6455 | 0.7455 | `NxKoH5` |
| correct | `dvee42` | 0.6455 | 0.7455 | `dveE=42` |
| correct | `bn3xkz` | 0.6455 | 0.7455 | `BN3xKz` |
| correct | `jbw64j` | 0.6984 | 0.7984 | `Jbw64J` |
| correct | `gdhyyx` | 0.5 | 0.6 | `gdhyyx` |
| correct | `jyhu8k` | 0.8607 | 0.9607 | `jyHu8K` |

## FA moved

- **none** (FA+agree remains 0 — safety hold)

## Online wiring

```text
decision.independentAgreeBonus: true
decision.agreeBonus: 0.1
# or HERMES_CAPTCHA_AGREE_BONUS=1
```

Frozen non-goals:

```json
{
  "independentAgreeBonus": true,
  "conflictPenalty": false,
  "charRiskPenalty": false,
  "weakConflictPenalty": false,
  "thresholdChanged": false
}
```

## Verdict

- Soft agree bonus improves separation gap without promoting any FA in this pool.
- Top-k precision may stay flat (coverage-limited); primary gain is mean separation.
- **Do not** enter Decision Calibration / threshold tuning yet.
- Next gate for broader E1-D: more agree coverage + Candidate texts on abstain path.

