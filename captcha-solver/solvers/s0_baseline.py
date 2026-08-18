"""S0 observational baseline — NEVER gates submit (REQ §11).

S0 PASS ≠ final decision PASS.
Checks: length vs allowed, bbox count/order/overlap, OCR empty.
"""
from __future__ import annotations

import os
from typing import Any


def allowed_lengths() -> list[int]:
    raw = (os.environ.get("HERMES_CAPTCHA_ALLOWED_LENGTHS") or "4,5,6").strip()
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out or [4, 5, 6]


def _boxes_sorted(boxes: list[dict]) -> list[dict]:
    def key(b: dict) -> float:
        try:
            return float(b.get("x1", b.get("xyxy", [0])[0]))
        except Exception:
            return 0.0

    return sorted(boxes, key=key)


def _severe_overlap(a: dict, b: dict, iou_thresh: float = 0.55) -> bool:
    try:
        ax1, ay1, ax2, ay2 = float(a["x1"]), float(a["y1"]), float(a["x2"]), float(a["y2"])
        bx1, by1, bx2, by2 = float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])
    except Exception:
        return False
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return False
    area_a = max(1.0, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1.0, (bx2 - bx1) * (by2 - by1))
    iou = inter / (area_a + area_b - inter)
    return iou >= iou_thresh


def evaluate_s0(
    *,
    boxes: list[dict] | None = None,
    raw_text: str | None = None,
    yolo_text: str | None = None,
    allowed: list[int] | None = None,
) -> dict[str, Any]:
    """Return observational S0 report. Does not set solved."""
    allowed = list(allowed or allowed_lengths())
    boxes = list(boxes or [])
    detected = len(boxes)
    length_valid = detected in allowed if boxes else None

    order_valid = True
    if len(boxes) >= 2:
        xs = []
        for b in boxes:
            try:
                xs.append(float(b.get("x1", 0)))
            except Exception:
                xs.append(0.0)
        order_valid = xs == sorted(xs)

    geometry_valid = True
    sorted_boxes = _boxes_sorted(boxes)
    for i in range(len(sorted_boxes) - 1):
        if _severe_overlap(sorted_boxes[i], sorted_boxes[i + 1]):
            geometry_valid = False
            break

    ocr_empty = not (str(raw_text or "").strip() or str(yolo_text or "").strip())

    checks = {
        "detected_length": detected,
        "allowed_lengths": allowed,
        "length_valid": length_valid,
        "order_valid": order_valid if boxes else None,
        "geometry_valid": geometry_valid if boxes else None,
        "ocr_empty": ocr_empty,
        "bbox_count": detected,
    }

    # S0 PASS = structural OK when boxes exist; without boxes, pass if OCR non-empty.
    if boxes:
        s0_pass = bool(
            length_valid and order_valid and geometry_valid and not ocr_empty
        )
    else:
        s0_pass = not ocr_empty

    return {
        "pass": s0_pass,
        "observationOnly": True,
        "gatesSubmit": False,
        "note": "S0 PASS ≠ final submit PASS",
        "checks": checks,
    }
