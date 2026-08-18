"""E1-C / C2-B Independent Source — observation only (does not change Decision).

Prefer a captcha-specialized cross-family OCR (ppllocr / YOLOv11+ONNX).
Empty / capability-mismatch secondaries must be `available=false` and must NOT
create fake `independentConflict`.
"""
from __future__ import annotations

import os
import threading
from typing import Any

from PIL import Image

_rapid = None
_rapid_lock = threading.Lock()
_rapid_import_failed = False

_ppll = None
_ppll_lock = threading.Lock()
_ppll_import_failed = False


def independent_source_enabled() -> bool:
    raw = (os.environ.get("HERMES_CAPTCHA_INDEPENDENT_SOURCE") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    try:
        from .context import get_profile_settings
        from .profile import cfg

        if get_profile_settings():
            return bool(cfg("ocr.independentSource", True))
    except (TypeError, ValueError, ImportError):
        pass
    return True


def secondary_engine_name() -> str:
    """Default: ppllocr (C2-B). Env: HERMES_CAPTCHA_SECONDARY_OCR."""
    return (os.environ.get("HERMES_CAPTCHA_SECONDARY_OCR") or "ppllocr").strip().lower() or "ppllocr"


def _png_bytes(img: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _unavailable(source: str, family: str, independence: str, reason: str, **extra: Any) -> dict[str, Any]:
    out = {
        "source": source,
        "family": family,
        "text": "",
        "confidence": None,
        "available": False,
        "status": "unavailable",
        "reason": reason,
        "independence": independence,
    }
    out.update(extra)
    return out


def _get_rapid():
    global _rapid, _rapid_import_failed
    if _rapid_import_failed:
        return None
    with _rapid_lock:
        if _rapid is not None:
            return _rapid
        try:
            from rapidocr_onnxruntime import RapidOCR

            _rapid = RapidOCR()
            return _rapid
        except Exception:
            _rapid_import_failed = True
            return None


def _get_ppllocr():
    global _ppll, _ppll_import_failed
    if _ppll_import_failed:
        return None
    with _ppll_lock:
        if _ppll is not None:
            return _ppll
        try:
            from ppllocr import OCR

            _ppll = OCR()
            return _ppll
        except Exception:
            _ppll_import_failed = True
            return None


def read_rapidocr(img: Image.Image) -> dict[str, Any]:
    """Scene-text RapidOCR — kept for capability probes; usually empty on demo captcha."""
    eng = _get_rapid()
    if eng is None:
        return _unavailable(
            "rapidocr",
            "paddle_onnx",
            "cross_family",
            "import_failed",
        )
    try:
        from PIL import ImageOps

        rgb = img.convert("RGB")
        w, h = rgb.size
        if max(w, h) < 220:
            scale = 220.0 / float(max(w, h))
            rgb = rgb.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.BICUBIC)
        rgb = ImageOps.autocontrast(rgb)
        res, _elapse = eng(_png_bytes(rgb))
    except Exception as exc:  # noqa: BLE001
        return _unavailable(
            "rapidocr",
            "paddle_onnx",
            "cross_family",
            "error",
            error=type(exc).__name__,
            status="error",
        )
    if not res:
        return _unavailable(
            "rapidocr",
            "paddle_onnx",
            "cross_family",
            "no_character_candidate",
            status="empty",
            domainNote="scene_text_capability_mismatch",
        )
    texts: list[str] = []
    scores: list[float] = []
    for item in res:
        if not item or len(item) < 2:
            continue
        t = str(item[1] or "").strip()
        if not t:
            continue
        texts.append(t)
        try:
            scores.append(float(item[2]) if len(item) > 2 else 0.0)
        except (TypeError, ValueError):
            scores.append(0.0)
    joined = "".join(texts)
    conf = round(sum(scores) / len(scores), 4) if scores else None
    if not joined:
        return _unavailable(
            "rapidocr",
            "paddle_onnx",
            "cross_family",
            "no_character_candidate",
            status="empty",
        )
    return {
        "source": "rapidocr",
        "family": "paddle_onnx",
        "text": joined,
        "rawSegments": texts,
        "confidence": conf,
        "available": True,
        "status": "ok",
        "independence": "cross_family",
    }


def read_ppllocr(img: Image.Image) -> dict[str, Any]:
    """Captcha-specialized YOLO/ONNX OCR with per-character candidates (C2-B)."""
    eng = _get_ppllocr()
    if eng is None:
        return _unavailable(
            "ppllocr",
            "yolo_onnx",
            "cross_family",
            "import_failed",
        )
    try:
        png = _png_bytes(img)
        text, details = eng.classification_box(png)
    except Exception as exc:  # noqa: BLE001
        return _unavailable(
            "ppllocr",
            "yolo_onnx",
            "cross_family",
            "error",
            error=type(exc).__name__,
            status="error",
        )
    candidates: list[dict[str, Any]] = []
    for d in details or []:
        if not isinstance(d, dict):
            continue
        ch = str(d.get("char") or "")
        if not ch:
            continue
        try:
            conf = float(d.get("conf")) if d.get("conf") is not None else None
        except (TypeError, ValueError):
            conf = None
        entry: dict[str, Any] = {"char": ch, "confidence": conf}
        if d.get("box") is not None:
            entry["box"] = d.get("box")
        candidates.append(entry)
    raw_text = str(text or "").strip()
    if not candidates and not raw_text:
        return _unavailable(
            "ppllocr",
            "yolo_onnx",
            "cross_family",
            "no_character_candidate",
            status="empty",
        )
    confs = [float(c["confidence"]) for c in candidates if c.get("confidence") is not None]
    mean_conf = round(sum(confs) / len(confs), 4) if confs else None
    min_conf = round(min(confs), 4) if confs else None
    return {
        "source": "ppllocr",
        "family": "yolo_onnx",
        "text": raw_text,
        "confidence": mean_conf,
        "charMinConfidence": min_conf,
        "charCandidates": candidates,
        "available": True,
        "status": "ok",
        "independence": "cross_family",
    }


def read_ddddocr_beta_raw(img: Image.Image) -> dict[str, Any]:
    """Single-shot ddddocr beta — weak_same_vendor; only when explicitly selected."""
    try:
        from .ocr import _ddddocr_text, normalize_captcha_text

        raw = _ddddocr_text(img, beta=True)
        norm = normalize_captcha_text(raw) if raw else ""
        text = norm or "".join(ch for ch in (raw or "") if ch.isalnum())
        if not text:
            return _unavailable(
                "ddddocr_beta",
                "ddddocr",
                "weak_same_vendor",
                "no_character_candidate",
                status="empty",
                rawText=raw or "",
            )
        return {
            "source": "ddddocr_beta",
            "family": "ddddocr",
            "text": text,
            "rawText": raw or "",
            "confidence": None,
            "available": True,
            "status": "ok",
            "independence": "weak_same_vendor",
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(
            "ddddocr_beta",
            "ddddocr",
            "weak_same_vendor",
            "error",
            error=type(exc).__name__,
            status="error",
        )


def read_secondary(img: Image.Image) -> dict[str, Any]:
    """Read secondary OCR. Default ppllocr. No silent ddddocr_beta pollution.

    Env HERMES_CAPTCHA_SECONDARY_OCR:
      ppllocr (default) | rapidocr | ddddocr_beta | auto
    auto = ppllocr, else rapidocr (still no beta fallback).
    """
    name = secondary_engine_name()
    if name in ("ddddocr_beta", "beta"):
        return read_ddddocr_beta_raw(img)
    if name in ("rapidocr", "rapid"):
        return read_rapidocr(img)

    # ppllocr or auto
    ppll = read_ppllocr(img)
    if ppll.get("available"):
        return ppll
    if name == "auto":
        rapid = read_rapidocr(img)
        if rapid.get("available"):
            return rapid
        # Prefer returning ppllocr unavailable (captcha-specialized) over rapid empty.
        out = dict(ppll)
        out["triedRapidocr"] = {
            "available": rapid.get("available"),
            "status": rapid.get("status"),
            "reason": rapid.get("reason"),
        }
        return out
    return ppll


def _normalize_for_compare(text: str) -> str:
    """Compare-only normalize: charset filter + casefold; no LEN gate."""
    s = str(text or "")
    try:
        from .ocr import allowed_charset

        charset = allowed_charset()
        if charset:
            allowed = set(charset)
            allowed |= {c.casefold() for c in charset} | {c.upper() for c in charset if len(c) == 1}
            s = "".join(ch for ch in s if ch in allowed or ch.casefold() in allowed)
        else:
            s = "".join(
                ch for ch in s if ("0" <= ch <= "9") or ("A" <= ch <= "Z") or ("a" <= ch <= "z")
            )
    except Exception:
        s = "".join(ch for ch in s if ch.isalnum())
    return s.casefold()


def source_agreement(
    primary_text: str,
    secondary_text: str,
    *,
    secondary_available: bool | None = None,
    secondary_reason: str | None = None,
) -> dict[str, Any]:
    """Compare primary vs secondary. Unavailable / length mismatch → incomparable (not conflict)."""
    if secondary_available is False:
        reason = secondary_reason or "source_unavailable"
        if reason in ("no_character_candidate", "empty"):
            reason = "empty" if reason == "empty" else "no_candidate"
        return {
            "agree": False,
            "comparable": False,
            "charDiff": None,
            "positions": [],
            "primaryNorm": _normalize_for_compare(primary_text) or None,
            "secondaryNorm": None,
            "reason": reason if reason in (
                "empty",
                "no_candidate",
                "source_unavailable",
                "error",
                "import_failed",
            )
            else "source_unavailable",
            "unavailableReason": secondary_reason or "unavailable",
        }
    p_raw = str(primary_text or "").strip()
    s_raw = str(secondary_text or "").strip()
    if not s_raw:
        return {
            "agree": False,
            "comparable": False,
            "charDiff": None,
            "positions": [],
            "primaryNorm": _normalize_for_compare(p_raw) or None,
            "secondaryNorm": None,
            "reason": "empty",
        }
    p = _normalize_for_compare(p_raw)
    s = _normalize_for_compare(s_raw)
    if not p:
        return {
            "agree": False,
            "comparable": False,
            "charDiff": None,
            "positions": [],
            "primaryNorm": None,
            "secondaryNorm": s or None,
            "reason": "unsupported_chars" if p_raw else "empty",
        }
    if not s:
        # Had raw secondary text but charset stripped everything.
        return {
            "agree": False,
            "comparable": False,
            "charDiff": None,
            "positions": [],
            "primaryNorm": p,
            "secondaryNorm": None,
            "reason": "unsupported_chars",
            "secondaryRaw": s_raw,
        }
    # Length: prefer profile OCR len; else require equal lengths for comparable conflict/agree.
    try:
        from .ocr import preferred_len

        want = preferred_len()
    except Exception:
        want = None
    if want is not None:
        if len(p) != want or len(s) != want:
            return {
                "agree": False,
                "comparable": False,
                "charDiff": None,
                "positions": [],
                "primaryNorm": p,
                "secondaryNorm": s,
                "lenPrimary": len(p),
                "lenSecondary": len(s),
                "reason": "length_mismatch",
                "wantLen": want,
            }
    elif len(p) != len(s):
        return {
            "agree": False,
            "comparable": False,
            "charDiff": None,
            "positions": [],
            "primaryNorm": p,
            "secondaryNorm": s,
            "lenPrimary": len(p),
            "lenSecondary": len(s),
            "reason": "length_mismatch",
        }
    if p == s:
        return {
            "agree": True,
            "comparable": True,
            "charDiff": 0,
            "positions": [],
            "primaryNorm": p,
            "secondaryNorm": s,
            "hamming": 0,
            "reason": "exact",
        }
    positions: list[int] = []
    for i in range(len(p)):
        if p[i] != s[i]:
            positions.append(i)
    return {
        "agree": False,
        "comparable": True,
        "charDiff": len(positions),
        "positions": positions,
        "primaryNorm": p,
        "secondaryNorm": s,
        "hamming": len(positions),
        "lenPrimary": len(p),
        "lenSecondary": len(s),
        "reason": "char_mismatch",
    }


def build_secondary_comparison(
    *,
    primary_text: str,
    secondary_text: str | None,
    agreement: dict[str, Any],
    secondary_confidence: float | None = None,
    low_conf_threshold: float = 0.25,
) -> dict[str, Any]:
    """E2-B2: explicit agree | conflict | incomparable (observation contract)."""
    agr = agreement or {}
    reason = str(agr.get("reason") or "")
    primary = {"text": str(primary_text or "")}
    secondary = {"text": str(secondary_text or "")}
    if secondary_confidence is not None:
        secondary["confidence"] = secondary_confidence

    # Optional: very low secondary confidence → incomparable (does not invent conflict).
    if (
        agr.get("comparable")
        and secondary_confidence is not None
        and float(secondary_confidence) < float(low_conf_threshold)
        and not agr.get("agree")
    ):
        return {
            "status": "incomparable",
            "reason": "low_confidence",
            "comparable": False,
            "primary": primary,
            "secondary": secondary,
            "charDiff": agr.get("charDiff"),
            "positions": agr.get("positions") or [],
        }

    if agr.get("agree") and agr.get("comparable"):
        status = "agree"
        reason = reason or "exact"
    elif agr.get("comparable") and not agr.get("agree"):
        status = "conflict"
        reason = "char_mismatch" if reason in ("mismatch", "char_mismatch", "") else reason
    else:
        status = "incomparable"
        # Normalize legacy reason names
        if reason in (
            "secondary_length_mismatch",
            "primary_length_mismatch",
            "length_mismatch",
        ):
            reason = "length_mismatch"
        elif reason in ("missing_side", "no_comparable_glyph"):
            reason = "unsupported_chars" if reason == "no_comparable_glyph" else "empty"
        elif reason == "no_character_candidate":
            reason = "no_candidate"
        elif not reason:
            reason = "incomparable"

    return {
        "status": status,
        "reason": reason,
        "comparable": bool(status != "incomparable"),
        "primary": primary,
        "secondary": secondary,
        "charDiff": agr.get("charDiff"),
        "positions": agr.get("positions") or [],
        "primaryNorm": agr.get("primaryNorm"),
        "secondaryNorm": agr.get("secondaryNorm"),
    }


def conflict_attribution(
    *,
    primary_correct: bool | None,
    agreement: dict[str, Any] | None,
    secondary_available: bool,
) -> dict[str, Any]:
    """Offline-friendly attribution labels (needs verify outcome when available)."""
    agreement = agreement or {}
    if not secondary_available or not agreement.get("comparable"):
        return {
            "label": "source_unavailable_or_incomparable",
            "primaryWrong": None,
            "secondaryWrong": None,
            "bothUncertain": True,
        }
    if agreement.get("agree"):
        if primary_correct is True:
            return {"label": "both_agree_correct", "primaryWrong": False, "secondaryWrong": False, "bothUncertain": False}
        if primary_correct is False:
            return {"label": "both_agree_wrong", "primaryWrong": True, "secondaryWrong": True, "bothUncertain": False}
        return {"label": "both_agree_unknown", "primaryWrong": None, "secondaryWrong": None, "bothUncertain": True}
    # conflict
    if primary_correct is True:
        return {
            "label": "secondary_wrong",
            "primaryWrong": False,
            "secondaryWrong": True,
            "bothUncertain": False,
        }
    if primary_correct is False:
        return {
            "label": "primary_wrong_secondary_unknown",
            "primaryWrong": True,
            "secondaryWrong": None,
            "bothUncertain": True,
        }
    return {
        "label": "both_uncertain",
        "primaryWrong": None,
        "secondaryWrong": None,
        "bothUncertain": True,
    }


def build_independent_evidence(
    img: Image.Image,
    *,
    primary_text: str,
    primary_confidence: float | None = None,
    primary_source: str = "ddddocr",
) -> dict[str, Any]:
    """Assemble independentEvidence + sourceAgreement (observation only)."""
    primary = {
        "source": primary_source,
        "family": "ddddocr",
        "text": str(primary_text or ""),
        "confidence": round(float(primary_confidence), 4) if primary_confidence is not None else None,
        "available": bool(str(primary_text or "").strip()),
        "independence": "primary",
        "status": "ok" if primary_text else "empty",
    }
    secondary = read_secondary(img)
    sec_available = bool(secondary.get("available"))
    sec_text = str(secondary.get("text") or "")
    sec_norm = _normalize_for_compare(sec_text)
    if sec_norm and sec_norm != sec_text:
        secondary = dict(secondary)
        secondary["normalizedText"] = sec_norm
    agreement = source_agreement(
        primary_text,
        sec_text,
        secondary_available=sec_available,
        secondary_reason=str(secondary.get("reason") or "") or None,
    )
    try:
        sec_conf = float(secondary["confidence"]) if secondary.get("confidence") is not None else None
    except (TypeError, ValueError):
        sec_conf = None
    comparison = build_secondary_comparison(
        primary_text=str(primary_text or ""),
        secondary_text=sec_text or None,
        agreement=agreement,
        secondary_confidence=sec_conf,
    )
    status = str(comparison.get("status") or "incomparable")
    comparable = status in ("agree", "conflict")
    agree = status == "agree"
    return {
        "independentEvidence": [primary, secondary],
        "sourceAgreement": agreement,
        "secondaryComparison": comparison,
        "independentAgree": agree,
        "independentComparable": comparable,
        "independentConflict": status == "conflict",
        "independentCharDiff": agreement.get("charDiff") if status == "conflict" else None,
        "secondarySource": secondary.get("source"),
        "secondaryText": secondary.get("text") or None,
        "secondaryConfidence": secondary.get("confidence"),
        "secondaryStatus": secondary.get("status"),
        "secondaryAvailable": sec_available,
        "secondaryReason": secondary.get("reason"),
        "sourceUnavailable": (not sec_available),
        "comparisonStatus": status,
        "comparisonReason": comparison.get("reason"),
    }


def independent_agree_pattern(agreement: dict | None, *, secondary_available: bool | None = None) -> dict[str, Any]:
    """Diagnostic flags for E1-C / C2-B / E2-B2 FA analysis."""
    agreement = agreement or {}
    # Prefer explicit secondaryComparison if present on agreement wrapper — callers usually pass sourceAgreement.
    reason = str(agreement.get("reason") or "")
    incomparable_reasons = {
        "source_unavailable",
        "empty",
        "no_candidate",
        "length_mismatch",
        "secondary_length_mismatch",
        "primary_length_mismatch",
        "unsupported_chars",
        "no_comparable_glyph",
        "missing_side",
        "low_confidence",
        "error",
        "import_failed",
        "incomparable",
    }
    if secondary_available is False or reason in incomparable_reasons or agreement.get("comparable") is False:
        return {
            "independentConflict": False,
            "independentAgree": False,
            "sourceUnavailable": secondary_available is False or reason in (
                "source_unavailable",
                "empty",
                "no_candidate",
                "import_failed",
                "error",
            ),
            "incomparable": True,
            "comparisonStatus": "incomparable",
            "flags": ["incomparable", reason or "not_comparable"],
            "charDiff": None,
            "positions": [],
        }
    comparable = bool(agreement.get("comparable"))
    agree = bool(agreement.get("agree"))
    flags: list[str] = []
    if agree:
        flags.append("independent_agree")
        status = "agree"
    else:
        flags.append("independent_conflict")
        status = "conflict"
        diff = agreement.get("charDiff")
        if diff == 1:
            flags.append("single_char_conflict")
        elif isinstance(diff, int) and diff > 1:
            flags.append("multi_char_conflict")
    return {
        "independentConflict": (comparable and not agree),
        "independentAgree": agree,
        "sourceUnavailable": False,
        "incomparable": False,
        "comparisonStatus": status,
        "flags": flags,
        "charDiff": agreement.get("charDiff"),
        "positions": agreement.get("positions"),
    }
