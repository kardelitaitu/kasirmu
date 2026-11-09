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
)


def applicable(src):
    """The mutations whose anchor occurs exactly once in `src`."""
    return [m for m in MUTATIONS if src.count(m[1]) == 1]


def run_mutant(checker, anchor, replacement, scratch, verbose):
    """(killed, detail) -- load the mutant and call its ladder."""
    src = checker.read_text(encoding="utf-8")
    mutant = scratch / (checker.stem + "__mutant.py")
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

    scratch = Path(__file__).resolve().parent.parent / ".agents" / "mutants"
    scratch.mkdir(parents=True, exist_ok=True)
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
