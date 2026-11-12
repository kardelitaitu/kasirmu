#!/usr/bin/env python3
r"""
scripts/verify-doc-uniqueness.py — Catch duplicate documents that both claim to
be authoritative.

WHY
===

`f3d9cca6` ("tidy up project root files into docs, dev, and scripts") moved the
repo-root `subscription-tiers.md` to `docs/records/` without noticing that
`28147fe4` had already created `docs/guides/subscription-tiers.md` two weeks
earlier. Result: two tracked files, same basename, **both stamped "Status: FINAL —
Single source of truth for tier pricing, quotas, and feature gates"**, whose
entitlement tables disagree:

    audit:view row          guides: present   records: absent
    White-label branding    guides: Pro+Ent   records: Enterprise only

Nothing in CI notices. `verify-ci-docs-drift.py` compares the CI manifest against
workflows and runners; it has no idea what a pricing document says. So the repo
can carry two contradictory answers to "what does a Pro customer get", and the one
an engineer follows depends on which file they open first. For a document whose
subject is what customers are promised, that is a business defect wearing a
file-management costume.

A reorg is a high-risk operation precisely because it looks mechanical: moving a
file into a directory that already has a same-named file is the one thing a
`git mv` does not warn about when the collision is created by the DESTINATION
already having a copy.

WHAT IT CHECKS
==============

  1. DUPLICATE BASENAME — two tracked files sharing a basename, where at least
     one is a document (.md). Reports both paths and how different they are.
  2. CONFLICTING AUTHORITY — those duplicates both contain an exclusivity claim
     ("single source of truth", "authoritative", "canonical", "supersedes") in
     their first 40 lines. Two files claiming to be THE source is the actual bug;
     a duplicate where one says "archive copy" is fine.
  3. IDENTICAL DUPLICATES — byte-identical same-basename files, which is pure
     drift with no content risk but still two places to update.

Exclusivity claims are matched case-insensitively and the check is line-limited,
because a document that merely mentions the phrase deep in a changelog section is
not claiming authority over the repo.

Usage:
    python3 scripts/verify-doc-uniqueness.py
    python3 scripts/verify-doc-uniqueness.py --self-test
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001  # pragma: no cover
    pass

ROOT = Path(__file__).resolve().parent.parent

#: Where fixture trees are written when the host sets a temp variable (a confined
#: host denies its default temp); unset leaves tempfile's own default in force.
#: NEVER point these at a directory inside the checkout. This checker shells out
#: to `git ls-files` with the root as its cwd, so a temp root under the repo would
#: make a fixture's ls-files answer about a SUBDIRECTORY of this repository --
#: 0 entries at exit 0 instead of the exit-128 refusal a real non-repo gives --
#: and every no-git rung below would grade nothing while still passing.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures go under (None = system default), created."""
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root

AUTHORITY = re.compile(
    r"single source of truth|the authoritative|canonical source|"
    r"source of truth|supersedes",
    re.I,
)
DOC_SUFFIXES = {".md", ".rst", ".txt"}
HEAD_LINES = 40

# A non-authoritative copy that SAYS so is not a defect -- it is a labelled
# archive. Matched anywhere in the file, since the disclaimer is often a
# one-line note under the heading rather than a status block.
DISCLAIMER = re.compile(
    r"archiv|historical|snapshot|not maintained|superseded by|out of date|"
    r"no longer (?:maintained|updated)|read-?only copy",
    re.I,
)

# Scope. The defect being caught is a duplicate inside the DOCUMENTATION tree,
# where one file is meant to be the answer. Same-basename files elsewhere are
# normal and unrelated.
SCOPE_PREFIXES = ("docs/",)

