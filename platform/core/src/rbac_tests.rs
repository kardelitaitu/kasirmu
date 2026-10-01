//! `rbac` unit tests — resolver, wildcard semantics, and role-preset
//! invariants, extracted from the production file (F-018) per the
//! AGENTS test-file rule.

use super::*;

// ── Role basics ───────────────────────────────────────────────

#[test]
fn new_role() {
    let r = Role::new("role-lite", "Lite");
    assert_eq!(r.id, "role-lite");
    assert_eq!(r.name, "Lite");
    assert!(r.description.is_empty());
    assert_eq!(r.permissions, "[]");
}

#[test]
#[should_panic(expected = "role name must not be empty")]
fn role_panics_on_empty_name() {
    Role::new("r", "   ");
}

#[test]
fn role_with_description() {
    let r = Role::new("r", "Role").with_description("A test role");
    assert_eq!(r.description, "A test role");
}

#[test]
fn role_serde_roundtrip() {
    let r = Role::new("role-owner", "Owner").with_description("Full access");
    let json = serde_json::to_string(&r).unwrap();
    let back: Role = serde_json::from_str(&json).unwrap();
    assert_eq!(back, r);
}

// ── Permission basics ─────────────────────────────────────────

#[test]
fn new_permission() {
    let p = Permission::new("sales:void");
    assert_eq!(p.name, "sales:void");
    assert!(p.description.is_empty());
}

#[test]
fn permission_with_description() {
    let p = Permission::new("sales:void").with_description("Void a sale");
    assert_eq!(p.description, "Void a sale");
}

#[test]
fn permission_display() {
    let p = Permission::new("products:edit");
    assert_eq!(p.to_string(), "products:edit");
}

#[test]
fn permission_serde_roundtrip() {
    let p = Permission::new("sales:void").with_description("Void a sale");
    let json = serde_json::to_string(&p).unwrap();
    let back: Permission = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "sales:void");
    assert_eq!(back.description, "Void a sale");
}

#[test]
fn permission_clone_eq() {
    let p = Permission::new("test:action");
    assert_eq!(p, p.clone());
}

// ── Built-in constants sanity ─────────────────────────────────

#[test]
fn builtin_role_constants_are_distinct() {
    assert_ne!(builtin_roles::OWNER, builtin_roles::MANAGER);
    assert_ne!(builtin_roles::MANAGER, builtin_roles::ADMIN);
    assert_ne!(builtin_roles::STAFF, builtin_roles::CUSTOM);
}

// ── has_permission — wildcard resolution ──────────────────────

#[test]
fn global_wildcard_grants_everything() {
    assert!(has_permission(&["*".into()], "sales:void"));
    assert!(has_permission(&["*".into()], "anything:here"));
    assert!(has_permission(&["*".into()], "settings:edit"));
}

#[test]
fn domain_wildcard_grants_domain_actions() {
    let granted = &["sales:*".into()];
    assert!(has_permission(granted, "sales:void"));
    assert!(has_permission(granted, "sales:process"));
    assert!(has_permission(granted, "sales:refund"));
    assert!(has_permission(granted, "sales:discount"));
    assert!(!has_permission(granted, "products:read"));
    assert!(!has_permission(granted, "settings:edit"));
}

#[test]
fn exact_match_works() {
    assert!(has_permission(&["sales:void".into()], "sales:void"));
    assert!(!has_permission(&["sales:void".into()], "sales:process"));
    assert!(!has_permission(&["sales:void".into()], "products:read"));
}

#[test]
fn empty_set_denies_everything() {
    let empty: &[String] = &[];
    assert!(!has_permission(empty, "sales:void"));
    assert!(!has_permission(empty, "*"));
}

#[test]
fn multiple_permissions_or_logic() {
    let granted = &["products:read".into(), "sales:process".into()];
    assert!(has_permission(granted, "sales:process"));
    assert!(has_permission(granted, "products:read"));
    assert!(!has_permission(granted, "settings:edit"));
    assert!(!has_permission(granted, "sales:void"));
}

#[test]
fn global_wildcard_among_other_permissions() {
    let granted = &["products:read".into(), "*".into(), "sales:process".into()];
    assert!(has_permission(granted, "settings:edit"));
    assert!(has_permission(granted, "anything"));
}

#[test]
fn domain_wildcard_does_not_leak_to_other_domains() {
    let granted = &["sales:*".into(), "products:*".into()];
    assert!(has_permission(granted, "sales:void"));
    assert!(has_permission(granted, "products:read"));
    assert!(!has_permission(granted, "settings:edit"));
}

