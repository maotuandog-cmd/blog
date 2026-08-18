"""E2-A Captcha Type Detector — observation only.

Classifies captcha into:
  text_simple | text_distorted | slider | click | unsupported

Does NOT change Decision / threshold / gate / retry / secondary routing (E2-B).
Emits ``captchaType`` + optional ``routingHint`` for later coverage experiments.
"""
from __future__ import annotations

import os
from typing import Any

from PIL import Image, ImageFilter, ImageOps, ImageStat


TEXT_SIMPLE = "text_simple"
TEXT_DISTORTED = "text_distorted"
SLIDER = "slider"
CLICK = "click"
UNSUPPORTED = "unsupported"

TYPES = (TEXT_SIMPLE, TEXT_DISTORTED, SLIDER, CLICK, UNSUPPORTED)


def captcha_type_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_TYPE_DETECT") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.captchaTypeDetect", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def _chroma_ratio(img: Image.Image) -> float:
    from .ocr import chroma_ratio

    return float(chroma_ratio(img))


def _edge_density(gray: Image.Image) -> float:
    edges = gray.filter(ImageFilter.FIND_EDGES)
    # mean luminance of edge map as density proxy
    return float(ImageStat.Stat(edges).mean[0]) / 255.0


def _ink_ratio(bw: Image.Image) -> float:
    # ink = dark pixels
    hist = bw.histogram()
    dark = sum(hist[:128])
    return dark / max(1, sum(hist))


def _small_blob_ratio(bw: Image.Image, *, max_area: int = 12) -> float:
    """Fraction of ink pixels that sit in tiny connected components (noise proxy)."""
    w, h = bw.size
    px = bw.load()
    seen = [[False] * w for _ in range(h)]
    ink = 0
    small = 0

    def is_ink(x: int, y: int) -> bool:
        return px[x, y] < 128

    for y in range(h):
        for x in range(w):
            if seen[y][x] or not is_ink(x, y):
                continue
            stack = [(x, y)]
            seen[y][x] = True
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_ink(nx, ny):
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            ink += area
            if area <= max_area:
                small += area
    if ink <= 0:
        return 0.0
    return small / ink


def extract_features(img: Image.Image) -> dict[str, Any]:
    rgb = img.convert("RGB")
    w, h = rgb.size
    gray = ImageOps.grayscale(rgb)
    bw = gray.point(lambda p: 255 if p >= 160 else 0)
    chroma = round(_chroma_ratio(rgb), 4)
    edge = round(_edge_density(gray), 4)
    ink = round(_ink_ratio(bw), 4)
    noise = round(_small_blob_ratio(bw), 4)
    aspect = round(w / max(1, h), 4)
    # Coarse engine scores (reuse existing routers)
    from . import click, ocr, slider

    return {
        "width": w,
        "height": h,
        "aspect": aspect,
        "chroma": chroma,
        "edgeDensity": edge,
        "inkRatio": ink,
        "noiseBlobRatio": noise,
        "scoreClick": round(float(click.feature_score(rgb)), 4),
        "scoreSlider": round(float(slider.feature_score(rgb)), 4),
        "scoreImage": round(float(ocr.feature_score(rgb)), 4),
    }


def _text_subtype(features: dict[str, Any]) -> tuple[str, float, list[str]]:
    """Heuristic: colorful / noisy / warped-looking → distorted; else simple."""
    tags: list[str] = ["character_row_candidate"]
    chroma = float(features.get("chroma") or 0)
    edge = float(features.get("edgeDensity") or 0)
    noise = float(features.get("noiseBlobRatio") or 0)
    aspect = float(features.get("aspect") or 1)
    ink = float(features.get("inkRatio") or 0)

    distorted_score = 0.0
    if chroma >= 0.05:
        distorted_score += 0.35
        tags.append("color_ink")
    if noise >= 0.18:
        distorted_score += 0.30
        tags.append("noise")
    if edge >= 0.22:
        distorted_score += 0.20
        tags.append("high_edge")
    if aspect < 1.6 or aspect > 5.5:
        distorted_score += 0.10
        tags.append("unusual_aspect")
    if ink < 0.04 or ink > 0.45:
        distorted_score += 0.10
        tags.append("ink_outlier")

    if distorted_score >= 0.35:
        conf = min(0.95, 0.55 + distorted_score * 0.4)
        tags.append("warp_or_interference")
        return TEXT_DISTORTED, round(conf, 4), tags

    conf = min(0.92, 0.60 + (0.2 if 2.0 <= aspect <= 4.5 else 0.0))
    tags.append("low_interference")
    return TEXT_SIMPLE, round(conf, 4), tags


def detect_captcha_type(
    img: Image.Image,
    *,
    coarse_kind: str | None = None,
    coarse_confidence: float | None = None,
) -> dict[str, Any]:
    """Return observation payload ``captchaType`` (never mutates Decision)."""
    features = extract_features(img)
    kind = (coarse_kind or "").strip().lower()
    tags: list[str] = []

    if kind == "slider" or (
        not kind
        and float(features["scoreSlider"]) >= max(features["scoreClick"], features["scoreImage"])
        and float(features["scoreSlider"]) >= 0.55
    ):
        ctype = SLIDER
        conf = float(coarse_confidence) if coarse_confidence is not None else float(features["scoreSlider"])
        tags = ["slider_geometry"]
        recommend_secondary = False
        reason = "non_text_slider"
    elif kind == "click" or (
        not kind
        and float(features["scoreClick"]) >= max(features["scoreSlider"], features["scoreImage"])
        and float(features["scoreClick"]) >= 0.55
    ):
        ctype = CLICK
        conf = float(coarse_confidence) if coarse_confidence is not None else float(features["scoreClick"])
        tags = ["click_tiles"]
        recommend_secondary = False
        reason = "non_text_click"
    elif kind in ("image", "text", "") or kind == "auto":
        # Text-like path
        if float(features["scoreImage"]) < 0.25 and float(features["inkRatio"]) < 0.02:
            ctype = UNSUPPORTED
            conf = 0.55
            tags = ["no_ink"]
            recommend_secondary = False
            reason = "unsupported_empty"
        else:
            ctype, conf, tags = _text_subtype(features)
            # Distorted → recommend secondary for E2-B; simple → primary-only hint
            recommend_secondary = ctype == TEXT_DISTORTED
            reason = "distorted_text" if recommend_secondary else "simple_text_primary_ok"
            if coarse_confidence is not None and ctype in (TEXT_SIMPLE, TEXT_DISTORTED):
                conf = round(min(0.98, 0.5 * conf + 0.5 * float(coarse_confidence)), 4)
    else:
        ctype = UNSUPPORTED
        conf = 0.4
        tags = ["unknown_kind"]
        recommend_secondary = False
        reason = "unsupported_kind"

    return {
        "type": ctype,
        "confidence": round(float(conf), 4),
        "features": {
            "tags": tags,
            "chroma": features["chroma"],
            "edgeDensity": features["edgeDensity"],
            "noiseBlobRatio": features["noiseBlobRatio"],
            "inkRatio": features["inkRatio"],
            "aspect": features["aspect"],
            "width": features["width"],
            "height": features["height"],
            "scoreImage": features["scoreImage"],
            "scoreSlider": features["scoreSlider"],
            "scoreClick": features["scoreClick"],
        },
        "routingHint": {
            "recommendSecondary": bool(recommend_secondary),
            "reason": reason,
            "applied": False,  # E2-A: hint only; E2-B may set applied=true later
        },
        "coarseKind": kind or None,
        "observationOnly": True,
    }