# Names that legitimately repeat. Without this the first run flagged README.md
# (every crate has one), SKILL.md (every skill has one) and AGENTS.md (three
# deliberate mirrors) as "duplicates" -- 4 findings, all noise, against 1 real.
# A gate that cries wolf gets ignored, which is the failure mode this whole
# release cycle has been cleaning up after.
CONVENTIONAL = {
    "README.md", "SKILL.md", "AGENTS.md", "CHANGELOG.md", "LICENSE",
    "LICENSE.md", "CONTRIBUTING.md", "index.md", "SUMMARY.md", "TODO.md",
    "NOTICE", "RELEASE-NOTES.md",
}


# Known, explicitly-accepted findings, so the gate can be live without reddening
# `check.sh` on a defect that is not yet resolvable.
#
# This is a BASELINE, not a skip list: it names the exact pair and the reason, and
# any NEW duplicate fails. The temptation when adding a gate is to whitelist
# whatever it currently reports and move on -- which is precisely how
# "77 pre-existing drift items" became an unread alarm. So each entry must carry
# why it cannot be fixed now and what would resolve it.
#
# R36-14's entry was deleted 2026-09-07 when the product ruling resolved the
# pair (docs/guides/ is the single authority; audit Premium+Enterprise,
# white-label Enterprise-only) and the losing copy was removed. The gate is
# live with an empty baseline.
BASELINE: dict[tuple[str, ...], str] = {}


def scan_base(root=None) -> Path:
    """The tree this run grades: the checkout, or the fixture main() was handed.

    Every path the scan reads AND every path it reports is derived from here.
    `root` is threaded from main() through scan() into tracked_files() and
    head_claims(); nothing is recorded in a module global, because a ladder on
    a fixture would then read the real checkout back through that global and
    grade 55 screens of the wrong tree.

    The resolved base is one greppable line so scripts/prove-ladder-kills.py can
    mutate it: smuggle it through a call and the harness reports NO APPLICABLE
    MUTATION instead of a kill.
    """
    base = ROOT if root is None else Path(root).resolve()  # MUTANT-PROOF SEAM
    return base


def tracked_files(root=None) -> list[str]:
    # r182: the file list is an evidence source like any other -- root
    # redirects it, so a fixture repo's ls-files cannot silently become the
    # real repository's (the r172 half-redirect class). The base comes from
    # scan_base() so ONE resolved root serves the list and the reads.
    base = scan_base(root)
    out = subprocess.run(["git", "ls-files"], cwd=str(base),
                         shell=(sys.platform == "win32"),
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"git ls-files failed: {out.stderr[:200]}")
    return [f for f in out.stdout.splitlines() if f.strip()]


HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)


def strip_comments(text: str) -> str:
    """Remove HTML comments from a document head before claim matching.

    An audit stamp is provenance, not a claim of authority. Every stamped doc in
    this tree opens with a long `<!-- Audit stamp: ... -->` block that routinely
    contains the word "supersedes" while DESCRIBING an earlier stamp it replaced
    ("supersedes the same-day STALE-BY-INFRA-CHANGE stamp"). Matching that as an
    exclusivity claim made the gate report two UNRELATED same-named documents as
    competing authorities: docs/releases/checklist.md (the release pipeline) was
    flagged against docs/legal/id/checklist.md (the Indonesian registration
    checklist), and the gate's remedy asked for the legal file to be marked
    historical -- which would have been a false statement about a document that
    is current and has nothing to do with releases.

    Stripping comments first is what the check already means by "the first 40
    lines": it is looking for the document's own voice, and an audit stamp is
    somebody else's.
    """
    return HTML_COMMENT.sub(" ", text)


def head_claims(path: Path, root=None) -> bool:
    """True if the file's opening lines claim exclusivity.

    `root` is threaded only so the read resolves against the same base the scan
    listed; a fixture's paths are relative, so an unthreaded root would open
    them against the PROCESS cwd instead of the tree being graded.
    """
    try:
        opening = path if path.is_absolute() else scan_base(root) / path
        with io.open(opening, encoding="utf-8", errors="replace") as fh:
            head = "".join(fh.readline() for _ in range(HEAD_LINES))
    except OSError:
        return False
    return bool(AUTHORITY.search(strip_comments(head)))


