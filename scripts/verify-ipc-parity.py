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
- Dev-mock side: every `.ts`/`.tsx` file under `ui/src/dev-mock/`, read
  recursively, because that surface is a tree now and not a file -- the
  gate walks the whole tree as of cb0175ce26, and read only the router
  before it. The router (`tauri-api.ts`) holds 214 of the 536 registered
  names; the rest live in `handlers/<domain>.ts` and the `_scoped`
  aliasing pass lives in `core/mockDispatcher.ts`. The matching
  `"dev_mock"` section of the allowlist is a flat list of command names
  with no reason field, for the reason recorded on
  `extract_dev_mock_answerable`.

Usage:
  python3 scripts/verify-ipc-parity.py              # enforce
  python3 scripts/verify-ipc-parity.py --write-allowlist  # seed/refresh
  python3 scripts/verify-ipc-parity.py --self-test  # prove the parsers can fail
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


# The dev-mock surface is a TREE, not a file. ce8666604 moved the scoped-aliasing pass
# out of ui/src/dev-mock/tauri-api.ts into ui/src/dev-mock/core/mockDispatcher.ts, and the
# refactor work orders after it extracted roughly 320 handler names into
# ui/src/dev-mock/handlers/<domain>.ts. A gate that kept reading the one named file saw
# 215 of 536 registrations, the alias loop looked "absent", the answerable set collapsed
# to the router alone, and the gate reported 294 of 453 UI commands unanswerable while the
# mock answered every one of them at runtime. That is the CI red at HEAD: code that moved,
# not a surface that broke. So walk the tree, find the loop anywhere in it, and stop
# naming a single file.
DEV_MOCK_DIR_REL = "ui/src/dev-mock"
DEV_MOCK_ROUTER_REL = "ui/src/dev-mock/tauri-api.ts"

# Registration syntaxes that actually occur under the tree, quoted from the sources
# rather than guessed (locations are from the tree at fix time):
#   'list_customers': () => MOCK_CUSTOMERS,           handlers/crm.ts:27   inline arrow
#   'get_supplier': async (args) => {...},            inline async arrow
#   'end_inventory_shift': () => null                 bare arrow after the colon
#   'get_over_quota_report': getMockOverQuotaReport,  handlers/analytics.ts:70  named ref
#   handlers['get_hardware_settings'] = ...           tauri-api.ts (34 sites)
# Both single- and double-quoted keys are accepted; only the first exists today, and the
# tolerance is free because a key still has to carry a function-shaped value.
MOCK_LITERAL_KEY_RE = re.compile(
    r"""^[ \t]*['"]([a-z0-9_]+)['"][ \t]*:"""
    r"""[ \t]*(?:\(|async\b|=>|[A-Za-z_$][A-Za-z0-9_$]*[ \t]*,?[ \t]*$)""",
    re.M,
)
MOCK_BRACKET_ASSIGN_RE = re.compile(
    r"""handlers\[['"]([a-z0-9_]+)['"]\][ \t]*=""")
# The real aliasing pass, in applyScopedAliases (core/mockDispatcher.ts:84), whose patch
# site is handlers[scoped] = twin at :92. Matched, never modelled -- see the guard note
# in extract_dev_mock_answerable.
MOCK_ALIAS_LOOP_RE = re.compile(
    r"for\s*\(\s*const\s+\w+\s+of\s+Object\.keys\(\s*handlers\s*\)\s*\)")
_MOCK_COMMENT_LINE_RE = re.compile(r"^[ \t]*(?://|/\*|\*)")


def _mock_code(text: str) -> str:
    """Blank whole-line comments out of one source before matching keys.

    Not cosmetic. core/mockDispatcher.ts documents the patch idiom in prose -- the line
    reads "and then patches individual ones with handlers['name'] = ..." -- and a scanner
    over the whole tree matched that sentence and registered a command literally named
    "name". Code keys are never indented under a comment marker, so dropping those lines
    removes both prose artifacts measured at fix time ("name", "x") and loses nothing
    real.
    """
    return "\n".join(
        "" if _MOCK_COMMENT_LINE_RE.match(line) else line
        for line in text.splitlines()
    )


