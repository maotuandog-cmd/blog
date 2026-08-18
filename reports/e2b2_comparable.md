# E2-B2：Comparable Evidence 分类

**范围**：observation only；不改 secondary 实际调用 / Decision / threshold / retry / VLM。

- label=`E2-B2-comparable` rounds=40 profile=`demo-strict` secondary=`ppllocr`
- ACCEPT=12（true=9, FA=3）abstain=28
- bench: `reports/captcha_ocr_bench_20260815T125939Z.json`

## 输出契约

```json
{
  "secondaryComparison": {
    "status": "agree|conflict|incomparable",
    "reason": "exact|char_mismatch|length_mismatch|empty|no_candidate|…",
    "primary": {"text": "…"},
    "secondary": {"text": "…"}
  }
}
```

| status | 定义 | 进入 |
|--------|------|------|
| `agree` | 长度一致且字符一致 | `independentAgree` |
| `conflict` | 长度一致但字符不同 | `independentConflict`（真分歧） |
| `incomparable` | empty / no_candidate / length_mismatch / unsupported / low_conf… | **不**进 conflict |

## ACCEPT 池分类

| status | n | share |
|--------|--:|------:|
| agree | 3 | 0.25 |
| conflict | 0 | 0.00 |
| incomparable | 9 | 0.75 |

### reason 分布（ACCEPT）

| reason | n | status |
|--------|--:|--------|
| `exact` | 3 | agree |
| `length_mismatch` | 9 | incomparable |
| `char_mismatch` | 0 | — |

### KPI

| 指标 | 值 | 解读 |
|------|----|------|
| comparable rate | **0.25**（3/12） | 有效比较比例仍低 |
| conflict purity | **n/a→干净** | conflict=0；length_mismatch 全部归 incomparable |
| agree coverage（ACCEPT） | **0.25**（3/12） | 本跑高于 E1-D.1 的 8–13%，但仍由可比池决定 |
| FA∩agree | **0** | 安全信号保持 |

### 归因（ACCEPT）

| label | n |
|-------|--:|
| `both_agree_correct` | 3 |
| `source_unavailable_or_incomparable` | 9 |

## 样本：假 conflict 已拆干净

以前易污染成 conflict 的 length_mismatch，本跑全部为 incomparable，例如：

| primary | secondary（raw） | norm | reason |
|---------|------------------|------|--------|
| `e9wutb` | `e9aTb=` | `e9atb` | length_mismatch |

真 conflict（等长异字）本跑 **0** —— conflict 桶已不再混入不可比。

## 裁决

**B2 taxonomy ✅** — `secondaryComparison` 已落地；conflict 语义纯化；主损失仍是 **length_mismatch → incomparable**，不是「OCR 不够准」。

### 对后续的含义

1. **不要**用 conflict 率解释 secondary 质量；先看 comparable rate。
2. coverage 瓶颈 = 规范化后长度/字符集不可比，不是 type routing。
3. 下一包 **E2-B1**（routing hint，`applied=false`）可在此 taxonomy 上对照「多调 secondary 是否只增加 incomparable」。
4. **E2-B3** 继续冻结（不堆 ocr3/ocr4）。

```text
E2-B2 Comparable   ✅
E2-B1 Routing Hint ▶ next
E2-B3 Ensemble     ⏸
E2-C Abstain       pending
Decision Calibration ⏸
```
