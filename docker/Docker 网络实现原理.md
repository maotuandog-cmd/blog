# Docker 网络实现原理

> 机制与规则对照 Docker 官方文档 `manuals/engine/network/*` 整理。
> **本文中的 iptables 规则、veth/bridge 拓扑、DNS 行为均为在本机启动 Docker Engine 27.3.1 真实守护进程后实测抓取**，标注为「实测」；纯文档来源标注为「文档」。

---

## 目录

1. [整体架构](#一整体架构)
2. [Linux 网络栈基础](#二linux-网络栈基础)
3. [Bridge 网络实现](#三bridge-网络实现)
4. [用户自定义网络与隔离](#四用户自定义网络与隔离)
5. [嵌入式 DNS 实现](#五嵌入式-dns-实现)
6. [端口发布实现](#六端口发布实现)
7. [iptables 链完整结构](#七iptables-链完整结构)
8. [网关模式](#八网关模式)
9. [其他驱动实现](#九其他驱动实现)
10. [防火墙交互与 ufw/firewalld](#十防火墙交互与-ufwfirewalld)
11. [调试方法](#十一调试方法)
12. [排错](#十二排错)
13. [速查表](#十三速查表)

---

## 一、整体架构

Docker 网络由三层组成：

```
┌─────────────────────────────────────────────┐
│  Docker CLI / API                            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  libnetwork（Docker 内置网络库）              │
│  ├─ 网络管理：创建/删除/连接/断开             │
│  ├─ IPAM：子网划分 + 地址分配                  │
│  ├─ 嵌入式 DNS（127.0.0.11）                 │
│  └─ 驱动层：bridge / host / overlay / ...    │
└──────────────────┬──────────────────────────┘
                   │  操作 Linux 网络栈
┌──────────────────▼──────────────────────────┐
│  Linux 内核                                   │
│  ├─ network namespace（每个容器独立）         │
│  ├─ veth pair（容器 ↔ 宿主网桥）             │
│  ├─ Linux bridge（docker0 / br-xxx）         │
│  └─ netfilter / iptables / nftables          │
└─────────────────────────────────────────────┘
```

**关键认知**：Docker 自己不实现网络协议栈，它做的是**编排内核已有的能力** —— 创建 netns、创建 veth、创建 bridge、写 iptables 规则。官方文档明确说这些属于「实现细节」：

> When you create or remove a user-defined bridge or connect or disconnect a container from a user-defined bridge, Docker uses tools specific to the operating system to manage the underlying network infrastructure (such as adding or removing bridge devices or configuring `iptables` rules on Linux). These details should be considered implementation details. Let Docker manage your user-defined networks for you.

---

## 二、Linux 网络栈基础

### 容器网络命名空间

每个容器有自己的 network namespace，里面只有 `lo`（回环）和连接网桥的 `eth0`。

**实测** —— 容器内视角：

```
$ docker exec web1 ip -o addr show eth0
15: eth0    inet 172.18.0.3/16 brd 172.18.255.255 scope global eth0

$ docker exec web1 ip route
default via 172.18.0.1 dev eth0
172.18.0.0/16 dev eth0 scope link  src 172.18.0.3
```

默认路由的网关 `172.18.0.1` 就是该网络 bridge 接口的地址。

**实测** —— 宿主机上每个容器对应一个 netns 文件：

```
$ ls -la /var/run/docker/netns/
-r--r--r-- 1 root root 0 04a03bb89853
-r--r--r-- 1 root root 0 14c1aad12aae
-r--r--r-- 1 root root 0 68d428601706
```

### veth pair

容器与网桥之间用 **veth 对**连接：一端在容器 netns 里叫 `eth0`，另一端在宿主侧叫 `vethXXXXXX`，并挂在 bridge 上。

**实测** —— 宿主机侧：

```
$ ip -o link show | grep veth
14: veth8287661@if13: ... master br-a7038742f672 state UP link-netnsid 0
16: veth09e77b6@if15: ... master br-a7038742f672 state UP link-netnsid 1
18: veth577d9bc@if17: ... master docker0          state UP link-netnsid 2
```

要点：

- `master br-xxx` / `master docker0` —— 该 veth 挂在哪个网桥上
- `link-netnsid N` —— 对端在 netns 中的索引
- `@if13` —— 对端接口索引

### Linux bridge

**实测** —— 默认网桥 `docker0`：

```
$ ip -d addr show docker0
11: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 ... 
    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
```

**实测** —— 用户自定义网络 `alpine-net` 自动创建 `br-<网络ID前12位>` 网桥：

```
$ ip -o addr show | grep -E "br-|docker0"
11: docker0    inet 172.17.0.1/16  brd 172.17.255.255
12: br-a7038742f672  inet 172.18.0.1/16  brd 172.18.255.255
```

网桥名称规则：`br-` + 网络 ID 前 12 位。

---

## 三、Bridge 网络实现

### 默认 bridge 网络

Docker 启动时自动创建 `docker0`，子网默认 `172.17.0.0/16`，网关 `172.17.0.1`。

**实测** —— 默认 bridge 网络的完整选项：

```
$ docker network inspect bridge --format '{{.Driver}} | {{range .IPAM.Config}}{{.Subnet}} gw={{.Gateway}}{{end}} | options={{.Options}}'

bridge | 172.17.0.0/16 gw=172.17.0.1 | options=map[
  com.docker.network.bridge.default_bridge:true
  com.docker.network.bridge.enable_icc:true
  com.docker.network.bridge.enable_ip_masquerade:true
  com.docker.network.bridge.host_binding_ipv4:0.0.0.0
  com.docker.network.bridge.name:docker0
  com.docker.network.driver.mtu:1500
]
```

默认 bridge 属于 **legacy 机制，官方不建议生产使用**。

### 用户自定义 bridge 网络

```bash
docker network create --driver bridge alpine-net
```

**实测** —— 创建后自动分配子网与网桥：

```
$ docker network inspect alpine-net --format '{{range .IPAM.Config}}{{.Subnet}} gw={{.Gateway}}{{end}}'
172.18.0.0/16 gw=172.18.0.1

$ ip -o addr show | grep br-
12: br-a7038742f672  inet 172.18.0.1/16
```

`172.18.0.0/16` 正是官方文档给出的 `default-address-pools` 第二个池 —— **子网是自动从地址池里划分的**，不是随机的。

### 自动子网分配池

**文档** —— `daemon.json` 中可配置：

```json
{
  "default-address-pools": [
    { "base": "172.17.0.0/16", "size": 16 },
    { "base": "172.18.0.0/16", "size": 16 },
    { "base": "172.19.0.0/16", "size": 16 },
    { "base": "172.20.0.0/14", "size": 16 },
    { "base": "172.24.0.0/14", "size": 16 },
    { "base": "172.28.0.0/14", "size": 16 },
    { "base": "192.168.0.0/16", "size": 20 }
  ]
}
```

- `base`：可分配的段
- `size`：每个分配子网的前缀长度

需要 IPv6 时若池中无 IPv6 地址，Docker 从 ULA（`fd00::/8`）前缀分配。

### bridge 驱动专属选项

**文档** —— 通过 `--opt` 传入：

| 选项 | 默认 | 说明 |
|------|------|------|
| `com.docker.network.bridge.name` | | Linux bridge 接口名 |
| `com.docker.network.bridge.enable_ip_masquerade` | `true` | 启用 IP 伪装 |
| `com.docker.network.host_ipv4` / `host_ipv6` | | 源 NAT 使用的地址 |
| `com.docker.network.bridge.gateway_mode_ipv4` / `_ipv6` | `nat` | 控制外部连通性 |
| `com.docker.network.bridge.enable_icc` | `true` | 启用容器间互访 |
| `com.docker.network.bridge.host_binding_ipv4` | 所有 IPv4+IPv6 | 发布端口的默认绑定地址 |
| `com.docker.network.driver.mtu` | `0`（不限） | 容器网卡 MTU |
| `com.docker.network.container_iface_prefix` | `eth` | 容器接口名前缀 |
| `com.docker.network.bridge.inhibit_ipv4` | `false` | 不给 bridge 分配 IPv4 地址 |

部分选项有对应的 `dockerd` 启动参数：

| 选项 | dockerd 参数 |
|------|------------|
| `com.docker.network.bridge.enable_ip_masquerade` | `--ip-masq` |
| `com.docker.network.bridge.enable_icc` | `--icc` |
| `com.docker.network.bridge.host_binding_ipv4` | `--ip` |
| `com.docker.network.driver.mtu` | `--mtu` |

**实测** —— `dockerd --help` 中相关参数：

```
--bip string              Specify network bridge IP
--default-gateway ip      Container default gateway
--default-gateway-v6 ip   Container default gateway
--dns ipSlice             DNS server to use (default [])
--dns-opt list            DNS options to use
--dns-search list         DNS search domains to use
--fixed-cidr string       IPv4 subnet for fixed IPs
--fixed-cidr-v6 string    IPv6 subnet for fixed IPs
--icc                     Enable inter-container
--ip ip                   Default IP when binding
--ip-forward              Enable
--ip-masq                 Enable IP masquerading
--ip6tables               Enable addition of
--iptables                Enable addition of
--mtu int                 Set the MTU for the
--userland-proxy          Use userland proxy for
--userland-proxy-path string
```

### 默认 bridge 的 daemon.json 配置

**文档** —— 默认 bridge 只能在 `daemon.json` 里配，改完要重启 Docker：

```json
{
  "bip": "192.168.1.1/24",
  "fixed-cidr": "192.168.1.0/25",
  "mtu": 1500,
  "default-gateway": "192.168.1.254",
  "dns": ["10.20.1.2", "10.20.1.3"]
}
```

| 键 | 含义 |
|----|------|
| `bip` | bridge 接口地址，同时决定网段 |
| `fixed-cidr` | 容器地址分配范围 |
| `default-gateway` | 容器默认网关 |
| `dns` | DNS 服务器 |

IPv6 需要 `ipv6: true`（必需）+ `bip6` / `fixed-cidr-v6` / `default-gateway-v6`（可选）。

> 这三个 IPv6 选项**只影响默认 bridge**，用户自定义网络不适用。

### bridge 网络的 1000 容器限制

**文档** —— 受 Linux 内核限制，单个网络连接 **1000 个及以上容器**时会不稳定，容器间通信可能中断（moby/moby#44973）。

### 跳过 bridge IP 配置

`com.docker.network.bridge.inhibit_ipv4` 选项可创建不带 IPv4 网关地址的 bridge，用于手动配置网关的场景。此时南北向流量不通，除非你自己在 bridge 上配好网关地址。**该选项仅用于用户自定义 bridge。**

---

## 四、用户自定义网络与隔离

### 用户自定义 vs 默认 bridge

**文档** —— 用户自定义 bridge 的五个优势：

| | 默认 bridge | 用户自定义 bridge |
|---|---|---|
| DNS 解析 | ❌ 只能按 IP | ✅ 按名字/别名自动解析 |
| 隔离性 | 弱（所有容器都在一个网段） | 强（只有接入的容器能互通） |
| 运行时增删 | 需停容器重建 | ✅ `docker network connect/disconnect` 随时增删 |
| 配置粒度 | 全局统一，改要重启 daemon | 每个网络独立，创建时配置 |
| 共享环境变量 | 靠 legacy `--link` | 用卷 / compose 文件 / swarm secrets & configs |

**实测** —— DNS 行为对比（同一台机器，两个容器分别在不同网络）：

```bash
# web1 在用户自定义网络 alpine-net
$ docker exec web1 getent hosts web2
172.18.0.2        web2  web2          # ← 解析成功

# web3 在默认 bridge
$ docker exec web3 getent hosts web2
(exit=2)                             # ← 解析失败
```

**实测** —— `/etc/resolv.conf` 的差异：

```
# 用户自定义网络（web1）
# Generated by Docker Engine.
nameserver 127.0.0.11
search .

# 默认 bridge（web3）
# Generated by Docker Engine.
nameserver 211.138.91.1              # ← 宿主 DNS，宿主是 127.0.0.53 时被替换
```

这是**嵌入式 DNS 只在用户自定义网络上启用**的直接证据。

### 跨网络隔离的实现

**实测** —— 创建用户自定义网络后，filter 表自动出现按网桥区分的 DROP 规则：

```bash
$ iptables -S | grep ISOLATION
-N DOCKER-ISOLATION-STAGE-1
-N DOCKER-ISOLATION-STAGE-2
-A FORWARD -j DOCKER-ISOLATION-STAGE-1
-A DOCKER-ISOLATION-STAGE-1 -i br-a7038742f672 ! -o br-a7038742f672 -j DOCKER-ISOLATION-STAGE-2
-A DOCKER-ISOLATION-STAGE-1 -i docker0 ! -o docker0 -j DOCKER-ISOLATION-STAGE-2
-A DOCKER-ISOLATION-STAGE-1 -j RETURN
-A DOCKER-ISOLATION-STAGE-2 -o br-a7038742f672 -j DROP
-A DOCKER-ISOLATION-STAGE-2 -o docker0 -j DROP
-A DOCKER-ISOLATION-STAGE-2 -j RETURN
```

**两阶段隔离机制**：

1. **STAGE-1**：判断入接口和出接口是否相同网桥。不同（`-i br-x ! -o br-x`）则跳 STAGE-2。
2. **STAGE-2**：只要出接口是某个网桥，一律 **DROP**。

净效果：**跨网桥的流量全部丢弃**，只有经宿主地址发布（DNAT）的端口才能跨网络访问。

**实测** —— 隔离实际生效：

```bash
# web1 在 alpine-net(172.18.0.0/16)，web3 在默认 bridge(172.17.0.0/16)
$ docker exec web1 ping -c2 -W2 172.17.0.2
--- 172.17.0.2 ping statistics ---
2 packets transmitted, 0 packets received, 100% packet loss
```

注意：**DNS 解析失败**（不同网络不在同一 DNS 域），**即使知道 IP 也 ping 不通**（DROP 规则）。两层防护。

### 网络隔离的白名单通道

跨网络访问的唯一途径是**发布端口**（`-p`）。发布后流量走宿主地址，DNAT 目标变成容器 IP，路径上不再触发网桥间 DROP。

**实测** —— `web1` 发布 8080 后：

```bash
$ docker network inspect alpine-net ...   # web1 IP = 172.18.0.3
$ docker exec web3 curl http://172.18.0.1:8080/   # 通过宿主地址跨网访问
```

---

## 五、嵌入式 DNS 实现

### 核心机制

**文档**：

- 容器**默认继承宿主的 DNS 设置**（`/etc/resolv.conf`）
- 接入**默认 `bridge`** 网络的容器：**获得该文件的一份拷贝**
- 接入**自定义网络**的容器：使用 **Docker 内置 DNS 服务器**
- 内置 DNS 把外部查询**转发给宿主上配置的 DNS 服务器**
- 内置 DNS 地址是 **`127.0.0.11`**
- **没有 IPv6 等价物**；IPv4 地址在 IPv6-only 容器里同样可用
- 应用若需要显式 DNS 地址，用 `127.0.0.11`

**实测** —— 已在上一节确认：用户自定义网络容器 `nameserver 127.0.0.11`，默认 bridge 容器为宿主 DNS。

### 容器内的 /etc/hosts

**实测** —— 容器内 `/etc/hosts` 只包含自身映射，**不含其他容器**：

```
$ docker exec web1 cat /etc/hosts
127.0.0.1	localhost
::1	localhost ip6-localhost ip6-loopback
fe00::0	ip6-localnet
ff00::0	ip6-mcastprefix
ff02::1	ip6-allnodes
ff02::2	ip6-allrouters
172.18.0.3	7c73182c2c6f
```

最后一行是**容器 ID**（也是默认 hostname），不是服务名。

**实测** —— 容器 hostname 默认就是容器 ID：

```
$ docker exec web1 hostname
7c73182c2c6f
```

用 `--hostname` 可覆盖。

> **服务发现只解析自定义容器名**，不解析 Docker 自动生成的 ID 名。要用服务名，必须显式 `--name` 或用 compose。

### DNS 解析的查询顺序

**文档** —— 容器内 resolver 库决定查询多个 DNS 服务器的方式：有的按顺序查，有的并行查并取第一个响应（即使响应是 NXDOMAIN）。

**在自定义网络上**，Docker 内置 DNS **按顺序查询上游服务器**，遇到成功响应或 NXDOMAIN 即停止。

### DNS 相关运行参数

| 参数 | 说明 |
|------|------|
| `--dns` | DNS 服务器 IP，可多次指定。请求从**容器的网络命名空间**发出，所以 `--dns=127.0.0.1` 指的是**容器自己的**回环地址 |
| `--dns-search` | DNS 搜索域，可多次指定 |
| `--dns-opt` | 键值对形式的 DNS 选项，同 `resolv.conf` |
| `--hostname` | 容器自身的主机名，默认是容器 ID |

---

## 六、端口发布实现

### 基础行为

**文档** —— bridge 网络上的容器端口，**默认对宿主和同网络容器可访问**，**对宿主机外部和其他网络不可访问**。用 `-p` / `--publish` 发布后，会在宿主创建防火墙规则把容器端口映射到宿主端口。

| 写法 | 含义 |
|------|------|
| `-p 8080:80` | 宿主 8080 → 容器 TCP 80 |
| `-p 192.168.1.100:8080:80` | 指定宿主 IP |
| `-p 8080:80/udp` | UDP |
| `-p 8080:80/tcp -p 8080:80/udp` | 同端口同时映射 TCP 和 UDP |

### DNAT 规则实测

**实测** —— `docker run -p 8080:80` 之后，nat 表自动生成：

```bash
$ iptables -t nat -S DOCKER
-N DOCKER
-A DOCKER -i docker0 -j RETURN
-A DOCKER -i br-a7038742f672 -j RETURN
-A DOCKER ! -i br-a7038742f672 -p tcp -m tcp --dport 8080 -j DNAT --to-destination 172.18.0.3:80
```

解读：

- 前两条 **RETURN**：流量从网桥进来就直接返回，不做 DNAT（**同网络内部访问不走发布端口**）
- 第三条 **DNAT**：从其他接口进来、目标端口 8080 的 TCP，转发到容器 `172.18.0.3:80`

**实测** —— filter 表配套的放行规则：

```bash
$ iptables -S DOCKER
-N DOCKER
-A DOCKER -d 172.18.0.3/32 ! -i br-a7038742f672 -o br-a7038742f672 -p tcp -m tcp --dport 80 -j ACCEPT
```

放行「目标是该容器 IP、容器端口 80」的包。

### userland proxy

**实测** —— 每个发布端口都会启动一个 `docker-proxy` 进程：

```
$ pgrep -af docker-proxy
337117 docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 8080 -container-ip 172.18.0.3 -container-port 80
337124 docker-proxy -proto tcp -host-ip ::       -host-port 8080 -container-ip 172.18.0.3 -container-port 80
```

IPv4 和 IPv6 各一个。`--userland-proxy=false` 可关闭（关闭后只能靠 iptables DNAT，不支持绑定 `127.0.0.1` 之外的特殊场景）。

### 默认绑定地址

**文档** —— 不指定宿主地址时（`-p 80` / `-p 8080:80`），默认在**所有宿主地址**（IPv4 和 IPv6）上可用。

用 `com.docker.network.bridge.host_binding_ipv4` 改默认值：

- 设为 `::` → 发布端口只在宿主 IPv6 地址可用
- 设为 `0.0.0.0` → 宿主 IPv4 和 IPv6 都可用
- 设为某个具体接口地址 → 只通过该地址访问

**实测** —— 默认 bridge 的选项是 `host_binding_ipv4:0.0.0.0`。

### 安全提示

**文档** —— **发布端口默认是不安全的**：发布后容器不只对宿主可见，而是**对外部世界可见**。

绑定 localhost 限定只有本机可访问：

```bash
docker run -p 127.0.0.1:8080:80 -p '[::1]:8080:80' nginx
```

> **Docker 28.0.0 之前**：同一 L2 网段内的其他主机可以访问发布到 localhost 的端口（moby/moby#45610）。28.0.0 起已修复。

**实测** —— 从宿主直连容器 IP **不通**（因为发布走的是宿主端口，不是容器 IP）：

```bash
$ curl http://172.18.0.3/     # 直连容器 IP
curl: (28) Operation timed out after 5002 milliseconds
```

### EXPOSE 与发布的区别

`EXPOSE` **不发布端口**，只是镜像元数据（构建者与运行者之间的文档约定）。真正发布靠 `-p`（指定）或 `-P`（发布所有 EXPOSE 端口到高位端口）。

---

## 七、iptables 链完整结构

### filter 表的自定义链

**文档** —— Docker 创建以下自定义链：

| 链 | 作用 |
|----|------|
| `DOCKER-USER` | **用户规则的占位符**，在 `DOCKER-FORWARD` 和 `DOCKER` 链之前处理 |
| `DOCKER-FORWARD` | 网络处理的第一阶段，把非 established 连接的包转交其他 Docker 链，并放行已建立连接的包 |
| `DOCKER`、`DOCKER-BRIDGE`、`DOCKER-INTERNAL` | 根据运行中容器的端口转发配置，决定非 established 连接的包是否放行 |
| `DOCKER-CT` | 按 bridge 的连接跟踪规则 |
| `DOCKER-INGRESS` | Swarm 网络相关规则 |

`FORWARD` 链无条件跳转到 `DOCKER-USER`、`DOCKER-FORWARD`、`DOCKER-INGRESS`。

nat 表创建 `DOCKER` 链，实现 masquerading 和端口映射。

**实测** —— 本机（Docker 27.3.1）filter 表实际生成的链：

```bash
$ iptables -S
-P INPUT ACCEPT
-P FORWARD ACCEPT
-P OUTPUT ACCEPT
-N DOCKER
-N DOCKER-ISOLATION-STAGE-1
-N DOCKER-ISOLATION-STAGE-2
-N DOCKER-USER
-A FORWARD -j DOCKER-USER
-A FORWARD -j DOCKER-ISOLATION-STAGE-1
-A FORWARD -o docker0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A FORWARD -o docker0 -j DOCKER
-A FORWARD -i docker0 ! -o docker0 -j ACCEPT
-A FORWARD -i docker0 -o docker0 -j ACCEPT
-A DOCKER-ISOLATION-STAGE-1 -i docker0 ! -o docker0 -j DOCKER-ISOLATION-STAGE-2
-A DOCKER-ISOLATION-STAGE-1 -i br-a7038742f672 ! -o br-a7038742f672 -j DOCKER-ISOLATION-STAGE-2
-A DOCKER-ISOLATION-STAGE-1 -j RETURN
-A DOCKER-ISOLATION-STAGE-2 -o docker0 -j DROP
-A DOCKER-ISOLATION-STAGE-2 -o br-a7038742f672 -j DROP
-A DOCKER-ISOLATION-STAGE-2 -j RETURN
-A DOCKER-USER -j RETURN
```

> **实测与文档的差异**：本机生成的是 `DOCKER-ISOLATION-STAGE-1/2` 两阶段链，而文档描述的是 `DOCKER-FORWARD` / `DOCKER-BRIDGE` / `DOCKER-INTERNAL`。两者是 Docker 不同版本/不同实现路径的差异 —— **以本机 `iptables -S` 的实际输出为准**。

### nat 表实测

```bash
$ iptables -t nat -S
-P PREROUTING ACCEPT
-P INPUT ACCEPT
-P OUTPUT ACCEPT
-P POSTROUTING ACCEPT
-N DOCKER
-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER
-A OUTPUT ! -d 127.0.0.0/8 -m addrtype --dst-type LOCAL -j DOCKER
-A POSTROUTING -s 172.18.0.0/16 ! -o br-a7038742f672 -j MASQUERADE
-A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE
-A DOCKER -i br-a7038742f672 -j RETURN
-A DOCKER -i docker0 -j RETURN
```

- `PREROUTING` / `OUTPUT` 中 `--dst-type LOCAL` 跳 `DOCKER` —— 目的地址是本机的包进 DNAT 链
- `POSTROUTING` 中每个网桥一条 **MASQUERADE** —— 容器出网的源地址伪装成宿主地址
- `! -o <网桥>` —— 从该网桥出来的包**不**伪装（网内通信保持原地址）

**实测** —— MASQUERADE 计数器（说明确有流量走过）：

```bash
$ iptables -t nat -L POSTROUTING -n -v
    4   200 MASQUERADE  all  --  *      !docker0  172.17.0.0/16  0.0.0.0/0
    0     0 MASQUERADE  all  --  *      !br-a7038742f672  172.18.0.0/16  0.0.0.0/0
    0     0 MASQUERADE  tcp  --  *      *       172.18.0.3  172.18.0.3  tcp dpt:80
```

第三条是容器访问自身发布端口时产生的（源和目的都是容器 IP）。

### IP 转发

**文档** —— Docker 要求宿主开启 IP 转发。启动时若未开启，Docker 会设置：

```
net.ipv4.ip_forward
net.ipv6.conf.all.forwarding
```

**开启后 Docker 会把 filter 表 `FORWARD` 链的默认策略设为 `DROP`**。

> 这会让宿主**不能当路由器用**。这是推荐设置，除非确实需要路由功能。
>
> 不想让 Docker 改策略：`daemon.json` 加 `"ip-forward-no-drop": true`，或 `dockerd --ip-forward-no-drop`。
>
> **用实验性 nftables 后端时，Docker 自己不开 IP 转发，也不创建默认 drop 策略。**

**实测** —— 本机 FORWARD 链策略为 `ACCEPT`（宿主已有自己的防火墙规则 `LIBVIRT_*`，且 Docker 检测到 IP 转发已开启）。

### 在 Docker 规则之前插入自己的策略

**文档** —— 被 Docker 自定义链接受或拒绝的包，**不会再看到追加到 `FORWARD` 链末尾的用户规则**。要过滤这些包，必须用 `DOCKER-USER` 链。

`FORWARD` 链追加的规则会在 Docker 规则**之后**处理。

### 匹配原始 IP 和端口

**文档** —— 包到达 `DOCKER-USER` 链时**已经过 DNAT**，所以 iptables 匹配到的只能是**容器内部 IP 和端口**。

要匹配网络请求的**原始** IP 和端口，必须用 `conntrack` 扩展：

```bash
iptables -I DOCKER-USER -p tcp -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdst 198.51.100.2 --ctorigdstport 80 -j ACCEPT
```

> **IMPORTANT**：使用 `conntrack` 扩展可能导致性能下降。

### 限制外部来源

**文档** —— 默认所有外部源 IP 都能连接已发布端口。要限制，在 `DOCKER-USER` 链**顶部**插入取反规则：

```bash
# 只允许 192.0.2.2
iptables -I DOCKER-USER -i ext_if ! -s 192.0.2.2 -j DROP

# 只允许 192.0.2.0/24 网段
iptables -I DOCKER-USER -i ext_if ! -s 192.0.2.0/24 -j DROP

# 只允许 192.0.2.1-192.0.2.3
iptables -I DOCKER-USER -m iprange -i ext_if ! --src-range 192.0.2.1-192.0.2.3 -j DROP
```

放行已建立连接的包（要放在 DROP 规则**之前**）：

```bash
iptables -I DOCKER-USER -m state --state RELATED,ESTABLISHED -j ACCEPT
```

允许宿主接口之间转发：

```bash
iptables -I DOCKER-USER -i src_if -o dst_if -j ACCEPT
```

### 直接路由被 raw 表拦截

**文档** —— 默认情况下远程主机**只能**通过发布到宿主地址的端口访问容器。直接发包到容器 IP（「直接路由」）**不被允许**：

> These packets are dropped by a rule in the `raw` table's `PREROUTING` chain, which is processed before the `filter` table. So, they never reach the `DOCKER-USER` chain, and a rule in `DOCKER-USER` cannot allow them.

**实测** —— 本机 raw 表：

```bash
$ iptables -t raw -S
-P PREROUTING ACCEPT
-P OUTPUT ACCEPT
```

**本机未生成该 raw 规则**，但直连容器 IP 依然超时 —— 说明**实际拦截点是 filter 表的网桥间 DROP 规则**（`DOCKER-ISOLATION-STAGE-2`）。文档描述的 raw 表规则是另一条路径。

### 允许直接路由

**文档** —— 两种方式：

- 网络选项 `com.docker.network.bridge.trusted_host_interfaces` —— 允许直接路由访问容器的**已发布**端口（未发布端口仍受保护）
- daemon 选项 `allow-direct-routing` —— 允许直接路由访问**所有**容器端口

---

## 八、网关模式

**文档** —— bridge 驱动有两个网关模式选项：

```
com.docker.network.bridge.gateway_mode_ipv4
com.docker.network.bridge.gateway_mode_ipv6
```

四种取值：

| 模式 | 行为 |
|------|------|
| `nat`（默认） | 为每个发布的容器端口设置 NAT 和 masquerading 规则。离开宿主的数据包使用宿主地址 |
| `nat-unprotected` | 与 `nat` 类似，但**未发布的容器端口也可通过直接路由访问**，不设端口过滤规则。为兼容 legacy 默认行为而提供 |
| `routed` | **不设 NAT 和 masquerading**，但仍设防火墙规则使只有已发布端口可访问。容器出站包使用**容器自己的地址**，不是宿主地址 |
| `isolated` | 完全隔离，不允许外部通信 |

### routed 模式的访问条件

**文档** —— `routed` 模式下访问已发布端口，远程主机必须有一条**经宿主外部地址到容器网络的路由**（直接路由）：

- 本地 L2 网络的主机无需额外配置即可直接路由
- 本地网络之外的主机需要网络路由器配合

`nat` 模式下，把端口发布到回环地址意味着远程主机无法访问。

`nat` 模式下若端口发布到**特定**宿主地址，且宿主开启了 IP 转发，则其他宿主接口上的主机也能通过直接路由访问该地址 —— 例如宿主有两张网卡 `192.168.100.10/24` 和 `10.0.0.10/24`，端口发布到 `192.168.100.10` 后，`10.0.0.0/24` 网段的主机可经 `10.0.0.10` 路由到 `192.168.100.10` 访问。

### routed 模式下的 -p 限制

**文档** —— `routed` 模式下，`-p` / `--publish` 里的**宿主端口号不起作用**，宿主地址只用于决定映射应用于 IPv4 还是 IPv6。只对 `routed` 生效的映射应只用 `0.0.0.0` 或 `::`，**不应指定宿主端口**。指定了具体地址或端口不会有效果，并产生警告。

### 网关模式对跨网络通信的影响

**文档**：

- `nat` 和 `nat-unprotected` 模式下，其他 bridge 网络的容器**只能**通过端口发布到的宿主地址访问。不允许直接路由
- `routed` 模式下，其他网络的容器可以用**直接路由**访问端口，不必绕经宿主地址

---

## 九、其他驱动实现

### host 驱动

**文档** —— 容器与宿主**共享网络命名空间**，不分配独立 IP。

> **NOTE**：因为没有独立 IP，**端口映射不生效**，`-p`、`--publish`、`-P`、`--publish-all` 全部被忽略并产生警告：
> ```
> WARNING: Published ports are discarded when using host network mode
> ```

**优势** —— 不需要 NAT，每个端口不创建 userland-proxy，性能更好，适合需要处理大量端口的场景。

**限制**：

- 容器内进程**无法绑定宿主的 IP 地址**（容器不能直接访问宿主接口）
- 不支持 Windows 容器
- Docker Desktop 需 4.34+ 并在 Settings → Resources → Network 勾选「Enable host networking」，且仅工作于 L4
- 与 Enhanced Container Isolation 冲突

**平台支持**：Linux 上的 Docker Engine；Docker Desktop 4.34+（需手动开启）。

### none 驱动

**文档** —— 完全隔离网络栈，容器内**只有回环设备**：

```bash
$ docker run --rm --network none alpine:latest ip addr show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 ...
    inet 127.0.0.1/8 scope host lo
```

**没有配置 IPv6 回环地址**。`none` 不适用于 Swarm 服务。

### macvlan 驱动

**文档** —— 给容器分配 MAC 地址，让它看起来像直连物理网络的物理设备。适合必须直连物理网络的传统应用，或监控网络流量的应用。

**平台与要求**：

- **仅 Linux 宿主**，不支持 Docker Desktop（Mac/Windows）和 Windows 版 Docker Engine
- 多数云厂商**屏蔽 macvlan**
- 需要 Linux 内核 ≥ 3.9（推荐 4.0+）
- **不支持 rootless 模式**

**注意事项**：

- 可能因 **IP 地址耗尽**或 **"VLAN spread"**（网络中唯一 MAC 数量过多）意外劣化网络
- 网络设备需支持**混杂模式（promiscuous mode）** —— 一个物理接口承载多个 MAC
- **macvlan 容器无法与宿主直接通信** —— 这是 Linux 内核的限制。需要通信就把容器同时接入 bridge 网络，或在宿主上创建同父接口的 macvlan 接口并分配同网段 IP

**选项**：

| 选项 | 默认 | 说明 |
|------|------|------|
| `macvlan_mode` | `bridge` | `bridge` / `vepa` / `passthru` / `private` |
| `parent` | | 父接口 |

### ipvlan 驱动

**文档** —— 与 macvlan 类似，让用户完全控制 IPv4 和 IPv6 寻址，但**不分配独立 MAC 地址**。当网络接口或端口的 MAC 地址数量受限时用 ipvlan。

底层是 VLAN 驱动，在 L2 VLAN 标记和 L3 路由上给运维完全控制。

### overlay 驱动

**文档** —— 连接多个 Docker daemon，让 Swarm 服务和容器跨节点通信，无需 OS 层路由。用于跨主机容器通信。

### 驱动选择与防火墙

**文档** —— **Docker 只为 bridge 网络创建防火墙规则**。`ipvlan`、`macvlan`、`host` 网络**不创建任何规则**。

---

## 十、防火墙交互与 ufw/firewalld

### 防火墙后端

**文档** —— 默认用 iptables，也支持 nftables。Docker Engine 的 `firewall-backend` 选项可选择。对 bridge 网络，两者功能相同。

nftables 模式下会为每个 bridge 网络在基础链上追加链。moby 项目有内部文档描述其 nftables 与网络/容器配置的依赖关系。

用户自定义 nftables 表示例：

```
table ip my-table {
	chain my-filter-forward {
		type filter hook forward priority filter; policy accept;
		iifname "ext_if" oifname "br-*" ip saddr != 192.0.2.0/24 counter drop
	}
}
```

### 禁止 Docker 操作防火墙

**文档** —— `daemon.json` 中把 `iptables` 或 `ip6tables` 设为 `false` 可阻止 Docker 创建大部分规则。**但这对大多数用户不适用，很可能破坏容器网络**：

- 禁用防火墙且无替代规则时，bridge 网络的容器**无法通过 masquerading 访问外网**
- 但它们的**所有端口**都对本地网络的主机开放

> 完全阻止 Docker 创建防火墙规则**不可能**，事后补规则极其复杂，不在本文范围。

### firewalld 集成

**文档** —— 当 `iptables`/`ip6tables` 为 `true` 且系统启用了 firewalld 时，Docker 会额外创建一个名为 `docker` 的 firewalld zone，target 为 `ACCEPT`。所有 Docker 创建的 bridge 接口（如 `docker0`）都会加入该 zone。

同时创建名为 `docker-forwarding` 的转发策略，允许从 `ANY` zone 到 `docker` zone 的转发。

### ufw 不兼容

**文档** —— ufw 是 Ubuntu 自带的防火墙前端，**与 Docker 不兼容**：

> When you publish a container's ports using Docker, traffic to and from that container gets diverted before it goes through the ufw firewall settings. Docker routes container traffic in the `nat` table, which means that packets are diverted before it reaches the `INPUT` and `OUTPUT` chains that ufw uses. Packets are routed before the firewall rules can be applied, effectively ignoring your firewall configuration.

**结论**：发布端口后，ufw 的规则对容器流量**无效**。要限制访问，必须用 `DOCKER-USER` 链（见前文）。

---

## 十一、调试方法

### 观察网络拓扑

```bash
# 列出网络
docker network ls

# 看网桥
ip -d addr show docker0
ip -o addr show | grep -E "br-|docker0"

# 看 veth 及其挂载的网桥
ip -o link show | grep veth

# 看 netns
ls -la /var/run/docker/netns/
```

### 观察 iptables 规则

```bash
# filter 表
iptables -S

# nat 表
iptables -t nat -S

# 带计数器看实际流量
iptables -t nat -L POSTROUTING -n -v
iptables -t nat -L DOCKER -n -v

# raw 表
iptables -t raw -S
```

### 观察容器内视角

```bash
docker exec <容器> ip addr show
docker exec <容器> ip route
docker exec <容器> cat /etc/resolv.conf
docker exec <容器> cat /etc/hosts
docker exec <容器> hostname
```

### 观察 DNS 行为

```bash
# 容器能否解析服务名
docker exec <容器> getent hosts <服务名>

# 默认 bridge 上应该失败
docker exec <容器> ping -c2 <服务名>
```

### 观察端口发布

```bash
docker port <容器>
docker inspect <容器> --format '{{json .NetworkSettings.Ports}}'

# userland proxy 进程
pgrep -af docker-proxy

# 跨网络测试
docker exec <容器A> curl http://<宿主IP>:<发布端口>/
```

### 网络选项清单

```bash
docker network inspect <网络> --format '{{json .Options}}'
```

---

## 十二、排错

### 容器间不通

按顺序排查：

1. **DNS 层**：能否解析名字？默认 bridge 上**不能**解析 —— 必须用用户自定义网络
2. **网络层**：两个容器在同一网络吗？

   ```bash
   docker network inspect <网络> --format '{{range .Containers}}{{.Name}} {{end}}'
   ```

3. **隔离规则**：跨网桥流量被 `DOCKER-ISOLATION-STAGE-2` DROP —— 必须通过发布的端口访问
4. **端口用错**：容器间互访用**容器端口**（`db:5432`），不是宿主映射端口
5. **混用 host 模式**：`network_mode: host` 下 `ports` 无效

### 端口发布不生效

```bash
docker port <容器>                          # 映射是否存在
docker inspect <容器> --format '{{json .NetworkSettings.Ports}}'
iptables -t nat -S DOCKER                   # DNAT 规则是否存在
ss -lntp | grep <端口>                      # 宿主是否在监听
```

宿主端口被其他进程占用 → 发布失败。

### 绑定地址不对

```bash
ss -lntp | grep 8080
```

看到 `0.0.0.0:8080` 说明对所有接口开放。只想要本地就写 `-p 127.0.0.1:8080:80`。

### ufw 规则不生效

见 [ufw 不兼容](#ufw-不兼容)。改用 `DOCKER-USER` 链。

### 大量容器网络不稳定

**文档** —— 单网络 ≥1000 容器时因内核限制会不稳定（moby/moby#44973）。拆分网络或扩容节点。

### MASQUERADE 计数器为 0 但容器没外网

```bash
cat /proc/sys/net/ipv4/ip_forward      # 应为 1
iptables -t nat -L POSTROUTING -n -v    # 看是否有流量计数
```

`ip_forward` 为 0 且 Docker 未开启转发 → 出网不通。检查宿主防火墙策略。

### 排查思路：分层定位

| 层 | 手段 | 关注点 |
|----|------|--------|
| DNS | `getent hosts` | 名字能否解析 |
| 网络可达 | `ping`（ICMP 可能被额外封禁） | 用 TCP 探测更可靠 |
| 端口 | `curl` / `nc` | 具体服务端口 |
| 规则 | `iptables -S` | DROP / RETURN 规则 |
| 转发 | `cat /proc/sys/net/ipv4/ip_forward` | 是否开启 |
| 命名空间 | `ip netns` / `/var/run/docker/netns` | netns 是否存在 |

---

## 十三、速查表

| 目的 | 命令 / 配置 |
|------|------------|
| 列网络 | `docker network ls` |
| 查网络选项 | `docker network inspect <网络> --format '{{json .Options}}'` |
| 建 bridge 网络 | `docker network create --driver bridge mynet` |
| 指定子网 | `docker network create --subnet 172.30.0.0/16 mynet` |
| 内网（禁外网） | `docker network create --internal mynet` |
| IPv6 网络 | `docker network create --ipv6 --subnet 2001:db8::/64 mynet` |
| IPv6-only | `docker network create --ipv6 --ipv4=false v6net` |
| 运行时接入网络 | `docker network connect mynet <容器>` |
| 网络别名 | `docker network connect --alias db mynet <容器>` |
| 断开网络 | `docker network disconnect mynet <容器>` |
| host 网络 | `docker run --network host ...` |
| 完全隔离网络 | `docker run --network none ...` |
| macvlan 网络 | `docker network create -d macvlan -o parent=eth0 macnet` |
| 看网桥 | `ip -d addr show docker0` |
| 看 veth | `ip -o link show \| grep veth` |
| 看 nat 规则 | `iptables -t nat -S` |
| 看 filter 规则 | `iptables -S` |
| 看规则计数 | `iptables -t nat -L POSTROUTING -n -v` |
| userland proxy | `pgrep -af docker-proxy` |
| 容器网络命名空间 | `ls /var/run/docker/netns/` |
| 容器内接口 | `docker exec <容器> ip addr show eth0` |
| 容器内路由 | `docker exec <容器> ip route` |
| 容器 DNS 配置 | `docker exec <容器> cat /etc/resolv.conf` |
| 容器 hosts 文件 | `docker exec <容器> cat /etc/hosts` |
| 测试名字解析 | `docker exec <容器> getent hosts <服务名>` |
| 限制外部来源 | `iptables -I DOCKER-USER -i ext_if ! -s 192.0.2.0/24 -j DROP` |
| 放行已建立连接 | `iptables -I DOCKER-USER -m state --state RELATED,ESTABLISHED -j ACCEPT` |
| 匹配原始目的地址 | `iptables -I DOCKER-USER -m conntrack --ctorigdst 198.51.100.2 -j ACCEPT` |
| 配置默认地址池 | daemon.json 的 `default-address-pools` |
| 配置默认 bridge | daemon.json 的 `bip` / `fixed-cidr` / `mtu` / `default-gateway` |
| 禁止改 FORWARD 策略 | daemon.json 的 `"ip-forward-no-drop": true` |

---

## 相关

- [[Docker 存储与网络]] — 存储卷与网络驱动概览
- [[Docker 常用命令]] — Docker 基础命令
- [[docker-compose 使用说明]] — Compose 专题
- [[Dockerfile 编写指南]] — Dockerfile 指令与最佳实践
- 官方文档：https://docs.docker.com/engine/network/
