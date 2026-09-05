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


DEV_MOCK_REL = "ui/src/dev-mock/tauri-api.ts"


def extract_dev_mock_answerable() -> tuple[set[str], set[str]]:
    """Names the browser dev-mock can serve: (directly registered, aliasable).

    The third parity direction. The other two compare the UI against the Rust
    `generate_handler!` lists; neither asks whether the plain-browser preview can answer
    the call at all, and that omission is what let 217 invokes across 4 commands receive
    a silent `null` (backlog item 52). The component swallows the null, the test passes,
    and the assertion is quietly about the failure path -- a green suite that verifies
    nothing.

    Mirrors the real rule in that file rather than a curated list: a `_scoped` name is
    answerable if it is registered directly, or if its unscoped base is (the general
    aliasing pass added in b013005f). Keys come from two syntaxes -- object-literal
    entries and `handlers['x'] = ...` assignments -- because the file uses both, and
    reading only one is how an earlier grep wrongly concluded `get_hardware_settings`
    had no handler at all.

    The aliasing is applied only if the pass that performs it is actually present in the
    source. That guard is load-bearing: an earlier version modelled the rule in Python and
    so reported "149 answerable via the alias rule" no matter what the TypeScript said --
    deleting the loop entirely left the gate green, which mutation testing caught. A gate
    that re-derives the thing it is supposed to be checking checks nothing; it just agrees
    with itself.
    """
    text = (REPO_ROOT / DEV_MOCK_REL).read_text(encoding="utf-8", errors="replace")
    registered = set(re.findall(r"^\s*'([a-z0-9_]+)':\s*(?:\(|async|=>)", text, re.M))
    registered |= set(re.findall(r"handlers\[['\"]([a-z0-9_]+)['\"]\]\s*=", text))
    rule_present = re.search(
        r"for\s*\(\s*const\s+\w+\s+of\s+Object\.keys\(\s*handlers\s*\)\s*\)", text)
    if rule_present is None:
        # No aliasing pass means no scoped name is answerable unless registered outright.
        return registered, set()
    aliasable = {
        f"{base}_scoped" for base in registered
        if not base.endswith("_scoped") and f"{base}_scoped" not in registered
    }
    return registered, aliasable


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


def orphan_permission(command: str) -> str | None:
    """The permission a scoped command enforces, or None if it enforces no check.

    Why the gate bothers to read Rust bodies at all: an orphaned `_scoped` command is not
    one kind of thing. One whose body is only `resolve_session` then a forward is a
    redundant twin -- dead weight, but it guards nothing so it can also leak nothing, and
    19 of the 25 seeded entries are that. One that DOES call `require_permission*` is
    different in kind: it is a SECURITY_MANAGE / SETTINGS_EDIT / WORKSPACES_SWITCH gate
    wired into `generate_handler!` with no reachable caller, which reads as enforced
    posture while protecting nothing. That distinction is exactly what cost six rounds of
    manual audit in item 46, and hand-triaging 25 commands every time the list changes is
    not going to happen.

    Brace-balanced, deliberately. The first pass at this in item 46 took a fixed 900-char
    window from the signature, which for a short function runs past its closing brace and
    reports the NEXT function's permission. That produced a false security finding
    (`get_hardware_fingerprint_scoped`, which enforces nothing, was recorded as requiring
    SETTINGS_EDIT) and simultaneously hid two real ones. A fixed window is wrong in both
    directions; balance is the minimum.
    """
    for lib_rel in SHELLS.values():
        # commands/ is a sibling of lib.rs in every shell; derived rather than
        # hardcoded so a new shell needs no edit here.
        cmd_dir = (REPO_ROOT / lib_rel).parent / "commands"
        if not cmd_dir.is_dir():
            continue
        for rs in sorted(cmd_dir.glob("*.rs")):
            text = rs.read_text(encoding="utf-8", errors="replace")
            m = re.search(r"\bfn\s+" + re.escape(command) + r"\s*\(", text)
            if not m:
                continue
            open_idx = text.find("{", m.end())
            if open_idx < 0:
                continue
            depth, j = 0, open_idx
            while j < len(text):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            body = text[m.start():j + 1]
            if "require_permission" not in body:
                return None
            p = re.search(r"permissions::([A-Z_]+)", body)
            return p.group(1) if p else "UNKNOWN"
    return None


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
    parser.add_argument(
        "--write-dev-mock-gaps",
        action="store_true",
        help="add current UI-invoked commands the dev-mock cannot answer to "
             "\"dev_mock\" in the allowlist, preserving other sections, and exit",
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

    # Third direction: can the plain-browser dev-mock answer what the UI invokes?
    mock_registered, mock_aliasable = extract_dev_mock_answerable()
    mock_answerable = mock_registered | mock_aliasable
    mock_gaps = sorted(c for c in ui_commands if c not in mock_answerable)
    if args.write_dev_mock_gaps:
        payload = dict(load_allowlist())
        payload["dev_mock"] = sorted(set(payload.get("dev_mock", [])) | set(mock_gaps))
        ALLOWLIST_PATH.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return 0

    for command in sorted(set(all_orphans) - orphan_allow):
        shells = ", ".join(s for s in SHELLS if command in orphans[s])
        perm = orphan_permission(command)
        guarded = (
            f"enforces {perm}, so that check currently guards nothing"
            if perm else "enforces no permission, so it is a redundant twin"
        )
        failures.append(
            f"{shells}: registers scoped command '{command}' that no client invokes -- it "
            f"{guarded}. Wire a caller, or add it to {ALLOWLIST_PATH.name} "
            f"\"scoped_orphans\" with a reason if it is host-only."
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

    mock_allow = set(allowlist.get("dev_mock", []))
    for command in sorted(set(mock_gaps) - mock_allow):
        refs = ", ".join(sorted(set(ui_commands[command]))[:3])
        failures.append(
            f"dev-mock: UI invokes '{command}' but {DEV_MOCK_REL} cannot answer it "
            f"(no handler, and no unscoped twin to alias) -- invoke() returns null and "
            f"the caller silently renders its failure path (e.g. {refs})"
        )
    for command in sorted(mock_allow - set(mock_gaps)):
        failures.append(
            f"stale dev_mock entry '{command}' -- the mock can now answer it; "
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

    print(
        f"info[dev-mock]: {len(mock_registered)} handlers registered, "
        f"{len(mock_aliasable)} more answerable via the scoped alias rule, "
        f"{len(mock_gaps)} of {len(ui_commands)} UI commands unanswerable "
        f"({len(mock_allow)} allowlisted)"
    )

    # Triage summary for the allowlisted orphans. Printed even when green, because an
    # allowlist that reports nothing is an allowlist nobody re-reads: the gated ones are
    # the entries that deserve attention, and without this line all 25 look identical.
    gated = [c for c in all_orphans if orphan_permission(c)]
    if all_orphans:
        detail = ", ".join(
            f"{c}={orphan_permission(c)}" for c in sorted(gated)) or "none"
        print(
            f"info[scoped-orphans]: {len(all_orphans)} allowlisted, "
            f"{len(all_orphans) - len(gated)} redundant twins (no check), "
            f"{len(gated)} GATED DEAD SURFACE -> {detail}"
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
