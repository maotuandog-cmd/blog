
针对你的需求——5–100 个轻量级 Linux 环境，通过浏览器统一管理——我建议优先考虑两套方案：

- 方案 A：Incus + Web 管理界面：适合希望继续使用 Ubuntu 服务器、以 API 自动化创建和销毁大量 Linux 系统容器的场景。
    
- 方案 B：Proxmox VE + LXC：适合更看重开箱即用的网页管理、模板、快照、权限和备份的场景。
    

如果你已有 Ubuntu 26.04 服务器，不想重装宿主机，优先评估 Incus；如果你有专用物理服务器，可以接受安装专门的虚拟化平台，优先评估 Proxmox VE。

这里的“轻量级 Linux 环境”按每个实例需要独立文件系统、用户、软件包、SSH 服务来理解，而不是只运行一个应用的 Docker 容器。Incus 和 Proxmox LXC 都适合这种系统容器场景；二者都共享宿主机内核，因此不能把它们当成拥有独立内核的完整虚拟机。

Introduction+2

## 一、推荐架构

浏览器管理端

管理员登录、实例列表、创建、启停、控制台

Web 管理/API 层

Incus REST API 或 Proxmox Web UI / API

Linux 容器池

Ubuntu / Debian / Alpine

镜像与存储

基础镜像、快照、备份

Linux 宿主机

CPU、内存、SSD、桥接网络、防火墙、资源配额

管理层负责实例生命周期，容器层负责运行独立的 Linux 用户空间，存储层负责镜像与持久化数据。这样可以先在一台服务器上运行 5–100 个实例，后续再根据负载扩容。

## 二、两套方案怎么选

|对比项|Incus|Proxmox VE + LXC|
|---|---|---|
|运行完整 Linux 用户空间|支持|支持|
|浏览器管理|需第三方 Web UI 或自建前端|原生 Web UI|
|REST API|原生支持|原生支持|
|快照、镜像、资源限制|支持|支持|
|集群扩展|支持|支持|
|适合现有 Ubuntu 主机|更合适|通常建议专用主机安装|
|上手难度|中等|较低|

Proxmox 官方集成了 LXC 和 Web 管理界面；Incus 则提供统一的 REST API、系统容器、镜像、资源限制与集群能力。

Open-Source Server Virtualization Platform+1

## 三、硬件配置建议

以下是初期规划值，假设容器以 SSH、脚本执行、轻量级开发工具为主，不运行大型数据库或高负载服务。

|规模|CPU|内存|SSD|
|---|---|---|---|
|5–20 个|4–8 核|16 GB|200 GB|
|20–50 个|8–16 核|32 GB|500 GB|
|50–100 个|16–32 核|64 GB|1 TB|

实际容量取决于每个实例的常驻内存、磁盘占用和并发负载。轻量容器通常不需要为每个实例预留一整套完整操作系统的内存。

## 四、部署方案 A：在 Ubuntu 上安装 Incus

适合保留现有 Ubuntu 主机，并希望通过 API 管理实例的情况。

### 第 1 步：安装并初始化

先确认发行版和软件包可用性：

```
cat /etc/os-release
sudo apt update
apt-cache policy incus
```

如果系统软件源提供 Incus，可尝试：

```
sudo apt install incus
sudo incus admin init
```

初始化时需要设置存储池和容器网络。生产环境建议使用非特权容器，并为不同类型的实例设置资源限制。

