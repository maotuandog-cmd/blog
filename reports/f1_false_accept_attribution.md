# F1 False-ACCEPT Attribution Report

冻结：REQ §16（6 项全部通过）。本切片**只归因**，未改 OCR / Decision Gate / S4 / Profile / Worker。

## 回答的三个问题

| 问题 | 结论 |
|------|------|
| 当前 falseAccept 的主要来源是什么？ | **`CORRELATED_VOTES`**（多 preprocess / 同源 ddddocr 变体伪共识） |
| 各来源占比多少？ | 见下表（Phase3-A 离线 + F1 复跑 A） |
| 哪一类最值得进入 F2？ | **`CORRELATED_VOTES`** → 去相关证据 / 收紧 Decision gate；其次才考虑 `SINGLETON_ACCEPT` |

## 数据源

| 源 | 说明 | N |
|----|------|---|
| Phase3-A | `captcha_ocr_bench_20260815T065801Z`（adaptive=0, VLM=off）离线归因 | 30 |
| Phase3-B | `captcha_ocr_bench_20260815T065837Z`（adaptive=1）离线归因；部分 first-attempt 分数被 retry 覆盖 → `UNATTRIBUTABLE` | 30 |
| F1-A 复跑 | `captcha_ocr_bench_20260815T070651Z`（同 A 协议，bench 内联归因） | 30 |

## Phase3-A（主基线）

falseAcceptRate（原报告）= **65.2%**（15/23 first-attempt ACCEPT）

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 13 | 65.0% | **86.7%** |
| `SINGLETON_ACCEPT` | 3 | 2 | 66.7% | 13.3% |

## F1-A 复跑（同协议，内联归因）

falseAcceptRate = **80.9%**（17/21）；eventual = 13.3%（样本波动，不用于改 gate）

| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |
|-------|------------:|-------------:|----------------:|----------:|
| `CORRELATED_VOTES` | 20 | 17 | 85.0% | **100%** |
| `SINGLETON_ACCEPT` | 1 | 0 | 0% | 0% |

## Phase3-B（对照）

| class | acceptCount | acceptFailed | shareOfFA |
|-------|------------:|-------------:|----------:|
| `CORRELATED_VOTES` | 9 | 5 | **50%** |
| `UNATTRIBUTABLE` | 4 | 4 | 40%（retry 覆盖 first-attempt 字段，数据缺口） |
| `SINGLETON_ACCEPT` | 1 | 1 | 10% |

可归因大头仍是 **`CORRELATED_VOTES`**。

## 与非 False-ACCEPT 的区分

本报告**未**把 `abstain` / `not_executed` / timeout 计入 falseAccept。  
例如 F1-A：abstainRate=30% 单独统计，不进入归因封闭集。

## F2 建议（尚未实现）

1. **优先**：针对 `CORRELATED_VOTES` 降低「同源多 variant 票」的独立性权重，或要求更高 `agreementScore` / 独立证据门槛后再 ACCEPT。  
2. **次要**：`SINGLETON_ACCEPT` 门闩（单读默认 ABSTAIN 或更高阈值）。  
3. **禁止**：未再归因前堆 OCR / 开 VLM / 改 S4 / 扩 Profile。

## 产物文件

- 模块：`captcha-solver/solvers/false_accept.py`
- Bench：`scripts/captcha_ocr_bench.py` → `falseAccept` / `falseAcceptAttribution`
- 离线：`scripts/false_accept_report.py`
- 单测：`captcha-solver/tests/test_false_accept.py`（8 passed）
- 明细：`reports/captcha_ocr_bench_*_fa.md`、`reports/captcha_ocr_bench_20260815T070651Z.md`
