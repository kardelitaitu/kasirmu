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
"""

from __future__ import annotations

import argparse
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
    The other sections have NOT been given the schema: scoped_orphans, desktop and tablet
    are still read through bare set() calls, so a dict in one of those still dies.
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


class AllowlistBusyError(RuntimeError):
    """The target would not accept the rename, so nothing was written."""


# Every reader of this file is bare: .github/workflows/dev-ci.yml:590, scripts/check.sh:56
# and scripts/run-pre-push.py:107, that last one sitting in every agent's push path. A
# reader needs no cooperation from those scripts -- it only needs the file to never be
# half-there, which is what the rename below buys.
ALLOWLIST_READER_CALL_SITES = (".github/workflows/dev-ci.yml:590", "scripts/check.sh:56",
                               "scripts/run-pre-push.py:107")

# Rename retries: 200 tries at 10 ms is about two seconds of patience with a reader.
REPLACE_ATTEMPTS = 200
REPLACE_RETRY_SECONDS = 0.01


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
    window in the middle -- and three bare readers poll this path (.github/workflows/
    dev-ci.yml:590, scripts/check.sh:56, scripts/run-pre-push.py:107, the last one in every
    agent's push path). Measured with a writer loop in one process and a json.loads reader in
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
    "tablet" sections and feeds each member straight into a dict lookup, so an object there
    does not merely confuse this gate -- it reds a second gate that runs bare in CI and in
    check.sh, in a file its owner is not working in. "dev_mock" and "scoped_orphans" have no
    reader outside this script, so they can take the object form as soon as the reads here
    normalise both shapes, which allowlist_section and section_names now do.

    COUPLING, written where the rule lives rather than in a commit message from a lane that
    no longer exists: the two tuples this reads -- EXTERNALLY_READ_SECTIONS ("desktop",
    "tablet") and OBJECT_ALLOWED_SECTIONS ("dev_mock", "scoped_orphans") -- are this file's
    belief about scripts/verify-scoped-reads.py, whose "for cmd in allow.get(shell, [])"
    loop feeds each member straight into a dict lookup, and which runs bare at
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
                f"not an oversight: scripts/verify-scoped-reads.py parses the \"{section}\" "
                f"list (dev-ci.yml#static-gates and scripts/check.sh both run it bare) and "
                f"cannot read an object, so leaving it here would crash a second gate with a "
                f"TypeError instead of failing it. Record the reason in the "
                f'\"_{section}_comment\" prose or a tracking doc until that reader is '
                f"taught the shape."
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
                        f"{where} is an object, {raw.get('name')!r}, and this section is read "
                        f"by a script that cannot parse one. {why(section)}"
                    )
                continue
            problems.append(
                f"{where} is a {type(raw).__name__}, not a command name. {why(section)}"
            )
    return problems


def allowlist_section(payload: dict, key: str) -> list[tuple[str, str]]:
    """One allowlist section as (name, reason) pairs, in the order the file holds them.

    A member is either a bare command name -- the shape every section has always used, and
    still the shape all 16 dev_mock entries are written in -- or an object carrying "name"
    and "reason". Both forms normalise to the same name; only the object form can carry a
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


def update_allowlist(mutate, validated, label: str) -> list[str]:
    """The ONE place the write path opens this file: read, compare, mutate, replace.

    Returns sentences explaining why nothing was written; an empty list means it wrote.

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
        return [
            f"{label} did not write {ALLOWLIST_PATH.name}: the file changed after this run "
            f"read and validated it, during the sweep between the two. Writing now would seal "
            f"an edit nobody validated and possibly overwrite one somebody did. Re-run the "
            f"command; if both edits are meant to exist, make them one edit."
        ]
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
        return [f"{label} did not write {ALLOWLIST_PATH.name}: {busy}"]
    if summary:
        print(summary)
    return []


def report_write_refusals(refusals: list[str]) -> int:
    """Print refusals in the gate's own convention, and say what to return."""
    if not refusals:
        return 0
    print(f"\nFAIL: {len(refusals)} allowlist write problem(s):", file=sys.stderr)
    for line in refusals:
        print(f"  - {line}", file=sys.stderr)
    return 1


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
    # no-op claim: routing them through section_names must change nothing on a tree where
    # every entry is a bare name, and must stop the crash where one is not.
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
    case("case 11  and it names the external reader that cannot parse the object",
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
            refusals["drift"] = write_scoped_orphans({"new_orphan_scoped"}, validated_copy)
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
                refusals["busy"] = write_dev_mock_gaps(["busy_gap_scoped"], load_allowlist())
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

    # Shape first, before the sweeps: a member this file cannot read has to say so in a
    # sentence naming the file, the section and the shape, not as a TypeError out of main()
    # 1.3 seconds into parsing the tree. Same FAIL convention as the findings below, exit 1.
    # The snapshot this run both validates and enforces. Writers are handed this object and
    # refuse to write if the file on disk has moved away from it, so the thing that reaches
    # disk is never something nobody looked at.
    validated = load_allowlist()
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
        return report_write_refusals(write_allowlist(missing, validated))

    allowlist = validated
    failures: list[str] = []

    # Reverse direction: registered scoped commands with no caller.
    orphan_allow = section_names(allowlist, "scoped_orphans")
    orphans: dict[str, list[str]] = {}
    for shell in SHELLS:
        orphans[shell] = orphan_scoped(handlers[shell], ui_commands)
    all_orphans = sorted(set().union(*[set(v) for v in orphans.values()]))
    if args.write_scoped_orphans:
        return report_write_refusals(
            write_scoped_orphans(set(all_orphans), validated))

    # Third direction: can the plain-browser dev-mock answer what the UI invokes?
    mock_registered, mock_aliasable, mock_per_file, mock_alias_file = (
        extract_dev_mock_answerable())
    mock_answerable = mock_registered | mock_aliasable
    mock_gaps = sorted(c for c in ui_commands if c not in mock_answerable)
    if args.write_dev_mock_gaps:
        return report_write_refusals(write_dev_mock_gaps(mock_gaps, validated))

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
    for command in sorted(set(mock_gaps) - mock_allow):
        refs = ", ".join(sorted(set(ui_commands[command]))[:3])
        failures.append(
            f"dev-mock: UI invokes '{command}' but no handler anywhere under "
            f"{DEV_MOCK_DIR_REL} registers it (the router and every extracted module "
            f"under it were read, and no unscoped twin exists for the alias rule to "
            f"reach) -- invoke() returns null and the caller silently renders its "
            f"failure path (e.g. {refs}). An allowlist entry may carry why the gap was "
            f"accepted -- rewrite it as {{\"name\": \"{command}\", \"reason\": \"...\"}} "
            f"-- and the count of entries that do not is printed on every run."
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
        # different units, and the tree proves it apart: tablet reports 153 of the former
        # and 0 of the latter, which one quantity printed twice cannot do.
        unreachable = sorted(allowed_names - missing[shell] - set(handlers[shell]))
        print(
            f"info[{shell}]: {len(ui_commands)} UI command strings, "
            f"{len(handlers[shell])} registered, "
            f"{len(missing[shell])} unregistered UI command names "
            f"({len(unregistered)} unregistered tauri command fns - F-006 tracker) "
            f"({len(allowed_names)} allowlisted)"
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
