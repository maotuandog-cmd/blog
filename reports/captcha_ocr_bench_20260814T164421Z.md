# CAPTCHA OCR Bench Report (20260814T164421Z)

- Label: `E3-morph=0.7-r2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 27.1s
- **Pass rate (session/verify OK): 75.0% (30/40)**
- First-try pass rate: 35.0% (14/40)
- First-try decision: correct=14 wrong=12 abstain=14
- **Accepted precision: 53.8% (14/26)**
- Solver returned text: 82.5% (33/40)
- Avg confidence: 0.7953125
- Avg solve ms: 613.975

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
- engine: `{'ddddocr': 30}`
- preprocess: `{'raw': 16, 'chroma_ink+beta': 4, 'raw+beta': 6, 'morph_up2': 2, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 33}`

## Top fail reasons
- (7) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164421Z`
JSON: `reports/captcha_ocr_bench_20260814T164421Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
