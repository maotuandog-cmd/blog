# CAPTCHA OCR Bench Report (20260815T095640Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-C-independent-source`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 68.2s

## Phase 3 core metrics
- firstAttemptSuccess: **30.0%** (9/30)
- eventualSessionSuccess: **30.0%** (9/30)
- **falseAcceptRate: 30.8%** (4/13)
- abstainRate: 56.7% (17/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 804.0 / 4678.199999999999 / 5480.35

## Decision / feedback
- First-try decision: correct=9 wrong=4 abstain=17
- Accepted precision: 69.2% (9/13)
- First feedback: `{'success': 9, 'not_executed': 17, 'failed': 4}`
- Cross (firstDecision|feedback): `{'correct|success': 9, 'abstain|not_executed': 17, 'wrong|failed': 4}`
- FailureClass: `{'SUCCESS': 9, 'OCR_ABSTAIN': 17, 'VERIFY_FAILED': 4}`
- Feedback final: `{'success': 9, 'not_executed': 17, 'failed': 4}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **4** / attributedAccepts=13; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 9 | 2 | 22.2% | 50.0% |
| `SINGLETON_ACCEPT` | 4 | 2 | 50.0% | 50.0% |

## E1-A Character Evidence (observation only)
- accepts=13 FA=4 true=9
- FA with weak char evidence: **4** (share=1.0)
- true ACCEPT with weak char evidence: 6 (share=0.6667)
- mean charMin: FA=0.355 true=0.5616

## E1-B Candidate Margin (observation only)
- accepts=13 FA=4 true=9
- FA with tight margin: **3** (share=0.75)
- true ACCEPT with tight margin: 3 (share=0.3333)
- mean candidateMargin: FA=0.1112 true=0.1112

## E1-C Independent Source (observation only)
- accepts=13 FA=4 true=9
- FA independentAgree: **0** (share=0.0); conflict=4
- true independentAgree: **5** (share=0.5556); conflict=4

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
- engine: `{'ddddocr': 9}`
- preprocess: `{'raw': 7, 'chroma_ink': 2}`

## Text length histogram (solver outputs)
`{6: 13}`

## Top fail reasons
- (17) solver did not return text
- (4) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T095640Z`
JSON: `reports/captcha_ocr_bench_20260815T095640Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
