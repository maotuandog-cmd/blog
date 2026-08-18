# Hermes 测试说明

| 项 | 内容 |
|----|------|
| 文档类型 | Phase 3 · 测试说明 |
| 日期 | 2026-08-06 |
| 覆盖范围 | **本阶段验收**：BROWSER / BROWSER_AGENT / 调度运维面；API·SSH·PING 保留但不作为完成门槛 |
| 关联 | `docs/REQUIREMENTS.md` · `docs/PHASE2.md` · `docs/DEFECTS.md` |

---

## 1. 测试环境

| 组件 | 要求 |
|------|------|
| Go | 1.22+（仓库 `go.mod` 为准） |
| Redis | `127.0.0.1:6379`（可用本机 `redis-server` 或容器） |
| Node / Playwright | 测 Browser：`cd worker-browser && npm install && npm run build && npx playwright install chromium` |
| 外网 | API 对公网目标（如 httpbin）依赖网络质量；建议联调用本机 mock HTTP |
| 鉴权 | 联调可设 `HERMES_API_INSECURE=true`；正式环境设 `HERMES_API_TOKEN` |

启动顺序：

```bash
# Redis
redis-server --daemonize yes --port 6379   # 或 docker redis

# Browser worker（可选，测 BROWSER / BROWSER_AGENT 时必须）
cd worker-browser && npm install && npx playwright install chromium && npm run build
HERMES_ALLOWED_HOSTS=example.com,httpbin.org,127.0.0.1 HERMES_BROWSER_PORT=8090 HERMES_LLM_MOCK=true npm start

# Go 进程
export HERMES_API_INSECURE=true
export HERMES_REDIS_ADDR=127.0.0.1:6379
export HERMES_ALLOWED_HOSTS=example.com,httpbin.org
go run ./cmd/gateway &
go run ./cmd/dispatcher &
go run ./cmd/worker-core &
```

---

## 2. 自动化单测（必跑）

```bash
cd hermes
go test ./... -count=1
cd worker-browser && npm test
make test-captcha-solver
```

### 2026-08-06 全部测试执行结果

| 类别 | 结果 |
|------|------|
| `make test`（Go + resources TS） | ✅ 全绿（2026-08-12 复跑） |
| `scripts/smoke.sh`（本机 Redis + gateway/worker/dispatcher） | ✅ **16/16**（2026-08-12） |
| 扩展联调：CookieJar / hard drain / reclaim120 / cancel / idem / timed fire / agent host | ✅ 含于 smoke |
| Token + HMAC 独立网关（`:18082`） | ✅ 无 Token/错 Token/缺 HMAC→401；双正确→202（2026-08-07 复测） |
| Browser E2E（S12/S13 + 不重试） | ✅ `make smoke-browser`（2026-08-12）：auth 失败无业务步；byType 有值；assert→FAILED `retryable=false` |
| Agent mock（T02） | ✅ `HERMES_LLM_MOCK=true` + `make smoke-agent` → SUCCESS + summary（2026-08-12） |
| Web Vitals / Trace / Prom（单测） | ✅ `worker-browser` vitals merge + `go test ./internal/metrics`（2026-08-13）；E2E 见下表 T-Vitals/Trace/Prom |
| T-Vitals / T-Trace / T-Prom E2E | ✅ `make smoke-vitals`（2026-08-13）：Vitals TTFB/FCP/LCP；Trace→MinIO `traceUrl`；worker `:8081/metrics` journey+vitals |
| 安全登录 / 验证码单测 | ✅ `make test`（2026-08-14）：Go redact + `captcha_ok` + `auth_captcha_ok` |
| 安全登录 / 验证码 E2E | ✅ `make smoke-auth`（2026-08-14）：T-Cred · T-CapAuto · T-LiveCap **20/20** |
| 自建 captcha-solver | ✅ `make test-captcha-solver`（2026-08-14）**8/8**（T-Solv-01–05）；T-Solv-06/07 未关 |

**结论**：本阶段硬门槛 4/5/6（含 T01/T02）已可验收；F-BRW-09/10·F-OBS-02 E2E 已关；安全登录/自动验证码 **单测 + E2E 已关**；真实站验证码**定位/填写控件** E2E 已关；**识别服务单测已关**。缺口剩 T-Solv-06/07、T03/T04/T06 与 D09/D10/D23/D24；公网站过码需更强引擎或外接 Webhook（D22/D24）。

---

## 3. 联调冒烟用例

