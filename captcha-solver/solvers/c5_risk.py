"""C5 confusion-aware risk gate (REQ_CAPTCHA_C5_CONFUSION).

C5-R′: L2/L3 + inherited C4 rejects → RETRY (provider=none).
C5-R″-O: adds L1 HIGH_CONF single-candidate confusion → OBSERVE only (no decision change).

actual submit stays C0; C5 only fills shadow fields.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

# Mirror captcha-demo / generate_demo_train_set.mjs
DEFAULT_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def captcha_charset() -> str:
    raw = (os.environ.get("HERMES_CAPTCHA_CHARSET") or DEFAULT_CHARSET).strip()
    return raw or DEFAULT_CHARSET


def _charset_set() -> set[str]:
    """Case-insensitive membership via upper for letters; digits as-is."""
    out: set[str] = set()
    for ch in captcha_charset():
        out.add(ch)
        if ch.isalpha():
            out.add(ch.upper())
            out.add(ch.lower())
    return out


def in_charset(ch: str) -> bool:
    if not ch:
        return False
    g = ch[:1]
    return g in _charset_set()


def _default_confusion_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "c5_confusion_v1.json"


@lru_cache(maxsize=4)
def _load_confusion_raw(path_str: str) -> dict[str, Any]:
    p = Path(path_str)
    if not p.is_file():
        return {"pairs": [], "version": "missing"}
    return json.loads(p.read_text(encoding="utf-8"))


def confusion_table_path() -> Path:
    env = (os.environ.get("HERMES_CAPTCHA_C5_CONFUSION") or "").strip()
    if env:
        return Path(env)
    return _default_confusion_path()


def known_confusion_lookup(ocr_char: str) -> dict[str, Any] | None:
    """If OCR glyph is a reviewed high-risk confusion trigger, return entry."""
    g = (ocr_char or "")[:1]
    if not g:
        return None
    g_u = g.upper() if g.isalpha() else g
    data = _load_confusion_raw(str(confusion_table_path()))
    for pair in data.get("pairs") or []:
        if not isinstance(pair, dict):
            continue
        ocr = str(pair.get("ocr") or "")
        ocr_u = ocr.upper() if ocr.isalpha() else ocr
        if ocr_u == g_u:
            return pair
    return None


def c5_l1_observe_enabled(*, pipeline: str | None = None) -> bool:
    """C5-R″-O: record L1 observations without changing PASS/RETRY."""
    level = (pipeline or os.environ.get("HERMES_CAPTCHA_CHAR_PIPELINE") or "").strip().lower()
    if level in ("c5o", "c5-o", "c5r2o", "c5-r2-o", "c5r''-o"):
        return True
    raw = (os.environ.get("HERMES_CAPTCHA_C5_L1") or "").strip().lower()
    return raw in ("observe", "on", "1", "true")


def _norm_glyph(ch: str) -> str:
    g = str(ch or "")[:1]
    if not g:
        return ""
    return g.upper() if g.isalpha() else g


def _topk_glyphs(candidates: list | None, c4: dict[str, Any]) -> list[str]:
    topk: list[str] = []
    for c in candidates or c4.get("candidates") or []:
        if isinstance(c, dict) and c.get("char"):
            topk.append(str(c["char"]))
    return topk


def _is_single_candidate(topk: list[str]) -> bool:
    nonempty = [_norm_glyph(t) for t in topk if str(t or "").strip()]
    return len(nonempty) == 1


def _confuse_norm(confuse: list[str]) -> list[str]:
    out: list[str] = []
    for c in confuse:
        g = _norm_glyph(c)
        if g:
            out.append(g)
    return out


def _top2_has_confuse(topk: list[str], confuse_norm: list[str]) -> bool:
    top2_norm = [_norm_glyph(t) for t in topk[:2] if str(t or "").strip()]
    return len(top2_norm) >= 2 and any(c in top2_norm for c in confuse_norm)


def _directional_pair_str(hit: dict[str, Any]) -> str:
    """Directional pair label for trace, e.g. H->B (never B↔H)."""
    pair_counts = hit.get("pairCounts") or {}
    if isinstance(pair_counts, dict) and pair_counts:
        key = next(iter(pair_counts.keys()))
        return str(key).replace("→", "->")
    ocr = str(hit.get("ocr") or "")
    confuse = hit.get("confuseWith") or []
    if confuse:
        return f"{confuse[0]}->{ocr}"
    return ocr


def classify_position_risk(
    *,
    position: int,
    c4_decision: dict[str, Any] | None,
    candidates: list[dict] | None = None,
    l1_observe: bool = False,
) -> dict[str, Any]:
    """Classify one position after C4.

    Levels (frozen):
      L3 ILLEGAL_CHAR → RETRY
      L2 KNOWN_CONFUSION (Top-2 contains confuseWith) → RETRY
      L1 HIGH_CONF_SINGLE_CONFUSION → OBSERVE (C5-R″-O only; final stays PASS)
      L0 ordinary HIGH_CONF → PASS
    """
    c4 = c4_decision or {}
    c4_reason = str(c4.get("reason") or "")
    selected = c4.get("selected")
    if selected is None and c4.get("decision") == "PASS":
        selected = (candidates or [{}])[0].get("char") if candidates else None
    cand = str(selected or "")[:1]
    topk = _topk_glyphs(candidates, c4)

    base: dict[str, Any] = {
        "position": position,
        "candidate": cand or None,
        "ocrChar": cand or None,
        "riskLevel": "L0",
        "riskType": "NONE",
        "confusionWith": [],
        "pair": "",
        "topK": topk[:3],
        "margin": c4.get("margin"),
        "viewAgreement": c4.get("view_agreement"),
        "agreement": c4.get("view_agreement"),
        "action": "PASS_CANDIDATE",
        "provider": "none",
        "providerResult": None,
        "final": "PASS",
        "c4Reason": c4_reason,
    }

    # Inherit C4 rejects (already RETRY at C4)
    if str(c4.get("decision") or "") != "PASS" or not cand:
        if c4_reason == "LOW_MARGIN":
            risk = "LOW_MARGIN"
        elif c4_reason in ("UNSTABLE", "LOW_AGREE"):
            risk = "UNSTABLE"
        else:
            risk = "UNSTABLE"
        base.update(
            {
                "riskType": risk,
                "action": "RETRY",
                "final": "RETRY",
            }
        )
        return base

    # C4 PASS → C5 risk checks
    if not in_charset(cand):
        base.update(
            {
                "riskLevel": "L3",
                "riskType": "ILLEGAL_CHAR",
                "action": "RETRY",
                "final": "RETRY",
            }
        )
        return base

    hit = known_confusion_lookup(cand)
    if hit:
        confuse = [str(x) for x in (hit.get("confuseWith") or [])]
        confuse_norm = _confuse_norm(confuse)
        pair = _directional_pair_str(hit)

        # L2: C5-R′ — Top-1=ocr AND Top-2 contains directional confuseWith
        if _top2_has_confuse(topk, confuse_norm):
            base.update(
                {
                    "riskLevel": "L2",
                    "riskType": "KNOWN_CONFUSION",
                    "confusionWith": confuse,
                    "pair": pair,
                    "action": "RETRY",
                    "final": "RETRY",
                    "confusionRule": "top1_ocr_and_top2_contains_confuseWith",
                    "confusionEntry": {
                        "ocr": hit.get("ocr"),
                        "n": hit.get("n"),
                        "source": hit.get("source"),
                        "risk": hit.get("risk"),
                        "pairCounts": hit.get("pairCounts"),
                    },
                }
            )
            return base

        # L1: C5-R″-O — HIGH_CONF + single candidate + OCR-side confusion, not L2
        if (
            l1_observe
            and c4_reason == "HIGH_CONF"
            and _is_single_candidate(topk)
        ):
            base.update(
                {
                    "riskLevel": "L1",
                    "riskType": "HIGH_CONF_SINGLE_CONFUSION",
                    "confusionWith": confuse,
                    "pair": pair,
                    "action": "OBSERVE",
                    "final": "PASS",
                    "confusionRule": "high_conf_single_candidate_ocr_side",
                    "confusionEntry": {
                        "ocr": hit.get("ocr"),
                        "n": hit.get("n"),
                        "source": hit.get("source"),
                        "risk": hit.get("risk"),
                        "pairCounts": hit.get("pairCounts"),
                    },
                }
            )
            return base

    # L0 — ordinary HIGH_CONF / HIGH_MARGIN
    base.update({"riskLevel": "L0", "riskType": "NONE", "action": "PASS_CANDIDATE", "final": "PASS"})
    return base


def apply_c5_risk_gate(
    positions: list[dict[str, Any]],
    *,
    c4_ok: bool,
    c4_text: str,
    l1_observe: bool = False,
) -> dict[str, Any]:
    """Run C5 over C4 position decisions. Returns gate + triggers + L1 observations."""
    triggers: list[dict[str, Any]] = []
    l1_observations: list[dict[str, Any]] = []
    pos_out: list[dict[str, Any]] = []
    all_pass = True
    first_reason = ""

    for p in positions:
        c4 = p.get("c4") if isinstance(p.get("c4"), dict) else {}
        risk = classify_position_risk(
            position=int(p.get("position") or 0),
            c4_decision=c4,
            candidates=list(p.get("candidates") or []),
            l1_observe=l1_observe,
        )
        p["c5"] = risk
        pos_out.append(risk)

        if risk.get("action") == "OBSERVE":
            l1_observations.append(risk)
        elif risk.get("final") != "PASS":
            all_pass = False
            if risk.get("riskType") and risk.get("riskType") != "NONE":
                triggers.append(risk)
            if not first_reason:
                first_reason = f"{risk.get('riskType')}@{risk.get('position')}"

    if not c4_ok:
        all_pass = False
        if not first_reason:
            first_reason = "C4_RETRY"

    c5_text = c4_text if all_pass and c4_text else ""
    return {
        "ok": bool(all_pass and c5_text),
        "action": "pass" if (all_pass and c5_text) else "retry",
        "reason": "ALL_PASS" if (all_pass and c5_text) else (first_reason or "RETRY"),
        "provider": "none",
        "mode": "c5-r2-o" if l1_observe else "c5-r-prime",
        "positions": pos_out,
        "triggers": triggers,
        "triggerCount": len(triggers),
        "l1Observations": l1_observations,
        "l1ObserveCount": len(l1_observations),
        "text": c5_text,
    }
