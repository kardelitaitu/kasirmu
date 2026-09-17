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
  `"dev_mock"` section of the allowlist carries one entry per gap, either a bare
  command name or a {"name", "reason"} object -- see `allowlist_section` -- and the
  reason state of that section is printed on every run, green or red.

Usage:
  python3 scripts/verify-ipc-parity.py              # enforce
  python3 scripts/verify-ipc-parity.py --write-allowlist  # seed/refresh
  python3 scripts/verify-ipc-parity.py --self-test  # prove the parsers can fail

Three exit codes, and the gap between them is the contract, exactly as in
scripts/verify-ftl-orphans.py: 0 is a clean verdict, 1 is a VERDICT that found something --
`FAIL: N IPC parity violation(s)`, or a wrong ENTRY inside an allowlist this run could read --
and 2 is a refusal that graded nothing: a shell lib missing, or a shared allowlist that did
not arrive as an object stating every enforced section as a list -- that last question is asked
of scripts/allowlist-schema.py, the one schema both gates share, with the required set and the
merged sentence kept here -- or a `--write-*` flag whose
own write did not happen (`AllowlistWriteRefused` -- the file moved under this run, the target
would not accept the rename, the swap failed outright). A write that did not happen is a WRITE
problem and gets the refusal code; it says nothing about anybody's command names. A crash
must never spend 1, because 1 is the number a reader (and
`apps/tablet-client/src/commands/sync.rs:639`) treats as evidence about real commands. See
`AllowlistUnusable`.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import re
import sys
import time
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

