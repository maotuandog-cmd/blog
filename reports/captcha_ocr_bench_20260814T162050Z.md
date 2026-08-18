# CAPTCHA OCR Bench Report (20260814T162050Z)

- Label: `E2-degrade-r4`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=4)
- Elapsed: 63.7s
- **Pass rate (session/verify OK): 80.0% (32/40)**
- First-try pass rate: 17.5% (7/40)
- First-try decision: correct=7 wrong=8 abstain=25
- **Accepted precision: 46.7% (7/15)**
- Solver returned text: 92.5% (37/40)
- Avg confidence: 0.8404275
- Avg solve ms: 1479.75

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
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 32}`
- preprocess: `{'morph_up2': 2, 'raw': 15, 'raw+beta': 4, 'chroma_ink': 7, 'morph_up2+beta': 2, 'chroma_ink+beta': 1, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 37}`

## Top fail reasons
- (5) 验证码错误，还可以尝试 4 次
- (3) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260814T162050Z`
JSON: `reports/captcha_ocr_bench_20260814T162050Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
