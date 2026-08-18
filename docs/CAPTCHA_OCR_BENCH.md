# CAPTCHA OCR 多轮压测报告（:3000 demo）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-15 |
| Demo | `http://192.168.85.144:3000/` |
| 脚本 | `scripts/captcha_ocr_bench.py` / `captcha_ocr_e3_morph_ab.sh` |

## 结论总表

| 轮次 | 要点 | 首试 | Precision | wrong/abstain | 会话 RETRIES=2 |
|------|------|------|-----------|---------------|----------------|
| E2 | dual-support Agreement | 42% | **70%** | 9/20 | 75–82.5% |
| E3 morph=1.0 | 对照（不降权） | 40% | 62.5% | 12/18 | — |
| E3 morph=0.5 | 试探 | **24%**（12/50） | **40%**（12/30） | 18/20 | **67.5% / 62.5%** ❌ |
| E3 morph=0.82 | 试探 | **40%**（20/50） | **62.5%**（20/32） | 12/18 | **72.5% / 62.5%** ❌ |
| E3 morph=0.7 | 试探 | **40%**（20/50） | **58.8%**（20/34） | 14/16 | **75% / 82.5%** |
| **E3 morph=0.8** | **当前默认** | 40% | **66.7%** | 10/20 | **72.5% / 85%**（均值 ~79%） |
| E3 morph=0.0 | 剔除 morph | **46%** | **69.7%** | 10/17 | **75% / 85%** |

### E3 判定

- 加权投票已落地；默认 **`HERMES_CAPTCHA_OCR_MORPH_WEIGHT=0.8`**（扫描后回选）。
- 0.5 / 0.7 / 0.82 均弱于或不及 0.8；0.0 首试略高但会话 Precision 不稳。
- **硬验收未过**；不宣称 E3 关闭会话缺口。

## 环境

```bash
HERMES_CAPTCHA_OCR_MORPH_WEIGHT=0.8   # 默认
HERMES_CAPTCHA_OCR_BETA=1
HERMES_CAPTCHA_OCR_AGREE=1
HERMES_CAPTCHA_OCR_SOFT_CONF=0.45
# … LEN/CHARSET/CASE 同前
```
