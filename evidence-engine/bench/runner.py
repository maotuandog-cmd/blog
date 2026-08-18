"""EE-5 Evidence Regression Bench runner (report-only; never blocks deploy)."""
from __future__ import annotations

import copy
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_EE_ROOT = Path(__file__).resolve().parents[1]
if str(_EE_ROOT) not in sys.path:
    sys.path.insert(0, str(_EE_ROOT))

from compat.legacy import assert_contract_unchanged, build_compatible_observation_fields  # noqa: E402

from .dataset import BenchCase, load_dataset  # noqa: E402
from .evaluator import CaseEval, evaluate_case  # noqa: E402
from .report import build_report, write_report  # noqa: E402


@dataclass
class RunResult:
    dataset_id: str
    cases: list[CaseEval] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "datasetId": self.dataset_id,
            "meta": dict(self.meta),
            "cases": [c.to_dict() for c in self.cases],
        }


def _result_from_case(case: BenchCase) -> dict[str, Any]:
    """Offline mode: case.input.result is a frozen captcha solver snapshot."""
    raw = case.input.get("result")
    if isinstance(raw, dict):
        return copy.deepcopy(raw)
    # Allow flat input as result
    return copy.deepcopy(case.input)


def run_case(case: BenchCase) -> CaseEval:
    result = _result_from_case(case)
    before = copy.deepcopy(result)
    fields = build_compatible_observation_fields(result)
    obs = {
        "schemaVersion": fields.get("schemaVersion"),
        "evidenceSchemaVersion": fields.get("evidenceSchemaVersion"),
        "evidenceBundle": fields.get("evidenceBundle"),
        "explanation": fields.get("explanation"),
        "legacyMirrors": fields.get("legacyMirrors"),
    }
    # Decision isolation: attaching evidence must not mutate contract fields
    for k in ("solved", "text", "decision", "decisionScore", "confidence"):
        if k in before:
            result[k] = before[k]
    contract_diffs = assert_contract_unchanged(before, result)
    ev = evaluate_case(
        case,
        result=result,
        observation=obs,
        baseline_result=before,
        baseline_observation={
            "evidenceSchemaVersion": "1.0",
            "evidenceBundle": {
                "summary": {
                    "evidenceQuality": case.evidence_expectation.baseline_quality,
                    "primaryGap": case.evidence_expectation.baseline_primary_gap,
                }
            },
            "explanation": [
                {"type": t, "message": t} for t in (case.evidence_expectation.baseline_explanation_types or [])
            ],
        },
    )
    if contract_diffs:
        dim = ev.dimensions.get("decision_isolation")
        if dim is not None:
            dim.passed = False
            dim.failures.append(f"contract_keys_changed={contract_diffs}")
    return ev


def run_dataset(dataset_dir: Path | str) -> RunResult:
    root = Path(dataset_dir)
    manifest, cases = load_dataset(root)
    dataset_id = str(manifest.get("id") or root.name)
    evaluated = [run_case(c) for c in cases]
    return RunResult(
        dataset_id=dataset_id,
        cases=evaluated,
        meta={
            "manifest": manifest,
            "caseCount": len(cases),
            "ts": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            "mode": "offline_snapshot",
            "blockDeploy": False,
            "note": "EE-5 report-only; does not tune weights / train / block deploy",
        },
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    ee_root = _EE_ROOT
    default_ds = ee_root / "datasets" / "captcha-demo-v1"
    out_dir = ee_root / "reports"
    dataset = Path(argv[0]) if argv else default_ds
    if not dataset.is_absolute():
        dataset = (ee_root / dataset).resolve() if not dataset.exists() else dataset.resolve()
    run = run_dataset(dataset)
    report = build_report(run)
    paths = write_report(report, out_dir=out_dir, prefix=f"ee5_{run.dataset_id}")
    print(json.dumps({"report": str(paths["md"]), "json": str(paths["json"]), "summary": report.get("summary")}, ensure_ascii=False))
    # Report-only: always exit 0 (never block deploy)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
