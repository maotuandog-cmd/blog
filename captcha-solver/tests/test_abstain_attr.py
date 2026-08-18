"""A0 abstain attribution unit tests (observation only)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.abstain_attr import (  # noqa: E402
    BUCKET_CORRELATED_GATE,
    BUCKET_LOW_CONFIDENCE,
    BUCKET_NO_READING,
    BUCKET_SECONDARY_MISSING,
    BUCKET_SINGLE_SOURCE,
    build_abstain_reason_detail,
    bucket_for,
    clear_abstain_probe,
    get_abstain_probe,
    merge_probe_into_result,
    store_abstain_probe,
)


class AbstainAttrTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_abstain_probe()

    def test_no_reading_bucket(self) -> None:
        d = build_abstain_reason_detail({}, {"reason": "ocr low confidence"}, threshold=0.5, raw_readings=0)
        self.assertEqual(d["bucket"], BUCKET_NO_READING)
        self.assertEqual(d["primary"], "NO_READING")

    def test_correlated_gate(self) -> None:
        d = build_abstain_reason_detail(
            {
                "text": "abcdef",
                "evidenceScore": 0.6,
                "agreementScore": 0.6,
                "votes": 3,
                "nValid": 5,
                "independentSources": 1,
            },
            {"decisionReason": "correlated_partial_agreement", "reason": "correlated_partial_agreement"},
            threshold=0.5,
        )
        self.assertEqual(d["gate"], "CORRELATED_EVIDENCE_BLOCK")
        self.assertEqual(d["bucket"], BUCKET_CORRELATED_GATE)

    def test_single_source(self) -> None:
        d = build_abstain_reason_detail(
            {
                "text": "abcdef",
                "evidenceScore": 0.4,
                "votes": 1,
                "nValid": 1,
                "independentSources": 1,
                "charMinConfidence": 0.7,
                "secondaryAvailable": True,
                "comparisonStatus": "agree",
                "independentAgree": True,
            },
            {"reason": "ocr low evidence"},
            threshold=0.5,
        )
        self.assertEqual(d["vote"], "SINGLE_SOURCE")
        self.assertEqual(d["bucket"], BUCKET_SINGLE_SOURCE)

    def test_low_char_confidence(self) -> None:
        d = build_abstain_reason_detail(
            {
                "text": "abcdef",
                "evidenceScore": 0.55,
                "votes": 2,
                "nValid": 3,
                "charMinConfidence": 0.2,
                "independentSources": 1,
            },
            {"reason": "ocr low evidence"},
            threshold=0.5,
        )
        self.assertEqual(d["primary"], "LOW_CONFIDENCE")
        self.assertEqual(d["bucket"], BUCKET_LOW_CONFIDENCE)

    def test_secondary_missing(self) -> None:
        d = build_abstain_reason_detail(
            {
                "text": "abcdef",
                "evidenceScore": 0.55,
                "agreementScore": 1.0,
                "votes": 3,
                "nValid": 3,
                "independentSources": 1,
                "charMinConfidence": 0.8,
                "secondaryAvailable": False,
                "comparisonStatus": "incomparable",
            },
            {"reason": "ocr low evidence"},
            threshold=0.5,
        )
        self.assertEqual(d["bucket"], BUCKET_SECONDARY_MISSING)

    def test_merge_probe_does_not_revive_accept(self) -> None:
        store_abstain_probe(
            {
                "abstainReasonDetail": {"bucket": BUCKET_SINGLE_SOURCE, "primary": "HAS_CANDIDATE"},
                "abstainCandidateText": "abcdef",
                "votes": 1,
            }
        )
        out = merge_probe_into_result({"solved": True, "decision": "accept", "text": "abcdef"})
        self.assertNotIn("abstainReasonDetail", out)

    def test_merge_probe_on_abstain(self) -> None:
        store_abstain_probe(
            {
                "abstainReasonDetail": {"bucket": BUCKET_SINGLE_SOURCE, "primary": "HAS_CANDIDATE"},
                "abstainCandidateText": "abcdef",
                "votes": 1,
                "evidenceScore": 0.4,
            }
        )
        out = merge_probe_into_result(
            {"solved": False, "decision": "abstain", "text": "", "reason": "ocr low confidence"}
        )
        self.assertEqual(out["abstainBucket"], BUCKET_SINGLE_SOURCE)
        self.assertEqual(out["abstainCandidateText"], "abcdef")
        self.assertEqual(out["votes"], 1)


if __name__ == "__main__":
    unittest.main()
