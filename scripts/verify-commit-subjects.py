#!/usr/bin/env python3
r"""
scripts/verify-commit-subjects.py — Enforce the conventional-commit subject in CI.

WHY
===

`.githooks/commit-msg` enforces the subject format locally and says so itself:

  LIMITATION, same as every other hook in this directory: core.hooksPath is set by
  scripts/setup-dev.ps1 and is NOT versioned, so a fresh clone that skips setup
  gets no commit-msg gate. A CI-side check over origin/main..HEAD would close
  that; it is not done here because dev-ci.yml currently has no job that fits, and
  adding one is a separate decision.

It is that decision, taken here. `static-gates` is the job that fits: it exists to
hold checks that had no other home.

The gap is not hypothetical. The hook's own header lists four commits on the
0.0.35/0.0.36 range whose entire message is a pasted `git status --porcelain`
block (2eea3d07, faa5dae0, 5855c429, 84a71f3e). Those were authored on this
machine, which means the hook was either not installed or bypassed -- and nothing
downstream noticed, because nothing downstream looked.

THE RULE IS EXTRACTED, NOT COPIED
=================================

The type list and the regex live in the hook (`TYPES=...`, `PATTERN=...`) and are
read from it at run time. A duplicated list here would drift the moment someone
added a type to one file and not the other, and the drift would be silent in the
worst direction: CI rejecting subjects the local hook accepts, or -- worse -- CI
accepting subjects the hook rejects, which is a gate that reports success while
enforcing nothing.

The exemption list (Merge/Revert/fixup!/squash!/amend!, and an empty subject) is
extracted from the same `case` block for the same reason.

Usage:
    python3 scripts/verify-commit-subjects.py --range origin/main..HEAD
    python3 scripts/verify-commit-subjects.py --base <sha> [--head <sha>]
    python3 scripts/verify-commit-subjects.py --self-test

Exits: 0 read and conforming, 1 read and non-conforming (a verdict), 2 nothing was
graded -- a bad argument, or a git read that could not produce the corpus. The corpus
is what this gate reads, so a failed read is refused rather than reported as a range
holding no commits; see `git()`.
"""

from __future__ import annotations

import argparse
import io
import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")  # type: ignore[attr-defined]

ROOT = Path(__file__).resolve().parent.parent
HOOK = ".githooks/commit-msg"


class GitUnreadable(Exception):
    """A git read this gate depends on failed -- not a verdict about any commit.

    Raised where the argument resolves, before the walk: whether git could produce a
    corpus at all is a property of the read, not of the review, so it is refused there
    rather than discovered downstream as a count of zero.
    """


def git(*args: str, root=None) -> str | None:
    """The stdout of a git command run in ROOT (or `root`, the r173 parameter
    that redirects every read at a fixture), or None when git could not produce it.

    None is a REFUSAL condition, not an empty string. `git log` writes its complaint to
    stderr and NOTHING to stdout when a revision is unknown or the checkout is not a
    repository, so returning `.stdout` alone -- the shape this helper had, with no
    `check=` and `returncode` never read -- made "the corpus could not be read" and
    "this range holds no commits" byte-identical to `check_range`, which then printed
    `0 commit(s) checked, 0 non-conforming subject(s)` on stdout and raised its own
    empty-range message at exit 1 -- the exit this file reserves for a verdict that WAS
    reached over a corpus it did read. Same law as
    scripts/verify-migration-column-types.py:204-222 and the `staged_diff()` fix in
    scripts/verify-ftl-orphans.py.
    """
    root_path = ROOT if root is None else Path(root).resolve()
    cmd = ["git", *args]
    try:
        proc = subprocess.run(cmd, cwd=str(root_path), capture_output=True,
                              text=True, encoding="utf-8", errors="replace",
                              check=True)
    except Exception as exc:  # no git on PATH, no repository at ROOT, or a non-zero exit
        # The words below are git's own, quoted from its stderr -- a complaint about the
        # command or the checkout, not this gate's verdict on anyone's subject.
        print(f"error: cannot read the commit corpus (`{' '.join(cmd)}` in {root_path}): {exc}",
              file=sys.stderr)
        raw = getattr(exc, "stderr", "") or ""
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        for line in str(raw).splitlines()[:3]:
            print(f"  git: {line}", file=sys.stderr)
        return None
    return proc.stdout


