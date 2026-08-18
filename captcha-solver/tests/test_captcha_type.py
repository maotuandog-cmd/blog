"""E2-A captcha type detector unit tests (observation only)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from solvers.captcha_type import (  # noqa: E402
    CLICK,
    SLIDER,
    TEXT_DISTORTED,
    TEXT_SIMPLE,
    detect_captcha_type,
)
from solvers.decision import decide_ocr_candidate  # noqa: E402


def _blank(w=200, h=60, color=(245, 245, 245)) -> Image.Image:
    return Image.new("RGB", (w, h), color)


class CaptchaTypeTests(unittest.TestCase):
    def test_slider_coarse_kind(self) -> None:
        out = detect_captcha_type(_blank(), coarse_kind="slider", coarse_confidence=0.9)
        self.assertEqual(out["type"], SLIDER)
        self.assertFalse(out["routingHint"]["recommendSecondary"])
        self.assertFalse(out["routingHint"]["applied"])
        self.assertTrue(out["observationOnly"])

    def test_click_coarse_kind(self) -> None:
        out = detect_captcha_type(_blank(), coarse_kind="click", coarse_confidence=0.88)
        self.assertEqual(out["type"], CLICK)
        self.assertFalse(out["routingHint"]["recommendSecondary"])

    def test_colorful_text_tends_distorted(self) -> None:
        img = _blank()
        d = ImageDraw.Draw(img)
        # saturated ink strokes
        for i, c in enumerate([(220, 40, 40), (40, 180, 40), (40, 40, 220), (200, 120, 20)]):
            d.text((12 + i * 40, 18), "A", fill=c)
        out = detect_captcha_type(img, coarse_kind="image", coarse_confidence=0.7)
        self.assertEqual(out["type"], TEXT_DISTORTED)
        self.assertTrue(out["routingHint"]["recommendSecondary"])
        self.assertIn("features", out)
        self.assertIn("tags", out["features"])

    def test_plain_dark_text_tends_simple(self) -> None:
        img = _blank()
        d = ImageDraw.Draw(img)
        d.text((20, 18), "Ab12Cd", fill=(20, 20, 20))
        out = detect_captcha_type(img, coarse_kind="image", coarse_confidence=0.7)
        # May be simple or distorted depending on font raster noise; must be a text type.
        self.assertIn(out["type"], (TEXT_SIMPLE, TEXT_DISTORTED))
        self.assertEqual(out["routingHint"]["applied"], False)

    def test_decision_ignores_captcha_type(self) -> None:
        with patch.dict(
            "os.environ",
            {"HERMES_CAPTCHA_OCR_DECORRELATE": "0", "HERMES_CAPTCHA_OCR_SINGLETON_GATE": "0"},
        ):
            out = decide_ocr_candidate(
                {
                    "text": "abcdef",
                    "evidenceScore": 0.9,
                    "agreementScore": 1.0,
                    "independentSources": 1,
                    "votes": 1,
                    "captchaType": {
                        "type": TEXT_DISTORTED,
                        "routingHint": {"recommendSecondary": True, "applied": False},
                    },
                },
                threshold=0.5,
            )
            self.assertEqual(out["decision"], "accept")


if __name__ == "__main__":
    unittest.main()
