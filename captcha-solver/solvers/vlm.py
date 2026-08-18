"""Optional local 7B vision model as secondary captcha OCR (OpenAI-compatible HTTP)."""
from __future__ import annotations

import base64
import json
import os
import threading
import urllib.error
import urllib.request
from io import BytesIO
from typing import Any

from PIL import Image

_vlm_lock = threading.Semaphore(1)
_ready_cache: bool | None = None
_ready_lock = threading.Lock()


def vlm_mode() -> str:
    from .context import get_profile_settings, get_retry_hints
    from .profile import cfg

    hints = get_retry_hints()
    if str(hints.get("vlm") or "").strip().lower() in ("0", "false", "no", "off", "disabled"):
        return "off"
    if get_profile_settings():
        raw = str(cfg("vlm.mode", "auto") or "auto").strip().lower()
    else:
        raw = (os.environ.get("HERMES_CAPTCHA_VLM") or "auto").strip().lower()
    if raw in ("0", "false", "no", "off", "disabled"):
        return "off"
    if raw in ("1", "true", "yes", "on", "auto"):
        return "auto"
    if raw == "always":
        return "always"
    return "auto"


def vlm_url() -> str:
    return (os.environ.get("HERMES_CAPTCHA_VLM_URL") or "").strip().rstrip("/")


def vlm_model() -> str:
    # Ollama library tag is qwen2.5vl:7b (qwen2-vl:7b is not published there).
    return (os.environ.get("HERMES_CAPTCHA_VLM_MODEL") or "qwen2.5vl:7b").strip()


def vlm_timeout_ms() -> int:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return max(500, int(cfg("vlm.timeoutMs", 8000)))
        except (TypeError, ValueError):
            return 8000
    raw = (os.environ.get("HERMES_CAPTCHA_VLM_TIMEOUT_MS") or "8000").strip()
    try:
        return max(500, int(raw))
    except ValueError:
        return 8000


def vlm_min_dddd_conf() -> float:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("vlm.minDdddConf", 0.55))))
        except (TypeError, ValueError):
            return 0.55
    raw = (os.environ.get("HERMES_CAPTCHA_VLM_MIN_DDDD_CONF") or "0.55").strip()
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        return 0.55


def vlm_weak_share() -> float:
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        try:
            return min(1.0, max(0.0, float(cfg("vlm.weakShare", 0.5))))
        except (TypeError, ValueError):
            return 0.5
    raw = (os.environ.get("HERMES_CAPTCHA_VLM_WEAK_SHARE") or "0.5").strip()
    try:
        return min(1.0, max(0.0, float(raw)))
    except ValueError:
        return 0.5


def vlm_policy() -> str:
    # Phase 2 freeze: abstain_on_conflict (control false ACCEPT).
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        raw = str(cfg("vlm.policy", "abstain_on_conflict") or "abstain_on_conflict").strip().lower()
    else:
        raw = (os.environ.get("HERMES_CAPTCHA_VLM_POLICY") or "abstain_on_conflict").strip().lower()
    if raw in ("dddd_prefer", "abstain_on_conflict", "vlm_prefer"):
        return raw
    return "abstain_on_conflict"


def vlm_triggers() -> set[str]:
    """Default T1 only. Opt-in T2/T3 via profile or HERMES_CAPTCHA_VLM_TRIGGERS."""
    from .context import get_profile_settings
    from .profile import cfg

    if get_profile_settings():
        raw = cfg("vlm.triggers", "t1")
        if isinstance(raw, (list, tuple, set)):
            parts = {str(p).strip().lower() for p in raw if str(p).strip()}
        else:
            parts = {p.strip() for p in str(raw or "t1").replace(";", ",").split(",") if p.strip()}
    else:
        raw = (os.environ.get("HERMES_CAPTCHA_VLM_TRIGGERS") or "t1").strip().lower()
        parts = {p.strip() for p in raw.replace(";", ",").split(",") if p.strip()}
    allowed = {"t1", "t2", "t3"}
    return (parts & allowed) or {"t1"}


def vlm_max_concurrency() -> int:
    raw = (os.environ.get("HERMES_CAPTCHA_VLM_MAX_CONCURRENCY") or "1").strip()
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return 1


