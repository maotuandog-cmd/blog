"""Per-request context: retry hints (S4) + active profile settings (S5)."""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_retry_hints: ContextVar[dict[str, Any] | None] = ContextVar("captcha_retry_hints", default=None)
_profile_settings: ContextVar[dict[str, Any] | None] = ContextVar("captcha_profile", default=None)


def set_retry_hints(hints: dict[str, Any] | None) -> None:
    _retry_hints.set(dict(hints) if hints else None)


def get_retry_hints() -> dict[str, Any]:
    return dict(_retry_hints.get() or {})


def clear_retry_hints() -> None:
    _retry_hints.set(None)


def set_profile_settings(settings: dict[str, Any] | None) -> None:
    _profile_settings.set(dict(settings) if settings else None)


def get_profile_settings() -> dict[str, Any]:
    return dict(_profile_settings.get() or {})


def clear_profile_settings() -> None:
    _profile_settings.set(None)


def active_profile_name() -> str | None:
    s = _profile_settings.get()
    if not s:
        return None
    name = s.get("name")
    return str(name) if name else None
