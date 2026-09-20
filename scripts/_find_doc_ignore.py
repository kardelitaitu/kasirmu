"""Find all ```ignore blocks in Rust source files, with context.

Why a walk and not a hand-list
------------------------------
This script used to carry a hardcoded list of 22 files. By 2026-09-20 that
list had rotted to 3 live entries, 18 that exist but contain no ```ignore
block at all, and one (`platform/kernel/src/kernel.rs`) that was deleted
when dc5e332ad split it into a `kernel/` directory. A hand-list must be
edited on every rename or split, and nothing fails loudly when it is not —
the script just quietly stops covering the moved file. Walking the source
roots removes that failure mode entirely.
"""
import os

# Repo root = parent of scripts/, resolved from this file's location, so the
# script finds its targets no matter which checkout/worktree CWD it runs from.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Rust source roots. A file outside these is not covered, so add a root here
# (never an individual file) if the layout gains one.
SOURCE_ROOTS = ('apps', 'crates', 'modules', 'platform')

MARKER = '```ignore'
SKIP_DIRS = {'target', 'node_modules', '.git'}


def rust_files():
    """Yield repo-relative paths of every `.rs` file under the source roots."""
    for root in SOURCE_ROOTS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, root)):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in sorted(filenames):
                if name.endswith('.rs'):
                    full = os.path.join(dirpath, name)
                    yield os.path.relpath(full, ROOT).replace(os.sep, '/')


hits = 0
for filepath in rust_files():
    full = os.path.join(ROOT, filepath)
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    for i, line in enumerate(lines, 1):
        if MARKER in line:
            hits += 1
            start = max(0, i-2)
            end = min(len(lines), i+5)
            print(f"=== {filepath}:{i} ===")
            for j in range(start, end):
                marker = ">>>>>" if j+1 == i else "     "
                print(f"{marker} {lines[j].rstrip()}")
            print()

print(f"{hits} ```ignore block(s) across {len(SOURCE_ROOTS)} source roots.")
