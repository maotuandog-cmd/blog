"""E2-B2 secondaryComparison unit tests."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.independent_source import (  # noqa: E402
    build_secondary_comparison,
    independent_agree_pattern,
    source_agreement,
)


class SecondaryComparisonTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_len = os.environ.get("HERMES_CAPTCHA_OCR_LEN")
        self._old_cs = os.environ.get("HERMES_CAPTCHA_OCR_CHARSET")
        os.environ["HERMES_CAPTCHA_OCR_LEN"] = "6"
        os.environ["HERMES_CAPTCHA_OCR_CHARSET"] = (
            "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
        )

    def tearDown(self) -> None:
        if self._old_len is None:
            os.environ.pop("HERMES_CAPTCHA_OCR_LEN", None)
        else:
            os.environ["HERMES_CAPTCHA_OCR_LEN"] = self._old_len
        if self._old_cs is None:
            os.environ.pop("HERMES_CAPTCHA_OCR_CHARSET", None)
        else:
            os.environ["HERMES_CAPTCHA_OCR_CHARSET"] = self._old_cs

    def test_agree(self) -> None:
        agr = source_agreement("7qprzf", "7QPRZF", secondary_available=True)
        cmp_ = build_secondary_comparison(
            primary_text="7qprzf", secondary_text="7QPRZF", agreement=agr
        )
        self.assertEqual(cmp_["status"], "agree")
        self.assertTrue(cmp_["comparable"])

    def test_true_conflict_same_length(self) -> None:
        agr = source_agreement("7qprzf", "7qpryf", secondary_available=True)
        cmp_ = build_secondary_comparison(
            primary_text="7qprzf", secondary_text="7qpryf", agreement=agr
        )
        self.assertEqual(cmp_["status"], "conflict")
        self.assertEqual(cmp_["reason"], "char_mismatch")
        pat = independent_agree_pattern(agr)
        self.assertTrue(pat["independentConflict"])

    def test_length_mismatch_is_incomparable_not_conflict(self) -> None:
        agr = source_agreement("7qprzf", "7qprz", secondary_available=True)
        self.assertFalse(agr["comparable"])
        self.assertEqual(agr["reason"], "length_mismatch")
        cmp_ = build_secondary_comparison(
            primary_text="7qprzf", secondary_text="7qprz", agreement=agr
        )
        self.assertEqual(cmp_["status"], "incomparable")
        self.assertEqual(cmp_["reason"], "length_mismatch")
        pat = independent_agree_pattern(agr)
        self.assertFalse(pat["independentConflict"])
        self.assertTrue(pat["incomparable"])

    def test_empty_secondary_incomparable(self) -> None:
        agr = source_agreement("abcdef", "", secondary_available=True)
        cmp_ = build_secondary_comparison(primary_text="abcdef", secondary_text="", agreement=agr)
        self.assertEqual(cmp_["status"], "incomparable")
        self.assertEqual(cmp_["reason"], "empty")

    def test_unavailable_incomparable(self) -> None:
        agr = source_agreement(
            "abcdef", "", secondary_available=False, secondary_reason="no_character_candidate"
        )
        cmp_ = build_secondary_comparison(primary_text="abcdef", secondary_text="", agreement=agr)
        self.assertEqual(cmp_["status"], "incomparable")
        pat = independent_agree_pattern(agr, secondary_available=False)
        self.assertFalse(pat["independentConflict"])


if __name__ == "__main__":
    unittest.main()
