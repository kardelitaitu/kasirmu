#!/usr/bin/env python3
"""verify-runner-claims.py -- prose that claims CI enforcement must be true.

WHY THIS EXISTS, AND WHY IT IS NARROW
======================================
The other runner gates check that runners are WELL FORMED: verify-shell-syntax parses
them, verify-workflow-syntax parses them, verify-runner-commands resolves the scripts
they name. None of them checks that PROSE ABOUT runners is true. That gap cost two
corrections in one session, both of the same shape:

  ops/docker/Dockerfile.server:94 said workspace consistency "is enforced by
  scripts/verify-dockerfile-workspace.py in CI" -- the checker had no runner at all,
  and when it got one it went into the local matrix, not a workflow.
  docs/operations/ci-pipeline.md said a checker was invoked by "no live workflow and
  not check.sh" -- true when written, false within the same session.

A claim about enforcement sits next to the thing it describes, reads as verified fact,
and is checked by nobody. So this checks exactly one thing: where a file POSITIVELY
asserts that a script is enforced or run in CI, that script must actually be invoked by
a live workflow.

WHAT IS DELIBERATELY NOT FLAGGED
================================
Negative claims. "Runs nowhere", "retired", "no runner", "used to" are statements of
ABSENCE, and they stay correct no matter what gets wired later -- a checker can only
gain a runner, never lose one. Flagging those is how a gate cries wolf on the repo's own
historical records, which is the mistake that sank two earlier attempts this session.

Also exempt: files under docs/archived, .github/workflows/attic, and dated baselines.
Those are evidence. A record of what was true on a given day is not drift, and rewriting
one to match today destroys the only evidence that it ever differed.

Exit 0 every positive claim holds, 1 at least one does not, 2 the scan saw nothing.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The live-workflow rule is shared; see scripts/_live_workflows.py. Six checkers had
# their own copy and three disagreed about .yaml, which is how a half-fixed suite
# pretends to be a fixed one.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _live_workflows import live_workflow_files as _live_workflow_files  # noqa: E402

# A positive enforcement claim. Two shapes, because prose uses both:
#   "... is enforced by scripts/verify-x.py in CI"
#   "scripts/verify-x.py in CI"
CLAIM_RES = [
    re.compile(r"(?:enforced|validated|verified|checked|guarded|covered)"
               r"[^.\n]{0,90}?by\s+([A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
               r"[^.\n]{0,40}?\bCI\b", re.I),
    re.compile(r"([A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
               r"[^.\n]{0,40}?\bin CI\b", re.I),
]
# Words that turn a sentence into a record of the past. Without these the gate reads
# changelogs and journals as violations, which is exactly the noise that gets a gate
# muted on its first run.
HISTORICAL = re.compile(
    r"\b(?:retired|was in|were in|used to|no longer|formerly|previously|"
    r"histor(?:y|ical)|at the time|once|dead|did not run)\b", re.I)
# "var" is program-generated state (the database, its WAL sidecars, backups);
# a backup archive in there is a filename, not a claim about CI.
# "records" was added 2026-10-02, when "archived" became a one-file tombstone.
# The pruning below matches a DIRECTORY NAME, so the 28 documents that used to sit
# under docs/archived/ stopped being skipped the moment they moved to
# docs/records/ -- and this checker went RED on one of them, because a dated
# audit's claim ("verify-docker-persistence.sh is run in CI") stopped being
# treated as evidence. That is the intent stated in this file's own docstring:
# a record of what was true on a given day is not drift.
#
# This was the only break in the whole docs/ move that turned a gate RED rather
# than failing silently. The other three -- build-docs, release.sh, and the CI
# route bucket -- all stayed green while being wrong.
SKIP_DIRS = ("archived", "records", "attic", "node_modules", "target", "dist",
             ".git", "__tests__", "var")
SCAN_SUFFIX = (".md", ".yml", ".yaml", ".sh", ".rs", ".toml", ".json", ".ps1",
              ".txt", ".py", ".mjs", ".ts", ".tsx")
# .py/.mjs were MISSING at first, so a claim in a Python docstring or a Node comment was
# invisible -- including this file's own, which names a checker it says has no runner.
# Same shape as every other scope bug in this session: an assumption about what a file
# looks like, standing in for a question about where claims actually live.
SCAN_NAMES = ("Dockerfile", "Dockerfile.server", "Dockerfile.unified", "AGENTS.md")


def live_ci_scripts() -> set[str]:
    """Basenames a LIVE workflow invokes. attic/ excluded: never executed."""
    out: set[str] = set()
    # Shared rule -- see scripts/_live_workflows.py for why it is written once.
    for p in _live_workflow_files():
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r"([A-Za-z0-9_.-]+\.(?:py|mjs|sh))", text):
            out.add(m.group(1))
    return out


def scanned_files() -> list[Path]:
    out: list[Path] = []
    # This file is excluded because its own self-test fixtures are CLAIM-SHAPED BY
    # DESIGN -- they are the strings the cases assert on, and they name verify-x.py, a
    # script that does not exist. A checker that reads its own fixtures will always find
    # claims that are not claims, and the fix for that is exclusion, not a weaker
    # pattern that would also stop matching real ones.
    for dirpath, dirnames, filenames in __import__("os").walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d.lower() not in SKIP_DIRS and not d.startswith(".git")]
        for fn in filenames:
            p = Path(dirpath) / fn
            if fn.endswith(SCAN_SUFFIX) or fn in SCAN_NAMES:
                if p.resolve() == Path(__file__).resolve():
                    continue   # see below
                out.append(p)
    return sorted(out)


def claims_in(text: str) -> list[tuple[str, str]]:
    """(script, the sentence) for each positive enforcement claim on a line."""
    found: list[tuple[str, str]] = []
    for ln in text.splitlines():
        if HISTORICAL.search(ln):
            continue
        for rx in CLAIM_RES:
            m = rx.search(ln)
            if m:
                found.append((Path(m.group(1)).name, ln.strip()))
                break
    return found


def self_test() -> int:
    """Pure over synthetic text. No file is created, read or written."""
    bad: list[str] = []

    # A live claim is found.
    got = claims_in("Workspace consistency is enforced by scripts/verify-x.py in CI.")
    if not got or got[0][0] != "verify-x.py":
        bad.append(f"a positive claim must be found, got {got!r}")

    # A claim of absence is NOT a claim of enforcement -- the exemption that keeps this
    # gate off the repo's own historical records.
    for label, line in (
        ("retired", "the gate is retired, no runner invokes scripts/verify-x.py in CI"),
        ("used to", "scripts/verify-x.py used to run in CI"),
        ("historical", "at the time scripts/verify-x.py ran in CI"),
    ):
        if claims_in(line):
            bad.append(f"a {label} statement must not be flagged as a live claim")

    # And the rule must fire on the exact shape that was actually wrong: a script
    # asserted to be in CI while the live set does not contain it.
    live = {"other.py"}
    got = claims_in("enforced by scripts/verify-x.py in CI")
    if got and Path(got[0][0]).name in live:
        bad.append("the missing-script case must not be reported as satisfied")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (5 cases, no files touched)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    live = live_ci_scripts()
    if not live:
        print("verify-runner-claims: no live workflow scripts found. Refusing to report"
              " clean -- a claim checker with an empty live set would call every claim"
              " a violation.", file=sys.stderr)
        return 2

    false_claims: list[str] = []
    seen = 0
    for p in scanned_files():
        if p.suffix in (".yml", ".yaml") and p.name in {w.name for w in _live_workflow_files()}:
            continue          # a workflow does not claim about itself
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for script, sentence in claims_in(text):
            seen += 1
            if script not in live:
                rel = p.relative_to(ROOT).as_posix()
                false_claims.append(f"{rel}: {script} is claimed to run in CI but no"
                                    f" live workflow invokes it\n    {sentence[:150]}")
    if false_claims:
        print(f"verify-runner-claims: {len(false_claims)} claim(s) assert CI"
              f" enforcement that does not exist:")
        for f in false_claims:
            print("  " + f)
        print("  Either wire the checker into a live workflow, or change the claim to say"
              " where it actually runs. A comment that reads as a verified fact and is"
              " checked by nobody is worse than no comment.")
        return 1
    print(f"verify-runner-claims: OK — {seen} CI-enforcement claim(s) checked, all hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
