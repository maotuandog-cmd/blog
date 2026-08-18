#!/usr/bin/env python3
"""A1: offline correlatedMinAgree simulation (does NOT change live Decision).

For each live round:
  1. GET demo captcha
  2. POST solver (demo-strict, current F2)
  3. If solver ACCEPTed → verify text (baseline)
  4. If solver ABSTAINed but abstainCandidateText exists → verify that candidate
     (ground truth for recovery simulations)
  5. Re-score ACCEPT/ABSTAIN under simulated gates

Policies:
  baseline   correlatedMinAgree=1.0  evidenceThr=0.5
  A/B/C/D    0.9 / 0.85 / 0.8 / 0.75 evidenceThr=0.5
  joint_0.8  agreement>=0.8 AND evidence>=0.55 (votes>=2); else baseline-like

Writes reports/a1_correlated_gate_sim_*.{json,md}
"""
from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEMO = (os.environ.get("CAPTCHA_DEMO_URL") or "http://127.0.0.1:3000").rstrip("/")
SOLVER = (os.environ.get("CAPTCHA_SOLVER_URL") or "http://127.0.0.1:18085/captcha").rstrip("/")
ROUNDS = max(1, int(os.environ.get("ROUNDS") or "40"))
OUT_DIR = Path(os.environ.get("REPORT_DIR") or (ROOT / "reports"))
PROFILE = (os.environ.get("CAPTCHA_PROFILE") or "demo-strict").strip() or "demo-strict"
SOLVER_TIMEOUT_S = max(5, int(os.environ.get("SOLVER_TIMEOUT_S") or "60"))

POLICIES: list[dict[str, Any]] = [
    {"id": "baseline", "minAgree": 1.0, "evidenceThr": 0.5, "mode": "f2"},
    {"id": "A_0.9", "minAgree": 0.9, "evidenceThr": 0.5, "mode": "f2"},
    {"id": "B_0.85", "minAgree": 0.85, "evidenceThr": 0.5, "mode": "f2"},
    {"id": "C_0.8", "minAgree": 0.8, "evidenceThr": 0.5, "mode": "f2"},
    {"id": "D_0.75", "minAgree": 0.75, "evidenceThr": 0.5, "mode": "f2"},
    {
        "id": "joint_agr0.8_ev0.55",
        "minAgree": 0.8,
        "evidenceThr": 0.55,
        "mode": "joint",
    },
]


def _http_json(
    url: str,
    *,
    method: str = "GET",
    data: dict | None = None,
    opener: urllib.request.OpenerDirector | None = None,
    timeout: float = 60,
) -> tuple[int, dict | bytes]:
    body = None
    hdrs: dict[str, str] = {}
    if data is not None:
        body = json.dumps(data).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    open_fn = opener.open if opener else urllib.request.urlopen
    try:
        with open_fn(req, timeout=timeout) as res:
            raw = res.read()
            ctype = (res.headers.get("Content-Type") or "").lower()
            if "json" in ctype or (raw[:1] in (b"{", b"[")):
                return res.status, json.loads(raw.decode() or "{}")
            return res.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode() or "{}")
        except Exception:
            return e.code, {"error": raw.decode(errors="replace")[:300]}


def fetch_captcha(opener: urllib.request.OpenerDirector) -> bytes:
    code, payload = _http_json(f"{DEMO}/api/captcha", opener=opener)
    if code != 200 or not isinstance(payload, (bytes, bytearray)):
        raise RuntimeError(f"captcha image failed status={code}")
    return bytes(payload)


def solve(png: bytes, round_i: int) -> dict:
    b64 = base64.b64encode(png).decode()
    data = {
        "jobId": f"a1-{round_i}",
        "pageUrl": DEMO + "/",
        "screenshotBase64": b64,
        "kind": "image",
        "profile": PROFILE,
        "sessionId": f"a1_s_{round_i}",
    }
    code, payload = _http_json(SOLVER, method="POST", data=data, timeout=SOLVER_TIMEOUT_S)
    if not isinstance(payload, dict):
        return {"solved": False, "decision": "abstain", "error": f"bad_payload_{code}"}
    payload["_http"] = code
    return payload


