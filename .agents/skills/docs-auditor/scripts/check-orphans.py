#!/usr/bin/env python3
"""docs-auditor shallow-mode structural check — orphaned/unversioned content.

Automates the manual orphan-content hunt (the CHANGELOG "Unversioned backfill
blocks" incident: P80-P251 entries that lost their release association when a
fold commit dropped their version headers) into a reusable shallow-mode pass
for the docs-auditor skill (SKILL.md §4b).

Three independent checks, each a fast read-only scan of every *.md file
outside the excluded directories:

  A. Unversioned / orphan wrapper labels
       Section headers that look like content wrappers: "## Unversioned ...",
       "### Orphaned ...", "## ... backfill block(s)". A wrapper label means
       some content lost its section or release association and was parked
       under an unversioned bucket. "backfill" ALONE is a legitimate domain
       term (DB migration backfills, ledger backfills) and is not flagged —
       only a section header pairing it with a bucket noun (block/section/
       entries) is a wrapper.

  B. Heading-structure orphans
       A "####" item whose nearest preceding heading is not "###" (or "#####"
       without "####"), plus non-benign heading-level skips (h2 -> h4,
       h3 -> h5, ...). The common h1 -> h3 "title to subsections" convention
       is allowed. Some hits are intentional appendices (an "####" under an
       "##") — judge before "fixing".

  C. Stale version headers
       A "##"/"###" header whose top cited version (0.0.X, or a range like
       0.0.22 / 0.0.23) trails its own section body's highest 0.0.Y — the
       header's version anchor has gone stale (e.g. a "0.0.5 release-blocker"
       section whose body now discusses 0.0.22/0.0.23 closures). A range
       citation is judged by its TOP version only. Markdown reference-definition lines
       ([0.0.25]: https://...) at the tail of Keep-a-Changelog files are not
       section content and never trip this check.

This is a DETECTOR, not a verdict: every hit is a candidate finding for the
docs-auditor report format (§11), triaged by severity (§4b triage rules).
False positives are possible — IP literals like 0.0.0:9180 never trip C
(0.0.0 < any header), but a roadmap section that legitimately looks ahead
(e.g. "## 0.0.25" whose body targets 0.0.26) will.

Usage:
  python3 scripts/check-orphans.py                 # all checks, repo-wide
  python3 scripts/check-orphans.py --check=a       # single check (a|b|c)
  python3 scripts/check-orphans.py --file docs/X.md
  python3 scripts/check-orphans.py --quiet         # findings only, no banner

Exit codes:
  0  clean (no findings)
  1  findings — triage before stamping the audited doc
  2  usage or scan error

Run from the repo root. On a cp1252 Windows console, prefix
PYTHONIOENCODING=utf-8 if non-ASCII output garbles.

Known limitation: a malformed UNCLOSED code fence silently suppresses every
heading after it in that file (the rest is treated as code). That is
acceptable for a shallow detector — if a file looks under-scanned, repair the
fence and re-run.
"""

import argparse
import os
import re
import sys

# Directories whose markdown is out of scope:
#   .agents       — skill content is owned by skill-drift-guard
#   vendor/build/external — .git, node_modules, target, dist, graphify-out
EXCLUDE_DIRS = {".git", ".agents", "node_modules", "target", "dist", "graphify-out"}

# Check A — wrapper-label keyword patterns. "backfill" is only a wrapper when
# paired with a bucket noun; "orphan(ed)" only when naming a bucket.
WRAPPER_RES = [
    re.compile(r"unversioned", re.IGNORECASE),
    re.compile(r"orphan(?:ed)?\s+(?:block|section|content|entr(?:y|ies))", re.IGNORECASE),
    re.compile(r"backfill\s+(?:block|sections?|entr(?:y|ies))", re.IGNORECASE),
]

# (?<![\d.]) + (?!\.\d) exclude dotted quads like the 0.0.0.0:9180
# listener IP while still matching v0.0.25-style tokens.
VERSION_RE = re.compile(r"(?<![\d.])0\.0\.(\d+)(?!\.\d)\b")

HEADING_RE = re.compile(r"^(#{1,6})\s+(\S.*)$")
REF_DEF_RE = re.compile(r"^\[[^\]]+\]:\s")  # markdown reference definition


def md_files(root, single=None):
    """Yield *.md paths under root, honoring EXCLUDE_DIRS and --file.

    Prefers "git ls-files": this is a gate over OUR documentation, and the tree also
    holds vendored, gitignored third-party markdown. Scanning that produced a real false
    positive on 08-09-26 - an h4-under-h2 finding inside
    references/midtrans-nodejs-client/README.md, a file with zero tracked entries that
    .gitignore excludes outright. A docs gate that can be reddened by a directory nobody
    committed is a gate someone will learn to ignore. Falls back to a plain walk when git
    is unavailable, so the tool still works outside a checkout."""
    if single:
        yield single
        return
    tracked = _git_tracked_md(root)
    if tracked is not None:
        for p in tracked:
            if any(x in EXCLUDE_DIRS for x in p.split("/")[:-1]):
                continue
            yield p
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for f in filenames:
            if f.endswith(".md"):
                yield os.path.join(dirpath, f)


