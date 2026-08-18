#!/usr/bin/env bash
# T02: BROWSER_AGENT with HERMES_LLM_MOCK (no real LLM key).
# Requires: gateway + worker-core + browser-worker(with MOCK) + optional static :18081
set -euo pipefail
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
PAGE_URL="${HERMES_AGENT_PAGE_URL:-http://127.0.0.1:18081/}"
HOST="${HERMES_AGENT_HOST:-127.0.0.1}"

AUTH=()
if [[ -n "${HERMES_API_TOKEN:-}" ]]; then
  AUTH=(-H "Authorization: Bearer ${HERMES_API_TOKEN}")
elif [[ "${HERMES_API_INSECURE:-}" != "true" ]]; then
  echo "set HERMES_API_TOKEN or HERMES_API_INSECURE=true" >&2
  exit 2
fi

# Ensure local page if default URL
if [[ "$PAGE_URL" == "http://127.0.0.1:18081/" ]]; then
  if ! curl -sf -o /dev/null "$PAGE_URL"; then
    python3 - <<'PY' >/tmp/hermes_agent_static.log 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
HTML=b"<!doctype html><html><head><title>hermes</title></head><body><h1 id=ok>hello-hermes</h1></body></html>"
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type","text/html"); self.end_headers(); self.wfile.write(HTML)
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1", 18081), H).serve_forever()
PY
    STATIC_PID=$!
    trap 'kill $STATIC_PID 2>/dev/null || true' EXIT
    sleep 0.4
  fi
fi

JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t02-agent-mock\",
  \"protocol\": \"BROWSER_AGENT\",
  \"timeoutSec\": 120,
  \"payload\": {
    \"goal\": \"open page and finish\",
    \"startUrl\": \"$PAGE_URL\",
    \"purpose\": \"t02-mock-llm\",
    \"allowedHosts\": [\"$HOST\"],
    \"antiDetect\": \"L2\",
    \"maxSteps\": 4,
    \"summarize\": true
  }
}")
ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "job=$ID"
for i in $(seq 1 60); do
  RES=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$ID")
  ST=$(echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
  [[ "$ST" == "SUCCESS" || "$ST" == "FAILED" || "$ST" == "CANCELLED" ]] && break
  sleep 0.5
done
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
result=r.get("result") or {}
extra=result.get("extra") or {}
summary=extra.get("summary") or {}
extracted=extra.get("extracted") or {}
print("status", r.get("status"), "success", result.get("success"), "message", result.get("message"))
print("summary", summary.get("conclusion"))
print("extracted", extracted)
assert r.get("status")=="SUCCESS" and result.get("success") is True, r
assert summary.get("conclusion"), "missing summary (is HERMES_LLM_MOCK set on browser-worker?)"
assert extracted.get("mock") is True or (isinstance(extracted, dict) and "mock" in str(extracted))
print("T02 PASS")
' "$RES"
