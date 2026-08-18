# CAPTCHA OCR Bench Report (20260814T164845Z)

- Label: `E3-morph=0.5`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 19.8s
- **Pass rate (session/verify OK): 24.0% (12/50)**
- First-try pass rate: 24.0% (12/50)
- First-try decision: correct=12 wrong=18 abstain=20
- **Accepted precision: 40.0% (12/30)**
- Solver returned text: 60.0% (30/50)
- Avg confidence: 0.63635
- Avg solve ms: 349.28

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
- engine: `{'ddddocr': 12}`
- preprocess: `{'raw+beta': 2, 'raw': 5, 'chroma_ink+beta': 3, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 30}`

## Top fail reasons
- (20) solver did not return text
- (18) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164845Z`
JSON: `reports/captcha_ocr_bench_20260814T164845Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
