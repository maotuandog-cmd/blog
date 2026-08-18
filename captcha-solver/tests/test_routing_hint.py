"""E2-B1 routingHint unit tests (observation only)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.decision import decide_ocr_candidate  # noqa: E402
from solvers.routing_hint import (  # noqa: E402
    CANDIDATE_UNSTABLE,
    LOW_CHAR_CONFIDENCE,
    LOW_CHAR_MARGIN,
    MISSING_INDEPENDENT_EVIDENCE,
    build_routing_hint,
)


class RoutingHintTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old = {
            k: os.environ.pop(k, None)
            for k in (
                "HERMES_CAPTCHA_HINT_CHAR_MIN",
                "HERMES_CAPTCHA_HINT_CHAR_MARGIN",
                "HERMES_CAPTCHA_HINT_VOTE_MARGIN",
                "HERMES_CAPTCHA_ROUTING_HINT",
            )
        }
        os.environ["HERMES_CAPTCHA_HINT_CHAR_MIN"] = "0.45"
        os.environ["HERMES_CAPTCHA_HINT_CHAR_MARGIN"] = "0.12"
        os.environ["HERMES_CAPTCHA_HINT_VOTE_MARGIN"] = "0.15"

    def tearDown(self) -> None:
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_low_char_confidence(self) -> None:
        h = build_routing_hint({"charMinConfidence": 0.21, "text": "abcdef"})
        self.assertTrue(h["recommendSecondary"])
        self.assertFalse(h["applied"])
        self.assertEqual(h["priority"], "high")
        codes = [r["code"] for r in h["reasons"]]
        self.assertIn(LOW_CHAR_CONFIDENCE, codes)

    def test_low_char_margin(self) -> None:
        h = build_routing_hint(
            {"charMinConfidence": 0.9, "charMinMargin": 0.05, "text": "abcdef"}
        )
        codes = [r["code"] for r in h["reasons"]]
        self.assertIn(LOW_CHAR_MARGIN, codes)
        self.assertEqual(h["priority"], "high")

    def test_candidate_unstable_tight(self) -> None:
        h = build_routing_hint(
            {
                "charMinConfidence": 0.9,
                "charMinMargin": 0.5,
                "tightCandidateMargin": True,
                "candidateMargin": 0.08,
                "runnerUpText": "abcdez",
                "text": "abcdef",
            }
        )
        codes = [r["code"] for r in h["reasons"]]
        self.assertIn(CANDIDATE_UNSTABLE, codes)
        self.assertEqual(h["priority"], "medium")

    def test_missing_independent_evidence(self) -> None:
        h = build_routing_hint(
            {
                "charMinConfidence": 0.9,
                "charMinMargin": 0.5,
                "independentAgree": False,
                "text": "abcdef",
            }
        )
        codes = [r["code"] for r in h["reasons"]]
        self.assertEqual(codes, [MISSING_INDEPENDENT_EVIDENCE])
        self.assertEqual(h["priority"], "low")
        self.assertTrue(h["recommendSecondary"])

    def test_agree_no_missing_flag(self) -> None:
        h = build_routing_hint(
            {
                "charMinConfidence": 0.9,
                "charMinMargin": 0.5,
                "independentAgree": True,
                "text": "abcdef",
            }
        )
        self.assertFalse(h["recommendSecondary"])
        self.assertEqual(h["reasons"], [])

    def test_ignores_decision_score_and_type(self) -> None:
        h = build_routing_hint(
            {
                "decisionScore": 0.1,
                "captchaType": {"type": "text_distorted"},
                "charMinConfidence": 0.9,
                "charMinMargin": 0.5,
                "text": "abcdef",
            }
        )
        self.assertFalse(h["recommendSecondary"])
        self.assertEqual(h["reasons"], [])

    def test_decision_ignores_routing_hint(self) -> None:
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
                    "routingHint": {
                        "recommendSecondary": True,
                        "applied": False,
                        "reasons": [{"code": LOW_CHAR_CONFIDENCE, "value": 0.1}],
                    },
                },
                threshold=0.5,
            )
            self.assertEqual(out["decision"], "accept")


if __name__ == "__main__":
    unittest.main()
