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
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CRATES = ["oz-cloud-server", "oz-api", "platform-sync"]

# Source trees the arm census walks. Deliberately a filesystem walk, not
# `git ls-files`: subprocess with captured stdio is denied under some agent
# sandboxes, and a guard that cannot run is not a guard.
SRC_TREES = ["apps", "crates", "platform", "modules", "foundation"]

# An arm = an `eprintln!` whose literal says "skip". IGNORECASE covers the case
# folding; an earlier revision also spelled out [Ss][Kk][Ii][Pp], which is
# redundant under the flag and was simplified only after --self-test confirmed the
# census byte-identical at 64/12, not on the assumption that it was.
ARM_RE = re.compile(r'eprintln!\s*\(\s*"[^"]*skip', re.IGNORECASE)

# ── The SOURCE channel is armed with TWO guards, not one, and both directions
#    are planted in --self-test.
#
# A bare "arms > 0" check catches only total blindness. If a lane rewrites the
# messages ("PG test unavailable, continuing") or a parser drifts, the census
# quietly shrinks 64 -> 40 and a green still prints. This repo already learned
# that lesson twice, and `AGENTS.md` records both cases: `402b11660` replaced
# `popupBackgroundCompliance`'s five `toBeGreaterThan(0)` floors with "magnitude
# floors set with headroom below the value each was measured from", each failure
# naming the baseline it fell from, AND a graded-set identity check; and
# `b65ced27a` gave `themeTokenCompliance` floors on nested reads (>= 60) and on
# distinct inner names (>= 15) so "a harvest that stops descending reads red".
# The plant that settles it, quoted from that page: with a gradable rule filtered
# out of the graded door, "all four magnitude floors passed and only the identity
# check fired -- a floor on size and a check on membership are different guards,
# and this suite needs both." Same reasoning here: ARM_FLOOR bounds the size,
# ARM_CRATES bounds the membership, and a partition that sums correctly can still
# be walking a silently narrowed population.
#
# Measured baseline: 68 arms across 12 test files in 3 crates. Moved 64 -> 66 -> 68 on
# 2026-09-16: +2 when the migrate-bin tests gained a throwaway DB arm each, +2 more when
# pg_integration_rls_force_blocks_owner (db_tests.rs) gained a CREATE-DATABASE arm and a
# connect arm of its own for the same isolation. The assertion has fired on every one of
# those edits, which is the only reason the number below is a measurement and not a memory.
# Was 64 until
# 2026-09-16, when the two migrate-bin PG tests gained a throwaway database and
# each acquired a second skip arm ("cannot create throwaway DB") alongside its
# original connect arm. The self-test's baseline assertion fired on that edit the
# moment it was made -- which is the entire reason it asserts equality rather than
# printing a count: a census that silently grows is as untrustworthy as one that
# silently shrinks. Floor unchanged at 55; only the reference moved.
ARM_FLOOR = 55  # headroom below 68: absorbs a legitimate conversion, fires on drift
ARM_BASELINE = 68
# Per-crate membership: each crate that owns arms today must keep at least one.
# Renaming a file survives this; a whole crate's arms going uncounted does not,
# which is the "fix landed in one crate, 17 left behind" failure in another form.
ARM_CRATES = ("apps/cloud-server", "crates/oz-api", "platform/sync")

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

# Nextest prints a different summary shape; see the diagnosis in grade().
NEXTEST_SUMMARY_RE = re.compile(r"^\s*Summary\s*\(\s*[\d,]+\s+tests?\s+run", re.MULTILINE)

# libtest's per-test failure line, captured by group so the report can NAME the
# failing test rather than only counting it.
FAILED_TEST_RE = re.compile(r"^\s*test\s+(\S+)\s+\.\.\.\s+FAILED\s*$", re.MULTILINE)


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


def is_comment_line(line: str) -> bool:
    s = line.lstrip()
    return s.startswith("//") or s.startswith("/*") or s.startswith("*")


