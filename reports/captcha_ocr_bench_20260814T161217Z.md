# CAPTCHA OCR Bench Report (20260814T161217Z)

- Label: `E2-agree`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 19.9s
- **Pass rate (session/verify OK): 24.0% (12/50)**
- First-try pass rate: 24.0% (12/50)
- First-try decision: correct=12 wrong=2 abstain=36
- **Accepted precision: 85.7% (12/14)**
- Solver returned text: 28.0% (14/50)
- Avg confidence: 0.41776
- Avg solve ms: 349.82

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
- engine: `{'ddddocr': 12}`
- preprocess: `{'raw': 3, 'chroma_ink': 2, 'raw+beta': 5, 'morph_up2': 1, 'morph_up2+beta': 1}`

## Text length histogram (solver outputs)
`{6: 14}`

## Top fail reasons
- (36) solver did not return text
- (2) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161217Z`
JSON: `reports/captcha_ocr_bench_20260814T161217Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
