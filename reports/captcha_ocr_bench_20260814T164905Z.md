# CAPTCHA OCR Bench Report (20260814T164905Z)

- Label: `E3-morph=0.5-r2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 42.5s
- **Pass rate (session/verify OK): 67.5% (27/40)**
- First-try pass rate: 32.5% (13/40)
- First-try decision: correct=13 wrong=8 abstain=19
- **Accepted precision: 61.9% (13/21)**
- Solver returned text: 80.0% (32/40)
- Avg confidence: 0.7514350000000001
- Avg solve ms: 987.975

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
  "ocrMorphWeight": 0.5,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 27}`
- preprocess: `{'chroma_ink+beta': 5, 'raw': 10, 'chroma_ink': 8, 'raw+beta': 3, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 32}`

## Top fail reasons
- (8) solver did not return text
- (5) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164905Z`
JSON: `reports/captcha_ocr_bench_20260814T164905Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
