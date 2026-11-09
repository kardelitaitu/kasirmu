#!/usr/bin/env python3
"""verify-runner-commands.py -- every script a runner names must actually exist.

WHY
===
A CI step that invokes a script which has been deleted or renamed does not fail
with a useful message. Depending on the shell it is a "file not found" from step 40
of 200, or -- worse on a path-gated job -- a step that simply never runs, which is
indistinguishable from a step nobody wrote. The same is true of a check.sh entry.
Nothing else in the tree can see this: the docs gates read the checkers, and the
checker gates run the checkers, but no gate asks whether the RUNNERS still point at
files that are there.

Measured 2026-09-29 when this was written: 230 script invocations across the three
runners (94 DISTINCT paths -- several checkers are invoked by more than one runner),
zero dangling. The surface is the point: a rename that updates scripts/ but not
check.sh, check.ps1 or the workflows is the failure this exists to catch. Repeats are
counted, not deduplicated, because three invocations of one script in a workflow are
three places that must each be updated.

WHAT IS AND IS NOT COVERED
==========================
Both command spellings, because the runners do not agree: .github/workflows and
check.sh write `python3 scripts/x.py`, while check.ps -- the PowerShell twin --
writes `$pythonCommand scripts/x.py`. An earlier throwaway probe of this idea
matched only the first and reported check.ps1 as referencing NOTHING, which read as
a finding and was a defect in the probe. The twin is in scope for that reason.

Retired workflows under .github/workflows/attic/ are NOT covered: a .bak is never
executed, so a dangling reference in one affects nothing. Same rule
verify-ci-docs-drift applies when it scopes a claim to a live workflow.

Exit 0 every reference resolves, 1 at least one does not, 2 no references found.
"""
from __future__ import annotations

import argparse
import re
import shutil
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
    """The temp root this file's fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir that was removed between runs
    otherwise makes EVERY fixture die with FileNotFoundError before it grades
    anything. exist_ok keeps the common case a no-op.
    """
    import os
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


sys.path.insert(0, str(Path(__file__).resolve().parent))
# The live-workflow rule is shared; see scripts/_live_workflows.py. Only the WORKFLOWS
# entry below is covered by it -- the other two are files, not a directory, and keep
# their own handling.
RUNNERS = (
    ROOT / ".github" / "workflows",
    ROOT / "scripts" / "check.sh",
    ROOT / "scripts" / "check.ps1",
    # The pre-commit hook too, and not because it invokes checkers: it does not. It
    # carries a user-facing error string telling a developer to run
    # "python3 scripts/generate-pg-migration.py", and that guidance goes stale on a
    # rename exactly like a step does. A runner list is a list of places a reader is
    # told to run something, not a list of places a program is executed.
    ROOT / ".githooks" / "pre-commit",
)
# The interpreter token varies by runner: literal python3/node/bash in the shell and
# the workflows, $pythonCommand/$npmCommand in the PowerShell twin.
#
# NOT EVERY LIST HERE IS A SMELL, and the distinction was checked rather than assumed.
# The VENDORED directory list in verify-shell-syntax was a smell and was replaced by
# `git ls-files`: directory names are an OPEN vocabulary and a snapshot of one goes
# stale silently. Interpreter names are a CLOSED vocabulary -- there are only so many
# ways to ask a machine to run a file -- so an explicit list is the honest
# representation, and being wrong about it fails loudly (a missed token reports nothing)
# rather than quietly. Verified against the tree 2026-09-29: the only leading tokens on
# "run: ... scripts/" lines are python3 (56), bash (18), node (11), python (3) and sh (1),
# all covered; no npx, pnpm, deno, bun or cargo form names a scripts/ path anywhere.
COMMAND_RE = re.compile(
    r"(?:python3|python|node|bash|sh|\$pythonCommand|\$npmCommand)"
    r"\s+(?:-[A-Za-z-]+\s+)*"          # flags such as --silent
    r"(scripts/[A-Za-z0-9_./-]+\.(?:py|mjs|sh))"
)


