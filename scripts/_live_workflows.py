"""_live_workflows.py -- ONE definition of "what GitHub will actually execute".

WHY THIS FILE EXISTS
====================
On 2026-09-29 an audit of the gate suite found SIX separate implementations of the same
question across six checkers, and three of the six disagreed with the other three: they
globbed *.yml alone, so a .yaml workflow would have been checked by half the suite and
silently ignored by the rest. All six were aligned that day. Aligning them was the cheap
half; this file is the expensive half, and only the three gates this session authored
import it so far.

THE RULE, IN ONE PLACE
======================
GitHub executes any .yml or .yaml at the TOP LEVEL of .github/workflows/. Not a
subdirectory -- which is why .github/workflows/attic/ is excluded rather than
recursed into: a .bak there is a retired workflow, and treating a retired workflow as
live is how a deleted check reads as coverage to whoever greps for it.

If you are adding a seventh checker that needs the live workflow set, import this
rather than writing the glob again. Six copies is how the disagreement happened; a
seventh is how it comes back.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def live_workflow_files() -> list[Path]:
    """Every workflow GitHub will execute, sorted. Empty if the directory is absent."""
    if not WORKFLOWS.is_dir():
        return []
    return sorted(
        p for p in (list(WORKFLOWS.glob("*.yml")) + list(WORKFLOWS.glob("*.yaml")))
        if p.is_file()
    )


def live_workflow_names() -> set[str]:
    """Basenames of the live workflows -- the form a doc or a claim refers to."""
    return {p.name for p in live_workflow_files()}


def live_workflow_texts() -> list[tuple[Path, str]]:
    """(path, text) for each live workflow, for callers that read rather than list."""
    out: list[tuple[Path, str]] = []
    for p in live_workflow_files():
        try:
            out.append((p, p.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return out
