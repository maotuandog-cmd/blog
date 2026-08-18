"""E1-C / C2-B independent source unit tests (observation only)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.decision import decide_ocr_candidate  # noqa: E402
from solvers.independent_source import (  # noqa: E402
    conflict_attribution,
    independent_agree_pattern,
    source_agreement,
)


class IndependentSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_len = os.environ.pop("HERMES_CAPTCHA_OCR_LEN", None)
        self._old_cs = os.environ.pop("HERMES_CAPTCHA_OCR_CHARSET", None)

    def tearDown(self) -> None:
        if self._old_len is not None:
            os.environ["HERMES_CAPTCHA_OCR_LEN"] = self._old_len
        else:
            os.environ.pop("HERMES_CAPTCHA_OCR_LEN", None)
        if self._old_cs is not None:
            os.environ["HERMES_CAPTCHA_OCR_CHARSET"] = self._old_cs
        else:
            os.environ.pop("HERMES_CAPTCHA_OCR_CHARSET", None)

    def test_agreement_exact(self) -> None:
        a = source_agreement("abcdef", "ABCDEF")
        self.assertTrue(a["agree"])
        self.assertEqual(a["charDiff"], 0)

    def test_agreement_single_char_conflict(self) -> None:
        a = source_agreement("t2fmbz", "r2fmbz")
        self.assertFalse(a["agree"])
        self.assertEqual(a["charDiff"], 1)
        self.assertEqual(a["positions"], [0])
        pat = independent_agree_pattern(a)
        self.assertTrue(pat["independentConflict"])
        self.assertIn("single_char_conflict", pat["flags"])

    def test_agreement_missing_secondary(self) -> None:
        a = source_agreement("abcdef", "")
        self.assertFalse(a["comparable"])
        self.assertFalse(a["agree"])

    def test_unavailable_is_not_conflict(self) -> None:
        a = source_agreement(
            "abcdef",
            "",
            secondary_available=False,
            secondary_reason="no_character_candidate",
        )
        self.assertFalse(a["comparable"])
        self.assertIn(a["reason"], ("no_candidate", "source_unavailable"))
        pat = independent_agree_pattern(a, secondary_available=False)
        self.assertFalse(pat["independentConflict"])
        self.assertTrue(pat.get("incomparable") or pat.get("sourceUnavailable"))

    def test_conflict_attribution_secondary_wrong_on_true_accept(self) -> None:
        agr = source_agreement("abcdef", "abcdez")
        attr = conflict_attribution(primary_correct=True, agreement=agr, secondary_available=True)
        self.assertEqual(attr["label"], "secondary_wrong")

    def test_conflict_attribution_unavailable(self) -> None:
        agr = source_agreement("abcdef", "", secondary_available=False)
        attr = conflict_attribution(primary_correct=True, agreement=agr, secondary_available=False)
        self.assertEqual(attr["label"], "source_unavailable_or_incomparable")

    def test_decision_ignores_independent_fields(self) -> None:
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
                    "votes": 3,
                    "weightShare": 1.0,
                    "independentAgree": False,
                    "independentCharDiff": 3,
                    "secondaryText": "zzzzzz",
                    "secondaryAvailable": True,
                },
                threshold=0.5,
            )
            self.assertEqual(out["decision"], "accept")
            self.assertAlmostEqual(float(out["decisionScore"]), 0.9, places=4)


if __name__ == "__main__":
    unittest.main()
