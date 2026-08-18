# Captcha char pipeline C0–C4 (P3)

dataset=captcha-solver/datasets/demo_char_detect n=200 fusion=shadow (not live)

## Summary

| 实验 | 首试准确率 | char-acc | ocr_partial | crop_cut | 平均耗时 | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 YOLO+OCR baseline | 60.5% | 87.6% | 58 | 15 | 1596ms | 19 | 60 |
| C2 multi-view | 60.0% | 90.1% | 69 | 3 | 2665ms | 16 | 64 |

## C0 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character-level accuracy | 87.6% (972/1110) |
| 首试准确率 (full string) | 60.5% |
| crop_cut failures | 15 |
| ocr_partial_wrong | 58 |
| 平均耗时 | 1596ms |

## C2 metrics

| 指标 | value |
| --- | ---: |
| bbox detection recall | 99.6% (1104/1108) |
| bbox detection precision | 99.4% (1104/1111) |
| bbox数量准确率 (n==len) | 96.0% |
| character-level accuracy | 90.1% (1001/1111) |
| 首试准确率 (full string) | 60.0% |
| crop_cut failures | 3 |
| ocr_partial_wrong | 69 |
| 平均耗时 | 2665ms |

## C0 → C2 position rescue (partial OCR)

| metric | count |
| --- | ---: |
| positions compared | 1108 |
| C0❌ → C2✓ (rescue) | 45 |
| C0✓ → C2❌ (regress) | 16 |
| both wrong | 91 |
| both ok | 956 |
| net position Δ (rescue−regress) | +29 |
| string C0❌→C2✓ | 13 |
| string C0✓→C2❌ | 14 |

### Rescue examples (up to 25)

| id | pos | GT | C0 | C2 | C0 full | C2 full |
| --- | ---: | --- | --- | --- | --- | --- |
| demo_00833 | 0 | C | D | C | `DFZE5` | `CFEZA5` |
| demo_00833 | 3 | Z | E | Z | `DFZE5` | `CFEZA5` |
| demo_00833 | 5 | 5 | ∅ | 5 | `DFZE5` | `CFEZA5` |
| demo_00808 | 2 | E | P | E | `OCPX` | `OCEX` |
| demo_00997 | 3 | Z | E | Z | `BWZE` | `BWKZE` |
| demo_00997 | 4 | E | ∅ | E | `BWZE` | `BWKZE` |
| demo_00885 | 2 | X | K | X | `SXKMW` | `S忘XKMW` |
| demo_00885 | 4 | M | W | M | `SXKMW` | `S忘XKMW` |
| demo_00839 | 1 | S | 8 | S | `U8W7YB` | `USW7YB` |
| demo_00890 | 3 | H | 灰 | H | `C少N灰G` | `C少NHXG` |
| demo_00890 | 4 | X | G | X | `C少N灰G` | `C少NHXG` |
| demo_00890 | 5 | G | ∅ | G | `C少N灰G` | `C少NHXG` |
| demo_00828 | 3 | U | W | U | `R7UWN` | `R77UWG` |
| demo_00828 | 4 | W | N | W | `R7UWN` | `R77UWG` |
| demo_00828 | 5 | G | ∅ | G | `R7UWN` | `R77UWG` |
| demo_00944 | 3 | J | P | J | `P7EPX` | `P7EJPX` |
| demo_00944 | 4 | P | X | P | `P7EPX` | `P7EJPX` |
| demo_00944 | 5 | X | ∅ | X | `P7EPX` | `P7EJPX` |
| demo_00926 | 1 | J | U | J | `4UL7S` | `4JUL7S` |
| demo_00926 | 2 | U | L | U | `4UL7S` | `4JUL7S` |
| demo_00926 | 3 | L | 7 | L | `4UL7S` | `4JUL7S` |
| demo_00926 | 4 | 7 | S | 7 | `4UL7S` | `4JUL7S` |
| demo_00926 | 5 | S | ∅ | S | `4UL7S` | `4JUL7S` |
| demo_00999 | 3 | J | 几 | J | `EME几B` | `EMEJB` |
| demo_00911 | 2 | A | B | A | `SUB4N` | `SUAB4N` |

## Failure taxonomy (wrong full-string)

| reason | count | share of failures |
| --- | ---: | ---: |
| C2:ocr_partial_wrong | 69 | 43.4% |
| C0:ocr_partial_wrong | 58 | 36.5% |
| C0:bbox_crop_cut | 15 | 9.4% |
| C0:yolo_under_detect | 4 | 2.5% |
| C2:yolo_under_detect | 4 | 2.5% |
| C2:ocr_wrong | 4 | 2.5% |
| C2:bbox_crop_cut | 3 | 1.9% |
| C0:ocr_wrong | 2 | 1.3% |

Notes: **FUSION stays shadow**; **C4 never live-applies**. C0 always available via `c0Text` / `HERMES_CAPTCHA_CHAR_PIPELINE=c0`. Prefer RETRY over forced PASS.
