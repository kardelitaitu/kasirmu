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

WHEN NOT TO USE IT
==================
verify-agents-mirrors.py deliberately does NOT import this, and its three workflow globs
are correct as written. Its contract is different: `def live_workflows(root: Path)` takes
the root as a PARAMETER, so the same code serves both the real repository and the
throwaway fixtures its self-test builds. This module's contract is "this repository's
workflows" and has no parameter to redirect.

That makes the parameterised version the BETTER design, not the worse one -- it is
testable against a fixture. Swapping it for a fixed-root helper would have made the
self-test count the real repository's workflows instead of its own, and the count it
asserts would still have passed, because the real repository also has four.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def live_workflow_files(workflows: Path | None = None) -> list[Path]:
    """Every workflow GitHub will execute, sorted. Empty if the directory is absent.

    `workflows` defaults to this repository's own .github/workflows; passing a
    directory redirects the rule at a fixture root. r166: drift's main() now
    takes root= and MUST redirect -- without it a root-overridden run silently
    counted the real repository's workflows while checking the fixture's docs.
    The module header used to say this contract had "no parameter to redirect";
    verify-agents-mirrors.py's live_workflows(root) was always the better
    design, and this module now matches it.
    """
    wf = WORKFLOWS if workflows is None else Path(workflows)
    if not wf.is_dir():
        return []
    return sorted(
        p for p in (list(wf.glob("*.yml")) + list(wf.glob("*.yaml")))
        if p.is_file()
    )


def live_workflow_names(workflows: Path | None = None) -> set[str]:
    """Basenames of the live workflows -- the form a doc or a claim refers to."""
    return {p.name for p in live_workflow_files(workflows)}


def live_workflow_texts(workflows: Path | None = None) -> list[tuple[Path, str]]:
    """(path, text) for each live workflow, for callers that read rather than list."""
    out: list[tuple[Path, str]] = []
    for p in live_workflow_files(workflows):
        try:
            out.append((p, p.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return out


def self_test() -> list[str]:
    """The rule, graded directly against a tempdir (r168 -- until now the module
    was graded only through its importers). The original 2026-09-29 defect was
    the .yaml half-disagreement, so the table pins BOTH extensions, the attic
    exclusion, the top-level rule, and the is_file filter. Returns failure
    descriptions; [] = every case held. Invoked by verify-ci-docs-drift's
    self-test -- a data module has no runner of its own, and an uninvoked
    self-test is exactly the rot the wired census exists to catch."""
    import tempfile
    fails: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        wf = Path(td) / "workflows"
        (wf / "attic").mkdir(parents=True)
        (wf / "subdir").mkdir()
        for name in ("a.yml", "b.yaml", "c.yml.bak", "attic/d.yml",
                     "attic/e.yml.bak", "subdir/f.yml"):
            (wf / name).write_text("on: push\n", encoding="utf-8")
        (wf / "g.yaml").mkdir()  # a DIRECTORY named *.yaml is not a workflow
        got = [p.name for p in live_workflow_files(wf)]
        if got != ["a.yml", "b.yaml"]:
            fails.append("live set wrong: %r" % (got,))
        if live_workflow_names(wf) != {"a.yml", "b.yaml"}:
            fails.append("names wrong: %r" % (sorted(live_workflow_names(wf)),))
        texts = live_workflow_texts(wf)
        if sorted(p.name for p, _ in texts) != ["a.yml", "b.yaml"] or any(
                "on: push" not in t for _, t in texts):
            fails.append("texts wrong: %r" % ([(p.name, len(t)) for p, t in texts],))
        empty = Path(td) / "empty"
        empty.mkdir()
        if live_workflow_files(empty) != []:
            fails.append("an empty dir must yield []")
        if live_workflow_files(Path(td) / "absent") != []:
            fails.append("an absent dir must yield []")
    return fails
