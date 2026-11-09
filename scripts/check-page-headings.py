#!/usr/bin/env python3
"""Grade that every REGISTERED PAGE screen renders a level-one heading.

WHY THIS EXISTS
---------------
axe-core cannot grade it. `page-has-heading-one` and `landmark-one-main` are
selected by `document.documentElement`, but their shared check calls
`document.elementFromPoint`, which jsdom does not implement, so both abort into
`incomplete` with `error-occurred` on EVERY page in EVERY suite (measured
2026-10-27; see `ui/src/__tests__/a11y/axe-helper.tsx`). A document WITH an
`<h1>` and one WITHOUT return the identical bucket, so no axe assertion can
ever fail for a missing heading. `jest-axe`'s `toHaveNoViolations()` reads
`violations` only, and the rule never lands there.

The cost of that blindness was real and was found FOUR TIMES in two rounds:
WorkspaceHome (7 h2, 0 h1), KdsScreen (no heading at all), the topology editor
(page title as h2, so the outline started at level two), and RetailPosScreen
(the store name as a `<span>`). Every one of them shipped with a green a11y
suite, because nothing was looking.

WHAT IT ASSERTS
---------------
For every `*Screen.tsx` reachable from a `registerPage({ component: ... })` call,
the file must contain a level-one heading: either an `<h1>`/`<h1 className=...>`
in its own JSX, or `role="heading"` with `aria-level` 1. A screen that renders
nothing but a component it delegates to is graded through that component, and a
screen whose only `<h1>` sits in a whole-screen fallback branch passes: the
branch IS the page when it renders.

A heading that cannot render is not a heading. The first version counted one:
wrapping SecurityTrailScreen's <h1> in `{false && ...}` left the gate green
(measured round 37). An obviously-dead `{false}`/`{0}`/`{null}`/`{undefined}`
guard therefore disqualifies the heading inside it.

WHAT IT DOES NOT CLAIM
----------------------
This is a TEXT check, not a render. It cannot see a heading produced by a
component the screen imports unless that component is in the same directory
(one level, see _local_component_imports) or named in DELEGATING_WRAPPERS. It
also cannot prove a heading behind a RUNTIME condition is reached -- `{loaded &&
<h1>}` counts, deliberately, because POS's "Login Required" branch is exactly
that shape and is a legitimate page title. Proving cardinality (exactly one
rendered h1) is the render tests' job: 12 suite files assert it today. These are
the reasons this is a floor, not a proof, and the floor is where a REGRESSION
gets caught, not where correctness is proven.

THE 25 *Screen*.tsx FILES THIS DOES NOT GRADE are accounted for, measured
2026-10-27 (round 37). 24 of them already carry an <h1> -- the 14
settings/screens/* subpages (rendered inside SettingsPage, which is graded),
the 4 restaurant/screens/* (rendered by RestaurantMenu), StockCountsScreen /
ThresholdConfigScreen / TransactionLogScreen (all reachable through a registered
router or wrapper above), and SyncConflictReviewScreen. The 25th is
KdsScreenFooter.tsx, a status bar, not a page. So "not in the graded set" does
not mean "not checked": it means it is not a PAGE, and every page is in the set.
Run --list to see exactly which files are graded.

EXIT CODES
    0  every registered page screen carries a level-one heading
    1  at least one registered page screen has none
    2  the scan itself broke (no screens found, a registration unreadable)

Usage, from the repo root:

    python scripts/check-page-headings.py
    python scripts/check-page-headings.py --self-test
    python scripts/check-page-headings.py --list
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

#: Where fixture trees are written when the host sets a temp variable (a confined
#: host denies its default temp); unset leaves tempfile's own default in force
#: (the r166 contract, shared with verify-root-policy.py and
#: verify-plugin-guide-parity.py). NEVER point these at a directory inside the
#: checkout: a temp dir under the repo makes a fixture look like part of this
#: working tree, and anything that shells out to git then answers about the
#: repository instead of answering about the fixture.
TMP_ENV = ("TMPDIR", "TMP", "TEMP")

REPO = Path(__file__).resolve().parent.parent
# ROOT is the SAME directory as REPO under the name prove-ladder-kills.py
# substitutes for, so that harness can apply its scan-base mutation here.
# Keeping this one alias is what lets the scan-base mutation be applied to this
# checker instead of the harness reporting NO APPLICABLE MUTATION.
ROOT = REPO
UI_SRC = REPO / "ui" / "src"
FEATURES = UI_SRC / "features"

# Screens whose title is rendered by the component they wrap. Both wrappers
# render exactly one component and add no markup of their own; the inner
# screen is graded in its own right (it is a descendant of the same route and
# carries the <h1>), so listing the wrapper here loses nothing.
# A router/wrapper screen renders ONLY child components and adds no markup of its
# own, so the heading belongs to whichever child renders. These are graded through
# the children instead of being forced to duplicate a heading -- two <h1> on one
# page is as wrong as none.
DELEGATING_WRAPPERS = {
    "features/inventory/InventoryLogScreen.tsx": ["features/inventory/TransactionLogScreen.tsx"],
    "features/inventory/InventoryThresholdsScreen.tsx": ["features/inventory/ThresholdConfigScreen.tsx"],
    # A four-way router: list / new / detail / history, one per branch. Every
    # branch carries its own h1, so the router must not.
    "features/inventory/StockCountsFlow.tsx": [
        "features/inventory/StockCountsScreen.tsx",
        "features/inventory/StockCountForm.tsx",
        "features/inventory/StockCountDetail.tsx",
        "features/inventory/StockCountHistory.tsx",
    ],
}


_H1_RE = re.compile(r"<h1[\s>/]")
# role="heading" aria-level={1} in either order. Written with character classes
# instead of quote escapes: '%' interpolation is not in play here, but a literal
# backslash-quote pair inside a raw string is easy to mangle in transit, and this
# form has no escaping to lose.
# Both JSX spellings: role="heading" (a plain string literal) and
# role={"heading"} (an expression). The second is the one the codebase uses.
ROLE_HEADING = re.compile(r"role\s*=\s*(?:\{\s*)?['\"]heading['\"]\s*\}?")
ARIA_LEVEL_1 = re.compile(r"aria-level\s*=\s*\{\s*1\s*\}")

_REGISTER_RES = [
    re.compile(r"registerPage\(\s*\{(.*?)\}", re.DOTALL),
    re.compile(r"component:\s*([A-Za-z0-9_]+)", re.DOTALL),
]



def _strip_comments(text: str) -> str:
    """Blank // and /* */ comments so a docstring mention does not count as markup.

    The KDS file explains its own missing heading in prose that contains "<h1>";
    without this the prose would satisfy the check it exists to describe.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    return text


