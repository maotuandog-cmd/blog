#!/usr/bin/env bash
# Start local Hermes stack for UI / smoke (Redis + gateway + dispatcher + worker-core + browser-worker).
# Usage: ./scripts/dev-up.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${HERMES_LOG_DIR:-/tmp/hermes-logs}"
mkdir -p "$LOG"

export HERMES_API_INSECURE="${HERMES_API_INSECURE:-true}"
export HERMES_ALLOWED_HOSTS="${HERMES_ALLOWED_HOSTS:-127.0.0.1,localhost,example.com}"
export HERMES_BROWSER_WORKER_URL="${HERMES_BROWSER_WORKER_URL:-http://127.0.0.1:8090}"
export HERMES_REDIS_ADDR="${HERMES_REDIS_ADDR:-127.0.0.1:6379}"
export HERMES_LLM_MOCK="${HERMES_LLM_MOCK:-true}"
export HERMES_BROWSER_PORT="${HERMES_BROWSER_PORT:-8090}"
# Optional Trace→MinIO (F-BRW-10); leave empty to skip upload (traceError)
export HERMES_S3_ENDPOINT="${HERMES_S3_ENDPOINT:-}"
export HERMES_S3_BUCKET="${HERMES_S3_BUCKET:-hermes-traces}"
export HERMES_S3_ACCESS_KEY="${HERMES_S3_ACCESS_KEY:-}"
export HERMES_S3_SECRET_KEY="${HERMES_S3_SECRET_KEY:-}"
export HERMES_S3_FORCE_PATH_STYLE="${HERMES_S3_FORCE_PATH_STYLE:-true}"
export HERMES_S3_REGION="${HERMES_S3_REGION:-us-east-1}"
export HERMES_TRACE_URL_TTL_SEC="${HERMES_TRACE_URL_TTL_SEC:-86400}"

if ! redis-cli -h "${HERMES_REDIS_ADDR%%:*}" ping >/dev/null 2>&1; then
  echo "starting redis-server…"
  redis-server --daemonize yes --port 6379
  sleep 0.3
fi
redis-cli ping >/dev/null

if [[ ! -x "$ROOT/bin/gateway" ]]; then
  echo "building binaries…"
  (cd "$ROOT" && make build)
fi

start_one() {
  local name="$1"
  shift
  local bin="$1"
  if pgrep -f "$bin" >/dev/null 2>&1; then
    echo "already running: $name"
    return
  fi
  nohup "$@" >"$LOG/${name}.log" 2>&1 &
  echo "started $name pid=$! log=$LOG/${name}.log"
}

start_one gateway "$ROOT/bin/gateway"
start_one dispatcher "$ROOT/bin/dispatcher"
start_one worker-core "$ROOT/bin/worker-core"
if ! curl -sf "http://127.0.0.1:${HERMES_BROWSER_PORT}/healthz" >/dev/null 2>&1; then
  (cd "$ROOT/worker-browser" && nohup env HERMES_LLM_MOCK="$HERMES_LLM_MOCK" \
    HERMES_BROWSER_PORT="$HERMES_BROWSER_PORT" \
    HERMES_ALLOWED_HOSTS="$HERMES_ALLOWED_HOSTS" \
    HERMES_CAPTCHA_WEBHOOK="${HERMES_CAPTCHA_WEBHOOK:-}" \
    HERMES_S3_ENDPOINT="$HERMES_S3_ENDPOINT" \
    HERMES_S3_BUCKET="$HERMES_S3_BUCKET" \
    HERMES_S3_ACCESS_KEY="$HERMES_S3_ACCESS_KEY" \
    HERMES_S3_SECRET_KEY="$HERMES_S3_SECRET_KEY" \
    HERMES_S3_FORCE_PATH_STYLE="$HERMES_S3_FORCE_PATH_STYLE" \
    HERMES_S3_REGION="$HERMES_S3_REGION" \
    HERMES_TRACE_URL_TTL_SEC="$HERMES_TRACE_URL_TTL_SEC" \
    npm start >"$LOG/browser-worker.log" 2>&1 &)
  echo "started browser-worker log=$LOG/browser-worker.log"
else
  echo "already running: browser-worker"
fi

for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8080/healthz >/dev/null && break
  sleep 0.2
done
curl -sf http://127.0.0.1:8080/healthz >/dev/null && echo "gateway: ok" || echo "gateway: NOT READY"
curl -sf "http://127.0.0.1:${HERMES_BROWSER_PORT}/healthz" >/dev/null && echo "browser-worker: ok" || echo "browser-worker: NOT READY (wait / check $LOG/browser-worker.log)"

echo "UI: cd hermes-ui && npm run dev"
echo "Smoke: make smoke && make smoke-agent && make smoke-browser && make smoke-auth"
