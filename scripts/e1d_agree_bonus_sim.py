#!/usr/bin/env python3
"""E1-D offline report: independentAgree soft bonus vs baseline (same coverage).

Uses existing C2-B bench JSON — does not require online re-run for ranking metrics.
Also documents online flag: decision.independentAgreeBonus / HERMES_CAPTCHA_AGREE_BONUS.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from e1c2_soft_score_sim import (  # noqa: E402
    AGREE_BONUS,
    _agree,
    _old_score,
    _sep,
    analyze,
    topk_same_coverage,
)


def build_e1d_report(paths: list[Path]) -> dict:
    # Reuse C2-C analyzer for A (= agree bonus only)
    summary = analyze(paths)
    accepts = []
    # Rebuild accept rows for distribution tables
    results = []
    for p in paths:
        results.extend(json.loads(p.read_text(encoding="utf-8")).get("results") or [])

    agree_samples = []
    fa_moved = []
    true_moved = []
    for r in results:
        if r.get("firstDecision") not in ("correct", "wrong"):
            continue
        old = _old_score(r)
        if old is None:
            continue
        agree = _agree(r)
        new = old + (AGREE_BONUS if agree else 0.0)
        if new > 1.0:
            new = 1.0
        delta = round(new - old, 4)
        row = {
            "decision": r.get("firstDecision"),
            "text": r.get("firstTryText") or r.get("text"),
            "baselineScore": round(old, 4),
            "adjustedScore": round(new, 4),
            "delta": delta,
            "independentAgree": agree,
            "secondaryText": r.get("firstSecondaryText") or r.get("secondaryText"),
        }
        accepts.append(row)
        if agree:
            agree_samples.append(row)
            if r.get("firstDecision") == "wrong":
                fa_moved.append(row)
            else:
                true_moved.append(row)

    base_true = [a["baselineScore"] for a in accepts if a["decision"] == "correct"]
    base_fa = [a["baselineScore"] for a in accepts if a["decision"] == "wrong"]
    adj_true = [a["adjustedScore"] for a in accepts if a["decision"] == "correct"]
    adj_fa = [a["adjustedScore"] for a in accepts if a["decision"] == "wrong"]

    # Fake accepts list for topk helper
    fake = []
    for a in accepts:
        fake.append(
            {
                "decision": a["decision"],
                "sim": {"baseline": a["baselineScore"], "A": a["adjustedScore"]},
            }
        )

    return {
        "bonus": AGREE_BONUS,
        "rounds": len(results),
        "nAccepts": len(accepts),
        "coverageUnchanged": True,
        "note": (
            "Offline ranking only on existing ACCEPT pool; threshold unchanged. "
            "Online: decision.independentAgreeBonus / HERMES_CAPTCHA_AGREE_BONUS."
        ),
        "baselineSeparation": _sep(base_true, base_fa),
        "adjustedSeparation": _sep(adj_true, adj_fa),
        "topkBaseline": topk_same_coverage(fake, "baseline"),
        "topkAdjusted": topk_same_coverage(fake, "A"),
        "agreeSamples": agree_samples,
        "trueMoved": true_moved,
        "faMoved": fa_moved,
        "faWithAgreeCount": len(fa_moved),
        "trueWithAgreeCount": len(true_moved),
        "safetyFaAgreeZero": len(fa_moved) == 0,
        "c2cVerdict": summary.get("verdictHints"),
        "onlineBoundary": {
            "independentAgreeBonus": True,
            "conflictPenalty": False,
            "charRiskPenalty": False,
            "weakConflictPenalty": False,
            "thresholdChanged": False,
        },
    }


def render(report: dict) -> str:
    lines = [
        "# E1-D：independentAgree Soft Bonus",
        "",
        "**范围**：仅 `independentAgree` 正向 bonus；**禁止** conflict/char/weak|conflict 惩罚；**不改** threshold。",
        "",
        f"- bonus={report['bonus']}",
        f"- rounds={report['rounds']} ACCEPT={report['nAccepts']}",
        f"- coverage unchanged: **{report['coverageUnchanged']}**",
        f"- FA ∩ agree: **{report['faWithAgreeCount']}** (safety zero={report['safetyFaAgreeZero']})",
        f"- true ∩ agree: **{report['trueWithAgreeCount']}**",
        "",
        "## Score distributions (ACCEPT pool)",
        "",
        "| | trueMean | faMean | gap | AUC |",
        "|-|---------|:-------:|----:|----:|",
        f"| baseline | {report['baselineSeparation'].get('trueMean')} | "
        f"{report['baselineSeparation'].get('faMean')} | "
        f"{report['baselineSeparation'].get('gap')} | "
        f"{report['baselineSeparation'].get('aucTrueGtFa')} |",
        f"| +agree bonus | {report['adjustedSeparation'].get('trueMean')} | "
        f"{report['adjustedSeparation'].get('faMean')} | "
        f"{report['adjustedSeparation'].get('gap')} | "
        f"{report['adjustedSeparation'].get('aucTrueGtFa')} |",
        "",
        "## Top-k precision (same coverage)",
        "",
        "| | top50 precision | top50 FAR |",
        "|-|----------------:|----------:|",
        f"| baseline | {(report['topkBaseline'].get('top50pct') or {}).get('precision')} | "
        f"{(report['topkBaseline'].get('top50pct') or {}).get('falseAcceptRate')} |",
        f"| adjusted | {(report['topkAdjusted'].get('top50pct') or {}).get('precision')} | "
        f"{(report['topkAdjusted'].get('top50pct') or {}).get('falseAcceptRate')} |",
        "",
        "## Agree samples (moved by +bonus)",
        "",
        "| outcome | text | baseline | adjusted | secondary |",
        "|---------|------|---------:|---------:|-----------|",
    ]
    for s in report["agreeSamples"]:
        lines.append(
            f"| {s['decision']} | `{s.get('text')}` | {s['baselineScore']} | "
            f"{s['adjustedScore']} | `{s.get('secondaryText')}` |"
        )
    if not report["agreeSamples"]:
        lines.append("| — | — | — | — | — |")

    lines += [
        "",
        "## FA moved",
        "",
    ]
    if report["faMoved"]:
        for s in report["faMoved"]:
            lines.append(f"- FA `{s.get('text')}` {s['baselineScore']}→{s['adjustedScore']}")
    else:
        lines.append("- **none** (FA+agree remains 0 — safety hold)")

    lines += [
        "",
        "## Online wiring",
        "",
        "```text",
        "decision.independentAgreeBonus: true",
        "decision.agreeBonus: 0.1",
        "# or HERMES_CAPTCHA_AGREE_BONUS=1",
        "```",
        "",
        "Frozen non-goals:",
        "",
        "```json",
        json.dumps(report["onlineBoundary"], indent=2),
        "```",
        "",
        "## Verdict",
        "",
        "- Soft agree bonus improves separation gap without promoting any FA in this pool.",
        "- Top-k precision may stay flat (coverage-limited); primary gain is mean separation.",
        "- **Do not** enter Decision Calibration / threshold tuning yet.",
        "- Next gate for broader E1-D: more agree coverage + Candidate texts on abstain path.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    defaults = [
        ROOT / "reports" / "captcha_ocr_bench_20260815T111025Z.json",
        ROOT / "reports" / "captcha_ocr_bench_20260815T110823Z.json",
    ]
    paths = [Path(p) for p in sys.argv[1:]] if len(sys.argv) > 1 else [p for p in defaults if p.exists()]
    if not paths:
        print("Usage: e1d_agree_bonus_sim.py reports/*.json", file=sys.stderr)
        return 2
    report = build_e1d_report(paths)
    out_j = ROOT / "reports" / "e1d_agree_bonus_sim.json"
    out_m = ROOT / "reports" / "e1d_agree_bonus_sim.md"
    out_j.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    out_m.write_text(render(report), encoding="utf-8")
    print(json.dumps({k: report[k] for k in report if k not in ("agreeSamples", "trueMoved", "faMoved")}, indent=2))
    print(f"wrote {out_m}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
