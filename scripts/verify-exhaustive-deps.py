#!/usr/bin/env python3
"""Ratchet on react-hooks/exhaustive-deps warnings.

Why this exists
---------------
`ui/package.json` runs `eslint .` with no `--max-warnings 0`, so eslint exits 0 while reporting 58
warnings. One rule in that set is not cosmetic: `react-hooks/exhaustive-deps` is the only automated
check for a stale closure, and in this codebase a stale closure has a specific dangerous shape -- a
callback that reads `sessionToken` (or any store-scoped value) but does not list it captures the
value from the render that built it. Item 69 found five callbacks whose deps listed `userId`, a prop
no component body ever read, while two of the same arrays omitted `promotionIds`, which IS sent in
the checkout payload. Neither was caught by any gate.

So this does not try to clear the debt. It freezes it: the count may go down, never up. That keeps
the 12 -> 7 improvement made in item 69 from silently eroding, and it makes a newly introduced
stale-closure warning a build failure rather than a line in a report nobody reads.

The failure mode this script is written against
-----------------------------------------------
A zero from a tool that did not run is worse than no tool. Every measurement here therefore has to
prove the run happened before its number is believed:

  * eslint's own exit code is captured without a pipe (a pipe resets $LASTEXITCODE in PowerShell and
    has already produced a false "exit=0" alongside four real errors in this repo's history).
  * the human-readable summary line ("N problems (X errors, Y warnings)") must be present and
    parseable. Its absence means eslint never got as far as linting -- a bad flag, a missing
    dependency, a crash -- and that is reported as an error, never as a clean bill of health.
  * the exhaustive-deps count is cross-checked against the parsed warning total: a count larger than
    the total warnings is arithmetically impossible and means the parsing is wrong.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(REPO, "ui")
STATE = os.path.join(REPO, "scripts", "exhaustive-deps-baseline.json")

SUMMARY_RE = re.compile(r"(\d+)\s+problems?\s+\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)")
RULE_RE = re.compile(r"react-hooks/exhaustive-deps")


def load_baseline() -> int:
    with open(STATE, encoding="utf-8") as fh:
        return int(json.load(fh)["max_exhaustive_deps"])


def run_eslint() -> tuple[int, str]:
    """Invoke the project-local eslint over the whole UI tree and return (exit_code, output)."""
    bin_eslint = os.path.join(
        UI, "node_modules", ".bin", "eslint.cmd" if os.name == "nt" else "eslint"
    )
    if not os.path.exists(bin_eslint):
        raise SystemExit(
            f"eslint not found at {bin_eslint}\n"
            "This gate cannot certify anything without the linter, so it fails rather than "
            "reporting clean. Run `npm ci` in ui/ first."
        )
    proc = subprocess.run(
        # Default (stylish) formatter on purpose. `--format compact` and `--format unix` are no
        # longer part of core ESLint in this version: they exit 2 with a usage error, which is
        # exactly the "tool did not run but reported a number" trap this script is built to refuse.
        [bin_eslint, "."],
        cwd=UI,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def measure(output: str) -> tuple[int, int]:
    """Return (warning_total, exhaustive_deps_count) or raise if the run is not trustworthy."""
    m = SUMMARY_RE.search(output)
    if not m:
        raise SystemExit(
            "eslint produced no parseable summary line -- the run cannot be trusted, so this gate "
            "fails instead of reporting clean.\nFirst 400 chars of output:\n" + output[:400]
        )
    _problems, _errors, warnings = (int(g) for g in m.groups())
    deps = len(RULE_RE.findall(output))
    if deps > warnings:
        raise SystemExit(
            f"inconsistent parse: {deps} exhaustive-deps mentions exceed {warnings} total warnings; "
            "the output format changed and the count is meaningless."
        )
    return warnings, deps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set-baseline", action="store_true", help="record the current count as the cap")
    args = ap.parse_args()

    code, output = run_eslint()
    # eslint exits 1 when there are problems and 2 on a usage/config error; both mean the number
    # below may be garbage, so surface it. Exit 0 is the only fully clean case.
    if code == 2:
        raise SystemExit(f"eslint exited 2 (usage or config error), output:\n{output[:600]}")

    warnings, deps = measure(output)
    baseline = load_baseline()
    print(f"  warnings total: {warnings}   exhaustive-deps: {deps}   cap: {baseline}")

    if args.set_baseline:
        with open(STATE, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(
                {
                    "max_exhaustive_deps": deps,
                    "_note": (
                        "Ratchet cap for react-hooks/exhaustive-deps warnings. Lower it whenever a "
                        "stale closure is fixed; never raise it to make the build pass -- each unit "
                        "is a callback that can capture a stale sessionToken and read or write the "
                        "wrong store (item 69)."
                    ),
                }
                | {},
                fh,
                indent=2,
                sort_keys=False,
            )
            fh.write("\n")
        print(f"  baseline set to {deps}")
        return 0

    if deps > baseline:
        offenders = [
            ln.strip() for ln in output.splitlines() if RULE_RE.search(ln)
        ]
        print(f"  FAIL: {deps} exhaustive-deps warnings exceed the cap of {baseline}")
        for ln in offenders:
            print(f"    {ln[:150]}")
        print(
            "\n  Each of these is a callback or effect that reads a value it does not list. In this\n"
            "  codebase the dangerous instances are the ones that read sessionToken or another\n"
            "  store-scoped value: the closure keeps the token from the render that built it, so the\n"
            "  next store switch leaves the handler writing to the previous store. Fix the deps\n"
            "  array; do not raise the cap."
        )
        return 1
    if deps < baseline:
        print(f"  ok (below cap -- consider lowering it to {deps} to lock in the improvement)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
