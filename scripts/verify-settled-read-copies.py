#!/usr/bin/env python3
"""verify-settled-read-copies.py -- one implementation of the settled-read verdict.

WHY
===
A read has three outcomes, not two: it ANSWERED, it found nothing, or it FAILED.
The last two both surface as `null`/`[]` to a caller that just awaits, which is how a
throw keeps turning into a claim the screen makes out loud -- "no shift is open",
"this sale was never refunded", "this store has one cashier". The fix that took
root here is ui/src/utils/settle-read.ts: a DISCRIMINATED UNION whose failure arm
carries no value at all, so there is nothing to mistake for an answer, and each
caller decides for its own state what an unanswered read means.

That contract was worth copying, and copying it is what this file exists to stop.
It had FOUR hand-copied implementations by the time it was noticed: AppShell.tsx,
StockTransfersScreen.tsx and WarehouseCountFlow.tsx each declared a local
`type BootRead<T>`/`type Read<T>` alongside a private `settle()` (consolidated in
round 15, commit cefee06fa), and ui/src/utils/boot-retry.ts declared
`export type BootReadResult<T>` with the same two arms. Each copy carried its own
console prefix and its own idea of where the comment explaining it should point;
two of the three feature files documented the contract by citing `app/AppShell.tsx`
-- a copy, at a line range that had already moved. None of that is visible to the
compiler, to the test suite, or to any existing gate: the four copies were all
type-correct and all passed everything. Nothing in scripts/ referenced settleRead
at all, so the fifth copy would have been as acceptable as the first four were.

WHAT IT GRADES
==============
Every `type X = { ok: true; value: T } | { ok: false }` declaration under ui/src
outside ui/src/utils/settle-read.ts. It does NOT police call sites -- a caller may
legitimately name the type in a signature -- and it does not decide whether a second
verdict shape is warranted: ui/src/utils/boot-retry.ts needs one because its read
has to be re-issued rather than awaited, and what it is allowed to do is IMPORT the
shared union rather than re-declare it. So the finding is always 'this file
re-declares the union', and the repair is always the same one: import the type.

The check is deliberately SHAPE-based, not name-based. Naming the copies (`BootRead`,
`BootReadResult`, `Read`) in a list would have made the gate report zero findings the
day after it was written and stay there while a sixth copy arrived under a fourth
name -- which is precisely how the first four got here.

Exit 0 clean, 1 finding(s), 2 self-test or usage failure.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# The root is asked of git first and taken from __file__ only as a fallback. Written this
# way because the OTHER half of this file's contract is a zero-finding verdict, and a copy
# of the script outside this checkout used to walk its own empty parent and print
# "OK -- 0 file(s) swept" at exit 0. Measured 2026-11-06; the same closure
# scripts/verify-scoped-reads.py carries (its F-2 note is the long version).
def _repo_root() -> Path:
    """git's answer for the directory holding this file, or its parent when git cannot."""
    here = Path(__file__).resolve().parent
    try:
        proc = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=here,
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return here.parent
    if proc.returncode != 0 or not (proc.stdout or "").strip():
        return here.parent
    return Path(proc.stdout.strip()).resolve()


ROOT = _repo_root()
UI_SRC = ROOT / "ui" / "src"
#: A one-word name chosen so this file is greppable in a census of contracted
#: checkers and so a fixture renders its name verbatim.
CENSUS_NAME = "SETTLED-READ-COPY-243"

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
# The one file allowed to declare the union. Anything else that spells it out is a copy.
OWNER = "ui/src/utils/settle-read.ts"

# `{ ok: true; value: T } | { ok: false }`, with any whitespace and any type parameter
# name. Both arms must appear, in order, on one line.
UNION_RE = re.compile(
    r"\bok\s*:\s*true\b[^\n|]*\|\s*\{\s*ok\s*:\s*false"
)
# A declaration only: `type`/`export type`, optional `declare`, an identifier, then `=`
# and an opening brace. A function's return annotation cannot match this.
DECL_RE = re.compile(r'^\s*(?:export\s+)?(?:declare\s+)?type\s+(\w+)[^=\n]*=\s*\{')
SOURCE_SUFFIXES = frozenset({".ts", ".tsx"})

# Dependency and build trees, which never hold application source.
SKIP_DIRS = frozenset({"node_modules", "dist", "build", "__snapshots__"})


