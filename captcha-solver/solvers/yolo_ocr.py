"""bbox → optional sticky split → crop → single-char OCR (ddddocr).

Delegates recognition to char_pipeline (C0–C5). Default C0 = prior Top-1 crop path.

C0 rollback rule:
  - Always emit `c0Text` / `c0Characters` so higher levels never erase baseline.
  - C3/C4/C5 never rewrite live text (actual=C0); gate/risk are shadow-only.
  - C1–C2 may set live `text` when selected via HERMES_CAPTCHA_CHAR_PIPELINE.
"""
from __future__ import annotations

from typing import Any

from PIL import Image

from .char_pipeline import assemble_positions, char_pipeline_level
from .refine_split import refine_boxes


def crops_from_boxes(img: Image.Image, boxes: list[dict]) -> list[Image.Image]:
    """Legacy helper: 1px-padded crops (used by tests / debug)."""
    w, h = img.size
    crops: list[Image.Image] = []
    for b in boxes:
        try:
            x1 = max(0, int(float(b["x1"])) - 1)
            y1 = max(0, int(float(b["y1"])) - 1)
            x2 = min(w, int(float(b["x2"])) + 1)
            y2 = min(h, int(float(b["y2"])) + 1)
        except Exception:
            continue
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        crops.append(img.crop((x1, y1, x2, y2)))
    return crops


def yolo_ocr_from_boxes(img: Image.Image, boxes: list[dict]) -> dict[str, Any]:
    """Run per-box OCR after optional wide-box split."""
    level = char_pipeline_level()
    empty = {
        "source": "yolo_ocr",
        "text": "",
        "c0Text": "",
        "provisionalText": "",
        "confidence": 0.0,
        "characters": [],
        "c0Characters": [],
        "status": "skipped",
        "reason": "no_boxes",
        "split_count": 0,
        "splitEvents": [],
        "boxesUsed": [],
        "pipeline": level,
    }
    if not boxes:
        return empty

    refined, split_events = refine_boxes(img, boxes)

    c0 = assemble_positions(img, refined, level="c0")
    c0_text = str(c0.get("provisionalText") or c0.get("text") or "")

    if level == "c0":
        assembled = c0
    else:
        assembled = assemble_positions(img, refined, level=level)

    chars = assembled.get("characters") or []
    joined = str(assembled.get("provisionalText") or "") or str(assembled.get("text") or "")
    gate = assembled.get("charGate") or {}
    c5_levels = ("c5", "c5o")
    c4_text = str(assembled.get("c4Text") or assembled.get("text") or "") if level in ("c4", *c5_levels) else ""
    c5_text = str(assembled.get("text") or "") if level in c5_levels else ""
    if level == "c4":
        c4_text = str(assembled.get("text") or "")
    box_confs = [float(b.get("confidence") or 0) for b in refined[: len(chars)]]
    avg = sum(box_confs) / len(box_confs) if box_confs else 0.0
    splits_done = sum(1 for e in split_events if e.get("status") == "ok")

    if level in ("c3", "c4", *c5_levels):
        live_text = c0_text
    else:
        live_text = joined

    out: dict[str, Any] = {
        "source": "yolo_ocr",
        "text": live_text,
        "c0Text": c0_text,
        "c4Text": c4_text if level in ("c4", *c5_levels) else "",
        "c5Text": c5_text,
        "provisionalText": joined,
        "confidence": round(avg, 4),
        "characters": chars,
        "c0Characters": c0.get("characters") or [],
        "charGate": gate,
        "pipeline": level,
        "status": "ok" if (live_text or joined) else "empty",
        "split_count": splits_done,
        "splitEvents": split_events,
        "boxesIn": len(boxes),
        "boxesUsed": len(refined),
        "detectionBoxes": refined,
    }
    if level in c5_levels:
        out["c5Gate"] = assembled.get("c5Gate") or {}
        out["c5Triggers"] = assembled.get("c5Triggers") or []
        out["c5L1Observations"] = assembled.get("c5L1Observations") or []
    return out
