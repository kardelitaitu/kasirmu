#!/usr/bin/env python3
"""check-pipeline-verdicts.py -- a condition whose exit code comes from the wrong command.

WHY THIS EXISTS
--------------
A shell pipeline exits with the status of its LAST command, so this is ALWAYS TRUE
whatever grep finds:

    if summary=$(printf '%s\n' "$out" | grep -E '...' | tail -1); then

because `tail` succeeds on empty input. The branch meant to handle "grep matched
nothing" is unreachable, and the failure is silent: the code still runs and still
prints, only the CONTENT is wrong (an empty variable, a message that never appears).

Measured 2026-10-23 in scripts/check.sh's cargo-deny summary block: with input that
matched nothing the if still took the true branch, so the else printing "cargo-deny
reported no failures" could never run. Both branches print PASS, so every run looked
healthy.

The same trap produced a false ALARM this round in the other direction:

    cmd | Tee-Object f | Select-Object -Last N

reports the exit code of Select-Object, so a migration that printed "migrations up to
date" read as exit 1. Position is not evidence: capture $LASTEXITCODE in the same
statement, and never read a verdict from the last line of a pipeline.

WHAT IT CHECKS
--------------
`if name=$(... | tail|head|sed|awk ...)` and the same shape in while/elif, where the
command substitution hides which command supplied the status.

EXIT CODES
    0  no condition reads a swallower's exit code
    1  findings
"""

from __future__ import annotations

import contextlib
import io
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


#: Shell scripts where a shell verdict is read. check.sh decides whether the whole
#: matrix passes, so it is the one that matters most.
#: Shell scripts where a shell verdict is read. check.sh decides whether the whole
#: matrix passes. The rest are every tracked .sh under scripts/ and .agents/ -- a checker
#: scoped to one file grades one file, and the shape is not confined to the matrix
#: (measured: 57 tracked .sh files, 2 of them carry a conditional substitution, and the
#: second one is outside the original two-file list).
TARGET_DIRS = ("scripts", ".agents", "apps", "ops", "website")
#: Excluded by name: a retired copy of a live script. Measured 2026-10-23 -- there is
#: currently no *.sh.bak and no .sh under attic/, so this excludes nothing today. It
#: stays because the exclusion is a RULE (a retired file is not a verdict), and adding
#: it later would be a silent behaviour change.
SKIP_NAMES = (".bak",)

#: Commands that succeed on empty input, so their status is meaningless as a verdict.
SWALLOWERS = ("tail", "head", "sed", "awk", "cat", "wc", "sort", "uniq", "true")

#: `if name=$(...)` / `elif name=$(...)`. The substitution is what hides the status.
# The substitution need NOT close on the same line: check.sh wraps a long pipeline
# `elif` never starts a line: it follows `... ; then :; `. Anchored on
# the line start this missed the elif half of the rule entirely -- measured 2026-10-23,
# where the `elif is graded too` case came back with 0 findings.
ASSIGN_HEAD_RE = re.compile(r"(?:^|;)\s*(?:if|elif)\s+[A-Za-z_][A-Za-z0-9_]*=\$\((.*)$")


def last_command(sub: str) -> str:
    """The command whose exit code the condition actually reads."""
    parts: list[str] = []
    buf: list[str] = []
    quote = ""
    for ch in sub:
        if quote:
            if ch == quote:
                quote = ""
            buf.append(ch)
            continue
        if ch in '"' + chr(39):
            quote = ch
            buf.append(ch)
            continue
        if ch == "|":
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    parts.append("".join(buf))
    return parts[-1].strip()


def swallower(cmd: str) -> str | None:
    """Which swallower this command is, or None when it is a real verdict."""
    head = cmd.strip().split()
    if not head:
        return None
    for s in SWALLOWERS:
        if head[0] == s:
            return s
    return None


def logical_lines(text: str) -> list[tuple[int, str]]:
    """Backslash-continued lines joined, with the first line's number kept."""
    out: list[tuple[int, str]] = []
    buf: list[str] = []
    start = 0
    for i, line in enumerate(text.split("\n"), 1):
        if not buf:
            start = i
        if line.rstrip().endswith("\\"):
            buf.append(line.rstrip()[:-1])
            continue
        buf.append(line)
        out.append((start, "".join(buf)))
        buf = []
    if buf:
        out.append((start, "".join(buf)))
    return out


def findings_in(text: str, where: str) -> list[str]:
    out: list[str] = []
    for i, line in logical_lines(text):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = ASSIGN_HEAD_RE.search(line)
        if not m:
            continue
        sub = m.group(1)
        # Drop the trailing `) ; then` that closes the substitution.
        cut = sub.find(")")
        if cut != -1:
            sub = sub[:cut]
        last = last_command(sub)
        s = swallower(last)
        if s:
            out.append("%s:%d conditions on the status of `%s`, which succeeds on "
                       "empty input -- so the branch is always taken"
                       % (where, i, s))
    return out


