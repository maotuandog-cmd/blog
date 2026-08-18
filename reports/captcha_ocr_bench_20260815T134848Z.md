# CAPTCHA OCR Bench Report (20260815T134848Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `smoke-captcha`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **5** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 9.0s

## Phase 3 core metrics
- firstAttemptSuccess: **40.0%** (2/5)
- eventualSessionSuccess: **40.0%** (2/5)
- **falseAcceptRate: 0.0%** (0/2)
- abstainRate: 60.0% (3/5)
- retryRate: 0.0% (0/5)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/5)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 1958.0 / 2983.7999999999997 / 3092.76

## Decision / feedback
- First-try decision: correct=2 wrong=0 abstain=3
- Accepted precision: 100.0% (2/2)
- First feedback: `{'success': 2, 'not_executed': 3}`
- Cross (firstDecision|feedback): `{'correct|success': 2, 'abstain|not_executed': 3}`
- FailureClass: `{'SUCCESS': 2, 'OCR_ABSTAIN': 3}`
- Feedback final: `{'success': 2, 'not_executed': 3}`; linked=5/5

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **0** / attributedAccepts=2; topClass=**SINGLETON_ACCEPT**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `SINGLETON_ACCEPT` | 2 | 0 | 0.0% | 0.0% |

## E1-A Character Evidence (observation only)
- accepts=2 FA=0 true=2
- FA with weak char evidence: **0** (share=None)
- true ACCEPT with weak char evidence: 1 (share=0.5)
- mean charMin: FA=None true=0.5268

## E1-B Candidate Margin (observation only)
- accepts=2 FA=0 true=2
- FA with tight margin: **0** (share=None)
- true ACCEPT with tight margin: 2 (share=1.0)
- mean candidateMargin: FA=None true=0.1112

## E1-C Independent Source (observation only)
- accepts=2 FA=0 true=2
- FA independentAgree: **0** (share=None); conflict=0
- true independentAgree: **0** (share=0.0); conflict=0

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
- engine: `{'ddddocr': 2}`
- preprocess: `{'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 2}`

## Top fail reasons
- (3) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T134848Z`
JSON: `reports/captcha_ocr_bench_20260815T134848Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
