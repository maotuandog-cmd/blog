# CAPTCHA OCR Bench Report (20260814T163656Z)

- Label: `E3-morph=0.8`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 16.6s
- **Pass rate (session/verify OK): 40.0% (20/50)**
- First-try pass rate: 40.0% (20/50)
- First-try decision: correct=20 wrong=10 abstain=20
- **Accepted precision: 66.7% (20/30)**
- Solver returned text: 60.0% (30/50)
- Avg confidence: 0.58582
- Avg solve ms: 289.44

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
- engine: `{'ddddocr': 20}`
- preprocess: `{'raw': 10, 'raw+beta': 2, 'chroma_ink': 5, 'bin+beta': 1, 'morph_up2': 1, 'chroma_ink+beta': 1}`

## Text length histogram (solver outputs)
`{6: 30}`

## Top fail reasons
- (20) solver did not return text
- (10) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163656Z`
JSON: `reports/captcha_ocr_bench_20260814T163656Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
