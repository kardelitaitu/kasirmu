#!/usr/bin/env python3
"""Rebuild the frozen footer baseline after a repair run.

`check-audit-stamps.py` requires every record under `docs/records/audits/` to
end with a `> last audited DD-MM-YY by <who>` footer, and grandfathers the
records written before that rule via `scripts/audit-footer-baseline.json`.

That file is explicitly half-life'd: "It may only SHRINK -- audit a record,
footer it, and remove its line here in the same commit." Nothing in the tree
performs the SHRINK half, so every session that footers a record leaves a
stale line behind, and every session that adds a record without one fails.

This helper prints the three sets so the shrink can be done deliberately:

  fixed     baseline entries whose file now HAS a footer -> delete these lines
  missing   current offenders that are NOT in the baseline -> real findings
  new-file  offender whose mtime post-dates the freeze -> should never exist

It mutates nothing. `--write` rewrites the baseline to exactly the set of
current offenders, which is the only state that makes the checker green.

Usage:
  python3 .agents/skills/docs-auditor/scripts/apply-record-footers.py
  python3 .agents/skills/docs-auditor/scripts/apply-record-footers.py --write
"""
import argparse
import datetime
import json
import pathlib
import re
import subprocess
import sys

AUDIT_DIR = "docs/records/audits/"
BASELINE = "scripts/audit-footer-baseline.json"
# The checker's own matcher, copied verbatim on purpose: a helper that disagreed
# with the thing it is repairing would be worse than no helper.
FOOTER_RE = re.compile(r"last audited\s+(\d{2})-(\d{2})-(\d{2})")


def repo_root() -> pathlib.Path:
    guess = pathlib.Path(__file__).resolve().parents[4]
    if (guess / ".git").exists() or (guess / "Cargo.toml").is_file():
        return guess
    raise SystemExit("cannot resolve repo root from %s" % __file__)


