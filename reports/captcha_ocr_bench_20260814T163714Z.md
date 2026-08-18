# CAPTCHA OCR Bench Report (20260814T163714Z)

- Label: `E3-morph=0.0`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 16.5s
- **Pass rate (session/verify OK): 46.0% (23/50)**
- First-try pass rate: 46.0% (23/50)
- First-try decision: correct=23 wrong=10 abstain=17
- **Accepted precision: 69.7% (23/33)**
- Solver returned text: 66.0% (33/50)
- Avg confidence: 0.6757219999999999
- Avg solve ms: 288.2

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
- engine: `{'ddddocr': 23}`
- preprocess: `{'raw': 12, 'raw+beta': 4, 'chroma_ink': 5, 'gray_contrast+beta': 1, 'chroma_ink+beta': 1}`

## Text length histogram (solver outputs)
`{6: 33}`

## Top fail reasons
- (17) solver did not return text
- (10) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163714Z`
JSON: `reports/captcha_ocr_bench_20260814T163714Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
