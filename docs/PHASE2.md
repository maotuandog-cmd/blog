# Phase 2 进度

| 日期 | 内容 |
|------|------|
| 2026-08-05 | Phase 1 冻结；P0 骨架落地 |
| 2026-08-05 | **P1 启动**：BROWSER_AGENT + 公有云总结 + 默认 L3 反检测 + 域名白名单 |
| 2026-08-05 | **P0 加固**：Gateway 鉴权(F-SEC-04) / Idempotency-Key / Trace-ID / DLQ / XAUTOCLAIM 回收 |
| 2026-08-06 | **P0 补齐**：HMAC(F-SEC-01) / 定时任务(F-SCHED-01) / 浏览器失败截图+文本快照(F-BRW-04) |
| 2026-08-06 | **P0/P1 续**：浏览器并发池排队(F-SCHED-06/F-BRW-05) / 审计检索(F-SCHED-08) / PING(F-TOOL-01) |
| 2026-08-06 | **范围裁剪**：明确不做 Traceroute / SQL / SNMP（及依赖它们的排期） |
| 2026-08-06 | **管理面**：队列积压/强制回收/排水(F-ADM-02)；取消/重跑(F-SCHED-10) |
| 2026-08-06 | **Browser 性能层**：鉴权段 authSteps + 可选资源耗时聚合 collectResources |
| 2026-08-06 | **拨测耗时补齐**：API DNS/Connect/TLS/TTFB（F-API-03）；Agent 可选 collectResources |
| 2026-08-06 | **前端决策**：React+TS；预留与 `/opt/arsre` 合并（ADR-009） |
| 2026-08-06 | **worker-browser 重构**：`src/{http,browser,journey,runtime,security,llm}` 分层；入口 `src/index.ts` |
| 2026-08-06 | **worker-browser TS**：全量 TypeScript（strict）；`npm run build` → `dist/`；`npm start` |
| 2026-08-07 | **范围确认**：本阶段只验收 4 BROWSER / 5 BROWSER_AGENT / 6 调度运维；API·SSH·PING 保留不验收 |
| 2026-08-07 | **T02**：`HERMES_LLM_MOCK` + `make smoke-agent`；Agent 无云 Key 可验收 |
| 2026-08-07 | **hermes-ui Phase A**：总览大盘 + 可用性/错误/趋势/告警占位/节点；仅浏览器协议 |
| 2026-08-12 | **体验加固**：BROWSER 旅程失败 `retryable=false` → 直接 FAILED；总览抽样平均/P95 耗时 |
| 2026-08-12 | **UI Phase A+**：性能页应用级 avg/P95；告警启发式列表；错误消息聚合；`make up` / `smoke-browser` |
| 2026-08-12 | **UI 运维操作**：任务详情取消/重跑；节点页 soft/hard 排水与 reclaim；总览 KPI 跳转 |
| 2026-08-12 | **UI 调度补齐**：提交 timed/maxRetries；任务最近作业；趋势按应用；节点探测 browser-worker；`make smoke-ops` |
| 2026-08-12 | **排障+回归**：任务 JSON/截图下载；可用性按应用；bus miniredis 单测；`make smoke-all` |
| 2026-08-13 | **Phase 1（待确认）**：Web Vitals + 失败 Trace + Prometheus 契约；告警交 Alertmanager（见 `docs/REQ_WEB_VITALS_TRACE.md`） |
| 2026-08-13 | **Phase 1 冻结**：Vitals 仅 BROWSER；Trace→MinIO；Prometheus `app` 标签；待开 Phase 2 |
| 2026-08-13 | **F-BRW-09 / F-OBS-02 / F-BRW-10**：`collectWebVitals`；Trace→MinIO（`traceUrl`）；`/metrics` vitals；UI + `deploy/` 示例 |
| 2026-08-13 | **联调关闭**：`make smoke-vitals`；worker-core `HERMES_METRICS_ADDR=:8081`（D15） |
| 2026-08-13 | **Phase 1（待确认）**：登录/验证码可插拔（见 `docs/REQ_CAPTCHA_AUTH.md`） |
| 2026-08-13 | **Phase 1 冻结**：BROWSER `solveCaptcha`（image/点选/slider 自动应用）；无探测/无 UI/无 Agent |
| 2026-08-13 | **F-BRW-06**：`solveCaptcha` + `drag`；Webhook 契约；仅 BROWSER |
| 2026-08-14 | **Phase 1（待确认）**：安全登录填写 + 运行中验证码自动探测（见 `docs/REQ_SECURE_AUTH.md`） |
| 2026-08-14 | **Phase 1 冻结**：UI 安全凭据 + 拨测时自动登录 + 运行中验证码探测；仅 BROWSER；读 API 脱敏 |
| 2026-08-14 | **F-BRW-02/06 · F-SEC-02**：`credentials` 自动注入；`autoCaptcha` 默认开；Gateway 密码脱敏 |
| 2026-08-14 | **Phase 1 冻结**：真实环境验证码定位与正确填写（见 `docs/REQ_CAPTCHA_LIVE.md`） |
| 2026-08-14 | **定位/填写**：探测可填控件；选择器 user>probe>可用 webhook；blur 后出码；mock 不写死公网 `#captcha` |
| 2026-08-14 | **Phase 1 冻结**：自建验证码识别服务（见 `docs/REQ_CAPTCHA_SOLVER.md`） |
| 2026-08-14 | **captcha-solver**：独立 Classify→OCR/Slider/Click；Hermes `POST /captcha`；默认 `:18085` |
| 2026-08-14 | **Phase 1（待确认）**：字符码 OCR 升级 ddddocr + 模板回退（见 `docs/REQ_CAPTCHA_OCR.md`） |

