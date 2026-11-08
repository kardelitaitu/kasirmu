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


def cli_shell_cases() -> list[str]:
    """The exit contract of main(), graded against temp files (r158 -- the
    limit r157 named). The mutation survey grades the pure classifier only;
    these cases are the CLI shell's graded surface. Temp files live outside
    the repo tree, so the tree stays untouched. Returns failure descriptions;
    [] = every case held."""
    import contextlib
    import io
    import tempfile
    fails: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        def run(argv, text):
            p = Path(td) / "missing.md" if text is None else Path(td) / "reg.md"
            if text is not None:
                p.write_text(text, encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv, p)
            return rc, out.getvalue(), err.getvalue()
        E = "### Round %d (2026-11-08) -- t\n%s"
        body = "Work done.\n\nHonest limits: none.\n"
        clean = (E % (144, body)) + "\n"
        dirty = (E % (144, body)) + "\n" + (E % (146, body)) + "\n"
        rc, out, err = run(["prog"], None)
        if rc != 2 or "REFUSED" not in err:
            fails.append("a missing register must exit 2 with a REFUSED line (got rc=%d)" % rc)
        rc, out, err = run(["prog"], dirty)
        if rc != 1 or "1 register hygiene finding(s)" not in out or "round 146 follows 144" not in out:
            fails.append("findings must exit 1 and name themselves (got rc=%d)" % rc)
        rc, out, err = run(["prog"], clean)
        if rc != 0 or "register hygiene OK" not in out:
            fails.append("a clean register must exit 0 with the OK line (got rc=%d)" % rc)
        rc, out, err = run(["prog", "--quiet"], clean)
        if rc != 0 or out != "":
            fails.append("--quiet must stay exit 0 and print nothing (got rc=%d out=%r)" % (rc, out))
    return fails


def main(argv: list[str] | None = None, register_path: Path = REGISTER) -> int:
    """The gate's CLI shell, parameterized for the self-test (r158): argv
    defaults to sys.argv, register_path to the real register. The exit
    contract: 0 clean, 1 findings, 2 REFUSED (register missing)."""
    argv = sys.argv if argv is None else argv
    if "--self-test" in argv:
        cli_fails = cli_shell_cases()
        for line in cli_fails:
            print("FAIL %s" % line)
        cases = build_cases()
        for name, got, want in cases:
            if got != want:
                print("FAIL %s: got %r want %r" % (name, got, want))
                return 1
        if cli_fails:
            return 1
        print("SELF-TEST OK (%d classifier cases + %d CLI-shell cases;"
              " the repo tree is untouched)" % (len(cases), 4))
        return 0
    if not register_path.is_file():
        print("REFUSED: register missing at %s" % register_path, file=sys.stderr)
        return 2
    text = register_path.read_text(encoding="utf-8")
    findings = register_findings(text)
    if findings:
        print("%d register hygiene finding(s):" % len(findings))
        for tag, msg in findings:
            print("  [%s] %s" % (tag, msg))
        return 1
    if not any(a == "--quiet" for a in argv):
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
