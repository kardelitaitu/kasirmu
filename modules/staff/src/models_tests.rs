//! Unit tests for `models`.
//!
//! Moved out of `models.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `models.rs` with:
//!   `#[cfg(test)] #[path = "models_tests.rs"] mod tests;`

use super::*;

#[test]
fn permission_keys_returns_verbatim_grants() {
    let role = Role::new("role-x", "X")
        .with_permissions_json(r##"["sales:process", "analytics:view"]"##);
    assert_eq!(
        role.permission_keys(),
        vec!["sales:process", "analytics:view"]
    );
}

#[test]
fn permission_keys_preserves_global_wildcard() {
    let role = Role::new("role-owner", "Owner").with_permissions_json(r##"["*"]"##);
    assert_eq!(role.permission_keys(), vec!["*"]);
}

#[test]
fn permission_keys_malformed_json_is_empty() {
    let role = Role::new("role-x", "X").with_permissions_json("not-json");
    assert!(role.permission_keys().is_empty());
}

// Extend existing test module with comprehensive coverage.
// The existing tests cover permission_keys — we add Role, User, UserId,
// authorize, has_permission edge cases, and builtin constants.

#[test]
fn role_new_sets_fields() {
    let role = Role::new("r-1", "cashier");
    assert_eq!(role.id, "r-1");
    assert_eq!(role.name, "cashier");
    assert!(role.description.is_empty());
    assert_eq!(role.permissions, "[]");
}

#[test]
fn role_new_trims_name() {
    let role = Role::new("r-1", "  Manager  ");
    assert_eq!(role.name, "Manager");
}

#[test]
#[should_panic(expected = "role name must not be empty")]
fn role_new_rejects_empty_name() {
    Role::new("r-1", "  ");
}

#[test]
fn role_with_description() {
    let role = Role::new("r-1", "admin").with_description("Full access");
    assert_eq!(role.description, "Full access");
}

#[test]
fn role_has_permission_exact_match() {
    let role =
        Role::new("r-1", "X").with_permissions_json(r##"["sales:process", "products:view"]"##);
    assert!(role.has_permission("sales:process"));
    assert!(role.has_permission("products:view"));
    assert!(!role.has_permission("settings:edit"));
}

#[test]
fn role_has_permission_global_wildcard() {
    let role = Role::new("r-1", "Owner").with_permissions_json(r##"["*"]"##);
    assert!(role.has_permission("anything:at_all"));
    assert!(role.has_permission("settings:edit"));
}

#[test]
fn role_has_permission_domain_wildcard() {
    let role = Role::new("r-1", "X").with_permissions_json(r##"["sales:*"]"##);
    assert!(role.has_permission("sales:process"));
    assert!(role.has_permission("sales:refund"));
    assert!(!role.has_permission("products:view"));
}

#[test]
fn role_has_permission_empty_grants() {
    let role = Role::new("r-1", "X").with_permissions_json("[]");
    assert!(!role.has_permission("sales:process"));
}

#[test]
fn role_has_permission_malformed_json() {
    let role = Role::new("r-1", "X").with_permissions_json("not-json");
    assert!(!role.has_permission("anything"));
}

#[test]
fn role_authorize_success() {
    let role = Role::new("r-1", "X").with_permissions_json(r##"["sales:process"]"##);
    assert!(role.authorize("sales:process").is_ok());
}

#[test]
fn role_authorize_failure() {
    let role = Role::new("r-1", "X").with_permissions_json(r##"["sales:process"]"##);
    let err = role.authorize("settings:edit").unwrap_err();
    assert_eq!(err.required, "settings:edit");
    assert_eq!(err.role_name, "X");
}

// ── User ────────────────────────────────────────────────────────────

#[test]
fn user_new_sets_fields() {
    let user = User::new("admin", "hashed-pin", "Admin User", "role-owner");
    assert_eq!(user.username, "admin");
    assert_eq!(user.pin_hash, "hashed-pin");
    assert_eq!(user.display_name, "Admin User");
    assert_eq!(user.role_id, "role-owner");
    assert!(user.is_active);
}

#[test]
fn user_new_trims_username_and_display() {
    let user = User::new("  bob  ", "pin", "  Bob Smith  ", "role-staff");
    assert_eq!(user.username, "bob");
    assert_eq!(user.display_name, "Bob Smith");
}

#[test]
#[should_panic(expected = "username must not be empty")]
fn user_new_rejects_empty_username() {
    User::new("  ", "pin", "Name", "role");
}

#[test]
#[should_panic(expected = "display_name must not be empty")]
fn user_new_rejects_empty_display_name() {
    User::new("user", "pin", "  ", "role");
}

#[test]
fn user_new_generates_unique_id() {
    let a = User::new("a", "p", "A", "r");
    let b = User::new("b", "p", "B", "r");
    assert_ne!(a.id, b.id);
}

#[test]
fn user_serde_roundtrip() {
    let user = User::new("admin", "hash", "Admin", "role-owner");
    let json = serde_json::to_string(&user).unwrap();
    let back: User = serde_json::from_str(&json).unwrap();
    assert_eq!(back.username, "admin");
    assert_eq!(back.display_name, "Admin");
    assert!(back.is_active);
}

// ── UserId ──────────────────────────────────────────────────────────

#[test]
fn user_id_new_generates_uuid_v7() {
    let id = UserId::new();
    let parsed = uuid::Uuid::parse_str(id.as_str()).unwrap();
    assert_eq!(parsed.get_version_num(), 7);
}

#[test]
fn user_id_default_is_unique() {
    let a = UserId::default();
    let b = UserId::default();
    assert_ne!(a.as_str(), b.as_str());
}

#[test]
fn user_id_display_matches_as_str() {
    let id = UserId::new();
    assert_eq!(format!("{id}"), id.as_str());
}

#[test]
fn user_id_deref_to_str() {
    let id = UserId::from("test-user");
    assert_eq!(&*id, "test-user");
    assert_eq!(id.len(), 9);
}

#[test]
fn user_id_from_string_roundtrip() {
    let id = UserId::from("abc".to_string());
    assert_eq!(id.as_str(), "abc");
}

#[test]
fn user_id_from_str_roundtrip() {
    let id = UserId::from("xyz");
    assert_eq!(id.as_str(), "xyz");
}

#[test]
fn user_id_serde_roundtrip() {
    let id = UserId::from("uid-1");
    let json = serde_json::to_string(&id).unwrap();
    let back: UserId = serde_json::from_str(&json).unwrap();
    assert_eq!(back.as_str(), "uid-1");
}

// ── builtin_roles constants ─────────────────────────────────────────

#[test]
fn builtin_role_ids_are_distinct() {
    let ids = [
        builtin_roles::OWNER,
        builtin_roles::MANAGER,
        builtin_roles::STAFF,
        builtin_roles::CUSTOM,
    ];
    for (i, a) in ids.iter().enumerate() {
        for b in &ids[i + 1..] {
            assert_ne!(a, b, "builtin role ids must be distinct");
        }
    }
}

#[test]
fn builtin_role_ids_are_non_empty() {
    assert!(!builtin_roles::OWNER.is_empty());
    assert!(!builtin_roles::MANAGER.is_empty());
    assert!(!builtin_roles::STAFF.is_empty());
    assert!(!builtin_roles::CUSTOM.is_empty());
}

// ── seed_users constants ────────────────────────────────────────────

#[test]
fn seed_admin_id_is_non_empty() {
    assert!(!seed_users::ADMIN.is_empty());
}
