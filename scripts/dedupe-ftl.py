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
import pathlib
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


def main(argv=None, root=None) -> int:
    """r204: argv and root parameterized, the r166..r203 contract -- the
    locales directory is resolved under the contract root, so a fixture
    tree is graded instead of this checkout's shared-ui."""
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be removed without writing any files.",
    )
    args = parser.parse_args(argv)

    base = pathlib.Path(__file__).resolve().parent.parent if root is None else pathlib.Path(root).resolve()
    locale_dir = base / "shared-ui" / "locales"

    if not locale_dir.is_dir():
        print(f"error: locales dir not found: {locale_dir}", file=sys.stderr)
        return 1

    files = sorted(
        list(locale_dir.glob("*.ftl")) + list(locale_dir.glob("*.id.ftl"))
    )
    if not files:
        print(f"error: no .ftl files under {locale_dir}", file=sys.stderr)
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


def self_test() -> int:
    """r204: the shell -- main() graded through argv and a contract root, the
    r166..r203 pattern. The fixture is a throwaway shared-ui/locales tree;
    a root-dropping main reads THIS checkout's locales and finds no
    duplicates, which the first rung refuses."""
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    DUP = ("alpha = First\n"
           "    cont line\n"
           "beta = Second\n"
           "alpha = Dup\n"
           "    dup cont\n")
    def run(tdp, *argv):
        out, err = _io.StringIO(), _io.StringIO()
        try:
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=list(argv), root=tdp)
        except SystemExit as se:
            return se.code, out.getvalue() + err.getvalue()
        return rc, out.getvalue() + err.getvalue()
    def tree(content):
        tdp = Path(_tempfile.mkdtemp())
        loc = tdp / "shared-ui" / "locales"
        loc.mkdir(parents=True)
        (loc / "main.ftl").write_text(content, encoding="utf-8")
        return tdp, loc
    shell += 1
    tdp, _ = tree(DUP)
    rc, text = run(tdp, "--dry-run")
    if rc != 1 or "would dedupe 1 file(s)" not in text or "5 -> 3 lines" not in text:
        print("  x a duplicate key must be reported rc 1 in dry-run (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    tdp, _ = tree("alpha = Only\n")
    rc, text = run(tdp, "--dry-run")
    if rc != 0 or "no duplicates found in any .ftl file" not in text:
        print("  x a clean bundle must pass rc 0 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    tdp, loc = tree(DUP)
    rc, text = run(tdp)
    if rc != 0 or "deduped 1 file(s)" not in text:
        print("  x apply mode must dedupe and exit 0 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    # post-condition INSIDE the tempdir's tree: the duplicate and its
    # continuation are gone, the first-wins value stays
    back = (loc / "main.ftl").read_text(encoding="utf-8")
    if "alpha = Dup" in back or "dup cont" in back or "cont line" not in back:
        print("  x the deduped file must keep the first block only (back=%r)"
              % back[:80], file=sys.stderr)
        return 1
    shell += 1
    tdp = Path(_tempfile.mkdtemp())
    rc, text = run(tdp)
    if rc != 1 or "locales dir not found" not in text:
        print("  x a root without shared-ui/locales must refuse rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    tdp, loc2 = tree("alpha = x\n")
    for f in loc2.glob("*.ftl"):
        f.unlink()
    rc, text = run(tdp)
    if rc != 1 or "no .ftl files under" not in text:
        print("  x an empty locales dir must refuse rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1

    print("SELF-TEST OK (%d shell cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else main())
