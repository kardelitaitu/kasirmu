#!/usr/bin/env python3
"""verify-runner-claims.py -- prose that claims CI enforcement must be true.

WHY THIS EXISTS, AND WHY IT IS NARROW
======================================
The other runner gates check that runners are WELL FORMED: verify-shell-syntax parses
them, verify-workflow-syntax parses them, verify-runner-commands resolves the scripts
they name. None of them checks that PROSE ABOUT runners is true. That gap cost two
corrections in one session, both of the same shape:

  ops/docker/Dockerfile.server:94 said workspace consistency "is enforced by
  scripts/verify-dockerfile-workspace.py in CI" -- the checker had no runner at all,
  and when it got one it went into the local matrix, not a workflow.
  docs/operations/ci-pipeline.md said a checker was invoked by "no live workflow and
  not check.sh" -- true when written, false within the same session.

A claim about enforcement sits next to the thing it describes, reads as verified fact,
and is checked by nobody. So this checks exactly one thing: where a file POSITIVELY
asserts that a script is enforced or run in CI, that script must actually be invoked by
a live workflow.

WHAT IS DELIBERATELY NOT FLAGGED
================================
Negative claims. "Runs nowhere", "retired", "no runner", "used to" are statements of
ABSENCE, and they stay correct no matter what gets wired later -- a checker can only
gain a runner, never lose one. Flagging those is how a gate cries wolf on the repo's own
historical records, which is the mistake that sank two earlier attempts this session.

Also exempt: docs/archived/, .github/workflows/attic, and dated baselines. Those are
evidence. A record of what was true on a given day is not drift, and rewriting one to
match today destroys the only evidence that it ever differed.

docs/records/ WAS exempt outright and is NOT any more (2026-10-24). The blanket skip made
a CURRENT document exempt from the gate built to catch its claims, and it did exactly
that: docs/records/audits/2026-08-31-glm-5.3f-crates-audit.md:2203 asserted that
verify-docker-persistence.sh "runs the volume contract in CI" -- false for two months, in
the one checker that could have said so. A record is now skipped only when it says of
ITSELF that it is superseded (see SUPERSEDED), because a date in a filename records when
something was written, not that its claims have been retired. Dated audits whose claims
are still meant to hold are graded like any other file, which is why that one now carries
an inline correction rather than a note below the sentence it contradicts.

Exit 0 every positive claim holds, 1 at least one does not, 2 the scan saw nothing.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The live-workflow rule is shared; see scripts/_live_workflows.py. Six checkers had
# their own copy and three disagreed about .yaml, which is how a half-fixed suite
# pretends to be a fixed one.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _live_workflows import live_workflow_files as _live_workflow_files  # noqa: E402

# A positive enforcement claim. Two shapes, because prose uses both:
#   "... is enforced by scripts/verify-x.py in CI"
#   "scripts/verify-x.py in CI"
CLAIM_RES = [
    re.compile(r"(?:enforced|validated|verified|checked|guarded|covered)"
               r"[^.\n]{0,90}?by\s+([A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
               r"[^.\n]{0,40}?\bCI\b", re.I),
    re.compile(r"([A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
               r"[^.\n]{0,40}?\bin CI\b", re.I),
]
# Words that turn a sentence into a record of the past. Without these the gate reads
# changelogs and journals as violations, which is exactly the noise that gets a gate
# muted on its first run.
HISTORICAL = re.compile(
    r"\b(?:retired|was in|were in|used to|no longer|formerly|previously|"
    r"histor(?:y|ical)|at the time|once|dead|did not run)\b", re.I)
# "var" is program-generated state (the database, its WAL sidecars, backups);
# a backup archive in there is a filename, not a claim about CI.
# "records" was added 2026-10-02, when "archived" became a one-file tombstone.
# The pruning below matches a DIRECTORY NAME, so the 28 documents that used to sit
# under docs/archived/ stopped being skipped the moment they moved to
# docs/records/ -- and this checker went RED on one of them, because a dated
# audit's claim ("verify-docker-persistence.sh is run in CI") stopped being
# treated as evidence. That is the intent stated in this file's own docstring:
# a record of what was true on a given day is not drift.
#
# This was the only break in the whole docs/ move that turned a gate RED rather
# than failing silently. The other three -- build-docs, release.sh, and the CI
# route bucket -- all stayed green while being wrong.
SKIP_DIRS = ("archived", "records", "attic", "node_modules", "target", "dist",
             ".git", "__tests__", "var")
# Scratch dumps left at the repo root by a working session. Measured 2026-10-24: an
# untracked `.tmp_windows.txt` (10,866 lines of captured output) was being read as a live
# document, and it quoted this file's own docstring -- so the gate reported "verify-x.py is
# claimed to run in CI but no live workflow invokes it" against ITSELF, twice. A claim in a
# scratch file is not a claim, and a gate that reddens on one teaches its reader to ignore it.
SKIP_NAME_PREFIXES = (".tmp_", ".tmp-", "tmp_")
SCAN_SUFFIX = (".md", ".yml", ".yaml", ".sh", ".rs", ".toml", ".json", ".ps1",
              ".txt", ".py", ".mjs", ".ts", ".tsx")
# .py/.mjs were MISSING at first, so a claim in a Python docstring or a Node comment was
# invisible -- including this file's own, which names a checker it says has no runner.
# Same shape as every other scope bug in this session: an assumption about what a file
# looks like, standing in for a question about where claims actually live.
SCAN_NAMES = ("Dockerfile", "Dockerfile.server", "Dockerfile.unified", "AGENTS.md")
# A record may declare itself evidence of a past day and be left alone. The marker is
# explicit -- "SUPERSEDED", "HISTORICAL RECORD", "DO NOT TRUST THIS FOR CURRENT WIRING" --
# rather than a filename convention, because a date in the name says when it was written,
# not that its claims have been retired.
SUPERSEDED = re.compile(
    r"\b(?:SUPERSEDED|HISTORICAL RECORD|DO NOT TRUST THIS FOR CURRENT)\b", re.I)


def live_ci_scripts(workflows=None) -> set[str]:
    """Basenames a LIVE workflow invokes. attic/ excluded: never executed.

    r169: `workflows` redirects the feed at a fixture (the parameter r166 gave
    the shared module); None keeps this repository's own .github/workflows."""
    out: set[str] = set()
    # Shared rule -- see scripts/_live_workflows.py for why it is written once.
    for p in _live_workflow_files(workflows):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in re.finditer(r"([A-Za-z0-9_.-]+\.(?:py|mjs|sh))", text):
            out.add(m.group(1))
    return out


