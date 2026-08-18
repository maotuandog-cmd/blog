"""P2.1 Visual candidate Fusion — simple & explainable (shadow by default).

Rules (v1):
  1. length must be in allowed_lengths (when any candidate has length)
  2. per-position majority among definite chars
  3. agreement = agreeing sources / participating sources
  4. conflict at a position without majority → RETRY/ABSTAIN (no forced guess)
  5. uncertain glyphs (?, *, ., empty) do not vote against a definite majority

S0 never gates. Fusion does not use complex weighted scores in v1.
"""
from __future__ import annotations

import os
import re
from typing import Any

from .s0_baseline import allowed_lengths

_UNCERTAIN = set("?*·._-")


def fusion_mode() -> str:
    """shadow (default) | on | off."""
    raw = (os.environ.get("HERMES_CAPTCHA_FUSION") or "shadow").strip().lower()
    if raw in ("off", "0", "false", "no"):
        return "off"
    if raw in ("on", "1", "true", "live", "apply"):
        return "on"
    return "shadow"


def _norm_text(t: object) -> str:
    return re.sub(r"\s+", "", str(t or "").strip())


def _is_uncertain_char(ch: str) -> bool:
    if not ch:
        return True
    return ch in _UNCERTAIN


def _collect_candidates(result: dict) -> list[dict[str, Any]]:
    """Prefer visualCandidates; else rebuild from known fields."""
    existing = result.get("visualCandidates")
    if isinstance(existing, list) and existing:
        out = []
        for c in existing:
            if not isinstance(c, dict):
                continue
            text = _norm_text(c.get("text"))
            if not text:
                continue
            out.append(
                {
                    "source": str(c.get("source") or "unknown"),
                    "text": text,
                    "confidence": c.get("confidence"),
                }
            )
        if out:
            return out

    cands: list[dict[str, Any]] = []
    raw = _norm_text(result.get("ddddText") or result.get("text"))
    if raw:
        cands.append(
            {
                "source": "raw_ocr",
                "text": raw,
                "confidence": result.get("ddddConfidence") or result.get("confidence"),
            }
        )
    yolo = result.get("yoloOcr") if isinstance(result.get("yoloOcr"), dict) else {}
    yt = _norm_text(yolo.get("text"))
    if yt:
        cands.append(
            {
                "source": "yolo_ocr",
                "text": yt,
                "confidence": yolo.get("confidence"),
            }
        )
    vlm = _norm_text(result.get("vlmText"))
    if vlm:
        cands.append(
            {
                "source": "vlm",
                "text": vlm,
                "confidence": result.get("confidence") if result.get("vlmUsed") else None,
            }
        )
    return cands


def _position_votes(cands: list[dict[str, Any]], length: int) -> list[dict[str, Any]]:
    """Per position: all *definite* votes must agree; any disagreement → conflict.

    Uncertain glyphs (?, *, …) are ignored and do not create conflict.
    No majority guessing in v1.
    """
    positions: list[dict[str, Any]] = []
    for i in range(length):
        definite: dict[str, list[str]] = {}
        for c in cands:
            text = c["text"]
            if len(text) != length:
                continue
            ch = text[i]
            if _is_uncertain_char(ch):
                continue
            ch_u = ch.upper() if ch.isalpha() else ch
            definite.setdefault(ch_u, []).append(c["source"])
        if not definite:
            positions.append(
                {
                    "position": i,
                    "selected": None,
                    "votes": {},
                    "status": "uncertain",
                    "voters": [],
                }
            )
            continue
        if len(definite) > 1:
            positions.append(
                {
                    "position": i,
                    "selected": None,
                    "votes": {k: len(v) for k, v in definite.items()},
                    "status": "conflict",
                    "tied": sorted(definite.keys()),
                    "voters": [s for srcs in definite.values() for s in srcs],
                }
            )
            continue
        ch_u = next(iter(definite))
        positions.append(
            {
                "position": i,
                "selected": ch_u,
                "votes": {ch_u: len(definite[ch_u])},
                "status": "ok",
                "voters": definite[ch_u],
                "voteCount": len(definite[ch_u]),
            }
        )
    return positions


