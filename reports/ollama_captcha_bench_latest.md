# Ollama Captcha Bench (ollama-captcha)

- ts: `20260815T152900Z`
- demo: `http://192.168.85.144:3000`
- ollama: `http://192.168.3.16:11434` model=`qwen2.5vl:7b`
- rounds: **40**
- fail artifacts: `/home/u26/hermes/reports/ollama_captcha_fails_20260815T152900Z`

## Metrics

| Metric | Value |
|--------|------:|
| Pass rate | 0.3750 (15/40) |
| Submit rate | 1.0000 (40/40) |
| Precision | 0.375 |
| Empty rate | 0.0000 (0/40) |
| Error rate | 0.0000 (0/40) |
| Fail (wrong code) | 25/40 |
| Ollama p50 / p95 (ms) | 14796.3 / 15969.8 |
| E2E p50 / p95 (ms) | 14995.8 / 16188.0 |

## Status counts

- `FAIL`: 25
- `PASS`: 15

## Sample rows

- r1: status=PASS cand='dcqavf' ollamaMs=41186.1 verifyOk=True
- r2: status=PASS cand='lesyno' ollamaMs=13325.5 verifyOk=True
- r3: status=FAIL cand='qfluynn' ollamaMs=14173.1 verifyOk=False
- r4: status=FAIL cand='fjjpl' ollamaMs=13775.0 verifyOk=False
- r5: status=FAIL cand='vkxh' ollamaMs=14195.5 verifyOk=False
- r6: status=FAIL cand='8dy3yr' ollamaMs=16057.9 verifyOk=False
- r7: status=FAIL cand='hstice1' ollamaMs=14621.3 verifyOk=False
- r8: status=PASS cand='tuklxf' ollamaMs=14249.7 verifyOk=True
- r9: status=PASS cand='xidqrx' ollamaMs=14319.6 verifyOk=True
- r10: status=PASS cand='dqdm42' ollamaMs=14951.3 verifyOk=True
- r11: status=FAIL cand='e4kaact' ollamaMs=13609.5 verifyOk=False
- r12: status=FAIL cand='jqpfnv' ollamaMs=14366.0 verifyOk=False
- r13: status=FAIL cand='c4x5g7' ollamaMs=15847.4 verifyOk=False
- r14: status=PASS cand='q6egiu' ollamaMs=14656.3 verifyOk=True
- r15: status=PASS cand='skaerb' ollamaMs=15324.5 verifyOk=True
- ... (25 more)
