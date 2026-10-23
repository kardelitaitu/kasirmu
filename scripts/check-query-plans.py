#!/usr/bin/env python3
"""Run the query-plan regression probe (QP-01) and grade the plans it produces.

WHY THIS EXISTS
---------------
The debt ledger proved unreliable: entries described already-done work, named the
wrong files, or described defects that never existed. The productive replacement is
collecting debt from the CODE. The last real performance defect in this project --
every revenue report reading the whole `refunds` table -- was found BY HAND with
EXPLAIN QUERY PLAN. This script is that pass, made repeatable.

HOW IT WORKS
------------
The assertions live in Rust, not here:

    crates/kasirmu-core/tests/integration/query_plan_probe.rs

`cargo test -p kasirmu-core --test integration query_plan_probe` seeds 400 rows into
every LARGE table, ANALYZEs, runs EXPLAIN QUERY PLAN over a curated list of the
high-traffic production queries, and asserts none of them reads a large table in
full. A CRASH from these assertions IS the finding, so a nonzero cargo exit is
reported as plain ASCII with the offending plan quoted, never as a Rust panic
backtrace full of ANSI noise.

This script therefore does the part Rust cannot: it runs the probe, extracts the
offending plans into an ASCII report, and returns a clear exit code for CI.

WHY THE ASSERTION IS BELIEVABLE
-------------------------------
`forcing_a_scan_fails_the_probe` is part of the suite. It takes the daily revenue
report's SQL, strips every WHERE predicate (the shape that scans) and REQUIRES the
same detector the gate uses to report the table. With --check this script re-runs
that falsification first: a probe that cannot fail is worthless, and that exact
mistake has been made three times already in this project.

EXIT CODES
    0  every probed query SEARCHes an index; nothing is read in full
    1  at least one probed query reads a LARGE table in full (a real defect)
    2  the probe could not run (build error, or the falsification went deaf)

Usage, from the repo root:

    python scripts/check-query-plans.py           # run the probe, print the report
    python scripts/check-query-plans.py --check   # same, plus the falsification gate
    python scripts/check-query-plans.py --list    # list the covered queries and exit
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROBE_FILE = REPO / "crates" / "kasirmu-core" / "tests" / "integration" / "query_plan_probe.rs"
PROBE_CRATE = "kasirmu-core"
PROBE_TEST_BIN = "integration"
PROBE_TEST_FILTER = "query_plan_probe"

# The probe above prepares KNOWN strings, so it is structurally blind to a query
# whose WHERE clause is assembled at run time. Those are graded by sibling unit
# tests inside the crate instead (`db/*_dynamic_where_tests.rs`), which can reach
# the private builders. O-M69 lived on exactly that boundary -- the last defect of
# this class was invisible to the integration probe -- so the gate runs BOTH tiers.
# Leaving the unit tier out would mean the newest coverage never runs in CI.
UNIT_TEST_FILTER = "dynamic_where"
UNIT_TEST_THREADS = "2"
FALSIFICATION_TEST = "forcing_a_scan_fails_the_probe"

# The LARGE tables the probe grades, read from the probe file itself so this
# script and the Rust gate can never disagree about what "large" means.
LARGE_TABLES_BLOCK = re.compile(r"const LARGE_TABLES: &\[&str\] = &\[(.*?)\];", re.S)
TABLE_LITERAL = re.compile(r'"([a-z_]+)"')

# One entry of the curated list in the probe file:
#   Probe { name: "...", origin: "file:line ...", sql: X, binds: &[...], ... }
PROBE_ENTRY = re.compile(r"name:\s*\"(?P<name>[^\"]+)\",\s*\n\s*origin:\s*\"(?P<origin>[^\"]+)\"", re.M)

# The gate's own failure text, which is the report this script prints.
OFFENDER_HEADER = re.compile(r"^(?P<name>.+?) \((?P<origin>.+)\)$")


def probe_source() -> str:
    """The probe file's text, or an empty string when it is missing."""
    try:
        return PROBE_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def large_tables(source: str) -> list[str]:
    """The LARGE tables declared by the probe, in declaration order."""
    match = LARGE_TABLES_BLOCK.search(source)
    if not match:
        return []
    return TABLE_LITERAL.findall(match.group(1))


