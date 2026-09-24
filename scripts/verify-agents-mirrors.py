#!/usr/bin/env python3
r"""
scripts/verify-agents-mirrors.py — Keep the AGENTS.md mirrors telling the truth.

WHY THIS EXISTS
===============

There are two copies of the agent rules: root `AGENTS.md` and
`.agents/management/AGENTS.md` (moved there from `.agents/AGENTS.md` by
`edd97e5c0`, which reorganized `.agents/` into subdirectories).
A third, `.prime/AGENTS.md`, existed until 08-09-26 and was deleted with the `.prime/`
tree; the per-mirror mutation table it needed went with it. `.agents/management/AGENTS.md`
documents the hazard itself:

  "scripts/bump-version.ps1 updates the *version* lines in these mirrors but
   nothing updates the *gate* list ... which is how all three drifted to different
   counts."

Counts drifting is cosmetic. **Claims going false is not.** Twice in 0.0.36 a
mirror stated something the repo contradicted:

  * `.agents/AGENTS.md` said "Steps 6, 7 and 8 have no CI backstop" after
    `13f2a1dc` put Go into `dev-ci.yml#static-gates`. An agent reading the mirror
    that governs work under `.agents/` would believe Go changes are unguarded.
  * root `AGENTS.md` said dev-ci "runs on every PR and push". It has no `push`
    trigger at all, so pushing a branch runs nothing.

Both were corrected by hand. This script is what stops the third occurrence.

GROUND TRUTH IS READ, NEVER ASSERTED
====================================

Nothing here hardcodes a version, a gate count, a step number, or which step is
Go. All of it comes from the repo:

  version        root Cargo.toml `[workspace.package] version`
  gate count     `^# ── <name> ─` section headers in .githooks/pre-commit
  which step is Go   the ordinal of the section whose text mentions `gofmt`
  what CI runs   job names in .github/workflows/*.yml (not *.yml.bak)
  CI triggers    the `on:` block of each live workflow

So bumping the version, adding a gate, or restoring a job updates the expectations
automatically -- and a mirror that does not follow is a finding.

WHAT IT CHECKS
==============

  1. GATE COUNT -- a mirror claiming N steps against a hook with M sections. The
     hook is counted twice, in the working tree and as committed (`git show
     HEAD:.githooks/pre-commit`), because a mirror is committed ALONGSIDE the hook and
     the claim has to agree with the hook as committed, not as currently typed. When
     the two counts differ, only a claim that matches the working tree and contradicts
     the commit is a problem; anything else is another lane mid-edit, printed as a
     notice that cannot fail the run -- a permanent cross-repo red trains people to
     ignore the gate.
  1b. ENUMERATION MEMBERSHIP -- a mirror that lists the steps by name is checked
      against the hook's section NAMES, not only their count: seven wrong names still
      read as "seven steps", which is how a file can state the right number and
      describe the wrong hook. Both directions are findings -- dropping a gate the hook
      runs, and naming a gate the hook does not run. The expected names come from the
      COMMITTED hook, the same surface the count is graded against, with the working copy
      used only as a fallback that says it is a fallback. A numbered list that never
      claimed to enumerate the steps is left alone, and so is any item whose OWN line is
      marked as history by the same HISTORICAL_MARKERS notion the skill parser uses --
      per item, because a revision note on one line must not excuse the six claims beside
      it. Order within the list and one-label-covers-two-gates ambiguity are not policed
      yet; both are known and named in step_enumerations.
  2. FALSE CI COVERAGE CLAIM -- a mirror listing step K as "no CI backstop" /
     "local-only" when a live workflow actually runs it. This is the check that
     catches the bug class that motivated the script.
  3. MISSING COVERAGE CLAIM -- a mirror asserting CI runs something no live
     workflow runs (the inverse lie).
  4. COMMIT TYPES -- the documented `<type>` list must equal what
     .githooks/commit-msg actually accepts. A mirror omitting a valid type
     forbids work the gate allows.
  5. VERSION LOCK -- every mirror must carry the current version.
  6. TRIGGER CLAIMS -- both directions: "CI runs on push" must match a workflow that
     declares one, and "there is no push trigger" must match one that does not. Graded
     per workflow (the workflow the sentence names decides), never OR-ed across them.
     Every exemption reaches only as far as its reason: a dated record, a quoted phrase,
     a branch FILTER, checker prose adjacent to the claim -- not the whole paragraph.
  7. JOB TOTALS -- a claim of the form "N jobs" / "ten jobs" / "eleven jobs" (and five
     other shapes: the "Jobs (N):" heading, a table row "| Jobs | N |", a plain-colon
     "Job count: N" / "jobs: N", a restated "eleven (11) jobs", and a table cell) must
     equal the number of top-level jobs across the LIVE workflows -- or, when the claim
     names a workflow, that workflow's own count. The word table reaches fifteen, and
     the patterns are BUILT from it so the two cannot drift. Six prose files carry the
     number: the two MIRRORS plus scripts/check.sh, docs/operations/agent-gates.md and
     CONTRIBUTING.md, and (added after a falsification pass measured them carrying the
     same claim ungraded) docs/operations/agent-lanes.md, .agents/skills/pr-repair/
     SKILL.md, .agents/skills/tdd/SKILL.md and docs/operations/ci-pipeline.md. The
     original three carried the WRONG total for two releases because nothing compared it
     to the real list. Ground truth is read per workflow, then summed.
  8. MIRROR TARGETS -- a claim naming a workflow ("mirrors .github/workflows/ci.yml",
     "mirrors CI \`dev-ci.yml#website\`") must name a LIVE workflow, and where it names
     a job, that job must be a key under jobs: in the workflow it names -- or in some
     live workflow when it names none. A job is reached three ways: a code span, a
     workflow#job token, and (added 2026-09-21) a BARE name in a sentence that also names
     a live workflow -- "mirrors CI static-gates job in dev-ci.yml" was the same claim
     made invisible by a missing backtick. A target under attic/ or ending .bak is a
     failure: naming a RETIRED workflow as the thing you mirror is the claim, and no
     checker saw it because "mirrors" used to be a checker-prose EXEMPTION token -- which
     is how scripts/check.ps1's header kept pointing at attic/ci.yml.bak. The rule's own
     negation skip is two-sided and past-tense aware, because a file that RECORDS a
     retirement ("mirrors no workflow: ... was retired to ...bak") is not a claim that
     its target is live; self-test case (18a) pins both halves -- the record stays silent
     while a present-tense claim on the same file is graded.

RESIDUAL GAPS (named, not silent)
=================================

Every rule below states what it cannot see, in its own docstring, at the place a reader
would look for it. These are the ones a falsification pass raised and this file does NOT
close, with the reason:

  * A job total written as "1,000 jobs" or as a range ("10-14 jobs") is not read. A
    thousands separator splits the number from its noun and prose here writes both a job
    count and a test count in that form; a range is two claims, not one. No shipped file
    uses either shape, so closing it would add a rule nothing exercises -- see
    job_total_claims().  [rule 7]
  * The heading and table total forms must OPEN their line, so "| x | Jobs | 10 |" is
    not read. Loosening the anchor is how the word "Jobs" starts matching ordinary prose.
    [rule 7]
  * Rule 1b's enumeration membership still reads only "N. **label**" runs, so a mirror
    that renders its steps as a table leaves the numeral checked and the names ungraded.
    Widening the matcher to tables was built and removed once already (the loose name
    matcher turned a one-word cell in an unrelated table into evidence); it stays open
    until the cardinality/ambiguity rule is written.  [rule 1b]
  * A bare, un-backticked job name is read ONLY inside a sentence that also names a live
    workflow. An unscoped bare name cannot be graded without a heuristic about what
    "reads like a job", which is the false positive the scoping exists to avoid -- see
    mirror_target_findings().  [rule 8]

Usage:
    python3 scripts/verify-agents-mirrors.py
    python3 scripts/verify-agents-mirrors.py --self-test
"""

from __future__ import annotations

import contextlib
import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")  # type: ignore[attr-defined]

# The root used when no path is given on the command line. Resolved through git FIRST:
# the old constant was script-relative (Path(__file__).parent.parent), which is the
# directory holding scripts/ -- right in a normal checkout and quietly WRONG in a worktree,
# a copied script, or an installed copy, where it points at a tree that is not the repo at
# all. A worker hit exactly that at 11:20 and had to pass repo_root explicitly to get a
# meaningful run, which is the anchor defect: the default resolved to somewhere else and
# the walk then came back empty. So git's own answer wins, and the script-relative path
# survives only as the documented fallback for a machine where git cannot answer, with the
# reason recorded in ROOT_SOURCE so no reader has to guess which root was walked.
def _git_toplevel(cwd: Path) -> str | None:
    try:
        proc = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=str(cwd),
                              capture_output=True, text=True, errors="replace", timeout=20)
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout.strip()
    return out or None


def resolve_root(start: Path | None = None) -> tuple[Path, str]:
    """(root, how it was chosen) -- git first, script-relative only when git is unavailable.

    start defaults to this script's own directory, so the answer describes the tree the
    checker was copied into, not whoever happens to have run it.
    """
    here = (start if start is not None else Path(__file__).resolve().parent)
    top = _git_toplevel(here)
    if top:
        return Path(top), "git rev-parse --show-toplevel"
    return here.parent, "script-relative fallback, git could not answer"


DEFAULT_ROOT, ROOT_SOURCE = resolve_root()

MIRRORS = ["AGENTS.md", ".agents/management/AGENTS.md"]

# Files whose prose states a job TOTAL, or scopes a gate to a CI job by name. The two
# MIRRORS carry the rules; the other three carry the same claims in their own words --
# scripts/check.sh in its gate headers, agent-gates.md in its "Jobs (N)" heading, and
# CONTRIBUTING.md in the paragraph that warns contributors off a retired job. All three
# carried the wrong total for two releases (the audit that produced rule 7), and none of
# them is a mirror, so a MIRRORS-only walk would leave the rot exactly where it was.
PROSE_FILES = MIRRORS + ["scripts/check.sh", "docs/operations/agent-gates.md",
                         "CONTRIBUTING.md", "scripts/check.ps1"]

# The LIVE carriers of the same claims, measured rather than assumed: each is a file
# that states a job total or a "mirrors <target>" TODAY, and none of them was policed.
# agent-lanes.md says "dev-ci.yml's eleven jobs" in its Lane-scoped CI bullet, and
# pr-repair/SKILL.md says "runs 11 jobs" twice (its own correction of a stale "38+ jobs"
# claim -- exactly the kind of repaired number a checker must hold in place). Skills are
# otherwise reached only by the step-count rule; the job-total and mirror-target rules
# scanned MIRRORS + PROSE_FILES and so read neither file. Kept as its own constant rather
# than appended to PROSE_FILES because PROSE_FILES is what the "five prose files carry the
# number" contract of rule (7) names, and a file ABSENT from here is skipped by the
# caller -- which is how ci-pipeline.md stays out below.
JOB_PROSE_FILES = ["docs/operations/agent-lanes.md",
                   ".agents/skills/pr-repair/SKILL.md",
                   # tdd/SKILL.md names the retired `ci.yml` in a sentence that RECORDS the
                   # retirement ("mirrors no workflow: ... was retired to .../ci.yml.bak").
                   # It is policed precisely because it is the file whose addition to the
                   # set exposed the over-narrow negation skip -- see MIRROR_NEGATION_RE.
                   ".agents/skills/tdd/SKILL.md",
                   # ci-pipeline.md is the canonical CI dashboard and states both claim
                   # shapes: its job matrix is the only place a job total appears as a
                   # table, and its northflank row scoped a total ("seven of eleven jobs").
                   # It is policed only because its stale numbers were corrected from the
                   # workflow in the same change: dev-ci.yml defines 11 jobs and the
                   # northflank `needs:` list at dev-ci.yml:745 carries 7 of them, excluding
                   # 3 -- the row said "seven of ten ... excludes two". Its line-22 sentence
                   # (four live jobs went unlisted) is a record of the CHECKER'S own
                   # history and carries a HISTORICAL_MARKERS word so it reads as one.
                   "docs/operations/ci-pipeline.md"]

WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
            "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
            "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15}

# The words JOB_TOTAL_RES can spell, BUILT FROM WORD_NUM so the table and the pattern
# cannot drift apart. They did: the pattern listed one..twelve literally while WORD_NUM
# was the mapping, and "thirteen jobs" -- a total no word in the pattern could reach --
# produced ZERO claims, so a wrong total was not reported, it was invisible. The numeral
# branch has the mirror-image hole (a 13-digit... no: an implausible 2+ digit count is
# simply never written), which is why this gap and not that one was the live defect.
WORD_NUM_ALT = "|".join(WORD_NUM)


def read(root: Path, rel: str) -> str:
    p = root / rel
    return io.open(p, encoding="utf-8", errors="replace").read() if p.is_file() else ""


# ── Ground truth ────────────────────────────────────────────────────────────

def current_version(root: Path) -> str:
    """The workspace version from Cargo.toml -- not a literal in this file."""
    m = re.search(r"^\[workspace\.package\][\s\S]*?^version\s*=\s*\"([^\"]+)\"",
                  read(root, "Cargo.toml"), re.M)
    if not m:
        raise SystemExit("cannot determine the current version from Cargo.toml")
    return m.group(1)


HOOK_REL = ".githooks/pre-commit"
GATE_SECTION_RE = re.compile(r"^# ── (.+?) ─", re.M)


def gate_sections(text: str) -> list[tuple[int, str]]:
    """(ordinal, section name) for each gate header in hook TEXT.

    Counting lives here, on text, so the worktree copy and the committed copy can be
    counted by the SAME function. A separate committed-counter is the thing that goes
    false on its own: two ways to count one header format drift apart, and a checker
    that compares a worktree count to a committed count computed differently is
    reporting the difference between its own two parsers rather than the tree.
    """
    return [(i + 1, name.strip())
            for i, name in enumerate(GATE_SECTION_RE.findall(text))]


def hook_steps(root: Path) -> list[tuple[int, str]]:
    """(ordinal, section name) for each gate section in the WORKTREE hook.

    The section headers are the hook's own table of contents; the mirrors describe
    them one by one, so this is the right thing to count.
    """
    return gate_sections(read(root, HOOK_REL))


