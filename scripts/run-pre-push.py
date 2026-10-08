#!/usr/bin/env python3
"""
scripts/run-pre-push.py — Parallel local pre-push orchestrator for kasir.mu.

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

def get_rustfmt():
    """rustfmt sits beside cargo in a rustup install; PATH is the fallback."""
    found = shutil.which("rustfmt")
    if found:
        return found
    beside_cargo = Path(get_cargo()).parent / "rustfmt.exe"
    if beside_cargo.exists():
        return str(beside_cargo)
    return "rustfmt"

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


# The workspace-wide formatting check is ADVISORY, not a verdict. Measured
# 2026-10-08: `cargo fmt --all -- --check` is red at HEAD almost always in this
# shared checkout (8 hunks / 6 files that day, 10 / 6 on 2026-10-04 -- different
# files each time), because it asks "is the whole tree formatted" while the
# push only owes "did THIS push add drift". Failing every Rust-touching push on
# other lanes' hunks is what made the check read as permanently broken, so the
# verdict moved to the diff-scoped task below and this one reports.
ADVISORY_FMT_LABEL = "cargo fmt --all --check (workspace, advisory)"
FMT_CHUNK_SIZE = 25


def plan_fmt_tasks(changed_rs, rustfmt, cargo, repo_root, chunk=FMT_CHUNK_SIZE):
    """Decide the formatting checks for one push. Pure: no disk, no subprocess.

    `changed_rs` is the push's own `*.rs` paths (as handed over by the hook's
    `git diff --name-only <merge-base> <local-oid>`), so the enforcing check
    can only ever fail on drift this push introduced. The workspace-wide check
    is always created, always advisory.

    Returns (enforcing, advisory_labels):
      * enforcing  -- task tuples; one per chunk of <= `chunk` files, so a long
                      push parallelises instead of blowing the argv limit
                      (Windows caps a command line near 32k characters).
      * advisory_labels -- labels whose failure must be REPORTED, never counted.
    """
    enforcing = []
    for start in range(0, len(changed_rs), chunk):
        batch = list(changed_rs[start:start + chunk])
        label = "rustfmt --check (diff"
        if len(changed_rs) > chunk:
            label += f" {start // chunk + 1}/{-(-len(changed_rs) // chunk)}"
        label += ")"
        enforcing.append(
            ("Tier 1: Rust", label, [rustfmt, "--check", "--edition", "2024", *batch], repo_root)
        )
    advisory = [("Tier 1: Rust", ADVISORY_FMT_LABEL, [cargo, "fmt", "--all", "--", "--check"], repo_root)]
    return enforcing, advisory


def format_skips(skipped):
    """The loud record: one named line per check this run could not run."""
    return [f"  {YELLOW}SKIP{NC}  {label:<44} {reason}" for label, reason in skipped]


def summary_lines(ran, elapsed, skipped, not_routed, advisory=()):
    """The closing lines. Pure.

    With zero skips and zero advisory drift the final line is LEGACY_PASS_LINE,
    unchanged. With any skip the total-shaped line is replaced by one that
    states what did not run; the routing count is reported separately so it
    cannot be misread as a list of skipped checks. Advisory drift is named the
    same way: a check that reported drift must never hide behind "all N passed".
    """
    lines = [
        f"pre-push accounting: {ran} checks RAN, {len(skipped)} SKIPPED "
        f"(selected but could not run), {len(not_routed)} not selected by "
        f"routing (ROUTING, not a skip)."
    ]
    lines.extend(format_skips(skipped))
    if advisory:
        lines.append(
            f"{YELLOW}pre-push: {len(advisory)} advisory check(s) reported drift "
            f"(REPORTED, not a verdict): {', '.join(advisory)}{NC}"
        )
    if not skipped and not advisory:
        lines.append(f"\n{GREEN}" + LEGACY_PASS_LINE.format(n=ran, t=elapsed) + f"{NC}")
        return lines
    if not skipped:
        lines.append(
            f"\n{GREEN}pre-push: {ran} checks passed in {elapsed}s (parallel); "
            f"advisory drift reported above -- the verdict is the diff-scoped checks.{NC}"
        )
        return lines
    names = ", ".join(label for label, _ in skipped)
    lines.append(
        f"\n{YELLOW}pre-push: {ran} checks passed in {elapsed}s (parallel); "
        f"{len(skipped)} did NOT run: {names}. Not a total.{NC}"
    )
    return lines


def read_rust_file_list(argv):
    """Read the `--rust-files <path>` list the hook wrote. One line per path.

    Absent flag (a by-hand run, or a hook that could not compute the range)
    yields an empty list: no diff-scoped verdict is owed, and the advisory
    workspace check still reports. Never guesses a range -- a wrong base would
    make the verdict mean something other than "this push".
    """
    if "--rust-files" not in argv:
        return []
    idx = argv.index("--rust-files") + 1
    if idx >= len(argv):
        return []
    try:
        text = Path(argv[idx]).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return [line.strip().replace("\\", "/") for line in text.splitlines()
            if line.strip().endswith(".rs")]


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

    print("  run-pre-push self-test / the fmt verdict is diff-scoped, the workspace check reports")
    enforcing, advisory = plan_fmt_tasks(["crates/a/src/x.rs"], "rustfmt", "cargo", ".")
    expect(len(enforcing) == 1, "one changed .rs file yields exactly one enforcing task")
    expect(enforcing[0][2] == ["rustfmt", "--check", "--edition", "2024", "crates/a/src/x.rs"],
           "the enforcing task checks ONLY the push's own file")
    expect(advisory == [("Tier 1: Rust", ADVISORY_FMT_LABEL, ["cargo", "fmt", "--all", "--", "--check"], ".")],
           "the workspace check still runs, and is the advisory one")
    expect(ADVISORY_FMT_LABEL not in [t[1] for t in enforcing],
           "the advisory label is never an enforcing label")

    print("  run-pre-push self-test / no .rs in the push means no diff-scoped verdict")
    enforcing, advisory = plan_fmt_tasks([], "rustfmt", "cargo", ".")
    expect(enforcing == [], "an empty file list creates no enforcing task (routing, not a skip)")
    expect(len(advisory) == 1, "the advisory workspace check is still created")

    print("  run-pre-push self-test / a long push chunks instead of blowing argv")
    many = [f"crates/c/src/f{i}.rs" for i in range(30)]
    enforcing, _ = plan_fmt_tasks(many, "rustfmt", "cargo", ".", chunk=25)
    expect(len(enforcing) == 2, f"30 files at chunk 25 yields 2 tasks (got {len(enforcing)})")
    expect(all(len(t[2]) <= 4 + 25 for t in enforcing), "no task carries more than its chunk of paths")
    expect(enforcing[0][1].endswith("1/2)") and enforcing[1][1].endswith("2/2)"),
           "chunked tasks are numbered so a failure names which batch drifted")
    covered = [p for t in enforcing for p in t[2][4:]]
    expect(covered == many, "every file is checked exactly once, in order")

    print("  run-pre-push self-test / advisory drift cannot read as a verdict")
    lines = summary_lines(12, 3.0, [], [], [ADVISORY_FMT_LABEL])
    joined = "\n".join(lines)
    expect("all 12 checks passed" not in joined,
           "the total-shaped green line is suppressed when an advisory reported drift")
    expect(ADVISORY_FMT_LABEL in joined, "the advisory drift is named in the closing lines")
    clean = "\n".join(summary_lines(12, 3.0, [], []))
    expect(LEGACY_PASS_LINE.format(n=12, t=3.0) in clean,
           "a run with no skips and no advisory drift still prints the historical pass line")

    print("  run-pre-push self-test / the hook's file list is read, filtered and normalised")
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write("crates\\a\\src\\x.rs\nui/src/y.ts\n\ncrates/b/src/z.rs\n")
        listing = fh.name
    got = read_rust_file_list(["--rust", "--rust-files", listing])
    expect(got == ["crates/a/src/x.rs", "crates/b/src/z.rs"],
           f"only .rs entries survive, with forward slashes (got {got})")
    expect(read_rust_file_list(["--all"]) == [],
           "a by-hand run with no --rust-files owes no diff-scoped verdict")
    expect(read_rust_file_list(["--rust-files", listing + ".missing"]) == [],
           "an unreadable list is empty, never a guessed range")

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
        (
            "verify-scoped-authorization (H-1b)",
            [bash, "scripts/verify-scoped-authorization.sh", "--strict"],
        ),
    ]

    for label, cmd in static_gates:
        tasks.append(("Tier 0: static", label, cmd, REPO_ROOT))

    # ── Tier 1: Path-Routed Tasks (Run in parallel alongside Tier 0) ──
    #
    # The formatting VERDICT is diff-scoped: the hook hands over the push's own
    # `*.rs` list (`--rust-files`), so this can only fail on drift the push
    # introduced. The workspace-wide check still runs and still prints, as an
    # ADVISORY -- see ADVISORY_FMT_LABEL for why failing on it was wrong.
    changed_rs = read_rust_file_list(sys.argv)
    rust_check = [
        ("Tier 1: Rust", "cargo check --workspace", [cargo, "check", "--workspace", "--message-format", "short"], REPO_ROOT),
    ]
    created, dropped, routed_off = plan_area_tasks(rust_check, run_rust, True, "rust")
    tasks.extend(created)
    skipped.extend(dropped)
    not_routed.extend(routed_off)
    if run_rust:
        fmt_enforcing, fmt_advisory = plan_fmt_tasks(
            changed_rs, get_rustfmt(), cargo, REPO_ROOT
        )
        tasks.extend(fmt_enforcing)
        tasks.extend(fmt_advisory)
        if not changed_rs:
            not_routed.extend(["rustfmt --check (diff) -- no .rs files in this push"])
    else:
        not_routed.extend(["rustfmt --check (diff)", ADVISORY_FMT_LABEL])

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
    advisory_labels = {ADVISORY_FMT_LABEL}
    advisory_drift = []

    with ThreadPoolExecutor(max_workers=cap) as pool:
        futures = {pool.submit(run_task, t): t for t in tasks}
        for future in as_completed(futures):
            tier, label, ok, duration, output = future.result()
            if not ok and label in advisory_labels:
                # REPORTED, never counted: see ADVISORY_FMT_LABEL.
                print(f"  {YELLOW}INFO{NC}  {label:<44} {duration:>4}s")
                sys.stdout.flush()
                advisory_drift.append(label)
                continue
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

    for line in summary_lines(total_tasks, total_elapsed, skipped, not_routed, advisory_drift):
        print(line)
    sys.exit(0)

if __name__ == "__main__":
    main()
