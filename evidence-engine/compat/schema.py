"""Evidence Engine compatibility schema (EE-4)."""
from __future__ import annotations

# Stable observation / evidence contract version for captcha bypass.
EVIDENCE_SCHEMA_VERSION = "1.0"
OBSERVATION_SCHEMA_VERSION = "1.0"


def schema_headers() -> dict[str, str]:
    return {
        "schemaVersion": OBSERVATION_SCHEMA_VERSION,
        "evidenceSchemaVersion": EVIDENCE_SCHEMA_VERSION,
    }
