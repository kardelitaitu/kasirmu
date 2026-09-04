#!/usr/bin/env python3
"""
scripts/run-pre-push.py — Parallel local pre-push orchestrator for OZ-POS.

Runs all static gates, UI checks, Rust checks, and i18n lints concurrently
across available CPU cores on multi-core hardware.
"""

import os
import sys
import time
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

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
    if shutil.which("cargo"):
        return "cargo"
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

def main():
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
        ("verify-circleci-drift", [py, "scripts/compose-circleci.py", "--check"]),
        ("verify-no-raw-params", [bash, "scripts/verify-no-raw-params.sh"]),
        ("verify-scoped-coverage (H-1)", [bash, "scripts/verify-scoped-coverage.sh"]),
    ]

    for label, cmd in static_gates:
        tasks.append(("Tier 0: static", label, cmd, REPO_ROOT))

    # ── Tier 1: Path-Routed Tasks (Run in parallel alongside Tier 0) ──
    if run_rust:
        tasks.append(("Tier 1: Rust", "cargo check --workspace", [cargo, "check", "--workspace", "--message-format", "short"], REPO_ROOT))
        tasks.append(("Tier 1: Rust", "cargo fmt --check", [cargo, "fmt", "--all", "--", "--check"], REPO_ROOT))

    if run_ui:
        ui_dir = REPO_ROOT / "ui"
        if (ui_dir / "node_modules").exists():
            tasks.append(("Tier 1: UI", "ui typecheck", [npm, "run", "typecheck"], ui_dir))
            tasks.append(("Tier 1: UI", "ui vitest", [npx, "vitest", "run"], ui_dir))
            tasks.append(("Tier 1: UI", "analytics timezone invariance", [py, "scripts/check-tz-invariance.py"], REPO_ROOT))

    if run_web:
        web_dir = REPO_ROOT / "website"
        tasks.append(("Tier 1: Website", "website asset hygiene", [py, "scripts/verify-website-assets.py"], REPO_ROOT))
        if (web_dir / "node_modules").exists():
            tasks.append(("Tier 1: Website", "website astro check", [npx, "astro", "check"], web_dir))
            tasks.append(("Tier 1: Website", "website vitest", [npx, "vitest", "run"], web_dir))

    if run_i18n:
        tasks.append(("Tier 1: i18n", "lint-i18n", [bash, "scripts/lint-i18n.sh"], REPO_ROOT))

    total_tasks = len(tasks)
    print(f"pre-push (parallel): executing {total_tasks} checks concurrently across CPU cores...\n")
    sys.stdout.flush()
    start_time = time.time()

    failures = []

    with ThreadPoolExecutor(max_workers=min(total_tasks, 32)) as pool:
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
        print(f"\n{RED}pre-push BLOCKED after {total_elapsed}s. {len(failures)} failing gate(s):{NC}")
        for label, out in failures:
            print(f"\n{RED}--- Failure Output: {label} ---{NC}")
            lines = out.strip().splitlines()[-20:]
            for l in lines:
                print(f"    {l}")
            print(f"{RED}--------------------------------{NC}")
        sys.exit(1)

    print(f"\n{GREEN}pre-push: all {total_tasks} checks passed in {total_elapsed}s (parallel).{NC}")
    sys.exit(0)

if __name__ == "__main__":
    main()
