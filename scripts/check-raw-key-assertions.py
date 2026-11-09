#!/usr/bin/env python3
"""Refuse a test that asserts on a translation KEY where the user sees copy.\n\nWHY THIS EXISTS\n---------------\nA vitest file that mounts a component and then matches on its own Fluent message\nid is asserting that the UI displays `topology-branch-delete`. It only passes\nbecause the l10n stub falls back to the key (`map[id] ?? id`) or because nothing\nsupplies real copy at that point. Either way the assertion describes the DEFECT\nrather than the behaviour, and it keeps passing after the copy is wrong.\n\nFound by hand three times before this gate existed:\n  * nodeTopologyEditorWarehouseAndCanvas.test.tsx had\n      expect(title?.textContent).toContain('topology-wire-label-fallback')\n    under a comment reading "raw key in the identity-l10n mock" -- the bug\n    written down as intent.\n  * nodeTopologyEditorCore.test.tsx matched `/topology-toast-save-error/`.\n  * TopologyScreen.test.tsx matched 37 keys; its stub map holds 5 unrelated\n    entries, so every one of those returned the raw id.\n\nWHAT COUNTS (and what deliberately does not)\n--------------------------------------------\nA finding needs ALL of:\n  1. a matcher -- getByText / getByRole / getByLabelText / queryByText /\n     findByText / toContain and friends;\n  2. an argument that is a string literal naming a key DEFINED in\n     shared-ui/locales/*.ftl (so an arbitrary hyphenated string is not a\n     finding, and neither is a key nobody ships);\n  3. a file where real copy COULD render: it mounts LocalizationProvider, or its\n     stub falls back onto the id (`?? id` / `|| key` / ...). A file whose stub\n     always returns a fixed string cannot produce this bug.\n\nPoint 3 is what keeps the population honest: measured 2026-11-06, 186 matchers in\nui/src name a real bundle key, but only 81 of them sit in a file that could\nrender copy the key would replace. The other 105 are tests whose l10n is absent\nor constant and which therefore assert the key legitimately.

STATUS 2026-11-07: the census is EMPTY. Every known site was converted, so this
gate now enforces ZERO rather than a shrinking ceiling, and one new raw-key
assertion fails the build.

How they went: DashboardScreen 7 (its inline FTL block omitted the filter keys
while a comment claimed they "only exist in id locale" -- false, they are in
reports.ftl), the three topology suites 35, TopologyRevisionBrowser 5, three
singletons, plus 6 more the tightening exposed. Two routes dominated: seeding the
file's stub map from the FTL, and -- for topological node cards -- discovering
that topologyUiString() resolves through TOPOLOGY_UI_FALLBACKS with a NON-EMPTY
default, so those labels never came from the stub at all.

Two sites were deliberately NOT converted. Five assertions in
TopologyScreen.test.tsx compare the message of a TopologyApplyValidationError,
which is built as l10n.getString(messageId) where messageId is ALREADY a key --
the thrown string genuinely IS the id, and converting them was measured red. And
one queryByText(...).toBeNull() on a key was DELETED rather than converted: once
the stub maps the key it matches nothing, so it asserted no fact; the line above
it, which checks the copy is gone, is the real check.\n\nRatcheted against scripts/raw-key-assertions-baseline.json -- a CENSUS, not a\ncount of live bugs. An entry is a known outstanding site; the file may only\nshrink, and --write-baseline refuses to grow it without --allow-growth.\n\nUsage, from the repo root:\n    python scripts/check-raw-key-assertions.py\n    python scripts/check-raw-key-assertions.py --self-test\n    python scripts/check-raw-key-assertions.py --write-baseline [--allow-growth]\n"""
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


def bundle_keys(locales=None) -> set[str]:
    """Every message id defined in the English bundles. r192: the bundle
    directory follows the contract root."""
    locales = LOCALES if locales is None else Path(locales).resolve()
    keys: set[str] = set()
    for f in sorted(locales.glob("*.ftl")):
        if f.name.endswith(".id.ftl"):
            continue
        keys.update(FTL_KEY_RE.findall(f.read_text(encoding="utf-8", errors="replace")))
    return keys


def scan(root=None) -> tuple[list[str], int, int]:
    """Findings, test files read, files where the bug is possible at all.

    r192: the corpus and the bundles follow the contract root together --
    ui/src, shared-ui/locales, and every reported relative path.
    """
    base = REPO if root is None else Path(root).resolve()
    ui_src = base / "ui" / "src"
    locales = base / "shared-ui" / "locales"
    keys = bundle_keys(locales)
    if not keys:
        raise SystemExit(f"SCAN BROKE: no keys in {locales}")
    findings: list[str] = []
    read = 0
    eligible = 0
    tests = sorted(
        p for p in ui_src.rglob("*")
        if p.is_file() and (p.name.endswith(".test.ts") or p.name.endswith(".test.tsx"))
    )
    for test in tests:
        read += 1
        text = test.read_text(encoding="utf-8", errors="replace")
        if not RENDERABLE_RE.search(text):
            continue
        eligible += 1
        rel = test.relative_to(base).as_posix() if test.is_relative_to(base) else test.name
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


