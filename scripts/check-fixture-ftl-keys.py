#!/usr/bin/env python3
"""Grade test FIXTURES for Fluent keys that do not exist in any bundle.

WHY THIS EXISTS
---------------
A test that stubs `l10n.getString` with a map body usually ends the stub with
`defaults[id] ?? id`, so a key the map invents still returns a string and the
case stays green. The fixture therefore cannot notice its own mistakes, and a
renamed or never-written bundle key survives indefinitely inside a suite that
looks like it covers the copy.

Found for real, 2026-10-27 (round 38): three keys were defined in fixtures and
existed in NO bundle and in NO production file --

    settings-tax-id-pattern-error   GeneralSection.test.tsx
    staff-login-error-not-found     StaffLoginScreen.rateLimit.test.tsx
    staff-login-error-deactivated   (same file)

The first is a near-miss for `settings-tax-id-pattern-hint`, which is the key
the code actually reads (useStoreDraft.ts:138). The other two describe
"user not found" and "account deactivated" -- error copy the login screen
deliberately does NOT have: STAFF-06 answers every pre-auth probe uniformly so
the screen cannot be used to enumerate usernames, and a per-reason message is
exactly what that rule forbids. The fixtures were carrying copy for a design
the product had rejected.

WHAT IT ASSERTS
---------------
A key defined as a quoted `"some-key": "text"` entry inside a test file that
stubs `getString` must be EITHER declared in shared-ui/locales/*.ftl OR
mentioned somewhere in production ui/src. Anything else is a fixture ghost.

The second arm matters: some suites stub keys whose text production builds
programmatically, and those are legitimate. The check is for keys that exist
NOWHERE.

THE SECOND ARM: CIRCULAR ERROR MOCKS
------------------------------------
A fixture key that DOES resolve can still make its case unfalsifiable, in a way
this file's first version missed. Four suites (AnalyticsCardContent and the
three chart widgets) did:

    vi.mock('@/utils/app-error', () => ({ l10nErrorMessage: () => 'An error occurred' }));
    expect(screen.getByText('An error occurred')).toBeInTheDocument();

The mock supplies the string the assertion then looks for, so the REAL
l10nErrorMessage -- and therefore the whole FTL lookup -- never runs. Measured
proof that the case could not fail: replacing the mock's literal with
'A totally different message' AND its assertion to match still passed 7/7. All
four are now mock-free and assert the bundle copy verbatim (confirmed by
mutating the fixture value alone: 1 case reddens). This check flags the shape
so it cannot come back.

WHAT IT DOES NOT CLAIM
----------------------
It cannot catch a fixture whose VALUE drifts from the real bundle while the
key still exists -- that would need the bundle parsed and compared per case,
and 116 such drifts were measured while writing this. It only looks at
quoted-object entries, not FTL-shaped template strings. Those limits are why it
is a ghost-hunter, not a copy verifier.

Also out of scope: a suite that mocks app-error to pass the FALLBACK through
(`(e, _l, f) => f`). That shape is legitimate -- it exercises which key the
caller asked for -- and the regex deliberately does not flag it (pinned by a
self-test case).

EXIT CODES
    0  no ghost key
    1  at least one ghost key
    2  the scan broke (no bundles found, no test files found)

Usage, from the repo root:

    python scripts/check-fixture-ftl-keys.py
    python scripts/check-fixture-ftl-keys.py --self-test
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_SRC = REPO / "ui" / "src"
LOCALES = REPO / "shared-ui" / "locales"

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root() -> str | None:
    """The temp root this file's fixtures are written under (None = system default)."""
    import os
    return next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)


def _base(root: Path | str | None) -> Path:
    """The tree every scan reads. r237: root is a PARAMETER, not a rebinding --
    the three walkers below take it so a fixture grades itself."""
    return REPO if root is None else Path(root).resolve()


FTL_KEY_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9_-]*)\s*=")
# MULTILINE only makes ^ match at line starts; a quoted entry that is not
# first on its line (measured r237: "{ 'ghost-key': 'text' }" inside an object
# literal) is still an entry, so leading whitespace includes [ { and , --
# the characters a key can legitimately follow on a builder line.
FIXTURE_ENTRY_RE = re.compile(
    r"^[\s[{,]*'([a-z][a-z0-9-]*[a-z0-9])'\s*:\s*'", re.M)