// ── Role::has_permission and ::authorize ──────────────────────

#[test]
fn role_has_permission_from_json() {
    let role =
        Role::new("role-test", "Test").with_permissions_json("[\"sales:void\", \"products:read\"]");
    assert!(role.has_permission("sales:void"));
    assert!(role.has_permission("products:read"));
    assert!(!role.has_permission("settings:edit"));
}

#[test]
fn role_authorize_returns_ok_for_granted() {
    let role = Role::new("role-test", "Test").with_permissions_json("[\"sales:void\"]");
    assert!(role.authorize("sales:void").is_ok());
}

#[test]
fn role_authorize_returns_error_for_denied() {
    let role = Role::new("role-test", "Cashier").with_permissions_json("[\"sales:process\"]");
    let err = role.authorize("sales:void").unwrap_err();
    assert_eq!(err.required, "sales:void");
    assert_eq!(err.role_name, "Cashier");
    assert!(err.to_string().contains("permission denied"));
}

#[test]
fn role_authorize_error_display() {
    let err = AuthorizationError {
        required: "sales:void".into(),
        role_name: "Cashier".into(),
    };
    let msg = err.to_string();
    assert!(msg.contains("sales:void"));
    assert!(msg.contains("Cashier"));
    assert!(msg.contains("permission denied"));
}

#[test]
fn role_with_malformed_json_denies_all() {
    let role = Role::new("role-test", "Test").with_permissions_json("not json");
    assert!(!role.has_permission("sales:void"));
}

#[test]
fn role_with_global_wildcard() {
    let role = Role::new("role-admin", "Admin").with_permissions_json("[\"*\"]");
    assert!(role.has_permission("sales:void"));
    assert!(role.has_permission("settings:edit"));
    assert!(role.has_permission("staff:manage"));
    assert!(role.authorize("anything").is_ok());
}

#[test]
fn role_has_permission_empty_json() {
    let role = Role::new("role-test", "Test").with_permissions_json("[]");
    assert!(!role.has_permission("sales:void"));
    assert!(!role.has_permission("*"));
}

#[test]
fn role_authorize_with_domain_wildcard() {
    let role = Role::new("role-test", "Test").with_permissions_json("[\"sales:*\"]");
    assert!(role.authorize("sales:void").is_ok());
    assert!(role.authorize("sales:process").is_ok());
    assert!(role.authorize("products:read").is_err());
}

#[test]
fn authorization_error_debug() {
    let err = AuthorizationError {
        required: "sales:void".into(),
        role_name: "Cashier".into(),
    };
    let debug = format!("{err:?}");
    assert!(debug.contains("sales:void"));
    assert!(debug.contains("Cashier"));
}

// ── Permission constants well-formedness ──────────────────────

#[test]
fn all_permission_constants_contain_colon() {
    for &p in ALL_ENFORCED {
        assert!(p.contains(':'), "constant {p} is missing ':' separator");
    }
}

#[test]
fn permission_constants_are_unique() {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for &p in ALL_ENFORCED {
        assert!(seen.insert(p), "duplicate permission constant: {p}");
    }
}

// ── has_permission edge cases ────────────────────────────────

#[test]
fn no_colon_permission_exact_match() {
    // Permissions without a colon are matched exactly.
    assert!(has_permission(&["admin".into()], "admin"));
    assert!(!has_permission(&["admin".into()], "user"));
    // A no-colon granted permission is treated as its own domain,
    // so a domain wildcard can match it.
    assert!(has_permission(&["admin:*".into()], "admin"));
}

#[test]
fn no_colon_required_matches_global_wildcard() {
    // A required permission without a colon should match the global wildcard.
    assert!(has_permission(&["*".into()], "admin"));
}

#[test]
fn role_preset_empty_permissions_json() {
    let preset = RolePreset {
        id: "role-empty",
        name: "Empty",
        description: "No permissions",
        permissions: &[],
    };
    assert_eq!(preset.permissions_json(), "[]");
}

