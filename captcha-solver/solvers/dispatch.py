"""Solve entry: classify → OCR | OpenCV-style slider | click. Stateless."""
from __future__ import annotations

import time

from . import click, ocr, slider
from .classify import classify, requested_kind
from .context import (
    clear_profile_settings,
    clear_retry_hints,
    set_profile_settings,
    set_retry_hints,
)
from .decode import decode_image_with_hash, extract_b64
from .pipeline_trace import PipelineTrace
from .profile import resolve_active_profile
from .session import attach_observation

ENGINES = {
    "image": ocr.solve_image,
    "slider": slider.solve_slider,
    "click": click.solve_click,
}


def _fail(reason: str, **extra: object) -> dict:
    body: dict = {"solved": False, "success": False, "reason": reason, "decision": "abstain"}
    body.update(extra)
    return body


def solve_request(req: dict) -> dict:
    t0 = time.perf_counter()
    profile = resolve_active_profile(req)
    set_profile_settings(profile)
    hints = req.get("retryHints")
    if not isinstance(hints, dict):
        hint = req.get("hint")
        if isinstance(hint, dict) and isinstance(hint.get("retryHints"), dict):
            hints = hint.get("retryHints")
    set_retry_hints(hints if isinstance(hints, dict) else None)
    try:
        out = _solve_request_inner(req, t0)
        out["profile"] = profile.get("name") or "default"
        if out.get("observation") and isinstance(out["observation"], dict):
            out["observation"]["profile"] = out["profile"]
        return out
    finally:
        clear_retry_hints()
        clear_profile_settings()


def _attach_visual_candidates(result: dict, yolo_cand: dict | None) -> None:
    """Additive candidates list for observation / future fusion (does not flip solved)."""
    cands = []
    raw = str(result.get("text") or result.get("ddddText") or "").strip()
    if raw:
        cands.append(
            {
                "source": "raw_ocr",
                "text": raw,
                "confidence": result.get("confidence"),
            }
        )
    vlm_txt = str(result.get("vlmText") or "").strip()
    if vlm_txt:
        cands.append(
            {
                "source": "vlm",
                "text": vlm_txt,
                "confidence": result.get("confidence") if result.get("vlmUsed") else None,
            }
        )
    if yolo_cand and str(yolo_cand.get("text") or "").strip():
        cands.append(
            {
                "source": "yolo_ocr",
                "text": yolo_cand.get("text"),
                "confidence": yolo_cand.get("confidence"),
            }
        )
    if cands:
        result["visualCandidates"] = cands