def ui_sources(root: Path = UI_SRC) -> list[Path]:
    """Every source file under ROOT, skipping dependency and build trees."""
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        out.append(p)
    return out


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def find_copies(root: Path) -> list[dict]:
    """Every re-declaration of the union outside the owning module.

    `root` is the directory to sweep, so the self-test can point this at a fixture
    tree rather than the live repository.
    """
    # The owner is named relative to the tree the sweep was given, so a fixture tree
    # carries its own owning module and never inherits the repository's.
    owner = (root / OWNER_REL).resolve()
    findings: list[dict] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.resolve() == owner:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            findings.append({
                "file": rel(p, root),
                "line": 0,
                "type": None,
                "detail": "unreadable source file",
            })
            continue
        for n, line in enumerate(text.splitlines(), 1):
            m = DECL_RE.match(line)
            if not m or not UNION_RE.search(line):
                continue
            findings.append({
                "file": rel(p, root),
                "line": n,
                "type": m.group(1),
                "detail": "re-declares the settled-read verdict union",
            })
    return findings


def report(findings: list[dict], swept: int) -> str:
    if not findings:
        return (f"{CENSUS_NAME}: settled-read copies: OK -- {swept} file(s) swept, "
                "the union is declared once, in " + OWNER)
    lines = [f"{CENSUS_NAME}: settled-read copies: {len(findings)}"
             f" re-declaration(s) outside {OWNER}"]
    for f in findings:
        where = f["file"] + (":" + str(f["line"]) if f["line"] else "")
        kind = f["type"] or "?"
        lines.append(f"  {where}  type {kind}  {f['detail']}")
    lines += [
        "  repair: import SettledRead from @/utils/settle-read and delete the"
        "  local alias. A second verdict shape is fine; a second DECLARATION of one is not."
    ]
    return chr(10).join(lines)

