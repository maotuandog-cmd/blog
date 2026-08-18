# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C4 char Fusion shadow | 44.5% | - | - | - | 7425ms |

## C4 shadow recovery matrix (vs GT)

|  | C4 PASS | C4 RETRY |
| --- | ---: | ---: |
| C0 正确 | 86 | 35 |
| C0 错误 | 34 | 45 |

| metric | value |
| --- | ---: |
| C4 PASS rate | 60.0% (120/200) |
| C4 accuracy among PASS | 74.2% |
| C4 whole-string (PASS=submit, RETRY=miss) | 44.5% |
| true rescue (C0错→C4 PASS且对) | 5 |
| break correct (C0对→C4 PASS且错) | 2 |
| C4 PASS but GT wrong (FP) | 31 |
| retry/abstain rate | 40.0% |
| avg latency | 7425ms |
| minMargin / minAgree | 0.35 / 0.75 |

### FP position reasons (C4 PASS ∧ glyph≠GT)

wrong glyphs attributed: 35

| reason | count | share |
| --- | ---: | ---: |
| HIGH_CONF | 19 | 54.3% |
| HIGH_MARGIN | 16 | 45.7% |

### Confusion matrix (FP glyphs: GT → OCR)

| GT → OCR | all FP | HIGH_CONF only |
| --- | ---: | ---: |
| `H→B` | 3 | 1 |
| `V→Y` | 3 | 1 |
| `V→W` | 2 | 1 |
| `6→D` | 1 | 1 |
| `8→C` | 1 | 1 |
| `9→D` | 1 | 1 |
| `B→K` | 1 | 1 |
| `D→Z` | 1 | 1 |
| `E→C` | 1 | 1 |
| `F→9` | 1 | 1 |
| `I→至` | 1 | 1 |
| `J→8` | 1 | 1 |
| `L→T` | 1 | 1 |
| `L→长` | 1 | 1 |
| `M→I` | 1 | 1 |
| `S→Y` | 1 | 1 |
| `T→K` | 1 | 1 |
| `X→义` | 1 | 1 |
| `Z→N` | 1 | 1 |
| `A→4` | 1 | 0 |
| `B→Q` | 1 | 0 |
| `E→L` | 1 | 0 |
| `G→C` | 1 | 0 |
| `H→A` | 1 | 0 |
| `J→1` | 1 | 0 |
| `R→K` | 1 | 0 |
| `S→8` | 1 | 0 |
| `U→通` | 1 | 0 |
| `Z→U` | 1 | 0 |
| `Z→云` | 1 | 0 |

HIGH_CONF FP glyphs: 19 / 35 (54.3% of wrong glyphs)

### C4 string gate reasons

| reason | count |
| --- | ---: |
| ALL_PASS | 120 |
| LOW_MARGIN@3 | 16 |
| LOW_MARGIN@1 | 12 |
| UNSTABLE@1 | 11 |
| LOW_MARGIN@2 | 8 |
| UNSTABLE@2 | 6 |
| UNSTABLE@0 | 6 |
| LOW_MARGIN@4 | 4 |
| LOW_MARGIN@5 | 4 |
| LOW_MARGIN@0 | 3 |
| UNSTABLE@4 | 3 |
| UNSTABLE@3 | 3 |
| UNSTABLE@5 | 1 |
| EMPTY@3 | 1 |
| EMPTY@4 | 1 |
| EMPTY@0 | 1 |

### C4 per-position decision reasons

| reason | count |
| --- | ---: |
| HIGH_CONF | 853 |
| HIGH_MARGIN | 156 |
| LOW_MARGIN | 59 |
| UNSTABLE | 36 |
| EMPTY | 7 |

### Decision-presence matrix (non-GT; has text)

| cell | count |
| --- | ---: |
| C0_PASS_C4_PASS | 120 |
| C0_PASS_C4_RETRY | 80 |

| shadowDelta | count |
| --- | ---: |
| agree | 109 |
| conflict_text | 11 |
| shadow_stricter | 80 |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
