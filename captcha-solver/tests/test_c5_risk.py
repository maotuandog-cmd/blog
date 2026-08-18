"""C5-R risk gate unit tests."""
from __future__ import annotations

import unittest

from solvers.c5_risk import (
    apply_c5_risk_gate,
    classify_position_risk,
    in_charset,
    known_confusion_lookup,
)


class C5RiskTests(unittest.TestCase):
    def test_charset_blocks_cjk(self) -> None:
        self.assertTrue(in_charset("B"))
        self.assertTrue(in_charset("8"))
        self.assertFalse(in_charset("至"))
        self.assertFalse(in_charset("1"))  # not in demo CHARSET

    def test_known_confusion_b_h(self) -> None:
        hit = known_confusion_lookup("B")
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertIn("H", hit.get("confuseWith") or [])

    def test_illegal_char_retry(self) -> None:
        risk = classify_position_risk(
            position=1,
            c4_decision={
                "decision": "PASS",
                "selected": "至",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [{"char": "至", "score": 1.0}],
            },
        )
        self.assertEqual(risk["riskType"], "ILLEGAL_CHAR")
        self.assertEqual(risk["final"], "RETRY")

    def test_known_confusion_retry(self) -> None:
        # Top-2 = [B, H] → trigger (directional H→B)
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [
                    {"char": "B", "score": 0.7},
                    {"char": "H", "score": 0.3},
                ],
            },
        )
        self.assertEqual(risk["riskType"], "KNOWN_CONFUSION")
        self.assertEqual(risk["final"], "RETRY")
        self.assertEqual(risk["provider"], "none")

    def test_known_confusion_requires_top2_pair(self) -> None:
        # Top-2 = [B, K] — B is OCR confuser but K ∉ confuseWith(H) → no trigger
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [
                    {"char": "B", "score": 0.7},
                    {"char": "K", "score": 0.3},
                ],
            },
        )
        self.assertEqual(risk["riskType"], "NONE")
        self.assertEqual(risk["final"], "PASS")

    def test_known_confusion_unanimous_no_top2(self) -> None:
        # Only Top-1 present (unanimous views) → no Top-2 → no KNOWN_CONFUSION (C5-R′)
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [{"char": "B", "score": 1.0}],
            },
        )
        self.assertEqual(risk["riskType"], "NONE")
        self.assertEqual(risk["final"], "PASS")

    def test_l1_observe_single_confusion(self) -> None:
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_CONF",
                "margin": 0.92,
                "view_agreement": 1.0,
                "candidates": [{"char": "B", "score": 1.0}],
            },
            l1_observe=True,
        )
        self.assertEqual(risk["riskLevel"], "L1")
        self.assertEqual(risk["riskType"], "HIGH_CONF_SINGLE_CONFUSION")
        self.assertEqual(risk["action"], "OBSERVE")
        self.assertEqual(risk["final"], "PASS")
        self.assertEqual(risk["pair"], "H->B")
        self.assertEqual(risk["ocrChar"], "B")

    def test_l1_not_blacklist_without_observe(self) -> None:
        # C5-R′: single B candidate stays PASS (not RETRY)
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [{"char": "B", "score": 1.0}],
            },
            l1_observe=False,
        )
        self.assertEqual(risk["riskType"], "NONE")
        self.assertEqual(risk["final"], "PASS")

    def test_l1_requires_high_conf(self) -> None:
        risk = classify_position_risk(
            position=2,
            c4_decision={
                "decision": "PASS",
                "selected": "B",
                "reason": "HIGH_MARGIN",
                "margin": 0.5,
                "view_agreement": 0.75,
                "candidates": [
                    {"char": "B", "score": 0.7},
                    {"char": "K", "score": 0.2},
                ],
            },
            l1_observe=True,
        )
        self.assertNotEqual(risk["riskType"], "HIGH_CONF_SINGLE_CONFUSION")

    def test_gate_l1_observe_does_not_block(self) -> None:
        positions = [
            {
                "position": 0,
                "candidates": [{"char": "B", "score": 1.0}],
                "c4": {
                    "decision": "PASS",
                    "selected": "B",
                    "reason": "HIGH_CONF",
                    "margin": 1.0,
                    "view_agreement": 1.0,
                    "candidates": [{"char": "B", "score": 1.0}],
                },
            },
        ]
        gate = apply_c5_risk_gate(positions, c4_ok=True, c4_text="B", l1_observe=True)
        self.assertTrue(gate["ok"])
        self.assertEqual(gate["action"], "pass")
        self.assertEqual(gate["l1ObserveCount"], 1)
        self.assertEqual(len(gate["triggers"]), 0)
        self.assertEqual(gate["l1Observations"][0]["action"], "OBSERVE")

    def test_ordinary_high_conf_pass(self) -> None:
        risk = classify_position_risk(
            position=0,
            c4_decision={
                "decision": "PASS",
                "selected": "Q",
                "reason": "HIGH_CONF",
                "margin": 1.0,
                "view_agreement": 1.0,
                "candidates": [{"char": "Q", "score": 1.0}],
            },
        )
        self.assertEqual(risk["riskType"], "NONE")
        self.assertEqual(risk["final"], "PASS")

    def test_gate_blocks_string(self) -> None:
        positions = [
            {
                "position": 0,
                "candidates": [{"char": "A", "score": 1.0}],
                "c4": {
                    "decision": "PASS",
                    "selected": "A",
                    "reason": "HIGH_CONF",
                    "margin": 1.0,
                    "view_agreement": 1.0,
                    "candidates": [{"char": "A", "score": 1.0}],
                },
            },
            {
                "position": 1,
                "candidates": [{"char": "B", "score": 0.6}, {"char": "H", "score": 0.4}],
                "c4": {
                    "decision": "PASS",
                    "selected": "B",
                    "reason": "HIGH_MARGIN",
                    "margin": 0.2,
                    "view_agreement": 0.75,
                    "candidates": [
                        {"char": "B", "score": 0.6},
                        {"char": "H", "score": 0.4},
                    ],
                },
            },
        ]
        gate = apply_c5_risk_gate(positions, c4_ok=True, c4_text="AB")
        self.assertFalse(gate["ok"])
        self.assertEqual(gate["action"], "retry")
        self.assertTrue(gate["triggers"])
        self.assertEqual(gate["triggers"][0]["riskType"], "KNOWN_CONFUSION")


if __name__ == "__main__":
    unittest.main()
