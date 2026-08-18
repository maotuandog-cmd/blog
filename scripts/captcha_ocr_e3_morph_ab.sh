#!/usr/bin/env bash
# E3 morph-weight A/B then dual session with chosen default (0.8).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLVER_DIR="$ROOT/captcha-solver"
LOG_DIR="${HERMES_LOG_DIR:-/tmp/hermes-logs}"
mkdir -p "$LOG_DIR"
ROUNDS="${ROUNDS:-50}"
SLEEP_MS="${SLEEP_MS:-15}"
WEIGHTS=(${WEIGHTS:-1.0 0.8 0.0})

kill_solver() {
  local pid
  pid=$(ss -ltnp 2>/dev/null | grep 18085 | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  if [[ -n "${pid:-}" ]]; then kill -9 "$pid" 2>/dev/null || true; fi
  sleep 0.6
}

start_solver() {
  local mw="$1"
  kill_solver
  (
    cd "$SOLVER_DIR"
    HERMES_CAPTCHA_SOLVER_HOST=127.0.0.1 \
    HERMES_CAPTCHA_SOLVER_PORT=18085 \
    HERMES_CAPTCHA_OCR=auto \
    HERMES_CAPTCHA_OCR_MIN_CONF=0.5 \
    HERMES_CAPTCHA_OCR_SOFT_CONF=0.45 \
    HERMES_CAPTCHA_OCR_LEN=6 \
    HERMES_CAPTCHA_OCR_CHARSET='23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' \
    HERMES_CAPTCHA_OCR_CASE=lower \
    HERMES_CAPTCHA_OCR_BETA=1 \
    HERMES_CAPTCHA_OCR_AGREE=1 \
    HERMES_CAPTCHA_OCR_MORPH_WEIGHT="$mw" \
    ./.venv/bin/python app.py >"$LOG_DIR/captcha-solver-e3.log" 2>&1 &
  )
  for _ in $(seq 1 25); do
    if curl -sf http://127.0.0.1:18085/health >/dev/null; then return 0; fi
    sleep 0.25
  done
  echo "FAIL: solver unhealthy" >&2
  return 1
}

SUMMARY="$LOG_DIR/e3_morph_ab_summary.txt"
: >"$SUMMARY"
echo "E3 morph A/B ROUNDS=$ROUNDS weights=${WEIGHTS[*]}" | tee -a "$SUMMARY"

for mw in "${WEIGHTS[@]}"; do
  echo "==== morph_weight=$mw ====" | tee -a "$SUMMARY"
  start_solver "$mw"
  echo "health=$(curl -s http://127.0.0.1:18085/health)" | tee -a "$SUMMARY"
  out="$LOG_DIR/e3_morph_${mw}.txt"
  (
    cd "$ROOT"
    BENCH_LABEL="E3-morph=$mw" ROUNDS="$ROUNDS" SLEEP_MS="$SLEEP_MS" RETRIES=0 \
      captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py
  ) | tee "$out"
  grep -E '^(LABEL|PASS_RATE|FIRST_|ACCEPTED_|report_)' "$out" | tee -a "$SUMMARY"
  echo "" | tee -a "$SUMMARY"
done

# Sessions with default 0.8
start_solver 0.8
for tag in a b; do
  echo "==== session RETRIES=2 tag=$tag ====" | tee -a "$SUMMARY"
  out="$LOG_DIR/e3_session_${tag}.txt"
  (
    cd "$ROOT"
    BENCH_LABEL="E3-morph=0.8-r2-$tag" ROUNDS=40 SLEEP_MS="$SLEEP_MS" RETRIES=2 \
      captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py
  ) | tee "$out"
  grep -E '^(LABEL|PASS_RATE|FIRST_|ACCEPTED_|report_)' "$out" | tee -a "$SUMMARY"
  echo "" | tee -a "$SUMMARY"
done

echo "summary=$SUMMARY"