def verify(opener: urllib.request.OpenerDirector, text: str) -> dict:
    code, payload = _http_json(
        f"{DEMO}/api/captcha/verify",
        method="POST",
        data={"code": text},
        opener=opener,
    )
    if not isinstance(payload, dict):
        return {"ok": False, "message": f"bad_verify_{code}", "_http": code}
    payload["_http"] = code
    ok = bool(payload.get("success") or payload.get("ok") or payload.get("valid"))
    msg = str(payload.get("message") or "")
    if not ok and code == 200 and ("成功" in msg or payload.get("correct") is True):
        ok = True
    payload["ok"] = ok
    return payload


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def extract_metrics(sol: dict) -> dict[str, Any]:
    obs = sol.get("observation") if isinstance(sol.get("observation"), dict) else {}
    detail = sol.get("abstainReasonDetail") or obs.get("abstainReasonDetail") or {}
    cand = (
        sol.get("abstainCandidateText")
        or obs.get("abstainCandidateText")
        or (detail.get("candidateText") if isinstance(detail, dict) else None)
        or (sol.get("text") if sol.get("solved") else None)
    )
    evidence = _f(
        sol.get("evidenceScoreAdjusted")
        if sol.get("evidenceScoreAdjusted") is not None
        else sol.get("evidenceScore")
    )
    if evidence is None and isinstance(detail, dict):
        evidence = _f(detail.get("evidenceScore"))
    agreement = _f(sol.get("agreementScore") if sol.get("agreementScore") is not None else sol.get("weightShare"))
    if agreement is None and isinstance(detail, dict):
        agreement = _f(detail.get("agreementScore"))
    votes = _i(sol.get("votes"))
    if votes is None and isinstance(detail, dict):
        votes = _i(detail.get("votes"))
    n_valid = _i(sol.get("nValid"))
    if n_valid is None and isinstance(detail, dict):
        n_valid = _i(detail.get("nValid"))
    independent = _i(sol.get("independentSources"))
    if independent is None and isinstance(detail, dict):
        independent = _i(detail.get("independentSources"))
    if independent is None:
        independent = 1
    bucket = sol.get("abstainBucket") or obs.get("abstainBucket") or (detail.get("bucket") if isinstance(detail, dict) else None)
    gate_reason = str(sol.get("decisionReason") or detail.get("decisionReason") or sol.get("reason") or "")
    return {
        "candidateText": str(cand).strip() if cand else "",
        "evidenceScore": evidence,
        "agreementScore": agreement,
        "votes": votes or 0,
        "nValid": n_valid if n_valid is not None else (votes or 0),
        "independentSources": independent,
        "bucket": bucket,
        "gateReason": gate_reason,
        "baselineSolved": bool(sol.get("solved")),
        "baselineText": str(sol.get("text") or "").strip(),
    }


def simulate_accept(m: dict[str, Any], policy: dict[str, Any]) -> tuple[bool, str]:
    """Return (accept?, reason)."""
    text = m.get("candidateText") or ""
    if not text:
        return False, "no_candidate"
    ev = m.get("evidenceScore")
    agr = m.get("agreementScore")
    votes = int(m.get("votes") or 0)
    independent = int(m.get("independentSources") or 1)
    min_agree = float(policy["minAgree"])
    thr = float(policy["evidenceThr"])
    mode = policy.get("mode") or "f2"

    if ev is None:
        return False, "no_evidence_score"

    if mode == "joint":
        # Strong-stability window: multi-vote needs agr+ev; single-vote uses thr only.
        if votes >= 2 and independent < 2:
            if agr is None:
                return False, "no_agreement"
            if agr + 1e-9 < min_agree:
                return False, "joint_agree_fail"
            if ev + 1e-9 < thr:
                return False, "joint_evidence_fail"
            return True, "joint_accept"
        if ev + 1e-9 < 0.5:  # keep baseline thr for weak single-source
            return False, "below_threshold"
        return True, "single_accept"

    # F2-style
    if votes >= 2 and independent < 2:
        if agr is None:
            return False, "no_agreement"
        if agr + 1e-9 < min_agree:
            return False, "correlated_gate"
    if ev + 1e-9 < thr:
        return False, "below_threshold"
    return True, "accept"


def band(agr: float | None) -> str:
    if agr is None:
        return "unknown"
    if agr >= 1.0 - 1e-9:
        return "1.0"
    if agr >= 0.9:
        return "0.9-1.0"
    if agr >= 0.8:
        return "0.8-0.9"
    if agr >= 0.75:
        return "0.75-0.8"
    if agr >= 0.5:
        return "0.5-0.75"
    return "<0.5"