#: Synthetic scripts. Each is a shape the detector must classify. The FIRST shape is
#: the bug that shipped; the rest are the neighbours a loose regex would misread.
CASES = [
    # The bug: the substitution ends in tail, so the status is tail's.
    ("the shipped bug", "if s=$(printf '%s\\n' \"$o\" | grep -E 'x ok' | tail -1); then\n  echo hi\nfi\n", 1),
    # Same shape wrapped across a backslash continuation -- a line-anchored regex missed
    # exactly this, measured 2026-10-23.
    ("the same bug, wrapped", "if s=$(printf '%s\\n' \"$o\" \\\n  | grep -E 'x ok' | tail -1); then\n  echo hi\nfi\n", 1),
    # head and sed swallow status the same way.
    ("head as the last command", "if s=$(cmd | head -1); then\n  echo hi\nfi\n", 1),
    # elif is the same rule.
    ("elif is graded too", "if [ -n \"$a\" ]; then :; elif s=$(cmd | tail -1); then :; fi\n", 1),
    # NOT a finding: the substitution's last command is a real verdict.
    ("grep -q as the last command is a real verdict", "if s=$(cmd | grep -q pat); then\n  echo hi\nfi\n", 0),
    # NOT a finding: no substitution at all.
    ("a plain command is not graded", "if [ -n \"$a\" ]; then\n  echo hi\nfi\n", 0),
    # NOT a finding: a pipe inside a quoted argument is not a pipeline.
    ("a quoted pipe is an argument", "if s=$(grep 'a|b' f | tail -1); then\n  echo hi\nfi\n", 1),
    # NOT a finding: the swallower is not LAST.
    ("tail in the middle is harmless", "if s=$(cmd | tail -1 | grep -q x); then\n  echo hi\nfi\n", 0),
    # NOT a finding: a comment.
    ("a comment is skipped", "# if s=$(cmd | tail -1); then\n", 0),
]


