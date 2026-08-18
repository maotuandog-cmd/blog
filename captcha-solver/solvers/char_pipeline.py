"""Character OCR pipeline C0–C4 (REQ_CAPTCHA_CHAR_CANDIDATE).

C0: single crop, Top-1 (rollback baseline)
C1: expanded crops (0/5/10/15% pad) → vote
C2: + multi-view preprocess per crop
C3: + Top-K candidates (not forced single Top-1 lock without scores)
C4: conservative per-position gate (Top-2; all positions PASS → pass else retry)
     Shadow only — actual submit stays C0.

Default pipeline = c0. Higher levels never remove C0 path from being selectable.
"""
from __future__ import annotations

import os
from collections import Counter
from typing import Any

from PIL import Image, ImageEnhance, ImageOps

from .preprocess import to_gray


C5_LEVELS = ("c5", "c5o")
C4_GATE_LEVELS = ("c4", *C5_LEVELS)
C2_PLUS_LEVELS = ("c2", "c3", *C4_GATE_LEVELS)


def char_pipeline_level() -> str:
    raw = (os.environ.get("HERMES_CAPTCHA_CHAR_PIPELINE") or "c0").strip().lower()
    if raw in ("c0", "0", "baseline"):
        return "c0"
    if raw in ("c1", "1"):
        return "c1"
    if raw in ("c2", "2"):
        return "c2"
    if raw in ("c3", "3"):
        return "c3"
    if raw in ("c4", "4"):
        return "c4"
    if raw in ("c5", "5", "c5-r", "c5r"):
        return "c5"
    if raw in ("c5o", "c5-o", "c5r2o", "c5-r2-o", "c5r''-o"):
        return "c5o"
    return "c0"


def crop_pads() -> list[float]:
    """Padding fractions relative to bbox size. C0 uses only first (0)."""
    raw = (os.environ.get("HERMES_CAPTCHA_CROP_PADS") or "0,0.05,0.10,0.15").strip()
    out: list[float] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(max(0.0, float(part)))
        except ValueError:
            continue
    return out or [0.0]


def char_topk() -> int:
    try:
        return max(1, min(5, int(os.environ.get("HERMES_CAPTCHA_CHAR_TOPK") or "3")))
    except ValueError:
        return 3


def char_min_score() -> float:
    try:
        return min(1.0, max(0.0, float(os.environ.get("HERMES_CAPTCHA_CHAR_MIN_SCORE") or "0.55")))
    except ValueError:
        return 0.55


def char_min_margin() -> float:
    """C4: top1−top2 margin floor (default 0.20)."""
    try:
        return min(1.0, max(0.0, float(os.environ.get("HERMES_CAPTCHA_CHAR_MIN_MARGIN") or "0.20")))
    except ValueError:
        return 0.20


def char_min_agree() -> float:
    """C4: view agreement floor (votes_for_top / non-empty views)."""
    try:
        return min(1.0, max(0.0, float(os.environ.get("HERMES_CAPTCHA_CHAR_MIN_AGREE") or "0.50")))
    except ValueError:
        return 0.50


def _ocr_crop(crop: Image.Image) -> str:
    try:
        from . import ocr as ocr_mod

        if not ocr_mod.ddddocr_available():
            return ""
        text = str(ocr_mod._ddddocr_text(crop) or "").strip()  # noqa: SLF001
        return (text[:1] if text else "") or ""
    except Exception:
        return ""


