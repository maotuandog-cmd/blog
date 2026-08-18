# Phase 1 需求：字符码 OCR 准确度（预处理 / 多版本融合 / 后处理 / 置信度）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-14 |
| 状态 | **已冻结；Phase 2 已落地** |
| 范围协议 | 仅改 `captcha-solver/` 的 **image** 路径；不改 Worker 必填契约；不改 slider/click |
| 触发 | 用户：ddddocr 已能识别，但准确度不高；给出「预处理 → 多版本 OCR → 后处理 → 置信度 → 失败重试」参考架构 |
| 父需求 | `docs/REQ_CAPTCHA_OCR.md`（ddddocr + 模板回退） |
| 关联 | D22 / D24；DCP `https://51yunwei.com.cn/DCP/` |

---

## 1. 目标

在**不换大模型、不改 Webhook 契约**的前提下，提高 `kind=image` 字符码的真实命中率，降低「认错字仍 `solved:true`」导致登录被毒化的概率。

本期把参考架构收敛为验证码专用流水线：

```text
Worker 已裁 ROI（img/canvas）
        │
        ▼
captcha-solver image
        │
   Preprocessor（多版本）
        │
   ddddocr × N（同一请求内）
        │
   结果融合 / 投票
        │
   字符码后处理（长度 / 字符集）
        │
   置信度
        │
   ┌────┴────┐
   │         │
  够高      不够
   │         │
 返回 text  再试其余预处理；仍不够 → 模板或 solved:false
```

核心判断（沿用）：**填错比不填更糟**。低置信度不得用高置信度假值糊弄 Worker。

---

## 2. 非目标（从参考文中明确砍掉）

参考文面向「通用文档 OCR / 中文运维日志 / 多引擎网关」。下列**本期不做**：

| 项 | 原因 |
|----|------|
| 整页截图再 OCR | Worker 已对验证码 img/canvas **ROI 裁剪**（`screenshotCaptchaRegion`）；本期不改 Worker |
| PaddleOCR / Tesseract / EasyOCR / Vision LLM 集成 | 重、依赖大；本机无系统 pip/apt；ddddocr 已能出字 |
| Redis 缓存 | 验证码每张唯一，缓存无收益 |
| 中文词典 / 运维术语纠错 | 场景是字母数字图形码，不是文档 |
| IP / 日期 / 金额格式校验 | 不适用 |
| 超分辨率模型、透视矫正、文档 deskew | 验证码图小、来自页面元素，不是手机拍照扫描件 |
| 把求解器改写成 Go OCR Gateway | 仍 Python `captcha-solver` |
| 改 `make smoke-auth` | 仍 `:18084` mock |
| 保证 DCP / 任意公网站 100% | ADR-007 |
| slider / click 走这套流水线 | 仍现有 CV |
| 系统级 apt/pip | 继续 `.venv` |

---

## 3. 现状缺口（相对参考架构）

| 参考步骤 | 现状 | 问题 |
|----------|------|------|
| 预处理 | 原图 PNG 直接 `classification` | 小图、彩噪、旋转字无增强 |
| 多版本 OCR | 一张图只跑一次 | 无投票，一次认错即填错 |
| 后处理 | `strip` 原样返回（上期冻结：不做大小写猜测） | 无长度/字符集约束 |
| 置信度 | 固定 `0.8` | 无法区分稳/不稳 |
| 失败策略 | 非空即 `solved:true`，否则模板 | 错字也会当成功 |
| ROI | Worker 已做 | 求解器侧仍可去白边，但不必再改 Worker |

---

## 4. 建议冻结

| # | 项 | 决策 | 来源 |
|---|-----|------|------|
| 1 | 提准手段 | **预处理 + 多版本投票 + 字符码后处理 + 真实置信度**；不换主引擎 | 用户参考架构 + 本场景裁剪 |
| 2 | 主引擎 | 仍 **ddddocr**；失败回退模板（`HERMES_CAPTCHA_OCR` 不变） | 沿用 `REQ_CAPTCHA_OCR` |
| 3 | 范围 | 仅 `captcha-solver` image；HTTP 必填字段不变 | 沿用契约 |
| 4 | 多版本 | **同一次 HTTP 内**对若干预处理图各跑一次 ddddocr，再融合；不额外打 Worker | 建议冻结 |
| 5 | 预处理集（最小集） | ①原图 ②放大 2× ③灰度+对比度 ④去白边后放大。有 OpenCV 时再加 CLAHE / 自适应二值化，无则 Pillow 等价 | 建议冻结 |
| 6 | 融合 | 规范化后 **多数投票**；平票取出现次数最高且长度合法者 | 建议冻结 |
| 7 | 后处理 | 去空白；只保留 `[A-Za-z0-9]`；长度须在 **4–6**（DCP 一类四位码）。**不做**全表 `O→0` / 大小写强制（字符集同时含字母数字时会改错） | 修正上期「完全原样」：只做过滤与长度，不做易混字硬映射 |
| 8 | 置信度 | `confidence = 得票数 / 有效 OCR 次数`（0–1）。日志带 `engine`、`preprocess`（胜出版本名）、`votes` | 建议冻结 |
| 9 | 阈值 | `HERMES_CAPTCHA_OCR_MIN_CONF`，默认 **0.5**。低于阈值 → 不返回该 text 为成功；再走模板（仅正放深色字）或 `{solved:false}` | 建议冻结 |
| 10 | 模板 | 行为不变：彩色/旋转图拒绝硬猜 | 沿用 |
| 11 | Worker | **不改**。低置信由求解器 `solved:false`，Worker 既有重试/失败路径负责 | 建议冻结 |
| 12 | 精度承诺 | 提高稳定样例与 DCP 类四位码命中；**不承诺**过码 | ADR-007 |

