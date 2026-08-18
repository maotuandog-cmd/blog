# CAPTCHA OCR Bench Report (20260814T160420Z)

- Label: `E1-soft=0.45-retry2`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 51.6s
- **Pass rate (session/verify OK): 77.5% (31/40)**
- First-try pass rate: 35.0% (14/40)
- First-try decision: correct=14 wrong=16 abstain=10
- **Accepted precision: 46.7% (14/30)**
- Solver returned text: 85.0% (34/40)
- Avg confidence: 0.67027
- Avg solve ms: 1210.5

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
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 31}`
- preprocess: `{'raw+beta': 17, 'raw': 11, 'chroma_ink+beta': 2, 'chroma_ink': 1}`

## Text length histogram (solver outputs)
`{6: 34}`

## Top fail reasons
- (6) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T160420Z`
JSON: `reports/captcha_ocr_bench_20260814T160420Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
