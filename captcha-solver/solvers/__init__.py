"""CAPTCHA classify → route → engine. No browser in this process."""

from .dispatch import solve_request

__all__ = ["solve_request"]
