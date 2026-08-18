"""Captcha Evidence Adapter — build EvidenceBundle from solver result (EE-3).

Public API: ``build_bundle`` / ``build_bundle_dict`` only.
Does NOT solve, decide, retry, or mutate captcha Decision fields.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Ensure evidence-engine root is importable when loaded from captcha-solver.
_EE_ROOT = Path(__file__).resolve().parents[2]
if str(_EE_ROOT) not in sys.path:
    sys.path.insert(0, str(_EE_ROOT))

from core.bundle import EvidenceBundle  # noqa: E402
from core.explain import Explain  # noqa: E402

from .candidate_mapper import map_candidates  # noqa: E402
from .comparison_mapper import map_comparisons  # noqa: E402
from .evidence_mapper import map_evidences  # noqa: E402
from .gap_mapper import map_gaps  # noqa: E402


def build_bundle(result: dict[str, Any] | None) -> EvidenceBundle:
    """Map captcha solver result / observation mirrors → EvidenceBundle."""
    result = result or {}
    bundle = EvidenceBundle(
        metadata={
            "adapter": "captcha",
            "adapterVersion": "0.1",
            "profile": result.get("profile"),
            "sessionId": result.get("sessionId"),
            "attemptId": result.get("attemptId"),
        }
    )

    candidates = map_candidates(result)
    for c in candidates:
        bundle.add_candidate(c)

    primary_id = candidates[0].id if candidates else "ocr-primary"
    for ev in map_evidences(result, primary_candidate_id=primary_id):
        bundle.add_evidence(ev)

    for cmp_ in map_comparisons(result):
        bundle.add_comparison(cmp_)

    for gap in map_gaps(result):
        bundle.add_gap(gap)

    # Read-only explain projection (does not drive Decision).
    bundle.set_explain(
        Explain(
            decision=str(result["decision"]) if result.get("decision") is not None else None,
            decision_score=_f(result.get("decisionScore")),
            evidence_score=_f(result.get("evidenceScore")),
            solved=bool(result["solved"]) if result.get("solved") is not None else None,
            notes=["captcha_adapter_projection"],
            metadata={
                "hasCharacterEvidence": result.get("characterEvidence") is not None,
                "hasSecondaryComparison": result.get("secondaryComparison") is not None,
                "hasRoutingHint": result.get("routingHint") is not None,
            },
        )
    )
    bundle.build_summary()
    return bundle


def build_bundle_dict(result: dict[str, Any] | None) -> dict[str, Any]:
    """JSON-serializable EvidenceBundle for observation.evidenceBundle."""
    return build_bundle(result).to_json_dict()


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
