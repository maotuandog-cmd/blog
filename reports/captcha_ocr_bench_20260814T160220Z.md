# CAPTCHA OCR Bench Report (20260814T160220Z)

- Label: `E1-soft=0.45`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 21.6s
- **Pass rate (session/verify OK): 52.0% (26/50)**
- First-try pass rate: 52.0% (26/50)
- First-try decision: correct=26 wrong=16 abstain=8
- **Accepted precision: 61.9% (26/42)**
- Solver returned text: 84.0% (42/50)
- Avg confidence: 0.626802
- Avg solve ms: 379.38

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
- engine: `{'ddddocr': 26}`
- preprocess: `{'raw+beta': 11, 'raw': 11, 'morph_up2+beta': 1, 'chroma_ink+beta': 3}`

## Text length histogram (solver outputs)
`{6: 42}`

## Top fail reasons
- (16) 验证码错误，还可以尝试 4 次
- (8) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T160220Z`
JSON: `reports/captcha_ocr_bench_20260814T160220Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
