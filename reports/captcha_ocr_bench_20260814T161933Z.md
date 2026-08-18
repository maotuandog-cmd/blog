# CAPTCHA OCR Bench Report (20260814T161933Z)

- Label: `E2-degrade-r2a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 39.4s
- **Pass rate (session/verify OK): 82.5% (33/40)**
- First-try pass rate: 45.0% (18/40)
- First-try decision: correct=18 wrong=14 abstain=8
- **Accepted precision: 56.2% (18/32)**
- Solver returned text: 90.0% (36/40)
- Avg confidence: 0.7932275
- Avg solve ms: 909.675

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
  "ocrSoftConf": 0.45,
  "ocrAgree": true,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 33}`
- preprocess: `{'raw': 17, 'chroma_ink': 6, 'raw+beta': 4, 'chroma_ink+beta': 4, 'morph_up2': 2}`

## Text length histogram (solver outputs)
`{6: 36}`

## Top fail reasons
- (4) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161933Z`
JSON: `reports/captcha_ocr_bench_20260814T161933Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