## 当前阶段

**Phase 3 已更新**（自建 captcha-solver 单测 8/8；T-Solv-06/07 未关）。开发基线见上表；详情：

- 测试说明与冒烟结果：`docs/TEST.md`
- 缺陷与优化排期：`docs/DEFECTS.md`
- Phase 3 入口：`docs/PHASE3.md`

## 范围裁剪（用户确认 2026-08-06）

| 需求 ID | 能力 | 状态 |
|---------|------|------|
| F-TOOL-02 | Traceroute | ❌ 不做 |
| F-TOOL-04 | SNMP Walk/Get | ❌ 不做 |
| F-SQL-01 | 多引擎 SQL | ❌ 不做 |
| F-TOPO-01 / F-TRAP-01 等 | SNMP 拓扑 / Trap | ❌ 不做（连带） |

保留：`PING`（F-TOOL-01）、SSH / API / Browser / BROWSER_AGENT。

## P0

- [x] Gateway / Worker / Redis Stream / SSH / API / Browser
- [x] `/metrics` `/healthz` `/readyz`
- [x] API 默认拒绝 + Bearer Token
- [x] Idempotency-Key + X-Trace-Id
- [x] DLQ / XAUTOCLAIM
- [x] HMAC（F-SEC-01）
- [x] 定时任务（F-SCHED-01）
- [x] 浏览器失败截图/文本快照（F-BRW-04）
- [x] 浏览器/Agent 并发池排队（F-SCHED-06 / F-BRW-05）
- [x] 执行审计检索（F-SCHED-08）
- [x] Browser 鉴权段 + 可选资源耗时聚合（F-BRW-02 / 性能层）
- [x] API 细分耗时 DNS/Connect/TLS/TTFB（F-API-03）

## P1

- [x] BROWSER_AGENT + 白名单 + purpose + L3 + 总结 + Agent 配额
- [x] BROWSER_AGENT 可选 `collectResources`
- [x] PING（F-TOOL-01）
- [x] 管理 API：积压 / 强制回收 / 排水（F-ADM-02）
- [x] 任务取消 / 终态重跑（F-SCHED-10）
- [x] 可选 Web Vitals（F-BRW-09，仅 BROWSER）
- [x] 浏览器体验 Prometheus 指标（F-OBS-02）
- [x] 失败 Trace → MinIO（F-BRW-10）
- [x] 验证码可插拔 `solveCaptcha`/`drag`（F-BRW-06，仅 BROWSER）
- [x] 安全凭据 + 拨测时自动登录 + 运行中验证码探测（读 API 脱敏）
- [x] 真实页验证码定位与填写（`REQ_CAPTCHA_LIVE`；无内置 OCR）
- [x] 自建 `captcha-solver`（Classify→OCR/Slider/Click；Webhook `POST /captcha`）
- [x] ~~Traceroute / SNMP / SQL~~ → **已裁剪**
- [ ] Web 终端 / SFTP / Telnet / WinRM（未裁剪，按需再排）
- [ ] 动作缓存自愈（F-LLM-07，排 P2）

## 联调清单

1. API 任务确认 `extra.timing.hermes_api_ttfb_ms` ≥ 0  
2. `BROWSER` / `BROWSER_AGENT` 开 `collectResources` 可见资源聚合  
3. 高频 SLA 保持资源采集关闭  

## 下一迭代建议

1. ~~T-Cred / T-CapAuto E2E（静态登录页 + mock webhook 滑块/点选）~~ ✅ `make smoke-auth`  
2. ~~T-LiveCap 真实页定位 fixture~~ ✅ 20/20  
3. T-Vitals/Trace/Prom 回归；T03/T04/T06；D09/D10  
4. 生产识图：自建 `captcha-solver/` 或外接 Webhook（D22）  
5. Web 终端 / SFTP（需确认后再做）  
6. API / SSH / PING 若长期不用可再物理裁剪（当前策略 A：保留）  
