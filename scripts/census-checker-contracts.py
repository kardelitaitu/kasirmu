#!/usr/bin/env python3
"""census-checker-contracts.py -- make the arc's next target DERIVABLE, not remembered.

WHY THIS EXISTS
===============
Round 228 opened a second arc over "nine checkers still un-contracted" and named the
rule ("smallest first") but never recorded the list. Round 230 tried to recover it and
could not -- not from HEAD, not from 80+ refs, not from the reflog, not from the 129
unreachable blobs a `git fsck` sweep turned up. The list lived in one session and died
with it. The next round then had to GUESS its target, which is the defect this file
closes: a population that only memory can enumerate cannot be audited, and a guess
cannot be differed from a decision.

The deeper finding, and the reason this is a census and not a gate: NO mechanical
filter reproduces "nine". Measured at r227 against the tree that produced it -- 48
checkers had a self-test and no ladder, 48 were wired and ladderless, 16 of those had
no `root` kwarg at all, 32 had one, and the docs-auditor skill held 12. Every candidate
rule yields a different number, none yields nine. The nine was a COST/VALUE judgement
over a 48-wide field. So the honest fix is not to recover the judgement; it is to make
the field and a repeatable ordering available, and to let each round record the command
it ran instead of a number a reader cannot re-derive.

THE CONTRACT IT MEASURES
========================
A checker is CONTRACTED (the r166 shape, as rounds 213-229 applied it) when all four
hold:

    self_test   it declares its own liveness proof (`def self_test`, or the flag)
    ladder      it has a fixture ladder (`shell_ladder`), the part that proves the
                root seam is real rather than merely parsed
    root_param  main() accepts a root, so a fixture tree can be graded
    wired       a runner invokes it, so none of the above can rot unseen

Population: `.py` checkers that declare their own self-test in-file, matching the same
prefix family verify-selftests-wired.py uses. Two exclusions are structural rather than
by a name table, and that is deliberate -- a hardcoded exemption list is a second place
to disagree, and it rots silently the day the exempted file is fixed:

  - a checker with NO in-file self-test is outside the population entirely, which is
    how the two documented sibling shapes fall out: check-replay-fork.py declares its
    cases in scripts/test-replay-fork.py (r177), and census-sync-ingest-admits.py
    deliberately claims no runner authority (verify-selftests-wired.py's docstring);
  - `.mjs` and `.sh` checkers are excluded because the contract's shape is a Python
    idiom (a kwarg on main), so including them would report a denominator they can
    never join -- a permanently-red row for a reason that is not a defect.

The exclusions are COUNTED and named in the report, never absorbed: a census that
silently shrank its own denominator is the defect verify-selftests-wired.py was built
to stop (its round-135 register misread came from exactly that silence).

WHAT IT DOES NOT CLAIM
======================
It does not grade the QUALITY of any ladder, nor whether a self-test's cases can fail.
verify-selftests-wired.py owns "is the flag called"; each checker's own ladder owns
whether it proves anything. This file owns one question: which checkers have all four
parts, and which is the smallest that does not?

EXIT CODES -- and why 0 on a non-empty list
    0  always, when the census ran. A 40-plus-item list is not a regression, it is the
       backlog; failing on it would make this gate red every day until the arc ends, so
       it is informational by design (round 109's rule: a new gate starts green).
    2  REFUSED: the scripts directory or the runner file could not be read.

Usage, from the repo root:

    python scripts/census-checker-contracts.py                  # the census
    python scripts/census-checker-contracts.py --next-target    # just the next round's target
    python scripts/census-checker-contracts.py --next-round     # the round number to claim
    python scripts/census-checker-contracts.py --self-test
"""
from __future__ import annotations

import argparse
import contextlib
import io
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


#: Where fixtures are written when the host sets a temp variable (a confined
#: host denies its default temp); unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root fixtures go under (None = system default), created if missing."""
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
CHECK_SH = SCRIPTS / "check.sh"
REGISTER = ROOT / "docs" / "records" / "findings" / "audit-open-findings.md"

