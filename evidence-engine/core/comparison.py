"""Evidence Engine — Comparison (EE-1; aligns E2-B2)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ComparisonStatus = Literal["agree", "conflict", "incomparable", "unknown"]

ALLOWED_STATUSES = frozenset({"agree", "conflict", "incomparable", "unknown"})


@dataclass
class Comparison:
    """Compare two sources/candidates; incomparable ≠ conflict."""

    left: str
    right: str
    status: ComparisonStatus = "unknown"
    reason: str | None = None
    left_value: str | None = None
    right_value: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "left": self.left,
            "right": self.right,
            "status": self.status,
        }
        if self.reason is not None:
            out["reason"] = self.reason
        if self.left_value is not None:
            out["leftValue"] = self.left_value
        if self.right_value is not None:
            out["rightValue"] = self.right_value
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Comparison:
        d = data or {}
        status = str(d.get("status") or "unknown")
        if status not in ALLOWED_STATUSES:
            status = "unknown"
        return cls(
            left=str(d.get("left") or ""),
            right=str(d.get("right") or ""),
            status=status,  # type: ignore[arg-type]
            reason=(str(d["reason"]) if d.get("reason") is not None else None),
            left_value=(
                str(d["leftValue"])
                if d.get("leftValue") is not None
                else (str(d["left_value"]) if d.get("left_value") is not None else None)
            ),
            right_value=(
                str(d["rightValue"])
                if d.get("rightValue") is not None
                else (str(d["right_value"]) if d.get("right_value") is not None else None)
            ),
            metadata=dict(d.get("metadata") or {}),
        )


def normalize_comparison_status(status: str | None, *, reason: str | None = None) -> ComparisonStatus:
    """Map legacy / free-form labels onto frozen statuses."""
    s = str(status or "").strip().lower()
    if s in ALLOWED_STATUSES:
        return s  # type: ignore[return-value]
    r = str(reason or "").strip().lower()
    if r in ("exact", "same_text", "agree"):
        return "agree"
    if r in ("char_mismatch", "mismatch"):
        return "conflict"
    if r in (
        "length_mismatch",
        "empty",
        "no_candidate",
        "unsupported_chars",
        "low_confidence",
        "incomparable",
        "source_unavailable",
    ):
        return "incomparable"
    return "unknown"
