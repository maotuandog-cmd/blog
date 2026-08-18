# CAPTCHA OCR Bench Report (20260814T154527Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **50**
- Elapsed: 23.9s
- **Pass rate (verify OK): 30.0% (15/50)**
- Solver returned text: 62.0% (31/50)
- Avg confidence: 0.592668
- Avg solve ms: 426.14

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
  "ocrMinConf": 0.45,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 15}`
- preprocess: `{'position_vote': 15}`

## Text length histogram (solver outputs)
`{6: 31}`

## Top fail reasons
- (19) solver did not return text
- (16) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T154527Z`
JSON: `reports/captcha_ocr_bench_20260814T154527Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
