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

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Shell scripts where a shell verdict is read. check.sh decides whether the whole
#: matrix passes, so it is the one that matters most.
#: Shell scripts where a shell verdict is read. check.sh decides whether the whole
#: matrix passes. The rest are every tracked .sh under scripts/ and .agents/ -- a checker
#: scoped to one file grades one file, and the shape is not confined to the matrix
#: (measured: 57 tracked .sh files, 2 of them carry a conditional substitution, and the
#: second one is outside the original two-file list).
TARGET_DIRS = ("scripts", ".agents")
#: Excluded by name: retired, vendored, or not shell.
SKIP_NAMES = ("check.sh.bak", "ci.yml.bak")

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
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    print("SELF-TEST OK (%d cases, no file read)" % len(CASES))
    return 0


def targets() -> list[Path]:
    """Every tracked shell script under TARGET_DIRS, sorted."""
    out: list[Path] = []
    for d in TARGET_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*.sh")):
            if any(s in p.name for s in SKIP_NAMES):
                continue
            if "attic" in {q.lower() for q in p.parts}:
                continue
            out.append(p)
    return out


def main() -> int:
    bad: list[str] = []
    for p in targets():
        bad.extend(findings_in(p.read_text(encoding="utf-8", errors="replace"),
                               p.relative_to(ROOT).as_posix()))
    for line in bad:
        print("  " + line)
    if bad:
        print("check-pipeline-verdicts: %d condition(s) read the wrong command's status."
              % len(bad))
        print("  A pipeline exits with its LAST command's status. Test the RESULT")
        print("  (if [ -n \"$var\" ]), not the substitution.")
        return 1
    print("check-pipeline-verdicts: OK - no condition reads a swallower's status")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(main())
