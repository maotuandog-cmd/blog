# CAPTCHA OCR Bench Report (20260814T164629Z)

- Label: `E3-morph=0.82-r2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 29.4s
- **Pass rate (session/verify OK): 72.5% (29/40)**
- First-try pass rate: 20.0% (8/40)
- First-try decision: correct=8 wrong=7 abstain=25
- **Accepted precision: 53.3% (8/15)**
- Solver returned text: 80.0% (32/40)
- Avg confidence: 0.7508925
- Avg solve ms: 667.65

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
- engine: `{'ddddocr': 29}`
- preprocess: `{'raw+beta': 7, 'chroma_ink': 4, 'chroma_ink+beta': 1, 'raw': 13, 'morph_up2+beta': 1, 'morph_up2': 3}`

## Text length histogram (solver outputs)
`{6: 32}`

## Top fail reasons
- (8) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164629Z`
JSON: `reports/captcha_ocr_bench_20260814T164629Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
