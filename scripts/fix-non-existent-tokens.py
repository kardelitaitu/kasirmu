#!/usr/bin/env python3
"""
Fix truly non-existent CSS tokens across the kasir.mu UI.

These are tokens used in var() calls that are NOT defined anywhere
(locally or in tokens.css). Maps each to the correct design token.
"""

import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UI_SRC = PROJECT_ROOT / "ui" / "src"

# ── Replacement rules per file ────────────────────────────────────────────
# Each rule: (file_path_relative_to_ui_src, [(old_string, new_string), ...])

RULES: list[tuple[str, list[tuple[str, str]]]] = [
    # ── DataManagementScreen.css (--space-*) ──────────────────────────
    ("features/settings/DataManagementScreen.css", [
        ("var(--space-lg)", "var(--space-6)"),       # padding, margin
        ("var(--space-md)", "var(--space-4)"),       # gap, padding
        ("var(--space-sm)", "var(--space-2)"),       # padding, gap
        ("var(--space-xs)", "var(--space-1)"),       # gap, padding
        ("var(--space-xl)", "var(--space-8)"),       # margin-bottom
        ("var(--space-2xl)", "var(--space-12)"),     # padding
    ]),

    # ── FeatureToggleScreen.css (--space-*) ───────────────────────────
    ("features/settings/FeatureToggleScreen.css", [
        ("var(--space-lg)", "var(--space-6)"),
        ("var(--space-md)", "var(--space-4)"),
        ("var(--space-sm)", "var(--space-2)"),
        ("var(--space-xl)", "var(--space-8)"),
        ("var(--space-2xl)", "var(--space-12)"),
    ]),

    # ── StockCountDetail.css (old legacy tokens) ──────────────────────
    ("features/inventory/StockCountDetail.css", [
        ("var(--bg-muted, #f3f4f6)", "var(--color-bg-surface)"),   # header bg
        ("var(--bg-muted, #f9fafb)", "var(--color-bg-surface)"),   # total bg
        ("var(--text-muted, #666)", "var(--color-fg-tertiary)"),   # label color
    ]),

    # ── StockCountHistory.css (old legacy tokens) ─────────────────────
    ("features/inventory/StockCountHistory.css", [
        ("var(--bg-muted, #f3f4f6)", "var(--color-bg-surface)"),   # th bg
        ("var(--bg-card, #fff)", "var(--color-bg-elevated)"),      # item bg
        ("var(--accent, #2563eb)", "var(--color-accent)"),         # selected border
    ]),

    # ── StockCountForm.css (old legacy tokens) ────────────────────────
    ("features/inventory/StockCountForm.css", [
        ("var(--bg-card, #fff)", "var(--color-bg-elevated)"),      # card bg
        ("var(--accent, #2563eb)", "var(--color-accent)"),         # active btn bg
        ("var(--accent, #2563eb)", "var(--color-accent)"),         # active btn border
    ]),

    # ── SalesReportScreen.css ─────────────────────────────────────────
    ("features/reports/SalesReportScreen.css", [
        ("var(--radius-xs, 2px)", "var(--radius-sm)"),
    ]),

    # ── PromotionManagementScreen.css ─────────────────────────────────
    ("features/promotions/PromotionManagementScreen.css", [
        ("var(--color-surface, #fff)", "var(--color-bg-elevated)"), # input bg
    ]),

    # ── PaymentModal.css customer section (legacy color tokens) ──────
    ("features/sales/PaymentModal.css", [
        # Text colors
        ("var(--color-text-1, #222)", "var(--color-fg)"),
        ("var(--color-text-1, #333)", "var(--color-fg)"),
        ("var(--color-text-3, #555)", "var(--color-fg-secondary)"),
        ("var(--color-text-4, #888)", "var(--color-fg-tertiary)"),
        ("var(--color-text-4, #999)", "var(--color-fg-tertiary)"),

        # Border colors
        ("var(--color-border-3, #aaa)", "var(--color-border)"),

        # Success colors
        ("var(--color-success-2, #e8f5e9)", "var(--color-success-bg)"),
        ("var(--color-success-7, #2e7d32)", "var(--color-success)"),
        ("var(--color-success-6, #27ae60)", "var(--color-success)"),

        # Warning colors
        ("var(--color-warning-1, #fef9e7)", "var(--color-warning-bg)"),
        ("var(--color-warning-3, #f9e79f)", "var(--color-warning)"),
        ("var(--color-warning-3, #f9e79f)", "var(--color-warning)"),
        ("var(--color-warning-5, #f39c12)", "var(--color-warning)"),
        ("var(--color-warning-6, #e67e22)", "var(--color-warning)"),
        ("var(--color-warning-8, #7d6608)", "var(--color-warning)"),

        # Danger colors
        ("var(--color-danger-6, #e74c3c)", "var(--color-danger)"),
        ("var(--color-danger-1, #fdf2f2)", "var(--color-danger-bg)"),
    ]),
]


def fix_file(rel_path: str, replacements: list[tuple[str, str]]) -> bool:
    filepath = UI_SRC / rel_path
    if not filepath.exists():
        print(f"  SKIP: {rel_path} (not found)")
        return False

    text = filepath.read_text(encoding="utf-8")
    original = text
    change_count = 0

    for old, new in replacements:
        # Count occurrences before replacement
        count = text.count(old)
        if count == 0:
            continue
        text = text.replace(old, new)
        change_count += count
        print(f"    {old:55s} -> {new}  ({count}x)")

    if text != original:
        filepath.write_text(text, encoding="utf-8")
        print(f"  [CHANGED] {rel_path}  ({change_count} replacements)")
        return True
    else:
        print(f"  [NO CHANGE] {rel_path}")
        return False


def main():
    print("=" * 72)
    print("  Fix Non-Existent CSS Tokens")
    print("=" * 72)
    print()

    total_files = 0
    total_replacements = 0

    for rel_path, replacements in RULES:
        print(f"\n--- {rel_path} ---")
        filepath = UI_SRC / rel_path
        if not filepath.exists():
            print(f"  SKIP: not found")
            continue

        text = filepath.read_text(encoding="utf-8")
        original = text
        file_changes = 0

        for old, new in replacements:
            count = text.count(old)
            if count == 0:
                continue
            text = text.replace(old, new)
            file_changes += count
            print(f"    {old:55s} -> {new}  ({count}x)")

        if text != original:
            filepath.write_text(text, encoding="utf-8")
            total_files += 1
            total_replacements += file_changes
            print(f"  => {file_changes} replacement(s) applied")
        else:
            print(f"  => No changes needed")

    print(f"\n{'=' * 72}")
    print(f"  SUMMARY: {total_files} files changed, {total_replacements} replacements")
    print(f"{'=' * 72}")


if __name__ == "__main__":
    main()
