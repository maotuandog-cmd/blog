# CAPTCHA OCR Bench Report (20260815T110823Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-C2-B-ppllocr`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **60** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 69.6s

## Phase 3 core metrics
- firstAttemptSuccess: **11.7%** (7/60)
- eventualSessionSuccess: **11.7%** (7/60)
- **falseAcceptRate: 41.7%** (5/12)
- abstainRate: 80.0% (48/60)
- retryRate: 0.0% (0/60)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/60)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 532.0 / 2571.2499999999995 / 3267.899999999999

## Decision / feedback
- First-try decision: correct=7 wrong=5 abstain=48
- Accepted precision: 58.3% (7/12)
- First feedback: `{'not_executed': 48, 'failed': 5, 'success': 7}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 48, 'wrong|failed': 5, 'correct|success': 7}`
- FailureClass: `{'OCR_ABSTAIN': 48, 'VERIFY_FAILED': 5, 'SUCCESS': 7}`
- Feedback final: `{'not_executed': 48, 'failed': 5, 'success': 7}`; linked=60/60

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **5** / attributedAccepts=12; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 8 | 4 | 50.0% | 80.0% |
| `SINGLETON_ACCEPT` | 4 | 1 | 25.0% | 20.0% |

## E1-A Character Evidence (observation only)
- accepts=12 FA=5 true=7
- FA with weak char evidence: **4** (share=0.8)
- true ACCEPT with weak char evidence: 4 (share=0.5714)
- mean charMin: FA=0.3131 true=0.4421

## E1-B Candidate Margin (observation only)
- accepts=12 FA=5 true=7
- FA with tight margin: **3** (share=0.6)
- true ACCEPT with tight margin: 4 (share=0.5714)
- mean candidateMargin: FA=0.1112 true=0.0741

## E1-C Independent Source (observation only)
- accepts=12 FA=5 true=7
- FA independentAgree: **0** (share=0.0); conflict=5
- true independentAgree: **2** (share=0.2857); conflict=5

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
- engine: `{'ddddocr': 7}`
- preprocess: `{'chroma_ink': 5, 'raw': 2}`

## Text length histogram (solver outputs)
`{6: 12}`

## Top fail reasons
- (48) solver did not return text
- (5) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T110823Z`
JSON: `reports/captcha_ocr_bench_20260815T110823Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