def fuse_candidates(
    result: dict,
    *,
    allowed: list[int] | None = None,
) -> dict[str, Any]:
    """Return fusion record. Never mutates result."""
    allowed = list(allowed or allowed_lengths())
    cands = _collect_candidates(result)
    if not cands:
        return {
            "action": "abstain",
            "text": "",
            "agreement": 0.0,
            "reason": "no_candidates",
            "candidates": [],
            "positions": [],
            "lengthValid": False,
            "explain": "no OCR/VLM/YOLO texts to fuse",
        }

    # Prefer lengths that appear most often among candidates and are allowed.
    length_counts: dict[int, int] = {}
    for c in cands:
        n = len(c["text"])
        length_counts[n] = length_counts.get(n, 0) + 1
    valid_lengths = [n for n in length_counts if n in allowed]
    if not valid_lengths:
        return {
            "action": "retry",
            "text": "",
            "agreement": 0.0,
            "reason": "length_invalid",
            "candidates": cands,
            "positions": [],
            "lengthValid": False,
            "detectedLengths": sorted(length_counts.keys()),
            "allowed_lengths": allowed,
            "explain": f"candidate lengths {sorted(length_counts)} not in {allowed}",
        }

    target_len = max(valid_lengths, key=lambda n: (length_counts[n], -abs(n - 5)))
    usable = [c for c in cands if len(c["text"]) == target_len]
    if len(usable) < 1:
        return {
            "action": "abstain",
            "text": "",
            "agreement": 0.0,
            "reason": "no_usable_length",
            "candidates": cands,
            "lengthValid": False,
            "explain": "no candidate matched target length",
        }

    positions = _position_votes(usable, target_len)
    if any(p["status"] == "conflict" for p in positions):
        return {
            "action": "retry",
            "text": "",
            "agreement": 0.0,
            "reason": "position_conflict",
            "candidates": cands,
            "positions": positions,
            "lengthValid": True,
            "targetLength": target_len,
            "explain": "per-position conflict without majority — do not guess",
        }

    if any(p["status"] == "uncertain" or not p.get("selected") for p in positions):
        # If at least 2 full strings already agree exactly, accept that string.
        exact: dict[str, list[str]] = {}
        for c in usable:
            key = c["text"].upper()
            exact.setdefault(key, []).append(c["source"])
        best_text, sources = max(exact.items(), key=lambda kv: len(kv[1]))
        if len(sources) >= 2 and all(
            (not _is_uncertain_char(ch)) for ch in best_text
        ):
            agreement = len(sources) / max(1, len(usable))
            return {
                "action": "pass",
                "text": best_text,
                "agreement": round(agreement, 4),
                "reason": "exact_agreement_with_uncertain_peer",
                "candidates": cands,
                "positions": positions,
                "lengthValid": True,
                "targetLength": target_len,
                "agreeingSources": sources,
                "explain": (
                    f"{len(sources)} sources agree on {best_text}; "
                    "uncertain peer ignored"
                ),
            }
        return {
            "action": "retry",
            "text": "",
            "agreement": 0.0,
            "reason": "position_uncertain",
            "candidates": cands,
            "positions": positions,
            "lengthValid": True,
            "targetLength": target_len,
            "explain": "missing/uncertain glyph without exact multi-source agreement",
        }

    fused = "".join(str(p["selected"]) for p in positions)
    # Full-string agreement among usable sources (case-insensitive).
    agree_n = sum(1 for c in usable if c["text"].upper() == fused.upper())
    agreement = agree_n / max(1, len(usable))

    # Single source only → pass only if that source already solved-like confidence.
    if len(usable) == 1:
        conf = usable[0].get("confidence")
        try:
            conf_f = float(conf) if conf is not None else 0.0
        except (TypeError, ValueError):
            conf_f = 0.0
        if conf_f < 0.55 and not bool(result.get("solved")):
            return {
                "action": "abstain",
                "text": fused,
                "agreement": 1.0,
                "reason": "single_weak_source",
                "candidates": cands,
                "positions": positions,
                "lengthValid": True,
                "targetLength": target_len,
                "explain": "only one candidate and weak/unsolved — abstain",
            }

    action = "pass" if agreement >= 0.5 else "retry"
    return {
        "action": action,
        "text": fused if action == "pass" else "",
        "agreement": round(agreement, 4),
        "reason": "fused" if action == "pass" else "low_agreement",
        "candidates": cands,
        "positions": positions,
        "lengthValid": True,
        "targetLength": target_len,
        "agreeingSources": [c["source"] for c in usable if c["text"].upper() == fused.upper()],
        "explain": f"fused={fused} agreement={agreement:.2f} from {len(usable)} sources",
    }


