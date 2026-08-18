# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C4 char Fusion shadow | 44.5% | - | - | - | 4862ms |
| C5-R risk gate shadow | 27.5% | - | - | - | 2405ms |

## C4 shadow recovery matrix (vs GT)

|  | C4 PASS | C4 RETRY |
| --- | ---: | ---: |
| C0 正确 | 86 | 35 |
| C0 错误 | 34 | 45 |

| metric | value |
| --- | ---: |
| PASS rate | 60.0% (120/200) |
| PASS precision | 74.2% |
| whole-string (PASS=submit) | 44.5% |
| true rescue | 5 |
| break correct | 2 |
| PASS but GT wrong (FP) | 31 |
| retry rate | 40.0% |
| avg latency | 4862ms |
| minMargin / minAgree | 0.35 / 0.50 |

## C5 shadow recovery matrix (vs GT)

|  | C5 PASS | C5 RETRY |
| --- | ---: | ---: |
| C0 正确 | 52 | 69 |
| C0 错误 | 13 | 66 |

| metric | value |
| --- | ---: |
| PASS rate | 32.5% (65/200) |
| PASS precision | 84.6% |
| whole-string (PASS=submit) | 27.5% |
| true rescue | 3 |
| break correct | 0 |
| PASS but GT wrong (FP) | 10 |
| retry rate | 67.5% |
| avg latency | 2405ms |
| minMargin / minAgree | 0.35 / 0.50 |
| C5 trigger samples | 135/200 (67.5%) |
| C5 trigger events | 219 |
| C5 trigger precision (dangerous/trigger) | 56.2% (123/219) |
| C5 blocked FP (C4 would FP → C5 RETRY) | 21 |
| C5 remaining FP | 10 |

### C5 trigger by riskType (trigger → dangerous)

| riskType | triggers | dangerous | precision |
| --- | ---: | ---: | ---: |
| KNOWN_CONFUSION | 109 | 13 | 11.9% |
| LOW_MARGIN | 59 | 59 | 100.0% |
| UNSTABLE | 43 | 43 | 100.0% |
| ILLEGAL_CHAR | 8 | 8 | 100.0% |

## C4 → C5-R FP delta

| metric | C4 | C5-R | Δ |
| --- | ---: | ---: | ---: |
| FP | 31 | 10 | -21 |
| blocked FP | - | 21 | - |
| true rescue | 5 | 3 | -2 |
| break correct | 2 | 0 | -2 |
| PASS rate | 60.0% | 32.5% | - |
| retry | 40.0% | 67.5% | - |

### FP position reasons (shadow PASS ∧ glyph≠GT)

wrong glyphs attributed: 47

| reason | count | share |
| --- | ---: | ---: |
| HIGH_CONF | 27 | 57.4% |
| HIGH_MARGIN | 20 | 42.6% |

### Confusion matrix (FP glyphs: GT → OCR)

| GT → OCR | all FP | HIGH_CONF only |
| --- | ---: | ---: |
| `H→B` | 3 | 1 |
| `V→Y` | 3 | 1 |
| `9→D` | 2 | 2 |
| `A→4` | 2 | 0 |
| `B→Q` | 2 | 0 |
| `D→Z` | 2 | 2 |
| `E→C` | 2 | 2 |
| `E→L` | 2 | 0 |
| `F→9` | 2 | 2 |
| `L→T` | 2 | 2 |
| `M→I` | 2 | 2 |
| `S→8` | 2 | 0 |
| `T→K` | 2 | 2 |
| `V→W` | 2 | 1 |
| `Z→N` | 2 | 2 |
| `6→D` | 1 | 1 |
| `8→C` | 1 | 1 |
| `B→K` | 1 | 1 |
| `G→C` | 1 | 0 |
| `H→A` | 1 | 0 |
| `I→至` | 1 | 1 |
| `J→1` | 1 | 0 |
| `J→8` | 1 | 1 |
| `L→长` | 1 | 1 |
| `R→K` | 1 | 0 |
| `S→Y` | 1 | 1 |
| `U→通` | 1 | 0 |
| `X→义` | 1 | 1 |
| `Z→U` | 1 | 0 |
| `Z→云` | 1 | 0 |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
