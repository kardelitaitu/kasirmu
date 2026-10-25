#!/usr/bin/env python3
"""Refuse a vitest l10n stub whose hand-maintained key map has holes.

WHY THIS EXISTS
---------------
Production copy moves into Fluent continuously. Every move changes one thing the
types do not carry: a literal that was inline in the component becomes
`l10n.getString('some-key')`. A test that mocks `@fluent/react` and answers
`getString` from a HAND-MAINTAINED object literal is not updated by that move, so
`getString` returns the RAW KEY. Two failures follow, and the second is the
dangerous one:

  * a test that asserts on English copy fails with 'some-key' where 'Premium'
    was expected -- confusing, but loud;
  * a test that asserts the raw key, or never asserts that string at all, PASSES
    while the UI is unlabelled. The component's own ARIA label is then the id.

Three files hit this inside ONE session (2026-11-06):

  ui/src/__tests__/topologyEditorTestHarness.tsx:28
      'topology-tool-locked-premium' missing after 8cffb0935 moved a literal
      'Premium' into FTL -- the tier-lock case then failed on the raw id.
  ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx:62
      'license-activation-logo-alt' missing (shared.ftl:976) -- case 49 failed on
      alt text nobody had spelled out in the map.
  ui/src/features/settings/__tests__/FeatureToggleScreen.test.tsx:41
      'lsp-nav-aria' and 'lsp-workspaces-aria' missing -- no case asserted them,
      so both preview groups were labelled with their raw ids.

Each was found by breaking something else and reading the failure. This gate
reads it first.

WHAT IT CHECKS
--------------
For every `*.test.ts` / `*.test.tsx` under `ui/src`:

  1. BUNDLE -- every key defined in `shared-ui/locales/*.ftl` (the `*.id.ftl`
     siblings are skipped: same keys, Indonesian values).
  2. MAP -- every hand-maintained key map in the test: a run of at least
     MIN_RUN_LINES key->string pairs. Annotation-style objects
     (`CANNOT_REACH_PAPER = {...}`, `MIRRORED_CONSUMERS = {...}`) are NOT maps
     and are never counted: a map is identified by the lookup that consults it
     (`[id]`) or by sitting inside a `return` / `if`.
  3. USES -- every `l10n.getString('KEY')` / `<Localized id="KEY">` in the
     modules the test IMPORTS, plus one level of the component's own relative
     imports (the copy for NodeTopologyEditor is spread over
     nodeTopologyToolRack.tsx and friends).
  4. MISSING = used by an imported module AND defined in the bundle AND absent
     from the map.

A map is only judged when its miss lands back on the raw key (`map[id] ?? id`,
`(map as Record<string, string>)[id] || id`): that is the shape that turns a hole
into a raw key. A stub that FORMATS the key (`key + ':' + args`) is skipped by
construction -- there the key IS the expected output.

DELIBERATELY NOT REPORTED -- each rule is a false positive this gate refuses to emit
-------------------------------------------------------------------------------
  * A module the TEST REPLACES with `vi.mock('SPEC')` contributes no uses. The
    file it replaces commonly still contains
    `input placeholder={l10n.getString('x')}`, and the test swaps the component
    for `() => null`, so the string can never render. Measured 2026-11-06:
    without this rule the component-wholesale mocks alone produced six phantom
    findings.
  * `getString(flag ? 'a' : 'b')` -- a CONDITIONAL, not a call. Which arm runs
    is not statically knowable and guessing is a coin flip.
  * `Localized id={...}` that is not a string literal, and computed keys -- the
    key is not knowable.
  * A map whose values are ALL still the raw keys (`'a': 'a'`) -- a suite that
    addresses the DOM by key, where seeding is a rewrite, not a repair. Measured
    2026-11-06 on ui/src/__tests__/TopologyScreen.test.tsx: 31 `name: 'topology-...'`
    queries, and seeding even one key broke three tests.
  * The `error-boundary-` PREFIX. ui/src/components/ErrorBoundary.tsx:12-17
    builds its own FluentBundle and never reads the shared context, so a stub
    map cannot supply those keys and their absence is not a hole. The prefix is
    excluded rather than the two keys, so a third one added there is not a
    finding either.
  * A key used ONLY through a template literal or a dynamic import -- it is
    never collected, so it is never reported.

WHAT THE BASELINE ENTRIES ACTUALLY ARE (measured 2026-11-06)
----------------------------------------------------------------
The baseline is a CENSUS, not a defect count. A map is legitimately PARTIAL
when the suite never reads the strings it omits, and this detector cannot
see which keys a given case exercises. Hand-audited buckets:

  * a11y/NodeTopologyEditor.a11y.test.tsx NO LONGER APPEARS HERE. Its map is a
         "minimal en fallback surface" and the file asserts only checkA11y(),
         element counts and CSS selectors, so the copy-assertion guard skips
         it: no test in it could fail because a key was missing.
  * 65   TooltipPreview.test.tsx. A 4-entry map against 69 used keys; every
         assertion reads copy rendered by the <Localized> PASSTHROUGH.
  * ~300 analytics/provisioning/settings suites whose maps are partial by
         their own written contract.
  * ~5   genuinely actionable, e.g. WorkspaceTerminalPreferencesCard.test.tsx
         (settings-edc-test and -default-select are plain getString calls
         that no case asserts).

Also inherited from the stub: <Localized id="KEY"> counts as a use even when
the suite replaces Localized with a passthrough, which inflates the count.

RESOLVED 2026-11-06: TopologyScreen.test.tsx is no longer an accident. Its
map was 5 keys while its 31 `name: topology-...` queries addressed the UI by
RAW KEY, so it passed only because getString fell through to the id. That map
is now seeded from the FTL (62 keys) and the queries match English copy, which
means the suite is judged like any other and a future hole in it fails the gate.

The "by-key suite" rule that paragraph used to propose (absent > 0 and
addressed/absent < 0.5) was never adopted and is no longer needed: a suite that
queries by key is a suite whose assertions are WRONG, not a suite to exempt.
scripts/check-raw-key-assertions.py now grades that directly, so the exemption
would have preserved the defect it was meant to tolerate.

Five assertions in that file still compare a KEY, and are correct to: the
topologyApply validation errors are constructed as
`new TopologyApplyValidationError(l10n.getString(messageId))` where messageId
is already a key, so the thrown message genuinely IS the id. Converting them
was measured and reverted (6 red). The fix, if wanted, belongs in topologyApply.

THE LIMIT OF THIS DETECTOR, stated plainly
------------------------------------------
It grades a map against STATIC literal uses in the modules a test imports. It
cannot know which keys a given case actually exercises, so a key used only under
a runtime branch still counts, and a map that is complete for the imported graph
but small is correct to it. It errs toward reporting a hole rather than silently
skipping one, because the failure it guards is silent.

EXIT CODES
    0  every hand-maintained map covers every key its imports use
    1  at least one map has a hole
    2  the scan broke (no locales, no test files, no maps, detector went deaf)

Usage, from the repo root:

    python scripts/check-l10n-test-maps.py
    python scripts/check-l10n-test-maps.py --self-test
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_SRC = REPO / "ui" / "src"
LOCALES = REPO / "shared-ui" / "locales"

#: A map needs this many key->string pairs in a row to count as "hand-maintained".
#: Measured 2026-11-06: two-line stubs exist, but they are partial by design and
#: the component they cover is small enough that a hole there shows up in the test.
MIN_RUN_LINES = 3

BASELINE_PATH = REPO / "scripts" / "l10n-map-baseline.json"

BASELINE_DOC = {"description": "see --write-baseline"}

#: Keys whose only reader is ErrorBoundary.tsx's OWN FluentBundle (:12-17).
LOCAL_BUNDLE_PREFIXES = ("error-boundary-",)

#: At most this many lines of prose between two keys, so a trailing comment block
#: does not end the run.
KEY_BLOCK_GAP = 4

#: How many keys a suite must QUERY BY LITERAL before it counts as addressing the
#: DOM by key rather than by copy. Measured 2026-11-06: the five suite files that
#: query by key scored 67, 55, 5, 4 and 3; every other file scored 0. The
#: threshold is a real block of queries, so one stray key-shaped string literal in
#: an assertion cannot exempt a map on its own.
MIN_ADDRESSED_BY_KEY = 3

#: Any query or assertion that reads rendered copy.
#:
#: Deliberately FAMILY-based, not an enumeration. This regex decides whether the
#: whole map gate applies to a file, so a missing shape opts an entire suite out
#: silently. Measured 2026-11-07: an enumerated version missed 13 of 17 realistic
#: shapes -- toHaveAccessibleName, getByDisplayValue, getByTitle, the PLURAL
#: GetAllByRole/findAllByRole family (the only way to assert a collection of copy),
#: toHaveAttribute(aria-label), toMatchSnapshot, toMatchInlineSnapshot. One
#: alternative in that version, "getAllByRole", could never match at all: after
#: "getAllBy" it required "Role" + optional space + "(", and the real text is
#: "Role(", so it failed with no backtracking.
#:
#: So: every getBy*/queryBy*/findBy* variant (singular, plural, All), every
#: toHave* matcher that can carry text, and the snapshot matchers.
ASSERTS_COPY_RE = re.compile(
    r"\b(?:(?:get|query|find)(?:All)?By[A-Za-z]*|toHave(?:Text|AccessibleName|AccessibleDescription|Value|DisplayValue|Attribute|ValueNot|TextContent)[A-Za-z]*|toMatch[A-Za-z]*Snapshot)\s*\(",
)

RESERVED_WORD_RE = re.compile(r"^\s*(return|if|else)\b")

#: A key line inside a literal: `'topology-new-store': 'New Store',`

#: A map VALUE containing a bare $name -- the shape you get by flattening an FTL
#: message without converting its placeable to the stub's {name} form.
#:
#: Seeding maps from the FTL is now routine, and a naive flattener turns
#: "4 items { $amount }" into "4 items $amount", which the stub cannot substitute:
#: the assertion silently matches a string the UI never renders. Found nine such
#: values across three files on 2026-11-07, all passing their own tests.
LITERAL_VAR_RE = re.compile(r"[^$]*\$(?![{])[A-Za-z_][A-Za-z0-9_]*")

KEY_LINE_RE = re.compile(
    r"""^\s*['"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['"]\s*:"""
)
#: `map[id]`, `TOPOLOGY_EN[id]`, `(map as Record<string, string>)[id]`.
LOOKUP_TAIL_RE = re.compile(r"\[(?P<var>[A-Za-z_$][\w$]*)\]\s*(?:\?\?|\|\||\?\.)?")

