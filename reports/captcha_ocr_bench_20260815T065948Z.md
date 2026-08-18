# CAPTCHA OCR Bench Report (20260815T065948Z)

- **Phase 3 cell: `D`** (profile=`demo-strict`, adaptive=True, vlmTier=`on`)
- Label: `phase3-D-vlm-adaptive`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **5** (retries=0, adaptive=True, maxAttempts=2)
- Elapsed: 56.3s

## Phase 3 core metrics
- firstAttemptSuccess: **20.0%** (1/5)
- eventualSessionSuccess: **20.0%** (1/5)
- **falseAcceptRate: 50.0%** (1/2)
- abstainRate: 60.0% (3/5)
- retryRate: 80.0% (4/5)
- retryRecoveryRate: 0.0% (0/4)
- retryFalseAcceptRate: 25.0% (1/4)
- vlmInvokeRate: 60.0% (3/5)
- vlmRecoveryRate: 0.0% (0/3)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 9927.0 / 17473.8 / 17507.56

## Decision / feedback
- First-try decision: correct=1 wrong=1 abstain=3
- Accepted precision: 50.0% (1/2)
- First feedback: `{'success': 1, 'not_executed': 3, 'failed': 1}`
- Cross (firstDecision|feedback): `{'correct|success': 1, 'abstain|not_executed': 3, 'wrong|failed': 1}`
- FailureClass: `{'SUCCESS': 1, 'OCR_ABSTAIN': 3, 'VERIFY_FAILED': 1}`
- Feedback final: `{'success': 1, 'not_executed': 3, 'failed': 1}`; linked=5/5

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
- engine: `{'ddddocr': 1}`
- preprocess: `{'chroma_ink': 1}`

## Text length histogram (solver outputs)
`{6: 2}`

## Top fail reasons
- (3) solver did not return text
- (1) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T065948Z`
JSON: `reports/captcha_ocr_bench_20260815T065948Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
