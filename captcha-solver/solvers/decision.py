"""Decision layer: separate recognition evidence from submit-or-not.

S1 freeze (REQ_CAPTCHA_DECISION_SESSION):
  raw/model score ≠ agreement ≠ evidence ≠ decision score
  Never treat weightShare or singleton as P(correct).
"""
from __future__ import annotations

from typing import Any

DECISION_ACCEPT = "accept"
DECISION_ABSTAIN = "abstain"
DECISION_RETRY = "retry"


def _round4(x: float | None) -> float | None:
    if x is None:
        return None
    return round(float(x), 4)


def apply_decision(
    body: dict,
    *,
    decision: str,
    reason: str = "",
    decision_score: float | None = None,
) -> dict:
    """Stamp decision fields and map to Worker ``solved`` contract."""
    out = dict(body)
    d = (decision or DECISION_ABSTAIN).strip().lower()
    if d not in (DECISION_ACCEPT, DECISION_ABSTAIN, DECISION_RETRY):
        d = DECISION_ABSTAIN
    out["decision"] = d
    out["decisionReason"] = reason or str(out.get("decisionReason") or out.get("reason") or "")
    if decision_score is not None:
        out["decisionScore"] = _round4(decision_score)
        # Backward-compat: ``confidence`` mirrors decisionScore only (uncalibrated).
        out["confidence"] = _round4(decision_score)
    out["solved"] = d == DECISION_ACCEPT
    if not out["solved"]:
        out.setdefault("success", False)
        if not out.get("text"):
            out["text"] = ""
        if reason and not out.get("reason"):
            out["reason"] = reason
    else:
        out["reason"] = ""
        out["success"] = True
    return out


def evidence_from_votes(
    *,
    weight_score: float,
    weight_share: float,
    votes: int,
    n_valid: int,
    n_try: int,
    singleton: bool,
) -> dict[str, Any]:
    """Build evidence fields. weight_share is relative support, not probability."""
    # Singleton: independent evidence ≈ fraction of attempts that yielded a reading.
    # Never boost to 1.0 merely because LEN matched.
    if singleton:
        evidence = float(weight_score) / max(float(n_try), 1.0)
    else:
        evidence = float(weight_share)
    return {
        "weightScore": _round4(weight_score),
        "weightShare": _round4(weight_share),
        "votes": int(votes),
        "nValid": int(n_valid),
        "evidenceScore": _round4(evidence),
        "singleton": bool(singleton),
    }


def decide_ocr_candidate(hit: dict, *, threshold: float) -> dict:
    """ACCEPT iff evidenceScore ≥ threshold and F2-C correlated gate passes.

    Does not invent calibrated probability. ``confidence`` := decisionScore.
    """
    out = dict(hit)
    evidence = out.get("evidenceScore")
    if evidence is None:
        # Legacy path: fall back to weightShare, never invent 1.0.
        try:
            evidence = float(out.get("weightShare") if out.get("weightShare") is not None else out.get("confidence") or 0.0)
        except (TypeError, ValueError):
            evidence = 0.0
    evidence_f = float(evidence)
    out["evidenceScore"] = _round4(evidence_f)
    agreement = out.get("agreementScore", out.get("agreement"))
    agreement_f: float | None = None
    if agreement is not None:
        try:
            agreement_f = float(agreement)
            out["agreementScore"] = _round4(agreement_f)
        except (TypeError, ValueError):
            agreement_f = None
    if agreement_f is None:
        try:
            agreement_f = float(out.get("weightShare") or 0.0)
            out.setdefault("agreementScore", _round4(agreement_f))
        except (TypeError, ValueError):
            agreement_f = 0.0

    # F2-C: single independent source + multi correlated votes → require near-unanimous agreement.
    # Prevents partial preprocess pseudo-consensus (e.g. 3/5 → weightShare 0.6) from ACCEPT.
    try:
        independent = int(out.get("independentSources") if out.get("independentSources") is not None else 1)
    except (TypeError, ValueError):
        independent = 1
    try:
        votes = int(out.get("votes") or out.get("correlatedVotes") or 0)
    except (TypeError, ValueError):
        votes = 0

    reason_gate = ""
    if out.get("text") and independent < 2 and votes >= 2:
        from .evidence import correlated_min_agree, decorrelate_enabled

        if decorrelate_enabled():
            min_agree = float(correlated_min_agree())
            if agreement_f + 1e-9 < min_agree:
                reason_gate = "correlated_partial_agreement"

    # F2-D: singleton / single-vote is restricted evidence (opt-in; not a blanket ban).
    if out.get("text") and not reason_gate:
        from .evidence import singleton_accept_reason

        try:
            n_valid = int(out.get("nValid") if out.get("nValid") is not None else votes)
        except (TypeError, ValueError):
            n_valid = votes
        prefer_len = None
        try:
            from .ocr import preferred_len

            prefer_len = preferred_len()
        except Exception:  # noqa: BLE001
            prefer_len = None
        reason_gate = (
            singleton_accept_reason(
                votes=votes,
                n_valid=n_valid,
                singleton=bool(out.get("singleton")),
                evidence=evidence_f,
                text=str(out.get("text") or ""),
                prefer_len=prefer_len,
            )
            or ""
        )

    if out.get("text") and not reason_gate and evidence_f + 1e-9 >= float(threshold):
        return apply_decision(
            out,
            decision=DECISION_ACCEPT,
            reason="",
            decision_score=evidence_f,
        )
    reason = reason_gate or str(out.get("reason") or "ocr low evidence")
    out["text"] = ""
    return apply_decision(
        out,
        decision=DECISION_ABSTAIN,
        reason=reason,
        decision_score=evidence_f,
    )


def decide_vlm_candidate(vlm: dict, *, after_primary_abstain: bool) -> dict:
    """VLM is uncalibrated. ACCEPT only as T1 rescue when primary abstained and text exists."""
    out = dict(vlm)
    out["modelScoreUncalibrated"] = True
    # Strip any fabricated calibrated confidence from the model adapter.
    out.pop("confidence", None)
    text = str(out.get("text") or "").strip()
    if after_primary_abstain and out.get("solved") is not False and text:
        out["text"] = text
        return apply_decision(
            out,
            decision=DECISION_ACCEPT,
            reason="vlm after primary abstain",
            decision_score=None,
        )
    return apply_decision(
        out,
        decision=DECISION_ABSTAIN,
        reason=str(out.get("reason") or "vlm not accepted"),
        decision_score=None,
    )
