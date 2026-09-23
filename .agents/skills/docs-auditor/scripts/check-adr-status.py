#!/usr/bin/env python3
"""check-adr-status.py -- the decisions hand table's status word vs each ADR's own status.

docs/decisions/README.md carries a hand-maintained status table over the ADRs, and its
own Conventions section states the contract: "The Status column's *status word* must
match the ADR's own YAML frontmatter `status:`" -- Proposed / Accepted / Approved /
Implemented / Partially Implemented / Superseded / Re-scoped -- while what follows the
word may be abbreviated, extended, or replaced by a link to a companion `*.status.md`.
The same section records that the column has been repaired by hand three times
(2026-08-09: 26 rows read empty while every file already had a status; 2026-09-23:
#55/#56/#58 trailing their re-audited frontmatter) and orders: "Re-derive the column
with a script that reads the frontmatter, never by hand." This is that script
(2026-09-24, open item 2 of the 2026-09-23 documentation audit).

RULES, each bought with a real row:

  * Status WORD, not status text: compare what precedes the first ` (`, ` --` (em
    dash), or ` - `; everything after may differ. Rows #19/#20 append a companion
    status link, #47 narrates its ruling, #39 adds a todo pointer -- none of that is
    the verdict, and diffing full strings would cry wolf on every one of them.
  * Frontmatter beats the header `**Status:**` line, mirroring the generator's
    extractStatus order: #53's header line still opens `Proposed 2026-09-15. Nothing
    here is implemented` while its frontmatter, re-audited 2026-09-23, says `Adopted`,
    and the table correctly follows the frontmatter.
  * Rows resolve by FILE PATH, never by number: #43 has been two files since
    2026-09-02 (the collision is documented at the top of that table; renaming either
    file would break the 37 citations counted there), so each row is checked against
    the file it links -- never the other #43.
  * Only the numbered table. The "Trial & Billing Path -- Cross-Reference" table below
    it is a prose summary (its #5 cell opens `Superseded for tier lineup/quotas by ...`),
    and prose is not the status-word contract. Its first cell is a link, not a digit,
    so `^|\\s*\\d+` excludes it without a second rule.
  * A row whose file cannot be read, or which carries no status at all, is a FINDING:
    cannot-verify is not agreement. An empty cell (`--`) is also a finding: the table
    claiming to know nothing while the file states a verdict is exactly the 26-row
    state this checker exists to end.
  * Zero parsed rows is a failure, not a pass: a table the regex cannot read is a
    mangled table, and green-on-nothing is the failure mode every checker here is
    built to avoid.

Exit: 0 green, 1 drift (or unverifiable row / unparsable table), 2 self-failure.

Usage:
  python3 .agents/skills/docs-auditor/scripts/check-adr-status.py
  python3 .agents/skills/docs-auditor/scripts/check-adr-status.py path/to/README.md
  python3 .agents/skills/docs-auditor/scripts/check-adr-status.py --self-test
"""

import re
import sys
from pathlib import Path

DEFAULT_README = Path("docs/decisions/README.md")

# The numbered table only: `| N | [Title](path) | status cell |`. Greedy (.*) keeps a
# cell that itself contains `](...)` (rows #19/#20 link a companion status file).
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.*)\|\s*$")

# The status WORD cut points, from the Conventions contract: what precedes the first
# ` (`, ` —`, or ` - ` is the verdict; everything after it is allowed to differ.
CUTS = (" (", " \u2014", " - ")

FM_STATUS_RE = re.compile(r"^([A-Za-z_-]+):\s*(.*)$")
HEADER_STATUS_RES = (
    re.compile(r"^>\s*\*\*Status:\*\*\s*(.+)$", re.M),
    re.compile(r"^\*\*Status:\*\*\s*(.+)$", re.M),
    re.compile(r"^Status:\s*(.+)$", re.M),
)


