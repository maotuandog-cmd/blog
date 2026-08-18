# CAPTCHA OCR Bench Report (20260814T160159Z)

- Label: `E1-soft=0.40`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 20.6s
- **Pass rate (session/verify OK): 38.0% (19/50)**
- First-try pass rate: 38.0% (19/50)
- First-try decision: correct=19 wrong=22 abstain=9
- **Accepted precision: 46.3% (19/41)**
- Solver returned text: 82.0% (41/50)
- Avg confidence: 0.597326
- Avg solve ms: 358.92

## Solver health
```json
{
  "ok": true,
  "service": "captcha-solver",
  "engines": [
    "ocr",
    "slider",
    "click"
  ],
  "ocrMode": "auto",
  "ddddocr": true,
  "ocrMinConf": 0.5,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 19}`
- preprocess: `{'raw+beta': 6, 'raw': 12, 'chroma_ink+beta': 1}`

## Text length histogram (solver outputs)
`{6: 41}`

## Top fail reasons
- (22) 验证码错误，还可以尝试 4 次
- (9) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T160159Z`
JSON: `reports/captcha_ocr_bench_20260814T160159Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
