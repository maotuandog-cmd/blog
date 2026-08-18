#!/usr/bin/env python3
"""Train YOLO11n character detector on datasets/demo_char_detect.

Usage:
  captcha-solver/.venv/bin/pip install -r requirements-yolo.txt
  captcha-solver/.venv/bin/python scripts/train_yolo_char.py

Env:
  EPOCHS=40  IMGSZ=320  BATCH=16  MODEL=yolo11n.pt
  DATA=datasets/demo_char_detect/data.yaml
  PROJECT=runs/detect  NAME=demo_char_v1
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

DATA = Path(os.environ.get("DATA") or ROOT / "datasets/demo_char_detect/data.yaml")
MODEL = os.environ.get("MODEL") or "yolo11n.pt"
EPOCHS = int(os.environ.get("EPOCHS") or "40")
IMGSZ = int(os.environ.get("IMGSZ") or "320")
BATCH = int(os.environ.get("BATCH") or "16")
PROJECT = os.environ.get("PROJECT") or str(ROOT / "runs/detect")
NAME = os.environ.get("NAME") or "demo_char_v1"
DEVICE = os.environ.get("DEVICE") or ""  # empty = auto


def main() -> int:
    if not DATA.is_file():
        print(f"missing data.yaml: {DATA}", file=sys.stderr)
        return 1
    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            "ultralytics not installed. Run:\n"
            "  .venv/bin/pip install -r requirements-yolo.txt",
            file=sys.stderr,
        )
        return 1

    print(f"train data={DATA} model={MODEL} epochs={EPOCHS} imgsz={IMGSZ} batch={BATCH}")
    model = YOLO(MODEL)
    kwargs = dict(
        data=str(DATA),
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,
        project=PROJECT,
        name=NAME,
        exist_ok=True,
        patience=15,
        save=True,
        plots=True,
        single_cls=True,
    )
    if DEVICE:
        kwargs["device"] = DEVICE
    results = model.train(**kwargs)
    best = Path(PROJECT) / NAME / "weights" / "best.pt"
    print(f"best weights: {best} exists={best.is_file()}")
    if best.is_file():
        print(f"export HERMES_CAPTCHA_YOLO_WEIGHTS={best}")
        print("export HERMES_CAPTCHA_DETECT=yolo")
    return 0 if best.is_file() else 0


if __name__ == "__main__":
    raise SystemExit(main())
