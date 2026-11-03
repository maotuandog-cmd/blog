# DuckDB Quack 服务端搭建与客户端连接指南

> 最后更新：2026-08-27
> 适用版本：DuckDB v1.5.3+（推荐）/ v2.0 预览版

---

## 一、概述

**Quack** 是 DuckDB 在 v1.5.3（2026 年 5 月）开始内建的客户端-服务器协议，把 DuckDB 从纯嵌入式数据库变成了支持**并发多写**的网络服务。

**核心特性：**

- 基于 **HTTP/2 + Apache Arrow** 序列化（MIME 类型 `application/duckdb`）
- 默认端口 **9494**（致敬 1994 年发布的 Netscape Navigator）
- **可插拔认证**（默认共享 token，支持 LDAP/OAuth/文件 token 等）
- **可插拔授权**（支持每查询授权回调，可用 SQL 宏实现）
- 通过 **OCC（乐观并发控制）+ MVCC** 支持并发多写者

---

## 二、服务端搭建

### 2.1 最简启动（localhost）

在 DuckDB CLI 或 Python 中执行：

```sql
INSTALL quack FROM core_nightly;
LOAD quack;

CALL quack_serve('quack:localhost');
```

执行后返回三个关键值：

| 返回字段 | 含义 |
|---------|------|
| `listen_uri` | 实际监听地址 |
| `http_url` | HTTP 访问 URL |
| `auth_token` | 随机生成的共享密钥（每次启动不同） |

### 2.2 命名参数

`quack_serve()` 接受三个命名参数：

| 参数 | 作用 | 默认值 |
|------|------|--------|
| `token` | 认证 token；不传则自动随机生成 | 随机 |
| `allow_other_hostname` | 是否允许非 localhost 客户端连接 | `false` |
| `disable_ssl` | 强制关闭 SSL（仅本地调试用） | `false`（自动启用） |

**示例：允许外部连接 + 自定义 token**

```sql
CALL quack_serve(
    'quack:0.0.0.0:9494',
    token                => 'my-super-secret',
    allow_other_hostname => true
);
```

### 2.3 停止服务

```sql
CALL quack_stop('quack:localhost');
-- 或
CALL quack_stop('quack:0.0.0.0:9494');
```

### 2.4 生产环境 TLS 配置

Quack 本身**不实现自定义 TLS**，建议前面挂反向代理（nginx / Caddy）。

- localhost：默认走明文 HTTP
- 非 localhost：自动启用 HTTPS，所以直接暴露到公网时**必须**配合反代 + Let's Encrypt

**nginx 反代完整配置示例：**

```nginx
server {
    listen 443 ssl;
    server_name quack.example.com;

    ssl_certificate     /etc/letsencrypt/live/quack.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quack.example.com/privkey.pem;

    # 速率限制
    limit_req_zone $binary_remote_addr zone=quack_limit:10m rate=10r/s;

    location / {
        limit_req zone=quack_limit burst=20 nodelay;

        proxy_pass http://127.0.0.1:9494;
        proxy_http_version 2.0;          # 必须 HTTP/2
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;

        # 长连接优化
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### 2.5 防火墙开放端口

```bash
# 仅允许特定 IP 访问
sudo ufw allow from 192.168.1.0/24 to any port 9494 proto tcp

# 或用 iptables
sudo iptables -A INPUT -p tcp --dport 9494 -s 192.168.1.0/24 -j ACCEPT
```

### 2.6 systemd 自启动服务

`/etc/systemd/system/duckdb-quack.service`：

```ini
[Unit]
Description=DuckDB Quack Server
After=network.target

[Service]
Type=simple
User=duckdb
Group=duckdb
WorkingDirectory=/var/lib/duckdb
ExecStart=/usr/local/bin/duckdb -c "CALL quack_serve('quack:0.0.0.0:9494', token => 'my-super-secret', allow_other_hostname => true);"
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/duckdb

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable duckdb-quack
sudo systemctl start duckdb-quack
sudo systemctl status duckdb-quack
```

---

## 三、客户端连接

### 3.1 方式 A：另一个 DuckDB 客户端（最常用）

```sql
-- 1. 创建认证密钥
CREATE SECRET (TYPE quack, TOKEN 'my-super-secret');

-- 2. 附加远程实例
ATTACH 'quack:localhost' AS remote;
-- 非 localhost：ATTACH 'quack:quack.example.com' AS remote;
-- 自定义端口：ATTACH 'quack:myhost:9000' AS remote;

-- 3. 像查询本地表一样查询
FROM remote.hello;
SELECT * FROM remote.my_table WHERE id = 1;
```

> ⚠️ **注意 URI 格式**：`quack:host[:port]`，冒号分隔，**不是 `quack://`**。

### 3.2 方式 B：Python ADBC 驱动（推荐用于应用集成）

安装：

```bash
pip install adbc-driver-quack pyarrow
```

**基础用法：**

```python
import adbc_driver_quack.dbapi as quack

with quack.connect(
    uri="quack://localhost:9494",                    # 注意：这里是 quack:// 风格
    db_kwargs={"adbc.quack.token": "my-super-secret"}
) as conn, conn.cursor() as cur:

    cur.execute("SELECT 42 AS answer")
    table = cur.fetch_arrow_table()                  # 返回 pyarrow.Table
```

**流式获取（大数据集推荐）：**

```python
import pyarrow as pa

with quack.connect(
    uri="quack://localhost:9494",
    db_kwargs={"adbc.quack.token": "my-super-secret"}
) as conn, conn.cursor() as cur:

    cur.execute("SELECT * FROM huge_table")
    while True:
        batch = cur.fetch_record_batch()
        if batch is None:
            break
        # 处理每个 Arrow RecordBatch
        process(batch)
```