# ── Read the rule out of the hook ───────────────────────────────────────────

def hook_types(hook_text: str) -> list[str]:
    m = re.search(r"^TYPES='([a-z|]+)'", hook_text, re.M)
    if not m:
        raise SystemExit(
            f"{HOOK}: no `TYPES='feat|fix|...'` line found. Refusing to fall back "
            f"to a built-in list: a checker that silently substitutes its own rule "
            f"is the drift this design exists to prevent.")
    return [t for t in m.group(1).split("|") if t]


def hook_pattern(hook_text: str) -> str:
    m = re.search(r'^PATTERN="(.+)"', hook_text, re.M)
    if not m:
        raise SystemExit(f"{HOOK}: no `PATTERN=` line found")
    # The hook interpolates $TYPES into the string; expand it the same way.
    return m.group(1).replace("$TYPES", "|".join(hook_types(hook_text)))


def hook_exemptions(hook_text: str) -> list[str]:
    """Glob prefixes the hook always accepts, from its own `case` block.

    The block is:
        case "$SUBJECT" in
            "Merge "*|"Revert "*|"fixup!"*|"squash!"*|"amend!"*)
                exit 0
                ;;
        esac
    so the patterns are the quoted strings on the line that ends in `)`. The
    first attempt here was one regex spanning to `esac`; it matched nothing,
    returned [], and the caller then ran the whole check with NO exemptions --
    which would have failed CI on every merge commit. An extractor that returns
    empty is only safe if someone notices, so this now raises instead.
    """
    m = re.search(r'case\s+"\$SUBJECT"\s+in\s*\n([^\n]*)', hook_text)
    if not m:
        raise SystemExit(
            f'{HOOK}: no `case "$SUBJECT" in` block found. Refusing to run with '
            f"an empty exemption list -- that would reject every merge and "
            f"revert commit.")
    # The glob `*` sits OUTSIDE the closing quote -- `"Merge "*` -- so capturing
    # only the quoted text yields 'Merge ' with no marker, and a matcher that
    # tests `pat.endswith('*')` then falls through to exact equality and rejects
    # every merge commit. Capture the optional star with its pattern.
    pats = [q + (s or "") for q, s in re.findall(r'"([^"]+)"(\*?)', m.group(1))]
    if not pats:
        raise SystemExit(
            f"{HOOK}: the `case` block yielded no quoted exemption patterns; "
            f"line was {m.group(1)!r}")
    return pats


def matches_exemption(subject: str, patterns: list[str]) -> bool:
    for pat in patterns:
        # Shell glob: trailing `*` means prefix match.
        if pat.endswith("*") and subject.startswith(pat[:-1]):
            return True
        if not pat.endswith("*") and subject == pat:
            return True
    return False


# ── The check ───────────────────────────────────────────────────────────────

def hook_intro(root=None) -> str | None:
    """The commit that added .githooks/commit-msg, used as the floor.

    Deriving this rather than hardcoding a sha means the exemption set never
    changes by accident: the rule cannot be enforced before it existed, and the
    moment the introducing commit is not in range there is nothing to grandfather.
    If someone rewrites history so the hook's arrival is older, the floor moves
    with it, which is the correct answer -- the floor is a fact about the rule's
    age, not a list of excuses.
    """
    out = git("log", "--diff-filter=A", "--format=%H", "--", HOOK, root=root)
    if out is None:
        # Distinct from a successful read that named nothing: that reaches the
        # `return sha or None` below as None, meaning "the hook's arrival is not in this
        # history", so there is nothing to grandfather -- a correct answer. A failed read
        # has no answer at all, and silently dropping the floor would grade pre-rule
        # commits the rule cannot reach, then call the result clean.
        raise GitUnreadable(f"the grandfathering floor (`git log --diff-filter=A -- {HOOK}`)")
    sha = out.split("\n")[0].strip()
    return sha or None