#: `l10n.getString('some-key'` or `getString("some-key"`.
GETSTRING_RE = re.compile(
    r"""getString\s*\(\s*['"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['"]"""
)
#: A ternary after the literal argument: `flag ? 'a' : 'b'`.
CONDITIONAL_AFTER_RE = re.compile(r"\s*[:?](?!=)")
LOCALIZED_RE = re.compile(
    r"""<Localized\b[^>]*?\bid\s*=\s*['"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['"]""",
    re.S,
)
#: `vi.mock('@/spec/ifier'` -- module specifiers only, never a bare statement.
VI_MOCK_RE = re.compile(r"""vi\.mock\(\s*['"](?P<spec>[^'"]+)['"]""")
IMPORT_FROM_RE = re.compile(
    r"""^\s*import\s[^;]*?\bfrom\s*['"](?P<spec>[^'"]+)['"]""", re.M
)
IMPORT_DYNAMIC_RE = re.compile(r"""\bimport\(\s*['"](?P<spec>[^'"]+)['"]\s*\)""")
FTL_KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*)\s*=", re.M)
#: A QUERY TARGET: a string literal in a DOM query. Two shapes:
#:   `{ name: 'topology-save-aria' }`         -- a testing-library query option
#:   `getByText('Tooltip Preview')`           -- a query call's first argument
#: The first must NOT be any property: `{ className: 'foo-bar' }` is not a query,
#: and a CSS class is hyphenated like a key. The second must be a QUERY CALL, not
#: any call -- `t('some-key')`.
PROP_QUERY_RE = re.compile(
    r"""\b(?:name|labelText|placeholderText|altText|displayValue)\s*:\s*['\"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['\"]"""
)
#: NOTE the literal 'get|query|find' appears IN THIS COMMENT on purpose.
#: Without that per-character alternative in the file, typing the canonical
#: pattern byte-for-byte (verified with hexdump) compiled to something that did
#: not match `getByText(` at all, while the same text typed one character at a
#: time did -- the same discipline (type it, test it on the exact byte string)
#: applies to any future edit of these three patterns.
CALL_QUERY_RE = re.compile(
    r"""(?:get|query|find)[A-Za-z0-9]*By[A-Za-z]+\(\s*['\"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['\"]"""
)
#: A key-shaped literal passed to a local helper instead of a query, e.g.
#: `q('topology-save-aria')`. Any CALL with a hyphenated key argument counts here,
#: and `addresses_by_key` subtracts the two shapes above so a key is never
#: counted twice.
HELPER_QUERY_RE = re.compile(
    r"""(?<![A-Za-z0-9_$.])(?P<fn>[A-Za-z_$][\w$]*)\(\s*['\"](?P<key>[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)['\"]"""
)
MODULE_EXTS = (".tsx", ".ts")
NON_MODULE_SUFFIXES = (".css", ".json", ".ftl", ".svg", ".png", ".test.ts", ".test.tsx")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


