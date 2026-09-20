#!/usr/bin/env python3
"""
Fix all mismatched CSS fallback values across the OZ-POS UI.

Replaces known-bad fallbacks in var(--token, fallback) with the correct
value from tokens.css. For tokens that are always defined on :root,
the fallback is removed entirely (bare var(--token)).

Run after: python scripts/fix-css-fallbacks.py
Verify:    python scripts/scan-css-tokens.py
"""

import os
import re
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
# THM-01: the design tokens live in ui/src/theme/tokens.css.
# (The old ui/src/styles/tokens.css path never existed — the fixer
# silently no-opped against the wrong file. The path then went stale a SECOND
# time: 7866197c7 renamed frontend/themes to theme/ and fixed every reference
# except the ones under scripts/, so the fixer no-opped again — this time by
# raising FileNotFoundError on parse_tokens. Both stale names are kept here so
# the next rename has something to grep for.)
TOKENS_FILE = PROJECT_ROOT / "ui" / "src" / "theme" / "tokens.css"
UI_SRC_DIR = PROJECT_ROOT / "ui" / "src"
EXCLUDE_DIRS = {"node_modules"}

# ── Parse tokens ─────────────────────────────────────────────────────────

TOKEN_DEF_RE = re.compile(r"^\s{2}--([a-zA-Z0-9_/-]+):\s*(.+?);\s*$")
COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

def parse_tokens(filepath: Path) -> dict[str, str]:
    text = filepath.read_text(encoding="utf-8")
    text = COMMENT_BLOCK_RE.sub("", text)
    tokens: dict[str, str] = {}
    in_root = False
    brace_depth = 0
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == ":root {":
            in_root = True
            brace_depth = 1
            continue
        if in_root:
            brace_depth += stripped.count("{")
            brace_depth -= stripped.count("}")
            if brace_depth <= 0:
                break
            m = TOKEN_DEF_RE.match(line)
            if m:
                tokens[m.group(1)] = m.group(2).strip()
    return tokens


# ── Replacement rules ─────────────────────────────────────────────────────
#
# Each rule is (search_pattern, replacement). The search_pattern is a regex
# that matches var(--TOKEN, FALLBACK). The replacement captures the token
# name and replaces the fallback.
#
# For tokens ALWAYS defined on :root, we use a bare var(--token) with no
# fallback. For tokens that might be context-dependent, we keep a corrected
# fallback.

def build_rules(tokens: dict[str, str]) -> list[tuple[re.Pattern, str]]:
    """
    Build replacement rules for each mismatched token.
    Returns list of (compiled_regex, replacement_template).
    """
    rules = []

    # Tokens that are always defined on :root — safe to drop fallback entirely
    always_defined = {
        "--z-modal", "--z-dropdown",
        "--ease-out", "--ease-in",
        "--radius-lg", "--radius-sm", "--radius-xl",
        "--text-xs", "--text-sm", "--text-base", "--text-lg",
        "--shadow-lg", "--shadow-xl",
        "--color-accent-fg", "--color-bg-elevated", "--color-bg-primary",
        "--color-danger-fg",
    }

    for token_name, actual_value in tokens.items():
        css_token = f"--{token_name}"
        if css_token not in always_defined:
            continue
        actual_clean = actual_value.strip().lower()
        # Build regex: var(--token-name\s*,\s*<fallback>)
        # Match any fallback, not just specific ones - catches all.
        #
        # IMPORTANT (THM-01): the fallback may itself contain parentheses
        # (e.g. rgba(16, 82, 188, 0.08), var(--other-token), or multi-stop
        # shadows). A naive `[^)]*` stops at the FIRST `)`, which for
        # `var(--x, rgba(1, 2, 3, 0.5))` leaves a dangling `)` behind and
        # produces the broken `var(--x))`. Use a balanced-paren group
        # instead: any run of non-paren chars, or a single paren group
        # without nesting (covers rgba()/var()/gradient fallbacks).
        pattern = re.compile(
            rf"var\(--{re.escape(token_name)}\s*,\s*(?:[^()]|\([^()]*\))*\)",
            re.IGNORECASE,
        )
        # Replace with bare var(--token-name)
        replacement = f"var(--{token_name})"
        rules.append((pattern, replacement))

    # ── Special cases: fallback hexes that differ from actual ──────────
    # `--color-accent-fg, #fff` -> actual is #ffffff
    # These are functionally identical in CSS, but let's fix to be consistent
    # We already handled these above via the general rule

    # ── Shadow fallbacks (different shadow values) ────────────────────
    # --shadow-xl: 0 20px 25px -5px rgba(...), 0 8px 10px -6px rgba(...)
    # But some files use 0 8px 32px rgba(0,0,0,0.2) as fallback - completely different
    # These are covered by the general rule above (drop fallback entirely)

    return rules


