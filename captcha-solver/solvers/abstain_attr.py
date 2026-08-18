"""A0 Abstain Attribution — observation only (does not change Decision).

Splits coarse ``ocr low confidence`` into actionable buckets for A1/A2/A3.
"""
from __future__ import annotations

import threading
from typing import Any

_PROBE = threading.local()

# Exclusive report buckets (priority order applied in ``bucket_for``).
BUCKET_NO_READING = "NO_READING"
BUCKET_CORRELATED_GATE = "CORRELATED_GATE"
BUCKET_LOW_CONFIDENCE = "LOW_CONFIDENCE"
BUCKET_SINGLE_SOURCE = "SINGLE_SOURCE"
BUCKET_SECONDARY_MISSING = "SECONDARY_MISSING"
BUCKET_BELOW_THRESHOLD = "BELOW_THRESHOLD"
BUCKET_OTHER = "OTHER"


def clear_abstain_probe() -> None:
    if hasattr(_PROBE, "value"):
        delattr(_PROBE, "value")


def store_abstain_probe(probe: dict[str, Any] | None) -> None:
    _PROBE.value = probe


def get_abstain_probe() -> dict[str, Any] | None:
    return getattr(_PROBE, "value", None)


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def build_abstain_reason_detail(
    candidate: dict[str, Any] | None,
    decided: dict[str, Any] | None = None,
    *,
    threshold: float | None = None,
    raw_readings: int | None = None,
) -> dict[str, Any]:
    """Build structured abstain attribution from pre-decision candidate + decide output."""
    cand = dict(candidate or {})
    dec = dict(decided or {})
    text = str(cand.get("text") or "").strip()
    evidence = _f(cand.get("evidenceScoreAdjusted") if cand.get("evidenceScoreAdjusted") is not None else cand.get("evidenceScore"))
    if evidence is None:
        evidence = _f(dec.get("evidenceScore"))
    agreement = _f(cand.get("agreementScore") if cand.get("agreementScore") is not None else cand.get("weightShare"))
    votes = _i(cand.get("votes")) or 0
    n_valid = _i(cand.get("nValid"))
    if n_valid is None:
        n_valid = votes
    independent = _i(cand.get("independentSources"))
    if independent is None:
        independent = 1
    char_min = _f(cand.get("charMinConfidence"))
    if char_min is None and isinstance(cand.get("charSummary"), dict):
        char_min = _f(cand["charSummary"].get("charMinConfidence"))

    decision_reason = str(dec.get("decisionReason") or dec.get("reason") or cand.get("reason") or "")

    # --- primary ---
    if not text and (raw_readings is not None and raw_readings <= 0):
        primary = "NO_READING"
    elif not text:
        primary = "NO_CANDIDATE_TEXT"
    elif char_min is not None and char_min < 0.35:
        primary = "LOW_CONFIDENCE"
    elif evidence is not None and threshold is not None and evidence + 1e-9 < float(threshold):
        primary = "HAS_CANDIDATE_WEAK_EVIDENCE"
    else:
        primary = "HAS_CANDIDATE"

    # --- secondary ---
    if cand.get("independentAgree") is True:
        secondary = "AGREE"
    elif cand.get("independentConflict") is True:
        secondary = "CONFLICT"
    elif str(cand.get("comparisonStatus") or "") == "incomparable":
        secondary = "INCOMPARABLE"
    elif cand.get("secondaryAvailable") is False or cand.get("sourceUnavailable") is True:
        secondary = "NOT_AVAILABLE"
    elif cand.get("secondaryText"):
        secondary = "PRESENT_NOT_AGREE"
    elif "secondaryAvailable" in cand or "independentEvidence" in cand:
        secondary = "NOT_AVAILABLE"
    else:
        secondary = "UNKNOWN"

    # --- vote ---
    if n_valid <= 0 and not text:
        vote = "NO_VOTES"
    elif votes <= 1 and n_valid <= 1:
        vote = "SINGLE_SOURCE"
    elif votes <= 1 and n_valid >= 2:
        vote = "LONE_SUPPORTER"
    elif agreement is not None and agreement + 1e-9 >= 0.999:
        vote = "MULTI_UNANIMOUS"
    elif votes >= 2:
        vote = "MULTI_PARTIAL"
    else:
        vote = "SINGLE_SOURCE"

    # --- gate ---
    if "correlated_partial_agreement" in decision_reason:
        gate = "CORRELATED_EVIDENCE_BLOCK"
    elif "singleton" in decision_reason:
        gate = "SINGLETON_GATE"
    elif evidence is not None and threshold is not None and evidence + 1e-9 < float(threshold):
        gate = "BELOW_THRESHOLD"
    elif decision_reason in ("ocr low confidence", "ocr low evidence"):
        gate = "BELOW_THRESHOLD"
    else:
        gate = "NONE" if text and evidence is not None and threshold is not None and evidence >= float(threshold) else "OTHER"

    detail = {
        "primary": primary,
        "secondary": secondary,
        "vote": vote,
        "gate": gate,
        "decisionReason": decision_reason or None,
        "threshold": round(float(threshold), 4) if threshold is not None else None,
        "evidenceScore": round(evidence, 4) if evidence is not None else None,
        "agreementScore": round(agreement, 4) if agreement is not None else None,
        "votes": votes,
        "nValid": n_valid,
        "independentSources": independent,
        "charMinConfidence": round(char_min, 4) if char_min is not None else None,
        "candidateText": text or None,
        "comparisonStatus": cand.get("comparisonStatus"),
        "secondaryAvailable": cand.get("secondaryAvailable"),
        "observationOnly": True,
    }
    detail["bucket"] = bucket_for(detail)
    return detail


