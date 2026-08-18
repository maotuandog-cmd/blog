# CAPTCHA OCR Bench Report (20260814T163805Z)

- Label: `E3-morph=0.8-r2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 23.1s
- **Pass rate (session/verify OK): 85.0% (34/40)**
- First-try pass rate: 57.5% (23/40)
- First-try decision: correct=23 wrong=6 abstain=11
- **Accepted precision: 79.3% (23/29)**
- Solver returned text: 97.5% (39/40)
- Avg confidence: 0.8842975
- Avg solve ms: 517.2

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
  "ocrMorphWeight": 0.8,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 34}`
- preprocess: `{'raw': 10, 'chroma_ink': 9, 'raw+beta': 7, 'morph_up2': 3, 'chroma_ink+beta': 5}`

## Text length histogram (solver outputs)
`{6: 39}`

## Top fail reasons
- (5) 验证码错误，还可以尝试 4 次
- (1) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T163805Z`
JSON: `reports/captcha_ocr_bench_20260814T163805Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
