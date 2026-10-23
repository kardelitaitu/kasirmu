#!/usr/bin/env python3
"""Audit-stamp / footer consistency checker.

Every audited doc in this repo carries two dates:

  * a house stamp line, newest first:
      <!-- Audit stamp: YYYY-MM-DD · who · status: ... -->
  * a machine-read footer, DD-MM-YY:
      > last audited DD-MM-YY by <who>

skill-drift-guard/scripts/detect.sh validates the *shape* of both and the
staleness of the footer, but nothing has ever compared them to each other. They
drift apart in three ways, and only one of them is actually dangerous:

  EQUAL   newest stamp == footer ............. healthy
  NEWER   footer later than newest stamp ..... a re-check bumped the footer
           without writing a stamp line. Not wrong — "re-read, nothing changed"
           is a legitimate outcome — but the evidence for the later date is
           nowhere, so nothing distinguishes it from a careless bump.
  OLDER   footer earlier than newest stamp ... BUG. The footer is the field
           people and detect.sh read to decide whether a doc needs work. When it
           under-reports, a freshly audited doc looks stale and gets re-audited,
           or its audit is discounted.

Also reported: files with a stamp but no footer (nothing machine-read), a footer
but no stamp behind it, and footers that are not real calendar dates — the shape
regex in detect.sh accepts 31-13-26, so a typo passes there and fails here.

Gitignored paths are skipped: a file the repository excludes (.workbuddy-ai/
scratch and friends) cannot carry a claim the repo makes, and memory files that
*discuss* malformed footers quote them literally — a quoted example is not a
footer. Tracked files and new-but-not-ignored files are always checked; git is
consulted once for the whole tree, and git being unavailable restores the old
walk-everything behaviour rather than failing open.

OPEN QUESTION, MEASURED BUT NOT RESOLVED (2026-10-05): six of the nine `footer
with no stamp` entries are PUBLISHED pages under website/src/content/docs/ (en and
id: first-day, quickstart, setup-wizard). The footer is meant to be machine-read
by this checker and by detect.sh, but nothing establishes whether it should appear
on a customer-facing page at all — the site build has no rule that strips it, and
website/src/content/docs/en/docs-authoring.md says nothing about footers either
way. That is the shape of an internal convention that leaked outward, not a
decision: the footer arrived with the pages in 8d9e7f66f ("add quickstart and
setup-wizard pages"), not from a deliberate audit-the-website pass, and the
convention is applied to exactly HALF the corpus — 20 of 40 website docs carry it,
20 do not.

RESOLVED 2026-10-05 (round 137): the footer DOES reach readers. It was checked in
the content pipeline rather than by deploying the site. website/src/pages/[locale]/
docs/[...slug].astro renders `<Content />` at line 50 — the whole markdown body — and
astro.config.mjs registers NO remark/rehype plugin that could strip or rewrite it.
The only `filter` in DocsLayout.astro is on HEADINGS (TOC depth 2-3), not the body.
So a trailing `> last audited ...` blockquote builds into the page and renders as a
visible blockquote: on those 20 pages a customer sees "last audited 30-09-26 by
docs-auditor" under the article.

That makes the leaning clear without settling it. A footer whose purpose is to be
machine-read by this checker and detect.sh has no business rendering to a customer,
and the convention covers only half the corpus — so the likelier ruling is the
website is OUT of scope and the footer should go, not that 20 pages should gain
stamps. It is still NOT applied here, and the reason is now ownership rather than
uncertainty: this is a docs-authoring decision about published pages, it touches 20
files, and the checker's job is to report it. Two things to settle before acting —
whether any page uses the footer as reader-facing metadata deliberately, and whether
removeFooter() should be a build-time rule so the convention cannot leak back in
the next time a page is copied from docs/.

Exit codes: 0 clean, 1 findings in the OLDER class or an impossible date,
2 the checker itself failed. The NEWER class is informational and does not
affect the exit code.

Usage:
    python3 .agents/skills/docs-auditor/scripts/check-audit-stamps.py [--verbose]
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import pathlib
import re
import subprocess
import sys

# Vendored trees and build output are not ours to audit.
SKIP_PARTS = ("node_modules/", "/target/", "references/", ".git/")

STAMP_RE = re.compile(r"Audit stamp:\s*(\d{4})-(\d{2})-(\d{2})")
FOOTER_RE = re.compile(r"last audited\s+(\d{2})-(\d{2})-(\d{2})")


def _iter_docs(root: pathlib.Path):
    for path in sorted(root.rglob("*.md")):
        rel = path.as_posix()
        if any(part in rel for part in SKIP_PARTS):
            continue
        yield rel, path


def _git_ignored(root: pathlib.Path, rels: list) -> set:
    """Subset of repo-relative `rels` excluded by .gitignore (never checked).

    Decision 2026-09-23 (documentation-audit follow-up): the tree walk also
    sees local scratch the repository ignores, and the one live red finding
    was a .workbuddy-ai memory file QUOTING `30-02-26` inside a discussion of
    impossible dates. Quoting is not a footer, and only the ignore rule can
    tell a repo claim from someone's scratchpad. One `git check-ignore
    --stdin` call for the whole tree; exit >= 2 or no git at all falls back
    to checking everything (the pre-2026-09-23 behaviour).
    """
    if not rels:
        return set()
    try:
        proc = subprocess.run(
            ["git", "-c", "core.quotepath=false", "check-ignore", "--stdin"],
            # Bytes, not text: on Windows, subprocess text mode rewrites "\n"
            # to "\r\n" on input, git reads the CR back as part of the
            # filename, and answers with the whole path wrapped in quotes —
            # the parsed set then never matches a real path and every
            # gitignored finding sneaks through. quotepath=false keeps
            # non-ASCII paths verbatim instead of octal-escaped.
            input=("\n".join(rels) + "\n").encode("utf-8"),
            capture_output=True,
            cwd=root, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return set()
    # 0 = at least one path ignored, 1 = none ignored, >= 2 = misuse/error.
    if proc.returncode >= 2:
        return set()
    out = proc.stdout.decode("utf-8", errors="replace")
    return {ln.strip().strip('"') for ln in out.splitlines() if ln.strip()}


def _stamp_dates(text: str) -> list:
    out = []
    for y, m, d in STAMP_RE.findall(text):
        try:
            out.append(_dt.date(int(y), int(m), int(d)))
        except ValueError:
            continue
    return out


def _footer_dates(text: str) -> list:
    out = []
    for dd, mm, yy in FOOTER_RE.findall(text):
        try:
            out.append(_dt.date(2000 + int(yy), int(mm), int(dd)))
        except ValueError:
            continue
    return out


AUDIT_DIR = "docs/records/audits/"
FOOTER_BASELINE = "scripts/audit-footer-baseline.json"


def _footer_baseline(root: pathlib.Path) -> set:
    """The frozen list of audit records written before the footer rule existed.

    A MISSING baseline file is not a pass: it means the rule cannot be enforced, and
    silently degrading to "everything is grandfathered" is exactly the failure mode a
    checker this shape is written to avoid. The caller reports it as a finding.
    """
    path = root / FOOTER_BASELINE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    entries = data.get("entries")
    if not isinstance(entries, list):
        return set()
    return {e for e in entries if isinstance(e, str)}


def _missing_footers(root: pathlib.Path):
    """Audit records with NO footer, split into (offenders, baseline_absent).

    Only docs/records/audits/ is policed. The corpus s other conventions -- a dated
    journal under .agents/, a plan doc at the root, a superseded record under
    docs/records/superseded/ -- legitimately carry inline stamps or nothing, and
    requiring a footer there would manufacture ceremony the repo does not ask for.
    """
    baseline = _footer_baseline(root)
    baseline_absent = not (root / FOOTER_BASELINE).is_file()
    target = root / AUDIT_DIR
    if not target.is_dir():
        return [], baseline_absent
    out = []
    for path in sorted(target.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        if FOOTER_RE.search(text):
            continue
        rel = path.relative_to(root).as_posix()
        if rel not in baseline:
            out.append(rel)
    return out, baseline_absent


#: Stamp/footer pairs and the class each must land in.
#:
#: WHY THESE CASES. main() decides everything with `if newest == footer / elif footer >
#: newest / else`, three lines whose failure mode is SILENT: if the comparison flipped,
#: every under-reporting doc would be relabelled into the informational class and the
#: gate would exit 0 while the dangerous class sat empty. The census floor at the bottom
#: of main() catches a DEAD regex; it cannot catch a MISCLASSIFIED pair. These can.
CLASSIFY_CASES = (
    ("equal dates are healthy", "Audit stamp: 2026-10-01", "> last audited 01-10-26 by x", "equal"),
    ("earlier footer is the BUG class", "Audit stamp: 2026-10-05", "> last audited 01-10-26 by x", "older"),
    ("later footer is informational", "Audit stamp: 2026-10-01", "> last audited 05-10-26 by x", "newer"),
    ("stamp alone has nothing machine-read", "Audit stamp: 2026-10-01", "", "stamp_only"),
    ("footer alone has no stamp behind it", "", "> last audited 01-10-26 by x", "footer_only"),
    ("neither is not a claim at all", "", "", None),
    (
        "newest stamp governs when a doc carries two",
        "Audit stamp: 2026-09-01\nAudit stamp: 2026-10-05",
        "> last audited 01-09-26 by x",
        "older",
    ),
)