def bucket_for(detail: dict[str, Any] | None) -> str:
    """Exclusive high-level bucket for A0 distribution reports."""
    d = detail or {}
    primary = str(d.get("primary") or "")
    secondary = str(d.get("secondary") or "")
    vote = str(d.get("vote") or "")
    gate = str(d.get("gate") or "")

    if primary in ("NO_READING", "NO_CANDIDATE_TEXT") or vote == "NO_VOTES":
        return BUCKET_NO_READING
    if gate == "CORRELATED_EVIDENCE_BLOCK":
        return BUCKET_CORRELATED_GATE
    if primary == "LOW_CONFIDENCE":
        return BUCKET_LOW_CONFIDENCE
    if vote in ("SINGLE_SOURCE", "LONE_SUPPORTER"):
        return BUCKET_SINGLE_SOURCE
    if secondary in ("NOT_AVAILABLE", "INCOMPARABLE", "UNKNOWN", "PRESENT_NOT_AGREE"):
        # Candidate existed but secondary did not strengthen — type D-ish
        if d.get("candidateText"):
            return BUCKET_SECONDARY_MISSING
    if gate == "BELOW_THRESHOLD" or primary == "HAS_CANDIDATE_WEAK_EVIDENCE":
        return BUCKET_BELOW_THRESHOLD
    return BUCKET_OTHER


def merge_probe_into_result(result: dict[str, Any]) -> dict[str, Any]:
    """Attach stored fuse abstain probe onto solver result (observation only)."""
    out = dict(result)
    probe = get_abstain_probe()
    if not probe:
        return out
    if out.get("decision") == "accept" or out.get("solved"):
        return out
    detail = probe.get("abstainReasonDetail")
    if isinstance(detail, dict):
        out["abstainReasonDetail"] = detail
        out["abstainBucket"] = detail.get("bucket")
    if probe.get("abstainCandidateText") and not out.get("abstainCandidateText"):
        out["abstainCandidateText"] = probe.get("abstainCandidateText")
    # Diagnostic mirrors (do not revive submit text)
    for key in (
        "evidenceScore",
        "evidenceScoreRaw",
        "evidenceScoreAdjusted",
        "agreementScore",
        "weightShare",
        "votes",
        "nValid",
        "independentSources",
        "correlatedVotes",
        "singleton",
        "preprocess",
        "independentAgree",
        "independentConflict",
        "secondaryAvailable",
        "secondaryText",
        "secondarySource",
        "comparisonStatus",
        "comparisonReason",
        "secondaryComparison",
        "sourceAgreement",
        "charMinConfidence",
        "charMinMargin",
        "decisionReason",
    ):
        if key not in out or out.get(key) is None:
            if probe.get(key) is not None:
                out[key] = probe.get(key)
    return out
