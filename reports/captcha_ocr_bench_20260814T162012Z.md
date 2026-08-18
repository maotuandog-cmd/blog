# CAPTCHA OCR Bench Report (20260814T162012Z)

- Label: `E2-degrade-r2b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 37.8s
- **Pass rate (session/verify OK): 75.0% (30/40)**
- First-try pass rate: 55.0% (22/40)
- First-try decision: correct=22 wrong=5 abstain=13
- **Accepted precision: 81.5% (22/27)**
- Solver returned text: 87.5% (35/40)
- Avg confidence: 0.811045
- Avg solve ms: 874.525

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
- engine: `{'ddddocr': 30}`
- preprocess: `{'chroma_ink': 8, 'raw+beta': 8, 'raw': 7, 'morph_up2': 2, 'gray_contrast': 2, 'chroma_ink+beta': 3}`

## Text length histogram (solver outputs)
`{6: 35}`

## Top fail reasons
- (5) 验证码错误，还可以尝试 4 次
- (5) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T162012Z`
JSON: `reports/captcha_ocr_bench_20260814T162012Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
