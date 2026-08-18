"""Click: colored / high-saturation blobs → viewport points."""
from __future__ import annotations

from PIL import Image

from .preprocess import Blob, connected_blobs


def _sat_mask(img: Image.Image, min_sat: int = 55) -> list[list[bool]]:
    rgb = img.convert("RGB")
    px = rgb.load()
    w, h = rgb.size
    mask = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            mx = r if r > g else g
            if b > mx:
                mx = b
            mn = r if r < g else g
            if b < mn:
                mn = b
            if mx - mn >= min_sat and mx >= 80:
                mask[y][x] = True
    return mask


def colored_blobs(img: Image.Image) -> list[Blob]:
    w, h = img.size
    mask = _sat_mask(img)
    min_area = max(25, (w * h) // 900)
    max_area = (w * h) // 3
    blobs = connected_blobs(mask, min_area=min_area, max_area=max_area)
    return [b for b in blobs if 8 <= b.w <= w * 0.5 and 8 <= b.h <= h * 0.7]


def feature_score(img: Image.Image) -> float:
    blobs = colored_blobs(img)
    n = len(blobs)
    if n >= 3:
        return 0.85
    if n == 2:
        return 0.7
    if n == 1:
        return 0.35
    return 0.05


def solve_click(img: Image.Image) -> dict:
    blobs = colored_blobs(img)
    if len(blobs) < 2:
        return {"solved": False, "kind": "click", "reason": "not enough click targets"}
    points = [{"x": int(round(b.cx)), "y": int(round(b.cy))} for b in blobs]
    return {
        "solved": True,
        "kind": "click",
        "coord": "viewport",
        "points": points,
        "confidence": round(min(0.95, 0.55 + 0.1 * len(points)), 4),
    }
