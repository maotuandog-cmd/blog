"""S3 Verify Feedback — record-only; never mutates attempt decision fields.

Freeze (REQ §12):
  decisionScore / confidence = immutable after attempt
  verifyResult = separate feedback linked by sessionId + attemptId
"""
from __future__ import annotations

import json
import os
import threading
from collections import OrderedDict
from typing import Any

from .session import _utc_now_iso, maybe_append_jsonl

VERIFY_SUCCESS = "success"
VERIFY_FAILED = "failed"
VERIFY_NOT_EXECUTED = "not_executed"
VERIFY_UNKNOWN = "unknown"
VALID_STATUSES = frozenset(
    {VERIFY_SUCCESS, VERIFY_FAILED, VERIFY_NOT_EXECUTED, VERIFY_UNKNOWN}
)

_lock = threading.Lock()
# attemptKey -> frozen decision snapshot (never updated by feedback)
_attempts: OrderedDict[str, dict[str, Any]] = OrderedDict()
# attemptId-only secondary index (Worker Trace primary key)
_by_attempt: OrderedDict[str, str] = OrderedDict()
_MAX_ATTEMPTS = 4096


def _attempt_key(session_id: str, attempt_id: str) -> str:
    return f"{session_id}\0{attempt_id}"


def _max_attempts() -> int:
    raw = (os.environ.get("HERMES_CAPTCHA_FEEDBACK_CACHE") or "").strip()
    if not raw:
        return _MAX_ATTEMPTS
    try:
        return max(64, min(50000, int(raw)))
    except ValueError:
        return _MAX_ATTEMPTS


def register_attempt(
    *,
    session_id: str,
    attempt_id: str,
    decision_snapshot: dict[str, Any],
) -> None:
    """Index attempt for later feedback linkage. Snapshot is deep-copied once."""
    key = _attempt_key(session_id, attempt_id)
    snap = json.loads(json.dumps(decision_snapshot, ensure_ascii=False))
    with _lock:
        _attempts[key] = snap
        _attempts.move_to_end(key)
        _by_attempt[attempt_id] = key
        _by_attempt.move_to_end(attempt_id)
        while len(_attempts) > _max_attempts():
            old_k, _ = _attempts.popitem(last=False)
            # best-effort purge secondary
            for aid, k in list(_by_attempt.items()):
                if k == old_k:
                    _by_attempt.pop(aid, None)
                    break


def get_attempt_snapshot(session_id: str, attempt_id: str) -> dict[str, Any] | None:
    key = _attempt_key(session_id, attempt_id)
    with _lock:
        snap = _attempts.get(key)
        if snap is None and attempt_id:
            mapped = _by_attempt.get(attempt_id)
            if mapped:
                snap = _attempts.get(mapped)
        return json.loads(json.dumps(snap, ensure_ascii=False)) if snap is not None else None


def clear_attempt_cache() -> None:
    """Test helper."""
    with _lock:
        _attempts.clear()
        _by_attempt.clear()


def normalize_verify_status(raw: object) -> str:
    s = str(raw or "").strip().lower().replace("-", "_")
    aliases = {
        "ok": VERIFY_SUCCESS,
        "pass": VERIFY_SUCCESS,
        "passed": VERIFY_SUCCESS,
        "verify_success": VERIFY_SUCCESS,
        "fail": VERIFY_FAILED,
        "error": VERIFY_FAILED,
        "verify_failed": VERIFY_FAILED,
        "abstain": VERIFY_NOT_EXECUTED,
        "skipped": VERIFY_NOT_EXECUTED,
        "not_executed": VERIFY_NOT_EXECUTED,
        "timeout": VERIFY_UNKNOWN,
        "timed_out": VERIFY_UNKNOWN,
        "unknown": VERIFY_UNKNOWN,
    }
    if s in VALID_STATUSES:
        return s
    return aliases.get(s, VERIFY_UNKNOWN if s else VERIFY_UNKNOWN)


def parse_verify_result(req: dict) -> dict[str, Any]:
    """Build canonical verifyResult from request body."""
    vr = req.get("verifyResult")
    if not isinstance(vr, dict):
        vr = {}
    status = normalize_verify_status(
        vr.get("status")
        if vr.get("status") is not None
        else req.get("siteResult")
        if req.get("siteResult") is not None
        else req.get("status")
    )
    reason = str(
        vr.get("reason")
        if vr.get("reason") is not None
        else req.get("failReason")
        if req.get("failReason") is not None
        else req.get("reason")
        or ""
    )
    latency = vr.get("latencyMs")
    if latency is None:
        latency = vr.get("latency_ms")
    if latency is None:
        latency = req.get("latencyMs")
    try:
        latency_ms = int(latency) if latency is not None else None
    except (TypeError, ValueError):
        latency_ms = None
    verified_at = str(vr.get("verifiedAt") or vr.get("verified_at") or _utc_now_iso())
    source = str(vr.get("source") or req.get("source") or "unknown")
    out: dict[str, Any] = {
        "status": status,
        "reason": reason,
        "verifiedAt": verified_at,
        "source": source,
    }
    if latency_ms is not None:
        out["latencyMs"] = latency_ms
    # Optional taxonomy tags (record-only)
    fr = vr.get("failureReason") or req.get("failureReason")
    if isinstance(fr, list) and fr:
        out["failureReason"] = [str(x) for x in fr][:16]
    elif status == VERIFY_UNKNOWN and "timeout" in reason.lower():
        out["failureReason"] = ["timeout"]
    return out


