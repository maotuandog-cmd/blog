"""OCR input variants: Pillow always; OpenCV CLAHE/bin when installed."""
from __future__ import annotations

from PIL import Image, ImageFilter, ImageOps

from .preprocess import ink_mask, to_gray


def _mask_to_rgb(mask: list[list[bool]]) -> Image.Image:
    h = len(mask)
    w = len(mask[0]) if h else 0
    im = Image.new("L", (w, h), 255)
    p = im.load()
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if row[x]:
                p[x, y] = 0
    return im.convert("RGB")


def _cv2():
    try:
        import cv2
        import numpy as np
    except Exception:
        return None, None
    return cv2, np


def upscale_if_small(img: Image.Image, factor: int = 2, max_side: int = 200) -> Image.Image:
    w, h = img.size
    if max(w, h) >= max_side:
        return img
    return img.resize((w * factor, h * factor), Image.Resampling.LANCZOS)


def content_bbox(img: Image.Image) -> tuple[int, int, int, int] | None:
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            chroma = max(r, g, b) - min(r, g, b)
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if chroma >= 20 or luma < 235:
                if x < x0:
                    x0 = x
                if y < y0:
                    y0 = y
                if x > x1:
                    x1 = x
                if y > y1:
                    y1 = y
    if x1 < x0:
        return None
    pad = 2
    return (
        max(0, x0 - pad),
        max(0, y0 - pad),
        min(w, x1 + 1 + pad),
        min(h, y1 + 1 + pad),
    )


def trim_content(img: Image.Image) -> Image.Image:
    box = content_bbox(img)
    if not box:
        return img.convert("RGB")
    cropped = img.convert("RGB").crop(box)
    return cropped if cropped.size[0] >= 8 and cropped.size[1] >= 8 else img.convert("RGB")


def _clahe_rgb(img: Image.Image) -> Image.Image | None:
    cv2, np = _cv2()
    if cv2 is None or np is None:
        return None
    gray = np.array(img.convert("L"))
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    out = clahe.apply(gray)
    return Image.fromarray(out).convert("RGB")


def _adaptive_bin_rgb(img: Image.Image) -> Image.Image | None:
    cv2, np = _cv2()
    if cv2 is None or np is None:
        gray = to_gray(img, denoise=False)
        mask, _ = ink_mask(gray)
        return _mask_to_rgb(mask)
    gray = np.array(img.convert("L"))
    mean = float(gray.mean()) if gray.size else 255.0
    flag = cv2.THRESH_BINARY if mean >= 110 else cv2.THRESH_BINARY_INV
    out = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, flag, 11, 2)
    return Image.fromarray(out).convert("RGB")


def chroma_ink(img: Image.Image) -> Image.Image:
    """Keep saturated / dark glyphs on white — DCP-style color captchas."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    out = Image.new("RGB", (w, h), (255, 255, 255))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            chroma = max(r, g, b) - min(r, g, b)
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if chroma >= 28 or luma < 125:
                op[x, y] = (r, g, b)
    return out


def denoise_rgb(img: Image.Image) -> Image.Image:
    """Light median denoise for thin interference (Pillow path)."""
    return img.convert("RGB").filter(ImageFilter.MedianFilter(size=3))


def morph_clean(img: Image.Image) -> Image.Image:
    """OpenCV morphological open to thin interference lines; Pillow fallback."""
    cv2, np = _cv2()
    rgb = img.convert("RGB")
    if cv2 is None or np is None:
        return denoise_rgb(rgb)
    arr = np.array(rgb)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    # Keep darker/saturated strokes; open removes thin lines.
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Ensure ink is black (0)
    if float(bw.mean()) < 127:
        bw = 255 - bw
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel, iterations=1)
    return Image.fromarray(opened).convert("RGB")


def ocr_variants(img: Image.Image, colorful: bool = False) -> list[tuple[str, Image.Image]]:
    """At most 6 named RGB variants for one HTTP request.

    Color/rotated captchas skip bin/CLAHE — those wipe colored glyphs and
    split the ddddocr vote, which used to fall through to template refuse.
    """
    rgb = img.convert("RGB")
    out: list[tuple[str, Image.Image]] = [("raw", rgb)]

    up = upscale_if_small(rgb, factor=2, max_side=220)
    if up.size != rgb.size:
        out.append(("up2", up))

    trimmed = upscale_if_small(trim_content(rgb), factor=2, max_side=220)
    out.append(("trim_up2", trimmed))

    if colorful:
        ink = chroma_ink(rgb)
        out.append(("chroma_ink", ink))
        morph = upscale_if_small(morph_clean(ink), factor=2, max_side=220)
        out.append(("morph_up2", morph))
        gray = ImageOps.autocontrast(rgb.convert("L")).convert("RGB")
        out.append(("gray_contrast", gray))
        return out[:6]

    gray = ImageOps.autocontrast(rgb.convert("L")).convert("RGB")
    out.append(("gray_contrast", gray))

    clahe = _clahe_rgb(up if up.size != rgb.size else rgb)
    if clahe is not None:
        out.append(("clahe", clahe))

    binary = _adaptive_bin_rgb(up if up.size != rgb.size else rgb)
    if binary is not None:
        out.append(("bin", binary))

    return out[:6]