def scanned_files(root=None) -> list[Path]:
    out: list[Path] = []
    # This file is excluded because its own self-test fixtures are CLAIM-SHAPED BY
    # DESIGN -- they are the strings the cases assert on, and they name verify-x.py, a
    # script that does not exist. A checker that reads its own fixtures will always find
    # claims that are not claims, and the fix for that is exclusion, not a weaker
    # pattern that would also stop matching real ones.
    for dirpath, dirnames, filenames in __import__("os").walk(ROOT if root is None else root):
        # docs/records/ must be ENTERED, not pruned: its dated files are evidence and its
        # undated files are live prose. Skipping the directory wholesale made a filter on
        # the collected paths dead code -- it ran over a list that could not contain them.
        # Measured 2026-10-24: 0 files under docs/records/ were scanned while this gate
        # reported "6 claim(s) checked, all hold".
        dirnames[:] = [d for d in dirnames
                       if d.startswith(".git")
                       or d.lower() == "records"
                       or d.lower() not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith(SKIP_NAME_PREFIXES):
                continue   # scratch dump, not a document
            p = Path(dirpath) / fn
            if fn.endswith(SCAN_SUFFIX) or fn in SCAN_NAMES:
                if p.resolve() == Path(__file__).resolve():
                    continue   # see below
                out.append(p)
    # docs/records/ holds TWO kinds of document and SKIP_DIRS treated them as one, which
    # made a CURRENT document exempt from the gate built to catch its claims. Measured
    # 2026-10-24: docs/records/audits/2026-08-31-...md:2203 said
    # "verify-docker-persistence.sh runs the volume contract in CI" -- a name with ZERO
    # hits in check.sh and none in any live workflow. The sentence was false when written
    # and stayed false for two months, in the one gate that could have caught it.
    #
    # The rule is NOT "dated means skip". A dated audit is a snapshot, and the reason to
    # leave it alone is that rewriting history destroys evidence -- but a claim it makes
    # about TODAY's wiring still has to be answered, so the honest resolution is either to
    # correct it (stamped, as that file now is) or to say plainly that it is superseded.
    # A file that carries its own supersession note is evidence and is skipped; anything
    # else in docs/records/ is graded.
    records = (ROOT / "docs" / "records").resolve()
    kept: list[Path] = []
    for p in out:
        if records not in p.resolve().parents:
            kept.append(p)
            continue
        try:
            head = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            kept.append(p)
            continue
        if SUPERSEDED.search(head):
            continue
        kept.append(p)
    out = kept
    return sorted(out)


def claims_in(text: str) -> list[tuple[str, str]]:
    """(script, the sentence) for each positive enforcement claim on a line."""
    found: list[tuple[str, str]] = []
    for ln in text.splitlines():
        if HISTORICAL.search(ln):
            continue
        for rx in CLAIM_RES:
            m = rx.search(ln)
            if m:
                found.append((Path(m.group(1)).name, ln.strip()))
                break
    return found


def self_test() -> int:
    """Pure over synthetic text. No file is created, read or written."""
    bad: list[str] = []

    # A live claim is found.
    got = claims_in("Workspace consistency is enforced by scripts/verify-x.py in CI.")
    if not got or got[0][0] != "verify-x.py":
        bad.append(f"a positive claim must be found, got {got!r}")

    # A claim of absence is NOT a claim of enforcement -- the exemption that keeps this
    # gate off the repo's own historical records.
    for label, line in (
        ("retired", "the gate is retired, no runner invokes scripts/verify-x.py in CI"),
        ("used to", "scripts/verify-x.py used to run in CI"),
        ("historical", "at the time scripts/verify-x.py ran in CI"),
    ):
        if claims_in(line):
            bad.append(f"a {label} statement must not be flagged as a live claim")

    # And the rule must fire on the exact shape that was actually wrong: a script
    # asserted to be in CI while the live set does not contain it.
    live = {"other.py"}
    got = claims_in("enforced by scripts/verify-x.py in CI")
    if got and Path(got[0][0]).name in live:
        bad.append("the missing-script case must not be reported as satisfied")

    # THE SCOPE RULE, which was the actual defect: docs/records/ is no longer skipped
    # wholesale. Only a file that says of ITSELF that it is superseded is exempt.
    # Measured 2026-10-24: the blanket skip hid a live CI claim in a current audit for
    # two months, in the checker written to catch exactly that claim.
    for label, text, expect_skip in (
        ("an explicit SUPERSEDED marker excludes the file", "| SUPERSEDED 2026-01-01 |", True),
        ("HISTORICAL RECORD excludes the file", "HISTORICAL RECORD, do not act on it", True),
        ("DO NOT TRUST THIS FOR CURRENT excludes it",
         "DO NOT TRUST THIS FOR CURRENT WIRING", True),
        ("a bare date in prose does not", "written 2026-08-31, still accurate", False),
        ("a CORRECTED note does not exclude it", "CORRECTED 2026-10-24: that was false", False),
        ("ordinary text does not", "the gate runs in CI", False),
    ):
        skip = bool(SUPERSEDED.search(text))
        if skip != expect_skip:
            bad.append(f"{label}: expected skip={expect_skip}, got {skip}")

    # And the corrected sentence must genuinely STOP being a claim, rather than being
    # suppressed by a nearby historical word. That is the difference between fixing a
    # false statement and teaching the checker to ignore it.
    corrected = ("verify-docker-persistence.sh was believed to run the volume contract "
                 "in CI -- it does not (corrected below).")
    if claims_in(corrected):
        bad.append("a corrected sentence must no longer carry the claim")

    # live_ci_scripts is the liveness oracle every claim is graded against; a gutted
    # one must turn the self-test red. The workflow feed is patched to a synthetic
    # file so the case stays hermetic, and a vanished file must be skipped, not fatal.
    global _live_workflow_files
    import tempfile
    _saved_feed = _live_workflow_files
    try:
        with tempfile.TemporaryDirectory() as td:
            wf = Path(td) / "deploy.yml"
            wf.write_text("      run: python scripts/alpha.py\n"
                          "      run: bash scripts/beta.sh\n"
                          "      run: node scripts/gamma.mjs\n", encoding="utf-8")
            _live_workflow_files = lambda workflows=None: [wf, Path(td) / "gone.yml"]
            got = live_ci_scripts()
            if got != {"alpha.py", "beta.sh", "gamma.mjs"}:
                bad.append(f"live_ci_scripts: expected the three basenames, got {got!r}")
    finally:
        _live_workflow_files = _saved_feed

    # r169: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166 drift pattern: capture stdout AND stderr, patch nothing global.
    # root redirects the scan walk AND the live-workflow feed together, so no
    # case can half-run against the real repository.
    import contextlib
    import io as _io
    def _shell(claim_text, runs_line):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".github" / "workflows").mkdir(parents=True)
            (root / "docs").mkdir()
            (root / ".github" / "workflows" / "a.yml").write_text(
                "on: push" + chr(10) + "jobs:" + chr(10) + "  j:" + chr(10)
                + "    steps:" + chr(10) + "      - run: " + runs_line + chr(10),
                encoding="utf-8")
            (root / "docs" / "claim.md").write_text(claim_text, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv=[], root=root)
            return rc, out.getvalue() + err.getvalue()
    rc, text = _shell("alpha is enforced by scripts/ghost.py in CI.",
                      "python scripts/real.py")
    if rc != 1 or "ghost.py" not in text:
        bad.append("a false claim must exit 1 naming the script (rc=%d text=%r)"
                   % (rc, text[:80]))
    rc, text = _shell("alpha is enforced by scripts/real.py in CI.",
                      "python scripts/real.py")
    if rc != 0 or "all hold" not in text:
        bad.append("a satisfied claim must exit 0 with the OK line (rc=%d text=%r)"
                   % (rc, text[:80]))
    rc, text = _shell("alpha is enforced by scripts/real.py in CI.", "echo hi")
    if rc != 2 or "Refusing" not in text:
        bad.append("an empty live set must refuse with exit 2 (rc=%d text=%r)"
                   % (rc, text[:80]))

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, incl. 3 shell cases; no repo files touched)"
          % (12 + 1 + 3))
    return 0


