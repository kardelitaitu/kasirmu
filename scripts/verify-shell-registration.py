#!/usr/bin/env python3
"""Fail when a command one shell registers is missing from the other and nobody said why.

WHY THIS EXISTS

`verify-ipc-parity.py` grades GAPS THAT REACH THE UI: a command the front end invokes
that a shell does not answer. It cannot see the opposite mistake -- a command
registered in one shell and simply forgotten in the other -- because nothing calls it
yet. A new `*_scoped` command added to the desktop's handler list and not the tablet's
is invisible to every gate today; the first symptom is a runtime `command not found`
on a device nobody tested.

Measured 2026-10-25: the desktop shell registers 516 command paths and the tablet 440,
with 95 desktop names absent from the tablet and 19 tablet names absent from the
desktop. Almost all of that is INTENTIONAL -- device-only commands, desktop-only
surfaces, tablet-only commands. The divergence is not the defect. An UNEXPLAINED
divergence is.

WHAT THIS GRADES

Every name registered in exactly one shell must appear in `scripts/shell-divergence.json`
with a reason. A name that appears in BOTH shells needs no entry, and an entry whose
name now appears in both is reported STALE.

HOW THE NAMES ARE READ

Only the argument list of `tauri::generate_handler![...]` is parsed. A grep for
`commands::<module>::<fn>` over the whole file picks up a bare `pub const` re-export
and a direct function CALL -- both measured as false positives on 2026-10-25
(`TOPOLOGY_REVISION_RESTORABLE_KEEP` and `start_and_store`) before this parser existed.

USAGE

    python scripts/verify-shell-registration.py            # grade the tree
    python scripts/verify-shell-registration.py --self-test

Exit 0 when every divergence is explained, 1 otherwise, 2 on a malformed input.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default)."""
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


# The two shells and the generated-handler list in each. Relative to the repo root.
SHELLS = {
    "desktop": "apps/desktop-tauri/src/lib.rs",
    "tablet": "apps/mobile-tauri/src/lib.rs",
}

# `commands::<module>::<fn>` -- anchored on the module segment so a bare const or a
# plain call cannot match. Only applied INSIDE the handler list.
HANDLER_ENTRY_RE = re.compile(r"commands::\w+::([A-Za-z_]\w*)")

HANDLER_MACRO_RE = re.compile(r"(?:tauri::)?generate_handler!\s*\[", re.S)


