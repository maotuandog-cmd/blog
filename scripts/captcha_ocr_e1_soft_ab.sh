#!/usr/bin/env bash
# E1 soft-threshold A/B: restart solver per soft, run 50-round first-try bench.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLVER_DIR="$ROOT/captcha-solver"
LOG_DIR="${HERMES_LOG_DIR:-/tmp/hermes-logs}"
mkdir -p "$LOG_DIR"
ROUNDS="${ROUNDS:-50}"
SLEEP_MS="${SLEEP_MS:-15}"
SOFTS=(${SOFTS:-0.40 0.45 0.50 0.55})

kill_solver() {
  pkill -f "$SOLVER_DIR/.venv/bin/python app.py" 2>/dev/null || true
  sleep 0.6
}

start_solver() {
  local soft="$1"
  kill_solver
  (
    cd "$SOLVER_DIR"
    HERMES_CAPTCHA_SOLVER_HOST=127.0.0.1 \
    HERMES_CAPTCHA_SOLVER_PORT=18085 \
    HERMES_CAPTCHA_OCR=auto \
    HERMES_CAPTCHA_OCR_MIN_CONF=0.5 \
    HERMES_CAPTCHA_OCR_SOFT_CONF="$soft" \
    HERMES_CAPTCHA_OCR_LEN=6 \
    HERMES_CAPTCHA_OCR_CHARSET='23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' \
    HERMES_CAPTCHA_OCR_CASE=lower \
    HERMES_CAPTCHA_OCR_BETA=1 \
    ./.venv/bin/python app.py >"$LOG_DIR/captcha-solver-e1.log" 2>&1 &
  )
  for _ in $(seq 1 20); do
    if curl -sf http://127.0.0.1:18085/health >/dev/null; then
      return 0
    fi
    sleep 0.3
  done
  echo "FAIL: solver did not become healthy" >&2
  return 1
}

SUMMARY="$LOG_DIR/e1_soft_ab_summary.txt"
: >"$SUMMARY"
echo "E1 soft A/B ROUNDS=$ROUNDS softs=${SOFTS[*]}" | tee -a "$SUMMARY"

for soft in "${SOFTS[@]}"; do
  echo "==== soft=$soft ====" | tee -a "$SUMMARY"
  start_solver "$soft"
  health=$(curl -s http://127.0.0.1:18085/health)
  echo "health=$health" | tee -a "$SUMMARY"
  out="$LOG_DIR/e1_soft_${soft}.txt"
  (
    cd "$ROOT"
    BENCH_LABEL="E1-soft=$soft" ROUNDS="$ROUNDS" SLEEP_MS="$SLEEP_MS" RETRIES=0 \
      captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py
  ) | tee "$out"
  grep -E '^(LABEL|PASS_RATE|FIRST_|ACCEPTED_|report_)' "$out" | tee -a "$SUMMARY"
  echo "" | tee -a "$SUMMARY"
done

echo "summary=$SUMMARY"
