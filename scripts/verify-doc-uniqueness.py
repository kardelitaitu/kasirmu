#!/usr/bin/env python3
r"""
scripts/verify-doc-uniqueness.py — Catch duplicate documents that both claim to
be authoritative.

WHY
===

`f3d9cca6` ("tidy up project root files into docs, dev, and scripts") moved the
repo-root `subscription-tiers.md` to `docs/records/` without noticing that
`28147fe4` had already created `docs/guides/subscription-tiers.md` two weeks
earlier. Result: two tracked files, same basename, **both stamped "Status: FINAL —
Single source of truth for tier pricing, quotas, and feature gates"**, whose
entitlement tables disagree:

    audit:view row          guides: present   records: absent
    White-label branding    guides: Pro+Ent   records: Enterprise only

Nothing in CI notices. `verify-ci-docs-drift.py` compares the CI manifest against
workflows and runners; it has no idea what a pricing document says. So the repo
can carry two contradictory answers to "what does a Pro customer get", and the one
an engineer follows depends on which file they open first. For a document whose
subject is what customers are promised, that is a business defect wearing a
file-management costume.

A reorg is a high-risk operation precisely because it looks mechanical: moving a
file into a directory that already has a same-named file is the one thing a
`git mv` does not warn about when the collision is created by the DESTINATION
already having a copy.

WHAT IT CHECKS
==============

  1. DUPLICATE BASENAME — two tracked files sharing a basename, where at least
     one is a document (.md). Reports both paths and how different they are.
  2. CONFLICTING AUTHORITY — those duplicates both contain an exclusivity claim
     ("single source of truth", "authoritative", "canonical", "supersedes") in
     their first 40 lines. Two files claiming to be THE source is the actual bug;
     a duplicate where one says "archive copy" is fine.
  3. IDENTICAL DUPLICATES — byte-identical same-basename files, which is pure
     drift with no content risk but still two places to update.

Exclusivity claims are matched case-insensitively and the check is line-limited,
because a document that merely mentions the phrase deep in a changelog section is
not claiming authority over the repo.

Usage:
    python3 scripts/verify-doc-uniqueness.py
    python3 scripts/verify-doc-uniqueness.py --self-test
"""

from __future__ import annotations

import io
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001  # pragma: no cover
    pass

ROOT = Path(__file__).resolve().parent.parent

AUTHORITY = re.compile(
    r"single source of truth|the authoritative|canonical source|"
    r"source of truth|supersedes",
    re.I,
)
DOC_SUFFIXES = {".md", ".rst", ".txt"}
HEAD_LINES = 40

# A non-authoritative copy that SAYS so is not a defect -- it is a labelled
# archive. Matched anywhere in the file, since the disclaimer is often a
# one-line note under the heading rather than a status block.
DISCLAIMER = re.compile(
    r"archiv|historical|snapshot|not maintained|superseded by|out of date|"
    r"no longer (?:maintained|updated)|read-?only copy",
    re.I,
)

# Scope. The defect being caught is a duplicate inside the DOCUMENTATION tree,
# where one file is meant to be the answer. Same-basename files elsewhere are
# normal and unrelated.
SCOPE_PREFIXES = ("docs/",)

# Names that legitimately repeat. Without this the first run flagged README.md
# (every crate has one), SKILL.md (every skill has one) and AGENTS.md (three
# deliberate mirrors) as "duplicates" -- 4 findings, all noise, against 1 real.
# A gate that cries wolf gets ignored, which is the failure mode this whole
# release cycle has been cleaning up after.
CONVENTIONAL = {
    "README.md", "SKILL.md", "AGENTS.md", "CHANGELOG.md", "LICENSE",
    "LICENSE.md", "CONTRIBUTING.md", "index.md", "SUMMARY.md", "TODO.md",
    "NOTICE", "RELEASE-NOTES.md",
}


