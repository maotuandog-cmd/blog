# CAPTCHA OCR Bench Report (20260814T154442Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50**
- Elapsed: 16.7s
- **Pass rate (verify OK): 40.0% (20/50)**
- Solver returned text: 76.0% (38/50)
- Avg confidence: 0.584
- Avg solve ms: 277.68

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
- engine: `{'ddddocr': 20}`
- preprocess: `{'raw': 12, 'denoise_trim_up2': 3, 'gray_contrast': 2, 'chroma_ink': 3}`

## Text length histogram (solver outputs)
`{6: 38}`

## Top fail reasons
- (18) 验证码错误，还可以尝试 4 次
- (12) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T154442Z`
JSON: `reports/captcha_ocr_bench_20260814T154442Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
