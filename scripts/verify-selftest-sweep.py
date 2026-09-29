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
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "scripts"
CHECKER_RE = re.compile(r"^(?:verify|check)-[A-Za-z0-9_-]+\.(?:py|mjs)$")
DECLARES_RE = re.compile(r"""["']--self-test["']""")


def checkers() -> list[Path]:
    return sorted(p for p in SCRIPT_DIR.iterdir()
                  if p.is_file() and CHECKER_RE.match(p.name))


def declares_selftest(path: Path) -> bool:
    try:
        return bool(DECLARES_RE.search(path.read_text(encoding="utf-8", errors="replace")))
    except OSError:
        return False


def run(path: Path) -> tuple[int, str]:
    cmd = (["python3", str(path)] if path.suffix == ".py" else ["node", str(path)])
    cmd.append("--self-test")
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
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
    return r.returncode, (("FLAG REJECTED: " if usage else "")
                          + (tail[-1] if tail else (r.stderr or "").strip()[-120:]))


def self_test() -> int:
    """Pure classification over synthetic exit codes. Nothing is executed."""
    bad: list[str] = []

    def bucket(rc: int) -> str:
        return {0: "pass", 2: "usage", 1: "case-failed"}.get(rc, "error")

    for rc, want in ((0, "pass"), (2, "usage"), (1, "case-failed"), (3, "error")):
        if bucket(rc) != want:
            bad.append(f"exit {rc} must bucket as {want!r}, got {bucket(rc)!r}")

    # The checkers in this directory must be discoverable, or the sweep is vacuous.
    found = [p.name for p in checkers() if declares_selftest(p)]
    if not found:
        bad.append("live tree: no checker in scripts/ declares a --self-test, so this "
                   "sweep would report a clean tree while running nothing")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print(f"SELF-TEST OK (5 cases, {len(found)} checker(s) would be swept)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit. Runs no other checker.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    todo = [p for p in checkers() if declares_selftest(p)]
    if not todo:
        print("verify-selftest-sweep: no checker declares a --self-test. Refusing to "
              "report clean -- a sweep that ran nothing is not a passing sweep.",
              file=sys.stderr)
        return 2

    passed, failed = [], []
    for p in todo:
        rc, tail = run(p)
        line = f"{p.name}: rc={rc} {tail}"
        (passed if rc == 0 else failed).append(line)

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
          f"{len(checkers())} checker(s); {len(checkers()) - len(todo)} declare none "
          f"and were skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
