#!/usr/bin/env python3
"""Bench captcha pass-rate via remote Ollama (vision) + captcha-demo verify.

Flow per round:
  1. GET  {demo}/api/captcha          → PNG + captcha_session cookie
  2. POST Ollama (system prompt + image) → JSON {text,status,...}
  3. Only status=success (+ optional min conf) → verify
  4. uncertain/failed/empty → EMPTY (no verify)

Usage:
  captcha-solver/.venv/bin/python scripts/ollama_captcha_bench.py
  ROUNDS=40 BENCH_LABEL=ollama-json-v2 \\
    captcha-solver/.venv/bin/python scripts/ollama_captcha_bench.py

Prompt:
  default file scripts/prompts/ollama_captcha_ocr_v2.txt
  override: OLLAMA_PROMPT / OLLAMA_PROMPT_FILE

Writes:
  reports/ollama_captcha_bench_<ts>.json|.md
  reports/ollama_captcha_fails_<ts>/
"""
from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEMO = (os.environ.get("CAPTCHA_DEMO_URL") or "http://192.168.85.144:3000").rstrip("/")
OLLAMA_BASE = (os.environ.get("OLLAMA_BASE_URL") or "http://192.168.3.16:11434").rstrip("/")
OLLAMA_MODEL = (os.environ.get("OLLAMA_MODEL") or "qwen2.5vl:7b").strip()
ROUNDS = max(1, int(os.environ.get("ROUNDS") or "40"))
OLLAMA_TIMEOUT_S = max(5, int(os.environ.get("OLLAMA_TIMEOUT_S") or "180"))
SLEEP_MS = max(0, int(os.environ.get("SLEEP_MS") or "100"))
OUT_DIR = Path(os.environ.get("REPORT_DIR") or (ROOT / "reports"))
LABEL = (os.environ.get("BENCH_LABEL") or "ollama-json-v2").strip() or "ollama-json-v2"
USER_HINT = (
    os.environ.get("OLLAMA_USER_HINT") or "识别这张验证码，只输出 JSON。"
).strip()
# Only submit verify when model status=success and confidence >= this (0-100).
MIN_CONF = max(0, min(100, int(os.environ.get("OLLAMA_MIN_CONF") or "85")))
# Also reject forbidden charset chars (demo excludes 0 O 1 I l).
FORBIDDEN = set("0O1Il")
LEGAL = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ23456789")
SAVE_FAILS = (os.environ.get("SAVE_FAILS") or "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

DEFAULT_PROMPT_FILE = ROOT / "scripts" / "prompts" / "ollama_captcha_ocr_v2.txt"


def _load_system_prompt() -> str:
    raw_env = (os.environ.get("OLLAMA_PROMPT") or "").strip()
    if raw_env:
        return raw_env
    path = Path(os.environ.get("OLLAMA_PROMPT_FILE") or DEFAULT_PROMPT_FILE)
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    return (
        "Read the captcha. Reply with ONLY JSON: "
        '{"text":"...","length":N,"confidence":0-100,"characters":[],'
        '"status":"success|uncertain|failed"}'
    )


SYSTEM_PROMPT = _load_system_prompt()


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return float(sorted_vals[f])
    return float(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f))


def _http(
    url: str,
    *,
    method: str = "GET",
    data: dict | bytes | None = None,
    opener: urllib.request.OpenerDirector | None = None,
    headers: dict | None = None,
    timeout: float = 60.0,
) -> tuple[int, dict | bytes | str]:
    body: bytes | None = None
    hdrs = dict(headers or {})
    if isinstance(data, dict):
        body = json.dumps(data).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    elif isinstance(data, (bytes, bytearray)):
        body = bytes(data)
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    open_fn = opener.open if opener else urllib.request.urlopen
    try:
        with open_fn(req, timeout=timeout) as res:
            raw = res.read()
            ctype = (res.headers.get("Content-Type") or "").lower()
            if "json" in ctype or (raw[:1] in (b"{", b"[")):
                return int(res.status), json.loads(raw.decode() or "{}")
            if "text/" in ctype:
                return int(res.status), raw.decode(errors="replace")
            return int(res.status), raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return int(e.code), json.loads(raw.decode() or "{}")
        except Exception:
            return int(e.code), {"error": raw.decode(errors="replace")[:500]}


