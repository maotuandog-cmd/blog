"""F2 Evidence de-correlation + Decision Gate tests."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.evidence import (  # noqa: E402
    build_evidence_groups,
    evidence_group_id,
    score_decorrelated_evidence,
)
from solvers.ocr import fuse_ocr_votes  # noqa: E402


class F2DecorrelateTests(unittest.TestCase):
    def test_group_id_beta_separate(self) -> None:
        self.assertEqual(evidence_group_id("raw"), "ddddocr")
        self.assertEqual(evidence_group_id("up2"), "ddddocr")
        self.assertEqual(evidence_group_id("morph_up2+beta"), "ddddocr_beta")

    def test_f2a_collapse_variants_to_one_group(self) -> None:
        groups = build_evidence_groups(
            [
                ("raw", "abcd", 1.0),
                ("up2", "abcd", 1.0),
                ("trim_up2", "abcd", 1.0),
                ("gray", "abcx", 1.0),
            ]
        )
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["id"], "ddddocr")
        self.assertEqual(groups[0]["supportFold"], "abcd")
        self.assertEqual(groups[0]["nSupport"], 3)
        self.assertEqual(groups[0]["nVariants"], 4)

    def test_f2b_single_group_does_not_score_as_four_sources(self) -> None:
        weighed = [("raw", "aaaa", 1.0), ("up2", "aaaa", 1.0), ("gray", "aaaa", 1.0), ("bin", "aaaa", 1.0)]
        ev = score_decorrelated_evidence(
            winner_fold="aaaa",
            weighed=weighed,
            votes=4,
            n_valid=4,
            n_try=4,
            weight_score=4.0,
            weight_share=1.0,
            singleton=False,
        )
        self.assertEqual(ev["independentSources"], 1)
        self.assertEqual(ev["correlatedVotes"], 4)
        # Must be strictly below raw "4 independent votes ⇒ 1.0 certainty" story for multi-vote.
        self.assertLess(float(ev["evidenceScore"]), 1.0)
        self.assertGreaterEqual(float(ev["evidenceScore"]), 0.5)

    def test_f2c_partial_correlated_abstain(self) -> None:
        hit = fuse_ocr_votes(
            [("raw", "aaaa"), ("up2", "aaaa"), ("gray", "bbbb"), ("bin", "aaaa")],
            attempts=4,
            threshold=0.5,
        )
        self.assertIsNone(hit)

    def test_f2c_unanimous_correlated_accept(self) -> None:
        hit = fuse_ocr_votes(
            [("raw", "aaaa"), ("up2", "aaaa"), ("gray", "aaaa")],
            attempts=3,
            threshold=0.5,
        )
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit["decision"], "accept")
        self.assertEqual(hit["independentSources"], 1)
        self.assertAlmostEqual(float(hit["agreementScore"]), 1.0)

    def test_two_engines_count_as_two_sources(self) -> None:
        weighed = [
            ("raw", "aaaa", 1.0),
            ("up2", "aaaa", 1.0),
            ("raw+beta", "aaaa", 1.0),
        ]
        ev = score_decorrelated_evidence(
            winner_fold="aaaa",
            weighed=weighed,
            votes=3,
            n_valid=3,
            n_try=3,
            weight_score=3.0,
            weight_share=1.0,
            singleton=False,
        )
        self.assertEqual(ev["independentSources"], 2)
        self.assertEqual(len(ev["evidenceGroups"]), 2)
        self.assertAlmostEqual(float(ev["evidenceScore"]), 1.0)

    def test_decorrelate_off_legacy_partial_accept(self) -> None:
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_DECORRELATE": "0"}):
            hit = fuse_ocr_votes(
                [("raw", "aaaa"), ("up2", "aaaa"), ("gray", "bbbb"), ("bin", "aaaa")],
                attempts=4,
                threshold=0.5,
            )
            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit["text"], "aaaa")
            self.assertAlmostEqual(float(hit["confidence"]), 0.75, places=4)

    def test_f2d_singleton_amid_disagreement(self) -> None:
        """votes=1 with other readings present → abstain when singleton gate on."""
        readings = [("raw", "aaaaaa"), ("up2", "bbbbbb")]
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_SINGLETON_GATE": "0", "HERMES_CAPTCHA_OCR_LEN": "6"}):
            base = fuse_ocr_votes(readings, attempts=2, threshold=0.5)
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_SINGLETON_GATE": "1", "HERMES_CAPTCHA_OCR_LEN": "6"}):
            gated = fuse_ocr_votes(readings, attempts=2, threshold=0.5)
        # Without gate, soft majority of one may still clear if share>=0.5.
        # With gate, lone supporter amid disagreement must abstain.
        self.assertIsNone(gated)
        # Baseline may accept or abstain depending on share; gate must not accept.
        if base is not None:
            self.assertEqual(base.get("decision"), "accept")

    def test_f2d_pure_singleton_needs_higher_evidence(self) -> None:
        with patch.dict(
            os.environ,
            {
                "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "1",
                "HERMES_CAPTCHA_OCR_SINGLETON_MIN_EVIDENCE": "0.65",
                "HERMES_CAPTCHA_OCR_LEN": "6",
            },
        ):
            # evidence = 1/6 ≈ 0.167 < 0.65
            weak = fuse_ocr_votes([("raw", "abc123")], attempts=6, threshold=0.1)
            self.assertIsNone(weak)
        with patch.dict(
            os.environ,
            {
                "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "1",
                "HERMES_CAPTCHA_OCR_SINGLETON_MIN_EVIDENCE": "0.10",
                "HERMES_CAPTCHA_OCR_LEN": "6",
            },
        ):
            ok = fuse_ocr_votes([("raw", "abc123")], attempts=6, threshold=0.1)
            self.assertIsNotNone(ok)



if __name__ == "__main__":
    unittest.main()
