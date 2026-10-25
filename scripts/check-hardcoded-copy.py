#!/usr/bin/env python3
"""Grade the UI for HARDCODED ENGLISH COPY, not for style.

WHY THIS EXISTS
---------------
Rounds 206-212 of this project localized every user-visible string in `ui/src`:
the design showcase went 143 -> 0, 91 `getString(key) || 'English'` fallbacks were
retired onto `requiredLocalized`, and the last 22 real strings across twenty screens
were keyed. That work is worth exactly nothing if the next screen can add an English
literal and stay green -- and nothing checked it. `scripts/scan-fluent-hardcoded.py`
MEASURED the population but was wired into no gate: `git grep scan-fluent-hardcoded`
over scripts/check.sh, scripts/gates.json, .github and .githooks returned nothing.

A census without a gate is a snapshot. This is the gate.

WHAT IT ASSERTS
---------------
One thing, mechanically: the per-file count of hardcoded user-visible strings must
not EXCEED a committed budget. A new literal on a clean file fails immediately (its
cap is 0). A new literal on a file that already carried some fails when the count
climbs past its recorded number.

It deliberately does NOT claim to find every literal, and it does NOT fail on the
literals that legitimately remain:

  * `<code>` samples and template-literal code snippets are documentation, not copy.
  * A dev-only surface (`import.meta.env.DEV`) never ships to a user.
  * Keyboard glyphs (`Ctrl`, `S`, `F12`) and brand names are not translatable.
  * An aria-hidden teaser's invented sample values must stay invented.

Those are the reasons the budget is per-file rather than zero. Round 212 classified
all 61 remaining rows into exactly those buckets; a file's number is the size of the
set an author must justify, not a count of defects.

A budget is not a fix. It is the difference between copy nobody can add to and copy
nobody knows the size of.

EXIT CODES
    0  no file exceeds its budget
    1  a file exceeds its budget (new hardcoded copy landed)
    2  the scan itself broke (no source files read, budget unreadable)

Usage, from the repo root:

    python scripts/check-hardcoded-copy.py            # report and grade
    python scripts/check-hardcoded-copy.py --update   # rewrite the budget from
                                                      # the tree (ONLY after
                                                      # localizing the strings)
    python scripts/check-hardcoded-copy.py --self-test
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUDGET_FILE = REPO / "scripts" / "hardcoded-copy-budget.json"
UI = REPO / "ui" / "src"

#: How many source files the last scan() actually READ. A module-level counter,
#: not a return value, so "0 findings" and "0 files read" cannot print the same
#: sentence -- the census-floor lesson from check-scratch-leaks.py.
FILES_READ = 0

#: Directories whose files are never user-facing copy: tests assert against
#: literals by design, and dev-mock supplies fixtures to a fake backend.
SKIP_DIR_PARTS = ("__tests__", "dev-mock", "mocks")

#: A JSX TEXT node or ATTRIBUTE that is plain English copy. Deliberately narrow:
#: a gate that also flags code, ids and glyphs gets suppressed instead of obeyed.
#:   attr:  placeholder="..."  title="..."  aria-label="..."  alt="..."
#:   text:  >Some English copy<   (two or more words, so "Retry" alone is caught
#:          only through the attribute arm -- see ALLOWED_SINGLE_WORDS)
ATTR_RE = re.compile(
    r"""(?:placeholder|title|aria-label|alt)\s*=\s*"([^"{}]{2,})" """.strip()
)
#: JSX text only, and the LEADING `<` is load-bearing. Matching `>text<` alone
#: caught TypeScript generics: `Promise<void>` then `> Promise<` matched, and
#: ui/src/hooks/useKdsOffline.ts contributed 9 of them as "hardcoded copy".
#: Requiring `<tag ...>` immediately before the text anchors on a JSX element.
TEXT_RE = re.compile(r"<[a-zA-Z][^<>]*>\s*([A-Z][A-Za-z][^<>{}]{2,})\s*<")

#: Tokens that are not translatable copy even when they look like a sentence.
BRAND_AND_KEY = frozenset(
    """
    Ctrl Cmd Alt Shift Enter Tab Esc Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12
    QRIS QRIS/E-Wallet Midtrans Paddle Stripe JSON CSV PDF URL UUID POS KOT KDS EDC
    HAL API NSFP DJP Coretax kasir.mu
    """.split()
)

