#!/usr/bin/env python3
"""Cross-check todo-optimize-crates.md against commits that claim to close entries.

WHY THIS EXISTS
---------------
The journal is the source of truth for what debt is still open, and five entries have been
caught ranked as open work after they were already fixed:

    O-H23, O-H24, O-H26   fixed 2026-09-27 by other lanes, never marked
    O-H03, O-H04, O-H08   said "Fixed:" in their own text, still counted as open
    O-H22                 committed as 49a304b97 with no section at all

Two more failure modes were found in the same pass and are graded here too:

    a section DELETED by a later edit   (49a304b97 removed 11Z body, leaving a bare ---)
    a section with no matching entry    (a typo would otherwise read as a close)

THE RULE
--------
A commit whose subject names an entry AND uses a closing verb must correspond to a
"## 11<letters>" section naming that entry. A commit that merely touches or discusses an
entry does not have to. The verb list is deliberately narrow: resolve / fix / close / finish.

This is a LEDGER check, not a correctness check. It cannot tell whether the code change was
good; only whether the journal noticed a commit claiming to close something.

EXIT CODES
    0  every closing commit has its section; every section names a defined entry
    1  at least one mismatch (printed with the action needed)

Run from the repo root:  python scripts/check-debt-ledger.py
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEDGER = REPO / "todo-optimize-crates.md"

ID_RE = re.compile(r"\bO-[HMLT]\d+\b")
CLOSING_VERBS = ("resolve", "fix", "close", "finish")
# Two heading shapes have carried a resolution in this journal, and both are honoured:
#   "## <sect>11XX -- O-XXX resolved: ..."   the numbered-sect convention
#   "## 11. Round 6 (...) -- O-T05 executed" the older round convention
# The second is what O-T05 shipped under. A checker that knew only the first reported a
# real, documented close as a gap -- the same false positive this script exists to avoid,
# just in the other direction.
SECTION_RE = re.compile(r"^## (?:\u00a711[A-Z]*|11\.)\s.*$", re.MULTILINE)


def git(*args: str) -> str:
    """Run a git command from the repo root and return stdout (empty on failure)."""
    out = subprocess.run(
        ["git", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return out.stdout if out.returncode == 0 else ""


def defined_entries(text: str) -> set[str]:
    """Every id that has an entry header in the journal."""
    return {
        m.group(1)
        for line in text.splitlines()
        for m in [re.match(r"^\*\*?(O-[HMLT]\d+)", line)]
        if m
    }


def sections(text: str) -> list[tuple[str, str]]:
    """Split the journal into (heading, body) pairs for every numbered section."""
    matches = list(SECTION_RE.finditer(text))
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append((m.group(0), text[m.end():end]))
    return out


def is_closing_subject(subject: str) -> bool:
    """True when a commit subject names an entry AND claims to close it."""
    lowered = subject.lower()
    return bool(ID_RE.search(subject)) and any(v in lowered for v in CLOSING_VERBS)


# A resolved entry may be marked TWO ways in this journal, and both are legitimate:
#   (a) a "## <sect> -- O-XXX resolved: ..." section, the original convention;
#   (b) an inline marker in the entry body: "PAID", "resolved", "Fixed:" ...
# Convention (b) appeared later and is what O-H03/O-H04/O-H08 used. A checker that
# only knew (a) would flag those three as gaps forever, and one that only knew (b)
# would miss a commit whose section was never written. Both are read here.
INLINE_CLOSE_RE = re.compile(r"\b(PAID|RESOLVED|FIXED|DONE)\b|\bFixed:", re.IGNORECASE)


def entries_marked_inline(text: str) -> set[str]:
    """Ids whose own entry body carries a close marker within its first few lines."""
    out: set[str] = set()
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^\*\*?(O-[HMLT]\d+)", line)
        if not m:
            continue
        body = "\n".join(lines[i:i + 8])
        if INLINE_CLOSE_RE.search(body):
            out.add(m.group(1))
    return out


def main() -> int:
    try:
        text = LEDGER.read_text(encoding="utf-8")
    except FileNotFoundError:
        print("check-debt-ledger: todo-optimize-crates.md not found")
        return 1

    defined = defined_entries(text)
    heads = sections(text)
    inline_marked = entries_marked_inline(text)

    # Check 1: a closing commit must have its section.
    log = git("log", "--format=%h\x01%s", "-n", "4000")
    missing: dict[str, list[str]] = {}
    for line in log.splitlines():
        if "\x01" not in line:
            continue
        sha, subject = line.split("\x01", 1)
        if not is_closing_subject(subject):
            continue
        for entry in set(ID_RE.findall(subject)):
            if entry in inline_marked:
                continue
            if not any(entry in heading for heading, _ in heads):
                missing.setdefault(entry, []).append(sha + " " + subject)

    # Check 2: every section should name a defined entry.
    unknown: list[tuple[str, str]] = []
    for heading, _body in heads:
        ids = set(ID_RE.findall(heading))
        if not ids:
            unknown.append((heading, "names no entry id at all"))
        for entry in sorted(ids - defined):
            unknown.append((heading, "names " + entry + ", which has no entry header"))

    # Check 3: effectively-empty bodies (the deletion shape).
    gutted = [
        (heading, body)
        for heading, body in heads
        if len(re.sub(r"[-\s]", "", body)) < 40
    ]

    ok = True

    if missing:
        ok = False
        print("FAIL: " + str(len(missing)) + " entr(y/ies) closed by a commit with no section:")
        for entry, commits in sorted(missing.items()):
            print("  " + entry)
            for c in commits[:3]:
                print("      " + c)
        print("  -> add a section naming it, or the entry keeps reading as open.")

    if unknown:
        ok = False
        print("")
        print("FAIL: " + str(len(unknown)) + " section problem(s):")
        for heading, why in unknown:
            print("  " + heading[:70])
            print("      " + why)

    if gutted:
        ok = False
        print("")
        print("FAIL: " + str(len(gutted)) + " section(s) with an effectively empty body:")
        for heading, body in gutted:
            print("  " + heading[:70])
            print("      body is " + str(len(body.strip())) + " chars")

    if ok:
        print("check-debt-ledger: OK - " + str(len(defined)) + " entries defined, "
              + str(len(heads)) + " sections, every closing commit has its section.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
