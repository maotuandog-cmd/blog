# CAPTCHA OCR Bench Report (20260815T125939Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E2-B2-comparable`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 83.6s

## Phase 3 core metrics
- firstAttemptSuccess: **22.5%** (9/40)
- eventualSessionSuccess: **22.5%** (9/40)
- **falseAcceptRate: 25.0%** (3/12)
- abstainRate: 70.0% (28/40)
- retryRate: 0.0% (0/40)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/40)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 2105.5 / 3430.3999999999987 / 4981.879999999999

## Decision / feedback
- First-try decision: correct=9 wrong=3 abstain=28
- Accepted precision: 75.0% (9/12)
- First feedback: `{'not_executed': 28, 'success': 9, 'failed': 3}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 28, 'correct|success': 9, 'wrong|failed': 3}`
- FailureClass: `{'OCR_ABSTAIN': 28, 'SUCCESS': 9, 'VERIFY_FAILED': 3}`
- Feedback final: `{'not_executed': 28, 'success': 9, 'failed': 3}`; linked=40/40

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **3** / attributedAccepts=12; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 9 | 3 | 33.3% | 100.0% |
| `SINGLETON_ACCEPT` | 3 | 0 | 0.0% | 0.0% |

## E1-A Character Evidence (observation only)
- accepts=12 FA=3 true=9
- FA with weak char evidence: **1** (share=0.3333)
- true ACCEPT with weak char evidence: 4 (share=0.4444)
- mean charMin: FA=0.3971 true=0.553

## E1-B Candidate Margin (observation only)
- accepts=12 FA=3 true=9
- FA with tight margin: **1** (share=0.3333)
- true ACCEPT with tight margin: 4 (share=0.4444)
- mean candidateMargin: FA=None true=0.1112

## E1-C Independent Source (observation only)
- accepts=12 FA=3 true=9
- FA independentAgree: **0** (share=0.0); conflict=0
- true independentAgree: **3** (share=0.3333); conflict=0

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
- engine: `{'ddddocr': 9}`
- preprocess: `{'chroma_ink': 7, 'raw': 2}`

## Text length histogram (solver outputs)
`{6: 12}`

## Top fail reasons
- (28) solver did not return text
- (3) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T125939Z`
JSON: `reports/captcha_ocr_bench_20260815T125939Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
