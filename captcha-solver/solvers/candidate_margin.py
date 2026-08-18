"""E1-B Candidate margin — observation only (does not change Decision).

REQ §18 E1-B:
  Expose top1 / top2 string candidates and gap (vote-share margin).
  Optionally derive a char-swap runner-up from characterEvidence.
  Never mutate decisionScore / confidence / accept|abstain.
"""
from __future__ import annotations

import os
from typing import Any


def candidate_margin_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_CANDIDATE_MARGIN") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.candidateMargin", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def rank_vote_candidates(
    weighed: list[tuple[str, str, float]],
    *,
    prefer_len: int | None = None,
) -> list[dict[str, Any]]:
    """Rank distinct spellings by weighted support (observation ranking, not Decision)."""
    if not weighed:
        return []
    total_w = sum(w for _, _, w in weighed) or 1e-9
    groups: dict[str, list[tuple[str, str, float]]] = {}
    for name, text, w in weighed:
        groups.setdefault(text.casefold(), []).append((name, text, w))

    ranked: list[dict[str, Any]] = []
    for fold, bucket in groups.items():
        sample = bucket[0][1]
        score = sum(w for _, _, w in bucket)
        ranked.append(
            {
                "text": sample,
                "fold": fold,
                "score": round(score / total_w, 4),
                "weightScore": round(float(score), 4),
                "votes": len(bucket),
                "lenMatch": (prefer_len is not None and len(sample) == prefer_len),
                "preprocess": bucket[0][0],
            }
        )

    def sort_key(item: dict[str, Any]) -> tuple:
        return (
            1 if item.get("lenMatch") else 0,
            float(item.get("score") or 0.0),
            int(item.get("votes") or 0),
            len(str(item.get("text") or "")),
            str(item.get("fold") or ""),
        )

    ranked.sort(key=sort_key, reverse=True)
    for i, item in enumerate(ranked):
        item["rank"] = i + 1
    return ranked


def vote_margin_fields(
    weighed: list[tuple[str, str, float]],
    *,
    prefer_len: int | None = None,
    tight_gap: float = 0.15,
) -> dict[str, Any]:
    """Build top1/top2 / candidateMargin from vote groups."""
    ranked = rank_vote_candidates(weighed, prefer_len=prefer_len)
    if not ranked:
        return {
            "candidateRanking": [],
            "runnerUpText": None,
            "runnerUpScore": None,
            "candidateMargin": None,
            "candidateMarginKind": "none",
            "tightCandidateMargin": False,
        }
    top1 = ranked[0]
    top2 = ranked[1] if len(ranked) > 1 else None
    margin = None
    if top2 is not None:
        margin = round(float(top1["score"]) - float(top2["score"]), 4)
    else:
        # Unique spelling among readings — margin undefined / full separation.
        margin = 1.0
    return {
        "candidateRanking": ranked[:5],
        "topCandidateText": top1.get("text"),
        "topCandidateScore": top1.get("score"),
        "runnerUpText": top2.get("text") if top2 else None,
        "runnerUpScore": top2.get("score") if top2 else None,
        "candidateMargin": margin,
        "candidateMarginKind": "vote_share",
        "tightCandidateMargin": bool(top2 is not None and margin is not None and margin <= tight_gap),
        "tightMarginThreshold": tight_gap,
    }


def char_swap_runner_up(
    text: str,
    character_evidence: list[dict] | None,
) -> dict[str, Any]:
    """Build an alternate spelling by swapping the weakest/ambiguous char.

    Observation aid complementary to vote-share margin; does not affect Decision.
    """
    text = str(text or "")
    evidence = [e for e in (character_evidence or []) if isinstance(e, dict)]
    if not text or not evidence:
        return {
            "charRunnerUpText": None,
            "charRunnerUpFromPosition": None,
            "charMinMargin": None,
            "charRunnerUpAlt": None,
        }

    # Prefer ambiguous with smallest margin; else lowest confidence with alternatives.
    def weakness(e: dict) -> tuple:
        conf = float(e.get("confidence") or 0.0)
        margin = e.get("margin")
        try:
            m = float(margin) if margin is not None else 1.0
        except (TypeError, ValueError):
            m = 1.0
        amb = 1 if e.get("ambiguous") else 0
        has_alt = 1 if e.get("alternatives") else 0
        return (amb, -m, -conf, has_alt)

    # Only consider slots with alternatives.
    with_alts = [e for e in evidence if e.get("alternatives")]
    if not with_alts:
        margins = []
        for e in evidence:
            if e.get("margin") is not None:
                try:
                    margins.append(float(e["margin"]))
                except (TypeError, ValueError):
                    pass
        return {
            "charRunnerUpText": None,
            "charRunnerUpFromPosition": None,
            "charMinMargin": round(min(margins), 4) if margins else None,
            "charRunnerUpAlt": None,
        }

    weakest = sorted(with_alts, key=lambda e: (float(e.get("margin") if e.get("margin") is not None else 1.0), float(e.get("confidence") or 0.0)))[0]
    pos = int(weakest.get("position") or 0)
    alt = (weakest.get("alternatives") or [{}])[0]
    alt_ch = str(alt.get("char") or "")
    chars = list(text)
    if 0 <= pos < len(chars) and alt_ch:
        chars[pos] = alt_ch
        runner = "".join(chars)
    else:
        runner = None
    margins = []
    for e in evidence:
        if e.get("margin") is not None:
            try:
                margins.append(float(e["margin"]))
            except (TypeError, ValueError):
                pass
    return {
        "charRunnerUpText": runner if runner and runner != text else None,
        "charRunnerUpFromPosition": pos,
        "charMinMargin": round(min(margins), 4) if margins else None,
        "charRunnerUpAlt": {"char": alt_ch, "score": alt.get("score"), "vs": weakest.get("char")} if alt_ch else None,
    }


def tight_margin_pattern(
    *,
    candidate_margin: float | None,
    tight: bool | None = None,
    tight_gap: float = 0.15,
    char_min_margin: float | None = None,
) -> dict[str, Any]:
    """Diagnostic flags for E1-B FA analysis."""
    flags: list[str] = []
    is_tight = bool(tight) if tight is not None else (
        candidate_margin is not None and float(candidate_margin) <= tight_gap
    )
    if is_tight and candidate_margin is not None and float(candidate_margin) < 0.999:
        flags.append("tight_vote_margin")
    if char_min_margin is not None and float(char_min_margin) <= tight_gap:
        flags.append("tight_char_margin")
    return {
        "tightMarginEvidence": bool(flags),
        "flags": flags,
        "candidateMargin": candidate_margin,
        "charMinMargin": char_min_margin,
    }