#: Impossible footers. detect.sh's SHAPE regex accepts 31-13-26, so a typo passes there
#: and must be caught here.
BAD_DATE_CASES = (
    ("month 13", "> last audited 01-13-26 by x", True),
    ("day 31 in a 30-day month", "> last audited 31-04-26 by x", True),
    ("february 30", "> last audited 30-02-26 by x", True),
    ("a real leap day is not flagged", "> last audited 29-02-24 by x", False),
    ("an ordinary date is not flagged", "> last audited 15-06-26 by x", False),
)


def classify(text: str):
    """The class one document body lands in, or None when it carries no claim.

    Extracted from main() so the cases above exercise the REAL comparison rather than
    a duplicate of it. Returns (klass, impossible_footer_triples).
    """
    stamps = _stamp_dates(text)
    footers = _footer_dates(text)
    bad = []
    for dd, mm, yy in FOOTER_RE.findall(text):
        try:
            _dt.date(2000 + int(yy), int(mm), int(dd))
        except ValueError:
            bad.append("%s-%s-%s" % (dd, mm, yy))
    if not stamps and not footers:
        return None, bad
    if not stamps:
        return "footer_only", bad
    if not footers:
        return "stamp_only", bad
    newest = max(stamps)
    footer = footers[-1]
    if newest == footer:
        return "equal", bad
    if footer > newest:
        return "newer", bad
    return "older", bad


