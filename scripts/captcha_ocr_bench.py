#!/usr/bin/env python3
"""Multi-round OCR accuracy bench against captcha-demo (:3000) + captcha-solver.

Flow per round:
  1. GET  {demo}/api/captcha          → PNG + captcha_session cookie
  2. POST {solver}/captcha            → OCR text (Hermes webhook contract)
  3. POST {demo}/api/captcha/verify   → success / fail (ground truth via live verify)

Decision metrics (first attempt of each round):
  accept  = solver returned text (would submit)
  correct = accept + verify OK
  wrong   = accept + verify FAIL
  abstain = no text / unsolved
  acceptedPrecision = correct / accept

Usage:
  captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py
  ROUNDS=100 CAPTCHA_DEMO_URL=http://192.168.85.144:3000 \\
    CAPTCHA_SOLVER_URL=http://127.0.0.1:18085/captcha \\
    captcha-solver/.venv/bin/python scripts/captcha_ocr_bench.py

Writes:
  reports/captcha_ocr_bench_<ts>.json
  reports/captcha_ocr_bench_<ts>.md
  reports/captcha_ocr_fails_<ts>/  (failed PNGs + meta)
"""
from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = (os.environ.get("CAPTCHA_DEMO_URL") or "http://192.168.85.144:3000").rstrip("/")
SOLVER = (
    os.environ.get("CAPTCHA_SOLVER_URL") or "http://127.0.0.1:18085/captcha"
).rstrip("/")
ROUNDS = max(1, int(os.environ.get("ROUNDS") or "50"))
# Extra captcha refreshes after first fail within a round (session success metric).
RETRIES = max(0, int(os.environ.get("RETRIES") or "0"))
# S4: policy-driven retry (by failure class). Default off so legacy benches stay comparable.
ADAPTIVE_RETRY = (os.environ.get("ADAPTIVE_RETRY") or "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
MAX_ATTEMPTS = max(1, min(5, int(os.environ.get("HERMES_CAPTCHA_MAX_ATTEMPTS") or "2")))
SLEEP_MS = max(0, int(os.environ.get("SLEEP_MS") or "50"))
# Solver may call local 7B VLM (CPU can take minutes); override via SOLVER_TIMEOUT_S.
SOLVER_TIMEOUT_S = max(5, int(os.environ.get("SOLVER_TIMEOUT_S") or "60"))
OUT_DIR = Path(os.environ.get("REPORT_DIR") or (ROOT / "reports"))
LABEL = (os.environ.get("BENCH_LABEL") or "").strip()
PROFILE = (os.environ.get("CAPTCHA_PROFILE") or "demo-strict").strip() or "demo-strict"
# Phase 3: VLM tier — off (default for A/B) or on/auto (C/D separate).
VLM_TIER = (os.environ.get("VLM_TIER") or "off").strip().lower()
if VLM_TIER in ("0", "false", "no", "disabled"):
    VLM_TIER = "off"
if VLM_TIER in ("1", "true", "yes", "auto", "on"):
    VLM_TIER = "on"


def _http_json(
    url: str,
    *,
    method: str = "GET",
    data: dict | None = None,
    opener: urllib.request.OpenerDirector | None = None,
    headers: dict | None = None,
    timeout: float | None = None,
) -> tuple[int, dict | bytes]:
    body = None
    hdrs = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode()
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    open_fn = opener.open if opener else urllib.request.urlopen
    try:
        with open_fn(req, timeout=60 if timeout is None else timeout) as res:
            raw = res.read()
            ctype = (res.headers.get("Content-Type") or "").lower()
            if "json" in ctype or (raw[:1] in (b"{", b"[")):
                return res.status, json.loads(raw.decode() or "{}")
            return res.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode() or "{}")
        except Exception:
            return e.code, {"error": raw.decode(errors="replace")[:300]}


def fetch_captcha(opener: urllib.request.OpenerDirector) -> bytes:
    code, payload = _http_json(f"{DEMO}/api/captcha", opener=opener)
    if code != 200 or not isinstance(payload, (bytes, bytearray)):
        raise RuntimeError(f"captcha image failed status={code} type={type(payload)}")
    return bytes(payload)


def solve_image(
    png: bytes,
    round_i: int,
    *,
    session_id: str,
    kind: str = "image",
    retry_hints: dict | None = None,
) -> dict:
    b64 = base64.b64encode(png).decode()
    data: dict = {
        "jobId": f"bench-{round_i}",
        "pageUrl": DEMO + "/",
        "kind": kind,
        "screenshotBase64": b64,
        "hint": {"source": "captcha-ocr-bench"},
        "sessionId": session_id,
        "profile": PROFILE,
    }
    # Phase 3 VLM tier: force off for A/B; on uses profile (demo-strict = auto/T1).
    if VLM_TIER == "off":
        data["profileOverrides"] = {"vlm": {"mode": "off"}}
    if retry_hints:
        data["retryHints"] = retry_hints
        # retryHints.vlm=off still wins when plan says so
    code, payload = _http_json(
        SOLVER if SOLVER.endswith("/captcha") else SOLVER + "/captcha",
        method="POST",
        data=data,
        timeout=float(SOLVER_TIMEOUT_S),
    )
    if not isinstance(payload, dict):
        return {"solved": False, "reason": f"bad solver response status={code}"}
    payload["_http"] = code
    return payload


def feedback_url() -> str:
    base = SOLVER[: -len("/captcha")] if SOLVER.endswith("/captcha") else SOLVER.rstrip("/")
    return base + "/captcha/feedback"


def post_feedback(
    *,
    session_id: str,
    attempt_id: str,
    status: str,
    reason: str = "",
    latency_ms: int | None = None,
    job_id: str | None = None,
    attempt_index: int = 1,
) -> dict:
    """S3/S4: record verify outcome + optional retryPlan; never changes solver decision."""
    body: dict = {
        "sessionId": session_id,
        "attemptId": attempt_id,
        "jobId": job_id,
        "attemptIndex": attempt_index,
        "includeRetryPlan": True,
        "profile": PROFILE,
        "verifyResult": {
            "status": status,
            "reason": reason,
            "source": "bench",
        },
    }
    if VLM_TIER == "off":
        body["profileOverrides"] = {"vlm": {"mode": "off"}}
    if latency_ms is not None:
        body["verifyResult"]["latencyMs"] = int(latency_ms)
    try:
        code, payload = _http_json(feedback_url(), method="POST", data=body, timeout=10)
        if isinstance(payload, dict):
            payload["_http"] = code
            return payload
        return {"ok": False, "reason": f"non-json status={code}"}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