def check_range(rng: str, floor: str | None = "auto", root=None) -> tuple[int, int, list[str], list[str]]:
    root_path = ROOT if root is None else Path(root).resolve()
    hook_text = io.open(root_path / HOOK, encoding="utf-8", errors="replace").read()
    pattern = re.compile(hook_pattern(hook_text))
    exemptions = hook_exemptions(hook_text)

    if floor == "auto":
        floor = hook_intro(root=root)

    # `rng` may be `a..b` or `^a b`; simplest correct thing is to intersect the
    # requested range with "descendants of the floor" by walking the range and
    # skipping anything that is not a descendant of the floor commit.
    skip_before = None
    if floor:
        listing = git("rev-list", floor, root=root)
        if listing is None:
            raise GitUnreadable(f"the pre-rule commit set (`git rev-list {floor}`)")
        skip_before = {l.strip() for l in listing.splitlines() if l.strip()}

    out = git("log", "--format=%H%x00%s", rng, root=root)
    if out is None:
        raise GitUnreadable(f"the commit corpus in the range `{rng}`")
    total = bad = grandfathered = 0
    offenders: list[str] = []
    for line in out.splitlines():
        if "\x00" not in line:
            continue
        sha, subject = line.split("\x00", 1)
        if skip_before and sha in skip_before:
            grandfathered += 1
            continue
        total += 1
        if matches_exemption(subject, exemptions):
            continue
        if not subject.strip():
            continue          # the hook lets an empty subject through on purpose
        if not pattern.match(subject):
            bad += 1
            offenders.append((sha[:8], subject))

    detail = (f" ({grandfathered} pre-rule commit(s) skipped)"
              if grandfathered else "")
    print(f"  {total} commit(s) checked{detail}, {bad} non-conforming subject(s)")
    # An empty range is not a pass, it is a gate that checked nothing. Found by
    # accident: a fixture repo where `main` WAS HEAD made `main..HEAD` empty, the
    # script exited 0, and every downstream assertion read as a detector failure
    # rather than a fixture bug. In CI the same shape appears if a checkout is
    # shallow (fetch-depth 1 makes base..HEAD empty) or if the event payload lacks
    # the shas -- all of which would report green forever.
    if total == 0:
        raise SystemExit(
            f"range {rng} resolved to 0 commits. Refusing to report success: a "
            f"subject gate that inspects nothing passes no matter what is pushed. "
            f"Check that the checkout has enough history (fetch-depth: 0) and that "
            f"both ends of the range exist.")
    return total, bad, [f"{s}: {t!r}" for s, t in offenders], exemptions


def main(argv: list[str] | None = None, root: str | Path | None = None) -> int:
    """r173: argv and root parameterized, the r166..r172 contract -- root
    redirects BOTH the hook read and every git read, so a fixture cannot
    half-run against the real repository's history."""
    root_path = ROOT if root is None else Path(root).resolve()
    ap = argparse.ArgumentParser()
    ap.add_argument("--range", dest="rng", help="git revision range, e.g. origin/main..HEAD")
    ap.add_argument("--base", help="compute <base>..<head>")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)

    if a.self_test:
        return self_test()

    rng = a.rng or (f"{a.base}..{a.head}" if a.base else None)
    if not rng:
        print("  need --range <a..b> or --base <sha>", file=sys.stderr)
        return 2

    hook_text = io.open(root_path / HOOK, encoding="utf-8", errors="replace").read()
    types = hook_types(hook_text)
    # Three exits, and only two of them are verdicts: 0 when the range was read and every
    # subject in it conformed, 1 when it was read and did not, 2 when it could not be read
    # at all. A refusal borrows no verdict's exit code -- exit 1 here is what a real
    # non-conforming subject prints, and an unreadable corpus has reached no conclusion
    # about anyone's commit message. Same split the sibling gates established.
    try:
        total, bad, offenders, _ex = check_range(rng, root=root_path)
    except GitUnreadable as exc:
        print(f"verify-commit-subjects: REFUSED -- git could not read {exc}, so the corpus "
              f"is unknown, and an unknown corpus is not an empty one. Nothing was graded "
              f"here; git's own words, on stderr, name the command that failed.",
              file=sys.stderr)
        return 2
    print(f"  rule extracted from {HOOK}: {len(types)} types ({', '.join(types)})")
    print(f"  range {rng}: {total} commit(s), {bad} non-conforming subject(s)")
    if offenders:
        print("\n  Non-conforming:")
        for o in offenders[:40]:
            print(f"    - {o[:120]}")
        if len(offenders) > 40:
            print(f"    ... and {len(offenders) - 40} more")
        print("\n  Required: <type>(<area>): <description>  "
              f"(type in: {' '.join(types)})")
        return 1
    return 0


