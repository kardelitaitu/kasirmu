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

The self-test story is measured twice. Measured 2026-09-29: LITERAL_IMPORT was
mutated to a pattern that cannot match, and this gate went LOUD -- exit 1, with
every asset reported ORPHAN. Both extraction paths fail toward noise rather than
silence: break the import regex and references vanish, so everything looks
unreferenced; break the dynamic-resolver regex and find_dynamic_resolvers()
returns empty, which ENABLES the orphan check rather than disabling it. That
measured loudness is why this gate carried no --self-test from round 14 on.
Measured 2026-11-07 (round 85): the census refused that stance -- a wired gate
with no flag is precisely the "checkers without self-tests" gap, held by a
CENSUS_UNFLAGGED account. The flag is here now, and the self-test grades the
vocabulary directly: the four dynamic shapes, the ?url suffix split, the
ratchet baseline, the verdict composer, and the two live scans' return types
(a gutted scan returns None, which the isinstance cases catch). Liveness is
additionally measured per candidate by the sabotage survey, whose first
candidate here is find_dynamic_resolvers.

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

#: Where fixtures are written when the host sets a temp variable. A host whose
#: confinement denies files under its default temp (measured 2026-11-09 on the
#: agent host: every write into a TemporaryDirectory is EPERM) can point this at
#: a directory it allows; unset leaves tempfile's own default in force.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")


def fixture_root():
    """The temp root this file's fixtures are written under (None = system default).

    The makedirs is the r250 lesson: a scratch dir that was removed between runs
    otherwise makes EVERY fixture die with FileNotFoundError before it grades
    anything. exist_ok keeps the common case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


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


def find_dynamic_resolvers(src=None) -> list[str]:
    """Return 'file:line' for anything that could resolve an asset at runtime.

    r172: `src` redirects the walk at a fixture (the r166 parameter); None
    keeps this repository's own website/src."""
    src = SRC if src is None else Path(src).resolve()
    hits = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", ".astro")]
        for fn in filenames:
            if not fn.endswith((".astro", ".ts", ".tsx", ".js", ".jsx", ".mjs")):
                continue
            p = Path(dirpath) / fn
            for i, line in enumerate(read(p).splitlines(), 1):
                if any(rx.search(line) for rx in DYNAMIC):
                    hits.append(f"{p.relative_to(src)}:{i}")
    return hits


def collect_referenced(src=None) -> set[str]:
    """Filenames imported by literal path anywhere under website/src.

    r172: `src` redirects the walk at a fixture; None keeps this repository's."""
    src = SRC if src is None else Path(src).resolve()
    refs: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(src):
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


def main(argv: list[str] | None = None, root: str | Path | None = None) -> int:
    """r172: argv and root parameterized, the r166..r171 contract -- root
    redirects BOTH the asset listing and both reference scans, so a fixture
    cannot half-run against the real website tree."""
    root_path = ROOT if root is None else Path(root).resolve()
    assets = root_path / "website" / "src" / "assets"
    src_dir = root_path / "website" / "src"
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # r172/r251: the flag lives here, not only in the __main__ block, so that a
    # --self-test driven through argv from the ladder dispatches to the cases
    # instead of reaching the first scan (which would read the fixture tree).
    ap.add_argument("--self-test", action="store_true",
                    help="run this checker's cases and exit; touches no repository file")
    ap.add_argument("--max-bytes", type=int, default=100 * 1024,
                    help="size budget per asset (default 102400)")
    ap.add_argument("--allow-raster-svg", default="",
                    help="comma-separated filenames exempt from the base64 check")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()

    if not assets.is_dir():
        print(f"verify-website-assets: {assets.relative_to(root_path)} not found", file=sys.stderr)
        return 2

    allow = {a.strip() for a in args.allow_raster_svg.split(",") if a.strip()}
    problems: list[str] = []
    notes: list[str] = []

    files = sorted(p for p in assets.iterdir() if p.is_file())

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
    dyn = find_dynamic_resolvers(src_dir)
    orphan_graded = not dyn
    if dyn:
        notes.append(
            f"orphan check SKIPPED: {len(dyn)} dynamic asset resolution site(s) found "
            f"({'; '.join(dyn[:3])}{' …' if len(dyn) > 3 else ''}) -- a zero filename "
            "grep no longer proves 'unused' here")
    else:
        refs = collect_referenced(src_dir)
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