def covered_probes(source: str) -> list[tuple[str, str]]:
    """(name, origin) for every query the probe checks, in the file's order."""
    return [(m.group("name"), m.group("origin")) for m in PROBE_ENTRY.finditer(source)]


def build_env() -> dict[str, str]:
    """The environment the probe needs on this machine.

    Kept explicit rather than inherited: debuginfo is off to keep the build light,
    and TEMP/TMP are pinned under target/ so a long build cannot fill the system
    drive. Anything already set by the caller wins, so CI can override.
    """
    env = dict(os.environ)
    env.setdefault("RUSTFLAGS", "-C debuginfo=0")
    env.setdefault("CARGO_PROFILE_DEV_DEBUG", "0")
    env.setdefault("CARGO_INCREMENTAL", "0")
    temp = REPO / "target" / "mstmp"
    if temp.is_dir():
        env.setdefault("TEMP", str(temp))
        env.setdefault("TMP", str(temp))
    return env


def run_probe(extra_args: list[str], label: str) -> tuple[int, str]:
    """Run the probe test and return (exit code, combined output as ASCII)."""
    cmd = [
        "cargo",
        "test",
        "-p",
        PROBE_CRATE,
        "--test",
        PROBE_TEST_BIN,
        PROBE_TEST_FILTER,
        "--",
        "--test-threads=2",
        *extra_args,
    ]
    print("check-query-plans: " + label)
    print("  " + " ".join(cmd))
    proc = subprocess.run(
        cmd,
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=build_env(),
    )
    return proc.returncode, ascii_only(proc.stdout + proc.stderr)


ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

def run_unit_plan_gate(extra_args: list[str], label: str) -> tuple[int, str]:
    """Run the run-time-WHERE plan tests and return (exit code, output as ASCII)."""
    cmd = [
        "cargo",
        "test",
        "-p",
        PROBE_CRATE,
        "--lib",
        UNIT_TEST_FILTER,
        "--",
        f"--test-threads={UNIT_TEST_THREADS}",
        *extra_args,
        "--nocapture",
    ]
    print("check-query-plans: " + label)
    print("  " + " ".join(cmd))
    proc = subprocess.run(
        cmd,
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=build_env(),
    )
    return proc.returncode, ascii_only(proc.stdout + proc.stderr)


def ascii_only(text: str) -> str:
    """Strip ANSI colour and force ASCII, so the report survives any console."""
    return ANSI.sub("", text).encode("ascii", "replace").decode("ascii")


# The line the gate writes directly under every offender header.
VERDICT_PREFIX = "reads in full:"

# cargo's own status lines: "<Verb> <crate> v<version> (<path>)".
DEFINITION_LINE = re.compile(r"^[A-Z][a-z]+ \S+ v\d")

HARNESS_LINE_MARKERS = (
    "Running tests",
    "Finished",
    "error: test failed",
    "warning:",
    "test result: FAILED",
    "note: run with",
)


def is_harness_line(line: str) -> bool:
    """True for a cargo/rust harness line, which never belongs to a defect block.

    A defect block is the gate's own text: the query, the table it reads in
    full, and the plan. Everything else in the captured output -- the binary
    the harness ran, the result footer, a warning -- is noise a reader has to
    strip out by eye, so it is stripped here.
    """
    return (
        line.startswith("thread '")
        or line.startswith("----")
        or line.startswith("failures:")
        or any(line.startswith(marker) for marker in HARNESS_LINE_MARKERS)
        or "\\integration\\" in line
        or "/integration/" in line
    )


