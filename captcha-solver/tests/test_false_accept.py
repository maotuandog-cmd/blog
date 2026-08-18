"""F1 False-ACCEPT attribution unit tests."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.false_accept import (  # noqa: E402
    CORRELATED_VOTES,
    MODEL_CONFLICT,
    SINGLETON_ACCEPT,
    WEAK_EVIDENCE,
    attribute_accept,
    summarize_attributions,
)


class FalseAcceptAttributionTests(unittest.TestCase):
    def test_skip_abstain(self) -> None:
        out = attribute_accept(
            {"decision": "abstain", "solved": False},
            feedback={"status": "not_executed"},
        )
        self.assertFalse(out["attributed"])
        self.assertEqual(out["class"], "NOT_ACCEPT")

    def test_skip_not_executed_accept_path(self) -> None:
        # Edge: marked accept but feedback not_executed → not false-accept
        out = attribute_accept(
            {"decision": "accept", "solved": True, "text": "ABCD"},
            feedback={"status": "not_executed"},
        )
        self.assertFalse(out["attributed"])
        self.assertEqual(out["class"], "NOT_FALSE_ACCEPT")

    def test_singleton_false_accept(self) -> None:
        out = attribute_accept(
            {
                "decision": "accept",
                "solved": True,
                "text": "ABCD",
                "votes": 1,
                "singleton": True,
                "nValid": 1,
                "decisionScore": 0.9,
                "evidenceScore": 0.9,
                "engine": "ddddocr",
                "sessionId": "s1",
                "attemptId": "a1",
            },
            feedback={"status": "failed", "reason": "mismatch"},
        )
        self.assertTrue(out["attributed"])
        self.assertTrue(out["isFalseAccept"])
        self.assertEqual(out["class"], SINGLETON_ACCEPT)
        self.assertEqual(out["sessionId"], "s1")
        self.assertEqual(out["attemptId"], "a1")

    def test_correlated_votes(self) -> None:
        out = attribute_accept(
            {
                "decision": "accept",
                "solved": True,
                "text": "xyz",
                "votes": 5,
                "weightShare": 0.9,
                "decisionScore": 1.0,
                "evidenceScore": 1.0,
                "engine": "ddddocr",
            },
            feedback={"status": "failed"},
        )
        self.assertTrue(out["isFalseAccept"])
        self.assertEqual(out["class"], CORRELATED_VOTES)

    def test_weak_evidence(self) -> None:
        out = attribute_accept(
            {
                "decision": "accept",
                "solved": True,
                "text": "ab",
                "votes": 0,
                "weightShare": 0.4,
                "decisionScore": 0.55,
                "evidenceScore": 0.55,
                "engine": "custom",
            },
            feedback={"status": "failed"},
            min_conf=0.5,
        )
        self.assertEqual(out["class"], WEAK_EVIDENCE)

    def test_model_conflict_priority(self) -> None:
        out = attribute_accept(
            {
                "decision": "accept",
                "solved": True,
                "text": "ab",
                "votes": 1,
                "singleton": True,
                "ddddText": "AAAA",
                "vlmText": "BBBB",
                "vlmConflict": True,
                "decisionScore": 0.8,
                "engine": "ddddocr+vlm7b",
            },
            feedback={"status": "failed"},
        )
        self.assertEqual(out["class"], MODEL_CONFLICT)
        self.assertIn(SINGLETON_ACCEPT, out["secondary"])

    def test_true_accept_still_attributed(self) -> None:
        out = attribute_accept(
            {
                "decision": "accept",
                "solved": True,
                "text": "ok",
                "votes": 4,
                "weightShare": 0.8,
                "decisionScore": 0.9,
                "evidenceScore": 0.9,
                "engine": "ddddocr",
            },
            feedback={"status": "success"},
        )
        self.assertTrue(out["attributed"])
        self.assertFalse(out["isFalseAccept"])
        self.assertEqual(out["class"], CORRELATED_VOTES)

    def test_summarize(self) -> None:
        rows = [
            {
                "falseAccept": attribute_accept(
                    {"decision": "accept", "solved": True, "text": "a", "votes": 1, "singleton": True, "engine": "ddddocr"},
                    feedback={"status": "failed"},
                )
            },
            {
                "falseAccept": attribute_accept(
                    {"decision": "accept", "solved": True, "text": "b", "votes": 4, "weightShare": 0.9, "engine": "ddddocr"},
                    feedback={"status": "failed"},
                )
            },
            {
                "falseAccept": attribute_accept(
                    {"decision": "accept", "solved": True, "text": "c", "votes": 4, "weightShare": 0.9, "engine": "ddddocr"},
                    feedback={"status": "success"},
                )
            },
        ]
        s = summarize_attributions(rows)
        self.assertEqual(s["totalAttributedAccepts"], 3)
        self.assertEqual(s["totalFalseAccepts"], 2)
        self.assertIn(s["topClass"], {SINGLETON_ACCEPT, CORRELATED_VOTES})
        classes = {x["class"]: x for x in s["byClass"]}
        self.assertEqual(classes[CORRELATED_VOTES]["acceptCount"], 2)
        self.assertEqual(classes[CORRELATED_VOTES]["acceptFailed"], 1)


if __name__ == "__main__":
    unittest.main()
