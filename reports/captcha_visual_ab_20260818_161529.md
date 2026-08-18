# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C5-R″-O L1 observe + C5-R′ | 36.0% | - | - | - | 4054ms |

## C5O shadow recovery matrix (vs GT)

|  | C5O PASS | C5O RETRY |
| --- | ---: | ---: |
| C0 正确 | 75 | 46 |
| C0 错误 | 31 | 48 |

| metric | value |
| --- | ---: |
| PASS rate | 53.0% (106/200) |
| PASS precision | 67.9% |
| whole-string (PASS=submit) | 36.0% |
| true rescue | 5 |
| break correct | 8 |
| PASS but GT wrong (FP) | 34 |
| retry rate | 47.0% |
| avg latency | 4054ms |
| minMargin / minAgree | 0.35 / 0.50 |
| C5 trigger samples | 94/200 (47.0%) |
| C5 trigger events | 126 |
| C5 trigger precision (dangerous/trigger) | 100.0% (126/126) |
| C5 blocked FP (C4 would FP → C5 RETRY) | 8 |
| C5 remaining FP | 34 |

### C5 trigger by riskType (trigger → dangerous)

| riskType | triggers | dangerous | precision |
| --- | ---: | ---: | ---: |
| UNSTABLE | 115 | 115 | 100.0% |
| ILLEGAL_CHAR | 11 | 11 | 100.0% |

## C5-R″-O L1 observe (shadow only)

| metric | value |
| --- | ---: |
| L1 trigger samples | 80/200 (40.0%) |
| L1 trigger events | 112 |
| L1 precision (dangerous/L1) | 14.3% (16/112) |
| L1 FP coverage (remaining FP hit) | 26.5% (9/34) |

### Shadow simulate: if L1 → RETRY (whole string)

| metric | C5-R′ shadow | sim L1→RETRY | Δ |
| --- | ---: | ---: | ---: |
| FP | 34 | 15 | -19 |
| retry add (samples) | - | 46 | - |
| break correct | 8 | 35 | +27 |

Frozen C5-R′ reference: FP≈23, retry≈44%, KNOWN_CONFUSION precision=100%.

### FP position reasons (shadow PASS ∧ glyph≠GT)

wrong glyphs attributed: 40

| reason | count | share |
| --- | ---: | ---: |
| HIGH_CONF | 40 | 100.0% |

### Confusion matrix (FP glyphs: GT → OCR)

| GT → OCR | all FP | HIGH_CONF only |
| --- | ---: | ---: |
| `H→B` | 3 | 3 |
| `V→Y` | 3 | 3 |
| `G→6` | 2 | 2 |
| `G→C` | 2 | 2 |
| `V→W` | 2 | 2 |
| `6→D` | 1 | 1 |
| `8→C` | 1 | 1 |
| `9→D` | 1 | 1 |
| `A→4` | 1 | 1 |
| `B→Q` | 1 | 1 |
| `C→E` | 1 | 1 |
| `D→Q` | 1 | 1 |
| `D→Z` | 1 | 1 |
| `F→9` | 1 | 1 |
| `F→P` | 1 | 1 |
| `H→2` | 1 | 1 |
| `H→A` | 1 | 1 |
| `I→L` | 1 | 1 |
| `J→8` | 1 | 1 |
| `L→D` | 1 | 1 |
| `L→E` | 1 | 1 |
| `M→7` | 1 | 1 |
| `M→I` | 1 | 1 |
| `R→K` | 1 | 1 |
| `R→X` | 1 | 1 |
| `S→8` | 1 | 1 |
| `S→Y` | 1 | 1 |
| `T→F` | 1 | 1 |
| `T→R` | 1 | 1 |
| `V→N` | 1 | 1 |
| `Z→7` | 1 | 1 |
| `Z→N` | 1 | 1 |
| `Z→U` | 1 | 1 |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
