"""Trace binding + S0 + YOLO adapter unit tests."""
from __future__ import annotations

import base64
import io
import os
import unittest

from PIL import Image, ImageDraw

from solvers.decode import sha256_bytes
from solvers.dispatch import solve_request
from solvers.feedback import clear_attempt_cache, record_feedback
from solvers.s0_baseline import evaluate_s0
from solvers.yolo_detect import detect_characters


def _png_b64(img: Image.Image) -> tuple[str, str]:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    return base64.b64encode(raw).decode("ascii"), sha256_bytes(raw)


class TraceBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_attempt_cache()
        os.environ["HERMES_CAPTCHA_DETECT"] = "off"

    def test_attempt_and_hash_echo(self) -> None:
        img = Image.new("RGB", (80, 32), (255, 255, 255))
        ImageDraw.Draw(img).text((8, 8), "A", fill=(0, 0, 0))
        b64, h = _png_b64(img)
        out = solve_request(
            {
                "jobId": "j1",
                "sessionId": "s_trace",
                "attemptId": "att_fixed_1",
                "imageHash": h,
                "timestamp": 1,
                "kind": "image",
                "screenshotBase64": b64,
            }
        )
        self.assertEqual(out.get("attemptId"), "att_fixed_1")
        self.assertEqual(out.get("imageHash"), h)
        obs = out.get("observation") or {}
        self.assertTrue(obs.get("pipelineTrace"))
        stages = (obs.get("pipelineTrace") or {}).get("stages") or []
        names = [s.get("stage") for s in stages]
        self.assertIn("decode", names)
        self.assertIn("s0", names)

    def test_hash_mismatch(self) -> None:
        img = Image.new("RGB", (40, 20), (255, 255, 255))
        b64, h = _png_b64(img)
        out = solve_request(
            {
                "attemptId": "att_bad_hash",
                "imageHash": "0" * 64,
                "kind": "image",
                "screenshotBase64": b64,
            }
        )
        self.assertFalse(out.get("solved"))
        self.assertEqual(out.get("reason"), "image_hash_mismatch")
        self.assertEqual(out.get("imageHash"), h)

    def test_feedback_attempt_only(self) -> None:
        img = Image.new("RGB", (40, 20), (255, 255, 255))
        b64, h = _png_b64(img)
        out = solve_request(
            {
                "sessionId": "s_fb",
                "attemptId": "att_fb_only",
                "imageHash": h,
                "kind": "image",
                "screenshotBase64": b64,
            }
        )
        fb = record_feedback(
            {
                "attemptId": out["attemptId"],
                "siteResult": "failed",
                "failReason": "captcha_wrong",
            }
        )
        self.assertTrue(fb.get("ok"))
        self.assertTrue(fb.get("linked"))


class S0Tests(unittest.TestCase):
    def test_s0_does_not_gate(self) -> None:
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "confidence": 0.9},
            {"x1": 12, "y1": 0, "x2": 22, "y2": 10, "confidence": 0.9},
            {"x1": 24, "y1": 0, "x2": 34, "y2": 10, "confidence": 0.9},
            {"x1": 36, "y1": 0, "x2": 46, "y2": 10, "confidence": 0.9},
            {"x1": 48, "y1": 0, "x2": 58, "y2": 10, "confidence": 0.9},
        ]
        s0 = evaluate_s0(boxes=boxes, raw_text="ABCDE", allowed=[4, 5, 6])
        self.assertTrue(s0["pass"])
        self.assertFalse(s0["gatesSubmit"])
        self.assertTrue(s0["observationOnly"])


class YoloAdapterTests(unittest.TestCase):
    def test_no_weights_skips(self) -> None:
        os.environ["HERMES_CAPTCHA_DETECT"] = "auto"
        os.environ.pop("HERMES_CAPTCHA_YOLO_WEIGHTS", None)
        import solvers.yolo_detect as yd

        yd._model = None
        yd._model_err = None
        img = Image.new("RGB", (64, 32), (255, 255, 255))
        det = detect_characters(img)
        self.assertEqual(det.get("status"), "skipped")
        self.assertEqual(det.get("boxes"), [])


if __name__ == "__main__":
    unittest.main()