def _action_to_decision(action: str) -> str:
    a = (action or "").lower()
    if a == "pass":
        return "accept"
    if a == "retry":
        return "retry"
    return "abstain"


def shadow_delta(actual_decision: str, shadow_action: str, actual_text: str, shadow_text: str) -> str:
    ad = (actual_decision or "").lower()
    sa = (shadow_action or "").lower()
    actual_pass = ad in ("accept", "pass") or (
        ad not in ("abstain", "retry") and bool(actual_text)
    )
    # Normalize actual: solved path often uses decision=accept
    if ad in ("accept",):
        actual_pass = True
    if ad in ("abstain", "retry"):
        actual_pass = False

    shadow_pass = sa == "pass"
    if actual_pass == shadow_pass:
        if (actual_text or "").upper() == (shadow_text or "").upper():
            return "agree"
        return "conflict_text"
    if actual_pass and not shadow_pass:
        return "shadow_stricter"
    return "shadow_looser"


def _attach_char_c4_shadow(result: dict) -> None:
    """C4/C5 charGate shadow vs C0 actual.

    Never rewrites solved/text. Counts C0↔shadow PASS/RETRY matrix.
    """
    yolo = result.get("yoloOcr") if isinstance(result.get("yoloOcr"), dict) else {}
    pipe = str(yolo.get("pipeline") or "")
    if pipe not in ("c4", "c5", "c5o"):
        return

    c0_text = _norm_text(yolo.get("c0Text") or result.get("text"))
    c0_pass = bool(c0_text)

    if pipe in ("c5", "c5o"):
        gate = yolo.get("c5Gate") if isinstance(yolo.get("c5Gate"), dict) else {}
        if not gate:
            gate = yolo.get("charGate") if isinstance(yolo.get("charGate"), dict) else {}
        shadow_text = _norm_text(yolo.get("c5Text") or gate.get("text"))
        gate_ok = bool(gate.get("ok")) and bool(shadow_text)
        shadow_action = "pass" if gate_ok else "retry"
        if not gate_ok:
            shadow_text = ""
        source = "c5o" if pipe == "c5o" else "c5"
        l1_n = gate.get("l1ObserveCount") or len(yolo.get("c5L1Observations") or [])
        explain = (
            f"c5Gate action={shadow_action} reason={gate.get('reason')} "
            f"triggers={gate.get('triggerCount') or len(yolo.get('c5Triggers') or [])} "
            f"l1Observe={l1_n} provider={gate.get('provider') or 'none'}"
        )
        result["c5Triggers"] = yolo.get("c5Triggers") or gate.get("triggers") or []
        result["c5L1Observations"] = yolo.get("c5L1Observations") or gate.get("l1Observations") or []
    else:
        gate = yolo.get("charGate") if isinstance(yolo.get("charGate"), dict) else {}
        if not gate:
            return
        shadow_text = _norm_text(yolo.get("c4Text"))
        gate_ok = bool(gate.get("ok")) and bool(shadow_text)
        shadow_action = "pass" if gate_ok else "retry"
        if not gate_ok:
            shadow_text = ""
        source = "c4"
        explain = (
            f"charGate action={shadow_action} reason={gate.get('reason')} "
            f"minMargin={gate.get('minMargin')} minAgree={gate.get('minAgree')}"
        )

    actual_decision = "accept" if c0_pass else "retry"
    result["actualDecision"] = {
        "decision": actual_decision,
        "text": c0_text,
        "solved": c0_pass,
        "source": "c0",
    }
    result["shadowDecision"] = {
        "action": shadow_action,
        "decision": _action_to_decision(shadow_action),
        "text": shadow_text,
        "agreement": None,
        "reason": gate.get("reason") or shadow_action,
        "explain": explain,
        "source": source,
        "charGate": gate,
    }
    result["shadowDelta"] = shadow_delta(
        actual_decision, shadow_action, c0_text, shadow_text
    )
    result["charShadowMatrix"] = {
        "c0Pass": c0_pass,
        "c4Pass": gate_ok if pipe == "c4" else None,
        "c5Pass": gate_ok if pipe in ("c5", "c5o") else None,
        "cell": (
            ("C0_PASS" if c0_pass else "C0_RETRY")
            + "_"
            + (
                ("C5_PASS" if gate_ok else "C5_RETRY")
                if pipe in ("c5", "c5o")
                else ("C4_PASS" if gate_ok else "C4_RETRY")
            )
        ),
    }


