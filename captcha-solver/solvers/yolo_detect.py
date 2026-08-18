"""YOLO character detector adapter — optional weights (REQ visual datalayer).

No weights ⇒ empty boxes + status skipped. Never fails the whole pipeline.
"""
from __future__ import annotations

import os
from typing import Any

_model = None
_model_err: str | None = None


def yolo_weights_path() -> str:
    raw = (os.environ.get("HERMES_CAPTCHA_YOLO_WEIGHTS") or "").strip()
    if raw:
        return raw
    # Local convention after demo_char training (no env required).
    try:
        from pathlib import Path

        cand = (
            Path(__file__).resolve().parents[1]
            / "runs"
            / "detect"
            / "demo_char_v1"
            / "weights"
            / "best.pt"
        )
        if cand.is_file():
            return str(cand)
    except Exception:
        pass
    return ""


def detect_mode() -> str:
    """off | yolo | auto (auto = yolo if weights else off)."""
    raw = (os.environ.get("HERMES_CAPTCHA_DETECT") or "auto").strip().lower()
    if raw in ("off", "0", "false", "no"):
        return "off"
    if raw in ("yolo", "on", "1", "true"):
        return "yolo"
    return "auto"


def yolo_model_version() -> str:
    path = yolo_weights_path()
    if not path:
        return "none"
    return os.path.basename(path)


def _load_model():
    global _model, _model_err
    if _model is not None or _model_err:
        return _model
    path = yolo_weights_path()
    if not path or not os.path.isfile(path):
        _model_err = "no_weights"
        return None
    try:
        from ultralytics import YOLO  # type: ignore

        _model = YOLO(path)
        return _model
    except Exception as exc:  # noqa: BLE001
        _model_err = type(exc).__name__ + ":" + str(exc)[:120]
        return None


def detect_characters(img) -> dict[str, Any]:
    """Return {engine, boxes[{x1,y1,x2,y2,confidence,class}], status, reason?}."""
    mode = detect_mode()
    if mode == "off":
        return {
            "engine": "none",
            "boxes": [],
            "status": "skipped",
            "reason": "detect_off",
            "modelVersion": "none",
        }

    want_yolo = mode == "yolo" or (mode == "auto" and bool(yolo_weights_path()))
    if not want_yolo:
        return {
            "engine": "none",
            "boxes": [],
            "status": "skipped",
            "reason": "no_weights",
            "modelVersion": "none",
        }

    model = _load_model()
    if model is None:
        return {
            "engine": "yolo",
            "boxes": [],
            "status": "skipped",
            "reason": _model_err or "load_failed",
            "modelVersion": yolo_model_version(),
        }

    try:
        import numpy as np

        arr = np.array(img.convert("RGB"))
        conf = float(os.environ.get("HERMES_CAPTCHA_YOLO_CONF") or "0.25")
        results = model.predict(arr, conf=conf, verbose=False)
        boxes: list[dict[str, Any]] = []
        if results:
            r0 = results[0]
            if getattr(r0, "boxes", None) is not None:
                for b in r0.boxes:
                    xyxy = b.xyxy[0].tolist()
                    c = float(b.conf[0]) if b.conf is not None else 0.0
                    boxes.append(
                        {
                            "x1": round(float(xyxy[0]), 2),
                            "y1": round(float(xyxy[1]), 2),
                            "x2": round(float(xyxy[2]), 2),
                            "y2": round(float(xyxy[3]), 2),
                            "confidence": round(c, 4),
                            "class": "character",
                        }
                    )
        boxes.sort(key=lambda x: x["x1"])
        avg_conf = (
            sum(b["confidence"] for b in boxes) / len(boxes) if boxes else None
        )
        return {
            "engine": "yolo",
            "boxes": boxes,
            "status": "ok",
            "modelVersion": yolo_model_version(),
            "detected_chars": len(boxes),
            "avgConfidence": avg_conf,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "engine": "yolo",
            "boxes": [],
            "status": "error",
            "reason": type(exc).__name__,
            "modelVersion": yolo_model_version(),
        }
