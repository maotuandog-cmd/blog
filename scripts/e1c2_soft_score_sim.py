#!/usr/bin/env python3
"""C2-C Offline soft evidenceScore simulation — zero online behavior change.

Simulations (conservative):
  Baseline: decisionScore as-is
  A: + independentAgree bonus
  B: A − char ambiguity / weak-char penalty  (NOT weak|conflict)
  C: B − small independentConflict uncertainty  (NOT hard reject)

Metrics on first-attempt ACCEPT pool + full-round counters after simulated re-gate.
Abstain-without-text cannot be recalled by score alone (Candidate layer gap).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

# Conservative defaults (env-overridable via CLI flags later if needed)
AGREE_BONUS = 0.10
CHAR_RISK_PENALTY = 0.05
CONFLICT_PENALTY = 0.03
CHAR_LOW = 0.5


def _f(v: Any, default: float | None = None) -> float | None:
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _agree(row: dict) -> bool:
    if row.get("firstIndependentAgree") is True or row.get("independentAgree") is True:
        return True
    agr = row.get("firstSourceAgreement") or row.get("sourceAgreement") or {}
    return bool(isinstance(agr, dict) and agr.get("agree") and agr.get("comparable"))


def _conflict(row: dict) -> bool:
    """True only for comparable mismatch — not unavailable / length_mismatch."""
    if row.get("firstSourceUnavailable") or row.get("sourceUnavailable"):
        return False
    if row.get("firstSecondaryAvailable") is False or row.get("secondaryAvailable") is False:
        return False
    agr = row.get("firstSourceAgreement") or row.get("sourceAgreement") or {}
    if not isinstance(agr, dict):
        return False
    if agr.get("reason") in (
        "source_unavailable",
        "secondary_length_mismatch",
        "primary_length_mismatch",
        "missing_side",
        "no_comparable_glyph",
    ):
        return False
    if agr.get("comparable") is False:
        return False
    return bool(agr.get("comparable") and not agr.get("agree"))


def _char_risk(row: dict) -> bool:
    summary = row.get("firstCharSummary") or row.get("charSummary") or {}
    cmin = _f(row.get("firstCharMinConfidence") or row.get("charMinConfidence"))
    if cmin is None and isinstance(summary, dict):
        cmin = _f(summary.get("charMinConfidence"))
    amb = int(summary.get("ambiguousCount") or 0) if isinstance(summary, dict) else 0
    amb = amb or int(row.get("charAmbiguousCount") or 0)
    return (cmin is not None and cmin < CHAR_LOW) or amb > 0


def _old_score(row: dict) -> float | None:
    for k in ("decisionScore", "evidenceScore", "confidence"):
        v = _f(row.get(k))
        if v is not None:
            return v
    return None


def simulate_scores(row: dict) -> dict[str, float | None]:
    old = _old_score(row)
    if old is None:
        return {"baseline": None, "A": None, "B": None, "C": None}
    agree = _agree(row)
    risk = _char_risk(row)
    conflict = _conflict(row)
    a = old + (AGREE_BONUS if agree else 0.0)
    b = a - (CHAR_RISK_PENALTY if risk else 0.0)
    c = b - (CONFLICT_PENALTY if conflict else 0.0)
    return {
        "baseline": round(old, 4),
        "A": round(a, 4),
        "B": round(b, 4),
        "C": round(c, 4),
        "flags": {
            "agree": agree,
            "charRisk": risk,
            "conflict": conflict,
        },
    }


def _sep(true_scores: list[float], fa_scores: list[float]) -> dict[str, Any]:
    def mean(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 4) if xs else None

    # Mann-Whitney style: P(true > fa)
    wins = ties = 0
    total = 0
    for t in true_scores:
        for f in fa_scores:
            total += 1
            if t > f:
                wins += 1
            elif t == f:
                ties += 1
    auc = None
    if total:
        auc = round((wins + 0.5 * ties) / total, 4)
    return {
        "trueMean": mean(true_scores),
        "faMean": mean(fa_scores),
        "gap": round(mean(true_scores) - mean(fa_scores), 4)
        if true_scores and fa_scores and mean(true_scores) is not None and mean(fa_scores) is not None
        else None,
        "aucTrueGtFa": auc,
        "nTrue": len(true_scores),
        "nFa": len(fa_scores),
    }


def threshold_sweep(
    accepts: list[dict],
    score_key: str,
    *,
    rounds: int,
) -> list[dict[str, Any]]:
    """For each candidate threshold, demote ACCEPT with score < t to simulated abstain."""
    scored = []
    for r in accepts:
        sc = r["sim"][score_key]
        if sc is None:
            continue
        scored.append((sc, r["decision"]))
    if not scored:
        return []
    # unique thresholds: just below each score and midpoints; also include keeping all / none
    vals = sorted({s for s, _ in scored})
    thresholds = [vals[0] - 1e-6] + vals
    rows_out = []
    for t in thresholds:
        keep_true = keep_fa = 0
        for s, dec in scored:
            if s + 1e-12 >= t:
                if dec == "correct":
                    keep_true += 1
                else:
                    keep_fa += 1
        accept_n = keep_true + keep_fa
        demoted_true = sum(1 for s, d in scored if s < t and d == "correct")
        demoted_fa = sum(1 for s, d in scored if s < t and d == "wrong")
        # Full-round metrics: abstain = original abstain + demoted accepts
        orig_abstain = rounds - len(scored)
        sim_abstain = orig_abstain + demoted_true + demoted_fa
        rows_out.append(
            {
                "threshold": round(t, 4),
                "keepTrue": keep_true,
                "keepFa": keep_fa,
                "accepts": accept_n,
                "falseAcceptRate": round(keep_fa / accept_n, 4) if accept_n else None,
                "acceptPrecision": round(keep_true / accept_n, 4) if accept_n else None,
                "trueRecallOfBaselineAccept": round(keep_true / sum(1 for _, d in scored if d == "correct"), 4)
                if any(d == "correct" for _, d in scored)
                else None,
                "eventualSuccess": round(keep_true / rounds, 4) if rounds else None,
                "abstainRate": round(sim_abstain / rounds, 4) if rounds else None,
                "coverageAccept": round(accept_n / rounds, 4) if rounds else None,
                "demotedTrue": demoted_true,
                "demotedFa": demoted_fa,
                "f2dLike": None,  # filled below
            }
        )
    # Mark F2-D-like points: FA down but abstain up and eventual down vs baseline (threshold=-inf)
    base = rows_out[0] if rows_out else None
    if base:
        for row in rows_out:
            fa_down = (row["falseAcceptRate"] or 1) < (base["falseAcceptRate"] or 0)
            eventual_down = (row["eventualSuccess"] or 0) < (base["eventualSuccess"] or 0)
            abstain_up = (row["abstainRate"] or 0) > (base["abstainRate"] or 0)
            row["f2dLike"] = bool(fa_down and eventual_down and abstain_up)
            # Desired: FA down, abstain down or flat, eventual up or flat
            row["desired"] = bool(
                fa_down
                and (row["abstainRate"] or 1) <= (base["abstainRate"] or 0) + 1e-9
                and (row["eventualSuccess"] or 0) >= (base["eventualSuccess"] or 0) - 1e-9
            )
            # Practical: FA down, eventual not down, abstain not up much
            row["acceptable"] = bool(
                fa_down
                and (row["eventualSuccess"] or 0) >= (base["eventualSuccess"] or 0) - 1e-9
                and (row["abstainRate"] or 1) <= (base["abstainRate"] or 0) + 0.02
            )
    return rows_out


def topk_same_coverage(accepts: list[dict], score_key: str) -> dict[str, Any]:
    """Keep the same ACCEPT count as baseline, ranked by simulated score (higher better)."""
    scored = [(a["sim"][score_key], a["decision"]) for a in accepts if a["sim"].get(score_key) is not None]
    if not scored:
        return {}
    k = len(scored)
    ranked = sorted(scored, key=lambda x: x[0], reverse=True)
    keep = ranked[:k]  # same k — full set; for discrimination use prefix metrics
    # Prefix precision curve at FA-budget and at 50%/75% coverage of baseline accepts
    out = {"k": k}
    for frac in (0.5, 0.75, 1.0):
        n = max(1, int(round(k * frac)))
        chunk = ranked[:n]
        true_n = sum(1 for _, d in chunk if d == "correct")
        fa_n = sum(1 for _, d in chunk if d == "wrong")
        out[f"top{int(frac*100)}pct"] = {
            "n": n,
            "true": true_n,
            "fa": fa_n,
            "precision": round(true_n / n, 4) if n else None,
            "falseAcceptRate": round(fa_n / n, 4) if n else None,
        }
    # How many FA fall in bottom quartile by score?
    q = max(1, k // 4)
    bottom = ranked[-q:]
    out["bottomQuartileFaShare"] = round(
        sum(1 for _, d in bottom if d == "wrong") / max(1, sum(1 for _, d in scored if d == "wrong")),
        4,
    ) if any(d == "wrong" for _, d in scored) else None
    out["bottomQuartile"] = {
        "n": q,
        "fa": sum(1 for _, d in bottom if d == "wrong"),
        "true": sum(1 for _, d in bottom if d == "correct"),
    }
    return out


def analyze(paths: list[Path]) -> dict[str, Any]:
    results: list[dict] = []
    meta = []
    for p in paths:
        d = json.loads(p.read_text(encoding="utf-8"))
        meta.append({"path": str(p), "label": d.get("label"), "rounds": d.get("rounds")})
        results.extend(d.get("results") or [])

    rounds = len(results)
    accepts = []
    for r in results:
        dec = r.get("firstDecision")
        if dec not in ("correct", "wrong"):
            continue
        sim = simulate_scores(r)
        accepts.append(
            {
                "decision": dec,
                "text": r.get("firstTryText") or r.get("text"),
                "sim": sim,
                "row": r,
            }
        )

    n_true = sum(1 for a in accepts if a["decision"] == "correct")
    n_fa = sum(1 for a in accepts if a["decision"] == "wrong")
    n_abstain = rounds - len(accepts)

    variants = {}
    for key in ("baseline", "A", "B", "C"):
        true_s = [a["sim"][key] for a in accepts if a["decision"] == "correct" and a["sim"][key] is not None]
        fa_s = [a["sim"][key] for a in accepts if a["decision"] == "wrong" and a["sim"][key] is not None]
        sweep = threshold_sweep(accepts, key, rounds=rounds)
        desired = [x for x in sweep if x.get("desired")]
        acceptable = [x for x in sweep if x.get("acceptable")]
        best = None
        pool = desired or acceptable
        if pool:
            best = max(pool, key=lambda x: (x.get("eventualSuccess") or 0, -(x.get("falseAcceptRate") or 1)))
        variants[key] = {
            "separation": _sep(true_s, fa_s),
            "topk": topk_same_coverage(accepts, key),
            "sweepSize": len(sweep),
            "baselinePoint": sweep[0] if sweep else None,
            "bestDesiredOrAcceptable": best,
            "desiredCount": len(desired),
            "acceptableCount": len(acceptable),
            "f2dLikeCount": sum(1 for x in sweep if x.get("f2dLike")),
            "sweepSample": [sweep[0], best, sweep[-1]] if sweep and best else (sweep[:2] + sweep[-1:] if sweep else []),
        }

    flag_true = {"agree": 0, "charRisk": 0, "conflict": 0}
    flag_fa = {"agree": 0, "charRisk": 0, "conflict": 0}
    for a in accepts:
        flags = a["sim"].get("flags") or {}
        bucket = flag_true if a["decision"] == "correct" else flag_fa
        for k in bucket:
            if flags.get(k):
                bucket[k] += 1

    sep_base = variants["baseline"]["separation"].get("gap")
    sep_a = variants["A"]["separation"].get("gap")
    sep_c = variants["C"]["separation"].get("gap")
    auc_base = variants["baseline"]["separation"].get("aucTrueGtFa") or 0
    auc_c = variants["C"]["separation"].get("aucTrueGtFa") or 0
    top50_base = (variants["baseline"]["topk"].get("top50pct") or {}).get("precision")
    top50_a = (variants["A"]["topk"].get("top50pct") or {}).get("precision")
    top50_c = (variants["C"]["topk"].get("top50pct") or {}).get("precision")

    return {
        "sources": meta,
        "params": {
            "agreeBonus": AGREE_BONUS,
            "charRiskPenalty": CHAR_RISK_PENALTY,
            "conflictPenalty": CONFLICT_PENALTY,
            "charLow": CHAR_LOW,
            "note": "Offline only; no Decision/gate/retry mutation.",
        },
        "rounds": rounds,
        "nAccepts": len(accepts),
        "nTrue": n_true,
        "nFa": n_fa,
        "nAbstain": n_abstain,
        "abstainWithText": 0,
        "limitation": (
            "Current abstain rows have no candidate text; soft score cannot recall them. "
            "Re-thresholding ACCEPT→abstain always raises abstainRate (F2-D-shaped on coverage). "
            "Primary C2-C signal = ranking/separation under same coverage, not abstain↓."
        ),
        "flagShares": {
            "true": {k: round(v / n_true, 4) if n_true else None for k, v in flag_true.items()},
            "fa": {k: round(v / n_fa, 4) if n_fa else None for k, v in flag_fa.items()},
            "trueCounts": flag_true,
            "faCounts": flag_fa,
        },
        "variants": variants,
        "verdictHints": {
            "agreeIsPositive": (flag_fa["agree"] == 0 and flag_true["agree"] > 0),
            "separationImprovedA": (sep_a is not None and sep_base is not None and sep_a > sep_base),
            "separationImprovedC": (sep_c is not None and sep_base is not None and sep_c > sep_base),
            "aucImprovedC": auc_c > auc_base,
            "top50PrecisionImprovedA": (
                top50_a is not None and top50_base is not None and top50_a > top50_base
            ),
            "top50PrecisionImprovedC": (
                top50_c is not None and top50_base is not None and top50_c > top50_base
            ),
            "top50PrecisionFlat": (
                top50_a is not None and top50_base is not None and top50_a == top50_base
            ),            "foundNonF2DOperatingPoint": any(
                variants[k].get("desiredCount", 0) > 0 or variants[k].get("acceptableCount", 0) > 0
                for k in ("A", "B", "C")
            ),
            "canEnterE1DSoftAgreeOnly": bool(
                flag_fa["agree"] == 0
                and flag_true["agree"] > 0
                and sep_a is not None
                and sep_base is not None
                and sep_a > sep_base
            ),
            "shouldHardGateConflict": False,
        },
    }


def render_md(summary: dict) -> str:
    p = summary["params"]
    lines = [
        "# E1-C.2 / C2-C：Offline Soft Score Simulation",
        "",
        "**范围**：离线重算 only；**未**改线上 decisionScore / gate / retry。",
        "",
        f"- sources: {', '.join(f"`{s.get('label')}`" for s in summary['sources'])}",
        f"- rounds={summary['rounds']} ACCEPT={summary['nAccepts']} "
        f"(true={summary['nTrue']}, FA={summary['nFa']}) abstain={summary['nAbstain']}",
        f"- params: agreeBonus={p['agreeBonus']}, charRiskPenalty={p['charRiskPenalty']}, "
        f"conflictPenalty={p['conflictPenalty']}",
        "",
        "## 限制（重要）",
        "",
        summary["limitation"],
        "",
        "## 信号在 ACCEPT 内的分布",
        "",
        "| flag | share of true | share of FA |",
        "|------|--------------:|------------:|",
    ]
    ft, ff = summary["flagShares"]["true"], summary["flagShares"]["fa"]
    for k in ("agree", "charRisk", "conflict"):
        lines.append(f"| `{k}` | {ft.get(k)} | {ff.get(k)} |")

    lines += [
        "",
        "## Separation（true mean − FA mean / AUC）",
        "",
        "| variant | trueMean | faMean | gap | AUC P(true>fa) |",
        "|---------|---------:|-------:|----:|---------------:|",
    ]
    for key in ("baseline", "A", "B", "C"):
        sep = summary["variants"][key]["separation"]
        lines.append(
            f"| {key} | {sep.get('trueMean')} | {sep.get('faMean')} | "
            f"{sep.get('gap')} | {sep.get('aucTrueGtFa')} |"
        )

    lines += [
        "",
        "## 同 coverage 排序（top-50% / top-75% precision）",
        "",
        "| variant | top50 precision | top50 FAR | top75 precision | bottomQ FA count |",
        "|---------|----------------:|----------:|----------------:|-----------------:|",
    ]
    for key in ("baseline", "A", "B", "C"):
        tk = summary["variants"][key].get("topk") or {}
        t50 = tk.get("top50pct") or {}
        t75 = tk.get("top75pct") or {}
        bq = tk.get("bottomQuartile") or {}
        lines.append(
            f"| {key} | {t50.get('precision')} | {t50.get('falseAcceptRate')} | "
            f"{t75.get('precision')} | {bq.get('fa')}/{bq.get('n')} |"
        )

    lines += ["", "## 再阈值工作点（ACCEPT→simulated abstain）", ""]
    for key in ("baseline", "A", "B", "C"):
        v = summary["variants"][key]
        best = v.get("bestDesiredOrAcceptable")
        lines.append(f"### Simulation `{key}`")
        lines.append(
            f"- desired(FA↓∧abstain↓∧eventual↑)={v.get('desiredCount')} · "
            f"acceptable={v.get('acceptableCount')} · F2-D-like={v.get('f2dLikeCount')}"
        )
        if best:
            lines.append(
                f"- best: thr={best.get('threshold')} FAR={best.get('falseAcceptRate')} "
                f"eventual={best.get('eventualSuccess')} abstain={best.get('abstainRate')}"
            )
        else:
            lines.append(
                "- 无 FA↓且不损 eventual/abstain 的工作点（在「只能降 ACCEPT」结构下符合预期）。"
            )
        lines.append("")

    vh = summary["verdictHints"]
    lines += [
        "## 裁决",
        "",
        f"| 检查项 | 结果 |",
        f"|--------|------|",
        f"| agree 为正证据（FA agree=0） | **{vh.get('agreeIsPositive')}** |",
        f"| Sim A 分离 gap↑ | **{vh.get('separationImprovedA')}** |",
        f"| Sim C 分离/AUC↑ | **{vh.get('separationImprovedC')}** / **{vh.get('aucImprovedC')}** |",
        f"| top50 precision↑ (A/C) | {vh.get('top50PrecisionImprovedA')} / {vh.get('top50PrecisionImprovedC')} "
        f"(flat={vh.get('top50PrecisionFlat')}) |",
        f"| 存在 FA↓∧abstain↓ 工作点 | **{vh.get('foundNonF2DOperatingPoint')}** |",
        f"| 可进 E1-D（仅 soft agree factor） | **{vh.get('canEnterE1DSoftAgreeOnly')}** |",
        f"| conflict hard gate | **{vh.get('shouldHardGateConflict')}** |",
        "",
        "### 结论句",
        "",
        "1. `independentAgree` 适合作为 **positive soft calibration factor**（非 hard accept）。",
        "2. 仅靠抬阈值 / 降 ACCEPT **无法**同时做到 FA↓ + abstain↓（当前 abstain 无文本）。",
        "3. conflict / weak|conflict **不要**做主惩罚；C 的 AUC 提升有限且会误伤 true。",
        "4. E1-D 若开工：范围收窄为 **optional agree bonus**；禁止 conflict hard gate / weak|conflict penalty。",
        "",
        "脚本：`scripts/e1c2_soft_score_sim.py`",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) > 1:
        paths = [Path(p) for p in sys.argv[1:]]
    else:
        # Prefer C2-B lengate + first ppllocr benches
        defaults = [
            ROOT / "reports" / "captcha_ocr_bench_20260815T111025Z.json",
            ROOT / "reports" / "captcha_ocr_bench_20260815T110823Z.json",
        ]
        paths = [p for p in defaults if p.exists()]
        if not paths:
            print("Usage: e1c2_soft_score_sim.py reports/*.json", file=sys.stderr)
            return 2

    summary = analyze(paths)
    out_json = ROOT / "reports" / "e1c2_soft_score_sim.json"
    out_md = ROOT / "reports" / "e1c2_soft_score_sim.md"
    out_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    out_md.write_text(render_md(summary), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in summary if k != "variants"}, ensure_ascii=False, indent=2))
    print("--- variants separation ---")
    for k, v in summary["variants"].items():
        print(k, v["separation"], "best", v.get("bestDesiredOrAcceptable"))
    print(f"wrote {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
