"""E2-B1: evidence-gap routing hint (observation only).

Predicts whether secondary evidence is *worth obtaining*, not whether the
answer is correct. Never changes secondary invocation / Decision / Retry.
"""
from __future__ import annotations

import os
from typing import Any

# Frozen reason codes (REQ §19.11 / Phase 2 freeze).
LOW_CHAR_CONFIDENCE = "LOW_CHAR_CONFIDENCE"
LOW_CHAR_MARGIN = "LOW_CHAR_MARGIN"
CANDIDATE_UNSTABLE = "CANDIDATE_UNSTABLE"
MISSING_INDEPENDENT_EVIDENCE = "MISSING_INDEPENDENT_EVIDENCE"

ALLOWED_CODES = frozenset(
    {
        LOW_CHAR_CONFIDENCE,
        LOW_CHAR_MARGIN,
        CANDIDATE_UNSTABLE,
        MISSING_INDEPENDENT_EVIDENCE,
    }
)


def routing_hint_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_ROUTING_HINT") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.routingHint", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def _env_float(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _char_conf_threshold() -> float:
    """charMin below this → LOW_CHAR_CONFIDENCE (E1 FA means ~0.3–0.4)."""
    return _env_float("HERMES_CAPTCHA_HINT_CHAR_MIN", 0.45)


def _char_margin_threshold() -> float:
    """charMinMargin below this → LOW_CHAR_MARGIN."""
    return _env_float("HERMES_CAPTCHA_HINT_CHAR_MARGIN", 0.12)


def _vote_margin_threshold() -> float:
    """candidateMargin below this (with runner) → CANDIDATE_UNSTABLE."""
    return _env_float("HERMES_CAPTCHA_HINT_VOTE_MARGIN", 0.15)


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def build_routing_hint(result: dict[str, Any] | None) -> dict[str, Any]:
    """Build top-level routingHint from existing evidence fields only.

    Forbidden inputs: captchaType, attempt/retry, decisionScore.
    """
    result = result or {}
    reasons: list[dict[str, Any]] = []

    char_min = _as_float(result.get("charMinConfidence"))
    if char_min is None:
        summary = result.get("charSummary")
        if isinstance(summary, dict):
            char_min = _as_float(summary.get("charMinConfidence"))
    thr_char = _char_conf_threshold()
    if char_min is not None and char_min < thr_char:
        reasons.append({"code": LOW_CHAR_CONFIDENCE, "value": round(char_min, 4)})

    char_margin = _as_float(result.get("charMinMargin"))
    thr_cm = _char_margin_threshold()
    if char_margin is not None and char_margin < thr_cm:
        reasons.append({"code": LOW_CHAR_MARGIN, "value": round(char_margin, 4)})

    unstable = False
    unstable_value: float | None = None
    if bool(result.get("tightCandidateMargin")):
        unstable = True
        unstable_value = _as_float(result.get("candidateMargin"))
    vote_margin = _as_float(result.get("candidateMargin"))
    runner = str(result.get("runnerUpText") or "").strip()
    thr_vm = _vote_margin_threshold()
    if (
        not unstable
        and runner
        and vote_margin is not None
        and vote_margin < thr_vm
        and vote_margin < 0.999
    ):
        unstable = True
        unstable_value = vote_margin
    primary = str(result.get("text") or "").strip()
    char_runner = str(result.get("charRunnerUpText") or "").strip()
    if (
        not unstable
        and primary
        and char_runner
        and char_runner.casefold() != primary.casefold()
    ):
        unstable = True
        unstable_value = char_margin if char_margin is not None else vote_margin
    if unstable:
        reasons.append(
            {
                "code": CANDIDATE_UNSTABLE,
                "value": round(unstable_value, 4) if unstable_value is not None else None,
            }
        )

    # independentAgree=false ⇒ missing enhancement evidence (≠ wrong answer).
    if "independentAgree" in result and result.get("independentAgree") is False:
        reasons.append({"code": MISSING_INDEPENDENT_EVIDENCE, "value": None})

    # Deduplicate by code (keep first).
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for r in reasons:
        code = str(r.get("code") or "")
        if code not in ALLOWED_CODES or code in seen:
            continue
        seen.add(code)
        uniq.append(r)

    recommend = bool(uniq)
    codes = {str(r["code"]) for r in uniq}
    if codes & {LOW_CHAR_CONFIDENCE, LOW_CHAR_MARGIN}:
        priority = "high"
    elif CANDIDATE_UNSTABLE in codes:
        priority = "medium"
    elif uniq:
        priority = "low"
    else:
        priority = "low"

    return {
        "recommendSecondary": recommend,
        "priority": priority,
        "applied": False,
        "reasons": uniq,
        "observationOnly": True,
    }
