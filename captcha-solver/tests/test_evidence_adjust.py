"""E1-D independentAgree soft bonus unit tests."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.decision import decide_ocr_candidate  # noqa: E402
from solvers.evidence_adjust import apply_independent_agree_bonus  # noqa: E402


class AgreeBonusTests(unittest.TestCase):
    def test_bonus_applied_when_agree_and_enabled(self) -> None:
        with patch.dict(
            "os.environ",
            {"HERMES_CAPTCHA_AGREE_BONUS": "1", "HERMES_CAPTCHA_AGREE_BONUS_VALUE": "0.1"},
        ):
            out = apply_independent_agree_bonus(
                {"evidenceScore": 0.7, "independentAgree": True, "text": "abcdef"}
            )
            self.assertAlmostEqual(float(out["evidenceScoreRaw"]), 0.7, places=4)
            self.assertAlmostEqual(float(out["evidenceScore"]), 0.8, places=4)
            self.assertTrue(out["evidenceAdjustment"]["applied"])
            self.assertFalse(out["evidenceAdjustment"]["conflictPenalty"])
            self.assertFalse(out["evidenceAdjustment"]["thresholdChanged"])

    def test_no_bonus_without_agree(self) -> None:
        with patch.dict("os.environ", {"HERMES_CAPTCHA_AGREE_BONUS": "1"}):
            out = apply_independent_agree_bonus(
                {"evidenceScore": 0.7, "independentAgree": False, "text": "abcdef"}
            )
            self.assertAlmostEqual(float(out["evidenceScore"]), 0.7, places=4)
            self.assertFalse(out["evidenceAdjustment"]["applied"])

    def test_disabled_records_raw_only(self) -> None:
        with patch.dict("os.environ", {"HERMES_CAPTCHA_AGREE_BONUS": "0"}):
            out = apply_independent_agree_bonus(
                {"evidenceScore": 0.7, "independentAgree": True, "text": "abcdef"}
            )
            self.assertAlmostEqual(float(out["evidenceScore"]), 0.7, places=4)
            self.assertFalse(out["evidenceAdjustment"]["independentAgreeBonus"])

    def test_decide_uses_adjusted_score_same_threshold(self) -> None:
        """Bonus can tip borderline accept; threshold itself unchanged (0.75)."""
        with patch.dict(
            "os.environ",
            {
                "HERMES_CAPTCHA_AGREE_BONUS": "1",
                "HERMES_CAPTCHA_AGREE_BONUS_VALUE": "0.1",
                "HERMES_CAPTCHA_OCR_DECORRELATE": "0",
                "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "0",
            },
        ):
            raw = {
                "text": "abcdef",
                "evidenceScore": 0.7,
                "agreementScore": 1.0,
                "independentSources": 1,
                "votes": 1,
                "independentAgree": True,
            }
            adjusted = apply_independent_agree_bonus(raw)
            out = decide_ocr_candidate(adjusted, threshold=0.75)
            self.assertEqual(out["decision"], "accept")
            self.assertAlmostEqual(float(out["decisionScore"]), 0.8, places=4)

            no_agree = apply_independent_agree_bonus(
                {**raw, "independentAgree": False, "evidenceScore": 0.7}
            )
            out2 = decide_ocr_candidate(no_agree, threshold=0.75)
            self.assertEqual(out2["decision"], "abstain")


if __name__ == "__main__":
    unittest.main()
