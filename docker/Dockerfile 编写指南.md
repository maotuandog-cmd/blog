# Dockerfile 编写指南

> 指令语法与语义对照 Docker 官方 Dockerfile reference（docker/docs 仓库 vendored BuildKit 文档，`content/_vendor/github.com/moby/buildkit/frontend/dockerfile/docs/reference.md`）与 `manuals/build/building/best-practices.md` 整理。
> 命令行参数对照 Docker CLI 27.3.1 实测校验。

---

## 目录

1. [Dockerfile 基础](#一dockerfile-基础)
2. [指令速查表](#二指令速查表)
3. [FROM 与多阶段构建](#三from-与多阶段构建)
4. [ARG 与 ENV](#四arg-与-env)
5. [COPY 与 ADD](#五copy-与-add)
6. [RUN、CMD 与 ENTRYPOINT](#六runcmd-与-entrypoint)
7. [USER、WORKDIR、VOLUME](#七userworkdirvolume)
8. [HEALTHCHECK、STOPSIGNAL、SHELL](#八healthcheckstopsignalshell)
9. [构建命令与缓存](#九构建命令与缓存)
10. [.dockerignore](#十dockerignore)
11. [最佳实践](#十一最佳实践)
12. [排错](#十二排错)
13. [速查表](#十三速查表)

---

## 一、Dockerfile 基础

Dockerfile 是一个文本文件，包含一系列指令，每条指令对应镜像的一个层。

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

三条基本规则：

1. **指令按顺序执行**，每条 `RUN`、`COPY`、`ADD` 等产生新层。
2. **只有 `FROM` 能开始一个构建阶段**，一个 Dockerfile 可以有多个 `FROM`。
3. **只有元数据指令不产生新层**：`LABEL`、`ENV`、`ARG`、`WORKDIR`、`USER`、`EXPOSE`、`STOPSIGNAL`、`SHELL`、`ONBUILD`。

### 指令的两种形式

```dockerfile
RUN echo "hello"                          # shell 形式
RUN ["/bin/sh", "-c", "echo hello"]        # exec 形式
```

- **shell 形式**：走容器的默认 shell（Linux 为 `/bin/sh -c`），支持环境变量展开、管道、重定向。
- **exec 形式**：直接 exec，不经 shell，**不展开环境变量**、不支持管道重定向。

```dockerfile
# 这两条不等价
RUN echo "$HOME"                          # 展开为宿主的值
RUN ["/bin/sh", "-c", "echo $HOME"]        # 同样展开
RUN ["/bin/echo", "$HOME"]                 # 字面量 $HOME
```

`CMD` / `ENTRYPOINT` / `RUN` / `SHELL` 都区分这两种形式。

### 续行与注释

```dockerfile
# 单行注释
RUN echo "one" \
    && echo "two"        # 反斜杠续行

# heredoc（需要 # syntax=docker/dockerfile:1）
RUN <<EOF
apt-get update
apt-get install -y curl
EOF
```

### 转义字符

```dockerfile
# syntax=docker/dockerfile:1
# escape=\
RUN echo "hello \ world"
```

`escape` 指令必须是 Dockerfile 的**第一行**（可先有 `# syntax=` 注释行）。

---

## 二、指令速查表

官方 reference 共 17 条指令（含 `MAINTAINER`、`EOF` 等历史项）：

| 指令 | 产生新层 | 作用 |
|------|:-------:|------|
| `FROM` | 是 | 起始阶段，设置基础镜像 |
| `RUN` | 是 | 执行命令 |
| `COPY` | 是 | 复制文件 |
| `ADD` | 是 | 复制文件（额外支持 URL / 自动解包） |
| `CMD` | 否 | 容器默认命令 |
| `ENTRYPOINT` | 否 | 容器固定入口 |
| `ENV` | 否 | 设置环境变量 |
| `ARG` | 否 | 构建期变量 |
| `LABEL` | 否 | 镜像元数据 |
| `EXPOSE` | 否 | 声明端口（**不发布端口**） |
| `USER` | 否 | 切换运行用户 |
| `WORKDIR` | 否 | 设置工作目录 |
| `VOLUME` | 否 | 声明挂载点 |
| `HEALTHCHECK` | 否 | 健康检查 |
| `STOPSIGNAL` | 否 | 停止信号 |
| `SHELL` | 否 | 覆盖默认 shell |
| `ONBUILD` | 否 | 下游构建时触发的指令 |

---

## 三、FROM 与多阶段构建

```dockerfile
FROM [--platform=<platform>] <image>[:<tag>] [AS <name>]
FROM [--platform=<platform>] <image>[@<digest>] [AS <name>]
```

- `ARG` 是**唯一允许出现在 `FROM` 之前**的指令。
- `FROM` 可出现多次，创建多个阶段。
- `--platform` 指定目标平台，常用于跨架构构建。
- `AS <name>` 给阶段命名，供 `COPY --from=<name>` 引用。

### 多阶段构建

把构建步骤和运行产物分开，最终镜像只含运行所需文件：

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/app ./cmd/app

FROM alpine:3.21
RUN apk add --no-cache ca-certificates && adduser -D app
COPY --from=builder /out/app /usr/local/bin/app
USER app
ENTRYPOINT ["/usr/local/bin/app"]
```

好处：

- 最终镜像不含编译器、源码、依赖缓存
- 可并行构建不同阶段
- 公共阶段只构建一次

### 指定构建目标

```dockerfile
FROM node:22 AS deps
FROM node:22 AS build
FROM node:22 AS test
FROM node:22-slim AS final
```

```bash
docker build --target build -t app:build .
```

### 复制其他阶段 / 外部镜像

```dockerfile
COPY --from=builder /out/app /usr/local/bin/app      # 同文件内的其他阶段
COPY --from=nginx:latest /etc/nginx/nginx.conf /etc/nginx/nginx.conf   # 外部镜像
COPY --from=builder /app /app                         # 复制整个目录
```

---

## 四、ARG 与 ENV

### ARG（构建期变量）

```dockerfile
ARG VERSION=1.0
ARG DEBUG=false
ARG API_URL
```

```bash
docker build --build-arg VERSION=2.0 --build-arg API_URL=https://api.example.com -t app .
```

- **不会嵌入镜像**，最终容器里不存在。
- 会作为环境变量传给后续所有 `RUN`。
- 可在 `FROM`、`ENV`、`WORKDIR` 等指令中用 `${VAR}` / `$VAR` 引用。

> **不要用 ARG 传密钥**。构建参数在 `docker history` 里可见，官方明确不推荐用于密码、API token。

### ENV（运行时环境变量）

```dockerfile
ENV MY_NAME="John Doe"
ENV MY_DOG=Rex\ The\ Dog
ENV A=1 B=2 C=3        # 一行设置多个
```

- 嵌入镜像，容器运行时可见。
- 可在后续指令中引用，也可用 `${VAR:-default}` 形式设默认值。

### ARG 与 FROM 的交互

`FROM` 中引用 ARG 时，ARG 必须声明在**第一个 `FROM` 之前**：

```dockerfile
ARG CODE_VERSION=latest
FROM base:${CODE_VERSION}
CMD ["code", "--version"]
```

**`FROM` 之后的 ARG 不参与 `FROM` 行的解析**，这是常见困惑点。

### ENV vs ARG 优先级

运行时环境变量覆盖 `ENV`：

```bash
docker run -e DEBUG=true app
```

构建期 `ARG` 覆盖 `ENV`（同名时）：

```dockerfile
ENV DEBUG=false
ARG DEBUG=true
RUN echo $DEBUG    # 输出 true
```

### 取默认值

```dockerfile
ARG PORT=8080
ENV APP_PORT=${PORT}
```

---

## 五、COPY 与 ADD

### COPY

```dockerfile
COPY [OPTIONS] <src> ... <dest>
COPY [OPTIONS] ["<src>", ... "<dest>"]
```

| 选项 | 最低版本 | 说明 |
|------|:-------:|------|
| `--from` | | 从其他阶段或镜像复制 |
| `--chmod` | 1.2 | 设置权限（八进制） |
| `--chown` | | 设置属主（`user:group`） |
| `--link` | 1.4 | 独立层，不依赖前一层 |
| `--parents` | 1.20 | 保留源目录结构 |
| `--exclude` | 1.19 | 排除匹配模式的文件 |

```dockerfile
COPY . .
COPY package*.json ./
COPY --chown=1000:1000 ./app /app
COPY --from=builder /out/app /usr/local/bin/app
COPY --exclude="*.log" ./src /src
```

`COPY` 的源路径是相对**构建上下文**的，不能超出上下文目录。

### ADD

```dockerfile
ADD [OPTIONS] <src> ... <dest>
```

| 选项 | 最低版本 |
|------|:-------:|
| `--keep-git-dir` | 1.1 |
| `--checksum` | 1.6 |
| `--chmod` | 1.2 |
| `--chown` | |
| `--link` | 1.4 |
| `--unpack` | 1.17 |

`ADD` 比 `COPY` 多了两个能力：

1. **自动解包**本地 tar / zip / gzip 等压缩包（`--unpack` 可显式指定）。
2. **从 URL 下载**文件。

> **优先用 `COPY`**。`ADD` 的自动解包和 URL 下载行为容易出意外（解压路径穿越、下载失败不易排查），官方也建议只在确需时用。

```dockerfile
ADD https://example.com/app.tar.gz /tmp/
ADD archive.tar.gz /opt/          # 自动解包
```

### 目录复制语义

```dockerfile
COPY dir /abs/          # 复制 dir 的**内容**到 /abs/
COPY dir /abs/sub/      # 复制成 /abs/sub/dir
COPY . /app             # 把上下文内容拷到 /app
```

---

## 六、RUN、CMD 与 ENTRYPOINT

### RUN

```dockerfile
RUN [OPTIONS] <command> ...
RUN [OPTIONS] [ "<command>", ... ]
```

常用选项：

| 选项 | 说明 |
|------|------|
| `--mount` | 挂载类型（bind / tmpfs / secret / ssh） |
| `--network` | 构建时的网络模式 |
| `--security` | 权限设置（`insecure` / `sandbox`） |
| `--add-host` | 添加主机名解析 |
| `--no-cache` | 不用缓存（`RUN` 层不受影响） |

```dockerfile
RUN --mount=type=cache,target=/root/.cache/go-build go build ./...
RUN --mount=type=secret,id=aws_cred \
    - AWS_ACCESS_KEY_ID=$(cat /run/secrets/aws_cred) \
    aws s3 cp ...
RUN --mount=type=ssh ssh-keyscan github.com >> /etc/ssh/known_hosts
```

**每条 `RUN` 产生一层**，所以要合并成一条并清理临时文件：

```dockerfile
# 不好：两层，且第一层留了包缓存
RUN apt-get update
RUN apt-get install -y curl

# 好：一层，缓存清理掉
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

### CMD

```dockerfile
CMD ["executable","param1","param2"]      # exec 形式
CMD ["param1","param2"]                   # exec 形式，作为 ENTRYPOINT 的默认参数
CMD command param1 param2                 # shell 形式
```

- 一个 Dockerfile **只能有一条 `CMD`**，写多条只有最后一条生效。
- 提供默认值，可被 `docker run <image> <cmd>` 覆盖。

### ENTRYPOINT

```dockerfile
ENTRYPOINT ["executable", "param1", "param2"]
```

- 定义容器的固定入口。
- `docker run` 传入的命令会**追加**到 exec 形式的 `ENTRYPOINT` 之后。

### CMD 与 ENTRYPOINT 的组合

| ENTRYPOINT | CMD | `docker run image args` 实际执行 |
|-----------|-----|--------------------------------|
| 无 | `["echo","hi"]` | `echo hi args` |
| `["echo"]` | `["hi"]` | `echo hi args` |
| `["echo"]` | 无 | `echo args` |
| `["echo"]` | `["hi"]`，shell 形式 | `echo hi`（shell 形式 CMD 不追加参数） |

推荐用 exec 形式 + `CMD` 传默认参数：

```dockerfile
ENTRYPOINT ["/usr/local/bin/app"]
CMD ["--config", "/etc/app/config.yaml"]
```

### 陷阱

`ENTRYPOINT` + shell 形式 `CMD` 时，`docker run` 传的参数会被丢弃：

```dockerfile
ENTRYPOINT echo hello
CMD world
# docker run image foo -> 输出 "hello"，foo 丢失
```

改成 exec 形式即可正确追加。

---

## 七、USER、WORKDIR、VOLUME

### USER

```dockerfile
USER <user>[:<group>]
USER <UID>[:<GID>]
```

- 影响后续 `RUN` 以及运行时的 `ENTRYPOINT` / `CMD`。
- **指定 group 时只保留该 group 成员身份**，其他组会被忽略。
- **用户没有主组时，镜像会以 `root` 组运行**（官方警告）。
- Windows 上用户必须先创建（`net user`）。

```dockerfile
RUN adduser -D appuser
USER appuser
```

### WORKDIR

```dockerfile
WORKDIR /path/to/workdir
```

- 影响后续 `RUN`、`CMD`、`ENTRYPOINT`、`COPY`、`ADD`。
- 目录不存在会自动创建。
- 相对路径基于上一个 `WORKDIR`：

```dockerfile
WORKDIR /a
WORKDIR b
WORKDIR c
RUN pwd          # 输出 /a/b/c
```

- 可解析 `ENV` 设置的变量（**不能解析 `ARG`**）。

### VOLUME

```dockerfile
VOLUME ["/data"]
VOLUME /var/log
VOLUME /var/log /var/db
```

- 创建挂载点，标记该路径由外部卷挂载。
- `docker run` 会用基础镜像中该位置**已有的数据**初始化新卷。
- 镜像中 `VOLUME` 声明的路径，后续 `docker run` 即使不指定 `-v` 也会自动创建匿名卷。

> 匿名卷在 `docker rm` 后残留（除非用 `--rm`），容易堆积。生产镜像慎用 `VOLUME`。

---

## 八、HEALTHCHECK、STOPSIGNAL、SHELL

### HEALTHCHECK

```dockerfile
HEALTHCHECK [OPTIONS] CMD command
HEALTHCHECK NONE
```

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/ || exit 1
```

| 选项 | 说明 |
|------|------|
| `--interval` | 两次检查间隔，默认 30s |
| `--timeout` | 单次检查超时，默认 30s |
| `--start-period` | 启动宽限期，默认 0s |
| `--start-interval` | 宽限期内检查间隔（需 2.20.2+） |
| `--retries` | 连续失败几次判定为 unhealthy，默认 3 |

状态流转：`starting` →（通过）`healthy` /（连续失败达阈值）`unhealthy`。

### STOPSIGNAL

```dockerfile
STOPSIGNAL SIGKILL
STOPSIGNAL 9
```

- 设置 `docker stop` 发送的信号，默认 `SIGTERM`。
- **不影响 Ctrl+C**（键盘快捷键直接发 `SIGINT`）。
- 可用 `docker run --stop-signal` 逐容器覆盖。

### SHELL

```dockerfile
SHELL ["/bin/bash", "-c"]
```

- 覆盖 shell 形式指令使用的默认 shell。
- Linux 默认 `["/bin/sh", "-c"]`，Windows 默认 `["cmd", "/S", "/C"]`。
- **必须用 JSON 形式书写**。
- 可出现多次，后者覆盖前者，影响其后所有指令。

```dockerfile
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN curl ... | grep ...
```

---

## 九、构建命令与缓存

### docker build 参数（27.3.1 实测）

以下是 `docker build` **实际输出**的全部参数（legacy builder）：

| 参数 | 说明 |
|------|------|
| `-t, --tag` | 镜像名与标签 |
| `-f, --file` | 指定 Dockerfile 路径 |
| `--build-arg` | 设置构建参数 |
| `--target` | 指定构建到的阶段 |
| `--platform` | 目标平台 |
| `--no-cache` | 不用缓存 |
| `--pull` | 总是尝试拉取更新的基础镜像 |
| `-q, --quiet` | 只输出镜像 ID |
| `--label` | 设置镜像标签 |
| `--network` | 构建时的网络 |
| `--cache-from` | 指定缓存来源镜像 |
| `--build-context` | 附加构建上下文（buildx） |
| `-m, --memory` / `--memory-swap` | 构建容器资源限制 |
| `--security-opt` | 构建时的安全选项 |
| `--shm-size` | `/dev/shm` 大小 |
| `--cpuset-cpus` / `--cpuset-mems` | CPU / 内存绑定 |
| `--cgroup-parent` | 父 cgroup |
| `--isolation` | 隔离技术 |
| `--compress` | gzip 压缩构建上下文 |
| `--force-rm` / `--rm` | 清理中间容器 |
| `--disable-content-trust` | 跳过镜像校验（默认已跳过） |
| `--iidfile` | 把镜像 ID 写入文件 |
| `--ulimit` | ulimit 选项 |

> **Docker 27.x 起 `docker build` 默认走 legacy builder 并提示已废弃**，新版推荐装 buildx 插件（`docker buildx build`）。未装 buildx 时 `docker buildx` 直接报 "not a docker command"。

> **注意**：`--secret`、`--ssh`、`--check`、`--provenance`、`--sbom` 这几个参数 **`docker build` 没有**，只有 `docker compose build` 和 `docker buildx build` 有：
>
> ```bash
> docker compose build --secret id=npmrc,src=$HOME/.npmrc .
> docker buildx build --check .
> ```
>
> 27.3.1 实测 `docker build --help` 的完整参数列表：
>
> ```
> --add-host  --build-arg  --cache-from  -c/--cpu-shares  --cgroup-parent
> --compress  --cpu-period  --cpu-quota  --cpuset-cpus  --cpuset-mems
> --disable-content-trust  -f/--file  --force-rm  --iidfile  --isolation
> --label  -m/--memory  --memory-swap  --network  --no-cache  --platform
> --pull  -q/--quiet  --rm  --security-opt  --shm-size  --squash
> -t/--tag  --target  --ulimit
> ```

### 缓存规则

- Docker 逐条执行指令，**每条指令单独查缓存**。
- 命中条件：指令文本相同 **且** 上一层的缓存 ID 相同。
- `RUN`、`COPY`、`ADD` 会产生层；其余指令只改元数据，不影响缓存判定。
- `COPY` / `ADD` 的缓存还取决于**被复制文件的元数据**（mtime、权限、大小、内容），内容变则缓存失效。
- 任何 `ARG` / `ENV` 变化会让**其后所有层**缓存失效。

**排序多行参数**可提高缓存命中率：

```dockerfile
# 好：依赖文件先装，源码变动不影响依赖层
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

```dockerfile
# 差：源码一改就全量重装依赖
COPY . .
RUN npm ci
```

---

## 十、.dockerignore

语法与 `.gitignore` 类似，用于排除与构建无关的文件，减少上下文体积并避免泄密。

```plaintext
# 注释
.git
.gitignore
node_modules
**/__pycache__
*.md
!README.md
.env
*.log
Dockerfile*
docker-compose*.yml
```

要点：

- 支持 `**` 递归匹配、`!` 取反。
- 排除 `Dockerfile` 和 `.dockerignore` 本身是常见做法（防止它们进入镜像）。
- **`.env` 一定要排除** —— 否则密钥会进镜像层。

---

## 十一、最佳实践

官方 best-practices 文档给出的 12 条：

1. **使用多阶段构建** —— 减小最终镜像，构建与产物分离
2. **选择合适的基础镜像** —— 选可信的、小的、及时更新的
3. **经常重建镜像** —— 基础镜像更新频繁，不要长期不重建
4. **用 .dockerignore 排除** —— 排除 `.git`、依赖目录等
5. **使用临时容器** —— 不要在同一镜像里既构建又运行
6. **不安装不必要的包** —— 减小攻击面
7. **解耦应用** —— 一个容器一个职责
8. **多行参数排序** —— 提高缓存命中率
9. **利用构建缓存** —— 层顺序合理
10. **固定基础镜像版本** —— tag 可变
11. **在 CI 中构建和测试镜像**
12. **Dockerfile 指令** —— 参考指令参考表

### 固定基础镜像 digest

tag 是可变的：发布者可以把 `3.21` tag 指向新镜像。写 `FROM alpine:3.21`，三个月后重建可能拿到 `3.21.4`，构建不可复现。

用 digest 锁定：

```dockerfile
FROM alpine:3.21@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c
```

即使发布者更新了 tag，构建仍使用锁定版本。代价是手动查 digest 麻烦，且放弃了自动安全更新。

### 安全基线

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
RUN apk add --no-cache dumb-init && \
    addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
```

要点：非 root 运行、只装运行时依赖、固定版本、多阶段、用 `dumb-init` 处理僵尸进程。

---

## 十二、排错

### 构建慢 / 缓存不命中

```bash
docker build --progress=plain -t app .     # 看每层耗时和缓存命中情况
docker build --no-cache -t app .           # 排除缓存干扰
docker builder prune                      # 清理构建缓存
```

`--progress=plain` 输出可读性最好，适合 CI。

### 镜像太大

```bash
docker history app:latest            # 看每层大小
docker image ls                      # 看总体积
```

常见原因：基础镜像太大、没删包缓存、把源码和依赖全 COPY 进去、没有多阶段构建。

### 构建时拿不到密钥

**不要用 `ARG` 传密码**。用 build secret：

```dockerfile
RUN --mount=type=secret,id=npmrc \
    NPM_CONFIG_USERCONFIG=/run/secrets/npmrc \
    npm ci
```

```bash
# --secret 是 buildx / docker compose build 的参数，legacy docker build 没有
docker buildx build --secret id=npmrc,src=$HOME/.npmrc -t app .
docker compose build --secret id=npmrc,src=$HOME/.npmrc .
```

密钥只在该条 `RUN` 内可见，不进镜像层。

### 容器起不来

```bash
docker run --rm -it --entrypoint sh app    # 覆盖入口，进容器排查
docker logs <容器>
docker inspect <容器> --format '{{.State.ExitCode}}'
docker inspect <容器> --format '{{.State.Error}}'
```

### 构建时网络不通

```bash
docker build --network=host -t app .       # 用宿主网络
```

### Dockerfile 语法检查

```bash
# --check 只有 buildx / docker compose build 有，legacy docker build 没有
docker buildx build --check -t app .        # 只校验配置不构建
docker compose build --check .               # 同上
```

### 上下文太大

```bash
docker build -t app . 2>&1 | grep "transferring context"
```

上下文大说明 `.dockerignore` 没配好。

---

## 十三、速查表

| 目的 | 写法 |
|------|------|
| 基础镜像 | `FROM node:22-alpine` |
| 固定 digest | `FROM alpine:3.21@sha256:...` |
| 命名阶段 | `FROM node:22 AS builder` |
| 指定目标阶段构建 | `docker build --target build -t app .` |
| 安装包并清缓存 | `RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*` |
| 复制构建产物 | `COPY --from=builder /out/app /usr/local/bin/app` |
| 设置属主 | `COPY --chown=1000:1000 ./app /app` |
| 构建参数 | `ARG V=1` + `docker build --build-arg V=2 .` |
| 运行时变量 | `ENV V=1` |
| 变量默认值 | `ENV PORT=${PORT:-8080}` |
| 切非 root | `USER app` |
| 工作目录 | `WORKDIR /app` |
| 声明端口 | `EXPOSE 3000` |
| 健康检查 | `HEALTHCHECK CMD curl -f http://localhost/ \|\| exit 1` |
| 固定入口 | `ENTRYPOINT ["/app"]` |
| 默认参数 | `CMD ["--config", "/etc/app.yaml"]` |
| 停止信号 | `STOPSIGNAL SIGQUIT` |
| 覆盖 shell | `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` |
| 构建密钥挂载 | `RUN --mount=type=secret,id=aws ...`（配 `buildx build --secret`） |
| 缓存挂载 | `RUN --mount=type=cache,target=/root/.cache/go-build ...` |
| 排除文件 | `.dockerignore` 里写 `node_modules` |
| 详细构建输出 | `docker build --progress=plain -t app .` |
| 只校验不构建 | `docker buildx build --check -t app .` |
| 看层大小 | `docker history app:latest` |

---

## 相关

- [[Docker 常用命令]] — Docker 基础命令
- [[docker-compose 使用说明]] — Compose 专题
- [[Docker 存储与网络]] — 存储卷与网络驱动
- 官方文档：https://docs.docker.com/reference/dockerfile/