def fetch_captcha(opener: urllib.request.OpenerDirector) -> bytes:
    code, payload = _http(f"{DEMO}/api/captcha", opener=opener, timeout=30.0)
    if code != 200 or not isinstance(payload, (bytes, bytearray)):
        raise RuntimeError(f"captcha image failed status={code} type={type(payload)}")
    return bytes(payload)


def verify(opener: urllib.request.OpenerDirector, text: str) -> dict:
    code, payload = _http(
        f"{DEMO}/api/captcha/verify",
        method="POST",
        data={"code": text},
        opener=opener,
        timeout=30.0,
    )
    if not isinstance(payload, dict):
        return {"success": False, "message": f"non-json status={code}", "_http": code}
    payload["_http"] = code
    return payload


def _extract_chat_text(resp: dict) -> str:
    choices = resp.get("choices") or []
    if choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for p in content:
                if isinstance(p, dict) and p.get("type") == "text":
                    parts.append(str(p.get("text") or ""))
                elif isinstance(p, str):
                    parts.append(p)
            return "".join(parts).strip()
        return str(content or "").strip()
    msg = resp.get("message") or {}
    return str(msg.get("content") or resp.get("response") or "").strip()


def extract_json_object(raw: str) -> dict[str, Any] | None:
    """Parse model output as JSON object; tolerate markdown fences / leading junk."""
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def sanitize_text(text: str) -> str:
    """Keep legal charset only; drop whitespace; preserve case for verify (demo lowercases)."""
    out: list[str] = []
    for ch in (text or "").strip():
        if ch in FORBIDDEN:
            continue
        if ch in LEGAL:
            out.append(ch)
    return "".join(out)


def decide_submission(parsed: dict[str, Any] | None, raw: str) -> dict[str, Any]:
    """Map model JSON → submit decision.

    Returns keys: candidate, modelStatus, confidence, submit, skipReason, parsed
    """
    if parsed is None:
        # Legacy plain-text fallback (should be rare with v2 prompt).
        cand = sanitize_text(raw)
        if not cand:
            return {
                "candidate": "",
                "modelStatus": "parse_error",
                "confidence": None,
                "submit": False,
                "skipReason": "json_parse_failed",
                "parsed": None,
            }
        return {
            "candidate": cand.lower(),
            "modelStatus": "legacy_plain",
            "confidence": None,
            "submit": True,
            "skipReason": "",
            "parsed": None,
        }

    status = str(parsed.get("status") or "").strip().lower()
    conf_raw = parsed.get("confidence")
    try:
        conf = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        conf = None

    text = sanitize_text(str(parsed.get("text") or ""))
    # Prefer lowercase for demo verify (hash is lowercased).
    candidate = text.lower()

    if status in ("failed", "fail"):
        return {
            "candidate": candidate,
            "modelStatus": "failed",
            "confidence": conf,
            "submit": False,
            "skipReason": "model_failed",
            "parsed": parsed,
        }
    if status in ("uncertain", "unsure"):
        return {
            "candidate": candidate,
            "modelStatus": "uncertain",
            "confidence": conf,
            "submit": False,
            "skipReason": "model_uncertain",
            "parsed": parsed,
        }
    if status and status != "success":
        return {
            "candidate": candidate,
            "modelStatus": status,
            "confidence": conf,
            "submit": False,
            "skipReason": f"unknown_status:{status}",
            "parsed": parsed,
        }

    # status success (or missing → treat as success only if text+conf ok)
    if not candidate:
        return {
            "candidate": "",
            "modelStatus": status or "success",
            "confidence": conf,
            "submit": False,
            "skipReason": "empty_text",
            "parsed": parsed,
        }
    if conf is not None and conf < MIN_CONF:
        return {
            "candidate": candidate,
            "modelStatus": "success",
            "confidence": conf,
            "submit": False,
            "skipReason": f"conf<{MIN_CONF}",
            "parsed": parsed,
        }
    # length consistency if provided
    try:
        declared = int(parsed.get("length")) if parsed.get("length") is not None else None
    except (TypeError, ValueError):
        declared = None
    if declared is not None and declared != len(candidate):
        return {
            "candidate": candidate,
            "modelStatus": "success",
            "confidence": conf,
            "submit": False,
            "skipReason": "length_mismatch",
            "parsed": parsed,
        }
    return {
        "candidate": candidate,
        "modelStatus": "success",
        "confidence": conf,
        "submit": True,
        "skipReason": "",
        "parsed": parsed,
    }


