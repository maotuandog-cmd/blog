# E1-C.2 / C2-A：Evidence Stability Validation

**范围**：仅扩样本 + 离线联合归因；**未**改 decisionScore / confidence / ACCEPT|ABSTAIN / retry / preprocess / VLM。  
**目标问题**：哪些 evidence 信号具有稳定区分能力（不是如何让更多样本 ACCEPT）。

## 数据

| 批次 | label | rounds | 文件 |
|------|-------|-------:|------|
| 主跑 | `E1-C2-A-stability` | 150 | `captcha_ocr_bench_20260815T103406Z.json` |
| 补跑 | `E1-C2-A-stability-topup` | 100 | `captcha_ocr_bench_20260815T103722Z.json` |
| **合并** | — | **250** | 分析：`e1c2_stability.json` |

协议：`demo-strict` · `VLM=off` · `ADAPTIVE_RETRY=0` · E1-A/B/C 观测开。

| 合并指标 | 值 |
|----------|---:|
| ACCEPT | 65（true=41, FA=24） |
| firstAttemptSuccess | 16.4% |
| falseAcceptRate（在 ACCEPT 内） | 36.9% |
| abstainRate | 74.0% |
| `weak\|conflict` N | **31**（≥30 ✅） |

## 矩阵：charEvidence × independentSource

| cell | correct | FA | total | 格内 FAR | 占 FA | 占 true |
|------|--------:|---:|------:|---------:|------:|--------:|
| `strong\|agree` | 11 | 1 | 12 | 8.3% | 4.2% | 26.8% |
| `strong\|conflict` | 6 | 1 | 7 | 14.3% | 4.2% | 14.6% |
| `weak\|agree` | 10 | 5 | 15 | 33.3% | 20.8% | 24.4% |
| `weak\|conflict` | 14 | **17** | **31** | **54.8%** | **70.8%** | **34.1%** |

非 `weak|conflict` 格 FAR：**20.6%**（7/34）— 大样本下不再是「完美干净」。

## 焦点：`weak|conflict` 是否稳定高风险？

| 统计 | E1-C.1 (N=30) | C2-A 合并 (N=250) |
|------|---------------|-------------------|
| 格内 N | 7 | **31** |
| correct / FA | 3 / 4 | **14 / 17** |
| 格内 FAR | 57.1% | **54.8%** |
| trueShareInCell | 42.9% | **45.2%** |
| FAR Wilson 95% | — | **[0.38, 0.71]** |
| 占 FA | 100% | **70.8%** |
| 占 true | 33.3% | **34.1%** |

格内 FAR 与 true 份额相对 E1-C.1 **方向稳定**（约一半对一半），但置信区间上界仍触及「偏高风险」，**达不到情况 A 阈值**。

### 情况 A vs B（验收裁决）

| 假设 | 判据 | 本跑 |
|------|------|------|
| **A** soft penalty 有价值 | 格内 FAR>70% 且 trueShare<30% | ❌ FAR=54.8%，trueShare=45.2% |
| **B** 困难区，需更好 evidence | FA≈true | ✅ **17 vs 14** |

**裁决：情况 B（稳定复现）。**

```text
weak|conflict
  = 高风险画像（仍覆盖 ~71% FA）
  ≠ 错误标签（仍含 ~34% true ACCEPT / 格内近半正确）
```

含义：

- **禁止** `weak|conflict → ABSTAIN` hard gate（会误杀约 1/3 true）。
- **不宜**把该格当作已验证的 soft penalty 主因子（情况 A 未成立）。
- **优先** C2-B：净化 independent conflict（跨家族 captcha OCR）。

## E1-B 三轴（观测）

| cell | correct | FA |
|------|--------:|---:|
| `weak\|conflict\|tight` | 12 | 13 |
| `weak\|conflict\|loose` | 2 | 4 |

tight 在高风险格内几乎均分；**不能**单独 gate。loose 偏 FA 但仍样本小。

## 与 E1-C.1 的稳定性结论

| 信号 | 是否稳定 | 说明 |
|------|----------|------|
| FA 多数落在 `weak\|conflict` | ✅ 方向稳定 | 100%→70.8%（大样本有泄漏） |
| true 约 1/3 仍在该格 | ✅ 高度稳定 | 33%→34% |
| 格内 FAR≈55% | ✅ 稳定偏 B | 非 A |
| `strong\|agree` 近零 FA | ⚠️ 弱化 | 0→1/12（仍相对干净） |
| 非高风险格 FAR≈0 | ❌ 未保持 | 升至 20.6% |

核心事实不变：

> Evidence 互补存在，但无一组合可安全 hard gate；当前最大缺口仍是 **independent conflict 裁判质量**。

## 下一步

```text
C2-A  ✅ 完成 → 情况 B
C2-B  ▶ 寻找真正跨家族 captcha OCR
C2-C  ⏸ 可后置（离线 soft sim）；非当前主路径
E1-D  ⏸
```

C2-B 准入（冻结）：captcha domain + 字符候选 + cross-family；拒绝 scene-text 空读与 preprocess 伪独立。
