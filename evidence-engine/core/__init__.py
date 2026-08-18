"""Evidence Engine core (EE-1 / EE-2). Domain-agnostic contracts."""
from __future__ import annotations

from .bundle import BundleSummary, EvidenceBundle
from .candidate import Candidate
from .comparison import Comparison, normalize_comparison_status
from .evidence import Evidence, quality_from_score
from .explain import Explain
from .gap import (
    OPTIONAL_GAP_TYPES,
    TRUE_GAP_TYPES,
    Gap,
    clamp_gap_severity,
    recommend_secondary_from_gaps,
)

__all__ = [
    "Candidate",
    "Evidence",
    "Comparison",
    "Gap",
    "Explain",
    "EvidenceBundle",
    "BundleSummary",
    "quality_from_score",
    "normalize_comparison_status",
    "TRUE_GAP_TYPES",
    "OPTIONAL_GAP_TYPES",
    "clamp_gap_severity",
    "recommend_secondary_from_gaps",
]
