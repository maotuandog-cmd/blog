# tcpdump 使用说明

`tcpdump` 是 Linux 下最经典、强大的 **命令行抓包工具**，底层基于 libpcap，可以按各种条件过滤网络包并保存为 pcap 文件供 Wireshark 分析。

> 提示：抓包通常需要 root 权限。

---

## 1. 安装

```bash
# RHEL / CentOS / openEuler
yum install -y tcpdump

# Ubuntu / Debian
apt install -y tcpdump
```

确认安装：

```bash
tcpdump --version
```

---

## 2. 基本语法

```
tcpdump [选项] [过滤表达式]
```

常见用法：

```bash
tcpdump -i eth0                       # 抓 eth0 上所有包
tcpdump -i any                        # 抓所有接口
tcpdump -i eth0 port 80               # 只抓 80 端口
tcpdump -i eth0 host 192.168.1.10     # 只抓与某 IP 相关的包
tcpdump -i eth0 -w /tmp/cap.pcap      # 保存为 pcap
tcpdump -r /tmp/cap.pcap              # 读取 pcap
```

> 不带任何参数时默认抓第一个可用接口的所有包，**这是非常危险的**，会把屏幕刷满。

---

## 3. 常用选项速查

| 选项                       | 含义                                                   |
| -------------------------- | ------------------------------------------------------ |
| `-i <iface>`               | 指定监听网卡，`any` 表示所有接口                       |
| `-n`                       | 不解析主机名（IP 形式）                                |
| `-nn`                      | 不解析主机名和端口名（显示原始端口号）                 |
| `-c <count>`               | 抓到指定数量包后自动退出                                |
| `-w <file>`                | 把原始包写入文件（pcap 格式）                          |
| `-r <file>`                | 从 pcap 文件读取并显示                                  |
| `-v / -vv / -vvv`          | 详细程度递增                                           |
| `-X`                       | 同时显示 hex 和 ASCII                                  |
| `-xx`                      | 同时显示 hex（含链路层）                               |
| `-A`                       | 用 ASCII 打印每个包（适合看 HTTP）                     |
| `-s <len>`                 | 每个包抓取的字节数，默认 68；想抓完整包请用 `-s 0`     |
| `-l`                       | 行缓冲输出（适合管道 / grep）                          |
| `-t`                       | 不显示时间戳                                           |
| `-tt`                      | 显示 UNIX 时间戳                                       |
| `-ttt`                     | 显示两个包之间的微秒差                                  |
| `-e`                       | 显示链路层信息（MAC 地址）                             |
| `-S`                       | 显示绝对 TCP 序列号                                    |
| `-D`                       | 列出所有可抓包网卡                                     |
| `-L`                       | 列出网卡支持的数据链路类型                             |
| `-F <file>`                | 从文件读取过滤表达式                                   |
| `-p`                       | 不把网卡设为混杂模式                                   |

---

## 4. 基本抓包

### 4.1 指定网卡抓包

```bash
tcpdump -i ens33
```

### 4.2 抓所有接口

```bash
tcpdump -i any
```

### 4.3 抓指定数量后退出

```bash
tcpdump -i ens33 -c 100
```

### 4.4 不解析名字

```bash
tcpdump -i ens33 -nn
```

### 4.5 抓完整包（默认会截断）

```bash
tcpdump -i ens33 -s 0
```

### 4.6 列出可抓包的网卡

```bash
tcpdump -D
```

输出示例：

```
1.eth0 [Up, Running]
2.any (Pseudo-device that captures on all interfaces) [Running, Pseudo-device]
3.lo [Up, Running, Loopback]
4.docker0 [Up]
```

---

## 5. 过滤表达式（BPF）

`tcpdump` 支持强大的 Berkeley Packet Filter (BPF) 语法，是它的灵魂。

### 5.1 类型关键字

