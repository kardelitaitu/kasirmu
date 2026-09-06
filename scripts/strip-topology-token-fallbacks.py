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


def main() -> int:
    check = "--check" in sys.argv[1:]
    original = CSS.read_text(encoding="utf-8")
    updated, changes = strip(original)

    if not changes:
        print(f"{CSS}: no stale token fallbacks remain.")
        return 0

    if check:
        print(f"{CSS}: {len(changes)} stale token fallback(s) remain:")
        for change in changes:
            print(f"  - {change}")
        print("  Fix: python3 scripts/strip-topology-token-fallbacks.py")
        return 1

    CSS.write_text(updated, encoding="utf-8")
    print(f"{CSS}: dropped {len(changes)} stale token fallback(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
