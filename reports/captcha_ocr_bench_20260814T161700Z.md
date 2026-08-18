# CAPTCHA OCR Bench Report (20260814T161700Z)

- Label: `E2-dual-support`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 21.9s
- **Pass rate (session/verify OK): 28.0% (14/50)**
- First-try pass rate: 28.0% (14/50)
- First-try decision: correct=14 wrong=5 abstain=31
- **Accepted precision: 73.7% (14/19)**
- Solver returned text: 38.0% (19/50)
- Avg confidence: 0.45352400000000004
- Avg solve ms: 388.2

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
- engine: `{'ddddocr': 14}`
- preprocess: `{'chroma_ink': 8, 'chroma_ink+beta': 1, 'raw': 2, 'morph_up2': 2, 'morph_up2+beta': 1}`

## Text length histogram (solver outputs)
`{6: 19}`

## Top fail reasons
- (31) solver did not return text
- (5) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161700Z`
JSON: `reports/captcha_ocr_bench_20260814T161700Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
