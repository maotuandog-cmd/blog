"""Map captcha OCR texts → Evidence Engine Candidates."""
from __future__ import annotations

from typing import Any

from core.candidate import Candidate


def _family(source: str) -> str:
    s = (source or "").lower()
    if "vlm" in s:
        return "vlm"
    if s in ("ddddocr", "ppllocr", "ddddocr_beta", "rapidocr") or "ocr" in s:
        return "ocr"
    return "unknown"


def map_candidates(result: dict[str, Any] | None) -> list[Candidate]:
    """Build candidate set from primary + secondary OCR fields (no truth claim)."""
    result = result or {}
    out: list[Candidate] = []
    seen: set[tuple[str, str]] = set()

    def _add(value: str, source: str, *, idx: int, extra: dict[str, Any] | None = None) -> None:
        text = str(value or "").strip()
        src = str(source or "unknown").strip() or "unknown"
        key = (text.casefold(), src.casefold())
        if not text or key in seen:
            return
        seen.add(key)
        cid = f"ocr-{src}-{idx}"
        meta = dict(extra or {})
        out.append(
            Candidate(
                id=cid,
                value=text,
                source=src,
                source_family=_family(src),
                metadata=meta,
            )
        )

    primary_src = str(result.get("engine") or result.get("ddddEngine") or "ddddocr").split("+")[0] or "ddddocr"
    primary_text = str(result.get("text") or result.get("ddddText") or "").strip()
    if primary_text:
        _add(
            primary_text,
            primary_src,
            idx=1,
            extra={
                "role": "primary",
                "preprocess": result.get("preprocess"),
                "confidence": result.get("confidence"),
            },
        )

    sec_text = str(result.get("secondaryText") or "").strip()
    sec_src = str(result.get("secondarySource") or "ppllocr").strip() or "ppllocr"
    if sec_text:
        _add(
            sec_text,
            sec_src,
            idx=2,
            extra={
                "role": "secondary",
                "confidence": result.get("secondaryConfidence"),
                "status": result.get("secondaryStatus"),
                "available": result.get("secondaryAvailable"),
            },
        )

    # Independent evidence list (if present) may carry additional sources.
    indep = result.get("independentEvidence")
    if isinstance(indep, list):
        for i, item in enumerate(indep, start=3):
            if not isinstance(item, dict):
                continue
            t = str(item.get("text") or item.get("normalizedText") or "").strip()
            src = str(item.get("source") or "unknown")
            _add(t, src, idx=i, extra={"role": item.get("independence") or item.get("status")})

    return out