def bundle_keys(root: Path | str | None = None) -> set[str]:
    """Every key declared across shared-ui/locales/*.ftl under `root`."""
    keys: set[str] = set()
    for path in (_base(root) / "shared-ui" / "locales").glob("*.ftl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            match = FTL_KEY_RE.match(line)
            if match:
                keys.add(match.group(1))
    return keys


def production_blob(root: Path | str | None = None) -> str:
    """All non-test ui/src source under `root`, concatenated (keys may be built
    at runtime)."""
    parts: list[str] = []
    src = _base(root) / "ui" / "src"
    if not src.is_dir():
        return ""
    for path in src.rglob("*.ts*"):
        if "__tests__" in path.parts:
            continue
        parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts)


def fixture_entries(path: Path) -> list[str]:
    """Quoted "some-key": "text" entries in a test that stubs getString."""
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "getString" not in text:
        return []
    return [m.group(1) for m in FIXTURE_ENTRY_RE.finditer(text)]


def ghosts(root: Path | str | None = None) -> tuple[list[tuple[str, str]], int]:
    """Return ([(key, file)], files_scanned) for the tree under `root`."""
    base = _base(root)
    keys = bundle_keys(base)
    blob = production_blob(base)
    found: list[tuple[str, str]] = []
    scanned = 0
    src = base / "ui" / "src"
    if not src.is_dir():
        return found, 0
    for path in src.rglob("*.test.ts*"):
        entries = fixture_entries(path)
        if not entries:
            continue
        scanned += 1
        for key in entries:
            if key in keys or key in blob:
                continue
            found.append((key, path.relative_to(base).as_posix()))
    return sorted(set(found)), scanned


CIRCULAR_MOCK_RE = re.compile(
    r"vi\.mock\('@/utils/app-error',\s*\(\)\s*=>\s*\(\{([^}]*)\}", re.S
)
CIRCULAR_LITERAL_RE = re.compile(r"l10nErrorMessage:\s*\([^)]*\)\s*=>\s*'([^']+)'")


