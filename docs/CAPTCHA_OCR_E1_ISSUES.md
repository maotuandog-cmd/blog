# Phase 3：优化 E1 问题与结论文档

| 项 | 内容 |
|----|------|
| 阶段 | Phase 3（E1 收尾） |
| 日期 | 2026-08-15 |
| 范围 | Selective OCR：彩色 soft 门槛 A/B + 决策指标 |
| 对照 | 优化 D；需求见修订版 Phase 1 / 优化 E |
| 详表 | `docs/CAPTCHA_OCR_BENCH.md` |

---

## 1. 本轮交付（已合入）

| 项 | 状态 | 说明 |
|----|------|------|
| Bench 决策指标 | ✅ | `firstCorrect` / `firstWrong` / `firstAbstain` / `acceptedPrecision` |
| `HERMES_CAPTCHA_OCR_SOFT_CONF` | ✅ | 默认 **0.45**；仅 soft &lt; min_conf 时启用彩色 soft |
| Health `ocrSoftConf` | ✅ | `/health` 可见 |
| E1 四档 A/B | ✅ | `scripts/captcha_ocr_e1_soft_ab.sh` |
| 单测 | ✅ | `test_soft_conf_e1_default` 等全绿 |

---

## 2. 验收对照

| 验收项 | 目标 | E1 实测 | 结果 |
|--------|------|---------|------|
| 首试成功率 | ≥56%（软）/ 不低于 D 52% | soft=0.45 → **52%** | ⚠️ 达 D，未达 56% |
| 错答数 | 明显下降 | 21 → **16**（50 轮） | ✅ |
| 弃权数 | 允许上升 | 3 → **8** | ✅（预期） |
| Accepted Precision | 显著上升（方向 ≥70%） | ~55% → **62%** | ⚠️ 上升未达标 70% |
| 会话 RETRIES=2 | **≥85%（硬）** | **75% / 77.5%**（2×40） | ❌ |

**合入结论**：E1 作为「决策质量第一步」**可保留 soft=0.45**；**会话硬底线未过**，不得宣称 E 整体验收通过。下一实验必须优先恢复会话率。

---

## 3. 问题清单

### P1 — 会话成功率跌破 85% 底线

- **现象**：soft=0.45 下 `RETRIES=2` 两次 40 轮为 75%、77.5%；D 为 85%。
- **影响**：Worker「刷新重试」收益被削弱，与 Phase 1 合入否决条件冲突。
- **可能原因**（待 E2 验证）：
  1. 仍有大量 **wrong accept**（首试错答 16/50），换图前已浪费一次提交；
  2. `singleton@1.0` / 高 conf 错答未被 soft 拦住（soft 只影响低 conf 彩色回退）；
  3. 40 轮方差（首试在会话批次中曾低至 35–40%）。
- **建议**：E2 Agreement 强制「不一致 → abstain」；会话复测至少 2×40 或 1×80。

### P2 — soft 无法治理高置信错答

- **现象**：D/E1 均存在 conf≥0.9 乃至 singleton@1.0 仍错。
- **影响**：只调 soft 对这类错误几乎无效；Accepted Precision 上限受阻。
- **建议**：E2 双模型交叉；不一致时忽略单路 conf=1.0。

### P3 — 首试 56% / Precision 70% 未达成

- **现象**：最佳档 52% / 62%。
- **影响**：E 软目标未满；但相对 D 的决策结构已改善（错↓弃↑精↑）。
- **建议**：不单靠再抬 soft；靠 E2/E3 决策层。

### P4 — 50 轮统计噪声

- **现象**：同配置不同批次首试可差十余个百分点。
- **建议**：关键合入点用 ≥80 轮或重复 2 次；报告同时给出 correct/wrong/abstain，忌只看 pass%。

### P5 —（观察）同会话多次 verify

- **现象**：bench 同 cookie 下 wrong 后再拉新图；demo 有「还可尝试 N 次」。
- **影响**：若未来收紧尝试次数，wrong 比 abstain 更伤会话。
- **建议**：E2 起更倾向 abstain；Worker 侧优先「弃权刷新」而非「错答再试」。

---

## 4. 非问题（确认保留）

- 契约：`solved=false` + 空 text = abstain，无需改 Hermes 协议。
- 不回退 soft 到 0.34（决策绕过 min_conf，已否定）。
- 不在本轮堆更多预处理变体。

---

## 5. 遗留 → E2 输入

1. **双模型 Agreement**（标准 vs beta）：不一致 / 单路空 → 抬门槛或 ABSTAIN。  
2. 响应可选暴露 `agreement` / `decision`（契约兼容）。  
3. 验收硬条件：**会话 ≥85%**；软条件：Precision 继续↑、错答再↓。  
4. E1 默认保持 `SOFT_CONF=0.45` 作为 E2 基线。

---

## 6. 一句话

> E1 证明「收紧 soft」能改善提交精度与错答结构，但**不足以**单独满足会话底线；E 的主战场仍是 **accept/abstain 决策（E2 Agreement）**，不是继续调 OCR 预处理。
