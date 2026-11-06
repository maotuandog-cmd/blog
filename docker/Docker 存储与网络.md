# Docker 存储与网络

> 存储与网络语义对照 Docker 官方文档 `manuals/engine/storage/*` 与 `manuals/engine/network/*` 整理。
> 命令行参数对照 Docker CLI 27.3.1 实测校验。

---

## 目录

1. [存储三种方式](#一存储三种方式)
2. [数据卷 Volume](#二数据卷-volume)
3. [绑定挂载 Bind Mount](#三绑定挂载-bind-mount)
4. [tmpfs 内存挂载](#四tmpfs-内存挂载)
5. [存储驱动与镜像层](#五存储驱动与镜像层)
6. [网络驱动](#六网络驱动)
7. [用户自定义网络](#七用户自定义网络)
8. [端口发布](#八端口发布)
9. [资源限制](#九资源限制)
10. [选型决策表](#十选型决策表)
11. [排错](#十一排错)
12. [速查表](#十二速查表)

---

## 一、存储三种方式

| 方式 | 管理方 | 适合 |
|------|--------|------|
| **Volume（数据卷）** | Docker 完全管理 | 数据库数据、需持久化、需多容器共享 |
| **Bind Mount（绑定挂载）** | 宿主目录 | 需要宿主直接访问文件、源码挂载开发 |
| **tmpfs** | 内存 | 临时状态、不落盘、追求性能 |

选择依据（官方原文）：

> Volumes are easier to back up or migrate than bind mounts.
> Volumes work on both Linux and Windows containers.
> Volumes can be more safely shared among multiple containers.
> When your application requires high-performance I/O.

> Volumes are not a good choice if you need to access the files from the host.
> Use bind mounts if you need to access files or directories from both containers and the host.

> If your container generates non-persistent state data, consider using a tmpfs mount.

关键差异：**写容器可写层（writable layer）会经过存储驱动的联合文件系统，比直接写宿主文件系统慢**。写密集型应用（数据库）尤其受影响。所以持久化数据一律走卷，不要写在容器可写层。

---

## 二、数据卷 Volume

### 特点

- Docker 完全管理，生命周期独立于容器
- Linux 和 Windows 容器都支持
- 可用 CLI / API 管理，便于备份迁移
- 多容器共享更安全
- 新卷内容可由容器或镜像预填充
- 高性能 I/O（直接写宿主文件系统）
- 使用 `rprivate`（递归私有）绑定传播，**不可配置**

### 命名卷与匿名卷

| | 命名卷 | 匿名卷 |
|---|---|---|
| 名字 | 你指定 | 随机且保证唯一 |
| 复用 | 可，多容器共享同一卷 | **不自动复用**，每个容器各建一个 |
| 删除容器后 | 保留 | 保留（除非用 `--rm` 创建容器时一起销毁） |
| 后续 up 挂载 | 自动挂载 | **不会自动挂载**（无稳定名字） |

要共享匿名卷，必须用它的随机卷 ID 挂载。

### 命令

```bash
docker volume create pgdata                    # 创建
docker volume ls                              # 列出
docker volume ls --filter "dangling=true"     # 悬空卷
docker volume inspect pgdata                 # 详情
docker volume rm pgdata                       # 删除
docker volume prune                          # 清理未使用的卷
docker volume prune -a                       # 含命名卷（危险，会丢数据）
```

`docker volume create` 参数（27.3.1 实测）：

| 参数 | 说明 |
|------|------|
| `-d, --driver` | 卷驱动名，默认 `local` |
| `-o, --opt` | 驱动选项 map |
| `--label` | 标签 |
| `--availability` | 集群卷可用性：`active` / `pause` / `drain`（默认 `active`） |
| `--scope` | 集群卷作用域：`single` / `multi`（默认 `single`） |

### 挂载方式

```bash
# 短语法
docker run -v pgdata:/var/lib/postgresql/data postgres

# 长语法（更明确，推荐）
docker run --mount type=volume,source=pgdata,target=/var/lib/postgresql/data postgres

# 只读
docker run --mount type=volume,source=pgdata,target=/data,readonly postgres
```

### 挂载覆盖已有数据

挂载到容器内非空目录时，**该目录的原有内容会被隐藏**（不是覆盖，是不可见）。镜像里预置的数据如果正好在挂载点，会"消失"。

```dockerfile
FROM ubuntu
RUN mkdir /myvol
RUN echo "hello world" > /myvol/file.txt
VOLUME /myvol
```

`docker run` 会把 `file.txt` 复制进新卷作为初始内容。

### 备份与恢复

```bash
# 备份
docker run --rm -v pgdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/pgdata.tar.gz -C /data .

# 恢复
docker run --rm -v pgdata:/data -v "$PWD":/backup alpine \
  tar xzf /backup/pgdata.tar.gz -C /data
```

### 命名绑定挂载

用 `local` 驱动给绑定挂载一个稳定名字：

```yaml
volumes:
  app-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /srv/app-data    # 必须是已存在的绝对路径
```

---

## 三、绑定挂载 Bind Mount

### 特点

- 依赖宿主的目录结构和操作系统
- 宿主可直接访问容器内的文件
- 开发时挂源码最常用
- Linux 上宿主路径不存在时**自动创建为 root 属主目录**（常见权限报错根源）
- 支持 `rprivate`（默认）、`rshared`、`rslave`、`private`、`shared`、`slave` 传播模式
- 支持 SELinux 标签 `:z` / `:Z`
- 支持递归挂载

### 命令

```bash
# 短语法
docker run -v /host/path:/container/path[:options] app
docker run -v /host/path:/container/path:ro app      # 只读
docker run -v /host/path:/container/path:z app      # SELinux 共享标签
docker run -v /host/path:/container/path:Z app      # SELinux 私有标签

# 长语法
docker run --mount type=bind,source=/host/path,target=/container/path,readonly app
docker run --mount type=bind,src=/host/path,dst=/container/path,bind-propagation=rshared app
```

> `--mount` 比 `-v` 更严格：路径不存在会直接报错，而 `-v` 会自动创建目录。这是 `-v` 最常见的坑来源。

### 覆盖已有数据

绑定挂载到容器非空目录同样会**隐藏**原有内容。

### SELinux

CentOS/RHEL 上挂载目录容器内无权访问时加 `:z`：

```bash
docker run -v /srv/data:/data:z app
```

### 递归挂载

挂载点本身是另一个挂载点时，用 `:rbind`：

```bash
docker run --mount type=bind,source=/mnt,target=/mnt,rbind app
```

---

## 四、tmpfs 内存挂载

### 特点

- 只写内存，不落盘
- 速度快，适合临时状态
- 容器重启后内容清空
- 受内存大小限制

### 命令

```bash
docker run --mount type=tmpfs,dst=<path> app
docker run --tmpfs <path>[:opts] app
```

`--tmpfs` 选项：

| 选项 | 说明 |
|------|------|
| `ro` / `rw` | 只读 / 读写（默认读写） |
| `nosuid` / `suid` | 禁止 / 允许 setuid、setgid 位生效（默认允许） |
| `noexec` / `exec` | 禁止 / 允许执行二进制（默认允许） |
| `nodev` / `dev` | 禁止 / 允许设备文件（默认允许） |
| `size` | 内存大小，如 `size=100m` |
| `mode` | 权限，如 `mode=1777` |

> `--tmpfs` 不能用于 Swarm 服务，必须用 `--mount`。

`--mount` 长语法：

```yaml
services:
  app:
    tmpfs:
      - /tmp
    volumes:
      - type: tmpfs
        target: /run
        tmpfs:
          size: 100m
```

### 挂载覆盖已有数据

tmpfs 挂载同样会隐藏容器内该路径的原有内容。

---

## 五、存储驱动与镜像层

### 镜像即层

镜像由一系列层组成，每层对应 Dockerfile 里一条指令。**除最后一层外都是只读的**。

```dockerfile
FROM ubuntu:22.04
LABEL org.opencontainers.image.authors="org@example.com"   # 元数据，不产生层
COPY . /app                                                     # 产生层
RUN make /app                                                  # 产生层
RUN rm -r $HOME/.cache                                         # 产生层
CMD python /app/app.py                                         # 元数据，不产生层
```

只有修改文件系统的指令（`RUN`、`COPY`、`ADD`）才产生新层。

### 容器可写层

容器运行时在其镜像层之上加一个**可写层（writable layer）**。容器删除后该层不保留。

存储驱动用**写时复制（CoW）**：写入时先复制再改。这层抽象比直接写宿主文件系统慢，写密集型场景（数据库）受此影响明显。

> **Docker Engine 29.0+ 新装默认使用 containerd image store**，用 snapshotters 而非经典存储驱动。概念（镜像分层）不变，但命令和示例不再对应实际存储方式。经典存储驱动包括 `overlay2`（默认）、`btrfs`、`zfs`、`vfs`、`aufs`、`devicemapper`、`windowsfilter`。

### 存储驱动 vs 卷

| | 存储驱动 | Docker 卷 |
|---|---|---|
| 存什么 | 镜像层、容器可写层 | 应用数据 |
| 容器删除后 | 镜像层保留 | 卷保留 |
| 适合 | 镜像分发 | 持久化数据 |

**写密集型、需要持久化、需要多容器共享的数据，一律用卷。**

### 查看当前存储驱动

```bash
docker info | grep -A5 "Storage Driver"
docker system df -v
```

---

## 六、网络驱动

Docker 网络子系统可插拔，默认提供以下驱动：

| 驱动 | 说明 | 适用场景 |
|------|------|---------|
| `bridge` | **默认**。桥接网络 | 同主机容器互通 |
| `host` | 移除容器与宿主之间的网络隔离，直接用宿主网络 | 需要监听宿主特定接口、性能极致 |
| `overlay` | 连接多个 Docker daemon | 跨主机通信、Swarm 服务 |
| `ipvlan` | 完全控制 IPv4/IPv6 寻址，不分配独立 MAC | MAC 地址数量受限 |
| `macvlan` | 给容器分配 MAC，看起来像物理设备 | 从 VM 迁移、需要物理网卡身份 |
| `none` | 完全隔离容器与宿主及其他容器 | 纯计算任务 |
| 第三方插件 | 第三方网络栈 | 特殊网络需求 |

官方选型建议：

- 默认 bridge：不需要特殊网络能力时
- **用户自定义 bridge**：同一 Docker 主机上容器互相通信（Compose 默认创建的就是这种）
- host：容器网络不与宿主隔离
- overlay：不同 Docker 主机上的容器通信
- macvlan：容器需要表现得像物理主机，各有唯一 MAC
- ipvlan：与 macvlan 类似但不分配独立 MAC

`none` 驱动不适用于 Swarm 服务。

---

## 七、用户自定义网络

### 默认网络 vs 用户自定义网络

| | 默认 bridge | 用户自定义 bridge |
|---|---|---|
| DNS 解析 | **不支持**容器名 | **支持** |
| 容器互通 | 靠 `--link`（遗留） | 自动，按服务名 |
| 隔离 | 弱 | 强 |
| 挂载 | 自动 | 需显式声明 |

**Compose 创建的是用户自定义网络**，所以服务名可以直接当 DNS 名用：

```yaml
services:
  app:
    image: app
    environment:
      DB_HOST: db          # 直接用服务名
      REDIS_HOST: redis
```

同网络内 `db:5432` 即可连接。**注意用容器端口，不是宿主映射端口。**

### 命令

```bash
docker network create mynet
docker network ls
docker network inspect mynet
docker network connect mynet <容器>
docker network connect --alias db mynet <容器>
docker network disconnect mynet <容器>
docker network rm mynet
docker network prune
```

`docker network create` 参数（27.3.1 实测）：

| 参数 | 说明 |
|------|------|
| `-d, --driver` | 驱动，默认 `bridge` |
| `--subnet` | CIDR 子网 |
| `--gateway` | 网关地址 |
| `--ip-range` | 容器 IP 分配范围 |
| `--internal` | 禁止访问外网 |
| `--ipv6` | 启用 IPv6 |
| `--attachable` | 允许独立容器接入 |
| `--label` | 标签 |
| `-o, --opt` | 驱动选项 |
| `--aux-address` | 辅助 IPv4/IPv6 地址 |

### 隔离示例

```yaml
services:
  proxy:
    image: nginx
    networks: [frontend]
  app:
    image: app
    networks: [frontend, backend]
  db:
    image: postgres
    networks: [backend]

networks:
  frontend:
  backend:
```

`proxy` 与 `db` **没有共同网络**，互相不可达；只有 `app` 两边都通。

### 网络别名

```bash
docker network connect --alias db mynet <容器>
```

同网络内可用 `db` 访问该容器，即使容器名不是 `db`。

---

## 八、端口发布

### 基础行为

- bridge 网络上的容器端口，**默认对宿主和同网络其他容器可访问**
- **默认对宿主机外部不可访问**
- 其他网络的容器也访问不到

用 `-p` / `--publish` 发布端口，这会创建防火墙规则。

| 写法 | 含义 |
|------|------|
| `-p 8080:80` | 宿主 8080 → 容器 TCP 80 |
| `-p 192.168.1.100:8080:80` | 指定宿主 IP |
| `-p 8080:80/udp` | UDP 协议 |
| `-p 8080:80/tcp -p 8080:80/udp` | 同宿主端口同时映射 TCP 和 UDP |

### 安全：默认是不安全的

> **Publishing container ports is insecure by default.** 发布端口后，容器不只对 Docker 宿主可见，而是对外部世界可见。

绑定到 localhost 限定只有本机可访问：

```bash
docker run -p 127.0.0.1:8080:80 -p '[::1]:8080:80' nginx
```

> **Docker 28.0.0 之前**：同一 L2 网段内的其他主机可以访问发布到 localhost 的端口（moby/moby#45610）。28.0.0 起已修复。

不指定宿主 IP 时，端口绑定 `0.0.0.0`（所有接口），**绕过宿主机防火墙规则**。宿主机有公网 IP 时容器直接暴露公网。

### 两种网关模式

| 模式 | 行为 |
|------|------|
| `nat`（默认） | DNAT 转发，容器返回源地址是容器 IP |
| `host` | 直接用宿主 IP，无 NAT |

### IPv6 注意事项

端口映射未指定宿主 IP 时，宿主的 IPv6 地址会映射到容器的 IPv4 地址 —— 因为 bridge 网络是 IPv4-only，且 `--userland-proxy=true`（默认）。

### 与 EXPOSE 的区别

`EXPOSE` **不发布端口**，只是镜像元数据（文档性质）。真正发布靠 `-p`（指定端口）或 `-P`（发布所有 EXPOSE 端口到高位端口）。

---

## 九、资源限制

默认容器**没有任何资源限制**，可以用多少全看宿主内核调度。

### 内存

```bash
docker run -m 512m app                       # 硬上限
docker run --memory 512m --memory-swap 512m app   # 内存+swap 合计上限
docker run --memory-reservation 256m app    # 软限制（软限）
```

`-m` 与 `--memory-swap` 的组合语义容易混：

| `--memory` | `--memory-swap` | 效果 |
|-----------|-----------------|------|
| 不设 | 不设 | 无限制 |
| 512m | 512m | 内存 512m，**禁用 swap** |
| 512m | 1g | 内存 512m，swap 最多 512m |
| 512m | -1 | 内存 512m，**swap 无限制** |

### OOM 风险

宿主内存不足时内核抛 OOME 并开始杀进程，**任何进程都可能被杀**，包括 Docker daemon，可能拖垮整机。

Docker 的缓解措施：

- 调整 daemon 的 OOM 优先级，让它比普通进程更不容易被杀
- **不调整容器的 OOM 优先级** —— 容器比 daemon 更容易被杀，这是刻意设计

> **不要手动把 `--oom-score-adj` 设成极端负数，也不要用 `--oom-kill-disable`**。官方明确不建议，这会绕过保护机制。

### CPU

```bash
docker run --cpus 1.5 app                   # 分配 1.5 个 CPU
docker run --cpuset-cpus "0,1" app         # 绑定到 0、1 号核
docker run --cpu-shares 512 app             # 相对权重（默认 1024）
docker run --cpu-period 100000 --cpu-quota 50000 app   # CFS 配额
```

`--cpus` 是绝对限制，`--cpu-shares` 是相对权重（只在竞争时生效）。

### 进程数

```bash
docker run --pids-limit 100 app
```

### GPU

```bash
docker run --gpus all app
docker run --gpus '"device=0,2"' app
```

### 检查内核支持

```bash
docker info | grep -i warning
```

若输出 `WARNING: No swap limit support`，说明内核缺少对应 capability，需查系统文档启用。

### Compose 中配置

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1.5'
          memory: 512M
          pids: 100
        reservations:
          cpus: '0.5'
          memory: 256M
```

或用顶层属性（`mem_limit` / `cpus` / `pids_limit`），见 [[docker-compose 使用说明]]。

---

## 十、选型决策表

### 存储选型

| 场景 | 选择 |
|------|------|
| 数据库数据 | 命名卷 |
| 需要备份 / 迁移 | 命名卷 |
| 需要宿主直接读文件 | 绑定挂载 |
| 开发时挂源码 | 绑定挂载（只读更安全） |
| 临时缓存 / 临时状态 | tmpfs |
| 高性能 I/O | 命名卷（避开可写层的 CoW 开销） |
| 容器间共享数据 | 命名卷 |

### 网络选型

| 场景 | 选择 |
|------|------|
| 同主机容器互通（Compose） | 用户自定义 bridge |
| 需要容器名 DNS 解析 | 用户自定义 bridge |
| 不同主机容器互通 | overlay |
| 容器需要像物理主机 | macvlan |
| MAC 地址受限 | ipvlan |
| 只需宿主网络性能 | host |
| 完全不需要网络 | none |

---

## 十一、排错

### 挂载目录权限错误

```bash
# 1) 宿主目录不存在被自动创建成 root —— 先建好并设属主
mkdir -p /srv/data && chown 1000:1000 /srv/data

# 2) SELinux —— 加 :z
-v /srv/data:/data:z

# 3) 镜像 USER 与目录属主不匹配
docker run -u $(id -u):$(id -g) ...

# 4) 用 --mount 让问题在启动时暴露，而不是静默创建 root 目录
docker run --mount type=bind,source=/srv/data,target=/data ...
```

### 容器间不通

```bash
docker network inspect <网络名>          # 看容器是否在同一网络
docker exec app getent hosts db           # DNS 解析
docker exec app ping -c3 db
docker inspect <容器> --format '{{json .NetworkSettings.Networks}}'
```

排查顺序：同网络？用了服务名还是容器名？端口用的是容器端口还是宿主映射端口？`network_mode: host` 是否混用？

### 端口不通

```bash
docker port <容器>                        # 看映射
ss -lntp | grep 8080                      # 看宿主监听
docker inspect <容器> --format '{{json .NetworkSettings.Ports}}'
```

绑了 `0.0.0.0` 还是 `127.0.0.1`？从别的机器访问要用宿主 IP 不是 localhost。

### 数据卷占用空间

```bash
docker system df -v                      # 看各卷占用
docker volume ls --filter "dangling=true"
docker volume prune                      # 清未使用的卷
```

匿名卷会持续堆积（容器删除后残留）。用 `docker run --rm` 避免，或定期 prune。

### 容器可写层过大

```bash
docker ps -s                             # 看容器可写层大小
docker diff <容器>                       # 看相对镜像改了什么
```

日志写在容器可写层是常见原因。改用日志驱动 + `max-size` 限制。

---

## 十二、速查表

| 目的 | 命令 |
|------|------|
| 创建卷 | `docker volume create pgdata` |
| 列卷 | `docker volume ls` |
| 查卷 | `docker volume inspect pgdata` |
| 删卷 | `docker volume rm pgdata` |
| 清理未用卷 | `docker volume prune` |
| 挂卷 | `docker run -v pgdata:/data app` |
| 挂卷（长语法） | `docker run --mount type=volume,source=pgdata,target=/data app` |
| 绑定挂载 | `docker run -v /host:/ctr app` |
| 只读挂载 | `docker run -v /host:/ctr:ro app` |
| SELinux 挂载 | `docker run -v /host:/ctr:z app` |
| tmpfs | `docker run --tmpfs /tmp:size=100m app` |
| 看存储驱动 | `docker info \| grep -A5 "Storage Driver"` |
| 看空间占用 | `docker system df -v` |
| 创建网络 | `docker network create mynet` |
| 列网络 | `docker network ls` |
| 查网络 | `docker network inspect mynet` |
| 连接网络 | `docker network connect mynet <容器>` |
| 加网络别名 | `docker network connect --alias db mynet <容器>` |
| 断开网络 | `docker network disconnect mynet <容器>` |
| 删网络 | `docker network rm mynet` |
| 内网（禁外网） | `docker network create --internal mynet` |
| 指定子网 | `docker network create --subnet 172.30.0.0/16 mynet` |
| 发布端口 | `docker run -p 8080:80 app` |
| 只绑本地 | `docker run -p 127.0.0.1:8080:80 app` |
| 内存限制 | `docker run -m 512m app` |
| 禁 swap | `docker run -m 512m --memory-swap 512m app` |
| CPU 限制 | `docker run --cpus 1.5 app` |
| 绑核 | `docker run --cpuset-cpus "0,1" app` |
| 进程数限制 | `docker run --pids-limit 100 app` |
| 挂 GPU | `docker run --gpus all app` |

---

## 相关

- [[Docker 常用命令]] — Docker 基础命令
- [[docker-compose 使用说明]] — Compose 专题
- [[Dockerfile 编写指南]] — Dockerfile 指令与最佳实践
- [[Docker 网络实现原理]] — 网络栈、iptables、DNS 的实现细节
- 官方文档：https://docs.docker.com/engine/storage/ · https://docs.docker.com/engine/network/
