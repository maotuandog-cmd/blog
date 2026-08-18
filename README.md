# Hermes

下一代运维执行引擎。**本阶段交付焦点**：确定性浏览器拨测、智能浏览、调度与运维面（见下）。  
需求见 `docs/REQUIREMENTS.md`，决策见 `docs/ADR.md`，进度见 `docs/PHASE2.md`，测试见 `docs/TEST.md`，缺陷计划见 `docs/DEFECTS.md`。

## 本阶段目标（4 / 5 / 6）

| # | 能力 | 协议 / 面 |
|---|------|-----------|
| 4 | 确定性浏览器拨测 | `BROWSER` |
| 5 | 智能浏览 + 总结 | `BROWSER_AGENT`（可用 `HERMES_LLM_MOCK=true` 无云 Key 验收） |
| 6 | 调度与运维面 | 定时 / 取消重跑 / 排水回收 / 审计 / metrics / Bearer+HMAC |

API / SSH / PING **代码保留、本阶段不纳入完成验收**。

## 组件

| 进程 | 说明 |
|------|------|
| `cmd/gateway` | HTTP：入队、查任务、健康检查、指标、管理 API |
| `cmd/dispatcher` | 定时任务调度 |
| `cmd/worker-core` | 消费 Redis Stream（本阶段主用 BROWSER / BROWSER_AGENT） |
| `worker-browser` | Playwright（TypeScript）：确定性旅程 + Agent |

## 快速开始

```bash
redis-server --daemonize yes --port 6379

cd worker-browser && npm install && npx playwright install chromium && npm run build

# 终端1 — browser worker（本地 Agent 验收开 MOCK）
export HERMES_ALLOWED_HOSTS=127.0.0.1,example.com
export HERMES_LLM_MOCK=true
npm start

# 终端2/3/4
export HERMES_API_INSECURE=true
export HERMES_ALLOWED_HOSTS=127.0.0.1,example.com
go run ./cmd/gateway
go run ./cmd/dispatcher
go run ./cmd/worker-core
```

生产请设 `HERMES_API_TOKEN`（勿用 INSECURE）；可选 `HERMES_HMAC_SECRET`。真实 LLM 时关闭 MOCK 并设 `HERMES_LLM_API_KEY`。

## 拨测控制台（hermes-ui）

```bash
cd hermes-ui && npm install && npm run dev
# http://192.168.85.144:5173  （代理 Gateway :8080）
```

Phase A：总览大盘、拨测任务、可用性、性能入口、错误、趋势、告警/节点占位；仅 BROWSER / BROWSER_AGENT。应用 ≈ 任务名（提交带 `labels.app`）。

## API 拨测（P0）

推荐用本机 mock，避免公网样例不稳定（见 `docs/DEFECTS.md` D02）：

```bash
# 另开终端：python3 -m http.server 18080  或任意本机 200 服务
curl -s localhost:8080/v1/jobs \
  -H "content-type: application/json" \
  -H "Authorization: Bearer change-me" \
  -H "Idempotency-Key: api-demo-1" \
  -d "{
  \"name\": \"api-demo\",
  \"protocol\": \"API\",
  \"payload\": {
    \"request\": { \"method\": \"GET\", \"url\": \"http://127.0.0.1:18080/\", \"expectStatus\": [200] }
  }
}"
```

结果 `metrics` / `extra.timing` 含 DNS / Connect / TLS / TTFB / Total。鉴权步骤用 `payload.auth`，同任务内 CookieJar 自动携带会话 Cookie。探测客户端禁用 Keep-Alive，便于采到分段耗时。

## 定时任务（P0）

```bash
curl -s localhost:8080/v1/jobs \
  -H "content-type: application/json" \
  -H "Authorization: Bearer change-me" \
  -d "{
  \"name\": \"api-later\",
  \"type\": \"timed\",
  \"runAt\": \"2026-08-06T08:00:00Z\",
  \"protocol\": \"API\",
  \"payload\": {
    \"request\": { \"method\": \"GET\", \"url\": \"https://httpbin.org/get\", \"expectStatus\": [200] }
  }
}"
```

需运行 `cmd/dispatcher`；到期后自动入队由 worker 执行。

## 智能浏览 + 总结（P1）

前提：配置 `HERMES_ALLOWED_HOSTS`、`HERMES_LLM_API_KEY`；默认反检测 **L3**（可设 `antiDetect: "L2"` 降级）。

