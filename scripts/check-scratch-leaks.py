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

THE RULES THIS ENFORCES
----------------------
1. LEAKED DIRECTORY. A `scratch_dir` call whose result is never paired with a
   removal. That cannot be decided by reading one line, so this gate does what
   CAN be decided mechanically: it caps unguarded call sites at a committed
   per-file budget. Any site that adds to the budget fails, forcing the author
   to either migrate to `ScratchDir` or raise the number in a reviewable commit.

2. DROPPED GUARD. A `ScratchDir` built as a local and handed back as only its
   path — the guard then drops at the closing brace and deletes the directory it
   was created for. This was a REAL defect on 2026-10-23: it made twelve
   recovery tests fail with SQLite `CannotOpen`, which was misread as a broken
   filesystem and investigated for hours. The gate is falsified by
   reintroducing exactly that shape (see `find_dropped_guards`).

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
import contextlib
import io
import json
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUDGET_FILE = REPO / "scripts" / "scratch-leak-budget.json"
SCAN_ROOTS = ("crates", "apps", "platform", "modules")

#: How many .rs files the last scan() actually READ. A module-level counter rather than
#: a return value, so scan()'s signature and every existing caller are unchanged.
FILES_READ = 0

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


def scan(tree: Path = REPO) -> dict[str, int]:
    """Count unguarded `scratch_dir` call sites, and record how many files were read.

    The read count matters: "0 sites" and "0 files read" print the same sentence,
    so a renamed SCAN_ROOT would leave the gate printing OK over an empty scan.
    Measured 2026-10-23 by pointing every root at a nonexistent directory.
    r218: tree is the r166 contract root -- every SCAN_ROOT hangs under it and
    every reported path is relative to it, so a fixture's verdict names fixture
    files and the scan never touches the checkout the tool file lives in.
    """
    global FILES_READ
    counts: dict[str, int] = {}
    found_any = False
    for root in SCAN_ROOTS:
        base = Path(tree) / root
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            # The helper's OWN crate declares and tests the helper; counting it
            # would make the budget depend on its documentation. This is the
            # file every caller is told to read, so it is exempt by path.
            rel = path.relative_to(tree).as_posix()
            if rel == "crates/kasirmu-test-support/src/lib.rs":
                continue
            # A thin wrapper that exists ONLY to delegate to the shared helper is
            # also not a call site -- platform/sync/src/test_helpers.rs forwards
            # `scratch_dir` so its own tests keep one import. The wrapper is
            # graded by having no body of its own, which is what makes the
            # delegation safe to exempt.
            FILES_READ += 1
            text_probe = path.read_text(encoding="utf-8", errors="replace")
            if delegating_wrapper(text_probe):
                continue
            text = text_probe
            hits = count_leaks_in_text(text)
            if hits:
                found_any = True
                counts[path.relative_to(tree).as_posix()] = hits
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


def find_dropped_guards(tree: Path = REPO) -> list[str]:
    """Find functions that build a ScratchDir and return only its PATH.

    This is the defect that made twelve recovery tests fail on 2026-10-23. A
    constructor like

        let scratch = ScratchDir::new(prefix);
        Self(scratch.path().to_path_buf())

    returns a value that outlives the guard, so the guard drops at the closing
    brace, DELETES the directory, and every later file operation inside it fails
    with SQLite CannotOpen (extended code 14) -- which reads as an environment
    problem, not as a lifetime bug. The upstream symptom was a 165-line bisect
    concluding "the filesystem refuses SQLite in this one directory".

    The rule: within one function body, if a ScratchDir is BOUND to a local and
    the body also returns a `.path().to_path_buf()` / `Self(...path...)` that
    drops that binding, the guard does not reach the returned value.
    A function that stores the guard itself (`Self(scratch)`) is correct and is
    not reported.
    """
    findings: list[str] = []
    for root in SCAN_ROOTS:
        base = Path(tree) / root
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            text = path.read_text(encoding="utf-8", errors="replace")
            if "ScratchDir::new" not in text:
                continue
            rel = path.relative_to(tree).as_posix()
            for match in re.finditer(r"\bfn\s+\w+\s*\(", text):
                body_start = text.find("{", match.start())
                if body_start == -1:
                    continue
                depth = 0
                end = len(text)
                for i in range(body_start, len(text)):
                    if text[i] == "{":
                        depth += 1
                    elif text[i] == "}":
                        depth -= 1
                        if depth == 0:
                            end = i
                            break
                body = text[body_start:end]
                if "ScratchDir::new" not in body:
                    continue
                binds_guard = re.search(
                    r"let\s+(?:mut\s+)?(\w+)\s*(?::[^=]+)?=\s*[^;]*ScratchDir::new", body
                )
                if not binds_guard:
                    continue
                name = binds_guard.group(1)
                # Does the body hand back only the path while the guard dies here?
                drops_to_path = re.search(
r"Self\s*\(\s*" + re.escape(name) + r"\s*\.\s*path\s*\(\s*\)", body
                ) or re.search(
r"return\s+" + re.escape(name) + r"\s*\.\s*path\s*\(\s*\)\s*\.\s*to_path_buf", body
                )
                # Storing the guard itself is the correct shape.
                stores_guard = re.search(
                    r"Self\s*\(\s*" + re.escape(name) + r"\s*\)", body
                )
                if drops_to_path and not stores_guard:
                    line = text.count(chr(10), 0, match.start()) + 1
                    findings.append(rel + ":" + str(line))
    return findings


