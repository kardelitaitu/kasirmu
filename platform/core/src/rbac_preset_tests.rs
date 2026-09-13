//! Preset-table unit tests for `platform_core::rbac` — extracted from
//! the mid-file `preset_tests` module (F-018) per the AGENTS
//! test-file rule.

use super::*;

#[test]
fn owner_preset_contains_global_wildcard() {
    let preset = &ROLE_PRESETS[0];
    assert_eq!(preset.id, builtin_roles::OWNER);
    assert_eq!(preset.permissions, &["*"]);
}

#[test]
fn manager_preset_excludes_sensitive_permissions() {
    let preset = &ROLE_PRESETS[1];
    assert_eq!(preset.id, builtin_roles::MANAGER);
    assert!(!preset.permissions.contains(&permissions::STAFF_DELETE));
    assert!(
        !preset
            .permissions
            .contains(&permissions::STAFF_MANAGE_ROLES)
    );
    assert!(!preset.permissions.contains(&permissions::PLUGINS_MANAGE));
}

#[test]
fn location_manage_permission_follows_inventory_roles() {
    // LOC-06: location CRUD/rebind is a management capability, not a sales
    // one. Manager holds it; Staff is checkout-only and must not manage
    // inventory locations; a bare Custom role must not either.
    let manager = &ROLE_PRESETS[1];
    assert!(
        manager
            .permissions
            .contains(&permissions::INVENTORY_LOCATIONS_MANAGE)
    );
    let staff = &ROLE_PRESETS[2];
    assert!(
        !staff
            .permissions
            .contains(&permissions::INVENTORY_LOCATIONS_MANAGE),
        "Staff is checkout-only and must not manage inventory locations"
    );
    let custom = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::CUSTOM)
        .expect("custom preset");
    assert!(
        !custom
            .permissions
            .contains(&permissions::INVENTORY_LOCATIONS_MANAGE)
    );
}

#[test]
fn presets_contain_no_retired_roles() {
    // ADR #35 D4 (spec 0048 c2c): the cashier/kitchen roles are retired.
    // Migration 129 removes their rows; the presets must never seed them
    // again, and Staff (their folding target) must cover their access.
    for preset in ROLE_PRESETS {
        assert_ne!(preset.id, "role-cashier");
        assert_ne!(preset.id, "role-kitchen");
    }
    let staff = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::STAFF)
        .expect("staff preset");
    for key in [
        permissions::SALES_PROCESS,
        permissions::SALES_VIEW,
        permissions::SALES_DISCOUNT,
        permissions::SALES_SPLIT,
        permissions::PAYMENTS_CASH,
        permissions::PAYMENTS_CARD,
        permissions::CUSTOMERS_CREATE,
        permissions::CUSTOMERS_VIEW,
        permissions::LOYALTY_VIEW,
        permissions::LOYALTY_EARN,
        permissions::LOYALTY_REDEEM,
        permissions::DISCOUNTS_APPLY,
        permissions::SHIFTS_OPEN,
        permissions::SHIFTS_CLOSE,
        permissions::WORKSPACES_SWITCH,
        permissions::KDS_VIEW,
        permissions::KDS_UPDATE,
    ] {
        assert!(
            staff.permissions.contains(&key),
            "Staff must cover {key} for the folded cashier/kitchen users"
        );
    }
}

#[test]
fn permissions_json_is_valid() {
    for preset in ROLE_PRESETS {
        let json = preset.permissions_json();
        let parsed: Vec<String> =
            serde_json::from_str(&json).expect("permissions_json should produce valid JSON");
        assert_eq!(parsed.len(), preset.permissions.len());
    }
}

#[test]
fn into_role_has_correct_id_and_name() {
    let role = ROLE_PRESETS[0].into_role();
    assert_eq!(role.id, builtin_roles::OWNER);
    assert_eq!(role.name, "Owner");
}