# 1. The bundle ----------------------------------------------------------


def bundle_keys() -> set[str]:
    """Every message key in shared-ui/locales, minus the *.id.ftl siblings."""
    if not LOCALES.is_dir():
        raise SystemExit(f"SCAN BROKE: {LOCALES} not found")
    files = sorted(p for p in LOCALES.glob("*.ftl") if not p.name.endswith(".id.ftl"))
    if not files:
        raise SystemExit("SCAN BROKE: no *.ftl under shared-ui/locales")
    keys: set[str] = set()
    for path in files:
        keys.update(m.group(1) for m in FTL_KEY_RE.finditer(_read(path)))
    return keys


# 2. Maps in a test file -------------------------------------------------


def _imported_map_ref(text: str) -> str | None:
    """The identifier a stub looks up when the map is IMPORTED, not inline.

    `getString: (id) => TOPOLOGY_EN[id] ?? id` is the same raw-key fallback as an
    inline literal, but the map lives in another module, so find_maps() cannot
    see it and every suite built on such a harness was judged as 0 maps. The
    gate's OWN motivating case (topologyEditorTestHarness.tsx) sat in that hole.
    Returns the bare identifier, or None.
    """
    m = re.search(r"\b([A-Za-z_$][\w$]*)\s*\[(\w+)\]\s*(?:\?\?|\|\|)\s*\2\b", text)
    if not m:
        return None
    name = m.group(1)
    # `map[id]` / `lookup[key]` are local; a SCREAMING or Pascal name is imported.
    return name if (name.isupper() or name[:1].isupper()) else None

def _fallback_shape(text: str) -> str:
    """How a miss resolves: back onto the raw key, or not at all.

    The lookup is indexed by WHATEVER the stub names its parameter. This branch
    used to match a literal `[id]`, so a stub written `lookup[key] ?? key` --
    the same fallback, one renaming away -- fell through to the `return` arm,
    whose guards reject any `[` and therefore returned ''. Four files were
    therefore never judged: TerminalStatusPanel.test.tsx and its neighbours
    were invisible to the gate for a variable name.
    """
    for m in re.finditer(r"\[(\w+)\]\s*(?:\?\?|\|\|)\s*([^;\n,)]+)", text):
        if m.group(2).strip() == m.group(1):
            return m.group(0)
        # NOT a short-circuit. Returning '' on the first non-matching hit let a
        # FORMATTING expression veto a real fallback further down: SessionLockScreen
        # substitutes placeholders with `vars[key] ?? `{$${key}}``, that match is not
        # a raw-key fallback, and the early return hid the `return result || id`
        # eight lines below it. The scan must keep looking.
        continue
    for m in re.finditer(r"return\s+([^;\n]+)", text):
        rhs = m.group(1).strip()
        # The identifier must be a BRACKET-LESS bare `id`. `formattedKey(id)` and
        # `[id]` are not a raw-key fallback, and neither is a template that
        # interpolates the id on purpose.
        if (
            re.search(r"(?<![\w.$])id(?![\w])", rhs)
            and "(" not in rhs
            and "[" not in rhs
            and ("`" + "{") not in rhs
        ):
            return "return <id expression>"
    return ""


def _identity_attached(region: list[str]) -> bool:
    """True when a lookup (`[id]`) or a reserved-word statement is in `region`."""
    for raw in region:
        stripped = raw.lstrip()
        if LOOKUP_TAIL_RE.search(stripped):
            return True
        if RESERVED_WORD_RE.match(stripped):
            return True
    return False


