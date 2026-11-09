"""Fail when a real `unsafe` construct lacks a `// SAFETY:` justification.

Why this exists.  P2-6 put `#![deny(unsafe_code)]` at 38 of 43 crate roots, so
the crates that carry NO unsafe cannot grow any.  But five roots legitimately
keep unrestricted unsafe — `kasirmu-logging` (syslog/eventlog FFI),
`kasirmu-security` (Win32 Credential Manager), `kasirmu-hal` (JNI, Bluetooth),
`kasirmu-lua` (`unsafe impl Send/Sync`), and the Tauri shells
(`#[unsafe(link_section)]`).  A deny cannot protect those, and nothing else did:
measured 2026-09-27, no script and no gates.json entry mentioned SAFETY at all.

So the only thing standing between a new `unsafe` block in those files and a
reviewer who never sees a justification was the reviewer's eye.  This makes it
mechanical: every real construct must carry a `SAFETY:` marker nearby.

WHAT COUNTS AS "REAL".  Grepping `unsafe` is nearly useless here — this repo's
audit stamps are doc comments that SAY "no unsafe in production paths" or "8
unsafe blocks (not 6 — prior stamp miscount)", and a naive match counts all of
them.  The same trap made an earlier `unsafe` inventory report 27 sites where
the true count was 7 directories.  This script therefore matches CONSTRUCTS
only: `unsafe {`, `unsafe fn/impl/trait/extern`, `#[unsafe(...)]`, and the
`#![deny|allow(unsafe_code)]` attributes themselves (which are declarations, not
constructs, and are skipped).

WHERE THE MARKER MAY SIT.  Same line, or anywhere in the preceding 12 lines of
the enclosing statement.  The 12-line window is deliberate and was measured: a
strict "same or immediately preceding line" rule produced 12 false positives on
2026-09-27, because this repo documents a whole statement GROUP above the first
of several `unsafe` calls (`db_tests.rs:160-170` justifies four separate
`env::set_var`/`remove_var` calls in one comment block, and `windows.rs:66-73`
justifies a multi-line `unsafe` block from six lines up).  Narrowing the window
would fight the code's actual documentation style.

Exit 0 = every real construct carries a marker; 1 = at least one does not, or
the tree could not be read.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Where the ladder's fixtures are written when the host sets a temp variable (a
#: confined host denies its default temp); unset leaves tempfile's own default in
#: force (the r166 contract, shared with verify-runner-claims.py).
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's ladder fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir removed between runs otherwise makes
    EVERY fixture die with FileNotFoundError before it grades anything. exist_ok keeps
    the common case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root

# A real construct. Order matters only for readability.
#
# The `unsafe fn|impl|trait|extern` arm is ANCHORED (`^`) after optional
# whitespace. That anchor is load-bearing and was added after this script
# reported five false positives on 2026-09-27 — all of them comment text or
# string literals DESCRIBING `unsafe impl Send/Sync`, including
# `kasirmu-lua/src/lib.rs:106` (a comment explaining the crate deliberately
# does NOT implement it) and a test assertion at `lib_tests.rs:22-23` whose
# literal starts with that exact phrase. An unanchored `\bunsafe\s+impl\b`
# matches the checker's own subject matter.
#
# `unsafe {` stays unanchored: it legitimately appears mid-expression
# (`let x = unsafe { .. }`, `Some(v) => unsafe { .. }`), and comment lines are
# filtered separately below.
CONSTRUCT_RE = re.compile(
    r"""
    \#\[unsafe\(                                  # #[unsafe(no_mangle)] etc.
    | \bunsafe\s*\{                               # unsafe { ... }
    | ^\s*unsafe\s+(fn|impl|trait|extern)\b       # a real item, not prose
    """,
    re.VERBOSE,
)

# Comment lines are never constructs, however much they discuss them. This is
# the second half of the prose defence: it covers `unsafe {` inside a comment,
# which the anchor above cannot.
COMMENT_RE = re.compile(r"^\s*(//|/\*|\*)")

# Declarations, not constructs — they have no body to justify.
ATTRIBUTE_RE = re.compile(r"#!\[(deny|allow)\(unsafe_code\)\]")

SAFETY_RE = re.compile(r"SAFETY")

# How far back to look for the marker. See the module docstring for why 12.
LOOKBACK = 12

# Files that are documentation ABOUT unsafe rather than code containing it.
SKIP_PATH_PARTS = ("/target/",)


def scan(root: Path) -> tuple[list[str], int]:
    """Return (findings, constructs_seen).

    A finding is `path:line: construct` for a construct with no nearby marker.
    """
    # r272: git grep exits 1 when it matches NOTHING, and that is not a failure --
    # it is a tree with no `unsafe` in any .rs file, which for a fully-denied crate
    # set is the expected state. With check=True it raised CalledProcessError, and
    # main() reported "FAIL could not list sources", indistinguishable from a broken
    # scan, at rc 1 where a scope refusal would mean rc 2. Measured 2026-11-09:
    # `git grep -l -E unsafe -- '*.rs'` returns 1 in a repo whose one file lacks the
    # word, and 0 in any populated one. Only a real error (not 1) is still raised.
    proc = subprocess.run(
        ["git", "grep", "-l", "-E", "unsafe", "--", "*.rs"],
        cwd=root, capture_output=True, text=True,
    )
    if proc.returncode not in (0, 1):
        raise subprocess.CalledProcessError(
            proc.returncode, proc.args, proc.stdout, proc.stderr)
    files = proc.stdout.split()

    findings: list[str] = []
    seen = 0

    for rel in files:
        if any(part in rel for part in SKIP_PATH_PARTS):
            continue
        path = root / rel
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue

        for idx, line in enumerate(lines):
            if ATTRIBUTE_RE.search(line):
                continue
            if COMMENT_RE.match(line):
                continue
            if not CONSTRUCT_RE.search(line):
                continue
            seen += 1

            # Same line, or anywhere in the preceding LOOKBACK lines.
            window = lines[max(0, idx - LOOKBACK) : idx + 1]
            if any(SAFETY_RE.search(w) for w in window):
                continue
            findings.append(f"{rel}:{idx + 1}: {line.strip()[:80]}")

    return findings, seen


def self_test() -> int:
    """Prove both directions on synthetic sources.

    A gate proven only in the pass direction is decoration: without case (2)
    this script would exit 0 on a tree it never actually checked.
    """
    failures: list[str] = []

    def expect(label: str, cond: bool) -> None:
        print(f"  {'ok  ' if cond else 'FAIL'}  {label}")
        if not cond:
            failures.append(label)

    # (1) a marked construct is clean.
    marked = [
        "// SAFETY: the pointer is non-null because the API contract says so.",
        "let x = unsafe { std::slice::from_raw_parts(p, 1) };",
    ]
    expect("a construct with a marker on the preceding line is not reported",
           not _has_finding(marked, 1))

    # (2) an unmarked construct IS reported — the direction that matters.
    unmarked = [
        "let x = 1;",
        "let y = unsafe { foo() };",
    ]
    expect("an unmarked construct IS reported", _has_finding(unmarked, 1))

    # (3) the marker may sit several lines up, as this repo actually documents.
    grouped = [
        "// SAFETY: env mutation serialized by ENV_LOCK.",
        "unsafe { std::env::set_var(\"A\", \"1\") };",
        "unsafe { std::env::set_var(\"B\", \"2\") };",
        "unsafe { std::env::remove_var(\"A\") };",
    ]
    expect("one marker covers a documented group of constructs",
           not _has_finding(grouped, 1) and not _has_finding(grouped, 3))

    # (4) the window is finite: a marker 20 lines up does NOT count.
    far = ["// SAFETY: stale, belongs to something else."] + ["let x = 0;"] * 20 + [
        "let y = unsafe { foo() };",
    ]
    expect("a marker outside the lookback window does NOT count",
           _has_finding(far, 21))

    # (5) an attribute declaration is not a construct.
    decl = ["#![allow(unsafe_code)]", "#![deny(unsafe_code)]"]
    expect("crate-level `deny`/`allow(unsafe_code)` are not constructs",
           not _matches(decl[0]) and not _matches(decl[1]))

    # (6) the attribute form of a real construct IS matched.
    for form in ('#[unsafe(no_mangle)]', '#[unsafe(link_section = ".drectve")]'):
        expect(f"`{form}` is recognised as a construct", bool(CONSTRUCT_RE.search(form)))

    # (7) prose ABOUT unsafe is not a construct — the trap that made an earlier
    #     inventory over-count by 3x, and that this script itself fell into on
    #     first run (5 false positives, all in kasirmu-lua).
    for prose in (
        "//! findings: zero unsafe, no FFI/IO",
        "/// 8 unsafe blocks (not 6 — prior stamp miscount)",
        "// no unsafe code here",
        # The exact text that produced the measured false positives.
        "// `unsafe impl Sync` here on the strength of a comment claiming \"used behind a",
        "// by hand. `mlua::Lua` is `Send` (the `send` feature) but is NOT `Sync`,",
        '        !trimmed.starts_with("unsafe impl Sync for LuaRuntime")',
    ):
        expect(f"prose is not a construct: {prose[:38]!r}", not _matches(prose))

    # (7b) but a REAL item at statement position still matches, so the anchor
    #      above did not simply disable the arm.
    for real in (
        "unsafe impl Send for LuaRuntime {}",
        "    unsafe fn raw_handle(&self) -> *mut c_void {",
        "unsafe trait Marker {}",
    ):
        expect(f"a real item IS a construct: {real[:38]!r}", _matches(real))

    # (7c) and an `unsafe {` mid-expression still matches, since it is routinely
    #      written after `=`, `=>` or `(`.
    for mid in (
        "let x = unsafe { foo() };",
        "Some(v) => unsafe { std::env::set_var(k, v) },",
    ):
        expect(f"a mid-expression block IS a construct: {mid[:34]!r}", _matches(mid))

    # (8) THE WHOLE PIPELINE, over a scratch repository. The sabotage sweep found `scan`
    # SURVIVED on 2026-11-06: replacing its body with `return [], 0` left this self-test
    # green, because every case above grades _matches()/_has_finding() and none graded the
    # git grep, the file read, or the loop joining them. A self-test that never runs the
    # function under test cannot notice it being gutted -- so this case builds a real
    # one-file repository and asserts BOTH directions through scan().
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        (scratch / "probe.rs").write_text(
            "fn unmarked() {\n"
            "    let y = unsafe { foo() };\n"
            "}\n"
            "\n"
            "fn marked() {\n"
            "    // SAFETY: the API contract guarantees non-null.\n"
            "    let x = unsafe { bar() };\n"
            "}\n",
            encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=scratch, check=True)
        subprocess.run(["git", "add", "probe.rs"], cwd=scratch, check=True)
        found, seen_constructs = scan(scratch)
        expect("scan() over a scratch repo reports the unmarked construct only",
               len(found) == 1 and "probe.rs:2" in found[0] and seen_constructs == 2)

    print()
    if failures:
        print(f"self-test: FAIL ({len(failures)})")
        return 1
    # r193: main()'s shell -- argv and root graded against tempdir GIT
    # repositories (scan() uses git grep, so plain directories will not do),
    # the r166..r192 pattern. The prose-only and unmarked cases both kill a
    # root-dropping main: the real tree has justified constructs everywhere,
    # so it returns 0 against want 1.
    import contextlib as _ctx
    import io as _io
    shell = 0
    def _shell(files):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            subprocess.run(["git", "init", "-q"], cwd=base, check=True)
            subprocess.run(["git", "add", "."], cwd=base, check=True)
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    MARKED = ("fn f() {" + chr(10)
              + "    // SAFETY: the API contract guarantees non-null." + chr(10)
              + "    let x = unsafe { bar() };" + chr(10)
              + "}" + chr(10))
    UNMARKED = ("fn g() {" + chr(10)
                + "    let y = unsafe { foo() };" + chr(10)
                + "}" + chr(10))
    PROSE = "// no unsafe code here, honest" + chr(10)
    shell += 1
    rc, text = _shell({"probe.rs": MARKED})
    if rc != 0 or "(1 construct(s), every one justified)" not in text:
        print("  x a justified construct must read OK with its census (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"probe.rs": UNMARKED})
    if rc != 1 or "probe.rs:2" not in text or "lack a " not in text:
        print("  x an unmarked construct must fail naming file:line (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"probe.rs": PROSE})
    if rc != 1 or "no unsafe constructs found anywhere" not in text:
        print("  x prose-only matches give an EMPTY population, rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    # the /target/ skip is graded through main: an unmarked construct under a
    # NESTED target/ must vanish, while the marked one at the root still counts.
    # (git grep prints root-relative paths, so a root-level target/ never
    # carries the leading slash the constant matches -- nested is the shape
    # the constant actually guards.)
    rc, text = _shell({"probe.rs": MARKED, "crates/demo/target/skip.rs": UNMARKED})
    if rc != 0 or "(1 construct(s), every one justified)" not in text:
        print("  x a construct under /target/ must be skipped (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    print("self-test: all cases passed -- reports an unmarked construct, "
          "accepts a documented group, does not count prose, and grades its "
          "own shell exits (%d shell cases)" % shell)
    # r271: the ladder is CALLED, not merely defined. r263 measured the failure
    # this line prevents -- a ladder that existed, was counted by the census, and
    # never ran, so "--self-test" printed the case line and nothing else.
    return shell_ladder()


#: The re-entry guard (the r228 pattern): rung 5 drives --self-test through argv from
#: inside the ladder, and self_test() ends in the call below.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard: a nested self-test (rung 5) must not run a SECOND ladder."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r271: the root contract, graded on fixture repositories driven through main().

    Every rung builds a real git repository under fixture_root() -- scan() shells out
    to `git grep`, so a plain directory will not do -- and hands it to
    main(argv=[...], root=fixture), capturing both streams. The four shell cases above
    already do this shape for one file each; the ladder keeps its own copy here so a
    gutted `_shell` above is caught by rungs that do not depend on it.

    Rung 1 is the killing rung, and what it grades is stated exactly as measured
    (r271): a main() that reads the REAL repository instead of its `root` cannot
    print a VERDICT over the fixture while the fixture's analysis honours `root`.
    Measured with the mutant prove-ladder-kills applies (`base = ROOT`):
    "FAIL  could not list sources: ... returned non-zero exit status 1" -- the
    refusal branch, never the "1 of 1 ... lack a `SAFETY:`" line. The rung therefore
    requires the fixture's verdict and rejects that refusal by name, instead of
    pretending the shape dies on a verdict it cannot produce. Rung 2 supplies the
    positive direction: a fixture whose only construct IS marked must go GREEN with
    the fixture's census, which no root-blind main() can do (this checkout reports 43).
    """
    import contextlib
    import io
    import tempfile

    FIXTURE = (chr(10).join([
        "fn marked() {",
        "    // SAFETY: the API contract guarantees non-null.",
        "    let x = unsafe { bar() };",
        "}",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "fn unmarked() {",
        "    let y = unsafe { foo() };",
        "}",
        "",
    ]))
    CLEAN = (chr(10).join([
        "fn marked() {",
        "    // SAFETY: the API contract guarantees non-null.",
        "    let x = unsafe { bar() };",
        "}",
        "",
    ]))
    # The prose still CONTAINS the word, so git grep lists the file and scan()
    # counts zero constructs -- the only way the empty-population branch is reached
    # (a file with no match at all makes git grep exit 1, i.e. the refusal branch).
    PORTAL = "// nothing gated here, no unsafe construct in this file" + chr(10)

    def build(tmp, label, files):
        """A real (empty) git repository holding one fixture file, so git grep works."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_", ))
        for rel, text in files.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text, encoding="utf-8", newline=chr(10))
        subprocess.run(["git", "init", "-q"], cwd=base, check=True,
                       capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=base, check=True,
                       capture_output=True)
        return base

    def run_over(root, *argv):
        """main() against one fixture, both streams captured, argv and root explicit."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = main(argv=list(argv), root=root)
        return rc, out.getvalue()

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung. The fixture is FOUND (one unmarked construct)
        # and the verdict must name it; a main() that analyses the real repository
        # instead dies in the refusal branch, which this rung names as the failure.
        root = build(tmp, "one", {"probe.rs": FIXTURE})
        rc, said = run_over(root)
        if (rc != 1 or "1 of 2 unsafe construct(s)" not in said
                or "probe.rs:15" not in said):
            why = ("the refusal branch ran, so the analysis ignored root"
                   if "could not list sources" in said else "no verdict over the fixture")
            print('  x rung 1: a fixture with one unmarked construct must read '
                  '"unsafe-safety FAIL: 1 of 2 unsafe construct(s) ..." naming '
                  'probe.rs:15 (rc=%r, %s, said=%r)'
                  % (rc, why, said[-300:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 2 -- the clean arm: one MARKED construct is rc 0 with the FIXTURE's
        # census. This checkout prints 43, so a root-blind main() cannot produce
        # this line either.
        root = build(tmp, "two", {"probe.rs": CLEAN})
        rc, said = run_over(root)
        if rc != 0 or "(1 construct(s), every one justified)" not in said:
            print('  x rung 2: a fixture with one justified construct must read '
                  '"(1 construct(s), every one justified)" rc 0 (rc=%r said=%r)'
                  % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 3 -- an EMPTY population is not a pass: a repository whose only
        # match is prose must fail with exactly that message, not exit 0.
        root = build(tmp, "three", {"prose.rs": PORTAL})
        rc, said = run_over(root)
        if rc != 1 or "no unsafe constructs found anywhere" not in said:
            print('  x rung 3: a prose-only fixture must read "no unsafe constructs '
                  'found anywhere" rc 1 (rc=%r said=%r)' % (rc, said[-300:]),
                  file=sys.stderr)
            return 1
        shell += 1

        # rung 4 -- the /target/ skip through main(), the shape scan() actually
        # guards: git grep prints root-relative paths, so only a NESTED target/
        # carries the leading slash SKIP_PATH_PARTS matches. The marked construct
        # at the root must still be the whole census.
        root = build(tmp, "four", {"probe.rs": CLEAN,
                                   "crates/demo/target/skip.rs": FIXTURE})
        rc, said = run_over(root)
        if rc != 0 or "(1 construct(s), every one justified)" not in said:
            print('  x rung 4: an unmarked construct under a NESTED target/ must be '
                  'skipped (rc=%r said=%r)' % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 5 -- argv --self-test through main(): rc 0, and self_test() ends at
        # the ladder's re-entry guard instead of running a second ladder.
        own_stdout, own_stderr = sys.stdout, sys.stderr
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                rc = main(argv=["--self-test"])
        except SystemExit as se:
            rc = se.code
        finally:
            # A nested run leaves ITS stream installed; restore the one this rung was
            # entered with so it never lends main() a closed buffer.
            sys.stdout, sys.stderr = own_stdout, own_stderr
        if rc != 0:
            print('  x rung 5: --self-test through argv must pass rc 0 and skip the '
                  'nested ladder (rc=%r)' % (rc,), file=sys.stderr)
            return 1
        shell += 1

    print("SELF-TEST LADDER OK (%d fixture-repository rungs through main())" % shell)
    return 0


def _matches(line: str) -> bool:
    """Same predicate scan() uses: not a declaration, not a comment, a construct."""
    if ATTRIBUTE_RE.search(line) or COMMENT_RE.match(line):
        return False
    return bool(CONSTRUCT_RE.search(line))


def _has_finding(lines: list[str], idx: int) -> bool:
    """Mirror scan()'s window rule for one synthetic site."""
    window = lines[max(0, idx - LOOKBACK) : idx + 1]
    return not any(SAFETY_RE.search(w) for w in window)


def main(argv=None, root=None) -> int:
    """r193: argv and root parameterized, the r166..r192 contract -- the
    scanned tree is the contract root (git grep runs with cwd=root and every
    path resolves under it)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="prove both directions on synthetic sources, then exit")
    ns = ap.parse_args(argv)

    if ns.self_test:
        return self_test()
    base = ROOT if root is None else Path(root).resolve()

    try:
        findings, seen = scan(base)
    except subprocess.CalledProcessError as e:
        print(f"FAIL  could not list sources: {e}", file=sys.stderr)
        return 1

    if seen == 0:
        print(
            "FAIL  no unsafe constructs found anywhere in the tree. That is "
            "either a genuine surprise or a broken scan (the grep found nothing, "
            "so nothing was checked). An empty population is not a pass.",
            file=sys.stderr,
        )
        return 1

    if findings:
        print(
            f"unsafe-safety FAIL: {len(findings)} of {seen} unsafe construct(s) "
            f"lack a `SAFETY:` comment within {LOOKBACK} lines:"
        )
        for f in findings:
            print("  " + f)
        print(
            "\nFix: add a `// SAFETY:` line stating why the construct is sound, "
            "or add the crate to the deny list if it needs no unsafe at all."
        )
        return 1

    print(f"unsafe-safety: OK ({seen} construct(s), every one justified).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
