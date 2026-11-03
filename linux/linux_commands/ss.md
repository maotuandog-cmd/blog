# ss 使用说明

`ss`（Socket Statistics）是 Linux 下用来查看 **网络连接、监听端口、套接字统计** 的命令，是传统 `netstat` 的现代替代品。

优势：

- 速度更快（直接读取内核信息，而非 `/proc`）
- 能显示更多信息（TCP 内部状态、拥塞窗口、拥塞算法等）
- 默认已经预装在大多数发行版中（`iproute2` 包提供）

> 提示：`ss` 和 `netstat` 显示的字段名略有不同，但查看的内容大致对应。

---

## 1. 基本语法

```
ss [选项] [过滤条件]
```

不带任何选项时，`ss` 默认显示所有已建立的连接（非监听、非所有套接字）。

常用形式：

```
ss -t     # TCP
ss -u     # UDP
ss -l     # 监听中
ss -a     # 所有（包括监听和非监听）
ss -p     # 显示进程信息
ss -n     # 不解析服务名/主机名（更快）
ss -s     # 汇总统计
```

---

## 2. 常用选项速查

| 选项 | 含义                                          |
| ---- | --------------------------------------------- |
| `-t` | 仅显示 TCP 套接字                             |
| `-u` | 仅显示 UDP 套接字                             |
| `-x` | 仅显示 Unix 套接字                            |
| `-w` | 仅显示 raw 套接字                             |
| `-l` | 仅显示 LISTEN（监听中）的套接字              |
| `-a` | 显示所有套接字（含监听和非监听）              |
| `-n` | 不解析服务名和主机名                          |
| `-p` | 显示使用该套接字的进程（PID/程序名）          |
| `-s` | 显示汇总统计                                  |
| `-e` | 显示扩展信息                                  |
| `-o` | 显示计时器信息                                |
| `-i` | 显示 TCP 内部信息（拥塞窗口等）               |
| `-4` | 仅显示 IPv4                                   |
| `-6` | 仅显示 IPv6                                   |
| `-r` | 尝试解析服务名/主机名（默认行为）            |

> 注意：`ss` 与 `netstat` 的 `-r` 含义不同，`ss` 的 `-r` 是「尝试解析名字」，`netstat` 的 `-r` 是「显示路由表」。

---

## 3. 查看网络连接

### 3.1 查看所有 TCP 连接

```bash
ss -t
```

### 3.2 查看所有连接（TCP + UDP）

```bash
ss -a
```

或分开看：

```bash
ss -ta    # TCP 所有（含监听）
ss -ua    # UDP 所有（含监听）
```

### 3.3 不解析名字（最快）

```bash
ss -tn
ss -tln   # TCP 监听 + 不解析
```

### 3.4 显示进程信息

```bash
ss -tp
```

> 注意：`-p` 需要 root 权限才能看到其他用户的进程，普通用户只能看自己。

### 3.5 典型输出解读

```
State    Recv-Q  Send-Q   Local Address:Port    Peer Address:Port   Process
ESTAB    0       0        192.168.1.100:22      192.168.1.10:54321  users:(("sshd",pid=1234,fd=3))
```

字段含义：

- **State**：套接字状态（`ESTAB` 已建立、`LISTEN` 监听、`TIME-WAIT` 等）
- **Recv-Q / Send-Q**：接收/发送队列的字节数
- **Local Address:Port**：本地地址和端口
- **Peer Address:Port**：对端地址和端口
- **Process**：使用该套接字的进程（带 `-p` 才显示）

---

## 4. 查看监听端口

### 4.1 查看所有监听端口

```bash
ss -ln
```

### 4.2 分别查看 TCP / UDP 监听

```bash
ss -tln   # TCP 监听
ss -uln   # UDP 监听
```

### 4.3 查看监听端口并显示进程

```bash
ss -tlnp
```

### 4.4 只看特定端口

```bash
ss -tlnp sport = :22
ss -tlnp '( sport = :22 or sport = :80 )'
```

### 4.5 查看系统中所有打开的端口（监听 + 已建立）

```bash
ss -tulnp
```

---

## 5. 状态过滤

TCP 常见状态：`LISTEN`、`ESTAB`、`TIME-WAIT`、`CLOSE-WAIT`、`FIN-WAIT-1`、`FIN-WAIT-2`、`SYN-SENT`、`SYN-RECV`、`CLOSING`、`LAST-ACK`、`CLOSED`。

### 5.1 查看所有已建立的连接

```bash
ss -t state established
```

### 5.2 查看 TIME-WAIT 数量（排查性能问题常用）

```bash
ss -t state time-wait | wc -l
```

### 5.3 查看 CLOSE-WAIT

```bash
ss -t state close-wait
```

### 5.4 查看 SYN-SENT / SYN-RECV（可能有 SYN 攻击）

```bash
ss -t state syn-sent
ss -t state syn-recv
```

### 5.5 同时查看多种状态

```bash
ss -t state '( fin-wait-1 or fin-wait-2 or time-wait or close-wait )'
```

---

## 6. 地址 / 端口 过滤

`ss` 支持强大的过滤表达式。常用语法：

```
ss [选项]  '( 条件 )'
```

> 提示：复杂过滤条件建议加单引号，避免 shell 解析括号。

### 6.1 按端口

