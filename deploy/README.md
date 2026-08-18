# Deploy notes

## Redis

Prefer whichever is available on the host:

```bash
# A) local redis
redis-server --daemonize yes --port 6379

# B) docker (plugin may be `docker compose` or unavailable — D11)
docker run -d --name hermes-redis -p 6379:6379 redis:7-alpine
```

`docker-compose.yml` in this folder is a convenience reference when Compose v2 is installed（含可选 MinIO）。

## MinIO（Trace 对象存储）

```bash
cd deploy
docker compose up -d minio minio-init
# Console http://127.0.0.1:9001  user/pass: hermes / hermessecret
```

browser-worker 环境示例：

```bash
export HERMES_S3_ENDPOINT=http://127.0.0.1:9000
export HERMES_S3_BUCKET=hermes-traces
export HERMES_S3_ACCESS_KEY=hermes
export HERMES_S3_SECRET_KEY=hermessecret
export HERMES_S3_FORCE_PATH_STYLE=true
```

## Alertmanager 示例

`alertmanager-browser-examples.yml` 仅供 Prometheus 规则粘贴；**Hermes 不运行告警产品**。

## Browser worker

```bash
cd ../worker-browser
npm install
npx playwright install chromium
npm run build
HERMES_BROWSER_PORT=8090 HERMES_ALLOWED_HOSTS=example.com npm start
```

## Smoke

With gateway + worker-core running:

```bash
cd ..
HERMES_API_INSECURE=true make smoke
```
