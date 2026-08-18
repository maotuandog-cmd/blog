# CAPTCHA OCR Bench Report (20260815T094327Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `E1-B-candidate-margin`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085/captcha`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 24.0s

## Phase 3 core metrics
- firstAttemptSuccess: **13.3%** (4/30)
- eventualSessionSuccess: **13.3%** (4/30)
- **falseAcceptRate: 33.3%** (2/6)
- abstainRate: 80.0% (24/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 548.5 / 1262.7999999999993 / 1405.21

## Decision / feedback
- First-try decision: correct=4 wrong=2 abstain=24
- Accepted precision: 66.7% (4/6)
- First feedback: `{'not_executed': 24, 'failed': 2, 'success': 4}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 24, 'wrong|failed': 2, 'correct|success': 4}`
- FailureClass: `{'OCR_ABSTAIN': 24, 'VERIFY_FAILED': 2, 'SUCCESS': 4}`
- Feedback final: `{'not_executed': 24, 'failed': 2, 'success': 4}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **2** / attributedAccepts=6; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 6 | 2 | 33.3% | 100.0% |

## E1-A Character Evidence (observation only)
- accepts=6 FA=2 true=4
- FA with weak char evidence: **1** (share=0.5)
- true ACCEPT with weak char evidence: 1 (share=0.25)
- mean charMin: FA=0.5438 true=0.6945

## E1-B Candidate Margin (observation only)
- accepts=6 FA=2 true=4
- FA with tight margin: **1** (share=0.5)
- true ACCEPT with tight margin: 0 (share=0.0)
- mean candidateMargin: FA=1.0 true=1.0

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
- engine: `{'ddddocr': 4}`
- preprocess: `{'chroma_ink': 1, 'raw': 3}`

## Text length histogram (solver outputs)
`{6: 6}`

## Top fail reasons
- (24) solver did not return text
- (2) 验证码错误，还可以尝试 4 次

Failed images: `reports/captcha_ocr_fails_20260815T094327Z`
JSON: `reports/captcha_ocr_bench_20260815T094327Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