def counts_as_arm(lines: list[str], i: int) -> bool:
    """The single arm predicate, shared by the tree walk and the self-test.

    Shared on purpose: `arm_abandons` already has a docstring promising one
    implementation so a fixture cannot drift from the scan, and the comment rule
    was about to be added to only one of the two call sites -- which would have
    made the fixture prove something the census does not do.
    """
    line = lines[i]
    if not ARM_RE.search(line) or is_comment_line(line):
        return False
    return arm_abandons(lines, i)


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
            for i in range(len(lines)):
                # Comment exclusion lives inside counts_as_arm, shared with the
                # self-test's fixture helper so the two cannot drift. Measured
                # 2026-09-15: 0 of the 64 counted arms sit on a comment line, so
                # the rule changes today's number by nothing -- it removes a way
                # the number could be inflated later without anyone noticing.
                if counts_as_arm(lines, i):
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


def run_cargo(crates: list[str], serialize: bool = False) -> tuple[int, str]:
    chunks: list[str] = []
    rc = 0
    for krate in crates:
        # `--all-features` because CI's own command is
        # `cargo nextest run --workspace --all-features` (dev-ci.yml:244). Without
        # it, a test module sitting behind a feature gate never compiles, so this
        # runner would report fewer cases than the environment it is being compared
        # to -- the same under-read, arriving from the opposite direction.
        cmd = ["cargo", "test", "-p", krate, "--all-features", "--", "--nocapture"]
        if serialize:
            # See the harness note in main(): one base-DB-writing test in
            # apps/cloud-server skips under the default parallel harness on every
            # run and never under this one, so "0 events" means different things
            # depending on which was used, and the flag has to be declared, not
            # inferred from context.
            cmd.append("--test-threads=1")
        print(f"$ {' '.join(cmd)}", file=sys.stderr)
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        chunks.append(proc.stdout or "")
        chunks.append(proc.stderr or "")
        if proc.returncode != 0:
            rc = proc.returncode
    return rc, "\n".join(chunks)


def source_findings(arms: int, per_file: dict[str, int]) -> list[str]:
    """The SOURCE channel's guards, as a function so both directions are plantable.

    Three checks, deliberately of different kinds -- a magnitude floor and a
    membership check are not substitutes for each other (see ARM_FLOOR's note):
      1. total arms below the floor  -> parser drift or a mass message rewrite;
      2. a crate that owns arms today contributing none -> a whole-crate loss;
      3. census exactly zero         -> the vacuity case that makes LOG meaningless.
    Returns [] when the census is healthy.
    """
    notes: list[str] = []

    if arms == 0:
        notes.append(
            "SOURCE: zero skip arms found in the tree. The LOG channel is now\n"
            "      vacuous: either the arms were genuinely converted to a mechanism\n"
            "      that reports a number, or the eprintln! lines were deleted while\n"
            "      the `return` stayed. Re-read this file's shape rules before\n"
            "      believing any green it prints."
        )
        return notes

    if arms < ARM_FLOOR:
        notes.append(
            f"SOURCE: {arms} arms is below the floor of {ARM_FLOOR} (baseline\n"
            f"      {ARM_BASELINE} measured 2026-09-15 across 12 files in 3 crates).\n"
            "      A silent shrink is the failure this floor exists for: if the\n"
            "      messages were reworded, or a shape rule narrowed, the census\n"
            "      drops and a green still prints. Diff\n"
            "      `--census-only` against the table in todo-open-debt-program.md\n"
            "      Phase 5 before proceeding."
        )

    for crate in ARM_CRATES:
        if not any(rel.startswith(crate + "/") for rel in per_file):
            notes.append(
                f"SOURCE: no arms counted anywhere under `{crate}/`, though it owns\n"
                "      arms at baseline. A magnitude floor can pass while one crate\n"
                "      goes wholly uncounted -- that is the membership case, and it\n"
                "      is what 'fixed in one crate, the rest left behind' looks like\n"
                "      from the census side."
            )
    return notes


