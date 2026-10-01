#!/usr/bin/env python3
"""Detect two statements merged onto one source line by a code generator.

WHY THIS EXISTS
===============

A helper that assembles a patch with `"\n".join([...])` and forgets a TRAILING empty
element makes its last line merge into whatever follows. The result is a perfectly
valid source line:

    const shiftSeq = useRef(0);  useEffect(() => {

It compiles, it lints, it typechecks, and every test passes. Nothing in the seven
pre-commit steps, eslint, tsc, or the suite distinguishes `a();  b()` from the same
two statements on separate lines, so damage of this kind survives every gate the
project runs.

It has happened at least three times, all from agents writing patches through
generators rather than editors:

  e51512cf4  RetailPosScreen.tsx, usePosShifts.ts -- two `useRef(0);  useEffect` merges
  3e352058b  NodeTopologyEditor.tsx -- `l10nRef.current = l10n;    const { settings } ...`

The last one was a directory-rename commit and sat in HEAD through several later
verification cycles. It was found by reading, not by any check.

WHAT IT CHECKS
==============

TWO STATEMENTS ON ONE LINE, in `.ts`/`.tsx` under `ui/src`, reported when the first
half ENDS a statement or a line comment and the second half BEGINS a declaration or a
call. The two-sided shape is what separates a real merge from prose that quotes code,
which is the only false-positive class observed: three JSDoc/doc-comment lines in
`ui/src/__tests__` mention code after a comment marker and are NOT findings, so the
comment arm additionally requires the line not to begin with a comment marker.

Run over the whole repository at the time of writing it reports zero findings, so it
starts green. That is a property worth stating: a gate that begins life red gets
disabled, which is the lesson from the over-broad async-overlap scan considered and
rejected in round 80.

WHY ONLY `.ts`/`.tsx`, measured rather than assumed (round 125). The generator that caused
this wrote `.rs`, `.py` AND `.sh` as well, so the risk was NOT obviously TypeScript-only
and the scope was checked before being left alone. A sweep of every `.rs`/`.py`/`.sh` in
the repository for the same two-statement signature returned ZERO candidates, while the
same sweep over `ui/src` had found six. So the damage was confined to TypeScript in
practice, and widening this gate would add three languages of pattern surface for a class
that has never occurred in them.

If a merged line is ever found in one of those languages, widen SCAN_ROOTS and the
suffix list TOGETHER -- the two-sided shape is what keeps the false-positive rate at the
three doc-comment lines above, and a looser pattern for a new language would trade that
away for coverage of a class that has not been seen there.

Exit 0 clean, 1 finding(s), 2 self-test or usage failure.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOTS = ["ui/src"]
SKIP_DIRS = {"node_modules", "target", ".git", "dist", "build"}

# first half ends a statement, second half begins a declaration
STMT_DECL = re.compile(
    r";\s{2,}(?:const|let|var|useEffect|useState|useRef|useCallback|useMemo|"
    r"function|if|for|while|return|throw|await)\b"
)
# a line comment whose text is then followed by real code on the SAME line
COMMENT_CODE = re.compile(
    r"^\s*//.*\S\s{2,}(?:const|let|var|useEffect|useState|useRef|useCallback|"
    r"return|if|setTimeout|closeHistory)\b"
)


def scan_source(src: str):
    """Return (line_no, text) for each merged line."""
    out = []
    for i, line in enumerate(src.split("\n")):
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue  # a pure doc line quoting code is not a merge
        if "<<<" in line or ">>>" in line:
            continue  # merge-conflict remnants are a different checker's job
        if STMT_DECL.search(line) or COMMENT_CODE.search(line):
            out.append((i + 1, line.strip()[:96]))
    return out


def _self_test() -> int:
    cases = []

    def add(name, src, want):
        got = len(scan_source("\n".join(src)))
        cases.append((name, got == want, got, want))

    add("a declaration merged after a semicolon IS found", [
        "  const a = useRef(0);  useEffect(() => {",
    ], 1)
    add("the same two statements on separate lines is NOT found", [
        "  const a = useRef(0);",
        "  useEffect(() => {",
    ], 0)
    add("an assignment merged into a declaration IS found", [
        "  l10nRef.current = l10n;    const { settings } = useSettings();",
    ], 1)
    add("a doc line quoting code is NOT found", [
        "//   :467  if (!sessionToken) { setLoyaltyAccount(null); return; }",
    ], 0)
    add("a JSDoc usage example is NOT found", [
        "//!   const { container } = renderWithProviders(<MyScreen />);",
    ], 0)
    add("a semicolon with a comment after it is NOT found", [
        "  doThing();  // then stop",
    ], 0)
    add("a merge conflict marker is NOT found", [
        "<<<<<<< HEAD  const a = 1;",
    ], 0)

    bad = 0
    for name, ok, got, want in cases:
        if not ok:
            bad += 1
            print("  %-52s FAIL (got %d, want %d)" % (name, got, want))
        else:
            print("  %-52s ok" % name)
    print("SELF-TEST %s (%d cases, no files touched)"
          % ("FAILED" if bad else "OK", len(cases)))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="prove the matcher on both directions, touch no files")
    ap.add_argument("--quiet", action="store_true", help="only report findings")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()

    findings = []
    scanned = 0
    for rel in SCAN_ROOTS:
        base = ROOT / rel
        if not base.is_dir():
            print("REFUSED: %s is not a directory" % base, file=sys.stderr)
            return 2
        for dp, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if not f.endswith((".ts", ".tsx")):
                    continue
                scanned += 1
                p = Path(dp) / f
                for ln, text in scan_source(p.read_text(encoding="utf-8", errors="replace")):
                    findings.append((p.relative_to(ROOT).as_posix(), ln, text))

    if not args.quiet:
        print("scanned %d .ts/.tsx file(s) under %s" % (scanned, ", ".join(SCAN_ROOTS)))

    if findings:
        print("%d line(s) with two statements merged:" % len(findings))
        for p, ln, text in findings[:40]:
            print("  %s:%d" % (p, ln))
            print("      %s" % text)
        if len(findings) > 40:
            print("  ... and %d more" % (len(findings) - 40))
        print("")
        print("Split the line: the second half is a separate statement that a generator")
        print("joined to the first. Whitespace only -- no behaviour change.")
        return 1

    if not args.quiet:
        print("no merged statements found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
