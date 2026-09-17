#!/usr/bin/env python3
"""
scripts/diagnose-pr.py — One-Shot PR Failure Diagnoser for OZ-POS

Extracts failed checks, fetches the exact failure log snippets from GitHub Actions,
and outputs the exact local commands to reproduce and fix each failure.

Usage:
  python scripts/diagnose-pr.py [PR_NUMBER]
  python scripts/diagnose-pr.py 57
"""

import json
import re
import subprocess
import sys
from typing import Dict, List, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

# Mapping CI check names (or regex) to local reproduction commands
REPRODUCTION_MAP: Dict[str, str] = {
    r"Skill drift": "bash .agents/skills/skill-drift-guard/scripts/detect.sh",
    r"CI Docs Drift": "python scripts/verify-ci-docs-drift.py",
    r"Architecture Boundaries": "python scripts/verify-architecture-boundaries.py",
    r"Flaky Quarantine": "python scripts/verify-flaky-quarantine.py",
    r"Windows Config Drift": "python scripts/verify-windows-config.py",
    r"Rust Money Format": "python scripts/verify-no-hardcoded-money-format.py",
    r"Rust Format": "cargo fmt --all -- --check",
    r"Rust Clippy": "cargo clippy --all-targets --all-features -- -D warnings",
    r"Rust Panic Inventory": "python scripts/scan-unwrap-panic.py",
    r"Rust Test Fast": "bash scripts/test-changed.sh",
    r"Rust Test Apps": "cargo test -p desktop-tauri -p mobile-tauri",
    r"UI TypeCheck": "cd ui && npm run typecheck",
    r"UI Lint": "cd ui && npm run lint",
    r"UI Tests": "cd ui && npm run test",
    r"E2E Tests": "cd ui && npm run e2e:ui",
    r"Website Check": "cd website && npm run build",
    r"Docker \(build \+ scan \+ smoke\)": "bash scripts/verify-docker-all.sh",
    r"Dependency Audit": "cargo audit",
    r"Security": "cargo audit",
    r"Go Format": "cd apps/license-server && go vet ./...",
}


def run_cmd(cmd: List[str]) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return res.stdout.strip()


def strip_ansi_and_timestamps(text: str) -> str:
    # Remove ANSI escape sequences
    text = re.sub(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", "", text)
    # Remove ISO timestamps (e.g. 2026-08-29T15:27:06.2762306Z )
    text = re.sub(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*", "", text, flags=re.MULTILINE)
    return text


def get_current_pr_number() -> Optional[str]:
    out = run_cmd(["gh", "pr", "view", "--json", "number", "-q", ".number"])
    return out if out else None


def get_pr_repo() -> str:
    out = run_cmd(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    return out if out else "kardelitaitu/oz-pos"


def map_reproduction_cmd(check_name: str) -> str:
    for pattern, cmd in REPRODUCTION_MAP.items():
        if re.search(pattern, check_name, re.IGNORECASE):
            return cmd
    return "Check workflow log for details"


def extract_job_id(link: str) -> Optional[str]:
    # e.g. https://github.com/kardelitaitu/oz-pos/actions/runs/33259981926/job/99120143287
    m = re.search(r"/job/(\d+)", link)
    return m.group(1) if m else None


def extract_error_snippet(repo: str, job_id: str) -> str:
    raw_log = run_cmd(["gh", "api", f"repos/{repo}/actions/jobs/{job_id}/logs"])
    if not raw_log:
        return "Log unavailable or pending."

    clean_log = strip_ansi_and_timestamps(raw_log)
    lines = clean_log.splitlines()

    # Look for explicit error markers or the last non-empty lines
    error_lines = []
    error_idx = -1
    for i, line in enumerate(lines):
        if "##[error]" in line or "Error:" in line or "FAILED" in line or "failure" in line.lower():
            error_idx = i

    if error_idx != -1:
        start = max(0, error_idx - 15)
        end = min(len(lines), error_idx + 15)
        error_lines = lines[start:end]
    else:
        # Fallback to last 25 lines
        error_lines = [l for l in lines if l.strip()][-25:]

    return "\n".join(error_lines)


def main():
    pr_num = sys.argv[1] if len(sys.argv) > 1 else get_current_pr_number()
    if not pr_num:
        print("❌ Error: No PR number specified and could not detect PR for current branch.")
        sys.exit(1)

    repo = get_pr_repo()
    print(f"🔍 Diagnosing checks for PR #{pr_num} ({repo})...\n")

    checks_json = run_cmd(["gh", "pr", "checks", pr_num, "--json", "name,state,link"])
    if not checks_json:
        print("❌ Could not retrieve checks via gh CLI.")
        sys.exit(1)

    try:
        checks = json.loads(checks_json)
    except json.JSONDecodeError:
        print("❌ Failed to parse checks JSON.")
        sys.exit(1)

    failed_checks = [c for c in checks if c.get("state") in ("FAILURE", "CANCELLED")]
    pending_checks = [c for c in checks if c.get("state") in ("IN_PROGRESS", "QUEUED", "PENDING")]
    success_checks = [c for c in checks if c.get("state") in ("SUCCESS",)]

    if not failed_checks:
        if pending_checks:
            print(f"⏳ No failures yet. ({len(success_checks)} passed, {len(pending_checks)} in progress).")
            print("Run: gh pr checks " + pr_num + " --watch --fail-fast to monitor.")
            sys.exit(0)
        else:
            print(f"✅ All {len(success_checks)} checks passed!")
            sys.exit(0)

    print(f"❌ Found {len(failed_checks)} FAILED check(s) (out of {len(checks)} total):\n")

    for i, check in enumerate(failed_checks, 1):
        name = check.get("name", "Unknown")
        link = check.get("link", "")
        repro = map_reproduction_cmd(name)
        job_id = extract_job_id(link)

        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(f"[{i}/{len(failed_checks)}] ❌ {name}")
        print(f"   Local Reproduction: {repro}")
        print(f"   URL: {link}")
        print(f"   Failure Snippet:")
        print(f"   ─────────────────────────────────────────────────────────")

        if job_id:
            snippet = extract_error_snippet(repo, job_id)
            for line in snippet.splitlines():
                print(f"     {line}")
        else:
            print("     (No direct job log link found)")
        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    sys.exit(1)


if __name__ == "__main__":
    main()
