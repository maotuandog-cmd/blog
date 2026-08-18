#!/usr/bin/env bash
# T-Cred-01..05 · T-CapAuto-01..06
# Restarts browser-worker twice: first without webhook (T-CapAuto-05), then with mock webhook.
# Requires: gateway :8080 + worker-core + Chromium (worker-browser dist built)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
PAGE_PORT="${HERMES_AUTH_PAGE_PORT:-18083}"
HOOK_PORT="${HERMES_AUTH_HOOK_PORT:-18084}"
PAGE="http://127.0.0.1:${PAGE_PORT}"
HOOK="http://127.0.0.1:${HOOK_PORT}"
BW_PORT="${HERMES_BROWSER_PORT:-8090}"
LOG="${HERMES_LOG_DIR:-/tmp/hermes-logs}"
mkdir -p "$LOG"

AUTH=()
if [[ -n "${HERMES_API_TOKEN:-}" ]]; then
  AUTH=(-H "Authorization: Bearer ${HERMES_API_TOKEN}")
elif [[ "${HERMES_API_INSECURE:-}" != "true" ]]; then
  echo "set HERMES_API_TOKEN or HERMES_API_INSECURE=true" >&2
  exit 2
fi

PASS=0; FAIL=0
ok() { echo "PASS: $*"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }

if ! curl -sf "$BASE/healthz" >/dev/null; then
  echo "gateway not ready at $BASE" >&2
  exit 2
fi
if [[ ! -f "$ROOT/worker-browser/dist/index.js" ]]; then
  echo "missing worker-browser/dist — run: cd worker-browser && npm run build" >&2
  exit 2
fi

echo "rebuilding gateway (password redact)…"
(cd "$ROOT" && go build -o bin/gateway ./cmd/gateway)
while read -r p; do
  [[ -n "$p" ]] && kill "$p" 2>/dev/null || true
done < <(pgrep -f '/bin/gateway' || true)
sleep 0.4
nohup env HERMES_API_INSECURE="${HERMES_API_INSECURE:-true}" \
  HERMES_REDIS_ADDR="${HERMES_REDIS_ADDR:-127.0.0.1:6379}" \
  HERMES_ALLOWED_HOSTS="${HERMES_ALLOWED_HOSTS:-127.0.0.1,localhost}" \
  "$ROOT/bin/gateway" >"$LOG/gateway-auth-e2e.log" 2>&1 &
for i in $(seq 1 40); do
  curl -sf "$BASE/healthz" >/dev/null && break
  sleep 0.15
done
curl -sf "$BASE/healthz" >/dev/null || { echo "gateway failed to restart"; tail -n 30 "$LOG/gateway-auth-e2e.log"; exit 2; }

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do
    kill "$p" 2>/dev/null || true
  done
  # restore a default browser-worker (no captcha webhook) if we took :8090
  if [[ "${RESTORE_WORKER:-}" == "1" ]]; then
    start_browser_worker ""
  fi
}
trap cleanup EXIT

kill_port() {
  local port="$1"
  python3 - "$port" <<'PY' || true
import os, signal, sys
port = int(sys.argv[1])
try:
    import subprocess
    out = subprocess.check_output(["ss", "-lptn", f"sport = :{port}"], text=True, stderr=subprocess.DEVNULL)
except Exception:
    out = ""
import re
pids = set(re.findall(r"pid=(\d+)", out))
for pid in pids:
    try:
        os.kill(int(pid), signal.SIGTERM)
    except OSError:
        pass
PY
  sleep 0.4
}

