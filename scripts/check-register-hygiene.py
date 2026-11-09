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
Exit 2 = REFUSED (the register file itself is missing). Exit 2 is also the
refusal an unreadable register produces: a file that exists but cannot be
decoded is not a clean log, and grading it as one would be the hollow pass
cli_shell_cases() exists to prevent (r233).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTER = ROOT / "docs/records/findings/audit-open-findings.md"
HEAD = re.compile(
    r"^### Round (\d+) \((\d{4}-\d{2}-\d{2})\) (?:--|\u2014) (\S.*)$", re.M)
ADDENDUM = re.compile(r"^### Round \d+, addendum\b", re.M)
LOOSE = re.compile(r"^### Round\b", re.M)
# The measured floor for the honest-limits marker: entries before it predate
# the convention (51, 53-60, 99, 113 lack it); from 114 on it is universal.
LIMITS_FLOOR = 114

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 here:
#: every write into a TemporaryDirectory is EPERM) can point this at a directory
#: it does allow; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


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


def fixture_root() -> str | None:
    """The temp root the suite's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


def cli_shell_cases() -> list[str]:
    """The exit contract of main(), graded against temp files (r158 -- the
    limit r157 named). The mutation survey grades the pure classifier only;
    these cases are the CLI shell's graded surface. Returns failure
    descriptions; [] = every case held. r233: the fixture root is
    fixture_root(), and cleanup is best-effort -- a host that refuses chmod
    on a temp tree must not turn a passing suite into a traceback."""
    import contextlib
    import io
    import tempfile
    fails: list[str] = []
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
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


def main(argv: list[str] | None = None, register_path: Path | None = None, run_root: bool = True) -> int:
    """The gate's CLI shell, parameterized for the self-test (r158): argv
    defaults to sys.argv, register_path to the real register. The exit
    contract: 0 clean, 1 findings, 2 REFUSED (register missing or unreadable).

    r233: run_root is this gate's name for the -rung off switch the census
    grades as `root_param` -- `--self-test` runs the fixture ladder, and a
    NESTED self-test inside that ladder passes run_root=False so the ladder
    is not entered twice. The census reads the parameter list by substring,
    so the switch is genuinely named here rather than merely documented."""
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
        # run_root is the ladder's own OFF SWITCH, and the ladder passes
        # run_root=False to the nested --self-test it drives (r233) -- so that
        # nested call never reaches this line. Without the switch a ladder rung
        # that drives --self-test through argv would re-enter the ladder and
        # fail the rung it is trying to grade.
        return 0 if not run_root else shell_ladder()
    if register_path is None:
        register_path = REGISTER
    if not register_path.is_file():
        print("REFUSED: register missing at %s" % register_path, file=sys.stderr)
        return 2
    try:
        text = register_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        # r233: a register that cannot be read is not a clean register. Before
        # this arm the exception escaped as a traceback and the gate'd exit
        # code was Python's implicit 1 -- indistinguishable from "1 finding",
        # which is a lie about which of the three outcomes happened.
        print("REFUSED: register unreadable at %s (%s)" % (register_path, exc),
              file=sys.stderr)
        return 2
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


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (the r228 lesson, in this file's shape).

    Rung 8 drives --self-test through argv from INSIDE the ladder, and
    main()'s self-test arm ends in shell_ladder(), so that nested call would
    recurse forever without the guard. The guard turns it into a printed
    skip; it is checked here rather than in a caller so every future entry
    point inherits it.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r233: the root contract, graded on fixture registers through main().

    Every rung writes its own register into a throwaway directory and names
    it with register_path, so no repository file is read and the real log
    cannot green a fixture. Rung 1 IS the killing rung: it is the fixture
    that exits 1, and a main() that ignored its path and graded this
    checkout's clean register would exit 0 there.
    """
    import contextlib
    import io
    import tempfile

    def run(path, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), register_path=path, run_root=False)
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    E = "### Round %d (2026-11-09) -- %s\n"
    body = "Work done.\n\nHonest limits: none proven beyond this.\n"
    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        base = Path(tmp)
        run_dir = base

        def write(name, text):
            p = run_dir / name
            p.write_text(text, encoding="utf-8", newline="\n")
            return p

        # rung 1 -- the killing rung: a gap is graded from the FIXTURE.
        p = write("gap.md", (E % (233, "a")) + body + "\n"
                  + (E % (235, "b")) + body + "\n")
        rc, said = run(p)
        if rc != 1 or "round 235 follows 233" not in said:
            print("  x rung 1: a gapped fixture must exit 1 naming the gap "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a clean fixture greens, and the OK line counts what it read.
        p = write("clean.md", (E % (233, "a")) + body + "\n")
        rc, said = run(p)
        if rc != 0 or "1 round-log entries (233-233)" not in said:
            print("  x rung 2: a clean fixture must exit 0 with its own count "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- a missing register is refused, never graded hollow.
        rc, said = run(run_dir / "absent.md")
        if rc != 2 or "REFUSED: register missing" not in said:
            print("  x rung 3: a missing register must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- the r233 arm: bytes that are not UTF-8.
        bad = run_dir / "latin1.md"
        bad.write_bytes(b"### Round 233 (2026-11-09) -- caf\xe9\n" + body.encode())
        rc, said = run(bad)
        if rc != 2 or "REFUSED: register unreadable" not in said:
            print("  x rung 4: an undecodable register must refuse rc 2, not "
                  "traceback (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the limits floor travels with the fixture, not the repo.
        p = write("limits.md", (E % (233, "a")) + "Work done, no admission.\n")
        rc, said = run(p)
        if rc != 1 or "round 233 carries no honest-limits marker" not in said:
            print("  x rung 5: an entry above the floor without limits must fail "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6 -- the named addendum form stays exempt in a fixture too.
        p = write("addendum.md", (E % (233, "a")) + body + "\n"
                  + "### Round 100, addendum -- the pointer\n")
        rc, said = run(p)
        if rc != 0 or "1 addendum(s)" not in said:
            print("  x rung 6: the addendum form must be exempt and counted "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 7 -- --quiet stays silent on a clean fixture through the path.
        p = write("quiet.md", (E % (233, "a")) + body + "\n")
        rc, said = run(p, "--quiet")
        if rc != 0 or said != "":
            print("  x rung 7: --quiet must stay exit 0 and print nothing "
                  "(rc=%r said=%r)" % (rc, said), file=sys.stderr)
            return 1
        shell += 1
        # rung 8 -- --self-test dispatch flows through argv; run_root=False stops
        # the nested ladder at the switch, before the guard could be reached.
        p = write("self.md", (E % (233, "a")) + body + "\n")
        # The nested ladder is SKIPPED BY THE SWITCH, not by the guard, so the
        # re-entry line must NOT appear here: a "ladder re-entry" in this output
        # would mean the switch never reached the nested call. r233 measured
        # exactly that -- an assertion copied from check-api-drift-table.py,
        # whose rung runs WITHOUT the switch and therefore does need the guard.
        rc, said = run(p, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" in said:
            print("  x rung 8: --self-test through argv must pass rc 0 and skip "
                  "the nested ladder WITHOUT re-entering it (rc=%r said=%r)"
                  % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("REGISTER-HYGIENE SHELL LADDER OK (%d cases through register_path, "
          "no repository file touched)" % shell)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