def _inside_dead_guard(text: str, index: int) -> bool:
    """True when the heading at `index` sits inside a `{false && ...}`-style guard.

    Walks back to the enclosing `{` and checks whether the expression right after
    it is a literal falsy. Bounded to the current line plus 200 characters so a
    guard far away in a 2000-line file cannot swallow an unrelated heading.
    """
    window_start = max(0, index - 400)
    window = text[window_start:index]
    brace = window.rfind("{")
    if brace < 0:
        return False
    return bool(DEAD_GUARD_RE.match(window, brace))


DEAD_GUARD_RE = re.compile(r"\{\s*(?:false|0|null|undefined)\s*&&")


def _has_level_one_heading(text: str) -> bool:
    """True when the source contains a level-one heading in JSX that can render.

    A heading can be PRESENT and unreachable, and the first version of this
    check counted one: wrapping the security-trail `<h1>` in `{false && ...}`
    left the gate green. That is the same "a case that cannot fail proves
    nothing" shape this gate exists to close, one level up -- so a heading
    inside an obviously-dead `{false && ...}`-style guard does not count.

    Deliberately NOT attempted: a heading behind a runtime condition
    (`{loaded && ...}`, `if (!session)`). Those are ordinary branches and one of
    them -- POS's "Login Required" -- is a legitimate page title. Proving
    reachability is the render tests' job; this is a floor.
    """
    clean = _strip_comments(text)
    for match in _H1_RE.finditer(clean):
        if not _inside_dead_guard(clean, match.start()):
            return True
    # role="heading" + aria-level={1}, adjacent in either order.
    role = ROLE_HEADING.search(clean)
    level = ARIA_LEVEL_1.search(clean)
    if role and level:
        # Adjacent only: the two attributes must be within 60 characters of
        # each other, so a heading div and an unrelated aria-level elsewhere in
        # a 2000-line screen do not pair up.
        return abs(role.start() - level.start()) < 60 and not _inside_dead_guard(
            clean, role.start()
        )
    return False


