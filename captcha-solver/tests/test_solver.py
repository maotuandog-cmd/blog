from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import SolverHandler  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

from solvers.dispatch import solve_request  # noqa: E402
from solvers.ocr import (  # noqa: E402
    ddddocr_available,
    fuse_ocr_votes,
    gate_on_agreement,
    normalize_captcha_text,
)
from tests.fixtures import blank, click_captcha, color_rotated_captcha, slider_captcha, text_captcha, to_b64  # noqa: E402


class EngineTests(unittest.TestCase):
    def test_ocr_ab12(self) -> None:
        """T-Ocr-01: template still reads fixture AB12."""
        img = text_captcha("AB12")
        out = solve_request({"kind": "image", "ocrMode": "template", "screenshotBase64": to_b64(img)})
        self.assertTrue(out["solved"], out)
        self.assertEqual(out["kind"], "image")
        self.assertEqual(out["text"], "AB12")
        self.assertEqual(out.get("engine"), "template")

    @unittest.skipUnless(ddddocr_available(), "ddddocr not installed")
    def test_ocr_ddddocr_sample(self) -> None:
        """T-Ocr-02 / T-Acc-02: ddddocr + vote; confidence is not a stub 0.8."""
        img = text_captcha("AB12")
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR": "auto"}):
            out = solve_request({"kind": "image", "screenshotBase64": to_b64(img)})
        self.assertTrue(out["solved"], out)
        self.assertEqual(out.get("engine"), "ddddocr")
        self.assertEqual(str(out.get("text") or "").strip().casefold(), "ab12")
        self.assertIsInstance(out.get("votes"), int)
        self.assertGreaterEqual(int(out["votes"]), 1)
        self.assertTrue(out.get("preprocess"))
        self.assertGreaterEqual(float(out["confidence"]), 0.5)
        self.assertLessEqual(float(out["confidence"]), 1.0)

        color = color_rotated_captcha("A8bV")
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR": "auto"}):
            color_out = solve_request({"kind": "image", "screenshotBase64": to_b64(color)})
        if color_out.get("solved"):
            self.assertEqual(color_out.get("engine"), "ddddocr", color_out)
            self.assertEqual(str(color_out.get("text") or "").strip().casefold(), "a8bv")
        else:
            # T-Acc-03: unsolved is OK; must not fill a wrong guessed string.
            self.assertFalse(str(color_out.get("text") or "").strip(), color_out)

    def test_agreement_gate(self) -> None:
        """E2: fused winner needs dual support when both engines have readings."""
        hit = {
            "solved": True,
            "kind": "image",
            "text": "abc123",
            "confidence": 1.0,
            "engine": "ddddocr",
            "preprocess": "raw",
            "votes": 1,
        }
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HERMES_CAPTCHA_OCR_AGREE_RELAX", None)
            os.environ.pop("HERMES_CAPTCHA_OCR_AGREE_MIN", None)
            # Both sides present but beta never said winner → abstain
            one_sided = gate_on_agreement(
                hit,
                [("raw", "abc123")],
                [("raw+beta", "xyz789")],
            )
            self.assertFalse(one_sided["solved"])
            self.assertEqual(one_sided["decision"], "abstain")
            self.assertEqual(one_sided["agreement"], 0.0)

            # Beta produced nothing → degrade to E1 accept
            no_beta = gate_on_agreement(hit, [("raw", "abc123")], [])
            self.assertTrue(no_beta["solved"])
            self.assertEqual(no_beta["decision"], "accept")
            self.assertIsNone(no_beta.get("agreement"))

            # Both engines emitted winner
            dual = gate_on_agreement(
                {**hit, "confidence": 0.8},
                [("raw", "abc123"), ("up2", "abc123")],
                [("raw+beta", "abc123"), ("up2+beta", "zz9999")],
            )
            self.assertTrue(dual["solved"], dual)
            self.assertEqual(dual["agreement"], 1.0)
            self.assertEqual(dual["text"], "abc123")

        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_AGREE_RELAX": "1"}):
            relaxed = gate_on_agreement(
                hit,
                [("raw", "abc123")],
                [("raw+beta", "xyz789")],
            )
            self.assertTrue(relaxed["solved"])
            self.assertEqual(relaxed["decision"], "accept")

    def test_soft_conf_e1_default(self) -> None:
        from solvers.ocr import soft_conf

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HERMES_CAPTCHA_OCR_SOFT_CONF", None)
            self.assertAlmostEqual(soft_conf(), 0.45)  # E1 default
        with patch.dict(
            os.environ,
            {"HERMES_CAPTCHA_OCR_MIN_CONF": "0.5", "HERMES_CAPTCHA_OCR_SOFT_CONF": "0.50"},
        ):
            self.assertAlmostEqual(soft_conf(), 0.50)

    def test_normalize_and_vote(self) -> None:
        """T-Acc: charset/length filter + majority vote + singleton rules."""
        self.assertEqual(normalize_captcha_text(" a8bv "), "a8bv")
        self.assertEqual(normalize_captcha_text("ab12!!"), "ab12")
        self.assertEqual(normalize_captcha_text("ab"), "")
        self.assertEqual(normalize_captcha_text("O→0-toolongtext"), "")
        self.assertEqual(normalize_captcha_text("口7m9nu"), "7m9nu")  # strip CJK, keep ASCII
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_LEN": "6"}):
            self.assertEqual(normalize_captcha_text("abc12"), "")
            self.assertEqual(normalize_captcha_text("abc123"), "abc123")
            self.assertEqual(normalize_captcha_text("口7m9nu"), "")  # len 5 after strip
            # Exact-len singleton is NOT trusted as confidence=1.0 (S1 freeze).
            lone6 = fuse_ocr_votes([("raw", "abc123")], attempts=6, threshold=0.5)
            self.assertIsNone(lone6)
            # Low threshold still exposes evidenceScore = weightScore/n_try (1/6).
            lone6_soft = fuse_ocr_votes([("raw", "abc123")], attempts=6, threshold=0.1)
            self.assertIsNotNone(lone6_soft)
            assert lone6_soft is not None
            self.assertEqual(lone6_soft["text"], "abc123")
            self.assertAlmostEqual(lone6_soft["evidenceScore"], 1.0 / 6.0, places=4)
            self.assertAlmostEqual(lone6_soft["weightShare"], 1.0, places=4)
            self.assertNotAlmostEqual(lone6_soft["confidence"], 1.0)
        with patch.dict(
            os.environ,
            {"HERMES_CAPTCHA_OCR_CHARSET": "23456789abcdefghijkmnopqrstuvwxyz"},
        ):
            self.assertEqual(normalize_captcha_text("ab1O"), "")  # 1/O stripped → len 2
            self.assertEqual(normalize_captcha_text("ab23cd"), "ab23cd")
            # Uppercase L is not in lowercase-only charset (no l↔L casefold).
            self.assertEqual(normalize_captcha_text("abLLcd"), "abcd")
        hit = fuse_ocr_votes(
            [("raw", "a8bv"), ("up2", "a8bv"), ("gray", "a8bX"), ("bin", "a8bv")],
            attempts=4,
            threshold=0.5,
        )
        # F2-C: single-source partial agreement (3/4) → ABSTAIN (was false-ACCEPT fuel).
        self.assertIsNone(hit)
        unanimous = fuse_ocr_votes(
            [("raw", "a8bv"), ("up2", "a8bv"), ("bin", "a8bv")],
            attempts=3,
            threshold=0.5,
        )
        self.assertIsNotNone(unanimous)
        assert unanimous is not None
        self.assertEqual(unanimous["text"], "a8bv")
        self.assertEqual(unanimous["votes"], 3)
        self.assertEqual(unanimous.get("independentSources"), 1)
        self.assertAlmostEqual(float(unanimous["agreementScore"]), 1.0, places=4)
        self.assertEqual(unanimous["preprocess"], "raw")
        folded = fuse_ocr_votes(
            [("raw", "ab12"), ("up2", "AB12"), ("gray", "ab12")],
            attempts=3,
            threshold=0.5,
        )
        self.assertIsNotNone(folded)
        assert folded is not None
        self.assertEqual(str(folded["text"]).casefold(), "ab12")
        self.assertEqual(folded["votes"], 3)
        lone = fuse_ocr_votes([("raw", "zzzz")], attempts=6, threshold=0.5)
        self.assertIsNone(lone)

    def test_morph_weight_vote(self) -> None:
        """E3: morph_* weight 0.8 cannot outvote two full-weight raw reads.

        F2: single-source split (abc vs zzz) is partial agreement → ABSTAIN;
        unanimous abc across full-weight variants still ACCEPT.
        """
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_MORPH_WEIGHT": "0.8"}):
            split = fuse_ocr_votes(
                [
                    ("raw", "abc123"),
                    ("up2", "abc123"),
                    ("morph_up2", "zzzzzz"),
                    ("morph_up2+beta", "zzzzzz"),
                ],
                attempts=4,
                threshold=0.5,
            )
            # Winner would be abc by weight, but agreement < 1.0 → F2-C abstain.
            self.assertIsNone(split)
            hit = fuse_ocr_votes(
                [
                    ("raw", "abc123"),
                    ("up2", "abc123"),
                    ("morph_up2", "abc123"),
                ],
                attempts=3,
                threshold=0.5,
            )
            self.assertIsNotNone(hit)
            assert hit is not None
            self.assertEqual(hit["text"], "abc123")
            self.assertEqual(hit.get("independentSources"), 1)
            self.assertAlmostEqual(float(hit["agreementScore"]), 1.0, places=4)
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR_MORPH_WEIGHT": "0"}):
            dropped = fuse_ocr_votes(
                [("morph_up2", "zzzzzz"), ("raw", "abc123")],
                attempts=2,
                threshold=0.5,
            )
            self.assertIsNotNone(dropped)
            assert dropped is not None
            self.assertEqual(dropped["text"], "abc123")

    def test_ocr_template_skips_ddddocr(self) -> None:
        """T-Ocr-03: HERMES_CAPTCHA_OCR=template never calls ddddocr."""
        img = text_captcha("AB12")
        with patch("solvers.ocr._try_ddddocr") as mock_dddd:
            out = solve_request({"kind": "image", "ocrMode": "template", "screenshotBase64": to_b64(img)})
        mock_dddd.assert_not_called()
        self.assertEqual(out.get("engine"), "template")
        self.assertEqual(out.get("text"), "AB12")

    def test_ocr_color_rotated(self) -> None:
        img = color_rotated_captcha("A8bV")
        out = solve_request({"kind": "image", "ocrMode": "template", "screenshotBase64": to_b64(img)})
        self.assertFalse(out["solved"], out)
        self.assertIn("color/rotated", str(out.get("reason") or ""))
        self.assertEqual(out.get("engine"), "template")

    @unittest.skipUnless(ddddocr_available(), "ddddocr not installed")
    def test_auto_color_does_not_use_template_refuse(self) -> None:
        """Color captchas must not fall through to template refuse in auto mode."""
        img = color_rotated_captcha("A8bV")
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR": "auto"}):
            out = solve_request({"kind": "image", "screenshotBase64": to_b64(img)})
        self.assertNotIn("color/rotated", str(out.get("reason") or ""), out)
        self.assertNotEqual(out.get("engine"), "template")
        if out.get("solved"):
            self.assertEqual(out.get("engine"), "ddddocr")
            self.assertEqual(str(out.get("text") or "").strip().casefold(), "a8bv")

    def test_slider_offset(self) -> None:
        expected = 168
        img = slider_captcha(expected)
        out = solve_request({"kind": "slider", "screenshotBase64": to_b64(img)})
        self.assertTrue(out["solved"], out)
        self.assertEqual(out["kind"], "slider")
        self.assertLessEqual(abs(int(out["offsetX"]) - expected), 8)

    def test_slider_no_gap_abstains(self) -> None:
        """Unknown geometry must ABSTAIN — no 62% fabricated offset."""
        from solvers.slider import solve_slider

        out = solve_slider(blank())
        self.assertFalse(out.get("solved"))
        self.assertEqual(out.get("decision"), "abstain")
        self.assertNotIn("offsetX", out)

    def test_click_points(self) -> None:
        img, centers = click_captcha()
        out = solve_request({"kind": "click", "screenshotBase64": to_b64(img)})
        self.assertTrue(out["solved"], out)
        pts = out.get("points") or []
        self.assertEqual(len(pts), 3)
        for (ex, ey), got in zip(centers, pts):
            self.assertLessEqual(abs(got["x"] - ex), 8)
            self.assertLessEqual(abs(got["y"] - ey), 8)

    def test_blank_unsolved(self) -> None:
        out = solve_request({"kind": "auto", "screenshotBase64": to_b64(blank())})
        self.assertFalse(out["solved"])
        self.assertIn("reason", out)


