# CAPTCHA OCR Bench Report (20260814T161536Z)

- Label: `E2-char-retry2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 35.2s
- **Pass rate (session/verify OK): 62.5% (25/40)**
- First-try pass rate: 32.5% (13/40)
- First-try decision: correct=13 wrong=8 abstain=19
- **Accepted precision: 61.9% (13/21)**
- Solver returned text: 70.0% (28/40)
- Avg confidence: 0.7144475
- Avg solve ms: 800.95

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
- engine: `{'ddddocr': 25}`
- preprocess: `{'raw': 13, 'chroma_ink': 3, 'raw+beta': 5, 'morph_up2': 3, 'morph_up2+beta': 1}`

## Text length histogram (solver outputs)
`{6: 28}`

## Top fail reasons
- (12) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161536Z`
JSON: `reports/captcha_ocr_bench_20260814T161536Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
