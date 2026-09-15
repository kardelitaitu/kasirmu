"""Fail a verification run whose Postgres cases silently did not execute.

Why this exists.  In `apps/cloud-server`, `crates/oz-api` and `platform/sync` a
Postgres-gated test does not use `#[ignore]`.  It probes for a database, prints
an "… test skipped …" line through `eprintln!`, and then `return`s.  A `return`
is a PASS to the runner, so `cargo test` exits 0 and the summary reads
`347 passed; 0 failed` on a machine with no container.  Measured 2026-09-15 at
tip `8eec36261`: of 354 reported-ok cases in `oz-cloud-server`, 36 printed a skip
and therefore verified nothing -- 10.2% of a clean-looking green.

It is worse than merely quiet.  The skip line cannot be grepped out of a default
run either, because libtest captures and discards the stdout/stderr of tests that
PASS.  A condition written as "the log must show zero skipped lines" is therefore
satisfied by the exact run that verified least.  `-- --nocapture` is the only
thing that makes the message reach the log, and this script demands it.

Scope note, and it matters: CI is NOT the broken environment.
`dev-ci.yml:205`-`:220` declares a `postgres:17-alpine` service and sets
`OZ_TEST_PG_URL` at job level, and every gated test reads that variable first, so
in CI these arms connect and those cases really run.  That is also why the obvious
"cleanup" -- converting the arms to `#[ignore]`, the idiom `platform/sync` already
uses elsewhere -- would be a regression: nothing in `scripts/` or `.github/` passes
`--run-ignored`, so `#[ignore]` removes 62 PG cases from the only environment that
executes them.  This script deliberately changes no test and is not wired into any
workflow; it grades a local run a human or a lane asked to *verify* something.

Two independent checks, because one channel already lied once here:
  1. LOG    -- a `--nocapture` run must print zero skip events.
  2. SOURCE -- the tree must still contain the skip arms.  Without this, deleting
     the `eprintln!` while keeping the `return` makes check 1 vacuously green,
     which is "decoration wearing a guard" (the `30c2470e9` lesson in this repo's
     own records).

Run:
    python scripts/verify-pg-tests-ran.py                     # runs cargo itself
    python scripts/verify-pg-tests-ran.py --log captured.log   # grade an existing log
    python scripts/verify-pg-tests-ran.py --self-test          # prove both directions
Exit 0 = clean, 1 = findings or unprovable run.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CRATES = ["oz-cloud-server", "oz-api", "platform-sync"]

# Source trees the arm census walks. Deliberately a filesystem walk, not
# `git ls-files`: subprocess with captured stdio is denied under some agent
# sandboxes, and a guard that cannot run is not a guard.
SRC_TREES = ["apps", "crates", "platform", "modules", "foundation"]

# An arm = an eprintln whose literal says "skip", case-insensitively at the word
# start so "skipped"/"Skipping"/"SKIP" all land.
ARM_RE = re.compile(r'eprintln!\s*\(\s*"[^"]*[Ss][Kk][Ii][Pp]', re.IGNORECASE)

# A skip EVENT in test output: the word "skip" as its own word, on a line that is
# NOT a runner result line. The exclusion is the whole point --
# `test sync_store::tests::sqlite_unstamped_payload_is_skipped_not_flagged ... ok`
# contains "skipped" and is a test NAME, not a skip. Counting it would report a
# false finding on a machine that has Postgres.
SKIP_RE = re.compile(r"\bskip(?:ped|s|ping)?\b", re.IGNORECASE)
RESULT_LINE_RE = re.compile(r"^\s*(?:test\s+\S+\s+\.\.\.\s|\s*test result:|running \d|\[\s*\d+/)")

SUMMARY_RE = re.compile(
    r"test result: (?:ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored"
)


def _arm_body(lines: list[str], start: int) -> list[str]:
    """Lines of the skip arm's own block, from `start` up to where it closes.

    "Where it closes" = the first following line that starts with `}` at an
    indent no greater than the eprintln's. Without this the census reads the
    *neighbouring* match arm and calls it a skip:
    crates/oz-security/src/lib_tests.rs:95 ends its `KeyUnavailable` arm with a
    bare `}`, and the `panic!` two lines later belongs to `Err(other)`, a
    different arm that genuinely does fail. Reading across the boundary would
    count a print-and-continue fallback as a silent pass.
    """
    base = len(lines[start]) - len(lines[start].lstrip())
    body: list[str] = []
    for line in lines[start + 1 :]:
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip())
        if stripped.startswith("}") and indent <= base:
            break
        body.append(line)
    return body


# An arm abandons the test if its own block returns, panics, or propagates `None`
# (a helper's skip). Note the macros are matched as `name!` followed by `(`:
# `\bpanic!\b` NEVER matches, because `!` is a non-word character and `(` after it
# is also non-word, so there is no boundary to assert. That bug made this census
# silently `return`-only until it was caught by probing an excluded site.
ABANDON_RE = re.compile(r"\breturn\b|(?:\bpanic!|\bfail!|\bunreachable!)\s*\(")
PROPAGATE_RE = re.compile(r"^\s*None\s*,?\s*$", re.MULTILINE)


def arm_abandons(lines: list[str], start: int) -> bool:
    """Does the skip at `lines[start]` actually give up on the test?

    One implementation, used by both the census and the self-test, so a fixture
    can never drift away from what the tree scan does.
    """
    joined = "\n".join(_arm_body(lines, start))
    return bool(ABANDON_RE.search(joined) or PROPAGATE_RE.search(joined))


def count_source_arms() -> tuple[int, dict[str, int]]:
    """Return (arm_count, per_file) for print-then-abandon skip arms in test files.

    Two shape rules, not a filename allowlist, so the census cannot silently
    widen as files are renamed:
      * only test code -- path contains `_tests` or a `tests/` segment, which
        excludes production `eprintln!` notes like the WAL-checkpoint line in
        crates/oz-cli/src/commands/backup.rs;
      * only arms that actually abandon the test -- a `return`, `panic!`, `fail!`,
        `unreachable!` or a bare `None` *inside the arm's own block*. The bare
        `None` is how a helper propagates a skip to its callers (both arms in
        apps/cloud-server/src/redis_backend_tests.rs:85/:89 are that shape, and
        their callers then do `let Some(..) = helper() else { return }`).
    """
    per_file: dict[str, int] = {}
    for tree in SRC_TREES:
        base = ROOT / tree
        if not base.is_dir():
            continue
        for path in base.rglob("*.rs"):
            rel = path.relative_to(ROOT).as_posix()
            if "_tests" not in rel and "/tests/" not in rel:
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            hits = 0
            for i, line in enumerate(lines):
                if ARM_RE.search(line) and arm_abandons(lines, i):
                    hits += 1
            if hits:
                per_file[rel] = hits
    return sum(per_file.values()), per_file


def parse_log(text: str) -> dict:
    passed = failed = ignored = 0
    events: list[str] = []
    for line in text.splitlines():
        m = SUMMARY_RE.search(line)
        if m:
            passed += int(m.group(1))
            failed += int(m.group(2))
            ignored += int(m.group(3))
            continue
        if SKIP_RE.search(line) and not RESULT_LINE_RE.search(line):
            events.append(line.strip())
    return {"passed": passed, "failed": failed, "ignored": ignored, "events": events}


def run_cargo(crates: list[str]) -> tuple[int, str]:
    chunks: list[str] = []
    rc = 0
    for krate in crates:
        cmd = ["cargo", "test", "-p", krate, "--", "--nocapture"]
        print(f"$ {' '.join(cmd)}", file=sys.stderr)
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        chunks.append(proc.stdout or "")
        chunks.append(proc.stderr or "")
        if proc.returncode != 0:
            rc = proc.returncode
    return rc, "\n".join(chunks)


def grade(text: str, arms: int, per_file: dict[str, int], *, proven: bool) -> int:
    report = parse_log(text)
    ok = True

    if arms == 0:
        print("FAIL  SOURCE: no print-then-abandon skip arms found in the tree.")
        print("      Check 1 is now vacuous: either the arms were genuinely")
        print("      converted to a mechanism that reports a number, or the")
        print("      eprintln! lines were deleted while the `return` stayed.")
        print("      Re-read scripts/verify-pg-tests-ran.py's shape rules before")
        print("      believing a green here.")
        ok = False
    else:
        files = len(per_file)
        print(f"ok    SOURCE: {arms} skip arms across {files} test files (census only)")

    if not report["passed"] and not report["failed"]:
        print("FAIL  LOG: no `test result:` summary line found.")
        print("      A run with no summary proves nothing; if you piped a log,")
        print("      check it is a cargo-test capture and not a build log.")
        return 1

    print(
        f"      RUN: {report['passed']} passed; {report['failed']} failed; "
        f"{report['ignored']} ignored"
    )

    if report["failed"]:
        print(f"FAIL  LOG: {report['failed']} failed test(s) -- real failures, fix those first.")
        ok = False

    if report["events"]:
        # A skip event is itself proof the run was not suppressing output, so
        # `proven` cannot rescue this branch -- and it should not: this is a finding.
        print(f"FAIL  LOG: {len(report['events'])} silent skip event(s) -- cases that"
              " printed a skip and then returned, which the runner reports as PASS:")
        for ev in report["events"]:
            print(f"        {ev}")
        print()
        print("      These are NOT failures and NOT ignores. They are unverified")
        print("      tests wearing a pass, and the summary line cannot see them.")
        print("      Bring up the container -- see scripts/reset-dev-pg.sh:19-21 --")
        print("      or drop this run's claim to say 'local, PG cases unrun'.")
        ok = False
    elif not proven:
        # Load-bearing, not advisory. Absence of skip lines in a log that may not
        # have been captured with --nocapture is UNPROVABLE, and an earlier version
        # of this script printed a warning here and then exited 0 -- reproducing,
        # inside the tool built to catch it, the exact vacuous-green failure that
        # `todo-refactor-cloud-sync-agents-1.md:64` was wrong about all evening.
        print("FAIL  LOG: zero skip events, but the run is UNPROVEN.")
        print("      libtest suppresses a passing test's stdout, so a log captured")
        print("      without `-- --nocapture` reads identical whether 36 cases")
        print("      skipped or 0 did. A clean reading here cannot be distinguished")
        print("      from a suppressed one, and this tool does not report PASS on")
        print("      something it cannot see. Options:")
        print("        * run it without --log, so the cargo call is made here with")
        print("          --nocapture and the result is proven by construction;")
        print("        * or pass --assume-nocapture if YOU captured it that way --")
        print("          that moves the claim onto you, loudly, which is the point.")
        ok = False
    else:
        print("ok    LOG: zero skip events; every gated case actually executed.")

    print("\n" + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


# --- self-test ---------------------------------------------------------------
# A guard nobody can prove is failable is decoration. Both directions are
# planted in memory: no fixture file is ever written to the tree.
CLEAN_LOG = """
running 12 tests
test a::pg_integration_one ... ok
test a::sqlite_unstamped_payload_is_skipped_not_flagged ... ok
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
"""

DIRTY_LOG = """
running 12 tests
PG sync-store integration test skipped: cannot create throwaway DB
test a::pg_integration_one ... ok
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
"""


def self_test() -> int:
    fails = 0

    def expect(name: str, cond: bool) -> None:
        nonlocal fails
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
        if not cond:
            fails += 1

    # (1) the test-name false positive must NOT be counted as a skip.
    clean = parse_log(CLEAN_LOG)
    expect("clean log yields 0 skip events despite a test NAMED *_is_skipped_*",
           clean["events"] == [])
    expect("clean log still reads its summary (12 passed)", clean["passed"] == 12)

    # (2) a real skip must be caught.
    dirty = parse_log(DIRTY_LOG)
    expect("dirty log yields exactly 1 skip event", len(dirty["events"]) == 1)
    expect("the event is the throwaway-DB line",
           any("throwaway DB" in e for e in dirty["events"]))

    # (3) the SOURCE census must be non-zero on this tree, and its two shape
    #     rules must each exclude the case they were written for.
    arms, per_file = count_source_arms()
    expect(f"tree census finds skip arms (measured {arms})", arms > 0)
    expect("production WAL-checkpoint eprintln is NOT counted as an arm",
           not any(p.endswith("commands/backup.rs") for p in per_file))
    expect("print-and-continue keyring fallback is NOT counted as an arm",
           not any("oz-security" in p for p in per_file))

    # (3b) the arm-boundary and macro rules, as fixtures. These exist because
    #      `\bpanic!\b` cannot ever match -- `!` is non-word and `(` after it is
    #      too, so there is no boundary to assert -- which made an early version
    #      of this census silently `return`-only while still printing a plausible
    #      total. Both directions are planted here so that bug cannot return.
    def arms(src: str) -> int:
        lines = src.splitlines()
        return sum(1 for i, ln in enumerate(lines)
                   if ARM_RE.search(ln) and arm_abandons(lines, i))

    panic_arm = (
        'fn t() {\n'
        '    match connect() {\n'
        '        Ok(c) => c,\n'
        '        Err(e) => {\n'
        '            eprintln!("PG test skipped: {e}");\n'
        '            panic!("required");\n'
        '        }\n'
        '    }\n'
        '}\n'
    )
    expect("an arm that ends in panic! IS counted (the \\b macro bug cannot return)",
           arms(panic_arm) == 1)

    neighbour_arm = (
        'fn t() {\n'
        '    match default_keyring() {\n'
        '        Ok(k) => { let _ = k; }\n'
        '        Err(KeyUnavailable(_)) => {\n'
        '            eprintln!("skipped: no keyring on this host");\n'
        '        }\n'
        '        Err(other) => panic!("unexpected: {other:?}"),\n'
        '    }\n'
        '}\n'
    )
    expect("a panic! in the NEXT match arm is NOT read as this arm abandoning",
           arms(neighbour_arm) == 0)

    helper_none = (
        'fn helper() -> Option<Pool> {\n'
        '    match connect() {\n'
        '        Ok(Some(b)) => Some(b),\n'
        '        Ok(None) => {\n'
        '            eprintln!("Redis integration test skipped");\n'
        '            None\n'
        '        }\n'
        '    }\n'
        '}\n'
    )
    expect("a helper propagating a bare None IS counted (redis_backend_tests shape)",
           arms(helper_none) == 1)

    # (4) grade() must fail on a zero census even with a clean log -- the
    #     vacuity this guard exists to catch.
    import io
    from contextlib import redirect_stdout

    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_clean_zero = grade(CLEAN_LOG, 0, {}, proven=True)
    expect("grade() fails when the arm census hits 0 (vacuity guard)", rc_clean_zero == 1)

    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_dirty = grade(DIRTY_LOG, arms, per_file, proven=True)
    expect("grade() fails a run containing a skip event", rc_dirty == 1)

    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_ok = grade(CLEAN_LOG, arms, per_file, proven=True)
    expect("grade() passes a clean run with a live census AND a proven capture", rc_ok == 0)

    # (5) the case this tool exists for: a clean-looking log that may simply have
    #     suppressed the evidence must NOT pass. Before this assertion existed, the
    #     script printed a warning here and returned 0 -- the vacuous green,
    #     reproduced in the instrument meant to catch it.
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_unproven = grade(CLEAN_LOG, arms, per_file, proven=False)
    expect("grade() FAILS an unproven clean log (suppression cannot be read as absence)",
           rc_unproven == 1)
    expect("the unproven verdict says UNPROVEN rather than PASS",
           "UNPROVEN" in buf.getvalue() and "PASS\n" not in buf.getvalue())

    print(f"\nself-test: {'PASS' if fails == 0 else f'FAIL ({fails})'}")
    return 0 if fails == 0 else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--log", type=Path, help="grade an existing captured log instead of running cargo")
    ap.add_argument("--crate", action="append", dest="crates", help="crate to run (repeatable)")
    ap.add_argument("--census-only", action="store_true", help="print the source census and exit 0")
    ap.add_argument("--assume-nocapture", action="store_true",
                    help="assert that a supplied --log was captured with -- --nocapture; "
                         "without it, a log showing zero skips is UNPROVEN, not clean")
    ap.add_argument("--self-test", action="store_true", help="prove both directions failable")
    ns = ap.parse_args(argv)

    if ns.self_test:
        return self_test()

    arms, per_file = count_source_arms()
    if ns.census_only:
        for rel, n in sorted(per_file.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"{n:3d}  {rel}")
        print(f"{arms:3d}  TOTAL skip arms across {len(per_file)} test files")
        return 0

    if ns.log:
        text = ns.log.read_text(encoding="utf-8", errors="replace")
        # The flag's own text only counts if whoever captured the log echoed the
        # command; it is a hint, so it is reported, never silently trusted.
        echoed = "--nocapture" in text
        proven = ns.assume_nocapture or echoed
        if echoed and not ns.assume_nocapture:
            print("note  the string `--nocapture` appears in the log; treating the run"
                  " as proven. If that is the wrong read, this result is meaningless.")
    else:
        # Made here, with the flag, so absence of skips is evidence of absence.
        _, text = run_cargo(ns.crates or CRATES)
        proven = True

    return grade(text, arms, per_file, proven=proven)


if __name__ == "__main__":
    sys.exit(main())
