# systemctl 和 ufw 使用说明

`systemctl` 是 systemd 的服务管理 CLI,`ufw`(Uncomplicated Firewall)是 Ubuntu 系发行版默认的防火墙前端(底层仍是 iptables/nftables)。

本文档主要面向 Debian / Ubuntu 系列, RHEL 系把 `ufw` 换成 `firewalld` 即可。

---

## systemctl

### 1. 服务生命周期(常用命令)

| 命令 | 作用 |
|------|------|
| `sudo systemctl start <服务>` | 立即启动 |
| `sudo systemctl stop <服务>` | 立即停止 |
| `sudo systemctl restart <服务>` | 停止后启动(配置变更后常用) |
| `sudo systemctl reload <服务>` | 不停服务,重载配置(服务必须支持) |
| `sudo systemctl status <服务>` | 查看状态、近期日志尾部 |
| `sudo systemctl try-restart <服务>` | 只在运行时重启 |

> ⚠️ `reload` 和 `restart` 的区别:reload 不中断服务,只重载配置;restart 会中断连接。优先用 reload,不确定服务支不支持就 restart。

### 2. 开机自启

| 命令 | 作用 |
|------|------|
| `sudo systemctl enable <服务>` | 设置开机自启(创建符号链接,不立即启动) |
| `sudo systemctl disable <服务>` | 取消开机自启 |
| `sudo systemctl enable --now <服务>` | 同时启动 + 开机自启 |
| `systemctl is-enabled <服务>` | 查看是否自启 |
| `systemctl is-active <服务>` | 查看是否运行中 |
| `sudo systemctl mask <服务>` | 屏蔽(任何方式都无法启动,常用于防误启) |
| `sudo systemctl unmask <服务>` | 解除屏蔽 |

### 3. 查看服务

```bash
# 所有已加载的服务
systemctl list-units --type=service

# 所有已安装的服务单元(包含未启用的)
systemctl list-unit-files --type=service

# 启动失败的服务(排错第一站)
systemctl --failed

# 服务的依赖关系树
systemctl list-dependencies nginx

# 某个服务被谁依赖
systemctl list-dependencies --reverse nginx
```

按状态筛选:

```bash
systemctl list-units --type=service --state=running   # 正在跑
systemctl list-units --type=service --state=failed    # 失败了
systemctl list-units --type=service --state=exited   # 一次性任务跑完
```

### 4. 日志(journalctl)

`journalctl` 是 systemd 的日志工具,服务状态里的"近期日志"也是从这里读。

```bash
# 看某服务的全部日志
sudo journalctl -u nginx

# 实时跟踪(类似 tail -f)
sudo journalctl -u nginx -f

# 只看最近的
sudo journalctl -u nginx -n 100 --no-pager

# 启动本次的日志
sudo journalctl -u nginx -b

# 限定时间
sudo journalctl -u nginx --since "1 hour ago"
sudo journalctl -u nginx --since "2026-09-02 09:00" --until "2026-09-02 10:00"

# 内核日志(等同 dmesg 但能按时间筛)
sudo journalctl -k
```

### 5. 用户级服务

不只系统服务能管,普通用户的 systemd 也有自己的服务目录 `~/.config/systemd/user/`。

```bash
# 管理用户服务(不需要 sudo)
systemctl --user start myapp
systemctl --user enable myapp
systemctl --user status myapp

# 让用户服务在用户登录前就启动(开机即起)
sudo loginctl enable-linger <用户名>
```

### 6. 自定义 service 文件

路径:
- 系统级:`/etc/systemd/system/<name>.service`(或 `/lib/systemd/system/`)
- 用户级:`~/.config/systemd/user/<name>.service`

最小示例 `/etc/systemd/system/myapp.service`:

```ini
[Unit]
Description=My App
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/myapp
Restart=on-failure
RestartSec=5
User=myuser
WorkingDirectory=/opt/myapp

[Install]
WantedBy=multi-user.target
```

启用:

```bash
sudo systemctl daemon-reload                # 重读所有 unit 文件
sudo systemctl enable --now myapp.service   # 立即启动 + 开机自启
systemctl status myapp
```

