# Phase 3 — 问题与验收结论

| 项 | 内容 |
|----|------|
| 状态 | **4/5/6 硬门槛已关闭**（2026-08-07）；**F-BRW-09/10 · F-OBS-02 E2E 已关**（2026-08-13）；**安全登录/自动验证码 E2E 已关**（2026-08-14 `make smoke-auth` 15/15）；**真实站验证码定位 E2E 已关**（同日 `make smoke-auth` **20/20**）；**自建 captcha-solver 单测已关**（同日 `make test-captcha-solver` 8/8） |
| 范围 | 既有验收 **4 BROWSER / 5 BROWSER_AGENT / 6 调度运维面**；增量：安全凭据 + 自动登录 + 运行中验证码探测 + 真实页定位/填写 + **独立识别服务** |
| 策略 | API · SSH · PING：**保留代码、本阶段不验收**（用户确认 A）；**Hermes 不做告警产品** |
| 测试说明 | [`docs/TEST.md`](./TEST.md) |
| 缺陷与优化 | [`docs/DEFECTS.md`](./DEFECTS.md) v1.5 |
| 需求冻结 | [`docs/REQ_CAPTCHA_SOLVER.md`](./REQ_CAPTCHA_SOLVER.md) · [`docs/REQ_CAPTCHA_LIVE.md`](./REQ_CAPTCHA_LIVE.md) · [`docs/REQ_SECURE_AUTH.md`](./REQ_SECURE_AUTH.md) |
| 开发进度 | [`docs/PHASE2.md`](./PHASE2.md) |

---

## 1. 交付结论

### 1.1 既有三项（可维持验收）

| # | 能力 | 证据 |
|---|------|------|
| 4 | 确定性浏览器拨测 | S12 · S13 · `make smoke-browser`（上次 2026-08-12；本期未复跑） |
| 5 | 智能浏览 | T02：`HERMES_LLM_MOCK` + `make smoke-agent` |
| 6 | 调度与运维面 | `make smoke` 16/16；T05 Token+HMAC |

### 1.2 Web Vitals / Trace / Prometheus（已关）

| 需求 | 代码交付 | 验收状态 |
|------|----------|----------|
| F-BRW-09 可选 Web Vitals（仅 BROWSER） | worker `collectWebVitals` → `result.metrics`；UI 提交/详情 | ✅ T-Vitals-01 |
| F-OBS-02 Prometheus 暴露 | worker-core `:8081` journey + vitals；Alertmanager 样例 | ✅ T-Prom-01 · D15 |
| F-BRW-10 Trace→MinIO | SigV4 上传；`traceUrl` / `traceError`；Agent 失败亦可 | ✅ T-Trace-01 |

### 1.3 安全登录 + 运行中验证码（Phase 2 已实现 · E2E 未关）

| 需求 | 代码交付 | 验收状态 |
|------|----------|----------|
| 提交页安全填账号密码 | `SubmitPage` 密码框；高级选择器收起 | ✅ 代码 |
| 读 API 脱敏（F-SEC-02） | `security.RedactedJob`；GET/创建/取消/重跑响应 | ✅ T-Cred-01 |
| 拨测时自动注入登录 | Worker `credentials` → `auth-auto-*` | ✅ T-Cred-02/03/04/05 |
| 运行中自动探测验证码 | `autoCaptcha` 默认开；image/click/slider | ✅ T-CapAuto-01/02/03 |
| 无验证码不调 Webhook | mock `/calls` 计数不变 | ✅ T-CapAuto-04 |
| 未配 Webhook / `autoCaptcha=false` | FAILED；不重试；06 不调 webhook | ✅ T-CapAuto-05/06 |
| 回归 smoke-browser | S12/S13 | ✅ 2026-08-14 复跑 3/3 |

**本期退出门槛**

| 门槛 | 状态 |
|------|------|
| `make test` 含 redact + `auth_captcha_ok` | ✅ 2026-08-14 |
| T-Cred-02 静态登录页自动填密 | ✅ |
| T-CapAuto mock webhook E2E | ✅ `make smoke-auth` 15/15 |
| `make smoke-browser` 回归 | ✅ |

**结论**：登录填写 + 运行中验证码探测 **已可验收**（静态 fixture + mock webhook）。不保证过任意真实站点验证码（ADR-007）。

### 1.4 真实环境验证码定位与正确填写（已关）

触发：任务 `ui-probe`（`0d218ed5-…`）打 `https://51yunwei.com.cn/DCP/`，对不存在的 `#captcha` `fill` 超时（并非填错码）。需求：[`docs/REQ_CAPTCHA_LIVE.md`](./REQ_CAPTCHA_LIVE.md)。

