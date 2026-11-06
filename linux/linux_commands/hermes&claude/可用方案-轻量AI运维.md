# 可用方案：Claude Code + Hermes 轻量 AI 运维

适用：本机 Ubuntu 笔记本作控制中心，管理 **1～2 台** 远程 Linux（SSH）。  
本机已具备：Claude Code、Hermes（`MiniMax-M3` / `minimax-cn`）、Gateway 已在跑、`terminal.backend=local`。

原则：**脚本巡检 + AI 分析**；默认只读；写操作必须人工批准。

---

## 1. 角色怎么用

| 工具 | 干什么 |
|------|--------|
| **systemd 定时器 + Shell** | 每 N 分钟只读巡检、打 WARN、落盘报告（不花模型费） |
| **Hermes** | 定时读报告、出日报、Telegram 收指令/推摘要 |
| **Claude Code** | 复杂故障分析、写改脚本、出修复方案（你批准后再执行） |

不要：让 Hermes 全局 `terminal.backend=ssh` 只挂一台机；多机用 **本机执行脚本 + SSH 别名**。

---

## 2. 一次性准备（约 30 分钟）

### 2.1 SSH：每台服务器一个别名

在**跑 Hermes 的同一用户**下编辑 `~/.ssh/config`（本机目前是 root 跑 Hermes，就用 `/root/.ssh/config`；更稳妥以后可迁到普通用户）：

```sshconfig
Host server-a
    HostName 改成IP或域名
    User opsmon
    IdentityFile ~/.ssh/aiops_ed25519
    IdentitiesOnly yes
    BatchMode yes
    ServerAliveInterval 30
    ConnectTimeout 8

Host server-b
    HostName 改成IP或域名
    User opsmon
    IdentityFile ~/.ssh/aiops_ed25519
    IdentitiesOnly yes
    BatchMode yes
    ServerAliveInterval 30
    ConnectTimeout 8
```

远程机建只读账号（每台执行一次）：

```bash
sudo adduser opsmon
sudo usermod -aG adm opsmon   # 便于读部分系统日志
# 不要：加 sudo / docker 组
```

本机密钥：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/aiops_ed25519 -C "aiops-monitor"
ssh-copy-id -i ~/.ssh/aiops_ed25519.pub opsmon@服务器IP
chmod 600 ~/.ssh/config ~/.ssh/aiops_ed25519
ssh server-a "hostname && uptime"
```

### 2.2 本机目录与巡检脚本

```bash
mkdir -p ~/ai-ops/{bin,reports/daily,logs,config}
printf '%s\n' server-a server-b > ~/ai-ops/config/servers.txt   # 只有一台就只写一行
```

创建 `~/ai-ops/bin/check_servers.sh`：

```bash
#!/usr/bin/env bash
set -u
BASE="$HOME/ai-ops"
REPORT="$BASE/reports/check_$(date +%F_%H%M%S).log"
mkdir -p "$BASE/reports" "$BASE/logs"
HOSTS=("$@")
if [ "${#HOSTS[@]}" -eq 0 ]; then
  mapfile -t HOSTS < "$BASE/config/servers.txt"
