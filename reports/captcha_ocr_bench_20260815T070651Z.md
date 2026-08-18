# CAPTCHA OCR Bench Report (20260815T070651Z)

- **Phase 3 cell: `A`** (profile=`demo-strict`, adaptive=False, vlmTier=`off`)
- Label: `-`
- Demo: `http://127.0.0.1:3000`
- Solver: `http://127.0.0.1:18085`
- Rounds: **30** (retries=0, adaptive=False, maxAttempts=1)
- Elapsed: 55.1s

## Phase 3 core metrics
- firstAttemptSuccess: **13.3%** (4/30)
- eventualSessionSuccess: **13.3%** (4/30)
- **falseAcceptRate: 81.0%** (17/21)
- abstainRate: 30.0% (9/30)
- retryRate: 0.0% (0/30)
- retryRecoveryRate: n/a (0/0)
- retryFalseAcceptRate: n/a (0/0)
- vlmInvokeRate: 0.0% (0/30)
- vlmRecoveryRate: n/a (0/0)
- vlmFalseAcceptRate: n/a (0/0)
- latencyP50/P95/P99 ms: 497.0 / 963.5999999999997 / 23804.290000000026

## Decision / feedback
- First-try decision: correct=4 wrong=17 abstain=9
- Accepted precision: 19.0% (4/21)
- First feedback: `{'not_executed': 9, 'failed': 17, 'success': 4}`
- Cross (firstDecision|feedback): `{'abstain|not_executed': 9, 'wrong|failed': 17, 'correct|success': 4}`
- FailureClass: `{'OCR_ABSTAIN': 9, 'VERIFY_FAILED': 17, 'SUCCESS': 4}`
- Feedback final: `{'not_executed': 9, 'failed': 17, 'success': 4}`; linked=30/30

## F1 False-ACCEPT Attribution (first attempt)
- totalFalseAccepts: **17** / attributedAccepts=21; topClass=**CORRELATED_VOTES**

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 17 | 85.0% | 100.0% |
| `SINGLETON_ACCEPT` | 1 | 0 | 0.0% | 0.0% |

## Solver health
```json
{
  "ok": false,
  "error": "not found"
}
```

## OK by engine / preprocess
- engine: `{'ddddocr': 4}`
- preprocess: `{'chroma_ink': 3, 'raw': 1}`

## Text length histogram (solver outputs)
`{6: 21}`

## Top fail reasons
- (17) 验证码错误，还可以尝试 4 次
- (9) solver did not return text

Failed images: `reports/captcha_ocr_fails_20260815T070651Z`
JSON: `reports/captcha_ocr_bench_20260815T070651Z.json`

## Judgment order (Phase 3)
1. falseAcceptRate ↓
2. eventualSessionSuccess ↑
3. retryRecoveryRate useful
4. latency P95/P99 acceptable
5. VLM net benefit (C/D only; do not mix into A/B baseline)
