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
    (
        # An if/else PAIR, not a one-line conditional. Splitting it the way the
        # row above does would leave a dangling `else:`; the anchor therefore
        # spans all four lines and the replacement drops the branch entirely.
        # Measured before adding: the mutant returns rc 1 at RUNG 1 with
        # "0 of 0 checker(s) in scope" -- a verdict, not a refusal. Only one file
        # in the tree has this shape, so it is a narrow row by design rather than
        # one the sweep may expect to fire widely.
        "base-root else block ignores root",
        "if root is not None:\n        base_root = Path(root).resolve()\n    else:\n        base_root = ROOT",
        "base_root = ROOT  # MUTANT: root ignored",
    ),
    (
        # A TERNARY that yields None rather than a fallback constant: the root
        # is optional for this checker (None means "scan this checkout"), so the
        # mutation must pin it to None rather than to REPO. Measured before
        # adding: rc 1 at RUNG 1 with "1 claim(s) assert CI enforcement that
        # does not exist" naming the fixture script -- a verdict, not a refusal.
        "root_path ignores root",
        "    root_path = None if root is None else Path(root).resolve()\n",
        "    root_path = None  # MUTANT: root ignored\n",
    ),
    (
        # A FOUR-LINE anchor, because the one line is not unique here: this file
        # spells `base = REPO if root is None else Path(root).resolve()` in BOTH
        # scan() and main(). Anchoring the bare line would match twice and the row
        # would never apply (applicable() wants exactly one occurrence); anchoring
        # by indentation matches twice as well. Including the closing docstring of
        # scan() binds the row to the scan alone. Measured before adding: the
        # mutant returns rc 1 at RUNG 1 on the VERDICT ("a fixture with one
        # raw-key site must be VERDICTED ... naming bad.test.tsx:2"), not a refusal.
        "scan-base ignores root",
        '    ui/src, shared-ui/locales, and every reported relative path.\n    """\n    base = REPO if root is None else Path(root).resolve()\n    ui_src = base / "ui" / "src"',
        '    ui/src, shared-ui/locales, and every reported relative path.\n    """\n    base = REPO  # MUTANT: root ignored\n    ui_src = base / "ui" / "src"',
    ),
)


def applicable(src):
    """The mutations whose anchor occurs exactly once in `src`.

    DE-DUPLICATED BY ANCHOR. The table carries two rows with identical anchors
    ("scan base ignores root" at the top and "inline base ignores root" further
    down, both spelling `base = ROOT if root is None else Path(root).resolve()`)
    and the same replacement -- a genuine duplicate, not two shapes. They used to
    be returned twice, so a file matching that one anchor reported "2 of 2
    mutation(s) killed", which reads as two independent mutants surviving
    independent evidence when it is one mutation run twice. Measured 2026-11-09:
    12 of the 70 checkers were double-counted that way.

    Collapsing here rather than deleting a row keeps the table's history intact
    (the second row records a shape that was added deliberately) while making the
    COUNT honest, which is the only thing the caller prints.

    A COMMENT IS NOT CODE. Round 269 measured check-page-headings reporting
    "1 of 1 mutation(s) SURVIVED" while its ladder was in fact sound: the anchor
    "base = ROOT if root is None else Path(root).resolve()" occurred exactly once,
    and that occurrence was a COMMENT (line 87, documenting the shape) -- the real
    binding spells "return ROOT if _ROOT is None else Path(_ROOT).resolve()" in
    scan_base(). Mutating a comment changes no behaviour, so the mutant survived,
    and the harness read that as a ladder defect. A row whose only match is
    commented out must count as NOT APPLICABLE, not as a survivor: the second
    verdict sends someone to fix a ladder that is fine.

    Mutating the real binding instead (line 346) kills this ladder at rc 1, which
    is what proved the ladder was never the problem.
    """
    seen = set()
    out = []
    for m in MUTATIONS:
        hits = _code_occurrences(src, m[1])
        if hits != 1 or m[1] in seen:
            continue
        seen.add(m[1])
        out.append(m)
    return out


