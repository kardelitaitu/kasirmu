#!/usr/bin/env python3
"""Workspace-wide inventory of production (non-test) unwrap()/expect() calls.

Scans crates/, apps/, platform/, modules/ for *.rs and reports every
unwrap()/expect() that appears OUTSIDE of test contexts:

  * files under */tests/ (integration test dirs)
  * `#[cfg(test)]` blocks (attribute may precede `mod` or `fn`)
  * `mod tests` / `mod test` blocks
  * `#[test]`-annotated functions

Classification hint: a `# SAFETY:`/`// INVARIANT:` comment on the same line
or the line above marks a documented invariant panic. The script prints
`[INVARIANT]` when such a comment is found so reviewers can distinguish
intentional setup panics from recoverable runtime panics.

Exit code 0 = inventory generated AND the strictness contract held: the recoverable
set (findings lacking a documented invariant comment) is at or below this run's
tolerance, which is 0 unless an operator raises it with --allow-recoverable N.
Exit code 1 = the recoverable set went past that tolerance (ADR #33: it stays at
zero). THIS IS THE DEFAULT -- the scan is strict unless told otherwise.
Exit code 2 = a REFUSED command line, not a failed check: the `--roots` list resolved
to no directory to scan so there was no inventory to report; or it resolved only
PARTIALLY, one named root missing or blank, which would otherwise report a starved
corpus as though it were the whole surface; or `--allow-recoverable` was handed a
negative N, which forgives nothing and would fail a clean tree. A refusal prints no
call count on any stream, because a count is what a clean scan looks like.

STRICT IS THE DEFAULT, NOT A FLAG
=================================

`--fail-on-recoverable` used to be the only way to get a verdict that could be red,
which made the green a property of a command line rather than of the tree: every
invocation that omitted the flag -- a human re-running the gate, the recipe at
scripts/diagnose-pr.py:36, and the `--json` re-measure instruction named in ADR #33 --
printed a clean-looking inventory over a tree that held undocumented panics. The
strictness is now the behaviour itself, and `--fail-on-recoverable` stays accepted as
an inert alias so the existing call sites (scripts/check.sh, dev-ci.yml#static-gates)
keep running unchanged. An operator who wants the old permissive run opts out by NAME
and by NUMBER: `--allow-recoverable N`.

THE EMPTY ROOT LIST IS NOT A CLEAN RESULT
=========================================

`--roots` with no values is an EMPTY list, not the default roots, and a named root
that is not a directory is NOT scanned. Both used to exit 0 printing `# total: 0
production unwrap/expect calls` -- the same line a real scan of a clean tree prints,
so a hollow verdict was byte-for-byte indistinguishable from a measured one. This
gate now REFUSES instead (exit 2) and never falls back to scanning everything: a
caller who wants the default roots passes no `--roots` at all.

Distinguish that refusal from a TRUE GREEN: a run over roots that really resolved,
which happens to find no unwrap/expect call, is a real measurement and still exits 0
printing `# total: 0 production unwrap/expect calls`. Refusal zeroes mean
"nothing was scanned"; exit-0 zeroes mean "everything was scanned and clean".

A PARTIALLY STARVED ROOT SET IS NOT A CLEAN RESULT EITHER
=========================================================

Refusing only when NOTHING resolved left the more dangerous middle case: `--roots
crates nope` resolved `crates`, skipped `nope`, and exited 0 having reported 96 of this
tree's 136 production calls. The count it printed was internally consistent and the exit
code said clean, so a verdict over three quarters of the surface wore the shape of a
full pass. A typo is not the only route there and is not even the likely one: a crate
renamed, a root dropped from a wrapper's argument list, `--roots $list` expanding short.
The rule is now ALL NAMED ROOTS RESOLVE OR NOTHING IS SCANNED. Any token that fails to
resolve refuses the run at exit 2, naming the bad token, the path tried, and the roots
that DID resolve, and it prints no count of any kind.

That rule covers the four defaults as squarely as a typed list: on a checkout where say
`modules/` is absent, a bare run REFUSES rather than report three quarters of the crate
tree as if it were all of it. That is a deliberate cost, paid because the alternative is
a gate whose coverage depends on which directories happen to be present, which is the
hollow-verdict class this file has now refused four different ways.

Usage:
    python scripts/scan-unwrap-panic.py                             # default roots, STRICT
    python scripts/scan-unwrap-panic.py --json                      # JSON summary (also strict)
    python scripts/scan-unwrap-panic.py --allow-recoverable 3       # opt-out: forgive up to 3
    python scripts/scan-unwrap-panic.py --fail-on-recoverable       # no-op alias (CI gate, unchanged)
    python scripts/scan-unwrap-panic.py --self-test                 # pin the default strictness
    python scripts/scan-unwrap-panic.py --roots crates apps         # named roots (REFUSED unless ALL resolve)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

ROOTS = ["crates", "apps", "platform", "modules"]

# Dev-only artifacts that never ship in production builds: benchmark
# harnesses (only compiled by `cargo bench`) and helper modules that are
# gated behind `#[cfg(test)]` in their parent `mod` declaration.
#
# `testing.rs` belongs here by that same rule and was simply missed. Both
# copies of it are gated in their PARENT module, which is why the file-level
# `#[cfg(test)]` tracking below never saw them:
#   apps/mobile-tauri/src/commands/mod.rs:107-108  `#[cfg(test)] pub(crate) mod testing;`
#   crates/kasirmu-bridge/src/lib.rs:159-160       `#[cfg(test)] mod testing;`
# Enumerated, not assumed: `git ls-files | grep -E '(^|/)testing\.rs$'` returns
# exactly those two, and both parents carry the attribute. Leaving the entry out
# made the gate report 3 recoverable unwrap/expect calls in a file that compiles
# only into the test binary -- a red that no change to shipped code can clear,
# which is how a gate stops being read.
DEV_ONLY_PATHS = (
    "/benches/",  # cargo bench harnesses
    "test_helpers.rs",  # #[cfg(test)]-gated from parent mod
    "testing.rs",  # #[cfg(test)]-gated from parent mod (both copies, see above)
)

UNWRAP_RE = re.compile(r"\.unwrap\(\)")
EXPECT_RE = re.compile(r"\.expect\(")
CFG_TEST_RE = re.compile(r"#\[cfg\s*\(\s*test\s*\)")
# Matches `#[test]`, `#[tokio::test]`, and attribute variants such as
# `#[tokio::test(flavor = "multi_thread")]` — all of them mark test fns.
TEST_ATTR_RE = re.compile(r"#\[(?:tokio::)?test(?:\]|\()")
MOD_TESTS_RE = re.compile(r"^\s*mod\s+(tests?)\b")
INVARIANT_COMMENT_RE = re.compile(r"(INVARIANT|SAFETY|cannot fail|must not fail|impossible)")


def strip_comment(line: str, block_depth: int = 0) -> tuple[str, int]:
    """Strip string-safe code from one line, returning (code, block_depth_after).

    `block_depth` carries Rust block-comment state ACROSS lines, and starts at 0.
    This is the fix for the audit-stamp false positives: the per-crate header is

        1: /*
        2: last audited ...
        3: crate: kasirmu-cli | status: SAFE | lint: CLEAN
        4: findings: ... 0 unsafe blocks ... 4 production .unwrap() in seed_demo.rs ...
        5: next: None ...
        6: */

    and the previous version handled `/*` by breaking out of the line, which is
    only correct for a single-line `/* ... */`. Lines 2-5 carry no `/*` or `//`
    marker at all, so they were returned verbatim and scanned as code -- meaning
    a file whose stamp says "0 unsafe blocks" and "clean" FAILED the cleanliness
    gate because of the sentence that says so. Six of the 18 findings were that.

    Depth is counted rather than toggled because Rust block comments NEST:
    `/* outer /* inner */ still comment */` is one comment, and a boolean would
    resume scanning code in the middle of it.
    """
    out: list[str] = []
    i = 0
    n = len(line)
    in_str = False
    while i < n:
        c = line[i]
        if block_depth > 0:
            # Inside a comment: only `*/` and a nested `/*` matter. A `//` here
            # is comment text, not a terminator, and a `"` is not a string.
            if c == "/" and i + 1 < n and line[i + 1] == "*":
                block_depth += 1
                i += 2
                continue
            if c == "*" and i + 1 < n and line[i + 1] == "/":
                block_depth -= 1
                i += 2
                continue
            i += 1
            continue
        if in_str:
            out.append(c)
            if c == '"' and (i == 0 or line[i - 1] != "\\"):
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and line[i + 1] == "/":
            # Line comment (also covers `//!` and `///`): rest of line is prose.
            break
        if c == "/" and i + 1 < n and line[i + 1] == "*":
            block_depth += 1
            i += 2
            continue
        if c == "*" and i + 1 < n and line[i + 1] == "/":
            # Stray `*/` outside a comment (e.g. the closing line of a block that
            # started on a previous line when depth was mis-tracked). Swallow it
            # rather than emitting `*` and `/` as code.
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out), block_depth


def is_invariant_line(line: str) -> bool:
    """True if the line itself carries a documented-invariant comment."""
    return bool(INVARIANT_COMMENT_RE.search(line))


def invariant_documented(lines: list[str], idx: int) -> bool:
    """Does the code at `lines[idx]` carry a documented invariant?

    Accepted forms: a marker on the same line, or in the contiguous run of `//`
    comment lines directly above the STATEMENT the line belongs to.

    Two relaxations over the old "same line or the one line above" rule, both
    forced by real failures:

    1. A comment BLOCK, not just one line. The old rule made the keyword have to
       sit adjacent to the call, which is hostile to the multi-line explanation
       that is actually worth writing; six legitimate comments here counted as
       undocumented.
    2. The block may sit above the start of a multi-line chain, not just above
       the finding. Without this the gate FIGHTS `cargo fmt`: writing the chain
       on one line to keep the marker adjacent gets rewrapped by fmt on the next
       commit (the pre-commit hook runs `cargo fmt --all`), which moves
       `.unwrap()` away from its comment and silently re-breaks the gate. A rule
       the formatter can violate on its own is not a rule.

    Blank lines are NOT skipped -- a comment separated from code by whitespace
    may document something else entirely.
    """
    if is_invariant_line(lines[idx]):
        return True

    # Walk back to the start of the enclosing statement: the first preceding line
    # that is indented LESS than the finding. Chain continuations are always
    # deeper than the statement that opens them.
    def indent_of(s: str) -> int:
        return len(s) - len(s.lstrip())

    start = idx
    base = indent_of(lines[idx])
    j = idx - 1
    while j >= 0:
        s = lines[j].strip()
        if not s or s.startswith("//"):
            break  # comment block or blank line: the statement starts after it
        if indent_of(lines[j]) < base:
            start = j
            break
        j -= 1
    else:
        start = 0

    # Now walk back over the contiguous comment block above `start`.
    k = start - 1
    while k >= 0:
        s = lines[k].strip()
        if not s.startswith("//"):
            break
        if is_invariant_line(s):
            return True
        k -= 1
    return False


def scan_file(path: Path) -> list[dict]:
    """Return finding dicts for unwrap/expect outside test contexts."""
    findings: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return findings

    # Stack of (kind, depth) skip contexts. kind in {"cfg_test", "mod_tests", "test_fn"}
    skip_stack: list[tuple[str, int]] = []
    pending_cfg_test = False
    pending_test_attr = False
    pending_mod_tests = False
    prev_line = ""
    # Block-comment nesting carried from line to line. See strip_comment.
    block_depth = 0

    for lineno, raw in enumerate(lines, start=1):
        code, block_depth = strip_comment(raw, block_depth)

        # ── open new skip contexts ──────────────────────────────────────
        if not skip_stack:
            if CFG_TEST_RE.search(code):
                pending_cfg_test = True
            if TEST_ATTR_RE.search(code):
                pending_test_attr = True
            if MOD_TESTS_RE.search(code):
                pending_mod_tests = True

        open_brace = code.count("{")
        close_brace = code.count("}")

        if skip_stack:
            kind, depth = skip_stack[-1]
            depth += open_brace - close_brace
            if depth <= 0:
                skip_stack.pop()
            else:
                skip_stack[-1] = (kind, depth)
        else:
            # Consume pending contexts when a brace opens on this line.
            if (pending_cfg_test or pending_test_attr or pending_mod_tests) and "{" in code:
                if pending_mod_tests:
                    skip_stack.append(("mod_tests", 1 + (open_brace - close_brace)))
                elif pending_cfg_test:
                    skip_stack.append(("cfg_test", 1 + (open_brace - close_brace)))
                else:
                    skip_stack.append(("test_fn", 1 + (open_brace - close_brace)))
                pending_cfg_test = False
                pending_test_attr = False
                pending_mod_tests = False

        # If a pending context attribute was seen but this line had no brace
        # (e.g. `#[cfg(test)]` then `mod tests {` on the NEXT line), the
        # MOD_TESTS_RE match on the next line will handle it via pending_mod_tests.
        if not skip_stack:
            # attribute + declaration on the same line, e.g. `#[cfg(test)] mod tests {`
            if pending_cfg_test and "mod" in code and "{" in code:
                skip_stack.append(("cfg_test", 1 + (open_brace - close_brace)))
                pending_cfg_test = False
                pending_test_attr = False
                pending_mod_tests = False
            elif pending_test_attr and "fn" in code and "{" in code:
                skip_stack.append(("test_fn", 1 + (open_brace - close_brace)))
                pending_test_attr = False

        if skip_stack:
            prev_line = raw
            continue

        # ── scan production lines ────────────────────────────────────────
        for m in UNWRAP_RE.finditer(code):
            findings.append(
                {
                    "path": str(path),
                    "line": lineno,
                    "call": "unwrap",
                    "text": raw.strip(),
                    "invariant": invariant_documented(lines, lineno - 1),
                }
            )
        for m in EXPECT_RE.finditer(code):
            findings.append(
                {
                    "path": str(path),
                    "line": lineno,
                    "call": "expect",
                    "text": raw.strip(),
                    "invariant": invariant_documented(lines, lineno - 1),
                }
            )
        prev_line = raw

    return findings


def resolve_roots(named: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Split what --roots was handed into (usable, blank, missing) BEFORE the walk.

    Three buckets because the three causes read differently to whoever typed them: a blank
    value named no root, a name whose directory is absent names a root that is not here,
    and --roots with no values at all named nothing to begin with. The refusal prints
    which of the three it hit.

    A blank string is deliberately NOT read as the current directory. Path("") is Path("."),
    so an empty value would silently mean "scan everything under wherever this was run" —
    measured against the pre-fix copy at 4361b5a49, `--roots ''` exited 0 having walked the
    whole working tree and reported 146 calls where the four named default roots report 136.
    A flag meant to narrow the scan widened it, which is the opposite of what a root list is
    for. So a blank refuses; a blank never wildcards.
    """
    usable: list[str] = []
    blank: list[str] = []
    missing: list[str] = []
    for root in named:
        if not root.strip():
            blank.append(root)
        elif Path(root).is_dir():
            usable.append(root)
        else:
            missing.append(root)
    return usable, blank, missing


