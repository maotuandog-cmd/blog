# ip 使用说明

`ip` 命令来自 `iproute2` 包，是 Linux 下用来查看与配置 **网络接口、IP 地址、路由、ARP、策略路由** 等的现代工具，是传统 `ifconfig`、`route`、`arp` 的替代品。

> 提示：在大多数新发行版中 `ifconfig` 已经被废弃，建议统一使用 `ip` 命令。

---

## 1. 基本语法

```
ip [选项] OBJECT { COMMAND | help }
```

常用对象（OBJECT）：

| 对象       | 简写 | 含义                                  |
| ---------- | ---- | ------------------------------------- |
| `link`     | `l`  | 网络接口（网卡设备层）                |
| `address`  | `a` / `addr` | 网卡绑定的 IP 地址（含掩码）  |
| `route`    | `r`  | 路由表                                |
| `neigh`    | `n`  | ARP / ND 表（邻居表）                 |
| `rule`     | `ru` | 策略路由规则                          |
| `tunnel`   | `tu` | 隧道                                  |
| `maddress` | `m`  | 多播地址                              |
| `mroute`   | `mr` | 多播路由                              |

查看帮助：

```bash
ip help
ip link help
ip addr help
ip route help
```

---

## 2. ip link — 网卡设备管理

### 2.1 查看所有网卡

```bash
ip link
ip link show
ip -s link show      # 带统计信息
```

典型输出：

```
2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000
    link/ether 00:0c:29:xx:xx:xx brd ff:ff:ff:ff:ff:ff
```

字段解读：

- **ens33**：网卡名
- `<BROADCAST,MULTICAST,UP,LOWER_UP>`：网卡标志位
  - `UP`：网卡已启用
  - `LOWER_UP`：物理链路连通
  - `BROADCAST`：支持广播
  - `MULTICAST`：支持多播
- **mtu 1500**：最大传输单元
- **qdisc fq_codel**：排队规则
- **state UP / DOWN**：网卡状态
- **link/ether ...**：MAC 地址

### 2.2 查看单个网卡

```bash
ip link show ens33
```

### 2.3 启用 / 关闭网卡

```bash
ip link set ens33 up
ip link set ens33 down
```

> 注意：通过 `ip link set ... up` 启用网卡后，如果该网卡没有配置 IP（没有激活的 connection），可能仍然无法通信。

### 2.4 修改网卡名（重命名）

```bash
ip link set ens33 name eth0
```

> 注意：网卡必须先 down 才能改名，且系统可能拒绝重命名受 NetworkManager 管理的网卡。

### 2.5 修改 MAC 地址

```bash
ip link set ens33 down
ip link set ens33 address 00:11:22:33:44:55
ip link set ens33 up
```

### 2.6 修改 MTU

```bash
ip link set ens33 mtu 9000
```

### 2.7 修改队列长度

```bash
ip link set ens33 txqueuelen 2000
```

### 2.8 开启 / 关闭 混杂模式

```bash
ip link set ens33 promisc on
ip link set ens33 promisc off
```

---

## 3. ip address — IP 地址管理

### 3.1 查看所有 IP

```bash
ip addr
ip addr show
ip a
```

输出：

```
2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
    inet 192.168.1.100/24 brd 192.168.1.255 scope global dynamic noprefixroute ens33
       valid_lft 86322sec preferred_lft 86322sec
    inet6 fe80::xxxx:xxxx:xxxx:xxxx/64 scope link
       valid_lft forever preferred_lft forever
```

字段解读：

- `inet`：IPv4 地址
- `brd`：广播地址
- `scope global`：作用域（global / link / host）
- `dynamic`：由 DHCP 动态获得
- `valid_lft / preferred_lft`：地址有效期（DHCP 续约相关）
- `noprefixroute`：内核不自动生成基于该地址的网段路由

### 3.2 查看单个网卡的 IP

```bash
ip addr show ens33
```

### 3.3 添加 IP 地址

```bash
ip addr add 192.168.1.101/24 dev ens33
```

添加第二个 IP（同一网卡多地址）：

```bash
ip addr add 10.0.0.5/24 dev ens33
```

### 3.4 删除 IP 地址

```bash
ip addr del 192.168.1.101/24 dev ens33
```

### 3.5 添加 / 删除 IPv6 地址

```bash
ip addr add 2001:db8::1/64 dev ens33
ip addr del 2001:db8::1/64 dev ens33
```

### 3.6 清除网卡所有 IP

```bash
ip addr flush dev ens33
```

只清除某协议族：

```bash
ip -4 addr flush dev ens33
ip -6 addr flush dev ens33
```

---

## 4. ip route — 路由表

### 4.1 查看路由表

```bash
ip route
ip route show
ip r
```

输出示例：

```
default via 192.168.1.1 dev ens33 proto dhcp metric 100
192.168.1.0/24 dev ens33 proto kernel scope link src 192.168.1.100 metric 100
```

