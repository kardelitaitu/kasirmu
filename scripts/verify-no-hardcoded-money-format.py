#!/usr/bin/env python3
"""Verify no hardcoded exp-2 money formatting appears in production Rust code.

WHY
===

Money is stored as integer minor units, and the correct way to render them
is `foundation::format_minor(minor, currency)`, which uses the currency's
ISO-4217 minor-unit exponent (0 for IDR/JPY/KRW/VND, 3 for KWD/OMR/..., 2
otherwise). Hardcoded `/ 100` division or `{}.{:02}` format strings assume
every currency has 2 decimal places and silently mis-render IDR/JPY/KWD
amounts (e.g. Rp 4.450.000 rendered as "44500.00").

This gate scans the workspace for the two tell-tale hardcoded-exp-2
patterns OUTSIDE test contexts and fails the build when one appears, so
the format_minor migration cannot regress:

  1. `minor_units / 100`-style integer/float division (incl. `% 100`),
  2. positional `{}.{:02}` format strings (major.minor padding).

Deliberate exceptions (checked and intentionally NOT flagged):
  * loyalty/CRM points formulas (e.g. `total_minor / 100` earning
    "1 point per 100 minor units") — business rules that produce an
    integer point count, not display formatting;
  * tax-rate `display_rate()` (`rate_bps / 100` → a percentage string,
    not minor units);
  * `exchange_rates` `display_rate()` (millionths → rate decimal);
  * the ESC/POS receipt formatter, which is already exponent-aware via
    `Currency::minor_unit_exponent()` (its `{major}.{minor:0width$}`
    named-argument width is driven by the real exponent);
  * wire/payload `.minor_units.to_string()` (QRIS, payment links) and
    DB note strings — not user-facing formatting.

A trailing `// money-format-ok` comment on the offending line exempts it
(the annotated escape-hatch analogue of scan-unwrap-panic.py's `// SAFETY:`
comments) for rare legitimate non-money uses of the same shape.

USAGE
=====

    python3 scripts/verify-no-hardcoded-money-format.py
    python3 scripts/verify-no-hardcoded-money-format.py --verbose
    python3 scripts/verify-no-hardcoded-money-format.py --self-test

ROOT RESOLUTION
===============

The Rust source root is resolved from where the DATA lives (the first candidate that
actually contains ROOTS), never from where this script sits. A copy of this file in a
temp directory used to scan nothing, silently, and print
"PASS (0 production .rs file(s))" — byte-for-byte indistinguishable from the real
thing. Now a root that yields no candidates is a FAILURE, named with the root and the
count it got (see resolve_source_root).

EXIT CODES
==========

  * 0  no hardcoded exp-2 money formatting found in production .rs files.
  * 1  at least one finding (the CI / check.sh gate).
  * 2  a runtime error occurred, or the walk found no candidate .rs file in a root it
       was asked to police — a clean verdict read off an empty corpus, which proves
       nothing about the tree and is therefore not a verdict.
  * --self-test exits 0 only when all three of its cases behaved as written; 1 otherwise.

SELF-TEST
=========

    --self-test builds three synthetic trees under the system temp dir and runs THIS FILE
    against each as a child process launched inside that tree — so what the cases assert is
    the real CLI path: argv, root resolution, the walk, the exit code an operator sees. The
    fixtures are created with tempfile.mkdtemp() and removed again; nothing is written
    inside any repository, and the real tree is never scanned by a self-test run.

      1. all five policed directories present, at least one production .rs in each, one
         planted float finding (`minor_units / 100.0`) -> must report that finding, exit 1.
      2. all five present, zero .rs anywhere -> must REFUSE with exit 2 and name the
         resolved root it probed (the whole-tree empty-corpus refusal added at 1f7c2311).
      3. only two of the five present, both populated -> must REFUSE as PARTIAL COVERAGE
         rather than print PASS over the part it happened to see. Pinned deliberately: exit
         2 whenever ANY policed root yields zero candidates is this gate's declared new
         behaviour, so the case written for it is a case that expects the refusal.

    All three cases expect the gate to fail, so the tally's CLEAN half is 0 by construction.
    A fourth case — "full tree, nothing to find, exit 0" — was considered and NOT kept. It is
    the one verdict no case here watches, but it also reddens under none of the three
    mutations named beside the cases below: deleting the refusal, weakening its starved arm
    and dropping a pattern all still leave a clean synthetic tree at exit 0, and a broken
    walk already reddens case 1. A case that cannot fail watches nothing, so it stays out of
    the suite and in this comment (the rule reported today as having retired case 18 in
    scripts/verify-ipc-parity.py). The CLEAN half of this gate's evidence stays the real-tree
    run — exit 0, printing its own .rs count — which is outside the flag and above it in
    VERIFY.

    HONEST LIMIT — read this before trusting a green tally: a --self-test that nothing calls
    is a developer tool, not enforcement. This gate's CI record lives in scripts/gates.json
    and .github/workflows/dev-ci.yml, both outside the fence that added this flag and
    neither edited by it, so these three cases pin the behaviour for humans and for whoever
    later wires the runner. Until that wiring exists, CI can still regress the refusal
    silently — exactly as it could before this flag was added.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Directories holding the production Rust this gate polices, RELATIVE TO THE REPO ROOT.
# They are names of data locations, not of script locations: ROOTS is joined to whatever
# resolve_source_root() proves is the tree containing them (see the docstring).
ROOTS = ["crates", "apps", "platform", "modules", "foundation"]

# Dev-only artifacts that never ship in production builds.
DEV_ONLY_PATHS = (
    "/benches/",  # cargo bench harnesses
    "test_helpers.rs",  # #[cfg(test)]-gated from parent mod
)

# 1. minor_units divided or reduced modulo 100 (hardcoded exp 2). The
# optional method-chain segment catches `minor_units.abs() % 100` and the
# optional closing paren catches wrapping parentheses like
# `(minor_units as f64) / 100.0` — shapes the old oz-cli/email_report code
# used to recover the sign. Written as plain (non-raw) strings with
# explicit escapes to avoid double-escaping pitfalls; \. keeps its regex
# meaning.
MINOR_DOT = r"minor_units(?:\.[a-z_]+\(\))?\)?"
MONEY_DIV_RE = re.compile(MINOR_DOT + r"\s*/\s*100(?:\.0)?\b")
MONEY_MOD_RE = re.compile(MINOR_DOT + r"\s*%\s*100\b")
MONEY_F64_RE = re.compile(MINOR_DOT + r"\s+as\s+f64\)?\s*/\s*100\b")
# 2. positional major.minor format: `{}.{:02}` (any padding width).
POSITIONAL_FMT_RE = re.compile(r"\{\}\.\{:0[0-9]+\}")

# A trailing `// money-format-ok` comment on the same line exempts a
# finding — the annotated-escape-hatch analogue of scan-unwrap-panic.py's
# `// SAFETY:` / `// INVARIANT:` comments. Only matches OUTSIDE string
# literals (strip_comment keeps string content, so `"// money-format-ok"`
# inside a string cannot accidentally exempt real code).
EXEMPT_COMMENT_RE = re.compile(r"//\s*money-format-ok\b")

CFG_TEST_RE = re.compile(r"#\[cfg\s*\(\s*test\s*\)")
TEST_ATTR_RE = re.compile(r"#\[test\]")
MOD_TESTS_RE = re.compile(r"^\s*mod\s+(tests?)\b")

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("minor_units / 100", MONEY_DIV_RE),
    ("minor_units % 100", MONEY_MOD_RE),
    ("minor_units as f64 / 100", MONEY_F64_RE),
    ("{}.{:02} format string", POSITIONAL_FMT_RE),
]


def _first_unquoted_comment(line: str) -> int:
    """Return the index of the first `//` or `/*` outside string literals,
    or -1 if there is none. Mirrors strip_comment's string-awareness so a
    comment marker inside a string literal cannot be mistaken for one."""
    i = 0
    n = len(line)
    in_str = False
    while i < n:
        c = line[i]
        if in_str:
            if c == '"' and (i == 0 or line[i - 1] != "\\"):
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            i += 1
            continue
        if c == "/" and i + 1 < n and line[i + 1] in ("/", "*"):
            return i
        i += 1
    return -1


def has_exempt_comment(line: str) -> bool:
    """True if the line carries a real (unquoted) `// money-format-ok` comment."""
    idx = _first_unquoted_comment(line)
    if idx < 0:
        return False
    return EXEMPT_COMMENT_RE.search(line[idx:]) is not None


def strip_comment(line: str) -> str:
    """Remove string literals and line comments crudely; good enough for gating."""
    out = []
    i = 0
    n = len(line)
    in_str = False
    while i < n:
        c = line[i]
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
            break
        if c == "/" and i + 1 < n and line[i + 1] == "*":
            break
        out.append(c)
        i += 1
    return "".join(out)


def _git_toplevel(start: Path) -> Path | None:
    """git's own answer for which repository `start` sits in, or None."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(start), capture_output=True, text=True, errors="replace", timeout=20,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout.strip()
    return Path(out) if out else None


