# CAPTCHA OCR Bench Report (20260814T161237Z)

- Label: `E2-agree-retry2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 38.7s
- **Pass rate (session/verify OK): 62.5% (25/40)**
- First-try pass rate: 22.5% (9/40)
- First-try decision: correct=9 wrong=3 abstain=28
- **Accepted precision: 75.0% (9/12)**
- Solver returned text: 62.5% (25/40)
- Avg confidence: 0.7082375
- Avg solve ms: 881.85

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
- engine: `{'ddddocr': 25}`
- preprocess: `{'raw+beta': 5, 'raw': 16, 'chroma_ink': 3, 'chroma_ink+beta': 1}`

## Text length histogram (solver outputs)
`{6: 25}`

## Top fail reasons
- (15) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T161237Z`
JSON: `reports/captcha_ocr_bench_20260814T161237Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