本地 HTTP mock（推荐，避免依赖公网）：

```bash
python3 - <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1', 18080), H).serve_forever()
PY
```

| ID | 场景 | 步骤 | 期望 |
|----|------|------|------|
| S01 | 健康检查 | `GET /healthz` `/readyz` | 200 |
| S02 | API 拨测 + 耗时 | `POST /v1/jobs` protocol=API → 本机 18080 | SUCCESS；`metrics.hermes_api_ttfb_ms` ≥ 0 |
| S03 | PING | protocol=PING host=127.0.0.1 | SUCCESS |
| S04 | Agent 缺 purpose | BROWSER_AGENT 无 purpose | 400 |
| S05 | Agent 域名拒绝 | startUrl 不在 `HERMES_ALLOWED_HOSTS` | 400 |
| S06 | 审计 | `GET /v1/audit?limit=20` | count ≥ 1 |
| S07 | 队列积压 | `GET /v1/admin/queue` | 含 streamLength/pending/drain |
| S08 | 排水 | drain enabled=true 后再建任务 | 503；关闭后恢复 |
| S09 | 取消定时任务 | type=timed + cancel | status=CANCELLED |
| S10 | 幂等 | 相同 Idempotency-Key 两次 | 同 id + `Idempotency-Replayed` |
| S11 | 指标 | `GET /metrics` | 200，含 hermes_* |
| S12 | Browser 鉴权段 | authSteps 失败步骤 | 不执行业务 steps |
| S13 | 资源采集 | BROWSER `collectResources:true` | `extra.resources.byType` 存在 |
| S14 | HMAC | 配置 `HERMES_HMAC_SECRET`，错误签名 | 401 |
| S15 | Token | 配置 `HERMES_API_TOKEN`，无 Bearer | 401 |

### 2026-08-06 冒烟结果（本机 Redis + gateway/worker/dispatcher）

| ID | 结果 | 备注 |
|----|------|------|
| S01 | ✅ | |
| S02 公网 httpbin | ❌ 环境 | 目标返回 **503**（非引擎逻辑错误）；改本机 18080 后 ✅，TTFB 有值 |
| S03 | ✅ | |
| S04–S11 | ✅ | |
| S12–S13 | ✅ | 2026-08-07：Chromium + browser-worker；S12 无业务 step；S13 `byType` 含 document/script/stylesheet |
| S14–S15 | ✅（单测覆盖） | 冒烟进程使用 INSECURE 模式 |

---

## 4. 协议验收要点

### API
- 成功/失败语义清晰；`auth` 失败整单失败  
- `extra.timing` / `metrics`：`dns/connect/tls/ttfb/total`（不可采为 -1）  
- 鉴权响应 `Set-Cookie` 会转发到后续 request  

### BROWSER
- `authSteps` 失败即停  
- `collectResources` 默认关；开启后聚合 byType/byHost/slowest  
- 失败含 `artifacts.screenshotPngBase64` / `pageText`  

### BROWSER_AGENT
- 强制 purpose + 白名单  
- 可选 `collectResources`、总结 `extra.summary`  

### 调度 / 管理
- timed + dispatcher；cancel / rerun；drain；DLQ；audit  

---

## 5. Web Vitals / Trace / Prometheus（F-BRW-09/10 · F-OBS-02）

| ID | 场景 | 步骤 | 期望 |
|----|------|------|------|
| T-Vitals-01 | 合成 Vitals | `BROWSER` + `collectWebVitals=true` → 静态页 | `result.metrics` 含可采到的 `hermes_browser_{ttfb,fcp,lcp}_ms`（缺省项省略，不造假 0） | ✅ 2026-08-13 |
| T-Trace-01 | 失败 Trace→MinIO | 配置 `HERMES_S3_*`；断言失败任务 | MinIO 有对象；Job `artifacts.traceUrl`（或 `traceError`）；成功默认无 Trace | ✅ 2026-08-13 |
| T-Prom-01 | 指标刮取 | 成功 Vitals 任务后刮取 **worker-core** `HERMES_METRICS_ADDR`（默认 `:8081/metrics`） | 含 `hermes_browser_journey_finished_total` 与 vitals histogram buckets | ✅ 2026-08-13 |

> 说明：journey/vitals 在执行端 `worker-core` 观测；Gateway `:8080/metrics` 仍为入队等控制面指标。Prometheus 需同时刮取二者（或仅 worker 若只关心体验指标）。