def self_test() -> int:
    """Grade the two things that make this gate's OK mean anything.

    No flag existed before 2026-10-23, so the only proof was the detector probe inside
    the default path -- which a reader could not run in isolation, and which does NOT
    cover the census floor added the same day. Both are covered here.
    """
    bad: list[str] = []
    cases = 0

    # 1. The detector still classifies known shapes (this is the old probe, kept as a
    #    case rather than as an inline guard, so it is runnable on its own).
    cases += 1
    if not detector_still_sees_a_call():
        bad.append("the call-site regex no longer classifies the synthetic shapes")

    # 2. THE CENSUS FLOOR, driven through scan() itself rather than by asserting a
    #    constant. Pointing every root at a nonexistent directory must leave FILES_READ
    #    at 0 -- which is the state main() refuses. (A first draft of this case compared
    #    FILES_READ against 0 after assigning it 0, which asserted that 0 == 0 and
    #    controlled nothing; the mutant below proves the new form is load-bearing.)
    global SCAN_ROOTS, FILES_READ
    saved_roots, saved_reads = SCAN_ROOTS, FILES_READ
    SCAN_ROOTS = ("definitely-not-a-directory",)
    FILES_READ = 0
    scan()
    empty_scan = FILES_READ
    SCAN_ROOTS, FILES_READ = saved_roots, saved_reads
    cases += 1
    if empty_scan != 0:
        bad.append("a scan of nonexistent roots must read 0 files, read %d" % empty_scan)

    # 3. And the real tree must read a NON-zero number of files, so the floor above is
    #    not satisfied by accident on a healthy checkout.
    saved_reads = FILES_READ
    FILES_READ = 0
    scan()
    live_scan = FILES_READ
    FILES_READ = saved_reads
    cases += 1
    if live_scan == 0:
        bad.append("the live scan read 0 files, so the floor cannot distinguish anything")

    # 4. THE FLOOR MUST ACTUALLY FIRE. Cases 2 and 3 prove scan() can tell the two
    #    states apart; nothing until now proved main() REFUSES on the empty one. Measured:
    #    deleting main()'s "if FILES_READ == 0" arm left the whole suite green, because no
    #    case called main(). Driven by running main() with dead roots and a forced-0
    #    counter, in a subprocess-free way: argv is patched so the floor arm is reached.
    import io as _io
    import contextlib as _ctx

    def _main_exit_code_with_dead_roots() -> int:
        global FILES_READ, SCAN_ROOTS
        saved_argv, saved_roots = sys.argv, SCAN_ROOTS
        saved_reads = FILES_READ
        sys.argv = ["check-scratch-leaks.py"]
        SCAN_ROOTS = ("definitely-not-a-directory",)
        FILES_READ = 0
        buf = _io.StringIO()
        try:
            with _ctx.redirect_stdout(buf), _ctx.redirect_stderr(buf):
                return main()
        finally:
            sys.argv, SCAN_ROOTS, FILES_READ = saved_argv, saved_roots, saved_reads

    cases += 1
    if _main_exit_code_with_dead_roots() != 2:
        bad.append("main() must return 2 when the scan read nothing; it returned "
                   + str(_main_exit_code_with_dead_roots()))

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    # Counted, not hardcoded: a case that runs but is not counted reads as coverage
    # it is not -- the same failure as a gate that cannot fail.
    print("SELF-TEST OK (%d cases; the last two read the real tree)" % cases)
    return shell_ladder()



