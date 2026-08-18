# Captcha visual A/B

dataset=/home/u26/hermes/captcha-solver/datasets/demo_char_detect n=50

| 实验 | 首试准确率 | 4位 | 5位 | 6位 | 平均耗时 | abstain | retry | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A raw OCR | 10.0% | 25.0% | 0.0% | 8.6% | 1848ms | 86.0% | - | 2 | 43 |
| B preprocess OCR | 10.0% | 25.0% | 0.0% | 8.6% | 1873ms | 86.0% | - | 2 | 43 |
| C YOLO+OCR | 52.0% | 62.5% | 57.1% | 48.6% | 2148ms | 86.0% | - | 6 | 18 |
| D YOLO+VLM | 10.0% | 25.0% | 0.0% | 8.6% | 1666ms | 86.0% | - | 2 | 43 |
| E Fusion | 52.0% | 62.5% | 57.1% | 48.6% | 1784ms | 8.0% | - | 20 | 4 |

Notes: E scores **shadow** fusion (HERMES_CAPTCHA_FUSION=shadow); actual solved path unchanged. FP=submitted/shadow-pass but wrong; FN=no text. C/D require HERMES_CAPTCHA_YOLO_WEIGHTS. S0 never gates.

## Shadow delta (arm E)

| delta | count |
| --- | ---: |
| agree | 3 |
| shadow_looser | 43 |
| shadow_stricter | 4 |

## Per-source accuracy (from arm E candidates)

| source | accuracy |
| --- | ---: |
| raw_ocr | 62.5% (5/8) |
| yolo_ocr | 52.0% (26/50) |
