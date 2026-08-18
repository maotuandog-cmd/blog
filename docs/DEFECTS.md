# Hermes 缺陷与优化计划

| 项 | 内容 |
|----|------|
| 文档类型 | Phase 3 · 缺陷清单 + 优化排期 |
| 日期 | 2026-08-06 |
| 输入 | 2026-08-06 单测 + 联调冒烟（见 `docs/TEST.md`） |
| 状态 | **迭代 A/B 部分已关闭**；**迭代 D：D13/D14/D15 已关**；**迭代 E：登录/验证码 E2E 已关**；**迭代 F：真实站定位 E2E 已关**；**迭代 G：captcha-solver 单测已关**（v1.5） |

优先级：P0 影响正确性/安全 · P1 影响可观测/稳定性 · P2 体验与体验

---

## 1. 本轮测试结论

- **单元测试全部通过**（Go + resources TS）；修复后再次全绿（含 API CookieJar / connect 耗时、SSH hostkey）。  
- **核心联调通过**：健康检查、PING、鉴权拒绝、审计、管理队列/排水、取消、幂等、metrics。  
- **API 公网拨测失败**：httpbin.org 返回 503，属环境问题；示例已改为本机 mock。  
- **Browser E2E（T01）**：2026-08-07 Chromium 安装完成后 **S12/S13 通过**。  
- **Agent mock（T02）**：`HERMES_LLM_MOCK` + `make smoke-agent` **通过**（无云 Key）。  
- **本阶段范围**：只验收 4/5/6；API·SSH·PING 保留不验收。
- **安全登录/验证码（2026-08-14）**：`make test` 全绿；**`make smoke-auth` 20/20**（含 T-LiveCap）；先前 `smoke-browser` 3/3。  
- **真实站定位（同日）**：`ui-probe` 对 `#captcha` 超时已修（D21）；fixture `#verification` / 延迟出码 / 错误 webhook 选择器均 SUCCESS。  
- **自建 captcha-solver（同日）**：`make test-captcha-solver` **8/8**（T-Solv-01–05）。T-Solv-06/07 未关（D23）。

---

## 2. 缺陷清单

