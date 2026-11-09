#!/usr/bin/env python3
"""verify-selftest-sweep.py -- run EVERY checker's self-test, in one roster.

WHY
===
A checker that declares a --self-test proves it can still fail. A checker whose
self-test no runner invokes proves nothing, and verify-selftests-wired.py exists to
catch that. Between them, one gate knew every flag had a caller and another ran one
checker's cases -- and NOTHING ran the population.

That gap was invisible for a long time because running them is manual: every
verify-self-test sweep before this one was a person typing a command, which means it
happened when someone remembered, and the 2026-09-29 sweep of all 37 scripts/{verify,
check}-*.py found three "failures" that were not failures at all. They were checkers
that declare no --self-test, so argparse rejected the flag with a usage error. A
sweep that cannot tell those two apart is a bad oracle, and a bad oracle teaches its
reader to distrust the sweep.

So this one makes the distinction explicit and structural:

  rc 0        the self-test ran and every case passed
  rc 2        USAGE. The flag was rejected, which for a checker this file has already
              confirmed DECLARES a --self-test means the flag is not reachable -- a real
              defect, reported as its own bucket so it cannot be confused with a case
              failure
  anything    a case failed; the name and the tail of its output are reported

A checker that declares no --self-test is SKIPPED, never run: this file is not the
place to decide whether it ought to have one, and running the flag against it can only
ever produce the usage error that made the earlier sweep unreadable.

Exit 0 every declared self-test passed, 1 at least one did not, 2 nothing was found.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


# THREE DIRECTORIES, THREE EXTENSIONS. Measured 2026-10-24: the sweep covered
# scripts/*.{py,mjs} only -- 65 checkers -- while 24 MORE declared the same flag and
# were never run by it: 7 .sh checkers beside the .py ones, 6 in website/scripts and
# 11 in .agents/skills/docs-auditor/scripts. Its own docstring opens with "run EVERY
# checker's self-test, in one roster", and the roster was a third of the tree. All 24
# passed when run by hand first, so widening it closed a coverage hole without
# reddening anything -- which is the only order that makes a widened scope honest.
CHECKER_DIRS = (
    ROOT / "scripts",
    ROOT / "website" / "scripts",
    ROOT / ".agents" / "skills" / "docs-auditor" / "scripts",
)
#: The same three directories, relative -- r189: the contract root re-derives
#: the roster from these instead of the module-constant absolute paths.
REL_CHECKER_DIRS = ("scripts", "website/scripts", ".agents/skills/docs-auditor/scripts")
CHECKER_RE = re.compile(r"^(?:verify|check)-[A-Za-z0-9_-]+\.(?:py|mjs|sh)$")
DECLARES_RE = re.compile(r"""["']--self-test["']""")


def checkers(root=None) -> list[Path]:
    """r189: the roster follows the contract root -- all three directories
    re-derived together, never half (the r172 half-redirect class)."""
    if root is None:
        bases = CHECKER_DIRS
    else:
        base_root = Path(root).resolve()
        bases = tuple(base_root / d for d in REL_CHECKER_DIRS)
    out: list[Path] = []
    for base in bases:
        if not base.is_dir():
            continue
        out.extend(p for p in base.iterdir()
                   if p.is_file() and CHECKER_RE.match(p.name))
    return sorted(out)


def declares_selftest(path: Path) -> bool:
    try:
        return bool(DECLARES_RE.search(path.read_text(encoding="utf-8", errors="replace")))
    except OSError:
        return False


#: Bare "bash" resolves to WSL on this workstation, which cannot see the Windows tree
#: and exits 127 -- a self-test that never ran, reported as a case failure. Git's bash
#: by full path is the documented rule (AGENTS.md section 5).
GIT_BASH = r"C:\Program Files\Git\bin\bash.exe"


def _interpreter(path: Path) -> list[str]:
    """The command prefix for a checker, by extension."""
    if path.suffix == ".py":
        return ["python3", str(path)]
    if path.suffix == ".mjs":
        return ["node", str(path)]
    return [GIT_BASH, str(path)]


def run(path: Path, cwd: Path | None = None) -> tuple[int, str]:
    cmd = _interpreter(path)
    cmd.append("--self-test")
    try:
        r = subprocess.run(cmd, cwd=ROOT if cwd is None else cwd,
                           capture_output=True, text=True,
                           errors="replace", timeout=600)
    except subprocess.TimeoutExpired:
        return 3, "timed out after 600s"
    except OSError as exc:
        return 4, f"could not run {cmd[0]}: {exc}"
    tail = (r.stdout or "").strip().splitlines()
    text = (r.stdout or "") + (r.stderr or "")
    # USAGE is decided by the OUTPUT, never by the exit code. rc 2 was assumed to mean
    # argparse had rejected the flag, and a mutation of verify-selftests-wired.py on
    # 2026-09-29 proved that wrong: that checker returns 2 from self_test() when a CASE
    # fails, so a real failure was filed under USAGE and the summary said "0 failed a
    # case". Exit codes are per-checker conventions and cannot carry a shared meaning;
    # argparse's own words are unambiguous.
    # A declared --self-test that exits non-zero HAS FAILED. Full stop. There is no
    # second bucket that can absorb it.
    #
    # This previously returned 2 for anything whose output mentioned "usage:", on the
    # theory that rc 2 meant argparse had rejected the flag. A mutation on 2026-09-29
    # proved that wrong twice over: verify-selftests-wired.py returns 2 from self_test()
    # when a CASE fails, and the sweep then printed "0 failed a case" with the failure
    # sitting in the USAGE line directly above it. A bucket that reclassifies a failure
    # as something else is worse than no bucket, because the summary line is what gets
    # read.
    #
    # The usage signal is still worth having, so it is kept as a REASON on the failure
    # line -- "the flag was rejected" is genuinely different from "a case failed" and
    # changes what the reader should do -- but it can no longer change the verdict or
    # the count.
    usage = ("usage:" in text) or ("unrecognized arguments" in text)
    # A FAILING checker's diagnosis is carried by its OWN red lines, and returning only
    # the last line threw them away. Measured 2026-10-23: step 108 reported
    # "39 green = 31 CAUGHT + 8 CLEAN; 1 red" for verify-agents-mirrors.py, and the one
    # MISSED line that said WHICH case rotted was the line just above the count -- dropped
    # by `tail[-1]`. The same checker then ran clean 5/5 in isolation, so the sweep's own
    # output was the only evidence of what had failed, and the sweep had discarded it.
    # A pass still reports only its last line (short, and there is nothing to diagnose);
    # a failure reports the red lines too, because those are the point.
    if tail and r.returncode == 0:
        detail = tail[-1]
    else:
        red = [ln.strip() for ln in tail
               if ln.startswith("  MISSED") or ln.startswith("  WRONG")]
        detail = " | ".join(red[-3:] + tail[-1:]) if red else (
            tail[-1] if tail else (r.stderr or "").strip()[-120:])
    return r.returncode, (("FLAG REJECTED: " if usage else "") + detail)


def verdict(rc: int) -> str:
    """The ONLY classification this gate applies to a checker's exit code.

    Zero is a pass. Everything else is a failure, and that is the whole rule. There was
    once a second outcome for "the flag was rejected", and it hid real failures behind a
    friendlier label: verify-selftests-wired.py returns 2 from self_test() when a CASE
    fails, so a genuine failure was summarised as a usage problem while the count of
    failed cases read zero. The reason is now carried on the line as a prefix instead,
    where it can inform the reader without touching the verdict or the count.
    """
    return "pass" if rc == 0 else "failed"


def self_test() -> int:
    """Pure classification over synthetic exit codes. Nothing is executed."""
    bad: list[str] = []

    # Tests verdict() -- the function main() ACTUALLY calls. The previous cases
    # here tested a local bucket() that nothing invoked, so they passed while proving
    # nothing about the sweep: the same "a self-test that tests nothing" trap this
    # session has refused in six other checkers, created here by removing the bucket
    # from main() and forgetting the cases that described it.
    for rc, want in ((0, "pass"), (1, "failed"), (2, "failed"), (3, "failed"), (127, "failed")):
        if verdict(rc) != want:
            bad.append(f"exit {rc} must verdict as {want!r}, got {verdict(rc)!r}")

    # The checkers in this directory must be discoverable, or the sweep is vacuous.
    found = [p.name for p in checkers() if declares_selftest(p)]
    if not found:
        bad.append("live tree: no checker in scripts/ declares a --self-test, so this "
                   "sweep would report a clean tree while running nothing")

    # r189: main()'s shell -- argv and root graded against tempdir fixtures
    # carrying TINY real checkers, the r166..r188 pattern. The subprocesses
    # are genuine: the sweep runs python3 against a fixture script, so the
    # graded path is the whole pipeline (roster -> flag -> subprocess ->
    # verdict), not a stub. A refused sweep and a failed case both kill a
    # root-dropping roster: the real tree has 103 checkers, so the refusal
    # case would run them (rc 0) and the failing case would pass.
    shell = 0
    def _fixture(checkers):
        import contextlib as _ctx
        import io as _io
        import tempfile as _tempfile
        with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                             ignore_cleanup_errors=True) as td:
            base = Path(td)
            for name, body in checkers:
                # the roster reads root/scripts, so the fixture nests there
                dst = base / "scripts"
                dst.mkdir(exist_ok=True)
                (dst / name).write_text(body, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    HEADER = "import sys" + chr(10) + 'if "--self-test" in sys.argv[1:]:' + chr(10)
    OKC = HEADER + "    print('fixture ok')" + chr(10) + "    sys.exit(0)" + chr(10) + "print('no')" + chr(10) + "sys.exit(1)" + chr(10)
    BADC = HEADER + "    sys.exit(3)" + chr(10) + "sys.exit(0)" + chr(10)
    USEC = "import argparse" + chr(10) + '# "--self-test" in prose only' + chr(10) + "argparse.ArgumentParser().parse_args()" + chr(10) + "print('ran')" + chr(10)
    shell += 1
    rc, text = _fixture([("check-fixture-ok.py", OKC), ("check-fixture-noflag.py", "print(1)")])
    if rc != 0 or "1 self-test(s)" not in text or "1 declare none" not in text:
        print("  x one passing self-test and one skip must read OK (rc=%r text=%r)" % (rc, text[-100:]),
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _fixture([("check-fixture-bad.py", BADC)])
    if rc != 1 or "0 passed, 1 FAILED" not in text or "rc=3" not in text:
        print("  x a failed self-test must fail the sweep (rc=%r text=%r)" % (rc, text[-100:]),
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _fixture([("check-fixture-usage.py", USEC)])
    if rc != 1 or "FLAG REJECTED" not in text:
        print("  x argparse rejection is a failure carrying its reason (rc=%r text=%r)" % (rc, text[-100:]),
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _fixture([])
    if rc != 2 or "no checker declares" not in text:
        print("  x a sweep over nothing must refuse rc 2 (rc=%r text=%r)" % (rc, text[-100:]),
              file=sys.stderr)
        return 1
    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print(f"SELF-TEST OK (5 cases + {shell} shell cases, {len(found)} checker(s) would be swept)")
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r241 -- the r228 lesson).

    This checker sweeps SUBPROCESSES, so re-entry is not merely a stack
    concern: a nested sweep would run the whole roster from inside the ladder.
    Rung 4 drives --self-test through argv from inside the ladder; without the
    guard that nested run recurses, and the guard turns it into a printed skip
    before any process is spawned.
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
    """r241: the root contract, graded on fixture rosters through main().

    Every rung keeps the FIXTURE roster to one or two one-line scripts. That
    matters more here than anywhere else in this arc: `main()` spawns a
    process per checker, so a rung that let the roster fall back to the real
    tree would run all ~103 self-tests from inside the ladder. Rung 1 is
    therefore also a COST rung -- a root-blind main would take minutes, not
    return a single verdict.

    NOT PROVEN BY MUTATION, and stated rather than left to be assumed. r246's
    scripts/prove-ladder-kills.py mutates root resolution and this ladder
    SURVIVES, because `main()` resolves root TWICE: `checkers(root)` builds
    the roster and `base` sets each subprocess's cwd. Mutating either one
    alone leaves the other correct, so the sweep still reads the fixture and
    still greens -- correctly. That is the harness's blind spot (it rewrites
    one anchor), not a defect in the ladder: mutating BOTH makes the sweep read
    the real tree. But that paired result must NOT be read as proof either, and
    round 246 measured why: the real roster currently contains a FAILING
    checker (verify-lane.sh exits 2), so a root-blind main returns rc 1 against
    the fixture's all-green expectation for the WRONG REASON -- it is red
    because the repository is red, not because the rung graded anything. The
    rung would pass this mutation while ranking below every fixture case here.
    So this ladder's kill is UNPROVEN, not merely undemonstrated, and that is
    recorded rather than papered over with the accident that happens to work.

    Rung 3 grades the bucket boundary this file's own history is about: a
    checker that declares --self-test in a PROSE comment but rejects the flag
    must land in "FAILED ... FLAG REJECTED", never in a bucket of its own.
    That distinction was the 2026-09-29 lesson and it already had a self-test
    case, but no case ran it through the ROSTER, which is the path that
    decides the summary line a reader actually trusts.
    """
    def build(tmp, scripts, label="fx"):
        """A fixture root whose scripts/ holds the given [(name, body)] roster."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        (base / "scripts").mkdir(parents=True, exist_ok=True)
        for name, body in scripts:
            (base / "scripts" / name).write_text(body, encoding="utf-8")
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    HEADER = "import sys" + chr(10) + 'if "--self-test" in sys.argv[1:]:' + chr(10)
    OKC = (HEADER + "    print('fixture ok')" + chr(10) + "    sys.exit(0)" + chr(10)
           + "sys.exit(1)" + chr(10))
    BADC = HEADER + "    sys.exit(3)" + chr(10) + "sys.exit(0)" + chr(10)
    USEC = ("import argparse" + chr(10) + '# "--self-test" in prose only' + chr(10)
            + "argparse.ArgumentParser().parse_args()" + chr(10) + "print('ran')" + chr(10))

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: a FAILING fixture checker must fail the sweep.
        root = build(tmp, [("check-fx-bad.py", BADC)])
        rc, said = run(root)
        if rc != 1 or "0 passed, 1 FAILED" not in said or "check-fx-bad.py" not in said:
            print("  x rung 1: a failing fixture self-test must fail the sweep rc 1 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a passing fixture greens and counts the FIXTURE roster only.
        root = build(tmp, [("check-fx-ok.py", OKC), ("check-fx-none.py", "print(1)")])
        rc, said = run(root)
        if rc != 0 or "1 self-test(s)" not in said or "1 declare none" not in said:
            print("  x rung 2: a passing fixture roster must green counting one "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- a rejected flag stays a FAILURE carrying its reason.
        root = build(tmp, [("check-fx-usage.py", USEC)])
        rc, said = run(root)
        if rc != 1 or "FLAG REJECTED" not in said:
            print("  x rung 3: a rejected flag must be a failure with its reason "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded,
        # and the guard must fire BEFORE any subprocess is spawned.
        root = build(tmp, [("check-fx-ok.py", OKC)])
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the refusal floor: a roster where nothing declares the flag.
        root = build(tmp, [("check-fx-none.py", "print(1)")])
        rc, said = run(root)
        if rc != 2 or "no checker declares" not in said:
            print("  x rung 5: a roster declaring nothing must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("SELFTEST-SWEEP SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r189: argv and root parameterized, the r166..r188 contract -- root
    redirects the roster AND every subprocess's cwd together."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit. Runs no other checker.")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    base = ROOT if root is None else Path(root).resolve()

    todo = [p for p in checkers(root) if declares_selftest(p)]
    if not todo:
        print("verify-selftest-sweep: no checker declares a --self-test. Refusing to "
              "report clean -- a sweep that ran nothing is not a passing sweep.",
              file=sys.stderr)
        return 2

    # PARALLEL, and the order is preserved.
    #
    # These 50 checkers were run one at a time for a total of 362 s -- half the
    # cost of the whole gate matrix. They are independent subprocesses with no
    # shared state, so there is no reason to serialise them; the only thing that
    # must survive is the REPORTED ORDER, because a summary whose line order
    # changes run to run cannot be diffed.
    #
    # The worker count is a deliberate 8 rather than the core count. These are
    # short-lived Python processes that spend most of their wall time waiting on
    # the OS, so a small pool already saturates the useful concurrency, and a
    # pool as wide as the machine would make 50 interpreters compete for the same
    # CPU and finish slower -- the same shape as the test-thread ceiling measured
    # in kasirmu-core.
    workers = 8
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda p: run(p, cwd=base), todo))

    passed, failed = [], []
    for p, (rc, tail) in zip(todo, results):
        line = f"{p.name}: rc={rc} {tail}"
        (passed if verdict(rc) == "pass" else failed).append(line)

    for line in failed:
        print("  FAILED " + line)
    if failed:
        rejected = sum(1 for ln in failed if "FLAG REJECTED:" in ln)
        extra = (f", of which {rejected} had the flag rejected rather than a failed case"
                 if rejected else "")
        print(f"verify-selftest-sweep: {len(passed)} passed, {len(failed)} FAILED"
              f"{extra}. A non-zero exit from a checker that DECLARES --self-test is a "
              f"failure; there is no other reading.")
        return 1
    print(f"verify-selftest-sweep: OK — {len(passed)} self-test(s) across "
          f"{len(checkers(root))} checker(s); {len(checkers(root)) - len(todo)} declare none "
          f"and were skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
