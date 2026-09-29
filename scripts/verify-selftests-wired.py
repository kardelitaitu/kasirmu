#!/usr/bin/env python3
"""verify-selftests-wired.py -- fail when a checker's --self-test is invoked by nobody.

WHY
===
A checker's `--self-test` is its liveness proof: the cases that prove the gate
can still FAIL, which no bare run of the gate can see. The repo's own convention,
stated at "IPC command parity self-test" in dev-ci.yml, is that the self-test lives
BESIDE the gate it proves. Following the convention is only half of it. A self-test
that no runner invokes is a self-test that can rot in silence, and the rot is
invisible: the cases still pass when someone runs them by hand, and nothing tells
anyone that nobody does.

This file exists because that exact state had accumulated. Measured on
2026-09-29: of 28 scripts/verify-*.py, 24 declared a --self-test and NINE of those
were invoked from no runner at all -- dev-ci.yml, scripts/check.sh and
.githooks/pre-commit combined. One of the nine (verify-migration-column-types.py)
had been printing "LIMIT: nothing calls this flag" in its own report for a while;
the other eight did not know.

The gate is deliberately narrow. It does not decide WHICH runner should invoke a
self-test, or whether a given self-test is any good -- it answers one question:
does the flag have a caller? A self-test invoked only by check.sh counts; so does
one invoked only by CI. Being invoked SOMEWHERE is the property that stops the rot.

WHAT IT DOES NOT COVER
======================
A checker with no --self-test at all. That is the gap this file cannot close,
because "should this gate have a self-test" is a judgement per checker; the sweep
that found the nine is recorded in the docstring above so the next one to be added
knows the convention exists.

Exit 0 clean, 1 uncalled self-test(s), 2 usage or self-test failure.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "scripts"
# Every place a self-test can legitimately be invoked from. A gate that only knows
# about CI would call every check.sh-only self-test dead, and check.sh is a real
# runner even though it is manual.
RUNNERS = (
    ROOT / ".github" / "workflows",
    ROOT / "scripts" / "check.sh",
    ROOT / "scripts" / "check.ps1",
    ROOT / ".githooks" / "pre-commit",
)
SCRIPT_RE = re.compile(r"^verify-[A-Za-z0-9_-]+\.py$")
# "<name>.py --self-test" anywhere on the line. Deliberately not anchored to a
# command position: a step that pipes or redirects still calls the flag, and a
# grep that misses those would report a false finding, which is the failure mode
# that gets a gate muted.
CALL_RE = re.compile(r"([A-Za-z0-9_-]+)\.py\s+--self-test")


def checkers() -> list[str]:
    return sorted(p.name for p in SCRIPT_DIR.glob("verify-*.py") if SCRIPT_RE.match(p.name))


def declares_selftest(name: str) -> bool:
    try:
        text = (SCRIPT_DIR / name).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return bool(re.search(r"""["']--self-test["']""", text))


def runner_text() -> str:
    parts: list[str] = []
    for r in RUNNERS:
        if r.is_dir():
            for p in sorted(r.rglob("*.yml")) + sorted(r.rglob("*.yaml")):
                # .github/workflows/attic/ holds RETIRED workflows, and GitHub never
                # executes a .bak. Counting one as a caller would report a checker as
                # wired on the strength of a runner that stopped existing months ago --
                # which is how verify-flaky-quarantine.py looked live: its only two
                # invocations were in ci.yml.bak and nightly.yml.bak. Measured, not
                # assumed: the attic here is where the false negative came from.
                if "attic" in {q.lower() for q in p.parts}:
                    continue
                try:
                    parts.append(p.read_text(encoding="utf-8", errors="replace"))
                except OSError:
                    pass
        elif r.is_file():
            try:
                parts.append(r.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    return "\n".join(parts)


def strip_full_line_comments(text: str) -> str:
    """Drop WHOLE-LINE comments before matching a caller.

    Necessary because a checker that documents its own dead flag does so in a
    comment -- verify-migration-column-types.py printed "LIMIT: nothing calls this
    flag" beside the flag it declared, and counting that line as a caller would
    report the one checker in the tree that KNOWS it is unwired as wired. The exact
    failure this gate exists to prevent, reproduced inside the gate.

    Deliberately whole-line only. Stripping to the first "#" would also cut a "#"
    inside a quoted string -- a URL fragment, a colour escape -- and could hide a
    real call, which is the false-negative direction that matters. A trailing
    comment on a line that also carries a real call is left counted, and that
    under-reporting is named here rather than papered over.
    """
    return "\n".join(ln for ln in text.split("\n") if not ln.lstrip().startswith("#"))


def called(name: str, text: str) -> bool:
    stem = name[: -len(".py")]
    return any(m.group(1) == stem for m in CALL_RE.finditer(strip_full_line_comments(text)))


def uncalled_selftests() -> list[str]:
    text = runner_text()
    return [n for n in checkers() if declares_selftest(n) and not called(n, text)]


def self_test() -> int:
    """Pure over synthetic runner text. No file is created, read or written."""
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # A runner line with the flag IS a caller -- the property that stops the rot.
    want("a flag invoked in a runner counts",
         called("verify-x.py", "run: python3 scripts/verify-x.py --self-test"), True)
    # Indented, quoted, or trailing-flag forms are the same call.
    want("indented step still counts",
         called("verify-x.py", "      - name: t\n        run: python3 scripts/verify-x.py --self-test"), True)
    # A different checker's self-test is not this one's caller.
    want("another checker's call is not a caller",
         called("verify-x.py", "python3 scripts/verify-y.py --self-test"), False)
    # Naming the checker without the flag is not a call -- this is the exact state
    # the gate exists to catch: the gate runs, its self-test does not.
    want("a bare gate invocation is not a caller",
         called("verify-x.py", "python3 scripts/verify-x.py"), False)
    # The flag in a comment is not a call either, and counting it would make the
    # gate pass on a checker that is still unwired.
    want("a comment mentioning the flag is not a caller",
         called("verify-x.py", "# python3 scripts/verify-x.py --self-test  (documented, uncalled)"), False)

    # The real tree must have the property, or this gate is not earning its place.
    live = uncalled_selftests()
    if live:
        bad.append("live tree has " + str(len(live)) + " uncalled self-test(s): "
                   + ", ".join(live))

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (6 cases, no files touched)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    live = uncalled_selftests()
    total = len(checkers())
    declared = sum(1 for n in checkers() if declares_selftest(n))
    if live:
        print(f"verify-selftests-wired: {len(live)} self-test(s) invoked by no runner:")
        for n in live:
            print(f"    {n} -- declares --self-test, but no runner passes the flag. "
                  f"Add a step beside its gate in .github/workflows/dev-ci.yml and "
                  f"scripts/check.sh, or delete the flag if it was never meant to run.")
        return 1
    print(f"verify-selftests-wired: OK — {declared} of {total} verify-*.py declare a "
          f"--self-test and every one is invoked by a runner.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
