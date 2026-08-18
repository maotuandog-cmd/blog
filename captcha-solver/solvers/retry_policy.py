"""S4 Feedback-driven Adaptive Retry — Policy Engine only.

Freeze (REQ §13):
  - Retry by failure class, never by attempt ordinal ladder
  - maxAttempts default = 2
  - Pure function + Bench-driven; optional retryPlan on feedback
  - Never mutates historical decisionScore / confidence
"""
from __future__ import annotations

import os
from typing import Any

# --- failure classes (v1 closed set) ---
FC_VERIFY_FAILED = "VERIFY_FAILED"
FC_OCR_ABSTAIN = "OCR_ABSTAIN"
FC_MODEL_CONFLICT = "MODEL_CONFLICT"
FC_KIND_UNCERTAIN = "KIND_UNCERTAIN"
FC_SOLVER_TIMEOUT = "SOLVER_TIMEOUT"
FC_UNSUPPORTED_CAPTCHA = "UNSUPPORTED_CAPTCHA"
FC_SUCCESS = "SUCCESS"
FC_UNKNOWN = "UNKNOWN"

# --- strategies ---
ST_STOP = "stop"
ST_FRESH_CAPTURE = "fresh_capture"
ST_SAME_SOLVER = "same_solver"
ST_ALTERNATE_PREPROCESS = "alternate_preprocess"
ST_RE_DETECT = "re_detect"
ST_NO_VLM = "no_vlm"
ST_REDUCED_LATENCY = "reduced_latency"
ST_REMAIN_ABSTAIN = "remain_abstain"


def max_attempts() -> int:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return max(1, min(5, int(cfg("retry.maxAttempts", 2))))
        except (TypeError, ValueError):
            return 2
    raw = (os.environ.get("HERMES_CAPTCHA_MAX_ATTEMPTS") or "2").strip()
    try:
        return max(1, min(5, int(raw)))
    except ValueError:
        return 2


def classify_failure(
    *,
    decision: dict | None = None,
    feedback: dict | None = None,
    observation: dict | None = None,
    snap: dict | None = None,
) -> str:
    """Map decision + verify feedback → failure class (not attempt number)."""
    decision = decision or {}
    feedback = feedback or {}
    observation = observation or {}
    snap = snap or {}

    status = str(feedback.get("status") or "").strip().lower()
    dobs = observation.get("decision")
    dec_reason = ""
    if isinstance(dobs, dict):
        dec_reason = str(dobs.get("reason") or "")
    reason = str(
        feedback.get("reason")
        or decision.get("reason")
        or decision.get("decisionReason")
        or dec_reason
        or ""
    ).strip().lower()

    action = str(
        decision.get("action")
        or (decision.get("decision") if isinstance(decision.get("decision"), str) else "")
        or ((snap.get("decision") or {}).get("action") if isinstance(snap.get("decision"), dict) else "")
        or ""
    ).strip().lower()

    fr = observation.get("failureReason") or snap.get("failureReason") or feedback.get("failureReason") or []
    if isinstance(fr, str):
        fr = [fr]
    fr_l = {str(x).lower() for x in fr}

    if status == "success":
        return FC_SUCCESS
    if status == "failed" and (action == "accept" or snap.get("solved")):
        return FC_VERIFY_FAILED

    if (
        "timeout" in reason
        or "timeout" in fr_l
        or (status == "unknown" and ("timeout" in reason or "timed" in reason))
    ):
        return FC_SOLVER_TIMEOUT

    if (
        snap.get("vlmConflict")
        or "conflict" in reason
        or "ocr_conflict" in fr_l
        or "model_conflict" in reason
        or "dddd/vlm conflict" in reason
    ):
        return FC_MODEL_CONFLICT

    if "kind" in reason or "kind_uncertain" in fr_l or "unknown kind" in reason:
        return FC_KIND_UNCERTAIN

    if (
        "color/rotated" in reason
        or "unsupported" in reason
        or "no reliable" in reason
        or "geometry" in reason
        or "slider_unreliable" in fr_l
        or "geometry_uncertain" in fr_l
    ):
        return FC_UNSUPPORTED_CAPTCHA

    if status == "not_executed" or action == "abstain":
        return FC_OCR_ABSTAIN

    if status == "unknown":
        return FC_UNKNOWN
    return FC_UNKNOWN


def _budget_remaining(attempt_index: int, budget: int) -> int:
    """attempt_index is 1-based count of attempts already consumed."""
    return max(0, int(budget) - int(attempt_index))


