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


def main() -> int:
    en, idl = slugs("en"), slugs("id")
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
    sys.exit(main())