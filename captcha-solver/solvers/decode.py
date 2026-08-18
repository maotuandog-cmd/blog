"""Decode Worker / alias screenshot payloads. Never log the bytes."""
from __future__ import annotations

import base64
import hashlib
from io import BytesIO

from PIL import Image


def extract_b64(req: dict) -> str:
    for key in ("screenshotBase64", "screenshot_base64", "imageBase64", "image"):
        val = req.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def decode_b64_raw(b64: str) -> bytes:
    raw = b64.split(",", 1)[-1]
    data = base64.b64decode(raw)
    if not data:
        raise ValueError("empty screenshot")
    return data


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_image(b64: str) -> Image.Image:
    data = decode_b64_raw(b64)
    img = Image.open(BytesIO(data))
    img.load()
    return img.convert("RGB")


def decode_image_with_hash(b64: str) -> tuple[Image.Image, str, bytes]:
    data = decode_b64_raw(b64)
    img = Image.open(BytesIO(data))
    img.load()
    return img.convert("RGB"), sha256_bytes(data), data