def shell_ladder() -> int:
    """r218: the root contract, graded on fixtures through main(argv, root).

    The fixture carries BOTH evidence sources the gate reads -- source under the
    SCAN_ROOT names and its own scripts/scratch-leak-budget.json -- so the seam
    moves them together, the r213 rule. Rung 1 is the killing rung: a
    root-dropping main scans THIS checkout against the REAL budget, which is
    clean, and returns 0 where the fixture returns 1. Rung 5 proves --update
    writes the FIXTURE's budget and leaves the real one byte-identical.
    """

    def run(root, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def budget(path_str, cap):
        return {"description": BUDGET_DESCRIPTION, "total": cap,
                "files": {path_str: cap} if cap else {}}

    def build(tmp, *, src="unguarded", cap=0):
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=("mini%d_" % next(rung_n))))
        (base / "scripts").mkdir(parents=True, exist_ok=True)
        rel = "crates/demo/src/lib.rs"
        if src == "unguarded":
            text = 'fn t() { let d = scratch_dir("x"); use_it(&d); }\n'
        elif src == "dropped":
            # the EXACT textual shape find_dropped_guards hunts: a guard bound
            # to a local, then `return <name>.path().to_path_buf` -- the value
            # outlives the guard, the guard deletes the directory at the brace
            text = ('fn make() -> std::path::PathBuf {\n'
                    '    let scratch = ScratchDir::new("p");\n'
                    '    std::fs::create_dir_all(scratch.path()).ok();\n'
                    '    return scratch.path().to_path_buf();\n'
                    '}\n')
        else:
            text = "fn clean() { let d = scratch_dir(\"x\"); std::fs::remove_dir_all(&d).ok(); }\n"
        (base / "crates" / "demo" / "src").mkdir(parents=True, exist_ok=True)
        (base / "crates" / "demo" / "src" / "lib.rs").write_text(
            text, encoding="utf-8", newline="\n")
        (base / "scripts" / "scratch-leak-budget.json").write_text(
            json.dumps(budget(rel, cap), indent=2) + "\n", encoding="utf-8")
        return base

    rung_n = iter(range(1000))

    shell = 0
    with tempfile.TemporaryDirectory() as tmp:
        # rung 1 IS the killing rung: one unguarded call against a budget of 0
        root = build(tmp, cap=0)
        rc, said = run(root)
        if rc != 1 or "NEW UNGUARDED SCRATCH DIRECTORY SITE(S):" not in said \
                or "crates/demo/src/lib.rs: 1 unguarded call(s), budget 0" not in said:
            print("  x rung 1: an over-budget file must fail rc 1, named "
                  "fixture-relative (rc=%r said=%r)" % (rc, said[-200:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 2: the same file under a budget of 1 is within budget -- the
        # budget is the committed allowance, not a pass over nothing
        root = build(tmp, cap=1)
        rc, said = run(root)
        if rc != 0 or "OK: no file exceeds its unguarded-site budget" not in said:
            print("  x rung 2: a within-budget file must read OK rc 0 (rc=%r "
                  "said=%r)" % (rc, said[-200:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3: the dropped-guard shape is found in the FIXTURE's tree and
        # reported even while the budget is clean
        root = build(tmp, src="dropped")
        rc, said = run(root)
        if rc != 1 or "GUARD DROPPED BEFORE ITS VALUE IS RETURNED:" not in said \
                or "crates/demo/src/lib.rs" not in said:
            print("  x rung 3: a dropped ScratchDir guard must fail rc 1 named "
                  "fixture-relative (rc=%r said=%r)" % (rc, said[-200:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 4: a fixture without its OWN budget file refuses -- the budget
        # lookup moved with the root, so a fixture cannot read the real one
        root = build(tmp)
        (root / "scripts" / "scratch-leak-budget.json").unlink()
        rc, said = run(root)
        if rc != 2 or "budget file missing" not in said \
                or "scratch-leak-budget.json" not in said:
            print("  x rung 4: a missing fixture budget must refuse rc 2 (rc=%r "
                  "said=%r)" % (rc, said[-200:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5: --update writes the FIXTURE's budget from the fixture's scan,
        # and the REAL budget file is byte-identical before and after -- a
        # budget rewrite that escaped the fixture would be the cross-tree write
        # the whole seam exists to prevent
        root = build(tmp, cap=0)
        real_budget = REPO / "scripts" / "scratch-leak-budget.json"
        before = real_budget.read_bytes()
        rc, said = run(root, "--update")
        after = real_budget.read_bytes()
        wrote = json.loads((root / "scripts" / "scratch-leak-budget.json")
                           .read_text(encoding="utf-8"))
        if rc != 0 or "budget written: 1 site(s) across 1 file(s)" not in said \
                or wrote.get("total") != 1 or before != after:
            print("  x rung 5: --update must write the fixture's budget and "
                  "leave the real one untouched (rc=%r said=%r)" % (rc, said[-190:]),
                  file=sys.stderr)
            return 1
        shell += 1

    print("SCRATCH-LEAKS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None):
    # r218: the r166 contract. argv is explicit; root names the tree to scan AND
    # where the budget file lives -- the fixture carries both, so the seam moves
    # every evidence source together (the r213 rule). A root-dropping main scans
    # the checkout and reads the real budget no matter what fixture was built.
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="run this checker's cases and exit",
    )
    ap.add_argument(
        "--update",
        action="store_true",
        help="rewrite the budget from the current tree (only after migrating sites)",
    )
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    tree = REPO if root is None else Path(root).resolve()
    budget_path = tree / "scripts" / "scratch-leak-budget.json"

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

    counts = scan(tree)
    total = sum(counts.values())

    # THE CENSUS FLOOR. "0 sites" and "0 files read" print the same sentence. Measured
    # 2026-10-23: renaming all four SCAN_ROOTS to nonexistent directories left this gate
    # printing "OK: no file exceeds its unguarded-site budget" over an empty scan, and
    # the synthetic-source probe above cannot see it -- it grades the regex, not the tree.
    if FILES_READ == 0:
        print("", file=sys.stderr)
        print("SCAN READ NOTHING: 0 .rs file(s) under " + ", ".join(SCAN_ROOTS),
              file=sys.stderr)
        print("  The roots moved, were renamed, or the walk stopped matching. Refusing",
              file=sys.stderr)
        print("  to report a clean budget over a tree nobody read.", file=sys.stderr)
        return 2

    # Second defect class, same root cause: a guard that never reaches the value
    # it was created for. Checked BEFORE the budget so it reports even when the
    # budget is at zero (which it now is).
    dropped = find_dropped_guards(tree)

    if args.update:
        budget_path.write_text(
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

    if not budget_path.is_file():
        print(f"SCAN BROKE: budget file missing: {budget_path}", file=sys.stderr)
        return 2
    budget = json.loads(budget_path.read_text(encoding="utf-8"))
    allowed: dict[str, int] = budget.get("files", {})

    regressions: list[str] = []
    for path, n in sorted(counts.items()):
        cap = allowed.get(path, 0)
        if n > cap:
            regressions.append(f"  {path}: {n} unguarded call(s), budget {cap}")

    print(f"unguarded scratch_dir sites: {total} across {len(counts)} file(s)")
    print(f"budgeted:                    {budget.get('total')}")

    if dropped:
        print("", file=sys.stderr)
        print("GUARD DROPPED BEFORE ITS VALUE IS RETURNED:", file=sys.stderr)
        for line in dropped:
            print(f"  {line}", file=sys.stderr)
        print("", file=sys.stderr)
        print(
            "A ScratchDir built as a local and returned as .path().to_path_buf()",
            file=sys.stderr,
        )
        print(
            "deletes its own directory when the function returns. Store the guard",
            file=sys.stderr,
        )
        print(
            "instead: Self(scratch), and read scratch.path() at the accessors.",
            file=sys.stderr,
        )
        return 1

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