# Phase 1 需求：字符码 OCR 升级为 ddddocr（模板回退）

| 项 | 内容 |
|----|------|
| 日期 | 2026-08-14 |
| 状态 | **已冻结；Phase 2 已落地** |
| 范围协议 | 仅改 `captcha-solver/` 的 **image** 引擎；不改 Worker Webhook 契约；不改 slider/click |
| 触发 | DCP（`51yunwei.com.cn`）已能探测并 `POST /captcha`，模板 OCR 返回 `ocr low confidence`；用户确认改用 ddddocr 提高准确度 |
| 父需求 | `docs/REQ_CAPTCHA_SOLVER.md` |
| 关联 | D22 / D24 |

---

## 1. 目标

字符码（`kind=image` / 分类为 image）优先用 **ddddocr** 离线识别，提高对彩色、旋转、扭曲字母数字码（含 DCP 一类）的命中率。

`POST /captcha` 路径、请求/响应字段、Worker 配置方式 **不变**。装不上或调用失败时 **回退现有模板 OCR**，本机 fixture `AB12` 仍可过。

---

## 2. 非目标

| 项 | 说明 |
|----|------|
| 改 Hermes / Worker JSON 契约 | ❌ |
| 把 ddddocr 编进 `worker-browser` | ❌ |
| 用 ddddocr 解滑块 / 点选 / 极验 | ❌ 本期仍走现有 slider/click |
| 保证 DCP 或任意公网站 100% | ❌ ADR-007 |
| 云 OCR / 打码平台账号 | ❌ |
| 改 `make smoke-auth` 去打本服务 | ❌ 仍用 `:18084` mock |
| 系统级 `apt/pip` 装到全局 Python | ❌ 使用 `captcha-solver/.venv` |

---

## 3. 建议冻结

| # | 项 | 决策 | 来源 |
|---|-----|------|------|
| 1 | image 主引擎 | **ddddocr**（`classification`） | 用户 2026-08-14「好的」 |
| 2 | 回退 | 未安装 / import 失败 / 抛错 / 空文本 → 现有模板 OCR | 建议冻结 |
| 3 | 开关 | `HERMES_CAPTCHA_OCR=auto\|ddddocr\|template`，默认 `auto` | 建议冻结 |
| 4 | HTTP | 仍 `POST /captcha`；可增补日志字段 `engine=ddddocr\|template` | 沿用契约 |
| 5 | 依赖 | `captcha-solver/requirements-ocr.txt` + `.venv`；README 写安装步骤 | 建议冻结 |
| 6 | 滑块/点选 | **不改** | 建议冻结 |
| 7 | 文本 | ddddocr 返回值 **strip** 后原样给 Worker，不做大小写猜测 | 建议冻结 |
| 8 | 精度 | 尽力提高 DCP 字符码；不承诺过码 | 建议冻结 |

---

## 4. 需求明细

### 4.1 识别顺序（`auto`）

1. 若 `HERMES_CAPTCHA_OCR=template` → 只走模板。  
2. 若 `ddddocr` 或 `auto`：尝试 `ddddocr.DdddOcr(show_ad=False).classification(png_bytes)`。  
3. 得到非空字符串 → `{ "solved": true, "kind": "image", "text": "..." }`，日志 `engine=ddddocr`。  
4. 否则回退模板；模板也失败 → `{ "solved": false, "reason": "..." }`，`engine` 标明最后一次尝试。

彩色/旋转图不再用「模板硬猜填错字」；只有 ddddocr 或模板真正给出文本才 `solved: true`。

### 4.2 安装（本机约束）

当前系统 Python 无 pip、无 apt 权限。Phase 2 应：

1. `python3 -m venv captcha-solver/.venv`（若 `ensurepip` 可用）。  
2. `.venv/bin/pip install -r requirements-ocr.txt`（`ddddocr`）。  
3. 启动改为 `.venv/bin/python app.py`（README 写明）。  

venv/`ensurepip` 仍失败则：**代码按回退路径可运行**；README 说明需在可装包环境创建 venv。不把大模型文件提交进 git。

### 4.3 Worker

不变。仍：

```bash
HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha
```

改 OCR 后只需**重启 captcha-solver**（不必为换引擎改 Worker，除非 Webhook 本来就没配）。

---

## 5. 验收

| ID | 内容 | 期望 |
|----|------|------|
| T-Ocr-01 | 无 ddddocr 时 fixture `AB12` | 模板仍 `solved=true text=AB12` |
| T-Ocr-02 | 有 ddddocr 时合成/样例字符图 | `engine=ddddocr` 且文本与标签一致（允许大小写按引擎原样） |
| T-Ocr-03 | `HERMES_CAPTCHA_OCR=template` | 强制不加载/不调用 ddddocr |
| T-Ocr-04 | HTTP `POST /captcha` 契约 | Worker 可解析的 `solved/kind/text` |
| T-Ocr-05 | `make test-captcha-solver` | 全绿（无 ddddocr 时跳过 T-Ocr-02 或标 skip） |
| T-Ocr-06 | `make smoke-auth` | 不改脚本；不强制本期复跑 |
| 文档 | README：venv + ddddocr 安装、`HERMES_CAPTCHA_OCR` | |

DCP 真站作为**手工拨测**，不作为硬门槛。

---

## 6. 确认清单（请确认后进入 Phase 2）

| # | 项 | 状态 |
|---|-----|------|
| 1 | image 优先 ddddocr，失败回退模板 | ✅ 用户已口头确认方向 |
| 2 | 不改 `/captcha` 契约；不改 slider/click | ✅ |
| 3 | 默认 `auto`；可强制 `template` / `ddddocr` | ✅ |
| 4 | 依赖放 `.venv`，装不上则模板仍可用 | ✅ |
| 5 | 不保证 DCP 100%；不改 smoke-auth | ✅ |

Phase 2 已落地：`captcha-solver/.venv` + `requirements-ocr.txt`；`solvers/ocr.py` 优先 ddddocr、失败回退模板；日志/响应 `engine`；单测 T-Ocr-01/02/03。
