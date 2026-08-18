#!/usr/bin/env python3
"""F1: attribute false accepts from a bench JSON (or re-attribute with proxies)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "captcha-solver"))

from solvers.false_accept import attribute_accept, summarize_attributions  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: false_accept_report.py reports/captcha_ocr_bench_*.json", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    results = data.get("results") or []
    attributed = []
    for r in results:
        # Prefer live F1 block from bench when present
        fa = r.get("firstFalseAccept")
        if isinstance(fa, dict) and fa.get("attributed"):
            attributed.append({"falseAccept": fa})
            continue

        if r.get("firstDecision") in ("correct", "wrong"):
            view = dict(r)
            view["decision"] = "accept"
            view["solved"] = True
            view["text"] = r.get("firstTryText") or r.get("text")
            # Prefer first-attempt score fields when present on the row
            if r.get("decisionScore") is None and r.get("confidence") is not None:
                view["decisionScore"] = r.get("confidence")
            fb_status = "failed" if r.get("firstDecision") == "wrong" else "success"
            fa = attribute_accept(view, feedback={"status": fb_status}, min_conf=0.5)
            r["firstFalseAccept"] = fa
            if fa.get("attributed"):
                attributed.append({"falseAccept": fa})
        elif isinstance(r.get("falseAccept"), dict) and r["falseAccept"].get("attributed"):
            attributed.append({"falseAccept": r["falseAccept"]})

    summary = summarize_attributions(attributed)
    data["falseAcceptAttribution"] = summary
    out_json = path.with_name(path.stem + "_fa.json")
    out_md = path.with_name(path.stem + "_fa.md")
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"# F1 False-ACCEPT Attribution ({path.name})",
        "",
        f"- totalAttributedAccepts: {summary.get('totalAttributedAccepts')}",
        f"- totalFalseAccepts: **{summary.get('totalFalseAccepts')}**",
        f"- topClass: **{summary.get('topClass')}**",
        "",
        "| class | acceptCount | acceptFailed | falseAcceptRate | shareOfFA |",
        "|-------|------------:|-------------:|----------------:|----------:|",
    ]
    for row in summary.get("byClass") or []:
        lines.append(
            f"| `{row['class']}` | {row['acceptCount']} | {row['acceptFailed']} | "
            f"{row['falseAcceptRate']:.1%} | {row['shareOfFalseAccepts']:.1%} |"
        )
    lines += [
        "",
        "## Recommendation for F2",
        f"Largest false-accept share → **{summary.get('topClass')}** — "
        "calibrate Decision gate / evidence correlation before OCR changes.",
        "",
    ]
    out_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"wrote {out_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
