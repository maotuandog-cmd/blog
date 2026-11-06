# Docker Compose 使用说明

> 基于 Docker 官方文档（docs.docker.com/compose）与 Compose Specification 整理。
> Compose 是 CLI **插件**（v2），命令是 `docker compose`（有空格），不是旧版独立二进制 `docker-compose`。
> 旧版 2.x / 3.x 文件格式已合并为 **Compose Specification**，Compose v1.27.0+ 均适用。
> 相关：[[Docker 常用命令]] · [[Dockerfile 编写指南]] · [[Docker 存储与网络]] · [[Docker 网络实现原理]]

---

## 目录

1. [核心概念](#一核心概念)
2. [Compose 文件结构](#二compose-文件结构)
3. [服务配置详解](#三服务配置详解)
4. [变量与插值](#四变量与插值)
5. [多文件与合并](#五多文件与合并)
6. [命令行命令](#六命令行命令)
7. [环境变量](#七环境变量)
8. [Profiles 场景隔离](#八profiles-场景隔离)
9. [Secrets 与 Configs](#九secrets-与-configs)
10. [Deploy 部署配置](#十deploy-部署配置)
11. [常见场景模板](#十一常见场景模板)
12. [排错](#十二排错)
13. [速查表](#十三速查表)

---

## 一、核心概念

Compose 用一个 YAML 文件定义并运行多容器应用。一条命令即可创建并启动全部服务。

Compose 管的东西：

- **services**：服务（容器）
- **networks**：网络
- **volumes**：卷
- **configs** / **secrets**：配置与密钥
- **deploy**：部署约束（部分平台生效）

工作原理：Compose 把 Compose 文件解析成应用模型 → 通过 Docker Engine API 创建容器/网络/卷 → 保持容器运行状态。

三个关键点：

1. **服务间用服务名互访**。同一个 Compose 项目下，服务名就是 DNS 名（`db:5432`），前提是连在同一个网络。
2. **默认网络是隔离的**。不显式声明 `networks` 时，Compose 创建隐式 `default` 网络；只有同在这个网络的服务才能互通。
3. **`depends_on` 只管启动顺序**。短语法只保证"已启动"，不保证"已就绪"；要等健康检查必须用长语法 `condition: service_healthy`。

---

## 二、Compose 文件结构

### 2.1 完整示例

```yaml
name: myapp                 # 项目名（version 已废弃）

services:
  web:
    image: nginx:stable
    ports:
      - "8080:80"
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - front
    environment:
      DB_HOST: db
    env_file:
      - .env
    volumes:
      - webdata:/usr/share/nginx/html
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: example
      POSTGRES_DB: exampledb
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U example"]
      interval: 10s
      retries: 5
    networks:
      - back

networks:
  front:
  back:

volumes:
  webdata:
  dbdata:

secrets:
  db_password:
    file: ./db_password.txt
```

### 2.2 文件名与查找规则

不加 `-f` 时，Compose 从当前目录**逐级向上**查找，找到第一个即停：

```
compose.yaml      ← 优先（Compose Spec 规范名）
compose.yml
docker-compose.yaml
docker-compose.yml
```

文件名建议用 `compose.yaml`（当前规范名）。

### 2.3 `version` 已废弃

```yaml
version: "3.9"    # ← 已废弃，会产生 obsolete 警告
```

`version` 只为向后兼容保留，**只具有信息性**。Compose 始终用最新 schema 校验文件，与 `version` 字段无关。直接删掉。

### 2.4 `name` 顶层元素

```yaml
name: myapp
services:
  foo:
    image: busybox
    command: echo "I'm running ${COMPOSE_PROJECT_NAME}"
```

`name` 定义项目名，会作为 `COMPOSE_PROJECT_NAME` 暴露给插值。

项目名会作为容器名前缀：`myapp-db-1`、`myapp-web-1`。

**项目名优先级（高到低）**：

1. `-p` 命令行参数
2. `COMPOSE_PROJECT_NAME` 环境变量
3. Compose 文件顶层的 `name:`
4. 项目目录名（第一个 `-f` 文件所在目录）
5. 当前目录名

项目名只允许小写字母、数字、连字符、下划线，且必须以小写字母或数字开头。

---

## 三、服务配置详解

`services` 下共 **92 个**可用属性，下面按用途分组列出常用的。

### 3.1 镜像与构建

```yaml
services:
  app:
    image: nginx:stable          # 直接用镜像
    build: .                     # 或从 Dockerfile 构建
    pull_policy: missing         # always | missing | never | build
    platform: linux/amd64        # 指定架构
```

`build` 完整配置见 [Build Specification](#build-段)。

### 3.2 端口 `ports`

**短语法**：`[HOST:]CONTAINER[/PROTOCOL]`

```yaml
ports:
  - "3000"                      # 仅容器端口，宿主机随机分配
  - "8000:8000"                 # 宿主机 8000 -> 容器 8000
  - "9090-9091:8080-8081"       # 端口范围
  - "127.0.0.1:8001:8001"       # 绑定指定宿主机 IP
  - "6060:6060/udp"             # 指定协议
  - "[::1]:6001:6001"            # IPv6，方括号包裹
```

**长语法**：

```yaml
ports:
  - target: 80
    published: "8080"
    protocol: tcp
    mode: host
```

> **端口必须加引号**。`8000:8000` 不加引号会被 YAML 解析成 sexagesimal 浮点数（base-60），是经典坑。

> **安全提示**：不指定宿主机 IP 时 Docker 绑定 `0.0.0.0`，绕过主机防火墙规则。宿主机有公网 IP 时容器会直接暴露到公网。只给内部服务用时请写 `127.0.0.1:8080:80`。

> `network_mode: host` 不能与 `ports` 同用，会直接运行时报错。

### 3.3 卷 `volumes`

**短语法**：

```yaml
volumes:
  - /host/path:/container/path        # 绑定挂载
  - named-volume:/container/path      # 命名卷
  - /host/path:/container/path:ro     # 只读
  - /host/path:/container/path:z      # SELinux 重标记
```

**长语法**（更可控）：

```yaml
volumes:
  - type: bind
    source: ./data
    target: /data
    read_only: true
    bind:
      propagation: rslave
      create_host_path: true
  - type: volume
    source: dbdata
    target: /var/lib/postgresql/data
    volume:
      nocopy: false
  - type: tmpfs
    target: /tmp
    tmpfs:
      size: 100m
```

> 宿主目录不存在时 Docker 会**自动创建为 root 属主的目录**，这是权限报错的常见根源。先 `mkdir -p` 并设置好属主。

### 3.4 环境变量 `environment` 与 `env_file`

```yaml
environment:
  RACK_ENV: development       # map 语法
  SHOW: "true"
  USER_INPUT:                 # 只给键不给值 → 从宿主环境取

# 数组语法
environment:
  - RACK_ENV=development
  - SHOW=true
  - USER_INPUT
```

```yaml
env_file:
  - .env
  - path: ./optional.env
    required: false           # 文件不存在时静默跳过（Compose 2.20.0+）
  - path: ./raw.env
    format: raw               # 不做插值，原样传递（含引号和 $）
```

`.env` 文件格式规则：

- `#` 开头为注释，空行忽略
- 分隔符可以是 `=` 或 `:`
- 值两侧空格忽略：`VAR=VAL` → `VAL`
- 不加引号和双引号的值会做插值；单引号 `'` 包裹的不插值
- 相对路径从 Compose 文件的父目录解析；用绝对路径会有可移植性警告

### 3.5 依赖 `depends_on`

**短语法**：

```yaml
depends_on:
  - db
  - redis
```

只保证启动顺序（db、redis 先创建，web 后创建；停止时反序）。**不等待健康状态**。

**长语法**：

```yaml
depends_on:
  db:
    condition: service_healthy          # 等健康检查通过
    restart: true                      # 依赖更新后重启本服务（2.17.0+）
    required: false                    # 依赖不可用时只警告不报错（2.20.0+）
  redis:
    condition: service_started
  migrate:
    condition: service_completed_successfully   # 等一次性任务成功退出
```

`condition` 三个取值：

| 值 | 含义 |
|----|------|
| `service_started` | 依赖容器已启动（短语法等价） |
| `service_healthy` | 依赖容器健康检查通过 |
| `service_completed_successfully` | 依赖容器成功退出（退出码 0），适合迁移任务 |

### 3.6 健康检查 `healthcheck`

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
  start_interval: 5s      # 2.20.2+
```

`test` 三种形式：

```yaml
test: ["CMD", "curl", "-f", "http://localhost"]              # exec 形式，不走 shell
test: ["CMD-SHELL", "curl -f http://localhost || exit 1"]   # 走容器默认 shell
test: curl -f https://localhost || exit 1                   # 字符串等价于 CMD-SHELL
```

禁用健康检查：

```yaml
healthcheck:
  disable: true        # 禁用镜像自带的 HEALTHCHECK
```

### 3.7 命令与入口 `command` / `entrypoint`

```yaml
command: bundle exec thin -p 3000      # 覆盖 Dockerfile 的 CMD
entrypoint: /bin/sh -c 'echo "hello $$HOSTNAME"'
```

- `command: null` → 用镜像默认命令
- `command: []` 或 `''` → 覆盖为空
- **与 Dockerfile `CMD` 不同**：`command` 不自动在 `SHELL` 上下文里执行。需要 shell 特性（变量展开等）必须显式用 `/bin/sh -c`。

```yaml
command: /bin/sh -c 'echo "hello $$HOSTNAME"'
```

### 3.8 网络 `networks`

```yaml
services:
  proxy:
    networks:
      - front
  app:
    networks:
      - front
      - back
  db:
    networks:
      - back

networks:
  front:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.host_binding_ipv4: "127.0.0.1"
  back:
    driver: custom-driver
```

这个例子中 `proxy` 与 `db` **互相隔离**（没有共同网络），只有 `app` 两边都能通。

顶层 `networks` 支持属性：`driver` `driver_opts` `attachable` `external` `labels` `name` `ipam`。

### 3.9 资源限制

```yaml
services:
  app:
    mem_limit: 512m
    mem_reservation: 128m
    cpus: 1.5
    cpuset: "0-3"
    cpu_shares: 512
    pids_limit: 100
    shm_size: 256m
    tmpfs:
      - /tmp:size=100m
    ulimits:
      nofile:
        soft: 1024
        hard: 2048
```

`deploy.resources` 是另一套（面向 Swarm/K8s 的平台侧约束），见 [Deploy 段](#十deploy-部署配置)。

### 3.10 安全相关

```yaml
services:
  app:
    privileged: false
    read_only: true
    cap_add:
      - NET_BIND_SERVICE
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    user: "1000:1000"
    userns_mode: host
    group_add:
      - docker
```

### 3.11 日志 `logging`

```yaml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
        compress: "true"
```

不限制日志大小是磁盘被撑爆的常见原因。

### 3.12 其他常用属性速览

| 属性 | 说明 |
|------|------|
| `container_name` | 固定容器名。**指定后该服务不能 scale 到多副本** |
| `restart` | `no` `always` `on-failure` `unless-stopped` |
| `stop_grace_period` | 优雅停止等待时长，默认 10s |
| `stop_signal` | 停止信号，默认 SIGTERM |
| `working_dir` | 容器内工作目录 |
| `user` | 运行用户 |
| `hostname` / `domainname` | 主机名 / 域名 |
| `expose` | 仅暴露端口给同网络服务，不映射到宿主机 |
| `dns` / `dns_search` / `dns_opt` | DNS 配置 |
| `extra_hosts` | 额外主机名解析 |
| `labels` | 容器标签（数组或 map 两种写法） |
| `label_file` | 从文件读标签 |
| `external_links` / `links` | 链接外部容器（遗留特性，新项目别用） |
| `gpus` | GPU 设备 |
| `init` | 加 init 进程回收僵尸进程 |
| `isolation` | 隔离技术，默认 `default` |
| `tty` / `stdin_open` | 分配伪终端 / 保持 stdin |
| `oom_kill_disable` / `oom_score_adj` | OOM 行为调整 |
| `scale` | 服务副本数 |
| `develop` | 开发期热更新配置（`watch` 配合） |
| `post_start` / `pre_stop` | 容器启动后 / 停止前钩子 |
| `models` / `provider` | 模型（AI）服务配置 |
| `extends` / `include` | 复用其他文件的配置 |

---

## 四、变量与插值

### 4.1 插值语法

| 语法 | 含义 |
|------|------|
| `${VAR}` | 直接替换 |
| `${VAR:-default}` | 已设置且非空时用 VAR，否则用 default |
| `${VAR-default}` | 已设置时用 VAR（空字符串也算已设置），否则用 default |
| `${VAR:?error}` | 未设置或为空则报错退出 |
| `${VAR?error}` | 未设置则报错退出 |
| `${VAR:+replacement}` | 已设置且非空时用 replacement，否则为空 |
| `${VAR+replacement}` | 已设置时用 replacement，否则为空 |

可嵌套：`${VARIABLE:-${FOO:-default}}`

**不支持** shell 的其他扩展语法，如 `${VARIABLE/foo/bar}`。

### 4.2 转义字面量 `$`

```yaml
command: "$$VAR_NOT_INTERPOLATED_BY_COMPOSE"
```

`$$` 输出字面量 `$`，同时阻止 Compose 插值。

### 4.3 插值只作用于值，不作用于键

```yaml
services:
  foo:
    labels:
      "$VAR_NOT_INTERPOLATED_BY_COMPOSE": "BAR"    # 键不插值
    labels:
      - "$VAR_INTERPOLATED_BY_COMPOSE=BAR"          # 数组写法才插值
```

### 4.4 插值时机

插值在**每个文件的基础上**、**合并之前**进行。

### 4.5 变量来源与优先级

```
1. docker compose run -e          （命令行，最高）
2. environment / env_file 中的值来自 shell 或 .env 插值
3. environment 属性（Compose 文件内直接写死）
4. env_file 属性
5. 镜像的 ENV 指令
```

---

## 五、多文件与合并

### 5.1 指定多个文件

```bash
docker compose -f compose.yaml -f compose.admin.yaml up -d
docker compose -f compose.yaml -f compose.prod.yaml -f compose.local.yaml up
```

后一个文件覆盖并追加前一个。**所有路径相对于第一个 `-f` 文件**解析，可用 `--project-directory` 改变基准目录。

```bash
docker compose -f - up -d < compose.yaml   # 从 stdin 读，路径相对于当前目录
```

### 5.2 合并规则

**mapping**：按 key 合并，冲突取后者。

**sequence**：追加。

**例外（后者覆盖前者，不追加）**：`command`、`entrypoint`、`healthcheck.test`。

**唯一性资源**（按唯一键合并，不违反唯一性的追加）：

| 属性 | 唯一键 |
|------|--------|
| `volumes` | `target` |
| `secrets` | `target` |
| `configs` | `target` |
| `ports` | `{ip, target, published, protocol}` |

### 5.3 `!reset` 重置

```yaml
services:
  foo:
    ports: !reset null
```

用 `!reset` 覆盖文件里的值，把目标属性置为该类型的默认值或 `null`。需要提供有效值（会被忽略）。

### 5.4 `include` 与 `fragments`

```yaml
include:
  - path: ./compose-common.yaml
  - path: ./compose-db.yaml
    project_directory: ./db
```

把其他文件的定义引入当前模型。

`fragments` 提供可复用的服务片段（字段级合并），常用于复用日志配置、资源限制等。

### 5.5 `extends`

```yaml
services:
  app:
    extends:
      file: ./base.yaml
      service: web
```

继承另一个文件里某个服务的配置。

---

## 六、命令行命令

### 6.1 全局参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `-f, --file` | | Compose 配置文件（可多个） |
| `-p, --project-name` | | 项目名 |
| `--profile` | | 启用指定 profile（可多个） |
| `--env-file` | | 替代的环境文件 |
| `--project-directory` | 第一个 `-f` 文件所在目录 | 工作目录 |
| `--parallel` | `-1` | 最大并行度，-1 不限 |
| `--ansi` | `auto` | `never` / `always` / `auto` |
| `--progress` | `auto` | `auto` / `tty` / `plain` / `json` / `quiet` |
| `--dry-run` | | 只演练不执行 |
| `--compatibility` | | 向后兼容模式 |
| `--all-resources` | | 包含未被服务使用的资源 |

### 6.2 核心命令

**up** — 创建并启动

```bash
docker compose up -d                      # 后台启动
docker compose up -d --build              # 构建后启动
docker compose up -d web db               # 只启动指定服务
docker compose up --scale web=3           # 扩容到 3 个
docker compose up -d --no-deps web        # 不带依赖
docker compose up -d --remove-orphans     # 清理不在文件里的孤儿容器
docker compose up -d --force-recreate     # 强制重建
docker compose up -d --pull always        # 总是拉最新镜像
docker compose up -d --wait               # 等服务 running/healthy（隐含 detached）
docker compose up -d --wait-timeout 60   # 最多等 60 秒
docker compose up --abort-on-container-exit   # 任一容器退出则全部停止
```

`up` 常用参数：`--attach` `--no-attach` `--attach-dependencies` `--build` `--no-build` `--exit-code-from` `--no-start` `--no-recreate` `--quiet-build` `--quiet-pull` `--remove-orphans` `--scale` `--timestamps` `--no-log-prefix` `--no-color`。

**down** — 停止并删除

```bash
docker compose down                    # 删容器 + 网络
docker compose down -v                 # 同时删卷（数据丢失）
docker compose down --rmi all          # 同时删镜像
docker compose down --rmi local        # 只删无自定义 tag 的本地镜像
docker compose down --remove-orphans   # 删孤儿容器
```

> `down` 默认**不删匿名卷**，但匿名卷没有稳定名字，后续 `up` 不会自动挂载。需要持久化的数据用命名卷或绑定挂载。`external` 声明的网络和卷永不删除。

**其他常用命令**

```bash
docker compose ps                      # 状态
docker compose ps -a                   # 含已停止
docker compose ps --status running     # 按状态过滤
docker compose logs -f                 # 跟随日志
docker compose logs --tail 100 web     # 指定服务末尾 100 行
docker compose logs --since 42m web    # 相对时间
docker compose exec web bash           # 进入容器
docker compose exec -T web cmd         # 无 TTY（脚本用）
docker compose run --rm web python x.py # 一次性运行
docker compose run -e DEBUG=1 web cmd  # 带环境变量
docker compose build                   # 构建
docker compose build --no-cache
docker compose build --push            # 构建并推送
docker compose pull                    # 拉取镜像
docker compose push
docker compose restart                 # 重启
docker compose restart web
docker compose stop / start            # 停止 / 启动（保留容器）
docker compose kill
docker compose pause / unpause
docker compose rm -f                   # 删除停止的容器
docker compose scale web=3             # 调整副本数
docker compose config                  # 渲染最终配置（排错神器）
docker compose config --services       # 列出服务名
docker compose config --images         # 列出镜像
docker compose config --environment    # 打印插值用的环境
docker compose config --format json    # JSON 格式
docker compose watch                   # 热重载（配合 develop.watch）
docker compose cp web:/tmp/a .         # 拷文件
docker compose port web 80             # 查端口映射
docker compose top                     # 各服务进程
docker compose stats                   # 资源占用
docker compose events                  # 事件流
docker compose wait                    # 等服务退出并返回退出码
docker compose ls                      # 列出运行中的项目
docker compose version
```

### 6.3 `config` 是排错入口

`docker compose config` 会合并所有 `-f` 文件、解析变量、把短语法展开成规范格式 —— 输出就是**实际会提交给 Docker Engine 的数据模型**。配置不生效时先跑它。

```bash
docker compose config                    # 看最终配置
docker compose config --services         # 有哪些服务
docker compose config --images           # 用哪些镜像
docker compose config --environment      # 变量插值结果
docker compose config --profiles         # 有哪些 profile
docker compose config --no-interpolate   # 看原始未插值
docker compose config --quiet           # 只做语法校验（CI 用）
```

---

## 七、环境变量

### 7.1 预定义变量

| 变量 | 作用 |
|------|------|
| `COMPOSE_PROJECT_NAME` | 项目名 |
| `COMPOSE_FILE` | Compose 文件路径（可多个） |
| `COMPOSE_PROFILES` | 启用的 profile，逗号分隔 |
| `COMPOSE_ENV_FILES` | 环境文件路径 |
| `COMPOSE_DISABLE_ENV_FILE` | 禁用自动加载 `.env` |
| `COMPOSE_PATH_SEPARATOR` | 路径分隔符 |
| `COMPOSE_CONVERT_WINDOWS_PATHS` | Windows 路径转换 |
| `COMPOSE_IGNORE_ORPHANS` | 忽略孤儿容器 |
| `COMPOSE_REMOVE_ORPHANS` | 自动移除孤儿容器 |
| `COMPOSE_PARALLEL_LIMIT` | 并行上限 |
| `COMPOSE_ANSI` | ANSI 控制字符 |
| `COMPOSE_STATUS_STDOUT` | 状态输出到 stdout |
| `COMPOSE_MENU` | 交互快捷菜单 |
| `COMPOSE_EXPERIMENTAL` | 启用实验特性 |
| `COMPOSE_PROGRESS` | 进度输出格式 |

同时继承 Docker CLI 的 `DOCKER_HOST`、`DOCKER_CONTEXT` 等。

### 7.2 项目名优先级

```
1. -p 命令行参数
2. COMPOSE_PROJECT_NAME
3. Compose 文件顶层 name:
4. 项目目录名（第一个 -f 文件所在目录）
5. 当前目录名
```

---

## 八、Profiles 场景隔离

用 `profiles` 给服务打标签，按场景启用。

```yaml
services:
  frontend:
    image: frontend
    profiles: ["frontend"]

  phpmyadmin:
    image: phpmyadmin
    depends_on: [db]
    profiles: ["debug"]

  backend:
    image: backend        # 无 profiles → 总是启用

  db:
    image: mysql
```

```bash
docker compose up                        # 只启动 backend、db
docker compose --profile debug up        # 启动 db、backend、phpmyadmin
docker compose --profile frontend --profile debug up
COMPOSE_PROFILES=frontend,debug docker compose up
docker compose --profile "*" up          # 启用全部
```

要点：

- **核心服务不要加 `profiles`**，保证永远自动启动。
- 直接在命令行点名的服务**不需要**启用 profile 也会跑（连带其 `depends_on` 依赖），适合跑一次性工具。
- profile 名符合 `[a-zA-Z0-9][a-zA-Z0-9_.-]+`。

---

## 九、Secrets 与 Configs

### 9.1 Secrets

Secret 挂载到容器内 `/run/secrets/<name>`，**仅 Linux 容器支持**（Windows 容器只支持目录绑定挂载）。

```yaml
services:
  myapp:
    image: myapp:latest
    secrets:
      - my_secret
  db:
    image: mysql:latest
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
    secrets:
      - db_root_password
      - db_password

secrets:
  my_secret:
    file: ./my_secret.txt
  db_password:
    file: ./db_password.txt
  db_root_password:
    file: ./db_root_password.txt
  token:
    environment: "OAUTH_TOKEN"    # 从宿主环境变量取值（仅 Compose 支持，docker stack deploy 不支持）
```

长语法可控制挂载位置与权限：

```yaml
services:
  redis:
    secrets:
      - source: my_config
        target: /redis_config
        uid: "103"
        gid: "103"
        mode: 0440
```

### 9.2 Configs

Config 与 Secret 类似，但用于非敏感配置，同样需要显式授权。

```yaml
services:
  app:
    configs:
      - my_config

configs:
  my_config:
    file: ./my_config.txt
  external_cfg:
    external: true
```

`external: true` 表示资源已存在于平台，由 Compose 之外的生命周期管理；不存在则部署失败。

### 9.3 为什么用 Secret 而不是环境变量

环境变量对容器内所有进程可见，调试时容易被无意打印到日志。Secret 走文件系统权限控制，能精确到进程级别。

---

## 十、Deploy 部署配置

`deploy` 段面向 Swarm / Kubernetes 等平台。**普通 `docker compose up` 下大部分字段被忽略**，但 `replicas` 和 `resources` 会被 Compose 读取。

```yaml
services:
  frontend:
    image: example/webapp
    deploy:
      mode: replicated        # replicated | global | replicated-job | global-job
      replicas: 6
      endpoint_mode: vip      # vip | dnsrr
      labels:
        com.example.description: "web service"
      placement:
        constraints:
          - node.labels.disktype==ssd
        preferences:
          - spread: node.labels.zone
      resources:
        limits:
          cpus: '0.50'
          memory: 50M
          pids: 1
        reservations:
          cpus: '0.25'
          memory: 20M
```

`mode` 四种：

| 值 | 行为 |
|----|------|
| `replicated` | 维持 N 个副本（默认） |
| `global` | 每个节点恰好一个 |
| `replicated-job` | 执行 N 个任务直到成功退出 |
| `global-job` | 每个节点执行一个任务直到成功退出 |

`resources.limits` 是硬上限（超出即被限制/杀），`resources.reservations` 是保留（保证至少能给到）。

---

## 十一、常见场景模板

### 11.1 Web + 数据库

```yaml
services:
  web:
    image: nginx:stable
    ports: ["8080:80"]
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: example
      POSTGRES_PASSWORD: example
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U example"]
      interval: 10s
      retries: 5

volumes:
  pgdata:
```

### 11.2 带 Redis 缓存的完整栈

```yaml
services:
  app:
    image: myapp:latest
    environment:
      REDIS_HOST: redis
      DATABASE_URL: postgres://user:pass@db:5432/app
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3

  db:
    image: postgres:18
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

### 11.3 开发环境带热重载

```yaml
services:
  app:
    build: .
    develop:
      watch:
        - path: ./src
          action: sync
          target: /app/src
        - path: ./package.json
          action: rebuild
    volumes:
      - ./src:/app/src
    ports: ["3000:3000"]
```

```bash
docker compose watch
```

### 11.4 生产环境约束

```yaml
services:
  app:
    image: registry.example.com/app:1.0
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

### 11.5 一次性迁移任务

```yaml
services:
  migrate:
    image: myapp:latest
    command: python manage.py migrate
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  app:
    image: myapp:latest
    depends_on:
      migrate:
        condition: service_completed_successfully
```

### 11.6 生产用 secrets

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

---

## 十二、排错

### 12.1 配置不生效 / 变量不对

```bash
docker compose config                  # 看最终生效的配置
docker compose config --environment    # 看插值用的环境变量
docker compose config --services
```

`config` 输出与预期不符时，问题一定在文件合并或插值阶段。

### 12.2 服务起不来

```bash
docker compose ps -a                  # 看退出状态
docker compose logs --tail 100 <服务>
docker inspect <容器> --format '{{.State.ExitCode}}'
docker inspect <容器> --format '{{.State.Error}}'
```

退出码：`0` 正常 · `1` 应用报错 · `125` run 参数错 · `126` 命令不可执行 · `127` 命令找不到 · `137` SIGKILL（常见于 OOM）。

### 12.3 容器之间不通

```bash
docker compose exec app getent hosts db    # DNS 解析
docker compose exec app ping -c3 db
```

排查顺序：

1. 两个服务是否在同一个网络 —— `docker network inspect <项目>_default`
2. 是否用了 `network_mode: host` 或 `container_name`（后者禁用了 scale）
3. 端口映射不互通 —— 容器间互访用**容器端口**（如 `db:5432`），不是宿主映射端口
4. `depends_on` 只管顺序，不管就绪

### 12.4 孤儿容器

文件里删了服务但容器还在：

```bash
docker compose up -d --remove-orphans
docker compose down --remove-orphans
```

### 12.5 挂载权限问题

```bash
# 宿主目录不存在被自动创建成 root
mkdir -p /srv/data && chown 1000:1000 /srv/data

# SELinux 环境
volumes:
  - /srv/data:/data:z

# 镜像 USER 与目录属主不匹配
user: "1000:1000"
```

### 12.6 磁盘满

```bash
docker compose down --rmi all -v   # 慎用，删卷会丢数据
docker system df -v
```

日志不设上限是常见原因，务必配 `logging.options.max-size`。

### 12.7 端口冲突

```bash
docker compose ps
ss -lntp | grep 8080
```

### 12.8 排查用命令速查

```bash
docker compose --dry-run up -d      # 只演练，看会做什么
docker compose --profile "*" config # 看所有 profile 下的完整配置
docker compose ls                   # 有哪些项目在跑
docker compose top web              # 容器内进程
docker compose stats                # 资源占用
```

---

## 十三、速查表

| 目的 | 命令 |
|------|------|
| 后台启动 | `docker compose up -d` |
| 构建并启动 | `docker compose up -d --build` |
| 启动指定服务 | `docker compose up -d web db` |
| 扩容 | `docker compose up -d --scale web=3` |
| 等健康就绪 | `docker compose up -d --wait` |
| 清理孤儿容器 | `docker compose up -d --remove-orphans` |
| 停止并删除 | `docker compose down` |
| 停止并删卷 | `docker compose down -v` |
| 查看状态 | `docker compose ps` |
| 查看全部状态 | `docker compose ps -a` |
| 看日志 | `docker compose logs -f` |
| 看某服务日志 | `docker compose logs -f web` |
| 时间范围日志 | `docker compose logs --since 42m web` |
| 进入容器 | `docker compose exec web sh` |
| 一次性执行 | `docker compose run --rm web cmd` |
| 渲染最终配置 | `docker compose config` |
| 列出服务 | `docker compose config --services` |
| 构建 | `docker compose build` |
| 无缓存构建 | `docker compose build --no-cache` |
| 拉取镜像 | `docker compose pull` |
| 重启服务 | `docker compose restart web` |
| 启停（保留容器） | `docker compose stop` / `start` |
| 调整副本 | `docker compose scale web=3` |
| 删除停止的容器 | `docker compose rm -f` |
| 查端口映射 | `docker compose port web 80` |
| 拷文件 | `docker compose cp web:/tmp/a .` |
| 进程列表 | `docker compose top` |
| 资源占用 | `docker compose stats` |
| 热重载 | `docker compose watch` |
| 启用 profile | `docker compose --profile debug up` |
| 多文件合并 | `docker compose -f base.yaml -f prod.yaml up` |
| 项目列表 | `docker compose ls` |

---

## 相关

- [[Docker 常用命令]] — Docker 基础命令
- [[常用操作]] — 常用操作补充
- 官方文档：https://docs.docker.com/compose/
- Compose Specification：https://github.com/compose-spec/compose-spec
