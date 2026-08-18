"""Evidence Engine — Evidence Gap (EE-1; aligns E2-B1 / §19.13)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

GapSeverity = Literal["high", "medium", "low"]

# True evidence-gap codes (may drive strong recommendSecondary narrative).
TRUE_GAP_TYPES = frozenset(
    {
        "LOW_CHAR_CONFIDENCE",
        "LOW_CHAR_MARGIN",
        "CANDIDATE_UNSTABLE",
    }
)

# Optional / informational — never high priority; not strong routing alone.
OPTIONAL_GAP_TYPES = frozenset(
    {
        "OPTIONAL_EVIDENCE",
        # Legacy alias from E2-B1; treat as optional.
        "MISSING_INDEPENDENT_EVIDENCE",
    }
)

ALLOWED_GAP_TYPES = TRUE_GAP_TYPES | OPTIONAL_GAP_TYPES


@dataclass
class Gap:
    """Describes an evidence gap — not failure / not wrongness."""

    type: str
    severity: GapSeverity = "low"
    value: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_true_gap(self) -> bool:
        return self.type in TRUE_GAP_TYPES

    @property
    def is_optional(self) -> bool:
        return self.type in OPTIONAL_GAP_TYPES or self.type == "OPTIONAL_EVIDENCE"

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": self.type,
            "severity": self.severity,
            "isTrueGap": self.is_true_gap,
            "isOptional": self.is_optional,
        }
        if self.value is not None:
            out["value"] = round(float(self.value), 4)
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Gap:
        d = data or {}
        raw_type = str(d.get("type") or d.get("code") or "")
        # Normalize legacy missing → optional
        if raw_type == "MISSING_INDEPENDENT_EVIDENCE":
            raw_type = "OPTIONAL_EVIDENCE"
        value = d.get("value")
        try:
            value_f = float(value) if value is not None else None
        except (TypeError, ValueError):
            value_f = None
        severity = str(d.get("severity") or d.get("priority") or "low")
        if severity not in ("high", "medium", "low"):
            severity = "low"
        gap = cls(
            type=raw_type,
            severity=severity,  # type: ignore[arg-type]
            value=value_f,
            metadata=dict(d.get("metadata") or {}),
        )
        return clamp_gap_severity(gap)


def clamp_gap_severity(gap: Gap) -> Gap:
    """§19.13: optional gaps cannot be high/medium strong routing."""
    if gap.type in OPTIONAL_GAP_TYPES or gap.type == "OPTIONAL_EVIDENCE":
        if gap.type == "MISSING_INDEPENDENT_EVIDENCE":
            gap.type = "OPTIONAL_EVIDENCE"
        gap.severity = "low"
        return gap
    if gap.type in TRUE_GAP_TYPES:
        # Preserve high/medium for true gaps; default medium if unset oddly
        if gap.severity not in ("high", "medium", "low"):
            gap.severity = "medium"
        return gap
    # Unknown types → low, optional-like
    gap.severity = "low"
    return gap


def recommend_secondary_from_gaps(gaps: list[Gap]) -> dict[str, Any]:
    """Observation helper: strong recommend only from true gaps.

    Does not apply routing; applied stays false at Engine layer.
    """
    true_gaps = [g for g in gaps if g.is_true_gap]
    optional = [g for g in gaps if g.is_optional]
    if true_gaps:
        # highest severity among true gaps
        order = {"high": 3, "medium": 2, "low": 1}
        top = max(true_gaps, key=lambda g: order.get(g.severity, 0))
        return {
            "recommendSecondary": True,
            "priority": top.severity,
            "applied": False,
            "strong": True,
            "reasons": [g.to_dict() for g in true_gaps],
            "optional": [g.to_dict() for g in optional],
        }
    if optional:
        return {
            "recommendSecondary": True,
            "priority": "low",
            "applied": False,
            "strong": False,
            "reasons": [g.to_dict() for g in optional],
            "optional": [g.to_dict() for g in optional],
            "note": "optional_only_not_strong_routing",
        }
    return {
        "recommendSecondary": False,
        "priority": "low",
        "applied": False,
        "strong": False,
        "reasons": [],
        "optional": [],
    }
