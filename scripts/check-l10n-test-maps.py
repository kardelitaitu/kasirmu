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
  * The `error-boundary-` PREFIX. ui/src/components/ErrorBoundary.tsx:12-17
    builds its own FluentBundle and never reads the shared context, so a stub
    map cannot supply those keys and their absence is not a hole. The prefix is
    excluded rather than the two keys, so a third one added there is not a
    finding either.
  * A key used ONLY through a template literal or a dynamic import -- it is
    never collected, so it is never reported.

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

#: Keys whose only reader is ErrorBoundary.tsx's OWN FluentBundle (:12-17).
LOCAL_BUNDLE_PREFIXES = ("error-boundary-",)

#: At most this many lines of prose between two keys, so a trailing comment block
#: does not end the run.
KEY_BLOCK_GAP = 4

RESERVED_WORD_RE = re.compile(r"^\s*(return|if|else)\b")

#: A key line inside a literal: `'topology-new-store': 'New Store',`
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


def _fallback_shape(text: str) -> str:
    """How a miss resolves: back onto the raw id, or not at all."""
    for m in re.finditer(r"\[id\]\s*(?:\?\?|\|\|)\s*([^;\n,)]+)", text):
        if m.group(1).strip() in ("id", "key", "k"):
            return m.group(0)
        return ""
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
            if hits[run_end + 1][0] - hits[run_end][0] > KEY_BLOCK_GAP + 1:
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
        identity = _identity_attached(lines[first + 1 : min(next_key, first + 9)])
        keys: dict[str, int] = {}
        for idx in range(run_start, run_end + 1):
            line_no, m = hits[idx]
            keys.setdefault(m.group("key"), line_no + 1)
        maps.append(
            {
                "start_line": first + 1,
                "end_line": last + 1,
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
        maps = [m for m in find_maps(body) if m["fallback"]]
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
        for path in modules + nested:
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
        for m in maps:
            judged += 1
            for key, (line, name) in sorted(uses.items()):
                if key in m["keys"]:
                    continue
                findings.append("%s:%d  %s  used-by %s:%d" % (rel, m["start_line"], key, name, line))
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
    # `<Localized>` is resolved by the provider, NOT by the getString stub, so it
    # must not be collected -- collecting it was 67 of the first live run's 175.
    if module_uses('<Localized id="b-three">x</Localized>'):
        return False
    # ...but a getString INSIDE <Localized> does reach the stub.
    if module_uses('<Localized id="b-four" attrs={{ alt: true }}><img alt={l10n.getString("b-five")} /></Localized>') != {
        "b-five": 1
    }:
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
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

    if findings:
        print("", file=sys.stderr)
        print("A HAND-MAINTAINED l10n MAP IS MISSING A KEY ITS COMPONENT USES:", file=sys.stderr)
        for line in findings:
            print("  " + line, file=sys.stderr)
        print("", file=sys.stderr)
        print("The stub answers getString from that map and falls back to the raw key, so the", file=sys.stderr)
        print("component renders 'some-key' where English copy was expected: either the test", file=sys.stderr)
        print("fails on text nobody spelled out, or it passes while the UI is unlabelled.", file=sys.stderr)
        print("Copy the value from shared-ui/locales/*.ftl; never infer it from the key name.", file=sys.stderr)
        return 1

    print("OK: every hand-maintained l10n map covers what its imports use (%d test files, %d maps)" % (read, judged))
    return 0


if __name__ == "__main__":
    sys.exit(main())
