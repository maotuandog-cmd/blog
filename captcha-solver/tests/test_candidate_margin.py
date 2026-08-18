"""E1-B candidate margin unit tests (observation only)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.candidate_margin import (  # noqa: E402
    char_swap_runner_up,
    tight_margin_pattern,
    vote_margin_fields,
)
from solvers.decision import decide_ocr_candidate  # noqa: E402
from solvers.ocr import fuse_ocr_votes  # noqa: E402


class CandidateMarginTests(unittest.TestCase):
    def test_vote_margin_tight_near_neighbors(self) -> None:
        weighed = [
            ("raw", "AB12CD", 1.0),
            ("up2", "AB12CD", 1.0),
            ("gray", "ABIZCD", 1.0),
            ("bin", "ABIZCD", 0.9),
        ]
        m = vote_margin_fields(weighed, tight_gap=0.15)
        self.assertEqual(m["topCandidateText"], "AB12CD")
        self.assertEqual(m["runnerUpText"], "ABIZCD")
        self.assertAlmostEqual(float(m["candidateMargin"]), (2.0 - 1.9) / 3.9, places=3)
        self.assertTrue(m["tightCandidateMargin"])

    def test_unique_spelling_margin_is_one(self) -> None:
        m = vote_margin_fields([("raw", "AAAAAA", 1.0), ("up2", "AAAAAA", 1.0)])
        self.assertIsNone(m["runnerUpText"])
        self.assertEqual(m["candidateMargin"], 1.0)
        self.assertFalse(m["tightCandidateMargin"])

    def test_char_swap_runner_up(self) -> None:
        ev = [
            {"char": "A", "position": 0, "confidence": 0.9, "alternatives": [{"char": "4", "score": 0.05}], "margin": 0.85},
            {
                "char": "B",
                "position": 1,
                "confidence": 0.43,
                "alternatives": [{"char": "8", "score": 0.39}],
                "margin": 0.04,
                "ambiguous": True,
            },
        ]
        out = char_swap_runner_up("AB12CD", ev)
        self.assertEqual(out["charRunnerUpText"], "A812CD")
        self.assertEqual(out["charRunnerUpFromPosition"], 1)
        self.assertAlmostEqual(float(out["charMinMargin"]), 0.04, places=4)

    def test_fuse_attaches_margin_without_changing_decision(self) -> None:
        with patch.dict(
            os.environ,
            {
                "HERMES_CAPTCHA_OCR_LEN": "",
                "HERMES_CAPTCHA_OCR_DECORRELATE": "0",
                "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "0",
            },
        ):
            hit = fuse_ocr_votes(
                [("raw", "aaaa"), ("up2", "aaaa"), ("gray", "bbbb"), ("bin", "aaaa")],
                attempts=4,
                threshold=0.5,
            )
            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit["decision"], "accept")
            self.assertIn("candidateMargin", hit)
            self.assertEqual(hit.get("runnerUpText"), "bbbb")
            # Margin is observational; Decision still keys off evidenceScore.
            decided = decide_ocr_candidate(
                {
                    "text": "aaaa",
                    "evidenceScore": 0.75,
                    "votes": 3,
                    "independentSources": 1,
                    "agreementScore": 0.75,
                    "weightShare": 0.75,
                    "candidateMargin": 0.01,
                    "tightCandidateMargin": True,
                },
                threshold=0.5,
            )
            self.assertEqual(decided["decision"], "accept")
            self.assertAlmostEqual(float(decided["decisionScore"]), 0.75, places=4)

    def test_tight_pattern_flags(self) -> None:
        p = tight_margin_pattern(candidate_margin=0.02, tight=True, char_min_margin=0.05)
        self.assertTrue(p["tightMarginEvidence"])
        self.assertIn("tight_vote_margin", p["flags"])
        self.assertIn("tight_char_margin", p["flags"])


if __name__ == "__main__":
    unittest.main()