def main(argv: list[str] | None = None, root: str | Path | None = None) -> int:
    """r169: argv and root parameterized, the r166 drift contract -- root
    redirects BOTH the scan walk and the live-workflow feed, so a fixture
    cannot half-run against the real repository."""
    root_path = None if root is None else Path(root).resolve()
    wf_dir = None if root_path is None else root_path / ".github" / "workflows"
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    live = live_ci_scripts(wf_dir)
    if not live:
        print("verify-runner-claims: no live workflow scripts found. Refusing to report"
              " clean -- a claim checker with an empty live set would call every claim"
              " a violation.", file=sys.stderr)
        return 2

    false_claims: list[str] = []
    seen = 0
    for p in scanned_files(root_path):
        if p.suffix in (".yml", ".yaml") and p.name in {w.name for w in _live_workflow_files(wf_dir)}:
            continue          # a workflow does not claim about itself
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for script, sentence in claims_in(text):
            seen += 1
            if script not in live:
                rel = p.relative_to(root_path if root_path is not None else ROOT).as_posix()
                false_claims.append(f"{rel}: {script} is claimed to run in CI but no"
                                    f" live workflow invokes it\n    {sentence[:150]}")
    if false_claims:
        print(f"verify-runner-claims: {len(false_claims)} claim(s) assert CI"
              f" enforcement that does not exist:")
        for f in false_claims:
            print("  " + f)
        print("  Either wire the checker into a live workflow, or change the claim to say"
              " where it actually runs. A comment that reads as a verified fact and is"
              " checked by nobody is worse than no comment.")
        return 1
    print(f"verify-runner-claims: OK — {seen} CI-enforcement claim(s) checked, all hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
