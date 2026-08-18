"""Unified explanation messages from EvidenceBundle (EE-4).

Explain only — never Decision / accept / retry.
"""
from __future__ import annotations

from typing import Any, Literal

from core.bundle import EvidenceBundle

ExplainType = Literal["support", "risk", "gap", "comparison", "info"]


def build_explanation(bundle: EvidenceBundle | None) -> list[dict[str, Any]]:
    """Flatten bundle into stable explanation[] for Agent / bench / ops."""
    if bundle is None:
        return []
    items: list[dict[str, Any]] = []
    lines = bundle.explain_lines()
    for msg in lines.get("support") or []:
        items.append({"type": "support", "message": str(msg)})
    for msg in lines.get("risk") or []:
        items.append({"type": "risk", "message": str(msg)})
    for msg in lines.get("gaps") or []:
        items.append({"type": "gap", "message": str(msg)})

    for cmp_ in bundle.comparisons:
        msg = f"{cmp_.left}/{cmp_.right} {cmp_.status}"
        if cmp_.reason:
            msg += f" ({cmp_.reason})"
        items.append(
            {
                "type": "comparison",
                "message": msg,
                "status": cmp_.status,
                "reason": cmp_.reason,
            }
        )

    summary = bundle.summary
    if summary.primary_gap:
        items.append(
            {
                "type": "info",
                "message": f"primaryGap={summary.primary_gap}",
                "evidenceQuality": summary.evidence_quality,
            }
        )
    return items
