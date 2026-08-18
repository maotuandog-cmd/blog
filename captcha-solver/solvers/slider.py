"""Slider: find piece + gap, return offsetX for Worker drag."""
from __future__ import annotations

from PIL import Image

from .preprocess import Blob, connected_blobs, to_gray


def _squareish(b: Blob) -> bool:
    if b.w < 8 or b.h < 8:
        return False
    ratio = b.w / max(1, b.h)
    return 0.45 <= ratio <= 2.2


def _dark_blobs(img: Image.Image) -> list[Blob]:
    gray = to_gray(img)
    px = gray.load()
    w, h = gray.size
    # After autocontrast, piece/gap sit near 0–40 and background near 255.
    mask = [[px[x, y] < 80 for x in range(w)] for y in range(h)]
    blobs = connected_blobs(mask, min_area=max(40, (w * h) // 200))
    return [b for b in blobs if _squareish(b) and b.area < (w * h) * 0.45]


def feature_score(img: Image.Image) -> float:
    w, h = img.size
    if w < 80 or h < 20:
        return 0.05
    blobs = _dark_blobs(img)
    if len(blobs) >= 2:
        left, right = blobs[0], max(blobs[1:], key=lambda b: b.x0)
        if right.x0 - left.x1 > 12:
            return 0.8
        return 0.45
    if w > h * 2 and blobs:
        return 0.4
    return 0.1


def solve_slider(img: Image.Image) -> dict:
    w, h = img.size
    blobs = _dark_blobs(img)
    if len(blobs) >= 2:
        piece = min(blobs, key=lambda b: b.x0)
        rest = [b for b in blobs if b is not piece]
        # Gap is similar-sized blob to the right of the piece.
        scored: list[tuple[float, Blob]] = []
        for b in rest:
            if b.x0 <= piece.x0 + 4:
                continue
            dw = abs(b.w - piece.w) / max(piece.w, 1)
            dh = abs(b.h - piece.h) / max(piece.h, 1)
            dy = abs(b.cy - piece.cy) / max(h, 1)
            cost = dw + dh + dy * 2
            scored.append((cost, b))
        if scored:
            scored.sort(key=lambda t: t[0])
            cost, hole = scored[0]
            offset = int(round(hole.x0 - piece.x0))
            if offset >= 8 and cost < 1.8:
                conf = max(0.5, min(0.99, 1.0 - cost / 2.0))
                return {
                    "solved": True,
                    "kind": "slider",
                    "offsetX": offset,
                    "confidence": round(conf, 4),
                    "decision": "accept",
                    "decisionScore": round(conf, 4),
                    "evidenceScore": round(conf, 4),
                }

    # 62% width guess removed (REQ Decision/Session freeze): unknown → ABSTAIN.
    return {
        "solved": False,
        "kind": "slider",
        "text": "",
        "decision": "abstain",
        "decisionReason": "no reliable piece/gap",
        "reason": "no reliable piece/gap",
        "confidence": 0.0,
    }
