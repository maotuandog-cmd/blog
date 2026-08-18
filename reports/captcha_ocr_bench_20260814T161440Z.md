# CAPTCHA OCR Bench Report (20260814T161440Z)

- Label: `E2-agree-char5of6`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 20.2s
- **Pass rate (session/verify OK): 28.0% (14/50)**
- First-try pass rate: 28.0% (14/50)
- First-try decision: correct=14 wrong=12 abstain=24
- **Accepted precision: 53.8% (14/26)**
- Solver returned text: 52.0% (26/50)
- Avg confidence: 0.548368
- Avg solve ms: 353.82

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
- preprocess: `{'raw+beta': 6, 'raw': 6, 'chroma_ink+beta': 1, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 26}`

## Top fail reasons
- (24) solver did not return text
- (12) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161440Z`
JSON: `reports/captcha_ocr_bench_20260814T161440Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
