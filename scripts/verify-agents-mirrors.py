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

import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")  # type: ignore[attr-defined]

DEFAULT_ROOT = Path(__file__).resolve().parent.parent

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
    """Event names in the `on:` block."""
    m = re.search(r"^(?:on|True):\s*$((?:^[ \t]+\S.*\n?)+)", text, re.M)
    if not m:
        m2 = re.search(r"^(?:on|True):\s*(\[[^\]]*\])", text, re.M)
        if m2:
            return re.findall(r"[\w_]+", m2.group(1))
        return []
    body = m.group(1)
    # Only the immediate children (4 or 2 spaces), not nested `on:` keys.
    return re.findall(r"^[ \t]{2,4}([a-z_]+):?", body, re.M)


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
         notices: list[str] | None = None) -> list[str]:
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
    all_ci_text = "\n".join(wfs.values())
    types = accepted_commit_types(root)

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

        # (6) trigger claims
        says_push = bool(re.search(r"(?:CI|dev-ci)[^\n]{0,80}\bruns on[^\n]{0,40}push",
                                   text, re.I))
        any_push = any("push" in triggers_of(t) for t in wfs.values())
        if says_push and not any_push:
            problems.append(
                f"{rel}: claims CI runs on push, but no live workflow has a push trigger")

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
    print(f"    commit types accepted     : {sorted(accepted_commit_types(root))}")
    print()
    # Notices are the diverging-ground-truth channel: printed, never counted. A lane
    # mid-edit on the hook must not put a permanent red across the repo -- this file
    # already documents why an un-actionable red is worse than no red (dev-ci's advisory
    # ci-docs-drift count is deliberately non-blocking for the same reason).
    notices: list[str] = []
    problems = scan(root, notices=notices)
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
    ("push trigger claimed",
     lambda t: t.replace("Two workflows are live",
                         "Dev CI runs on push to main. Two workflows are live", 1),
     "runs on push"),
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

    print(f"\n  {'self-test: all mutations caught' if not bad else f'{bad} gap(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(report(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_ROOT))