def main() -> int:
    rows: list[dict[str, Any]] = []
    t0 = time.time()

    print(f"A1 sim DEMO={DEMO} SOLVER={SOLVER} ROUNDS={ROUNDS} PROFILE={PROFILE}")
    for i in range(1, ROUNDS + 1):
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        try:
            png = fetch_captcha(opener)
            sol = solve(png, i)
            m = extract_metrics(sol)
            gt_text = m["candidateText"] or m["baselineText"]
            verify_ok = None
            verify_msg = ""
            if gt_text:
                ver = verify(opener, gt_text)
                verify_ok = bool(ver.get("ok"))
                verify_msg = str(ver.get("message") or "")

            baseline_decision = "accept" if m["baselineSolved"] and m["baselineText"] else "abstain"
            if gt_text:
                candidate_truth = "correct" if verify_ok else "wrong"
            else:
                candidate_truth = "no_candidate"
            baseline_outcome = candidate_truth if baseline_decision == "accept" else None

            sims = {}
            for pol in POLICIES:
                ok, why = simulate_accept(m, pol)
                sims[pol["id"]] = {
                    "accept": ok,
                    "reason": why,
                    "wouldRecover": bool(ok and baseline_decision == "abstain" and gt_text),
                }

            row = {
                "round": i,
                "baselineDecision": baseline_decision,
                "baselineOutcome": baseline_outcome,
                "candidateText": gt_text or None,
                "candidateTruth": candidate_truth,
                "verifyMessage": verify_msg,
                "metrics": {
                    "evidenceScore": m["evidenceScore"],
                    "agreementScore": m["agreementScore"],
                    "votes": m["votes"],
                    "nValid": m["nValid"],
                    "independentSources": m["independentSources"],
                    "agreementBand": band(m["agreementScore"]),
                    "bucket": m["bucket"],
                    "gateReason": m["gateReason"],
                },
                "simulations": sims,
            }
            rows.append(row)
            print(
                f"[{i}/{ROUNDS}] base={baseline_decision} cand={gt_text!r} "
                f"truth={candidate_truth} agr={m['agreementScore']} ev={m['evidenceScore']} "
                f"votes={m['votes']} bucket={m['bucket']}"
            )
        except Exception as e:  # noqa: BLE001
            rows.append({"round": i, "error": f"{type(e).__name__}:{e}"})
            print(f"[{i}/{ROUNDS}] ERROR {type(e).__name__}: {e}")
        time.sleep(0.05)

    # Aggregate
    n = len([r for r in rows if "error" not in r])
    baseline_accept = sum(1 for r in rows if r.get("baselineDecision") == "accept")
    baseline_abstain = sum(1 for r in rows if r.get("baselineDecision") == "abstain")
    baseline_correct = sum(1 for r in rows if r.get("baselineOutcome") == "correct")
    baseline_wrong = sum(1 for r in rows if r.get("baselineOutcome") == "wrong")

    policy_stats: dict[str, Any] = {}
    for pol in POLICIES:
        pid = pol["id"]
        accept_n = recover_n = recover_correct = recover_wrong = 0
        still_abstain = 0
        band_recover: dict[str, Counter] = defaultdict(Counter)
        for r in rows:
            if "error" in r:
                continue
            sim = (r.get("simulations") or {}).get(pid) or {}
            if sim.get("accept"):
                accept_n += 1
                if r.get("baselineDecision") == "abstain":
                    recover_n += 1
                    truth = r.get("candidateTruth")
                    if truth == "correct":
                        recover_correct += 1
                    elif truth == "wrong":
                        recover_wrong += 1
                    b = ((r.get("metrics") or {}).get("agreementBand") or "unknown")
                    band_recover[b]["n"] += 1
                    band_recover[b][str(truth)] += 1
            else:
                if r.get("baselineDecision") == "abstain":
                    still_abstain += 1
        # Also count false accepts among ALL accepts under policy (baseline accepts + recovered)
        all_accept_correct = all_accept_wrong = 0
        for r in rows:
            if "error" in r:
                continue
            sim = (r.get("simulations") or {}).get(pid) or {}
            if not sim.get("accept"):
                continue
            truth = r.get("candidateTruth")
            if truth == "correct":
                all_accept_correct += 1
            elif truth == "wrong":
                all_accept_wrong += 1
        fa_denom = all_accept_correct + all_accept_wrong
        policy_stats[pid] = {
            "minAgree": pol.get("minAgree"),
            "evidenceThr": pol.get("evidenceThr"),
            "mode": pol.get("mode"),
            "acceptRate": round(accept_n / n, 4) if n else None,
            "acceptN": accept_n,
            "abstainN": n - accept_n,
            "recoveredFromAbstain": recover_n,
            "recoveryRateOfAbstain": round(recover_n / baseline_abstain, 4) if baseline_abstain else None,
            "recoverCorrect": recover_correct,
            "recoverWrong": recover_wrong,
            "recoveryPrecision": round(recover_correct / recover_n, 4) if recover_n else None,
            "falseAcceptRate": round(all_accept_wrong / fa_denom, 4) if fa_denom else None,
            "acceptCorrect": all_accept_correct,
            "acceptWrong": all_accept_wrong,
            "agreementBandRecovery": {k: dict(v) for k, v in sorted(band_recover.items())},
        }

    # Focus slice: CORRELATED_GATE abstains
    gate_rows = [
        r
        for r in rows
        if r.get("baselineDecision") == "abstain"
        and (
            (r.get("metrics") or {}).get("bucket") == "CORRELATED_GATE"
            or "correlated" in str((r.get("metrics") or {}).get("gateReason") or "")
        )
    ]
    gate_focus = {}
    for pol in POLICIES:
        pid = pol["id"]
        rec = cor = wr = 0
        for r in gate_rows:
            sim = (r.get("simulations") or {}).get(pid) or {}
            if sim.get("accept"):
                rec += 1
                if r.get("candidateTruth") == "correct":
                    cor += 1
                elif r.get("candidateTruth") == "wrong":
                    wr += 1
        gate_focus[pid] = {
            "n": len(gate_rows),
            "recovered": rec,
            "correct": cor,
            "wrong": wr,
            "precision": round(cor / rec, 4) if rec else None,
        }

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "ts": ts,
        "label": "A1-correlated-gate-sim",
        "demo": DEMO,
        "solver": SOLVER,
        "profile": PROFILE,
        "rounds": ROUNDS,
        "elapsedSec": round(time.time() - t0, 2),
        "baseline": {
            "accept": baseline_accept,
            "abstain": baseline_abstain,
            "correct": baseline_correct,
            "wrong": baseline_wrong,
            "successRate": round(baseline_correct / n, 4) if n else None,
            "falseAcceptRate": round(baseline_wrong / baseline_accept, 4) if baseline_accept else None,
            "abstainRate": round(baseline_abstain / n, 4) if n else None,
        },
        "policies": policy_stats,
        "correlatedGateFocus": gate_focus,
        "note": "Offline simulation only; live correlatedMinAgree unchanged (still 1.0).",
        "rows": rows,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / f"a1_correlated_gate_sim_{ts}.json"
    md_path = OUT_DIR / f"a1_correlated_gate_sim_{ts}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# A1：Correlated Gate Simulation",
        "",
        f"- rounds={ROUNDS} profile=`{PROFILE}`",
        f"- baseline success={report['baseline']['successRate']} FAR={report['baseline']['falseAcceptRate']} abstain={report['baseline']['abstainRate']}",
        "- **live Decision unchanged** (`correlatedMinAgree` still 1.0)",
        "",
        "## Policy matrix",
        "",
        "| policy | minAgree | evThr | acceptRate | recover/abstain | recoveryPrecision | FAR |",
        "|--------|---------:|------:|-----------:|----------------:|------------------:|----:|",
    ]
    for pol in POLICIES:
        s = policy_stats[pol["id"]]
        lines.append(
            f"| `{pol['id']}` | {s.get('minAgree')} | {s.get('evidenceThr')} | "
            f"{s.get('acceptRate')} | {s.get('recoveredFromAbstain')}/{baseline_abstain} "
            f"({s.get('recoveryRateOfAbstain')}) | {s.get('recoveryPrecision')} | {s.get('falseAcceptRate')} |"
        )
    lines += [
        "",
        "## CORRELATED_GATE subset",
        "",
        f"n={len(gate_rows)}",
        "",
        "| policy | recovered | correct | wrong | precision |",
        "|--------|----------:|--------:|------:|----------:|",
    ]
    for pol in POLICIES:
        g = gate_focus[pol["id"]]
        lines.append(
            f"| `{pol['id']}` | {g['recovered']} | {g['correct']} | {g['wrong']} | {g['precision']} |"
        )
    lines += [
        "",
        "## Reading guide",
        "",
        "- Recovery ↑ with FAR flat → safe F2 soften candidate (情况 A)",
        "- Recovery ↑ with FAR ↑ → need joint gate (情况 B)",
        "- Little change → bottleneck elsewhere → A2 (情况 C)",
        "",
        f"JSON: `{json_path}`",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    # stable latest
    (OUT_DIR / "a1_correlated_gate_sim_latest.md").write_text("\n".join(lines), encoding="utf-8")
    (OUT_DIR / "a1_correlated_gate_sim_latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("----")
    print(f"baseline success={report['baseline']['successRate']} FAR={report['baseline']['falseAcceptRate']}")
    for pol in POLICIES:
        s = policy_stats[pol["id"]]
        print(
            f"{pol['id']}: accept={s['acceptRate']} recover={s['recoveredFromAbstain']}/{baseline_abstain} "
            f"prec={s['recoveryPrecision']} FAR={s['falseAcceptRate']}"
        )
    print(f"report_md={md_path}")
    print(f"report_json={json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
