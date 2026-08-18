# A1：Correlated Gate Simulation

- rounds=40 profile=`demo-strict`
- baseline success=0.225 FAR=0.4 abstain=0.625
- **live Decision unchanged** (`correlatedMinAgree` still 1.0)

## Policy matrix

| policy | minAgree | evThr | acceptRate | recover/abstain | recoveryPrecision | FAR |
|--------|---------:|------:|-----------:|----------------:|------------------:|----:|
| `baseline` | 1.0 | 0.5 | 0.375 | 0/25 (0.0) | None | 0.4 |
| `A_0.9` | 0.9 | 0.5 | 0.375 | 0/25 (0.0) | None | 0.4 |
| `B_0.85` | 0.85 | 0.5 | 0.375 | 0/25 (0.0) | None | 0.4 |
| `C_0.8` | 0.8 | 0.5 | 0.4 | 1/25 (0.04) | 0.0 | 0.4375 |
| `D_0.75` | 0.75 | 0.5 | 0.5 | 5/25 (0.2) | 0.2 | 0.5 |
| `joint_agr0.8_ev0.55` | 0.8 | 0.55 | 0.4 | 1/25 (0.04) | 0.0 | 0.4375 |

## CORRELATED_GATE subset

n=10

| policy | recovered | correct | wrong | precision |
|--------|----------:|--------:|------:|----------:|
| `baseline` | 0 | 0 | 0 | None |
| `A_0.9` | 0 | 0 | 0 | None |
| `B_0.85` | 0 | 0 | 0 | None |
| `C_0.8` | 1 | 0 | 1 | 0.0 |
| `D_0.75` | 5 | 1 | 4 | 0.2 |
| `joint_agr0.8_ev0.55` | 1 | 0 | 1 | 0.0 |

## Reading guide

- Recovery ↑ with FAR flat → safe F2 soften candidate (情况 A)
- Recovery ↑ with FAR ↑ → need joint gate (情况 B)
- Little change → bottleneck elsewhere → A2 (情况 C)

JSON: `/home/u26/hermes/reports/a1_correlated_gate_sim_20260815T141751Z.json`