class SessionObservationTests(unittest.TestCase):
    """S2: additive session/attempt observation; zero behavior change."""

    def test_passthrough_session_id(self) -> None:
        img = text_captcha("AB12")
        out = solve_request(
            {
                "kind": "image",
                "sessionId": "s_fixed_demo",
                "jobId": "j1",
                "pageUrl": "http://example.test/",
                "screenshotBase64": to_b64(img),
            }
        )
        self.assertEqual(out.get("sessionId"), "s_fixed_demo")
        self.assertTrue(str(out.get("attemptId") or "").startswith("a_"))
        obs = out.get("observation") or {}
        self.assertEqual(obs.get("sessionId"), "s_fixed_demo")
        self.assertEqual(obs.get("attemptId"), out["attemptId"])
        self.assertIn(obs.get("snapshotStatus"), ("ANSWER_READY", "FAILED"))
        self.assertIn("classifier", obs)
        self.assertIn("candidates", obs)
        self.assertIn("decision", obs)
        self.assertEqual(obs["decision"].get("action"), "accept" if out.get("solved") else "abstain")
        self.assertTrue((obs.get("input") or {}).get("imageHash"))

    def test_generates_session_when_missing(self) -> None:
        out = solve_request({"kind": "auto", "screenshotBase64": to_b64(blank())})
        self.assertTrue(str(out.get("sessionId") or "").startswith("s_"))
        self.assertFalse(out.get("solved"))
        obs = out.get("observation") or {}
        self.assertEqual(obs.get("snapshotStatus"), "FAILED")
        self.assertEqual(obs["decision"]["action"], "abstain")
        self.assertTrue(obs.get("failureReason"))

    def test_observation_does_not_change_slider_solved(self) -> None:
        expected = 168
        img = slider_captcha(expected)
        out = solve_request({"kind": "slider", "screenshotBase64": to_b64(img)})
        self.assertTrue(out["solved"], out)
        self.assertLessEqual(abs(int(out["offsetX"]) - expected), 8)
        self.assertEqual(out["observation"]["snapshotStatus"], "ANSWER_READY")
        self.assertEqual(out["observation"]["decision"]["action"], "accept")

    def test_jsonl_optional(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "obs.jsonl"
            with patch.dict(os.environ, {"HERMES_CAPTCHA_OBS_JSONL": str(path)}):
                out = solve_request({"kind": "auto", "screenshotBase64": to_b64(blank())})
            self.assertTrue(path.is_file())
            line = path.read_text(encoding="utf-8").strip().splitlines()[-1]
            rec = json.loads(line)
            self.assertEqual(rec.get("sessionId"), out.get("sessionId"))
            self.assertEqual(rec.get("attemptId"), out.get("attemptId"))
            self.assertIn("observation", rec)

    def test_candidates_from_conflict_fields(self) -> None:
        from solvers.session import build_candidates

        cands = build_candidates(
            {
                "ddddText": "A82K9",
                "vlmText": "A82X9",
                "ddddConfidence": 0.71,
                "vlmConflict": True,
                "solved": False,
            }
        )
        self.assertEqual(len(cands), 2)
        self.assertEqual(cands[0]["source"], "ddddocr")
        self.assertEqual(cands[0]["value"], "A82K9")
        self.assertEqual(cands[1]["source"], "vlm7b")
        self.assertEqual(cands[1]["value"], "A82X9")


class ProfileTests(unittest.TestCase):
    """S5: profile parameter packs; no new decision semantics."""

    def test_builtin_profiles_exist(self) -> None:
        from solvers.profile import list_profile_names, load_profiles

        names = list_profile_names()
        self.assertIn("default", names)
        self.assertIn("demo-strict", names)
        self.assertIn("dcp-wide", names)
        profiles = load_profiles()
        self.assertEqual(profiles["demo-strict"]["ocr"]["len"], 6)
        self.assertIsNone(profiles["dcp-wide"]["ocr"]["len"])
        self.assertEqual(profiles["dcp-wide"]["vlm"]["mode"], "off")

    def test_request_profile_switches_without_restart(self) -> None:
        from solvers.ocr import min_conf, preferred_len
        from solvers.context import clear_profile_settings, get_profile_settings
        from solvers.vlm import vlm_mode

        img = blank()
        out_demo = solve_request(
            {"kind": "auto", "profile": "demo-strict", "screenshotBase64": to_b64(img)}
        )
        self.assertEqual(out_demo.get("profile"), "demo-strict")
        self.assertEqual((out_demo.get("observation") or {}).get("profile"), "demo-strict")

        out_dcp = solve_request(
            {"kind": "auto", "profile": "dcp-wide", "screenshotBase64": to_b64(img)}
        )
        self.assertEqual(out_dcp.get("profile"), "dcp-wide")

        # Context cleared after request
        self.assertFalse(get_profile_settings())

        # Active settings during request verified via resolve
        from solvers.context import set_profile_settings
        from solvers.profile import resolve_active_profile

        set_profile_settings(resolve_active_profile({"profile": "demo-strict"}))
        self.assertEqual(preferred_len(), 6)
        self.assertAlmostEqual(min_conf(), 0.5)
        clear_profile_settings()

        set_profile_settings(resolve_active_profile({"profile": "dcp-wide"}))
        self.assertIsNone(preferred_len())
        self.assertAlmostEqual(min_conf(), 0.45)
        self.assertEqual(vlm_mode(), "off")
        clear_profile_settings()

    def test_profile_overrides_request_fields(self) -> None:
        from solvers.context import clear_profile_settings, set_profile_settings
        from solvers.ocr import min_conf
        from solvers.profile import resolve_active_profile

        set_profile_settings(
            resolve_active_profile(
                {
                    "profile": "demo-strict",
                    "profileOverrides": {"decision": {"minConf": 0.7}},
                }
            )
        )
        self.assertAlmostEqual(min_conf(), 0.7)
        clear_profile_settings()

    def test_retry_hints_still_beat_profile_vlm(self) -> None:
        """Request retryHints (S4) remain highest for VLM off."""
        from solvers.context import clear_profile_settings, clear_retry_hints, set_profile_settings, set_retry_hints
        from solvers.profile import resolve_active_profile
        from solvers.vlm import vlm_mode

        set_profile_settings(resolve_active_profile({"profile": "default"}))
        self.assertEqual(vlm_mode(), "auto")
        set_retry_hints({"vlm": "off"})
        self.assertEqual(vlm_mode(), "off")
        clear_retry_hints()
        clear_profile_settings()


class RetryPolicyTests(unittest.TestCase):
    """S4: failure-class policy; never attempt-ordinal ladder."""

    def test_verify_failed_vs_abstain(self) -> None:
        from solvers.retry_policy import plan_retry

        accept_fail = plan_retry(
            feedback={"status": "failed", "reason": "bad code"},
            decision={"action": "accept"},
            attempt={"index": 1},
            max_attempts_override=2,
        )
        self.assertTrue(accept_fail["retry"])
        self.assertEqual(accept_fail["failureClass"], "VERIFY_FAILED")
        self.assertEqual(accept_fail["nextStrategy"], "fresh_capture")
        self.assertEqual(accept_fail["attemptBudgetRemaining"], 1)

        abstain = plan_retry(
            feedback={"status": "not_executed", "reason": "solver did not return text"},
            decision={"action": "abstain", "reason": "ocr low evidence"},
            attempt={"index": 1},
            max_attempts_override=2,
        )
        self.assertTrue(abstain["retry"])
        self.assertEqual(abstain["failureClass"], "OCR_ABSTAIN")
        self.assertEqual(abstain["nextStrategy"], "alternate_preprocess")
        self.assertNotEqual(abstain["nextStrategy"], accept_fail["nextStrategy"])

    def test_success_stops_and_budget(self) -> None:
        from solvers.retry_policy import plan_retry

        ok = plan_retry(
            feedback={"status": "success"},
            decision={"action": "accept"},
            attempt={"index": 1},
            max_attempts_override=2,
        )
        self.assertFalse(ok["retry"])
        self.assertEqual(ok["nextStrategy"], "stop")

        exhausted = plan_retry(
            feedback={"status": "failed"},
            decision={"action": "accept"},
            attempt={"index": 2},
            max_attempts_override=2,
        )
        self.assertFalse(exhausted["retry"])
        self.assertEqual(exhausted["nextStrategy"], "stop")
        self.assertEqual(exhausted["reason"], "max_attempts_reached")

    def test_conflict_and_unsupported(self) -> None:
        from solvers.retry_policy import plan_retry

        conflict = plan_retry(
            feedback={"status": "not_executed", "reason": "dddd/vlm conflict"},
            decision={"action": "abstain"},
            snap={"vlmConflict": True},
            attempt={"index": 1},
            max_attempts_override=2,
        )
        self.assertEqual(conflict["failureClass"], "MODEL_CONFLICT")
        self.assertEqual(conflict["hints"].get("vlm"), "off")

        unsupported = plan_retry(
            feedback={"status": "not_executed", "reason": "no reliable piece/gap"},
            decision={"action": "abstain"},
            attempt={"index": 1},
            max_attempts_override=2,
        )
        self.assertFalse(unsupported["retry"])
        self.assertEqual(unsupported["nextStrategy"], "remain_abstain")

    def test_feedback_includes_retry_plan_immutable(self) -> None:
        from solvers.feedback import clear_attempt_cache, get_attempt_snapshot, record_feedback

        clear_attempt_cache()
        img = text_captcha("AB12")
        out = solve_request(
            {"kind": "image", "sessionId": "s_s4", "screenshotBase64": to_b64(img)}
        )
        score = out.get("decisionScore")
        conf = out.get("confidence")
        fb = record_feedback(
            {
                "sessionId": out["sessionId"],
                "attemptId": out["attemptId"],
                "attemptIndex": 1,
                "verifyResult": {"status": "failed", "reason": "wrong", "source": "test"},
            }
        )
        self.assertIn("retryPlan", fb)
        self.assertTrue(fb["retryPlan"]["retry"])
        self.assertEqual(fb["retryPlan"]["nextStrategy"], "fresh_capture")
        snap = get_attempt_snapshot(out["sessionId"], out["attemptId"])
        assert snap is not None
        self.assertEqual(snap.get("decisionScore"), score)
        self.assertEqual(snap.get("confidence"), conf)
        clear_attempt_cache()

    def test_retry_hints_disable_vlm(self) -> None:
        from solvers.context import clear_retry_hints, set_retry_hints
        from solvers.vlm import vlm_mode

        clear_retry_hints()
        with patch.dict(os.environ, {"HERMES_CAPTCHA_VLM": "auto"}):
            self.assertEqual(vlm_mode(), "auto")
            set_retry_hints({"vlm": "off"})
            self.assertEqual(vlm_mode(), "off")
            clear_retry_hints()
            self.assertEqual(vlm_mode(), "auto")


class FeedbackTests(unittest.TestCase):
    """S3: verify feedback record-only; never mutates decisionScore."""

    def setUp(self) -> None:
        from solvers.feedback import clear_attempt_cache

        clear_attempt_cache()

    def tearDown(self) -> None:
        from solvers.feedback import clear_attempt_cache

        clear_attempt_cache()

    def test_feedback_linked_and_immutable(self) -> None:
        from solvers.feedback import get_attempt_snapshot, record_feedback

        img = text_captcha("AB12")
        out = solve_request(
            {
                "kind": "image",
                "sessionId": "s_fb_demo",
                "screenshotBase64": to_b64(img),
            }
        )
        sid, aid = out["sessionId"], out["attemptId"]
        conf_before = out.get("confidence")
        score_before = out.get("decisionScore")
        snap0 = get_attempt_snapshot(sid, aid)
        self.assertIsNotNone(snap0)

        fb = record_feedback(
            {
                "sessionId": sid,
                "attemptId": aid,
                "verifyResult": {
                    "status": "failed",
                    "reason": "wrong code",
                    "latencyMs": 12,
                    "source": "test",
                },
            }
        )
        self.assertTrue(fb.get("ok"))
        self.assertTrue(fb.get("linked"))
        self.assertEqual(fb["verifyResult"]["status"], "failed")
        self.assertEqual((fb.get("decisionAtRecord") or {}).get("confidence"), conf_before)
        self.assertEqual((fb.get("decisionAtRecord") or {}).get("decisionScore"), score_before)

        snap1 = get_attempt_snapshot(sid, aid)
        assert snap1 is not None and snap0 is not None
        self.assertEqual(snap1.get("confidence"), snap0.get("confidence"))
        self.assertEqual(snap1.get("decisionScore"), snap0.get("decisionScore"))
        self.assertEqual(snap1.get("decision"), snap0.get("decision"))

    def test_feedback_not_executed_and_unknown(self) -> None:
        from solvers.feedback import normalize_verify_status, record_feedback

        self.assertEqual(normalize_verify_status("timeout"), "unknown")
        self.assertEqual(normalize_verify_status("abstain"), "not_executed")
        out = solve_request({"kind": "auto", "screenshotBase64": to_b64(blank())})
        fb = record_feedback(
            {
                "sessionId": out["sessionId"],
                "attemptId": out["attemptId"],
                "verifyResult": {"status": "not_executed", "reason": "abstain", "source": "test"},
            }
        )
        self.assertTrue(fb["ok"])
        self.assertTrue(fb["linked"])
        self.assertEqual(fb["verifyResult"]["status"], "not_executed")

    def test_feedback_http_endpoint(self) -> None:
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), SolverHandler)
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            img = text_captcha("AB12")
            payload = json.dumps(
                {
                    "kind": "image",
                    "sessionId": "s_http_fb",
                    "screenshotBase64": to_b64(img),
                }
            ).encode()
            c = HTTPConnection("127.0.0.1", port, timeout=30)
            c.request("POST", "/captcha", payload, headers={"Content-Type": "application/json"})
            sol = json.loads(c.getresponse().read().decode())
            fb_body = json.dumps(
                {
                    "sessionId": sol["sessionId"],
                    "attemptId": sol["attemptId"],
                    "verifyResult": {"status": "success", "reason": "ok", "source": "test"},
                }
            ).encode()
            c.request(
                "POST",
                "/captcha/feedback",
                fb_body,
                headers={"Content-Type": "application/json"},
            )
            res = c.getresponse()
            fb = json.loads(res.read().decode())
            self.assertEqual(res.status, 200)
            self.assertTrue(fb.get("ok"))
            self.assertTrue(fb.get("linked"))
            self.assertEqual(fb["verifyResult"]["status"], "success")
            c.close()
        finally:
            httpd.shutdown()


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), SolverHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()

    def _conn(self) -> HTTPConnection:
        return HTTPConnection("127.0.0.1", self.port, timeout=30)

    def test_health(self) -> None:
        c = self._conn()
        c.request("GET", "/health")
        res = c.getresponse()
        body = json.loads(res.read().decode())
        self.assertEqual(res.status, 200)
        self.assertTrue(body.get("ok"))
        self.assertIn("vlmMode", body)
        self.assertIn("vlmReady", body)

    def test_post_captcha_ocr(self) -> None:
        payload = json.dumps(
            {
                "jobId": "t-solv-02",
                "kind": "image",
                "screenshotBase64": to_b64(text_captcha("AB12")),
            }
        )
        c = self._conn()
        c.request("POST", "/captcha", body=payload, headers={"Content-Type": "application/json"})
        res = c.getresponse()
        body = json.loads(res.read().decode())
        self.assertEqual(res.status, 200)
        self.assertTrue(body.get("solved"), body)
        self.assertEqual(body.get("kind"), "image")
        self.assertEqual(str(body.get("text") or "").strip().upper(), "AB12")

    def test_v1_solve_slider(self) -> None:
        payload = json.dumps(
            {"type": "slider", "screenshotBase64": to_b64(slider_captcha(168))}
        )
        c = self._conn()
        c.request(
            "POST",
            "/v1/captcha/solve",
            body=payload,
            headers={"Content-Type": "application/json"},
        )
        res = c.getresponse()
        body = json.loads(res.read().decode())
        self.assertEqual(res.status, 200)
        self.assertTrue(body.get("success"), body)
        self.assertLessEqual(abs(int(body["offsetX"]) - 168), 8)

    def test_empty_screenshot(self) -> None:
        c = self._conn()
        c.request(
            "POST",
            "/captcha",
            body=b"{}",
            headers={"Content-Type": "application/json"},
        )
        res = c.getresponse()
        body = json.loads(res.read().decode())
        self.assertEqual(res.status, 200)
        self.assertFalse(body.get("solved"))


