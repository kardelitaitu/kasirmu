"""Find all ```ignore blocks in Rust files with context."""
import os

# Repo root = parent of scripts/, resolved from this file's location, so the
# script finds its targets no matter which checkout/worktree CWD it runs from.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

files_to_check = [
    'modules/crm/src/lib.rs',
    'modules/inventory/src/lib.rs',
    'modules/sales/src/lib.rs',
    'modules/settings/src/lib.rs',
    'modules/staff/src/lib.rs',
    'modules/tax/src/lib.rs',
    'crates/kasirmu-api/src/lib.rs',
    'crates/kasirmu-lua/src/bridge.rs',
    'crates/kasirmu-payment/src/drivers/mock.rs',
    'crates/kasirmu-payment/src/drivers/qris.rs',
    'crates/kasirmu-payment/src/drivers/square.rs',
    'crates/kasirmu-payment/src/drivers/stripe.rs',
    'crates/kasirmu-plugin/src/lib.rs',
    'crates/kasirmu-security/src/lib.rs',
    'platform/core/src/database/pool.rs',
    'platform/kernel/src/event_bus.rs',
    'platform/kernel/src/kernel.rs',
    'platform/kernel/src/lib.rs',
    'platform/startup/src/lib.rs',
    'platform/sync/src/lib.rs',
    'apps/desktop-tauri/src/commands/authz.rs',
    'apps/desktop-tauri/src/lib.rs',
]

MARKER = '```ignore'

for filepath in files_to_check:
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        print(f"SKIP: {filepath} (not found)")
        continue
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    for i, line in enumerate(lines, 1):
        if MARKER in line:
            start = max(0, i-2)
            end = min(len(lines), i+5)
            print(f"=== {filepath}:{i} ===")
            for j in range(start, end):
                marker = ">>>>>" if j+1 == i else "     "
                print(f"{marker} {lines[j].rstrip()}")
            print()