def offender_blocks(output: str) -> list[str]:
    """The per-query defect blocks from the gate's panic message.

    The gate formats each offender as

        <name> (<origin>)
          reads in full: <table> (<step>), ...
          plan:
            <plan step>

    and emits them after its one-line summary. Everything before the first block
    is Rust harness noise, so it is dropped: a reader wants the query, the table
    and the plan, not a backtrace.
    """
    lines = output.splitlines()
    blocks: list[str] = []
    current: list[str] | None = None
    for index, raw in enumerate(lines):
        line = raw.rstrip()
        # `<name> (<file>:<line> ...)` is the shape of a block header - and also
        # of cargo's own output ("Compiling kasirmu-core v0.0.41 (C:...)"), which
        # is indented exactly like the gate's message. What separates the two is
        # the LINE AFTER the header: the gate always follows its header with
        # "reads in full:". Measured; without it the report gained two phantom
        # defects per run ("Compiling ...", "Running tests ...").
        followed_by_verdict = index + 1 < len(lines) and lines[index + 1].strip().startswith(
            VERDICT_PREFIX
        )
        if OFFENDER_HEADER.match(line.strip()) and followed_by_verdict:
            if current:
                blocks.append(clean_block(current))
            current = [line.strip()]
            continue
        if current is None:
            continue
        stripped = line.strip()
        # The report a reader wants ends at the first harness line after the
        # plan. Everything before that belongs to the block.
        if is_harness_line(stripped):
            blocks.append(clean_block(current))
            current = None
            continue
        # A defect block is written as a header line followed by INDENTED body
        # lines ("reads in full:", "plan:", then the plan steps). A flush-left
        # line is the harness talking, and so is cargo's `def `= `value``
        # chatter ("Compiling kasirmu-core v0.0.41 (C:...)") - which is indented
        # too, so indentation alone does not separate the two.
        is_body_line = line[:1].isspace() and stripped and not DEFINITION_LINE.match(stripped)
        if not is_body_line:
            blocks.append(clean_block(current))
            current = None
            continue
        if stripped:
            current.append(stripped)
    if current:
        blocks.append(clean_block(current))
    return [b for b in blocks if b]


def clean_block(lines: list[str]) -> str:
    """Join one offender block, trimming its trailing blank rows."""
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def count_probed(output: str) -> str | None:
    """The gate's "N of M probed queries" summary line, when it failed."""
    match = re.search(r"(\d+) of (\d+) probed queries[^\n]*", output)
    return match.group(0).strip() if match else None


def report_list(source: str) -> int:
    """Print the covered queries, the LARGE tables, and what is NOT covered."""
    probes = covered_probes(source)
    tables = large_tables(source)
    print("check-query-plans: " + str(len(probes)) + " probed queries")
    constants = 0
    copied = 0
    for name, origin in probes:
        kind = "CONSTANT" if "CONSTANT" in origin else "copied"
        if kind == "CONSTANT":
            constants += 1
        else:
            copied += 1
        print("  [" + kind + "] " + name)
        print("      " + origin)
    print("")
    print("LARGE tables graded (a full read of any of these fails):")
    print("  " + ", ".join(tables))
    print("")
    print("Sources: " + str(constants) + " constant, " + str(copied) + " copied.")
    print("A COPIED query must be kept in sync with its origin by hand; the probe's")
    print("copied_query_provenance_is_intact test fails if an origin stops resolving.")
    print("")
    print("NOT covered: every other query in crates/kasirmu-core/src/db -- the")
    print("dynamic WHERE builders, the popularity aggregates, payments readers and")
    print("every writer. This is a gate over a curated list, not a census.")
    return 0


