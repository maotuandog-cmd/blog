# CAPTCHA OCR Bench Report (20260814T154309Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40**
- Elapsed: 12.3s
- **Pass rate (verify OK): 20.0% (8/40)**
- Solver returned text: 100.0% (40/40)
- Avg confidence: 0.7875
- Avg solve ms: 195.05

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
- engine: `{'ddddocr': 8}`
- preprocess: `{'raw': 7, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{4: 6, 5: 15, 6: 19}`

## Top fail reasons
- (32) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T154309Z`
JSON: `reports/captcha_ocr_bench_20260814T154309Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