def plan_retry(
    *,
    feedback: dict | None = None,
    decision: dict | None = None,
    attempt: dict | None = None,
    observation: dict | None = None,
    snap: dict | None = None,
    attempt_index: int | None = None,
    max_attempts_override: int | None = None,
) -> dict[str, Any]:
    """Pure Retry Policy Engine.

    Returns retry / nextStrategy / reason / failureClass / attemptBudgetRemaining / hints.
    Does not mutate decisionScore / confidence.
    """
    budget = int(max_attempts_override) if max_attempts_override is not None else max_attempts()
    attempt = attempt or {}
    feedback = feedback or {}
    decision = dict(decision or {})
    snap = snap or {}
    if not decision.get("action") and snap:
        d = snap.get("decision")
        if isinstance(d, dict):
            decision = {**d, **decision}
        decision.setdefault("decisionScore", snap.get("decisionScore"))
        decision.setdefault("confidence", snap.get("confidence"))

    idx = attempt_index
    if idx is None:
        try:
            idx = int(attempt.get("index") or attempt.get("attemptIndex") or 1)
        except (TypeError, ValueError):
            idx = 1
    idx = max(1, int(idx))
    remaining = _budget_remaining(idx, budget)

    failure_class = classify_failure(
        decision=decision,
        feedback=feedback,
        observation=observation,
        snap=snap,
    )

    base: dict[str, Any] = {
        "failureClass": failure_class,
        "attemptBudgetRemaining": remaining,
        "attemptIndex": idx,
        "maxAttempts": budget,
        "sessionId": attempt.get("sessionId") or snap.get("sessionId"),
        "attemptId": attempt.get("attemptId") or snap.get("attemptId"),
    }

    def out(
        retry: bool,
        strategy: str,
        reason: str,
        *,
        hints: dict | None = None,
    ) -> dict[str, Any]:
        can = bool(retry) and remaining > 0
        if can:
            next_strategy = strategy
        elif strategy == ST_REMAIN_ABSTAIN:
            next_strategy = ST_REMAIN_ABSTAIN
        else:
            next_strategy = ST_STOP
        return {
            **base,
            "retry": can,
            "nextStrategy": next_strategy,
            "reason": reason if can or strategy == ST_REMAIN_ABSTAIN else (
                "max_attempts_reached" if remaining <= 0 and retry else reason
            ),
            "hints": hints or {},
        }

    if remaining <= 0:
        return out(False, ST_STOP, "max_attempts_reached")

    if failure_class == FC_SUCCESS:
        return out(False, ST_STOP, "accept_and_verify_success")

    if failure_class == FC_VERIFY_FAILED:
        return out(
            True,
            ST_FRESH_CAPTURE,
            "accept_but_verify_failed",
            hints={"requireFreshScreenshot": True, "sameSolver": True},
        )

    if failure_class == FC_MODEL_CONFLICT:
        return out(
            True,
            ST_ALTERNATE_PREPROCESS,
            "model_conflict",
            hints={"requireFreshScreenshot": True, "vlm": "off"},
        )

    if failure_class == FC_KIND_UNCERTAIN:
        return out(
            True,
            ST_RE_DETECT,
            "kind_uncertain",
            hints={"requireFreshScreenshot": True, "kind": "auto"},
        )

    if failure_class == FC_SOLVER_TIMEOUT:
        return out(
            True,
            ST_NO_VLM,
            "solver_timeout_or_unknown",
            hints={"vlm": "off", "reducedLatency": True},
        )

    if failure_class == FC_UNSUPPORTED_CAPTCHA:
        return out(False, ST_REMAIN_ABSTAIN, "unsupported_or_unreliable_geometry")

    if failure_class == FC_OCR_ABSTAIN:
        return out(
            True,
            ST_ALTERNATE_PREPROCESS,
            "ocr_abstain_not_executed",
            hints={"requireFreshScreenshot": True, "preprocess": "alternate"},
        )

    return out(
        True,
        ST_REDUCED_LATENCY,
        "unknown_feedback",
        hints={"vlm": "off", "reducedLatency": True, "requireFreshScreenshot": True},
    )


def apply_strategy_to_request(req: dict, plan: dict) -> dict:
    """Annotate next solve request with retry hints (does not change past attempts)."""
    out_req = dict(req)
    hints = dict(plan.get("hints") or {})
    strategy = str(plan.get("nextStrategy") or "")
    if strategy == ST_RE_DETECT:
        out_req["kind"] = "auto"
        hints.setdefault("kind", "auto")
    if strategy in (ST_NO_VLM, ST_REDUCED_LATENCY) or hints.get("vlm") == "off":
        hints["vlm"] = "off"
    if strategy == ST_FRESH_CAPTURE:
        hints["requireFreshScreenshot"] = True
        hints["sameSolver"] = True
    out_req["retryHints"] = hints
    out_req["retryPlan"] = {
        "nextStrategy": plan.get("nextStrategy"),
        "failureClass": plan.get("failureClass"),
        "reason": plan.get("reason"),
    }
    for k in ("decisionScore", "confidence", "decision", "observation", "attemptId", "solved", "text"):
        out_req.pop(k, None)
    return out_req
