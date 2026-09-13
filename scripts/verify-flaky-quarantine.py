#!/usr/bin/env python3
"""
scripts/verify-flaky-quarantine.py — AUDIT-27 CI-09 enforcement gate.

Validates scripts/flaky-quarantine.json:
  • schema sanity (version + entries)
  • every entry has test, owner, issue, reason, date, expiry
  • every entry references a GitHub issue (URL or #NN)
  • no entry is expired (expiry >= today)

Usage:
  python3 scripts/verify-flaky-quarantine.py            # fail on any violation
  python3 scripts/verify-flaky-quarantine.py --report   # print count, still gate

ROOT RESOLUTION
===============

Both paths this gate needs -- the manifest and the Rust corpus its entries name tests
from -- are resolved from where the DATA lives, not from where this script sits. The
old constant was "flaky-quarantine.json next to me", so a copy of scripts/ into a temp
directory validated the copy of the manifest, printed
"PASS: quarantine manifest valid (0 entries, none expired)", and exited 0 over a tree it
had never read. The line is identical to the real run's line, which is the point: nothing
in the output said the walk was empty. Now the root is chosen by finding the manifest as
data, the corpus under it is counted, and a corpus of zero is a failure rather than a
verdict -- so a gate that read nothing cannot print clean.

Exit code is 1 on any violation, including a refused empty walk; 0 otherwise.
"""

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

# Relative to the REPOSITORY ROOT, and only ever joined to a root that was accepted
# because it actually holds them. SCRIPT_RELATIVE_MANIFEST is gone on purpose: the
# script's own location is not evidence that a repository is there.
MANIFEST_REL = ("scripts", "flaky-quarantine.json")
# Where a nextest id in the manifest can come from. An empty walk here means the
# manifest is being judged against no tests at all.
TEST_CORPUS_ROOTS = ("crates", "apps", "platform", "modules", "foundation")

REQUIRED_FIELDS = ("test", "owner", "issue", "reason", "date", "expiry")
ISSUE_RE = re.compile(r"^(https?://\S+|#\d+)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def resolve_root() -> tuple[Path | None, str, list[Path]]:
    """(root, how_it_was_chosen, every_root_probed) -- a root is accepted ONLY on the data.

    A candidate qualifies when the quarantine manifest actually sits under it, so the
    answer describes a tree with something to police rather than the directory this file
    happens to have been copied into. Every probed root comes back as well, because the
    refusal has to name what was looked for, not just what was missing.
    """
    here = Path(__file__).resolve().parent
    candidates: list[tuple[str, Path | None]] = [
        ("current working directory", Path.cwd()),
        ("git rev-parse --show-toplevel from the current directory", _git_toplevel(Path.cwd())),
        ("git rev-parse --show-toplevel from this script's directory", _git_toplevel(here)),
        ("parent of this script's directory", here.parent),
    ]
    probed: list[Path] = []
    for how, cand in candidates:
        if cand is None:
            continue
        cand = cand.resolve()
        if cand in probed:
            continue
        probed.append(cand)
        if cand.joinpath(*MANIFEST_REL).is_file():
            return cand, how, probed
    return None, "none of the probed roots held the manifest", probed


def corpus_count(root: Path) -> int:
    """Candidate Rust source files under the roots the manifest's test ids come from."""
    total = 0
    for rel in TEST_CORPUS_ROOTS:
        d = root / rel
        if d.is_dir():
            total += sum(1 for _ in d.rglob("*.rs"))
    return total


def main() -> int:
    report_only = "--report" in sys.argv[1:]

    root, root_source, probed = resolve_root()
    if root is None:
        # No manifest anywhere: the gate has read none of the tree it polices. Say so with
        # the paths it looked at, so nobody reads a refusal as a pass on an empty registry.
        print("FAIL: flaky-quarantine.json was found under none of the roots this gate "
              "probed, so it has read nothing -- an unread manifest is not a clean one.")
        print(f"  manifest looked for        : {'/'.join(MANIFEST_REL)} (under each root below)")
        for cand in probed:
            print(f"    - {cand}")
        return 1

    manifest = root.joinpath(*MANIFEST_REL)
    corpus = corpus_count(root)
    if corpus == 0:
        print("FAIL: REFUSED -- the manifest at this root has no test corpus behind it, so "
              "this gate read none of the tree it is supposed to police and a clean verdict "
              "here would prove nothing.")
        print(f"  repository root resolved to : {root}  (from {root_source})")
        print(f"  manifest read               : {manifest}")
        print(f"  candidate .rs files         : {corpus} under {', '.join(TEST_CORPUS_ROOTS)}"
              " -- a quarantine registry with no tests to quarantine is an empty input, "
              "not a passing one.")
        return 1

    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"FAIL: manifest is not valid JSON: {exc}  ({manifest})")
        return 1

    if not isinstance(data, dict) or data.get("version") != 1:
        print("FAIL: manifest must be an object with version = 1")
        return 1

    entries = data.get("entries", [])
    if not isinstance(entries, list):
        print("FAIL: manifest 'entries' must be a list")
        return 1

    today = datetime.date.today()
    violations = []
    expired = 0

    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            violations.append(f"entry[{i}] is not an object")
            continue

        label = entry.get("test") or f"entry[{i}]"

        for field in REQUIRED_FIELDS:
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                violations.append(f"{label}: missing required field '{field}'")

        issue = entry.get("issue")
        if issue and not ISSUE_RE.match(issue.strip()):
            violations.append(f"{label}: 'issue' must be a URL or #NN (got '{issue}')")

        for field in ("date", "expiry"):
            value = entry.get(field)
            if value and not DATE_RE.match(value):
                violations.append(f"{label}: '{field}' must be YYYY-MM-DD (got '{value}')")

        expiry = entry.get("expiry")
        if expiry and DATE_RE.match(expiry):
            exp_date = datetime.date.fromisoformat(expiry)
            if exp_date < today:
                expired += 1
                violations.append(
                    f"{label}: EXPIRED on {expiry} — re-investigate the flake, "
                    f"fix it, or renew the quarantine with an updated issue"
                )

    if report_only:
        print(f"INFO: {len(entries)} quarantined test(s), {expired} expired, "
              f"{len(violations)} violation(s); {corpus} candidate .rs file(s) under "
              f"{root} (from {root_source})")

    if violations:
        print("FAIL: flaky-quarantine.json violates the CI-09 policy:")
        for v in violations:
            print(f"  - {v}")
        print("See docs/ci-pipeline.md and CONTRIBUTING.md for the quarantine lifecycle.")
        return 1

    # The corpus count rides along on the success path too: a number printed only when the
    # gate is already failing is a number nobody compares a clean run against.
    print(f"PASS: quarantine manifest valid ({len(entries)} entries, none expired) -- "
          f"root {root} (from {root_source}), {corpus} candidate .rs file(s) found under "
          f"{', '.join(TEST_CORPUS_ROOTS)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
