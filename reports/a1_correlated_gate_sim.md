# A1：Correlated Gate Simulation

**范围**：离线仿真；**未改**线上 `correlatedMinAgree`（仍为 1.0）。  
**数据**：N=40 live demo+solver+verify；`reports/a1_correlated_gate_sim_20260815T141751Z.json`

## 判断确认

> F2 消灭 correlated false-accept 的目标达到了，但 `correlatedMinAgree=1.0` 会杀掉「非全票」候选。  
> **本仿真进一步表明：仅放宽 agreement 阈值，恢复样本的正确率很差。**

## Baseline（当前线上）

| 指标 | 值 |
|------|---:|
| success | 0.225（9/40） |
| accept | 15 |
| abstain | 25（0.625） |
| FAR（ACCEPT 内） | **0.40**（6/15） |

即便 **全票一致 ACCEPT**，仍有不少 wrong → preprocess agreement ≠ 独立正确性（印证 F2 设计直觉）。

## Policy 矩阵

| policy | minAgree | evThr | acceptRate | recover/abstain | recoveryPrecision | FAR |
|--------|---------:|------:|-----------:|----------------:|------------------:|----:|
| baseline | 1.0 | 0.5 | 0.375 | 0/25 | — | 0.40 |
| A_0.9 | 0.9 | 0.5 | 0.375 | 0/25 | — | 0.40 |
| B_0.85 | 0.85 | 0.5 | 0.375 | 0/25 | — | 0.40 |
| C_0.8 | 0.8 | 0.5 | 0.40 | 1/25 | **0.0** | 0.44 |
| D_0.75 | 0.75 | 0.5 | 0.50 | 5/25 | **0.2** | **0.50** |
| joint_agr0.8_ev0.55 | 0.8 | 0.55 | 0.40 | 1/25 | **0.0** | 0.44 |

## CORRELATED_GATE 子集（n=10）

| cand | agr | ev | votes | truth |
|------|----:|---:|------:|-------|
| `4rfcxz` | 0.79 | 0.61 | 3 | **correct** |
| `codukc` | 0.83 | 0.58 | 4 | wrong |
| `e7xkdm` 等×3 | 0.75 | 0.58 | 3 | wrong |
| 其余×5 | ≤0.63 | ≤0.48 | 3 | wrong |

- `0.9` / `0.85`：**零恢复**（本跑几乎没有 agr∈[0.85,1) 的 gate 样本）
- `0.8`：只多放行 1 个且 **wrong**
- `0.75`：放行 5 个，仅 1 个 correct（precision=0.2）

## 裁决

**情况 B（为主）+ 情况 C 信号**

| 情况 | 含义 | 本跑 |
|------|------|------|
| A | success↑ FAR 持平 | ❌ 未出现 |
| **B** | success↑ **FAR↑** / 恢复 precision 低 | ✅ 放宽 agreement 会引入错误 ACCEPT |
| **C** | 几乎无安全恢复 | ✅ 0.85+ 无收益 → 瓶颈不在微调 1.0→0.9 |

### 结论（冻结建议）

1. **禁止**单独把线上 `correlatedMinAgree` 改成 0.8/0.75。  
2. `agreement` 只宜作 **stability 信号**，不能当独立正确性。  
3. 安全恢复窗口需要 **独立源**（secondary comparable / agree）或更强 char 联合门，而不是只降 F2 阈值。  
4. 下一包优先 **A2 Secondary Comparable**（提高独立 evidence）；A3 仅在有联合门方案后再做 guarded tuning。

```text
A0 Abstain Attribution     ✅
A1 Vote/Preprocess Sim     ✅  情况 B/C — 勿单放宽 minAgree
A2 Secondary Comparable    ▶ next
A3 Guarded Tuning          ⏸（等联合门）
```

### 对「识别退化」的解释

不是 OCR 挂了，而是：

```text
candidate 常在
  → F2 全票门 / 单源弱 evidence 弃权
  → 即便放宽 agreement，verify 显示多数候选仍是错的
  → 需要 secondary 等独立证据，而不是更松的同源投票
```