def resolve_source_root(roots: list[str]) -> tuple[Path, str]:
    """(root, how_it_was_chosen) for the tree whose Rust sources this gate must read.

    Resolution runs from the DATA backwards: a candidate is accepted only when it
    actually contains one of `roots`, so the answer describes a tree with something to
    police. Script-relative is tried, but as a candidate among others and only accepted
    on the same evidence -- which is the whole difference from the old behaviour, where
    the script's own location was the answer and a copied gate silently measured itself.
    When nothing qualifies, CWD is returned with a `how` that says so, purely so the
    refusal below can name the root it probed instead of hiding it behind None.
    """
    here = Path(__file__).resolve().parent
    candidates: list[tuple[str, Path | None]] = [
        ("current working directory", Path.cwd()),
        ("git rev-parse --show-toplevel from the current directory", _git_toplevel(Path.cwd())),
        ("parent of this script's directory", here.parent),
        ("git rev-parse --show-toplevel from this script's directory", _git_toplevel(here)),
    ]
    for how, cand in candidates:
        if cand is None:
            continue
        cand = cand.resolve()
        if any((cand / r).is_dir() for r in roots):
            return cand, how
    return Path.cwd().resolve(), "no candidate contained any policed root"


def scan_file(path: Path) -> list[dict]:
    """Return finding dicts for hardcoded exp-2 patterns outside test contexts."""
    findings: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return findings

    # Stack of (kind, depth) skip contexts — mirrors scan-unwrap-panic.py.
    skip_stack: list[tuple[str, int]] = []
    pending_cfg_test = False
    pending_test_attr = False
    pending_mod_tests = False

    for lineno, raw in enumerate(lines, start=1):
        code = strip_comment(raw)

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
            continue

        # ── scan production lines ────────────────────────────────────────
        if has_exempt_comment(raw):
            continue
        for label, pattern in PATTERNS:
            if pattern.search(code):
                findings.append(
                    {
                        "path": str(path),
                        "line": lineno,
                        "pattern": label,
                        "text": raw.strip(),
                    }
                )

    return findings