# Cases that prove the rule FIRES. A gate that cannot fail teaches its reader to
# trust it, and this one exists precisely because four copies of the union already
# passed every other gate in the repo. `root` is a parameter so the cases can point
# the sweep at a fixture tree instead of the live repository.
def self_test() -> int:
    import tempfile

    cases = []
    OWNER = "export type SettledRead<T> = { ok: true; value: T } | { ok: false };"
    A = "type BootRead<T> = { ok: true; value: T } | { ok: false };"
    B = "export type BootReadResult<T> = { ok: true; value: T } | { ok: false };"
    RENAMED = "type Settled<T> = { ok: true; value: T } | { ok: false };"
    SPACED = "type Read<T> =   { ok: true;   value: T }   |   { ok: false };"
    ONE_ARM = "export type Answer<T> = { ok: true; value: T };"
    WRONG_ORDER = "type V<T> = { ok: false } | { ok: true; value: T };"
    USE = (
        "export async function f<T>(r: Promise<T>): Promise<SettledRead<T>> {",
        "  return { ok: true, value: await r };",
        "}",
    )
    VALUE = (
        "const settled = { ok: true, value: 1 };",
        "interface Answer { ok: true }",
    )

    def sweep(files):
        with tempfile.TemporaryDirectory(dir=fixture_root(),
                                         ignore_cleanup_errors=True) as tmp:
            base = Path(tmp) / "ui" / "src"
            for name, text in files.items():
                dest = base / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(text + chr(10), encoding="utf-8")
            return find_copies(base)

    def case(name, files, want):
        flat = {k: (v if isinstance(v, str) else chr(10).join(v)) for k, v in files.items()}
        got = sweep(flat)
        cases.append((name, len(got) == want))
        if len(got) != want:
            print("      (wanted " + str(want) + ", got " + str(len(got)) + ")")

    # 1. the owning module alone is clean
    case("the owner alone is clean", {"utils/settle-read.ts": OWNER}, 0)

    # 2. the exact pre-round-15 AppShell alias
    case("a local alias is a finding",
         {"utils/settle-read.ts": OWNER, "app/AppShell.tsx": A}, 1)

    # 3. the exact pre-round-16 boot-retry export
    case("an exported alias is a finding",
         {"utils/settle-read.ts": OWNER, "utils/boot-retry.ts": B}, 1)

    # 4. a copy under a FOURTH name is still a copy: the rule is shape-based
    case("a renamed copy is still a finding",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": RENAMED}, 1)

    # 5. the owner NAME alone must not exempt a copy elsewhere
    case("the basename does not exempt a copy",
         {"utils/settle-read.ts": OWNER, "app/x/Settle.ts": OWNER}, 1)

    # 6. odd spacing inside the arms still matches
    case("odd spacing still matches",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": SPACED}, 1)

    # 7. ONE arm alone is not the union
    case("one arm alone is not the union",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": ONE_ARM}, 0)

    # 8. arms in the WRONG order are a DIFFERENT type and must not match
    case("wrong arm order does not match",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": WRONG_ORDER}, 0)

    # 9. a function RETURNING the union is a use, not a declaration
    case("a return-type use is not a declaration",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": USE}, 0)

    # 10. a value literal is not a type declaration
    case("a value literal is not a declaration",
         {"utils/settle-read.ts": OWNER, "features/x/Thing.tsx": VALUE}, 0)

    # 11-12. THE FLOOR, through main() so the wiring is graded and not a copy of it.
    # Measured 2026-11-06: without the sweep floor a copy of this script beside an empty
    # ui/src printed "OK -- 0 file(s) swept" and exited 0.
    import contextlib
    import io

    def run_main(argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            return main(argv), buf.getvalue()

    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        code, said = run_main(["--root", tmp])
        cases.append(("an empty corpus is refused, and says why",
                      code == 2 and "no .ts/.tsx source file" in said))

    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        (Path(tmp) / "only.ts").write_text("export const a = 1;", encoding="utf-8")
        code, _said = run_main(["--root", tmp])
        cases.append(("a one-file corpus still gets a verdict", code == 0))

    failed = 0
    for name, ok in cases:
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark}  {name}")
        if not ok:
            failed += 1
    print(f"settled-read copies self-test: {len(cases) - failed}/{len(cases)} passed")
    if failed:
        return 1
    # The success path only: a self-test already shown to grade wrongly must not spend
    # the ladder's time re-proving a rule it has just got wrong.
    return shell_ladder()

#: The owning module's path RELATIVE to the tree being swept. \`find_copies\` resolves
#: the exemption against whichever root it was handed, so a fixture tree carries its
#: own owner rather than inheriting this checkout's.
OWNER_REL = "utils/settle-read.ts"


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (243 -- the r228 lesson).

    Rung 5 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. The guard is what makes "the ladder is reachable from the self-test"
    and "the self-test can be invoked" two facts that may hold at once.
    """
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
    """243: the root contract, graded on fixture .ts trees THROUGH main().

    Rung 1 IS the killing rung. This checkout's live sweep is clean (measured 243:
    exit 0, "the union is declared once"), so a main() that ignored its root would
    print THAT green against a fixture holding a copy. Worse for this checker than
    for a shell one: a root-blind run grades ./ui/src, which is not empty, so the
    refusal floor never fires and the "OK" is about the wrong tree rather than
    about no tree. The rung therefore demands three things a root-blind main cannot
    say at once -- exit 1, this fixture's own file and line, and the census name
    that only the file this ladder drives is built to print.

    Rungs 2-5 grade the other three directions the sweep can take: the fixture's
    OWN owner module is exempt (so the exemption follows the root, not __file__),
    nesting is swept, a one-file corpus still earns a verdict rather than being
    read as empty, and every rung above goes through argv as well as the kwarg
    (rung 5: --self-test through argv, with the nested ladder skipped).
    """
    import contextlib
    import io
    import tempfile

    def build(files, label="fx"):
        """A fixture root holding the given {relative path: text} sources.

        Every fixture is its own mkdtemp, so a directory added beside one can never
        fall inside another's sweep. Measured 243: rung 1's extra, written into the
        shared temp root, was swept by the nested --self-test and failed it.
        """
        base = Path(tempfile.mkdtemp(dir=fixtures, prefix=label + "_"))
        for rel_text, body in files.items():
            dest = base / rel_text
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(body + chr(10), encoding="utf-8")
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                if argv:
                    # argv path: the run_main shape the self-test uses, so --root is
                    # graded where a human would type it.
                    rc = main(["--root", str(root_dir)] + list(argv))
                else:
                    rc = main(argv=[], root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    OWN = "export type SettledRead<T> = { ok: true; value: T } | { ok: false };"
    COPY = "type BootRead<T> = { ok: true; value: T } | { ok: false };"
    COPY_MSG = "re-declares the settled-read verdict union"

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # Fixtures get their own directory under the temp root, so a directory added
        # beside one fixture can never fall inside another fixture's sweep.
        fixtures = Path(tempfile.mkdtemp(dir=tmp, prefix="fixtures_"))

        # rung 1 -- THE KILLING RUNG: a fixture copy is found, at its own file:line,
        # and named by this file's banner. A main() that ignored root would grade
        # ./ui/src (which sweeps 1575 files and exits 0) and fail all three demands.
        root = build({"utils/settle-read.ts": OWN, "features/x/Thing.tsx": COPY})
        rc, said = run(root)
        if (rc != 1 or "features/x/Thing.tsx:1" not in said
                or COPY_MSG not in said or (CENSUS_NAME + ":") not in said):
            print("  x rung 1: a fixture copy must exit 1 naming its own file:line, "
                  "the finding and this file's banner (rc=%r said=%r)"
                  % (rc, said[-260:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the exemption follows the ROOT: the fixture's own owner is clean.
        root = build({"utils/settle-read.ts": OWN})
        rc, said = run(root)
        if rc != 0 or "OK -- 1 file(s) swept" not in said or CENSUS_NAME not in said:
            print("  x rung 2: a fixture owner alone must exit 0 counting one file "
                  "(rc=%r said=%r)" % (rc, said[-260:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- nesting is swept: a copy two directories down is still a copy.
        root = build({"utils/settle-read.ts": OWN,
                           "features/a/b/deep/Thing.tsx": COPY})
        rc, said = run(root, "--json")
        if rc != 1 or '"file": "features/a/b/deep/Thing.tsx"' not in said:
            print("  x rung 3: a nested copy must be found through argv --json "
                  "(rc=%r said=%r)" % (rc, said[-260:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- a one-file corpus gets a VERDICT, not the empty-corpus refusal.
        root = build({"only.ts": "export const a = 1;"})
        rc, said = run(root)
        if rc != 0 or "OK -- 1 file(s) swept" not in said:
            print("  x rung 4: a one-file fixture must exit 0, not refuse "
                  "(rc=%r said=%r)" % (rc, said[-260:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the refusal floor is the FIXTURE's: nothing to sweep is rc 2,
        # and a nested --self-test through argv is skipped, not recursed.
        base = Path(tempfile.mkdtemp(dir=tmp, prefix="empty_"))
        (base / "README.md").write_text("no typescript here" + chr(10), encoding="utf-8")
        rc, said = run(base)
        if rc != 2 or "found no .ts/.tsx source file" not in said:
            print("  x rung 5: a fixture without sources must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-260:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6 -- --self-test through argv passes ALL 12 cases and skips the nested
        # ladder. Measured 243: this rung is what caught the nested case from rung 1's
        # own _things/ fixture running INSIDE the sweep and failing -- an over-broad
        # fixture, and the guard then masked it as "12/12 passed, ladder skipped".
        root = build({"utils/settle-read.ts": OWN})
        rc, said = run(root, "--self-test")
        if (rc != 0 or "ladder re-entry from a nested --self-test: skipped" not in said
                or "self-test: 12/12 passed" not in said):
            print("  x rung 6: --self-test through argv must pass 12/12 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-300:]), file=sys.stderr)
            return 1
        shell += 1

    print("%s SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % (CENSUS_NAME, shell))
    return 0


def main(argv, root=None):
    """Grade one tree. `root` names the directory to sweep, so a caller (the ladder,
    the self-test) can grade a fixture without an argv round trip; an argv `--root`
    still wins, because that is the one a human typed."""
    ap = argparse.ArgumentParser(
        description='one implementation of the settled-read verdict')
    ap.add_argument("--self-test", action="store_true",
                    help="prove the rule can still fail")
    ap.add_argument("--json", action="store_true", help="machine-readable findings")
    ap.add_argument("--root", default=None, metavar="PATH",
                    help="sweep PATH instead of <repo>/ui/src. A tree holding no source "
                         "file is refused, not reported clean.")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    root = Path(args.root or root or UI_SRC).resolve()
    swept = len(ui_sources(root))
    # THE FLOOR. "no re-declaration found" and "the sweep read nothing" both print OK, and
    # only one of them is a fact about the union. Measured 2026-11-06: a copy of this script
    # placed beside an empty ui/src printed "OK -- 0 file(s) swept" at exit 0. The live tree
    # sweeps 1575 files, so a floor of one is the whole difference between a verdict and a
    # shrug -- and exit 2, because 1 already means "a finding".
    if swept == 0:
        print(f"error: swept {root} and found no .ts/.tsx source file, so this run graded "
              f"nothing and its verdict would be about an empty corpus rather than about "
              f"{OWNER}. Pass --root PATH to name the tree you meant.", file=sys.stderr)
        return 2
    findings = find_copies(root)
    if args.json:
        print(json.dumps({"owner": OWNER, "swept": swept, "findings": findings}, indent=2))
        return 1 if findings else 0
    print(report(findings, swept))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
