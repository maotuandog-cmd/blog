"""Grayscale, threshold, connected components. Pillow only (no numpy/OpenCV)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]


def find_font() -> str | None:
    for p in FONT_CANDIDATES:
        if Path(p).is_file():
            return p
    return None


def to_gray(img: Image.Image, denoise: bool = True) -> Image.Image:
    g = img.convert("L")
    g = ImageOps.autocontrast(g)
    if denoise:
        g = g.filter(ImageFilter.MedianFilter(size=3))
    return g


def otsu_threshold(gray: Image.Image) -> int:
    hist = gray.histogram()
    total = sum(hist) or 1
    sum_all = sum(i * hist[i] for i in range(256))
    sum_b = 0
    w_b = 0
    max_var = -1.0
    thresh = 127
    for i in range(256):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += i * hist[i]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > max_var:
            max_var = var
            thresh = i
    return thresh


def ink_mask(gray: Image.Image) -> tuple[list[list[bool]], int]:
    """Dark ink on light background → True where ink is."""
    if gray.size[0] < 2 or gray.size[1] < 2:
        w, h = gray.size
        return [[False] * w for _ in range(h)], 127
    pixels = gray.load()
    w, h = gray.size
    acc = 0
    for y in range(h):
        for x in range(w):
            acc += pixels[x, y]
    mean = acc / (w * h)
    work = gray
    if mean < 110:
        work = ImageOps.invert(gray)
        pixels = work.load()
    thresh = otsu_threshold(work)
    mask = [[pixels[x, y] < thresh for x in range(w)] for y in range(h)]
    return mask, thresh


class Blob:
    __slots__ = ("x0", "y0", "x1", "y1", "area")

    def __init__(self, x0: int, y0: int, x1: int, y1: int, area: int):
        self.x0 = x0
        self.y0 = y0
        self.x1 = x1
        self.y1 = y1
        self.area = area

    @property
    def w(self) -> int:
        return self.x1 - self.x0 + 1

    @property
    def h(self) -> int:
        return self.y1 - self.y0 + 1

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    def as_box(self) -> tuple[int, int, int, int]:
        return self.x0, self.y0, self.x1 + 1, self.y1 + 1


def connected_blobs(
    mask: list[list[bool]],
    min_area: int = 16,
    max_area: int | None = None,
) -> list[Blob]:
    if not mask or not mask[0]:
        return []
    h = len(mask)
    w = len(mask[0])
    seen = [bytearray(w) for _ in range(h)]
    out: list[Blob] = []
    for y in range(h):
        row = mask[y]
        srow = seen[y]
        for x in range(w):
            if not row[x] or srow[x]:
                continue
            stack = [(x, y)]
            srow[x] = 1
            x0 = x1 = x
            y0 = y1 = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                if cx < x0:
                    x0 = cx
                elif cx > x1:
                    x1 = cx
                if cy < y0:
                    y0 = cy
                elif cy > y1:
                    y1 = cy
                for nx, ny in (
                    (cx - 1, cy),
                    (cx + 1, cy),
                    (cx, cy - 1),
                    (cx, cy + 1),
                ):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    if seen[ny][nx] or not mask[ny][nx]:
                        continue
                    seen[ny][nx] = 1
                    stack.append((nx, ny))
            if area < min_area:
                continue
            if max_area is not None and area > max_area:
                continue
            out.append(Blob(x0, y0, x1, y1, area))
    out.sort(key=lambda b: (b.x0, b.y0))
    return out


def crop_pad(img: Image.Image, box: tuple[int, int, int, int], pad: int = 1) -> Image.Image:
    w, h = img.size
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(w, x1 + pad)
    y1 = min(h, y1 + pad)
    return img.crop((x0, y0, x1, y1))