| ID | 优先级 | 状态 | 修复说明 |
|----|--------|------|----------|
| D01 | P1 | ✅ 已修复 | API `Transport.DisableKeepAlives=true`；单测断言 `connect_ms >= 0` |
| D02 | P1 | ✅ 已修复 | README / smoke 默认本机 `127.0.0.1:18080`；注明公网可选 |
| D03 | P1 | ✅ 已修复 | `Makefile`（`test`/`smoke`）+ `scripts/smoke.sh` + `deploy/README.md` |
| D04 | P2 | ✅ 已修复 | `resourceSettleMs`（默认 800）+ `waitNetworkIdle` |
| D05 | P2 | ✅ 已修复 | 每任务独立 `cookiejar`；auth→request 自动带 Cookie |
| D06 | P2 | ✅ 已修复 | drain `mode=soft\|hard`；hard 时 worker 停止 Claim |
| D07 | P2 | ✅ 已修复 | reclaim 默认 `minIdleSec=120`，响应中带说明 |
| D08 | P2 | ✅ 已修复 | `knownHostsFile` / `HERMES_SSH_KNOWN_HOSTS`；否则 insecure（可显式配置） |
| D09 | P3 | 🟡 部分 | 已补 API CookieJar、SSH hostkey、`resultRetryable`、**bus**（miniredis）单测；scheduler 仍待补 |
| D10 | P3 | ⏳ 开放 | slog 结构化日志未做 |
| D11 | 信息 | ✅ 已文档化 | `deploy/README.md` 并列 redis-server / docker run |
| D12 | P2 | 🟡 缓解 | `worker-browser/node_modules` 含 root 拥有 `.esbuild-*`，`npm install @aws-sdk/*` → EACCES；**已用零依赖 SigV4** 上传 Trace，功能不阻塞；彻底修复需 `chown`/清目录后重装 |
| D13 | P2 | ✅ 已修复 | 性能页汇总抽样任务 TTFB/FCP/LCP/TBT（`extractVitals` + Web Vitals 表）；去掉 Phase B 文案 |
| D14 | P2 | ✅ 已修复 | 提交页 `captureTrace`：on_failure / always / never（BROWSER + AGENT） |
| D15 | P1 | ✅ 已修复 | journey/vitals 原只在 worker 进程 Observe，Gateway `/metrics` 看不到；**worker-core 暴露 `HERMES_METRICS_ADDR`（默认 `:8081`）** |
| D16 | P1 | ✅ 已修复 | `scripts/auth_captcha_smoke.sh`；`make smoke-auth` **20/20**（2026-08-14） |
| D17 | 信息 | ✅ 已文档化 | Redis 存密码明文（需求非目标）；读 API `[REDACTED]`；重跑用存储原文 |
| D18 | 信息 | ✅ 已文档化 | 失败截图/Trace 可能含页面上已输入的密码；不做 DOM 打码 |
| D19 | P2 | 🟡 缓解 | 弱文案不调 Webhook；无可见输入框不对容器 `fill`。iframe/极验/装饰图仍可能误报 |
| D20 | P2 | ✅ 已修复 | T-CapAuto-05/06 已纳入 `smoke-auth` |
| D21 | P1 | ✅ 已修复 | 应用选择器：user > 探测 > 页上可操作的 webhook `fillSelector`；短超时；`ui-probe` 类空等不再发生 |
| D22 | 信息 | 🟡 部分缓解 | 已有 `captcha-solver/` 可作 Webhook；模板 OCR 仍过不了公网站图形码（见 D24） |
| D23 | P2 | ⏳ 开放 | 登录 fixture `/pixel.png` 为 1×1，Worker 联调本服务无法读出页面校验的 `AB12`（T-Solv-06） |
| D24 | P2 | ⏳ 开放 | OCR 依赖本机 DejaVu 模板匹配、约 1.5s/图；无 numpy/OpenCV/PaddleOCR |

---

## 3. 测试缺口（补测计划）

| ID | 项 | 状态 |
|----|----|------|
| T01 | Playwright 后 S12/S13 | ✅ 2026-08-07：auth 失败不跑业务；collectResources.byType 有值 |
| T02 | Agent mock LLM | ✅ `HERMES_LLM_MOCK` + `make smoke-agent`（2026-08-07） |
| T03 | 双 worker 无双跑 | ⏳（非本阶段硬门槛） |
| T04 | 杀进程回收 | ⏳ |
| T05 | Token+HMAC 冒烟 | ✅ 复测 2026-08-07：无 Token/错 Token/缺 HMAC→401；双正确→202 |
| T06 | 浏览器池压测 | ⏳ |
| T07 | 短 runAt 定时任务 | ✅ smoke timed fire |
| T-Vitals-01 | `collectWebVitals` → metrics FCP/LCP 等 | ✅ `make smoke-vitals`（2026-08-13） |
| T-Trace-01 | 失败任务 Trace→MinIO + `traceUrl` | ✅ 同上（本机 MinIO `:19000`） |
| T-Prom-01 | worker `:8081/metrics` journey + vitals 增量 | ✅ 同上；并补 worker-core metrics 端口 |
| T-Cred-01 | GET/创建响应密码 `[REDACTED]` | ✅ `make smoke-auth` |
| T-Cred-02 | 静态登录页自动填密后业务断言 | ✅ |
| T-Cred-03 | 无凭据不注入 auth-auto | ✅ 单测 + E2E |
| T-Cred-04 | 多密码框无选择器失败 | ✅ 单测 + E2E |
| T-Cred-05 | 重跑仍用存储原文且响应脱敏 | ✅ |
| T-CapAuto-01–03 | mock 字符/点选/滑块自动探测并应用 | ✅ |
| T-CapAuto-04 | 无验证码不调 Webhook | ✅ E2E calls=0 |
| T-CapAuto-05 | 探测到但未配 Webhook → FAILED | ✅ |
| T-CapAuto-06 | `autoCaptcha=false` 不自动打码 | ✅ |
| T-LiveCap-01 | fixture `/login-image` 仍填 `#captcha` 成功 | ✅ 即 T-CapAuto-01 |
| T-LiveCap-02 | `#verification`（无 `#captcha`）填对框 | ✅ |
| T-LiveCap-03 | 仅文案「图形验证码」不调 Webhook | ✅ |
| T-LiveCap-04 | 用户名 blur 后才出 `#verification` | ✅ |
| T-LiveCap-05 | webhook 返回不存在的 `#captcha`，回退探测框 | ✅ |
| T-LiveCap-06 | 仅容器无 input → 不可 apply（单测） | ✅ `auth_captcha_ok` |
| T-Solv-01 | `GET /health` | ✅ `make test-captcha-solver` |
| T-Solv-02 | 合成字符图 OCR → `text=AB12` | ✅ |
| T-Solv-03 | 合成滑块 `offsetX` ±8px | ✅ |
| T-Solv-04 | 合成点选 3 点落在圆内 | ✅ |
| T-Solv-05 | 空图 `solved:false` HTTP 200 | ✅ |
| T-Solv-06 | Worker + 本服务 + 可识别登录图 | ⏳ D23 |
| T-Solv-07 | `make smoke-auth` 仍 20/20 | ✅ 2026-08-14 复跑 20/20 |