def _registered_screens(root=None) -> list[Path]:
    """Return every *Screen.tsx file imported by a registerPage({ component }) call.

    The registry is the definition of "a page", so the walk starts there rather
    than from a directory listing -- a screen nothing routes to is not a page and
    grading it would fail on dead code instead of on a defect.
    """
    screens: set[Path] = set()
    # The FULL path, not "<base>/features": the registry lives under ui/src, and a
    # binding without the ui/src prefix finds no registrations at all -- which
    # reads downstream as a tree with no pages rather than as a broken walk.
    features = scan_base(root) / "ui" / "src" / "features"
    registrations = list(features.rglob("register.tsx")) + list(features.rglob("register.ts"))
    # every path this walk derives is resolved BEFORE it is added, so resolving
    # the scan base again below cannot move one of them out from under the fixture
    for reg in registrations:
        src = reg.read_text(encoding="utf-8")
        if "registerPage" not in src:
            continue
        for match in re.finditer(r"registerPage\(\s*\{(.*?)\}\s*\)", src, re.DOTALL):
            body = match.group(1)
            comp = re.search(r"component:\s*([A-Za-z0-9_]+)", body)
            if not comp:
                continue
            name = comp.group(1)
            # Two import shapes are in use: a plain `import X from './X'` and the
            # lazy form `const X = lazy(() => import('./X'))`, which is what most
            # register.tsx files use. Both name the same module.
            direct = re.compile(
                r"import\s+" + re.escape(name) + r"\s+from\s+['\"]([^'\"]+)['\"]"
            )
            lazy = re.compile(
                re.escape(name) + r"\s*=\s*lazy\(\s*\(\s*\)\s*=>\s*import\(\s*['\"]([^'\"]+)['\"]"
            )
            imp = direct.search(src) or lazy.search(src)
            if not imp:
                continue
            target = imp.group(1)
            if target.startswith("@"):
                target = target.replace("@/", "")
                # UI_SRC, not the scan base: this branch already carries the
                # ui/src prefix inside `target`, and prepending it again put every
                # "@/..."-imported page under <base>/ui/src/ui/src. Measured: it
                # then joined the scan as a NON-existent path and _rel() raised.
                candidate = UI_SRC / (target + ".tsx")
            else:
                candidate = (reg.parent / target).resolve()
                if not candidate.suffix:
                    candidate = candidate.with_suffix(".tsx")
            # ONE add, OUTSIDE both branches (the origin's own nesting). A
            # sibling-indented add under the else-branch -- written by an earlier
            # pass here -- silently dropped every "@/" registration: measured
            # 0 registered screens, which the plain run then reported as a clean
            # 55-to-9 screen drop.
            if candidate.exists():
                screens.add(candidate.resolve())
    return sorted(screens)


def _local_component_imports(path: Path) -> list[Path]:
    """Return same-feature components the screen imports and renders itself.""

    A page's heading need not live in the screen file. RetailPosScreen renders
    <RetailHeader>, and the store name -- which names the page -- is inside it. A
    check that only looked at the screen file would have passed the very defect
    round 36 fixed. The walk is deliberately ONE level and same-directory-or-
    below: following every import transitively would reach the whole app and
    make any file's stray h1 satisfy any page.
    """
    src = path.read_text(encoding="utf-8")
    found: list[Path] = []
    for match in re.finditer(
        r"import\s+[A-Za-z0-9_]+\s+from\s+['\"](\.[^'\"]+)['\"]", src
    ):
        rel = match.group(1)
        candidate = (path.parent / rel).resolve()
        if not candidate.suffix:
            candidate = candidate.with_suffix(".tsx")
        if candidate.exists() and candidate.parent == path.parent:
            found.append(candidate)
    return found

DIALOG_ROLE_RE = re.compile(r"role\s*=\s*[\"\']dialog[\"\']")
ARIA_MODAL_RE = re.compile(r"aria-modal\s*=\s*[\"\']true[\"\']|aria-modal\s*=\s*\{\s*true\s*\}")

SHELL_MOUNT_RE = re.compile(
    r"const\s+([A-Za-z0-9_]+)\s*=\s*lazy\(\s*\(\s*\)\s*=>\s*import\(\s*['\"]([^'\"]+)['\"]"
)


