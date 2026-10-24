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


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--self-test":
        return self_test()
    if argv:
        print("usage: verify-shell-registration.py [--self-test]", file=sys.stderr)
        return 2
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
        root = tempfile.mkdtemp(prefix="oz-shell-reg-")
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

    print(f"  self-test: {'PASS' if failures == 0 else f'FAIL ({failures})'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
