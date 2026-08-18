# CAPTCHA OCR Bench Report (20260814T160243Z)

- Label: `E1-soft=0.50`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 22.3s
- **Pass rate (session/verify OK): 42.0% (21/50)**
- First-try pass rate: 42.0% (21/50)
- First-try decision: correct=21 wrong=21 abstain=8
- **Accepted precision: 50.0% (21/42)**
- Solver returned text: 84.0% (42/50)
- Avg confidence: 0.59665
- Avg solve ms: 390.74

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
- engine: `{'ddddocr': 21}`
- preprocess: `{'raw': 8, 'raw+beta': 7, 'chroma_ink': 3, 'chroma_ink+beta': 3}`

## Text length histogram (solver outputs)
`{6: 42}`

## Top fail reasons
- (21) 验证码错误，还可以尝试 4 次
- (8) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T160243Z`
JSON: `reports/captcha_ocr_bench_20260814T160243Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
