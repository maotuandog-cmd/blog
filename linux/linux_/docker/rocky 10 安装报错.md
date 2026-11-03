这次 Rocky Linux 10 上 Docker 启动失败，整个排查过程可以总结为：先遇到 Docker 与 firewalld 交互报错，后续日志明确显示 IPv4 转发关闭，开启后 Docker 恢复正常。

## 一、问题与原因

环境信息：

|项目|实际情况|
|---|---|
|操作系统|Rocky Linux 10|
|Docker Engine|29.9.2|
|firewalld|2.4.0|
|firewalld 后端|nftables|
|nftables|1.1.5|
|Docker 网段配置|`10.110.120.1/26`|

排查中出现了两类关键错误。

问题 1：firewalld 防火墙规则交互异常

最初日志出现：

```
failed to create NAT chain DOCKER:
COMMAND_FAILED: INVALID_IPV:
'ipv4' is not a valid backend or is unavailable
```

说明 Docker 初始化网络时，firewalld 返回了防火墙规则操作错误。仅凭这条日志无法确定其根因；后续日志已出现更明确的启动阻断原因。

问题 2：Linux IPv4 转发未开启（直接阻断启动的原因）

后续日志明确显示：

```
error creating default "bridge" network:
IPv4 forwarding is disabled
```

Docker 创建默认 `bridge` 网络需要 Linux 内核支持 IPv4 转发。转发关闭时，Docker 无法完成网络初始化，最终退出。

## 二、最终解决方法

执行以下命令开启 IPv4 转发：

```
sysctl -w net.ipv4.ip_forward=1
```

为了让配置在系统重启后仍然生效，写入持久化配置：

```
cat >/etc/sysctl.d/99-docker-ip-forward.conf <<'EOF'
net.ipv4.ip_forward = 1
EOF

sysctl --system
```

然后重置 systemd 的失败状态并重启 Docker：

```
systemctl reset-failed docker
systemctl restart docker
systemctl status docker --no-pager -l
```

用户反馈执行后 Docker 已正常启动。

## 三、为什么会出现这个问题？

Docker 的默认 bridge 网络通常需要完成以下工作：

1. 创建 Docker 网桥。
    
2. 配置 NAT 和转发规则，使容器能够访问外部网络。
    
3. 设置必要的内核转发能力。
    

其中，`net.ipv4.ip_forward=0` 表示内核没有启用 IPv4 转发，因此 Docker 在创建默认网络时失败。

需要注意：开启 IPv4 转发解决了本次最终阻断启动的问题，但不代表最初的 `INVALID_IPV` 报错已经查明根因。 既然 Docker 现在已正常运行，如果容器网络、端口映射均正常，可以暂时不再修改防火墙配置；若后续再次出现 `INVALID_IPV`，再单独排查 Docker 与 firewalld 的兼容及规则交互。

## 四、以后遇到类似问题，按这个顺序排查

```
# 1. 查看 IPv4 转发状态
sysctl net.ipv4.ip_forward

# 2. 查看 Docker 服务状态
systemctl status docker --no-pager -l

# 3. 查看 Docker 启动日志
journalctl -u docker -b --no-pager -n 100

# 4. 查看 firewalld 状态
systemctl status firewalld --no-pager -l

# 5. 查看 Docker 网络
docker network ls
```

如果 `net.ipv4.ip_forward = 0`，先按上面的方法开启转发；如果转发已经开启，则继续根据 Docker 日志中的第一个致命错误排查。

最终结论：本次 Docker 无法启动的直接原因是 Linux IPv4 转发关闭；开启转发并持久化配置后，Docker 恢复正常。


不一定。问题 1 的 `INVALID_IPV` 报错，不是简单地在 `/etc/docker/daemon.json` 中指定后端就一定能解决。

结合你的环境：

- Rocky Linux 10
    
- Docker 29.9.2
    
- firewalld 2.4.0，使用 `nftables` 后端
    
- `iptables-nft` 已安装
    
- Docker 最初报错：`'ipv4' is not a valid backend or is unavailable`
    

需要区分两件事：

1. Docker 选择哪种防火墙后端：可以通过 `daemon.json` 中的 `firewall-backend` 配置。
    
2. firewalld 为什么返回 `INVALID_IPV`：这可能涉及 Docker 与 firewalld 的规则交互、版本兼容性或 firewalld 配置，不能仅凭这条错误认定必须切换后端。
    

## 建议怎么处理

Docker 官方文档确认，Docker 29 可以通过以下配置显式启用原生 nftables 后端：

Docker Docs+1

```
{
  "bip": "10.110.120.1/26",
  "firewall-backend": "nftables"
}
```

但你之前的日志里出现过：

```
Deleting nftables IPv4 rules
delete table ip docker-bridges
```

这说明 Docker 曾经尝试清理原生 nftables 后端使用的规则表，但不能仅凭清理日志证明当时已经正式启用了该后端。

因此，我建议：

1. 既然 Docker 现在已经能正常启动，先不要为了消除旧日志而改配置。
    
2. 执行 `docker info`，看看是否报告实际使用的防火墙后端。
    
3. 如果之后再次出现 `INVALID_IPV`，再考虑显式启用 nftables 后端，并结合新日志确认问题是否消失。
    

简而言之：指定 `"firewall-backend": "nftables"` 是一个可尝试的解决方向，不是已证实的必需修复。