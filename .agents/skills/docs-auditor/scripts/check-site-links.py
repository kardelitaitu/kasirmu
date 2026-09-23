#!/usr/bin/env python3
"""check-site-links.py -- site-aware link checker for website/ (routes, not paths).

The 2026-09-23 documentation audit recorded that website/src/content docs link each
other with Astro ROUTES -- `../cloud-sync/`, `../../pricing/`, `/en/docs/user-roles/` --
and a filesystem scanner cries wolf on ~90 of them while being unable to see a ghost
slug either way (audit open item 4; check-dead-refs.py keeps its website/ exemption
and points here). This checker resolves links the way the deployed site does.

Route table (what `astro build` would actually serve):
  * locales parsed from website/astro.config.mjs i18n (`locales: [...]`) -- the same
    source Astro uses; unparseable = fatal, never a guess;
  * every file under src/pages/, one extension stripped, `index` collapsed, `[locale]`
    expanded over the config's locales (build.format is Astro's default `directory`,
    so page URLs end with `/`);
  * the docs catch-all `src/pages/[locale]/docs/[...slug].astro` is NOT enumerated from
    its pattern -- it emits one page per content file, so routes come from
    src/content/docs/{locale}/*.md as `/{locale}/docs/{slug}` (a link to a ghost slug
    is red even though the catch-all file exists);
  * legal docs are rendered by src/pages/[locale]/legal/{name}.astro -- a legal file
    with no consuming page is a finding (its route base cannot be derived);
  * files under public/ (and their parent directories), plus source paths declared in
    public/_redirects (Cloudflare Pages: a redirected URL resolves at deploy time).

Link extraction (markdown content only):
  * inline links/images `[text](target)`; fenced code (``` / ~~~) and inline backtick
    spans are skipped, so the authoring guide's EXAMPLE of a link is not a claim;
  * skipped, never resolved: http(s), protocol-relative //, mailto:/tel:, javascript:/
    data:, and targets that are only `#fragment` or `?query`;
  * fragments/queries are stripped before resolution -- `../activation/#heading`
    checks the page, not the heading (same stance as check-dead-refs: section
    anchors are NOT checked);
  * an empty target `]()` is a finding: it renders as a link that goes nowhere.

Resolution: a target starting with `/` is matched against the route table directly;
anything else resolves against the source document's own URL in directory form
(docs page `/{loc}/docs/{slug}/` + `../x/` = `/{loc}/docs/x/`), the way a browser
resolves a trailing-slash page. Collection -> base URL:
  docs   -> `/{locale}/docs/{slug}/`      (matches [...slug].astro's params)
  legal  -> `/{locale}/legal/{name}/`      (matches the consuming page)
  other  -> finding, links cannot be resolved without a route mapping.

Fail-loud contract (cannot-verify is not agreement -- each of these exits 1 rather
than reporting a clean run): website/ or its astro.config.mjs missing; `locales: [...]`
unparseable; src/pages/[locale]/docs/[...slug].astro renamed or gone; a dynamic
segment other than `[locale]` anywhere in pages/ (unenumerable); src/content/ missing.
A content file whose locale is not one of the config's locales, or which sits in an
unmapped collection, is a per-file finding (those files are never rendered).

KNOWN LIMITATIONS (stated, not hidden):
  * heading fragments are not validated (see above);
  * .astro/.tsx component hrefs are not extracted -- this checks markdown content;
    reference-style links `[x][y]` are not extracted either (none exist in the corpus);
  * external URLs are not fetched (that is curl's job, not a gate's);
  * website/*.md OUTSIDE src/content/ (e.g. website/README.md) stays in
    check-dead-refs' path-literal domain -- site routes only exist for content pages.

--self-test builds a synthetic website tree in a temporary directory (the house rule:
a self-test never edits the tree) and asserts green and deliberately-red cases,
including run()'s exit codes on both. See KNOWN LIMITATIONS above before trusting
a clean run.

Exit: 0 clean, 1 dead site links or an unbuildable route contract, 2 self-failure.
"""

