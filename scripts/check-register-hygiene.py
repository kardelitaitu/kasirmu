#!/usr/bin/env python3
"""Register hygiene: the round log in docs/records/findings/audit-open-findings.md
is the audit's own durable record -- one entry appended per round -- and until
now nothing validated its shape. Measured 2026-11-08 before wiring: the log
runs 51..153 (103 entries, zero gaps); the separator is an EM DASH through
round 143 and " -- " from 144 (both accepted -- the glyph is style, not an
invariant); one dateless appendix "### Round 123, addendum" exists and is
exempt by name; the honest-limits convention has a measured FLOOR at 114
(entries 51, 53-60, 99, 113 predate it and are history, not rewritten).

Enforced, per the log:
  - every "### Round" heading is either a full entry (number, ISO date,
    either separator, non-empty title) or the named addendum form;
  - round numbers are strictly consecutive from the first entry, no duplicates;
  - each entry body is non-empty;
  - each entry from round LIMITS_FLOOR on carries a "limits" marker -- the
    honest-limits paragraph is the entry's own admission of what it does NOT
    prove, and an entry without one is a claim pretending to be a record;
  - the file ends with a newline.

Exit 0 = the round log is well-formed. Exit 1 = at least one finding.
Exit 2 = REFUSED (the register file itself is missing).
"""
import re
import sys
from pathlib import Path

REGISTER = Path(__file__).resolve().parents[1] / "docs/records/findings/audit-open-findings.md"
HEAD = re.compile(
    r"^### Round (\d+) \((\d{4}-\d{2}-\d{2})\) (?:--|\u2014) (\S.*)$", re.M)
ADDENDUM = re.compile(r"^### Round \d+, addendum\b", re.M)
LOOSE = re.compile(r"^### Round\b", re.M)
# The measured floor for the honest-limits marker: entries before it predate
# the convention (51, 53-60, 99, 113 lack it); from 114 on it is universal.
LIMITS_FLOOR = 114


def register_findings(text: str) -> list[tuple[str, str]]:
    """All shape findings for the round-log portion of the register. The
    consolidated register before the first round heading is out of scope by
    design -- it predates the log and follows a different convention."""
    out: list[tuple[str, str]] = []
    for m in LOOSE.finditer(text):
        end = text.find("\n", m.start())
        line = text[m.start():end if end != -1 else len(text)]
        if not HEAD.match(line) and not ADDENDUM.match(line):
            out.append(("shape", "heading is neither a full round entry nor the"
                        " named addendum form: " + line.strip()[:70]))
    entries = list(HEAD.finditer(text))
    addenda = len(ADDENDUM.findall(text))
    if not entries:
        out.append(("rounds", "no round-log entries found"))
        return out
    prev = None
    for m in entries:
        num = int(m.group(1))
        if prev is not None and num != prev + 1:
            out.append(("rounds", "round %d follows %d -- gap or duplicate" % (num, prev)))
        prev = num
        nxt = HEAD.search(text, m.end())
        body = text[m.end():nxt.start() if nxt else len(text)]
        if not body.strip():
            out.append(("body", "round %d has an empty body" % num))
        elif num >= LIMITS_FLOOR and "limits" not in body.lower():
            out.append(("limits", "round %d carries no honest-limits marker" % num))
    if not text.endswith("\n"):
        out.append(("newline", "register does not end with a newline"))
    return out


def main() -> int:
    if "--self-test" in sys.argv:
        cases = build_cases()
        for name, got, want in cases:
            if got != want:
                print("FAIL %s: got %r want %r" % (name, got, want))
                return 1
        print("SELF-TEST OK (%d cases, no files touched)" % len(cases))
        return 0
    if not REGISTER.is_file():
        print("REFUSED: register missing at %s" % REGISTER, file=sys.stderr)
        return 2
    text = REGISTER.read_text(encoding="utf-8")
    findings = register_findings(text)
    if findings:
        print("%d register hygiene finding(s):" % len(findings))
        for tag, msg in findings:
            print("  [%s] %s" % (tag, msg))
        return 1
    if not any(a == "--quiet" for a in sys.argv):
        entries = HEAD.findall(text)
        addenda = len(ADDENDUM.findall(text))
        print("register hygiene OK: %d round-log entries (%s-%s), consecutive,"
              " honest-limits from r%d on, %d addendum(s)"
              % (len(entries), entries[0][0], entries[-1][0], LIMITS_FLOOR, addenda))
    return 0


def build_cases():
    E = "### Round %d (2026-11-08) %s t\n%s"
    body = "Work done.\n\nHonest limits: none proven beyond this.\n"
    clean = (E % (144, "--", body)) + "\n" + (E % (145, "\u2014", body)) + "\n"
    def one(text):
        return register_findings(text)
    return [
        ("a clean log, both separators accepted", one(clean), []),
        ("an entry above the floor without limits is a finding",
         one(E % (146, "--", "Work done.\n")),
         [("limits", "round 146 carries no honest-limits marker")]),
        ("an entry below the floor may lack limits",
         one(E % (60, "--", "Work done.\n")),
         []),
        ("a gap is a finding",
         one((E % (144, "--", body)) + "\n" + (E % (146, "--", body)) + "\n"),
         [("rounds", "round 146 follows 144 -- gap or duplicate")]),
        ("a duplicate is a finding",
         one((E % (144, "--", body)) + "\n" + (E % (144, "--", body)) + "\n"),
         [("rounds", "round 144 follows 144 -- gap or duplicate")]),
        ("an empty body is a finding",
         one(clean + "### Round 146 (2026-11-09) -- t\n"),
         [("body", "round 146 has an empty body")]),
        ("a malformed heading is a finding (and empty-log co-finding)",
         one("### Round 144 no date\n"),
         [("shape", "heading is neither a full round entry nor the named"
                    " addendum form: ### Round 144 no date"),
          ("rounds", "no round-log entries found")]),
        ("the dateless addendum form is exempt",
         one(clean + "### Round 123, addendum -- the pointer, now receipted\n"),
         []),
        ("an unknown Round heading shape is a finding",
         one(clean + "### Round 123 addendum no comma\n"),
         [("shape", "heading is neither a full round entry nor the named"
                    " addendum form: ### Round 123 addendum no comma")]),
        ("sector headings before the log are ignored",
         one("### Security / authz-shaped\n\nold prose\n\n" + clean),
         []),
        ("no entries at all is a finding",
         one("just prose"),
         [("rounds", "no round-log entries found")]),
        ("a missing trailing newline is a finding",
         one(clean.rstrip("\n")),
         [("newline", "register does not end with a newline")]),
    ]


if __name__ == "__main__":
    raise SystemExit(main())
