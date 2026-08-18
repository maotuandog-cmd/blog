"""E1-A Character Evidence — observation only (does not change Decision).

REQ §18 E1-A:
  Expose per-character confidence / alternatives from ddddocr probability mode.
  Never mutate decisionScore / confidence / accept|abstain.
"""
from __future__ import annotations

import os
from typing import Any


def char_evidence_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_CHAR_EVIDENCE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.charEvidence", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def _unwrap_dist(row: object) -> list[float] | None:
    """ddddocr returns probabilities as list[list[list[float]]] (pos → [dist])."""
    if not isinstance(row, list) or not row:
        return None
    inner = row[0] if isinstance(row[0], list) else row
    if not isinstance(inner, list) or not inner:
        return None
    if isinstance(inner[0], (int, float)):
        try:
            return [float(x) for x in inner]
        except (TypeError, ValueError):
            return None
    if isinstance(inner[0], list) and inner[0] and isinstance(inner[0][0], (int, float)):
        try:
            return [float(x) for x in inner[0]]
        except (TypeError, ValueError):
            return None
    return None


def parse_dddd_probability(
    payload: dict,
    *,
    text_hint: str | None = None,
    top_k: int = 3,
    ambiguous_gap: float = 0.15,
    low_conf: float = 0.5,
) -> dict[str, Any]:
    """Convert ddddocr ``classification(..., probability=True)`` dict → charEvidence."""
    charset = payload.get("charset") or []
    probs = payload.get("probabilities") or []
    model_text = str(payload.get("text") or "")
    model_conf = payload.get("confidence")
    try:
        model_conf_f = float(model_conf) if model_conf is not None else None
    except (TypeError, ValueError):
        model_conf_f = None

    slots: list[dict[str, Any]] = []
    for row in probs:
        dist = _unwrap_dist(row)
        if dist is None or not charset:
            continue
        n = min(len(dist), len(charset))
        ranked: list[tuple[float, str]] = []
        for i in range(n):
            ch = charset[i]
            # Blank / padding token — skip dominant blanks when collecting glyphs.
            ranked.append((float(dist[i]), str(ch)))
        ranked.sort(key=lambda x: (-x[0], x[1]))
        if not ranked:
            continue
        top_p, top_c = ranked[0]
        if top_c == "":
            continue
        alts: list[dict[str, Any]] = []
        for p, c in ranked[1:]:
            if not c:
                continue
            alts.append({"char": c, "score": round(float(p), 4)})
            if len(alts) >= top_k:
                break
        gap = None
        if alts:
            gap = round(float(top_p) - float(alts[0]["score"]), 4)
        ambiguous = bool(alts and gap is not None and gap <= ambiguous_gap)
        slots.append(
            {
                "char": top_c,
                "position": len(slots),
                "confidence": round(float(top_p), 4),
                "alternatives": alts,
                "ambiguous": ambiguous,
                "margin": gap,
            }
        )

    hint = (text_hint or "").strip()
    aligned = True
    if hint:
        # Prefer aligning to decision text (case-insensitive) when lengths match.
        model_join = "".join(s["char"] for s in slots)
        if len(slots) == len(hint):
            for i, ch in enumerate(hint):
                slots[i]["char"] = ch  # keep decision spelling; confidence from model slot
                slots[i]["modelChar"] = model_join[i] if i < len(model_join) else None
        elif model_join and model_join.casefold() == hint.casefold():
            for i, ch in enumerate(hint):
                if i < len(slots):
                    slots[i]["char"] = ch
        else:
            aligned = False

    confs = [float(s["confidence"]) for s in slots]
    low_pos = [int(s["position"]) for s in slots if float(s["confidence"]) < low_conf]
    amb_pos = [int(s["position"]) for s in slots if s.get("ambiguous")]
    summary = {
        "charCount": len(slots),
        "charMinConfidence": round(min(confs), 4) if confs else None,
        "charMeanConfidence": round(sum(confs) / len(confs), 4) if confs else None,
        "lowConfidencePositions": low_pos,
        "ambiguousPositions": amb_pos,
        "ambiguousCount": len(amb_pos),
        "alignedToDecisionText": aligned,
        "modelText": model_text or None,
        "modelConfidence": round(model_conf_f, 4) if model_conf_f is not None else None,
        "lowConfThreshold": low_conf,
        "ambiguousGap": ambiguous_gap,
    }
    return {
        "characterEvidence": slots,
        "charSummary": summary,
    }


def weak_char_pattern(summary: dict | None, evidence: list | None = None) -> dict[str, Any]:
    """Diagnostic flags for E1-A FA analysis (observation only)."""
    summary = summary or {}
    evidence = evidence or []
    char_min = summary.get("charMinConfidence")
    amb = int(summary.get("ambiguousCount") or 0)
    low_n = len(summary.get("lowConfidencePositions") or [])
    flags = []
    if char_min is not None and float(char_min) < 0.5:
        flags.append("low_char_min")
    if amb > 0:
        flags.append("ambiguous_chars")
    if low_n > 0:
        flags.append("low_char_positions")
    return {
        "weakCharEvidence": bool(flags),
        "flags": flags,
        "charMinConfidence": char_min,
        "ambiguousCount": amb,
        "lowConfidenceCount": low_n,
        "detail": [
            {
                "position": e.get("position"),
                "char": e.get("char"),
                "confidence": e.get("confidence"),
                "alternatives": e.get("alternatives"),
            }
            for e in evidence
            if e.get("ambiguous") or (e.get("confidence") is not None and float(e["confidence"]) < 0.5)
        ],
    }
