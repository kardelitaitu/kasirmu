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
A checker that declares NO self-test of its own, under either convention. The
sibling convention (a docstring pointer to an existing scripts/test-*.py whose
bare invocation a live runner carries) was recognized 2026-11-08 -- before that,
scripts/check-replay-fork.py sat outside this gate's protection entirely, and
deleting its sibling's two runner invocations could not fail anything here.
What remains outside is a per-checker judgement: scripts/census-sync-ingest-admits.py
(a census that deliberately claims no runner authority) and
scripts/check-auditor-selftests.sh (itself a runner of other checkers' self-tests).
The OK line names them instead of absorbing them silently -- the count-prose gap
that a round-135 register entry then misread as three unwired checkers.

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


def declares_in(text: str) -> bool:
    """PURE: a quoted --self-test on a LIVE line declares a self-test.
    Round-95: the search ran over raw text, so a quoted flag in a comment
    declared -- the r84 semantics (comments cannot wire, load, invoke) now
    extend to declare."""
    return bool(re.search(r"""["']--self-test["']""", strip_full_line_comments(text)))


def declares_selftest(rel: Path) -> bool:
    try:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return declares_in(text)


PRINT_FORM = re.compile(r"\s*(?:-\s*)?(?:run:\s*)?(?:echo|printf|Write-Host|Write-Output)\b")


def wired_only_by_print(name: str, text: str) -> bool:
    """A checker whose every flag-mention in runners is a PRINT form, not a call.

    CALL_RE is deliberately unanchored (a step that pipes or redirects still
    calls the flag), which also lets a line that merely ECHOES the flag count
    as wiring -- a runner that prints instructions would report a checker wired
    that nothing invokes. Measured 2026-11-08: 188 flag-mention lines in the
    live runners, ZERO print-form (checked twice, with and without the YAML
    "- run:" prefix), so the acceptance is latent. Extracted (round-106) so the
    live case can GUARD the direction: a checker whose only flag-mentions are
    print-forms must surface, not pass silently.
    """
    stem = name.rsplit(".", 1)[0]
    hits = [ln for ln in text.split("\n")
            if re.search(re.escape(stem) + r"(?:\.[\w-]+)?[^\w.-]*--self-test", ln)]
    if not hits:
        return False
    return all(PRINT_FORM.match(ln) for ln in hits)


def in_attic(p: Path) -> bool:
    """A runner file under an attic/ directory is RETIRED and never counted.

    .github/workflows/attic/ holds retired workflows (measured 2026-11-07:
    eleven .bak files) and GitHub never executes one -- but a retired file that
    KEEPS a .y*ml suffix would be read by runner_text()'s walk and count as a
    live caller, which is how verify-flaky-quarantine.py once looked wired: its
    only two invocations were in ci.yml.bak and nightly.yml.bak. Case-insensitive
    so a rename to Attic/ cannot resurrect retired callers. Extracted (round-100)
    so runner_files() shares the filter instead of disagreeing with runner_text()
    about what a caller file is.
    """
    return "attic" in {q.lower() for q in p.parts}


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
                if in_attic(p):
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

# ── the sibling convention (2026-11-08) ─────────────────────────────────────
# One checker declares its self-test OUTSIDE its own body: scripts/check-replay-fork.py
# points at `python3 scripts/test-replay-fork.py` from its docstring, and that sibling IS
# the self-test (10 cases; it takes no flag, so CALL_RE can never see its caller). The
# embedded-only census therefore counted it among the "not declaring", which read as a
# coverage gap that was not one -- and worse, it put the checker OUT of this gate's
# protection: deleting the sibling's check.sh and dev-ci invocations could not fail this
# gate, because the checker never registered as declaring anything. The sibling convention
# becomes first-class here: a docstring pointer naming an EXISTING sibling declares, and
# the sibling's bare invocation is its caller signal. Two filters keep the declaration
# honest (both measured 2026-11-08, this gate's own round): a WHOLE-LINE COMMENT cannot
# declare -- the r84/r95 semantics run both directions, and this gate's own source is
# full of convention-shaped comments that otherwise self-declared -- and the pointer
# must share its line with the SELF-TEST: marker, because a bare mention in prose (this
# file's own case strings included) is not a claim. A pointer to a vanished sibling
# still declares nothing: a comment naming a file nobody can run is history.
SIBLING_PTR = re.compile(r"python3\s+(scripts/test-[A-Za-z0-9_-]+\.py)")


def sibling_from_text(text: str) -> "str | None":
    """PURE: the sibling path this checker declares, or None.

    A declaration is a LIVE line that carries the SELF-TEST: marker and the
    exact invocation spelling `python3 scripts/test-<name>.py` on the SAME
    line, after whole-line comments are stripped -- the r84/r95 semantics
    (comments cannot wire) run on the declaration side too. Two measured
    reasons this is not one filter: this gate's own source carries
    convention-shaped COMMENTS that self-declared under a raw-text scan
    (2026-11-08, found by the round-138 measurement), and its case strings
    carry marker+pointer pairs that a raw-text regex cannot tell from a
    claim. Case strings in this file must therefore point at NONEXISTENT
    siblings (test-x.py, test-ghost.py) -- a case string naming an existing
    sibling beside the marker would re-trigger the self-declaration.
    """
    for ln in strip_full_line_comments(text).split("\n"):
        if "SELF-TEST:" in ln:
            m = SIBLING_PTR.search(ln)
            if m:
                return m.group(1)
    return None


def sibling_declared(rel: Path) -> "str | None":
    """The sibling this checker declares, when that sibling EXISTS on disk."""
    try:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    sib = sibling_from_text(text)
    if sib is None or not (ROOT / sib).is_file():
        return None
    return sib


def sibling_called(sib_rel: str, text: str) -> bool:
    """Whether a LIVE runner line invokes the sibling.

    The sibling takes no flag -- the file being executed IS the self-test
    running -- so the caller signal is its basename with extension, on a
    comment-stripped runner line. Same comment-blindness as called(): a
    runner that only DOCUMENTS the sibling is not a caller. The round-106
    print-form trade-off is accepted here and GUARDED beside it: sibling_wired_only_by_print     surfaces a checker whose sibling is only ever echoed (measured this
    round: the live runners mention the one live sibling on exactly two
    lines, both real invocations).
    """
    stem = sib_rel.rsplit("/", 1)[-1]
    return any(stem in ln for ln in strip_full_line_comments(text).split("\n"))

def sibling_wired_only_by_print(sib_rel: str, text: str) -> bool:
    """Whether the sibling's every live mention is a PRINT form, not a call.

    The round-106 guard, ported (2026-11-08, this round): sibling_called() is
    deliberately unanchored -- a step that pipes, redirects, or even echoes the
    sibling still counts as a caller -- and that acceptance is latent the same
    way the flag-side one was: measured this round, the live runners mention the
    one live sibling on exactly two lines (check.sh:813, dev-ci.yml:1392), both
    real invocations, zero print-forms. The audit case in self_test GUARDS the
    direction: a checker whose sibling is only ever echoed must surface, not
    pass silently. No hits reads False -- nothing wired is nothing to guard.
    """
    stem = sib_rel.rsplit("/", 1)[-1]
    hits = [ln for ln in strip_full_line_comments(text).split("\n") if stem in ln]
    if not hits:
        return False
    return all(PRINT_FORM.match(ln) for ln in hits)


def uncalled_from(text: str) -> list[str]:
    """The census core: entries whose declared self-test no runner invokes.

    `called()` still matches on the BASENAME because that is what CALL_RE extracts from a
    runner line -- `python3 .agents/skills/.../check-cite-lines.py --self-test` yields
    `check-cite-lines`. So the path is split here, and the collision that a basename-only
    scope would hide is resolved by `checkers()` returning paths: two different programs
    named check-gate-runners.py are two entries, and each is matched on its own name.
    Round-93 honesty: the ENUMERATION is per-path, but the call signal is still the
    shared basename -- one copy's flag-invocation satisfies called() for both. The
    collided pair's flag-invocations are therefore graded by FULL path in self_test
    (round-93 cases), because called() cannot tell the copies apart.

    2026-11-08: a checker that declares a WIRED SIBLING instead of an embedded flag
    is censused by the sibling's bare invocation. Extracted from
    uncalled_selftests() so the sibling rot -- deleting a sibling's runners -- is
    gradable from synthetic text without the live tree. Entries carry as_posix()
    spellings: the report is read by humans and quoted by register entries, and a
    report whose separators flip with the OS quotes inconsistently.
    """
    out: list[str] = []
    for rel in checkers():
        if declares_selftest(rel):
            if not called(rel.name, text):
                out.append(rel.as_posix())
            continue
        sib = sibling_declared(rel)
        if sib is not None and not sibling_called(sib, text):
            out.append(rel.as_posix() + " (sibling " + sib + " uncalled)")
    return out


def uncalled_selftests() -> list[str]:
    """Checkers that declare a self-test no runner invokes, as relative paths."""
    return uncalled_from(runner_text())


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


def runner_files() -> list:
    """Every runner FILE: RUNNERS entries that are files, plus the .y*ml under
    directory entries (the workflows dir). Round-93: the full-path precision
    cases need per-file texts, which runner_text()'s single blob cannot key."""
    out = []
    for entry in RUNNERS:
        if entry.is_file():
            out.append(entry)
        elif entry.is_dir():
            out.extend(sorted(q for q in entry.rglob("*.y*ml")
                              if not in_attic(q)))
    return out


def collisions_of(pairs) -> dict:
    """PURE: basenames borne by more than one audited checker, from
    (basename, rel) pairs. Round-93, the partner side of the harness's r92
    seam: called() keys on basenames, so two copies sharing a name are ONE
    key -- a runner invoking either copy's self-test satisfies called() for
    both."""
    seen = {}
    for name, rel in pairs:
        seen.setdefault(name, []).append(rel)
    return {n: sorted(rels) for n, rels in seen.items() if len(rels) > 1}


def collided_audited() -> dict:
    """The audited set's collisions, live. The set has exactly one today --
    the same check-gate-runners.py pair the harness's census carries -- and
    the sibling case holds each collided copy's SELF-TEST to a full-path
    flag-invocation, because called() cannot tell the copies apart."""
    pairs = []
    for d in CHECKER_DIRS:
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.suffix not in (".py", ".mjs", ".sh"):
                continue
            if not SCRIPT_RE.match(f.name):
                continue
            try:
                if declares_selftest(f):
                    pairs.append((f.name, f.relative_to(ROOT).as_posix()))
            except OSError:
                continue
    return collisions_of(pairs)


def want_inventory(text: str) -> int:
    """PURE: the number of want() call sites in this gate's source, counted
    after full-line comment strips and excluding want's own def line. Round-94,
    the partner side of the harness's repair: the OK line's count was a
    hand-maintained literal (12 over 11 real sites) that no case read."""
    return len(re.findall(r"^[ \t]+want\(", strip_full_line_comments(text), re.M))


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

    # ── the declaration predicate is comment-blind (round-95) ─────────────────
    want("a quoted flag on a live line declares a self-test",
         declares_in('if "--self-test" in sys.argv: run()'), True)
    want("a quoted flag in a comment does not declare",
         declares_in('# x.py "--self-test" (documented, aspirational)'), False)
    # ── the audited set's basename collisions (round-93) ──────────────────────
    want("the collision classifier finds a synthetic pair",
         collisions_of([("a.py", "scripts/a.py"), ("a.py", "x/a.py"),
                        ("b.py", "scripts/b.py")]),
         {"a.py": ["scripts/a.py", "x/a.py"]})
    want("a collision-free audited set yields nothing",
         collisions_of([("a.py", "scripts/a.py")]), {})
    coll = collided_audited()
    want("the audited set has exactly one collision, the census's pair",
         coll,
         {"check-gate-runners.py": [".agents/skills/docs-auditor/scripts/check-gate-runners.py",
                                    "scripts/check-gate-runners.py"]})
    want("each collided copy's self-test is flag-invoked by full path",
         [any((rel + " --self-test") in strip_full_line_comments(
                  rf.read_text(encoding="utf-8", errors="replace"))
              for rf in runner_files())
          for rels in coll.values() for rel in rels],
         [True] * sum(len(rels) for rels in coll.values()))
    # The real tree must have the property, or this gate is not earning its place.
    want("the harness-dir parser reads the plain tuple",
         harness_census_dirs('CENSUS_DIRS = ("a", "b/c")'), ["a", "b/c"])
    live_src = (ROOT / "scripts" / "sabotage-selftests.py").read_text(
        encoding="utf-8", errors="replace")
    want("the census harness's dirs mirror this gate's audit dirs",
         harness_census_dirs(live_src),
         [d.relative_to(ROOT).as_posix() for d in CHECKER_DIRS])
    # ── the reading direction is named, never silent (round-99) ───────────────
    # This gate's worst failure mode is silent absence: a checker dir that
    # vanishes shrinks the audited set with no signal, an unreadable checker
    # reads as not-declaring (declares_selftest's OSError fallback), a vanished
    # runner silently drops its invocations. Grade the tree the gate reads,
    # with the missing name in the failure message, not in a swallowed except.
    def readable(rel):
        try:
            (ROOT / rel).read_text(encoding="utf-8", errors="replace")
            return True
        except OSError:
            return False
    want("every checker dir in scope exists",
         [str(d) for d in CHECKER_DIRS if not d.is_dir()], [])
    want("every runner this gate reads exists",
         [str(rt) for rt in RUNNERS if not rt.exists()], [])
    want("every audited checker is readable by name",
         [(str(rel), readable(rel)) for rel in checkers()],
         [(str(rel), True) for rel in checkers()])
    want("an unreadable checker reads as not-declaring -- the explicit fallback",
         declares_selftest(Path("no/such/checker.py")), False)
    want("a retired workflow under attic/ is never a runner file",
         [in_attic(Path(".github/workflows/attic/ci.yml")),
          in_attic(Path(".github/workflows/Attic/ci.yml")),
          in_attic(Path(".github/workflows/dev-ci.yml")),
          any(in_attic(f) for f in runner_files())],
         [True, True, False, False])
    # ── the audit's own report is graded, not just its verdict (round-102) ──
    rep102 = uncalled_report(["scripts/verify-flaky.py", "scripts/verify-wired.py"])
    want("an uncalled report names each checker with an honest count",
         [rep102.startswith("verify-selftests-wired: 2 self-test(s) invoked by no runner"),
          rep102.count("scripts/verify-flaky.py"),
          rep102.count("scripts/verify-wired.py"),
          rep102.count("-- declares --self-test, but no runner passes the flag"),
          rep102.count("verify-selftests-wired: 3 self-test(s)")], [True, 1, 1, 2, 0])
    want("the clean audit's line is derived from the census, not hardcoded",
         [wired_ok_line(17, 100).count("17 of 100 checker(s)"),
          wired_ok_line(0, 1).count("0 of 1 checker(s)")], [1, 1])
    # ── the unanchored CALL_RE's named trade-off is pinned and guarded (round-106) ──
    want("the named trade-off is pinned: an echoed flag still counts as wiring",
         [called("verify-x.py", 'run: echo "python3 scripts/verify-x.py --self-test"'),
          called("verify-x.py", "run: python3 scripts/verify-x.py --self-test 2>&1 | tee log"),
          called("verify-x.py", "bash -c 'python3 scripts/verify-x.py --self-test' || true")],
         [True, True, True])
    text106 = runner_text()
    want("no live checker is wired only by a runner that merely prints",
         [str(rel) for rel in checkers() if declares_selftest(rel)
          and wired_only_by_print(rel.name, text106)], [])
    want("print-form-only wiring reads as wired-only-by-print, a real call does not",
         [wired_only_by_print("verify-x.py", 'run: echo "python3 scripts/verify-x.py --self-test"'),
          wired_only_by_print("verify-x.py", "run: python3 scripts/verify-x.py --self-test"),
          wired_only_by_print("verify-x.py", "nothing relevant here"),
          wired_only_by_print("verify-x.py",
                              'run: echo "x --self-test"\nrun: python3 scripts/verify-x.py --self-test')],
         [True, False, False, False])
    # ── the sibling declaration convention (2026-11-08) ────────────────────────
    want("a docstring pointer declares its sibling",
         sibling_from_text("SELF-TEST: `python3 scripts/test-x.py` (10 cases)."),
         "scripts/test-x.py")
    want("prose mentioning a test- file does not declare",
         sibling_from_text("compare with scripts/test-other.py for style"), None)
    want("a commented pointer does not declare -- r95 runs both directions",
         sibling_from_text("# SELF-TEST: `python3 scripts/test-ghost.py` (aspirational)"),
         None)
    want("the gate's own convention-shaped source does not self-declare",
         sibling_declared(Path("scripts/verify-selftests-wired.py")), None)
    want("the live tree has exactly one sibling-declared checker",
         [rel.as_posix() for rel in checkers() if sibling_declared(rel)],
         ["scripts/check-replay-fork.py"])
    want("the live sibling pointer resolves to an existing file",
         [sibling_declared(Path("scripts/check-replay-fork.py")),
          (ROOT / "scripts/test-replay-fork.py").is_file()],
         ["scripts/test-replay-fork.py", True])
    text_now = runner_text()
    want("the live sibling is invoked by a runner",
         sibling_called("scripts/test-replay-fork.py", text_now), True)
    want("a comment-only mention of the sibling is not a caller",
         sibling_called("scripts/test-replay-fork.py",
                        "# python3 scripts/test-replay-fork.py (documented, uncalled)"),
         False)
    want("a different file's invocation is not this sibling's caller",
         sibling_called("scripts/test-replay-fork.py",
                        "run: python3 scripts/test-other.py"), False)
    want("the round-106 guard, ported: an echoed sibling is wired-only-by-print",
         [sibling_wired_only_by_print("scripts/test-x.py",
                                      'run: echo "python3 scripts/test-x.py"'),
          sibling_wired_only_by_print("scripts/test-x.py",
                                      "run: python3 scripts/test-x.py"),
          sibling_wired_only_by_print("scripts/test-x.py", "nothing relevant here")],
         [True, False, False])
    # THE ROT THE EXTENSION CLOSES: with the sibling's runners deleted, the checker
    # must surface as uncalled -- before this round it could not, because it never
    # registered as declaring anything. Synthetic text: no sibling callers at all.
    want("deleting a sibling's runners surfaces the checker",
         [n for n in uncalled_from(
             "run: python3 scripts/check-replay-fork.py\\n"
             "run: python3 scripts/verify-x.py --self-test\\n")
          if n.startswith("scripts/check-replay-fork.py")],
         ["scripts/check-replay-fork.py (sibling scripts/test-replay-fork.py uncalled)"])
    want("the live tree has no uncalled self-test under either convention",
         uncalled_from(text_now), [])
    want("no live sibling is wired only by a runner that merely prints",
         [rel.as_posix() for rel in checkers()
          if (sib := sibling_declared(rel))
          and sibling_wired_only_by_print(sib, text_now)], [])
    want("the sibling remedy names the sibling, not the flag",
         [uncalled_report(["scripts/check-replay-fork.py (sibling scripts/test-replay-fork.py uncalled)"])
          .count("no runner invokes that sibling"),
          uncalled_report(["scripts/verify-x.py"])
          .count("-- declares --self-test, but no runner passes the flag")],
         [1, 1])
    want("the OK line names the non-declarers and the empty case",
         [wired_ok_line(103, 105, ["scripts/census-x.py", "scripts/check-auditor-selftests.sh"])
          .count("Declaring none of their own: scripts/census-x.py"),
          wired_ok_line(105, 105, []).count("Every checker in scope declares a self-test of its own."),
          wired_ok_line(17, 100).count("17 of 100 checker(s)")],
         [1, 1, 1])
    live = uncalled_selftests()
    if live:
        bad.append("live tree has " + str(len(live)) + " uncalled self-test(s): "
                   + ", ".join(live))

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print(f"SELF-TEST OK ({want_inventory(Path(__file__).read_text(encoding='utf-8'))} cases, no files touched)")
    return 0


def uncalled_report(live: list[str]) -> str:
    """The named failures: an honest count in the header, one remedy line per checker.

    The report is the gate's product -- a header count that lies about the number
    of names under it, or a checker that goes unnamed, sends the operator to
    rediscover what this file exists to report. Extracted from main() (round-102)
    so the shape -- count == len(live), every checker named beside its remedy --
    is GRADED, not assumed.
    """
    head = f"verify-selftests-wired: {len(live)} self-test(s) invoked by no runner:"
    body = ""
    for n in live:
        if " (sibling " in n:
            body += (
                f"\n    {n} -- the checker declares its self-test as a sibling script, "
                f"and no runner invokes that sibling. Restore a step beside its gate in "
                f".github/workflows/dev-ci.yml and scripts/check.sh, or fold the "
                f"sibling's cases into the checker itself.")
        else:
            body += (
                f"\n    {n} -- declares --self-test, but no runner passes the flag. "
                f"Add a step beside its gate in .github/workflows/dev-ci.yml and "
                f"scripts/check.sh, or delete the flag if it was never meant to run.")
    return head + body


def wired_ok_line(declared: int, total: int, rest: "list[str] | None" = None) -> str:
    """The clean-audit line, derived from the census the same way the verdict is.

    Round-102: "17 of 100" must be COUNTED, not typed -- a hardcoded N of M
    would keep reading as green after the census changed under it.

    2026-11-08: the checkers that declare nothing of their own are NAMED in
    the OK line. An OK line that silently absorbs them is where the round-135
    register misread came from: two of the three "not declaring" were fully
    wired under their own conventions, and only this prose hid that.
    """
    line = (f"verify-selftests-wired: OK — {declared} of {total} checker(s) in scope "
            f"declare a self-test and every one is invoked by a runner.")
    if rest is None:
        return line
    if rest:
        return line + " Declaring none of their own: " + ", ".join(rest) + "."
    return line + " Every checker in scope declares a self-test of its own."


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    live = uncalled_selftests()
    all_checkers = checkers()
    total = len(all_checkers)
    declared = sum(1 for n in all_checkers
                   if declares_selftest(n) or sibling_declared(n) is not None)
    rest = [n.as_posix() for n in all_checkers
            if not declares_selftest(n) and sibling_declared(n) is None]
    if live:
        print(uncalled_report(live))
        return 1
    print(wired_ok_line(declared, total, rest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