def addresses_by_key(body: str, keys_absent_from_maps: set[str]) -> int:
    """How many keys absent from every map the TEST ITSELF queries by literal.

    A suite that finds elements by the raw FTL key -- `getByRole('button',
    { name: 'topology-apply-changes' })` -- is passing BECAUSE getString hands
    the id back. Seeding the map is then not a repair, it is a rewrite of every
    assertion in it. That is a property of the SUITE, not of the map: on
    2026-11-06 ui/src/__tests__/TopologyScreen.test.tsx had 67 such keys and
    only 5 map entries, and seeding even one broke three tests.

    Returns a COUNT, not a flag: a stray key literal in one assertion (an
    error-message text that happens to look like a key) must not exempt a map.
    The caller requires a real block of them.
    """
    found: list[int] = []
    for regex in (PROP_QUERY_RE, CALL_QUERY_RE, HELPER_QUERY_RE):
        for m in regex.finditer(body):
            if m.group("key") in keys_absent_from_maps:
                found.append(m.start())
    return len(set(found))


def _is_comment(line: str) -> bool:
    """True for a line that CONTINUES a map rather than ending it.

    A map entry may put its value on the NEXT line:

        'topology-confirm-delete-node-msg':
          'This node has connected wires. ...',

    That continuation starts with a quote, so treating every non-comment as
    code split TOPOLOGY_EN into three maps at exactly its two long values --
    46 + 71 + 56 keys instead of one 173-key object, and the pieces then
    reported each other as holes.
    """
    t = line.strip()
    if not t or t.startswith("//") or t.startswith("*") or t.startswith("/*"):
        return True
    return t[0] in "'\"`"


def _closes_literal(line: str) -> bool:
    """True when this line ends the object literal a key run belongs to."""
    t = line.strip()
    return t in ("};", "}", "},", "});", "));") or t.startswith("}; ")


def find_maps(text: str) -> list[dict]:
    """Every hand-maintained key->string map in a test file."""
    lines = text.split("\n")
    hits = [(i, m) for i, line in enumerate(lines) if (m := KEY_LINE_RE.match(line))]
    maps: list[dict] = []
    i = 0
    while i < len(hits):
        run_start = i
        run_end = i
        while run_end + 1 < len(hits):
            gap = hits[run_end + 1][0] - hits[run_end][0]
            # Check EVERY gap for a closing brace, not only a wide one.
            # `};` typed between two key lines is a literal boundary whether the
            # gap is 3 lines or 30, and gating the test on gap width merged two
            # separate objects into one 6-key map.
            if True:
                # A comment block does not end a literal. Inserting five lines of
                # explanation inside a map split a 26-key object into 10 + 16 and
                # made keys documented in one half look MISSING from the other.
                between = lines[hits[run_end][0] + 1 : hits[run_end + 1][0]]
                # An EMPTY between is two adjacent keys -- the normal case.
                if between and not all(_is_comment(b) for b in between):
                    break
            run_end += 1
        if run_end - run_start + 1 < MIN_RUN_LINES:
            i = run_end + 1
            continue
        next_key = hits[run_end + 1][0] if run_end + 1 < len(hits) else len(lines)
        first = hits[run_start][0]
        last = hits[run_end][0]
        after = "\n".join(lines[first + 1 : next_key])
        # A map is identified by the lookup that consults it, or by sitting
        # inside a return/if. An annotation object has neither.
        # Window to the LOOKUP, not to the start of the map. Measuring from
        # first + 9 capped every map at eight keys: the map this gate was
        # written for has 69, its [id] || id sits on line 80, and the whole
        # file was therefore judged as 0 maps -- the gate went blind on exactly
        # the maps most likely to have holes. The boundary is still next_key
        # so the window cannot run past the literal.
        identity = _identity_attached(lines[first + 1 : next_key])
        keys: dict[str, int] = {}
        values: dict[str, str] = {}
        for idx in range(run_start, run_end + 1):
            line_no, m = hits[idx]
            keys.setdefault(m.group("key"), line_no + 1)
            # The literal text after the colon, so a bare $name can be spotted.
            raw = lines[line_no]
            values.setdefault(m.group("key"), raw.split(":", 1)[1] if ":" in raw else "")
        maps.append(
            {
                "start_line": first + 1,
                "end_line": last + 1,
                "values": values,
                "keys": keys,
                "fallback": _fallback_shape(after) if identity else "",
            }
        )
        i = run_end + 1
    return maps


# 3. Uses in a module ----------------------------------------------------


def module_uses(text: str) -> dict[str, int]:
    """KEY -> 1-based line of the first `getString` call that resolves it.

    `<Localized id="KEY">` is deliberately NOT collected. A `<Localized>` is
    resolved by the LocalizationProvider — either the real one, or the stub's
    `Localized` passthrough, and in the passthrough case the key is replaced by
    the CHILDREN. A `getString` map is never consulted for it, so its absence is
    not a hole in the map. Measured 2026-11-06 on the first live run: 67 of 175
    findings were `<Localized>` keys (AppearanceSettings.test.tsx\'s 37 included
    every one of them) and seeding them changes nothing a test asserts.

    The one shape that does go through `getString` — a `<Localized>` that wraps
    an element carrying `attr={l10n.getString(\'x\')}` — is caught by the
    getString arm, which is why that arm comes first and wins the line number.
    """
    uses: dict[str, int] = {}

    def note(key: str, offset: int) -> None:
        uses.setdefault(key, text.count("\n", 0, offset) + 1)

    for m in GETSTRING_RE.finditer(text):
        if CONDITIONAL_AFTER_RE.match(text[m.end() : m.end() + 3]):
            continue  # ternary: which arm runs is not statically knowable
        note(m.group("key"), m.start())
    # `<Localized id="KEY">` IS collected, and must be. In production the
    # provider resolves it; with a PASSTHROUGH Localized the children render and
    # the id never reaches getString -- but the stubs that carry a hand-maintained
    # map here mostly keep the REAL Localized from `vi.importActual`, whose l10n
    # is the same stub object, so the id DOES reach getString and lands on the
    # map. Measured 2026-11-06: ui/src/__tests__/WorkspaceInventorySettings.test
    # .tsx renders `<Localized id="settings-load-failed">` through a real
    # provider and its map answers it from `d[id] ?? id`.
    for m in LOCALIZED_RE.finditer(text):
        note(m.group("key"), m.start())
    return uses


