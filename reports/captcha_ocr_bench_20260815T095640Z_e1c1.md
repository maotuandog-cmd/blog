# E1-C.1 Joint Evidence Attribution

数据源：`reports/captcha_ocr_bench_20260815T095640Z.json`（label=`E1-C-independent-source`）  
范围：**离线联合归因 only**；不改 Decision / score / gate / preprocess / VLM / retry。

- accepts: **13**（true=9, FA=4）

## 矩阵：charEvidence × independentSource

| cell | correct | wrong | total | 格内 FAR | 占 FA | 占 true |
|------|--------:|------:|------:|---------:|------:|--------:|
| `strong\|agree` | 2 | 0 | 2 | 0% | 0% | 22% |
| `strong\|conflict` | 1 | 0 | 1 | 0% | 0% | 11% |
| `weak\|agree` | 3 | 0 | 3 | 0% | 0% | 33% |
| `weak\|conflict` | 3 | 4 | 7 | **57%** | **100%** | **33%** |

## 焦点结论

| 信号 | 结果 | 含义 |
|------|------|------|
| FA ∈ `weak\|conflict` | **100%** | 联合高风险格可覆盖全部剩余 FA |
| true ∈ `weak\|conflict` | **33%**（3/9） | **不能**对该格硬 gate（会误杀正确 ACCEPT） |
| FA ∈ `strong\|agree` | **0%** | 高可信格无假阳性 |
| true ∈ `strong\|agree` | 22% | 高可信格偏保守，覆盖不全 |
| 非 `weak\|conflict` 格的 FAR | **0%**（6/6 correct） | A×C 联合比单轴更有解释力 |

### 与「单独任一轴」对比

- E1-C alone：conflict 覆盖 FA 100%，但也覆盖 true 44%。
- E1-A alone：weak 覆盖 FA 高，但 true 也大量 weak。
- **A×C**：FA 全部落入 `weak|conflict`；同时 `weak|agree` / `strong|*` **零 FA**。  
  → 联合比单轴更干净，但仍不是可安全硬拒的分类器。

## E1-B（charMinMargin）三轴补充

| cell | correct | wrong |
|------|--------:|------:|
| `weak\|conflict\|tight` | 3 | 2 |
| `weak\|conflict\|loose` | 0 | 2 |
| 其它（非 weak\|conflict） | 6 | 0 |

- FA 中 high-risk + tight margin：**50%**（不充分）。
- `weak|conflict|loose` 本跑 2 例全是 FA，但样本太小，**不足以**作为 gate 规则。
- 继续印证 E1-B：字级 margin 可辅助解释，不宜单独驱动 Decision。

## True ACCEPT 里为什么 `weak|conflict` 仍成功

本跑 3 例 true 落在高风险格：

| text | charMin | charMinMargin | secondary | 备注 |
|------|--------:|--------------:|-----------|------|
| `beotzq` | 0.54 | 0.085 | `BE` | secondary 极短 / 不可比噪声 |
| `5v6g3e` | 0.55 | 0.127 | `5v6gae` | 仅 1 位差（3↔a） |
| `5sbtyu` | 0.28 | 0.107 | `5sbrxu` | 弱字 + 冲突，但主读碰巧对 |

说明：当前二级源（weak_same_vendor beta）的 conflict **不全是真冲突**；部分是长度/能力不匹配。硬拒会误杀。

## Per-ACCEPT 明细

| outcome | text | char | indep | margin | charMin | charMinMargin | secondary |
|---------|------|------|-------|--------|--------:|--------------:|-----------|
| correct | `kghs43` | weak | agree | loose | 0.4911 | 0.1679 | `kghs43` |
| correct | `beotzq` | weak | conflict | tight | 0.5416 | 0.0851 | `BE` |
| wrong | `vk26om` | weak | conflict | loose | 0.4969 | 0.2075 | `v2oam` |
| wrong | `tpp9ju` | weak | conflict | tight | 0.2116 | 0.0593 | `tp9u` |
| correct | `9hbqky` | weak | agree | loose | 0.4989 | 0.2588 | `9hbqky` |
| correct | `5v6g3e` | weak | conflict | tight | 0.5541 | 0.1265 | `5v6gae` |
| wrong | `cxubrn` | weak | conflict | tight | 0.2283 | 0.0859 | `cxurN` |
| correct | `bp3c6a` | strong | conflict | loose | 0.6141 | 0.449 | `bpac6A` |
| correct | `ym58zn` | strong | agree | loose | 0.7645 | 0.6648 | `ym58zn` |
| wrong | `kwqrwg` | weak | conflict | loose | 0.4834 | 0.2395 | `kwqfwg` |
| correct | `mtgd8k` | strong | agree | loose | 0.8352 | 0.7444 | `mtGd8k` |
| correct | `xvwwve` | weak | agree | loose | 0.4758 | 0.159 | `xvwwve` |
| correct | `5sbtyu` | weak | conflict | tight | 0.2788 | 0.1074 | `5sbrxu` |

## 对路线的裁决

```text
E1-C.1 结论：
  A×C 联合证据能解释「剩余 FA 全部落在 weak|conflict」
  但不能把该格做成硬 gate（true 仍占 33%）
  → 继续 ⏸ E1-D 改 score / gate
```

下一步可选（按优先级）：

1. **真正跨家族 captcha OCR**（能输出字符候选；非 RapidOCR 式空读）→ 净化 conflict 语义  
2. 仅在 evidenceScore 设计里做 **软加权 / 可解释分**（仍须 bench 证明分离度，禁止再抬阈值刷 FA）  
3. 扩大 N 复核 `weak|conflict|loose` 是否稳定偏 FA（观测，不 gate）

当前不应做：

- 调 decision threshold / 开 singletonGate  
- 加 preprocess / 扩 VLM / 改 retry  

脚本：`scripts/e1c1_joint_evidence_report.py`