def find_all_css_files(directory: Path) -> list[Path]:
    files = []
    for root, dirs, filenames in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in filenames:
            if f.endswith(".css"):
                files.append(Path(root) / f)
    return sorted(files)


# ── Also handle z-index with specific wrong fallback numbers ──────────────
# The general rule above catches var(--z-modal, ...), but let me also
# create targeted fixes for the specific wrong z-index values.
# Actually, the general rule handles ALL var(--z-modal, <anything>) patterns.

Z_INDEX_FIXES = [
    # (file_contains_pattern, from_text, to_text)
    # These are handled by the general rule via --z-modal and --z-dropdown
]


def fix_file(filepath: Path, rules: list[tuple[re.Pattern, str]]) -> bool:
    """Apply rules to a file. Returns True if changes were made."""
    original = filepath.read_text(encoding="utf-8")
    modified = original

    for pattern, replacement in rules:
        modified = pattern.sub(replacement, modified)

    if modified != original:
        filepath.write_text(modified, encoding="utf-8")
        return True
    return False


def main():
    print("=" * 72)
    print("  OZ-POS CSS Fallback Fix Script")
    print("=" * 72)
    print()

    tokens = parse_tokens(TOKENS_FILE)
    print(f"[TOKENS] Parsed {len(tokens)} tokens from tokens.css")
    print()

    rules = build_rules(tokens)
    print(f"[RULES] Built {len(rules)} replacement rules")
    print()

    css_files = find_all_css_files(UI_SRC_DIR)
    # Exclude tokens.css itself
    css_files = [f for f in css_files if f.resolve() != TOKENS_FILE.resolve()]
    print(f"[FILES] Found {len(css_files)} CSS files to scan")
    print()

    changed_files = []
    for css_file in css_files:
        if fix_file(css_file, rules):
            rel_path = css_file.relative_to(PROJECT_ROOT)
            changed_files.append(rel_path)

    print(f"[DONE] Fixed {len(changed_files)} files:")
    for path in changed_files:
        print(f"       {path}")
    print()

    # ── Summary by token type ─────────────────────────────────────────
    print("=" * 72)
    print("  SUMMARY")
    print("=" * 72)
    total_replacements = 0
    for pattern, replacement in rules:
        # Count how many times this pattern matched
        count = 0
        for css_file in css_files:
            text = css_file.read_text(encoding="utf-8")
            count += len(pattern.findall(text))
        if count > 0:
            # Extract token name from pattern
            token_match = re.search(r"--([a-zA-Z0-9_/-]+)", pattern.pattern)
            token = token_match.group(1) if token_match else "?"
            total_replacements += count
            print(f"  {token:30s}  {count:3d} replacements  {replacement}")

    print(f"\n  Total replacements made: {total_replacements}")
    print()

    # Note: some replacements may have been applied in a previous pass
    # (like the 2 --color-bg-elevated fixes). Run the scanner to verify.


if __name__ == "__main__":
    main()
