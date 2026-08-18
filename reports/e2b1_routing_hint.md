# E2-B1：Secondary Routing Hint

**范围**：observation only；`applied=false`；不改 secondary 调用 / Decision / Retry / OCR 集合。

- label=`E2-B1-routing-hint` rounds=40 profile=`demo-strict` secondary=`ppllocr`
- ACCEPT=18（true=9, FA=9）abstain=22
- bench: `reports/captcha_ocr_bench_20260815T132442Z.json`
- 单元测试：`tests/test_routing_hint.py` OK

## 契约

```json
{
  "routingHint": {
    "recommendSecondary": true,
    "priority": "high|medium|low",
    "applied": false,
    "reasons": [{"code": "LOW_CHAR_MARGIN", "value": 0.12}]
  }
}
```

| code | 来源 |
|------|------|
| `LOW_CHAR_CONFIDENCE` | `charMin` &lt; 0.45 |
| `LOW_CHAR_MARGIN` | `charMinMargin` &lt; 0.12 |
| `CANDIDATE_UNSTABLE` | tight / vote runner / char runner |
| `MISSING_INDEPENDENT_EVIDENCE` | `independentAgree=false`（缺增强 ≠ 错误） |

禁止：`LOW_DECISION_SCORE` / type / attempt。

## KPI

### 1. Hint Coverage（FA）

| FA | 被 hint 捕获 | coverage |
|---:|-------------:|---------:|
| 9 | 9 | **100%** |

### 2. Hint Precision（真困难）

困难操作定义：FA ∨ 弱 char ∨ 紧 margin ∨ `incomparable|conflict`。

| recommend=true | 其中困难 | precision |
|---------------:|---------:|----------:|
| 18 | 18 | **100%** |

`applied=true` 次数：**0**（边界保持）。

### 3. 与 B2 关联（hint=true 子集）

| status | n |
|--------|--:|
| agree | 1 |
| conflict | 6 |
| incomparable | 11 |

| 指标 | hint=true |
|------|----------:|
| comparableRate | 0.3889 |
| agreeRate | 0.0556 |

hint=false（22）均为 abstain，无 `secondaryComparison`（secondary 路径未形成可比观测）——本包不改变调用，故 **不能**用本跑证明「hint→可比率↑」；只能验证 hint 对准了 **已 ACCEPT 且缺增强** 的样本。

## reason / priority 分布

| reason | n（可叠加） |
|--------|----------:|
| `MISSING_INDEPENDENT_EVIDENCE` | 17 |
| `CANDIDATE_UNSTABLE` | 11 |
| `LOW_CHAR_CONFIDENCE` | 8 |
| `LOW_CHAR_MARGIN` | 5 |

| priority | n |
|----------|--:|
| high | 9 |
| medium | 4 |
| low | 27（含大量 abstain 的 recommend=false 默认 low 计数外：hint 行内） |

说明：ACCEPT 中仅 1 例 `independentAgree=true`，故 **几乎所有 ACCEPT** 都会因 `MISSING_INDEPENDENT_EVIDENCE` 得到 `recommendSecondary=true`。char/candidate 信号把其中一部分抬到 **high/medium**，这才是更有区分度的「值得投入」子集。

## 裁决

**B1 taxonomy ✅ / 自动 routing ⏸**

- 观测契约落地；FA 全覆盖；`applied` 恒 false；未耦合 Decision。
- `MISSING_INDEPENDENT_EVIDENCE` 单独使用时接近「凡非 agree 的 ACCEPT 都 hint」——符合「缺增强」语义，但 **不足以**作为自动调 secondary 的唯一开关。
- 若讨论 auto-routing，应优先看 **priority∈{high,medium}**（char/candidate 驱动），并与 B2 comparable 提升目标对照；本包不启用。

```text
E2-B2 Comparable   ✅
E2-B1 Routing Hint ✅
E2-B3 Ensemble     ⏸
E2-C Abstain       ⏸
Evidence Engine    ⏸
Decision Calibration ⏸
```
