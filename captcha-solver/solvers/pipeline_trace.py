"""Pipeline stage trace — additive observation (REQ_CAPTCHA_VISUAL_DATALAYER).

Production default: metadata only (no raw image). Stages are append-only.
"""
from __future__ import annotations

import time
from typing import Any


class PipelineTrace:
    def __init__(self) -> None:
        self.stages: list[dict[str, Any]] = []
        self.meta: dict[str, Any] = {}

    def set_meta(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            if v is not None:
                self.meta[k] = v

    def stage(
        self,
        name: str,
        *,
        status: str = "ok",
        duration_ms: float | None = None,
        confidence: float | None = None,
        **extra: Any,
    ) -> None:
        row: dict[str, Any] = {"stage": name, "status": status}
        if duration_ms is not None:
            row["duration_ms"] = round(float(duration_ms), 3)
        if confidence is not None:
            try:
                row["confidence"] = round(float(confidence), 4)
            except (TypeError, ValueError):
                pass
        for k, v in extra.items():
            if v is not None:
                row[k] = v
        self.stages.append(row)

    def timed(self, name: str):
        return _StageTimer(self, name)

    def as_dict(self) -> dict[str, Any]:
        return {"meta": dict(self.meta), "stages": list(self.stages)}


class _StageTimer:
    def __init__(self, trace: PipelineTrace, name: str) -> None:
        self.trace = trace
        self.name = name
        self.t0 = 0.0
        self._extra: dict[str, Any] = {}
        self._status = "ok"
        self._confidence: float | None = None

    def __enter__(self) -> "_StageTimer":
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # noqa: ANN001
        ms = (time.perf_counter() - self.t0) * 1000.0
        status = "error" if exc_type else self._status
        self.trace.stage(
            self.name,
            status=status,
            duration_ms=ms,
            confidence=self._confidence,
            **self._extra,
        )
        return False

    def ok(self, *, confidence: float | None = None, **extra: Any) -> None:
        self._status = "ok"
        self._confidence = confidence
        self._extra.update(extra)

    def skip(self, reason: str = "skipped", **extra: Any) -> None:
        self._status = "skipped"
        self._extra["reason"] = reason
        self._extra.update(extra)

    def fail(self, reason: str, **extra: Any) -> None:
        self._status = "error"
        self._extra["reason"] = reason
        self._extra.update(extra)
