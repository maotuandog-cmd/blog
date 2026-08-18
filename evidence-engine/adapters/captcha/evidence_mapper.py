"""Map captcha character / agreement fields → Evidence items."""
from __future__ import annotations

from typing import Any

from core.evidence import Evidence, quality_from_score


def map_evidences(result: dict[str, Any] | None, *, primary_candidate_id: str | None = None) -> list[Evidence]:
    """Map char evidence + independent agree bonus signals (evidence only, never Decision)."""
    result = result or {}
    cid = primary_candidate_id or "ocr-primary"
    out: list[Evidence] = []

    char_min = result.get("charMinConfidence")
    if char_min is None and isinstance(result.get("charSummary"), dict):
        char_min = result["charSummary"].get("charMinConfidence")
    char_margin = result.get("charMinMargin")
    char_mean = result.get("charMeanConfidence")
    if char_mean is None and isinstance(result.get("charSummary"), dict):
        char_mean = result["charSummary"].get("charMeanConfidence")

    try:
        char_min_f = float(char_min) if char_min is not None else None
    except (TypeError, ValueError):
        char_min_f = None
    try:
        char_margin_f = float(char_margin) if char_margin is not None else None
    except (TypeError, ValueError):
        char_margin_f = None
    try:
        char_mean_f = float(char_mean) if char_mean is not None else None
    except (TypeError, ValueError):
        char_mean_f = None

    if char_min_f is not None:
        meta: dict[str, Any] = {}
        if char_margin_f is not None:
            meta["charMinMargin"] = char_margin_f
        if char_mean_f is not None:
            meta["charMeanConfidence"] = char_mean_f
        if result.get("charAmbiguousCount") is not None:
            meta["ambiguousCount"] = result.get("charAmbiguousCount")
        # Preserve raw characterEvidence reference count if present
        ce = result.get("characterEvidence")
        if isinstance(ce, list):
            meta["charEvidenceLen"] = len(ce)
        out.append(
            Evidence(
                candidate_id=cid,
                type="char_confidence",
                score=char_min_f,
                quality=quality_from_score(char_min_f),
                metadata=meta,
            )
        )

    if char_margin_f is not None:
        out.append(
            Evidence(
                candidate_id=cid,
                type="char_margin",
                score=char_margin_f,
                quality=quality_from_score(char_margin_f, high=0.25, medium=0.12),
                metadata={"charMinMargin": char_margin_f},
            )
        )

    # Vote / candidate margin (observation)
    vote_margin = result.get("candidateMargin")
    try:
        vote_margin_f = float(vote_margin) if vote_margin is not None else None
    except (TypeError, ValueError):
        vote_margin_f = None
    if vote_margin_f is not None and vote_margin_f < 0.999:
        out.append(
            Evidence(
                candidate_id=cid,
                type="candidate_margin",
                score=vote_margin_f,
                quality=quality_from_score(vote_margin_f, high=0.3, medium=0.15),
                metadata={
                    "runnerUpText": result.get("runnerUpText"),
                    "tightCandidateMargin": bool(result.get("tightCandidateMargin")),
                },
            )
        )

    # independentAgree as evidence signal (not accept)
    if result.get("independentAgree") is True:
        out.append(
            Evidence(
                candidate_id=cid,
                type="independent_agreement",
                score=1.0,
                quality="high",
                metadata={
                    "secondarySource": result.get("secondarySource"),
                    "comparisonStatus": result.get("comparisonStatus") or "agree",
                },
            )
        )

    # Agree bonus adjustment is evidence of soft boost application, not a decision.
    adj = result.get("evidenceAdjustment")
    if isinstance(adj, dict) and adj.get("independentAgreeBonus"):
        bonus = adj.get("agreeBonus")
        try:
            bonus_f = float(bonus) if bonus is not None else None
        except (TypeError, ValueError):
            bonus_f = None
        out.append(
            Evidence(
                candidate_id=cid,
                type="independent_agree_bonus",
                score=bonus_f if bonus_f is not None else 1.0,
                quality="medium",
                metadata={
                    "applied": bool(adj.get("applied")),
                    "evidenceScoreRaw": result.get("evidenceScoreRaw"),
                    "evidenceScoreAdjusted": result.get("evidenceScoreAdjusted"),
                },
            )
        )

    return out
