#!/usr/bin/env python3
"""
scripts/dedupe-ftl.py — Deduplicates Fluent (.ftl) key definitions in
`shared-ui/locales/`.

WHY
====

The consolidated i18n quality gate (invoked via `scripts/lint-i18n.sh` by
`.github/workflows/dev-ci.yml`; the `ci.yml` named here until 2026-09-20 is
retired to `.github/workflows/attic/ci.yml.bak`, and `release.yml` never ran
this gate)
flags any key that is defined twice within the same locale's joined
bundle. FluentBundle.addResource() emits `Attempt to override an
existing message` when the second definition arrives, and the FIRST
defined value silently wins. That is a real internationalization bug:
the duplicate key may exist because someone copy-pasted from the
canonical home file but the value drifts over time.

THE FIX
=======

For every key across the 48 .ftl + .id.ftl files in `shared-ui/locales/`,
keep only the FIRST definition and drop every subsequent one (along
with its multi-line value continuations, attribute continuations, and
trailing blank-line paragraph separator). This guarantees:

  * Each key resolves to exactly one value (the first-wins semantic
    that FluentBundle was already running).
  * The gate's "Fluent key duplicates" check goes red → green as keys
    are consolidated into their canonical home file.

ALGORITHM
==========

Process the file line-by-line, but treat message *blocks* (not lines)
as the unit of dedupe:

  * A new block starts at a zero-indent line that is either a key
    definition (`keyName = ...`), a term (`-brand-name = ...`), or a
    comment (`# ...`).
  * Anything else (indented continuation, blank line, attribute
    `.attr = ...`) belongs to the previous block.

For each block, if its key has already been seen, drop the entire
block. Otherwise keep `lines[i:j]` where `j` is one past the last
continuation line in the block.

USAGE
=====

    python3 scripts/dedupe-ftl.py            # apply in place; prints a summary
    python3 scripts/dedupe-ftl.py --dry-run  # report what would change without writing

EXIT CODES
==========

  * 0  files are already clean (no duplicates) OR dedupe completed.
  * 1  a runtime error occurred (locales dir missing, no .ftl files, etc.)

LIMITATIONS
===========

  * Fluent `[[ Section ]]` group markers at column 0 are NOT recognized
    as block boundaries here. None exist in this repo today, but if you
    introduce them, this script will misbehave: a section header line
    will be treated as continuation of the previous block. Update
    `BOUNDARY_PATTERN` to match the marker before relying on
    section-grouped .ftl files.
"""

import argparse
import re
import sys
from pathlib import Path

LOCALE_DIR = Path(__file__).resolve().parent.parent / "shared-ui" / "locales"

DESCRIPTION = (
    "Deduplicate Fluent key definitions in shared-ui/locales/ so that the "
    "consolidated i18n quality gate (scripts/lint-i18n.sh, run by "
    ".github/workflows/dev-ci.yml) finds zero "
    "'Attempt to override an existing message' warnings. See the module "
    "docstring for the algorithm and rationale."
)

# Match a top-level Fluent key OR term OR `#` comment at column 0.
# Terms start with `-` (e.g. `-brand-name = ...`). Keys follow the
# Fluent identifier grammar: ASCII letters/digits/hyphens/underscores,
# starting with a letter or hyphen.
KEY_PATTERN = re.compile(r"^([-a-zA-Z][a-zA-Z0-9_-]*)\s*=")

# Boundary between message blocks. Any of these at column 0 starts a
# new block; anything else is part of the current block.
BOUNDARY_PATTERN = re.compile(r"^([-a-zA-Z][a-zA-Z0-9_-]*\s*=|#)")


def process_file(path: Path, *, write: bool) -> tuple[int, int]:
    """Return (lines_before, lines_after) for one .ftl file.

    When ``write`` is True, persist the deduped content back to disk
    IFF it differs from the original. When False, run is read-only and
    useful for --dry-run reporting.
    """
    original = path.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)

    seen_keys: set[str] = set()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = KEY_PATTERN.match(line)
        if m:
            key = m.group(1)
            # Walk forward to the start of the next block.
            j = i + 1
            while j < len(lines) and not BOUNDARY_PATTERN.match(lines[j]):
                j += 1
            if key in seen_keys:
                # Drop the duplicate block entirely.
                pass
            else:
                seen_keys.add(key)
                out.extend(lines[i:j])
            i = j
        else:
            # Standalone comment, blank line, or non-key block start.
            # Preserve as-is.
            out.append(line)
            i += 1

    new_content = "".join(out)
    if write and new_content != original:
        path.write_text(new_content, encoding="utf-8")
    return len(lines), len(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be removed without writing any files.",
    )
    args = parser.parse_args()

    if not LOCALE_DIR.is_dir():
        print(f"error: locales dir not found: {LOCALE_DIR}", file=sys.stderr)
        return 1

    files = sorted(
        list(LOCALE_DIR.glob("*.ftl")) + list(LOCALE_DIR.glob("*.id.ftl"))
    )
    if not files:
        print(f"error: no .ftl files under {LOCALE_DIR}", file=sys.stderr)
        return 1

    write = not args.dry_run
    changed: list[tuple[str, int, int]] = []
    for path in files:
        before, after = process_file(path, write=write)
        if before != after:
            changed.append((path.name, before, after))

    if not changed:
        print("dedupe-ftl: no duplicates found in any .ftl file.")
        return 0

    print(
        f"dedupe-ftl: {'would dedupe' if args.dry_run else 'deduped'} "
        f"{len(changed)} file(s)"
    )
    for name, before, after in changed:
        print(f"  {name}: {before} -> {after} lines ({before - after} removed)")
    # In --dry-run mode, exit non-zero whenever there is real work to
    # do so callers (pre-commit, CI) can gate on `$?` without coupling
    # to the exact wording of the diagnostic above. In apply mode,
    # successful rewrite is exit 0 regardless of how many files
    # changed.
    return 1 if args.dry_run else 0


if __name__ == "__main__":
    sys.exit(main())