def read_dev_mock_sources() -> list[tuple[str, str]]:
    """Every TS source under the dev-mock tree as (posix-relative path, text)."""
    base = REPO_ROOT / DEV_MOCK_DIR_REL
    if not base.is_dir():
        raise SystemExit(f"error: dev-mock tree missing: {DEV_MOCK_DIR_REL}")
    sources: list[tuple[str, str]] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.suffix not in (".ts", ".tsx"):
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            print(f"warn: cannot read {rel}: {exc}", file=sys.stderr)
            continue
        sources.append((rel, text))
    return sources


def parse_dev_mock(
    sources: list[tuple[str, str]],
) -> tuple[dict[str, set[str]], str | None]:
    """Split (path, text) sources into ({path: registered names}, alias-loop path).

    Pure over its input, which is what lets --self-test feed it synthetic sources held in
    memory. alias_file is None when no file under the tree carries the pass -- that is the
    answerable-set-collapses signal, not an error to swallow.
    """
    per_file: dict[str, set[str]] = {}
    alias_file: str | None = None
    for rel, raw in sources:
        text = _mock_code(raw)
        names = set(MOCK_LITERAL_KEY_RE.findall(text))
        names |= set(MOCK_BRACKET_ASSIGN_RE.findall(text))
        if names:
            per_file[rel] = names
        if alias_file is None and MOCK_ALIAS_LOOP_RE.search(text):
            alias_file = rel
    return per_file, alias_file


def answerable_sets(
    per_file: dict[str, set[str]], alias_file: str | None
) -> tuple[set[str], set[str]]:
    """(directly registered, additionally answerable via the scoped alias rule)."""
    registered: set[str] = set()
    for names in per_file.values():
        registered |= names
    if alias_file is None:
        # No aliasing pass means no scoped name is answerable unless registered outright.
        return registered, set()
    aliasable = {
        f"{base}_scoped" for base in registered
        if not base.endswith("_scoped") and f"{base}_scoped" not in registered
    }
    return registered, aliasable


def extract_dev_mock_answerable() -> tuple[set[str], set[str], dict[str, set[str]], str | None]:
    """Names the browser dev-mock can serve.

    Returns (directly registered, aliasable, per-file names, file holding the alias pass).

    The third parity direction. The other two compare the UI against the Rust
    generate_handler! lists; neither asks whether the plain-browser preview can answer the
    call at all, and that omission is what let 217 invokes across 4 commands receive a
    silent null (backlog item 52). The component swallows the null, the test passes, and
    the assertion is quietly about the failure path -- a green suite that verifies nothing.

    Mirrors the real rule rather than a curated list: a _scoped name is answerable if it is
    registered directly, or if its unscoped base is (the general aliasing pass added in
    b013005f, now applyScopedAliases). Every key syntax the tree uses is read -- inline
    function, named-function reference, and handlers['x'] = ... -- because no single one
    covers it, and reading only one is how an earlier grep wrongly concluded
    get_hardware_settings had no handler at all. The identifier branch is anchored to
    end-of-line (optional trailing comma) so only a bare function reference counts;
    'key': expr data entries cannot inflate the set. Unquoted keys are deliberately NOT
    matched -- under the tree they are all data or type members (sale_count: (i * 3) % 14,
    seed: () => T), so widening there would inflate the answerable set with non-registrars.
    The walk covers the whole tree and finds the aliasing pass wherever it lives, for the
    reason recorded on DEV_MOCK_DIR_REL.

    The aliasing is applied only if the pass that performs it is actually present in the
    source. That guard is load-bearing: an earlier version modelled the rule in Python and
    so reported "149 answerable via the alias rule" no matter what the TypeScript said --
    deleting the loop entirely left the gate green, which mutation testing caught. A gate
    that re-derives the thing it is supposed to be checking checks nothing; it just agrees
    with itself. So this still reads the code, and --self-test asserts that the present and
    absent answers differ.

    What the allowlist cannot tell you, which every number printed from here depends on you
    knowing: the "dev_mock" section is a flat list of command names with no reason field,
    and it can only ever be that. load_allowlist parses the file with json.loads and no
    schema, and every consumer coerces its section through set(), so a dict member does not
    degrade to a lost annotation -- it raises TypeError: unhashable type and the gate dies.
    A name on the list therefore reads identically whether a slice asked for a browser
    exemption and somebody agreed, or whether nobody has looked at it since it was written.
    The presence side is honest at least: an entry whose handler lands turns the gate RED as
    stale, so the list cannot rot into a lie in that direction. What is lopsided is the
    editing. --write-dev-mock-gaps unions today's gaps in, alphabetised and additive only,
    so widening this allowlist is one command line in any session while shrinking it is a
    manual edit a human has to remember to make. That asymmetry is a toolchain decision for
    whoever owns the flags, not for this gate to invent an answer to, so it is recorded here
    rather than fixed.
    """
    per_file, alias_file = parse_dev_mock(read_dev_mock_sources())
    registered, aliasable = answerable_sets(per_file, alias_file)
    return registered, aliasable, per_file, alias_file


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


