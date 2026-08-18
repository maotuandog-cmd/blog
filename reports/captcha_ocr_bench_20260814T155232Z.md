# CAPTCHA OCR Bench Report (20260814T155232Z)

- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 32.5s
- **Pass rate (verify OK): 85.0% (34/40)**
- First-try pass rate: 42.5% (17/40)
- Solver returned text: 97.5% (39/40)
- Avg confidence: 0.771805
- Avg solve ms: 736.425

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
- engine: `{'ddddocr': 34}`
- preprocess: `{'raw': 14, 'chroma_ink+beta': 5, 'raw+beta': 10, 'gray_contrast+beta': 1, 'gray_contrast': 1, 'morph_up2': 2, 'morph_up2+beta': 1}`

## Text length histogram (solver outputs)
`{6: 39}`

## Top fail reasons
- (5) 验证码错误，还可以尝试 4 次
- (1) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T155232Z`
JSON: `reports/captcha_ocr_bench_20260814T155232Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Prefer length==6 candidates; filter to demo charset; denoise interference lines.
- Singleton at exact LEN after filters should not be punished by votes/attempts.