---

## 4. 剩余优化（排期）

### 迭代 C（按需）

1. Web 终端 / SFTP（需产品确认）  
2. F-LLM-07 动作缓存（P2）  
3. **D09** 其余包单测 · **D10** slog  
4. T01–T07 补测  

### 迭代 D（Web Vitals / Trace · 2026-08-13）

1. ~~硬门槛：T-Vitals-01 / T-Trace-01 / T-Prom-01~~ ✅ `make smoke-vitals`  
2. ~~**D13**：性能页读 vitals~~ ✅  
3. ~~**D14**：提交页 `captureTrace` 三态~~ ✅  
4. **D12**（可选）：修复 `node_modules` 权限，或保持零依赖 S3 并文档冻结  
5. ~~D15 worker metrics~~ ✅  

### 迭代 E（安全登录 / 自动验证码 · 2026-08-14）

1. ~~**D16**：静态登录页 T-Cred-02；重跑 T-Cred-05~~ ✅  
2. ~~mock webhook：T-CapAuto-01–03~~ ✅  
3. ~~T-CapAuto-05/06 · **D20**~~ ✅ `make smoke-auth`（后扩至 20/20）  
4. ~~复跑 `make smoke-browser`~~ ✅ 3/3  
5. **D19**：真实站点若仍误报再收紧（按需）  

### 迭代 F（真实站验证码定位 · 2026-08-14）

1. ~~**D21**：禁止对不存在的 `#captcha` 空等 30s~~ ✅  
2. ~~T-LiveCap-02–05 fixture~~ ✅  
3. ~~T-LiveCap-06 单测~~ ✅  
4. **D22**：生产级识图（PaddleOCR/OpenCV 或外接）；模板 OCR 不够  
5. **D19** 残余：iframe / 极验  

### 迭代 G（自建 captcha-solver · 2026-08-14）

1. ~~目录 + Classify→OCR/Slider/Click + Hermes `POST /captcha`~~ ✅  
2. ~~T-Solv-01–05 单测~~ ✅ `make test-captcha-solver` 8/8  
3. **D23**：可识别字符的登录 fixture，关 T-Solv-06  
4. **D24**：可选升级 OCR/CV 引擎（契约不变）  
5. ~~T-Solv-07 复跑 `make smoke-auth`~~ ✅ 20/20 

---

## 5. 明确不做（范围裁剪回顾）

