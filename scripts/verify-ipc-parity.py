#!/usr/bin/env python3
"""IPC registration parity gate (review F-008 / F-050).

Fails when the front-end invokes a Tauri command string that is NOT
registered in a shell's `generate_handler!` list, unless the miss is an
explicit, dated entry in `scripts/ipc-parity-allowlist.json`.

Closes the ADR #7 residual class mechanically: an unregistered command
used to be invisible locally (the E2E dev-mock answers every invoke)
and only surfaced at runtime as "command not found".

Also reports (informational, non-failing) the count of
`#[tauri::command]` functions that are not registered in their shell —
the dead-IPC-surface tracker being removed under review F-006.

Extraction rules (mirrors the ADR #7 command layout):
- UI side: `invoke('cmd')` / `loggedInvoke<T>('cmd')` literals anywhere
  under the production `ui/src` trees (api, hooks, frontend, components,
  contexts, features, utils). `__tests__/` is excluded — the dev-mock
  there registers its own superset and would mask real gaps (F-008).
- Shell side: the single `generate_handler![...]` block in
  `apps/<shell>-client/src/lib.rs`; entries are `commands::mod::fn`
  paths or bare `fn` names; the last path segment is the command name.

Usage:
  python3 scripts/verify-ipc-parity.py              # enforce
  python3 scripts/verify-ipc-parity.py --write-allowlist  # seed/refresh
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

UI_SCAN_DIRS = [
    "ui/src/api",
    "ui/src/hooks",
    "ui/src/frontend",
    "ui/src/components",
    "ui/src/contexts",
    "ui/src/features",
    "ui/src/utils",
]

SHELLS = {
    "desktop": "apps/desktop-client/src/lib.rs",
    "tablet": "apps/tablet-client/src/lib.rs",
}

ALLOWLIST_PATH = REPO_ROOT / "scripts" / "ipc-parity-allowlist.json"

# loggedInvoke<Foo>('cmd', ...) / invoke('cmd', ...) — the generic
# parameter list (if any) may not contain parens, which keeps the regex
# away from nested call boundaries.
UI_INVOKE_RE = re.compile(
    r"(?:loggedInvoke|invoke)(?:<[^()]*>)?\(\s*['\"]([a-z0-9_]+)['\"]"
)

HANDLER_BLOCK_RE = re.compile(r"generate_handler!\[", re.S)
ENTRY_RE = re.compile(r"^(?:[a-z0-9_]+(?:::[a-z0-9_]+)+|[a-z0-9_]+)$")
COMMAND_FN_RE = re.compile(
    r"#\[tauri::command\]\s*pub (?:async )?fn ([a-z0-9_]+)"
)


def extract_ui_commands() -> dict[str, list[str]]:
    """Return {command: [files that invoke it]} from production UI code."""
    found: dict[str, list[str]] = {}
    for scan_dir in UI_SCAN_DIRS:
        base = REPO_ROOT / scan_dir
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in (".ts", ".tsx"):
                continue
            if "__tests__" in path.parts:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                print(f"warn: cannot read {rel}: {exc}", file=sys.stderr)
                continue
            for match in UI_INVOKE_RE.finditer(text):
                found.setdefault(match.group(1), []).append(rel)
    return found


def extract_handlers(lib_path: Path) -> list[str]:
    """Return the command names registered in one shell's lib.rs."""
    text = lib_path.read_text(encoding="utf-8")
    start = text.find("generate_handler![")
    if start < 0:
        raise SystemExit(f"error: no generate_handler![] in {lib_path}")
    end = text.find("]", start)
    block = text[start + len("generate_handler![") : end]
    # Strip comments line-wise BEFORE splitting on commas: `$` without
    # re.M never matches mid-string, so a per-chunk `//.*$` would leave
    # comment prefixes attached and silently drop entries that follow a
    # comment line (set_setting et al.).
    code_lines = [line.split("//", 1)[0] for line in block.splitlines()]
    names: list[str] = []
    for raw_entry in ",".join(code_lines).split(","):
        entry = raw_entry.strip()
        if ENTRY_RE.match(entry):
            names.append(entry.split("::")[-1])
    return sorted(set(names))


def extract_unregistered(shell: str, lib_path: Path, registered: set[str]) -> list[str]:
    """`#[tauri::command]` fns in the shell that are not registered."""
    unregistered: list[str] = []
    commands_dir = lib_path.parent / "commands"
    for path in sorted(commands_dir.rglob("*.rs")):
        if path.name.endswith("_tests.rs"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in COMMAND_FN_RE.finditer(text):
            fn = match.group(1)
            if fn not in registered:
                unregistered.append(fn)
    return sorted(set(unregistered))


def load_allowlist() -> dict:
    if not ALLOWLIST_PATH.exists():
        return {"desktop": [], "tablet": []}
    return json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))


def write_allowlist(missing: dict[str, set[str]]) -> None:
    # Preserve any section this function does not own. It used to rebuild the whole
    # payload, which meant running --write-allowlist silently deleted "scoped_orphans"
    # and un-masked 22 commands as failures on an unrelated reseed.
    payload = dict(load_allowlist())
    payload.setdefault(
        "_comment",
        "Known IPC registration gaps at gate introduction (F-008/F-050). "
        "Entries are UI command strings not yet registered in that shell; "
        "they shrink to zero as F-006 removes the dead surface. Stale "
        "entries (command now registered) fail the gate.",
    )
    for shell in SHELLS:
        payload[shell] = sorted(missing.get(shell, set()))
    ALLOWLIST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"allowlist written: {ALLOWLIST_PATH}")


