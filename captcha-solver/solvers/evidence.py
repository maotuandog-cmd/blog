"""F2 Evidence de-correlation: group correlated preprocess votes.

Freeze (REQ §17):
  F2-A Evidence Grouping — same model/source family ≠ independent sources
  F2-B Correlated-vote penalty/cap — do not let variant count inflate evidence
  Does not add OCR engines or preprocess variants.
"""
from __future__ import annotations

import math
import os
from typing import Any


def _cfg_float(key: str, default: float) -> float:
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return float(cfg(key, default))
    except (TypeError, ValueError, ImportError):
        pass
    return default


def decorrelate_enabled() -> bool:
    """F2-A/B master switch. Default on."""
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_DECORRELATE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("decision.decorrelate", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def correlated_min_agree() -> float:
    """F2-C: min weightShare/agreement for single-source multi-vote ACCEPT.

    Default 1.0 = require unanimous support among valid readings when only one
    independent evidence group contributed (typical ddddocr+preprocess).
    """
    env = (os.environ.get("HERMES_CAPTCHA_OCR_CORRELATED_MIN_AGREE") or "").strip()
    if env:
        try:
            return min(1.0, max(0.0, float(env)))
        except ValueError:
            pass
    try:
        return min(1.0, max(0.0, _cfg_float("decision.correlatedMinAgree", 1.0)))
    except (TypeError, ValueError):
        return 1.0


def singleton_gate_enabled() -> bool:
    """F2-D: restrict singleton / single-vote ACCEPT. Default off (F2 baseline).

    Enable with HERMES_CAPTCHA_OCR_SINGLETON_GATE=1 or decision.singletonGate=true.
    """
    raw = (os.environ.get("HERMES_CAPTCHA_OCR_SINGLETON_GATE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("decision.singletonGate", False))
    except (TypeError, ValueError, ImportError):
        pass
    return False


def singleton_min_evidence() -> float:
    """Min evidenceScore for pure singleton (nValid==1) when F2-D gate is on."""
    env = (os.environ.get("HERMES_CAPTCHA_OCR_SINGLETON_MIN_EVIDENCE") or "").strip()
    if env:
        try:
            return min(1.0, max(0.0, float(env)))
        except ValueError:
            pass
    try:
        return min(1.0, max(0.0, _cfg_float("decision.singletonMinEvidence", 0.65)))
    except (TypeError, ValueError):
        return 0.65


def singleton_accept_reason(
    *,
    votes: int,
    n_valid: int,
    singleton: bool,
    evidence: float,
    text: str,
    prefer_len: int | None = None,
) -> str | None:
    """F2-D: return abstain reason if singleton/single-vote lacks extra evidence; else None.

    Policy (not a blanket ban):
      - votes<=1 and nValid>=2 → lone supporter amid other readings → abstain
      - pure singleton (nValid<=1) → require evidence >= singletonMinEvidence
      - optional: preferred LEN mismatch → abstain
    """
    if not singleton_gate_enabled():
        return None
    if not (text or "").strip():
        return None

    v = int(votes)
    nv = int(n_valid)
    is_singleton = bool(singleton) or nv <= 1

    if prefer_len is not None and len(text.strip()) != int(prefer_len):
        return "singleton_len_mismatch"

    # Single supporting vote while other variants also produced readings:
    # not independent proof — typically soft-path / chroma-only winners.
    if v <= 1 and nv >= 2:
        return "singleton_amid_disagreement"

    if is_singleton or v <= 1:
        min_ev = float(singleton_min_evidence())
        if float(evidence) + 1e-9 < min_ev:
            return "singleton_weak_evidence"
    return None


def evidence_group_id(preprocess_name: str, *, engine: str = "ddddocr") -> str:
    """Map a reading to an evidence group (same model / source family).

    All preprocess variants of standard ddddocr share one group.
    Beta engine readings (`*+beta`) form a second group.
    """
    name = (preprocess_name or "").strip().lower()
    eng = (engine or "ddddocr").strip().lower() or "ddddocr"
    if "+beta" in name or name.endswith("beta"):
        return f"{eng}_beta"
    if name.startswith("vlm") or eng.startswith("vlm"):
        return "vlm"
    if eng in ("template",):
        return "template"
    return eng


def preprocess_family(preprocess_name: str) -> str:
    """Coarse preprocess family for diagnostics (not a separate independence axis)."""
    base = (preprocess_name or "").split("+", 1)[0].strip().lower()
    if base.startswith("morph"):
        return "morph"
    if base in ("raw", ""):
        return "raw"
    if "chroma" in base or "ink" in base:
        return "chroma"
    if base.startswith("gray") or base in ("clahe", "bin"):
        return "mono"
    if "up" in base or "trim" in base:
        return "geometry"
    return base or "other"


def build_evidence_groups(
    weighed: list[tuple[str, str, float]],
    *,
    engine: str = "ddddocr",
) -> list[dict[str, Any]]:
    """F2-A: collapse readings into evidence groups.

    Each item in ``weighed`` is ``(preprocess_name, text, weight)``.
    """
    by_gid: dict[str, list[tuple[str, str, float]]] = {}
    for name, text, w in weighed:
        gid = evidence_group_id(name, engine=engine)
        by_gid.setdefault(gid, []).append((name, text, w))

    groups: list[dict[str, Any]] = []
    for gid, rows in by_gid.items():
        tallies: dict[str, float] = {}
        spells: dict[str, str] = {}
        for name, text, w in rows:
            fold = text.casefold()
            tallies[fold] = tallies.get(fold, 0.0) + w
            spells.setdefault(fold, text)
        support_fold = max(tallies, key=lambda k: (tallies[k], len(spells[k]), k))
        support = spells[support_fold]
        n_support = sum(1 for _, t, _ in rows if t.casefold() == support_fold)
        groups.append(
            {
                "id": gid,
                "engine": gid.split("_")[0] if gid else engine,
                "family": preprocess_family(rows[0][0]),
                "support": support,
                "supportFold": support_fold,
                "nVariants": len(rows),
                "nSupport": n_support,
                "weight": float(tallies[support_fold]),
                "totalWeight": float(sum(w for _, _, w in rows)),
                "variants": [n for n, _, _ in rows],
            }
        )
    return groups


def score_decorrelated_evidence(
    *,
    winner_fold: str,
    weighed: list[tuple[str, str, float]],
    votes: int,
    n_valid: int,
    n_try: int,
    weight_score: float,
    weight_share: float,
    singleton: bool,
    engine: str = "ddddocr",
) -> dict[str, Any]:
    """F2-A + F2-B: independentSources + evidence without treating variants as independent.

    ``votes`` / ``weightShare`` remain diagnostic of raw readings.
    ``evidenceScore`` is derived from independent groups (+ single-source cap).
    """
    groups = build_evidence_groups(weighed, engine=engine)
    n_groups = len(groups)
    supporting = [g for g in groups if g["supportFold"] == winner_fold]
    independent = len(supporting)
    correlated_votes = int(votes)
    if supporting:
        correlated_votes = max(int(g["nSupport"]) for g in supporting)

    if singleton or n_valid <= 1:
        evidence = float(weight_score) / max(float(n_try), 1.0)
        return {
            "weightScore": round(float(weight_score), 4),
            "weightShare": round(float(weight_share), 4),
            "votes": int(votes),
            "nValid": int(n_valid),
            "evidenceScore": round(evidence, 4),
            "singleton": True,
            "independentSources": 1 if n_valid == 1 else 0,
            "correlatedVotes": int(votes),
            "evidenceGroups": groups,
            "agreementScore": round(float(weight_share), 4),
        }

    if not decorrelate_enabled() or n_groups == 0:
        evidence = float(weight_share)
        return {
            "weightScore": round(float(weight_score), 4),
            "weightShare": round(float(weight_share), 4),
            "votes": int(votes),
            "nValid": int(n_valid),
            "evidenceScore": round(evidence, 4),
            "singleton": False,
            "independentSources": independent or 1,
            "correlatedVotes": correlated_votes,
            "evidenceGroups": groups,
            "agreementScore": round(float(weight_share), 4),
        }

    agreement = float(weight_share)
    if n_groups >= 2:
        evidence = float(independent) / float(n_groups)
    else:
        # Single engine family: agreement without +1 certainty per correlated variant.
        if correlated_votes >= 2:
            alpha = 0.35
            cap = 1.0 / math.sqrt(1.0 + (correlated_votes - 1) * alpha)
            evidence = agreement * cap
        else:
            evidence = agreement

    return {
        "weightScore": round(float(weight_score), 4),
        "weightShare": round(float(weight_share), 4),
        "votes": int(votes),
        "nValid": int(n_valid),
        "evidenceScore": round(float(evidence), 4),
        "singleton": False,
        "independentSources": int(independent),
        "correlatedVotes": int(correlated_votes),
        "evidenceGroups": groups,
        "agreementScore": round(float(agreement), 4),
    }