def _read_baseline(base=None) -> list[dict]:
    """r192: the ratchet file follows the contract root."""
    path = BASELINE_PATH if base is None else Path(base).resolve() / "scripts" / BASELINE_PATH.name
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("entries", [])


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

    # r192: the synthetic tree nests under the contract root -- ui/src and
    # shared-ui/locales -- and scan() is called WITH the root, so the old
    # globals-repointing dance (UI_SRC/LOCALES reassigned and restored) is gone.
    root = Path(tempfile.mkdtemp(prefix="rawkey-selftest-"))
    try:
        (root / "shared-ui" / "locales").mkdir(parents=True)
        (root / "ui" / "src").mkdir(parents=True)
        (root / "shared-ui" / "locales" / "demo.ftl").write_text(
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
            (root / "ui" / "src" / name).write_text(text + chr(10), encoding="utf-8")
        findings, read, eligible = scan(root=root)
    finally:
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

    # r192: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r191 pattern, as a five-step ladder over one tree: a new site
    # fails, --write-baseline records it, the re-run passes the ratchet, a
    # removal leaves the file stale, and a corpus with nothing refuses rc 2.
    # The new-site and empty-corpus cases kill a root-dropping main: the real
    # tree scans 828 files clean, so the finding never appears (rc 0) and the
    # refusal never fires (rc 0).
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    def _shell(tree, extra=()):
        with _tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in tree.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            (base / "scripts").mkdir(exist_ok=True)
            argv = ["--write-baseline"] if "write" in extra else []
            if "growth" in extra:
                argv.append("--allow-growth")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=argv, root=base)
            return rc, out.getvalue() + err.getvalue()
    FTL = "demo-alpha = Alpha" + chr(10) + "demo-beta = Beta" + chr(10)
    BADTX = ("const l10n = { getString: (id) => map[id] ?? id };" + chr(10)
             + "expect(screen.getByText(" + chr(39) + "demo-alpha" + chr(39)
             + ")).toBeInTheDocument();")
    shell += 1
    rc, text = _shell({"shared-ui/locales/demo.ftl": FTL, "ui/src/bad.test.tsx": BADTX})
    if rc != 1 or "A TEST NOW ASSERTS A TRANSLATION KEY" not in text or "bad.test.tsx" not in text:
        print("  x a new raw-key site must fail rc 1 (rc=%r text=%r)" % (rc, text[-90:]),
              file=sys.stderr)
        return 1
    shell += 1
    # from an EMPTY baseline, writing is growth -- --allow-growth is part of the
    # graded contract, not a workaround
    rc, text = _shell({"shared-ui/locales/demo.ftl": FTL, "ui/src/bad.test.tsx": BADTX},
                      extra=("write", "growth"))
    if rc != 0 or "with 1 entries" not in text:
        print("  x --write-baseline must record the site rc 0 (rc=%r text=%r)" % (rc, text[-90:]),
              file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"shared-ui/locales/demo.ftl": FTL, "ui/src/bad.test.tsx": BADTX,
                       "scripts/raw-key-assertions-baseline.json":
                           '{"entries": [{"at": "ui/src/bad.test.tsx:2", "key": "demo-alpha"}]}'})
    if rc != 0 or "1 known site(s)" not in text:
        print("  x a recorded site must pass the ratchet rc 0 (rc=%r text=%r)" % (rc, text[-90:]),
              file=sys.stderr)
        return 1
    shell += 1
    # the stale rung still needs a READABLE corpus -- and one with NO new site,
    # because the new-site check outranks stale: the file stays but asserts
    # literal copy now, so current is empty and the recorded site is stale
    BADTX2 = ("const l10n = { getString: (id) => map[id] ?? id };" + chr(10)
              + "expect(screen.getByText(" + chr(39) + "Alpha" + chr(39)
              + ")).toBeInTheDocument();")
    rc, text = _shell({"shared-ui/locales/demo.ftl": FTL, "ui/src/bad.test.tsx": BADTX2,
                       "scripts/raw-key-assertions-baseline.json":
                           '{"entries": [{"at": "ui/src/bad.test.tsx:2", "key": "demo-alpha"}]}'})
    if rc != 1 or "BASELINE IS STALE" not in text:
        print("  x a removed site must make the baseline stale rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    rc, text = _shell({"shared-ui/locales/demo.ftl": FTL})
    if rc != 2 or "SCAN READ NOTHING" not in text:
        print("  x a corpus with no test files must refuse rc 2 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    print(
        "SELF-TEST %s (%d cases + %d shell cases; live: %d test files, %d renderable, %d finding(s))"
        % ("OK" if not bad else "FAILED", cases, shell, read_live, eligible_live, len(live))
    )
    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    return 0


def main(argv=None, root=None) -> int:
    """r192: argv and root parameterized, the r166..r191 contract -- root
    redirects the test corpus, the bundles, and the ratchet file together."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--allow-growth", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    base = REPO if root is None else Path(root).resolve()

    findings, read, eligible = scan(root)
    if read == 0 or eligible == 0:
        print(
            "SCAN READ NOTHING: %d files, %d renderable. Refusing to report clean."
            % (read, eligible),
            file=sys.stderr,
        )
        return 2

    current = {_split(f) for f in findings}

    if args.write_baseline:
        prior = {(_split_entry(e)) for e in _read_baseline(base)}
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
        baseline_path = base / "scripts" / BASELINE_PATH.name
        baseline_path.write_text(
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print("wrote %s with %d entries" % (baseline_path.relative_to(base), len(current)))
        return 0

    known = {(_split_entry(e)) for e in _read_baseline(base)}
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
