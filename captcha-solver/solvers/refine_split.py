"""P2.3 Sticky-character refine split (Pillow; no OpenCV required).

Wide YOLO boxes → vertical projection (preferred) or connected components →
child boxes in image coordinates. Observation / Trace only until Fusion uses them.
"""
from __future__ import annotations

import os
from typing import Any

from PIL import Image

from .preprocess import connected_blobs, ink_mask, to_gray


def split_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_SPLIT") or "on").strip().lower()
    return raw not in ("off", "0", "false", "no")


def wide_ratio() -> float:
    try:
        return max(1.05, float(os.environ.get("HERMES_CAPTCHA_SPLIT_WIDE_RATIO") or "1.45"))
    except ValueError:
        return 1.45


def _box_wh(b: dict) -> tuple[float, float, float, float, float, float]:
    x1, y1, x2, y2 = float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])
    return x1, y1, x2, y2, max(1.0, x2 - x1), max(1.0, y2 - y1)


def is_wide_box(b: dict, *, median_w: float | None = None) -> bool:
    _, _, _, _, w, h = _box_wh(b)
    if w / h >= wide_ratio():
        return True
    if median_w and median_w > 0 and w >= median_w * 1.65:
        return True
    return False


def _vertical_projection_cuts(mask: list[list[bool]]) -> list[int]:
    """Return x cut points (local) between character clusters."""
    if not mask or not mask[0]:
        return []
    h, w = len(mask), len(mask[0])
    proj = [0] * w
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if row[x]:
                proj[x] += 1
    if not any(proj):
        return []
    peak = max(proj)
    # Valley: low ink relative to peak, between two ink runs.
    thr = max(1, int(peak * 0.12))
    runs: list[tuple[int, int]] = []
    x = 0
    while x < w:
        while x < w and proj[x] <= thr:
            x += 1
        if x >= w:
            break
        start = x
        while x < w and proj[x] > thr:
            x += 1
        runs.append((start, x - 1))
    if len(runs) < 2:
        return []
    # Merge tiny runs into neighbors (noise).
    min_run = max(2, int(w * 0.06))
    merged: list[tuple[int, int]] = []
    for a, b in runs:
        if (b - a + 1) < min_run and merged:
            pa, pb = merged[-1]
            merged[-1] = (pa, b)
        else:
            merged.append((a, b))
    if len(merged) < 2:
        return []
    cuts = []
    for i in range(len(merged) - 1):
        left_end = merged[i][1]
        right_start = merged[i + 1][0]
        cuts.append((left_end + right_start) // 2)
    return cuts


def _ink_mask_for_split(crop: Image.Image) -> list[list[bool]]:
    """Ink mask robust to near-binary crops (otsu can return 0 → empty mask)."""
    gray = to_gray(crop, denoise=True)
    mask, _ = ink_mask(gray)
    if any(any(row) for row in mask):
        return mask
    # Fallback: dark-on-light via mean threshold.
    g = gray.convert("L")
    pixels = g.load()
    w, h = g.size
    acc = 0
    for y in range(h):
        for x in range(w):
            acc += pixels[x, y]
    mean = acc / max(1, w * h)
    if mean < 110:
        # Mostly dark — treat bright as ink (inverted captcha).
        thr = max(8, int(mean + 25))
        return [[pixels[x, y] > thr for x in range(w)] for y in range(h)]
    thr = min(247, max(8, int(mean - 25)))
    return [[pixels[x, y] < thr for x in range(w)] for y in range(h)]


def _split_by_projection(crop: Image.Image) -> tuple[list[tuple[int, int, int, int]], float, str]:
    mask = _ink_mask_for_split(crop)
    cuts = _vertical_projection_cuts(mask)
    if not cuts:
        return [], 0.0, "vertical_projection"
    w, h = crop.size
    xs = [0] + cuts + [w]
    boxes: list[tuple[int, int, int, int]] = []
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        if x1 - x0 < 2:
            continue
        ink_rows = []
        for y in range(h):
            if any(mask[y][x] for x in range(x0, min(x1, w))):
                ink_rows.append(y)
        if ink_rows:
            y0, y1 = max(0, ink_rows[0] - 1), min(h, ink_rows[-1] + 2)
        else:
            y0, y1 = 0, h
        boxes.append((x0, y0, x1, y1))
    conf = min(0.95, 0.55 + 0.1 * len(boxes)) if len(boxes) >= 2 else 0.0
    return boxes, conf, "vertical_projection"


def _split_by_cc(crop: Image.Image) -> tuple[list[tuple[int, int, int, int]], float, str]:
    mask = _ink_mask_for_split(crop)
    blobs = connected_blobs(mask, min_area=8)
    if len(blobs) < 2:
        return [], 0.0, "connected_component"
    blobs = sorted(blobs, key=lambda b: b.x0)
    areas = sorted(b.area for b in blobs)
    med = areas[len(areas) // 2]
    kept = [b for b in blobs if b.area >= max(8, med * 0.25)]
    if len(kept) < 2:
        return [], 0.0, "connected_component"
    boxes = [b.as_box() for b in kept]
    conf = min(0.9, 0.5 + 0.08 * len(boxes))
    return boxes, conf, "connected_component"


def split_wide_box(
    img: Image.Image,
    box: dict,
) -> dict[str, Any]:
    """Try split one box. Returns event + child boxes (global coords) or no-op."""
    x1, y1, x2, y2, bw, bh = _box_wh(box)
    ix1, iy1 = max(0, int(x1)), max(0, int(y1))
    ix2, iy2 = min(img.size[0], int(x2)), min(img.size[1], int(y2))
    if ix2 - ix1 < 4 or iy2 - iy1 < 4:
        return {
            "split": False,
            "parts": 1,
            "method": "none",
            "confidence": 0.0,
            "input_bbox": box,
            "boxes": [box],
            "reason": "too_small",
        }

    crop = img.crop((ix1, iy1, ix2, iy2))
    local_boxes, conf, method = _split_by_projection(crop)
    if len(local_boxes) < 2:
        local_boxes, conf, method = _split_by_cc(crop)
    if len(local_boxes) < 2:
        return {
            "split": False,
            "parts": 1,
            "method": method,
            "confidence": 0.0,
            "input_bbox": box,
            "boxes": [box],
            "reason": "no_cut",
        }

    children: list[dict[str, Any]] = []
    parent_conf = float(box.get("confidence") or 0.5)
    for lx0, ly0, lx1, ly1 in local_boxes:
        children.append(
            {
                "x1": round(ix1 + lx0, 2),
                "y1": round(iy1 + ly0, 2),
                "x2": round(ix1 + lx1, 2),
                "y2": round(iy1 + ly1, 2),
                "confidence": round(parent_conf * conf, 4),
                "class": "character",
                "fromSplit": True,
                "splitMethod": method,
            }
        )
    return {
        "split": True,
        "parts": len(children),
        "method": method,
        "confidence": round(conf, 4),
        "input_bbox": {
            "x1": box.get("x1"),
            "y1": box.get("y1"),
            "x2": box.get("x2"),
            "y2": box.get("y2"),
        },
        "boxes": children,
        "reason": "ok",
    }


def refine_boxes(img: Image.Image, boxes: list[dict]) -> tuple[list[dict], list[dict]]:
    """Expand wide boxes via split. Returns (refined_boxes, split_events)."""
    if not boxes or not split_enabled():
        return list(boxes), []

    widths = []
    for b in boxes:
        try:
            widths.append(_box_wh(b)[4])
        except Exception:
            pass
    widths.sort()
    median_w = widths[len(widths) // 2] if widths else None

    refined: list[dict] = []
    events: list[dict] = []
    for b in boxes:
        if not is_wide_box(b, median_w=median_w):
            refined.append(b)
            continue
        ev = split_wide_box(img, b)
        events.append(
            {
                "stage": "split",
                "input_bbox": ev.get("input_bbox"),
                "parts": ev.get("parts"),
                "method": ev.get("method"),
                "confidence": ev.get("confidence"),
                "status": "ok" if ev.get("split") else "skipped",
                "reason": ev.get("reason"),
            }
        )
        refined.extend(ev.get("boxes") or [b])

    refined.sort(key=lambda x: float(x.get("x1") or 0))
    return refined, events