def grade(text: str, arms: int, per_file: dict[str, int], *, proven: bool,
          harness: str = "parallel (default harness)") -> int:
    report = parse_log(text)
    ok = True
    print(f"      harness: {harness}")

    findings = source_findings(arms, per_file)
    if findings:
        for note in findings:
            print("FAIL  " + note)
        ok = False
    else:
        print(f"ok    SOURCE: {arms} skip arms across {len(per_file)} test files in "
              f"{len({r.split('/')[0] + '/' + r.split('/')[1] for r in per_file})} crates"
              f" -- TREE-WIDE census, not the selected crate's (floor {ARM_FLOOR},"
              f" baseline {ARM_BASELINE})")

    if not report["passed"] and not report["failed"]:
        print("FAIL  LOG: no `test result:` summary line found.")
        if NEXTEST_SUMMARY_RE.search(text):
            # Diagnosed, not guessed: CI's own command is `cargo nextest run
            # --workspace --all-features` (dev-ci.yml:244), so a lane grabbing the
            # nearest green will hand this tool a nextest log. It must not be read
            # as libtest output, and the two are NOT interchangeable in meaning:
            # nextest's "N skipped" counts tests it deliberately did not run
            # (filters, `#[ignore]`), whereas this tool's skip EVENT is a test that
            # DID run, printed, and returned as a pass. Reparsing one as the other
            # would manufacture exactly the false clean this file exists to refuse.
            print("      This looks like `cargo nextest` output (a `Summary (N tests")
            print("      run: …)` line). The two formats are not interchangeable:")
            print("      nextest's `skipped` counts tests deliberately NOT run, while")
            print("      the skip EVENT counted here is a test that ran, printed, and")
            print("      returned as a pass. Grading nextest output would need its own")
            print("      parser and its own semantics -- not a relabel of this one.")
            print("      Re-capture with `cargo test -p <crate> --all-features -- --nocapture`.")
        else:
            print("      A run with no summary proves nothing; if you piped a log,")
            print("      check it is a cargo-test capture and not a build log.")
        return 1

    print(
        f"      RUN: {report['passed']} passed; {report['failed']} failed; "
        f"{report['ignored']} ignored"
    )

    if report["failed"]:
        print(f"FAIL  LOG: {report['failed']} failed test(s) -- real failures, fix those first.")
        # Name them. Without this the report said "1 failed" and stopped, which is
        # strictly worse than `cargo test` itself: the guard captures cargo's stdout
        # in memory, so the raw output -- and the failing names, and the panic text
        # -- was discarded unless the caller passed --emit-log. Discovered by real
        # use on 2026-09-15, when a container that had just come up turned a masked
        # skip into a genuine failure this tool could report the COUNT of and not the
        # IDENTITY of.
        named = FAILED_TEST_RE.findall(text)
        for name in named:
            print(f"        FAILED  {name}")
        if not named:
            print("        (cargo reported failures but no `... FAILED` line was found")
            print("         in the captured output -- re-run with --emit-log to keep it.)")
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
        if harness.startswith("serialized"):
            # The honest cost of the flag that makes this reachable: a serialized
            # run proves the cases ran, but proves nothing about behaviour under
            # the harness CI and `check.sh` actually use, which is the one that
            # reproduces the base-DB contention. Say it in the PASS, not after it.
            print("      note: this is a SERIALIZED run. It proves every case executed;")
            print("      it cannot show whether they interfere under the default")
            print("      parallel harness, which is what CI and scripts/check.sh use.")
        elif harness.startswith("parallel"):
            print("      note: parallel run -- a zero here is the strong result, since")
            print("      it means no case lost the base-DB contention.")

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


