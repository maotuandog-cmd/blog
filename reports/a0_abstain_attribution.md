# A0：Abstain Attribution

**范围**：observation only；不改 Decision / minConf / correlatedMinAgree / VLM / preprocess 数量。

- label=`A0-abstain-attr` rounds=40 profile=`demo-strict`
- firstAttemptSuccess=0.25 FAR=**0** abstainRate=0.75
- bench: `reports/captcha_ocr_bench_20260815T135727Z.json`

## 粗原因 → 细归因

旧日志统一：

```text
reason=ocr low confidence
```

A0 拆成 bucket（abstain N=30）：

| bucket | n | rate | 含义 |
|--------|--:|-----:|------|
| `SINGLE_SOURCE` | 12 | **40%** | 有候选，但单源/孤票 → 证据不足（类型 B） |
| `CORRELATED_GATE` | 9 | **30%** | 多预处理部分一致，被 F2 `correlated_partial_agreement` 拦住（类型 C） |
| `NO_READING` | 7 | **23%** | 无有效 reading（类型 A 偏空读） |
| `MISSING_DETAIL` | 2 | 7% | 多为 template 回退路径，未挂 fuse probe |

- withDetail=28/30
- **abstain 中 70% 曾有 candidateText**（正确答案可能在门闩前存在）

### 字段拆解（有 detail 的样本）

| 维 | 分布 |
|----|------|
| primary | HAS_CANDIDATE_WEAK_EVIDENCE 13 · HAS_CANDIDATE 8 · NO_READING 7 |
| vote | SINGLE_SOURCE 11 · MULTI_PARTIAL 9 · NO_VOTES 7 · LONE_SUPPORTER 1 |
| gate | BELOW_THRESHOLD 19 · CORRELATED_EVIDENCE_BLOCK 9 |
| secondary | INCOMPARABLE 15 · UNKNOWN 7 · CONFLICT 5 · AGREE 1 |

示例（CORRELATED_GATE）：candidate=`vycr5x`，votes=3/5，agreement=0.625，gate=`correlated_partial_agreement`，secondary=incomparable。

## 裁决 → 下一步

```text
SINGLE_SOURCE 40% + CORRELATED_GATE 30%  ≈ 70%
```

主损失是 **「有候选但证据门闩未过」**，不是「FAR 失控」。

| 情况 | 条件 | 下一步 |
|------|------|--------|
| **1（本跑）** | 大量 SINGLE_SOURCE / CORRELATED_GATE | ▶ **A1 Vote/Preprocess Simulation**（安全放宽仿真，默认不改线上） |
| 2 | 大量纯 LOW_CONFIDENCE / NO_READING | OCR 预处理增强（非 ensemble） |
| 3 | 大量 SECONDARY_MISSING 为主 | A2 Secondary Comparable |

secondary INCOMPARABLE 仍高（15/28），A2 仍有价值，但 **优先级低于 A1**。

### 继续冻结

```text
❌ 降 minConf
❌ 放宽 correlatedMinAgree（线上）
❌ singletonGate on
❌ 加 preprocess / VLM
EE-6 ⏸
```

```text
A0 Abstain Attribution     ✅
A1 Vote/Preprocess Sim     ▶ next
A2 Secondary Comparable
A3 Threshold Guarded Tune
```
