# CAPTCHA OCR Bench Report (20260814T163920Z)

- Label: `E3-morph=0-r2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 25.4s
- **Pass rate (session/verify OK): 85.0% (34/40)**
- First-try pass rate: 50.0% (20/40)
- First-try decision: correct=20 wrong=15 abstain=5
- **Accepted precision: 57.1% (20/35)**
- Solver returned text: 90.0% (36/40)
- Avg confidence: 0.8802675000000001
- Avg solve ms: 571.05

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
  "ocrMorphWeight": 0.0,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 34}`
- preprocess: `{'chroma_ink': 8, 'raw': 13, 'raw+beta': 10, 'chroma_ink+beta': 3}`

## Text length histogram (solver outputs)
`{6: 36}`

## Top fail reasons
- (4) solver did not return text
- (2) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163920Z`
JSON: `reports/captcha_ocr_bench_20260814T163920Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