def self_test() -> int:
    """Liveness for the report formatters, which are what a reader actually sees.

    This gate had NO test of any kind (found 2026-10-23 by a census requiring the
    quoted `--self-test` literal: three checkers lacked the flag, one of them here).
    The assertions live in Rust, so the plan DETECTOR is covered by the probe's own
    falsification test -- but everything between the probe's output and the bytes on
    the console is Python, and it is where this file records three measured defects:
    ANSI noise, phantom blocks from cargo's own "Compiling ..." lines, and a plan body
    that has to stop at the harness footer. Those are graded here on synthetic text,
    so the case can construct the exact shape that used to be misread.

    Pure: synthetic strings only. Nothing is built, run, read or written.
    """
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # ANSI colour is stripped, and anything non-ASCII becomes "?" rather than a
    # UnicodeEncodeError on a CP1252 console -- the reason this function exists.
    want("ANSI colour is stripped", ascii_only("\x1b[31mred\x1b[0m"), "red")
    want("non-ascii becomes a replacement", ascii_only("caf\u00e9"), "caf?")

    # cargo's status lines are noise. DEFINITION_LINE is what separates an indented
    # cargo line from an indented plan step, so a plan step naming a version must count
    # as a body line while "Compiling kr v0.0.41 (C:...)" must not.
    want("a cargo status line is a definition", bool(DEFINITION_LINE.match("Compiling kasirmu-core v0.0.41 (C:)")), True)
    want("a plan step is not a definition", bool(DEFINITION_LINE.match("SCAN TABLE refunds")), False)
    want("the result footer is harness", is_harness_line("test result: FAILED. 0 passed"), True)
    want("the binary line is harness",
         is_harness_line("     Running " + "tests" + "\\" + "integration" + "\\" + "q.rs"), True)
    want("a plan step is not harness", is_harness_line("SCAN TABLE sales"), False)

    # THE PHANTOM-BLOCK BUG. A block header is only a defect when the NEXT line is the
    # verdict; without that rule the report gained two phantom defects per run
    # ("Compiling ...", "Running tests ..."), both indented like the gate's message.
    noisy = "\n".join([
        "     Running tests/integration.rs (target/debug/deps/integration.exe)",
        "daily_revenue (crates/kasirmu-core/tests/integration/query_plan_probe.rs:1)",
        "  reads in full: refunds (SCAN), sales (SCAN)",
        "  plan:",
        "    SCAN TABLE refunds",
        "test result: FAILED. 0 passed; 1 failed",
    ])
    # Grade the CONTENT, not len(): a gutted offender_blocks() answers None, and
    # len(None) kills the run with TypeError instead of naming the broken case.
    blocks = offender_blocks(noisy) or []
    want("exactly one defect block survives the noise", len(blocks), 1)
    want("the block names the query", "daily_revenue" in (blocks[0] if blocks else ""), True)
    want("the block keeps the verdict", "reads in full: refunds" in (blocks[0] if blocks else ""), True)
    want("the block keeps the plan step", "SCAN TABLE refunds" in (blocks[0] if blocks else ""), True)
    want("the harness footer is not in the block",
         "test result" in (blocks[0] if blocks else ""), False)

    # A header NOT followed by a verdict is cargo talking, and must produce nothing.
    cargo_only = "Compiling kasirmu-core v0.0.41 (C:\\dev\\kasirmu)"
    want("a header without a verdict is not a defect", offender_blocks(cargo_only), [])

    # The summary line is the only place the gate says how much it looked at.
    want("the summary is extracted",
         count_probed("thread panicked\n3 of 12 probed queries read a LARGE table in full"),
         "3 of 12 probed queries read a LARGE table in full")
    want("no summary is None, not a guess", count_probed("nothing to see"), None)

    # THE TWO PROBE PARSERS, which no case reached before 2026-10-24. Both are pure
    # regex reads of the Rust probe source, and both are load-bearing in the quiet
    # direction: large_tables() returning [] or covered_probes() returning [] makes the
    # gate report a smaller surface than exists, which is the anti-zero shape.
    want("large_tables reads the declared block",
         large_tables('const LARGE_TABLES: &[&str] = &["sales", "refunds"];'), ["sales", "refunds"])
    want("large_tables with no block is empty",
         large_tables("// no tables here"), [])
    # The entry shape, taken from the real probe file rather than guessed: both fields
    # are QUOTED strings, and origin carries "file:line (CONSTANT, KIND)".
    want("covered_probes reads every entry",
         covered_probes('    name: "daily_revenue",\n'
                        '    origin: "reports/revenue.rs:125 (DAILY_REVENUE_SQL, CONSTANT)",\n'
                        '    name: "other",\n'
                        '    origin: "x.rs:9 (OTHER_SQL, copied)",'),
         [("daily_revenue", "reports/revenue.rs:125 (DAILY_REVENUE_SQL, CONSTANT)"),
          ("other", "x.rs:9 (OTHER_SQL, copied)")])
    want("covered_probes with no entry is empty", covered_probes("// nothing"), [])

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (18 cases, nothing built or run)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the query-plan regression probe and report unindexed scans.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="require the falsification test to pass before trusting the gate",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="list the covered queries and the LARGE tables, then exit",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="grade the report formatters on synthetic output and exit. Pure: nothing is built or run.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    source = probe_source()
    if not source:
        print("check-query-plans: probe file not found: " + str(PROBE_FILE))
        return 2

    if args.list:
        return report_list(source)

    # 1. The falsification first when asked: if the detector cannot see a
    #    deliberately scanning query, a green gate below means nothing.
    if args.check:
        code, output = run_probe([FALSIFICATION_TEST, "--exact"], "falsification gate")
        if code != 0:
            print("")
            print("FAIL: the probe cannot fail. forcing_a_scan_fails_the_probe did not pass,")
            print("so a green result from the plan gate would be worthless. Output:")
            print(indent(output.strip().splitlines()[-25:]))
            return 2
        print("  ok: a forced scan is detected")
        print("")

    # 2. The gate.
    code, output = run_probe([], "plan gate")
    if code == 0:
        # 2b. The run-time-WHERE tier. The probe above prepares known strings and
        #     is structurally blind to an assembled WHERE clause; those are graded
        #     by unit tests inside the crate. Reporting OK without running them
        #     would leave the newest coverage -- the class O-M69 belonged to --
        #     executing in nobody's CI.
        unit_code, unit_output = run_unit_plan_gate([], "run-time WHERE gate")
        if unit_code != 0:
            print("")
            print("FAIL: the run-time-WHERE plan tests did not pass.")
            print("These grade queries whose WHERE clause is assembled at run time,")
            print("which the integration probe cannot see. Tail of the output:")
            print(indent(unit_output.strip().splitlines()[-25:]))
            return 2
        probes = covered_probes(source)
        print("")
        print(
            "check-query-plans: OK - "
            + str(len(probes))
            + " probed queries, none reads a LARGE table in full ("
            + ", ".join(large_tables(source))
            + ")."
        )
        return 0

    blocks = offender_blocks(output)
    if not blocks:
        # A build failure or a harness abort -- not a plan finding. Say so in
        # plain words instead of pretending it was a scan.
        print("")
        print("FAIL: the probe did not run to completion (build error or harness abort).")
        print("This is NOT a plan finding. Tail of the output:")
        print(indent(output.strip().splitlines()[-30:]))
        return 2

    summary = count_probed(output)
    print("")
    print("FAIL: " + (summary or (str(len(blocks)) + " probed queries read a LARGE table in full")))
    print("")
    for block in blocks:
        print(indent(block.splitlines()))
        print("")
    print("Each block above is a query reading a table that grows with transaction volume,")
    print("in full: every new row makes it slower. Fix the query or add the index it needs;")
    print("do not widen the LARGE_TABLES rule to make it pass.")
    return 1


def indent(lines: list[str]) -> str:
    """Indent a block two spaces for the report body."""
    return "\n".join("  " + line for line in lines)


if __name__ == "__main__":
    sys.exit(main())
