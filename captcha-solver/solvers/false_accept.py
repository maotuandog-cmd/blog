"""F1 False-ACCEPT Attribution — diagnose why an ACCEPT was wrong.

Freeze (REQ §16 F1):
  Only attribute ACCEPT + verify outcome; do not change OCR / Decision / S4 / Profile.
  Distinguishes false-accept classes from abstain/timeout/solver-failure.
"""
from __future__ import annotations

from typing import Any

# Closed set (v1) — aligned to REQ §16 F1 freeze
SINGLETON_ACCEPT = "SINGLETON_ACCEPT"
WEAK_EVIDENCE = "WEAK_EVIDENCE"
CORRELATED_VOTES = "CORRELATED_VOTES"
CANDIDATE_AMBIGUITY = "CANDIDATE_AMBIGUITY"
WRONG_KIND = "WRONG_KIND"
GEOMETRY_FALSE_POSITIVE = "GEOMETRY_FALSE_POSITIVE"
MODEL_CONFLICT = "MODEL_CONFLICT"
OTHER = "OTHER"
UNATTRIBUTABLE = "UNATTRIBUTABLE"

# Legacy aliases (same semantics)
OCR_CORRELATED_VOTES = CORRELATED_VOTES
WEAK_EVIDENCE_ACCEPT = WEAK_EVIDENCE
MODEL_CONFLICT_ACCEPT = MODEL_CONFLICT
WRONG_KIND_ACCEPT = WRONG_KIND
GEOMETRY_FALLBACK_ACCEPT = GEOMETRY_FALSE_POSITIVE

CLOSED_SET = (
    SINGLETON_ACCEPT,
    WEAK_EVIDENCE,
    CORRELATED_VOTES,
    CANDIDATE_AMBIGUITY,
    WRONG_KIND,
    GEOMETRY_FALSE_POSITIVE,
    MODEL_CONFLICT,
    OTHER,
    UNATTRIBUTABLE,
)

# Not false-accept (execution / decision failures)
NOT_FALSE_ACCEPT = frozenset(
    {"abstain", "not_executed", "timeout", "unknown", "unsupported", "retry"}
)


def _f(val: object, default: float | None = None) -> float | None:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _candidates(result: dict) -> list[dict]:
    obs = result.get("observation") if isinstance(result.get("observation"), dict) else {}
    cands = obs.get("candidates") or result.get("candidates") or []
    return [c for c in cands if isinstance(c, dict)]


def _distinct_values(cands: list[dict]) -> list[str]:
    seen: list[str] = []
    for c in cands:
        v = str(c.get("value") or c.get("text") or "").strip()
        if not v:
            continue
        key = v.casefold()
        if key not in {x.casefold() for x in seen}:
            seen.append(v)
    return seen


def is_accept(result: dict) -> bool:
    action = str(result.get("decision") or "").strip().lower()
    if action == "accept":
        return True
    if action == "abstain":
        return False
    return bool(result.get("solved") and (result.get("text") or result.get("offsetX") is not None or result.get("points")))


def feedback_status(feedback: dict | None) -> str:
    if not feedback:
        return ""
    return str(feedback.get("status") or "").strip().lower()


