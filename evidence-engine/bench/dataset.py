"""EE-5 Evidence Regression dataset model."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class EvidenceExpectation:
    required: list[str] = field(default_factory=lambda: ["candidate", "evidence"])
    forbidden: list[str] = field(default_factory=list)
    min_explanation: int = 0
    baseline_quality: str | None = None
    baseline_primary_gap: str | None = None
    baseline_explanation_types: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "required": list(self.required),
            "forbidden": list(self.forbidden),
            "minExplanation": self.min_explanation,
        }
        if self.baseline_quality is not None:
            out["baselineQuality"] = self.baseline_quality
        if self.baseline_primary_gap is not None:
            out["baselinePrimaryGap"] = self.baseline_primary_gap
        if self.baseline_explanation_types:
            out["baselineExplanationTypes"] = list(self.baseline_explanation_types)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> EvidenceExpectation:
        d = data or {}
        return cls(
            required=[str(x) for x in (d.get("required") or ["candidate", "evidence"])],
            forbidden=[str(x) for x in (d.get("forbidden") or [])],
            min_explanation=int(d.get("minExplanation") or d.get("min_explanation") or 0),
            baseline_quality=(
                str(d["baselineQuality"])
                if d.get("baselineQuality") is not None
                else (str(d["baseline_quality"]) if d.get("baseline_quality") is not None else None)
            ),
            baseline_primary_gap=(
                str(d["baselinePrimaryGap"])
                if d.get("baselinePrimaryGap") is not None
                else (
                    str(d["baseline_primary_gap"]) if d.get("baseline_primary_gap") is not None else None
                )
            ),
            baseline_explanation_types=[
                str(x)
                for x in (
                    d.get("baselineExplanationTypes")
                    or d.get("baseline_explanation_types")
                    or []
                )
            ],
        )


@dataclass
class BenchCase:
    case_id: str
    input: dict[str, Any]
    expected: dict[str, Any] = field(default_factory=dict)
    evidence_expectation: EvidenceExpectation = field(default_factory=EvidenceExpectation)
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "caseId": self.case_id,
            "input": dict(self.input),
            "expected": dict(self.expected),
            "evidenceExpectation": self.evidence_expectation.to_dict(),
            "tags": list(self.tags),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> BenchCase:
        d = data or {}
        return cls(
            case_id=str(d.get("caseId") or d.get("case_id") or ""),
            input=dict(d.get("input") or {}),
            expected=dict(d.get("expected") or {}),
            evidence_expectation=EvidenceExpectation.from_dict(d.get("evidenceExpectation") or d.get("evidence_expectation")),
            tags=[str(x) for x in (d.get("tags") or [])],
        )


def load_cases_jsonl(path: Path | str) -> list[BenchCase]:
    p = Path(path)
    cases: list[BenchCase] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        cases.append(BenchCase.from_dict(json.loads(line)))
    return cases


def load_dataset(dataset_dir: Path | str) -> tuple[dict[str, Any], list[BenchCase]]:
    """Load manifest.json + cases.jsonl from a dataset directory."""
    root = Path(dataset_dir)
    manifest_path = root / "manifest.json"
    cases_path = root / "cases.jsonl"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    cases = load_cases_jsonl(cases_path) if cases_path.exists() else []
    return manifest, cases
