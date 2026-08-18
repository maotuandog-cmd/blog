# CAPTCHA OCR Bench Report (20260815T120800Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-D1-agree-stability`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **120** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 394.5s

## Phase 3 core metrics
- firstAttemptSuccess: **10.8%** (13/120)
- eventualSessionSuccess: **10.8%** (13/120)
- **falseAcceptRate: 50.0%** (13/26)
- abstainRate: 78.3% (94/120)
- retryRate: 0.0% (0/120)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/120)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 3028.5 / 4456.9 / 24223.02

## Decision / feedback
- First-try decision: correct=13 wrong=13 abstain=94
- Accepted precision: 50.0% (13/26)
- First feedback: `{'not_executed': 94, 'failed': 13, 'success': 13}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 94, 'wrong|failed': 13, 'correct|success': 13}`
- FailureClass: `{'OCR_ABSTAIN': 94, 'VERIFY_FAILED': 13, 'SUCCESS': 13}`
- Feedback final: `{'not_executed': 94, 'failed': 13, 'success': 13}`; linked=120/120

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **13** / attributedAccepts=26; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 8 | 40.0% | 61.5% |
| `SINGLETON_ACCEPT` | 5 | 4 | 80.0% | 30.8% |
| `WEAK_EVIDENCE` | 1 | 1 | 100.0% | 7.7% |

## E1-A Character Evidence (observation only)
- accepts=26 FA=13 true=13
- FA with weak char evidence: **12** (share=0.9231)
- true ACCEPT with weak char evidence: 5 (share=0.3846)
- mean charMin: FA=0.3109 true=0.5787

## E1-B Candidate Margin (observation only)
- accepts=26 FA=13 true=13
- FA with tight margin: **8** (share=0.6154)
- true ACCEPT with tight margin: 3 (share=0.2308)
- mean candidateMargin: FA=0.0834 true=0.0

## E1-C Independent Source (observation only)
- accepts=26 FA=13 true=13
- FA independentAgree: **0** (share=0.0); conflict=4
- true independentAgree: **2** (share=0.1538); conflict=3

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
- engine: `{'ddddocr': 13}`
- preprocess: `{'raw': 9, 'gray_contrast': 2, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{1: 1, 3: 1, 6: 25}`

## Top fail reasons
- (94) solver did not return text
- (13) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T120800Z`
JSON: `reports/captcha_ocr_bench_20260815T120800Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
