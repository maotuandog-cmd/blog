"""EE-2 EvidenceBundle unit tests."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import (  # noqa: E402
    Candidate,
    Comparison,
    Evidence,
    EvidenceBundle,
    Gap,
)


class EvidenceBundleTests(unittest.TestCase):
    def test_incremental_add_and_json_roundtrip(self) -> None:
        b = EvidenceBundle()
        b.add_candidate({"id": "c1", "value": "7qprzf", "source": "ddddocr", "sourceFamily": "ocr"})
        b.add_candidate({"id": "c2", "value": "7qpmzf", "source": "ppllocr", "sourceFamily": "ocr"})
        b.add_evidence(
            {
                "candidateId": "c1",
                "type": "char_confidence",
                "score": 0.30,
                "quality": "low",
                "metadata": {"charMin": 0.30},
            }
        )
        b.add_comparison(
            {
                "left": "ddddocr",
                "right": "ppllocr",
                "status": "conflict",
                "reason": "same_length_different_text",
            }
        )
        b.add_gap({"type": "LOW_CHAR_MARGIN", "severity": "high", "value": 0.02})

        payload = b.to_json_dict()
        self.assertIn("candidateSet", payload)
        self.assertIn("summary", payload)
        self.assertNotIn("accept", payload)
        self.assertNotIn("decision", payload)
        self.assertEqual(payload["summary"]["primaryGap"], "LOW_CHAR_MARGIN")
        self.assertTrue(payload["summary"]["gapHint"]["strong"])
        self.assertFalse(payload["summary"]["gapHint"]["applied"])

        raw = json.dumps(payload, ensure_ascii=False)
        back = EvidenceBundle.from_dict(json.loads(raw))
        self.assertEqual(len(back.candidate_set), 2)
        self.assertEqual(len(back.evidences), 1)
        self.assertEqual(len(back.comparisons), 1)
        self.assertEqual(len(back.gaps), 1)
        self.assertEqual(back.summary.primary_gap, "LOW_CHAR_MARGIN")

    def test_second_pass_append_secondary(self) -> None:
        b = EvidenceBundle()
        b.add_candidate(Candidate(id="c1", value="A123", source="ddddocr", source_family="ocr"))
        b.add_evidence(
            Evidence(candidate_id="c1", type="char_confidence", score=0.9, quality="high")
        )
        self.assertEqual(b.summary.candidate_count, 1)

        # Second pass: secondary OCR
        b.add_candidate({"id": "c2", "value": "A123", "source": "ppllocr", "sourceFamily": "ocr"})
        b.add_comparison(
            Comparison(left="ddddocr", right="ppllocr", status="agree", reason="same_text")
        )
        self.assertEqual(b.summary.candidate_count, 2)
        self.assertGreaterEqual(b.summary.support_count, 2)

    def test_explain_lines(self) -> None:
        b = EvidenceBundle()
        b.add_candidate({"id": "c1", "value": "A123", "source": "ddddocr"})
        b.add_evidence(
            {"candidateId": "c1", "type": "char_confidence", "score": 0.9, "quality": "high"}
        )
        b.add_evidence(
            {
                "candidateId": "c1",
                "type": "char_margin",
                "score": 0.02,
                "quality": "low",
                "metadata": {"charMinMargin": 0.02},
            }
        )
        b.add_gap({"type": "LOW_CHAR_MARGIN", "severity": "high", "value": 0.02})
        lines = b.explain_lines()
        self.assertTrue(any("char_confidence" in x for x in lines["support"]))
        self.assertTrue(any("char_margin" in x for x in lines["risk"]))
        self.assertTrue(any("LOW_CHAR_MARGIN" in x for x in lines["gaps"]))

    def test_optional_gap_not_strong_in_summary(self) -> None:
        b = EvidenceBundle()
        b.add_candidate({"id": "c1", "value": "ABCDEF", "source": "ddddocr"})
        b.add_evidence(
            {"candidateId": "c1", "type": "char_confidence", "score": 0.95, "quality": "high"}
        )
        b.add_gap({"type": "MISSING_INDEPENDENT_EVIDENCE", "severity": "high"})
        s = b.summary
        self.assertEqual(s.primary_gap, "OPTIONAL_EVIDENCE")
        self.assertFalse(s.gap_hint.get("strong"))
        self.assertEqual(s.gap_hint.get("priority"), "low")
        self.assertIn("optional_evidence_only", s.notes)

    def test_bundle_strips_decision_keys_if_smuggled(self) -> None:
        b = EvidenceBundle()
        b.metadata["note"] = "test"
        d = b.to_dict()
        d["accept"] = True
        d["decision"] = "accept"
        # from_dict must not resurrect accept as first-class
        back = EvidenceBundle.from_dict(d)
        out = back.to_dict()
        self.assertNotIn("accept", out)
        self.assertNotIn("decision", out)


if __name__ == "__main__":
    unittest.main()
