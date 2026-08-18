#!/usr/bin/env bash
# Ops surface smoke: cancel / rerun / drain / reclaim
set -euo pipefail
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
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

JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"ops-cancel","protocol":"PING","type":"timed",
  "runAt":"2099-01-01T00:00:00Z",
  "payload":{"host":"127.0.0.1","count":1}
}')
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ST=$(curl -s "${AUTH[@]}" -X POST "$BASE/v1/jobs/$ID/cancel" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
[[ "$ST" == "CANCELLED" ]] && ok "cancel" || bad "cancel $ST"

PING=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d '{
  "name":"ops-rerun","protocol":"PING","payload":{"host":"127.0.0.1","count":1}
}')
PID=$(echo "$PING" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for _ in $(seq 1 40); do
  ST=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$PID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" ]] && break
  sleep 0.25
done
CODE=$(curl -s -o /tmp/hermes_ops_rerun.json -w "%{http_code}" "${AUTH[@]}" -X POST "$BASE/v1/jobs/$PID/rerun")
[[ "$CODE" == "202" ]] && ok "rerun" || bad "rerun $CODE"

curl -s "${AUTH[@]}" -X POST "$BASE/v1/admin/drain" -H 'content-type: application/json' -d '{"enabled":true,"mode":"soft"}' \
  | python3 -c "import sys,json; assert json.load(sys.stdin).get('drain') is True"
curl -s "${AUTH[@]}" -X POST "$BASE/v1/admin/drain" -H 'content-type: application/json' -d '{"enabled":false}' \
  | python3 -c "import sys,json; assert json.load(sys.stdin).get('drain') is False"
ok "drain toggle"

curl -s "${AUTH[@]}" -X POST "$BASE/v1/admin/reclaim?minIdleSec=120&count=8" \
  | python3 -c "import sys,json; assert 'requeued' in json.load(sys.stdin)"
ok "reclaim"

echo "ops_smoke: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
