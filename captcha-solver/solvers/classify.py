"""Capability router: do not send every captcha to one model."""
from __future__ import annotations

from PIL import Image

from . import click, ocr, slider

KINDS = ("image", "click", "slider")


def requested_kind(req: dict) -> str:
    raw = req.get("kind") or req.get("type") or "auto"
    k = str(raw).lower().strip()
    if k in KINDS or k == "auto":
        return k
    return "auto"


def hint_guess(req: dict) -> str:
    hint = req.get("hint") if isinstance(req.get("hint"), dict) else {}
    g = str(hint.get("kindGuess") or hint.get("kind") or "").lower().strip()
    return g if g in KINDS else ""


def classify(img: Image.Image, req: dict) -> tuple[str, float]:
    forced = requested_kind(req)
    if forced in KINDS:
        return forced, 0.99
    guess = hint_guess(req)
    if guess:
        return guess, 0.86

    scores = {
        "click": click.feature_score(img),
        "slider": slider.feature_score(img),
        "image": ocr.feature_score(img),
    }
    kind = max(scores, key=lambda k: scores[k])
    return kind, scores[kind]
