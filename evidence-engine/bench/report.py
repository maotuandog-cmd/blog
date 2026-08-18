"""EE-5 report builder (markdown + json)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .runner import RunResult


def build_report(run: "RunResult") -> dict[str, Any]:
    n = len(run.cases) or 1
    dim_pass: dict[str, int] = {}
    dim_fail: dict[str, int] = {}
    degradation_cases: list[str] = []
    completeness_ok = 0
    explanation_ok = 0
    contract_ok = 0
    isolation_ok = 0
    quality_fail = 0

    for case in run.cases:
        for name, dim in case.dimensions.items():
            dim_pass[name] = dim_pass.get(name, 0) + (1 if dim.passed else 0)
            dim_fail[name] = dim_fail.get(name, 0) + (0 if dim.passed else 1)
        if case.dimensions.get("contract") and case.dimensions["contract"].passed:
            contract_ok += 1
        if case.dimensions.get("completeness") and case.dimensions["completeness"].passed:
            completeness_ok += 1
        if case.dimensions.get("explanation") and case.dimensions["explanation"].passed:
            explanation_ok += 1
        if case.dimensions.get("decision_isolation") and case.dimensions["decision_isolation"].passed:
            isolation_ok += 1
        q = case.dimensions.get("quality")
        if q and not q.passed:
            quality_fail += 1
            degradation_cases.append(case.case_id)
        elif q and q.detail.get("gapChanged"):
            degradation_cases.append(case.case_id)

    summary = {
        "dataset": run.dataset_id,
        "cases": len(run.cases),
        "contractPassRate": round(contract_ok / n, 4),
        "bundleCompleteness": round(completeness_ok / n, 4),
        "explanationCoverage": round(explanation_ok / n, 4),
        "decisionIsolation": "PASS" if isolation_ok == len(run.cases) else "FAIL",
        "evidenceDegradationCases": len(set(degradation_cases)),
        "dimensionPass": dim_pass,
        "dimensionFail": dim_fail,
        "blockDeploy": False,
    }
    return {
        "title": "Evidence Regression Report",
        "meta": run.meta,
        "summary": summary,
        "degradationCaseIds": sorted(set(degradation_cases)),
        "cases": [c.to_dict() for c in run.cases],
    }


def render_markdown(report: dict[str, Any]) -> str:
    s = report.get("summary") or {}
    lines = [
        f"# {report.get('title') or 'Evidence Regression Report'}",
        "",
        f"- Dataset: `{s.get('dataset')}`",
        f"- Cases: **{s.get('cases')}**",
        f"- Contract: **{'PASS' if (s.get('contractPassRate') or 0) >= 1.0 else 'FAIL'}** ({s.get('contractPassRate')})",
        f"- Bundle completeness: **{(s.get('bundleCompleteness') or 0) * 100:.1f}%**",
        f"- Explanation coverage: **{(s.get('explanationCoverage') or 0) * 100:.1f}%**",
        f"- Decision isolation: **{s.get('decisionIsolation')}**",
        f"- Evidence degradation: **{s.get('evidenceDegradationCases')} cases**",
        f"- Block deploy: **{s.get('blockDeploy')}** (EE-5 report-only)",
        "",
        "## Dimension pass counts",
        "",
        f"`{s.get('dimensionPass')}`",
        "",
        "## Degradation caseIds",
        "",
    ]
    ids = report.get("degradationCaseIds") or []
    if not ids:
        lines.append("- (none)")
    else:
        for cid in ids:
            lines.append(f"- `{cid}`")
    lines += ["", "## Notes", "", "- No weight tuning / training / deploy gate in EE-5.", ""]
    return "\n".join(lines)


def write_report(report: dict[str, Any], *, out_dir: Path | str, prefix: str = "ee5") -> dict[str, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ts = (report.get("meta") or {}).get("ts") or "now"
    json_path = out / f"{prefix}_{ts}.json"
    md_path = out / f"{prefix}_{ts}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    # Also write a stable latest pointer
    (out / f"{prefix}_latest.md").write_text(render_markdown(report), encoding="utf-8")
    (out / f"{prefix}_latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"json": json_path, "md": md_path}