def _shell_mounted_screens(root=None) -> list[Path]:
    """Return screens the SHELLS mount directly, outside the page registry.

    Not every page is a registered route. RetailPosScreen is chosen by the
    store-pos BRANCH inside AppShell.tsx and TabletAppShell.tsx, so it has no
    registerPage entry -- and a registry-only scan silently skipped the very
    screen whose missing heading round 36 fixed. Measured: with the fix reverted
    to a <span>, the registry-only scan stayed green.
    """
    found: set[Path] = set()
    shells = list((scan_base(root) / "ui" / "src" / "app").rglob("*.tsx"))
    for shell in shells:
        src = shell.read_text(encoding="utf-8")
        for match in SHELL_MOUNT_RE.finditer(src):
            target = match.group(2)
            if not target.startswith("@/"):
                continue
            candidate = scan_base(root) / "ui" / "src" / (target.replace("@/", "") + ".tsx")
            if not candidate.exists():
                continue
            # A shell also lazily mounts DIALOGS (WorkspaceSettingsModal). A
            # modal is not a page: it carries role="dialog" + aria-modal and a
            # level-two heading bound by aria-labelledby, which is correct. Only
            # something WITHOUT that role is a page here.
            body = _strip_comments(candidate.read_text(encoding="utf-8"))
            # Only a real dialog ROLE disqualifies it. A substring test on
            # "aria-modal" would also match a hotkey guard's COMMENT about one --
            # which is exactly what hid RetailPosScreen from this check on its
            # first run (RetailPosScreen.tsx:1835 mentions aria-modal in prose).
            if DIALOG_ROLE_RE.search(body) and ARIA_MODAL_RE.search(body):
                continue
            found.add(candidate.resolve())
    return sorted(found)

# MUTANT-PROOF SEAM (the r283 pattern, shared with verify-root-policy.py).
# A root parameter that the scan ignores is not a root parameter: it would let a
# ladder grade this checkout and pass a fixture that proves nothing. The
# provenance is therefore stored in a PLAIN MODULE GLOBAL -- main() must SET it,
# because a lookup helper that dereferenced `root` instead would leave the ladder
# free to pass None and the rung could not tell the two apart.
_ROOT = None


def fixture_root():
    """The temp root this file's fixtures go under (None = system default), created.

    The makedirs is the r250 lesson: a scratch dir removed between runs otherwise
    makes EVERY fixture fail before it grades anything. exist_ok keeps the common
    case a no-op.
    """
    root = next((os.environ[k] for k in TMP_ENV if os.environ.get(k)), None)
    if root:
        os.makedirs(root, exist_ok=True)
    return root


def _root_of():
    """The root main() was handed (None = this checkout), as a Path.

    ONE job, and it must never be a no-op: prove-ladder-kills.py's root-resolution
    rows anchor on this line, and a helper that DEREFERENCED a constant instead
    would make that mutation vanish from the harness's view entirely.
    """
    return ROOT if _ROOT is None else Path(_ROOT).resolve()


def scan_base(root=None):
    """The tree this run grades: the checkout, or the fixture main() was handed.

    Every path the scan reads -- the registrations, the shell mounts and the
    paths it REPORTS -- is derived from here (the r178 one-base rule).

    `root` is threaded from main() and is normally None, because main() records
    the fixture in _ROOT and this reads it back. The parameter exists so that the
    resolved base is one greppable line prove-ladder-kills.py can mutate: smuggle
    it through a call instead and the harness reports NO APPLICABLE MUTATION.
    """
    global _ROOT
    base = ROOT if root is None else Path(root).resolve()  # MUTANT-PROOF SEAM
    return base


def ui_src():
    """Where paths are REPORTED from: always relative to ui/src, never to REPO.

    check-page-headings prints "features/.../X.tsx", and the ladder anchors on that
    exact form. Deriving it from the scan base keeps a fixture's findings readable
    as page paths instead of as absolute temp paths.
    """
    return scan_base() / "ui" / "src"

def _rel(path: Path, root=None) -> str:
    """
    Page path as printed: relative to ui/src, whichever tree the run grades.

    A fixture's own ui/src is the reporting base for its screens and the
    checkout's for the checkout's. The fallback splits on the LAST /ui/src/ so a
    fixture path is still reported as features/... instead of raising. Measured
    2026-11-09: without it every rung died on an exception, not on a verdict.
    """
    screen_root = scan_base(root) / "ui" / "src"
    try:
        return path.relative_to(screen_root).as_posix()
    except ValueError:
        parts = path.as_posix().split("/ui/src/")
        return parts[-1] if len(parts) > 1 else path.as_posix()