**批量 Arrow 摄入：**

```python
import pyarrow as pa
import adbc_driver_quack.dbapi as quack

# 准备 Arrow 数据
data = pa.table({
    "id": [1, 2, 3],
    "name": ["Alice", "Bob", "Charlie"],
    "value": [10.5, 20.3, 30.1]
})

with quack.connect(
    uri="quack://localhost:9494",
    db_kwargs={"adbc.quack.token": "my-super-secret"}
) as conn, conn.cursor() as cur:
    cur.adbc_ingest("my_table", data)
```

**生产级连接池示例：**

```python
from contextlib import contextmanager
from queue import Queue, Empty
import adbc_driver_quack.dbapi as quack

class QuackPool:
    def __init__(self, uri, token, size=5):
        self.uri = uri
        self.token = token
        self.pool = Queue(maxsize=size)
        for _ in range(size):
            self.pool.put(self._create_conn())

    def _create_conn(self):
        return quack.connect(
            uri=self.uri,
            db_kwargs={"adbc.quack.token": self.token}
        )

    @contextmanager
    def get_conn(self, timeout=30):
        try:
            conn = self.pool.get(timeout=timeout)
        except Empty:
            raise TimeoutError("No available connection")
        try:
            yield conn
        finally:
            self.pool.put(conn)

# 使用示例
pool = QuackPool("quack://localhost:9494", "my-super-secret", size=5)

with pool.get_conn() as conn, conn.cursor() as cur:
    cur.execute("SELECT * FROM users WHERE active = ?", [True])
    results = cur.fetch_arrow_table()
```

### 3.3 方式 C：DuckDB-Wasm（浏览器内）

可在浏览器里直接通过 WASM 客户端连 Quack，适合做 BI / 看板。

```javascript
import * as duckdb from '@duckdb/duckdb-wasm';
import { QuackClient } from '@duckdb/quack-wasm';

const quack = new QuackClient({
    uri: 'quack://quack.example.com:9494',
    token: 'my-super-secret'
});

await quack.connect();
const result = await quack.query("SELECT * FROM my_table");
```

---

## 四、版本要求

| 版本 | 状态 | 说明 |
|------|------|------|
| v1.5.2 | 可用 | 需要 `INSTALL quack FROM community` |
| **v1.5.3**（推荐） | ✅ 稳定 | Quack 进入 core 扩展，自动 install + load |
| v2.0 "Cyanoptera" | 预览 | 服务端模式 + 异步 I/O 作为头牌特性 |

---

## 五、验证连接是否成功

### 5.1 快速验证（另一个 DuckDB 实例）

```sql
CREATE SECRET (TYPE quack, TOKEN 'my-super-secret');
ATTACH 'quack:your-server-host:9494' AS remote;
SELECT
    'connected!' AS status,
    current_setting('TimeZone') AS tz,
    version() AS duckdb_version
FROM remote.hello;
```

### 5.2 Python 验证脚本

```python
import adbc_driver_quack.dbapi as quack

try:
    with quack.connect(
        uri="quack://your-server-host:9494",
        db_kwargs={"adbc.quack.token": "my-super-secret"}
    ) as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 AS ping")
        result = cur.fetch_arrow_table()
        print(f"✅ Connection successful: {result.to_pydict()}")
except Exception as e:
    print(f"❌ Connection failed: {e}")
```

### 5.3 常见错误排查

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `Connection refused` | 服务未启动或防火墙阻止 | 检查 `systemctl status duckdb-quack`、开放 9494 端口 |
| `Authentication failed` | token 不匹配 | 核对客户端 token 与服务端启动时设置的 token |
| `Hostname not allowed` | 未设置 `allow_other_hostname => true` | 重启服务并设置该参数 |
| `SSL/TLS required` | 非 localhost 未启用 SSL | 配置 nginx 反代 + Let's Encrypt |
| `Profile locked` | profile 目录残留 SingletonLock | 删除 `~/.config/google-chrome/Singleton*`（仅 Chrome 相关） |

---

## 六、安全最佳实践

1. **token 管理**
   - 不要硬编码在代码里，使用环境变量或密钥管理系统
   - 定期轮换 token
   - 不同环境使用不同 token

2. **网络隔离**
   - 优先使用 VPN 或 SSH 隧道
   - 防火墙仅开放可信 IP
   - 生产环境必须启用 TLS

3. **权限控制**
   - 使用可插拔认证回调集成企业 SSO
   - 每查询授权回调限制敏感操作
   - 定期审计访问日志

4. **监控告警**
   - 监控连接数、查询延迟、错误率
   - 设置异常流量告警
   - 记录所有 SQL 查询用于审计

---

## 七、参考资源

- [Quack Remote Protocol — DuckDB Docs](https://www.duckdb.org/docs/current/quack/overview)
- [Quack: The DuckDB Client-Server Protocol](https://duckdb.org/2026/05/12/quack-remote-protocol)
- [DuckDB Quack Remote Protocol Guide](https://www.easytool.me/blog/duckdb-quack-remote-protocol-guide)
- [Announcing an ADBC driver for Quack](https://columnar.tech/blog/quack-adbc)
- [adbc-driver-quack on PyPI](https://pypi.org/project/adbc-driver-quack)
- [Quack: DuckDB's HTTP/2 Client-Server Protocol](https://hivebook.wiki/wiki/quack-duckdb-s-http-2-client-server-protocol-with-concurrent-writers)
- [DuckDB v2.0 Preview: Server Mode and Async I/O](https://byteiota.com/duckdb-v2-preview-server-mode-async-io)

---

**作者备注：** 本文基于 2026-08-27 的 DuckDB 文档和社区资源整理，Quack 协议仍在快速演进中，建议定期查看官方文档获取最新信息。