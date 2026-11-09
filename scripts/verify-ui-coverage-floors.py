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
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUMMARY = ROOT / "coverage" / "ui" / "coverage-summary.json"
DEFAULT_FLOORS = ROOT / "scripts" / "coverage-floors.json"
METRICS = ("lines", "statements", "functions", "branches")

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root() -> str | None:
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


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

    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
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

    # r184: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying BOTH inputs, the r166..r183 pattern. The missing-summary case
    # is the redirect kill: a main that ignored root would grade the REAL
    # summary (which exists) and return 0 where the fixture demands 2.
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    def _shell(files, argv=None):
        with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                           ignore_cleanup_errors=True) as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[] if argv is None else argv, root=base)
            return rc, out.getvalue() + err.getvalue()
    FL = json.dumps({"ui_floors": {"lines": 50, "statements": 50,
                                   "functions": 50, "branches": 50}})
    SUM_OK = json.dumps({"total": {m: {"pct": 60.0} for m in METRICS}})
    SUM_LOW = json.dumps({"total": {m: {"pct": 40.0 if m == "branches" else 60.0}
                                    for m in METRICS}})
    shell += 1
    rc, text = _shell({"scripts/coverage-floors.json": FL,
                       "coverage/ui/coverage-summary.json": SUM_OK})
    if rc != 0 or "OK (every metric" not in text:
        print(f"  x a fixture at its floors must exit 0 (rc={rc} text={text[-80:]!r})", file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"scripts/coverage-floors.json": FL,
                       "coverage/ui/coverage-summary.json": SUM_LOW})
    if rc != 1 or "branches" not in text:
        print(f"  x a shortfall must exit 1 naming the metric (rc={rc} text={text[-80:]!r})", file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"scripts/coverage-floors.json": FL})
    if rc != 2 or "cannot read the coverage summary" not in text:
        print(f"  x a missing summary must refuse with exit 2 (rc={rc} text={text[-80:]!r})", file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"coverage/ui/coverage-summary.json": SUM_OK,
                       "scripts/coverage-floors.json": json.dumps({})})
    if rc != 2 or "cannot read the floors manifest" not in text:
        print(f"  x floors without a ui_floors map must refuse rc 2 (rc={rc})", file=sys.stderr)
        return 1
    print(f"  shell: {shell} case(s) behave through main()")
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r236 -- the r228 lesson).

    Rung 6 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. The guard turns it into a printed skip.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r236: the root contract, graded on fixture trees through main().

    The summary path is the dangerous one, because unlike the other checkers
    in this arc the real checkout's summary EXISTS. A main() that ignored its
    root would grade this repository's own report against the fixture's
    floors and return a plausible verdict instead of refusing -- which is why
    rung 1 is not "a shortfall fires" but "a fixture with NO summary must
    refuse exit 2", the arm that cannot be satisfied by reading the real tree.

    Rungs also pin what an EXPLICIT --summary/--floors does under a root, the
    override the docstring promises but no case reached before this round.
    """
    import contextlib
    import tempfile

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} files."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
        return base

    FLOORS = json.dumps({"ui_floors": {"lines": 50, "statements": 50,
                                       "functions": 50, "branches": 50}})
    SUM_OK = json.dumps({"total": {m: {"pct": 60.0} for m in METRICS}})
    SUM_LOW = json.dumps({"total": {m: {"pct": 40.0 if m == "branches" else 60.0}
                                   for m in METRICS}})

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: no summary under the fixture root must
        # REFUSE, which a root-ignoring main cannot do (the real one exists).
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS})
        rc, said = run(root)
        if rc != 2 or "cannot read the coverage summary" not in said:
            print("  x rung 1: a fixture without a summary must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a summary that exists but carries no total block refuses.
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS,
                           "coverage/ui/coverage-summary.json": "{}"})
        rc, said = run(root)
        if rc != 2 or "not a usable coverage summary" not in said:
            print("  x rung 2: a summary without a total block must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- floors without a ui_floors map refuse, naming the manifest.
        root = build(tmp, {"scripts/coverage-floors.json": json.dumps({}),
                           "coverage/ui/coverage-summary.json": SUM_OK})
        rc, said = run(root)
        if rc != 2 or "cannot read the floors manifest" not in said:
            print("  x rung 3: floors without ui_floors must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- a fixture at its floors greens, graded from the FIXTURE.
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS,
                           "coverage/ui/coverage-summary.json": SUM_OK})
        rc, said = run(root)
        if rc != 0 or "OK (every metric" not in said:
            print("  x rung 4: a fixture at its floors must exit 0 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- one shortfall fires, naming ONLY the metric that fell.
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS,
                           "coverage/ui/coverage-summary.json": SUM_LOW})
        rc, said = run(root)
        if rc != 1 or "branches" not in said or "lines" not in said:
            print("  x rung 5: a shortfall must exit 1 naming the metric "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS,
                           "coverage/ui/coverage-summary.json": SUM_OK})
        rc, said = run(root, "--self-test")
        if rc != 0 or "self-test: OK" not in said or "ladder re-entry" not in said:
            print("  x rung 6: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 7 -- an explicit --summary wins over the fixture root, as promised.
        elsewhere = build(tmp, {"rep.json": SUM_LOW}, label="rep")
        root = build(tmp, {"scripts/coverage-floors.json": FLOORS,
                           "coverage/ui/coverage-summary.json": SUM_OK})
        rc, said = run(root, "--summary", str(elsewhere / "rep.json"))
        if rc != 1:
            print("  x rung 7: an explicit --summary must override the root's default "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("UI-COVERAGE-FLOORS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0

def main(argv=None, root=None) -> int:
    """Grade the report against the floors. r184: argv and root parameterized,
    the r166..r183 contract -- root redirects BOTH default inputs (the summary
    and the floors) together; an explicit --summary/--floors still wins."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--summary", type=Path, default=None)
    ap.add_argument("--floors", type=Path, default=None)
    ap.add_argument("--self-test", action="store_true")
    ns = ap.parse_args(argv)
    if ns.self_test:
        return self_test()
    base = ROOT if root is None else Path(root).resolve()
    summary_path = ns.summary if ns.summary is not None else base / "coverage" / "ui" / "coverage-summary.json"
    floors_path = ns.floors if ns.floors is not None else base / "scripts" / "coverage-floors.json"
    try:
        floors = load_floors(floors_path)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the floors manifest {floors_path}: {e}", file=sys.stderr)
        return 2
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the coverage summary {summary_path}: {e}", file=sys.stderr)
        print("  Generate one with: cd ui && npm run test:coverage", file=sys.stderr)
        return 2
    try:
        code, findings = grade(summary, floors)
    except ValueError as e:
        print(f"FAIL  {summary_path} is not a usable coverage summary: {e}", file=sys.stderr)
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