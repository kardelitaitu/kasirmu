#!/usr/bin/env python3
"""verify-website-assets.py — guard website/src/assets against the drift that
let a 639 KB map and a 381 KB base64 raster sit in the tree unreferenced.

Closes the remaining half of R36-03 (docs/plans/0.0.36-backlog.md). Three checks,
each with a different failure mode:

  1. base64 in an .svg  -> always an error. An icon directory should hold
     vectors. `footer-instagram.svg` was six base64 <image> rasters wearing an
     <svg> tag and read as a 381 KB "icon".
  2. size over budget   -> error. Budget defaults to 100 KB; the two offenders
     were 639 KB and 381 KB while every legitimate icon here is under 14 KB.
  3. orphan (no literal import) -> error, but ONLY while the reference style is
     provably static. If any dynamic asset resolution appears anywhere in
     website/src -- import.meta.glob, a template-string path, or a runtime
     resolve -- this check turns itself off and says so, because at that point a
     zero-grep-count stops meaning "unused". That self-disabling is the whole
     reason this third check is safe to enforce rather than advisory.

KNOWN LIMIT -- what the orphan rule cannot see while a dynamic resolver exists.
In that state this tool grades NOTHING about whether an asset is referenced: an
unreferenced file that is a real vector and fits under --max-bytes walks through
green. Rules 1 and 2 still apply, so the hole left open is "small, clean, nobody
imports it" -- not an oversized or base64-bearing file, which those rules still
catch. Do NOT repair the hole by adding a floor or a non-zero exit: any repo with
a dynamic resolver would then fail every run, which is why the downgrade is a
print problem and not a gate problem. What the fix does guarantee is that the
closing sentence never claims the hole was checked.
Which branch a tree takes is printed, not guessed: run the tool and look for an
"orphan check SKIPPED" note (downgraded) or the absence of one (active); the
closing sentence names exactly the rules that ran. Re-derive the current branch
with `python3 -c "import importlib.util as u; s=u.spec_from_file_location('v',
'scripts/verify-website-assets.py'); m=u.module_from_spec(s); s.loader.exec_module(m); print(len(m.find_dynamic_resolvers()))"`
-- 0 means the orphan rule is ACTIVE on this tree.

Exit 0 = clean for every rule that ran (a legitimate downgrade still exits 0),
1 = violations, 2 = the guard itself could not run (missing dir).
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
from pathlib import Path

# Repo root resolved script-relative, never anchored to a checkout path
# (AGENTS.md: "Never anchor to a hardcoded checkout").
ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "website" / "src" / "assets"
SRC = ROOT / "website" / "src"

# Patterns that would make a filename grep unreliable as an orphan signal.
DYNAMIC = [
    re.compile(r"import\.meta\.glob"),
    re.compile(r"""['"`][^'"`]*assets/[^'"`]*\$\{"""),
    re.compile(r"""['"`]\.\./[^'"`]*assets/['"`]\s*\+"""),
    re.compile(r"""\.concat\([^)]*assets"""),
]

LITERAL_IMPORT = re.compile(r"""from\s+['"]([^'"]*assets/([^'"/]+))['"]""")

# Ratchet baseline, NOT an endorsement. logo-os-android.svg is a brand export
# that embeds 14 base64 rasters in an <svg> wrapper -- the same shape as the
# 381 KB footer-instagram.svg this guard exists to prevent. It is 52 KB, under
# the size budget, and pre-dates this check, so it is grandfathered here rather
# than being allowed to make the guard red on arrival. Any NEW base64-bearing
# svg fails, and this set should only ever shrink.
KNOWN_RASTER_SVGS = {"logo-os-android.svg"}


def read(path: Path) -> str:
    return io.open(path, encoding="utf-8", errors="replace").read()


def find_dynamic_resolvers() -> list[str]:
    """Return 'file:line' for anything that could resolve an asset at runtime."""
    hits = []
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", ".astro")]
        for fn in filenames:
            if not fn.endswith((".astro", ".ts", ".tsx", ".js", ".jsx", ".mjs")):
                continue
            p = Path(dirpath) / fn
            for i, line in enumerate(read(p).splitlines(), 1):
                if any(rx.search(line) for rx in DYNAMIC):
                    hits.append(f"{p.relative_to(ROOT)}:{i}")
    return hits


