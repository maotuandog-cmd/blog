# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 首试准确率 | char-acc | crop_cut | 平均耗时 | abstain | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 YOLO+OCR baseline | 60.5% | 87.6% | 15 | 1857ms | 75.5% | 19 | 60 |
| C1 expand crop | 56.5% | 88.2% | 5 | 1701ms | 75.5% | 18 | 69 |

## C0 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character-level accuracy | 87.6% (972/1110) |
| 首试准确率 (full string) | 60.5% |
| crop_cut failures | 15 |
| 平均耗时 | 1857ms |

## C1 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character-level accuracy | 88.2% (980/1111) |
| 首试准确率 (full string) | 56.5% |
| crop_cut failures | 5 |
| 平均耗时 | 1701ms |

## Failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| C1:ocr_partial_wrong | 71 | 42.8% |
| C0:ocr_partial_wrong | 58 | 34.9% |
| C0:bbox_crop_cut | 15 | 9.0% |
| C1:ocr_wrong | 7 | 4.2% |
| C1:bbox_crop_cut | 5 | 3.0% |
| C0:yolo_under_detect | 4 | 2.4% |
| C1:yolo_under_detect | 4 | 2.4% |
| C0:ocr_wrong | 2 | 1.2% |

Notes: **FUSION stays shadow**; **C4 never live-applies**. C0 always available via `c0Text` / `HERMES_CAPTCHA_CHAR_PIPELINE=c0`. Prefer RETRY over forced PASS.
