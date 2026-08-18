# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| C0 YOLO+OCR baseline | 60.5% | 87.6% | - | - | 1815ms |
| C3-3 Top-3 (shadow) | 60.0% | 90.1% | 93.4% | 93.6% | 1749ms |

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
| 平均耗时 | 1815ms |

## C3-3 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character Top-1 accuracy | 90.1% (1001/1111) |
| oracle char Top-1 | 90.3% |
| oracle char Top-2 recall | 93.4% |
| oracle char Top-3 recall | 93.6% |
| oracle whole-string Top-2 | 73.0% |
| oracle whole-string Top-3 | 74.0% |
| avg candidate_set_size | 1.26 |
| avg top1_score | 0.925 |
| avg top1−top2 margin | 0.859 |
| avg candidate_entropy | 0.149 |
| low_margin_rate (<0.15) | 3.6% |
| 整串 Top-1 (provisional) | 60.0% |
| crop_cut failures | 3 |
| ocr_partial_wrong | 69 |
| 平均耗时 | 1749ms |

## Failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| C3-3:ocr_partial_wrong | 69 | 43.4% |
| C0:ocr_partial_wrong | 58 | 36.5% |
| C0:bbox_crop_cut | 15 | 9.4% |
| C0:yolo_under_detect | 4 | 2.5% |
| C3-3:yolo_under_detect | 4 | 2.5% |
| C3-3:ocr_wrong | 4 | 2.5% |
| C3-3:bbox_crop_cut | 3 | 1.9% |
| C0:ocr_wrong | 2 | 1.3% |

Notes: **C3 actual=C0 (shadow only)** — does not change submit. **FUSION stays shadow**; **C4 never live-applies**. Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.