# ── Self-test ───────────────────────────────────────────────────────────────

def self_test() -> int:
    """Prove the extractor and the matcher, without needing a git range.

    The interesting failure is not "a bad subject was missed" but "the rule read
    from the hook was wrong", so the assertions are about the extracted rule
    itself: its type list, its exemptions, and that a subject the hook would
    reject is rejected here too.
    """
    hook_text = io.open(ROOT / HOOK, encoding="utf-8", errors="replace").read()
    bad: list[str] = []   # was int -- the plumbing branches below append(), an
                          # AttributeError that would replace the first real
                          # plumbing failure's report with a traceback

    def want(cond: bool, desc: str) -> None:
        nonlocal bad
        print(f"  {'ok   ' if cond else 'FAIL '} {desc}")
        if not cond:
            bad.append(desc)

    types = hook_types(hook_text)
    want(len(types) >= 8, f"type list extracted ({len(types)}: {', '.join(types)})")
    want("style" in types, "`style` is in the extracted list (added in 0.0.36)")

    pat = re.compile(hook_pattern(hook_text))
    want("$TYPES" not in hook_pattern(hook_text), "$TYPES expanded, not left literal")

    ex = hook_exemptions(hook_text)
    want(len(ex) >= 4, f"exemption prefixes extracted ({len(ex)}: {ex})")

    good = ["fix(sales): resolve modal overflow",
            "docs: correct the gate count",
            "ci(agents)!: drop a retired gate"]
    for s in good:
        want(bool(pat.match(s)), f"accepts {s!r}")

    # The four real offenders named in the hook header, verbatim in shape.
    bad_subjects = ["deleted:    lighthouse-report.json",
                    "modified: .gitignore",
                    "updated gitignore",
                    "new file:   docs/x.md",
                    "WIP", "fix stuff", "Feat(SALES): Bad Case", "fix:no space"]
    for s in bad_subjects:
        want(not pat.match(s), f"rejects {s!r}")

    for s in ["Merge branch 'main' into x", "Revert \"feat(a): b\"",
              "fixup! feat(a): b", "squash! docs: x", "amend! ci: y"]:
        want(matches_exemption(s, ex), f"exempts {s!r}")

    # A type NOT in the list must be rejected -- catches a pattern that lost its
    # alternation anchor and matches any leading word.
    want(not pat.match("nope(scope): hello"), "rejects an unknown type")
    # And the pattern must be anchored at the start.
    want(not pat.match("please fix(x): y"), "pattern is anchored at the start")

    # The git plumbing -- the corpus comes out of it, and its docstring records why
    # None (refusal) must stay distinct from '' (empty). Graded against a throwaway
    # repo; ROOT is rebound through globals() for the duration (self_test reads ROOT
    # earlier, so a global statement here would not compile) and restored in finally.
    import shutil as _shutil
    import tempfile
    extra = 0
    if _shutil.which("git"):
        with tempfile.TemporaryDirectory() as td:
            g = Path(td)
            subprocess.run(["git", "init", "-q"], cwd=g, capture_output=True)
            _saved_root = globals()["ROOT"]
            try:
                globals()["ROOT"] = g
                extra += 1
                top = (git("rev-parse", "--show-toplevel") or "").strip()
                if Path(top).resolve() != g.resolve():
                    bad.append(f"git rev-parse: expected the throwaway repo, got {top!r}")
                extra += 1
                if git("log", "-1", "HEAD") is not None:
                    bad.append("git log in a commit-less repo must refuse with None")
                extra += 1
                if git("status", "--porcelain") != "":
                    bad.append("an empty-but-successful command must return '', not None")
            finally:
                globals()["ROOT"] = _saved_root
    else:
        print("  (git unavailable: the plumbing cases are skipped)")

    # r173: main()'s shell -- argv and root graded against a throwaway git
    # repo whose commit 0 introduces the hook (the grandfathering floor) and
    # whose later commits are the corpus. The rule itself is the REAL hook,
    # copied in, so the extracted pattern is the one CI enforces.
    import contextlib as _ctxlib
    import io as _io
    if _shutil.which("git"):
        def _mkrepo(subjects):
            g = Path(tempfile.mkdtemp())
            subprocess.run(["git", "init", "-q"], cwd=g, capture_output=True)
            subprocess.run(["git", "config", "user.email", "t@example.test"],
                           cwd=g, capture_output=True)
            subprocess.run(["git", "config", "user.name", "T"],
                           cwd=g, capture_output=True)
            (g / ".githooks").mkdir()
            (g / ".githooks" / "commit-msg").write_text(
                io.open(ROOT / HOOK, encoding="utf-8").read(), encoding="utf-8")
            def _c(msg):
                subprocess.run(["git", "add", "-A"], cwd=g, capture_output=True)
                subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", msg],
                               cwd=g, capture_output=True)
            _c("chore(hooks): add the commit-msg gate")
            floor = subprocess.run(["git", "rev-parse", "HEAD"], cwd=g,
                                   capture_output=True, text=True).stdout.strip()
            for msg in subjects:
                _c(msg)
            head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=g,
                                  capture_output=True, text=True).stdout.strip()
            return g, floor, head
        def _shell(subjects, extra_argv=None, empty_range=False):
            g, floor, head = _mkrepo(subjects)
            rng = f"{floor}..{floor}" if empty_range else f"{floor}..{head}"
            argv = list(extra_argv or []) + ["--range", rng]
            out, err = _io.StringIO(), _io.StringIO()
            rc = None
            raised = None
            with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
                try:
                    rc = main(argv=argv, root=g)
                except SystemExit as exc:
                    raised = exc
            return rc, raised, out.getvalue() + err.getvalue()
        rc, raised, text = _shell(["feat(x): a good subject", "docs: another good one"])
        if rc != 0 or "2 commit(s) checked" not in text or "0 non-conforming subject(s)" not in text:
            bad.append(f"an all-conforming range must exit 0 (rc={rc} text={text[-120:]!r})")
        rc, raised, text = _shell(["feat(x): a good subject", "bad subject here"])
        if rc != 1 or "1 non-conforming subject(s)" not in text or "bad subject here" not in text:
            bad.append(f"a non-conforming subject must exit 1 naming it (rc={rc} text={text[-140:]!r})")
        g, floor, _head = _mkrepo(["feat(x): fine"])
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            rc = main(argv=["--range", f"{floor}..does-not-exist"], root=g)
        if rc != 2 or "REFUSED" not in (out.getvalue() + err.getvalue()):
            bad.append(f"an unreadable corpus must REFUSE with exit 2 (rc={rc} text={(out.getvalue()+err.getvalue())[-140:]!r})")
        out, err = _io.StringIO(), _io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            rc = main(argv=[], root=g)
        if rc != 2 or "need --range" not in (out.getvalue() + err.getvalue()):
            bad.append(f"no range argument must exit 2 (rc={rc})")
        rc, raised, text = _shell(["feat(x): fine"], empty_range=True)
        if raised is None or "resolved to 0 commits" not in str(raised):
            bad.append(f"an empty range must refuse, not pass (raised={raised!r} rc={rc})")
        rc, raised, text = _shell(["Merge branch 'main' into x", "feat(y): fine"])
        if rc != 0 or "2 commit(s) checked, 0 non-conforming" not in text:
            bad.append(f"a merge commit must be exempt yet counted (rc={rc} text={text[-120:]!r})")

    print(f"\n  {'self-test: rule extraction, matching, plumbing and shell all correct' if not bad else str(len(bad)) + ' failure(s): ' + '; '.join(bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