#[test]
fn staff_preset_is_checkout_only() {
    let preset = &ROLE_PRESETS[2];
    assert_eq!(preset.id, builtin_roles::STAFF);
    assert_eq!(preset.name, "Staff");
    // No settings access.
    assert!(!preset.permissions.contains(&permissions::SETTINGS_READ));
    assert!(!preset.permissions.contains(&permissions::SETTINGS_EDIT));
    // No management surfaces: voids, refunds, price overrides, products,
    // inventory, staff, reports, audit, terminals, promotions.
    assert!(!preset.permissions.contains(&permissions::SALES_VOID));
    assert!(!preset.permissions.contains(&permissions::SALES_REFUND));
    assert!(
        !preset
            .permissions
            .contains(&permissions::SALES_OVERRIDE_PRICE)
    );
    assert!(!preset.permissions.contains(&permissions::PAYMENTS_REFUND));
    assert!(!preset.permissions.contains(&permissions::PRODUCTS_CREATE));
    assert!(!preset.permissions.contains(&permissions::PRODUCTS_READ));
    assert!(!preset.permissions.contains(&permissions::INVENTORY_VIEW));
    assert!(!preset.permissions.contains(&permissions::INVENTORY_ADJUST));
    assert!(!preset.permissions.contains(&permissions::STAFF_CREATE));
    assert!(!preset.permissions.contains(&permissions::STAFF_READ));
    assert!(!preset.permissions.contains(&permissions::REPORTS_VIEW));
    assert!(!preset.permissions.contains(&permissions::AUDIT_VIEW));
    assert!(
        !preset
            .permissions
            .contains(&permissions::TERMINALS_REGISTER)
    );
    // Checkout operations stay.
    for key in [
        permissions::SALES_PROCESS,
        permissions::SALES_VIEW,
        permissions::SALES_DISCOUNT,
        permissions::SALES_SPLIT,
        permissions::PAYMENTS_CASH,
        permissions::PAYMENTS_CARD,
        permissions::PAYMENTS_SETTLE,
        permissions::DISCOUNTS_APPLY,
        permissions::CUSTOMERS_CREATE,
        permissions::CUSTOMERS_VIEW,
        permissions::LOYALTY_VIEW,
        permissions::LOYALTY_EARN,
        permissions::LOYALTY_REDEEM,
        permissions::SHIFTS_OPEN,
        permissions::SHIFTS_CLOSE,
        permissions::KDS_VIEW,
        permissions::KDS_UPDATE,
        permissions::WORKSPACES_SWITCH,
    ] {
        assert!(preset.permissions.contains(&key), "Staff must keep {key}");
    }
}

#[test]
fn custom_preset_has_no_permissions() {
    let preset = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::CUSTOM)
        .expect("custom preset");
    assert_eq!(preset.name, "Custom");
    assert!(preset.permissions.is_empty());
    let json = preset.permissions_json();
    assert_eq!(json, "[]");
}

#[test]
fn admin_preset_manages_roles_and_plugins_but_never_wildcard_or_staff_delete() {
    // ADR #35 D4: Admin is global with the same mechanism as Owner, but
    // "everything except ownership transfer, billing, and irreversible
    // org actions" — expressed as an explicit grant list (no `*`), and
    // staff deletion stays out of the default.
    let preset = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::ADMIN)
        .expect("admin preset");
    assert_eq!(preset.name, "Admin");
    assert!(
        !preset.permissions.contains(&"*"),
        "Admin is never a wildcard"
    );
    assert!(
        preset
            .permissions
            .contains(&permissions::STAFF_MANAGE_ROLES)
    );
    assert!(preset.permissions.contains(&permissions::PLUGINS_MANAGE));
    assert!(preset.permissions.contains(&permissions::SETTINGS_EDIT));
    assert!(
        !preset.permissions.contains(&permissions::STAFF_DELETE),
        "irreversible org action stays owner-only by default"
    );
}

#[test]
fn auditor_preset_is_read_only() {
    // ADR #35 D4: Auditor is global and read-only — views operational
    // data and the audit log, never manages, never exports, and never
    // sees sensitive profile fields (0049 adds those denials).
    let preset = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::AUDITOR)
        .expect("auditor preset");
    assert_eq!(preset.name, "Auditor");
    for read in [
        permissions::SALES_VIEW,
        permissions::PRODUCTS_READ,
        permissions::INVENTORY_VIEW,
        permissions::STAFF_READ,
        permissions::REPORTS_VIEW,
        permissions::AUDIT_VIEW,
    ] {
        assert!(
            preset.permissions.contains(&read),
            "{read} must be readable"
        );
    }
    for write in [
        permissions::SALES_PROCESS,
        permissions::STAFF_UPDATE,
        permissions::SETTINGS_EDIT,
        permissions::REPORTS_EXPORT,
        permissions::AUDIT_EXPORT,
        permissions::CUSTOMERS_CREATE,
    ] {
        assert!(
            !preset.permissions.contains(&write),
            "{write} is a write/export — Auditor must not hold it"
        );
    }
}

