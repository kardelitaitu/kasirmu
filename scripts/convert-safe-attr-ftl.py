#!/usr/bin/env python3
"""Targeted conversion: convert only the safe attribute-only FTL keys to key=value.

Safe = used via l10n.getString() without fallback AND NOT via <Localized>.
"""
import re
import sys
from pathlib import Path

# These 72 keys are used ONLY via l10n.getString (no <Localized> usage)
# So converting attribute-only -> key=value is safe.
SAFE_KEYS = {
    "audit-log-filter-label", "audit-log-search-label", "audit-log-search-placeholder",
    "categories-colour-picker-aria", "categories-icon-picker-aria",
    "category-colour-picker-aria", "kiosk-attract-label", "language-selector-select-aria",
    "modal-close-aria", "nav-main-aria", "nav-tablist-aria",
    "payment-quick-tender-aria",
    "pos-cart-charge-aria", "pos-cart-clear-aria", "pos-cart-discount-cancel-aria",
    "pos-cart-discount-label-aria", "pos-cart-discount-pct-aria",
    "pos-cart-discount-remove-aria", "pos-cart-open-bill-aria",
    "pos-cart-open-bills-aria", "pos-cart-table-placeholder", "pos-cart-undo-dismiss-aria",
    "pos-close-shift-balance-aria", "pos-close-shift-notes-aria",
    "pos-close-shift-overlay-aria", "pos-close-shift-summary-aria",
    "pos-dismiss-error-aria", "pos-open-bill-name-aria", "pos-open-bill-overlay-aria",
    "pos-open-bill-placeholder", "pos-open-bills-close-aria",
    "pos-open-bills-overlay-aria", "pos-open-shift-balance-aria",
    "pos-open-shift-overlay-aria", "pos-shift-close-aria", "pos-shift-open-aria",
    "product-mgmt-modal-aria", "refund-dialog-aria", "refund-note-aria",
    "refund-reason-aria", "refund-qty-decrease-aria", "refund-qty-increase-aria",
    "restaurant-categories-aria", "restaurant-clear-color-aria",
    "restaurant-font-size-decrease-aria", "restaurant-font-size-increase-aria",
    "restaurant-menu-back-aria", "restaurant-menu-hamburger-aria",
    "restaurant-menu-search-placeholder", "restaurant-size-decrease-aria",
    "restaurant-size-increase-aria", "settings-sidebar-search-clear-aria",
    "shortfall-dialog-aria",
    "staff-field-username-aria", "staff-login-close-aria", "staff-login-keypad-aria",
    "staff-login-next-aria", "staff-login-pin-aria", "staff-login-pin-section-aria",
    "staff-login-progress-aria",
    "stock-transfers-destination-placeholder", "stock-transfers-product-placeholder",
    "stock-transfers-remove-line", "stock-transfers-sku-placeholder",
    "stock-transfers-source-placeholder",
    "tax-config-field-name-placeholder", "tax-config-field-rate-placeholder",
    "tax-config-tax-type-aria",
    "terminal-field-device-id-aria", "terminal-field-metadata-aria",
    "terminal-field-secret-aria",
    "toast-dismiss-aria", "toast-notifications-aria",
    "update-banner-dismiss-aria",
}


def convert_file(filepath: Path, safe_keys: set[str]) -> int:
    lines = filepath.read_text(encoding='utf-8').split('\n')
    i = 0
    changes = 0
    new_lines = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        m = re.match(r'^([a-z][a-z0-9_-]*) = *$', stripped)
        if m:
            key = m.group(1)
            if key not in safe_keys:
                new_lines.append(line)
                i += 1
                continue

            # Count attributes
            attr_count = 0
            attr_idx = i + 1
            while attr_idx < len(lines):
                s = lines[attr_idx].lstrip()
                if s.startswith('.'):
                    attr_count += 1
                    attr_idx += 1
                elif s == '' or s.startswith('#'):
                    attr_idx += 1
                else:
                    break

            if attr_count == 1:
                # Find the attribute line
                attr_line_idx = i + 1
                while attr_line_idx < len(lines):
                    if lines[attr_line_idx].lstrip().startswith('.'):
                        break
                    attr_line_idx += 1

                attr_line = lines[attr_line_idx]
                attr_match = re.match(r'^(\s+)\.\S+\s*=\s*(.+)$', attr_line)
                if attr_match:
                    value = attr_match.group(2)
                    key_indent = re.match(r'^(\s*)', line).group(1)
                    new_lines.append(f'{key_indent}{key} = {value}')
                    i = attr_line_idx + 1
                    changes += 1
                    continue

            new_lines.append(line)
        else:
            new_lines.append(line)
        i += 1

    if changes > 0:
        filepath.write_text('\n'.join(new_lines), encoding='utf-8')
        print(f'  {filepath.name}: {changes} conversions')
    return changes


def main():
    # Anchor to this script's location, not the caller's CWD, so the
    # conversion runs from any checkout path or worktree.
    locales_dir = (
        Path(__file__).resolve().parent.parent / "shared-ui" / "locales"
    )
    if not locales_dir.exists():
        print(f'Error: {locales_dir} not found', file=sys.stderr)
        sys.exit(1)

    total = 0
    for ftl_file in sorted(locales_dir.glob('*.ftl')):
        c = convert_file(ftl_file, SAFE_KEYS)
        total += c

    print(f'\nTotal: {total} conversions across all FTL bundles')


if __name__ == '__main__':
    main()
