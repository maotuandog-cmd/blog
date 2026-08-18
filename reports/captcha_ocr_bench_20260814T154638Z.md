# CAPTCHA OCR Bench Report (20260814T154638Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **60**
- Elapsed: 19.0s
- **Pass rate (verify OK): 21.7% (13/60)**
- Solver returned text: 61.7% (37/60)
- Avg confidence: 0.5890716666666667
- Avg solve ms: 268.78333333333336

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
- engine: `{'ddddocr': 13}`
- preprocess: `{'position_vote': 13}`

## Text length histogram (solver outputs)
`{6: 37}`

## Top fail reasons
- (24) 验证码错误，还可以尝试 4 次
- (23) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T154638Z`
JSON: `reports/captcha_ocr_bench_20260814T154638Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