# ---------------------------------------------------------------------------
# Self-test: the dev-mock parsers, against synthetic sources in memory.
# ---------------------------------------------------------------------------

_SELFTEST_ROUTER = """
const entryHandlers: Record<string, MockHandler> = {
  'alpha': (args) => args,
  'beta': async () => null,
  'gamma': () => 1,
  'delta': helperDelta,
  'not_a_registration': { id: 1 },
  sale_count: (i * 3) % 14,
};
registerHandlers(entryHandlers);
handlers['epsilon'] = () => 2;
// handlers['from_a_comment'] = () => 3;
"""

_SELFTEST_MODULE = """
export const probeHandlers: Record<string, MockHandler> = {
  'zeta': (args) => args,
  'eta': helperEta,
  'alpha_scoped': () => null,
};
"""

_SELFTEST_ALIAS_LOOP = """
export function applyScopedAliases(): void {
  for (const base of Object.keys(handlers)) {
    if (base.endsWith('_scoped')) continue;
    const scoped = base + '_scoped';
    const twin = handlers[base];
    if (twin !== undefined && handlers[scoped] === undefined) {
      handlers[scoped] = twin;
    }
  }
}
"""

_SELFTEST_NO_LOOP = """
export function applyScopedAliases(): void {
  // the pass was removed
}
"""

_SELFTEST_LOOP_ONLY_IN_COMMENT = """
export function applyScopedAliases(): void {
  /**
   * It used to read: for (const base of Object.keys(handlers)) { ... }
   */
}
"""