def resolve_spec(spec: str, importer: Path) -> Path | None:
    """The repo file a module specifier names, or None when it is not ours."""
    if spec.startswith("@/"):
        base = UI_SRC / spec[2:]
    elif spec.startswith("."):
        base = importer.parent / spec
    else:
        return None
    base = Path(str(base).split("?")[0])
    if base.name.endswith(NON_MODULE_SUFFIXES):
        return None
    if base.suffix in MODULE_EXTS:
        return base if base.is_file() else None
    for ext in MODULE_EXTS:
        cand = base.with_suffix(ext)
        if cand.is_file():
            return cand
    for ext in MODULE_EXTS:
        cand = base / ("index" + ext)
        if cand.is_file():
            return cand
    return None


def spec_matches(spec: str, importer: Path, target: Path) -> bool:
    """True when `vi.mock(spec)` in `importer` replaces `target`."""
    resolved = resolve_spec(spec, importer)
    if resolved is None:
        stem = Path(spec.split("?")[0]).name
        return bool(stem) and target.stem == stem
    return resolved == target


# 4. The scan ------------------------------------------------------------


def _rel(path: Path) -> str:
    """Repo-relative posix path; a synthetic --self-test root falls back to itself."""
    for anchor in (REPO, UI_SRC):
        try:
            return path.relative_to(anchor).as_posix()
        except ValueError:
            continue
    return path.as_posix()


def scan() -> tuple[list[str], int, int]:
    """Findings, test files read, maps judged."""
    keys = bundle_keys()
    if not UI_SRC.is_dir():
        raise SystemExit(f"SCAN BROKE: {UI_SRC} not found")
    findings: list[str] = []
    read = 0
    judged = 0
    # `*.test.tsx` does not END with `.test.ts`, but it does START with it --
    # a plain `str.endswith(tuple)` silently found nothing above ui/src/__tests__.
    # Seen live: the first end-to-end run read 0 test files under ui/src/features
    # and the empty-population guard was the only reason it did not report clean.
    tests = sorted(
        p
        for p in UI_SRC.rglob("*")
        if p.is_file() and (p.name.endswith(".test.ts") or p.name.endswith(".test.tsx"))
    )
    cache: dict[Path, dict[str, int]] = {}

    def uses_of(path: Path) -> dict[str, int]:
        if path not in cache:
            cache[path] = module_uses(_read(path))
        return cache[path]

    for test in tests:
        read += 1
        rel = _rel(test)
        body = _read(test)
        if "getString" not in body and "<Localized" not in body:
            continue
        # A file that never ASSERTS on rendered copy cannot fail because a key
        # is missing -- the string it would have matched is never read. Judging
        # such a map produces findings that no test can ever act on. Measured
        # 2026-11-07: a11y/NodeTopologyEditor.a11y.test.tsx contributes 135
        # baseline entries and asserts only checkA11y(), element counts and CSS
        # selectors; its map docstring calls itself a "minimal en fallback
        # surface". Those 135 were 23% of the census and none was actionable.
        if not ASSERTS_COPY_RE.search(body):
            continue
        maps = [m for m in find_maps(body) if m["fallback"]]
        # A stub can look its map up from an IMPORTED module instead of an inline
        # literal -- `TOPOLOGY_EN[id] ?? id` where TOPOLOGY_EN is exported by a
        # sibling harness. find_maps() sees only literals, so every suite built on
        # such a harness was skipped as "0 maps". That is the gate's own motivating
        # case: the harness that lost topology-tool-locked-premium to 8cffb0935 is
        # invisible to it. Resolve the identifier to the module that DEFINES it and
        # judge that map, attributed to this test.
        if not maps:
            ref = _imported_map_ref(body)
            if ref:
                for spec in sorted(set(m.group("spec") for m in IMPORT_FROM_RE.finditer(body))):
                    mod = resolve_spec(spec, test)
                    if mod is None or mod == test:
                        continue
                    src = _read(mod)
                    # The DECLARATION, not merely a mention: a module can export
                    # several key-shaped objects (the topology harness exports a
                    # 19-key TOPOLOGY_EN and a 148-key RETAIL_SEED fixture), and
                    # matching on "this name appears somewhere in the file" picked
                    # the wrong one -- 148 keys against a 7-key component reported
                    # 263 findings. Locate the object bound to the NAME.
                    decl = re.search(
                        r"(?:export\s+)?(?:const|let|var)\s+" + re.escape(ref) + r"\b[^=]*=\s*\{",
                        src,
                    )
                    if not decl:
                        continue
                    decl_line = src.count(chr(10), 0, decl.start()) + 1
                    for m in find_maps(src):
                        if abs(m["start_line"] - (decl_line + 1)) > 1:
                            continue
                        m = dict(m)
                        m["fallback"] = ref + "[id] ?? id"
                        # Scope to the modules the TEST imports DIRECTLY (the
                        # component under test), not the transitive graph. An
                        # imported map answers that component's copy; grading it
                        # against everything the component itself imports reported
                        # 169 findings where the component uses 7 bundle keys.
                        # One level, because this map is a HARNESS somebody else
                        # wrote -- its own file calls getString zero times and the
                        # strings it supplies belong to the consumers.
                        m["scope_direct"] = True
                        maps.append(m)
                    break
        if not maps:
            continue
        mocked = [m.group("spec") for m in VI_MOCK_RE.finditer(body)]
        imports = {m.group("spec") for m in IMPORT_FROM_RE.finditer(body)} | {
            m.group("spec") for m in IMPORT_DYNAMIC_RE.finditer(body)
        }
        modules: list[Path] = []
        for spec in sorted(imports):
            path = resolve_spec(spec, test)
            if path is None or path in modules:
                continue
            if any(spec_matches(s, test, path) for s in mocked):
                continue  # replaced wholesale -- its strings cannot render
            modules.append(path)
        if not modules:
            continue
        nested: list[Path] = []
        for path in modules:
            for m in IMPORT_FROM_RE.finditer(_read(path)):
                spec = m.group("spec")
                if not spec.startswith("."):
                    continue
                child = resolve_spec(spec, path)
                if child is None or child in modules or child in nested:
                    continue
                if any(spec_matches(s, path, child) for s in mocked):
                    continue
                nested.append(child)
        uses: dict[str, tuple[int, str]] = {}
        # Both paths scan the SAME graph. An earlier round narrowed the
        # imported-map path to direct imports, justified by a 169-finding
        # over-report that was really the map-splitting bug. The narrowing
        # outlived its cause and hid real copy: a component NodeTopologyEditor
        # genuinely renders pulls 57 nested modules carrying 184 bundle keys,
        # and 79 of them were absent from the harness map. An asymmetry
        # between two paths through the same rule is a blind spot, not a
        # conservatism.
        scan_paths = modules + nested
        for path in scan_paths:
            for key, line in uses_of(path).items():
                if key.startswith(LOCAL_BUNDLE_PREFIXES) or key not in keys:
                    continue
                uses.setdefault(key, (line, path.name))
        if not uses:
            continue
        missing = {
            key: (line, name)
            for key, (line, name) in uses.items()
            if all(key not in m["keys"] for m in maps)
        }
        if not missing:
            # Nothing is missing from EVERY map: without this gate a file whose
            # stubs are planted `getString: (id: string) => ...` with `map[id] ?? id`
            # bodies -- the most common shape in this tree -- would be counted as
            # judged maps even though no map can be wrong.
            continue
        if addresses_by_key(body, set(missing)) >= MIN_ADDRESSED_BY_KEY:
            # The suite finds elements by the RAW KEY. getString returning the id
            # is the contract it was written against; seeding these keys would
            # break it. See `addresses_by_key` for the measurement.
            continue
        for m in maps:
            judged += 1
            for key, (line, name) in sorted(uses.items()):
                if key in m["keys"]:
                    continue
                findings.append("%s:%d  %s  used-by %s:%d" % (rel, m["start_line"], key, name, line))
            # A seeded value that still contains a bare $name cannot be substituted by
            # the stub, so it can never match what the UI renders.
            for key, raw in sorted(m.get("values", {}).items()):
                if LITERAL_VAR_RE.search(raw):
                    findings.append("%s:%d  %s  unsubstituted-$ placeable" % (rel, m["start_line"], key))
    return findings, read, judged


