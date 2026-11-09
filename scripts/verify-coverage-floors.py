"""Fail when a crate's measured line coverage drops below its recorded floor.

Why this exists.  `scripts/coverage.sh` produces a report and enforces nothing:
it prints a percentage and exits 0 whatever the number is.  So the repo has had
coverage *instrumentation* for a long time and no coverage *gate*, and the
distinction matters -- a report nobody reads cannot fire.  `todo-codebase-
reliability.md` P1-2 records the same gap, and its own text supplies the rule
this script obeys: "an unrecorded threshold is not a threshold".

What the floor IS, and is not.  A ratchet, not a target.  Each floor sits two
percentage points below the value measured on 2026-09-27, so the gate freezes
the level reached and fires on a regression, without demanding work nobody
agreed to fund.  A gate set to an aspirational number goes red on day one, and
a gate that is red on day one is a gate people learn to ignore.

Why PER-CRATE rather than one workspace figure.  P1-2 says it outright: "a
global average hides the crates that matter".  Measured at the same time:
foundation 99.4%, kasirmu-core 83.8%, modules-inventory 78.4%,
platform-sync 68.7% (workspace 73.9%).  A single 70% floor would pass with
platform-sync -- the crate this checklist calls the highest-risk surface --
falling a full point, because foundation's 99.4% would carry it.

What this does NOT do.  It does not run coverage; `cargo llvm-cov` does, and it
aborts on ANY failing test, so coverage is coupled to suite greenness by
construction (measured 2026-09-27: an unrelated in-flight test failure in
kasirmu-bridge aborted a workspace run).  This script only grades a JSON report
that a prior run produced, which keeps the gate cheap, offline and testable.

Run:
    python scripts/verify-coverage-floors.py                    # uses coverage-probe.json
    python scripts/verify-coverage-floors.py --json path.json   # grade a specific report
    python scripts/verify-coverage-floors.py --self-test        # prove both directions
Exit 0 = every named crate at or above its floor, 1 = a crate below, missing, or
the report unreadable.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Where fixture trees are written when the host sets a temp variable (a confined
#: host denies its default temp); unset leaves tempfile's own default in force.
#: NEVER point these at a directory inside the checkout. The root handed to main()
#: decides where the default report and floors are read from, so a temp root under
#: the repo would put fixtures in a subdirectory of this repository -- a tree whose
#: absence of a real non-repo refusal reads as a pass -- and every rung that grades
#: resolution would silently grade nothing.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures go under (None = system default), created."""
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


FLOORS_PATH = ROOT / "scripts" / "coverage-floors.json"
DEFAULT_REPORT = ROOT / "coverage-probe.json"

# The report is keyed on repository-relative path prefixes. Kept beside the
# floors so a crate that moves is one edit, not two.
CRATE_PREFIXES = {
    "foundation": "foundation/",
    "kasirmu-core": "crates/kasirmu-core/",
    "modules-inventory": "modules/inventory/",
    "platform-sync": "platform/sync/",
}


