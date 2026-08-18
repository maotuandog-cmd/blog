"""S2 Session/Attempt observation — additive fields only, zero behavior change.

Freeze (REQ §11):
  - sessionId: request passthrough preferred, else solver-generated
  - attemptId: one per /captcha call
  - observation: snapshot annotation (does not drive a state machine)
  - optional JSONL log; no DB / no session HTTP API
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from PIL import Image

# Snapshot labels only — not a driven state machine.
STATUS_CREATED = "CREATED"
STATUS_SOLVING = "SOLVING"
STATUS_ANSWER_READY = "ANSWER_READY"
STATUS_EXECUTED = "EXECUTED"
STATUS_VERIFIED = "VERIFIED"
STATUS_FAILED = "FAILED"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def resolve_session_id(req: dict) -> str:
    """Request passthrough preferred; else generate and return."""
    for key in ("sessionId", "captchaSessionId", "session_id"):
        raw = req.get(key)
        if raw is None:
            continue
        s = str(raw).strip()
        if s:
            return s[:128]
    return "s_" + uuid.uuid4().hex[:16]


def new_attempt_id() -> str:
    return "a_" + uuid.uuid4().hex[:12]


def resolve_attempt_id(req: dict) -> str:
    """Worker-provided attemptId preferred; else generate (legacy clients)."""
    for key in ("attemptId", "attempt_id"):
        raw = req.get(key)
        if raw is None:
            continue
        s = str(raw).strip()
        if s:
            return s[:128]
    return new_attempt_id()


def image_hash(img: Image.Image, n: int = 16) -> str:
    buf = __import__("io").BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    digest = hashlib.sha256(buf.getvalue()).hexdigest()
    return digest[: max(8, min(n, 64))]


# Alias used when attach_observation param shadows image_hash.
_pil_image_hash = image_hash


def _score(val: object) -> float | None:
    if val is None:
        return None
    try:
        return round(float(val), 4)
    except (TypeError, ValueError):
        return None


def _candidate(value: object, source: str, evidence: object = None, **extra: Any) -> dict:
    item: dict[str, Any] = {
        "value": value if not isinstance(value, str) else value,
        "source": source,
    }
    es = _score(evidence)
    if es is not None:
        item["evidenceScore"] = es
    for k, v in extra.items():
        if v is not None:
            item[k] = v
    return item


def build_candidates(result: dict) -> list[dict]:
    """Extract candidate list from solver result fields (no re-inference)."""
    cands: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(value: object, source: str, evidence: object = None, **extra: Any) -> None:
        if value is None or value == "":
            return
        if isinstance(value, str):
            key = (value.casefold(), source)
        else:
            key = (repr(value), source)
        if key in seen:
            return
        seen.add(key)
        cands.append(_candidate(value, source, evidence, **extra))

    dddd_txt = str(result.get("ddddText") or "").strip()
    vlm_txt = str(result.get("vlmText") or "").strip()
    if dddd_txt:
        add(
            dddd_txt,
            "ddddocr",
            result.get("ddddConfidence")
            if result.get("ddddConfidence") is not None
            else result.get("evidenceScore")
            if not vlm_txt
            else result.get("ocrConf") or result.get("evidenceScore"),
            characterEvidence=result.get("characterEvidence"),
            charSummary=result.get("charSummary"),
            charMinConfidence=result.get("charMinConfidence"),
        )
    if vlm_txt:
        add(
            vlm_txt,
            "vlm7b",
            None if result.get("modelScoreUncalibrated") else result.get("confidence"),
            modelScoreUncalibrated=True if result.get("modelScoreUncalibrated") or result.get("vlmUsed") else None,
        )

    kind = str(result.get("kind") or "")
    engine = str(result.get("engine") or "unknown")
    if not cands:
        text = str(result.get("text") or "").strip()
        if text:
            src = engine.split("+")[0] if engine else "unknown"
            if "vlm" in engine:
                src = "vlm7b" if not dddd_txt else engine
            add(
                text,
                src or "unknown",
                result.get("evidenceScore") or result.get("confidence"),
                characterEvidence=result.get("characterEvidence"),
                charSummary=result.get("charSummary"),
                charMinConfidence=result.get("charMinConfidence"),
            )
        elif kind == "slider" and result.get("offsetX") is not None:
            add(int(result["offsetX"]), "slider", result.get("evidenceScore") or result.get("confidence"))
        elif kind == "click" and result.get("points"):
            add(result.get("points"), "click", result.get("confidence"))

    return cands


def snapshot_status(result: dict) -> str:
    """Map attempt outcome to snapshot label (not a state machine transition)."""
    if result.get("solved"):
        return STATUS_ANSWER_READY
    return STATUS_FAILED


def failure_reasons(result: dict) -> list[str]:
    """Record-only taxonomy; S2 does not consume for retry."""
    reasons: list[str] = []
    reason = str(result.get("decisionReason") or result.get("reason") or "").strip().lower()
    if result.get("vlmConflict") or "conflict" in reason:
        reasons.append("ocr_conflict")
    if "disagreement" in reason or "disagree" in reason:
        reasons.append("ocr_conflict")
    if "low evidence" in reason or "low confidence" in reason:
        reasons.append("low_evidence")
    if "kind" in reason or "unknown kind" in reason:
        reasons.append("kind_uncertain")
    if "timeout" in reason:
        reasons.append("timeout")
    if "missing" in reason or "invalid" in reason:
        reasons.append("bad_input")
    if "no reliable" in reason or "no piece" in reason:
        reasons.append("geometry_uncertain")
    if not result.get("solved") and not reasons and reason:
        reasons.append("abstain")
    elif not result.get("solved") and not reasons:
        reasons.append("unsolved")
    # de-dupe preserve order
    out: list[str] = []
    for r in reasons:
        if r not in out:
            out.append(r)
    return out


def decision_payload(result: dict) -> dict:
    action = str(result.get("decision") or ("accept" if result.get("solved") else "abstain")).lower()
    if action not in ("accept", "abstain", "retry"):
        action = "accept" if result.get("solved") else "abstain"
    reason = str(result.get("decisionReason") or result.get("reason") or "")
    out: dict[str, Any] = {"action": action, "reason": reason}
    ds = _score(result.get("decisionScore"))
    if ds is not None:
        out["decisionScore"] = ds
    return out


def build_observation(
    *,
    req: dict,
    result: dict,
    img: Image.Image | None,
    session_id: str,
    attempt_id: str,
    created_at: str | None = None,
) -> dict:
    kind = str(result.get("kind") or result.get("classifiedAs") or req.get("kind") or "")
    class_kind = str(result.get("classifiedAs") or kind)
    class_score = _score(result.get("classifierConfidence"))
    obs: dict[str, Any] = {
        "snapshotStatus": snapshot_status(result),
        "createdAt": created_at or _utc_now_iso(),
        "jobId": str(req.get("jobId") or "") or None,
        "pageUrl": str(req.get("pageUrl") or req.get("url") or "") or None,
        "captchaKind": kind or None,
        "input": {
            "kind": str(req.get("kind") or kind or "auto"),
            "imageHash": image_hash(img) if img is not None else None,
        },
        "classifier": {
            "kind": class_kind,
            "score": class_score if class_score is not None else 0.0,
        },
        "candidates": build_candidates(result),
        "decision": decision_payload(result),
    }
    # Drop nulls in top-level optional meta for cleaner JSON
    if obs["jobId"] is None:
        del obs["jobId"]
    if obs["pageUrl"] is None:
        del obs["pageUrl"]
    if obs["captchaKind"] is None:
        del obs["captchaKind"]
    if not result.get("solved"):
        fr = failure_reasons(result)
        if fr:
            obs["failureReason"] = fr
    # Pass-through evidence mirrors (S1 semantics) when present
    for key in (
        "evidenceScore",
        "evidenceScoreRaw",
        "evidenceScoreAdjusted",
        "evidenceAdjustment",
        "captchaType",
        "routingHint",
        "agreementScore",
        "weightShare",
        "vlmUsed",
        "vlmConflict",
        "independentSources",
        "correlatedVotes",
        "characterEvidence",
        "charSummary",
        "charMinConfidence",
        "charMeanConfidence",
        "charAmbiguousCount",
        "candidateMargin",
        "runnerUpText",
        "runnerUpScore",
        "topCandidateText",
        "topCandidateScore",
        "tightCandidateMargin",
        "candidateRanking",
        "charRunnerUpText",
        "charMinMargin",
        "independentEvidence",
        "sourceAgreement",
        "secondaryComparison",
        "comparisonStatus",
        "comparisonReason",
        "independentAgree",
        "independentComparable",
        "independentConflict",
        "independentCharDiff",
        "secondarySource",
        "secondaryText",
        "secondaryConfidence",
        "secondaryStatus",
        "secondaryAvailable",
        "secondaryReason",
        "sourceUnavailable",
        "abstainReasonDetail",
        "abstainBucket",
        "abstainCandidateText",
    ):
        if key in result and result[key] is not None:
            obs[key] = result[key]
    # E1-A/B/C candidate wrapper (additive; decision unchanged)
    if (
        result.get("characterEvidence") is not None
        or result.get("candidateMargin") is not None
        or result.get("independentEvidence") is not None
        or str(result.get("text") or "").strip()
    ):
        obs["candidate"] = {
            "text": str(result.get("text") or "") or None,
            "characterEvidence": result.get("characterEvidence"),
            "charSummary": result.get("charSummary"),
            "candidateMargin": result.get("candidateMargin"),
            "runnerUpText": result.get("runnerUpText"),
            "runnerUpScore": result.get("runnerUpScore"),
            "topCandidateScore": result.get("topCandidateScore"),
            "tightCandidateMargin": result.get("tightCandidateMargin"),
            "candidateRanking": result.get("candidateRanking"),
            "charRunnerUpText": result.get("charRunnerUpText"),
            "charMinMargin": result.get("charMinMargin"),
            "independentEvidence": result.get("independentEvidence"),
            "sourceAgreement": result.get("sourceAgreement"),
        }
    obs["sessionId"] = session_id
    obs["attemptId"] = attempt_id
    return obs


def maybe_append_jsonl(record: dict) -> None:
    """Optional observation sink. Env: HERMES_CAPTCHA_OBS_JSONL=/path/file.jsonl"""
    path = (os.environ.get("HERMES_CAPTCHA_OBS_JSONL") or "").strip()
    if not path:
        return
    try:
        from pathlib import Path

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with p.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def attach_observation(
    req: dict,
    result: dict,
    img: Image.Image | None,
    *,
    trace: object | None = None,
    image_hash: str | None = None,
) -> dict:
    """Stamp sessionId / attemptId / observation onto result. Does not alter solved."""
    out = dict(result)
    solved_before = bool(out.get("solved"))
    text_before = out.get("text")
    offset_before = out.get("offsetX")

    # E2-B1: evidence-gap routing hint (observation only; never applied).
    try:
        from .routing_hint import build_routing_hint, routing_hint_enabled

        if routing_hint_enabled():
            out["routingHint"] = build_routing_hint(out)
    except Exception:
        out["routingHint"] = {
            "recommendSecondary": False,
            "priority": "low",
            "applied": False,
            "reasons": [],
            "observationOnly": True,
            "error": "hint_build_failed",
        }

    session_id = resolve_session_id(req)
    attempt_id = resolve_attempt_id(req)
    created_at = _utc_now_iso()

    # Prefer Worker-supplied / decode hash; fall back to PIL re-encode hash.
    echo_hash = str(image_hash or req.get("imageHash") or "").strip().lower()
    if not echo_hash and img is not None:
        echo_hash = _pil_image_hash(img, n=64)

    obs = build_observation(
        req=req,
        result=out,
        img=img,
        session_id=session_id,
        attempt_id=attempt_id,
        created_at=created_at,
    )
    if echo_hash:
        obs.setdefault("input", {})
        if isinstance(obs["input"], dict):
            obs["input"]["imageHash"] = echo_hash
    if trace is not None:
        try:
            pipe = trace.as_dict() if hasattr(trace, "as_dict") else trace
            obs["pipelineTrace"] = pipe
            # Flatten useful meta onto observation for bench joins.
            meta = (pipe or {}).get("meta") if isinstance(pipe, dict) else None
            if isinstance(meta, dict):
                for k in (
                    "image_id",
                    "yolo_model_version",
                    "ocr_model_version",
                    "vlm_model_version",
                    "preprocess_version",
                ):
                    if meta.get(k) is not None:
                        obs[k] = meta[k]
        except Exception:
            pass
    if out.get("s0") is not None:
        obs["s0"] = out.get("s0")
    if out.get("detection") is not None:
        obs["detection"] = out.get("detection")
    if out.get("visualCandidates") is not None:
        obs["visualCandidates"] = out.get("visualCandidates")
    if out.get("yoloOcr") is not None:
        obs["yoloOcr"] = out.get("yoloOcr")
    for key in (
        "fusion",
        "fusionMode",
        "actualDecision",
        "shadowDecision",
        "shadowDelta",
    ):
        if out.get(key) is not None:
            obs[key] = out.get(key)

    # EE-3: Captcha Adapter bypass — EvidenceBundle on observation only.
    try:
        from .evidence_bundle_obs import attach_evidence_bundle

        obs = attach_evidence_bundle(out, obs)
    except Exception:
        pass
    out["sessionId"] = session_id
    out["attemptId"] = attempt_id
    if echo_hash:
        out["imageHash"] = echo_hash
    out["observation"] = obs

    # Safety: observation must never flip Worker contract fields.
    out["solved"] = solved_before
    if text_before is not None:
        out["text"] = text_before
    if offset_before is not None:
        out["offsetX"] = offset_before

    maybe_append_jsonl(
        {
            "ts": created_at,
            "type": "observation",
            "sessionId": session_id,
            "attemptId": attempt_id,
            "imageHash": echo_hash,
            "jobId": req.get("jobId"),
            "solved": solved_before,
            # Production: no raw image bytes in JSONL by default.
            "observation": obs,
            "latency_ms": out.get("latency_ms"),
            "pipelineStages": (obs.get("pipelineTrace") or {}).get("stages"),
        }
    )
    try:
        from .feedback import register_attempt, snapshot_from_solve_result

        register_attempt(
            session_id=session_id,
            attempt_id=attempt_id,
            decision_snapshot=snapshot_from_solve_result(out),
        )
    except Exception:
        pass
    return out