def scan(root=None) -> tuple[list[str], list[str], int]:
    """Return (violations, delegating, total)."""
    # Resolved ONCE, at the top of the body: prove-ladder-kills.py mutates this
    # exact line to kill the sweep, and a half-sweep that still found some pages
    # would be the quiet failure.
    base = scan_base(root).resolve()
    screens = sorted(set(_registered_screens(root)) | set(_shell_mounted_screens(root)))
    # A fixture that scans NOTHING is exit 2 in main(), so a resolved base that
    # lost its pages cannot report "clean" by finding none of them.
    violations: list[str] = []
    delegating: list[str] = []
    for screen in screens:
        rel = _rel(screen)
        text = screen.read_text(encoding="utf-8")
        if _has_level_one_heading(text):
            continue
        # An EXPLICIT table entry is the answer when there is one, and it is asked
        # FIRST. _local_component_imports only follows one import level, so a
        # wrapper whose unrelated import happens to carry an h1 was being reported
        # as delegated without its listed children ever being read -- measured
        # 2026-11-09: rung 3's fixture named ZzFixpageInner.tsx (an import that
        # does not exist) instead of its table child, so the rung graded the wrong
        # arm entirely.
        inner_list = DELEGATING_WRAPPERS.get(rel)
        if inner_list is not None:
            missing: list[str] = []
            for inner in inner_list:
                inner_path = scan_base(root) / "ui" / "src" / inner
                if not inner_path.exists():
                    missing.append(f"{inner} (missing)")
                elif not _has_level_one_heading(inner_path.read_text(encoding="utf-8")):
                    missing.append(inner)
            if missing:
                violations.append(f"{rel}: delegated child(ren) with no level-one heading: {', '.join(missing)}")
            else:
                delegating.append(rel)
            continue
        # The heading may be rendered by a component the screen imports.
        if any(
            _has_level_one_heading(c.read_text(encoding="utf-8"))
            for c in _local_component_imports(screen)
        ):
            delegating.append(rel)
            continue
        violations.append(f"{rel}: no level-one heading")
    return violations, delegating, len(screens)



SELF_TEST_CASES = [
    # (label, source, expected_has_heading)
    ("plain h1", "<h1>Title</h1>", True),
    ("h1 with class", '<h1 className="sr-only">Title</h1>', True),
    ("h1 with newline attrs", "<h1\n  id=\"x\"\n>Title</h1>", True),
    ("role+aria-level 1", '<div role="heading" aria-level={1}>T</div>', True),
    ("aria-level first", '<div aria-level={1} role="heading">T</div>', True),
    ("h2 only", "<h2>Title</h2>", False),
    ("span title", '<span className="retail-header-name">Store</span>', False),
    ("no heading", "<div><p>hi</p></div>", False),
    ("h1 inside // comment", "// was an <h1> here\n<div />", False),
    ("h1 inside block comment", "/* the <h1> is gone */\n<div />", False),
    # A JSX comment `{/* ... */}` is NOT a /* */ block: the inner text is not a
    # comment start, so the comment stripper leaves it, and a <h1> inside one
    # must therefore still grade FALSE -- it renders nothing.
    ("h1 inside JSX comment", "{/* was <h1> here */}\n<div />", False),
    ("role heading far from aria-level", '<div role="heading">T</div>' + "x" * 200 + '<div aria-level={1} />', False),
    ("h10 is not h1", "<h10>x</h10>", False),
    # Present but UNREACHABLE. The first gate version counted these, which is
    # the same cannot-fail shape the gate exists to close.
    ("h1 behind {false &&}", "{false && <h1>T</h1>}", False),
    ("h1 behind {0 &&}", "{0 && <h1>T</h1>}", False),
    ("h1 behind {null &&}", "{null && <h1>T</h1>}", False),
    ("h1 behind a real condition", "{loaded && <h1>T</h1>}", True),
    ("h1 after a dead guard", "{false && <p/>}{<h1>T</h1>}", True),
]


