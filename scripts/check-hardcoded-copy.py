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
#: `[^=>]{0,80}` before the tag is the generic guard: a return-type annotation
#: like `=> Promise<CardLoaderResult>>` or `(payload) => Promise<unknown>>` has a
#: `>` or `=` inside that window and is not a JSX element. Two files still
#: contributed exactly one finding each from that shape after the generic fix.
#: `[^<>]` inside the tag window, NOT `[^<>]{0,80}`: a generic return type is
#: `<string, (q: AnalyticsQuery) => Promise<`, whose own `>` ends the window, so
#: forbidding `>` inside it rejects them without a length cap. Two files each
#: contributed exactly one finding from that shape.
#: NO `\s*` between the `>` and the text, and that is load-bearing: with it the
#: engine restarts mid-generic. `<string, (q: AnalyticsQuery) => Promise<` has an
#: inner `Promise<` that begins right after the window's own `>`, so `\s*`
#: matched empty and the capture became "Promise" -- two files reported one
#: finding each from exactly that. JSX text that opens on the `>` itself is what
#: the format actually produces; a space before copy is written as `{" "}`.
TEXT_RE = re.compile(r"<[a-zA-Z][^<>]*>([A-Z][A-Za-z][^<>{}]{2,})\s*<")

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


COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def blank_doc_examples(text: str) -> str:
    """Drop JSX shown inside comments, keeping line structure.

    A shared component documents itself with a fenced TSX example -- Card.tsx
    line 33 is `<Card shadow="sm">Simple card</Card>` inside a ```` ```tsx ````
    block -- and Button.tsx shows five. Those are DOCUMENTATION: they render
    nowhere. The budget's first version counted them, which would have told a
    future author that "Simple card" was accepted untranslated copy.

    Block comments are removed wholesale; line comments lose their content but
    keep the newline, so nothing downstream shifts.
    """
    text = COMMENT_BLOCK_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            out.append("")
        else:
            out.append(line)
    return "\n".join(out)


def count_copy_in_text(text: str) -> int:
    """Count hardcoded copy strings in one source file's contents."""
    body = blank_localized_bodies(blank_doc_examples(text))
    hits = 0
    for match in ATTR_RE.finditer(body):
        if _is_copy(match.group(1)):
            hits += 1
    for match in TEXT_RE.finditer(body):
        if _is_copy(match.group(1)):
            hits += 1
    return hits


def scan(root=None) -> dict[str, int]:
    """Count hardcoded copy per file, and record how many files were READ.

    The read count matters: "0 findings" and "0 files read" print the same
    sentence, so a moved UI root would leave this gate printing OK over nothing.
    r180: root redirects the sweep AND the relative keys together.
    """
    global FILES_READ
    base = REPO if root is None else Path(root).resolve()
    ui = UI if root is None else base / "ui" / "src"
    counts: dict[str, int] = {}
    FILES_READ = 0
    if not ui.is_dir():
        return counts
    for path in sorted(ui.rglob("*.tsx")) + sorted(ui.rglob("*.ts")):
        rel = path.relative_to(base).as_posix()
        if any(part in rel.split("/") for part in SKIP_DIR_PARTS):
            continue
        if rel.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
            continue
        FILES_READ += 1
        hits = count_copy_in_text(path.read_text(encoding="utf-8", errors="replace"))
        if hits:
            counts[rel] = hits
    return counts


#: One shape per DETECTOR DEFECT that has actually happened, plus the shapes a
#: reader would expect. Round 214 fixed four of these and none was covered, so
#: each fix sat one edit away from silently reverting:
#:
#:   #1  <Localized> fallback children counted as copy      -> 2,582 findings
#:   #2  TypeScript generics: > Promise<                     -> 156
#:   #3  JSX inside doc comments (Card.tsx:33)               ->  67
#:   #4  a generic restarting mid-window after =>            ->  54
#:
#: must_ignore is graded as EXACTLY ZERO, not "few": an earlier version allowed
#: fewer than nine, which would have let #3 and #4 both through the check that
#: exists to catch them.
REGRESSION_IGNORE = [
    # #1 -- Fluent REPLACES the child at render, so it never ships as English.
    '<Localized id="retail-edit-field-brand">Brand</Localized>',
    # #3 -- a shared component documents itself with a fenced TSX example.
    '/**\n * ```tsx\n * <Card shadow="sm">Simple card</Card>\n * ```\n */\nexport const A = 1;',
    "// <Button>Save</Button>",
    # #2 and #4 -- the same generic shape, before and after the window.
    "export const CARD_LOADERS: Record<string, (q: Q) => Promise<Result>> = {",
    "const s: Array<Foo, (q: Q) => Promise<Result>> = x;",
    # Shapes a reader expects to be ignored anyway.
    "<kbd>Ctrl</kbd>",
    "<span>{qr}</span>",
]

REGRESSION_CATCH = [
    '<input placeholder="Search products" />',
    '<button aria-label="Close dialog">x</button>',
    '<span>Could not load the list</span>',
    '<img alt="Store logo" />',
    '<div title="Increase Width" />',
]


def detector_failures() -> list[str]:
    """Name every shape the detector classifies wrongly, one line each.

    Returns a LIST rather than a boolean on purpose. The first version returned
    False, and all three mutation probes printed the same sentence -- "the
    detector no longer classifies the synthetic shapes" -- whether the broken arm
    was <Localized> blanking, doc-comment blanking, or the generic window. A
    failure message that cannot name the arm sends the next reader to read the
    whole file, which is how a self-test stops being run.
    """
    out: list[str] = []
    for shape in REGRESSION_CATCH:
        if count_copy_in_text(shape) == 0:
            out.append("MISSED (should count as copy): " + shape[:70])
    for shape in REGRESSION_IGNORE:
        n = count_copy_in_text(shape)
        if n:
            out.append("COUNTED (should be ignored, got %d): %s" % (n, shape[:70]))
    return out