#[test]
fn role_preset_into_role_timestamps() {
    let role = ROLE_PRESETS[0].into_role();
    assert!(!role.created_at.is_empty());
    assert!(!role.updated_at.is_empty());
    assert!(role.created_at.contains('T'));
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────

#[test]
fn role_new_trims_whitespace() {
    let r = Role::new("r", "  Cashier  ");
    assert_eq!(r.name, "Cashier");
}

#[test]
fn authorization_error_clone() {
    let err = AuthorizationError {
        required: "sales:void".into(),
        role_name: "Cashier".into(),
    };
    let cloned = err.clone();
    assert_eq!(err.required, cloned.required);
    assert_eq!(err.role_name, cloned.role_name);
}

#[test]
fn permission_eq_different_names() {
    let a = Permission::new("sales:void");
    let b = Permission::new("sales:process");
    assert_ne!(a, b);
}

#[test]
fn has_permission_domain_wildcard_matches_all_actions_in_domain() {
    // A domain wildcard like "admin:*" matches ANY action in the domain,
    // including "admin:read", "admin:write", etc.
    assert!(has_permission(&["admin:*".into()], "admin:read"));
    assert!(has_permission(&["admin:*".into()], "admin:write"));
    assert!(has_permission(&["admin:*".into()], "admin"));
    // But it does NOT match actions in other domains.
    assert!(!has_permission(&["admin:*".into()], "sales:void"));
}

#[test]
fn all_enforced_list_is_non_empty() {
    assert!(!ALL_ENFORCED.is_empty(), "ALL_ENFORCED must not be empty");
}

#[test]
fn all_enforced_entries_have_domain_action_format() {
    for &p in ALL_ENFORCED {
        let parts: Vec<&str> = p.splitn(2, ':').collect();
        assert_eq!(
            parts.len(),
            2,
            "ALL_ENFORCED entry '{p}' must have domain:action"
        );
        assert!(
            !parts[0].is_empty(),
            "ALL_ENFORCED entry '{p}' has empty domain"
        );
        assert!(
            !parts[1].is_empty(),
            "ALL_ENFORCED entry '{p}' has empty action"
        );
    }
}

#[test]
fn role_preset_permissions_json_matches_role_field() {
    // The JSON produced by permissions_json() must round-trip correctly.
    for preset in ROLE_PRESETS {
        let json = preset.permissions_json();
        let parsed: Vec<String> =
            serde_json::from_str(&json).expect("permissions_json must be valid JSON");
        assert_eq!(parsed.len(), preset.permissions.len());
        for perm in &parsed {
            assert!(
                preset.permissions.contains(&perm.as_str()),
                "parsed perm '{}' not in preset permissions for {}",
                perm,
                preset.id
            );
        }
    }
}

// ── Deeper edge cases ──────────────────────────────────────────

#[test]
fn has_permission_empty_required_string() {
    // Empty required string has no colon, so domain = "".
    // Should only match "" (exact) or ":*" (domain wildcard for empty domain).
    assert!(!has_permission(&["sales:void".into()], ""));
    assert!(has_permission(&["*".into()], ""));
}

#[test]
fn has_permission_whitespace_in_granted_not_matched() {
    // Leading/trailing whitespace in granted strings should NOT match.
    assert!(!has_permission(&[" sales:void ".into()], "sales:void"));
    assert!(!has_permission(&["* ".into()], "sales:void"));
    assert!(!has_permission(&[" *".into()], "sales:void"));
}

#[test]
fn has_permission_multiple_wildcards_all_match() {
    // Multiple wildcards in granted set — all should match.
    let granted = vec!["*".into(), "sales:*".into(), "sales:void".into()];
    assert!(has_permission(&granted, "sales:void"));
    assert!(has_permission(&granted, "anything:here"));
}

#[test]
fn has_permission_domain_wildcard_and_exact_both_match() {
    // Both domain wildcard and exact match present — should still work.
    let granted = vec!["sales:*".into(), "sales:void".into()];
    assert!(has_permission(&granted, "sales:void"));
    assert!(has_permission(&granted, "sales:process"));
}

#[test]
fn role_authorize_with_global_wildcard() {
    let role = Role::new("role-owner", "Owner").with_permissions_json("[\"*\"]");
    assert!(role.authorize("anything:here").is_ok());
    assert!(role.authorize("sales:void").is_ok());
    assert!(role.authorize("settings:edit").is_ok());
}

#[test]
fn role_authorize_with_empty_permissions() {
    let role = Role::new("role-empty", "Empty").with_permissions_json("[]");
    assert!(role.authorize("sales:process").is_err());
    assert!(role.authorize("*").is_err());
}

#[test]
fn role_has_permission_with_empty_string_required() {
    let role = Role::new("role-test", "Test").with_permissions_json("[\"sales:void\"]");
    // Empty string has no colon, so domain = "". No match.
    assert!(!role.has_permission(""));
}

#[test]
fn role_preset_permissions_json_no_special_chars() {
    // Ensure no permission strings contain characters that would
    // break JSON serialization (quotes, backslashes, etc.).
    for preset in ROLE_PRESETS {
        for perm in preset.permissions {
            assert!(
                !perm.contains('"'),
                "permission '{perm}' contains double quote"
            );
            assert!(
                !perm.contains('\\'),
                "permission '{perm}' contains backslash"
            );
            assert!(!perm.contains('\n'), "permission '{perm}' contains newline");
        }
    }
}

#[test]
fn role_preset_owner_has_only_global_wildcard() {
    // Owner should have exactly ["*"] — no other permissions.
    let owner = ROLE_PRESETS
        .iter()
        .find(|p| p.id == builtin_roles::OWNER)
        .expect("owner preset");
    assert_eq!(owner.permissions, &["*"]);
}

#[test]
fn role_preset_all_ids_start_with_role() {
    // All built-in role IDs must start with "role-" prefix.
    for preset in ROLE_PRESETS {
        assert!(
            preset.id.starts_with("role-"),
            "role ID '{}' must start with 'role-'",
            preset.id
        );
    }
}

#[test]
fn role_preset_names_are_title_case() {
    // All built-in role names should be human-readable title case.
    for preset in ROLE_PRESETS {
        let name = preset.name;
        assert!(!name.is_empty(), "role name must not be empty");
        assert!(
            name.chars().next().unwrap().is_uppercase(),
            "role name '{name}' should start with uppercase"
        );
    }
}

#[test]
fn all_enforced_no_duplicate_domains() {
    // Each permission should have a unique domain:action pair.
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for &p in ALL_ENFORCED {
        assert!(seen.insert(p), "duplicate in ALL_ENFORCED: {p}");
    }
}

#[test]
fn has_permission_case_sensitive() {
    // Permission matching is case-sensitive.
    assert!(!has_permission(&["Sales:Void".into()], "sales:void"));
    assert!(!has_permission(&["sales:void".into()], "Sales:Void"));
    assert!(has_permission(&["SALES:VOID".into()], "SALES:VOID"));
}

#[test]
fn role_serde_json_field_names() {
    let role = Role::new("role-test", "Test")
        .with_description("A test role")
        .with_permissions_json("[\"sales:void\"]");
    let json = serde_json::to_value(&role).unwrap();
    assert_eq!(json["id"], "role-test");
    assert_eq!(json["name"], "Test");
    assert_eq!(json["description"], "A test role");
    assert!(json["permissions"].is_string());
}

#[test]
fn authorization_error_is_send_and_sync() {
    // AuthorizationError must be Send + Sync for use across threads.
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AuthorizationError>();
}

#[test]
fn role_is_send_and_sync() {
    // Role must be Send + Sync for use across threads.
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Role>();
}

#[test]
fn permission_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Permission>();
}