| 项 | 状态 |
|----|------|
| Traceroute / SNMP / SQL | ❌ 不做 |
| 全量资源瀑布绑 SLA | ❌ 不建议 |
| Hermes 内告警产品 / Alertmanager 运行 | ❌ 不做（仅 `deploy/alertmanager-browser-examples.yml` 示例） |
| Trace Base64 进 Job | ❌ 已否决 |
| BROWSER_AGENT 采 Web Vitals | ❌ 本期不做 |
| 内置 OCR 进 Worker / KMS / Redis 加密落地 / Agent 自动填密 | ❌ 求解仍在独立 `captcha-solver` 或外接 Webhook（D17/D18/D22） |

---

## 6. 验收退出建议

### 既有（4/5/6）

1. `make test` 持续绿  
2. `HERMES_API_INSECURE=true make smoke` 绿（调度运维面 + 探活）  
3. Browser S12–S13（T01）✅ · Agent mock（T02）✅ `make smoke-agent`  
4. P1 缺陷 D01–D03 已关闭 ✅  

### F-BRW-09 / F-OBS-02 / F-BRW-10（开发完成 · 联调待关）

| 项 | 状态 |
|----|------|
| 代码：Vitals / Trace→MinIO / Prometheus / UI 详情 / deploy 样例 | ✅ Phase 2 |
| 单测：vitals merge · metrics Observe | ✅ |
| E2E：T-Vitals-01 / T-Trace-01 / T-Prom-01 | ✅ `make smoke-vitals` 2026-08-13 |
| D15 worker metrics 端口 | ✅ |
| D13 / D14 | ✅ 已关 |

### 安全登录 / 自动验证码（已关）

| 项 | 状态 |
|----|------|
| 代码：UI 凭据、Worker 自动登录、`autoCaptcha` 探测、Gateway 脱敏 | ✅ Phase 2 |
| 单测：`TestRedactPayload*` · `auth_captcha_ok` · `captcha_ok` | ✅ `make test` 2026-08-14 |
| E2E：T-Cred-01–05 · T-CapAuto-01–06 · T-LiveCap-02–05 | ✅ `make smoke-auth` **20/20** |
| 残余风险：Redis 明文、截图含密码、无 OCR | ✅ 已文档化 D17/D18/D22；仓库现有独立 solver 单测，非公网站保证 |

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1 | 2026-08-06 | 首轮单测+冒烟后初稿 |
| 0.2 | 2026-08-06 | 关闭 D01–D08、D11；部分 D09；补充 smoke/Makefile |
| 0.3 | 2026-08-07 | 复跑 make test + smoke(16/16) + T05；关闭 T01（S12/S13） |
| 0.4 | 2026-08-07 | 范围收窄 4/5/6；关闭 T02（HERMES_LLM_MOCK / smoke-agent） |
| 0.5 | 2026-08-12 | BROWSER 确定性失败不重试；UI 总览平均/P95 耗时抽样 |
| 0.6 | 2026-08-12 | UI 性能/告警/错误页启发式；`make up` / `smoke-browser`；aggregate 单测 |
| 0.7 | 2026-08-12 | bus miniredis 单测；任务 JSON/截图；`make smoke-all` |
| 0.8 | 2026-08-13 | Web Vitals/Trace Phase 3：登记 D12–D14；T-Vitals/Trace/Prom 待 E2E |
| 0.9 | 2026-08-13 | 关闭 T-Vitals/Trace/Prom；修复 D15（worker `:8081/metrics`） |
| 1.0 | 2026-08-13 | 关闭 D13：性能页 Web Vitals 抽样表 |
| 1.1 | 2026-08-13 | 关闭 D14：提交页 captureTrace 三态 |
| 1.2 | 2026-08-14 | 安全登录/验证码：登记 D16–D20；单测绿、E2E 未关 |
| 1.3 | 2026-08-14 | 关闭 D16/D20：`make smoke-auth` 15/15；复跑 smoke-browser |
| 1.4 | 2026-08-14 | 关闭 D21：真实站定位；`smoke-auth` 20/20；登记 D22；D19 缓解 |
| 1.5 | 2026-08-14 | 迭代 G：captcha-solver 单测 8/8；D22 部分缓解；登记 D23/D24 |