start_browser_worker() {
  local webhook="${1:-}"
  kill_port "$BW_PORT"
  sleep 0.3
  (
    cd "$ROOT/worker-browser"
    nohup env HERMES_AUTH_E2E_WORKER=1 \
      HERMES_LLM_MOCK=true \
      HERMES_BROWSER_PORT="$BW_PORT" \
      HERMES_ALLOWED_HOSTS="127.0.0.1,localhost" \
      HERMES_CAPTCHA_WEBHOOK="$webhook" \
      HERMES_CAPTCHA_TIMEOUT_SEC=15 \
      npm start >"$LOG/browser-worker-auth-e2e.log" 2>&1 &
    echo $! >"$LOG/browser-worker-auth-e2e.pid"
  )
  local i
  for i in $(seq 1 40); do
    curl -sf "http://127.0.0.1:${BW_PORT}/healthz" >/dev/null && return 0
    sleep 0.25
  done
  echo "browser-worker not ready; see $LOG/browser-worker-auth-e2e.log" >&2
  tail -n 40 "$LOG/browser-worker-auth-e2e.log" >&2 || true
  return 1
}

kill_port "$PAGE_PORT"
kill_port "$HOOK_PORT"
python3 "$ROOT/scripts/auth_e2e_server.py" >"$LOG/auth-e2e-server.log" 2>&1 &
PIDS+=($!)
sleep 0.4
curl -sf "$PAGE/" >/dev/null
curl -sf "$PAGE/login-verification" | grep -q verification
curl -sf "$HOOK/calls" >/dev/null

hook_count() {
  curl -s "$HOOK/calls" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))"
}

wait_job() {
  local id="$1" max="${2:-80}"
  local res st
  for _ in $(seq 1 "$max"); do
    res=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$id")
    st=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
    if [[ "$st" == "SUCCESS" || "$st" == "FAILED" || "$st" == "CANCELLED" || "$st" == "RETRY_WAIT" ]]; then
      echo "$res"
      return 0
    fi
    sleep 0.5
  done
  echo "$res"
}

post_job() {
  curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "$1"
}

RESTORE_WORKER=1