from __future__ import annotations

import argparse
import os
import posixpath
import re
import sys
import tempfile
from pathlib import Path

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]*)\)")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
INLINE_CODE_RE = re.compile(r"`[^`]*`")
SKIP_TARGET_RE = re.compile(r"^(?:https?:|mailto:|tel:|javascript:|data:|//)")
LOCALES_RE = re.compile(r"locales\s*:\s*\[([^\]]*)\]")
PAGE_SUFFIXES = {".astro", ".ts", ".tsx", ".js", ".jsx", ".html", ".md", ".mdx"}
CONTENT_DOC_SUFFIXES = (".md", ".mdx")


def _display(path: Path) -> str:
    """Repo-relative when possible (house finding format), absolute otherwise."""
    try:
        return path.resolve().relative_to(Path.cwd()).as_posix()
    except ValueError:
        return path.as_posix()


def _parse_locales(config_text: str) -> list[str] | None:
    """i18n `locales: [...]` from astro.config.mjs -- Astro's own source of truth."""
    m = LOCALES_RE.search(config_text)
    if not m:
        return None
    values = re.findall(r"['\"]([^'\"]+)['\"]", m.group(1))
    return values or None


def _build_routes(site: Path, locales: list[str]) -> tuple[set[str], list[str]]:
    """Enumerate what the built site serves. Returns (routes, fatals)."""
    routes: set[str] = set()
    fatals: list[str] = []
    pages = site / "src" / "pages"

    docs_page = pages / "[locale]" / "docs" / "[...slug].astro"
    if not docs_page.is_file():
        fatals.append(
            "route contract broken: src/pages/[locale]/docs/[...slug].astro not found -- "
            "the docs routes this checker enumerates from content now come from somewhere "
            "else; update check-site-links.py before trusting it"
        )

    for p in sorted(pages.rglob("*")):
        if p.is_dir() or p.suffix.lower() not in PAGE_SUFFIXES:
            continue
        rel = p.relative_to(pages).as_posix()
        if rel == "[locale]/docs/[...slug].astro":
            continue  # content-driven: enumerated below, not from the pattern
        route_path = rel.rsplit(".", 1)[0]  # strip ONE extension (llms.txt.ts -> llms.txt)
        if route_path == "index":
            route_path = ""
        elif route_path.endswith("/index"):
            route_path = route_path[: -len("index")]
        expanded: list[list[str]] | None = [[]]
        for seg in [s for s in route_path.split("/") if s]:
            if seg == "[locale]":
                expanded = [e + [loc] for e in expanded for loc in locales]
            elif seg.startswith("["):
                fatals.append(
                    f"unenumerable dynamic segment '{seg}' in src/pages/{rel} -- "
                    "cannot build the route table; update check-site-links.py"
                )
                expanded = None
                break
            else:
                expanded = [e + [seg] for e in expanded]  # type: ignore[list-item]
        if expanded is None:
            continue
        for combo in expanded:
            routes.add("/" + "/".join(combo))

    # Docs content: one route per file, exactly what [...slug].astro emits
    # (params: locale + doc.id minus the locale prefix).
    docs_dir = site / "src" / "content" / "docs"
    if docs_dir.is_dir():
        for suffix in CONTENT_DOC_SUFFIXES:
            for p in sorted(docs_dir.rglob(f"*{suffix}")):
                rel = p.relative_to(docs_dir).as_posix()
                loc, slash, rest = rel.partition("/")
                if not slash or loc not in locales:
                    continue  # reported per-file by scan() as a finding
                slug = posixpath.splitext(rest)[0]
                routes.add(f"/{loc}/docs/{slug}")

    # public/ serves files (and their directories) at the site root; _redirects
    # declares Cloudflare Pages source paths that resolve via 301 at deploy time.
    # Exact sources join the route set here; splat/placeholder sources are prefix-
    # matched by scan() through _redirect_prefixes().
    public = site / "public"
    if public.is_dir():
        for p in sorted(public.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(public).as_posix()
            routes.add("/" + rel)
            parts = rel.split("/")[:-1]
            for i in range(len(parts)):
                routes.add("/" + "/".join(parts[: i + 1]))
        redirects = public / "_redirects"
        if redirects.is_file():
            for line in redirects.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                source = line.split()[0]
                if "*" in source or ":" in source:
                    continue  # prefix form: _redirect_prefixes() owns it
                routes.add(source.rstrip("/") or "/")

    if not (site / "src" / "content").is_dir():
        fatals.append(
            "route contract broken: website/src/content/ not found -- the docs this "
            "checker exists for are gone or moved; update check-site-links.py"
        )
    # Exact redirect sources are already in `routes`; scan() re-reads the splat
    # prefixes through _redirect_prefixes() for prefix matching.
    return routes, fatals


def _redirect_prefixes(site: Path) -> list[str]:
    prefixes: list[str] = []
    redirects = site / "public" / "_redirects"
    if redirects.is_file():
        for line in redirects.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            source = line.split()[0]
            if "*" in source:
                prefixes.append(source.split("*")[0].rstrip("/"))
            elif ":" in source:
                prefixes.append(source.split(":")[0].rstrip("/"))
    return prefixes


def _extract_targets(text: str) -> list[tuple[int, str]]:
    """(line_no, raw capture) for inline markdown links/images outside code."""
    out: list[tuple[int, str]] = []
    in_fence = False
    for lineno, line in enumerate(text.splitlines(), 1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        cleaned = INLINE_CODE_RE.sub("", line)
        for m in LINK_RE.finditer(cleaned):
            out.append((lineno, m.group(1)))
    return out


def _route_base(site: Path, rel_to_content: str, locales: list[str]) -> tuple[str | None, str | None]:
    """Collection-aware base URL (directory form) for a content file, or a finding."""
    parts = rel_to_content.split("/")
    if len(parts) < 2:
        return None, (
            f"{_display(site / 'src' / 'content' / rel_to_content)}: content file sits "
            "outside a locale directory -- no route base can be derived"
        )
    collection, loc = parts[0], parts[1]
    if loc not in locales:
        return None, (
            f"{_display(site / 'src' / 'content' / rel_to_content)}: content locale "
            f"'{loc}' is not one of astro.config's locales {locales} -- the file is never "
            "rendered, so its links cannot resolve to a route"
        )
    stem = posixpath.splitext("/".join(parts[2:]))[0]
    if collection == "docs":
        return f"/{loc}/docs/{stem}/", None
    if collection == "legal":
        name = posixpath.basename(stem)
        if not (site / "src" / "pages" / "[locale]" / "legal" / f"{name}.astro").is_file():
            return None, (
                f"{_display(site / 'src' / 'content' / rel_to_content)}: no page consumes "
                f"this legal doc (expected src/pages/[locale]/legal/{name}.astro) -- "
                "cannot derive a route base"
            )
        return f"/{loc}/legal/{name}/", None
    return None, (
        f"{_display(site / 'src' / 'content' / rel_to_content)}: content collection "
        f"'{collection}' has no route mapping -- links cannot be resolved site-aware"
    )


def _resolve(base: str, target: str) -> str:
    if target.startswith("/"):
        return posixpath.normpath(target)
    return posixpath.normpath(posixpath.join(base, target))


def scan(site: Path) -> tuple[list[str], list[str]]:
    """Returns (findings, fatals). Fatals mean the route table cannot be trusted."""
    findings: list[str] = []
    fatals: list[str] = []

    if not site.is_dir():
        return findings, [f"{site}: website directory not found"]
    config = site / "astro.config.mjs"
    if not config.is_file():
        return findings, [f"{_display(config)}: not found -- cannot read i18n locales"]
    locales = _parse_locales(config.read_text(encoding="utf-8", errors="replace"))
    if not locales:
        return findings, [
            f"{_display(config)}: i18n `locales: [...]` not found or empty -- cannot "
            "build the route table; refusing to guess"
        ]

    routes, fatals = _build_routes(site, locales)
    if fatals:
        return findings, fatals
    prefixes = _redirect_prefixes(site)

    content = site / "src" / "content"
    doc_files: list[Path] = []
    for suffix in CONTENT_DOC_SUFFIXES:
        doc_files.extend(content.rglob(f"*{suffix}"))

    for path in sorted(set(doc_files)):
        rel = path.relative_to(content).as_posix()
        display = _display(path)
        raw_targets = _extract_targets(path.read_text(encoding="utf-8", errors="replace"))

        checkable: list[tuple[int, str, str]] = []  # (lineno, token, path-part)
        for lineno, raw in raw_targets:
            token = raw.strip()
            parts = token.split()
            target = parts[0] if parts else ""
            if not target:
                findings.append(f"{display}:{lineno}: empty link target '[]()'")
                continue
            if SKIP_TARGET_RE.match(target) or target[0] in "#?":
                continue
            path_part = re.split(r"[#?]", target, maxsplit=1)[0]
            if not path_part:
                continue
            checkable.append((lineno, target, path_part))

        if not checkable:
            continue
        base, base_err = _route_base(site, rel, locales)
        if base_err:
            findings.append(base_err)
            continue
        assert base is not None
        for lineno, target, path_part in checkable:
            key = _resolve(base, path_part).rstrip("/") or "/"
            if key in routes:
                continue
            if any(key == pre or key.startswith(pre + "/") for pre in prefixes if pre):
                continue
            findings.append(
                f"{display}:{lineno}: dead site link '{target}' "
                f"(resolves to '{key}', which is not a route)"
            )

    findings.sort()
    return findings, fatals


def run(site: Path, emit: bool = True) -> int:
    findings, fatals = scan(site)
    if emit:
        for line in fatals:
            print(f"FATAL: {line}")
        for line in findings:
            print(line)
        if not findings and not fatals:
            n_docs = 0
            content = site / "src" / "content"
            if content.is_dir():
                for suffix in CONTENT_DOC_SUFFIXES:
                    n_docs += len(list(content.rglob(f"*{suffix}")))
            print(f"OK: {n_docs} content docs, every site link resolves to a route.")
    return 1 if (findings or fatals) else 0


def _write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def self_test() -> int:
    """Synthetic website tree in a tempdir; never touches the real tree."""
    cases: list[tuple[str, bool]] = []  # (name, passed)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "website"

        _write(
            root / "astro.config.mjs",
            "export default defineConfig({\n"
            "  i18n: {\n"
            "    defaultLocale: 'id',\n"
            "    locales: ['en', 'id'],\n"
            "    routing: { prefixDefaultLocale: true },\n"
            "  },\n"
            "});\n",
        )
        _write(root / "src/pages/index.astro", "---\n---\n<p>root</p>\n")
        _write(root / "src/pages/[locale]/index.astro", "---\n---\n<p>home</p>\n")
        _write(root / "src/pages/[locale]/pricing.astro", "---\n---\n<p>pricing</p>\n")
        _write(root / "src/pages/[locale]/login.astro", "---\n---\n<p>login</p>\n")
        _write(root / "src/pages/[locale]/docs/index.astro", "---\n---\n<p>docs hub</p>\n")
        _write(
            root / "src/pages/[locale]/docs/[...slug].astro",
            "---\nexport async function getStaticPaths() { return [] }\n---\n<p>doc</p>\n",
        )
        _write(root / "src/pages/[locale]/legal/privacy.astro", "---\n---\n<p>privacy</p>\n")
        _write(root / "src/pages/[locale]/legal/terms.astro", "---\n---\n<p>terms</p>\n")
        _write(root / "src/content/docs/en/cloud-sync.md", "---\ntitle: Cloud Sync\n---\n# Cloud Sync\n")
        _write(root / "src/content/docs/id/cloud-sync.md", "---\ntitle: Sinkronisasi\n---\n# Sinkron\n")
        _write(root / "public/favicon.svg", "<svg/>")
        _write(root / "public/admin/panel.html", "<html></html>")
        _write(root / "public/_redirects", "# Cloudflare Pages redirects\n/old /new\n")

        base_md = root / "src/content/docs/en/base.md"
        legal_md = root / "src/content/legal/en/privacy.md"
        extra_md = root / "src/content/extra/en/z.md"
        stray_md = root / "src/content/docs/fr/stray.md"

        def run_case(name: str, body: str, expect_red: bool, target: Path = base_md) -> None:
            for f in (base_md, legal_md, extra_md, stray_md):
                if f.exists():
                    f.unlink()
            _write(target, body)
            findings, fatals = scan(root)
            red = bool(findings) or bool(fatals)
            cases.append((name, red == expect_red))

        run_case(
            "sibling doc resolves as a route",
            "See [cloud](../cloud-sync/).\n", False,
        )
        run_case(
            "../../pricing/ resolves as a route, not a filesystem path",
            "[p](../../pricing/)\n", False,
        )
        run_case(
            "../../login/ resolves as a route",
            "[l](../../login/)\n", False,
        )
        run_case(
            "ghost sibling slug is red",
            "[bad](../ghost/)\n", True,
        )
        run_case(
            "absolute docs route resolves",
            "[ok](/en/docs/cloud-sync/)\n", False,
        )
        run_case(
            "absolute ghost route is red (catch-all pattern is not a page)",
            "[bad](/en/docs/ghost/)\n", True,
        )
        run_case(
            "external, mailto, fragment-only and query-only targets are skipped",
            "[a](https://x.invalid/nope) [b](mailto:n@x.invalid) "
            "[c](#local) [d](#) [e](?q=1)\n", False,
        )
        run_case(
            "empty link target is red",
            "[bad]()\n", True,
        )
        run_case(
            "fenced code example is not extracted",
            "```md\n[f](../ghost/)\n```\n", False,
        )
        run_case(
            "inline backtick example is not extracted",
            "write `[f](../ghost/)` like this\n", False,
        )
        run_case(
            "redirect source resolves via public/_redirects",
            "[old](/old)\n", False,
        )
        run_case(
            "over-escaping above the locale root is red",
            "[bad](../../../pricing/)\n", True,
        )
        run_case(
            "public asset and subdirectory routes resolve",
            "[i](/favicon.svg) [d](/admin/panel.html)\n", False,
        )
        run_case(
            "legal doc resolves from its consuming page",
            "[l](../../login/)\n", False, legal_md,
        )
        run_case(
            "legal ghost link is red",
            "[bad](../ghost/)\n", True, legal_md,
        )
        run_case(
            "unmapped content collection with links is red",
            "[x](../whatever/)\n", True, extra_md,
        )
        run_case(
            "content locale outside astro.config locales is red",
            "[x](../cloud-sync/)\n", True, stray_md,
        )

        # run() exit-code parity through the same path main() uses.
        for f in (legal_md, extra_md, stray_md):
            if f.exists():
                f.unlink()
        _write(base_md, "[bad](../ghost/)\n")
        rc_red = run(root, emit=False)
        _write(base_md, "[ok](../cloud-sync/)\n")
        rc_green = run(root, emit=False)
        cases.append(("run() exits 1 on a red tree", rc_red == 1))
        cases.append(("run() exits 0 on a green tree", rc_green == 0))

        # Contract failures must not read as green either.
        broken = Path(td) / "no-website"
        rc_missing = run(broken, emit=False)
        cases.append(("missing website/ is fatal (exit 1), not a clean empty run", rc_missing == 1))

    wrong = [name for name, ok in cases if not ok]
    if wrong:
        for name in wrong:
            print(f"SELF-TEST WRONG: {name}")
        return 2
    print(f"SELF-TEST OK ({len(cases)} cases)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="run synthetic red/green cases")
    parser.add_argument(
        "--site-root",
        default=str(Path(__file__).resolve().parents[4] / "website"),
        help="website/ tree to check (default: the repo's website/)",
    )
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(Path(args.site_root))


if __name__ == "__main__":
    sys.exit(main())
