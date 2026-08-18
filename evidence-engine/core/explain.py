"""Evidence Engine — Explain / read-only decision view (EE-1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Explain:
    """Read-only decision observation — does not compute or mutate Decision."""

    decision: str | None = None
    decision_score: float | None = None
    evidence_score: float | None = None
    solved: bool | None = None
    notes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.decision is not None:
            out["decision"] = self.decision
        if self.decision_score is not None:
            out["decisionScore"] = round(float(self.decision_score), 4)
        if self.evidence_score is not None:
            out["evidenceScore"] = round(float(self.evidence_score), 4)
        if self.solved is not None:
            out["solved"] = bool(self.solved)
        if self.notes:
            out["notes"] = list(self.notes)
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Explain:
        d = data or {}

        def _f(key: str) -> float | None:
            v = d.get(key)
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        return cls(
            decision=(str(d["decision"]) if d.get("decision") is not None else None),
            decision_score=_f("decisionScore") if "decisionScore" in d else _f("decision_score"),
            evidence_score=_f("evidenceScore") if "evidenceScore" in d else _f("evidence_score"),
            solved=(bool(d["solved"]) if d.get("solved") is not None else None),
            notes=[str(x) for x in (d.get("notes") or [])],
            metadata=dict(d.get("metadata") or {}),
        )