如果 Ubuntu 26.04 的默认软件源没有合适的 Incus 包版本，应按照 [Incus 官方安装文档](https://linuxcontainers.org/incus/docs/main/installing/?utm_source=chatgpt.com) 选择适合该发行版的安装方式，不要直接混用其他 Ubuntu 版本的软件包。

### 第 2 步：创建第一个 Linux 容器

例如创建一个 Ubuntu 24.04 容器：

```
incus launch images:ubuntu/24.04 test01
```

查看实例：

```
incus list
```

进入容器：

```
incus exec test01 -- bash
```

配置 CPU、内存和磁盘限制示例：

```
incus config set test01 limits.cpu 2
incus config set test01 limits.memory 1GiB
```

上述资源只是示例，需要根据实例负载调整。Incus 的镜像、配置模板、存储和网络管理方式可以参考[官方文档](https://linuxcontainers.org/incus/docs/main/?utm_source=chatgpt.com)。

Introduction+1

### 第 3 步：提供浏览器管理

这里有一个重要区别：Incus 核心项目提供 API 和命令行，但不能直接假设安装 Incus 就会得到完整的官方 Web 管理面板。

你可以选择：

- 使用经过评估的第三方 Web 管理界面；
    
- 自建管理前端，通过 Incus REST API 创建、启动、停止、删除容器；
    
- 如果不想维护 Web 前端，改用方案 B。
    

API 不要直接暴露到公网。建议通过 HTTPS 反向代理、身份认证、访问白名单或 VPN 限制访问，并为管理操作配置权限。

## 五、部署方案 B：Proxmox VE + LXC

如果你的首要要求是“打开浏览器就能管理所有容器”，我更推荐这套方案。

1. 在专用物理服务器上安装 Proxmox VE。注意，安装器可能会格式化目标磁盘，不要直接对存有重要数据的 Ubuntu 主机执行重装。
    
2. 通过浏览器访问 `https://服务器IP:8006`，完成管理员登录和初始化。
    
3. 在存储中下载 Ubuntu、Debian 或 Alpine 的 LXC 模板。
    
4. 创建容器模板，统一设置 CPU、内存、磁盘、网络和 SSH 配置。
    
5. 通过 Web UI 克隆模板批量创建实例，并配置备份、快照、权限与防火墙。
    

官方资料：

- [Proxmox VE 产品与功能](https://www.proxmox.com/en/products/proxmox-virtual-environment/overview?utm_source=chatgpt.com)
    
- [Proxmox VE 管理指南](https://pve.proxmox.com/pve-docs/?utm_source=chatgpt.com)
    

Proxmox 将容器与虚拟机整合在一个管理界面中，也提供集群和备份等功能。

Open-Source Server Virtualization Platform+1

## 六、我的最终建议

- 必须保留现有 Ubuntu 26.04： 先部署 Incus，确认安装包兼容性，再选第三方 Web UI 或开发管理前端。
    
- 专用服务器，最重视网页管理： 直接使用 Proxmox VE + LXC。
    
- 容器要运行不可信用户的代码： 不要只依赖普通 LXC 隔离，应考虑 KVM 虚拟机或 Kata 等更强隔离方案。
    

还有一个会直接影响架构的关键问题：

这 5–100 个 Linux 环境，是否需要每个环境拥有独立的公网 IP？

补充部署需求

选择后我可以给出更具体的网络拓扑、安装命令和批量创建脚本。

1. 每个实例的 IP 需求

内网 IP 即可，统一通过宿主机访问外网

每个实例都需要独立公网 IP

每个实例需要独立的局域网 IP

2. 服务器部署方式

在现有 Ubuntu 26.04 上安装，不重装系统

可以使用专用物理服务器，允许安装 Proxmox

3. 如何进入每个环境

SSH / Web 终端

每个实例都需要独立图形桌面

主要由 API 自动创建、执行任务和销毁

生成详细部署方案
## 七、Web 终端的实现建议

如果希望在浏览器中直接进入每个容器的 Shell，我建议把它作为独立管理入口，而不是直接把容器的 SSH 端口全部暴露出去。

可选的组件组合：

- 实例管理： Incus API。
    
- Web 终端： 自建 Web 应用，后端通过受控的 SSH 或 Incus exec 访问实例。
    
- 用户认证： OIDC/SSO 或本地账号，配合角色权限。
    
- 入口代理： Nginx 或 Caddy，提供 HTTPS。
    
- 审计： 记录用户、实例、会话起止时间；如有合规需求，再配置终端录屏或命令审计。
    

这里有一个安全取舍：通过 `incus exec` 进入容器通常需要较高的宿主机管理权限；通过 SSH 可以把权限控制在指定容器用户上，但需要管理密钥、SSH 服务和账号生命周期。不要让浏览器直接调用宿主机上的任意 Shell 命令，也不要把 Incus 管理 API 暴露到公网。

## 八、安装和初始化：可直接执行的步骤

### 1. 先检查宿主机

在 Ubuntu 26.04 上执行：

```
cat /etc/os-release
uname -r
ip -br addr
ip route
df -h /
free -h
```

重点确认：

- 宿主机默认网卡和网关正常；
    
- 现有 SSH 远程管理正常；
    
- 磁盘有足够空间；
    
- 没有已在使用、会与容器网段冲突的网段。
    

以下示例使用 `10.203.0.0/24` 作为容器私有网段，容器网关为 `10.203.0.1`。请先确认它与你现有 LAN、VPN、Docker 网络均不冲突。

### 2. 安装 Incus

Ubuntu 26.04 的官方软件包仓库提供 Incus 6.0 LTS 系列的软件包。先检查本机实际候选版本，再安装。

Package Search Results -- incus+1

```
sudo apt update
apt-cache policy incus
sudo apt install -y incus
```

确认服务和版本：

```
incus version
systemctl status incus --no-pager
```

如果安装后没有正常启动，先查看日志，不要继续批量创建容器：

```
sudo journalctl -u incus -n 100 --no-pager
```

### 3. 初始化存储和网络

先备份当前配置（如果这是已有 Incus 环境，不要直接重新初始化）：

```
sudo incus admin init
```

交互式初始化时，建议：

- 创建独立存储池；
    
- 创建受 Incus 管理的 bridge 网络；
    
- 启用 IPv4 DHCP 和 NAT 出网；
    
- 不启用不需要的远程 API 监听；
    
- 单机阶段不配置集群。
    

Incus 官方建议单机环境优先使用受管理的 bridge 网络。它可以为容器提供内部通信、DHCP、DNS 和外部连接。

Incus documentation+1

初始化后检查：

```
incus storage list
incus network list
incus network show incusbr0
incus profile show default
```

如果你初始化时已经创建了 `incusbr0`，不要重复创建同名网络。

### 4. 固定容器私有网段

如果默认网络不符合规划，并且确认没有实例依赖它，可以在初始化后设置：

```
incus network set incusbr0 ipv4.address 10.203.0.1/24
incus network set incusbr0 ipv4.nat true
incus network set incusbr0 ipv4.dhcp true
```

先检查 DHCP 范围：

```
incus network show incusbr0
```

如果当前版本需要单独设置 DHCP 范围，或网络已经存在相应配置，请根据输出调整，避免把 DHCP 地址池与静态地址分配重叠。

预期网络结构：

|组件|示例地址|
|---|---|
|Incus bridge|`10.203.0.1/24`|
|容器 01|`10.203.0.x`|
|容器 02|`10.203.0.x`|
|容器 100|`10.203.0.x`|
|容器默认网关|`10.203.0.1`|
|外网出口|Ubuntu 宿主机|

容器通过宿主机 NAT 访问互联网，默认不需要给每个容器分配公网 IP，也不需要在物理路由器上给每个容器添加独立路由。

## 九、创建模板并批量部署 5–100 个容器

先创建一个基础 Ubuntu 容器，用来验证网络、SSH 和资源限制。

### 1. 创建测试容器

```
incus launch images:ubuntu/24.04 c01 \
  --config limits.cpu=1 \
  --config limits.memory=512MiB \
  --config limits.processes=512 \
  --device root,size=8GiB
```

验证运行状态和 IP：

```
incus list
incus info c01
incus exec c01 -- bash
```

如果镜像服务器不可用，先检查 DNS、出网和镜像服务状态。Ubuntu 24.04 在这里作为容器内的基础系统示例，并不要求宿主机也运行 24.04。

### 2. 创建通用配置 Profile

建议先给大多数容器使用统一的 CPU、内存、磁盘配置，再为特殊实例单独覆盖。

例如：

```
incus profile create linux-small
incus profile set linux-small limits.cpu 1
incus profile set linux-small limits.memory 512MiB
incus profile set linux-small limits.processes 512
incus profile device add linux-small root disk \
  path=/ pool=default size=8GiB
```

注意：上面的 `pool=default` 假设初始化时创建的存储池名为 `default`。如果实际名称不同，使用：

```
incus storage list
```

查询后替换。

使用 Profile 创建容器：

```
incus launch images:ubuntu/24.04 c02 \
  --profile default \
  --profile linux-small
```

每个容器 512 MiB 只是轻量任务的起始参考值。实际需要按应用内存、进程数和并发量调整；不要仅根据实例数量估算容量。

### 3. 批量创建容器

下面的脚本会创建 `c01` 到 `c20`。先用 20 个实例验证资源与网络，再增加到 50 或 100 个。

```
#!/usr/bin/env bash
set -euo pipefail

COUNT="${1:-20}"
PROFILE="linux-small"
IMAGE="images:ubuntu/24.04"

for i in $(seq -w 1 "$COUNT"); do
    NAME="c${i}"

    if incus info "$NAME" >/dev/null 2>&1; then
        echo "跳过已存在的容器：$NAME"
        continue
    fi

    echo "创建 $NAME ..."
    incus launch "$IMAGE" "$NAME" \
        --profile default \
        --profile "$PROFILE"
done

incus list
```

保存为 `create-containers.sh` 后运行：

```
chmod +x create-containers.sh
./create-containers.sh 20
```

扩容时运行：

```
./create-containers.sh 50
# 或
./create-containers.sh 100
```

这里的脚本只负责创建容器，不负责创建 SSH 用户、注入密钥或安装 Web 终端。建议把这些步骤做成统一初始化流程，而不是每次人工登录配置。

## 十、配置 SSH 和浏览器终端

建议将两种访问方式分开处理：

1. 管理员通过 SSH 登录宿主机，再用 Incus 管理容器。
    
2. 用户通过 Web 门户选择容器，打开授权的终端会话。
    

### 1. 先验证容器 Shell

```
incus exec c01 -- bash
```

这不依赖容器内的 SSH 服务，适合管理员排障。不要为了让管理员进入容器，就把宿主机的 Docker/Incus 管理权限授予普通用户。

### 2. 如果需要每个容器都支持 SSH

先安装 SSH 服务：

```
incus exec c01 -- bash -lc \
  'apt-get update && apt-get install -y openssh-server'
```

然后在容器内创建普通用户并配置公钥登录。建议用自动化脚本或 cloud-init 把同一流程应用到所有容器。

不建议将 100 个容器的 SSH 端口直接映射到公网。 可以让管理员通过内部网络或跳板机访问，Web 门户则由后端按授权建立会话。

### 3. Web 管理界面

Incus 提供 `incus webui` 命令，并支持通过 HTTPS API 管理远程实例。官方文档说明，Incus 默认只通过本机 Unix Socket 提供管理访问；远程访问需要显式配置 HTTPS 监听和客户端认证。

Incus documentation+1

建议采用下面的管理路径：

浏览器

HTTPS 登录、容器列表、终端入口

Web 门户 / 反向代理

身份认证、授权检查、审计日志

Incus 管理 API

创建、停止、删除容器和执行受控命令

对于浏览器终端，初期可以先使用 Incus 自带的管理能力验证交互体验；如果需要多用户、独立会话、权限隔离和会话审计，再开发 Web 门户或接入专门的 Web SSH 终端服务。

安全底线： 不要将 `core.https_address=:8443` 直接配置成对所有网卡开放并暴露公网。优先只绑定管理网 IP，或者通过 SSH 隧道访问；使用客户端证书进行认证，并限制防火墙来源地址。Incus 的本机管理 Socket 权限非常高，只有可信的管理员才能访问。

Incus documentation+1

## 十一、网络和安全检查清单

部署完成后，至少验证以下项目：

- 容器获得 `10.203.0.0/24` 网段内的地址。
    
- 容器可以解析域名并访问外网。
    
- 容器之间的通信符合预期。
    
- 外部机器不能直接连接容器的 SSH 端口。
    
- 管理 API 只允许可信管理端访问。
    
- 容器使用非特权模式，避免不必要的宿主机目录挂载。
    
- 为容器配置 CPU、内存、磁盘和进程数限制。
    
- 对容器模板、关键数据和宿主机配置定期备份。
    
- 监控宿主机内存、磁盘空间、负载和网络连接数。
    

验证出网：

```
incus exec c01 -- bash -lc \
  'ip addr; ip route; getent hosts ubuntu.com'
```

验证 DNS 和 HTTPS：

```
incus exec c01 -- bash -lc \
  'apt-get update'
```

查看实例资源与状态：

```
incus list
incus info c01
incus storage list
incus network list
```

如果出网失败，优先检查 `incusbr0` 的 NAT、宿主机路由、防火墙及 DNS；不要在问题没有定位之前，随意关闭宿主机防火墙或清空 nftables 规则。

## 十二、生产环境的落地顺序

1. 阶段一：单容器验证。 安装 Incus，配置存储和 bridge，启动一个容器，验证 DHCP、DNS、NAT。
    
2. 阶段二：模板化。 创建统一 Profile，确定 CPU、内存、磁盘和初始化方式。
    
3. 阶段三：小规模压测。 创建 20 个容器，观察内存峰值、磁盘使用和并发执行任务时的延迟。
    
4. 阶段四：管理入口。 配置 HTTPS、身份认证、权限和浏览器终端，先限制在可信管理网络内。
    
5. 阶段五：逐步扩容。 依次测试 50、100 个实例，配置备份、监控和容量告警。
    

官方参考资料：

- [Incus 安装文档](https://linuxcontainers.org/incus/docs/main/installing/?utm_source=chatgpt.com)
    
- [Incus 首次使用教程](https://linuxcontainers.org/incus/docs/main/tutorial/first_steps/?utm_source=chatgpt.com)
    
- [Incus 网络配置](https://linuxcontainers.org/incus/docs/main/explanation/networks/?utm_source=chatgpt.com)
    
- [Incus 远程访问与认证](https://linuxcontainers.org/incus/docs/main/howto/server_expose/?utm_source=chatgpt.com)
    

最终推荐： 保留 Ubuntu 26.04，以 Incus 作为容器管理层，使用内部 bridge + NAT 统一出网，使用 Profile 和批量脚本管理实例，再单独搭建受控的浏览器终端入口。先完成 20 个实例的验证，再扩展到 100 个，比一开始引入复杂集群或 OVN 更容易排错和维护。