| 需求 | 代码交付 | 验收状态 |
|------|----------|----------|
| 定位以当前页 DOM 为准 | `classifyCaptcha.applicable`；仅可 fill 的 input | ✅ T-LiveCap-06 单测 |
| 禁止无效 `#captcha` 空等 | `pickCaptchaSelector`：user > probe > 可用 webhook | ✅ T-LiveCap-02/05 |
| 用户名 blur 后出码 | fill 用户名 → blur → 再探测 | ✅ T-LiveCap-04 |
| 弱信号不调 Webhook | 仅「图形验证码」文案 | ✅ T-LiveCap-03 |
| mock 不覆盖真实站选择器 | fixture 外 `fillSelector` 用 `hint.selector` | ✅ mock + T-LiveCap-05 |
| 可选 `captchaSelector` | 提交页高级项 + `credentials.captchaSelector` | ✅ 代码 |
| 回归 | T-Cred / T-CapAuto 仍绿 | ✅ `make smoke-auth` **20/20** |

**本期退出门槛**

| 门槛 | 状态 |
|------|------|
| `make test`（含 `pickCaptchaSelector` / 不可 apply 的 image） | ✅ 2026-08-14 |
| T-LiveCap-02/03/04/05 E2E | ✅ |
| 既有 `smoke-auth` 回归 | ✅ 20/20（原 15 条 + 5 条 LiveCap，其中 T-LiveCap-01=T-CapAuto-01） |

**结论**：Hermes **能在真实页结构上找到框并填入求解结果**。正确答案仍依赖 `HERMES_CAPTCHA_WEBHOOK`。用本机 mock 打 DCP 只会填 `AB12`。自建求解器见 §1.5。

### 1.5 自建验证码识别服务（单测已关 · Worker 联调未关）

需求：[`docs/REQ_CAPTCHA_SOLVER.md`](./REQ_CAPTCHA_SOLVER.md)。形态：仓库根目录 `captcha-solver/` 独立进程，**不**编进 `worker-browser`。

| 需求 | 代码交付 | 验收状态 |
|------|----------|----------|
| 独立 HTTP、默认 `:18085` | `captcha-solver/app.py` | ✅ T-Solv-01 |
| Hermes 契约 `POST /captcha` | 另提供 `/v1/captcha/solve`、`/detect` | ✅ T-Solv-02 HTTP |
| 文字 OCR | 本机字体模板滑动匹配（Pillow，无 numpy/OpenCV） | ✅ T-Solv-02 合成图 `AB12` |
| 滑块缺口 | 深色块对，返回 `offsetX` | ✅ T-Solv-03 ±8px |
| 点选色块 | 饱和色连通域中心 | ✅ T-Solv-04 |
| 无法识别 | `solved: false` HTTP 200 | ✅ T-Solv-05 |
| Worker 打本服务过 fixture 登录页 | 现 fixture `/pixel.png` 为 1×1，不是可识别字符图 | ⏳ T-Solv-06 |
| 不破坏 `smoke-auth` mock | 未改 `auth_e2e_server.py` / `auth_captcha_smoke.sh` | ✅ T-Solv-07 `make smoke-auth` **20/20**（2026-08-14 复跑） |
| 文档 | `captcha-solver/README.md`；`worker-browser/README`；`configs/example.env` | ✅ |

**本期退出门槛**

| 门槛 | 状态 |
|------|------|
| `make test-captcha-solver` | ✅ 2026-08-14 **8/8** |
| T-Solv-01–05 | ✅ |
| T-Solv-06 Worker+真实字符 fixture | ⏳ 见 D23 |
| T-Solv-07 `make smoke-auth` 回归 | ✅ 2026-08-14 复跑 **20/20** |

**结论**：仓库内已有可启动的识别服务，合成图三类可过单测。接 Worker：`HERMES_CAPTCHA_WEBHOOK=http://127.0.0.1:18085/captcha` 后重启 browser-worker。公网站 / 极验 / Cloudflare **不保证**（D22/D24）。Verify 仍在 Worker（应用后再探测）。

---

## 2. 已知问题（非阻塞既有 4/5/6）

