# Docker 常用命令

> 命令与参数均对照 Docker CLI 27.3.1 实测校验。`docker` 与 `docker compose` 是两套东西：`compose` 是 CLI 插件（v2），不是独立二进制。

## 目录

1. [容器生命周期](#一容器生命周期)
2. [查看与排查](#二查看与排查)
3. [镜像管理](#三镜像管理)
4. [网络管理](#四网络管理)
5. [数据卷](#五数据卷)
6. [清理与空间](#六清理与空间)
7. [Docker Compose](#七docker-compose)
8. [镜像导入导出与迁移](#八镜像导入导出与迁移)
9. [常见故障排查](#九常见故障排查)
10. [命令速查表](#十命令速查表)

---

## 一、容器生命周期

### 1.1 运行容器

```bash
docker run -d --name web \
  -p 8080:80 \
  -v /srv/data:/var/lib/data \
  -e APP_ENV=prod \
  --restart unless-stopped \
  nginx:stable
```

`run` 最常用参数：

| 参数 | 含义 |
|------|------|
| `-d, --detach` | 后台运行 |
| `--name` | 指定容器名（不给就是随机 ID） |
| `-p, --publish` | 端口映射 `宿主机:容器`，`8080:80`；只写 `80` 表示随机宿主机端口 |
| `-v, --volume` | 挂载，`宿主机路径:容器路径` 或 `卷名:容器路径` |
| `-e, --env` | 设置环境变量 |
| `--env-file` | 从文件读环境变量 |
| `-u, --user` | 指定运行用户（UID 或 `name[:group]`） |
| `-w, --workdir` | 容器内工作目录 |
| `-m, --memory` | 内存上限，如 `512m`、`2g` |
| `--cpus` | CPU 配额，如 `1.5` |
| `--cpuset-cpus` | 绑定具体 CPU 核，如 `0,1` |
| `--pids-limit` | 进程数上限 |
| `--network` | 指定网络（bridge / host / 自定义网络名） |
| `--network-alias` | 网络内 DNS 别名 |
| `--restart` | 重启策略：`no`(默认) / `always` / `on-failure` / `unless-stopped` |
| `--rm` | 退出后自动删除容器及匿名卷 |
| `-i` / `-t` | 保持 STDIN / 分配伪终端（`-it` 组合最常用） |
| `--entrypoint` | 覆盖镜像 ENTRYPOINT |
| `--log-driver` / `--log-opt` | 日志驱动及参数，如 `--log-opt max-size=10m` |
| `--health-cmd` / `--health-interval` / `--health-retries` / `--health-timeout` / `--health-start-period` | 健康检查 |
| `--init` | 加 init 进程回收僵尸进程 |
| `--cap-add` / `--cap-drop` | 增删 Linux capability |
| `--security-opt` | 安全选项，如 `seccomp=unconfined` |
| `--tmpfs` | 挂载内存文件系统 |
| `--dns` / `--add-host` | 自定义 DNS / 主机名解析 |
| `--shm-size` | `/dev/shm` 大小（Chrome 类容器常需调大） |
| `--platform` | 指定平台，如 `linux/amd64` |
| `--pull` | 拉取策略：`always` / `missing` / `never` |
| `--gpus` | 挂载 GPU |

### 1.2 常用 run 组合

```bash
# 一次性任务：退出即删
docker run --rm -it alpine sh

# 后台跑 + 退出清理
docker run --rm -d --name tmp-job alpine sleep 300

# 只读根文件系统
docker run --rm --read-only -v /tmp:/tmp alpine sh

# 指定平台（跨架构机器拉 amd64 镜像）
docker run --platform linux/amd64 -d --name app app:1.0

# 资源受限
docker run -d --name limited -m 512m --cpus 1.5 --pids-limit 100 nginx
```

### 1.3 启停与删除

```bash
docker start <容器>          # 启动已停止的容器
docker stop <容器>           # 优雅停止（默认 SIGTERM，10 秒后 SIGKILL）
docker stop -t 30 <容器>     # 自定义等待秒数
docker restart <容器>
docker kill <容器>           # 立即 SIGKILL
docker pause <容器>          # 冻结所有进程
docker unpause <容器>
docker rm <容器>             # 删除（必须先 stop）
docker rm -f <容器>          # 强制删除运行中的容器
docker rm -v <容器>          # 同时删除关联的匿名卷
docker rename <旧名> <新名>
docker update --memory 1g --cpus 2 <容器>   # 改运行中容器的资源限制
```

---

## 二、查看与排查

### 2.1 列出容器

```bash
docker ps                       # 只看运行中
docker ps -a                    # 包含已停止
docker ps -a --filter "status=exited"
docker ps --filter "name=web"
docker ps --filter "label=app=web"
docker ps --filter "ancestor=nginx:stable"
docker ps -q                    # 只输出 ID（配合 xargs）
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps -s                    # 附带磁盘占用大小
```

### 2.2 查看容器详情

```bash
docker inspect <容器>                              # 完整 JSON
docker inspect -f '{{.State.Status}}' <容器>       # 状态：running/exited
docker inspect -f '{{.State.ExitCode}}' <容器>     # 退出码
docker inspect -f '{{.State.Error}}' <容器>        # 启动错误信息
docker inspect -f '{{.State.OOMKilled}}' <容器>    # 是否被 OOM Kill
docker inspect -f '{{.NetworkSettings.IPAddress}}' <容器>
docker inspect -f '{{json .Config.Env}}' <容器>
docker inspect -f '{{json .HostConfig.PortBindings}}' <容器>
docker inspect -f '{{.Config.Image}}' <容器>
```

### 2.3 日志

```bash
docker logs <容器>
docker logs -f <容器>                              # 实时跟随
docker logs -t <容器>                              # 带时间戳
docker logs --tail 100 <容器>                      # 末尾 100 行
docker logs --since "2026-10-31T08:00:00" \
            --until "2026-10-31T11:00:00" <容器>  # 时间范围查询
docker logs --since 42m <容器>                     # 相对时间：最近 42 分钟
docker logs --details <容器>                       # 额外细节
```

更多见 [[常用操作]]。

### 2.4 进入容器

```bash
docker exec -it <容器> sh            # 最常用，sh 比 bash 兼容性好
docker exec -it -u root <容器> bash   # 以 root 进入
docker exec -w /app <容器> ls        # 指定工作目录
docker exec -e DEBUG=1 <容器> env     # 临时加环境变量
docker exec -d <容器> nohup ./x &    # 后台执行
```

容器没装 bash 时用 `sh`；Alpine 用 `ash`。进容器前先 `docker ps` 确认目标。

### 2.5 资源与进程

```bash
docker stats                    # 实时 CPU/内存/网络/IO
docker stats --no-stream        # 只输出一次快照（脚本里用）
docker stats -a                 # 包含停止的容器
docker top <容器>               # 容器内进程列表
docker top <容器> aux           # 可传 ps 参数
docker port <容器>              # 端口映射
docker diff <容器>              # 相对镜像的 filesystem 变更
```

### 2.6 事件流

```bash
docker events                    # 实时事件
docker events --since 30m
docker events --filter "type=container" --filter "event=die"
```

### 2.7 文件拷贝

```bash
docker cp <容器>:/path/file ./local/     # 容器 -> 宿主
docker cp ./local/file <容器>:/path/     # 宿主 -> 容器
docker cp -a <容器>:/dir ./dir           # 保留 uid/gid
docker cp <容器>:/path - > out.tar       # 导出为 tar 流
```

注意方向：`宿主:路径` 和 `容器:路径` 的语义不同，方向写反会报 "no such file or directory"。

---

## 三、镜像管理

```bash
docker pull nginx:stable
docker pull -a nginx                    # 拉取所有 tag
docker pull --platform linux/amd64 ...  # 指定架构
docker push registry.example.com/app:1.0
docker push -a registry.example.com/app # 推送所有 tag

docker images                           # 列出（等同 docker image ls）
docker images -a                        # 含中间层
docker images --digests
docker images --filter "dangling=true"

docker tag <镜像> <新名字:tag>          # 打 tag
docker history <镜像>                   # 构建层历史
docker rm <镜像>
docker rmi -f <镜像>                    # 强制删除

docker login -u <用户名> --password-stdin < registry.example.com
docker login                            # 交互式
docker logout
```

### 3.1 构建

```bash
docker build -t app:1.0 .
docker build -t app:1.0 -f Dockerfile.prod .
docker build --build-arg VERSION=1.0 -t app:1.0 .
docker build --no-cache -t app:1.0 .
docker build --pull -t app:1.0 .        # 强制拉取基础镜像
docker build --platform linux/amd64 -t app:1.0 .
docker build -q -t app:1.0 .            # 静默，只输出镜像 ID
```

> **注意**：Docker 27.x 起 `docker build` 默认走 legacy builder 并会提示已废弃，新版推荐装 buildx 插件（`docker buildx build`）。本机 CLI 未装 buildx 时 `docker buildx` 会直接报 "not a docker command"。

### 3.2 从容器反向生成镜像

```bash
docker commit <容器> app:snapshot        # 提交容器改动为镜像
docker commit -m "fix" -a "me" <容器> app:snapshot
docker commit -c 'CMD ["nginx","-g","daemon off;"]' <容器> app:snapshot
```

镜像可改、容器可改，这是应急手段，不要当常规流程用。

---

## 四、网络管理

```bash
docker network ls
docker network create mynet                       # 默认 bridge 驱动
docker network create --driver bridge \
  --subnet 172.30.0.0/16 \
  --gateway 172.30.0.1 \
  --ip-range 172.30.100.0/24 \
  mynet
docker network create --internal mynet            # 禁止访问外网
docker network inspect mynet
docker network connect mynet <容器>
docker network connect --alias db mynet <容器>    # 网络内用 db 访问
docker network disconnect mynet <容器>
docker network rm mynet
docker network prune                             # 清理未使用的网络
```

容器之间用服务名互相访问（Docker 内嵌 DNS），前提是**连在同一个自定义网络**上。默认 bridge 网络不提供 DNS 解析。

---

## 五、数据卷

```bash
docker volume create pgdata
docker volume ls
docker volume ls --filter "dangling=true"
docker volume inspect pgdata
docker volume rm pgdata
docker volume prune                # 删未使用的卷
docker volume prune -a             # 含命名卷（谨慎，可能删掉数据）
```

两种挂载方式：

```bash
# 绑定挂载：宿主路径，容器内改动直接落盘
docker run -v /srv/app/data:/var/lib/postgresql/data ...

# 命名卷：由 Docker 管理存储位置，适合数据库
docker run -v pgdata:/var/lib/postgresql/data ...
```

绑定挂载宿主目录不存在时，Docker 会**自动创建成 root 属主的目录**，是很多权限报错的根源。先 `mkdir -p` 再挂。

SELinux 环境下（CentOS/RHEL）挂载目录容器内无权访问，加 `:z`：

```bash
docker run -v /srv/data:/data:z ...
```

---

## 六、清理与空间

```bash
docker system df              # 总览：镜像/容器/卷/构建缓存各占多少
docker system df -v           # 详细明细
```

分级清理：

```bash
docker container prune        # 删所有已停止的容器
docker image prune            # 删悬空镜像（<none>）
docker image prune -a         # 删所有未被容器使用的镜像（慎用）
docker volume prune           # 删匿名卷
docker volume prune -a        # 所有未使用卷，包括命名卷（危险，会丢数据）
docker network prune          # 删未使用网络
docker builder prune          # 删构建缓存

docker system prune           # 一次性清理以上全部（不含命名卷）
docker system prune -a --volumes   # 全清，含命名卷
```

加 `-f` 跳过交互确认。**`docker system prune -a --volumes` 会删掉命名卷里的数据库数据，生产环境执行前务必确认。**

---

## 七、Docker Compose

> v2 插件形式，命令为 `docker compose`（有空格），不是旧版 `docker-compose`。可通过 `docker compose version` 确认是否安装。

### 7.1 核心命令

```bash
docker compose up -d              # 后台启动全部服务
docker compose up -d --build      # 重新构建并启动
docker compose up -d web db       # 只启动指定服务
docker compose up --scale web=3   # 扩容到 3 个实例
docker compose down               # 停止并删除容器和网络
docker compose down -v            # 同时删除数据卷（会丢数据）
docker compose down --rmi local  # 同时删除本地构建的镜像
docker compose restart            # 重启
docker compose restart web        # 重启单个服务
docker compose stop / start       # 停止 / 启动（保留容器）
docker compose kill               # 强制杀
docker compose pause / unpause
docker compose ps                 # 查看状态
docker compose ps -a              # 含已停止
docker compose logs               # 全部日志
docker compose logs -f            # 实时跟随
docker compose logs -f web        # 跟单个服务
docker compose logs --tail 100 web
docker compose exec web bash      # 进入运行中的容器
docker compose exec -T web cmd    # 无 TTY（脚本里用）
docker compose run --rm web cmd   # 一次性运行新容器
docker compose build              # 构建
docker compose build --no-cache
docker compose pull               # 拉取镜像
docker compose push
docker compose config             # 渲染并校验最终配置
docker compose top                # 各服务进程
docker compose port web 80        # 查端口映射
docker compose cp web:/tmp/a .    # 拷文件
docker compose events
docker compose wait               # 等待服务退出
```

### 7.2 常用场景

```bash
# 只重建某个服务及其依赖
docker compose up -d --no-deps web

# 查看某服务最近 100 行带时间戳日志
docker compose logs --tail 100 -t web

# 带环境变量覆盖启动
docker compose run -e DEBUG=1 --rm web node app.js

# 清理
docker compose down --rmi all --volumes -f
```

---

## 八、镜像导入导出与迁移

### 8.1 镜像（保留层与 tag，推荐）

```bash
docker save -o app.tar app:1.0            # 导出到文件
docker save app:1.0 > app.tar             # 同上，走 stdout
docker save app:1.0 other:2.0 > multi.tar # 多个镜像
docker load -i app.tar                    # 从文件导入
docker load < app.tar                     # 从 stdin 导入
```

### 8.2 容器文件系统（丢失元数据）

```bash
docker export -o fs.tar <容器>            # 导出容器文件系统
docker import fs.tar app:imported         # 导入为镜像
docker import -c 'CMD ["nginx","-g","daemon off;"]' fs.tar app:imported
```

**区别**：`save` 保留分层、标签、环境变量、CMD/ENTRYPOINT、端口等元信息；`export` 只导出合并后的文件系统，导入后这些全丢，需要用 `-c` 手工补。跨机器迁移镜像用 `save`/`load`。

### 8.3 导出镜像为 Dockerfile 骨架

```bash
docker image inspect app:1.0 --format '{{.Config}}'
```

---

## 九、常见故障排查

### 9.1 容器起不来

```bash
docker ps -a --filter "name=web"      # 看状态是不是 Exited
docker logs web                       # 看应用日志
docker inspect -f '{{.State.ExitCode}}' web
docker inspect -f '{{.State.Error}}' web
docker inspect -f '{{json .State}}' web
```

退出码速查：`0` 正常退出 · `1` 应用自身报错 · `2` shell 用法错误 · `125` docker run 参数错 · `126` 命令不可执行 · `127` 命令找不到 · `128+N` 被信号 N 杀死（`137` = SIGKILL，通常是 OOM 或 `docker kill`）。

被 OOM 杀掉：

```bash
docker inspect -f '{{.State.OOMKilled}}' web    # true 即 OOM
docker stats web                                  # 看内存水位
```

### 9.2 端口占用

```bash
docker port web
ss -lntp | grep 8080
```

### 9.3 磁盘满

```bash
docker system df -v      # 先定位是谁占的
docker system prune -a --volumes
```

日志文件无限增长也会撑爆磁盘，创建时限制：

```bash
docker run -d --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 ...
```

### 9.4 挂载目录权限问题

```bash
# 容器内无权访问宿主目录
# 1) SELinux：加 :z
-v /srv/data:/data:z
# 2) 目录不存在被自动创建成 root —— 先建目录再 chown
mkdir -p /srv/data && chown 1000:1000 /srv/data
# 3) 镜像 USER 与宿主目录属主不匹配
docker run -u $(id -u):$(id -g) ...
```

### 9.5 容器内 DNS 解析不了

自定义网络才有 DNS 解析。`docker run --network host` 直接用宿主网络，无 DNS 隔离。

### 9.6 排查网络连通性

```bash
docker exec web getent hosts other-service
docker exec web cat /etc/resolv.conf
docker exec -it web ping -c3 8.8.8.8
```

---

## 十、命令速查表

| 目的 | 命令 |
|------|------|
| 列运行中容器 | `docker ps` |
| 列全部容器 | `docker ps -a` |
| 看日志 | `docker logs -f <容器>` |
| 时间范围日志 | `docker logs --since T1 --until T2 <容器>` |
| 进容器 | `docker exec -it <容器> sh` |
| 容器详情 | `docker inspect <容器>` |
| 容器状态 | `docker inspect -f '{{.State.Status}}' <容器>` |
| 退出码 | `docker inspect -f '{{.State.ExitCode}}' <容器>` |
| 实时资源 | `docker stats` |
| 容器内进程 | `docker top <容器>` |
| 拷文件进 | `docker cp src <容器>:/dst` |
| 拷文件出 | `docker cp <容器>:/src dst` |
| 端口映射 | `docker port <容器>` |
| 删容器 | `docker rm -f <容器>` |
| 列镜像 | `docker images` |
| 拉镜像 | `docker pull <镜像>` |
| 推镜像 | `docker push <镜像>` |
| 打 tag | `docker tag <源> <目标>` |
| 构建 | `docker build -t <名>:<tag> .` |
| 导出镜像 | `docker save -o app.tar <镜像>` |
| 导入镜像 | `docker load -i app.tar` |
| 空间占用 | `docker system df -v` |
| 全局清理 | `docker system prune -a` |
| 列网络 | `docker network ls` |
| 连网络 | `docker network connect <网络> <容器>` |
| 列卷 | `docker volume ls` |
| Compose 起 | `docker compose up -d` |
| Compose 停 | `docker compose down` |
| Compose 日志 | `docker compose logs -f` |
| Compose 进容器 | `docker compose exec <服务> sh` |
| 登录仓库 | `docker login -u <用户> --password-stdin <仓库>` |

---

## 相关

- [[常用操作]] — Docker 常用操作补充
- [[非容器部署问题]] — 相关问题记录
