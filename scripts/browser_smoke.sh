#!/usr/bin/env bash
# T01 + no-retry: S12 authSteps fail · S13 collectResources · assert fail → FAILED (not RETRY_WAIT)
# Requires: gateway + worker-core + browser-worker + Chromium
set -euo pipefail
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
PAGE_URL="${HERMES_BROWSER_PAGE_URL:-http://127.0.0.1:18081/}"
HOST="${HERMES_BROWSER_HOST:-127.0.0.1}"

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

if [[ "$PAGE_URL" == "http://127.0.0.1:18081/" ]]; then
  if ! curl -sf -o /dev/null "$PAGE_URL"; then
    python3 - <<'PY' >/tmp/hermes_browser_static.log 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
HTML = b"""<!doctype html><html><head>
<title>hermes</title>
<link rel="stylesheet" href="/a.css">
<script src="/a.js"></script>
</head><body><h1 id="ok">hello-hermes</h1></body></html>"""
CSS = b"h1{color:#123}"
JS = b"/* hermes */"
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/a.css"):
            self.send_response(200); self.send_header("Content-Type","text/css"); self.end_headers(); self.wfile.write(CSS); return
        if self.path.startswith("/a.js"):
            self.send_response(200); self.send_header("Content-Type","application/javascript"); self.end_headers(); self.wfile.write(JS); return
        if self.path.startswith("/login-fail"):
            self.send_response(200); self.send_header("Content-Type","text/html"); self.end_headers()
            self.wfile.write(b"<html><body><h1>login</h1><div id=err>bad credentials</div></body></html>"); return
        self.send_response(200); self.send_header("Content-Type","text/html"); self.end_headers(); self.wfile.write(HTML)
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1", 18081), H).serve_forever()
PY
    STATIC_PID=$!
    trap 'kill $STATIC_PID 2>/dev/null || true' EXIT
    sleep 0.4
  fi
fi

wait_job() {
  local id="$1" max="${2:-60}"
  local res st
  for _ in $(seq 1 "$max"); do
    res=$(curl -s "${AUTH[@]}" "$BASE/v1/jobs/$id")
    st=$(echo "$res" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status'))")
    if [[ "$st" == "SUCCESS" || "$st" == "FAILED" || "$st" == "CANCELLED" ]]; then
      echo "$res"
      return 0
    fi
    # Fail early if stuck in retry (regression for deterministic browser fail)
    if [[ "$st" == "RETRY_WAIT" ]]; then
      echo "$res"
      return 0
    fi
    sleep 0.5
  done
  echo "$res"
}

# --- S12: authSteps fail → no business steps ---
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t01-s12-auth\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 3,
  \"payload\": {
    \"startUrl\": \"${PAGE_URL}login-fail\",
    \"authSteps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE_URL}login-fail\" },
      { \"action\": \"assertText\", \"selector\": \"#token\", \"value\": \"present\" }
    ],
    \"steps\": [
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"hello-hermes\" }
    ]
  }
}")
S12_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
S12_RES=$(wait_job "$S12_ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status")
result=r.get("result") or {}
steps=result.get("steps") or []
print("S12 status", st, "steps", len(steps), "retryable", result.get("retryable"), "msg", result.get("message"))
if st == "RETRY_WAIT":
    raise SystemExit("S12 stuck RETRY_WAIT (should terminal FAILED)")
if st != "FAILED" or result.get("success") is not False:
    raise SystemExit("S12 want FAILED, got %s success=%s" % (st, result.get("success")))
# Business assert on #ok / hello-hermes must not appear as a successful step
for s in steps:
    blob = " ".join([str(s.get(k) or "") for k in ("name", "output", "error")])
    if "#ok" in blob or "hello-hermes" in blob:
        if s.get("success") is True:
            raise SystemExit("S12 business step unexpectedly succeeded: %s" % s)
        # even a failed business step means auth did not stop the journey
        raise SystemExit("S12 business step was executed: %s" % s)
print("S12 OK")
' "$S12_RES" && ok "S12 auth fail no business" || bad "S12"

# --- S13: collectResources ---
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t01-s13-resources\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"payload\": {
    \"startUrl\": \"$PAGE_URL\",
    \"collectResources\": true,
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"$PAGE_URL\" },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"hello-hermes\" }
    ]
  }
}")
S13_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
S13_RES=$(wait_job "$S13_ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status")
result=r.get("result") or {}
extra=result.get("extra") or {}
res=extra.get("resources") or {}
by=res.get("byType") or {}
print("S13 status", st, "byType keys", list(by.keys())[:8])
assert st=="SUCCESS" and result.get("success") is True, r
assert isinstance(by, dict) and len(by)>0, "missing byType"
# Prefer seeing document or stylesheet/script when page has them
print("S13 OK")
' "$S13_RES" && ok "S13 collectResources" || bad "S13"

# --- No-retry: assert fail → FAILED quickly, not RETRY_WAIT ---
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t01-no-retry\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 3,
  \"payload\": {
    \"startUrl\": \"$PAGE_URL\",
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"$PAGE_URL\" },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"THIS_WILL_FAIL\" }
    ]
  }
}")
NR_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
# Poll a bit longer than one attempt but far less than 3 retries worth
NR_RES=$(wait_job "$NR_ID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status")
result=r.get("result") or {}
retries=r.get("retries", 0)
print("no-retry status", st, "retries", retries, "retryable", result.get("retryable"), "msg", result.get("message"))
if st == "RETRY_WAIT":
    raise SystemExit("assert fail entered RETRY_WAIT")
if st != "FAILED":
    raise SystemExit(f"want FAILED got {st}")
# retries may still increment once in runner before checking retryable — accept 0 or 1
if retries > 1:
    raise SystemExit(f"unexpected retries={retries}")
print("NO-RETRY OK")
' "$NR_RES" && ok "assert fail → FAILED (no retry)" || bad "no-retry"

echo "browser_smoke: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