# Known, explicitly-accepted findings, so the gate can be live without reddening
# `check.sh` on a defect that is not yet resolvable.
#
# This is a BASELINE, not a skip list: it names the exact pair and the reason, and
# any NEW duplicate fails. The temptation when adding a gate is to whitelist
# whatever it currently reports and move on -- which is precisely how
# "77 pre-existing drift items" became an unread alarm. So each entry must carry
# why it cannot be fixed now and what would resolve it.
#
# R36-14's entry was deleted 2026-09-07 when the product ruling resolved the
# pair (docs/guides/ is the single authority; audit Premium+Enterprise,
# white-label Enterprise-only) and the losing copy was removed. The gate is
# live with an empty baseline.
BASELINE: dict[tuple[str, ...], str] = {}


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=str(ROOT),
                         shell=(sys.platform == "win32"),
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"git ls-files failed: {out.stderr[:200]}")
    return [f for f in out.stdout.splitlines() if f.strip()]


def head_claims(path: Path) -> bool:
    """True if the file's opening lines claim exclusivity."""
    try:
        with io.open(path, encoding="utf-8", errors="replace") as fh:
            head = "".join(fh.readline() for _ in range(HEAD_LINES))
    except OSError:
        return False
    return bool(AUTHORITY.search(head))


def scan(root: Path) -> list[str]:
    problems: list[str] = []
    baselined: list[str] = []
    by_name: dict[str, list[str]] = defaultdict(list)
    for f in tracked_files():
        # Test the RAW path from `git ls-files`, which is always forward-slash.
        # `str(Path(f))` rewrites it to backslashes on Windows, so
        # startswith("docs/") silently returned False for every file and the
        # whole gate passed on a repo with a known live defect -- the exact
        # shape of bug this script exists to catch, reproduced in the catcher.
        if not f.startswith(SCOPE_PREFIXES):
            continue
        p = Path(f)
        if p.name in CONVENTIONAL:
            continue
        if p.suffix.lower() in DOC_SUFFIXES:
            by_name[p.name].append(f)

    for name, paths in sorted(by_name.items()):
        if len(paths) < 2:
            continue
        abs_paths = [root / p for p in paths]
        try:
            blobs = {p.read_bytes() for p in abs_paths}
        except OSError as e:
            problems.append(f"{name}: unreadable duplicate ({e})")
            continue

        identical = len(blobs) == 1
        claiming = [p for p, a in zip(paths, abs_paths) if head_claims(a)]

        # An archive copy is a deliberate duplicate: `docs/archived/` exists to
        # hold the previous version of a live document, so exactly one copy
        # claiming authority is the POINT. Exempt that pairing -- but only that
        # one. If two ARCHIVED copies both claim authority, or an archive and a
        # live doc both do, that is still the bug being hunted.
        archived = [p for p in paths if "/archived/" in p or p.startswith("docs/archived/")]
        live = [p for p in paths if p not in archived]
        if len(archived) >= 1 and len(claiming) <= 1 and not identical:
            continue
        if len(archived) >= 1 and len(live) >= 1 and len(claiming) >= 2:
            problems.append(
                f"CONFLICTING AUTHORITY: {name} at {claiming} -- an archived copy "
                f"and a live copy both claim to be THE source of truth. Mark the "
                f"archive copy as historical in its first lines.")
            continue

        if identical:
            problems.append(
                f"DUPLICATE (identical): {name} exists at {paths} -- "
                f"byte-identical, so one is redundant and both need updating")
            continue

        if len(claiming) >= 2:
            deltas = []
            lines = [a.read_text(encoding="utf-8", errors="replace").splitlines()
                     for a in abs_paths]
            if len(lines) == 2:
                only_a = set(lines[0]) - set(lines[1])
                only_b = set(lines[1]) - set(lines[0])
                deltas = [len(only_a), len(only_b)]
            detail = (f" ({deltas[0]} line(s) unique to the first, "
                      f"{deltas[1]} to the second)") if deltas else ""
            msg = (
                f"CONFLICTING AUTHORITY: {name} at {claiming} -- both claim to be "
                f"THE source of truth but their content differs{detail}. One must "
                f"be marked superseded or deleted; two contradictory answers to a "
                f"customer-facing question is a business defect.")
            key = (name, *sorted(claiming))
            why = BASELINE.get(key) or BASELINE.get(tuple(sorted(key)))
            if why:
                baselined.append(f"{name}: {why[:80]}...")
            else:
                problems.append(msg)
        elif len(claiming) == 1:
            # One copy claims authority, the other does not. That is FINE if the
            # non-claiming copy says so out loud -- "archived snapshot", "not
            # maintained". Only flag it when the second copy is silent about its
            # status, because then a reader cannot tell which is which.
            others = [p for p in paths if p not in claiming]
            disclaiming = [p for p in others
                           if DISCLAIMER.search((root / p).read_text(
                               encoding="utf-8", errors="replace"))]
            if len(disclaiming) == len(others) and others:
                continue
            problems.append(
                f"DUPLICATE (one authoritative): {name} at {paths}; only "
                f"{claiming[0]} claims authority"
                + (f", and {sorted(set(others) - set(disclaiming))} says nothing "
                   f"about being superseded" if others != disclaiming else "")
                + ". Mark the non-authoritative copy as historical in its first "
                  "lines so a reader can tell them apart.")
    scan.baselined = baselined  # type: ignore[attr-defined]
    return problems


