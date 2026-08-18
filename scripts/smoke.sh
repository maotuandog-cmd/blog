#!/usr/bin/env bash
# Hermes full smoke (unit companion). Requires: redis, gateway, worker-core (+ dispatcher for timed).
# Usage: HERMES_API_INSECURE=true ./scripts/smoke.sh
set -euo pipefail
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${HERMES_API_TOKEN:-}"
AUTH=()
if [[ -n "$TOKEN" ]]; then
  AUTH=(-H "Authorization: Bearer ${TOKEN}")
elif [[ "${HERMES_API_INSECURE:-}" != "true" ]]; then
  echo "set HERMES_API_TOKEN or HERMES_API_INSECURE=true" >&2
  exit 2
fi

PASS=0; FAIL=0
ok() { echo "PASS: $*"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }

code() { curl -s -o /tmp/hermes_smoke_body.txt -w "%{http_code}" "$@"; }

python3 - <<'PY' >/tmp/hermes_mock_http.log 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/login"):
            self.send_response(200)
            self.send_header("Set-Cookie", "sid=xyz; Path=/")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if self.path.startswith("/me"):
            if "sid=xyz" in (self.headers.get("Cookie") or ""):
                self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
            else:
                self.send_response(401); self.end_headers()
            return
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def log_message(self, *a):
        pass
HTTPServer(("127.0.0.1", 18080), H).serve_forever()
PY
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
sleep 0.4

HC=$(code "${AUTH[@]}" "$BASE/healthz"); [[ "$HC" == "200" ]] && ok "healthz" || bad "healthz $HC"
RC=$(code "${AUTH[@]}" "$BASE/readyz"); [[ "$RC" == "200" ]] && ok "readyz" || bad "readyz $RC"

JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"smoke-api-local","protocol":"API","payload":{
    "request":{"method":"GET","url":"http://127.0.0.1:18080/","expectStatus":[200]}
  }
}')
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for i in $(seq 1 30); do
  RES=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$ID")
  ST=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" ]] && break
  sleep 0.4
done
CONN=$(echo "$RES" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result') or {}; print((r.get('metrics') or {}).get('hermes_api_connect_ms',-2))")
TTFB=$(echo "$RES" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result') or {}; print((r.get('metrics') or {}).get('hermes_api_ttfb_ms',-2))")
[[ "$ST" == "SUCCESS" && "$CONN" != "-1" ]] && ok "API timing connect=$CONN ttfb=$TTFB" || bad "API $ST connect=$CONN"

JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"api-cookie","protocol":"API","payload":{
    "auth":{"method":"GET","url":"http://127.0.0.1:18080/login","expectStatus":[200]},
    "request":{"method":"GET","url":"http://127.0.0.1:18080/me","expectStatus":[200],"expectContains":"ok"}
  }
}')
AID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for i in $(seq 1 20); do
  RES=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$AID")
  ST=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" ]] && break
  sleep 0.4
done
[[ "$ST" == "SUCCESS" ]] && ok "API CookieJar" || bad "CookieJar $ST"

JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"smoke-ping","protocol":"PING","payload":{"host":"127.0.0.1","count":1}
}')
PID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for i in $(seq 1 20); do
  RES=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$PID")
  ST=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" ]] && break
  sleep 0.4
done
[[ "$ST" == "SUCCESS" ]] && ok "PING" || bad "PING $ST"

CODE=$(code "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"bad-agent","protocol":"BROWSER_AGENT","payload":{"goal":"x","startUrl":"https://example.com"}
}'); [[ "$CODE" == "400" ]] && ok "agent purpose reject" || bad "agent purpose $CODE"

CODE=$(code "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"bad-host","protocol":"BROWSER_AGENT","payload":{
    "goal":"x","startUrl":"https://evil.example","purpose":"t","allowedHosts":["evil.example"]
  }
}'); [[ "$CODE" == "400" ]] && ok "agent host reject" || bad "agent host $CODE"

curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/admin/drain" -d '{"enabled":true,"mode":"soft"}' >/dev/null
CODE=$(code "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"drain","protocol":"PING","payload":{"host":"127.0.0.1","count":1}
}'); [[ "$CODE" == "503" ]] && ok "soft drain" || bad "soft drain $CODE"
curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/admin/drain" -d '{"enabled":true,"mode":"hard"}' >/dev/null
MODE=$(curl -s "${AUTH[@]}" "$BASE/v1/admin/drain" | python3 -c "import sys,json; print(json.load(sys.stdin).get('drainMode'))")
[[ "$MODE" == "hard" ]] && ok "hard drain mode" || bad "hard mode $MODE"
curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/admin/drain" -d '{"enabled":false}' >/dev/null

RUNAT=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{\"name\":\"t\",\"type\":\"timed\",\"runAt\":\"$RUNAT\",\"protocol\":\"PING\",\"payload\":{\"host\":\"127.0.0.1\",\"count\":1}}")
TID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
CST=$(curl -s "${AUTH[@]}" -X POST "$BASE/v1/jobs/$TID/cancel" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
[[ "$CST" == "CANCELLED" ]] && ok "cancel" || bad "cancel $CST"

J1=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -H 'Idempotency-Key: smoke-idem' -X POST "$BASE/v1/jobs" -d '{"name":"i","protocol":"PING","payload":{"host":"127.0.0.1","count":1}}')
J2=$(curl -s -D /tmp/idem.hdr "${AUTH[@]}" -H 'content-type: application/json' -H 'Idempotency-Key: smoke-idem' -X POST "$BASE/v1/jobs" -d '{"name":"i","protocol":"PING","payload":{"host":"127.0.0.1","count":1}}')
ID1=$(echo "$J1" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ID2=$(echo "$J2" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
grep -qi Idempotency-Replayed /tmp/idem.hdr && [[ "$ID1" == "$ID2" ]] && ok "idempotency" || bad "idempotency"

RR=$(curl -s "${AUTH[@]}" -X POST "$BASE/v1/admin/reclaim?count=1")
echo "$RR" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('minIdleSec')==120" && ok "reclaim default 120" || bad "reclaim $RR"

AUD=$(curl -s "${AUTH[@]}" "$BASE/v1/audit?limit=5")
CNT=$(echo "$AUD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))")
[[ "$CNT" -ge 1 ]] && ok "audit" || bad "audit"

Q=$(curl -s "${AUTH[@]}" "$BASE/v1/admin/queue")
echo "$Q" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'streamLength' in d" && ok "queue" || bad "queue"

MC=$(code "$BASE/metrics"); [[ "$MC" == "200" ]] && ok "metrics" || bad "metrics"

# timed fire (+3s) needs dispatcher
RUNAT=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(seconds=3)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{\"name\":\"soon\",\"type\":\"timed\",\"runAt\":\"$RUNAT\",\"protocol\":\"PING\",\"payload\":{\"host\":\"127.0.0.1\",\"count\":1}}")
SID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for i in $(seq 1 25); do
  RES=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$SID")
  ST=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" ]] && break
  sleep 1
done
[[ "$ST" == "SUCCESS" ]] && ok "timed fire" || bad "timed fire $ST (need dispatcher?)"

echo "---- SUMMARY pass=$PASS fail=$FAIL ----"
exit "$FAIL"
