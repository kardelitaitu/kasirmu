#!/usr/bin/env python3
"""en/id parity checker for website/src/content/docs.

Fails (exit 1) when a page exists in one locale but not the other.
Warns (exit still 0) on heading-count mismatch and `updated` divergence —
legitimate translation variance, but worth a human glance.

Run: python3 scripts/check-doc-parity.py   (from website/)
Exit codes: 0 = parity OK (warnings allowed), 1 = missing counterpart.
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "src", "content", "docs")


def slugs(locale: str) -> set:
    return {
        os.path.basename(p)[:-3]
        for p in glob.glob(os.path.join(DOCS, locale, "*.md"))
    }


def frontmatter(path: str, key: str) -> str:
    with open(path, encoding="utf8") as fh:
        m = re.search(rf"^{key}:\s*(.+)$", fh.read(), re.M)
    return m.group(1).strip().strip('"') if m else ""


def headings(path: str) -> int:
    with open(path, encoding="utf8") as fh:
        return len(re.findall(r"^## ", fh.read(), re.M))


# The fewest pages a real locale directory can hold. The site ships 20 per locale; the
# floor is set well below that so ordinary growth or pruning never trips it. It exists to
# catch a ZERO, which is what a renamed or moved content directory produces.
MIN_PAGES_PER_LOCALE = 5


def census_problem(en: set, idl: set) -> str:
    """Why this census cannot describe the real site, or '' when it can.

    **The module docstring says parity "fails when a page exists in one locale but not the
    other", and that is true only of the SET DIFFERENCE.** Empty sets subtract to empty, so
    a docs root that moved produces the cheerful "OK: 0 page pairs in parity" success line
    and exit 0. Measured 2026-10-23 by pointing DOCS at a non-existent directory: exactly
    that, rc 0.

    Same shape as verify-architecture-boundaries.py's census floor, and worth having for
    the same reason: a gate whose whole answer is a set difference cannot tell "the sets
    agree" from "there were no sets".
    """
    for locale, found in (("en", en), ("id", idl)):
        if len(found) < MIN_PAGES_PER_LOCALE:
            return (
                f"only {len(found)} page(s) found under {locale}/; a real locale has at "
                f"least {MIN_PAGES_PER_LOCALE}. A parity result over an empty set is not a "
                "parity result -- check that the docs directory still exists and is spelled "
                "the same"
            )
    return ""


def self_test() -> int:
    """Pin the census floor, which is the half a green line cannot show.

    Every case asserts a VERDICT, not a count, because the defect this guards against is
    a verdict: "0 pairs in parity" reads as success. Run with `--self-test`; touches no
    file.
    """
    cases: list[str] = []

    def want(name: str, got, expect) -> None:
        if got != expect:
            cases.append(f"{name}: expected {expect!r}, got {got!r}")

    want("a real census passes", census_problem(set(range(20)), set(range(20))), "")

    # The empty root: both globs return nothing, which is what a rename produces.
    empty = census_problem(set(), set())
    want("an empty census is refused", empty != "", True)
    want("the refusal names the locale", "under en/" in empty, True)

    # One side empty, the other populated. The SET DIFFERENCE would catch this too, but
    # asserting it here pins that the floor does not mask a real one-sided deletion.
    one_sided = census_problem(set(range(20)), set())
    want("a one-sided census is refused", one_sided != "", True)
    want("the one-sided refusal names id/", "under id/" in one_sided, True)

    # Must not fire on a small but real site: 5 is far below the measured 20.
    want("a small but real site passes",
         census_problem(set(range(5)), set(range(5))), "")

    # And the boundary itself: 4 is below the floor, 5 is at it.
    want("four pages is still refused",
         census_problem(set(range(4)), set(range(4))) != "", True)

    if cases:
        print("SELF-TEST WRONG: " + "; ".join(cases), file=sys.stderr)
        return 2
    print("SELF-TEST OK (6 cases, no files touched)")
    return 0


def main() -> int:
    en, idl = slugs("en"), slugs("id")
    problem = census_problem(en, idl)
    if problem:
        print(f"FAIL: {problem}")
        return 1
    missing_id = sorted(en - idl)
    missing_en = sorted(idl - en)
    failed = False

    for slug in missing_id:
        print(f"FAIL: en/{slug}.md has no id/ counterpart")
        failed = True
    for slug in missing_en:
        print(f"FAIL: id/{slug}.md has no en/ counterpart")
        failed = True

    for slug in sorted(en & idl):
        en_path = os.path.join(DOCS, "en", f"{slug}.md")
        id_path = os.path.join(DOCS, "id", f"{slug}.md")
        h_en, h_id = headings(en_path), headings(id_path)
        if h_en != h_id:
            print(f"WARN: {slug}: heading count en={h_en} id={h_id}")
        d_en, d_id = frontmatter(en_path, "updated"), frontmatter(id_path, "updated")
        if d_en != d_id:
            print(f"WARN: {slug}: updated differs en={d_en} id={d_id}")

    if failed:
        return 1
    print(f"OK: {len(en & idl)} page pairs in parity.")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(main())