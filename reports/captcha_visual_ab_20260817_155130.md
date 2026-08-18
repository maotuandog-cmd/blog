# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=8 fusion=shadow (not live)

## Summary

| 实验 | 首试准确率 | char-acc | crop_cut | 平均耗时 | abstain | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 YOLO+OCR baseline | 62.5% | 92.9% | 0 | 2565ms | 87.5% | 1 | 2 |
| C1 expand crop | 75.0% | 95.2% | 0 | 2059ms | 87.5% | 0 | 2 |

## C0 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 100.0% (42/42) |
| bbox detection precision | 100.0% (42/42) |
| bbox数量准确率 (n==len) | 100.0% |
| character-level accuracy | 92.9% (39/42) |
| 首试准确率 (full string) | 62.5% |
| crop_cut failures | 0 |
| 平均耗时 | 2565ms |

## C1 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 100.0% (42/42) |
| bbox detection precision | 100.0% (42/42) |
| bbox数量准确率 (n==len) | 100.0% |
| character-level accuracy | 95.2% (40/42) |
| 首试准确率 (full string) | 75.0% |
| crop_cut failures | 0 |
| 平均耗时 | 2059ms |

## Failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| C0:ocr_partial_wrong | 3 | 60.0% |
| C1:ocr_partial_wrong | 2 | 40.0% |

Notes: **FUSION stays shadow**; **C4 never live-applies**. C0 always available via `c0Text` / `HERMES_CAPTCHA_CHAR_PIPELINE=c0`. Prefer RETRY over forced PASS.