def refuse_nothing_to_scan(
    named: list[str], blank: list[str], missing: list[str]
) -> int:
    """No named root resolved to a directory, so there is no verdict to print. Exit 2.

    NOT 1. A 1 from this gate is its FINDING voice — "a real scan of a real corpus found an
    undocumented panic" — and a command line with nothing behind it is not a failed check.
    2 is what the sibling gates already use for that distinction (verify-migration-column-
    types.py and verify-no-hardcoded-money-format.py both refuse an empty corpus at 2), and
    argparse itself exits 2 on a flag this script does not implement, so a refused invocation
    can never be misread as an inventory.

    On stdout: scripts/run-pre-push.py merges a child's stderr into its stdout, and this is
    the sentence an operator most needs to see when a verdict goes missing.
    """
    if missing:
        cause = f"none of the {len(named)} named root(s) is a directory here"
    elif blank:
        cause = f"the {len(blank)} value(s) passed were blank, so no root was named"
    else:
        cause = "--roots was passed with no values at all"
    print(
        "scan-unwrap-panic: REFUSED - the root list resolved to nothing to scan, so this "
        "run holds no corpus and any count it printed would be a verdict about nothing."
    )
    print(f"  --roots as passed           : {' '.join(named) if named else '(none)'}")
    print(f"  why there is nothing to do  : {cause}")
    if missing:
        print(f"  named but not a directory   : {', '.join(missing)}")
    if blank:
        print(f"  named but blank             : {len(blank)} value(s)")
    print("  roots that resolved         : 0")
    print(f"  working directory           : {Path.cwd()}")
    print(
        f"  default roots (NOT scanned) : {', '.join(ROOTS)} - to scan those, run without "
        "--roots; a list that named no root is never answered by scanning everything."
    )
    print(
        "  WHICH ZERO IS WHICH: this refusal (exit 2) means NOTHING WAS SCANNED. A run over "
        "roots that really resolved, which happens to find no unwrap/expect call anywhere, "
        "is a TRUE GREEN: it exits 0 and prints the one-line inventory summary carrying its "
        "own measured call count, and that summary line -- not this block -- is what a "
        "reader or a CI log takes as the report. No single run emits both, and this refusal "
        "borrows neither the shape nor the marker of that line, so grepping a log for the "
        "report can never match a run that scanned nothing."
    )
    return 2