def attribute_accept(
    result: dict,
    *,
    feedback: dict | None = None,
    min_conf: float = 0.5,
) -> dict[str, Any]:
    """Attribute an ACCEPT attempt. Does not mutate decision fields.

    Returns falseAccept block. If not an ACCEPT, attributed=false and class explains skip.
    """
    fb = feedback or {}
    status = feedback_status(fb)
    base = {
        "attributed": False,
        "isFalseAccept": False,
        "verifyStatus": status or None,
        "class": None,
        "secondary": [],
        "evidence": {},
        "sessionId": result.get("sessionId"),
        "attemptId": result.get("attemptId"),
    }

    if not is_accept(result):
        base["class"] = "NOT_ACCEPT"
        base["skipReason"] = "decision_not_accept"
        return base

    if status in ("not_executed",):
        base["class"] = "NOT_FALSE_ACCEPT"
        base["skipReason"] = "not_executed"
        return base
    if status in ("unknown",) and "timeout" in str(fb.get("reason") or "").lower():
        base["class"] = "NOT_FALSE_ACCEPT"
        base["skipReason"] = "timeout"
        return base

    # ACCEPT with success or failed or missing verify — still classify mechanism
    obs = result.get("observation") if isinstance(result.get("observation"), dict) else {}
    cands = _candidates(result)
    distinct = _distinct_values(cands)
    votes = int(result.get("votes") or obs.get("votes") or 0)
    n_valid = int(result.get("nValid") or obs.get("nValid") or 0)
    singleton = bool(result.get("singleton") if result.get("singleton") is not None else obs.get("singleton"))
    evidence = _f(result.get("evidenceScore") or obs.get("evidenceScore") or result.get("decisionScore") or result.get("confidence"))
    weight_share = _f(result.get("weightShare") or obs.get("weightShare"))
    agreement = _f(result.get("agreementScore") or result.get("agreement") or obs.get("agreementScore"))
    kind = str(result.get("kind") or result.get("classifiedAs") or obs.get("captchaKind") or "")
    classified = str(result.get("classifiedAs") or (obs.get("classifier") or {}).get("kind") or kind)
    class_score = _f(result.get("classifierConfidence") or (obs.get("classifier") or {}).get("score"))
    engine = str(result.get("engine") or "")
    vlm_conflict = bool(result.get("vlmConflict") or obs.get("vlmConflict"))
    dddd_txt = str(result.get("ddddText") or "").strip()
    vlm_txt = str(result.get("vlmText") or "").strip()

    evidence_block = {
        "votes": votes or None,
        "nValid": n_valid or None,
        "singleton": singleton,
        "evidenceScore": evidence,
        "weightShare": weight_share,
        "agreementScore": agreement,
        "decisionScore": _f(result.get("decisionScore") or result.get("confidence")),
        "kind": kind or None,
        "classifiedAs": classified or None,
        "classifierScore": class_score,
        "engine": engine or None,
        "preprocess": result.get("preprocess"),
        "candidateValues": distinct[:8],
        "candidateCount": len(cands),
        "vlmConflict": vlm_conflict,
        "ddddText": dddd_txt or None,
        "vlmText": vlm_txt or None,
        "text": str(result.get("text") or "")[:32] or None,
    }

    hits: list[str] = []

    if vlm_conflict or (dddd_txt and vlm_txt and dddd_txt.casefold() != vlm_txt.casefold()):
        # Accepted despite conflict — gate leak
        hits.append(MODEL_CONFLICT)

    if kind in ("slider", "click") or engine in ("slider", "click"):
        hits.append(GEOMETRY_FALSE_POSITIVE)

    req_kind = str(result.get("requestedKind") or obs.get("input", {}).get("kind") or "")
    if req_kind and req_kind not in ("auto", "") and classified and classified != req_kind:
        hits.append(WRONG_KIND)
    elif class_score is not None and class_score < 0.35 and classified:
        hits.append(WRONG_KIND)

    if len(distinct) >= 2:
        hits.append(CANDIDATE_AMBIGUITY)

    if singleton or votes == 1 or (n_valid == 1 and votes <= 1):
        hits.append(SINGLETON_ACCEPT)

    # Correlated multi-variant consensus: multi-preprocess votes from one engine family
    # Prefer independentSources when present (F2); else fall back to raw votes.
    try:
        ind = result.get("independentSources")
        if ind is None and isinstance(obs, dict):
            ind = obs.get("independentSources")
        ind_i = int(ind) if ind is not None else None
    except (TypeError, ValueError):
        ind_i = None
    if ind_i is not None:
        if ind_i <= 1 and votes >= 2:
            hits.append(CORRELATED_VOTES)
    elif votes >= 2 or (weight_share is not None and weight_share >= 0.75):
        if "dddd" in engine or engine in ("ddddocr", "ddddocr+vlm7b", "template", ""):
            hits.append(CORRELATED_VOTES)

    if evidence is not None and evidence + 1e-9 < (min_conf + 0.15):
        # barely over gate
        if evidence + 1e-9 >= min_conf - 1e-9:
            hits.append(WEAK_EVIDENCE)
    elif evidence is not None and min_conf <= evidence < 0.7:
        hits.append(WEAK_EVIDENCE)

    if agreement is not None and 0 <= agreement < 1.0:
        hits.append(WEAK_EVIDENCE)

    # Priority pick
    priority = [
        MODEL_CONFLICT,
        GEOMETRY_FALSE_POSITIVE,
        WRONG_KIND,
        CANDIDATE_AMBIGUITY,
        SINGLETON_ACCEPT,
        CORRELATED_VOTES,
        WEAK_EVIDENCE,
    ]
    primary = None
    for p in priority:
        if p in hits:
            primary = p
            break
    if primary is None:
        # Incomplete observation (common when only final-attempt fields survive) → unattributable
        if (votes <= 0 and not cands and (evidence is None or evidence == 0.0)
                and not singleton and weight_share is None):
            primary = UNATTRIBUTABLE
        else:
            primary = OTHER if is_accept(result) else UNATTRIBUTABLE

    secondary = [h for h in hits if h != primary]

    is_fa = status == "failed"
    # Also treat verifyMessage wrong without status
    if not status and result.get("firstDecision") == "wrong":
        is_fa = True
        status = "failed"

    out = {
        **base,
        "attributed": True,
        "isFalseAccept": is_fa,
        "verifyStatus": status or None,
        "class": primary,
        "secondary": secondary,
        "evidence": evidence_block,
        "decision": {
            "action": "accept",
            "decisionScore": evidence_block.get("decisionScore"),
            "decisionReason": result.get("decisionReason") or result.get("reason") or "",
        },
        "feedback": {"status": status or None, "reason": fb.get("reason")},
    }
    return out


