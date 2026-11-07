#!/usr/bin/env python3
"""verify-selftests-wired.py -- fail when a checker's --self-test is invoked by nobody.

WHY
===
A checker's `--self-test` is its liveness proof: the cases that prove the gate
can still FAIL, which no bare run of the gate can see. The repo's own convention,
stated at "IPC command parity self-test" in dev-ci.yml, is that the self-test lives
BESIDE the gate it proves. Following the convention is only half of it. A self-test
that no runner invokes is a self-test that can rot in silence, and the rot is
invisible: the cases still pass when someone runs them by hand, and nothing tells
anyone that nobody does.

This file exists because that exact state had accumulated. Measured on
2026-09-29: of 28 scripts/verify-*.py, 24 declared a --self-test and NINE of those
were invoked from no runner at all -- dev-ci.yml, scripts/check.sh and
.githooks/pre-commit combined. One of the nine (verify-migration-column-types.py)
had been printing "LIMIT: nothing calls this flag" in its own report for a while;
the other eight did not know.

The gate is deliberately narrow. It does not decide WHICH runner should invoke a
self-test, or whether a given self-test is any good -- it answers one question:
does the flag have a caller? A self-test invoked only by check.sh counts; so does
one invoked only by CI. Being invoked SOMEWHERE is the property that stops the rot.

WHAT IT DOES NOT COVER
======================
A checker with no --self-test at all. That is the gap this file cannot close,
because "should this gate have a self-test" is a judgement per checker; the sweep
that found the nine is recorded in the docstring above so the next one to be added
knows the convention exists.

AND a checker whose FILE NAME falls outside the pattern. SCRIPT_RE matches
`^(?:verify|check)-NAME` with a suffix of `py`, `mjs` or `sh`, and one qualifying script is
neither: it is
`generate-latest-json.mjs`.

CORRECTED 2026-10-05 (round 147). This paragraph previously said Node checkers were
"invisible here" because the glob was assumed to be `verify-*/check-*`. That was wrong:
SCRIPT_RE covers `.mjs` and `.sh` as well as `.py`, and checkers() returns 10 `.mjs` and 8
`.sh` files alongside 47 `.py`. The real gap is one NAME, not one LANGUAGE -- and the wrong
version would have sent the next reader to widen a glob that was already wide.

MEASURED: `generate-latest-json.mjs` declares the quoted `--self-test` and HAS three
callers (scripts/check.sh:856, dev-ci.yml:1565, release.yml:324), so nothing is currently
dead. What is missing is only the policing: if one of those three invocations were removed
tomorrow, this gate could not see it. So the gap is prospective here too.

WHY IT IS STILL NOT WIDENED to `generate-*`: the prefix is the one signal separating a
checker from a generator that merely accepts a flag, and `generate-latest-json.mjs` is the
only script that would be added. A pattern admitting every `generate-*` with a self-test
would need the argv/exports judgement for all of them, which is the problem named below.
Named rather than left to be rediscovered.

MEASURED 2026-10-05, and the guess is avoidable. The judgement the paragraph above calls
unmakeable has an operational definition: a Node CHECKER reads `process.argv` and mentions
`--self-test` outside a comment; a LIBRARY imports and exports. Under that test the repo
has FIVE Node checkers with a self-test, not one -- check-release-version, check-testid,
check-updater-compat, generate-latest-json and verify-updater-signature -- and every one is
invoked by a runner (check.sh and/or dev-ci.yml and/or release.yml). So the current tree is
clean, and the gap is prospective: nothing stops a sixth from being added uncalled.

`updater-crypto.mjs` is the FALSE POSITIVE that makes the point. It is a library whose
header says it is shared helpers for two of the five, it declares no CLI, and it contains
zero `process.argv` -- but it matched a naive text search on `--self-test` because three of
its COMMENTS describe the primitives its consumers use in theirs. Running it exits 0 with
no output, which reads as "the self-test passed" and is really "nothing happened". A gate
built on the text search would have reported a phantom uncalled self-test; this is why the
scope note warns against widening the glob without the argv/exports distinction.

Exit 0 clean, 1 uncalled self-test(s), 2 usage or self-test failure.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "scripts"
# Every directory that holds a checker following the verify-*/check-* convention. The
# list, not a single directory: the docs-auditor and website checkers are checkers by the
# same convention and were being skipped entirely (10 of them declare a --self-test).
CHECKER_DIRS = (
    ROOT / "scripts",
    ROOT / ".agents" / "skills" / "docs-auditor" / "scripts",
    ROOT / "website" / "scripts",
)
# Every place a self-test can legitimately be invoked from. A gate that only knows
# about CI would call every check.sh-only self-test dead, and check.sh is a real
# runner even though it is manual.
RUNNERS = (
    ROOT / ".github" / "workflows",
    ROOT / "scripts" / "check.sh",
    ROOT / "scripts" / "check.ps1",
    ROOT / ".githooks" / "pre-commit",
    # The push-side hook. It names no checker today (measured 2026-11-07:
    # zero verify-*/check-* or --self-test lines), but the census gate scans it
    # for wiring, and a self-test wired into it tomorrow would be reported
    # uncalled by THIS gate if the hook stayed invisible here -- the
    # false-finding failure mode that gets a gate muted. Added by round 74's
    # runner-list reconciliation, which works both ways.
    ROOT / ".githooks" / "pre-push",
    # A runner can be a SCRIPT whose job is to run self-tests. `check-auditor-selftests.sh`
    # loops over eight docs-auditor checkers and passes --self-test to each; it is invoked
    # by check.sh and by dev-ci.yml, so every one of those eight IS wired. Leaving it out
    # of this list reported six of them as uncalled the moment the checker scope was
    # widened to their directory -- a false finding, which is the failure mode that gets
    # a gate muted. Found 2026-10-23 by widening CHECKER_DIRS.
    ROOT / "scripts" / "check-auditor-selftests.sh",
    # The website's npm scripts. Its checkers are invoked from package.json -- precheck
    # runs check-password-policy.mjs and vitest, check:seo runs check-seo.mjs -- and
    # NOTHING in check.sh or a workflow names them, because the website builds itself.
    # Without this entry a website checker wired into precheck read as UNCALLED, which is
    # the same false finding check-auditor-selftests.sh was added to stop: a runner that
    # exists being reported as a missing one gets gates muted. Found 2026-10-23 while
    # wiring check-password-policy.mjs's self-test into precheck.
    ROOT / "website" / "package.json",
    # The UI's npm scripts, for the same reason. check-ui.mjs is invoked ONLY as
    # `node ../scripts/check-ui.mjs` from ui/package.json's check:all — nothing in
    # check.sh or a workflow names it, because it is the aggregator those call.
    # Without this entry its self-test reads as UNCALLED while it is wired.
    ROOT / "ui" / "package.json",
)
# verify-* and check-*. `generate-*` is deliberately absent: `generate-latest-json.mjs`
# declares a --self-test and has three callers, but it is a GENERATOR that accepts a flag
# rather than a checker, and it is the only such script -- admitting the prefix would add
# one entry and require judging every future generate-*. See the scope note in the
# docstring; this line and that paragraph must move together.
# verify-*, check-*, classify-* and census-*. The two latter prefixes were added
# 2026-10-25 (round 157) after both new checkers landed with a --self-test that this
# gate could not see: `classify-finding-reachability.py` and `census-orphan-modules.py`
# each declare one and each are invoked by scripts/check.sh, but neither name starts
# with verify- or check-, so the gate that exists to prove self-tests are wired
# reported them as absent from its corpus rather than as wired. This is the SAME
# defect the docstring at :144-150 records for the verify-only era, and it was found
# the same way: by adding a checker and noticing the total did not move.
#
# `generate-*` remains deliberately absent for the reason at :120-124.
SCRIPT_RE = re.compile(r"^(?:verify|check|classify|census)-[A-Za-z0-9_-]+\.(?:py|mjs|sh)$")
# "<name>.py --self-test" anywhere on the line. Deliberately not anchored to a
# command position: a step that pipes or redirects still calls the flag, and a
# grep that misses those would report a false finding, which is the failure mode
# that gets a gate muted.
CALL_RE = re.compile(r"([A-Za-z0-9_-]+)\.(?:py|mjs|sh)\s+--self-test")


def checkers() -> list[Path]:
    """Every checker file this gate audits, as a path relative to ROOT.

    **A PATH, not a basename.** The scope was bare names while it covered a single
    directory, and that only worked by accident: one directory cannot produce a collision.
    It nearly produced one anyway -- `check-gate-runners.py` exists in BOTH `scripts/`
    and `.agents/skills/docs-auditor/scripts/`, and they are DIFFERENT programs (the
    scripts/ one cross-checks gates.json; the docs one fails a required gate that no
    runner can reach). Widening the scope without changing this would have merged them
    into one entry and hidden whichever has fewer --self-test hits.

    check-*.py as well as verify-*.py. The scope was verify-only at first and that was
    too narrow: check-chokepoints.py declares a --self-test that no runner invokes, and
    the gate reported every self-test as wired. A gate whose scope is narrower than the
    convention it enforces cannot see half the rot it exists to catch. The same argument
    applies to DIRECTORIES, and it took a round to notice: the docs-auditor and website
    checkers were outside SCRIPT_DIR entirely, so ten self-tests (8 docs-auditor + 2
    website) were never audited at all.
    """
    found: list[Path] = []
    for base in CHECKER_DIRS:
        if not base.is_dir():
            continue
        for p in sorted(base.iterdir()):
            if p.is_file() and SCRIPT_RE.match(p.name):
                found.append(p.relative_to(ROOT))
    return found


def declares_selftest(rel: Path) -> bool:
    try:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return bool(re.search(r"""["']--self-test["']""", text))


def runner_text() -> str:
    parts: list[str] = []
    for r in RUNNERS:
        if r.is_dir():
            for p in sorted(r.rglob("*.yml")) + sorted(r.rglob("*.yaml")):
                # .github/workflows/attic/ holds RETIRED workflows, and GitHub never
                # executes a .bak. Counting one as a caller would report a checker as
                # wired on the strength of a runner that stopped existing months ago --
                # which is how verify-flaky-quarantine.py looked live: its only two
                # invocations were in ci.yml.bak and nightly.yml.bak. Measured, not
                # assumed: the attic here is where the false negative came from.
                if "attic" in {q.lower() for q in p.parts}:
                    continue
                try:
                    parts.append(p.read_text(encoding="utf-8", errors="replace"))
                except OSError:
                    pass
        elif r.is_file():
            try:
                parts.append(r.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    return "\n".join(parts)


def strip_full_line_comments(text: str) -> str:
    """Drop WHOLE-LINE comments before matching a caller.

    Necessary because a checker that documents its own dead flag does so in a
    comment -- verify-migration-column-types.py printed "LIMIT: nothing calls this
    flag" beside the flag it declared, and counting that line as a caller would
    report the one checker in the tree that KNOWS it is unwired as wired. The exact
    failure this gate exists to prevent, reproduced inside the gate.

    Deliberately whole-line only. Stripping to the first "#" would also cut a "#"
    inside a quoted string -- a URL fragment, a colour escape -- and could hide a
    real call, which is the false-negative direction that matters. A trailing
    comment on a line that also carries a real call is left counted, and that
    under-reporting is named here rather than papered over.
    """
    return "\n".join(ln for ln in text.split("\n") if not ln.lstrip().startswith("#"))


def called(name: str, text: str) -> bool:
    # Strip the ACTUAL extension. This was hardcoded to ".py" and went wrong the
    # moment .mjs checkers entered scope: name[:-3] turned "check-testid.mjs" into
    # "check-testid.m", which matched nothing, so the four Node self-tests were reported
    # uncalled even after being wired. A hardcoded length is a silent no-op waiting for
    # the next file type.
    stem = name.rsplit(".", 1)[0]
    return any(m.group(1) == stem for m in CALL_RE.finditer(strip_full_line_comments(text)))


def uncalled_selftests() -> list[str]:
    """Checkers that declare a --self-test no runner invokes, as relative paths.

    `called()` still matches on the BASENAME because that is what CALL_RE extracts from a
    runner line -- `python3 .agents/skills/.../check-cite-lines.py --self-test` yields
    `check-cite-lines`. So the path is split here, and the collision that a basename-only
    scope would hide is resolved by `checkers()` returning paths: two different programs
    named check-gate-runners.py are two entries, and each is matched on its own name.
    """
    text = runner_text()
    return [str(rel) for rel in checkers()
            if declares_selftest(rel) and not called(rel.name, text)]


def harness_census_dirs(text: str) -> list[str]:
    """The sabotage harness's CENSUS_DIRS as repo-relative strings, from its
    source. Round-88, the mirror side: the harness grades THIS gate's
    CHECKER_DIRS, and this case grades the harness's census dirs back. If one
    gate widens its audit scope alone, the unshared dirs go unaudited by the
    other -- the tuple is plain quoted whole paths, so a quoted-string scan
    over the assignment is the whole parse. A missing block parses to [],
    which reddens the mirror case.
    """
    block = re.search(r"CENSUS_DIRS\s*=\s*\(([^)]*)\)",
                      strip_full_line_comments(text), re.S)
    if block is None:
        return []
    return re.findall(r'"([^"]+)"', block.group(1))


def self_test() -> int:
    """Pure over synthetic runner text; no file is created or written. The two
    live reads are the tree audit below and (round-88) the harness's CENSUS_DIRS
    source, each held to its own mirror case."""
    bad: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # A runner line with the flag IS a caller -- the property that stops the rot.
    want("a flag invoked in a runner counts",
         called("verify-x.py", "run: python3 scripts/verify-x.py --self-test"), True)
    # Indented, quoted, or trailing-flag forms are the same call.
    want("indented step still counts",
         called("verify-x.py", "      - name: t\n        run: python3 scripts/verify-x.py --self-test"), True)
    # A different checker's self-test is not this one's caller.
    want("another checker's call is not a caller",
         called("verify-x.py", "python3 scripts/verify-y.py --self-test"), False)
    # Naming the checker without the flag is not a call -- this is the exact state
    # the gate exists to catch: the gate runs, its self-test does not.
    want("a bare gate invocation is not a caller",
         called("verify-x.py", "python3 scripts/verify-x.py"), False)
    # The flag in a comment is not a call either, and counting it would make the
    # gate pass on a checker that is still unwired.
    want("a comment mentioning the flag is not a caller",
         called("verify-x.py", "# python3 scripts/verify-x.py --self-test  (documented, uncalled)"), False)

    # The real tree must have the property, or this gate is not earning its place.
    want("the harness-dir parser reads the plain tuple",
         harness_census_dirs('CENSUS_DIRS = ("a", "b/c")'), ["a", "b/c"])
    live_src = (ROOT / "scripts" / "sabotage-selftests.py").read_text(
        encoding="utf-8", errors="replace")
    want("the census harness's dirs mirror this gate's audit dirs",
         harness_census_dirs(live_src),
         [d.relative_to(ROOT).as_posix() for d in CHECKER_DIRS])
    live = uncalled_selftests()
    if live:
        bad.append("live tree has " + str(len(live)) + " uncalled self-test(s): "
                   + ", ".join(live))

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (8 cases, no files touched)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    live = uncalled_selftests()
    total = len(checkers())
    declared = sum(1 for n in checkers() if declares_selftest(n))
    if live:
        print(f"verify-selftests-wired: {len(live)} self-test(s) invoked by no runner:")
        for n in live:
            print(f"    {n} -- declares --self-test, but no runner passes the flag. "
                  f"Add a step beside its gate in .github/workflows/dev-ci.yml and "
                  f"scripts/check.sh, or delete the flag if it was never meant to run.")
        return 1
    print(f"verify-selftests-wired: OK — {declared} of {total} checker(s) in scope "
          f"declare a --self-test and every one is invoked by a runner.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