def tried_path_for(token: str) -> str:
    """Where a named root was actually looked for, so a refusal can print it.

    An absolute token is used as given; a relative one is resolved against the working
    directory, which is what Path(root).is_dir() just did. resolve() runs on a path that
    does NOT exist -- that is the whole subject -- so it is decoration only and a failure
    there must not swallow the refusal, hence the fallback.
    """
    path = Path(token)
    try:
        return str(path if path.is_absolute() else (Path.cwd() / path).resolve())
    except OSError:
        return str(path)


def root_set_is_starved(
    usable: list[str], blank: list[str], missing: list[str]
) -> bool:
    """True when SOME named roots resolved and some did not: the partial case.

    The all-failed case is a different refusal with its own message, so this predicate is
    only the middle one -- the case that used to exit 0. Blank and missing are the two
    ways a token fails to resolve; either one holes the corpus, and a corpus with a hole
    in it is a sample, not a corpus.
    """
    return bool(usable) and bool(blank or missing)


def starved_root_report(
    named: list[str], usable: list[str], blank: list[str], missing: list[str]
) -> list[str]:
    """The refusal's lines, built as data so `--self-test` can assert on the text.

    It carries no call count by construction: it names ROOTS, never findings. A refusal
    that printed a number would be readable as a scan that came back clean, which is the
    exact failure being refused.
    """
    lines = [
        "scan-unwrap-panic: REFUSED - the root list resolved only PARTIALLY, so this run",
        "would report a sample as a verdict. All named roots resolve or nothing is",
        "scanned.",
        f"  --roots as passed           : {' '.join(named) if named else '(none)'}",
    ]
    for token in missing:
        lines.append(f"  refused, not a directory   : {token!r}")
        lines.append(f"  path tried for it          : {tried_path_for(token)}")
    for token in blank:
        lines.append(f"  refused, named no directory: {token!r}")
        lines.append(
            "  path tried for it          : none on purpose. A blank is never read as the "
            "working directory, because that would WIDEN the scan a root list is meant to "
            "narrow"
        )
    lines.append(f"  roots that DID resolve      : {', '.join(usable)}")
    lines.append(f"  working directory           : {Path.cwd()}")
    lines.append(
        "  why exit 2 and not 1        : 1 is this gate's FINDING voice, a real scan of a "
        "real corpus that found an undocumented panic. This run scanned no corpus at all."
    )
    lines.append(
        "  how to get a verdict        : correct the refused token, or name only roots "
        "that are here. A scan of a subset is honest exactly when it does not claim to be "
        "the whole surface."
    )
    return lines


