# CAPTCHA OCR Bench Report (20260814T163731Z)

- Label: `E3-morph=0.8-r2-a`
- Demo: `http://192.168.85.144:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=2)
- Elapsed: 33.8s
- **Pass rate (session/verify OK): 72.5% (29/40)**
- First-try pass rate: 40.0% (16/40)
- First-try decision: correct=16 wrong=8 abstain=16
- **Accepted precision: 66.7% (16/24)**
- Solver returned text: 85.0% (34/40)
- Avg confidence: 0.79726
- Avg solve ms: 777.675

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
  "ocrMorphWeight": 0.8,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 29}`
- preprocess: `{'raw': 11, 'raw+beta': 11, 'chroma_ink+beta': 4, 'chroma_ink': 2, 'morph_up2': 1}`

## Text length histogram (solver outputs)
`{6: 34}`

## Top fail reasons
- (6) solver did not return text
- (5) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260814T163731Z`
JSON: `reports/captcha_ocr_bench_20260814T163731Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
