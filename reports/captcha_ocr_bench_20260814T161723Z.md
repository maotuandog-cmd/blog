# CAPTCHA OCR Bench Report (20260814T161723Z)

- Label: `E2-dual-retry2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 38.5s
- **Pass rate (session/verify OK): 70.0% (28/40)**
- First-try pass rate: 30.0% (12/40)
- First-try decision: correct=12 wrong=2 abstain=26
- **Accepted precision: 85.7% (12/14)**
- Solver returned text: 72.5% (29/40)
- Avg confidence: 0.74291
- Avg solve ms: 878.95

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
- engine: `{'ddddocr': 28}`
- preprocess: `{'chroma_ink': 7, 'raw+beta': 7, 'raw': 11, 'chroma_ink+beta': 1, 'morph_up2': 1, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 29}`

## Top fail reasons
- (11) solver did not return text
- (1) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161723Z`
JSON: `reports/captcha_ocr_bench_20260814T161723Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