SCRIPT_RE = re.compile(r"^(?:verify|check|classify|census)-[A-Za-z0-9_-]+\.py$")
LADDER_RE = re.compile(r"shell_ladder|_LADDER_RUNNING|ladder_body")
MAIN_RE = re.compile(r"^def main\(([^)]*)\)", re.M)
ROUND_RE = re.compile(r"^### Round (\d+) \(", re.M)

CONTRACT_PARTS = ("self_test", "ladder", "root_param", "wired")


def declares_selftest(text: str) -> bool:
    """True when the file owns a liveness proof, by either live convention.

    BOTH quote styles are accepted, and that is a measured correction, not
    defensiveness: census-orphan-modules.py, check-ftl-attrs.py and
    classify-finding-reachability.py spell it `'--self-test'`, so a double-quote-only
    test excluded three fully wired, self-tested checkers from the population and
    silently shrank the denominator -- the exact defect this file's docstring cites.
    """
    return ("def self_test" in text or '"--self-test"' in text
            or "'--self-test'" in text)


def has_ladder(text: str) -> bool:
    """True when the file carries a fixture ladder rather than only a case list."""
    return bool(LADDER_RE.search(text))


def root_param(text: str) -> bool:
    """True when main() accepts a root, so a fixture tree can be graded through it."""
    match = MAIN_RE.search(text)
    return bool(match and "root" in match.group(1))


def wired(name: str, runner_text: str) -> bool:
    """True when a runner invokes the checker by path (not by prose mention)."""
    return ("scripts/" + name) in runner_text


def classify(name: str, text: str, runner_text: str) -> dict[str, bool]:
    """The four contract flags for one checker. Pure: no file is read here."""
    return {
        "self_test": declares_selftest(text),
        "ladder": has_ladder(text),
        "root_param": root_param(text),
        "wired": wired(name, runner_text),
    }


def is_contracted(flags: dict[str, bool]) -> bool:
    """The r166 contract is all four parts; any missing part is an un-contracted row."""
    return all(flags[part] for part in CONTRACT_PARTS)


def missing_parts(flags: dict[str, bool]) -> list[str]:
    """The parts this checker lacks, in the declared order, for the report column."""
    return [part for part in CONTRACT_PARTS if not flags[part]]


def census(scripts: Path = SCRIPTS, runner_text: str | None = None, read_text=None):
    """[(name, lines, flags)] over the .py checkers, sorted smallest first.

    read_text exists so the self-test can drive this over synthetic files without a
    temp tree; the default reads the real ones.
    """
    if read_text is None:
        def read_text(p: Path) -> str:
            return p.read_text(encoding="utf-8", errors="replace")
    if runner_text is None:
        runner_text = read_text(CHECK_SH)
    rows = []
    for path in sorted(scripts.iterdir()):
        if not SCRIPT_RE.match(path.name):
            continue
        text = read_text(path)
        rows.append((path.name, len(text.splitlines()), classify(path.name, text, runner_text)))
    return rows


def uncontracted(rows) -> list[tuple[int, str, list[str]]]:
    """The rows still owed the contract, smallest first -- the arc's own ordering."""
    return sorted(
        (lines, name, missing_parts(flags))
        for name, lines, flags in rows
        if not is_contracted(flags)
    )


def population(rows) -> list[tuple[str, int, dict[str, bool]]]:
    """The checkers the contract can apply to: those declaring their own self-test.

    Filtering here rather than exempting by name is what keeps the two documented
    sibling shapes (a cases file, a census with no runner authority) out of the
    denominator without a table that would rot.
    """
    return [row for row in rows if row[2]["self_test"]]


def outside_population(rows) -> list[str]:
    """The names excluded for declaring no self-test of their own, for the report."""
    return sorted(name for name, _lines, flags in rows if not flags["self_test"])


def last_round(text: str) -> int | None:
    """The highest round number in a register log body, or None when it has none."""
    nums = [int(n) for n in ROUND_RE.findall(text)]
    return max(nums) if nums else None