字段解读：

- `default via 192.168.1.1`：默认路由（网关）
- `proto dhcp`：由 DHCP 生成
- `proto kernel`：由内核自动添加
- `scope link`：直连链路
- `src 192.168.1.100`：出包源 IP
- `metric 100`：优先级，数字越小越优先

### 4.2 查看 IPv6 路由

```bash
ip -6 route
```

### 4.3 添加默认路由

```bash
ip route add default via 192.168.1.1 dev ens33
```

### 4.4 添加网段路由

```bash
ip route add 10.0.0.0/24 via 192.168.1.254 dev ens33
```

### 4.5 添加直连路由（一般自动生成）

```bash
ip route add 192.168.2.0/24 dev ens33
```

### 4.6 删除路由

```bash
ip route del 10.0.0.0/24
ip route del default
```

### 4.7 查看指定目的地址的路由（路由追踪）

```bash
ip route get 8.8.8.8
```

输出示例：

```
8.8.8.8 via 192.168.1.1 dev ens33 src 192.168.1.100 uid 0
    cache
```

非常有用：能告诉你访问某 IP 时实际走的网卡和网关。

### 4.8 修改 metric（优先级）

```bash
ip route add default via 192.168.1.1 dev ens33 metric 50
```

### 4.9 清除路由表

```bash
ip route flush
ip route flush dev ens33
ip route flush 10.0.0.0/24
```

---

## 5. ip neigh — ARP 表（邻居表）

### 5.1 查看 ARP 表

```bash
ip neigh
ip neigh show
```

输出：

```
192.168.1.1 dev ens33 lladdr 00:11:22:33:44:55 REACHABLE
192.168.1.20 dev ens33 lladdr aa:bb:cc:dd:ee:ff STALE
```

状态说明：

- `REACHABLE`：可达
- `STALE`：过期（可能需要重新验证）
- `DELAY`：等待确认
- `PROBE`：正在探测
- `FAILED`：不可达
- `INCOMPLETE`：解析中（可能 ARP 失败）

### 5.2 手动添加 ARP 静态条目

```bash
ip neigh add 192.168.1.1 lladdr 00:11:22:33:44:55 dev ens33
```

### 5.3 删除 ARP 条目

```bash
ip neigh del 192.168.1.1 dev ens33
```

### 5.4 清除 ARP 缓存

```bash
ip neigh flush all
ip neigh flush dev ens33
```

---

## 6. ip rule — 策略路由

策略路由允许基于「源地址、入口网卡、TOS 等」选择不同的路由表。

### 6.1 查看所有规则

```bash
ip rule show
ip rule list
```

输出示例：

```
0:    from all lookup local
32765: from 192.168.1.0/24 lookup 100
32766:    from all lookup main
32767:    from all lookup default
```

含义：

- 数字越小优先级越高
- `main`：主路由表（默认 `ip route` 操作的表）
- `default`：默认空表
- `local`：本地地址表

### 6.2 添加规则：来自某网段的流量使用指定路由表

```bash
echo "100 mytable" >> /etc/iproute2/rt_tables    # 先在 rt_tables 加表名
ip rule add from 192.168.1.0/24 table mytable priority 100
ip route add default via 192.168.1.1 dev ens33 table mytable
```

### 6.3 删除规则

```bash
ip rule del from 192.168.1.0/24 table mytable
```

### 6.4 按入口网卡匹配

```bash
ip rule add iif ens33 table 100
```

---

## 7. ip tunnel — 隧道（GRE / IPIP）

### 7.1 创建 IPIP 隧道

```bash
ip tunnel add tunnel0 mode ipip local 1.1.1.1 remote 2.2.2.2
ip link set tunnel0 up
ip addr add 10.10.10.1/30 dev tunnel0
```

### 7.2 创建 GRE 隧道

```bash
ip tunnel add gre1 mode gre local 1.1.1.1 remote 2.2.2.2
ip link set gre1 up
ip addr add 10.10.20.1/30 dev gre1
```

### 7.3 查看隧道

```bash
ip tunnel show
```

### 7.4 删除隧道

```bash
ip tunnel del tunnel0
```

---

## 8. 常用组合示例

### 8.1 给临时配置一个 IP（重启失效）

```bash
ip link set ens33 up
ip addr add 192.168.1.100/24 dev ens33
ip route add default via 192.168.1.1 dev ens33
```

### 8.2 修改 MTU 为 9000（巨型帧）

```bash
ip link set ens33 mtu 9000
```

### 8.3 添加第二个 IP 到网卡

```bash
ip addr add 192.168.1.101/24 dev ens33
```

### 8.4 验证某 IP 走哪个网关出去

```bash
ip route get 8.8.8.8
```

### 8.5 让网卡走指定 metric（影响多网卡优先级）

