#!/usr/bin/env python3
"""Drop stale design-token fallbacks from the topology stylesheet.

ADR #45 §5. Every `var(--token, <literal>)` in NodeTopologyEditor.css was
audited against ui/src/frontend/themes/tokens.css, and the result is not
close: NONE of the 28 hex fallbacks matches the value of the token it falls
back from. `--color-success` carries three different fallbacks in one file
(#10b981, #22c55e, #4caf50) while the real token is #2E9E3E / #6FE884.
`--text-xs` falls back to 0.75rem against a real 0.625rem. `--font-weight-bold`
falls back to 600 against a real 700.

So a fallback here is not insurance. It is a second, wrong palette that stays
invisible while the token resolves — which is always — and paints the wrong
thing the moment it does not. Several are actively theme-inverting:
`--color-bg-surface, #161b2e` would put a near-black panel inside the light
theme, and `--color-info-subtle, #e8f0fe` an opaque pale chip on the dark one.

Every token used here is defined in tokens.css, so the literals go. The two
runtime-set cursor tokens (`--mouse-x`, `--mouse-y`) keep their 50% default:
they are written by JS on hover, so before the first pointer event there is
genuinely no value, and that fallback is the only thing that makes the
spotlight render at rest.

Usage:
    python3 scripts/strip-topology-token-fallbacks.py [--check]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CSS = Path("ui/src/features/locations/NodeTopologyEditor.css")

# var(--token, <literal>) where the fallback is a plain value, not a nested
# var(). The fallback body excludes ')' so nested calls are left alone here and
# handled by NESTED below.
LITERAL = re.compile(r"var\((--[a-z0-9-]+),\s*([^()]*)\)")

# Fallbacks that are themselves var() calls. Each is spelled out because the
# right answer differs per token and none of them is a safe alias:
# `--color-warning-subtle` falling back to `--color-accent-subtle` would render
# a blue chip where an amber one is meant.
NESTED = [
    "var(--color-border-subtle, var(--color-border))",
    "var(--color-success-fg, var(--color-fg))",
    "var(--color-warning-fg, var(--color-fg-muted))",
    "var(--color-warning-subtle, var(--color-accent-subtle))",
]

# Tokens genuinely absent until runtime sets them.
KEEP = {"--mouse-x", "--mouse-y"}


def strip(text: str) -> tuple[str, list[str]]:
    changes: list[str] = []

    for nested in NESTED:
        token = nested.partition("(")[2].split(",")[0]
        if token in KEEP:
            continue
        replacement = f"var({token})"
        if nested in text:
            text = text.replace(nested, replacement)
            changes.append(f"{nested}  ->  {replacement}")

    def replace(match: re.Match[str]) -> str:
        token, fallback = match.group(1), match.group(2)
        if token in KEEP or fallback.startswith("var("):
            return match.group(0)
        changes.append(f"var({token}, {fallback})  ->  var({token})")
        return f"var({token})"

    return LITERAL.sub(replace, text), changes


def main(argv=None, root=None) -> int:
    """r205: argv and root parameterized, the r166..r204 contract -- the
    stylesheet is resolved under the contract root, so the WRITE path is
    graded against a fixture tree instead of this checkout."""
    check = "--check" in (sys.argv[1:] if argv is None else argv)
    css = CSS if CSS.is_absolute() else (
        Path(__file__).resolve().parent.parent if root is None else Path(root).resolve()
    ) / CSS
    try:
        original = css.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"verify-strip-token-fallbacks: cannot read {css} -- {exc}")
        return 1
    updated, changes = strip(original)

    if not changes:
        print(f"{css}: no stale token fallbacks remain.")
        return 0

    if check:
        print(f"{css}: {len(changes)} stale token fallback(s) remain:")
        for change in changes:
            print(f"  - {change}")
        print("  Fix: python3 scripts/strip-topology-token-fallbacks.py")
        return 1

    css.write_text(updated, encoding="utf-8")
    print(f"{css}: dropped {len(changes)} stale token fallback(s).")
    return 0


def self_test() -> int:
    """r205: the shell -- main() graded through argv and a contract root, the
    r166..r204 pattern. The fixture carries stale fallbacks so --check and
    the apply write are graded against a throwaway tree; a root-dropping
    main reads THIS checkout's stylesheet (clean since ADR #45's strip
    landed) and answers clean on the first rung."""
    import contextlib as _ctx
    import io as _io
    import tempfile as _tempfile
    shell = 0
    STALE = ("a {\n"
             "  color: var(--color-success, #10b981);\n"
             "  border: var(--color-border-subtle, var(--color-border));\n"
             "  left: var(--mouse-x, 50%);\n"
             "}\n")
    def run(tdp, *argv):
        out, err = _io.StringIO(), _io.StringIO()
        try:
            with _ctx.redirect_stdout(out), _ctx.redirect_stderr(err):
                rc = main(argv=list(argv), root=tdp)
        except SystemExit as se:
            return se.code, out.getvalue() + err.getvalue()
        return rc, out.getvalue() + err.getvalue()
    def tree(content):
        tdp = Path(_tempfile.mkdtemp())
        f = tdp / "ui" / "src" / "features" / "locations"
        f.mkdir(parents=True)
        (f / "NodeTopologyEditor.css").write_text(content, encoding="utf-8")
        return tdp, f / "NodeTopologyEditor.css"
    shell += 1
    tdp, _ = tree(STALE)
    rc, text = run(tdp, "--check")
    if rc != 1 or "2 stale token fallback(s) remain" not in text:
        print("  x a stale fallback must be reported rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    tdp, _ = tree("a { color: var(--color-success); }\n")
    rc, text = run(tdp, "--check")
    if rc != 0 or "no stale token fallbacks remain" not in text:
        print("  x a clean stylesheet must pass rc 0 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    shell += 1
    tdp, css = tree(STALE)
    rc, text = run(tdp)
    if rc != 0 or "dropped 2 stale token fallback(s)" not in text:
        print("  x apply mode must drop the literal and the nested arm (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1
    back = css.read_text(encoding="utf-8")
    if "#10b981" in back or "var(--color-border-subtle, var(--color-border))" in back:
        print("  x the applied file must have both fallbacks stripped (back=%r)"
              % back, file=sys.stderr)
        return 1
    if "var(--mouse-x, 50%)" not in back:
        print("  x the runtime cursor token's fallback must survive (back=%r)"
              % back, file=sys.stderr)
        return 1
    if "var(--color-success)" not in back or "var(--color-border-subtle)" not in back:
        print("  x the stripped tokens must remain as bare var() (back=%r)"
              % back, file=sys.stderr)
        return 1
    shell += 1
    tdp = Path(_tempfile.mkdtemp())
    rc, text = run(tdp, "--check")
    if rc != 1 or "cannot read" not in text:
        print("  x a missing stylesheet must refuse rc 1 (rc=%r text=%r)"
              % (rc, text[-90:]), file=sys.stderr)
        return 1

    print("SELF-TEST OK (%d shell cases through argv and root, "
          "no repository file touched)" % shell)
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else main())
