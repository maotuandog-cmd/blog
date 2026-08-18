#!/usr/bin/env python3
"""Visual datalayer A/B + char pipeline C0–C4 (REQ_CAPTCHA_CHAR_CANDIDATE).

Legacy arms A–E; Phase 2 arms C0–C4. Default Fusion=shadow (do NOT enable FUSION=on).

Usage:
  # C1-first (expand crop only)
  DATA_DIR=captcha-solver/datasets/demo_char_detect SPLIT=val MAX_N=200 \\
  ARMS=C0,C1 \\
  captcha-solver/.venv/bin/python -u scripts/captcha_visual_ab.py

  # Full C0–C4
  ARMS=C0,C1,C2,C3,C4 ...
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOLVER = ROOT / "captcha-solver"
sys.path.insert(0, str(SOLVER))

from solvers.decode import sha256_bytes  # noqa: E402
from solvers.dispatch import solve_request  # noqa: E402

IOU_MATCH = 0.45


def _load_items(data_dir: Path) -> list[dict]:
    """Return [{path, answer, boxes, id}, ...]."""
    items: list[dict] = []
    split_filter = (os.environ.get("SPLIT") or "").strip().lower()
    max_n = int(os.environ.get("MAX_N") or "0")
    man = data_dir / "manifest.jsonl"
    if man.is_file():
        for line in man.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if split_filter and str(row.get("split") or "").lower() != split_filter:
                continue
            p = data_dir / row["path"]
            if not p.is_file():
                continue
            items.append(
                {
                    "id": row.get("id") or p.stem,
                    "path": p,
                    "answer": str(row.get("answer") or "").strip(),
                    "boxes": list(row.get("boxes") or []),
                }
            )
        if max_n > 0:
            items = items[:max_n]
        return items
    for png in sorted(data_dir.glob("*.png")):
        txt = png.with_suffix(".txt")
        if not txt.is_file():
            continue
        items.append(
            {
                "id": png.stem,
                "path": png,
                "answer": txt.read_text(encoding="utf-8").strip(),
                "boxes": [],
            }
        )
    if max_n > 0:
        items = items[:max_n]
    return items


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _arm_env(arm: str) -> dict[str, str]:
    # Legacy A–E
    if arm == "A":
        return {
            "HERMES_CAPTCHA_DETECT": "off",
            "HERMES_CAPTCHA_OCR_VARIANTS": "0",
            "HERMES_CAPTCHA_FUSION": "off",
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c0",
        }
    if arm == "B":
        return {
            "HERMES_CAPTCHA_DETECT": "off",
            "HERMES_CAPTCHA_FUSION": "off",
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c0",
        }
    if arm == "C":
        return {
            "HERMES_CAPTCHA_DETECT": "yolo",
            "HERMES_CAPTCHA_VLM": "off",
            "HERMES_CAPTCHA_FUSION": "off",
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c0",
        }
    if arm == "D":
        return {
            "HERMES_CAPTCHA_DETECT": "yolo",
            "HERMES_CAPTCHA_VLM": "auto",
            "HERMES_CAPTCHA_FUSION": "off",
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c0",
        }
    if arm == "E":
        return {
            "HERMES_CAPTCHA_DETECT": "auto",
            "HERMES_CAPTCHA_FUSION": "shadow",
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c0",
        }
    # Phase 2 char pipeline C0–C4 (YOLO+VLM frozen as variables)
    base = {
        "HERMES_CAPTCHA_DETECT": "yolo",
        "HERMES_CAPTCHA_VLM": "off",
        "HERMES_CAPTCHA_FUSION": "shadow",
    }
    if arm == "C0":
        return {**base, "HERMES_CAPTCHA_CHAR_PIPELINE": "c0", "HERMES_CAPTCHA_FUSION": "off"}
    if arm == "C1":
        return {**base, "HERMES_CAPTCHA_CHAR_PIPELINE": "c1", "HERMES_CAPTCHA_FUSION": "off"}
    if arm == "C2":
        return {**base, "HERMES_CAPTCHA_CHAR_PIPELINE": "c2", "HERMES_CAPTCHA_FUSION": "off"}
    if arm == "C3":
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c3",
            "HERMES_CAPTCHA_CHAR_TOPK": "3",
            "HERMES_CAPTCHA_FUSION": "off",
        }
    if arm in ("C3-2", "C32", "C3_2"):
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c3",
            "HERMES_CAPTCHA_CHAR_TOPK": "2",
            "HERMES_CAPTCHA_FUSION": "off",
        }
    if arm in ("C3-3", "C33", "C3_3"):
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c3",
            "HERMES_CAPTCHA_CHAR_TOPK": "3",
            "HERMES_CAPTCHA_FUSION": "off",
        }
    if arm == "C4":
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c4",
            "HERMES_CAPTCHA_CHAR_TOPK": "2",
            "HERMES_CAPTCHA_CHAR_MIN_MARGIN": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_MARGIN", "0.35"
            ),
            "HERMES_CAPTCHA_CHAR_MIN_AGREE": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_AGREE", "0.50"
            ),
            "HERMES_CAPTCHA_FUSION": "shadow",
        }
    if arm in ("C5", "C5-R", "C5R"):
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c5",
            "HERMES_CAPTCHA_CHAR_TOPK": "2",
            "HERMES_CAPTCHA_CHAR_MIN_MARGIN": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_MARGIN", "0.35"
            ),
            "HERMES_CAPTCHA_CHAR_MIN_AGREE": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_AGREE", "0.50"
            ),
            "HERMES_CAPTCHA_FUSION": "shadow",
        }
    if arm in ("C5O", "C5-R2-O", "C5R2O", "C5-R''-O"):
        return {
            **base,
            "HERMES_CAPTCHA_CHAR_PIPELINE": "c5o",
            "HERMES_CAPTCHA_CHAR_TOPK": "2",
            "HERMES_CAPTCHA_CHAR_MIN_MARGIN": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_MARGIN", "0.35"
            ),
            "HERMES_CAPTCHA_CHAR_MIN_AGREE": os.environ.get(
                "HERMES_CAPTCHA_CHAR_MIN_AGREE", "0.50"
            ),
            "HERMES_CAPTCHA_FUSION": "shadow",
        }
    return {}


def _apply_env(overrides: dict[str, str]) -> dict[str, str | None]:
    prev: dict[str, str | None] = {}
    for k, v in overrides.items():
        prev[k] = os.environ.get(k)
        os.environ[k] = v
    return prev


def _restore_env(prev: dict[str, str | None]) -> None:
    for k, v in prev.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def _iou(a: dict, b: dict) -> float:
    try:
        ax1, ay1, ax2, ay2 = float(a["x1"]), float(a["y1"]), float(a["x2"]), float(a["y2"])
        bx1, by1, bx2, by2 = float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])
    except Exception:
        return 0.0
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1e-6, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1e-6, (bx2 - bx1) * (by2 - by1))
    return inter / (area_a + area_b - inter)


def _match_boxes(gt: list[dict], pred: list[dict], thr: float = IOU_MATCH) -> tuple[int, int, int]:
    """Greedy IoU match → (tp, fp, fn)."""
    used = set()
    tp = 0
    for g in gt:
        best_i, best = -1, 0.0
        for i, p in enumerate(pred):
            if i in used:
                continue
            v = _iou(g, p)
            if v > best:
                best, best_i = v, i
        if best_i >= 0 and best >= thr:
            used.add(best_i)
            tp += 1
    fp = len(pred) - tp
    fn = len(gt) - tp
    return tp, fp, fn


def _char_stats(pred: str, gt: str) -> tuple[int, int]:
    """Position-aligned char hits (min length). Returns (hits, compared)."""
    pred_u, gt_u = pred.upper(), gt.upper()
    n = min(len(pred_u), len(gt_u))
    if n == 0:
        return 0, max(len(pred_u), len(gt_u)) or 0
    hits = sum(1 for i in range(n) if pred_u[i] == gt_u[i])
    # Penalize length mismatch in denominator.
    compared = max(len(pred_u), len(gt_u))
    return hits, compared


def _candidate_entropy(cands: list[dict]) -> float:
    import math

    scores = []
    for c in cands:
        try:
            s = float(c.get("score") or 0)
        except (TypeError, ValueError):
            s = 0.0
        if s > 0:
            scores.append(s)
    total = sum(scores) or 1.0
    probs = [s / total for s in scores]
    if not probs:
        return 0.0
    return round(-sum(p * math.log(p + 1e-12) for p in probs), 4)


def _oracle_position(
    gt_char: str, cands: list[dict], k: int
) -> bool:
    """True if GT glyph appears in Top-K candidates."""
    g = (gt_char or "").upper()
    if not g:
        return False
    for c in (cands or [])[:k]:
        ch = str(c.get("char") or "").upper()
        if ch == g:
            return True
    return False


def _is_wide(b: dict, median_w: float | None) -> bool:
    try:
        w = float(b["x2"]) - float(b["x1"])
        h = max(1.0, float(b["y2"]) - float(b["y1"]))
    except Exception:
        return False
    if w / h >= 1.45:
        return True
    if median_w and w >= median_w * 1.65:
        return True
    return False


def _classify_c_failure(
    *,
    answer: str,
    text: str,
    det_boxes: list[dict],
    raw_boxes: list[dict],
    gt_boxes: list[dict],
    yolo: dict,
    solved: bool,
) -> str:
    """Primary failure bucket for wrong full-string C."""
    n_gt = len(answer)
    n_det = len(det_boxes) if det_boxes else len(raw_boxes)
    status = str((yolo or {}).get("status") or "")
    if status == "skipped" or (not raw_boxes and not det_boxes):
        return "yolo_no_detect"
    if n_det == 0:
        return "yolo_no_detect"
    if n_det < n_gt:
        return "yolo_under_detect"
    if n_det > n_gt + 1:
        return "yolo_over_detect"

    widths = []
    for b in raw_boxes or det_boxes:
        try:
            widths.append(float(b["x2"]) - float(b["x1"]))
        except Exception:
            pass
    widths.sort()
    med = widths[len(widths) // 2] if widths else None
    if any(_is_wide(b, med) for b in (raw_boxes or [])):
        # sticky suspected if split didn't fully expand
        splits = int(yolo.get("split_count") or 0)
        if splits == 0 and any(_is_wide(b, med) for b in raw_boxes):
            return "bbox_sticky"
    if int(yolo.get("split_count") or 0) > 0 and n_det != n_gt:
        return "bbox_sticky"

    # Crop/OCR: length matches but string wrong
    if len(text) == n_gt and text.upper() != answer.upper():
        hits, compared = _char_stats(text, answer)
        if compared and hits / compared >= 0.6:
            return "ocr_partial_wrong"
        return "ocr_wrong"
    if len(text) != n_gt and text:
        # detection count ok but OCR string length off → crop cut / merge
        if n_det == n_gt:
            return "bbox_crop_cut"
        return "ocr_wrong"
    if not text:
        return "ocr_empty"
    if text.upper() == answer.upper() and not solved:
        return "decision_wrong"
    return "other"


def run() -> int:
    data_dir = Path(os.environ.get("DATA_DIR") or ROOT / "testdata" / "captcha_visual")
    if not data_dir.is_dir():
        print(f"# no dataset at {data_dir}")
        return 1

    items = _load_items(data_dir)
    if not items:
        print("no labeled items", file=sys.stderr)
        return 1
    print(
        f"loaded n={len(items)} from {data_dir} split={os.environ.get('SPLIT') or 'all'}",
        flush=True,
    )

    arms_raw = (os.environ.get("ARMS") or "A,B,C,D,E").strip()
    arms = [a.strip().upper() for a in arms_raw.split(",") if a.strip()]
    # Normalize aliases
    _arm_alias = {
        "C32": "C3-2",
        "C3_2": "C3-2",
        "C33": "C3-3",
        "C3_3": "C3-3",
        "C5R": "C5",
        "C5-R": "C5",
        "C5R2O": "C5O",
        "C5-R2-O": "C5O",
        "C5-R''-O": "C5O",
    }
    arms = [_arm_alias.get(a, a) for a in arms]
    char_arms = {"C0", "C1", "C2", "C3", "C3-2", "C3-3", "C4", "C5", "C5O"}
    c5_shadow_arms = {"C5", "C5O"}
    gate_shadow_arms = {"C4", "C5", "C5O"}
    c3_arms = {"C3", "C3-2", "C3-3"}
    labels = {
        "A": "A raw OCR",
        "B": "B preprocess OCR",
        "C": "C YOLO+OCR",
        "D": "D YOLO+VLM",
        "E": "E Fusion shadow",
        "C0": "C0 YOLO+OCR baseline",
        "C1": "C1 expand crop",
        "C2": "C2 multi-view",
        "C3": "C3 Top-3 (shadow)",
        "C3-2": "C3-2 Top-2 (shadow)",
        "C3-3": "C3-3 Top-3 (shadow)",
        "C4": "C4 char Fusion shadow",
        "C5": "C5-R′ risk gate (Top-2 confusion)",
        "C5O": "C5-R″-O L1 observe + C5-R′",
    }
    stats: dict[str, dict] = {}
    c_failures: list[dict] = []
    c_fail_counts: dict[str, int] = defaultdict(int)
    matrix_counts: dict[str, int] = defaultdict(int)
    c4_wrong_pass = 0
    # GT-aware recovery matrix (C0 correct/wrong × C4 PASS/RETRY)
    gt_matrix: dict[str, int] = defaultdict(int)
    c4_true_rescue = 0
    c4_break_correct = 0
    c4_reason_counts: dict[str, int] = defaultdict(int)
    c4_gate_reasons: dict[str, int] = defaultdict(int)
    # Among C4 PASS but GT-wrong samples: per-position reason on wrong glyphs
    c4_fp_pos_reasons: dict[str, int] = defaultdict(int)
    c4_fp_pos_n = 0
    # Confusion: GT → OCR (all FP glyphs + HIGH_CONF-only)
    c4_fp_confuse: dict[str, int] = defaultdict(int)
    c4_fp_confuse_high_conf: dict[str, int] = defaultdict(int)
    c4_fp_confuse_rows: list[dict] = []
    # Per-arm predictions for C0↔C2 position rescue / C3 oracle
    arm_preds: dict[str, dict[str, dict]] = defaultdict(dict)

    for arm in arms:
        prev = _apply_env(_arm_env(arm))
        try:
            try:
                import solvers.yolo_detect as yd

                yd._model = None
                yd._model_err = None
            except Exception:
                pass

            n = 0
            correct = 0
            abstain = 0
            latencies: list[float] = []
            by_len: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            fp = fn = skipped = 0
            shadow_pass_n = 0
            delta_counts: dict[str, int] = defaultdict(int)
            source_ok: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            char_hits = char_total = 0
            det_tp = det_fp = det_fn = 0
            length_exact = 0
            length_total = 0
            crop_cut_n = 0
            ocr_partial_n = 0
            # Oracle / candidate quality (C3)
            top1_hits = top1_n = 0
            top2_hits = top2_n = 0
            top3_hits = top3_n = 0
            oracle_str_top2 = oracle_str_top3 = 0
            sum_entropy = sum_margin = sum_set_size = sum_top1 = 0.0
            cand_pos_n = 0
            low_margin_n = 0  # top1-top2 margin < 0.15
            # Per-arm shadow recovery (C4/C5)
            arm_gt_matrix: dict[str, int] = defaultdict(int)
            arm_wrong_pass = 0
            arm_true_rescue = 0
            arm_break_correct = 0
            # C5 triggers
            c5_trig_n = 0
            c5_trig_samples = 0
            c5_trig_dangerous = 0  # trigger where glyph ≠ GT (or illegal)
            c5_trig_by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
            # [triggers, dangerous]
            c5_blocked_fp = 0  # C4 text would be wrong PASS, C5 retries
            c5_remaining_fp = 0
            # C5-R″-O L1 observe metrics
            l1_trig_n = 0
            l1_trig_samples = 0
            l1_trig_dangerous = 0
            l1_fp_hits = 0  # remaining FP with L1 on wrong glyph
            l1_sim_blocked_fp = 0
            l1_sim_break = 0
            l1_sim_retry_add = 0

            for it in items:
                path: Path = it["path"]
                answer: str = it["answer"]
                gt_boxes: list = it.get("boxes") or []
                raw = path.read_bytes()
                image_hash = sha256_bytes(raw)
                req = {
                    "jobId": f"ab_{arm}_{path.stem}",
                    "attemptId": f"att_ab_{arm}_{path.stem}",
                    "sessionId": f"s_ab_{arm}",
                    "imageHash": image_hash,
                    "timestamp": int(time.time() * 1000),
                    "pageUrl": "file://visual-ab",
                    "kind": "image",
                    "screenshotBase64": _b64(path),
                }
                t0 = time.perf_counter()
                out = solve_request(req)
                dt = (time.perf_counter() - t0) * 1000
                latencies.append(dt)
                n += 1
                if n % 10 == 0 or n == len(items):
                    print(f"  arm={arm} {n}/{len(items)} last_ms={dt:.0f}", flush=True)

                det = out.get("detection") or {}
                yolo = out.get("yoloOcr") or {}
                if arm in ("C", "D", *char_arms) and det.get("status") == "skipped":
                    skipped += 1

                text = str(out.get("text") or "").strip()
                if arm == "C" or arm in ("C0", "C1", "C2"):
                    text = str(yolo.get("provisionalText") or yolo.get("text") or text).strip()
                if arm in c3_arms:
                    # Shadow: live/actual stays C0; evaluate Top-1 provisional separately
                    text = str(yolo.get("provisionalText") or "").strip()
                if arm == "D":
                    text = str(out.get("vlmText") or text).strip()
                if arm == "E":
                    shadow = out.get("shadowDecision") or {}
                    if str(shadow.get("action") or "") == "pass":
                        text = str(shadow.get("text") or "").strip()
                        shadow_pass_n += 1
                    else:
                        text = ""
                    delta_counts[str(out.get("shadowDelta") or "none")] += 1
                if arm in gate_shadow_arms:
                    shadow = out.get("shadowDecision") or {}
                    matrix = out.get("charShadowMatrix") or {}
                    cell = str(matrix.get("cell") or "unknown")
                    matrix_counts[cell] += 1
                    delta_counts[str(out.get("shadowDelta") or "none")] += 1
                    c0_text = str(yolo.get("c0Text") or "").strip()
                    c0_ok = bool(c0_text) and c0_text.upper() == answer.upper()
                    shadow_pass = str(shadow.get("action") or "") == "pass"
                    c4_pre = str(yolo.get("c4Text") or "").strip()
                    c4_would_pass = bool(c4_pre)
                    c4_would_ok = c4_would_pass and c4_pre.upper() == answer.upper()
                    c4_would_fp = c4_would_pass and not c4_would_ok

                    if shadow_pass:
                        text = str(
                            shadow.get("text")
                            or yolo.get("c5Text")
                            or yolo.get("c4Text")
                            or ""
                        ).strip()
                        shadow_pass_n += 1
                        shadow_ok = bool(text) and text.upper() == answer.upper()
                        if not shadow_ok:
                            arm_wrong_pass += 1
                            c4_wrong_pass += 1
                            if arm in c5_shadow_arms:
                                c5_remaining_fp += 1
                            gt_u = answer.upper()
                            for pd in (yolo.get("charGate") or {}).get("positions") or []:
                                if not isinstance(pd, dict):
                                    continue
                                if str(pd.get("decision") or "") != "PASS":
                                    continue
                                i = int(pd.get("position") or 0)
                                sel = str(pd.get("selected") or "").upper()
                                g = gt_u[i] if i < len(gt_u) else ""
                                if g and sel != g:
                                    reason = str(pd.get("reason") or "?")
                                    c4_fp_pos_reasons[reason] += 1
                                    c4_fp_pos_n += 1
                                    pair = f"{g}→{sel}"
                                    c4_fp_confuse[pair] += 1
                                    if reason == "HIGH_CONF":
                                        c4_fp_confuse_high_conf[pair] += 1
                                    c4_fp_confuse_rows.append(
                                        {
                                            "arm": arm,
                                            "id": it["id"],
                                            "position": i,
                                            "gt": g,
                                            "ocr": sel,
                                            "reason": reason,
                                            "answer": answer,
                                            "pred": text,
                                            "c0": c0_text,
                                        }
                                    )
                        if shadow_ok and not c0_ok:
                            arm_true_rescue += 1
                            c4_true_rescue += 1
                        if (not shadow_ok) and c0_ok:
                            arm_break_correct += 1
                            c4_break_correct += 1
                    else:
                        text = ""
                        if arm in c5_shadow_arms and c4_would_fp:
                            c5_blocked_fp += 1

                    tag = "C5O" if arm == "C5O" else ("C5" if arm == "C5" else "C4")
                    gt_key = (
                        ("C0_OK" if c0_ok else "C0_BAD")
                        + "_"
                        + (f"{tag}_PASS" if shadow_pass else f"{tag}_RETRY")
                    )
                    arm_gt_matrix[gt_key] += 1
                    gt_matrix[gt_key] += 1
                    gate = yolo.get("charGate") or {}
                    c4_gate_reasons[str(gate.get("reason") or "?")] += 1
                    for pd in gate.get("positions") or []:
                        if isinstance(pd, dict):
                            c4_reason_counts[str(pd.get("reason") or "?")] += 1

                    if arm in c5_shadow_arms:
                        triggers = list(
                            yolo.get("c5Triggers") or out.get("c5Triggers") or []
                        )
                        if triggers:
                            c5_trig_samples += 1
                        gt_u = answer.upper()
                        for tr in triggers:
                            if not isinstance(tr, dict):
                                continue
                            c5_trig_n += 1
                            rtype = str(tr.get("riskType") or "?")
                            c5_trig_by_type[rtype][0] += 1
                            pos = int(tr.get("position") or 0)
                            cand = str(tr.get("candidate") or "").upper()
                            g = gt_u[pos] if pos < len(gt_u) else ""
                            dangerous = False
                            if rtype == "ILLEGAL_CHAR":
                                dangerous = True
                            elif g and cand and cand != g:
                                dangerous = True
                            elif rtype in ("LOW_MARGIN", "UNSTABLE") and (
                                not cand or (g and cand != g)
                            ):
                                dangerous = True
                            if dangerous:
                                c5_trig_dangerous += 1
                                c5_trig_by_type[rtype][1] += 1

                    if arm == "C5O":
                        l1_obs = list(
                            yolo.get("c5L1Observations")
                            or out.get("c5L1Observations")
                            or []
                        )
                        if l1_obs:
                            l1_trig_samples += 1
                        gt_u = answer.upper()
                        l1_any = False
                        l1_wrong_on_fp = False
                        for ob in l1_obs:
                            if not isinstance(ob, dict):
                                continue
                            l1_trig_n += 1
                            l1_any = True
                            pos = int(ob.get("position") or 0)
                            cand = str(
                                ob.get("candidate") or ob.get("ocrChar") or ""
                            ).upper()
                            g = gt_u[pos] if pos < len(gt_u) else ""
                            if g and cand and cand != g:
                                l1_trig_dangerous += 1
                                if shadow_pass and not shadow_ok:
                                    l1_wrong_on_fp = True
                        if shadow_pass and not shadow_ok and l1_wrong_on_fp:
                            l1_fp_hits += 1
                        if shadow_pass and l1_any:
                            l1_sim_retry_add += 1
                            if not shadow_ok:
                                l1_sim_blocked_fp += 1
                            if shadow_ok:
                                l1_sim_break += 1

                for cand in out.get("visualCandidates") or []:
                    if not isinstance(cand, dict):
                        continue
                    src = str(cand.get("source") or "?")
                    ct = str(cand.get("text") or "").strip()
                    source_ok[src][1] += 1
                    if ct.upper() == answer.upper():
                        source_ok[src][0] += 1

                solved = bool(out.get("solved"))
                decision = str(out.get("decision") or "").lower()
                if arm in ("E", *gate_shadow_arms):
                    if not text:
                        abstain += 1
                elif arm in c3_arms:
                    # C3 does not change submit; abstain metric N/A — skip inflate
                    pass
                elif (not solved) or decision in ("abstain", "retry"):
                    abstain += 1

                ok = bool(text) and text.upper() == answer.upper()
                bucket = str(len(answer))
                by_len[bucket][1] += 1
                if ok:
                    correct += 1
                    by_len[bucket][0] += 1
                elif arm in ("E", *gate_shadow_arms):
                    if text:
                        fp += 1
                    else:
                        fn += 1
                elif arm in c3_arms:
                    # Shadow eval of provisional Top-1 only (not live FP)
                    if text and not ok:
                        fp += 1
                    elif not text:
                        fn += 1
                elif solved:
                    fp += 1
                else:
                    fn += 1

                # Character-level + detection metrics
                if arm in ("C", "C0", "C1", "C2", *c3_arms):
                    hits, compared = _char_stats(text, answer)
                    char_hits += hits
                    char_total += compared
                    pred_boxes = list(det.get("boxes") or [])
                    raw_boxes = list(det.get("boxesRaw") or pred_boxes)
                    if gt_boxes:
                        tp, fpp, fnn = _match_boxes(gt_boxes, pred_boxes or raw_boxes)
                        det_tp += tp
                        det_fp += fpp
                        det_fn += fnn
                    length_total += 1
                    if len(pred_boxes or raw_boxes) == len(answer):
                        length_exact += 1

                    chars = list(yolo.get("characters") or [])
                    arm_preds[arm][str(it["id"])] = {
                        "answer": answer,
                        "pred": text,
                        "c0": str(yolo.get("c0Text") or ""),
                        "ok": ok,
                        "characters": chars,
                    }

                    # Oracle character recall + candidate quality (C3)
                    if arm in c3_arms:
                        gt_u = answer.upper()
                        pos_oracle2 = True
                        pos_oracle3 = True
                        for i, g in enumerate(gt_u):
                            cands = []
                            if i < len(chars) and isinstance(chars[i], dict):
                                cands = list(chars[i].get("candidates") or [])
                            top1_n += 1
                            if _oracle_position(g, cands, 1):
                                top1_hits += 1
                            top2_n += 1
                            if _oracle_position(g, cands, 2):
                                top2_hits += 1
                            else:
                                pos_oracle2 = False
                            top3_n += 1
                            if _oracle_position(g, cands, 3):
                                top3_hits += 1
                            else:
                                pos_oracle3 = False

                            if cands:
                                cand_pos_n += 1
                                s0 = float(cands[0].get("score") or 0)
                                s1 = float(cands[1].get("score") or 0) if len(cands) > 1 else 0.0
                                margin = s0 - s1
                                sum_top1 += s0
                                sum_margin += margin
                                sum_set_size += len(cands)
                                sum_entropy += _candidate_entropy(cands)
                                if margin < 0.15:
                                    low_margin_n += 1
                        if pos_oracle2 and len(chars) >= len(gt_u):
                            oracle_str_top2 += 1
                        if pos_oracle3 and len(chars) >= len(gt_u):
                            oracle_str_top3 += 1

                    if not ok and arm not in c3_arms:
                        reason = _classify_c_failure(
                            answer=answer,
                            text=text,
                            det_boxes=pred_boxes,
                            raw_boxes=raw_boxes,
                            gt_boxes=gt_boxes,
                            yolo=yolo,
                            solved=solved,
                        )
                        c_fail_counts[f"{arm}:{reason}"] += 1
                        if reason == "bbox_crop_cut":
                            crop_cut_n += 1
                        if reason == "ocr_partial_wrong":
                            ocr_partial_n += 1
                        c_failures.append(
                            {
                                "arm": arm,
                                "id": it["id"],
                                "answer": answer,
                                "pred": text,
                                "reason": reason,
                                "det_n": len(pred_boxes or raw_boxes),
                                "gt_n": len(answer),
                                "split_count": yolo.get("split_count"),
                                "char_hits": hits,
                                "char_total": compared,
                                "pipeline": yolo.get("pipeline"),
                            }
                        )
                    elif not ok and arm in c3_arms:
                        reason = _classify_c_failure(
                            answer=answer,
                            text=text,
                            det_boxes=pred_boxes,
                            raw_boxes=raw_boxes,
                            gt_boxes=gt_boxes,
                            yolo=yolo,
                            solved=solved,
                        )
                        c_fail_counts[f"{arm}:{reason}"] += 1
                        if reason == "bbox_crop_cut":
                            crop_cut_n += 1
                        if reason == "ocr_partial_wrong":
                            ocr_partial_n += 1

            stats[arm] = {
                "n": n,
                "correct": correct,
                "abstain": abstain,
                "fp": fp,
                "fn": fn,
                "skipped": skipped,
                "avg_ms": sum(latencies) / len(latencies) if latencies else 0,
                "by_len": dict(by_len),
                "acc": (correct / n) if n else 0,
                "abstain_rate": (abstain / n) if n else 0,
                "shadow_pass_n": shadow_pass_n,
                "delta_counts": dict(delta_counts),
                "source_ok": {k: list(v) for k, v in source_ok.items()},
                "char_acc": (char_hits / char_total) if char_total else None,
                "char_hits": char_hits,
                "char_total": char_total,
                "det_tp": det_tp,
                "det_fp": det_fp,
                "det_fn": det_fn,
                "length_exact_rate": (length_exact / length_total) if length_total else None,
                "crop_cut_n": crop_cut_n,
                "ocr_partial_n": ocr_partial_n,
                "oracle_top1": (top1_hits / top1_n) if top1_n else None,
                "oracle_top2": (top2_hits / top2_n) if top2_n else None,
                "oracle_top3": (top3_hits / top3_n) if top3_n else None,
                "oracle_str_top2": (oracle_str_top2 / n) if n else None,
                "oracle_str_top3": (oracle_str_top3 / n) if n else None,
                "avg_entropy": (sum_entropy / cand_pos_n) if cand_pos_n else None,
                "avg_margin": (sum_margin / cand_pos_n) if cand_pos_n else None,
                "avg_set_size": (sum_set_size / cand_pos_n) if cand_pos_n else None,
                "avg_top1_score": (sum_top1 / cand_pos_n) if cand_pos_n else None,
                "low_margin_rate": (low_margin_n / cand_pos_n) if cand_pos_n else None,
                "min_margin": os.environ.get("HERMES_CAPTCHA_CHAR_MIN_MARGIN"),
                "min_agree": os.environ.get("HERMES_CAPTCHA_CHAR_MIN_AGREE"),
                "gt_matrix": dict(arm_gt_matrix),
                "wrong_pass": arm_wrong_pass,
                "true_rescue": arm_true_rescue,
                "break_correct": arm_break_correct,
                "c5_trig_n": c5_trig_n,
                "c5_trig_samples": c5_trig_samples,
                "c5_trig_dangerous": c5_trig_dangerous,
                "c5_trig_by_type": {k: list(v) for k, v in c5_trig_by_type.items()},
                "c5_blocked_fp": c5_blocked_fp,
                "c5_remaining_fp": c5_remaining_fp,
                "l1_trig_n": l1_trig_n,
                "l1_trig_samples": l1_trig_samples,
                "l1_trig_dangerous": l1_trig_dangerous,
                "l1_fp_hits": l1_fp_hits,
                "l1_sim_blocked_fp": l1_sim_blocked_fp,
                "l1_sim_break": l1_sim_break,
                "l1_sim_retry_add": l1_sim_retry_add,
            }
        finally:
            _restore_env(prev)

    # ---- report ----
    title = (
        "# Captcha char pipeline C0–C4 (P3)"
        if any(a in char_arms for a in arms)
        else "# Captcha visual A/B (P2.4)"
    )
    lines = [
        title,
        "",
        f"dataset={data_dir} n={len(items)} fusion=shadow (not live)",
        "",
        "## Summary",
        "",
        "| 实验 | 整串Top-1 | char Top-1 | oracle@2 | oracle@3 | 耗时 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for arm in arms:
        s = stats[arm]
        char_s = (
            f"{s['char_acc']*100:.1f}%"
            if s.get("char_acc") is not None
            else "-"
        )
        o2 = (
            f"{s['oracle_top2']*100:.1f}%"
            if s.get("oracle_top2") is not None
            else "-"
        )
        o3 = (
            f"{s['oracle_top3']*100:.1f}%"
            if s.get("oracle_top3") is not None
            else "-"
        )
        note = f" (yolo_skipped={s['skipped']})" if s.get("skipped") else ""
        lines.append(
            f"| {labels.get(arm, arm)}{note} | {s['acc']*100:.1f}% | {char_s} | {o2} | {o3} | "
            f"{s['avg_ms']:.0f}ms |"
        )

    # Length delta A vs C
    if "A" in stats and "C" in stats:
        lines += ["", "## Length: A vs C", "", "| length | A | C | C−A |", "| --- | ---: | ---: | ---: |"]
        for L in ("4", "5", "6"):
            a_ok, a_tot = stats["A"]["by_len"].get(L, [0, 0])
            c_ok, c_tot = stats["C"]["by_len"].get(L, [0, 0])
            a_pct = (a_ok / a_tot * 100) if a_tot else None
            c_pct = (c_ok / c_tot * 100) if c_tot else None
            if a_pct is None and c_pct is None:
                continue
            delta = (
                f"{(c_pct or 0) - (a_pct or 0):+.1f}pp"
                if a_pct is not None and c_pct is not None
                else "-"
            )
            lines.append(
                f"| {L} | {a_pct:.1f}% ({a_ok}/{a_tot}) | {c_pct:.1f}% ({c_ok}/{c_tot}) | {delta} |"
                if a_pct is not None and c_pct is not None
                else f"| {L} | - | - | - |"
            )

    for arm in arms:
        if arm not in ("C", "C0", "C1", "C2", "C3", "C3-2", "C3-3"):
            continue
        s = stats[arm]
        lines += ["", f"## {arm} metrics", ""]
        det_tp, det_fp, det_fn = s["det_tp"], s["det_fp"], s["det_fn"]
        recall = det_tp / (det_tp + det_fn) if (det_tp + det_fn) else None
        prec = det_tp / (det_tp + det_fp) if (det_tp + det_fp) else None
        lines.append("| 指标 | value |")
        lines.append("| --- | ---: |")
        if recall is not None:
            lines.append(f"| bbox detection recall | {recall*100:.1f}% ({det_tp}/{det_tp+det_fn}) |")
        if prec is not None:
            lines.append(f"| bbox detection precision | {prec*100:.1f}% ({det_tp}/{det_tp+det_fp}) |")
        if s.get("length_exact_rate") is not None:
            lines.append(f"| bbox数量准确率 (n==len) | {s['length_exact_rate']*100:.1f}% |")
        if s.get("char_acc") is not None:
            lines.append(
                f"| character Top-1 accuracy | {s['char_acc']*100:.1f}% ({s['char_hits']}/{s['char_total']}) |"
            )
        if s.get("oracle_top1") is not None:
            lines.append(f"| oracle char Top-1 | {s['oracle_top1']*100:.1f}% |")
            lines.append(f"| oracle char Top-2 recall | {s['oracle_top2']*100:.1f}% |")
            lines.append(f"| oracle char Top-3 recall | {s['oracle_top3']*100:.1f}% |")
            lines.append(f"| oracle whole-string Top-2 | {s['oracle_str_top2']*100:.1f}% |")
            lines.append(f"| oracle whole-string Top-3 | {s['oracle_str_top3']*100:.1f}% |")
            lines.append(f"| avg candidate_set_size | {s['avg_set_size']:.2f} |")
            lines.append(f"| avg top1_score | {s['avg_top1_score']:.3f} |")
            lines.append(f"| avg top1−top2 margin | {s['avg_margin']:.3f} |")
            lines.append(f"| avg candidate_entropy | {s['avg_entropy']:.3f} |")
            lines.append(f"| low_margin_rate (<0.15) | {s['low_margin_rate']*100:.1f}% |")
        lines.append(f"| 整串 Top-1 (provisional) | {s['acc']*100:.1f}% |")
        lines.append(f"| crop_cut failures | {s.get('crop_cut_n', 0)} |")
        lines.append(f"| ocr_partial_wrong | {s.get('ocr_partial_n', 0)} |")
        lines.append(f"| 平均耗时 | {s['avg_ms']:.0f}ms |")

    # C0 ↔ C2 position-level rescue
    if "C0" in arm_preds and "C2" in arm_preds:
        rescue_pos = 0
        regress_pos = 0
        both_wrong_pos = 0
        both_ok_pos = 0
        compared_pos = 0
        string_rescue = 0
        string_regress = 0
        rescue_examples: list[dict] = []
        ids = set(arm_preds["C0"]) & set(arm_preds["C2"])
        for sid in ids:
            a0 = arm_preds["C0"][sid]
            a2 = arm_preds["C2"][sid]
            gt = str(a0["answer"] or "").upper()
            p0 = str(a0["pred"] or "").upper()
            p2 = str(a2["pred"] or "").upper()
            if a0["ok"] and not a2["ok"]:
                string_regress += 1
            if (not a0["ok"]) and a2["ok"]:
                string_rescue += 1
            n = max(len(gt), len(p0), len(p2))
            for i in range(n):
                g = gt[i] if i < len(gt) else ""
                c0 = p0[i] if i < len(p0) else ""
                c2 = p2[i] if i < len(p2) else ""
                if not g:
                    continue
                compared_pos += 1
                ok0 = c0 == g
                ok2 = c2 == g
                if ok0 and ok2:
                    both_ok_pos += 1
                elif (not ok0) and ok2:
                    rescue_pos += 1
                    if len(rescue_examples) < 25:
                        rescue_examples.append(
                            {
                                "id": sid,
                                "position": i,
                                "gt": g,
                                "c0": c0 or "∅",
                                "c2": c2 or "∅",
                                "gt_full": gt,
                                "c0_full": p0,
                                "c2_full": p2,
                            }
                        )
                elif ok0 and (not ok2):
                    regress_pos += 1
                else:
                    both_wrong_pos += 1

        lines += [
            "",
            "## C0 → C2 position rescue (partial OCR)",
            "",
            "| metric | count |",
            "| --- | ---: |",
            f"| positions compared | {compared_pos} |",
            f"| C0❌ → C2✓ (rescue) | {rescue_pos} |",
            f"| C0✓ → C2❌ (regress) | {regress_pos} |",
            f"| both wrong | {both_wrong_pos} |",
            f"| both ok | {both_ok_pos} |",
            f"| net position Δ (rescue−regress) | {rescue_pos - regress_pos:+d} |",
            f"| string C0❌→C2✓ | {string_rescue} |",
            f"| string C0✓→C2❌ | {string_regress} |",
            "",
            "### Rescue examples (up to 25)",
            "",
            "| id | pos | GT | C0 | C2 | C0 full | C2 full |",
            "| --- | ---: | --- | --- | --- | --- | --- |",
        ]
        for ex in rescue_examples:
            lines.append(
                f"| {ex['id']} | {ex['position']} | {ex['gt']} | {ex['c0']} | {ex['c2']} | "
                f"`{ex['c0_full']}` | `{ex['c2_full']}` |"
            )
        if not rescue_examples:
            lines.append("| (none) | - | - | - | - | - | - |")

        _rescue_examples_pending = rescue_examples
    else:
        _rescue_examples_pending = []

    if c_fail_counts:
        lines += ["", "## Failure taxonomy (wrong full-string)", ""]
        lines.append("| reason | count | share of failures |")
        lines.append("| --- | ---: | ---: |")
        fail_n = sum(c_fail_counts.values()) or 1
        for reason, cnt in sorted(c_fail_counts.items(), key=lambda kv: -kv[1]):
            lines.append(f"| {reason} | {cnt} | {cnt/fail_n*100:.1f}% |")

    e = stats.get("E") or {}
    if e.get("delta_counts"):
        lines += ["", "## Shadow delta (arm E)", "", "| delta | count |", "| --- | ---: |"]
        for k, v in sorted(e["delta_counts"].items()):
            lines.append(f"| {k} | {v} |")

    if any(a in stats for a in ("C4", "C5", "C5O")):
        for arm_name in [a for a in ("C4", "C5", "C5O") if a in stats]:
            c4s = stats[arm_name]
            n4 = c4s.get("n") or 1
            gm = c4s.get("gt_matrix") or {}
            tag = arm_name
            lines += [
                "",
                f"## {arm_name} shadow recovery matrix (vs GT)",
                "",
                f"|  | {tag} PASS | {tag} RETRY |",
                "| --- | ---: | ---: |",
                f"| C0 正确 | {gm.get(f'C0_OK_{tag}_PASS', 0)} | {gm.get(f'C0_OK_{tag}_RETRY', 0)} |",
                f"| C0 错误 | {gm.get(f'C0_BAD_{tag}_PASS', 0)} | {gm.get(f'C0_BAD_{tag}_RETRY', 0)} |",
                "",
                "| metric | value |",
                "| --- | ---: |",
                f"| PASS rate | {c4s.get('shadow_pass_n', 0)/n4*100:.1f}% ({c4s.get('shadow_pass_n', 0)}/{n4}) |",
                f"| PASS precision | {(c4s['correct']/c4s['shadow_pass_n']*100) if c4s.get('shadow_pass_n') else 0:.1f}% |",
                f"| whole-string (PASS=submit) | {c4s['acc']*100:.1f}% |",
                f"| true rescue | {c4s.get('true_rescue', 0)} |",
                f"| break correct | {c4s.get('break_correct', 0)} |",
                f"| PASS but GT wrong (FP) | {c4s.get('wrong_pass', 0)} |",
                f"| retry rate | {c4s['abstain_rate']*100:.1f}% |",
                f"| avg latency | {c4s['avg_ms']:.0f}ms |",
                f"| minMargin / minAgree | {c4s.get('min_margin') or '?'} / {c4s.get('min_agree') or '?'} |",
            ]
            if arm_name in ("C5", "C5O"):
                trig_n = c4s.get("c5_trig_n") or 0
                dang = c4s.get("c5_trig_dangerous") or 0
                lines += [
                    f"| C5 trigger samples | {c4s.get('c5_trig_samples', 0)}/{n4} "
                    f"({(c4s.get('c5_trig_samples') or 0)/n4*100:.1f}%) |",
                    f"| C5 trigger events | {trig_n} |",
                    f"| C5 trigger precision (dangerous/trigger) | "
                    f"{(dang/trig_n*100) if trig_n else 0:.1f}% ({dang}/{trig_n}) |",
                    f"| C5 blocked FP (C4 would FP → C5 RETRY) | {c4s.get('c5_blocked_fp', 0)} |",
                    f"| C5 remaining FP | {c4s.get('c5_remaining_fp', 0)} |",
                    "",
                    "### C5 trigger by riskType (trigger → dangerous)",
                    "",
                    "| riskType | triggers | dangerous | precision |",
                    "| --- | ---: | ---: | ---: |",
                ]
                for rtype, (tn, dn) in sorted(
                    (c4s.get("c5_trig_by_type") or {}).items(),
                    key=lambda kv: -kv[1][0],
                ):
                    prec = (dn / tn * 100) if tn else 0
                    lines.append(f"| {rtype} | {tn} | {dn} | {prec:.1f}% |")

            if arm_name == "C5O":
                l1n = c4s.get("l1_trig_n") or 0
                l1d = c4s.get("l1_trig_dangerous") or 0
                rem_fp = c4s.get("c5_remaining_fp") or 0
                fp_hits = c4s.get("l1_fp_hits") or 0
                lines += [
                    "",
                    "## C5-R″-O L1 observe (shadow only)",
                    "",
                    "| metric | value |",
                    "| --- | ---: |",
                    f"| L1 trigger samples | {c4s.get('l1_trig_samples', 0)}/{n4} "
                    f"({(c4s.get('l1_trig_samples') or 0)/n4*100:.1f}%) |",
                    f"| L1 trigger events | {l1n} |",
                    f"| L1 precision (dangerous/L1) | "
                    f"{(l1d/l1n*100) if l1n else 0:.1f}% ({l1d}/{l1n}) |",
                    f"| L1 FP coverage (remaining FP hit) | "
                    f"{(fp_hits/rem_fp*100) if rem_fp else 0:.1f}% ({fp_hits}/{rem_fp}) |",
                    "",
                    "### Shadow simulate: if L1 → RETRY (whole string)",
                    "",
                    "| metric | C5-R′ shadow | sim L1→RETRY | Δ |",
                    "| --- | ---: | ---: | ---: |",
                    f"| FP | {rem_fp} | {rem_fp - (c4s.get('l1_sim_blocked_fp') or 0)} | "
                    f"-{(c4s.get('l1_sim_blocked_fp') or 0)} |",
                    f"| retry add (samples) | - | {c4s.get('l1_sim_retry_add', 0)} | - |",
                    f"| break correct | {c4s.get('break_correct', 0)} | "
                    f"{(c4s.get('break_correct', 0) or 0) + (c4s.get('l1_sim_break') or 0)} | "
                    f"+{(c4s.get('l1_sim_break') or 0)} |",
                    "",
                    f"Frozen C5-R′ reference: FP≈23, retry≈44%, KNOWN_CONFUSION precision=100%.",
                ]

        if "C4" in stats and "C5" in stats:
            lines += [
                "",
                "## C4 → C5-R FP delta",
                "",
                "| metric | C4 | C5-R | Δ |",
                "| --- | ---: | ---: | ---: |",
                f"| FP | {stats['C4'].get('wrong_pass', 0)} | {stats['C5'].get('wrong_pass', 0)} | "
                f"{stats['C5'].get('wrong_pass', 0) - stats['C4'].get('wrong_pass', 0):+d} |",
                f"| blocked FP | - | {stats['C5'].get('c5_blocked_fp', 0)} | - |",
                f"| true rescue | {stats['C4'].get('true_rescue', 0)} | {stats['C5'].get('true_rescue', 0)} | "
                f"{stats['C5'].get('true_rescue', 0) - stats['C4'].get('true_rescue', 0):+d} |",
                f"| break correct | {stats['C4'].get('break_correct', 0)} | {stats['C5'].get('break_correct', 0)} | "
                f"{stats['C5'].get('break_correct', 0) - stats['C4'].get('break_correct', 0):+d} |",
                f"| PASS rate | {stats['C4'].get('shadow_pass_n', 0)/max(1,stats['C4'].get('n',1))*100:.1f}% | "
                f"{stats['C5'].get('shadow_pass_n', 0)/max(1,stats['C5'].get('n',1))*100:.1f}% | - |",
                f"| retry | {stats['C4'].get('abstain_rate', 0)*100:.1f}% | "
                f"{stats['C5'].get('abstain_rate', 0)*100:.1f}% | - |",
            ]

        # Keep legacy FP reason / confusion sections when any C4/C5 FP rows exist
        if c4_fp_pos_n:
            lines += [
                "",
                "### FP position reasons (shadow PASS ∧ glyph≠GT)",
                "",
                f"wrong glyphs attributed: {c4_fp_pos_n}",
                "",
                "| reason | count | share |",
                "| --- | ---: | ---: |",
            ]
            fp_den = c4_fp_pos_n or 1
            for k, v in sorted(c4_fp_pos_reasons.items(), key=lambda kv: -kv[1]):
                lines.append(f"| {k} | {v} | {v/fp_den*100:.1f}% |")
            lines += [
                "",
                "### Confusion matrix (FP glyphs: GT → OCR)",
                "",
                "| GT → OCR | all FP | HIGH_CONF only |",
                "| --- | ---: | ---: |",
            ]
            all_pairs = sorted(
                set(c4_fp_confuse) | set(c4_fp_confuse_high_conf),
                key=lambda p: (-(c4_fp_confuse.get(p, 0)), p),
            )
            for pair in all_pairs:
                lines.append(
                    f"| `{pair}` | {c4_fp_confuse.get(pair, 0)} | "
                    f"{c4_fp_confuse_high_conf.get(pair, 0)} |"
                )

    lines += [
        "",
        "Notes: **C3 actual=C0 (shadow only)** — does not change submit. "
        "**FUSION stays shadow**; **C4 never live-applies**. "
        "Prefer RETRY over forced PASS. Oracle = GT ∈ Top-K candidates.",
    ]

    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = ROOT / "reports" / f"captcha_visual_ab_{stamp}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    fail_path = ROOT / "reports" / f"captcha_visual_c_failures_{stamp}.jsonl"
    with fail_path.open("w", encoding="utf-8") as f:
        for row in c_failures:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("\n".join(lines))
    print(f"\nwrote {out_path}")
    if c_failures:
        print(f"wrote {fail_path} ({len(c_failures)} failures)")
    if _rescue_examples_pending:
        rescue_path = ROOT / "reports" / f"captcha_c0_c2_rescue_{stamp}.jsonl"
        with rescue_path.open("w", encoding="utf-8") as f:
            for row in _rescue_examples_pending:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"wrote {rescue_path} ({len(_rescue_examples_pending)} rescue examples)")
    if c4_fp_confuse_rows:
        conf_path = ROOT / "reports" / f"captcha_c4_fp_confusion_{stamp}.jsonl"
        with conf_path.open("w", encoding="utf-8") as f:
            for row in c4_fp_confuse_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"wrote {conf_path} ({len(c4_fp_confuse_rows)} FP glyph pairs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
