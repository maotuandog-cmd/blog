# CAPTCHA OCR Bench Report (20260815T065930Z)

- **Phase 3 cell: `C`** (profile=`demo-strict`, adaptive=False, vlmTier=`on`)
- Label: `phase3-C-vlm`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **5** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 12.5s

## Phase 3 core metrics
- firstAttemptSuccess: **60.0%** (3/5)
- eventualSessionSuccess: **60.0%** (3/5)
- **falseAcceptRate: 25.0%** (1/4)
- abstainRate: 20.0% (1/5)
- retryRate: 0.0% (0/5)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 20.0% (1/5)
- vlmRecoveryRate: 0.0% (0/1)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 650.0 / 7003.999999999998 / 8232.8

## Decision / feedback
- First-try decision: correct=3 wrong=1 abstain=1
- Accepted precision: 75.0% (3/4)
- First feedback: `{'success': 3, 'failed': 1, 'not_executed': 1}`
- Cross (firstDecision|feedback): `{'correct|success': 3, 'wrong|failed': 1, 'abstain|not_executed': 1}`
- FailureClass: `{'SUCCESS': 3, 'VERIFY_FAILED': 1, 'OCR_ABSTAIN': 1}`
- Feedback final: `{'success': 3, 'failed': 1, 'not_executed': 1}`; linked=5/5

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
  "ocrAgree": false,
  "ocrMorphWeight": 0.8,
  "vlmMode": "auto",
  "vlmReady": true,
  "vlmUrl": "http://127.0.0.1:11434/v1",
  "vlmModel": "qwen2.5vl:7b",
  "hermesWebhook": "/captcha",
  "feedback": "/captcha/feedback",
  "profileDefault": "demo-strict",
  "profiles": [
    "dcp-wide",
    "default",
    "demo-strict"
  ]
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 3}`
- preprocess: `{'raw': 3}`

## Text length histogram (solver outputs)
`{6: 4}`

## Top fail reasons
- (1) 验证码错误，还可以尝试 4 次
- (1) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T065930Z`
JSON: `reports/captcha_ocr_bench_20260815T065930Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