def vlm_prompt() -> str:
    return (
        os.environ.get("HERMES_CAPTCHA_VLM_PROMPT")
        or "Read the captcha. Reply with ONLY the characters (A-Z a-z 0-9), no spaces or explanation."
    ).strip()


def invalidate_ready_cache() -> None:
    global _ready_cache
    with _ready_lock:
        _ready_cache = None


def vlm_ready(force: bool = False) -> bool:
    """True when mode≠off and URL is set. Optional lightweight /models probe cached."""
    global _ready_cache
    if vlm_mode() == "off":
        return False
    if not vlm_url() or not vlm_model():
        return False
    with _ready_lock:
        if not force and _ready_cache is not None:
            return _ready_cache
    ok = True
    # Best-effort readiness: if /models fails we still allow try (server may be slow to list).
    try:
        req = urllib.request.Request(
            vlm_url() + "/models",
            headers={"Accept": "application/json"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=1.5) as res:
            ok = int(getattr(res, "status", 200) or 200) < 500
    except Exception:
        ok = True  # URL configured → attempt at call time
    with _ready_lock:
        _ready_cache = ok
    return ok


def should_invoke_vlm(dddd: dict) -> bool:
    """VLM invoke gate. Default: T1 only (primary unsolved).

    T2/T3 require explicit HERMES_CAPTCHA_VLM_TRIGGERS including t2/t3.
    """
    if not vlm_ready():
        return False
    mode = vlm_mode()
    if mode == "off":
        return False
    if mode == "always":
        return True
    triggers = vlm_triggers()
    # auto: T1 abstain
    if not dddd.get("solved"):
        return "t1" in triggers
    if "t2" in triggers:
        try:
            conf = float(dddd.get("confidence") or dddd.get("evidenceScore") or 0.0)
        except (TypeError, ValueError):
            conf = 0.0
        if conf < vlm_min_dddd_conf():
            return True
    if "t3" in triggers:
        try:
            share = float(dddd.get("weightShare") or 0.0)
        except (TypeError, ValueError):
            share = 0.0
        votes = int(dddd.get("votes") or 0)
        if votes >= 2 and share > 0 and share < vlm_weak_share():
            return True
    return False


def _png_data_url(img: Image.Image, max_side: int = 512) -> str:
    rgb = img.convert("RGB")
    w, h = rgb.size
    m = max(w, h)
    if m > max_side and m > 0:
        scale = max_side / m
        rgb = rgb.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = BytesIO()
    rgb.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return "data:image/png;base64," + b64


def _http_json(url: str, payload: dict, timeout_s: float) -> dict:
    raw = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as res:
            body = res.read().decode("utf-8") or "{}"
            return json.loads(body)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"vlm http {e.code}: {err}") from e


def _extract_chat_text(resp: dict) -> str:
    choices = resp.get("choices") or []
    if not choices:
        # Ollama native fallback shape
        msg = resp.get("message") or {}
        return str(msg.get("content") or resp.get("response") or "").strip()
    msg = choices[0].get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text":
                parts.append(str(p.get("text") or ""))
            elif isinstance(p, str):
                parts.append(p)
        return "".join(parts).strip()
    return str(content or "").strip()