# ---------- T-CapAuto-05: captcha, no webhook ----------
start_browser_worker ""
JOB=$(post_job "{
  \"name\": \"t-capauto-05\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-image\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 80)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
msg=str(result.get("message") or "")
print("T-CapAuto-05", st, "retryable", result.get("retryable"), msg[:180])
assert st=="FAILED", r
assert result.get("retryable") is False
assert "not configured" in msg or "captcha detected" in msg, msg
steps=result.get("steps") or []
for s in steps:
    if s.get("name","").startswith("step-") and s.get("success") is True:
        raise SystemExit("business step ran: %s" % s)
print("T-CapAuto-05 OK")
' "$RES" && ok "T-CapAuto-05 no webhook" || bad "T-CapAuto-05"

# ---------- worker with mock webhook ----------
start_browser_worker "${HOOK}/captcha"

# T-Cred-01 + T-Cred-02
BEFORE=$(hook_count)
JOB=$(post_job "{
  \"name\": \"t-cred-02\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
echo "$JOB" | python3 -c '
import json,sys
j=json.loads(sys.argv[1])
raw=json.dumps(j)
assert "secret" not in raw, raw
pw=((j.get("payload") or {}).get("credentials") or {}).get("password")
assert pw=="[REDACTED]", pw
print("T-Cred-01 create redacted OK")
' "$JOB" && ok "T-Cred-01 create" || bad "T-Cred-01 create"
CRED_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$CRED_ID" 80)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
print("T-Cred-02", st, result.get("message"), [s.get("name") for s in (result.get("steps") or [])])
assert st=="SUCCESS" and result.get("success") is True, r
names=" ".join(s.get("name","") for s in (result.get("steps") or []))
assert "auth-auto-fill-user" in names and "auth-auto-fill-pass" in names, names
blob=json.dumps(result)
assert "secret" not in blob, blob
print("T-Cred-02 OK")
' "$RES" && ok "T-Cred-02 auto login" || bad "T-Cred-02"
GET=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$CRED_ID")
echo "$GET" | python3 -c '
import json,sys
j=json.loads(sys.stdin.read())
assert "secret" not in json.dumps(j)
assert ((j.get("payload") or {}).get("credentials") or {}).get("password")=="[REDACTED]"
print("T-Cred-01 GET OK")
' && ok "T-Cred-01 GET" || bad "T-Cred-01 GET"

# T-Cred-05 rerun
CODE=$(curl -s -o /tmp/hermes_auth_rerun.json -w "%{http_code}" "${AUTH[@]}" -X POST "$BASE/v1/jobs/$CRED_ID/rerun")
python3 -c '
import json
j=json.load(open("/tmp/hermes_auth_rerun.json"))
assert "secret" not in json.dumps(j)
assert ((j.get("payload") or {}).get("credentials") or {}).get("password")=="[REDACTED]"
' && [[ "$CODE" == "202" ]] && ok "T-Cred-05 rerun redacted" || bad "T-Cred-05 rerun http"
RERUN_ID=$(python3 -c "import json; print(json.load(open('/tmp/hermes_auth_rerun.json'))['id'])")
# same id after rerun
RES=$(wait_job "$CRED_ID" 80)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
assert r.get("status")=="SUCCESS" and (r.get("result") or {}).get("success") is True, r
print("T-Cred-05 rerun SUCCESS OK")
' "$RES" && ok "T-Cred-05 rerun run" || bad "T-Cred-05 rerun run"

# T-Cred-03 no credentials
JOB=$(post_job "{
  \"name\": \"t-cred-03\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 60,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE}/login\" },
      { \"action\": \"assertText\", \"selector\": \"h1\", \"value\": \"登录\" }
    ]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 70)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
result=r.get("result") or {}
names=" ".join(s.get("name","") for s in (result.get("steps") or []))
print("T-Cred-03", r.get("status"), names)
assert r.get("status")=="SUCCESS", r
assert "auth-auto" not in names, names
print("T-Cred-03 OK")
' "$RES" && ok "T-Cred-03 no creds" || bad "T-Cred-03"

# T-Cred-04 ambiguous passwords
JOB=$(post_job "{
  \"name\": \"t-cred-04\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 60,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-multi\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 70)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
result=r.get("result") or {}
msg=str(result.get("message") or "")
print("T-Cred-04", r.get("status"), msg[:180])
assert r.get("status")=="FAILED", r
assert "ambiguous" in msg or "selector" in msg, msg
for s in result.get("steps") or []:
    if s.get("name","").startswith("step-") and s.get("success") is True:
        raise SystemExit("business ran")
print("T-Cred-04 OK")
' "$RES" && ok "T-Cred-04 ambiguous" || bad "T-Cred-04"

# T-CapAuto-04 no captcha → no webhook
C0=$(hook_count)
JOB=$(post_job "{
  \"name\": \"t-capauto-04\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 60,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE}/\" },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"hello-hermes\" }
    ]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 70)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
assert r.get("status")=="SUCCESS", r
print("T-CapAuto-04 job OK")
' "$RES" && ok "T-CapAuto-04 job" || bad "T-CapAuto-04 job"
C1=$(hook_count)
if [[ "$C1" -eq "$C0" ]]; then
  ok "T-CapAuto-04 no webhook calls ($C1)"
else
  echo "webhook count $C0 -> $C1"
  bad "T-CapAuto-04 webhook called"
fi

run_cap() {
  local id="$1" path="$2"
  local job res
  job=$(post_job "{
    \"name\": \"$id\",
    \"protocol\": \"BROWSER\",
    \"timeoutSec\": 90,
    \"maxRetries\": 0,
    \"payload\": {
      \"captureTrace\": \"never\",
      \"autoCaptcha\": true,
      \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}${path}\" },
      \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
    }
  }")
  local jid
  jid=$(echo "$job" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  res=$(wait_job "$jid" 90)
  python3 -c '
import json,sys
r=json.loads(sys.argv[1])
tid=sys.argv[2]
st=r.get("status"); result=r.get("result") or {}
print(tid, st, result.get("message"), [s.get("name")+"/"+str(s.get("success")) for s in (result.get("steps") or [])])
assert st=="SUCCESS" and result.get("success") is True, r
print(tid, "OK")
' "$res" "$id"
}

run_cap "T-CapAuto-01" "/login-image" && ok "T-CapAuto-01 image" || bad "T-CapAuto-01"
run_cap "T-CapAuto-02" "/login-click" && ok "T-CapAuto-02 click" || bad "T-CapAuto-02"
run_cap "T-CapAuto-03" "/login-slider" && ok "T-CapAuto-03 slider" || bad "T-CapAuto-03"

# T-CapAuto-06 autoCaptcha=false → do not call webhook, login fails
C2=$(hook_count)
JOB=$(post_job "{
  \"name\": \"t-capauto-06\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": false,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-image\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 80)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
print("T-CapAuto-06", st, result.get("message"))
assert st=="FAILED", r
assert result.get("retryable") is False or result.get("retryable") is None
print("T-CapAuto-06 job OK")
' "$RES" && ok "T-CapAuto-06 fail" || bad "T-CapAuto-06 fail"
C3=$(hook_count)
if [[ "$C3" -eq "$C2" ]]; then
  ok "T-CapAuto-06 no extra webhook ($C3)"
else
  echo "webhook $C2 -> $C3"
  bad "T-CapAuto-06 webhook called"
fi

# T-LiveCap-02: #verification, must not fill #captcha
JOB=$(post_job "{
  \"name\": \"t-livecap-02\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-verification\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
blob=json.dumps(result)
print("T-LiveCap-02", st, result.get("message"), [s.get("name")+"/"+(s.get("output") or "")[:80] for s in (result.get("steps") or [])])
assert st=="SUCCESS" and result.get("success") is True, r
assert "#verification" in blob, blob
assert "filled #captcha" not in blob, blob
print("T-LiveCap-02 OK")
' "$RES" && ok "T-LiveCap-02 verification" || bad "T-LiveCap-02"

# T-LiveCap-03: weak text only, no webhook
C4=$(hook_count)
JOB=$(post_job "{
  \"name\": \"t-livecap-03\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 60,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-text-only\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 70)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
assert r.get("status")=="SUCCESS", r
print("T-LiveCap-03 job OK")
' "$RES" && ok "T-LiveCap-03 job" || bad "T-LiveCap-03 job"
C5=$(hook_count)
if [[ "$C5" -eq "$C4" ]]; then
  ok "T-LiveCap-03 no webhook ($C5)"
else
  echo "webhook $C4 -> $C5"
  bad "T-LiveCap-03 webhook called"
fi

# T-LiveCap-04: captcha after username blur
JOB=$(post_job "{
  \"name\": \"t-livecap-04\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-delayed\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
print("T-LiveCap-04", st, result.get("message"), [s.get("name")+"/"+(s.get("output") or "")[:80] for s in (result.get("steps") or [])])
assert st=="SUCCESS" and result.get("success") is True, r
print("T-LiveCap-04 OK")
' "$RES" && ok "T-LiveCap-04 delayed" || bad "T-LiveCap-04"

# T-LiveCap-05: webhook fillSelector #captcha missing, probe #verification
JOB=$(post_job "{
  \"name\": \"t-livecap-05\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"payload\": {
    \"captureTrace\": \"never\",
    \"autoCaptcha\": true,
    \"credentials\": { \"username\": \"alice\", \"password\": \"secret\", \"loginUrl\": \"${PAGE}/login-wrong-sel\" },
    \"steps\": [{ \"action\": \"assertText\", \"selector\": \"#welcome\", \"value\": \"logged-in\" }]
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RES=$(wait_job "$ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status"); result=r.get("result") or {}
blob=json.dumps(result)
print("T-LiveCap-05", st, result.get("message"), [s.get("name")+"/"+(s.get("output") or "")[:80] for s in (result.get("steps") or [])])
assert st=="SUCCESS" and result.get("success") is True, r
assert "filled #verification" in blob, blob
assert "Timeout" not in blob, blob
print("T-LiveCap-05 OK")
' "$RES" && ok "T-LiveCap-05 webhook selector fallback" || bad "T-LiveCap-05"

echo "auth_captcha_smoke: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
