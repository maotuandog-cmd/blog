# F1 False-ACCEPT Attribution (captcha_ocr_bench_20260815T065837Z.json)

- totalAttributedAccepts: 14
- totalFalseAccepts: **10**
- topClass: **CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 9 | 5 | 55.6% | 50.0% |
| `UNATTRIBUTABLE` | 4 | 4 | 100.0% | 40.0% |
| `SINGLETON_ACCEPT` | 1 | 1 | 100.0% | 10.0% |

## Recommendation for F2
Largest false-accept share → **CORRELATED_VOTES** — calibrate Decision gate / evidence correlation before OCR changes.

