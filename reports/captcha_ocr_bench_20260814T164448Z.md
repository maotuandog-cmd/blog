# CAPTCHA OCR Bench Report (20260814T164448Z)

- Label: `E3-morph=0.7-r2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 25.5s
- **Pass rate (session/verify OK): 82.5% (33/40)**
- First-try pass rate: 35.0% (14/40)
- First-try decision: correct=14 wrong=9 abstain=17
- **Accepted precision: 60.9% (14/23)**
- Solver returned text: 90.0% (36/40)
- Avg confidence: 0.8380375000000001
- Avg solve ms: 574.125

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
  "ocrMorphWeight": 0.7,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 33}`
- preprocess: `{'raw+beta': 10, 'chroma_ink': 6, 'raw': 10, 'chroma_ink+beta': 5, 'morph_up2+beta': 1, 'morph_up2': 1}`

## Text length histogram (solver outputs)
`{6: 36}`

## Top fail reasons
- (4) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164448Z`
JSON: `reports/captcha_ocr_bench_20260814T164448Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
