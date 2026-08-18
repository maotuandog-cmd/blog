# CAPTCHA OCR Bench Report (20260814T164658Z)

- Label: `E3-morph=0.82-r2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 52.1s
- **Pass rate (session/verify OK): 62.5% (25/40)**
- First-try pass rate: 20.0% (8/40)
- First-try decision: correct=8 wrong=10 abstain=22
- **Accepted precision: 44.4% (8/18)**
- Solver returned text: 72.5% (29/40)
- Avg confidence: 0.6931675
- Avg solve ms: 1224.15

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
  "ocrMorphWeight": 0.82,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 25}`
- preprocess: `{'chroma_ink+beta': 5, 'raw+beta': 5, 'morph_up2': 3, 'chroma_ink': 3, 'raw': 9}`

## Text length histogram (solver outputs)
`{6: 29}`

## Top fail reasons
- (11) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164658Z`
JSON: `reports/captcha_ocr_bench_20260814T164658Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
