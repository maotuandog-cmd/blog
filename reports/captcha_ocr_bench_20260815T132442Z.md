# CAPTCHA OCR Bench Report (20260815T132442Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E2-B1-routing-hint`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **40** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 113.5s

## Phase 3 core metrics
- firstAttemptSuccess: **22.5%** (9/40)
- eventualSessionSuccess: **22.5%** (9/40)
- **falseAcceptRate: 50.0%** (9/18)
- abstainRate: 55.0% (22/40)
- retryRate: 0.0% (0/40)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/40)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 2240.5 / 7599.149999999998 / 8342.55

## Decision / feedback
- First-try decision: correct=9 wrong=9 abstain=22
- Accepted precision: 50.0% (9/18)
- First feedback: `{'success': 9, 'not_executed': 22, 'failed': 9}`
- Cross (firstDecision|feedback): `{'correct|success': 9, 'abstain|not_executed': 22, 'wrong|failed': 9}`
- FailureClass: `{'SUCCESS': 9, 'OCR_ABSTAIN': 22, 'VERIFY_FAILED': 9}`
- Feedback final: `{'success': 9, 'not_executed': 22, 'failed': 9}`; linked=40/40

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **9** / attributedAccepts=18; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 15 | 7 | 46.7% | 77.8% |
| `SINGLETON_ACCEPT` | 3 | 2 | 66.7% | 22.2% |

## E1-A Character Evidence (observation only)
- accepts=18 FA=9 true=9
- FA with weak char evidence: **7** (share=0.7778)
- true ACCEPT with weak char evidence: 3 (share=0.3333)
- mean charMin: FA=0.4269 true=0.5441

## E1-B Candidate Margin (observation only)
- accepts=18 FA=9 true=9
- FA with tight margin: **6** (share=0.6667)
- true ACCEPT with tight margin: 3 (share=0.3333)
- mean candidateMargin: FA=0.1112 true=0.1112

## E1-C Independent Source (observation only)
- accepts=18 FA=9 true=9
- FA independentAgree: **0** (share=0.0); conflict=4
- true independentAgree: **1** (share=0.1111); conflict=2

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
- preprocess: `{'chroma_ink': 4, 'raw': 5}`

## Text length histogram (solver outputs)
`{6: 18}`

## Top fail reasons
- (22) solver did not return text
- (9) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T132442Z`
JSON: `reports/captcha_ocr_bench_20260815T132442Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