def refuse_starved_roots(
    named: list[str], usable: list[str], blank: list[str], missing: list[str]
) -> int:
    """Refuse a partially starved root set on stderr, and scan nothing. Exit 2.

    stderr because this is an operator-facing error about a command line, and the refusal
    that the empty list gets goes to stdout only for the reason documented there.
    """
    for line in starved_root_report(named, usable, blank, missing):
        print(line, file=sys.stderr)
    return 2


def collect_findings(roots: list[str]) -> list[dict]:
    """Every production finding under `roots`: the walk, with no verdict in it.

    Split out of main() so `--self-test` can prove that a root set which really resolves
    really scans -- over a temp tree -- without going through the gate's exit code.
    """
    findings: list[dict] = []
    for root in roots:
        root_path = Path(root)
        for path in sorted(root_path.rglob("*.rs")):
            if "tests" in path.parts:
                continue
            if any(tok in str(path).replace("\\", "/") for tok in DEV_ONLY_PATHS):
                continue
            # Split test modules (`#[cfg(test)] mod foo_tests;` in the parent)
            # carry the `*_tests.rs` / `*_test.rs` filename convention; the
            # parent's cfg-gate is invisible to this per-file scan, so treat
            # those filenames as test code (ADR #33: test code is exempt).
            if re.search(r"_test(s)?\.rs$", path.name):
                continue
            findings.extend(scan_file(path))
    return findings