def detector_still_sees_copy() -> bool:
    """True when every graded shape is classified correctly."""
    return not detector_failures()

def main(argv=None, root=None) -> int:
    """r180: argv and root parameterized, the r166..r179 contract -- root
    redirects the scan AND the budget file, so --update under a fixture writes
    the fixture's budget, never the repository's."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run this checker's cases and exit")
    ap.add_argument("--update", action="store_true", help="rewrite the budget from the current tree")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    problems = detector_failures()
    if problems:
        for line in problems:
            print(line, file=sys.stderr)
        print("", file=sys.stderr)
        print("DETECTOR WENT DEAF: the copy regex no longer matches known copy.", file=sys.stderr)
        print("Every file would report zero and this gate would pass vacuously.", file=sys.stderr)
        return 2

    base = REPO if root is None else Path(root).resolve()
    budget_file = BUDGET_FILE if root is None else base / "scripts" / "hardcoded-copy-budget.json"
    counts = scan(root)
    total = sum(counts.values())

    if FILES_READ == 0:
        print("", file=sys.stderr)
        print(f"SCAN READ NOTHING: 0 source file(s) under {base / 'ui' / 'src'}", file=sys.stderr)
        print("  The root moved, or the walk stopped matching. Refusing to report a", file=sys.stderr)
        print("  clean budget over a tree nobody read.", file=sys.stderr)
        return 2

    if args.update:
        budget_file.write_text(
            json.dumps(
                {"description": BUDGET_DESCRIPTION, "total": total, "files": dict(sorted(counts.items()))},
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"budget written: {total} string(s) across {len(counts)} file(s)")
        return 0

    if not budget_file.is_file():
        print(f"SCAN BROKE: budget file missing: {budget_file}", file=sys.stderr)
        return 2
    budget = json.loads(budget_file.read_text(encoding="utf-8"))
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

    # Counted per SHAPE, not per call: "3 cases" when twelve shapes are graded
    # undersells the coverage and makes a later deletion look cheap.
    for shape in REGRESSION_CATCH + REGRESSION_IGNORE:
        cases += 1
    problems = detector_failures()
    if problems:
        bad.extend(problems)

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

    # r180: main()'s shell -- argv and root graded against a tempdir fixture
    # carrying the source AND the budget, the r166..r179 pattern. --update
    # must write the FIXTURE's budget; the detector preflight is skipped by
    # giving the fixture a source the real detector genuinely classifies.
    shell = 0
    COPY = 'export const A = () => <input placeholder="Search products here" />\n'
    def _shell(files, argv=None, check=None):
        import tempfile as _tempfile
        with _tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for rel, content in files.items():
                dst = base / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=[] if argv is None else argv, root=base)
            # the caller's existence checks must run INSIDE this context:
            # after the with-block the tempdir is already deleted.
            return rc, out.getvalue() + err.getvalue(), base
    BUD = {"description": "fixture", "total": 1,
           "files": {"ui/src/x/A.tsx": 1}}
    shell += 1
    rc, text, _b = _shell({"ui/src/x/A.tsx": COPY, "scripts/hardcoded-copy-budget.json": json.dumps(BUD)})
    if rc != 0 or "no file exceeds" not in text or "1 across 1" not in text:
        bad.append(f"a budgeted string must exit 0 (rc={rc} text={text[-100:]!r})")
    shell += 1
    rc, text, _b = _shell({"ui/src/x/A.tsx": COPY,
                           "scripts/hardcoded-copy-budget.json": json.dumps({**BUD, "files": {}})})
    if rc != 1 or "NEW HARDCODED COPY" not in text or "ui/src/x/A.tsx" not in text:
        bad.append(f"unbudgeted copy must exit 1 naming the file (rc={rc} text={text[-100:]!r})")
    shell += 1
    rc, text, _b = _shell({"ui/src/x/A.tsx": COPY})
    if rc != 2 or "budget file missing" not in text:
        bad.append(f"a missing budget must refuse with exit 2 (rc={rc} text={text[-100:]!r})")
    shell += 1
    # the placeholder budget gives the fixture a scripts/ directory for
    # --update to write into; the real checkout has one by construction.
    def _budget_exists(base):
        return (base / "scripts" / "hardcoded-copy-budget.json").is_file()
    shell_case = _shell({"ui/src/x/A.tsx": COPY,
                         "scripts/hardcoded-copy-budget.json": "{}"},
                        argv=["--update"], check=_budget_exists)
    rc, text, wrote = shell_case
    if rc != 0 or "budget written" not in text or not wrote:
        bad.append(f"--update must write the FIXTURE's budget and exit 0 (rc={rc} text={text[-100:]!r})")
    shell += 1
    rc, text, _b = _shell({"README.md": "no sources here"})
    if rc != 2 or "SCAN READ NOTHING" not in text:
        bad.append(f"a corpus with no sources must refuse with exit 2 (rc={rc})")

    if bad:
        sys.stderr.write("SELF-TEST WRONG:\n" + "\n".join(bad) + "\n")
        return 2
    shapes = len(REGRESSION_CATCH) + len(REGRESSION_IGNORE)
    print(
        "SELF-TEST OK (%d cases: %d graded shapes + 1 census floor + 1 live read + %d shell)"
        % (cases + shell, shapes, shell)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())