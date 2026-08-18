# Captcha visual A/B (P2.4)

dataset=/home/u26/hermes/captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 首试准确率 | 4位 | 5位 | 6位 | 平均耗时 | abstain | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A raw OCR | 16.0% | 35.5% | 16.7% | 11.5% | 1910ms | 75.5% | 17 | 151 |
| B preprocess OCR | 16.0% | 35.5% | 16.7% | 11.5% | 1736ms | 75.5% | 17 | 151 |
| C YOLO+OCR | 57.0% | 61.3% | 63.3% | 54.7% | 1706ms | 75.5% | 21 | 65 |
| D YOLO+VLM | 16.0% | 35.5% | 16.7% | 11.5% | 1874ms | 75.5% | 17 | 151 |
| E Fusion shadow | 56.0% | 58.1% | 66.7% | 53.2% | 1716ms | 8.0% | 72 | 16 |

## Length: A vs C

| length | A | C | C−A |
| --- | ---: | ---: | ---: |
| 4 | 35.5% (11/31) | 61.3% (19/31) | +25.8pp |
| 5 | 16.7% (5/30) | 63.3% (19/30) | +46.7pp |
| 6 | 11.5% (16/139) | 54.7% (76/139) | +43.2pp |

## C metrics (YOLO + OCR)

| 指标 | C |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character-level accuracy | 85.9% (954/1111) |
| 首试准确率 (full string) | 57.0% |
| 平均耗时 | 1706ms |

## C failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| ocr_partial_wrong | 57 | 66.3% |
| bbox_crop_cut | 19 | 22.1% |
| ocr_wrong | 6 | 7.0% |
| yolo_under_detect | 4 | 4.7% |

## Shadow delta (arm E)

| delta | count |
| --- | ---: |
| agree | 32 |
| conflict_text | 5 |
| shadow_looser | 149 |
| shadow_stricter | 14 |

## Per-source accuracy (arm E)

| source | accuracy |
| --- | ---: |
| raw_ocr | 60.4% (32/53) |
| yolo_ocr | 57.0% (114/200) |

Notes: **FUSION stays shadow** — do not enable live Fusion until FP analyzed. C failure taxonomy is primary-bucket (one reason per sample).
