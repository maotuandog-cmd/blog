# CAPTCHA OCR Bench Report (20260814T161500Z)

- Label: `E2-char-retry2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 35.8s
- **Pass rate (session/verify OK): 55.0% (22/40)**
- First-try pass rate: 30.0% (12/40)
- First-try decision: correct=12 wrong=7 abstain=21
- **Accepted precision: 63.2% (12/19)**
- Solver returned text: 65.0% (26/40)
- Avg confidence: 0.6526824999999999
- Avg solve ms: 815.1

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
- engine: `{'ddddocr': 22}`
- preprocess: `{'chroma_ink': 2, 'raw': 13, 'morph_up2': 1, 'raw+beta': 5, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 26}`

## Top fail reasons
- (14) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T161500Z`
JSON: `reports/captcha_ocr_bench_20260814T161500Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