# Alias kept for docs; folded into WEAK_EVIDENCE in v1 closed set.
LOW_AGREEMENT_ACCEPT = "LOW_AGREEMENT_ACCEPT"


def summarize_attributions(rows: list[dict]) -> dict[str, Any]:
    """Aggregate acceptCount / acceptFailed / falseAcceptRate per class."""
    by: dict[str, dict[str, int]] = {c: {"acceptCount": 0, "acceptFailed": 0} for c in CLOSED_SET}
    skipped = 0
    for row in rows:
        fa = row.get("falseAccept") if isinstance(row.get("falseAccept"), dict) else None
        if not fa or not fa.get("attributed"):
            skipped += 1
            continue
        cls = str(fa.get("class") or UNATTRIBUTABLE)
        if cls not in by:
            by[cls] = {"acceptCount": 0, "acceptFailed": 0}
        by[cls]["acceptCount"] += 1
        if fa.get("isFalseAccept"):
            by[cls]["acceptFailed"] += 1

    table = []
    for cls in list(CLOSED_SET) + [c for c in by if c not in CLOSED_SET]:
        if cls not in by:
            continue
        a = by[cls]["acceptCount"]
        f = by[cls]["acceptFailed"]
        if a == 0:
            continue
        table.append(
            {
                "class": cls,
                "acceptCount": a,
                "acceptFailed": f,
                "falseAcceptRate": round(f / a, 4) if a else None,
                "shareOfFalseAccepts": None,  # filled below
            }
        )
    total_fa = sum(x["acceptFailed"] for x in table)
    for x in table:
        x["shareOfFalseAccepts"] = round(x["acceptFailed"] / total_fa, 4) if total_fa else 0.0
    table.sort(key=lambda x: (-x["acceptFailed"], -x["acceptCount"]))
    return {
        "totalAttributedAccepts": sum(x["acceptCount"] for x in table),
        "totalFalseAccepts": total_fa,
        "skippedRows": skipped,
        "byClass": table,
        "topClass": table[0]["class"] if table else None,
    }
