"""E1-A character evidence unit tests (observation only)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.char_evidence import parse_dddd_probability, weak_char_pattern  # noqa: E402
from solvers.decision import decide_ocr_candidate  # noqa: E402


class CharEvidenceTests(unittest.TestCase):
    def _payload(self, chars: list[tuple[str, float, list[tuple[str, float]]]]) -> dict:
        """Build a minimal dddd-like probability payload.

        chars: [(top_char, top_p, [(alt, p), ...]), ...]
        """
        # Tiny charset for the test.
        alphabet = [""] + list("ABCDEFGH12345678")
        probs = []
        text = ""
        for top_c, top_p, alts in chars:
            text += top_c
            dist = [0.0] * len(alphabet)
            dist[alphabet.index(top_c)] = top_p
            rem = max(0.0, 1.0 - top_p)
            for alt_c, alt_p in alts:
                dist[alphabet.index(alt_c)] = alt_p
                rem -= alt_p
            if rem > 0:
                dist[0] += rem  # dump into blank
            probs.append([dist])
        # Pad unused slots as blank-dominant
        for _ in range(3):
            dist = [0.0] * len(alphabet)
            dist[0] = 1.0
            probs.append([dist])
        return {
            "text": text,
            "probabilities": probs,
            "charset": alphabet,
            "confidence": 0.8,
        }

    def test_parse_skips_blank_slots_and_marks_ambiguous(self) -> None:
        payload = self._payload(
            [
                ("A", 0.91, [("8", 0.05)]),
                ("B", 0.43, [("8", 0.39)]),
                ("1", 0.88, [("7", 0.05)]),
            ]
        )
        out = parse_dddd_probability(payload, text_hint="AB1", top_k=2, ambiguous_gap=0.15)
        ev = out["characterEvidence"]
        self.assertEqual(len(ev), 3)
        self.assertEqual(ev[0]["char"], "A")
        self.assertFalse(ev[0]["ambiguous"])
        self.assertEqual(ev[1]["char"], "B")
        self.assertTrue(ev[1]["ambiguous"])
        self.assertEqual(ev[1]["alternatives"][0]["char"], "8")
        self.assertAlmostEqual(out["charSummary"]["charMinConfidence"], 0.43, places=4)
        self.assertEqual(out["charSummary"]["ambiguousCount"], 1)
        self.assertEqual(out["charSummary"]["lowConfidencePositions"], [1])

    def test_weak_pattern_flags(self) -> None:
        payload = self._payload([("A", 0.9, []), ("B", 0.4, [("8", 0.35)])])
        parsed = parse_dddd_probability(payload, text_hint="AB")
        weak = weak_char_pattern(parsed["charSummary"], parsed["characterEvidence"])
        self.assertTrue(weak["weakCharEvidence"])
        self.assertIn("low_char_min", weak["flags"])

    def test_attach_does_not_change_decision(self) -> None:
        """Char evidence helpers must not be consulted by decide_ocr_candidate."""
        hit = {
            "text": "abcdef",
            "evidenceScore": 0.9,
            "agreementScore": 1.0,
            "independentSources": 1,
            "votes": 3,
            "weightShare": 1.0,
            "characterEvidence": [{"char": "a", "position": 0, "confidence": 0.1}],
            "charMinConfidence": 0.1,
        }
        out = decide_ocr_candidate(hit, threshold=0.5)
        self.assertEqual(out["decision"], "accept")
        self.assertTrue(out["solved"])
        self.assertAlmostEqual(float(out["decisionScore"]), 0.9, places=4)
        self.assertAlmostEqual(float(out["confidence"]), 0.9, places=4)


if __name__ == "__main__":
    unittest.main()