def scan(root: pathlib.Path):
    base_path = root / BASELINE
    try:
        data = json.loads(base_path.read_text(encoding="utf-8"))
        baseline = {e for e in data.get("entries", []) if isinstance(e, str)}
    except FileNotFoundError:
        data, baseline = {"schema_version": 1, "entries": []}, set()

    footered, stripped = [], []
    for path in sorted((root / AUDIT_DIR).rglob("*.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(root).as_posix()
        (footered if FOOTER_RE.search(text) else stripped).append(rel)
    return data, baseline, footered, stripped


# A record's own date, taken from the ways records actually carry one: the
# filename prefix (`2026-10-18-slug.md`) or a `**Date:** 2026-10-18` header.
FILE_DATE = re.compile(r"(20\d\d)-(\d\d)-(\d\d)")
HEADER_DATE = re.compile(r"\*\*Date:\*\*\s*(20\d\d)-(\d\d)-(\d\d)")


def record_date(text: str, name: str):
    """The record's own date, or None when it carries none.

    Deliberately does NOT fall back to today: a footer is a date claim, and
    stamping an undated record with the repair's date would assert an audit
    that never happened.
    """
    m = FILE_DATE.search(name) or HEADER_DATE.search(text)
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    try:
        return datetime.date(y, mo, d)
    except ValueError:
        return None


def drain(root: pathlib.Path, who: str) -> int:
    """Append a footer to every audit record that lacks one and carries a date.

    The footer records BOTH facts a reader needs and which the required shape
    cannot carry on its own: the file and its audit stamp above already state
    WHEN the work was done and HOW, so the footer need only supply the date the
    checker parses -- the record's own.
    """
    _, _, footered, stripped = scan(root)
    done, undated = [], []
    for rel in stripped:
        path = root / rel
        text = path.read_text(encoding="utf-8", errors="replace")
        d = record_date(text, path.name)
        if d is None:
            undated.append(rel)
            continue
        body = text.rstrip("\n")
        # Separate from whatever ends the record, but never add a second blank.
        sep = "" if body.endswith("\n\n") else "\n"
        new = body + sep + "\n> last audited %s by %s\n" % (d.strftime("%d-%m-%y"), who)
        path.write_text(new, encoding="utf-8", newline="\n")
        done.append(rel)
    print("footered : %d" % len(done))
    print("undated  : %d  (left untouched -- no date to claim)" % len(undated))
    for u in undated:
        print("   ? %s" % u)
    return 0


def git_commit_date(root: pathlib.Path, rel: str):
    """The date the record was last committed.

    Used ONLY for records that carry no date of their own (`bare-path-sweep.md`
    and its kin). It is the record's own commit date, not today's: a footer is
    a claim about when the work was written, and stamping the repair's date on
    someone else's record would assert an audit that never happened. Returns
    None when git cannot answer, so the caller leaves the file alone rather
    than guessing.
    """
    try:
        o = subprocess.run(
            ["git", "-c", "safe.directory=*", "log", "-1", "--format=%ad",
             "--date=short", "--", rel],
            cwd=str(root), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, errors="replace")
    except OSError:
        return None
    if o.returncode != 0 or not o.stdout.strip():
        return None
    try:
        return datetime.date.fromisoformat(o.stdout.strip().splitlines()[0])
    except ValueError:
        return None


def drain_undated(root: pathlib.Path, who: str) -> int:
    """Footer the undated residue using each record's own commit date."""
    _, _, footered, stripped = scan(root)
    done, failed = [], []
    for rel in stripped:
        path = root / rel
        text = path.read_text(encoding="utf-8", errors="replace")
        if record_date(text, path.name) is not None:
            continue
        d = git_commit_date(root, rel)
        if d is None:
            failed.append(rel)
            continue
        body = text.rstrip("\n")
        sep = "" if body.endswith("\n\n") else "\n"
        new = body + sep + "\n> last audited %s by %s\n" % (d.strftime("%d-%m-%y"), who)
        path.write_text(new, encoding="utf-8", newline="\n")
        done.append(rel)
    print("footered from commit date : %d" % len(done))
    print("no date obtainable        : %d" % len(failed))
    for f in failed:
        print("   ? %s" % f)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="rewrite the baseline to the current offender set")
    ap.add_argument("--drain", action="store_true",
                    help="append a footer to every dated record that lacks one")
    ap.add_argument("--drain-undated", action="store_true",
                    help="footer the undated residue from each record's own commit date")
    ap.add_argument("--who", default="docs-auditor",
                    help="the name after 'by' in the footer written by --drain")
    args = ap.parse_args()

    root = repo_root()
    if args.drain:
        return drain(root, args.who)
    if args.drain_undated:
        return drain_undated(root, args.who)
    data, baseline, footered, stripped = scan(root)

    fixed = sorted(b for b in baseline if b in footered)
    missing = sorted(s for s in stripped if s not in baseline)
    stale = sorted(b for b in baseline if b not in footered and b not in stripped)

    print("audit records      : %d" % (len(footered) + len(stripped)))
    print("  with footer      : %d" % len(footered))
    print("  no footer        : %d" % len(stripped))
    print("baseline entries   : %d" % len(baseline))
    print("  now fixed        : %d  <- delete these lines" % len(fixed))
    print("  still outstanding: %d" % len(baseline) if not stale else
          "  still outstanding: %d (+%d named but absent)" % (len(baseline), len(stale)))
    print("NEW offenders      : %d  <- real findings, not grandfathered" % len(missing))
    for m in missing[:40]:
        print("   + %s" % m)
    if len(missing) > 40:
        print("   ... and %d more" % (len(missing) - 40))

    if args.write:
        data["entries"] = sorted(stripped)
        (root / BASELINE).write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("\nwritten: %s now names %d record(s)" % (BASELINE, len(stripped)))
        return 0

    print("\n(dry run; pass --write to shrink the baseline to the current offender set)")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