# ── The nextest channel: JUnit XML, because the retry signal is not in stdout ──
#
# grade() refuses a nextest stdout log, and that refusal was the whole truth only
# until this section existed. A test rescued on its second attempt prints no
# `skipped:` line, so neither the SOURCE census nor the LOG channel above can see
# it; nextest's own summary does say `2 tests run: 2 passed (1 flaky)`, but that
# string belongs to a runner whose shape these libtest regexes deliberately do not
# parse. The signal is in the JUnit report instead.
#
# Everything in this section was measured against a scratch crate built for the
# purpose -- one test that panics on attempt 1 and passes on attempt 2, `retries =
# 1` -- because the alternative was reasoning from the schema's documentation,
# which is how this file got the numbers it later retracted. The run printed
# `TRY 1 FAIL`, `TRY 2 PASS`, `Summary ... 2 passed (1 flaky)`, exit 0, and wrote
# a report whose relevant lines were:
#
#   <testsuites tests="2" failures="0" errors="0">            <-- zero
#     <testsuite tests="2" failures="0" errors="0">           <-- zero
#       <testcase name="flaky_on_first_attempt">
#         <flakyFailure message="... panicked at src\lib.rs:8:9">   <-- the only copy
#
# So both aggregate attributes AND the conventional <failure> element report a
# clean run for a test that failed and was then talked into passing. A consumer
# written against the JUnit shape everyone knows -- count <failure>, read
# testsuites@@failures -- reads a rescued flake as green. Same shape as the rest of
# this file: the evidence exists, in an element nobody is looking at, under a name
# that sounds like the thing you asked for.
#
# Path resolution, also measured: `path` is relative to the profile's artifact
# directory, so `[profile.default] path = "junit.xml"` wrote
# target/nextest/default/junit.xml in the probe. That is why the repo's
# `.config/nextest.toml:21`-`:22` -- which says `target/nextest/ci/junit.xml`,
# under a comment reading "JUnit XML output for CI reporting" -- actually writes
# target/nextest/default/target/nextest/ci/junit.xml, and why the only file that
# ever referenced the undoubled path is `.github/workflows/ci.yml.bak:433`, a
# retired workflow GitHub does not execute.
FLAKY_JUNIT = """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="2" failures="0" errors="0">
  <testsuite name="flake_probe" tests="2" disabled="0" errors="0" failures="0">
    <testcase name="always_passes" classname="flake_probe" time="0.024">
    </testcase>
    <testcase name="flaky_on_first_attempt" classname="flake_probe" time="0.015">
      <flakyFailure timestamp="2026-09-16T10:39:46.988+07:00" time="0.031" message="thread 'flaky_on_first_attempt' (23816) panicked at src\\lib.rs:8:9" type="test failure with exit code 101">
        <system-out>test result: FAILED. 0 passed; 1 failed</system-out>
      </flakyFailure>
    </testcase>
  </testsuite>
</testsuites>
"""

CLEAN_JUNIT = """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="2" failures="0" errors="0">
  <testsuite name="flake_probe" tests="2" disabled="0" errors="0" failures="0">
    <testcase name="always_passes" classname="flake_probe" time="0.024">
    </testcase>
    <testcase name="second_test" classname="flake_probe" time="0.011">
    </testcase>
  </testsuite>
</testsuites>
"""

HARDFAIL_JUNIT = """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="nextest-run" tests="2" failures="1" errors="0">
  <testsuite name="flake_probe" tests="2" disabled="0" errors="0" failures="1">
    <testcase name="always_passes" classname="flake_probe" time="0.024">
    </testcase>
    <testcase name="pg_tenant_isolation" classname="flake_probe" time="0.011">
      <failure message="deadlock detected" type="test failure with exit code 101">
      </failure>
    </testcase>
  </testsuite>
</testsuites>
"""


def parse_junit(xml_text: str) -> dict:
    """Split a nextest JUnit report into what it records and where it hides it."""
    root = ET.fromstring(xml_text)
    rep = {
        "cases": 0, "flaky": [], "failed": [], "skipped": 0,
        "attrs": {k: root.get(k, "?") for k in ("tests", "failures", "errors")},
    }
    for tc in root.iter("testcase"):
        rep["cases"] += 1
        cls, name = tc.get("classname") or "", tc.get("name") or "?"
        label = f"{cls}::{name}" if cls else name
        for key, tag in (("flaky", "flakyFailure"), ("failed", "failure")):
            for node in tc.findall(tag):
                msg = re.sub(r"\s+", " ", (node.get("message") or "").strip())[:150]
                rep[key].append((label, msg))
        rep["skipped"] += len(tc.findall("skipped"))
    return rep


