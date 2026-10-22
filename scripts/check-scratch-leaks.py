#!/usr/bin/env python3
"""Grade the workspace for scratch-directory LEAKS, not for style.

WHY THIS EXISTS
---------------
`kasirmu-test-support` offers two ways to make a scratch dir under
`target/test-scratch/`:

  `scratch_dir(prefix) -> PathBuf`      no drop guard — deletes nothing
  `ScratchDir::new(prefix)`             `Drop` calls `remove_dir_all`

Nothing in the test suite could see the difference. `ScratchDir` had a test
proving it cleans up; the unguarded helper had none proving it does not, so a
caller that chose it leaked one directory per run and every test stayed green.
Measured 2026-10-23: 1,455 directories in `target/test-scratch/`, 706 from a
bridge harness and the rest from 30 direct `scratch_dir` call sites.

THE RULE THIS ENFORCES
----------------------
A LEAK is a `scratch_dir` call whose result is never paired with a removal.
That cannot be decided by reading one line, so this gate does the thing that
CAN be decided mechanically and is nearly as good: it caps the number of
unguarded call sites at a committed budget, per file. Any call site that adds
to the budget fails, which forces the author to either migrate to `ScratchDir`
or state, in this file, why theirs is the exception.

A budget is not a fix. It is the difference between a leak nobody can add to
and a leak nobody knows the size of.

EXIT CODES
    0  no file exceeds its budget
    1  a file exceeds its budget (a new unguarded call site landed)
    2  the scan itself broke (no source files found, budget file unreadable)

Usage, from the repo root:

    python scripts/check-scratch-leaks.py            # report and grade
    python scripts/check-scratch-leaks.py --update   # rewrite the budget from
                                                     # the tree (ONLY after
                                                     # migrating call sites)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUDGET_FILE = REPO / "scripts" / "scratch-leak-budget.json"
SCAN_ROOTS = ("crates", "apps", "platform", "modules")

# A call site is `kasirmu_test_support::scratch_dir(` or `scratch_dir(` after a
# `use kasirmu_test_support::scratch_dir` import. Matching the bare name too
# matters: 6 of the 30 original sites imported it and called it unqualified.
CALL_RE = re.compile(r"(?:kasirmu_test_support\s*::\s*)?\bscratch_dir\s*\(")

#: A file that removes its own scratch directory is not leaking. Coarse on
#: purpose: the alternative is dataflow analysis, and the failure this gate
#: guards against (nobody cleans up at all) is visible from the file alone.
REMOVAL_RE = re.compile(r"\bremove_dir_all\s*\(")

BUDGET_DESCRIPTION = (
    "Unguarded kasirmu_test_support::scratch_dir call sites, per file. "
    "Regenerate with 'python scripts/check-scratch-leaks.py --update' ONLY "
    "after migrating call sites to ScratchDir::new. Raising a number here is "
    "not a fix; it is an accepted leak."
)


def scan() -> dict[str, int]:
    """Count unguarded `scratch_dir` call sites per repo-relative file."""
    counts: dict[str, int] = {}
    found_any = False
    for root in SCAN_ROOTS:
        base = REPO / root
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            # The helper's OWN crate declares and tests the helper; counting it
            # would make the budget depend on its documentation. This is the
            # file every caller is told to read, so it is exempt by path.
            rel = path.relative_to(REPO).as_posix()
            if rel == "crates/kasirmu-test-support/src/lib.rs":
                continue
            # A thin wrapper that exists ONLY to delegate to the shared helper is
            # also not a call site -- platform/sync/src/test_helpers.rs forwards
            # `scratch_dir` so its own tests keep one import. The wrapper is
            # graded by having no body of its own, which is what makes the
            # delegation safe to exempt.
            text_probe = path.read_text(encoding="utf-8", errors="replace")
            if delegating_wrapper(text_probe):
                continue
            text = text_probe
            hits = count_leaks_in_text(text)
            if hits:
                found_any = True
                counts[path.relative_to(REPO).as_posix()] = hits
    # NOTE ON "found nothing". An earlier version treated zero as a broken scan
    # and exited 2. That was right while 30 real sites existed, and became WRONG
    # the moment they were migrated: zero is now the goal, not a fault, and a
    # gate that refuses its own success is a gate someone deletes. The property
    # worth defending is that the DETECTOR still sees calls, which
    # `detector_still_sees_a_call()` grades against synthetic source before any
    # file is read. That check, not a non-zero total, is what stops a vacuous
    # pass. `found_any` is kept only so `--verbose` can report the breakdown.
    _ = found_any
    return counts


def count_leaks_in_text(text: str) -> int:
    """Count UNGUARDED call sites, pairing each with a removal in its OWN scope.

    The pairing has to be per function, not per file. A per-file test is what an
    earlier draft used, and it silently swallowed an injected leak: the file it
    was injected into already called remove_dir_all somewhere, so the new call
    inherited that file-wide credit. A leak added to any file that cleans up in
    one place would have passed the gate.

    The scope is approximated as "the text between this call and the next fn
    boundary". That is generous -- a removal later in the same function counts --
    which is the SAFE direction: it never reports a leak that is not there, and a
    caller that removes AFTER using the directory is still correct code.
    """
    leaks = 0
    for match in CALL_RE.finditer(text):
        # Skip the definition and any doc/comment mention.
        line_start = text.rfind("\n", 0, match.start()) + 1
        line_end = text.find("\n", match.start())
        line = text[line_start : line_end if line_end != -1 else len(text)]
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        if re.search(r"\bfn\s+scratch_dir\s*\(", line):
            continue
        # The call's own scope. Bounded by BOTH the next function boundary and
        # the brace that closes the enclosing block, whichever comes first: a
        # call in the LAST function of a file has no following `fn`, so bounding
        # only on "next fn" let its scope run to EOF and absorb every
        # `remove_dir_all` anywhere below it. That is not hypothetical -- it is
        # exactly how this gate missed two injected leaks.
        rest = text[match.start() :]
        next_fn = re.search(r"\n\s*(?:pub\s+)?(?:async\s+)?fn\s", rest)
        limit = next_fn.start() if next_fn else len(rest)
        depth = 0
        for i, ch in enumerate(rest[:limit]):
            if ch == "{":
                depth += 1
            elif ch == "}":
                if depth == 0:
                    limit = i
                    break
                depth -= 1
        scope = rest[:limit]
        if not REMOVAL_RE.search(scope):
            leaks += 1
    return leaks


def delegating_wrapper(text: str) -> bool:
    """Whether the file's `scratch_dir` entries only forward to the shared one.

    True when every occurrence of the name inside a `fn scratch_dir` body is a
    `kasirmu_test_support::scratch_dir` call and the body carries no
    `create_dir_all` of its own. A wrapper that reimplements the root lookup is
    NOT exempt -- that is the duplication this whole round removed.
    """
    saw_one = False
    for match in re.finditer(r"fn\s+scratch_dir\s*\(", text):
        saw_one = True
        body = text[match.start() : match.start() + 1200]
        if "kasirmu_test_support::scratch_dir" not in body:
            return False
        # A hand-rolled implementation would walk the filesystem itself.
        head = body.split("\n}")[0]
        if "ancestors()" in head or ".join(\"test-scratch\")" in head:
            return False
    # NO definition means NO wrapper. Without this explicit guard the loop never
    # ran and the function fell through to "return True", so EVERY file in the
    # workspace was exempted and the gate graded nothing at all -- while still
    # printing OK. Measured: two separately injected leaks, in two different
    # crates, both passed. A predicate that is vacuously true over an empty set
    # is the same defect class as a gate that checks nothing.
    return saw_one



#: Synthetic sources the self-check runs the detector over. Each is a SHAPE the
#: real scan must still recognise; if any stops matching, the gate is deaf.
DETECTOR_PROBES = (
    # --- shapes the detector must COUNT as leaks ---
    ("qualified call", 'fn t() { let d = kasirmu_test_support::scratch_dir("x"); }', 1),
    ("imported call", 'fn t() { let d = scratch_dir("x"); }', 1),
    ("spaced call", 'fn t() { let d = kasirmu_test_support :: scratch_dir ("x"); }', 1),
    # --- shapes it must NOT count ---
    ("definition", "pub fn scratch_dir(prefix: &str) -> PathBuf {", 0),
    ("doc mention", "/// see scratch_dir for the unguarded option", 0),
    ("line comment", "// scratch_dir(x) leaks", 0),
    # --- the scope-pairing rule, both directions ---
    (
        "paired removal counts as clean",
        'fn t() { let d = scratch_dir("x"); use_it(&d); std::fs::remove_dir_all(&d).ok(); }',
        0,
    ),
    (
        "removal in a DIFFERENT fn does not cover this call",
        'fn clean() { std::fs::remove_dir_all("z").ok(); }'
        'fn leaky() { let d = scratch_dir("x"); }',
        1,
    ),
    (
        "second call in a file that cleans up once is still a leak",
        'fn a() { let d = scratch_dir("x"); std::fs::remove_dir_all(&d).ok(); }'
        '\nfn b() { let e = scratch_dir("y"); }',
        1,
    ),
)


def detector_still_sees_a_call() -> bool:
    """Whether :func:`count_leaks_in_text` still classifies known shapes."""
    for name, src, expected in DETECTOR_PROBES:
        got = count_leaks_in_text(src)
        if got != expected:
            print(
                f"  probe {name!r}: expected {expected} call(s), detector found {got}",
                file=sys.stderr,
            )
            return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--update",
        action="store_true",
        help="rewrite the budget from the current tree (only after migrating sites)",
    )
    args = ap.parse_args()

    # A gate that grades a detector nobody re-checks is this project's most
    # repeated failure. Grade the detector over synthetic source FIRST: if the
    # regex were broken by an edit, every real file would report zero unguarded
    # sites and this gate would print OK while grading nothing.
    if not detector_still_sees_a_call():
        print("", file=sys.stderr)
        print(
            "DETECTOR WENT DEAF: the call-site regex no longer matches a known",
            file=sys.stderr,
        )
        print(
            "scratch_dir call. Every file would report zero and this gate would",
            file=sys.stderr,
        )
        print("pass vacuously. Fix CALL_RE before trusting any result.", file=sys.stderr)
        return 2

    counts = scan()
    total = sum(counts.values())

    if args.update:
        BUDGET_FILE.write_text(
            json.dumps(
                {
                    "description": BUDGET_DESCRIPTION,
                    "total": total,
                    "files": dict(sorted(counts.items())),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"budget written: {total} site(s) across {len(counts)} file(s)")
        return 0

    if not BUDGET_FILE.is_file():
        print(f"SCAN BROKE: budget file missing: {BUDGET_FILE}", file=sys.stderr)
        return 2
    budget = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
    allowed: dict[str, int] = budget.get("files", {})

    regressions: list[str] = []
    for path, n in sorted(counts.items()):
        cap = allowed.get(path, 0)
        if n > cap:
            regressions.append(f"  {path}: {n} unguarded call(s), budget {cap}")

    print(f"unguarded scratch_dir sites: {total} across {len(counts)} file(s)")
    print(f"budgeted:                    {budget.get('total')}")

    if regressions:
        print("", file=sys.stderr)
        print("NEW UNGUARDED SCRATCH DIRECTORY SITE(S):", file=sys.stderr)
        for line in regressions:
            print(line, file=sys.stderr)
        print("", file=sys.stderr)
        print(
            "Each one leaks a directory per test run into target/test-scratch/,",
            file=sys.stderr,
        )
        print(
            "which no OS cleaner sweeps. Use ScratchDir::new and let the guard",
            file=sys.stderr,
        )
        print(
            "delete it: see crates/kasirmu-test-support/src/lib.rs.",
            file=sys.stderr,
        )
        return 1

    print("OK: no file exceeds its unguarded-site budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())