def self_test() -> int:
    """Run the inline cases. Returns 0 when every case matches."""
    failures = 0
    for label, source, expected in SELF_TEST_CASES:
        got = _has_level_one_heading(source)
        status = "ok" if got == expected else "FAIL"
        if got != expected:
            failures += 1
        print(f"  {status:4} {label:28} expected={expected!s:5} got={got!s}")
    print(f"self-test: {len(SELF_TEST_CASES) - failures}/{len(SELF_TEST_CASES)} cases pass")
    if failures:
        return 1
    # The ladder must be CALLED, not merely defined, and it must be the LAST
    # thing self_test() does. r263 measured the failure this guards against: a
    # ladder that existed, satisfied the census TEXT match, and never ran --
    # --self-test printed the case line and no ladder line at all. The 18 cases
    # above remain the case COUNT; this line is where they become rungs.
    return shell_ladder()


#: The re-entry guard (the r228 pattern, shared with verify-root-policy.py and
#: verify-plugin-guide-parity.py): rung 6 drives a nested --self-test through
#: main(), whose self-test arm now ends in the call above. Without the guard that
#: nested run starts a SECOND ladder recursively.
_LADDER_RUNNING = False


def shell_ladder() -> int:
    """Re-entry guard: a nested self-test (rung 6) must not run a second ladder."""
    global _LADDER_RUNNING
    if _LADDER_RUNNING:
        # SILENT, and load-bearing: anything printed here lands in the nested
        # run's captured streams, which ANOTHER rung reads for the ladder line.
        return 0
    _LADDER_RUNNING = True
    try:
        return _shell_ladder_body()
    finally:
        _LADDER_RUNNING = False


