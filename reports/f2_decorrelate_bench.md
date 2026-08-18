# F2 Decision Gate / 去相关证据 — Bench 对标 Phase3-A

## 实现摘要

| 子切片 | 内容 | 落点 |
|--------|------|------|
| F2-A | Evidence Grouping：`ddddocr` preprocess 变体 → 同一 evidence group；`+beta` 为第二组 | `solvers/evidence.py` |
| F2-B | Correlated-vote cap：单组多票不按独立源抬高 `evidenceScore`（`/sqrt(1+α(v-1))`） | `score_decorrelated_evidence` |
| F2-C | Gate：`independentSources<2` 且 `votes≥2` 时要求 `agreementScore ≥ correlatedMinAgree`（默认 **1.0**） | `decide_ocr_candidate` |

开关：`decision.decorrelate` / `HERMES_CAPTCHA_OCR_DECORRELATE`；门闩：`decision.correlatedMinAgree`。

未改：OCR 算法、preprocess 列表、S4、S5 结构、VLM。

## 对标 Phase3-A（同协议）

| 指标 | Phase3-A 基线 | F2 (`F2-A-decorrelate`) | Δ |
|------|---------------|-------------------------|---|
| N | 30 | 30 | — |
| profile / VLM / adaptive | demo-strict / off / 0 | 同 | — |
| **falseAcceptRate** | **65.2%** | **12.5%** | **↓ 52.7pp** |
| eventualSessionSuccess | 26.7% | 23.3% | −3.4pp（不明显崩） |
| firstAttemptSuccess | 26.7% | 23.3% | −3.4pp |
| abstainRate | 23.3% | **73.3%** | **↑ 50pp**（风险监控） |
| latencyP95 | ~846ms | ~1357ms | ↑ 可接受量级 |
| CORRELATED_VOTES FA | 13/15（F1） | **0** | ✅ |
| SINGLETON_ACCEPT FA | 2/15 | 1/1 of remaining FA | 新的次要头 |

报告：`reports/captcha_ocr_bench_20260815T091358Z.{json,md}`

## 归因（F1 复跑）

| class | acceptCount | acceptFailed | shareOfFA |
|-------|------------:|-------------:|----------:|
| `SINGLETON_ACCEPT` | 3 | 1 | **100%** |
| `CORRELATED_VOTES` | 5 | 0 | 0% |

结论：F2 目标 **`CORRELATED_VOTES` false ACCEPT** 已压住；残留 FA 转到 singleton。

## 验收判定

```text
falseAccept ↓                 ✅  65.2% → 12.5%
eventualSuccess 不明显下降     ✅  26.7% → 23.3% (−3.4pp ≤ ~5pp)
CORRELATED_VOTES FA ↓         ✅  → 0
abstain ↑ 已报告               ⚠  23% → 73%（代价清晰，非隐蔽失败）
```

**Phase 2 F2：通过。**  
若需第二轮 Gate：优先盯 `SINGLETON_ACCEPT`（勿再堆 OCR）；或评估是否略放宽 `correlatedMinAgree`（如 0.99）以换回部分 eventual（需新 bench）。

## 测试

- `tests/test_f2_decorrelate.py`（7）
- 更新 `EngineTests.test_normalize_and_vote` / `test_morph_weight_vote`
- `tests/test_false_accept.py` 仍绿