def write_scoped_orphans(orphans: set[str]) -> None:
    """Seed/extend the scoped_orphans section, preserving everything else."""
    payload = dict(load_allowlist())
    existing = set(payload.get("scoped_orphans", []))
    payload["scoped_orphans"] = sorted(existing | orphans)
    payload.setdefault(
        "_scoped_orphans_comment",
        "Scoped commands registered in a shell's generate_handler! that no client "
        "invokes, accepted as host-only. Each entry is a permission check that "
        "currently guards nothing, so this list is a work queue, not a clean bill of "
        "health. An entry that gains a caller fails the gate as stale.",
    )
    ALLOWLIST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"scoped_orphans seeded: {len(payload['scoped_orphans'])} entries")


def orphan_scoped(handlers: list[str], ui_commands: dict[str, dict]) -> list[str]:
    """Scoped commands a shell registers but no client ever invokes.

    This is the mirror image of the gap this gate enforces, and it is the one that
    cost six rounds of manual audit in 0.0.36 (backlog item 46). The sweep kept
    finding UI call sites that used an unscoped command while a `_scoped` twin with
    a real permission check sat unused. The structural cause is that nothing asks
    whether a registered scoped command is reachable at all: a command that no client
    invokes is a permission check that guards nothing, and it reads as coverage while
    contributing none. `renew_license_scoped`, `get_key_rotation_info_scoped` and
    `rotate_encryption_key_scoped` were exactly that -- SECURITY_MANAGE and
    SETTINGS_EDIT gates wired into `generate_handler!` with no caller anywhere, which
    is how they were mistaken for live security posture for several rounds.

    Scoped commands only, deliberately. The unscoped surface is legitimately reachable
    from outside the UI (setup paths, host-side callers), and policing it would bury the
    signal; `_scoped` names exist precisely because they are the session-authenticated
    front-end entry point, so a UI-less one is an anomaly worth a decision.

    A hit is not automatically a defect -- some are host-only by design -- which is why
    this reports through the same dated-allowlist mechanism as the forward direction,
    with the same stale-entry self-clean. The gate's job is to force the decision, not
    to make it.
    """
    called = set(ui_commands)
    return sorted(c for c in handlers if c.endswith("_scoped") and c not in called)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write-allowlist",
        action="store_true",
        help="seed/refresh the allowlist from the current gaps and exit",
    )
    parser.add_argument(
        "--write-scoped-orphans",
        action="store_true",
        help="add current registered-but-uncalled scoped commands to "
             "\"scoped_orphans\" in the allowlist, preserving other sections, and exit",
    )
    args = parser.parse_args()

    ui_commands = extract_ui_commands()
    handlers: dict[str, list[str]] = {}
    for shell, rel in SHELLS.items():
        lib_path = REPO_ROOT / rel
        if not lib_path.exists():
            print(f"error: shell lib missing: {rel}", file=sys.stderr)
            return 2
        handlers[shell] = extract_handlers(lib_path)

    missing: dict[str, set[str]] = {shell: set() for shell in SHELLS}
    for command in ui_commands:
        for shell in SHELLS:
            if command not in handlers[shell]:
                missing[shell].add(command)

    if args.write_allowlist:
        write_allowlist(missing)
        return 0

    allowlist = load_allowlist()
    failures: list[str] = []

    # Reverse direction: registered scoped commands with no caller.
    orphan_allow = set(allowlist.get("scoped_orphans", []))
    orphans: dict[str, list[str]] = {}
    for shell in SHELLS:
        orphans[shell] = orphan_scoped(handlers[shell], ui_commands)
    all_orphans = sorted(set().union(*[set(v) for v in orphans.values()]))
    if args.write_scoped_orphans:
        write_scoped_orphans(set(all_orphans))
        return 0

    for command in sorted(set(all_orphans) - orphan_allow):
        shells = ", ".join(s for s in SHELLS if command in orphans[s])
        failures.append(
            f"{shells}: registers scoped command '{command}' that no client invokes -- "
            f"its permission check guards nothing. Wire a caller, or add it to "
            f"{ALLOWLIST_PATH.name} \"scoped_orphans\" with a reason if it is host-only."
        )
    for command in sorted(orphan_allow - set(all_orphans)):
        if command.endswith("_scoped"):
            failures.append(
                f"stale scoped_orphans entry '{command}' -- it now has a caller; "
                f"remove it from {ALLOWLIST_PATH.name}"
            )

    for shell in SHELLS:
        allowed = set(allowlist.get(shell, []))
        for command in sorted(missing[shell] - allowed):
            refs = ", ".join(sorted(set(ui_commands[command]))[:3])
            failures.append(
                f"{shell}: UI invokes '{command}' but it is not in "
                f"{SHELLS[shell]} generate_handler (e.g. {refs})"
            )
        stale = sorted(allowed & set(handlers[shell]))
        for command in stale:
            failures.append(
                f"{shell}: stale allowlist entry '{command}' - now registered; "
                f"remove it from {ALLOWLIST_PATH.name}"
            )

    for shell in SHELLS:
        unregistered = extract_unregistered(
            shell, REPO_ROOT / SHELLS[shell], set(handlers[shell])
        )
        print(
            f"info[{shell}]: {len(ui_commands)} UI command strings, "
            f"{len(handlers[shell])} registered, "
            f"{len(missing[shell])} unregistered references "
            f"({len(unregistered)} unregistered command fns - F-006 tracker)"
        )

    if failures:
        print(f"\nFAIL: {len(failures)} IPC parity violation(s):", file=sys.stderr)
        for line in failures:
            print(f"  - {line}", file=sys.stderr)
        return 1
    print("IPC parity: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