Alertmanager 仅配置样例：`deploy/alertmanager-browser-examples.yml`（Hermes 不实现告警产品）。

```bash
make smoke-vitals   # T-Vitals-01 / T-Trace-01 / T-Prom-01
```

---

## 6. 回归命令速查

```bash
# 单测
go test ./... -count=1

# 资源聚合 + LLM mock + web vitals 单测
cd worker-browser && npm test

# 冒烟（需已启动服务）
make smoke
make smoke-agent   # browser-worker 需 HERMES_LLM_MOCK=true
make smoke-browser # S12/S13 + 断言失败不重试（需 browser-worker + Chromium）
make smoke-ops     # cancel / rerun / drain / reclaim
make smoke-vitals  # T-Vitals / T-Trace / T-Prom（需 S3 + browser-worker）
make smoke-auth    # T-Cred / T-CapAuto / T-LiveCap（会重启 gateway/browser-worker；结束恢复为无 Webhook）
```

---

## 7. 验证码可插拔（F-BRW-06）+ 安全登录

| ID | 场景 | 期望 | 状态 |
|----|------|------|------|
| T-Auth-01 | 无验证码 fill+click | 与现网一致 | 既有 smoke-browser / 手动 |
| T-Cap-01/02/03 | mock image/click/slider 自动应用 | 单测覆盖 kind 推断；E2E `smoke-auth` | 单测 ✅ · E2E ✅ |
| T-Cap-04 | 无 `HERMES_CAPTCHA_WEBHOOK` + `solveCaptcha` | 失败含 `not configured` | ✅ 单测 |
| T-Cred-01 | GET/创建响应密码 `[REDACTED]` | 不含明文 | ✅ `make smoke-auth` |
| T-Cred-02 | 静态登录页自动填密后业务断言 | SUCCESS + `auth-auto-*` | ✅ |
| T-Cred-03 | 无凭据不注入 auth-auto | 无 `auth-auto` 步骤 | ✅ |
| T-Cred-04 | 多密码框无选择器失败 | FAILED ambiguous | ✅ |
| T-Cred-05 | 重跑仍成功且响应脱敏 | SUCCESS + `[REDACTED]` | ✅ |
| T-CapAuto-01/02/03 | mock 字符/点选/滑块自动探测并登录 | SUCCESS | ✅ |
| T-CapAuto-04 | 无验证码不调用 Webhook | calls 不变 | ✅ |
| T-CapAuto-05 | 探测到但未配 Webhook | FAILED 非 RETRY_WAIT | ✅ |
| T-CapAuto-06 | `autoCaptcha=false` | 失败且不调 Webhook | ✅ |
| T-LiveCap-02 | `#verification` 无 `#captcha` | 填 `#verification` 登录成功 | ✅ |
| T-LiveCap-03 | 仅「图形验证码」文案 | 不调 Webhook，登录成功 | ✅ |
| T-LiveCap-04 | blur 后才出码 | fill 用户名后填 `#verification` | ✅ |
| T-LiveCap-05 | webhook `fillSelector=#captcha` 不存在 | 回退探测框，无 Timeout | ✅ |
| T-LiveCap-06 | 仅容器无 input | 单测：found 但不可 apply | ✅ |
| T-Solv-01 | solver `GET /health` | 200 | ✅ |
| T-Solv-02 | 合成字符图 | `text=AB12` | ✅ |
| T-Solv-03 | 合成滑块 | `offsetX` ±8 | ✅ |
| T-Solv-04 | 合成点选 | 3 点落在目标内 | ✅ |
| T-Solv-05 | 空图 | `solved:false` HTTP 200 | ✅ |
| T-Solv-06 | Worker 指向 `:18085` + 可识别登录图 | SUCCESS 且非 mock 写死 | ⏳ D23 |
| T-Solv-07 | `make smoke-auth` 仍走 mock | 20/20 | ✅ 2026-08-14 复跑 |

契约见 `docs/REQ_SECURE_AUTH.md`、`docs/REQ_CAPTCHA_LIVE.md`、`docs/REQ_CAPTCHA_SOLVER.md`、`captcha-solver/README.md`。

---

## 8. 已知测试缺口

见 `docs/DEFECTS.md`。本阶段硬门槛 T01/T02 已关闭；T-Vitals/Trace/Prom E2E ✅；安全登录/验证码 E2E ✅ `make smoke-auth`；captcha-solver 单测 ✅；T-Solv-06/07 与 T03–T04/T06 按需。
