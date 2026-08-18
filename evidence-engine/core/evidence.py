"""Evidence Engine — Evidence item (EE-1)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Quality = Literal["high", "medium", "low", "unknown"]


@dataclass
class Evidence:
    """Unified supporting reason for a candidate."""

    candidate_id: str
    type: str
    score: float | None = None
    quality: Quality = "unknown"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "candidateId": self.candidate_id,
            "type": self.type,
            "quality": self.quality,
        }
        if self.score is not None:
            out["score"] = round(float(self.score), 4)
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Evidence:
        d = data or {}
        score = d.get("score")
        try:
            score_f = float(score) if score is not None else None
        except (TypeError, ValueError):
            score_f = None
        quality = str(d.get("quality") or "unknown")
        if quality not in ("high", "medium", "low", "unknown"):
            quality = "unknown"
        return cls(
            candidate_id=str(d.get("candidateId") or d.get("candidate_id") or ""),
            type=str(d.get("type") or ""),
            score=score_f,
            quality=quality,  # type: ignore[arg-type]
            metadata=dict(d.get("metadata") or {}),
        )


def quality_from_score(score: float | None, *, high: float = 0.75, medium: float = 0.45) -> Quality:
    """Map numeric score → coarse quality (observation helper; not Decision)."""
    if score is None:
        return "unknown"
    s = float(score)
    if s >= high:
        return "high"
    if s >= medium:
        return "medium"
    return "low"
