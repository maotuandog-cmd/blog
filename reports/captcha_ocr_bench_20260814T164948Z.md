# CAPTCHA OCR Bench Report (20260814T164948Z)

- Label: `E3-morph=0.5-r2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 41.8s
- **Pass rate (session/verify OK): 62.5% (25/40)**
- First-try pass rate: 27.5% (11/40)
- First-try decision: correct=11 wrong=10 abstain=19
- **Accepted precision: 52.4% (11/21)**
- Solver returned text: 77.5% (31/40)
- Avg confidence: 0.7515652064220183
- Avg solve ms: 966.675

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
- engine: `{'ddddocr': 25}`
- preprocess: `{'raw+beta': 7, 'chroma_ink+beta': 2, 'morph_up2': 2, 'raw': 9, 'gray_contrast': 1, 'chroma_ink': 4}`

## Text length histogram (solver outputs)
`{1: 1, 6: 31}`

## Top fail reasons
- (9) solver did not return text
- (6) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164948Z`
JSON: `reports/captcha_ocr_bench_20260814T164948Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
