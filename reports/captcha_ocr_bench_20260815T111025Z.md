# CAPTCHA OCR Bench Report (20260815T111025Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-C2-B-ppllocr-lengate`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **80** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 105.3s

## Phase 3 core metrics
- firstAttemptSuccess: **23.8%** (19/80)
- eventualSessionSuccess: **23.8%** (19/80)
- **falseAcceptRate: 17.4%** (4/23)
- abstainRate: 71.2% (57/80)
- retryRate: 0.0% (0/80)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/80)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 550.0 / 2783.6 / 3107.4199999999983

## Decision / feedback
- First-try decision: correct=19 wrong=4 abstain=57
- Accepted precision: 82.6% (19/23)
- First feedback: `{'success': 19, 'not_executed': 57, 'failed': 4}`
- Cross (firstDecision|feedback): `{'correct|success': 19, 'abstain|not_executed': 57, 'wrong|failed': 4}`
- FailureClass: `{'SUCCESS': 19, 'OCR_ABSTAIN': 57, 'VERIFY_FAILED': 4}`
- Feedback final: `{'success': 19, 'not_executed': 57, 'failed': 4}`; linked=80/80

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **4** / attributedAccepts=23; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 19 | 2 | 10.5% | 50.0% |
| `SINGLETON_ACCEPT` | 4 | 2 | 50.0% | 50.0% |

## E1-A Character Evidence (observation only)
- accepts=23 FA=4 true=19
- FA with weak char evidence: **4** (share=1.0)
- true ACCEPT with weak char evidence: 13 (share=0.6842)
- mean charMin: FA=0.3604 true=0.4585

## E1-B Candidate Margin (observation only)
- accepts=23 FA=4 true=19
- FA with tight margin: **4** (share=1.0)
- true ACCEPT with tight margin: 5 (share=0.2632)
- mean candidateMargin: FA=0.1112 true=0.1112

## E1-C Independent Source (observation only)
- accepts=23 FA=4 true=19
- FA independentAgree: **0** (share=0.0); conflict=2
- true independentAgree: **4** (share=0.2105); conflict=4

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
- engine: `{'ddddocr': 19}`
- preprocess: `{'raw': 14, 'chroma_ink': 4, 'gray_contrast': 1}`

## Text length histogram (solver outputs)
`{6: 23}`

## Top fail reasons
- (57) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T111025Z`
JSON: `reports/captcha_ocr_bench_20260815T111025Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
