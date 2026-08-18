"""EE-5 evaluators — five regression dimensions (report-only)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .dataset import BenchCase, EvidenceExpectation
from .diff import CaseDiff, diff_evidence

QUALITY_RANK = {"unknown": 0, "weak": 1, "medium": 2, "strong": 3}


@dataclass
class DimensionResult:
    name: str
    passed: bool
    detail: dict[str, Any] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "detail": dict(self.detail),
            "failures": list(self.failures),
        }


@dataclass
class CaseEval:
    case_id: str
    dimensions: dict[str, DimensionResult] = field(default_factory=dict)
    diff: CaseDiff | None = None
    observation: dict[str, Any] = field(default_factory=dict)
    result_snapshot: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "caseId": self.case_id,
            "dimensions": {k: v.to_dict() for k, v in self.dimensions.items()},
            "diff": self.diff.to_dict() if self.diff else None,
        }


def _has_candidates(bundle: dict[str, Any]) -> bool:
    return bool(bundle.get("candidateSet"))


def _has_evidences(bundle: dict[str, Any]) -> bool:
    return bool(bundle.get("evidences")) or bool((bundle.get("comparisons") or [])) or bool((bundle.get("gaps") or []))


def eval_contract(obs: dict[str, Any], result: dict[str, Any], case: BenchCase) -> DimensionResult:
    failures: list[str] = []
    if obs.get("evidenceSchemaVersion") != "1.0" and obs.get("evidenceSchemaVersion") is not None:
        # allow missing only if bundle error; otherwise require 1.0
        if "evidenceBundle" in obs and not (obs.get("evidenceBundle") or {}).get("error"):
            if obs.get("evidenceSchemaVersion") != "1.0":
                failures.append("evidenceSchemaVersion!=1.0")
    if "evidenceBundle" not in obs:
        failures.append("missing evidenceBundle")
    else:
        bundle = obs.get("evidenceBundle") or {}
        if not isinstance(bundle, dict):
            failures.append("evidenceBundle not object")
        elif "schemaVersion" not in bundle and "candidateSet" not in bundle:
            failures.append("evidenceBundle missing schema/candidateSet")
    # Legacy contract fields must remain present as provided by input result
    for key in ("solved", "decision"):
        if key in case.input.get("result", case.input) and key not in result:
            failures.append(f"legacy missing {key}")
    # text may be empty on abstain — only check key presence when expected.verify != abstain without text
    return DimensionResult(
        name="contract",
        passed=not failures,
        detail={"evidenceSchemaVersion": obs.get("evidenceSchemaVersion"), "schemaVersion": obs.get("schemaVersion")},
        failures=failures,
    )


def eval_completeness(obs: dict[str, Any], expectation: EvidenceExpectation) -> DimensionResult:
    failures: list[str] = []
    bundle = obs.get("evidenceBundle") or {}
    required = set(expectation.required or [])
    if "candidate" in required and not _has_candidates(bundle):
        failures.append("missing candidate")
    if "evidence" in required and not _has_evidences(bundle):
        failures.append("missing evidence")
    if "comparison" in required and not bundle.get("comparisons"):
        failures.append("missing comparison")
    if "gap" in required and not bundle.get("gaps"):
        failures.append("missing gap")
    for forbid in expectation.forbidden or []:
        if forbid == "fake_high_confidence":
            # Heuristic: char_confidence score high while LOW_CHAR_* gap present → suspicious
            gaps = {g.get("type") for g in (bundle.get("gaps") or []) if isinstance(g, dict)}
            for ev in bundle.get("evidences") or []:
                if not isinstance(ev, dict):
                    continue
                if ev.get("type") == "char_confidence" and (ev.get("score") or 0) >= 0.9:
                    if gaps & {"LOW_CHAR_CONFIDENCE", "LOW_CHAR_MARGIN"}:
                        failures.append("fake_high_confidence")
    expl = obs.get("explanation") or []
    if expectation.min_explanation and len(expl) < expectation.min_explanation:
        failures.append(f"explanation<{expectation.min_explanation}")
    return DimensionResult(
        name="completeness",
        passed=not failures,
        detail={"required": list(required), "explanationCount": len(expl)},
        failures=failures,
    )


def eval_quality(obs: dict[str, Any], expectation: EvidenceExpectation) -> DimensionResult:
    failures: list[str] = []
    bundle = obs.get("evidenceBundle") or {}
    quality = str((bundle.get("summary") or {}).get("evidenceQuality") or "unknown")
    baseline = expectation.baseline_quality
    degraded = False
    if baseline:
        if QUALITY_RANK.get(quality, 0) < QUALITY_RANK.get(baseline, 0):
            degraded = True
            failures.append(f"quality {baseline}->{quality}")
    primary = (bundle.get("summary") or {}).get("primaryGap")
    if expectation.baseline_primary_gap and primary != expectation.baseline_primary_gap:
        # gap change is evidence diff, not always failure — flag as soft failure for regression watch
        failures.append(f"primaryGap {expectation.baseline_primary_gap}->{primary}")
    return DimensionResult(
        name="quality",
        passed=not degraded,  # primaryGap change reported but quality drop is the hard fail
        detail={"quality": quality, "baseline": baseline, "primaryGap": primary, "gapChanged": bool(expectation.baseline_primary_gap and primary != expectation.baseline_primary_gap)},
        failures=failures,
    )


def eval_explanation(obs: dict[str, Any], expectation: EvidenceExpectation) -> DimensionResult:
    failures: list[str] = []
    expl = obs.get("explanation") or []
    types = {str(x.get("type")) for x in expl if isinstance(x, dict)}
    # Degenerate if only info / empty while baseline had support/risk/gap
    baseline_types = set(expectation.baseline_explanation_types or [])
    if baseline_types:
        lost = baseline_types - types
        # Losing support/risk/gap while only keeping info = explanation regression
        meaningful_lost = lost & {"support", "risk", "gap", "comparison"}
        if meaningful_lost and types <= {"info"} or meaningful_lost and not (types & {"support", "risk", "gap", "comparison"}):
            failures.append(f"explanation degraded lost={sorted(meaningful_lost)}")
        elif meaningful_lost:
            failures.append(f"explanation lost types={sorted(meaningful_lost)}")
    if not expl and expectation.min_explanation > 0:
        failures.append("empty explanation")
    return DimensionResult(
        name="explanation",
        passed=not failures,
        detail={"types": sorted(types)},
        failures=failures,
    )


def eval_decision_isolation(
    *,
    case: BenchCase,
    before_result: dict[str, Any],
    after_result: dict[str, Any],
    before_obs: dict[str, Any],
    after_obs: dict[str, Any],
) -> tuple[DimensionResult, CaseDiff]:
    diff = diff_evidence(
        case_id=case.case_id,
        baseline_obs=before_obs,
        current_obs=after_obs,
        baseline_result=before_result,
        current_result=after_result,
    )
    failures: list[str] = []
    if diff.decision_diff:
        failures.append("decisionDiff=true")
    return (
        DimensionResult(
            name="decision_isolation",
            passed=not failures,
            detail={"evidenceDiff": diff.evidence_diff, "decisionDiff": diff.decision_diff},
            failures=failures,
        ),
        diff,
    )


def evaluate_case(
    case: BenchCase,
    *,
    result: dict[str, Any],
    observation: dict[str, Any],
    baseline_result: dict[str, Any] | None = None,
    baseline_observation: dict[str, Any] | None = None,
) -> CaseEval:
    """Evaluate one case across five dimensions."""
    exp = case.evidence_expectation
    baseline_result = baseline_result if baseline_result is not None else dict(case.input.get("result") or case.input)
    # Baseline observation: if provided use it; else synthesize expectation anchors only
    baseline_observation = baseline_observation or {
        "evidenceSchemaVersion": "1.0",
        "evidenceBundle": {
            "summary": {
                "evidenceQuality": exp.baseline_quality,
                "primaryGap": exp.baseline_primary_gap,
            }
        },
        "explanation": [{"type": t, "message": t} for t in (exp.baseline_explanation_types or [])],
    }

    dims: dict[str, DimensionResult] = {
        "contract": eval_contract(observation, result, case),
        "completeness": eval_completeness(observation, exp),
        "quality": eval_quality(observation, exp),
        "explanation": eval_explanation(observation, exp),
    }
    isolation, diff = eval_decision_isolation(
        case=case,
        before_result=baseline_result,
        after_result=result,
        before_obs=baseline_observation,
        after_obs=observation,
    )
    dims["decision_isolation"] = isolation
    return CaseEval(
        case_id=case.case_id,
        dimensions=dims,
        diff=diff,
        observation=observation,
        result_snapshot={k: result.get(k) for k in ("solved", "text", "decision", "decisionScore", "confidence")},
    )
