#!/usr/bin/env python3
"""Generate docs/src/SUMMARY.md for the kasir.mu documentation portal.

The sidebar is built from the canonical folders, so dropping a .md file into
`docs/` or `docs/decisions/` makes it appear in the portal on the next build:

  - docs/guides/*.md      -> Guides section  (copied to docs/src/guides/ by build-docs)
  - docs/decisions/*.md   -> ADR section     (copied to docs/src/decisions/ by build-docs)
  - docs/src/api/rust/    -> Rust section    (rustdoc output)
  - docs/src/api/ts/      -> TypeScript section (TypeDoc output)

docs/archived/ is deliberately absent: it holds superseded material kept for
provenance, not guidance to publish.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SRC = DOCS / "src"

# Words that should stay uppercase in generated titles.
ACRONYMS = {"API", "ADR", "UI", "UX", "POS", "KDS", "ML", "VPS", "CRDT", "RBAC", "E2E", "CSS", "DB", "CI"}


def prettify(stem: str) -> str:
    """Turn a filename into a human-readable title."""
    name = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
    name = re.sub(r"^adr\d+-", "", name)
    name = re.sub(r"\d{4}-\d{2}-\d{2}", "", name)  # strip embedded dates
    words = [
        w.upper() if w.upper() in ACRONYMS else w.capitalize()
        for w in name.replace("_", " ").replace("-", " ").split()
    ]
    return " ".join(words) or stem


def chapter(name: str, title: str, folder: str) -> str:
    """Chapter link as resolved from docs/src/ (where the copies land)."""
    return f"- [{title}]({folder}/{name})"


def guides() -> list[str]:
    """Every markdown file under docs/guides/, sorted by title.

    Not docs/archived/. Listing that tree published 26 superseded documents
    as current guidance while the 22 live guides in docs/guides/ never
    appeared at all — the glob and the directory had drifted apart. And not
    docs/README.md, which is a directory index whose relative links resolve
    on disk but break inside the book; docs/src/intro.md covers that job.
    """
    return [
        chapter(p.name, prettify(p.stem), "guides")
        for p in sorted(
            (DOCS / "guides").glob("*.md"),
            key=lambda p: prettify(p.stem).lower(),
        )
    ]


def decisions() -> list[str]:
    """Every ADR in docs/decisions/, kept in date order, README first."""
    entries = []
    readme = DOCS / "decisions" / "README.md"
    if readme.exists():
        entries.append(chapter(readme.name, "ADR Index", "decisions"))
    for p in sorted((DOCS / "decisions").glob("*.md")):
        if p.name == "README.md":
            continue
        entries.append(chapter(p.name, prettify(p.stem), "decisions"))
    return entries


def archived_decisions() -> list[str]:
    """Superseded ADRs kept under docs/decisions/archived/ for provenance."""
    archived = DOCS / "decisions" / "archived"
    if not archived.is_dir():
        return []
    return [
        chapter(p.name, prettify(p.stem), "decisions/archived")
        for p in sorted(archived.glob("*.md"))
    ]


def releases() -> list[str]:
    """Release checklists and process docs under docs/releases/."""
    rel = DOCS / "releases"
    if not rel.is_dir():
        return []
    return [
        chapter(p.name, prettify(p.stem), "releases")
        for p in sorted(rel.glob("*.md"))
    ]


def operations() -> list[str]:
    """Operational runbooks and deployment guides under docs/operations/."""
    ops = DOCS / "operations"
    if not ops.is_dir():
        return []
    return [
        chapter(p.name, prettify(p.stem), "operations")
        for p in sorted(ops.glob("*.md"))
    ]


def rust_crates() -> list[str]:
    """Crate names from the copied rustdoc crates.js (workspace doc index)."""
    js = SRC / "api" / "rust" / "crates.js"
    if not js.exists():
        return []
    m = re.search(r"window\.ALL_CRATES\s*=\s*(\[[^\]]*\])", js.read_text(encoding="utf-8"))
    return json.loads(m.group(1)) if m else []


def ensure_api_landing(folder: str, title: str, what: str, links: list[str]) -> None:
    """Guarantee an index.html for a generated API section.

    cargo doc on a rootless workspace emits per-crate pages plus crates.js but
    no root index; the build script's copy step would otherwise leave the
    section without a landing page (or with a bare stub).
    """
    idx = SRC / "api" / folder / "index.html"
    if idx.exists() and idx.stat().st_size >= 64:
        return  # real generator output (rustdoc workspace index / typedoc) — keep it
    idx.parent.mkdir(parents=True, exist_ok=True)
    items = "\n".join(f'<li><a href="{l}">{l.rstrip("/")}</a></li>' for l in links)
    idx.write_text(
        f"<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\">"
        f"<title>{title}</title>\n<style>body{{font-family:system-ui,sans-serif;margin:0;padding:48px;"
        f"max-width:760px;line-height:1.6}}h1{{font-size:28px}}</style></head>\n<body>\n"
        f"<h1>{title}</h1>\n<p>{what}</p>\n<ul>{items}</ul>\n</body>\n</html>\n",
        encoding="utf-8",
    )
    print(f"Wrote API landing {idx}")


def build() -> str:
    lines = [
        "# Summary",
        "",
        "[Introduction](intro.md)",
        "",
        "# Docs",
        *guides(),
        "",
        "---",
        "",
        *decisions(),
    ]
    arch = archived_decisions()
    if arch:
        lines += ["", "## Archived", *arch]
    lines += [
        "",
        "---",
        "",
        "# Releases",
        *releases(),
        "",
        "---",
        "",
        "# Operations",
        *operations(),
        "",
        "---",
        "",
        "# Rust",
        "- [API Reference](api/rust/index.html)",
        "",
        "# TypeScript",
        "- [API Reference](api/ts/index.html)",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    out = SRC / "SUMMARY.md"
    out.write_text(build(), encoding="utf-8")
    print(f"Wrote {out}: {len(guides())} guides, {len(decisions())} ADRs, {len(archived_decisions())} archived, {len(releases())} releases, {len(operations())} ops")

    crates = rust_crates()
    ensure_api_landing(
        "rust",
        "Rust API Reference",
        "API reference for the Rust workspace crates, generated by cargo doc.",
        [f"{c}/index.html" for c in crates],
    )
    ensure_api_landing(
        "ts",
        "TypeScript API Reference",
        "API reference for the frontend, generated by TypeDoc from ui/src (api, types, hooks).",
        [],
    )


if __name__ == "__main__":
    main()
