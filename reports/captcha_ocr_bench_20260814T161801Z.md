# CAPTCHA OCR Bench Report (20260814T161801Z)

- Label: `E2-dual-retry2-b`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 42.4s
- **Pass rate (session/verify OK): 65.0% (26/40)**
- First-try pass rate: 20.0% (8/40)
- First-try decision: correct=8 wrong=2 abstain=30
- **Accepted precision: 80.0% (8/10)**
- Solver returned text: 67.5% (27/40)
- Avg confidence: 0.7013225000000001
- Avg solve ms: 970.4

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
- engine: `{'ddddocr': 26}`
- preprocess: `{'raw+beta': 3, 'raw': 14, 'chroma_ink': 7, 'morph_up2': 2}`

## Text length histogram (solver outputs)
`{6: 27}`

## Top fail reasons
- (13) solver did not return text
- (1) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161801Z`
JSON: `reports/captcha_ocr_bench_20260814T161801Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
