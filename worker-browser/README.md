# hermes-worker-browser

Playwright 浏览器执行端（TypeScript）：确定性旅程（`BROWSER`）与智能浏览（`BROWSER_AGENT`）。

## 目录

```
src/
  index.ts                 # 进程入口
  types.d.ts               # 领域类型（无运行时 JS）
  config.ts
  http/                    # HTTP API（/healthz, /v1/browser/run|agent）
  browser/                 # session / steps / resource collector 适配
  journey/                 # script（确定性）+ agent（LLM 循环）
  runtime/                 # 反检测 / 拟人 / 证据 / 资源 / Vitals / Trace→S3 / captcha
  security/                # allowedHosts
  llm/                     # Chat Completions + 总结
  *_test.ts
dist/                      # tsc 输出（gitignore）
```

## 启动

```bash
npm install && npx playwright install chromium
npm run build
npm start          # node dist/index.js
npm run dev        # tsx watch（开发）
npm test           # resources + llm mock + web vitals + captcha 单测
npm run typecheck
```

环境变量：

| 变量 | 说明 |
|------|------|
| `HERMES_BROWSER_PORT` | HTTP 端口（默认 8090） |
| `HERMES_BROWSER_HEADLESS` | 默认 true |
| `HERMES_PROXY_URL` | 可选代理 |
| `HERMES_LLM_*` / `HERMES_LLM_MOCK` | Agent |
| `HERMES_CAPTCHA_WEBHOOK` | 验证码求解器 URL。自建服务见仓库 `captcha-solver/`（默认 `http://127.0.0.1:18085/captcha`）。`scripts/auth_e2e_server.py` mock 只服务 fixture，不能过公网站 |
| `HERMES_CAPTCHA_TIMEOUT_SEC` | 默认 60 |
| `HERMES_CAPTCHA_API_KEY` | 可选 Bearer |
| `HERMES_S3_*` / `HERMES_TRACE_URL_TTL_SEC` | Trace→MinIO |

未配置 `HERMES_S3_*` 时，失败 Trace 写入 `artifacts.traceError`。

## Payload 开关

| 字段 | 协议 | 默认 | 说明 |
|------|------|------|------|
| `collectWebVitals` | BROWSER | false | 合成 TTFB/FCP/LCP/TBT/DOM/heap |
| `captureTrace` | BROWSER / AGENT | `on_failure` | Trace zip → MinIO |
| `collectResources` | 两者 | false | 资源耗时聚合 |
| `credentials` | BROWSER | — | 拨测时自动注入登录（密码读 API 脱敏） |
| `autoCaptcha` | BROWSER | true | 运行中探测验证码并调用 Webhook |

## 步骤动作（BROWSER）

| action | 说明 |
|--------|------|
| `navigate` / `fill` / `click` / `wait` / `assertText` / `screenshot` | 基础 |
| `drag` | 拖拽；`selector` + `deltaX`（或 `value` 数字/JSON）或 `toX` |
| `solveCaptcha` | 显式截图 → Webhook → **自动** fill / 点选 / 滑块 |

### 自动登录（credentials）

提交页或 API 提供 `credentials.username` / `password` 后，Worker 在业务步骤前自动导航、探测（或使用可选选择器）并填写。不把密码写入步骤结果。

```json
"credentials": {
  "username": "alice",
  "password": "***",
  "loginUrl": "https://app.example/login"
}
```

### solveCaptcha / 自动探测（F-BRW-06）

仅 **BROWSER**。`autoCaptcha` 默认开启：每次 navigate/fill/click/drag 后探测 DOM。**仅当存在可填写/可拖拽控件时**才调用 Webhook。填写选择器以当前页为准：用户 `credentials.captchaSelector` > 探测结果 > Webhook `fillSelector`（且该节点必须可操作）。截图优先裁剪验证码图/容器。显式 `solveCaptcha` 仍可用。Agent 本期不增强。

```json
{ "action": "solveCaptcha", "kind": "auto", "selector": ".captcha-input-or-handle" }
```

Webhook **请求**：`{ jobId, pageUrl, kind, screenshotBase64, hint }`  
`hint` 可含 `selector`、`imageSelector`、`kindGuess`（旧求解器可忽略）。

Webhook **响应**（`solved: true` 时 Hermes 自动应用）：

| kind | 字段 | 行为 |
|------|------|------|
| image | `text` + selector/`fillSelector` | `fill` |
| click | `points: [{x,y}]` | `mouse.click`（viewport） |
| slider | `offsetX` 或 `track` | `drag` |

未配置 Webhook 或 `solved: false` → 步骤失败，旅程 `retryable=false`。

E2E：`HERMES_API_INSECURE=true make smoke-auth`（静态登录页 + mock webhook）。

详见 `docs/REQ_SECURE_AUTH.md`、`docs/REQ_CAPTCHA_LIVE.md`。
