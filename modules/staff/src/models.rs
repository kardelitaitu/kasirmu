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
#[path = "models_tests.rs"]
mod tests;
