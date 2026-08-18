# F1 False-ACCEPT Attribution (captcha_ocr_bench_20260815T070651Z.json)

- totalAttributedAccepts: 21
- totalFalseAccepts: **17**
- topClass: **CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 17 | 85.0% | 100.0% |
| `SINGLETON_ACCEPT` | 1 | 0 | 0.0% | 0.0% |

## Recommendation for F2
Largest false-accept share → **CORRELATED_VOTES** — calibrate Decision gate / evidence correlation before OCR changes.

