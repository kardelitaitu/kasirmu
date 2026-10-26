#!/usr/bin/env python3
"""check-api-drift-table.py -- the numbers in api-reference.md must equal today's measurement.

WHY THIS EXISTS
===============
`check-api-surface.py` measures four drift buckets and exits non-zero when any is
non-empty. It does NOT read the table that REPORTS those numbers, so the table can
say one thing while the checker says another and both are "green". That is exactly
what was found on 2026-10-27 (round 46):

    | Listed but not registered anywhere | 86 |   <- the page
    listed, not registered anywhere : 0             <- the checker, same commit

Every row in that table is written in the PRESENT tense ("A real #[command] fn
that no generate_handler! includes, so the front-end cannot invoke it"), so a
reader takes 86 for current rot. It was 0. The table carries a "Measured 08-09-26"
header that asks the reader to re-derive before repeating a figure -- which is the
right instruction for a human and no protection at all against the next edit.

THE CONTRACT
============
Each row's Count cell must OPEN with the bucket's current size. Two forms are
accepted, and the first is what makes the row honest after the bucket empties:

    | Class | Count | ...
    **0** (was 11)              -> current 0, history 11
    **0 today** (86 on ...)     -> current 0, history 86
    7                           -> current 7 (no history)

The leading number is read; anything after it is prose. A row that opens with a
number the checker disagrees with is a finding, because the reader believes it.

WHAT IT DOES NOT CLAIM
======================
It does not verify that a bucket is EMPTY, nor that a row exists for every bucket.
check-api-surface.py owns both, and duplicating them here would give two places to
disagree. This file owns one question: is the printed count the measured count?

EXIT CODES
    0  every row agrees with the measurement
    1  a row disagrees
    2  could not run (no table parsed, or the measurement failed)

Usage, from the repo root:

    python scripts/check-api-drift-table.py
    python scripts/check-api-drift-table.py --self-test
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "guides" / "developer" / "api-reference.md"
CHECKER = ROOT / ".agents" / "skills" / "docs-auditor" / "scripts" / "check-api-surface.py"

# Class label in the doc -> key in the checker's JSON output.
BUCKETS = {
    "Marker wrong": "marker_wrong",
    "Listed but not registered anywhere": "listed_not_registered",
    "Listed and not defined as a command": "listed_not_defined",
    "Registered but not listed": "registered_not_listed",
}

ROW_RE = re.compile(r"^>\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|", re.M)
LEADING_INT_RE = re.compile(r"^\**\s*(\d+)")


def strip_markdown(text: str) -> str:
    """Remove ** and ` so a class label compares equal to its plain spelling."""
    return text.replace("**", "").replace("`", "").strip()


def leading_count(cell: str) -> int | None:
    """The number a Count cell OPENS with, or None when it opens with prose."""
    match = LEADING_INT_RE.match(cell.strip())
    return int(match.group(1)) if match else None


def parsed_rows(text: str) -> dict[str, int]:
    """Class label -> the count the table prints for it."""
    found: dict[str, int] = {}
    for label, cell in ROW_RE.findall(text):
        key = strip_markdown(label)
        if key not in BUCKETS:
            continue
        count = leading_count(cell)
        if count is not None:
            found[key] = count
    return found


def measured() -> dict[str, int]:
    """Run the surface checker and return its bucket sizes."""
    out = subprocess.run(
        [sys.executable, str(CHECKER), "--json"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if out.returncode not in (0, 1):
        raise RuntimeError("check-api-surface.py exited %d: %s" % (out.returncode, out.stderr.strip()[:200]))
    return json.loads(out.stdout)


SELF_TEST_CASES = [
    # (label, cell, expected leading count or None)
    ("bold zero with history", "**0** (was 11)", 0),
    ("bold zero today", "**0 today** (86 on 08-09-26)", 0),
    ("plain number", "7", 7),
    ("bold number", "**7**", 7),
    ("prose first", "Not commands", None),
    ("empty cell", "", None),
]


def self_test() -> int:
    """Pin the count reader and the label comparison; read no file, run no checker."""
    failures = 0
    for label, cell, want in SELF_TEST_CASES:
        got = leading_count(cell)
        status = "ok" if got == want else "FAIL"
        if got != want:
            failures += 1
        print(f"  {status:4} {label:28} expected={want!s:5} got={got!s}")

    # Label normalisation: the table bolds part of a label, the dict does not.
    got = strip_markdown("Listed but **not registered anywhere**")
    want = "Listed but not registered anywhere"
    if got != want:
        print(f"  FAIL label normalisation: {got!r} != {want!r}")
        failures += 1
    else:
        print("  ok   label normalisation")

    # Every bucket the dict names must be a row the table can carry.
    if len(BUCKETS) != 4:
        print(f"  FAIL expected 4 buckets, BUCKETS has {len(BUCKETS)}")
        failures += 1
    else:
        print("  ok   four buckets declared")

    total = len(SELF_TEST_CASES) + 2
    print(f"self-test: {total - failures}/{total} checks pass")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="The drift table must print the measured counts.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    if not DOC.exists():
        print("check-api-drift-table: BROKEN - %s not found" % DOC, file=sys.stderr)
        return 2
    rows = parsed_rows(DOC.read_text(encoding="utf-8"))
    if not rows:
        print("check-api-drift-table: BROKEN - parsed no bucket rows from the table", file=sys.stderr)
        return 2
    try:
        now = measured()
    except (RuntimeError, json.JSONDecodeError) as exc:
        print("check-api-drift-table: BROKEN - %s" % exc, file=sys.stderr)
        return 2

    findings = []
    for label, key in BUCKETS.items():
        if label not in rows:
            continue  # the surface checker owns "is there a row"
        printed, actual = rows[label], now[key]
        if printed != actual:
            findings.append("%s: the page prints %d, the measurement is %d" % (label, printed, actual))

    if findings:
        print("check-api-drift-table: %d row(s) disagree with the measurement:" % len(findings), file=sys.stderr)
        for line in findings:
            print("  " + line, file=sys.stderr)
        print("", file=sys.stderr)
        print("A present-tense count the reader will believe must be the measured one.", file=sys.stderr)
        print("Write the history in parentheses: \"**0** (was 86 on 08-09-26)\".", file=sys.stderr)
        return 1

    print("check-api-drift-table: clean - %d bucket row(s) match the measurement" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
