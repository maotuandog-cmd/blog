# CAPTCHA OCR Bench Report (20260814T161316Z)

- Label: `E2-agree-retry2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 38.2s
- **Pass rate (session/verify OK): 55.0% (22/40)**
- First-try pass rate: 22.5% (9/40)
- First-try decision: correct=9 wrong=0 abstain=31
- **Accepted precision: 100.0% (9/9)**
- Solver returned text: 55.0% (22/40)
- Avg confidence: 0.6369525
- Avg solve ms: 869.45

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
- engine: `{'ddddocr': 22}`
- preprocess: `{'chroma_ink': 8, 'raw': 10, 'raw+beta': 1, 'morph_up2': 1, 'gray_contrast': 1, 'morph_up2+beta': 1}`

## Text length histogram (solver outputs)
`{6: 22}`

## Top fail reasons
- (18) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T161316Z`
JSON: `reports/captcha_ocr_bench_20260814T161316Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