def _git_tracked_md(root):
    """Tracked *.md paths, or None if git could not be asked.

    Output goes to a temp FILE rather than a pipe: capture_output uses piped stdio, which
    some sandboxes block, and a blocked call here would read as an empty file list. On any
    trouble this returns None and the caller walks the tree, so the failure mode is "scan
    more", never "scan nothing".
    """
    import subprocess
    import tempfile
    try:
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as out:
            rc = subprocess.run(["git", "ls-files", "-z", "--", "*.md"],
                                cwd=root or ".", stdout=out,
                                stderr=subprocess.DEVNULL, timeout=120)
            out.seek(0)
            body = out.read()
        if rc.returncode != 0:
            return None
        return [p for p in body.split(chr(0)) if p.endswith(".md")]
    except Exception:
        return None

def read_lines(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read().splitlines()
    except OSError as exc:
        print("scan error: %s: %s" % (path, exc), file=sys.stderr)
        return None


def check_a(lines):
    """(line_no, heading_text) for wrapper-label section headers.

    Fenced code blocks are skipped, matching checks B and C: a bash comment
    like "# unversioned override" inside a ``` block is code, not a heading.
    """
    hits = []
    in_code = False
    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        s = line.strip()
        if not s.startswith("#"):
            continue
        for rx in WRAPPER_RES:
            if rx.search(s):
                hits.append((i, s))
                break
    return hits


def check_b(lines):
    """Heading-structure orphans: (line_no, reason) pairs.

    Fenced code blocks are skipped: bash/sql comments that happen to start
    with "#" or "####" ("#### B. Structural Integrity" inside a ``` block)
    are not markdown headings and never count as structure.
    """
    heads = []  # (line_no, level)
    in_code = False
    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = HEADING_RE.match(line)
        if m:
            heads.append((i, len(m.group(1))))

    per_line = {}  # line_no -> list of reasons
    for idx, (ln, lvl) in enumerate(heads):
        if lvl >= 4:
            # Structural parent = nearest preceding heading with a LOWER
            # level (consecutive same-level siblings are normal: a run of
            # #### items under one ### category). Only a heading whose
            # nearest lower ancestor is not exactly lvl-1 is an orphan.
            parent = 0
            j = idx - 1
            while j >= 0 and heads[j][1] >= lvl:
                j -= 1
            parent = heads[j][1] if j >= 0 else 0
            if parent != lvl - 1:
                per_line.setdefault(ln, []).append(
                    "h%d with no h%d parent (nearest lower heading is h%d)"
                    % (lvl, lvl - 1, parent)
                )
        if idx > 0:
            p_lvl = heads[idx - 1][1]
            if lvl > p_lvl + 1 and not (p_lvl == 1 and lvl == 3):
                per_line.setdefault(ln, []).append(
                    "heading-level skip h%d -> h%d" % (p_lvl, lvl)
                )
    return [(ln, "; ".join(rs)) for ln, rs in sorted(per_line.items())]


def check_c(lines):
    """Stale version headers: (line_no, header_text, reason) triples."""
    hits = []
    in_code = False
    sections = []  # (line_no, header_text, [header versions], [body versions])
    for i, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code or REF_DEF_RE.match(line):
            continue
        m = re.match(r"^(#{2,3})\s+(\S.*)$", line)
        if m:
            hv = [int(v) for v in VERSION_RE.findall(m.group(2))]
            sections.append([i, m.group(2), hv, []])
            continue
        if sections:
            sections[-1][3].extend(int(v) for v in VERSION_RE.findall(line))
    for ln, hdr, hvs, bvs in sections:
        if not hvs or not bvs:
            continue
        max_body = max(bvs)
        top = max(hvs)  # range citation (0.0.22 / 0.0.23) judged by its top
        if max_body > top:
            hits.append(
                (
                    ln,
                    hdr,
                    "header cites 0.0.%d but section body cites up to 0.0.%d"
                    % (top, max_body),
                )
            )
    return hits


CHECKS = {"a": check_a, "b": check_b, "c": check_c}
NAMES = {
    "a": "A. Unversioned / orphan wrapper labels",
    "b": "B. Heading-structure orphans (h4/h5 without parent, level skips)",
    "c": "C. Stale version headers (header 0.0.X behind its section body)",
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", choices=sorted(CHECKS), help="run a single check (a|b|c)")
    ap.add_argument("--file", help="scan a single markdown file instead of the repo")
    ap.add_argument("--quiet", action="store_true", help="findings only, no banner")
    args = ap.parse_args()

    if args.file and not os.path.exists(args.file):
        print("usage error: %s does not exist" % args.file, file=sys.stderr)
        return 2

    files = list(md_files(os.getcwd(), args.file))
    sel = [args.check] if args.check else list(CHECKS)

    if not args.quiet:
        print("docs-auditor orphan scan (SKILL.md §4b)")
        print("scanning %d markdown files" % len(files))
        print("=" * 68)

    totals = {}
    for key in sel:
        fn = CHECKS[key]
        found = []
        for path in files:
            lines = read_lines(path)
            if lines is None:
                continue
            for hit in fn(lines):
                found.append((path, hit))
        totals[key] = len(found)
        if not args.quiet:
            print("\n== %s ==\n" % NAMES[key], end="")
        for path, hit in found:
            disp = os.path.relpath(path, os.getcwd()).replace(os.sep, "/")
            if key == "c":
                ln, hdr, why = hit
                print("  %s:%d: %s" % (disp, ln, hdr))
                print("      ^ %s" % why)
            else:
                ln, text = hit
                print("  %s:%d: %s" % (disp, ln, text))

    if not args.quiet:
        print("\n" + "=" * 68)
        for key in sel:
            print("  %-58s %d finding(s)" % (NAMES[key], totals[key]))
        code = 1 if any(totals.values()) else 0
        print("Exit: %d (%s)" % (code, "findings — triage before stamping" if code else "clean"))
    return 1 if any(totals.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
