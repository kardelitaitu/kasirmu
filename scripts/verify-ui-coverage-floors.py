#!/usr/bin/env python3
"""Grade the UI coverage report against the Ui floors in coverage-floors.json.

WHY THIS EXISTS
---------------
ui/vite.config.ts produced a coverage report and nothing ever read it. The
reporters have been writing coverage/ui/coverage-summary.json for months, and a
grep for a consumer returns only the two scripts that GENERATE it -- the
shape coverage-floors.json already names as the defect it exists to close:
"A report nobody reads cannot fire."

The target numbers that did exist were not a ratchet and had gone stale in the
safe direction. docs/records/benchmarks/coverage-report-2026-07-20.md set
Lines >= 50%, Branches >= 40%, Functions >= 50%. Nothing enforced them, and by
2026-10-28 the code sits at 87.71 / 78.02 / 82.70. A threshold the code clears
by 35 points is not a threshold; it is a comment.

WHY A SEPARATE CHECKER RATHER THAN A MODE OF verify-coverage-floors.py
-----------------------------------------------------------------------
That script reads a cargo-llvm-cov report keyed by CRATE and grades line
coverage per crate; it has no notion of statements, functions or branches
because rustc coverage does not report them this way. This reads vitest v8
coverage-summary.json, keyed by metric with four dimensions. Different input,
different shape, different failure mode -- the same reason
check-client-type-drift.py is not a mode of check-api-surface.py.

STABILITY, MEASURED BEFORE THE FLOOR WAS CHOSEN
-----------------------------------------------
Two consecutive full runs on 2026-10-28 produced identical percentages in all
four metrics (delta 0.00), so the report is deterministic and a two-point floor
cannot fire on run-to-run noise. That measurement is why the floors sit two
points below the measured value rather than, say, one: the margin is for code
churn, not for jitter.

HOW IT GRADES
-------------
Each of the four metrics in coverage-summary.json total.pct is compared with
its floor in coverage-floors.json ui_floors. A metric BELOW its floor is a
finding. Missing metric in the report is a finding too -- an absent number must
not read as a passing one.

Exit codes follow the house law: 0 = graded and every metric at or above its
floor, 1 = a metric below its floor, 2 = an input would not open or parse (a
refusal is not a verdict, and a missing report is not a 0% report).

WHAT IT DOES NOT CLAIM
----------------------
It grades the AGGREGATE, not per-file coverage. A single feature could fall to
zero while the total holds, and this check would not see it -- perFile floors
would need a measured baseline per file, which nobody has agreed to. It also
cannot see e2e-only flows (login, payments, shifts) covered by Playwright and
not vitest; those are excluded from the numerator by construction, not by
choice.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUMMARY = ROOT / "coverage" / "ui" / "coverage-summary.json"
DEFAULT_FLOORS = ROOT / "scripts" / "coverage-floors.json"
METRICS = ("lines", "statements", "functions", "branches")


def load_floors(path: Path) -> dict[str, float]:
    """The ui_floors map. A missing or malformed key is a refusal, not a zero floor."""
    data = json.loads(path.read_text(encoding="utf-8"))
    floors = data.get("ui_floors")
    if not isinstance(floors, dict) or not floors:
        raise ValueError(f"{path} has no ui_floors map")
    return {k: float(v) for k, v in floors.items()}


def measured(summary: dict) -> dict[str, float]:
    """total.pct per metric."""
    total = summary.get("total")
    if not isinstance(total, dict):
        raise ValueError("coverage-summary.json has no total block")
    out = {}
    for m in METRICS:
        block = total.get(m)
        if not isinstance(block, dict) or "pct" not in block:
            raise ValueError(f"missing total.{m}.pct")
        out[m] = float(block["pct"])
    return out


def grade(summary: dict, floors: dict[str, float]) -> tuple[int, list[str]]:
    """0 and no findings when every metric clears its floor."""
    got = measured(summary)
    findings = []
    for m in METRICS:
        floor = floors.get(m)
        if floor is None:
            findings.append(f"metric {m} has no floor in coverage-floors.json ui_floors")
            continue
        if got[m] < floor:
            findings.append(f"{m} {got[m]:.2f}% is below its floor {floor:.1f}%")
    return (1 if findings else 0), findings


def _summary(pct: dict[str, float]) -> dict:
    """A minimal coverage-summary.json for the self-test."""
    return {"total": {m: {"pct": pct[m]} for m in METRICS}}


def self_test() -> int:
    """Prove the check fires on a shortfall and stays quiet when the floors are met."""
    floors = {"lines": 85.7, "statements": 83.1, "functions": 80.7, "branches": 76.0}
    failures = 0
    above = {"lines": 87.71, "statements": 85.10, "functions": 82.70, "branches": 78.02}
    code, findings = grade(_summary(above), floors)
    if code != 0 or findings:
        print(f"FAIL self-test: the real measurement was rejected: {findings}", file=sys.stderr)
        failures += 1
    # one metric below, the rest above -> must fire and name ONLY that metric
    below = dict(above); below["branches"] = 70.0
    code, findings = grade(_summary(below), floors)
    if code != 1 or len(findings) != 1 or "branches" not in findings[0]:
        print(f"FAIL self-test: a single shortfall was not isolated: {findings}", file=sys.stderr)
        failures += 1
    # exactly on the floor is a pass: the floor is inclusive
    exact = {m: floats for m, floats in floors.items()}
    code, findings = grade(_summary(exact), floors)
    if code != 0:
        print(f"FAIL self-test: a metric exactly at its floor was rejected: {findings}", file=sys.stderr)
        failures += 1
    # a missing metric must not read as a passing one
    broken = _summary(above)
    del broken["total"]["branches"]
    try:
        grade(broken, floors)
        print("FAIL self-test: a report with no branches number graded clean", file=sys.stderr)
        failures += 1
    except ValueError:
        pass
    # load_floors() -- the only function that touches disk, and it had no case: every
    # grade() case above builds its floors inline, so the sabotage sweep found it SURVIVED
    # on 2026-11-06. A body of `return {}` would have passed every metric vacuously.
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        good = Path(tmp) / "floors.json"
        good.write_text(json.dumps({"ui_floors": {"lines": 85.7, "branches": 76}}), encoding="utf-8")
        if load_floors(good) != {"lines": 85.7, "branches": 76.0}:
            print(f"FAIL self-test: load_floors() misread a ui_floors manifest: {load_floors(good)}", file=sys.stderr)
            failures += 1
        # A manifest with no ui_floors map must refuse, not read as "no metric is gated".
        for label, body in (("absent", {}), ("empty", {"ui_floors": {}}),
                            ("not a map", {"ui_floors": [1, 2]})):
            bad = Path(tmp) / f"{label.replace(' ', '-')}.json"
            bad.write_text(json.dumps(body), encoding="utf-8")
            try:
                load_floors(bad)
                print(f"FAIL self-test: a {label} ui_floors manifest graded clean", file=sys.stderr)
                failures += 1
            except ValueError:
                pass
    if failures:
        print(f"self-test: {failures} FAILURE(S)", file=sys.stderr)
        return 1
    print("self-test: OK (8 cases -- real measurement passes, one shortfall fires, an exact"
          " floor passes, an absent metric refuses, and load_floors() reads a real manifest"
          " while refusing one that declares no ui_floors)")
    return 0

def main() -> int:
    """Grade the report against the floors."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    ap.add_argument("--floors", type=Path, default=DEFAULT_FLOORS)
    ap.add_argument("--self-test", action="store_true")
    ns = ap.parse_args()
    if ns.self_test:
        return self_test()
    try:
        floors = load_floors(ns.floors)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the floors manifest {ns.floors}: {e}", file=sys.stderr)
        return 2
    try:
        summary = json.loads(ns.summary.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the coverage summary {ns.summary}: {e}", file=sys.stderr)
        print("  Generate one with: cd ui && npm run test:coverage", file=sys.stderr)
        return 2
    try:
        code, findings = grade(summary, floors)
    except ValueError as e:
        print(f"FAIL  {ns.summary} is not a usable coverage summary: {e}", file=sys.stderr)
        return 2
    got = measured(summary)
    for m in METRICS:
        mark = "ok  " if got[m] >= floors[m] else "FAIL"
        print(f"  {mark}  {m:11s} {got[m]:6.2f}%  (floor {floors[m]:.1f}%)")
    if code:
        print(f"\nFAIL: {len(findings)} metric(s) below the UI coverage floors", file=sys.stderr)
        for f in findings:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("ui-coverage-floors: OK (every metric at or above its floor)")
    return 0


if __name__ == "__main__":
    sys.exit(main())