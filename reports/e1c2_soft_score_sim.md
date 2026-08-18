# E1-C.2 / C2-C：Offline Soft Score Simulation

**范围**：离线重算 only；**未**改线上 decisionScore / gate / retry。

- sources: `E1-C2-B-ppllocr-lengate`, `E1-C2-B-ppllocr`
- rounds=140 ACCEPT=35 (true=26, FA=9) abstain=105
- params: agreeBonus=0.1, charRiskPenalty=0.05, conflictPenalty=0.03

## 限制（重要）

Current abstain rows have no candidate text; soft score cannot recall them. Re-thresholding ACCEPT→abstain always raises abstainRate (F2-D-shaped on coverage). Primary C2-C signal = ranking/separation under same coverage, not abstain↓.

## 信号在 ACCEPT 内的分布

| flag | share of true | share of FA |
|------|--------------:|------------:|
| `agree` | 0.2308 | 0.0 |
| `charRisk` | 0.6538 | 0.8889 |
| `conflict` | 0.3462 | 0.7778 |

## Separation（true mean − FA mean / AUC）

| variant | trueMean | faMean | gap | AUC P(true>fa) |
|---------|---------:|-------:|----:|---------------:|
| baseline | 0.6792 | 0.6917 | -0.0125 | 0.4402 |
| A | 0.7022 | 0.6917 | 0.0105 | 0.4979 |
| B | 0.6695 | 0.6473 | 0.0222 | 0.5085 |
| C | 0.6592 | 0.6239 | 0.0353 | 0.5983 |

## 同 coverage 排序（top-50% / top-75% precision）

| variant | top50 precision | top50 FAR | top75 precision | bottomQ FA count |
|---------|----------------:|----------:|----------------:|-----------------:|
| baseline | 0.7222 | 0.2778 | 0.7692 | 3/8 |
| A | 0.7222 | 0.2778 | 0.7692 | 3/8 |
| B | 0.7222 | 0.2778 | 0.7692 | 3/8 |
| C | 0.7222 | 0.2778 | 0.7692 | 3/8 |

## 再阈值工作点（ACCEPT→simulated abstain）

### Simulation `baseline`
- desired(FA↓∧abstain↓∧eventual↑)=0 · acceptable=0 · F2-D-like=2
- 无 FA↓且不损 eventual/abstain 的工作点（在「只能降 ACCEPT」结构下符合预期）。

### Simulation `A`
- desired(FA↓∧abstain↓∧eventual↑)=0 · acceptable=0 · F2-D-like=4
- 无 FA↓且不损 eventual/abstain 的工作点（在「只能降 ACCEPT」结构下符合预期）。

### Simulation `B`
- desired(FA↓∧abstain↓∧eventual↑)=0 · acceptable=0 · F2-D-like=7
- 无 FA↓且不损 eventual/abstain 的工作点（在「只能降 ACCEPT」结构下符合预期）。

### Simulation `C`
- desired(FA↓∧abstain↓∧eventual↑)=0 · acceptable=0 · F2-D-like=14
- 无 FA↓且不损 eventual/abstain 的工作点（在「只能降 ACCEPT」结构下符合预期）。

## 裁决

| 检查项 | 结果 |
|--------|------|
| agree 为正证据（FA agree=0） | **True** |
| Sim A 分离 gap↑ | **True** |
| Sim C 分离/AUC↑ | **True** / **True** |
| top50 precision↑ (A/C) | False / False (flat=True) |
| 存在 FA↓∧abstain↓ 工作点 | **False** |
| 可进 E1-D（仅 soft agree factor） | **True** |
| conflict hard gate | **False** |

### 结论句

1. `independentAgree` 适合作为 **positive soft calibration factor**（非 hard accept）。
2. 仅靠抬阈值 / 降 ACCEPT **无法**同时做到 FA↓ + abstain↓（当前 abstain 无文本）。
3. conflict / weak|conflict **不要**做主惩罚；C 的 AUC 提升有限且会误伤 true。
4. E1-D 若开工：范围收窄为 **optional agree bonus**；禁止 conflict hard gate / weak|conflict penalty。

脚本：`scripts/e1c2_soft_score_sim.py`