# Self-test --------------------------------------------------------------

_TEST_HEAD = """import { describe, it, vi } from 'vitest';
import Component from '@/features/demo/DemoScreen';

"""


def _stub(
    map_lines: list[str],
    head: str = _TEST_HEAD,
    fallback: str = "return (map as Record<string, string>)[id] || id;",
) -> str:
    body = "\n".join("        " + line for line in map_lines)
    return head + "vi.mock('@fluent/react', () => ({\n" + (
        "  Localized: ({ children }) => <>{children}</>,\n"
        "  useLocalization: () => ({ l10n: {\n"
        "    getString: (id: string, args?: Record<string, unknown>) => {\n"
        "      const map = {\n" + body + "\n      };\n"
        "      " + fallback + "\n"
        "    }\n"
        "  } })\n"
        "}));\n"
    # A real test file asserts on rendered copy; the guard that skips files which
    # never do would otherwise treat this fixture as vacuous.
    + "expect(screen.getByText('A')).toBeInTheDocument();\n"
    )


def detector_still_fires() -> bool:
    """Grade the map detector and the use detector over synthetic sources."""
    three = ["'a-one': 'A',", "'a-two': 'B',", "'a-three': 'C',"]
    maps = find_maps(_stub(three + ["'a-four': 'D',"]))
    if len(maps) != 1:
        return False
    if set(maps[0]["keys"]) != {"a-one", "a-two", "a-three", "a-four"}:
        return False
    if not maps[0]["fallback"]:
        return False  # a raw-key fallback must be recognised
    # An annotation object (no lookup, no reserved-word statement) is not a map.
    annotation = _TEST_HEAD + "const NOTES: Record<string, string> = {\n" + "\n".join(
        "  " + line for line in three
    ) + "\n};\n"
    if any(m["fallback"] for m in find_maps(annotation)):
        return False
    # A stub that FORMATS the key is not a raw-key fallback.
    fmt = _stub(three, fallback="return formattedKey(id, args);")
    if any(m["fallback"] for m in find_maps(fmt)):
        return False
    # Uses: a literal counts, a conditional does not.
    if module_uses("const x = l10n.getString('b-one');") != {"b-one": 1}:
        return False
    if module_uses("const x = l10n.getString(flag ? 'b-one' : 'b-two');"):
        return False
    # `<Localized id>` counts: a stub that keeps the REAL Localized routes the id
    # through the same stub l10n, so it lands on the map.
    if module_uses('<Localized id="b-three">x</Localized>') != {"b-three": 1}:
        return False
    # `id={...}` is not a literal key and is not collected.
    if module_uses('<Localized id={dynamic}>x</Localized>'):
        return False
    # ...and a getString INSIDE <Localized> reaches the stub too.
    if module_uses(
        '<Localized id="b-four" attrs={{ alt: true }}><img alt={l10n.getString("b-five")} /></Localized>'
    ) != {"b-four": 1, "b-five": 1}:
        return False
    # The copy-assertion guard decides whether the WHOLE gate applies to a file,
    # so a shape it fails to recognise silently opts a suite out. Pin the shapes
    # that were measured missing, so "guard too narrow" cannot pass the self-test.
    q = chr(39)
    must_match = [
        "screen.getByText(" + q + "x" + q + ")",
        "screen.getByDisplayValue(" + q + "x" + q + ")",
        "screen.getByTitle(" + q + "x" + q + ")",
        "screen.getAllByRole(" + q + "button" + q + ")",
        "screen.queryAllByRole(" + q + "button" + q + ")",
        "screen.findByLabelText(" + q + "x" + q + ")",
        "expect(el).toHaveAccessibleName(" + q + "x" + q + ")",
        "expect(el).toHaveAttribute(" + q + "aria-label" + q + ", " + q + "x" + q + ")",
        "expect(x).toMatchSnapshot()",
        "expect(x).toMatchInlineSnapshot()",
    ]
    must_not_match = [
        "await checkA11y(container)",
        "expect(el).not.toBeNull()",
        "expect(container.querySelectorAll(" + q + ".n" + q + ")).toHaveLength(2)",
    ]
    if not all(ASSERTS_COPY_RE.search(t) for t in must_match):
        return False
    if any(ASSERTS_COPY_RE.search(t) for t in must_not_match):
        return False
    # A flattened FTL placeable ($name) can never be substituted by a stub that
    # replaces {name}, so the assertion matches text the UI never renders.
    if not LITERAL_VAR_RE.search("Order " + "$" + "n"):
        return False
    if LITERAL_VAR_RE.search("Order {n}"):
        return False
    if LITERAL_VAR_RE.search("Auto-wrapping"):
        return False
    return True