def self_test() -> int:
    """Prove the detector fires, using a throwaway git index."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        subprocess.run(["git", "init", "-q"], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)
        (tmp / "docs" / "guides").mkdir(parents=True)
        (tmp / "docs" / "records").mkdir(parents=True)
        io.open(tmp / "docs" / "guides" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers\n\n> Status: FINAL. Single source of truth for pricing.\n"
            "| white-label | yes | yes |\n")
        io.open(tmp / "docs" / "records" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers\n\n> Status: FINAL. Single source of truth for pricing.\n"
            "| white-label | no | yes |\n")
        subprocess.run(["git", "add", "."], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)

        global ROOT  # noqa: PLW0603
        saved = ROOT
        try:
            ROOT = tmp
            found = scan(tmp)
        finally:
            ROOT = saved

        hits = [p for p in found if p.startswith("CONFLICTING AUTHORITY")]
        if not hits:
            print("  MISSED! two files both claiming single-source-of-truth "
                  "were not detected")
            return 1
        print(f"  CAUGHT  conflicting-authority duplicate ({len(hits)} finding(s))")
        print(f"          {hits[0][:100]}")

        # And confirm it does NOT fire when one copy disclaims authority.
        io.open(tmp / "docs" / "records" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers (archived snapshot, 2026-08-17)\n\n"
            "Historical copy. Not maintained.\n| white-label | no | yes |\n")
        subprocess.run(["git", "add", "."], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)
        ROOT = tmp
        try:
            found2 = scan(tmp)
        finally:
            ROOT = saved
        if [p for p in found2 if p.startswith("CONFLICTING AUTHORITY")]:
            print("  MISSED! still fires when one copy disclaims authority "
                  "-- too noisy to be a blocking gate")
            return 1
        print("  CORRECT does not fire once one copy disclaims authority")
    print("  self-test: both directions behave")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    problems = scan(ROOT)
    bl = getattr(scan, "baselined", [])
    if bl:
        print(f"  {len(bl)} baselined duplicate(s) -- known, unresolved, "
              f"NOT new findings:")
        for b in bl:
            print(f"    ~ {b}")
        print("    A baseline entry must be deleted once its duplicate is "
              "resolved; leaving it in place re-silences the gate.")
        print()
    if problems:
        print(f"verify-doc-uniqueness: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("verify-doc-uniqueness: no duplicate authoritative documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
