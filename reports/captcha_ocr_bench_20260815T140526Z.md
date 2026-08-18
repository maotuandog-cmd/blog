# CAPTCHA OCR Bench Report (20260815T140526Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `smoke-restart`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **5** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 17.1s

## Phase 3 core metrics
- firstAttemptSuccess: **0.0%** (0/5)
- eventualSessionSuccess: **0.0%** (0/5)
- **falseAcceptRate: n/a** (0/0)
- abstainRate: 100.0% (5/5)
- retryRate: 0.0% (0/5)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/5)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 3133.0 / 3759.4 / 3800.68

## Decision / feedback
- First-try decision: correct=0 wrong=0 abstain=5
- Accepted precision: n/a (0/0)
- First feedback: `{'not_executed': 5}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 5}`
- FailureClass: `{'OCR_ABSTAIN': 5}`
- Feedback final: `{'not_executed': 5}`; linked=5/5

## F1 False-ACCEPT Attribution (first attempt)
- (no attribution data) `{'totalAttributedAccepts': 0, 'totalFalseAccepts': 0, 'skippedRows': 0, 'byClass': [], 'topClass': None}`

## E1-A Character Evidence (observation only)
- accepts=0 FA=0 true=0
- FA with weak char evidence: **0** (share=None)
- true ACCEPT with weak char evidence: 0 (share=None)
- mean charMin: FA=None true=None

## E1-B Candidate Margin (observation only)
- accepts=0 FA=0 true=0
- FA with tight margin: **0** (share=None)
- true ACCEPT with tight margin: 0 (share=None)
- mean candidateMargin: FA=None true=None

## E1-C Independent Source (observation only)
- accepts=0 FA=0 true=0
- FA independentAgree: **0** (share=None); conflict=0
- true independentAgree: **0** (share=None); conflict=0

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
- engine: `{}`
- preprocess: `{}`

## Text length histogram (solver outputs)
`{}`

## Top fail reasons
- (5) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T140526Z`
JSON: `reports/captcha_ocr_bench_20260815T140526Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
