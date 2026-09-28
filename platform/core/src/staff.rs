//! Staff and role domain models — persisted rows for users, roles and their identifiers.
//!
//! Moved here from `modules-staff` (ADR-61 / C26, 2026-09-28). The tier is `platform-core`, not
//! `foundation`, and that is forced rather than preferred: `Role`'s policy methods call
//! [`crate::rbac`], and `platform-core` depends on `foundation`, so moving these types down to
//! foundation would make it depend on a crate that depends on it. Every impl moved with its type,
//! including the hand-written `Debug` that redacts `User::pin_hash` (MSL-9 / E-1).

use crate::rbac::{AuthorizationError, has_permission};
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
///
/// `Debug` is implemented by hand below, NOT derived: `pin_hash` is the
/// Argon2id credential verifier and a derived impl prints it on any `{:?}`
/// line or panic dump. `Serialize` stays derived because the store, the sync
/// snapshot and the two `.kasirpkg` import arms all need the field in full —
/// the credential is withheld at the SURFACES that carry the row outward
/// (`UserResponse`, `StaffMemberDto`, the blanking export arms), never by
/// removing it from the domain type.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Hand-written `std::fmt::Debug` that redacts `pin_hash`.
///
/// The derived impl printed the credential verifier. Nothing formats a `User`
/// with `{:?}` today, so this PREVENTS rather than repairs — exactly the
/// posture `TenantSubscription`'s manual impl records for its own three
/// secrets (`crates/kasirmu-core/src/subscription.rs:401-425`): the idiomatic
/// future log line is `tracing::debug!(?user)`, and once the verifier is in a
/// log file no front-end redaction can scrub it. The shape follows the
/// tree's first such repair, `GiftCard`
/// (`modules/loyalty/src/models.rs:127-144`), which redacts its PIN the same
/// way. Every other field stays printed so the row remains debuggable, and
/// `TrashedUser` — which embeds this type and derives `Debug` — inherits the
/// redaction rather than printing the hash through its own derive.
impl std::fmt::Debug for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("User")
            .field("id", &self.id)
            .field("username", &self.username)
            .field("pin_hash", &"<redacted>")
            .field("display_name", &self.display_name)
            .field("role_id", &self.role_id)
            .field("is_active", &self.is_active)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
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

// NOTE (2026-09-28, ADR-61 / C26): the four-constant `builtin_roles` subset that used to live here was
// DELETED, not moved. Its values were byte-identical to `platform_core::rbac::builtin_roles`, which its
// own doc named as the authoritative taxonomy; two spellings of one id set is how the two drift apart.
// Consumers of the old subset use `platform_core::rbac::builtin_roles`, a superset (six ids).

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
#[path = "staff_tests.rs"]
mod tests;