def scan_still_judges() -> bool:
    """End-to-end: a synthetic tree the scanner must flag, and one it must not."""
    import shutil

    root = Path(tempfile.mkdtemp(prefix="l10n-map-selftest-"))
    saved = (globals()["UI_SRC"], globals()["LOCALES"])
    try:
        (root / "locales").mkdir()
        (root / "locales" / "demo.ftl").write_text(
            "demo-one = One\ndemo-three = Three\ndemo-four = Four\ndemo-five = Five\n", encoding="utf-8"
        )
        # Mirrors the real layout: `@/features/demo/DemoScreen` named by
        # _TEST_HEAD has to resolve to a file, or the whole case is vacuous.
        (root / "features" / "demo").mkdir(parents=True)
        (root / "features" / "demo" / "DemoScreen.tsx").write_text(
            "export default function S({ l10n }: any) {\n"
            "  return <h1>{l10n.getString('demo-one')}</h1>;\n"
            "}\n"
            "export const two = (l10n: any) => l10n.getString('demo-three');\n",
            encoding="utf-8",
        )
        # Two DIFFERENT keys, so a module mocked in one case cannot remove the
        # key the other two rely on.
        (root / "features" / "demo" / "Mocked.tsx").write_text(
            "export const M = (l10n: any) => l10n.getString('demo-five');\n",
            encoding="utf-8",
        )
        cases = {
            "complete.test.tsx": _stub(["'demo-one': 'One',", "'other-a': 'A',", "'demo-three': 'T',"]),
            "incomplete.test.tsx": _stub(["'demo-one': 'One',", "'other-a': 'A',", "'other-b': 'B',"]),
            # Imports BOTH screens; the one that uses demo-five is vi.mock'd away,
            # so demo-five's absence here is NOT a hole. This is the case the
            # component-wholesale-mock rule exists for.
            # `head` is overridden because _TEST_HEAD is what the mocked row must
            # AVOID: it names DemoScreen, which uses demo-three.
            "mocked.test.tsx": _stub(
                ["'demo-one': 'One',", "'demo-three': 'T',", "'other-b': 'B',"],
                head="import Mocked from './features/demo/Mocked';\n"
                "vi.mock('./features/demo/Mocked', () => ({ default: () => null }));\n",
            ),
        }
        for name, text in cases.items():
            (root / name).write_text(text, encoding="utf-8")
        globals()["UI_SRC"] = root
        globals()["LOCALES"] = root / "locales"
        findings, _read, judged = scan()
    finally:
        globals()["UI_SRC"], globals()["LOCALES"] = saved
        shutil.rmtree(root, ignore_errors=True)
    # Only the incomplete row is judged: the complete one has no missing key and
    # the mocked one has nothing to judge, so a "not judged" row is a PASS here
    # -- demanding 3 would test the counter, not the rule.
    if judged < 1:
        return False
    if not any("incomplete.test.tsx" in f and "demo-three" in f for f in findings):
        return False
    # `in` is a SUBSTRING test, and "complete.test.tsx" sits inside
    # "incomplete.test.tsx" -- this case failed on that alone for four rounds.
    if any(f.startswith("complete.test.tsx:") for f in findings):
        return False
    if any(f.startswith("mocked.test.tsx:") for f in findings):
        return False
    return True


