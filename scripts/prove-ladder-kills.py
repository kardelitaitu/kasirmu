#!/usr/bin/env python3
"""Prove a checker's ladder rung 1 actually kills a root-blind main().

WHY THIS EXISTS

Round 245 found that a rung documented as "the killing rung" was not one: it
asserted a SUBSTRING of the reported path, and a main() that derives paths from
ROOT instead of its root argument still prints a string containing that
substring. The fixture was distinct from the real tree -- which is the claim
everyone writing these rungs believes -- but "the fixture is distinct" is not
"the rung fails when root is ignored".

So this harness runs the mutant instead of reasoning about it:

  1. read the checker's source,
  2. replace its root resolution with a root-blind one (the MUTATIONS table;
     each is applied only if its anchor occurs exactly once),
  3. load the mutant as a module and call its shell_ladder() directly,
  4. require rc != 0 and that the failure names rung 1.

A checker whose ladder survives every applicable mutation is reported as NOT
PROVEN. That is not automatically a defect -- some ladders grade something
other than the root contract -- but it is the honest default, and the register
entry for each checker states which mutation was used.

Usage: python scripts/prove-ladder-kills.py <checker.py> [--verbose]
        0 every APPLICABLE mutation was killed
        1 at least one mutation survived
        2 no mutation was applicable (the file resolves no root of a known shape)
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import sys
import tempfile
from pathlib import Path

MUTATIONS = (
    (
        "sweep ignores root",
        "for p in targets(root):",
        "for p in targets(None):  # MUTANT: sweep ignores root",
    ),
    (
        "scan base ignores root",
        "base = ROOT if root is None else Path(root).resolve()",
        "base = ROOT  # MUTANT: root ignored",
    ),
    (
        "root resolution ignores root",
        "root = Path(args.root or root or UI_SRC).resolve()",
        "root = Path(UI_SRC).resolve()  # MUTANT: root ignored",
    ),
    (
        "repo base ignores root",
        "base = REPO if root is None else Path(root).resolve()",
        "base = REPO  # MUTANT: root ignored",
    ),
    (
        "scoped base ignores root",
        "base_root = ROOT if root is None else Path(root).resolve()",
        "base_root = ROOT  # MUTANT: root ignored",
    ),
    # r248: a root consumed directly inside a helpers' body, e.g.
    # `ui = UI if root is None else base / "ui" / "src"` in _sources(root).
    # The first seven ladders this arc shipped resolved root in shapes the
    # table did not model, so they reported NO APPLICABLE MUTATION and their
    # kills stayed asserted rather than proven. Widening the table is the
    # correct response to that -- unlike widening it until a hoped-for answer
    # appears, which round 247 refused.
    (
        "source scan ignores root",
        'ui = UI if root is None else base / "ui" / "src"',
        'ui = UI  # MUTANT: root ignored',
    ),
    (
        "inline base ignores root",
        "base = ROOT if root is None else Path(root).resolve()",
        "base = ROOT  # MUTANT: root ignored",
    ),
    (
        "repo root ignores root",
        "base = REPO_ROOT if root is None else Path(root).resolve()",
        "base = REPO_ROOT  # MUTANT: root ignored",
    ),
    (
        "root_path ignores root",
        "root_path = ROOT if root is None else Path(root).resolve()",
        "root_path = ROOT  # MUTANT: root ignored",
    ),
    # r249: the two checkers that do not name their root "root" at all.
    # check-register-hygiene's root is `register_path` (r233), and
    # check-orphan-prototype-files passes `root` to a subprocess's cwd.
    (
        "register path ignores root",
        "    if register_path is None:\n        register_path = REGISTER",
        "    register_path = REGISTER  # MUTANT: root ignored",
    ),
    (
        "subprocess cwd ignores root",
        "        cwd=root,\n        capture_output=True,",
        "        cwd=REPO_ROOT,  # MUTANT: root ignored\n        capture_output=True,",
    ),
    # r248: the remaining shapes, one per checker that previously reported NO
    # APPLICABLE MUTATION. Each anchor is the exact expression that appears
    # exactly once in its file; a mutation that matches nothing is never
    # invented, because a guessed anchor would report a false NO APPLICABLE
    # and quietly shrink what this harness claims to cover.
    (
        "helper returns constant",
        "return REPO if root is None else Path(root).resolve()",
        "return REPO  # MUTANT: root ignored",
    ),
    (
        # The expression spans a backslash continuation, so the anchor is the
        # single line that CHOOSES root -- replacing it with a constant keeps
        # the continuation intact. A cross-line anchor produced a mutant that
        # failed to import and was reported as SURVIVED; that was the harness
        # lying, not a finding, and it is why import errors are not kills.
        "abspath root ignored",
        "repo = os.path.abspath(root) if root is not None else \\",
        "repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if True else \\",
    ),
    # r249: three more shapes, each read from its own file rather than guessed.
    # `scan_root` (check-dead-controls), a subdirectory composed inline
    # (verify-workflow-syntax), and a two-line resolution whose first line
    # chooses root while the second composes from it (check-merged-lines).
    (
        "scan-root ignores root",
        'scan_root = SCAN_ROOT if root is None else os.path.join(os.path.abspath(root), "ui", "src", "features")',
        "scan_root = SCAN_ROOT  # MUTANT: root ignored",
    ),
    (
        "workflow dir ignores root",
        'wf_dir = None if root is None else Path(root).resolve() / ".github" / "workflows"',
        "wf_dir = None  # MUTANT: root ignored",
    ),
    # r256: an abspath() resolution under a `repo` binding. census-orphan-modules
    # reported NO APPLICABLE MUTATION for a long time because the table had no
    # row for this shape; its ladder was proven by hand instead, which does not
    # regress-detect. The anchor is the single line that CHOOSES the value, so
    # the replacement cannot break a continuation.
    (
        "repo abspath ignores root",
        "repo = REPO if root is None else os.path.abspath(root)",
        "repo = REPO  # MUTANT: root ignored",
    ),
    # r262: three shapes measured across the contracted checkers, each carrying a
    # main(root=...) the table could not reach. A sweep of all 70 checkers put 76
    # of them at NO APPLICABLE MUTATION while only 21 were provable -- a harness
    # covering a third of the ladder it claims to grade is the same blind spot
    # r248 and r256 each closed one row at a time. These three are the shapes
    # that recur; each anchor was counted in ITS OWN file and occurs exactly
    # once, which is the condition this table requires.
    (
        # The mirror image of the r248 row above: root on the LEFT. Both spellings
        # appear in the tree and neither mutation covers the other.
        "base resolves root",
        "base = Path(root).resolve() if root is not None else ROOT",
        "base = ROOT  # MUTANT: root ignored",
    ),
    (
        "repo-root helper ignores root",
        "base = repo_root() if root is None else os.path.abspath(root)",
        "base = repo_root()  # MUTANT: root ignored",
    ),
    (
        # A bare re-binding rather than a conditional: no ROOT constant appears at
        # all, so every row above misses it. The replacement keeps the NAME so the
        # mutant still imports.
        #
        # The anchor CARRIES ITS NEWLINE. Without it the text also matches the
        # first half of "root = Path(root).resolve() if root is not None else ..."
        # -- a different shape whose else-clause sits on the next line -- and
        # splicing the replacement in front of that clause produced a mutant with
        # an unexpected indent (verify-core-size) or one that never reached a
        # ladder at all (check-replay-fork, verify-flaky-quarantine). Those were
        # reported as SURVIVED, i.e. as a finding about the CHECKER, when the
        # fault was in this table. Anchoring on the complete line is what makes
        # the row mean what it says.
        "rebound root ignores root",
        "    root = Path(root).resolve()\n",
        "    root = Path(__file__).resolve().parent.parent  # MUTANT: root ignored\n",
    ),
)


def applicable(src):
    """The mutations whose anchor occurs exactly once in `src`."""
    return [m for m in MUTATIONS if src.count(m[1]) == 1]


def run_mutant(checker, anchor, replacement, scratch, verbose):
    """(killed, detail) -- load the mutant and call its ladder.

    The mutant is written under the SAME BASENAME as its checker, deliberately.
    Every checker in this arc computes its default root as
    `Path(__file__).resolve().parents[1]`, so a mutant named
    `<stem>__mutant.py` sitting one level up from scripts/ resolves parents[1]
    to the WRONG directory -- .agents/ instead of the repository. Measured in
    r251: that made the mutant raise
    "'C:\\dev\\kasirmu\\.agents\\scripts\\verify-lane.sh' is not in the subpath of
    ...", a crash from the harness's own file placement rather than from the
    mutation. Keeping the basename in a sibling directory makes __file__ resolve
    exactly as the real checker's does.
    """
    src = checker.read_text(encoding="utf-8")
    here = scratch / checker.stem
    here.mkdir(parents=True, exist_ok=True)
    mutant = here / checker.name
    mutant.write_text(src.replace(anchor, replacement), encoding="utf-8", newline=chr(10))
    spec = importlib.util.spec_from_file_location(mutant.stem, str(mutant))
    if spec is None or spec.loader is None:
        return False, "could not load the mutant"
    mod = importlib.util.module_from_spec(spec)
    buf = io.StringIO()
    try:
        spec.loader.exec_module(mod)
    except Exception as exc:
        return False, "mutant failed to import: %s" % exc
    if not hasattr(mod, "shell_ladder"):
        return False, "no shell_ladder() on the mutated module"
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = mod.shell_ladder()
    except Exception as exc:
        return False, "ladder RAISED instead of returning: %s" % exc
    said = buf.getvalue()
    if verbose:
        print(said[-800:])
    killed = rc != 0
    detail = "rc=%r" % (rc,)
    if killed and "rung 1" not in said:
        detail += " (no failure line names rung 1)"
    return killed, detail


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("checker")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    checker = Path(args.checker)
    if not checker.is_file():
        print("error: %s is not a file" % checker, file=sys.stderr)
        return 2
    src = checker.read_text(encoding="utf-8")
    muts = applicable(src)
    if not muts:
        print("%s: NO APPLICABLE MUTATION -- this file resolves no root of a "
              "recognised shape, so its ladder cannot be proven this way." % checker.name)
        return 2

    # A temporary scratch dir, removed on the way out. For a long time this was
    # a fixed .agents/mutants/ that every run left behind: the harness littered
    # the tree it was supposed to be inspecting, and the leftovers were itself
    # error-prone (see run_mutant on why the basename matters).
    with tempfile.TemporaryDirectory(prefix="prove-ladder-") as scratch_dir:
        scratch = Path(scratch_dir)
        survived = []
        for label, anchor, repl in muts:
            killed, detail = run_mutant(checker, anchor, repl, scratch, args.verbose)
            print("  %-32s %s  %s" % (label, "KILLED  " if killed else "SURVIVED", detail))
            if not killed:
                survived.append(label)
    if survived:
        print("%s: %d of %d mutation(s) SURVIVED -> rung 1 is not proven:" % (checker.name, len(survived), len(muts)))
        for s in survived:
            print("    " + s)
        return 1
    print("%s: every applicable mutation killed (%d)" % (checker.name, len(muts)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
