#!/usr/bin/env python3
"""verify-ps-syntax.py -- parse every PowerShell entry point without running it.

WHY
===
The sibling of verify-shell-syntax.py, for the language this repository's Windows
tooling is written in. Both matter for the same reason and both are cheap: a file
that does not parse does not RUN, so every step inside it is skipped, and nothing
anywhere says so.

It is not hypothetical, and it is not a style point. scripts/profile.ps1 shipped
three defects, each of which broke EVERY documented way of invoking it:

  1. A backtick inside a double-quoted string. Backtick is PowerShell's escape
     character, so the closing quote was itself escaped, the string never
     terminated, and the parser reported it 65 lines later as "The string is
     missing the terminator" plus a phantom "Missing closing }".
  2. The parameter was declared [int]$PID. PowerShell's $PID is a READ-ONLY
     automatic variable holding the current process id, so the parameter could
     never bind and even -Help died with "Cannot overwrite variable PID because
     it is read-only or constant".
  3. -List resolved its benchmark directory with a Join-Path that produced a
     CHILD PATH whose ToString is a bare segment, so Get-ChildItem received
     three positional arguments and failed with "A positional parameter cannot be
     found that accepts argument ...".

The .sh twin of that script was repaired months earlier, in f9212ca6a, and
verify-shell-syntax.py was built to catch that class. It never looked at the .ps1,
because PowerShell is a different language with a different parser, and a gate that
pretends one parser covers both is a gate reading a smaller corpus than it claims.

SCOPE
=====
Every tracked *.ps1, wherever it lives -- not a list of directories. 24 of the 26
are under scripts/ and two are ops/install/win/{install,uninstall}.ps1, the Windows
installer pair that runs on a USER's machine, where a parse error breaks the
install rather than a dev tool. That is the reasoning verify-shell-syntax.py already
applies to the Debian postinst/prerm scripts.

WHY A SEPARATE FILE RATHER THAN A FLAG ON verify-shell-syntax.py
===============================================================
Because that gate's scope is deliberate and its docstring says so. Its one scope
rule is is_shell(), which is SHEBANG-based -- a shebang is a fact about a file, a
.sh suffix is a habit -- and PowerShell files carry no shebang at all. Adding a
.ps1 branch would put a parser-per-language switch inside a function whose whole
argument is that one fact-based rule.

HOW IT PARSES
=============
[System.Management.Automation.Language.Parser]::ParseFile, the PowerShell AST
parser: the same one Get-Command uses for a syntax check, and it never executes the
file. Invoked through the host that exists, pwsh preferred over powershell, because a
gate that only runs where pwsh is installed silently stops running everywhere else --
so a machine with neither host is a REFUSAL (exit 2), never a clean report.

WHAT IT DOES NOT SEE
===================
A file can parse cleanly and still be dead on arrival. scripts/profile.ps1 declared
[int]$PID, and $PID is PowerShell's own read-only process id, so the script threw
"Cannot overwrite variable PID because it is read-only or constant" on every single
invocation -- -Help included. The PARSER sees nothing wrong with that; the failure
is at runtime, and the self-test pins the boundary rather than pretending otherwise.
So of the three profile.ps1 defects this gate reports, only the first; the second
needs a checker that reads the declared variable names, and the third needed only
that somebody ran the script. Noted here so the next person does not read "26
PowerShell entry points parse" as "every PowerShell script here works".

Exit 0 all parse, 1 at least one does not, 2 could not run the parser at all or
found no PowerShell to look at.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Kept only as a belt-and-braces skip for the no-git fallback, for the reason
# verify-shell-syntax.py keeps its own list: the git path never needs it, because a
# vendored tree is gitignored by definition and so cannot be tracked.
VENDORED = ("node_modules", ".git", "target", "dist", "build", ".venv", "vendor",
            ".next", "out", "coverage", "__pycache__", ".cache", ".pnpm-store")

# The AST parser, as a SCRIPT BLOCK rather than a -Command one-liner: ParseFile
# needs [ref] variables, and [ref] cannot be built from an inline expression.
#
# TWO WAYS THIS GOT IT WRONG FIRST, both caught by the self-test, both kept here
# because the third attempt would be written by someone who assumes the second one
# was the only mistake:
#   * passing the block to -File, which wants a FILENAME, so every call returned
#     "is not recognized as the name of a script file" -- a parse error reported
#     for three perfectly good files, i.e. exactly the manufactured finding this
#     gate must never produce;
#   * then passing it to -Command with -Args, but -Args only binds with -File, so
#     $Path came through empty and ParseFile reported "The file could not be read:
#     ... argument path is not valid" -- the same manufactured finding, differently
#     worded.
# The target therefore travels in an ENVIRONMENT VARIABLE, which neither host
# reinterprets, rather than as a command-line argument, whose binding differs
# between the two hosts and between -Command and -File.
PARSE_BLOCK = """
$path = $env:DSH_PS_PARSE_TARGET
if ([string]::IsNullOrEmpty($path)) { Write-Error "DSH_PS_PARSE_TARGET is not set"; exit 2 }
$tokens = $null
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
foreach ($e in $errors) {
    "{0}({1},{2}): {3}" -f $e.Extent.File, $e.Extent.StartLineNumber, $e.Extent.StartColumnNumber, $e.Message
}
if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
"""


def is_powershell(path: Path) -> bool:
    """Whether a tracked file is a PowerShell script.

    By suffix, and deliberately so -- unlike the shell gate, which reads the
    shebang. PowerShell has no shebang, so the suffix is the only declaration the
    file makes about its own language, and a .ps1 is a FACT here rather than a habit.
    """
    return path.suffix.lower() == ".ps1"


def host_command() -> list[str] | None:
    """The PowerShell host to parse with, or None when this machine has neither.

    pwsh first; Windows PowerShell 5.1 is the fallback because it is the one a stock
    Windows box has, and the AST parser in it understands everything this repository
    writes. Neither present is a refusal, not a pass: a gate reporting OK from a
    machine where it could not look is the most expensive false green in the set.
    """
    for exe in ("pwsh", "powershell"):
        try:
            r = subprocess.run([exe, "-NoProfile", "-NonInteractive", "-Command",
                                "$PSVersionTable.PSVersion.Major"],
                               capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0 and r.stdout.strip().isdigit():
            return exe
    return None


def targets() -> list[Path]:
    """Every tracked PowerShell script in the repo.

    git ls-files rather than a directory list, for the reason the shell gate records:
    a maintained list of directory names stands in for a rule, and the Windows
    installer pair in ops/ is exactly the sort of thing such a list forgets. The
    filesystem walk is a fallback for a checkout with no git, not a second scope --
    both paths call is_powershell().
    """
    out: list[Path] = []
    tracked: set[str] | None = None
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"],
                           capture_output=True, text=True, check=True)
        tracked = {x for x in r.stdout.split("\0") if x}
    except (OSError, subprocess.CalledProcessError):
        tracked = None

    if tracked is not None:
        for rel in sorted(tracked):
            p = ROOT / rel
            if p.is_file() and is_powershell(p):
                out.append(p)
        return sorted(out)

    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if d.lower() not in VENDORED and d.lower() != ".git"]
        for fn in sorted(filenames):
            q = Path(dirpath) / fn
            if q.is_file() and is_powershell(q):
                out.append(q)
    return sorted(out)


def check(path: Path, host: list[str]) -> tuple[bool, str]:
    """Parse one file. True means it parsed; a non-empty why is the reason not.

    The ABSOLUTE path is passed, unlike the shell gate which passes a repo-relative
    POSIX one. That is not an inconsistency: Git-bash mangles a backslashed Windows
    path into something unreadable, and PowerShell takes a native path without
    complaint. Each gate hands its host the form that host can actually read, because
    a gate must never manufacture "does not parse" for a file it merely could not
    read.
    """
    env = dict(os.environ, DSH_PS_PARSE_TARGET=str(path))
    try:
        r = subprocess.run([host, "-NoProfile", "-NonInteractive", "-Command",
                            PARSE_BLOCK],
                           capture_output=True, text=True, errors="replace",
                           timeout=180, env=env)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, "could not run the PowerShell parser: %s" % exc
    if r.returncode == 0:
        return True, ""
    return False, (r.stderr or r.stdout or "parse failed").strip()


def self_test(host: list[str] | None) -> int:
    """Cases on real files this writes under scripts/, then removes.

    Not pure strings, because the property under test is the PARSER, not a regex: a
    self-test that only checked argument construction would pass with a check()
    unable to detect anything. The scratch file lives in a directory the gate already
    scans, so the broken cases also prove a broken file is FOUND, and it is deleted
    in a finally block -- a self-test leaving a broken .ps1 in scripts/ would fail
    this gate for real.
    """
    if host is None:
        print("SELF-TEST WRONG: no PowerShell host, so no case ran", file=sys.stderr)
        return 2

    bad: list[str] = []
    cases = 0

    scratch = ROOT / "scripts" / "_ps_syntax_selftest_tmp.ps1"
    try:
        scratch.write_text("param([int]$N = 1)\nWrite-Output $N\n",
                           encoding="utf-8", newline="\n")
        ok, why = check(scratch, host)
        if not ok:
            bad.append("a well-formed script must parse: " + why)
        cases += 1

        # THE REGRESSION THIS GATE WAS BORN FROM. Backtick is the escape character,
        # so a backtick before the closing quote of a double-quoted string escapes
        # the quote instead of ending it. The string runs on, and the parser reports
        # the failure far from the cause -- on the real file "The string is missing
        # the terminator" at line 216 for a defect on line 212, plus a phantom
        # "Missing closing }" for a brace that was fine. Invisible to reading and to
        # any balance check; only the parser sees it.
        escaped = 'Write-Host "  - Build with `profile.release.debug = 1`" -ForegroundColor Yellow\n'
        scratch.write_text(escaped, encoding="utf-8", newline="\n")
        ok, why = check(scratch, host)
        if ok:
            bad.append("a double-quoted string with an escaped closing quote must NOT "
                       "parse (backtick is the escape character)")
        elif not why:
            bad.append("a parse failure must carry the parser's message")
        cases += 1

        # The same message in SINGLE quotes does parse, so the case above pins the
        # escape and not something incidental about the fixture.
        single = escaped.replace('"  - Build with', "'  - Build with")
        single = single.replace('1`"', "1`'")
        scratch.write_text(single, encoding="utf-8", newline="\n")
        ok, why = check(scratch, host)
        if not ok:
            bad.append("the same message in single quotes must parse: " + why)
        cases += 1

        # WHAT THIS GATE CANNOT SEE, pinned as a case so the boundary stays a fact
        # rather than a rumour. scripts/profile.ps1 also shipped
        #   [int]$PID = 0
        # which killed every invocation -- even -Help -- with "Cannot overwrite
        # variable PID because it is read-only or constant", because $PID is
        # PowerShell's own read-only process id. The parser does NOT see that: the
        # file parses cleanly and the failure only happens when the script RUNS.
        # Measured here rather than assumed, so the claim that this gate would have
        # caught the third profile.ps1 defect is not mistaken for a fact. Catching a
        # parameter shadowing a read-only automatic variable needs a different
        # checker -- one that looks at the declared variable names -- and a parse
        # gate that quietly claimed the job would be worse than one that does not.
        scratch.write_text("[int]$PID = 0\nWrite-Output $PID\n",
                           encoding="utf-8", newline="\n")
        ok, why = check(scratch, host)
        if not ok:
            bad.append("a read-only automatic-variable collision is a RUNTIME failure, "
                       "so this gate must see it parse: " + why)
        cases += 1

        # With the alias, which is how the real fix was written, it does parse.
        scratch.write_text("[Alias('PID')]\n[int]$ProcessId = 0\nWrite-Output $ProcessId\n",
                           encoding="utf-8", newline="\n")
        ok, why = check(scratch, host)
        if not ok:
            bad.append("the same parameter renamed with an alias must parse: " + why)
        cases += 1
    finally:
        if scratch.exists():
            scratch.unlink()

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, no files left behind)" % cases)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="every tracked PowerShell script must parse")
    ap.add_argument("--self-test", action="store_true",
                    help="run synthetic cases only; leaves no tracked file behind")
    args = ap.parse_args()

    host = host_command()
    if args.self_test:
        return self_test(host)

    if host is None:
        print("verify-ps-syntax: REFUSED -- no pwsh or powershell on PATH, so no file "
              "was parsed. A clean run is indistinguishable from a starved one.",
              file=sys.stderr)
        return 2

    files = targets()
    if not files:
        print("verify-ps-syntax: REFUSED -- no tracked .ps1 file was found, so there "
              "is nothing to report on. A clean run is indistinguishable from a "
              "starved one.", file=sys.stderr)
        return 2

    broken: list[str] = []
    for q in files:
        ok, why = check(q, host)
        if not ok:
            broken.append(q.relative_to(ROOT).as_posix())
            print("verify-ps-syntax: PARSE ERROR in %s" % broken[-1])
            for line in why.splitlines()[:6]:
                print("    " + line)
    if broken:
        print("verify-ps-syntax: %d of %d PowerShell script(s) do not parse."
              % (len(broken), len(files)))
        return 1
    print("verify-ps-syntax: OK — %d PowerShell entry point(s) parse." % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
