# CAPTCHA OCR Bench Report (20260814T163854Z)

- Label: `E3-morph=0-r2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 26.4s
- **Pass rate (session/verify OK): 75.0% (30/40)**
- First-try pass rate: 42.5% (17/40)
- First-try decision: correct=17 wrong=10 abstain=13
- **Accepted precision: 63.0% (17/27)**
- Solver returned text: 85.0% (34/40)
- Avg confidence: 0.808705
- Avg solve ms: 596.625

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
- engine: `{'ddddocr': 30}`
- preprocess: `{'raw+beta': 12, 'chroma_ink+beta': 4, 'raw': 11, 'gray_contrast': 1, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 34}`

## Top fail reasons
- (6) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163854Z`
JSON: `reports/captcha_ocr_bench_20260814T163854Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