def committed_hook_text(root: Path) -> str | None:
    """The hook as COMMITTED (`git show HEAD:.githooks/pre-commit`), or None.

    Why the committed copy is read at all: the mirrors are committed alongside the
    hook, so the thing a committed mirror has to agree with is the committed hook.
    Reading only the working copy lets a mirror be filed saying N into a tree whose
    committed hook says M -- checker green, committed state wrong, and invisible in
    CI, which clones a clean tree where the divergence cannot exist. It bites only
    this repo in its actual shape: several agents committing one checkout at once.

    None means "cannot compare" -- no git, no HEAD, path not committed, git missing.
    Every caller treats None as today's behaviour, so a fixture or an exotic checkout
    loses the extra check rather than inventing a verdict.
    """
    try:
        proc = subprocess.run(
            ["git", "show", f"HEAD:{HOOK_REL}"],
            cwd=str(root), capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=20,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


# ── Step NAMES, not just the count ───────────────────────────────────────────
#
# The numeral check can be satisfied by a mirror that lists the wrong steps: root
# AGENTS.md said "seven steps" and enumerated seven names while a different paragraph
# still said eight, and its own audit stamp concedes the gap -- "an enumeration inside
# prose is unenforced by construction". Counting names is the same seven either way; the
# set of names is not. This polices the SET, in both directions: a mirror that drops a
# gate the hook runs is as wrong as one that invents a gate the hook does not run.

ENUM_ITEM_RE = re.compile(r"^(\d+)\.\s+(.*)$")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
MIN_ENUM_ITEMS = 3
NAME_STOPWORDS = {"the", "a", "an", "of", "for", "and", "its", "to", "in"}


def gate_section_lines(text: str) -> list[int]:
    """1-based line of each gate header, positionally matching gate_sections().

    Needed so a finding can name the place the expected step comes from
    (.githooks/pre-commit:331) instead of asserting a set difference in the abstract.
    """
    return [text[:m.start()].count("\n") + 1 for m in GATE_SECTION_RE.finditer(text)]


def step_name_words(name: str) -> set[str]:
    words = re.findall(r"[a-z0-9][a-z0-9./_-]*",
                       name.lower().replace("`", "").strip())
    return {w for w in words if w not in NAME_STOPWORDS}


def step_names_match(a: str, b: str) -> bool:
    """Do a mirror's step label and a hook header name the same gate?

    Deliberately loose, because mirrors shorten: the hook header is
    "Go gate: apps/license-server" and the mirrors say "Go gate". Exact-string
    comparison would report the honest abbreviation as a missing step, which trains
    people to ignore the gate. Loose in one direction only: a label matches when its
    words are a subset of the header's or a superset, so a name can be shortened or
    annotated but not replaced -- "i18n lint" matches nothing, because no header it is
    a subset of exists.
    """
    wa, wb = step_name_words(a), step_name_words(b)
    if not wa or not wb:
        return False
    return wa == wb or wa <= wb or wb <= wa


def step_enumerations(text: str, hook_names: list[str]) -> list[list]:
    """Numbered lists in TEXT that claim to enumerate the hook's steps.

    Each returned run is [(item number, name, line), ...]. Three exclusions, each a
    claim about what the file did NOT promise, checked against the same notion of
    "historical" the skill parser already uses (HISTORICAL_MARKERS) rather than a
    second rule invented here:

    * fewer than MIN_ENUM_ITEMS consecutive numbered bold items -- two names is a
      sentence about two things, not an enumeration;
    * an ITEM whose own line carries a HISTORICAL_MARKERS entry is dropped, per item
      and not per run -- an audit stamp recording "the hook ran six gates (cargo fmt,
      i18n lint, ...)" is preserved evidence and falsifying it is worse than the stale
      claim it carries, but a note on one line must not excuse the six claims next to
      it. A run whose remaining live items fall below MIN_ENUM_ITEMS is not policed;
    * a run with 0 names matching the hook -- a numbered list about something else
      never claimed to enumerate the steps, so it has no opinion about their names.

    The matcher is form-specific on purpose: it reads "N. **label**" lines and nothing
    else. A mirror that renders the same seven steps as a table row, or with the labels
    unbolded, presents zero checkable enumerations and falls back to the numeral alone --
    and today that file's output is indistinguishable from a mirror whose enumeration is
    clean. Widening the matcher to tables is how a checker ends up parsing everything and
    matching nothing, so the hole is named here rather than closed by growing the parser.
    """
    runs: list[list] = []
    cur: list = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = ENUM_ITEM_RE.match(line)
        b = BOLD_RE.search(m.group(2)) if m else None
        if b:
            cur.append((int(m.group(1)), b.group(1).replace("`", "").strip(), i + 1,
                        line.lower()))
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    out: list[list] = []
    for run in runs:
        if len(run) < MIN_ENUM_ITEMS:
            continue
        # The marker acts on the ITEM it sits on, never on the run. Dropping a whole run
        # because one of its lines was marked was one of the five ways past this rule:
        # item 6 renamed to an invented gate plus the two words "count corrected"
        # anywhere above it -- on the heading, on item 1, wherever -- excused all seven,
        # which is a claim cleared by something that was not a claim about that thing.
        # A marked item is a record and is skipped; the items beside it stay live.
        live = [(n, nm, ln) for n, nm, ln, body in run
                if not any(marker in body for marker in HISTORICAL_MARKERS)]
        if len(live) < MIN_ENUM_ITEMS:
            continue
        if not any(step_names_match(nm, hn)
                   for _, nm, _ in live for hn in hook_names):
            continue
        out.append(live)
    return out


def live_workflows(root: Path) -> dict[str, str]:
    """name -> text, for workflows GitHub actually executes (.bak is retired)."""
    d = root / ".github" / "workflows"
    return {p.name: io.open(p, encoding="utf-8", errors="replace").read()
            for p in sorted(d.glob("*.yml"))}


def workflow_jobs(text: str) -> list[str]:
    """Top-level job keys under `jobs:` (2-space indent)."""
    try:
        jstart = re.search(r"^jobs:\s*$", text, re.M).end()  # type: ignore[union-attr]
    except AttributeError:
        return []
    return re.findall(r"^  ([a-zA-Z0-9_-]+):\s*$", text[jstart:], re.M)


# ── Job TOTALS and MIRROR TARGETS ───────────────────────────
#
# Two claims that nothing above can see, both of which were measurably false in this
# repo. (7) A stated job TOTAL: "dev-ci.yml's eleven jobs are ..." read as green while
# the workflow held a different number, because no rule compared a count to the list
# under it -- scripts/check.sh:150, docs/operations/agent-gates.md:23 and
# CONTRIBUTING.md:265 all carried the same wrong total for two releases. (8) The
# TARGET of a "mirrors <workflow>" claim: "mirrors" was a token in CHECKER_PROSE_RE,
# so a sentence naming a workflow was exempted from inspection BY THE WORD THAT MADE IT
# A CLAIM, and scripts/check.ps1's header pointed at a workflow retired into
# .github/workflows/attic/ci.yml.bak without a finding.
#
# Both read ground truth the way every rule above does: from the files being claimed
# ABOUT. The total is summed over live workflows read per workflow, never asserted, and
# a target is resolved against the same live set and the same jobs: parse.

def live_job_totals(root: Path) -> dict[str, list[str]]:
    """Job ids per LIVE workflow -- the ground truth every job claim is graded against.

    attic/*.bak never enters: live_workflows() globs *.yml only, and the .bak set is
    exactly what a total must not be measured against -- the retired ci.yml alone holds
    a dozen jobs that run nowhere. Returned per workflow rather than summed, because a
    claim can scope itself to one workflow ("dev-ci.yml's eleven jobs") and grading
    that against the sum would pass a count no single workflow holds.
    """
    return {n: workflow_jobs(t) for n, t in live_workflows(root).items()}


# The optional "\.bak" suffix is part of the TOKEN on purpose: ".ya?ml" stops before it, so a
# retired name would be captured as its live-looking stem and then reported as a workflow
# that is not live -- punishing the sentence that records the retirement, which is exactly
# the claim this rule must leave alone. Capturing the suffix lets _is_bak() see what the
# file actually wrote.
WORKFLOW_REF_RE = re.compile(r"(?:\.github/workflows/)?([A-Za-z0-9_.-]+\.ya?ml(?:\.bak)?)")

# Two ways a mirrors-sentence says "this target is NOT what I copy", both of which the
# old single negation pattern missed and both of which are TRUE PROSE being read as a
# claim. Kept as written prose, so what is exempted is on the screen.
#
# The retirement branch leans on "was/were/being/has been ... retired" rather than the
# bare word "retired": the sentence must say the TARGET was retired, and a sentence
# merely containing the word is not enough.
MIRROR_NEGATION_RE = re.compile(
    r"\b(?:nothing|none|never|nor|neither|no\s+part)\b[^.;\n]{0,80}?\bmirrors?\b"
    # The negation must be a WORD of its own: "mirrors no workflow" is a denial, but
    # "mirrors CI no-such-gate job" is a claim naming a job that does not exist, and a
    # bare \bno\b matches the first three letters of the second. The trailing lookahead is
    # the whole difference between the two, and it is why this branch is written with an
    # explicit (?![-\w]) rather than a plain \b.
    r"|\bmirrors?\b[^.;\n]{0,80}?(?<![-\w])(?:no|not|never|nothing|neither)(?![-\w])"
    r"|\b(?:does|do|did|is|are|was|were)\s+not\s+(?:\w+\s+){0,2}mirrors?\b",
    re.I)
MIRROR_RETIRED_RE = re.compile(
    r"\b(?:was|were|is|are|has\s+been|had\s+been|being|wasn't|weren't)\s+"
    r"(?:\w+\s+){0,2}retired\b", re.I)

# "mirrors CI <id> job" with the id left BARE -- no backticks, no workflow#job token. The
# candidate is the token immediately in front of the noun, which is the only position this
# phrasing puts it in; the workflow named elsewhere in the sentence decides whether the
# token is a real job, so nothing here has to guess from its shape alone (see
# mirror_target_findings). Anchored on the \bmirrors?\b the sentence already matched, so a
# stray "<id> job" in prose about something else is not read as a mirror target.
BARE_JOB_REF_RE = re.compile(
    r"\b(?:CI\s+)?([A-Za-z][A-Za-z0-9_-]*)\s+jobs?\b", re.I)
JOB_REF_RE = re.compile(r"`([a-z0-9][a-z0-9_-]*)`")
# `dev-ci.yml#website`: workflow and job in one backticked token. The
# workflow side carries the optional .bak for the same reason WORKFLOW_REF_RE does.
WF_HASH_JOB_RE = re.compile(r"([A-Za-z0-9_.-]+\.ya?ml(?:\.bak)?)#([a-z0-9][a-z0-9_-]*)")

# Group 1 = an optional workflow qualifier ("dev-ci.yml's"), group 2 = digits, group 3
# = a word numeral. The trailing job noun is REQUIRED: without it "the two live
# workflows" and "all ten `dev-ci.yml` job names" read as totals, which is a false
# positive on true prose -- the classic false positive that gets a gate switched off.
# The digit and word branches share the group numbering deliberately, and the word branch
# is capturing for the reason SKILL_COUNT_RES documents: a non-capturing one makes a
# word numeral raise IndexError instead of reporting a count.
#
# SIX shapes, not two, and the four that were added are the four the falsification pass
# measured as invisible: a table row ("| Jobs | 10 |"), a plain-colon total ("jobs: 10"),
# a parenthesised numeral on the wrong side of the word ("eleven (11) jobs"), and the
# same bare total in a table cell ("| Jobs (10) | x |"). Each added shape was required to
# produce ZERO matches across all eight prose files before it landed; the shapes that did
# NOT survive that measurement are named in job_total_claims() rather than left implicit.
#
# Two invariants hold across every pattern here, and both are load-bearing:
#   * the numeral must be followed by the job NOUN as a SEPARATE word ("jobs", "jobs.",
#     "jobs,"), never "job" -- "one job's total" is about one job, and a trailing \b
#     alone let "jobs-" and "job's" through;
#   * every pattern exposes the SAME group layout the reader below uses -- group 1 an
#     optional workflow qualifier, group 2 digits, group 3 the word numeral -- so
#     job_total_claims() never has to know which shape matched. The heading and table
#     forms carry an EMPTY group 1 for exactly that reason; without it they raise
#     IndexError on group 3 instead of reporting a count.
JOB_TOTAL_RES = (
    re.compile(r"(?:([A-Za-z0-9_.-]+\.ya?ml)(?:'s|s)?\s+)?\*{0,2}(?:(?<![\d:.])(\d+)|"
               r"(" + WORD_NUM_ALT + r"))"
               r"\*{0,2}\s+(?:live\s+|top-level\s+|CI\s+)?jobs\b", re.I),
    # "Jobs (11):" -- the heading form agent-gates.md uses. The colon is what keeps this
    # off a bare parenthesised number in ordinary prose. "Job count:" is spelled out as
    # optional here rather than given its own pattern: the two words are one claim shape.
    re.compile(r"^\s*()(?:Job\s+count|Jobs)\s*\(\s*(?:(\d+)|(" + WORD_NUM_ALT +
               r"))\s*\)\s*(?::|[-\u2013\u2014]|\||$)", re.I | re.M),
    # "| Jobs | 10 |" -- a markdown table row. The trailing PIPE is required, so the
    # pattern cannot fire on prose; width is [ \t]* rather than \s* so a table row can
    # never straddle a newline.
    re.compile(r"^\s*\|[ \t]*()Jobs?[ \t]*\|[ \t]*(?:(\d+)|(" + WORD_NUM_ALT +
               r"))\*{0,2}[ \t]*\|", re.I | re.M),
    # "| Jobs (10) | x |" -- the heading form as a table cell. Bounded by pipes on both
    # sides, which is what keeps it off a parenthesised number in ordinary prose -- the
    # reason the heading form's colon matters and this form needs its own boundary.
    re.compile(r"^\s*\|[ \t]*()Jobs?\s*\(\s*(?:(\d+)|(" + WORD_NUM_ALT +
               r"))[ \t]*\)[ \t]*\|", re.I | re.M),
    # "Job count: 10" / "jobs: 10" / "total jobs = 10". THREE things make the number a
    # total rather than any other figure after the word "job": the label immediately on the
    # other side of the colon/equals, the OPTIONAL noun after the number (a heading states
    # "Job count: 10" with no noun at all), and -- when that noun is absent -- the number
    # having to END the line or clause. Measured against the shapes that must NOT fire:
    # "13:00 jobs" (a clock), "job: 5 items" (a breakdown, not a total).
    re.compile(r"(?<![\d:])(?<!\d\d)()\bjobs?\s*(?:count\s*)?[:=]\s*(?:(\d+)|(" +
               WORD_NUM_ALT + r"))\b(?:\s+(?:live\s+|top-level\s+|CI\s+)?jobs\b|\s*$)",
               re.I),
    # "eleven (11) jobs" -- a word that RESTATES one number and then repeats it in
    # parentheses. The old word branch required the noun immediately after the word, so
    # the parenthesised numeral swallowed the pair and the sentence scored nothing. This
    # is the ONE shape that carries its two numerals in BOTH orders, so it is the one
    # pattern read through pair_groups() below: group 2 holds the WORD and group 3 the
    # parenthesised numeral, both filled, and disagreement between them is REPORTED as a
    # contradiction -- not silently resolved toward whichever half the parser kept, which
    # is exactly how "twelve (11) jobs" used to pass while stating twelve.
    re.compile(r"()\*{0,2}(" + WORD_NUM_ALT + r")\*{0,2}\s*\(\s*(\d+)\s*\)"
               r"\s*\*{0,2}(?:live\s+|top-level\s+|CI\s+)?jobs?\b", re.I),
)


def job_total_claims(text: str) -> list[tuple[int, int]]:
    """[(line, claimed total)] for every job-total claim in TEXT.

    Six forms, all observed in this repo or in the falsification pass that found the four
    missing ones (JOB_TOTAL_RES names each):

      "dev-ci.yml's eleven jobs are changes, website, ..."  (check.sh:150)
      "Jobs (11): `changes`, `website`, ..."                 (agent-gates.md:23)
      "| Jobs | 10 |"                                       (table row)
      "Job count: 10" / "jobs: 10"                          (plain colon)
      "eleven (11) jobs"                                    (numeral restated)
      "| Jobs (10) | x |"                                   (table cell)

    A dated record is evidence, not a claim, so HISTORICAL_MARKERS lines are skipped --
    the same exclusion every other rule in this file makes, for the same reason.

    KNOWN GAPS, named rather than left to be rediscovered. Each was measured against the
    eight shipped prose files and fires on ZERO of them, so each is a hole in coverage
    and not a false-positive risk:

    * "1,000 jobs" and "9,922-test suites": a thousands separator splits the number from
      its noun, and the hyphen in "N-test" is not a word boundary. A separator-form
      pattern would have to decide whether the number names the total or the test count,
      and prose here writes both; it is not written.
    * a total stated as a table's length ("the eleven rows below") or as a range
      ("10-14 jobs") is unreachable -- no shape exists in these files to calibrate one
      against, and a range is two claims, not one.
    * the heading and table forms require the claim to OPEN its line, so a total buried
      mid-table-cell ("| x | Jobs | 10 |") is not read. Loosening the anchor is how a
      word like "Jobs" starts matching an ordinary sentence.
    """
    out: list[tuple[int, int]] = []
    for ln, line in enumerate(text.splitlines(), 1):
        if any(marker in line.lower() for marker in HISTORICAL_MARKERS):
            continue
        for rx in JOB_TOTAL_RES:
            for m in rx.finditer(line):
                # group 1 = the workflow qualifier, 2 = digits, 3 = the word numeral --
                # EXCEPT the parenthesised-restatement pattern, where the two are the other
                # way round (2 = word, 3 = numeral). pair_groups() is the one place that
                # knows the difference, so no reader has to remember which shape it is
                # looking at.
                digits, word = pair_groups(m)
                if digits is None and not word:
                    continue
                n = WORD_NUM.get(word.lower()) if word else int(digits)
                if n is not None:
                    out.append((ln, n))
    return out


def pair_groups(m: re.Match) -> tuple[str | None, str]:
    """(digits, word) from a JOB_TOTAL_RES match, whichever shape WROTE them.

    Two of the six shapes swap the numeral and the word between groups 2 and 3, and one
    line of arithmetic here is cheaper -- and far harder to get wrong -- than six callers
    each remembering which shape they hold. A group that is empty comes back as None or
    "" so the caller's "neither is set" test stays a single expression.
    """
    if m.re is JOB_TOTAL_RES[-1]:
        # "eleven (11) jobs": group 2 is the WORD, group 3 the parenthesised numeral.
        return (m.group(3), m.group(2) or "")
    return (m.group(2), m.group(3) or "")


def contradictory_pairs(text: str) -> list[tuple[int, int, str]]:
    """[(line, claimed, reading)] where ONE claim was written two ways that disagree.

    Rule (7) grades a total against the workflows, so a self-contradicting claim is
    decided by whichever half the parser kept -- "twelve (11) jobs" was read as 11 and so
    PASSED while the sentence said twelve. Picking a winner is unavoidable (a claim needs
    one number); saying out loud that the sentence contradicts itself is the part that
    must not be lost, and is what this returns and job_total_findings() reports.
    """
    out: list[tuple[int, int, str]] = []
    for ln, line in enumerate(text.splitlines(), 1):
        if any(marker in line.lower() for marker in HISTORICAL_MARKERS):
            continue
        for rx in JOB_TOTAL_RES:
            for hit in rx.finditer(line):
                digits, word = pair_groups(hit)
                if not (digits and word):
                    continue
                n = WORD_NUM.get(word.lower())
                if n is not None and n != int(digits):
                    out.append((ln, n, hit.group(0).strip()))
    return out


def job_total_findings(text: str, rel: str, wfs: dict[str, str],
                       per_jobs: dict[str, list[str]]) -> list[str]:
    """Findings for a job total that disagrees with the LIVE workflows.

    Scope is the workflow the claim names, or every live workflow when it names none --
    the same "scope, else all" rule the push-trigger check uses, so a claim saying
    "dev-ci.yml's eleven jobs" is graded against dev-ci.yml rather than the total.
    """
    findings: list[str] = []
    lines = text.splitlines()
    for ln, claimed in job_total_claims(text):
        # Scoped by FILE NAME only. workflow_name_aliases() also carries each workflow's
        # own "name:" header, which is right for trigger prose ("Dev CI is triggered by a
        # push") and wrong here: release.yml's header is "Release", so the jobs list in
        # agent-gates.md:23 -- which names release-readiness and release-bridge-test --
        # matched it as a substring and the repository total was graded against
        # release.yml's 3. A job TOTAL is stated about the workflow FILE, so the file name
        # is the only qualifier that can scope it.
        scope = [n for n in wfs if n.lower() in lines[ln - 1].lower()]
        if not scope:
            # The heading form ("Jobs (11):") states its scope one line up, in the
            # paragraph it heads: agent-gates.md:22 says "dev-ci.yml triggers: ..." and :23
            # then enumerates dev-ci.yml's eleven jobs. Reading only the claim's own line
            # graded that against the repository total (14) and reported true prose as a
            # failure. So the scope is the LAST workflow named in the non-blank lines
            # above, stopping at a blank line -- the block the heading belongs to, which
            # is the same "as far as its reason reaches" bound the exemptions elsewhere
            # apply. No workflow named in that block means the claim is about all of them.
            for above in reversed(lines[:ln - 1]):
                if not above.strip():
                    break
                scope = [n for n in wfs if n.lower() in above.lower()]
                if scope:
                    break
        if scope:
            real = sum(len(per_jobs[n]) for n in scope)
            where = " and ".join(f"{n} defines {len(per_jobs[n])}"
                                 for n in sorted(scope))
        else:
            real = sum(len(j) for j in per_jobs.values())
            where = "the live workflows define " + ", ".join(
                f"{n}: {len(per_jobs[n])}" for n in sorted(per_jobs))
        if claimed != real:
            findings.append(
                f"{rel}:{ln} claims {claimed} jobs, but {where} (total {real})")
    # A claim that contradicts ITSELF is reported whichever way the workflow falls: the
    # parsed half is graded above, the discarded half is the one a reader would believe.
    for ln, word, reading in contradictory_pairs(text):
        findings.append(
            f"{rel}:{ln} states its job total two ways that disagree -- the word reads "
            f"{word} where the numeral reads another value (phrase: {reading!r}), so the "
            "claim is graded on the word and the sentence is wrong either way")
    return findings


def mirror_target_findings(text: str, rel: str, wfs: dict[str, str],
                           per_jobs: dict[str, list[str]]) -> list[str]:
    """Findings for a "mirrors <target>" claim whose target is not live.

    Both halves are graded: a named WORKFLOW must be one of the live *.yml files, and a
    named JOB must be a key under jobs: in the workflow it names -- or in some live
    workflow when it names none.

    A job is reached THREE ways, and the third closed a measured hole: a backticked id
    (a code span), a workflow#job token, and -- since
    2026-09-21 -- a BARE word. "the local runner mirrors CI static-gates job in
    dev-ci.yml" was invisible before, and nothing about it is less of a claim for being
    un-backticked; the code-span requirement was a convenience, not a discriminator. The
    bare form is bounded so it cannot become one: it is read ONLY inside a sentence that
    NAMES a live workflow, where the candidate set is that workflow's own job ids, and
    only for the token immediately before the word "job(s)". Guessing from shape alone
    was never needed -- naming the workflow supplies the vocabulary.

    A `.bak` or `attic/` target is a FAILURE, not an exemption, and that is deliberate:
    "mirrors .github/workflows/attic/ci.yml.bak" is the exact claim this rule exists to
    catch -- the retired workflow scripts/check.ps1's header kept naming. The exemption a
    retirement RECORD needs is the one every rule here already has (a quotation, or a
    HISTORICAL_MARKERS line); outside those, the verb "mirrors" asserts the target is the
    thing being copied, and a file in attic/ is never that. Verified against this tree:
    every .bak mention in the five prose files sits in a sentence with no "mirrors" in
    it, so the two are cleanly separable in practice and not only in principle.
    """
    findings: list[str] = []
    all_jobs = {j for js in per_jobs.values() for j in js}
    for ln, line in enumerate(text.splitlines(), 1):
        if any(marker in line.lower() for marker in HISTORICAL_MARKERS):
            continue
        quoted = [(m.start(), m.end()) for m in QUOTED_PHRASE_RE.finditer(line)]
        for off, sent in line_sentences(line):
            # The lookbehind on the verb is load-bearing. "verify-agents-mirrors.py"
            # is a script this repo cites by name in several audit stamps, and a bare
            # \bmirrors?\b matched the "mirrors" INSIDE that hyphenated filename -- so
            # any sentence listing the script read as a mirror claim, and a genuine
            # retirement record naming a .bak workflow in the same sentence was graded
            # as a present-tense claim that the workflow is live (tdd/SKILL.md:6, found
            # 2026-09-23 while repairing the skills audit). A hyphen before the verb is
            # never how this repo writes the claim; "mirrors", "mirror", "mirroring"
            # preceded by a word boundary and not by "-" still match.
            if not re.search(r"(?<!-)\bmirrors?\b|\bmirroring\b", sent, re.I):
                continue
            # A NEGATED, PAST-TENSE mirror sentence is the opposite of a claim that the
            # target is live: "Nothing here mirrors .github/workflows/ci.yml either" and
            # "`.githooks/pre-push` ... mirrors no workflow: the `ci.yml` workflow ... was
            # retired to .../ci.yml.bak" both RECORD a retirement. Reading either as an
            # assertion reports the correction as the defect -- the same inversion every
            # other rule in this file guards against.
            #
            # Widened 2026-09-21, and the widening IS a measured fix: adding
            # tdd/SKILL.md to the policed set made the real run fail with "mirrors
            # 'ci.yml'" and "mirrors 'ci.yml.bak'" on a line that records the
            # retirement, because the old skip required the negation within 40
            # characters AND BEFORE the verb -- while in both files the negation ("no
            # workflow", "Nothing") is exactly what the verb points AT, after it. The fix
            # is not a longer window (a window is a LENGTH; the relation is a DIRECTION)
            # but the missing direction, plus the preterite: a sentence saying the target
            # "was retired" states history about the file, and rule (8) grades a claim
            # about the present tense of a target.
            if MIRROR_NEGATION_RE.search(sent) or MIRROR_RETIRED_RE.search(sent):
                continue

            def quoted_span(a: int, b: int) -> bool:
                return any(s <= off + a and off + b <= e for s, e in quoted)

            # workflow#job first: one token carrying both halves.
            for m in WF_HASH_JOB_RE.finditer(sent):
                if quoted_span(m.start(), m.end()):
                    continue
                findings.extend(_grade_target(rel, ln, m.group(1), m.group(2), wfs,
                                              per_jobs))
            # A bare workflow file name. A name already consumed by a wf#job token above
            # is skipped: that token already reported both halves, and reporting the
            # workflow half twice would double the count of one defect -- the reason
            # verify-ci-docs-drift.py states for not listing an item under two headings.
            claimed_wfs = {m.group(1) for m in WF_HASH_JOB_RE.finditer(sent)
                           if not quoted_span(m.start(), m.end())}
            for m in WORKFLOW_REF_RE.finditer(sent):
                if quoted_span(m.start(), m.end()):
                    continue
                if m.group(1) in claimed_wfs:
                    continue
                if m.group(1) not in wfs:
                    findings.append(
                        f"{rel}:{ln} mirrors {m.group(1)!r}, which is not a live "
                        "workflow -- live: " + (", ".join(sorted(wfs)) or "(none)"))
            # A backticked job id, when no workflow name in the sentence scopes it.
            named_wf = [n for n in wfs
                        if any(a in sent.lower()
                               for a in workflow_name_aliases(n, wfs[n]))]
            for m in JOB_REF_RE.finditer(sent):
                job = m.group(1)
                if quoted_span(m.start(), m.end()) or job in all_jobs or job in wfs:
                    continue
                # Only a token shaped like a job id: a mirrors-sentence is full of
                # backticked scripts, env vars and config keys, and flagging those
                # would fire the rule on every honest sentence.
                if not _looks_like_job_ref(job):
                    continue
                if named_wf:
                    findings.extend(_grade_target(rel, ln, named_wf[0], job, wfs,
                                                  per_jobs))
                else:
                    findings.append(
                        f"{rel}:{ln} mirrors CI job {job!r}, which no live workflow "
                        "defines -- live jobs: "
                        + (", ".join(sorted(all_jobs)) or "(none)"))
            # A BARE, un-backticked job name -- "mirrors CI static-gates job in dev-ci.yml".
            # Read only when the sentence names a live workflow, and only from the token
            # immediately before "job"/"jobs": naming the workflow supplies the vocabulary,
            # so a word that is not one of its job ids is a claim about a job that does not
            # exist, and no heuristic about what "looks like a job" has to be invented. The
            # token must itself look like an id (lowercase, hyphenated or single lowercase
            # word) so an ordinary English phrase in front of the word "job" -- "this job",
            # "a CI job" -- is not read as a target.
            if named_wf:
                for m in BARE_JOB_REF_RE.finditer(sent):
                    tok = m.group(1)
                    if quoted_span(m.start(), m.end()) or tok.lower() in (
                            "no", "the", "a", "an", "this", "that", "job", "jobs",
                            "ci", "its", "our", "your"):
                        continue
                    if not re.fullmatch(r"[a-z][a-z0-9]*(?:[a-z0-9-]*[a-z0-9])?", tok):
                        continue
                    if tok in all_jobs:
                        continue
                    findings.extend(_grade_target(rel, ln, named_wf[0], tok, wfs,
                                                  per_jobs))
    return findings


def _is_bak(token: str) -> bool:
    return token.endswith(".bak")


def _looks_like_job_ref(tok: str) -> bool:
    """Does TOK read as a job id rather than a script, a variable or a config key?

    The discriminator is the SHAPE these files give a job id: lowercase words joined by
    hyphens. Scripts carry an extension or a slash, config keys are single words, and
    every genuine job id in this repo (`static-gates`, `cargo-nextest`, `ui-test`,
    `northflank-deploy`, `ci-docs-drift`, `release-bridge-test`) is hyphenated.
    Requiring a hyphen is deliberately narrow: the rule fires on the ids it was written
    for and stays silent on single-word tokens a wider matcher would report as phantom
    jobs while scanning ordinary sentences.
    """
    return bool(re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)+", tok))


def _grade_target(rel: str, ln: int, wf: str, job: str, wfs: dict[str, str],
                  per_jobs: dict[str, list[str]]) -> list[str]:
    """Findings for one (workflow, job) pair: both halves must exist and be live."""
    if wf not in wfs:
        # A .bak is called out by name: the difference between "this file is not live"
        # (maybe a typo) and "this file was RETIRED" is the whole point of the claim, and
        # the reader fixing it needs to know which one they are looking at.
        kind = ("is retired" if _is_bak(wf) else "is not a live workflow")
        return [f"{rel}:{ln} mirrors {wf}#{job}, but {wf} {kind} "
                "-- live: " + (", ".join(sorted(wfs)) or "(none)")]
    if job not in per_jobs.get(wf, []):
        return [f"{rel}:{ln} mirrors job {job!r} in {wf}, but {wf} defines no such "
                "job under jobs: -- it defines "
                + (", ".join(per_jobs.get(wf, [])) or "(none)")]
    return []


def triggers_of(text: str) -> list[str]:
    r"""Event names in the `on:` block, taken at the block's own indent.

    REPAIRED 2026-09-14, and the repair is load-bearing. The old block pattern was
    `^(?:on|True):\s*$((?:^[ \t]+\S.*\n?)+)`: under re.M the \s* can only land the
    match at the END of the `on:` line, so the group -- which must begin with `^` --
    was asked to match at a position that is not a line start, and the block branch
    never fired. Measured on this tree's own `dev-ci.yml`, which DOES declare `push`,
    the old function answered `[]`; `release.yml` likewise. A ground truth that
    silently resolves to nothing is worse than none: it makes every "CI runs on push"
    sentence false and every denial of one true, so a rule reading it can only ever
    fire in one direction no matter how many directions it writes. Nested children are
    now excluded by taking one indent level (the old 2-4 space scan returned the
    `branches:` keys as if they were events).
    """
    m = re.search(r"^(?:on|True):[ \t]*\r?\n((?:^[ \t]+\S.*\n?)+)", text, re.M)
    if not m:
        m2 = re.search(r"^(?:on|True):[ \t]*(\[[^\]]*\])", text, re.M)
        return re.findall(r"[\w_]+", m2.group(1)) if m2 else []
    body = m.group(1)
    indents = [len(l) - len(l.lstrip()) for l in body.splitlines() if l.strip()]
    return re.findall(r"^ {%d}([A-Za-z_][\w.-]*):" % min(indents), body, re.M)


# ── Push-trigger claims, in BOTH directions ─────────────────────────────────
#
# Rule (6) used to grade one sentence shape against one OR-ed fact: "CI runs on push"
# versus "does ANY live workflow declare push". Both halves were weak. The phrase half
# missed the mirrors' actual wording ("a push to main therefore does run CI") and the
# fact half could not see a per-workflow lie, so a doc denying a trigger that exists
# read as green. Two claim kinds are now read -- an ASSERTION that a push trigger
# exists and a DENIAL that one does -- each graded against the on: set of the workflow
# the sentence names, or against every live workflow when it names none. A denial is
# never excused by some other workflow's trigger.
#
# HISTORICAL_MARKERS (the same tuple the enumeration and skill parsers already use)
# skips a whole line, and that exclusion is load-bearing here: the dated audit stamps
# record "dev-ci triggers pull_request + workflow_dispatch and no push trigger" as the
# state of the tree on the day they were written. Falsifying a point-in-time record is
# worse than the stale sentence it carries, and a gate that punished the stamps would
# get switched off. QUOTED_PHRASE_RE then blanks anything inside quotation marks,
# because both mirrors legitimately DISCUSS the phrase -- they print it as the example
# of the lie, not as a claim -- and CHECKER_PROSE_RE skips a sentence whose subject is
# the checker rather than CI. CI_SUBJECT_RE requires the claim be attributed to CI.

SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
CI_SUBJECT_RE = re.compile(r"\bCI\b|dev[\s_-]?ci|\bworkflows?\b|\bActions\b", re.I)
QUOTED_PHRASE_RE = re.compile(r"\u201c[^\u201d]*\u201d|\x22[^\x22]*\x22")
PUSH_RE = r"(?<![\w-])push(?:ing|es)?(?![\w-])"

# "CI runs on push", "Dev CI is triggered by a push", "a push therefore does run CI".
# The lookbehind keeps pre-push, run-pre-push.py and git push out of it: a hook that
# runs before a push is not a workflow triggered by one, and the mirrors say pre-push
# eleven times between them.
PUSH_ASSERTION_RES = (
    re.compile(r"(?:\bCI\b|dev[\s_-]?ci|GitHub\s+Actions|\bworkflows?)\b[^.\n]{0,90}?"
               r"\b(?:runs?|trigger[s]?|fires?|deploys?|publish(?:es)?)\b[^.\n]{0,45}?"
               + PUSH_RE, re.I),
    re.compile(PUSH_RE + r"[^.\n]{0,60}?\b(?:does\s+run|will\s+run|runs?|triggers?|"
               r"fires?|deploys?)\b[^.\n]{0,30}?(?:\bCI\b|dev[\s_-]?ci|\bworkflows?\b"
               r"|\bpipelines?\b)", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+(?:also\s+)?triggered\s+by[^.\n]{0,25}?"
               + PUSH_RE, re.I),
)

# "there is no push trigger", "has no push trigger at all", "CI does not run on push",
# "a push runs nothing". Each branch names the trigger or the running of CI, because a
# sentence saying something happens "without a push" is not a claim that the trigger is
# absent -- "cannot be verified without a real tag push" is the first false lead the
# looser shape gives.
PUSH_DENIAL_RES = (
    re.compile(r"\bno\W+(?:\w+\W+){0,4}?" + PUSH_RE + r"(?:\W+\w+){0,3}?\W*trigger",
               re.I),
    re.compile(r"\bhas\s+no\b[^.\n]{0,30}?" + PUSH_RE + r"[^.\n]{0,25}?trigger", re.I),
    re.compile(r"\b(?:does|do|did)\s+not\b[^.\n]{0,35}?" + PUSH_RE
               + r"[^.\n]{0,35}?\b(?:runs?|triggers?|fires?|deploys?)\b", re.I),
    re.compile(r"\b(?:is|are|was|were)\s+not\s+triggered\s+by[^.\n]{0,25}?" + PUSH_RE,
               re.I),
    re.compile(r"\bnever\b[^.\n]{0,30}?\b(?:runs?|triggers?|fires?)\b[^.\n]{0,30}?"
               + PUSH_RE, re.I),
    re.compile(PUSH_RE + r"[^.\n]{0,45}?\b(?:runs?|triggers?|fires?|deploys?)\s+nothing\b",
               re.I),
)

# A trigger FILTER is not a trigger ABSENCE: "the case that runs nothing is a push to a
# non-main branch" stands while push: exists with branches: [main]. Naming a branch
# qualifier is what tells the two apart, so a filtered sentence is not graded.
BRANCH_QUALIFIER_RE = re.compile(r"non-[\s*\x60]*main", re.I)

# Sentences whose subject is the checker, a finding or the rule are meta: they quote a
# phrasing instead of claiming the fact. Both mirrors' scope paragraphs run this way, and
# one of them is the paragraph that describes this very check. Tested against the CLAIM
# plus a window (CHECKER_PROSE_WINDOW) rather than the whole slice -- see the window's
# comment for why a slice-wide test inverted this guard.
#
# "\bmirrors?\b" USED to be a token here and is deliberately gone. It exempted a sentence
# from inspection by the very word that made it a claim: "scripts/check.sh mirrors
# .github/workflows/ci.yml" asserts something about a workflow, so reading "mirrors" as
# checker prose meant nothing ever checked its target -- which is how check.ps1's header
# kept naming a workflow retired into attic/ci.yml.bak. Rule (8) now inspects that target
# instead. The tokens that remain name the checker, a finding, or prose ABOUT claims; none
# of them is a claim's own object.
CHECKER_PROSE_RE = re.compile(
    r"verify-agents-mirrors|says_push|any_push|\bchecker\b|\bfinding\w*\b"
    r"|\bunenforced\b|\brules?\b|\bprose\b|\bpolic(?:e|es|ing)\b|\bgates?\b", re.I)

# How far either side of a claim span the checker-prose exemption reaches. It used to be
# the whole sentence, and line_sentences() hands back a SLICE OF A MARKDOWN LINE, not a
# sentence: these mirrors carry 3,000-character paragraphs, so one occurrence of the word
# "mirrors" anywhere in the slice exempted every CI claim inside it. That inverted the
# guard -- a false claim could hide just by being written in the same paragraph as the word
# "checker". A claim is meta prose only when the token is part of the claim, so the test is
# now a window around the matched span, and 48 characters is that window: enough to cover
# "the checker flags 'there is no push trigger'" and "this rule does not run on push", not
# enough to reach a stray "mirrors" two hundred characters away. Measured on the shipped
# mirrors: at 48 both stay clean, and the denial that sat invisible in .agents/AGENTS.md:41
# is graded again.
CHECKER_PROSE_WINDOW = 48


def checker_prose_span(sent: str, start: int, end: int) -> bool:
    """True when a checker-prose token sits inside the claim itself, not merely nearby.

    START/END are offsets into SENT. The window is symmetric because the noun can be the
    subject ahead of the verb ("the checker never reads a push trigger") or the object
    after it ("a push trigger the checker does not read").
    """
    lo = max(0, start - CHECKER_PROSE_WINDOW)
    hi = min(len(sent), end + CHECKER_PROSE_WINDOW)
    return bool(CHECKER_PROSE_RE.search(sent[lo:hi]))


def line_sentences(line: str) -> list[tuple[int, str]]:
    """[(start offset in LINE, text)] for each sentence slice of one markdown line.

    Offsets, not just text: a claim inside a quotation is found by asking whether the
    MATCH sits inside a quoted span of the same line, which needs the position.
    """
    out: list[tuple[int, str]] = []
    pos = 0
    for m in SENTENCE_SPLIT_RE.finditer(line):
        if line[pos:m.start()].strip():
            out.append((pos, line[pos:m.start()]))
        pos = m.end()
    if line[pos:].strip():
        out.append((pos, line[pos:]))
    return out


def workflow_name_aliases(name: str, text: str) -> list[str]:
    """What a sentence can call this workflow: its file name and its own name: header."""
    aliases = [name, name.rsplit(".", 1)[0]]
    m = re.search(r"^name:[ \t]*(.+?)[ \t]*$", text, re.M)
    if m:
        aliases.append(m.group(1))
    return [a.lower() for a in aliases if a]


def named_workflows(sentence: str, wfs: dict[str, str]) -> list[str]:
    """The live workflows a sentence names; empty when it names none.

    Scoping is what turns the old OR into a per-workflow comparison, and the alias comes
    from each workflow file's own name: header rather than from a list hardcoded here.
    """
    low = sentence.lower()
    return [n for n, t in wfs.items()
            if any(a in low for a in workflow_name_aliases(n, t))]


def push_claim_findings(text: str, rel: str, wf_trigs: dict[str, list[str]],
                        wfs: dict[str, str]) -> list[str]:
    """Findings for false push-trigger claims in a mirror, in both directions.

    An assertion fails when no workflow IN SCOPE declares push; a denial fails when any
    workflow in scope does, because an unspecific denial is a claim about all of them.
    Scope is the workflow the sentence names, or every live workflow when it names none,
    and each finding prints the file name plus the event set read from its own on: block.
    """
    findings: list[str] = []
    for ln, line in enumerate(text.splitlines(), 1):
        # A dated audit stamp IS a record in its entirety: it lives on its own line inside
        # an HTML comment and every claim in it speaks for the day it was written. That
        # whole-line exemption is what the mirrors depend on, and it stays. What must NOT
        # work this way is ordinary live prose, which in these mirrors runs to 3,500
        # characters on one line -- see the per-slice test below.
        stamped_record = line.lstrip().lower().startswith("<!--")
        if stamped_record and any(k in line.lower() for k in HISTORICAL_MARKERS):
            continue
        quoted = [(m.start(), m.end()) for m in QUOTED_PHRASE_RE.finditer(line)]

        def is_quoted(a: int, b: int) -> bool:
            return any(s <= a and b <= e for s, e in quoted)

        for off, sent in line_sentences(line):
            # Dated records are exempt, but the unit has to be the claim's own slice, not
            # the LINE: these mirrors park a whole dated paragraph on one markdown line, so
            # a line-level test let a single "previously" standing 1,009 characters away
            # exempt every CI claim in a 3,516-character paragraph (measured on
            # .agents/AGENTS.md:41, which is why a false denial sat there invisibly while
            # the identical claim in AGENTS.md:41 was caught). Same reasoning as the
            # checker-prose window below: an exemption reaches as far as its reason does.
            if any(marker in sent.lower() for marker in HISTORICAL_MARKERS):
                continue
            # Attribution is still a whole-slice test -- a claim needs a CI-ish subject
            # somewhere in the text it sits in. The checker-prose exemption is NOT, and is
            # applied to the matched span below (see CHECKER_PROSE_WINDOW).
            if not CI_SUBJECT_RE.search(sent):
                continue

            # Denials are tested FIRST: "there is no push trigger" also contains the
            # words the third assertion pattern reads (push + trigger), and grading it as
            # an assertion would report a true sentence as a false one.
            unquoted = lambda rx: next((m for m in rx.finditer(sent)
                                        if not is_quoted(off + m.start(), off + m.end())), None)
            m = next((x for x in (unquoted(rx) for rx in PUSH_DENIAL_RES) if x), None) \
                if not BRANCH_QUALIFIER_RE.search(sent) else None
            kind = "denies" if m else None
            if not kind:
                m = next((x for x in (unquoted(rx) for rx in PUSH_ASSERTION_RES) if x), None)
                kind = "asserts" if m else None
            if not kind:
                continue
            if checker_prose_span(sent, m.start(), m.end()):
                continue
            scope = named_workflows(sent, wfs) or list(wf_trigs)
            has_push = [n for n in scope if "push" in wf_trigs[n]]
            detail = ("; ".join(f"{n} on: {', '.join(wf_trigs[n]) or '(no events)'}"
                                for n in scope) or "no live workflow found")
            frag = m.group(0).strip()
            if kind == "asserts" and not has_push:
                findings.append(
                    f"{rel}:{ln} asserts a push trigger, but no workflow in scope has one"
                    f" -- {detail} (phrase: {frag!r})")
            elif kind == "denies" and has_push:
                findings.append(
                    f"{rel}:{ln} denies a push trigger that {', '.join(has_push)} declares"
                    f" -- {detail} (phrase: {frag!r})")
    return findings


def accepted_commit_types(root: Path) -> set[str]:
    """What .githooks/commit-msg actually allows.

    The hook declares `TYPES='feat|fix|docs|...'` as a shell variable used in the
    subject regex. An earlier version of this function looked for a
    parenthesised alternation and found nothing, returning the empty set -- which
    made `documented - accepted` equal the ENTIRE documented list and report that
    every mirror "documents commit types the gate rejects". A check whose ground
    truth silently resolves to nothing does not fail; it lies. Hence the explicit
    guard below rather than a permissive default.
    """
    hook = read(root, ".githooks/commit-msg")
    m = re.search(r"^TYPES=['\"]([a-z|]+)['\"]", hook, re.M)
    if m:
        return set(m.group(1).split("|")) - {""}
    # Fall back to the alternation inside the subject regex, if that is how it
    # is written.
    for m in re.finditer(r"\((feat\|[a-z|]+)\)", hook):
        return set(m.group(1).split("|")) - {""}
    raise SystemExit(
        "cannot determine the accepted commit types from .githooks/commit-msg -- "
        "refusing to run the type check against an empty set")


# ── Mirror claims ───────────────────────────────────────────────────────────

def claimed_step_count(text: str) -> int | None:
    m = re.search(r"runs \*\*(?:(\d+)|(one|two|three|four|five|six|seven|eight|"
                  r"nine|ten|eleven|twelve))[\s-]*(?:\w+\s+)?steps?\*\*", text)
    if not m:
        return None
    return int(m.group(1)) if m.group(1) else WORD_NUM[m.group(2)]


# Skill files state the gate count in prose rather than the mirrors' fixed sentence, so they
# need their own pattern. Two things keep it from catching unrelated numbers: the match must
# sit on a line that also mentions the hook or pre-commit, and the number must be followed by
# a colon-list or a "gates"/"steps" noun. A skill that says nothing about the count is fine --
# unlike a mirror, which is required to state it -- so this returns None rather than a problem
# and the caller only compares when a claim exists.
SKILL_COUNT_RES = (
    re.compile(r"(?:there are|there is|now|currently|has)\s+\**(?:(\d+)|"
               # The word branch is capturing on purpose, and the group numbering is
               # load-bearing: skill_claimed_step_count reads m.group(2) for it, so writing this
               # as (?:...) makes any word numeral this pattern reaches raise IndexError
               # ("no such group") and kills the checker instead of reporting a count. Both
               # patterns must expose group 1 = digits, group 2 = words; pinned by self-test
               # case (6), which fails with an IndexError if this regresses.
               r"(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\**\s*"
               r"(?:pre-commit|steps?|gates?)", re.I),
    re.compile(r"\**(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|"
               r"twelve))\**\s+(?:core\s+)?(?:pre-commit\s+)?(?:steps?|gates?)\b", re.I),
)
# Lines that are talking about the past are not claims about the present. This is not a
# theoretical exclusion: the first version of this checker flagged two skills for sentences
# that read "This list said 'six core gates' for a while and went stale twice" and an audit
# stamp recording an earlier correction. A doc that documents its own history necessarily
# contains stale numbers, so a checker that reads them as current claims cannot be adopted
# at all -- it would have to be silenced, which is worse than not writing it. The exclusion
# is sound in the other direction too: a genuinely stale claim is by definition presented as
# current, so it will not carry one of these markers.
HISTORICAL_MARKERS = (
    "previously", "formerly", "used to", "once said", "went stale", "was stale",
    "had been", "said \u201csix", "earlier revision", "rev 2", "corrected",
    "this line claimed", "previously listed", "for a while",
)


def skill_claimed_step_count(text: str) -> int | None:
    """The gate count a skill asserts about .githooks/pre-commit, if it asserts one."""
    for line in text.splitlines():
        low = line.lower()
        if "pre-commit" not in low and "hook" not in low:
            continue
        if any(marker in low for marker in HISTORICAL_MARKERS):
            continue
        for rx in SKILL_COUNT_RES:
            for m in rx.finditer(line):
                if m.group(1):
                    return int(m.group(1))
                word = m.group(2).lower()
                if word in WORD_NUM:
                    return WORD_NUM[word]
    return None


NUM_STEP_RE = re.compile(
    r"Steps?\s+((?:\d+\s*(?:,|and)?\s*)+)\s+(?:are\s+local-only|have\s+no\s+CI\s+backstop)",
    re.I)


def steps_claimed_local_only(text: str) -> set[int]:
    """Step numbers a mirror says CI does NOT cover."""
    out: set[int] = set()
    for m in NUM_STEP_RE.finditer(text):
        out |= {int(n) for n in re.findall(r"\d+", m.group(1))}
    return out


# ORIGIN: `.prime/AGENTS.md` stated this same lie without step numbers ("there is
# **no** CI job for migration column types, PG schema drift, or Go"). A numeric-only
# regex cannot see that phrasing. The mirror is gone, but the pattern stays: the
# named-tooling negation is a phrasing any of these files can fall into, and matching
# numbers alone would leave the motivating bug class uncaught.
NAMED_LOCAL_RE = re.compile(
    r"(?:there is|there are)\s+\**no\**\s+CI\s+(?:job|gate|backstop|step)s?\s+(?:for|that)"
    r"\s+([^.\n]+)", re.I)

# The same lie told in different words. Found against my own prose: after a CI step
# for bundle-parity landed, `.prime/AGENTS.md` still read "still guarded **only** by
# the opt-in local hook", and the gate passed every mirror then present. NEGATION-ONLY
# patterns see "no CI job for X" and miss "X is guarded only by the hook", which
# asserts precisely the same falsehood -- and is the phrasing these files actually
# favour, because they describe what DOES run and then note the exception.
#
# The subject has to come FIRST here ("bundle-parity ... only by the local hook"),
# unlike NAMED_LOCAL_RE where the negation leads, so the capture group is before the
# marker rather than after.
LOCAL_ONLY_RE = re.compile(
    r"(?:\b(?:is|are|was|were|remains?|stays?)\s+)?(?:still\s+|now\s+)?"
    r"(?:guarded|covered|enforced|checked|run|backed)\s+"
    r"(?:\**only\**|\**solely\**|\**exclusively\**)\s+by\s+[^.\n]*?"
    r"(?:local\s+)?(?:hook|pre-commit)", re.I)

# Phrases that make a LOCAL_ONLY_RE hit a TRUE statement rather than a lie: a
# sentence saying the hook is the only guard *at commit time* is correct even when
# CI also runs the check, since CI does not run at commit time. Without this the
# pattern would fire on accurate prose and the gate would train readers to ignore it.
LOCAL_ONLY_EXEMPT = re.compile(
    r"at commit time|when hooks? are|without\s+`?core\.hooksPath", re.I)


def named_local_claims(text: str) -> list[str]:
    """Phrases a mirror says have no CI job, split into individual items.

    "migration column types, PG schema drift, or Go" -> three lowercase items, so
    each can be matched against a gate's own tooling independently. Splitting on
    the comma AND a trailing "or" handles both the Oxford and the plain form.
    """
    out: list[str] = []
    for m in NAMED_LOCAL_RE.finditer(text):
        body = m.group(1)
        body = re.sub(r"\*+", "", body)
        body = re.sub(r"\s+\bor\s+", ", ", body)
        for it in body.split(","):
            it = it.strip(" .;:").lower()
            if it:
                out.append(it)
    return out


def local_only_claims(text: str) -> list[str]:
    """Subjects a mirror says are guarded ONLY by the local hook.

    The marker is matched first and the subject recovered from the ~140 characters
    BEFORE it, rather than the subject being captured by one forward regex. That is
    because the phrasing these files actually use is a participial clause -- "The
    remaining gap is `verify-bundle-parity.py` (step 4)**, still guarded only by the
    opt-in local hook" -- where no copula precedes "guarded" and the noun the claim
    is about sits after a parenthetical. A forward pattern either misses it or
    swallows "The remaining gap is" as the subject, which matches no step name and
    so reports nothing.

    Sentences scoping the claim to commit time are dropped: those stay true even once
    CI runs the check, and a gate that fires on accurate prose trains readers to
    ignore it.
    """
    out: list[str] = []
    for m in LOCAL_ONLY_RE.finditer(text):
        # A fixed 140-character lookback crosses paragraph boundaries, and the subject is
        # then recovered from the previous block's trailing prose. Observed after the hook
        # gained a ninth step: in .agents/AGENTS.md the window began inside the preceding
        # step-9 sentence, so the "subject" came out as
        # "proves the live step still fires.\n\n> ✅ all nine steps now have a ci backstop…",
        # which matches no known check and was silently dropped -- turning a real finding
        # into zero findings. Clamp to the start of the current paragraph.
        para_start = text.rfind("\n\n", 0, m.start())
        floor = (para_start + 2) if para_start != -1 else 0
        begin = max(floor, m.start() - 140)
        window = text[begin:m.start()]
        sentence = window + m.group(0) + text[m.end():m.end() + 140]
        if LOCAL_ONLY_EXEMPT.search(sentence):
            continue
        # Prefer backticked identifiers: in these files the tool name is always
        # code-formatted, and it is the token step_tools() can be matched against.
        cands = re.findall(r"`([^`]+)`", window)
        if not cands:
            # Fall back to the trailing clause's words, minus connective noise.
            tail = re.split(r"[.;:]", window)[-1]
            tail = re.sub(r"\(step\s+\d+\)", " ", tail)
            tail = re.sub(r"\b(?:the|remaining|gap|so|and|or|is|are|was|were|"
                          r"that|this|which|only|also|still|now|note|but)\b",
                          " ", tail, flags=re.I)
            cands = [w for w in re.findall(r"[A-Za-z][\w-]{2,}", tail)]
        for c in cands:
            c = re.sub(r"\*+", "", c).strip(" .;:").lower()
            if len(c) >= 3:
                out.append(c)
    return out


def documented_commit_types(text: str) -> set[str]:
    """The `<type>` list a mirror documents, from the bullet block under
    "`<type>` must be one of"."""
    i = text.find("must be one of")
    if i < 0:
        return set()
    block = text[i:i + 2000]
    return set(re.findall(r"^\s*-\s+`([a-z-]+)`", block, re.M))


# ── The check ───────────────────────────────────────────────────────────────

def scan(root: Path, head_hook_text: str | None = None,
         notices: list[str] | None = None,
         enum_counts: dict | None = None) -> list[str]:
    """Findings about ROOT.

    head_hook_text and notices are seams for the self-test: the fixture directory is
    not a git repo, so `git show HEAD:` cannot be made to disagree with a file on disk
    there, and the divergence cannot be tested without controlling both sides. Left
    alone by every real caller, which is what keeps the normal verdict path the one
    that has always run.
    """
    problems: list[str] = []
    version = current_version(root)
    steps = hook_steps(root)
    n_steps = len(steps)
    head_text = committed_hook_text(root) if head_hook_text is None else head_hook_text
    n_head = None if head_text is None else len(gate_sections(head_text))
    diverged = n_head is not None and n_head != n_steps
    if diverged and notices is not None:
        notices.append(
            f"{HOOK_REL} DIVERGES: {n_steps} gate sections in the working tree, "
            f"{n_head} in HEAD. Mirror counts are checked against both. Only a mirror "
            f"that matches the working tree and contradicts the commit is a problem; "
            f"the rest are reported here, because a permanent red while another lane "
            f"is mid-edit teaches people to ignore the gate.")
    wfs = live_workflows(root)
    # One parsed on: set per workflow, read once and reused by the trigger rule and by
    # the GROUND TRUTH block, so what the gate compares prose against is on screen.
    wf_trigs = {n: triggers_of(t) for n, t in wfs.items()}
    # Job ids per live workflow, read once and shared by rules (7) and (8): two counts of
    # the same file computed in two places is how one of them goes false on its own.
    per_jobs = live_job_totals(root)
    all_ci_text = "\n".join(wfs.values())
    types = accepted_commit_types(root)
    # (ordinal, name, line) for the gates an enumeration is graded against, plus the line
    # of each so a finding can cite where the expected name comes from. The source is the
    # COMMITTED hook, the same surface the count is checked against: reading names off the
    # working copy was bypass one, and it is the defect this file spent a commit removing
    # from the count, relocated rather than new. Rename a header on disk only, point both
    # mirrors at the invented name, and a worktree-based name check certifies a hook that
    # exists in no commit -- with equal section counts on both sides the count divergence
    # never fires, so the names were the only place the lie could be caught.
    if head_text is not None:
        name_source = head_text
        name_source_label = f"HEAD:{HOOK_REL}"
    else:
        name_source = read(root, HOOK_REL)
        name_source_label = f"{HOOK_REL} (working copy, HEAD unreadable)"
        if notices is not None:
            notices.append(
                f"{HOOK_REL}: HEAD is not readable from {root}, so step NAMES fall back "
                f"to the working copy -- the documented no-comparison convention, but it "
                f"means a name claim is being graded against bytes no commit is known to "
                f"contain")
    hook_step_index = [(o, nm, ln) for (o, nm), ln in
                       zip(gate_sections(name_source), gate_section_lines(name_source))]
    hook_step_names = [nm for _, nm, _ in hook_step_index]
    worktree_step_names = [nm for _, nm in steps]
    if head_text is not None and worktree_step_names != hook_step_names and \
            notices is not None:
        # Names diverging while the counts agree is exactly the shape of bypass one, and
        # it is invisible to the count check -- so it is said out loud, and the grading
        # stays on the committed side.
        notices.append(
            f"{HOOK_REL} STEP NAMES DIVERGE: HEAD runs {hook_step_names} while the "
            f"working copy names {worktree_step_names} -- same section count, "
            f"different gates. Enumerations are graded against HEAD, so a mirror "
            f"matching the working copy is matching a hook that is not committed.")

    # Which ordinals are genuinely covered by a live workflow? Determined by
    # matching each step's own tooling against the workflow text, so "which
    # number is Go" is never hardcoded.
    def step_tools(name: str) -> list[str]:
        hook = read(root, ".githooks/pre-commit")
        # The section body: from this header to the next.
        pat = re.compile(r"^# ── " + re.escape(name) + r" ─.*?(?=^# ── |\Z)",
                         re.M | re.S)
        m = pat.search(hook)
        body = m.group(0) if m else name
        # Script names and well-known tools mentioned in the section.
        toks = set(re.findall(r"scripts/([\w.-]+\.(?:py|sh|mjs))", body))
        toks |= {t for t in ("gofmt", "go vet", "go test", "cargo fmt",
                             "clippy", "dedupe-ftl", "lint-i18n",
                             "verify-bundle-parity",
                             "verify-migration-column-types",
                             "generate-pg-migration") if t in body}
        return sorted(t for t in toks if t)

    covered: dict[int, list[str]] = {}
    for ordinal, name in steps:
        tools = step_tools(name)
        hits = [t for t in tools if t in all_ci_text]
        if hits:
            covered[ordinal] = hits

    def verdict(rel: str, claimed: int) -> None:
        """Route one gate-count claim to problems, to notices, or to nowhere.

        Behaviourally identical to what this check did before the committed hook was
        read at all whenever the working copy and the commit hold the same hook: same
        condition, same message, same list, and the two extra branches are unreachable.
        That is the point -- the addition must not be able to change a verdict on a tree
        where nothing diverges, since that tree is every CI run there will ever be.
        """
        if not diverged:
            if claimed != n_steps:
                problems.append(
                    f"{rel}: claims {claimed} pre-commit steps; "
                    f".githooks/pre-commit has {n_steps} gate sections")
        elif claimed == n_steps and claimed != n_head:
            # THE DANGEROUS CASE: a committed claim asserting a count that only the
            # working copy supports. It passes a worktree-only checker, it can be
            # committed, and CI cannot reproduce it, because a clean clone has no
            # divergence for it to hide in.
            problems.append(
                f"{rel}: claims {claimed} pre-commit steps, which matches the working "
                f"tree but NOT the committed hook -- {HOOK_REL} has {n_head} gate "
                f"sections at HEAD and {n_steps} on disk, so this is a committed claim "
                f"about a hook that is not the one it is committed with")
        elif notices is not None:
            # Agrees with the commit, or with neither. In-flight while the hook itself
            # diverges: said out loud, not failed, because a red that no lane can act on
            # is the failure mode this repo already documents for the advisory
            # ci-docs-drift count.
            notices.append(
                f"{rel}: claims {claimed} pre-commit steps, matching "
                + (f"the committed hook ({n_head}) while the working tree holds "
                   f"{n_steps}" if claimed == n_head else
                   f"neither the working tree ({n_steps}) nor the commit ({n_head})")
                + f"; reported, not failed, while {HOOK_REL} diverges")

    for rel in MIRRORS:
        text = read(root, rel)
        if not text:
            problems.append(f"{rel}: missing")
            continue

        claimed = claimed_step_count(text)
        if claimed is None:
            problems.append(f"{rel}: does not state how many pre-commit steps it runs")
        else:
            verdict(rel, claimed)

        # (1b) MEMBERSHIP of the enumeration. Only for a file that presents a numbered
        # enumeration of the steps; step_enumerations() states the three exclusions that
        # decide "presents" (too short, historical by the existing marker notion, or about
        # something else entirely), so a file that never claimed to enumerate is not
        # shouted at.
        # (1c) A CLAIM WITH NOTHING BEHIND IT. Built on the precise pair, not on a
        # hardcoded list of files that "must" enumerate: it fires only where the numeral
        # check found a step claim in this file AND the membership check found no run to
        # police. A mirror that moves its list into a table, un-bolds the labels, or folds
        # it into prose keeps saying "seven steps" while the name rule goes inert, and until
        # now that output was indistinguishable from a mirror whose enumeration is correct.
        # Informational by construction: appended to notices only, never to problems, so it
        # cannot move the exit code.
        # Table recognition was built here, measured, and removed the same minute. It
        # announced both mirrors as "presenting its steps as a table" on the strength of
        # one cell in the unrelated npm-commands table -- "| **Lint** |" is a word-subset of
        # TWO step headers, "Migration column-type lint" and "FTL orphan lint", so the loose
        # matcher that lets the honest "Go gate" shortening pass also turned a one-word cell
        # into evidence that the table is about the steps. A form check built on a knowingly
        # loose matcher indicts files for their shape, which is the failure this whole lane
        # is meant to remove; recognising a table needs the cardinality/ambiguity rule that
        # is still held for a later commit, not a second, weaker copy of the name test.
        runs = step_enumerations(text, hook_step_names)
        if enum_counts is not None:
            enum_counts[rel] = len(runs)
        if claimed is not None and not runs and notices is not None:
            notices.append(
                f"{rel}: presents no checkable step enumeration -- {len(runs)} "
                f"enumerations policed, while it does claim {claimed} pre-commit steps, "
                f"so the membership rule is inert for this file and only its numeral is "
                f"being checked; reported, not failed. The policed form is one numbered "
                f"item per step, like: 1. **name** ...")
        for run in runs:
            missing = [(o, nm, hl) for o, nm, hl in hook_step_index
                       if not any(step_names_match(nm, inm) for _, inm, _ in run)]
            extra = [(n, nm, ln) for n, nm, ln in run
                     if not any(step_names_match(nm, hnm) for _, hnm, _ in hook_step_index)]
            if not missing and not extra:
                continue
            bits = [f'omits step {o} "{nm}" ({name_source_label}:{hl})'
                    for o, nm, hl in missing]
            bits += [f'lists "{nm}" as item {n} ({rel}:{ln}), which is not a gate '
                     f'the hook runs' for n, nm, ln in extra]
            problems.append(
                f"{rel}: numbered enumeration of the steps from {rel}:{run[0][2]} "
                f"disagrees with the hook's step NAMES rather than its count "
                f"(graded against {name_source_label}): "
                + "; ".join(bits))

        # (2) FALSE COVERAGE CLAIM -- the motivating bug.
        for k in sorted(steps_claimed_local_only(text)):
            if k in covered:
                problems.append(
                    f"{rel}: says step {k} has no CI backstop, but "
                    f"{', '.join(covered[k])} runs in a live workflow "
                    f"(step {k} is \"{dict(steps)[k]}\")")

        # (2b) The same lie phrased as prose naming the gates instead of their
        # ordinals. Matched by keyword against each step's own section text, so
        # no phrase-to-step mapping is hardcoded here.
        for phrase in named_local_claims(text):
            for ordinal, name in steps:
                # Flag a step the mirror calls uncovered that IS covered. The
                # first draft had this inverted (`if ordinal in covered:
                # continue`), which then indexed covered[ordinal] on a key known
                # to be absent -- a KeyError that, had the fallback been quieter,
                # would have looked like a passing check.
                if ordinal not in covered:
                    continue
                # Distinctive words from the step's own section header. The
                # quantifier must allow 2-character tokens: the first version
                # used {2,} after the leading letter, i.e. 3+ characters total,
                # which silently dropped "Go" -- so step 8's keys became
                # ['apps','license','server'], none of which appear in the phrase
                # "go", and the exact lie this check exists to catch went
                # unreported while the scan still exited 0.
                keys = [w.lower() for w in re.findall(r"[A-Za-z][\w-]+", name)
                        if w.lower() not in ("gate", "lint", "guard", "staged",
                                             "only", "dry", "run", "normalization")]
                if any(re.search(r"\b" + re.escape(kw) + r"\b", phrase) for kw in keys):
                    problems.append(
                        f"{rel}: says there is no CI job for \"{phrase}\", but "
                        f"step {ordinal} (\"{name}\") is covered by "
                        f"{', '.join(covered[ordinal])} in a live workflow")
                    break

        # (2c) The same lie a third time, in the "guarded only by the local hook"
        # phrasing. This one was found against my own edit: after bundle-parity got
        # a CI step, .prime still made that claim and the scan passed, because both
        # patterns above need the negation to lead.
        for phrase in local_only_claims(text):
            for ordinal, name in steps:
                if ordinal not in covered:
                    continue
                keys = [w.lower() for w in re.findall(r"[A-Za-z][\w-]+", name)
                        if w.lower() not in ("gate", "lint", "guard", "staged",
                                             "only", "dry", "run", "normalization")]
                # Also the step's own tooling, via the same helper that decided
                # `covered`: prose names tools ("verify-bundle-parity.py") that the
                # section HEADER never contains. Re-deriving the section body here
                # with a `hook_text` variable that does not exist was my first draft
                # -- and because local_only_claims() also returned nothing at that
                # point, the loop body never ran and the NameError stayed hidden
                # behind a green exit. A latent crash in a branch that never fires
                # is the worst kind: it is invisible until the day it matters.
                keys += [t.lower() for t in step_tools(name)]
                if any(re.search(r"\b" + re.escape(kw.replace(".", r"\.")) + r"\b", phrase)
                       for kw in keys):
                    problems.append(
                        f"{rel}: says \"{phrase}\" is guarded only by the local hook, "
                        f"but step {ordinal} (\"{name}\") is covered by "
                        f"{', '.join(covered[ordinal])} in a live workflow")
                    break

        # (5) version lock. The mirrors have phrased this differently over time:
        #   root/.agents : "Version is locked at `0.0.36`"
        #   (removed) .prime: "Version is locked at the current release (`0.0.36`)"
        # A regex demanding the version immediately after "locked at" reported the
        # second phrasing as unversioned, so the window stays wide. Both surviving
        # mirrors use the first form; the leniency is deliberate, not an oversight.
        if not re.search(r"locked at[^\n]{0,40}[\(`]" + re.escape(version) + r"[\)`]",
                         text):
            problems.append(f"{rel}: does not carry the current version lock ({version})")

        # (4) commit types
        doc = documented_commit_types(text)
        if doc:
            missing = types - doc
            extra = doc - types
            if missing:
                problems.append(
                    f"{rel}: omits commit type(s) the gate accepts: {sorted(missing)}")
            if extra:
                problems.append(
                    f"{rel}: documents commit type(s) the gate rejects: {sorted(extra)}")

        # (6) TRIGGER CLAIMS, BOTH DIRECTIONS, per workflow. This used to read one
        # sentence shape -- the literal verb pair "runs on" within 80 characters of CI and
        # of push -- against one OR-ed fact (does ANY live workflow declare push). So a
        # mirror writing the true thing in other words ("a push to main therefore does run
        # CI") scored no match, and a mirror DENYING a trigger that every live workflow
        # declares scored no match either: both read as silence, and silence is green. Now
        # an assertion fails when no workflow IN SCOPE has a push trigger and a denial
        # fails when one does, scope being the workflow the sentence itself names.
        problems.extend(push_claim_findings(text, rel, wf_trigs, wfs))

    # (3) MISSING COVERAGE: a mirror asserting CI runs a job that does not exist.
    for rel in MIRRORS:
        text = read(root, rel)
        real_jobs = {j for t in wfs.values() for j in workflow_jobs(t)}
        for job in set(re.findall(r"(?:dev-ci\.yml|workflows/[\w.]+)#([\w-]+)", text)):
            if job not in real_jobs:
                problems.append(f"{rel}: cites workflow job #{job}, which no live workflow defines")

    # (7) JOB TOTALS and (8) MIRROR TARGETS, over every file that carries those claims.
    #
    # Separate from the MIRRORS loop above because these two claims are not mirror-only:
    # the wrong total lived in scripts/check.sh, docs/operations/agent-gates.md and
    # CONTRIBUTING.md for two releases, and the retired-workflow target lived in
    # scripts/check.ps1's header. Policing only MIRRORS would leave the rot exactly where
    # the audit found it.
    #
    # A missing workflow or job is not a claim at all, so nothing here is a NOTICE: both
    # rules compare a claim the file MAKES against ground truth READ from the workflows,
    # and a disagreement is the failure. The only absent-ground-truth case -- no live
    # workflow at all -- is named in the finding rather than silently passing.
    for rel in PROSE_FILES + JOB_PROSE_FILES:
        if rel not in MIRRORS and not (root / rel).is_file():
            continue
        text = read(root, rel)
        if not text:
            continue
        problems.extend(job_total_findings(text, rel, wfs, per_jobs))
        problems.extend(mirror_target_findings(text, rel, wfs, per_jobs))

    # (4) SKILL FILES. A mirror must state the count; a skill need not mention it at all.
    # But when a skill DOES state one it is a claim agents follow, and two of them went
    # stale silently as steps 9 and 10 landed -- skill-drift-guard cannot see this because
    # detect.sh contains no reference to gates or the hook, and these files were outside
    # this checker entirely. Only a disagreement is a problem; silence is not.
    for skill in sorted((root / ".agents" / "skills").glob("*/SKILL.md")):
        rel = skill.relative_to(root).as_posix()
        text = skill.read_text(encoding="utf-8", errors="replace")
        claimed = skill_claimed_step_count(text)
        if claimed is not None:
            # Same routing as the mirrors, which means one visible widening rather than a
            # silent one: while the hook diverges, a skill that matches the COMMITTED
            # count is an in-flight condition too, and failing it would put the whole
            # repo in red for someone else's mid-edit. With the two copies agree this
            # call does what the inline comparison above always did.
            verdict(rel, claimed)

    return problems


ALWAYS_READ = ("Cargo.toml", HOOK_REL, ".githooks/commit-msg", *MIRRORS)


def walk_counts(root: Path) -> dict:
    """What this gate actually found to read under ROOT, as counts and named absences.

    The point is a zero walk: read the wrong directory and every check returns nothing,
    which is the same degeneracy the enumeration count exists to expose. Numbers with
    their unit, and the missing paths spelled out, so nothing has to be inferred.
    """
    missing = [rel for rel in ALWAYS_READ if not (root / rel).is_file()]
    wfs = len(list((root / ".github" / "workflows").glob("*.yml")))
    skills = len(list((root / ".agents" / "skills").glob("*/SKILL.md")))
    found = len(ALWAYS_READ) - len(missing)
    return {"missing": missing, "total": len(ALWAYS_READ), "found": found,
            "workflows": wfs, "skills": skills, "walked": found + wfs + skills}


def report(root: Path) -> int:
    version = current_version(root)
    steps = hook_steps(root)
    wfs = live_workflows(root)
    print("  GROUND TRUTH (read from the repo, not asserted):")
    print(f"    version from Cargo.toml   : {version}")
    print(f"    pre-commit gate sections  : {len(steps)}")
    for ordinal, name in steps:
        print(f"      step {ordinal:<2} {name}")
    print(f"    live workflows            : {', '.join(wfs) or '(none)'}")
    # Per-surface visibility for the trigger rule: the set each workflow's own on: block
    # yields is what every push claim is graded against, so a parse that silently returns
    # nothing (the old triggers_of bug) is visible on the screen instead of only inside a
    # finding that can no longer fire.
    for _n, _t in wfs.items():
        print(f"      triggers of {_n:<24}: {', '.join(triggers_of(_t)) or '(no on: block parsed)'}")
    print(f"    commit types accepted     : {sorted(accepted_commit_types(root))}")
    wc = walk_counts(root)
    # Printed only when the walk is NOT whole, which is what makes a zero walk unable to
    # read as clean. Today every policed path exists and both globs are non-empty, so this
    # adds no byte to the output case 12 pinned; the moment the root is wrong -- the exact
    # failure git-based resolution exists to prevent -- the number appears next to the
    # missing paths and the reason this root was chosen.
    if wc["missing"] or not wc["workflows"] or not wc["skills"]:
        print(f"    files walked              : {wc['walked']} read, "
              f"{len(wc['missing'])} of {wc['total']} policed paths missing "
              f"[{', '.join(wc['missing']) or '-'}], workflows {wc['workflows']}, "
              f"skills {wc['skills']}; root from {ROOT_SOURCE}")
    print()

    # Notices are the diverging-ground-truth channel: printed, never counted. A lane
    # mid-edit on the hook must not put a permanent red across the repo -- this file
    # already documents why an un-actionable red is worse than no red (dev-ci's advisory
    # ci-docs-drift count is deliberately non-blocking for the same reason).
    notices: list[str] = []
    enum_counts: dict[str, int] = {}
    problems = scan(root, notices=notices, enum_counts=enum_counts)
    # Always printed, one line per mirror: the quantity, with its unit. A clean run used
    # to say nothing here, and nothing is not the same as "one enumeration, and it was
    # fine" -- that gap is the difference between unobserved and unobservable, and it is
    # why the conditional notice alone did not close the hole. Informational by
    # construction: printed from a dict scan filled, never appended to problems.
    for rel in MIRRORS:
        n_runs = enum_counts.get(rel, 0)
        print(f"    step claims, {rel:<22}: {n_runs} "
              + ("enumeration policed" if n_runs == 1 else "enumerations policed"))
    print()
    if notices:
        print("  NOTICES (reported because the ground truth itself is diverging;")
        print("           0 of these count as problems and none of them fail the run):")
        for nt in notices:
            print(f"    ! {nt}")
        print()
    if problems:
        print(f"  {len(problems)} problem(s):")
        for p in problems:
            print(f"    - {p}")
        return 1
    # Derived, never asserted: this said "all three mirrors" while MIRRORS held
    # three, and would have gone quietly false when .prime/AGENTS.md was deleted.
    print(f"  all {len(MIRRORS)} mirrors agree with the repo")
    return 0


# ── Self-test: mutate a copy and prove each check fires ─────────────────────

def _plant_ci_claim(text, claim):
    """Plant a FALSE CI-coverage claim ahead of an anchor both mirrors carry.

    This replaced `_retarget_ci_claim`, which rewrote the true sentence "All <N> steps now
    have a CI backstop" into a false one. That was elegant while the mirrors carried the
    sentence, but the gate section was later rewritten to delegate per-step coverage to
    `docs/operations/agent-gates.md`, so the true sentence no longer exists, every retarget
    became a no-op, and the vacuous-mutation guard reported WRONG for both entries. The
    RULES these two mutations prove are still live (a step listed as local-only / no CI
    backstop; a subject guarded only by the local hook), so the mutation now PLANTS the
    false claim instead of restoring it -- the guard is what makes this table trustworthy,
    and it was the guard, not the rule, that caught the drift.
    """
    anchor = "Per-step commands and CI backstops"
    if anchor not in text:
        return text
    return text.replace(anchor, claim + anchor, 1)


MUTATIONS = [
    # Anchors here must be text that EXISTS in the current mirrors. The first
    # version of this entry pointed at "Steps 6 and 7 are local-only", which I
    # deleted when those steps got CI steps -- so the mutation changed nothing and
    # the vacuous-mutation guard reported WRONG rather than letting a no-op count
    # as a pass. That guard is the reason this table can be trusted at all.
    # Everything below now matches on a pattern rather than a literal count word, for
    # exactly that reason.
    ("false CI-coverage claim restored (negation phrasing)",
     lambda t: _plant_ci_claim(
         t,
         "Steps 6 and 7 are local-only; there is no CI job for migration column "
         "types or PG schema drift. "),
     "no CI"),
    ("false local-only claim (participial phrasing)",
     lambda t: _plant_ci_claim(
         t,
         "The remaining gap is `verify-migration-column-types.py`, still guarded "
         "only by the opt-in local hook. "),
     # The harness matches this against the FINDING message
     # (`AGENTS.md: says "verify-migration-column-types.py" is guarded only by ...`), not
     # against the mutated document. It previously read "only by the local hook", which is
     # not a substring of the inserted text either ("only by the opt-in local hook"), so a
     # real catch was being reported as MISSED.
     "verify-migration-column-types.py"),
    ("gate count off by one",
     lambda t: re.sub(r"runs \*\*(?:eight|nine|ten|[a-z]+) steps\*\*",
                      "runs **six steps**", t, count=1),
     "pre-commit steps"),
    ("version lock removed",
     lambda t: re.sub(r"locked at `[\d.]+`", "locked at `0.0.1`", t),
     "version lock"),
    ("commit type dropped from the list",
     lambda t: re.sub(r"^\s*-\s+`style`[^\n]*\n", "", t, count=1, flags=re.M),
     "omits commit type"),
    ("phantom CI job cited",
     lambda t: t.replace("dev-ci.yml#static-gates", "dev-ci.yml#go-job", 1),
     "#go-job"),
    # Repointed 2026-09-14: with triggers_of() repaired, dev-ci.yml DOES declare push, so
    # "Dev CI runs on push to main" stopped being a false claim -- a mutation that plants a
    # true sentence cannot test anything, and the assertion direction now lives in case (16)
    # where the fixture workflow is stripped of its push trigger. This entry keeps the
    # denial direction honest on the tree as it stands.
    # Re-anchored 2026-09-20: the old anchor ("Two workflows are live") was removed from the
    # mirrors, so the replace() was a no-op and the vacuous-mutation guard reported WRONG.
    # The new anchor is a line both mirrors carry verbatim.
    ("push trigger falsely denied",
     lambda t: t.replace("Seven steps, each firing only on the paths it cares about",
                         "Dev CI has no push trigger in dev-ci.yml. "
                         "Seven steps, each firing only on the paths it cares about", 1),
     "denies a push trigger"),
]

# Per-mirror mutation tables. A mirror that phrases the same facts differently
# from root needs its own anchors, or the root mutations match nothing and the
# self-test passes vacuously -- the vacuous-mutation guard exists precisely to
# catch that.
#
# The only bespoke table here belonged to .prime/AGENTS.md, a role brief that
# phrased the version lock and the CI-coverage negation in its own words. That
# file was deleted with the .prime/ tree on 08-09-26 and its table went with it.
# The mechanism stays because the next mirror added will need it: anything
# genuinely not applicable must be recorded with a reason (mutate=None) rather
# than silently skipped.
MUTATIONS_BY_MIRROR: dict[str, list] = {}


def make_fixture(src: Path, dst: Path) -> None:
    """Copy ONLY the files scan() reads.

    The first version ran a whole-repo `copytree` per mutation: slow, and it
    collided with itself on Windows temp paths. scan() reads a handful of files;
    copying exactly those keeps the self-test in milliseconds and stays honest,
    because the ground truth still comes from the real hook, workflows and
    Cargo.toml rather than a hand-written stub that could drift from them.
    """
    needed = ["Cargo.toml", ".githooks/pre-commit", ".githooks/commit-msg"]
    wfdir = src / ".github" / "workflows"
    if wfdir.is_dir():
        needed += [f".github/workflows/{p.name}" for p in sorted(wfdir.glob("*.yml"))]
    needed += MIRRORS
    # PROSE_FILES too, for the same reason the skills are: rules (7) and (8) read these
    # files, and a fixture that omits them would make those rules check nothing while
    # the self-test still reported every case CAUGHT -- the vacuous pass this helper
    # already documents for SKILL.md.
    needed += [rel for rel in PROSE_FILES + JOB_PROSE_FILES if rel not in MIRRORS]
    # Skills are scanned too, so they must be in the fixture. Omitting them would not fail
    # loudly: scan() globs the fixture, finds no SKILL.md, checks nothing, and the self-test
    # reports every mutation caught while the skill branch never ran at all.
    skillroot = src / ".agents" / "skills"
    if skillroot.is_dir():
        needed += [f".agents/skills/{p.relative_to(skillroot).as_posix()}"
                   for p in sorted(skillroot.glob("*/SKILL.md"))]
    for rel in needed:
        s = src / rel
        if not s.is_file():
            continue
        d = dst / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        io.open(d, "w", encoding="utf-8", newline="\n").write(
            io.open(s, encoding="utf-8", errors="replace").read())


def self_test() -> int:
    """Run the cases, then print the tally the report used to have to remember.

    Every numeric slip in this file's commit messages tonight was this number, quoted
    from memory across a commit boundary by a worker that had already run something else
    since. It is now recomputed from the text the cases actually printed, so a case that
    stops printing stops being counted rather than being remembered.
    """
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = _self_test_cases()
    text = buf.getvalue()
    sys.stdout.write(text)
    # Counted per VERDICT LINE, by its leading word, not by substring occurrence. Substring
    # counting is the attribution bug: "CAUGHT " and "CLEAN " also appear inside verdict
    # MESSAGES (a MISSED line quoting the CLEAN expectation it never got would be counted
    # green as well as red), and a count that can double-tally one print can just as easily
    # lose one, which is how a tally of 28 met a suite of 29 in someone's terminal. Prefix
    # matching makes the number the number of lines a reader can point at.
    caught = clean = red = 0
    for line in text.splitlines():
        if line.startswith("  CAUGHT"):
            caught += 1
        elif line.startswith("  CLEAN"):
            clean += 1
        elif line.startswith("  MISSED") or line.startswith("  WRONG"):
            red += 1
    # The cases keep their own exit code; if the two ever disagree, the tally says so
    # rather than quietly reporting a green that the suite did not compute.
    disagree = "" if (red > 0) == (rc != 0) else f" (DISAGREES with rc {rc})"
    print(f"  count line: {caught + clean} green = {caught} CAUGHT + {clean} CLEAN; "
          f"{red} red; exit {rc}{disagree}")
    return rc


def _self_test_cases() -> int:
    import shutil
    import tempfile

    src = DEFAULT_ROOT
    bad = 0
    for rel in MIRRORS:
        text = read(src, rel)
        if not text:
            print(f"  SKIP  {rel}: not present")
            continue
        for desc, mutate, needle in MUTATIONS_BY_MIRROR.get(rel, MUTATIONS):
            if mutate is None:
                # An explicitly not-applicable case. Printed, not skipped, so a
                # future reader sees the coverage was considered and bounded.
                print(f"  N/A     {rel:20s} {desc} -- {needle}")
                continue
            mutated = mutate(text)
            if mutated == text:
                print(f"  WRONG {rel}: mutation '{desc}' changed nothing -- the "
                      f"test would pass vacuously")
                bad += 1
                continue
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                make_fixture(src, tmp)
                io.open(tmp / rel, "w", encoding="utf-8", newline="\n").write(mutated)
                try:
                    probs = scan(tmp)
                except SystemExit as e:
                    print(f"  WRONG {rel}: '{desc}' crashed the checker: {e}")
                    bad += 1
                    continue
                hit = [p for p in probs if needle in p and rel in p]
                if hit:
                    print(f"  CAUGHT  {rel:20s} {desc}")
                else:
                    print(f"  MISSED  {rel:20s} {desc} (looking for {needle!r}; "
                          f"{len(probs)} findings: {[p[:58] for p in probs[:3]]})")
                    bad += 1
    # (5) Skill coverage. Three cases, because the two failure modes here are opposite.
    skill_rel = ".agents/skills/hal-drivers/SKILL.md"
    if not (src / skill_rel).is_file():
        print(f"  WRONG skills: {skill_rel} absent, so the skill branch cannot be exercised")
        bad += 1
    else:
        base = read(src, skill_rel)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            # Guard the guard: if the fixture has no skills, scan() checks nothing and every
            # case below would "pass" while the branch never ran.
            if not list((tmp / ".agents" / "skills").glob("*/SKILL.md")):
                print("  WRONG skills: make_fixture copied no SKILL.md -- the skill "
                      "branch is unexercised, so any 'caught' result below is vacuous")
                bad += 1
            else:
                n = len(hook_steps(tmp))
                stale = (f"\n## Probe\n\n- The .githooks/pre-commit hook runs "
                         f"{'seven' if n != 7 else 'nine'} steps before every commit.\n")
                hist = (f"\n## Probe\n\n- The .githooks/pre-commit hook previously ran "
                        f"{'seven' if n != 7 else 'nine'} steps before every commit.\n")
                for desc, payload, want_hit in (
                    ("stale count claimed as current", stale, True),
                    ("same count on a historical line", hist, False),
                ):
                    io.open(tmp / skill_rel, "w", encoding="utf-8", newline="\n").write(
                        base + payload)
                    probs = scan(tmp)
                    hit = any(skill_rel in p and "pre-commit steps" in p for p in probs)
                    if hit == want_hit:
                        verdict = "CAUGHT" if hit else "CLEAN "
                        print(f"  {verdict}  {skill_rel:38s} {desc}")
                    else:
                        print(f"  MISSED  {skill_rel:38s} {desc} "
                              f"(expected {'a finding' if want_hit else 'silence'}, got "
                              f"the opposite; {[p[:52] for p in probs[:2]]})")
                        bad += 1

                # (6) Only the FIRST pattern in SKILL_COUNT_RES can reach a word numeral via a
                # prose prefix ("there are **six gates**"), and that pattern's word branch is
                # written non-capturing while the parser below reads m.group(2). The failure is
                # not a wrong count but an IndexError that kills the checker, and nothing here
                # exercised it: every existing skill case is phrased so the second pattern --
                # the one with two groups -- is what matches. Parsed straight through
                # skill_claimed_step_count rather than through scan(), because scan() only
                # compares a claim against the live hook count, so a coincidentally correct
                # number would report CAUGHT while the group read still raised.
                probe = "- There are **six gates** in this hook.\n"
                try:
                    got = skill_claimed_step_count(probe)
                except IndexError as exc:
                    print(f"  WRONG {skill_rel:38s} first-pattern word numeral raised "
                          f"IndexError ({exc!r}) instead of parsing")
                    bad += 1
                else:
                    if got == 6:
                        print(f"  CAUGHT  {skill_rel:38s} first-pattern word numeral "
                              f"parses to {got}")
                    else:
                        print(f"  MISSED  {skill_rel:38s} first-pattern word numeral "
                              f"parsed to {got!r}, expected 6")
                        bad += 1

    # (7) Diverging ground truth. THE DANGEROUS CONFIGURATION is a mirror claiming the
    # WORKTREE count while the COMMITTED hook carries another one -- the state a
    # worktree-only checker certifies as green, and the state CI cannot reproduce,
    # because a clean clone has one hook rather than two. Two sides to control, so the
    # worktree side is written into the fixture and the committed side arrives through
    # scan()'s head_hook_text seam; mutating one string cannot express this case.
    committed_hook = read(src, ".githooks/pre-commit")
    n_committed = len(gate_sections(committed_hook))
    worktree_hook = committed_hook + "\n# ── Probe gate ─────────────────────────\n"
    n_worktree = len(gate_sections(worktree_hook))
    mirror_rel = MIRRORS[0]
    if n_worktree == n_committed:
        print("  WRONG diverging hook: the probe section did not change the committed "
              f"count ({n_committed}) -- the fixture controls nothing")
        bad += 1
    else:
        for desc, claim, want_problem in (
            (f"mirror claims the worktree count ({n_worktree}) while HEAD has "
             f"{n_committed} -- dangerous", n_worktree, True),
            (f"mirror claims the committed count ({n_committed}) while the worktree "
             f"holds {n_worktree} -- in-flight", n_committed, False),
        ):
            word = {v: k for k, v in WORD_NUM.items()}.get(claim, str(claim))
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                make_fixture(src, tmp)
                io.open(tmp / ".githooks/pre-commit", "w", encoding="utf-8",
                        newline="\n").write(worktree_hook)
                base_text = read(tmp, mirror_rel)
                mutated = re.sub(
                    r"runs \*\*(?:one|two|three|four|five|six|seven|eight|nine|ten|"
                    r"eleven|twelve|\d+) steps\*\*",
                    f"runs **{word} steps**", base_text, count=1)
                # Guard on the value the fixture actually states, not on the substitution
                # having changed bytes: for the committed-count case the mirror may
                # already carry that number, which is a valid fixture, not a dead anchor.
                if claimed_step_count(mutated) != claim:
                    print(f"  WRONG {mirror_rel}: case (7) cannot set the mirror to "
                          f"{claim} steps (it parses as "
                          f"{claimed_step_count(mutated)}) -- dead anchor")
                    bad += 1
                    continue
                io.open(tmp / mirror_rel, "w", encoding="utf-8",
                        newline="\n").write(mutated)
                notes: list[str] = []
                probs = scan(tmp, head_hook_text=committed_hook, notices=notes)
                hit = [p for p in probs
                       if mirror_rel in p and "NOT the committed hook" in p]
                diverged_noted = any("DIVERGES" in s for s in notes)
                if want_problem:
                    if hit and diverged_noted:
                        print(f"  CAUGHT  {mirror_rel:20s} {desc}")
                    else:
                        print(f"  MISSED  {mirror_rel:20s} {desc} -- {len(probs)} "
                              f"problem(s), {len(notes)} notice(s), named the "
                              f"divergence: {diverged_noted}; "
                              f"{[p[:64] for p in probs[:2]]}")
                        bad += 1
                elif hit or not diverged_noted:
                    print(f"  MISSED  {mirror_rel:20s} {desc} -- the safe case failed "
                          f"the run (hit: {[p[:64] for p in hit]})")
                    bad += 1
                else:
                    print(f"  CLEAN   {mirror_rel:20s} {desc}")

    # (8) Enumeration MEMBERSHIP while the numeral stays correct. A numeral-only checker
    # passes a mirror listing seven wrong names, which is the gap the root AGENTS.md stamp
    # concedes in its own words ("an enumeration inside prose is unenforced by
    # construction"). The probe name is "i18n lint", a gate the superseded onboarding-guide
    # audit stamp records: real history, so this case asserts BOTH sides of the same word --
    # it must fail as a live claim and keep passing as a preserved record.
    hist_probe = ("\n## Probe\n\n"
                  "1. **cargo fmt** — previously a pre-commit gate\n"
                  "2. **i18n lint** — previously a pre-commit gate\n"
                  "3. **bundle parity** — previously a pre-commit gate\n")
    for desc, mutate8, want_problem in (
        ("live enumeration names a gate the hook does not run",
         lambda t: t.replace("**Go gate**", "**i18n lint**", 1), True),
        ("the same names inside a historically-marked enumeration",
         lambda t: t + hist_probe, False),
    ):
        rel8 = MIRRORS[0]
        base8 = read(src, rel8)
        mutated8 = mutate8(base8)
        if mutated8 == base8:
            print(f"  WRONG {rel8}: case (8) anchored on nothing -- {desc}")
            bad += 1
            continue
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            io.open(tmp / rel8, "w", encoding="utf-8",
                    newline="\n").write(mutated8)
            probs = scan(tmp)
            hit = [p for p in probs
                   if rel8 in p and "disagrees with the hook's step NAMES" in p]
            named = [p for p in hit if "i18n lint" in p]
            numeral_silent = not any(rel8 in p and "pre-commit steps; " in p
                                      for p in probs)
            if want_problem:
                if hit and named and numeral_silent:
                    print(f"  CAUGHT  {rel8:20s} {desc} (count check stayed silent, so "
                          "only the name test could fire)")
                else:
                    print(f"  MISSED  {rel8:20s} {desc} -- {len(hit)} name finding(s), "
                          f"{len(named)} naming the invented gate, numeral silent: "
                          f"{numeral_silent}; {[p[:62] for p in probs[:2]]}")
                    bad += 1
            elif hit:
                print(f"  MISSED  {rel8:20s} {desc} -- preserved history was punished: "
                      f"{[p[:78] for p in hit]}")
                bad += 1
            else:
                print(f"  CLEAN   {rel8:20s} {desc}")

    # (9) BYPASS ONE regression: a step header renamed in the WORKING COPY only, with both
    # mirrors moved to the invented name. Section counts stay equal on both sides, so the
    # count divergence never fires and the only thing that can catch the lie is grading
    # NAMES against the committed hook. The paired case asserts the other half of the
    # repair: with no commit to read, the fallback is accepted AND said out loud, because
    # silently grading a claim against uncommitted bytes is what let this through.
    def rename_item6(text, label):
        return re.sub(r"^(6\. \*\*)([^*]+)(\*\*)",
                      lambda m: m.group(1) + label + m.group(3), text, count=1, flags=re.M)

    committed_hook0 = read(src, ".githooks/pre-commit")
    renamed_hook = committed_hook0.replace("# ── Go gate: apps/license-server ─",
                                           "# ── Style formatting gate: apps/license-server ─",
                                           1)
    rel9 = MIRRORS[0]
    if renamed_hook == committed_hook0:
        print("  WRONG names-from-HEAD: the Go gate header anchor is gone from the hook, "
              "so case (9) controls nothing")
        bad += 1
    else:
        for desc, head_arg, want_problem in (
            ("renamed header, HEAD readable -- mirrors follow the invented name",
             committed_hook0, True),
            ("renamed header, no HEAD readable -- accepted but announced", None, False),
        ):
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                make_fixture(src, tmp)
                io.open(tmp / ".githooks/pre-commit", "w", encoding="utf-8",
                        newline="\n").write(renamed_hook)
                changed = 0
                for rel in MIRRORS:
                    base9 = read(tmp, rel)
                    mut9 = rename_item6(base9, "Style formatting gate")
                    if mut9 == base9:
                        print(f"  WRONG {rel}: case (9) anchored on nothing -- no "
                              "item 6 with a bold label")
                        bad += 1
                    else:
                        changed += 1
                    io.open(tmp / rel, "w", encoding="utf-8",
                            newline="\n").write(mut9)
                if changed != len(MIRRORS):
                    continue
                notes9: list[str] = []
                probs9 = scan(tmp, head_hook_text=head_arg, notices=notes9)
                named = [p for p in probs9
                         if "Style formatting gate" in p
                         and "disagrees with the hook's step NAMES" in p]
                fell_back = any("fall back" in s for s in notes9)
                diverged = any("NAMES DIVERGE" in s for s in notes9)
                if want_problem:
                    if named and diverged:
                        print(f"  CAUGHT  {rel9:20s} {desc} "
                              f"({len(named)} finding(s), divergence announced)")
                    else:
                        print(f"  MISSED  {rel9:20s} {desc} -- {len(named)} finding(s) "
                              f"naming the invented gate, NAMES-divergence notice: "
                              f"{diverged}; {[p[:60] for p in probs9[:2]]}")
                        bad += 1
                elif named:
                    print(f"  MISSED  {rel9:20s} {desc} -- the no-git fallback was "
                          f"turned into a failure: {[p[:60] for p in named]}")
                    bad += 1
                elif not fell_back:
                    print(f"  MISSED  {rel9:20s} {desc} -- fell back silently, which is "
                          "the half of the repair that keeps it honest")
                    bad += 1
                else:
                    print(f"  CLEAN   {rel9:20s} {desc} (fallback announced)")

    # (10) BYPASS TWO regression: one HISTORICAL_MARKERS hit anywhere in a run used to
    # excuse the whole list. Item 6 is set to the invented "i18n lint" -- the same drift
    # case (8) uses -- and the marker words land on item 1, three lines away from the
    # claim they are now supposed to have nothing to do with.
    rel10 = MIRRORS[0]
    base10 = read(src, rel10)
    mut10 = rename_item6(base10, "i18n lint")
    lines10 = mut10.splitlines()
    lines10[28] = lines10[28] + "  (count corrected in this revision)"
    mut10 = "\n".join(lines10)
    if mut10 == base10 or "i18n lint" not in mut10:
        print("  WRONG " + rel10 + ": case (10) anchored on nothing -- dead probe")
        bad += 1
    else:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            io.open(tmp / rel10, "w", encoding="utf-8",
                    newline="\n").write(mut10)
            probs10 = scan(tmp)
            hit10 = [p for p in probs10
                     if rel10 in p and "i18n lint" in p
                     and "disagrees with the hook's step NAMES" in p]
            if hit10:
                print(f"  CAUGHT  {rel10:20s} marker on another item does not excuse "
                      "this one")
            else:
                print(f"  MISSED  {rel10:20s} marker on another item excuses the whole "
                      f"run -- {len(probs10)} problem(s): "
                      f"{[p[:62] for p in probs10[:2]]}")
                bad += 1

    # (11) A CLAIM WITH NOTHING BEHIND IT. The hole was measured, not assumed: the same
    # seven steps rendered as a markdown table leaves both mirrors claiming a count while
    # the membership rule has no run to police, and printed nothing at all -- a file with
    # no checkable claim was indistinguishable from a file whose claim is true. This case
    # renders that table, plants the invented "i18n lint" label inside it, and asserts the
    # per-file notice fires with its count; the companion asserts the notice does NOT fire
    # on an untouched mirror, which is what keeps it from becoming permanent noise.
    def table_with_wrong_label(text):
        lines = text.splitlines()
        starts = [i for i, l in enumerate(lines) if ENUM_ITEM_RE.match(l)
                  and BOLD_RE.search(l)]
        if len(starts) < MIN_ENUM_ITEMS:
            return text
        first, last = starts[0], starts[-1]
        labels = [BOLD_RE.search(lines[i]).group(1).replace("`", "").strip()
                  for i in starts]
        labels[5] = "i18n lint"
        body = ["", "| step | gate |", "|---|---|"]
        body += ["| %d | %s |" % (i + 1, lab) for i, lab in enumerate(labels)]
        return "\n".join(lines[:first] + body + lines[last + 1:])

    for desc, mutate11, want_notice in (
        ("steps rendered as a table, invented label inside", table_with_wrong_label, True),
        ("untouched mirror, enumeration policed as normal", lambda t: t, False),
    ):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            anchored = True
            for rel in MIRRORS:
                base11 = read(tmp, rel)
                mut11 = mutate11(base11)
                if mut11 == base11 and want_notice:
                    anchored = False
                    continue
                io.open(tmp / rel, "w", encoding="utf-8",
                        newline="\n").write(mut11)
            if not anchored:
                print(f"  WRONG {MIRRORS[0]}: case (11) cannot render the table -- no "
                      "numbered bold items found to convert")
                bad += 1
                continue
            notes11: list[str] = []
            probs11 = scan(tmp, notices=notes11)
            fired = [s for s in notes11 if "enumerations policed" in s]
            failed_hard = [p for p in probs11 if "enumeration" in p]
            if want_notice:
                if len(fired) == len(MIRRORS) and "0 enumerations policed" in fired[0] \
                        and not failed_hard:
                    print(f"  CAUGHT  {MIRRORS[0]:20s} {desc} -- one notice per mirror, "
                          "with its count, and it did not fail the run")
                else:
                    print(f"  MISSED  {MIRRORS[0]:20s} {desc} -- {len(fired)} of "
                          f"{len(MIRRORS)} mirror(s) announced; count printed: "
                          f"{'0 enumerations policed' in (fired[0] if fired else '')}; "
                          f"problems: {[p[:56] for p in failed_hard]}")
                    bad += 1
            elif fired or failed_hard:
                print(f"  MISSED  {MIRRORS[0]:20s} {desc} -- the notice fires on a file "
                      f"whose enumeration IS policed: {[s[:60] for s in fired]}")
                bad += 1
            else:
                print(f"  CLEAN   {MIRRORS[0]:20s} {desc}")

    # (12) THE ALWAYS-ON LINE ITSELF. Cases 1-11 all assert on the list scan() returns, so
    # the two informational lines report() prints could be deleted and every one of them
    # would stay green -- a claim on screen with no check behind it, which is the same class
    # this file keeps finding in other people's docs. This one asserts on the gate's OWN
    # stdout: exactly one count line per policed mirror, the numeral it carries equal to the
    # number scan computed, the unit adjacent to it, and no file outside the policed set
    # named anywhere in the output.
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        make_fixture(src, tmp)
        counts12: dict[str, int] = {}
        scan(tmp, enum_counts=counts12)
        out12 = io.StringIO()
        with contextlib.redirect_stdout(out12):
            rc12 = report(tmp)
        text12 = out12.getvalue()
        lines12 = [l for l in text12.splitlines()
                   if "enumeration policed" in l or "enumerations policed" in l]
        unpadded = [rel for rel in MIRRORS
                    if not any(f"step claims, {rel:<22}:" in l
                               and f"{counts12.get(rel, -1)} enumeration" in l
                               for l in lines12)]
        outsiders = [p for p in ("onboarding-guide", "SKILL.md", "audit-open-findings",
                                 "parity-unanswerable") if p in text12]
        if len(lines12) == len(MIRRORS) and not unpadded and not outsiders and rc12 == 0:
            print(f"  CAUGHT  {MIRRORS[0]:20s} gate stdout carries the count line for "
                  f"every policed mirror ({len(lines12)} lines, numerals "
                  f"{[counts12.get(r) for r in MIRRORS]}) and names nothing outside the "
                  "policed set")
        else:
            print(f"  MISSED  {MIRRORS[0]:20s} the always-on print is not pinned: "
                  f"{len(lines12)} line(s) for {len(MIRRORS)} mirrors, unpinned="
                  f"{unpadded}, outsiders={outsiders}, report rc={rc12}; "
                  f"lines={[l.strip()[:52] for l in lines12[:2]]}")
            bad += 1

    # (13) THE NOTICES BLOCK, ON STDOUT, THROUGH THE CHANNEL THAT PRINTS IT. Case 12 fixed
    # the count line being asserted only through scan()'s return value; the notices were the
    # same gap one step away, so report() could stop printing them and every case would stay
    # green. This runs the gate on a mirror that satisfies the pair predicate -- it still
    # states a step count, and now presents no policed enumeration -- and asserts the notice
    # reaches stdout, one line per mirror, carrying its "reported, not failed" label, with
    # report() still returning 0; the companion asserts a clean mirror produces no such line.
    # About the print and the channel, not about the wording.
    def drop_enumeration(text):
        return "\n".join(l for l in text.splitlines()
                         if not (ENUM_ITEM_RE.match(l) and BOLD_RE.search(l)))

    for desc, mutate13, expect_lines in (
        ("mirror states a count, enumerates nothing", drop_enumeration, len(MIRRORS)),
        ("untouched mirror, enumeration intact", lambda t: t, 0),
    ):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            short = 0
            for rel in MIRRORS:
                base13 = read(tmp, rel)
                mut13 = mutate13(base13)
                lost = len(base13.splitlines()) - len(mut13.splitlines())
                if mut13 == base13 and expect_lines:
                    print(f"  WRONG {rel}: case (13) anchored on nothing -- no numbered "
                          "bold items to drop")
                    short += 1
                elif expect_lines and lost != 7:
                    print(f"  WRONG {rel}: case (13) dropped {lost} line(s), expected the "
                          "7-step enumeration -- the predicate would be accidental")
                    short += 1
                io.open(tmp / rel, "w", encoding="utf-8",
                        newline="\n").write(mut13)
            if short:
                bad += 1
                continue
            out13 = io.StringIO()
            with contextlib.redirect_stdout(out13):
                rc13 = report(tmp)
            noted = [l for l in out13.getvalue().splitlines()
                     if "presents no checkable step enumeration" in l]
            labelled = [l for l in noted if "reported, not failed" in l]
            if len(noted) == expect_lines and len(labelled) == expect_lines and rc13 == 0:
                if expect_lines:
                    print(f"  CAUGHT  {MIRRORS[0]:20s} {desc} -- {len(noted)} notice "
                          f"line(s) on stdout, each labelled reported-not-failed, gate "
                          f"rc {rc13}")
                else:
                    print(f"  CLEAN   {MIRRORS[0]:20s} {desc} -- no notice line on "
                          "stdout, gate rc 0")
            else:
                print(f"  MISSED  {MIRRORS[0]:20s} {desc} -- {len(noted)} of "
                      f"{expect_lines} notice line(s) reached stdout, "
                      f"{len(labelled)} labelled, rc {rc13}; "
                      f"lines={[l.strip()[:56] for l in noted[:2]]}")
                bad += 1

    # (14) HOW THE ROOT IS CHOSEN. The default used to be Path(__file__).parent.parent,
    # which is the directory holding scripts/ -- right in a normal checkout and wrong in a
    # worktree, a copied script, or an installed one, where the walk then reads a tree that
    # is not the repo. git rev-parse --show-toplevel now decides, and the script-relative
    # path survives only as a named fallback. The fixture makes the two answers DIFFER, so
    # the case cannot pass by both paths happening to coincide.
    with tempfile.TemporaryDirectory() as td:
        nested = Path(td) / "repo" / "sub" / "scripts"
        nested.mkdir(parents=True)
        gitdir = Path(td) / "repo"
        init = subprocess.run(["git", "init", "-q", str(gitdir)],
                              capture_output=True, text=True)
        top = _git_toplevel(nested)
        # What the OLD constant would have answered for a script living here: one level up
        # from the script's own directory. Deliberately NOT the git toplevel, so the case
        # cannot pass by both answers coinciding.
        script_answer = nested.parent
        if init.returncode != 0 or top is None:
            print("  WRONG git resolution: cannot build a throwaway repo to test against -- "
                  "the case controls nothing")
            bad += 1
        else:
            via_git, how = resolve_root(nested)
            if via_git == Path(top) and "rev-parse" in how and via_git != script_answer:
                print(f"  CAUGHT  {MIRRORS[0]:20s} git toplevel wins over script-relative "
                      f"({script_answer.relative_to(gitdir)} != "
                      f"{via_git.relative_to(gitdir) if str(via_git).startswith(str(gitdir)) else via_git.name})")
            else:
                print(f"  MISSED  {MIRRORS[0]:20s} root did not come from git: {via_git} "
                      f"via {how}; script-relative would be {script_answer}")
                bad += 1

    # (15) A ZERO WALK CANNOT READ AS CLEAN. walk_counts names what it could not find, and
    # report prints the tally whenever the walk is not whole. Both sides: a root missing its
    # policed paths says so with numbers, an intact one stays silent so the pinned output
    # stays pinned.
    for desc, break_root, expect_line in (
        ("three policed paths deleted", True, True),
        ("intact fixture", False, False),
    ):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            if break_root:
                for rel in (HOOK_REL, MIRRORS[0], MIRRORS[1]):
                    (tmp / rel).unlink(missing_ok=True)
            wc15 = walk_counts(tmp)
            out15 = io.StringIO()
            with contextlib.redirect_stdout(out15):
                report(tmp)
            got = [l for l in out15.getvalue().splitlines() if "files walked" in l]
            counted = expect_line and wc15["missing"] and wc15["walked"] > 0
            if bool(got) == expect_line and (not expect_line or counted):
                if expect_line:
                    print(f"  CAUGHT  {MIRRORS[0]:20s} {desc} -- {len(wc15['missing'])} of "
                          f"{wc15['total']} policed paths named missing, {wc15['walked']} "
                          f"read, printed on stdout")
                else:
                    print(f"  CLEAN   {MIRRORS[0]:20s} {desc} -- no walk line, output "
                          "unchanged")
            else:
                print(f"  MISSED  {MIRRORS[0]:20s} {desc} -- walk line present={bool(got)} "
                      f"expected={expect_line}, missing={wc15['missing']}, "
                      f"walked={wc15['walked']}, lines={[l.strip()[:56] for l in got]}")
                bad += 1

    # (16) ASSERTION DIRECTION against a workflow with NO push trigger. The tree as it
    # stands has a push trigger in both live workflows, so no mirror-only mutation can make
    # "CI runs on push" false -- which is exactly why the old single-direction rule looked
    # covered while it graded one phrasing. Here the fixture workflow is stripped, so the
    # claim is false because that workflow says so, not because the parser said nothing.
    # Two guards keep this from reading as clean when it is dead: the strip must change the
    # PARSED set (a broken triggers_of would strip nothing and still "pass"), and the
    # finding must cite the line the plant was put on (an untouched mirror in a push-less
    # fixture also has false claims, so a needle alone would match vacuously).
    mirror16 = MIRRORS[0]
    devci_rel = ".github/workflows/dev-ci.yml"
    devci_base = read(src, devci_rel)
    devci_stripped = re.sub(r"(?m)^  push:[ \t]*\r?\n(?:    .*\r?\n)*", "", devci_base, count=1)
    if devci_stripped == devci_base:
        print(f"  WRONG {mirror16:20s} push trigger stripped from the fixture workflow -- "
              "no push: block to remove, so the case controls nothing")
        bad += 1
    elif "push" not in triggers_of(devci_base):
        print(f"  WRONG {mirror16:20s} fixture dev-ci.yml parses as {triggers_of(devci_base)} "
              "-- triggers_of() cannot see a push trigger that is on disk, so no assertion "
              "case can be graded")
        bad += 1
    elif "push" in triggers_of(devci_stripped):
        print(f"  WRONG {mirror16:20s} the strip left push in the parsed set "
              f"{triggers_of(devci_stripped)} -- the fixture controls nothing")
        bad += 1
    else:
        plant16 = ("Dev CI: a push to main therefore does run CI in dev-ci.yml.")
        base16 = read(src, mirror16).splitlines()
        mutated16 = "\n".join([base16[0], plant16] + base16[1:]) + "\n"
        if mutated16 == "\n".join(base16) + "\n":
            print(f"  WRONG {mirror16:20s} planting the assertion changed nothing")
            bad += 1
        else:
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                make_fixture(src, tmp)
                io.open(tmp / devci_rel, "w", encoding="utf-8", newline="\n").write(
                    devci_stripped)
                io.open(tmp / mirror16, "w", encoding="utf-8", newline="\n").write(mutated16)
                probs16 = scan(tmp)
                hit16 = [p for p in probs16
                         if p.startswith(f"{mirror16}:2 asserts a push trigger")]
                if hit16:
                    print(f"  CAUGHT  {mirror16:20s} assertion of a push trigger that the "
                          f"named fixture workflow does not declare (parsed "
                          f"{triggers_of(devci_stripped)} after the strip)")
                else:
                    print(f"  MISSED  {mirror16:20s} assertion on a push-less fixture "
                          f"workflow -- {[p[:70] for p in probs16[:3]]}")
                    bad += 1

    # (17) JOB TOTALS and MIRROR TARGETS -- rules (7) and (8). Cases for every claim
    # shape the audit found: the correct total passes, a wrong total fails, a live job
    # name passes, an attic/.bak target fails, a nonexistent workflow name fails, and a
    # nonexistent job name fails.
    #
    # Every case guards against passing vacuously, because the failure mode for a
    # plant-and-check case is a needle that matches nothing and a claim that was never
    # planted: the mutation must change the bytes, and the finding must be one the file
    # does not produce unmutated. The same discipline MUTATIONS uses.
    pj = live_job_totals(src)
    total = sum(len(v) for v in pj.values())
    prose_rel = "scripts/check.sh"  # carries both claim shapes
    base17 = read(src, prose_rel)
    wf_name = "dev-ci.yml"
    wf_total = len(pj.get(wf_name, []))
    if not base17 or not wf_total:
        print(f"  WRONG {prose_rel}: absent, or the fixture holds no dev-ci.yml jobs, so "
              "rules (7) and (8) cannot be exercised")
        bad += 1
    else:
        # The anchor for every target case is the LIVE `dev-ci.yml#website` claim on the
        # shell header at scripts/check.sh:343. It is a positive claim in a non-negated
        # sentence, so replacing it tests the rule; pointing at line 9 instead would test
        # the negation skip, which is a different rule and reads as a MISSED case.
        live_target = "`dev-ci.yml#website`"
        # The total-claim needle is DERIVED from the file, never hardcoded. It read
        # "eleven jobs" until 2026-09-24, when the split took the count to fourteen:
        # the hardcoded needle then matched nothing and BOTH total cases reported
        # "anchored on nothing" -- a fixture that had silently stopped exercising
        # rule (7) while still printing a verdict. Deriving the needle means the next
        # count change cannot rot it the same way.
        total_m = re.search(rf"{re.escape(wf_name)}'s\s+[A-Za-z0-9]+\s+jobs", base17)
        if total_m:
            total_needle = total_m.group(0)
            total_cases17 = [
                ("correct total passes",
                 total_needle, f"{wf_name}'s {wf_total} jobs",
                 False, None),
                ("wrong total fails",
                 total_needle, f"{wf_name}'s {wf_total + 1} jobs",
                 True, "claims"),
            ]
        else:
            print(f"  WRONG {prose_rel}: case (17) cannot anchor a total claim -- no "
                  f"\"{wf_name}'s <n> jobs\" in the file, so rule (7) is untested")
            bad += 1
            total_cases17 = []
        cases17 = total_cases17 + [
            # A PASS case still has to change bytes, or the vacuous-mutation guard
            # reports it WRONG -- and rightly: a mutation that replaces a needle with
            # itself proves nothing about the rule. This one retargets the claim at
            # another job that really is in dev-ci.yml, so the file is genuinely
            # different and still true.
            ("live job name passes",
             live_target, "`dev-ci.yml#static-gates`", False, None),
            # The audit's own example: the target is a RETIRED workflow. A "mirrors"
            # claim that names one is the defect, not a record of it, so this must FAIL.
            ("attic/.bak name fails",
             live_target, "`attic/ci.yml.bak#website`", True, "is retired"),
            ("nonexistent workflow name fails",
             live_target, "`legacy.yml#website`", True, "not a live workflow"),
            ("nonexistent job name fails",
             live_target, "`dev-ci.yml#no-such-job-name`", True, "no such job"),
        ]
        if live_target not in base17:
            print(f"  WRONG {prose_rel}: case (17) cannot anchor -- {live_target!r} is not "
                  "in the file, so every target case would be vacuous")
            bad += 1
            cases17 = []
        for desc, needle, repl, want_problem, needle_finding in cases17:
            mut = base17.replace(needle, repl, 1)
            if mut == base17:
                print(f"  WRONG {prose_rel}: case (17) '{desc}' anchored on nothing -- "
                      f"{needle!r} is not in the file")
                bad += 1
                continue
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                make_fixture(src, tmp)
                io.open(tmp / prose_rel, "w", encoding="utf-8",
                        newline="\n").write(mut)
                probs17 = scan(tmp)
                # The claim must be READ, not merely planted: a mutation the parser
                # never sees is a case that cannot fail, which reads exactly like a
                # rule that works.
                hit = [x for x in probs17 if prose_rel in x
                       and (needle_finding is None or needle_finding in x)]
                if want_problem:
                    if hit:
                        print(f"  CAUGHT  {prose_rel:20s} {desc} -- {hit[0][:76]}")
                    else:
                        print(f"  MISSED  {prose_rel:20s} {desc} -- {len(probs17)} "
                              f"finding(s), none matching; totals parsed "
                              f"{[c for _, c in job_total_claims(mut)]}, live {total}")
                        bad += 1
                elif hit:
                    print(f"  MISSED  {prose_rel:20s} {desc} -- a true claim was "
                          f"failed: {[x[:70] for x in hit]}")
                    bad += 1
                else:
                    print(f"  CLEAN   {prose_rel:20s} {desc} -- no finding")

        # The totals the SHIPPED files state must equal what the workflows hold, or the
        # corrections this rule exists to protect have silently reverted. Graded by
        # parsing those files, not by remembering a number.
        stated = {rel: [c for _, c in job_total_claims(read(src, rel))]
                  for rel in PROSE_FILES + JOB_PROSE_FILES}
        bad_total = {rel: cs for rel, cs in stated.items()
                     if any(c not in (total, wf_total) for c in cs)}
        if bad_total:
            print(f"  WRONG {prose_rel:20s} a shipped job total disagrees with the live "
                  f"workflows (total {total}, {wf_name} {wf_total}): {bad_total}")
            bad += 1
        else:
            print(f"  CAUGHT  {prose_rel:20s} every stated job total matches the live "
                  f"workflows (total {total}, {wf_name} {wf_total})")

    # (18) CLOSING THE FIVE EVASIONS a falsification pass reproduced. Each case is the
    # SMALLEST input that shows the rule fires, or -- for the retirement record -- that
    # it stays silent, and every one is graded through the real parsers rather than
    # through a needle planted in a document, because a parser that stopped reading a
    # shape is precisely what these five defects were.
    #
    # (18a) THE MIRROR-NEGATION FALSE POSITIVE. A file recording a retirement says its
    # local gate "mirrors no workflow" and that the retired workflow "was retired to
    # attic/ci.yml.bak". Adding such a file to the policed set once made the real run
    # fail on it, so both halves are asserted TOGETHER: the record must be silent.
    # The v1 negation pattern is asserted NOT to cover the line first, so the case
    # cannot pass by the old, narrow skip happening to cover the new input too.
    retirement = ("`.githooks/pre-push` mirrors no workflow: the `ci.yml` workflow was "
                  "retired to `.github/workflows/attic/ci.yml.bak`")
    neg_v2 = bool(MIRROR_NEGATION_RE.search(retirement)
                  or MIRROR_RETIRED_RE.search(retirement))
    neg_v1 = bool(re.search(r"\b(?:nothing|no\s+part|never|not)\b[^.;\n]{0,40}?"
                          r"\bmirrors?\b", retirement, re.I))
    if not neg_v2:
        print(f"  WRONG {MIRRORS[0]:20s} the retirement record is not recognised as one,"
              " so the false positive this rule was fixed for is back")
        bad += 1
    elif neg_v1:
        print(f"  WRONG {MIRRORS[0]:20s} the OLD skip already covered this line -- the"
              " probe does not demonstrate the widening")
        bad += 1
    else:
        # The probe file must be one rule (8) actually READS. tdd/SKILL.md was the first
        # choice and it was WRONG: rule (8) walks MIRRORS + PROSE_FILES + JOB_PROSE_FILES,
        # not the skills directory, so a probe planted there is never read and the case
        # would report a MISSED that says nothing about the rule. agent-lanes.md is in the
        # policed set, so the same bytes exercise the rule that was fixed.
        probe_rel = "docs/operations/agent-lanes.md"
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            make_fixture(src, tmp)
            io.open(tmp / probe_rel, "w", encoding="utf-8", newline="\n").write(
                "# probe\n\n" + retirement + "\n"
                "This gate mirrors .github/workflows/attic/ci.yml.bak\n")
            probs18 = scan(tmp)
            rec = [p for p in probs18
                   if probe_rel in p and "attic/ci.yml.bak" in p]
            other = [p for p in probs18
                     if probe_rel in p and "attic/ci.yml.bak" not in p]
            if not rec and other:
                print(f"  CAUGHT  {MIRRORS[0]:20s} the retirement record is left alone by"
                      " rule (8) while a present-tense claim on the same file is graded"
                      f" ({len(other)} finding(s) for the live claim)")
            else:
                print(f"  MISSED  {MIRRORS[0]:20s} record findings {len(rec)}, live-claim"
                      f" findings {len(other)} -- expected 0 and >0")
                bad += 1

    # (18b) A WORD NUMERAL THE TABLE COULD NOT REACH. thirteen..fifteen exist in
    # WORD_NUM and the pattern is BUILT from it, so the two cannot drift apart again.
    # All three properties are asserted, because fixing the table alone would leave the
    # pattern blind -- which is exactly how "thirteen jobs" produced zero claims.
    words18b = ("thirteen", "fourteen", "fifteen")
    parsed18b = [c for _, c in job_total_claims("dev-ci.yml's thirteen jobs")]
    if parsed18b == [13] and all(w in WORD_NUM for w in words18b) \
            and all(w in JOB_TOTAL_RES[0].pattern for w in words18b):
        print(f"  CAUGHT  {MIRRORS[0]:20s} a three-'teen word numeral parses to"
              f" {parsed18b[0]} and the pattern spells it (table and regex agree)")
    else:
        print(f"  MISSED  {MIRRORS[0]:20s} 'thirteen jobs' parsed to {parsed18b};"
              " WORD_NUM and JOB_TOTAL_RES would report different totals")
        bad += 1

    # (18c) THE SHAPES THAT EVADED. Each is a total the falsification pass typed and
    # got ZERO claims from. Value AND count are asserted: a shape that fired twice on
    # one sentence would be its own defect, and a shape that parsed the wrong number
    # a worse one.
    shapes18c = [
        ("| Jobs | 10 |", [10]),
        ("Job count: 10", [10]),
        ("jobs: 10", [10]),
        ("Jobs (10) - x", [10]),
        ("| Jobs (10) | x |", [10]),
    ]
    bad18c = [(s, [c for _, c in job_total_claims(s)]) for s, want in shapes18c
              if [c for _, c in job_total_claims(s)] != want]
    if not bad18c:
        print(f"  CAUGHT  {MIRRORS[0]:20s} table, plain-colon and parenthesised totals"
              f" all parse ({len(shapes18c)} shapes, one claim each)")
    else:
        print(f"  MISSED  {MIRRORS[0]:20s} these shapes still parse to no claim: {bad18c}")
        bad += 1

    # (18d) A WORD RESTATED AS A NUMERAL. "eleven (11) jobs" read as nothing at all;
    # it must now read as ELEVEN -- and a pair that DISAGREES must be REPORTED as a
    # contradiction rather than silently resolved toward whichever half survived.
    ok18d = [c for _, c in job_total_claims("dev-ci.yml's eleven (11) jobs")] == [11]
    contradicted = ([c for _, c in job_total_claims("dev-ci.yml's twelve (11) jobs")]
                    == [12]
                    and bool(contradictory_pairs("dev-ci.yml's twelve (11) jobs")))
    if ok18d and contradicted:
        print(f"  CAUGHT  {MIRRORS[0]:20s} 'eleven (11) jobs' parses to 11, and a"
              " self-contradicting pair is REPORTED rather than resolved silently")
    else:
        print(f"  MISSED  {MIRRORS[0]:20s} parenthesised numeral: agreement={ok18d},"
              f" contradiction reported={contradicted}")
        bad += 1

    # (18e) A BARE, UN-BACKTICKED JOB NAME. Rule (8) reached job ids only inside code
    # spans and the wf#job token, so "the local runner mirrors CI static-gates job in
    # dev-ci.yml" -- the same claim with no backticks -- was invisible. Scoped to a
    # NAMED workflow, where the candidate set is that workflow's own job ids and needs
    # no guess about what "reads like a job"; a real id and an invented one are both
    # asserted, because a rule that fires on neither is the state being fixed.
    wfs18e = live_workflows(src)
    pj18e = live_job_totals(src)
    bare_real = "the local runner mirrors CI static-gates job in dev-ci.yml"
    # The invented id must be SHAPED like one this repo uses (hyphenated) or the bare form
    # would not even try to read it, and a case that cannot fire proves nothing.
    bare_fake = "the local runner mirrors CI no-such-gate job in dev-ci.yml"
    fire18e = mirror_target_findings(bare_real, "scripts/check.sh", wfs18e, pj18e)
    fire18e_fake = mirror_target_findings(bare_fake, "scripts/check.sh", wfs18e, pj18e)
    silent_bare = [x for x in fire18e if "static-gates" in x and "no such job" in x]
    if not silent_bare and fire18e_fake:
        print(f"  CAUGHT  {MIRRORS[0]:20s} a bare job name is graded: the live id is"
              " silent, the invented one fails -- "
              + fire18e_fake[0][:64])
    else:
        print(f"  MISSED  {MIRRORS[0]:20s} bare job name: false finding on a live id="
              f"{silent_bare}, findings on an invented id={len(fire18e_fake)}")
        bad += 1

    print(f"\n  {'self-test: all mutations caught' if not bad else f'{bad} gap(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(report(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_ROOT))
