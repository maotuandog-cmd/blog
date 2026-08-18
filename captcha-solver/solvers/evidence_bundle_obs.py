"""Optional bridge: attach EvidenceBundle + EE-4 compat fields to observation.

Never mutates solved / text / decisionScore / accept|abstain.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any


def evidence_bundle_obs_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_EVIDENCE_BUNDLE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.evidenceBundle", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def _ensure_ee_path() -> Path | None:
    # captcha-solver/solvers → repo root → evidence-engine
    here = Path(__file__).resolve()
    ee = here.parents[2] / "evidence-engine"
    if ee.is_dir():
        root = str(ee)
        if root not in sys.path:
            sys.path.insert(0, root)
        return ee
    return None


def attach_evidence_bundle(result: dict[str, Any], obs: dict[str, Any]) -> dict[str, Any]:
    """Merge EE-4 compatible observation fields. Best-effort; never breaks solve."""
    if not evidence_bundle_obs_enabled():
        return obs
    try:
        if _ensure_ee_path() is None:
            obs["evidenceBundle"] = {"error": "evidence_engine_missing", "schemaVersion": "1.0"}
            obs.setdefault("schemaVersion", "1.0")
            obs.setdefault("evidenceSchemaVersion", "1.0")
            return obs
        from compat.legacy import build_compatible_observation_fields

        fields = build_compatible_observation_fields(result)
        # Additive merge — never delete existing observation keys.
        for key, value in fields.items():
            if value is not None:
                obs[key] = value
        # Top-level mirror for bench convenience (observation-only).
        if "evidenceBundle" in fields:
            result["evidenceBundle"] = fields["evidenceBundle"]
        if "explanation" in fields:
            result["explanation"] = fields["explanation"]
        result["evidenceSchemaVersion"] = fields.get("evidenceSchemaVersion")
    except Exception as exc:  # noqa: BLE001 — never break solve path
        obs["evidenceBundle"] = {
            "error": type(exc).__name__,
            "detail": str(exc)[:200],
            "schemaVersion": "1.0",
        }
        obs.setdefault("schemaVersion", "1.0")
        obs.setdefault("evidenceSchemaVersion", "1.0")
    return obs
