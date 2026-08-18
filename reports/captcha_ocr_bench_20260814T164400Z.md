# CAPTCHA OCR Bench Report (20260814T164400Z)

- Label: `E3-morph=0.7`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 20.3s
- **Pass rate (session/verify OK): 40.0% (20/50)**
- First-try pass rate: 40.0% (20/50)
- First-try decision: correct=20 wrong=14 abstain=16
- **Accepted precision: 58.8% (20/34)**
- Solver returned text: 68.0% (34/50)
- Avg confidence: 0.6730320000000001
- Avg solve ms: 358.78

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
- engine: `{'ddddocr': 20}`
- preprocess: `{'morph_up2+beta': 2, 'raw+beta': 3, 'raw': 6, 'chroma_ink': 5, 'morph_up2': 1, 'chroma_ink+beta': 3}`

## Text length histogram (solver outputs)
`{6: 34}`

## Top fail reasons
- (16) solver did not return text
- (14) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T164400Z`
JSON: `reports/captcha_ocr_bench_20260814T164400Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