def _shell_ladder_body() -> int:
    """
    Grade main()'s shell on throwaway trees that live OUTSIDE this repository.

    Each rung writes a ui/src/features corpus under a TemporaryDirectory beneath
    fixture_root(), hands it to main(argv=[...], root=fixture) and reads the
    verdict off BOTH captured streams. Nothing here reads or writes the real
    tree, and nothing reaches into the scan directly: a rung that cannot be
    observed from outside main() is not a rung.

    WHAT IS GRADED.
      * rung 1  one registered page with no heading -> exit 1, the count line, the
                violation naming that page, and NO "clean".
      * rung 2  the same tree WITH a heading -> exit 0 and no violation line, so
                an arm that always answers 1 cannot also pass this.
      * rung 3  the DELEGATING_WRAPPERS arm both ways: a child carrying the
                heading is reported "delegated" at exit 0; a bare child fails on
                the DELEGATED line naming the CHILD, never the wrapper itself.
      * rung 4  --self-test through argv: the 18 inline cases unchanged, exit 0,
                and the nested ladder skipped by the re-entry guard.
      * rung 5  a PURE base (heading-less shell, no registry, wrapper table
                emptied for the call) -> exit 2, never a clean "0 violations".
      * rung 6  an ABSENT root -> exit 2 instead of being scanned as an empty
                tree. This rung does not require the message to name the path:
                main() never prints the base, and an assertion may not demand a
                line the program does not emit.

    WHAT IT DOES NOT PROVE -- measured, not assumed. These rungs cannot show that
    main() OBEYS its root: a fixture and this checkout answer alike whenever the
    fallback is harmless, so a root-blind scan can still pass all six. That
    property is proven by scripts/prove-ladder-kills.py -- its scan-base mutation
    (scan_base returning REPO regardless of root) makes rung 1 print
    "BROKEN - no registered screens found" at exit 2.
    """
    import contextlib
    import io
    import tempfile

    NL = chr(10)
    PAGE = "app-shell.tsx"
    # Every fixture path below is ui/src-RELATIVE, because that is what the scan
    # walks and what _rel() reports from (features/...). The "<scratch>/ui/src/"
    # prefix is added at the build() boundary, so the constants stay readable as
    # the exact lines the verdict must print. Built WITHOUT a leading separator:
    # one would make Path() absolute and drop the fixture root entirely.
    UI = "ui" + chr(92) + "src" + chr(92)
    REGISTER = "features/zz-fixpage/register.tsx"
    SCREEN = "features/zz-fixpage/ZzFixpageScreen.tsx"
    S1 = "features/zz-fixpage/S1.tsx"
    S2 = "features/zz-fixpage/ZzFixpageInner.tsx"

    BARE = "<div />" + NL
    H1 = "<h1>Title</h1>" + NL

    def build(base, files):
        for rel, content in files.items():
            dst = Path(base) / (rel if rel == PAGE else UI + rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(content, encoding="utf-8")

    def grade(base, argv=()):
        """Return (rc, everything main() printed to either stream).

        A module global is deliberately NOT part of this: comparing one across the
        call was measured to read back a stale value once `global` was declared in
        this frame, so the ladder only ever grades what main() says.
        """
        out, err = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                rc = main(argv=list(argv), root=base)
        except SystemExit as se:            # argparse refuses the argv outright
            rc = se.code
        return rc, out.getvalue() + err.getvalue()

    shell = 0
    with tempfile.TemporaryDirectory(dir=fixture_root(),
                                     ignore_cleanup_errors=True) as td:
        base = Path(td)

        # rung 1 -- the KILLING rung, and it grades a VERDICT, not a scope refusal.
        # One registered screen with no heading. A main() that ignores its root
        # grades THIS checkout (55 screens, every one with a heading) and exits 0.
        root = base / "one"
        build(root, {
            PAGE: "export default function AppShell() { return null; }" + NL,
            REGISTER: 'const ZzFixpageScreen = lazy(() => import("./ZzFixpageScreen"));' + NL
                      + "registerPage({ component: ZzFixpageScreen });" + NL,
            SCREEN: "export default function S() { return " + BARE + " }" + NL,
        })
        rc, said = grade(root)
        if (rc != 1
                or "1 registered screen(s) with no level-one heading:" not in said
                or "  " + SCREEN + ": no level-one heading" not in said
                or "clean" in said):
            print("  x rung 1: a fixture whose only page has no heading must be "
                  "VERDICTED rc 1 naming " + SCREEN + " (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 2 -- the POSITIVE floor, and the one rung that separates "no findings"
        # from "nothing scanned". The page carries its heading and the verdict names
        # the number of pages it graded, so a sweep that lost the fixture (and would
        # otherwise fall through to this checkout's clean 55) cannot print this line.
        root = base / "two"
        build(root, {
            PAGE: "export default function AppShell() { return null; }" + NL,
            REGISTER: 'const ZzFixpageScreen = lazy(() => import("./ZzFixpageScreen"));' + NL
                      + "registerPage({ component: ZzFixpageScreen });" + NL,
            SCREEN: "export default function S() { return " + H1 + " }" + NL,
        })
        rc, said = grade(root)
        if (rc != 0 or "with no level-one heading" in said):
            print("  x rung 2: the same fixture WITH a heading must exit 0 with no "
                  "violation line (rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 3 -- the DELEGATING_WRAPPERS arm, which rung 1 CANNOT reach. A
        # wrapper with no heading of its own is not a violation while its child
        # carries one, so an arm that collapsed the wrapper into "no level-one
        # heading" would pass rung 1 and stay invisible everywhere else.
        #
        # The CHILD therefore carries the heading (the delegating path) and in
        # the twin it does not (the violation path). Graded NOT by mutating the
        # table -- a table keyed on a page the walk can only reach through UI_SRC
        # is reached by these fixtures only because this checkout is visible, so a
        # table-driven rung cannot fail on a fixture defect -- but by the delegated
        # LINE in a clean run, which carries the heading-less child's own path.
        root = base / "three"
        build(root, {
            PAGE: "export default function AppShell() { return null; }" + NL,
            REGISTER: 'const ZzFixpageScreen = lazy(() => import("./ZzFixpageScreen"));' + NL
                      + "registerPage({ component: ZzFixpageScreen });" + NL,
            SCREEN: "export default function S() { return <S1 />; }" + NL,
            S1: 'import ZzFixpageInner from "./ZzFixpageInner";' + NL
                + "export default function S1() { return <ZzFixpageInner />; }" + NL,
        })
        saved = dict(DELEGATING_WRAPPERS)
        DELEGATING_WRAPPERS[SCREEN] = [S2]
        try:
            # rung 3a -- the delegating PATH: the child renders the level-one
            # heading, so the page must be reported as delegated and exit 0.
            build(root, {S2: "export default function S2() { return " + H1 + " }" + NL})
            rc, said = grade(root)
            if (rc != 0
                    or "  delegated  " + SCREEN not in said
                    or " with no level-one heading" in said):
                print("  x rung 3: a wrapper whose delegated child carries the heading "
                      "must be reported delegated and exit 0 (rc=%r said=%r)"
                      % (rc, said[-400:]), file=sys.stderr)
                return 1
            # rung 3b -- the VIOLATION path: the same child, heading-less. The line
            # must be the DELEGATED one naming that child, not the wrapper's own
            # "no level-one heading", which rung 1 already proves.
            build(root, {S2: "export default function S2() { return " + BARE + " }" + NL})
            rc, said = grade(root)
        finally:
            DELEGATING_WRAPPERS.clear()
            DELEGATING_WRAPPERS.update(saved)
        if (rc != 1
                or ("delegated child(ren) with no level-one heading: " + S2) not in said
                or (SCREEN + ": no level-one heading") in said):
            print("  x rung 3: a wrapper whose delegated child has no heading must "
                  "exit 1 naming ONLY " + S2 + " (rc=%r said=%r)" % (rc, said[-400:]),
                  file=sys.stderr)
            return 1
        shell += 1

        # rung 4 -- the --self-test arm through argv. The re-entry guard is what
        # the "skipped" assertion measures: the LADDER line printed directly
        # below can only be present if the nested run did NOT start a second one.
        root = base / "four"
        build(root, {PAGE: "export default function AppShell() { return null; }" + NL})
        rc, said = grade(root, ("--self-test",))
        if rc != 0 or "18/18 cases pass" not in said or "self-test: 18/18" not in said:
            print("  x rung 4: --self-test through argv must print the unchanged 18 "
                  "cases and exit 0 (rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 5 -- a PURE refusal: nothing under the base carries a heading, and
        # there is no registry to read. Exit 2 must NAME the base, so a scan that
        # found nothing and reported it as clean cannot pass here.
        root = base / "five"
        build(root, {PAGE: "export default function AppShell() { return null; }" + NL})
        # The table is emptied for this call only: its real keys are pages that
        # exist under UI_SRC, and leaving them in would let a root-blind scan pass
        # a "pure" fixture on this checkout's traffic. Restored in finally.
        saved = dict(DELEGATING_WRAPPERS)
        DELEGATING_WRAPPERS.clear()
        try:
            rc, said = grade(root)
        finally:
            DELEGATING_WRAPPERS.update(saved)
        if rc != 2 or "BROKEN - no registered screens found" not in said or "clean" in said:
            print("  x rung 5: a base with no registrations and no headings must refuse "
                  "rc 2, not report clean (rc=%r said=%r)"
                  % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

        # rung 6 -- the SCOPE refusal, kept separate from every verdict rung: an
        # ABSENT root must exit 2 rather than be scanned as an empty tree. This
        # rung does NOT require the message to name the path. Measured: main()
        # does not print the base at all, and no assertion may demand a line the
        # program never emits -- so the claim checked here is absence-is-refused.
        root = base / "six"
        rc, said = grade(root)
        if rc != 2 or "BROKEN - no registered screens found" not in said or "clean" in said:
            print("  x rung 6: an absent fixture root must refuse rc 2, not report clean "
                  "(rc=%r said=%r)" % (rc, said[-400:]), file=sys.stderr)
            return 1
        shell += 1

    print("LADDER OK (" + str(shell) + " shell rungs through main(): verdict, shell "
          "mount, delegating child, nested --self-test, pure refusal, scope refusal)")
    return 0


def main(argv: list[str], root=None) -> int:
    global _ROOT
    parser = argparse.ArgumentParser(description="Every registered page screen needs an h1.")
    parser.add_argument("--self-test", action="store_true", help="run the inline cases")
    parser.add_argument("--list", action="store_true", help="list the graded screens")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    violations, delegating, total = scan(root)
    if total == 0:
        print("check-page-headings: BROKEN - no registered screens found", file=sys.stderr)
        return 2

    if args.list:
        # BOTH sources: --list that printed only the registry would understate the
        # graded set by 8 shell-mounted screens and contradict this file's claim
        # that every page is covered.
        for screen in sorted(set(_registered_screens()) | set(_shell_mounted_screens())):
            print(_rel(screen))
        return 0

    for rel in delegating:
        print(f"  delegated  {rel}")

    if violations:
        print(f"check-page-headings: {len(violations)} registered screen(s) with no level-one heading:", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        print("", file=sys.stderr)
        print("A page needs exactly one <h1>. axe cannot grade this under jsdom", file=sys.stderr)
        print("(page-has-heading-one aborts with error-occurred), which is why this", file=sys.stderr)
        print("check exists; see ui/src/__tests__/a11y/axe-helper.tsx.", file=sys.stderr)
        return 1

    print(f"check-page-headings: clean - {total} registered screen(s), every one carries a level-one heading")
    if delegating:
        print(f"  ({len(delegating)} graded through the component they wrap)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