def self_test() -> int:
    """Exercise the dev-mock parsers on synthetic sources and prove they can fail.

    Why this exists, stated plainly because it is the reason the gate went red for the
    wrong reason: the dev-mock extraction shipped with zero self-test coverage, and the
    defect it now carries is exactly the class a self-test catches. The TypeScript moved
    files, the parser kept looking in one, and it returned a smaller set instead of an
    error -- 215 of 536 names, 0 aliasable, 294 commands reported unanswerable -- while
    still exiting 1 loudly enough to look like a real finding. A checker whose parsers
    silently break checks nothing; it just disagrees with the codebase. Same reasoning as
    verify-ftl-orphans.py --self-test.

    parse_dev_mock and answerable_sets take sources as data, so every case below is a
    string in memory: nothing is written to disk, and ui/src/dev-mock is never the
    fixture. The five cases are the ones that would each have caught a different way this
    gate can lie -- a key in the router, a key in an extracted module (the moved-code
    bug), the handlers[...] = patch form, the alias pass present, and the alias pass
    absent (the collapse the mutation test already proved load-bearing). Case 2 is the
    regression itself: as of cb0175ce26 the gate walks the whole ui/src/dev-mock tree, and
    a parser that goes back to reading only the router fails here, not in CI six weeks
    later with a fabricated number attached.
    """
    router = DEV_MOCK_ROUTER_REL
    module = DEV_MOCK_DIR_REL + "/handlers/probe.ts"
    dispatcher = DEV_MOCK_DIR_REL + "/core/mockDispatcher.ts"
    tree = [(router, _SELFTEST_ROUTER), (module, _SELFTEST_MODULE)]
    tree_with_pass = tree + [(dispatcher, _SELFTEST_ALIAS_LOOP)]

    results: list[tuple[str, bool]] = []

    def case(name: str, ok: bool) -> None:
        results.append((name, bool(ok)))

    # 1 + 2: a key in the router, a key in an extracted module. The two answers MUST
    # differ, or the walk is reading one file again.
    per_router, _loop_r = parse_dev_mock([(router, _SELFTEST_ROUTER)])
    per_tree, _loop_t = parse_dev_mock(tree_with_pass)
    reg_router = answerable_sets(per_router, None)[0]
    reg_tree = answerable_sets(per_tree, None)[0]
    case("case 1  router key read", {"alpha", "beta", "gamma", "delta"} <= reg_router)
    case("case 2  extracted-module key read", {"zeta", "eta"} <= reg_tree)
    case("case 2  module widens the answer", reg_tree != reg_router)
    case("case 2  per-file split kept", per_tree.get(router) == per_router.get(router)
         and module in per_tree)

    # 3: the handlers['x'] = patch form, differentially (drop the line, lose the name).
    case("case 3  bracket assignment read", "epsilon" in reg_router)
    per_nobracket, _ = parse_dev_mock([(router, _SELFTEST_ROUTER.replace(
        "handlers['epsilon'] = () => 2;", ""))])
    case("case 3  bracket assignment is what carried it",
         "epsilon" not in answerable_sets(per_nobracket, None)[0])

    # Extraction guards: an over-broad parser is as much a lie as an under-broad one, so
    # the 16-gap figure stays honest. Data entries, unquoted members and prose must all
    # stay out of the set.
    case("guard   'key': data entry not counted", "not_a_registration" not in reg_tree)
    case("guard   unquoted member not counted", "sale_count" not in reg_tree)
    case("guard   prose in a comment not counted",
         "from_a_comment" not in reg_tree and "name" not in reg_tree)

    # 4: alias pass present -- every unscoped base gains its _scoped twin, and a genuinely
    # registered twin is not double-counted.
    aliasable = answerable_sets(per_tree, dispatcher)[1]
    answer_with = answerable_sets(per_tree, dispatcher)[0] | aliasable
    case("case 4  alias pass found in the tree", _loop_t == dispatcher)
    case("case 4  aliasing adds scoped twins",
         {"beta_scoped", "gamma_scoped", "delta_scoped", "epsilon_scoped",
          "zeta_scoped", "eta_scoped"} <= aliasable)
    case("case 4  registered twin not double-counted", "alpha_scoped" not in aliasable
         and "alpha_scoped" in answer_with)

    # 5: alias pass absent -- the set collapses. Load-bearing guard, and it has to fail
    # the same way the deleted-loop mutation test demanded.
    aliasable_none = answerable_sets(per_tree, None)[1]
    answer_without = answerable_sets(per_tree, None)[0] | aliasable_none
    case("case 5  alias pass absent collapses to empty", aliasable_none == set())
    case("case 5  present and absent answers differ", answer_with != answer_without)

    # Location independence, both directions: the pass is found wherever it sits under the
    # tree, and a commented-out pass is NOT found.
    _per_moved, loop_moved = parse_dev_mock([(router, _SELFTEST_ROUTER),
                                             (module, _SELFTEST_ALIAS_LOOP)])
    case("guard   alias pass found outside the dispatcher", loop_moved == module)
    _per_gone, loop_gone = parse_dev_mock([(router, _SELFTEST_ROUTER),
                                           (dispatcher, _SELFTEST_LOOP_ONLY_IN_COMMENT)])
    case("guard   commented-out alias pass is not counted present", loop_gone is None)
    _per_removed, loop_removed = parse_dev_mock([(router, _SELFTEST_ROUTER),
                                                (dispatcher, _SELFTEST_NO_LOOP)])
    case("guard   removed alias pass is not counted present", loop_removed is None)

    # Real tree last: the gate must still see the loop where it lives today, and it must
    # see more than the router alone. This is the assertion the shipped bug fails.
    real_per, real_loop = parse_dev_mock(read_dev_mock_sources())
    real_reg, real_alias = answerable_sets(real_per, real_loop)
    case("real    alias pass located under the tree",
         real_loop is not None and real_loop.startswith(DEV_MOCK_DIR_REL + "/"))
    case("real    walk covers more than the router",
         len(real_reg) > len(real_per.get(DEV_MOCK_ROUTER_REL, set())) and len(real_alias) > 0)

    failed = [name for name, ok in results if not ok]
    for name, ok in results:
        if not ok:
            print(f"FAIL self-test: {name}", file=sys.stderr)
    named = {c.split()[1] for c, _ in results if c.startswith("case ")}
    print(f"self-test: {len(named)} cases + "
          f"{sum(1 for c, _ in results if not c.startswith('case '))} extra guards, "
          f"{len(results)} assertions total; real tree {len(real_reg)} registered + "
          f"{len(real_alias)} aliasable from {len(real_per)} files")
    if failed:
        print(f"self-test: {len(failed)} FAILURE(S)", file=sys.stderr)
        return 1
    print("self-test: OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="exercise the dev-mock parsers against synthetic sources held in memory and "
             "exit; nonzero means the gate can no longer see the surface it claims to check",
    )
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
             "\"dev_mock\" in the allowlist, preserving other sections, and exit "
             "(additive only -- it never removes an entry, so shrinking the list is a "
             "manual edit)",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

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
    mock_registered, mock_aliasable, mock_per_file, mock_alias_file = (
        extract_dev_mock_answerable())
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
            f"dev-mock: UI invokes '{command}' but no handler anywhere under "
            f"{DEV_MOCK_DIR_REL} registers it (the router and every extracted module "
            f"under it were read, and no unscoped twin exists for the alias rule to "
            f"reach) -- invoke() returns null and the caller silently renders its "
            f"failure path (e.g. {refs}). An allowlist entry is a bare name with no "
            f"reason attached; see the dev_mock section comment."
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

    # Router vs extracted modules, because "215 handlers registered" is the number the
    # one-file reading used to print and it was not wrong so much as incomplete: the
    # split is what tells a reader a gap is missing code or merely a missing file.
    mock_sources = read_dev_mock_sources()
    router_names = mock_per_file.get(DEV_MOCK_ROUTER_REL, set())
    module_names = set().union(*[
        v for k, v in mock_per_file.items() if k != DEV_MOCK_ROUTER_REL]) if (
        len(mock_per_file) > 1) else set()
    print(
        f"info[dev-mock]: {len(mock_registered)} handlers registered across "
        f"{len(mock_per_file)} of {len(mock_sources)} files under {DEV_MOCK_DIR_REL} "
        f"(router {len(router_names)}, extracted modules "
        f"{len(module_names - router_names)} new), "
        f"{len(mock_aliasable)} more answerable via the scoped alias rule"
        + (f" (pass at {mock_alias_file})" if mock_alias_file
           else " (ALIASING PASS NOT FOUND -- scoped names collapse)"),
    )
    print(
        f"info[dev-mock]: {len(mock_gaps)} of {len(ui_commands)} UI commands unanswerable "
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