def ollama_recognize(png: bytes) -> tuple[str, str, float]:
    """Return (raw_text, api_used, latency_ms). Raises on transport/API failure."""
    b64 = base64.b64encode(png).decode("ascii")
    data_url = "data:image/png;base64," + b64
    # Larger max_tokens for JSON schema.
    openai_payload = {
        "model": OLLAMA_MODEL,
        "temperature": 0,
        "max_tokens": 512,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": USER_HINT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    }
    t0 = time.perf_counter()
    code, payload = _http(
        f"{OLLAMA_BASE}/v1/chat/completions",
        method="POST",
        data=openai_payload,
        timeout=float(OLLAMA_TIMEOUT_S),
    )
    if code < 400 and isinstance(payload, dict) and (
        payload.get("choices") or payload.get("message") or payload.get("response")
    ):
        ms = (time.perf_counter() - t0) * 1000.0
        return _extract_chat_text(payload), "openai_v1", ms

    native_payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "options": {"temperature": 0},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": USER_HINT,
                "images": [b64],
            },
        ],
    }
    t1 = time.perf_counter()
    code2, payload2 = _http(
        f"{OLLAMA_BASE}/api/chat",
        method="POST",
        data=native_payload,
        timeout=float(OLLAMA_TIMEOUT_S),
    )
    ms = (time.perf_counter() - t1) * 1000.0
    if code2 >= 400 or not isinstance(payload2, dict):
        err = payload2 if isinstance(payload2, dict) else {"error": str(payload2)[:300]}
        raise RuntimeError(
            f"ollama failed openai_status={code} native_status={code2} err={err}"
        )
    return _extract_chat_text(payload2), "ollama_native", ms


def probe() -> None:
    print(f"demo={DEMO}")
    print(f"ollama={OLLAMA_BASE} model={OLLAMA_MODEL}")
    print(f"rounds={ROUNDS} timeout_s={OLLAMA_TIMEOUT_S} label={LABEL} minConf={MIN_CONF}")
    print(f"systemPromptChars={len(SYSTEM_PROMPT)}")
    dcode, _ = _http(DEMO + "/", timeout=10.0)
    print(f"demo home status={dcode}")
    for path in ("/api/tags", "/v1/models"):
        try:
            code, payload = _http(OLLAMA_BASE + path, timeout=10.0)
            if isinstance(payload, dict):
                models = []
                if "models" in payload and isinstance(payload["models"], list):
                    models = [
                        str(m.get("name") or m.get("model") or "")
                        for m in payload["models"]
                        if isinstance(m, dict)
                    ]
                elif "data" in payload and isinstance(payload["data"], list):
                    models = [
                        str(m.get("id") or "")
                        for m in payload["data"]
                        if isinstance(m, dict)
                    ]
                print(f"ollama {path} status={code} models={models[:12]}")
                return
            print(f"ollama {path} status={code}")
        except Exception as e:
            print(f"ollama {path} probe failed: {e}")
    raise RuntimeError(f"cannot reach ollama at {OLLAMA_BASE}")


