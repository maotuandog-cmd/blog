# CAPTCHA OCR Bench Report (20260814T154722Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50**
- Elapsed: 17.5s
- **Pass rate (verify OK): 36.0% (18/50)**
- Solver returned text: 70.0% (35/50)
- Avg confidence: 0.597448
- Avg solve ms: 299.8

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
- engine: `{'ddddocr': 18}`
- preprocess: `{'raw': 16, 'denoise_sharp_up3': 2}`

## Text length histogram (solver outputs)
`{6: 35}`

## Top fail reasons
- (17) 验证码错误，还可以尝试 4 次
- (15) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T154722Z`
JSON: `reports/captcha_ocr_bench_20260814T154722Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