| 关键字 | 含义                       |
| ------ | -------------------------- |
| `host` | 主机（IP），默认            |
| `net`  | 网段                       |
| `port` | 端口                       |
| `portrange` | 端口范围，如 `portrange 1-1024` |
| `src`  | 源                         |
| `dst`  | 目的                       |
| `ether` | MAC 地址                  |
| `gateway` | 网关                      |

### 5.2 协议关键字

`tcp` / `udp` / `icmp` / `arp` / `ip` / `ip6` / `rarp` / `decnet` 等。

### 5.3 按主机过滤

```bash
tcpdump -i ens33 host 192.168.1.10
tcpdump -i ens33 src 192.168.1.10
tcpdump -i ens33 dst 192.168.1.20
```

### 5.4 按网段过滤

```bash
tcpdump -i ens33 net 192.168.1.0/24
tcpdump -i ens33 src net 192.168.1.0/24
```

### 5.5 按端口过滤

```bash
tcpdump -i ens33 port 80
tcpdump -i ens33 src port 22
tcpdump -i ens33 dst port 443
tcpdump -i ens33 portrange 1-1024
```

### 5.6 按协议过滤

```bash
tcpdump -i ens33 tcp
tcpdump -i ens33 udp
tcpdump -i ens33 icmp
tcpdump -i ens33 arp
```

### 5.7 组合过滤：与 / 或 / 非

| 逻辑 | 关键字 |
| ---- | ------ |
| 与   | `and` / `&&` |
| 或   | `or` / `\|\|` |
| 非   | `not` / `!`  |

> 注意：复杂过滤条件建议加单引号或反斜杠转义，避免 shell 解析特殊字符。

```bash
tcpdump -i ens33 'src 192.168.1.10 and dst port 22'
tcpdump -i ens33 'tcp and port 80 and host 192.168.1.10'
tcpdump -i ens33 'not arp and not icmp'
tcpdump -i ens33 'src 192.168.1.10 or dst 192.168.1.20'
```

### 5.8 按 TCP 标志位过滤

```bash
# 只抓 SYN 包
tcpdump -i ens33 'tcp[tcpflags] & tcp-syn != 0'

# 只抓 SYN+ACK
tcpdump -i ens33 'tcp[tcpflags] & (tcp-syn|tcp-ack) == (tcp-syn|tcp-ack)'

# 只抓 FIN
tcpdump -i ens33 'tcp[tcpflags] & tcp-fin != 0'

# 只抓 RST
tcpdump -i ens33 'tcp[tcpflags] & tcp-rst != 0'
```

### 5.9 按包大小过滤

```bash
# 大于 500 字节
tcpdump -i ens33 greater 500

# 小于 100 字节
tcpdump -i ens33 less 100
```

---

## 6. 查看包内容

### 6.1 默认输出（头部）

```bash
tcpdump -i ens33
```

```
17:32:01.123456 IP 192.168.1.10.54321 > 192.168.1.20.22: Flags [S], seq 1234567890, win 29200, length 0
```

字段说明：

- 时间戳（带微秒）
- 协议（IP、IP6、ARP 等）
- 源地址.源端口 > 目的地址.目的端口
- Flags：`S` SYN、`.` ACK、`F` FIN、`R` RST、`P` PSH
- seq、win、length 等

### 6.2 显示 ASCII 内容（看 HTTP 明文很有用）

```bash
tcpdump -i ens33 -A port 80
```

### 6.3 显示十六进制 + ASCII

```bash
tcpdump -i ens33 -X port 80
```

### 6.4 显示链路层（MAC）信息

```bash
tcpdump -i ens33 -e
```

### 6.5 详细程度

```bash
tcpdump -i ens33 -v
tcpdump -i ens33 -vv
tcpdump -i ens33 -vvv
```

### 6.6 显示绝对序列号

```bash
tcpdump -i ens33 -S -nn
```

---

## 7. 保存与回放（pcap）

### 7.1 抓包并保存