def self_test() -> int:
    """Grade the classifier and the impossible-date rejection; report EVERY failure."""
    bad = []
    for name, stamps, footer, expected in CLASSIFY_CASES:
        got, _ = classify(stamps + chr(10) + footer)
        if got != expected:
            bad.append("  %s: expected %r, classifier returned %r" % (name, expected, got))
    for name, footer, should_flag in BAD_DATE_CASES:
        _, flagged = classify(footer)
        if should_flag and not flagged:
            bad.append("  %s: must be flagged as an impossible date, got none" % name)
        if not should_flag and flagged:
            bad.append("  %s: must NOT be flagged, got %r" % (name, flagged))
    if bad:
        sys.stderr.write("SELF-TEST WRONG:" + chr(10) + chr(10).join(bad) + chr(10))
        return 2
    print("SELF-TEST OK (%d cases, no file read)" % (len(CLASSIFY_CASES) + len(BAD_DATE_CASES)))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true",
                    help="also list agreeing files and the informational classes")
    ap.add_argument("--self-test", action="store_true",
                    help="run this checker's cases and exit")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    # Grade the classifier BEFORE the tree. A flipped comparison would relabel every
    # under-reporting doc into the informational class, and the census floor below
    # counts rows rather than checking them, so it would not see it.
    rc = self_test()
    if rc:
        sys.stderr.write("CLASSIFIER WENT DEAF: not trusting the tree scan below." + chr(10))
        return rc

    root = pathlib.Path.cwd()
    if not (root / "AGENTS.md").is_file() and not (root / "docs").is_dir():
        print("run this from the repository root", file=sys.stderr)
        return 2

    equal, newer, older, footer_only, stamp_only, bad_dates = [], [], [], [], [], []

    docs = list(_iter_docs(root))
    root_posix = root.as_posix() + "/"
    rels = [s[len(root_posix):] if s.startswith(root_posix) else s
            for s, _ in docs]
    ignored = _git_ignored(root, rels)

    try:
        for (rel, path), rpath in zip(docs, rels):
            if rpath in ignored:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                text = path.read_text(encoding="utf-8", errors="replace")

            stamps = _stamp_dates(text)
            footers = _footer_dates(text)
            if not stamps and not footers:
                continue

            raw = FOOTER_RE.findall(text)
            for dd, mm, yy in raw:
                try:
                    _dt.date(2000 + int(yy), int(mm), int(dd))
                except ValueError:
                    bad_dates.append((rel, "%s-%s-%s" % (dd, mm, yy)))

            if not stamps:
                footer_only.append((rel, footers[-1]))
                continue
            if not footers:
                stamp_only.append((rel, stamps[0]))
                continue

            newest = max(stamps)
            footer = footers[-1]
            if newest == footer:
                equal.append(rel)
            elif footer > newest:
                newer.append((rel, newest, footer, len(stamps)))
            else:
                older.append((rel, newest, footer))
    except Exception as exc:  # defensive: a checker that crashes is worse than none
        print("checker failed: %s" % exc, file=sys.stderr)
        return 2

    try:
        missing_footers, baseline_absent = _missing_footers(root)
    except Exception as exc:  # same contract as the loop above
        print("checker failed reading the footer baseline: %s" % exc, file=sys.stderr)
        return 2

    total = len(equal) + len(newer) + len(older) + len(footer_only) + len(stamp_only)
    # THE CENSUS FLOOR. Printing a denominator is not the same as checking it, and this
    # file's own loop sets the trap: line 236 is `if not stamps and not footers: continue`,
    # so a stamp regex that stops matching (a reworded house stamp, a changed date format)
    # makes EVERY file `continue` and leaves a report of seven zeroes. Measured
    # 2026-10-23 by emptying both _stamp_dates and _footer_dates: the checker printed its
    # seven lines with 0 everywhere and exited 0.
    #
    # A real tree here has 892 docs carrying a stamp and/or a footer. The floor is set
    # far below that so ordinary deletions never trip it; it exists to catch a ZERO.
    MIN_DOCS_WITH_A_CLAIM = 50
    print("docs with a stamp and/or footer : %d" % total)
    print("  newest stamp == footer        : %d" % len(equal))
    print("  footer newer than newest stamp: %d   (re-checked without a stamp line)" % len(newer))
    print("  footer OLDER than newest stamp: %d   <- under-reports the audit" % len(older))
    print("  footer but no stamp           : %d" % len(footer_only))
    print("  stamp but no footer           : %d" % len(stamp_only))
    print("  footer is not a real date     : %d" % len(bad_dates))
    print("  audit records with NO footer  : %d   <- required under docs/records/audits/" % len(missing_footers))

    if bad_dates:
        print("")
        print("== impossible footer dates ==")
        for rel, raw in bad_dates:
            print("   %s  last audited %s" % (rel, raw))

    if older:
        print("")
        print("== footer under-reports the audit ==")
        for rel, s, f in older:
            print("   %s" % rel)
            print("       newest stamp %s   footer %s" % (s.isoformat(), f.strftime("%d-%m-%y")))

    if args.verbose and stamp_only:
        print("")
        print("== stamped but no footer (nothing machine-read) ==")
        for rel, s in stamp_only:
            print("   %s  stamp %s" % (rel, s.isoformat()))

    if args.verbose and footer_only:
        print("")
        print("== footer with no stamp behind it ==")
        for rel, f in footer_only:
            print("   %s  footer %s" % (rel, f.strftime("%d-%m-%y")))

    if args.verbose and newer:
        print("")
        print("== footer newer than newest stamp ==")
        for rel, s, f, n in newer:
            print("   %s  stamps=%d newest=%s footer=%s"
                  % (rel, n, s.isoformat(), f.strftime("%d-%m-%y")))

    if args.verbose:
        print("")
        print("== agreeing ==")
        for rel in equal:
            print("   %s" % rel)

    if missing_footers:
        print("")
        print("== audit record with NO footer (required) ==")
        for rel in missing_footers:
            print("   %s" % rel)
        if baseline_absent:
            print("")
            print("   NOTE: %s is missing, so NOTHING is grandfathered -- every"
                  % FOOTER_BASELINE)
            print("   record above is a finding. Restore the baseline or footer them all.")

    if total < MIN_DOCS_WITH_A_CLAIM:
        print("")
        print("REFUSED: only %d doc(s) carry a stamp or footer; a real tree has at least %d."
              % (total, MIN_DOCS_WITH_A_CLAIM))
        print("A report of zero findings over an empty census is not a clean tree: the loop")
        print("skips every file whose stamp AND footer regexes both miss, so a reworded")
        print("house stamp produces exactly these zeroes. Check STAMP_RE / FOOTER_RE.")
        return 1

    if older or bad_dates or missing_footers:
        print("")
        if older:
            print("DRIFT: bump the footers above to their newest stamp date.")
        if missing_footers:
            print("MISSING FOOTER: add a '> last audited DD-MM-YY by <who>' line as the LAST")
            print("non-empty line. A record that predates the rule is named in")
            print("%s; remove its line in the same commit" % FOOTER_BASELINE)
            print("that adds the footer.")
        return 1
    print("")
    print("OK: no footer under-reports its own audit, and every audit record has one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
