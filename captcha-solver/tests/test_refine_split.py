"""P2.3 sticky-character refine split unit tests."""
from __future__ import annotations

import unittest

from PIL import Image, ImageDraw, ImageFont

from solvers.refine_split import is_wide_box, refine_boxes, split_wide_box
from solvers.yolo_ocr import yolo_ocr_from_boxes


def _two_glyphs_image() -> Image.Image:
    """Two solid ink blobs with a clear gap (easy projection cut)."""
    img = Image.new("RGB", (100, 36), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle((6, 6, 28, 30), fill=(20, 20, 20))
    d.rectangle((42, 6, 64, 30), fill=(20, 20, 20))
    return img


class RefineSplitTests(unittest.TestCase):
    def test_wide_ratio(self) -> None:
        self.assertTrue(
            is_wide_box({"x1": 0, "y1": 0, "x2": 40, "y2": 20, "confidence": 0.9})
        )
        self.assertFalse(
            is_wide_box({"x1": 0, "y1": 0, "x2": 12, "y2": 20, "confidence": 0.9})
        )

    def test_split_wide_box_projection(self) -> None:
        img = _two_glyphs_image()
        # One wide box covering both glyphs
        box = {"x1": 2, "y1": 2, "x2": 70, "y2": 34, "confidence": 0.92, "class": "character"}
        ev = split_wide_box(img, box)
        self.assertTrue(ev["split"], msg=ev)
        self.assertGreaterEqual(ev["parts"], 2)
        self.assertIn(ev["method"], ("vertical_projection", "connected_component"))
        self.assertEqual(len(ev["boxes"]), ev["parts"])

    def test_refine_boxes_records_event(self) -> None:
        img = _two_glyphs_image()
        boxes = [
            {"x1": 2, "y1": 2, "x2": 70, "y2": 34, "confidence": 0.9, "class": "character"},
            {"x1": 78, "y1": 8, "x2": 92, "y2": 28, "confidence": 0.88, "class": "character"},
        ]
        refined, events = refine_boxes(img, boxes)
        self.assertTrue(any(e.get("status") == "ok" for e in events), msg=events)
        self.assertGreater(len(refined), len(boxes))

    def test_yolo_ocr_includes_split_events(self) -> None:
        img = _two_glyphs_image()
        boxes = [
            {"x1": 2, "y1": 2, "x2": 70, "y2": 34, "confidence": 0.9, "class": "character"},
        ]
        out = yolo_ocr_from_boxes(img, boxes)
        self.assertIn("splitEvents", out)
        self.assertGreaterEqual(out.get("boxesUsed") or 0, 1)


if __name__ == "__main__":
    unittest.main()
