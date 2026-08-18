# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C4 char Fusion shadow | 44.5% | - | - | - | 5817ms |

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
| avg latency | 5817ms |
| minMargin / minAgree | 0.35 / 0.50 |

### FP position reasons (C4 PASS ∧ glyph≠GT)

wrong glyphs attributed: 35

| reason | count | share |
| --- | ---: | ---: |
| HIGH_CONF | 19 | 54.3% |
| HIGH_MARGIN | 16 | 45.7% |

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