def self_test() -> int:
    """Grade the guard's own vocabulary: the four dynamic shapes, the ?url
    suffix split, the ratchet baseline, the verdict composer, and the two
    live scans' return types (a gutted scan returns None, which the
    isinstance cases catch)."""
    bad: list[str] = []

    def want(name, got, expect):
        if got != expect:
            bad.append(f"{name}: expected {expect!r}, got {got!r}")

    def dyn(line: str) -> bool:
        return any(rx.search(line) for rx in DYNAMIC)

    want("a plain literal import is not a dynamic resolver",
         dyn("import logo from '../assets/logo.svg'"), False)
    want("import.meta.glob is a dynamic resolver",
         dyn("const m = import.meta.glob('../assets/*')"), True)
    want("a template-string asset path is a dynamic resolver",
         dyn('const p = `../assets/${name}.svg`'), True)
    want("a concatenated asset path is a dynamic resolver",
         dyn('const p = "../assets/" + name'), True)
    want("a .concat call naming assets is a dynamic resolver",
         dyn("const p = base.concat('/assets/', name)"), True)
    m = LITERAL_IMPORT.search("import logo from '../assets/logo-os-windows.svg?url'")
    want("a vite ?url suffix is part of the specifier",
         m.group(2) if m else None, "logo-os-windows.svg?url")
    want("the file name is split from the vite suffix",
         re.split(r"[?#]", m.group(2), maxsplit=1)[0] if m else None,
         "logo-os-windows.svg")
    want("the dynamic-resolver scan returns a list",
         isinstance(find_dynamic_resolvers(), list), True)
    want("the reference scan returns a set",
         isinstance(collect_referenced(), set), True)
    want("the grandfathered raster baseline is exactly the known export",
         sorted(KNOWN_RASTER_SVGS), ["logo-os-android.svg"])
    want("one rule names itself", list_graded(["a"]), "a")
    want("two rules join with or", list_graded(["a", "b"]), "a or b")
    want("three rules use the oxford comma",
         list_graded(["a", "b", "c"]), "a, b, or c")

    # r172: main()'s shell -- argv and root graded against a tempdir fixture,
    # the r166..r171 pattern. The downgrade case is the checker's most subtle
    # behavior: a dynamic resolver must DISABLE the orphan rule and say so,
    # not silently grade a zero-grep as "unused".
    import contextlib
    import io as _io
    import tempfile
    def _shell(args, files):
        with tempfile.TemporaryDirectory(dir=fixture_root(),
                                         ignore_cleanup_errors=True) as td:
            root = Path(td)
            (root / "website" / "src" / "assets").mkdir(parents=True)
            for rel, content in files.items():
                f = root / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(content, encoding="utf-8")
            out, err = _io.StringIO(), _io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv=args, root=root)
            return rc, out.getvalue() + err.getvalue()
    LOGO = {"website/src/assets/logo.svg": "<svg><path d=\"M0 0\"/></svg>\n",
            "website/src/page.astro": "import logo from '../assets/logo.svg'\n"}
    rc, text = _shell([], LOGO)
    if rc != 0 or "no oversized, raster-in-svg, or orphaned assets" not in text:
        bad.append("a clean fixture must exit 0 grading all three rules "
                   "(rc=%d text=%r)" % (rc, text[-160:]))
    rc, text = _shell([], {**LOGO,
        "website/src/assets/unused.svg": "<svg/>\n"})
    if rc != 1 or "ORPHAN" not in text or "unused.svg" not in text:
        bad.append("an unimported asset must be reported ORPHAN with rc 1 "
                   "(rc=%d text=%r)" % (rc, text[-160:]))
    rc, text = _shell(["--max-bytes", "10"], {**LOGO,
        "website/src/assets/big.png": "x" * 40})
    if rc != 1 or "OVER BUDGET" not in text:
        bad.append("an over-budget asset must be reported with rc 1 "
                   "(rc=%d text=%r)" % (rc, text[-160:]))
    rc, text = _shell([], {**LOGO,
        "website/src/assets/bad.svg": "<svg><image href=\"data:image/png;base64,AAAA\"/></svg>\n"})
    if rc != 1 or "RASTER IN SVG" not in text:
        bad.append("a base64-bearing svg must be reported with rc 1 "
                   "(rc=%d text=%r)" % (rc, text[-160:]))
    rc, text = _shell([], {**LOGO,
        "website/src/dyn.ts": "const m = import.meta.glob('../assets/*')\n"})
    if rc != 0 or "orphan check SKIPPED" not in text or "orphans NOT assessed" not in text:
        bad.append("a dynamic resolver must downgrade the orphan rule, not red the run "
                   "(rc=%d text=%r)" % (rc, text[-200:]))
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                         ignore_cleanup_errors=True) as td:
        out, err = _io.StringIO(), _io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = main(argv=[], root=td)
        if rc != 2 or "not found" not in (out.getvalue() + err.getvalue()):
            bad.append("a missing assets dir must exit 2 (rc=%d)" % rc)

    if bad:
        print("SELF-TEST WRONG: " + "; ".join(bad), file=sys.stderr)
        return 2
    print("SELF-TEST OK (%d cases, incl. 6 shell cases; fixtures are tempdirs)"
          % (13 + 6))
    return shell_ladder()


