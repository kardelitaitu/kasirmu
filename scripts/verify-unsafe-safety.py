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
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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
    files = subprocess.run(
        ["git", "grep", "-l", "-E", "unsafe", "--", "*.rs"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout.split()

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

    print()
    if failures:
        print(f"self-test: FAIL ({len(failures)})")
        return 1
    print("self-test: all cases passed -- reports an unmarked construct, "
          "accepts a documented group, and does not count prose")
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="prove both directions on synthetic sources, then exit")
    ns = ap.parse_args()

    if ns.self_test:
        return self_test()

    try:
        findings, seen = scan(ROOT)
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
