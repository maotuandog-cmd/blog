"""Map captcha secondaryComparison → Evidence Engine Comparison."""
from __future__ import annotations

from typing import Any

from core.comparison import Comparison, normalize_comparison_status


def map_comparisons(result: dict[str, Any] | None) -> list[Comparison]:
    result = result or {}
    out: list[Comparison] = []

    cmp_ = result.get("secondaryComparison")
    left = str(result.get("engine") or "ddddocr").split("+")[0] or "ddddocr"
    right = str(result.get("secondarySource") or "ppllocr") or "ppllocr"

    if isinstance(cmp_, dict):
        status = normalize_comparison_status(cmp_.get("status"), reason=str(cmp_.get("reason") or "") or None)
        primary = cmp_.get("primary") if isinstance(cmp_.get("primary"), dict) else {}
        secondary = cmp_.get("secondary") if isinstance(cmp_.get("secondary"), dict) else {}
        out.append(
            Comparison(
                left=left,
                right=right,
                status=status,
                reason=(str(cmp_["reason"]) if cmp_.get("reason") is not None else None),
                left_value=str(primary.get("text") or result.get("text") or "") or None,
                right_value=str(secondary.get("text") or result.get("secondaryText") or "") or None,
                metadata={
                    "comparable": cmp_.get("comparable"),
                    "charDiff": cmp_.get("charDiff"),
                    "primaryNorm": cmp_.get("primaryNorm"),
                    "secondaryNorm": cmp_.get("secondaryNorm"),
                },
            )
        )
        return out

    # Fallback from flat fields
    status_raw = result.get("comparisonStatus")
    reason = result.get("comparisonReason")
    if status_raw or reason or result.get("independentAgree") is not None:
        if result.get("independentAgree") is True:
            status = "agree"
        elif result.get("independentConflict") is True:
            status = "conflict"
        else:
            status = normalize_comparison_status(status_raw, reason=str(reason or "") or None)
        out.append(
            Comparison(
                left=left,
                right=right,
                status=status,
                reason=str(reason) if reason is not None else None,
                left_value=str(result.get("text") or "") or None,
                right_value=str(result.get("secondaryText") or "") or None,
                metadata={"fromFlatFields": True},
            )
        )
    return out
