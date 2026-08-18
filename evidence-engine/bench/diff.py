"""EE-5 case-level evidence diffs."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvidenceChange:
    type: str
    before: Any
    after: Any
    path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out = {"type": self.type, "before": self.before, "after": self.after}
        if self.path:
            out["path"] = self.path
        return out


@dataclass
class CaseDiff:
    case_id: str
    decision_diff: bool = False
    evidence_diff: bool = False
    changes: list[EvidenceChange] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "caseId": self.case_id,
            "decisionDiff": self.decision_diff,
            "evidenceDiff": self.evidence_diff,
            "changes": [c.to_dict() for c in self.changes],
            "notes": list(self.notes),
        }


def diff_decision(before: dict[str, Any], after: dict[str, Any]) -> list[EvidenceChange]:
    changes: list[EvidenceChange] = []
    for key in ("solved", "text", "decision", "decisionScore", "confidence"):
        if before.get(key) != after.get(key):
            changes.append(EvidenceChange(type="decision", before=before.get(key), after=after.get(key), path=key))
    return changes


def diff_evidence(
    *,
    case_id: str,
    baseline_obs: dict[str, Any] | None,
    current_obs: dict[str, Any] | None,
    baseline_result: dict[str, Any] | None = None,
    current_result: dict[str, Any] | None = None,
) -> CaseDiff:
    """Compare baseline vs current observation evidence (report-only)."""
    baseline_obs = baseline_obs or {}
    current_obs = current_obs or {}
    baseline_result = baseline_result or {}
    current_result = current_result or {}

    d_changes = diff_decision(baseline_result, current_result)
    changes: list[EvidenceChange] = []

    b_bundle = baseline_obs.get("evidenceBundle") or {}
    c_bundle = current_obs.get("evidenceBundle") or {}
    b_sum = b_bundle.get("summary") or {}
    c_sum = c_bundle.get("summary") or {}

    if b_sum.get("evidenceQuality") != c_sum.get("evidenceQuality"):
        changes.append(
            EvidenceChange(
                type="quality",
                before=b_sum.get("evidenceQuality"),
                after=c_sum.get("evidenceQuality"),
                path="summary.evidenceQuality",
            )
        )
    if b_sum.get("primaryGap") != c_sum.get("primaryGap"):
        changes.append(
            EvidenceChange(
                type="gap",
                before=b_sum.get("primaryGap") or "none",
                after=c_sum.get("primaryGap") or "none",
                path="summary.primaryGap",
            )
        )

    b_expl = {str(x.get("type")) for x in (baseline_obs.get("explanation") or []) if isinstance(x, dict)}
    c_expl = {str(x.get("type")) for x in (current_obs.get("explanation") or []) if isinstance(x, dict)}
    lost = sorted(b_expl - c_expl)
    if lost:
        changes.append(EvidenceChange(type="explanation", before=sorted(b_expl), after=sorted(c_expl), path="explanation.types"))

    b_schema = baseline_obs.get("evidenceSchemaVersion")
    c_schema = current_obs.get("evidenceSchemaVersion")
    if b_schema and c_schema and b_schema != c_schema:
        changes.append(EvidenceChange(type="schema", before=b_schema, after=c_schema, path="evidenceSchemaVersion"))

    return CaseDiff(
        case_id=case_id,
        decision_diff=bool(d_changes),
        evidence_diff=bool(changes),
        changes=d_changes + changes,
        notes=["report_only"] if (d_changes or changes) else [],
    )
