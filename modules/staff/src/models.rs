/*
last audited 31-08-26 by RSA-Agent (user-role campaign, FINAL verification pass)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: E-1 / MSL-6 CLOSED — builtin_roles::STAFF doc now states checkout-only (preset-pinned) and cross-references the authoritative platform-core taxonomy; accepted convention drift remains: builtin_roles here lists 4 of the 6 platform ids (ADMIN/AUDITOR unused by this module's seeds — deliberate subset, documented) and top-level test fns at the file bottom sit outside mod tests (cosmetic; all 52 tests green via the module target)
next: none — campaign closed for this file; optional cosmetic relocation of top-level tests into mod tests in a future chore pass | perf: N/A
*/

//! Staff & Role domain models.

use platform_core::rbac::{AuthorizationError, has_permission};
use serde::{Deserialize, Serialize};

/// A staff role with a set of permissions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Role {
    /// Internal row id.
    pub id: String,
    /// Unique role name (e.g. "owner", "admin", "manager", "staff", "auditor").
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// JSON array of permission strings.
    pub permissions: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl Role {
    /// Create a new role.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into().trim().to_owned();
        assert!(!name.is_empty(), "role name must not be empty");
        Self {
            id: id.into(),
            name,
            description: String::new(),
            permissions: "[]".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Set description.
    #[must_use]
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }

    /// Check if role grants required permission.
    #[must_use]
    pub fn has_permission(&self, required: &str) -> bool {
        let granted: Vec<String> = serde_json::from_str(&self.permissions).unwrap_or_default();
        has_permission(&granted, required)
    }

    /// The raw permission keys granted by this role, verbatim from the
    /// `permissions` JSON (e.g. `["sales:process"]` or `["*"]`).
    ///
    /// Serializing this list on the login session lets the frontend mirror
    /// [`Self::authorize`]'s wildcard semantics (`*`, `<domain>:*`) instead
    /// of inferring access from role-name strings. Malformed JSON yields an
    /// empty list — a role whose grants cannot be parsed authorizes nothing.
    #[must_use]
    pub fn permission_keys(&self) -> Vec<String> {
        serde_json::from_str(&self.permissions).unwrap_or_default()
    }

    /// Authorize or return AuthorizationError.
    pub fn authorize(&self, required: &str) -> Result<(), AuthorizationError> {
        if self.has_permission(required) {
            Ok(())
        } else {
            Err(AuthorizationError {
                required: required.to_owned(),
                role_name: self.name.clone(),
            })
        }
    }

    /// Set permissions JSON array string.
    #[must_use]
    pub fn with_permissions_json(mut self, json: &str) -> Self {
        self.permissions = json.to_owned();
        self
    }
}

/// A staff member who can log in to the POS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    /// Internal row id (UUID v4).
    pub id: String,
    /// Unique login username.
    pub username: String,
    /// Hashed PIN/password.
    pub pin_hash: String,
    /// Display name shown on the POS UI.
    pub display_name: String,
    /// FK to `roles.id`.
    pub role_id: String,
    /// Whether this user can log in.
    pub is_active: bool,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl User {
    /// Create a new user.
    pub fn new(
        username: impl Into<String>,
        pin_hash: impl Into<String>,
        display_name: impl Into<String>,
        role_id: impl Into<String>,
    ) -> Self {
        let username = username.into().trim().to_owned();
        let display_name = display_name.into().trim().to_owned();
        assert!(!username.is_empty(), "username must not be empty");
        assert!(!display_name.is_empty(), "display_name must not be empty");

        Self {
            id: uuid::Uuid::now_v7().to_string(),
            username,
            pin_hash: pin_hash.into(),
            display_name,
            role_id: role_id.into(),
            is_active: true,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

/// Well-known role ids used by the seed data.
///
/// The authoritative taxonomy is `platform_core::rbac::builtin_roles`
/// (six ids incl. ADMIN/AUDITOR); this subset covers the seeds this
/// module owns. STAFF is checkout-only per the preset (40+ negative
/// assertions) — NOT "Manager minus settings" as an earlier revision
/// of this doc claimed (MSL-6 / E-1).
pub mod builtin_roles {
    /// Owner — full access to all features and settings.
    pub const OWNER: &str = "role-owner";
    /// Manager — can manage products, inventory, sales, staff, and settings.
    pub const MANAGER: &str = "role-manager";
    /// Staff — checkout-only operational role (preset-pinned).
    pub const STAFF: &str = "role-staff";
    /// Custom — fully flexible role with no preset permissions.
    pub const CUSTOM: &str = "role-custom";
}

/// Well-known seed user ids.
pub mod seed_users {
    /// Default admin user created by `kasir init-db`.
    pub const ADMIN: &str = "user-admin";
}

/// Strongly-typed identifier for a User row.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct UserId(String);

impl UserId {
    /// Generate a new UUID v7 identifier.
    #[must_use]
    pub fn new() -> Self {
        Self(uuid::Uuid::now_v7().to_string())
    }

    /// Borrow the underlying string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for UserId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::ops::Deref for UserId {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::fmt::Display for UserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for UserId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for UserId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

#[cfg(test)]
mod tests {
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
