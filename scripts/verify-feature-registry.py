#!/usr/bin/env python3
r"""
scripts/verify-feature-registry.py — Catch feature key drift between
Rust backend, frontend FEATURES constant, and UI registrations.

WHY
====

The OZ-POS feature flag system requires three sources of truth to stay
in sync:
  1. The Rust `Feature` enum + `feature_key()` in
     `crates/oz-core/src/features.rs` — canonical backend definitions.
  2. The `FEATURES` constant in
     `ui/src/hooks/useFeatures.ts` — frontend feature key registry.
  3. `feature: '...'` attributes on `registerPage()` and `registerNavItem()`
     calls in `ui/src/App.tsx` and other registration sites.

When a developer adds a new Feature variant to the Rust enum but forgets
to:
  * add the kebab-case key to the `FEATURES` constant, or
  * update the `feature:` attribute on page/nav registrations,
the result is a silent UX bug — a page that never appears regardless of
toggle state, or a feature toggle that has no visible effect.

This script statically checks that every `feature:` string literal
referenced in registrations has a corresponding entry in both the Rust
`feature_key()` function and the frontend `FEATURES` constant. It also
reports any keys that exist in one source but not the other as
actionable gaps so they can be closed.

WHICH SURFACE IS GRADED
=======================

The two registry files used to be read out of the WORKING TREE and nothing else, so
this gate graded bytes no commit contains -- HEAD owns 278 lines with zero occurrences
of the string "head". On CI a clean checkout makes the two readings coincide and the
defect is invisible; in a checkout where several agents commit at once it is not.
Measured before the repair, in a throwaway repository: HEAD carried a registration for
'analytics-charts' while defining no such key (HEAD alone is red, and CI on that commit
is red), and adding the key to the working copy WITHOUT committing it made this gate
print '0 issue(s)' and exit 0.

So the registries are now graded as committed, via "git show
HEAD:crates/oz-core/src/features.rs" and the same for ui/src/hooks/useFeatures.ts,
with the working copy as a declared fallback that SAYS it fell back and what that costs
(no git, no HEAD, path not committed, or a HEAD blob whose body parses to zero keys --
a parse failure on the committed side is not evidence of a missing registry). The run
prints which of the two it graded, per file. Same convention, reached first in
scripts/verify-agents-mirrors.py.

The third input, the registration sites, is still graded from the working copy and the
run says so: grading it from HEAD means one git read per .ts/.tsx under ui/src,
hundreds of invocations per run, on a path that already carries 14 other gates. Two
consequences, named rather than papered over:

  * a key the working copy adds and no commit contains is now a FINDING, so a lane
    mid-edit on both halves of a pair sees red where the old gate saw green. That is
    the price of grading HEAD without a per-site read that could tell the two apart;
  * a key that HEAD registers and the working copy has just DELETED stays invisible.

USAGE
=====

    python3 scripts/verify-feature-registry.py                    # strict: exit 1 if mismatch
    python3 scripts/verify-feature-registry.py --verbose          # list every feature, even OK ones
    python3 scripts/verify-feature-registry.py --report-only      # always exit 0
    python3 scripts/verify-feature-registry.py --self-test        # grade a fixture with HEAD supplied by hand

EXIT CODES
==========

  * 0  every feature key is consistent across all three sources.
  * 1  at least one mismatch was detected (unless --report-only).
  * 2  a runtime error occurred (Rust/TS source files not found).
"""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RUST_FEATURES_REL = "crates/oz-core/src/features.rs"
FRONTEND_FEATURES_REL = "ui/src/hooks/useFeatures.ts"
RUST_FEATURES_PATH = ROOT / RUST_FEATURES_REL
FRONTEND_FEATURES_PATH = ROOT / FRONTEND_FEATURES_REL
UI_SRC = ROOT / "ui" / "src"

# Matches `Feature::VariantName => "kebab-case-key",` in the Rust feature_key() function.
RUST_KEY_PATTERN = re.compile(
    r'Feature::\w+\s*=>\s*"([a-z][a-z0-9-]*)"',
)

