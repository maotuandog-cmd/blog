#!/usr/bin/env python3
"""E1-D.1 Agree Bonus Stability Validation — offline ranking only.

Compares evidenceScoreRaw vs evidenceScoreAdjusted on ACCEPT pool.
Does not change Decision / threshold / retry.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _auc(true_s: list[float], fa_s: list[float]) -> float | None:
    wins = ties = total = 0
    for t in true_s:
        for f in fa_s:
            total += 1
            if t > f:
                wins += 1
            elif t == f:
                ties += 1
    if not total:
        return None
    return round((wins + 0.5 * ties) / total, 4)


def _average_precision(labels: list[int], scores: list[float]) -> float | None:
    """PR-AUC (AP) with positive label=1 (true ACCEPT)."""
    if not labels or sum(labels) == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    tp = fp = 0
    precisions: list[float] = []
    n_pos = sum(labels)
    for i in order:
        if labels[i] == 1:
            tp += 1
            precisions.append(tp / (tp + fp))
        else:
            fp += 1
    if not precisions:
        return None
    return round(sum(precisions) / n_pos, 4)


def _sep(true_s: list[float], fa_s: list[float]) -> dict[str, Any]:
    def mean(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 4) if xs else None

    labels = [1] * len(true_s) + [0] * len(fa_s)
    scores = true_s + fa_s
    return {
        "trueMean": mean(true_s),
        "faMean": mean(fa_s),
        "gap": round(mean(true_s) - mean(fa_s), 4) if true_s and fa_s else None,
        "auc": _auc(true_s, fa_s),
        "prAuc": _average_precision(labels, scores) if scores else None,
        "nTrue": len(true_s),
        "nFa": len(fa_s),
    }


def _topk(rows: list[dict], score_key: str) -> dict[str, Any]:
    scored = [(r[score_key], r["label"]) for r in rows if r.get(score_key) is not None]
    if not scored:
        return {}
    ranked = sorted(scored, key=lambda x: x[0], reverse=True)
    k = len(ranked)
    out: dict[str, Any] = {"k": k}
    for frac in (0.5, 0.75, 1.0):
        n = max(1, int(round(k * frac)))
        chunk = ranked[:n]
        true_n = sum(1 for _, lab in chunk if lab == 1)
        fa_n = n - true_n
        out[f"top{int(frac * 100)}pct"] = {
            "n": n,
            "true": true_n,
            "fa": fa_n,
            "precision": round(true_n / n, 4),
            "falseAcceptRate": round(fa_n / n, 4),
        }
    return out


def analyze(paths: list[Path]) -> dict[str, Any]:
    results: list[dict] = []
    meta = []
    for p in paths:
        d = json.loads(p.read_text(encoding="utf-8"))
        meta.append({"path": str(p), "label": d.get("label"), "rounds": d.get("rounds")})
        results.extend(d.get("results") or [])

    rows = []
    for r in results:
        if r.get("firstDecision") not in ("correct", "wrong"):
            continue
        raw = _f(r.get("firstEvidenceScoreRaw") or r.get("evidenceScoreRaw"))
        adj = _f(r.get("firstEvidenceScoreAdjusted") or r.get("evidenceScoreAdjusted"))
        # Fallback: reconstruct from decisionScore + agree flag (offline benches)
        score = _f(r.get("firstEvidenceScore") or r.get("evidenceScore") or r.get("decisionScore") or r.get("confidence"))
        agree = r.get("firstIndependentAgree")
        if agree is None:
            agree = r.get("independentAgree")
        agr = r.get("firstSourceAgreement") or r.get("sourceAgreement") or {}
        if agree is None and isinstance(agr, dict):
            agree = bool(agr.get("agree") and agr.get("comparable"))
        agree = bool(agree)
        adj_meta = r.get("firstEvidenceAdjustment") or r.get("evidenceAdjustment") or {}
        applied = bool(adj_meta.get("applied")) if isinstance(adj_meta, dict) else False
        bonus = 0.1
        if isinstance(adj_meta, dict) and adj_meta.get("bonus") is not None:
            try:
                bonus = float(adj_meta["bonus"])
            except (TypeError, ValueError):
                bonus = 0.1
        if raw is None and score is not None:
            # If online applied bonus into evidenceScore, prefer raw field; else score is raw
            if applied and adj is not None:
                raw = round(adj - bonus, 4)
            elif agree and adj is None:
                # offline reconstruct: score was baseline without bonus applied in old benches
                raw = score
                adj = min(1.0, score + bonus)
            else:
                raw = score
                adj = min(1.0, score + bonus) if agree else score
        if adj is None and raw is not None:
            adj = min(1.0, raw + bonus) if agree else raw
        if raw is None:
            continue
        rows.append(
            {
                "label": 1 if r.get("firstDecision") == "correct" else 0,
                "decision": r.get("firstDecision"),
                "text": r.get("firstTryText") or r.get("text"),
                "raw": raw,
                "adj": adj,
                "agree": agree,
                "applied": applied,
                "secondary": r.get("firstSecondaryText") or r.get("secondaryText"),
            }
        )

    true_raw = [x["raw"] for x in rows if x["label"] == 1]
    fa_raw = [x["raw"] for x in rows if x["label"] == 0]
    true_adj = [x["adj"] for x in rows if x["label"] == 1]
    fa_adj = [x["adj"] for x in rows if x["label"] == 0]

    n_true = sum(1 for x in rows if x["label"] == 1)
    n_fa = sum(1 for x in rows if x["label"] == 0)
    agree_true = sum(1 for x in rows if x["label"] == 1 and x["agree"])
    agree_fa = sum(1 for x in rows if x["label"] == 0 and x["agree"])
    agree_n = agree_true + agree_fa

    sep_raw = _sep(true_raw, fa_raw)
    sep_adj = _sep(true_adj, fa_adj)
    top_raw = _topk(rows, "raw")
    top_adj = _topk(rows, "adj")

    # Situation A/B
    cov = round(agree_n / len(rows), 4) if rows else None
    fa_agree_ok = agree_fa == 0
    gap_up = (sep_adj.get("gap") or -9) > (sep_raw.get("gap") or -9)
    auc_up = (sep_adj.get("auc") or 0) >= (sep_raw.get("auc") or 0)
    # Coverage "increased" vs prior E1-D pool (~6/35≈0.17): treat ≥0.20 as meaningful, or absolute agree_n≥10
    cov_ok = (cov is not None and cov >= 0.20) or agree_n >= 10
    prec50_raw = (top_raw.get("top50pct") or {}).get("precision")
    prec50_adj = (top_adj.get("top50pct") or {}).get("precision")
    prec_up = (
        prec50_adj is not None
        and prec50_raw is not None
        and prec50_adj > prec50_raw
    )

    if fa_agree_ok and gap_up and cov_ok and (prec_up or auc_up):
        verdict = "A"
        verdict_note = (
            "agree coverage + FA≈0 + separation/precision improved → candidate for Decision Calibration discussion"
        )
    elif fa_agree_ok and (cov is not None and cov < 0.20) and agree_n < 10:
        verdict = "B"
        verdict_note = (
            "FA∩agree=0 but coverage still low → keep optional evidence boost; do NOT enter Decision Calibration"
        )
    elif not fa_agree_ok:
        verdict = "unsafe"
        verdict_note = "FA∩agree > 0 — freeze bonus expansion; investigate"
    else:
        verdict = "B-leaning"
        verdict_note = (
            "Safety holds and some separation gain, but coverage/precision not yet enough for Calibration"
        )

    return {
        "sources": meta,
        "rounds": len(results),
        "nAccepts": len(rows),
        "nTrue": n_true,
        "nFa": n_fa,
        "agreeCoverage": cov,
        "agreeCount": agree_n,
        "agreeTrue": agree_true,
        "agreeFa": agree_fa,
        "faIntersectAgree": agree_fa,
        "raw": sep_raw,
        "adjusted": sep_adj,
        "topkRaw": top_raw,
        "topkAdjusted": top_adj,
        "deltaGap": round((sep_adj.get("gap") or 0) - (sep_raw.get("gap") or 0), 4),
        "deltaAuc": round((sep_adj.get("auc") or 0) - (sep_raw.get("auc") or 0), 4),
        "deltaPrAuc": round((sep_adj.get("prAuc") or 0) - (sep_raw.get("prAuc") or 0), 4)
        if sep_adj.get("prAuc") is not None and sep_raw.get("prAuc") is not None
        else None,
        "verdict": verdict,
        "verdictNote": verdict_note,
        "frozen": {
            "bonusValueUnchanged": True,
            "conflictPenalty": False,
            "thresholdChanged": False,
            "decisionCalibration": False,
        },
        "agreeRows": [
            {
                "decision": x["decision"],
                "text": x["text"],
                "raw": x["raw"],
                "adj": x["adj"],
                "secondary": x["secondary"],
            }
            for x in rows
            if x["agree"]
        ],
    }


def render(report: dict) -> str:
    src_labels = ", ".join(f"`{s.get('label')}`" for s in report["sources"])
    lines = [
        "# E1-D.1：Agree Bonus Stability Validation",
        "",
        "**范围**：只比较 `evidenceScoreRaw` vs `evidenceScoreAdjusted`；不改 threshold / retry / VLM / bonus 幅度。",
        "",
        f"- sources: {src_labels}",
        f"- rounds={report['rounds']} ACCEPT={report['nAccepts']} "
        f"(true={report['nTrue']}, FA={report['nFa']})",
        f"- agree coverage={report['agreeCoverage']} ({report['agreeCount']}/{report['nAccepts']})",
        f"- FA∩agree=**{report['faIntersectAgree']}**",
        "",
        "## Separation",
        "",
        "| | trueMean | faMean | gap | AUC | PR-AUC |",
        "|-|---------|-------:|----:|----:|-------:|",
        f"| raw | {report['raw'].get('trueMean')} | {report['raw'].get('faMean')} | "
        f"{report['raw'].get('gap')} | {report['raw'].get('auc')} | {report['raw'].get('prAuc')} |",
        f"| adjusted | {report['adjusted'].get('trueMean')} | {report['adjusted'].get('faMean')} | "
        f"{report['adjusted'].get('gap')} | {report['adjusted'].get('auc')} | "
        f"{report['adjusted'].get('prAuc')} |",
        f"| Δ |  |  | {report.get('deltaGap')} | {report.get('deltaAuc')} | {report.get('deltaPrAuc')} |",
        "",
        "## Top-k precision",
        "",
        "| | top50 precision | top50 FAR | top75 precision |",
        "|-|----------------:|----------:|----------------:|",
        f"| raw | {(report['topkRaw'].get('top50pct') or {}).get('precision')} | "
        f"{(report['topkRaw'].get('top50pct') or {}).get('falseAcceptRate')} | "
        f"{(report['topkRaw'].get('top75pct') or {}).get('precision')} |",
        f"| adjusted | {(report['topkAdjusted'].get('top50pct') or {}).get('precision')} | "
        f"{(report['topkAdjusted'].get('top50pct') or {}).get('falseAcceptRate')} | "
        f"{(report['topkAdjusted'].get('top75pct') or {}).get('precision')} |",
        "",
        "## Agree samples",
        "",
        "| outcome | text | raw | adj | secondary |",
        "|---------|------|----:|----:|-----------|",
    ]
    for s in report.get("agreeRows") or []:
        lines.append(
            f"| {s['decision']} | `{s.get('text')}` | {s['raw']} | {s['adj']} | `{s.get('secondary')}` |"
        )
    if not report.get("agreeRows"):
        lines.append("| — | — | — | — | — |")

    lines += [
        "",
        "## 裁决",
        "",
        f"**情况 {report['verdict']}** — {report['verdictNote']}",
        "",
        "### 判据回顾",
        "",
        "| 情况 | 条件 | 下一步 |",
        "|------|------|--------|",
        "| A | 覆盖↑ + FA≈0 + precision/分离↑ | 可讨论 Decision Calibration |",
        "| B | FA低但覆盖极低 | 保持 optional boost；不进 Calibration |",
        "",
        "继续冻结：不调 bonus 值 / 不加 conflict 惩罚 / 不改 threshold / 不扩 VLM / 不改 retry。",
        "",
        f"```json\n{json.dumps(report['frozen'], indent=2)}\n```",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) > 1:
        paths = [Path(p) for p in sys.argv[1:]]
    else:
        # prefer newest E1-D.1 bench if present
        cands = sorted((ROOT / "reports").glob("captcha_ocr_bench_*.json"), key=lambda p: p.stat().st_mtime)
        paths = []
        for p in reversed(cands):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if d.get("label") == "E1-D1-agree-stability":
                paths = [p]
                break
        if not paths:
            # fallback: merge prior C2-B + any E1-D benches
            defaults = [
                ROOT / "reports" / "captcha_ocr_bench_20260815T111025Z.json",
                ROOT / "reports" / "captcha_ocr_bench_20260815T110823Z.json",
            ]
            paths = [p for p in defaults if p.exists()]
    if not paths:
        print("Usage: e1d1_stability_report.py reports/*.json", file=sys.stderr)
        return 2

    report = analyze(paths)
    out_j = ROOT / "reports" / "e1d1_stability.json"
    out_m = ROOT / "reports" / "e1d1_stability.md"
    out_j.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    out_m.write_text(render(report), encoding="utf-8")
    print(json.dumps({k: report[k] for k in report if k != "agreeRows"}, ensure_ascii=False, indent=2))
    print(f"wrote {out_m}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