def scan(root=None) -> list[str]:
    # Resolved ONCE, at the top of the body: the tracked-file list and every
    # document read below go through this root, never through ROOT.
    root = scan_base(root)
    problems: list[str] = []
    baselined: list[str] = []
    by_name: dict[str, list[str]] = defaultdict(list)
    for f in tracked_files(root):
        # Test the RAW path from `git ls-files`, which is always forward-slash.
        # `str(Path(f))` rewrites it to backslashes on Windows, so
        # startswith("docs/") silently returned False for every file and the
        # whole gate passed on a repo with a known live defect -- the exact
        # shape of bug this script exists to catch, reproduced in the catcher.
        if not f.startswith(SCOPE_PREFIXES):
            continue
        p = Path(f)
        if p.name in CONVENTIONAL:
            continue
        if p.suffix.lower() in DOC_SUFFIXES:
            by_name[p.name].append(f)

    for name, paths in sorted(by_name.items()):
        if len(paths) < 2:
            continue
        abs_paths = [root / p for p in paths]
        try:
            blobs = {p.read_bytes() for p in abs_paths}
        except OSError as e:
            problems.append(f"{name}: unreadable duplicate ({e})")
            continue

        identical = len(blobs) == 1
        claiming = [p for p, a in zip(paths, abs_paths) if head_claims(a, root)]

        # An archive copy is a deliberate duplicate: the archive holds the
        # previous version of a live document, so exactly one copy claiming
        # authority is the POINT. Exempt that pairing -- but only that one. If
        # two ARCHIVED copies both claim authority, or an archive and a live
        # doc both do, that is still the bug being hunted.
        #
        # Widened 2026-10-02. `docs/archived/` was retired and became a
        # one-file tombstone; its contents now live in docs/records/superseded/
        # and docs/records/audits/. Those are the SAME class -- superseded copies
        # of live documents -- and without this they read as live, which would
        # stop the exemption below from ever firing and leave the genuine
        # archive-vs-live case indistinguishable from two live docs.
        #
        # Widening the set does NOT hide the conflict it is paired with: the
        # second branch still flags archive-and-live both claiming authority.
        ARCHIVE_PREFIXES = ("docs/archived/", "docs/records/superseded/",
                            "docs/records/audits/")
        archived = [p for p in paths if p.startswith(ARCHIVE_PREFIXES)]
        live = [p for p in paths if p not in archived]
        if len(archived) >= 1 and len(claiming) <= 1 and not identical:
            continue
        if len(archived) >= 1 and len(live) >= 1 and len(claiming) >= 2:
            problems.append(
                f"CONFLICTING AUTHORITY: {name} at {claiming} -- an archived copy "
                f"and a live copy both claim to be THE source of truth. Mark the "
                f"archive copy as historical in its first lines.")
            continue

        if identical:
            problems.append(
                f"DUPLICATE (identical): {name} exists at {paths} -- "
                f"byte-identical, so one is redundant and both need updating")
            continue

        if len(claiming) >= 2:
            deltas = []
            lines = [a.read_text(encoding="utf-8", errors="replace").splitlines()
                     for a in abs_paths]
            if len(lines) == 2:
                only_a = set(lines[0]) - set(lines[1])
                only_b = set(lines[1]) - set(lines[0])
                deltas = [len(only_a), len(only_b)]
            detail = (f" ({deltas[0]} line(s) unique to the first, "
                      f"{deltas[1]} to the second)") if deltas else ""
            msg = (
                f"CONFLICTING AUTHORITY: {name} at {claiming} -- both claim to be "
                f"THE source of truth but their content differs{detail}. One must "
                f"be marked superseded or deleted; two contradictory answers to a "
                f"customer-facing question is a business defect.")
            key = (name, *sorted(claiming))
            why = BASELINE.get(key) or BASELINE.get(tuple(sorted(key)))
            if why:
                baselined.append(f"{name}: {why[:80]}...")
            else:
                problems.append(msg)
        elif len(claiming) == 1:
            # One copy claims authority, the other does not. That is FINE if the
            # non-claiming copy says so out loud -- "archived snapshot", "not
            # maintained". Only flag it when the second copy is silent about its
            # status, because then a reader cannot tell which is which.
            others = [p for p in paths if p not in claiming]
            disclaiming = [p for p in others
                           if DISCLAIMER.search((root / p).read_text(
                               encoding="utf-8", errors="replace"))]
            if len(disclaiming) == len(others) and others:
                continue
            problems.append(
                f"DUPLICATE (one authoritative): {name} at {paths}; only "
                f"{claiming[0]} claims authority"
                + (f", and {sorted(set(others) - set(disclaiming))} says nothing "
                   f"about being superseded" if others != disclaiming else "")
                + ". Mark the non-authoritative copy as historical in its first "
                  "lines so a reader can tell them apart.")
    scan.baselined = baselined  # type: ignore[attr-defined]
    return problems


