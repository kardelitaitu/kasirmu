#!/usr/bin/env python3
"""verify-runner-commands.py -- every script a runner names must actually exist.

WHY
===
A CI step that invokes a script which has been deleted or renamed does not fail
with a useful message. Depending on the shell it is a "file not found" from step 40
of 200, or -- worse on a path-gated job -- a step that simply never runs, which is
indistinguishable from a step nobody wrote. The same is true of a check.sh entry.
Nothing else in the tree can see this: the docs gates read the checkers, and the
checker gates run the checkers, but no gate asks whether the RUNNERS still point at
files that are there.

Measured 2026-09-29 when this was written: 230 script invocations across the three
runners (94 DISTINCT paths -- several checkers are invoked by more than one runner),
zero dangling. The surface is the point: a rename that updates scripts/ but not
check.sh, check.ps1 or the workflows is the failure this exists to catch. Repeats are
counted, not deduplicated, because three invocations of one script in a workflow are
three places that must each be updated.

WHAT IS AND IS NOT COVERED
==========================
Both command spellings, because the runners do not agree: .github/workflows and
check.sh write `python3 scripts/x.py`, while check.ps -- the PowerShell twin --
writes `$pythonCommand scripts/x.py`. An earlier throwaway probe of this idea
matched only the first and reported check.ps1 as referencing NOTHING, which read as
a finding and was a defect in the probe. The twin is in scope for that reason.

Retired workflows under .github/workflows/attic/ are NOT covered: a .bak is never
executed, so a dangling reference in one affects nothing. Same rule
verify-ci-docs-drift applies when it scopes a claim to a live workflow.

Exit 0 every reference resolves, 1 at least one does not, 2 no references found.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
# The live-workflow rule is shared; see scripts/_live_workflows.py. Only the WORKFLOWS
# entry below is covered by it -- the other two are files, not a directory, and keep
# their own handling.
RUNNERS = (
    ROOT / ".github" / "workflows",
    ROOT / "scripts" / "check.sh",
    ROOT / "scripts" / "check.ps1",
    # The pre-commit hook too, and not because it invokes checkers: it does not. It
    # carries a user-facing error string telling a developer to run
    # "python3 scripts/generate-pg-migration.py", and that guidance goes stale on a
    # rename exactly like a step does. A runner list is a list of places a reader is
    # told to run something, not a list of places a program is executed.
    ROOT / ".githooks" / "pre-commit",
)
# The interpreter token varies by runner: literal python3/node/bash in the shell and
# the workflows, $pythonCommand/$npmCommand in the PowerShell twin.
#
# NOT EVERY LIST HERE IS A SMELL, and the distinction was checked rather than assumed.
# The VENDORED directory list in verify-shell-syntax was a smell and was replaced by
# `git ls-files`: directory names are an OPEN vocabulary and a snapshot of one goes
# stale silently. Interpreter names are a CLOSED vocabulary -- there are only so many
# ways to ask a machine to run a file -- so an explicit list is the honest
# representation, and being wrong about it fails loudly (a missed token reports nothing)
# rather than quietly. Verified against the tree 2026-09-29: the only leading tokens on
# "run: ... scripts/" lines are python3 (56), bash (18), node (11), python (3) and sh (1),
# all covered; no npx, pnpm, deno, bun or cargo form names a scripts/ path anywhere.
COMMAND_RE = re.compile(
    r"(?:python3|python|node|bash|sh|\$pythonCommand|\$npmCommand)"
    r"\s+(?:-[A-Za-z-]+\s+)*"          # flags such as --silent
    r"(scripts/[A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
)


def live_runner_files() -> list[Path]:
    out: list[Path] = []
    for r in RUNNERS:
        if r.is_dir():
            for p in sorted(r.rglob("*.yml")) + sorted(r.rglob("*.yaml")):
                if "attic" in {q.lower() for q in p.parts}:
                    continue          # retired; never executed
                out.append(p)
        elif r.is_file():
            out.append(r)
    return out


#: A shell line comment. A command inside one is DOCUMENTATION, not execution.
SHELL_COMMENT_RE = re.compile(r"(?:^|\s)#")


def _in_shell_comment(text: str, pos: int) -> bool:
    """True when pos sits to the right of a #, on its own line.

    A runner comments routinely quote the command they are explaining. check.sh's
    website-link-checker step says that CI runs the checker WITHOUT --self-test and
    names the command in prose, while the real path is website/scripts/. That sentence
    is a reader's note, not a step, and grading it reported a correctly-moved checker
    as a missing file (2026-10-23, found by wiring a sibling self-test).
    """
    line_start = text.rfind("\n", 0, pos) + 1
    return bool(SHELL_COMMENT_RE.search(text[line_start:pos]))


def references(text: str) -> list[str]:
    """Every scripts/... path a runner names IN A COMMAND, in order, repeats kept."""
    return [m.group(1) for m in COMMAND_RE.finditer(text)
            if not _in_shell_comment(text, m.start())]


def dangling(files: list[Path]) -> tuple[list[tuple[str, str]], int]:
    bad: list[tuple[str, str]] = []
    seen = 0
    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            bad.append((p.name, f"unreadable: {exc}"))
            continue
        for ref in references(text):
            seen += 1
            if not (ROOT / ref).exists():
                bad.append((p.name, ref))
    return bad, seen


def self_test() -> int:
    """Synthetic runner text only. No file is created, read or written."""
    bad: list[str] = []

    # The POSIX spelling used by check.sh and the workflows.
    want = ["scripts/a.py"]
    got = references("      run: python3 scripts/a.py")
    if got != want:
        bad.append(f"python3 form: expected {want!r}, got {got!r}")

    # The PowerShell twin's spelling. This is the case the throwaway probe missed.
    want = ["scripts/b.py"]
    got = references('Step -Name "x" -RetryCommand "$pythonCommand scripts/b.py"')
    if got != want:
        bad.append(f"$pythonCommand form: expected {want!r}, got {got!r}")

    # A flag between interpreter and path must not defeat the match.
    want = ["scripts/c.mjs"]
    got = references("node --test scripts/c.mjs")
    if got != want:
        bad.append(f"flagged form: expected {want!r}, got {got!r}")

    # And the rule must FIRE, not merely parse: this is the whole gate.
    if references("run: python3 scripts/gone.py") != ["scripts/gone.py"]:
        bad.append("a reference to a missing script must still be parsed as a reference")
    if references("run: python3 apps/foo/src/main.rs") != []:
        bad.append("a non-scripts path must not be reported as a runner reference")

    # A command quoted in a COMMENT is documentation, not a step. This is the exact
    # shape check.sh carries: the prose names the command, the step names the real path.
    if references("# CI runs node scripts/check-links.mjs without the flag") != []:
        bad.append("a command inside a # comment is documentation, not a runner step")
    # ...and the real step on the next line must still be parsed, or the gate goes deaf.
    if references("      node scripts/check-links.mjs --self-test") != ["scripts/check-links.mjs"]:
        bad.append("a real step must still be parsed as a reference")

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (7 cases, no files touched)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    files = live_runner_files()
    bad, seen = dangling(files)

    if seen == 0:
        # A gate that found nothing must never read as a gate that found nothing --
        # the same rule the shell and workflow syntax gates follow.
        print("verify-runner-commands: found NO script references in any runner."
              " Refusing to report clean: this is a broken pattern, not a clean tree.",
              file=sys.stderr)
        return 2

    for where, ref in bad:
        print(f"verify-runner-commands: {where} names {ref}, which does not exist.")
    if bad:
        print("verify-runner-commands: a runner naming a file that is not there either"
              " errors mid-job or, on a path-gated step, silently never runs. Both look"
              " like a green that stopped checking.")
        return 1
    print(f"verify-runner-commands: OK — {seen} script reference(s) across "
          f"{len(files)} runner file(s) all resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
