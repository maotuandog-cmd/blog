# F1 False-ACCEPT Attribution (captcha_ocr_bench_20260815T065801Z.json)

- totalAttributedAccepts: 23
- totalFalseAccepts: **15**
- topClass: **CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 13 | 65.0% | 86.7% |
| `SINGLETON_ACCEPT` | 3 | 2 | 66.7% | 13.3% |

## Recommendation for F2
Largest false-accept share → **CORRELATED_VOTES** — calibrate Decision gate / evidence correlation before OCR changes.

