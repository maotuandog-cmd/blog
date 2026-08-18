# CAPTCHA OCR Bench Report (20260814T163632Z)

- Label: `E3-morph=1.0`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 22.6s
- **Pass rate (session/verify OK): 40.0% (20/50)**
- First-try pass rate: 40.0% (20/50)
- First-try decision: correct=20 wrong=12 abstain=18
- **Accepted precision: 62.5% (20/32)**
- Solver returned text: 64.0% (32/50)
- Avg confidence: 0.6134387692307692
- Avg solve ms: 409.96

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
  "ocrMorphWeight": 1.0,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 20}`
- preprocess: `{'chroma_ink': 4, 'raw+beta': 6, 'raw': 5, 'chroma_ink+beta': 2, 'gray_contrast': 1, 'morph_up2': 2}`

## Text length histogram (solver outputs)
`{1: 1, 6: 32}`

## Top fail reasons
- (18) solver did not return text
- (12) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163632Z`
JSON: `reports/captcha_ocr_bench_20260814T163632Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