def circular_error_mocks(root: Path | str | None = None) -> list[tuple[str, str]]:
    """Return [(file, literal)] where a suite mocks app-error to return the copy it asserts.

    Round 38 found four of these (AnalyticsCardContent plus the three chart
    widgets): the mock was `l10nErrorMessage: () => 'An error occurred'` and the
    case then asserted `getByText('An error occurred')`. Measured proof that the
    case could not fail: replacing the mock's string with
    'A totally different message' AND its assertion to match still passed 7/7 --
    it was testing its own stub. The real `l10nErrorMessage` never ran, so a
    change to the shipped copy would not have been noticed by any of them.
    """
    base = _base(root)
    found: list[tuple[str, str]] = []
    src = base / "ui" / "src"
    if not src.is_dir():
        return found
    for path in src.rglob("*.test.ts*"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        mock = CIRCULAR_MOCK_RE.search(text)
        if not mock:
            continue
        literal = CIRCULAR_LITERAL_RE.search(mock.group(1))
        if not literal:
            continue
        value = literal.group(1)
        if text.count(value) > 1:
            found.append((path.relative_to(base).as_posix(), value))
    return found


SELF_TEST_CASES = [
    # (label, ftl, production, fixture, expected_ghost)
    ("key in bundle", "a = x", "", "'a': 'x',", False),
    ("key in production only", "", "getString('b')", "'b': 'x',", True),
    ("key nowhere", "", "", "'c': 'x',", True),
    ("camel/localStorage key ignored", "", "", "'oz-cache': 'x',", True),
]


def self_test() -> int:
    """Exercise the three decision arms without touching the tree."""
    failures = 0
    # arm 1: the bundle parse produced a plausible key set. Asserting a SPECIFIC
    # key name here was the first version's bug -- it tested whether the letter
    # "a" happened to be a key, which is luck, not a contract.
    keys = bundle_keys()
    if len(keys) < 1000:
        print(f"  FAIL bundle parse produced only {len(keys)} key(s) from {LOCALES}")
        failures += 1
    else:
        print(f"  ok   the bundle parses ({len(keys)} keys)")
    # arm 2: the production blob is non-empty (a broken read would make every
    # fixture key look like a ghost, which is the failure mode that matters).
    if len(production_blob()) < 1000:
        print("  FAIL production blob is unreasonably small -- the read broke")
        failures += 1
    else:
        print("  ok   production source readable")
    # arm 3: the entry regex matches the shape it claims to.
    sample = "          'settings-tax-id-pattern-hint': 'Enter a valid tax ID',"
    match = FIXTURE_ENTRY_RE.search(sample)
    if not match or match.group(1) != "settings-tax-id-pattern-hint":
        print("  FAIL fixture entry regex does not match a real fixture line")
        failures += 1
    else:
        print("  ok   fixture entry regex matches a real line")
    # arm 4: the circular-mock regex matches the shape it claims to, and does
    # NOT match a mock that merely passes the fallback through.
    circular_sample = "vi.mock('@/utils/app-error', () => ({\n  l10nErrorMessage: () => 'An error occurred',\n}));"
    pass_sample = "vi.mock('@/utils/app-error', () => ({\n  l10nErrorMessage: (e: unknown, _l: unknown, f: string) => f,\n}));"
    if not CIRCULAR_LITERAL_RE.search(CIRCULAR_MOCK_RE.search(circular_sample).group(1)):
        print("  FAIL circular-mock regex misses the circular shape")
        failures += 1
    elif CIRCULAR_LITERAL_RE.search(CIRCULAR_MOCK_RE.search(pass_sample).group(1)):
        print("  FAIL circular-mock regex flags a pass-through mock")
        failures += 1
    else:
        print("  ok   circular-mock regex separates the two shapes")
    total = 4
    print(f"self-test: {total - failures}/{total} checks pass")
    if failures:
        return 1
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r237 -- the r228 lesson).

    Rung 6 drives --self-test through argv from INSIDE the ladder, and the
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
    """r237: the root contract, graded on fixture trees through main().

    Rung 1 IS the killing rung, and it is the GHOST arm: a fixture whose test
    stubs a key that exists in no bundle and no production file must exit 1
    naming it. A main() that ignored its root would grade this checkout --
    measured clean at 40 fixture files this round -- and print "clean", so the
    fixture is the only way to see the finding.

    Rung 2 is the SECOND arm, which no root-contract rung had carried before:
    the circular app-error mock. It is a distinct detector with its own
    module-level regexes and its own report, and it now has to prove it reads
    the fixture rather than the tree.
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
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
        return base

    FTL = "real-key = Real copy\n"
    # The stub must contain the literal "getString" -- that is the gate's own
    # condition for a file to be in scope, and a fixture that omits it would
    # prove nothing (r237 measured exactly that: rung 1 first failed with
    # "no getString-stubbing test found", the refusal arm, not the ghost arm).
    # The entry placeholder must satisfy FIXTURE_ENTRY_RE, which requires a
    # key of two or more characters: a one-letter placeholder made the fixture
    # carry no entries at all and hit the refusal arm instead (measured r237).
    # The entry sits on its own line, as the real fixtures write it
    # (check-fixture-ftl-keys.py's own self-test sample:
    # "          'settings-tax-id-pattern-hint': 'Enter a valid tax ID',").
    # A one-line object literal does NOT match FIXTURE_ENTRY_RE -- measured r237,
    # and that measurement is why this fixture is shaped like production.
    STUB = ("const l10n = {\n"
            "  getString: (id, args) => ({\n"
            "    'KEY': 'text',\n"
            "  })[id] ?? id,\n"
            "};\n")
    GHOST_SUITE = STUB.replace("KEY", "ghost-key")
    GOOD_SUITE = STUB.replace("KEY", "real-key")

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: a ghost key in the FIXTURE is reported.
        root = build(tmp, {"shared-ui/locales/en.ftl": FTL,
                           "ui/src/__tests__/A.test.tsx": GHOST_SUITE})
        rc, said = run(root)
        if rc != 1 or "ghost-key" not in said:
            print("  x rung 1: a fixture ghost key must exit 1 naming it "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the second arm: a circular mock is reported from the fixture.
        circular = ("vi.mock('@/utils/app-error', () => ({\n"
                    "  l10nErrorMessage: () => 'An error occurred',\n"
                    "}));\nconst m = 'An error occurred';\n"
                    + GOOD_SUITE)
        root = build(tmp, {"shared-ui/locales/en.ftl": FTL,
                           "ui/src/__tests__/B.test.tsx": circular})
        rc, said = run(root)
        if rc != 1 or "circular app-error mock" not in said:
            print("  x rung 2: a circular mock must exit 1 naming it "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- a resolving key greens, with the fixture's own scan count.
        root = build(tmp, {"shared-ui/locales/en.ftl": FTL,
                           "ui/src/__tests__/C.test.tsx": GOOD_SUITE})
        rc, said = run(root)
        if rc != 0 or "clean - 1 fixture file(s)" not in said:
            print("  x rung 3: a resolving key must exit 0 counting one file "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- the refusal floor: no bundles under the fixture root.
        root = build(tmp, {"ui/src/__tests__/C.test.tsx": GOOD_SUITE})
        rc, said = run(root)
        if rc != 2 or "no bundle keys read" not in said:
            print("  x rung 4: a fixture without bundles must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- the other refusal: bundles but no getString stub.
        root = build(tmp, {"shared-ui/locales/en.ftl": FTL,
                           "ui/src/__tests__/D.test.tsx": "const x = 1;\n"})
        rc, said = run(root)
        if rc != 2 or "no getString-stubbing test found" not in said:
            print("  x rung 5: a fixture with no stubbing test must refuse rc 2 "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 6 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, {"shared-ui/locales/en.ftl": FTL,
                           "ui/src/__tests__/C.test.tsx": GOOD_SUITE})
        rc, said = run(root, "--self-test")
        if rc != 0 or "self-test:" not in said or "ladder re-entry" not in said:
            print("  x rung 6: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("FIXTURE-FTL-KEYS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


def main(argv: list[str] | None = None, root: Path | str | None = None) -> int:
    """r237: root is the r166 contract -- a fixture tree can be graded from code.
    Every walker takes it, so nothing here re-binds a module global."""
    parser = argparse.ArgumentParser(description="Fixtures must not invent Fluent keys.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    if not bundle_keys(root):
        print("check-fixture-ftl-keys: BROKEN - no bundle keys read", file=sys.stderr)
        return 2

    found, scanned = ghosts(root)
    if scanned == 0:
        print("check-fixture-ftl-keys: BROKEN - no getString-stubbing test found", file=sys.stderr)
        return 2

    circular = circular_error_mocks(root)
    if circular:
        print(f"check-fixture-ftl-keys: {len(circular)} circular app-error mock(s):", file=sys.stderr)
        for path, literal in circular:
            print(f"  {path}  asserts {literal!r} that its own mock returns", file=sys.stderr)
        print("", file=sys.stderr)
        print("That case cannot fail: the mock supplies the string the assertion then", file=sys.stderr)
        print("looks for, so the real l10nErrorMessage never runs. Drop the mock and", file=sys.stderr)
        print("assert the bundle copy (or a structural role=alert) instead.", file=sys.stderr)
        return 1

    if found:
        print(f"check-fixture-ftl-keys: {len(found)} ghost key(s) in {scanned} fixture file(s):", file=sys.stderr)
        for key, path in found:
            print(f"  {key}  <- {path}", file=sys.stderr)
        print("", file=sys.stderr)
        print("A fixture key that exists in no bundle and no production file cannot", file=sys.stderr)
        print("fail: the stub falls back to the id. Rename it to the real key, or", file=sys.stderr)
        print("delete it if the copy it describes does not exist by design.", file=sys.stderr)
        return 1

    print(f"check-fixture-ftl-keys: clean - {scanned} fixture file(s), every stubbed key resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
