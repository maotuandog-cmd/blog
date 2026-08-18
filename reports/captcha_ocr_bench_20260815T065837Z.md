# CAPTCHA OCR Bench Report (20260815T065837Z)

- **Phase 3 cell: `B`** (profile=`demo-strict`, adaptive=True, vlmTier=`off`)
- Label: `phase3-B-adaptive`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=True, maxAttempts=2)
- Elapsed: 45.7s

## Phase 3 core metrics
- firstAttemptSuccess: **13.3%** (4/30)
- eventualSessionSuccess: **36.7%** (11/30)
- **falseAcceptRate: 71.4%** (10/14)
- abstainRate: 53.3% (16/30)
- retryRate: 86.7% (26/30)
- retryRecoveryRate: 26.9% (7/26)
- retryFalseAcceptRate: 23.1% (6/26)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 1088.5 / 1640.3999999999999 / 1731.3500000000001

## Decision / feedback
- First-try decision: correct=4 wrong=10 abstain=16
- Accepted precision: 28.6% (4/14)
- First feedback: `{'not_executed': 16, 'failed': 10, 'success': 4}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 16, 'wrong|failed': 10, 'correct|success': 4}`
- FailureClass: `{'OCR_ABSTAIN': 18, 'VERIFY_FAILED': 8, 'SUCCESS': 4}`
- Feedback final: `{'not_executed': 13, 'success': 11, 'failed': 6}`; linked=30/30

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
- engine: `{'ddddocr': 11}`
- preprocess: `{'chroma_ink': 4, 'raw': 7}`

## Text length histogram (solver outputs)
`{6: 17}`

## Top fail reasons
- (13) solver did not return text
- (6) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T065837Z`
JSON: `reports/captcha_ocr_bench_20260815T065837Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
