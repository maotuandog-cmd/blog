"""Evidence Engine — EvidenceBundle (EE-2).

Aggregates Candidate / Evidence / Comparison / Gap into a transferable,
auditable package. Does NOT decide accept/abstain or compute policy scores.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .candidate import Candidate
from .comparison import Comparison
from .evidence import Evidence
from .explain import Explain
from .gap import Gap, recommend_secondary_from_gaps

EvidenceQuality = Literal["strong", "medium", "weak", "unknown"]


def _summarize_quality(*, support_count: int, risk_count: int, true_gap_count: int) -> EvidenceQuality:
    """Coarse narrative quality for Explain / bench — not a Decision score."""
    if true_gap_count > 0 or risk_count > 0:
        if support_count == 0:
            return "weak"
        return "weak" if true_gap_count >= 2 or risk_count >= 2 else "medium"
    if support_count >= 2:
        return "strong"
    if support_count == 1:
        return "medium"
    return "unknown"


@dataclass
class BundleSummary:
    """Explain-oriented rollup (observation only)."""

    evidence_quality: EvidenceQuality = "unknown"
    support_count: int = 0
    risk_count: int = 0
    primary_gap: str | None = None
    candidate_count: int = 0
    comparison_counts: dict[str, int] = field(default_factory=dict)
    gap_hint: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "evidenceQuality": self.evidence_quality,
            "supportCount": self.support_count,
            "riskCount": self.risk_count,
            "candidateCount": self.candidate_count,
            "comparisonCounts": dict(self.comparison_counts),
        }
        if self.primary_gap is not None:
            out["primaryGap"] = self.primary_gap
        if self.gap_hint:
            out["gapHint"] = dict(self.gap_hint)
        if self.notes:
            out["notes"] = list(self.notes)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> BundleSummary:
        d = data or {}
        q = str(d.get("evidenceQuality") or d.get("evidence_quality") or "unknown")
        if q not in ("strong", "medium", "weak", "unknown"):
            q = "unknown"
        return cls(
            evidence_quality=q,  # type: ignore[arg-type]
            support_count=int(d.get("supportCount") or d.get("support_count") or 0),
            risk_count=int(d.get("riskCount") or d.get("risk_count") or 0),
            primary_gap=(
                str(d["primaryGap"])
                if d.get("primaryGap") is not None
                else (str(d["primary_gap"]) if d.get("primary_gap") is not None else None)
            ),
            candidate_count=int(d.get("candidateCount") or d.get("candidate_count") or 0),
            comparison_counts=dict(d.get("comparisonCounts") or d.get("comparison_counts") or {}),
            gap_hint=dict(d.get("gapHint") or d.get("gap_hint") or {}),
            notes=[str(x) for x in (d.get("notes") or [])],
        )


@dataclass
class EvidenceBundle:
    """Incremental evidence package. Never embeds Decision accept/reject."""

    schema_version: str = "0.1"
    candidate_set: list[Candidate] = field(default_factory=list)
    evidences: list[Evidence] = field(default_factory=list)
    comparisons: list[Comparison] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    explain: Explain | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    _summary_cache: BundleSummary | None = field(default=None, repr=False, compare=False)

    # --- incremental API ---

    def add_candidate(self, candidate: Candidate | dict[str, Any]) -> Candidate:
        c = candidate if isinstance(candidate, Candidate) else Candidate.from_dict(candidate)
        self.candidate_set.append(c)
        self._summary_cache = None
        return c

    def add_evidence(self, evidence: Evidence | dict[str, Any]) -> Evidence:
        e = evidence if isinstance(evidence, Evidence) else Evidence.from_dict(evidence)
        self.evidences.append(e)
        self._summary_cache = None
        return e

    def add_comparison(self, comparison: Comparison | dict[str, Any]) -> Comparison:
        cmp_ = comparison if isinstance(comparison, Comparison) else Comparison.from_dict(comparison)
        self.comparisons.append(cmp_)
        self._summary_cache = None
        return cmp_

    def add_gap(self, gap: Gap | dict[str, Any]) -> Gap:
        g = gap if isinstance(gap, Gap) else Gap.from_dict(gap)
        self.gaps.append(g)
        self._summary_cache = None
        return g

    def set_explain(self, explain: Explain | dict[str, Any] | None) -> Explain | None:
        if explain is None:
            self.explain = None
        elif isinstance(explain, Explain):
            self.explain = explain
        else:
            self.explain = Explain.from_dict(explain)
        self._summary_cache = None
        return self.explain

    # --- summary / explain helpers ---

    def build_summary(self) -> BundleSummary:
        """Recompute explain-oriented summary (no Decision fields)."""
        support_count = 0
        risk_count = 0
        for ev in self.evidences:
            q = str(ev.quality or "unknown")
            score = ev.score
            if q == "high" or (score is not None and float(score) >= 0.75):
                support_count += 1
            elif q == "low" or (score is not None and float(score) < 0.45):
                risk_count += 1
            elif q == "medium":
                # medium neither strong support nor risk for counting
                pass
            elif score is not None and float(score) >= 0.45:
                support_count += 1

        for cmp_ in self.comparisons:
            if cmp_.status == "agree":
                support_count += 1
            elif cmp_.status in ("conflict", "incomparable"):
                risk_count += 1

        true_gaps = [g for g in self.gaps if g.is_true_gap]
        order = {"high": 3, "medium": 2, "low": 1}
        primary = None
        if true_gaps:
            primary = max(true_gaps, key=lambda g: order.get(g.severity, 0)).type
        elif self.gaps:
            primary = self.gaps[0].type

        cmp_counts: dict[str, int] = {}
        for cmp_ in self.comparisons:
            st = str(cmp_.status or "unknown")
            cmp_counts[st] = cmp_counts.get(st, 0) + 1

        quality = _summarize_quality(
            support_count=support_count,
            risk_count=risk_count,
            true_gap_count=len(true_gaps),
        )
        hint = recommend_secondary_from_gaps(self.gaps)
        notes: list[str] = []
        if true_gaps:
            notes.append("true_evidence_gap")
        if any(g.is_optional for g in self.gaps) and not true_gaps:
            notes.append("optional_evidence_only")
        if any(c.status == "incomparable" for c in self.comparisons):
            notes.append("has_incomparable_comparison")

        summary = BundleSummary(
            evidence_quality=quality,
            support_count=support_count,
            risk_count=risk_count,
            primary_gap=primary,
            candidate_count=len(self.candidate_set),
            comparison_counts=cmp_counts,
            gap_hint={
                "recommendSecondary": hint.get("recommendSecondary"),
                "priority": hint.get("priority"),
                "strong": hint.get("strong"),
                "applied": False,
            },
            notes=notes,
        )
        self._summary_cache = summary
        return summary

    @property
    def summary(self) -> BundleSummary:
        if self._summary_cache is None:
            return self.build_summary()
        return self._summary_cache

    def explain_lines(self) -> dict[str, list[str]]:
        """Human-oriented buckets for Agent / bench / ops (not Decision)."""
        support: list[str] = []
        risk: list[str] = []
        gaps: list[str] = []
        for ev in self.evidences:
            label = f"{ev.type}" + (f" {ev.score}" if ev.score is not None else "")
            if ev.quality == "low" or (ev.score is not None and float(ev.score) < 0.45):
                risk.append(label)
            else:
                support.append(label)
        for cmp_ in self.comparisons:
            line = f"comparison {cmp_.left}/{cmp_.right} {cmp_.status}"
            if cmp_.reason:
                line += f" ({cmp_.reason})"
            if cmp_.status == "agree":
                support.append(line)
            else:
                risk.append(line)
        for g in self.gaps:
            gaps.append(f"{g.type}" + (f" severity={g.severity}" if g.severity else ""))
        return {"support": support, "risk": risk, "gaps": gaps}

    # --- serialization ---

    def to_dict(self, *, include_summary: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schemaVersion": self.schema_version,
            "candidateSet": [c.to_dict() for c in self.candidate_set],
            "evidences": [e.to_dict() for e in self.evidences],
            "comparisons": [c.to_dict() for c in self.comparisons],
            "gaps": [g.to_dict() for g in self.gaps],
        }
        if include_summary:
            out["summary"] = self.summary.to_dict()
        if self.explain is not None:
            out["explain"] = self.explain.to_dict()
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        # Hard guard: never serialize decision accept flags from bundle core
        for forbidden in ("accept", "abstain", "decision", "solved"):
            out.pop(forbidden, None)
        return out

    def to_json_dict(self) -> dict[str, Any]:
        """Alias for JSON / JSONL / Kafka-friendly payload."""
        return self.to_dict(include_summary=True)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> EvidenceBundle:
        d = data or {}
        bundle = cls(
            schema_version=str(d.get("schemaVersion") or d.get("schema_version") or "0.1"),
            metadata=dict(d.get("metadata") or {}),
        )
        for item in d.get("candidateSet") or d.get("candidate_set") or []:
            if isinstance(item, dict):
                bundle.add_candidate(item)
        for item in d.get("evidences") or []:
            if isinstance(item, dict):
                bundle.add_evidence(item)
        for item in d.get("comparisons") or []:
            if isinstance(item, dict):
                bundle.add_comparison(item)
        for item in d.get("gaps") or []:
            if isinstance(item, dict):
                bundle.add_gap(item)
        if d.get("explain") is not None and isinstance(d.get("explain"), dict):
            bundle.set_explain(d["explain"])
        # Prefer recomputed summary; ignore stale accept-like keys if present
        bundle.build_summary()
        return bundle