def call_vlm_raw(img: Image.Image) -> str:
    """Call local OpenAI-compatible chat/completions; return raw model text."""
    base = vlm_url()
    if not base:
        return ""
    timeout_s = vlm_timeout_ms() / 1000.0
    data_url = _png_data_url(img)
    payload: dict[str, Any] = {
        "model": vlm_model(),
        "temperature": 0,
        "max_tokens": 32,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": vlm_prompt()},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    sem = _vlm_lock
    # Resize semaphore if concurrency env changes mid-process (simple: always 1 default).
    acquired = sem.acquire(timeout=timeout_s)
    if not acquired:
        raise TimeoutError("vlm concurrency wait timeout")
    try:
        return _extract_chat_text(_http_json(base + "/chat/completions", payload, timeout_s))
    finally:
        sem.release()


def try_vlm(img: Image.Image) -> dict | None:
    """Return solved dict or None on failure/empty. Caller merges with dddd."""
    from .ocr import normalize_captcha_text  # local import avoids cycle at module load

    if not vlm_ready():
        return None
    try:
        raw = call_vlm_raw(img)
    except Exception as exc:  # noqa: BLE001
        return {
            "solved": False,
            "kind": "image",
            "text": "",
            "confidence": 0.0,
            "engine": "vlm7b",
            "decision": "abstain",
            "reason": "vlm error: " + type(exc).__name__,
            "vlmUsed": True,
        }
    norm = normalize_captcha_text(raw)
    if not norm:
        return {
            "solved": False,
            "kind": "image",
            "text": "",
            "confidence": 0.0,
            "engine": "vlm7b",
            "decision": "abstain",
            "reason": "vlm empty after normalize",
            "vlmRaw": (raw or "")[:64],
            "vlmUsed": True,
        }
    return {
        "solved": True,
        "kind": "image",
        "text": norm,
        "engine": "vlm7b",
        "preprocess": "vlm",
        "decision": "accept",
        "modelScoreUncalibrated": True,
        "vlmUsed": True,
        "vlmRaw": (raw or "")[:64],
    }


def merge_dddd_vlm(dddd: dict, vlm: dict | None) -> dict:
    """Apply policy (default abstain_on_conflict). VLM has no calibrated confidence."""
    from .decision import apply_decision, decide_vlm_candidate

    out = dict(dddd)
    out["ddddText"] = str(dddd.get("text") or "")
    out["ddddConfidence"] = dddd.get("confidence")
    if not vlm:
        out["vlmUsed"] = False
        return out
    out["vlmUsed"] = True
    out["vlmText"] = str(vlm.get("text") or "")
    if not vlm.get("solved") or not vlm.get("text"):
        # keep dddd outcome
        out.setdefault("reason", dddd.get("reason") or vlm.get("reason") or "")
        return out

    d_txt = str(dddd.get("text") or "").strip()
    v_txt = str(vlm.get("text") or "").strip()
    if not dddd.get("solved") or not d_txt:
        merged = decide_vlm_candidate(vlm, after_primary_abstain=True)
        merged["ddddText"] = d_txt
        merged["ddddConfidence"] = dddd.get("confidence")
        merged["vlmUsed"] = True
        merged["vlmText"] = v_txt
        return merged

    if d_txt.casefold() == v_txt.casefold():
        merged = dict(dddd)
        merged["text"] = v_txt if (os.environ.get("HERMES_CAPTCHA_OCR_CASE") or "lower").strip().lower() == "lower" else d_txt
        # Keep primary evidence; do not invent VLM calibrated boost.
        merged["engine"] = "ddddocr+vlm7b"
        merged["vlmUsed"] = True
        merged["vlmText"] = v_txt
        merged["ddddText"] = d_txt
        try:
            score = float(
                dddd.get("decisionScore")
                if dddd.get("decisionScore") is not None
                else dddd.get("evidenceScore")
                if dddd.get("evidenceScore") is not None
                else dddd.get("confidence")
                or 0.0
            )
        except (TypeError, ValueError):
            score = None
        return apply_decision(merged, decision="accept", reason="", decision_score=score)

    policy = vlm_policy()
    if policy == "dddd_prefer":
        out["vlmText"] = v_txt
        out["vlmConflict"] = True
        return out
    if policy == "abstain_on_conflict":
        return apply_decision(
            {
                "kind": "image",
                "text": "",
                "engine": "ddddocr+vlm7b",
                "ddddText": d_txt,
                "vlmText": v_txt,
                "vlmUsed": True,
                "vlmConflict": True,
            },
            decision="abstain",
            reason="dddd/vlm conflict",
            decision_score=0.0,
        )
    # vlm_prefer (opt-in only; not default)
    merged = decide_vlm_candidate(vlm, after_primary_abstain=True)
    merged["ddddText"] = d_txt
    merged["ddddConfidence"] = dddd.get("confidence")
    merged["vlmText"] = v_txt
    merged["vlmUsed"] = True
    merged["vlmConflict"] = True
    merged["engine"] = "vlm7b"
    return merged