UI_SCAN_DIRS = [
    "ui/src/api",
    "ui/src/hooks",
    "ui/src/app",
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

# The question "is this parsed document an allowlist at all" is answered in
# scripts/allowlist-schema.py since 0454b542e4, shared with scripts/verify-scoped-reads.py,
# because the repo holding two private definitions of valid is what let one file be GRADED by
# one gate and REFUSED by the other, both correct under their own rule. What stays HERE is the
# policy: which sections this gate requires, and what it does with the answer. The import is by
# path because the filename has a hyphen, which no import statement can spell -- renaming the
# module to dodge three lines of importlib is not a trade worth making, and it is reversible by
# construction. Lazy rather than top-level on purpose: an eager import of an absent or broken
# validator raises at module load, out of main(), and an uncaught exception exits 1, which
# spends the VERDICT code on a missing file -- the exact confusion AllowlistUnusable exists to
# end. So it is loaded where it can be refused in words.
ALLOWLIST_SCHEMA_PATH = REPO_ROOT / "scripts" / "allowlist-schema.py"
_SCHEMA_BY_PATH: dict[str, object] = {}

# loggedInvoke<Foo>('cmd', ...) / invoke('cmd', ...) — the generic
# parameter list (if any) may not contain parens, which keeps the regex
# away from nested call boundaries.
UI_INVOKE_RE = re.compile(
    r"(?:loggedInvoke|invoke)(?:<[^()]*>)?\(\s*['\"]([a-z0-9_]+)['\"]"
)

HANDLER_BLOCK_RE = re.compile(r"generate_handler!\[", re.S)
ENTRY_RE = re.compile(r"^(?:[a-z0-9_]+(?:::[a-z0-9_]+)+|[a-z0-9_]+)$")
COMMAND_FN_RE = re.compile(
    # Both spellings of the attribute. `#[command]` is the short form of the same token, used
    # wherever a file has `use tauri::command;` -- which is how this shell's tablet modules are
    # written. Matching only the qualified form made this leg blind to nearly the whole tablet:
    # measured 2026-09-16 in three stages. Qualified form only: 20 of the tablet's command
    # declarations were visible and the leg printed 0 unregistered. Short form added: 326
    # visible, 59 unregistered. command_fns_in() also taught to look past a doc comment or a
    # second attribute between the token and its signature: 441 visible, 122 unregistered (and
    # the desktop went 16 -> 16 -> 43). No record of mine ever cited that first 0 as an
    # argument -- I asserted as much in an earlier draft of this comment and it was false, so it
    # is corrected here rather than left standing -- but the number was printed on every run and
    # read as clean, which is what the eight f006 fixtures in self_test() are for.
    r"#\[(?:tauri::)?command\]\s*pub (?:async )?fn ([a-z0-9_]+)"
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


# The ADR #7 pattern in the UI is a two-arm choice: with a session token call the scoped
# wrapper, without one call the unscoped wrapper. Both wrappers exist in `ui/src/api/*.ts`, and
# the parity leg grades the command each one invokes. What nothing asked until 2026-09-16 is
# whether the ELSE arm is reachable at all: `list_scanners`, `create_product`, `adjust_stock`
# and fourteen others are named by production UI code, allowlisted as known gaps, and have a
# Rust body in the tablet -- but are registered in NEITHER shell, so the no-token branch of a
# tested hook resolves to "command not found" in a production build while Vitest mocks the
# wrapper (`useBarcodeScanner.test.tsx` asserts the branch fires) and the dev-mock answers the
# key (`system.ts:501 'list_scanners': ...`). That is the defect class this programme keeps
# meeting: two instruments agreeing with each other and neither touching reality.
UI_EXPORT_INVOKE_RE = re.compile(
    r"export const ([A-Za-z]\w*)[\s\S]{0,320}?loggedInvoke(?:<[^>]*>)?\(\s*[\"']([a-z0-9_]+)[\"']"
)
# `sessionToken ? () => scopedWrapper(sessionToken) : plainWrapper` and the call-immediately
# form, captured as (token-taking wrapper, fallback wrapper).
UI_FALLBACK_TERNARY_RE = re.compile(
    r"sessionToken\s*\?\s*(?:\(\s*[^)]*\)\s*=>\s*)?([A-Za-z]\w*)\s*\(([^)]*)\)\s*:\s*([A-Za-z]\w*)\b"
)
# The parameter list in the optional arrow prefix is load-bearing and was missing until 2026-09-16:
# it used to be `(\s*)`, which matches only a ZERO-ARGUMENT arm. So
#     const start = sessionToken ? (id: string) => startScannerScoped(sessionToken, id) : startScanner
# did not match at all, while `? () => stopScannerScoped(sessionToken) : stopScanner` did -- and the
# leg under-reported its own population because of it: `start_scanner` and `lookup_by_barcode` sit in
# exactly that shape at ui/src/features/sales/useBarcodeScanner.ts:63 and :83 and never appeared in
# the counts the T21 decision was going to be made from. Same shape as the round-24 near-miss, where
# requiring `wrapper(` hid every bare `: listScanners`: a matcher written against the FIRST form it
# saw reads as a clean census of a family it cannot see. `[^)]*` cannot cross the closing paren of
# the parameter list, so widening it this far is safe.


def no_token_fallbacks(
    files: list[tuple[str, str]], registered: set[str]
) -> dict[str, list[str]]:
    """Unregistered commands the UI reaches through a no-session branch, by command.

    Pure over (relative path, text) pairs and a registered set so the self-test can hand it a
    fabricated tree: the whole point of the leg is a claim about a shape, and a check that
    cannot be shown red cannot be trusted green.
    """
    wrapper_to_cmd: dict[str, str] = {}
    for _, text in files:
        for fn, cmd in UI_EXPORT_INVOKE_RE.findall(text):
            wrapper_to_cmd.setdefault(fn, cmd)
    gaps: dict[str, list[str]] = {}
    for rel, text in files:
        for number, line in enumerate(text.splitlines(), 1):
            for scoped, _args, fallback in UI_FALLBACK_TERNARY_RE.findall(line):
                cmd = wrapper_to_cmd.get(fallback)
                if not cmd or cmd in registered:
                    continue
                # The token arm must itself be a real wrapper, or this is some other ternary
                # that happens to mention a token and an unregistered name.
                if wrapper_to_cmd.get(scoped) == cmd + "_scoped" or wrapper_to_cmd.get(scoped):
                    gaps.setdefault(cmd, []).append(f"{rel}:{number}")
    return gaps


# `export const listProducts = (sessionToken) => loggedInvoke('list_products_scoped', ...)`,
# read as (wrapper, command). A wrapper is a NAME; the question this exists to ask is whether
# anything besides the wrapper's own file and its contract test uses it.
API_WRAPPER_RE = re.compile(
    r"export (?:const|async function|function) ([A-Za-z]\w*)"
    r"[\s\S]{0,320}?loggedInvoke(?:<[^>]*>)?\(\s*[\"']([a-z0-9_]+)[\"']"
)


def wrapper_reach(files: list[tuple[str, str]], cmd: str) -> dict[str, list[str]]:
    """Who references the wrappers that invoke `cmd`, split by where the reference lives.

    Three buckets, because "the UI invokes it" has been read as one claim where the tree
    holds three. `runtime` is a screen, hook, context or component -- code that runs in a
    shipped build. `client` is `ui/src/api/client`, a programmatic facade that is a public
    surface of its own and is legitimately callable from outside the app. `api` is a wrapper
    file other than the one that defines it. A command whose only references are in
    `__tests__` and `ui/src/dev-mock` lands in none of them, which is what "the UI invokes
    it" was hiding: contract suites named
    `api-*-contract.test.ts` exist to pin the command string inside a wrapper, so they call
    `updateProduct(args)` forever while every screen imports `updateProductScoped`, and the
    parity leg counts that as the front-end asking for an unscoped door.
    """
    wrappers = {w for path, text in files if "/api/" in f"/{path}" or path.startswith("ui/src/api")
                for w, c in API_WRAPPER_RE.findall(text) if c == cmd}
    out: dict[str, list[str]] = {"runtime": [], "client": [], "api": []}
    if not wrappers:
        return out
    for path, text in files:
        if path.startswith("ui/src/api/client"):
            bucket = "client"
        elif path.startswith("ui/src/api"):
            bucket = "api"
        else:
            bucket = "runtime"
        for w in wrappers:
            if re.search(r"(?<![\w.])" + re.escape(w) + r"\b", text):
                # The defining file is not a reference to itself.
                if bucket == "api" and re.search(r"export (?:const|async function|function) "
                                                + re.escape(w) + r"\b", text):
                    continue
                out[bucket].append(f"{path}#{w}")
    return out


def ui_runtime_files() -> list[tuple[str, str]]:
    """UI sources that can execute in a shipped build: no tests, no dev-mock."""
    out: list[tuple[str, str]] = []
    for scan_dir in UI_SCAN_DIRS:
        base = REPO_ROOT / scan_dir
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.suffix not in (".ts", ".tsx"):
                continue
            if "__tests__" in path.parts or "dev-mock" in path.parts:
                continue
            try:
                out.append((path.relative_to(REPO_ROOT).as_posix(),
                            path.read_text(encoding="utf-8")))
            except (OSError, UnicodeDecodeError):
                continue
    return out


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


COMMAND_ATTR_RE = re.compile(r"""^\s*#\[(?:tauri::)?command(?:\([^\]]*\))?\]\s*$""")
COMMAND_SIG_RE = re.compile(r"""^\s*pub (?:async )?fn ([a-z0-9_]+)""")
# A line that may legally sit between the attribute and the signature: blank, any comment
# form, or any other attribute. Rust allows all of them, in any order and quantity.
COMMAND_GAP_RE = re.compile(r"""^\s*(?://|/\*|\*/|#!?\[|$)""")


def command_fns_in(text: str) -> set[str]:
    """Every command function defined in one source, attributes and all.

    Two passes, unioned, because each catches what the other cannot:

    * `COMMAND_FN_RE` handles the compact form, including an attribute and its signature on
      the SAME line, which a line-oriented walk would never find.
    * the walk handles what that regex cannot: a `#[command]` or `#[tauri::command]` separated
      from its `pub fn` by a doc comment or another attribute. Tauri accepts both, and this
      tree uses both -- measured 2026-09-16, the single-regex pass saw 430 of the desktop's
      495 command definitions and 326 of the tablet's 441, so this leg printed 16 and 59 where
      the honest figures are 43 and 122.

    That difference also closes a question this programme left open in its own plan file: a
    pass recorded "`#[tauri::command]` definition sites 496 against 453 registered paths, and
    parity grades a name-level form of the same gap and prints 16; 43 != 16 is a unit
    difference -- sites against names -- and this pass did not reconcile them". It was not a
    unit difference. 496 - 453 is 43, and 43 is exactly what the walk reports as unregistered;
    the note's own arithmetic was right and its explanation was wrong, because the 496 and the
    16 were counting the same population with a parser that could see only part of it.

    The walk stops at the first line that is not blank, not a comment and not another
    attribute, so an attribute sitting over something that is not a `pub fn` contributes
    nothing -- the case `f006   an attribute over a non-function is not a command` holds open.
    """
    names = set(COMMAND_FN_RE.findall(text))
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not COMMAND_ATTR_RE.match(line):
            continue
        j = i + 1
        while j < len(lines) and COMMAND_GAP_RE.match(lines[j]):
            j += 1
        if j < len(lines):
            sig = COMMAND_SIG_RE.match(lines[j])
            if sig:
                names.add(sig.group(1))
    return names


def extract_unregistered(shell: str, lib_path: Path, registered: set[str]) -> list[str]:
    """Command fns in the shell that are not registered -- either attribute spelling."""
    unregistered: list[str] = []
    commands_dir = lib_path.parent / "commands"
    for path in sorted(commands_dir.rglob("*.rs")):
        if path.name.endswith("_tests.rs"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for fn in command_fns_in(text):
            if fn not in registered:
                unregistered.append(fn)
    return sorted(set(unregistered))


PROSE_LINE_RE = re.compile(r"^\s*(?://[/*]?|\*)")
DEF_LINE_RE = re.compile(r"^\s*pub (?:async )?fn\b")
# The text immediately before a match, when the match is the name being DEFINED. `DEF_LINE_RE`
# only anchors the `pub` form, so `#[test] fn list_roles()` read as a call of the `list_roles`
# command; this catches any visibility, and `async` anywhere in the prefix.
FN_DEFINITION_BEFORE_RE = re.compile(r"\bfn\s+$")
TYPE_QUALIFIER_RE = re.compile(r"[A-Z]|^Self$")
# Path prefixes that name somebody else's function. This is the shape the whole sharing
# programme produces, so it is not an edge case: a desktop shim whose own body reads
#     kasirmu_bridge::settings::get_receipt_settings(&ctx)
# inside `pub async fn get_receipt_settings`. A name search sees a call to
# `get_receipt_settings` and grades the command as load-bearing, when what it found is the
# shim reaching the bridge's version of the same name. `crate::` is deliberately absent -- a
# same-crate path call really is this shell's function.
FOREIGN_PATH_ROOTS = {
    # Missing one of these silently grades a delegation shim as a load-bearing command, so
    # the list is deliberately wide where it is real. The four `oz_` roots that sat here
    # during the crate rename were dropped once no `oz_x::` site remained on the tree.
    "kasirmu_bridge", "kasirmu_core", "kasirmu_lan", "kasirmu_local_api",
    "tauri", "std", "core", "alloc",
}


def fn_call_sites(name: str, sources: list[tuple[str, str]]) -> list[str]:
    """Lines in `sources` that call the free function `name`, as ["label:line", ...].

    Five exclusions, and every one of them was paid for. A probe written for this leg on
    2026-09-16 counted none of them and reported 78 of 101 unreachable command fns as "live
    helpers wearing a stale `#[command]` attribute" -- a conclusion that would have stopped
    the thinning on a false premise. The calls it saw were `store.create_bundle(&bundle,
    &items)`: a `Store` method that shares the command's spelling, which is the same
    collision direction as the sweep-marker error recorded in T13, one layer over. The fifth
    exclusion was earned after the first commit of this leg shipped, when its "32 desktop
    helpers" turned out to be mostly shim bodies.

    * preceded by `.`  -> a method call on a value, not this function.
    * preceded by `::` -> a path call. Kept only when the qualifier is a module path inside
      this crate (`super::x`, `crate::commands::auth::x`) and dropped when it is a type
      (`Store::x`, `Self::x`) or another crate in the workspace (FOREIGN_PATH_ROOTS). Whether
      the qualifier is a module or a type is read off the capitalisation of the segment before
      the `::`, which is a heuristic and not a parser: the false negative it accepts is a
      module named like a type, and this tree has none.
    * a `///`, `//` or `*` line -> prose. Two earlier probes in this programme were
      contaminated exactly that way.
    * any line inside a `/* ... */` block -> prose too, and this exclusion was MISSING until
      2026-09-16. The audit stamps this repo leaves at the top of many modules carry a `next:`
      clause naming commands as work items -- `next: consider soft-delete or referential guard on
      delete_customer (COR-23)` -- and a scanner reading for calls cannot tell that sentence from
      a call site. `PROSE_LINE_RE` only knows line PREFIXES (`//`, `*`), so a bare prose line
      inside a block comment slipped through as a caller. Found by this lane's cross-crate audit
      of retired names, whose four "true suspects" were all this one shape.
      `retire-legacy-commands.py` has tracked block interiors since round 20 for its own
      stale-prose check; the gate is the instrument that fell behind its tool. Nesting is not
      modelled (Rust allows `/* /* */ */`), which can only over-exclude -- the conservative
      direction here, and why no depth counter is attempted.
    * a line starting `pub fn` / `pub async fn` -> the definition itself.
    * the match sitting immediately after `fn` on the same line -> a definition of `name` under
       any visibility. Earned 2026-09-16: the bullet above is anchored on `pub`, so a Rust test
       written as `#[test] fn pending_offline_count()` counted as a call of the command of the
       same name, and three deletion candidates sat behind a refusal that had no evidence in
       it. The bodies were `store.pending_offline_count()` -- the Store method -- which the
       first bullet already rejects, so the only "caller" in the crate was the test's own
       title. A check that reads a name as a call wherever the name appears cannot tell a
       caller from a thing named after the caller.
    """
    # `\w` only -- a preceding `.` or `::` is rejected in the loop below, where the reason can
    # be written out and a fixture can reach it. That rejection used to ALSO sit in this
    # pattern's lookbehind, which made the branch dead code, and a mutation aimed at the
    # branch came back green on 2026-09-16 for no other reason. One mechanism, one test.
    pattern = re.compile(r"(?<!\w)" + re.escape(name) + r"\s*\(")
    hits: list[str] = []
    for label, text in sources:
        # Per-file, not per-scan: a flag shared across sources would let one file's open block
        # silence a real call in the next file, which is the same leak in a louder shape.
        in_block = False
        for number, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if in_block:
                if stripped.endswith("*/"):
                    in_block = False
                continue
            if stripped.startswith("/*") and not stripped.endswith("*/"):
                in_block = True
                continue
            if PROSE_LINE_RE.match(line) or DEF_LINE_RE.match(line):
                continue
            for match in pattern.finditer(line):
                before = line[:match.start()]
                if FN_DEFINITION_BEFORE_RE.search(before):
                    continue  # `fn name(` / `async fn name(`: this is the definition, not a call
                if before.endswith("."):
                    continue
                if before.endswith("::"):
                    chain = [s[:-2] for s in re.findall(r"[A-Za-z0-9_]+::", before)]
                    if any(seg in FOREIGN_PATH_ROOTS for seg in chain):
                        continue
                    last = chain[-1] if chain else ""
                    if TYPE_QUALIFIER_RE.search(last):
                        continue
                hits.append(f"{label}:{number}")
    return hits


def camel(param: str) -> str:
    """The payload key Tauri expects for a Rust parameter name.

    Tauri v2 renames command ARGUMENTS to camelCase, and nothing else -- which is why a snake_case
    key in a caller is a real mismatch rather than a style question. Both spellings are accepted by
    the caller side below, deliberately: accepting the snake form costs one false negative class
    (a caller that would in fact fail at runtime) and refusing it would cost the leg's whole
    credibility, because a handful of wrappers in this tree do pass snake_case keys for arguments
    that are `Option` and therefore arrive as `undefined` either way.
    """
    parts = param.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


RUST_PARAM_SPLIT_RE = re.compile(r",(?![^<>()]*[>)])")
OPTIONAL_TYPE_RE = re.compile(r"^\s*(?:std::)?(?:primitive::)?Option\s*<|^\s*Option<")
INJECTED_PARAMS = ("state", "app", "webview", "window", "app_handle", "_")


def rust_required_params(prod: list[tuple[str, str]], fn: str) -> list[str] | None:
    """The caller-supplied, non-Option parameter names of one command fn, or None if not found.

    None is a distinct answer from [] and the leg treats it that way: "I could not read the
    signature" must not be reported as "this command needs nothing".
    """
    for label, text in prod:
        m = re.search(r"^\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:async\s+)?fn\s+" + re.escape(fn)
                      + r"\s*\(", text, re.M)
        if not m:
            continue
        open_idx = text.index("(", m.end() - 1)
        depth, j = 0, open_idx
        while j < len(text):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        inner = text[open_idx + 1:j]
        # Strip comments before splitting. This function reported `create_table_scoped<-because the
        # parameter name IS the payload` for a day, because a comment added INSIDE the parameter
        # list of that signature contains a colon and the splitter read it as `name: type`. Prose
        # counted as code, the same failure `fn_call_sites` carries a seventh exclusion for; the
        # difference is that here the prose was mine and the lie came out of a leg written the same
        # afternoon to stop trusting prose.
        inner = re.sub(r"/\*.*?\*/", " ", inner, flags=re.S)
        inner = re.sub(r"//[^\n]*", " ", inner)
        out: list[str] = []
        for piece in RUST_PARAM_SPLIT_RE.split(inner):
            piece = piece.strip()
            if not piece or ":" not in piece:
                continue
            name, _, typ = piece.partition(":")
            name = name.strip().removeprefix("mut ").strip()
            typ = typ.strip()
            if not name or name.startswith("_") or name in INJECTED_PARAMS:
                continue
            if OPTIONAL_TYPE_RE.match(typ) or typ.startswith("Option"):
                continue
            # `State<'_, AppState>`, `AppHandle` and friends are injected by Tauri even when the
            # parameter is named something else, so the TYPE is checked as well as the name.
            if re.match(r"^(?:std::)?(?:sync::)?Arc<|State\s*<|AppHandle|Webview|Window", typ):
                continue
            out.append(name)
        return out
    return None


def ui_payload_keys(files: list[tuple[str, str]]) -> dict[str, list[tuple[str, set[str], bool]]]:
    """Per command name: (site, keys, opaque) for every call that passes a second argument.

    `opaque` means "there is an argument and this parse cannot read its keys" -- a non-literal
    (`invoke(cmd, args)`), or a literal containing a spread. Opaque sites EXCLUDE their command from
    grading rather than counting against it, because the alternative is a leg reporting a missing key
    the caller supplies through a variable, and an informational leg that cries wolf is worse than no
    leg: its entire value is that it is believed without a build behind it.

    Object members are split on TOP-LEVEL commas and each piece classified -- `k:`/`"k":` is a key,
    a bare identifier is shorthand for a key of the same name. The two-regex version this replaces
    collected the VALUE of every `id: foo,` pair as a key too, which is the wrong direction (it can
    only ever clear a finding, never raise one) but it made the leg's set of "supplied keys" mean
    something other than what its name says.
    """
    out: dict[str, list[tuple[str, set[str], bool]]] = {}
    for rel, text in files:
        for m in re.finditer(
            r"(?:loggedInvoke|invoke)(?:<[^()]*>)?\(\s*['\"]([a-z0-9_]+)['\"]\s*,\s*", text
        ):
            cmd, after = m.group(1), text[m.end():]
            site = f"{rel}:{text[:m.start()].count(chr(10)) + 1}"
            if after.startswith("{"):
                depth, j = 0, 0
                while j < len(after):
                    if after[j] == "{":
                        depth += 1
                    elif after[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                obj = after[1:j]
                keys: set[str] = set()
                opaque = "..." in obj
                piece, d = "", 0
                pieces: list[str] = []
                for ch in obj:
                    if ch in "{[(":
                        d += 1
                    elif ch in "}])":
                        d -= 1
                    if ch == "," and d == 0:
                        pieces.append(piece)
                        piece = ""
                    else:
                        piece += ch
                pieces.append(piece)
                for p in pieces:
                    p = p.strip()
                    if not p:
                        continue
                    if ":" in p:
                        k = re.match(r'^["\']?([A-Za-z_$][\w$]*)["\']?\s*:', p)
                        if k:
                            keys.add(k.group(1))
                    elif re.fullmatch(r"[A-Za-z_$][\w$]*", p):
                        keys.add(p)  # shorthand: `{ productId }` supplies the key productId
                out.setdefault(cmd, []).append((site, keys, opaque))
            else:
                tok = re.match(r"[A-Za-z_$][\w$]*", after)
                if tok:
                    out.setdefault(cmd, []).append((site, set(), True))
    return out


def argshape_findings(prod: list[tuple[str, str]], registered: list[str],
                      payloads: dict) -> dict[str, list[str]]:
    """Registered commands whose readable callers never supply a required argument.

    The mechanical form of the comparison that found T4-1, T7-2 and all of T8's ten: a human read a
    Rust signature against a TypeScript object literal, three times, in five domains. Nothing in
    this repository crosses the IPC boundary in a test (``git grep`` for the Tauri mock idioms
    returns no files), so until now the only detection was attention.

    Reported only when EVERY readable payload for the command omits the key; one supplying caller
    clears the argument, and any command with an opaque caller is not graded at all.
    """
    res: dict[str, list[str]] = {"missing": [], "ungraded": []}
    for name in sorted(set(registered)):
        req = rust_required_params(prod, name)
        if req is None:
            res["ungraded"].append(f"{name}(no readable signature)")
            continue
        sites = payloads.get(name)
        if not sites:
            continue  # no caller at all -- that is the `unrequested` leg's question, not this one
        readable = [s for s in sites if not s[2]]
        if not readable:
            res["ungraded"].append(f"{name}(all callers opaque)")
            continue
        supplied: set[str] = set()
        for _site, keys, _op in readable:
            supplied |= keys
        gaps = [p for p in req if camel(p) not in supplied and p not in supplied]
        if gaps:
            # Name the caller to look in, not just the command. T9's SECOND AMENDMENT -- which sits
            # at character ~4400 of a 5,435-character row, below any 2,000-character read -- asks
            # for a message that "names both sides and the file to look in". The command alone sends
            # a reader to the Rust; the file is the half that says where the fix belongs, and in
            # both of this leg's real findings the fix was on the UI side.
            srcs = sorted({s[0] for s in readable})
            where = ", ".join(srcs[:2]) + (f" (+{len(srcs) - 2} more)" if len(srcs) > 2 else "")
            res["missing"].append(f"{name}<-{','.join(gaps)} in {where}")
    return res


def shell_rust_sources(lib_path: Path) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """(production, test) Rust sources of one shell, as (label, text) pairs.

    Extracted so the F-006 classifier and the mirror-direction leg below read exactly the same
    population. Two forks of "what counts as this shell's sources" is how one leg can look clean
    while the other grades a different tree.
    """
    src = lib_path.parent
    prod: list[tuple[str, str]] = []
    tests: list[tuple[str, str]] = []
    for path in sorted(src.rglob("*.rs")):
        text = path.read_text(encoding="utf-8", errors="replace")
        (tests if path.name.endswith("_tests.rs") else prod).append((path.name, text))
    return prod, tests


def unrequested_registrations(
    prod: list[tuple[str, str]], registered: list[str], ui_names: set[str]
) -> dict[str, list[str]]:
    """Registered commands that no shipped UI file invokes, split by local Rust callers.

    This is the direction F-006 never asked. F-006 counts "the renderer names a door nobody
    registered"; a thin shell also has the opposite surface -- "a door is registered and nothing
    on the client side ever names it" -- and until 2026-09-16 no instrument in this repo printed
    it, so "the shells are thin" was only ever half-measured. Two sub-populations answer
    differently and must not be summed into one scary number:

    * `rust_called` -- no UI demand, but the shell's own code calls the fn (a sink wired from an
      event handler, a command reused by another command). The registration may still be wrong,
      but the body is load-bearing and deleting it breaks the build.
    * `dead_registration` -- named by no shipped UI file and called by no Rust in this shell: the
      only population that a retirement can start from.

    What this deliberately does NOT claim. Demand is counted where the command STRING is written,
    so a UI file that reaches a command through a wrapper under `ui/src/api` is credited, and a
    name invoked only from a Vitest case or from `ui/src/dev-mock` reads as unrequested -- that is
    correct for "shipped" and is the same population `extract_ui_commands` uses (`UI_SCAN_DIRS`
    omits both; verified against the tree the day this leg was written: no invoke literal lives
    outside the walked directories today, so a future file there would be invisible to both this
    leg and F-006, which is the shared caveat to remember, not a claim that either is broken now).
    A name the OTHER shell's UI calls is also unrequested here, so read the two shells' lists
    together before believing any entry is dead everywhere.

    Two limits, measured the same day rather than assumed. Demand is found by a LITERAL regex, so
    `loggedInvoke(cmdVariable, ...)` would be invisible: the only non-literal invoke sites in
    shipped UI are `ui/src/utils/logged-invoke.ts:14` and `:18`, which are the helper's own
    parameter, so nothing hides behind a variable today -- and if a future pass adds one, this leg
    and F-006 go quietly wrong together, because they share the census. And `rust_called` printed
    zero for both shells that day: an unpopulated arm is not a broken arm, but no real input has
    exercised it yet, which is what the four fixtures in the self-test exist to keep honest.
    """
    out: dict[str, list[str]] = {"rust_called": [], "dead_registration": []}
    for name in sorted(set(registered)):
        if name in ui_names:
            continue
        sites = fn_call_sites(name, prod)
        (out["rust_called"] if sites else out["dead_registration"]).append(name)
    return out


def classify_unregistered(
    lib_path: Path, unregistered: list[str], ui_missing: set[str]
) -> dict[str, tuple[list[str], list[str]]]:
    """Split unregistered command fns by whether anything in the shell still calls them.

    Returns {name: (production_call_sites, test_call_sites)}. The F-006 leg counts fns that
    are defined and not registered; that is a *claim* the source makes and the registry
    refuses, and on its own it does not say whether the fn does anything. Three populations
    answer differently:

    * named by the UI as well -> a real IPC gap (the renderer invokes it, nobody answers);
      graded by the UI->shell direction, not by this leg, and already carried by the
      allowlist count on the same line.
    * unreachable and called by production code -> a helper wearing a stale `#[command]`;
      the attribute is the lie, the fn is load-bearing, and deleting it breaks the build.
    * unreachable and called by nothing -> a deletion candidate, one name at a time, after
      reading the body AND the comment above it (T5-3 nearly collapsed a documented
      per-client policy; T12 nearly deleted a command another shell's fallback needs).
    """
    prod, tests = shell_rust_sources(lib_path)
    return {
        fn: (fn_call_sites(fn, prod), fn_call_sites(fn, tests)) for fn in unregistered
    }


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


# Identical to MOCK_LITERAL_KEY_RE except that it demands a non-space character before the
# quote instead of the start of the line. The tail is the same value-shape test on purpose:
# what separates a registrar entry from an arbitrary quoted-key literal here is that its
# value is a function or a shorthand identifier, and narrowing the difference to POSITION
# alone is the whole point -- anything else this reports would be a new claim, not a
# measurement of the blindness.
MOCK_MIDLINE_KEY_RE = re.compile(
    r"""\S[ \t]*['"]([a-z0-9_]+)['"][ \t]*:[ \t]*(?:\(|async\b|=>|[A-Za-z_$][A-Za-z0-9_$]*[ \t]*,?[ \t]*$)"""
)


def find_midline_handler_keys(sources: list[tuple[str, str]]) -> dict[str, set[str]]:
    """Handler-shaped keys the registrar parse cannot see, by file.

    `MOCK_LITERAL_KEY_RE` is anchored (`^[ \\t]*`, `re.M`) and the anchoring is load-bearing:
    without it the scanner would also collect quoted keys nested inside handler return
    payloads. The cost of that anchoring is that a key sharing a line with anything else is
    not a handler as far as this gate is concerned, while TypeScript still sees it as one --
    a splice, a merge, or a formatter decision can therefore move a name out of the
    answerable set without any code changing meaning.

    That is not hypothetical: on 2026-09-16 a string splice in this programme's own work left
    `}),  'set_brand_primary_colour': () => null,` on one line of `handlers/system.ts`, and
    the gate went red asserting that "no unscoped twin exists for the alias rule to reach"
    about a twin sitting on the same line as its predecessor. The verdict was the one the
    tree deserved (line-anchored or not, the parse should not be fooled), but the REASON it
    printed was false, and a false reason is how a formatting artifact gets "fixed" by
    allowlisting a gap that does not exist.

    Measured the same day: this returns `{}` for the whole current tree, so nothing here
    pre-existing is being reported. The function exists to make the blind spot sayable.
    """
    found: dict[str, set[str]] = {}
    for rel, raw in sources:
        text = _mock_code(raw)
        visible = set(MOCK_LITERAL_KEY_RE.findall(text))
        midline = {n for n in MOCK_MIDLINE_KEY_RE.findall(text) if n not in visible}
        if midline:
            found[rel] = midline
    return found


def find_unreachable_mock_keys(
    per_file: dict[str, set[str]], shell_registered: set[str], ui_named: set[str]
) -> dict[str, set[str]]:
    """Mock handler keys that nothing on either side can reach, by file.

    The mirror of this gate's own question. It asks, on three sides, whether a call the
    renderer makes has something behind it, and never asks whether a handler the mock
    provides has anything in FRONT of it. The asymmetry is not harmless: `rotate_encryption_key`
    kept answering calls in the browser after the command was deleted from both shells for
    being an ungated bypass (`ui/src/api/security.ts:31`, and the three test cases closed at
    `ui/src/__tests__/api-security-contract.test.ts:38-44` on the grounds that resurrecting
    the wrapper would resurrect the bypass). The contract test's discipline was enforced
    exactly where it could be enforced, and the two files outside its reach drifted anyway.

    A key counts as reachable on ANY of three routes, which is the whole reason this is
    worth a function rather than a set subtraction:
      * a shell registers it;
      * UI code names it;
      * it is an UNSCOPED name whose `_scoped` twin takes one of the first two routes,
        because applyScopedAliases copies this handler onto that name at dispatch time.
    The third route is what makes the first naive attempt at this census useless: measured
    against only the first two, 164 of 521 keys looked dead on 2026-09-16, and the true
    figure after the alias term was 7. Any reader of the count below should re-derive the
    number before deleting anything, and remember that a handler answering nothing today is
    also a handler a future screen will silently need.

    Informational by design. A mock key with no consumer is dead weight, not a defect, and
    the tree is full of surfaces that were built before their callers.
    """
    consumers = shell_registered | ui_named
    found: dict[str, set[str]] = {}
    for path, names in per_file.items():
        dead = {
            n for n in names
            if n not in consumers and (n.endswith("_scoped") or f"{n}_scoped" not in consumers)
        }
        if dead:
            found[path] = dead
    return found



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

    What the allowlist could not tell you, which every number printed from here depends on
    you knowing: the "dev_mock" section was a flat list of command names with no reason
    field, and for as long as load_allowlist handed back raw json.loads output and each
    consumer passed the section straight through set(), it could only ever be that. An
    operator who wrote down WHY a gap was allowlisted did not lose the annotation -- the
    gate died on TypeError: unhashable type, measured against a copy of the real file
    before the schema existed. allowlist_section now reads both shapes and section_names is
    the only view the enforcement code sees, so the accepted shape is a name plus an
    optional reason while membership and every count are computed exactly as before. A
    bare name still reads identically whether a slice asked for a browser exemption and
    somebody agreed, or nobody has looked at it since it was written; that is what the
    "carry no reason" line the gate prints on every run is now able to say with a number.
    Every section HAS been given the schema since then: scoped_orphans, desktop and tablet
    are read through section_names exactly as dev_mock is, so the TypeError above is not
    reachable from any of the four, and self-test case 10 pins both shapes on a scoped_orphans
    fixture. What stays barred is a SHAPE in two of them. "desktop" and "tablet" keep one bare
    name per entry because the sibling reader scripts/verify-scoped-reads.py refuses an object
    there -- measured 2026-09-16 by planting {"name", "reason"} as entry #1 of "desktop" in a
    copy of the file and running that gate with --allowlist on the copy: it printed
    "FAIL: 1 member(s) ... this gate could not read" and exited 1. The constraint is therefore
    enforced at both ends of the shared file, in words rather than by one reader's inability to
    parse -- which is what this file's EXTERNALLY_READ_SECTIONS / OBJECT_ALLOWED_SECTIONS split
    records.
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


def read_allowlist_text() -> str:
    """The file's bytes, waiting out the microsecond a rename is mid-flight.

    os.replace is atomic for the reader, not invisible: while the swap happens Windows denies
    an open of the target, and load_allowlist has no handler for that, so the bare run in
    dev-ci.yml, check.sh and run-pre-push.py would still die -- with PermissionError instead of
    JSONDecodeError, which is a better sentence and still a crash. (Both now reach the operator
    as one `error:` line at exit 2: load_allowlist re-raises AllowlistBusyError, which is a
    subclass of AllowlistUnusable, and a parse that cannot be completed raises the parent.
    Neither spends the verdict code 1 any more.) Retrying a denial that is
    already over costs one sleep; the ceiling turns a genuine, persistent lock into an
    AllowlistBusyError with words in it rather than a traceback from json.

    This waits out denials for the readers that come through HERE. It reaches none of the
    script-next-door readers, and one of them is in the refusal text precisely because it is
    not protected: see ALLOWLIST_READER_CALL_SITES.
    """
    for attempt in range(READ_ATTEMPTS):
        try:
            return ALLOWLIST_PATH.read_text(encoding="utf-8")
        except PermissionError:
            if attempt + 1 == READ_ATTEMPTS:
                raise AllowlistBusyError(
                    f"{ALLOWLIST_PATH.name} could not be opened after {READ_ATTEMPTS} tries; "
                    f"another process is holding it. Readers of this path: "
                    + ", ".join(ALLOWLIST_READER_CALL_SITES)
                ) from None
            time.sleep(READ_RETRY_SECONDS)
    raise AssertionError("unreachable")  # every path above returns or raises


class AllowlistUnusable(RuntimeError):
    """The shared allowlist did not arrive as a value this gate may grade or write over.

    Raised at the ONE place the file is opened and parsed, before any walk and before any
    writer flag, for five distinct causes -- absent, would not open, not JSON, not an object,
    and an object that does not carry every enforced section as a list. The last two are ANSWERED
    in scripts/allowlist-schema.py since 0454b542e4, one schema for one shared file, with this
    gate's required set and merged sentence supplied by the caller; the first three stay this
    file's own, because the read is not shared. Raised as this class either way:
    one class, one handler (`refuse_unusable_allowlist`), one voice: a short `error: ...` line on
    stderr and exit 2, never a traceback. This is the house shape, not an invention:
    `AllowlistUnreadable` in scripts/verify-scoped-reads.py keeps one class and one handler for
    "the bytes would not arrive", and the four refusals landed in scripts/verify-ftl-orphans.py
    (cd2b55fa3, ef2058f28, 683eb1eac, 4d1a85b15) print one `error:` line and exit 2.

    Never exit 1, because 1 here is the VERDICT code -- main() ends on
    `FAIL: N IPC parity violation(s)` and returns 1 -- and `apps/tablet-client/src/commands/
    sync.rs:639` already cites "verify-ipc-parity.py exit 1" as evidence about real commands.
    A file that never arrived cannot be evidence about anybody's IPC surface. 2 is already
    this file's refusal code: main() returns it for a missing shell lib.

    Why the guard sits at the parse rather than at each use. Every consumer reads a section
    with `payload.get(section)` -- `allowlist_shape_problems` (:547 side), `allowlist_section`
    (:592 side), and the three writers at :730 / :765 / :794 -- so a payload that is a JSON
    array, a bare string, or an object with the section spelled wrong answers `None` or a
    scalar, and `allowlist_section()` iterates whatever it is handed: a 4 becomes a TypeError
    crash at exit 1, and `"abc"` becomes three bogus one-character exemptions. Either way the
    run reports over an allowlist it never read -- and because this file also WRITES that
    shared file, the same non-read can land back on disk as a truncated allowlist. A value
    received is not a value verified, so verification happens where the value is made.
    """


def refuse_unusable_allowlist(unusable: AllowlistUnusable) -> int:
    """The ONE handler for the ONE class: one `error:` line on stderr, exit 2, nothing written.

    Reaching here means no allowlist was read at all, so the sentence names what did NOT
    happen: nothing was walked, nothing was exempted, nothing was written. The number a reader
    might infer from a short run is not zero, it is absent.
    """
    print(f"error: {unusable} (looked in {ALLOWLIST_PATH.parent}). Nothing was graded and "
          f"nothing was written, so this refusal is not an IPC parity verdict.",
          file=sys.stderr)
    return 2


def allowlist_schema():
    """The shared schema module, imported by path, or an `AllowlistUnusable` naming the path.

    `spec_from_file_location` because the filename carries a hyphen, which no import statement
    can spell. The module is not renamed for that: a rename costs the history of a file another
    gate is being adopted from, to save six lines here, and it is reversible by construction.
    Lazy rather than top-level because an eager import of an absent or unimportable validator
    raises while this file is still loading -- out of main(), with no handler, and an uncaught
    exception exits 1, the VERDICT code, spent on a missing sibling file. Loaded where it can
    be refused in words, it costs 2 like every other thing that never arrived. The cache is
    keyed by path so a self-test probe cannot be served a module imported for another path.
    """
    path = str(ALLOWLIST_SCHEMA_PATH)
    cached = _SCHEMA_BY_PATH.get(path)
    if isinstance(cached, BaseException):
        raise cached
    if cached is not None:
        return cached
    try:
        spec = importlib.util.spec_from_file_location("allowlist_schema", path)
        if spec is None or spec.loader is None:
            raise ImportError(f"no loader for {path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for needed in ("validate", "Refusal", "KNOWN_SECTIONS", "REQUIRED_FOR_WRITER"):
            if not hasattr(module, needed):
                raise AttributeError(f"{Path(path).name} exports no {needed}")
    except Exception as exc:
        # Broad on purpose. The module is an input to this gate, not its own code, so ANY
        # failure of it -- a missing file, a SyntaxError in it, a NameError at its import --
        # means the same thing here: there is no shared answer, so this run must not guess
        # one. Anything narrower escapes main() as a traceback and exits 1.
        refusal = AllowlistUnusable(
            f"{Path(path).name} is not usable as the shared allowlist schema validator "
            f"({type(exc).__name__}: {exc}). This gate will not guess a shape in its place, "
            f"because two private definitions of valid is what it was sharing to end.")
        _SCHEMA_BY_PATH[path] = refusal
        raise refusal from None
    _SCHEMA_BY_PATH[path] = module
    return module


def load_allowlist() -> dict:
    """Read AND verify the shared allowlist, or refuse. It never hands back a guess.

    The floor is an OBJECT carrying each of `KNOWN_SECTIONS` (desktop, tablet, dev_mock,
    scoped_orphans) as a LIST, and since 0454b542e4 that question is answered by
    `allowlist_schema().validate()` in scripts/allowlist-schema.py -- one schema shared with
    scripts/verify-scoped-reads.py, asked here with THIS gate's required set and joined into
    this gate's one merged sentence. Everything about the READ stays local -- the open, the retry
    ceiling, the encoding, the parse, and the three sentences for what can go wrong before there
    is a document at all -- because the file that is also a writer cannot share a reader's timing
    rules, and those three are not a question the schema was written to answer. An empty list
    is a section the file STATES as exempting nothing and is not a refusal -- `--write-allowlist`
    emits `[]` for a shell with no gap, and a clean tree's allowlist is legitimately empty.
    What is refused is emptiness the file never asserted, which is what `payload.get(section)`
    manufactures: an absent path, a payload with no sections at all (`{}` parses fine and
    enforces nothing), or a section key holding a scalar. Stated-empty is a claim; defaulted-
    empty is this run's own invention, and the two are told apart by `section in payload`.

    Before this, a missing file returned a fabricated `{"desktop": [], "tablet": []}` -- not
    the empty shape either, since it invented two sections and silently dropped the other two
    -- and anything else went through as raw `json.loads` output.
    """
    if not ALLOWLIST_PATH.exists():
        raise AllowlistUnusable(
            f"{ALLOWLIST_PATH.name} is not there, so this run has no allowlist -- an absent "
            f"file is not an empty one. Three writer flags -- --write-allowlist, "
            f"--write-scoped-orphans and --write-dev-mock-gaps -- would each rewrite it from "
            f"what this run read, and a run that read nothing has nothing to preserve.")
    try:
        text = read_allowlist_text()
    except AllowlistBusyError:
        raise
    except UnicodeDecodeError as exc:
        # A ValueError, not an OSError, so it needs its own arm: the bytes arrived and are
        # not text. Uncaught, this escapes to main() as a traceback and spends the verdict
        # code 1 on a file nobody could read -- the same confusion verify-ftl-orphans.py
        # records for a locked bundle.
        raise AllowlistUnusable(
            f"{ALLOWLIST_PATH.name} is not UTF-8 text ({exc}); whatever those bytes are, "
            f"they are not an allowlist.") from None
    except OSError as exc:
        raise AllowlistUnusable(
            f"{ALLOWLIST_PATH.name} would not open ({type(exc).__name__}: "
            f"{exc.strerror or exc})") from None
    try:
        payload = json.loads(text)
    except ValueError as exc:
        raise AllowlistUnusable(
            f"{ALLOWLIST_PATH.name} is {len(text.encode('utf-8'))} bytes that are not JSON "
            f"({type(exc).__name__}: {exc}). A torn read is possible while a writer flag is "
            f"renaming onto it, and a torn read is a retry, not a verdict.") from None
    # IS THIS A DOCUMENT? Answered by the shared schema, not here, since 0454b542e4 -- the repo
    # held two private definitions of valid and so one file holding just {desktop, tablet} was
    # GRADED by scripts/verify-scoped-reads.py and REFUSED by this gate, both correct under their
    # own rule. What stays this gate's own is the POLICY and the VOICE, and the policy is the
    # required set: KNOWN_SECTIONS, all four, NOT the REQUIRED_FOR_SHELL_READER pair the same
    # module also exports. Passing two would be a real change of behaviour, not a tidy-up -- a
    # {desktop, tablet}-only file would stop being an exit 2 refusal and become a full walk at
    # exit 1, and the three writer flags would then republish over dev_mock and scoped_orphans,
    # two sections nobody validated. That is data loss with a verdict printed on it.
    #
    # The voice stays merged too. validate() answers a mistyped section and an absent section as
    # TWO Refusals, mistyped first; the reader next door raises on the first and never sees the
    # second, while this run has always named both in one sentence. So every sentence is joined
    # rather than reduced to primary(), which keeps the claim a refusal makes whole: an operator
    # told to add scoped_orphans should also learn dev_mock is a string. Still one
    # AllowlistUnusable, still one handler, still exit 2, and no count anywhere on the line.
    refusals = allowlist_schema().validate(payload, KNOWN_SECTIONS, ALLOWLIST_PATH.name)
    if refusals:
        raise AllowlistUnusable(" ".join(
            refusal.sentence for refusal in refusals))
    return payload


class AllowlistBusyError(AllowlistUnusable):
    """The target would not accept the rename, so nothing was written.

    A subclass of `AllowlistUnusable` so the read path keeps ONE handler while the name still
    says which of the refusals a reader is looking at. Raised from BOTH sides of the swap: the
    reader that could not open the file (`read_allowlist_text`, answered at 2 by
    `refuse_unusable_allowlist`) and the writer whose rename the target never accepted
    (`write_allowlist_payload`, re-raised by `update_allowlist` as an `AllowlistWriteRefusal`,
    which is the write voice and also 2). Nothing about the retry or the message changes.
    """


# Every reader of this file opens it bare, and the list is who a busy-target refusal has to
# name: .github/workflows/dev-ci.yml:590, scripts/check.sh:56 and scripts/run-pre-push.py:107
# are this gate's own readers, reached through load_allowlist, so the retry below covers them.
# The fourth is a DIFFERENT gate, scripts/verify-scoped-reads.py:266, the io.open at the top of
# its audit(); it was omitted until 2026-09-13 12:36 because this file only ever thought of
# itself as the reader's owner. It matters twice over. It can hold the target open long enough
# to deny my rename, so it belongs in the diagnosis a refusal prints. And it is bare in a way
# the first three are not: read_allowlist_text cannot reach it, so the 252 PermissionError
# denials in 30,461 reads measured against this writer at 12:36 land in that script's own
# traceback, which no code here can catch -- only its owner can, and that file is out of this
# fence and is being edited by another lane right now. Line numbers here are as true as the
# minute they were read; the function is audit(), which is what survives the drift.
ALLOWLIST_READER_CALL_SITES = (".github/workflows/dev-ci.yml:590", "scripts/check.sh:56",
                               "scripts/run-pre-push.py:107",
                               "scripts/verify-scoped-reads.py:266")

# Rename retries: 200 tries at 10 ms is about two seconds of patience with a reader.
REPLACE_ATTEMPTS = 200
REPLACE_RETRY_SECONDS = 0.01

# And the mirror image, for the reader's side of the same handshake: on Windows a rename in
# flight makes the next open fail with an access-denied that clears in microseconds. Measured
# with a writer loop and a json.loads reader against copies of the real payload -- 8,439 reads,
# 0 torn, 163 denied; 8,410 reads, 0 torn, 215 denied. Before the rename: 5,451 reads, 941
# TORN (17.3 percent), 0 denied. Zero torn is the win, but a denial is still a crash if nobody
# catches it, so the reader waits a little rather than dying in a different exception.
READ_ATTEMPTS = 50
READ_RETRY_SECONDS = 0.001


def write_allowlist_payload(payload: dict) -> None:
    """The ONE way this gate writes the allowlist file: LF endings, UTF-8, no escapes.

    All three writer flags used to call ALLOWLIST_PATH.write_text(...) with an encoding and
    no newline argument, and Python text mode translates a newline into os.linesep -- on
    Windows that re-emits the whole file as CRLF while changing not one character of its
    text. Measured before this function existed: reseeding a copy of the real
    scripts/ipc-parity-allowlist.json changed the file's bytes with ZERO differing text
    lines, i.e. a pure line-ending rewrite of all 235 lines of a file another lane owns and
    edits. The hazard is not the rewrite, it is what a rewrite makes of the next commit:
    AGENTS.md section 3 says a pathspec commit takes the WORKING TREE copy, so any session
    that commits this file for an unrelated reason after a writer run ships 235 lines of
    somebody else's line-ending churn under a message describing something else, and the
    reviewer's diff cannot tell churn from content.

    LF is also what the repo asks for: .gitattributes pins "* text=auto eol=lf", and
    git check-attr on the path answers text: auto, eol: lf, so index and working tree both
    want LF. ensure_ascii=False belongs in the same helper for the same reason -- the file
    holds five literal em dashes in its comment strings, and two of the three writers were
    dumping without it, so --write-allowlist and --write-scoped-orphans each re-emitted
    those comments as \u2014 escapes: a real text change dressed up as a reseed. One
    helper, one shape, so a fourth writer cannot pick the wrong pair of arguments.

    Third job of this helper, and the reason it renames rather than writes: the file must
    never be observable half-built. write_text is open, truncate, write -- three steps with a
    window in the middle -- and four bare readers poll this path (.github/workflows/
    dev-ci.yml:590, scripts/check.sh:56, scripts/run-pre-push.py:107, that last one in every
    agent's push path, and scripts/verify-scoped-reads.py:266 in the gate next door). Measured with a writer loop in one process and a json.loads reader in
    another, against a copy of the real payload: 1,227 of 5,607 reads failed under
    write_text (21.9 percent), every failure a JSONDecodeError rather than a sharing
    violation, dying in load_allowlist long before the validator could name anything. Same
    harness and the rename below: no failed reads at all -- but only after a second Windows
    detail was handled. A reader holding the file open makes os.replace fail with
    PermissionError [WinError 5], measured on the first attempt at this change: the writer
    died with a traceback while the reader stayed clean, which trades a torn read for a lost
    write. Renaming onto a busy target is retried for a couple of seconds, and a reader holds
    the file for microseconds, so in practice the retry costs one sleep. If the target is busy
    past the ceiling the temp is removed, AllowlistBusyError is raised with a sentence in it,
    and the writer turns that into a refusal -- the previous file stays exactly as it was,
    which is the property that made the rename worth having: a failed write cannot leave
    anything half-built, and cannot corrupt what was already there.
    """
    ALLOWLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", delete=False,
        dir=str(ALLOWLIST_PATH.parent), prefix=ALLOWLIST_PATH.name + ".", suffix=".tmp")
    tmp_path = Path(tmp.name)
    try:
        with tmp:
            tmp.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
            tmp.flush()
            os.fsync(tmp.fileno())
        for attempt in range(REPLACE_ATTEMPTS):
            try:
                os.replace(tmp_path, ALLOWLIST_PATH)
                return
            except PermissionError:
                # Windows denies a rename onto a file another process has open. Retry: the
                # open is a read of a 15 KB file, so it clears in microseconds, and the
                # alternative -- write_text -- is the window that started this.
                if attempt + 1 == REPLACE_ATTEMPTS:
                    raise
                time.sleep(REPLACE_RETRY_SECONDS)
    except BaseException:
        # A half-written sibling in the same directory as the file is its own small hazard.
        tmp_path.unlink(missing_ok=True)
        if isinstance(sys.exc_info()[1], PermissionError):
            raise AllowlistBusyError(
                f"{ALLOWLIST_PATH.name} is held open by another process and would not accept "
                f"the rename after {REPLACE_ATTEMPTS} tries; nothing was written and the file "
                f"on disk is unchanged. Readers of this path: "
                + ", ".join(ALLOWLIST_READER_CALL_SITES)
            ) from None
        raise


# An entry written as an object instead of a bare name. Named once so every message this
# file emits about shapes describes it the same way.
OBJECT_FORM = '{"name": ..., "reason": ...}'

# Sections whose entries are read by anything outside this file. This is the asymmetry:
# "dev_mock" and "scoped_orphans" are private to this gate, "desktop" and "tablet" are not.
EXTERNALLY_READ_SECTIONS = ("desktop", "tablet")

# Sections this gate is willing to read in either shape.
OBJECT_ALLOWED_SECTIONS = ("dev_mock", "scoped_orphans")

# Everything this file enforces, in the order the messages should list it.
KNOWN_SECTIONS = (*EXTERNALLY_READ_SECTIONS, *OBJECT_ALLOWED_SECTIONS)


def allowlist_shape_problems(payload: dict, path) -> list[str]:
    """Every way this allowlist file can be shaped wrong, as readable sentences.

    Why this exists rather than a crash: a member this file cannot read used to surface as
    "TypeError: cannot use 'dict' as a set element (unhashable type: 'dict')" out of main(),
    after the whole tree had been parsed, with no sentence and no file name in it. A crash is
    not a diagnosis, and the operator who hits one has no way to know that the accepted shape
    differs by section -- which is the piece of knowledge that lived nowhere in this file.

    The split IS deliberate today, and each message says so, because the reason is external
    rather than internal to this file: scripts/verify-scoped-reads.py reads the "desktop" and
    "tablet" sections and grades every member of them as a command name, so an object there
    does not merely confuse this gate -- it reds a second gate that runs bare in CI and in
    check.sh, in a file its owner is not working in. HOW that gate reds is measured here rather
    than remembered: since it grew allowlist_names(), an object in a shell section is reported
    as an unreadable member and FAILS the run (exit 1, one sentence naming the section and the
    1-based index), with no TypeError and no traceback -- re-derive it by planting one in a copy
    and running scripts/verify-scoped-reads.py --allowlist on the copy. The verdict the rule
    exists to protect is unchanged either way. "dev_mock" and "scoped_orphans" have no
    reader outside this script, so they can take the object form as soon as the reads here
    normalise both shapes, which allowlist_section and section_names now do.

    COUPLING, written where the rule lives rather than in a commit message from a lane that
    no longer exists: the two tuples this reads -- EXTERNALLY_READ_SECTIONS ("desktop",
    "tablet") and OBJECT_ALLOWED_SECTIONS ("dev_mock", "scoped_orphans") -- are this file's
    belief about scripts/verify-scoped-reads.py, whose allowlist_names() takes the members of
    exactly those two sections as the command names it grades and refuses any object member it
    is handed, and which runs bare at
    .github/workflows/dev-ci.yml:596 and scripts/check.sh:72 (its --shell default is
    desktop, so tablet is the same hazard one flag away). That script is not owned from
    here. If it ever learns the object form, move desktop and tablet into the allowed tuple
    in the same change; the case 11 text assertions are written to fail loudly if the
    tuples and that reader drift apart.
    """
    problems: list[str] = []
    name = getattr(path, "name", str(path))

    # A top-level list is the one shape that used to make this function itself raise
    # AttributeError -- the crash it exists to replace -- and an unknown section is quieter
    # and worse: it is written back verbatim by every writer and enforces nothing, so a
    # section typed "dev-mock" with a hyphen is a silent no-op allowlist that looks like a
    # list of exemptions to anyone reading the file.
    if not isinstance(payload, dict):
        return [
            f"{name} holds a {type(payload).__name__} at the top level, not an object with "
            f"named sections. This gate reads "
            f"{', '.join(chr(34) + s + chr(34) for s in KNOWN_SECTIONS)} and cannot point at "
            f"an entry inside a {type(payload).__name__}."
        ]
    for key in payload:
        if key in KNOWN_SECTIONS or str(key).startswith("_"):
            continue
        problems.append(
            f'{name} has a top-level section "{key}" that this gate does not read, so every '
            f"entry inside it enforces nothing. The only enforced sections are "
            f"{', '.join(chr(34) + s + chr(34) for s in KNOWN_SECTIONS)}; a name differing "
            f"from one of those by a hyphen or an underscore is a typo that silently allows "
            f"everything it appears to allow."
        )

    def why(section: str) -> str:
        if section in EXTERNALLY_READ_SECTIONS:
            return (
                f'The "{section}" section of {name} takes one bare command name per entry, '
                f'like "get_active_cart_scoped"; the object form {OBJECT_FORM} is accepted '
                f'only in "dev_mock" and "scoped_orphans". That split is deliberate today, '
                f"not an oversight: scripts/verify-scoped-reads.py grades this section by "
                f"those names (dev-ci.yml#static-gates and scripts/check.sh both run it "
                f"bare), so an object here makes that gate FAIL the build -- exit 1 and one "
                f"sentence naming this section and the entry's 1-based index, not a "
                f"traceback -- in a file its owner may not be working in. Keep the entry "
                f"bare and record why in the \"_{section}_comment\" prose or a tracking doc."
            )
        return (
            f'The "{section}" section of {name} accepts a bare command name or an object '
            f'{OBJECT_FORM}, but this entry carries no readable "name", so nothing can be '
            f"matched against it. Give it a name, or drop the entry."
        )

    for section in (*EXTERNALLY_READ_SECTIONS, *OBJECT_ALLOWED_SECTIONS):
        members = payload.get(section)
        if members is None:
            continue
        if not isinstance(members, list):
            problems.append(
                f'The "{section}" section of {name} is a {type(members).__name__}, not a '
                f"list of entries."
            )
            continue
        for index, raw in enumerate(members, 1):
            where = f'entry #{index} of the "{section}" section of {name}'
            if isinstance(raw, str):
                if not raw.strip():
                    problems.append(
                        f"{where} is blank. An empty name matches nothing and would enter "
                        f"the gate's sets as the empty string."
                    )
                continue
            if isinstance(raw, dict):
                if not str(raw.get("name", "")).strip():
                    problems.append(f"{where} is an object with no \"name\": {why(section)}")
                elif section in EXTERNALLY_READ_SECTIONS:
                    problems.append(
                        f"{where} is an object, {raw.get('name')!r}, and this section is "
                        f"graded by a second gate that reads each entry as a name. "
                        f"{why(section)}"
                    )
                continue
            problems.append(
                f"{where} is a {type(raw).__name__}, not a command name. {why(section)}"
            )
    return problems


def allowlist_section(payload: dict, key: str) -> list[tuple[str, str]]:
    """One allowlist section as (name, reason) pairs, in the order the file holds them.

    A member is either a bare command name -- the shape every section has always used, and
    still the shape "desktop", "tablet" and "scoped_orphans" are written in -- or an object
    carrying "name" and "reason". Measured 2026-09-16 against the committed file: dev_mock
    holds 15 entries and every one of them is an object (0 bare, 0 carrying a blank reason,
    since ce0c12357), while the other three hold 16, 143 and 25 bare names respectively.
    Both forms normalise to the same name; only the object form can carry a
    reason, and an empty, whitespace, or missing reason counts as no reason rather than as
    a reason that says nothing. Unknown keys on an object are ignored here and preserved by
    merge_dev_mock_entries, so an entry that later grows an "owner" or "expires" field loses
    nothing. A member with no name is dropped instead of entering a set as the empty string.
    """
    entries: list[tuple[str, str]] = []
    for raw in payload.get(key) or []:
        if isinstance(raw, dict):
            name = str(raw.get("name", "")).strip()
            reason = str(raw.get("reason", "") or "").strip()
        else:
            name, reason = str(raw).strip(), ""
        if name:
            entries.append((name, reason))
    return entries


def section_names(payload: dict, key: str) -> set[str]:
    """The membership view of a section: names only, reasons irrelevant.

    Every set operation this gate performs on an allowlist section goes through here, which
    is what makes the two-shape schema behaviour-free: a dict member and a string member
    take identical paths through gap-minus-allowlist, allowlist-minus-gap, and the counts
    printed alongside them.
    """
    return {name for name, _ in allowlist_section(payload, key)}


def m_allowlist_section(section: list) -> list[tuple[str, str]]:
    """allowlist_section over a bare list rather than a payload -- for the self-test."""
    return allowlist_section({"section": section}, "section")


def merge_section_entries(raw_section, gaps, allow_objects: bool = True) -> list:
    """Union new entries into ANY allowlist section, additively, keeping every reason.

    Additive only, for every section: an entry the measurement no longer reproduces stays
    in the file, because a writer flag is not a decision about that entry -- deleting one
    because today's sweep did not happen to re-derive it is how --write-allowlist came to
    delete the tablet ghost silently. Whether the entry is still owed is a question for the
    reader, which is why the gate now prints an unreachable line per section instead of
    quietly discarding the evidence.

    What this function exists to prevent is the other way to lose a decision -- a writer
    that eats a reason the operator typed. A known entry keeps the shape it was written in,
    so reseeding a list that has not moved produces a zero-byte diff rather than converting
    bare names into objects; a known object keeps its reason and its extra keys even when
    allow_objects is False, because downgrading it here would "repair" a file the validator
    is trying to make visible. A name present twice keeps whichever entry holds the reason.
    allow_objects only decides the shape of a GENUINELY NEW entry: sections that take the
    object form (dev_mock, scoped_orphans) get {"name": ..., "reason": ""} so the field is
    discoverable in the file; the shell sections (desktop, tablet) get a bare name, because
    writing the object shape there would produce a file this very gate refuses to read.
    """
    merged: dict[str, object] = {}

    def reason_of(entry) -> str:
        return str(entry.get("reason", "") or "") if isinstance(entry, dict) else ""

    def add(name: str, entry) -> None:
        if name not in merged:
            merged[name] = entry
        elif not reason_of(merged[name]) and reason_of(entry):
            merged[name] = entry

    for raw in raw_section or []:
        if isinstance(raw, dict):
            name = str(raw.get("name", "")).strip()
            if not name:
                continue
            add(name, {**raw, "name": name, **{"reason": str(raw.get("reason", "") or "")}})
        else:
            name = str(raw).strip()
            if name:
                add(name, name)
    for gap in gaps or []:
        name = str(gap).strip()
        if name:
            merged.setdefault(name, {"name": name, "reason": ""} if allow_objects else name)
    return [merged[name] for name in sorted(merged)]


class AllowlistWriteRefusal(RuntimeError):
    """This run read a good allowlist, decided what to change, and the WRITE did not happen.

    Not a subclass of `AllowlistUnusable`, and that separation is the whole point: that class
    means the bytes never arrived, while every refusal in this class arrives AFTER a clean read
    and a clean validation. Three causes, all of them about this process and its attempt to put
    new bytes where a shared file sits, none of them about the surface the gate grades --

    1. drift: the file on disk is not the file this run validated, because another lane
       committed inside the sweep between the two. Routine under concurrent agents, and
       re-runnable in one second;
    2. a busy target: Windows denied the rename onto a file a reader holds open, past the
       `REPLACE_ATTEMPTS` ceiling (the `AllowlistBusyError` from `write_allowlist_payload`);
    3. any other failure of the write itself: the sibling temp could not be made, the
       directory could not be created, the swap raised something that is not a sharing denial.

    Until now all three came back through `update_allowlist` as a `list[str]` and were
    printed as `FAIL: N allowlist write problem(s)` at exit 1 -- the VERDICT
    code, the one `apps/tablet-client/src/commands/sync.rs:639` and `scripts/gates.json` read
    as evidence about real command names. So a lock collision or a mid-commit sibling was
    reportable as a finding about somebody's keys, which is the confusion this file already
    closed at its read site (`e931220d9a`, `21da42e70f`) and the same one closed in
    scripts/verify-ftl-orphans.py (`4d1a85b15`) and scripts/verify-scoped-reads.py
    (`551f2a38eb`). This was the last live instance of it in the family.

    What stays at 1, unchanged, is what is genuinely a finding: a wrong ENTRY inside an
    allowlist this run did read (`allowlist_shape_problems`), and the parity verdict itself.
    """

    def __init__(self, sentences: list[str]):
        super().__init__("\n".join(sentences))
        self.sentences = list(sentences)


def refuse_unwritten_allowlist(refusal: AllowlistWriteRefusal) -> int:
    """The ONE handler for the ONE write-side class: `error:` on stderr, exit 2, no verdict.

    A separate voice from `refuse_unusable_allowlist` because the two sentences describe
    opposite facts -- there, nothing arrived; here, everything arrived and the new bytes still
    did not go back. And a separate voice from the FAIL lines because there is no count of
    findings to print: the run neither wrote nor graded. Every line names the WRITE, since an
    exit code alone is not evidence (see the module docstring and the register entry at
    `docs/records/audit-open-findings.md` for 2026-09-13 22:02, where a bare 2 was a broken
    allowlist path wearing a guard's face and got written down as something it was not).
    """
    for sentence in refusal.sentences:
        print(f"error: {sentence}", file=sys.stderr)
    print("error: the WRITE is what failed above. The allowlist arrived, this run read and "
          "validated it, and the new bytes never landed -- nothing was rewritten, nothing was "
          "graded, and this refusal says nothing about any command name.", file=sys.stderr)
    return 2


def update_allowlist(mutate, validated, label: str) -> list[str]:
    """The ONE place the write path opens this file: read, compare, mutate, replace.

    Returns entry-level FINDINGS (sentences, exit 1) or nothing; an empty list means it wrote.
    A write that could not be performed at all raises `AllowlistWriteRefusal` and is answered at
    exit 2 by `refuse_unwritten_allowlist` -- see that class for why the two are not the same
    kind of sentence.

    Two failures are closed here. The first is ordering: main() validates the payload, runs a
    sweep of roughly a third of a second, and then handed each writer a bare flag -- so every
    writer re-read the file and serialised a payload nobody had ever validated. Measured: with
    a clean file validated, a desktop object planted on disk during the sweep, and
    --write-scoped-orphans run, the writer dutifully wrote the object section back out, and
    the file came to rest in a shape this gate itself refuses, redding the next bare run in
    whichever lane hit it. That is the class of bug this whole session has been closing,
    arriving from the writer side.

    The second is the reviewer's last-writer-wins demo: writer B lands an entry, writer A
    overwrites it from an older snapshot, and nothing catches either one. Comparing what the
    writer just read against what the run validated catches exactly that, which is why there
    is no lock and no merge protocol here -- a refusal that names the race is enough, and it
    is honest about being a refusal. A collision is rare and cheap to redo; a sealed-over edit
    is invisible.
    """
    current = load_allowlist()
    if validated is not None and current != validated:
        raise AllowlistWriteRefusal([
            f"{label} did not write {ALLOWLIST_PATH.name}: the file changed after this run "
            f"read and validated it, during the sweep between the two. Writing now would seal "
            f"an edit nobody validated and possibly overwrite one somebody did. Re-run the "
            f"command; if both edits are meant to exist, make them one edit."
        ])
    problems = allowlist_shape_problems(current, ALLOWLIST_PATH)
    if problems:
        return [
            f"{label} did not write {ALLOWLIST_PATH.name}: what it just read is not a shape "
            f"this gate accepts, and writing it back would make the problem permanent.",
            *problems,
        ]
    payload = dict(current)
    summary = mutate(payload)
    try:
        write_allowlist_payload(payload)
    except AllowlistBusyError as busy:
        # Somebody else has the file open and never let go. The previous bytes are still on
        # disk, intact -- that is the whole content of this refusal, and it is not a verdict.
        raise AllowlistWriteRefusal(
            [f"{label} did not write {ALLOWLIST_PATH.name}: {busy}"]) from None
    except OSError as exc:
        # The other ways a write fails: the sibling temp would not be created, the directory
        # is not there or not writable, the swap raised something that is not a sharing denial.
        # Uncaught, each one escaped main() as a traceback, and an uncaught exception exits 1 --
        # the verdict code spent on a disk, not on a command.
        raise AllowlistWriteRefusal([
            f"{label} could not write {ALLOWLIST_PATH.name}: the write itself failed "
            f"({type(exc).__name__}: {exc.strerror or exc}). Nothing was put in its place, so "
            f"the file on disk is the file that was already there."
        ]) from None
    if summary:
        print(summary)
    return []


def report_shape_findings(findings: list[str]) -> int:
    """Print the entry-level findings one writer met, in the verdict voice, and return 1.

    Only shape findings reach this any more, and they keep exit 1 because they are findings:
    the file arrived, this run read it, and an ENTRY inside it is wrong. That is a statement
    about somebody's exemption, which is exactly what code 1 means here. What left this
    function is everything that used to be printed alongside it -- the drift, the busy
    rename, the failed write -- none of which say a word about the tree.

    The header says "shape" rather than the "write problem" it used to say, because that
    phrase described every refusal the writer could meet as a problem with the write and then
    charged all of them to the verdict code. The count is of the ENTRY-LEVEL problems, which
    are what the lines below it name: the first sentence is the flag's own report of what it
    declined to do, and counting it as a problem would print 2 about one bad entry -- the
    same numeral-printed-as-what-it-is-not this file already documents at case 13.
    """
    if not findings:
        return 0
    lead, *problems = findings
    print(f"\nFAIL: allowlist shape, {len(problems)} problem(s):", file=sys.stderr)
    for line in [lead, *problems]:
        print(f"  - {line}", file=sys.stderr)
    return 1


def write_or_refuse(run) -> int:
    """Run one writer flag, and pay for each kind of refusal in the voice that fits it.

    Three outcomes, three codes. A writer that met an allowlist which never arrived is the
    read boundary seen from the writer's side of the sweep: `error:`, exit 2, unchanged by
    this function. A writer whose own WRITE did not happen raises
    `AllowlistWriteRefusal` -- drift, a busy target, or any other failure of the write --
    and is answered by `refuse_unwritten_allowlist` at exit 2, because a lock collision and
    a sibling mid-commit are not evidence about anybody's command names. What `run()`
    RETURNS is the remaining case and the only one that keeps 1: the entry-level shape
    findings inside a file this run did read.
    """
    try:
        return report_shape_findings(run())
    except AllowlistWriteRefusal as refused:
        return refuse_unwritten_allowlist(refused)
    except AllowlistUnusable as unusable:
        return refuse_unusable_allowlist(unusable)


def write_dev_mock_gaps(gaps: list[str], validated: dict | None = None) -> list[str]:
    """Seed/extend "dev_mock" from the current gaps, preserving reasons and other sections."""
    def mutate(payload: dict) -> str:
        before = allowlist_section(payload, "dev_mock")
        payload["dev_mock"] = merge_section_entries(
            payload.get("dev_mock"), gaps, allow_objects=True)
        after = allowlist_section(payload, "dev_mock")
        return (
            f"dev_mock seeded: {len(after)} entries (+{len(after) - len(before)} new, "
            f"{sum(1 for _, reason in after if reason)} carrying a reason)"
        )

    return update_allowlist(mutate, validated, "--write-dev-mock-gaps")


def write_allowlist(missing: dict[str, set[str]], validated: dict | None = None) -> list[str]:
    """Seed/extend the two shell sections, additively, preserving every other section.

    This used to REPLACE both lists with sorted(measured gaps), which did two damaging
    things: it deleted an entry the current sweep did not reproduce -- an operator's
    hand-written exemption, or the tablet ghost that is neither a UI string nor registered
    anywhere -- and it did so with no diagnostic, no diff line anyone read, and no
    connection to why anyone would have run the flag. It is now a merge like the other two
    writer flags. Note that the file's own "_comment" still claims entries "shrink to zero
    as F-006 removes the dead surface": that was never the flag's job to enforce, and the
    unreachable info line is where a shrinking list is now evidenced.
    """
    # Preserve any section this function does not own. It used to rebuild the whole
    # payload, which meant running --write-allowlist silently deleted "scoped_orphans"
    # and un-masked 22 commands as failures on an unrelated reseed.
    def mutate(payload: dict) -> str:
        payload.setdefault(
            "_comment",
            "Known IPC registration gaps at gate introduction (F-008/F-050). "
            "Entries are UI command strings not yet registered in that shell; "
            "they shrink to zero as F-006 removes the dead surface. Stale "
            "entries (command now registered) fail the gate.",
        )
        for shell in SHELLS:
            payload[shell] = merge_section_entries(
                payload.get(shell), missing.get(shell, set()), allow_objects=False)
        kept = {
            shell: len(section_names(payload, shell) - missing.get(shell, set()))
            for shell in SHELLS
        }
        return (
            f"allowlist written: {ALLOWLIST_PATH.name} ("
            + ", ".join(
                f"{shell} {len(section_names(payload, shell))} command names, "
                f"{kept[shell]} carried over that this run did not reproduce"
                for shell in SHELLS)
            + ")"
        )

    return update_allowlist(mutate, validated, "--write-allowlist")


def write_scoped_orphans(orphans: set[str], validated: dict | None = None) -> list[str]:
    """Seed/extend the scoped_orphans section, preserving everything else.

    Read through section_names and written back through merge_section_entries, so an entry
    in the object form neither kills the flag nor loses its reason on the way out. The
    asymmetry that used to live here -- reader tolerant, writer a rebuild -- was the same
    defect the dev_mock section had already closed: an operator who was told objects are
    accepted in scoped_orphans would have been right until they ran the flag, and then wrong
    with no diagnostic. A docstring is not a defence against that sequence.
    """
    def mutate(payload: dict) -> str:
        payload["scoped_orphans"] = merge_section_entries(
            payload.get("scoped_orphans"), orphans, allow_objects=True)
        payload.setdefault(
            "_scoped_orphans_comment",
            "Scoped commands registered in a shell's generate_handler! that no client "
            "invokes, accepted as host-only. Each entry is a permission check that "
            "currently guards nothing, so this list is a work queue, not a clean bill of "
            "health. An entry that gains a caller fails the gate as stale -- and so does an "
            "entry whose command disappears from every shell, which is the opposite event; "
            "the failure line says which of the two was observed, because the fix for one is "
            "deleting the entry and the fix for the other is deleting the command.",
        )
        written = allowlist_section(payload, "scoped_orphans")
        return (
            f"scoped_orphans seeded: {len(written)} command names "
            f"({sum(1 for _, reason in written if reason)} carrying a reason)"
        )

    return update_allowlist(mutate, validated, "--write-scoped-orphans")


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

    What the self-clean cannot see on its own: allowlist minus live orphans is true for two
    opposite reasons. A scoped command that gained a caller stops being an orphan and stays
    registered -- that entry is stale, delete it. A scoped command deleted from every shell
    also stops being an orphan, and no caller appeared anywhere. Both land in the same
    loop, so the message has to test the per-shell inventories and say which one it found
    (stale_orphan_message); the single-clause version of that sentence, in this file and in
    the allowlist comment it seeds, described only the first.
    """
    called = set(ui_commands)
    return sorted(c for c in handlers if c.endswith("_scoped") and c not in called)


def stale_orphan_message(
    command: str, registered_in: list[str], allowlist_name: str
) -> str:
    """The failure line for an allowlisted scoped orphan that stopped being an orphan.

    Two opposite causes produce that one set difference and they want opposite fixes, so
    the line says which one the data shows. registered_in comes from the same per-shell
    generate_handler! inventories the orphan sweep runs on. Non-empty means the command is
    still wired up and something new is calling it -- the case every piece of prose about
    this gate has always described, and the entry should simply go. Empty means the
    command is registered in no shell any more: it was deleted. Nothing gained a caller,
    and the only action that would make the old sentence true is restoring dead code, so
    the line names the decision and leaves it to a human instead of implying an accident.
    """
    if registered_in:
        return (
            f"stale scoped_orphans entry '{command}' -- it is still registered in "
            f"{', '.join(registered_in)} and now has a caller; remove it from "
            f"{allowlist_name}"
        )
    return (
        f"scoped_orphans entry '{command}' names a command registered in no shell any "
        f"more -- it did not gain a caller, it was deleted from every generate_handler!, "
        f"so the entry did not go stale on its own. Remove it if deleting the command was "
        f"the point, or restore the command deliberately if it was not. {allowlist_name} "
        f"holds bare names and records neither choice."
    )


def _balanced_body(text: str, start: int) -> str:
    """The `{...}` block starting at or after `start`, brace-balanced."""
    open_idx = text.find("{", start)
    if open_idx < 0:
        return ""
    depth, j = 0, open_idx
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[start:j + 1]
        j += 1
    return ""


GATE_TOKEN_RE = re.compile(r"require_\w*permission|ctx\.require_session_permission", re.I)


def gate_in_body(body: str) -> str | None:
    """The permission a body enforces, or None when it enforces no check.

    `require_\\w*permission`, because the shells call `require_permission` and
    `require_permission_for_session` while `BridgeCtx` exposes `require_session_permission` --
    which the literal substring `require_permission` does NOT match. Any body that delegates to
    the bridge and is graded by a check looking for the narrow spelling reads as ungated.
    """
    if not body or not GATE_TOKEN_RE.search(body):
        return None
    p = re.search(r"permissions::([A-Z_]+)", body)
    return p.group(1) if p else "UNKNOWN"


def _bridge_fn_body(fn_name: str, cache={}) -> str:
    """The body of a `pub async fn` in `crates/kasirmu-bridge`, "" when there is none.

    Walked once per process and cached by name: this is called for every shell command that looks
    ungated, and re-reading the crate each time would make the gate slower than the thing it
    checks. Only the bridge is followed, one level -- a delegation that itself delegates is rare
    enough that reporting `None` for it is honest, while the one-level case is the repo's dominant
    shape since the shells became thin.
    """
    if not cache:
        root = REPO_ROOT / "crates" / "kasirmu-bridge" / "src"
        for rs in sorted(root.rglob("*.rs")) if root.is_dir() else []:
            text = rs.read_text(encoding="utf-8", errors="replace")
            for m in re.finditer(r"\bfn\s+(\w+)\s*\(", text):
                if m.group(1) in cache:
                    continue
                cache[m.group(1)] = _balanced_body(text, m.start())
    return cache.get(fn_name, "")


# A shell body that delegates is not judged by its own text alone -- the permission check it
# leans on lives in the bridge. The alternation carried `(?:oz|kasirmu)_bridge` while the
# crate rename was in flight; it is spelled once now that no `oz_bridge::` site remains.
DELEGATION_RE = re.compile(r"\bkasirmu_bridge::[a-z_0-9]+::([a-z_0-9]+)\s*\(")


def orphan_permission(command: str) -> str | None:
    """The permission a scoped command enforces, or None if it enforces no check.

    Why the gate bothers to read Rust bodies at all: an orphaned `_scoped` command is not
    one kind of thing. One whose body is only `resolve_session` then a forward is a
    redundant twin -- dead weight, but it guards nothing so it can also leak nothing, and
    at 32c402d28 and again at 3162b97b6 that is 14 of the section's 25 entries. One that DOES call
    `require_permission*` is different in kind: it is a permission gate -- one of
    SALES_PROCESS, SECURITY_MANAGE, SETTINGS_EDIT, SYNC_MANAGE or the four PAYABLES_* --
    wired into `generate_handler!` with no reachable caller, which reads as enforced posture
    while protecting nothing, and the same measurement puts it at 11. Neither number is
    quoted here as a standing fact: both are what THIS function returns, recomputed and
    printed on every run (python scripts/verify-ipc-parity.py | grep "info[scoped-orphans]").
    The sentence this slot carried until now read "19 of the 25 seeded entries are that" -- a
    count of a population the code below recomputes, written in the one place in a file where
    a stale number is read as the definition rather than as a measurement. What the eight gate
    names above are is also measured, not remembered: WORKSPACES_SWITCH appeared in the old
    sentence as a gate in the batch and does not gate any current entry, so it is gone from
    here and SALES_PROCESS and PAYABLES_*, which do, are named in its place. Whether 19 ever
    described a tree is a question about that tree, and the answer is in git, not here: `git
    log -S "19 of the 25" -- scripts/verify-ipc-parity.py` lands on 153c046a5. What the two
    kinds MEAN has not moved and never depended on the digits -- that distinction is exactly
    what cost six rounds of manual audit in item 46, and hand-triaging the whole list every
    time it changes is not going to happen.

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
            body = _balanced_body(text, m.start())
            if not body:
                continue
            direct = gate_in_body(body)
            if direct is not None:
                return direct
            # No gate in the shell's own body. In a thin shell that is the normal shape: the gate
            # lives in the bridge fn this line delegates to (ADR #49), so `None` used to mean
            # "redundant twin, wire a caller or allowlist it as host-only" for commands that are
            # gated two crates away. Follow the delegation one level before saying so.
            for target in DELEGATION_RE.findall(body):
                via_bridge = gate_in_body(_bridge_fn_body(target))
                if via_bridge is not None:
                    return via_bridge
            return None
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

    # 6: the two causes of a stale scoped_orphans entry, told apart. A registered name
    # gained a caller; a name in no shell at all was deleted, and "it now has a caller"
    # is a lie that sends a reader to restore the dead command. Differential on purpose:
    # before stale_orphan_message both cases printed the same sentence.
    gained = stale_orphan_message("probe_orphan_scoped", ["tablet"], "probe-allowlist.json")
    vanished = stale_orphan_message("probe_orphan_scoped", [], "probe-allowlist.json")
    case("case 6  a deleted command is not reported as a gained caller",
         "now has a caller" in gained and "no shell" not in gained
         and "now has a caller" not in vanished and "no shell" in vanished
         and bool(gained) and bool(vanished) and gained != vanished)

    # 7: the allowlist schema itself, which used to be an impossibility. Enforcement only
    # ever sees names, so both shapes must normalise to the same membership; and a dict
    # member has to be READABLE, which it was not -- the old coercion passed the section
    # straight into set() and died with "TypeError: cannot use 'dict' as a set element
    # (unhashable type: 'dict')", measured against a copy of the real allowlist before
    # allowlist_section existed. That is the assertion this change is judged on.
    mixed_section = [
        "list_security_events_scoped",
        {"name": "list_role_holders_scoped", "reason": "browser preview; recorded debt"},
    ]
    fake_payload = {"dev_mock": mixed_section}
    case("case 7  a dict member is readable, not unhashable",
         section_names(fake_payload, "dev_mock")
         == {"list_security_events_scoped", "list_role_holders_scoped"})
    case("case 7  the all-string form is untouched by the schema",
         section_names({"dev_mock": ["a_scoped", "b_scoped"]}, "dev_mock")
         == {"a_scoped", "b_scoped"})
    case("case 7  a bare name carries no reason and only an object can carry one",
         [n for n, r in allowlist_section(fake_payload, "dev_mock") if not r]
         == ["list_security_events_scoped"])
    case("case 7  an empty reason is no reason",
         [r for _, r in allowlist_section(
             {"dev_mock": [{"name": "x_scoped", "reason": "   "}]}, "dev_mock")] == [""])
    case("case 7  a nameless member is dropped, not swept in as the empty string",
         section_names({"dev_mock": ["", "   ", {"reason": "orphan"}]}, "dev_mock") == set())

    # 8: the writer keeps what a human wrote. A writer that eats a reason is worse than no
    # writer, because the operator's edit then looks saved while the decision is gone.
    reseeded = merge_section_entries(
        mixed_section, ["list_security_events_scoped", "a_brand_new_scoped"])
    case("case 8  a hand-written reason survives a reseed",
         {"name": "list_role_holders_scoped", "reason": "browser preview; recorded debt"}
         in reseeded)
    case("case 8  a known bare entry stays bare, so an unmoved list is a zero-line diff",
         merge_section_entries(["a_scoped", "b_scoped"], ["a_scoped"])
         == ["a_scoped", "b_scoped"])
    case("case 8  a new entry arrives with an empty reason so the shape is discoverable",
         {"name": "a_brand_new_scoped", "reason": ""} in reseeded)
    case("case 8  reseeding an already-seeded section changes nothing",
         merge_section_entries(
             reseeded, ["list_security_events_scoped", "a_brand_new_scoped"]) == reseeded)
    case("case 8  the same name written twice keeps the entry holding the reason",
         merge_section_entries(
             ["dup_scoped", {"name": "dup_scoped", "reason": "why"}], [])
         == [{"name": "dup_scoped", "reason": "why"}])
    case("case 8  an entry's extra keys survive the writer",
         merge_section_entries(
             [{"name": "k_scoped", "reason": "r", "owner": "licensing"}], [])
         == [{"name": "k_scoped", "reason": "r", "owner": "licensing"}])

    # 9: a writer has to leave the file as it found it. This one is measured on BYTES, in a
    # temp directory, because the failure it closes is invisible to every assertion above:
    # Python text mode turns a newline into os.linesep on Windows, so all three writer flags
    # used to re-emit the whole allowlist as CRLF without changing one character of its text
    # -- 235 lines marked modified by a session that nobody asked to edit them, on a file
    # another lane owns, in a checkout where a pathspec commit takes the working-tree copy.
    # ALLOWLIST_PATH is a module global, so it is rebound through globals() (assigning to the
    # name in here would only make a local) and restored in a finally: a self-test that wrote
    # the real allowlist would be the same hazard it exists to catch.
    sample = {
        "_comment": "one em — dash",
        "dev_mock": ["a_scoped", "b_scoped"],
        "desktop": [],
        "tablet": [],
        "scoped_orphans": [],
    }
    with tempfile.TemporaryDirectory() as tmp:
        saved_path = globals()["ALLOWLIST_PATH"]
        probe = Path(tmp) / "allowlist.json"
        try:
            globals()["ALLOWLIST_PATH"] = probe
            with redirect_stdout(io.StringIO()):
                write_allowlist_payload(sample)
                lf_only = probe.read_bytes()
                write_dev_mock_gaps(["a_scoped"])
                reseeded = probe.read_bytes()
                write_dev_mock_gaps(["a_scoped", "c_scoped"])
                grew = probe.read_bytes()
                write_allowlist({"desktop": set(), "tablet": set()})
                shells = probe.read_bytes()
                write_scoped_orphans({"probe_orphan_scoped"})
                orphans = probe.read_bytes()
            case("case 9  a writer emits LF, never the platform line ending",
                 b"\r" not in lf_only and lf_only.endswith(b"}\n"))
            case("case 9  reseeding a gap list that has not moved changes zero bytes",
                 lf_only == reseeded)
            case("case 9  a literal em dash is not re-escaped on the way out",
                 ("one em — dash" in grew.decode("utf-8")) and b"\\u" not in grew)
            case("case 9  a new gap still arrives in the discoverable object shape",
                 '"c_scoped"' in grew.decode("utf-8") and '"reason": ""' in grew.decode("utf-8"))
            case("case 9  every writer flag shares that one write path",
                 b"\r" not in shells and b"\r" not in orphans
                 and "probe_orphan_scoped" in orphans.decode("utf-8"))
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
    case("case 9  the self-test never touched the real allowlist path",
         globals()["ALLOWLIST_PATH"] == saved_path)

    # 10: the three reads that used to hand a raw section straight to set(). Grouped as the
    # no-op claim: routing them through section_names had to change nothing on a tree where
    # every entry was a bare name, and had to stop the crash where one is not. Both shapes
    # below are fixtures; the committed file holds 15 objects in dev_mock and 16 / 143 / 25
    # bare names in desktop / tablet / scoped_orphans (measured 2026-09-16), so the no-op half
    # of this claim describes the fixture and not the file on disk.
    mixed_scoped = ["a_scoped", {"name": "b_scoped", "reason": "host-only, no caller"}]
    case("case 10  scoped_orphans reads both shapes through the same helper",
         section_names({"scoped_orphans": mixed_scoped}, "scoped_orphans")
         == {"a_scoped", "b_scoped"})
    raw_would_crash = False
    try:
        set(mixed_scoped)
    except TypeError:
        raw_would_crash = True
    case("case 10  the set() this file used to call would still die on that payload",
         raw_would_crash)
    # The case that used to sit here asserted that every member of all four sections on disk
    # is a bare string. It is deleted, not updated. It was written as the no-op proof for
    # routing three reads through section_names, and that proof was earned once, against the
    # file as it was; kept, it forbids the very shape this file now documents as legal in
    # scoped_orphans and dev_mock, so the day a lane writes a proper reason object the suite
    # reddens for following the instructions. Without its numerals and its type check there is
    # nothing left to assert about the file's contents from here -- the invariant that does
    # hold, whatever entries a lane adds, is that the committed file must be readable, so that
    # is the one that stays.
    real_payload = load_allowlist()
    case("case 10  the committed allowlist is a shape this gate can read",
         allowlist_shape_problems(real_payload, ALLOWLIST_PATH) == [])
    with tempfile.TemporaryDirectory() as tmp2:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe = Path(tmp2) / "allowlist.json"
        try:
            globals()["ALLOWLIST_PATH"] = probe
            sys.argv = ["probe"]
            write_allowlist_payload({"dev_mock": [], "desktop": [], "tablet": [],
                                     "scoped_orphans": mixed_scoped})
            outcome: object = "raised"
            with redirect_stdout(io.StringIO()):
                write_scoped_orphans({"c_scoped"})
            written = json.loads(probe.read_text(encoding="utf-8"))["scoped_orphans"]
            # Names, not raw members: this case is about the READ surviving both shapes.
            # That the writer now keeps each entry's own shape is case 12's claim.
            outcome = sorted(name for name, _ in m_allowlist_section(written))
        except TypeError as exc:
            outcome = f"TypeError: {exc}"
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 10  the seed flag reads a mixed section and keeps both names",
         outcome == ["a_scoped", "b_scoped", "c_scoped"], )
    case("case 10  (and says so loudly if it goes back to raw set())",
         not isinstance(outcome, str), )

    # 11: the validator. This is the tolerance/refusal group -- one case per section, each
    # asserting the TEXT names the section it complains about, because an assertion that
    # only checks the exit code would pass on any crash at all.
    probe_name = Path("probe-allowlist.json")
    planted = {"name": "planted_scoped", "reason": "operator followed the dev_mock pattern"}
    problems_desktop = allowlist_shape_problems(
        {"desktop": ["ok_scoped", planted]}, probe_name)
    problems_tablet = allowlist_shape_problems({"tablet": [planted]}, probe_name)
    case("case 11  an object in desktop is refused, and the message names desktop and the file",
         len(problems_desktop) == 1
         and '"desktop"' in problems_desktop[0] and "probe-allowlist.json" in problems_desktop[0])
    case("case 11  and it names the external reader that refuses the object",
         "verify-scoped-reads" in problems_desktop[0]
         and OBJECT_FORM in problems_desktop[0])
    case("case 11  it says the split is deliberate, not an oversight",
         "deliberate" in problems_desktop[0] and "not an oversight" in problems_desktop[0])
    case("case 11  an object in tablet is refused too, and neither message blames the other",
         len(problems_tablet) == 1 and '"tablet"' in problems_tablet[0]
         and "tablet" not in problems_desktop[0] and "desktop" not in problems_tablet[0])
    case("case 11  the same object in scoped_orphans is NOT a problem -- part one made it safe",
         allowlist_shape_problems({"scoped_orphans": mixed_scoped}, probe_name) == [])
    case("case 11  and dev_mock keeps the shape it was given",
         allowlist_shape_problems({"dev_mock": mixed_scoped}, probe_name) == [])
    case("case 11  a nameless object is still a problem in a section that takes objects",
         len(allowlist_shape_problems({"dev_mock": [{"reason": "no name"}]}, probe_name)) == 1)
    case("case 11  and a number is a problem wherever it appears",
         len(allowlist_shape_problems({"scoped_orphans": [7]}, probe_name)) == 1)

    # End to end: an operator's actual experience is main(), not the helper. Planted object
    # in the desktop section of a throwaway copy, path rebound through globals() (a plain
    # assignment here would only make a local), argv stripped of --self-test so main() does
    # not recurse, and the TypeError path kept live so a removed guard reports itself as a
    # TypeError rather than as a passing test.
    with tempfile.TemporaryDirectory() as tmp3:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe3 = Path(tmp3) / "allowlist.json"
        verdict: object = "unset"
        printed = ""
        try:
            globals()["ALLOWLIST_PATH"] = probe3
            sys.argv = ["probe"]
            write_allowlist_payload({"_comment": "probe file, not the real allowlist",
                                     "dev_mock": [], "desktop": ["ok_scoped", planted],
                                     "tablet": [], "scoped_orphans": []})
            err = io.StringIO()
            with redirect_stdout(io.StringIO()), redirect_stderr(err):
                verdict = main()
            printed = err.getvalue()
        except TypeError as exc:
            verdict = f"TypeError: {exc}"
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 11  main() exits 1 on the shape problem instead of raising",
         verdict == 1, )
    case("case 11  and what it printed is the sentence, not a stack trace",
         "FAIL: allowlist shape" in printed and '"desktop"' in printed
         and "verify-scoped-reads" in printed and "Traceback" not in printed)

    # 12: what a writer leaves behind. A rebuild deletes a decision nobody made; the three
    # writer flags used to rebuild their sections from the current measurement, so an entry
    # the measurement no longer reproduces -- the ghost a dead wrapper left in "tablet", a
    # reason an operator typed into "scoped_orphans" -- vanished on the next reseed with no
    # diagnostic at all. Each case below checks BYTES or TEXT, never an exit code: mutation B
    # in this file proved an exit-code assertion passes happily while its guard is gone.
    # Synthetic on purpose. The real instance of this shape is rotate_encryption_key in the
    # tablet section -- not a UI string, not registered in either shell, still answered by a
    # dev-mock handler -- but naming it here would make the case read the tree: the moment a
    # lane registers that command, it stops being unreachable, and the tree getting better
    # would redden a test about my writer. The shape is what is pinned, not the name.
    ghost_tablet = "ghost_carried_over_scoped"
    typed_reason = {"name": "get_active_cart_scoped", "reason": "host-only, kept on purpose"}
    writer_sample = {
        "_comment": "probe file, never the real allowlist",
        "desktop": ["desktop_gap_scoped"],
        "tablet": [ghost_tablet, "tablet_gap_scoped"],
        "scoped_orphans": [typed_reason],
        "dev_mock": ["mock_gap_scoped"],
    }
    with tempfile.TemporaryDirectory() as tmp4:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe4 = Path(tmp4) / "allowlist.json"
        try:
            globals()["ALLOWLIST_PATH"] = probe4
            sys.argv = ["probe"]
            quiet = io.StringIO()
            write_allowlist_payload(dict(writer_sample))
            seeded_once = probe4.read_bytes()
            with redirect_stdout(quiet):
                write_allowlist({"desktop": {"desktop_gap_scoped"},
                                 "tablet": {"tablet_gap_scoped"}})
            after_shell_merge = json.loads(probe4.read_bytes().decode("utf-8"))
            with redirect_stdout(quiet):
                write_scoped_orphans({"get_active_cart_scoped"})
            after_orphan_merge = json.loads(probe4.read_bytes().decode("utf-8"))
            before_stable = probe4.read_bytes()
            with redirect_stdout(quiet):
                write_scoped_orphans({"get_active_cart_scoped"})
            stable_bytes = probe4.read_bytes()
            with redirect_stdout(quiet):
                write_allowlist({"desktop": {"desktop_gap_scoped", "brand_new_gap_scoped"},
                                 "tablet": {"tablet_gap_scoped"}})
            shell_text = probe4.read_bytes().decode("utf-8")
            written_back = json.loads(probe4.read_bytes().decode("utf-8"))
            err = io.StringIO()
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                main()
            report = out.getvalue() + err.getvalue()
            payload_for_unreachable = json.loads(probe4.read_bytes().decode("utf-8"))
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 12  a desktop/tablet entry the measurement no longer reproduces survives",
         ghost_tablet in after_shell_merge["tablet"]
         and "tablet_gap_scoped" in after_shell_merge["tablet"], )
    case("case 12  and a reason written by hand survives --write-scoped-orphans",
         after_orphan_merge["scoped_orphans"] == [typed_reason], )
    case("case 12  an unmoved section reseeds to a zero-byte diff",
         stable_bytes == before_stable, )
    case("case 12  a new shell gap arrives as a bare name, never the shape the reader refuses",
         "brand_new_gap_scoped" in written_back["desktop"]
         and all(isinstance(e, str) for e in written_back["desktop"])
         and allowlist_shape_problems(written_back, Path("probe-allowlist.json")) == [])
    # Pinned to the unreachable line itself. The first version asked only whether the ghost
    # name appeared anywhere in the run, and mutation M3 -- deleting the computation -- still
    # passed it, because a gate this noisy mentions a command string for other reasons. An
    # assertion that reads someone else's output is the same failure as an exit-code check.
    unreach_lines = [ln for ln in report.splitlines() if "-unreachable]:" in ln]
    case("case 12  the unreachable check names a ghost that is neither gap nor handler",
         len(unreach_lines) == 2
         and any(ln.startswith("info[tablet-unreachable]: 2 of 2")
                 and ghost_tablet in ln for ln in unreach_lines)
         and all("neither" in ln for ln in unreach_lines), )
    # Pinned to the SHELL line on purpose. The first version of this case asked whether the
    # run printed "(1 allowlisted)" anywhere, and it passed before the repair existed: the
    # dev_mock line already says that, so the assertion was reading a different section's
    # report. Same trap, caught by looking for the case that passes anyway.
    shell_lines = [ln for ln in report.splitlines() if ln.startswith("info[desktop]:")]
    case("case 12  and each shell's own line says how many entries it is allowlisting",
         len(shell_lines) == 1 and "allowlisted)" in shell_lines[0]
         and "2 allowlisted" in shell_lines[0], )

    # 13: a number printed as what it is not. info[scoped-orphans] used to print
    # len(all_orphans) -- orphans found in the tree this run -- under the word "allowlisted",
    # which is the size of a section of a file. On the real tree the two are 27 and 25, and
    # the line read as proof that someone had edited the json under us. Each claim below is
    # checked against the printed line's TEXT, from a probe whose allowlist size I control,
    # so it cannot be satisfied by the tree's number.
    ghost_scoped = "ghost_orphan_that_no_shell_registers_scoped"
    probe_orphan_allow = [ghost_scoped, "get_active_cart_scoped", "list_active_carts_scoped"]
    with tempfile.TemporaryDirectory() as tmp5:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe5 = Path(tmp5) / "allowlist.json"
        labelled = ""
        try:
            globals()["ALLOWLIST_PATH"] = probe5
            sys.argv = ["probe"]
            write_allowlist_payload({
                "_comment": "probe file, never the real allowlist",
                "dev_mock": [], "desktop": ["desktop_gap_scoped"],
                "tablet": ["tablet_gap_scoped"], "scoped_orphans": probe_orphan_allow,
            })
            out5, err5 = io.StringIO(), io.StringIO()
            with redirect_stdout(out5), redirect_stderr(err5):
                main()
            labelled = out5.getvalue() + err5.getvalue()
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    scoped_lines = [ln for ln in labelled.splitlines()
                    if ln.startswith("info[scoped-orphans]:")]
    case("case 13  the allowlist figure says entries and reports the size of the section",
         len(scoped_lines) == 1 and "3 entries allowlisted" in scoped_lines[0], )
    # No numeral here. The tree figure on this line is measured from the checkout, so any
    # number this case compares it against -- including "not equal to 3" -- is a tax on
    # somebody else registering or unwiring a command: a claim that stays true only while the
    # tree stands still. What survives without numbers is the actual defect claim, that the
    # line carries two figures with two distinct labels rather than one figure under the wrong
    # word, and that is checked in words. The numeral belongs to the fixture I own, and it is
    # in the case above: three planted members, three entries allowlisted.
    case("case 13  and the tree figure carries its own label, separate from the file's",
         " orphans measured in the tree," in scoped_lines[0]
         and ghost_scoped not in scoped_lines[0], )

    desktop_line = [ln for ln in labelled.splitlines()
                    if ln.startswith("info[desktop]:")]
    case("case 13  the shell line keeps its two populations apart, each with its unit named",
         len(desktop_line) == 1 and "unregistered UI command names" in desktop_line[0]
         and "unregistered tauri command fns" in desktop_line[0]
         and desktop_line[0].count("unregistered") == 2, )

    # 14: how the file is replaced. The claim is that a reader can never observe a partial
    # file, so every assertion here inspects bytes or the arguments of the rename itself. The
    # two-process torn-read measurement that motivated it is reported outside the suite (a
    # writer loop plus a json.loads reader against a copy): 1,227 of 5,607 reads failed under
    # write_text, zero under this. These four cases are the deterministic half of that proof.
    rename_args: list[dict] = []
    real_replace = os.replace
    real_write_text = Path.write_text

    def spy_replace(src, dst, *args, **kwargs):
        src_path = Path(src)
        rename_args.append({
            "same_dir": src_path.parent == Path(dst).parent,
            "dst_name": Path(dst).name,
            "src_prefix": src_path.name.startswith(Path(dst).name + "."),
            "bytes_at_rename": src_path.read_bytes(),
        })
        return real_replace(src, dst, *args, **kwargs)

    def spy_write_text(self, *args, **kwargs):
        rename_args.append({"write_text_on": str(self)})
        return real_write_text(self, *args, **kwargs)

    sample_payload = {"dev_mock": ["first_scoped"], "desktop": [], "tablet": [],
                      "scoped_orphans": []}
    with tempfile.TemporaryDirectory() as tmp7:
        saved_path = globals()["ALLOWLIST_PATH"]
        probe7 = Path(tmp7) / "allowlist.json"
        first_bytes = b""
        after_retry = b""
        busy_error = ""
        after_busy = b""
        listing_busy: list[str] = []
        try:
            globals()["ALLOWLIST_PATH"] = probe7
            globals()["os"].replace = spy_replace
            Path.write_text = spy_write_text
            try:
                write_allowlist_payload(sample_payload)
                first_bytes = probe7.read_bytes()
                # A rename that fails once, the ordinary WinError 5 against a reader that is
                # mid-open, must still land.
                attempts = {"n": 0}
                def flaky(src, dst, *args, **kwargs):
                    attempts["n"] += 1
                    if attempts["n"] == 1:
                        raise PermissionError(5, "simulated reader holding the file")
                    return real_replace(src, dst, *args, **kwargs)
                globals()["os"].replace = flaky
                write_allowlist_payload({"dev_mock": ["second_scoped"], "desktop": [],
                                         "tablet": [], "scoped_orphans": []})
                after_retry = probe7.read_bytes()
                # A target busy past the ceiling must refuse in words and change nothing.
                globals()["os"].replace = lambda src, dst, *a, **k: (_ for _ in ()).throw(
                    PermissionError(5, "simulated permanent contention"))
                before_busy = probe7.read_bytes()
                try:
                    write_allowlist_payload({"dev_mock": ["third_scoped"], "desktop": [],
                                             "tablet": [], "scoped_orphans": []})
                except AllowlistBusyError as busy:
                    busy_error = str(busy)
                after_busy = probe7.read_bytes()
                listing_busy = sorted(entry.name for entry in Path(tmp7).iterdir())
            finally:
                globals()["os"].replace = real_replace
                Path.write_text = real_write_text
        finally:
            # Both restores are deliberate: the inner one covers the ordinary path, this one
            # covers a case that raised before reaching it. A self-test that leaves the
            # process-wide os.replace patched would poison every later case in the run.
            globals()["ALLOWLIST_PATH"] = saved_path
            globals()["os"].replace = real_replace
            Path.write_text = real_write_text
    renames = [r for r in rename_args if "write_text_on" not in r]
    # One recorded rename, not three: after the first write the spy is replaced by the
    # flaky and then the permanently-denying stubs, which are the point of those two cases.
    # The expectation of three here was wrong, not the code -- the case failed on its first
    # run, which is the only reason I know.
    case("case 14  the file arrives by rename from a sibling temp, never by truncation",
         len(renames) == 1 and renames[0]["same_dir"] and renames[0]["src_prefix"]
         and renames[0]["dst_name"] == "allowlist.json"
         and not [r for r in rename_args if "write_text_on" in r], )
    case("case 14  and what the rename publishes is the whole file, byte for byte",
         renames and renames[0]["bytes_at_rename"] == first_bytes, )
    case("case 14  a rename denied once still lands the new content",
         b"second_scoped" in after_retry and b"first_scoped" not in after_retry, )
    case("case 14  a rename denied forever leaves the previous bytes untouched and says so",
         busy_error != "" and after_busy == after_retry
         and "would not accept the rename" in busy_error and "nothing was written" in busy_error, )
    case("case 14  and it leaves no half-written sibling behind",
         listing_busy == ["allowlist.json"], )

    # 15: a writer may only serialise what this run looked at.
    drift_planted = {"name": "sneaked_scoped", "reason": "typed by a hand elsewhere"}
    with tempfile.TemporaryDirectory() as tmp8:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe8 = Path(tmp8) / "allowlist.json"
        refusals: dict[str, object] = {}
        try:
            globals()["ALLOWLIST_PATH"] = probe8
            sys.argv = ["probe"]
            clean = {"_comment": "probe file, never the real allowlist", "dev_mock": [],
                     "desktop": [], "tablet": [], "scoped_orphans": []}
            write_allowlist_payload(clean)
            validated_copy = load_allowlist()
            moved = dict(validated_copy)
            moved["desktop"] = [drift_planted]
            write_allowlist_payload(moved)
            try:
                refusals["drift"] = write_scoped_orphans({"new_orphan_scoped"},
                                                        validated_copy)
            except AllowlistWriteRefusal as refused:
                refusals["drift"] = refused.sentences
            refusals["drift_bytes"] = probe8.read_bytes()
            write_allowlist_payload(clean)
            quiet = io.StringIO()
            with redirect_stdout(quiet):
                refusals["clean"] = write_scoped_orphans({"new_orphan_scoped"},
                                                         load_allowlist())
            refusals["clean_bytes"] = probe8.read_bytes()
            write_allowlist_payload(moved)
            refusals["unvalidated"] = write_dev_mock_gaps(["mock_gap_scoped"])
            refusals["unvalidated_bytes"] = probe8.read_bytes()
            # A target that never clears must reach the operator as a refusal line, not as a
            # traceback out of a flag. Mutation MF found this assertion: without it, the
            # busy-to-refusal wrap was decorative and the writer propagated. Restored to a
            # clean file first, because the shape refusal would otherwise answer before the
            # busy one is ever reached -- which is what this case did on its first run.
            write_allowlist_payload(clean)
            real_rep = os.replace
            os.replace = lambda src, dst, *a, **k: (_ for _ in ()).throw(
                PermissionError(5, "simulated permanent contention"))
            try:
                refusals["before_busy"] = probe8.read_bytes()
                try:
                    write_dev_mock_gaps(["busy_gap_scoped"], load_allowlist())
                    refusals["busy"] = ["<WROTE, DID NOT REFUSE>"]
                except AllowlistWriteRefusal as refused:
                    refusals["busy"] = refused.sentences
                refusals["busy_bytes"] = probe8.read_bytes()
            finally:
                os.replace = real_rep
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 15  a file that moved after validation is refused in words, not written",
         len(refusals["drift"]) == 1
         and "--write-scoped-orphans did not write" in refusals["drift"][0]
         and "changed after this run" in refusals["drift"][0]
         and b"sneaked_scoped" in refusals["drift_bytes"]
         and b"new_orphan_scoped" not in refusals["drift_bytes"], )
    case("case 15  the same writer with the snapshot it validated does write",
         refusals["clean"] == [] and b"new_orphan_scoped" in refusals["clean_bytes"], )
    case("case 15  and an unvalidated read cannot seal the shape the gate refuses",
         any("desktop" in line for line in refusals["unvalidated"])
         and b"sneaked_scoped" in refusals["unvalidated_bytes"]
         and b"mock_gap_scoped" not in refusals["unvalidated_bytes"], )
    case("case 15  a permanently busy target is refused in words and writes nothing",
         len(refusals["busy"]) == 1
         and "--write-dev-mock-gaps did not write" in refusals["busy"][0]
         and "nothing was written" in refusals["busy"][0]
         and refusals["busy_bytes"] == refusals["before_busy"]
         and b"busy_gap_scoped" not in refusals["busy_bytes"], )

    # 16: the two ways the validator itself was wrong -- an unknown section it never looked
    # at, and a payload shape that made it raise.
    hyphen = allowlist_shape_problems({"dev-mock": ["get_customer_scoped"]}, probe_name)
    prose_ok = allowlist_shape_problems(
        {"_comment": "prose", "desktop": ["get_customer_scoped"],
         "scoped_orphans": [{"name": "x_scoped", "reason": "host-only"}]}, probe_name)
    list_outcome: object = "unset"
    try:
        list_outcome = allowlist_shape_problems(["desktop", "tablet"], probe_name)
    except Exception as exc:
        list_outcome = type(exc).__name__
    case("case 16  a section this gate does not read is reported as enforcing nothing",
         len(hyphen) == 1 and "dev-mock" in hyphen[0]
         and "does not read" in hyphen[0] and "enforces nothing" in hyphen[0], )
    case("case 16  prose keys and the four real sections stay problem-free",
         prose_ok == [], )
    case("case 16  and a top-level list is a sentence rather than an AttributeError",
         isinstance(list_outcome, list) and len(list_outcome) == 1
         and "list" in list_outcome[0] and "named sections" in list_outcome[0], )

    # 17: the reader's half of the atomic swap. A rename is atomic but not invisible, and
    # 163-215 denials per ~8,400 reads is what that costs on Windows, so the reader has to
    # wait rather than die -- and when waiting is not enough, say so in a sentence.
    real_read = Path.read_text
    denies = {"n": 0}
    def deny_then_allow(self, *args, **kwargs):
        denies["n"] += 1
        if denies["n"] <= 2:
            raise PermissionError(13, "simulated rename in flight")
        return real_read(self, *args, **kwargs)
    def deny_forever(self, *args, **kwargs):
        raise PermissionError(13, "simulated permanent lock")
    with tempfile.TemporaryDirectory() as tmp9:
        saved_path = globals()["ALLOWLIST_PATH"]
        probe9 = Path(tmp9) / "allowlist.json"
        recovered: object = "unset"
        refused = ""
        try:
            globals()["ALLOWLIST_PATH"] = probe9
            write_allowlist_payload({"dev_mock": ["read_gap_scoped"], "desktop": [],
                                     "tablet": [], "scoped_orphans": []})
            globals()["os"].replace = real_replace
            Path.read_text = deny_then_allow
            try:
                recovered = load_allowlist()
            except Exception as exc:
                # Recorded, not propagated: with the retry removed this raises, and a suite
                # that dies on an exception reports no case name at all. Both of those
                # mutations were run before this line existed and both showed up as an abort
                # rather than as the failing case they are.
                recovered = f"{type(exc).__name__}: {exc}"
            finally:
                Path.read_text = real_read
            Path.read_text = deny_forever
            try:
                load_allowlist()
            except Exception as exc:
                refused = f"{type(exc).__name__}: {exc}"
            finally:
                Path.read_text = real_read
        finally:
            Path.read_text = real_read
            globals()["ALLOWLIST_PATH"] = saved_path
    case("case 17  a denied open is waited out and the payload still loads",
         isinstance(recovered, dict)
         and section_names(recovered, "dev_mock") == {"read_gap_scoped"}, )
    case("case 17  and a lock that never clears is a sentence, not a traceback",
         "could not be opened" in refused and "another process is holding it" in refused
         and "PermissionError" not in refused, )

    # 18: the liveness rule is exact set membership, and this pins that it stays that way.
    # A report claimed the orphan test matches command names by substring, which would let one
    # live command keep a dead entry alive. It does not today -- orphan_allow is never an input
    # to orphan_scoped, so entries cannot support each other -- but the claim is cheap to make
    # true by accident, and a containment rewrite reads exactly as plausible as the current
    # line. These are the two shapes that would break first under it, on synthetic inputs.
    contains_ui = {
        "x_scoped_for_terminal": ["ui/b.ts"], # a longer name containing the entry IS invoked
        "get_encryption_status": ["ui/c.ts"], # the bare stem of another entry IS invoked
    }
    suffix_only = orphan_scoped(["x_scoped", "y_scoped"], contains_ui)
    family = orphan_scoped(["get_encryption_status_scoped"], contains_ui)
    control = [orphan_scoped(["x_scoped"], {"x_scoped": ["ui/a.ts"]}),
               orphan_scoped(["x_scoped"], {"unrelated_name": ["ui/a.ts"]})]
    case("case 18  an orphan stays an orphan when only a LONGER name has a caller",
         suffix_only == ["x_scoped", "y_scoped"], )
    case("case 18  the bare stem being invoked does not make its _scoped twin called",
         family == ["get_encryption_status_scoped"], )
    case("case 18  controls, invoked is called and a name with no caller is an orphan",
         control == [[], ["x_scoped"]], )

    # 19: the inertness line for every section, on a fixture whose numerals are mine. Invented
    # names cannot appear in an api file, so "0 of 1" is deterministic without reading the tree
    # -- the coupling that took case 13's numeral out.
    with tempfile.TemporaryDirectory() as tmp10:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe10 = Path(tmp10) / "allowlist.json"
        inert_out = ""
        probe_payload = {
            "_comment": "probe file, never the real allowlist",
            "desktop": ["probe_zz_uninvoked_a"], "tablet": ["probe_zz_uninvoked_b"],
            "dev_mock": ["probe_zz_uninvoked_c"],
            "scoped_orphans": ["probe_zz_uninvoked_d"],
        }
        try:
            globals()["ALLOWLIST_PATH"] = probe10
            sys.argv = ["probe"]
            write_allowlist_payload(probe_payload)
            out10, err10 = io.StringIO(), io.StringIO()
            with redirect_stdout(out10), redirect_stderr(err10):
                main()
            inert_out = out10.getvalue() + err10.getvalue()
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    # Figures are PARSED and compared to the fixture, never to a count of a constant the loop
    # above sets. The first version asserted len(lines) == 4 next to a 4-element section tuple,
    # which is a value compared to itself: it would have held with any line content, including
    # no names, no populations, and the wrong sections. Everything numeric here is either 1 (my
    # invented entry, one per section) or a floor on the tree figure, and the floor is what
    # makes the denominator's provenance testable -- 4 names in the file cannot produce a
    # population of hundreds, so a line that derives its middle figure from the file fails.
    line_re = re.compile(
        r"^info\[(?P<section>[a-z_]+)-inert\]: (?P<entries>\d+) allowlisted entries, "
        r"(?P<pop>\d+) (?P<unit>[^,]+), (?P<universe>\d+) command names in the tree this "
        r"run; (?P<names>\d+) of the allowlisted entries match no command name in the tree "
        r"at all and (?P<callers>\d+) match no UI invoke site")
    inert_lines = [ln for ln in inert_out.splitlines() if "-inert]:" in ln]
    # Counted from the fixture, never quoted from a tree: four sections, one invented name
    # each, so this is 4 by arithmetic on my own dict and cannot move with a checkout. It is
    # the far side of the provenance test -- the tree denominator must be bigger than the
    # whole fixture, which is a claim about where the number came from rather than about what
    # the tree happens to hold. An earlier version compared it against a literal 100, and this
    # suite went red twice tonight over floors of exactly that kind.
    fixture_entries_total = sum(len(v) for k, v in probe_payload.items() if not k.startswith("_"))
    parsed = [line_re.match(ln) for ln in inert_lines]
    matched = [m for m in parsed if m is not None]
    # This is the assertion that has to fail by NAME when the line's format changes. Without
    # the matched/inert_lines pairing a mutated line stops parsing, every later assertion
    # becomes all() over an empty list, and the suite reports an AttributeError traceback
    # instead of a case -- exit 1 with no name is how three of tonight's findings nearly got
    # away. The pairing is len(matched) == len(inert_lines) plus a non-empty check, so the
    # later assertions are vacuous exactly when this one has already reddened.
    case("case 19  every enforced section reports, in order, and the line parses as claimed",
         bool(inert_lines) and len(matched) == len(inert_lines)
         and [m.group("section") for m in matched]
         == ["desktop", "tablet", "dev_mock", "scoped_orphans"], )
    case("case 19  each line counts my one invented entry on both sides of its own fraction",
         len(matched) == len(inert_lines)
         and all(m.group("entries") == "1" and m.group("names") == "1"
                 and m.group("callers") == "1" for m in matched), )
    # One tree measurement, printed identically on all four lines, and larger than the entire
    # fixture file. A line that derived its denominator from the allowlist would print 1 or 4
    # here and cannot print anything bigger than 4, so this is the assertion that dies if the
    # tree denominator is deleted -- and no figure in it names a tree quantity, so it stays true
    # on a checkout where every gap in the repo has been registered. The middle population
    # figure carries its spelled-out unit and nothing else: its value is a tree count, and a
    # suite that reddens because another lane closed or opened a gap is a second gate, not a
    # test of the first.
    case("case 19  the denominator is one tree measurement, not the file's own size",
         len(matched) == len(inert_lines)
         and len({m.group("universe") for m in matched}) == 1
         and int(matched[0].group("universe")) > fixture_entries_total
         and all(len(m.group("unit").strip()) > 10 for m in matched), )
    case("case 19  and a name that matches nothing is printed by name, in the right list",
         all(f"by name: probe_zz_uninvoked_{tail}" in ln
             and f"by caller: probe_zz_uninvoked_{tail}" in ln
             for ln, tail in zip(inert_out.splitlines(), "abcd")
             if "-inert]:" in ln)
         and all("UI invoke site" in ln and "wrapper" not in ln for ln in inert_lines), )

    # 20: the busy refusal has to name every reader that can be hit, which is the only reason
    # the tuple exists. Asserted twice on purpose. The printed sentence is BUILT from the
    # tuple, so a text-only check is tautological -- delete an element and it still passes,
    # which is exactly how the fourth reader stayed off the list. The literal expectation is
    # the half that reddens when a runner is forgotten; the text half only proves the message
    # joins what it claims to join.
    real_rep20 = os.replace
    with tempfile.TemporaryDirectory() as tmp11:
        saved_path = globals()["ALLOWLIST_PATH"]
        probe11 = Path(tmp11) / "allowlist.json"
        busy_text = ""
        try:
            globals()["ALLOWLIST_PATH"] = probe11
            write_allowlist_payload({"dev_mock": [], "desktop": [], "tablet": [],
                                     "scoped_orphans": []})
            os.replace = lambda src, dst, *a, **k: (_ for _ in ()).throw(
                PermissionError(5, "simulated permanent contention"))
            try:
                write_allowlist_payload({"dev_mock": ["x_scoped"], "desktop": [], "tablet": [],
                                         "scoped_orphans": []})
            except AllowlistBusyError as busy:
                busy_text = str(busy)
            finally:
                os.replace = real_rep20
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
    # The expectation is a literal here, not a view of the tuple: the first version compared
    # set(tuple) against a set written from the same four strings and a length guard taken from
    # the tuple itself, so dropping an element from the list could not redden the second
    # assertion -- the sentence under test is BUILT from that list, which makes a
    # tuple-in-text check a value compared to itself. That is how the fourth reader stayed
    # unlisted all night. busy_text is produced by write_allowlist_payload against a rename
    # patched to fail, so it is the code path's output, not a string assembled here.
    expected_readers = [
        ".github/workflows/dev-ci.yml:590",
        "scripts/check.sh:56",
        "scripts/run-pre-push.py:107",
        "scripts/verify-scoped-reads.py:266",
    ]
    case("case 20  the bare readers are exactly these four paths, in this order",
         list(ALLOWLIST_READER_CALL_SITES) == expected_readers, )
    case("case 20  and the refusal the code produces names every path in that literal list",
         "Readers of this path:" in busy_text
         and all(site in busy_text for site in expected_readers), )
    # RESIDUAL GAP, named rather than left looking like coverage: neither assertion can tell me
    # that the four strings still point at real bare reads. The line numbers were true at
    # 2026-09-13 12:36 and scripts/verify-scoped-reads.py is being edited by another lane now,
    # so :266 can drift out from under audit() and every assertion above stays green. Policing
    # that would mean reading a file outside this fence from inside a self-test, which is a
    # worse coupling than the one it closes. This case is a drift tripwire on the LIST, not a
    # proof about the four readers.

    # 21: the five refusals at the read site. Each one is checked on the SENTENCE and on
    # BYTES -- never on an exit code alone, which case 12 proved can pass with the guard
    # deleted -- and each runs main() against a probe so the assertion covers the operator's
    # actual experience: the whole-tree walk and all three writer flags must not happen over
    # an input nobody read. The healthy shapes in this group are the other half of the claim:
    # a section stated as an empty list is a decision the file made, and refusing it would
    # make the gate unable to read its own output.
    shape_sample = {"_comment": "probe file, never the real allowlist",
                  **{s: [] for s in KNOWN_SECTIONS}}
    refusal_shapes = {
        "a top-level array": json.dumps([{"desktop": ["probe_zz_gap_scoped"]}]),
        "a section holding a scalar": json.dumps({**shape_sample, "dev_mock": "abc"}),
        "an object with none of the four sections": '{"primitives": 42}',
    }
    for label, planted in refusal_shapes.items():
        with tempfile.TemporaryDirectory() as tmp12:
            saved_path = globals()["ALLOWLIST_PATH"]
            saved_argv = list(sys.argv)
            probe12 = Path(tmp12) / "ipc-parity-allowlist.json"
            seen: object = "no-run"
            try:
                globals()["ALLOWLIST_PATH"] = probe12
                sys.argv = ["probe", "--write-dev-mock-gaps"]
                probe12.write_text(planted, encoding="utf-8")
                before12 = probe12.read_bytes()
                out12, err12 = io.StringIO(), io.StringIO()
                with redirect_stdout(out12), redirect_stderr(err12):
                    seen = main()
                # Read the bytes INSIDE the block: a TemporaryDirectory is gone once the
                # with exits, and an assertion that stats a deleted path proves nothing.
                seen = (seen, (out12.getvalue() + err12.getvalue()).strip(),
                        probe12.read_bytes())
            finally:
                globals()["ALLOWLIST_PATH"] = saved_path
                sys.argv = saved_argv
            case(f"case 21  {label} is refused in words, at the read site",
                 isinstance(seen, tuple) and seen[0] == 2
                 and probe12.name in seen[1] and seen[1].startswith("error:"), )
            case(f"case 21  {label} writes NOTHING back, so a non-read cannot truncate the file",
                 isinstance(seen, tuple) and seen[2] == before12, )

    # A file that is not there and a file that is not JSON are the two shapes a torn rename
    # can produce, and the fabricated {"desktop": [], "tablet": []} this reader used to hand
    # back for the first is exactly what a writer flag would then seal onto disk.
    for label, seed in (("a missing allowlist", False), ("a torn non-JSON read", True)):
        with tempfile.TemporaryDirectory() as tmp13:
            saved_path = globals()["ALLOWLIST_PATH"]
            saved_argv = list(sys.argv)
            probe13 = Path(tmp13) / "ipc-parity-allowlist.json"
            seen13: object = "no-run"
            try:
                globals()["ALLOWLIST_PATH"] = probe13
                sys.argv = ["probe", "--write-scoped-orphans"]
                if seed:
                    probe13.write_text("{ torn", encoding="utf-8")
                out13, err13 = io.StringIO(), io.StringIO()
                with redirect_stdout(out13), redirect_stderr(err13):
                    seen13 = main()
                seen13 = (seen13, (out13.getvalue() + err13.getvalue()).strip(),
                          probe13.read_bytes() if probe13.exists() else b"<ABSENT>")
            finally:
                globals()["ALLOWLIST_PATH"] = saved_path
                sys.argv = saved_argv
        case(f"case 21  {label} is refused with a sentence, not a traceback or a reseed",
             isinstance(seen13, tuple) and seen13[0] == 2
             and "not an IPC parity verdict" in seen13[1], )
        case(f"case 21  {label} leaves no file where there was none, and the same bytes where "
             f"there were",
             isinstance(seen13, tuple)
             and seen13[2] == (b"{ torn" if seed else b"<ABSENT>"), )
    # The stated-empty allowlist is legal and must still grade: all four sections present,
    # every one of them an empty list, which is what a clean tree's file looks like.
    with tempfile.TemporaryDirectory() as tmp14:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe14 = Path(tmp14) / "ipc-parity-allowlist.json"
        empty_ok: object = "no-run"
        try:
            globals()["ALLOWLIST_PATH"] = probe14
            sys.argv = ["probe"]
            write_allowlist_payload({s: [] for s in KNOWN_SECTIONS})
            out14, err14 = io.StringIO(), io.StringIO()
            with redirect_stdout(out14), redirect_stderr(err14):
                empty_ok = main()
            empty_ok = (empty_ok, out14.getvalue() + err14.getvalue())
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 21  a stated-empty allowlist is NOT a refusal -- it is a claim, and it walks",
         isinstance(empty_ok, tuple) and empty_ok[0] in (0, 1)
         and "inert]:" in empty_ok[1] and not empty_ok[1].startswith("error:")
         and "\nerror: " not in empty_ok[1], )
    case("case 21  (and the committed allowlist still clears that same read-site floor)",
         isinstance(load_allowlist(), dict), )

    # 22: the WRITE side of that same boundary, end to end through main(). The claim is about the
    # VOICE, because an exit code alone has twice tonight been filed as a verdict: a writer whose
    # own write could not happen used to print `FAIL: N allowlist write problem(s)` and return 1,
    # and 1 is the number a reader (sync.rs:639, scripts/gates.json) treats as evidence about
    # somebody owning command names. What actually produced it was another agent mid-commit, or a
    # reader holding the file open for microseconds. Each arm runs against a probe path and checks
    # the bytes, so the shared allowlist is never the thing under test, and each asserts that the
    # sentence names the WRITE -- a 2 describing the wrong failure is the other way to be wrong.
    probe_clean = {"_comment": "probe file, never the real allowlist",
                   "dev_mock": [], "desktop": [], "tablet": [], "scoped_orphans": []}
    probe_drifted = {**probe_clean, "dev_mock": ["drifted_in_scoped"]}

    def writer_run(flag, drift=False, replace_error=None):
        """main() on a throwaway probe whose write is forced to fail: (code, text, wrote)."""
        with tempfile.TemporaryDirectory() as tmp15:
            saved_path = globals()["ALLOWLIST_PATH"]
            saved_argv = list(sys.argv)
            saved_read = globals()["read_allowlist_text"]
            saved_replace = os.replace
            probe15 = Path(tmp15) / "ipc-parity-allowlist.json"
            try:
                globals()["ALLOWLIST_PATH"] = probe15
                sys.argv = ["probe", flag]
                write_allowlist_payload(dict(probe_clean))
                before15 = probe15.read_bytes()
                if drift:
                    good = before15.decode("utf-8")
                    moved = json.dumps(probe_drifted, indent=2, ensure_ascii=False) + "\n"
                    reads = {"n": 0}
                    def drifting_text(_g=good, _m=moved, _r=reads):
                        # One writer run reads the file twice: main() validates the first
                        # answer, the writer re-reads for itself. A different second answer IS
                        # the drift case -- a commit landing inside the sweep -- with no thread,
                        # no sleep, and no chance of it clearing before the assertion runs.
                        _r["n"] += 1
                        return _g if _r["n"] == 1 else _m
                    globals()["read_allowlist_text"] = drifting_text
                if replace_error is not None:
                    os.replace = lambda src, dst, *a, **k: (_ for _ in ()).throw(
                        replace_error())
                out15, err15 = io.StringIO(), io.StringIO()
                with redirect_stdout(out15), redirect_stderr(err15):
                    code15 = main()
                return (code15, out15.getvalue() + err15.getvalue(),
                        probe15.read_bytes() != before15)
            finally:
                globals()["ALLOWLIST_PATH"] = saved_path
                sys.argv = saved_argv
                globals()["read_allowlist_text"] = saved_read
                os.replace = saved_replace

    drift_run = writer_run("--write-scoped-orphans", drift=True)
    case("case 22  a write refused by DRIFT costs 2, not the verdict code",
         drift_run[0] == 2 and not drift_run[2] and drift_run[1].startswith("error:")
         and "FAIL" not in drift_run[1] and "Traceback" not in drift_run[1]
         and "did not write" in drift_run[1]
         and "changed after this run" in drift_run[1], )
    case("case 22  and the drift sentence names the write, not a read that failed",
         "did not write" in drift_run[1].splitlines()[0]
         and "the WRITE is what failed" in drift_run[1]
         and "could not be opened" not in drift_run[1]
         and "not a usable allowlist" not in drift_run[1], )

    busy_run = writer_run("--write-dev-mock-gaps", replace_error=lambda: PermissionError(
        5, "simulated permanent contention"))
    case("case 22  a rename the target never accepts costs 2, not the verdict code",
         busy_run[0] == 2 and not busy_run[2] and busy_run[1].startswith("error:")
         and "FAIL" not in busy_run[1] and "Traceback" not in busy_run[1]
         and "would not accept the rename" in busy_run[1]
         and "did not write" in busy_run[1], )
    case("case 22  and a busy target is refused in the write voice, never the read voice",
         "held open by another process" in busy_run[1]
         and "could not be opened" not in busy_run[1], )

    space_run = writer_run("--write-allowlist", replace_error=lambda: OSError(
        28, "No space left on device"))
    case("case 22  any other failure of the write is an error too, and never a traceback",
         space_run[0] == 2 and not space_run[2] and space_run[1].startswith("error:")
         and "FAIL" not in space_run[1] and "Traceback" not in space_run[1]
         and "could not write" in space_run[1] and "OSError" in space_run[1], )

    # The half that must NOT move. An ENTRY inside a file this run did read is a finding about
    # a decision somebody made, so it keeps the FAIL voice and code 1, met by the writer or by
    # main(). Checked on the return value and on the bytes: the refusal to write must still hold
    # the bad entry in place rather than sealing a new decision over it.
    shape_code = None
    shape_bytes = b""
    with tempfile.TemporaryDirectory() as tmp16:
        saved_path = globals()["ALLOWLIST_PATH"]
        saved_argv = list(sys.argv)
        probe16 = Path(tmp16) / "ipc-parity-allowlist.json"
        try:
            globals()["ALLOWLIST_PATH"] = probe16
            sys.argv = ["probe"]
            write_allowlist_payload({**probe_clean, "desktop": [
                {"name": "typed_scoped", "reason": "an object in a bare-name section"}]})
            quiet_out, quiet_err = io.StringIO(), io.StringIO()
            with redirect_stdout(quiet_out), redirect_stderr(quiet_err):
                shape_code = report_shape_findings(
                    write_dev_mock_gaps(["shape_gap_scoped"]))
            shape_printed = quiet_out.getvalue() + quiet_err.getvalue()
            shape_bytes = probe16.read_bytes()
        finally:
            globals()["ALLOWLIST_PATH"] = saved_path
            sys.argv = saved_argv
    case("case 22  but a bad ENTRY in a file that arrived still costs the verdict code 1",
         shape_code == 1 and "FAIL:" in shape_printed and "error:" not in shape_printed
         and "FAIL: allowlist shape, 1 problem(s)" in shape_printed
         and b"typed_scoped" in shape_bytes and b"shape_gap_scoped" not in shape_bytes, )

    # 23: the adoption of scripts/allowlist-schema.py, pinned at both edges. The shared module
    # answers ONE question -- is this parsed document an allowlist -- and this gate keeps the two
    # decisions that are its own: which sections it requires (all four, never the two-section
    # reader set the same module exports) and how it says no (every reason in one sentence, since
    # a mistyped section and a missing section are two facts and the operator needs both). Each
    # arm runs main() against a probe, so what is asserted is the operators experience: the code,
    # the voice, and the bytes the run left alone.
    schema = allowlist_schema()

    def planted_run(flag, planted_text):
        """main() over a probe holding exactly these bytes: (code, printed, unchanged)."""
        with tempfile.TemporaryDirectory() as tmp17:
            saved_path = globals()["ALLOWLIST_PATH"]
            saved_argv = list(sys.argv)
            probe17 = Path(tmp17) / "ipc-parity-allowlist.json"
            try:
                globals()["ALLOWLIST_PATH"] = probe17
                sys.argv = ["probe"] + ([flag] if flag else [])
                probe17.write_text(planted_text, encoding="utf-8")
                before17 = probe17.read_bytes()
                out17, err17 = io.StringIO(), io.StringIO()
                with redirect_stdout(out17), redirect_stderr(err17):
                    code17 = main()
                return (code17, out17.getvalue() + err17.getvalue(),
                        probe17.read_bytes() == before17)
            finally:
                globals()["ALLOWLIST_PATH"] = saved_path
                sys.argv = saved_argv

    # The row the shared module records as the disagreement between the two gates: the reader
    # next door grades this file, this gate must refuse it. Asking for two sections here would
    # make it grade too, and then a --write-* flag would republish over two it never read.
    two_shell = json.dumps({"desktop": [], "tablet": []})
    two_shell_run = planted_run("--write-dev-mock-gaps", two_shell)
    case("case 23  a document stating only desktop and tablet is still REFUSED, at 2",
         two_shell_run[0] == 2 and two_shell_run[2] and two_shell_run[1].startswith("error:")
         and "FAIL" not in two_shell_run[1]
         and "dev_mock" in two_shell_run[1] and "scoped_orphans" in two_shell_run[1], )
    case("case 23  it is refused because this gate asks the shared schema for all four",
         len(schema.validate(json.loads(two_shell), KNOWN_SECTIONS, "a.json")) == 1
         and schema.validate(json.loads(two_shell), schema.REQUIRED_FOR_SHELL_READER,
                             "a.json") == []
         and list(KNOWN_SECTIONS) == list(schema.REQUIRED_FOR_WRITER)
         and list(KNOWN_SECTIONS) == list(schema.KNOWN_SECTIONS), )

    # Merged, not first-only: a mistyped section AND two absent sections arrive as two Refusals
    # from validate(), and both sentences must be in the one raise. primary() is the other
    # gates accessor; adopting it here would drop a fact the operator has always been told.
    mixed_bad = json.dumps({"desktop": "abc", "tablet": []})
    mixed_run = planted_run(None, mixed_bad)
    case("case 23  a mistyped section and a missing one are joined into one refusal",
         mixed_run[0] == 2 and mixed_run[2] and mixed_run[1].startswith("error:")
         and "FAIL" not in mixed_run[1] and mixed_run[1].count("error:") == 1
         and len(schema.validate(json.loads(mixed_bad), KNOWN_SECTIONS, "a.json")) == 2
         and "is a str, not a list" in mixed_run[1]
         and "dev_mock" in mixed_run[1] and "scoped_orphans" in mixed_run[1], )

    # And the refusal is the shared sentence rather than a private copy of the rule: with a
    # stub validator answering legal for everything, this same file stops being refused and the
    # run walks. Substitution is the only proof available that the ANSWER moved here and not
    # just the wording, and the real module is restored in the same finally.
    class _AnythingGoes:
        @staticmethod
        def validate(document, required, filename):
            return []

    stub_key = str(ALLOWLIST_SCHEMA_PATH)
    saved_schema = _SCHEMA_BY_PATH.get(stub_key)
    stubbed_outcome = "not-run"
    try:
        _SCHEMA_BY_PATH[stub_key] = _AnythingGoes()
        stubbed_outcome = planted_run("--write-dev-mock-gaps", two_shell)[0]
    finally:
        if saved_schema is None:
            _SCHEMA_BY_PATH.pop(stub_key, None)
        else:
            _SCHEMA_BY_PATH[stub_key] = saved_schema
    case("case 23  and the refusal comes from the shared module, not a private copy of it",
         stubbed_outcome in (0, 1)
         and planted_run("--write-dev-mock-gaps", two_shell)[0] == 2, )

    # The other edge, unchanged on purpose: an unknown top-level key is not a document question
    # and must not become one. It stays an entry-level finding at the verdict code, because a
    # section name typed with a hyphen is a decision somebody wrote down -- which is exactly
    # what code 1 means, and folding it into the schema would have moved a count.
    unknown_key = json.dumps({**{s: [] for s in KNOWN_SECTIONS},
                              "dev-mock": ["get_customer_scoped"]})
    unknown_run = planted_run(None, unknown_key)
    case("case 23  an unknown extra key is still a finding at the verdict code 1, not a 2",
         unknown_run[0] == 1 and "FAIL: allowlist shape" in unknown_run[1]
         and "error:" not in unknown_run[1] and unknown_run[2]
         and "dev-mock" in unknown_run[1] and "enforces nothing" in unknown_run[1], )
    case("case 23  the shared schema takes no position on it, so both readings agree",
         schema.validate(json.loads(unknown_key), KNOWN_SECTIONS, "a.json") == [], )

    # And the loader itself: a shared validator that is absent, unreadable or broken is a
    # refusal, not a crash. This is the one NEW failure mode the adoption introduces -- the gate
    # now depends on a sibling file -- and an eager import would have raised at module load,
    # out of main(), with no handler, which is an uncaught exception and therefore exit 1: the
    # verdict code, spent on a missing file. So the arm is pinned on its code, its sentence, and
    # its silence about the tree.
    saved_schema_path = globals()["ALLOWLIST_SCHEMA_PATH"]
    absent_outcome = "not-run"
    try:
        globals()["ALLOWLIST_SCHEMA_PATH"] = (
            saved_schema_path.parent / "no-such-allowlist-schema.py")
        absent_outcome = planted_run("--write-scoped-orphans", json.dumps(probe_clean))
    finally:
        globals()["ALLOWLIST_SCHEMA_PATH"] = saved_schema_path
    case("case 23  a missing shared validator is refused at 2, by name, with no traceback",
         absent_outcome[0] == 2 and absent_outcome[2]
         and absent_outcome[1].startswith("error:")
         and "no-such-allowlist-schema.py" in absent_outcome[1]
         and "FAIL" not in absent_outcome[1] and "Traceback" not in absent_outcome[1], )
    # Either verdict proves recovery: 0 and 1 both mean the document was ACCEPTED and the tree
    # was walked. Pinning one exact code would hang a test about my loader off the parity state
    # of the tree, the coupling case 13 had to take out.
    case("case 23  and the loader recovers: the same document is accepted once more",
         planted_run(None, json.dumps(probe_clean))[0] in (0, 1)
         and "no-such-allowlist-schema" not in planted_run(None, json.dumps(probe_clean))[1], )

    # The registrar parse's blind spot has to be measurable in both directions. A key the
    # anchored regex misses must be reported -- and the SAME key sitting at the start of its
    # line must NOT be, or the scan is just "everything not on a fresh line" and proves
    # nothing. Both fixtures also pin the anchored parse's own behaviour, so if someone
    # widens MOCK_LITERAL_KEY_RE the second case is the one that says so.
    glued = [("x/handlers/a.ts",
              "export const h = {\n"
              "  'get_key_rotation_info': () => ({}),\n"
              "  }),  'set_brand_primary_colour': () => null,\n"
              "};\n")]
    unwrapped = [("x/handlers/a.ts",
                  "export const h = {\n"
                  "  'get_key_rotation_info': () => ({}),\n"
                  "  'set_brand_primary_colour': () => null,\n"
                  "};\n")]
    commented = [("x/handlers/a.ts",
                  "export const h = {\n"
                  "  // callers used to pass { 'set_brand_primary_colour': () => null }\n"
                  "  'get_key_rotation_info': () => ({}),\n"
                  "};\n")]
    case("glue   the anchored parse really does miss a mid-line key",
         'set_brand_primary_colour' not in set().union(*parse_dev_mock(glued)[0].values()))
    case("glue   the blind-spot scan reports exactly that key, and only it",
         find_midline_handler_keys(glued) == {
             'x/handlers/a.ts': {'set_brand_primary_colour'}})
    case("glue   the same key unwrapped is visible to the parse and not flagged",
         'set_brand_primary_colour' in set().union(*parse_dev_mock(unwrapped)[0].values())
         and not find_midline_handler_keys(unwrapped))
    case("glue   a key-shaped thing inside a comment is not a key",
         not find_midline_handler_keys(commented))

    # The reverse census, same both-directions discipline: a key is reachable by ANY of the
    # three routes, so the test must show all three working AND show a key that has none of
    # them. The seed route is the one that matters -- drop the twin's consumer and the
    # unscoped handler that only existed to feed it becomes dead, which is exactly the term
    # that took a naive 164-name census down to 7.
    reach_src = {"x/handlers/a.ts": {
        'alive_registered', 'alive_ui', 'alive_seed', 'dead_one', 'dead_scoped'}}
    case("reach  registration, a UI name, or a consumed _scoped twin each keep a handler alive",
         find_unreachable_mock_keys(reach_src, {'alive_registered'},
                                    {'alive_ui', 'alive_seed_scoped'})
         == {'x/handlers/a.ts': {'dead_one', 'dead_scoped'}})
    case("reach  an unscoped seed dies with the twin nobody consumes",
         find_unreachable_mock_keys(reach_src, {'alive_registered'}, {'alive_ui'})
         == {'x/handlers/a.ts': {'dead_one', 'dead_scoped', 'alive_seed'}})

    # The F-006 leg's own eyes, both directions. Only the qualified attribute matched before
    # 2026-09-16, and the tablet spells its commands with the imported short form -- so a fifth
    # of its command declarations were visible and the leg printed a confident 0 unregistered
    # fns for a shell that had plenty. The two figures this comment used to carry in present
    # tense (20 of 326 declarations visible, 59 unregistered fns) were a tree reading too, and
    # the leg below prints the live pair every run: 4 unregistered fns for the tablet at
    # 3a9637ece, 7 at 3162b97b6 an hour earlier -- re-derive with
    #     python scripts/verify-ipc-parity.py | grep "info[tablet]:"
    # The shape claim is the fixture's job and is unchanged: a pattern fix with no fixture
    # behind it can be tightened back into blindness by anyone, which is exactly how this
    # happened the first time.
    case("f006   the qualified attribute is matched",
         COMMAND_FN_RE.findall("#[tauri::command]\npub async fn list_staff(") == ['list_staff'])
    case("f006   the imported short attribute is matched as well",
         COMMAND_FN_RE.findall("#[command]\npub fn list_roles(") == ['list_roles'])
    case("f006   a pub fn with no attribute is not a command",
         COMMAND_FN_RE.findall("pub async fn helper(x: u8) -> u8 { x }") == [])
    case("f006   a pub fn behind an unrelated attribute is not a command either",
         COMMAND_FN_RE.findall("#[serde(rename_all = 'camelCase')]\npub async fn not_a_command()") == [])

    # And the walk's own cases: an attribute separated from its signature by a doc comment or
    # by a second attribute is still a command in Rust, and the single regex cannot see either.
    # These four together are what make 43 and 122 reproducible rather than a claim.
    case("f006   a doc comment between attribute and signature does not hide the command",
         'documented' in command_fns_in("#[tauri::command]\n/// Lists things.\npub async fn documented() -> X {"))
    case("f006   a second attribute between them does not hide it either",
         'double' in command_fns_in("#[command]\n#[allow(clippy::unused_async)]\npub fn double() -> X {"))
    case("f006   attribute and signature on one line still count",
         'oneline' in command_fns_in("#[command] pub async fn oneline() -> X {"))
    case("f006   an attribute over a non-function is not a command",
         not command_fns_in("#[command]\nconst LIMIT: u32 = 4;\n"))

    # What counts as a call of an unregistered fn. The middle line is the one that fooled a
    # probe written for this leg on 2026-09-16: `store.create_bundle(&x)` is `Store::
    # create_bundle`, a different function sharing a spelling, and counting it turned 101
    # unreachable fns into 78 "live helpers" -- a conclusion that would have frozen the
    # thinning. A module path (super::) IS a call, a type path (Store::) is not, prose is not,
    # and the signature is the definition.
    call_sites = fn_call_sites(
        "create_bundle",
        [("m.rs", "\n".join([
            "let a = create_bundle(&x);",
            "store.create_bundle(&x);",
            "Store::create_bundle(&x);",
            "let b = super::create_bundle(&x);",
            "/// see create_bundle(&x) above",
            "pub async fn create_bundle(",
            "    .create_bundle;",
            "    kasirmu_bridge::bundles::create_bundle(&ctx);",
            "    crate::commands::bundles::create_bundle(&x);",
            "fn create_bundle() {",
            "async fn create_bundle() -> Result<(), E> {",
            "/*",
            "next: consider soft-delete on create_bundle (COR-23)",
            "*/",
            "let after_block = create_bundle(&y);",
        ]))])
    case("call   a free call is counted", "m.rs:1" in call_sites)
    case("call   a same-named method is NOT (this is the bug the census had)",
         "m.rs:2" not in call_sites)
    case("call   a type path is not a call but a module path is",
         "m.rs:3" not in call_sites and "m.rs:4" in call_sites)
    case("call   prose is not a call", "m.rs:5" not in call_sites)
    case("call   the signature itself is not a call", "m.rs:6" not in call_sites)
    case("call   the whole answer is exactly the four real calls",
         call_sites == ["m.rs:1", "m.rs:4", "m.rs:9", "m.rs:15"])
    # The seventh exclusion, both halves in one case: a name inside a `/* */` audit stamp is prose,
    # AND the block must CLOSE -- an exclusion that swallowed everything after the first `/*`
    # would read cleaner than the truth, so the code below the block is the load-bearing half.
    case("call   prose inside a block comment is not a call, and code after it still is",
         "m.rs:13" not in call_sites and "m.rs:15" in call_sites)
    # The delegation blind spot, found 2026-09-16 by the red this leg gave the coursing lane:
    # `set_line_course_scoped` was reported as an ungated redundant twin whose caller should be
    # allowlisted as "host-only", while `crates/kasirmu-bridge/src/pos.rs:505` gates it on
    # SALES_PROCESS one line below the shell's `kasirmu_bridge::pos::set_line_course_scoped(&ctx, ...)`.
    thin = "pub async fn x_scoped(t: String) -> R {\n    kasirmu_bridge::pos::x_scoped(&ctx, &t, a).await\n}"
    ungated = "pub async fn y_scoped(t: String) -> R {\n    load(&t)\n}"
    case("gate   a shell body that delegates is not judged by its own text alone",
         gate_in_body(thin) is None and DELEGATION_RE.findall(thin) == ["x_scoped"])
    case("gate   ctx.require_session_permission counts as a gate the old literal missed",
         gate_in_body("async fn f() {\n    ctx.require_session_permission(&s, permissions::SALES_PROCESS).await?;\n}")
         == "SALES_PROCESS")
    case("gate   a body with neither gate nor delegation is honestly ungated",
         gate_in_body(ungated) is None and not DELEGATION_RE.findall(ungated))
    case("gate   the real command that was misreported is now read as gated",
         orphan_permission("set_line_course_scoped") == "SALES_PROCESS")
    # The sixth exclusion, earned on 2026-09-16: `offline_tests.rs` opens a case with
    # `fn pending_offline_count()` and its body calls `store.pending_offline_count()`. The
    # first is a test title, the second a Store method, so the command had NO caller and the
    # refusal gate said it had one -- three candidates sat behind that verdict for rounds.
    case("call   a private or async test fn named after the command is not a call",
         "m.rs:10" not in call_sites and "m.rs:11" not in call_sites)

    # The shim shape, which is what this programme keeps producing and therefore what the leg
    # will keep meeting: a command whose body calls the bridge's same-named function. That is
    # not the command being used, and grading it as such would hide every legacy fn behind its
    # own replacement. A crate:: path IS this shell's function, so it stays counted.
    case("call   a shim body calling the bridge twin is not a call of the command",
         "m.rs:8" not in call_sites and "m.rs:9" in call_sites)

    # The no-session fallback leg: a shape, not a tree count. All three synthetic cases are
    # load-bearing -- without the second and third, the first would pass for a detector that
    # reports every ternary, which is the same vacuous-green failure the leg exists to catch.
    fb_api = ("ui/src/api/hardware.ts",
              "export const listScanners = (): Promise<number> =>\n"
              "  loggedInvoke<number>('list_scanners');\n"
              "export const listScannersScoped = (t: string): Promise<number> =>\n"
              "  loggedInvoke<number>('list_scanners_scoped', { t });\n")
    fb_hook = ("ui/src/features/sales/useBarcodeScanner.ts",
               "const fetch = sessionToken ? () => listScannersScoped(sessionToken) : listScanners;\n")
    fb_noise = ("ui/src/features/x/Noise.ts", "const n = sessionToken ? 1 : 0;\n")
    case("fallback an unregistered else-arm wrapper is reported",
         list(no_token_fallbacks([fb_api, fb_hook], {"list_scanners_scoped"})) == ["list_scanners"])
    case("fallback the same shape is silent once the command is registered",
         not no_token_fallbacks([fb_api, fb_hook], {"list_scanners", "list_scanners_scoped"}))
    case("fallback a ternary whose else-arm is not a wrapper reports nothing",
         no_token_fallbacks([fb_api, fb_noise], {"list_scanners_scoped"}) == {})
    case("fallback and the same noise beside a real gap neither invents nor inflates one",
         len(no_token_fallbacks([fb_api, fb_hook, fb_noise], {"list_scanners_scoped"})) == 1
         and len(no_token_fallbacks([fb_api, fb_hook, fb_noise],
                                    {"list_scanners_scoped"})["list_scanners"]) == 1)
    # The parameterised arm, earned 2026-09-16. The three cases above are all ZERO-ARGUMENT arrows,
    # which is how the leg could be green while `const start = sessionToken
    # ? (id: string) => startScannerScoped(sessionToken, id) : startScanner` went unseen: the
    # fixture and the regex had been written against the same single form, so they agreed with each
    # other and not with the tree. Two names per shell were missing from the count a T21 decision
    # was going to be made from.
    fb_api2 = ("ui/src/api/hardware.ts",
               "export const startScanner = (id: string): Promise<boolean> =>\n"
               "  loggedInvoke<boolean>('start_scanner', { id });\n"
               "export const startScannerScoped = (t: string, id: string): Promise<boolean> =>\n"
               "  loggedInvoke<boolean>('start_scanner_scoped', { t, id });\n")
    fb_param = ("ui/src/features/sales/useBarcodeScanner.ts",
                "const start = sessionToken ? (id: string) => startScannerScoped(sessionToken, id)"
                " : startScanner;\n")
    case("fallback an arrow arm that takes parameters is the same shape and must be caught",
         list(no_token_fallbacks([fb_api2, fb_param], {"start_scanner_scoped"})) == ["start_scanner"])
    case("fallback a parameterised arm whose else-branch is not a wrapper stays silent",
         no_token_fallbacks([fb_api2, fb_noise], {"start_scanner_scoped"}) == {})
    case("fallback both arrow forms are reported together without doubling a name",
         len(no_token_fallbacks([fb_api, fb_hook, fb_api2, fb_param],
                                {"list_scanners_scoped", "start_scanner_scoped"})) == 2)
    # And the real tree, so a regex that matched only its own fixture cannot pass: if a future
    # pass registers these doors and this case goes red, delete the case after reading the
    # print, not before -- it is the only thing here that knows the shape was ever broken.
    real_fb = no_token_fallbacks(ui_runtime_files(), set(extract_handlers(REPO_ROOT / SHELLS["tablet"])))
    # LINEAGE OF THE NAME, which is what licenses this case to carry a different one than it was
    # born with: it pinned "list_scanners" until 3162b97b6 ("refactor(ui): delete the scanner
    # hooks' no-session arms") retired that name from the else-arm -- it deleted
    # `export const listScanners = (): Promise<ScannerInfo[]> => loggedInvoke('list_scanners')`
    # from ui/src/api/hardware.ts along with the ternary that reached it (fallback 10->7 desktop,
    # 5->2 tablet). The registered set never moved -- "list_scanners" is absent from BOTH shells
    # today, exactly as it was when this case was written -- so the gate did not break and the
    # tree did not regress: the defect this arm was written to witness was REPAIRED for the
    # scanner trio, and a guard that keeps asserting a repaired defect is a lie that prints
    # False. It is re-anchored here to the one no-session fallback the real tree still holds,
    # "list_products" -- unregistered in both shells, reached at
    # ui/src/features/products/useProducts.ts:132.
    # THE NAME IS NOT DROPPED: `len(real_fb) >= 1` alone passes for ANY fallback, so it cannot
    # say the specific arm this leg was written for is still reachable -- which is why this case,
    # and not the three synthetic ones above, is the thing that knows the shape was ever broken.
    # One named witness stays; its population now rides in the case name, so a future red prints
    # its own denominator instead of a bare False. Move the name only under a proven red, and
    # read the print before deleting anything.
    case("fallback the real tablet tree exposes the shape the leg was written for "
         f"[n={len(real_fb)} names={sorted(real_fb)}]",
         len(real_fb) >= 1 and "list_products" in real_fb)

    # The reachability buckets, same discipline: without the second and third cases the first
    # would pass for a classifier that counts a wrapper's own definition as one of its users,
    # which is exactly the mistake that called eleven dead wrappers a parity gap.
    wr_api = ("ui/src/api/products.ts",
              "export const listProducts = (sessionToken: string): Promise<number> =>\n"
              "  loggedInvoke<number>('list_products', { sessionToken });\n")
    wr_hook = ("ui/src/features/products/useProducts.ts",
               "import { listProducts } from '@/api/products';\n"
               "export const use = () => listProducts('tok');\n")
    wr_client = ("ui/src/api/client/products.ts",
                 "class C {\n  async listProducts() { return 1; }\n}\n")
    case("uinamed a screen importing the wrapper makes the command reachable",
         wrapper_reach([wr_api, wr_hook], "list_products")["runtime"]
         == ["ui/src/features/products/useProducts.ts#listProducts"])
    case("uinamed the file that defines a wrapper is not its own user",
         all(not v for v in wrapper_reach([wr_api], "list_products").values()))
    case("uinamed the programmatic client is reachable without being a screen",
         bool(wrapper_reach([wr_api, wr_client], "list_products")["client"])
         and not wrapper_reach([wr_api, wr_client], "list_products")["runtime"])
    # Real tree, so a regex that matched only its fixture cannot pass. If a future pass imports
    # these wrappers into screens and this goes red, retire it only after reading the print:
    # it is the thing that knows the eleven were ever unreferenced.
    real_ui = ui_runtime_files()
    real_unref = [n for n in ("create_product", "delete_product", "print_receipt", "update_product")
                  if not (lambda r: r["runtime"] or r["client"])(wrapper_reach(real_ui, n))]
    case("uinamed the real tree still holds at least three of the four named wrappers nobody uses",
         len(real_unref) >= 3)

    # The mirror leg, four ways to be wrong. `unused_door` is the case that matters most: its own
    # definition line contains the name, so an instrument that counted definitions as calls would
    # report every single registered command as "load-bearing from Rust" and the leg would print
    # zero forever -- a green that measures nothing.
    mirror_src = [
        ("a.rs", "async fn helper() -> u8 {\n    compute_total(1).await\n}"),
        ("b.rs", "#[command]\npub async fn unused_door() -> Result<u8, E> {\n    Ok(0)\n}"),
        ("c.rs", "fn warm(store: &Store) {\n    store.warm_cache();\n}"),
    ]
    mirror = unrequested_registrations(
        mirror_src,
        ["compute_total", "unused_door", "warm_cache", "live_door"],
        {"live_door"},
    )
    case("unrequested a command the UI names is not unrequested at all",
         "live_door" not in mirror["rust_called"] + mirror["dead_registration"])
    case("unrequested a command this shell's Rust calls is not called dead",
         mirror["rust_called"] == ["compute_total"])
    case("unrequested a command's own definition is not a call of it",
         mirror["dead_registration"] == ["unused_door", "warm_cache"])
    case("unrequested a same-named method on a value is not a local caller",
         "warm_cache" not in mirror["rust_called"])
    # The arg-shape leg, with the two shapes that matter: a nested `args` object (the real defect
    # this leg found on its first run, in a call whose own contract test asserted the nested shape
    # and passed) and a spread, which must EXCLUDE the command rather than report it.
    case("argshape the camelCase mapping is what Tauri asks for",
         camel("session_token") == "sessionToken" and camel("id") == "id"
         and camel("product_id") == "productId")
    as_files = [("ui/src/api/x.ts",
                 "export const del = (t: string, id: string) =>\n"
                 "  loggedInvoke('delete_thing_scoped', { sessionToken: t, id });\n"
                 "export const bad = (t: string, id: string) =>\n"
                 "  loggedInvoke('put_thing_scoped', { sessionToken: t, args: { id } });\n"
                 "export const wide = (t: string, a: Args) =>\n"
                 "  loggedInvoke('wide_thing_scoped', { sessionToken: t, ...a });\n")]
    as_prod = [("m.rs",
                "pub async fn delete_thing_scoped(session_token: String, id: String, "
                "state: State<'_, AppState>) -> R {}\n"
                "pub async fn put_thing_scoped(session_token: String, id: String, "
                "state: State<'_, AppState>) -> R {}\n"
                "pub async fn wide_thing_scoped(session_token: String, note: String, "
                "state: State<'_, AppState>) -> R {}\n"
                "pub async fn opt_thing_scoped(session_token: String, maybe: Option<String>, "
                "state: State<'_, AppState>) -> R {}\n")]
    as_res = argshape_findings(
        as_prod,
        ["delete_thing_scoped", "put_thing_scoped", "wide_thing_scoped", "opt_thing_scoped"],
        ui_payload_keys(as_files))
    case("argshape a top-level argument the caller supplies is not reported",
         not any(x.startswith("delete_thing_scoped") for x in as_res["missing"]))
    case("argshape an argument hidden inside a nested args object IS reported",
         any(x.startswith("put_thing_scoped<-id") for x in as_res["missing"]))
    case("argshape the report names the caller file and line, not only the command",
         any(x.startswith("put_thing_scoped<-id") and "ui/src/api/x.ts:" in x
             for x in as_res["missing"]))
    case("argshape a spread caller is excluded, never reported and never called clean",
         not any(x.startswith("wide_thing_scoped") for x in as_res["missing"])
         and any(x.startswith("wide_thing_scoped") for x in as_res["ungraded"]))
    case("argshape an Option parameter is not required and its absence is not a finding",
         not any(x.startswith("opt_thing_scoped") for x in as_res["missing"]))
    # The regression that leg found in itself: a comment written inside a parameter list contains a
    # colon, and the splitter read "// note: prose" as an argument the caller must supply.
    case("argshape a comment inside a signature is not a parameter",
         rust_required_params([("m.rs", "pub async fn c(\n    session_token: String,\n"
                                        "    // because the name IS the payload key\n"
                                        "    table: Table,\n"
                                        "    state: State<'_, AppState>,\n) -> R {}\n")],
                              "c") == ["session_token", "table"])

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
             "\"dev_mock\" in the allowlist, preserving other sections and any \"reason\" "
             "an operator hand-wrote, and exit (additive only -- it never removes an entry, "
             "so shrinking the list is a manual edit)",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    # The shared input is verified where it is read, before this run walks a file or touches
    # the writer. `load_allowlist` now refuses an absent path, a file that would not open, a
    # parse that is not JSON, a top-level value that is not an object, and an object that does
    # not state every enforced section as a list -- all five as one AllowlistUnusable, handled
    # once here, exit 2. It used to answer a missing file with a fabricated two-section
    # payload and everything else with raw `json.loads` output, so a wrong shape reaching
    # `payload.get(section)` meant a verdict printed over an allowlist nobody had read, and the
    # same non-read could then be written back as the new allowlist. A busy file is the same
    # refusal (AllowlistBusyError is now the subclass), and 2 is what main() already returns
    # for a missing shell lib -- 1 stays the verdict code, so a lock collision can never
    # impersonate `FAIL: N IPC parity violation(s)`.
    #
    # The snapshot this run both validates and enforces. Writers are handed this object and
    # refuse to write if the file on disk has moved away from it, so the thing that reaches
    # disk is never something nobody looked at.
    try:
        validated = load_allowlist()
    except AllowlistUnusable as unusable:
        return refuse_unusable_allowlist(unusable)
    # Entry-level shape: the payload IS a usable allowlist now, so what is left here is a
    # wrong ENTRY inside a section this file can read -- a real finding about somebody's
    # exemption, and it keeps the FAIL/1 verdict convention of the findings below.
    shape_problems = allowlist_shape_problems(validated, ALLOWLIST_PATH)
    if shape_problems:
        print(
            f"\nFAIL: allowlist shape, {len(shape_problems)} problem(s):", file=sys.stderr
        )
        for problem in shape_problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

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
        return write_or_refuse(lambda: write_allowlist(missing, validated))

    allowlist = validated
    failures: list[str] = []

    # Reverse direction: registered scoped commands with no caller.
    orphan_allow = section_names(allowlist, "scoped_orphans")
    orphans: dict[str, list[str]] = {}
    for shell in SHELLS:
        orphans[shell] = orphan_scoped(handlers[shell], ui_commands)
    all_orphans = sorted(set().union(*[set(v) for v in orphans.values()]))
    if args.write_scoped_orphans:
        return write_or_refuse(
            lambda: write_scoped_orphans(set(all_orphans), validated))

    # Third direction: can the plain-browser dev-mock answer what the UI invokes?
    mock_registered, mock_aliasable, mock_per_file, mock_alias_file = (
        extract_dev_mock_answerable())
    mock_answerable = mock_registered | mock_aliasable
    mock_gaps = sorted(c for c in ui_commands if c not in mock_answerable)
    if args.write_dev_mock_gaps:
        return write_or_refuse(lambda: write_dev_mock_gaps(mock_gaps, validated))

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
            # One set difference, two causes: name the one the inventories support.
            failures.append(stale_orphan_message(
                command,
                [s for s in SHELLS if command in handlers[s]],
                ALLOWLIST_PATH.name,
            ))

    for shell in SHELLS:
        # Belt and braces: allowlist_shape_problems refuses an object in a shell section
        # before this line can be reached, and section_names would read it anyway.
        allowed = section_names(allowlist, shell)
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

    mock_entries = allowlist_section(allowlist, "dev_mock")
    mock_allow = {name for name, _ in mock_entries}
    # A second read of the mock tree in this run. Ten small files, and the note below has to
    # describe the same bytes the answerable set was parsed from, which a shared variable
    # threaded across this function would buy at the cost of a longer reach.
    midline_keys = find_midline_handler_keys(read_dev_mock_sources())
    midline_paths = {
        name: sorted(path for path, names in midline_keys.items() if name in names)
        for name in {n for names in midline_keys.values() for n in names}
    }
    for command in sorted(set(mock_gaps) - mock_allow):
        refs = ", ".join(sorted(set(ui_commands[command]))[:3])
        # The alias rule can only copy a name it can see, so a gap on `x_scoped` has two
        # possible causes: no unscoped handler anywhere, or one this parse cannot read. Say
        # which, because the sentence below asserts the first and the first is not always the
        # reason the set is empty.
        suspects = [command]
        if command.endswith("_scoped"):
            suspects.append(command[: -len("_scoped")])
        hidden = [s for s in suspects if s in midline_paths]
        note = ""
        if hidden:
            where = "; ".join(
                f"'{s}' sits mid-line in {', '.join(midline_paths[s])}" for s in hidden
            )
            note = (
                f" NOTE: {where} -- the key exists, and it is THIS PARSE that is line-anchored. "
                f"Unwrap it onto its own line and re-run before accepting the gap as a missing "
                f"handler."
            )
        failures.append(
            f"dev-mock: UI invokes '{command}' but no handler anywhere under "
            f"{DEV_MOCK_DIR_REL} registers it (the router and every extracted module "
            f"under it were read, and no unscoped twin exists for the alias rule to "
            f"reach) -- invoke() returns null and the caller silently renders its "
            f"failure path (e.g. {refs}). An allowlist entry may carry why the gap was "
            f"accepted -- rewrite it as {{\"name\": \"{command}\", \"reason\": \"...\"}} "
            f"-- and the count of entries that do not is printed on every run."
            f"{note}"
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
        allowed_names = section_names(allowlist, shell)
        # Surfaced, never enforced. An allowlisted name that is neither a gap this run
        # reproduces nor a command the shell registers has nothing on either side of it
        # asking for the exemption -- the tablet ghost that is not a UI string, not
        # registered in either shell, and still answers from a dev-mock handler is the
        # shape. It used to be invisible in both directions: the staleness check only
        # catches an entry that DID become registered, and --write-allowlist deleted the
        # rest without a word. The writer is additive now, so this line is the only thing
        # that shows them, which is why it is information-only and cannot fail the gate.
        # The two "unregistered" figures on the line below are NOT the same measurement in
        # different clothes: missing[shell] is UI command NAMES the interface invokes and
        # this shell does not register (direction: ui -> shell), unregistered is Rust
        # #[tauri::command] FUNCTIONS defined under this shell's commands/ and absent from
        # its generate_handler (direction: shell -> registration). Different populations,
        # different units, and the tree proves them apart -- in the figures the print below
        # measures, which is the only place either number belongs. This comment carried one as
        # a present-tense claim for a while ("as of the attribute fixes the tablet reports 154
        # UI names it does not register and 118 command fns registered nowhere, 441
        # declarations visible to the leg, 43 for the desktop"). The same two lines read
        # differently in every tree since -- 143 and 7 for the tablet, 15 and 3 for the desktop
        # at 32c402d28; 140 and 7, 12 and 3 an hour later at 3162b97b6, because the UI surface
        # those counts run against is being edited under this file by other lanes as of now. The
        # sentence warning that these numbers move had its own numbers move under it while it
        # was being written, and that is the whole argument for leaving them to the print:
        #     python scripts/verify-ipc-parity.py | grep -E '^info\\[(desktop|tablet)\\]:'
        # What does not depend on any of them is the claim this comment exists for: before the
        # attribute fix the second figure read 0 for a reason that had nothing to do with the
        # tree -- the pattern saw 20 of the shell's command declarations. A zero from an
        # instrument that cannot see its subject is the exact thing this leg exists to avoid
        # being, which is also why the classification on the next line is printed rather than
        # left to whoever reads the number.
        # before the attribute fix the second figure read 0 for a reason that had nothing to do
        # with the tree -- the pattern saw 20 of the shell's command declarations. A zero from an
        # instrument that cannot see its subject is the exact thing this leg exists to avoid
        # being, which is also why the classification on the next line is printed rather than
        # left to whoever reads the number.
        unreachable = sorted(allowed_names - missing[shell] - set(handlers[shell]))
        print(
            f"info[{shell}]: {len(ui_commands)} UI command strings, "
            f"{len(handlers[shell])} registered, "
            f"{len(missing[shell])} unregistered UI command names "
            f"({len(unregistered)} unregistered tauri command fns - F-006 tracker) "
            f"({len(allowed_names)} allowlisted)"
        )
        # Being unregistered is what the source CLAIMS and the registry REFUSES. Whether the fn
        # does anything is a different question, and the two answers route to opposite actions:
        # keep-and-strip-the-attribute versus delete. Printed so a future pass cannot confuse
        # them, which a probe for this leg did on 2026-09-16 when it counted `store.x(` as a
        # call to `x()` and reported 78 unreachable fns as live helpers (see fn_call_sites).
        #
        # The explicit path below is not redundancy: the first version passed the loop's outer
        # `lib_path`, which is left over from an earlier section and still pointed at the other
        # shell, so the desktop's line was graded against the tablet's sources and printed 3
        # helpers where the tree has 32. The number looked plausible and was cross-checked by
        # accident, which is the same lesson as the vacuous zero above it.
        cls = classify_unregistered(REPO_ROOT / SHELLS[shell], unregistered, set(missing[shell]))
        ui_named = [n for n in unregistered if n in missing[shell]]
        unreachable_fns = [n for n in unregistered if n not in missing[shell]]
        helper = [n for n in unreachable_fns if cls[n][0]]
        uncalled = [n for n in unreachable_fns if not cls[n][0]]
        test_only = [n for n in uncalled if cls[n][1]]
        # Name the deletion candidates, and name them as `module::fn`. This leg printed a count of
        # candidates for weeks while the tool that acts on them requires `--module` and `--only`, so
        # the number was not actionable without re-deriving the identity somewhere else -- the same
        # defect fixed three times over (the ceiling leg in T32/T33, the arg-shape leg in T39), and
        # here it cost this lane a full detour through the retirement tool's per-module report.
        prod_rs, _tests = shell_rust_sources(REPO_ROOT / SHELLS[shell])

        def _where(n: str, _src: list[tuple[str, str]] = prod_rs) -> str:
            for label, text in _src:
                if re.search(r"\bfn " + re.escape(n) + r"\s*\(", text):
                    return f"{Path(label).stem}::{n}"
            return f"?::{n}"

        named = ", ".join(_where(n) for n in uncalled[:6])
        print(
            f"info[{shell}-f006]: {len(unregistered)} unregistered fns = {len(ui_named)} the UI "
            f"invokes (graded above) + {len(helper)} unreachable but called by this shell's own "
            f"code (helpers with a stale attribute, NOT dead) + {len(uncalled)} unreachable and "
            f"uncalled ({len(test_only)} of those still tested), i.e. deletion candidates"
            + (f": {named}" + (f" (+{len(uncalled) - 6} more)" if len(uncalled) > 6 else "")
               if uncalled else ": none")
        )
        # "The UI invokes it" is not one claim. A name can be reached by a screen, by the
        # programmatic client facade, or by nothing but a wrapper export and the contract test
        # that pins that wrapper's string. Only the first two are a gap this shell owes a door
        # for; the third is dead surface on both sides of the boundary, and calling it a parity
        # gap is how 11 unregistered tablet commands kept the count at 17.
        all_ui = ui_runtime_files()
        reached = {n for n in ui_named
                   if (r := wrapper_reach(all_ui, n))["runtime"] or r["client"]}
        unreferenced = sorted(set(ui_named) - reached)
        print(
            f"info[{shell}-uinamed]: {len(ui_named)} unregistered fns are named by UI code = "
            f"{len(ui_named) - len(unreferenced)} reachable from a screen/hook or the "
            f"programmatic client + {len(unreferenced)} named only by an api wrapper nothing "
            f"imports (dead surface both sides, deletable; not a parity gap)"
            + (": " + ", ".join(unreferenced) if unreferenced else "")
        )
        # The mirror direction. F-006 measures doors the UI asks for that no shell opened; this
        # measures doors a shell opened that no shipped UI asks for. Informational for the same
        # reason every other leg here is: a registered command with no client is not a bug, it is
        # a question with several legitimate answers (another shell's UI uses it, a Rust-side
        # caller wires it, an external facade exposes it), and only the owner can tell them apart.
        prod_rs, _tests = shell_rust_sources(REPO_ROOT / SHELLS[shell])
        unreq = unrequested_registrations(prod_rs, handlers[shell], set(ui_commands))
        dead = unreq["dead_registration"]
        tail = ", ".join(dead[:8]) + (f" (+{len(dead) - 8} more)" if len(dead) > 8 else "")
        print(
            f"info[{shell}-unrequested]: {len(dead) + len(unreq['rust_called'])} "
            f"of {len(handlers[shell])} registered commands are named by no shipped UI file = "
            f"{len(unreq['rust_called'])} called by this shell's own Rust (load-bearing, not dead) "
            f"+ {len(dead)} named by neither side (the only population a retirement can start "
            f"from; read the other shell's UI before believing one is dead everywhere)"
            + (": " + tail if dead else "")
        )
        # T9's mechanical form, five domains and three real defects after the fact. Informational
        # like every leg here, and for the same reason: making it fail the build is an owner call
        # (T9 says so explicitly), and the exclusions are a policy that wants review before it can
        # block. On the day it was written it found two live breakages that no test could see,
        # because nothing in this repository crosses the IPC boundary in a test.
        shape = argshape_findings(prod_rs, handlers[shell], ui_payload_keys(ui_runtime_files()))
        print(
            f"info[{shell}-argshape]: {len(shape['missing'])} registered command(s) whose readable "
            f"callers never supply a required argument "
            + (": " + ", ".join(shape["missing"][:8])
               + (f" (+{len(shape['missing']) - 8} more)" if len(shape["missing"]) > 8 else "")
               if shape["missing"] else "-- none")
            + f"; {len(shape['ungraded'])} not gradeable (a caller the parse cannot read, or a "
              f"signature it cannot open -- excluded, never counted as clean)"
        )
        # Informational, like every other F-006-adjacent leg: a fallback that cannot resolve is
        # an owner question (register the door, or change the branch), not a red gate this run
        # is entitled to call. But it must be named, because both of the instruments that could
        # have caught it -- Vitest and the dev-mock -- answer as though the door exists.
        fb = no_token_fallbacks(all_ui, set(handlers[shell]))
        print(
            f"info[{shell}-fallback]: {len(fb)} unregistered name(s) sit behind a no-session "
            f"branch that production UI code takes (the UI mocks and the dev-mock both answer "
            f"them, so nothing but a real build sees the miss)"
            + (": " + ", ".join(f"{n} ({v[0]})" for n, v in sorted(fb.items())[:6]) if fb else "")
            + (f" (+{len(fb) - 6} more)" if len(fb) > 6 else "")
        )
        print(
            f"info[{shell}-unreachable]: {len(unreachable)} of {len(allowed_names)} "
            f"allowlisted entries for this shell are reachable by neither direction -- not "
            f"a gap this run measured and not registered in the shell's generate_handler, "
            f"so nothing on either side still asks for the exemption"
            + (f": {', '.join(unreachable)}" if unreachable else "")
            + ". Informational: those entries are dropped by a human edit, not by the "
            "writer flag."
        )

    # The inertness no shape repair touched: an accepted name that matches nothing the run
    # walks enforces nothing, and prints clean. One line per section, because a single
    # whole-file figure would hide that the four sections are inert for four different reasons
    # -- a scoped orphan is inert BY DEFINITION (no caller is what makes it an orphan), a shell
    # gap inert means the UI stopped invoking it, and a dev_mock entry inert means the mock
    # never had to answer it. Informational, not a failure: 25 of those names belong to no one
    # in particular and reding the tree for all of them at once would train people to ignore
    # the gate, which is the outcome this whole file exists to avoid.
    #
    #
    # THREE POPULATIONS, because two made a stale entry arithmetically invisible. The first
    # version of this line printed "153 of 154", numerator and denominator both taken from the
    # file: entries that appear, over entries that exist. That fraction can describe only the
    # file's own membership, so an entry the tree no longer supports was not merely unlabeled,
    # it was unrepresentable -- and 26 names set against 25 entries is not a subset relation at
    # all, which is how the printout read. So every line now carries a middle figure measured
    # from the tree with no reference to the file's size (what this shell does not register,
    # what no mock handler answers, what is registered with no caller) and a third figure that
    # is the whole registered-and-invoked universe. The stale form is then expressible:
    # entries in the file, a tree count independent of it, names matching nothing in that tree.
    #
    # The last figure is invoke-site presence, NOT api-wrapper presence -- an audit at 12:36
    # reported 25 of 25 scoped, 30 of 154 tablet, 1 of 27 desktop, 1 of 16 dev_mock matching no
    # wrapper out of 407 wrapper keys, and verify-scoped-reads.py owns that notion. The line
    # says which corpus it counted instead of borrowing the neighbour's word for it. Nothing
    # here is widened to make the figures agree: for scoped_orphans the honest reading is that
    # every entry in the section matches a registered name and none matches a caller -- 25 and
    # 25 as the info[scoped_orphans-inert] and info[scoped-orphans] lines of this same run
    # print them, and they are the place that number lives -- and that disagreement is the
    # product.
    registered_names = set().union(*(set(handlers[shell]) for shell in SHELLS))
    tree_names = registered_names | set(ui_commands)
    populations = {
        "desktop": (len(missing["desktop"]), "UI command names this shell does not register"),
        "tablet": (len(missing["tablet"]), "UI command names this shell does not register"),
        "dev_mock": (len(mock_gaps), "UI command names no mock handler answers"),
        "scoped_orphans": (len(all_orphans), "scoped commands registered with no caller"),
    }
    for section in (*EXTERNALLY_READ_SECTIONS, *OBJECT_ALLOWED_SECTIONS):
        entries = section_names(allowlist, section)
        off_tree = sorted(entries - tree_names)
        uninvoked = sorted(entries - set(ui_commands))
        tree_count, tree_unit = populations[section]
        print(
            f"info[{section}-inert]: {len(entries)} allowlisted entries, {tree_count} "
            f"{tree_unit}, {len(tree_names)} command names in the tree this run; "
            f"{len(off_tree)} of the allowlisted entries match no command name in the tree "
            f"at all and {len(uninvoked)} match no UI invoke site -- an entry in either list "
            f"is accepted by the file and enforced by nothing"
            + (f"; by name: {', '.join(off_tree[:3])}"
               + (", ..." if len(off_tree) > 3 else "") if off_tree else "")
            + (f"; by caller: {', '.join(uninvoked[:3])}"
               + (", ..." if len(uninvoked) > 3 else "") if uninvoked else "")
            + ". Informational; the middle figure does not come from this file."
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
    # The parse's own blind spot, printed on the same terms as every other number this run
    # reports. A key TypeScript can see and MOCK_LITERAL_KEY_RE cannot is neither a handler
    # gap nor an invisible thing; naming it here means the count is on the record even on a
    # run with no violations to explain. Informational rather than blocking, because with the
    # NOTE above attached to the message it can no longer produce a false reason, and
    # promoting it to a failure would make a formatter opinion a build break.
    if midline_keys:
        detail = "; ".join(
            f"{path}: {', '.join(sorted(names))}"
            for path, names in sorted(midline_keys.items())
        )
        print(
            f"info[dev-mock]: {sum(len(v) for v in midline_keys.values())} handler-shaped "
            f"key(s) sit mid-line and are INVISIBLE to the registrar parse -- {detail}"
        )
    # The reverse direction, on the gate's own parse of the tree rather than on a second one.
    shell_all = set().union(*(set(handlers[s]) for s in SHELLS))
    unreachable = find_unreachable_mock_keys(mock_per_file, shell_all, set(ui_commands))
    if unreachable:
        names_all = sorted({n for s in unreachable.values() for n in s})
        shown = ", ".join(names_all[:12]) + (
            f" … (+{len(names_all) - 12} more)" if len(names_all) > 12 else ""
        )
        print(
            f"info[dev-mock]: {len(names_all)} handler key(s) across {len(unreachable)} "
            f"file(s) reach nothing -- no shell registers them, no UI code names them, and "
            f"they seed no _scoped name that either does: {shown}"
        )
    # Reason state, printed whether or not anything is wrong, because the count of entries
    # nobody explained is the number an owner has to act on and it is invisible in a list of
    # bare names. Informational only: it appends nothing to `failures`, so a run that was
    # green stays green and a run that was red fails for the reason it already failed for.
    mock_reasonless = sorted(name for name, reason in mock_entries if not reason)
    print(
        f"info[dev-mock-reasons]: {len(mock_reasonless)} of {len(mock_entries)} allowlisted "
        f"dev-mock gaps carry no reason (an entry is either a bare name or an object "
        f'{{\"name\": ..., \"reason\": ...}}; the reason is the only record of why the gap '
        f"was accepted rather than owed)"
    )

    # Triage summary for the allowlisted orphans. Printed even when green, because an
    # allowlist that reports nothing is an allowlist nobody re-reads: the gated ones are
    # the entries that deserve attention, and without this line all 25 look identical.
    #
    # This line used to print len(all_orphans) -- the number of orphans found in the tree
    # this run -- under the word "allowlisted", which is the size of a section of a file.
    # Two quantities, one label, and the damage is not cosmetic: on a tree where the file
    # holds 25 and the sweep finds 27, the line reads as evidence that somebody edited the
    # json, and it sent a reader off to re-verify a blob hash that had not moved. The
    # figures now name their own source: "entries allowlisted" is a count of file members,
    # "orphans measured in the tree" is a count of registrations with no caller.
    gated = [c for c in all_orphans if orphan_permission(c)]
    if all_orphans:
        detail = ", ".join(
            f"{c}={orphan_permission(c)}" for c in sorted(gated)) or "none"
        print(
            f"info[scoped-orphans]: {len(orphan_allow)} entries allowlisted, "
            f"{len(all_orphans)} orphans measured in the tree, "
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