def apply_fusion(result: dict, *, mode: str | None = None) -> dict:
    """Attach fusion + shadow fields. Only mode=on rewrites solved/text/decision."""
    mode = (mode or fusion_mode()).lower()

    # C4 char shadow always attaches when pipeline=c4 (independent of string Fusion).
    _attach_char_c4_shadow(result)

    if mode == "off":
        result["fusionMode"] = "off"
        return result

    # If C4 already filled shadowDecision, keep it; still compute string fusion for Trace.
    fusion = fuse_candidates(result)
    result["fusion"] = fusion
    result["fusionMode"] = mode

    if str((result.get("yoloOcr") or {}).get("pipeline") or "") in ("c4", "c5", "c5o"):
        # Do not overwrite C0/C4/C5 shadow matrix with string-fusion shadow.
        if mode == "on":
            pass
        return result

    actual_decision = str(result.get("decision") or ("accept" if result.get("solved") else "abstain"))
    actual_text = _norm_text(result.get("text"))
    shadow_action = fusion.get("action") or "abstain"
    shadow_text = _norm_text(fusion.get("text"))
    shadow_decision = _action_to_decision(str(shadow_action))

    result["actualDecision"] = {
        "decision": actual_decision,
        "text": actual_text,
        "solved": bool(result.get("solved")),
    }
    result["shadowDecision"] = {
        "action": shadow_action,
        "decision": shadow_decision,
        "text": shadow_text,
        "agreement": fusion.get("agreement"),
        "reason": fusion.get("reason"),
        "explain": fusion.get("explain"),
    }
    result["shadowDelta"] = shadow_delta(
        actual_decision, str(shadow_action), actual_text, shadow_text
    )

    if mode == "on":
        # Live apply — still never use S0 as gate; fusion alone.
        if shadow_action == "pass" and shadow_text:
            result["solved"] = True
            result["success"] = True
            result["text"] = shadow_text
            result["decision"] = "accept"
            result["reason"] = ""
            result["decisionReason"] = fusion.get("reason") or "fusion"
            result["engine"] = str(result.get("engine") or "") + "+fusion"
        else:
            result["solved"] = False
            result["success"] = False
            result["text"] = ""
            result["decision"] = shadow_decision
            result["reason"] = str(fusion.get("reason") or "fusion_abstain")
            result["decisionReason"] = fusion.get("explain") or fusion.get("reason")

    return result
