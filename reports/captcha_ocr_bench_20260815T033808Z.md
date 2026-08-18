# CAPTCHA OCR Bench Report (20260815T033808Z)

- Label: `vlm-auto-ttl45m`
- Demo: `http://127.0.0.1:3001`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **15** (retries=0)
- Elapsed: 2982.6s
- **Pass rate (session/verify OK): 26.7% (4/15)**
- First-try pass rate: 26.7% (4/15)
- First-try decision: correct=4 wrong=8 abstain=3
- **Accepted precision: 33.3% (4/12)**
- Solver returned text: 80.0% (12/15)
- Avg confidence: 0.7267266666666666
- Avg solve ms: 198579.26666666666
- VLM used: 6/15 (40.0%); pass among VLM-used: 0/6

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
  "vlmMode": "auto",
  "vlmReady": true,
  "vlmUrl": "http://127.0.0.1:11434/v1",
  "vlmModel": "qwen2.5vl:7b",
  "hermesWebhook": "/captcha"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 4}`
- preprocess: `{'raw+beta': 2, 'chroma_ink': 1, 'raw': 1}`

## Text length histogram (solver outputs)
`{6: 12}`

## Top fail reasons
- (8) 验证码错误，还可以尝试 4 次
- (3) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T033808Z`
JSON: `reports/captcha_ocr_bench_20260815T033808Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
