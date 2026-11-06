# Claude Code 与 Hermes 使用建议

来源：ChatGPT 分享整理（[对话链接](https://chatgpt.com/share/6ae984d5-c1e0-83ea-b0ad-6594c961c13f)）  
本机现状（2026-11）：Claude Code `2.1.316`、Hermes Agent `v0.22.5`（模型 `MiniMax-M3` / `minimax-cn`，Gateway 已运行）

**要动手部署，直接看：[[可用方案-轻量AI运维]]**（SSH + 巡检脚本 + systemd + Hermes 日报）。

定位：两者**配合使用**，不要互相替换。

| 角色 | 工具 | 擅长 |
|------|------|------|
| AI 运维工程师 | **Claude Code** | 分析、写改代码、排障、在终端里执行 |
| AI 运维主管 | **Hermes** | 长期待命、收指令、记忆、定时任务、消息网关、调度 |

---

## 一、推荐整体架构

```text
Telegram / Web / SSH / CLI
        │
        ▼
   Hermes Agent
  （调度 · 记忆 · 巡检 · 通知）
        │
        ▼
   Claude Code（或其他受控执行端）
  （开发 · 脚本 · 故障分析 · 自动化）
        │
        ▼
   Linux 服务器 / Docker / K8s / 数据库 / 网络服务
```

说明：

- Hermes **不必**一开始就直接调用 Claude Code；可先各自独立，再通过 CLI、脚本或工具接口协作。
- Hermes 侧常见能力：SSH / Docker 等终端后端、长期记忆、技能系统、消息网关、定时任务。

---

## 二、能落地的能力（目标态）

| 功能 | 实际效果 |
|------|----------|
| 自动巡检 | 定期检查多台服务器 |
| 故障分析 | 分析系统日志和报错 |
| 资源监控 | CPU / 内存 / 磁盘异常告警 |
| Docker 管理 | 容器状态、日志、重启 |
| K8s 运维 | Pod / 节点 / 事件分析 |
| 自动开发 | 编写 Bash、Python 运维脚本 |
| 远程交互 | Telegram 等渠道下发指令 |
| 知识记忆 | 记住架构与排障经验 |
| 定时报告 | 每日运维健康报告 |

安全底线：巡检与通知可先做成**只读**；重启服务、删数据、改防火墙等必须**人工审批**。

---

## 三、建议落地顺序（四阶段）

### 1. 先把 Hermes 跑起来

官方：

- 项目：https://github.com/NousResearch/hermes-agent
- 文档：https://hermes-agent.nousresearch.com/docs

安装（Linux / macOS / WSL2）：

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

安装后：

```bash
hermes setup --portal   # 或按实际 provider 配置
hermes                  # 进入交互
```

模型提供商按账号与预算选择（OpenRouter、Anthropic、MiniMax 等）。  
**不要默认以为已有 Claude Code 订阅就能直接给 Hermes 用。**

本机已配示例：

```bash
# ~/.hermes/.env（国内 MiniMax）
MINIMAX_CN_API_KEY=你的Key
MINIMAX_CN_BASE_URL=https://api.minimaxi.com/anthropic

# ~/.hermes/config.yaml 中 model:
#   default: MiniMax-M3
#   provider: minimax-cn
```

验证：

```bash
hermes status
hermes -z "只回复：连接成功"
```

### 2. 接入 Telegram（或其它消息入口）

让 Hermes 能够：

- 接收运维指令
- 查询服务器状态
- 推送异常告警
- 发送每日巡检报告

入口务必做**用户身份授权**，不要对公网裸奔。

### 3. 接入服务器（先只读）

建议专用运维账号 + SSH 密钥，先允许只读命令，例如：

```bash
uptime
free -h
df -h
top -bn1 | head -20
systemctl --failed
docker ps
```

先实现：检查 → 分析 → 报告；再逐步开放受控写权限。

### 4. 让 Claude Code 与 Hermes 配合

示例流程：

> 在 Telegram 发送：检查所有服务器磁盘，超过 85% 则分析原因并给出处理方案。

- Hermes：调度、汇总、通知、记忆
- Claude Code：复杂脚本、深挖日志、改代码/配置方案

协作可以是：Hermes 调 CLI、写临时脚本再交给 Claude、或人工在 Claude Code 里继续做。

---

## 四、分工怎么用（日常建议）

| 场景 | 优先用谁 |
|------|----------|
| 写/改代码、重构、看仓库、本地排障 | Claude Code |
| 长期挂着、定时巡检、消息渠道收指令 | Hermes |
| 一次性深度分析某个故障 | Claude Code |
| 多机汇总、日报、告警推送 | Hermes |
| 危险写操作（重启、删库、改防火墙） | 人工确认；工具侧默认拒绝或走审批 |

一句话：

- **干活分析 → Claude Code**
- **值班调度 → Hermes**

---

## 五、安全清单（必做）

1. 使用专门运维账号，避免 AI 直接用 `root` 登录业务机。
2. SSH 密钥按服务器 / 权限隔离。
3. 默认只读；写操作必须审批。
4. 禁止未经确认执行 `rm -rf`、格式化、清空数据库等。
5. 所有操作保留审计日志。
6. Telegram（等）入口开启用户白名单 / 身份校验。
7. API Key 放在 `~/.hermes/.env`，权限 `chmod 600`。

---

## 六、本机快速入口

```bash
# Claude Code
claude

# Hermes
hermes
hermes status
hermes model          # 换模型 / provider
hermes auth add minimax-cn --type api-key
```

配置目录：

| 工具 | 目录 |
|------|------|
| Hermes | `/root/.hermes/`（`config.yaml`、`.env`） |
| Claude Code | `/root/.claude/`、`/root/.local/bin/claude` |

---

## 七、和本仓库其它笔记的关系

- `linux_commands/`：单命令速查
- 本笔记：AI 运维双工具的**选型与落地顺序**，不是命令手册
- 若后续有 Hermes 安装踩坑、Telegram 网关、只读 SSH 模板，可继续放在本目录 `hermes&claude/` 下分篇

---

## 八、原始草稿

同目录保留 ChatGPT 原文摘录：`clude hermes 使用建议 （chatgpt建议）.md`  
正式整理以本文件为准。