def _solve_request_inner(req: dict, t0: float) -> dict:
    trace = PipelineTrace()
    b64 = extract_b64(req)
    if not b64:
        return attach_observation(req, _fail("missing screenshotBase64"), None, trace=trace)

    try:
        with trace.timed("decode") as st:
            img, computed_hash, _raw = decode_image_with_hash(b64)
            st.ok()
    except Exception as exc:  # noqa: BLE001 — return contract, never 500 for bad image
        trace.stage("decode", status="error", reason=type(exc).__name__)
        return attach_observation(
            req, _fail("invalid screenshot: " + type(exc).__name__), None, trace=trace
        )

    req_hash = str(req.get("imageHash") or "").strip().lower()
    if req_hash and req_hash != computed_hash:
        trace.stage("image_hash", status="error", reason="mismatch")
        fail = _fail(
            "image_hash_mismatch",
            imageHash=computed_hash,
            attemptId=req.get("attemptId"),
        )
        return attach_observation(req, fail, img, trace=trace, image_hash=computed_hash)

    trace.stage("image_hash", status="ok")
    trace.set_meta(
        image_id=req_hash or computed_hash,
        imageHash=computed_hash,
        request_id=req.get("attemptId") or req.get("jobId"),
        preprocess_version=str(req.get("preprocessVersion") or "default"),
    )

    with trace.timed("classify") as st:
        kind, class_conf = classify(img, req)
        st.ok(confidence=class_conf, kind=kind)

    engine = ENGINES.get(kind)
    yolo_det: dict = {"boxes": [], "status": "skipped"}
    yolo_cand: dict | None = None

    if engine is None:
        result = _fail("unknown kind", kind=kind)
    else:
        with trace.timed("raw_ocr" if kind == "image" else f"engine_{kind}") as st:
            result = engine(img)
            st.ok(
                confidence=result.get("confidence"),
                text=str(result.get("text") or "")[:32] or None,
                solved=bool(result.get("solved")),
            )
        if requested_kind(req) == "auto" and not result.get("solved"):
            for fallback in ("image", "slider", "click"):
                if fallback == kind:
                    continue
                with trace.timed(f"fallback_{fallback}") as st:
                    alt = ENGINES[fallback](img)
                    st.ok(solved=bool(alt.get("solved")))
                if alt.get("solved"):
                    result = alt
                    kind = fallback
                    break

        # YOLO path — never hard-fail pipeline; observation + optional candidate.
        if kind == "image":
            try:
                from .yolo_detect import detect_characters, yolo_model_version
                from .yolo_ocr import yolo_ocr_from_boxes

                with trace.timed("yolo") as st:
                    yolo_det = detect_characters(img)
                    trace.set_meta(yolo_model_version=yolo_model_version())
                    if yolo_det.get("status") == "ok":
                        st.ok(
                            confidence=yolo_det.get("avgConfidence"),
                            boxes=len(yolo_det.get("boxes") or []),
                        )
                    else:
                        st.skip(str(yolo_det.get("reason") or yolo_det.get("status")))

                boxes = list(yolo_det.get("boxes") or [])
                if boxes:
                    with trace.timed("yolo_ocr") as st:
                        yolo_cand = yolo_ocr_from_boxes(img, boxes)
                        st.ok(
                            confidence=yolo_cand.get("confidence"),
                            text=str(yolo_cand.get("text") or "")[:32] or None,
                            boxes_in=yolo_cand.get("boxesIn"),
                            boxes_used=yolo_cand.get("boxesUsed"),
                            split_count=yolo_cand.get("split_count"),
                        )
                    for ev in yolo_cand.get("splitEvents") or []:
                        trace.stage(
                            "split",
                            status=str(ev.get("status") or "ok"),
                            confidence=ev.get("confidence"),
                            parts=ev.get("parts"),
                            method=ev.get("method"),
                            reason=ev.get("reason"),
                            input_bbox=ev.get("input_bbox"),
                        )
                    result["detection"] = {
                        "engine": yolo_det.get("engine"),
                        "boxes": yolo_cand.get("detectionBoxes") or boxes,
                        "boxesRaw": boxes,
                        "detected_chars": len(yolo_cand.get("detectionBoxes") or boxes),
                        "status": yolo_det.get("status"),
                        "split_count": yolo_cand.get("split_count") or 0,
                    }
                    result["yoloOcr"] = yolo_cand
                else:
                    result["detection"] = {
                        "engine": yolo_det.get("engine"),
                        "boxes": [],
                        "detected_chars": 0,
                        "status": yolo_det.get("status"),
                        "reason": yolo_det.get("reason"),
                    }
            except Exception as exc:  # noqa: BLE001
                trace.stage("yolo", status="error", reason=type(exc).__name__)
                result["detection"] = {
                    "engine": "yolo",
                    "boxes": [],
                    "status": "error",
                    "reason": type(exc).__name__,
                }

    result.setdefault("kind", kind)
    result["classifiedAs"] = kind
    result["classifierConfidence"] = round(float(class_conf), 4)

    # S0 observational baseline (never gates submit).
    try:
        from .s0_baseline import evaluate_s0

        with trace.timed("s0") as st:
            s0 = evaluate_s0(
                boxes=list((result.get("detection") or {}).get("boxes") or []),
                raw_text=str(result.get("text") or ""),
                yolo_text=str((yolo_cand or {}).get("text") or ""),
            )
            result["s0"] = s0
            st.ok(s0_pass=s0.get("pass"))
    except Exception as exc:  # noqa: BLE001
        trace.stage("s0", status="error", reason=type(exc).__name__)

    _attach_visual_candidates(result, yolo_cand)

    # P2.1/P2.2: Fusion + shadow decision (default shadow — does not rewrite solved).
    if kind == "image":
        try:
            from .fusion import apply_fusion, fusion_mode

            with trace.timed("fusion") as st:
                mode = fusion_mode()
                apply_fusion(result, mode=mode)
                st.ok(
                    mode=mode,
                    action=(result.get("shadowDecision") or {}).get("action"),
                    delta=result.get("shadowDelta"),
                )
        except Exception as exc:  # noqa: BLE001
            trace.stage("fusion", status="error", reason=type(exc).__name__)

    # E2-A: finer captchaType (observation only; does not change engine choice / Decision).
    try:
        from .captcha_type import captcha_type_enabled, detect_captcha_type

        if captcha_type_enabled():
            result["captchaType"] = detect_captcha_type(
                img,
                coarse_kind=kind,
                coarse_confidence=float(class_conf),
            )
    except Exception:
        result["captchaType"] = {
            "type": "unsupported",
            "confidence": 0.0,
            "features": {"tags": ["detector_error"]},
            "routingHint": {"recommendSecondary": False, "reason": "detector_error", "applied": False},
            "observationOnly": True,
        }

    result["success"] = bool(result.get("solved"))
    result["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    if "confidence" not in result:
        result["confidence"] = 0.0 if not result["success"] else 0.5

    # Persist failed OCR inputs for DCP/debug (best-effort). Opt-in only for images.
    if not result.get("solved") and kind == "image":
        try:
            import os
            from pathlib import Path

            dump = Path(os.environ.get("HERMES_CAPTCHA_FAIL_DIR") or "/tmp/hermes-captcha-fails")
            dump.mkdir(parents=True, exist_ok=True)
            job = str(req.get("jobId") or "anon").replace("/", "_")[:64]
            ts = int(time.time() * 1000)
            out = dump / f"{ts}_{job}.png"
            img.save(out, format="PNG")
            result["failImage"] = str(out)
        except Exception:
            pass

    return attach_observation(
        req, result, img, trace=trace, image_hash=computed_hash
    )
