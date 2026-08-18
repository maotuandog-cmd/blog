#!/usr/bin/env bash
# T-Vitals-01 · T-Trace-01 · T-Prom-01
# Requires: gateway + worker-core + browser-worker(with HERMES_S3_*) + Chromium
# Optional static page :18081 (auto-started)
set -euo pipefail
BASE="${HERMES_BASE_URL:-http://127.0.0.1:8080}"
PAGE_URL="${HERMES_BROWSER_PAGE_URL:-http://127.0.0.1:18081/}"

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
    python3 - <<'PY' >/tmp/hermes_vitals_static.log 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
HTML = b"""<!doctype html><html><head>
<title>hermes vitals</title>
<link rel="stylesheet" href="/a.css">
<script src="/a.js"></script>
</head><body>
<h1 id="ok">hello-hermes</h1>
<img id="hero" width="400" height="200" alt="hero"
  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect fill='%23066' width='100%25' height='100%25'/%3E%3C/svg%3E"/>
</body></html>"""
CSS = b"h1{color:#123;font-size:48px}"
JS = b"/* hermes */"
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/a.css"):
            self.send_response(200); self.send_header("Content-Type","text/css"); self.end_headers(); self.wfile.write(CSS); return
        if self.path.startswith("/a.js"):
            self.send_response(200); self.send_header("Content-Type","application/javascript"); self.end_headers(); self.wfile.write(JS); return
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
  local id="$1" max="${2:-90}"
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

# --- T-Vitals-01 ---
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t-vitals-01\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"labels\": { \"app\": \"vitals-smoke\" },
  \"payload\": {
    \"collectWebVitals\": true,
    \"resourceSettleMs\": 1200,
    \"waitNetworkIdle\": true,
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE_URL}\", \"timeoutSec\": 30 },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"hello-hermes\" }
    ]
  }
}")
VID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
VRES=$(wait_job "$VID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status")
result=r.get("result") or {}
m=result.get("metrics") or {}
keys=["hermes_browser_ttfb_ms","hermes_browser_fcp_ms","hermes_browser_lcp_ms"]
found=[k for k in keys if isinstance(m.get(k),(int,float)) and m.get(k)>=0]
print("T-Vitals status", st, "metrics", {k:m.get(k) for k in keys+["hermes_browser_tbt_ms","hermes_browser_dom_nodes"]})
if st!="SUCCESS" or result.get("success") is not True:
    raise SystemExit("want SUCCESS")
if not found:
    raise SystemExit("want at least one of TTFB/FCP/LCP in metrics")
print("vitals_ok", ",".join(found))
' "$VRES" && ok "T-Vitals-01" || bad "T-Vitals-01"

# --- T-Trace-01: assert fail → traceUrl or traceError ---
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t-trace-01\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 90,
  \"maxRetries\": 0,
  \"labels\": { \"app\": \"trace-smoke\" },
  \"payload\": {
    \"captureTrace\": \"on_failure\",
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE_URL}\", \"timeoutSec\": 30 },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"THIS_WILL_FAIL\" }
    ]
  }
}")
TID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
TRES=$(wait_job "$TID" 90)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
st=r.get("status")
result=r.get("result") or {}
art=result.get("artifacts") or {}
url=art.get("traceUrl") or ""
err=art.get("traceError") or ""
key=art.get("traceObjectKey") or ""
print("T-Trace status", st, "traceUrl", bool(url), "traceError", err[:120], "key", key)
if st=="RETRY_WAIT":
    raise SystemExit("stuck RETRY_WAIT")
if st!="FAILED" or result.get("success") is not False:
    raise SystemExit("want FAILED")
if not url and not err:
    raise SystemExit("want traceUrl or traceError")
if not url:
    raise SystemExit("no traceUrl (S3 misconfigured?): "+err)
print("trace_ok")
' "$TRES" && ok "T-Trace-01" || bad "T-Trace-01"

# success path: no traceUrl by default
JOB=$(curl -s "${AUTH[@]}" -H 'content-type: application/json' -X POST "$BASE/v1/jobs" -d "{
  \"name\": \"t-trace-success-no-trace\",
  \"protocol\": \"BROWSER\",
  \"timeoutSec\": 60,
  \"maxRetries\": 0,
  \"payload\": {
    \"steps\": [
      { \"action\": \"navigate\", \"url\": \"${PAGE_URL}\", \"timeoutSec\": 30 },
      { \"action\": \"assertText\", \"selector\": \"#ok\", \"value\": \"hello-hermes\" }
    ]
  }
}")
SID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
SRES=$(wait_job "$SID" 60)
python3 -c '
import json,sys
r=json.loads(sys.argv[1])
result=r.get("result") or {}
art=result.get("artifacts") or {}
if r.get("status")!="SUCCESS":
    raise SystemExit("want SUCCESS")
if art.get("traceUrl"):
    raise SystemExit("success should not have traceUrl by default")
print("no_trace_on_success_ok")
' "$SRES" && ok "T-Trace success has no traceUrl" || bad "T-Trace success no-trace"

# --- T-Prom-01 (journey/vitals live on worker-core; enqueue still on gateway) ---
METRICS_URL="${HERMES_WORKER_METRICS_URL:-http://127.0.0.1:8081/metrics}"
MET=$(curl -s "$METRICS_URL")
python3 -c '
import sys
m=sys.argv[1]
need=[
  "hermes_browser_journey_finished_total",
  "hermes_browser_vitals_ttfb_milliseconds",
  "hermes_browser_vitals_fcp_milliseconds",
  "hermes_browser_vitals_lcp_milliseconds",
]
missing=[n for n in need if n not in m]
print("metrics url bytes", len(m))
if missing:
    raise SystemExit("missing series: "+",".join(missing))
if "hermes_browser_journey_finished_total{" not in m and "hermes_browser_journey_finished_total " not in m:
    raise SystemExit("journey_finished not scraped")
if "hermes_browser_vitals_lcp_milliseconds_bucket" not in m and "hermes_browser_vitals_fcp_milliseconds_bucket" not in m and "hermes_browser_vitals_ttfb_milliseconds_bucket" not in m:
    raise SystemExit("no vitals histogram buckets (did Observe run on success vitals?)")
print("prom_ok")
' "$MET" && ok "T-Prom-01" || bad "T-Prom-01"

echo "---- vitals/trace/prom: PASS=$PASS FAIL=$FAIL ----"
[[ "$FAIL" -eq 0 ]]
