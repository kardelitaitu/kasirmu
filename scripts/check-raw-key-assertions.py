#!/usr/bin/env python3
"""Refuse a test that asserts on a translation KEY where the user sees copy.\n\nWHY THIS EXISTS\n---------------\nA vitest file that mounts a component and then matches on its own Fluent message\nid is asserting that the UI displays `topology-branch-delete`. It only passes\nbecause the l10n stub falls back to the key (`map[id] ?? id`) or because nothing\nsupplies real copy at that point. Either way the assertion describes the DEFECT\nrather than the behaviour, and it keeps passing after the copy is wrong.\n\nFound by hand three times before this gate existed:\n  * nodeTopologyEditorWarehouseAndCanvas.test.tsx had\n      expect(title?.textContent).toContain('topology-wire-label-fallback')\n    under a comment reading "raw key in the identity-l10n mock" -- the bug\n    written down as intent.\n  * nodeTopologyEditorCore.test.tsx matched `/topology-toast-save-error/`.\n  * TopologyScreen.test.tsx matched 37 keys; its stub map holds 5 unrelated\n    entries, so every one of those returned the raw id.\n\nWHAT COUNTS (and what deliberately does not)\n--------------------------------------------\nA finding needs ALL of:\n  1. a matcher -- getByText / getByRole / getByLabelText / queryByText /\n     findByText / toContain and friends;\n  2. an argument that is a string literal naming a key DEFINED in\n     shared-ui/locales/*.ftl (so an arbitrary hyphenated string is not a\n     finding, and neither is a key nobody ships);\n  3. a file where real copy COULD render: it mounts LocalizationProvider, or its\n     stub falls back onto the id (`?? id` / `|| key` / ...). A file whose stub\n     always returns a fixed string cannot produce this bug.\n\nPoint 3 is what keeps the population honest: measured 2026-11-06, 186 matchers in\nui/src name a real bundle key, but only 81 of them sit in a file that could\nrender copy the key would replace. The other 105 are tests whose l10n is absent\nor constant and which therefore assert the key legitimately.\n\nRatcheted against scripts/raw-key-assertions-baseline.json -- a CENSUS, not a\ncount of live bugs. An entry is a known outstanding site; the file may only\nshrink, and --write-baseline refuses to grow it without --allow-growth.\n\nUsage, from the repo root:\n    python scripts/check-raw-key-assertions.py\n    python scripts/check-raw-key-assertions.py --self-test\n    python scripts/check-raw-key-assertions.py --write-baseline [--allow-growth]\n"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_SRC = REPO / "ui" / "src"
LOCALES = REPO / "shared-ui" / "locales"
BASELINE_PATH = REPO / "scripts" / "raw-key-assertions-baseline.json"

#: Test matchers that take the text/name a user would see.
MATCHER_RE = re.compile(
    r"\b(?:toContain|toHaveTextContent|getByText|queryByText|findByText|"
    r"getAllByText|getByRole|queryByRole|findByRole|getByLabelText|"
    r"queryByLabelText|getByPlaceholderText)\s*\("
)

#: A quoted key-shaped literal.
KEY_LITERAL_RE = re.compile(r"""['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"]""")

#: A stub that can answer with the key itself, or a provider that supplies copy.
RENDERABLE_RE = re.compile(
    r"LocalizationProvider|\?\?\s*(?:id|key)\b|"
    r"\|\|\s*(?:id|key)\b"
)

#: A message id at the start of an FTL definition.
FTL_KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\s*=", re.M)


def bundle_keys() -> set[str]:
    """Every message id defined in the English bundles."""
    keys: set[str] = set()
    for f in sorted(LOCALES.glob("*.ftl")):
        if f.name.endswith(".id.ftl"):
            continue
        keys.update(FTL_KEY_RE.findall(f.read_text(encoding="utf-8", errors="replace")))
    return keys


def scan() -> tuple[list[str], int, int]:
    """Findings, test files read, files where the bug is possible at all."""
    keys = bundle_keys()
    if not keys:
        raise SystemExit(f"SCAN BROKE: no keys in {LOCALES}")
    findings: list[str] = []
    read = 0
    eligible = 0
    tests = sorted(
        p for p in UI_SRC.rglob("*")
        if p.is_file() and (p.name.endswith(".test.ts") or p.name.endswith(".test.tsx"))
    )
    for test in tests:
        read += 1
        text = test.read_text(encoding="utf-8", errors="replace")
        if not RENDERABLE_RE.search(text):
            continue
        eligible += 1
        rel = test.relative_to(REPO).as_posix() if test.is_relative_to(REPO) else test.name
        for lineno, line in enumerate(text.split(chr(10)), 1):
            # A COMMENT is not an assertion. The scanner is line-based, so an
            # explanatory note that spells out toContain('some-key') -- exactly the
            # note a repair leaves behind -- was reported as a live site. Four
            # already-converted assertions were still "known" for this reason.
            stripped = line.lstrip()
            if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                continue
            # Which matcher owns THIS literal? Take the last one that opens before
            # the key, not merely any matcher on the line. `getByTestId('kds-tab-open')
            # .textContent).toContain('1')` puts a toContain on the same line as a
            # TEST-ID lookup, and reading the toContain as the owner turned a
            # legitimate data-testid into a reported raw-key assertion.
            for m in KEY_LITERAL_RE.finditer(line):
                key = m.group(1)
                if key not in keys:
                    continue
                owner = None
                for mm in MATCHER_RE.finditer(line):
                    if mm.start() < m.start():
                        owner = mm.group(0)
                    else:
                        break
                if owner is None:
                    continue
                findings.append("%s:%d  %s" % (rel, lineno, key))
    return findings, read, eligible


def _read_baseline() -> list[dict]:
    if not BASELINE_PATH.is_file():
        return []
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get("entries", [])


def _split(line: str) -> tuple[str, str]:
    parts = [p for p in re.split(r"\s{2,}", line.strip()) if p]
    return (parts[0], parts[1]) if len(parts) > 1 else (parts[0] if parts else "", "")


def self_test() -> int:
    """Prove the detector both fires and stays quiet, then grade the live tree."""
    bad: list[str] = []
    cases = 0

    cases += 1
    keys = bundle_keys()
    if len(keys) < 100:
        bad.append("the bundle yielded only %d keys" % len(keys))

    # A synthetic tree: one file that must be flagged, three that must not.
    import shutil
    import tempfile

    root = Path(tempfile.mkdtemp(prefix="rawkey-selftest-"))
    saved = (globals()["UI_SRC"], globals()["LOCALES"])
    try:
        (root / "locales").mkdir()
        (root / "locales" / "demo.ftl").write_text(
            "demo-alpha = Alpha" + chr(10) + "demo-beta = Beta" + chr(10), encoding="utf-8"
        )
        stub = "const l10n = { getString: (id) => map[id] ?? id };" + chr(10)
        q = chr(39)
        def wrap(text):
            return ("expect(screen.getByText(" + q + text + q + ")).toBeInTheDocument();")
        cases_src = {
            "bad.test.tsx": wrap("demo-alpha"),
            "copy.test.tsx": wrap("Alpha"),
            "notakey.test.tsx": wrap("some-hyphenated-thing"),
            "noprovider.test.tsx": (
                "const l10n = { getString: (id) => " + q + "fixed" + q + " };"
                + chr(10)
                + wrap("demo-beta")
            ),
        }
        for name, body in cases_src.items():
            # noprovider carries its OWN stub: prepending the raw-id one would make
            # it renderable and turn its must-not-flag case into a false alarm.
            text = body if name == "noprovider.test.tsx" else (stub + body)
            (root / name).write_text(text + chr(10), encoding="utf-8")
        globals()["UI_SRC"] = root
        globals()["LOCALES"] = root / "locales"
        findings, read, eligible = scan()
    finally:
        globals()["UI_SRC"], globals()["LOCALES"] = saved
        shutil.rmtree(root, ignore_errors=True)

    cases += 1
    if read != 4:
        bad.append("the scanner read %d of 4 synthetic files" % read)
    if eligible != 3:
        bad.append("eligible-scope is %d, expected 3" % eligible)
    if not any("bad.test.tsx" in f and "demo-alpha" in f for f in findings):
        bad.append("a raw-key matcher in a renderable file was NOT flagged")
    for quiet in ("copy.test.tsx", "noprovider.test.tsx", "notakey.test.tsx"):
        if any(quiet in f for f in findings):
            bad.append("%s was flagged but must not be" % quiet)

    cases += 1
    live, read_live, eligible_live = scan()
    if read_live == 0:
        bad.append("the live scan read 0 test files")
    if eligible_live == 0:
        bad.append("the live scan found 0 renderable files -- the empty-population refusal")

    print(
        "SELF-TEST %s (%d cases; live: %d test files, %d renderable, %d finding(s))"
        % ("OK" if not bad else "FAILED", cases, read_live, eligible_live, len(live))
    )
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--allow-growth", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    findings, read, eligible = scan()
    if read == 0 or eligible == 0:
        print(
            "SCAN READ NOTHING: %d files, %d renderable. Refusing to report clean."
            % (read, eligible),
            file=sys.stderr,
        )
        return 2

    current = {_split(f) for f in findings}

    if args.write_baseline:
        prior = {(_split_entry(e)) for e in _read_baseline()}
        grown = sorted(current - prior)
        if grown and not args.allow_growth:
            print("", file=sys.stderr)
            print("REFUSING TO GROW THE BASELINE -- %d new site(s):" % len(grown), file=sys.stderr)
            for at, key in grown[:20]:
                print("  %s  %s" % (at, key), file=sys.stderr)
            print("Pass --allow-growth only if the growth is genuinely intended.", file=sys.stderr)
            return 1
        doc = {
            "description": (
                "Outstanding test assertions that name a real Fluent message id where real copy "
                "could render. Ratcheted by scripts/check-raw-key-assertions.py; the file may only "
                "shrink. Each entry asserts that the UI shows its own translation key."
            ),
            "total": len(current),
            "entries": [{"at": a, "key": k} for a, k in sorted(current)],
        }
        BASELINE_PATH.write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print("wrote %s with %d entries" % (BASELINE_PATH.relative_to(REPO), len(current)))
        return 0

    known = {(_split_entry(e)) for e in _read_baseline()}
    # ZERO is the target state, not a ratchet against a ceiling. The sweep on
    # 2026-11-07 converted every site, so the baseline is empty; if it ever stops
    # being empty, this gate should say so loudly rather than quietly allow it.
    if known:
        print(
            "NOTE: %d known raw-key site(s) remain -- the target is zero." % len(known),
        )
    new = sorted(current - known)
    stale = sorted(known - current)
    if new:
        print("", file=sys.stderr)
        print("A TEST NOW ASSERTS A TRANSLATION KEY:", file=sys.stderr)
        for at, key in new:
            print("  %s  %s" % (at, key), file=sys.stderr)
        print("Match the English copy from shared-ui/locales/*.ftl instead.", file=sys.stderr)
        return 1
    if stale:
        print("", file=sys.stderr)
        print("BASELINE IS STALE -- these sites are gone, lower the file:", file=sys.stderr)
        for at, key in stale:
            print("  %s  %s" % (at, key), file=sys.stderr)
        print("Run: python scripts/check-raw-key-assertions.py --write-baseline", file=sys.stderr)
        return 1

    print(
        "OK: no new raw-key assertions (%d test files, %d renderable, %d known site(s))"
        % (read, eligible, len(known))
    )
    return 0


def _split_entry(e: dict) -> tuple[str, str]:
    return (e.get("at", ""), e.get("key", ""))


if __name__ == "__main__":
    sys.exit(main())