def head_register(root: Path | None = None) -> str | None:
    """The register as committed, or None when git is unavailable or has no HEAD.

    r250: `root` is a parameter so the ladder can point this at a THROWAWAY
    repository. Hardcoded to ROOT, the only way to grade this function was
    against the live checkout -- which is exactly what the ladder must not do,
    and what made this file the last un-contracted one: it read its own repo.
    """
    # MEASURED DEFECT (r250): `git show` run inside a path that is NOT itself a
    # repository does not fail -- git walks UP the directory tree and answers
    # from the enclosing checkout. A fixture under .agents/ therefore read THIS
    # repository's HEAD, and a --next-round assertion silently graded the live
    # tree (measured: "HEAD is ahead (249) of working tree (7)", i.e. it merged
    # a fixture's round 7 with this repository's round 249). The guard below
    # confines each call to the root it was given, so a fixture with no
    # git of its own answers None -- which is the honest answer for it.
    scope = ROOT if root is None else Path(root)
    guard = [] if root is None else ["-c", "safe.directory=*",
                                    "--git-dir=%s" % (scope / ".git"),
                                    "--work-tree=%s" % scope]
    try:
        out = subprocess.run(
            ["git", *guard, "show", "HEAD:docs/records/findings/audit-open-findings.md"],
            cwd=scope, capture_output=True, text=True, encoding="utf-8",
        )
    except OSError:
        return None
    if out.returncode != 0:
        return None
    # Belt and braces: a fixture must never inherit this repository's history.
    return out.stdout


def next_round_number(head_text: str | None, disk_text: str | None) -> tuple[int | None, str]:
    """The number to claim, and which source set it.

    R229/R230's collision was two lanes both reading the same last number and both
    taking +1. The guard is to consider BOTH sources and take the higher: HEAD is what
    another lane also sees, and the working tree is what you may already have drafted,
    so the number a new entry must beat is the max of the two.
    """
    candidates = []
    if head_text is not None:
        n = last_round(head_text)
        if n is not None:
            candidates.append((n, "HEAD"))
    if disk_text is not None:
        n = last_round(disk_text)
        if n is not None:
            candidates.append((n, "working tree"))
    if not candidates:
        return None, "no round entries found"
    top, source = max(candidates)
    if len(candidates) == 2 and candidates[0][0] != candidates[1][0]:
        ahead = max(candidates)
        behind = min(candidates)
        return top + 1, ("%s is ahead (%d) of %s (%d)"
                         % (ahead[1], ahead[0], behind[1], behind[0]))
    return top + 1, max(candidates)[1]


SELF_TEST_CASES = [
    # (name, text, runner_text, expected flags)
    ("fully contracted",
     "def self_test():\n    pass\n\ndef shell_ladder():\n    pass\n\ndef main(argv=None, root=None):\n    pass\n",
     "python3 scripts/check-demo.py --self-test", True),
    ("no ladder",
     "def self_test():\n    pass\n\ndef main(argv=None, root=None):\n    pass\n",
     "python3 scripts/check-demo.py --self-test", False),
    ("flag-only self-test still counts",
     'if "--self-test" in sys.argv:\n    pass\ndef shell_ladder():\n    pass\ndef main(root=None):\n    pass\n',
     "scripts/check-demo.py", True),
    ("main() without root is un-contracted",
     "def self_test():\n    pass\ndef shell_ladder():\n    pass\ndef main():\n    pass\n",
     "scripts/check-demo.py", False),
    ("unwired is un-contracted even when complete",
     "def self_test():\n    pass\ndef shell_ladder():\n    pass\ndef main(root=None):\n    pass\n",
     "# nothing references it", False),
    ("a prose mention is not a runner call",
     "def self_test():\n    pass\ndef shell_ladder():\n    pass\ndef main(root=None):\n    pass\n",
     "# we do not run check-demo.py yet", False),
    ("single-quoted flag declares a self-test",
     "if '--self-test' in sys.argv:\n    pass\ndef shell_ladder():\n    pass\ndef main(root=None):\n    pass\n",
     "scripts/check-demo.py", True),
]