def self_test() -> int:
    """Prove the detector fires, using a throwaway git index."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        subprocess.run(["git", "init", "-q"], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)
        (tmp / "docs" / "guides").mkdir(parents=True)
        (tmp / "docs" / "records").mkdir(parents=True)
        io.open(tmp / "docs" / "guides" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers\n\n> Status: FINAL. Single source of truth for pricing.\n"
            "| white-label | yes | yes |\n")
        io.open(tmp / "docs" / "records" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers\n\n> Status: FINAL. Single source of truth for pricing.\n"
            "| white-label | no | yes |\n")
        subprocess.run(["git", "add", "."], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)

        found = scan(tmp)

        hits = [p for p in found if p.startswith("CONFLICTING AUTHORITY")]
        if not hits:
            print("  MISSED! two files both claiming single-source-of-truth "
                  "were not detected")
            return 1
        print(f"  CAUGHT  conflicting-authority duplicate ({len(hits)} finding(s))")
        print(f"          {hits[0][:100]}")

        # And confirm it does NOT fire when one copy disclaims authority.
        io.open(tmp / "docs" / "records" / "tiers.md", "w", encoding="utf-8").write(
            "# Tiers (archived snapshot, 2026-08-17)\n\n"
            "Historical copy. Not maintained.\n| white-label | no | yes |\n")
        subprocess.run(["git", "add", "."], cwd=tmp, shell=(sys.platform == "win32"),
                       check=True)
        found2 = scan(tmp)
        if [p for p in found2 if p.startswith("CONFLICTING AUTHORITY")]:
            print("  MISSED! still fires when one copy disclaims authority "
                  "-- too noisy to be a blocking gate")
            return 1
        print("  CORRECT does not fire once one copy disclaims authority")
    print("  self-test: both directions behave")

    # r182: main()'s shell -- argv and root graded against throwaway fixture
    # REPOS, the r166..r181 pattern. It lives in shell_ladder() below and is
    # returned as the LAST thing this function does, so --self-test RUNS the
    # ladder instead of merely defining it (the r263 shape: a ladder the census
    # text-matches and nothing calls). The case count above stays the case
    # COUNT; the ladder is where those cases become rungs.
    return shell_ladder()


#: The re-entry guard (the r228 pattern, shared with check-page-headings.py and
#: verify-root-policy.py): rung 4 drives a nested --self-test through main(),
#: whose self-test arm ends in shell_ladder(). Without the guard that nested run
#: starts a SECOND ladder recursively.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard: a nested self-test (rung 4) must not run a second ladder."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        # SILENT, and load-bearing: anything printed here lands in the nested
        # run's captured streams, which rung 4 reads for the nested case line.
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """
    Grade main()'s shell on throwaway trees that live OUTSIDE this repository.

    Each rung writes a fixture repository under a TemporaryDirectory beneath
    fixture_root(), hands it to main(argv=[...], root=fixture) and reads the
    verdict off BOTH captured streams. Nothing here reads or writes the real
    tree, and nothing reaches into scan() directly: a rung that cannot be
    observed from outside main() is not a rung.

    Every fixture is its own git repo with a staged index, because the checker's
    first act is `git ls-files` under the root handed to it. A fixture that is
    NOT a repo is rung 5's subject on purpose.

    WHAT IS GRADED.
      * rung 1  the KILLING rung: two same-named docs both claiming authority,
                and its verdict names the fixture's OWN paths in that order. A
                main() that grades this checkout prints 'no duplicate
                authoritative documents' at exit 0, which fails every clause.
      * rung 2  the clean arm: the same tree with no duplicate -> exit 0 and no
                finding line, so an arm that always answers 1 cannot pass.
      * rung 3  the identical arm: byte-identical duplicates -> exit 1 on
                'DUPLICATE (identical)'.
      * rung 4  --self-test through argv: the unchanged inline cases, exit 0,
                and the nested ladder skipped by the re-entry guard.
      * rung 5  the SCOPE refusal: a directory that is NOT a git repository must
                refuse through SystemExit naming 'git ls-files failed'.

    WHAT IT DOES NOT PROVE -- measured, not assumed. Rung 1 kills a main() that
    ignores root when this checkout is CLEAN, which it is today. On a checkout
    that really carried a duplicate, a root-blind main would also exit 1, and the
    rung's path assertions are what still catch it (the fixture's
    'docs/guides/zz-fixdoc/tiers.md' is not a path this repository has). The
    scan-base mutation in scripts/prove-ladder-kills.py is the proof rather than
    this note.
    """
    import sys as _sys

    def build(base, files):
        """A git repo at `base` with `files` written and staged.

        `git add` alone is enough: tracked_files() reads the INDEX via
        `git ls-files`, never the worktree-only state a plain write leaves.
        """
        base = Path(base)
        base.mkdir(parents=True, exist_ok=True)
        run = ["git", "-C", str(base)]
        subprocess.run(run + ["init", "-q"], shell=(_sys.platform == "win32"),
                       capture_output=True, text=True)
        for rel, content in files.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            io.open(dst, "w", encoding="utf-8", newline="\n").write(content)
        subprocess.run(run + ["add", "."], shell=(_sys.platform == "win32"),
                       capture_output=True, text=True)
        return base

    def grade(base, argv=()):
        """(rc, everything main() printed to either stream).

        An in-process SystemExit does NOT print its message -- the string lives
        in se.code -- so the refusal rung inspects the code, not the streams.
        """
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            try:
                rc = main(argv=list(argv), root=base)
            except SystemExit as se:
                rc = se.code
        return rc, out.getvalue() + err.getvalue()

    # Fixture-relative docs whose basenames appear NOWHERE in this repository,
    # so a verdict naming them cannot come from a scan of the real tree.
    G = "docs/guides/zz-fixdoc/tiers.md"
    R = "docs/records/zz-fixdoc/tiers.md"
    CLAIM = "# Tiers" + chr(10) + chr(10) + "> Status: FINAL. Single source of truth for pricing." + chr(10)
    DISC = "# Tiers (archived snapshot)" + chr(10) + chr(10) + "Historical copy. Not maintained." + chr(10)
    OTHER = "# Notes" + chr(10) + chr(10) + "Nothing to see." + chr(10)

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        base = Path(td)

        # rung 1 -- the KILLING rung, and it grades a VERDICT, not a scope refusal.
        # Both documents claim authority and differ. Both fixture paths must appear
        # in sorted order (guides before records) and the clean line must not.
        root = build(base / "one", {G: CLAIM + "| a | yes |" + chr(10),
                                    R: CLAIM + "| a | no |" + chr(10)})
        rc, said = grade(root)
        if (rc != 1
                or "verify-doc-uniqueness: 1 problem(s)" not in said
                or ("CONFLICTING AUTHORITY: tiers.md at ['" + G + "', '" + R + "']") not in said
                or "no duplicate authoritative documents" in said):
            print("  x rung 1: two same-named docs both claiming authority in the "
                  "FIXTURE must be VERDICTED rc 1 naming " + G + " then " + R
                  + " (rc=%r said=%r)" % (rc, said[-400:]), file=_sys.stderr)
            return 1
        shell += 1

        # rung 2 -- the POSITIVE floor: no duplicate at all. An arm that always
        # answers 1 passes rung 1 and dies here.
        root = build(base / "two", {G: CLAIM + "| a | yes |" + chr(10),
                                    "docs/notes.md": OTHER})
        rc, said = grade(root)
        if (rc != 0
                or "no duplicate authoritative documents" not in said
                or "problem(s)" in said):
            print("  x rung 2: a fixture with no duplicate must exit 0 cleanly "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=_sys.stderr)
            return 1
        shell += 1

        # rung 3 -- the IDENTICAL arm, which rung 1 cannot reach: two copies are
        # byte-identical, so neither is a competing authority and the finding is
        # reported as redundancy instead. Graded on the exact verdict prefix.
        same = CLAIM + "| a | yes |" + chr(10)
        root = build(base / "three", {G: same, R: same})
        rc, said = grade(root)
        if (rc != 1 or "DUPLICATE (identical): tiers.md" not in said
                or "CONFLICTING AUTHORITY" in said):
            print("  x rung 3: byte-identical duplicates in the fixture must exit 1 "
                  "on DUPLICATE (identical) and not on CONFLICTING AUTHORITY "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=_sys.stderr)
            return 1
        shell += 1

        # rung 4 -- --self-test through argv. Its own exit 0 proves the nested
        # ladder was GUARDED: an unguarded nested run would recurse forever, and
        # the two inline lines are what proves the case list ran unchanged.
        root = build(base / "four", {"docs/notes.md": OTHER})
        rc, said = grade(root, ("--self-test",))
        if (rc != 0
                or "self-test: both directions behave" not in said
                or "CAUGHT  conflicting-authority duplicate" not in said):
            print("  x rung 4: --self-test through argv must print the unchanged "
                  "inline cases and exit 0 (rc=%r said=%r)" % (rc, said[-400:]),
                  file=_sys.stderr)
            return 1
        shell += 1

        # rung 5 -- the SCOPE refusal, kept separate from every verdict rung: a
        # directory that is not a git repository must REFUSE rather than report
        # an empty-but-clean tree. The refusal is a SystemExit whose code is the
        # message string, because in-process sys.exit does not print it.
        plain = base / "five"
        plain.mkdir(parents=True, exist_ok=True)
        (plain / "docs").mkdir(parents=True, exist_ok=True)
        io.open(plain / "docs" / "README.md", "w", encoding="utf-8").write("# r" + chr(10))
        rc, said = grade(plain)
        refused = isinstance(rc, str) and rc.startswith("git ls-files failed")
        if not refused:
            print("  x rung 5: a non-repo root must refuse naming git ls-files "
                  "through SystemExit (got %r said=%r)" % (rc, said[-400:]),
                  file=_sys.stderr)
            return 1
        shell += 1

    print("LADDER OK (" + str(shell) + " shell rungs through main(): conflicting "
          "authority, clean, identical duplicate, nested --self-test, scope refusal)")
    return 0


def main(argv=None, root=None) -> int:
    """r182: argv and root parameterized, the r166..r181 contract -- root
    redirects the tracked-file list AND every document read, together."""
    args = argv if argv is not None else sys.argv[1:]
    if "--self-test" in args:
        return self_test()
    root_path = scan_base(root)
    problems = scan(root_path)
    bl = getattr(scan, "baselined", [])
    if bl:
        print(f"  {len(bl)} baselined duplicate(s) -- known, unresolved, "
              f"NOT new findings:")
        for b in bl:
            print(f"    ~ {b}")
        print("    A baseline entry must be deleted once its duplicate is "
              "resolved; leaving it in place re-silences the gate.")
        print()
    if problems:
        print(f"verify-doc-uniqueness: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("verify-doc-uniqueness: no duplicate authoritative documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
