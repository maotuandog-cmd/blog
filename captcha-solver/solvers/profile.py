"""S5 Policy/Profile — parameter packs only; does not redefine S1–S4 semantics.

Freeze (REQ §14):
  Priority: request fields → request.profile → default profile → built-in defaults
  Env bootstrap only: HERMES_CAPTCHA_PROFILE, HERMES_CAPTCHA_PROFILES_DIR
"""
from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BUILTIN_DIR = ROOT / "profiles"

_lock = threading.Lock()
_cache: dict[str, dict[str, Any]] | None = None
_cache_mtime: float = 0.0


def profiles_dir() -> Path:
    raw = (os.environ.get("HERMES_CAPTCHA_PROFILES_DIR") or "").strip()
    if raw:
        return Path(raw)
    return BUILTIN_DIR


def default_profile_name() -> str:
    """Bootstrap only: which profile when request omits profile."""
    raw = (os.environ.get("HERMES_CAPTCHA_PROFILE") or "default").strip()
    return raw or "default"


def _deep_merge(base: dict, overlay: dict) -> dict:
    out = deepcopy(base)
    for k, v in (overlay or {}).items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = deepcopy(v)
    return out


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _scan_profiles() -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    # Built-in first, then external dir overlays same names.
    for directory in (BUILTIN_DIR, profiles_dir()):
        if not directory.is_dir():
            continue
        if directory.resolve() == BUILTIN_DIR.resolve() and directory != BUILTIN_DIR:
            pass
        for path in sorted(directory.glob("*.json")):
            data = _read_json(path)
            if not data:
                continue
            name = str(data.get("name") or path.stem).strip()
            if not name:
                continue
            data = dict(data)
            data["name"] = name
            found[name] = data
    # Ensure built-ins always present even if dir empty
    for builtin in ("default", "demo-strict", "dcp-wide"):
        if builtin not in found:
            p = BUILTIN_DIR / f"{builtin}.json"
            data = _read_json(p)
            if data:
                data = dict(data)
                data["name"] = builtin
                found[builtin] = data
    return found


def _dir_mtime() -> float:
    m = 0.0
    for directory in {BUILTIN_DIR, profiles_dir()}:
        if not directory.is_dir():
            continue
        try:
            m = max(m, directory.stat().st_mtime)
            for p in directory.glob("*.json"):
                m = max(m, p.stat().st_mtime)
        except OSError:
            pass
    return m


def load_profiles(force: bool = False) -> dict[str, dict[str, Any]]:
    global _cache, _cache_mtime
    with _lock:
        mt = _dir_mtime()
        if not force and _cache is not None and mt <= _cache_mtime:
            return dict(_cache)
        _cache = _scan_profiles()
        _cache_mtime = mt
        return dict(_cache)


def list_profile_names() -> list[str]:
    return sorted(load_profiles().keys())


def get_profile(name: str) -> dict[str, Any] | None:
    profiles = load_profiles()
    return deepcopy(profiles.get(name))


def builtin_defaults() -> dict[str, Any]:
    """Hard floor when profile keys missing — matches S1–S4 freeze."""
    base = get_profile("default")
    if base:
        return base
    return {
        "name": "default",
        "ocr": {
            "mode": "auto",
            "minConf": 0.5,
            "softConf": 0.45,
            "len": None,
            "charset": None,
            "case": "lower",
            "morphWeight": 0.8,
            "beta": False,
            "agree": True,
            "agreeMin": 1.0,
            "agreeRelax": False,
        },
        "vlm": {
            "mode": "auto",
            "triggers": "t1",
            "policy": "abstain_on_conflict",
            "timeoutMs": 8000,
            "minDdddConf": 0.55,
            "weakShare": 0.5,
        },
        "decision": {"minConf": 0.5, "softConf": 0.45},
        "retry": {"maxAttempts": 2},
    }


def resolve_profile_name(req: dict | None = None) -> str:
    req = req or {}
    for key in ("profile", "policyProfile", "captchaProfile"):
        raw = req.get(key)
        if raw is None:
            continue
        name = str(raw).strip()
        if name:
            return name
    return default_profile_name()


def merge_profile(
    name: str,
    *,
    overrides: dict | None = None,
) -> dict[str, Any]:
    """built-in defaults ← named profile ← request overrides (parameter values only)."""
    base = builtin_defaults()
    named = get_profile(name)
    if named:
        merged = _deep_merge(base, named)
    else:
        merged = deepcopy(base)
        merged["name"] = name
        merged["_profileMissing"] = True
    if overrides and isinstance(overrides, dict):
        # Only allow known sections — no custom code.
        safe = {k: overrides[k] for k in ("ocr", "vlm", "decision", "retry") if k in overrides and isinstance(overrides[k], dict)}
        if safe:
            merged = _deep_merge(merged, safe)
    merged["name"] = name if named else merged.get("name") or name
    return merged


def resolve_active_profile(req: dict | None = None) -> dict[str, Any]:
    req = req or {}
    name = resolve_profile_name(req)
    overrides = req.get("profileOverrides")
    if not isinstance(overrides, dict):
        overrides = {}
    else:
        overrides = dict(overrides)
    # Request fields (highest priority after explicit profileOverrides merge order:
    # we apply these ON TOP of profileOverrides).
    field_over: dict[str, Any] = {}
    if req.get("ocrMode"):
        field_over.setdefault("ocr", {})["mode"] = str(req.get("ocrMode")).strip()
    hint = req.get("hint")
    if isinstance(hint, dict) and hint.get("ocrMode"):
        field_over.setdefault("ocr", {})["mode"] = str(hint.get("ocrMode")).strip()
    if field_over:
        overrides = _deep_merge(overrides, field_over)
    return merge_profile(name, overrides=overrides or None)


def dig(settings: dict | None, path: str, default: Any = None) -> Any:
    cur: Any = settings or {}
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def cfg(path: str, default: Any = None) -> Any:
    """Read from request-scoped active profile (via context)."""
    from .context import get_profile_settings

    return dig(get_profile_settings(), path, default)
