"""EE-5 Evidence Regression Bench."""
from __future__ import annotations

from .dataset import BenchCase, EvidenceExpectation, load_dataset
from .diff import CaseDiff, diff_evidence
from .evaluator import evaluate_case
from .report import build_report, write_report
from .runner import RunResult, main, run_case, run_dataset

__all__ = [
    "BenchCase",
    "EvidenceExpectation",
    "load_dataset",
    "CaseDiff",
    "diff_evidence",
    "evaluate_case",
    "build_report",
    "write_report",
    "RunResult",
    "run_case",
    "run_dataset",
    "main",
]
