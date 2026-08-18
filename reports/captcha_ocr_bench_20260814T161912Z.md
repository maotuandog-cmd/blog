# CAPTCHA OCR Bench Report (20260814T161912Z)

- Label: `E2-dual-degrade`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 21.0s
- **Pass rate (session/verify OK): 42.0% (21/50)**
- First-try pass rate: 42.0% (21/50)
- First-try decision: correct=21 wrong=9 abstain=20
- **Accepted precision: 70.0% (21/30)**
- Solver returned text: 60.0% (30/50)
- Avg confidence: 0.56267
- Avg solve ms: 369.78

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
- engine: `{'ddddocr': 21}`
- preprocess: `{'raw': 9, 'chroma_ink': 4, 'chroma_ink+beta': 3, 'raw+beta': 4, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 30}`

## Top fail reasons
- (20) solver did not return text
- (9) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161912Z`
JSON: `reports/captcha_ocr_bench_20260814T161912Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