def _strip_quotes(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def normalize(text):
    return text.replace("\r\n", "\n").replace("\r", "\n")


def status_word(s):
    """The status WORD: text before the first ` (`, ` —`, or ` - ` (Conventions)."""
    s = s.strip()
    idxs = [i for i in (s.find(c) for c in CUTS) if i > 0]
    return (s[:min(idxs)] if idxs else s).strip()


def frontmatter_status(text):
    """YAML-ish front matter `status:` -- generator parity (frontMatter())."""
    lines = normalize(text).split("\n")
    if not lines or lines[0] != "---":
        return None
    for ln in lines[1:]:
        if ln == "---":
            return None
        m = FM_STATUS_RE.match(ln)
        if m and m.group(1).lower() == "status":
            return _strip_quotes(m.group(2))
    return None


def header_status(text):
    """`> **Status:**` / `**Status:**` / `Status:` -- the generator's extractStatus order."""
    t = normalize(text)
    for rx in HEADER_STATUS_RES:
        m = rx.search(t)
        if m:
            return m.group(1).strip()
    return None


def own_status(text):
    """Frontmatter first: the table follows it, and so does this (see #53)."""
    return frontmatter_status(text) or header_status(text)


def parse_rows(readme_text):
    """[(line, num, path, cell)] for the numbered table; cross-reference rows excluded."""
    out = []
    for n, ln in enumerate(normalize(readme_text).split("\n"), 1):
        m = ROW_RE.match(ln)
        if m:
            out.append((n, int(m.group(1)), m.group(3), m.group(4).strip()))
    return out


def compare(readme_text, files):
    """Pure core: (table text, {row path -> file text or None}) -> findings.

    Split out so --self-test drives the real comparison with synthetic fixtures and
    touches no file on disk (check-nav-paths.py's rule: a self-test that mutates the
    tree can damage the thing it is policing).
    """
    findings = []
    for line_no, num, path, cell in parse_rows(readme_text):
        key = path[2:] if path.startswith("./") else path
        text = files.get(key)
        if text is None:
            findings.append((line_no, num, path,
                             "file missing or unreadable -- cannot verify"))
            continue
        own = own_status(text)
        if not own:
            findings.append((line_no, num, path,
                             "file states no status at all; table cell says %r"
                             % status_word(cell)))
            continue
        tw, fw = status_word(cell), status_word(own)
        if tw.lower() != fw.lower():
            findings.append((line_no, num, path,
                             "status word drifted: table=%r vs file=%r" % (tw, fw)))
    return findings


def self_test():
    # Synthetic fixtures, deliberately (check-nav-paths.py's rule): these pin the
    # comparison logic; the live table is one main() away. Two cases are expected to
    # FIND -- one drift, one unverifiable -- so a checker that reports nothing cannot
    # pass its own test (the failure mode that hid the empty character-class bug in
    # check-dead-refs' first session).
    head = "| # | Title | Status |\n|---|-------|--------|\n"

    def table(*rows):
        return head + "".join(r + "\n" for r in rows)

    f_impl = "---\nnum: 54\nstatus: Implemented (2026-09-19)\n---\n# x\n"
    f_prop = "---\nnum: 57\nstatus: Proposed (2026-09-21) \u2014 part implemented\n---\n"
    f_partial = "---\nnum: 13\nstatus: Partially Implemented (2026-07-16)\n---\n"
    f_adopt = ("---\nnum: 53\nstatus: Adopted (2026-09-15) \u2014 Option A implemented\n---\n"
               "# x\n**Status:** Proposed 2026-09-15. Nothing here is implemented.\n")
    f_hdr_agrees_fm_drifts = ("---\nnum: 9\nstatus: Implemented (2026-01-01)\n---\n"
                              "**Status:** Accepted\n")
    f_43a = "---\nnum: 43\nstatus: Accepted (2026-07-24)\n---\n"
    f_43b = "---\nnum: 43\nstatus: Implemented (D1\u2013D4, D7, D9-ready) \u2014 rest deferred\n---\n"

    cases = []
    cases.append(("matching status word is clean",
                  len(compare(table("| 57 | [T](./a.md) | Proposed (2026-09-21) \u2014 part implemented |"),
                              {"a.md": f_prop})) == 0))
    cases.append(("table Proposed vs file Implemented is reported",
                  len(compare(table("| 54 | [T](./a.md) | Proposed (2026-09-19) \u2014 nothing implemented |"),
                              {"a.md": f_impl})) == 1))
    cases.append(("what follows the status word may differ (companion link)",
                  len(compare(table("| 54 | [T](./a.md) | Implemented (see [status](./a.status.md)) |"),
                              {"a.md": f_impl})) == 0))
    cases.append(("status word compares case-insensitively",
                  len(compare(table("| 13 | [T](./a.md) | partially implemented (2026-07-16) \u2014 UI live |"),
                              {"a.md": f_partial})) == 0))
    cases.append(("duplicate #43 checks each row against its own file",
                  len(compare(
                      table("| 43 | [A](./a.md) | Accepted (2026-07-24) |",
                            "| 43 | [B](./b.md) | Implemented (D1\u2013D4) |"),
                      {"a.md": f_43a, "b.md": f_43b})) == 0))
    cases.append(("frontmatter wins over a stale header line",
                  len(compare(table("| 53 | [T](./a.md) | Adopted (2026-09-15) \u2014 Option A implemented |"),
                              {"a.md": f_adopt})) == 0))
    cases.append(("header agreeing is not enough when frontmatter disagrees",
                  len(compare(table("| 9 | [T](./a.md) | Accepted (2026-07-24) |"),
                              {"a.md": f_hdr_agrees_fm_drifts})) == 1))
    cases.append(("a row whose file cannot be read is reported",
                  len(compare(table("| 9 | [T](./gone.md) | Proposed |"),
                              {"gone.md": None})) == 1))
    cases.append(("cross-reference prose rows are not numbered rows",
                  len(parse_rows("| [#5](./a.md) | Title | Superseded for tier lineup/quotas by x | dev |")) == 0))
    cases.append(("' - ' cuts the word like ' (' and ' \u2014'",
                  status_word("Accepted (2026-09-11) - partially implemented") == "Accepted"))
    bad = [n for n, ok in cases if not ok]
    if bad:
        print("SELF-TEST WRONG: " + ", ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, no files touched)" % len(cases))
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    target = Path(argv[0]) if argv and not argv[0].startswith("-") else DEFAULT_README
    try:
        readme = normalize(target.read_text(encoding="utf-8"))
    except OSError as exc:
        print("cannot read %s: %s" % (target, exc), file=sys.stderr)
        return 2

    rows = parse_rows(readme)
    if not rows:
        print("check-adr-status: no numbered rows parsed from %s -- a table this\n"
              "checker cannot read is not a table this checker can clear."
              % target, file=sys.stderr)
        return 1

    base = target.parent
    files = {}
    for _, _, path, _ in rows:
        key = path[2:] if path.startswith("./") else path
        try:
            files[key] = (base / key).read_text(encoding="utf-8", errors="replace")
        except OSError:
            files[key] = None

    findings = compare(readme, files)
    for line_no, num, path, detail in findings:
        print("  L%-5d #%-3d %s" % (line_no, num, path))
        print("        %s" % detail)
    if findings:
        print("")
    print("check-adr-status: %d status drift finding(s) across %d hand-table row(s)."
          % (len(findings), len(rows)))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