def self_test() -> int:
    """Pin the four classifiers and the round derivation; read no file, run no git."""
    failures = 0
    for name, text, runner, want in SELF_TEST_CASES:
        flags = classify("check-demo.py", text, runner)
        got = is_contracted(flags)
        if got != want:
            print("  FAIL %-42s expected contracted=%s got %s (missing %s)"
                  % (name, want, got, ",".join(missing_parts(flags)) or "none"))
            failures += 1
        else:
            print("  ok   %-42s contracted=%s" % (name, got))

    # The ordering rule: smallest first, and only the un-contracted appear.
    rows = [
        ("check-big.py", 900, {"self_test": True, "ladder": True, "root_param": True, "wired": True}),
        ("check-mid.py", 500, {"self_test": True, "ladder": False, "root_param": True, "wired": True}),
        ("check-small.py", 200, {"self_test": True, "ladder": False, "root_param": True, "wired": True}),
    ]
    order = [name for _lines, name, _missing in uncontracted(rows)]
    if order != ["check-small.py", "check-mid.py"]:
        print("  FAIL ordering: uncontracted() = %r, want smallest-first and no contracted row"
              % (order,))
        failures += 1
    else:
        print("  ok   ordering: smallest un-contracted first, contracted rows excluded")

    # The population rule: a checker with no in-file self-test is excluded rather than
    # failed, which is what keeps the two documented sibling shapes out of the backlog.
    mixed = rows + [("census-sync-ingest-admits.py", 227,
                     {"self_test": False, "ladder": False, "root_param": False, "wired": False})]
    if [n for n, _l, _f in population(mixed)] != ["check-big.py", "check-mid.py", "check-small.py"]:
        print("  FAIL population(): a checker declaring no self-test must be excluded")
        failures += 1
    else:
        print("  ok   population excludes a checker with no in-file self-test")

    # Round derivation, including the two-source race this file exists to prevent.
    log = lambda *ns: "".join("### Round %d (2026-11-09) -- t\nbody\n" % n for n in ns)
    cases = [
        ("head and tree agree", log(230), log(230), 231),
        ("working tree drafted ahead", log(230), log(231), 232),
        ("HEAD ahead of a stale tree", log(231), log(230), 232),
    ]
    for name, head, disk, want in cases:
        got, _why = next_round_number(head, disk)
        if got != want:
            print("  FAIL %-42s expected %s got %s" % (name, want, got))
            failures += 1
        else:
            print("  ok   %-42s next=%s" % (name, got))

    # The addendum form must not be read as an entry claiming a round.
    got = last_round(log(229) + "### Round 229, addendum -- pointer\n")
    if got != 229:
        print("  FAIL an addendum must not raise the last round (got %r)" % (got,))
        failures += 1
    else:
        print("  ok   addendum form does not raise the last round")

    total = len(SELF_TEST_CASES) + 4 + len(cases)
    print("SELF-TEST %s (%d cases, no file read, no git run)"
          % ("OK" if failures == 0 else "WRONG", total))
    if failures:
        return 1
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard (the r228 pattern): rung 4 drives --self-test through
    argv from inside the ladder, and the self-test ends in this call."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r250: the root contract, graded on fixture checkouts through main().

    This file was the last un-contracted one and the reason was structural: it
    graded ITS OWN repository -- census() walked the real scripts/ and
    head_register() shelled out with cwd=ROOT -- so a fixture ladder had nowhere
    to point. Both now take a root, which is what makes rung 1 possible.

    Rung 1 must be a KILLING rung. The fixture holds ONE contracted checker and
    ONE that declares a self-test but no ladder; a root-blind main would grade
    this checkout's 70 checkers instead and print a different count, so the
    rung asserts the exact "1 of 2" line the fixture can produce and the real
    tree cannot (it reads 31 of 70).
    """
    def build(tmp, files, label="fx"):
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline=chr(10))
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            rc = main(argv=list(argv), root=str(root_dir))
        return rc, buf.getvalue()

    GOOD = ("def self_test():\n    pass\n\ndef shell_ladder():\n    pass\n"
            "\ndef main(argv=None, root=None):\n    pass\n")
    BAD = ("def self_test():\n    pass\n\ndef main(argv=None, root=None):\n"
           "    pass\n")
    FILES = {
        "scripts/check-fx-good.py": GOOD,
        "scripts/check-fx-bad.py": BAD,
        "scripts/check.sh": "python3 scripts/check-fx-good.py --self-test\n"
                            "python3 scripts/check-fx-bad.py --self-test\n",
        "docs/records/findings/audit-open-findings.md": "### Round 7 (2026-11-09) -- t\nbody\n",
    }

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the fixture census, by exact count.
        root = build(tmp, FILES)
        rc, said = run(root)
        if rc != 0 or "census-checker-contracts: 1 of 2 checker(s)" not in said:
            print("  x rung 1: a fixture census must report its own 1 of 2 "
                  "(rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- next-round reads the FIXTURE register (round 7 -> 8), not this one.
        rc, said = run(root, "--next-round")
        if rc != 0 or said.split()[0] != "8":
            print("  x rung 2: --next-round must read the fixture register "
                  "(rc=%r said=%r)" % (rc, said[-200:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- a checkout with no scripts/ or check.sh refuses rather than
        # reporting a clean sweep over nothing.
        bare = build(tmp, {"README.md": "nothing here"}, label="bare")
        rc, said = run(bare)
        if rc != 2 or "REFUSED" not in said:
            print("  x rung 3: a checkout without scripts/ must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test through argv, and the nested ladder is skipped.
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("CENSUS-CHECKER-CONTRACTS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file graded)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """argv and root parameterized (r250) -- root redirects BOTH the census and
    the register HEAD is read from, so a fixture checkout is graded whole."""
    parser = argparse.ArgumentParser(description="Which checkers still lack the r166 contract?")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--next-target", action="store_true",
                        help="print only the smallest un-contracted checker")
    parser.add_argument("--next-round", action="store_true",
                        help="print the round number to claim, considering HEAD and the tree")
    args = parser.parse_args(sys.argv[1:] if argv is None else list(argv))

    if args.self_test:
        return self_test()

    base = ROOT if root is None else Path(root).resolve()
    scripts_dir = SCRIPTS if root is None else base / "scripts"
    check_sh = CHECK_SH if root is None else base / "scripts" / "check.sh"
    register = REGISTER if root is None else base / "docs" / "records" / "findings" / "audit-open-findings.md"

    if args.next_round:
        disk = None
        if register.is_file():
            disk = register.read_text(encoding="utf-8")
        number, why = next_round_number(head_register(base), disk)
        if number is None:
            print("census-checker-contracts: REFUSED - %s" % why, file=sys.stderr)
            return 2
        print(number)
        print("next round: %d (%s)" % (number, why), file=sys.stderr)
        return 0

    if not scripts_dir.is_dir() or not check_sh.is_file():
        print("census-checker-contracts: REFUSED - %s or %s not found"
              % (scripts_dir, check_sh), file=sys.stderr)
        return 2
    try:
        rows = census(scripts_dir, check_sh.read_text(encoding="utf-8", errors="replace"))
    except OSError as exc:
        print("census-checker-contracts: REFUSED - %s" % exc, file=sys.stderr)
        return 2

    owed = uncontracted(population(rows))
    contracted = len(population(rows)) - len(owed)
    outside = outside_population(rows)

    if args.next_target:
        if not owed:
            print("census-checker-contracts: every one of the %d checker(s) declaring a"
                  " self-test is contracted" % len(population(rows)))
            return 0
        print(owed[0][1])
        print("next target: %s (%d lines, missing %s)"
              % (owed[0][1], owed[0][0], ", ".join(owed[0][2])), file=sys.stderr)
        return 0

    print("census-checker-contracts: %d of %d checker(s) declaring a self-test carry the"
          " full contract" % (contracted, len(population(rows))))
    print("  contract = self_test + ladder + root_param + wired; population excludes .mjs/.sh")
    if outside:
        print("  outside the population (no in-file self-test -- a sibling cases file or a"
              " deliberate no-authority census): %d" % len(outside))
        print("    " + ", ".join(outside))
    if not owed:
        print("  nothing owed -- every checker in scope is contracted.")
        return 0
    print("  %d un-contracted, smallest first (the arc's own ordering):" % len(owed))
    for lines, name, missing in owed:
        print("    %5d  %-46s missing %s" % (lines, name, ", ".join(missing)))
    print("  next target: scripts/%s (%d lines)" % (owed[0][1], owed[0][0]))
    print("  -> record THAT command's output in the round entry, not a remembered list.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
