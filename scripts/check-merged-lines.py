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
import io
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOTS = ["ui/src"]
SKIP_DIRS = {"node_modules", "target", ".git", "dist", "build"}

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root() -> str | None:
    """The temp root this file's fixtures are written under (None = system default)."""
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)

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
    # r179: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r178 pattern. The REFUSED arm and both verdicts go through
    # main, which the scan_source cases above never reach.
    import contextlib as _ctxlib
    import io as _io
    import tempfile as _tempfile
    shell = 0   # the shell cases below count themselves; the OK line must not guess
    def _shell(files):
        with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                           ignore_cleanup_errors=True) as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    shell += 1
    rc, text = _shell({"ui/src/x/A.tsx": "  const a = useRef(0);  useEffect(() => {\n"})
    if rc != 1 or "ui/src/x/A.tsx:1" not in text:
        bad += 1
        print("  %-52s FAIL (rc=%d text=%r)" % ("a merged line through main() exits 1 naming it", rc, text[-80:]))
    shell += 1
    rc, text = _shell({"ui/src/x/Clean.tsx": "  const a = useRef(0);\n  useEffect(() => {\n"})
    if rc != 0 or "no merged statements found" not in text:
        bad += 1
        print("  %-52s FAIL (rc=%d text=%r)" % ("a clean fixture through main() exits 0", rc, text[-80:]))
    shell += 1
    with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            rc = main(argv=[], root=td)
        if rc != 2 or "REFUSED" not in (out.getvalue() + err.getvalue()):
            bad += 1
            print("  %-52s FAIL (rc=%d)" % ("a missing ui/src is REFUSED with exit 2", rc))

    print("SELF-TEST %s (%d matcher cases + %d shell cases, no repo files touched)"
          % ("FAILED" if bad else "OK", len(cases), shell))
    return 1 if bad else shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r235 -- the r228 lesson).

    Rung 8 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. The guard turns it into a printed skip.
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
    """r235: the root contract, graded on fixture ui/src trees through main().

    Rung 1 IS the killing rung. `ui/src` in this checkout currently carries no
    merged statement, so a main() that ignored its root would scan the real
    tree, print "no merged statements found" and exit 0 against a fixture that
    contains one. The fixture must exit 1 naming `ui/src/x/A.tsx:1`.

    Rungs 4 and 5 grade the SCOPE decisions the docstring argues for, which no
    case executed before this round: a merged line outside `ui/src` is not
    scanned (the round-125 measurement that kept the gate TypeScript-only),
    and a file under a SKIP_DIR is never read even when it is inside one.
    """
    import contextlib
    import tempfile

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} source files."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
        return base

    MERGED = "  const a = useRef(0);  useEffect(() => {\n"
    CLEAN = "  const a = useRef(0);\n  useEffect(() => {\n"

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the fixture's merge is what gets reported.
        root = build(tmp, {"ui/src/x/A.tsx": MERGED})
        rc, said = run(root)
        if rc != 1 or "ui/src/x/A.tsx:1" not in said:
            print("  x rung 1: a merged fixture line must exit 1 naming it "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a clean fixture greens, and the scan count is the fixture's.
        root = build(tmp, {"ui/src/x/Clean.tsx": CLEAN})
        rc, said = run(root)
        if rc != 0 or "scanned 1 .ts/.tsx file(s)" not in said:
            print("  x rung 2: a clean fixture must exit 0 counting one file "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: no ui/src under the fixture root.
        base = Path(tempfile.mkdtemp(dir=tmp, prefix="empty_"))
        rc, said = run(base)
        # r241 (review): asserted on the ACTUAL refusal text, not a bare
        # "REFUSED" token. A main that refused with any other wording still
        # satisfied the old operand, so the rung graded "something went wrong"
        # rather than "this gate refused for this reason".
        if rc != 2 or "is not a directory" not in said:
            print("  x rung 3: a fixture without ui/src must refuse rc 2 naming why "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- scope: the same merge outside ui/src is not this gate's job.
        root = build(tmp, {"ui/src/x/Clean.tsx": CLEAN, "others/B.tsx": MERGED})
        rc, said = run(root)
        if rc != 0 or "scanned 1 .ts/.tsx" not in said:
            print("  x rung 4: a merge outside ui/src must not be scanned "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- SKIP_DIR: node_modules under ui/src is never read.
        root = build(tmp, {"ui/src/x/Clean.tsx": CLEAN,
                           "ui/src/node_modules/dep/C.tsx": MERGED})
        rc, said = run(root)
        if rc != 0 or "scanned 1 .ts/.tsx" not in said:
            print("  x rung 5: a file under node_modules must never be read "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6 -- a file that is not .ts/.tsx is not scanned even when merged.
        root = build(tmp, {"ui/src/x/notes.md": MERGED, "ui/src/x/A.tsx": CLEAN})
        rc, said = run(root)
        if rc != 0 or "scanned 1 .ts/.tsx" not in said:
            print("  x rung 6: only .ts/.tsx is in scope "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 7 -- --quiet keeps the verdict and the exit code, drops the count.
        root = build(tmp, {"ui/src/x/A.tsx": MERGED})
        rc, said = run(root, "--quiet")
        if rc != 1 or "scanned" in said or "ui/src/x/A.tsx:1" not in said:
            print("  x rung 7: --quiet must stay exit 1 naming the file, without the "
                  "scan line (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 8 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {"ui/src/x/Clean.tsx": CLEAN})
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 8: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("MERGED-LINES SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r179: argv and root parameterized, the r166..r178 contract -- root
    redirects the sweep AND the reported paths, so a fixture cannot half-run
    against the real ui tree."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="prove the matcher on both directions, touch no files")
    ap.add_argument("--quiet", action="store_true", help="only report findings")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    root_path = ROOT if root is None else Path(root).resolve()
    findings = []
    scanned = 0
    for rel in SCAN_ROOTS:
        base = root_path / rel
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
                    findings.append((p.relative_to(root_path).as_posix(), ln, text))

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
