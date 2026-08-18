# CAPTCHA OCR Bench Report (20260815T091833Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `F2-D-singleton`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 29.8s

## Phase 3 core metrics
- firstAttemptSuccess: **16.7%** (5/30)
- eventualSessionSuccess: **16.7%** (5/30)
- **falseAcceptRate: 0.0%** (0/5)
- abstainRate: 83.3% (25/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 271.0 / 669.349999999999 / 11864.590000000013

## Decision / feedback
- First-try decision: correct=5 wrong=0 abstain=25
- Accepted precision: 100.0% (5/5)
- First feedback: `{'not_executed': 25, 'success': 5}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 25, 'correct|success': 5}`
- FailureClass: `{'OCR_ABSTAIN': 25, 'SUCCESS': 5}`
- Feedback final: `{'not_executed': 25, 'success': 5}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **0** / attributedAccepts=5; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
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
- engine: `{'ddddocr': 5}`
- preprocess: `{'chroma_ink': 3, 'raw': 2}`

## Text length histogram (solver outputs)
`{1: 1, 6: 5}`

## Top fail reasons
- (25) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T091833Z`
JSON: `reports/captcha_ocr_bench_20260815T091833Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