class VlmTests(unittest.TestCase):
    def setUp(self) -> None:
        from solvers import vlm as vlm_mod

        vlm_mod.invalidate_ready_cache()

    def tearDown(self) -> None:
        from solvers import vlm as vlm_mod

        vlm_mod.invalidate_ready_cache()

    def test_should_invoke_t1_default(self) -> None:
        from solvers.vlm import should_invoke_vlm

        env = {
            "HERMES_CAPTCHA_VLM": "auto",
            "HERMES_CAPTCHA_VLM_URL": "http://127.0.0.1:9/v1",
            "HERMES_CAPTCHA_VLM_MODEL": "qwen2-vl:7b",
            "HERMES_CAPTCHA_VLM_MIN_DDDD_CONF": "0.55",
            "HERMES_CAPTCHA_VLM_WEAK_SHARE": "0.5",
        }
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("HERMES_CAPTCHA_VLM_TRIGGERS", None)
            from solvers import vlm as vlm_mod

            vlm_mod.invalidate_ready_cache()
            # T1 only by default
            self.assertTrue(should_invoke_vlm({"solved": False, "confidence": 0.0, "text": ""}))
            self.assertFalse(
                should_invoke_vlm({"solved": True, "confidence": 0.4, "text": "ab12", "votes": 3, "weightShare": 0.9})
            )
            self.assertFalse(
                should_invoke_vlm(
                    {"solved": True, "confidence": 0.8, "text": "ab12", "votes": 2, "weightShare": 0.4}
                )
            )

        with patch.dict(os.environ, {**env, "HERMES_CAPTCHA_VLM_TRIGGERS": "t1,t2,t3"}):
            from solvers import vlm as vlm_mod

            vlm_mod.invalidate_ready_cache()
            self.assertTrue(
                should_invoke_vlm({"solved": True, "confidence": 0.4, "text": "ab12", "votes": 3, "weightShare": 0.9})
            )
            self.assertTrue(
                should_invoke_vlm(
                    {"solved": True, "confidence": 0.8, "text": "ab12", "votes": 2, "weightShare": 0.4}
                )
            )

        with patch.dict(os.environ, {**env, "HERMES_CAPTCHA_VLM": "off"}):
            from solvers import vlm as vlm_mod

            vlm_mod.invalidate_ready_cache()
            self.assertFalse(should_invoke_vlm({"solved": False}))

    def test_merge_conflict_default_abstain(self) -> None:
        from solvers.vlm import merge_dddd_vlm, vlm_policy

        self.assertEqual(vlm_policy(), "abstain_on_conflict")

        dddd = {
            "solved": True,
            "kind": "image",
            "text": "aaaa",
            "confidence": 0.6,
            "evidenceScore": 0.6,
            "engine": "ddddocr",
            "decision": "accept",
        }
        vlm = {
            "solved": True,
            "kind": "image",
            "text": "bbbb",
            "engine": "vlm7b",
            "vlmUsed": True,
            "modelScoreUncalibrated": True,
        }
        with patch.dict(os.environ, {"HERMES_CAPTCHA_VLM_POLICY": "vlm_prefer"}):
            out = merge_dddd_vlm(dddd, vlm)
            self.assertTrue(out["solved"])
            self.assertEqual(out["text"], "bbbb")
            self.assertEqual(out["engine"], "vlm7b")
            self.assertTrue(out.get("vlmConflict"))
            self.assertNotEqual(out.get("confidence"), 0.75)

        with patch.dict(os.environ, {"HERMES_CAPTCHA_VLM_POLICY": "abstain_on_conflict"}):
            out = merge_dddd_vlm(dddd, vlm)
            self.assertFalse(out["solved"])
            self.assertIn("conflict", str(out.get("reason") or ""))

        # Default env (no POLICY) → abstain
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HERMES_CAPTCHA_VLM_POLICY", None)
            out = merge_dddd_vlm(dddd, vlm)
            self.assertFalse(out["solved"])

        agree = merge_dddd_vlm(dddd, {**vlm, "text": "aaaa"})
        self.assertTrue(agree["solved"])
        self.assertEqual(agree["engine"], "ddddocr+vlm7b")

    def test_solve_image_vlm_on_abstain(self) -> None:
        """Mock VLM recovers when ddddocr abstains."""
        from solvers.ocr import solve_image
        from solvers import vlm as vlm_mod

        img = color_rotated_captcha("A8bV")
        env = {
            "HERMES_CAPTCHA_OCR": "ddddocr",
            "HERMES_CAPTCHA_VLM": "auto",
            "HERMES_CAPTCHA_VLM_URL": "http://127.0.0.1:9/v1",
            "HERMES_CAPTCHA_VLM_MODEL": "qwen2-vl:7b",
        }
        with patch.dict(os.environ, env):
            vlm_mod.invalidate_ready_cache()
            with patch("solvers.ocr._try_ddddocr", return_value=None):
                with patch(
                    "solvers.vlm.try_vlm",
                    return_value={
                        "solved": True,
                        "kind": "image",
                        "text": "a8bv",
                        "engine": "vlm7b",
                        "vlmUsed": True,
                        "modelScoreUncalibrated": True,
                    },
                ):
                    out = solve_image(img)
        self.assertTrue(out["solved"], out)
        self.assertEqual(out.get("text"), "a8bv")
        self.assertEqual(out.get("engine"), "vlm7b")
        self.assertTrue(out.get("vlmUsed"))

    def test_vlm_off_skips_hook(self) -> None:
        from solvers.ocr import solve_image
        from solvers import vlm as vlm_mod

        img = text_captcha("AB12")
        # Direct solve_image (no profile context) → env OCR mode applies.
        with patch.dict(os.environ, {"HERMES_CAPTCHA_OCR": "template", "HERMES_CAPTCHA_VLM": "auto"}):
            vlm_mod.invalidate_ready_cache()
            with patch("solvers.vlm.try_vlm") as mock_vlm:
                out = solve_image(img)
        mock_vlm.assert_not_called()
        self.assertEqual(out.get("engine"), "template")


if __name__ == "__main__":
    unittest.main()
