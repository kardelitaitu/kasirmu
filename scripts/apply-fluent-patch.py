#!/usr/bin/env python3
"""Apply an exact, asserted set of Fluent replacements to one file.

Every rule declares how many times its `old` text MUST appear; anything
else aborts the whole file with no write. This makes bulk i18n edits
reviewable: a silent miss (pattern drifted) and a silent over-match
(pattern too loose) both fail loudly instead of half-editing a screen.

Usage: python apply_i18n_patch.py <rules.json>
Rules: [{"file": "...", "rules": [{"old","new","count"}], "expect_absent": ["..."]}]
Paths are repo-relative and use forward slashes.
"""
# Promoted from the 2026-09-03 Fluent page audit; see
# docs/records/audits/frontend/fluent-page-audit.md for why this check exists.

from __future__ import annotations

import json
import sys
from pathlib import Path

# Repo root, script-relative (see AGENTS.md: never anchor to a
# hardcoded checkout). Pass a path to override.
ROOT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parents[1]
spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

failures: list[str] = []
planned: list[tuple[Path, str]] = []

# Pass 1 — compute every result and validate, writing NOTHING. An
# all-or-nothing run matters for a bulk i18n edit: a half-applied patch
# leaves a screen with new keys referenced by only some of its call sites.
for target in spec:
    path = ROOT / target["file"]
    src = path.read_text(encoding="utf-8")
    original = src
    for rule in target["rules"]:
        old, new, want = rule["old"], rule["new"], rule["count"]
        got = src.count(old)
        if got != want:
            failures.append(
                f"{target['file']}: expected {want} occurrence(s) of "
                f"{old[:70]!r}, found {got}"
            )
            continue
        src = src.replace(old, new)
    # Note: an expect_absent string that legitimately survives as a
    # <Localized> fallback child is a bad assertion, not a bad patch.
    for absent in target.get("expect_absent", []):
        if absent in src:
            failures.append(
                f"{target['file']}: {absent!r} still present after patch"
            )
    if src != original:
        planned.append((path, src))

if failures:
    print("ABORTED — nothing written for ANY target:", file=sys.stderr)
    for f in failures:
        print("  " + f, file=sys.stderr)
    sys.exit(1)

# Pass 2 — all checks passed; write.
for path, src in planned:
    # Write LF explicitly: the repo normalizes to LF, and letting
    # Python emit platform newlines makes git status show a phantom
    # modification after every commit.
    path.write_bytes(src.replace("\r\n", "\n").encode("utf-8"))
    print(f"patched {path.relative_to(ROOT).as_posix()}")

if not planned:
    print("no-op: nothing to write")