| ID | 说明 | 建议 |
|----|------|------|
| D09 | bus/scheduler/worker 单测仍薄 | 迭代 C 按需 |
| D10 | slog 结构化日志未做 | 迭代 C 按需 |
| D12 | `node_modules` root 权限阻断 AWS SDK 安装 | 已零依赖缓解；可选修权限 |
| D16 | 登录/验证码 Playwright E2E 未关 | ✅ `make smoke-auth` 现 **20/20** |
| D17 | Redis 任务 payload 密码明文（范围已接受） | 不修；读路径已脱敏 |
| D18 | 失败截图 / Trace 可能含已输入密码（范围已接受） | 不修 DOM 打码 |
| D19 | 验证码 DOM 探测可能误报 | 🟡 缓解：弱文案不调 Webhook；无可见输入框不 `fill` 容器。iframe/极验仍可能误报 |
| D20 | T-CapAuto-05/06 无独立单测 | ✅ 已纳入 `smoke-auth` |
| D21 | 真实站被 mock 写成 `#captcha` 导致 30s 超时（`ui-probe`） | ✅ 选择器以当前页为准；不可用 `fillSelector` 回退探测 |
| D22 | 无识图 Webhook 时真实站无法「填对」 | 🟡 部分缓解：已有自建 `captcha-solver`；模板 OCR 仍过不了公网站（D24） |
| T03 / T04 / T06 | 双 worker / 杀进程 / 池压测 | 非硬门槛 |
| D23 | T-Solv-06：现登录 fixture 图为 1×1 PNG，本服务无法 OCR 出登录页要求的 `AB12` | 下一迭代：可识别字符 fixture 或改 `/pixel.png` |
| D24 | captcha-solver OCR 绑定本机 DejaVu 字体、约 1.5s/图；无 PaddleOCR/OpenCV | 按需换引擎，契约不变 |

---

## 3. 明确不在本阶段 / 本期

- Traceroute / SQL / SNMP（已裁剪）  
- Hermes 内告警规则引擎 / 通知投递（仅 Alertmanager 示例）  
- Trace Base64 进 Job；BROWSER_AGENT 采 Web Vitals  
- Web 终端 / SFTP / F-LLM-07  
- API / SSH / PING 的专项验收  
- 保证过任意真实验证码 / iframe 内极验 / Cloudflare（ADR-007）  
- 把 OCR 编进 `worker-browser`；Solver 内嵌 Playwright / Redis 队列 

---

## 4. 回归命令（运维备忘）

```bash
make test
# 含 Go redact 单测 + worker-browser captcha_ok / auth_captcha_ok

# 需 Redis + gateway + worker-core + dispatcher
HERMES_API_INSECURE=true make smoke
# 另需 browser-worker：HERMES_LLM_MOCK=true
HERMES_API_INSECURE=true make smoke-agent
HERMES_API_INSECURE=true make smoke-browser
HERMES_API_INSECURE=true make smoke-auth   # 会重建/重启 gateway 与 browser-worker
make test-captcha-solver                   # 自建识别服务 8 条单测
```

`smoke-auth` 自带静态登录页与 mock webhook，结束后会把 browser-worker 恢复为无 Webhook。自建求解器需另启 `python3 captcha-solver/app.py`，并把 Worker 的 `HERMES_CAPTCHA_WEBHOOK` 指到 `:18085/captcha`（不要让 `smoke-auth` 指向它）。

---

## 5. 下一动作（产品确认）

1. ~~优先：联调关闭 T-Vitals-01 / T-Trace-01 / T-Prom-01~~ ✅  
2. ~~**迭代 E**：T-Cred-02/05 · T-CapAuto-01–03/05/06 · 复跑 `smoke-browser`~~ ✅ `make smoke-auth` 15/15；`smoke-browser` 3/3  
3. ~~**迭代 F**：真实站验证码定位（T-LiveCap）~~ ✅ `make smoke-auth` 20/20；关闭 D21  
4. 迭代 D 剩余：D12（可选）  
5. 迭代 C：T03 / T04 / T06、D09 / D10  
6. 是否物理裁剪 API/SSH/PING（当前保持 A）  
7. 打公网站：启动 `captcha-solver` 或更强 Webhook；模板 OCR 不够则换 PaddleOCR（D22/D24）  
8. ~~**迭代 G**：自建 captcha-solver 目录与三类引擎~~ ✅ 单测 8/8；T-Solv-07 20/20；T-Solv-06 未关 

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-06 | Phase 3 启动；指向 TEST/DEFECTS |
| 0.2 | 2026-08-07 | 硬门槛关闭：范围 4/5/6 + T01/T02；本文件升级为结论文档 |
| 0.3 | 2026-08-13 | 增补 F-BRW-09/10·F-OBS-02：开发完成、E2E 待关；指向 DEFECTS v0.8 |
| 0.4 | 2026-08-13 | E2E 关闭；D15 worker metrics；DEFECTS v0.9 |
| 0.5 | 2026-08-14 | 安全登录/自动验证码：单测关、E2E 未关；D16–D20 |
| 0.6 | 2026-08-14 | `make smoke-auth` 15/15；关闭 D16/D20；复跑 smoke-browser |
| 0.7 | 2026-08-14 | 真实站验证码定位：`smoke-auth` 20/20；关闭 D21；登记 D22 |
| 0.8 | 2026-08-14 | 自建 captcha-solver：T-Solv-01–05 单测关；登记 D23/D24 |