_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard for the ladder (r244/r250 -- the r228 lesson).

    Rung 5 drives --self-test through argv from INSIDE the ladder, and the
    self-test ends in this call, so without the guard that nested run recurses.
    """
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        print("  (ladder re-entry from a nested --self-test: skipped)")
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """r251: the root contract, graded on fixture website/src trees through main().

    Rung 1 IS the killing rung, and it grades the CENSUS line rather than either
    scan, because the census is the one printed value composed from BOTH halves
    of the redirect at once: the asset count comes from <root>/website/src/assets
    and the orphan-rule branch from the dynamic-resolver walk of
    <root>/website/src. Measured 2026-11-09 (r251), the live print on this
    checkout is

        === Website Asset Check === (8 file(s), budget 102,400 B)

    "AssetCheck ... 1 file(s) ..." would NOT be a kill: "file(s)" matches any
    count including 8, and the budget half ("budget 102,400 B") is identical in
    every run. Rung 1 therefore fixes the count at 1 and asserts the WHOLE
    sentence "=== Website Asset Check === (1 file(s),
    budget 102,400 B)", a string this checkout cannot print because it prints 8.
    A main() that ignored root would read 8 files and fail here. The orphan rule
    runs static in this rung (no dynamic resolver), so the count is also a count
    of files actually COMPARED against a reference set; a root-blind scan would
    walk this checkout's real imports instead and report the fixture's asset
    ORPHAN, flipping rc to 1 as well.

    Rung 2 is the clean arm: the same asset with a literal import is exit 0 with
    the fully graded verdict. Rung 3 is the refusal floor: a fixture with no
    assets dir must refuse rc 2 and never print OK -- a root-blind main finds
    this checkout's assets dir and prints the clean verdict instead.
    Rung 4 grades the downgrade end to end: because parse_args runs before the
    refusal check the opening line still prints under a root with no assets dir,
    and it must name the FIXTURE's one skip site.
    Rung 5 drives --self-test through argv; re-entry is guarded.
    """
    import contextlib
    import io
    import tempfile

    def build(tmp, files, label="fx"):
        """A fixture root holding the given {relative path: text} files."""
        base = Path(tempfile.mkdtemp(dir=tmp, prefix=label + "_"))
        for rel, text in files.items():
            dst = base / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text, encoding="utf-8", newline=chr(10))
        return base

    def run(root_dir, *argv):
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                rc = main(argv=list(argv), root=str(root_dir))
        except SystemExit as se:
            return se.code, buf.getvalue()
        return rc, buf.getvalue()

    VECTOR = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' + chr(10)
    # One asset, one literal import. The ?url suffix is deliberate: the
    # specifier is not the filename, and the reference scan must strip the
    # suffix to see the import at all -- the same edge this file's cases pin.
    CLEAN = {"website/src/assets/logo.svg": VECTOR,
             "website/src/page.astro": "import logo from '../assets/logo.svg?url'" + chr(10)}

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as tmp:
        # rung 1 -- the killing rung: the census is the FIXTURE's, exactly.
        root = build(tmp, CLEAN)
        rc, said = run(root)
        want = "=== Website Asset Check === (1 file(s), budget 102,400 B)"
        if rc != 0 or want not in said:
            print("  x rung 1: the census must count the fixture's one asset under its "
                  "root, not this checkout's eight (rc=%r said=%r)" % (rc, said[-240:]),
                  file=sys.stderr)
            return 1
        shell += 1
        # rung 2 -- the clean arm: all three rules grade, exit 0.
        root = build(tmp, CLEAN)
        rc, said = run(root)
        if rc != 0 or "OK" not in said or "or orphaned assets" not in said:
            print("  x rung 2: a clean fixture must exit 0 with the full graded verdict "
                  "(rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 3 -- the refusal floor: no assets dir under the fixture root.
        root = build(tmp, {"website/src/page.astro": "export const x = 1" + chr(10)})
        rc, said = run(root)
        if rc != 2 or "verify-website-assets:" not in said or "OK" in said:
            print("  x rung 3: a fixture without an assets dir must refuse rc 2, never "
                  "print OK (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 4 -- the downgrade: one dynamic resolver disables the orphan rule,
        # and the opening line counts the FIXTURE's skip site.
        root = build(tmp, {**CLEAN,
                           "website/src/dyn.ts": "const m = import.meta.glob('../assets/*')" + chr(10)})
        rc, said = run(root)
        if rc != 0 or "=== Website Asset Check === (1 file(s)" not in said or "SKIPPED: 1" not in said:
            print("  x rung 4: a dynamic resolver must print the fixture's own skip note "
                  "and still exit 0 (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1
        # rung 5 -- --self-test dispatch flows through argv; re-entry is guarded.
        root = build(tmp, CLEAN)
        rc, said = run(root, "--self-test")
        if rc != 0 or "SELF-TEST OK" not in said or "ladder re-entry" not in said:
            print("  x rung 5: --self-test through argv must pass rc 0 and skip the "
                  "nested ladder (rc=%r said=%r)" % (rc, said[-240:]), file=sys.stderr)
            return 1
        shell += 1

    print("WEBSITE-ASSETS SHELL LADDER OK (%d cases through argv and root, "
          "no repository file touched)" % shell)
    return 0



if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    sys.exit(main())
