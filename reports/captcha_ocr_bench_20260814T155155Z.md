# CAPTCHA OCR Bench Report (20260814T155155Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50** (retries=0)
- Elapsed: 27.9s
- **Pass rate (verify OK): 52.0% (26/50)**
- First-try pass rate: 52.0% (26/50)
- Solver returned text: 94.0% (47/50)
- Avg confidence: 0.68343
- Avg solve ms: 500.64

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
- engine: `{'ddddocr': 26}`
- preprocess: `{'chroma_ink+beta': 4, 'raw+beta': 10, 'raw': 10, 'chroma_ink': 1, 'morph_up2': 1}`

## Text length histogram (solver outputs)
`{6: 47}`

## Top fail reasons
- (21) 验证码错误，还可以尝试 4 次
- (3) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T155155Z`
JSON: `reports/captcha_ocr_bench_20260814T155155Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
- Singleton at exact LEN after filters should not be punished by votes/attempts.