#: The same four runners, relative -- r191: the contract root re-derives the
#: runner set from these instead of the module-constant absolute paths.
REL_RUNNERS = (".github/workflows", "scripts/check.sh", "scripts/check.ps1",
               ".githooks/pre-commit")


def live_runner_files(root=None) -> list[Path]:
    """r191: all four runners re-derived together from the contract root --
    never half (a root redirecting the workflows but not the hook would grade
    a tree that exists nowhere)."""
    if root is None:
        runners = RUNNERS
    else:
        base_root = Path(root).resolve()
        runners = tuple(base_root / rel for rel in REL_RUNNERS)
    out: list[Path] = []
    for r in runners:
        if r.is_dir():
            for p in sorted(r.rglob("*.yml")) + sorted(r.rglob("*.yaml")):
                if "attic" in {q.lower() for q in p.parts}:
                    continue          # retired; never executed
                out.append(p)
        elif r.is_file():
            out.append(r)
    return out


#: A shell line comment. A command inside one is DOCUMENTATION, not execution.
SHELL_COMMENT_RE = re.compile(r"(?:^|\s)#")


def _in_shell_comment(text: str, pos: int) -> bool:
    """True when pos sits to the right of a #, on its own line.

    A runner comments routinely quote the command they are explaining. check.sh's
    website-link-checker step says that CI runs the checker WITHOUT --self-test and
    names the command in prose, while the real path is website/scripts/. That sentence
    is a reader's note, not a step, and grading it reported a correctly-moved checker
    as a missing file (2026-10-23, found by wiring a sibling self-test).
    """
    line_start = text.rfind("\n", 0, pos) + 1
    return bool(SHELL_COMMENT_RE.search(text[line_start:pos]))


def references(text: str) -> list[str]:
    """Every scripts/... path a runner names IN A COMMAND, in order, repeats kept."""
    return [m.group(1) for m in COMMAND_RE.finditer(text)
            if not _in_shell_comment(text, m.start())]


def dangling(files: list[Path], base=None) -> tuple[list[tuple[str, str]], int]:
    """r191: resolution happens against the same root the runners came from."""
    base_root = ROOT if base is None else Path(base).resolve()
    bad: list[tuple[str, str]] = []
    seen = 0
    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            bad.append((p.name, f"unreadable: {exc}"))
            continue
        for ref in references(text):
            seen += 1
            if not (base_root / ref).exists():
                bad.append((p.name, ref))
    return bad, seen