```bash
tcpdump -i ens33 -w /tmp/cap.pcap
tcpdump -i ens33 -w /tmp/cap.pcap -c 1000        # 抓 1000 包后停
tcpdump -i ens33 -w /tmp/cap.pcap -s 0           # 抓完整包
```

后台抓包（防 SSH 断开丢包）：

```bash
nohup tcpdump -i ens33 -w /tmp/cap.pcap -s 0 &
```

### 7.2 读取 pcap 文件

```bash
tcpdump -r /tmp/cap.pcap
tcpdump -r /tmp/cap.pcap -nn
tcpdump -r /tmp/cap.pcap host 192.168.1.10
tcpdump -r /tmp/cap.pcap -c 50
```

### 7.3 配合 Wireshark 分析

把 pcap 下载到本地，用 Wireshark 打开：

```bash
sz /tmp/cap.pcap      # 用 lrzsz
scp user@host:/tmp/cap.pcap .
```

### 7.4 滚动文件（按大小 / 时间切分）

`tcpdump` 本身不支持滚动，需要配合脚本：

```bash
tcpdump -i ens33 -w /tmp/cap-%Y%m%d-%H%M%S.pcap -G 60 -W 60
```

参数含义：

- `-G 60`：每 60 秒切一个文件
- `-W 60`：最多保留 60 个文件

---

## 8. 实战案例

### 8.1 看本机对外 HTTP 请求

```bash
tcpdump -i ens33 -A -s 0 port 80 and host baidu.com
```

### 8.2 看 DNS 查询

```bash
tcpdump -i ens33 -nn port 53
```

### 8.3 看 TCP 三次握手

```bash
tcpdump -i ens33 -nn -S 'tcp and port 80'
```

输出示例：

```
IP 192.168.1.10.54321 > 93.184.216.34.80: Flags [S], seq 1000, ...
IP 93.184.216.34.80 > 192.168.1.10.54321: Flags [S.], seq 2000, ack 1001, ...
IP 192.168.1.10.54321 > 93.184.216.34.80: Flags [.], ack 2001, ...
```

### 8.4 看 TCP 四次挥手

```bash
tcpdump -i ens33 -nn 'tcp and port 22'
```

观察 FIN / ACK 的来回。

### 8.5 看 SSH 流量（加密，看不到内容）

```bash
tcpdump -i ens33 -nn port 22
```

### 8.6 看 ping (ICMP)

```bash
tcpdump -i ens33 -nn icmp
```

### 8.7 看 ARP 解析

```bash
tcpdump -i ens33 arp
```

### 8.8 排查连接慢：看 SYN 是否回 SYN+ACK

```bash
tcpdump -i ens33 -nn 'tcp[tcpflags] & tcp-syn != 0'
```

### 8.9 排查丢包：看 RST

```bash
tcpdump -i ens33 -nn 'tcp[tcpflags] & tcp-rst != 0'
```

### 8.10 看哪些 IP 在访问本机（统计）

```bash
tcpdump -i ens33 -nn -c 1000 | awk '{print $3}' | cut -d. -f1-4 | sort | uniq -c | sort -rn | head
```

### 8.11 抓 HTTPS 并保存密钥（用 Wireshark 解密）

需要在客户端设置 `SSLKEYLOGFILE`，tcpdump 只负责抓包，解密靠 Wireshark。

### 8.12 看指定进程的网络流量（-p 已知不直接支持，需要 root + 知道端口）

```bash
ss -tlnp           # 先查到进程监听的端口
tcpdump -i lo -A port 3306     # 例如抓 MySQL
```

### 8.13 抓本地回环

```bash
tcpdump -i lo
```

> 注意：默认 `any` 在某些系统下抓不到 lo，建议单独 `-i lo`。

### 8.14 抓 VLAN 标签

```bash
tcpdump -i ens33 -e vlan
```

---

## 9. 时间戳格式

