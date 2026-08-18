# CAPTCHA OCR Bench Report (20260815T103722Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-C2-A-stability-topup`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **100** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 183.8s

## Phase 3 core metrics
- firstAttemptSuccess: **17.0%** (17/100)
- eventualSessionSuccess: **17.0%** (17/100)
- **falseAcceptRate: 32.0%** (8/25)
- abstainRate: 75.0% (75/100)
- retryRate: 0.0% (0/100)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/100)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 638.5 / 3627.9999999999995 / 4925.110000000148

## Decision / feedback
- First-try decision: correct=17 wrong=8 abstain=75
- Accepted precision: 68.0% (17/25)
- First feedback: `{'failed': 8, 'not_executed': 75, 'success': 17}`
- Cross (firstDecision|feedback): `{'wrong|failed': 8, 'abstain|not_executed': 75, 'correct|success': 17}`
- FailureClass: `{'VERIFY_FAILED': 8, 'OCR_ABSTAIN': 75, 'SUCCESS': 17}`
- Feedback final: `{'failed': 8, 'not_executed': 75, 'success': 17}`; linked=100/100

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **8** / attributedAccepts=25; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 22 | 8 | 36.4% | 100.0% |
| `SINGLETON_ACCEPT` | 3 | 0 | 0.0% | 0.0% |

## E1-A Character Evidence (observation only)
- accepts=25 FA=8 true=17
- FA with weak char evidence: **7** (share=0.875)
- true ACCEPT with weak char evidence: 10 (share=0.5882)
- mean charMin: FA=0.4341 true=0.4814

## E1-B Candidate Margin (observation only)
- accepts=25 FA=8 true=17
- FA with tight margin: **4** (share=0.5)
- true ACCEPT with tight margin: 10 (share=0.5882)
- mean candidateMargin: FA=None true=0.1112

## E1-C Independent Source (observation only)
- accepts=25 FA=8 true=17
- FA independentAgree: **4** (share=0.5); conflict=4
- true independentAgree: **8** (share=0.4706); conflict=9

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
- engine: `{'ddddocr': 17}`
- preprocess: `{'raw': 11, 'chroma_ink': 5, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 25}`

## Top fail reasons
- (75) solver did not return text
- (8) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T103722Z`
JSON: `reports/captcha_ocr_bench_20260815T103722Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