def write_reports(
    *,
    ts: str,
    rows: list[dict],
    summary: dict,
    fail_dir: Path,
) -> tuple[Path, Path]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": ts,
        "label": LABEL,
        "demo": DEMO,
        "ollamaBase": OLLAMA_BASE,
        "ollamaModel": OLLAMA_MODEL,
        "minConf": MIN_CONF,
        "promptFile": str(DEFAULT_PROMPT_FILE),
        "rounds": ROUNDS,
        "summary": summary,
        "rows": rows,
    }
    json_path = OUT_DIR / f"ollama_captcha_bench_{ts}.json"
    md_path = OUT_DIR / f"ollama_captcha_bench_{ts}.md"
    latest_json = OUT_DIR / "ollama_captcha_bench_latest.json"
    latest_md = OUT_DIR / "ollama_captcha_bench_latest.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest_json.write_text(json_path.read_text(encoding="utf-8"), encoding="utf-8")

    status_counts = summary["statusCounts"]
    lines = [
        f"# Ollama Captcha Bench ({LABEL})",
        "",
        f"- ts: `{ts}`",
        f"- demo: `{DEMO}`",
        f"- ollama: `{OLLAMA_BASE}` model=`{OLLAMA_MODEL}`",
        f"- minConf: `{MIN_CONF}` (only status=success submits)",
        f"- rounds: **{ROUNDS}**",
        f"- fail artifacts: `{fail_dir if SAVE_FAILS else 'disabled'}`",
        "",
        "## Metrics",
        "",
        "| Metric | Value |",
        "|--------|------:|",
        f"| Pass rate | {summary['passRate']:.4f} ({summary['pass']}/{ROUNDS}) |",
        f"| Submit rate | {summary['submitRate']:.4f} ({summary['submitted']}/{ROUNDS}) |",
        f"| Precision | {summary['precision'] if summary['precision'] is not None else 'n/a'} |",
        f"| Empty/skip rate | {summary['emptyRate']:.4f} ({summary['empty']}/{ROUNDS}) |",
        f"| Error rate | {summary['errorRate']:.4f} ({summary['error']}/{ROUNDS}) |",
        f"| Fail (wrong code) | {summary['fail']}/{ROUNDS} |",
        f"| Ollama p50 / p95 (ms) | {summary['ollamaP50Ms']} / {summary['ollamaP95Ms']} |",
        f"| E2E p50 / p95 (ms) | {summary['e2eP50Ms']} / {summary['e2eP95Ms']} |",
        "",
        "## Status counts",
        "",
    ]
    for k, v in sorted(status_counts.items()):
        lines.append(f"- `{k}`: {v}")
    if summary.get("skipReasons"):
        lines.extend(["", "## Skip reasons (EMPTY)", ""])
        for k, v in sorted(summary["skipReasons"].items(), key=lambda x: -x[1]):
            lines.append(f"- `{k}`: {v}")
    lines.extend(["", "## Sample rows", ""])
    for row in rows[:15]:
        lines.append(
            f"- r{row['round']}: status={row['status']} model={row.get('modelStatus')} "
            f"cand={row.get('candidate')!r} conf={row.get('confidence')} "
            f"skip={row.get('skipReason')!r}"
        )
    if len(rows) > 15:
        lines.append(f"- ... ({len(rows) - 15} more)")
    md = "\n".join(lines) + "\n"
    md_path.write_text(md, encoding="utf-8")
    latest_md.write_text(md, encoding="utf-8")
    return json_path, md_path