```bash
tcpdump -i ens33 -tt            # UNIX 时间戳
tcpdump -i ens33 -tttt          # 带日期的 UNIX 时间戳
tcpdump -i ens33 -ttt           # 微秒差
tcpdump -i ens33 -t             # 不显示时间戳
```

---

## 10. 抓包性能与注意事项

### 10.1 高流量接口抓包会丢包

提示信息示例：

```
119 packets captured
200 packets received by filter
20 packets dropped by kernel
```

- 用 `-s 0` 会更慢，按需设置
- 复杂 BPF 过滤会增加 CPU 消耗

### 10.2 不要在生产大流量机器上长时间抓全包

建议：

- 用过滤表达式尽量减少范围
- 用 `-c` 或 `-G` 限定包数或时间
- 写入独立磁盘（不要和业务数据共用）

### 10.3 抓包后务必压缩 / 归档

```bash
tcpdump -w /tmp/cap.pcap
gzip /tmp/cap.pcap
```

---

## 11. 与其他工具配合

### 11.1 tcpdump + grep 实时分析

```bash
tcpdump -i ens33 -l -A -s 0 port 80 | grep -i 'HTTP/'
```

`-l` 让输出走标准缓冲，便于 grep / awk 实时处理。

### 11.2 tcpdump + Wireshark

Wireshark 提供 GUI，能直接打开 tcpdump 生成的 pcap 文件，分析更直观。

### 11.3 tcpdump + tshark

如果想用脚本化方式分析 pcap：

```bash
tshark -r /tmp/cap.pcap -Y http.request
```

---

## 12. 常见问题排查

### 12.1 报错 `tcpdump: ens33: That device is not up`

网卡未启用：

```bash
ip link set ens33 up
```

### 12.2 报错 `Permission denied`

非 root 用户抓包会失败，请加 `sudo`：

```bash
sudo tcpdump -i ens33
```

### 12.3 SSH 远程抓包时 SSH 自己中断

建议用 `nohup ... &` 后台运行，或者 `screen` / `tmux` 会话中抓包。

### 12.4 抓不到包

可能原因：

- 网卡流量根本没经过你想抓的接口（例如本机进程之间走 lo）
- 用 `-i any` 时部分系统不抓 lo
- 网卡在混杂模式下其他主机的包才能抓到，本机通信一般不需要
- 用了过于严格的过滤条件

### 12.5 输出乱码或内容被截断

- 加 `-s 0` 抓完整包
- 加 `-X` 或 `-A` 看明文

---

## 13. 小结速查表

| 需求                          | 命令                                                 |
| ----------------------------- | ---------------------------------------------------- |
| 默认网卡抓所有包              | `tcpdump -i ens33`                                   |
| 抓所有接口                    | `tcpdump -i any`                                     |
| 抓包后写入文件                | `tcpdump -i ens33 -w /tmp/cap.pcap`                  |
| 抓完整包                      | `tcpdump -i ens33 -s 0`                              |
| 抓指定 IP 流量                | `tcpdump -i ens33 host 192.168.1.10`                 |
| 抓指定端口                    | `tcpdump -i ens33 port 80`                           |
| 抓指定协议                    | `tcpdump -i ens33 icmp`                              |
| 抓 SYN 包                     | `tcpdump -i ens33 'tcp[tcpflags] & tcp-syn != 0'`    |
| 看 HTTP 明文                  | `tcpdump -i ens33 -A port 80`                        |
| 看 16 进制 + ASCII            | `tcpdump -i ens33 -X port 80`                        |
| 不解析名字                    | `tcpdump -i ens33 -nn`                               |
| 读取 pcap                     | `tcpdump -r /tmp/cap.pcap`                           |
| 抓 N 个包后停                 | `tcpdump -i ens33 -c 100`                            |
| 每分钟切一个 pcap             | `tcpdump -i ens33 -w /tmp/cap.pcap -G 60 -W 60`      |

> 远程抓包建议在 `tmux` / `screen` 中执行，或者用 `nohup ... &`，避免 SSH 断开导致抓包失败。