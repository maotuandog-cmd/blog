"""EE-1 Evidence Engine core model unit tests."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import (  # noqa: E402
    OPTIONAL_GAP_TYPES,
    TRUE_GAP_TYPES,
    Candidate,
    Comparison,
    Evidence,
    Explain,
    Gap,
    clamp_gap_severity,
    normalize_comparison_status,
    quality_from_score,
    recommend_secondary_from_gaps,
)


class CandidateTests(unittest.TestCase):
    def test_roundtrip(self) -> None:
        c = Candidate(id="c1", value="7qprzf", source="ddddocr", source_family="ocr")
        d = c.to_dict()
        self.assertEqual(d["sourceFamily"], "ocr")
        back = Candidate.from_dict(d)
        self.assertEqual(back.value, "7qprzf")
        self.assertEqual(back.source, "ddddocr")


class EvidenceTests(unittest.TestCase):
    def test_roundtrip_and_quality(self) -> None:
        e = Evidence(
            candidate_id="c1",
            type="char_confidence",
            score=0.82,
            quality=quality_from_score(0.82),
            metadata={"charMin": 0.2},
        )
        self.assertEqual(e.quality, "high")
        d = e.to_dict()
        self.assertEqual(d["candidateId"], "c1")
        self.assertEqual(Evidence.from_dict(d).metadata["charMin"], 0.2)


class ComparisonTests(unittest.TestCase):
    def test_statuses_frozen(self) -> None:
        for st in ("agree", "conflict", "incomparable", "unknown"):
            cmp_ = Comparison(left="ddddocr", right="ppllocr", status=st, reason="same_text")
            self.assertEqual(cmp_.to_dict()["status"], st)

    def test_normalize_length_mismatch(self) -> None:
        self.assertEqual(
            normalize_comparison_status(None, reason="length_mismatch"),
            "incomparable",
        )
        self.assertEqual(normalize_comparison_status("conflict"), "conflict")


class GapTests(unittest.TestCase):
    def test_true_gap_codes(self) -> None:
        self.assertIn("LOW_CHAR_MARGIN", TRUE_GAP_TYPES)
        self.assertIn("OPTIONAL_EVIDENCE", OPTIONAL_GAP_TYPES)

    def test_optional_clamped_to_low(self) -> None:
        g = Gap(type="MISSING_INDEPENDENT_EVIDENCE", severity="high", value=None)
        g = clamp_gap_severity(g)
        self.assertEqual(g.type, "OPTIONAL_EVIDENCE")
        self.assertEqual(g.severity, "low")
        self.assertTrue(g.is_optional)
        self.assertFalse(g.is_true_gap)

    def test_from_dict_normalizes_missing(self) -> None:
        g = Gap.from_dict({"type": "MISSING_INDEPENDENT_EVIDENCE", "severity": "medium"})
        self.assertEqual(g.type, "OPTIONAL_EVIDENCE")
        self.assertEqual(g.severity, "low")

    def test_recommend_strong_only_from_true_gap(self) -> None:
        gaps = [
            Gap(type="OPTIONAL_EVIDENCE", severity="low"),
            Gap(type="LOW_CHAR_MARGIN", severity="high", value=0.12),
        ]
        out = recommend_secondary_from_gaps(gaps)
        self.assertTrue(out["recommendSecondary"])
        self.assertTrue(out["strong"])
        self.assertEqual(out["priority"], "high")
        self.assertFalse(out["applied"])

    def test_optional_only_not_strong(self) -> None:
        out = recommend_secondary_from_gaps([Gap(type="OPTIONAL_EVIDENCE", severity="low")])
        self.assertTrue(out["recommendSecondary"])
        self.assertFalse(out["strong"])
        self.assertEqual(out["priority"], "low")
        self.assertEqual(out.get("note"), "optional_only_not_strong_routing")


class ExplainTests(unittest.TestCase):
    def test_read_only_roundtrip(self) -> None:
        x = Explain(decision="accept", decision_score=0.9, evidence_score=0.85, solved=True)
        d = x.to_dict()
        self.assertEqual(d["decision"], "accept")
        self.assertNotIn("mutate", d)
        back = Explain.from_dict(d)
        self.assertEqual(back.decision, "accept")


if __name__ == "__main__":
    unittest.main()
