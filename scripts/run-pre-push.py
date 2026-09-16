#!/usr/bin/env python3
"""
scripts/run-pre-push.py — Parallel local pre-push orchestrator for OZ-POS.

Runs all static gates, UI checks, Rust checks, and i18n lints concurrently
across available CPU cores on multi-core hardware.

A check this script could not create because its node_modules is absent is
recorded as a NAMED skip and kept out of the pass total; a check the diff never
routed to is ROUTING, not a skip. Neither changes the exit status.

    python scripts/run-pre-push.py --self-test   # pure assertions, spawns nothing
"""

import os
import sys
import time
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Windows consoles default to legacy codepages (e.g. cp1252) that cannot encode
# gate output containing Unicode symbols (U+276F, checkmarks, box drawing), which
# crashed the failure reporter mid-print. Force UTF-8 with lossless-where-possible
# replacement so gate results always print completely.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

REPO_ROOT = Path(__file__).resolve().parent.parent

# ANSI colors
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
NC = "\033[0m"

def get_python():
    return sys.executable or "python3"

def get_bash():
    if os.name == "nt":
        for candidate in [
            Path("C:/Program Files/Git/bin/bash.exe"),
            Path("C:/Program Files/Git/usr/bin/bash.exe"),
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Git" / "bin" / "bash.exe",
        ]:
            if candidate.exists():
                return str(candidate)
    return shutil.which("bash") or "bash"

def get_cargo():
    found = shutil.which("cargo")
    if found:
        return found
    cargo_home = Path(os.environ.get("USERPROFILE", "")) / ".cargo" / "bin" / "cargo.exe"
    if cargo_home.exists():
        return str(cargo_home)
    return "cargo"

def get_npm():
    if os.name == "nt":
        return shutil.which("npm.cmd") or "npm.cmd"
    return shutil.which("npm") or "npm"

def get_npx():
    if os.name == "nt":
        return shutil.which("npx.cmd") or "npx.cmd"
    return shutil.which("npx") or "npx"

def run_task(task):
    """Run a single command task and capture timing + output."""
    tier, label, cmd, cwd = task
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        duration = round(time.time() - t0, 1)
        return (tier, label, proc.returncode == 0, duration, proc.stdout)
    except Exception as e:
        duration = round(time.time() - t0, 1)
        return (tier, label, False, duration, str(e))

# ── Pure planning helpers ──────────────────────────────────────────────────
# Everything that decides *what runs* lives in the functions below, so
# --self-test can exercise the whole decision without spawning a process or
# needing a ui/node_modules on the machine the test is checked in on.
#
# The bug they pin: tasks used to be appended inside
# `if (ui_dir / "node_modules").exists():` blocks. On a machine without that
# directory the tasks were never created, nothing said so, and total_tasks at
# the closing line counted only CREATED tasks -- so the run printed
# "pre-push: all N checks passed" while ui typecheck, ui vitest and the tz
# invariance check had never run. A missing dependency is now a NAMED skip.
# The sibling drop (no interpreter on PATH => the hook exits 0) lives in
# .githooks/pre-push and is outside this file.

# ROUTING versus SKIP -- the line this file draws:
#   * a check not selected because the diff did not touch its area is ROUTING.
#     Nothing failed to run; it was correctly not asked to run. Never a skip.
#   * a check that WAS selected but cannot run for a missing dependency is a
#     SKIP. It must be named, one line per check, and must never be folded into
#     a total-shaped green. Exit status stays 0 either way -- recording the drop
#     loudly is this file's job; the friction decision belongs to the hook.

# The final line the historical script printed when nothing was dropped. Kept
# verbatim so a clean run reads and parses exactly as it did before.
LEGACY_PASS_LINE = "pre-push: all {n} checks passed in {t}s (parallel)."


def plan_area_tasks(area_tasks, routed, dep_present, dep_rel):
    """Decide one dependency-gated area. Pure: no disk, no subprocess.

    Returns (created, skipped, not_routed): task tuples that ran, dropped
    (label, reason) pairs, and labels the diff never routed to.
    """
    if not routed:
        # The diff did not touch this area: routing, not a skip.
        return [], [], [t[1] for t in area_tasks]
    if dep_present:
        return list(area_tasks), [], []
    reason = f"dependency directory absent: {dep_rel}/node_modules"
    return [], [(t[1], reason) for t in area_tasks], []