def grade_junit(xml_text: str, *, source: str) -> int:
    """Grade a nextest JUnit report. Returns a process exit code."""
    try:
        rep = parse_junit(xml_text)
    except ET.ParseError as exc:
        print(f"FAIL  JUNIT: {source} is not well-formed XML ({exc}).")
        print("        Refusing to read a report I cannot parse: a truncated XML file")
        print("        is precisely how a green gets invented out of an aborted red run.")
        return 1

    print(f"ok    JUNIT: parsed {rep['cases']} <testcase> element(s) from {source}")
    a = rep["attrs"]
    print(f"      the report's own totals: tests={a['tests']} failures={a['failures']}"
          f" errors={a['errors']}  (these count rescued flakes as passes)")

    ok = True
    if rep["failed"]:
        print(f"FAIL  JUNIT: {len(rep['failed'])} hard failure(s) -- every attempt failed:")
        for label, msg in rep["failed"]:
            print(f"        {label}" + (f"  {msg}" if msg else ""))
        ok = False

    if rep["flaky"]:
        # The reason this function exists. None of these appear in `failures` above,
        # none of them carry a <failure> element, and none of them failed the run.
        print(f"FAIL  JUNIT: {len(rep['flaky'])} test(s) failed and were then rescued by a"
              " retry. nextest calls these `flaky`; the report totals and the <failure>"
              " element both count them as passes:")
        for label, msg in rep["flaky"]:
            print(f"        {label}" + (f"  {msg}" if msg else ""))
        ok = False

    if ok:
        print("ok    JUNIT: no <flakyFailure> and no <failure> in this report.")
        # The boundary of that sentence. A rescued flake with retries on lands in
        # <flakyFailure>; the same failure with retries off lands in <failure>. Both
        # are counted above, so the residual gap is not the retry budget at all --
        # it is the population the report covers.
        print("      Caveat: a report records one run of whatever population nextest"
              " reached before it stopped. `[profile.default] fail-fast = { max-fail = 1 }`"
              " (.config/nextest.toml:12) aborts after the first hard failure, so a small"
              " `tests=` count is not evidence the suite is small, and this PASS says"
              " nothing about any case that never ran.")
    print()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


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
    def arms_in(src: str) -> int:
        # Uses counts_as_arm, the same predicate the tree walk runs, so a fixture
        # can never prove a rule the census does not actually apply.
        lines = src.splitlines()
        return sum(1 for i in range(len(lines)) if counts_as_arm(lines, i))

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
           arms_in(panic_arm) == 1)

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
           arms_in(neighbour_arm) == 0)

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
           arms_in(helper_none) == 1)

    # (3c) comment exclusion, both directions. The over-count this prevents is
    #      real: a lane commenting out a PG arm while debugging would ADD to a
    #      census that is supposed to measure live silent-pass sites.
    commented = (
        'fn t() {\n'
        '    // let Some(p) = pool().await else {\n'
        '    //     eprintln!("PG integration test skipped: no db");\n'
        '    //     return;\n'
        '    // };\n'
        '}\n'
    )
    expect("a commented-out arm is NOT counted", arms_in(commented) == 0)

    blocked = (
        'fn t() {\n'
        '    /*\n'
        '     * eprintln!("PG integration test skipped");\n'
        '     * return;\n'
        '     */\n'
        '}\n'
    )
    expect("an arm inside a /* */ block is NOT counted", arms_in(blocked) == 0)

    url_string = (
        'fn t() {\n'
        '    match connect() {\n'
        '        Err(e) => {\n'
        '            eprintln!("PG test skipped: see http://example.test/x");\n'
        '            return;\n'
        '        }\n'
        '    }\n'
        '}\n'
    )
    expect("a // INSIDE the message string does not suppress a real arm",
           arms_in(url_string) == 1)

    # (3d) the baseline is asserted, not merely printed. When the tree legitimately
    #      changes -- the `slow-tests` migration Phase 5 files, for instance, which
    #      deletes these eprintln arms -- this case goes red and forces ARM_BASELINE
    #      and ARM_FLOOR to be moved deliberately, in the same commit as the edit,
    #      rather than leaving a stale floor silently firing or silently stale.
    expect(f"tree census still equals the stated baseline ({ARM_BASELINE})",
           arms == ARM_BASELINE)

    # (4) the SOURCE channel's own guards. A guard whose floor cannot fire is
    #     itself decoration, so each is planted in both directions using the real
    #     census as the "healthy" side.
    expect("real census yields no SOURCE findings (floor + membership both satisfied)",
           source_findings(arms, per_file) == [])
    expect("a census below the floor FIRES (a silent shrink cannot read green)",
           any("below the floor" in n for n in source_findings(40, per_file)))
    expect("a census at the floor does NOT fire (headroom, not equality)",
           source_findings(ARM_FLOOR, per_file) == []
           or not any("below the floor" in n for n in source_findings(ARM_FLOOR, per_file)))

    # Membership: keep the total healthy but delete one whole crate's rows.
    two_crates = {k: v for k, v in per_file.items() if not k.startswith("platform/sync")}
    reduced = sum(two_crates.values())
    mfst = source_findings(reduced, two_crates)
    floor_notes = [n for n in mfst if "below the floor" in n]
    member_notes = [n for n in mfst if "no arms counted anywhere under" in n.lower()]
    # The same shape as the plant AGENTS.md records for popupBackgroundCompliance:
    # "all four magnitude floors passed and only the identity check fired". Here,
    # dropping platform/sync's 4 arms leaves 60 counted, which is above the floor
    # of 55 -- so size reads healthy and only membership can see the loss.
    expect("dropping a whole crate keeps the TOTAL above the floor (size is blind to it)",
           reduced >= ARM_FLOOR and floor_notes == [])
    expect("membership fires on exactly that crate, once",
           len(member_notes) == 1 and "platform/sync" in member_notes[0])

    # A planted fake path must not satisfy membership (the rule is prefix-matched,
    # so an unrelated tree cannot silently stand in for a missing crate).
    fake = {f"vendor/thing/{c}_tests.rs": 20 for c in ("a", "b", "c")}
    expect("a fake tree cannot satisfy the crate membership rule",
           len(source_findings(60, fake)) == len(ARM_CRATES))

    # (5) grade() must fail on a zero census even with a clean log -- the
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

    # (6) a nextest log must be diagnosed as nextest, and a mere empty log must
    #     NOT be -- the two share the property "no libtest summary line", and
    #     conflating them would send someone to re-run a capture that was fine.
    nextest_log = (
        "    SYNC apps/cloud-server::sync_store::tests pg_integration_one ... PASSED\n"
        "   Summary (4313 tests run: 4270 passed, 43 skipped)\n"
    )
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_nextest = grade(nextest_log, arms, per_file, proven=True)
    out = buf.getvalue()
    expect("a nextest log fails AND is named as nextest",
           rc_nextest == 1 and "nextest" in out)
    expect("  ...and explains that nextest `skipped` is not this tool's skip EVENT",
           "deliberately NOT run" in out)

    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_empty = grade("Compiling oz-cloud-server v0.0.39\n", arms, per_file, proven=True)
    out = buf.getvalue()
    expect("an empty/build-only log fails", rc_empty == 1)
    expect("  ...without falsely blaming nextest", "nextest" not in out)

    # (7) a real failure must be NAMED, not only counted. The guard captures cargo's
    #     stdout in memory, so without this it reported "1 failed" and threw away the
    #     identity of the failure -- worse than plain `cargo test`.
    failed_log = (
        "test a::pg_integration_one ... ok\n"
        "test b::tenant_isolation ... FAILED\n"
        "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out\n"
    )
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_failed = grade(failed_log, arms, per_file, proven=True)
    out = buf.getvalue()
    expect("a failing run is graded FAIL", rc_failed == 1)
    expect("  ...and the failing test is named, not merely counted",
           "b::tenant_isolation" in out and "FAILED  b::tenant_isolation" in out)
    expect("  ...and a skip count is reported alongside it",
        "1 failed" in out)

    # (8) harness provenance: a serialized zero must not read like a parallel zero.
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_ser = grade(CLEAN_LOG, arms, per_file, proven=True,
                       harness="serialized (--test-threads=1)")
    out = buf.getvalue()
    expect("a serialized clean run still PASSes", rc_ser == 0)
    expect("  ...and says so, rather than passing as the stronger parallel result",
           "SERIALIZED" in out and "harness: serialized" in out)

    buf = io.StringIO()
    with redirect_stdout(buf):
        grade(CLEAN_LOG, arms, per_file, proven=True)
    expect("the default harness is named too, never left implicit",
           "harness: parallel" in buf.getvalue())

    # (9) the nextest JUnit channel, both directions. Fixtures are transcribed from
    #     the scratch-crate run described above, not from the schema's docs.
    rep_flaky = parse_junit(FLAKY_JUNIT)
    expect("the flake is in <flakyFailure> and in NOTHING else",
           len(rep_flaky["flaky"]) == 1 and len(rep_flaky["failed"]) == 0)
    expect("  ...which is why reading the aggregate attribute would invent a green",
           rep_flaky["attrs"]["failures"] == "0")
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_flaky = grade_junit(FLAKY_JUNIT, source="<fixture>")
    out = buf.getvalue()
    expect("a rescued flake is graded FAIL, not pass", rc_flaky == 1)
    expect("  ...and the rescued test is named", "flaky_on_first_attempt" in out)
    expect("  ...and the contradicting totals are printed, not hidden",
           "failures=0" in out)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_jclean = grade_junit(CLEAN_JUNIT, source="<fixture>")
    out = buf.getvalue()
    expect("a report with nothing rescued PASSes", rc_jclean == 0)
    expect("  ...and PASSes out loud about how narrow that is",
           "no <flakyFailure>" in out and "fail-fast" in out)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_jfail = grade_junit(HARDFAIL_JUNIT, source="<fixture>")
    expect("a real <failure> is FAIL, and is not confused with a flake", rc_jfail == 1)
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc_jbad = grade_junit("<testsuites><not closed", source="<fixture>")
    expect("a truncated XML report is refused rather than read as clean", rc_jbad == 1)

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
    ap.add_argument("--emit-log", type=Path,
                    help="write the raw combined cargo output here (the guard captures it "
                         "in memory, so without this a real failure's panic text is discarded)")
    ap.add_argument("--serialize", action="store_true",
                    help="run with --test-threads=1; one cloud-server base-DB test skips "
                         "under the default parallel harness on every run, so a zero-event "
                         "result is only meaningful once the harness that produced it is named")
    ap.add_argument("--nextest-junit", type=Path, metavar="PATH",
                    help="grade a nextest JUnit report instead of a cargo-test log. This is"
                         " the only channel on which a retry-rescued flake exists at all:"
                         " <flakyFailure> carries it, while the testsuites `failures=`"
                         " attribute, the testsuite attribute and the conventional"
                         " <failure> element all record the test as passed")
    ap.add_argument("--self-test", action="store_true", help="prove both directions failable")
    ns = ap.parse_args(argv)

    if ns.self_test:
        return self_test()

    if ns.nextest_junit:
        if ns.log:
            print("note  --nextest-junit takes precedence; --log was ignored")
        return grade_junit(ns.nextest_junit.read_text(encoding="utf-8", errors="replace"),
                           source=str(ns.nextest_junit))

    arms, per_file = count_source_arms()
    if ns.census_only:
        for rel, n in sorted(per_file.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"{n:3d}  {rel}")
        print(f"{arms:3d}  TOTAL skip arms across {len(per_file)} test files")
        return 0

    if ns.log:
        text = ns.log.read_text(encoding="utf-8", errors="replace")
        harness = "unknown (log supplied with --log; the harness that made it is not visible here)"
        # The flag's own text only counts if whoever captured the log echoed the
        # command; it is a hint, so it is reported, never silently trusted.
        echoed = "--nocapture" in text
        proven = ns.assume_nocapture or echoed
        if echoed and not ns.assume_nocapture:
            print("note  the string `--nocapture` appears in the log; treating the run"
                  " as proven. If that is the wrong read, this result is meaningless.")
    else:
        # Made here, with the flag, so absence of skips is evidence of absence.
        _, text = run_cargo(ns.crates or CRATES, serialize=ns.serialize)
        proven = True
        harness = ("serialized (--test-threads=1)" if ns.serialize
                   else "parallel (default harness)")

    if ns.emit_log:
        ns.emit_log.write_text(text, encoding="utf-8")
        print(f"note  raw cargo output written to {ns.emit_log}")

    return grade(text, arms, per_file, proven=proven, harness=harness)


if __name__ == "__main__":
    sys.exit(main())