常见 `Type`:
- `simple`(默认):ExecStart 进程就是主进程
- `forking`:ExecStart 启动后 fork,主进程退出,适合传统 daemon
- `oneshot`:只跑一次,常配合 `RemainAfterExit=yes`
- `notify`:进程通过 sd_notify 通知"我准备好了"

常见 `Restart`:
- `no`(默认):不自动重启
- `on-failure`:失败时重启
- `always`:不管啥原因退出都重启
- `on-abnormal`:异常退出(信号、timeout)时重启

### 7. 系统级操作

```bash
# 重启 / 关机
sudo systemctl reboot
sudo systemctl poweroff

# 切换运行级别
sudo systemctl isolate multi-user.target   # 命令行模式
sudo systemctl isolate graphical.target    # 图形模式

# 默认启动目标
sudo systemctl set-default multi-user.target

# 救援模式 / 单用户
sudo systemctl rescue
sudo systemctl emergency
```

### 8. 实战套路

**修改服务配置后**:

```bash
sudo systemctl edit nginx       # 会打开 /etc/systemd/system/nginx.service.d/override.conf
# 或者直接改主文件后:
sudo systemctl daemon-reload
sudo systemctl restart nginx
```

**服务起不来,排错**:

```bash
systemctl status myapp          # 看 status 行和最后几行日志
sudo journalctl -u myapp -n 50 --no-pager
journalctl -xe                  # 最近的系统级错误
systemctl list-dependencies myapp  # 依赖是否齐全
```

**临时禁用某个服务启动(不卸载)**:

```bash
sudo systemctl stop myapp
sudo systemctl disable myapp
sudo systemctl mask myapp       # 即使被其它服务拉起也启不来
```

---

## ufw

### 1. 安装与启用

```bash
# Ubuntu 默认装好,Debian 需要装
sudo apt install ufw

# 启用(会插入默认策略,务必先放行 SSH,见下文)
sudo ufw enable

# 关闭
sudo ufw disable

# 状态
sudo ufw status verbose
```

> ⚠️ **远程机器上启用 ufw 前**,必须先 `sudo ufw allow 22/tcp` 或你的 SSH 端口,否则会被自己的防火墙锁在外面。

### 2. 默认策略

```bash
# 查看默认
sudo ufw status verbose

# 改默认(对没匹配规则的入站流量处理)
sudo ufw default deny incoming    # 拒绝所有入站(推荐)
sudo ufw default allow incoming   # 允许所有入站(危险)

# 出站默认(默认 allow,因为一般是客户端往外连)
sudo ufw default deny outgoing    # 不推荐,会让 apt、curl 等都失败
sudo ufw default allow outgoing
```

### 3. 允许 / 拒绝规则

**按端口**:

```bash
sudo ufw allow 22                # TCP+UDP 22
sudo ufw allow 22/tcp            # 仅 TCP
sudo ufw allow 53/udp            # DNS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000:8999/tcp     # 端口范围
```

**按服务名**(读取 `/etc/services`):

```bash
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw allow 'Apache Full'
```

**按 IP / 子网**:

```bash
# 允许某 IP 访问所有端口
sudo ufw allow from 192.168.1.100

# 允许某子网
sudo ufw allow from 192.168.1.0/24

# 允许某 IP 访问指定端口
sudo ufw allow from 192.168.1.100 to any port 22 proto tcp

# 拒绝(同 allow,换成 deny)
sudo ufw deny from 192.168.1.0/24
sudo ufw deny 3306               # 拒绝 MySQL 端口
```

**按网卡**:

```bash
sudo ufw allow in on eth0 to any port 80
sudo ufw deny in on wlan0         # 来自无线网卡的包全部拒绝
```

### 4. 规则的查看与删除

```bash
# 列出规则(无编号,只能按内容删)
sudo ufw status

# 列出规则(带编号,推荐)
sudo ufw status numbered

# 按编号删除(从 status numbered 里看)
sudo ufw delete 3
sudo ufw delete allow 80/tcp     # 也可以按内容删

# 重置所有规则(回到默认策略)
sudo ufw reset
# 注意:reset 会断开现有连接,且会要求重新 enable
```

### 5. 规则的位置和生效