def _pad_box(box: dict, pad: float, img_w: int, img_h: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = float(box["x1"]), float(box["y1"]), float(box["x2"]), float(box["y2"])
    bw, bh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    dx, dy = bw * pad, bh * pad
    ix1 = max(0, int(x1 - dx))
    iy1 = max(0, int(y1 - dy))
    ix2 = min(img_w, int(x2 + dx + 1))
    iy2 = min(img_h, int(y2 + dy + 1))
    if ix2 - ix1 < 2:
        ix2 = min(img_w, ix1 + 2)
    if iy2 - iy1 < 2:
        iy2 = min(img_h, iy1 + 2)
    return ix1, iy1, ix2, iy2


def _views_for_crop(crop: Image.Image, level: str) -> list[tuple[str, Image.Image]]:
    """C0/C1: single raw crop (+ mild upscale if tiny).

    C2+ (frozen): exactly 4 views on **original crop only** —
    gray / upscale / contrast / binary. No padding mix-in.
    """
    if level in ("c0", "c1"):
        cw, ch = crop.size
        if max(cw, ch) < 24:
            crop = crop.resize(
                (max(24, cw * 2), max(24, ch * 2)), Image.Resampling.LANCZOS
            )
        return [("raw", crop)]

    views: list[tuple[str, Image.Image]] = []
    gray = to_gray(crop, denoise=True)
    views.append(("gray", gray.convert("RGB")))
    cw, ch = crop.size
    views.append(
        ("upscale", crop.resize((max(32, cw * 2), max(32, ch * 2)), Image.Resampling.LANCZOS))
    )
    try:
        contrast = ImageEnhance.Contrast(crop.convert("RGB")).enhance(1.6)
        views.append(("contrast", contrast))
    except Exception:
        views.append(("contrast", crop.convert("RGB")))
    try:
        bw = ImageOps.autocontrast(gray).point(lambda p: 0 if p < 140 else 255)
        views.append(("binary", bw.convert("RGB")))
    except Exception:
        views.append(("binary", gray.convert("RGB")))
    return views[:4]


def _pads_for_level(level: str) -> list[float]:
    """C1 alone expands crop; C2+ stays on pad=0 (no neighbor bleed)."""
    if level == "c1":
        return crop_pads()
    return [0.0]


def _vote_candidates(
    reads: list[tuple[str, str]],
    *,
    topk: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """reads: [(view_or_pad_label, glyph), ...] → Top-K scored candidates."""
    k = char_topk() if topk is None else max(1, min(5, int(topk)))
    counts: Counter[str] = Counter()
    view_rows: list[dict[str, str]] = []
    for label, g in reads:
        g = (g or "").strip()
        view_rows.append({"view": label, "text": g})
        if g:
            counts[g.upper() if g.isalpha() else g] += 1
    total = sum(counts.values()) or 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    cands = [
        {"char": ch, "score": round(n / total, 4), "votes": n}
        for ch, n in ranked[:k]
    ]
    return cands, view_rows


def _norm_glyph(g: str) -> str:
    g = (g or "").strip()
    if not g:
        return ""
    return g.upper() if g.isalpha() else g


def decide_position_c4(rec: dict[str, Any]) -> dict[str, Any]:
    """Conservative per-position gate (K=2). Prefer RETRY over guess.

    Rules (v1):
      1. all views agree → PASS HIGH_CONF
      2. margin >= min_margin and agreement >= min_agree → PASS HIGH_MARGIN
      3. margin < min_margin → RETRY LOW_MARGIN
      4. ≥3 distinct view glyphs or agreement < min_agree → RETRY UNSTABLE/LOW_AGREE
      else → RETRY UNCERTAIN
    """
    min_margin = char_min_margin()
    min_agree = char_min_agree()
    views = list(rec.get("views") or [])
    cands = list(rec.get("candidates") or [])[:2]

    glyphs = [_norm_glyph(str(v.get("text") or "")) for v in views]
    glyphs_nz = [g for g in glyphs if g]
    unique = set(glyphs_nz)

    base: dict[str, Any] = {
        "position": rec.get("position"),
        "candidates": cands,
        "margin": 0.0,
        "view_agreement": 0.0,
        "unique_views": len(unique),
        "view_count": len(glyphs_nz),
        "unstable": False,
        "selected": None,
        "decision": "RETRY",
        "reason": "EMPTY",
    }

    if not cands or not glyphs_nz:
        return base

    top = cands[0]
    top_ch = _norm_glyph(str(top.get("char") or ""))
    score = float(top.get("score") or 0)
    second_score = float(cands[1].get("score") or 0) if len(cands) > 1 else 0.0
    margin = round(score - second_score, 4)
    agree_n = sum(1 for g in glyphs_nz if g == top_ch)
    agreement = round(agree_n / max(1, len(glyphs_nz)), 4)

    base.update({"margin": margin, "view_agreement": agreement, "candidates": cands})

    # 1) unanimous views
    if len(unique) == 1 and agreement >= 0.999:
        base.update({"selected": top_ch, "decision": "PASS", "reason": "HIGH_CONF"})
        return base

    # 4) unstable: too many distinct glyphs
    if len(unique) >= 3:
        base.update(
            {
                "unstable": True,
                "decision": "RETRY",
                "reason": "UNSTABLE",
                "selected": None,
            }
        )
        return base

    # 3) close race
    if len(cands) >= 2 and margin < min_margin:
        base.update({"decision": "RETRY", "reason": "LOW_MARGIN", "selected": None})
        return base

    if agreement < min_agree:
        base.update(
            {
                "unstable": True,
                "decision": "RETRY",
                "reason": "LOW_AGREE",
                "selected": None,
            }
        )
        return base

    # 2) healthy margin + agreement
    if margin >= min_margin:
        base.update({"selected": top_ch, "decision": "PASS", "reason": "HIGH_MARGIN"})
        return base

    base.update({"decision": "RETRY", "reason": "UNCERTAIN", "selected": None})
    return base


def recognize_box(
    img: Image.Image,
    box: dict,
    *,
    level: str,
) -> dict[str, Any]:
    """Recognize one bbox according to pipeline level."""
    w, h = img.size
    pads = _pads_for_level(level)
    if level in C4_GATE_LEVELS:
        topk = 2
    elif level == "c3":
        topk = char_topk()
    else:
        topk = 1

    reads: list[tuple[str, str]] = []
    for pad in pads:
        coords = _pad_box(box, pad, w, h)
        crop = img.crop(coords)
        for view_name, view_img in _views_for_crop(crop, level):
            glyph = _ocr_crop(view_img)
            label = f"pad{int(pad * 100)}_{view_name}"
            reads.append((label, glyph))

    cands, view_rows = _vote_candidates(reads, topk=topk)
    if not cands:
        selected, score = "", 0.0
        status = "empty"
    else:
        selected = cands[0]["char"]
        score = float(cands[0]["score"])
        status = "ok"

    return {
        "selected": selected,
        "confidence": score,
        "candidates": cands,
        "views": view_rows if level in C2_PLUS_LEVELS else view_rows[:1],
        "pads": pads,
        "status": status,
        "bbox": box,
    }


def assemble_positions(
    img: Image.Image,
    boxes: list[dict],
    *,
    level: str | None = None,
) -> dict[str, Any]:
    level = level or char_pipeline_level()
    positions: list[dict[str, Any]] = []
    for i, box in enumerate(boxes):
        rec = recognize_box(img, box, level=level)
        rec["position"] = i
        positions.append(rec)

    text = "".join(str(p.get("selected") or "") for p in positions)

    min_score = char_min_score()
    min_margin = char_min_margin()
    min_agree = char_min_agree()
    pos_decisions: list[dict[str, Any]] = []
    gate_ok = True
    gate_reason = ""
    selected_chars: list[str] = []
    c5_gate: dict[str, Any] | None = None

    c5_levels = C5_LEVELS
    if level in C4_GATE_LEVELS:
        if not positions:
            gate_ok = False
            gate_reason = "NO_BOXES"
        for p in positions:
            d = decide_position_c4(p)
            p["c4"] = d
            pos_decisions.append(d)
            if d.get("decision") != "PASS" or not d.get("selected"):
                gate_ok = False
                if not gate_reason:
                    gate_reason = f"{d.get('reason')}@{d.get('position')}"
                selected_chars.append("")
            else:
                selected_chars.append(str(d["selected"]))
        c4_text = "".join(selected_chars) if gate_ok else ""
        if gate_ok and not c4_text:
            gate_ok = False
            gate_reason = gate_reason or "EMPTY_TEXT"
        action = "pass" if gate_ok else "retry"
        if gate_ok:
            gate_reason = "ALL_PASS"

        if level in c5_levels:
            from .c5_risk import apply_c5_risk_gate

            c5_gate = apply_c5_risk_gate(
                positions,
                c4_ok=gate_ok,
                c4_text=c4_text,
                l1_observe=(level == "c5o"),
            )
            gate_ok = bool(c5_gate.get("ok"))
            action = str(c5_gate.get("action") or "retry")
            gate_reason = str(c5_gate.get("reason") or "RETRY")
            out_text = str(c5_gate.get("text") or "")
        else:
            out_text = c4_text if gate_ok else ""
    else:
        action = "pass" if text else "retry"
        gate_ok = bool(text)
        gate_reason = "ok" if gate_ok else "fail"
        out_text = text
        c4_text = text

    result: dict[str, Any] = {
        "pipeline": level,
        "text": out_text if level in ("c4", *c5_levels) else text,
        "provisionalText": text,
        "c4Text": (c4_text if level in ("c4", *c5_levels) else text),
        "characters": positions,
        "charGate": {
            "ok": gate_ok if level not in c5_levels else bool((c5_gate or {}).get("ok")),
            "action": action,
            "reason": gate_reason or ("ok" if gate_ok else "fail"),
            "minScore": min_score,
            "minMargin": min_margin,
            "minAgree": min_agree,
            "topk": 2 if level in ("c4", *c5_levels) else char_topk(),
            "positions": pos_decisions if level in ("c4", *c5_levels) else [],
        },
        "status": "ok" if (out_text if level in ("c4", *c5_levels) else text) else "empty",
    }
    if level in c5_levels and c5_gate is not None:
        result["c5Gate"] = c5_gate
        result["c5Triggers"] = c5_gate.get("triggers") or []
        result["c5L1Observations"] = c5_gate.get("l1Observations") or []
        result["charGate"]["c5"] = {
            "provider": "none",
            "mode": c5_gate.get("mode"),
            "triggerCount": c5_gate.get("triggerCount"),
            "l1ObserveCount": c5_gate.get("l1ObserveCount"),
            "reason": c5_gate.get("reason"),
        }
    return result