#[test]
fn staff_preset_has_no_manager_management_surfaces() {
    // Staff is checkout-only: it must not inherit any management
    // permission from Manager (ADR #35 D4 taxonomy — settings, analytics,
    // and cost editing are manager+; the plan extends this to all
    // management surfaces).
    let manager = &ROLE_PRESETS[1];
    let staff = &ROLE_PRESETS[2];
    for perm in [
        permissions::SETTINGS_READ,
        permissions::SETTINGS_EDIT,
        permissions::ANALYTICS_VIEW,
        permissions::PRODUCTS_EDIT_COST,
        permissions::SALES_VOID,
        permissions::SALES_REFUND,
        permissions::SALES_OVERRIDE_PRICE,
        permissions::PAYMENTS_REFUND,
        permissions::PRODUCTS_CREATE,
        permissions::PRODUCTS_READ,
        permissions::INVENTORY_VIEW,
        permissions::INVENTORY_ADJUST,
        permissions::INVENTORY_TRANSFER,
        permissions::INVENTORY_COUNT,
        permissions::INVENTORY_LOCATIONS_MANAGE,
        permissions::STAFF_READ,
        permissions::STAFF_CREATE,
        permissions::STAFF_UPDATE,
        permissions::STAFF_READ_IDENTITY,
        permissions::STAFF_READ_PAYROLL,
        permissions::STAFF_EDIT_NOTES,
        permissions::REPORTS_VIEW,
        permissions::REPORTS_EXPORT,
        permissions::REPORTS_SCHEDULE,
        permissions::SHIFTS_VIEW_ANY,
        permissions::AUDIT_VIEW,
        permissions::AUDIT_EXPORT,
        permissions::CUSTOMERS_EDIT,
        permissions::CUSTOMERS_DELETE,
        permissions::LOYALTY_MANAGE,
        permissions::TABLES_CREATE,
        permissions::TABLES_EDIT,
        permissions::TABLES_DELETE,
        permissions::DISCOUNTS_CREATE,
        permissions::DISCOUNTS_MANAGE,
        permissions::PROMOTIONS_CREATE,
        permissions::PROMOTIONS_EDIT,
        permissions::PROMOTIONS_DELETE,
        permissions::PROMOTIONS_APPLY,
        permissions::TERMINALS_REGISTER,
        permissions::TERMINALS_EDIT,
        permissions::TERMINALS_DELETE,
    ] {
        assert!(
            !staff.permissions.contains(&perm),
            "Staff must not hold manager-only permission: {perm}"
        );
    }
    // Sanity: Manager still holds representative management permissions.
    assert!(manager.permissions.contains(&permissions::SALES_VOID));
    assert!(manager.permissions.contains(&permissions::PRODUCTS_CREATE));
    assert!(manager.permissions.contains(&permissions::STAFF_CREATE));
    assert!(manager.permissions.contains(&permissions::REPORTS_VIEW));
}

#[test]
fn terminal_read_follows_terminal_manage_b1() {
    // B-1 remediation: Manager and Admin hold terminal register/edit/delete,
    // so they must also pass the 7 read gates — view follows manage. Staff
    // (checkout-only) and Auditor must NOT gain terminal access, and the
    // grants must be explicit, never via a family wildcard.
    for role_id in [builtin_roles::MANAGER, builtin_roles::ADMIN] {
        let preset = ROLE_PRESETS
            .iter()
            .find(|p| p.id == role_id)
            .unwrap_or_else(|| panic!("preset {role_id}"));
        assert!(
            preset.permissions.contains(&permissions::TERMINALS_READ),
            "{role_id} must grant terminals:read"
        );
        assert!(
            !preset.permissions.contains(&"terminals:*"),
            "{role_id} must grant terminals:read explicitly"
        );
    }
    for role_id in [builtin_roles::STAFF, builtin_roles::AUDITOR] {
        let preset = ROLE_PRESETS
            .iter()
            .find(|p| p.id == role_id)
            .unwrap_or_else(|| panic!("preset {role_id}"));
        assert!(
            !preset.permissions.contains(&permissions::TERMINALS_READ),
            "{role_id} must not gain terminals:read"
        );
    }
}

#[test]
fn memo_stop_follows_the_a2_ruling_owner_admin_only() {
    // Early-stop ruling (2026-09-07, option A2): `memo:stop` covers stopping
    // ANOTHER author's published Memo, so it must be an Owner/Admin grant —
    // Manager keeps `memo:write` (authors can stop their own via the
    // command's author short-circuit) but never gains `memo:stop`. Staff,
    // Auditor, and the bare Custom preset stay deny-by-default, and no
    // role carries a `memo:*` family wildcard (the family has no sensitive
    // keys, but explicit grants are the preset convention).
    let admin = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::ADMIN)
        .unwrap_or_else(|| panic!("preset admin"));
    assert!(
        admin.permissions.contains(&permissions::MEMO_STOP),
        "Admin must grant memo:stop"
    );
    for role_id in [
        builtin_roles::MANAGER,
        builtin_roles::STAFF,
        builtin_roles::AUDITOR,
        builtin_roles::CUSTOM,
    ] {
        let preset = ROLE_PRESETS
            .iter()
            .find(|p| p.id == role_id)
            .unwrap_or_else(|| panic!("preset {role_id}"));
        assert!(
            !preset.permissions.contains(&permissions::MEMO_STOP),
            "{role_id} must not grant memo:stop"
        );
        assert!(
            !preset.permissions.contains(&"memo:*"),
            "{role_id} must not carry a memo family wildcard"
        );
    }
}
