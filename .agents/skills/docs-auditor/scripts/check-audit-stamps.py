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

Exit codes: 0 clean, 1 findings in the OLDER class or an impossible date,
2 the checker itself failed. The NEWER class is informational and does not
affect the exit code.

Usage:
    python3 .agents/skills/docs-auditor/scripts/check-audit-stamps.py [--verbose]
"""

from __future__ import annotations

import argparse
import datetime as _dt
import pathlib
import re
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true",
                    help="also list agreeing files and the informational classes")
    args = ap.parse_args()

    root = pathlib.Path.cwd()
    if not (root / "AGENTS.md").is_file() and not (root / "docs").is_dir():
        print("run this from the repository root", file=sys.stderr)
        return 2

    equal, newer, older, footer_only, stamp_only, bad_dates = [], [], [], [], [], []

    try:
        for rel, path in _iter_docs(root):
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                text = path.read_text(encoding="utf-8", errors="replace")

            stamps = _stamp_dates(text)
            footers = _footer_dates(text)
            if not stamps and not footers:
                continue

            raw = FOOTER_RE.findall(text)
            if raw and not footers:
                bad_dates.append((rel, "-".join(raw[-1])))

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

    total = len(equal) + len(newer) + len(older) + len(footer_only) + len(stamp_only)
    print("docs with a stamp and/or footer : %d" % total)
    print("  newest stamp == footer        : %d" % len(equal))
    print("  footer newer than newest stamp: %d   (re-checked without a stamp line)" % len(newer))
    print("  footer OLDER than newest stamp: %d   <- under-reports the audit" % len(older))
    print("  footer but no stamp           : %d" % len(footer_only))
    print("  stamp but no footer           : %d" % len(stamp_only))
    print("  footer is not a real date     : %d" % len(bad_dates))

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

    if older or bad_dates:
        print("")
        print("DRIFT: bump the footers above to their newest stamp date.")
        return 1
    print("")
    print("OK: no footer under-reports its own audit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