ufw 的规则在 `Before` / `After` 关键字里区分插入位置,影响优先级。

不写时默认插入到规则链末尾(优先级最低)。要让某条规则提前匹配:

```bash
sudo ufw insert 1 allow 22/tcp        # 插到第 1 条
sudo ufw prepend allow from 192.168.1.0/24   # prepend = 插到最前
sudo ufw append deny 23               # append = 插到最后
```

### 6. 日志

```bash
sudo ufw logging on          # 开启
sudo ufw logging off         # 关闭
sudo ufw logging low         # 低(只记录阻塞的包)
sudo ufw logging medium      # 中(默认,记录阻塞 + 匹配的允许规则)
sudo ufw logging high        # 高(全部记录,日志量爆炸)

# 日志在 /var/log/ufw.log
sudo tail -f /var/log/ufw.log
```

### 7. 应用规则(ufw app)

第三方应用可以注册自己的 profile 到 `/etc/ufw/applications.d/`:

```bash
# 列出可用 profile
sudo ufw app list

# 查看 profile 详情(暴露了哪些端口)
sudo ufw app info 'Apache Full'

# 允许
sudo ufw allow 'Apache Full'
```

自己写 profile:`/etc/ufw/applications.d/myapp`:

```ini
[MyApp]
title=My Application
description=Custom app for x
ports=8080,9090/tcp
```

然后 `sudo ufw app update MyApp && sudo ufw allow MyApp`。

### 8. 实战套路

**远程服务器启用 ufw(标准流程)**:

```bash
# 1. 放行 SSH(救命!)
sudo ufw allow 22/tcp

# 2. 放行要对外的服务
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 3. 默认拒绝入站
sudo ufw default deny incoming

# 4. 启用
sudo ufw enable

# 5. 检查
sudo ufw status verbose
```

**临时放行某 IP 调试**:

```bash
sudo ufw allow from 192.168.1.50 to any port 3306 proto tcp
# 用完:
sudo ufw delete allow from 192.168.1.50 to any port 3306 proto tcp
# 或按编号:
sudo ufw status numbered
sudo ufw delete <编号>
```

**端口转发**(ufw + 内核转发一起开):

```bash
# 1. 内核打开转发
echo "net.ipv4.ip_forward=1" | sudo tee /etc/sysctl.d/99-forward.conf
sudo sysctl -p /etc/sysctl.d/99-forward.conf

# 2. /etc/ufw/sysctl.conf 里确保转发没被 ufw 关掉
sudo grep -E "^net/ipv4/ip_forward" /etc/ufw/sysctl.conf
# 默认是 0,改成 1,或加一行:
echo "net/ipv4/ip_forward=1" | sudo tee -a /etc/ufw/sysctl.conf

# 3. ufw 加转发规则(80 → 8080)
sudo nano /etc/ufw/before.rules
# 在 *filter 之前加:
# *nat
# :PREROUTING ACCEPT [0:0]
# -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
# COMMIT

sudo ufw reload
```

**调试规则不生效**:

```bash
sudo ufw status verbose        # 看规则
sudo ufw logging medium        # 开日志看实际匹配
sudo tail -f /var/log/ufw.log
sudo iptables -L -n -v | head  # 看 ufw 实际生成的 iptables 规则
```

### 9. ufw vs iptables

ufw 是 iptables/nftables 的友好封装,绝大多数情况够用。但以下场景还是直接用 iptables/nftables:

- 复杂的自定义链、mangle、raw 表
- 限速、connlimit 等高级匹配
- 容器网络(bridge / nat 自定义链常被 docker / libvirt 占用)

```bash
# ufw 看到的规则
sudo ufw status verbose

# ufw 实际生成的规则
sudo iptables -L -n -v
sudo iptables -t nat -L -n -v

# 排除冲突:ufw + docker 端口冲突时,需要让 docker 走 iptables=false
# /etc/docker/daemon.json 里加:
#   { "iptables": false }
# 然后 docker 自己管网络
```

### 10. 完全卸载

```bash
sudo ufw disable
sudo apt purge ufw
sudo rm -rf /etc/ufw /var/log/ufw.log
```

卸载后,如果之前 iptables 里有 ufw 生成的规则残留,需要手动清理或重启。