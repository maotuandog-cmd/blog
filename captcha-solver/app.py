#!/usr/bin/env python3
"""CAPTCHA Solver API — independent of worker-browser / Playwright.

Hermes adapter (frozen):  POST /captcha
Suggested aliases:        POST /v1/captcha/solve  POST /v1/captcha/detect
Health:                   GET  /health
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from solvers.classify import classify  # noqa: E402
from solvers.decode import decode_image, extract_b64  # noqa: E402
from solvers.dispatch import solve_request  # noqa: E402
from solvers.feedback import record_feedback  # noqa: E402
from solvers.ocr import (  # noqa: E402
    agree_gate_enabled,
    ddddocr_available,
    min_conf,
    morph_weight,
    ocr_mode,
    soft_conf,
)
from solvers.profile import default_profile_name, list_profile_names  # noqa: E402
from solvers.vlm import vlm_mode, vlm_model, vlm_ready, vlm_url  # noqa: E402

HOST = os.environ.get("HERMES_CAPTCHA_SOLVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("HERMES_CAPTCHA_SOLVER_PORT", "18085"))
API_KEY = os.environ.get("HERMES_CAPTCHA_API_KEY") or os.environ.get(
    "CAPTCHA_SOLVER_API_KEY", ""
)


def _slim_log(job: str, body: dict) -> None:
    print(
        "[captcha-solver]"
        f" job={job or '-'}"
        f" session={body.get('sessionId') or '-'}"
        f" attempt={body.get('attemptId') or '-'}"
        f" kind={body.get('kind')}"
        f" solved={body.get('solved')}"
        f" text={body.get('text') or ''}"
        f" offsetX={body.get('offsetX')}"
        f" points={len(body.get('points') or [])}"
        f" confidence={body.get('confidence')}"
        f" engine={body.get('engine') or '-'}"
        f" preprocess={body.get('preprocess') or '-'}"
        f" votes={body.get('votes')}"
        f" vlmUsed={body.get('vlmUsed')}"
        f" decision={(body.get('observation') or {}).get('decision', {}).get('action') or body.get('decision')}"
        f" profile={body.get('profile') or '-'}"
        f" latency_ms={body.get('latency_ms')}"
        f" reason={body.get('reason') or ''}",
        flush=True,
    )


class SolverHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # noqa: ARG002
        return

    def _json(self, code: int, obj: dict) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth_ok(self) -> bool:
        if not API_KEY:
            return True
        got = self.headers.get("Authorization") or ""
        return got == f"Bearer {API_KEY}"

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/health", "/healthz", "/v1/captcha/health"):
            self._json(
                200,
                {
                    "ok": True,
                    "service": "captcha-solver",
                    "engines": ["ocr", "slider", "click"],
                    "ocrMode": ocr_mode(),
                    "ddddocr": ddddocr_available(),
                    "ocrMinConf": min_conf(),
                    "ocrSoftConf": soft_conf(),
                    "ocrAgree": agree_gate_enabled(),
                    "ocrMorphWeight": morph_weight(),
                    "vlmMode": vlm_mode(),
                    "vlmReady": vlm_ready(),
                    "vlmUrl": vlm_url() or None,
                    "vlmModel": vlm_model() if vlm_mode() != "off" else None,
                    "hermesWebhook": "/captcha",
                    "feedback": "/captcha/feedback",
                    "profileDefault": default_profile_name(),
                    "profiles": list_profile_names(),
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._auth_ok():
            self._json(401, {"solved": False, "success": False, "reason": "unauthorized"})
            return
        path = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            req = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            req = {}
        if not isinstance(req, dict):
            req = {}
        job = str(req.get("jobId") or req.get("session_id") or "")

        if path in ("/v1/captcha/detect", "/captcha/detect"):
            b64 = extract_b64(req)
            if not b64:
                self._json(200, {"solved": False, "success": False, "reason": "missing screenshotBase64"})
                return
            try:
                img = decode_image(b64)
            except Exception as exc:  # noqa: BLE001
                self._json(200, {"solved": False, "success": False, "reason": "invalid screenshot: " + type(exc).__name__})
                return
            kind, conf = classify(img, req)
            self._json(
                200,
                {
                    "success": True,
                    "type": kind,
                    "kind": kind,
                    "confidence": round(float(conf), 4),
                },
            )
            return

        if path in ("/captcha/feedback", "/v1/captcha/feedback"):
            body = record_feedback(req)
            print(
                "[captcha-solver] feedback"
                f" session={body.get('sessionId') or '-'}"
                f" attempt={body.get('attemptId') or '-'}"
                f" status={(body.get('verifyResult') or {}).get('status')}"
                f" linked={body.get('linked')}"
                f" ok={body.get('ok')}",
                flush=True,
            )
            self._json(200, body)
            return

        if path in ("/captcha", "/v1/captcha/solve", "/solve"):
            body = solve_request(req)
            _slim_log(job, body)
            self._json(200, body)
            return

        self._json(404, {"solved": False, "success": False, "reason": "not found"})


def serve(host: str = HOST, port: int = PORT) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), SolverHandler)
    return httpd


def main() -> None:
    httpd = serve()
    print(
        f"captcha-solver {HOST}:{PORT}  POST /captcha  (Hermes HERMES_CAPTCHA_WEBHOOK)"
        f"  ocr={ocr_mode()} ddddocr={ddddocr_available()}",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
