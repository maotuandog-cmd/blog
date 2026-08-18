# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C5-R″-O L1 observe + C5-R′ | 16.0% | - | - | - | 2334ms |

## C5O shadow recovery matrix (vs GT)

|  | C5O PASS | C5O RETRY |
| --- | ---: | ---: |
| C0 正确 | 0 | 0 |
| C0 错误 | 49 | 151 |

| metric | value |
| --- | ---: |
| PASS rate | 24.5% (49/200) |
| PASS precision | 65.3% |
| whole-string (PASS=submit) | 16.0% |
| true rescue | 32 |
| break correct | 0 |
| PASS but GT wrong (FP) | 17 |
| retry rate | 75.5% |
| avg latency | 2334ms |
| minMargin / minAgree | 0.35 / 0.50 |
| C5 trigger samples | 0/200 (0.0%) |
| C5 trigger events | 0 |
| C5 trigger precision (dangerous/trigger) | 0.0% (0/0) |
| C5 blocked FP (C4 would FP → C5 RETRY) | 0 |
| C5 remaining FP | 17 |

### C5 trigger by riskType (trigger → dangerous)

| riskType | triggers | dangerous | precision |
| --- | ---: | ---: | ---: |

## C5-R″-O L1 observe (shadow only)

| metric | value |
| --- | ---: |
| L1 trigger samples | 0/200 (0.0%) |
| L1 trigger events | 0 |
| L1 precision (dangerous/L1) | 0.0% (0/0) |
| L1 FP coverage (remaining FP hit) | 0.0% (0/17) |

### Shadow simulate: if L1 → RETRY (whole string)

| metric | C5-R′ shadow | sim L1→RETRY | Δ |
| --- | ---: | ---: | ---: |
| FP | 17 | 17 | -0 |
| retry add (samples) | - | 0 | - |
| break correct | 0 | 0 | +0 |

Frozen C5-R′ reference: FP≈23, retry≈44%, KNOWN_CONFUSION precision=100%.

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