```bash
ip route add default via 192.168.1.1 dev ens33 metric 50
```

### 8.6 临时修改 MAC 地址

```bash
ip link set ens33 down
ip link set ens33 address 00:11:22:33:44:55
ip link set ens33 up
```

---

## 9. 持久化（重启不丢失）

> `ip` 命令的所有修改默认都是 **临时的**，重启后失效。需要持久化请按发行版不同采用不同方案。

### 9.1 使用 NetworkManager（推荐）

直接用 `nmcli`，会自动生成对应的 `ip` 配置：

```bash
nmcli connection modify ens33 ipv4.addresses 192.168.1.100/24
nmcli connection up ens33
```

### 9.2 Debian / Ubuntu 使用 /etc/network/interfaces

```bash
auto ens33
iface ens33 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
```

然后 `systemctl restart networking`。

### 9.3 RHEL / CentOS / openEuler 使用 ifcfg 文件

`/etc/sysconfig/network-scripts/ifcfg-ens33`：

```
BOOTPROTO=none
IPADDR=192.168.1.100
PREFIX=24
GATEWAY=192.168.1.1
ONBOOT=yes
```

然后 `systemctl restart NetworkManager`。

### 9.4 通过脚本在 rc.local / systemd 中执行

不太推荐，只适合临时调试。

---

## 10. 常见问题排查

### 10.1 `ip` 命令找不到

```bash
# RHEL / CentOS / openEuler
yum install -y iproute

# Ubuntu / Debian
apt install -y iproute2
```

### 10.2 修改 IP 后仍然不能上网

排查顺序：

```bash
ip link              # 网卡是否 UP
ip addr              # 是否有 IP
ip route             # 是否有默认路由
ip route get 8.8.8.8 # 实际走的路径
ping 192.168.1.1     # 网关是否通
ping 8.8.8.8         # 外网是否通
ping baidu.com       # DNS 是否正常
```

### 10.3 `RTNETLINK answers: File exists`

通常是路由冲突，例如：

- 已经存在默认路由，又添加了一条
- 网段路由重复

解决：先 `ip route del` 旧的，再 `ip route add` 新的，或使用 `replace`：

```bash
ip route replace default via 192.168.1.1 dev ens33
```

### 10.4 `ip addr add` 后看不到 IP

可能网卡未 up：

```bash
ip link set ens33 up
```

### 10.5 `Cannot find device "ens33"`

- 网卡名拼写错误，用 `ip link` 查实际名称
- 网卡未启用 / 未加载驱动
- 容器或虚拟机内看到的网卡名与宿主机不同

---

## 11. ip 与传统命令对照

| 功能               | 传统命令           | 现代 ip 命令                       |
| ------------------ | ------------------ | ---------------------------------- |
| 看网卡             | `ifconfig`         | `ip link show`                     |
| 看 IP              | `ifconfig`         | `ip addr show`                     |
| 设置 IP            | `ifconfig eth0 x.x.x.x` | `ip addr add x.x.x.x/24 dev eth0` |
| 启停网卡           | `ifconfig eth0 up/down` | `ip link set eth0 up/down`     |
| 看路由表           | `route -n`         | `ip route show`                    |
| 添加默认路由       | `route add default gw x.x.x.x` | `ip route add default via x.x.x.x` |
| 删除默认路由       | `route del default gw x.x.x.x` | `ip route del default`      |
| 看 ARP 表          | `arp -n`           | `ip neigh show`                    |
| 添加 ARP           | `arp -s ...`       | `ip neigh add ...`                 |
| 路由追踪           | `traceroute`       | `traceroute`（`ip` 没有对应命令）  |

---

## 12. 小结速查表

| 需求                         | 命令                                       |
| ---------------------------- | ------------------------------------------ |
| 查看网卡                     | `ip link`                                  |
| 查看 IP                      | `ip addr`                                  |
| 启用 / 关闭网卡              | `ip link set ens33 up/down`                |
| 修改 MTU                     | `ip link set ens33 mtu 9000`               |
| 添加 IP                      | `ip addr add 192.168.1.100/24 dev ens33`   |
| 删除 IP                      | `ip addr del 192.168.1.100/24 dev ens33`   |
| 查看路由                     | `ip route`                                 |
| 添加默认路由                 | `ip route add default via 192.168.1.1`     |
| 查看某 IP 走哪条路           | `ip route get 8.8.8.8`                     |
| 查看 ARP                     | `ip neigh`                                 |
| 查看策略路由规则             | `ip rule`                                  |
| 看 TCP 连接                  | `ss -t`                                    |
| 看监听端口                   | `ss -tln`                                  |
| 配置持久化                   | `nmcli` 或发行版配置文件                   |

> `ip` 命令的修改都是临时的，重启失效，需要配合 `nmcli` 或发行版配置做持久化。