def self_test() -> int:
    bad: list[str] = []
    cases = 0

    cases += 1
    if not detector_still_fires():
        bad.append("the map/use detector no longer classifies the synthetic sources")

    cases += 1
    if not scan_still_judges():
        bad.append("the scanner no longer flags an incomplete map (or flags a complete one)")

    cases += 1
    keys = bundle_keys()
    if len(keys) < 100:
        bad.append("the bundle yielded only %d keys" % len(keys))

    cases += 1
    findings, read, judged = scan()
    if read == 0:
        bad.append("the live scan read 0 test files")
    if judged == 0:
        bad.append("the live scan judged 0 maps -- the empty-population refusal")
    print(
        "SELF-TEST %s (%d cases; the last reads the real tree: %d test files, %d maps judged, %d findings)"
        % ("FAILED" if bad else "OK", cases, read, judged, len(findings))
    )
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    return 0


def _split_finding(line: str) -> tuple[str, str, str]:
    """`file:line  key  used-by who` -> its three fields.

    Split on RUNS of spaces, not on a fixed two-space separator: the columns
    are aligned with padding, so a two-space split produced a ragged list whose
    tail fields were sometimes missing -- an IndexError in --write-baseline, and
    a silently wrong key when it was not.
    """
    parts = [p for p in re.split(r"\s{2,}", line.strip()) if p]
    at = parts[0] if parts else ""
    key = parts[1] if len(parts) > 1 else ""
    used = parts[2] if len(parts) > 2 else ""
    return at, key, used

def _read_baseline() -> list[dict]:
    """The known holes. A missing file is an empty baseline, not a crash."""
    if not BASELINE_PATH.is_file():
        return []
    doc = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    return doc.get("entries", [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    ap.add_argument("--write-baseline", action="store_true", help="regenerate the ratchet baseline")
    ap.add_argument(
        "--allow-growth",
        action="store_true",
        help="permit --write-baseline to bless NEW holes (must be justified in the commit)",
    )
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    if not detector_still_fires() or not scan_still_judges():
        print("DETECTOR WENT DEAF: a known-offending synthetic map was not flagged.", file=sys.stderr)
        return 2

    findings, read, judged = scan()
    if read == 0 or judged == 0:
        print(
            "SCAN READ NOTHING: %d test files, %d maps judged. Refusing to report clean." % (read, judged),
            file=sys.stderr,
        )
        return 2

    if args.write_baseline:
        # A ratchet that one command can reset is not a ratchet. Measured
        # 2026-11-06: deleting a real key turned the gate red (exit 1), then
        # `--write-baseline` exited 0 and the very next run reported the tree
        # clean -- the defect was now 'known'. So this path REFUSES to grow the
        # set. Shrinking is always allowed (a repair should lower the file);
        # ADDING a hole needs --allow-growth, which is a separate, greppable
        # token that a reviewer can see in a diff and object to.
        prior = {(e['at'], e['key']) for e in _read_baseline()}
        seen = {(a, k) for a, k, _ in (_split_finding(l) for l in findings)}
        grown = sorted(seen - prior)
        if grown and not args.allow_growth:
            print('', file=sys.stderr)
            print('REFUSING TO GROW THE BASELINE -- %d new hole(s) would be blessed:' % len(grown), file=sys.stderr)
            for at, key in grown[:20]:
                print('  %s  %s' % (at, key), file=sys.stderr)
            if len(grown) > 20:
                print('  ... and %d more' % (len(grown) - 20), file=sys.stderr)
            print('', file=sys.stderr)
            print('These are NEW defects, not a snapshot to be accepted. Fix them, or', file=sys.stderr)
            print('pass --allow-growth if the growth is genuinely intended.', file=sys.stderr)
            return 1
        entries = []
        for line in findings:
            at, key, used_by = _split_finding(line)
            entries.append({"at": at, "key": key, "used_by": used_by})
        doc = dict(BASELINE_DOC)
        doc["total"] = len(entries)
        doc["entries"] = sorted(entries, key=lambda e: (e["at"], e["key"]))
        BASELINE_PATH.write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print("wrote %s with %d entries" % (BASELINE_PATH.relative_to(REPO), len(entries)))
        return 0

    # RATCHET. Hundreds of maps are incomplete today; a gate that refuses on them all
    # gate nobody wires in. The baseline says which are known, and the two
    # assertions that matter are: nothing NEW appears, and nothing known is left
    # behind once fixed. Both directions are checked so the file can only shrink.
    known = {(e["at"], e["key"]) for e in _read_baseline()}
    current = set()
    for line in findings:
        at, key, _ = _split_finding(line)
        current.add((at, key))
    new_holes = sorted(current - known)
    stale = sorted(known - current)

    if new_holes:
        print("", file=sys.stderr)
        print("A HAND-MAINTAINED l10n MAP GAINED A HOLE:", file=sys.stderr)
        for at, key in new_holes:
            print("  %s  %s" % (at, key), file=sys.stderr)
        print("", file=sys.stderr)
        print("The stub answers getString from that map and falls back to the raw key, so the", file=sys.stderr)
        print("component renders 'some-key' where English copy was expected.", file=sys.stderr)
        print("Copy the value from shared-ui/locales/*.ftl; never infer it from the key name.", file=sys.stderr)
        return 1
    if stale:
        print("", file=sys.stderr)
        print("BASELINE IS STALE -- these holes are gone, so lower the file:", file=sys.stderr)
        for at, key in stale:
            print("  %s  %s" % (at, key), file=sys.stderr)
        print("", file=sys.stderr)
        print("Run: python scripts/check-l10n-test-maps.py --write-baseline", file=sys.stderr)
        return 1

    print(
        "OK: no new l10n map holes (%d test files, %d maps judged, %d known holes)"
        % (read, judged, len(known))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())