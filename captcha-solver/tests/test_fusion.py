"""P2.1 Fusion + P2.2 shadow mode unit tests."""
from __future__ import annotations

import os
import unittest

from solvers.fusion import apply_fusion, fuse_candidates, shadow_delta


class FusionLogicTests(unittest.TestCase):
    def test_exact_agree_pass(self) -> None:
        result = {
            "visualCandidates": [
                {"source": "raw_ocr", "text": "8B3K7", "confidence": 0.8},
                {"source": "yolo_ocr", "text": "8B3K7", "confidence": 0.9},
                {"source": "vlm", "text": "8B3K?", "confidence": 0.5},
            ]
        }
        f = fuse_candidates(result)
        self.assertEqual(f["action"], "pass")
        self.assertEqual(f["text"].upper(), "8B3K7")
        self.assertGreaterEqual(f["agreement"], 0.5)

    def test_position_conflict_retry(self) -> None:
        result = {
            "visualCandidates": [
                {"source": "raw_ocr", "text": "8B3K7", "confidence": 0.8},
                {"source": "yolo_ocr", "text": "8B3X7", "confidence": 0.8},
                {"source": "vlm", "text": "8B3K1", "confidence": 0.8},
            ]
        }
        f = fuse_candidates(result)
        self.assertEqual(f["action"], "retry")
        self.assertEqual(f["reason"], "position_conflict")
        self.assertEqual(f["text"], "")

    def test_length_invalid_retry(self) -> None:
        result = {
            "visualCandidates": [
                {"source": "raw_ocr", "text": "AB", "confidence": 0.9},
                {"source": "yolo_ocr", "text": "ABC", "confidence": 0.9},
            ]
        }
        f = fuse_candidates(result, allowed=[4, 5, 6])
        self.assertEqual(f["action"], "retry")
        self.assertEqual(f["reason"], "length_invalid")

    def test_shadow_does_not_rewrite_solved(self) -> None:
        os.environ["HERMES_CAPTCHA_FUSION"] = "shadow"
        result = {
            "solved": True,
            "text": "8B3K7",
            "decision": "accept",
            "visualCandidates": [
                {"source": "raw_ocr", "text": "8B3K7", "confidence": 0.9},
                {"source": "yolo_ocr", "text": "8B3X7", "confidence": 0.9},
                {"source": "vlm", "text": "8B3K1", "confidence": 0.9},
            ],
        }
        apply_fusion(result, mode="shadow")
        self.assertTrue(result["solved"])
        self.assertEqual(result["text"], "8B3K7")
        self.assertEqual(result["shadowDecision"]["action"], "retry")
        self.assertEqual(result["shadowDelta"], "shadow_stricter")

    def test_on_applies_abstain(self) -> None:
        result = {
            "solved": True,
            "text": "8B3K7",
            "decision": "accept",
            "visualCandidates": [
                {"source": "raw_ocr", "text": "8B3K7", "confidence": 0.9},
                {"source": "yolo_ocr", "text": "8B3X7", "confidence": 0.9},
                {"source": "vlm", "text": "8B3K1", "confidence": 0.9},
            ],
        }
        apply_fusion(result, mode="on")
        self.assertFalse(result["solved"])
        self.assertEqual(result["text"], "")
        self.assertIn(result["decision"], ("retry", "abstain"))

    def test_shadow_delta_agree(self) -> None:
        self.assertEqual(shadow_delta("accept", "pass", "AB12", "AB12"), "agree")
        self.assertEqual(shadow_delta("accept", "retry", "AB12", ""), "shadow_stricter")
        self.assertEqual(shadow_delta("abstain", "pass", "", "AB12"), "shadow_looser")


if __name__ == "__main__":
    unittest.main()