def build_parser() -> argparse.ArgumentParser:
    """The command line, in one place, so `--self-test` parses the real flags."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit JSON summary")
    parser.add_argument(
        "--allow-recoverable",
        dest="allow_recoverable",
        type=int,
        default=None,
        metavar="N",
        help="operator opt-out: forgive up to N production unwrap/expect calls that lack "
        "a documented invariant comment. Omit it and N is 0, i.e. STRICT (ADR #33).",
    )
    parser.add_argument(
        "--fail-on-recoverable",
        dest="fail_on_recoverable",
        action="store_true",
        help="no-op alias. Strictness about recoverable calls is now the default, so this "
        "flag changes no verdict; it is accepted only so call sites that already pass it "
        "(scripts/check.sh, dev-ci.yml#static-gates) keep working. It does still select the "
        "one-line success summary in place of the plain-run `# total:` line.",
    )
    parser.add_argument(
        "--roots",
        nargs="*",
        default=ROOTS,
        help="roots to scan; this gate REFUSES with exit 2 unless EVERY named root "
        "resolves. No root resolving means no inventory over nothing; some roots "
        "resolving means a holed corpus reported as a full pass, which is worse.",
    )
    parser.add_argument(
        "--self-test",
        dest="self_test",
        action="store_true",
        help="run the in-process checks that pin this gate's own behaviour and exit",
    )
    return parser


def strictness_tolerance(allow_recoverable: int | None) -> int:
    """How many undocumented calls a run forgives. Zero unless an operator raised it.

    `None` means the flag was not passed, and not-passing it is now the STRICT case --
    that inversion is the whole point of the change. The old shape asked for a flag to
    get a verdict that could be red; this asks for a flag to get one that cannot.
    """
    return 0 if allow_recoverable is None else allow_recoverable


def over_tolerance(findings: list[dict], tolerance: int) -> list[dict]:
    """The findings that make the run RED: recoverable calls BEYOND the tolerance.

    Green is the equation `len(recoverable) <= tolerance`, i.e. an empty slice here --
    not a count the reader has to compare against a number printed elsewhere. Slicing
    rather than comparing keeps the offending subset available to the failure report.
    """
    return [f for f in findings if not f["invariant"]][tolerance:]


def refuse_negative_tolerance(value: int) -> int:
    """A negative --allow-recoverable is a broken command line, not a lenient one.

    It would forgive nothing AND fail a clean tree (0 recoverable is never <= -1), so
    reading it as entered turns the opt-out flag into a gate that can never pass. That
    is a refusal (exit 2, the same voice as an empty root list), not a finding (exit 1).
    """
    print(
        f"scan-unwrap-panic: REFUSED - --allow-recoverable needs a non-negative count, "
        f"got {value}."
    )
    print(
        "  a negative tolerance forgives nothing and fails even a clean tree, so it is "
        "not a looser run, it is an unsatisfiable one"
    )
    print(
        "  the default is already the strictest possible value: omit --allow-recoverable "
        "entirely (that is N=0) or pass 0"
    )
    print(
        "  nothing was measured and no inventory is printed, so this run holds no verdict "
        "about the tree"
    )
    return 2


def self_test() -> int:
    """Pin this gate's own behaviour: strict by default, opt-out by name, alias inert.

    In-process and repo-free -- hand-built findings plus one temp fixture read by the
    real scanner, in a temp dir, never in the working tree. The cases exist because the
    default was FLIPPED: the property worth nailing down is that a bare run is the strict
    one, that --allow-recoverable N moves the ceiling and does not remove it, and that
    --fail-on-recoverable can no longer change a verdict.
    """
    cases: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        cases.append((name, ok))

    undocumented = {
        "path": "fixture.rs",
        "line": 3,
        "call": "unwrap",
        "text": "a.unwrap();",
        "invariant": False,
    }
    documented = dict(undocumented, invariant=True)
    parser = build_parser()

    bare = parser.parse_args([])
    check(
        "no flags at all => tolerance 0, i.e. the DEFAULT is strict",
        strictness_tolerance(bare.allow_recoverable) == 0,
    )
    legacy = parser.parse_args(["--fail-on-recoverable"])
    check(
        "--fail-on-recoverable is still ACCEPTED and changes no verdict (tolerance 0)",
        legacy.fail_on_recoverable
        and strictness_tolerance(legacy.allow_recoverable) == 0,
    )
    opted = parser.parse_args(["--allow-recoverable", "1"])
    check(
        "--allow-recoverable 1 parses to a tolerance of 1",
        strictness_tolerance(opted.allow_recoverable) == 1,
    )
    zero = parser.parse_args(["--allow-recoverable", "0"])
    check(
        "--allow-recoverable 0 is the same verdict as omitting it",
        strictness_tolerance(zero.allow_recoverable) == 0,
    )

    check(
        "one undocumented call REDS the default run",
        len(over_tolerance([undocumented, documented], 0)) == 1,
    )
    check(
        "that same call goes green once an operator opts out to 1",
        over_tolerance([undocumented, documented], 1) == [],
    )
    check(
        "the opt-out is a ceiling, not an amnesty: 2 undocumented vs N=1 still reds",
        len(over_tolerance([undocumented, undocumented, documented], 1)) == 1,
    )
    check(
        "an all-documented corpus is green at the default tolerance",
        over_tolerance([documented, documented], 0) == [],
    )

    # The classifier behind the verdict, exercised on a real file the real scanner reads.
    with tempfile.TemporaryDirectory(prefix="unwrap-selftest-") as tmp:
        fixture = Path(tmp) / "fixture.rs"
        fixture.write_text(
            "fn main() {\n"
            "    let a: Option<u8> = None;\n"
            "    a.unwrap();\n"
            "    let b: Option<u8> = Some(1);\n"
            "    // SAFETY: INVARIANT: a literal cannot yield None\n"
            "    b.unwrap();\n"
            "}\n",
            encoding="utf-8",
        )
        found = scan_file(fixture)
        check("the scanner sees both unwrap calls in a production fn", len(found) == 2)
        check(
            "the annotated one is documented, the bare one is recoverable",
            sum(1 for f in found if not f["invariant"]) == 1
            and sum(1 for f in found if f["invariant"]) == 1,
        )
        check(
            "a synthetic recoverable call reds a DEFAULT run of the real scanner",
            len(over_tolerance(found, strictness_tolerance(bare.allow_recoverable))) == 1,
        )
        check(
            "...and clears only under --allow-recoverable 1",
            over_tolerance(found, strictness_tolerance(opted.allow_recoverable)) == [],
        )

    # ROOT RESOLUTION: a set that fully resolves still scans; a set with one hole does
    # not scan at all. Both halves matter -- refusing everything would be safe and useless.
    with tempfile.TemporaryDirectory(prefix="unwrap-rootselftest-") as tmp:
        base = Path(tmp)
        (base / "crate_a").mkdir()
        (base / "crate_b").mkdir()
        (base / "crate_a" / "a.rs").write_text(
            "fn main() {\n    let a: Option<u8> = None;\n    a.unwrap();\n}\n",
            encoding="utf-8",
        )
        complete = [str(base / "crate_a"), str(base / "crate_b")]
        usable, blank, missing = resolve_roots(complete)
        check(
            "a root set where every named root is a directory is NOT starved",
            usable == complete and not root_set_is_starved(usable, blank, missing),
        )
        check(
            "...and it still scans: the one call under it is found",
            len(collect_findings(complete)) == 1,
        )

        holey = [str(base / "crate_a"), "nope_not_here", " "]
        usable_h, blank_h, missing_h = resolve_roots(holey)
        check(
            "one missing plus one blank among valid roots IS starved, so it must refuse",
            bool(usable_h)
            and root_set_is_starved(usable_h, blank_h, missing_h),
        )
        report = starved_root_report(holey, usable_h, blank_h, missing_h)
        text = "\n".join(report)
        check(
            "the refusal names the bad token, the path tried, AND what did resolve",
            "nope_not_here" in text
            and tried_path_for("nope_not_here") in text
            and repr(" ") in text
            and str(base / "crate_a") in text,
        )
        check(
            "a refusal prints no count and borrows no shape of the report line",
            not any("production unwrap/expect calls" in line for line in report)
            and re.search(r"total\s*:\s*\d", text) is None,
        )

        usable_n, blank_n, missing_n = resolve_roots(["nope_not_here"])
        check(
            "nothing resolving at all stays the OTHER refusal, so the two messages do not collide",
            not usable_n and not root_set_is_starved(usable_n, blank_n, missing_n),
        )

    failed = [name for name, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok' if ok else 'FAIL'}  {name}")
    if failed:
        print(f"\nself-test: {len(failed)} of {len(cases)} case(s) FAILED")
        return 1
    print(
        f"\nself-test: all {len(cases)} case(s) passed -- strict by default, "
        "--allow-recoverable N raises the ceiling, --fail-on-recoverable is inert, and a "
        "partially starved root set refuses while a complete one still scans"
    )
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.allow_recoverable is not None and args.allow_recoverable < 0:
        return refuse_negative_tolerance(args.allow_recoverable)
    tolerance = strictness_tolerance(args.allow_recoverable)

    # Refuse BEFORE the walk, not after the verdict: a root list that names no directory
    # has no corpus, and a gate with no corpus must not print a count. Only the names that
    # really are directories get scanned, and the default ROOTS is never reinstated as a
    # fallback — "you asked for nothing" is not the same request as "scan everything".
    roots_to_scan, blank_roots, missing_roots = resolve_roots(args.roots)
    if not roots_to_scan:
        return refuse_nothing_to_scan(args.roots, blank_roots, missing_roots)
    # The case that refusal never covered: SOME roots resolved and some did not. Scanning
    # the survivors and exiting 0 printed a count over a holed corpus -- measured at 96 of
    # 136 production calls for `--roots crates nope` -- and a number that looks complete is
    # exactly what a clean scan looks like. Refuse before the walk, as above.
    if root_set_is_starved(roots_to_scan, blank_roots, missing_roots):
        return refuse_starved_roots(
            args.roots, roots_to_scan, blank_roots, missing_roots
        )

    all_findings: list[dict] = collect_findings(roots_to_scan)

    recoverable = [f for f in all_findings if not f["invariant"]]
    offending = over_tolerance(all_findings, tolerance)

    if args.json:
        by_file: dict[str, int] = {}
        for f in all_findings:
            by_file[f["path"]] = by_file.get(f["path"], 0) + 1
        print(
            json.dumps(
                {
                    "total": len(all_findings),
                    "invariant_annotated": len(all_findings) - len(recoverable),
                    "recoverable": len(recoverable),
                    "tolerance": tolerance,
                    "files": len(by_file),
                    "by_file": dict(sorted(by_file.items(), key=lambda kv: -kv[1])),
                },
                indent=2,
            )
        )
        # The report is emitted BEFORE the verdict so a red --json run still yields the
        # machine-readable inventory it was asked for; the ADR's re-measure recipe points
        # at this flag, and a recipe that cannot fail is how a red tree reads as green.
        if not offending:
            return 0

    if offending:
        print(
            f"panic-inventory FAIL: {len(recoverable)} recoverable unwrap/expect "
            f"call(s) lack a documented invariant comment (ADR #33) and this run "
            f"forgives {tolerance}:",
            file=sys.stderr,
        )
        # Every recoverable call is named, not just the ones past the ceiling, so the
        # report matches the count in its own header. At the default tolerance the two
        # sets are identical, which is why `offending` decides and this lists `recoverable`.
        for f in recoverable:
            print(
                f'{f["path"]}:{f["line"]}: {f["call"]}()  {f["text"]}',
                file=sys.stderr,
            )
        print(
            "Fix: add a // SAFETY: / // INVARIANT: comment on the same or "
            "immediately preceding line, or convert the call to a Result path.",
            file=sys.stderr,
        )
        print(
            "This verdict is the DEFAULT, not a flag someone forgot to pass. Raising it is "
            "an explicit act: --allow-recoverable N forgives up to N and says so in the "
            "summary line; --fail-on-recoverable no longer means anything.",
            file=sys.stderr,
        )
        return 1

    if args.json:
        return 0

    for f in all_findings:
        tag = " [INVARIANT]" if f["invariant"] else ""
        print(f'{f["path"]}:{f["line"]}: {f["call"]}()  {f["text"]}{tag}')
    if args.fail_on_recoverable or args.allow_recoverable is not None:
        # Concise success line for the CI / check.sh gate — plain mode would
        # otherwise dump the whole inventory into the build log.
        if recoverable:
            print(
                f"{len(all_findings)} production unwrap/expect calls, "
                f"{len(recoverable)} recoverable within --allow-recoverable {tolerance}",
                file=sys.stderr,
            )
        else:
            print(
                f"{len(all_findings)} production unwrap/expect calls, all documented "
                "invariants",
                file=sys.stderr,
            )
    else:
        print(f"\n# total: {len(all_findings)} production unwrap/expect calls", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
