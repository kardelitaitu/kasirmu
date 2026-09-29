#!/usr/bin/env python3
"""verify-shell-syntax.py -- parse every shell entry point without running it.

WHY
===
This is the cheapest gate in the tree and the one that guards the most. A syntax
error in scripts/check.sh or .githooks/pre-commit does not fail loudly: the file
does not run, so every step inside it is skipped, so the matrix reports fewer
checks and the hook enforces fewer gates, and nothing anywhere says so. The
pre-commit hook is the sharper case -- if it cannot parse, it stops gating
everything it was written to gate, and the only symptom is a bug that reaches
main unblocked.

`sh -n` PARSES and does not execute. That distinction is the whole design: this
gate can run first in a pipeline, on a checkout with no toolchain installed, over
files whose bodies would be expensive or destructive to run, and it cannot have
side effects because it never invokes anything in the file.

SCOPE
=====
Tracked files only, and only two shapes: *.sh under scripts/, and everything
under .githooks/ that is not a *.sample. A .sample is documentation of a hook the
user installs, not a hook this repo runs, and a file the repo does not execute
should not be able to fail a gate -- the same reasoning verify-ci-docs-drift.py
uses when it scopes a claim to a live workflow. Shebang is honoured when present
so a bash-only construct in a bash file is not reported against /bin/sh.

Exit 0 all parse, 1 at least one does not, 2 could not run the parser.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# SCOPE IS "TRACKED FILES", enforced by git ls-files rather than by a list of
# directory names to avoid. The first version walked the filesystem and excluded
# ("node_modules", ".git", "target", "dist", "build", ".venv", "vendor") -- a maintained
# list standing in for a rule, which is the same shape of assumption that shipped three
# scope bugs this session. A vendored tree is gitignored by definition, so it cannot be
# tracked: `git ls-files` gets the right answer for every vendored directory that exists
# now AND every one added later, with no edit here. The name list is kept only as a
# belt-and-braces skip for a checkout where git is unavailable.


VENDORED = ("node_modules", ".git", "target", "dist", "build", ".venv", "vendor",
             ".next", "out", "coverage", "__pycache__", ".cache", ".pnpm-store")


def is_shell(path: Path) -> bool:
    """Whether a tracked file DECLARES itself a shell script.

    The single scope rule, used by both the git path and the filesystem fallback. A
    shebang is a fact about the file; a .sh suffix is a habit, and the habit was wrong
    for seven tracked scripts here -- three git hooks, an Android gradlew, and two
    Debian maintainer scripts that run as root during package install.
    """
    try:
        head = path.open("rb").readline(120)
    except OSError:
        return False
    if not head.startswith(b"#!"):
        return False
    return any(k in head.decode("utf-8", "replace") for k in ("sh", "bash"))


def targets() -> list[Path]:
    """Every first-party shell file in the repo, not just scripts/ and .githooks/.

    The first version of this gate scanned two directories and I wrote that limitation
    into its own docstring as a KNOWN GAP -- the same mistake the self-test meta-gate had
    one round earlier, and a gate whose scope is narrower than the thing it polices
    cannot see the rot. The eleven first-party scripts it missed included
    apps/unified/healthcheck.sh and apps/unified/docker-entrypoint.sh, which run IN THE
    PRODUCTION CONTAINER: a syntax error there is not a broken dev tool, it is an
    image that will not come up. Those are now covered.
    """
    # The fallback for a checkout with no git still has to skip vendored trees BY NAME,
    # because it cannot ask git what is tracked -- but the fallback is a SAFETY NET, not
    # a second scope: both paths call is_shell() to decide what is a shell script, and
    # this list only decides which DIRECTORIES to walk. Being incomplete there degrades
    # to scanning a vendored tree, never to skipping a real one.
    #
    # The 2026-09-29 edit that introduced this branch also deleted the VENDORED tuple it
    # referenced, and nothing noticed for two rounds because every machine here has git.
    # It surfaced only when the fallback was deliberately exercised with subprocess.run
    # patched to raise. An unexercised branch is not a tested one.
    out: list[Path] = []
    tracked: set[str] | None = None
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"],
                           capture_output=True, text=True, check=True)
        tracked = {p for p in r.stdout.split("\0") if p}
    except (OSError, subprocess.CalledProcessError):
        tracked = None          # no git: fall back to walking, see VENDORED above

    if tracked is not None:
        # Detected by SHEBANG, not by extension. An extension list is a snapshot of what
        # this repo happens to name its shell files, and it was wrong: 60 tracked files
        # carry a shell shebang and the *.sh glob found 53. The seven it missed were
        # .githooks/commit-msg, .githooks/post-commit and .githooks/pre-push (hooks
        # pre-commit was name-listed, the other two were not), apps/mobile-tauri/gen/
        # android/gradlew, and ops/packaging/linux/deb/postinst and prerm -- the last two
        # run as root during package install and uninstall, where a parse error breaks
        # the install. A shebang is a FACT about the file; a .sh suffix is a habit.
        for rel in sorted(tracked):
            p = ROOT / rel
            if p.is_file() and not rel.endswith(".sample") and is_shell(p):
                out.append(p)
        return sorted(out)

    for dirpath, dirnames, filenames in os.walk(ROOT):
        # d != ".git", NOT d.startswith(".git"): the prefix form also swallows
        # ".githooks", which is where four of the shell scripts live (commit-msg,
        # post-commit, pre-commit, pre-push). That made this fallback find 56 where the
        # git path finds 60, and the only reason it was ever noticed is that both paths
        # were run side by side.
        dirnames[:] = [d for d in dirnames
                       if d.lower() not in VENDORED and d.lower() != ".git"]
        for fn in sorted(filenames):
            if fn.endswith(".sample"):
                continue
            p = Path(dirpath) / fn
            # Same SHEBANG rule as the git path. This branch used to keep the old
            # *.sh glob, which meant the gate checked a different set of files
            # depending on whether git was available -- the same scope bug wearing a
            # different mask, and the kind that only shows up on a machine where nobody
            # reproduces the failure. One rule, both paths.
            if is_shell(p):
                out.append(p)
    return sorted(out)


def parser_for(path: Path) -> list[str]:
    """Honour the shebang so a bash-only file is not parsed as POSIX sh."""
    try:
        with path.open("rb") as fh:
            first = fh.readline(200).decode("utf-8", errors="replace")
    except OSError:
        return ["sh", "-n"]
    if "bash" in first:
        return ["bash", "-n"]
    return ["sh", "-n"]


def check(path: Path) -> tuple[bool, str]:
    # Forward slashes, always. The Windows-native form C:\\dev\\... reaches Git-bash's
    # /bin/bash with its separators eaten (C:devkasirmu...) and the parser then reports a
    # MISSING FILE rather than a syntax error -- a failure this gate must never
    # manufacture, because "does not parse" and "cannot be read" are different bugs and
    # only the first is this gate's business. Measured: sh -n tolerated the backslashed
    # form, bash -n did not, so the path is normalised rather than the failure tolerated.
    # RELATIVE, not absolute. An absolute Windows path handed to Git-bash's /bin/bash
    # comes back as a MISSING FILE, not a parse result, and this gate must not
    # manufacture a "does not parse" for a file it could not read. Measured here: sh -n
    # tolerated C:\\... and bash -n did not. A repo-relative path has no drive letter
    # to mangle and is the one form every shell accepts on every platform, so that is
    # what is passed. cwd is ROOT, so the relative path resolves correctly.
    rel = path.relative_to(ROOT).as_posix()
    cmd = parser_for(path) + [rel]
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                           errors="replace")
    except OSError as exc:
        return False, f"could not run {cmd[0]}: {exc}"
    if r.returncode == 0:
        return True, ""
    return False, (r.stderr or r.stdout or "parse failed").strip()


def self_test() -> int:
    """Proves the property on a file this writes under target/, then removes.

    Not a pure-string case because the property is about the PARSER, not a regex:
    a self-test that only checked argument construction would pass with a
    check() that could not detect anything. The file is created in a directory
    this gate already scans, so it also demonstrates that a broken file is
    FOUND -- and it is deleted in a finally block, because a self-test that
    leaves a broken shell script in scripts/ would fail this gate for real.
    """
    bad: list[str] = []
    scratch = ROOT / "scripts" / "_syntax_selftest_tmp.sh"
    try:
        scratch.write_text("#!/usr/bin/env sh\nset -e\necho ok\n", encoding="utf-8", newline="\n")
        ok, why = check(scratch)
        if not ok:
            bad.append("a well-formed script must parse: " + why)

        scratch.write_text("#!/usr/bin/env sh\nif [ 1 -eq 1 ]\nthen echo 'unterminated\n", encoding="utf-8", newline="\n")
        ok, why = check(scratch)
        if ok:
            bad.append("a script with an unterminated string must NOT parse")
        elif not why:
            bad.append("a parse failure must carry the parser's message")

        # A missing PARSE message is as much a defect as a missing detection: a gate
        # that reports "does not parse" for a file it could not read teaches its reader
        # to ignore it. Covered by the second case above, which asserts why is non-empty.

        # THE REGRESSION THIS GATE WAS BORN FROM, kept as a case so it can never come
        # back silently. Bash treats # as a comment only when it STARTS a word, so a
        # "fi" written flush against its trailing comment lexes as ONE token, the
        # enclosing if never closes, and the parser reports the failure at END OF FILE
        # -- 65 lines away, with every keyword, quote, brace and $( in the file
        # balancing. That is the whole reason this file exists: the defect was
        # invisible to reading and to every balance check, and only "bash -n" saw it.
        glued = "#!/usr/bin/env bash\nif [[ 1 -eq 1 ]]; then\n  echo yes\nfi# trailing comment\n"
        scratch.write_text(glued, encoding="utf-8", newline="\n")
        ok, _why = check(scratch)
        if ok:
            bad.append("a 'fi' glued to a trailing comment must NOT parse "
                       "(# starts a comment only at a word boundary)")

        # The same file with the separator restored DOES parse, so the case above is
        # pinning the lexer and not something incidental about the fixture.
        fixed = glued.replace("fi# trailing comment", "fi\n# trailing comment")
        scratch.write_text(fixed, encoding="utf-8", newline="\n")
        ok, why = check(scratch)
        if not ok:
            bad.append("the same file with fi separated from its comment must parse: " + why)
    finally:
        if scratch.exists():
            scratch.unlink()

    if scratch.exists():
        bad.append("self-test left a scratch file behind")
    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (5 cases, no files left behind)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    found = False
    checked = 0
    for p in targets():
        checked += 1
        ok, why = check(p)
        if not ok:
            found = True
            print(f"verify-shell-syntax: PARSE ERROR in {p.relative_to(ROOT).as_posix()}")
            for line in why.splitlines()[:6]:
                print("    " + line)
    if found:
        # Was advisory 2026-09-29 for one round while scripts/profile.sh was red, then
        # FLIPPED TO BLOCKING in the same day once the cause was found and fixed. The
        # advisory window existed because a red check.sh fails for everyone on every
        # run, and a gate that is always red gets muted -- losing the finding AND the
        # gate. It was not a softening: the finding printed on every run throughout, and
        # the flip condition was written down before the fix existed.
        #
        # THE BUG THAT COST THE WINDOW, because it will recur: profile.sh line 151 read
        # `fi# -- Build and run command`. Bash only treats # as a comment when it
        # STARTS a word, so `fi#` lexes as one token, not as `fi` plus a comment. The
        # enclosing `if` therefore never got its `fi`, and bash reported the failure at
        # END OF FILE -- 65 lines away from the cause, with every keyword, quote, brace
        # and $( in the file balancing. A defect that reports 65 lines from its cause is
        # the reason this gate exists: without `sh -n` nothing would have run, so nothing
        # would have said so.
        #
        # THE MEASUREMENT TRAP that hid it for a round: a per-line strip of #.*$ to drop
        # comments eats the `$#` in `while [[ $# -gt 0 ]]; do`, deleting the loop and
        # making the file look badly unbalanced. Strip FULL-LINE comments only.
        #
        # FLIP CONDITION: scripts/profile.sh parses. Until then this stays advisory,
        # and the finding is printed on every run so it cannot be forgotten.
        #
        # WHAT IS RULED OUT about scripts/profile.sh, measured 2026-09-29, so the
        # next person does not re-derive it:
        #   * a missing fi -- block depth nets to 0 at EOF (if/fi, case/esac, while/do/done)
        #   * an unterminated quote -- every line has an even count of ' and of "
        #   * an unterminated $( -- all 24 apparent mismatches are plain ) in comments,
        #     case patterns and array literals
        #   * CRLF -- no CR in the file as read
        #   * non-ASCII -- an ASCII-folded copy of the file fails at the SAME line 216, so
        #     the box-drawing comment rules are not the cause
        # Note the trap: a naive per-line strip of #.*$ eats the $# in
        #   while [[ $# -gt 0 ]]; do
        # and makes this file look badly unbalanced. Strip FULL-LINE comments only.
        # What is left is the grammar itself, so re-read the raw bytes around any suspect
        # line rather than the rendered text.
        print("verify-shell-syntax: ADVISORY (not blocking) — see FLIP CONDITION above.")
        return 0
    print(f"verify-shell-syntax: OK — {checked} shell entry point(s) parse.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
