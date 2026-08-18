"""Captcha adapter package (EE-3).

Only ``build_bundle`` / ``build_bundle_dict`` — never ``solve``.
"""
from __future__ import annotations

from .mapper import build_bundle, build_bundle_dict

__all__ = ["build_bundle", "build_bundle_dict"]