def handler_names(source: str) -> set:
    """Every command path inside `generate_handler![...]`, and nothing else."""
    match = HANDLER_MACRO_RE.search(source)
    if match is None:
        raise ValueError("no generate_handler![...] list found")
    start = match.end() - 1  # the opening bracket
    depth = 0
    end = None
    for i in range(start, len(source)):
        ch = source[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        raise ValueError("generate_handler![ has no closing bracket")
    body = source[start + 1 : end]
    # Strip line comments so a commented-out entry is not read as registered.
    body = re.sub(r"//[^\n]*", "", body)
    return set(HANDLER_ENTRY_RE.findall(body))


def load_divergence_table(path: str) -> dict:
    """The JSON table, or a refusal. A missing table is not an empty one."""
    if not os.path.isfile(path):
        raise ValueError(f"divergence table not found: {path}")
    with io.open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    table = doc.get("shell_divergence")
    if not isinstance(table, dict):
        raise ValueError("divergence table has no 'shell_divergence' object")
    return table


def audit(repo: str, table: dict) -> list:
    """Problems, one line each. Empty means every divergence is explained."""
    registered = {}
    for shell, rel in SHELLS.items():
        path = os.path.join(repo, rel)
        with io.open(path, encoding="utf-8") as fh:
            registered[shell] = handler_names(fh.read())
    problems = []
    for shell, other in (("desktop", "tablet"), ("tablet", "desktop")):
        only = registered[shell] - registered[other]
        for name in sorted(only):
            entry = table.get(name)
            if entry is None:
                problems.append(
                    f"{shell}-only command {name!r} is absent from the {other} shell and "
                    f"has no 'shell_divergence' entry explaining why"
                )
                continue
            if not str(entry.get("reason", "")).strip():
                problems.append(f"shell_divergence entry {name!r} carries no reason")
    # Stale: registered in BOTH shells now, so the explanation describes a divergence
    # that no longer exists.
    for name in sorted(table):
        if all(name in registered[s] for s in SHELLS):
            problems.append(
                f"stale shell_divergence entry {name!r} -- both shells register it now"
            )
    return problems


def main(argv=None, root=None) -> int:
    """r176: argv and root parameterized, the r166..r175 contract -- root
    redirects BOTH shell sources and the divergence table, so a fixture cannot
    half-run against the real shells."""
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--self-test":
        return self_test()
    if argv:
        print("usage: verify-shell-registration.py [--self-test]", file=sys.stderr)
        return 2
    repo = os.path.abspath(root) if root is not None else \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    table_path = os.path.join(repo, "scripts", "shell-divergence.json")
    try:
        table = load_divergence_table(table_path)
        problems = audit(repo, table)
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    if problems:
        print(f"FAIL: {len(problems)} unexplained shell divergence(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(
        f"OK: {len(table)} documented divergence(s), every one still real across "
        f"{len(SHELLS)} shells."
    )
    return 0


def self_test() -> int:
    failures = 0

    def case(label, got, want):
        nonlocal failures
        ok = got == want
        print(f"    {'ok  ' if ok else 'FAIL'} {label}")
        if not ok:
            print(f"         got  {got!r}\n         want {want!r}")
            failures += 1

    # 1. The parser reads the handler list and NOTHING else. Both false positives
    # measured on the real tree are represented here.
    wrapped = (
        "tauri::generate_handler![\n"
        "commands::sales::create_sale,\n"
        "// commands::sales::commented_out,\n"
        "commands::topology::TOPOLOGY_REVISION_RESTORABLE_KEEP,\n"
        "]\n"
        "let x = crate::commands::local_api::start_and_store(&state).await;\n"
    )
    case("a commented-out entry is not registered",
         "commented_out" in handler_names(wrapped), False)
    case("a name OUTSIDE the handler list is not registered",
         "start_and_store" in handler_names(wrapped), False)
    case("an entry inside the list IS read",
         "create_sale" in handler_names(wrapped), True)
    case("a re-exported const inside the list is read as a name",
         "TOPOLOGY_REVISION_RESTORABLE_KEEP" in handler_names(wrapped), True)

    # 2. A file with no handler list is malformed, not empty.
    try:
        handler_names("fn main() {}")
        case("a missing handler list is refused", False, True)
    except ValueError:
        case("a missing handler list is refused", True, True)
    try:
        handler_names("tauri::generate_handler![ a::b::c")
        case("an unclosed handler list is refused", False, True)
    except ValueError:
        case("an unclosed handler list is refused", True, True)

    # 3. The three verdicts, over a fabricated tree.
    import tempfile

    def build(desktop, tablet, table):
        root = tempfile.mkdtemp(prefix="oz-shell-reg-", dir=fixture_root())
        for shell, body in (("desktop", desktop), ("tablet", tablet)):
            rel = SHELLS[shell]
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with io.open(dst, "w", encoding="utf-8") as fh:
                fh.write("tauri::generate_handler![\n" + body + "]\n")
        return audit(root, table)

    both = "commands::a::shared,\n"
    d_only = both + "commands::a::desktop_only,\n"
    prob = build(d_only, both, {})
    case("an unexplained one-shell command is a problem", len(prob), 1)
    case("...and the message names the command",
         "desktop_only" in (prob[0] if prob else ""), True)
    case("an explained divergence is clean",
         build(d_only, both, {"desktop_only": {"reason": "desktop-only surface"}}), [])
    case("an entry with a blank reason is a problem",
         len(build(d_only, both, {"desktop_only": {"reason": "  "}})), 1)
    case("an entry that both shells now register is STALE",
         len(build(both, both, {"shared": {"reason": "was divergent"}})), 1)

    # r176: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r175 pattern. The table refusal and both verdicts go through
    # main's own exit mapping, which the audit() cases above do not reach.
    import contextlib as _ctxlib
    import tempfile as _tempfile
    def _shell(files, argv=None):
        import tempfile
        root = tempfile.mkdtemp(prefix="oz-shellreg-shell-", dir=fixture_root())
        for rel, content in files.items():
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with io.open(dst, "w", encoding="utf-8") as fh:
                fh.write(content)
        out, err = io.StringIO(), io.StringIO()
        with _ctxlib.redirect_stdout(out), _ctxlib.redirect_stderr(err):
            # an EXPLICIT argv, never None: under a --self-test run the
            # None fallback reads sys.argv[1:] == ["--self-test"] and
            # re-enters this self_test until the stack dies.
            rc = main(argv=[] if argv is None else argv, root=root)
        return rc, out.getvalue() + err.getvalue()
    DESK = "tauri::generate_handler![\ncommands::a::shared,\ncommands::a::desktop_only,\n]\n"
    TABL = "tauri::generate_handler![\ncommands::a::shared,\n]\n"
    TABLE = os.path.join("scripts", "shell-divergence.json")
    rc, text = _shell({SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL})
    if rc != 2 or "divergence table not found" not in text:
        failures += 1
        print(f"    FAIL a missing table must refuse with exit 2 (rc={rc} text={text[-90:]!r})")
    rc, text = _shell({SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                       TABLE: '{"shell_divergence": {}}'})
    if rc != 1 or "desktop_only" not in text or "1 unexplained" not in text:
        failures += 1
        print(f"    FAIL an unexplained divergence must exit 1 naming it (rc={rc} text={text[-90:]!r})")
    rc, text = _shell({SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                       TABLE: '{"shell_divergence": {"desktop_only": {"reason": "desktop-only surface"}}}'})
    if rc != 0 or "1 documented divergence(s)" not in text:
        failures += 1
        print(f"    FAIL an explained divergence must exit 0 (rc={rc} text={text[-90:]!r})")
    rc, text = _shell({SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                       TABLE: '{"shell_divergence": {"desktop_only": {"reason": "x"}, "shared": {"reason": "was divergent"}}}'})
    if rc != 1 or "stale" not in text:
        failures += 1
        print(f"    FAIL a stale entry must exit 1 (rc={rc} text={text[-90:]!r})")
    rc, text = _shell({}, argv=["--what"])
    if rc != 2 or "usage" not in text:
        failures += 1
        print(f"    FAIL an unknown argument must exit 2 with usage (rc={rc} text={text[-60:]!r})")

    print(f"  self-test: {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    if failures:
        return 1
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r238 -- the r228 lesson).

    Rung 5 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run would
    recurse. The guard turns it into a printed skip.
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
    """r238: the root contract, graded on fixture shells through main().

    Rung 1 IS the killing rung. This checkout's two shells DIVERGE and the
    table explains every divergence (measured r238: exit 0, "OK: N documented
    divergence(s)"), so a main() that ignored its root would report that green
    against a fixture whose one-shell command has no entry at all. The fixture
    must exit 1 naming `desktop_only`.

    Rung 2 pins root on the TABLE side too: the same shells with the entry
    present green, so a main that read the real table instead would be graded
    by rung 1 (which it fails) rather than by this one.
    """
    import contextlib

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    def build(tmp, files):
        """A fixture repo root holding the given {relative path: text} files."""
        root = tempfile.mkdtemp(dir=tmp, prefix="fx_")
        for rel, content in files.items():
            dst = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with io.open(dst, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
        return root

    DESK = "tauri::generate_handler![\ncommands::a::shared,\ncommands::a::desktop_only,\n]\n"
    TABL = "tauri::generate_handler![\ncommands::a::shared,\n]\n"
    TABLE = "scripts/shell-divergence.json"

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: an unexplained divergence in the FIXTURE.
        root = build(tmp, {SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                           TABLE: '{"shell_divergence": {}}'})
        rc, said = run(root)
        if rc != 1 or "desktop_only" not in said or "unexplained" not in said:
            print("  x rung 1: an unexplained fixture divergence must exit 1 naming it "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the same fixture with the entry present greens from the fixture.
        root = build(tmp, {SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                           TABLE: '{"shell_divergence": {"desktop_only": '
                                  '{"reason": "desktop-only surface"}}}'})
        rc, said = run(root)
        if rc != 0 or "1 documented divergence(s)" not in said:
            print("  x rung 2: an explained fixture divergence must exit 0 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: a fixture with no divergence table.
        root = build(tmp, {SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL})
        rc, said = run(root)
        if rc != 2 or "divergence table not found" not in said:
            print("  x rung 3: a missing fixture table must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- a shell source with no handler list refuses, naming the file.
        root = build(tmp, {SHELLS["desktop"]: "fn main() {}\n",
                           SHELLS["tablet"]: TABL,
                           TABLE: '{"shell_divergence": {}}'})
        rc, said = run(root)
        if rc != 2 or "no generate_handler" not in said:
            print("  x rung 4: a fixture shell with no handler list must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {SHELLS["desktop"]: DESK, SHELLS["tablet"]: TABL,
                           TABLE: '{"shell_divergence": {}}'})
        rc, said = run(root, "--self-test")
        if rc != 0 or "self-test: PASS" not in said or "ladder re-entry" not in said:
            print("  x rung 5: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("SHELL-REGISTRATION SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


if __name__ == "__main__":
    sys.exit(main())
