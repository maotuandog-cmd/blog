"""EE-5 Evidence Regression Bench unit tests."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bench.dataset import load_dataset  # noqa: E402
from bench.runner import run_case, run_dataset  # noqa: E402
from bench.report import build_report  # noqa: E402
from bench.dataset import BenchCase, EvidenceExpectation  # noqa: E402


class Ee5BenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ds = ROOT / "datasets" / "captcha-demo-v1"

    def test_load_dataset(self) -> None:
        manifest, cases = load_dataset(self.ds)
        self.assertEqual(manifest.get("id"), "captcha-demo-v1")
        self.assertGreaterEqual(len(cases), 4)

    def test_run_strong_accept(self) -> None:
        cases = load_dataset(self.ds)[1]
        case = next(c for c in cases if c.case_id == "captcha-001")
        ev = run_case(case)
        self.assertTrue(ev.dimensions["contract"].passed)
        self.assertTrue(ev.dimensions["completeness"].passed)
        self.assertTrue(ev.dimensions["decision_isolation"].passed)
        self.assertTrue(ev.dimensions["explanation"].passed)

    def test_abstain_has_evidence(self) -> None:
        cases = load_dataset(self.ds)[1]
        case = next(c for c in cases if c.case_id == "captcha-003")
        ev = run_case(case)
        self.assertTrue(ev.dimensions["completeness"].passed)
        self.assertTrue(ev.observation.get("evidenceBundle", {}).get("gaps"))

    def test_empty_evidence_fails_completeness(self) -> None:
        cases = load_dataset(self.ds)[1]
        case = next(c for c in cases if c.case_id == "captcha-005")
        ev = run_case(case)
        # Has candidate from text, but no char evidence / comparison / gaps → completeness fail
        self.assertFalse(ev.dimensions["completeness"].passed)

    def test_full_dataset_report_only(self) -> None:
        run = run_dataset(self.ds)
        report = build_report(run)
        self.assertEqual(report["summary"]["blockDeploy"], False)
        self.assertEqual(report["summary"]["decisionIsolation"], "PASS")
        self.assertGreaterEqual(report["summary"]["cases"], 4)


if __name__ == "__main__":
    unittest.main()
