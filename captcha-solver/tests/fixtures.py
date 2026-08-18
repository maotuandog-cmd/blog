"""In-memory sample captchas for engine tests (repo gitignores *.png)."""
from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

from solvers.preprocess import find_font


def _font(size: int) -> ImageFont.ImageFont:
    path = find_font()
    if path:
        return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def to_b64(img: Image.Image) -> str:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def text_captcha(text: str = "AB12") -> Image.Image:
    img = Image.new("RGB", (168, 52), (245, 245, 248))
    draw = ImageDraw.Draw(img)
    font = _font(32)
    x = 10
    for ch in text:
        draw.text((x, 6), ch, fill=(20, 20, 30), font=font)
        x += 36
    return img


def slider_captcha(offset: int = 168) -> Image.Image:
    img = Image.new("RGB", (320, 110), (230, 232, 236))
    draw = ImageDraw.Draw(img)
    draw.rectangle((8, 78, 312, 102), fill=(200, 204, 210))
    piece = (12, 18, 60, 66)
    hole_x = 12 + offset
    hole = (hole_x, 18, hole_x + 48, 66)
    draw.rectangle(piece, fill=(40, 90, 170))
    draw.rectangle(hole, fill=(90, 90, 95))
    return img


def click_captcha() -> tuple[Image.Image, list[tuple[int, int]]]:
    img = Image.new("RGB", (360, 160), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    centers = [(70, 80), (160, 80), (250, 80)]
    for i, (x, y) in enumerate(centers, start=1):
        draw.ellipse((x - 22, y - 22, x + 22, y + 22), fill=(204, 51, 51))
        draw.text((x - 6, y - 12), str(i), fill=(255, 255, 255), font=_font(22))
    return img, centers


def blank() -> Image.Image:
    return Image.new("RGB", (80, 32), (255, 255, 255))


def color_rotated_captcha(text: str = "A8bV") -> Image.Image:
    """Colored + tilted glyphs, similar to 51yunwei DCP-style image captchas."""
    img = Image.new("RGB", (200, 56), (255, 255, 255))
    font = _font(28)
    colors = [(30, 70, 180), (40, 160, 70), (40, 160, 70), (200, 80, 40)]
    angles = [-25, 8, -12, 30]
    x = 12
    for i, ch in enumerate(text):
        canvas = Image.new("RGBA", (48, 52), (255, 255, 255, 0))
        ImageDraw.Draw(canvas).text((6, 4), ch, fill=(*colors[i % 4], 255), font=font)
        rot = canvas.rotate(angles[i % 4], expand=True, fillcolor=(255, 255, 255, 0))
        img.paste(rot, (x, 2), rot)
        x += 42
    return img.convert("RGB")
