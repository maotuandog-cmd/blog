"""Evidence Engine compatibility layer (EE-4)."""
from __future__ import annotations

from .explanation import build_explanation
from .legacy import (
    assert_contract_unchanged,
    bundle_to_legacy_mirrors,
    build_compatible_observation_fields,
    legacy_to_bundle,
)
from .schema import EVIDENCE_SCHEMA_VERSION, OBSERVATION_SCHEMA_VERSION, schema_headers

__all__ = [
    "EVIDENCE_SCHEMA_VERSION",
    "OBSERVATION_SCHEMA_VERSION",
    "schema_headers",
    "build_explanation",
    "legacy_to_bundle",
    "bundle_to_legacy_mirrors",
    "build_compatible_observation_fields",
    "assert_contract_unchanged",
]