fi
{
  echo "AI OPS SERVER CHECK"
  echo "TIME: $(date)"
  echo "=============================="
  for host in "${HOSTS[@]}"; do
    echo; echo "######## $host ########"
    if ! output=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" 'bash -s' <<'REMOTE'
set -u
echo "HOSTNAME=$(hostname)"
echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"
load=$(awk '{print $1}' /proc/loadavg); cores=$(nproc)
echo "CPU_LOAD_1M=$load"; echo "CPU_CORES=$cores"
awk -v l="$load" -v c="$cores" 'BEGIN{ if (l+0 > c+0) print "WARN CPU_LOAD_HIGH" }'
mem=$(awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{ if(t>0) printf "%.0f",(t-a)*100/t }' /proc/meminfo)
echo "MEMORY_USED_PERCENT=$mem"
[ "${mem:-0}" -ge 85 ] && echo "WARN MEMORY_HIGH"
df -P -x tmpfs -x devtmpfs | awk 'NR>1 { gsub("%","",$5); if ($5+0>=85) printf "WARN DISK_HIGH mount=%s usage=%s%%\n",$6,$5 }'
state=$(systemctl is-system-running 2>/dev/null || true)
echo "SYSTEM_STATE=$state"
[ "$state" != "running" ] && [ "$state" != "starting" ] && echo "WARN SYSTEM_STATE_ABNORMAL"
systemctl --failed --no-legend --plain --no-pager 2>/dev/null | while IFS= read -r line; do
  [ -n "$line" ] && echo "WARN FAILED_SERVICE $line"
done
REMOTE
    ); then
      echo "CRITICAL SSH_CONNECTION_FAILED"
      continue
    fi
    printf '%s\n' "$output"
  done
} | tee "$REPORT"
echo; echo "REPORT: $REPORT"
```

```bash
chmod +x ~/ai-ops/bin/check_servers.sh
~/ai-ops/bin/check_servers.sh          # 验收：能出 REPORT 路径
```

### 2.3 每 5 分钟自动巡检（systemd --user）

若当前是 root 跑，用 root 的 user systemd；以后迁 `aiops` 用户同理。

`~/.config/systemd/user/aiops-check.service`：

```ini
[Unit]
Description=AI OPS Server Health Check
[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n %h/ai-ops/check.lock %h/ai-ops/bin/check_servers.sh
```

`~/.config/systemd/user/aiops-check.timer`：

```ini
[Unit]
Description=AI OPS Periodic Monitoring
[Timer]
OnBootSec=2min
OnCalendar=*:0/5
Persistent=true
AccuracySec=30s
[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now aiops-check.timer
systemctl --user start aiops-check.service
ls ~/ai-ops/reports/ | tail
```

笔记本关机/睡眠期间不会巡检——要 7×24 就把控制中心迁到常在线小主机。

### 2.4 安全规范（给 Claude 用）

`~/ai-ops/OPS_RULES.md`：

```markdown
# AI 运维安全规范
- 只管理 ~/.ssh/config 中的 Host
- 默认只读；禁止 rm -rf、格式化、删库、改 SSH/防火墙、未批准重启
- 分析流程：证据 → 原因 → 影响 → 修复命令 → 回滚 → 风险等级
- 远程写操作必须明确批准后再执行
```

---

## 3. Hermes：每日分析（已有 Gateway）

确认：

```bash
hermes status          # Gateway: running
# config.yaml 保持：
# terminal:
#   backend: "local"
```

在 Hermes 对话里建任务（可按需改时间/主机）：

```text
请创建每天 08:35 的周期性任务「每日 Linux 运维健康分析」：
1. 执行 ~/ai-ops/bin/check_servers.sh
2. 读取 ~/ai-ops/reports/ 最新报告
3. 按 server 分析 CPU/内存/磁盘/SYSTEM_STATE/WARN/CRITICAL
4. 分级 P0～P3，给排查命令与建议
5. 保存 Markdown 到 ~/ai-ops/reports/daily/
约束：只读；禁止 sudo、重启、删改远程文件。
```

```bash
hermes cron list
hermes cron status
```

Telegram（可选）：`hermes gateway setup` → 配对 `hermes pairing approve telegram <码>` → 任务摘要发到授权会话。  
未配对前不要对公网开放 Bot。

---

## 4. Claude Code：故障分析怎么用

```bash
cd ~/ai-ops
claude
```

示例提示：

```text
请先阅读 OPS_RULES.md。
分析 reports/ 里最新巡检报告：
1) CPU/内存/磁盘 2) FAILED_SERVICE 3) SSH CRITICAL
只分析、给处理建议和命令；不要连接或修改服务器。
```

修脚本、写一次性排查命令也用 Claude；**真正 SSH 执行危险命令前你自己确认**。

---

## 5. 验收清单（做完即“可用”）

| # | 项 | 怎么算过 |
|---|----|----------|
| 1 | `ssh server-a` / `server-b` 只读登录成功 | 返回 hostname |
| 2 | `check_servers.sh` 手跑成功 | 生成 `reports/check_*.log` |
| 3 | timer 在跑 | `systemctl --user list-timers` 能看到 |
| 4 | Hermes 能读本地报告并分析 | 对话里让它读最新 log |
| 5 | （可选）Telegram 只授权用户可用 | pairing 通过 |

做到 1～4 就是一套可用的轻量方案；Telegram / 审批式重启是下一阶段。

---

## 6. 明确不做（现阶段）

- 不给 AI root / 无限制 sudo  
- 不上 Prometheus/Grafana（两台机够用再加）  
- 不自动删日志、不自动重启生产服务  
- 不假设 Claude 订阅 = Hermes 模型额度（本机 Hermes 用 MiniMax）

---

## 7. 常用命令速查

```bash
~/ai-ops/bin/check_servers.sh
systemctl --user status aiops-check.timer
hermes
hermes cron list
claude
hermes status
```

模型/Key：`~/.hermes/.env`、`~/.hermes/config.yaml`（已配 MiniMax 则勿改乱）。

---

## 8. 和同目录其它笔记

| 文件 | 用途 |
|------|------|
| **本文件** | **可执行方案（以这份为准）** |
| `Claude与Hermes使用建议.md` | 分工与选型摘要 |
| `clude hermes 使用建议 （chatgpt建议）.md` | ChatGPT 长草稿，已归档备查，勿当操作手册 |