# Matches `KEY_NAME: 'kebab-case-key',` in the FEATURES constant (TS).
TS_FEATURE_PATTERN = re.compile(
    r"\b[A-Z][A-Z0-9_]*:\s*'([a-z][a-z0-9-]*)'",
)

# Matches `feature: 'kebab-case-key'` in JSX/TSX registration calls.
FEATURE_ATTR_PATTERN = re.compile(
    r"""feature:\s*'([a-z][a-z0-9-]*)'""",
)

DESCRIPTION = (
    "Verify that every feature: string used in registerPage / registerNavItem "
    "calls has a matching key in both the Rust Feature enum and the frontend "
    "FEATURES constant. Prevents silent feature-drift bugs."
)


def extract_rust_keys(text: str | None = None) -> set[str]:
    """Parse all kebab-case keys from the Rust `feature_key()` function body."""
    if text is None:
        text = RUST_FEATURES_PATH.read_text(encoding="utf-8")
    # Find the `feature_key` function body.
    fn_match = re.search(r"pub fn feature_key\(f: Feature\)", text)
    if not fn_match:
        print(
            "error: cannot find `feature_key` function in Rust file",
            file=sys.stderr,
        )
        return set()

    # Extract everything from the function body (starting after the match).
    # Find the opening brace and scan for key patterns until the closing brace.
    brace_start = text.index("{", fn_match.end())
    depth = 1
    i = brace_start + 1
    while depth > 0 and i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    body = text[brace_start : i - 1]

    keys = set()
    for m in RUST_KEY_PATTERN.finditer(body):
        keys.add(m.group(1))

    if not keys:
        print(
            "error: no feature keys found in Rust feature_key() body",
            file=sys.stderr,
        )
    return keys


def extract_frontend_keys(text: str | None = None) -> set[str]:
    """Parse all kebab-case keys from the FEATURES constant in useFeatures.ts."""
    if text is None:
        text = FRONTEND_FEATURES_PATH.read_text(encoding="utf-8")

    # Find the FEATURES constant definition.
    fn_match = re.search(r"export\s+const\s+FEATURES\s*=\s*\{", text)
    if not fn_match:
        print(
            "error: cannot find `FEATURES` constant in frontend file",
            file=sys.stderr,
        )
        return set()

    brace_start = fn_match.end() - 1  # point to the opening {
    depth = 1
    i = brace_start + 1
    while depth > 0 and i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    body = text[brace_start : i - 1]

    keys = set()
    for m in TS_FEATURE_PATTERN.finditer(body):
        keys.add(m.group(1))

    if not keys:
        print(
            "error: no feature keys found in FEATURES constant body",
            file=sys.stderr,
        )
    return keys


def extract_registration_features(root: Path = ROOT) -> dict[str, list[tuple[str, int]]]:
    """Walk all .tsx/.ts files and collect feature: references with attribution."""
    sites: dict[str, list[tuple[str, int]]] = {}

    ui_src = root / "ui" / "src"
    for path in sorted(ui_src.rglob("*.tsx")) + sorted(ui_src.rglob("*.ts")):
        relpath = path.relative_to(root).as_posix()
        # Unit tests register pages/widgets with fictional feature keys
        # (e.g. `page('a', { feature: 'pro' })` in pageRegistry.test.ts) to
        # exercise gating logic — they have no Rust Feature counterpart.
        # Rust parity applies to production registrations only.
        if "/__tests__/" in relpath or relpath.endswith((".test.ts", ".test.tsx")):
            continue
        text = path.read_text(encoding="utf-8")
        for m in FEATURE_ATTR_PATTERN.finditer(text):
            key = m.group(1)
            line = text.count("\n", 0, m.start()) + 1
            sites.setdefault(key, []).append((relpath, line))

    return sites



def read_text(root: Path, rel: str) -> str:
    """The WORKING COPY of rel, or the empty string when it is not there."""
    p = root / rel
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""


