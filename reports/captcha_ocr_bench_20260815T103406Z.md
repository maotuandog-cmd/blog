# CAPTCHA OCR Bench Report (20260815T103406Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-C2-A-stability`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **150** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 172.8s

## Phase 3 core metrics
- firstAttemptSuccess: **16.0%** (24/150)
- eventualSessionSuccess: **16.0%** (24/150)
- **falseAcceptRate: 40.0%** (16/40)
- abstainRate: 73.3% (110/150)
- retryRate: 0.0% (0/150)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/150)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 526.5 / 3005.45 / 3427.2

## Decision / feedback
- First-try decision: correct=24 wrong=16 abstain=110
- Accepted precision: 60.0% (24/40)
- First feedback: `{'success': 24, 'not_executed': 110, 'failed': 16}`
- Cross (firstDecision|feedback): `{'correct|success': 24, 'abstain|not_executed': 110, 'wrong|failed': 16}`
- FailureClass: `{'SUCCESS': 24, 'OCR_ABSTAIN': 110, 'VERIFY_FAILED': 16}`
- Feedback final: `{'success': 24, 'not_executed': 110, 'failed': 16}`; linked=150/150

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **16** / attributedAccepts=40; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 30 | 11 | 36.7% | 68.8% |
| `SINGLETON_ACCEPT` | 10 | 5 | 50.0% | 31.2% |

## E1-A Character Evidence (observation only)
- accepts=40 FA=16 true=24
- FA with weak char evidence: **15** (share=0.9375)
- true ACCEPT with weak char evidence: 14 (share=0.5833)
- mean charMin: FA=0.3471 true=0.4758

## E1-B Candidate Margin (observation only)
- accepts=40 FA=16 true=24
- FA with tight margin: **14** (share=0.875)
- true ACCEPT with tight margin: 13 (share=0.5417)
- mean candidateMargin: FA=0.089 true=0.1112

## E1-C Independent Source (observation only)
- accepts=40 FA=16 true=24
- FA independentAgree: **2** (share=0.125); conflict=14
- true independentAgree: **13** (share=0.5417); conflict=11

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
- engine: `{'ddddocr': 24}`
- preprocess: `{'raw': 18, 'chroma_ink': 6}`

## Text length histogram (solver outputs)
`{6: 40}`

## Top fail reasons
- (110) solver did not return text
- (16) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T103406Z`
JSON: `reports/captcha_ocr_bench_20260815T103406Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
