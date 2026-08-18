"""Evidence Engine — Candidate (EE-1)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Candidate:
    """Unified candidate answer (domain-agnostic)."""

    id: str
    value: str
    source: str
    source_family: str = "unknown"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "value": self.value,
            "source": self.source,
            "sourceFamily": self.source_family,
        }
        if self.metadata:
            out["metadata"] = dict(self.metadata)
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Candidate:
        d = data or {}
        return cls(
            id=str(d.get("id") or ""),
            value=str(d.get("value") or ""),
            source=str(d.get("source") or ""),
            source_family=str(d.get("sourceFamily") or d.get("source_family") or "unknown"),
            metadata=dict(d.get("metadata") or {}),
        )