def committed_text(root: Path, rel: str) -> str | None:
    """The file as COMMITTED, via 'git show HEAD:<rel>', or None.

    None means "cannot compare" -- no git, no HEAD, path not committed, git missing or
    too slow. Every caller treats None as the old working-copy behaviour PLUS a notice
    saying so, so a fixture or an exotic checkout loses the extra check rather than
    inventing a verdict. This is the convention scripts/verify-agents-mirrors.py
    established for the same problem; there is no second version of it here.
    """
    try:
        proc = subprocess.run(
            ["git", "show", "HEAD:" + rel],
            cwd=str(root), capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=20,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def grade_registry(root: Path, rel: str, parse, notices: list, what: str,
                   head_texts: dict | None = None) -> tuple[set, str]:
    """(keys, where they came from) for one registry file: HEAD first.

    The working copy is parsed by the same parser on every run, deliberately: two
    parsers over one registry format drift apart, and a comparison between them ends
    up reporting the parsers rather than the tree.
    """
    disk_keys = parse(read_text(root, rel))
    text = (head_texts.get(rel) if head_texts is not None
            else committed_text(root, rel))
    if text is None:
        notices.append(
            rel + ": HEAD is not readable from " + str(root) + ", so " + what
            + " keys fall back to the working copy -- the documented no-comparison"
            + " convention, and it means these " + what + " keys are being graded"
            + " against bytes no commit is known to contain.")
        return disk_keys, rel + " (working copy, HEAD unreadable)"
    keys = parse(text)
    if not keys and disk_keys:
        notices.append(
            "HEAD:" + rel + " parsed to 0 " + what + " keys while the working copy"
            " yields " + str(len(disk_keys)) + ", so they fall back to the working"
            " copy -- a HEAD that cannot be parsed is not evidence of a missing"
            " registry, and grading it as one would turn a parse failure into "
            + str(len(disk_keys)) + " false findings.")
        return disk_keys, rel + " (working copy, HEAD parsed to 0 keys)"
    return keys, "HEAD:" + rel


def collect(root: Path, head_texts: dict | None = None,
            notices: list[str] | None = None) -> dict:
    """Grade the three inputs of ROOT and return the sets the report prints.

    head_texts exists so a caller can reach the fallback branch with no git repo in
    sight. self_test deliberately does not use it: an assertion handed its HEAD as
    text cannot tell whether the gate ever called git, and the mutation that replaces
    the git read with a disk read survived every such assertion.
    """
    if notices is None:
        notices = []
    rust_keys, rust_label = grade_registry(
        root, RUST_FEATURES_REL, extract_rust_keys, notices,
        "Rust feature_key()", head_texts)
    frontend_keys, frontend_label = grade_registry(
        root, FRONTEND_FEATURES_REL, extract_frontend_keys, notices,
        "frontend FEATURES", head_texts)
    sites = extract_registration_features(root)
    return {
        "rust_keys": rust_keys,
        "frontend_keys": frontend_keys,
        "sites": sites,
        "registration_keys": set(sites.keys()),
        "labels": (rust_label, frontend_label),
    }


def surface_lines(res: dict) -> list[str]:
    """Which bytes were graded, said out loud, with the cost of the fallback named."""
    rust_label, frontend_label = res["labels"]
    return [
        "  registries graded from: " + RUST_FEATURES_REL + " -> " + rust_label
        + "; " + FRONTEND_FEATURES_REL + " -> " + frontend_label,
        "  registration sites graded from: the working copy (ui/src walk); HEAD is"
        " not read for them -- one git read per .ts/.tsx under ui/src is not paid"
        " for on a path that already carries 14 other gates. Named consequence: a"
        " key HEAD registers and the working copy deleted is invisible here.",
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print every feature key and its status.",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Always exit 0; print report and return.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Grade a throwaway tree with HEAD supplied by hand, and prove each check fires.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not RUST_FEATURES_PATH.is_file():
        print(f"error: Rust features file not found: {RUST_FEATURES_PATH}", file=sys.stderr)
        return 2
    if not FRONTEND_FEATURES_PATH.is_file():
        print(f"error: Frontend features file not found: {FRONTEND_FEATURES_PATH}", file=sys.stderr)
        return 2

    notices: list[str] = []
    res = collect(ROOT, notices=notices)
    rust_keys = res["rust_keys"]
    frontend_keys = res["frontend_keys"]
    registration_sites = res["sites"]
    registration_keys = res["registration_keys"]

    total_keys = len(rust_keys)


    # ── Cross-reference ─────────────────────────────────────────────

    # Keys used in registrations but not in Rust -- HEAD's registry, as graded above.
    rust_missing = registration_keys - rust_keys
    # Keys used in registrations but not in FEATURES constant.
    frontend_missing = registration_keys - frontend_keys

    # Keys in Rust but not in FEATURES (extra Rust keys are informational).
    rust_extra = rust_keys - frontend_keys
    # Keys in FEATURES but not in Rust.
    frontend_extra = frontend_keys - rust_keys

    # ── Report ──────────────────────────────────────────────────────

    print(
        f"verify-feature-registry: {total_keys} Rust key(s), "
        f"{len(frontend_keys)} frontend key(s), "
        f"{len(registration_keys)} registration key(s) "
        f"across {sum(len(v) for v in registration_sites.values())} site(s)."
    )
    print()
    for line in surface_lines(res):
        print(line)
    print()

    if notices:
        # The diverging-ground-truth channel: printed, never counted.
        print("  NOTICES (reported because the committed and on-disk registries disagree;")
        print("           0 of these count as issues and none of them fail the run):")
        for nt in notices:
            print("    ! " + nt)
        print()

    if args.verbose:
        for key in sorted(rust_keys & frontend_keys & registration_keys):
            sites = registration_sites[key]
            site_list = "; ".join(f"[{r}:{l}]" for r, l in sites)
            print(f"  ok: {key} ({site_list})")
        print()

    if rust_missing:
        print(
            f"  missing IN RUST feature_key() ({len(rust_missing)} unique) — "
            "used in registrations but has no matching Rust Feature variant:"
        )
        for key in sorted(rust_missing):
            sites = registration_sites[key]
            for relpath, line in sites:
                print(f"    [{relpath}:{line}] {key}")
        print()

    if frontend_missing:
        print(
            f"  missing IN FRONTEND FEATURES constant ({len(frontend_missing)} unique) — "
            "used in registrations but has no matching frontend constant:"
        )
        for key in sorted(frontend_missing):
            sites = registration_sites[key]
            for relpath, line in sites:
                print(f"    [{relpath}:{line}] {key}")
        print()

    if rust_extra - registration_keys:
        extras = rust_extra - registration_keys
        print(
            f"  defined in Rust but NOT in FEATURES constant "
            f"({len(extras)} unique) — may be unused or need frontend key:"
        )
        for key in sorted(extras):
            print(f"    {key}")
        print()

    if frontend_extra - registration_keys:
        extras = frontend_extra - registration_keys
        print(
            f"  defined in FEATURES constant but NOT in Rust feature_key() "
            f"({len(extras)} unique) — may be stale or missing Rust variant:"
        )
        for key in sorted(extras):
            print(f"    {key}")
        print()

    total_issues = len(rust_missing) + len(frontend_missing)
    print(f"verify-feature-registry: {total_issues} issue(s).")

    return 0 if (args.report_only or total_issues == 0) else 1



# -- Self-test: grade a throwaway repository and prove HEAD is really read ----------
#
# One case, and it runs this gate end to end from its own bytes inside a temporary git
# repo. That shape is the point: an assertion that hands collect() its HEAD as text
# cannot tell whether the gate ever calls git, and the mutation "read the working copy
# instead of HEAD" passed every injected-text assertion written for this repair. The
# assertions below are about printed lines, never about an exit code.

FX_RUST_HEAD = """pub fn feature_key(f: Feature) -> &'static str {
    match f {
        Feature::Sales => "sales",
        Feature::Inventory => "inventory",
        Feature::Reports => "reports",
    }
}
"""

FX_RUST_DISK = """pub fn feature_key(f: Feature) -> &'static str {
    match f {
        Feature::Sales => "sales",
        Feature::GhostDrawer => "ghost-drawer",
        Feature::AnalyticsCharts => "analytics-charts",
    }
}
"""

FX_FRONT_HEAD = """export const FEATURES = {
  SALES: 'sales',
  INVENTORY: 'inventory',
  REPORTS: 'reports',
} as const;
"""

FX_FRONT_DISK = """export const FEATURES = {
  SALES: 'sales',
  GHOST_DRAWER: 'ghost-drawer',
  ANALYTICS_CHARTS: 'analytics-charts',
} as const;
"""

# Both registrations are COMMITTED, so HEAD is red on its own twice over. The keys
# they name exist only in the uncommitted registry edit below -- the exact state the
# gate used to certify clean.
FX_APP = """registerPage({
  route: 'ghost-drawer',
  component: Ghost,
  feature: 'ghost-drawer',
});
"""

FX_WIDGETS = """registerPage({
  route: 'analytics-charts',
  component: Charts,
  feature: 'analytics-charts',
});
"""


def _git(cwd: Path, *args: str) -> bool:
    # Run git inside a fixture directory; False when git is not available at all.
    try:
        proc = subprocess.run(
            ["git"] + list(args), cwd=str(cwd), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30)
    except Exception:
        return False
    return proc.returncode == 0


def _seed(root: Path, registries: dict) -> None:
    """Lay the fixture down: two registries plus two committed registrations."""
    script = root / "scripts" / "verify-feature-registry.py"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(Path(__file__).read_text(encoding="utf-8"), encoding="utf-8")
    for rel, text in (("ui/src/App.tsx", FX_APP),
                      ("ui/src/features/widgets/register.tsx", FX_WIDGETS)):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    for rel in (RUST_FEATURES_REL, FRONTEND_FEATURES_REL):
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(registries[rel], encoding="utf-8")


HEAD_REG = {RUST_FEATURES_REL: FX_RUST_HEAD, FRONTEND_FEATURES_REL: FX_FRONT_HEAD}
DISK_REG = {RUST_FEATURES_REL: FX_RUST_DISK, FRONTEND_FEATURES_REL: FX_FRONT_DISK}

CASE_ONE = "HEAD grading is real, not only injectable"

# (printed line, what its presence proves)
EXPECT = [
    ("  registries graded from: " + RUST_FEATURES_REL + " -> HEAD:" + RUST_FEATURES_REL
     + "; " + FRONTEND_FEATURES_REL + " -> HEAD:" + FRONTEND_FEATURES_REL,
     "the run names HEAD as the surface it graded, for both files"),
    ("    [ui/src/App.tsx:4] ghost-drawer",
     "a committed registration is reported against HEAD"),
    ("    [ui/src/features/widgets/register.tsx:4] analytics-charts",
     "the second committed registration is reported too"),
    ("verify-feature-registry: 4 issue(s).",
     "both keys are missing from both HEAD registries, as HEAD actually is"),
]


def self_test() -> int:
    """Grade a throwaway git repo with this gate's own bytes and check what printed."""
    with tempfile.TemporaryDirectory(prefix="feature-registry-selftest-") as tmp:
        repo = Path(tmp) / "repo"
        _seed(repo, HEAD_REG)
        usable = (_git(repo, "init", "-q")
                  and _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
                  and _git(repo, "-c", "user.email=t@t", "-c", "user.name=t",
                           "-c", "core.autocrlf=false", "commit", "-qm",
                           "fixture: HEAD defines reports only"))
        if not usable:
            print("  SKIPPED " + CASE_ONE + " -- no git in this environment")
            print("self-test: 0 failure(s)")
            return 0
        # The very edit that used to turn this gate green.
        _seed(repo, DISK_REG)
        proc = subprocess.run(
            [sys.executable, "scripts/verify-feature-registry.py"], cwd=str(repo),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120)
        out = proc.stdout + proc.stderr
        missed = []
        for line, why in EXPECT:
            if line in out:
                print("  CAUGHT  " + CASE_ONE + " -- printed: " + why)
            else:
                print("  MISSED  " + CASE_ONE + " -- printed: " + why)
                missed.append(line)
        if "verify-feature-registry: 0 issue(s)." in out:
            print("  MISSED  " + CASE_ONE + " -- the fixture was certified clean,"
                  " which is the shipped defect")
            missed.append("certified clean")
        print("self-test: " + str(len(missed)) + " failure(s)")
        return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
