# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C5-R′ risk gate (Top-2 confusion) | 44.5% | - | - | - | 4028ms |

## C5 shadow recovery matrix (vs GT)

|  | C5 PASS | C5 RETRY |
| --- | ---: | ---: |
| C0 正确 | 85 | 36 |
| C0 错误 | 27 | 52 |

| metric | value |
| --- | ---: |
| PASS rate | 56.0% (112/200) |
| PASS precision | 79.5% |
| whole-string (PASS=submit) | 44.5% |
| true rescue | 5 |
| break correct | 1 |
| PASS but GT wrong (FP) | 23 |
| retry rate | 44.0% |
| avg latency | 4028ms |
| minMargin / minAgree | 0.35 / 0.50 |
| C5 trigger samples | 88/200 (44.0%) |
| C5 trigger events | 112 |
| C5 trigger precision (dangerous/trigger) | 100.0% (112/112) |
| C5 blocked FP (C4 would FP → C5 RETRY) | 8 |
| C5 remaining FP | 23 |

### C5 trigger by riskType (trigger → dangerous)

| riskType | triggers | dangerous | precision |
| --- | ---: | ---: | ---: |
| LOW_MARGIN | 59 | 59 | 100.0% |
| UNSTABLE | 43 | 43 | 100.0% |
| ILLEGAL_CHAR | 8 | 8 | 100.0% |
| KNOWN_CONFUSION | 2 | 2 | 100.0% |

### FP position reasons (shadow PASS ∧ glyph≠GT)

wrong glyphs attributed: 27

| reason | count | share |
| --- | ---: | ---: |
| HIGH_CONF | 16 | 59.3% |
| HIGH_MARGIN | 11 | 40.7% |

### Confusion matrix (FP glyphs: GT → OCR)

| GT → OCR | all FP | HIGH_CONF only |
| --- | ---: | ---: |
| `H→B` | 2 | 1 |
| `V→W` | 2 | 1 |
| `V→Y` | 2 | 1 |
| `6→D` | 1 | 1 |
| `8→C` | 1 | 1 |
| `9→D` | 1 | 1 |
| `A→4` | 1 | 0 |
| `B→K` | 1 | 1 |
| `B→Q` | 1 | 0 |
| `D→Z` | 1 | 1 |
| `E→C` | 1 | 1 |
| `E→L` | 1 | 0 |
| `F→9` | 1 | 1 |
| `G→C` | 1 | 0 |
| `H→A` | 1 | 0 |
| `J→8` | 1 | 1 |
| `L→T` | 1 | 1 |
| `M→I` | 1 | 1 |
| `R→K` | 1 | 0 |
| `S→8` | 1 | 0 |
| `S→Y` | 1 | 1 |
| `T→K` | 1 | 1 |
| `Z→N` | 1 | 1 |
| `Z→U` | 1 | 0 |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
