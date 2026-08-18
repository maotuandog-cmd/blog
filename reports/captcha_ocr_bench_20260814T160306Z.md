# CAPTCHA OCR Bench Report (20260814T160306Z)

- Label: `E1-soft=0.55`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 22.4s
- **Pass rate (session/verify OK): 42.0% (21/50)**
- First-try pass rate: 42.0% (21/50)
- First-try decision: correct=21 wrong=23 abstain=6
- **Accepted precision: 47.7% (21/44)**
- Solver returned text: 88.0% (44/50)
- Avg confidence: 0.6914440000000001
- Avg solve ms: 392.7

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
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 21}`
- preprocess: `{'raw': 10, 'chroma_ink+beta': 4, 'raw+beta': 5, 'morph_up2+beta': 1, 'chroma_ink': 1}`

## Text length histogram (solver outputs)
`{6: 44}`

## Top fail reasons
- (23) 验证码错误，还可以尝试 4 次
- (6) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T160306Z`
JSON: `reports/captcha_ocr_bench_20260814T160306Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
