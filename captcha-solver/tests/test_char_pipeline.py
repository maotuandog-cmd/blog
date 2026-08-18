"""Unit tests for char_pipeline C0–C4 (no YOLO weights required)."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from PIL import Image

from solvers.char_pipeline import assemble_positions, recognize_box
from solvers.fusion import apply_fusion
from solvers.yolo_ocr import yolo_ocr_from_boxes


def _box(x1=10, y1=10, x2=30, y2=40, conf=0.9):
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "confidence": conf}


class CharPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.img = Image.new("RGB", (120, 60), color=(240, 240, 240))

    def test_c0_single_pad(self) -> None:
        with patch("solvers.char_pipeline._ocr_crop", return_value="A"):
            rec = recognize_box(self.img, _box(), level="c0")
        self.assertEqual(rec["selected"], "A")
        self.assertEqual(rec["pads"], [0.0])
        self.assertEqual(len(rec["candidates"]), 1)

    def test_c1_multi_pad_vote(self) -> None:
        # pad0 → X, pad5/10/15 → K → K wins
        seq = iter(["X", "K", "K", "K"])

        def fake(_crop):
            return next(seq)

        with patch("solvers.char_pipeline._ocr_crop", side_effect=fake):
            with patch.dict(os.environ, {"HERMES_CAPTCHA_CROP_PADS": "0,0.05,0.10,0.15"}):
                rec = recognize_box(self.img, _box(), level="c1")
        self.assertEqual(rec["selected"], "K")
        self.assertGreaterEqual(len(rec["pads"]), 4)

    def test_c2_records_views(self) -> None:
        with patch("solvers.char_pipeline._ocr_crop", return_value="K"):
            rec = recognize_box(self.img, _box(), level="c2")
        self.assertEqual(rec["pads"], [0.0])
        views = [v["view"] for v in rec["views"]]
        # Exactly 4 views: gray / upscale / contrast / binary
        self.assertEqual(len(rec["views"]), 4)
        self.assertTrue(any("gray" in v for v in views))
        self.assertTrue(any("upscale" in v for v in views))
        self.assertTrue(any("binary" in v for v in views))
        self.assertEqual(len(rec["candidates"]), 1)  # no Top-K list on C2

    def test_c3_topk(self) -> None:
        seq = iter(["K", "K", "X", "R", "K", "X", "K", "R"] * 3)

        def fake(_crop):
            return next(seq)

        with patch("solvers.char_pipeline._ocr_crop", side_effect=fake):
            with patch.dict(os.environ, {"HERMES_CAPTCHA_CHAR_TOPK": "3"}):
                rec = recognize_box(self.img, _box(), level="c3")
        self.assertGreaterEqual(len(rec["candidates"]), 2)
        self.assertEqual(rec["candidates"][0]["char"], "K")

    def test_c4_gate_retry_on_low_score(self) -> None:
        # Split votes → low margin → RETRY
        seq = iter(["A", "B", "A", "B"] * 8)

        def fake(_crop):
            return next(seq)

        with patch("solvers.char_pipeline._ocr_crop", side_effect=fake):
            with patch.dict(
                os.environ,
                {
                    "HERMES_CAPTCHA_CHAR_MIN_MARGIN": "0.20",
                    "HERMES_CAPTCHA_CROP_PADS": "0",
                },
            ):
                out = assemble_positions(self.img, [_box()], level="c4")
        self.assertFalse(out["charGate"]["ok"])
        self.assertEqual(out["charGate"]["action"], "retry")
        self.assertTrue(out["charGate"]["positions"])
        self.assertEqual(out["charGate"]["positions"][0]["reason"], "LOW_MARGIN")

    def test_c4_high_conf_pass(self) -> None:
        with patch("solvers.char_pipeline._ocr_crop", return_value="K"):
            out = assemble_positions(self.img, [_box()], level="c4")
        self.assertTrue(out["charGate"]["ok"])
        self.assertEqual(out["text"], "K")
        self.assertEqual(out["charGate"]["positions"][0]["reason"], "HIGH_CONF")

    def test_yolo_ocr_keeps_c0_on_c4(self) -> None:
        boxes = [_box(10, 10, 30, 40), _box(40, 10, 60, 40)]
        calls = {"n": 0}

        def fake_ocr(crop):
            calls["n"] += 1
            return "A" if calls["n"] % 2 else "B"

        with patch("solvers.char_pipeline._ocr_crop", side_effect=fake_ocr):
            with patch("solvers.yolo_ocr.refine_boxes", return_value=(boxes, [])):
                with patch.dict(os.environ, {"HERMES_CAPTCHA_CHAR_PIPELINE": "c4"}):
                    out = yolo_ocr_from_boxes(self.img, boxes)
        self.assertEqual(out["pipeline"], "c4")
        self.assertIn("c0Text", out)
        self.assertEqual(out["text"], out["c0Text"])

    def test_yolo_ocr_c3_shadow_keeps_c0(self) -> None:
        boxes = [_box(10, 10, 30, 40)]
        with patch("solvers.char_pipeline._ocr_crop", return_value="K"):
            with patch("solvers.yolo_ocr.refine_boxes", return_value=(boxes, [])):
                with patch.dict(
                    os.environ,
                    {
                        "HERMES_CAPTCHA_CHAR_PIPELINE": "c3",
                        "HERMES_CAPTCHA_CHAR_TOPK": "3",
                    },
                ):
                    out = yolo_ocr_from_boxes(self.img, boxes)
        self.assertEqual(out["pipeline"], "c3")
        self.assertEqual(out["text"], out["c0Text"])
        self.assertGreaterEqual(len((out["characters"][0].get("candidates") or [])), 1)

    def test_c4_shadow_matrix_fields(self) -> None:
        result = {
            "text": "AB",
            "solved": True,
            "decision": "accept",
            "yoloOcr": {
                "pipeline": "c4",
                "c0Text": "AB",
                "c4Text": "AB",
                "provisionalText": "AB",
                "charGate": {
                    "ok": True,
                    "action": "pass",
                    "reason": "ALL_PASS",
                    "minMargin": 0.2,
                    "minAgree": 0.5,
                },
            },
        }
        apply_fusion(result, mode="shadow")
        self.assertEqual(result["actualDecision"]["source"], "c0")
        self.assertEqual(result["shadowDecision"]["source"], "c4")
        self.assertEqual(result["charShadowMatrix"]["cell"], "C0_PASS_C4_PASS")


if __name__ == "__main__":
    unittest.main()