def self_test() -> int:
    bad: list[str] = []
    for name, text, want in CASES:
        got = len(findings_in(text, "fixture"))
        if got != want:
            bad.append("  %s: expected %d finding(s), got %d" % (name, want, got))
    # The VERDICT half: before 2026-11-06 an empty sweep exited 0, so these three states
    # were indistinguishable from a clean tree. 0 files is a refusal -- 2 -- whatever the
    # findings say.
    for scanned, findings, want in ((0, 0, 2), (0, 3, 2), (71, 0, 0), (71, 1, 1)):
        got = verdict(scanned, findings)
        if got != want:
            bad.append("  verdict(%d file(s), %d finding(s)): expected %d, got %d"
                       % (scanned, findings, want, got))
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    # r188: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r187 pattern. No git repository needed (the sweep rglobs).
    # The refusal and finding cases both kill a root-dropping main: the real
    # tree has scripts/ and is clean, so it returns 0 against want 2 and
    # want 1 alike.
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    def _shell(files):
        with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                           ignore_cleanup_errors=True) as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding='utf-8')
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    # quote-free shell text: the detector reads the tail POSITION, not the words
    BUG = 'if s=$(myprog | tail -1); then\n  echo hi\nfi\n'
    shell += 1
    rc, text = _shell({'scripts/bad.sh': BUG})
    needle = "conditions on the status of " + chr(96) + "tail" + chr(96)
    if rc != 1 or "scripts/bad.sh:1" not in text or needle not in text:
        print('  x a swallower verdict must be a finding naming file:line (rc=%r text=%r)' % (rc, text[-90:]),
              file=sys.stderr)
        return 1
    shell += 1
    OKSH = chr(39).join(["if [ -n ", "$a", " ]; then"]) + chr(10) + "  echo hi" + chr(10) + "fi"
    rc, text = _shell({"scripts/ok.sh": OKSH})
    if rc != 0 or "(1 shell script(s) read)" not in text:
        print('  x a clean script must read as clean (rc=%r text=%r)' % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({'README.md': 'no shell scripts'})
    if rc != 2 or "read no .sh file" not in text:
        print('  x an empty sweep must refuse rc 2 (rc=%r text=%r)' % (rc, text[-90:]), file=sys.stderr)
        return 1
    if bad:
        sys.stderr.write("SELF-TEST WRONG:" + chr(10) + chr(10).join(bad) + chr(10))
        return 2
    print("SELF-TEST OK (%d detector cases + 4 verdict cases + %d shell cases)"
          % (len(CASES), shell))
    # The dead second `return 0` that used to sit here is gone: it was
    # unreachable, and this round needs the tail to reach the ladder.
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r242 -- the r228 lesson).

    Rung 5 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. Note this file also dispatches --self-test at __main__ before
    main() is reached; the ladder calls main() directly, so the guard covers
    the path the ladder actually uses.
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
    """r242: the root contract, graded on fixture shell trees through main().

    Rung 1 IS the killing rung. This checkout's 71 shell scripts are clean
    (measured r242: exit 0, "no condition reads a swallower's status"), so a
    main() that ignored its root would print that green against a fixture
    whose only script carries the shipped bug. The fixture must exit 1 and
    name both the file and `tail` -- the swallower it actually read.

    Rung 3 grades the OTHER direction of the same rule, which no rung had
    covered: a swallower that is not LAST is harmless ("tail -1 | grep -q x"),
    because the pipeline's status is then grep's. A detector that flagged any
    swallower anywhere would pass rung 1 and fail here.
    """
    import contextlib
    import io
    import tempfile

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} shell scripts."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline=chr(10))
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    BUG = "if s=$(myprog | tail -1); then\n  echo hi\nfi\n"
    MIDDLE = "if s=$(myprog | tail -1 | grep -q x); then\n  echo hi\nfi\n"
    CLEAN = "if [ -n \"$a\" ]; then\n  echo hi\nfi\n"
    NEEDLE = "conditions on the status of " + chr(96) + "tail" + chr(96)

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the fixture's bug is named, file and swallower.
        root = build(tmp, {"scripts/bad.sh": BUG})
        rc, said = run(root)
        if rc != 1 or "scripts/bad.sh:1" not in said or NEEDLE not in said:
            print("  x rung 1: a fixture swallower verdict must exit 1 naming file:line "
                  "and the swallower (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a clean fixture greens and counts the FIXTURE corpus.
        root = build(tmp, {"scripts/ok.sh": CLEAN})
        rc, said = run(root)
        if rc != 0 or "(1 shell script(s) read)" not in said:
            print("  x rung 2: a clean fixture must exit 0 counting one script "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- position matters: a swallower NOT last is harmless.
        root = build(tmp, {"scripts/mid.sh": MIDDLE})
        rc, said = run(root)
        if rc != 0 or "(1 shell script(s) read)" not in said:
            print("  x rung 3: a swallower in the middle must not be a finding "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- the refusal floor: no .sh under the fixture root.
        base = Path(tempfile.mkdtemp(dir=tmp, prefix="empty_"))
        (base / "README.md").write_text("no shell scripts\n", encoding="utf-8")
        rc, said = run(base)
        if rc != 2 or "read no .sh file" not in said:
            print("  x rung 4: a fixture without .sh must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {"scripts/ok.sh": CLEAN})
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 5: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("PIPELINE-VERDICTS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def targets(root=None) -> list[Path]:
    """Every tracked shell script under TARGET_DIRS, sorted. r188: the sweep
    root follows the contract root, and so do the reported relative paths."""
    base_root = ROOT if root is None else Path(root).resolve()
    out: list[Path] = []
    for d in TARGET_DIRS:
        base = base_root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*.sh")):
            if any(s in p.name for s in SKIP_NAMES):
                continue
            if "attic" in {q.lower() for q in p.parts}:
                continue
            out.append(p)
    return out


def verdict(scanned: int, findings: int) -> int:
    """Exit code for a finished sweep: 2 read nothing, 1 a wrong-status read, 0 clean.

    WHY THE CORPUS IS GRADED HERE TOO. Until 2026-11-06 an empty sweep printed
    "OK - no condition reads a swallower's status" and exited 0, because zero findings and
    zero files look identical from inside the loop. Measured by copying this script outside
    the checkout: the five target directories did not exist, the loop body never ran, and
    the gate reported the tree clean. The live tree reads 71 shell scripts.
    """
    if scanned == 0:
        return 2
    return 1 if findings else 0


def main(argv=None, root=None) -> int:
    """r188: argv and root parameterized, the r166..r187 contract -- root
    redirects the sweep AND the reported paths together."""
    if "--self-test" in ([] if argv is None else argv):
        return self_test()
    bad: list[str] = []
    scanned = 0
    base = ROOT if root is None else Path(root).resolve()
    for p in targets(root):
        scanned += 1
        bad.extend(findings_in(p.read_text(encoding="utf-8", errors="replace"),
                               p.relative_to(base).as_posix()))
    if scanned == 0:
        sys.stderr.write(
            "error: read no .sh file under %s, so this run graded nothing and its verdict "
            "would be about an empty corpus rather than about the scripts. The live tree "
            "reads 71.\n" % ", ".join(TARGET_DIRS))
        return 2
    for line in bad:
        print("  " + line)
    if bad:
        print("check-pipeline-verdicts: %d condition(s) read the wrong command's status."
              % len(bad))
        print("  A pipeline exits with its LAST command's status. Test the RESULT")
        print("  (if [ -n \"$var\" ]), not the substitution.")
        return verdict(scanned, len(bad))
    print("check-pipeline-verdicts: OK - no condition reads a swallower's status "
          "(%d shell script(s) read)" % scanned)
    return verdict(scanned, len(bad))


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(main())
