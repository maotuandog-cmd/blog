"""EE-4 Compatibility Layer unit tests."""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from compat import (  # noqa: E402
    EVIDENCE_SCHEMA_VERSION,
    assert_contract_unchanged,
    build_compatible_observation_fields,
    build_explanation,
    bundle_to_legacy_mirrors,
    legacy_to_bundle,
)


ACCEPT_SAMPLE = {
    "text": "abc123",
    "engine": "ddddocr",
    "confidence": 0.92,
    "charMinConfidence": 0.92,
    "charMinMargin": 0.40,
    "secondaryText": "abc123",
    "secondarySource": "ppllocr",
    "secondaryComparison": {
        "status": "agree",
        "reason": "exact",
        "comparable": True,
        "primary": {"text": "abc123"},
        "secondary": {"text": "abc123"},
    },
    "independentAgree": True,
    "routingHint": {"recommendSecondary": False, "priority": "low", "applied": False, "reasons": []},
    "decision": "accept",
    "decisionScore": 0.9,
    "evidenceScore": 0.9,
    "solved": True,
}

ABSTAIN_SAMPLE = {
    "text": "abc128",
    "engine": "ddddocr",
    "confidence": 0.4,
    "charMinConfidence": 0.22,
    "charMinMargin": 0.02,
    "secondaryText": "abc12",
    "secondarySource": "ppllocr",
    "secondaryComparison": {
        "status": "incomparable",
        "reason": "length_mismatch",
        "comparable": False,
        "primary": {"text": "abc128"},
        "secondary": {"text": "abc12"},
    },
    "independentAgree": False,
    "routingHint": {
        "recommendSecondary": True,
        "priority": "high",
        "applied": False,
        "reasons": [
            {"code": "LOW_CHAR_MARGIN", "value": 0.02},
            {"code": "MISSING_INDEPENDENT_EVIDENCE"},
        ],
    },
    "decision": "abstain",
    "decisionScore": 0.4,
    "solved": False,
}


class CompatTests(unittest.TestCase):
    def test_schema_headers_and_bundle(self) -> None:
        fields = build_compatible_observation_fields(ACCEPT_SAMPLE)
        self.assertEqual(fields["evidenceSchemaVersion"], EVIDENCE_SCHEMA_VERSION)
        self.assertEqual(fields["schemaVersion"], "1.0")
        self.assertIn("evidenceBundle", fields)
        self.assertIn("explanation", fields)
        self.assertTrue(any(x.get("type") == "support" for x in fields["explanation"]))

    def test_abstain_has_evidence(self) -> None:
        fields = build_compatible_observation_fields(ABSTAIN_SAMPLE)
        bundle = fields["evidenceBundle"]
        self.assertTrue(bundle["candidateSet"])
        self.assertTrue(bundle["gaps"])
        gap_types = {g["type"] for g in bundle["gaps"]}
        self.assertIn("LOW_CHAR_MARGIN", gap_types)
        self.assertIn("OPTIONAL_EVIDENCE", gap_types)
        expl = fields["explanation"]
        self.assertTrue(any(x.get("type") == "gap" for x in expl))
        self.assertTrue(any(x.get("type") == "risk" or x.get("type") == "comparison" for x in expl))

    def test_reverse_mirrors_do_not_own_contract(self) -> None:
        bundle = legacy_to_bundle(ACCEPT_SAMPLE)
        mirrors = bundle_to_legacy_mirrors(bundle)
        self.assertIn("legacyMirrors", mirrors)
        self.assertEqual(mirrors["legacyMirrors"]["primaryValue"], "abc123")
        self.assertNotIn("solved", mirrors)
        self.assertNotIn("decision", mirrors["legacyMirrors"])

    def test_regression_zero_contract(self) -> None:
        before = copy.deepcopy(ACCEPT_SAMPLE)
        after = copy.deepcopy(ACCEPT_SAMPLE)
        fields = build_compatible_observation_fields(after)
        after["observation"] = {"evidenceBundle": fields["evidenceBundle"], **fields}
        # Contract keys must be unchanged
        diffs = assert_contract_unchanged(before, after)
        self.assertEqual(diffs, [])

    def test_explanation_not_decision(self) -> None:
        bundle = legacy_to_bundle(ACCEPT_SAMPLE)
        expl = build_explanation(bundle)
        for item in expl:
            self.assertNotIn(item.get("type"), ("accept", "reject", "decision"))


if __name__ == "__main__":
    unittest.main()