def maybe_append_feedback_jsonl(record: dict) -> None:
    """Prefer HERMES_CAPTCHA_FEEDBACK_JSONL; else reuse OBS JSONL if set."""
    path = (os.environ.get("HERMES_CAPTCHA_FEEDBACK_JSONL") or "").strip()
    if path:
        try:
            from pathlib import Path

            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            return
        except Exception:
            return
    # Fall back to shared observation JSONL (same file, type=feedback).
    maybe_append_jsonl(record)


def record_feedback(req: dict) -> dict:
    """Accept verify feedback. Never mutates registered decisionScore/confidence."""
    session_id = str(req.get("sessionId") or req.get("captchaSessionId") or "").strip()
    attempt_id = str(req.get("attemptId") or "").strip()
    if not attempt_id:
        return {
            "ok": False,
            "linked": False,
            "reason": "missing attemptId",
            "sessionId": session_id or None,
            "attemptId": None,
        }

    # Resolve session from secondary index when Worker only sends attemptId.
    if not session_id:
        with _lock:
            mapped = _by_attempt.get(attempt_id)
        if mapped and "\0" in mapped:
            session_id = mapped.split("\0", 1)[0]
        else:
            session_id = "unknown"

    verify_result = parse_verify_result(req)
    snap = get_attempt_snapshot(session_id, attempt_id)
    linked = snap is not None

    # Immutable copy of decision at feedback time (for joins); never written back.
    decision_at = None
    if snap is not None:
        decision_at = {
            "action": (snap.get("decision") or {}).get("action"),
            "reason": (snap.get("decision") or {}).get("reason"),
            "decisionScore": snap.get("decisionScore"),
            "confidence": snap.get("confidence"),
            "evidenceScore": snap.get("evidenceScore"),
        }

    out: dict[str, Any] = {
        "ok": True,
        "sessionId": session_id,
        "attemptId": attempt_id,
        "verifyResult": verify_result,
        "linked": linked,
        "decisionAtRecord": decision_at,
    }

    # S4: optional retry plan (does not mutate decisionAtRecord scores).
    include_plan = str(
        req.get("includeRetryPlan") if req.get("includeRetryPlan") is not None else "1"
    ).strip().lower()
    plan = None
    if include_plan not in ("0", "false", "no", "off"):
        from .context import clear_profile_settings, set_profile_settings
        from .profile import resolve_active_profile
        from .retry_policy import plan_retry

        # S5: plan uses request profile / default (env bootstrap), not historical mutation.
        profile = resolve_active_profile(req)
        set_profile_settings(profile)
        try:
            try:
                attempt_index = int(req.get("attemptIndex") or 1)
            except (TypeError, ValueError):
                attempt_index = 1
            decision_for_plan = {
                "action": (decision_at or {}).get("action")
                or ("accept" if (snap or {}).get("solved") else "abstain"),
                "reason": (decision_at or {}).get("reason") or "",
                "decisionScore": (decision_at or {}).get("decisionScore"),
                "confidence": (decision_at or {}).get("confidence"),
            }
            plan = plan_retry(
                feedback=verify_result,
                decision=decision_for_plan,
                attempt={"sessionId": session_id, "attemptId": attempt_id, "index": attempt_index},
                snap=snap,
                attempt_index=attempt_index,
            )
            out["retryPlan"] = plan
            out["profile"] = profile.get("name")
        finally:
            clear_profile_settings()

    record = {
        "type": "feedback",
        "ts": _utc_now_iso(),
        "sessionId": session_id,
        "attemptId": attempt_id,
        "jobId": req.get("jobId"),
        "verifyResult": verify_result,
        "linked": linked,
        "decisionAtRecord": decision_at,
    }
    if plan is not None:
        record["retryPlan"] = plan
    maybe_append_feedback_jsonl(record)

    return out


def snapshot_from_solve_result(result: dict) -> dict[str, Any]:
    """Frozen fields registered at solve time (S1 decision, untouched by S3)."""
    obs = result.get("observation") if isinstance(result.get("observation"), dict) else {}
    return {
        "sessionId": result.get("sessionId"),
        "attemptId": result.get("attemptId"),
        "decision": dict(obs.get("decision") or {})
        if obs.get("decision")
        else {
            "action": result.get("decision") or ("accept" if result.get("solved") else "abstain"),
            "reason": result.get("decisionReason") or result.get("reason") or "",
        },
        "decisionScore": result.get("decisionScore"),
        "confidence": result.get("confidence"),
        "evidenceScore": result.get("evidenceScore") or obs.get("evidenceScore"),
        "candidates": list(obs.get("candidates") or []),
        "vlmUsed": result.get("vlmUsed"),
        "vlmConflict": result.get("vlmConflict"),
        "solved": bool(result.get("solved")),
        "failureReason": obs.get("failureReason"),
    }
