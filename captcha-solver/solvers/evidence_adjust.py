"""E1-D narrow: independentAgree soft bonus only.

Calibrates evidenceScore when primary and secondary agree (same-length comparable).
Does NOT:
  - change Decision threshold
  - apply conflict / weak|conflict / charRisk penalties
  - hard-accept on agree alone
"""
from __future__ import annotations

import os
from typing import Any


def _round4(x: float | None) -> float | None:
    if x is None:
        return None
    return round(float(x), 4)


def agree_bonus_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_AGREE_BONUS") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("decision.independentAgreeBonus", False))
    except (TypeError, ValueError, ImportError):
        pass
    return False


def agree_bonus_value() -> float:
    raw = (os.environ.get("HERMES_CAPTCHA_AGREE_BONUS_VALUE") or "").strip()
    if raw:
        try:
            return max(0.0, min(0.5, float(raw)))
        except ValueError:
            pass
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            v = cfg("decision.agreeBonus", 0.1)
            return max(0.0, min(0.5, float(v)))
    except (TypeError, ValueError, ImportError):
        pass
    return 0.1


def apply_independent_agree_bonus(hit: dict) -> dict:
    """Add agree bonus to evidenceScore when enabled and independentAgree.

    Always records evidenceScoreRaw + evidenceAdjustment for offline analysis.
    Never mutates threshold; never applies negative penalties.
    """
    out = dict(hit)
    try:
        raw = float(
            out.get("evidenceScore")
            if out.get("evidenceScore") is not None
            else out.get("weightShare")
            if out.get("weightShare") is not None
            else out.get("confidence")
            or 0.0
        )
    except (TypeError, ValueError):
        raw = 0.0

    out["evidenceScoreRaw"] = _round4(raw)
    enabled = agree_bonus_enabled()
    bonus = agree_bonus_value() if enabled else 0.0
    agree = bool(out.get("independentAgree"))
    # Hygiene: only comparable exact agree (independentAgree already gated).
    applied = bool(enabled and agree and bonus > 0)
    adjusted = raw + bonus if applied else raw
    # Soft cap: do not invent certainty above 1.0 from bonus stacking.
    if adjusted > 1.0:
        adjusted = 1.0

    out["evidenceScore"] = _round4(adjusted)
    out["evidenceScoreAdjusted"] = _round4(adjusted)
    out["evidenceAdjustment"] = {
        "independentAgreeBonus": enabled,
        "bonus": _round4(bonus) if enabled else 0.0,
        "applied": applied,
        "independentAgree": agree,
        # Explicit non-goals (frozen):
        "conflictPenalty": False,
        "charRiskPenalty": False,
        "weakConflictPenalty": False,
        "thresholdChanged": False,
    }
    return out
