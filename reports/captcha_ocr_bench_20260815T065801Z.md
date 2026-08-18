# CAPTCHA OCR Bench Report (20260815T065801Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `phase3-A-baseline`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 25.7s

## Phase 3 core metrics
- firstAttemptSuccess: **26.7%** (8/30)
- eventualSessionSuccess: **26.7%** (8/30)
- **falseAcceptRate: 65.2%** (15/23)
- abstainRate: 23.3% (7/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 524.0 / 845.5999999999999 / 857.39

## Decision / feedback
- First-try decision: correct=8 wrong=15 abstain=7
- Accepted precision: 34.8% (8/23)
- First feedback: `{'success': 8, 'failed': 15, 'not_executed': 7}`
- Cross (firstDecision|feedback): `{'correct|success': 8, 'wrong|failed': 15, 'abstain|not_executed': 7}`
- FailureClass: `{'SUCCESS': 8, 'VERIFY_FAILED': 15, 'OCR_ABSTAIN': 7}`
- Feedback final: `{'success': 8, 'failed': 15, 'not_executed': 7}`; linked=30/30

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
- engine: `{'ddddocr': 8}`
- preprocess: `{'raw': 6, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 23}`

## Top fail reasons
- (15) 验证码错误，还可以尝试 4 次
- (7) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T065801Z`
JSON: `reports/captcha_ocr_bench_20260815T065801Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
