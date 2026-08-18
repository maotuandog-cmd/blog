"""EE-3/EE-4 wiring: evidenceBundle observation must not alter Decision."""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.decision import decide_ocr_candidate  # noqa: E402
from solvers.evidence_bundle_obs import attach_evidence_bundle  # noqa: E402


class EvidenceBundleObsTests(unittest.TestCase):
    def test_attach_adds_bundle_and_schema(self) -> None:
        result = {
            "text": "abcdef",
            "engine": "ddddocr",
            "charMinConfidence": 0.2,
            "charMinMargin": 0.05,
            "secondaryText": "abcdez",
            "secondarySource": "ppllocr",
            "secondaryComparison": {
                "status": "conflict",
                "reason": "char_mismatch",
                "primary": {"text": "abcdef"},
                "secondary": {"text": "abcdez"},
            },
            "routingHint": {
                "recommendSecondary": True,
                "priority": "high",
                "applied": False,
                "reasons": [{"code": "LOW_CHAR_MARGIN", "value": 0.05}],
            },
            "decision": "accept",
            "decisionScore": 0.7,
            "confidence": 0.7,
            "solved": True,
        }
        before = copy.deepcopy(result)
        obs: dict = {"failureReason": ["low_score"]}
        out = attach_evidence_bundle(result, obs)
        self.assertIn("evidenceBundle", out)
        self.assertEqual(out.get("evidenceSchemaVersion"), "1.0")
        self.assertEqual(out.get("schemaVersion"), "1.0")
        self.assertIn("explanation", out)
        self.assertEqual(out.get("failureReason"), ["low_score"])
        for k in ("solved", "text", "decision", "decisionScore", "confidence"):
            self.assertEqual(result.get(k), before.get(k))

    def test_decision_unaffected_by_bundle_field(self) -> None:
        with patch.dict(
            "os.environ",
            {"HERMES_CAPTCHA_OCR_DECORRELATE": "0", "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "0"},
        ):
            out = decide_ocr_candidate(
                {
                    "text": "abcdef",
                    "evidenceScore": 0.9,
                    "agreementScore": 1.0,
                    "independentSources": 1,
                    "votes": 1,
                    "evidenceBundle": {"summary": {"primaryGap": "LOW_CHAR_MARGIN"}},
                    "explanation": [{"type": "risk", "message": "low char margin"}],
                },
                threshold=0.5,
            )
            self.assertEqual(out["decision"], "accept")


if __name__ == "__main__":
    unittest.main()