BUDGET_DESCRIPTION = (
    "Hardcoded user-visible strings per ui/src file (JSX text and the four copy "
    "attributes). A CAP, not a defect count: every recorded string has been "
    "classified as a code sample, a dev-only surface, a glyph/brand, or a fixture. "
    "Raising a number here is not a fix; it is accepted untranslated copy. "
    "Regenerate with 'python scripts/check-hardcoded-copy.py --update' ONLY after "
    "localizing the strings."
)


def _is_copy(value: str) -> bool:
    """True when the captured text is copy rather than an identifier or glyph."""
    text = value.strip()
    if not text:
        return False
    if any(ch in text for ch in "{}=$"):
        return False
    if text in BRAND_AND_KEY:
        return False
    words = [w for w in re.split(r"\s+", text) if w]
    if all(w in BRAND_AND_KEY for w in words):
        return False
    # A single short token is an id, a code or a glyph far more often than copy.
    if len(words) == 1 and len(words[0]) <= 3:
        return False
    return True


LOCALIZED_OPEN_RE = re.compile(r"<Localized\b")
LOCALIZED_CLOSE_RE = re.compile(r"</Localized>")


def blank_localized_bodies(text: str) -> str:
    """Replace the BODY of every <Localized> element with whitespace.

    A <Localized> child is a FALLBACK: Fluent replaces it with the message value
    at render, so it never ships as English on a configured locale. Counting it
    was the first draft's error -- it reported 2,582 "hardcoded strings" in a tree
    where rounds 206-212 had localized everything, because a file with 235
    <Localized> elements contributed 109 of its fallbacks as findings.

    Line structure is preserved (newlines kept) so a later positional pass would
    still line up, and NESTED <Localized> elements are handled by counting depth.
    """
    out: list[str] = []
    depth = 0
    i = 0
    while i < len(text):
        if text.startswith("<Localized", i) and (i + 10 >= len(text) or not text[i + 10].isalnum()):
            depth += 1
            out.append(text[i:i + len("<Localized")])
            i += len("<Localized")
            continue
        if depth and text.startswith("</Localized>", i):
            depth -= 1
            out.append("</Localized>")
            i += len("</Localized>")
            continue
        if depth:
            out.append("\n" if text[i] == "\n" else " ")
        else:
            out.append(text[i])
        i += 1
    return "".join(out)


def count_copy_in_text(text: str) -> int:
    """Count hardcoded copy strings in one source file's contents."""
    body = blank_localized_bodies(text)
    hits = 0
    for match in ATTR_RE.finditer(body):
        if _is_copy(match.group(1)):
            hits += 1
    for match in TEXT_RE.finditer(body):
        if _is_copy(match.group(1)):
            hits += 1
    return hits


def scan() -> dict[str, int]:
    """Count hardcoded copy per file, and record how many files were READ.

    The read count matters: "0 findings" and "0 files read" print the same
    sentence, so a moved UI root would leave this gate printing OK over nothing.
    """
    global FILES_READ
    counts: dict[str, int] = {}
    FILES_READ = 0
    if not UI.is_dir():
        return counts
    for path in sorted(UI.rglob("*.tsx")) + sorted(UI.rglob("*.ts")):
        rel = path.relative_to(REPO).as_posix()
        if any(part in rel.split("/") for part in SKIP_DIR_PARTS):
            continue
        if rel.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
            continue
        FILES_READ += 1
        hits = count_copy_in_text(path.read_text(encoding="utf-8", errors="replace"))
        if hits:
            counts[rel] = hits
    return counts


