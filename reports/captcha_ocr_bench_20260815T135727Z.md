# CAPTCHA OCR Bench Report (20260815T135727Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `A0-abstain-attr`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 138.0s

## Phase 3 core metrics
- firstAttemptSuccess: **25.0%** (10/40)
- eventualSessionSuccess: **25.0%** (10/40)
- **falseAcceptRate: 0.0%** (0/10)
- abstainRate: 75.0% (30/40)
- retryRate: 0.0% (0/40)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/40)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 2605.0 / 5941.749999999965 / 18964.05

## Decision / feedback
- First-try decision: correct=10 wrong=0 abstain=30
- Accepted precision: 100.0% (10/10)
- First feedback: `{'success': 10, 'not_executed': 30}`
- Cross (firstDecision|feedback): `{'correct|success': 10, 'abstain|not_executed': 30}`
- FailureClass: `{'SUCCESS': 10, 'OCR_ABSTAIN': 30}`
- Feedback final: `{'success': 10, 'not_executed': 30}`; linked=40/40

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **0** / attributedAccepts=10; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 8 | 0 | 0.0% | 0.0% |
| `SINGLETON_ACCEPT` | 2 | 0 | 0.0% | 0.0% |

## E1-A Character Evidence (observation only)
- accepts=10 FA=0 true=10
- FA with weak char evidence: **0** (share=None)
- true ACCEPT with weak char evidence: 6 (share=0.6)
- mean charMin: FA=None true=0.461

## E1-B Candidate Margin (observation only)
- accepts=10 FA=0 true=10
- FA with tight margin: **0** (share=None)
- true ACCEPT with tight margin: 4 (share=0.4)
- mean candidateMargin: FA=None true=0.1112

## E1-C Independent Source (observation only)
- accepts=10 FA=0 true=10
- FA independentAgree: **0** (share=None); conflict=0
- true independentAgree: **0** (share=0.0); conflict=1

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
- engine: `{'ddddocr': 10}`
- preprocess: `{'raw': 7, 'chroma_ink': 3}`

## Text length histogram (solver outputs)
`{6: 10}`

## Top fail reasons
- (30) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T135727Z`
JSON: `reports/captcha_ocr_bench_20260815T135727Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