```bash
curl -s localhost:8080/v1/jobs \
  -H "content-type: application/json" \
  -H "Authorization: Bearer change-me" \
  -d "{
  \"name\": \"agent-demo\",
  \"protocol\": \"BROWSER_AGENT\",
  \"timeoutSec\": 300,
  \"payload\": {
    \"goal\": \"打开首页并总结页面主题\",
    \"startUrl\": \"https://example.com\",
    \"purpose\": \"authorized-synthetic-check\",
    \"allowedHosts\": [\"example.com\"],
    \"antiDetect\": \"L3\",
    \"maxSteps\": 8,
    \"summarize\": true
  }
}"
```

查询：`GET /v1/jobs/{id}`。结果 `extra.summary` 为结构化总结，`extra.extracted` 为抽取数据；失败时 `artifacts.screenshotPngBase64` / `artifacts.pageText` 为排障证据。

## 浏览器拨测 + 鉴权段 + 资源耗时（可选）

默认不做全量瀑布；`collectResources: true` 时返回按类型/域名聚合的耗时（性能/排障层）。有 `authSteps` 时默认仅在鉴权成功后的业务段采集（`collectMode: "afterAuth"`）。

```bash
curl -s localhost:8080/v1/jobs \
  -H "content-type: application/json" \
  -H "Authorization: Bearer change-me" \
  -d "{
  \"name\": \"browser-res\",
  \"protocol\": \"BROWSER\",
  \"payload\": {
    \"authSteps\": [
      { \"action\": \"navigate\", \"url\": \"https://example.com/login\" },
      { \"action\": \"fill\", \"selector\": \"#user\", \"value\": \"probe\" },
      { \"action\": \"fill\", \"selector\": \"#pass\", \"value\": \"***\" },
      { \"action\": \"click\", \"selector\": \"button[type=submit]\" }
    ],
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"https://example.com/app\" },
      { \"action\": \"assertText\", \"selector\": \"h1\", \"value\": \"Dashboard\" }
    ],
    \"collectResources\": true,
    \"collectMode\": \"afterAuth\"
  }
}"
```

结果：`extra.resources`（byType / byHost / slowest）；`metrics.hermes_browser_resource_*`。鉴权失败则不跑业务段。需要明细列表时设 `resourceDetail: true`。

## Ping 诊断（P1）

```bash
curl -s localhost:8080/v1/jobs \
  -H "content-type: application/json" \
  -H "Authorization: Bearer change-me" \
  -H "X-Actor: ops" \
  -d "{
  \"name\": \"ping-demo\",
  \"protocol\": \"PING\",
  \"payload\": { \"host\": \"1.1.1.1\", \"count\": 3 }
}"
```

## 审计检索（P0）

```bash
curl -s "localhost:8080/v1/audit?protocol=PING&limit=20" \
  -H "Authorization: Bearer change-me"
```

可选查询参数：`from`/`to`（RFC3339）、`actor`、`jobId`、`protocol`、`limit`。

## 管理 API（P1）

```bash
# 队列积压
curl -s localhost:8080/v1/admin/queue -H "Authorization: Bearer change-me"

# 强制回收空闲 pending 并重新入队
curl -s -X POST "localhost:8080/v1/admin/reclaim?minIdleSec=0&count=32" \
  -H "Authorization: Bearer change-me"

# 排水下线 / 恢复接单（soft=拒新单消化存量；hard=同时停止 claim）
curl -s -X POST localhost:8080/v1/admin/drain \
  -H "Authorization: Bearer change-me" -H "content-type: application/json" \
  -d '{"enabled":true,"mode":"soft"}'
```

强制回收默认 `minIdleSec=120`（与租约对齐）；仅在确认无活跃消费时再设 `minIdleSec=0`。

任务取消 / 终态重跑：

```bash
curl -s -X POST localhost:8080/v1/jobs/{id}/cancel -H "Authorization: Bearer change-me"
curl -s -X POST localhost:8080/v1/jobs/{id}/rerun  -H "Authorization: Bearer change-me"
```

## 安全约束

- Agent 任务缺 `purpose` / 白名单外域名 → 拒绝  
- 送往公有云 LLM 前脱敏（密码/Token/Cookie）  
- L3：指纹脚本 + 可选代理（`HERMES_PROXY_URL`）+ 可选验证码 Webhook  
- `/v1` 需 Bearer Token；可选 HMAC 完整性校验  
- 浏览器/Agent 独立并发池（`HERMES_BROWSER_MAX_COUNT` / `HERMES_BROWSER_AGENT_MAX_COUNT`），超限排队等待任务超时  
- 排水模式下拒绝新建/重跑任务（503）  
