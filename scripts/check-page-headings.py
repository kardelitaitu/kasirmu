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
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
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


def _registered_screens() -> list[Path]:
    """Return every *Screen.tsx file imported by a registerPage({ component }) call.

    The registry is the definition of "a page", so the walk starts there rather
    than from a directory listing -- a screen nothing routes to is not a page and
    grading it would fail on dead code instead of on a defect.
    """
    screens: set[Path] = set()
    registrations = list(FEATURES.rglob("register.tsx")) + list(FEATURES.rglob("register.ts"))
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
                candidate = UI_SRC / (target + ".tsx")
            else:
                candidate = (reg.parent / target).resolve()
                if not candidate.suffix:
                    candidate = candidate.with_suffix(".tsx")
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


def _shell_mounted_screens() -> list[Path]:
    """Return screens the SHELLS mount directly, outside the page registry.

    Not every page is a registered route. RetailPosScreen is chosen by the
    store-pos BRANCH inside AppShell.tsx and TabletAppShell.tsx, so it has no
    registerPage entry -- and a registry-only scan silently skipped the very
    screen whose missing heading round 36 fixed. Measured: with the fix reverted
    to a <span>, the registry-only scan stayed green.
    """
    found: set[Path] = set()
    shells = list((UI_SRC / "app").rglob("*.tsx"))
    for shell in shells:
        src = shell.read_text(encoding="utf-8")
        for match in SHELL_MOUNT_RE.finditer(src):
            target = match.group(2)
            if not target.startswith("@/"):
                continue
            candidate = UI_SRC / (target.replace("@/", "") + ".tsx")
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

def _rel(path: Path) -> str:
    return path.relative_to(UI_SRC).as_posix()


def scan() -> tuple[list[str], list[str], int]:
    """Return (violations, delegating, total)."""
    screens = sorted(set(_registered_screens()) | set(_shell_mounted_screens()))
    violations: list[str] = []
    delegating: list[str] = []
    for screen in screens:
        rel = _rel(screen)
        text = screen.read_text(encoding="utf-8")
        if _has_level_one_heading(text):
            continue
        # The heading may be rendered by a component the screen imports.
        if any(
            _has_level_one_heading(c.read_text(encoding="utf-8"))
            for c in _local_component_imports(screen)
        ):
            delegating.append(rel)
            continue
        inner_list = DELEGATING_WRAPPERS.get(rel)
        if inner_list is not None:
            missing: list[str] = []
            for inner in inner_list:
                inner_path = UI_SRC / inner
                if not inner_path.exists():
                    missing.append(f"{inner} (missing)")
                elif not _has_level_one_heading(inner_path.read_text(encoding="utf-8")):
                    missing.append(inner)
            if missing:
                violations.append(f"{rel}: delegated child(ren) with no level-one heading: {', '.join(missing)}")
            else:
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
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Every registered page screen needs an h1.")
    parser.add_argument("--self-test", action="store_true", help="run the inline cases")
    parser.add_argument("--list", action="store_true", help="list the graded screens")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    violations, delegating, total = scan()
    if total == 0:
        print("check-page-headings: BROKEN - no registered screens found", file=sys.stderr)
        return 2

    if args.list:
        for screen in _registered_screens():
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
