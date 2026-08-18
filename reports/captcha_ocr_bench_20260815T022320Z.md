# CAPTCHA OCR Bench Report (20260815T022320Z)

- Label: `vlm-auto-cpu`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **20** (retries=0)
- Elapsed: 4414.3s
- **Pass rate (session/verify OK): 40.0% (8/20)**
- First-try pass rate: 40.0% (8/20)
- First-try decision: correct=8 wrong=9 abstain=3
- **Accepted precision: 47.1% (8/17)**
- Solver returned text: 85.0% (17/20)
- Avg confidence: 0.7817444444444445
- Avg solve ms: 172719.11111111112
- VLM used: 6/20 (30.0%); pass among VLM-used: 0/6

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
- engine: `{'ddddocr': 8}`
- preprocess: `{'chroma_ink': 2, 'raw+beta': 3, 'raw': 3}`

## Text length histogram (solver outputs)
`{6: 17}`

## Top fail reasons
- (5) 验证码会话不存在
- (4) 验证码错误，还可以尝试 4 次
- (2) timed out
- (1) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T022320Z`
JSON: `reports/captcha_ocr_bench_20260815T022320Z.json`

## Optimization hints
- Demo captcha length is **6**; charset excludes `0/O/1/I/l`.
- Verify is **case-insensitive** (sha256 of lowercased code).
- Optimize accept/abstain decision quality (accepted precision), not only pass rate.
