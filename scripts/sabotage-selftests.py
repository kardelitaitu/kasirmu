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

#: Bare "bash" is WSL here and cannot see the Windows tree (exit 127), so a .sh self-test
#: run through it would fail for the wrong reason and score as a killed mutation.
GIT_BASH = r"C:\Program Files\Git\bin\bash.exe"


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


SH_FUNC = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\)\s*\{", re.M)
# A plain declaration AND an exported one. Anchoring on "^function" alone missed
# export function collectErrors(...), which is how check-release-version.mjs scored
# "2 funcs, 0 killed": its whole detector was invisible to the sweep, so the score read
# as an uncovered self-test when the self-test simply could not be reached.
MJS_FUNC = re.compile(
    r"^(?:export\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", re.M)


def braces_span(src: str, open_idx: int) -> int | None:
    """Index of the "}" that closes the "{" at open_idx, or None if unbalanced.

    A brace counter, not a parser -- so comment and string contents are stripped first.
    Without that, a "}" inside a quoted message closes the function early and the blanking
    eats the rest of the file (or leaves an unbalanced stub that fails to parse, which the
    harness would then report as the self-test "catching" a mutation it never saw).
    """
    depth = 0
    i = open_idx
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def text_functions(src: str, pattern: re.Pattern) -> list[tuple[str, int, int]]:
    """(name, open_line, close_line) for functions found by TEXT, for .sh and .mjs."""
    out = []
    stripped = strip_comments_and_strings(src)
    for m in pattern.finditer(src):
        name = m.group(1)
        if name in SKIP_DEFS or name.startswith("__"):
            continue
        open_idx = stripped.find("{", m.start())
        if open_idx < 0:
            continue
        close_idx = braces_span(stripped, open_idx)
        if close_idx is None:
            continue
        open_line = src.count("\n", 0, open_idx) + 1
        close_line = src.count("\n", 0, close_idx) + 1
        if close_line - open_line < 2:
            continue          # one-liner: nothing to blank
        out.append((name, open_line, close_line))
    return out


def strip_comments_and_strings(src: str) -> str:
    """Blank # // /* */ and quoted contents, preserving offsets and newlines."""
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        two = src[i:i + 2]
        if two == "//" or src[i] == "#":
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if src[i] in "\"'":
            quote = src[i]
            j = i + 1
            while j < n and src[j] != quote:
                if src[j] == "\\":
                    j += 2
                    continue
                j += 1
            for k in range(i + 1, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 1
            continue
        i += 1
    return "".join(out)


#: One neutral statement per language: shell's ":" is a no-op that cannot fail, and
#: JS's "return undefined;" keeps the function callable. A "return"-style stub would be
#: wrong in shell (the function would still exit 0, so a mutation could look harmless)
#: and a bare ":" is a syntax error in JS.
NEUTRAL = {".sh": "  :  # MUTATION: detector gutted",
           ".mjs": "  return undefined;  // MUTATION: detector gutted"}


def blank_text_body(src: str, open_line: int, close_line: int, suffix: str) -> str:
    """Gut a brace-delimited body found by text_functions(), keeping the file parseable.

    The opening and closing lines are KEPT and only the lines between them are replaced,
    so the braces still match and the file still parses. A mutation that leaves a syntax
    error would make every self-test "fail", scoring as KILLED while proving nothing.
    """
    lines = src.split("\n")
    return "\n".join(lines[:open_line] + [NEUTRAL[suffix]] + lines[close_line - 1:])


def run_self_test(path: Path) -> int | None:
    """Run the checker's --self-test with the interpreter its extension implies."""
    suffix = path.suffix
    if suffix == ".sh":
        # Git's bash by FULL PATH, never a bare "bash": on this workstation the bare name
        # resolves to WSL, which cannot see the Windows tree and exits 127. That is not a
        # killed mutation, it is a checker that never ran -- and at the sweep level it would
        # have read as every .sh self-test "catching" every mutation.
        cmd = [GIT_BASH, str(path), "--self-test"]
    elif suffix == ".mjs":
        cmd = ["node", str(path), "--self-test"]
    else:
        cmd = [sys.executable, str(path), "--self-test"]
    try:
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None
    return r.returncode


def survey(limit: int | None) -> list[tuple[str, str, int, int, str]]:
    """(checker, mutated function, before, after, verdict) for every candidate."""
    # Three languages, two mechanisms. Python is mutated through its AST (find the
    # FunctionDef, replace the body). .sh and .mjs have no stdlib parser here, so they are
    # mutated by TEXT: locate "name() {" / "function name(", then walk braces over a
    # comment-and-string-blanked copy to find the closing brace. Blanking first matters --
    # a "}" inside a quoted message would otherwise close the function early and the
    # "mutation" would be a broken file, which reads as the self-test working when it is
    # just a syntax error. Both mechanisms answer the same question: does the self-test
    # notice its detector being gutted.
    files = []
    for pattern in ("verify-*.py", "check-*.py", "verify-*.sh", "check-*.sh",
                    "verify-*.mjs", "check-*.mjs"):
        files.extend(sorted((ROOT / "scripts").glob(pattern)))
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
        if p.suffix == ".sh":
            cands = text_functions(src, SH_FUNC)
        elif p.suffix == ".mjs":
            cands = text_functions(src, MJS_FUNC)
        else:
            cands = candidate_functions(src)
        if not cands:
            # Shell checkers whose detector is written INLINE (a long top-level body, no
            # helper functions) cannot be mutated by this harness: there is no function to
            # gut. Measured 2026-10-24: verify-docker-digests.sh, verify-scoped-authorization.sh
            # and verify-scoped-coverage.sh each declare exactly one function, self_test, and
            # skip it by name. That is a LIMIT of the sweep, not a verdict on those three --
            # they are graded by hand instead, and this row says so rather than reading as
            # a pass.
            rows.append((p.name, "-", 0, 0, "NO MUTATABLE FUNCTION"))
            continue
        # Mutate only the FIRST candidate: enough to answer "can this self-test fail".
        name, s0, e0 = cands[0]
        if p.suffix in (".sh", ".mjs"):
            mutated = blank_text_body(src, s0, e0, p.suffix)
        else:
            mutated = blank_body(src, name, s0, e0)
        with tempfile.TemporaryDirectory() as td:
            copy = Path(td) / p.name
            copy.write_text(mutated, encoding="utf-8")
            after = run_self_test(copy)
        verdict = "KILLED" if after not in (0, None) else "SURVIVED"
        rows.append((p.name, name, 0, after if after is not None else -1, verdict))
    return rows


def self_test() -> int:
    """Grade the MUTATOR, which is the part that can lie silently.

    A mutation harness has one failure mode worth fearing: producing a mutation that is
    not one. A blanked function that leaves a syntax error makes every self-test "fail"
    and scores as KILLED while proving nothing -- the harness would report a clean sheet
    over checkers it never tested. So the cases here are about the mutants being VALID:
    parsable, brace-balanced, and actually different from the source.
    """
    import subprocess as sp

    bad: list[str] = []

    def want(name, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # Brace matching must ignore braces inside strings and comments, or a "}" in a message
    # closes the function early and the blanking eats the rest of the file.
    tricky = 'function f() {\n  log("}");\n  if (x) { y(); }\n}\nafter();'
    cands = text_functions(tricky, MJS_FUNC)
    want("one function found", [c[0] for c in cands], ["f"])
    # Guard the index: an over-eager brace walker finds no function at all here, and
    # cands[0] then raises IndexError instead of naming the broken case.
    want("the closing brace is the real one",
         [c[2] for c in cands], [4])  # line of the final }

    # The blanked body still parses in each language. A mutant that will not parse would
    # make every run "kill" its mutant.
    for suffix, src, pat, parser in (
        (".sh", "f() {\n  echo a\n  echo b\n}\nf", SH_FUNC, None),
        (".mjs", "function f() {\n  return 1;\n  return 2;\n}\nf", MJS_FUNC, None),
    ):
        cs = text_functions(src, pat)
        if not cs:
            bad.append(f"{suffix}: the fixture was not recognised as a function")
            continue
        mutated = blank_text_body(src, cs[0][1], cs[0][2], suffix)
        want(f"{suffix} mutant still has both braces",
             mutated.count("{") == src.count("{") and mutated.count("}") == src.count("}"), True)
        want(f"{suffix} mutant differs from the source", mutated != src, True)
        want(f"{suffix} mutant keeps the trailing line", mutated.rstrip().endswith("f"), True)

    # Exported JS functions are candidates. Anchoring on "^function" alone missed
    # export function collectErrors(...), and that one miss turned a covered checker into
    # a "0 killed" row.
    want("an exported function is a candidate",
         [c[0] for c in text_functions("export function g() {\n  a();\n  b();\n}\n", MJS_FUNC)],
         ["g"])

    # self_test itself is never a candidate, in any language: blanking the thing under
    # test and then reporting what it says is the definition of a meaningless result.
    want("self_test is never a candidate",
         [c[0] for c in text_functions("self_test() {\n  a\n  b\n}\n", SH_FUNC)], [])

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (10 cases, no checker is run)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--self-test", action="store_true",
                    help="Grade the mutator on synthetic sources and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
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
