"""Legacy ↔ EvidenceBundle compatibility helpers (EE-4).

Forward: legacy captcha fields → bundle (via captcha adapter).
Reverse: bundle → legacy *mirrors* for old Worker consumers (never overwrite
contract fields that already exist on the live response).
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_EE_ROOT = Path(__file__).resolve().parents[1]
if str(_EE_ROOT) not in sys.path:
    sys.path.insert(0, str(_EE_ROOT))

from adapters.captcha.mapper import build_bundle  # noqa: E402
from core.bundle import EvidenceBundle  # noqa: E402

from .explanation import build_explanation  # noqa: E402
from .schema import EVIDENCE_SCHEMA_VERSION, schema_headers  # noqa: E402


def legacy_to_bundle(result: dict[str, Any] | None) -> EvidenceBundle:
    """Forward map: existing captcha result mirrors → EvidenceBundle."""
    return build_bundle(result or {})


def bundle_to_legacy_mirrors(bundle: EvidenceBundle | None) -> dict[str, Any]:
    """Reverse map: produce *additive* legacy-shaped mirrors.

    Does not claim ownership of ``text`` / ``solved`` / ``decision``.
    Intended for documentation, bench, and future Worker soft-upgrade paths.
    """
    if bundle is None:
        return {}
    summary = bundle.summary
    primary = bundle.candidate_set[0] if bundle.candidate_set else None
    mirrors: dict[str, Any] = {
        "evidenceSchemaVersion": EVIDENCE_SCHEMA_VERSION,
        "legacyMirrors": {
            "primaryValue": primary.value if primary else None,
            "primarySource": primary.source if primary else None,
            "evidenceQuality": summary.evidence_quality,
            "supportCount": summary.support_count,
            "riskCount": summary.risk_count,
            "primaryGap": summary.primary_gap,
            "comparisonStatuses": list(summary.comparison_counts.keys()),
            "recommendSecondary": (summary.gap_hint or {}).get("recommendSecondary"),
            "routingStrong": (summary.gap_hint or {}).get("strong"),
        },
    }
    return mirrors


def build_compatible_observation_fields(result: dict[str, Any] | None) -> dict[str, Any]:
    """Fields to merge into observation without touching Decision contract."""
    result = result or {}
    bundle = legacy_to_bundle(result)
    payload = bundle.to_json_dict()
    payload["schemaVersion"] = EVIDENCE_SCHEMA_VERSION
    headers = schema_headers()
    return {
        **headers,
        "evidenceBundle": payload,
        "explanation": build_explanation(bundle),
        "legacyMirrors": bundle_to_legacy_mirrors(bundle).get("legacyMirrors"),
    }


def assert_contract_unchanged(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    keys: tuple[str, ...] = ("solved", "text", "decision", "decisionScore", "confidence", "offsetX"),
) -> list[str]:
    """Return list of differing contract keys (empty = regression zero)."""
    diffs: list[str] = []
    for k in keys:
        if before.get(k) != after.get(k):
            diffs.append(k)
    return diffs
