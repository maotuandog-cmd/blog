.PHONY: test test-go test-node test-captcha-solver smoke smoke-agent smoke-browser smoke-ops smoke-lease smoke-vitals smoke-auth smoke-all build up

test: test-go test-node test-captcha-solver

test-go:
	go test ./... -count=1

test-node:
	cd worker-browser && npm test
	cd hermes-ui && npm test

test-captcha-solver:
	cd captcha-solver && \
	if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi; \
	$$PY -m unittest discover -s tests -t . -v

smoke:
	@chmod +x scripts/smoke.sh
	HERMES_API_INSECURE=true ./scripts/smoke.sh

# T02: requires gateway + worker-core + browser-worker with HERMES_LLM_MOCK=true
smoke-agent:
	@chmod +x scripts/agent_mock_smoke.sh
	HERMES_API_INSECURE=true ./scripts/agent_mock_smoke.sh

# T01 + no-retry: S12 / S13 / assert→FAILED (needs browser-worker + Chromium)
smoke-browser:
	@chmod +x scripts/browser_smoke.sh
	HERMES_API_INSECURE=true ./scripts/browser_smoke.sh

# cancel / rerun / drain / reclaim
smoke-ops:
	@chmod +x scripts/ops_smoke.sh
	HERMES_API_INSECURE=true ./scripts/ops_smoke.sh

# T03 dual-worker exactly-once · T04 kill+reclaim (manages temporary worker-core)
smoke-lease:
	@chmod +x scripts/t03_t04_smoke.sh
	HERMES_API_INSECURE=true ./scripts/t03_t04_smoke.sh

# T-Vitals / T-Trace / T-Prom (needs browser-worker + HERMES_S3_* for Trace upload)
smoke-vitals:
	@chmod +x scripts/vitals_trace_smoke.sh
	HERMES_API_INSECURE=true ./scripts/vitals_trace_smoke.sh

# T-Cred / T-CapAuto (static login + mock webhook; restarts browser-worker)
smoke-auth:
	@chmod +x scripts/auth_captcha_smoke.sh scripts/auth_e2e_server.py
	HERMES_API_INSECURE=true ./scripts/auth_captcha_smoke.sh

# Unit + core smoke + ops (+ agent/browser/auth when stack ready)
smoke-all: test smoke smoke-ops
	@echo "---- smoke-all core done; optional: make smoke-agent smoke-browser smoke-auth smoke-lease smoke-vitals ----"

# Local stack: redis + gateway + dispatcher + worker-core + browser-worker
up:
	@chmod +x scripts/dev-up.sh
	./scripts/dev-up.sh

build:
	go build -o bin/gateway ./cmd/gateway
	go build -o bin/worker-core ./cmd/worker-core
	go build -o bin/dispatcher ./cmd/dispatcher
	cd worker-browser && npm run build
	cd hermes-ui && npm run build