def main() -> int:
    try:
        probe()
    except Exception as e:
        print(f"FAIL: probe: {e}", file=sys.stderr)
        return 2

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    fail_dir = OUT_DIR / f"ollama_captcha_fails_{ts}"
    if SAVE_FAILS:
        fail_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    ollama_ms_list: list[float] = []
    e2e_ms_list: list[float] = []
    status_counter: Counter[str] = Counter()
    skip_reasons: Counter[str] = Counter()

    for i in range(1, ROUNDS + 1):
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        row: dict = {
            "round": i,
            "candidate": "",
            "rawResponse": "",
            "modelStatus": "",
            "confidence": None,
            "skipReason": "",
            "api": "",
            "verifyOk": None,
            "ollamaMs": None,
            "e2eMs": None,
            "status": "ERROR",
            "message": "",
        }
        t_round = time.perf_counter()
        png: bytes | None = None
        try:
            png = fetch_captcha(opener)
            row["pngBytes"] = len(png)
            raw, api, ollama_ms = ollama_recognize(png)
            row["rawResponse"] = raw[:800]
            row["api"] = api
            row["ollamaMs"] = round(ollama_ms, 1)
            ollama_ms_list.append(ollama_ms)

            parsed = extract_json_object(raw)
            decision = decide_submission(parsed, raw)
            row["candidate"] = decision["candidate"]
            row["modelStatus"] = decision["modelStatus"]
            row["confidence"] = decision["confidence"]
            row["skipReason"] = decision["skipReason"]
            if decision.get("parsed") is not None:
                row["parsed"] = {
                    "status": decision["parsed"].get("status"),
                    "length": decision["parsed"].get("length"),
                    "confidence": decision["parsed"].get("confidence"),
                    "text": decision["parsed"].get("text"),
                }

            if not decision["submit"]:
                row["status"] = "EMPTY"
                row["message"] = decision["skipReason"] or "not submitted"
                skip_reasons[decision["skipReason"] or "unknown"] += 1
            else:
                vr = verify(opener, decision["candidate"])
                ok = bool(vr.get("success"))
                row["verifyOk"] = ok
                row["verifyHttp"] = vr.get("_http")
                row["message"] = str(vr.get("message") or "")[:200]
                row["status"] = "PASS" if ok else "FAIL"
        except Exception as e:
            row["status"] = "ERROR"
            row["message"] = str(e)[:400]
        row["e2eMs"] = round((time.perf_counter() - t_round) * 1000.0, 1)
        e2e_ms_list.append(float(row["e2eMs"]))
        status_counter[row["status"]] += 1
        rows.append(row)
        print(
            f"[{i}/{ROUNDS}] status={row['status']} model={row.get('modelStatus')} "
            f"cand={row['candidate']!r} conf={row.get('confidence')} "
            f"skip={row.get('skipReason')!r} ollamaMs={row['ollamaMs']}"
        )

        if SAVE_FAILS and png is not None and row["status"] != "PASS":
            stem = f"r{i:04d}_{row['status'].lower()}"
            (fail_dir / f"{stem}.png").write_bytes(png)
            (fail_dir / f"{stem}.json").write_text(
                json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        if SLEEP_MS and i < ROUNDS:
            time.sleep(SLEEP_MS / 1000.0)

    submitted = status_counter["PASS"] + status_counter["FAIL"]
    pass_n = status_counter["PASS"]
    empty_n = status_counter["EMPTY"]
    error_n = status_counter["ERROR"]
    fail_n = status_counter["FAIL"]
    ollama_sorted = sorted(ollama_ms_list)
    e2e_sorted = sorted(e2e_ms_list)
    precision = (pass_n / submitted) if submitted else None
    summary = {
        "pass": pass_n,
        "fail": fail_n,
        "empty": empty_n,
        "error": error_n,
        "submitted": submitted,
        "passRate": pass_n / ROUNDS,
        "submitRate": submitted / ROUNDS,
        "emptyRate": empty_n / ROUNDS,
        "errorRate": error_n / ROUNDS,
        "precision": None if precision is None else round(precision, 4),
        "statusCounts": dict(status_counter),
        "skipReasons": dict(skip_reasons),
        "ollamaP50Ms": None
        if not ollama_sorted
        else round(_percentile(ollama_sorted, 50) or 0.0, 1),
        "ollamaP95Ms": None
        if not ollama_sorted
        else round(_percentile(ollama_sorted, 95) or 0.0, 1),
        "ollamaMeanMs": None
        if not ollama_sorted
        else round(statistics.fmean(ollama_sorted), 1),
        "e2eP50Ms": None if not e2e_sorted else round(_percentile(e2e_sorted, 50) or 0.0, 1),
        "e2eP95Ms": None if not e2e_sorted else round(_percentile(e2e_sorted, 95) or 0.0, 1),
    }
    json_path, md_path = write_reports(ts=ts, rows=rows, summary=summary, fail_dir=fail_dir)
    print("---")
    print(
        f"passRate={summary['passRate']:.4f} submitRate={summary['submitRate']:.4f} "
        f"precision={summary['precision']} empty={empty_n} error={error_n}"
    )
    print(f"skipReasons={dict(skip_reasons)}")
    print(f"report: {md_path}")
    print(f"json:   {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
