#!/usr/bin/env python3
r"""
scripts/verify-agents-mirrors.py — Keep the AGENTS.md mirrors telling the truth.

WHY THIS EXISTS
===============

There are two copies of the agent rules: root `AGENTS.md` and `.agents/AGENTS.md`.
A third, `.prime/AGENTS.md`, existed until 08-09-26 and was deleted with the `.prime/`
tree; the per-mirror mutation table it needed went with it. `.agents/AGENTS.md`
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
  6. TRIGGER CLAIM -- a mirror saying CI runs on push must match the workflows.

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

MIRRORS = ["AGENTS.md", ".agents/AGENTS.md"]

WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
            "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
            "twelve": 12}


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

# Sentences whose subject is the checker, a mirror, a finding or the rule are meta: they
# quote a phrasing instead of claiming the fact. Both mirrors' scope paragraphs run
# this way, and one of them is the paragraph that describes this very check.
CHECKER_PROSE_RE = re.compile(
    r"verify-agents-mirrors|says_push|any_push|\bmirrors?\b|\bchecker\b|\bfinding\w*\b"
    r"|\bunenforced\b|\brules?\b|\bprose\b|\bpolic(?:e|es|ing)\b|\bgates?\b", re.I)


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
        low = line.lower()
        if any(marker in low for marker in HISTORICAL_MARKERS):
            continue
        quoted = [(m.start(), m.end()) for m in QUOTED_PHRASE_RE.finditer(line)]

        def is_quoted(a: int, b: int) -> bool:
            return any(s <= a and b <= e for s, e in quoted)

        for off, sent in line_sentences(line):
            if not CI_SUBJECT_RE.search(sent) or CHECKER_PROSE_RE.search(sent):
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

def _retarget_ci_claim(text, replacement):
    """Rewrite the "All <N> steps now have a CI backstop" sentence, whatever N is.

    Hardcoding "eight" here broke all three mutations below the day the hook gained a ninth
    step: the anchor stopped matching, each replace() became a no-op, and the vacuous-mutation
    guard correctly reported WRONG. That guard is what makes this table trustworthy, so the
    fix is to stop anchoring on a value the mirrors are expected to change, not to re-pin it.
    """
    pat = re.compile(r"All ((?:eight|nine|ten|eleven|twelve|[a-z]+)) steps now have a CI backstop")
    if not pat.search(text):
        return text
    return pat.sub(lambda m: replacement.replace("{N}", m.group(1)), text, count=1)


MUTATIONS = [
    # Anchors here must be text that EXISTS in the current mirrors. The first
    # version of this entry pointed at "Steps 6 and 7 are local-only", which I
    # deleted when those steps got CI steps -- so the mutation changed nothing and
    # the vacuous-mutation guard reported WRONG rather than letting a no-op count
    # as a pass. That guard is the reason this table can be trusted at all.
    # Everything below now matches on a pattern rather than a literal count word, for
    # exactly that reason.
    ("false CI-coverage claim restored (negation phrasing)",
     lambda t: _retarget_ci_claim(
         t,
         "Steps 6 and 7 are local-only; there is no CI job for migration column "
         "types or PG schema drift. All {N} steps now have a CI backstop"),
     "no CI"),
    ("false local-only claim (participial phrasing)",
     lambda t: _retarget_ci_claim(
         t,
         "All {N} steps now have a CI backstop. The remaining gap is "
         "`verify-migration-column-types.py`, still guarded only by the opt-in "
         "local hook"),
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
    ("push trigger falsely denied",
     lambda t: t.replace("Two workflows are live",
                         "Dev CI has no push trigger in dev-ci.yml. "
                         "Two workflows are live", 1),
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
         lambda t: t.replace("**`Go gate`**", "**i18n lint**", 1), True),
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

    print(f"\n  {'self-test: all mutations caught' if not bad else f'{bad} gap(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(report(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_ROOT))