```bash
ss -tn sport = :80                # 源端口 80
ss -tn dport = :443               # 目标端口 443
ss -tn '( sport = :22 or sport = :80 )'
ss -tn 'sport = :1024:'           # 源端口大于 1024
```

### 6.2 按 IP 地址

```bash
ss -tn dst 192.168.1.10            # 目标 IP
ss -tn src 192.168.1.100           # 源 IP
ss -tn 'dst 192.168.1.0/24'        # 目标网段
```

### 6.3 按协议 + 地址 + 端口组合

```bash
ss -tn '( dport = :22 and dst 192.168.1.10 )'
```

### 6.4 排除某地址

```bash
ss -tn 'not dst 127.0.0.1'
```

---

## 7. 汇总统计

### 7.1 整体统计（最常用的「一眼看系统」命令）

```bash
ss -s
```

输出示例：

```
TCP:   15 (estab 8, closed 3, orphaned 0, timewait 2)

Transport Total     IP        IPv6
RAW      0         0         0
UDP      5         3         2
TCP      12        9         3
INET     17        12        5
FRAG     0         0         0
```

排查连接风暴 / TIME-WAIT 过多时非常有用。

---

## 8. Unix 套接字

很多进程之间的通信（如 Docker、MySQL、systemd）走 Unix Socket。

### 8.1 查看所有 Unix 套接字

```bash
ss -x
```

### 8.2 查看 Unix 监听

```bash
ss -xl
```

### 8.3 查看某个进程的 Unix 套接字

```bash
ss -xp | grep mysql
```

---

## 9. 高级用法

### 9.1 查看 TCP 内部信息（拥塞窗口、RTT 等）

```bash
ss -ti
```

### 9.2 查看每个连接的内存占用

```bash
ss -tmn | head
```

字段含义（部分内核支持）：

- `skmem:(r<rmem_alloc>/w<wmem_alloc>...)`：套接字缓冲区使用情况

### 9.3 持续观察连接变化

```bash
watch -n 1 "ss -s"
```

或循环：

```bash
while true; do ss -s; sleep 1; clear; done
```

### 9.4 把 ss 输出保存为脚本输入

```bash
ss -tn state established > /tmp/conn.txt
```

---

## 10. 常见排查场景

### 10.1 哪个进程占用了 80 端口？

```bash
ss -tlnp sport = :80
```

### 10.2 服务器连接数过多，怀疑是攻击

```bash
ss -s                    # 看总数
ss -tn state syn-recv    # 看半连接
ss -tn 'dst 你的IP' | wc -l   # 看某个 IP 的连接数
```

### 10.3 大量 TIME-WAIT

```bash
ss -tan state time-wait | wc -l
```

如果数量异常高，需要：

- 调整内核参数：`net.ipv4.tcp_tw_reuse = 1`
- 排查上游为何频繁断连

### 10.4 大量 CLOSE-WAIT

通常表示 **对端关闭了连接，但本端进程没有调用 close()**：

```bash
ss -tn state close-wait
```

需要排查应用层是否正确关闭连接（常见于 HTTP 客户端未关闭）。

### 10.5 看本机对外的 TCP 连接（看连了哪些外网地址）

```bash
ss -tn dst not 127.0.0.1 and dst not 192.168.0.0/16
```

### 10.6 看哪些远程端口连到了本机

```bash
ss -tn '( dport = :22 )'
```

---

## 11. ss 与 netstat 对照

| 用途               | netstat                            | ss                          |
| ------------------ | ---------------------------------- | --------------------------- |
| 所有连接           | `netstat -a`                       | `ss -a`                     |
| TCP 连接           | `netstat -t`                       | `ss -t`                     |
| UDP                | `netstat -u`                       | `ss -u`                     |
| 监听端口           | `netstat -ln`                      | `ss -ln`                    |
| 不解析名字         | `netstat -ln --numeric`            | `ss -ln`（默认就不解析可加 `-n` 更明确） |
| 显示进程           | `netstat -lnp`                     | `ss -lnp`                   |
| 统计               | `netstat -s`                       | `ss -s`                     |
| 路由表             | `netstat -r`                       | `ip route`（`ss` 不支持）   |

> `ss` 不支持路由表功能，路由请用 `ip route`。

---

## 12. 小结速查表

| 需求                         | 命令                                       |
| ---------------------------- | ------------------------------------------ |
| 查看所有连接                 | `ss -a`                                    |
| 查看 TCP 连接                | `ss -t`                                    |
| 查看 UDP 连接                | `ss -u`                                    |
| 查看监听端口                 | `ss -ln`                                   |
| 查看 TCP 监听 + 进程         | `ss -tlnp`                                 |
| 查看汇总统计                 | `ss -s`                                    |
| 查看 TIME-WAIT               | `ss -t state time-wait`                    |
| 查看 CLOSE-WAIT              | `ss -t state close-wait`                   |
| 查看 80 端口占用进程         | `ss -tlnp sport = :80`                     |
| 看与某 IP 的所有连接         | `ss -tn dst 192.168.1.10`                  |
| 看 TCP 内部信息              | `ss -ti`                                   |
| 看 Unix 套接字               | `ss -x`                                    |
| 持续刷新                     | `watch -n 1 "ss -s"`                       |

> 复杂过滤时建议加单引号，例如：`ss -tn '( sport = :22 and dst 192.168.1.10 )'`