def collect_referenced() -> set[str]:
    """Filenames imported by literal path anywhere under website/src."""
    refs: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", ".astro")]
        for fn in filenames:
            if not fn.endswith((".astro", ".ts", ".tsx", ".js", ".jsx", ".mjs")):
                continue
            for m in LITERAL_IMPORT.finditer(read(Path(dirpath) / fn)):
                # Vite import suffixes are part of the specifier, not the file:
                # '../assets/logo-os-windows.svg?url' names logo-os-windows.svg.
                # Forgetting to strip this makes EVERY asset look orphaned.
                name = re.split(r"[?#]", m.group(2), maxsplit=1)[0]
                refs.add(name)
    return refs


def list_graded(items: list[str]) -> str:
    """'a','b' -> 'a or b'; 'a','b','c' -> 'a, b, or c'. Lets the passing line
    enumerate only the rules that actually ran."""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return " or ".join(items)
    return ", ".join(items[:-1]) + ", or " + items[-1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--max-bytes", type=int, default=100 * 1024,
                    help="size budget per asset (default 102400)")
    ap.add_argument("--allow-raster-svg", default="",
                    help="comma-separated filenames exempt from the base64 check")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if not ASSETS.is_dir():
        print(f"verify-website-assets: {ASSETS.relative_to(ROOT)} not found", file=sys.stderr)
        return 2

    allow = {a.strip() for a in args.allow_raster_svg.split(",") if a.strip()}
    problems: list[str] = []
    notes: list[str] = []

    files = sorted(p for p in ASSETS.iterdir() if p.is_file())

    # 1 + 2: content and size, independent of reference analysis.
    for p in files:
        size = p.stat().st_size
        if size > args.max_bytes:
            problems.append(f"OVER BUDGET  {p.name}: {size:,} B > {args.max_bytes:,} B")
        if p.suffix.lower() == ".svg" and p.name not in allow:
            text = read(p)
            if "base64," in text:
                n = text.count("base64,")
                if p.name in KNOWN_RASTER_SVGS:
                    notes.append(f"{p.name}: {n} base64 image(s), {size:,} B — grandfathered "
                                 f"ratchet baseline, should be replaced with a vector")
                    continue
                problems.append(
                    f"RASTER IN SVG {p.name}: {n} base64-embedded image(s), {size:,} B. "
                    "Icon directories hold vectors; replace with a <path> or move the "
                    "raster out of assets/ deliberately.")

    # 3: orphans, but only while the reference style is provably static.
    dyn = find_dynamic_resolvers()
    orphan_graded = not dyn
    if dyn:
        notes.append(
            f"orphan check SKIPPED: {len(dyn)} dynamic asset resolution site(s) found "
            f"({'; '.join(dyn[:3])}{' …' if len(dyn) > 3 else ''}) -- a zero filename "
            "grep no longer proves 'unused' here")
    else:
        refs = collect_referenced()
        for p in files:
            if p.name not in refs:
                problems.append(
                    f"ORPHAN       {p.name}: {p.stat().st_size:,} B, no literal import "
                    "anywhere under website/src")

    if not args.quiet:
        print(f"=== Website Asset Check === ({len(files)} file(s), budget {args.max_bytes:,} B)")
        for n in notes:
            print(f"  note: {n}")
        for pr in problems:
            print(f"  \033[0;31mVIOLATION\033[0m: {pr}")
        if problems:
            print(f"\n\033[0;31mFAIL: {len(problems)} asset problem(s)\033[0m")
        else:
            # Compose the verdict from the rules that ACTUALLY RAN. When the
            # orphan rule self-disabled, this line must not certify a negative it
            # did not examine; the note above carries the full reason, so the tail
            # names the gap in one clause and points at it. The sentence for a
            # fully-graded run is unchanged from before this fix.
            graded = ["oversized", "raster-in-svg"]
            if orphan_graded:
                graded.append("orphaned")
            verdict = "no " + list_graded(graded) + " assets"
            if not orphan_graded:
                verdict += (
                    " (orphans NOT assessed: a dynamic asset resolver defeats the "
                    "grep -- see the skip note above)")
            print(f"  \033[0;32mOK\033[0m: {verdict}")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