def self_test() -> int:
    """Synthetic runner text, plus two live_runner_files() cases over a scratch tree
    (created under tempfile.mkdtemp, removed in a finally; RUNNERS is repointed for
    them and restored). Nothing in the checkout is read or written."""
    global RUNNERS
    bad: list[str] = []

    # The POSIX spelling used by check.sh and the workflows.
    want = ["scripts/a.py"]
    got = references("      run: python3 scripts/a.py")
    if got != want:
        bad.append(f"python3 form: expected {want!r}, got {got!r}")

    # The PowerShell twin's spelling. This is the case the throwaway probe missed.
    want = ["scripts/b.py"]
    got = references('Step -Name "x" -RetryCommand "$pythonCommand scripts/b.py"')
    if got != want:
        bad.append(f"$pythonCommand form: expected {want!r}, got {got!r}")

    # A flag between interpreter and path must not defeat the match.
    want = ["scripts/c.mjs"]
    got = references("node --test scripts/c.mjs")
    if got != want:
        bad.append(f"flagged form: expected {want!r}, got {got!r}")

    # And the rule must FIRE, not merely parse: this is the whole gate.
    if references("run: python3 scripts/gone.py") != ["scripts/gone.py"]:
        bad.append("a reference to a missing script must still be parsed as a reference")
    if references("run: python3 apps/foo/src/main.rs") != []:
        bad.append("a non-scripts path must not be reported as a runner reference")

    # A command quoted in a COMMENT is documentation, not a step. This is the exact
    # shape check.sh carries: the prose names the command, the step names the real path.
    if references("# CI runs node scripts/check-links.mjs without the flag") != []:
        bad.append("a command inside a # comment is documentation, not a runner step")
    # ...and the real step on the next line must still be parsed, or the gate goes deaf.
    if references("      node scripts/check-links.mjs --self-test") != ["scripts/check-links.mjs"]:
        bad.append("a real step must still be parsed as a reference")

    # Two local assertion helpers, matching this file's inline bad.append style.
    def ok(name, cond):
        if not cond:
            bad.append(name)

    def case(name, got, expect):
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    # live_runner_files() -- the walker that decides WHICH files the gate reads, and no
    # case reached it: everything above grades text handed to references() directly, so
    # the sweep blanked it invisibly (2026-11-06). A blanked stub crashes dangling()
    # loudly; the quiet mutations are scope ones -- the attic skip (a retired runner
    # rejoining the corpus makes false findings), the plain-file branch (the hook files
    # are runners too, not just the workflow directory), and the yaml extension. Graded
    # against a scratch tree; RUNNERS is a module global, repointed here and restored in
    # a finally.
    scratch = Path(tempfile.mkdtemp(prefix="runnerfiles-"))
    try:
        wf = scratch / "workflows"
        wf.mkdir()
        (wf / "a.yml").write_text("run: python3 scripts/a.py\n", encoding="utf-8")
        (wf / "b.yaml").write_text("run: node scripts/b.mjs\n", encoding="utf-8")
        attic = wf / "Attic"          # the skip is case-insensitive (p.parts, lowered)
        attic.mkdir()
        (attic / "retired.yml").write_text("run: python3 scripts/old.py\n", encoding="utf-8")
        nested = wf / "nested"
        nested.mkdir()
        (nested / "c.yml").write_text("run: bash scripts/c.sh\n", encoding="utf-8")
        pre = scratch / "pre-commit"
        pre.write_text("python3 scripts/d.py\n", encoding="utf-8")
        real_runners = RUNNERS
        try:
            RUNNERS = (wf, pre)
            got = live_runner_files()
            ok("live_runner_files returns a list of runner paths", isinstance(got, list))
            case("it reads recursive yml+yaml, skips Attic, and takes a plain file runner",
                 sorted(p.name for p in got),
                 ["a.yml", "b.yaml", "c.yml", "pre-commit"])
        finally:
            RUNNERS = real_runners
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    # r191: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r190 pattern. No git repository needed: the runner set is
    # globbed and the resolution is an exists() check. The refusal and the
    # dangling case both kill a root-dropping main: the real tree has runners
    # with 504 resolving references, so the refusal case grades them (rc 0)
    # and the dangling case never sees the fixture's missing file (rc 0).
    import contextlib as _ctx
    import io as _io
    shell = 0
    def _fixture(files):
        import tempfile as _tempfile
        with _tempfile.TemporaryDirectory(dir=fixture_root(),
                                           ignore_cleanup_errors=True) as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            (base / "scripts").mkdir(exist_ok=True)
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[], root=base)
            return rc, out.getvalue() + err.getvalue()
    shell += 1
    rc, text = _fixture({".github/workflows/a.yml": "run: python3 scripts/ok.py\n",
                          "scripts/ok.py": "# the target exists\n"})
    if rc != 0 or "1 script reference(s) across 1 runner file(s)" not in text:
        print("  x a resolving reference must read OK with the census (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _fixture({".github/workflows/a.yml": "run: python3 scripts/gone.py\n"})
    if rc != 1 or "a.yml names scripts/gone.py" not in text:
        print("  x a dangling reference must fail naming runner and path (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _fixture({".github/workflows/a.yml": "run: echo hi\n"})
    if rc != 2 or "found NO script references" not in text:
        print("  x a runner corpus without commands must refuse rc 2 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    # a command quoted in a comment is documentation; the real step still counts
    rc, text = _fixture({
        ".github/workflows/a.yml": "run: python3 scripts/ok.py\n",
        "scripts/ok.py": "# the target exists\n",
        ".githooks/pre-commit": "# CI runs node scripts/doc-only.py here\n",
    })
    if rc != 0 or "1 script reference(s) across 2 runner file(s)" not in text:
        print("  x a comment-only runner adds no reference (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (9 cases + %d shell cases, one scratch tree removed)" % shell)
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r250 -- the r228 lesson).

    Rung 4 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run recurses.
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
    """r250: the root contract, graded on fixture trees through main().

    Rung 1 IS the killing rung, and it is the CENSUS arm -- not the dangling
    arm. The census is what rung 1 asserts to the exact character, because the
    two numbers in it are counts over the RUNNER SET, and the runner set is
    derived from root too: a main() that ignored root would read this
    checkout's 8 runners and its 508 references. Measured 2026-11-09, the live
    print is

        OK - 508 script reference(s) across 8 runner file(s) all resolve.

    so the fixture's own reading ("OK - 1 script reference(s) across 1 runner
    file(s) all resolve.") is a value the real tree cannot produce. The
    dangling arm alone would NOT be a kill on the sweep half: the real tree
    has zero dangling references, so a root-blind main reads it clean (rc 0)
    and the fixture's rc 1 -- which is why rung 2 grades the clean arm.

    Rung 3 is the refusal floor: an empty fixture has no runners, so the
    reference count is 0 and the gate must refuse rc 2 rather than print a
    clean it did not earn. A root-blind main reaches the real tree (508
    references) and prints OK instead.
    """
    import contextlib
    import io
    import tempfile

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} files."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text, encoding="utf-8", newline="\n")
        return base

    CLEAN = {".github/workflows/a.yml": "run: python3 scripts/ok.py\n",
             "scripts/ok.py": "# the target exists\n"}

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the census is the FIXTURE's, exactly.
        root = build(tmp, CLEAN)
        rc, said = run(root)
        want = ("verify-runner-commands: OK \u2014 1 script reference(s) across "
                "1 runner file(s) all resolve.")
        if rc != 0 or want not in said:
            print("  x rung 1: the census must count the fixture's one reference in "
                  "its one runner, not this checkout's (rc=%r said=%r)"
                  % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- a dangling reference in the fixture fails, named.
        root = build(tmp, {".github/workflows/a.yml": "run: python3 scripts/gone.py\n"})
        rc, said = run(root)
        if rc != 1 or "a.yml names scripts/gone.py" not in said:
            print("  x rung 2: a dangling reference must exit 1 naming runner and path "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: a fixture with no runners has nothing to read.
        root = build(tmp, {"README.md": "no runners here\n"})
        rc, said = run(root)
        if rc != 2 or "found NO script references" not in said or "OK" in said:
            print("  x rung 3: a fixture without runners must refuse rc 2, never print OK "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, CLEAN)
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 4: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("RUNNER-COMMANDS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv=None, root=None) -> int:
    """r191: argv and root parameterized, the r166..r190 contract -- root
    redirects the runner set AND every resolution target together."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--self-test", action="store_true",
                    help="Run this checker's cases and exit.")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    base = ROOT if root is None else Path(root).resolve()

    files = live_runner_files(root)
    bad, seen = dangling(files, base=base)

    if seen == 0:
        # A gate that found nothing must never read as a gate that found nothing --
        # the same rule the shell and workflow syntax gates follow.
        print("verify-runner-commands: found NO script references in any runner."
              " Refusing to report clean: this is a broken pattern, not a clean tree.",
              file=sys.stderr)
        return 2

    for where, ref in bad:
        print(f"verify-runner-commands: {where} names {ref}, which does not exist.")
    if bad:
        print("verify-runner-commands: a runner naming a file that is not there either"
              " errors mid-job or, on a path-gated step, silently never runs. Both look"
              " like a green that stopped checking.")
        return 1
    print(f"verify-runner-commands: OK — {seen} script reference(s) across "
          f"{len(files)} runner file(s) all resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