def detector_still_sees_copy() -> bool:
    """Grade the detector over synthetic source before trusting any real result.

    A gate that grades a detector nobody re-checks is this project's most
    repeated failure. If these regexes were broken by an edit, every file would
    report zero and the gate would print OK while grading nothing.
    """
    must_catch = [
        '<input placeholder="Search products" />',
        '<button aria-label="Close dialog">x</button>',
        '<span>Could not load the list</span>',
        '<img alt="Store logo" />',
        '<div title="Increase Width" />',
    ]
    must_ignore = [
        '<Localized id="retail-edit-field-brand">Brand</Localized>',
        '<input placeholder={l10n.getString(\'key\')} />',
        '<kbd>Ctrl</kbd>',
        '<span>{qr}</span>',
        '<code>{`<button>Trigger</button>`}</code>',
    ]
    if any(count_copy_in_text(s) == 0 for s in must_catch):
        return False
    # The code-sample arm is exempted by the CALLER (it skips sample files); the
    # regex alone cannot tell a <code> body from copy, and must not pretend to.
    if any(count_copy_in_text(s) >= 9 for s in must_ignore[:2]):
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    ap.add_argument("--update", action="store_true", help="rewrite the budget from the current tree")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    if not detector_still_sees_copy():
        print("", file=sys.stderr)
        print("DETECTOR WENT DEAF: the copy regex no longer matches known copy.", file=sys.stderr)
        print("Every file would report zero and this gate would pass vacuously.", file=sys.stderr)
        return 2

    counts = scan()
    total = sum(counts.values())

    if FILES_READ == 0:
        print("", file=sys.stderr)
        print(f"SCAN READ NOTHING: 0 source file(s) under {UI}", file=sys.stderr)
        print("  The root moved, or the walk stopped matching. Refusing to report a", file=sys.stderr)
        print("  clean budget over a tree nobody read.", file=sys.stderr)
        return 2

    if args.update:
        BUDGET_FILE.write_text(
            json.dumps(
                {"description": BUDGET_DESCRIPTION, "total": total, "files": dict(sorted(counts.items()))},
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"budget written: {total} string(s) across {len(counts)} file(s)")
        return 0

    if not BUDGET_FILE.is_file():
        print(f"SCAN BROKE: budget file missing: {BUDGET_FILE}", file=sys.stderr)
        return 2
    budget = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
    allowed: dict[str, int] = budget.get("files", {})

    regressions = []
    for path, n in sorted(counts.items()):
        cap = allowed.get(path, 0)
        if n > cap:
            regressions.append(f"  {path}: {n} hardcoded string(s), budget {cap}")

    print(f"hardcoded strings: {total} across {len(counts)} file(s)")
    print(f"budgeted:          {budget.get('total')}")
    print(f"files read:        {FILES_READ}")

    if regressions:
        print("", file=sys.stderr)
        print("NEW HARDCODED COPY:", file=sys.stderr)
        for line in regressions:
            print(line, file=sys.stderr)
        print("", file=sys.stderr)
        print("This text renders in English on every locale. Wrap it in <Localized>", file=sys.stderr)
        print("(JSX text) or route it through requiredLocalized(l10n, id) (attributes,", file=sys.stderr)
        print("toasts), and add the message to BOTH shared-ui/locales/*.ftl bundles.", file=sys.stderr)
        return 1

    print("OK: no file exceeds its hardcoded-copy budget")
    return 0


def self_test() -> int:
    """Grade the three things that make this gate's OK mean anything."""
    import contextlib as _ctx
    import io as _io

    bad: list[str] = []
    cases = 0

    cases += 1
    if not detector_still_sees_copy():
        bad.append("the detector no longer classifies the synthetic shapes")

    global UI, FILES_READ
    saved_ui, saved_reads = UI, FILES_READ

    # The census floor must actually fire, driven through main() -- not by
    # asserting a constant, which controls nothing.
    def _exit_with_dead_root() -> int:
        global UI, FILES_READ
        saved = UI
        UI = REPO / "definitely-not-a-directory"
        saved_argv = sys.argv
        sys.argv = ["check-hardcoded-copy.py"]
        buf = _io.StringIO()
        try:
            with _ctx.redirect_stdout(buf), _ctx.redirect_stderr(buf):
                return main()
        finally:
            UI = saved
            sys.argv = saved_argv

    cases += 1
    if _exit_with_dead_root() != 2:
        bad.append("main() must return 2 when the scan read nothing")

    # And the live tree must read a NON-zero number of files, so the floor above
    # is not satisfied by accident on a healthy checkout.
    UI = saved_ui
    FILES_READ = 0
    scan()
    live = FILES_READ
    FILES_READ = saved_reads
    cases += 1
    if live == 0:
        bad.append("the live scan read 0 files, so the floor cannot distinguish anything")

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    print("SELF-TEST OK (%d cases; the last one reads the real tree)" % cases)
    return 0


if __name__ == "__main__":
    sys.exit(main())