# CAPTCHA OCR Bench Report (20260814T160531Z)

- Label: `E1-soft=0.45-retry2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 32.2s
- **Pass rate (session/verify OK): 75.0% (30/40)**
- First-try pass rate: 40.0% (16/40)
- First-try decision: correct=16 wrong=16 abstain=8
- **Accepted precision: 50.0% (16/32)**
- Solver returned text: 87.5% (35/40)
- Avg confidence: 0.6852674999999999
- Avg solve ms: 727.175

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
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 30}`
- preprocess: `{'raw': 10, 'raw+beta': 11, 'chroma_ink': 4, 'chroma_ink+beta': 4, 'morph_up2': 1}`

## Text length histogram (solver outputs)
`{6: 35}`

## Top fail reasons
- (5) solver did not return text
- (5) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T160531Z`
JSON: `reports/captcha_ocr_bench_20260814T160531Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