# -- self-test ---------------------------------------------------------------
#
# Fixture content is deliberately minimal: one clean production-shaped file per policed
# directory, plus one planted finding. Names avoid every skip the walker applies (a
# "tests" path part, "/benches/", "test_helpers.rs") because a fixture that got filtered
# out would look like coverage while scanning nothing.
_FIXTURE_CLEAN = (
    "//! self-test fixture\npub fn raw(minor_units: i64) -> i64 {\n    minor_units\n}\n"
)
_FIXTURE_PLANTED = (
    "//! self-test fixture\npub fn rate(minor_units: i64) -> f64 {\n"
    "    minor_units / 100.0\n}\n"
)
_PLANTED_NAME = "planted_money.rs"


def _build_tree(root: Path, dirs: dict[str, int], plant: str | None = None) -> Path:
    """Materialise a synthetic checkout: dirs maps a policed root to its .rs count."""
    for rel, count in dirs.items():
        src = root / rel / "src"
        src.mkdir(parents=True, exist_ok=True)
        for i in range(count):
            (src / f"mod_{i}.rs").write_text(_FIXTURE_CLEAN, encoding="utf-8")
    if plant is not None:
        src = root / plant / "src"
        src.mkdir(parents=True, exist_ok=True)
        (src / _PLANTED_NAME).write_text(_FIXTURE_PLANTED, encoding="utf-8")
    return root


