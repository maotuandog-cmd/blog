# CAPTCHA OCR Bench Report (20260815T021154Z)

- Label: `vlm-off-baseline`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0)
- Elapsed: 32.7s
- **Pass rate (session/verify OK): 33.3% (10/30)**
- First-try pass rate: 33.3% (10/30)
- First-try decision: correct=10 wrong=3 abstain=17
- **Accepted precision: 76.9% (10/13)**
- Solver returned text: 43.3% (13/30)
- Avg confidence: 0.5261966666666666
- Avg solve ms: 914.9
- VLM used: 0/30 (0.0%); pass among VLM-used: 0/0

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
  "vlmMode": "off",
  "vlmReady": false,
  "vlmUrl": null,
  "vlmModel": null,
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 10}`
- preprocess: `{'raw+beta': 4, 'morph_up2': 1, 'raw': 3, 'chroma_ink+beta': 2}`

## Text length histogram (solver outputs)
`{6: 13}`

## Top fail reasons
- (17) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T021154Z`
JSON: `reports/captcha_ocr_bench_20260815T021154Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
