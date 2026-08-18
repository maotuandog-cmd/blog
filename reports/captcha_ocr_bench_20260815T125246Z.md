# CAPTCHA OCR Bench Report (20260815T125246Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E2-A-captcha-type`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 100.3s

## Phase 3 core metrics
- firstAttemptSuccess: **15.0%** (6/40)
- eventualSessionSuccess: **15.0%** (6/40)
- **falseAcceptRate: 40.0%** (4/10)
- abstainRate: 75.0% (30/40)
- retryRate: 0.0% (0/40)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/40)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 2683.5 / 3391.049999999999 / 4000.66

## Decision / feedback
- First-try decision: correct=6 wrong=4 abstain=30
- Accepted precision: 60.0% (6/10)
- First feedback: `{'not_executed': 30, 'failed': 4, 'success': 6}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 30, 'wrong|failed': 4, 'correct|success': 6}`
- FailureClass: `{'OCR_ABSTAIN': 30, 'VERIFY_FAILED': 4, 'SUCCESS': 6}`
- Feedback final: `{'not_executed': 30, 'failed': 4, 'success': 6}`; linked=40/40

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **4** / attributedAccepts=10; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 7 | 2 | 28.6% | 50.0% |
| `SINGLETON_ACCEPT` | 3 | 2 | 66.7% | 50.0% |

## E1-A Character Evidence (observation only)
- accepts=10 FA=4 true=6
- FA with weak char evidence: **3** (share=0.75)
- true ACCEPT with weak char evidence: 3 (share=0.5)
- mean charMin: FA=0.3917 true=0.5842

## E1-B Candidate Margin (observation only)
- accepts=10 FA=4 true=6
- FA with tight margin: **2** (share=0.5)
- true ACCEPT with tight margin: 2 (share=0.3333)
- mean candidateMargin: FA=0.1112 true=0.1112

## E1-C Independent Source (observation only)
- accepts=10 FA=4 true=6
- FA independentAgree: **0** (share=0.0); conflict=1
- true independentAgree: **1** (share=0.1667); conflict=2

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
  "vlmUrl": null,
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
- engine: `{'ddddocr': 6}`
- preprocess: `{'gray_contrast': 1, 'raw': 4, 'chroma_ink': 1}`

## Text length histogram (solver outputs)
`{6: 10}`

## Top fail reasons
- (30) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T125246Z`
JSON: `reports/captcha_ocr_bench_20260815T125246Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
