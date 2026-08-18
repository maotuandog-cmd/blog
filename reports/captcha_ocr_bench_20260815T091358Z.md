# CAPTCHA OCR Bench Report (20260815T091358Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `F2-A-decorrelate`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 63.7s

## Phase 3 core metrics
- firstAttemptSuccess: **23.3%** (7/30)
- eventualSessionSuccess: **23.3%** (7/30)
- **falseAcceptRate: 12.5%** (1/8)
- abstainRate: 73.3% (22/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 719.5 / 1356.6999999999996 / 23657.040000000026

## Decision / feedback
- First-try decision: correct=7 wrong=1 abstain=22
- Accepted precision: 87.5% (7/8)
- First feedback: `{'not_executed': 22, 'success': 7, 'failed': 1}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 22, 'correct|success': 7, 'wrong|failed': 1}`
- FailureClass: `{'OCR_ABSTAIN': 22, 'SUCCESS': 7, 'VERIFY_FAILED': 1}`
- Feedback final: `{'not_executed': 22, 'success': 7, 'failed': 1}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **1** / attributedAccepts=8; topClass=**SINGLETON_ACCEPT**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `SINGLETON_ACCEPT` | 3 | 1 | 33.3% | 100.0% |
| `CORRELATED_VOTES` | 5 | 0 | 0.0% | 0.0% |

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
  "vlmMode": "off",
  "vlmReady": false,
  "vlmUrl": "http://127.0.0.1:11434/v1",
  "vlmModel": null,
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
- engine: `{'ddddocr': 7}`
- preprocess: `{'raw': 4, 'chroma_ink': 3}`

## Text length histogram (solver outputs)
`{1: 1, 6: 8}`

## Top fail reasons
- (22) solver did not return text
- (1) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T091358Z`
JSON: `reports/captcha_ocr_bench_20260815T091358Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