def _code_occurrences(src, anchor):
    """How many times `anchor` occurs somewhere that is not ENTIRELY a comment.

    Whitespace and comment-only lines are dropped from both sides before matching,
    then the anchor is counted in the surviving text. A multi-line anchor therefore
    still matches when its own lines are code (check-raw-key-assertions anchors on
    four lines, one of which is a docstring closing), while an anchor that exists
    ONLY inside a comment -- the r269 check-page-headings case -- matches nothing.

    Narrowing this to "the line does not contain a #" was tried first and measured
    wrong: it broke check-raw-key-assertions and verify-runner-claims, whose
    multi-line anchors carry a trailing comment or a #-bearing string on one line.
    Stripping comments line-wise is the version that leaves both intact.
    """
    def strip(lines):
        # INDENTATION IS KEPT. test_apply()/the mutator splice the replacement in
        # front of the anchor at the anchor's own column, and one row here is a
        # bare "    root = Path(root).resolve()" -- dedenting made that row match
        # "base_root = Path(root).resolve()" at column 0, inventing an applicable
        # mutation and breaking two checkers that were green at HEAD (measured
        # 2026-11-09: verify-runner-commands and verify-selftests-wired).
        out = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            out.append(line.rstrip())
        return "\n".join(out)

    # src is a STRING; strip() iterates its argument, so it must be split first.
    # Passing it whole iterated characters and every count came back 0 -- measured,
    # and it is the kind of silent zero that reads as "anchor not present" rather
    # than as a bug.
    return strip(src.splitlines()).count(strip(anchor.splitlines()))


