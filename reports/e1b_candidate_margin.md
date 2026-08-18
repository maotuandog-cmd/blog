# E1-B Candidate Margin — Phase 2 报告

## 范围

| 做了 | 没做 |
|------|------|
| vote-share top1/top2 / `candidateMargin` | 改 Decision / 阈值 |
| `charRunnerUpText` / `charMinMargin`（由 E1-A 字级 alt 派生） | 新 OCR / preprocess |
| observation + bench `candidateMarginAnalysis` | S4/S5/VLM |

## 字段

```json
{
  "candidateMargin": 0.02,
  "runnerUpText": "ABIZCD",
  "runnerUpScore": 0.70,
  "candidateRanking": [{"text":"AB12CD","score":0.72,"rank":1}, ...],
  "charMinMargin": 0.04,
  "charRunnerUpText": "A812CD"
}
```

## Bench（观测 only）

`BENCH_LABEL=E1-B-candidate-margin` · `reports/captcha_ocr_bench_20260815T094327Z.*`

### 关键发现：F2 之后 vote-share margin 退化

F2-C 要求单源多票 **全票一致** 才 ACCEPT → ACCEPT 样本几乎只有一个拼写：

| 样本 | vote `candidateMargin` | `runnerUpText` | `charMinMargin` | `charRunnerUpText` |
|------|----------------------:|:--------------|----------------:|:-------------------|
| FA `t2fmbz` | 1.0（无第二拼写） | — | **0.048** | `r2fmbz` |
| FA `usdpc3` | 1.0 | — | 0.737 | `usdpcb` |
| true（4） | 均为 1.0 | — | 0.41–0.67 | 有，但 gap 更大 |

因此：

- **字符串级 vote margin**：在当前 F2 默认策略下对 ACCEPT **信息量很低**（常为 1.0）。
- **有价值的 margin** 是 **字符级** `charMinMargin` / `charRunnerUpText`（E1-A 概率分布的衍生）。

### 汇总（修正分析：margin=1.0 不计 tight vote）

| 指标 | 值 |
|------|---:|
| FA 含 tight margin 证据 | **1 / 2（50%）**（来自 charMinMargin） |
| true ACCEPT 含 tight | **0 / 4** |
| FA mean(charMinMargin) | **0.393** |
| true mean(charMinMargin) | **0.546** |

## 结论

1. E1-B **已落地观测**；vote-share runner-up 在 F2 后 ACCEPT 上几乎用不上。  
2. **进入 E1-D 前**，应把 margin 主信号定义为 **char-level margin**（与 E1-A 合并），而不是再找 preprocess 第二拼写。  
3. 仍 **不改 Gate**；下一刀优先考虑 E1-C 独立源，或小步 E1-D 融合 `charMin` + `charMinMargin`（需对照实验，禁止只抬阈值）。

## 产物

- `solvers/candidate_margin.py`
- `fuse_ocr_votes` / `_attach_character_evidence` 附加字段
- `tests/test_candidate_margin.py`
- bench `candidateMarginAnalysis`