def _run_gate(cwd: Path) -> tuple[int, str]:
    """Run THIS file as a child launched from cwd, with stdout and stderr folded together.

    A child rather than a call into main(): the exit code and the root the refusal prints
    are properties of the CLI, and root resolution has to run for real to be exercised.
    It also means a mutated copy of this file tests itself, so a mutation cannot hide
    behind a harness that still holds the unmutated constants.
    """
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).resolve())],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        errors="replace",
        timeout=180,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def self_test() -> int:
    """Pin the three verdicts this gate can give in temp trees, and print the split.

    CAUGHT = the gate was expected to fail and did.  CLEAN = expected to pass and did.
    Each case names above itself the mutation it was written for and the assertion that
    reddens when that mutation lands; a case with no such pair is not kept.
    """
    caught = clean = red = 0
    tmp = Path(tempfile.mkdtemp(prefix="money-format-selftest-"))

    def verdict(ok: bool, desc: str, expected: str, seen: str) -> None:
        nonlocal caught, red
        if ok:
            caught += 1
            print(f"  CAUGHT  {desc}")
        else:
            red += 1
            print(f"  MISSED  {desc}")
            print(f"          expected {expected}")
            print(f"          saw      {seen}")

    try:
        # (1) Full coverage plus one planted float finding.
        #     Mutation: drop the ("minor_units / 100", MONEY_DIV_RE) entry from PATTERNS.
        #     Reddens rc == 1 -- the gate walks all five roots, finds nothing, prints PASS.
        tree = _build_tree(tmp / "full-with-finding", {r: 1 for r in ROOTS}, plant="crates")
        rc, out = _run_gate(tree)
        folded = out.replace("\\", "/")
        named = f"{_PLANTED_NAME}:3" in folded
        labelled = "[minor_units / 100]" in out
        first = out.strip().splitlines()[-1][:76] if out.strip() else "no output"
        verdict(
            rc == 1 and named and labelled,
            f"planted minor_units / 100.0 reported, exit 1 (rc={rc}, file named={named}, "
            f"pattern labelled={labelled})",
            "exit 1 plus the planted file at line 3 and its pattern label",
            f"exit {rc}: {first}",
        )

        # (2) All five roots present, zero .rs anywhere: the 1f7c2311 refusal.
        #     Mutation that reddens rc == 2: delete the refusal (guard -> False), the
        #     pre-1f7c2311 path -- the gate then prints PASS (0 production .rs file(s)).
        #     The assertion only this case watches is the "walked nothing" sentence itself:
        #     breaking the inner message selector (scanned == 0 -> scanned < 0) reddens here
        #     and nowhere else, while dropping the scanned == 0 arm from the GUARD reddens
        #     nothing, because an all-empty tree always leaves `starved` non-empty too.
        tree = _build_tree(tmp / "present-but-empty", {r: 0 for r in ROOTS})
        rc, out = _run_gate(tree)
        root_named = str(tree) in out
        first = out.strip().splitlines()[0][:76] if out.strip() else "no output"
        verdict(
            rc == 2 and "REFUSED" in out and "walked nothing" in out and root_named,
            f"empty corpus refused and the resolved root named (rc={rc}, root named="
            f"{root_named})",
            "exit 2, the walked-nothing refusal, and the resolved root printed in it",
            f"exit {rc}: {first}",
        )

        # (3) Partial coverage: two of the five policed roots, both populated (2 .rs total).
        #     Mutation that reddens rc == 2 here and nowhere else: weaken the guard to
        #     "if scanned == 0:", dropping the starved arm. The gate then prints PASS over
        #     the 2 files it happened to see and exits 0 -- which is exactly the deliberate
        #     new failure mode this case exists to pin, so it expects the refusal on purpose.
        present = ["crates", "foundation"]
        missing = [r for r in ROOTS if r not in present]
        tree = _build_tree(tmp / "partial-coverage", {r: 1 for r in present})
        rc, out = _run_gate(tree)
        starved_named = f"({', '.join(missing)})" in out
        absent_marked = out.count("(directory absent)") == len(missing)
        first = out.strip().splitlines()[0][:76] if out.strip() else "no output"
        verdict(
            rc == 2 and "REFUSED" in out and "only part" in out and starved_named
            and absent_marked,
            f"partial coverage refused, not passed (rc={rc}, starved roots named="
            f"{starved_named}, all {len(missing)} marked absent={absent_marked})",
            "exit 2, the partial-tree refusal naming every starved root as directory absent",
            f"exit {rc}: {first}",
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    rc_out = 0 if red == 0 else 1
    print(f"  tally: {caught + clean} green = {caught} CAUGHT + {clean} CLEAN; {red} red; "
          f"exit {rc_out}")
    print(
        "  CLEAN is 0 by construction: all three cases pin a verdict this gate must NOT "
        "print. The real-tree run is the clean half of the evidence (exit 0, printing its "
        "own .rs count), outside this flag."
    )
    print(
        "  LIMIT: nothing calls this flag. scripts/gates.json and dev-ci.yml sit outside "
        "the fence that added it, so a green tally is a developer tool, not enforcement."
    )
    if red:
        print("  a case slipped through: the behaviour it pins is no longer pinned")
    return rc_out


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="List every scanned root and its file count.",
    )
    parser.add_argument(
        "--roots",
        nargs="*",
        default=None,
        help="roots to scan (default: the Rust source roots under the resolved repo root)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="build three synthetic trees under the system temp dir (planted finding / "
             "empty corpus / partial coverage), run this gate against each, and print the "
             "CAUGHT+CLEAN tally; exits 0 only if all three behaved. Nothing is written "
             "inside a repository.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.roots:
        roots = list(args.roots)
        base = Path.cwd().resolve()
        root_source = "the explicit --roots list"
    else:
        roots = list(ROOTS)
        base, root_source = resolve_source_root(roots)

    all_findings: list[dict] = []
    scanned = 0
    per_root: list[tuple[str, int, bool]] = []
    for rel in roots:
        root_path = base / rel
        present = root_path.is_dir()
        count = 0
        if not present:
            per_root.append((rel, 0, False))
            continue
        for path in sorted(root_path.rglob("*.rs")):
            if "tests" in path.parts:
                continue
            if any(tok in str(path).replace("\\", "/") for tok in DEV_ONLY_PATHS):
                continue
            count += 1
            all_findings.extend(scan_file(path))
        scanned += count
        per_root.append((rel, count, True))

    # A root that yields no candidate is UNREAD, not clean — and the old code printed the
    # same PASS line either way, so a copy of this gate in an empty directory measured
    # itself, called it a pass, and no reader could tell the two runs apart. Refuse, and
    # name the root that was resolved together with the count that came back.
    starved = [rel for rel, c, _present in per_root if c == 0]
    if scanned == 0 or starved:
        # On stdout, not stderr: scripts/run-pre-push.py surfaces only a child's stdout,
        # and this is the sentence an operator most needs to see.
        if scanned == 0:
            print(
                "verify-no-hardcoded-money-format: REFUSED — a gate that walked nothing "
                "must not print clean, and this run walked none of the tree it is "
                "supposed to police."
            )
        else:
            print(
                "verify-no-hardcoded-money-format: REFUSED — a gate that walked only part "
                f"of its tree must not print clean either: {len(starved)} of {len(roots)} "
                f"policed root(s) yielded no candidate file ({', '.join(starved)})."
            )
        print(f"  Rust source root resolved to : {base}  (from {root_source})")
        print(
            f"  candidate production .rs     : {scanned} file(s) over {len(roots)} root(s)"
            " — "
            + ", ".join(
                f"{rel}={c}" + ("" if present else " (directory absent)")
                for rel, c, present in per_root
            )
        )
        print(
            "  A count that is not the whole tree means the root above is not the "
            "repository this gate reads; run it from a checkout that holds the Rust "
            "sources."
        )
        return 2

    if args.verbose:
        print(
            f"verify-no-hardcoded-money-format: scanned {scanned} production .rs file(s) "
            f"under {base} (from {root_source}): "
            + ", ".join(f"{rel}={c}" for rel, c, _present in per_root)
        )

    if all_findings:
        print(
            f"verify-no-hardcoded-money-format FAIL: {len(all_findings)} hardcoded "
            "exp-2 money formatting site(s) in production code — route through "
            "foundation::format_minor(minor, currency):",
            file=sys.stderr,
        )
        for f in all_findings:
            print(
                f'{f["path"]}:{f["line"]}: [{f["pattern"]}]  {f["text"]}',
                file=sys.stderr,
            )
        print(
            "Fix: use format_minor(m.minor_units, m.currency) (foundation) or "
            "Currency::minor_unit_exponent() for exponent-aware rendering.",
            file=sys.stderr,
        )
        return 1

    # The count and the root print on the success path too: a number that appears only
    # in the failure path is exactly how the empty-corpus run hid behind a clean verdict.
    print(
        f"verify-no-hardcoded-money-format: PASS ({scanned} production .rs file(s) under "
        f"{base}, from {root_source}) "
        "no hardcoded /100 or {}.{:02} money formatting",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
