"""EE-3 Captcha Adapter unit tests."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from adapters.captcha.mapper import build_bundle, build_bundle_dict  # noqa: E402


SAMPLE = {
    "text": "7qprzf",
    "engine": "ddddocr",
    "confidence": 0.8,
    "preprocess": "chroma_ink",
    "charMinConfidence": 0.30,
    "charMinMargin": 0.048,
    "charMeanConfidence": 0.55,
    "characterEvidence": [{"pos": 0}, {"pos": 1}],
    "secondaryText": "7qpmzf",
    "secondarySource": "ppllocr",
    "secondaryAvailable": True,
    "secondaryComparison": {
        "status": "conflict",
        "reason": "char_mismatch",
        "comparable": True,
        "primary": {"text": "7qprzf"},
        "secondary": {"text": "7qpmzf"},
        "charDiff": 1,
    },
    "comparisonStatus": "conflict",
    "comparisonReason": "char_mismatch",
    "independentAgree": False,
    "independentConflict": True,
    "routingHint": {
        "recommendSecondary": True,
        "priority": "high",
        "applied": False,
        "reasons": [
            {"code": "LOW_CHAR_MARGIN", "value": 0.048},
            {"code": "MISSING_INDEPENDENT_EVIDENCE", "value": None},
        ],
    },
    "decision": "accept",
    "decisionScore": 0.7,
    "evidenceScore": 0.7,
    "solved": True,
}


class CaptchaAdapterTests(unittest.TestCase):
    def test_build_bundle_preserves_info(self) -> None:
        b = build_bundle(SAMPLE)
        d = b.to_json_dict()
        self.assertGreaterEqual(len(d["candidateSet"]), 2)
        sources = {c["source"] for c in d["candidateSet"]}
        self.assertIn("ddddocr", sources)
        self.assertIn("ppllocr", sources)

        types = {e["type"] for e in d["evidences"]}
        self.assertIn("char_confidence", types)
        self.assertIn("char_margin", types)

        self.assertEqual(len(d["comparisons"]), 1)
        self.assertEqual(d["comparisons"][0]["status"], "conflict")

        gap_types = {g["type"] for g in d["gaps"]}
        self.assertIn("LOW_CHAR_MARGIN", gap_types)
        self.assertIn("OPTIONAL_EVIDENCE", gap_types)
        self.assertNotIn("MISSING_INDEPENDENT_EVIDENCE", gap_types)

        self.assertNotIn("accept", d)
        self.assertEqual(d["summary"]["primaryGap"], "LOW_CHAR_MARGIN")
        self.assertTrue(d["summary"]["gapHint"]["strong"])

        lines = b.explain_lines()
        self.assertTrue(any("LOW_CHAR_MARGIN" in x for x in lines["gaps"]))
        self.assertTrue(any("conflict" in x for x in lines["risk"]))

    def test_no_solve_api(self) -> None:
        import adapters.captcha as pkg

        self.assertTrue(hasattr(pkg, "build_bundle"))
        self.assertFalse(hasattr(pkg, "solve"))

    def test_agree_maps_independent_agreement_evidence(self) -> None:
        sample = dict(SAMPLE)
        sample["independentAgree"] = True
        sample["independentConflict"] = False
        sample["secondaryComparison"] = {
            "status": "agree",
            "reason": "exact",
            "comparable": True,
            "primary": {"text": "7qprzf"},
            "secondary": {"text": "7qprzf"},
        }
        sample["secondaryText"] = "7qprzf"
        sample["routingHint"] = {"recommendSecondary": False, "priority": "low", "applied": False, "reasons": []}
        d = build_bundle_dict(sample)
        types = {e["type"] for e in d["evidences"]}
        self.assertIn("independent_agreement", types)
        self.assertEqual(d["comparisons"][0]["status"], "agree")


if __name__ == "__main__":
    unittest.main()