def verify(opener: urllib.request.OpenerDirector, text: str) -> dict:
    code, payload = _http_json(
        f"{DEMO}/api/captcha/verify",
        method="POST",
        data={"code": text},
        opener=opener,
    )
    if not isinstance(payload, dict):
        return {"success": False, "message": f"non-json status={code}"}
    payload["_http"] = code
    return payload


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    fail_dir = OUT_DIR / f"captcha_ocr_fails_{ts}"
    fail_dir.mkdir(parents=True, exist_ok=True)

    health_url = SOLVER.replace("/captcha", "/health")
    try:
        hcode, health = _http_json(health_url)
    except Exception as e:
        print(f"FAIL: cannot reach solver {health_url}: {e}", file=sys.stderr)
        return 2
    print(f"solver health={hcode} {health}")
    print(f"phase3 profile={PROFILE} vlmTier={VLM_TIER} adaptive={ADAPTIVE_RETRY}")
    if LABEL:
        print(f"bench label={LABEL}")

    try:
        dcode, _ = _http_json(DEMO + "/")
        print(f"demo home status={dcode}")
    except Exception as e:
        print(f"FAIL: cannot reach demo {DEMO}: {e}", file=sys.stderr)
        return 2

    results: list[dict] = []
    t0 = time.time()
    for i in range(1, ROUNDS + 1):
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        row: dict = {
            "round": i,
            "attempts": 0,
            "firstTryOk": False,
            "firstDecision": "abstain",
        }
        last_png: bytes | None = None
        session_id = f"bench_s_{i}"
        retry_hints: dict | None = None
        solve_kind = "image"
        try:
            if ADAPTIVE_RETRY:
                max_tries = MAX_ATTEMPTS
            else:
                max_tries = 1 + RETRIES
            for attempt in range(1, max_tries + 1):
                png = fetch_captcha(opener)
                last_png = png
                row["attempts"] = attempt
                row["pngBytes"] = len(png)
                t_solve = time.time()
                sol = solve_image(
                    png,
                    i * 100 + attempt,
                    session_id=session_id,
                    kind=solve_kind,
                    retry_hints=retry_hints,
                )
                row["solveMs"] = int((time.time() - t_solve) * 1000) + int(row.get("solveMs") or 0)
                row["solved"] = bool(sol.get("solved"))
                row["text"] = sol.get("text") or ""
                row["confidence"] = sol.get("confidence")
                row["engine"] = sol.get("engine")
                row["preprocess"] = sol.get("preprocess")
                row["votes"] = sol.get("votes")
                row["vlmUsed"] = sol.get("vlmUsed")
                row["vlmText"] = sol.get("vlmText")
                row["ddddText"] = sol.get("ddddText")
                row["reason"] = sol.get("reason") or ""
                row["sessionId"] = sol.get("sessionId") or session_id
                row["attemptId"] = sol.get("attemptId")
                row["decision"] = sol.get("decision") or (
                    "accept" if row["solved"] and row["text"] else "abstain"
                )
                row["decisionScore"] = sol.get("decisionScore")
                row["evidenceScore"] = sol.get("evidenceScore")
                row["evidenceScoreRaw"] = sol.get("evidenceScoreRaw")
                row["evidenceScoreAdjusted"] = sol.get("evidenceScoreAdjusted")
                row["evidenceAdjustment"] = sol.get("evidenceAdjustment")
                row["captchaType"] = sol.get("captchaType")
                row["routingHint"] = sol.get("routingHint")
                if row["routingHint"] is None and isinstance(sol.get("observation"), dict):
                    row["routingHint"] = sol["observation"].get("routingHint")
                row["weightShare"] = sol.get("weightShare")
                row["agreementScore"] = sol.get("agreementScore", sol.get("agreement"))
                row["singleton"] = sol.get("singleton")
                row["nValid"] = sol.get("nValid")
                row["classifiedAs"] = sol.get("classifiedAs")
                row["classifierConfidence"] = sol.get("classifierConfidence")
                row["observation"] = sol.get("observation")
                row["profile"] = sol.get("profile")
                row["vlmConflict"] = sol.get("vlmConflict")
                row["characterEvidence"] = sol.get("characterEvidence")
                row["charSummary"] = sol.get("charSummary")
                row["charMinConfidence"] = sol.get("charMinConfidence")
                row["charMeanConfidence"] = sol.get("charMeanConfidence")
                row["charAmbiguousCount"] = sol.get("charAmbiguousCount")
                row["candidateMargin"] = sol.get("candidateMargin")
                row["runnerUpText"] = sol.get("runnerUpText")
                row["runnerUpScore"] = sol.get("runnerUpScore")
                row["tightCandidateMargin"] = sol.get("tightCandidateMargin")
                row["charRunnerUpText"] = sol.get("charRunnerUpText")
                row["charMinMargin"] = sol.get("charMinMargin")
                row["candidateRanking"] = sol.get("candidateRanking")
                row["independentEvidence"] = sol.get("independentEvidence")
                row["sourceAgreement"] = sol.get("sourceAgreement")
                row["secondaryComparison"] = sol.get("secondaryComparison")
                row["comparisonStatus"] = sol.get("comparisonStatus")
                row["comparisonReason"] = sol.get("comparisonReason")
                row["independentAgree"] = sol.get("independentAgree")
                row["independentConflict"] = sol.get("independentConflict")
                row["independentCharDiff"] = sol.get("independentCharDiff")
                row["secondaryText"] = sol.get("secondaryText")
                row["secondarySource"] = sol.get("secondarySource")
                row["secondaryStatus"] = sol.get("secondaryStatus")
                row["secondaryAvailable"] = sol.get("secondaryAvailable")
                row["secondaryReason"] = sol.get("secondaryReason")
                row["sourceUnavailable"] = sol.get("sourceUnavailable")
                row["independentComparable"] = sol.get("independentComparable")
                row["abstainReasonDetail"] = sol.get("abstainReasonDetail")
                row["abstainBucket"] = sol.get("abstainBucket")
                row["abstainCandidateText"] = sol.get("abstainCandidateText")
                if row["abstainReasonDetail"] is None and isinstance(sol.get("observation"), dict):
                    obs = sol["observation"]
                    row["abstainReasonDetail"] = obs.get("abstainReasonDetail")
                    row["abstainBucket"] = obs.get("abstainBucket") or row.get("abstainBucket")
                    row["abstainCandidateText"] = obs.get("abstainCandidateText") or row.get(
                        "abstainCandidateText"
                    )

                if not row["solved"] or not row["text"]:
                    row["ok"] = False
                    row["verifyMessage"] = "solver did not return text"
                    outcome = "abstain"
                    fb_status = "not_executed"
                    t_fb = time.time()
                    fb = post_feedback(
                        session_id=str(row.get("sessionId") or session_id),
                        attempt_id=str(row.get("attemptId") or ""),
                        status=fb_status,
                        reason=row["verifyMessage"] or row.get("reason") or "",
                        job_id=f"bench-{i * 100 + attempt}",
                        attempt_index=attempt,
                    )
                    row["feedback"] = {
                        "status": fb_status,
                        "linked": fb.get("linked"),
                        "ok": fb.get("ok"),
                        "latencyMs": int((time.time() - t_fb) * 1000),
                        "retryPlan": fb.get("retryPlan"),
                    }
                else:
                    t_ver = time.time()
                    ver = verify(opener, str(row["text"]))
                    ver_ms = int((time.time() - t_ver) * 1000)
                    row["ok"] = bool(ver.get("success"))
                    row["verifyMessage"] = ver.get("message") or ""
                    row["verifyHttp"] = ver.get("_http")
                    outcome = "correct" if row["ok"] else "wrong"
                    fb_status = "success" if row["ok"] else "failed"
                    fb = post_feedback(
                        session_id=str(row.get("sessionId") or session_id),
                        attempt_id=str(row.get("attemptId") or ""),
                        status=fb_status,
                        reason=str(row.get("verifyMessage") or ""),
                        latency_ms=ver_ms,
                        job_id=f"bench-{i * 100 + attempt}",
                        attempt_index=attempt,
                    )
                    row["feedback"] = {
                        "status": fb_status,
                        "linked": fb.get("linked"),
                        "ok": fb.get("ok"),
                        "latencyMs": ver_ms,
                        "retryPlan": fb.get("retryPlan"),
                        "decisionScoreUnchanged": (
                            (fb.get("decisionAtRecord") or {}).get("decisionScore")
                            == row.get("decisionScore")
                            and (fb.get("decisionAtRecord") or {}).get("confidence")
                            == row.get("confidence")
                        ),
                    }

                # F1: attribute ACCEPT attempts only (no decision mutation).
                try:
                    if str(ROOT / "captcha-solver") not in sys.path:
                        sys.path.insert(0, str(ROOT / "captcha-solver"))
                    from solvers.false_accept import attribute_accept

                    row["falseAccept"] = attribute_accept(
                        {
                            **row,
                            "observation": row.get("observation") or sol.get("observation"),
                        },
                        feedback=row.get("feedback"),
                        min_conf=0.5,
                    )
                except Exception as exc:  # noqa: BLE001
                    row["falseAccept"] = {
                        "attributed": False,
                        "error": type(exc).__name__,
                        "detail": str(exc)[:120],
                    }

                if attempt == 1:
                    row["firstTryOk"] = bool(row.get("ok"))
                    row["firstTryText"] = row.get("text")
                    row["firstDecision"] = outcome
                    row["firstAccepted"] = outcome in ("correct", "wrong")
                    row["firstVlmUsed"] = bool(row.get("vlmUsed"))
                    row["firstFeedbackStatus"] = fb_status
                    row["firstFalseAccept"] = row.get("falseAccept")
                    row["firstCharSummary"] = row.get("charSummary")
                    row["firstCharMinConfidence"] = row.get("charMinConfidence")
                    row["firstCharacterEvidence"] = row.get("characterEvidence")
                    row["firstCandidateMargin"] = row.get("candidateMargin")
                    row["firstRunnerUpText"] = row.get("runnerUpText")
                    row["firstTightCandidateMargin"] = row.get("tightCandidateMargin")
                    row["firstCharMinMargin"] = row.get("charMinMargin")
                    row["firstIndependentAgree"] = row.get("independentAgree")
                    row["firstIndependentCharDiff"] = row.get("independentCharDiff")
                    row["firstSourceAgreement"] = row.get("sourceAgreement")
                    row["firstSecondaryComparison"] = row.get("secondaryComparison")
                    row["firstComparisonStatus"] = row.get("comparisonStatus")
                    row["firstComparisonReason"] = row.get("comparisonReason")
                    row["firstIndependentConflict"] = row.get("independentConflict")
                    row["firstSecondaryText"] = row.get("secondaryText")
                    row["firstSecondaryAvailable"] = row.get("secondaryAvailable")
                    row["firstSecondarySource"] = row.get("secondarySource")
                    row["firstSourceUnavailable"] = row.get("sourceUnavailable")
                    row["firstEvidenceScore"] = row.get("evidenceScore")
                    row["firstEvidenceScoreRaw"] = row.get("evidenceScoreRaw")
                    row["firstEvidenceScoreAdjusted"] = row.get("evidenceScoreAdjusted")
                    row["firstEvidenceAdjustment"] = row.get("evidenceAdjustment")
                    row["firstCaptchaType"] = row.get("captchaType")
                    row["firstRoutingHint"] = row.get("routingHint")
                    row["firstAbstainReasonDetail"] = row.get("abstainReasonDetail")
                    row["firstAbstainBucket"] = row.get("abstainBucket")
                    row["firstAbstainCandidateText"] = row.get("abstainCandidateText")
                if row.get("ok"):
                    break

                plan = (row.get("feedback") or {}).get("retryPlan") or {}
                if ADAPTIVE_RETRY:
                    row["lastRetryPlan"] = plan
                    if not plan.get("retry"):
                        break
                    retry_hints = dict(plan.get("hints") or {})
                    if plan.get("nextStrategy") == "re_detect" or retry_hints.get("kind") == "auto":
                        solve_kind = "auto"
                    if plan.get("nextStrategy") == "remain_abstain":
                        break
                # legacy RETRIES: continue blindly without strategy hints

            if not row.get("ok") and last_png is not None:
                img_path = fail_dir / f"r{i:04d}.png"
                img_path.write_bytes(last_png)
                meta_path = fail_dir / f"r{i:04d}.json"
                meta_path.write_text(
                    json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                row["failImage"] = str(img_path.relative_to(ROOT))
        except Exception as e:
            row["ok"] = False
            row["error"] = str(e)
        results.append(row)
        mark = "OK" if row.get("ok") else "FAIL"
        retry_note = ""
        if ADAPTIVE_RETRY or RETRIES:
            retry_note = f" tries={row.get('attempts')}"
            if ADAPTIVE_RETRY and row.get("lastRetryPlan"):
                rp = row["lastRetryPlan"]
                retry_note += f" plan={rp.get('failureClass')}/{rp.get('nextStrategy')}"
        print(
            f"[{i}/{ROUNDS}] {mark}{retry_note} dec={row.get('firstDecision')} "
            f"text={row.get('text')!r} conf={row.get('confidence')} "
            f"eng={row.get('engine')} vlm={row.get('vlmUsed')} pp={row.get('preprocess')} "
            f"msg={row.get('verifyMessage') or row.get('reason') or row.get('error')}"
        )
        if SLEEP_MS:
            time.sleep(SLEEP_MS / 1000.0)

    elapsed = time.time() - t0
    ok_n = sum(1 for r in results if r.get("ok"))
    first_ok_n = sum(1 for r in results if r.get("firstTryOk"))
    solved_n = sum(1 for r in results if r.get("solved") and r.get("text"))
    pass_rate = ok_n / ROUNDS
    first_pass_rate = first_ok_n / ROUNDS
    solve_rate = solved_n / ROUNDS

    first_correct = sum(1 for r in results if r.get("firstDecision") == "correct")
    first_wrong = sum(1 for r in results if r.get("firstDecision") == "wrong")
    first_abstain = sum(1 for r in results if r.get("firstDecision") == "abstain")
    first_accept = first_correct + first_wrong
    accepted_precision = (first_correct / first_accept) if first_accept else None
    false_accept_rate = (first_wrong / first_accept) if first_accept else None
    abstain_rate = first_abstain / ROUNDS if ROUNDS else 0.0

    by_engine = Counter(str(r.get("engine") or "-") for r in results if r.get("ok"))
    by_pp = Counter(str(r.get("preprocess") or "-") for r in results if r.get("ok"))
    vlm_used_n = sum(1 for r in results if r.get("vlmUsed") is True)
    vlm_ok_n = sum(1 for r in results if r.get("vlmUsed") is True and r.get("ok"))
    vlm_first_n = sum(1 for r in results if r.get("firstVlmUsed") is True)
    vlm_fa_n = sum(
        1 for r in results if r.get("firstVlmUsed") and r.get("firstDecision") == "wrong"
    )
    vlm_accept_n = sum(
        1
        for r in results
        if r.get("firstVlmUsed") and r.get("firstDecision") in ("correct", "wrong")
    )
    # Recovery: VLM invoked and session eventually OK after first abstain/wrong
    vlm_recover_n = sum(
        1
        for r in results
        if r.get("vlmUsed")
        and r.get("ok")
        and (not r.get("firstTryOk"))
    )
    fb_status = Counter(
        str((r.get("feedback") or {}).get("status") or "-") for r in results if r.get("feedback")
    )
    first_fb = Counter(str(r.get("firstFeedbackStatus") or "-") for r in results)
    fb_linked_n = sum(1 for r in results if (r.get("feedback") or {}).get("linked") is True)
    retry_used_n = sum(1 for r in results if int(r.get("attempts") or 1) > 1)
    retry_recover_n = sum(
        1 for r in results if int(r.get("attempts") or 1) > 1 and r.get("ok") and not r.get("firstTryOk")
    )
    retry_fa_n = sum(
        1
        for r in results
        if int(r.get("attempts") or 1) > 1
        and r.get("solved")
        and r.get("text")
        and not r.get("ok")
    )
    fail_class: Counter = Counter()
    for r in results:
        plan = r.get("lastRetryPlan") or (r.get("feedback") or {}).get("retryPlan") or {}
        fc = plan.get("failureClass")
        if fc:
            fail_class[str(fc)] += 1
    fail_reasons = Counter(
        str(r.get("verifyMessage") or r.get("reason") or r.get("error") or "unknown")
        for r in results
        if not r.get("ok")
    )
    len_hist = Counter(len(str(r.get("text") or "")) for r in results if r.get("text"))

    confs = [float(r["confidence"]) for r in results if isinstance(r.get("confidence"), (int, float))]
    avg_conf = sum(confs) / len(confs) if confs else None
    solve_ms = [int(r["solveMs"]) for r in results if isinstance(r.get("solveMs"), int)]
    avg_ms = sum(solve_ms) / len(solve_ms) if solve_ms else None

    def _pct(xs: list[int], p: float) -> float | None:
        if not xs:
            return None
        s = sorted(xs)
        if len(s) == 1:
            return float(s[0])
        k = (len(s) - 1) * (p / 100.0)
        f = int(k)
        c = min(f + 1, len(s) - 1)
        if f == c:
            return float(s[f])
        return float(s[f] + (s[c] - s[f]) * (k - f))

    lat_p50 = _pct(solve_ms, 50)
    lat_p95 = _pct(solve_ms, 95)
    lat_p99 = _pct(solve_ms, 99)

    # Cross-tab: first decision × feedback
    cross = Counter()
    for r in results:
        d = r.get("firstDecision") or "-"
        f = r.get("firstFeedbackStatus") or "-"
        cross[f"{d}|{f}"] += 1

    # F1 attribution summary (first-attempt accepts)
    fa_rows = []
    for r in results:
        fa = r.get("firstFalseAccept") or r.get("falseAccept")
        if isinstance(fa, dict) and fa.get("attributed"):
            fa_rows.append({"falseAccept": fa})
    try:
        if str(ROOT / "captcha-solver") not in sys.path:
            sys.path.insert(0, str(ROOT / "captcha-solver"))
        from solvers.false_accept import summarize_attributions

        fa_summary = summarize_attributions(fa_rows)
    except Exception as exc:  # noqa: BLE001
        fa_summary = {"error": type(exc).__name__, "detail": str(exc)[:200]}

    # E1-A: does weak character evidence explain false ACCEPT? (observation only)
    char_analysis: dict = {"accepts": 0, "falseAccepts": 0, "trueAccepts": 0}
    try:
        if str(ROOT / "captcha-solver") not in sys.path:
            sys.path.insert(0, str(ROOT / "captcha-solver"))
        from solvers.char_evidence import weak_char_pattern

        weak_fa = weak_ok = 0
        fa_mins: list[float] = []
        ok_mins: list[float] = []
        for r in results:
            if r.get("firstDecision") not in ("correct", "wrong"):
                continue
            char_analysis["accepts"] += 1
            summary = (
                r.get("firstCharSummary")
                or r.get("charSummary")
                or (r.get("observation") or {}).get("charSummary")
            )
            ev = (
                r.get("firstCharacterEvidence")
                or r.get("characterEvidence")
                or (r.get("observation") or {}).get("characterEvidence")
            )
            # Prefer first-attempt fields when present on nested observation.candidate
            cand = ((r.get("observation") or {}).get("candidate") or {})
            summary = summary or cand.get("charSummary")
            ev = ev or cand.get("characterEvidence")
            if r.get("firstCharMinConfidence") is not None and not (
                isinstance(summary, dict) and summary.get("charMinConfidence") is not None
            ):
                summary = dict(summary or {})
                summary["charMinConfidence"] = r.get("firstCharMinConfidence")
            weak = weak_char_pattern(summary if isinstance(summary, dict) else None, ev if isinstance(ev, list) else None)
            cmin = weak.get("charMinConfidence")
            if r.get("firstDecision") == "wrong":
                char_analysis["falseAccepts"] += 1
                if weak.get("weakCharEvidence"):
                    weak_fa += 1
                if cmin is not None:
                    fa_mins.append(float(cmin))
            else:
                char_analysis["trueAccepts"] += 1
                if weak.get("weakCharEvidence"):
                    weak_ok += 1
                if cmin is not None:
                    ok_mins.append(float(cmin))
        char_analysis.update(
            {
                "falseAcceptsWithWeakChar": weak_fa,
                "trueAcceptsWithWeakChar": weak_ok,
                "weakCharShareOfFA": round(weak_fa / char_analysis["falseAccepts"], 4)
                if char_analysis["falseAccepts"]
                else None,
                "weakCharShareOfTrueAccept": round(weak_ok / char_analysis["trueAccepts"], 4)
                if char_analysis["trueAccepts"]
                else None,
                "faCharMinMean": round(sum(fa_mins) / len(fa_mins), 4) if fa_mins else None,
                "trueCharMinMean": round(sum(ok_mins) / len(ok_mins), 4) if ok_mins else None,
            }
        )
    except Exception as exc:  # noqa: BLE001
        char_analysis["error"] = type(exc).__name__
        char_analysis["detail"] = str(exc)[:200]

    # E1-B: tight candidate margin among ACCEPT (observation only)
    margin_analysis: dict = {"accepts": 0, "falseAccepts": 0, "trueAccepts": 0}
    try:
        if str(ROOT / "captcha-solver") not in sys.path:
            sys.path.insert(0, str(ROOT / "captcha-solver"))
        from solvers.candidate_margin import tight_margin_pattern

        tight_fa = tight_ok = 0
        fa_margins: list[float] = []
        ok_margins: list[float] = []
        fa_char_m: list[float] = []
        ok_char_m: list[float] = []
        for r in results:
            if r.get("firstDecision") not in ("correct", "wrong"):
                continue
            margin_analysis["accepts"] += 1
            cand = ((r.get("observation") or {}).get("candidate") or {})
            cm = r.get("firstCandidateMargin")
            if cm is None:
                cm = r.get("candidateMargin")
            if cm is None:
                cm = cand.get("candidateMargin")
            cmm = r.get("firstCharMinMargin")
            if cmm is None:
                cmm = r.get("charMinMargin")
            if cmm is None:
                cmm = cand.get("charMinMargin")
            tight_flag = r.get("firstTightCandidateMargin")
            if tight_flag is None:
                tight_flag = r.get("tightCandidateMargin")
            if tight_flag is None:
                tight_flag = cand.get("tightCandidateMargin")
            try:
                cm_f = float(cm) if cm is not None else None
            except (TypeError, ValueError):
                cm_f = None
            try:
                cmm_f = float(cmm) if cmm is not None else None
            except (TypeError, ValueError):
                cmm_f = None
            # Under F2 unanimous ACCEPT, vote-share runner-up is often absent (margin=1.0).
            # Treat unique-spelling margin=1.0 as non-informative for "tight" vote gap.
            vote_tight = bool(tight_flag) and cm_f is not None and cm_f < 0.999
            pat = tight_margin_pattern(
                candidate_margin=cm_f if (cm_f is not None and cm_f < 0.999) else None,
                tight=vote_tight if tight_flag is not None else None,
                char_min_margin=cmm_f,
            )
            if r.get("firstDecision") == "wrong":
                margin_analysis["falseAccepts"] += 1
                if pat.get("tightMarginEvidence"):
                    tight_fa += 1
                if cm_f is not None and cm_f < 0.999:
                    fa_margins.append(cm_f)
                if cmm_f is not None:
                    fa_char_m.append(cmm_f)
            else:
                margin_analysis["trueAccepts"] += 1
                if pat.get("tightMarginEvidence"):
                    tight_ok += 1
                if cm_f is not None and cm_f < 0.999:
                    ok_margins.append(cm_f)
                if cmm_f is not None:
                    ok_char_m.append(cmm_f)
        margin_analysis.update(
            {
                "falseAcceptsWithTightMargin": tight_fa,
                "trueAcceptsWithTightMargin": tight_ok,
                "tightMarginShareOfFA": round(tight_fa / margin_analysis["falseAccepts"], 4)
                if margin_analysis["falseAccepts"]
                else None,
                "tightMarginShareOfTrueAccept": round(tight_ok / margin_analysis["trueAccepts"], 4)
                if margin_analysis["trueAccepts"]
                else None,
                "faCandidateMarginMean": round(sum(fa_margins) / len(fa_margins), 4) if fa_margins else None,
                "trueCandidateMarginMean": round(sum(ok_margins) / len(ok_margins), 4) if ok_margins else None,
                "faCharMinMarginMean": round(sum(fa_char_m) / len(fa_char_m), 4) if fa_char_m else None,
                "trueCharMinMarginMean": round(sum(ok_char_m) / len(ok_char_m), 4) if ok_char_m else None,
                "note": "Post-F2 unanimous ACCEPT often has no vote runner-up; charMinMargin is the informative gap.",
            }
        )
    except Exception as exc:  # noqa: BLE001
        margin_analysis["error"] = type(exc).__name__
        margin_analysis["detail"] = str(exc)[:200]

    # E1-C: independent source agreement among ACCEPT (observation only)
    indep_analysis: dict = {"accepts": 0, "falseAccepts": 0, "trueAccepts": 0}
    try:
        if str(ROOT / "captcha-solver") not in sys.path:
            sys.path.insert(0, str(ROOT / "captcha-solver"))
        from solvers.independent_source import independent_agree_pattern

        agree_fa = agree_ok = conflict_fa = conflict_ok = unavail_fa = unavail_ok = 0
        incomp_fa = incomp_ok = 0
        status_counts: dict[str, int] = {}
        reason_counts: dict[str, int] = {}
        attr_counts: dict[str, int] = {}
        for r in results:
            if r.get("firstDecision") not in ("correct", "wrong"):
                continue
            indep_analysis["accepts"] += 1
            cand = ((r.get("observation") or {}).get("candidate") or {})
            agr = r.get("firstSourceAgreement") or r.get("sourceAgreement") or cand.get("sourceAgreement")
            cmp_ = (
                r.get("firstSecondaryComparison")
                or r.get("secondaryComparison")
                or cand.get("secondaryComparison")
            )
            sec_avail = r.get("firstSecondaryAvailable")
            if sec_avail is None:
                sec_avail = r.get("secondaryAvailable")
            if sec_avail is None:
                sec_avail = cand.get("secondaryAvailable")
            if not isinstance(agr, dict):
                agr = {}
                if r.get("firstIndependentAgree") is not None or r.get("independentAgree") is not None:
                    agr = {
                        "agree": bool(
                            r.get("firstIndependentAgree")
                            if r.get("firstIndependentAgree") is not None
                            else r.get("independentAgree")
                        ),
                        "comparable": True,
                        "charDiff": r.get("firstIndependentCharDiff") or r.get("independentCharDiff"),
                    }
            pat = independent_agree_pattern(agr, secondary_available=sec_avail)
            status = None
            reason = None
            if isinstance(cmp_, dict):
                status = cmp_.get("status")
                reason = cmp_.get("reason")
            if not status:
                status = pat.get("comparisonStatus") or (
                    "agree"
                    if pat.get("independentAgree")
                    else "conflict"
                    if pat.get("independentConflict")
                    else "incomparable"
                )
            if not reason and isinstance(agr, dict):
                reason = agr.get("reason")
            if status:
                status_counts[str(status)] = status_counts.get(str(status), 0) + 1
            if reason:
                reason_counts[str(reason)] = reason_counts.get(str(reason), 0) + 1
            primary_correct = r.get("firstDecision") == "correct"
            from solvers.independent_source import conflict_attribution

            attr = conflict_attribution(
                primary_correct=primary_correct,
                agreement=agr if isinstance(agr, dict) else {},
                secondary_available=bool(sec_avail) if sec_avail is not None else bool(agr.get("comparable")),
            )
            label = str(attr.get("label") or "unknown")
            attr_counts[label] = attr_counts.get(label, 0) + 1
            if r.get("firstDecision") == "wrong":
                indep_analysis["falseAccepts"] += 1
                if pat.get("sourceUnavailable"):
                    unavail_fa += 1
                if pat.get("incomparable") or status == "incomparable":
                    incomp_fa += 1
                if pat.get("independentAgree") or status == "agree":
                    agree_fa += 1
                if pat.get("independentConflict") or status == "conflict":
                    conflict_fa += 1
            else:
                indep_analysis["trueAccepts"] += 1
                if pat.get("sourceUnavailable"):
                    unavail_ok += 1
                if pat.get("incomparable") or status == "incomparable":
                    incomp_ok += 1
                if pat.get("independentAgree") or status == "agree":
                    agree_ok += 1
                if pat.get("independentConflict") or status == "conflict":
                    conflict_ok += 1
        n_acc = indep_analysis["accepts"] or 1
        comparable_n = status_counts.get("agree", 0) + status_counts.get("conflict", 0)
        indep_analysis.update(
            {
                "falseAcceptsIndependentAgree": agree_fa,
                "falseAcceptsIndependentConflict": conflict_fa,
                "falseAcceptsSourceUnavailable": unavail_fa,
                "falseAcceptsIncomparable": incomp_fa,
                "trueAcceptsIndependentAgree": agree_ok,
                "trueAcceptsIndependentConflict": conflict_ok,
                "trueAcceptsSourceUnavailable": unavail_ok,
                "trueAcceptsIncomparable": incomp_ok,
                "comparisonStatusCounts": status_counts,
                "comparisonReasonCounts": reason_counts,
                "comparableRate": round(comparable_n / n_acc, 4) if indep_analysis["accepts"] else None,
                "agreeCoverage": round(status_counts.get("agree", 0) / n_acc, 4)
                if indep_analysis["accepts"]
                else None,
                "conflictPurityNote": "conflict count excludes length_mismatch/empty/unsupported (E2-B2)",
                "independentAgreeShareOfFA": round(agree_fa / indep_analysis["falseAccepts"], 4)
                if indep_analysis["falseAccepts"]
                else None,
                "independentAgreeShareOfTrueAccept": round(agree_ok / indep_analysis["trueAccepts"], 4)
                if indep_analysis["trueAccepts"]
                else None,
                "independentConflictShareOfFA": round(conflict_fa / indep_analysis["falseAccepts"], 4)
                if indep_analysis["falseAccepts"]
                else None,
                "independentConflictShareOfTrueAccept": round(conflict_ok / indep_analysis["trueAccepts"], 4)
                if indep_analysis["trueAccepts"]
                else None,
                "sourceUnavailableShareOfFA": round(unavail_fa / indep_analysis["falseAccepts"], 4)
                if indep_analysis["falseAccepts"]
                else None,
                "sourceUnavailableShareOfTrueAccept": round(unavail_ok / indep_analysis["trueAccepts"], 4)
                if indep_analysis["trueAccepts"]
                else None,
                "conflictAttribution": attr_counts,
                "secondaryEngine": (os.environ.get("HERMES_CAPTCHA_SECONDARY_OCR") or "ppllocr"),
                "note": "C2-B: unavailable ≠ conflict; attribution uses verify outcome on primary.",
            }
        )
    except Exception as exc:  # noqa: BLE001
        indep_analysis["error"] = type(exc).__name__
        indep_analysis["detail"] = str(exc)[:200]

    # E2-B1: routingHint coverage / precision / B2 linkage (observation only)
    routing_analysis: dict = {
        "rounds": ROUNDS,
        "hintTrue": 0,
        "hintFalse": 0,
        "missingHint": 0,
        "appliedTrue": 0,
        "note": "E2-B1: applied must stay false; KPI ≠ success/FAR",
    }
    try:
        fa_n = fa_hint = 0
        hint_n = hard_among_hint = 0
        reason_counts: dict[str, int] = {}
        priority_counts: dict[str, int] = {}
        # B2 linkage among hint=true with comparison status
        hint_cmp = {"agree": 0, "conflict": 0, "incomparable": 0, "missing": 0}
        nohint_cmp = {"agree": 0, "conflict": 0, "incomparable": 0, "missing": 0}
        char_thr = 0.45
        margin_thr = 0.12
        try:
            char_thr = float(os.environ.get("HERMES_CAPTCHA_HINT_CHAR_MIN") or "0.45")
            margin_thr = float(os.environ.get("HERMES_CAPTCHA_HINT_CHAR_MARGIN") or "0.12")
        except ValueError:
            pass

        def _hint_of(r: dict) -> dict | None:
            h = r.get("firstRoutingHint") or r.get("routingHint")
            if isinstance(h, dict):
                return h
            obs = r.get("observation") or {}
            if isinstance(obs, dict) and isinstance(obs.get("routingHint"), dict):
                return obs["routingHint"]
            return None

        def _is_hard(r: dict) -> bool:
            """Operational hard: FA / weak char / tight margin / incomparable|conflict."""
            if r.get("firstDecision") == "wrong":
                return True
            cmin = r.get("firstCharMinConfidence")
            if cmin is None:
                cmin = r.get("charMinConfidence")
            try:
                if cmin is not None and float(cmin) < char_thr:
                    return True
            except (TypeError, ValueError):
                pass
            cmm = r.get("firstCharMinMargin")
            if cmm is None:
                cmm = r.get("charMinMargin")
            try:
                if cmm is not None and float(cmm) < margin_thr:
                    return True
            except (TypeError, ValueError):
                pass
            if r.get("firstTightCandidateMargin") or r.get("tightCandidateMargin"):
                return True
            st = r.get("firstComparisonStatus") or r.get("comparisonStatus")
            if st in ("incomparable", "conflict"):
                return True
            return False

        for r in results:
            h = _hint_of(r)
            if not isinstance(h, dict):
                routing_analysis["missingHint"] += 1
                continue
            if h.get("applied"):
                routing_analysis["appliedTrue"] += 1
            rec = bool(h.get("recommendSecondary"))
            if rec:
                routing_analysis["hintTrue"] += 1
                hint_n += 1
                if _is_hard(r):
                    hard_among_hint += 1
            else:
                routing_analysis["hintFalse"] += 1
            for reason in h.get("reasons") or []:
                if isinstance(reason, dict) and reason.get("code"):
                    code = str(reason["code"])
                    reason_counts[code] = reason_counts.get(code, 0) + 1
            pri = str(h.get("priority") or "")
            if pri:
                priority_counts[pri] = priority_counts.get(pri, 0) + 1

            st = r.get("firstComparisonStatus") or r.get("comparisonStatus")
            bucket = hint_cmp if rec else nohint_cmp
            if st in ("agree", "conflict", "incomparable"):
                bucket[st] += 1
            else:
                bucket["missing"] += 1

            if r.get("firstDecision") == "wrong":
                fa_n += 1
                if rec:
                    fa_hint += 1

        def _cmp_rates(bucket: dict) -> dict:
            known = bucket["agree"] + bucket["conflict"] + bucket["incomparable"]
            comparable = bucket["agree"] + bucket["conflict"]
            return {
                "n": known,
                "comparableRate": round(comparable / known, 4) if known else None,
                "agreeRate": round(bucket["agree"] / known, 4) if known else None,
                "statusCounts": dict(bucket),
            }

        routing_analysis.update(
            {
                "falseAccepts": fa_n,
                "falseAcceptsHinted": fa_hint,
                "hintCoverageOnFA": round(fa_hint / fa_n, 4) if fa_n else None,
                "hintPrecisionHard": round(hard_among_hint / hint_n, 4) if hint_n else None,
                "hardAmongHint": hard_among_hint,
                "reasonCounts": reason_counts,
                "priorityCounts": priority_counts,
                "b2LinkageHintTrue": _cmp_rates(hint_cmp),
                "b2LinkageHintFalse": _cmp_rates(nohint_cmp),
                "hardDefinition": (
                    "FA or charMin<thr or charMinMargin<thr or tightCandidateMargin "
                    "or comparison incomparable|conflict"
                ),
            }
        )
    except Exception as exc:  # noqa: BLE001
        routing_analysis["error"] = type(exc).__name__
        routing_analysis["detail"] = str(exc)[:200]

    # A0: abstain attribution among first-attempt abstains
    abstain_analysis: dict = {
        "abstains": 0,
        "withDetail": 0,
        "missingDetail": 0,
        "bucketCounts": {},
        "note": "A0 observation only; does not change Decision",
    }
    try:
        primary_counts: dict[str, int] = {}
        secondary_counts: dict[str, int] = {}
        vote_counts: dict[str, int] = {}
        gate_counts: dict[str, int] = {}
        has_candidate = 0
        for r in results:
            if r.get("firstDecision") != "abstain":
                continue
            abstain_analysis["abstains"] += 1
            detail = r.get("firstAbstainReasonDetail") or r.get("abstainReasonDetail")
            bucket = r.get("firstAbstainBucket") or r.get("abstainBucket")
            if isinstance(detail, dict):
                abstain_analysis["withDetail"] += 1
                bucket = bucket or detail.get("bucket") or "OTHER"
                for key, counts in (
                    ("primary", primary_counts),
                    ("secondary", secondary_counts),
                    ("vote", vote_counts),
                    ("gate", gate_counts),
                ):
                    val = str(detail.get(key) or "UNKNOWN")
                    counts[val] = counts.get(val, 0) + 1
                if detail.get("candidateText") or r.get("firstAbstainCandidateText"):
                    has_candidate += 1
            else:
                abstain_analysis["missingDetail"] += 1
                bucket = bucket or "MISSING_DETAIL"
            bc = abstain_analysis["bucketCounts"]
            bc[str(bucket)] = bc.get(str(bucket), 0) + 1
        n_abs = abstain_analysis["abstains"] or 1
        abstain_analysis.update(
            {
                "bucketRates": {
                    k: round(v / n_abs, 4) for k, v in sorted(abstain_analysis["bucketCounts"].items())
                },
                "primaryCounts": primary_counts,
                "secondaryCounts": secondary_counts,
                "voteCounts": vote_counts,
                "gateCounts": gate_counts,
                "abstainsWithCandidateText": has_candidate,
                "candidateAmongAbstainRate": round(has_candidate / n_abs, 4)
                if abstain_analysis["abstains"]
                else None,
            }
        )
    except Exception as exc:  # noqa: BLE001
        abstain_analysis["error"] = type(exc).__name__
        abstain_analysis["detail"] = str(exc)[:200]

    report = {
        "ts": ts,
        "label": LABEL or None,
        "phase3": {
            "profile": PROFILE,
            "vlmTier": VLM_TIER,
            "adaptiveRetry": ADAPTIVE_RETRY,
            "matrixCell": (
                ("B" if ADAPTIVE_RETRY else "A")
                if VLM_TIER == "off"
                else ("D" if ADAPTIVE_RETRY else "C")
            ),
        },
        "demo": DEMO,
        "solver": SOLVER,
        "rounds": ROUNDS,
        "retries": RETRIES,
        "adaptiveRetry": ADAPTIVE_RETRY,
        "maxAttempts": MAX_ATTEMPTS if ADAPTIVE_RETRY else (1 + RETRIES),
        "profile": PROFILE,
        "vlmTier": VLM_TIER,
        # Phase 3 core metrics
        "firstAttemptSuccess": round(first_pass_rate, 4),
        "eventualSessionSuccess": round(pass_rate, 4),
        "falseAcceptRate": round(false_accept_rate, 4) if false_accept_rate is not None else None,
        "abstainRate": round(abstain_rate, 4),
        "retryRate": round(retry_used_n / ROUNDS, 4) if ROUNDS else 0,
        "retryRecoveryRate": round(retry_recover_n / retry_used_n, 4) if retry_used_n else None,
        "retryFalseAcceptRate": round(retry_fa_n / retry_used_n, 4) if retry_used_n else None,
        "vlmInvokeRate": round(vlm_used_n / ROUNDS, 4) if ROUNDS else 0,
        "vlmRecoveryRate": round(vlm_recover_n / vlm_used_n, 4) if vlm_used_n else None,
        "vlmFalseAcceptRate": round(vlm_fa_n / vlm_accept_n, 4) if vlm_accept_n else None,
        "latencyP50": round(lat_p50, 1) if lat_p50 is not None else None,
        "latencyP95": round(lat_p95, 1) if lat_p95 is not None else None,
        "latencyP99": round(lat_p99, 1) if lat_p99 is not None else None,
        "retryUsedCount": retry_used_n,
        "retryRecoveryCount": retry_recover_n,
        "retryFalseAcceptCount": retry_fa_n,
        "elapsedSec": round(elapsed, 2),
        "passCount": ok_n,
        "passRate": round(pass_rate, 4),
        "firstTryPassCount": first_ok_n,
        "firstTryPassRate": round(first_pass_rate, 4),
        "firstCorrect": first_correct,
        "firstWrong": first_wrong,
        "firstAbstain": first_abstain,
        "firstAccept": first_accept,
        "acceptedPrecision": round(accepted_precision, 4) if accepted_precision is not None else None,
        "solverReturnTextRate": round(solve_rate, 4),
        "avgConfidence": round(avg_conf, 4) if avg_conf is not None else None,
        "avgSolveMs": round(avg_ms, 1) if avg_ms is not None else None,
        "okByEngine": dict(by_engine),
        "okByPreprocess": dict(by_pp),
        "vlmUsedCount": vlm_used_n,
        "vlmUsedRate": round(vlm_used_n / ROUNDS, 4) if ROUNDS else 0,
        "vlmUsedPassCount": vlm_ok_n,
        "vlmFirstInvokeCount": vlm_first_n,
        "vlmRecoveryCount": vlm_recover_n,
        "feedbackByStatus": dict(fb_status),
        "firstFeedbackByStatus": dict(first_fb),
        "firstDecisionFeedbackCross": dict(cross),
        "failureClassCounts": dict(fail_class),
        "feedbackLinkedCount": fb_linked_n,
        "falseAcceptAttribution": fa_summary,
        "charEvidenceAnalysis": char_analysis,
        "candidateMarginAnalysis": margin_analysis,
        "independentSourceAnalysis": indep_analysis,
        "routingHintAnalysis": routing_analysis,
        "abstainAttribution": abstain_analysis,
        "failReasons": dict(fail_reasons.most_common(20)),
        "textLengthHist": dict(sorted(len_hist.items())),
        "solverHealth": health if isinstance(health, dict) else {},
        "results": results,
    }

    json_path = OUT_DIR / f"captcha_ocr_bench_{ts}.json"
    md_path = OUT_DIR / f"captcha_ocr_bench_{ts}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def _pct_s(x: float | None) -> str:
        return f"{x:.1%}" if x is not None else "n/a"

    prec_s = _pct_s(accepted_precision)
    cell = report["phase3"]["matrixCell"]
    lines = [
        f"# CAPTCHA OCR Bench Report ({ts})",
        "",
        f"- **Phase 3 cell: `{cell}`** (profile=`{PROFILE}`, adaptive={ADAPTIVE_RETRY}, vlmTier=`{VLM_TIER}`)",
        f"- Label: `{LABEL or '-'}`",
        f"- Demo: `{DEMO}`",
        f"- Solver: `{SOLVER}`",
        f"- Rounds: **{ROUNDS}** (retries={RETRIES}, adaptive={ADAPTIVE_RETRY}, maxAttempts={MAX_ATTEMPTS if ADAPTIVE_RETRY else 1 + RETRIES})",
        f"- Elapsed: {elapsed:.1f}s",
        "",
        "## Phase 3 core metrics",
        f"- firstAttemptSuccess: **{_pct_s(first_pass_rate)}** ({first_ok_n}/{ROUNDS})",
        f"- eventualSessionSuccess: **{_pct_s(pass_rate)}** ({ok_n}/{ROUNDS})",
        f"- **falseAcceptRate: {_pct_s(false_accept_rate)}** ({first_wrong}/{first_accept})",
        f"- abstainRate: {_pct_s(abstain_rate)} ({first_abstain}/{ROUNDS})",
        f"- retryRate: {_pct_s(retry_used_n / ROUNDS if ROUNDS else 0)} ({retry_used_n}/{ROUNDS})",
        f"- retryRecoveryRate: {_pct_s(retry_recover_n / retry_used_n if retry_used_n else None)} ({retry_recover_n}/{retry_used_n})",
        f"- retryFalseAcceptRate: {_pct_s(retry_fa_n / retry_used_n if retry_used_n else None)} ({retry_fa_n}/{retry_used_n})",
        f"- vlmInvokeRate: {_pct_s(vlm_used_n / ROUNDS if ROUNDS else 0)} ({vlm_used_n}/{ROUNDS})",
        f"- vlmRecoveryRate: {_pct_s(vlm_recover_n / vlm_used_n if vlm_used_n else None)} ({vlm_recover_n}/{vlm_used_n})",
        f"- vlmFalseAcceptRate: {_pct_s(vlm_fa_n / vlm_accept_n if vlm_accept_n else None)} ({vlm_fa_n}/{vlm_accept_n})",
        f"- latencyP50/P95/P99 ms: {lat_p50} / {lat_p95} / {lat_p99}",
        "",
        "## Decision / feedback",
        f"- First-try decision: correct={first_correct} wrong={first_wrong} abstain={first_abstain}",
        f"- Accepted precision: {prec_s} ({first_correct}/{first_accept})",
        f"- First feedback: `{dict(first_fb)}`",
        f"- Cross (firstDecision|feedback): `{dict(cross)}`",
        f"- FailureClass: `{dict(fail_class)}`",
        f"- Feedback final: `{dict(fb_status)}`; linked={fb_linked_n}/{ROUNDS}",
        "",
        "## F1 False-ACCEPT Attribution (first attempt)",
    ]
    if isinstance(fa_summary, dict) and fa_summary.get("byClass"):
        lines.append(
            f"- totalFalseAccepts: **{fa_summary.get('totalFalseAccepts')}** / "
            f"attributedAccepts={fa_summary.get('totalAttributedAccepts')}; "
            f"topClass=**{fa_summary.get('topClass')}**"
        )
        lines.append("")
        lines.append("| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |")
        lines.append("|-------|------------:|-------------:|----------------:|----------:|")
        for row in fa_summary["byClass"]:
            lines.append(
                f"| `{row['class']}` | {row['acceptCount']} | {row['acceptFailed']} | "
                f"{row['falseAcceptRate']:.1%} | {row['shareOfFalseAccepts']:.1%} |"
            )
    else:
        lines.append(f"- (no attribution data) `{fa_summary}`")
    lines += [
        "",
        "## E1-A Character Evidence (observation only)",
        f"- accepts={char_analysis.get('accepts')} FA={char_analysis.get('falseAccepts')} "
        f"true={char_analysis.get('trueAccepts')}",
        f"- FA with weak char evidence: **{char_analysis.get('falseAcceptsWithWeakChar')}** "
        f"(share={char_analysis.get('weakCharShareOfFA')})",
        f"- true ACCEPT with weak char evidence: {char_analysis.get('trueAcceptsWithWeakChar')} "
        f"(share={char_analysis.get('weakCharShareOfTrueAccept')})",
        f"- mean charMin: FA={char_analysis.get('faCharMinMean')} "
        f"true={char_analysis.get('trueCharMinMean')}",
        "",
        "## E1-B Candidate Margin (observation only)",
        f"- accepts={margin_analysis.get('accepts')} FA={margin_analysis.get('falseAccepts')} "
        f"true={margin_analysis.get('trueAccepts')}",
        f"- FA with tight margin: **{margin_analysis.get('falseAcceptsWithTightMargin')}** "
        f"(share={margin_analysis.get('tightMarginShareOfFA')})",
        f"- true ACCEPT with tight margin: {margin_analysis.get('trueAcceptsWithTightMargin')} "
        f"(share={margin_analysis.get('tightMarginShareOfTrueAccept')})",
        f"- mean candidateMargin: FA={margin_analysis.get('faCandidateMarginMean')} "
        f"true={margin_analysis.get('trueCandidateMarginMean')}",
        "",
        "## E1-C Independent Source (observation only)",
        f"- accepts={indep_analysis.get('accepts')} FA={indep_analysis.get('falseAccepts')} "
        f"true={indep_analysis.get('trueAccepts')}",
        f"- FA independentAgree: **{indep_analysis.get('falseAcceptsIndependentAgree')}** "
        f"(share={indep_analysis.get('independentAgreeShareOfFA')}); "
        f"conflict={indep_analysis.get('falseAcceptsIndependentConflict')}",
        f"- true independentAgree: **{indep_analysis.get('trueAcceptsIndependentAgree')}** "
        f"(share={indep_analysis.get('independentAgreeShareOfTrueAccept')}); "
        f"conflict={indep_analysis.get('trueAcceptsIndependentConflict')}",
        "",
        "## Solver health",
        "```json",
        json.dumps(health if isinstance(health, dict) else {}, ensure_ascii=False, indent=2),
        "```",
        "",
        "## OK by engine / preprocess",
        f"- engine: `{dict(by_engine)}`",
        f"- preprocess: `{dict(by_pp)}`",
        "",
        "## Text length histogram (solver outputs)",
        f"`{dict(sorted(len_hist.items()))}`",
        "",
        "## Top fail reasons",
    ]
    for reason, n in fail_reasons.most_common(15):
        lines.append(f"- ({n}) {reason}")
    lines += [
        "",
        f"Failed images: `{fail_dir.relative_to(ROOT) if fail_dir.exists() else '-'}`",
        f"JSON: `{json_path.relative_to(ROOT)}`",
        "",
        "## Judgment order (Phase 3)",
        "1. falseAcceptRate ↓",
        "2. eventualSessionSuccess ↑",
        "3. retryRecoveryRate useful",
        "4. latency P95/P99 acceptable",
        "5. VLM net benefit (C/D only; do not mix into A/B baseline)",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print("----")
    print(f"LABEL={LABEL or '-'} CELL={cell} PROFILE={PROFILE} VLM_TIER={VLM_TIER}")
    print(f"firstAttemptSuccess={first_pass_rate:.4f} eventualSessionSuccess={pass_rate:.4f}")
    print(f"falseAcceptRate={false_accept_rate if false_accept_rate is not None else 'n/a'} abstainRate={abstain_rate:.4f}")
    print(f"retryRate={retry_used_n/ROUNDS if ROUNDS else 0:.4f} retryRecoveryRate={retry_recover_n/retry_used_n if retry_used_n else 'n/a'}")
    print(f"latencyP50={lat_p50} P95={lat_p95} P99={lat_p99}")
    print(f"VLM_USED={vlm_used_n}/{ROUNDS} vlmRecovery={vlm_recover_n} vlmFA={vlm_fa_n}")
    if isinstance(fa_summary, dict) and fa_summary.get("topClass"):
        print(
            f"F1_TOP={fa_summary.get('topClass')} "
            f"FA={fa_summary.get('totalFalseAccepts')}/{fa_summary.get('totalAttributedAccepts')} "
            f"byClass={[(x['class'], x['acceptFailed']) for x in fa_summary.get('byClass', [])[:5]]}"
        )
    if char_analysis.get("falseAccepts") is not None:
        print(
            f"E1A_CHAR weakFA={char_analysis.get('falseAcceptsWithWeakChar')}/"
            f"{char_analysis.get('falseAccepts')} "
            f"weakTrue={char_analysis.get('trueAcceptsWithWeakChar')}/"
            f"{char_analysis.get('trueAccepts')} "
            f"faMinMean={char_analysis.get('faCharMinMean')} "
            f"trueMinMean={char_analysis.get('trueCharMinMean')}"
        )
    if margin_analysis.get("falseAccepts") is not None:
        print(
            f"E1B_MARGIN tightFA={margin_analysis.get('falseAcceptsWithTightMargin')}/"
            f"{margin_analysis.get('falseAccepts')} "
            f"tightTrue={margin_analysis.get('trueAcceptsWithTightMargin')}/"
            f"{margin_analysis.get('trueAccepts')} "
            f"faMargMean={margin_analysis.get('faCandidateMarginMean')} "
            f"trueMargMean={margin_analysis.get('trueCandidateMarginMean')}"
        )
    if indep_analysis.get("falseAccepts") is not None:
        print(
            f"E1C_INDEP agreeFA={indep_analysis.get('falseAcceptsIndependentAgree')}/"
            f"{indep_analysis.get('falseAccepts')} "
            f"conflictFA={indep_analysis.get('falseAcceptsIndependentConflict')} "
            f"unavailFA={indep_analysis.get('falseAcceptsSourceUnavailable')} "
            f"agreeTrue={indep_analysis.get('trueAcceptsIndependentAgree')}/"
            f"{indep_analysis.get('trueAccepts')} "
            f"conflictTrue={indep_analysis.get('trueAcceptsIndependentConflict')} "
            f"unavailTrue={indep_analysis.get('trueAcceptsSourceUnavailable')} "
            f"attr={indep_analysis.get('conflictAttribution')}"
        )
    if routing_analysis.get("hintTrue") is not None:
        print(
            f"E2B1_HINT hintTrue={routing_analysis.get('hintTrue')} "
            f"faCoverage={routing_analysis.get('hintCoverageOnFA')} "
            f"precisionHard={routing_analysis.get('hintPrecisionHard')} "
            f"appliedTrue={routing_analysis.get('appliedTrue')} "
            f"b2hint={routing_analysis.get('b2LinkageHintTrue')}"
        )
    if abstain_analysis.get("abstains"):
        print(
            f"A0_ABSTAIN n={abstain_analysis.get('abstains')} "
            f"withDetail={abstain_analysis.get('withDetail')} "
            f"candidateRate={abstain_analysis.get('candidateAmongAbstainRate')} "
            f"buckets={abstain_analysis.get('bucketRates')}"
        )
    print(f"report_md={md_path}")
    print(f"report_json={json_path}")
    return 0 if pass_rate >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
