# CAPTCHA OCR Bench Report (20260815T092712Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-A-char-evidence`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 9.6s

## Phase 3 core metrics
- firstAttemptSuccess: **16.7%** (5/30)
- eventualSessionSuccess: **16.7%** (5/30)
- **falseAcceptRate: 28.6%** (2/7)
- abstainRate: 76.7% (23/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 171.5 / 375.74999999999994 / 387.71

## Decision / feedback
- First-try decision: correct=5 wrong=2 abstain=23
- Accepted precision: 71.4% (5/7)
- First feedback: `{'not_executed': 23, 'success': 5, 'failed': 2}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 23, 'correct|success': 5, 'wrong|failed': 2}`
- FailureClass: `{'OCR_ABSTAIN': 23, 'SUCCESS': 5, 'VERIFY_FAILED': 2}`
- Feedback final: `{'not_executed': 23, 'success': 5, 'failed': 2}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **2** / attributedAccepts=7; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 5 | 1 | 20.0% | 50.0% |
| `SINGLETON_ACCEPT` | 2 | 1 | 50.0% | 50.0% |

## E1-A Character Evidence (observation only)
- accepts=7 FA=2 true=5
- FA with weak char evidence: **2** (share=1.0)
- true ACCEPT with weak char evidence: 2 (share=0.4)
- mean charMin: FA=0.3031 true=0.5356

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
- preprocess: `{'raw': 4, 'chroma_ink': 1}`

## Text length histogram (solver outputs)
`{6: 7}`

## Top fail reasons
- (23) solver did not return text
- (2) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T092712Z`
JSON: `reports/captcha_ocr_bench_20260815T092712Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
