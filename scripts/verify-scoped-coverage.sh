#!/usr/bin/env bash
# scripts/verify-scoped-coverage.sh — H-1/H-2 regression guard.
#
# Ensures every registered Tauri command in the desktop client either:
#  1. Has a corresponding _scoped variant, OR
#  2. Is in the allowlist of commands that are intentionally unscoped.
#
# Usage:  bash scripts/verify-scoped-coverage.sh
#         (run from the workspace root)

set -euo pipefail

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

violations=0

# Allowlist: commands that are intentionally unscoped.
#
# A `_scoped` variant buys two things, and both are the point of the rule:
# it authenticates a `session_token`, AND it resolves the *session's store*
# rather than the ambient `state.db`. Compare `get_daily_revenue` (locks
# `state.db`, no session, no permission check — anyone who can reach IPC reads
# any store) with `get_daily_revenue_scoped` (session + REPORTS_VIEW + the
# resolved store connection).
#
# So an entry here is a claim that one of those two does not apply. Three
# legitimate categories, and new entries should say which they are:
#
#   1. PRE-AUTH / BOOTSTRAP — no session exists yet, so a session_token cannot
#      be required. staff_login, has_users, bootstrap_owner, create_session,
#      verify_pin, activate_license, check_license_status, get_license_status,
#      get_machine_id, get_hardware_fingerprint, renew/pause/resume_subscription,
#      ping, version, get_device_id, get_local_ip, currency_info, test_auth_connection.
#   2. GENUINELY GLOBAL — the data is not per-store, so store scoping is
#      meaningless; the command still authenticates and checks its own
#      permission inline. This is the whole topology group: topology is a
#      global admin tool keyed by *branch*, and commands/topology/commands.rs
#      locks `state.db` and never resolves a store. load_topology,
#      can_save_topology, apply_topology_diff,
#      recover_pending_topology_apply_at_startup, the four
#      *_topology_template commands — the latter added in d8209477 and missed
#      here until now, which is precisely the drift this gate exists to catch —
#      and the three ADR #46 revision commands, list_topology_revisions,
#      load_topology_revision and pin_topology_revision. All three authenticate
#      a session_token AND check their permission inline (the readers
#      `audit:view`, the writer `topology:write` — pinning decides which deploys
#      stay restorable, which is the authority Apply itself needs), and all
#      three act on topology_revisions in the GLOBAL database keyed by branch
#      (ADR #46 §1), so there is no store to resolve and a _scoped variant would
#      be an empty ceremony.
#      Also: settings_changed_sink, pick_logo_file, list_all_features,
#      set_feature(s)_bulk, get/rotate_key_rotation_info, export/import_data,
#      create_backup, get_backup_status.
#      `get_over_quota_report` is category 2 on the same reasoning as
#      `get_subscription_capabilities` directly above it in the list: it
#      authenticates a `session_token` and checks `settings:read` inline via
#      `require_permission_for_session`, then assesses the TENANT-level quota
#      dimensions — locations, POS registers, warehouses, staff and products —
#      through `Store::assess_downgrade` against `state.db`. A quota is a
#      per-tenant ceiling rather than a per-store one, so those counts are
#      organization-global, no store connection is resolved, and a `_scoped`
#      variant would be an empty ceremony.
#      `get_deployment_info` is category 2 on the same reasoning as
#      `get_over_quota_report` directly above: it authenticates a `session_token`
#      and checks `settings:read` inline via `require_permission_for_session`,
#      then returns the running build version (`env!("CARGO_PKG_VERSION")`). The
#      version is organization-global (identical across every store), so there is
#      no store to resolve and a `_scoped` variant would be an empty ceremony.
#      Added for saas-3 L162 operator tooling (the Diagnostics "About" surface).
#
#   3. HARDWARE / TERMINAL PATHS — device-driven, scoped by terminal rather
#      than store session: gateway_status, edc_terminal_status, edc_sale,
#      edc_refund, edc_void.
#
# The inventory/report entries are the long tail of the same reasoning.
#
# NOTE: adding a name here silences the gate for that command forever, and the
# list is a single regex alternation — a regex line cannot carry a per-entry
# justification, so every NEW entry must add one or two prose lines to the
# matching category block above saying which category it is and why (convention
# started with get_subscription_capabilities and get_over_quota_report, the
# latter added 2026-09-08). Prefer a `_scoped` variant whenever the command
# reads or writes store data.
ALLOWLIST="staff_login|staff_check_username|has_users|bootstrap_owner|create_session|destroy_session|session_keepalive|verify_pin|refresh_picker_ticket|activate_license|check_license_status|get_license_status|get_machine_id|get_hardware_fingerprint|renew_license|pause_subscription|resume_subscription|test_auth_connection|ping|version|get_device_id|get_local_ip|resolve_boot_store|get_subscription_capabilities|get_over_quota_report|get_deployment_info|complete_setup|dismiss_setup_wizard|get_setup_status|get_enabled_features|load_topology|can_save_topology|apply_topology_diff|recover_pending_topology_apply_at_startup|save_topology_template|load_topology_template|list_topology_templates|delete_topology_template|list_topology_revisions|load_topology_revision|pin_topology_revision|export_data|import_preview|import_data|create_backup|get_backup_status|gateway_status|edc_terminal_status|edc_sale|edc_refund|edc_void|send_test_report|save_report_schedule|get_report_schedule|list_all_features|set_feature|set_features_bulk|get_key_rotation_info|rotate_encryption_key|currency_info|pick_logo_file|settings_changed_sink|create_inventory_location|create_inventory_transaction|deactivate_inventory_location|delete_stock_threshold|end_inventory_shift|finalize_sale|get_active_inventory_shift|get_inventory_transaction|get_stock_thresholds|get_workspace_inventory_locations|list_inventory_locations|list_inventory_shifts|list_inventory_transactions|list_inventory_transactions_for_shift|set_stock_threshold|set_workspace_inventory_locations|start_inventory_shift|update_inventory_location|void_pending_sale|list_warehouse_products_at_location"

# Get all _scoped function names
scoped_funcs=$(grep -roh "pub async fn [a-z_]*_scoped" apps/desktop-client/src/commands --include="*.rs" 2>/dev/null | sed 's/pub async fn //' | sort -u)

# Get all registered unscoped commands (not _scoped themselves)
registered_unscoped=$(grep -oE 'commands::[a-z_]+::[a-z_]+,' apps/desktop-client/src/lib.rs | sed 's/,$//' | grep -v '_scoped$' | sort -u)

echo "=== Scoped Coverage Check ==="
echo ""

while IFS= read -r cmd; do
    fn_name=$(echo "$cmd" | awk -F:: '{print $NF}')

    # Check if it has a _scoped counterpart
    if echo "$scoped_funcs" | grep -q "^${fn_name}_scoped$"; then
        continue
    fi

    # Check if it's in the allowlist
    if echo "$fn_name" | grep -qE "^($ALLOWLIST)$"; then
        continue
    fi

    echo -e "${RED}VIOLATION${NC}: $cmd has no _scoped variant"
    violations=$((violations + 1))
done <<< "$registered_unscoped"

echo ""

if [ "$violations" -gt 0 ]; then
    echo -e "${RED}FAIL: $violations command(s) without _scoped variant or allowlist entry${NC}"
    exit 1
else
    echo -e "${GREEN}PASS: all registered commands covered${NC}"
    exit 0
fi