---

## 5. 需求明细

### 5.1 预处理版本

每个版本产出一张 RGB/PNG 给 ddddocr。建议名称（写入响应可选字段 `preprocess`）：

| 名 | 操作 |
|----|------|
| `raw` | 原图 |
| `up2` | 最长边 &lt; 200px 时放大到约 2×（LANCZOS） |
| `gray_contrast` | 灰度 + 拉伸对比度 |
| `trim_up2` | 裁掉近白边后再放大 |
| `clahe` | 可选，需 OpenCV |
| `bin` | 可选，自适应二值化 |

`HERMES_CAPTCHA_OCR=template` 时整段跳过（与上期 T-Ocr-03 一致）。

单次请求内 OCR 次数建议 **≤ 6**，避免把 Webhook 超时打满（Worker 侧已有超时）。

### 5.2 融合与置信度

1. 各版本文本 → 后处理（§4.7）；空串丢弃。  
2. 对规范化串计数。  
3. 胜出串得票率 ≥ `MIN_CONF` 且长度合法 → `solved:true`。  
4. 否则视为失败，走模板或 `solved:false`。  
5. 禁止再写死 `confidence: 0.8`。

示例：四次有效结果 `a8bv / a8bv / a8b / a8bv` → 胜出 `a8bv`，`confidence=0.75`。

### 5.3 响应（可选字段，Worker 可忽略）

必填语义不变：`solved` / `kind` / `text`。

可增补：

```json
{
  "solved": true,
  "kind": "image",
  "text": "a8bv",
  "confidence": 0.75,
  "engine": "ddddocr",
  "preprocess": "up2",
  "votes": 3
}
```

日志增加：`engine`、`preprocess`、`confidence`、`votes`（已有 `engine` 则补其余）。

### 5.4 与 Worker ROI 的关系

参考文强调 ROI。现状已满足：

- 优先截验证码 **img/canvas/容器**，失败才视口。  
- 求解器**不要**假设整页截图；可做去白边，但定位仍归 Worker。

本期**不**为提准去改 Playwright 截图逻辑。

---

## 6. 验收

| ID | 内容 | 期望 |
|----|------|------|
| T-Acc-01 | fixture `AB12`，`OCR=template` | 仍 `text=AB12`（回归 T-Ocr-01） |
| T-Acc-02 | 有 ddddocr，合成 `AB12` | `solved=true`，大小写按引擎，`confidence` 随投票变化且 ≠ 固定 0.8 |
| T-Acc-03 | 彩色旋转合成码（如 `A8bV`） | 投票后与标签 **casefold** 一致，或 `solved=false`（禁止模板乱填） |
| T-Acc-04 | 明显不是字符码的空白图 | `solved=false` |
| T-Acc-05 | `HERMES_CAPTCHA_OCR=template` | 不跑多版本 ddddocr |
| T-Acc-06 | `make test-captcha-solver` | 全绿；无 ddddocr 时 skip 依赖引擎的用例 |
| T-Acc-07 | `make smoke-auth` | 不改脚本 |
| 文档 | README：预处理/投票/`MIN_CONF` | |

DCP 真站仍为**手工拨测**，不作为硬门槛。

---

## 7. 确认清单（请确认后进入 Phase 2）

| # | 项 | 请确认 |
|---|-----|--------|
| 1 | 提准靠预处理 + 同请求多版本投票 + 长度/字符集过滤 + 真实置信度，**不**上 Paddle/LLM/Redis | ✅ |
| 2 | 不改 `/captcha` 必填字段；不改 Worker / slider / click | ✅ |
| 3 | 低置信度 `solved:false`，宁可不填也不填错 | ✅ |
| 4 | 不做 `O↔0` / 大小写硬映射 | ✅ |
| 5 | 不保证 DCP 100%；不改 smoke-auth | ✅ |

Phase 2 已落地：`solvers/enhance.py` 多版本预处理；`solvers/ocr.py` 投票 / 长度过滤 / `HERMES_CAPTCHA_OCR_MIN_CONF`；日志 `preprocess`+`votes`。
