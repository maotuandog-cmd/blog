# Hermes — 架构决策记录（ADR）

> Phase 1 产出 · 与 `REQUIREMENTS.md` v0.5 配套 · 不含实现代码

---

## ADR-001：核心技术栈 = Go + Node

**状态**：Phase 1 基线（拟决策）

**决策**：Gateway / Dispatcher / SSH / API / SQL / Collectors 用 **Go**；Browser 确定性拨测与智能浏览 Worker 用 **Node.js + Playwright**。

**理由**：Go 适合长驻执行面与系统协议；Playwright / Stagehand 类智能浏览生态以 Node 为一等公民，且已决策公有云 LLM + L3 反检测，浏览器面独立扩缩更合理。

**后果**：需维护两套运行时与发布物；进程间用 gRPC/HTTP 调用 Browser Worker。

---

## ADR-002：任务总线 = Redis Stream

**状态**：Phase 1 基线（拟决策）

**决策**：P0 采用 **Redis Stream**（消费者组 + 认领/ACK + 空闲回收）作为 Task Bus。

**理由**：部署常见、运维成本低于多中间件；满足原子消费与重试；后续可抽象为 Bus 接口以替换 NATS。

**后果**：需运维 Redis 高可用；不直接绑定旧 Mongo 队列报文（见 ADR-003）。

---

## ADR-003：任务模型独立 + 可选旧队列适配器

**状态**：Phase 1 基线（拟决策）

**决策**：Hermes 主任务模型独立设计；**不强制**兼容旧平台队列字段。若需平滑迁移，P1+ 提供只读/双写 **Adapter**（可选模块）。

**理由**：避免把旧轮询模型的缺陷带进新架构。

---

## ADR-004：仓库布局 = 单仓 `hermes/`

**状态**：Phase 1 基线（拟决策）

**决策**：先在本仓库 `hermes/` 下多模块开发；稳定后再评估拆独立 Git 仓。

---

## ADR-005：P0 不含 SFTP；图形终端延后

**状态**：Phase 1 基线（拟决策）

**决策**：SFTP、字符 Web 终端入 **P1**；图形桌面（guacd）入 **P1.5/P2**。P0 = 调度 + SSH + API + 确定性 Browser + 安全/指标。

---

## ADR-006：LLM = 公有云，默认 OpenAI 兼容接口

**状态**：已决策（用户确认 D8）+ 厂商基线（拟决策 D10）

**决策**：

- 使用公有云 LLM API；密钥仅环境变量。  
- 默认对接 **OpenAI 兼容 Chat Completions**（可通过 `base_url` 指向 OpenAI 或国内兼容网关）。  
- Prompt/页面内容出域前脱敏；密码与完整 Cookie 禁止出域。

**后果**：依赖外网或专线访问模型网关；需配置代理与超时。

---

## ADR-007：反检测默认 L3，P1 交付「可跑通路径」

**状态**：已决策（用户确认 D9）+ 实现路径（拟决策 D11）

**决策**：

- 智能浏览任务默认 **L3 Profile**（可降级 L2）。  
- P1 至少落地一条可跑通路径：**自建 Playwright + stealth/指纹配置 + 可配置 HTTP(S) 代理池 + 可选验证码服务 API**。  
- 托管浏览器（如 Browserbase 类）作为**可选后端**，接口抽象为 `BrowserRuntime`，不绑死单一厂商。

**不保证**：任意站点 100% 绕过顶级 Bot 管理；仅授权白名单域名。

---

## ADR-008：智能浏览 + 总结 = P1 正式范围

**状态**：已决策（用户确认 D7）

**决策**：`BROWSER_AGENT` 协议与 Summarizer 属 P1；不替代 P0 确定性拨测。

---

## ADR-009：管理/运维前端 = React + TypeScript；预留与 `/opt/arsre` 合并

**状态**：已决策（2026-08-06 用户确认）

**决策**：

1. Hermes **UI 层**采用 **React + TypeScript**（严格类型）；不与 Go/Node 执行面同仓强绑死实现细节。  
2. **对接边界**：UI 只消费 Hermes Gateway 的稳定 HTTP API（`/v1/jobs`、`/v1/audit`、`/v1/admin/*`、`/metrics` 等），鉴权沿用 Bearer / HMAC 约定。  
3. **合并预留**：后续可能与 `/opt/arsre` 做代码或产品合并对接。当前环境未挂载该路径；合并前遵守：  
   - API First，避免把业务状态塞进前端本地特例；  
   - UI 组件/路由可拆包（如 `packages/hermes-ui`），方便迁入 monorepo 或被 arsre 宿主挂载；  
   - 主题/布局不写死品牌，便于嵌入 arsre 壳；  
   - 不依赖 arsre 私有实现细节，直至双方契约明确。  

**后果**：需单独维护前端工程与构建物；合并阶段以 API 契约 + 模块边界降低冲突成本。

**非目标（本期）**：不在本决策中启动 Web 终端全量实现；终端若做，同样走 React/TS，并通过 Gateway/WS 边界接入。

---

## 组件边界（实施导读）

```
hermes-gateway          Go     鉴权、管理 API、指标入口
hermes-dispatcher       Go     Stream 消费协调、租约、重试、配额
hermes-worker-core      Go     SSH / API / PING / …
hermes-worker-browser   Node   确定性拨测 + Agent + L3 + 公有云总结
hermes-ui               React+TS  管理/拨测控制台（可独立仓或 packages/；预留并入 /opt/arsre）
hermes-collector-*      Go     P2 Trap/Syslog（范围裁剪项除外）
```

Browser Worker 对内暴露：`ExecuteScriptJourney` / `ExecuteAgentJourney`；对外不直接暴露 LLM Key。  
UI 仅调用 Gateway；合并 arsre 时优先「宿主挂载子应用 / 共享设计系统」，而非改写执行引擎。
