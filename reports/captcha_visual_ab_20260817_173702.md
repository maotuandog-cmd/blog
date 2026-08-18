# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C0 YOLO+OCR baseline | 60.5% | 87.6% | - | - | 2619ms |
| C4 char Fusion shadow | 48.0% | - | - | - | 4126ms |

## C0 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character Top-1 accuracy | 87.6% (972/1110) |
| 整串 Top-1 (provisional) | 60.5% |
| crop_cut failures | 15 |
| ocr_partial_wrong | 58 |
| 平均耗时 | 2619ms |

## Failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| C0:ocr_partial_wrong | 58 | 73.4% |
| C0:bbox_crop_cut | 15 | 19.0% |
| C0:yolo_under_detect | 4 | 5.1% |
| C0:ocr_wrong | 2 | 2.5% |

## C4 shadow recovery matrix (vs GT)

|  | C4 PASS | C4 RETRY |
| --- | ---: | ---: |
| C0 正确 | 91 | 30 |
| C0 错误 | 46 | 33 |

| metric | value |
| --- | ---: |
| C4 PASS rate | 68.5% (137/200) |
| C4 accuracy among PASS | 70.1% |
| C4 whole-string (PASS=submit, RETRY=miss) | 48.0% |
| true rescue (C0错→C4 PASS且对) | 7 |
| break correct (C0对→C4 PASS且错) | 2 |
| C4 PASS but GT wrong (FP) | 41 |
| retry/abstain rate | 31.5% |
| avg latency | 4126ms |

### C4 string gate reasons

| reason | count |
| --- | ---: |
| ALL_PASS | 137 |
| UNSTABLE@1 | 11 |
| LOW_MARGIN@3 | 8 |
| LOW_MARGIN@1 | 7 |
| UNSTABLE@2 | 6 |
| UNSTABLE@0 | 6 |
| LOW_MARGIN@5 | 5 |
| UNSTABLE@3 | 4 |
| LOW_MARGIN@2 | 3 |
| LOW_MARGIN@4 | 3 |
| UNSTABLE@4 | 3 |
| LOW_MARGIN@0 | 2 |
| EMPTY@3 | 2 |
| UNSTABLE@5 | 1 |
| EMPTY@4 | 1 |
| EMPTY@0 | 1 |

### C4 per-position decision reasons

| reason | count |
| --- | ---: |
| HIGH_CONF | 853 |
| HIGH_MARGIN | 182 |
| UNSTABLE | 36 |
| LOW_MARGIN | 33 |
| EMPTY | 7 |

### Decision-presence matrix (non-GT; has text)

| cell | count |
| --- | ---: |
| C0_PASS_C4_PASS | 137 |
| C0_PASS_C4_RETRY | 63 |

| shadowDelta | count |
| --- | ---: |
| agree | 120 |
| conflict_text | 17 |
| shadow_stricter | 63 |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
