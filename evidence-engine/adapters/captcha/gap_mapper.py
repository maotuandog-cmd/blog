"""Map captcha routingHint → Evidence Engine Gaps (§19.13)."""
from __future__ import annotations

from typing import Any

from core.gap import Gap, TRUE_GAP_TYPES, clamp_gap_severity


def map_gaps(result: dict[str, Any] | None) -> list[Gap]:
    result = result or {}
    out: list[Gap] = []
    hint = result.get("routingHint")
    if not isinstance(hint, dict):
        return out

    priority = str(hint.get("priority") or "low")
    reasons = hint.get("reasons") or []
    if isinstance(reasons, list):
        for item in reasons:
            if isinstance(item, dict):
                code = str(item.get("code") or item.get("type") or "")
                value = item.get("value")
            else:
                code = str(item)
                value = None
            if not code:
                continue
            # Legacy missing → optional
            if code == "MISSING_INDEPENDENT_EVIDENCE":
                code = "OPTIONAL_EVIDENCE"
            sev = priority if code in TRUE_GAP_TYPES else "low"
            if code == "OPTIONAL_EVIDENCE":
                sev = "low"
            elif code in TRUE_GAP_TYPES and priority == "low":
                # Char/candidate codes default at least medium when flagged
                sev = "high" if code.startswith("LOW_CHAR") else "medium"
            gap = clamp_gap_severity(
                Gap(type=code, severity=sev, value=_as_float(value), metadata={"fromRoutingHint": True})
            )
            out.append(gap)

    # Also accept string reason (E2-A style)
    if not out and hint.get("reason"):
        code = str(hint.get("reason"))
        if code == "MISSING_INDEPENDENT_EVIDENCE":
            code = "OPTIONAL_EVIDENCE"
        out.append(
            clamp_gap_severity(
                Gap(
                    type=code,
                    severity="low" if code == "OPTIONAL_EVIDENCE" else priority,  # type: ignore[arg-type]
                    metadata={"fromRoutingHint": True, "legacyReason": True},
                )
            )
        )
    return out


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