def load_floors(path: Path) -> dict[str, float]:
    """Read the recorded floors, refusing a manifest with none."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    floors = doc.get("floors") or {}
    if not floors:
        raise ValueError(f"{path} declares no floors")
    return {k: float(v) for k, v in floors.items()}


def crate_line_pct(report: dict, prefix: str) -> tuple[float, int, int] | None:
    """Line coverage for one crate prefix, or None when nothing matched.

    Returns (percent, covered, total). None is deliberately distinct from 0.0:
    a crate whose files vanished from the report is a different failure from a
    crate that is merely uncovered, and conflating them would report an empty
    measurement as a catastrophic one.

    Summing covered/total across files rather than averaging per-file
    percentages is what makes a large uncovered file count proportionally. A
    mean-of-percentages would weight a 5-line file the same as a 5000-line one.
    """
    covered = 0
    total = 0
    matched = 0
    for f in report["data"][0].get("files", []):
        p = f["filename"].replace("\\", "/")
        if p.startswith(prefix) or f"/{prefix}" in p:
            matched += 1
            lines = f["summary"]["lines"]
            covered += lines["covered"]
            total += lines["count"]
    if matched == 0 or total == 0:
        return None
    return (100.0 * covered / total, covered, total)


def grade(report: dict, floors: dict[str, float]) -> tuple[int, list[str]]:
    """Grade a report against the floors. Returns (exit_code, messages)."""
    messages: list[str] = []
    failed = False

    for crate in sorted(floors):
        prefix = CRATE_PREFIXES.get(crate)
        if prefix is None:
            messages.append(
                f"FAIL  {crate}: a floor is recorded but CRATE_PREFIXES has no "
                f"path for it, so it was never measured"
            )
            failed = True
            continue

        measured = crate_line_pct(report, prefix)
        if measured is None:
            messages.append(
                f"FAIL  {crate}: no files under {prefix!r} in the report -- "
                f"either the crate moved or the report is from a partial run"
            )
            failed = True
            continue

        pct, covered, total = measured
        floor = floors[crate]
        if pct + 1e-9 < floor:
            shortfall = floor - pct
            messages.append(
                f"FAIL  {crate}: {pct:.1f}% < floor {floor:.1f}% "
                f"({covered}/{total} lines, short by {shortfall:.1f} points)"
            )
            failed = True
        else:
            messages.append(f"ok    {crate}: {pct:.1f}% >= {floor:.1f}%")

    # A workspace figure is reported, never gated -- it is context for the
    # reader, and gating it would reintroduce the masking P1-2 warns about.
    all_cov = sum(f["summary"]["lines"]["covered"] for f in report["data"][0]["files"])
    all_tot = sum(f["summary"]["lines"]["count"] for f in report["data"][0]["files"])
    if all_tot:
        messages.append(
            f"      workspace total: {100.0 * all_cov / all_tot:.1f}% "
            f"({all_cov}/{all_tot} lines) -- informational, not gated"
        )

    return (1 if failed else 0), messages


# ── Self-test: both directions, on synthetic reports ─────────────────

def _report(entries: dict[str, tuple[int, int]]) -> dict:
    """Build a minimal llvm-cov-shaped report from {path: (covered, count)}."""
    return {
        "data": [
            {
                "files": [
                    {
                        "filename": path,
                        "summary": {"lines": {"count": count, "covered": cov}},
                    }
                    for path, (cov, count) in entries.items()
                ]
            }
        ]
    }


def self_test(*, _ladder_owner=None) -> int:
    """Prove the gate fires on a shortfall and stays quiet when satisfied.

    A gate proven only in the pass direction is decoration. Each case below
    plants the failure it must catch.

    The ladder tail is OWNED by the first caller only. Rung 5 runs this whole
    function inside the outer ladder; if it owned the tail too, the nested
    ladder would be silent for the wrong reason and a DROPPED top-level call
    would be indistinguishable from a guarded nested one -- the r263 shape,
    one level down. _ladder_owner separates the two; nothing else does.

    _ladder_owner=None (the default) means "I do not know who my caller is", and
    then the GUARD decides: if a ladder is already running this call is the nested
    one and hands its tail back, and if not it owns the ladder. A literal default
    of False was measured 2026-11-09 to make the top-level --self-test skip its own
    ladder entirely, while rung 5 stayed green because the guard was never asked.
    main() states True explicitly, because main() is never inside a ladder.
    """
    # Aliased so the names cannot shadow the module imports at the top of this
    # file; the fixtures below reuse them under both entry paths.
    import contextlib as _ctx
    import io as _io
    import tempfile
    if _ladder_owner is None:
        _ladder_owner = not _LADDER_RUNNING
    failures: list[str] = []

    def expect(label: str, cond: bool) -> None:
        print(f"  {'ok  ' if cond else 'FAIL'}  {label}")
        if not cond:
            failures.append(label)

    floors = {"foundation": 97.0, "platform-sync": 66.0}

    # (1) everything comfortably above its floor -> exit 0.
    healthy = _report(
        {
            "foundation/src/a.rs": (980, 1000),      # 98%
            "platform/sync/src/b.rs": (700, 1000),   # 70%
        }
    )
    code, msgs = grade(healthy, floors)
    expect("a healthy report exits 0", code == 0)
    expect("  ...and says so per crate", any("ok    foundation" in m for m in msgs))
    expect(
        "  ...and reports the workspace total as informational, ungated",
        any("not gated" in m for m in msgs),
    )

    # (2) a crate below its floor -> exit 1, and the message NAMES it.
    regressed = _report(
        {
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (600, 1000),   # 60% < 66
        }
    )
    code, msgs = grade(regressed, floors)
    expect("a crate below its floor exits 1", code == 1)
    expect("  ...and the shortfall names the crate", any("FAIL  platform-sync" in m for m in msgs))
    expect("  ...and states the shortfall", any("short by" in m for m in msgs))
    expect(
        "  ...and the OTHER crate still reports ok, so blame is not global",
        any("ok    foundation" in m for m in msgs),
    )

    # (3) a crate absent from the report -> exit 1, distinguished from 0%.
    partial = _report({"foundation/src/a.rs": (980, 1000)})
    code, msgs = grade(partial, floors)
    expect("a crate missing from the report exits 1", code == 1)
    expect(
        "  ...and says it was not measured, not that it is uncovered",
        any("no files under" in m for m in msgs),
    )

    # (4) the workspace average CANNOT carry a failing crate. This is the
    #     masking P1-2 warns about: foundation at 99% would lift a 60%
    #     platform-sync well past any single workspace floor of ~70%.
    mixed = _report(
        {
            "foundation/src/a.rs": (9900, 10000),    # 99%
            "platform/sync/src/b.rs": (600, 1000),   # 60%
        }
    )
    workspace_pct = 100.0 * (9900 + 600) / (10000 + 1000)
    code, _ = grade(mixed, floors)
    expect(
        f"a {workspace_pct:.0f}% workspace average still fails the 60% crate",
        workspace_pct > 90.0 and code == 1,
    )

    # (5) a floor recorded with no path mapping is a silent hole -> must fail.
    code, msgs = grade(healthy, {"foundation": 97.0, "ghost-crate": 50.0})
    expect("a floor with no CRATE_PREFIXES entry exits 1", code == 1)
    expect(
        "  ...and names the unmapped crate rather than skipping it",
        any("ghost-crate" in m and "never measured" in m for m in msgs),
    )

    # (6) a weight-sensitive check: summing must not become averaging.
    #     One 10-line file at 100% must NOT offset a 1000-line file at 60%.
    skewed = _report(
        {
            "foundation/tiny.rs": (10, 10),
            "platform/sync/big.rs": (600, 1000),
        }
    )
    code, _ = grade(skewed, {"platform-sync": 66.0})
    expect("many small covered lines cannot mask one large uncovered file", code == 1)

    # (7) load_floors() -- the one function that touches disk. Every case above hands
    #     grade() a dict literal, so this had no case at all and the sabotage sweep found
    #     it SURVIVED on 2026-11-06: a body replaced by `return {}` would have gated every
    #     crate against nothing. It takes a path, so the fixture is a temp file.
    # The fixtures go under fixture_root() (rule TMP_ENV at the top of this file),
    # the same root the ladder's fixtures use: one rule for both.
    tmp = tempfile.mkdtemp(dir=fixture_root())
    try:
        manifest = Path(tmp) / "floors.json"
        manifest.write_text(
            json.dumps({"floors": {"foundation": 97.0, "platform-sync": 66}}), encoding="utf-8")
        expect("load_floors() reads a manifest and coerces every floor to float",
               load_floors(manifest) == {"foundation": 97.0, "platform-sync": 66.0})
        empty = Path(tmp) / "no-floors.json"
        empty.write_text(json.dumps({"floors": {}}), encoding="utf-8")
        try:
            load_floors(empty)
            expect("a manifest declaring no floors is refused", False)
        except ValueError:
            expect("a manifest declaring no floors is refused, not read as 'nothing to gate'", True)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    # r197: the shell -- main() graded through argv and a contract root, the
    # r166..r196 pattern (runs BEFORE the summary, so its refusals are
    # counted like any other case). The fixtures are RELATIVE names plus
    # root: a root-dropping main resolves them against the repo and
    # refuses on a report that does not exist there, which is the kill.
    # OWNER only: rung 5 runs this whole function inside the outer ladder.
    if _ladder_owner:
        from pathlib import Path as _Path
        import tempfile as _tempfile
        shell = 0
        FLOORS_DOC = json.dumps({"floors": {"foundation": 97.0, "platform-sync": 66.0}})
        HEALTHY = _report({"foundation/src/a.rs": (980, 1000), "platform/sync/src/b.rs": (700, 1000)})
        REGRESSED = _report({"foundation/src/a.rs": (980, 1000), "platform/sync/src/b.rs": (600, 1000)})
        with _tempfile.TemporaryDirectory() as tmp:
            base = _Path(tmp)
            def run(*extra):
                out, err = _io.StringIO(), _io.StringIO()
                try:
                    with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                        rc = main(argv=list(extra), root=base)
                except SystemExit as se:
                    return se.code, out.getvalue() + err.getvalue()
                return rc, out.getvalue() + err.getvalue()
            # (S1) the DEFAULT paths resolve under the root: no argv paths at all
            shell += 1
            (base / "scripts").mkdir(parents=True, exist_ok=True)
            (base / "scripts" / "coverage-floors.json").write_text(FLOORS_DOC, encoding="utf-8")
            (base / "coverage-probe.json").write_text(json.dumps(HEALTHY), encoding="utf-8")
            rc, text = run()
            if rc != 0 or "coverage floors: OK." not in text:
                print("  x default report+floors under the root must grade OK (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1
            # (S2) RELATIVE argv paths follow the root too, and a regression fails
            shell += 1
            (base / "probe-bad.json").write_text(json.dumps(REGRESSED), encoding="utf-8")
            rc, text = run("--json", "probe-bad.json", "--floors", "scripts/coverage-floors.json")
            if rc != 1 or "FAIL  platform-sync" not in text or "coverage floors: FAIL" not in text:
                print("  x a relative regression report must fail naming the crate (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1
            # (S3) a missing report is a named refusal, not a crash
            shell += 1
            rc, text = run("--json", "absent.json")
            if rc != 1 or "cannot read the coverage report" not in text:
                print("  x a missing report must be refused with the regen command (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1
            # (S4) an empty report reads as a broken run, not 0% everywhere
            shell += 1
            (base / "probe-empty.json").write_text(json.dumps({"data": []}), encoding="utf-8")
            rc, text = run("--json", "probe-empty.json")
            if rc != 1 or "contains no measured files" not in text:
                print("  x an empty report must fail as a broken run (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1
            # (S5) a missing floors manifest refuses with the manifest path
            shell += 1
            rc, text = run("--floors", "no-floors.json")
            if rc != 1 or "cannot read the floors manifest" not in text:
                print("  x a missing floors manifest must be refused (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1
            # (S6) a manifest declaring no floors is the same refusal
            shell += 1
            (base / "shallow.json").write_text(json.dumps({"floors": {}}), encoding="utf-8")
            rc, text = run("--floors", "shallow.json")
            if rc != 1 or "cannot read the floors manifest" not in text:
                print("  x a floor-less manifest must be refused (rc=%r text=%r)"
                      % (rc, text[-90:]), file=sys.stderr)
                return 1

    print()
    if failures:
        print(f"self-test: FAIL ({len(failures)})")
        return 1
    print("self-test: all cases passed -- fires on a shortfall, quiet when met, "
          "and a workspace average cannot carry a failing crate")
    print(f"self-test: main() shell graded ({shell} cases through argv and root)")
    # NO global reset here. Measured 2026-11-09: clearing _LADDER_RUNNING on the
    # owner path let rung 5's nested --self-test clear the flag OUTER had set and
    # the run died with RecursionError. A convention that needs the CALLEE to know
    # its caller is the defect; main() names the owner explicitly instead, and
    # only shell_ladder() writes the flag.
    # r197: the rung list is in shell_ladder() below and is returned as the LAST
    # thing this function does, so --self-test RUNS it (the r263 shape: a ladder
    # that is only DEFINED is a ladder nothing runs). Only the OWNER runs it: the
    # nested --self-test in rung 5 hands the tail back, because the guard below
    # (not a second switch) is what must silence it. The guard is never reset in
    # self_test() -- doing that let rung 5 re-enter forever (measured 2026-11-09:
    # RecursionError, not a verdict).
    return shell_ladder() if _ladder_owner else 0


def drive_self_test() -> int:
    """self_test() AS THE OUTERMOST CALLER: the whole case list AND the ladder.

    scripts/prove-ladder-kills.py loads a mutant as a fresh module and calls its
    shell_ladder(); this is the entry for a caller that wants the cases too. It
    cannot route 'owner' back into self_test(): that is the recursion the guard
    exists to stop (measured 2026-11-09), so the owner path IS self_test(), and
    this function only states the name a caller may look for.
    """
    return self_test()


#: Re-entry guard (the r228 pattern): rung 5 drives a nested --self-test through
#: main(), whose self-test arm ends in shell_ladder(). Without the guard that
#: nested run starts a SECOND ladder recursively.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard: a nested self-test (rung 5) must not run a second ladder.

    The guard lives HERE and not in self_test(), measured 2026-11-09: rung 5 runs
    self_test() inside the OUTER ladder, so the flag set by the outer call is
    still set when the nested one arrives -- the nested ladder returns 0 and
    prints nothing, which is what rung 5 wants. (The first draft put the flag in
    self_test() instead and a reset inside self_test() handed the nested call a
    CLEARED flag; the run died with RecursionError rather than a verdict.)

    SHELL_LADDER() IS NOT A STANDALONE TEST ENTRY. Called by itself -- which is
    what scripts/prove-ladder-kills.py does to a mutant -- it has no owner above
    it, so rung 5's nested --self-test is guarded and rung 5 hands its tail back.
    self_test(_ladder_owner=True) is the standalone entry: main() uses it, and a
    ladder reached that way re-enters itself silently, which is the rung 5 case.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        # SILENT, and load-bearing: anything printed here lands in the nested
        # run's captured streams.
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """Grade main()'s ROOT seam on throwaway trees that live OUTSIDE this repo.

    main() resolves its two inputs -- the floors manifest and the coverage report
    -- through one line in main(), the root seam. That line is what is graded: every
    rung hands main() a fixture root and reads the verdict off BOTH captured
    streams, and no rung reaches into grade() or load_floors() directly.

    THIS FUNCTION DOES NOT SHELL OUT. A previous checker in this arc guarded its
    ladder with `git -C <root> ls-files`; that is what makes a temp root INSIDE
    the checkout answer 0 entries at exit 0 where a real non-repo answers 128.
    This one reads files through main() only, so there is no such exit code to
    mistake for a result -- measured 2026-11-09, not assumed.

    WHAT IS GRADED.
      * rung 1  the KILLING rung: a fixture whose DEFAULT paths (relative to the
                root) hold a healthy report must grade OK. A main() that resolves
                against ROOT instead reads this checkout, where coverage-probe.json
                does not exist, and refuses -- so the rung fails on the SCOPE
                REFUSAL a root-blind main produces, not on an accident.
      * rung 2  the opposite direction: the same default paths holding a
                REGRESSED report must fail rc 1 naming platform-sync, i.e. it
                reads the fixture it was handed and not the one before it.
      * rung 3  RELATIVE argv paths follow the root too.
      * rung 4  an ABSOLUTE --json outside the root still wins over the root, so
                the seam is a default rather than a cage.
      * rung 5  --self-test through argv: it must exit 0 either way (the nested
                ladder runs and the guard holds, or the guard is already held from
                outside and the nested tail hands back), print no traceback, and
                report no failing case. Its rung count is therefore "as high as
                it got": under the standalone owner this is a GUARDED ladder and
                prints no LADDER OK, so the success line here has to be the
                rung-5 case's own line. That is written down because
                prove-ladder-kills.py reports rc=0 NOT-PROVEN for exactly this.
                MEASURED 2026-11-09, both ways: run by itself (what a mutant
                sees) the ladder is UNGUARDED at entry, rung 5's nested ladder is
                guarded and silent, and rung 5 passes scoring the guard's effect;
                reaching it the way main() does, the guard answers rung 5 first and
                the rung passes on the tail hand-back.

    WHAT IT DOES NOT PROVE. Nothing here shells out to git, so a temp root inside
    the checkout cannot turn a fixture's default paths into this repository's
    ones only by accident -- but the fixtures still go under fixture_root(), per
    this file's rule, because a fixture under the repo would be indistinguishable
    from part of it to anyone reading a failure. scripts/prove-ladder-kills.py
    runs the root-blind mutant; this note is not the proof.
    """

    shell = 0
    FLOORS_DOC = json.dumps({"floors": {"foundation": 97.0, "platform-sync": 66.0}})
    # Fixture-relative names nothing in this repository has, so a verdict that
    # NAMES one cannot have come from a scan of the real tree.
    DEFAULT_REPORT = "coverage-probe.json"
    BAD_REPORT = "zz-fixprobe/regressed.json"
    ABS_REPORT = "zz-fixprobe/absolute.json"
    GONE = "zz-fixprobe/absent.json"

    def build(base, files):
        """A fixture at `base`: {relative PATH -> CONTENT}, parents created."""
        base = Path(base)
        base.mkdir(parents=True, exist_ok=True)
        for rel, content in files.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            io.open(dst, "w", encoding="utf-8", newline="\n").write(content)
        return base

    def grade(base, argv=()):
        """(rc, everything main() printed to either stream)."""
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            try:
                rc = main(argv=list(argv), root=base)
            except SystemExit as se:
                rc = se.code
        return rc, out.getvalue() + err.getvalue()

    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        base = Path(td)
        floors_doc = {"scripts/coverage-floors.json": FLOORS_DOC}

        # rung 1 -- the KILLING rung, and it must die on a VERDICT.
        #
        # The first draft of this rung passed a HEALTHY fixture report and asked
        # for "coverage floors: OK." while forbidding the words "cannot read".
        # A root-blind mutant then read THIS checkout, found no coverage-probe.json
        # there, and failed on the SCOPE REFUSAL -- which is not the defect being
        # graded. Measured 2026-11-09 on the mutant: rc=1 said='... --json
        # --output-path C:...' i.e. the "generate one with" refusal. Per this arc's
        # rule a mutation that dies on a scope refusal proves nothing about rung 1.
        #
        # So the fixture carries a REGRESSED report at the default path and the
        # rung asks for the FAIL VERDICT naming the fixture's own crate. Both
        # readings now reach the grading code -- the correct one reads the
        # fixture, a root-blind one reads this checkout -- and only the correct
        # root produces the named verdict. A refusal is explicitly NOT a pass.
        one = build(base / "one", dict(floors_doc, **{DEFAULT_REPORT: json.dumps(_report({
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (600, 1000)}))}))
        rc, said = grade(one)
        if (rc != 1
                or "FAIL  platform-sync" not in said
                or "coverage floors: FAIL" not in said
                or "cannot read" in said):
            print("  x rung 1: the FIXTURE's own regressed default report must be "
                  "VERDICTED rc 1 naming platform-sync -- a root-blind main reads "
                  "this checkout instead and refuses (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 2 -- the POSITIVE floor: the same default paths holding a HEALTHY
        # report must grade OK. Rung 1 now kills on a regression, so an arm that
        # simply always answers rc 1 passes rung 1 and dies here.
        two = build(base / "two", dict(floors_doc, **{DEFAULT_REPORT: json.dumps(_report({
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (700, 1000)}))}))
        rc, said = grade(two)
        if (rc != 0
                or "coverage floors: OK." not in said
                or "ok    platform-sync" not in said
                or "FAIL" in said):
            print("  x rung 2: a healthy report at the default path under the "
                  "fixture root must grade OK (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 3 -- RELATIVE argv paths follow the root.
        three = build(base / "three", dict(floors_doc, **{BAD_REPORT: json.dumps(_report({
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (600, 1000)}))}))
        rc, said = grade(three, ("--json", BAD_REPORT,
                                 "--floors", "scripts/coverage-floors.json"))
        if (rc != 1
                or "FAIL  platform-sync" not in said
                or "cannot read" in said):
            print("  x rung 3: a relative --json/--floors must resolve under the "
                  "fixture root and verdict the crate (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 4 -- an ABSOLUTE report outside the root still wins.
        four = build(base / "four", dict(floors_doc, **{ABS_REPORT: json.dumps(_report({
            "foundation/src/a.rs": (980, 1000),
            "platform/sync/src/b.rs": (600, 1000)}))}))
        rc, said = grade(four, ("--json", str(four / ABS_REPORT)))
        if rc != 1 or "FAIL  platform-sync" not in said:
            print("  x rung 4: an absolute --json must be honoured over the root "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 4b -- a report absent from the root is a named refusal that repeats
        # the ROOT-derived path, so the refusal itself proves which tree was read.
        rc, said = grade(one, ("--json", GONE))
        if (rc != 1
                or "cannot read the coverage report" not in said
                or GONE.replace("/", os.sep) not in said.replace("/", os.sep)
                or str(one) not in said):
            print("  x rung 4b: a missing report must be refused naming a path "
                  "under the FIXTURE root (rc=%r said=%r)" % (rc, said[-400:]),
                  file=sys.stderr)
            return 1
        shell += 1

        # rung 5 -- --self-test through argv, run INSIDE this ladder. MEASURED
        # 2026-11-09, and it is the one place this file's convention is easy to
        # misread: the nested call is inside a running ladder, so the guard takes
        # the hand-back in shell_ladder() BEFORE self_test() decides ownership --
        # the owner flag is never consulted, and requiring the nested "LADDER OK"
        # line here failed a correct run. What this rung can demand is rc 0, every
        # inline case passing and no traceback, plus the nested ladder returning
        # WITHOUT its own success line -- which is what "guard took the hand-back"
        # looks like from outside. A second, UNGUARDED ladder would print one.
        rc, said = grade(one, ("--self-test",))
        if (rc != 0
                or "self-test: all cases passed" not in said
                or "FAIL  " in said
                or "Traceback" in said
                or "LADDER OK" in said):
            print("  x rung 5: --self-test through argv must exit 0, pass every "
                  "inline case and let the guard take the nested ladder's hand-back "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

    print("LADDER OK (%d shell rungs through main(): fixture default paths, "
          "fixture regression, relative argv, absolute argv, missing report, "
          "nested --self-test)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r197: argv and root parameterized, the r166..r196 contract -- the
    default report and floors paths resolve under the contract root, and a
    RELATIVE --json/--floors argument follows it too.

    _ladder_owner=True is the owner statement the ladder guard describes: this
    call is ABOVE the ladder, so the tail of self_test() may run it. The nested
    --self-test in rung 5 arrives through shell_ladder(..), which passes
    owner=False, so the guard is not the only thing standing between the run and
    a second ladder. Root changes where the inputs are read from, nothing else;
    the grading math is untouched."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", type=Path, default=None,
                    help="llvm-cov JSON report to grade (default: <root>/coverage-probe.json)")
    ap.add_argument("--floors", type=Path, default=None,
                    help="floors manifest (default: <root>/scripts/coverage-floors.json)")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the gate fires in both directions, then exit")
    ns = ap.parse_args(argv)
    base = ROOT if root is None else Path(root).resolve()

    def against_base(p):
        q = Path(p) if p is not None else None
        if q is None:
            return None
        return q if q.is_absolute() else base / q

    ns.json = against_base(ns.json) or base / "coverage-probe.json"
    ns.floors = against_base(ns.floors) or base / "scripts" / "coverage-floors.json"

    if ns.self_test:
        return self_test(_ladder_owner=True)

    try:
        floors = load_floors(ns.floors)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FAIL  cannot read the floors manifest {ns.floors}: {e}", file=sys.stderr)
        return 1

    try:
        report = json.loads(ns.json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(
            f"FAIL  cannot read the coverage report {ns.json}: {e}\n"
            f"Generate one with:\n"
            f"  cargo llvm-cov --workspace --all-features \\\n"
            f"    --exclude kasirmu-app --exclude kasirmu-mobile \\\n"
            f"    --exclude kasirmu-bridge \\\n"
            f"    --json --output-path {ns.json}\n"
            f"  kasirmu-bridge is excluded because llvm-cov aborts on any failing\n"
            f"  test, and one in-flight bridge test would cost the whole report\n"
            f"  rather than one crate. The floors never name bridge, so the\n"
            f"  exclusion costs no graded crate -- this matches the command\n"
            f"  recorded in scripts/coverage-floors.json under _measured.",
            file=sys.stderr,
        )
        return 1

    if not report.get("data") or not report["data"][0].get("files"):
        print(
            f"FAIL  {ns.json} contains no measured files -- an empty report "
            f"reads as 0% everywhere, which is a broken run, not a coverage result",
            file=sys.stderr,
        )
        return 1

    code, messages = grade(report, floors)
    for m in messages:
        print(m)
    print()
    if code:
        print(
            "coverage floors: FAIL. If the loss is intended, lower the floor in "
            "scripts/coverage-floors.json and update _measured in the same commit "
            "-- the manifest documents why that must be deliberate."
        )
    else:
        print("coverage floors: OK.")
    return code


if __name__ == "__main__":
    sys.exit(main())