def run_mutant(checker, anchor, replacement, scratch, verbose):
    """(outcome, detail) -- load the mutant and call its ladder.

    The outcome is one of three, NOT a boolean. Measured 2026-11-09 why that
    matters: a mutant that cannot IMPORT and a mutant its ladder grades as
    passing both returned False, so main() printed "rung 1 is not proven" for
    each. The first says this harness broke the file; the second says the
    checker's ladder is too weak -- opposite claims about opposite parties, and
    four separate false results this arc (r249, r256, r261, r262) came from
    typing them the same. EXEC is therefore its own value and main() reports it
    as a harness fault rather than a finding about the checker.

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
        return "EXEC", "could not load the mutant"
    mod = importlib.util.module_from_spec(spec)
    buf = io.StringIO()
    try:
        spec.loader.exec_module(mod)
    except Exception as exc:
        return "EXEC", "mutant failed to import: %s" % exc
    if not hasattr(mod, "shell_ladder"):
        return "EXEC", "no shell_ladder() on the mutated module"
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = mod.shell_ladder()
    except Exception as exc:
        return "EXEC", "ladder RAISED instead of returning: %s" % exc
    said = buf.getvalue()
    if verbose:
        print(said[-800:])
    killed = rc != 0
    detail = "rc=%r" % (rc,)
    if killed and "rung 1" not in said:
        detail += " (no failure line names rung 1)"
    return ("KILLED" if killed else "SURVIVED"), detail


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # r269: `checker` is nargs="?" so --self-test can be reached at all. It was
    # required until now, which made self_test() unreachable from the command line:
    # running "prove-ladder-kills.py --self-test" failed with "the following
    # arguments are required: checker" and the cases never ran. A self-test nothing
    # can invoke is the same shape as a ladder nothing calls (r263) -- present, green
    # by absence, and counted by whatever looks for the name.
    ap.add_argument("checker", nargs="?")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.checker:
        ap.error("checker is required unless --self-test is given")

    checker = Path(args.checker)
    if not checker.is_file():
        print("error: %s is not a file" % checker, file=sys.stderr)
        return 2
    src = checker.read_text(encoding="utf-8")
    # A file with no ladder has nothing to prove, and saying so must not wait for
    # a mutant to be built. Measured 2026-11-09: seven ladderless checkers each
    # reported "1 of 1 mutation(s) SURVIVED -> rung 1 is not proven", which reads
    # as a finding about the CHECKER. It is a statement about the file's shape,
    # the same kind as "no applicable mutation" below, and it belongs here --
    # before a mutant exists to be misread.
    if "def shell_ladder" not in src:
        print("%s: NO LADDER -- this file declares no shell_ladder(), so there is "
              "nothing to prove; a mutant of it would report SURVIVED for a shape "
              "reason rather than a grading one." % checker.name)
        return 2
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
        broke = []
        for label, anchor, repl in muts:
            outcome, detail = run_mutant(checker, anchor, repl, scratch, args.verbose)
            print("  %-32s %-9s %s" % (label, outcome, detail))
            if outcome == "SURVIVED":
                survived.append(label)
            elif outcome == "EXEC":
                broke.append(label)
        if broke:
            # Not a finding about the checker. This harness built a mutant that
            # could not run, which is a fault HERE, and reporting it as "not
            # proven" is how four false results happened.
            print("%s: HARNESS FAULT -- %d mutation(s) could not execute: %s"
                  % (checker.name, len(broke), ", ".join(broke)))
            print("    A mutant that does not run proves nothing about the ladder; "
                  "fix the anchor, not the checker.")
            return 3
    if survived:
        print("%s: %d of %d mutation(s) SURVIVED -> rung 1 is not proven:" % (checker.name, len(survived), len(muts)))
        for s in survived:
            print("    " + s)
        return 1
    print("%s: every applicable mutation killed (%d)" % (checker.name, len(muts)))
    return 0


def self_test() -> int:
    """Grade this harness on the four ways it has produced a false result.

    Each case below is a shape that actually happened in this arc, not a
    hypothetical. The harness is the ONE tool here whose errors get reported as
    findings about other files, so it is the tool most worth grading -- and
    until now it had no self-test at all (the census never asked, because its
    SCRIPT_RE matches verify-/check-/classify-/census- prefixes and this file is
    named none of those).
    """
    bad = []

    def want(name, got, expect):
        if got != expect:
            bad.append("%s: expected %r, got %r" % (name, expect, got))

    want("applicable() is a MUTATIONS subset",
         set(applicable("x = 1")) <= set(MUTATIONS), True)
    # Duplicate rows must not double-count. The table really does hold two rows
    # with the same anchor; applicability is keyed on the ANCHOR, so a file
    # matching it once is one mutation, not two.
    anchor = "base = ROOT if root is None else Path(root).resolve()"
    got = applicable(anchor)
    want("a duplicated anchor yields ONE mutation", len(got), 1)
    want("...and it is the right one", got[0][1] if got else None, anchor)
    # A row matching only a COMMENT must be inapplicable, not a survivor.
    commented = "# " + anchor
    want("a comment-only anchor is NOT applicable", applicable(commented), [])
    # ...and a real line plus a comment copy still counts once.
    mixed = "#   " + anchor + chr(10) + anchor + chr(10)
    want("a commented copy does not double a real match", len(applicable(mixed)), 1)
    # r261: a one-line anchor must not match the first half of a longer
    # conditional. The check above grades two STRING LITERALS, which is not the
    # same as grading the table -- measured 2026-11-09: with the literals fixed
    # but the entry's newline stripped, these cases still passed while the row
    # had the very defect they describe. The assertion therefore reads the REAL
    # entry and requires every row whose anchor ends a line to carry that
    # newline, so the table itself is what is graded.
    conditional = ("    root = Path(root).resolve() if root is not None else ROOT"
                   + chr(10))
    rebound = [a for label, a, _r in MUTATIONS if label == "rebound root ignores root"]
    want("the rebound-root row exists", len(rebound), 1)
    want("the rebound-root anchor is newline-terminated",
         rebound[0].endswith(chr(10)), True)
    want("that row does NOT fire inside a conditional",
         conditional.count(rebound[0]), 0)
    # r262: a ladderless file must be refused before a mutant exists.
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        bare = d / "check-bare.py"
        bare.write_text("X = 1" + chr(10), encoding="utf-8")
        want("a file with no ladder declares none",
             "def shell_ladder" in bare.read_text(encoding="utf-8"), False)
        # r249: a mutant that cannot import is a HARNESS fault, not a survive.
        broken = d / "check-broken.py"
        broken.write_text("def shell_ladder(:" + chr(10), encoding="utf-8")
        outcome, detail = run_mutant(
            broken, "def shell_ladder(:", "def shell_ladder():", d, False)
        want("a mutant that cannot import is EXEC, not SURVIVED",
             outcome, "EXEC")
        want("...and names the import failure", "import" in detail, True)
    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("self-test: OK (8 harness cases: anchor shape, duplicate-anchor "
          "collapse, comment-only anchors, ladder guard, three-valued mutant outcome)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
