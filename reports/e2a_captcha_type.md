# E2-A：Captcha Type Detector

**范围**：observation only；不改 Decision / secondary 实际调用 / threshold。

- label=`E2-A-captcha-type` rounds=40 missingType=0
- routingApplied=False (E2-A hint only)
- abstainRate simple=None distorted=0.75

## Type distribution

| type | n | abstain | correct | wrong |
|------|--:|--------:|--------:|------:|
| `text_distorted` | 40 | 30 | 6 | 4 |

## Routing hint (not applied)

- recommendSecondary=true: **40**
- recommendSecondary=false: **0**

## Accept pool: agree / comparable by type

| type | accepts | agree | comparable | incomparable |
|------|--------:|------:|-----------:|-------------:|
| `text_distorted` | 10 | 1 | 4 | 6 |

## 裁决

**weak_or_homogeneous** — demo domain mostly one text subtype; observation shipped; E2-B may still probe type-aware secondary skip/force

### 对 E2-B 的含义

- Detector 已落地为可观测字段；`routingHint.applied=false`。
- 下一步 E2-B 可用 `recommendSecondary` 做 **对照探针**（仍可开关，默认不改线上）。
- 继续继承：length_mismatch / empty ≠ independentConflict。

