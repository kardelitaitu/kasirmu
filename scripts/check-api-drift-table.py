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


def doc_path(root: Path = ROOT) -> Path:
    """The page carrying the drift table, resolved under the tree being graded."""
    return root / "docs" / "guides" / "developer" / "api-reference.md"


def checker_path(root: Path = ROOT) -> Path:
    """The surface checker whose measurement the table must print, under the same tree."""
    return root / ".agents" / "skills" / "docs-auditor" / "scripts" / "check-api-surface.py"


# Kept as names because readers grep them; both follow the default root.
DOC = doc_path()
CHECKER = checker_path()

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


def measured(root: Path = ROOT) -> dict[str, int]:
    """Run the surface checker BUILT FROM root and return its bucket sizes.

    r230: root is a parameter rather than the ROOT global so a fixture tree can
    carry its own stub checker, and the cwd moves with it -- a checker that
    resolves anything relative to its cwd then sees the fixture, never this
    checkout. Both halves must come from ONE root or the numbers are a chimera.
    """
    out = subprocess.run(
        [sys.executable, str(checker_path(root)), "--json"],
        cwd=root, capture_output=True, text=True,
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


def self_test(run_ladder: bool = False) -> int:
    """Pin the count reader and the label comparison; read no file, run no checker.

    r230: run_ladder chains the fixture ladder, and only the EXPLICIT --self-test
    dispatch passes it, so an in-process self_test() call from a caller that is
    already grading cannot recurse into the ladder.
    """
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
    if failures:
        return 1
    if run_ladder:
        return shell_ladder()
    return 0


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r230).

    Rung 7 drives --self-test through argv from INSIDE the ladder, so
    self_test(run_ladder=True) would chain shell_ladder again forever. The
    guard turns that one legitimately nested call into a printed skip -- the
    r228 shape, kept here because this file needs the same rung.
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
    """r230: the root contract, graded on fixture trees through main.

    Each rung is a throwaway tree holding a miniature api-reference.md and a
    STUB surface checker, so the measurement is the fixture's own and no real
    checkout is read. Rung 1 IS the killing rung: the page prints 86 while the
    stub measures 0, so a root-dropping main grades THIS checkout's clean table
    and exits 0, while the fixture must exit 1 naming both numbers.
    """
    import contextlib
    import io
    import tempfile

    def run(root, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    labels = ("Marker wrong", "Listed but not registered anywhere",
              "Listed and not defined as a command", "Registered but not listed")

    def table(cells):
        lines = ["> | Class | Count |"]
        for label, cell in zip(labels, cells):
            lines.append("> | %s | %s |" % (label, cell))
        return "\n".join(lines) + "\n"

    def stub(counts=(0, 0, 0, 0)):
        return ("import json\nprint(json.dumps({'marker_wrong': %d, "
                "'listed_not_registered': %d, 'listed_not_defined': %d, "
                "'registered_not_listed': %d}))\n" % tuple(counts))

    def build(tmp, doc_text=None, stub_text=None, label="fx"):
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label))
        if doc_text is not None:
            page = doc_path(base)
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text(doc_text, encoding="utf-8", newline="\n")
        check = checker_path(base)
        check.parent.mkdir(parents=True, exist_ok=True)
        check.write_text(stub_text if stub_text is not None else stub(),
                         encoding="utf-8", newline="\n")
        return base

    shell = 0
    with tempfile.TemporaryDirectory() as tmp:
        # rung 1 IS the killing rung: a page that prints a count nobody measured
        root = build(tmp, doc_text=table(("0", "86", "0", "0")))
        rc, said = run(root)
        if rc != 1 or "the page prints 86, the measurement is 0" not in said \
                or "Listed but not registered anywhere" not in said:
            print("  x rung 1: a page row disagreeing with its measurement must "
                  "fail rc 1 (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2: history prose after the leading number is not part of the count
        root = build(tmp, doc_text=table(("**0** (was 11)",
                                          "**0 today** (86 on 08-09-26)",
                                          "0", "**0**")))
        rc, said = run(root)
        if rc != 0 or "clean - 4 bucket row(s) match" not in said:
            print("  x rung 2: a table whose leading numbers agree must green "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3: no page under the fixture root at all
        root = build(tmp, doc_text=None)
        rc, said = run(root)
        if rc != 2 or "BROKEN" not in said or "not found" not in said:
            print("  x rung 3: a root without the page must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4: a page that carries no parseable bucket row
        root = build(tmp, doc_text="# api reference\nno table here yet\n")
        rc, said = run(root)
        if rc != 2 or "parsed no bucket rows" not in said:
            print("  x rung 4: a page with no bucket rows must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5: the measurement itself fails -- not a disagreement, an instrument
        root = build(tmp, doc_text=table(("0", "0", "0", "0")),
                     stub_text="import sys\nsys.exit(3)\n")
        rc, said = run(root)
        if rc != 2 or "BROKEN" not in said or "exited 3" not in said:
            print("  x rung 5: a failing measurement must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6: a measurement missing a bucket key cannot be graded against
        root = build(tmp, doc_text=table(("0", "0", "0", "0")),
                     stub_text="import json\nprint(json.dumps({'marker_wrong': 0}))\n")
        rc, said = run(root)
        if rc != 2 or "omits bucket" not in said:
            print("  x rung 6: a measurement omitting a bucket must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 7: --self-test flows through argv, and the nested ladder skips
        root = build(tmp, doc_text=table(("0", "0", "0", "0")))
        rc, said = run(root, "--self-test")
        if rc != 0 or "checks pass" not in said or "ladder re-entry" not in said:
            print("  x rung 7: --self-test through argv must pass rc 0 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("API-DRIFT SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """Grade the drift table; r230: argv explicit, root names the tree.

    argv is the raw list (sys.argv[1:] when None) -- this file had no callers
    passing anything else, so there was no parser shape to preserve. root is
    resolved ONCE, and both the page and the checker derive from it: a fixture
    supplies its own table AND its own measurement, so the played numbers and
    the trusted numbers can never come from different trees.
    """
    parser = argparse.ArgumentParser(description="The drift table must print the measured counts.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(sys.argv[1:] if argv is None else list(argv))

    if args.self_test:
        return self_test(run_ladder=True)

    base = Path(root).resolve() if root is not None else ROOT
    doc = doc_path(base)

    if not doc.exists():
        print("check-api-drift-table: BROKEN - %s not found" % doc, file=sys.stderr)
        return 2
    rows = parsed_rows(doc.read_text(encoding="utf-8"))
    if not rows:
        print("check-api-drift-table: BROKEN - parsed no bucket rows from the table", file=sys.stderr)
        return 2
    try:
        now = measured(base)
        # A measurement missing a key is not a disagreement, it is a broken
        # instrument: grading `rows` against it would KeyError or, worse, pass.
        absent = [k for k in BUCKETS.values() if k not in now]
        if absent:
            raise RuntimeError("the measurement omits bucket(s): " + ", ".join(absent))
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