#[test]
fn a_malformed_required_is_never_satisfied_by_a_wildcard_derived_from_it() {
    // The `next:` note this pins: a REQUIRED string carrying a wildcard must
    // not be matched by a domain wildcard built from the SAME string. The
    // wildcard in `required` is what is being asked for, not a grant.
    //
    // A deeper-than-two-segment required ("sales:*:extra") splits on the FIRST
    // colon, so domain = "sales" and -- before this guard -- the derived
    // "sales:*" matched a granted "sales:*". That is the caller's own input
    // widening its check.
    assert!(!has_permission(&["sales:*".into()], "sales:*:extra"));
    // An exact identity is a legitimate match: asking for precisely a grant you
    // hold is not the caller widening its own check. Only the DERIVED wildcard
    // clause is suppressed above.
    assert!(has_permission(&["sales:*".into()], "sales:*"));
    // An empty domain must not derive the malformed "": "*" wildcard.
    assert!(!has_permission(&[":*".into()], ":action"));
}

#[test]
fn a_well_formed_required_still_matches_its_domain_wildcard() {
    // The guard above must NOT weaken the intended domain-wildcard behavior.
    assert!(has_permission(&["sales:*".into()], "sales:void"));
    assert!(has_permission(&["sales:*".into()], "sales:process"));
    assert!(!has_permission(&["sales:*".into()], "products:read"));
    // And the global wildcard still grants anything, malformed or not.
    assert!(has_permission(&["*".into()], "sales:*:extra"));
    assert!(has_permission(&["*".into()], "not_a_permission_at_all"));
}
