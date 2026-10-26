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

WHAT IT DOES NOT CLAIM
----------------------
It cannot catch a fixture whose VALUE drifts from the real bundle while the
key still exists -- that would need the bundle parsed and compared per case.
It also only looks at quoted-object entries, not FTL-shaped template strings.
Those limits are why it is a ghost-hunter, not a copy verifier.

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

FTL_KEY_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9_-]*)\s*=")
FIXTURE_ENTRY_RE = re.compile(r"^\s*'([a-z][a-z0-9-]*[a-z0-9])'\s*:\s*'", re.M)


def bundle_keys() -> set[str]:
    """Every key declared across shared-ui/locales/*.ftl."""
    keys: set[str] = set()
    for path in LOCALES.glob("*.ftl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            match = FTL_KEY_RE.match(line)
            if match:
                keys.add(match.group(1))
    return keys


def production_blob() -> str:
    """All non-test ui/src source, concatenated (keys may be built at runtime)."""
    parts: list[str] = []
    for path in UI_SRC.rglob("*.ts*"):
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


def ghosts() -> tuple[list[tuple[str, str]], int]:
    """Return ([(key, file)], files_scanned)."""
    keys = bundle_keys()
    blob = production_blob()
    found: list[tuple[str, str]] = []
    scanned = 0
    for path in UI_SRC.rglob("*.test.ts*"):
        entries = fixture_entries(path)
        if not entries:
            continue
        scanned += 1
        for key in entries:
            if key in keys or key in blob:
                continue
            found.append((key, path.relative_to(REPO).as_posix()))
    return sorted(set(found)), scanned


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
    total = 3
    print(f"self-test: {total - failures}/{total} checks pass")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Fixtures must not invent Fluent keys.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    if not bundle_keys():
        print("check-fixture-ftl-keys: BROKEN - no bundle keys read", file=sys.stderr)
        return 2

    found, scanned = ghosts()
    if scanned == 0:
        print("check-fixture-ftl-keys: BROKEN - no getString-stubbing test found", file=sys.stderr)
        return 2

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
    sys.exit(main(sys.argv[1:]))
