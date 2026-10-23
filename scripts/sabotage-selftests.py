#!/usr/bin/env python3
"""Blank each checker's core predicate in turn and ask whether its self-test notices.

A self-test that cannot fail is the failure mode this project keeps finding. Reading the
source cannot settle it (measured 2026-10-23: four checkers looked path-less to a grep and
all four were fine). The only reliable question is behavioural:

    break the detector, run the self-test, does it go red?

This harness automates that over every Python checker. For each one it finds the first
top-level function that RETURNS something (skipping __main__/main/self_test), replaces
its body with a neutral return, runs --self-test, and records whether the exit code
changed. A SURVIVOR is a self-test that did not notice its detector being gutted.

It writes files, so it only ever runs against a COPY under target/. Never point it at
the tracked tree.

USAGE
    python scripts/sabotage-selftests.py            # full sweep, prints a table
    python scripts/sabotage-selftests.py --limit 5  # first five checkers only
"""

from __future__ import annotations

import argparse
import ast
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Never blanked: these ARE the harness, or are the entry point.
SKIP_DEFS = {"main", "self_test", "_self_test", "run", "cli"}


def candidate_functions(src: str) -> list[tuple[str, int, int]]:
    """(name, body_start_line, body_end_line) for blankable top-level functions."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name in SKIP_DEFS or node.name.startswith("__"):
            continue
        if len(node.body) < 2:
            continue
        out.append((node.name, node.body[0].lineno, node.body[-1].end_lineno or node.body[-1].lineno))
    return out


def blank_body(src: str, name: str, start: int, end: int) -> str:
    """Return src with that function\'s body replaced by a neutral return."""
    lines = src.split("\n")
    indent = " " * (len(lines[start - 1]) - len(lines[start - 1].lstrip()))
    stub = [indent + "return None  # MUTATION: detector gutted"]
    return "\n".join(lines[: start - 1] + stub + lines[end:])


def run_self_test(path: Path) -> int | None:
    try:
        r = subprocess.run([sys.executable, str(path), "--self-test"],
                           cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None
    return r.returncode


def survey(limit: int | None) -> list[tuple[str, str, int, int, str]]:
    """(checker, mutated function, before, after, verdict) for every candidate."""
    # KNOWN LIMIT: Python only. mutation here is AST-based (find the function, blank its
    # body), and shell has no equivalent, so the .sh and .mjs checkers are outside this
    # sweep -- including verify-docker-persistence.sh, whose self-test was measured by hand
    # instead (2026-10-24: three verdict mutations, all KILLED). A mutation score that names
    # its own blind spot is worth more than one that silently reads as total coverage.
    files = sorted((ROOT / "scripts").glob("verify-*.py")) + sorted((ROOT / "scripts").glob("check-*.py"))
    # A substring search is not a census: verify-website-assets.py MENTIONS --self-test
    # in a paragraph explaining why it has none, and that prose was read as a capability
    # (it then errored "unrecognized arguments", recorded here as PATH ALREADY RED).
    # Require the argparse flag itself, i.e. the string inside a quoted literal.
    flag = re.compile(r"""["']--self-test["']""")
    files = [f for f in files if flag.search(f.read_text(encoding="utf-8", errors="replace"))]
    if limit:
        files = files[:limit]
    rows = []
    for p in files:
        src = p.read_text(encoding="utf-8", errors="replace")
        base = run_self_test(p)
        if base != 0:
            rows.append((p.name, "-", base if base is not None else -1, -1, "PATH ALREADY RED"))
            continue
        cands = candidate_functions(src)
        if not cands:
            rows.append((p.name, "-", 0, 0, "NO MUTATABLE FUNCTION"))
            continue
        # Mutate only the FIRST candidate: enough to answer "can this self-test fail".
        name, s0, e0 = cands[0]
        mutated = blank_body(src, name, s0, e0)
        with tempfile.TemporaryDirectory() as td:
            copy = Path(td) / p.name
            copy.write_text(mutated, encoding="utf-8")
            after = run_self_test(copy)
        verdict = "KILLED" if after not in (0, None) else "SURVIVED"
        rows.append((p.name, name, 0, after if after is not None else -1, verdict))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    rows = survey(args.limit)
    survivors = [r for r in rows if r[4] == "SURVIVED"]
    for name, fn, before, after, verdict in rows:
        print("  %-46s %-28s %-12s exit %s -> %s" % (name, fn[:28], verdict, before, after))
    print("")
    print("sabotage: %d checker(s), %d SURVIVED (their self-test did not notice the gutted "
          "detector), %d killed." % (len(rows), len(survivors), len(rows) - len(survivors)))
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
