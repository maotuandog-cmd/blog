#!/usr/bin/env python3
"""E1-C.1 Joint evidence attribution (E1-A × E1-B × E1-C) — offline only.

Does not change Decision / score / gate. Classifies each first-attempt ACCEPT into:
  charEvidence ∈ {strong, weak, unknown}
  independentSource ∈ {agree, conflict, unknown}
  charMargin ∈ {tight, loose, unknown}  (optional third axis)
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _f(v, default=None):
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def char_bucket(row: dict, *, low_conf: float = 0.5) -> str:
    summary = row.get("firstCharSummary") or row.get("charSummary") or {}
    cmin = _f(row.get("firstCharMinConfidence"))
    if cmin is None:
        cmin = _f(summary.get("charMinConfidence") if isinstance(summary, dict) else None)
    if cmin is None:
        cmin = _f(row.get("charMinConfidence"))
    amb = 0
    if isinstance(summary, dict):
        amb = int(summary.get("ambiguousCount") or 0)
    if cmin is None and not amb:
        return "unknown"
    weak = (cmin is not None and cmin < low_conf) or amb > 0
    return "weak" if weak else "strong"


def indep_bucket(row: dict) -> str:
    if row.get("firstSourceUnavailable") is True or row.get("sourceUnavailable") is True:
        return "unknown"
    if row.get("firstSecondaryAvailable") is False or row.get("secondaryAvailable") is False:
        return "unknown"
    agr = row.get("firstSourceAgreement") or row.get("sourceAgreement")
    if isinstance(agr, dict) and (
        agr.get("comparable") is False or agr.get("reason") == "source_unavailable"
    ):
        return "unknown"
    agree = row.get("firstIndependentAgree")
    if agree is None:
        agree = row.get("independentAgree")
    if agree is None and isinstance(agr, dict):
        if agr.get("comparable") is False:
            return "unknown"
        agree = agr.get("agree")
    if agree is None:
        return "unknown"
    return "agree" if agree else "conflict"


def margin_bucket(row: dict, *, tight_gap: float = 0.15) -> str:
    cmm = _f(row.get("firstCharMinMargin"))
    if cmm is None:
        cmm = _f(row.get("charMinMargin"))
    if cmm is None:
        return "unknown"
    return "tight" if cmm <= tight_gap else "loose"


def cell_label(char_b: str, indep_b: str) -> str:
    return f"{char_b}|{indep_b}"


def analyze(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    results = data.get("results") or []
    accepts = [r for r in results if r.get("firstDecision") in ("correct", "wrong")]

    matrix: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "wrong": 0})
    margin_cross: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "wrong": 0})
    rows_out = []

    for r in accepts:
        dec = r.get("firstDecision")
        cb = char_bucket(r)
        ib = indep_bucket(r)
        mb = margin_bucket(r)
        key = cell_label(cb, ib)
        matrix[key][dec] += 1
        margin_cross[f"{cb}|{ib}|{mb}"][dec] += 1
        rows_out.append(
            {
                "decision": dec,
                "text": r.get("firstTryText") or r.get("text"),
                "charBucket": cb,
                "indepBucket": ib,
                "marginBucket": mb,
                "cell": key,
                "charMinConfidence": _f(r.get("firstCharMinConfidence") or r.get("charMinConfidence")),
                "charMinMargin": _f(r.get("firstCharMinMargin") or r.get("charMinMargin")),
                "independentAgree": r.get("firstIndependentAgree")
                if r.get("firstIndependentAgree") is not None
                else r.get("independentAgree"),
                "independentCharDiff": r.get("firstIndependentCharDiff")
                if r.get("firstIndependentCharDiff") is not None
                else r.get("independentCharDiff"),
                "secondaryText": r.get("firstSecondaryText") or r.get("secondaryText"),
                "secondarySource": r.get("secondarySource"),
            }
        )

    def share(n: int, d: int) -> float | None:
        return round(n / d, 4) if d else None

    fa = [x for x in rows_out if x["decision"] == "wrong"]
    ok = [x for x in rows_out if x["decision"] == "correct"]

    # Focus cells
    high_risk = "weak|conflict"
    high_trust = "strong|agree"

    summary = {
        "source": str(path),
        "label": data.get("label"),
        "nAccepts": len(accepts),
        "nFalseAccepts": len(fa),
        "nTrueAccepts": len(ok),
        "matrix": {
            k: {
                "correct": v["correct"],
                "wrong": v["wrong"],
                "total": v["correct"] + v["wrong"],
                "falseAcceptRate": share(v["wrong"], v["correct"] + v["wrong"]),
            }
            for k, v in sorted(matrix.items())
        },
        "falseAcceptCellShares": {
            k: share(sum(1 for x in fa if x["cell"] == k), len(fa)) for k in sorted({x["cell"] for x in fa})
        },
        "trueAcceptCellShares": {
            k: share(sum(1 for x in ok if x["cell"] == k), len(ok)) for k in sorted({x["cell"] for x in ok})
        },
        "highRiskCell": high_risk,
        "highRiskAmongFA": share(sum(1 for x in fa if x["cell"] == high_risk), len(fa)),
        "highRiskAmongTrue": share(sum(1 for x in ok if x["cell"] == high_risk), len(ok)),
        "highTrustCell": high_trust,
        "highTrustAmongFA": share(sum(1 for x in fa if x["cell"] == high_trust), len(fa)),
        "highTrustAmongTrue": share(sum(1 for x in ok if x["cell"] == high_trust), len(ok)),
        "weakConflictPlusTightMarginAmongFA": share(
            sum(1 for x in fa if x["cell"] == high_risk and x["marginBucket"] == "tight"), len(fa)
        ),
        "rows": rows_out,
        "marginCross": {
            k: dict(v) for k, v in sorted(margin_cross.items()) if v["correct"] + v["wrong"]
        },
    }
    return summary


def render_md(summary: dict) -> str:
    lines = [
        f"# E1-C.1 Joint Evidence Attribution ({Path(summary['source']).name})",
        "",
        f"- label: `{summary.get('label')}`",
        f"- accepts: **{summary['nAccepts']}** (true={summary['nTrueAccepts']}, FA={summary['nFalseAccepts']})",
        "",
        "## Matrix: charEvidence × independentSource",
        "",
        "| cell | correct | wrong | total | FAR in cell | share of FA | share of true |",
        "|------|--------:|------:|------:|------------:|------------:|--------------:|",
    ]
    fa_n = summary["nFalseAccepts"] or 1
    ok_n = summary["nTrueAccepts"] or 1
    for cell, v in summary["matrix"].items():
        lines.append(
            f"| `{cell}` | {v['correct']} | {v['wrong']} | {v['total']} | "
            f"{(v['falseAcceptRate'] if v['falseAcceptRate'] is not None else 0):.0%} | "
            f"{v['wrong']/fa_n:.0%} | {v['correct']/ok_n:.0%} |"
        )
    lines += [
        "",
        "## Focus cells",
        f"- high-risk `weak|conflict`: among FA **{summary.get('highRiskAmongFA')}**, "
        f"among true **{summary.get('highRiskAmongTrue')}**",
        f"- high-trust `strong|agree`: among FA **{summary.get('highTrustAmongFA')}**, "
        f"among true **{summary.get('highTrustAmongTrue')}**",
        f"- high-risk + tight char margin among FA: **{summary.get('weakConflictPlusTightMarginAmongFA')}**",
        "",
        "## Per-ACCEPT rows",
        "",
        "| outcome | text | char | indep | margin | charMin | charMinMargin | secondary |",
        "|---------|------|------|-------|--------|--------:|--------------:|-----------|",
    ]
    for r in summary["rows"]:
        lines.append(
            f"| {r['decision']} | `{r.get('text')}` | {r['charBucket']} | {r['indepBucket']} | "
            f"{r['marginBucket']} | {r.get('charMinConfidence')} | {r.get('charMinMargin')} | "
            f"`{r.get('secondaryText')}` |"
        )
    lines += [
        "",
        "## Interpretation guide",
        "",
        "- If FA concentrates in `weak|conflict` while true concentrates in `strong|agree`, "
        "joint evidence is stronger than either axis alone → candidate for careful E1-D.",
        "- If true still heavily occupies `weak|conflict`, do **not** gate on that cell "
        "(F2-D failure mode).",
        "- RapidOCR/cross-family gaps remain a capability issue separate from this matrix.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) < 2:
        # default to latest E1-C bench
        cands = sorted(
            (ROOT / "reports").glob("captcha_ocr_bench_*.json"),
            key=lambda p: p.stat().st_mtime,
        )
        path = None
        for p in reversed(cands):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if d.get("label") == "E1-C-independent-source" or d.get("independentSourceAnalysis"):
                path = p
                break
        if path is None and cands:
            path = cands[-1]
        if path is None:
            print("Usage: e1c1_joint_evidence_report.py reports/captcha_ocr_bench_*.json", file=sys.stderr)
            return 2
    else:
        path = Path(sys.argv[1])

    summary = analyze(path)
    out_json = path.with_name(path.stem + "_e1c1.json")
    out_md = path.with_name(path.stem + "_e1c1.md")
    # also canonical report
    canon = ROOT / "reports" / "e1c1_joint_evidence.md"
    out_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    md = render_md(summary)
    out_md.write_text(md, encoding="utf-8")
    canon.write_text(md, encoding="utf-8")
    print(json.dumps({k: summary[k] for k in summary if k != "rows"}, ensure_ascii=False, indent=2))
    print(f"wrote {out_md}")
    print(f"wrote {canon}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