def format_skips(skipped):
    """The loud record: one named line per check this run could not run."""
    return [f"  {YELLOW}SKIP{NC}  {label:<44} {reason}" for label, reason in skipped]


def summary_lines(ran, elapsed, skipped, not_routed):
    """The closing lines. Pure.

    With zero skips the final line is LEGACY_PASS_LINE, unchanged. With any
    skip the total-shaped line is replaced by one that states what did not
    run; the routing count is reported separately so it cannot be misread as
    a list of skipped checks.
    """
    lines = [
        f"pre-push accounting: {ran} checks RAN, {len(skipped)} SKIPPED "
        f"(selected but could not run), {len(not_routed)} not selected by "
        f"routing (ROUTING, not a skip)."
    ]
    lines.extend(format_skips(skipped))
    if not skipped:
        lines.append(f"\n{GREEN}" + LEGACY_PASS_LINE.format(n=ran, t=elapsed) + f"{NC}")
        return lines
    names = ", ".join(label for label, _ in skipped)
    lines.append(
        f"\n{YELLOW}pre-push: {ran} checks passed in {elapsed}s (parallel); "
        f"{len(skipped)} did NOT run: {names}. Not a total.{NC}"
    )
    return lines


def self_test():
    """--self-test: pure assertions on the planner. No subprocess, no disk.

    Guards the guard. Three things must never regress: a missing dependency
    yields at least one NAMED skip; a routed-off area is not a skip; and a
    dropped check can never be summarised as a total.
    """
    failures = []

    def expect(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'}  {msg}")
        if not cond:
            failures.append(msg)

    ui_tasks = [
        ("Tier 1: UI", "ui typecheck", ["npm", "run", "typecheck"], "ui"),
        ("Tier 1: UI", "ui vitest", ["npx", "vitest", "run"], "ui"),
        ("Tier 1: UI", "analytics timezone invariance", ["python", "x.py"], "."),
    ]

    print("  run-pre-push self-test / a dependency drop must be a named skip")
    created, skipped, not_routed = plan_area_tasks(ui_tasks, True, False, "ui")
    expect(created == [], "nothing is created when ui/node_modules is absent")
    expect(len(skipped) > 0, f"missing node_modules yields a skip (got {len(skipped)})")
    expect(len(skipped) == len(ui_tasks), "every task of the routed area is dropped, none silently")
    expect([label for label, _ in skipped] == [t[1] for t in ui_tasks], "each dropped task is named individually")
    expect(not_routed == [], "a dependency drop is never counted as routing")
    rendered = "\n".join(format_skips(skipped))
    expect("ui typecheck" in rendered and "ui/node_modules" in rendered,
           "the printed skip names the check AND the missing directory")

    print("  run-pre-push self-test / deps present: zero skips, old wording")
    created, skipped, not_routed = plan_area_tasks(ui_tasks, True, True, "ui")
    expect(skipped == [], "no skip when the dependency is present")
    expect(len(created) == len(ui_tasks), "every task is created when the dependency is present")
    closing = summary_lines(len(created), 1.2, skipped, not_routed)[-1]
    expect(closing.endswith(LEGACY_PASS_LINE.format(n=len(created), t=1.2) + NC),
           "a clean run still prints the historical pass line verbatim")

    print("  run-pre-push self-test / routing is not a skip")
    created, skipped, not_routed = plan_area_tasks(ui_tasks, False, False, "ui")
    expect(skipped == [], "an area the diff never routed to yields no skip even with deps missing")
    expect(len(not_routed) == len(ui_tasks), "the unselected tasks are reported as routing")

    print("  run-pre-push self-test / a skip cannot read as a total")
    lines = summary_lines(13, 4.0, [("ui typecheck", "dependency directory absent: ui/node_modules")], ["lint-i18n"])
    joined = "\n".join(lines)
    expect("all 13 checks passed" not in joined, "the total-shaped green line is suppressed when anything was skipped")
    expect("ui typecheck" in joined, "the summary repeats which check did not run")
    expect("routing" in joined and "1 SKIPPED" in joined, "ran / skipped / routed-off are stated as three counts")

    if failures:
        print(f"\nself-test: {len(failures)} FAILURE(S)")
        return 1
    print("self-test: OK — a check this script could not run can no longer pass unseen")
    return 0


def main():
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())

    py = get_python()
    bash = get_bash()
    cargo = get_cargo()
    npm = get_npm()
    npx = get_npx()
    
    # Parse routing arguments passed by .githooks/pre-push
    run_rust = "--rust" in sys.argv or "--all" in sys.argv
    run_ui = "--ui" in sys.argv or "--all" in sys.argv
    run_web = "--website" in sys.argv or "--all" in sys.argv
    run_i18n = "--i18n" in sys.argv or "--all" in sys.argv

    tasks = []
    # Checks routed off because the diff did not touch their area. ROUTING.
    not_routed = []
    # Checks that WERE routed to but could not be created for a missing
    # dependency: (label, why). These are the drops the old script hid.
    skipped = []

    # ── Tier 0: Static Gates (Always run in parallel) ────────────────
    static_gates = [
        ("dedupe-ftl --dry-run", [py, "scripts/dedupe-ftl.py", "--dry-run"]),
        ("bundle-parity (full census)", [py, "scripts/verify-bundle-parity.py", "--full-census"]),
        ("verify-ipc-parity", [py, "scripts/verify-ipc-parity.py"]),
        ("verify-architecture-boundaries", [py, "scripts/verify-architecture-boundaries.py", "--strict"]),
        ("verify-no-hardcoded-money", [py, "scripts/verify-no-hardcoded-money-format.py"]),
        ("verify-feature-registry", [py, "scripts/verify-feature-registry.py"]),
        ("verify-topology-parity", [py, "scripts/verify-topology-parity.py"]),
        ("verify-windows-config", [py, "scripts/verify-windows-config.py"]),
        ("verify-plugin-guide-parity", [py, "scripts/verify-plugin-guide-parity.py"]),
        ("verify-migration-column-types", [py, "scripts/verify-migration-column-types.py"]),
        ("verify-pg-schema-drift", [py, "scripts/generate-pg-migration.py", "--check"]),
        ("verify-no-raw-params", [bash, "scripts/verify-no-raw-params.sh"]),
        ("verify-scoped-coverage (H-1)", [bash, "scripts/verify-scoped-coverage.sh"]),
    ]

    for label, cmd in static_gates:
        tasks.append(("Tier 0: static", label, cmd, REPO_ROOT))

    # ── Tier 1: Path-Routed Tasks (Run in parallel alongside Tier 0) ──
    rust_tasks = [
        ("Tier 1: Rust", "cargo check --workspace", [cargo, "check", "--workspace", "--message-format", "short"], REPO_ROOT),
        ("Tier 1: Rust", "cargo fmt --check", [cargo, "fmt", "--all", "--", "--check"], REPO_ROOT),
    ]
    created, dropped, routed_off = plan_area_tasks(rust_tasks, run_rust, True, "rust")
    tasks.extend(created)
    skipped.extend(dropped)
    not_routed.extend(routed_off)

    # Tier 1 UI: all three depend on ui/node_modules. The old code built them
    # inside that existence check, so their absence was invisible.
    ui_dir = REPO_ROOT / "ui"
    created, dropped, routed_off = plan_area_tasks(
        [
            ("Tier 1: UI", "ui typecheck", [npm, "run", "typecheck"], ui_dir),
            ("Tier 1: UI", "ui vitest", [npx, "vitest", "run"], ui_dir),
            ("Tier 1: UI", "analytics timezone invariance", [py, "scripts/check-tz-invariance.py"], REPO_ROOT),
        ],
        run_ui,
        (ui_dir / "node_modules").exists(),
        "ui",
    )
    tasks.extend(created)
    skipped.extend(dropped)
    not_routed.extend(routed_off)

    # Website: asset hygiene needs no install, so only the other two are
    # dependency gated -- but all three are routing-gated by --website.
    web_dir = REPO_ROOT / "website"
    hygiene = ("Tier 1: Website", "website asset hygiene", [py, "scripts/verify-website-assets.py"], REPO_ROOT)
    web_installed = [
        ("Tier 1: Website", "website astro check", [npx, "astro", "check"], web_dir),
        ("Tier 1: Website", "website vitest", [npx, "vitest", "run"], web_dir),
    ]
    if run_web:
        tasks.append(hygiene)
        created, dropped, _routed_off = plan_area_tasks(
            web_installed, True, (web_dir / "node_modules").exists(), "website")
        tasks.extend(created)
        skipped.extend(dropped)
    else:
        not_routed.extend([hygiene[1]] + [t[1] for t in web_installed])

    created, dropped, routed_off = plan_area_tasks(
        [("Tier 1: i18n", "lint-i18n", [bash, "scripts/lint-i18n.sh"], REPO_ROOT)],
        run_i18n, True, "i18n")
    tasks.extend(created)
    skipped.extend(dropped)
    not_routed.extend(routed_off)

    # RECORD THE SKIP, LOUDLY, UP FRONT: this run is not covering these checks.
    if skipped:
        print(f"{YELLOW}pre-push: {len(skipped)} routed check(s) CANNOT RUN and were NOT verified:{NC}")
        for line in format_skips(skipped):
            print(line)
        print(f"{YELLOW}pre-push: exit status is unchanged (0) -- the record is the point, "
              f"but 'passed' below does not cover these.{NC}\n")
        sys.stdout.flush()

    total_tasks = len(tasks)
    # The cap governs PROCESS SPAWNS, not threads: every task forks its own
    # children (cargo, bash sub-gates, node), and on a machine already carrying
    # several concurrent agent sessions an unbounded fan-out starves the
    # Windows commit charge — MSYS children die with 0xC000012D and cargo never
    # starts, which the reporter then prints as a 0.0s FAIL that looks like a
    # verdict but is a spawn casualty (measured repeatedly on 2026-09-13: same
    # gates FAIL at 0.0s in-parallel and exit 0 minutes later, serially, on an
    # unchanged tree). 6 still overlaps the slow jobs; raise via env only on a
    # quiet machine.
    try:
        cap = int(os.environ.get("OZ_PREPUSH_PARALLEL", "6"))
    except ValueError:
        cap = 6
    cap = max(1, min(total_tasks, cap))
    print(f"pre-push (parallel): executing {total_tasks} checks, {cap} at a time (OZ_PREPUSH_PARALLEL)...\n")
    sys.stdout.flush()
    start_time = time.time()

    failures = []

    with ThreadPoolExecutor(max_workers=cap) as pool:
        futures = {pool.submit(run_task, t): t for t in tasks}
        for future in as_completed(futures):
            tier, label, ok, duration, output = future.result()
            status = f"{GREEN}PASS{NC}" if ok else f"{RED}FAIL{NC}"
            print(f"  {status}  {label:<44} {duration:>4}s")
            sys.stdout.flush()
            if not ok:
                failures.append((label, output))

    total_elapsed = round(time.time() - start_time, 1)

    if failures:
        if skipped:
            print(f"\n{YELLOW}pre-push: {len(skipped)} routed check(s) could not run and are NOT in this verdict:{NC}")
            for line in format_skips(skipped):
                print(line)
        print(f"\n{RED}pre-push BLOCKED after {total_elapsed}s. {len(failures)} failing gate(s):{NC}")
        for label, out in failures:
            print(f"\n{RED}--- Failure Output: {label} ---{NC}")
            lines = out.strip().splitlines()[-20:]
            for l in lines:
                print(f"    {l}")
            print(f"{RED}--------------------------------{NC}")
        sys.exit(1)

    for line in summary_lines(total_tasks, total_elapsed, skipped, not_routed):
        print(line)
    sys.exit(0)

if __name__ == "__main__":
    main()
